// BFShared.checkFeed: the "silent canary" (roadmap slice 1.5). A pure check meant to run on every data
// load: it says nothing while the feed is healthy and returns a precise problem list when the feed
// breaks an assumption the app's numbers rest on.
//
// WHY IT EXISTS. A renamed or inserted column has silently broken numbers before (the "alias landmine"
// class, DATA_ARCHITECTURE.md), and the export's width has already changed under the app, shifting dozens
// of columns. So columns are found BY NAME, never by position, and a missing name is reported instead of
// being papered over by getVal()'s substring fallback.
//
// WHAT IT CHECKS, and the code each problem carries:
//   BAD_INPUT            the call itself was malformed (it never throws; it says so here instead)
//   DUPLICATE_HEADER     two headers read as the same name once case, spaces and punctuation are ignored
//   MISSING_FIELD        a required field has no alias that matches any header (or a column this check
//                        itself needs, such as the VVD or a key column, is absent)
//   NO_ROWS              the feed has no rows at all
//   NO_REAL_ROWS         it has rows, but every one is a placeholder (blank or VMS vessel/voyage)
//   ROW_COUNT_DROP       far fewer rows than the previous load
//   DUPLICATE_KEY        the key columns repeat among the real rows
//   VOYAGE_DISAGREEMENT  a voyage-level column differs across the port rows of one VVD
//
// Problems are listed in that order (BAD_INPUT first), so the same feed always gives the same list.
//
// NAME MATCHING mirrors the app: a name is "cleaned" (lower case, only letters and digits kept) before
// it is compared, so a header that gained a space or changed case still matches, and a header renamed to
// anything else does not. Only the exact cleaned match counts. getVal() has a second, substring pass;
// it is deliberately NOT used here, because a field that only resolves through it is exactly the
// silent-corruption case this canary exists to catch. When two headers clean to the same name the LAST
// one supplies the values, as it does in the app's own value lookup (and DUPLICATE_HEADER reports it).
//
// REAL ROWS. VMS rows are placeholders for a week no vessel has been nominated to. They all share the
// key (VMS, blank, blank), so counting them would report dozens of false duplicates every day (65 to 73
// on the committed 9-day data). Everything row-level ignores them; BFShared.isRealVvd decides.
//
// Never mutates its input. Reads only the handful of columns it needs, so 10,000 rows by 100 columns
// take well under a tenth of a second.

var checkFeed_DEFAULT_KEYS = ['Vessel 1st VVD', 'Route Location Calling Port Seq', 'Route Location 1st Pol'];
var checkFeed_DEFAULT_VOYAGE_FIELDS = ['MCT PIC', 'Vessel 1st Lane', 'MCT Max Laden', 'Route Date Cut/off Date', 'Route Date 1st Sale Week'];
var checkFeed_DEFAULT_VVD_COLUMN = 'Vessel 1st VVD';
var checkFeed_DEFAULT_MAX_DROP_PCT = 10;
// Output stays small however broken the feed is: a feed with thousands of repeats still yields a
// problem list a person can read, with the totals in the detail.
var checkFeed_MAX_EXAMPLES = 5;
var checkFeed_MAX_VALUES = 10;

// The app's own cleaning rule (see getVal in the app file), so a name matches here exactly when it
// would match there.
function checkFeed_clean(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A cell as comparable text: blank for null and undefined, otherwise trimmed. A number cell and a text
// cell that print alike must compare alike, and stray spaces are not a data difference.
function checkFeed_text(v) {
    if (typeof v === 'string') return v.trim();
    return v === null || v === undefined ? '' : String(v).trim();
}

// True for objects and arrays, false for null, undefined, numbers, text and functions. Written without
// typeof compared to the word object on purpose: the build compiles the shared region with Babel, which
// would turn that comparison into a helper function (_typeof) and add a second top-level name to the
// app script (tests/check_shared_sync.js fails on it).
function checkFeed_isObject(x) {
    return Object(x) === x && typeof x !== 'function';
}

function checkFeed_problem(code, message, detail) {
    return { code: code, message: message, detail: detail };
}

function checkFeed_badInput(what, message, extra) {
    var detail = { what: what };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) detail[k] = extra[k];
        }
    }
    return checkFeed_problem('BAD_INPUT', message, detail);
}

// The text of a caught error. A hostile input can make even reading the message throw.
function checkFeed_errorText(e) {
    try {
        return String(e && e.message);
    } catch (e2) {
        return 'unreadable error';
    }
}

function checkFeed_plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
}

// A value for a message: blank is spelled out so an empty cell is visible.
function checkFeed_show(v) {
    return v === '' ? '(blank)' : '"' + v + '"';
}

// An optional list of column names. Missing means "use the default"; a list with anything that is not a
// usable name is reported and replaced by the default, so a typo cannot quietly switch a check off.
function checkFeed_nameList(value, fallback, what, bad) {
    if (value === undefined || value === null) return fallback;
    if (Array.isArray(value)) {
        var usable = true;
        for (var i = 0; i < value.length; i++) {
            if (typeof value[i] !== 'string' || checkFeed_clean(value[i]) === '') usable = false;
        }
        if (usable) return value;
    }
    bad.push(checkFeed_badInput(what, what + ' must be a list of non-blank column names; the default list was used instead'));
    return fallback;
}

// requiredFields: [{ key, aliases: [names] }]. A malformed entry is reported (with its position) and
// skipped, because it cannot be checked and must not look like a pass.
function checkFeed_readRequired(value, bad) {
    var out = [];
    if (value === undefined || value === null) return out;
    if (!Array.isArray(value)) {
        bad.push(checkFeed_badInput('requiredFields', 'requiredFields must be a list of { key, aliases } entries'));
        return out;
    }
    var badAt = [];
    for (var i = 0; i < value.length; i++) {
        var f = value[i];
        var usable = checkFeed_isObject(f) && Array.isArray(f.aliases) && f.aliases.length > 0;
        for (var j = 0; usable && j < f.aliases.length; j++) {
            if (typeof f.aliases[j] !== 'string') usable = false;
        }
        if (!usable) { badAt.push(i); continue; }
        var key = f.key === undefined || f.key === null || f.key === '' ? f.aliases[0] : String(f.key);
        out.push({ key: key, aliases: f.aliases.slice() });
    }
    if (badAt.length) {
        bad.push(checkFeed_badInput('requiredFields', 'requiredFields entries at position(s) ' + badAt.join(', ') + ' need a non-empty list of text aliases; they were skipped', { positions: badAt }));
    }
    return out;
}

// Maps each cleaned header to the position of its LAST occurrence (the one the app reads) and records
// every group of headers that clean alike. Keys are prefixed with a letter so data such as
// "constructor" or "__proto__" can never collide with a property every object inherits. Headers that
// clean to nothing (a blank column) are skipped: no alias can match them, and several blank columns
// are not a duplicate.
function checkFeed_indexHeaders(headers) {
    var last = {};
    var groups = {};
    var order = [];
    for (var i = 0; i < headers.length; i++) {
        var c = checkFeed_clean(headers[i]);
        if (c === '') continue;
        var k = 'k' + c;
        last[k] = i;
        if (groups[k] === undefined) { groups[k] = [i]; order.push(c); } else groups[k].push(i);
    }
    return { last: last, groups: groups, order: order };
}

// The column a wanted name resolves to, or null. name is the header text, which is what object rows are
// keyed by. inherited marks a header spelled like a property every object has ("constructor"): only
// those need the slower own-property read in checkFeed_cell.
function checkFeed_findColumn(index, headers, wanted) {
    var c = checkFeed_clean(wanted);
    if (c === '') return null;
    var at = index.last['k' + c];
    if (at === undefined) return null;
    var name = String(headers[at]);
    return { idx: at, name: name, wanted: wanted, inherited: name in Object.prototype };
}

// One cell of a row, whether the row is an object keyed by header or an array in header order. A header
// named like an inherited property reads its own value only, so it cannot return a function.
function checkFeed_cell(row, isArray, col) {
    if (isArray) return row[col.idx];
    if (col.inherited) return Object.prototype.hasOwnProperty.call(row, col.name) ? row[col.name] : undefined;
    return row[col.name];
}

// One pass over the rows. Returns the real-row count, the unreadable rows, the repeated keys and the
// voyage-level disagreements. keyCols and voyageCols are lists of resolved columns (either may be empty).
function checkFeed_scanRows(rows, vvdCol, keyCols, voyageCols) {
    var real = 0;
    var badRows = 0;
    var firstBadRow = -1;
    var firstSeen = {};
    var dupAt = {};
    var dups = [];
    var extraRows = 0;
    var voyageAt = {};
    var voyages = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!checkFeed_isObject(row)) {
            if (badRows === 0) firstBadRow = i;
            badRows++;
            continue;
        }
        var isArray = Array.isArray(row);
        var vvd = checkFeed_text(checkFeed_cell(row, isArray, vvdCol));
        if (!BFShared.isRealVvd(vvd)) continue;
        real++;
        var vvdKey = BFShared.normalizeVvd(vvd);
        var j;
        if (keyCols.length > 0) {
            var parts = [];
            var key = '';
            for (j = 0; j < keyCols.length; j++) {
                var part = checkFeed_text(checkFeed_cell(row, isArray, keyCols[j]));
                if (keyCols[j].idx === vvdCol.idx) part = BFShared.normalizeVvd(part);
                parts.push(part);
                // length-prefixed, so no choice of cell text can make two different keys join alike
                key += part.length + ':' + part + '|';
            }
            var fk = 'k' + key;
            if (firstSeen[fk] === undefined) {
                firstSeen[fk] = i;
            } else {
                extraRows++;
                var di = dupAt[fk];
                if (di === undefined) {
                    dupAt[fk] = dups.length;
                    dups.push({ key: parts, count: 2, rowIndexes: [firstSeen[fk], i] });
                } else {
                    dups[di].count++;
                    if (dups[di].rowIndexes.length < checkFeed_MAX_EXAMPLES) dups[di].rowIndexes.push(i);
                }
            }
        }
        if (voyageCols.length > 0) {
            var vk = 'k' + vvdKey;
            var rec = voyageAt[vk];
            if (rec === undefined) {
                rec = { vvd: vvdKey, first: [], extra: [] };
                for (j = 0; j < voyageCols.length; j++) {
                    rec.first.push(checkFeed_text(checkFeed_cell(row, isArray, voyageCols[j])));
                    rec.extra.push(null);
                }
                voyageAt[vk] = rec;
                voyages.push(rec);
            } else {
                for (j = 0; j < voyageCols.length; j++) {
                    var v = checkFeed_text(checkFeed_cell(row, isArray, voyageCols[j]));
                    if (v === rec.first[j]) continue;
                    var ex = rec.extra[j];
                    if (ex === null) {
                        ex = { list: [rec.first[j]], seen: {} };
                        ex.seen['k' + rec.first[j]] = true;
                        rec.extra[j] = ex;
                    }
                    if (ex.seen['k' + v] === undefined) {
                        ex.seen['k' + v] = true;
                        ex.list.push(v);
                    }
                }
            }
        }
    }
    return { real: real, badRows: badRows, firstBadRow: firstBadRow, dups: dups, extraRows: extraRows, voyages: voyages };
}

// The body of checkFeed. Collects problems into one list per code so the final order is fixed.
function checkFeed_run(input) {
    var lists = { bad: [], headers: [], missing: [], rows: [], drop: [], dup: [], voyage: [] };
    var stats = { rowCount: 0, realRowCount: null, headerCount: 0 };
    var finish = function () {
        var problems = [].concat(lists.bad, lists.headers, lists.missing, lists.rows, lists.drop, lists.dup, lists.voyage);
        return { ok: problems.length === 0, problems: problems, stats: stats };
    };

    if (!checkFeed_isObject(input)) {
        lists.bad.push(checkFeed_badInput('input', 'checkFeed needs an object like { headers, rows, requiredFields }'));
        return finish();
    }
    var headers = input.headers;
    var rows = input.rows;
    var headersOk = Array.isArray(headers);
    var rowsOk = Array.isArray(rows);
    if (headersOk) stats.headerCount = headers.length;
    else lists.bad.push(checkFeed_badInput('headers', 'headers must be a list of column names'));
    if (rowsOk) stats.rowCount = rows.length;
    else lists.bad.push(checkFeed_badInput('rows', 'rows must be a list of row objects (or row arrays)'));

    var keyNames = checkFeed_nameList(input.keyColumns, checkFeed_DEFAULT_KEYS, 'keyColumns', lists.bad);
    var voyageNames = checkFeed_nameList(input.voyageFields, checkFeed_DEFAULT_VOYAGE_FIELDS, 'voyageFields', lists.bad);
    var vvdName = input.vvdColumn;
    if (vvdName === undefined || vvdName === null) vvdName = checkFeed_DEFAULT_VVD_COLUMN;
    else if (typeof vvdName !== 'string' || checkFeed_clean(vvdName) === '') {
        lists.bad.push(checkFeed_badInput('vvdColumn', 'vvdColumn must be a non-blank column name; the default was used instead'));
        vvdName = checkFeed_DEFAULT_VVD_COLUMN;
    }
    var required = checkFeed_readRequired(input.requiredFields, lists.bad);
    var prev = input.prevRowCount;
    if (prev === undefined || prev === null) prev = null;
    else if (typeof prev !== 'number' || !isFinite(prev) || prev < 0) {
        lists.bad.push(checkFeed_badInput('prevRowCount', 'prevRowCount must be a number of rows (0 or more) or null; no row-count comparison was made'));
        prev = null;
    }
    var maxDrop = input.maxRowDropPct;
    if (maxDrop === undefined || maxDrop === null) maxDrop = checkFeed_DEFAULT_MAX_DROP_PCT;
    else if (typeof maxDrop !== 'number' || !isFinite(maxDrop) || maxDrop < 0) {
        lists.bad.push(checkFeed_badInput('maxRowDropPct', 'maxRowDropPct must be a percentage (0 or more); the default of ' + checkFeed_DEFAULT_MAX_DROP_PCT + ' was used instead'));
        maxDrop = checkFeed_DEFAULT_MAX_DROP_PCT;
    }

    var vvdCol = null;
    var keyCols = [];
    var keyUsable = false;
    var voyageCols = [];
    if (headersOk) {
        var index = checkFeed_indexHeaders(headers);

        for (var g = 0; g < index.order.length; g++) {
            var members = index.groups['k' + index.order[g]];
            if (members.length < 2) continue;
            var names = [];
            for (var m = 0; m < members.length; m++) names.push(String(headers[members[m]]));
            lists.headers.push(checkFeed_problem('DUPLICATE_HEADER',
                'Columns ' + members.join(', ') + ' (' + names.map(checkFeed_show).join(', ') + ') are the same name once case, spaces and punctuation are ignored; the app reads the last one',
                { cleaned: index.order[g], headers: names, indexes: members }));
        }

        // A name is reported missing once, however many ways it was asked for.
        var reported = {};
        var reportMissing = function (key, aliases, role) {
            lists.missing.push(checkFeed_problem('MISSING_FIELD',
                (role === 'required' ? 'Required field "' + key + '"' : 'The ' + role + ' column "' + key + '"') + ' matches no column in the feed (looked for: ' + aliases.join(', ') + ')',
                { key: key, aliases: aliases, role: role }));
        };
        for (var r = 0; r < required.length; r++) {
            var found = false;
            for (var a = 0; a < required[r].aliases.length; a++) {
                var ca = checkFeed_clean(required[r].aliases[a]);
                if (ca !== '' && index.last['k' + ca] !== undefined) found = true;
            }
            if (found) continue;
            for (a = 0; a < required[r].aliases.length; a++) reported['k' + checkFeed_clean(required[r].aliases[a])] = true;
            reportMissing(required[r].key, required[r].aliases.slice(), 'required');
        }
        // The columns this check itself reads. A missing one would otherwise either switch its check off
        // without a word or (a blank key) invent duplicates.
        var need = function (name, role) {
            var col = checkFeed_findColumn(index, headers, name);
            if (col === null && reported['k' + checkFeed_clean(name)] === undefined) {
                reported['k' + checkFeed_clean(name)] = true;
                reportMissing(name, [name], role);
            }
            return col;
        };
        vvdCol = need(vvdName, 'vvd');
        keyUsable = true;
        for (var q = 0; q < keyNames.length; q++) {
            var kc = need(keyNames[q], 'key');
            if (kc === null) keyUsable = false;
            else keyCols.push(kc);
        }
        if (!keyUsable) keyCols = [];
        for (q = 0; q < voyageNames.length; q++) {
            var vc = need(voyageNames[q], 'voyage');
            if (vc !== null) voyageCols.push(vc);
        }
    }

    var scan = null;
    if (headersOk && rowsOk && vvdCol !== null) {
        scan = checkFeed_scanRows(rows, vvdCol, keyCols, voyageCols);
        stats.realRowCount = scan.real;
        if (scan.badRows > 0) {
            lists.bad.push(checkFeed_badInput('rows',
                checkFeed_plural(scan.badRows, 'row is', 'rows are') + ' not an object or array (first at position ' + scan.firstBadRow + '); skipped',
                { badRowCount: scan.badRows, firstBadRowIndex: scan.firstBadRow }));
        }
    }

    if (rowsOk) {
        if (rows.length === 0) {
            lists.rows.push(checkFeed_problem('NO_ROWS', 'The feed has no data rows', { rowCount: 0 }));
        } else if (scan !== null && scan.real === 0) {
            lists.rows.push(checkFeed_problem('NO_REAL_ROWS',
                'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ' but every one is a placeholder (blank or VMS vessel/voyage), so it holds no real sailing',
                { rowCount: rows.length, vvdColumn: vvdName }));
        }
        // Cross-multiplied, not divided: an exact 10% drop must not be pushed over the limit by rounding.
        if (prev !== null && prev > 0 && (prev - rows.length) * 100 > maxDrop * prev) {
            var dropPct = Math.round((prev - rows.length) / prev * 10000) / 100;
            lists.drop.push(checkFeed_problem('ROW_COUNT_DROP',
                'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ', down from ' + prev + ' (a ' + dropPct + '% drop; the limit is ' + maxDrop + '%)',
                { rowCount: rows.length, prevRowCount: prev, dropPct: dropPct, maxRowDropPct: maxDrop }));
        }
    }

    if (scan !== null && scan.dups.length > 0) {
        var keyLabels = [];
        for (var n = 0; n < keyCols.length; n++) keyLabels.push(keyCols[n].wanted);
        var dupExamples = scan.dups.slice(0, checkFeed_MAX_EXAMPLES);
        lists.dup.push(checkFeed_problem('DUPLICATE_KEY',
            checkFeed_plural(scan.extraRows, 'real row repeats', 'real rows repeat') + ' an earlier row\'s key (' + keyLabels.join(' + ') + '), across ' + checkFeed_plural(scan.dups.length, 'key', 'keys') + '; for example ' + dupExamples[0].key.map(checkFeed_show).join(' + ') + ' appears ' + dupExamples[0].count + ' times',
            { keyColumns: keyLabels, duplicateKeyCount: scan.dups.length, extraRows: scan.extraRows, examples: dupExamples }));
    }

    if (scan !== null && voyageCols.length > 0) {
        var voyageCount = 0;
        var pairCount = 0;
        var examples = [];
        for (var x = 0; x < scan.voyages.length; x++) {
            var rec = scan.voyages[x];
            var any = false;
            for (var y = 0; y < voyageCols.length; y++) {
                if (rec.extra[y] === null) continue;
                any = true;
                pairCount++;
                if (examples.length < checkFeed_MAX_EXAMPLES) {
                    examples.push({ vvd: rec.vvd, field: voyageCols[y].wanted, values: rec.extra[y].list.slice(0, checkFeed_MAX_VALUES), valueCount: rec.extra[y].list.length });
                }
            }
            if (any) voyageCount++;
        }
        if (voyageCount > 0) {
            lists.voyage.push(checkFeed_problem('VOYAGE_DISAGREEMENT',
                checkFeed_plural(voyageCount, 'voyage carries', 'voyages carry') + ' different values across its port rows in a voyage-level column; for example VVD ' + examples[0].vvd + ', ' + examples[0].field + ': ' + examples[0].values.map(checkFeed_show).join(' vs '),
                { voyageCount: voyageCount, pairCount: pairCount, examples: examples }));
        }
    }
    return finish();
}

// checkFeed({ headers, rows, requiredFields, keyColumns, voyageFields, prevRowCount, maxRowDropPct,
//             vvdColumn }) -> { ok, problems: [{ code, message, detail }], stats }
//   headers         list of the column names, in file order
//   rows            list of row objects keyed by those names (a row may also be an array in header order)
//   requiredFields  [{ key, aliases: [names] }]: each needs at least one alias that matches a header
//   keyColumns      the columns that identify one port row of one voyage
//   voyageFields    columns that must hold one value across all port rows of a VVD
//   prevRowCount    the previous load's row count, or null when there is none (no comparison is made)
//   maxRowDropPct   how far below prevRowCount the row count may fall before it is a problem
//   vvdColumn       the column holding the VVD, which decides which rows are placeholders
// stats is { rowCount, realRowCount, headerCount }; realRowCount is null when the VVD column is absent
// (nothing row-level can be judged then). ok is true only when problems is empty. Every check that
// cannot run reports why, so ok === true also means every check ran.
// It never throws: input it cannot read comes back as a BAD_INPUT problem, and a last-resort handler
// turns anything unforeseen into one, because a canary that crashes the data load is worse than none.
BFShared.checkFeed = function (input) {
    try {
        return checkFeed_run(input);
    } catch (e) {
        return {
            ok: false,
            problems: [checkFeed_badInput('exception', 'checkFeed could not read its input without an error', { error: checkFeed_errorText(e) })],
            stats: { rowCount: 0, realRowCount: null, headerCount: 0 }
        };
    }
};

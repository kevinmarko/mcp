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
//   ROW_COUNT_JUMP       far more rows than the previous load (the same percentage, in the other direction)
//   REAL_ROW_COUNT_DROP  far fewer REAL rows than the previous load's real rows (only when prevRealRowCount is
//                        given): placeholder rows can hold the raw count steady while real sailings vanish
//   REAL_ROW_COUNT_JUMP  far more real rows than the previous load's real rows (the other direction)
//   DUPLICATE_KEY        the key columns repeat among the real rows
//   VOYAGE_DISAGREEMENT  a voyage-level column differs across the port rows of one VVD
//
// Problems are listed in that order (BAD_INPUT first), so the same feed always gives the same list.
//
// NAME MATCHING mirrors the app: a name is "cleaned" (lower case, only letters and digits kept) before
// it is compared, so a header that gained a space or changed case still matches, and a header renamed to
// anything else does not. Only the exact cleaned match counts. getVal() has a second, substring pass;
// it is deliberately NOT used here, because a field that only resolves through it is exactly the
// silent-corruption case this canary exists to catch.
//
// DUPLICATE HEADERS. When two headers clean to the same name, the column that supplies the values is the
// one the app's own value lookup reads, and DUPLICATE_HEADER names it. Which one that is depends on the
// spreadsheet reader: SheetJS's sheet_to_json renames an EXACT repeat of a header text by adding "_1"
// ("_2", ...), so two "MCT PIC" columns become "MCT PIC" and "MCT PIC_1", "MCT PIC_1" cleans to a
// different name, and the app reads the FIRST column. Headers that differ only in case, spacing or
// punctuation ("MCT PIC" and "mct pic") keep their own text, both clean alike, and the app reads the LAST
// one. checkFeed_readerKeys repeats SheetJS's renaming so the canary reads the same column the app does,
// for object rows (keyed by those renamed names, as sheet_to_json makes them) and array rows alike.
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
// The three measures BFShared.diffSailings reads. Required when the caller passes no requiredFields at
// all (an explicit list, even an empty one, replaces them), so a renamed measure column is reported
// instead of silently turning every sailing's TEU into a blank.
// Aliases mirror the app's getVal list for the same field (polBkgUtilzRaw accepts 'POL Booking Utilz' too, so a feed
// carrying only that name still loads and must not raise MISSING_FIELD); the other two have a single name in the app.
var checkFeed_DEFAULT_REQUIRED = [
    { key: 'Measures Laden TEU', aliases: ['Measures Laden TEU'] },
    { key: 'Measures Total Booking TEU by Service', aliases: ['Measures Total Booking TEU by Service'] },
    { key: 'Measures POL Booking Utilz', aliases: ['Measures POL Booking Utilz', 'POL Booking Utilz'] }
];
// Output stays small however broken the feed is: a feed with thousands of repeats still yields a
// problem list a person can read, with the totals in the detail.
var checkFeed_MAX_EXAMPLES = 5;
var checkFeed_MAX_VALUES = 10;
// How many affected voyages a VOYAGE_DISAGREEMENT names (the rest are counted in voyageCount).
var checkFeed_MAX_VVDS = 25;

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
// usable name, and an EMPTY list, is reported and replaced by the default, so neither a typo nor an empty
// list can quietly switch a check off (an empty list would leave nothing to check and still answer ok).
function checkFeed_nameList(value, fallback, what, bad) {
    if (value === undefined || value === null) return fallback;
    if (Array.isArray(value) && value.length > 0) {
        var usable = true;
        for (var i = 0; i < value.length; i++) {
            if (typeof value[i] !== 'string' || checkFeed_clean(value[i]) === '') usable = false;
        }
        if (usable) return value;
    }
    bad.push(checkFeed_badInput(what, what + ' must be a non-empty list of non-blank column names; the default list was used instead'));
    return fallback;
}

// requiredFields: [{ key, aliases: [names] }]; missing means the default measures above. A malformed entry (no aliases, or
// one that is not text or is blank) is reported (with its position) and skipped, because it cannot be checked and must not
// look like a pass.
function checkFeed_readRequired(value, bad) {
    var out = [];
    if (value === undefined || value === null) {
        for (var d = 0; d < checkFeed_DEFAULT_REQUIRED.length; d++) out.push({ key: checkFeed_DEFAULT_REQUIRED[d].key, aliases: checkFeed_DEFAULT_REQUIRED[d].aliases.slice() });
        return out;
    }
    if (!Array.isArray(value)) {
        bad.push(checkFeed_badInput('requiredFields', 'requiredFields must be a list of { key, aliases } entries'));
        return out;
    }
    var badAt = [];
    for (var i = 0; i < value.length; i++) {
        var f = value[i];
        var usable = checkFeed_isObject(f) && Array.isArray(f.aliases) && f.aliases.length > 0;
        // A blank alias is refused like a blank name in checkFeed_nameList: it can match no column.
        for (var j = 0; usable && j < f.aliases.length; j++) {
            if (typeof f.aliases[j] !== 'string' || checkFeed_clean(f.aliases[j]) === '') usable = false;
        }
        if (!usable) { badAt.push(i); continue; }
        var key = f.key === undefined || f.key === null || f.key === '' ? f.aliases[0] : String(f.key);
        out.push({ key: key, aliases: f.aliases.slice() });
    }
    if (badAt.length) {
        bad.push(checkFeed_badInput('requiredFields', 'requiredFields entries at position(s) ' + badAt.join(', ') + ' need a non-empty list of non-blank text aliases; they were skipped', { positions: badAt }));
    }
    return out;
}

// The key each header gets in a row object made by SheetJS's sheet_to_json, which is how the app reads the
// sheet: a header text seen before gets "_1" appended (then "_2", ...), skipping any name already taken,
// and a missing header cell is "__EMPTY". This is SheetJS's own loop (0.20.3, the version the app loads),
// written out because the canary is given the sheet's header row as it is, repeats and all.
function checkFeed_readerKeys(headers) {
    var taken = {};
    var keys = [];
    for (var i = 0; i < headers.length; i++) {
        var h = headers[i];
        var v = h === null || h === undefined || h === '' ? '__EMPTY' : String(h);
        var key = v;
        var count = taken['k' + v] || 0;
        if (!count) {
            taken['k' + v] = 1;
        } else {
            do { key = v + '_' + (count++); } while (taken['k' + key]);
            taken['k' + v] = count;
            taken['k' + key] = 1;
        }
        keys.push(key);
    }
    return keys;
}

// Maps each cleaned header to the position the app reads for that name (read: the LAST header whose
// reader key cleans to it, see DUPLICATE HEADERS above) and records every group of headers that clean
// alike as written. Keys are prefixed with a letter so data such as "constructor" or "__proto__" can
// never collide with a property every object inherits. A header that cleans to nothing (a blank column)
// joins no group: several blank columns are not a duplicate. Its reader key ("__EMPTY") still counts
// for read, as it does in the app.
function checkFeed_indexHeaders(headers) {
    var keys = checkFeed_readerKeys(headers);
    var read = {};
    var groups = {};
    var order = [];
    for (var i = 0; i < headers.length; i++) {
        var rc = checkFeed_clean(keys[i]);
        if (rc !== '') read['k' + rc] = i;
        var c = checkFeed_clean(headers[i]);
        if (c === '') continue;
        var k = 'k' + c;
        if (groups[k] === undefined) { groups[k] = [i]; order.push(c); } else groups[k].push(i);
    }
    return { read: read, keys: keys, groups: groups, order: order };
}

// The DUPLICATE_HEADER problem for one group of headers that clean alike (members: their positions).
// Says which column the app reads and, when the reader renamed one, what it was renamed to.
function checkFeed_duplicateHeader(index, headers, cleaned, members) {
    var names = [];
    for (var m = 0; m < members.length; m++) names.push(String(headers[members[m]]));
    var at = index.read['k' + cleaned];
    var which = at === members[0] ? 'the first one' : (at === members[members.length - 1] ? 'the last one' : 'column ' + at);
    var shown = members.indexOf(at) === -1 ? members.concat([at]).sort(function (a, b) { return a - b; }) : members;
    var renamed = [];
    for (m = 0; m < shown.length; m++) {
        var text = String(headers[shown[m]]);
        if (index.keys[shown[m]] !== text) renamed.push(checkFeed_show(text) + ' in column ' + shown[m] + ' is read as "' + index.keys[shown[m]] + '"');
    }
    return checkFeed_problem('DUPLICATE_HEADER',
        'Columns ' + members.join(', ') + ' (' + names.map(checkFeed_show).join(', ') + ') are the same name once case, spaces and punctuation are ignored; the app reads ' + which +
        (renamed.length ? ' (the spreadsheet reader renames an exact repeat of a header: ' + renamed.join(', ') + ')' : ''),
        { cleaned: cleaned, headers: names, indexes: members, readIndex: at });
}

// The column a wanted name resolves to, or null. name is the column's reader key (its header text, or
// the "_1" name SheetJS gave an exact repeat), which is what object rows are keyed by. inherited marks a
// key spelled like a property every object has ("constructor"): only those need the slower own-property
// read in checkFeed_cell.
function checkFeed_findColumn(index, wanted) {
    var c = checkFeed_clean(wanted);
    if (c === '') return null;
    var at = index.read['k' + c];
    if (at === undefined) return null;
    var name = index.keys[at];
    return { idx: at, name: name, wanted: wanted, inherited: name in Object.prototype };
}

// One cell of a row, whether the row is an object keyed by header or an array in header order. A header
// named like an inherited property reads its own value only, so it cannot return a function.
function checkFeed_cell(row, isArray, col) {
    if (isArray) return row[col.idx];
    if (col.inherited) return Object.prototype.hasOwnProperty.call(row, col.name) ? row[col.name] : undefined;
    return row[col.name];
}

// One part of a row's key: the cell as comparable text, with the VVD column normalised like the app does.
function checkFeed_keyPart(row, isArray, col, vvdCol) {
    var part = checkFeed_text(checkFeed_cell(row, isArray, col));
    return col.idx === vvdCol.idx ? BFShared.normalizeVvd(part) : part;
}

// For one voyage and one voyage-level column: every distinct value (first appearance first, at most
// checkFeed_MAX_VALUES of them) with the number of port rows carrying it and, for the first few of those rows, where
// they are: the row's cells in atCols (the key columns other than the VVD; the calling-port sequence and the yard in the
// app; with no usable key columns there is nothing to say and at stays empty). rec.rows holds the positions of the voyage's real rows. Run only for the few examples a report shows, never
// for every voyage, so it costs nothing on a healthy feed.
function checkFeed_breakdown(rows, rec, col, atCols) {
    var out = [];
    var byValue = {};
    for (var i = 0; i < rec.rows.length; i++) {
        var row = rows[rec.rows[i]];
        var isArray = Array.isArray(row);
        var v = checkFeed_text(checkFeed_cell(row, isArray, col));
        var b = byValue['k' + v];
        if (b === undefined) {
            if (out.length >= checkFeed_MAX_VALUES) continue;
            b = { value: v, rowCount: 0, at: [] };
            byValue['k' + v] = b;
            out.push(b);
        }
        b.rowCount++;
        if (atCols.length > 0 && b.at.length < checkFeed_MAX_VALUES) {
            var parts = [];
            for (var j = 0; j < atCols.length; j++) parts.push(checkFeed_text(checkFeed_cell(row, isArray, atCols[j])));
            b.at.push(parts);
        }
    }
    return out;
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
            // The key text is built for every row; the list of parts only for the first repeat of a key
            // (it is what the report shows), so a feed with no duplicates allocates no part lists at all.
            // The leading letter keeps a key such as "constructor" or "__proto__" off the inherited names.
            var fk = 'k';
            for (j = 0; j < keyCols.length; j++) {
                var part = checkFeed_keyPart(row, isArray, keyCols[j], vvdCol);
                // length-prefixed, so no choice of cell text can make two different keys join alike
                fk += part.length + ':' + part + '|';
            }
            if (firstSeen[fk] === undefined) {
                firstSeen[fk] = i;
            } else {
                extraRows++;
                var di = dupAt[fk];
                if (di === undefined) {
                    // Equal key text means equal parts (the length prefixes make the text unambiguous), so this
                    // row's parts are the first row's.
                    var parts = [];
                    for (j = 0; j < keyCols.length; j++) parts.push(checkFeed_keyPart(row, isArray, keyCols[j], vvdCol));
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
                rec = { vvd: vvdKey, first: [], extra: [], rows: [] };
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
            rec.rows.push(i);
        }
    }
    return { real: real, badRows: badRows, firstBadRow: firstBadRow, dups: dups, extraRows: extraRows, voyages: voyages };
}

// The body of checkFeed. Collects problems into one list per code so the final order is fixed.
function checkFeed_run(input) {
    var lists = { bad: [], headers: [], missing: [], rows: [], drop: [], jump: [], realDrop: [], realJump: [], dup: [], voyage: [] };
    var stats = { rowCount: 0, realRowCount: null, headerCount: 0 };
    var finish = function () {
        var problems = [].concat(lists.bad, lists.headers, lists.missing, lists.rows, lists.drop, lists.jump, lists.realDrop, lists.realJump, lists.dup, lists.voyage);
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
    var prevReal = input.prevRealRowCount;
    if (prevReal === undefined || prevReal === null) prevReal = null;
    else if (typeof prevReal !== 'number' || !isFinite(prevReal) || prevReal < 0) {
        lists.bad.push(checkFeed_badInput('prevRealRowCount', 'prevRealRowCount must be a number of real rows (0 or more) or null; no real-row-count comparison was made'));
        prevReal = null;
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
            if (members.length >= 2) lists.headers.push(checkFeed_duplicateHeader(index, headers, index.order[g], members));
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
                if (ca !== '' && index.read['k' + ca] !== undefined) found = true;
            }
            if (found) continue;
            for (a = 0; a < required[r].aliases.length; a++) reported['k' + checkFeed_clean(required[r].aliases[a])] = true;
            reportMissing(required[r].key, required[r].aliases.slice(), 'required');
        }
        // The columns this check itself reads. A missing one would otherwise either switch its check off
        // without a word or (a blank key) invent duplicates.
        var need = function (name, role) {
            var col = checkFeed_findColumn(index, name);
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
        // The same limit upward: a feed that suddenly holds far more rows (a doubled export, a repeated
        // paste) is as untrustworthy as one that lost rows.
        if (prev !== null && prev > 0 && (rows.length - prev) * 100 > maxDrop * prev) {
            var risePct = Math.round((rows.length - prev) / prev * 10000) / 100;
            lists.jump.push(checkFeed_problem('ROW_COUNT_JUMP',
                'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ', up from ' + prev + ' (a ' + risePct + '% rise; the limit is ' + maxDrop + '%)',
                { rowCount: rows.length, prevRowCount: prev, risePct: risePct, maxRowDropPct: maxDrop }));
        }
    }

    // The same two limits on the REAL rows (stats.realRowCount: placeholder and blank-VVD rows left out). The raw
    // count above cannot see real sailings vanishing while placeholder rows hold the total up. Skipped when there are
    // no real rows at all: NO_ROWS / NO_REAL_ROWS already say so, and a third line for the same fact is noise. For the
    // same reason a real-row problem is not added when the raw count already reported the same direction (a feed cut
    // in half loses real rows too); the opposite direction is still reported, because then they disagree.
    if (rowsOk && scan !== null && prevReal !== null && prevReal > 0 && scan.real > 0) {
        var realNow = scan.real;
        var realWord = checkFeed_plural(realNow, 'real row', 'real rows');
        if (lists.drop.length === 0 && (prevReal - realNow) * 100 > maxDrop * prevReal) {
            var realDropPct = Math.round((prevReal - realNow) / prevReal * 10000) / 100;
            lists.realDrop.push(checkFeed_problem('REAL_ROW_COUNT_DROP',
                'The feed has ' + realWord + ' (placeholder rows left out), down from ' + prevReal + ' (a ' + realDropPct + '% drop; the limit is ' + maxDrop + '%)',
                { realRowCount: realNow, prevRealRowCount: prevReal, dropPct: realDropPct, maxRowDropPct: maxDrop }));
        }
        if (lists.jump.length === 0 && (realNow - prevReal) * 100 > maxDrop * prevReal) {
            var realRisePct = Math.round((realNow - prevReal) / prevReal * 10000) / 100;
            lists.realJump.push(checkFeed_problem('REAL_ROW_COUNT_JUMP',
                'The feed has ' + realWord + ' (placeholder rows left out), up from ' + prevReal + ' (a ' + realRisePct + '% rise; the limit is ' + maxDrop + '%)',
                { realRowCount: realNow, prevRealRowCount: prevReal, risePct: realRisePct, maxRowDropPct: maxDrop }));
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
        var affected = [];
        var perColumn = [];
        // Where a port row is, besides its VVD: the rest of the key (the calling-port sequence and the yard in the app).
        var atCols = [];
        var atNames = [];
        for (var w = 0; w < keyCols.length; w++) {
            if (keyCols[w].idx === vvdCol.idx) continue;
            atCols.push(keyCols[w]);
            atNames.push(keyCols[w].wanted);
        }
        for (var z = 0; z < voyageCols.length; z++) perColumn.push(0);
        for (var x = 0; x < scan.voyages.length; x++) {
            var rec = scan.voyages[x];
            var any = false;
            for (var y = 0; y < voyageCols.length; y++) {
                if (rec.extra[y] === null) continue;
                any = true;
                pairCount++;
                perColumn[y]++;
                if (examples.length < checkFeed_MAX_EXAMPLES) {
                    examples.push({
                        vvd: rec.vvd, field: voyageCols[y].wanted, values: rec.extra[y].list.slice(0, checkFeed_MAX_VALUES), valueCount: rec.extra[y].list.length,
                        rowCount: rec.rows.length, breakdown: checkFeed_breakdown(rows, rec, voyageCols[y], atCols)
                    });
                }
            }
            if (any) {
                voyageCount++;
                if (affected.length < checkFeed_MAX_VVDS) affected.push(rec.vvd);
            }
        }
        if (voyageCount > 0) {
            var columns = [];
            for (var c = 0; c < voyageCols.length; c++) {
                if (perColumn[c] > 0) columns.push({ field: voyageCols[c].wanted, voyageCount: perColumn[c] });
            }
            lists.voyage.push(checkFeed_problem('VOYAGE_DISAGREEMENT',
                checkFeed_plural(voyageCount, 'voyage carries', 'voyages carry') + ' different values across ' + (voyageCount === 1 ? 'its' : 'their') + ' port rows in a voyage-level column; for example VVD ' + examples[0].vvd + ', ' + examples[0].field + ': ' + examples[0].values.map(checkFeed_show).join(' vs '),
                { voyageCount: voyageCount, pairCount: pairCount, examples: examples, columns: columns, vvds: affected, atColumns: atNames }));
        }
    }
    return finish();
}

// checkFeed({ headers, rows, requiredFields, keyColumns, voyageFields, prevRowCount, maxRowDropPct,
//             vvdColumn }) -> { ok, problems: [{ code, message, detail }], stats }
//   headers         list of the column names, in file order
//   rows            list of row objects keyed by those names (a row may also be an array in header order)
//   requiredFields  [{ key, aliases: [names] }]: each needs at least one alias that matches a header.
//                   Omitted (or null): the three measures diffSailings reads ('Measures Laden TEU',
//                   'Measures Total Booking TEU by Service', 'Measures POL Booking Utilz'). A list,
//                   even an empty one, replaces them.
//   keyColumns      the columns that identify one port row of one voyage; a non-empty list (an empty one is
//                   BAD_INPUT and the default is used, so the check cannot be switched off by accident)
//   voyageFields    columns that must hold one value across all port rows of a VVD; a non-empty list (same rule)
//   prevRowCount    the previous load's row count, or null when there is none (no comparison is made)
//   prevRealRowCount  optional: the previous load's stats.realRowCount, or null (no comparison is made; that is
//                   the default, so existing callers are unaffected). When it is a number, stats.realRowCount is
//                   compared with it by the same rule as prevRowCount (same maxRowDropPct, drop and rise), giving
//                   REAL_ROW_COUNT_DROP or REAL_ROW_COUNT_JUMP with detail { realRowCount, prevRealRowCount,
//                   dropPct (or risePct), maxRowDropPct }. Not a number (or negative): BAD_INPUT, no comparison.
//                   No comparison either when the feed has no real rows (NO_ROWS / NO_REAL_ROWS covers that),
//                   and no REAL_ROW_COUNT_DROP (JUMP) when ROW_COUNT_DROP (JUMP) was already reported.
//                   A caller that stores a baseline stores BOTH counts from the load's result: rowCount and
//                   stats.realRowCount.
//   maxRowDropPct   how far, in percent, the row count may move from prevRowCount before it is a problem:
//                   below it is ROW_COUNT_DROP, above it is ROW_COUNT_JUMP (so the limit is plus or minus)
//   vvdColumn       the column holding the VVD, which decides which rows are placeholders
// VOYAGE_DISAGREEMENT detail (so a screen can say WHICH port rows disagree, not only that some do):
//   voyageCount     voyages with at least one disagreeing column; pairCount: voyage + column pairs
//   examples        the first checkFeed_MAX_EXAMPLES pairs, each { vvd, field, values, valueCount, rowCount, breakdown }:
//                   values are the distinct texts (first appearance first, capped), valueCount how many there are in all,
//                   rowCount the voyage's real port rows, and breakdown one { value, rowCount, at } per value in the same
//                   order: how many port rows carry it, and for the first few the cells of atColumns on that row
//   columns         [{ field, voyageCount }]: how many voyages disagree in each column that does (all of them, no cap)
//   vvds            the affected voyages in feed order, at most checkFeed_MAX_VVDS (voyageCount says how many there are)
//   atColumns       the names behind each at: the key columns other than the VVD, in keyColumns order ([] when the key
//                   columns are unusable). The detail is read-only data: the message text is unchanged.
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

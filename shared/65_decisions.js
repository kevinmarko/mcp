// The decision store's record logic (D84 Phase 2, slice 2a-3; ADR-R1, DECIDED 2026-10-30: append-only tabs in the Team Data
// Sheet through apps-script/TeamSheet.gs). The browser, Apps Script and any later VPT reader share this one definition (D1).
// Named 65_ so it sorts after 05_identifiers.js (makePortKey) and 60_threshold_diff.js (thresholdValue, the private
// thresholdDiff_index), which it uses (only at call time, so the order is for the reader, not for correctness).
//
//   BFShared.decisionLimits()                           -> { reasonMaxChars, payloadMaxChars, idMaxChars, ... } (a fresh copy)
//   BFShared.decisionTime(v)                            -> the ISO time normalised with milliseconds, or null
//   BFShared.normalizeDecisionRecord(r)                 -> { ok: true, record } or { ok: false, error: CODE }
//   BFShared.decisionRecordFromRow(row)                 -> the same, from one Sheet row (payload cell = JSON text)
//   BFShared.decisionRecordToRow(r)                     -> { ok: true, row } or { ok: false, error: CODE }
//   BFShared.latestDecisionPerKey(records)              -> [record], one per (vvd, polKey, kind): the latest
//   BFShared.decisionHistoryFor(records, key)           -> [record + supersededBy], the key's history and chains, newest first
//   BFShared.thresholdLog(records, currentRows, since)  -> [entry], one per threshold proposal with its latest status
//   BFShared.thresholdLiveInFeed(to, current)           -> true when the feed's current threshold equals the proposed value
//
// RECORD. { id, vvd, polKey, kind, payload, author, createdAt, supersedes }. One record is one row of the Decisions or the
// ThresholdLog tab, columns in that order, the payload stored as JSON text. Rows are never updated or deleted: a correction
// is a new record whose supersedes names the id it replaces.
//   id          1 to 64 characters: a letter or digit, then letters, digits and _ . : - (the server makes a UUID).
//   vvd         a real VVD (BFShared.isRealVvd), trimmed and upper-cased, in the server's VVD pattern (2 to 40 characters).
//   polKey      the sailing-port: '' for the whole sailing, else a port code ('USNYC') or a D4 port key ('USNYC#2'), trimmed
//               and upper-cased. A port key is made canonical with BFShared.makePortKey, so 'usnyc#02' and 'USNYC#00002' are
//               'USNYC#2' (one key, never two; the sequence may be written with up to 20 digits, at most 4 once canonical).
//               null and undefined are ''.
//   kind        'decision' or 'threshold' (trimmed, lower-cased).
//   payload     a plain object; only the keys below are kept, in this order, and the JSON text must be at most
//               payloadMaxChars long.
//     decision:  { action: 'freeze'|'monitor'|'cut'|'roll', reason: non-blank text, at most reasonMaxChars,
//                  rollTo?, seen? }
//                rollTo and seen were added by slice 2b-2 (the decision card, OQ1) and are optional: a record without
//                them reads exactly as before. rollTo is a real VVD (BFShared.normalizeVvd, isRealVvd, the VVD pattern),
//                kept only when not blank and only for action 'roll' (for any other action it is ignored, never checked);
//                seen is what the person was looking at when they decided (the port's figures: curLaden, ceiling and
//                threshold are the port's; bookingSailing is the sailing's booking total), an object whose known keys are
//                kept in this order: curLaden, ceiling, threshold, bookingSailing, declaredFinal, fallDownPct (a finite
//                number or null) and epAsOf, dataAsOf (text of at most 40 characters, trimmed, or null); other keys are
//                dropped and an object with none of them is left out. A stored row whose rollTo or seen breaks these
//                rules is not a valid record, so it is skipped on read (counted in skipped), like any other invalid row.
//     threshold: { field: 'overall'|'loading', from: number or null, to: number, reason (as above),
//                  status: 'proposed'|'approved'|'rejected' }
//                from and to are read with BFShared.thresholdValue's meaning of "not set" (0, 0.01, blank): from 0 or 0.01
//                is stored as null (proposing a value for a missing threshold); to must be a set value. Any number that is
//                set must be above 0 and at most 1000. Both must be JSON numbers (or from null); a string is refused, so a
//                stored row means exactly one thing. 'overall' belongs to the sailing, so its polKey must be ''; 'loading'
//                belongs to a port, so its polKey must not be ''. That keeps one threshold per (vvd, polKey, kind) key.
//                check? was added by slice 2b-3 (threshold proposals) and is optional: a record without it reads exactly as
//                before. It records that the server checked WHO decided (Q3: the lane's SPC lead or the admin): { as:
//                'lead'|'admin', lane }, lane trimmed and upper-cased, 1 to 20 characters (a letter or digit, then letters,
//                digits and space . _ -), required for 'lead', '' allowed for 'admin'. It is kept only for status 'approved'
//                and 'rejected' (for 'proposed' it is ignored, never checked); extra keys inside it are dropped. Only
//                TeamSheet.gs's decideThresholdProposal writes it: saveThresholdChange builds its payload from named fields
//                and never passes check through. A stored row whose check breaks these rules is not a valid record.
//                check may also carry sig: 64 lower-case hex characters, the server's HMAC-SHA256 of the decision (security
//                review of 2b-3, 2026-10-31); kept as it is, any other sig is refused. Only the server can verify it (the
//                key is a Script Property), so these functions never treat a check as trusted: the server strips any check
//                whose sig fails before handing records to the page (TeamSheet.gs getThresholdProposals).
//   author      an email address, trimmed and lower-cased (the server fills it from the session; never the client).
//   createdAt   an ISO time exactly as Date.prototype.toISOString writes it (real calendar day, UTC 'Z', milliseconds
//               optional; decisionTime); it is stored WITH milliseconds ('.000' added), so two times compare as strings.
//   supersedes  '' or another record's id (never the record's own).
// Error codes, the first that applies in this order: 'not-object', 'invalid-id', 'invalid-vvd', 'invalid-polkey', 'invalid-kind',
// 'invalid-payload', 'invalid-action', 'invalid-field', 'invalid-from', 'invalid-to', 'invalid-status', 'invalid-reason',
// 'reason-too-long', 'invalid-roll-to', 'invalid-seen', 'invalid-check', 'payload-too-large', 'invalid-author', 'invalid-created-at', 'invalid-supersedes' ('invalid-polkey' also
// comes right after 'invalid-field' when a threshold's polKey does not suit its field). From a row also 'not-row' and
// 'invalid-payload-json'. Any other failure while reading a hostile input (a getter or a proxy that throws) is
// 'invalid-record'.
//
// LOOKUPS. Every lookup table here is a plain object read only through Object.prototype.hasOwnProperty, and its keys carry
// a '#' prefix (no inherited name starts with '#'), so an id such as 'sPrototypeOf', 'constructor' or '__proto__' is an
// ordinary id. A record that is not valid is skipped on its own; it never empties an answer.
//
// LATEST. latestDecisionPerKey keeps the valid records, drops duplicate ids (of two records with one id the newer is kept; on
// a tie, the larger row text, so the input order never matters), and marks a record SUPERSEDED when any other kept record
// names it in supersedes, whatever key that record has. A superseded record is never the latest. Per key the latest is the
// newest remaining record by createdAt, then by id (the larger wins). A supersedes cycle (A names B, B names A) supersedes
// every record in it, so such a key falls back to its newest record outside the cycle, or has none. No chain is walked, so
// nothing can loop. The answer is sorted by vvd, polKey, kind.
//
// HISTORY. decisionHistoryFor(records, { vvd, polKey, kind }) is every kept record of that key plus every record joined to
// one of them through supersedes in either direction, followed transitively with a visited set (so a cycle ends), newest
// first (createdAt, then id, larger first). Each comes back with supersededBy: the id of the newest record that names it in
// supersedes, or ''. A key that is not valid gives [].
//
// THRESHOLD LOG. Its status is the latest record's RAW status: an 'approved' here is UNCHECKED (anyone could save it through
// saveThresholdChange, or type it into the Sheet). To show who decided, use BFShared.thresholdProposals (its state) on the
// records from TeamSheet.gs getThresholdProposals, which verifies each check first. thresholdLog groups the kept threshold records into proposals: records joined through supersedes (either
// direction, transitively) are one proposal, whatever their key. Per proposal: first = the oldest record (createdAt, then id),
// latest = the newest record no other record of the group supersedes (the newest of all when a cycle leaves none).
// VALUE RULE: field, from and to come from the first record whose status is 'proposed' found walking back from latest
// through supersedes (a visited set ends a cycle; the last record reached when there is none). A fork (Q re-proposes P while A
// approves P) reports the value A approved, P's, not Q's newer one. An approval or a rejection decides a value; it never changes it, so an 'approved' record that carries another to
// does not move the proposal's to (the server refuses such a record anyway, 'changed-value'). A new 'proposed' record in the
// chain is a re-proposal and does change the value. Entry:
//   { id: first.id, latestId, vvd, polKey (latest's), field, from, to (the value rule), reason, status (latest's),
//     proposedBy: first.author, proposedAt: first.createdAt, updatedBy: latest.author, updatedAt: latest.createdAt,
//     records: group size, current, liveInFeed, stage }
// currentRows is the current day's rows in the shape BFShared.findMissingThresholds reads ({ vvd, pol, lane, overall,
// loading }, plus an optional seq, the calling-port sequence). current is that day's threshold for the entry, a number or
// null: the sailing's overall; for loading, when polKey is a port key 'PORT#n' and a row of that VVD has
// makePortKey(pol, seq) equal to it (vvd read as findMissingThresholds reads it: a string or a number), that call's own rows (their first set loading threshold), else the port's (the first
// set loading threshold of any row of the VVD at that POL). The committed 9-day CSV has one row per VVD and POL each day, so
// the two agree there. liveInFeed is thresholdLiveInFeed(to, current). When currentRows is not an array, current and
// liveInFeed are null (unknown). stage is 'rejected' for a rejected proposal, 'live' for an approved one that is live in the
// feed, else the status. since, when decisionTime accepts it, keeps only the proposals updated at or after it; anything else
// keeps them all (the server refuses a bad since before calling this). Sorted by updatedAt, newest first, then id.
//
// None of them reads a clock or any global but the ES5 built-ins; none throws; none changes its input.

var decisions_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
var decisions_VVD_PATTERN = /^[A-Z0-9][A-Z0-9 ._\/-]{1,39}$/;
var decisions_POLKEY_PATTERN = /^[A-Z0-9][A-Z0-9 ._\/-]{0,39}(#\d{1,4})?$/;
var decisions_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
var decisions_ISO_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/;
var decisions_KINDS = ['decision', 'threshold'];
var decisions_ACTIONS = ['freeze', 'monitor', 'cut', 'roll'];
var decisions_FIELDS = ['overall', 'loading'];
var decisions_STATUSES = ['proposed', 'approved', 'rejected'];
var decisions_REASON_MAX = 1000;
var decisions_PAYLOAD_MAX = 4000;
var decisions_EMAIL_MAX = 254;
var decisions_VALUE_MAX = 1000;
var decisions_SEEN_KEYS = ['curLaden', 'ceiling', 'threshold', 'bookingSailing', 'declaredFinal', 'fallDownPct', 'epAsOf', 'dataAsOf'];
var decisions_SEEN_TEXT = ['epAsOf', 'dataAsOf'];
var decisions_SEEN_TEXT_MAX = 40;
var decisions_CHECK_AS = ['lead', 'admin'];
var decisions_LANE_PATTERN = /^[A-Z0-9][A-Z0-9 ._-]{0,19}$/;

BFShared.decisionLimits = function () {
    return {
        reasonMaxChars: decisions_REASON_MAX,
        payloadMaxChars: decisions_PAYLOAD_MAX,
        idMaxChars: 64,
        emailMaxChars: decisions_EMAIL_MAX,
        kinds: decisions_KINDS.slice(),
        actions: decisions_ACTIONS.slice(),
        fields: decisions_FIELDS.slice(),
        statuses: decisions_STATUSES.slice()
    };
};

function decisions_isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
}

function decisions_own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

// A lookup table's key for an id or any other text: '#' + text (no inherited property name starts with '#').
function decisions_key(s) {
    return '#' + s;
}

function decisions_has(map, k) {
    return Object.prototype.hasOwnProperty.call(map, k);
}

function decisions_get(map, k) {
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined;
}

function decisions_trim(s) {
    return s.replace(/^\s+|\s+$/g, '');
}

function decisions_cmp(a, b) {
    return a < b ? -1 : (a > b ? 1 : 0);
}

function decisions_fail(code) {
    return { ok: false, error: code };
}

// A strict ISO time ('2026-10-30T14:05:09Z' or with '.123'), normalised to carry milliseconds; null when it is not one.
function decisions_isoTime(v) {
    var m;
    if (typeof v !== 'string') return null;
    m = decisions_ISO_PATTERN.exec(decisions_trim(v));
    if (!m || !feedAge_isCalendarDate(m[1])) return null;
    if (parseInt(m[2], 10) > 23 || parseInt(m[3], 10) > 59 || parseInt(m[4], 10) > 59) return null;
    return m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + (m[5] || '.000') + 'Z';
}

BFShared.decisionTime = function (v) {
    try {
        return decisions_isoTime(v);
    } catch (e) {
        return null;
    }
};

// A polKey as stored ('' , 'USNYC' or the canonical 'USNYC#2'), or null when it is not one.
function decisions_polKey(v) {
    var p, parts;
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return null;
    p = BFShared.normalizeVvd(v);
    if (p === '') return '';
    if (p.indexOf('#') !== -1) {
        // Canonical first ('USNYC#00002' is 'USNYC#2'), then the pattern, so leading zeros never make a key too long.
        parts = p.split('#');
        if (parts.length !== 2 || !/^\d{1,20}$/.test(parts[1])) return null;
        p = BFShared.makePortKey(parts[0], parts[1]);
        if (p === '') return null;
    }
    return decisions_POLKEY_PATTERN.test(p) ? p : null;
}

// A threshold number: null for "not set" (thresholdValue), else a number above 0 and at most decisions_VALUE_MAX;
// undefined when it is out of range.
function decisions_thresholdNumber(v) {
    var n = BFShared.thresholdValue(v);
    if (n === null) return null;
    return (n > 0 && n <= decisions_VALUE_MAX) ? n : undefined;
}

// The kind-specific payload, or an error code (a string).
function decisions_payload(kind, p, polKey) {
    var reason, action, field, from, to, status, out, extra;
    if (!decisions_isObject(p)) return 'invalid-payload';
    if (kind === 'decision') {
        action = decisions_own(p, 'action');
        action = typeof action === 'string' ? decisions_trim(action).toLowerCase() : '';
        if (decisions_ACTIONS.indexOf(action) === -1) return 'invalid-action';
        out = { action: action, reason: '' };
    } else {
        field = decisions_own(p, 'field');
        field = typeof field === 'string' ? decisions_trim(field).toLowerCase() : '';
        if (decisions_FIELDS.indexOf(field) === -1) return 'invalid-field';
        if ((field === 'overall') !== (polKey === '')) return 'invalid-polkey';
        from = decisions_own(p, 'from');
        if (from === undefined || from === null) from = null;
        else if (typeof from === 'number' && isFinite(from)) from = decisions_thresholdNumber(from);
        else return 'invalid-from';
        if (from === undefined) return 'invalid-from';
        to = decisions_own(p, 'to');
        to = typeof to === 'number' ? decisions_thresholdNumber(to) : null;
        if (to === null || to === undefined) return 'invalid-to';
        status = decisions_own(p, 'status');
        status = typeof status === 'string' ? decisions_trim(status).toLowerCase() : '';
        if (decisions_STATUSES.indexOf(status) === -1) return 'invalid-status';
        out = { field: field, from: from, to: to, reason: '', status: status };
    }
    reason = decisions_own(p, 'reason');
    reason = typeof reason === 'string' ? decisions_trim(reason) : '';
    if (reason === '') return 'invalid-reason';
    if (reason.length > decisions_REASON_MAX) return 'reason-too-long';
    out.reason = reason;
    if (kind === 'decision') {
        // rollTo belongs to a Roll only: for any other action it is ignored (not checked, not stored).
        extra = action === 'roll' ? decisions_rollTo(decisions_own(p, 'rollTo')) : '';
        if (extra === undefined) return 'invalid-roll-to';
        if (extra !== '') out.rollTo = extra;
        extra = decisions_seen(decisions_own(p, 'seen'));
        if (extra === undefined) return 'invalid-seen';
        if (extra !== null) out.seen = extra;
    } else if (status !== 'proposed') {
        // check belongs to a decided proposal only: for 'proposed' it is ignored (not checked, not stored).
        extra = decisions_check(decisions_own(p, 'check'));
        if (extra === undefined) return 'invalid-check';
        if (extra !== null) out.check = extra;
    }
    if (JSON.stringify(out).length > decisions_PAYLOAD_MAX) return 'payload-too-large';
    return out;
}

// A decision's optional roll target (slice 2b-2, OQ1): '' when absent (null, undefined or blank), the VVD trimmed and
// upper-cased when it is a real one in the VVD pattern, else undefined (refused).
function decisions_rollTo(v) {
    var n;
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return undefined;
    n = BFShared.normalizeVvd(v);
    if (n === '') return '';
    return (BFShared.isRealVvd(n) && decisions_VVD_PATTERN.test(n)) ? n : undefined;
}

// A decision's optional "what the person was looking at" snapshot (slice 2b-2, OQ1): null when absent, a fresh object with
// only the known keys (in decisions_SEEN_KEYS order, absent keys left out) when valid, else undefined (refused). Number keys
// take a finite number or null; text keys take a string of at most decisions_SEEN_TEXT_MAX characters (trimmed) or null.
function decisions_seen(v) {
    var out = {}, any = false, i, k, x;
    if (v === undefined || v === null) return null;
    if (!decisions_isObject(v)) return undefined;
    for (i = 0; i < decisions_SEEN_KEYS.length; i++) {
        k = decisions_SEEN_KEYS[i];
        x = decisions_own(v, k);
        if (x === undefined) continue;
        if (x !== null) {
            if (decisions_SEEN_TEXT.indexOf(k) !== -1) {
                if (typeof x !== 'string') return undefined;
                x = decisions_trim(x);
                if (x.length > decisions_SEEN_TEXT_MAX) return undefined;
            } else if (typeof x !== 'number' || !isFinite(x)) {
                return undefined;
            }
        }
        out[k] = x;
        any = true;
    }
    return any ? out : null;
}

// A threshold decision's optional server check (slice 2b-3): null when absent (undefined or null), a fresh { as, lane } when
// valid, else undefined (refused).
function decisions_check(v) {
    var as, lane, sig;
    if (v === undefined || v === null) return null;
    if (!decisions_isObject(v)) return undefined;
    as = decisions_own(v, 'as');
    as = typeof as === 'string' ? decisions_trim(as).toLowerCase() : '';
    if (decisions_CHECK_AS.indexOf(as) === -1) return undefined;
    lane = decisions_own(v, 'lane');
    if (lane === undefined || lane === null) lane = '';
    if (typeof lane !== 'string') return undefined;
    lane = decisions_trim(lane).toUpperCase();
    if (lane === '' ? as !== 'admin' : !decisions_LANE_PATTERN.test(lane)) return undefined;
    sig = decisions_own(v, 'sig');
    if (sig === undefined || sig === null) return { as: as, lane: lane };
    if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return undefined;
    return { as: as, lane: lane, sig: sig };
}

function decisions_normalize(r) {
    var id, vvd, polKey, kind, payload, author, createdAt, supersedes;
    if (!decisions_isObject(r)) return decisions_fail('not-object');
    id = decisions_own(r, 'id');
    id = typeof id === 'string' ? decisions_trim(id) : '';
    if (!decisions_ID_PATTERN.test(id)) return decisions_fail('invalid-id');
    vvd = decisions_own(r, 'vvd');
    vvd = typeof vvd === 'string' ? BFShared.normalizeVvd(vvd) : '';
    if (!BFShared.isRealVvd(vvd) || !decisions_VVD_PATTERN.test(vvd)) return decisions_fail('invalid-vvd');
    polKey = decisions_polKey(decisions_own(r, 'polKey'));
    if (polKey === null) return decisions_fail('invalid-polkey');
    kind = decisions_own(r, 'kind');
    kind = typeof kind === 'string' ? decisions_trim(kind).toLowerCase() : '';
    if (decisions_KINDS.indexOf(kind) === -1) return decisions_fail('invalid-kind');
    payload = decisions_payload(kind, decisions_own(r, 'payload'), polKey);
    if (typeof payload === 'string') return decisions_fail(payload);
    author = decisions_own(r, 'author');
    author = typeof author === 'string' ? decisions_trim(author).toLowerCase() : '';
    if (author.length > decisions_EMAIL_MAX || !decisions_EMAIL_PATTERN.test(author)) return decisions_fail('invalid-author');
    createdAt = decisions_isoTime(decisions_own(r, 'createdAt'));
    if (createdAt === null) return decisions_fail('invalid-created-at');
    supersedes = decisions_own(r, 'supersedes');
    if (supersedes === undefined || supersedes === null) supersedes = '';
    else if (typeof supersedes === 'string') supersedes = decisions_trim(supersedes);
    else return decisions_fail('invalid-supersedes');
    if (supersedes !== '' && (!decisions_ID_PATTERN.test(supersedes) || supersedes === id)) return decisions_fail('invalid-supersedes');
    return {
        ok: true,
        record: { id: id, vvd: vvd, polKey: polKey, kind: kind, payload: payload, author: author, createdAt: createdAt, supersedes: supersedes }
    };
}

BFShared.normalizeDecisionRecord = function (r) {
    try {
        return decisions_normalize(r);
    } catch (e) {
        return decisions_fail('invalid-record');
    }
};

// A Sheet cell as text: a string as it is, a finite number or a boolean as String() writes it, anything else ''.
function decisions_cell(row, i) {
    var v = row.length > i ? row[i] : '';
    if (typeof v === 'string') return v;
    if ((typeof v === 'number' && isFinite(v)) || typeof v === 'boolean') return String(v);
    return '';
}

BFShared.decisionRecordFromRow = function (row) {
    var payload;
    try {
        if (!Array.isArray(row)) return decisions_fail('not-row');
        try {
            payload = JSON.parse(decisions_cell(row, 4));
        } catch (e) {
            return decisions_fail('invalid-payload-json');
        }
        return decisions_normalize({
            id: decisions_cell(row, 0), vvd: decisions_cell(row, 1), polKey: decisions_cell(row, 2), kind: decisions_cell(row, 3),
            payload: payload, author: decisions_cell(row, 5), createdAt: decisions_cell(row, 6), supersedes: decisions_cell(row, 7)
        });
    } catch (e2) {
        return decisions_fail('invalid-record');
    }
};

BFShared.decisionRecordToRow = function (r) {
    var n = BFShared.normalizeDecisionRecord(r);
    var x;
    if (!n.ok) return n;
    x = n.record;
    return { ok: true, row: [x.id, x.vvd, x.polKey, x.kind, JSON.stringify(x.payload), x.author, x.createdAt, x.supersedes] };
};

// True when record a is newer than record b: createdAt, then id.
function decisions_newer(a, b) {
    return decisions_cmp(a.createdAt, b.createdAt) > 0 || (a.createdAt === b.createdAt && decisions_cmp(a.id, b.id) > 0);
}

// Newest first: the comparator for sort.
function decisions_newestFirst(a, b) {
    return decisions_newer(a, b) ? -1 : (decisions_newer(b, a) ? 1 : 0);
}

function decisions_keyOf(r) {
    return r.vvd + '\n' + r.polKey + '\n' + r.kind;
}

// The valid records, one per id, as { list, byId }. byId is keyed by decisions_key(id) and read only through
// decisions_get / decisions_has (see LOOKUPS above). A record that fails to normalise is skipped on its own.
function decisions_clean(records) {
    var byId = {};
    var list = [];
    var i, n, k, old;
    if (!Array.isArray(records)) return { list: list, byId: byId };
    for (i = 0; i < records.length; i++) {
        n = BFShared.normalizeDecisionRecord(records[i]);
        if (!n.ok) continue;
        k = decisions_key(n.record.id);
        old = decisions_get(byId, k);
        if (!old || decisions_newer(n.record, old) ||
            (old.createdAt === n.record.createdAt && decisions_cmp(JSON.stringify(n.record), JSON.stringify(old)) > 0)) {
            byId[k] = n.record;
        }
    }
    for (k in byId) {
        if (decisions_has(byId, k)) list.push(byId[k]);
    }
    list.sort(function (a, b) { return decisions_cmp(a.id, b.id); });
    return { list: list, byId: byId };
}

// For each kept record (keyed by decisions_key(id)), the newest kept record that names it in supersedes.
function decisions_supersededBy(clean) {
    var by = {};
    var i, r, k, cur;
    for (i = 0; i < clean.list.length; i++) {
        r = clean.list[i];
        if (r.supersedes === '') continue;
        k = decisions_key(r.supersedes);
        if (!decisions_has(clean.byId, k)) continue;
        cur = decisions_get(by, k);
        if (!cur || decisions_newer(r, cur)) by[k] = r;
    }
    return by;
}

function decisions_copy(r, supersededBy) {
    var out = { id: r.id, vvd: r.vvd, polKey: r.polKey, kind: r.kind, payload: JSON.parse(JSON.stringify(r.payload)),
        author: r.author, createdAt: r.createdAt, supersedes: r.supersedes };
    if (supersededBy !== undefined) out.supersededBy = supersededBy;
    return out;
}

BFShared.latestDecisionPerKey = function (records) {
    var clean, by, best, out, i, r, k, cur;
    try {
        clean = decisions_clean(records);
        by = decisions_supersededBy(clean);
        best = {};
        for (i = 0; i < clean.list.length; i++) {
            r = clean.list[i];
            if (decisions_has(by, decisions_key(r.id))) continue;
            k = decisions_key(decisions_keyOf(r));
            cur = decisions_get(best, k);
            if (!cur || decisions_newer(r, cur)) best[k] = r;
        }
        out = [];
        for (k in best) {
            if (decisions_has(best, k)) out.push(decisions_copy(best[k]));
        }
        out.sort(function (a, b) {
            return decisions_cmp(a.vvd, b.vvd) || decisions_cmp(a.polKey, b.polKey) || decisions_cmp(a.kind, b.kind);
        });
        return out;
    } catch (e) {
        return [];
    }
};

// The records joined to the seed ids through supersedes in either direction, transitively: decisions_key(id) -> true.
function decisions_component(clean, seeds) {
    var seen = {};
    var queue = seeds.slice();
    var children = {};
    var i, r, k, next;
    for (i = 0; i < clean.list.length; i++) {
        r = clean.list[i];
        if (r.supersedes === '') continue;
        k = decisions_key(r.supersedes);
        if (!decisions_has(children, k)) children[k] = [];
        children[k].push(r.id);
    }
    while (queue.length) {
        k = decisions_key(queue.pop());
        if (decisions_has(seen, k) || !decisions_has(clean.byId, k)) continue;
        seen[k] = true;
        r = clean.byId[k];
        if (r.supersedes !== '') queue.push(r.supersedes);
        next = decisions_get(children, k) || [];
        for (i = 0; i < next.length; i++) queue.push(next[i]);
    }
    return seen;
}

BFShared.decisionHistoryFor = function (records, key) {
    var clean, by, seeds, seen, out, i, r, vvd, polKey, kind, sb;
    try {
        if (!decisions_isObject(key)) return [];
        vvd = decisions_own(key, 'vvd');
        vvd = typeof vvd === 'string' ? BFShared.normalizeVvd(vvd) : '';
        polKey = decisions_polKey(decisions_own(key, 'polKey'));
        kind = decisions_own(key, 'kind');
        kind = typeof kind === 'string' ? decisions_trim(kind).toLowerCase() : '';
        if (!BFShared.isRealVvd(vvd) || polKey === null || decisions_KINDS.indexOf(kind) === -1) return [];
        clean = decisions_clean(records);
        by = decisions_supersededBy(clean);
        seeds = [];
        for (i = 0; i < clean.list.length; i++) {
            r = clean.list[i];
            if (r.vvd === vvd && r.polKey === polKey && r.kind === kind) seeds.push(r.id);
        }
        seen = decisions_component(clean, seeds);
        out = [];
        for (i = 0; i < clean.list.length; i++) {
            r = clean.list[i];
            if (!decisions_has(seen, decisions_key(r.id))) continue;
            sb = decisions_get(by, decisions_key(r.id));
            out.push(decisions_copy(r, sb ? sb.id : ''));
        }
        out.sort(decisions_newestFirst);
        return out;
    } catch (e) {
        return [];
    }
};

BFShared.thresholdLiveInFeed = function (to, current) {
    var a, b;
    try {
        a = BFShared.thresholdValue(to);
        b = BFShared.thresholdValue(current);
        return a !== null && b !== null && Math.abs(a - b) <= thresholdDiff_EPSILON;
    } catch (e) {
        return false;
    }
};

// The loading threshold of one call (a 'PORT#n' polKey) from the day's rows: the first set value among the rows of that
// VVD whose makePortKey(pol, seq) is polKey; undefined when no row names that call (the caller then uses the port's value).
function decisions_callLoading(rows, vvd, polKey) {
    var found = false;
    var i, r, v;
    for (i = 0; i < rows.length; i++) {
        r = rows[i];
        if (!decisions_isObject(r)) continue;
        if (thresholdDiff_text(r.vvd) !== vvd) continue;
        if (BFShared.makePortKey(r.pol, r.seq) !== polKey) continue;
        found = true;
        v = BFShared.thresholdValue(r.loading);
        if (v !== null) return v;
    }
    return found ? null : undefined;
}

// The current day's threshold for a log entry (a number or null), from thresholdDiff_index's two lookups and, for a call's
// loading threshold, that call's own rows.
function decisions_currentFor(idx, rows, vvd, polKey, field) {
    var map = field === 'overall' ? idx.sailings : idx.ports;
    var k, call;
    if (field === 'loading' && polKey.indexOf('#') !== -1) {
        call = decisions_callLoading(rows, vvd, polKey);
        if (call !== undefined) return call;
    }
    k = field === 'overall' ? 'v' + vvd : 'p' + vvd + '\n' + polKey.split('#')[0];
    if (!decisions_has(map, k)) return null;
    return field === 'overall' ? map[k].overall : map[k].loading;
}

// The record whose field, from and to an entry shows: walking back from latest through supersedes (a visited set ends a
// cycle), the first record whose status is 'proposed'; when the walk finds none, the last record it reached.
function decisions_valueRecord(clean, latest) {
    var seen = {};
    var r = latest;
    var k;
    for (;;) {
        if (r.payload.status === 'proposed') return r;
        seen[decisions_key(r.id)] = true;
        if (r.supersedes === '') return r;
        k = decisions_key(r.supersedes);
        if (decisions_has(seen, k) || !decisions_has(clean.byId, k)) return r;
        r = clean.byId[k];
    }
}

BFShared.thresholdLog = function (records, currentRows, since) {
    var all, clean, by, done, out, idx, sinceIso, i, j, r, group, seen, first, latest, valueFrom, p, v, current, live;
    try {
        all = decisions_clean(records);
        clean = { list: [], byId: {} };
        for (i = 0; i < all.list.length; i++) {
            r = all.list[i];
            if (r.kind !== 'threshold') continue;
            clean.list.push(r);
            clean.byId[decisions_key(r.id)] = r;
        }
        by = decisions_supersededBy(clean);
        idx = Array.isArray(currentRows) ? thresholdDiff_index(currentRows) : null;
        sinceIso = decisions_isoTime(since);
        done = {};
        out = [];
        for (i = 0; i < clean.list.length; i++) {
            r = clean.list[i];
            if (decisions_has(done, decisions_key(r.id))) continue;
            seen = decisions_component(clean, [r.id]);
            group = [];
            for (j = 0; j < clean.list.length; j++) {
                if (decisions_has(seen, decisions_key(clean.list[j].id))) {
                    group.push(clean.list[j]);
                    done[decisions_key(clean.list[j].id)] = true;
                }
            }
            group.sort(decisions_newestFirst);
            first = group[group.length - 1];
            latest = null;
            for (j = 0; j < group.length && latest === null; j++) {
                if (!decisions_has(by, decisions_key(group[j].id))) latest = group[j];
            }
            if (latest === null) latest = group[0];
            valueFrom = decisions_valueRecord(clean, latest);
            if (sinceIso !== null && latest.createdAt < sinceIso) continue;
            p = latest.payload;
            v = valueFrom.payload;
            current = idx ? decisions_currentFor(idx, currentRows, latest.vvd, latest.polKey, v.field) : null;
            live = idx ? BFShared.thresholdLiveInFeed(v.to, current) : null;
            out.push({
                id: first.id, latestId: latest.id, vvd: latest.vvd, polKey: latest.polKey, field: v.field, from: v.from, to: v.to,
                reason: p.reason, status: p.status, proposedBy: first.author, proposedAt: first.createdAt,
                updatedBy: latest.author, updatedAt: latest.createdAt, records: group.length,
                current: current, liveInFeed: live,
                stage: p.status === 'rejected' ? 'rejected' : (p.status === 'approved' && live === true ? 'live' : p.status)
            });
        }
        out.sort(function (a, b) { return decisions_cmp(b.updatedAt, a.updatedAt) || decisions_cmp(a.id, b.id); });
        return out;
    } catch (e) {
        return [];
    }
};

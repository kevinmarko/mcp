// The decision card's own figures (D84 Phase 2, slice 2b-2; spec docs/specs/R-4-decision-card.md section 4). Three pure functions,
// all new: nothing in the tables reads them, and none of them writes back into a row (rule 8, additive only).
//
//   BFShared.decisionCeiling(base, maxLaden, threshold)      -> { set: false } or { set: true, ceiling, diff, over }
//   BFShared.matchDeskDeclaration(rows, vvd, pol)                 -> { state: 'none' | 'ok' | 'unmatched', row }
//   BFShared.declarationAge(asOf, nowMs, cutoff)              -> { ageMs, stale } or null
//
// CEILING (D2: the threshold is how far bookings may go over Max Laden; 0, 0.01 and blank mean "not set"). The same rule
// BFShared.findExceptions applies, so the card and the worklist agree: ceiling = maxLaden x threshold (threshold read with
// BFShared.thresholdValue), and base is over when it is STRICTLY above the ceiling. A maxLaden that is not a number above zero,
// or a threshold that is not set, gives { set: false } (the card then says "Threshold not set" and shows no ceiling). base and
// maxLaden are read exactly as findExceptions reads them (its private exceptions_number, shared/70_exceptions.js: a finite number,
// or a string in thresholdValue's number pattern; '1,640' with a comma is NOT a number there, so not here either); diff =
// base - ceiling, or null when base is not a number (over is then false).
//
// DECLARATION MATCH. rows are Empty Planning's EP_EXPORT rows as getDataFeed hands them (epExport.rows, apps-script/DataFeeds.gs:
// as_of, vvd, port, port_key, terminal, ...). The app's POL is the feed's yard code ('USHOU01': a 5-letter port and a 2-digit
// yard) and its rows carry no calling sequence. A row is a candidate when its vvd (BFShared.normalizeVvd) is the card's and its
// port, or the port part of its port_key (BFShared.parsePortKey), is the card's port: pol itself, or its first five letters when
// pol is a yard code. A candidate whose terminal is exactly pol wins when it is the only such one. Otherwise: no candidate is
// 'none'; exactly one is 'ok' with that row, unless pol is a yard code and the row names a different (non-blank) terminal,
// which is 'unmatched'; more than one (two calls or two terminals at that port, which cannot be told apart
// here) is 'unmatched', row null: never a silent pick, never a zero. rows that are not an array, and entries that are not
// objects, are skipped.
//
// DECLARATION AGE (spec K4). asOf is the export's as_of: 'YYYY-MM-DD' (read as the start of that day, UTC) or an ISO time
// with a zone. ageMs = nowMs - that time. stale when ageMs is over 24 hours, or when nowMs is past the cut-off day minus two
// days (cutoff 'YYYY-MM-DD', start of day UTC; a blank or unreadable cutoff adds no rule). An unreadable asOf or a nowMs
// that is not a finite number gives null (the card then says the age is unknown).
//
// None of them reads a clock or any global but the ES5 built-ins and BFShared; none throws; none changes its input.

var decisionCard_DAY_MS = 86400000;
var decisionCard_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
var decisionCard_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
var decisionCard_YARD_PATTERN = /^[A-Z]{5}\d{2}$/;

function decisionCard_isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
}

function decisionCard_text(v) {
    return (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
}

function decisionCard_dayMs(s) {
    var m = decisionCard_DATE_PATTERN.exec(s), t, d;
    if (!m) return null;
    t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    d = new Date(t);
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return t;
}

function decisionCard_timeMs(v) {
    var s, t;
    if (typeof v !== 'string') return null;
    s = v.replace(/^\s+|\s+$/g, '');
    t = decisionCard_dayMs(s);
    if (t !== null) return t;
    if (!decisionCard_ISO_PATTERN.test(s)) return null;
    t = Date.parse(s);
    return isFinite(t) ? t : null;
}

BFShared.decisionCeiling = function (base, maxLaden, threshold) {
    var cap, thr, b, ceiling, diff;
    try {
        cap = exceptions_number(maxLaden);
        thr = BFShared.thresholdValue(threshold);
        if (cap === null || !(cap > 0) || thr === null) return { set: false };
        ceiling = cap * thr;
        b = exceptions_number(base);
        diff = b === null ? null : b - ceiling;
        return { set: true, ceiling: ceiling, diff: diff, over: diff !== null && diff > 0 };
    } catch (e) {
        return { set: false };
    }
};

BFShared.matchDeskDeclaration = function (rows, vvd, pol) {
    var v, p, port, found = [], exact = [], i, r, key, parsed, rowPort;
    try {
        v = BFShared.normalizeVvd(decisionCard_text(vvd));
        p = BFShared.normalizeVvd(decisionCard_text(pol));
        if (Object.prototype.toString.call(rows) !== '[object Array]' || v === '' || p === '') return { state: 'none', row: null };
        port = decisionCard_YARD_PATTERN.test(p) ? p.slice(0, 5) : p;
        for (i = 0; i < rows.length; i++) {
            r = rows[i];
            if (!decisionCard_isObject(r)) continue;
            if (BFShared.normalizeVvd(decisionCard_text(r.vvd)) !== v) continue;
            key = BFShared.normalizeVvd(decisionCard_text(r.port_key));
            parsed = key ? BFShared.parsePortKey(key) : null;
            rowPort = BFShared.normalizeVvd(decisionCard_text(r.port));
            if (rowPort !== p && rowPort !== port && !(parsed && (parsed.pol === p || parsed.pol === port))) continue;
            found.push(r);
            if (BFShared.normalizeVvd(decisionCard_text(r.terminal)) === p) exact.push(r);
        }
        if (exact.length === 1) return { state: 'ok', row: exact[0] };
        if (found.length === 0) return { state: 'none', row: null };
        // One candidate at the port, but for another terminal than this yard: not this call's declaration.
        if (found.length === 1 && !(port !== p && BFShared.normalizeVvd(decisionCard_text(found[0].terminal)) !== '')) return { state: 'ok', row: found[0] };
        return { state: 'unmatched', row: null };
    } catch (e) {
        return { state: 'none', row: null };
    }
};

BFShared.declarationAge = function (asOf, nowMs, cutoff) {
    var t, ageMs, stale, c;
    try {
        t = decisionCard_timeMs(asOf);
        if (t === null || typeof nowMs !== 'number' || !isFinite(nowMs)) return null;
        ageMs = nowMs - t;
        stale = ageMs > decisionCard_DAY_MS;
        c = typeof cutoff === 'string' ? decisionCard_dayMs(cutoff.replace(/^\s+|\s+$/g, '')) : null;
        if (c !== null && nowMs > c - 2 * decisionCard_DAY_MS) stale = true;
        return { ageMs: ageMs, stale: stale };
    } catch (e) {
        return null;
    }
};

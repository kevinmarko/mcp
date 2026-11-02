// Threshold health and threshold changes (roadmap Phase 1, slice 1-B). Four pure functions:
//   BFShared.thresholdValue(v)                         -> a number, or null when the threshold is "not set"
//   BFShared.findMissingThresholds(rows)               -> { sailings, ports, count }
//   BFShared.diffThresholds(prevRows, curRows)         -> [{ vvd, pol, lane, kind, prev, cur }]
//   BFShared.thresholdChangesOverDays(days)            -> [{ vvd, pol, lane, kind, prev, cur, firstSeen }]
//
// INPUT. One neutral record per sailing-port (one POL row): { vvd, pol, lane, overall, loading }. The app maps
// overall to the trunk threshold (the MCT Overall Threshold, standbyRaw "Trunk Threshold") and loading to the
// POL Laden Threshold. The overall threshold belongs to the sailing (every port row of a VVD carries the same
// one); the loading threshold belongs to the sailing-port. A record that is not an object, or whose VVD is blank
// or the VMS placeholder (BFShared.isRealVvd), is skipped. vvd is normalised with BFShared.normalizeVvd and pol by
// trim and upper case.
//
// NOT SET. A threshold is "not set" (thresholdValue answers null) when it is missing, blank, not numeric, NaN,
// or one of the placeholders 0 and 0.01 (compared with a tolerance of 1e-9; decision D2). A finite number and a
// plain numeric string (' 1.2 ') are accepted; a string ending in '%' is a percent ('150%' is 1.5). An object is
// never coerced: a boxed number, an array and an object with a valueOf are all "not set".
//
// findMissingThresholds. sailings: the distinct VVDs whose overall threshold is not set on every one of their rows
// (if ANY row of the sailing has a set value the sailing counts as set), { vvd, lane }. ports: the distinct
// (vvd, pol) whose loading threshold is not set on every one of their rows, { vvd, pol, lane }. count: the number
// of distinct (vvd, pol) sailing-ports whose sailing has no overall threshold OR whose own loading threshold is
// not set (the banner's "N sailing-ports have no threshold"). lane is the sailing's first non-blank lane. Everything is sorted by vvd then pol. A non-array
// gives { sailings: [], ports: [], count: 0 }.
//
// diffThresholds. What changed between two days, for things present on BOTH days: an overall threshold per VVD
// (pol is '' in the output) and a loading threshold per (vvd, pol). A change is a different thresholdValue: null
// against a number counts, two numbers within 1e-9 do not. prev and cur are numbers or null. lane is today's.
// Sorted by vvd, then kind ('overall' first), then pol. A non-array day counts as empty.
//
// thresholdChangesOverDays. days is [{ date: 'YYYY-MM-DD', rows }] in any order. Entries whose date is not a real
// calendar day (feedAge_isCalendarDate), whose rows are not an array, or that are not objects are ignored; two
// entries with the same date are one day (their rows are joined). The days are sorted by date and each
// consecutive pair is diffed; every change event is one entry with firstSeen set to the LATER date of the pair
// (a threshold that changes on three days is three entries, never merged). Sorted by firstSeen, latest first, then
// in diffThresholds order. Fewer than two usable days gives [].
//
// None of them reads a clock or any global but the ES5 built-ins; none throws.

var thresholdDiff_EPSILON = 1e-9;
var thresholdDiff_NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function thresholdDiff_trim(s) {
    return s.replace(/^\s+|\s+$/g, '');
}

// A plain object or class instance, not null, an array or a primitive. (Not typeof: the build compiles a
// typeof test against 'object' with a helper function, and the shared region may add no top-level name.)
function thresholdDiff_isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
}

function thresholdDiff_cmp(a, b) {
    return a < b ? -1 : (a > b ? 1 : 0);
}

BFShared.thresholdValue = function (v) {
    var n, s, percent;
    if (typeof v === 'number') {
        n = v;
    } else if (typeof v === 'string') {
        s = thresholdDiff_trim(v);
        percent = s.length > 0 && s.charAt(s.length - 1) === '%';
        if (percent) s = thresholdDiff_trim(s.slice(0, s.length - 1));
        if (!thresholdDiff_NUMBER_PATTERN.test(s)) return null;
        n = parseFloat(s);
        if (percent) n = n / 100;
    } else {
        return null;
    }
    if (!isFinite(n)) return null;
    if (Math.abs(n) < thresholdDiff_EPSILON || Math.abs(n - 0.01) < thresholdDiff_EPSILON) return null;
    return n;
};

// A vvd or pol as normalised text. Only a string or a number is text; anything else (an object, which
// String() could throw on or turn into '[object Object]') is blank.
function thresholdDiff_text(v) {
    return (typeof v === 'string' || typeof v === 'number') ? BFShared.normalizeVvd(v) : '';
}

// The records this module reads, as { vvd, pol, lane, overall, loading } with the thresholds already turned into
// number-or-null, in input order. Skips records that are not objects and VMS placeholder VVDs.
function thresholdDiff_clean(rows) {
    var out = [];
    var i, r, vvd;
    if (!Array.isArray(rows)) return out;
    for (i = 0; i < rows.length; i++) {
        r = rows[i];
        if (!thresholdDiff_isObject(r)) continue;
        vvd = thresholdDiff_text(r.vvd);
        if (!BFShared.isRealVvd(vvd)) continue;
        out.push({
            vvd: vvd,
            pol: thresholdDiff_text(r.pol),
            lane: typeof r.lane === 'string' ? thresholdDiff_trim(r.lane) : '',
            overall: BFShared.thresholdValue(r.overall),
            loading: BFShared.thresholdValue(r.loading)
        });
    }
    return out;
}

// One day as two lookups: sailings by vvd ({ vvd, lane, overall }) and ports by vvd + newline + pol
// ({ vvd, pol, loading }); a port's lane is its sailing's. overall and loading are the first set value seen, else null. Keys carry a
// prefix so no VVD can collide with an inherited property name.
function thresholdDiff_index(rows) {
    var sailings = {};
    var ports = {};
    var list = thresholdDiff_clean(rows);
    var i, r, s, p, sk, pk;
    for (i = 0; i < list.length; i++) {
        r = list[i];
        sk = 'v' + r.vvd;
        pk = 'p' + r.vvd + '\n' + r.pol;
        s = sailings[sk];
        if (!s) { s = sailings[sk] = { vvd: r.vvd, lane: r.lane, overall: null }; }
        if (s.lane === '' && r.lane !== '') s.lane = r.lane;
        if (s.overall === null) s.overall = r.overall;
        p = ports[pk];
        if (!p) { p = ports[pk] = { vvd: r.vvd, pol: r.pol, loading: null }; }
        if (p.loading === null) p.loading = r.loading;
    }
    return { sailings: sailings, ports: ports };
}

function thresholdDiff_values(map) {
    var out = [];
    var k;
    for (k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
    }
    return out;
}

BFShared.findMissingThresholds = function (rows) {
    var idx = thresholdDiff_index(rows);
    var sailings = [];
    var ports = [];
    var count = 0;
    var all = thresholdDiff_values(idx.ports);
    var i, p, s;
    thresholdDiff_values(idx.sailings).forEach(function (x) {
        if (x.overall === null) sailings.push({ vvd: x.vvd, lane: x.lane });
    });
    for (i = 0; i < all.length; i++) {
        p = all[i];
        s = idx.sailings['v' + p.vvd];
        if (p.loading === null) ports.push({ vvd: p.vvd, pol: p.pol, lane: s.lane });
        if (s.overall === null || p.loading === null) count++;
    }
    sailings.sort(function (a, b) { return thresholdDiff_cmp(a.vvd, b.vvd); });
    ports.sort(function (a, b) { return thresholdDiff_cmp(a.vvd, b.vvd) || thresholdDiff_cmp(a.pol, b.pol); });
    return { sailings: sailings, ports: ports, count: count };
};

// True when two thresholdValue answers differ: null against a number, or two numbers further apart than 1e-9.
function thresholdDiff_differs(a, b) {
    if (a === null || b === null) return a !== b;
    return Math.abs(a - b) > thresholdDiff_EPSILON;
}

BFShared.diffThresholds = function (prevRows, curRows) {
    var prev = thresholdDiff_index(prevRows);
    var cur = thresholdDiff_index(curRows);
    var out = [];
    var k, a, b;
    for (k in cur.sailings) {
        if (!Object.prototype.hasOwnProperty.call(cur.sailings, k) || !Object.prototype.hasOwnProperty.call(prev.sailings, k)) continue;
        a = prev.sailings[k];
        b = cur.sailings[k];
        if (thresholdDiff_differs(a.overall, b.overall)) out.push({ vvd: b.vvd, pol: '', lane: b.lane, kind: 'overall', prev: a.overall, cur: b.overall });
    }
    for (k in cur.ports) {
        if (!Object.prototype.hasOwnProperty.call(cur.ports, k) || !Object.prototype.hasOwnProperty.call(prev.ports, k)) continue;
        a = prev.ports[k];
        b = cur.ports[k];
        if (thresholdDiff_differs(a.loading, b.loading)) out.push({ vvd: b.vvd, pol: b.pol, lane: cur.sailings['v' + b.vvd].lane, kind: 'loading', prev: a.loading, cur: b.loading });
    }
    out.sort(function (x, y) {
        return thresholdDiff_cmp(x.vvd, y.vvd) ||
            thresholdDiff_cmp(x.kind === 'overall' ? 0 : 1, y.kind === 'overall' ? 0 : 1) ||
            thresholdDiff_cmp(x.pol, y.pol);
    });
    return out;
};

BFShared.thresholdChangesOverDays = function (days) {
    var byDate = {};
    var dates = [];
    var out = [];
    var i, d, j, pair, changes, e, key;
    if (!Array.isArray(days)) return out;
    for (i = 0; i < days.length; i++) {
        d = days[i];
        if (!thresholdDiff_isObject(d) || !feedAge_isCalendarDate(d.date) || !Array.isArray(d.rows)) continue;
        key = 'd' + d.date;
        if (!Object.prototype.hasOwnProperty.call(byDate, key)) { byDate[key] = []; dates.push(d.date); }
        byDate[key] = byDate[key].concat(d.rows);
    }
    dates.sort();
    for (j = dates.length - 1; j >= 1; j--) {
        pair = BFShared.diffThresholds(byDate['d' + dates[j - 1]], byDate['d' + dates[j]]);
        for (e = 0; e < pair.length; e++) {
            changes = pair[e];
            out.push({ vvd: changes.vvd, pol: changes.pol, lane: changes.lane, kind: changes.kind, prev: changes.prev, cur: changes.cur, firstSeen: dates[j] });
        }
    }
    return out;
};

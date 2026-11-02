// The "what changed since the last day on file" summary (roadmap slice 2.3, spec docs/specs/2.3-what-changed-banner.md,
// D82). Two functions, both pure:
//   BFShared.summarizeChanges(prevRows, curRows, opts)  -> the summary the banner draws (and a later morning brief can reuse)
//   BFShared.formatChangeDate(prevDate, curDate)        -> 'Fri 8/28', or 'Wed 8/19 (9 days earlier)', or ''
//
// INPUT. prevRows and curRows are the same neutral port-row records BFShared.diffSailings takes
// ({ vvd, lane, saleWeek, pol, laden, booking, util }), one array per day; the comparison itself IS diffSailings,
// so every class below means exactly what it means there (see shared/10_diff_sailings.js).
// opts (all optional): movedTeu (default 100, a sailing "moved" when its laden changed by at least this much),
// laneDownPct (default 5) and laneDownTeu (default 100): a lane is "down" when the laden of its sailings present on
// both days fell by at least laneDownPct percent AND by at least laneDownTeu TEU (the TEU floor keeps a small lane
// whose 40 TEU became 30 out of the headline). maxNamed (default 3): removed VVDs named inline before "+N more".
//
// OUTPUT. A plain object:
//   { comparable, state, removed, moved, arrived, lanesDown, rolledOut, rolledIn, signature, clauses }
// comparable  false when either day has no real sailing (diffSailings' noBaseline / noCurrent); state is then
//             'unavailable', every list is empty and clauses is [] (the banner draws nothing: a comparison with an
//             empty day is not a summary of anything).
// state       'changes' when any clause other than the rollover has a count, otherwise 'none' ("no material
//             change", which may still carry the rollover clause).
// removed     diffSailings' removed, as given (sorted by VVD). ALWAYS reported, whatever the thresholds.
// moved       the changed sailings whose laden moved by movedTeu or more: { vvd, lane, saleWeek, ladenPrev,
//             ladenCur, ladenDelta, utilPrev, utilCur }, largest |ladenDelta| first, then by VVD.
// arrived     diffSailings' arrived ("newly nominated": a sailing that appeared while its sale week was already in
//             the window), sorted by VVD.
// lanesDown   [{ lane, ladenPrev, ladenCur, pct }], pct to one decimal, steepest fall first, then by lane. Only
//             sailings present on both days with a known laden on both days count, judged under today's lane.
// rolledOut, rolledIn  the COUNTS of diffSailings' rolledOut / rolledIn (the routine Monday rollover; never removed).
// signature   the removed VVDs joined with ',' (the banner's dismissal key: a newly removed sailing changes it).
// clauses     [{ kind, text }] in display order, each clause with a zero count left out:
//               removed  '1 sailing removed (WAHT0613W)' / '5 sailings removed (A, B, C, +2 more)'
//               moved    '12 sailings moved 100+ TEU'
//               arrived  '2 newly nominated'
//               laneDown '1 lane down' / '3 lanes down'
//               rollover 'sale week rolled over: 24 out, 23 in'
// Never throws for a non-array day (it counts as empty, as in diffSailings).

var whatChanged_DEFAULTS = { movedTeu: 100, laneDownPct: 5, laneDownTeu: 100, maxNamed: 3 };

// A usable non-negative option, or the default.
function whatChanged_opt(opts, name) {
    var v = opts == null ? null : diffSailings_num(opts[name]);
    return v !== null && v >= 0 ? v : whatChanged_DEFAULTS[name];
}

function whatChanged_plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
}

// Rounds to one decimal without the 1.005-style float surprise for the values this sees (percentages).
function whatChanged_round1(x) {
    return Math.round(x * 10) / 10 + 0;
}

function whatChanged_byAbsDelta(a, b) {
    var d = Math.abs(b.ladenDelta) - Math.abs(a.ladenDelta);
    if (d !== 0) return d;
    return diffSailings_cmp(a.vvd, b.vvd);
}

function whatChanged_byPct(a, b) {
    if (a.pct !== b.pct) return a.pct - b.pct;
    return diffSailings_cmp(a.lane, b.lane);
}

// Lanes whose continuing sailings' laden fell by both thresholds. prev and cur are diffSailings_day results.
function whatChanged_lanesDown(prev, cur, pctMin, teuMin) {
    var totals = Object.create(null);
    var lanes = [];
    var out = [];
    var i, b, a, t, drop, pct;
    for (i = 0; i < cur.order.length; i++) {
        b = cur.map[cur.order[i]];
        a = prev.map[b.vvd];
        if (!a || a.laden === null || b.laden === null || b.lane === '') continue;
        t = totals[b.lane];
        if (!t) {
            t = { prev: 0, cur: 0 };
            totals[b.lane] = t;
            lanes.push(b.lane);
        }
        t.prev += a.laden;
        t.cur += b.laden;
    }
    for (i = 0; i < lanes.length; i++) {
        t = totals[lanes[i]];
        t.prev = diffSailings_clean(t.prev);
        t.cur = diffSailings_clean(t.cur);
        if (!(t.prev > 0)) continue;
        drop = t.prev - t.cur;
        pct = whatChanged_round1((t.cur - t.prev) / t.prev * 100);
        if (drop >= teuMin && drop / t.prev * 100 >= pctMin) {
            out.push({ lane: lanes[i], ladenPrev: t.prev, ladenCur: t.cur, pct: pct });
        }
    }
    out.sort(whatChanged_byPct);
    return out;
}

BFShared.summarizeChanges = function (prevRows, curRows, opts) {
    var movedTeu = whatChanged_opt(opts, 'movedTeu');
    var maxNamed = Math.floor(whatChanged_opt(opts, 'maxNamed'));
    var diff = BFShared.diffSailings(prevRows, curRows, { movedTeu: movedTeu });
    var result = {
        comparable: !(diff.noBaseline || diff.noCurrent),
        state: 'unavailable',
        removed: [],
        moved: [],
        arrived: [],
        lanesDown: [],
        rolledOut: 0,
        rolledIn: 0,
        signature: '',
        clauses: []
    };
    var i, c, names, vvds;
    if (!result.comparable) return result;

    result.removed = diff.removed;
    result.arrived = diff.arrived;
    result.rolledOut = diff.rolledOut.length;
    result.rolledIn = diff.rolledIn.length;
    for (i = 0; i < diff.changed.length; i++) {
        c = diff.changed[i];
        if (!c.moved) continue;
        result.moved.push({
            vvd: c.vvd, lane: c.lane, saleWeek: c.saleWeek, ladenPrev: c.ladenPrev, ladenCur: c.ladenCur,
            ladenDelta: c.ladenDelta, utilPrev: c.utilPrev, utilCur: c.utilCur
        });
    }
    result.moved.sort(whatChanged_byAbsDelta);
    result.lanesDown = whatChanged_lanesDown(diffSailings_day(prevRows), diffSailings_day(curRows),
        whatChanged_opt(opts, 'laneDownPct'), whatChanged_opt(opts, 'laneDownTeu'));

    vvds = [];
    for (i = 0; i < result.removed.length; i++) vvds.push(result.removed[i].vvd);
    result.signature = vvds.join(',');

    if (vvds.length > 0) {
        names = vvds.slice(0, maxNamed);
        if (vvds.length > maxNamed) names.push('+' + (vvds.length - maxNamed) + ' more');
        result.clauses.push({ kind: 'removed', text: whatChanged_plural(vvds.length, 'sailing', 'sailings') + ' removed (' + names.join(', ') + ')' });
    }
    if (result.moved.length > 0) {
        result.clauses.push({ kind: 'moved', text: whatChanged_plural(result.moved.length, 'sailing', 'sailings') + ' moved ' + movedTeu + '+ TEU' });
    }
    if (result.arrived.length > 0) {
        result.clauses.push({ kind: 'arrived', text: result.arrived.length + ' newly nominated' });
    }
    if (result.lanesDown.length > 0) {
        result.clauses.push({ kind: 'laneDown', text: whatChanged_plural(result.lanesDown.length, 'lane', 'lanes') + ' down' });
    }
    result.state = result.clauses.length > 0 ? 'changes' : 'none';
    if (result.rolledOut > 0 || result.rolledIn > 0) {
        result.clauses.push({ kind: 'rollover', text: 'sale week rolled over: ' + result.rolledOut + ' out, ' + result.rolledIn + ' in' });
    }
    return result;
};

// 'YYYY-MM-DD' -> days since 1970-01-01 (proleptic Gregorian), or null when it is not a real calendar day. Plain
// integer arithmetic (the days-from-civil algorithm), so no Date and no time zone is involved.
function whatChanged_dayNumber(s) {
    var m, y, mo, d, era, yoe, doy, doe;
    if (typeof s !== 'string') return null;
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    y = parseInt(m[1], 10);
    mo = parseInt(m[2], 10);
    d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > whatChanged_monthDays(y, mo)) return null;
    y -= mo <= 2 ? 1 : 0;
    era = Math.floor(y / 400);
    yoe = y - era * 400;
    doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

function whatChanged_monthDays(y, mo) {
    if (mo === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
    return mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31;
}

var whatChanged_WEEKDAYS = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];

// The banner's baseline date: weekday, then month/day with no leading zeros and no year ('Fri 8/28'). When curDate
// is a valid date more than 3 days after prevDate, ' (N days earlier)' follows. '' when prevDate is not a real
// 'YYYY-MM-DD' day. 1970-01-01 (day 0) was a Thursday, hence the table's order.
BFShared.formatChangeDate = function (prevDate, curDate) {
    var p = whatChanged_dayNumber(prevDate);
    var c = whatChanged_dayNumber(curDate);
    var wd, text;
    if (p === null) return '';
    wd = whatChanged_WEEKDAYS[((p % 7) + 7) % 7];
    text = wd + ' ' + parseInt(prevDate.slice(5, 7), 10) + '/' + parseInt(prevDate.slice(8, 10), 10);
    if (c !== null && c - p > 3) text += ' (' + (c - p) + ' days earlier)';
    return text;
};

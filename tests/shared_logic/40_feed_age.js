'use strict';
/**
 * Behaviour checks for BFShared.formatAge, BFShared.feedFreshness and BFShared.previousAvailableDate
 * (roadmap slices 1.1 and 2.2; shared/40_feed_age.js).
 *
 * How the three are pinned:
 *  - Tables list the exact threshold of every branch and the value on either side of it (the value one
 *    millisecond below, the value itself, one above), written out by hand.
 *  - Sweeps check a whole range against an ORACLE written differently from the code under test: formatAge
 *    against integer minute arithmetic (plus the largest double below each minute boundary, where a
 *    division that rounded would show), previousAvailableDate against the host's own Date calendar
 *    (every day from 1899 to 2101, and every year/month/day shape in the century range that matters).
 *    The host Date is the oracle here ONLY; the shared code never touches one (see the purity tests).
 *  - Hostile inputs (NaN, infinities, numeric strings, null, objects, symbols, BigInt, boxed numbers, an
 *    object whose valueOf and toString throw) must give the documented "no answer" and must never be
 *    coerced or throw.
 *  - Real data: the dates of the committed 9-day history (tests/lib/history_days.js) are the archive index
 *    the date function is asked about, including a weekday-only version of it (the weekend gap).
 *  - Purity: the three are called with the shared realm's Date and Math.random made to throw.
 *
 * ctx.BFShared lives in another vm realm, so results are compared through ctx.t (canonical JSON) or as
 * primitives. The three functions are called through local aliases: this module must not define a name
 * shared/ exports (tests/check_shared_sync.js check E).
 */
const fs = require('fs');
const path = require('path');

exports.TESTS = ['formatAge', 'feedFreshness', 'previousAvailableDate', 'freshnessLabel'];
exports.COUNT = 39;
exports.run = function (ctx) {
    const { BFShared, t, history } = ctx;
    const age = (ms) => BFShared.formatAge(ms);
    const fresh = (a, b) => { const r = BFShared.feedFreshness(a, b); return { level: r.level, staleAfterMs: r.staleAfterMs }; };
    const prev = (d, a) => BFShared.previousAvailableDate(d, a);

    const MIN = 60000;
    const HOUR = 3600000;
    const DAY = 86400000;

    // The largest double below x (x positive): the hardest value just under a boundary.
    const f64 = new Float64Array(1);
    const u64 = new BigUint64Array(f64.buffer);
    const nextDown = (x) => { f64[0] = x; u64[0] -= 1n; return f64[0]; };
    const nextUp = (x) => { f64[0] = x; u64[0] += 1n; return f64[0]; };

    // An object that fails loudly if anything coerces it to a primitive.
    const boom = { valueOf() { throw new Error('valueOf was called'); }, toString() { throw new Error('toString was called'); } };
    // Runs fn and reports a throw as a value, so a throwing implementation fails an assertion instead of the module.
    const safe = (fn) => { try { return fn(); } catch (e) { return `THREW: ${e && e.message}`; } };
    const show = (v) => {
        if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}... (${v.length} chars)` : v);
        if (typeof v === 'symbol' || typeof v === 'bigint' || typeof v === 'function') return String(typeof v);
        if (v && typeof v === 'object') return Object.prototype.toString.call(v);
        return Object.is(v, -0) ? '-0' : String(v);
    };
    // JSON that keeps NaN and the infinities apart from null (plain JSON.stringify turns all of them into null).
    const J = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x));
    // For a table of [input..., expected]: the rows whose answer differs, described, so a failure names them.
    const badRows = (rows, run) => rows.map((row) => ({ row, got: safe(() => run(row)) }))
        .filter(({ row, got }) => J(got) !== J(row[row.length - 1]))
        .map(({ row, got }) => `${row.slice(0, -1).map(show).join(', ')} -> ${J(got)} (want ${J(row[row.length - 1])})`);

    // ================================================================================================
    // formatAge
    // ================================================================================================
    // [ageMs, phrase]: the threshold of every branch and one either side of it.
    const AGE_TABLE = [
        [0, 'just now'], [-0, 'just now'], [1, 'just now'], [999, 'just now'], [30000, 'just now'], [59999, 'just now'], [59999.9, 'just now'], [nextDown(MIN), 'just now'],
        [MIN, '1 min ago'], [MIN + 1, '1 min ago'], [90000, '1 min ago'], [2 * MIN - 1, '1 min ago'], [2 * MIN, '2 min ago'], [16 * MIN, '16 min ago'],
        [30 * MIN, '30 min ago'], [59 * MIN, '59 min ago'], [HOUR - 1, '59 min ago'], [HOUR - 0.001, '59 min ago'], [nextDown(HOUR), '59 min ago'],
        [HOUR, '1 h ago'], [HOUR + 1, '1 h ago'], [HOUR + MIN - 1, '1 h ago'], [HOUR + MIN, '1 h 1 min ago'], [HOUR + MIN + 1, '1 h 1 min ago'],
        [HOUR + 2 * MIN, '1 h 2 min ago'], [2 * HOUR - 1, '1 h 59 min ago'], [2 * HOUR, '2 h ago'], [2 * HOUR + 5 * MIN, '2 h 5 min ago'],
        [12 * HOUR, '12 h ago'], [23 * HOUR, '23 h ago'], [23 * HOUR + MIN, '23 h 1 min ago'], [DAY - MIN, '23 h 59 min ago'], [DAY - 1, '23 h 59 min ago'],
        [DAY - 0.001, '23 h 59 min ago'], [nextDown(DAY), '23 h 59 min ago'],
        [DAY, '1 day ago'], [DAY + 1, '1 day ago'], [DAY + HOUR, '1 day ago'], [2 * DAY - 1, '1 day ago'], [nextDown(2 * DAY), '1 day ago'],
        [2 * DAY, '2 days ago'], [2 * DAY + 1, '2 days ago'], [3 * DAY, '3 days ago'], [7 * DAY, '7 days ago'], [31 * DAY, '31 days ago'], [365 * DAY, '365 days ago'],
        [1e15, '11574074 days ago'],
    ];
    t('formatAge: every threshold and the value on either side of it (just now / min / h / h and min / day / days)',
        { rows: AGE_TABLE.length, bad: badRows(AGE_TABLE, ([ms]) => age(ms)) }, { rows: 47, bad: [] });

    // Every whole minute of 40 days against integer arithmetic: the start of the minute, 59.999 s into it, 59999 ms
    // into it, and the largest double below the next minute (so the answer must still be this minute).
    const minuteOracle = (m) => {
        if (m < 1) return 'just now';
        if (m < 60) return `${m} min ago`;
        if (m < 1440) return m % 60 === 0 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
        return Math.floor(m / 1440) === 1 ? '1 day ago' : `${Math.floor(m / 1440)} days ago`;
    };
    const sweep = { checked: 0, bad: [] };
    for (let m = 0; m <= 40 * 1440; m++) {
        const want = minuteOracle(m);
        for (const ms of [m * MIN, m * MIN + 59999, m * MIN + 59999.999, nextDown((m + 1) * MIN)]) {
            sweep.checked++;
            const got = safe(() => age(ms));
            if (got !== want && sweep.bad.length < 5) sweep.bad.push(`${ms} -> ${got} (want ${want})`);
            else if (got !== want) sweep.bad.push('...');
        }
    }
    t('formatAge: all 57,601 minutes of 40 days, at four points each (start, 59999 ms in, 59999.999 ms in, the largest double below the next minute), equal integer-minute arithmetic',
        sweep, { checked: 230404, bad: [] });

    // Not a finite number, or below zero: '' (the caller shows nothing).
    const HOSTILE_AGES = [NaN, Infinity, -Infinity, -1, -0.001, -MIN, -1e308, -Number.MAX_VALUE, -Number.MIN_VALUE, '5', '60000', '', ' ', '1e3', null, undefined, true, false,
        {}, [], [60000], { valueOf: () => 60000 }, new Number(60000), Object(5), () => 5, Symbol('x'), BigInt(60000), boom];
    t('formatAge: hostile input gives the empty string and never throws (NaN, both infinities, negatives, numeric strings, null, undefined, booleans, objects, arrays, a boxed number, a function, a symbol, a BigInt, an object that throws if coerced)',
        { rows: HOSTILE_AGES.length, bad: HOSTILE_AGES.map((v) => [v, ''])
            .map((row) => ({ row, got: safe(() => age(row[0])) })).filter(({ got }) => got !== '').map(({ row, got }) => `${show(row[0])} -> ${JSON.stringify(got)}`) },
        { rows: 28, bad: [] });
    t('formatAge: called with no argument it gives the empty string',
        safe(() => BFShared.formatAge()), '');

    // Large finite ages stay a string and never throw. At 1e21 whole days or more JavaScript prints the number in exponent notation.
    t('formatAge: very large ages are still one string ending in " days ago" (1e15 ms is 11574074 days; 1e308 and the largest double come out in exponent notation), and never throw',
        { fifteen: age(1e15), huge: [1e308, Number.MAX_VALUE].map((x) => /^[0-9.]+e\+[0-9]+ days ago$/.test(safe(() => age(x)))) },
        { fifteen: '11574074 days ago', huge: [true, true] });
    t('formatAge: it answers a string for every input, the same one every time, whatever its type',
        (() => {
            const inputs = HOSTILE_AGES.concat(AGE_TABLE.map((r) => r[0]), [1e308, Number.MAX_VALUE, Number.MIN_VALUE]);
            return inputs.filter((x) => { const a = safe(() => age(x)); return typeof a !== 'string' || a.indexOf('THREW') === 0 || a !== safe(() => age(x)); }).map(show);
        })(), []);

    // ================================================================================================
    // feedFreshness
    // ================================================================================================
    const DEFAULT_STALE = 2 * HOUR;
    // With no (usable) interval the threshold is 2 x 60 minutes. [age, level]
    const FRESH_DEFAULT = [
        [0, 'fresh'], [-0, 'fresh'], [1, 'fresh'], [30 * MIN, 'fresh'], [HOUR, 'fresh'], [DEFAULT_STALE - 1, 'fresh'], [nextDown(DEFAULT_STALE), 'fresh'],
        [DEFAULT_STALE, 'fresh'], [nextUp(DEFAULT_STALE), 'stale'], [DEFAULT_STALE + 0.001, 'stale'], [DEFAULT_STALE + 1, 'stale'], [3 * HOUR, 'stale'], [DAY, 'stale'], [1e308, 'stale'],
        [Number.MIN_VALUE, 'fresh'],
        [NaN, 'unknown'], [Infinity, 'unknown'], [-Infinity, 'unknown'], [-1, 'unknown'], [-0.001, 'unknown'], [-Number.MIN_VALUE, 'unknown'], [-1e308, 'unknown'],
        ['5', 'unknown'], ['7200001', 'unknown'], ['', 'unknown'], [null, 'unknown'], [undefined, 'unknown'], [true, 'unknown'], [false, 'unknown'], [{}, 'unknown'], [[], 'unknown'],
        [[7200001], 'unknown'], [new Number(7200001), 'unknown'], [{ valueOf: () => 7200001 }, 'unknown'], [Symbol('x'), 'unknown'], [BigInt(7200001), 'unknown'], [boom, 'unknown'],
    ];
    t('feedFreshness: with the default interval the threshold is 7,200,000 ms: fresh up to and including it, stale strictly above it (one ulp above is stale), unknown for anything that is not a finite number of at least zero; staleAfterMs is always 7,200,000',
        { rows: FRESH_DEFAULT.length, bad: badRows(FRESH_DEFAULT.map(([a, l]) => [a, { level: l, staleAfterMs: DEFAULT_STALE }]), ([a]) => fresh(a)) }, { rows: 37, bad: [] });

    // An explicit interval: [interval, age, level, staleAfterMs]
    const FRESH_EXPLICIT = [
        [30 * MIN, 0, 'fresh', HOUR], [30 * MIN, HOUR - 1, 'fresh', HOUR], [30 * MIN, HOUR, 'fresh', HOUR], [30 * MIN, HOUR + 1, 'stale', HOUR], [30 * MIN, 2 * HOUR, 'stale', HOUR],
        [HOUR, DEFAULT_STALE, 'fresh', DEFAULT_STALE], [HOUR, DEFAULT_STALE + 1, 'stale', DEFAULT_STALE],
        [2 * HOUR, 4 * HOUR, 'fresh', 4 * HOUR], [2 * HOUR, 4 * HOUR + 1, 'stale', 4 * HOUR], [2 * HOUR, DEFAULT_STALE + 1, 'fresh', 4 * HOUR],
        [1, 2, 'fresh', 2], [1, 2.5, 'stale', 2], [0.5, 1, 'fresh', 1], [0.5, 1.5, 'stale', 1], [1800000.5, 3600001, 'fresh', 3600001], [1800000.5, 3600001.5, 'stale', 3600001],
        [Number.MIN_VALUE, 0, 'fresh', 2 * Number.MIN_VALUE], [Number.MIN_VALUE, 1, 'stale', 2 * Number.MIN_VALUE],
        [1e308, 1e308, 'fresh', Infinity], [Number.MAX_VALUE, Number.MAX_VALUE, 'fresh', Infinity], [Number.MAX_VALUE / 4, Number.MAX_VALUE, 'stale', Number.MAX_VALUE / 2],
        [1e308, NaN, 'unknown', Infinity], [30 * MIN, NaN, 'unknown', HOUR], [30 * MIN, -1, 'unknown', HOUR], [30 * MIN, Infinity, 'unknown', HOUR],
    ];
    t('feedFreshness: an interval that is a finite number above zero sets the threshold to twice it (also fractions, the smallest positive double and values that overflow to Infinity); strictly above is stale, equal is fresh',
        { rows: FRESH_EXPLICIT.length, bad: badRows(FRESH_EXPLICIT.map(([i, a, l, s]) => [i, a, { level: l, staleAfterMs: s }]), ([i, a]) => fresh(a, i)) }, { rows: 25, bad: [] });

    // An interval that is not a finite number above zero falls back to 60 minutes.
    const BAD_INTERVALS = [0, -0, -1, -HOUR, -Number.MIN_VALUE, -1e308, NaN, Infinity, -Infinity, '1800000', '', ' ', null, undefined, true, false, {}, [], [1800000],
        new Number(1800000), { valueOf: () => 1800000 }, () => 1800000, Symbol('x'), BigInt(1800000), boom];
    t('feedFreshness: an interval that is zero, negative, NaN, an infinity, a numeric string, null, undefined, a boolean, an object, a boxed number, a function, a symbol, a BigInt or an object that throws if coerced is ignored: the 60-minute default applies (threshold 7,200,000), for a fresh age and a stale one',
        { rows: BAD_INTERVALS.length, bad: BAD_INTERVALS.flatMap((i) => [[i, HOUR, 'fresh'], [i, DEFAULT_STALE + 1, 'stale'], [i, NaN, 'unknown']].map(([iv, a, l]) => ({ iv, a, l, got: safe(() => fresh(a, iv)) }))
            .filter(({ l, got }) => JSON.stringify(got) !== JSON.stringify({ level: l, staleAfterMs: DEFAULT_STALE }))
            .map(({ iv, a, got }) => `interval ${show(iv)}, age ${show(a)} -> ${JSON.stringify(got)}`)) },
        { rows: 25, bad: [] });
    t('feedFreshness: called with no arguments it is unknown with the default threshold',
        safe(() => fresh()), { level: 'unknown', staleAfterMs: DEFAULT_STALE });

    // Around the threshold of several intervals, including the doubles on either side of it, against the plain rule.
    const around = { checked: 0, bad: [] };
    for (const iv of [1, 0.5, 1000, 59999, MIN, 30 * MIN, HOUR, 90 * MIN, 2 * HOUR, DAY, 1e9, 123456789.123, 1e15]) {
        const s = 2 * iv;
        for (const a of [0, s / 2, nextDown(s), s - 0.25, s, nextUp(s), s + 0.25, s * 1.0000001, s + 1, 10 * s]) {
            around.checked++;
            const want = a > s ? 'stale' : 'fresh';
            const got = safe(() => fresh(a, iv));
            if (got.level !== want || got.staleAfterMs !== s) around.bad.push(`interval ${iv}, age ${a} -> ${JSON.stringify(got)} (want ${want}, ${s})`);
        }
    }
    t('feedFreshness: 13 intervals times 10 ages around the threshold (the double below it, it, the double above it) follow "stale only strictly above twice the interval"',
        around, { checked: 130, bad: [] });

    // Shape: exactly two keys, a new object every call, level from a fixed set.
    const shapeProblems = [];
    {
        const a = BFShared.feedFreshness(1, HOUR);
        const b = BFShared.feedFreshness(1, HOUR);
        if (a === b) shapeProblems.push('the same object came back twice');
        a.level = 'changed';
        a.extra = 1;
        if (BFShared.feedFreshness(1, HOUR).level !== 'fresh') shapeProblems.push('a caller changing a result changed the next result');
        if (Object.keys(b).sort().join() !== 'level,staleAfterMs') shapeProblems.push(`keys: ${Object.keys(b).sort().join()}`);
        [0, HOUR, 3 * HOUR, NaN, -1, '5', null, 1e308].forEach((x) => {
            const r = BFShared.feedFreshness(x, HOUR);
            if (['fresh', 'stale', 'unknown'].indexOf(r.level) === -1) shapeProblems.push(`level ${r.level}`);
            if (typeof r.staleAfterMs !== 'number') shapeProblems.push('staleAfterMs is not a number');
        });
    }
    t('feedFreshness: returns a new { level, staleAfterMs } object each call (changing one does not affect the next), with exactly those two keys, level one of fresh / stale / unknown',
        shapeProblems, []);
    t('feedFreshness: an object that throws when coerced, as the age or the interval, is never coerced and nothing throws',
        [safe(() => fresh(boom, boom)), safe(() => fresh(HOUR, boom)), safe(() => fresh(boom, 30 * MIN))],
        [{ level: 'unknown', staleAfterMs: DEFAULT_STALE }, { level: 'fresh', staleAfterMs: DEFAULT_STALE }, { level: 'unknown', staleAfterMs: HOUR }]);

    // ================================================================================================
    // previousAvailableDate
    // ================================================================================================
    // Hand-written cases. [dates, asOf, expected]
    const W = ['2026-08-27', '2026-08-28', '2026-08-31'];
    const PREV_TABLE = [
        [W, '2026-08-31', '2026-08-28'], // the weekend gap: the previous AVAILABLE date, not the previous calendar day
        [W, '2026-08-29', '2026-08-28'], [W, '2026-08-30', '2026-08-28'], [W, '2026-09-01', '2026-08-31'], [W, '2026-12-31', '2026-08-31'], [W, '9999-12-31', '2026-08-31'],
        [W, '2026-08-28', '2026-08-27'], // asOf equal to a listed date: strictly previous
        [W, '2026-08-27', null], // asOf equal to the earliest date: nothing earlier
        [W, '2026-08-26', null], [W, '2026-01-01', null], [W, '0000-01-01', null], // before every date
        [[], '2026-08-31', null], [[], '0000-01-01', null],
        [['2026-08-28'], '2026-08-29', '2026-08-28'], [['2026-08-28'], '2026-08-28', null], [['2026-08-28'], '2026-08-27', null],
        [['2026-08-31', '2026-08-28', '2026-08-27'], '2026-08-31', '2026-08-28'], // newest first, as the server sends it
        [['2026-08-28', '2026-08-31', '2026-08-27'], '2026-08-31', '2026-08-28'], // any order
        [['2026-08-28', '2026-08-28', '2026-08-28'], '2026-08-31', '2026-08-28'], // duplicates
        [['2026-08-31', '2026-08-31'], '2026-08-31', null],
        [['2025-12-31', '2026-01-01'], '2026-01-01', '2025-12-31'], // year boundary
        [['2026-01-31', '2026-02-01'], '2026-02-01', '2026-01-31'], // month boundary
        [['2026-02-28', '2026-03-01'], '2026-03-01', '2026-02-28'],
        [['2024-02-29', '2024-03-01'], '2024-03-01', '2024-02-29'], // a leap day is a real date
        [['0001-01-01', '2026-01-01', '9999-12-31'], '9999-12-31', '2026-01-01'], // extremes compare as dates, not as numbers
        [['0000-01-01'], '0000-01-02', '0000-01-01'], [['9999-12-30'], '9999-12-31', '9999-12-30'], [['9999-12-31'], '9999-12-31', null],
        [['2026-08-09', '2026-08-10'], '2026-08-10', '2026-08-09'], // lexicographic would misplace these if padding were wrong
        [['2026-09-01', '2026-10-01'], '2026-10-01', '2026-09-01'],
        [['2026-02-30', '2026-08-28'], '2026-09-01', '2026-08-28'], // the impossible date is ignored, not returned and not an error
        [['2026-02-30'], '2026-09-01', null],
    ];
    t('previousAvailableDate: hand-written cases, including the weekend gap, an as-of date equal to a listed one (strictly earlier), before every date, the empty list, order, duplicates and year/month/leap-day edges; the answer is always the string itself',
        { rows: PREV_TABLE.length, bad: badRows(PREV_TABLE, ([d, a]) => prev(d, a)), typed: PREV_TABLE.filter(([d, a, e]) => e !== null && typeof prev(d, a) !== 'string').length },
        { rows: 32, bad: [], typed: 0 });

    // Real data: the dates of the committed 9-day history, consecutive calendar days Mon 2026-08-24 to Tue 2026-09-01.
    const D = history.loadHistory().dates;
    t('previousAvailableDate: on the nine dates of the committed history the previous date of each is the day before, and the first date has none',
        { dates: D.length, answers: D.map((d) => prev(D, d)) }, { dates: 9, answers: [null].concat(D.slice(0, 8)) });
    // The same days as a weekday-only archive (no Saturday 08-29 or Sunday 08-30), so Monday 08-31 has a weekend behind it.
    const WEEKDAYS = D.filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
    t('previousAvailableDate: with only the weekdays of that history listed, Saturday, Sunday and Monday all answer Friday 2026-08-28, Tuesday answers Monday, the first Monday answers none, and a date after the last answers the last',
        { listed: WEEKDAYS, answers: ['2026-08-24', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'].map((a) => prev(WEEKDAYS, a)) },
        { listed: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01'], answers: [null, '2026-08-28', '2026-08-28', '2026-08-28', '2026-08-31', '2026-09-01'] });

    // Order does not matter, and the input is never modified (nor does a frozen array throw).
    {
        const orders = [D.slice().reverse(), D.slice(4).concat(D.slice(0, 4))];
        let seed = 12345;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        for (let k = 0; k < 200; k++) { const c = D.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = c[i]; c[i] = c[j]; c[j] = x; } orders.push(c); }
        const bad = [];
        orders.forEach((o, n) => D.concat(['2026-08-23', '2026-09-02']).forEach((a) => { const want = D.filter((d) => d < a).pop() || null; const got = safe(() => prev(o, a)); if (got !== want) bad.push(`order ${n}, asOf ${a} -> ${got}`); }));
        const frozen = Object.freeze(D.slice().reverse());
        const before = JSON.stringify(frozen);
        const viaFrozen = safe(() => prev(frozen, '2026-08-31'));
        const mutable = ['2026-08-31', '2026-08-27', '2026-08-28'];
        prev(mutable, '2026-09-01');
        t('previousAvailableDate: 202 orderings of the history (reversed, rotated, 200 shuffles) give the same answer for every as-of date; a frozen array works and no input array is changed or sorted',
            { orderings: orders.length, bad, viaFrozen, frozenSame: JSON.stringify(frozen) === before, mutableSame: JSON.stringify(mutable) === JSON.stringify(['2026-08-31', '2026-08-27', '2026-08-28']) },
            { orderings: 202, bad: [], viaFrozen: '2026-08-30', frozenSame: true, mutableSame: true });
    }

    // Entries that are not real calendar dates in exactly YYYY-MM-DD form are ignored. WINDOW_JUNK strings all sort
    // (as plain strings) strictly between the valid companion and the as-of date, so each would be RETURNED if the
    // code compared strings without validating them first.
    const FROM = '2025-12-30';
    const TO = '2026-12-31';
    const WINDOW_JUNK = [
        '2026-02-30', '2026-02-31', '2026-02-29', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2026-02-00', '2026-01-00', '2025-13-01', '2025-12-32', '2025-12-99',
        '2026-1-5', '2026-01-5', '2026-10-1', '2026-09-0', '2026-09', '2026', '2026-', '2026--09-01', '2026-09-011', '2026-09-01-', '2026-09-01x',
        '2026-09-01\n', '2026-09-01\r\n', '2026-09-01 ', '2026-09-01\t', '2026-09-01\u0000', '2026-09-01T10:00:00Z', '2026-09-01T00:00:00.000+02:00', '2026-09-0\n1', '2026-08-\n30',
        '2026-08-30 00:00', '2026-08-3O', '2026-0a-10', '2026-08-1e', '2026-08-+9', '2026-08--9', '2026-08-0x',
    ];
    const OTHER_JUNK = [
        ' 2026-09-01', '\t2026-09-01', '\n2026-09-01', '\r\n2026-09-01', ' 2026-09-01', '2026/09/01', '2026.09.01', '2026_09_01', '20260901', '09-01-2026', '01/09/2026', '1-9-2026', '2026-9-01', '',
        ' ', '\n', 'null', 'undefined', 'NaN', 'YYYY-MM-DD', 'x'.repeat(10), '2026-09-01'.repeat(1000), 'x'.repeat(1000000),
        '２０２６-０９-０１', '٢٠٢٦-٠٩-٠١', '2026-٠٩-01', '2026-09-0١',
        20260901, 2026.0901, 0, -1, NaN, Infinity, -Infinity, 1e308, null, undefined, true, false, {}, [], ['2026-09-01'], [['2026-09-01']], { 0: '2026-09-01', length: 1 },
        { toString: () => '2026-09-01' }, { valueOf: () => '2026-09-01' }, new String('2026-09-01'), new Date(Date.UTC(2026, 8, 1)), () => '2026-09-01', Symbol('2026-09-01'), BigInt(20260901), boom,
    ];
    t('previousAvailableDate: the test\'s own window is sound: every WINDOW_JUNK string sorts strictly between the valid companion and the as-of date, so it would win if it were not validated',
        { rows: WINDOW_JUNK.length, outside: WINDOW_JUNK.filter((j) => !(j > FROM && j < TO)) }, { rows: 39, outside: [] });
    t('previousAvailableDate: an entry that is not a real YYYY-MM-DD date (impossible days and months, short or padded or whitespace-wrapped forms, a trailing newline, other separators) is ignored: next to a valid companion the companion is answered, alone the answer is none, and nothing throws',
        { rows: WINDOW_JUNK.length, bad: WINDOW_JUNK.flatMap((j) => [[[j, FROM], FROM], [[FROM, j], FROM], [[j], null]].map(([d, want]) => ({ j, want, got: safe(() => prev(d, TO)) }))
            .filter(({ want, got }) => got !== want).map(({ j, want, got }) => `${JSON.stringify(j)} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`)) },
        { rows: 39, bad: [] });
    t('previousAvailableDate: non-date entries of every other shape (other languages\' digits, huge strings, numbers, NaN, infinities, null, undefined, booleans, objects, arrays, boxed strings, a Date object, a function, a symbol, a BigInt, an object that throws if coerced) are ignored the same way',
        { rows: OTHER_JUNK.length, bad: OTHER_JUNK.flatMap((j) => [[[j, FROM], FROM], [[FROM, j], FROM], [[j], null]].map(([d, want]) => ({ j, want, got: safe(() => prev(d, TO)) }))
            .filter(({ want, got }) => got !== want).map(({ j, want, got }) => `${show(j)} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`)) },
        { rows: 52, bad: [] });
    // Strings that differ from a real date only by ONE character that is not a digit (or not a dash) in one position: the year,
    // month or day digits, or a separator. parseInt would read some of them as a number ('1.' is 1), so only the pattern keeps them out.
    const FROM2 = '1999-12-31';
    const TO2 = '2099-12-31';
    const CLASS_JUNK = ['20.6-08-30', '20+6-08-30', '2 26-08-30', '2026-1.-10', '2026-1 -10', '2026-+8-10', '2026-1a-10', '2026-08-1.', '2026-08-1 ', '2026-08-1e', '2026-08-+9',
        '2026x08-30', '2026 08 30', '2026-08x30', '2026-08 30', '2026--8-30',
        '2026-1-011', '20261-1-11', '202-09-011']; // ten characters, digits and dashes, but the digit groups are the wrong widths
    t('previousAvailableDate: a string with one non-digit where a digit belongs (a dot, a plus, a space or a letter in the year, month or day), a wrong separator, or digit groups of the wrong widths in ten characters is ignored, although a number parser would read it; the strings all sort inside the window, so each would be returned if the pattern let it through',
        { rows: CLASS_JUNK.length, outside: CLASS_JUNK.filter((j) => !(j > FROM2 && j < TO2)),
          bad: CLASS_JUNK.flatMap((j) => [[[j, FROM2], FROM2], [[j], null]].map(([d, want]) => ({ j, want, got: safe(() => prev(d, TO2)) }))
              .filter(({ want, got }) => got !== want).map(({ j, want, got }) => `${JSON.stringify(j)} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`)) },
        { rows: 19, outside: [], bad: [] });
    t('previousAvailableDate: all of that junk in one list with several valid dates still answers the greatest valid date strictly before the as-of date',
        { junkOnly: safe(() => prev(WINDOW_JUNK.concat(OTHER_JUNK), TO)), mixed: safe(() => prev(OTHER_JUNK.concat(['2026-03-01'], WINDOW_JUNK, ['2026-05-05', '2026-04-04'], OTHER_JUNK), TO)) },
        { junkOnly: null, mixed: '2026-05-05' });

    // `dates` that is not an array, and an as-of date that is not a valid date, answer null.
    const HOSTILE_LISTS = [null, undefined, 0, 1, NaN, '', '2026-08-28', '2026-08-28,2026-08-27', true, false, {}, { 0: '2026-08-28', length: 1 }, { length: 0 }, new Set(['2026-08-28']), new Map([['a', '2026-08-28']]),
        () => ['2026-08-28'], Symbol('x'), BigInt(1), new Uint8Array(2), (function () { return arguments; })('2026-08-28'), Object.create(Array.prototype), boom];
    t('previousAvailableDate: a first argument that is not an array (null, undefined, numbers, a string, an object, an array-like object, a Set, a Map, a function, a symbol, a BigInt, a typed array, an arguments object, an object that throws if coerced) answers null, never iterating a string\'s characters',
        { rows: HOSTILE_LISTS.length, bad: HOSTILE_LISTS.map((l) => ({ l, got: safe(() => prev(l, '2026-09-01')) })).filter(({ got }) => got !== null).map(({ l, got }) => `${show(l)} -> ${JSON.stringify(got)}`) },
        { rows: 22, bad: [] });
    const HOSTILE_ASOF = [undefined, null, 0, 20260901, 2026.0901, NaN, Infinity, '', ' ', 'x', '2026-02-30', '2026-02-29', '2100-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-5', '2026-01-5',
        ' 2026-09-01', '2026-09-01 ', '2026-09-01\n', '\n2026-09-01', '2026-09-01\r\n', '2026-09-01T00:00:00Z', '20260901', '2026/09/01', '２０２６-０９-０１',
        true, {}, [], ['2026-09-01'], new String('2026-09-01'), { toString: () => '2026-09-01' }, new Date(Date.UTC(2026, 8, 1)), () => '2026-09-01', Symbol('x'), BigInt(1), boom];
    t('previousAvailableDate: an as-of date that is missing, not a string, not exactly YYYY-MM-DD, or not a real calendar day answers null even when the list is fine; called with one argument it answers null',
        { rows: HOSTILE_ASOF.length, bad: HOSTILE_ASOF.map((a) => ({ a, got: safe(() => prev(W, a)) })).filter(({ got }) => got !== null).map(({ a, got }) => `${show(a)} -> ${JSON.stringify(got)}`),
          oneArgument: safe(() => BFShared.previousAvailableDate(W)), noArguments: safe(() => BFShared.previousAvailableDate()) },
        { rows: 38, bad: [], oneArgument: null, noArguments: null });

    // Calendar sweep 1: every consecutive day from 1899-12-01 to 2101-03-31 (leap years, 1900 and 2100 included), against the host calendar.
    const iso = (dayNumber) => new Date(dayNumber * DAY).toISOString().slice(0, 10);
    const first = Date.UTC(1899, 11, 1) / DAY;
    const last = Date.UTC(2101, 2, 31) / DAY;
    const days = { checked: 0, bad: [] };
    for (let n = first; n <= last; n++) {
        const a = iso(n);
        days.checked++;
        const got = safe(() => prev([iso(n + 1), iso(n - 2), a, iso(n - 1), iso(n + 7)], a));
        if (got !== iso(n - 1)) days.bad.push(`${a} -> ${got} (want ${iso(n - 1)})`);
    }
    t('previousAvailableDate: for every one of the 73,535 consecutive days from 1899-12-01 to 2101-03-31, a list holding the neighbouring days answers the day before (month ends, leap days, 1900 and 2100 included)',
        days, { checked: 73535, bad: [] });

    // Calendar sweep 2: which (year, month, day) triples are real days, against the host calendar. Candidates are tested as the
    // as-of date and as a list entry, so the two code paths are both held to the oracle.
    const pad = (n, w) => String(n).padStart(w, '0');
    const realDay = (y, m, d) => { const dt = new Date(0); dt.setUTCFullYear(y, m - 1, d); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; };
    const LOW = '0000-01-01';
    const HIGH = '9999-12-31';
    const sweepDays = (years, dayList) => {
        const r = { checked: 0, real: 0, bad: [] };
        for (const y of years) {
            for (let m = 0; m <= 13; m++) {
                for (const d of dayList) {
                    const c = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
                    const valid = m >= 1 && m <= 12 && d >= 1 && realDay(y, m, d);
                    r.checked++;
                    if (valid) r.real++;
                    const asOfAnswer = safe(() => prev([LOW], c)); // valid and later than LOW -> LOW
                    const entryAnswer = safe(() => prev([c, LOW], HIGH)); // valid and earlier than HIGH -> c
                    const wantAsOf = valid && c !== LOW ? LOW : null;
                    const wantEntry = valid ? c : LOW;
                    if (asOfAnswer !== wantAsOf || entryAnswer !== wantEntry) r.bad.push(`${c}: as-of ${asOfAnswer}, entry ${entryAnswer}`);
                }
            }
        }
        return r;
    };
    const centuryYears = [];
    for (let y = 1580; y <= 2420; y++) centuryYears.push(y);
    const allDays = [];
    for (let d = 0; d <= 33; d++) allDays.push(d);
    const s2 = sweepDays(centuryYears, allDays);
    t('previousAvailableDate: every year 1580-2420 times month 00-13 times day 00-33 (as an as-of date and as a list entry) is accepted exactly when the host calendar says it is a real day (1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400 among them)',
        { checked: s2.checked, real: s2.real, bad: s2.bad.slice(0, 5) }, { checked: 841 * 14 * 34, real: s2.real, bad: [] });
    t('previousAvailableDate: the sweep above is not vacuous: it saw both real and impossible days, and a real day count equal to 841 years of months',
        { someReal: s2.real > 0, someImpossible: s2.real < s2.checked, realCount: s2.real },
        { someReal: true, someImpossible: true, realCount: (() => { let n = 0; for (let y = 1580; y <= 2420; y++) n += (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365; return n; })() });
    // Leap days over every year 0000-9999 (and the 28th and 30th of February, which are real and impossible).
    const leapBad = [];
    for (let y = 0; y <= 9999; y++) {
        for (const [d, want] of [[28, true], [29, realDay(y, 2, 29)], [30, false]]) {
            const c = `${pad(y, 4)}-02-${d}`;
            const got = safe(() => prev([LOW], c)) === LOW;
            if (c !== LOW && got !== want) leapBad.push(c);
        }
    }
    t('previousAvailableDate: February 28 is real, February 30 is not, and February 29 is real exactly in the leap years, for every year 0000 to 9999 (checked against the host calendar)',
        leapBad, []);
    t('previousAvailableDate: named leap years: 2024, 2000, 2400 and 0000 have a February 29; 2026, 2025, 2100, 2200, 1900 and 0100 do not',
        [2024, 2000, 2400, 0, 2026, 2025, 2100, 2200, 1900, 100].map((y) => prev([LOW], `${pad(y, 4)}-02-29`) === LOW),
        [true, true, true, true, false, false, false, false, false, false]);

    // Huge arrays.
    {
        const N = 200000;
        const start = Date.UTC(1990, 0, 1) / DAY;
        const big = [];
        for (let i = 0; i < N; i++) big.push(iso(start + i));
        const mid = iso(start + 123456);
        let seed = 99;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const shuffled = big.slice();
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = x; }
        const sparse = new Array(5000000);
        const dup = new Array(100000).fill('2026-08-28');
        dup.push('2026-08-27');
        const junky = big.map((d, i) => (i % 3 === 0 ? `${d}\n` : d));
        t('previousAvailableDate: huge arrays: 200,000 ascending dates, the same shuffled, 200,000 with every third one newline-wrapped, 100,001 mostly duplicates, and a 5,000,000-slot array with one date or none (holes are ignored)',
            { ascending: safe(() => prev(big, mid)), shuffled: safe(() => prev(shuffled, mid)), beforeAll: safe(() => prev(big, big[0])), afterAll: safe(() => prev(big, '9999-12-31')),
              junky: safe(() => prev(junky, iso(start + 99999))), duplicates: safe(() => prev(dup, '2026-08-29')),
              sparseNone: safe(() => prev(sparse, '2026-09-01')), sparseOne: safe(() => { sparse[4999999] = '2026-08-28'; return prev(sparse, '2026-09-01'); }) },
            { ascending: iso(start + 123455), shuffled: iso(start + 123455), beforeAll: null, afterAll: big[N - 1],
              junky: iso(start + 99998 - (99998 % 3 === 0 ? 1 : 0)), duplicates: '2026-08-28',
              sparseNone: null, sparseOne: '2026-08-28' });
    }

    // ================================================================================================
    // Purity: no clock, no randomness, no environment
    // ================================================================================================
    // The three functions run in the shared vm realm, whose Date and Math are NOT the host's, so the realm's own
    // Date is replaced (through that realm's Function constructor) by something that throws, along with Date.now and
    // Math.random, while a battery of calls runs. Anything that read a clock or a random number would throw; the
    // answers must equal the ones computed before the sabotage. Everything is restored afterwards.
    {
        const Fn = BFShared.formatAge.constructor;
        const realm = new Fn('return this')();
        const battery = () => JSON.stringify([
            [0, 59999, MIN, HOUR, DAY, 2 * DAY, 1e308, NaN, -1, '5', null].map((x) => age(x)),
            [0, DEFAULT_STALE, DEFAULT_STALE + 1, NaN, -1, null].map((x) => [fresh(x), fresh(x, 1800000), fresh(x, 'bad')]),
            [[W, '2026-08-31'], [W, '2026-08-28'], [W, '2026-08-27'], [[], '2026-08-31'], [['2024-02-29', '2026-02-30'], '2026-03-01'], [null, '2026-08-31'], [W, null], [D, '2026-09-01']].map(([d, a]) => prev(d, a)),
        ]);
        const normal = battery();
        const realDate = realm.Date;
        const realRandom = realm.Math.random;
        const stop = () => { throw new Error('the shared code read the clock or the random source'); };
        let sabotaged = null;
        let live = null;
        try {
            realm.Date = function () { stop(); };
            realm.Date.now = stop;
            realm.Math.random = stop;
            live = ['new Date()', 'Date.now()', 'Math.random()'].map((src) => { try { new Fn(`return ${src}`)(); return 'did not throw'; } catch (e) { return 'threw'; } });
            sabotaged = safe(battery);
        } finally {
            realm.Date = realDate;
            realm.Math.random = realRandom;
        }
        t('purity: the sabotage is live (in the shared realm, new Date(), Date.now() and Math.random() all throw while the three functions run), and it is undone afterwards',
            { live, restored: new Fn('return typeof Date.now() + typeof Math.random()')() }, { live: ['threw', 'threw', 'threw'], restored: 'numbernumber' });
        t('purity: with the clock and the random source throwing, the three functions give exactly the answers they gave normally (they read neither, and nothing else that could vary)',
            sabotaged === normal, true);
    }
    {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', '40_feed_age.js'), 'utf8');
        const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
        const found = ['Date', 'Math\\.random', 'performance', 'process', 'window', 'document', 'setTimeout', 'setInterval', 'eval', 'Function', 'require', 'Intl', 'toLocale[A-Za-z]*']
            .filter((w) => new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`).test(code));
        t('purity: the code of shared/40_feed_age.js (comment lines removed) names no Date, Math.random, performance, process, window, document, timer, eval, Function, require, Intl or locale method',
            found, []);
    }

    // ================================================================================================
    // freshnessLabel (slice 1-A: the masthead chip "Flash data: 14 min ago (hourly)")
    // ================================================================================================
    const label = (s, a, c) => BFShared.freshnessLabel(s, a, c);
    const lab = (s, a, c) => { const r = label(s, a, c); return { text: r.text, level: r.level, cadenceText: r.cadenceText, ageText: r.ageText }; };

    // [cadence, age, level]: both sides of 1.25 x and 3 x, for 60, 30 and 90 minute cadences. Exactly at a multiple is the LOWER level.
    const LEVEL_TABLE = [];
    for (const c of [60 * MIN, 30 * MIN, 90 * MIN]) {
        LEVEL_TABLE.push([c, 0, 'fresh'], [c, 1, 'fresh'], [c, c, 'fresh'], [c, 1.25 * c - 1, 'fresh'], [c, 1.25 * c, 'fresh'], [c, nextUp(1.25 * c), 'amber'], [c, 1.25 * c + 1, 'amber'],
            [c, 2 * c, 'amber'], [c, 3 * c - 1, 'amber'], [c, 3 * c, 'amber'], [c, nextUp(3 * c), 'red'], [c, 3 * c + 1, 'red'], [c, 30 * c, 'red']);
    }
    // The same boundaries written out by hand in minutes for the hourly case, with the full text.
    const TEXT_TABLE = [
        ['Flash data', 14 * MIN, HOUR, { text: 'Flash data: 14 min ago (hourly)', level: 'fresh', cadenceText: 'hourly', ageText: '14 min ago' }],
        ['Flash data', 75 * MIN, HOUR, { text: 'Flash data: 1 h 15 min ago (hourly)', level: 'fresh', cadenceText: 'hourly', ageText: '1 h 15 min ago' }],
        ['Flash data', 75 * MIN + 1, HOUR, { text: 'Flash data: 1 h 15 min ago (hourly)', level: 'amber', cadenceText: 'hourly', ageText: '1 h 15 min ago' }],
        ['Flash data', 180 * MIN, HOUR, { text: 'Flash data: 3 h ago (hourly)', level: 'amber', cadenceText: 'hourly', ageText: '3 h ago' }],
        ['Flash data', 180 * MIN + 1, HOUR, { text: 'Flash data: 3 h ago (hourly)', level: 'red', cadenceText: 'hourly', ageText: '3 h ago' }],
        ['Flash data', 45 * MIN, 30 * MIN, { text: 'Flash data: 45 min ago (every 30 min)', level: 'amber', cadenceText: 'every 30 min', ageText: '45 min ago' }],
        ['Flash data', 37.5 * MIN, 30 * MIN, { text: 'Flash data: 37 min ago (every 30 min)', level: 'fresh', cadenceText: 'every 30 min', ageText: '37 min ago' }],
        ['Flash data', 2 * DAY, 90 * MIN, { text: 'Flash data: 2 days ago (every 90 min)', level: 'red', cadenceText: 'every 90 min', ageText: '2 days ago' }],
        ['Team data', 0, HOUR, { text: 'Team data: just now (hourly)', level: 'fresh', cadenceText: 'hourly', ageText: 'just now' }],
    ];
    t('freshnessLabel: both sides of 1.25 x and 3 x the cadence for 60, 30 and 90 minute cadences (exactly at a multiple stays in the lower level), and nine hand-written full results',
        { levels: LEVEL_TABLE.length, badLevels: badRows(LEVEL_TABLE, ([c, a]) => lab('S', a, c).level).concat(LEVEL_TABLE.filter(([c, a, l]) => safe(() => lab('S', a, c).level) !== l).map((r) => r.join(','))),
          texts: TEXT_TABLE.length, badTexts: badRows(TEXT_TABLE.map(([s, a, c, w]) => [s, a, c, w]), ([s, a, c]) => lab(s, a, c)) },
        { levels: 39, badLevels: [], texts: 9, badTexts: [] });

    // cadenceText: exactly 60 min 'hourly', under 60 min 'every N min', whole hours 'every N h', otherwise minutes floored; under a minute shows 1.
    const CADENCE_TABLE = [
        [HOUR, 'hourly'], [30 * MIN, 'every 30 min'], [MIN, 'every 1 min'], [59 * MIN, 'every 59 min'], [HOUR - 1, 'every 59 min'], [nextDown(HOUR), 'every 59 min'], [nextUp(HOUR), 'every 60 min'], [HOUR + 1, 'every 60 min'],
        [61 * MIN, 'every 61 min'], [90 * MIN, 'every 90 min'], [2 * HOUR, 'every 2 h'], [2 * HOUR + 1, 'every 120 min'], [3 * HOUR, 'every 3 h'], [24 * HOUR, 'every 24 h'], [150 * MIN + 30000, 'every 150 min'],
        [MIN - 1, 'every 1 min'], [1, 'every 1 min'], [0.5, 'every 1 min'], [Number.MIN_VALUE, 'every 1 min'], [1e12, 'every 16666666 min'],
    ];
    t('freshnessLabel: cadenceText is hourly at exactly 60 min, every N min below it, every N h for whole hours above it, otherwise whole minutes floored, and never every 0 min',
        { rows: CADENCE_TABLE.length, bad: badRows(CADENCE_TABLE, ([c]) => lab('S', 0, c).cadenceText) },
        { rows: 20, bad: [] });

    // source and age edge cases: a source that is not a non-empty string is 'Data' (trimmed otherwise); an age that is not an age is 'unknown' with its own text; the default cadence is 60 min.
    const EDGE_TABLE = [
        [undefined, 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'], [null, 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'], ['', 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'], ['   ', 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'],
        [5, 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'], [{}, 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'], [['Flash'], 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'], [boom, 5 * MIN, HOUR, 'Data: 5 min ago (hourly)'],
        ['  Flash data  ', 5 * MIN, HOUR, 'Flash data: 5 min ago (hourly)'],
        ['S', NaN, HOUR, 'S: age unknown (hourly)'], ['S', -1, HOUR, 'S: age unknown (hourly)'], ['S', Infinity, HOUR, 'S: age unknown (hourly)'], ['S', '300000', HOUR, 'S: age unknown (hourly)'],
        ['S', null, HOUR, 'S: age unknown (hourly)'], ['S', undefined, 30 * MIN, 'S: age unknown (every 30 min)'], ['S', boom, HOUR, 'S: age unknown (hourly)'],
        ['S', 5 * MIN, undefined, 'S: 5 min ago (hourly)'], ['S', 5 * MIN, 0, 'S: 5 min ago (hourly)'], ['S', 5 * MIN, -1, 'S: 5 min ago (hourly)'], ['S', 5 * MIN, NaN, 'S: 5 min ago (hourly)'], ['S', 5 * MIN, Infinity, 'S: 5 min ago (hourly)'],
        ['S', 5 * MIN, '1800000', 'S: 5 min ago (hourly)'], ['S', 5 * MIN, null, 'S: 5 min ago (hourly)'], ['S', 5 * MIN, boom, 'S: 5 min ago (hourly)'], ['S', 5 * MIN, new Number(1800000), 'S: 5 min ago (hourly)'],
    ];
    t('freshnessLabel: a source that is not a non-empty string is Data, a trimmed one is used, an age that is not an age gives "age unknown" and level unknown, and an unusable cadence is hourly',
        { rows: EDGE_TABLE.length, bad: badRows(EDGE_TABLE, ([s, a, c]) => lab(s, a, c).text),
          unknown: lab('S', NaN, HOUR), none: safe(() => label()) },
        { rows: 25, bad: [], unknown: { text: 'S: age unknown (hourly)', level: 'unknown', cadenceText: 'hourly', ageText: '' },
          none: { text: 'Data: age unknown (hourly)', level: 'unknown', cadenceText: 'hourly', ageText: '' } });

    // Hostile inputs in every position, including one that throws if coerced: always a well-formed result, never a throw.
    const HOSTILE_ALL = [NaN, Infinity, -Infinity, -1, 0, '5', '', null, undefined, true, {}, [], [1], new Number(5), { valueOf: () => 5 }, () => 5, Symbol('x'), BigInt(5), boom];
    t('freshnessLabel: every hostile value in every argument position (NaN, infinities, negatives, strings, null, booleans, objects, boxed numbers, functions, symbols, a BigInt, an object that throws if coerced) gives a well-formed result and never throws',
        HOSTILE_ALL.flatMap((x) => [[x, 60 * MIN, HOUR], ['S', x, HOUR], ['S', 60 * MIN, x]])
            .map(([s, a, c]) => ({ r: safe(() => lab(s, a, c)) }))
            .filter(({ r }) => !(r && typeof r === 'object' && typeof r.text === 'string' && ['fresh', 'amber', 'red', 'unknown'].indexOf(r.level) >= 0 && typeof r.cadenceText === 'string' && typeof r.ageText === 'string'))
            .length, 0);

    // A fresh object every call: changing one result changes nothing else.
    {
        const a = label('S', MIN, HOUR);
        const b = label('S', MIN, HOUR);
        a.text = 'changed';
        a.level = 'red';
        t('freshnessLabel: every call returns a new object (changing one result leaves the next call unchanged)',
            { same: a === b, text: b.text, level: b.level, again: lab('S', MIN, HOUR) },
            { same: false, text: 'S: 1 min ago (hourly)', level: 'fresh', again: { text: 'S: 1 min ago (hourly)', level: 'fresh', cadenceText: 'hourly', ageText: '1 min ago' } });
    }
    {
        const Fn = BFShared.formatAge.constructor;
        const realm = new Fn('return this')();
        const battery = () => JSON.stringify([0, MIN, 75 * MIN, 75 * MIN + 1, 3 * HOUR, 3 * HOUR + 1, NaN, -1, '5', null].map((x) => [lab('Flash data', x, HOUR), lab('S', x, 30 * MIN), lab(null, x)]));
        const normal = battery();
        const realDate = realm.Date;
        const realRandom = realm.Math.random;
        const stop = () => { throw new Error('freshnessLabel read the clock or the random source'); };
        let sabotaged = null;
        try {
            realm.Date = function () { stop(); };
            realm.Date.now = stop;
            realm.Math.random = stop;
            sabotaged = safe(battery);
        } finally {
            realm.Date = realDate;
            realm.Math.random = realRandom;
        }
        t('freshnessLabel: purity: with the clock and the random source throwing it gives exactly the answers it gave normally',
            sabotaged === normal, true);
    }
};

'use strict';
/**
 * Behaviour tests for BFShared.thresholdValue, findMissingThresholds, diffThresholds and thresholdChangesOverDays
 * (shared/60_threshold_diff.js, Phase 1 slice 1-B: threshold health and threshold changes; D2: 0 and 0.01 mean "not set").
 *
 * Evidence:
 *   1. Hand-written fixtures: every branch worked out in the comments (placeholders, percent strings, tolerance, sailing-level
 *      overall versus port-level loading, VMS and hostile records, one-sided presence, sort order, repeated changes, bad day entries).
 *   2. Hostile inputs and purity (the realm's Date and Math.random made to throw; the source names no clock or environment).
 *   3. Real data: the committed 9-day CSV (ctx.history). Each row is mapped to
 *        { vvd: 'Vessel 1st VVD', pol: 'Route Location 1st Pol', lane: 'Vessel 1st Lane',
 *          overall: 'MCT Overall Threshold', loading: 'MCT Loading Threshold' }
 *      (history.COL.overallThreshold and history.COL.loadingThreshold). NOTE the loading column is MCT Loading Threshold, NOT the
 *      app's "POL Laden Threshold": the two differ on 125 rows (0 versus 1.2), so the counts pinned here are for the CSV column and
 *      the app's numbers for the same day can differ. The per-day counts and the change totals are pinned as constants, and the
 *      counts are also compared with a small oracle written here from the raw cell text.
 *
 * Calls go through local names (tv, missing, diffT, overDays): tests/check_shared_sync.js check E forbids a second definition
 * of a shared name anywhere in tests/.
 */
const fs = require('fs');
const path = require('path');

exports.TESTS = ['thresholdValue', 'findMissingThresholds', 'diffThresholds', 'thresholdChangesOverDays'];
exports.COUNT = 21;
exports.run = function (ctx) {
    const { BFShared, t, plain, history } = ctx;
    const tv = (v) => BFShared.thresholdValue(v);
    const missing = (r) => plain(BFShared.findMissingThresholds(r));
    const diffT = (a, b) => plain(BFShared.diffThresholds(a, b));
    const overDays = (d) => plain(BFShared.thresholdChangesOverDays(d));

    const boom = { valueOf() { throw new Error('valueOf was called'); }, toString() { throw new Error('toString was called'); } };
    const safe = (fn) => { try { return fn(); } catch (e) { return `THREW: ${e && e.message}`; } };
    const J = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : x));
    const rec = (vvd, pol, lane, overall, loading) => ({ vvd, pol, lane, overall, loading });

    // ================================================================================================
    // thresholdValue
    // ================================================================================================
    // [input, expected]: a number, or null for "not set".
    const TV_TABLE = [
        [1.2, 1.2], [1, 1], [1.5, 1.5], [0.5, 0.5], [2, 2], [0.02, 0.02], [0.011, 0.011], [0.009, 0.009], [100, 100], [-1.2, -1.2],
        [0, null], [-0, null], [0.01, null], [1e-10, null], [0.01 + 5e-10, null], [0.01 - 5e-10, null], [-1e-10, null],
        [NaN, null], [Infinity, null], [-Infinity, null],
        ['1.5', 1.5], [' 1.2 ', 1.2], ['\t1.2\n', 1.2], ['1', 1], ['.5', 0.5], ['5.', 5], ['+1.2', 1.2], ['1e0', 1], ['-0.5', -0.5],
        ['0', null], ['0.0', null], ['0.00', null], ['0.01', null], [' 0.01 ', null], ['.01', null], ['1e-2', null], ['0.010', null], ['-0', null],
        ['150%', 1.5], [' 150 % ', 1.5], ['100%', 1], ['115%', 1.15], ['0%', null], ['1%', null], ['0.5%', 0.005], ['%', null], ['150%%', null], ['%150', null],
        ['', null], ['   ', null], ['\n', null], ['abc', null], ['1.2abc', null], ['1,5', null], ['1.2.3', null], ['--1', null], ['NaN', null], ['Infinity', null], ['-Infinity', null],
        ['0x10', null], ['1e', null], ['e5', null], ['1 2', null], ['n/a', null], ['N/A', null], ['-', null], ['.', null], ['1e999', null],
        [null, null], [undefined, null], [true, null], [false, null], [{}, null], [[], null], [[1.2], null], [new Number(1.2), null], [new String('1.2'), null],
        [{ valueOf: () => 1.2 }, null], [{ toString: () => '1.2' }, null], [() => 1.2, null], [Symbol('x'), null], [BigInt(2), null], [boom, null], [new Date(0), null],
    ];
    t('thresholdValue: numbers and plain numeric strings are the number; 0, 0.01 (within 1e-9), blank, non-numeric, NaN, infinities, percent shapes, null, booleans, boxed numbers, objects, functions, symbols, BigInt and a throwing object are null; a % string is a percent',
        { rows: TV_TABLE.length, bad: TV_TABLE.map(([v, want]) => ({ v, want, got: safe(() => tv(v)) })).filter(({ want, got }) => !Object.is(got, want) && J(got) !== J(want))
            .map(({ v, want, got }) => `${typeof v === 'string' ? JSON.stringify(v) : String(typeof v)} -> ${J(got)} (want ${J(want)})`) },
        { rows: TV_TABLE.length, bad: [] });
    t('thresholdValue: just outside the 1e-9 tolerance of 0 and of 0.01 is a number, just inside is null; negative zero never comes back; no argument is null',
        { out0: tv(2e-9), in0: tv(5e-10), outHigh: tv(0.01 + 2e-9), outLow: tv(0.01 - 2e-9), inHigh: tv(0.01 + 5e-10), inLow: tv(0.01 - 5e-10), noArg: safe(() => BFShared.thresholdValue()), negZero: Object.is(tv(-0), -0) },
        { out0: 2e-9, in0: null, outHigh: 0.01 + 2e-9, outLow: 0.01 - 2e-9, inHigh: null, inLow: null, noArg: null, negZero: false });

    // ================================================================================================
    // findMissingThresholds
    // ================================================================================================
    // Hand-worked day:
    //   V1 (lane L1): P1 overall 1.2 loading 1.1 | P2 overall 1.2 loading 0      -> sailing set; port V1/P2 loading not set       (1 sailing-port)
    //   V2 (lane L2): P1 overall 0   loading 1.5 | P2 overall '0.01' loading ''  -> sailing NOT set (0 and 0.01); V2/P2 loading not set;
    //                                                                              V2/P1 loading is set but its sailing is not    (2 sailing-ports)
    //   V3: P1 overall 1.0 loading 1.0                                           -> nothing missing
    //   V4: P1 overall '' loading 1 | P2 overall '1.3' loading 1                 -> ONE row has an overall, so the sailing is set (0)
    //   ' v5 ' / 'V5' with pol ' usnyc ' / 'USNYC' -> one VVD, one port; the two rows: overall 1.1 on the first, loading blank on the first and 1.0 on the second -> set
    //   VMS rows and a blank VVD: skipped even with nothing set
    // Missing: sailings = [V2]; ports = [V1/P2, V2/P2]; count = V1/P2 + V2/P1 + V2/P2 = 3.
    const DAY = [
        rec('V1', 'P1', 'L1', 1.2, 1.1), rec('V1', 'P2', 'L1', 1.2, 0),
        rec('V2', 'P1', 'L2', 0, 1.5), rec('V2', 'P2', 'L2', '0.01', ''),
        rec('V3', 'P1', 'L3', 1.0, 1.0),
        rec('V4', 'P1', 'L4', '', 1), rec('V4', 'P2', 'L4', '1.3', 1),
        rec(' v5 ', ' usnyc ', 'L5', 1.1, ''), rec('V5', 'USNYC', 'L5', null, 1.0),
        rec('VMS', 'P1', 'LX', 0, 0), rec('vms', '', 'LX', null, null), rec('', 'P1', 'LX', 0, 0), rec('  ', 'P1', 'LX', 0, 0),
    ];
    t('findMissingThresholds: a hand-worked day: 0 and 0.01 are not set, one set row makes a sailing set, the loading threshold is per port, VVD and POL are normalised, VMS and blank VVDs are skipped, count = distinct sailing-ports missing either',
        missing(DAY), { sailings: [{ vvd: 'V2', lane: 'L2' }], ports: [{ vvd: 'V1', pol: 'P2', lane: 'L1' }, { vvd: 'V2', pol: 'P2', lane: 'L2' }], count: 3 });
    t('findMissingThresholds: everything set gives no sailings, no ports and count 0; an empty list the same',
        { all: missing([rec('A', 'P1', 'L', 1, 1), rec('A', 'P2', 'L', 1, 1.5), rec('B', 'P1', 'L', '120%', '1.2')]), empty: missing([]) },
        { all: { sailings: [], ports: [], count: 0 }, empty: { sailings: [], ports: [], count: 0 } });
    t('findMissingThresholds: nothing set on a two-port sailing is one sailing and two ports and two sailing-ports; a port with an overall set but loading missing counts once, not twice',
        { none: missing([rec('A', 'P1', 'L', 0, 0), rec('A', 'P2', 'L', null, 0.01)]), loadingOnly: missing([rec('B', 'P1', 'L', 1.1, null)]), overallOnly: missing([rec('C', 'P1', 'L', null, 1.1)]) },
        { none: { sailings: [{ vvd: 'A', lane: 'L' }], ports: [{ vvd: 'A', pol: 'P1', lane: 'L' }, { vvd: 'A', pol: 'P2', lane: 'L' }], count: 2 },
          loadingOnly: { sailings: [], ports: [{ vvd: 'B', pol: 'P1', lane: 'L' }], count: 1 },
          overallOnly: { sailings: [{ vvd: 'C', lane: 'L' }], ports: [], count: 1 } });
    t('findMissingThresholds: sorted by vvd then pol whatever the input order; the lane is the first non-blank lane of the sailing; duplicate rows of one port are one port',
        missing([rec('B', 'P2', '', 0, 0), rec('B', 'P1', 'LB', 0, 0), rec('A', 'P9', 'LA', 0, 0), rec('A', 'P1', 'LA', 0, 0), rec('A', 'P1', 'LA', 0, 0)]),
        { sailings: [{ vvd: 'A', lane: 'LA' }, { vvd: 'B', lane: 'LB' }],
          ports: [{ vvd: 'A', pol: 'P1', lane: 'LA' }, { vvd: 'A', pol: 'P9', lane: 'LA' }, { vvd: 'B', pol: 'P1', lane: 'LB' }, { vvd: 'B', pol: 'P2', lane: 'LB' }],
          count: 4 });
    const EMPTY_RESULT = { sailings: [], ports: [], count: 0 };
    const HOSTILE_LISTS = [null, undefined, 0, 1, NaN, '', 'abc', true, {}, { length: 1, 0: rec('A', 'P1', 'L', 0, 0) }, new Set([rec('A', 'P1', 'L', 0, 0)]), () => [], Symbol('x'), BigInt(1), boom];
    t('findMissingThresholds, diffThresholds and thresholdChangesOverDays: a first argument that is not an array (null, numbers, strings, objects, array-likes, a Set, a function, a symbol, BigInt, a throwing object) gives the empty answer and never throws',
        { missing: HOSTILE_LISTS.map((l) => safe(() => missing(l))).filter((r) => J(r) !== J(EMPTY_RESULT)).length,
          diff: HOSTILE_LISTS.map((l) => safe(() => diffT(l, l))).filter((r) => J(r) !== '[]').length,
          over: HOSTILE_LISTS.map((l) => safe(() => overDays(l))).filter((r) => J(r) !== '[]').length,
          diffOneSided: safe(() => diffT(null, [rec('A', 'P1', 'L', 1, 1)])), diffNoArgs: safe(() => BFShared.diffThresholds()), overNoArgs: safe(() => BFShared.thresholdChangesOverDays()) },
        { missing: 0, diff: 0, over: 0, diffOneSided: [], diffNoArgs: [], overNoArgs: [] });
    const HOSTILE_RECORDS = [null, undefined, 0, 'A', true, [], [rec('A', 'P1', 'L', 0, 0)], () => 1, Symbol('x'), BigInt(1), {}, { vvd: 'A' }, { vvd: boom }, { vvd: 'A', pol: boom }, { vvd: 'A', pol: 'P1', lane: boom, overall: boom, loading: boom }, { vvd: {}, pol: {} }];
    t('findMissingThresholds: records that are not objects, or have an unusable vvd, are skipped or read as blank without throwing; a record with only a vvd is one sailing-port with nothing set',
        { skipped: safe(() => missing(HOSTILE_RECORDS.slice(0, 6).concat(HOSTILE_RECORDS.slice(7, 10)))), onlyVvd: safe(() => missing([{ vvd: 'a' }])), noThrow: HOSTILE_RECORDS.map((r) => typeof safe(() => missing([r, r]))).filter((x) => x !== 'object').length },
        { skipped: { sailings: [], ports: [], count: 0 }, onlyVvd: { sailings: [{ vvd: 'A', lane: '' }], ports: [{ vvd: 'A', pol: '', lane: '' }], count: 1 }, noThrow: 0 });

    // ================================================================================================
    // diffThresholds
    // ================================================================================================
    // Yesterday -> today, worked by hand (only things on BOTH days are compared):
    //   V1 overall 1.2 -> 1.4 (change, pol '', lane from today 'L1new'); V1/P1 loading 1.1 -> 1.1 (same, no entry);
    //   V1/P2 loading 0 -> 1.2 (null -> number: change); V1/P3 exists only today (not reported)
    //   V2 overall 0 -> 1.3 (null -> number); V2/P1 loading 1.5 -> 0 (number -> null)
    //   V3 overall 1.0 -> 1.0000000005 (within 1e-9: no entry); V3/P1 loading 1.0 -> '110%' (1 -> 1.1)
    //   V4 only yesterday, V5 only today (not reported); VMS ignored; V6 nothing set both days (null, null: no entry)
    // Sorted: V1 overall, V1/P2 loading, V2 overall, V2/P1 loading, V3/P1 loading.
    const PREV = [
        rec('V1', 'P1', 'L1', 1.2, 1.1), rec('V1', 'P2', 'L1', 1.2, 0), rec('V2', 'P1', 'L2', 0, 1.5), rec('V3', 'P1', 'L3', 1.0, 1.0),
        rec('V4', 'P1', 'L4', 1, 1), rec('VMS', 'P1', 'LX', 1, 1), rec('V6', 'P1', 'L6', 0, ''),
    ];
    const CUR = [
        rec('V1', 'P1', 'L1new', 1.4, 1.1), rec('V1', 'P2', 'L1new', 1.4, 1.2), rec('V1', 'P3', 'L1new', 1.4, 1), rec('V2', 'P1', 'L2', 1.3, 0), rec('V3', 'P1', 'L3', 1.0000000005, '110%'),
        rec('V5', 'P1', 'L5', 1, 1), rec('VMS', 'P1', 'LX', 2, 2), rec('V6', 'P1', 'L6', null, 0.01),
    ];
    const WANT_DIFF = [
        { vvd: 'V1', pol: '', lane: 'L1new', kind: 'overall', prev: 1.2, cur: 1.4 },
        { vvd: 'V1', pol: 'P2', lane: 'L1new', kind: 'loading', prev: null, cur: 1.2 },
        { vvd: 'V2', pol: '', lane: 'L2', kind: 'overall', prev: null, cur: 1.3 },
        { vvd: 'V2', pol: 'P1', lane: 'L2', kind: 'loading', prev: 1.5, cur: null },
        { vvd: 'V3', pol: 'P1', lane: 'L3', kind: 'loading', prev: 1, cur: 1.1 },
    ];
    const PREV_COPY = JSON.stringify(PREV);
    const CUR_COPY = JSON.stringify(CUR);
    t('diffThresholds: a hand-worked pair of days: overall per VVD and loading per port, null against a number is a change, equal within 1e-9 is not, one-sided VVDs and ports are not reported, the lane is today\'s, sorted by vvd then kind then pol; the inputs are not changed',
        { diff: diffT(PREV, CUR), prevUnchanged: JSON.stringify(PREV) === PREV_COPY, curUnchanged: JSON.stringify(CUR) === CUR_COPY }, { diff: WANT_DIFF, prevUnchanged: true, curUnchanged: true });
    t('diffThresholds: identical days, an empty day on either side and two empty days give no changes',
        { same: diffT(DAY, DAY), emptyPrev: diffT([], DAY), emptyCur: diffT(DAY, []), both: diffT([], []) }, { same: [], emptyPrev: [], emptyCur: [], both: [] });
    t('diffThresholds: a percent string and a number that mean the same threshold are not a change; a placeholder swapping between 0 and 0.01 is not a change (both are not set); duplicate rows of a port read their first set value',
        { percent: diffT([rec('A', 'P1', 'L', '150%', 1)], [rec('A', 'P1', 'L', 1.5, '100%')]), placeholders: diffT([rec('A', 'P1', 'L', 0, 0)], [rec('A', 'P1', 'L', 0.01, '0.01')]),
          firstSet: diffT([rec('A', 'P1', 'L', 1, 1)], [rec('A', 'P1', 'L', 0, 0), rec('A', 'P1', 'L', 1, 1)]) },
        { percent: [], placeholders: [], firstSet: [] });
    t('diffThresholds: two changes on one VVD sort overall before loading, and loading by pol, whatever the input order; a VVD named like an object property (constructor, __proto__) is an ordinary VVD',
        { order: diffT([rec('B', 'P2', 'L', 1, 1), rec('B', 'P1', 'L', 1, 1), rec('A', 'P1', 'L', 1, 1)], [rec('A', 'P1', 'L', 1, 2), rec('B', 'P1', 'L', 2, 2), rec('B', 'P2', 'L', 2, 3)])
            .map((d) => `${d.vvd}/${d.kind}/${d.pol}`),
          props: diffT([rec('constructor', 'P1', 'L', 1, 1), rec('__proto__', 'P1', 'L', 1, 1), rec('hasOwnProperty', 'P1', 'L', 1, 1)],
              [rec('constructor', 'P1', 'L', 2, 1), rec('__proto__', 'P1', 'L', 1, 2), rec('hasOwnProperty', 'P1', 'L', 1, 1)]).map((d) => `${d.vvd}/${d.kind}/${d.prev}/${d.cur}`),
          propsMissing: missing([rec('constructor', 'P1', 'L', 0, 0), rec('toString', 'P1', 'L', 1, 1)]).count },
        { order: ['A/loading/P1', 'B/overall/', 'B/loading/P1', 'B/loading/P2'],
          props: ['CONSTRUCTOR/overall/1/2', '__PROTO__/loading/1/2'], propsMissing: 1 });

    // ================================================================================================
    // thresholdChangesOverDays
    // ================================================================================================
    // One sailing over four days (given out of order): overall 1.0, 1.2, 1.2, 1.0 and loading 1.0, 1.0, 1.5, 1.5 on 03-01 .. 03-04.
    //   03-02: overall 1 -> 1.2        03-03: loading 1 -> 1.5        03-04: overall 1.2 -> 1 (the same thing changing AGAIN is a second entry)
    // Newest first.
    const D = (date, o, l) => ({ date, rows: [rec('V1', 'P1', 'L1', o, l)] });
    const FOUR = [D('2026-03-03', 1.2, 1.5), D('2026-03-01', 1.0, 1.0), D('2026-03-04', 1.0, 1.5), D('2026-03-02', 1.2, 1.0)];
    const WANT_FOUR = [
        { vvd: 'V1', pol: '', lane: 'L1', kind: 'overall', prev: 1.2, cur: 1, firstSeen: '2026-03-04' },
        { vvd: 'V1', pol: 'P1', lane: 'L1', kind: 'loading', prev: 1, cur: 1.5, firstSeen: '2026-03-03' },
        { vvd: 'V1', pol: '', lane: 'L1', kind: 'overall', prev: 1, cur: 1.2, firstSeen: '2026-03-02' },
    ];
    t('thresholdChangesOverDays: four days given out of order: each change event is one entry with the later date as firstSeen, the same threshold changing twice is two entries, newest first',
        overDays(FOUR), WANT_FOUR);
    t('thresholdChangesOverDays: within one day the entries follow diffThresholds order; a day with the same date twice is one day; bad entries (invalid or impossible date, rows not an array, null, a string) are ignored; fewer than two usable days gives none',
        { within: overDays([{ date: '2026-03-02', rows: [rec('B', 'P1', 'L', 2, 2), rec('A', 'P1', 'L', 2, 2)] }, { date: '2026-03-01', rows: [rec('B', 'P1', 'L', 1, 1), rec('A', 'P1', 'L', 1, 1)] }]).map((d) => `${d.vvd}/${d.kind}`),
          splitDay: overDays([{ date: '2026-03-02', rows: [rec('A', 'P1', 'L', 2, 1)] }, { date: '2026-03-01', rows: [rec('A', 'P1', 'L', 1, 1)] }, { date: '2026-03-02', rows: [rec('B', 'P1', 'L', 2, 1)] }, { date: '2026-03-01', rows: [rec('B', 'P1', 'L', 1, 1)] }]).map((d) => `${d.vvd}@${d.firstSeen}`),
          bad: overDays([{ date: '2026-02-30', rows: [rec('A', 'P1', 'L', 9, 9)] }, { date: '2026-3-1', rows: [] }, { date: '2026-03-02', rows: 'x' }, { date: 20260302, rows: [] }, null, 'x', 7, { rows: [] }, [],
              { date: '2026-03-01', rows: [rec('A', 'P1', 'L', 1, 1)] }, { date: '2026-03-03', rows: [rec('A', 'P1', 'L', 2, 1)] }]).map((d) => `${d.vvd}@${d.firstSeen}`),
          one: overDays([D('2026-03-01', 1, 1)]), none: overDays([]), sameDay: overDays([D('2026-03-01', 1, 1), D('2026-03-01', 2, 2).rows.length ? { date: '2026-03-01', rows: [] } : null]) },
        { within: ['A/overall', 'A/loading', 'B/overall', 'B/loading'], splitDay: ['A@2026-03-02', 'B@2026-03-02'], bad: ['A@2026-03-03'], one: [], none: [], sameDay: [] });
    t('thresholdChangesOverDays: a gap in the dates still diffs the two neighbouring days that exist, and an entry is reported against the later of the pair',
        overDays([D('2026-03-01', 1, 1), D('2026-03-09', 1.1, 1)]), [{ vvd: 'V1', pol: '', lane: 'L1', kind: 'overall', prev: 1, cur: 1.1, firstSeen: '2026-03-09' }]);

    // ================================================================================================
    // Purity
    // ================================================================================================
    {
        const Fn = BFShared.thresholdValue.constructor;
        const realm = new Fn('return this')();
        const battery = () => JSON.stringify([
            [1.2, 0, 0.01, '150%', ' 1.5 ', 'x', NaN, null, boom].map((x) => tv(x)),
            missing(DAY), diffT(PREV, CUR), overDays(FOUR), overDays([null, { date: 'x', rows: [] }]),
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
        t('purity: with the clock and the random source throwing (and shown to throw), the four functions give exactly the answers they gave normally',
            { live, same: sabotaged === normal }, { live: ['threw', 'threw', 'threw'], same: true });
    }
    {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', '60_threshold_diff.js'), 'utf8');
        const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
        const found = ['Date', 'Math\\.random', 'performance', 'process', 'window', 'document', 'setTimeout', 'setInterval', 'eval', 'Function', 'require', 'Intl', 'toLocale[A-Za-z]*']
            .filter((w) => new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`).test(code));
        t('purity: the code of shared/60_threshold_diff.js (comment lines removed) names no Date, Math.random, performance, process, window, document, timer, eval, Function, require, Intl or locale method',
            found, []);
    }

    // ================================================================================================
    // Real data: the committed 9-day CSV
    // ================================================================================================
    const H = Object.assign({ COL: history.COL }, history.loadHistory());
    const toRows = (date) => H.rowsOn(date).map((row) => rec(row[H.COL.vvd], row[H.COL.pol], row[H.COL.lane], row[H.COL.overallThreshold], row[H.COL.loadingThreshold]));
    const days = H.dates.map((date) => ({ date, rows: toRows(date) }));
    // Pinned (and cross-checked by an independent oracle): [date, count, sailings.length, ports.length]
    const REAL_MISSING = [
        ['2026-08-24', 178, 37, 178], ['2026-08-25', 126, 20, 126], ['2026-08-26', 110, 17, 110], ['2026-08-27', 97, 13, 97], ['2026-08-28', 97, 14, 97],
        ['2026-08-29', 93, 14, 93], ['2026-08-30', 93, 14, 93], ['2026-08-31', 98, 16, 98], ['2026-09-01', 66, 7, 66],
    ];
    t('real data (9-day CSV, MCT Overall Threshold and MCT Loading Threshold columns): per day [date, sailing-ports missing, sailings missing overall, ports missing loading] equal the pinned constants',
        days.map((d) => { const m = missing(d.rows); return [d.date, m.count, m.sailings.length, m.ports.length]; }), REAL_MISSING);

    // An oracle written from the raw cell text, not from the shared code: a cell is "set" when it parses to a number that is neither 0 nor 0.01.
    const isSet = (text) => { const s = String(text == null ? '' : text).trim(); if (s === '' || isNaN(Number(s))) return false; const n = Number(s); return Math.abs(n) > 1e-9 && Math.abs(n - 0.01) > 1e-9; };
    const oracle = (date) => {
        const sailingSet = new Map();
        const portSet = new Map();
        for (const row of H.realRows(date)) {
            const v = String(row[H.COL.vvd]).trim().toUpperCase();
            const p = String(row[H.COL.pol]).trim().toUpperCase();
            sailingSet.set(v, sailingSet.get(v) || isSet(row[H.COL.overallThreshold]));
            portSet.set(`${v}|${p}`, portSet.get(`${v}|${p}`) || isSet(row[H.COL.loadingThreshold]));
        }
        let count = 0;
        let ports = 0;
        for (const [key, set] of portSet) { if (!set) ports++; if (!set || !sailingSet.get(key.split('|')[0])) count++; }
        return [date, count, [...sailingSet.values()].filter((x) => !x).length, ports];
    };
    t('real data: the same per-day numbers from an oracle written from the raw CSV text (Number() on the cell, no shared code) equal the shared function\'s',
        days.map((d) => oracle(d.date)), REAL_MISSING);

    const changes = overDays(days);
    const byKind = changes.reduce((acc, c) => { acc[c.kind] = (acc[c.kind] || 0) + 1; return acc; }, {});
    const byDay = {};
    changes.forEach((c) => { byDay[`${c.firstSeen} ${c.kind}`] = (byDay[`${c.firstSeen} ${c.kind}`] || 0) + 1; });
    t('real data: threshold changes over the 9 days: total, per kind and per firstSeen day equal the pinned constants, newest day first',
        { total: changes.length, byKind, byDay, newestFirst: changes.every((c, i) => i === 0 || changes[i - 1].firstSeen >= c.firstSeen) },
        { total: 105, byKind: { overall: 25, loading: 80 },
          byDay: { '2026-09-01 overall': 12, '2026-09-01 loading': 40, '2026-08-29 overall': 3, '2026-08-29 loading': 6, '2026-08-27 overall': 4, '2026-08-27 loading': 12,
              '2026-08-26 overall': 4, '2026-08-26 loading': 18, '2026-08-25 overall': 2, '2026-08-25 loading': 4 },
          newestFirst: true });
    t('real data: the first five change entries (BRXT6235E, nominated with no threshold on 2026-08-31 and given 1.0 on 2026-09-01)',
        changes.slice(0, 5),
        [{ vvd: 'BRXT6235E', pol: '', lane: 'INE', kind: 'overall', prev: null, cur: 1, firstSeen: '2026-09-01' },
         { vvd: 'BRXT6235E', pol: 'USCHS', lane: 'INE', kind: 'loading', prev: null, cur: 1, firstSeen: '2026-09-01' },
         { vvd: 'BRXT6235E', pol: 'USNYC', lane: 'INE', kind: 'loading', prev: null, cur: 1, firstSeen: '2026-09-01' },
         { vvd: 'BRXT6235E', pol: 'USORF', lane: 'INE', kind: 'loading', prev: null, cur: 1, firstSeen: '2026-09-01' },
         { vvd: 'BRXT6235E', pol: 'USSAV', lane: 'INE', kind: 'loading', prev: null, cur: 1, firstSeen: '2026-09-01' }]);
    // Print the numbers for the record (the orchestrator cross-checks them).
    if (process.env.BF_PRINT_THRESHOLD_NUMBERS) {
        console.log(`threshold numbers: ${JSON.stringify({ perDay: REAL_MISSING, total: changes.length, byKind, byDay })}`);
    }
};

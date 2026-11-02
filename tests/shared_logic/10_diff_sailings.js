'use strict';
/**
 * Behaviour tests for BFShared.diffSailings (shared/10_diff_sailings.js, roadmap slice 2.1): the
 * sailing-level "what changed since the previous day" engine.
 *
 * Two kinds of evidence, on purpose:
 *   1. The committed 9-day CSV (ctx.history = tests/lib/history_days.js). Rows are mapped to the neutral
 *      record shape { vvd, lane, saleWeek, pol, laden, booking, util } with every value left as the
 *      CSV's own TEXT, VMS placeholder rows INCLUDED (the engine must ignore them itself). The pinned
 *      numbers come from tests/fixtures/HISTORICAL_EXPECTED_VALUES.md and tests/check_history_days.js,
 *      measured on the data (and, for the rollover, re-derived with Python's csv module); the class
 *      memberships are compared with the reference oracles in tests/lib/history_days.js on ALL 8
 *      consecutive pairs, so the shared function and the oracle cannot drift apart.
 *   2. Small synthetic days for every edge case (empty or missing day, identical days, nulls, string
 *      numerics, untrimmed or mixed-case VVDs, a changed lane, VMS and blank rows, thresholds, a booking
 *      conflict, huge inputs). Their expected values are worked out by hand in the comments.
 *
 * The real-data derivations here (ladenOf, bookingOf, utilOf) are written independently of the shared
 * code, from H.sailings(), the way tests/check_history_days.js writes them.
 *
 * Nothing here defines a function named like the export (tests/check_shared_sync.js check E scans tests/
 * for a second definition of a shared name), so the calls go through the local name `diff`.
 */
exports.TESTS = ['diffSailings'];
exports.COUNT = 56;
exports.run = function (ctx) {
    const { BFShared, history: H, t } = ctx;
    const h = H.loadHistory();
    const { COL } = H;
    const diff = (prev, cur, opts) => BFShared.diffSailings(prev, cur, opts);

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------
    const toRec = (row) => ({
        vvd: row[COL.vvd], lane: row[COL.lane], saleWeek: row[COL.saleWeek], pol: row[COL.pol],
        laden: row[COL.laden], booking: row[COL.booking], util: row[COL.polUtil],
    });
    const day = (d) => h.rowsOn(d).map(toRec);   // VMS rows included on purpose
    const PAIRS = h.pairs();
    const ROLLOVER = { prev: '2026-08-30', cur: '2026-08-31' };
    const rec = (vvd, saleWeek, pol, laden, booking, util, lane) => ({ vvd, lane: lane === undefined ? 'L1' : lane, saleWeek, pol, laden, booking, util });
    const sail = (vvd, saleWeek, laden, booking, extra) => Object.assign({ vvd, lane: 'L1', saleWeek, laden, booking }, extra || {});
    const vvds = (list) => list.map((s) => s.vvd);
    const sum = H.sum;
    const num = H.toNumber;
    const ZERO_TOTALS = { laden: { out: 0, in: 0, arrived: 0, continuing: 0, net: 0 }, booking: { out: 0, in: 0, arrived: 0, continuing: 0, net: 0 } };
    const NULL_TOTALS = { laden: { out: null, in: null, arrived: null, continuing: null, net: null }, booking: { out: null, in: null, arrived: null, continuing: null, net: null } };
    const shape = (o) => Object.assign({
        noBaseline: false, noCurrent: false, prevSailings: 0, curSailings: 0,
        rolledOut: [], removed: [], rolledIn: [], arrived: [], changed: [], unchanged: 0, movedCount: 0,
        bookingConflicts: [], totals: ZERO_TOTALS,
    }, o);

    // Independent sailing-level values from the CSV (the oracles' derivation; see check_history_days.js).
    const ladenOf = (s) => sum(s.rows.map((r) => num(r[COL.laden])));
    const bookingOf = (s) => num(s.rows[0][COL.booking]);
    const utilOf = (s) => Math.max(...s.rows.map((r) => num(r[COL.polUtil])));

    const results = PAIRS.map((p) => diff(day(p.prev), day(p.cur)));
    const rollover = results[PAIRS.findIndex((p) => p.prev === ROLLOVER.prev)];

    // ---------------------------------------------------------------------------------------------
    // Real data: the rollover pair 2026-08-30 -> 2026-08-31
    // ---------------------------------------------------------------------------------------------
    t('rollover 08-30 -> 08-31: 368 -> 367 sailings; 24 rolled-out, 0 removed, 23 rolled-in, 0 arrived; 344 on both days; every rolled-out sailing is W29 and every rolled-in one W46',
        {
            prev: rollover.prevSailings, cur: rollover.curSailings, flags: [rollover.noBaseline, rollover.noCurrent],
            rolledOut: rollover.rolledOut.length, removed: rollover.removed.length, rolledIn: rollover.rolledIn.length, arrived: rollover.arrived.length,
            bothDays: rollover.changed.length + rollover.unchanged,
            outWeeks: [...new Set(rollover.rolledOut.map((s) => s.saleWeek))], inWeeks: [...new Set(rollover.rolledIn.map((s) => s.saleWeek))],
        },
        { prev: 368, cur: 367, flags: [false, false], rolledOut: 24, removed: 0, rolledIn: 23, arrived: 0, bothDays: 344, outWeeks: ['2026/W29'], inWeeks: ['2026/W46'] });

    t('rollover totals, sailing level (pinned in HISTORICAL_EXPECTED_VALUES.md): laden OUT 26,065 IN 136 continuing +1,248 net -24,681; booking OUT 25,287 IN 100 continuing +1,260 net -23,927',
        rollover.totals,
        { laden: { out: 26065, in: 136, arrived: 0, continuing: 1248, net: -24681 }, booking: { out: 25287, in: 100, arrived: 0, continuing: 1260, net: -23927 } });

    {
        // The double-count trap: 'Measures Total Booking TEU by Service' repeats the sailing's number on every
        // port row, so summing the rows overstates it. The row-level sums below are computed here from the raw
        // CSV rows, the way a naive implementation would, and pinned (69,625 / 282 / 3,254 / -66,089).
        const set = (list) => new Set(list.map((s) => s.vvd));
        const gone = set([...rollover.rolledOut, ...rollover.removed]);
        const arrived = set([...rollover.rolledIn, ...rollover.arrived]);
        const rowBooking = (date, keep) => sum(h.realRows(date).filter((r) => keep(r[COL.vvd])).map((r) => num(r[COL.booking])));
        const naiveOut = rowBooking(ROLLOVER.prev, (v) => gone.has(v));
        const naiveIn = rowBooking(ROLLOVER.cur, (v) => arrived.has(v));
        const naiveNet = rowBooking(ROLLOVER.cur, () => true) - rowBooking(ROLLOVER.prev, () => true);
        t('double-count guard: the sailing-level booking totals differ from the naive row sums (OUT 69,625 / IN 282 / continuing +3,254 / net -66,089) because the column repeats on every port row',
            { sailing: rollover.totals.booking, naiveRows: { out: naiveOut, in: naiveIn, continuing: naiveNet - naiveIn + naiveOut, net: naiveNet }, netDiffers: rollover.totals.booking.net !== naiveNet },
            { sailing: { out: 25287, in: 100, arrived: 0, continuing: 1260, net: -23927 }, naiveRows: { out: 69625, in: 282, continuing: 3254, net: -66089 }, netDiffers: true });
    }

    t('three real changed sailings, each verified by hand against the CSV rows: AAET0373E (one port), YSHT0011W (four ports; laden is the SUM, the peak-port util 0.86 does not move although a smaller port fell from 0.40 to 0.02), HRDT0015W (two ports, laden 2,031+65 -> 2,756+67)',
        [
            diff(day('2026-08-30'), day('2026-08-31')).changed.find((c) => c.vvd === 'AAET0373E'),
            diff(day('2026-08-25'), day('2026-08-26')).changed.find((c) => c.vvd === 'YSHT0011W'),
            diff(day('2026-08-27'), day('2026-08-28')).changed.find((c) => c.vvd === 'HRDT0015W'),
        ],
        [
            { vvd: 'AAET0373E', lane: 'MAR', saleWeek: '2026/W37', ladenPrev: 1630, ladenCur: 1646, ladenDelta: 16, bookingPrev: 815, bookingCur: 823, bookingDelta: 8, utilPrev: 0.69, utilCur: 0.7, utilDelta: 0.01, moved: false },
            { vvd: 'YSHT0011W', lane: 'EC2', saleWeek: '2026/W34', ladenPrev: 3345, ladenCur: 2446, ladenDelta: -899, bookingPrev: 3345, bookingCur: 2446, bookingDelta: -899, utilPrev: 0.86, utilCur: 0.86, utilDelta: 0, moved: true },
            { vvd: 'HRDT0015W', lane: 'PS6', saleWeek: '2026/W37', ladenPrev: 2096, ladenCur: 2823, ladenDelta: 727, bookingPrev: 2096, bookingCur: 2823, bookingDelta: 727, utilPrev: 1.09, utilCur: 1.48, utilDelta: 0.39, moved: true },
        ]);

    t('CGBT0016E, the one-day-diff blind spot: on 08-31 it is just rolled-in (W46, nothing says it was here as W45 until 08-27), and on 08-28 just removed (W45); only history can see it return',
        {
            back: rollover.rolledIn.filter((s) => s.vvd === 'CGBT0016E'),
            left: diff(day('2026-08-27'), day('2026-08-28')).removed.filter((s) => s.vvd === 'CGBT0016E'),
        },
        { back: [sail('CGBT0016E', '2026/W46', 50, 50, { lane: 'AL5' })], left: [sail('CGBT0016E', '2026/W45', 50, 50, { lane: 'AL5' })] });

    // ---------------------------------------------------------------------------------------------
    // Real data: all 8 consecutive pairs
    // ---------------------------------------------------------------------------------------------
    PAIRS.forEach((p, i) => {
        const dis = H.classifyDisappearances(h, p.prev, p.cur);
        const arr = H.classifyArrivals(h, p.prev, p.cur);
        const r = results[i];
        t(`${p.prev} -> ${p.cur}: the shared classes equal the oracles' (VVD lists: rolled-out and removed from classifyDisappearances, rolled-in and arrived = mid-window from classifyArrivals)`,
            { rolledOut: vvds(r.rolledOut), removed: vvds(r.removed), rolledIn: vvds(r.rolledIn), arrived: vvds(r.arrived) },
            { rolledOut: dis.rolledOut, removed: dis.removed, rolledIn: arr.rolledIn, arrived: arr.midWindow });
    });

    t('per pair: removed 21,1,0,5,1,0,0,1; rolled-out 24 on 08-30 -> 08-31 only; rolled-in 23 on that pair only; arrived 2,1,0,2,1,0,0,2; sailings on both days 369,370,371,366,367,368,344,366; daily sailing counts 390..368 (the pinned list)',
        {
            removed: results.map((r) => r.removed.length), rolledOut: results.map((r) => r.rolledOut.length),
            rolledIn: results.map((r) => r.rolledIn.length), arrived: results.map((r) => r.arrived.length),
            bothDays: results.map((r) => r.changed.length + r.unchanged),
            prevSailings: results.map((r) => r.prevSailings), curSailings: results.map((r) => r.curSailings),
        },
        {
            removed: [21, 1, 0, 5, 1, 0, 0, 1], rolledOut: [0, 0, 0, 0, 0, 0, 24, 0], rolledIn: [0, 0, 0, 0, 0, 0, 23, 0], arrived: [2, 1, 0, 2, 1, 0, 0, 2],
            bothDays: [369, 370, 371, 366, 367, 368, 344, 366],
            prevSailings: [390, 371, 371, 371, 368, 368, 368, 367], curSailings: [371, 371, 371, 368, 368, 368, 367, 368],
        });

    t('net = in - out + continuing exactly, for laden and for booking, on all 8 pairs',
        {
            laden: results.map((r) => r.totals.laden.in - r.totals.laden.out + r.totals.laden.continuing),
            booking: results.map((r) => r.totals.booking.in - r.totals.booking.out + r.totals.booking.continuing),
        },
        { laden: results.map((r) => r.totals.laden.net), booking: results.map((r) => r.totals.booking.net) });

    {
        // Totals recomputed from H.sailings() with no shared code and no classification: OUT = the previous-day
        // value of every sailing that is gone, IN = the current-day value of every new one, continuing = the sum
        // of cur - prev over the rest, net = the day totals' difference.
        // arrived = the current-day value of the oracle's mid-window arrivals (new VVDs whose sale week already existed).
        const arrivedOf = (p, f) => {
            const sc = h.sailings(p.cur);
            return sum(H.classifyArrivals(h, p.prev, p.cur).midWindow.map((v) => f(sc.get(v))));
        };
        const expected = PAIRS.map((p) => {
            const sp = h.sailings(p.prev);
            const sc = h.sailings(p.cur);
            const both = [...sc.values()].filter((s) => sp.has(s.vvd));
            const goneS = [...sp.values()].filter((s) => !sc.has(s.vvd));
            const newS = [...sc.values()].filter((s) => !sp.has(s.vvd));
            const measure = (f) => ({
                out: sum(goneS.map(f)), in: sum(newS.map(f)),
                continuing: sum(both.map((s) => f(s) - f(sp.get(s.vvd)))),
                net: sum([...sc.values()].map(f)) - sum([...sp.values()].map(f)),
            });
            return { laden: measure(ladenOf), booking: measure(bookingOf) };
        });
        t('sailing-level totals on all 8 pairs equal the independent recomputation from H.sailings()', results.map((r) => r.totals), expected.map((e, i) => ({ laden: Object.assign({ arrived: arrivedOf(PAIRS[i], ladenOf) }, e.laden), booking: Object.assign({ arrived: arrivedOf(PAIRS[i], bookingOf) }, e.booking) })));

        // The changed list, unchanged count and moved count, independently: a sailing present on both days has
        // changed when its laden SUM, its booking or its peak-port util differs.
        const exp2 = PAIRS.map((p) => {
            const sp = h.sailings(p.prev);
            const both = [...h.sailings(p.cur).values()].filter((s) => sp.has(s.vvd));
            const ch = both.filter((s) => {
                const a = sp.get(s.vvd);
                return ladenOf(s) !== ladenOf(a) || bookingOf(s) !== bookingOf(a) || utilOf(s) !== utilOf(a);
            });
            return {
                changed: ch.map((s) => s.vvd).sort(), unchanged: both.length - ch.length,
                moved: ch.filter((s) => Math.abs(ladenOf(s) - ladenOf(sp.get(s.vvd))) >= 100).length,
            };
        });
        t('changed VVDs, unchanged count and moved count (|laden delta| >= 100) on all 8 pairs equal the independent recomputation',
            results.map((r) => ({ changed: vvds(r.changed), unchanged: r.unchanged, moved: r.movedCount })), exp2);
    }

    t('the same day twice: nothing rolled, removed, arrived or changed; all 368 sailings unchanged; every total 0 (not null)',
        diff(day('2026-09-01'), day('2026-09-01')),
        shape({ prevSailings: 368, curSailings: 368, unchanged: 368 }));

    {
        // Row order must not matter: reversing both days' rows gives the very same result.
        t('input row order does not change the result (rollover pair, both days reversed)',
            diff(day(ROLLOVER.prev).reverse(), day(ROLLOVER.cur).reverse()), rollover);
        t('the result is plain JSON data: it equals its own JSON round trip (no undefined, NaN, Infinity or Date anywhere)',
            rollover, JSON.parse(JSON.stringify(rollover)));
        const prev = day(ROLLOVER.prev);
        const cur = day(ROLLOVER.cur);
        const before = JSON.stringify([prev, cur]);
        diff(prev, cur);
        t('the input arrays and records are not mutated', JSON.stringify([prev, cur]), before);
    }

    // ---------------------------------------------------------------------------------------------
    // Synthetic: every class, by hand
    // ---------------------------------------------------------------------------------------------
    const S1_PREV = [
        rec('OUT1', '2026/W29', 'P1', 100, 400, 0.5), rec('OUT1', '2026/W29', 'P2', 50, 400, 0.9),
        rec('CHG1', '2026/W30', 'P1', 200, 300, 0.5),
        rec('SAME', '2026/W30', 'P1', 10, 20, 0.1), rec('SAME', '2026/W30', 'P2', 5, 20, 0.2),
        rec('REM1', '2026/W31', 'P1', 70, 80, 0.3),
        rec('VMS', '2026/W33', '', '', '', ''),
    ];
    const S1_CUR = [
        rec('CHG1', '2026/W30', 'P1', 340, 310, 0.6),
        rec('SAME', '2026/W30', 'P1', 10, 20, 0.1), rec('SAME', '2026/W30', 'P2', 5, 20, 0.2),
        rec('ARR1', '2026/W31', 'P1', 20, 30, 0.2),
        rec('IN01', '2026/W32', 'P1', 5, 6, 0.1),
        rec('VMS', '2026/W29', '', '', '', ''),   // a VMS row must not keep W29 "present": OUT1 still rolled out
    ];
    // By hand. OUT1: gone, W29 absent from today's real rows (the VMS row does not count) -> rolled-out, laden 100+50,
    // booking 400 (once, not 800). REM1: gone, W31 still present (ARR1) -> removed. IN01: new, W32 not in yesterday's
    // rows -> rolled-in. ARR1: new, W31 existed yesterday -> arrived. CHG1: laden 200 -> 340 (+140, moved), booking +10,
    // util 0.5 -> 0.6. SAME is identical: booking 20 once although it has two port rows.
    // Laden: OUT 150+70 = 220, IN 5+20 = 25, continuing +140, net = (340+15+20+5) - (150+200+15+70) = -55 = 25-220+140.
    // Booking: OUT 400+80 = 480, IN 6+30 = 36, continuing +10, net = (310+20+30+6) - (400+300+20+80) = -434.
    // Arrived is IN without the rolled-in IN01: laden 20, booking 30.
    const S1_WANT = shape({
        prevSailings: 4, curSailings: 4,
        rolledOut: [sail('OUT1', '2026/W29', 150, 400)],
        removed: [sail('REM1', '2026/W31', 70, 80)],
        rolledIn: [sail('IN01', '2026/W32', 5, 6)],
        arrived: [sail('ARR1', '2026/W31', 20, 30)],
        changed: [{ vvd: 'CHG1', lane: 'L1', saleWeek: '2026/W30', ladenPrev: 200, ladenCur: 340, ladenDelta: 140, bookingPrev: 300, bookingCur: 310, bookingDelta: 10, utilPrev: 0.5, utilCur: 0.6, utilDelta: 0.1, moved: true }],
        unchanged: 1, movedCount: 1,
        totals: { laden: { out: 220, in: 25, arrived: 20, continuing: 140, net: -55 }, booking: { out: 480, in: 36, arrived: 30, continuing: 10, net: -434 } },
    });
    t('small scenario with every class (rolled-out, removed, rolled-in, arrived, changed, unchanged), a VMS row on each day, a multi-port sailing counted once: the whole output', diff(S1_PREV, S1_CUR), S1_WANT);
    t('the same scenario with both days\' rows reversed gives the same output (lists are sorted by VVD, not by input order)', diff(S1_PREV.slice().reverse(), S1_CUR.slice().reverse()), S1_WANT);

    t('a lane or sale week that changes while the VVD stays: the sailing is reported with TODAY\'s lane and week (MOV1 L1/W30 -> L2/W31 with laden +50); a lane change alone is not a change (LAN1)',
        (() => {
            const r = diff(
                [rec('MOV1', '2026/W30', 'P1', 100, 200, 0.5, 'L1'), rec('LAN1', '2026/W30', 'P1', 10, 20, 0.1, 'L1'), rec('KEEP', '2026/W30', 'P1', 1, 1, 0.1, 'L1')],
                [rec('MOV1', '2026/W31', 'P1', 150, 200, 0.5, 'L2'), rec('LAN1', '2026/W30', 'P1', 10, 20, 0.1, 'L9'), rec('KEEP', '2026/W30', 'P1', 1, 1, 0.1, 'L1')]);
            return { changed: r.changed.map((c) => [c.vvd, c.lane, c.saleWeek, c.ladenDelta]), unchanged: r.unchanged, classes: [r.rolledOut, r.removed, r.rolledIn, r.arrived].map((l) => l.length) };
        })(),
        { changed: [['MOV1', 'L2', '2026/W31', 50]], unchanged: 2, classes: [0, 0, 0, 0] });

    t('sale week edge cases: a blank sale week cannot prove a roll-out or roll-in, so a gone BLK1 is removed and a new BLK2 is arrived (NEW9, W9 not in yesterday\'s rows, is rolled-in)',
        (() => {
            const r = diff(
                [rec('BLK1', '', 'P', 1, 1, 0.1), rec('STAY', '2026/W1', 'P', 1, 1, 0.1)],
                [rec('STAY', '2026/W1', 'P', 1, 1, 0.1), rec('BLK2', '', 'P', 1, 1, 0.1), rec('NEW9', '2026/W9', 'P', 1, 1, 0.1)]);
            return { rolledOut: vvds(r.rolledOut), removed: vvds(r.removed), rolledIn: vvds(r.rolledIn), arrived: vvds(r.arrived), blankWeekKept: r.removed[0].saleWeek };
        })(),
        { rolledOut: [], removed: ['BLK1'], rolledIn: ['NEW9'], arrived: ['BLK2'], blankWeekKept: '' });

    t('sale weeks named like Object.prototype members ("constructor", "__proto__", "valueOf") are ordinary weeks: P1 and P2 are rolled-out, NEW1 is rolled-in (a plain-object lookup would misfile all three)',
        (() => {
            const r = diff(
                [rec('P1', 'constructor', 'P', 1, 1, 0.1), rec('P2', '__proto__', 'P', 1, 1, 0.1), rec('KEEP', 'toString', 'P', 1, 1, 0.1)],
                [rec('KEEP', 'hasOwnProperty', 'P', 1, 1, 0.1), rec('NEW1', 'valueOf', 'P', 1, 1, 0.1)]);
            return { rolledOut: vvds(r.rolledOut), removed: vvds(r.removed), rolledIn: vvds(r.rolledIn), arrived: vvds(r.arrived) };
        })(),
        { rolledOut: ['P1', 'P2'], removed: [], rolledIn: ['NEW1'], arrived: [] });

    // ---------------------------------------------------------------------------------------------
    // Synthetic: records that are ignored, and VVD normalisation
    // ---------------------------------------------------------------------------------------------
    t('records ignored on both days: VMS (any case, padded), blank and whitespace VVDs, null vvd, a record with no vvd, null, undefined, a number, a string, an array; only REAL1 counts',
        diff(
            [rec('VMS', 'W1', '', 5, 5, 0.1), rec(' vms ', 'W1', '', 5, 5, 0.1), rec('', 'W1', 'P', 5, 5, 0.1), rec('   ', 'W1', 'P', 5, 5, 0.1), rec(null, 'W1', 'P', 5, 5, 0.1),
                { laden: 5 }, null, undefined, 42, 'text', [], rec('REAL1', 'W1', 'P1', 1, 1, 0.1)],
            [rec('REAL1', 'W1', 'P1', 1, 1, 0.1), rec('Vms', 'W9', '', 9, 9, 0.1), rec('', 'W9', 'P', 9, 9, 0.1)]),
        shape({ prevSailings: 1, curSailings: 1, unchanged: 1 }));

    t('mixed-case and untrimmed VVDs name the same sailing on both days and are reported upper-case and trimmed: " abc1w " = "ABC1W" + "abc1w" (laden 6+4 = 10, unchanged); "xyz2e" 5 -> "XYZ2E " 9 is changed',
        (() => {
            const r = diff(
                [rec(' abc1w ', 'W1', 'P1', 10, 100, 0.5), rec('xyz2e', 'W1', 'P1', 5, 50, 0.5)],
                [rec('ABC1W', 'W1', 'P1', 6, 100, 0.5), rec('abc1w', 'W1', 'P2', 4, 100, 0.5), rec('XYZ2E ', 'W1', 'P1', 9, 50, 0.5)]);
            return { prevSailings: r.prevSailings, curSailings: r.curSailings, unchanged: r.unchanged, changed: r.changed.map((c) => [c.vvd, c.ladenPrev, c.ladenCur]), classes: [r.rolledOut, r.removed, r.rolledIn, r.arrived].map((l) => l.length) };
        })(),
        { prevSailings: 2, curSailings: 2, unchanged: 1, changed: [['XYZ2E', 5, 9]], classes: [0, 0, 0, 0] });

    // ---------------------------------------------------------------------------------------------
    // Synthetic: no baseline, no current day, identical days
    // ---------------------------------------------------------------------------------------------
    t('empty previous day: noBaseline is true and nothing is classified (not "everything rolled-in"); the full shape is kept with empty lists, curSailings filled in and every total null',
        diff([], [rec('A1', 'W1', 'P', 10, 20, 0.5), rec('A2', 'W2', 'P', 1, 1, 0.1)]),
        shape({ noBaseline: true, curSailings: 2, totals: NULL_TOTALS }));
    t('a previous or current day that is not an array (undefined, null, a string, a number, an object) counts as empty, and a day with only VMS rows is empty too; calling with no arguments does not throw',
        [undefined, null, 'text', 42, {}, [rec('VMS', 'W1', '', 1, 1, 0.1)]].map((prev) => {
            const r = diff(prev, [rec('A1', 'W1', 'P', 10, 20, 0.5)]);
            return [r.noBaseline, r.noCurrent, r.prevSailings, r.curSailings, r.rolledIn.length];
        }).concat([(() => { const r = diff(); return [r.noBaseline, r.noCurrent, r.prevSailings, r.curSailings, r.totals.laden.net]; })()]),
        [[true, false, 0, 1, 0], [true, false, 0, 1, 0], [true, false, 0, 1, 0], [true, false, 0, 1, 0], [true, false, 0, 1, 0], [true, false, 0, 1, 0], [true, true, 0, 0, null]]);
    t('empty current day (an empty or wrong file): noCurrent is true and the 2 sailings are NOT all called rolled-out; full shape, prevSailings filled in, totals null',
        diff([rec('A1', 'W1', 'P', 10, 20, 0.5), rec('A2', 'W2', 'P', 1, 1, 0.1)], []),
        shape({ noCurrent: true, prevSailings: 2, totals: NULL_TOTALS }));
    t('identical days (a copy with the rows in another order, 3 sailings, 2 of them multi-port): changed is empty, unchanged = 3, every class empty, every total 0',
        diff(
            [rec('A1', 'W1', 'P1', 10, 20, 0.5), rec('A1', 'W1', 'P2', 5, 20, 0.2), rec('A2', 'W2', 'P1', 7, 7, 0.1), rec('A3', 'W2', 'P1', 3, 9, 0.3), rec('A3', 'W2', 'P2', 1, 9, 0.4)],
            [rec('A3', 'W2', 'P2', 1, 9, 0.4), rec('A3', 'W2', 'P1', 3, 9, 0.3), rec('A2', 'W2', 'P1', 7, 7, 0.1), rec('A1', 'W1', 'P2', 5, 20, 0.2), rec('A1', 'W1', 'P1', 10, 20, 0.5)]),
        shape({ prevSailings: 3, curSailings: 3, unchanged: 3 }));

    // ---------------------------------------------------------------------------------------------
    // Synthetic: nulls and string numerics
    // ---------------------------------------------------------------------------------------------
    t('a null laden stays null and is never 0: N1 null -> 50 changes with ladenDelta null (not 50, not 0), moved false, and its continuing total is null (the only continuing sailing has no known delta: unknown, not 0), so is net; its booking and util deltas are real numbers',
        diff([rec('N1', 'W1', 'P1', null, 10, 0.1)], [rec('N1', 'W1', 'P1', 50, 10, 0.1)]),
        shape({
            prevSailings: 1, curSailings: 1,
            changed: [{ vvd: 'N1', lane: 'L1', saleWeek: 'W1', ladenPrev: null, ladenCur: 50, ladenDelta: null, bookingPrev: 10, bookingCur: 10, bookingDelta: 0, utilPrev: 0.1, utilCur: 0.1, utilDelta: 0, moved: false }],
            totals: { laden: { out: 0, in: 0, arrived: 0, continuing: null, net: null }, booking: ZERO_TOTALS.booking },
        }));
    t('null on both days is unchanged and stays null in every list: N2 (null and blank rows) is unchanged, the gone N3 reports laden null, and a field that is null on every sailing of both days has null totals (laden), while booking still sums its known values (out 10)',
        diff(
            [rec('N2', 'W1', 'P1', '', 10, 0.1), rec('N2', 'W1', 'P2', null, 10, 0.1), rec('N3', 'W2', 'P1', null, 10, 0.1)],
            [rec('N2', 'W1', 'P1', null, 10, 0.1), rec('N2', 'W1', 'P2', '  ', 10, 0.1)]),
        shape({
            prevSailings: 2, curSailings: 1,
            rolledOut: [sail('N3', 'W2', null, 10)], unchanged: 1,
            totals: { laden: NULL_TOTALS.laden, booking: { out: 10, in: 0, arrived: 0, continuing: 0, net: -10 } },
        }));
    t('with nulls the identity net = in - out + continuing still holds: P null -> 50 has no delta so continuing is null (unknown) and nothing of it reaches net, Q (30) is out, R (7) is in: laden net -23 = 7 - 30 + (null counted as nothing)',
        (() => {
            const r = diff(
                [rec('P', 'W1', 'P1', null, 1, 0.1), rec('Q', 'W1', 'P1', 30, 1, 0.1)],
                [rec('P', 'W1', 'P1', 50, 1, 0.1), rec('R', 'W1', 'P1', 7, 1, 0.1)]);
            return { totals: r.totals.laden, identity: r.totals.laden.in - r.totals.laden.out + r.totals.laden.continuing };
        })(),
        { totals: { out: 30, in: 7, arrived: 7, continuing: null, net: -23 }, identity: -23 });
    t('a continuing sailing whose laden goes 100 -> NaN (not a number reads as null) does not change continuing or net: only the known sailing K (+5) counts, and the identity holds',
        (() => {
            const r = diff(
                [rec('LOST', 'W1', 'P1', 100, 1, 0.1), rec('K', 'W1', 'P1', 10, 1, 0.1)],
                [rec('LOST', 'W1', 'P1', NaN, 1, 0.1), rec('K', 'W1', 'P1', 15, 1, 0.1)]);
            return { totals: r.totals.laden, identity: r.totals.laden.in - r.totals.laden.out + r.totals.laden.continuing, lost: r.changed.filter((c) => c.vvd === 'LOST').map((c) => [c.ladenPrev, c.ladenCur, c.ladenDelta]) };
        })(),
        { totals: { out: 0, in: 0, arrived: 0, continuing: 5, net: 5 }, identity: 5, lost: [[100, null, null]] });

    {
        // Every accepted and refused form of a numeric cell. A single gone sailing carries the cell as its laden, so
        // the sailing's laden is exactly what the parser made of it.
        const FORMS = [
            ['1,234', 1234], ['(1,234)', -1234], ['(-1,234)', -1234], ['12%', 0.12], [' 5 ', 5], ['', null], ['  ', null],
            ['1,5', null], ['1,23', null], ['1,2345', null], ['1.234,5', null], ['-1,234.5', -1234.5], ['abc', null], ['0x10', null],
            ['Infinity', null], ['-Infinity', null], ['NaN', null], ['1e3', 1000], ['.5', 0.5], ['5.', 5], ['+7', 7], ['-3', -3],
            ['%', null], ['(5', null], ['1 000', null], ['0', 0], ['(0)', 0],
            [null, null], [undefined, null], [true, null], [{}, null], [[], null],
            [7, 7], [0, 0], [-0, 0], [NaN, null], [Infinity, null], [-Infinity, null], [1234.5, 1234.5],
            // Negative zero never comes out (the runner's canon tells -0 from 0): '-0' and '(-0)' parse to -0, and -1e-10
            // rounds to -0 in the 1e-9 noise rounding; every one must come back as +0.
            ['-0', 0], ['(-0)', 0], [-1e-10, 0],
        ];
        t('numeric cells: "1,234" -> 1234, "(1,234)" and "(-1,234)" -> -1234, "12%" -> 0.12, blank / null / garbage / "1,5" / "0x10" / "Infinity" / NaN -> null (never 0), numbers pass through',
            FORMS.map(([f]) => diff([rec('GONE', 'W9', 'P', f, 1, 0.1)], [rec('KEEP', 'W1', 'P', 1, 1, 0.1)]).rolledOut[0].laden),
            FORMS.map(([, want]) => want));
    }
    t('string numerics on every measure: laden "1,234" -> "1,334" (+100, moved), booking " 5 " -> "(7)" (-12), util "12%" -> "0.15" (0.12 -> 0.15, delta 0.03, no float noise); a null util row beside a real one is ignored',
        diff([rec('S1', 'W1', 'P1', '1,234', ' 5 ', '12%'), rec('S1', 'W1', 'P2', null, ' 5 ', null)], [rec('S1', 'W1', 'P1', '1,334', '(7)', '0.15'), rec('S1', 'W1', 'P2', '', '(7)', '')]).changed,
        [{ vvd: 'S1', lane: 'L1', saleWeek: 'W1', ladenPrev: 1234, ladenCur: 1334, ladenDelta: 100, bookingPrev: 5, bookingCur: -7, bookingDelta: -12, utilPrev: 0.12, utilCur: 0.15, utilDelta: 0.03, moved: true }]);

    // ---------------------------------------------------------------------------------------------
    // Synthetic: sailing-level values
    // ---------------------------------------------------------------------------------------------
    t('sailing level, not row level: DBL1 has 3 port rows each carrying booking 1,000 and laden 100/200/300 -> booking 1,000 -> 900 is -100 (not -300), laden 600 -> 550 is -50, and the totals say the same',
        diff(
            [rec('DBL1', 'W1', 'P1', 100, 1000, 0.1), rec('DBL1', 'W1', 'P2', 200, 1000, 0.2), rec('DBL1', 'W1', 'P3', 300, 1000, 0.3)],
            [rec('DBL1', 'W1', 'P1', 100, 900, 0.1), rec('DBL1', 'W1', 'P2', 200, 900, 0.2), rec('DBL1', 'W1', 'P3', 250, 900, 0.3)]),
        shape({
            prevSailings: 1, curSailings: 1,
            changed: [{ vvd: 'DBL1', lane: 'L1', saleWeek: 'W1', ladenPrev: 600, ladenCur: 550, ladenDelta: -50, bookingPrev: 1000, bookingCur: 900, bookingDelta: -100, utilPrev: 0.3, utilCur: 0.3, utilDelta: 0, moved: false }],
            totals: { laden: { out: 0, in: 0, arrived: 0, continuing: -50, net: -50 }, booking: { out: 0, in: 0, arrived: 0, continuing: -100, net: -100 } },
        }));
    t('util is the MAX over a sailing\'s port rows: MAXU 0.9 -> 0.95 is a change of +0.05; NOMAX moves a smaller port 0.5 -> 0.6 under an unchanged peak of 0.9, so it is unchanged',
        (() => {
            const r = diff(
                [rec('MAXU', 'W1', 'P1', 5, 5, 0.5), rec('MAXU', 'W1', 'P2', 5, 5, 0.9), rec('NOMAX', 'W1', 'P1', 5, 5, 0.5), rec('NOMAX', 'W1', 'P2', 5, 5, 0.9)],
                [rec('MAXU', 'W1', 'P1', 5, 5, 0.5), rec('MAXU', 'W1', 'P2', 5, 5, 0.95), rec('NOMAX', 'W1', 'P1', 5, 5, 0.6), rec('NOMAX', 'W1', 'P2', 5, 5, 0.9)]);
            return { changed: r.changed.map((c) => [c.vvd, c.utilPrev, c.utilCur, c.utilDelta, c.ladenDelta, c.bookingDelta, c.moved]), unchanged: r.unchanged };
        })(),
        { changed: [['MAXU', 0.9, 0.95, 0.05, 0, 0, false]], unchanged: 1 });
    t('floating-point noise is removed from sums: a sailing whose port rows hold laden 0.1 and 0.2 has laden 0.3 exactly (not 0.30000000000000004), also in the OUT total',
        (() => { const r = diff([rec('FP1', 'W9', 'P1', 0.1, 1, 0.1), rec('FP1', 'W9', 'P2', 0.2, 1, 0.1)], [rec('KEEP', 'W1', 'P', 1, 1, 0.1)]); return [r.rolledOut[0].laden, r.totals.laden.out]; })(),
        [0.3, 0.3]);

    // ---------------------------------------------------------------------------------------------
    // Synthetic: opts.movedTeu
    // ---------------------------------------------------------------------------------------------
    {
        // Five continuing sailings all at laden 1,000 on day one: +99, +100, -100, -99, and a booking-only change.
        const prev = ['M1', 'M2', 'M3', 'M4', 'M5'].map((v) => rec(v, 'W1', 'P1', 1000, 500, 0.5));
        const cur = [rec('M1', 'W1', 'P1', 1099, 500, 0.5), rec('M2', 'W1', 'P1', 1100, 500, 0.5), rec('M3', 'W1', 'P1', 900, 500, 0.5), rec('M4', 'W1', 'P1', 901, 500, 0.5), rec('M5', 'W1', 'P1', 1000, 501, 0.5)];
        const r = diff(prev, cur);
        t('movedTeu defaults to 100 and is inclusive: +99 and -99 are not moved, +100 and -100 are; a booking-only change (laden delta 0) is not moved; movedCount = 2',
            { moved: r.changed.map((c) => [c.vvd, c.ladenDelta, c.moved]), movedCount: r.movedCount },
            { moved: [['M1', 99, false], ['M2', 100, true], ['M3', -100, true], ['M4', -99, false], ['M5', 0, false]], movedCount: 2 });
        const count = (o) => diff(prev, cur, o).movedCount;
        t('opts.movedTeu sets the threshold (>=): 0 -> 4 (a laden delta of 0 is never moved, even at a threshold of 0), 50 and "50" -> 4, 99 -> 4, 100 -> 2, 101 -> 0',
            { 0: count({ movedTeu: 0 }), 50: count({ movedTeu: 50 }), '"50"': count({ movedTeu: '50' }), 99: count({ movedTeu: 99 }), 100: count({ movedTeu: 100 }), 101: count({ movedTeu: 101 }) },
            { 0: 4, 50: 4, '"50"': 4, 99: 4, 100: 2, 101: 0 });
        t('an unusable opts or movedTeu (undefined, null, {}, 5, "abc", -5, NaN, "") falls back to the default 100',
            [undefined, null, {}, 5, { movedTeu: 'abc' }, { movedTeu: -5 }, { movedTeu: NaN }, { movedTeu: '' }].map(count),
            [2, 2, 2, 2, 2, 2, 2, 2]);
    }

    // ---------------------------------------------------------------------------------------------
    // Synthetic: bookingConflict
    // ---------------------------------------------------------------------------------------------
    {
        const prev = [
            rec('CNF1', '2026/W29', 'P1', 10, 100, 0.1), rec('CNF1', '2026/W29', 'P2', 20, 120, 0.1),      // rows disagree: 100 vs 120
            rec('OKK2', '2026/W29', 'P1', 1, '100', 0.1), rec('OKK2', '2026/W29', 'P2', 1, '100.0', 0.1),  // same number, other text: no conflict
            rec('NUL1', '2026/W30', 'P1', 5, null, 0.1), rec('NUL1', '2026/W30', 'P2', 5, 50, 0.1),        // a null beside a number disagrees
            rec('CMP1', '2026/W30', 'P1', 5, 10, 0.1),
            rec('OKK1', '2026/W30', 'P1', 1, 7, 0.1),
        ];
        const cur = [
            rec('NUL1', '2026/W30', 'P1', 5, 50, 0.1), rec('NUL1', '2026/W30', 'P2', 5, 50, 0.1),
            rec('CMP1', '2026/W30', 'P1', 5, 10, 0.1), rec('CMP1', '2026/W30', 'P2', 3, 11, 0.1),          // conflict appears on the current day
            rec('OKK1', '2026/W30', 'P1', 1, 7, 0.1),
        ];
        const r = diff(prev, cur);
        t('bookingConflict: CNF1 (100 vs 120) is reported with booking 100, the first row\'s value, and bookingConflict true; OKK2 ("100" and "100.0") is not flagged; the list names every conflicting VVD on either day (CMP1 current day, CNF1 and NUL1 previous day)',
            { rolledOut: r.rolledOut, bookingConflicts: r.bookingConflicts, unchanged: r.unchanged },
            { rolledOut: [sail('CNF1', '2026/W29', 30, 100, { bookingConflict: true }), sail('OKK2', '2026/W29', 2, 100)], bookingConflicts: ['CMP1', 'CNF1', 'NUL1'], unchanged: 2 });
        t('bookingConflict on a changed sailing: CMP1 (conflict only on the current day; laden 5 -> 8, booking the first row\'s 10 on both days) is flagged; NUL1 (null beside 50 yesterday, 50 and 50 today) takes the first non-null value, 50, and is unchanged',
            r.changed,
            [{ vvd: 'CMP1', lane: 'L1', saleWeek: '2026/W30', ladenPrev: 5, ladenCur: 8, ladenDelta: 3, bookingPrev: 10, bookingCur: 10, bookingDelta: 0, utilPrev: 0.1, utilCur: 0.1, utilDelta: 0, moved: false, bookingConflict: true }]);
    }

    // ---------------------------------------------------------------------------------------------
    // Review findings (2026-10-06): blank totals, the float noise floor, a zero move, conflicts without a baseline
    // ---------------------------------------------------------------------------------------------
    {
        // 1. A field that is blank on every sailing has null totals, never 0. Day one and day two both have a sailing A, a
        // gone sailing G and a new sailing N with booking blank on every row; laden is real, so laden's totals stay numbers.
        const blank = diff(
            [rec('A', 'W1', 'P1', 10, null, 0.5), rec('G', 'W1', 'P1', 4, '', 0.5)],
            [rec('A', 'W1', 'P1', 12, null, 0.5), rec('N', 'W1', 'P1', 6, '  ', 0.5)]);
        t('totals: booking blank on every row of both days -> every booking total is null (not 0), while laden (real values) keeps its numbers: out 4, in 6, continuing 2, net 4',
            blank.totals,
            { laden: { out: 4, in: 6, arrived: 6, continuing: 2, net: 4 }, booking: NULL_TOTALS.booking });
        // Real zeros stay zeros: booking 0 on every sailing is a known value, not a blank.
        const zeros = diff(
            [rec('A', 'W1', 'P1', 10, 0, 0.5), rec('G', 'W1', 'P1', 4, 0, 0.5)],
            [rec('A', 'W1', 'P1', 10, 0, 0.5), rec('N', 'W1', 'P1', 6, 0, 0.5)]);
        t('totals: booking really 0 on every sailing -> the booking totals are 0 (a known zero is not a blank)',
            zeros.totals.booking, ZERO_TOTALS.booking);
        // One group can be unknown while the others are known: the only gone sailing has a blank booking, a sailing that arrived
        // has 5, and the empty group (arrived is not empty, rolledIn is) stays a real 0. net counts only what is known.
        const mixed = diff(
            [rec('A', 'W1', 'P1', 10, 7, 0.5), rec('G', 'W1', 'P1', 4, null, 0.5)],
            [rec('A', 'W1', 'P1', 10, 9, 0.5), rec('N', 'W1', 'P1', 6, 5, 0.5)]);
        t('totals: a group whose sailings are all blank is null while the others are numbers: G (booking blank) is out -> out null; N (5) arrived -> in 5, arrived 5; A 7 -> 9 continuing 2; net = 5 - 0 + 2 = 7',
            mixed.totals.booking, { out: null, in: 5, arrived: 5, continuing: 2, net: 7 });
    }
    {
        // 3. bookingConflict uses the same 1e-9 noise floor as the change test.
        const noise = diff(
            [rec('F1', 'W1', 'P1', 10, 0.3, 0.5), rec('F1', 'W1', 'P2', 10, 0.1 + 0.2, 0.5)],
            [rec('F1', 'W1', 'P1', 10, 0.3, 0.5), rec('F1', 'W1', 'P2', 10, 0.3, 0.5), rec('F2', 'W1', 'P1', 1, 0.3, 0.5), rec('F2', 'W1', 'P2', 1, 0.31, 0.5)]);
        t('bookingConflict ignores float noise: F1 booking rows 0.3 and 0.1 + 0.2 are one value (no conflict, F1 unchanged); F2 rows 0.3 and 0.31 really disagree and are flagged',
            { conflicts: noise.bookingConflicts, unchanged: noise.unchanged, arrived: noise.arrived.map((x) => [x.vvd, x.bookingConflict === true]) },
            { conflicts: ['F2'], unchanged: 1, arrived: [['F2', true]] });
    }
    {
        // 4. A move needs a real laden change: at movedTeu 0 a booking-only (or util-only) change is not moved.
        const only = diff([rec('Z1', 'W1', 'P1', 10, 5, 0.5), rec('Z2', 'W1', 'P1', 10, 5, 0.5), rec('Z3', 'W1', 'P1', 10, 5, 0.5)],
            [rec('Z1', 'W1', 'P1', 10, 6, 0.5), rec('Z2', 'W1', 'P1', 10, 5, 0.6), rec('Z3', 'W1', 'P1', 11, 5, 0.5)], { movedTeu: 0 });
        t('movedTeu 0: Z1 (laden 10 -> 10, booking 5 -> 6) and Z2 (util only) are changed but not moved; Z3 (laden 10 -> 11) is moved; movedCount 1',
            { moved: only.changed.map((c) => [c.vvd, c.ladenDelta, c.moved]), movedCount: only.movedCount },
            { moved: [['Z1', 0, false], ['Z2', 0, false], ['Z3', 1, true]], movedCount: 1 });
        const noisy = diff([rec('Z4', 'W1', 'P1', 0.3, 5, 0.5)], [rec('Z4', 'W1', 'P1', 0.1 + 0.2, 6, 0.5)], { movedTeu: 0 });
        t('movedTeu 0: a laden delta that is only float noise (0.3 vs 0.1 + 0.2) is not moved',
            { delta: noisy.changed[0].ladenDelta, moved: noisy.changed[0].moved, movedCount: noisy.movedCount },
            { delta: 0, moved: false, movedCount: 0 });
    }
    {
        // 8. bookingConflicts covers the day that exists even when there is nothing to compare it with.
        const rows = [rec('CX', 'W1', 'P1', 10, 5, 0.5), rec('CX', 'W1', 'P2', 10, 6, 0.5), rec('OK', 'W1', 'P1', 1, 2, 0.5)];
        const nb = diff([], rows);
        const nc = diff(rows, []);
        t('no baseline (previous day empty): the current day\'s booking conflicts are still listed (CX), with the rest of the shape as before: noBaseline, curSailings 2, totals null',
            nb, shape({ noBaseline: true, curSailings: 2, bookingConflicts: ['CX'], totals: NULL_TOTALS }));
        t('no current day (current day empty): the previous day\'s booking conflicts are still listed (CX), noCurrent, prevSailings 2, totals null',
            nc, shape({ noCurrent: true, prevSailings: 2, bookingConflicts: ['CX'], totals: NULL_TOTALS }));
    }

    // ---------------------------------------------------------------------------------------------
    // Huge inputs
    // ---------------------------------------------------------------------------------------------
    {
        // 1,250 sailings x 4 ports = 5,000 rows a day. Day 1 has sailings 0..1249, day 2 has 50..1299: 50 removed (their
        // weeks, i % 10, all still exist today), 50 arrived (same reason), 1,200 continuing. Of those, every 5th (by
        // number) gets +10 laden on its first port, every 10th gets +200 instead: 240 changed, 120 of them moved.
        // Laden is 100 a row (400 a sailing), booking 500 a sailing on every row (a row sum would be 4x).
        const row = (i, p, extra) => ({ vvd: 'V' + String(i).padStart(5, '0'), lane: 'L' + (i % 7), saleWeek: '2026/W' + (10 + (i % 10)), pol: 'P' + p, laden: 100 + (p === 0 ? extra : 0), booking: 500, util: 0.5 });
        const prev = [];
        const cur = [];
        for (let i = 0; i < 1250; i++) for (let p = 0; p < 4; p++) prev.push(row(i, p, 0));
        for (let i = 50; i < 1300; i++) for (let p = 0; p < 4; p++) cur.push(row(i, p, i >= 1250 ? 0 : (i % 10 === 0 ? 200 : (i % 5 === 0 ? 10 : 0))));
        const t0 = process.hrtime.bigint();
        const r = diff(prev, cur);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        t('huge input, 5,000 rows a day: 50 removed, 50 arrived, 240 changed (120 moved), 960 unchanged; laden OUT 20,000 IN 20,000 continuing 25,200; booking OUT 25,000 IN 25,000 continuing 0 (not 4x)',
            { rows: [prev.length, cur.length], removed: r.removed.length, arrived: r.arrived.length, rolledOut: r.rolledOut.length, rolledIn: r.rolledIn.length, changed: r.changed.length, moved: r.movedCount, unchanged: r.unchanged, totals: r.totals },
            { rows: [5000, 5000], removed: 50, arrived: 50, rolledOut: 0, rolledIn: 0, changed: 240, moved: 120, unchanged: 960,
              totals: { laden: { out: 20000, in: 20000, arrived: 20000, continuing: 25200, net: 25200 }, booking: { out: 25000, in: 25000, arrived: 25000, continuing: 0, net: 0 } } });
        t('huge input is fast: 5,000 rows x 2 take well under a second (the budget asserted is 1,000 ms; it runs in a few ms)', ms < 1000, true);
    }
};

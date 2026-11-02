#!/usr/bin/env node
/**
 * Headless check for the committed 9-day historical CSV, read DIRECTLY by tests/lib/history_days.js
 * (an RFC 4180 reader that slices the file by `Record Date` in code; no derived data file exists to
 * drift). It pins every "expected value" that the later slices are built against, at the grain the
 * slice uses it, so a future implementation is tested against measured data and not against a guess:
 *
 *   slice 1.5  schema/row-count canary        -> file facts, key uniqueness, voyage-level agreement
 *   slice 2.1  diffSailings                   -> rollover pair, per-pair gone/arrived, classification,
 *                                                the double-count guard (sailing-level booking sums)
 *   slice 2.5  history index                  -> compact index row count and size
 *   slice 3.1  findExceptions                 -> unowned streaks, laden over max, thresholds
 *   slice 5.2  retention curve (evidence)     -> laden by days to the POL cut-off
 *
 * Every value below was re-derived from the CSV by the helper AND, independently, by a Python
 * csv-module implementation (same numbers). tests/fixtures/HISTORICAL_EXPECTED_VALUES.md lists each
 * value with the question it answers and how to regenerate it. Where a number in the roadmap plan
 * differs from what the data says, THE DATA WINS and the README names the difference.
 *
 * This is an executed-count tripwire like tests/check_resolve_app_html.js: EXPECTED below is the
 * number of assertions that must run, so an assertion that is silently dropped (or a loop that ran
 * zero times) fails the check instead of leaving a green run with a hole in it.
 *
 * Run:  node tests/check_history_days.js        (about 1 s; Node builtins only)
 */
'use strict';
const fs = require('fs');
const H = require('./lib/history_days.js');
const { COL } = H;

let pass = 0;
const failures = [];
function t(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) {
        pass++;
    } else {
        failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
    }
}
function throws(fn) {
    try { fn(); return null; } catch (e) { return e; }
}
const r2 = (x) => Math.round(x * 100) / 100;          // medians are pinned to 2 decimals
const obj = (pairs) => Object.fromEntries(pairs);     // tally() result -> plain object

const loadStart = Date.now();
const h = H.loadHistory();
const loadMs = Date.now() - loadStart;
const D = h.dates;
const PAIRS = h.pairs();
const real = h.rows.filter((r) => !H.isVms(r));
const ROLLOVER = { prev: '2026-08-30', cur: '2026-08-31' };

// ============================================================================================
// 1. The reader itself. The pins below are only as good as the parser, so it is tested first.
// ============================================================================================
t('parseCsv: a quoted cell may contain a newline (the 27,312-lines-for-8,769-rows trap)',
    H.parseCsv('a,b\n"x\ny",2\n'), [['a', 'b'], ['x\ny', '2']]);
t('parseCsv: "" inside quotes is one quote character',
    H.parseCsv('"he said ""hi""",z\n'), [['he said "hi"', 'z']]);
t('parseCsv: a UTF-8 BOM is dropped', H.parseCsv('﻿a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
t('parseCsv: CR LF terminators work and a CR LF inside quotes is preserved verbatim',
    H.parseCsv('a,b\r\n"x\r\ny",2\r\n'), [['a', 'b'], ['x\r\ny', '2']]);
t('parseCsv: LF and CR LF files give identical records',
    H.parseCsv('a,b\r\n1,2\r\n3,4'), H.parseCsv('a,b\n1,2\n3,4\n'));
t('parseCsv: no final newline; empty quoted, empty unquoted and a trailing comma at EOF are all empty cells',
    H.parseCsv('a,"",\n,,\nx,y,'), [['a', '', ''], ['', '', ''], ['x', 'y', '']]);
t('parseCsv: a stray blank line is a single empty cell (loadHistory skips it)',
    H.parseCsv('a,b\n1,2\n\n'), [['a', 'b'], ['1', '2'], ['']]);
t('parseCsv: an unterminated quote and junk after a closing quote both throw',
    [!!throws(() => H.parseCsv('a,"oops\n')), !!throws(() => H.parseCsv('"a"b,c\n'))], [true, true]);
t('toNumber: blank and non-numeric are null, never 0',
    ['', '  ', 'x', '0', '1.5', ' 2 ', null, undefined].map(H.toNumber), [null, null, null, 0, 1.5, 2, null, null]);
t('parseMdy: M/D/YYYY -> ISO; impossible or differently shaped dates -> null',
    ['7/17/2026', '12/1/2026', '2/31/2026', '', '2026-07-17'].map(H.parseMdy), ['2026-07-17', '2026-12-01', null, null, null]);
t('daysBetween: whole days in UTC (DST and year boundaries do not matter)',
    [H.daysBetween('2026-03-07', '2026-03-09'), H.daysBetween('2026-12-31', '2027-01-02'), H.daysBetween('2026-09-01', '2026-08-31')],
    [2, 2, -1]);
t('PIC helpers: pair split, blank, and TBA in either half ("TBA / Bob" is NOT blank)',
    [H.picParts({ [COL.pic]: 'Lani / Alex' }), H.isPicBlank({ [COL.pic]: ' ' }), H.isPicBlank({ [COL.pic]: 'TBA / Bob' }),
        H.hasTbaPic({ [COL.pic]: 'Peter / TBA' }), H.hasTbaPic({ [COL.pic]: 'Lani / Alex' })],
    [{ spc: 'Lani', mkg: 'Alex' }, true, false, true, false]);
t('tally sorts by count then value; median handles odd, even and empty input',
    [H.tally(['b', 'a', 'b', 'c'], (x) => x), H.median([3, 1, 2]), H.median([4, 1, 3, 2]), Number.isNaN(H.median([]))],
    [[['b', 2], ['a', 1], ['c', 1]], 2, 2.5, true]);

// ============================================================================================
// 2. File-level facts (slice 1.5, the canary, wants exactly these)
// ============================================================================================
{
    const raw = fs.readFileSync(H.DEFAULT_CSV);
    let lf = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] === 10) lf++;
    t('physical LF bytes 27,312 vs 8,769 data records: `wc -l` is wrong by 3x on this file (use parseCsv)',
        { lf, records: h.rows.length, blankLines: h.blankLines }, { lf: 27312, records: 8769, blankLines: 0 });
}
t('98 columns, every required column present (loadHistory throws on a missing one)', h.headers.length, 98);
t('9 Record Dates, 2026-08-24 .. 2026-09-01, and 8 consecutive pairs one calendar day apart',
    { dates: D, pairs: PAIRS.length, allOneDay: PAIRS.every((p) => H.daysBetween(p.prev, p.cur) === 1) },
    { dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01'], pairs: 8, allOneDay: true });
t('8,769 rows = 8,136 real (non-VMS) + 633 VMS placeholders',
    { rows: h.rows.length, real: real.length, vms: h.rows.filter(H.isVms).length }, { rows: 8769, real: 8136, vms: 633 });
t('rows per date: all / real / VMS / distinct sailings',
    { all: D.map((d) => h.rowsOn(d).length), real: D.map((d) => h.realRows(d).length), vms: D.map((d) => h.vmsRows(d).length), sailings: D.map((d) => h.sailings(d).size) },
    { all: [994, 974, 974, 973, 971, 971, 971, 970, 971], real: [928, 906, 906, 905, 899, 899, 899, 896, 898],
        vms: [66, 68, 68, 68, 72, 72, 72, 74, 73], sailings: [390, 371, 371, 371, 368, 368, 368, 367, 368] });
t('VMS rows: blank POL and blank port seq; real rows: never a blank POL, and the only blank seq are 18 "NO N.A. CALL" rows',
    {
        vmsPolBlank: h.rows.filter(H.isVms).every((r) => r[COL.pol] === ''),
        vmsSeqBlank: h.rows.filter(H.isVms).every((r) => r[COL.seq] === ''),
        realPolBlank: real.filter((r) => r[COL.pol] === '').length,
        realSeqBlank: real.filter((r) => r[COL.seq] === '').length,
        realSeqBlankPols: H.tally(real.filter((r) => r[COL.seq] === ''), (r) => r[COL.pol]),
        realCutoffBlank: real.filter((r) => r[COL.polCutoff] === '').length,
        realCutoffUnparseable: real.filter((r) => r[COL.polCutoff] !== '' && H.parseMdy(r[COL.polCutoff]) === null).length,
    },
    { vmsPolBlank: true, vmsSeqBlank: true, realPolBlank: 0, realSeqBlank: 18, realSeqBlankPols: [['NO N.A. CALL', 18]], realCutoffBlank: 18, realCutoffUnparseable: 0 });
{
    const everVvd = new Set();
    D.forEach((d) => h.vvdSet(d).forEach((v) => everVvd.add(v)));
    const withGap = [...everVvd].filter((v) => /#\.+#/.test(D.map((d) => (h.vvdSet(d).has(v) ? '#' : '.')).join(''))).sort();
    t('420 distinct real VVDs over the 9 days; exactly one VVD (CGBT0016E) leaves and later comes back',
        { distinct: everVvd.size, withGap }, { distinct: 420, withGap: ['CGBT0016E'] });
}
t('rows per sailing on 2026-09-01 (port rows per VVD): 1..5',
    obj(H.tally([...h.sailings('2026-09-01').values()], (s) => s.rows.length).sort((a, b) => a[0] - b[0])),
    { 1: 35, 2: 206, 3: 59, 4: 66, 5: 2 });
t('Past-4-Week flag is a property of the SALE WEEK: the 4 oldest weeks of the window are Y (W29-W32 until 08-30, W30-W33 from 08-31), no week is mixed',
    {
        mixedWeeks: D.reduce((n, d) => n + [...new Set(h.realRows(d).map((r) => r[COL.saleWeek]))].filter((w) =>
            new Set(h.realRows(d).filter((r) => r[COL.saleWeek] === w).map(H.pastFourWeekFlag)).size > 1).length, 0),
        flaggedWeeksAreOldestFour: D.every((d) => {
            const weeks = [...new Set(h.realRows(d).map((r) => r[COL.saleWeek]))].sort();
            const flagged = [...new Set(h.realRows(d).filter((r) => H.pastFourWeekFlag(r) === 'Y').map((r) => r[COL.saleWeek]))].sort();
            return JSON.stringify(flagged) === JSON.stringify(weeks.slice(0, 4));
        }),
        windowWeeks: D.map((d) => new Set(h.realRows(d).map((r) => r[COL.saleWeek])).size),
        first08_30: [...new Set(h.realRows('2026-08-30').map((r) => r[COL.saleWeek]))].sort()[0],
        first08_31: [...new Set(h.realRows('2026-08-31').map((r) => r[COL.saleWeek]))].sort()[0],
        last08_31: [...new Set(h.realRows('2026-08-31').map((r) => r[COL.saleWeek]))].sort().pop(),
    },
    { mixedWeeks: 0, flaggedWeeksAreOldestFour: true, windowWeeks: [17, 17, 17, 17, 17, 17, 17, 17, 17],
        first08_30: '2026/W29', first08_31: '2026/W30', last08_31: '2026/W46' });
t('fewest sailings in any sale week on any day is 16 (a whole week emptying by removals alone is not plausible, which the rolled-out rule relies on)',
    Math.min(...D.map((d) => Math.min(...H.tally([...h.sailings(d).values()], (s) => s.saleWeek).map((x) => x[1])))), 16);

// ============================================================================================
// 3. Key uniqueness and voyage-level agreement (why notes/exceptions can live at sailing grain)
// ============================================================================================
{
    const VOYAGE = [COL.pic, COL.lane, COL.maxLaden, COL.cutoff, COL.saleWeek];
    t('voyage-level fields (PIC, lane, Max Laden, Cut/off Date, 1st Sale Week) agree across a sailing\'s port rows: 0 disagreements on all 9 days (368 sailings on 2026-09-01)',
        { sailings0901: h.sailings('2026-09-01').size, perColumnPerDay: VOYAGE.map((c) => D.map((d) => H.voyageDisagreements(h, d, c)).join('')) },
        { sailings0901: 368, perColumnPerDay: ['000000000', '000000000', '000000000', '000000000', '000000000'] });
}
{
    const dupKeys = (rows, keyFn) => rows.length - new Set(rows.map(keyFn)).size;
    t('real rows: key VVD+Seq+POL (and VVD+POL) has 0 duplicates within a day',
        {
            seqPol: D.map((d) => dupKeys(h.realRows(d), (r) => [r[COL.vvd], r[COL.seq], r[COL.pol]].join('|'))),
            pol: D.map((d) => dupKeys(h.realRows(d), (r) => [r[COL.vvd], r[COL.pol]].join('|'))),
        },
        { seqPol: [0, 0, 0, 0, 0, 0, 0, 0, 0], pol: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    t('trap: VMS rows share one key (VMS, blank, blank), so a key check that forgets to drop them reports (VMS rows - 1) false duplicates a day',
        D.map((d) => dupKeys(h.rowsOn(d), (r) => [r[COL.vvd], r[COL.seq], r[COL.pol]].join('|'))), [65, 67, 67, 67, 71, 71, 71, 73, 72]);
}
{
    // 'Measures Total Booking TEU by Service' repeats the SAME sailing-level number on every port row.
    const sailingBooking = (d) => [...h.sailings(d).values()].reduce((a, s) => a + H.toNumber(s.rows[0][COL.booking]), 0);
    const rowBooking = (d) => h.realRows(d).reduce((a, r) => a + H.toNumber(r[COL.booking]), 0);
    t('Total Booking TEU by Service is SAILING-level: port rows of a multi-row sailing never differ (0 on all 9 days; 333 multi-row sailings on 09-01)',
        {
            multiRow: D.map((d) => [...h.sailings(d).values()].filter((s) => s.rows.length > 1).length),
            differing: D.map((d) => H.voyageDisagreements(h, d, COL.booking)),
        },
        { multiRow: [338, 336, 336, 335, 333, 333, 333, 332, 333], differing: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    t('double-count guard: summing the column over port rows overstates the day total ~2.6x (766,070 vs 298,813 on 08-30; 699,981 vs 274,886 on 08-31)',
        { rowLevel: [rowBooking('2026-08-30'), rowBooking('2026-08-31')], sailingLevel: [sailingBooking('2026-08-30'), sailingBooking('2026-08-31')] },
        { rowLevel: [766070, 699981], sailingLevel: [298813, 274886] });
    t('the row-level day-over-day delta of that column is also wrong on the 08-31 -> 09-01 pair: +10,842 row-level vs +3,968 sailing-level (only this one pair is asserted)',
        { rowLevel: rowBooking('2026-09-01') - rowBooking('2026-08-31'), sailingLevel: sailingBooking('2026-09-01') - sailingBooking('2026-08-31') },
        { rowLevel: 10842, sailingLevel: 3968 });
}

// ============================================================================================
// 4. Sailing-level rollover pair 2026-08-30 -> 2026-08-31 (slice 2.1's main fixture)
// ============================================================================================
{
    const d = H.diffVvds(h, ROLLOVER.prev, ROLLOVER.cur);
    const sp = h.sailings(ROLLOVER.prev);
    const sc = h.sailings(ROLLOVER.cur);
    const goneRows = d.gone.flatMap((v) => sp.get(v).rows);
    const arrRows = d.arrived.flatMap((v) => sc.get(v).rows);
    t('rollover, OUT: 24 VVDs / 61 rows, all sale week 2026/W29, all Past-4-Week = Y',
        { vvds: d.gone.length, rows: goneRows.length, weeks: obj(H.tally(goneRows, (r) => r[COL.saleWeek])), flags: obj(H.tally(goneRows, H.pastFourWeekFlag)) },
        { vvds: 24, rows: 61, weeks: { '2026/W29': 61 }, flags: { Y: 61 } });
    t('rollover, IN: 23 VVDs / 58 rows, all sale week 2026/W46, all Past-4-Week = N',
        { vvds: d.arrived.length, rows: arrRows.length, weeks: obj(H.tally(arrRows, (r) => r[COL.saleWeek])), flags: obj(H.tally(arrRows, H.pastFourWeekFlag)) },
        { vvds: 23, rows: 58, weeks: { '2026/W46': 58 }, flags: { N: 58 } });
    const dis = H.classifyDisappearances(h, ROLLOVER.prev, ROLLOVER.cur);
    const arr = H.classifyArrivals(h, ROLLOVER.prev, ROLLOVER.cur);
    t('rollover classification: 24 rolled-out, 0 removed; 23 rolled-in, 0 mid-window arrivals',
        { rolledOut: dis.rolledOut.length, removed: dis.removed.length, rolledIn: arr.rolledIn.length, midWindow: arr.midWindow.length },
        { rolledOut: 24, removed: 0, rolledIn: 23, midWindow: 0 });
    t('rollover: one of the 23 rolled-in VVDs (CGBT0016E) is NOT new: it was in the file 08-24..08-27 as W45, vanished 08-28..08-30, and returned as W46 with its cut-off moved from 10/21 to 10/27. Only history, not a one-day diff, can see that',
        {
            returning: arr.returning,
            weekByDate: D.map((x) => (h.sailings(x).has('CGBT0016E') ? h.sailings(x).get('CGBT0016E').saleWeek.slice(5) : '-')).join(' '),
            cutoffWhenLeft: h.sailings('2026-08-27').get('CGBT0016E').rows[0][COL.cutoff],
            cutoffWhenBack: h.sailings('2026-08-31').get('CGBT0016E').rows[0][COL.cutoff],
        },
        { returning: ['CGBT0016E'], weekByDate: 'W45 W45 W45 W45 - - - W46 W46', cutoffWhenLeft: '10/21/2026', cutoffWhenBack: '10/27/2026' });

    // Sailing-level numbers for the per-sailing delta tests. Booking is sailing-level (one value per
    // sailing); laden is per (VVD, POL) row, so a sailing's laden is the sum of its port rows.
    const bookingOf = (s) => H.toNumber(s.rows[0][COL.booking]);
    const ladenOf = (s) => H.sum(s.rows.map((r) => H.toNumber(r[COL.laden])));
    const continuing = [...sc.values()].filter((s) => sp.has(s.vvd));
    const out = {
        out: { booking: H.sum(d.gone.map((v) => bookingOf(sp.get(v)))), laden: H.sum(d.gone.map((v) => ladenOf(sp.get(v)))) },
        in: { booking: H.sum(d.arrived.map((v) => bookingOf(sc.get(v)))), laden: H.sum(d.arrived.map((v) => ladenOf(sc.get(v)))) },
        continuing: {
            sailings: continuing.length,
            bookingDelta: H.sum(continuing.map((s) => bookingOf(s) - bookingOf(sp.get(s.vvd)))),
            ladenDelta: H.sum(continuing.map((s) => ladenOf(s) - ladenOf(sp.get(s.vvd)))),
        },
    };
    t('rollover TEU by class, sailing-level: OUT 25,287 booking / 26,065 laden; IN 100 / 136 (the rolled-in sailings are NOT empty: "no new bookings" means "not new demand", not "zero TEU"); 344 continuing sailings +1,260 / +1,248',
        out, { out: { booking: 25287, laden: 26065 }, in: { booking: 100, laden: 136 }, continuing: { sailings: 344, bookingDelta: 1260, ladenDelta: 1248 } });
    t('rollover nets: sailing-level booking 298,813 -> 274,886 = -23,927 and laden 312,009 -> 287,328 = -24,681 reconcile exactly to OUT + IN + continuing; the naive row-level booking sum would say -66,089',
        {
            bookingNet: out.in.booking - out.out.booking + out.continuing.bookingDelta,
            ladenNet: out.in.laden - out.out.laden + out.continuing.ladenDelta,
            ladenDayTotals: [ROLLOVER.prev, ROLLOVER.cur].map((x) => H.sum(h.realRows(x).map((r) => H.toNumber(r[COL.laden])))),
            naiveRowBookingDelta: H.sum(h.realRows(ROLLOVER.cur).map((r) => H.toNumber(r[COL.booking]))) - H.sum(h.realRows(ROLLOVER.prev).map((r) => H.toNumber(r[COL.booking]))),
        },
        { bookingNet: -23927, ladenNet: -24681, ladenDayTotals: [312009, 287328], naiveRowBookingDelta: -66089 });
    t('rollover trap: the naive ROW-level booking sums are OUT 69,625 / IN 282 / continuing +3,254 (the same column repeated on every port row)',
        {
            out: H.sum(goneRows.map((r) => H.toNumber(r[COL.booking]))),
            in: H.sum(arrRows.map((r) => H.toNumber(r[COL.booking]))),
            continuing: H.sum(continuing.map((s) => H.sum(s.rows.map((r) => H.toNumber(r[COL.booking]))) - H.sum(sp.get(s.vvd).rows.map((r) => H.toNumber(r[COL.booking]))))),
        },
        { out: 69625, in: 282, continuing: 3254 });
}

// ============================================================================================
// 5. Per consecutive pair: who leaves, who arrives, and the proposed classification
// ============================================================================================
{
    const perPair = (fn) => PAIRS.map((p) => fn(p.prev, p.cur));
    const gone = perPair((a, b) => H.diffVvds(h, a, b).gone);
    const arrived = perPair((a, b) => H.diffVvds(h, a, b).arrived);
    t('per pair, VVDs leaving: 21, 1, 0, 5, 1, 0, 24, 1 (rows 60, 2, 0, 10, 2, 0, 61, 1)',
        { vvds: gone.map((g) => g.length), rows: PAIRS.map((p, i) => gone[i].reduce((n, v) => n + h.sailings(p.prev).get(v).rows.length, 0)) },
        { vvds: [21, 1, 0, 5, 1, 0, 24, 1], rows: [60, 2, 0, 10, 2, 0, 61, 1] });
    t('per pair, VVDs arriving (NEW VVDs): 2, 1, 0, 2, 1, 0, 23, 2 (rows 6, 2, 0, 4, 2, 0, 58, 3); 31 arrivals in all',
        { vvds: arrived.map((g) => g.length), rows: PAIRS.map((p, i) => arrived[i].reduce((n, v) => n + h.sailings(p.cur).get(v).rows.length, 0)), total: arrived.reduce((n, g) => n + g.length, 0) },
        { vvds: [2, 1, 0, 2, 1, 0, 23, 2], rows: [6, 2, 0, 4, 2, 0, 58, 3], total: 31 });
    const dis = perPair((a, b) => H.classifyDisappearances(h, a, b));
    t('plan note VERIFIED: removals per pair 21, 1, 0, 5, 1, 0, 0, 1 and rolled-out 0 on every pair except 08-30 -> 08-31 (24)',
        { removed: dis.map((x) => x.removed.length), rolledOut: dis.map((x) => x.rolledOut.length) },
        { removed: [21, 1, 0, 5, 1, 0, 0, 1], rolledOut: [0, 0, 0, 0, 0, 0, 24, 0] });
    const arr = perPair((a, b) => H.classifyArrivals(h, a, b));
    t('per pair, arrivals split: rolled-in 23 on 08-31 and 0 elsewhere; mid-window 2, 1, 0, 2, 1, 0, 0, 2',
        { rolledIn: arr.map((x) => x.rolledIn.length), midWindow: arr.map((x) => x.midWindow.length) },
        { rolledIn: [0, 0, 0, 0, 0, 0, 23, 0], midWindow: [2, 1, 0, 2, 1, 0, 0, 2] });
    t('(a) real new nominations (VMS placeholder -> real VVD, INFERRED by lane + sale week since VMS rows carry no VVD): only PNAT2639S (08-29) and YWMT0002W (09-01); none on any rollover',
        { nominated: arr.map((x) => x.nominated), nominatedOnRolloverPair: arr[6].nominated.length }, { nominated: [[], [], [], [], ['PNAT2639S'], [], [], ['YWMT0002W']], nominatedOnRolloverPair: 0 });

    // 2026-08-24 -> 08-25: the big mid-window disappearance
    const sp = h.sailings('2026-08-24');
    const g1 = gone[0];
    const rows1 = g1.flatMap((v) => sp.get(v).rows);
    t('08-24 -> 08-25: 21 VVDs / 60 rows leave; sale weeks W29..W45 (17 distinct); rows flagged Past-4-Week N 48 / Y 12 (sailings N 17 / Y 4); 18 are lane FLX',
        {
            weeks: obj(H.tally(g1.map((v) => sp.get(v)), (s) => s.saleWeek).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
            rowFlags: obj(H.tally(rows1, H.pastFourWeekFlag)),
            sailingFlags: obj(H.tally(g1.map((v) => sp.get(v)), (s) => H.pastFourWeekFlag(s.rows[0]))),
            lanes: obj(H.tally(g1.map((v) => sp.get(v)), (s) => s.lane)),
        },
        {
            weeks: { '2026/W29': 1, '2026/W30': 1, '2026/W31': 1, '2026/W32': 1, '2026/W33': 1, '2026/W34': 1, '2026/W35': 1, '2026/W36': 1, '2026/W37': 1, '2026/W38': 1,
                '2026/W39': 1, '2026/W40': 1, '2026/W41': 2, '2026/W42': 1, '2026/W43': 1, '2026/W44': 2, '2026/W45': 3 },
            rowFlags: { N: 48, Y: 12 }, sailingFlags: { N: 17, Y: 4 }, lanes: { FLX: 18, AT1: 1, EC4: 1, PN3: 1 },
        });
    t('flag-only trap: 4 of those 21 carry Past-4-Week = Y (W29..W32) yet no sale week left the window that day (W29..W45 are all still present on 08-25), so it is NOT a rollover; the sale-week rule calls all 21 "removed", a flag-only rule would call 4 "rolled-out"',
        { flagYGone: g1.filter((v) => H.pastFourWeekFlag(sp.get(v).rows[0]) === 'Y').sort(), weeks: g1.filter((v) => H.pastFourWeekFlag(sp.get(v).rows[0]) === 'Y').map((v) => sp.get(v).saleWeek).sort() },
        { flagYGone: ['CGIT0021N', 'HEWT0144N', 'IAIT0006N', 'IKET0014N'], weeks: ['2026/W29', '2026/W30', '2026/W31', '2026/W32'] });
    // 2026-08-27 -> 08-28
    const sp27 = h.sailings('2026-08-27');
    const g4 = gone[3];
    t('08-27 -> 08-28: 5 VVDs / 10 rows leave (7E3T0001W, CGBT0016E, CPRT2636S, SNVT2637S, YCOT0192W), all Past-4-Week N',
        { vvds: g4, rows: g4.reduce((n, v) => n + sp27.get(v).rows.length, 0), flags: obj(H.tally(g4.flatMap((v) => sp27.get(v).rows), H.pastFourWeekFlag)),
            weeks: obj(H.tally(g4.map((v) => sp27.get(v)), (s) => s.saleWeek).sort((a, b) => (a[0] < b[0] ? -1 : 1))) },
        { vvds: ['7E3T0001W', 'CGBT0016E', 'CPRT2636S', 'SNVT2637S', 'YCOT0192W'], rows: 10, flags: { N: 10 }, weeks: { '2026/W38': 1, '2026/W39': 1, '2026/W42': 1, '2026/W45': 2 } });
    // blank-PIC link (slice 3.1): 17 of the 20 blank-PIC sailings on 08-24 are among the 21 that leave
    const blank24 = [...sp.values()].filter((s) => s.rows.every(H.isPicBlank));
    t('20 sailings (55 rows) are blank-PIC on ALL port rows on 08-24; 17 of them (all lane FLX) are among the 21 that leave next day; the 3 that stay are GJMT0003W, HTET1002W, WAHT0613W',
        {
            sailings: blank24.length, rows: blank24.reduce((n, s) => n + s.rows.length, 0),
            amongGone: blank24.filter((s) => g1.includes(s.vvd)).length,
            goneLanes: obj(H.tally(blank24.filter((s) => g1.includes(s.vvd)), (s) => s.lane)),
            stay: blank24.filter((s) => !g1.includes(s.vvd)).map((s) => s.vvd).sort(),
        },
        { sailings: 20, rows: 55, amongGone: 17, goneLanes: { FLX: 17 }, stay: ['GJMT0003W', 'HTET1002W', 'WAHT0613W'] });
}
{
    // What changes on sailings present on BOTH days (slice 2.1's "changed" class)
    const changes = (read) => PAIRS.map((p) => {
        const a = h.sailings(p.prev);
        return [...h.sailings(p.cur).values()].filter((s) => a.has(s.vvd) && read(a.get(s.vvd)) !== read(s)).length;
    });
    t('sailings present on both days that changed: sale week 4,0,1,0,3,0,0,1; PIC 7,6,1,7,3,0,0,9; cut-off date 32,20,25,21,22,3,16,27; lane never. A sale week CAN move while a VVD stays (the rule must read the sale week from the day the sailing was last seen)',
        {
            both: PAIRS.map((p) => [...h.sailings(p.cur).keys()].filter((v) => h.sailings(p.prev).has(v)).length),
            saleWeek: changes((s) => s.saleWeek), pic: changes((s) => s.rows[0][COL.pic]),
            cutoff: changes((s) => s.rows[0][COL.cutoff]), lane: changes((s) => s.lane),
        },
        { both: [369, 370, 371, 366, 367, 368, 344, 366], saleWeek: [4, 0, 1, 0, 3, 0, 0, 1], pic: [7, 6, 1, 7, 3, 0, 0, 9],
            cutoff: [32, 20, 25, 21, 22, 3, 16, 27], lane: [0, 0, 0, 0, 0, 0, 0, 0] });
}

// ============================================================================================
// 6. Unowned sailings and TBA (slice 3.1 (a))
// ============================================================================================
t('blank-PIC rows per day (real rows; VMS rows are never blank): 55, 4, 4, 4, 6, 4, 4, 8, 7 = 96 rows. A sailing is never PARTLY blank (0 sailing-days with some rows blank)',
    {
        perDay: D.map((d) => h.realRows(d).filter(H.isPicBlank).length), total: h.rows.filter(H.isPicBlank).length,
        vmsBlank: h.rows.filter((r) => H.isVms(r) && H.isPicBlank(r)).length,
        partial: D.reduce((n, d) => n + [...h.sailings(d).values()].filter((s) => s.rows.some(H.isPicBlank) && !s.rows.every(H.isPicBlank)).length, 0),
    },
    { perDay: [55, 4, 4, 4, 6, 4, 4, 8, 7], total: 96, vmsBlank: 0, partial: 0 });
{
    const atLeast = (asOf, n) => [...H.unownedStreaks(h, asOf)].filter(([, k]) => k >= n).map(([v]) => v).sort();
    t('unowned for N=3 consecutive days, per as-of date: none until 08-26 (the 17 leave on 08-25), then GJMT0003W, HTET1002W, WAHT0613W through 08-31, then HTET1002W, WAHT0613W on 09-01',
        D.map((d) => atLeast(d, 3)),
        [[], [], ['GJMT0003W', 'HTET1002W', 'WAHT0613W'], ['GJMT0003W', 'HTET1002W', 'WAHT0613W'], ['GJMT0003W', 'HTET1002W', 'WAHT0613W'],
            ['GJMT0003W', 'HTET1002W', 'WAHT0613W'], ['GJMT0003W', 'HTET1002W', 'WAHT0613W'], ['GJMT0003W', 'HTET1002W', 'WAHT0613W'], ['HTET1002W', 'WAHT0613W']]);
    t('as of 2026-08-31 (N=3): 3 sailings, 8 days each; as of 2026-09-01: 2 sailings, 9 days each',
        {
            a0831: obj([...H.unownedStreaks(h, '2026-08-31')].filter(([, k]) => k >= 3).sort()),
            a0901: obj([...H.unownedStreaks(h, '2026-09-01')].filter(([, k]) => k >= 3).sort()),
        },
        { a0831: { GJMT0003W: 8, HTET1002W: 8, WAHT0613W: 8 }, a0901: { HTET1002W: 9, WAHT0613W: 9 } });
    t('GJMT0003W leaves the list on 09-01 because it gets "TBA / Bob" (a half-assigned PIC is not blank: whether TBA counts as unowned is Kevin\'s D4 question); WKPT6240E (new on 08-31, 4 port rows, all blank) reaches 2 days on 09-01',
        {
            gjmtPicByDay: D.map((d) => [...new Set(h.sailings(d).get('GJMT0003W').rows.map((r) => r[COL.pic]))].join('|')),
            wkptFirstSeen: D.find((d) => h.sailings(d).has('WKPT6240E')),
            wkpt0901: H.unownedStreaks(h, '2026-09-01').get('WKPT6240E'),
            allDaysN: D.map((d) => [...H.unownedStreaks(h, d)].filter(([, k]) => k >= 1).length),
            n2On0901: [...H.unownedStreaks(h, '2026-09-01')].filter(([, k]) => k >= 2).map(([v]) => v).sort(),
        },
        { gjmtPicByDay: ['', '', '', '', '', '', '', '', 'TBA / Bob'], wkptFirstSeen: '2026-08-31', wkpt0901: 2,
            allDaysN: [20, 3, 3, 3, 4, 3, 3, 4, 3], n2On0901: ['HTET1002W', 'WAHT0613W', 'WKPT6240E'] });
    {
        // D4 evidence: WHERE the unowned sailings are. The three that persist at N=3 are all on the EXE/EXW lanes.
        const everBlank = new Map();
        D.forEach((d) => h.sailings(d).forEach((s) => { if (s.rows.every(H.isPicBlank)) everBlank.set(s.vvd, s); }));
        const blankRows = h.rows.filter(H.isPicBlank);
        t('D4 evidence: the 22 sailings that are ever blank-PIC on all rows sit on lanes FLX 17 (the ones that vanish), EXW 2, ANG 1, EXE 1, INE 1; the three that persist (GJMT0003W EXE, HTET1002W EXW, WAHT0613W EXW) are all on EXE/EXW, the lanes Kevin asked about; on all 96 blank-PIC rows both analyst columns are blank too',
            {
                ever: everBlank.size,
                lanes: obj(H.tally([...everBlank.values()], (s) => s.lane)),
                persistentLanes: ['GJMT0003W', 'HTET1002W', 'WAHT0613W'].map((v) => v + ':' + everBlank.get(v).lane),
                analystsBlankToo: blankRows.filter((r) => r['MCT Spc Analyst'] === '' && r['MCT Mktg Analyst'] === '').length,
                blankRows: blankRows.length,
            },
            { ever: 22, lanes: { FLX: 17, EXW: 2, ANG: 1, EXE: 1, INE: 1 }, persistentLanes: ['GJMT0003W:EXE', 'HTET1002W:EXW', 'WAHT0613W:EXW'], analystsBlankToo: 96, blankRows: 96 });
    }
    t('base rates the panel will live with: with N=3 the list is 0 or 2-3 sailings a day; with N=1 it is 20 on day one and 3-4 afterwards',
        { n3: D.map((d) => atLeast(d, 3).length), n1: D.map((d) => H.unownedStreaks(h, d).size) },
        { n3: [0, 0, 3, 3, 3, 3, 3, 3, 2], n1: [20, 3, 3, 3, 4, 3, 3, 4, 3] });
}
{
    const tba = real.filter(H.hasTbaPic);
    t('TBA in either PIC half: 239 real rows / 28 sailings: "Peter / TBA" 96, "TBA / Alex" 67, "TBA / Marissa" 40, "TBA / Bob" 36 (the fourth pair is easy to miss: 96+67+40 is only 203); the 633 VMS rows add 145 more TBA rows',
        { rows: tba.length, sailings: new Set(tba.map((r) => r[COL.vvd])).size, pairs: obj(H.tally(tba, (r) => r[COL.pic])), vmsTba: h.rows.filter((r) => H.isVms(r) && H.hasTbaPic(r)).length },
        { rows: 239, sailings: 28, pairs: { 'Peter / TBA': 96, 'TBA / Alex': 67, 'TBA / Marissa': 40, 'TBA / Bob': 36 }, vmsTba: 145 });
}

// ============================================================================================
// 7. Thresholds and utilisation (slice 3.1 (b); Kevin's D2 decides what they mean)
// ============================================================================================
{
    const r0901 = h.realRows('2026-09-01');
    t('MCT Overall Threshold on 2026-09-01 over the 898 real rows',
        H.tally(r0901, (r) => H.toNumber(r[COL.overallThreshold])),
        [[1.5, 267], [1.2, 164], [1, 143], [1.25, 69], [1.35, 64], [1.6, 51], [0.75, 42], [1.15, 30], [1.65, 28], [1.8, 28], [0, 12]]);
    t('MCT Loading Threshold on 2026-09-01 over the same 898 real rows',
        H.tally(r0901, (r) => H.toNumber(r[COL.loadingThreshold])),
        [[1.5, 283], [1, 187], [1.2, 108], [0.75, 57], [0, 52], [2, 52], [1.6, 48], [1.15, 30], [1.65, 20], [1.4, 18], [1.25, 16], [0.01, 14], [0.5, 13]]);
    t('thresholds: never blank on a real row (0 is a real value, 12 + 52 rows on 09-01), always blank on VMS rows (73 of 73); an individual sailing\'s Overall Threshold changes across the 9 days for 23 of the 368 sailings on 09-01',
        {
            realBlank: real.filter((r) => r[COL.overallThreshold] === '' || r[COL.loadingThreshold] === '').length,
            vmsBlank: h.vmsRows('2026-09-01').filter((r) => r[COL.overallThreshold] === '' && r[COL.loadingThreshold] === '').length,
            vmsRows: h.vmsRows('2026-09-01').length,
            varying: [...h.sailings('2026-09-01').keys()].filter((v) =>
                new Set(D.filter((d) => h.sailings(d).has(v)).map((d) => h.sailings(d).get(v).rows[0][COL.overallThreshold])).size > 1).length,
        },
        { realBlank: 0, vmsBlank: 73, vmsRows: 73, varying: 23 });
}
{
    const util = (r) => H.toNumber(r[COL.polUtil]);
    t('POL Booking Utilz > 1.0: 613 of 8,136 real rows (about 68 a day; none blank), on 55, 65, 69, 76, 69, 72, 72, 67, 68 rows per day',
        { total: real.filter((r) => util(r) > 1).length, perDay: D.map((d) => h.realRows(d).filter((r) => util(r) > 1).length), blank: real.filter((r) => util(r) === null).length },
        { total: 613, perDay: [55, 65, 69, 76, 69, 72, 72, 67, 68], blank: 0 });
    // D2 evidence. These are DATA facts; what they mean is Kevin's question (D2), not asserted here.
    const LOAD_STATUS = 'Measures Loading Status';
    const loadThr = (r) => H.toNumber(r[COL.loadingThreshold]);
    t('D2 evidence 1: the feed already carries an over-threshold-looking status: Measures Loading Status is "" 7,343 / "AP Only" 688 / "AP Frozen" 105 rows',
        H.tally(real, (r) => r[LOAD_STATUS] || '(blank)'), [['(blank)', 7343], ['AP Only', 688], ['AP Frozen', 105]]);
    t('D2 evidence 2: POL Booking Utilz > the row\'s own MCT Loading Threshold on 1,002 rows (MORE than the 613 a flat 1.0 would flag: thresholds of 0, 0.01, 0.5 and 0.75 trip easily); 612 of the 688 "AP Only" rows are among them, 49 of 105 "AP Frozen"',
        {
            over: real.filter((r) => util(r) > loadThr(r)).length,
            apOnlyOver: real.filter((r) => r[LOAD_STATUS] === 'AP Only' && util(r) > loadThr(r)).length,
            apFrozenOver: real.filter((r) => r[LOAD_STATUS] === 'AP Frozen' && util(r) > loadThr(r)).length,
            blankStatusOver: real.filter((r) => r[LOAD_STATUS] === '' && util(r) > loadThr(r)).length,
        },
        { over: 1002, apOnlyOver: 612, apFrozenOver: 49, blankStatusOver: 341 });
    t('D2 evidence 3: "Trunk Threshold" equals MCT Overall Threshold on all 8,136 real rows; "POL Laden Threshold" equals MCT Loading Threshold on 8,011, and on the other 125 rows (15 sailings) a Loading Threshold of 0 shows as 1.2 there',
        {
            trunkEqual: real.filter((r) => r['Trunk Threshold'] === r[COL.overallThreshold]).length,
            polLadenEqual: real.filter((r) => r['POL Laden Threshold'] === r[COL.loadingThreshold]).length,
            differing: H.tally(real.filter((r) => r['POL Laden Threshold'] !== r[COL.loadingThreshold]), (r) => r[COL.loadingThreshold] + '->' + r['POL Laden Threshold']),
            differingSailings: new Set(real.filter((r) => r['POL Laden Threshold'] !== r[COL.loadingThreshold]).map((r) => r[COL.vvd])).size,
        },
        { trunkEqual: 8136, polLadenEqual: 8011, differing: [['0->1.2', 125]], differingSailings: 15 });
}

// ============================================================================================
// 8. Laden above Max Laden (slice 3.1 (b))
// ============================================================================================
{
    const over = H.ladenOverMax(h);
    const raw = H.ladenOverMax(h, { requirePositiveMax: false });
    const runOf = (dates) => {
        const idx = [...dates].map((d) => D.indexOf(d)).sort((a, b) => a - b);
        let best = 1, cur = 1;
        for (let i = 1; i < idx.length; i++) { cur = idx[i] === idx[i - 1] + 1 ? cur + 1 : 1; best = Math.max(best, cur); }
        return best;
    };
    t('Laden > Max Laden (Max Laden > 0): 126 rows, 32 (VVD, POL) pairs (= 32 sailings), 30 pairs over on >= 3 days (all 30 on 3 CONSECUTIVE days)',
        { rows: over.rows.length, pairs: over.pairs.size, sailings: new Set(over.rows.map((r) => r[COL.vvd])).size,
            persist3: [...over.pairs.values()].filter((s) => s.size >= 3).length,
            persist3Consecutive: [...over.pairs.values()].filter((s) => runOf(s) >= 3).length },
        { rows: 126, pairs: 32, sailings: 32, persist3: 30, persist3Consecutive: 30 });
    t('the same comparison WITHOUT the Max Laden > 0 guard is 228 rows / 58 pairs / 48 persisting: the extra 102 rows all have Max Laden 0 (316 such rows in all, 214 with laden 0 too), i.e. no cap recorded',
        {
            rows: raw.rows.length, pairs: raw.pairs.size, persist3: [...raw.pairs.values()].filter((s) => s.size >= 3).length,
            extra: raw.rows.length - over.rows.length,
            maxZeroRows: real.filter((r) => H.toNumber(r[COL.maxLaden]) === 0).length,
            maxZeroLadenZero: real.filter((r) => H.toNumber(r[COL.maxLaden]) === 0 && H.toNumber(r[COL.laden]) === 0).length,
        },
        { rows: 228, pairs: 58, persist3: 48, extra: 102, maxZeroRows: 316, maxZeroLadenZero: 214 });
    t('over-max rows per day (Max Laden > 0): 7, 6, 6, 6, 7, then 30, 30, 28 on 08-29..08-31 (the weekend), back to 6 on 09-01',
        D.map((d) => over.rows.filter((r) => r[COL.date] === d).length), [7, 6, 6, 6, 7, 30, 30, 28, 6]);
}

// ============================================================================================
// 9. Laden around the POL cut-off (evidence behind NOT building a pace-extrapolation forecast)
// ============================================================================================
{
    // Method is documented on H.ladenChangeByDaysToCutoff. Medians are pinned to 2 decimals.
    const table = H.ladenChangeByDaysToCutoff(h);
    const row = (b) => { const x = table.find((y) => y.bucket === b); return { n: x.n, falling: x.falling, flat: x.flat, rising: x.rising, medianPct: r2(x.medianPct) }; };
    t('laden by days to cut-off, >= 28 days: 1,947 day-pairs, median change 0.00 %', row('>=28'), { n: 1947, falling: 142, flat: 952, rising: 853, medianPct: 0 });
    t('laden by days to cut-off, 14-27 days: 868 day-pairs, median +1.08 % (accumulating)', row('14-27'), { n: 868, falling: 103, flat: 300, rising: 465, medianPct: 1.08 });
    t('laden by days to cut-off, 7-13 days: 348 day-pairs, median +0.21 %', row('7-13'), { n: 348, falling: 71, flat: 116, rising: 161, medianPct: 0.21 });
    t('laden by days to cut-off, 3-6 days: 212 day-pairs, median 0.00 %', row('3-6'), { n: 212, falling: 87, flat: 89, rising: 36, medianPct: 0 });
    t('laden by days to cut-off, 0-2 days: 165 day-pairs, median -6.94 %, 115 falling (the trim)', row('0-2'), { n: 165, falling: 115, flat: 35, rising: 15, medianPct: -6.94 });
    t('laden after the cut-off: 2,433 day-pairs, 2,263 flat (within +-0.5 %), median 0.00 % (frozen)', row('after'), { n: 2433, falling: 107, flat: 2263, rising: 63, medianPct: 0 });
    // independent count of the day-pairs the table is built from (a (VVD, POL) real row on two consecutive dates)
    let dayPairs = 0;
    let earlierLadenZero = 0;
    PAIRS.forEach((p) => {
        const next = new Set(h.realRows(p.cur).map((r) => r[COL.vvd] + '|' + r[COL.pol]));
        h.realRows(p.prev).forEach((r) => {
            if (!next.has(r[COL.vvd] + '|' + r[COL.pol])) return;
            dayPairs++;
            if (!(H.toNumber(r[COL.laden]) > 0)) earlierLadenZero++;
        });
    });
    t('the six buckets partition the usable day-pairs: 5,973 = the 7,084 (VVD, POL) day-pairs present on two consecutive dates minus the 1,111 whose earlier laden is 0',
        { bucketed: table.reduce((n, x) => n + x.n, 0), dayPairs, earlierLadenZero }, { bucketed: 5973, dayPairs: 7084, earlierLadenZero: 1111 });
}

// ============================================================================================
// 10. Compact history index (slice 2.5): size on the 9 days
// ============================================================================================
{
    const index = H.compactIndexRows(h);
    const json = JSON.stringify(index);
    const gz = require('zlib').gzipSync(Buffer.from(json), { level: 9 }).length;
    t('index shape: [VVD, POL, day, laden, booking, POL utilisation, POL cut-off, picBlank]; numbers keep the CSV\'s own text; the first row is a NO N.A. CALL row with a blank cut-off',
        index[0], ['IAIT0006S', 'NO N.A. CALL', '2026-08-24', '0', '39', '0', '', 0]);
    t('(b) index size: one row per real row = 8,136 rows, 542,761 bytes of JSON (about 60 KB a day, 22 MB a year, NOT "a few KB a day")',
        { rows: index.length, bytes: Buffer.byteLength(json), picBlankRows: index.filter((x) => x[7] === 1).length }, { rows: 8136, bytes: 542761, picBlankRows: 96 });
    // gzip output length depends on the zlib build: Python's gzip gives 97,145, Node 22's zlib level 9 gives 97,070.
    // Pinned as a band wide enough for any zlib, narrow enough to notice a shape change (level 1 is 120,245).
    t('(b) the same JSON gzips to about 97 KB (Python gzip 97,145; Node zlib level 9 97,070): asserted as the band 93,000..101,000',
        gz >= 93000 && gz <= 101000, true);
}

// ============================================================================================
const EXPECTED = 73;
if (pass + failures.length !== EXPECTED) {
    failures.push(`expected ${EXPECTED} assertions, ran ${pass + failures.length} -- ` +
        'an assertion was added or silently dropped; update EXPECTED deliberately');
}

if (failures.length) {
    console.error(`\n${failures.length} FAILED:\n`);
    failures.forEach((f) => console.error(`  - ${f}\n`));
    process.exit(1);
}
console.log(`HISTORY_DAYS_CHECK_PASSED (${pass} assertions; ${h.rows.length} rows over ${D.length} days parsed in ${loadMs} ms)`);

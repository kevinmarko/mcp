'use strict';
/**
 * Behaviour tests for BFShared.findExceptions and sortExceptions (shared/70_exceptions.js, Phase 2 slice 2a-2; roadmap 3.1;
 * decisions D2 (a ceiling over Max Laden; 0 and 0.01 mean not set), D3 (N = 3 consecutive days) and D4 (blank PIC is normal on FLX
 * only; TBA and Resid are unowned; EC SPC and WC SPC are the team)).
 *
 * Evidence:
 *   1. Hand-worked scenarios over five consecutive days that cross a month end (2026-02-26 to 2026-03-02): every branch of the three
 *      rules, the streak walk, the free lanes, the lead-time test, the config fallbacks, the day clean-up and the sort orders.
 *   2. Hostile inputs, no mutation, and purity (the realm's Date and Math.random made to throw; the source names no clock).
 *   3. Real data: the committed 9-day CSV (ctx.history). Each row is mapped to
 *        { vvd: 'Vessel 1st VVD', pol: 'Route Location 1st Pol', lane: 'Vessel 1st Lane', pic: 'MCT PIC', maxLaden: 'MCT Max Laden',
 *          overall: 'MCT Overall Threshold', loading: 'MCT Loading Threshold', ladenPol: 'Measures POL Laden TEU' (the app's first choice;
 *          'Measures Laden TEU' only if that column were absent), bookingSailing: 'Measures Total Booking TEU by Service',
 *          cutoff: 'Route Date Cut/off Date' and polCutoff: 'Route Date POL Cut/off Date', each read with parseMdy (blank when it does not parse) }
 *      Rule (a) is compared with the unownedStreaks oracle of tests/lib/history_days.js on every as-of day, and the other rules with small
 *      oracles written here from the raw cell text (and, for over_laden, over_booking and no_cutoff, with the independent Python oracle the
 *      coordinator wrote from the raw CSV: the pinned counts below are its numbers). The counts per as-of day are pinned (N = 3).
 *
 *      KNOWN DATA ARTIFACT (roadmap 3.1): the laden figure at USHOU and some other ports doubles over a weekend (LHTT2631S: 232, 232, 464, 464,
 *      464, 232 for 2026-08-28 to 2026-09-01), so over_laden jumps to 13 on 2026-08-31 and back to 6. The pinned counts include it; it is
 *      not corrected for.
 *
 * Calls go through local names: tests/check_shared_sync.js check E forbids a second definition of a shared name anywhere in tests/.
 */
const fs = require('fs');
const path = require('path');

exports.TESTS = ['findExceptions', 'sortExceptions'];
exports.COUNT = 24;
exports.run = function (ctx) {
    const { BFShared, t, plain, history } = ctx;
    const hist = history.loadHistory();
    const find = (d, c) => plain(BFShared.findExceptions(d, c));
    const sorted = (l, by) => plain(BFShared.sortExceptions(l, by));

    const boom = { valueOf() { throw new Error('valueOf was called'); }, toString() { throw new Error('toString was called'); } };
    const safe = (fn) => { try { return fn(); } catch (e) { return `THREW: ${e && e.message}`; } };
    const J = (v) => JSON.stringify(v);

    const D = ['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'];
    // A neutral record with the fields findExceptions reads (any of them can be overridden). The default cut-off is far away, so rule (c) and the
    // lead-time test do not interfere with the scenarios for the other rules.
    const row = (vvd, pol, lane, over) => Object.assign({ vvd, pol, lane, pic: 'Joe / Bob', maxLaden: '', overall: '', loading: '', ladenPol: '', bookingSailing: '', cutoff: '2026-12-31', polCutoff: '' }, over || {});
    // One sailing over several days: spec(dayIndex) returns the sailing's rows that day, or null when it is absent.
    const build = (nDays, sailings) => D.slice(0, nDays).map((date, i) => {
        const rows = [];
        sailings.forEach((s) => { const r = s(i); if (r) r.forEach((x) => rows.push(x)); });
        return { date, rows };
    });
    const picByDay = (vvd, lane, pics) => (i) => (pics[i] === null || pics[i] === undefined ? null : [row(vvd, 'P1', lane, { pic: pics[i] })]);
    const pick = (list) => list.map((e) => `${e.vvd}:${e.rule}:${e.days}`);

    // ================================================================================================
    // Rule (a): unowned
    // ================================================================================================
    // Four days (02-26 to 03-01), one row per sailing-port; the PIC text per day ('' is blank, null is absent that day):
    //   A  EXW  '' x4                          unowned 4 days, since 02-26
    //   B  EXW  owned, then '' x3              3 days since 02-27
    //   C  EXW  owned x2, then '' x2           2 days (below N = 3)
    //   D  FLX  '' x4                          a free lane: never reported by this rule (D4)
    //   E  EXE  'TBA / TBA' x4                 both halves unowned: 4 days (D4)
    //   F  EXE  'TBA / Bob' x4                 Bob owns it: never
    //   G  EXE  'EC SPC / TBA' x4              the team owns it (D4): never
    //   H  EXE  '' on port P1 but 'Joe / Bob' on port P2, x4   one owned port row makes the sailing owned: never
    //   I  EXW  '', absent, '', ''             absent on 02-27: the streak is 2 days (02-28, 03-01)
    //   K  ' k ' / lane 'exw'  '', '', '', 'Resid / Resid'   Resid in both halves is unowned: 4 days; VVD and lane are normalised
    //   VMS rows and a blank VVD are skipped.
    const A_SAILINGS = [
        picByDay('A', 'EXW', ['', '', '', '']), picByDay('B', 'EXW', ['Joe / Bob', '', '', '']), picByDay('C', 'EXW', ['Joe / Bob', 'Joe / Bob', '', '']),
        picByDay('D', 'FLX', ['', '', '', '']), picByDay('E', 'EXE', ['TBA / TBA', 'TBA / TBA', 'TBA / TBA', 'TBA / TBA']),
        picByDay('F', 'EXE', ['TBA / Bob', 'TBA / Bob', 'TBA / Bob', 'TBA / Bob']), picByDay('G', 'EXE', ['EC SPC / TBA', 'EC SPC / TBA', 'EC SPC / TBA', 'EC SPC / TBA']),
        () => [row('H', 'P1', 'EXE', { pic: '' }), row('H', 'P2', 'EXE', { pic: 'Joe / Bob' })],
        picByDay('I', 'EXW', ['', null, '', '']), picByDay(' k ', 'exw', ['', '', '', 'Resid / Resid']),
        () => [row('VMS', '', 'EXW', { pic: '' }), row('', 'P1', 'EXW', { pic: '' })],
    ];
    const DAYS_A = build(4, A_SAILINGS);
    const DAYS_A_COPY = J(DAYS_A);
    t('rule (a): unowned on every port row for N = 3 consecutive days: A, E and K for 4 days, B for 3; not C (2), D (free lane FLX), F, G, H or I (a gap day); blank, TBA / TBA and Resid / Resid are unowned, EC SPC and a person are not',
        { found: find(DAYS_A), unchanged: J(DAYS_A) === DAYS_A_COPY },
        {
            found: [
                { vvd: 'A', lane: 'EXW', rule: 'unowned', days: 4, since: '2026-02-26', detail: 'No owner: PIC (blank)', cutoff: '2026-12-31' },
                { vvd: 'E', lane: 'EXE', rule: 'unowned', days: 4, since: '2026-02-26', detail: 'No owner: PIC TBA / TBA', cutoff: '2026-12-31' },
                { vvd: 'K', lane: 'EXW', rule: 'unowned', days: 4, since: '2026-02-26', detail: 'No owner: PIC Resid / Resid', cutoff: '2026-12-31' },
                { vvd: 'B', lane: 'EXW', rule: 'unowned', days: 3, since: '2026-02-27', detail: 'No owner: PIC (blank)', cutoff: '2026-12-31' },
            ],
            unchanged: true,
        });
    t('rule (a): config.n sets the streak (n = 2 adds C and I, n = 4 drops B), freeLanes [] reports the FLX sailing D, freeLanes [\' exw \'] frees the EXW sailings (and so no longer frees FLX) (lane names compared trimmed and upper-case)',
        { n2: pick(find(DAYS_A, { n: 2 })), n4: pick(find(DAYS_A, { n: 4 })), noFree: pick(find(DAYS_A, { freeLanes: [] })), freeExw: pick(find(DAYS_A, { freeLanes: [' exw '] })), n1D: pick(find(DAYS_A, { n: 1 })).filter((x) => x.startsWith('D')) },
        {
            n2: ['A:unowned:4', 'E:unowned:4', 'K:unowned:4', 'B:unowned:3', 'C:unowned:2', 'I:unowned:2'],
            n4: ['A:unowned:4', 'E:unowned:4', 'K:unowned:4'],
            noFree: ['A:unowned:4', 'D:unowned:4', 'E:unowned:4', 'K:unowned:4', 'B:unowned:3'],
            freeExw: ['D:unowned:4', 'E:unowned:4'],
            n1D: [],
        });
    t('rule (a): the as-of day is the latest day, or config.asOf (later days are then not read): as of 02-28 the streaks are 3 days for A, E and K (K\'s Resid / Resid arrives on 03-01) and B has only 2; an as-of day with no data gives []',
        {
            asOf0228: pick(find(DAYS_A, { asOf: '2026-02-28' })), since: find(DAYS_A, { asOf: '2026-02-28' }).map((e) => e.since),
            noData: find(DAYS_A, { asOf: '2026-03-02' }), notADate: pick(find(DAYS_A, { asOf: '2026-02-30' })), junk: pick(find(DAYS_A, { asOf: 5 })),
        },
        { asOf0228: ['A:unowned:3', 'E:unowned:3', 'K:unowned:3'], since: ['2026-02-26', '2026-02-26', '2026-02-26'], noData: [], notADate: ['A:unowned:4', 'E:unowned:4', 'K:unowned:4', 'B:unowned:3'], junk: ['A:unowned:4', 'E:unowned:4', 'K:unowned:4', 'B:unowned:3'] });
    t('rule (a): a missing calendar day ends the streak like an absent sailing (drop 02-28 from A\'s days and only 03-01 counts: 1 day), month ends and a leap day are adjacent (02-28, 03-01 in 2026; 02-28, 02-29, 03-01 in 2028), and 2026-02-29 is not a date, so it is ignored and 02-28 meets 03-01 (2 days)',
        {
            gap: pick(find(DAYS_A.filter((d) => d.date !== '2026-02-28'), { n: 1 })).filter((x) => x.startsWith('A')),
            leap2028: pick(find(['2028-02-28', '2028-02-29', '2028-03-01'].map((date) => ({ date, rows: [row('Z', 'P1', 'EXW', { pic: '' })] })))),
            noLeap2026: pick(find(['2026-02-28', '2026-02-29', '2026-03-01'].map((date) => ({ date, rows: [row('Z', 'P1', 'EXW', { pic: '' })] })), { n: 1 })),
            year: pick(find(['2026-12-30', '2026-12-31', '2027-01-01'].map((date) => ({ date, rows: [row('Z', 'P1', 'EXW', { pic: '' })] })))),
            century: pick(find(['2100-02-28', '2100-03-01', '2100-03-02'].map((date) => ({ date, rows: [row('Z', 'P1', 'EXW', { pic: '' })] })))),
        },
        { gap: ['A:unowned:1'], leap2028: ['Z:unowned:3'], noLeap2026: ['Z:unowned:2'], year: ['Z:unowned:3'], century: ['Z:unowned:3'] });
    t('days clean-up: entries in any order, two entries with one date joined, and entries with a bad date or non-array rows or that are not objects ignored, give the same answer as the clean list',
        (() => {
            const clean = find(DAYS_A);
            const shuffled = [DAYS_A[2], DAYS_A[0], DAYS_A[3], DAYS_A[1]];
            const split = DAYS_A.concat([]).map((d) => ({ date: d.date, rows: d.rows.slice(0, 3) })).concat(DAYS_A.map((d) => ({ date: d.date, rows: d.rows.slice(3) })));
            const dirty = shuffled.concat([null, undefined, 7, 'x', [], { date: '2026-13-01', rows: [] }, { date: '2026-03-02', rows: 'x' }, { date: 20260302, rows: [] }, { rows: [] }, { date: '2026-03-02' }]);
            return { shuffled: J(find(shuffled)) === J(clean), split: J(find(split)) === J(clean), dirty: J(find(dirty)) === J(clean) };
        })(),
        { shuffled: true, split: true, dirty: true });

    // ================================================================================================
    // Rules (b1) over_booking and (b2) over_laden
    // ================================================================================================
    // Three days (02-26 to 02-28). Defaults: maxLaden 100, overall 1.2, loading 1.2, ladenPol 50, bookingSailing 50 (cap 120 for both).
    // over_booking: bookingSailing > first maxLaden above zero x first set overall threshold (one value per sailing).
    // over_laden:   ANY port row with ladenPol > that row's maxLaden x that row's loading threshold. Both strict.
    //   LAD   ladenPol 130                                    over_laden only
    //   BKG   bookingSailing 121                              over_booking only
    //   BOTH  ladenPol 130 and bookingSailing 130             both rules (booking listed first)
    //   EQ    ladenPol 120 and bookingSailing 120 (= cap)     neither
    //   SEP   overall 1, loading 1.2, both measures 110       over_booking only: each rule has its OWN threshold (cap 100 against 120)
    //   NL0 / NL1 / NL2   loading 0 / 0.01 / '' with ladenPol 130 and bookingSailing 130   over_booking only (overall is set), no over_laden (D2: not set)
    //   NO0 / NO1 / NO2   overall 0 / 0.01 / '' with both measures 130                     over_laden only, no over_booking
    //   M0 / M1 / M2      maxLaden 0 / '' / -5, both measures 130                          neither (no cap)
    //   TXT   numbers as text: maxLaden '100', ladenPol '130', loading '120%', bookingSailing '130', overall '120%'   both
    //   D2D   ladenPol over on 02-27 and 02-28 only                      2 days (below N)
    //   D1D   ladenPol over on 02-26 and 02-28, not 02-27                streak 1
    //   TWO   P1 over every day; P2 (maxLaden 200, loading 1) over on 02-28 only         over_laden 3 days, detail lists both ports on the as-of day
    //   ROW   two rows: the first has maxLaden 0, no overall and no bookingSailing; the second maxLaden 100, overall 1.2, bookingSailing 130
    //                                                                                over_booking (the first USABLE value of each is the sailing's)
    const over = (vvd, extra) => () => [row(vvd, 'P1', 'AT1', Object.assign({ maxLaden: 100, overall: 1.2, loading: 1.2, ladenPol: 50, bookingSailing: 50 }, extra))];
    const both130 = { ladenPol: 130, bookingSailing: 130 };
    const B_SAILINGS = [
        over('LAD', { ladenPol: 130 }), over('BKG', { bookingSailing: 121 }), over('BOTH', both130), over('EQ', { ladenPol: 120, bookingSailing: 120 }),
        over('SEP', { overall: 1, ladenPol: 110, bookingSailing: 110 }),
        over('NL0', Object.assign({ loading: 0 }, both130)), over('NL1', Object.assign({ loading: 0.01 }, both130)), over('NL2', Object.assign({ loading: '' }, both130)),
        over('NO0', Object.assign({ overall: 0 }, both130)), over('NO1', Object.assign({ overall: 0.01 }, both130)), over('NO2', Object.assign({ overall: '' }, both130)),
        over('M0', Object.assign({ maxLaden: 0 }, both130)), over('M1', Object.assign({ maxLaden: '' }, both130)), over('M2', Object.assign({ maxLaden: -5 }, both130)),
        over('TXT', { maxLaden: '100', ladenPol: '130', loading: '120%', bookingSailing: '130', overall: '120%' }),
        (i) => over('D2D', i >= 1 ? { ladenPol: 130 } : {})(i), (i) => over('D1D', i !== 1 ? { ladenPol: 130 } : {})(i),
        (i) => [row('TWO', 'P1', 'AT1', { maxLaden: 100, overall: 1.2, loading: 1.2, ladenPol: 130, bookingSailing: 50 }),
            row('TWO', 'P2', 'AT1', { maxLaden: 200, overall: 1.2, loading: 1, ladenPol: i === 2 ? 300 : 100, bookingSailing: 50 })],
        () => [row('ROW', 'P1', 'AT1', { maxLaden: 0, overall: '', bookingSailing: '', ladenPol: 500 }), row('ROW', 'P2', 'AT1', { maxLaden: 100, overall: 1.2, loading: 1.2, ladenPol: 50, bookingSailing: 130 })],
    ];
    const DAYS_B = build(3, B_SAILINGS);
    t('rules (b1) and (b2): over_booking is the sailing\'s booking total above Max Laden x the OVERALL threshold, over_laden is a POL row\'s laden above its Max Laden x its LOADING threshold, both strict, each with its own threshold; a threshold that is 0, 0.01 or blank, or a Max Laden that is 0, blank or negative, makes no rule; the first usable value is the sailing\'s; text numbers and percent thresholds work; the detail names the figure and the cap',
        { found: find(DAYS_B).map((e) => [e.vvd, e.rule, e.days, e.since, e.detail]) },
        {
            found: [
                ['BKG', 'over_booking', 3, '2026-02-26', 'booking 121 > cap 120 (100 x 1.2)'],
                ['BOTH', 'over_booking', 3, '2026-02-26', 'booking 130 > cap 120 (100 x 1.2)'],
                ['NL0', 'over_booking', 3, '2026-02-26', 'booking 130 > cap 120 (100 x 1.2)'],
                ['NL1', 'over_booking', 3, '2026-02-26', 'booking 130 > cap 120 (100 x 1.2)'],
                ['NL2', 'over_booking', 3, '2026-02-26', 'booking 130 > cap 120 (100 x 1.2)'],
                ['ROW', 'over_booking', 3, '2026-02-26', 'booking 130 > cap 120 (100 x 1.2)'],
                ['SEP', 'over_booking', 3, '2026-02-26', 'booking 110 > cap 100 (100 x 1)'],
                ['TXT', 'over_booking', 3, '2026-02-26', 'booking 130 > cap 120 (100 x 1.2)'],
                ['BOTH', 'over_laden', 3, '2026-02-26', 'P1 laden 130 > cap 120 (100 x 1.2)'],
                ['LAD', 'over_laden', 3, '2026-02-26', 'P1 laden 130 > cap 120 (100 x 1.2)'],
                ['NO0', 'over_laden', 3, '2026-02-26', 'P1 laden 130 > cap 120 (100 x 1.2)'],
                ['NO1', 'over_laden', 3, '2026-02-26', 'P1 laden 130 > cap 120 (100 x 1.2)'],
                ['NO2', 'over_laden', 3, '2026-02-26', 'P1 laden 130 > cap 120 (100 x 1.2)'],
                ['TWO', 'over_laden', 3, '2026-02-26', 'P1 laden 130 > cap 120 (100 x 1.2); P2 laden 300 > cap 200 (200 x 1)'],
                ['TXT', 'over_laden', 3, '2026-02-26', 'P1 laden 130 > cap 120 (100 x 1.2)'],
            ],
        });
    t('rule (b2): the streak is over days in a row ending on the as-of day: D2D has 2 days (reported with n = 2, since 02-27), D1D has 1 (with n = 1); TWO\'s second port is over on the last day only but the sailing has been over for 3',
        {
            n2: find(DAYS_B, { n: 2 }).filter((e) => e.vvd === 'D2D' || e.vvd === 'D1D').map((e) => [e.vvd, e.days, e.since]),
            n1: find(DAYS_B, { n: 1 }).filter((e) => e.vvd === 'D2D' || e.vvd === 'D1D').map((e) => [e.vvd, e.days, e.since]),
            n3: find(DAYS_B).filter((e) => e.vvd === 'D2D' || e.vvd === 'D1D').length,
        },
        { n2: [['D2D', 2, '2026-02-27']], n1: [['D2D', 2, '2026-02-27'], ['D1D', 1, '2026-02-28']], n3: 0 });

    // Lead time: cut-offs on the as-of day 2026-02-28. LAD is 1 day away, BKG 5 days, BOTH 1 day past (a time after the date is ignored), TXT has an
    // unusable one, TWO has a cut-off only in the POL column (10 days away); everything else keeps the far default.
    const CUTS = { LAD: { cutoff: '2026-03-01' }, BKG: { cutoff: '2026-03-05' }, BOTH: { cutoff: '2026-02-27 10:00' }, TXT: { cutoff: 'junk' }, TWO: { cutoff: '', polCutoff: '2026-03-10' } };
    const DAYS_B_CUT = DAYS_B.map((d) => ({ date: d.date, rows: d.rows.map((r) => Object.assign({}, r, Object.prototype.hasOwnProperty.call(CUTS, r.vvd) ? CUTS[r.vvd] : {})) }));
    const overOnly = (list) => list.filter((e) => e.rule === 'over_booking' || e.rule === 'over_laden');
    const lead = (m) => overOnly(find(DAYS_B_CUT, m === 0 ? {} : { leadDaysMin: m })).filter((e) => ['LAD', 'BKG', 'BOTH', 'TXT', 'TWO', 'SEP', 'ROW'].indexOf(e.vvd) !== -1).map((e) => `${e.vvd}:${e.rule}`);
    t('rules (b1) and (b2) lead time: leadDaysMin 0 (the default) keeps everything; 1 drops the sailing whose cut-off is already past (BOTH); 3 also drops LAD (1 day away); 6 also drops BKG (5 days); a sailing with no usable cut-off (TXT) is kept; either cut-off column counts (TWO, POL column only, 10 days); the output carries the earliest cut-off',
        {
            off: lead(0), one: lead(1), three: lead(3), six: lead(6), eleven: lead(11),
            cutoffs: overOnly(find(DAYS_B_CUT)).filter((e) => e.rule === 'over_laden' && ['LAD', 'BOTH', 'TXT', 'TWO'].indexOf(e.vvd) !== -1).map((e) => `${e.vvd}=${e.cutoff}`),
        },
        {
            off: ['BKG:over_booking', 'BOTH:over_booking', 'ROW:over_booking', 'SEP:over_booking', 'TXT:over_booking', 'BOTH:over_laden', 'LAD:over_laden', 'TWO:over_laden', 'TXT:over_laden'],
            one: ['BKG:over_booking', 'ROW:over_booking', 'SEP:over_booking', 'TXT:over_booking', 'LAD:over_laden', 'TWO:over_laden', 'TXT:over_laden'],
            three: ['BKG:over_booking', 'ROW:over_booking', 'SEP:over_booking', 'TXT:over_booking', 'TWO:over_laden', 'TXT:over_laden'],
            six: ['ROW:over_booking', 'SEP:over_booking', 'TXT:over_booking', 'TWO:over_laden', 'TXT:over_laden'],
            eleven: ['ROW:over_booking', 'SEP:over_booking', 'TXT:over_booking', 'TXT:over_laden'],
            cutoffs: ['BOTH=2026-02-27', 'LAD=2026-03-01', 'TWO=2026-03-10', 'TXT='],
        });

    // ================================================================================================
    // Rule (c): nominated sailing with no cut-off
    // ================================================================================================
    //   C1  no date in either cut-off column on any row, all 3 days     3 days
    //   C2  none on 02-28 only                                           1 day
    //   C3  a cut-off                                                    never
    //   C4  two ports, one with a cut-off                                never (some row has one)
    //   C5  lane FLX, none all 3 days                                    reported (free lanes apply to rule (a) only)
    //   C6  unusable cut-off 'junk' on 02-28                             1 day (not a usable date)
    //   C7  no sailing cut-off but a POL cut-off every day               never (either column counts)
    //   VMS placeholder rows (no VVD) are not nominated sailings.
    const cut = (vvd, lane, cutoffs, polCutoff) => (i) => (cutoffs[i] === null ? null : [row(vvd, 'P1', lane, { cutoff: cutoffs[i], polCutoff: polCutoff || '' })]);
    const C_SAILINGS = [
        cut('C1', 'AT1', ['', '', '']), cut('C2', 'AT1', ['2026-03-04', '2026-03-04', '']), cut('C3', 'AT1', ['2026-03-04', '2026-03-04', '2026-03-04']),
        () => [row('C4', 'P1', 'AT1', { cutoff: '' }), row('C4', 'P2', 'AT1', { cutoff: '2026-03-04' })],
        cut('C5', 'FLX', ['', '', '']), cut('C6', 'AT1', ['2026-03-04', '2026-03-04', 'junk']), cut('C7', 'AT1', ['', '', ''], '2026-03-04'),
        () => [row('VMS', '', 'AT1', { cutoff: '' })],
    ];
    const DAYS_C = build(3, C_SAILINGS);
    t('rule (c): a real sailing none of whose port rows has a usable date in EITHER cut-off column, for config.noCutoffDays (default 1) days in a row; free lanes do not apply; VMS placeholders are not nominated; the detail counts the port rows',
        {
            dflt: find(DAYS_C).map((e) => [e.vvd, e.rule, e.days, e.since, e.detail, e.lane]),
            two: pick(find(DAYS_C, { noCutoffDays: 2 })), three: pick(find(DAYS_C, { noCutoffDays: 3 })), four: pick(find(DAYS_C, { noCutoffDays: 4 })),
        },
        {
            dflt: [
                ['C1', 'no_cutoff', 3, '2026-02-26', 'No cut-off on 1 port row', 'AT1'],
                ['C5', 'no_cutoff', 3, '2026-02-26', 'No cut-off on 1 port row', 'FLX'],
                ['C2', 'no_cutoff', 1, '2026-02-28', 'No cut-off on 1 port row', 'AT1'],
                ['C6', 'no_cutoff', 1, '2026-02-28', 'No cut-off on 1 port row', 'AT1'],
            ],
            two: ['C1:no_cutoff:3', 'C5:no_cutoff:3'], three: ['C1:no_cutoff:3', 'C5:no_cutoff:3'], four: [],
        });
    t('rule (c): a two-port sailing with no cut-off on either port says "2 port rows"; one sailing can raise all four rules at once, listed in rule order (unowned, over_booking, over_laden, no_cutoff)',
        (() => {
            const days = D.slice(0, 3).map((date) => ({ date, rows: [row('X', 'P1', 'EXW', { pic: '', maxLaden: 100, overall: 1.2, loading: 1.2, ladenPol: 130, bookingSailing: 130, cutoff: '' }), row('X', 'P2', 'EXW', { pic: '', cutoff: '' })] }));
            return find(days).map((e) => [e.vvd, e.rule, e.days, e.detail]);
        })(),
        [['X', 'unowned', 3, 'No owner: PIC (blank)'], ['X', 'over_booking', 3, 'booking 130 > cap 120 (100 x 1.2)'], ['X', 'over_laden', 3, 'P1 laden 130 > cap 120 (100 x 1.2)'], ['X', 'no_cutoff', 3, 'No cut-off on 2 port rows']]);

    // ================================================================================================
    // Config fallbacks
    // ================================================================================================
    t('config: n that is not a whole number from 1 (0, -1, 2.5, \'3\', NaN, Infinity, null, a throwing object) is 3; a config that is not an object, or missing, is {}; unknown keys are ignored; freeLanes that is not an array is [\'FLX\'] and non-text entries in it are skipped',
        (() => {
            const base = J(find(DAYS_A));
            const badN = [0, -1, 2.5, '3', NaN, Infinity, -Infinity, null, undefined, boom, [], {}].map((n) => safe(() => J(find(DAYS_A, { n })) === base));
            const badCfg = [null, undefined, 0, 'x', [], [{ n: 1 }], true, () => ({ n: 1 }), boom, Symbol('x'), BigInt(1)].map((c) => safe(() => J(find(DAYS_A, c)) === base));
            const badFree = [null, undefined, 'FLX', 5, {}, boom].map((f) => safe(() => J(find(DAYS_A, { freeLanes: f })) === base));
            const mixedFree = J(pick(find(DAYS_A, { freeLanes: [null, 5, {}, '  ', 'flx', boom] }))) === J(pick(find(DAYS_A)));
            const unknown = J(find(DAYS_A, { n: 3, extra: 1, rules: ['x'] })) === base;
            const badLead = [-1, NaN, '3', null, boom, Infinity].map((l) => safe(() => J(find(DAYS_B_CUT, { leadDaysMin: l })) === J(find(DAYS_B_CUT, { leadDaysMin: 0 })) || l === Infinity));
            return { badN, badCfg, badFree, mixedFree, unknown, badLead };
        })(),
        { badN: Array(12).fill(true), badCfg: Array(11).fill(true), badFree: Array(6).fill(true), mixedFree: true, unknown: true, badLead: Array(6).fill(true) });

    // ================================================================================================
    // sortExceptions
    // ================================================================================================
    const ex = (vvd, rule, days, cutoff) => ({ vvd, lane: 'L', rule, days, since: '2026-01-01', detail: '', cutoff });
    const LIST = [
        ex('V3', 'no_cutoff', 5, ''), ex('V2', 'over_booking', 3, '2026-03-09'), ex('V1', 'over_booking', 3, '2026-03-01'), ex('V4', 'unowned', 3, ''),
        ex('V1', 'unowned', 3, '2026-03-01'), ex('V5', 'unowned', 7, '2026-04-01'), ex('V0', 'no_cutoff', 1, '2026-03-05'),
    ];
    const LIST_COPY = J(LIST);
    t('sortExceptions: \'rule\' (the default) = rule order, most days first, then vvd; \'days\' = most days first, then earliest cut-off (blank last), vvd, rule; \'cutoff\' = earliest cut-off (blank last), then most days, vvd, rule; a new array, the input is not changed, any other mode is \'rule\'',
        {
            rule: sorted(LIST, 'rule').map((e) => `${e.vvd}:${e.rule}`), dflt: J(sorted(LIST)) === J(sorted(LIST, 'rule')), other: J(sorted(LIST, 'nope')) === J(sorted(LIST, 'rule')),
            days: sorted(LIST, 'days').map((e) => `${e.vvd}:${e.rule}`), cutoff: sorted(LIST, 'cutoff').map((e) => `${e.vvd}:${e.rule}`),
            unchanged: J(LIST) === LIST_COPY, fresh: BFShared.sortExceptions(LIST, 'days') !== LIST,
        },
        {
            rule: ['V5:unowned', 'V1:unowned', 'V4:unowned', 'V1:over_booking', 'V2:over_booking', 'V3:no_cutoff', 'V0:no_cutoff'],
            dflt: true, other: true,
            days: ['V5:unowned', 'V3:no_cutoff', 'V1:unowned', 'V1:over_booking', 'V2:over_booking', 'V4:unowned', 'V0:no_cutoff'],
            cutoff: ['V1:unowned', 'V1:over_booking', 'V0:no_cutoff', 'V2:over_booking', 'V5:unowned', 'V3:no_cutoff', 'V4:unowned'],
            unchanged: true, fresh: true,
        });
    t('sortExceptions: the order is the same for any input order (all 5040 permutations of 7 entries, three modes); findExceptions\' own output is already in \'rule\' order',
        (() => {
            const want = ['rule', 'days', 'cutoff'].map((m) => J(sorted(LIST, m)));
            let bad = 0;
            const permute = (arr, k) => {
                if (k === arr.length) {
                    ['rule', 'days', 'cutoff'].forEach((m, i) => { if (J(sorted(arr, m)) !== want[i]) bad++; });
                    return;
                }
                for (let i = k; i < arr.length; i++) {
                    [arr[k], arr[i]] = [arr[i], arr[k]];
                    permute(arr, k + 1);
                    [arr[k], arr[i]] = [arr[i], arr[k]];
                }
            };
            permute(LIST.slice(), 0);
            return { bad, own: J(find(DAYS_B)) === J(sorted(find(DAYS_B), 'rule')) && J(find(DAYS_A)) === J(sorted(find(DAYS_A), 'rule')) };
        })(),
        { bad: 0, own: true });
    t('sortExceptions tie-breaks: in \'days\' mode equal days go by the earlier cut-off before the vvd; in \'cutoff\' mode an equal cut-off goes by more days before the vvd; an entry whose days is NaN or Infinity is dropped (so the order cannot depend on the input order)',
        {
            days: sorted([ex('A', 'unowned', 4, '2026-03-09'), ex('B', 'unowned', 4, '2026-03-01')], 'days').map((e) => e.vvd),
            cutoff: sorted([ex('A', 'unowned', 2, '2026-03-05'), ex('B', 'unowned', 6, '2026-03-05')], 'cutoff').map((e) => e.vvd),
            nan: sorted([ex('B', 'unowned', NaN, ''), ex('C', 'unowned', 5, ''), ex('A', 'unowned', 1, ''), ex('D', 'unowned', Infinity, '')], 'days').map((e) => e.vvd),
        },
        { days: ['B', 'A'], cutoff: ['B', 'A'], nan: ['C', 'A'] });
    t('findExceptions: a sailing whose port rows carry different cut-offs (in either column) reports the earliest one, whichever row it is on',
        (() => {
            const rows = [row('E', 'P1', 'EXW', { pic: '', cutoff: '2026-03-09', polCutoff: '2026-03-04' }), row('E', 'P2', 'EXW', { pic: '', cutoff: '2026-03-06' })];
            const fwd = find(D.slice(0, 3).map((date) => ({ date, rows }))).map((e) => e.cutoff);
            const rev = find(D.slice(0, 3).map((date) => ({ date, rows: rows.slice().reverse() }))).map((e) => e.cutoff);
            return { fwd, rev };
        })(),
        { fwd: ['2026-03-04'], rev: ['2026-03-04'] });

    // ================================================================================================
    // Hostile input
    // ================================================================================================
    const HOSTILE_DAYS = [null, undefined, 0, 1, NaN, '', 'abc', true, {}, { length: 1, 0: DAYS_A[0] }, new Set(DAYS_A), () => DAYS_A, Symbol('x'), BigInt(1), boom];
    t('findExceptions and sortExceptions: a first argument that is not an array (null, numbers, strings, objects, array-likes, a Set, a function, a symbol, BigInt, a throwing object) gives [] without throwing',
        {
            find: HOSTILE_DAYS.map((d) => safe(() => find(d, {}))).filter((r) => J(r) !== '[]').length,
            sort: HOSTILE_DAYS.map((d) => safe(() => sorted(d, 'days'))).filter((r) => J(r) !== '[]').length,
            noArgs: [safe(() => BFShared.findExceptions()), safe(() => BFShared.sortExceptions())], bad: safe(() => sorted(LIST, boom)).length,
        },
        { find: 0, sort: 0, noArgs: [[], []], bad: LIST.length });
    const HOSTILE_RECORDS = [null, undefined, 0, 'A', true, [], [row('Q', 'P1', 'EXW', { pic: '' })], () => 1, Symbol('x'), BigInt(1), {}, { vvd: 'Q' }, { vvd: boom }, { vvd: 'Q', pic: boom, lane: boom, pol: boom, maxLaden: boom, ladenPol: boom, bookingSailing: boom, overall: boom, loading: boom, cutoff: boom, polCutoff: boom },
        { vvd: 'Q', pic: {}, lane: 5, pol: 5, maxLaden: [], ladenPol: {}, bookingSailing: true, overall: {}, loading: [1.2], cutoff: 20260301, polCutoff: boom }, { vvd: 'Q', maxLaden: Infinity, ladenPol: NaN, bookingSailing: '1e999', overall: '1.2', loading: '1.2' }, { vvd: 'Q', maxLaden: ' 100 ', ladenPol: ' 130 ', loading: ' 1.2 ' }];
    t('findExceptions: records that are not objects are skipped and records with unusable fields read as blank or missing, without throwing; a record with only a vvd is a sailing with a blank PIC and no cut-off (so it is unowned and has no cut-off)',
        {
            noThrow: HOSTILE_RECORDS.map((r) => typeof safe(() => find([{ date: D[0], rows: [r, r] }, { date: D[1], rows: [r] }, { date: D[2], rows: [r] }], { n: 1 }))).filter((x) => x === 'string').length,
            onlyVvd: find(D.slice(0, 3).map((date) => ({ date, rows: [{ vvd: 'q' }] }))).map((e) => [e.vvd, e.lane, e.rule, e.days]),
            textNumbers: find(D.slice(0, 3).map((date) => ({ date, rows: [{ vvd: 'q', pic: 'Joe / Bob', maxLaden: ' 100 ', ladenPol: ' 130 ', bookingSailing: ' 130 ', overall: ' 1.2 ', loading: ' 1.2 ', cutoff: '2026-03-30' }] }))).map((e) => [e.rule, e.days]),
            infinite: find(D.slice(0, 3).map((date) => ({ date, rows: [{ vvd: 'q', pic: 'Joe / Bob', maxLaden: Infinity, ladenPol: 1e308, bookingSailing: '1e999', overall: 1.2, loading: 1.2, cutoff: '2026-03-30' }] }))),
        },
        { noThrow: 0, onlyVvd: [['Q', '', 'unowned', 3], ['Q', '', 'no_cutoff', 3]], textNumbers: [['over_booking', 3], ['over_laden', 3]], infinite: [] });

    // ================================================================================================
    // Real data: the committed 9-day CSV
    // ================================================================================================
    const C = history.COL;
    const POL_LADEN = hist.headers.indexOf('Measures POL Laden TEU') !== -1 ? 'Measures POL Laden TEU' : C.laden;
    const toRecord = (r) => ({
        vvd: r[C.vvd], pol: r[C.pol], lane: r[C.lane], pic: r[C.pic], maxLaden: r[C.maxLaden], overall: r[C.overallThreshold], loading: r[C.loadingThreshold],
        ladenPol: r[POL_LADEN], bookingSailing: r[C.booking], cutoff: history.parseMdy(r[C.cutoff]) || '', polCutoff: history.parseMdy(r[C.polCutoff]) || '',
    });
    const REAL_DAYS = hist.dates.map((date) => ({ date, rows: hist.rowsOn(date).map(toRecord) }));
    const byRule = (found, rule) => found.filter((e) => e.rule === rule);
    const AS_OF = hist.dates;
    const realFound = AS_OF.map((asOf) => find(REAL_DAYS, { asOf }));
    t('real data, rule (a): N = 3 as of 2026-08-31 is exactly GJMT0003W, HTET1002W, WAHT0613W (8 days each, since 2026-08-24) and as of 2026-09-01 HTET1002W and WAHT0613W (9 days each), as in roadmap 3.1; D4 (FLX free, TBA and Resid unowned) changes neither answer',
        {
            aug31: byRule(realFound[7], 'unowned').map((e) => [e.vvd, e.lane, e.days, e.since]),
            sep01: byRule(realFound[8], 'unowned').map((e) => [e.vvd, e.lane, e.days, e.since]),
            aug31FlxCounted: pick(find(REAL_DAYS, { asOf: '2026-08-31', freeLanes: [] })).filter((x) => x.indexOf(':unowned:') !== -1),
        },
        {
            aug31: [['GJMT0003W', 'EXE', 8, '2026-08-24'], ['HTET1002W', 'EXW', 8, '2026-08-24'], ['WAHT0613W', 'EXW', 8, '2026-08-24']],
            sep01: [['HTET1002W', 'EXW', 9, '2026-08-24'], ['WAHT0613W', 'EXW', 9, '2026-08-24']],
            aug31FlxCounted: ['GJMT0003W:unowned:8', 'HTET1002W:unowned:8', 'WAHT0613W:unowned:8'],
        });
    t('real data, rule (a): on every as-of day the result equals the unownedStreaks oracle (streaks of 3 or more, blank PIC on every row) and its day counts, because no TBA-only or Resid-only PIC exists in the data and no FLX sailing reaches 3 days; and freeLanes [] changes no day',
        AS_OF.map((asOf, i) => {
            const oracle = Array.from(history.unownedStreaks(hist, asOf)).filter(([, n]) => n >= 3).map(([v, n]) => `${v}:${n}`).sort();
            const got = byRule(realFound[i], 'unowned').map((e) => `${e.vvd}:${e.days}`).sort();
            const noFree = byRule(find(REAL_DAYS, { asOf, freeLanes: [] }), 'unowned').map((e) => `${e.vvd}:${e.days}`).sort();
            return { asOf, same: J(oracle) === J(got), noFreeSame: J(noFree) === J(got), n: got.length };
        }),
        AS_OF.map((asOf, i) => ({ asOf, same: true, noFreeSame: true, n: [0, 0, 3, 3, 3, 3, 3, 3, 2][i] })));

    // Oracles for (b) and (c), written from the raw cell text and the history helpers; not product code.
    const setThr = (text) => {
        const v = history.toNumber(text);
        return v === null || Math.abs(v) < 1e-9 || Math.abs(v - 0.01) < 1e-9 ? null : v;
    };
    const oracleLadenRow = (row_) => {
        const max = history.toNumber(row_[C.maxLaden]);
        const thr = setThr(row_[C.loadingThreshold]);
        const laden = history.toNumber(row_[POL_LADEN]);
        return max !== null && max > 0 && thr !== null && laden !== null && laden > max * thr;
    };
    const oracleLaden = (sailing) => sailing.rows.some(oracleLadenRow);
    // Max Laden, the overall threshold and the booking total are the same on every row of a sailing in this data (checked below), so row 0 stands for the sailing.
    const oracleBooking = (sailing) => {
        const r0 = sailing.rows[0];
        const max = history.toNumber(r0[C.maxLaden]);
        const thr = setThr(r0[C.overallThreshold]);
        const bk = history.toNumber(r0[C.booking]);
        return max !== null && max > 0 && thr !== null && bk !== null && bk > max * thr;
    };
    // NOT the shipped rule: the booking total against Max Laden x the row's LOADING threshold on any row (the first reading, before D2 was applied
    // literally). It gives the coordinator's independent bookings numbers, which are larger than over_booking because the loading threshold is a
    // per-POL value that is often lower than the overall one (HFWT0170W: USTIW loading 0.5, booking 1026 against a cap of 650).
    const oracleBookingLoading = (sailing) => sailing.rows.some((r) => {
        const max = history.toNumber(r[C.maxLaden]);
        const thr = setThr(r[C.loadingThreshold]);
        const bk = history.toNumber(r[C.booking]);
        return max !== null && max > 0 && thr !== null && bk !== null && bk > max * thr;
    });
    const oracleNoCutoff = (sailing) => sailing.rows.every((r) => history.parseMdy(r[C.cutoff]) === null && history.parseMdy(r[C.polCutoff]) === null);
    const oracleStreaks = (asOf, test) => {
        const idx = hist.dates.indexOf(asOf);
        const out = [];
        hist.sailings(asOf).forEach((s_, vvd) => {
            let n = 0;
            for (let d = idx; d >= 0; d--) {
                if (d < idx && history.daysBetween(hist.dates[d], hist.dates[d + 1]) !== 1) break;
                const sd = hist.sailings(hist.dates[d]).get(vvd);
                if (!sd || !test(sd)) break;
                n++;
            }
            if (n > 0) out.push([vvd, n]);
        });
        return out;
    };
    // over_laden equals the independent Python oracle (from the raw CSV): 6, 6, 5, 5, 6, 13, 6 for 2026-08-26 to 09-01. over_booking uses the OVERALL threshold (D2) and
    // is smaller than that oracle's bookings-against-loading-threshold numbers 22, 29, 32, 32, 34, 36, 34 (WANT_BOOKING_LOADING, reproduced by oracleBookingLoading).
    const WANT_LADEN = [0, 0, 6, 6, 5, 5, 6, 13, 6];
    const WANT_BOOKING = [0, 0, 11, 12, 14, 12, 13, 17, 15];
    const WANT_BOOKING_LOADING = [0, 0, 22, 29, 32, 32, 34, 36, 34];
    const WANT_C = [0, 0, 0, 1, 0, 0, 0, 0, 0];
    t('real data: Max Laden, the overall threshold and the booking total are the same on every row of every sailing-day (so reading them from the first usable row is the same as the oracle\'s row 0)',
        (() => {
            let varying = 0;
            let sailings = 0;
            hist.dates.forEach((d) => hist.sailings(d).forEach((s_) => {
                sailings++;
                [C.maxLaden, C.overallThreshold, C.booking].forEach((col) => { if (new Set(s_.rows.map((r) => history.toNumber(r[col]))).size > 1) varying++; });
            }));
            return { sailings, varying };
        })(),
        { sailings: 3342, varying: 0 });
    t('real data, rules over_laden, over_booking and no_cutoff: the counts per as-of day with N = 3 (one day for no cut-off) are pinned (over_laden 0, 0, 6, 6, 5, 5, 6, 13, 6; over_booking 0, 0, 11, 12, 14, 12, 13, 17, 15; no_cutoff 0, 0, 0, 1, 0, 0, 0, 0, 0 for 2026-08-24 to 2026-09-01) and equal the oracles\' sailings and day counts; the booking total against the LOADING threshold on any row (not the shipped rule) gives the larger 22, 29, 32, 32, 34, 36, 34',
        AS_OF.map((asOf, i) => {
            const get = (rule) => byRule(realFound[i], rule).map((e) => `${e.vvd}:${e.days}`).sort();
            const want = (test, min) => oracleStreaks(asOf, test).filter(([, n]) => n >= min).map(([v, n]) => `${v}:${n}`).sort();
            return {
                asOf, laden: get('over_laden').length, booking: get('over_booking').length, c: get('no_cutoff').length,
                altBookingLoading: want(oracleBookingLoading, 3).length, ladenSame: J(get('over_laden')) === J(want(oracleLaden, 3)), bookingSame: J(get('over_booking')) === J(want(oracleBooking, 3)), cSame: J(get('no_cutoff')) === J(want(oracleNoCutoff, 1)),
            };
        }),
        AS_OF.map((asOf, i) => ({ asOf, laden: WANT_LADEN[i], booking: WANT_BOOKING[i], altBookingLoading: WANT_BOOKING_LOADING[i], c: WANT_C[i], ladenSame: true, bookingSame: true, cSame: true })));
    t('real data: the only sailing with no cut-off in either column is 7E3T0001W on 2026-08-27 (its one row is a NO N.A. CALL row); the 2026-08-31 over_laden sailings are the 13 of the USHOU weekend doubling (LHTT2631S 464 against a cap of 318 among them); N = 1 gives 6 over_laden and 16 over_booking sailings on 2026-09-01, and leadDaysMin 3 (N = 3) leaves 3 and 6; every output entry has a real VVD, a lane, a since date that is a real archive day and days equal to the number of archive days from since to the as-of day',
        (() => {
            const aug31 = byRule(realFound[7], 'over_laden');
            const sep1n1 = find(REAL_DAYS, { asOf: '2026-09-01', n: 1 });
            const lead3 = find(REAL_DAYS, { asOf: '2026-09-01', leadDaysMin: 3 });
            const shape = realFound.every((list, i) => list.every((e) => /^[A-Z0-9]{9}$/.test(e.vvd) && e.lane !== '' && AS_OF.indexOf(e.since) !== -1 && e.days === i - AS_OF.indexOf(e.since) + 1));
            return {
                noCutoff: byRule(realFound[3], 'no_cutoff').map((e) => `${e.vvd}:${e.lane}:${e.days}`), aug31: aug31.length,
                lhtt: aug31.filter((e) => e.vvd === 'LHTT2631S').map((e) => e.detail), n1Laden: byRule(sep1n1, 'over_laden').length, n1Booking: byRule(sep1n1, 'over_booking').length,
                lead3Laden: byRule(lead3, 'over_laden').length, lead3Booking: byRule(lead3, 'over_booking').length, shape,
            };
        })(),
        { noCutoff: ['7E3T0001W:EC4:1'], aug31: 13, lhtt: ['USHOU laden 464 > cap 318 (265 x 1.2)'], n1Laden: 6, n1Booking: 16, lead3Laden: 3, lead3Booking: 6, shape: true });

    // ================================================================================================
    // Purity
    // ================================================================================================
    {
        const Fn = BFShared.findExceptions.constructor;
        const realm = new Fn('return this')();
        const battery = () => JSON.stringify([find(DAYS_A), find(DAYS_B_CUT, { leadDaysMin: 3 }), find(DAYS_C, { noCutoffDays: 2 }), sorted(LIST, 'days'), find(REAL_DAYS, { asOf: '2026-08-31' })]);
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
        t('purity: with the clock and the random source throwing (and shown to throw), the functions give exactly the answers they gave normally',
            { live, same: sabotaged === normal }, { live: ['threw', 'threw', 'threw'], same: true });
    }
    {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', '70_exceptions.js'), 'utf8');
        const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
        const found = ['Date', 'Math\\.random', 'performance', 'process', 'window', 'document', 'setTimeout', 'setInterval', 'eval', 'Function', 'require', 'Intl', 'toLocale[A-Za-z]*']
            .filter((w) => new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`).test(code));
        t('purity: the code of shared/70_exceptions.js (comment lines removed) names no Date, Math.random, performance, process, window, document, timer, eval, Function, require, Intl or locale method',
            found, []);
    }
};

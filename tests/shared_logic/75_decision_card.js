'use strict';
/**
 * Behaviour tests for the decision card's figures (shared/75_decision_card.js, D84 slice 2b-2): decisionCeiling,
 * matchDeskDeclaration and declarationAge.
 *
 * Evidence: hand-worked fixtures; the ceiling cases are the worklist's own pinned details (tests/shared_logic/70_exceptions.js and
 * the Worklist regression suite: "booking 2182 > cap 2162 (1880 x 1.15)", "USTIW02 laden 781 > cap 647.5 (1295 x 0.5)"), so the
 * card and the worklist are held to one rule. The declaration rows are tests/fixtures/ep_export_sample.csv's (SYNTHETIC) rows,
 * as apps-script/DataFeeds.gs parses them. Hostile inputs and purity (the clock made to throw).
 *
 * Calls go through local names: tests/check_shared_sync.js check E forbids a second definition of a shared name in tests/.
 */
exports.TESTS = ['decisionCeiling', 'matchDeskDeclaration', 'declarationAge'];
exports.COUNT = 12;
exports.run = function (ctx) {
    const { BFShared, t, plain } = ctx;
    const ceil = (a, b, c) => plain(BFShared.decisionCeiling(a, b, c));
    const match = (rows, v, p) => plain(BFShared.matchDeskDeclaration(rows, v, p));
    const age = (a, n, c) => plain(BFShared.declarationAge(a, n, c));
    const H = 3600000;
    // The SYNTHETIC EP_EXPORT fixture's rows, as DataFeeds.gs hands them (numbers for the TEU columns, null for blanks).
    const EP = [
        { as_of: '2026-10-29', vvd: 'CIKT0014W', port: 'USHOU', port_key: 'USHOU#1', terminal: 'USHOU05', final_teu: 1950, prelim_teu: 1200, cutoff: '2026-10-23' },
        { as_of: '2026-10-29', vvd: 'CIKT0014W', port: 'USMOB', port_key: 'USMOB#1', final_teu: 400, prelim_teu: 380, cutoff: '2026-10-24' },
        { as_of: '2026-10-28', vvd: 'OIST0090W', port: 'USSAV', port_key: 'USSAV#2', final_teu: null, prelim_teu: 1450, cutoff: '2026-10-30' },
        { as_of: '2026-10-28', vvd: 'OIST0090W', port: 'USCHS', port_key: null, final_teu: null, prelim_teu: null, cutoff: '2026-10-31' },
    ];

    t('decisionCeiling: the worklist\'s pinned caps (1880 x 1.15 = 2162 with booking 2182 over by 20; 1295 x 0.5 = 647.5 with laden 781 over by 133.5); "115%" reads as 1.15',
        [ceil(2182, 1880, 1.15), ceil('781', '1295', '0.5'), ceil('2182', '1880', '115%')].map((x) => [x.set, Math.round(x.ceiling * 100) / 100, Math.round(x.diff * 100) / 100, x.over]),
        [[true, 2162, 20, true], [true, 647.5, 133.5, true], [true, 2162, 20, true]]);
    // Parity with findExceptions (review, 2026-10-31): the same values read the same way. A sailing is over_booking (n = 1) exactly when
    // decisionCeiling(booking, maxLaden, overall).over, for bookings and Max Laden values in every form the feed or a hand edit could give.
    {
        const overByExceptions = (booking, maxLaden) => BFShared.findExceptions([{ date: '2026-09-01', rows: [{ vvd: 'V1', pol: 'USHOU01', lane: 'AN2', pic: 'Joe', maxLaden, overall: 1, loading: '', ladenPol: '', bookingSailing: booking, cutoff: '', polCutoff: '' }] }],
            { n: 1, asOf: '2026-09-01' }).some((e) => e.rule === 'over_booking');
        const ODD = ['1,640', '+1101', '1e4', '.5e4', '', 0, 0.01, '0.01', NaN, Infinity, -Infinity, '2000', 2000, ' 2000 ', null, undefined];
        const rows = ODD.map((v) => ['booking', v, 1000]).concat(ODD.map((v) => ['maxLaden', 5000, v]));
        const disagree = rows.filter(([, b, m]) => overByExceptions(b, m) !== !!BFShared.decisionCeiling(b, m, 1).over).map(([k, b, m]) => `${k}:${String(k === 'booking' ? b : m)}`);
        t('decisionCeiling: parity with findExceptions over 32 bookings and Max Laden values (\'1,640\', \'+1101\', \'1e4\', \'.5e4\', blank, 0, 0.01, NaN, the infinities, padded text, null): over exactly when findExceptions flags over_booking',
            disagree, []);
    }
    t('decisionCeiling: equal to the ceiling is not over (strictly above, as findExceptions); under gives a negative diff',
        [ceil(1295, 1295, 1), ceil(1000, 1295, 1)].map((x) => [x.over, x.diff]), [[false, 0], [false, -295]]);
    t('decisionCeiling: a threshold of 0, 0.01, blank, null or text is "not set"; Max Laden 0, blank, negative or text is no ceiling',
        [ceil(10, 100, 0), ceil(10, 100, 0.01), ceil(10, 100, ''), ceil(10, 100, null), ceil(10, 100, 'x'), ceil(10, 0, 1.2), ceil(10, '', 1.2), ceil(10, -5, 1.2), ceil(10, 'n/a', 1.2)],
        Array(9).fill({ set: false }));
    t('decisionCeiling: a base that is not a number keeps the ceiling but has diff null and is not over; hostile values never throw',
        [ceil(undefined, 100, 1.5), ceil({}, 100, 1.5), ceil(10, { valueOf() { throw new Error('x'); } }, 1.5)],
        [{ set: true, ceiling: 150, diff: null, over: false }, { set: true, ceiling: 150, diff: null, over: false }, { set: false }]);
    t('matchDeskDeclaration: by vvd (any case, trimmed) and port, or by the port part of port_key; one row is ok with that row',
        [match(EP, ' cikt0014w ', 'USHOU').row.final_teu, match(EP, 'OIST0090W', 'ussav').state, match(EP, 'OIST0090W', 'USCHS').state],
        [1950, 'ok', 'ok']);
    t('matchDeskDeclaration: no row for the vvd or the port is none; two rows at one port (two calls) are unmatched with no row picked',
        [match(EP, 'CIKT0014W', 'USSAV'), match(EP, 'ZZZT0001W', 'USHOU'),
            match(EP.concat([{ vvd: 'CIKT0014W', port: 'USHOU', port_key: 'USHOU#2', final_teu: 5 }]), 'CIKT0014W', 'USHOU')],
        [{ state: 'none', row: null }, { state: 'none', row: null }, { state: 'unmatched', row: null }]);
    t('matchDeskDeclaration: rows that are not an array, entries that are not objects, a blank vvd or pol, and a throwing getter give none (never a throw)',
        [match(null, 'A1', 'USHOU'), match({ length: 1, 0: EP[0] }, 'CIKT0014W', 'USHOU'), match([null, 5, 'x', EP[0]], 'CIKT0014W', 'USHOU').state, match(EP, '', 'USHOU'), match(EP, 'CIKT0014W', ''),
            match([Object.defineProperty({}, 'vvd', { enumerable: true, get() { throw new Error('g'); } })], 'A1', 'USHOU')],
        [{ state: 'none', row: null }, { state: 'none', row: null }, 'ok', { state: 'none', row: null }, { state: 'none', row: null }, { state: 'none', row: null }]);
    t('matchDeskDeclaration: the app\'s POL is a yard code: its first five letters find the port; the one row whose terminal is the yard is ok (USHOU05); a single row for ANOTHER terminal is unmatched (USHOU01, USHOU02 vs USHOU05); an exact terminal wins over another at the port; two rows and no exact terminal are unmatched; a single row with a blank terminal is ok',
        [match(EP, 'CIKT0014W', 'USHOU05').row.final_teu, match(EP, 'CIKT0014W', 'USHOU01'), match(EP, 'CIKT0014W', 'USHOU02'),
            match(EP.concat([{ vvd: 'CIKT0014W', port: 'USHOU', port_key: 'USHOU#2', terminal: 'USHOU01', final_teu: 7 }]), 'CIKT0014W', 'USHOU01').row.final_teu,
            match(EP.concat([{ vvd: 'CIKT0014W', port: 'USHOU', port_key: 'USHOU#2', terminal: 'USHOU09', final_teu: 7 }]), 'CIKT0014W', 'USHOU01').state,
            match(EP, 'OIST0090W', 'USCHS03').state],
        [1950, { state: 'unmatched', row: null }, { state: 'unmatched', row: null }, 7, 'unmatched', 'ok']);
    t('declarationAge: a day as_of is the start of that day UTC; 20 h old is fresh, 30 h old is stale (K4: over 24 h); an ISO time with a zone is read as written',
        [age('2026-10-29', Date.UTC(2026, 9, 29, 20), ''), age('2026-10-29', Date.UTC(2026, 9, 30, 6), null), age('2026-10-29T14:00:00Z', Date.UTC(2026, 9, 30, 10), undefined)],
        [{ ageMs: 20 * H, stale: false }, { ageMs: 30 * H, stale: true }, { ageMs: 20 * H, stale: false }]);
    t('declarationAge: also stale once now is past the cut-off day minus 2 days, even when under 24 h old; a cut-off further out adds nothing',
        [age('2026-10-29', Date.UTC(2026, 9, 29, 12), '2026-10-31').stale, age('2026-10-29', Date.UTC(2026, 9, 29, 12), '2026-11-05').stale, age('2026-10-29', Date.UTC(2026, 9, 29, 12), 'soon').stale],
        [true, false, false]);
    t('declarationAge: an unreadable as_of (blank, 2026-02-31, a time with no zone, a number) or a now that is not a finite number is null; purity: no clock read',
        (() => {
            const realNow = Date.now;
            Date.now = () => { throw new Error('declarationAge read the clock'); };
            try {
                return [age('', 0), age('2026-02-31', 0), age('2026-10-29T14:00:00', 0), age(20261029, 0), age('2026-10-29', NaN), age('2026-10-29', '5')];
            } finally { Date.now = realNow; }
        })(),
        [null, null, null, null, null, null]);
};

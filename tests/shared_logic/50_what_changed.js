'use strict';
/**
 * Behaviour tests for BFShared.summarizeChanges and BFShared.formatChangeDate (shared/50_what_changed.js, roadmap
 * slice 2.3, D82): the "what changed since the last day on file" banner's summary.
 *
 * Evidence:
 *   1. Synthetic days whose expected summary is worked out by hand in the comments (every clause, the
 *      plurals, "+N more", both lane-down floors, the thresholds, an empty day).
 *   2. The committed 9-day CSV (ctx.history). On every consecutive pair the summary is compared with an ORACLE
 *      written here from the raw CSV text (H.toNumber, sums per VVD), not from the shared code: moved VVDs and
 *      lanes down. The rollover pair 2026-08-30 -> 08-31 must show 24 out, 23 in and never call a rolled-out
 *      sailing removed (spec K3).
 *   3. formatChangeDate against the host's own Date calendar (the oracle only; the shared code uses none) for
 *      every day of 2024 to 2027, plus the hostile inputs.
 *
 * Calls go through local names (summarize, fmt): tests/check_shared_sync.js check E forbids a second definition
 * of a shared name anywhere in tests/.
 */
exports.TESTS = ['summarizeChanges', 'formatChangeDate'];
exports.COUNT = 28;
exports.run = function (ctx) {
    const { BFShared, history: H, t, plain } = ctx;
    const summarize = (p, c, o) => plain(BFShared.summarizeChanges(p, c, o));
    const fmt = (p, c) => BFShared.formatChangeDate(p, c);
    const rec = (vvd, saleWeek, laden, lane) => ({ vvd, lane: lane || 'L1', saleWeek, pol: 'P', laden, booking: null, util: null });
    const texts = (s) => s.clauses.map((c) => c.kind + ':' + c.text);

    // --- 1. Synthetic ---------------------------------------------------------------------------
    // prev: A (W10, 1000), B (W10, 500), C (W10, 300), D (W09, 50). cur: A 1150 (+150 moved), B 500, E (W10, new
    // while W10 exists: newly nominated), F (W11, new week: rolled in). C gone while W10 is still there: removed.
    // D gone with W09: rolled out. Lane L1 continuing: A+B 1500 -> 1650, up, so no lane down.
    const prev1 = [rec('AAAA0001E', 'W10', 1000), rec('BBBB0001E', 'W10', 500), rec('CCCC0001E', 'W10', 300), rec('DDDD0001E', 'W09', 50)];
    const cur1 = [rec('AAAA0001E', 'W10', 1150), rec('BBBB0001E', 'W10', 500), rec('EEEE0001E', 'W10', 10), rec('FFFF0001E', 'W11', 20)];
    const s1 = summarize(prev1, cur1);
    t('synthetic: every clause in order, the removed VVD named', texts(s1),
        ['removed:1 sailing removed (CCCC0001E)', 'moved:1 sailing moved 100+ TEU', 'arrived:1 newly nominated', 'rollover:sale week rolled over: 1 out, 1 in']);
    t('synthetic: state changes, signature is the removed VVD', [s1.state, s1.signature, s1.comparable], ['changes', 'CCCC0001E', true]);
    t('synthetic: moved entry carries both sides and the delta', s1.moved,
        [{ vvd: 'AAAA0001E', lane: 'L1', saleWeek: 'W10', ladenPrev: 1000, ladenCur: 1150, ladenDelta: 150, utilPrev: null, utilCur: null }]);

    // Identical days: nothing to say.
    const s2 = summarize(prev1, prev1);
    t('identical days: state none, no clauses', [s2.state, s2.clauses, s2.signature], ['none', [], '']);

    // Rollover only: state none, but the rollover clause is still there.
    const s3 = summarize([rec('AAAA0001E', 'W09', 10), rec('BBBB0001E', 'W10', 10)], [rec('BBBB0001E', 'W10', 10), rec('CCCC0001E', 'W11', 10)]);
    t('rollover only: state none, the rollover clause kept', [s3.state, texts(s3)], ['none', ['rollover:sale week rolled over: 1 out, 1 in']]);

    // Five removed: three named, then +2 more; plural.
    const many = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'].map((v) => rec(v + '0002W', 'W20', 100));
    const s4 = summarize(many.concat([rec('KEEP0002W', 'W20', 100)]), [rec('KEEP0002W', 'W20', 100)]);
    t('five removed: three named then +2 more', texts(s4), ['removed:5 sailings removed (AAAA0002W, BBBB0002W, CCCC0002W, +2 more)']);
    t('five removed: signature lists all five', s4.signature, 'AAAA0002W,BBBB0002W,CCCC0002W,DDDD0002W,EEEE0002W');
    t('maxNamed 1 names one', summarize(many.concat([rec('KEEP0002W', 'W20', 100)]), [rec('KEEP0002W', 'W20', 100)], { maxNamed: 1 }).clauses[0].text,
        '5 sailings removed (AAAA0002W, +4 more)');

    // Lane down needs BOTH floors. L2: 2000 -> 1880 is -6% and -120 TEU: down. L3: 200 -> 150 is -25% but only -50
    // TEU: not down. L4: 10000 -> 9800 is -200 TEU but -2%: not down.
    const lanePrev = [rec('L2AA0001E', 'W10', 1000, 'L2'), rec('L2BB0001E', 'W10', 1000, 'L2'), rec('L3AA0001E', 'W10', 200, 'L3'), rec('L4AA0001E', 'W10', 10000, 'L4')];
    const laneCur = [rec('L2AA0001E', 'W10', 940, 'L2'), rec('L2BB0001E', 'W10', 940, 'L2'), rec('L3AA0001E', 'W10', 150, 'L3'), rec('L4AA0001E', 'W10', 9800, 'L4')];
    const s5 = summarize(lanePrev, laneCur);
    t('lane down: only the lane past both floors', s5.lanesDown, [{ lane: 'L2', ladenPrev: 2000, ladenCur: 1880, pct: -6 }]);
    t('lane down: clause text and moved count (L4 moved 200)', texts(s5), ['moved:1 sailing moved 100+ TEU', 'laneDown:1 lane down']);
    t('lane down: thresholds are options (laneDownTeu 40 adds L3)', summarize(lanePrev, laneCur, { laneDownTeu: 40 }).lanesDown.map((l) => l.lane), ['L3', 'L2']);
    t('movedTeu option: 300 moves nothing here', summarize(lanePrev, laneCur, { movedTeu: 300 }).moved, []);
    t('movedTeu option: a bad value keeps the default', summarize(lanePrev, laneCur, { movedTeu: 'abc' }).moved.map((m) => m.vvd), ['L4AA0001E']);
    t('moved text names the threshold used', summarize(lanePrev, laneCur, { movedTeu: 50 }).clauses[0].text, '4 sailings moved 50+ TEU');
    t('moved: largest change first', summarize(lanePrev, laneCur, { movedTeu: 50 }).moved.map((m) => m.vvd), ['L4AA0001E', 'L2AA0001E', 'L2BB0001E', 'L3AA0001E']);

    // No comparison possible.
    const empty = summarize([], cur1);
    t('empty previous day: unavailable, nothing to draw', [empty.comparable, empty.state, empty.clauses, empty.removed], [false, 'unavailable', [], []]);
    t('non-array current day: unavailable, does not throw', summarize(prev1, null).state, 'unavailable');
    t('VMS-only previous day: unavailable', summarize([rec('VMS', 'W10', 5)], cur1).state, 'unavailable');

    // --- 2. Real data ---------------------------------------------------------------------------
    const h = H.loadHistory();
    const { COL } = H;
    const toRec = (row) => ({
        vvd: row[COL.vvd], lane: row[COL.lane], saleWeek: row[COL.saleWeek], pol: row[COL.pol],
        laden: row[COL.laden], booking: row[COL.booking], util: row[COL.polUtil],
    });
    const day = (d) => h.rowsOn(d).map(toRec);
    // Oracle: VVD -> { lane, laden } from the raw rows, written without the shared code. A real VVD is not VMS and
    // not blank; laden is the sum of the port rows' laden.
    const fold = (d) => {
        const m = new Map();
        for (const row of h.rowsOn(d)) {
            const vvd = String(row[COL.vvd] || '').trim().toUpperCase();
            if (!vvd || H.isVms(row)) continue;
            const g = m.get(vvd) || { lane: String(row[COL.lane] || '').trim(), laden: 0, known: false };
            const n = H.toNumber(row[COL.laden]);
            if (n !== null && n !== undefined && !Number.isNaN(n)) { g.laden += n; g.known = true; }
            m.set(vvd, g);
        }
        return m;
    };
    const oracleMoved = (p, c) => {
        const out = [];
        for (const [vvd, b] of c) { const a = p.get(vvd); if (a && a.known && b.known && Math.abs(b.laden - a.laden) >= 100) out.push(vvd); }
        return out.sort();
    };
    const oracleLanesDown = (p, c) => {
        const lanes = new Map();
        for (const [vvd, b] of c) {
            const a = p.get(vvd);
            if (!a || !a.known || !b.known || !b.lane) continue;
            const l = lanes.get(b.lane) || { prev: 0, cur: 0 };
            l.prev += a.laden; l.cur += b.laden; lanes.set(b.lane, l);
        }
        return [...lanes].filter(([, l]) => l.prev > 0 && l.prev - l.cur >= 100 && (l.prev - l.cur) / l.prev * 100 >= 5).map(([lane]) => lane).sort();
    };
    const pairs = h.pairs();
    const mismatches = [];
    let anyMoved = 0;
    for (const { prev: pd, cur: cd } of pairs) {
        const s = summarize(day(pd), day(cd));
        const P = fold(pd);
        const C = fold(cd);
        const moved = s.moved.map((m) => m.vvd).sort();
        const lanes = s.lanesDown.map((l) => l.lane).sort();
        anyMoved += moved.length;
        if (JSON.stringify(moved) !== JSON.stringify(oracleMoved(P, C))) mismatches.push(`${pd}->${cd} moved`);
        if (JSON.stringify(lanes) !== JSON.stringify(oracleLanesDown(P, C))) mismatches.push(`${pd}->${cd} lanesDown`);
    }
    t('real data: moved and lanes down match the oracle on all 8 pairs', [pairs.length, mismatches], [8, []]);
    t('real data: the oracle is not vacuous (some sailing moved on some pair)', anyMoved > 0, true);
    const roll = summarize(day('2026-08-30'), day('2026-08-31'));
    t('rollover pair: 24 out, 23 in', [roll.rolledOut, roll.rolledIn], [24, 23]);
    t('rollover pair: no rolled-out sailing is listed as removed (K3)', roll.clauses.some((c) => c.kind === 'rollover' && c.text === 'sale week rolled over: 24 out, 23 in'), true);
    const rolledOutVvds = new Set(plain(BFShared.diffSailings(day('2026-08-30'), day('2026-08-31'))).rolledOut.map((x) => x.vvd));
    t('rollover pair: removed and rolled out are disjoint', roll.removed.filter((x) => rolledOutVvds.has(x.vvd)), []);

    // --- 3. formatChangeDate --------------------------------------------------------------------
    t('formatChangeDate: Fri 8/28 (spec example)', fmt('2026-08-28', '2026-08-31'), 'Fri 8/28');
    t('formatChangeDate: a gap over 3 days says so', [fmt('2026-08-21', '2026-08-25'), fmt('2026-08-21', '2026-08-24')], ['Fri 8/21 (4 days earlier)', 'Fri 8/21']);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const bad = [];
    for (let d = new Date(2024, 0, 1); d.getFullYear() < 2028; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const want = `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
        if (fmt(ymd, null) !== want) bad.push(ymd);
    }
    t('formatChangeDate: every day of 2024-2027 matches the host calendar', bad, []);
    t('formatChangeDate: invalid dates give empty text', ['2026-02-30', '2026-13-01', '2026-8-28', '', null, 20260828, {}].map((x) => fmt(x, '2026-08-31')), ['', '', '', '', '', '', '']);
    t('formatChangeDate: an invalid current date drops the gap note only', fmt('2026-08-21', 'soon'), 'Fri 8/21');
};

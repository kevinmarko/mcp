'use strict';
/**
 * Behaviour checks for BFShared.checkFeed (roadmap slice 1.5, the silent feed canary; shared/20_feed_canary.js).
 *
 * Ground truth is the committed 9-day CSV (tests/lib/history_days.js): on every one of its 9 days the canary
 * must say nothing (0 duplicate keys among real rows, 0 voyage-level disagreements, both pinned in
 * tests/check_history_days.js), and each way of breaking the feed must produce its own problem code. The
 * voyage-agreement answers are also cross-checked against the independent oracle H.voyageDisagreements.
 *
 * Synthetic feeds (the 10,000 x 100 performance feed, the row-count boundaries, prototype-name data) are built
 * here, never loaded from a file. checkFeed never gets a chance to mutate the history rows: every edit below
 * works on copies.
 */
exports.TESTS = ['checkFeed'];
exports.COUNT = 62;
exports.run = function (ctx) {
    const { BFShared, t, plain } = ctx;
    const H = ctx.history;
    const h = H.loadHistory();
    const D = h.dates;
    const LAST = '2026-09-01';

    const run = (input) => plain(BFShared.checkFeed(input));
    const codes = (r) => r.problems.map((p) => p.code);
    const only = (r, code) => r.problems.filter((p) => p.code === code);
    const copy = (rows) => rows.map((r) => Object.assign({}, r));
    const nine = (x) => D.map(() => x);

    // A subset of real header names. Aliases equal the header text, except where noted.
    const FIELDS = [
        { key: 'trade', aliases: ['Vessel 1st Trade'] },
        { key: 'lane', aliases: ['Vessel 1st Lane'] },
        { key: 'vvd', aliases: ['Vessel 1st VVD', 'VVD'] },
        { key: 'saleWeek', aliases: ['Route Date 1st Sale Week'] },
        { key: 'pic', aliases: ['MCT PIC'] },
        { key: 'maxLaden', aliases: ['Max Laden Update Old', 'MCT Max Laden'] }, // only the second alias exists: any alias will do
        { key: 'laden', aliases: ['Measures Laden TEU'] },
        { key: 'booking', aliases: ['Measures Total Booking TEU by Service'] },
        { key: 'ladenVsBooking', aliases: ['Max Laden vs POL Booking'] }, // the real header has TWO spaces before "Booking"
    ];
    const feed = (date, extra) => Object.assign({ headers: h.headers, rows: h.rowsOn(date), requiredFields: FIELDS }, extra || {});

    // Removes, renames or adds columns on a COPY of a feed: { drop: [names], rename: { old: new }, add: { name: valueFn(row, i) } }.
    const edit = (f, ops) => {
        const drop = new Set(ops.drop || []);
        const rename = ops.rename || {};
        const add = ops.add || {};
        const headers = f.headers.filter((x) => !drop.has(x)).map((x) => (x in rename ? rename[x] : x)).concat(Object.keys(add));
        const rows = f.rows.map((r, i) => {
            const o = {};
            Object.keys(r).forEach((k) => { if (!drop.has(k)) o[k in rename ? rename[k] : k] = r[k]; });
            Object.keys(add).forEach((k) => { o[k] = add[k](r, i); });
            return o;
        });
        return Object.assign({}, f, { headers, rows });
    };

    // Rows of one real sailing on LAST: one with 3+ port rows and a non-blank PIC, and one with a single port row.
    const sailings = [...h.sailings(LAST).values()];
    const multi = sailings.filter((s) => s.rows.length >= 3 && s.rows.every((r) => r['MCT PIC'].trim() !== ''));
    const single = sailings.filter((s) => s.rows.length === 1);
    const indexIn = (rows, row) => rows.indexOf(row);

    // ---------------------------------------------------------------------------------------------------
    // A. The real feed is silent on every day.
    // ---------------------------------------------------------------------------------------------------
    t('real data: every one of the 9 days is ok with no problems (the input keeps its VMS placeholder rows)',
        D.map((d) => { const r = run(feed(d)); return [r.ok, r.problems.length]; }), nine([true, 0]));
    t('real data: stats are the pinned file facts per day (all rows, real rows, 98 headers)',
        D.map((d) => run(feed(d)).stats),
        D.map((d, i) => ({
            rowCount: [994, 974, 974, 973, 971, 971, 971, 970, 971][i],
            realRowCount: [928, 906, 906, 905, 899, 899, 899, 896, 898][i],
            headerCount: 98,
        })));
    {
        const key = (r) => [r['Vessel 1st VVD'], r['Route Location Calling Port Seq'], r['Route Location 1st Pol']].join('|');
        t('trap: counting VMS rows as real rows would report 65-73 false duplicates a day; checkFeed reports none',
            {
                naive: D.map((d) => h.rowsOn(d).length - new Set(h.rowsOn(d).map(key)).size),
                checkFeed: D.map((d) => codes(run(feed(d))).includes('DUPLICATE_KEY')),
            },
            { naive: [65, 67, 67, 67, 71, 71, 71, 73, 72], checkFeed: nine(false) });
    }
    t('the documented defaults, written out, give the same answer as leaving them out',
        run(feed(LAST, {
            keyColumns: ['Vessel 1st VVD', 'Route Location Calling Port Seq', 'Route Location 1st Pol'],
            voyageFields: ['MCT PIC', 'Vessel 1st Lane', 'MCT Max Laden', 'Route Date Cut/off Date', 'Route Date 1st Sale Week'],
            vvdColumn: 'Vessel 1st VVD', maxRowDropPct: 10, prevRowCount: null,
        })), run(feed(LAST)));
    t('the voyage check agrees with the independent oracle (H.voyageDisagreements) on real columns that DO vary within a sailing',
        D.map((d) => ['Measures Laden TEU', 'Route Location 1st Pol', 'Measures Total Booking TEU by Service'].map((c) => {
            const r = run(feed(d, { voyageFields: [c] }));
            const v = only(r, 'VOYAGE_DISAGREEMENT')[0];
            return [v ? v.detail.voyageCount : 0, H.voyageDisagreements(h, d, c)];
        }).map(([got, want]) => got === want)), D.map(() => [true, true, true]));
    t('and a column that varies is really reported (not vacuous): 295 sailings differ in Laden TEU on 2026-09-01',
        only(run(feed(LAST, { voyageFields: ['Measures Laden TEU'] })), 'VOYAGE_DISAGREEMENT').map((p) => p.detail.voyageCount), [295]);

    // ---------------------------------------------------------------------------------------------------
    // B. Header problems: columns are found by name.
    // ---------------------------------------------------------------------------------------------------
    {
        const r = run(edit(feed(LAST), { drop: ['MCT PIC'] }));
        t('a required header removed -> one MISSING_FIELD naming the field and its aliases (the same column as a voyage field is not reported twice)',
            { ok: r.ok, problems: r.problems.map((p) => [p.code, p.detail.key, p.detail.role, p.detail.aliases]), headerCount: r.stats.headerCount },
            { ok: false, problems: [['MISSING_FIELD', 'pic', 'required', ['MCT PIC']]], headerCount: 97 });
    }
    {
        const withDup = (f) => { const rows = copy(f.rows); rows.push(Object.assign({}, rows.find((x) => x['Vessel 1st VVD'] !== 'VMS'))); return Object.assign({}, f, { rows }); };
        const r = run(withDup(edit(feed(LAST), { drop: ['Route Location 1st Pol'] })));
        t('a key column removed (not a required field) -> MISSING_FIELD with role "key", and the key check is skipped rather than guessing',
            r.problems.map((p) => [p.code, p.detail.key, p.detail.role]), [['MISSING_FIELD', 'Route Location 1st Pol', 'key']]);
    }
    {
        const r = run(edit(feed(LAST, { requiredFields: [] }), { drop: ['Vessel 1st VVD'] }));
        t('the VVD column removed -> a single MISSING_FIELD (role "vvd"), realRowCount is null, and no row-level problem is invented',
            { problems: r.problems.map((p) => [p.code, p.detail.role]), real: r.stats.realRowCount }, { problems: [['MISSING_FIELD', 'vvd']], real: null });
    }
    {
        const f = edit(feed(LAST), { drop: ['Route Date Cut/off Date'] });
        const sail = multi[0];
        const rows = copy(f.rows);
        const target = rows.filter((x) => x['Vessel 1st VVD'] === sail.vvd)[1];
        target['MCT PIC'] = 'Someone / Else';
        const r = run(Object.assign({}, f, { rows }));
        t('a voyage field removed -> MISSING_FIELD role "voyage", and the remaining voyage fields are still compared',
            r.problems.map((p) => [p.code, p.detail.role || null]), [['MISSING_FIELD', 'voyage'], ['VOYAGE_DISAGREEMENT', null]]);
    }
    t('header renamed by case, spacing and punctuation (key, VVD and required columns included) -> still matched, ok',
        run(edit(feed(LAST), { rename: { 'MCT PIC': ' mct   pic ', 'Vessel 1st VVD': 'VESSEL 1ST VVD', 'Route Location 1st Pol': 'route-location_1st.pol', 'Measures Laden TEU': 'measures laden teu' } })).problems,
        []);
    t('header renamed to something else ("MCT PIC Owner") -> MISSING_FIELD naming it',
        run(edit(feed(LAST), { rename: { 'MCT PIC': 'MCT PIC Owner' } })).problems.map((p) => [p.code, p.detail.key]), [['MISSING_FIELD', 'pic']]);
    t('only the exact cleaned name matches, never a substring: the alias "Max Laden" is inside "MCT Max Laden" but is MISSING_FIELD (getVal\'s second pass is the alias landmine)',
        run(feed(LAST, { requiredFields: [{ key: 'maxLadenLoose', aliases: ['Max Laden'] }] })).problems.map((p) => [p.code, p.detail.key]), [['MISSING_FIELD', 'maxLadenLoose']]);
    {
        const same = (r) => r['MCT PIC'];
        const r1 = run(edit(feed(LAST), { add: { 'mct pic': same } }));
        t('two headers that clean alike -> DUPLICATE_HEADER with both names and positions',
            r1.problems.map((p) => [p.code, p.detail]), [['DUPLICATE_HEADER', { cleaned: 'mctpic', headers: ['MCT PIC', 'mct pic'], indexes: [13, 98] }]]);
        const r2 = run(edit(feed(LAST), { add: { 'mct pic': (r, i) => `X${i}` } }));
        t('with duplicate headers the LAST one supplies the values, as in the app (here its per-row values make sailings disagree)',
            codes(r2), ['DUPLICATE_HEADER', 'VOYAGE_DISAGREEMENT']);
    }
    {
        const f = edit(feed(LAST), { add: { '': () => 'a', '  ': () => 'b' } });
        f.headers = f.headers.concat([null, 5]);
        t('blank, whitespace-only and non-text headers are not duplicates and not an error (several blank columns are normal)',
            { problems: run(f).problems, headerCount: run(f).stats.headerCount }, { problems: [], headerCount: 102 });
    }

    // ---------------------------------------------------------------------------------------------------
    // C. Row-count drop.
    // ---------------------------------------------------------------------------------------------------
    t('half the rows with prevRowCount = the full count -> ROW_COUNT_DROP with the numbers',
        run(feed(LAST, { rows: h.rowsOn(LAST).slice(0, 485), prevRowCount: 971 })).problems.map((p) => [p.code, p.detail]),
        [['ROW_COUNT_DROP', { rowCount: 485, prevRowCount: 971, dropPct: 50.05, maxRowDropPct: 10 }]]);

    // A synthetic 10,000 x 100 feed: two port rows per voyage, every key unique, voyage fields consistent.
    const SYN_HEADERS = ['Vessel 1st VVD', 'Route Location Calling Port Seq', 'Route Location 1st Pol', 'MCT PIC', 'Vessel 1st Lane', 'MCT Max Laden', 'Route Date Cut/off Date', 'Route Date 1st Sale Week'];
    while (SYN_HEADERS.length < 100) SYN_HEADERS.push(`Filler ${SYN_HEADERS.length}`);
    const synRow = (i) => {
        const o = {};
        SYN_HEADERS.forEach((k) => { o[k] = ''; });
        o['Vessel 1st VVD'] = `SYN${Math.floor(i / 2)}W`;
        o['Route Location Calling Port Seq'] = String(i % 2 + 1);
        o['Route Location 1st Pol'] = `P${i % 2}`;
        o['MCT PIC'] = 'A / B';
        o['Vessel 1st Lane'] = 'LN1';
        o['MCT Max Laden'] = '5000';
        o['Route Date Cut/off Date'] = '9/1/2026';
        o['Route Date 1st Sale Week'] = '2026/W36';
        for (let c = 8; c < 100; c++) o[SYN_HEADERS[c]] = String(i * c);
        return o;
    };
    const SYN = []; for (let i = 0; i < 10000; i++) SYN.push(synRow(i));
    const syn = (n, extra) => Object.assign({ headers: SYN_HEADERS, rows: SYN.slice(0, n) }, extra || {});
    // The tiny feed: 8 named columns, rows given as { vvd, seq, pol, pic, lane } overrides.
    const mini = (specs, extra) => Object.assign({
        headers: SYN_HEADERS.slice(0, 8),
        rows: specs.map((s, i) => Object.assign(synRow(i), s)),
    }, extra || {});

    t('the limit is "more than 10%": exactly 10% down is silent, 10.01% down is a problem (10,000 -> 9,000 vs 8,999)',
        { exact: codes(run(syn(9000, { prevRowCount: 10000 }))), over: run(syn(8999, { prevRowCount: 10000 })).problems.map((p) => [p.code, p.detail.dropPct]) },
        { exact: [], over: [['ROW_COUNT_DROP', 10.01]] });
    t('the same boundary on small counts: 1000 -> 900 is silent, 1000 -> 899 is a problem',
        { exact: codes(run(syn(900, { prevRowCount: 1000 }))), over: codes(run(syn(899, { prevRowCount: 1000 }))) },
        { exact: [], over: ['ROW_COUNT_DROP'] });
    t('silent without a comparison: prevRowCount null, missing or 0, and when the feed grew',
        [null, undefined, 0].map((p) => codes(run(syn(100, { prevRowCount: p })))).concat([codes(run(syn(100, { prevRowCount: 50 })))]),
        [[], [], [], []]);
    t('maxRowDropPct is honoured: with 50, a fall of exactly 50% is silent and 51.1% is a problem; with 0, equal counts are silent and any drop is a problem',
        {
            fifty: codes(run(syn(500, { prevRowCount: 1000, maxRowDropPct: 50 }))),
            fiftyOne: codes(run(syn(489, { prevRowCount: 1000, maxRowDropPct: 50 }))),
            zeroEqual: codes(run(syn(100, { prevRowCount: 100, maxRowDropPct: 0 }))),
            zeroLess: codes(run(syn(99, { prevRowCount: 100, maxRowDropPct: 0 }))),
            // 7 / 100 * 100 is 7.000000000000001 in floating point, so a divided comparison would flag an exact 7% fall
            sevenExact: codes(run(syn(93, { prevRowCount: 100, maxRowDropPct: 7 }))),
            sevenOver: codes(run(syn(92, { prevRowCount: 100, maxRowDropPct: 7 }))),
        },
        { fifty: [], fiftyOne: ['ROW_COUNT_DROP'], zeroEqual: [], zeroLess: ['ROW_COUNT_DROP'], sevenExact: [], sevenOver: ['ROW_COUNT_DROP'] });
    t('an unusable prevRowCount (text, negative, NaN, Infinity, an object) is a BAD_INPUT, never a throw or a silent pass',
        ['12', -1, NaN, Infinity, {}].map((p) => run(syn(10, { prevRowCount: p })).problems.map((x) => [x.code, x.detail.what])),
        [0, 1, 2, 3, 4].map(() => [['BAD_INPUT', 'prevRowCount']]));
    t('an unusable maxRowDropPct is a BAD_INPUT and the default 10 is used instead (a 20% drop is still caught)',
        run(syn(80, { prevRowCount: 100, maxRowDropPct: -5 })).problems.map((p) => [p.code, p.detail.what || p.detail.maxRowDropPct]),
        [['BAD_INPUT', 'maxRowDropPct'], ['ROW_COUNT_DROP', 10]]);

    // ---------------------------------------------------------------------------------------------------
    // D. No rows, no real rows.
    // ---------------------------------------------------------------------------------------------------
    t('empty rows -> NO_ROWS and nothing else', { codes: codes(run(feed(LAST, { rows: [] }))), stats: run(feed(LAST, { rows: [] })).stats },
        { codes: ['NO_ROWS'], stats: { rowCount: 0, realRowCount: 0, headerCount: 98 } });
    t('empty rows after a real load is also a total ROW_COUNT_DROP', codes(run(feed(LAST, { rows: [], prevRowCount: 971 }))), ['NO_ROWS', 'ROW_COUNT_DROP']);
    {
        const vms = h.rowsOn(LAST).filter((r) => r['Vessel 1st VVD'] === 'VMS');
        const placeholders = [' vms ', '', null, undefined, 'VMS'].map((v, i) => Object.assign({}, vms[i], { 'Vessel 1st VVD': v }));
        const r = run(feed(LAST, { rows: vms }));
        const r2 = run(feed(LAST, { rows: placeholders }));
        t('only placeholders -> NO_REAL_ROWS (the repeated VMS key is not reported as duplicates); blank, null, undefined and "vms" in any case or padding count as placeholders',
            { vms: [codes(r), r.stats.realRowCount, vms.length], mixed: [codes(r2), r2.stats.realRowCount] },
            { vms: [['NO_REAL_ROWS'], 0, 73], mixed: [['NO_REAL_ROWS'], 0] });
    }
    {
        const rows = copy(h.rowsOn(LAST));
        const vms = rows.find((r) => r['Vessel 1st VVD'] === 'VMS');
        const f = feed(LAST, { rows: rows.concat([Object.assign({}, vms), Object.assign({}, vms, { 'MCT PIC': 'Totally / Different' })]) });
        t('extra and conflicting placeholder rows change nothing but the row count',
            { problems: run(f).problems, stats: run(f).stats }, { problems: [], stats: { rowCount: 973, realRowCount: 898, headerCount: 98 } });
    }

    // ---------------------------------------------------------------------------------------------------
    // E. Duplicate keys.
    // ---------------------------------------------------------------------------------------------------
    {
        const rows = copy(h.rowsOn(LAST));
        const at = rows.findIndex((r) => r['Vessel 1st VVD'] === multi[0].vvd);
        rows.push(Object.assign({}, rows[at]));
        const r = run(feed(LAST, { rows }));
        t('a real row duplicated -> DUPLICATE_KEY with the key, the count and the row positions',
            r.problems.map((p) => [p.code, p.detail]),
            [['DUPLICATE_KEY', {
                keyColumns: ['Vessel 1st VVD', 'Route Location Calling Port Seq', 'Route Location 1st Pol'], duplicateKeyCount: 1, extraRows: 1,
                examples: [{ key: [rows[at]['Vessel 1st VVD'], rows[at]['Route Location Calling Port Seq'], rows[at]['Route Location 1st Pol']], count: 2, rowIndexes: [at, 971] }],
            }]]);
        t('the message names the key', r.problems[0].message.includes(multi[0].vvd) && /appears 2 times/.test(r.problems[0].message), true);
    }
    {
        const rows = copy(h.rowsOn(LAST));
        const a = rows.findIndex((r) => r['Vessel 1st VVD'] === multi[0].vvd);
        const b = rows.findIndex((r) => r['Vessel 1st VVD'] === multi[1].vvd);
        rows.push(Object.assign({}, rows[a]), Object.assign({}, rows[a]), Object.assign({}, rows[b]));
        const d = only(run(feed(LAST, { rows })), 'DUPLICATE_KEY')[0].detail;
        t('three copies of one row and two of another: counted per key and per extra row',
            { keys: d.duplicateKeyCount, extra: d.extraRows, counts: d.examples.map((e) => e.count), positions: d.examples.map((e) => e.rowIndexes) },
            { keys: 2, extra: 3, counts: [3, 2], positions: [[a, 971, 972], [b, 973]] });
    }
    {
        const rows = copy(h.rowsOn(LAST));
        const at = rows.findIndex((r) => r['Vessel 1st VVD'] === multi[0].vvd);
        rows.push(Object.assign({}, rows[at], { 'Route Location Calling Port Seq': '9' }));
        t('the key is VVD + Seq + POL: the same VVD and POL under another Seq is not a duplicate by default, but is under [VVD, POL]',
            { byDefault: codes(run(feed(LAST, { rows }))), vvdPol: run(feed(LAST, { rows, keyColumns: ['Vessel 1st VVD', 'Route Location 1st Pol'] })).problems.map((p) => [p.code, p.detail.keyColumns]) },
            { byDefault: [], vvdPol: [['DUPLICATE_KEY', ['Vessel 1st VVD', 'Route Location 1st Pol']]] });
        rows.pop();
        rows.push(Object.assign({}, rows[at], { 'Vessel 1st VVD': ` ${rows[at]['Vessel 1st VVD'].toLowerCase()} ` }));
        t('the VVD part of a key is normalised (trimmed, upper case), as everywhere else in the app: " nret0084e " repeats NRET0084E',
            codes(run(feed(LAST, { rows }))), ['DUPLICATE_KEY']);
        t('keyColumns: [] switches the key check off on purpose; a custom key column that is not in the feed is MISSING_FIELD, not a pass',
            { off: codes(run(feed(LAST, { rows, keyColumns: [] }))), absent: run(feed(LAST, { rows, keyColumns: ['Vessel 1st VVD', 'No Such Column'] })).problems.map((p) => [p.code, p.detail.key, p.detail.role]) },
            { off: [], absent: [['MISSING_FIELD', 'No Such Column', 'key']] });
    }
    {
        const rows = copy(h.rowsOn(LAST));
        const picks = multi.slice(0, 7).map((s) => rows.findIndex((r) => r['Vessel 1st VVD'] === s.vvd));
        picks.forEach((at) => rows.push(Object.assign({}, rows[at])));
        const d = only(run(feed(LAST, { rows })), 'DUPLICATE_KEY')[0].detail;
        t('examples are capped at 5 but the totals are not', { keys: d.duplicateKeyCount, extra: d.extraRows, shown: d.examples.length }, { keys: 7, extra: 7, shown: 5 });
    }

    // ---------------------------------------------------------------------------------------------------
    // F. Voyage-level agreement.
    // ---------------------------------------------------------------------------------------------------
    {
        const sail = multi[0];
        const rows = copy(h.rowsOn(LAST));
        const mine = rows.filter((r) => r['Vessel 1st VVD'] === sail.vvd);
        const original = mine[1]['MCT PIC'];
        mine[1]['MCT PIC'] = 'Zed / Changed';
        const r = run(feed(LAST, { rows }));
        t('one port row of a sailing gets a different MCT PIC -> VOYAGE_DISAGREEMENT with the VVD, the field and both values',
            r.problems.map((p) => [p.code, p.detail]),
            [['VOYAGE_DISAGREEMENT', { voyageCount: 1, pairCount: 1, examples: [{ vvd: sail.vvd, field: 'MCT PIC', values: [original, 'Zed / Changed'], valueCount: 2 }] }]]);
        t('the message names the VVD, the field and both values',
            [sail.vvd, 'MCT PIC', original, 'Zed / Changed'].map((x) => r.problems[0].message.includes(x)), [true, true, true, true]);
        mine[1]['MCT PIC'] = '';
        t('a blank on one port row counts as a difference and is shown as (blank)',
            run(feed(LAST, { rows })).problems.map((p) => [p.detail.examples[0].values, /\(blank\)/.test(p.message)]), [[[original, ''], true]]);
        mine[1]['MCT PIC'] = ` ${original} `;
        t('stray spaces around a value are not a difference', codes(run(feed(LAST, { rows }))), []);
        mine[1]['MCT PIC'] = original.toLowerCase();
        t('a case-only difference IS a disagreement (the CSV text is compared, not a folded copy)', codes(run(feed(LAST, { rows }))), ['VOYAGE_DISAGREEMENT']);
    }
    {
        const rows = copy(h.rowsOn(LAST));
        const only1 = rows.find((r) => r['Vessel 1st VVD'] === single[0].vvd);
        only1['MCT PIC'] = 'Anything / Goes';
        const vms = rows.filter((r) => r['Vessel 1st VVD'] === 'VMS');
        vms[0]['MCT PIC'] = 'VMS / Garbage';
        vms[1]['Vessel 1st Lane'] = 'ZZZ';
        t('a one-port sailing cannot disagree with itself, and VMS rows are never compared', codes(run(feed(LAST, { rows }))), []);
    }
    {
        const rows = copy(h.rowsOn(LAST));
        const touch = (s, col, val) => { rows.filter((r) => r['Vessel 1st VVD'] === s.vvd)[1][col] = val; };
        multi.slice(0, 7).forEach((s) => touch(s, 'MCT PIC', 'Changed / Pic'));
        touch(multi[0], 'Vessel 1st Lane', 'ZZZ');
        const d = only(run(feed(LAST, { rows })), 'VOYAGE_DISAGREEMENT')[0].detail;
        const touched = new Set(multi.slice(0, 7).map((s) => s.vvd));
        const order = [];
        rows.forEach((r) => { const v = r['Vessel 1st VVD']; if (touched.has(v) && !order.includes(v)) order.push(v); });
        const expected = [];
        order.forEach((v) => { expected.push([v, 'MCT PIC']); if (v === multi[0].vvd) expected.push([v, 'Vessel 1st Lane']); });
        t('7 sailings and 8 (sailing, field) pairs differ: both totals are exact; examples are capped at 5, in order of first appearance in the rows, fields in list order',
            { voyages: d.voyageCount, pairs: d.pairCount, examples: d.examples.map((e) => [e.vvd, e.field]) },
            { voyages: 7, pairs: 8, examples: expected.slice(0, 5) });
    }
    {
        const r = run(mini([{ 'Vessel 1st VVD': 'abc1w', 'Route Location Calling Port Seq': '1', 'MCT PIC': 'P1' }, { 'Vessel 1st VVD': 'ABC1W ', 'Route Location Calling Port Seq': '2', 'MCT PIC': 'P2' }]));
        t('rows of one voyage are grouped by the normalised VVD ("abc1w" and "ABC1W " are one sailing)',
            r.problems.map((p) => [p.code, p.detail.examples.map((e) => [e.vvd, e.values])]), [['VOYAGE_DISAGREEMENT', [['ABC1W', ['P1', 'P2']]]]]);
    }
    {
        const rows = copy(h.rowsOn(LAST));
        const mine = rows.filter((r) => r['Vessel 1st VVD'] === multi[0].vvd);
        mine[1]['MCT PIC'] = 'Changed / Pic';
        t('voyageFields: [] switches the voyage check off; a field outside the default list can be checked instead',
            { off: codes(run(feed(LAST, { rows, voyageFields: [] }))), booking: codes(run(feed(LAST, { rows, voyageFields: ['Measures Total Booking TEU by Service'] }))) },
            { off: [], booking: [] });
    }

    // ---------------------------------------------------------------------------------------------------
    // G. It never throws, never mutates, and always answers in the same shape.
    // ---------------------------------------------------------------------------------------------------
    t('input that is not an object -> BAD_INPUT (no throw), zeroed stats',
        [undefined, null, 'x', 42, true, function () {}].map((x) => { const r = run(x); return [r.ok, codes(r), r.problems[0].detail.what, r.stats]; })
            .concat([(() => { const r = plain(BFShared.checkFeed()); return [r.ok, codes(r), r.problems[0].detail.what, r.stats]; })()]),
        [undefined, null, 'x', 42, true, 'fn', 'none'].map(() => [false, ['BAD_INPUT'], 'input', { rowCount: 0, realRowCount: null, headerCount: 0 }]));
    {
        const r = run({ rows: h.rowsOn(LAST).slice(0, 5) });
        t('headers missing -> BAD_INPUT; the row count is still reported, real rows are unknowable', [codes(r), r.problems[0].detail.what, r.stats], [['BAD_INPUT'], 'headers', { rowCount: 5, realRowCount: null, headerCount: 0 }]);
    }
    t('rows that are not a list (text, an object, null, a number, missing) -> BAD_INPUT, and the header checks still run',
        ['x', {}, null, 5, undefined].map((rows) => run({ headers: h.headers.slice(1), rows, requiredFields: FIELDS.slice(0, 1).concat([{ key: 'gone', aliases: ['Record Date'] }]) }).problems.map((p) => [p.code, p.detail.what || p.detail.key])),
        ['x', {}, null, 5, undefined].map(() => [['BAD_INPUT', 'rows'], ['MISSING_FIELD', 'gone']]));
    {
        const rows = copy(h.rowsOn(LAST));
        const r = run(feed(LAST, { rows: rows.concat([null, 'row', 5]) }));
        t('rows that are not objects or arrays are reported once and skipped; the others are still judged; an empty object is a blank-VVD placeholder, not an error',
            { problems: r.problems.map((p) => [p.code, p.detail]), stats: r.stats, emptyObject: run(feed(LAST, { rows: rows.concat([{}]) })).problems },
            { problems: [['BAD_INPUT', { what: 'rows', badRowCount: 3, firstBadRowIndex: 971 }]], stats: { rowCount: 974, realRowCount: 898, headerCount: 98 }, emptyObject: [] });
    }
    {
        const r1 = run(feed(LAST, { requiredFields: 'nope' }));
        const r2 = run(feed(LAST, { requiredFields: [null, { key: 'a' }, { aliases: [] }, { aliases: [1] }, { key: 'kept', aliases: ['Nope Nothing'] }, { aliases: ['Also Nope'] }] }));
        t('requiredFields that are not a list, or entries without usable aliases -> BAD_INPUT (with positions); the usable entries are still checked, and a missing key falls back to the first alias',
            { notList: r1.problems.map((p) => [p.code, p.detail.what]), entries: r2.problems.map((p) => [p.code, p.detail.positions || p.detail.key]) },
            { notList: [['BAD_INPUT', 'requiredFields']], entries: [['BAD_INPUT', [0, 1, 2, 3]], ['MISSING_FIELD', 'kept'], ['MISSING_FIELD', 'Also Nope']] });
    }
    t('keyColumns, voyageFields and vvdColumn that are not usable names -> BAD_INPUT each, with the defaults used so the real feed is otherwise clean',
        [{ keyColumns: 'x' }, { keyColumns: [1] }, { voyageFields: ['MCT PIC', ''] }, { voyageFields: {} }, { vvdColumn: 7 }, { vvdColumn: '  ' }]
            .map((extra) => run(feed(LAST, extra)).problems.map((p) => [p.code, p.detail.what])),
        [['keyColumns'], ['keyColumns'], ['voyageFields'], ['voyageFields'], ['vvdColumn'], ['vvdColumn']].map(([w]) => [['BAD_INPUT', w]]));
    {
        const boom = { headers: h.headers, requiredFields: [] };
        Object.defineProperty(boom, 'rows', { get() { throw new Error('boom'); } });
        const cellBomb = { headers: ['Vessel 1st VVD'], rows: [{ 'Vessel 1st VVD': { toString() { throw new Error('bomb'); } } }] };
        const hostile = { headers: ['Vessel 1st VVD'], rows: [{ 'Vessel 1st VVD': { toString() { throw { get message() { throw new Error('worse'); } }; } } }] };
        t('a getter or a cell that throws is turned into BAD_INPUT, whatever it throws',
            [boom, cellBomb, hostile].map((x) => { const r = run(x); return [r.ok, codes(r), r.problems[0].detail.what]; }),
            [[false, ['BAD_INPUT'], 'exception'], [false, ['BAD_INPUT'], 'exception'], [false, ['BAD_INPUT'], 'exception']]);
    }
    {
        const f = edit(feed(LAST, { prevRowCount: 5000, keyColumns: ['Vessel 1st VVD', 'Route Location 1st Pol'], voyageFields: ['MCT PIC'] }), { drop: ['MCT Max Laden'] });
        f.rows.push(f.rows[3]);
        const before = JSON.stringify(f);
        BFShared.checkFeed(f);
        t('the input is never modified (headers, rows, requiredFields and options are the same after a call that reports problems)', JSON.stringify(f) === before, true);
    }
    {
        const asArrays = (f) => Object.assign({}, f, { rows: f.rows.map((r) => f.headers.map((k) => r[k])) });
        const rows = copy(h.rowsOn(LAST));
        rows.push(Object.assign({}, rows.find((r) => r['Vessel 1st VVD'] === multi[0].vvd)));
        rows.filter((r) => r['Vessel 1st VVD'] === multi[1].vvd)[1]['MCT PIC'] = 'Changed / Pic';
        const broken = feed(LAST, { rows, prevRowCount: 2000 });
        t('rows given as arrays in header order give exactly the answer the object form gives (healthy and broken)',
            { healthy: run(asArrays(feed(LAST))), broken: run(asArrays(broken)) }, { healthy: run(feed(LAST)), broken: run(broken) });
    }
    {
        const f = edit(feed(LAST, { prevRowCount: 5000, maxRowDropPct: 'x' }), { drop: ['MCT Max Laden'], add: { 'vessel 1st trade': (r) => r['Vessel 1st Trade'] } });
        const rows = copy(f.rows);
        rows.push(Object.assign({}, rows.find((r) => r['Vessel 1st VVD'] === multi[1].vvd)));
        rows.filter((r) => r['Vessel 1st VVD'] === multi[0].vvd)[1]['Vessel 1st Lane'] = 'ZZZ';
        const r = run(Object.assign({}, f, { rows }));
        t('problems come in a fixed order whatever the input order: BAD_INPUT, DUPLICATE_HEADER, MISSING_FIELD, ROW_COUNT_DROP, DUPLICATE_KEY, VOYAGE_DISAGREEMENT',
            codes(r), ['BAD_INPUT', 'DUPLICATE_HEADER', 'MISSING_FIELD', 'ROW_COUNT_DROP', 'DUPLICATE_KEY', 'VOYAGE_DISAGREEMENT']);
        t('result shape: { ok, problems, stats }; each problem is exactly { code, message, detail } with a text message and an object detail; same input, same answer',
            {
                top: Object.keys(r).sort(),
                stats: Object.keys(r.stats).sort(),
                problems: r.problems.map((p) => [Object.keys(p).sort().join(), typeof p.message === 'string' && p.message.length > 10, p.detail !== null && typeof p.detail === 'object']),
                ok: r.ok,
                again: JSON.stringify(run(Object.assign({}, f, { rows }))) === JSON.stringify(r),
            },
            {
                top: ['ok', 'problems', 'stats'],
                stats: ['headerCount', 'realRowCount', 'rowCount'],
                problems: r.problems.map(() => ['code,detail,message', true, true]),
                ok: false,
                again: true,
            });
    }
    {
        const protoNames = ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf'];
        const ok = run(mini(protoNames.map((n, i) => ({ 'Vessel 1st VVD': n, 'Route Location Calling Port Seq': n, 'Route Location 1st Pol': n, 'MCT PIC': n, 'Vessel 1st Lane': n }))));
        const dup = run(mini([{ 'Vessel 1st VVD': 'constructor', 'MCT PIC': '__proto__' }, { 'Vessel 1st VVD': 'constructor', 'MCT PIC': 'toString', 'Route Location Calling Port Seq': '2' }, { 'Vessel 1st VVD': 'constructor', 'MCT PIC': '__proto__', 'Route Location Calling Port Seq': '1' }]));
        t('data that is named like an inherited property ("__proto__", "constructor", "hasOwnProperty"...) is just data: no false problems, and real ones still found',
            { clean: ok.problems, dup: codes(dup) }, { clean: [], dup: ['DUPLICATE_KEY', 'VOYAGE_DISAGREEMENT'] });
    }

    {
        const rows = [{ 'Vessel 1st VVD': 'V1', 'Route Location Calling Port Seq': 'a|b', 'Route Location 1st Pol': 'c' },
            { 'Vessel 1st VVD': 'V1', 'Route Location Calling Port Seq': 'a', 'Route Location 1st Pol': 'b|c' },
            { 'Vessel 1st VVD': 'V1', 'Route Location Calling Port Seq': '1:a', 'Route Location 1st Pol': '' },
            { 'Vessel 1st VVD': 'V1', 'Route Location Calling Port Seq': '1', 'Route Location 1st Pol': ':a' }];
        t('key cells that would collide if joined naively ("a|b" + "c" vs "a" + "b|c", "1:a" + "" vs "1" + ":a") are different keys',
            codes(run(mini(rows.map((r) => Object.assign({ 'MCT PIC': 'P' }, r))))), []);
    }
    {
        const many = []; for (let i = 0; i < 12; i++) many.push({ 'Vessel 1st VVD': 'MANY', 'Route Location Calling Port Seq': String(i), 'MCT PIC': `P${i}` });
        ['A', 'B', 'B', 'A'].forEach((pic, i) => many.push({ 'Vessel 1st VVD': 'REP', 'Route Location Calling Port Seq': String(i), 'MCT PIC': pic }));
        const [e, rep] = only(run(mini(many)), 'VOYAGE_DISAGREEMENT')[0].detail.examples;
        t('the values shown for one disagreeing field are DISTINCT values, capped at 10, with the true count beside them',
            { shown: e.values, valueCount: e.valueCount, repeated: [rep.values, rep.valueCount] },
            { shown: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'], valueCount: 12, repeated: [['A', 'B'], 2] });
    }
    {
        const headers = ['Vessel 1st VVD', 'Route Location Calling Port Seq', 'Route Location 1st Pol', 'constructor', 'toString'];
        const rows = [{ 'Vessel 1st VVD': 'V1', 'Route Location Calling Port Seq': '1', 'Route Location 1st Pol': 'P' },
            { 'Vessel 1st VVD': 'V1', 'Route Location Calling Port Seq': '2', 'Route Location 1st Pol': 'P', constructor: '', toString: '' }];
        t('a header spelled like an inherited property ("constructor", "toString") reads only the row\'s own value: a row without it is blank, never a function',
            codes(run({ headers, rows, voyageFields: ['constructor', 'toString'] })), []);
    }
    {
        const r = run(mini([{ 'Vessel 1st VVD': 123 }, { 'Vessel 1st VVD': '  ' }, { 'Vessel 1st VVD': 0 }, { 'Vessel 1st VVD': 'VMS' }]));
        t('a VVD cell that is a number counts as a real VVD (read as text, 0 included), so a numeric export does not look like all placeholders',
            [codes(r), r.stats.realRowCount], [[], 2]);
    }

    // ---------------------------------------------------------------------------------------------------
    // H. Messages say what is wrong, and speed.
    // ---------------------------------------------------------------------------------------------------
    {
        const miss = run(edit(feed(LAST), { drop: ['Measures Laden TEU'] })).problems[0].message;
        const drop = run(feed(LAST, { rows: h.rowsOn(LAST).slice(0, 485), prevRowCount: 971 })).problems[0].message;
        const dupH = run(edit(feed(LAST), { add: { 'MCT  PIC': (r) => r['MCT PIC'] } })).problems[0].message;
        const none = run(feed(LAST, { rows: [] })).problems[0].message;
        const allVms = run(feed(LAST, { rows: h.vmsRows(LAST) })).problems[0].message;
        t('messages carry the specifics a person needs',
            [/"laden"/.test(miss) && /Measures Laden TEU/.test(miss), /485 rows/.test(drop) && /971/.test(drop) && /50\.05%/.test(drop) && /limit is 10%/.test(drop),
                /"MCT PIC"/.test(dupH) && /"MCT  PIC"/.test(dupH), /no data rows/.test(none), /73 rows/.test(allVms) && /placeholder/.test(allVms)],
            [true, true, true, true, true]);
    }
    {
        const f = syn(10000);
        const start = Date.now();
        const r = BFShared.checkFeed(f);
        const ms = Date.now() - start;
        t('performance: 10,000 rows x 100 columns is clean and takes well under a second (limit asserted: 1000 ms; real cost is tens of milliseconds)',
            { ok: r.ok, stats: plain(r.stats), fast: ms < 1000 }, { ok: true, stats: { rowCount: 10000, realRowCount: 10000, headerCount: 100 }, fast: true });
        const bad = copy(SYN.slice(0, 10000));
        bad.forEach((row, i) => { if (i % 2 === 1) row['MCT PIC'] = `Q${i}`; });
        const dupAll = bad.concat(bad);
        const start2 = Date.now();
        const r2 = BFShared.checkFeed({ headers: SYN_HEADERS, rows: dupAll });
        const ms2 = Date.now() - start2;
        t('performance, worst case: 20,000 rows that all repeat a key and half disagree still answer fast, with capped output',
            { codes: codes(plain(r2)), examples: plain(r2).problems.map((p) => p.detail.examples.length), fast: ms2 < 1000 },
            { codes: ['DUPLICATE_KEY', 'VOYAGE_DISAGREEMENT'], examples: [5, 5], fast: true });
    }
};

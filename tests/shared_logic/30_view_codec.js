'use strict';
/**
 * Behaviour checks for BFShared.encodeView / BFShared.decodeView (shared/30_view_codec.js, roadmap
 * slice 4.1, shareable view links). The contract is in that file's header; this file pins it.
 *
 * WHY A SECOND, INDEPENDENT WRITER OF THE FORMAT. decodeView is exercised mostly on text that THIS file
 * builds (frame(), below, using Node's Buffer and its own CRC-24), not on text encodeView produced.
 * A decoder tested only against its own encoder agrees with it even when both are wrong; this one is
 * held to the format as written down in the header (v1.<base64url of UTF-8 JSON>.<CRC-24 as base64url>),
 * and the golden strings below pin the exact bytes so a change of format is a deliberate edit here.
 *
 * WHAT IS REAL DATA. The realistic round trip and the stale-sale-week case take their lanes, sale weeks,
 * yards, analysts and remark text from the committed 9-day CSV through ctx.history (the window rolled
 * on 2026-08-31, which is exactly the staleness this feature has to survive). The rest builds hostile
 * input on purpose: nothing about it comes from the CSV.
 *
 * Every dropped/applied/errors value is checked for SHAPE by problemsWith(), a validator written here
 * from the contract, on every hostile case and on 4,000 fuzz inputs, so "never returns a key outside the
 * whitelist or a value of the wrong type" is asserted rather than hoped.
 */
exports.TESTS = ['encodeView', 'encodeViewReason', 'decodeView'];
exports.COUNT = 343;
exports.run = function (ctx) {
    const { BFShared, history, t } = ctx;
    const E = (state) => BFShared.encodeView(state);
    const R = (state) => BFShared.encodeViewReason(state);
    const D = (text, sets) => BFShared.decodeView(text, sets);

    // ---------------------------------------------------------------------------------------------
    // The independent writer of the format (an oracle: Node's Buffer, its own CRC-24).
    // ---------------------------------------------------------------------------------------------
    const crc24 = (text) => {
        let crc = 0xB704CE;
        for (const byte of Buffer.from(text, 'latin1')) {
            for (let k = 7; k >= 0; k--) {
                const top = (crc >> 23) & 1;
                crc = (crc << 1) & 0xFFFFFF;
                if (((byte >> k) & 1) ^ top) crc ^= 0x864CFB;
            }
        }
        return crc;
    };
    const checkOf = (payload) => {
        const c = crc24(payload);
        return Buffer.from([(c >> 16) & 255, (c >> 8) & 255, c & 255]).toString('base64url');
    };
    const framePayload = (payload) => `v1.${payload}.${checkOf(payload)}`;
    const frameBytes = (bytes) => framePayload(Buffer.from(bytes).toString('base64url'));
    const frame = (jsonText) => frameBytes(Buffer.from(jsonText, 'utf8'));

    // ---------------------------------------------------------------------------------------------
    // The contract, written out again for the shape checks.
    // ---------------------------------------------------------------------------------------------
    const LIST_KEYS = ['selectedAnalysts', 'selectedApStatuses', 'selectedCoasts', 'selectedLanes', 'selectedMktgAnalysts', 'selectedSaleWeeks', 'selectedSubTrades', 'selectedYards'];
    const WHITELIST = ['date', 'headerFilters', ...LIST_KEYS, 'tab', 'weeksAhead', 'yardSearchText'].sort();
    const TABS = ['compare', 'detail', 'pol_booking', 'sector_summary', 'trade_summary'];
    const REASONS = ['not-in-current-data', 'unknown-key', 'forbidden-key', 'invalid-key', 'wrong-type', 'too-long', 'too-many-items', 'too-many-keys', 'invalid-value'];
    // internal-error is deliberately absent: it is a safety net, and no input may reach it.
    const ERRORS = ['not-a-string', 'empty', 'too-long', 'bad-characters', 'bad-format', 'unsupported-version', 'bad-checksum', 'bad-base64', 'bad-utf8', 'bad-json', 'not-an-object'];
    const tag = (v) => Object.prototype.toString.call(v);
    const isRealDate = (s) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
        const [y, m, d] = s.split('-').map(Number);
        if (y < 2000 || y > 2099) return false;
        const dt = new Date(Date.UTC(y, m - 1, d));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    };
    const isStr = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;

    /** Every way a decodeView result can break the contract, as strings ([] = well-formed). */
    function problemsWith(res) {
        const p = [];
        if (tag(res) !== '[object Object]' || Object.keys(res).sort().join() !== 'applied,dropped,errors,state') return ['result is not exactly {applied, dropped, errors, state}'];
        const st = res.state;
        if (tag(st) !== '[object Object]') return ['state is not a plain object'];
        if (Object.keys(Object.getPrototypeOf(st)).length !== 0) p.push('state prototype has enumerable keys');
        Object.keys(st).forEach((k) => {
            const v = st[k];
            if (!WHITELIST.includes(k)) p.push(`state key outside the whitelist: ${k.slice(0, 40)}`);
            else if (LIST_KEYS.includes(k)) {
                if (!Array.isArray(v) || v.length < 1 || v.length > 200 || !v.every((x) => isStr(x, 0, 200))) p.push(`${k} is not a list of 1..200 strings of <= 200 chars`);
            } else if (k === 'yardSearchText') {
                if (!isStr(v, 1, 200)) p.push('yardSearchText is not a string of 1..200 chars');
            } else if (k === 'tab') {
                if (!TABS.includes(v)) p.push('tab is not a tab id');
            } else if (k === 'date') {
                if (typeof v !== 'string' || !isRealDate(v)) p.push('date is not a real date');
            } else if (k === 'weeksAhead') {
                if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 52) p.push('weeksAhead is not an integer 1..52');
            } else if (k === 'headerFilters') {
                const names = tag(v) === '[object Object]' ? Object.keys(v) : null;
                if (!names || names.length < 1 || names.length > 40) p.push('headerFilters is not an object of 1..40 keys');
                else {
                    if (Object.keys(Object.getPrototypeOf(v)).length !== 0) p.push('headerFilters prototype has enumerable keys');
                    names.forEach((n) => {
                        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(n) || ['constructor', 'prototype', '__proto__'].includes(n)) p.push(`headerFilters key ${n.slice(0, 40)}`);
                        if (!isStr(v[n], 1, 200)) p.push(`headerFilters.${n.slice(0, 40)} is not a string of 1..200 chars`);
                    });
                }
            }
        });
        if (JSON.stringify(res.applied) !== JSON.stringify(Object.keys(st).sort())) p.push('applied is not the sorted keys of state');
        if (!Array.isArray(res.dropped) || !res.dropped.every((d) => tag(d) === '[object Object]' && Object.keys(d).sort().join() === 'key,reason,value'
            && isStr(d.key, 0, 64) && isStr(d.value, 0, 200) && REASONS.includes(d.reason))) p.push('dropped holds an entry that is not {key<=64, value<=200, known reason}');
        if (!Array.isArray(res.errors) || !res.errors.every((e) => ERRORS.includes(e))) p.push(`errors holds an unknown code: ${JSON.stringify(res.errors)}`);
        else if (res.errors.length > 0 && (Object.keys(st).length || res.applied.length || res.dropped.length)) p.push('a refused text still returned a state, applied or dropped');
        return p;
    }
    // The fields most assertions want: what was applied, and what was reported, in one comparable value.
    const outcome = (res) => ({ errors: res.errors, state: res.state, dropped: res.dropped, problems: problemsWith(res) });
    const lines = (res) => res.dropped.map((d) => `${d.key}|${d.value}|${d.reason}`);
    const canon = (x) => (Array.isArray(x) ? `[${x.map(canon).join(',')}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}` : JSON.stringify(x));

    // =============================================================================================
    // 1. The oracle itself, and the exact bytes of the format.
    // =============================================================================================
    t('oracle: the test-side CRC-24 gives the standard check value 0x21CF02 for the text 123456789 (so the frames below are real v1 frames)',
        crc24('123456789'), 0x21CF02);

    const ALL = {
        date: '2026-09-01',
        headerFilters: { remarks: 'a"b\\c', vvd: 'IAIT' },
        selectedAnalysts: ['Joe', 'Kysa'],
        selectedApStatuses: ['AP FROZEN'],
        selectedCoasts: ['EC'],
        selectedLanes: ['AL5', 'AN2'],
        selectedMktgAnalysts: ['Bob'],
        selectedSaleWeeks: ['2026/W30', '2026/W31'],
        selectedSubTrades: ['AW', 'LN'],
        selectedYards: ['CAHAL02'],
        tab: 'pol_booking',
        weeksAhead: 4,
        yardSearchText: 'CAHAL',
    };
    const ALL_JSON = '{"date":"2026-09-01","headerFilters":{"remarks":"a\\"b\\\\c","vvd":"IAIT"},"selectedAnalysts":["Joe","Kysa"],"selectedApStatuses":["AP FROZEN"],'
        + '"selectedCoasts":["EC"],"selectedLanes":["AL5","AN2"],"selectedMktgAnalysts":["Bob"],"selectedSaleWeeks":["2026/W30","2026/W31"],"selectedSubTrades":["AW","LN"],'
        + '"selectedYards":["CAHAL02"],"tab":"pol_booking","weeksAhead":4,"yardSearchText":"CAHAL"}';
    t('golden: the empty view is exactly v1.e30.uoPo (the payload is the JSON text {} and the check is its CRC-24)', E({}), 'v1.e30.uoPo');
    t('golden: the empty view text equals the oracle frame of {}', E({}), frame('{}'));
    t('golden: a one-lane view is exactly what the oracle writes for {"selectedLanes":["AL5"]}', E({ selectedLanes: ['AL5'] }), frame('{"selectedLanes":["AL5"]}'));
    t('golden: a view holding every whitelisted key is exactly what the oracle writes: keys sorted, arrays in the order given, quote and backslash escaped',
        E(ALL), frame(ALL_JSON));
    {
        const text = E(ALL);
        const json = Buffer.from(text.split('.')[1], 'base64url').toString('utf8');
        t('golden: the JSON inside that text is the expected literal, key by key in sorted order', json, ALL_JSON);
        t('golden: every key of the whitelist is in that view (the table above covers the whole contract)', Object.keys(ALL).sort(), WHITELIST);
        t('format: the text is v1.<payload>.<4-char check>, only letters, digits, - _ and the two dots, well under the limit',
            { shape: /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4}$/.test(text), shorter: text.length < 600 }, { shape: true, shorter: true });
    }

    // =============================================================================================
    // 2. Round trips: a realistic view from the real data, and every key on its own.
    // =============================================================================================
    const hist = history.loadHistory();
    const C = history.COL;
    const lastDay = hist.dates[hist.dates.length - 1];
    const firstDay = hist.dates[0];
    const distinct = (rows, fn) => Array.from(new Set(rows.map(fn).filter((v) => v !== ''))).sort();
    const rowsLast = hist.realRows(lastDay);
    const real = {
        lanes: distinct(rowsLast, (r) => r[C.lane]),
        weeks: distinct(rowsLast, (r) => r[C.saleWeek]),
        subTrades: distinct(rowsLast, (r) => r['Vessel 1st Sub Trade']),
        yards: distinct(rowsLast, (r) => r['Route Location 1st Yard']),
        spc: distinct(rowsLast, (r) => history.picParts(r).spc),
        mkg: distinct(rowsLast, (r) => history.picParts(r).mkg),
        coasts: distinct(rowsLast, (r) => r['MCT Spc Team']),
    };
    const remark = hist.rows.map((r) => r['Vessel Voyage Remark']).find((x) => /[^\x00-\x7f]/.test(x)).split('\n')[0].slice(0, 120);
    const REAL_VIEW = {
        selectedSubTrades: real.subTrades.slice(0, 2),
        selectedAnalysts: real.spc.slice(0, 3),
        selectedMktgAnalysts: real.mkg.slice(0, 2),
        selectedCoasts: real.coasts.slice(0, 1),
        selectedLanes: real.lanes.slice(0, 5),
        selectedSaleWeeks: real.weeks.slice(0, 4),
        selectedYards: real.yards.slice(0, 3),
        selectedApStatuses: ['AP FROZEN'],
        yardSearchText: real.yards[0].slice(0, 5),
        headerFilters: { vvd: rowsLast[0][C.vvd].slice(0, 4), remarks: remark },
        tab: 'pol_booking',
        date: lastDay,
    };
    t('real data: the CSV supplies what these views need (several lanes, 17 sale weeks, yards, analysts, coasts, and a remark with a non-ASCII character)',
        { lanes: real.lanes.length >= 5, weeks: real.weeks.length, yards: real.yards.length >= 3, spc: real.spc.length >= 3, mkg: real.mkg.length >= 2, coasts: real.coasts.length >= 1,
            nonAscii: /[^\x00-\x7f]/.test(remark) },
        { lanes: true, weeks: 17, yards: true, spc: true, mkg: true, coasts: true, nonAscii: true });
    {
        const text = E(REAL_VIEW);
        const back = D(text);
        t('round trip: a realistic view built from the real CSV (lanes, sale weeks, yards, analysts, coast, a remark filter with an en dash) comes back exactly',
            outcome(back), { errors: [], state: REAL_VIEW, dropped: [], problems: [] });
        t('round trip: that view\'s keys are all reported as applied', back.applied, Object.keys(REAL_VIEW).sort());
        t('round trip: that view fits a link with room to spare, and is plain ASCII', { length: text.length < 1200, ascii: /^[\x21-\x7e]+$/.test(text) }, { length: true, ascii: true });
        const sets = { selectedSubTrades: real.subTrades, selectedAnalysts: real.spc, selectedMktgAnalysts: real.mkg, selectedCoasts: real.coasts, selectedLanes: real.lanes,
            selectedSaleWeeks: real.weeks, selectedYards: real.yards, selectedApStatuses: ['AP FROZEN', 'AP ONLY'], tabs: TABS, date: hist.dates, headerFilters: ['vvd', 'remarks'] };
        t('round trip: the same view checked against valid sets taken from the same real data drops nothing', outcome(D(text, sets)), { errors: [], state: REAL_VIEW, dropped: [], problems: [] });
        t('round trip: decoding then re-encoding gives the identical text (the format is canonical)', E(back.state), text);
    }
    const SINGLE_KEY_VIEWS = [
        { date: '2024-02-29' }, { headerFilters: { vvd: 'IAIT', saleWeek: '2026/W30' } }, { selectedAnalysts: ['Joe', 'Kysa'] }, { selectedApStatuses: ['AP FROZEN', 'AP ONLY'] },
        { selectedCoasts: ['EC', 'WC'] }, { selectedLanes: ['AL5', 'AN2'] }, { selectedMktgAnalysts: ['Bob', 'Marissa'] }, { selectedSaleWeeks: ['2026/W30', '2026/W31'] },
        { selectedSubTrades: ['AW', 'LN'] }, { selectedYards: ['CAHAL02', 'USHOU01'] }, { tab: 'compare' }, { weeksAhead: 18 }, { yardSearchText: 'CAHAL' },
    ];
    for (const view of SINGLE_KEY_VIEWS) {
        const key = Object.keys(view)[0];
        t(`round trip: ${key} on its own`, outcome(D(E(view))), { errors: [], state: view, dropped: [], problems: [] });
    }
    for (const tab of TABS) {
        t(`tab: ${tab} round trips, applied as the only key`, (() => { const r = D(E({ tab })); return { state: r.state, applied: r.applied, dropped: r.dropped }; })(),
            { state: { tab }, applied: ['tab'], dropped: [] });
    }
    const UNICODE = {
        selectedLanes: ['Zürich', 'São Paulo', 'Ålesund'],
        selectedYards: ['横浜港 (Yokohama)', '釜山', '\u{1F6A2} ship', 'é combining'],
        yardSearchText: 'Zürich 港 \u{1F6A2}',
        headerFilters: { remarks: '船 – éè \u{1F680}\u{1F30A}', vvd: '\u{1F6A2}' },
    };
    {
        const text = E(UNICODE);
        t('round trip: non-ASCII text (accents, CJK, emoji, a combining mark, an en dash) in a list, the search box and a header filter comes back exactly',
            outcome(D(text)), { errors: [], state: UNICODE, dropped: [], problems: [] });
        t('round trip: and the text that carries it is still plain ASCII, URL-safe characters only', /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4}$/.test(text), true);
        t('round trip: non-ASCII text is UTF-8 on the wire (the payload decodes with Node\'s UTF-8 reader to the same JSON text)',
            Buffer.from(text.split('.')[1], 'base64url').toString('utf8').includes('"yardSearchText":"Zürich 港 \u{1F6A2}"'), true);
    }
    // The code points on either side of every UTF-8 length boundary, each as the oracle (Node's own UTF-8) writes it.
    const BOUNDARY = ['\u007f', '\u0080', '\u07ff', '\u0800', '\ud7ff', '\ue000', '\uffff', '\u{10000}', '\u{10ffff}'];
    t('round trip: the code points on each side of every UTF-8 length boundary (U+007F/80, U+07FF/800, U+D7FF, U+E000, U+FFFF, U+10000, U+10FFFF) survive, and Node reads the wire bytes as the same text',
        (() => {
            const text = E({ selectedYards: BOUNDARY });
            const json = Buffer.from(text.split('.')[1], 'base64url').toString('utf8');
            return { back: D(text).state.selectedYards, wire: JSON.parse(json).selectedYards, bytes: Buffer.from(text.split('.')[1], 'base64url').length };
        })(), { back: BOUNDARY, wire: BOUNDARY, bytes: Buffer.byteLength(`{"selectedYards":[${BOUNDARY.map((c) => `"${c}"`).join(',')}]}`) });
    const NASTY = ['quote " and backslash \\ and slash /', 'tab\tnewline\ncr\r bell\u0007 nul\u0000 del\u007f', '  line sep   para sep', '\ud800 lone high', 'lone low \udc00', '\ud83d', 'trail \ud83d'];
    t('round trip: quotes, backslashes, control characters, U+2028/9 and LONE surrogates (which UTF-8 cannot hold) all survive exactly, in any position',
        outcome(D(E({ selectedYards: NASTY, yardSearchText: NASTY[3], headerFilters: { remarks: NASTY[1] } }))),
        { errors: [], state: { selectedYards: NASTY, yardSearchText: NASTY[3], headerFilters: { remarks: NASTY[1] } }, dropped: [], problems: [] });

    // =============================================================================================
    // 3. Determinism, order, and what the encoder leaves out or refuses.
    // =============================================================================================
    const SHUFFLED = {
        yardSearchText: 'CAHAL', weeksAhead: 4, tab: 'pol_booking', selectedYards: ['CAHAL02'], selectedSubTrades: ['AW', 'LN'], selectedSaleWeeks: ['2026/W30', '2026/W31'],
        selectedMktgAnalysts: ['Bob'], selectedLanes: ['AL5', 'AN2'], selectedCoasts: ['EC'], selectedApStatuses: ['AP FROZEN'], selectedAnalysts: ['Joe', 'Kysa'],
        headerFilters: { vvd: 'IAIT', remarks: 'a"b\\c' }, date: '2026-09-01',
    };
    t('determinism: the same view written with its keys (and header-filter keys) in a different order gives the identical text', E(SHUFFLED), E(ALL));
    t('determinism: encoding the same state twice gives the identical text', E(ALL) === E(ALL), true);
    t('order: array order is kept as given (not sorted), so ["B","A"] and ["A","B"] are different links that decode to what was written',
        { ba: D(E({ selectedLanes: ['B', 'A'] })).state.selectedLanes, ab: D(E({ selectedLanes: ['A', 'B'] })).state.selectedLanes, different: E({ selectedLanes: ['B', 'A'] }) !== E({ selectedLanes: ['A', 'B'] }) },
        { ba: ['B', 'A'], ab: ['A', 'B'], different: true });
    t('leaves out: empty arrays, empty text and an empty header-filter map are not written (absent means the default)',
        E({ selectedLanes: [], selectedYards: [], yardSearchText: '', headerFilters: {} }), E({}));
    t('leaves out: a header filter whose text is empty is a no-op in the app, so it is not written and does not count toward the key limit',
        E({ headerFilters: { vvd: '', saleWeek: '2026/W30' } }), E({ headerFilters: { saleWeek: '2026/W30' } }));
    t('leaves out: keys that are not in the whitelist (the app may pass its whole filter snapshot) are ignored by the encoder, silently',
        E({ topPanelCollapsed: true, somethingElse: [1, 2], selectedLanes: ['AL5'] }), E({ selectedLanes: ['AL5'] }));
    t('leaves out: null and undefined values are absent for the encoder (the app holds null for "no archive date")',
        E({ date: null, weeksAhead: undefined, tab: null, selectedLanes: null, headerFilters: undefined, yardSearchText: null, selectedLanes2: 1 }), E({}));
    t('encoder does not change what it is given, and accepts frozen input',
        (() => {
            const frozen = Object.freeze({ selectedLanes: Object.freeze(['AL5']), headerFilters: Object.freeze({ vvd: 'A' }), tab: 'detail' });
            return E(frozen) === E({ selectedLanes: ['AL5'], headerFilters: { vvd: 'A' }, tab: 'detail' });
        })(), true);
    t('decoder does not change the valid sets it is given, and accepts frozen ones',
        D(frame('{"selectedLanes":["AL5","ZZZ"]}'), Object.freeze({ selectedLanes: Object.freeze(['AL5']) })).state, { selectedLanes: ['AL5'] });
    t('both keys survive: a view with selectedSaleWeeks AND weeksAhead returns both (the codec does not choose; the app decides)',
        D(E({ selectedSaleWeeks: ['2026/W30'], weeksAhead: 4 })).state, { selectedSaleWeeks: ['2026/W30'], weeksAhead: 4 });

    // The encoder refuses (null) a view it cannot write faithfully, and never throws.
    const proto = JSON.parse('{"__proto__":{"polluted":1},"selectedLanes":["A"]}');
    const throwing = { get selectedLanes() { throw new Error('boom'); } };
    const REFUSED = [
        ['undefined', undefined], ['null', null], ['a number', 5], ['a string', 'selectedLanes'], ['an array', [{ selectedLanes: ['A'] }]], ['a function', () => 1], ['a Date', new Date(0)], ['a Map', new Map()],
        ['a list given as a string', { selectedLanes: 'AL5' }], ['a list holding a number', { selectedLanes: ['A', 5] }], ['a list holding a nested array', { selectedLanes: [['A']] }],
        ['a list holding null', { selectedLanes: [null] }], ['a list given as an object', { selectedLanes: { 0: 'A' } }], ['search text given as a number', { yardSearchText: 5 }],
        ['headerFilters given as an array', { headerFilters: [] }], ['a header filter holding a number', { headerFilters: { vvd: 5 } }], ['a header filter key with a space', { headerFilters: { 'bad key': 'x' } }],
        ['a header filter named constructor', { headerFilters: { constructor: 'x' } }], ['a header filter named prototype', { headerFilters: { prototype: 'x' } }],
        ['a header filter named __proto__ (an own property, as JSON.parse makes it)', { headerFilters: JSON.parse('{"__proto__":"x"}') }], ['an own __proto__ key on the view itself', proto],
        ['an unknown tab', { tab: 'nope' }], ['a tab in the wrong case', { tab: 'Detail' }], ['a tab given as a number', { tab: 1 }],
        ['an impossible date', { date: '2026-02-30' }], ['a date without zero padding', { date: '2026-1-5' }], ['a date given as a number', { date: 20260105 }],
        ['weeksAhead 0', { weeksAhead: 0 }], ['weeksAhead 53', { weeksAhead: 53 }], ['weeksAhead 1.5', { weeksAhead: 1.5 }], ['weeksAhead NaN', { weeksAhead: NaN }],
        ['weeksAhead Infinity', { weeksAhead: Infinity }], ['weeksAhead as text', { weeksAhead: '4' }], ['a getter that throws', throwing],
        ['a Proxy whose key listing throws', new Proxy({}, { ownKeys() { throw new Error('boom'); } })],
    ];
    for (const [label, input] of REFUSED) {
        t(`encoder refuses (returns null, never throws): ${label}`, (() => { try { return E(input); } catch (e) { return `THREW ${e.message}`; } })(), null);
    }
    t('encodeViewReason: every refused view above says "invalid-state" and never throws (a view that is refused is wrong, not long)',
        REFUSED.map(([label, input]) => { try { return R(input); } catch (e) { return `THREW ${label}: ${e.message}`; } }), REFUSED.map(() => 'invalid-state'));
    t('encodeViewReason: null for every view encodeView writes (the empty view, a real-looking one, a view with the sentinel), so reason and link are never both set or both empty',
        [{}, ALL, { selectedLanes: ['AL5'], tab: 'detail' }, { selectedYards: ['__NO_MATCH__'] }].map((v) => [R(v), typeof E(v)]), [[null, 'string'], [null, 'string'], [null, 'string'], [null, 'string']]);
    t('header filters named like anything Object.prototype already has (toString, hasOwnProperty, valueOf, isPrototypeOf, __lookupGetter__, constructor...) are refused: decoded as forbidden-key with nothing applied, refused by the encoder',
        ['toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__lookupGetter__', 'constructor'].map((name) => {
            const r = D(frame(JSON.stringify({ headerFilters: { vvd: 'A', [name]: 'x' } })));
            return [name, r.applied.length, lines(r).join(), E({ headerFilters: { [name]: 'x' } }), R({ headerFilters: { vvd: 'A', [name]: 'x' } })];
        }),
        ['toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__lookupGetter__', 'constructor'].map((name) => [name, 0, `headerFilters|${name}|forbidden-key`, null, 'invalid-state']));
    t('header filter names that merely contain or resemble those names (toStringX, myConstructor, valueof, Constructor) are ordinary column keys and round trip',
        (() => { const hf = { toStringX: 'a', myConstructor: 'b', valueof: 'c', Constructor: 'd' }; return outcome(D(E({ headerFilters: hf }), { headerFilters: Object.keys(hf) })).state; })(),
        { headerFilters: { toStringX: 'a', myConstructor: 'b', valueof: 'c', Constructor: 'd' } });
    t('the transient __NO_MATCH__ yard sentinel is never written as a yard: it is skipped (alone, the yards are left out; beside real yards only they remain), and the yard search text that produced it still travels',
        {
            alone: E({ selectedYards: ['__NO_MATCH__'] }) === E({}),
            beside: E({ selectedYards: ['CAHAL02', '__NO_MATCH__', 'USLAX01'] }) === E({ selectedYards: ['CAHAL02', 'USLAX01'] }),
            withSearch: D(E({ selectedYards: ['__NO_MATCH__'], yardSearchText: 'zzz' })).state,
            otherKeys: D(E({ selectedLanes: ['__NO_MATCH__'] })).state,
            asText: E({ selectedYards: '__NO_MATCH__' }),
        },
        { alone: true, beside: true, withSearch: { yardSearchText: 'zzz' }, otherKeys: { selectedLanes: ['__NO_MATCH__'] }, asText: null });
    t('one date validator: the codec accepts exactly the days the shared calendar check (previousAvailableDate) accepts, inside 2000 to 2099, over every month 0-13 and day 0-32 of leap, century and boundary years',
        (() => {
            const bad = [];
            for (const y of ['0000', '1900', '1999', '2000', '2024', '2026', '2099', '2100', '9999']) {
                for (let m = 0; m <= 13; m++) {
                    for (let d = 0; d <= 32; d++) {
                        const text = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const calendar = BFShared.previousAvailableDate([text], '9999-12-31') !== null || text === '9999-12-31';
                        const want = calendar && Number(y) >= 2000 && Number(y) <= 2099;
                        if (D(frame(JSON.stringify({ date: text }))).applied.length === 1 !== want) bad.push(text);
                    }
                }
            }
            return bad;
        })(), []);

    // =============================================================================================
    // 4. Limits, each at the limit and one over, on both sides.
    // =============================================================================================
    const items = (n) => Array.from({ length: n }, (_, i) => `L${i}`);
    const decOf = (json, sets) => { const r = D(frame(json), sets); return { errors: r.errors, applied: r.applied, lines: lines(r), problems: problemsWith(r) }; };
    // sets: the decoder's validSets, for views whose header-filter keys are not real columns (without validSets.headerFilters the decoder
    // keeps only the app's real column keys, so a limit test with made-up keys names them here).
    const atLimit = (view, key, json, sets) => ({ encoded: typeof E(view), round: outcome(D(E(view), sets)).state[key] !== undefined, decoded: decOf(json, sets).applied });
    const overLimit = (view, json) => ({ encoded: E(view), decoded: decOf(json) });
    const L200 = items(200);
    t('limit: an array of 200 items is written and read', atLimit({ selectedLanes: L200 }, 'selectedLanes', JSON.stringify({ selectedLanes: L200 })),
        { encoded: 'string', round: true, decoded: ['selectedLanes'] });
    t('limit: an array of 201 items is refused by the encoder and rejected whole by the decoder (too-many-items, nothing applied)',
        overLimit({ selectedLanes: items(201) }, JSON.stringify({ selectedLanes: items(201), selectedYards: ['CAHAL02'] })),
        { encoded: null, decoded: { errors: [], applied: ['selectedYards'], lines: ['selectedLanes|201|too-many-items'], problems: [] } });
    const S200 = 'y'.repeat(200);
    t('limit: search text of 200 characters is written and read', atLimit({ yardSearchText: S200 }, 'yardSearchText', JSON.stringify({ yardSearchText: S200 })),
        { encoded: 'string', round: true, decoded: ['yardSearchText'] });
    t('limit: search text of 201 characters is refused by the encoder and rejected by the decoder (too-long)',
        overLimit({ yardSearchText: S200 + 'y' }, JSON.stringify({ yardSearchText: S200 + 'y' })),
        { encoded: null, decoded: { errors: [], applied: [], lines: [`yardSearchText|${S200}|too-long`], problems: [] } });
    t('limit: a list item of 200 characters is written and read', atLimit({ selectedYards: [S200] }, 'selectedYards', JSON.stringify({ selectedYards: [S200] })),
        { encoded: 'string', round: true, decoded: ['selectedYards'] });
    t('limit: a list item of 201 characters rejects the whole list (too-long; the reported value is cut to 200)',
        overLimit({ selectedYards: ['ok', S200 + 'y'] }, JSON.stringify({ selectedYards: ['ok', S200 + 'y'] })),
        { encoded: null, decoded: { errors: [], applied: [], lines: [`selectedYards|${S200}|too-long`], problems: [] } });
    t('limit: a header-filter text of 200 characters is written and read', atLimit({ headerFilters: { remarks: S200 } }, 'headerFilters', JSON.stringify({ headerFilters: { remarks: S200 } })),
        { encoded: 'string', round: true, decoded: ['headerFilters'] });
    t('limit: a header-filter text of 201 characters rejects the whole map (too-long, naming the column)',
        overLimit({ headerFilters: { remarks: S200 + 'y' } }, JSON.stringify({ headerFilters: { remarks: S200 + 'y' } })),
        { encoded: null, decoded: { errors: [], applied: [], lines: ['headerFilters|remarks|too-long'], problems: [] } });
    const K64 = 'k'.repeat(64);
    t('limit: a header-filter column key of 64 characters is written and read', atLimit({ headerFilters: { [K64]: 'x' } }, 'headerFilters', JSON.stringify({ headerFilters: { [K64]: 'x' } }), { headerFilters: [K64] }),
        { encoded: 'string', round: true, decoded: ['headerFilters'] });
    t('limit: a column key of 65 characters rejects the whole map (invalid-key, naming the key)',
        overLimit({ headerFilters: { [K64 + 'k']: 'x' } }, JSON.stringify({ headerFilters: { [K64 + 'k']: 'x' } })),
        { encoded: null, decoded: { errors: [], applied: [], lines: [`headerFilters|${K64 + 'k'}|invalid-key`], problems: [] } });
    const keys = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, `v${i}`]));
    t('limit: a header-filter map of 40 keys is written and read', atLimit({ headerFilters: keys(40) }, 'headerFilters', JSON.stringify({ headerFilters: keys(40) }), { headerFilters: Object.keys(keys(40)) }),
        { encoded: 'string', round: true, decoded: ['headerFilters'] });
    t('limit: a header-filter map of 41 keys is refused by the encoder and rejected whole by the decoder (too-many-keys)',
        overLimit({ headerFilters: keys(41) }, JSON.stringify({ headerFilters: keys(41) })),
        { encoded: null, decoded: { errors: [], applied: [], lines: ['headerFilters|41|too-many-keys'], problems: [] } });
    t('limit: 41 header filters of which one is empty is 40 real filters: the encoder writes it, the decoder (which counts every key it is given) rejects the 41-key text',
        { encoded: typeof E({ headerFilters: { ...keys(40), e: '' } }), decoded: decOf(JSON.stringify({ headerFilters: { ...keys(40), e: '' } })).lines },
        { encoded: 'string', decoded: ['headerFilters|41|too-many-keys'] });
    t('limit: the 200-character limit counts UTF-16 code units: 100 emoji (200 units) pass, 101 (202) do not',
        { at: typeof E({ yardSearchText: '\u{1F6A2}'.repeat(100) }), over: E({ yardSearchText: '\u{1F6A2}'.repeat(101) }), decodedAt: decOf(JSON.stringify({ yardSearchText: '\u{1F6A2}'.repeat(100) })).applied,
            decodedOver: decOf(JSON.stringify({ yardSearchText: '\u{1F6A2}'.repeat(101) })).lines.map((l) => l.split('|')[2]) },
        { at: 'string', over: null, decodedAt: ['yardSearchText'], decodedOver: ['too-long'] });

    // The 4000-character limit on the whole text. A view whose JSON is n bytes encodes to 8 + the base64 length of n bytes, so
    // n = 2994 is exactly 4000 characters and the smallest view that does not fit is n = 2995 (4002; 4001 is not a possible length).
    const viewOfJsonBytes = (n) => {
        let remaining = n - '{"selectedSubTrades":[]}'.length;
        const list = [];
        while (remaining > 0) {
            const comma = list.length ? 1 : 0;
            let len = Math.min(200, remaining - comma - 2);
            const left = remaining - (len + 2 + comma);
            if (left > 0 && left < 3) len -= 3 - left;
            list.push('x'.repeat(len));
            remaining -= len + 2 + comma;
        }
        return { selectedSubTrades: list };
    };
    const V4000 = viewOfJsonBytes(2994);
    const V4002 = viewOfJsonBytes(2995);
    t('limit: the test views really are 2994 and 2995 JSON bytes (guards the arithmetic of the next assertions)',
        [Buffer.byteLength(JSON.stringify(V4000)), Buffer.byteLength(JSON.stringify(V4002))], [2994, 2995]);
    t('limit: a view that encodes to exactly 4000 characters is written, and read back',
        (() => { const text = E(V4000); return { length: text.length, same: outcome(D(text)).state.selectedSubTrades.join() === V4000.selectedSubTrades.join(), errors: D(text).errors }; })(),
        { length: 4000, same: true, errors: [] });
    t('limit: the smallest view that would encode to more than 4000 characters is refused (null)', E(V4002), null);
    t('encodeViewReason: a valid view that is only too long says "too-long" (4002 characters), the 4000-character view says null, and a view that is both too long and invalid says "invalid-state"',
        [R(V4002), R(V4000), R(Object.assign({}, V4002, { tab: 'nope' }))], ['too-long', null, 'invalid-state']);
    t('limit: a text of 4000 characters is read; a text of 4001 is refused before anything else (too-long), as is the 4002-character frame of the next view up',
        { at: D(E(V4000)).errors, plusOne: D(E(V4000) + 'A').errors, frame: D(frame(JSON.stringify(V4002))).errors },
        { at: [], plusOne: ['too-long'], frame: ['too-long'] });

    // =============================================================================================
    // 5. Stale values, partial application, unknown keys.
    // =============================================================================================
    // A link written on the first Record Date of the 9-day file selects the first four sale weeks of that day's window. The window rolls on Monday
    // 2026-08-31 (W29 leaves, W46 enters); opened against the last day's data, W29 is stale and the other three still apply.
    const weeksFirstDay = distinct(hist.realRows(firstDay), (r) => r[C.saleWeek]);
    const weeksLastDay = real.weeks;
    const rolledOut = weeksFirstDay.filter((w) => !weeksLastDay.includes(w));
    const linkFromFirstDay = E({ selectedSaleWeeks: weeksFirstDay.slice(0, 4), selectedLanes: real.lanes.slice(0, 2), tab: 'detail' });
    t('stale (real data): the sale-week window rolled between the first and last day of the file, so there is something to drop',
        { rolledOut, first: weeksFirstDay[0], last: weeksLastDay[weeksLastDay.length - 1] }, { rolledOut: ['2026/W29'], first: '2026/W29', last: '2026/W46' });
    t('stale (real data): a link made on the first day, opened on the last day, drops the sale week that rolled out, REPORTS it, and still applies the rest',
        outcome(D(linkFromFirstDay, { selectedSaleWeeks: weeksLastDay, selectedLanes: real.lanes, tabs: TABS })),
        { errors: [], state: { selectedSaleWeeks: weeksFirstDay.slice(1, 4), selectedLanes: real.lanes.slice(0, 2), tab: 'detail' },
            dropped: [{ key: 'selectedSaleWeeks', value: '2026/W29', reason: 'not-in-current-data' }], problems: [] });
    t('stale (real data): the same link checked against the first day\'s own window drops nothing',
        outcome(D(linkFromFirstDay, { selectedSaleWeeks: weeksFirstDay })).dropped, []);
    t('stale: every value stale means the key is left out of state and of applied (nothing to apply), with one report per value, in order',
        (() => { const r = D(frame('{"selectedLanes":["XX1","XX2"],"selectedYards":["CAHAL02"]}'), { selectedLanes: ['AL5'] }); return { state: r.state, applied: r.applied, lines: lines(r) }; })(),
        { state: { selectedYards: ['CAHAL02'] }, applied: ['selectedYards'], lines: ['selectedLanes|XX1|not-in-current-data', 'selectedLanes|XX2|not-in-current-data'] });
    t('stale: without valid sets nothing is value-checked: the same stale lanes are kept',
        outcome(D(frame('{"selectedLanes":["XX1","XX2"]}'))), { errors: [], state: { selectedLanes: ['XX1', 'XX2'] }, dropped: [], problems: [] });
    t('stale: a set for another key does not check this one',
        outcome(D(frame('{"selectedLanes":["XX1"]}'), { selectedYards: ['CAHAL02'] })).state, { selectedLanes: ['XX1'] });
    t('stale: matching is exact (case and spacing count), so al5 and "AL5 " are stale where AL5 is allowed',
        lines(D(frame('{"selectedLanes":["al5","AL5 ","AL5"]}'), { selectedLanes: ['AL5'] })), ['selectedLanes|al5|not-in-current-data', 'selectedLanes|AL5 |not-in-current-data']);
    t('stale: an allowed set that is an empty array checks nothing (no data known is not "every value is stale"): the lane is kept, nothing is dropped; a set of one lane still drops the others',
        (() => {
            const r = D(frame('{"selectedLanes":["AL5"],"selectedYards":["CAHAL02"]}'), { selectedLanes: [], selectedYards: ['OTHER'] });
            return { state: r.state, lines: lines(r) };
        })(), { state: { selectedLanes: ['AL5'] }, lines: ['selectedYards|CAHAL02|not-in-current-data'] });
    t('stale: an entry in the valid sets that is absent, null, or not an array means "no set", not "nothing allowed"',
        [undefined, null, 'AL5', 5, true, {}, { selectedLanes: null }, { selectedLanes: 'AL5' }, { selectedLanes: { 0: 'AL5' } }, { selectedLanes: [] }, [], ['AL5']]
            .map((sets) => D(frame('{"selectedLanes":["XX1"]}'), sets).applied.join()),
        Array.from({ length: 12 }, () => 'selectedLanes'));
    t('stale: set membership is not fooled by names on the prototype chain: toString and hasOwnProperty are stale where only constructor and __proto__ are allowed, and those two (ordinary text here) are kept',
        (() => { const r = D(frame('{"selectedLanes":["toString","__proto__","constructor","hasOwnProperty"]}'), { selectedLanes: ['constructor', '__proto__'] }); return { state: r.state, lines: lines(r) }; })(),
        { state: { selectedLanes: ['__proto__', 'constructor'] }, lines: ['selectedLanes|toString|not-in-current-data', 'selectedLanes|hasOwnProperty|not-in-current-data'] });
    t('stale: tabs, date and header-filter columns are checked against their sets too; a stale tab or archive day is dropped and reported, a retired column is dropped from the map',
        (() => {
            const r = D(frame('{"date":"2026-09-01","headerFilters":{"vvd":"A","vslOwner":"B"},"tab":"compare","selectedLanes":["AL5"]}'),
                { tabs: ['detail', 'pol_booking'], date: ['2026-08-31'], headerFilters: ['vvd', 'remarks'] });
            return { state: r.state, lines: lines(r) };
        })(),
        { state: { headerFilters: { vvd: 'A' }, selectedLanes: ['AL5'] }, lines: ['date|2026-09-01|not-in-current-data', 'headerFilters|vslOwner|not-in-current-data', 'tab|compare|not-in-current-data'] });
    t('stale: a header-filter map whose columns are all retired is left out entirely',
        (() => { const r = D(frame('{"headerFilters":{"vslOwner":"B"}}'), { headerFilters: ['vvd'] }); return { state: r.state, lines: lines(r) }; })(), { state: {}, lines: ['headerFilters|vslOwner|not-in-current-data'] });
    // Review findings (2026-10-06): the built-in column whitelist for header filters, and whitespace-only filter text.
    t('unknown columns: with no validSets.headerFilters the decoder keeps only the app\'s real column keys: "bogusColumn" and "vslOwner" are dropped one by one and reported (unknown-key), "vvd" and "saleWeek" stay, and a map with only unknown columns is left out entirely',
        (() => {
            const mixed = D(frame('{"headerFilters":{"bogusColumn":"x","vvd":"A","saleWeek":"W30","vslOwner":"B"},"tab":"detail"}'));
            const only = D(frame('{"headerFilters":{"bogusColumn":"x"}}'));
            return { mixed: { state: mixed.state, lines: lines(mixed), problems: problemsWith(mixed) }, only: { state: only.state, applied: only.applied, lines: lines(only) } };
        })(),
        { mixed: { state: { headerFilters: { saleWeek: 'W30', vvd: 'A' }, tab: 'detail' }, lines: ['headerFilters|bogusColumn|unknown-key', 'headerFilters|vslOwner|unknown-key'], problems: [] },
          only: { state: {}, applied: [], lines: ['headerFilters|bogusColumn|unknown-key'] } });
    t('unknown columns: the real column keys of both tabs are known without validSets (Detail: shortfall, curUtil, rfrBkgTtl, sgsinDryVsRfr; POL: loadingStatus, rfrUtilizPolRaw, polBkgUtilzRaw, coastalEtd)',
        (() => { const hf = {}; ['shortfall', 'curUtil', 'rfrBkgTtl', 'sgsinDryVsRfr', 'loadingStatus', 'rfrUtilizPolRaw', 'polBkgUtilzRaw', 'coastalEtd'].forEach((k) => { hf[k] = 'x'; }); const r = D(frame(JSON.stringify({ headerFilters: hf }))); return { same: canon(r.state.headerFilters) === canon(hf), lines: lines(r) }; })(),
        { same: true, lines: [] });
    t('unknown columns: a non-empty validSets.headerFilters replaces the built-in list (a column it names is kept, one it does not is stale: not-in-current-data), and an empty list means "nothing known" so the built-in list applies',
        (() => {
            const text = frame('{"headerFilters":{"vvd":"A","vslOwner":"B"}}');
            const own = D(text, { headerFilters: ['vslOwner'] });
            const empty = D(text, { headerFilters: [] });
            return { own: { state: own.state, lines: lines(own) }, empty: { state: empty.state, lines: lines(empty) } };
        })(),
        { own: { state: { headerFilters: { vslOwner: 'B' } }, lines: ['headerFilters|vvd|not-in-current-data'] }, empty: { state: { headerFilters: { vvd: 'A' } }, lines: ['headerFilters|vslOwner|unknown-key'] } });
    t('unknown columns: the encoder stays permissive about column names (a well-formed one is written), so what the decoder then drops is reported, never silent',
        (() => { const text = E({ headerFilters: { bogusColumn: 'x', vvd: 'A' } }); const r = D(text); return { written: typeof text, state: r.state, lines: lines(r) }; })(),
        { written: 'string', state: { headerFilters: { vvd: 'A' } }, lines: ['headerFilters|bogusColumn|unknown-key'] });
    t('whitespace-only filter text is no filter (the app tests filterValue.trim() !== ""): the encoder writes the same text as without it, for spaces, tabs, newlines and a no-break space, and it does not count toward the 40-key limit',
        {
            spaces: E({ headerFilters: { vvd: '   ' } }) === E({}),
            mixed: E({ headerFilters: { vvd: ' \t\n\u00a0', saleWeek: '2026/W30' } }) === E({ headerFilters: { saleWeek: '2026/W30' } }),
            kept: D(E({ headerFilters: { vvd: ' A ' } })).state,
            limit: typeof E({ headerFilters: { ...keys(40), vvd: '   ' } }),
        },
        { spaces: true, mixed: true, kept: { headerFilters: { vvd: ' A ' } }, limit: 'string' });
    t('whitespace-only filter text on the way in: the decoder leaves it out of the result like empty text (nothing reported); a map holding only such values is left out entirely; non-blank text keeps its spaces',
        (() => {
            const a = D(frame('{"headerFilters":{"vvd":"   ","saleWeek":"W30","lane":" \\t"}}'));
            const b = D(frame('{"headerFilters":{"vvd":"  "}}'));
            return { a: { state: a.state, lines: lines(a) }, b: { state: b.state, applied: b.applied, lines: lines(b) } };
        })(),
        { a: { state: { headerFilters: { saleWeek: 'W30' } }, lines: [] }, b: { state: {}, applied: [], lines: [] } });
    t('partial application: a good lane list, a stale sale week, a wrong-typed yard list, an over-long search text, a bad tab and an unknown key: the good and the stale-trimmed parts apply, each problem is reported once',
        outcome(D(frame('{"selectedLanes":["AL5"],"selectedSaleWeeks":["2026/W29","2026/W31"],"selectedYards":5,"yardSearchText":"' + S200 + 'y","tab":"nope","mystery":true,"weeksAhead":4}'),
            { selectedSaleWeeks: ['2026/W31'] })),
        { errors: [], state: { selectedLanes: ['AL5'], selectedSaleWeeks: ['2026/W31'], weeksAhead: 4 },
            dropped: [{ key: 'mystery', value: 'true', reason: 'unknown-key' }, { key: 'selectedSaleWeeks', value: '2026/W29', reason: 'not-in-current-data' },
                { key: 'selectedYards', value: '5', reason: 'wrong-type' }, { key: 'tab', value: 'nope', reason: 'invalid-value' }, { key: 'yardSearchText', value: S200, reason: 'too-long' }], problems: [] });
    const UNKNOWN = '{"zzz":1,"selectedLanes":["AL5"],"aaa":[1,2],"topPanelCollapsed":true,"Lanes":["x"],"selectedlanes":["y"],"nested":{"a":{"b":1}},"nothing":null}';
    t('unknown keys: ignored and reported (sorted by key, with a short description of the value), never in state; keys are case-sensitive',
        (() => { const r = D(frame(UNKNOWN)); return { state: r.state, applied: r.applied, lines: lines(r), problems: problemsWith(r) }; })(),
        { state: { selectedLanes: ['AL5'] }, applied: ['selectedLanes'], problems: [], lines: ['Lanes|array(1)|unknown-key', 'aaa|array(2)|unknown-key', 'nested|object|unknown-key', 'nothing|null|unknown-key',
            'selectedlanes|array(1)|unknown-key', 'topPanelCollapsed|true|unknown-key', 'zzz|1|unknown-key'] });
    t('unknown keys: the sender\'s key order does not change the result or the order of the report',
        JSON.stringify(D(frame(UNKNOWN))) === JSON.stringify(D(frame(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(UNKNOWN)).reverse()))))), true);
    t('unknown keys: a 1,000-character key name and a 1,000-character value are reported cut to 64 and 200 characters',
        (() => { const r = D(frame(JSON.stringify({ ['K'.repeat(1000)]: 'V'.repeat(1000) }))); return { key: r.dropped[0].key.length, value: r.dropped[0].value.length, reason: r.dropped[0].reason, problems: problemsWith(r) }; })(),
        { key: 64, value: 200, reason: 'unknown-key', problems: [] });
    t('unknown keys: a reported value is cut to 200 UTF-16 units without leaving half an emoji at the end (199 letters + an emoji reports 199 characters)',
        (() => { const r = D(frame(JSON.stringify({ zzz: 'a'.repeat(199) + '\u{1F6A2}' }))); return { value: r.dropped[0].value, problems: problemsWith(r) }; })(), { value: 'a'.repeat(199), problems: [] });
    t('unknown keys: 200 unknown keys in one text are all reported, all bounded, and none reaches state',
        (() => {
            const o = {};
            for (let i = 0; i < 200; i++) o[`u${i}`] = i;
            const text = frame(JSON.stringify(o));
            const r = D(text);
            return { length: text.length <= 4000, dropped: r.dropped.length, state: Object.keys(r.state), problems: problemsWith(r) };
        })(), { length: true, dropped: 200, state: [], problems: [] });

    // =============================================================================================
    // 6. Wrong types: rejected with a reason, the rest of the view still applies.
    // =============================================================================================
    const WRONG = [
        ['a list given as a number', '{"selectedLanes":5}', ['selectedLanes|5|wrong-type']],
        ['a list given as null', '{"selectedLanes":null}', ['selectedLanes|null|wrong-type']],
        ['a list given as text', '{"selectedLanes":"AL5"}', ['selectedLanes|AL5|wrong-type']],
        ['a list given as an object', '{"selectedLanes":{"0":"AL5"}}', ['selectedLanes|object|wrong-type']],
        ['a list given as true', '{"selectedLanes":true}', ['selectedLanes|true|wrong-type']],
        ['a list holding numbers', '{"selectedLanes":[1,2]}', ['selectedLanes|1|wrong-type']],
        ['a list holding a nested array', '{"selectedLanes":[["AL5"]]}', ['selectedLanes|array(1)|wrong-type']],
        ['a list holding null', '{"selectedLanes":[null]}', ['selectedLanes|null|wrong-type']],
        ['a list holding an object', '{"selectedLanes":[{"a":1}]}', ['selectedLanes|object|wrong-type']],
        ['a list holding one good and one bad item is rejected whole', '{"selectedLanes":["AL5",5]}', ['selectedLanes|5|wrong-type']],
        ['search text given as a number', '{"yardSearchText":5}', ['yardSearchText|5|wrong-type']],
        ['search text given as a list', '{"yardSearchText":["a"]}', ['yardSearchText|array(1)|wrong-type']],
        ['search text given as null', '{"yardSearchText":null}', ['yardSearchText|null|wrong-type']],
        ['header filters given as a list', '{"headerFilters":[]}', ['headerFilters|array(0)|wrong-type']],
        ['header filters given as text', '{"headerFilters":"vvd=A"}', ['headerFilters|vvd=A|wrong-type']],
        ['header filters given as null', '{"headerFilters":null}', ['headerFilters|null|wrong-type']],
        ['a header filter holding a number', '{"headerFilters":{"vvd":5}}', ['headerFilters|vvd|wrong-type']],
        ['a header filter holding null', '{"headerFilters":{"vvd":null}}', ['headerFilters|vvd|wrong-type']],
        ['a header filter holding a list', '{"headerFilters":{"vvd":["A"]}}', ['headerFilters|vvd|wrong-type']],
        ['a header filter holding an object', '{"headerFilters":{"vvd":{"a":"b"}}}', ['headerFilters|vvd|wrong-type']],
        ['a header-filter key with a space', '{"headerFilters":{"bad key":"x"}}', ['headerFilters|bad key|invalid-key']],
        ['a header-filter key that starts with a digit', '{"headerFilters":{"1abc":"x"}}', ['headerFilters|1abc|invalid-key']],
        ['a header-filter key that starts with an underscore', '{"headerFilters":{"_vvd":"x"}}', ['headerFilters|_vvd|invalid-key']],
        ['an empty header-filter key', '{"headerFilters":{"":"x"}}', ['headerFilters||invalid-key']],
        ['a header-filter key with a dot', '{"headerFilters":{"vvd.x":"y"}}', ['headerFilters|vvd.x|invalid-key']],
        ['a header-filter key with a dash', '{"headerFilters":{"a-b":"y"}}', ['headerFilters|a-b|invalid-key']],
        ['a header-filter key with a non-ASCII letter', '{"headerFilters":{"vvdé":"y"}}', ['headerFilters|vvdé|invalid-key']],
        ['a tab given as a number', '{"tab":1}', ['tab|1|wrong-type']],
        ['a tab given as a list', '{"tab":["detail"]}', ['tab|array(1)|wrong-type']],
        ['a date given as a number', '{"date":20260105}', ['date|20260105|wrong-type']],
        ['a date given as null', '{"date":null}', ['date|null|wrong-type']],
        ['weeksAhead given as text', '{"weeksAhead":"4"}', ['weeksAhead|4|wrong-type']],
        ['weeksAhead given as null', '{"weeksAhead":null}', ['weeksAhead|null|wrong-type']],
        ['weeksAhead given as true', '{"weeksAhead":true}', ['weeksAhead|true|wrong-type']],
        ['weeksAhead given as a list', '{"weeksAhead":[4]}', ['weeksAhead|array(1)|wrong-type']],
        ['weeksAhead given as an object', '{"weeksAhead":{}}', ['weeksAhead|object|wrong-type']],
    ];
    for (const [label, json, want] of WRONG) {
        t(`wrong type: ${label}: rejected with a reason, nothing applied for that key`, (() => { const r = D(frame(json)); return { state: r.state, lines: lines(r), problems: problemsWith(r) }; })(),
            { state: {}, lines: want, problems: [] });
    }
    t('wrong type: a good key beside a bad one still applies', outcome(D(frame('{"selectedLanes":["AL5"],"selectedYards":5}'))).state, { selectedLanes: ['AL5'] });

    // Dates: a real calendar date, decided by arithmetic (no Date local-time methods; the checks also run under other TZ values in docs/TESTING.md).
    const DATES = [
        ['2026-09-01', true], ['2024-02-29', true], ['2000-02-29', true], ['2026-12-31', true], ['2026-04-30', true], ['2099-12-31', true], ['2000-01-01', true], ['2026-02-28', true],
        ['2026-02-30', false], ['2026-02-29', false], ['2026-13-01', false], ['2026-00-10', false], ['2026-04-31', false], ['2026-01-00', false], ['2026-01-32', false],
        ['2026-1-5', false], ['2026-01-5', false], ['2026-1-05', false], ['26-01-05', false], ['2026-01-05T00:00:00Z', false], [' 2026-01-05', false], ['2026-01-05 ', false], ['2026-01-05\n', false],
        ['2026/01/05', false], ['20260105', false], ['1999-12-31', false], ['2100-01-01', false], ['2100-02-29', false], ['0000-01-01', false],
        ['２０２６-０１-０５', false], ['2026-0a-01', false], ['abcd-ef-gh', false], ['', false], ['-2026-01-0', false], ['2026-01--5', false], ['2026-+1-05', false],
    ];
    for (const [text, ok] of DATES) {
        const r = D(frame(JSON.stringify({ date: text })));
        t(`date ${JSON.stringify(text)} is ${ok ? 'valid' : 'invalid'}: decoded ${ok ? 'and applied' : 'with invalid-value'}, and the encoder ${ok ? 'writes' : 'refuses'} it`,
            { applied: r.applied, reasons: r.dropped.map((d) => d.reason), encoded: typeof E({ date: text }) },
            ok ? { applied: ['date'], reasons: [], encoded: 'string' } : { applied: [], reasons: ['invalid-value'], encoded: 'object' });
    }

    // weeksAhead: an integer 1..52, as a JSON number.
    const WEEKS = [
        ['1', 1], ['4', 4], ['18', 18], ['52', 52], ['4.0', 4], ['1e1', 10], ['0', 'invalid-value'], ['-1', 'invalid-value'], ['53', 'invalid-value'], ['1.5', 'invalid-value'], ['0.9', 'invalid-value'],
        ['52.0001', 'invalid-value'], ['1e400', 'invalid-value'], ['-1e400', 'invalid-value'], ['100', 'invalid-value'], ['-0', 'invalid-value'],
    ];
    for (const [json, want] of WEEKS) {
        const r = D(frame(`{"weeksAhead":${json}}`));
        t(`weeksAhead ${json}: ${typeof want === 'number' ? 'applied as ' + want : 'rejected, ' + want}`,
            { state: r.state, reasons: r.dropped.map((d) => d.reason), problems: problemsWith(r) },
            typeof want === 'number' ? { state: { weeksAhead: want }, reasons: [], problems: [] } : { state: {}, reasons: [want], problems: [] });
    }
    t('weeksAhead: the encoder writes 1 and 52 and refuses 0, 53, 1.5, NaN, Infinity, -1 and "4"',
        [1, 52, 0, 53, 1.5, NaN, Infinity, -1, '4'].map((v) => typeof E({ weeksAhead: v })), ['string', 'string', 'object', 'object', 'object', 'object', 'object', 'object', 'object']);

    const BAD_TABS = ['Detail', 'DETAIL', ' detail', 'detail ', 'foo', '', 'constructor', '__proto__', 'trade-summary', 'tradeSummary', 'summary', '\u0000'];
    t('tab: only the five tab ids are accepted; anything else (wrong case, padded, empty, a prototype name) is rejected as invalid-value',
        BAD_TABS.map((tab) => { const r = D(frame(JSON.stringify({ tab }))); return `${r.applied.length}|${r.dropped.map((d) => d.reason).join()}|${E({ tab }) === null}`; }),
        BAD_TABS.map(() => '0|invalid-value|true'));

    // =============================================================================================
    // 7. Hostile text: never throws, never a key outside the whitelist, never a wrong type.
    // =============================================================================================
    const VALID = E({ selectedLanes: ['AL5'], tab: 'detail' });
    const VALID_TAIL = VALID.slice(VALID.indexOf('.') + 1);
    const refused = (errors) => ({ errors, state: {}, dropped: [], problems: [] });
    const coercible = { toString() { return VALID; } };
    const HOSTILE = [
        ['an empty string', '', ['empty']],
        ['null', null, ['not-a-string']], ['undefined', undefined, ['not-a-string']], ['a number', 42, ['not-a-string']], ['NaN', NaN, ['not-a-string']], ['true', true, ['not-a-string']],
        ['an object', { a: 1 }, ['not-a-string']], ['an array', [VALID], ['not-a-string']], ['an object whose toString yields a valid link (never coerced)', coercible, ['not-a-string']],
        ['a String object wrapping a valid link', new String(VALID), ['not-a-string']], ['a function', () => VALID, ['not-a-string']],
        ['100 KB of letters', 'A'.repeat(100000), ['too-long']], ['100 KB that starts like a link', 'v1.' + 'A'.repeat(100000), ['too-long']], ['100 KB of whitespace', ' '.repeat(100000), ['too-long']],
        ['100 KB of non-ASCII', 'é'.repeat(100000), ['too-long']], ['4001 characters', 'A'.repeat(4001), ['too-long']],
        ['garbage', 'garbage', ['bad-format']], ['one word of allowed characters', 'hello_world-1', ['bad-format']], ['dots only', '...', ['bad-format']], ['a dot', '.', ['bad-format']],
        ['hello world (a space)', 'hello world', ['bad-characters']], ['javascript: text', 'javascript:alert(1)', ['bad-characters']], ['javascript text with only allowed characters', 'javascript.alert.1', ['bad-format']],
        ['script tags', '<script>alert(1)</script>', ['bad-characters']], ['a link whose payload is script tags', 'v1.<script>.abcd', ['bad-characters']], ['percent-encoded payload', 'v1.%65%33%30.uoPo', ['bad-characters']],
        ['a data: URL', 'data:text/html;base64,PHNjcmlwdD4=', ['bad-characters']], ['a path', '../../etc/passwd', ['bad-characters']], ['a URL', 'https://example.com/?view=' + VALID, ['bad-characters']],
        ['a NUL character', 'v1.e30\u0000.uoPo', ['bad-characters']], ['a newline at the end of a valid link (never trimmed)', VALID + '\n', ['bad-characters']], ['a space before a valid link', ' ' + VALID, ['bad-characters']],
        ['a trailing dot after a valid link', VALID + '.', ['bad-format']], ['padding added to a valid link', VALID + '=', ['bad-characters']],
        ['the prefix alone', 'v1.', ['bad-format']], ['an empty payload', 'v1..' + checkOf(''), ['bad-format']], ['no check', 'v1.e30', ['bad-format']], ['an empty check', 'v1.e30.', ['bad-format']],
        ['a short check', 'v1.e30.uoP', ['bad-format']], ['a long check', 'v1.e30.uoPoo', ['bad-format']], ['one dot too many', VALID + '.abcd', ['bad-format']],
        ['a dot inside the check', 'v1.e30.uo.o', ['bad-format']],
        ['version v2', 'v2.' + VALID_TAIL, ['unsupported-version']], ['version v0', 'v0.' + VALID_TAIL, ['unsupported-version']], ['version v10', 'v10.' + VALID_TAIL, ['unsupported-version']],
        ['version v123', 'v123.' + VALID_TAIL, ['unsupported-version']], ['upper-case V1', 'V1.' + VALID_TAIL, ['bad-format']], ['version v1x', 'v1x.' + VALID_TAIL, ['bad-format']],
        ['version v1234 (too many digits to be a version)', 'v1234.' + VALID_TAIL, ['bad-format']], ['no version', VALID_TAIL, ['bad-format']], ['a different prefix', 'x1.' + VALID_TAIL, ['bad-format']],
        ['a wrong check', VALID.slice(0, -4) + (VALID.endsWith('AAAA') ? 'BBBB' : 'AAAA'), ['bad-checksum']],
        ['one payload with another payload\'s check', 'v1.' + Buffer.from('{"tab":"compare"}').toString('base64url') + '.' + VALID.slice(-4), ['bad-checksum']],
        ['a payload altered in one character (check no longer matches)', (() => { const i = VALID.indexOf('.') + 5; return VALID.slice(0, i) + (VALID[i] === 'A' ? 'B' : 'A') + VALID.slice(i + 1); })(), ['bad-checksum']],
        // Frames with a CORRECT check: they get past the cheap tests and exercise the layers below.
        ['a payload of 5 characters (no byte count writes that)', framePayload('e30aa'), ['bad-base64']], ['a payload with non-zero leftover bits (e31 is not the canonical spelling of anything)', framePayload('e31'), ['bad-base64']],
        ['a payload with non-zero leftover bits in a 2-character tail (e1)', framePayload('e1'), ['bad-base64']],
        ['a payload of 5 characters whose last character carries no bits (e30AA: still no byte count writes 5 characters)', framePayload('e30AA'), ['bad-base64']],
        ['an overlong 3-byte form (E0 80 80)', frameBytes([0xE0, 0x80, 0x80]), ['bad-utf8']],
        ['an overlong 3-byte form of U+07FF, the largest 2-byte code point (E0 9F BF)', frameBytes([0xE0, 0x9F, 0xBF]), ['bad-utf8']],
        ['an overlong 4-byte form of U+FFFF, the largest 3-byte code point (F0 8F BF BF)', frameBytes([0xF0, 0x8F, 0xBF, 0xBF]), ['bad-utf8']],
        ['bytes that are an overlong UTF-8 form (C0 80)', frameBytes([0xC0, 0x80]), ['bad-utf8']], ['a lone 0xFF byte', frameBytes([0xFF]), ['bad-utf8']], ['a stray continuation byte', frameBytes([0x80]), ['bad-utf8']],
        ['a truncated 3-byte sequence', frameBytes([0x7b, 0xE2, 0x82]), ['bad-utf8']], ['an encoded surrogate (ED A0 80)', frameBytes([0xED, 0xA0, 0x80]), ['bad-utf8']],
        ['a code point above U+10FFFF (F4 90 80 80)', frameBytes([0xF4, 0x90, 0x80, 0x80]), ['bad-utf8']], ['an overlong 4-byte form (F0 80 80 80)', frameBytes([0xF0, 0x80, 0x80, 0x80]), ['bad-utf8']],
        ['a lead byte followed by a non-continuation byte', frameBytes([0xC3, 0x28]), ['bad-utf8']], ['byte F5 (never valid)', frameBytes([0xF5, 0x80, 0x80, 0x80]), ['bad-utf8']],
        ['JSON text that is empty', frame(''), ['bad-format']], ['JSON that is cut off', frame('{"selectedLanes":["AL5"'), ['bad-json']], ['JSON with a trailing comma', frame('{"selectedLanes":["AL5"],}'), ['bad-json']],
        ['JSON with single quotes', frame("{'tab':'detail'}"), ['bad-json']], ['JSON followed by garbage', frame('{"tab":"detail"}x'), ['bad-json']], ['two JSON objects', frame('{}{}'), ['bad-json']],
        ['JSON with a raw NUL inside a string', frame('{"yardSearchText":"a\u0000b"}'), ['bad-json']], ['JSON with a raw newline inside a string', frame('{"yardSearchText":"a\nb"}'), ['bad-json']],
        ['JSON with a byte-order mark', frame('﻿{}'), ['bad-json']], ['JSON with a comment', frame('{"tab":"detail"}//x'), ['bad-json']], ['JSON NaN', frame('{"weeksAhead":NaN}'), ['bad-json']],
        ['JSON null', frame('null'), ['not-an-object']], ['a JSON array', frame('[]'), ['not-an-object']], ['a JSON array of objects', frame('[{"tab":"detail"}]'), ['not-an-object']],
        ['a JSON string', frame('"tab"'), ['not-an-object']], ['a JSON number', frame('5'), ['not-an-object']], ['JSON true', frame('true'), ['not-an-object']],
        ['a JSON array nested 1,400 levels deep', frame('['.repeat(1400) + ']'.repeat(1400)), ['not-an-object']],
        ['a JSON array nested 10,000 levels deep (13 KB of text: refused before any parsing)', frame('['.repeat(10000) + ']'.repeat(10000)), ['too-long']],
        ['a JSON object nested 100,000 levels deep (refused before any parsing)', frame('{"a":'.repeat(100000) + '1' + '}'.repeat(100000)), ['too-long']],
    ];
    for (const [label, input, errors] of HOSTILE) {
        t(`hostile text: ${label}: refused with ${JSON.stringify(errors)}, no throw, an empty and well-formed result`,
            (() => { try { return outcome(D(input)); } catch (e) { return `THREW ${e && e.message}`; } })(), refused(errors));
    }
    t('hostile text: valid sets that throw when read (a Proxy; a caller bug, not an attack) still cannot make the decoder throw: it reports internal-error, the safety net, and nothing else',
        (() => { try { return D(VALID, new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('boom'); }, get() { throw new Error('boom'); } })); } catch (e) { return `THREW ${e.message}`; } })(),
        { state: {}, applied: [], dropped: [], errors: ['internal-error'] });
    t('hostile text: the one positive control among them, the valid link, is read', outcome(D(VALID)), { errors: [], state: { selectedLanes: ['AL5'], tab: 'detail' }, dropped: [], problems: [] });
    t('hostile text: a valid link with the right check but a bad version prefix and bad characters reports the first problem only (bad-characters), once',
        D('v2.<>.zzzz').errors, ['bad-characters']);
    t('hostile text: cut at every possible length, a valid link is never accepted and never throws',
        (() => {
            const long = E(REAL_VIEW);
            const accepted = [];
            for (let n = 0; n < long.length; n++) { const r = D(long.slice(0, n)); if (r.errors.length === 0 || problemsWith(r).length) accepted.push(n); }
            return { checked: long.length, accepted };
        })(), { checked: E(REAL_VIEW).length, accepted: [] });
    t('hostile text: with ANY single character replaced by any other URL-safe character, a valid link is never accepted (the check catches every one)',
        (() => {
            const long = E({ selectedLanes: ['AL5', 'AN2'], selectedSaleWeeks: ['2026/W30'], yardSearchText: 'Zürich \u{1F6A2}', tab: 'detail' });
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
            let tried = 0;
            const accepted = [];
            for (let i = 0; i < long.length; i++) {
                for (const ch of alphabet) {
                    if (ch === long[i]) continue;
                    tried++;
                    const r = D(long.slice(0, i) + ch + long.slice(i + 1));
                    if (r.errors.length === 0 || problemsWith(r).length) accepted.push(`${i}:${ch}`);
                }
            }
            return { tried: tried === long.length * 64, accepted };
        })(), { tried: true, accepted: [] });
    t('hostile text: one flipped character in the middle of the payload is reported as bad-checksum',
        (() => { const i = VALID.indexOf('.') + 7; return D(VALID.slice(0, i) + (VALID[i] === 'x' ? 'y' : 'x') + VALID.slice(i + 1)).errors; })(), ['bad-checksum']);
    t('hostile text: one character removed or inserted is never accepted',
        (() => {
            const accepted = [];
            for (let i = 0; i <= VALID.length; i++) {
                if (D(VALID.slice(0, i) + VALID.slice(i + 1)).errors.length === 0 && i < VALID.length) accepted.push(`del${i}`);
                if (D(VALID.slice(0, i) + 'A' + VALID.slice(i)).errors.length === 0) accepted.push(`ins${i}`);
            }
            return accepted;
        })(), []);

    // Deep and wide structures that fit inside the limit (they DO get parsed): rejected by type, never recursed into.
    const deepList = '['.repeat(1400) + ']'.repeat(1400);
    const deepMap = '{"a":'.repeat(400) + '1' + '}'.repeat(400);
    const DEEP = [
        ['a list value nested 1,400 levels deep', `{"selectedLanes":${deepList},"tab":"detail"}`, { tab: 'detail' }, ['selectedLanes|array(1)|wrong-type']],
        ['a header-filter value nested 400 levels deep', `{"headerFilters":${deepMap},"tab":"detail"}`, { tab: 'detail' }, ['headerFilters|a|wrong-type']],
        ['an unknown key holding a value nested 1,400 levels deep', `{"deep":${deepList},"tab":"detail"}`, { tab: 'detail' }, ['deep|array(1)|unknown-key']],
        ['a list of 900 empty lists', `{"selectedLanes":[${'[],'.repeat(899)}[]]}`, {}, ['selectedLanes|900|too-many-items']],
        ['a list of 150 nested lists', `{"selectedLanes":[${'[],'.repeat(149)}[]]}`, {}, ['selectedLanes|array(0)|wrong-type']],
    ];
    for (const [label, json, state, want] of DEEP) {
        t(`deep input: ${label}`, (() => { const text = frame(json); const r = D(text); return { fits: text.length <= 4000, state: r.state, lines: lines(r), problems: problemsWith(r) }; })(),
            { fits: true, state, lines: want, problems: [] });
    }

    // =============================================================================================
    // 8. Prototype pollution.
    // =============================================================================================
    const VmObject = D('x').state.constructor;
    const PROTO = [
        ['a __proto__ key', '{"__proto__":{"polluted":"yes"}}', { state: {}, lines: ['__proto__|object|forbidden-key'] }],
        ['a constructor key', '{"constructor":{"prototype":{"polluted":"yes"}}}', { state: {}, lines: ['constructor|object|forbidden-key'] }],
        ['a prototype key', '{"prototype":{"polluted":"yes"}}', { state: {}, lines: ['prototype|object|forbidden-key'] }],
        ['__proto__ null', '{"__proto__":null}', { state: {}, lines: ['__proto__|null|forbidden-key'] }],
        ['__proto__ beside a good key (the good key still applies)', '{"selectedLanes":["AL5"],"__proto__":{"polluted":"yes"}}', { state: { selectedLanes: ['AL5'] }, lines: ['__proto__|object|forbidden-key'] }],
        ['all three beside good keys', '{"selectedLanes":["AL5"],"__proto__":{"polluted":1},"constructor":{"polluted":1},"prototype":{"polluted":1},"tab":"detail"}',
            { state: { selectedLanes: ['AL5'], tab: 'detail' }, lines: ['__proto__|object|forbidden-key', 'constructor|object|forbidden-key', 'prototype|object|forbidden-key'] }],
        ['__proto__ inside headerFilters (the whole map is rejected)', '{"headerFilters":{"__proto__":{"polluted":"yes"},"vvd":"A"}}', { state: {}, lines: ['headerFilters|__proto__|forbidden-key'] }],
        ['__proto__ as a header-filter text key with a string value', '{"headerFilters":{"__proto__":"yes","vvd":"A"}}', { state: {}, lines: ['headerFilters|__proto__|forbidden-key'] }],
        ['constructor inside headerFilters', '{"headerFilters":{"constructor":"x"}}', { state: {}, lines: ['headerFilters|constructor|forbidden-key'] }],
        ['prototype inside headerFilters', '{"headerFilters":{"prototype":"x","vvd":"A"}}', { state: {}, lines: ['headerFilters|prototype|forbidden-key'] }],
        ['__proto__ as a list item (it is a value, not a key: kept)', '{"selectedLanes":["__proto__","constructor"]}', { state: { selectedLanes: ['__proto__', 'constructor'] }, lines: [] }],
        ['__proto__ with a whitelisted-looking value', '{"__proto__":{"selectedLanes":["AL5"],"tab":"detail"}}', { state: {}, lines: ['__proto__|object|forbidden-key'] }],
    ];
    for (const [label, json, want] of PROTO) {
        t(`prototype pollution: ${label}`, (() => { const r = D(frame(json)); return { state: r.state, lines: lines(r), problems: problemsWith(r) }; })(), { state: want.state, lines: want.lines, problems: [] });
    }
    t('prototype pollution: after every payload above, nothing was added to Object.prototype in either realm, and the decoded state is an ordinary object',
        (() => {
            const fresh = D(frame('{"__proto__":{"polluted":"yes"},"selectedLanes":["AL5"]}')).state;
            return { testRealm: ({}).polluted, vmRealm: new VmObject().polluted, vmKeys: Object.keys(VmObject.prototype), stateProto: Object.getPrototypeOf(fresh) === VmObject.prototype,
                ownProto: Object.prototype.hasOwnProperty.call(fresh, '__proto__') };
        })(), { testRealm: undefined, vmRealm: undefined, vmKeys: [], stateProto: true, ownProto: false });
    t('prototype pollution: an own __proto__ in a view handed to the ENCODER is refused, and the encoder pollutes nothing either',
        { encoded: E(JSON.parse('{"__proto__":{"polluted":"yes"},"selectedLanes":["A"]}')), polluted: new VmObject().polluted, testRealm: ({}).polluted }, { encoded: null, polluted: undefined, testRealm: undefined });

    // =============================================================================================
    // 9. Fuzz. A seeded generator, so a failure reproduces.
    // =============================================================================================
    let seed = 0x5EED1234;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const int = (n) => Math.floor(rnd() * n);
    const pick = (a) => a[int(a.length)];
    const URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const randOf = (alphabet, n) => { let s = ''; for (let i = 0; i < n; i++) s += alphabet[int(alphabet.length)]; return s; };
    const randUnicode = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(rnd() < 0.2 ? 0xD800 + int(0x800) : int(0x3000)); return s; };
    const SAMPLES = [VALID, E(REAL_VIEW), E(UNICODE), E(ALL), E({}), E({ weeksAhead: 4, date: '2026-09-01' })];
    const mutate = (s) => {
        const i = int(s.length + 1);
        switch (int(6)) {
            case 0: return s.slice(0, i);
            case 1: return s.slice(0, i) + pick(URLSAFE.split('')) + s.slice(i + 1);
            case 2: return s.slice(0, i) + s.slice(i + 1);
            case 3: return s.slice(0, i) + randOf(URLSAFE + '.', 1 + int(5)) + s.slice(i);
            case 4: return s + s.slice(int(s.length));
            default: return s.slice(int(s.length));
        }
    };
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    const GENERATORS = [
        () => randOf(printable, int(300)),
        () => randOf(URLSAFE + '.', int(400)),
        () => `v1.${randOf(URLSAFE, int(80))}.${randOf(URLSAFE, 4)}`,
        () => randUnicode(int(50)),
        () => mutate(pick(SAMPLES)),
        () => mutate(mutate(mutate(pick(SAMPLES)))),
        () => randOf(URLSAFE + '..', 3990 + int(20)),
        () => frameBytes(Array.from({ length: int(60) }, () => int(256))),
        () => framePayload(randOf(URLSAFE, int(60))),
    ];
    {
        let threw = 0, internal = 0;
        const malformed = [];
        const codes = new Set();
        for (let i = 0; i < 2000; i++) {
            const input = GENERATORS[i % GENERATORS.length]();
            try {
                const r = D(input);
                const p = problemsWith(r);
                if (r.errors.includes('internal-error')) internal++;
                if (p.length) malformed.push(`${i}: ${p[0]}`);
                r.errors.forEach((c) => codes.add(c));
            } catch (e) { threw++; }
        }
        t('fuzz: 2,000 random and mutated strings (random ASCII, random URL-safe text, random frames, random Unicode with lone surrogates, mutated and truncated valid links, near-limit text, random bytes with a correct check): none throws, none reaches the safety net, every result is well-formed',
            { threw, internal, malformed }, { threw: 0, internal: 0, malformed: [] });
        t('fuzz: those inputs reached every layer of the reader (the fuzz is not vacuous: each of these refusal codes came up at least once)',
            ['bad-characters', 'too-long', 'bad-format', 'bad-checksum', 'bad-base64', 'bad-utf8', 'bad-json'].filter((c) => !codes.has(c)), []);
    }
    const KEY_POOL = [...WHITELIST, ...WHITELIST, 'unknown', 'topPanelCollapsed', '__proto__', 'constructor', 'prototype', 'selectedlanes', 'x'.repeat(100)];
    const COLUMN_POOL = ['vvd', 'remarks', 'saleWeek', 'vslOpr', 'bad key', '__proto__', 'constructor', 'prototype', 'k'.repeat(70), '', '1a'];
    const randScalar = () => pick([() => randOf(printable, int(30)), () => randOf(printable, 195 + int(12)), () => int(100) - 10, () => rnd() * 100, () => null, () => true, () => pick(TABS), () => pick(TABS).toUpperCase(),
        () => `20${20 + int(90)}-${String(int(15)).padStart(2, '0')}-${String(int(33)).padStart(2, '0')}`, () => randUnicode(int(10))])();
    const randValue = (depth) => {
        const r = rnd();
        if (r < 0.35) return randScalar();
        // Long arrays hold only strings (a long array of nested arrays would grow without bound and never fit a link); short ones may hold anything.
        if (r < 0.65 && depth < 4) {
            const n = pick([0, 1, 2, 3, 5, 10, 50, 199, 200, 201, 230]);
            return Array.from({ length: n }, () => (n > 10 || rnd() < 0.9 ? randOf('ABCxyz019/ ', 1 + int(8)) : randValue(depth + 1)));
        }
        if (depth < 4) {
            const n = pick([0, 1, 2, 3, 5, 10, 45, 60]);
            return Object.fromEntries(Array.from({ length: n }, () => [rnd() < 0.7 ? `k${int(1000)}` : pick(COLUMN_POOL), n > 10 || rnd() < 0.85 ? randOf('abc XYZ', int(20)) : randValue(depth + 1)]));
        }
        return randScalar();
    };
    const SETS = [undefined, {}, { selectedLanes: ['A', 'B'] }, { selectedSaleWeeks: [], tabs: ['detail'], date: ['2026-09-01'], headerFilters: ['vvd'] }, { selectedYards: ['ABC', '__proto__'], selectedLanes: null }];
    {
        let threw = 0, internal = 0, parsed = 0, fits = 0;
        const malformed = [];
        const reasons = new Set();
        const applied = new Set();
        seed = 0xFACE5EED;
        for (let i = 0; i < 2000; i++) {
            const o = {};
            const n = 1 + int(5);
            // defineProperty, because plain assignment of a __proto__ key would set the prototype instead of making the key
            for (let k = 0; k < n; k++) Object.defineProperty(o, pick(KEY_POOL), { value: randValue(0), enumerable: true, writable: true, configurable: true });
            const text = frame(JSON.stringify(o));
            if (text.length <= 4000) fits++;
            try {
                const r = D(text, pick(SETS));
                const p = problemsWith(r);
                if (r.errors.includes('internal-error')) internal++;
                if (p.length) malformed.push(`${i}: ${p[0]}`);
                if (r.errors.length === 0) parsed++;
                r.dropped.forEach((d) => reasons.add(d.reason));
                r.applied.forEach((k) => applied.add(k));
            } catch (e) { threw++; }
        }
        t('fuzz: 2,000 random JSON objects (whitelisted, unknown and prototype-pollution keys; wrong types, nesting, 199 to 230 element arrays, maps of up to 60 keys, over-long strings), each framed with a correct check and decoded against random valid sets: none throws, every result is well-formed, nothing is added to Object.prototype',
            { threw, internal, malformed, polluted: [({}).polluted, new VmObject().polluted] }, { threw: 0, internal: 0, malformed: [], polluted: [undefined, undefined] });
        t('fuzz: about half of those objects fit the limit; every one that did was read, every reason for dropping a key came up at least once, and every whitelisted key was applied at least once (the fuzz reaches every per-key rule)',
            { everyFittingTextWasRead: parsed === fits, enough: fits >= 1000, missingReasons: REASONS.filter((r) => !reasons.has(r)), neverApplied: WHITELIST.filter((k) => !applied.has(k)) },
            { everyFittingTextWasRead: true, enough: true, missingReasons: [], neverApplied: [] });
    }
    {
        // Random VALID views: write, read, write again. The independent expectation is "the view minus its empty values".
        seed = 0xC0FFEE11;
        const small = (n) => randOf('ABCxyz019/ é港"\\\n\t', 1 + int(n)) + (rnd() < 0.15 ? '\u{1F6A2}' : '') + (rnd() < 0.05 ? '\ud800' : '');
        const view = () => {
            const v = {};
            LIST_KEYS.forEach((k) => { if (rnd() < 0.5) v[k] = Array.from({ length: int(5) }, () => small(6)); });
            if (rnd() < 0.4) v.yardSearchText = rnd() < 0.2 ? '' : small(12);
            if (rnd() < 0.4) v.headerFilters = Object.fromEntries(Array.from({ length: int(5) }, () => [pick(['vvd', 'remarks', 'saleWeek', 'vslOpr', 'lane', 'tat']), rnd() < 0.2 ? '' : small(6)]));
            if (rnd() < 0.5) v.tab = pick(TABS);
            if (rnd() < 0.3) v.date = pick(['2026-09-01', '2024-02-29', '2000-02-29', '2099-12-31']);
            if (rnd() < 0.3) v.weeksAhead = 1 + int(52);
            return v;
        };
        const expected = (v) => {
            const e = {};
            Object.keys(v).sort().forEach((k) => {
                const x = v[k];
                if (Array.isArray(x)) { if (x.length) e[k] = x; } else if (k === 'headerFilters') {
                    const m = {};
                    Object.keys(x).sort().forEach((c) => { if (x[c].trim() !== '') m[c] = x[c]; });
                    if (Object.keys(m).length) e[k] = m;
                } else if (x !== '') e[k] = x;
            });
            return e;
        };
        const bad = [];
        let nulls = 0;
        for (let i = 0; i < 500; i++) {
            const v = view();
            const text = E(v);
            if (text === null) { nulls++; continue; }
            const r = D(text);
            if (canon(r.state) !== canon(expected(v))) bad.push(`${i}: state differs from the view`);
            if (r.errors.length || r.dropped.length || problemsWith(r).length) bad.push(`${i}: reported something`);
            if (E(r.state) !== text) bad.push(`${i}: not canonical`);
            if (text !== frame(Buffer.from(text.split('.')[1], 'base64url').toString('utf8'))) bad.push(`${i}: payload is not what the oracle frames`);
        }
        t('fuzz: 500 random valid views (any mix of keys, non-ASCII, quotes, control characters, lone surrogates, empty values): each is written, read back as exactly the view minus its empty (and whitespace-only) values with nothing reported, re-written to the identical text, and framed exactly as the oracle frames its own payload',
            { bad, nulls }, { bad: [], nulls: 0 });
    }
};

'use strict';
/**
 * Behaviour tests for the decision store's record logic (shared/65_decisions.js, D84 slice 2a-3, ADR-R1):
 * decisionLimits, normalizeDecisionRecord, decisionRecordFromRow, decisionRecordToRow, latestDecisionPerKey,
 * decisionHistoryFor, thresholdLog and thresholdLiveInFeed.
 *
 * Evidence: hand-written fixtures (every rule worked out in the comments), hostile inputs (non-objects, throwing getters and
 * proxies, throwing valueOf / toString, inherited and '__proto__' keys, a polluted Object.prototype), order independence over
 * every permutation of a seven-record store, supersedes chains, cross-key corrections and cycles, and purity (the realm's
 * clock and random source made to throw). There is no real data for this module: the Decisions and ThresholdLog tabs do not
 * exist yet, so nothing here is pinned to production rows.
 *
 * Calls go through local names: tests/check_shared_sync.js check E forbids a second definition of a shared name in tests/.
 */
const fs = require('fs');
const path = require('path');

exports.TESTS = ['decisionLimits', 'normalizeDecisionRecord', 'decisionRecordFromRow', 'decisionRecordToRow', 'latestDecisionPerKey',
    'decisionHistoryFor', 'thresholdLog', 'thresholdLiveInFeed', 'decisionTime'];
exports.COUNT = 51;
exports.run = function (ctx) {
    const { BFShared, t, plain } = ctx;
    const norm = (r) => plain(BFShared.normalizeDecisionRecord(r));
    const fromRow = (r) => plain(BFShared.decisionRecordFromRow(r));
    const toRow = (r) => plain(BFShared.decisionRecordToRow(r));
    const latest = (rs) => plain(BFShared.latestDecisionPerKey(rs));
    const history = (rs, k) => plain(BFShared.decisionHistoryFor(rs, k));
    const tlog = (rs, cur, since) => plain(BFShared.thresholdLog(rs, cur, since));
    const live = (a, b) => BFShared.thresholdLiveInFeed(a, b);
    const safe = (fn) => { try { return fn(); } catch (e) { return `THREW: ${e && e.message}`; } };
    const boom = { valueOf() { throw new Error('valueOf was called'); }, toString() { throw new Error('toString was called'); } };
    const getterBoom = (base, key) => { const o = Object.assign({}, base); Object.defineProperty(o, key, { enumerable: true, get() { throw new Error(`getter ${key}`); } }); return o; };
    const proxyBoom = new Proxy({}, { get() { throw new Error('proxy get'); }, has() { throw new Error('proxy has'); }, ownKeys() { throw new Error('proxy ownKeys'); }, getOwnPropertyDescriptor() { throw new Error('proxy gopd'); } });

    const AT = (h, m = 0) => `2026-10-30T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
    const dec = (id, vvd, polKey, action, createdAt, supersedes = '', author = 'a@x.com', reason = 'because') =>
        ({ id, vvd, polKey, kind: 'decision', payload: { action, reason }, author, createdAt, supersedes });
    const thr = (id, vvd, polKey, field, from, to, status, createdAt, supersedes = '', author = 'p@x.com', reason = 'lane needs it') =>
        ({ id, vvd, polKey, kind: 'threshold', payload: { field, from, to, reason, status }, author, createdAt, supersedes });
    const ids = (list) => list.map((r) => r.id);

    // ================================================================================================
    // decisionLimits
    // ================================================================================================
    {
        const a = plain(BFShared.decisionLimits());
        const raw = BFShared.decisionLimits();
        raw.reasonMaxChars = 1; raw.actions.push('delete');
        t('decisionLimits: the caps and the allowed values; each call is a fresh copy, so changing one changes nothing',
            { a, again: plain(BFShared.decisionLimits()) },
            { a: { reasonMaxChars: 1000, payloadMaxChars: 4000, idMaxChars: 64, emailMaxChars: 254, kinds: ['decision', 'threshold'],
                actions: ['freeze', 'monitor', 'cut', 'roll'], fields: ['overall', 'loading'], statuses: ['proposed', 'approved', 'rejected'] }, again: a });
    }

    // ================================================================================================
    // normalizeDecisionRecord
    // ================================================================================================
    t('normalize: a decision is trimmed and cased (vvd and polKey upper, kind, action and author lower), milliseconds are added, ' +
      'unknown payload keys and unknown record keys are dropped, a null supersedes is ""',
        norm({ id: ' d-1 ', vvd: ' cikt0014w ', polKey: ' ussav#2 ', kind: ' Decision ', payload: { action: ' FREEZE ', reason: '  ~70 TEU empties  ', extra: 1, from: 2 },
            author: ' Bob@X.com ', createdAt: '2026-10-30T14:05:09Z', supersedes: null, other: 'dropped' }),
        { ok: true, record: { id: 'd-1', vvd: 'CIKT0014W', polKey: 'USSAV#2', kind: 'decision', payload: { action: 'freeze', reason: '~70 TEU empties' },
            author: 'bob@x.com', createdAt: '2026-10-30T14:05:09.000Z', supersedes: '' } });
    t('normalize: thresholds keep field, from, to, reason, status in that order; from 0, 0.01 and null are "not set" (null); a missing polKey is ""',
        [
            norm(thr('t1', 'V100', undefined, 'overall', 1.2, 1.5, 'proposed', AT(1))),
            norm(thr('t2', 'V100', 'USNYC', 'loading', 0, 1.1, 'Approved', AT(2), 't9')),
            norm(thr('t3', 'V100', 'USNYC', 'loading', 0.01, 1.1, 'rejected', AT(3))),
            norm(thr('t4', 'V100', 'USNYC', 'loading', null, 1.1, 'proposed', AT(4))),
        ].map((x) => x.ok ? [x.record.polKey, JSON.stringify(x.record.payload), x.record.supersedes] : x.error),
        [
            ['', '{"field":"overall","from":1.2,"to":1.5,"reason":"lane needs it","status":"proposed"}', ''],
            ['USNYC', '{"field":"loading","from":null,"to":1.1,"reason":"lane needs it","status":"approved"}', 't9'],
            ['USNYC', '{"field":"loading","from":null,"to":1.1,"reason":"lane needs it","status":"rejected"}', ''],
            ['USNYC', '{"field":"loading","from":null,"to":1.1,"reason":"lane needs it","status":"proposed"}', ''],
        ]);
    {
        const good = dec('d1', 'V100', 'USNYC', 'cut', AT(1));
        const withRec = (k, v) => Object.assign({}, good, { [k]: v });
        const withPay = (k, v) => Object.assign({}, good, { payload: Object.assign({}, good.payload, { [k]: v }) });
        const tgood = thr('t1', 'V100', 'USNYC', 'loading', 1.0, 1.2, 'proposed', AT(1));
        const withT = (k, v) => Object.assign({}, tgood, { payload: Object.assign({}, tgood.payload, { [k]: v }) });
        // [label, input, expected error code]
        const TABLE = [
            ['null', null, 'not-object'], ['undefined', undefined, 'not-object'], ['number', 5, 'not-object'], ['string', 'x', 'not-object'],
            ['array', [good], 'not-object'], ['function', () => good, 'not-object'], ['date', new Date(0), 'not-object'],
            ['id missing', withRec('id', undefined), 'invalid-id'], ['id blank', withRec('id', '  '), 'invalid-id'], ['id number', withRec('id', 7), 'invalid-id'],
            ['id 65 chars', withRec('id', 'a'.repeat(65)), 'invalid-id'], ['id with space', withRec('id', 'a b'), 'invalid-id'], ['id leading dash', withRec('id', '-a'), 'invalid-id'],
            ['id boxed string', withRec('id', new String('d1')), 'invalid-id'],
            ['vvd blank', withRec('vvd', ''), 'invalid-vvd'], ['vvd VMS', withRec('vvd', ' vms '), 'invalid-vvd'], ['vvd number', withRec('vvd', 1234), 'invalid-vvd'],
            ['vvd one char', withRec('vvd', 'V'), 'invalid-vvd'], ['vvd 41 chars', withRec('vvd', 'V'.repeat(41)), 'invalid-vvd'], ['vvd formula', withRec('vvd', '=1+1'), 'invalid-vvd'],
            ['vvd boom', withRec('vvd', boom), 'invalid-vvd'],
            ['polKey number', withRec('polKey', 5), 'invalid-polkey'], ['polKey two hashes', withRec('polKey', 'US#1#2'), 'invalid-polkey'], ['polKey bad seq', withRec('polKey', 'USNYC#x'), 'invalid-polkey'],
            ['polKey formula', withRec('polKey', '@x'), 'invalid-polkey'], ['polKey boom', withRec('polKey', boom), 'invalid-polkey'],
            ['kind missing', withRec('kind', undefined), 'invalid-kind'], ['kind note', withRec('kind', 'note'), 'invalid-kind'], ['kind boom', withRec('kind', boom), 'invalid-kind'],
            ['payload missing', withRec('payload', undefined), 'invalid-payload'], ['payload string', withRec('payload', '{"action":"cut","reason":"x"}'), 'invalid-payload'],
            ['payload array', withRec('payload', [1]), 'invalid-payload'], ['payload null', withRec('payload', null), 'invalid-payload'],
            ['action delete', withPay('action', 'delete'), 'invalid-action'], ['action missing', withPay('action', undefined), 'invalid-action'], ['action boom', withPay('action', boom), 'invalid-action'],
            ['reason blank', withPay('reason', '   '), 'invalid-reason'], ['reason number', withPay('reason', 5), 'invalid-reason'], ['reason boom', withPay('reason', boom), 'invalid-reason'],
            ['reason 1001', withPay('reason', 'r'.repeat(1001)), 'reason-too-long'],
            ['payload over 4000 as JSON', withPay('reason', '\u0001'.repeat(1000)), 'payload-too-large'],
            ['field missing', withT('field', undefined), 'invalid-field'], ['field cap', withT('field', 'cap'), 'invalid-field'],
            ['overall with a polKey', Object.assign({}, tgood, { payload: Object.assign({}, tgood.payload, { field: 'overall' }) }), 'invalid-polkey'],
            ['loading without a polKey', Object.assign({}, tgood, { polKey: '' }), 'invalid-polkey'],
            ['from string', withT('from', '1.2'), 'invalid-from'], ['from NaN', withT('from', NaN), 'invalid-from'], ['from Infinity', withT('from', Infinity), 'invalid-from'], ['from boom', withT('from', boom), 'invalid-from'],
            ['to missing', withT('to', undefined), 'invalid-to'], ['to 0', withT('to', 0), 'invalid-to'], ['to 0.01', withT('to', 0.01), 'invalid-to'], ['to negative', withT('to', -1.2), 'invalid-to'],
            ['to string', withT('to', '150%'), 'invalid-to'], ['to 1000.5', withT('to', 1000.5), 'invalid-to'], ['to NaN', withT('to', NaN), 'invalid-to'], ['to boxed', withT('to', new Number(1.2)), 'invalid-to'],
            ['status missing', withT('status', undefined), 'invalid-status'], ['status live', withT('status', 'live'), 'invalid-status'],
            ['author missing', withRec('author', undefined), 'invalid-author'], ['author no @', withRec('author', 'bob'), 'invalid-author'], ['author with space', withRec('author', 'b ob@x.com'), 'invalid-author'],
            ['author 255 chars', withRec('author', `${'a'.repeat(249)}@x.com`), 'invalid-author'],
            ['createdAt missing', withRec('createdAt', undefined), 'invalid-created-at'], ['createdAt Date object', withRec('createdAt', new Date(0)), 'invalid-created-at'],
            ['createdAt number', withRec('createdAt', 1700000000000), 'invalid-created-at'],
            ['supersedes number', withRec('supersedes', 3), 'invalid-supersedes'], ['supersedes itself', withRec('supersedes', 'd1'), 'invalid-supersedes'],
            ['supersedes bad id', withRec('supersedes', 'a b'), 'invalid-supersedes'], ['supersedes boom', withRec('supersedes', boom), 'invalid-supersedes'],
        ];
        t('normalize: each bad record gives its error code (the first that applies) and never throws; boxed strings and numbers, a Date and a throwing valueOf/toString are refused, not coerced',
            { rows: TABLE.length, bad: TABLE.map(([label, input, want]) => ({ label, want, got: safe(() => norm(input)) }))
                .filter(({ want, got }) => !(got && got.ok === false && got.error === want)).map(({ label, want, got }) => `${label}: ${JSON.stringify(got)} (want ${want})`) },
            { rows: TABLE.length, bad: [] });
        t('normalize: reason of exactly 1000 characters is kept; 1000 control characters (6000 as JSON) is too large; the first error wins (bad id AND bad vvd is invalid-id)',
            [norm(withPay('reason', 'r'.repeat(1000))).ok, norm(withPay('reason', '\n'.repeat(999) + 'x')).ok, norm(Object.assign({}, good, { id: '', vvd: '' })).error],
            [true, true, 'invalid-id']);
    }
    {
        // [createdAt, normalised or null]
        const ISO = [
            ['2026-10-30T14:05:09Z', '2026-10-30T14:05:09.000Z'], ['2026-10-30T14:05:09.123Z', '2026-10-30T14:05:09.123Z'], [' 2026-10-30T00:00:00Z ', '2026-10-30T00:00:00.000Z'],
            ['2028-02-29T23:59:59Z', '2028-02-29T23:59:59.000Z'], ['2000-02-29T00:00:00Z', '2000-02-29T00:00:00.000Z'],
            ['2026-02-29T00:00:00Z', null], ['1900-02-29T00:00:00Z', null], ['2026-13-01T00:00:00Z', null], ['2026-04-31T00:00:00Z', null], ['2026-10-30T24:00:00Z', null],
            ['2026-10-30T10:60:00Z', null], ['2026-10-30T10:00:60Z', null], ['2026-10-30T10:00:00+00:00', null], ['2026-10-30 10:00:00Z', null], ['2026-10-30T10:00:00', null],
            ['2026-10-30T10:00:00.12Z', null], ['2026-10-30T10:00:00.1234Z', null], ['2026-10-30', null], ['2026-10-30t10:00:00z', null], ['', null],
        ];
        t('normalize: createdAt is an ISO time as toISOString writes it (UTC Z, optional 3-digit milliseconds, real calendar day, 00-23 hours), stored with milliseconds',
            ISO.map(([v]) => { const n = norm(dec('d1', 'V100', '', 'cut', v)); return n.ok ? n.record.createdAt : n.error === 'invalid-created-at' ? null : n.error; }),
            ISO.map(([, want]) => want));
    }
    {
        const inherited = Object.create(dec('d1', 'V100', '', 'cut', AT(1)));
        const protoPayload = Object.assign(dec('d1', 'V100', '', 'cut', AT(1)), { payload: JSON.parse('{"__proto__":{"action":"cut","reason":"x"},"reason":"y"}') });
        const protoRecord = JSON.parse(JSON.stringify(dec('d1', 'V100', '', 'cut', AT(1))).replace('"id":"d1"', '"__proto__":{"id":"d1"}'));
        const nullProto = Object.assign(Object.create(null), dec('d1', 'V100', '', 'cut', AT(1)));
        const got = {
            getterOnVvd: safe(() => norm(getterBoom(dec('d1', 'V100', '', 'cut', AT(1)), 'vvd'))),
            getterOnPayload: safe(() => norm(getterBoom(dec('d1', 'V100', '', 'cut', AT(1)), 'payload'))),
            getterInsidePayload: safe(() => norm(Object.assign(dec('d1', 'V100', '', 'cut', AT(1)), { payload: getterBoom({ action: 'cut' }, 'reason') }))),
            proxy: safe(() => norm(proxyBoom)),
            proxyPayload: safe(() => norm(Object.assign(dec('d1', 'V100', '', 'cut', AT(1)), { payload: proxyBoom }))),
            inherited: safe(() => norm(inherited)),
            protoPayload: safe(() => norm(protoPayload)),
            protoRecord: safe(() => norm(protoRecord)),
            nullProto: safe(() => norm(nullProto).ok),
        };
        let polluted;
        try {
            Object.prototype.reason = 'from the prototype';
            Object.prototype.supersedes = 'evil';
            polluted = safe(() => norm({ id: 'd1', vvd: 'V100', kind: 'decision', payload: { action: 'cut' }, author: 'a@x.com', createdAt: AT(1) }));
        } finally {
            delete Object.prototype.reason;
            delete Object.prototype.supersedes;
        }
        got.polluted = polluted;
        t('normalize: hostile objects never throw: a throwing getter or proxy is invalid-record; inherited and "__proto__" keys are not read (own keys only); a polluted Object.prototype adds nothing; a null-prototype record is fine',
            got,
            { getterOnVvd: { ok: false, error: 'invalid-record' }, getterOnPayload: { ok: false, error: 'invalid-record' }, getterInsidePayload: { ok: false, error: 'invalid-record' },
                proxy: { ok: false, error: 'invalid-record' }, proxyPayload: { ok: false, error: 'invalid-record' }, inherited: { ok: false, error: 'invalid-id' },
                protoPayload: { ok: false, error: 'invalid-action' }, protoRecord: { ok: false, error: 'invalid-id' }, nullProto: true,
                polluted: { ok: false, error: 'invalid-reason' } });
    }

    // ================================================================================================
    // rows
    // ================================================================================================
    {
        const r = dec(' d1 ', 'v100', 'ussav#2', 'Roll', '2026-10-30T14:05:09Z', ' d0 ', 'Bob@X.com', ' ok ');
        const row = toRow(r);
        t('toRow: columns id, vvd, polKey, kind, payload JSON (fixed key order), author, createdAt, supersedes, all normalised',
            row, { ok: true, row: ['d1', 'V100', 'USSAV#2', 'decision', '{"action":"roll","reason":"ok"}', 'bob@x.com', '2026-10-30T14:05:09.000Z', 'd0'] });
        t('fromRow: a row toRow wrote reads back as the same normalised record (decision and threshold)',
            [fromRow(row.row), fromRow(toRow(thr('t1', 'V1X', 'USNYC', 'loading', 0, 1.25, 'proposed', AT(5))).row)],
            [norm(r), norm(thr('t1', 'V1X', 'USNYC', 'loading', 0, 1.25, 'proposed', AT(5)))]);
        t('toRow: an invalid record gives the same error as normalize, never a row',
            [toRow(null), toRow(dec('d1', 'VMS', '', 'cut', AT(1))), toRow(dec('d1', 'V100', '', 'nuke', AT(1)))],
            [{ ok: false, error: 'not-object' }, { ok: false, error: 'invalid-vvd' }, { ok: false, error: 'invalid-action' }]);
        const evilRow = ['d1', 'V100', '', 'decision', '{"action":"cut","reason":"x"}', 'a@x.com', AT(1), ''];
        Object.defineProperty(evilRow, 0, { get() { throw new Error('cell getter'); } });
        t('fromRow: bad rows give codes and never throw: not an array, bad or blank payload JSON, a short row, a throwing cell; number and boolean cells are text; object cells are blank',
            [
                fromRow(null), fromRow({ 0: 'd1' }), fromRow('d1,V100'),
                fromRow(['d1', 'V100', '', 'decision', '{not json', 'a@x.com', AT(1), '']),
                fromRow(['d1', 'V100', '', 'decision', '', 'a@x.com', AT(1), '']),
                fromRow(['d1', 'V100', '', 'decision', '"just text"', 'a@x.com', AT(1), '']),
                fromRow(['d1', 'V100']),
                fromRow(['d1', 'V100', '', 'decision', '{"action":"cut","reason":"x"}', 'a@x.com', AT(1)]).ok,
                safe(() => fromRow(evilRow)),
                fromRow([12345, 'V100', '', 'decision', '{"action":"cut","reason":"x"}', 'a@x.com', AT(1), '']).record.id,
                fromRow(['d1', 'V100', { toString: () => 'USNYC' }, 'decision', '{"action":"cut","reason":"x"}', 'a@x.com', AT(1), boom]).record.polKey,
            ],
            [
                { ok: false, error: 'not-row' }, { ok: false, error: 'not-row' }, { ok: false, error: 'not-row' },
                { ok: false, error: 'invalid-payload-json' }, { ok: false, error: 'invalid-payload-json' }, { ok: false, error: 'invalid-payload' },
                { ok: false, error: 'invalid-payload-json' }, true, { ok: false, error: 'invalid-record' }, '12345', '',
            ]);
    }

    // ================================================================================================
    // latestDecisionPerKey
    // ================================================================================================
    t('latest: per (vvd, polKey, kind) the newest createdAt wins; a tie goes to the larger id; keys are separate (the sailing "" vs a port, decision vs threshold); sorted by vvd, polKey, kind',
        latest([
            dec('a1', 'V200', '', 'monitor', AT(1)), dec('a2', 'V200', '', 'freeze', AT(3)), dec('a3', 'V200', '', 'cut', AT(2)),
            dec('b1', 'V100', 'USNYC', 'cut', AT(5)), dec('b2', 'V100', 'USNYC', 'roll', AT(5)),
            dec('c1', 'V100', '', 'monitor', AT(1)), thr('c2', 'V100', '', 'overall', null, 1.5, 'proposed', AT(9)),
        ]).map((r) => [r.vvd, r.polKey, r.kind, r.id]),
        [['V100', '', 'decision', 'c1'], ['V100', '', 'threshold', 'c2'], ['V100', 'USNYC', 'decision', 'b2'], ['V200', '', 'decision', 'a2']]);
    t('latest: a superseded record is never the latest, even when it is newer than the record that supersedes it; a chain a<-b<-c gives c',
        [
            ids(latest([dec('x1', 'V100', '', 'freeze', AT(5)), dec('x2', 'V100', '', 'cut', AT(1), 'x1')])),
            ids(latest([dec('c', 'V100', '', 'roll', AT(3), 'b'), dec('a', 'V100', '', 'freeze', AT(1)), dec('b', 'V100', '', 'cut', AT(2), 'a')])),
            ids(latest([dec('a', 'V100', '', 'freeze', AT(1)), dec('b', 'V100', '', 'cut', AT(2), 'a'), dec('z', 'V100', '', 'monitor', AT(0))])),
        ],
        [['x2'], ['c'], ['b']]);
    t('latest: a supersedes cycle ends (a<->b, a->b->c->a, and a long ring) and supersedes every record in it: the key falls back to its newest record outside the cycle, or has none',
        [
            ids(latest([dec('a', 'V100', '', 'freeze', AT(2), 'b'), dec('b', 'V100', '', 'cut', AT(3), 'a'), dec('o', 'V100', '', 'monitor', AT(1))])),
            ids(latest([dec('a', 'V100', '', 'freeze', AT(2), 'c'), dec('b', 'V100', '', 'cut', AT(3), 'a'), dec('c', 'V100', '', 'roll', AT(4), 'b')])),
            latest(Array.from({ length: 300 }, (_, i) => dec(`r${i}`, 'V100', '', 'cut', AT(1, i % 60), `r${(i + 1) % 300}`))).length,
        ],
        [['o'], [], 0]);
    t('latest: a cross-key correction (a record on V200 superseding one on V100) removes the target from its own key, which falls back to its older record; ' +
      'a supersedes naming an unknown id, or an invalid record, has no effect',
        [
            latest([dec('old', 'V100', '', 'monitor', AT(1)), dec('wrong', 'V100', '', 'cut', AT(2)), dec('right', 'V200', '', 'cut', AT(3), 'wrong')]).map((r) => [r.vvd, r.id]),
            ids(latest([dec('a', 'V100', '', 'cut', AT(2)), dec('b', 'V100', '', 'roll', AT(1), 'ghost'), dec('bad', 'VMS', '', 'roll', AT(3), 'a')])),
        ],
        [[['V100', 'old'], ['V200', 'right']], ['a']]);
    t('latest: two records with one id count once (the newer; on a tie the larger row text), and a later record superseding that id still supersedes it',
        [
            latest([dec('d', 'V100', '', 'cut', AT(1)), dec('d', 'V100', '', 'roll', AT(2))]).map((r) => r.payload.action),
            latest([dec('d', 'V100', '', 'roll', AT(2)), dec('d', 'V100', '', 'cut', AT(1))]).map((r) => r.payload.action),
            latest([dec('d', 'V100', '', 'cut', AT(1)), dec('d', 'V100', '', 'roll', AT(1))]).map((r) => r.payload.action),
            latest([dec('d', 'V100', '', 'roll', AT(1)), dec('d', 'V100', '', 'cut', AT(1))]).map((r) => r.payload.action),
            ids(latest([dec('d', 'V100', '', 'cut', AT(1)), dec('d', 'V100', '', 'roll', AT(2)), dec('e', 'V100', '', 'freeze', AT(0), 'd')])),
        ],
        [['roll'], ['roll'], ['roll'], ['roll'], ['e']]);
    {
        const recA = dec('a', 'V100', '', 'cut', AT(1));
        const recB = dec('b', 'v100', '', 'roll', AT(2));
        const input = [recA, null, 7, 'x', proxyBoom, getterBoom(dec('g', 'V100', '', 'cut', AT(9)), 'id'), recB];
        const before = JSON.stringify([recA, recB]);
        const first = BFShared.latestDecisionPerKey(input);
        first[0].payload.action = 'changed';
        first[0].id = 'changed';
        t('latest: non-records in the list are skipped (null, numbers, strings, a throwing proxy, a throwing getter); a non-array is []; the input is not changed and the answer is a copy',
            {
                ids: ids(latest(input)), action: latest(input)[0].payload.action,
                nonArrays: [latest(null), latest(undefined), latest({ 0: dec('a', 'V100', '', 'cut', AT(1)), length: 1 }), latest('ab'), latest(proxyBoom)],
                unchanged: JSON.stringify([recA, recB]) === before && input.length === 7,
            },
            { ids: ['b'], action: 'roll', nonArrays: [[], [], [], [], []], unchanged: true });
    }

    // ================================================================================================
    // decisionHistoryFor
    // ================================================================================================
    {
        const store = [
            dec('h1', 'V100', 'USNYC', 'monitor', AT(1)),
            dec('h2', 'V100', 'USNYC', 'freeze', AT(2), 'h1'),
            dec('h3', 'V100', 'USNYC', 'cut', AT(3), 'h2'),
            dec('x1', 'V100', 'USSAV', 'roll', AT(4), 'h3'),   // a cross-key correction joins the chain
            dec('y1', 'V100', 'USSAV', 'monitor', AT(0)),      // same other key, not joined: left out
            dec('z1', 'V300', '', 'cut', AT(9)),               // unrelated
        ];
        t('history: the key\'s records plus the records joined through supersedes in either direction (a cross-key correction), newest first, each with supersededBy; unrelated records are left out',
            history(store, { vvd: ' v100 ', polKey: 'usnyc', kind: 'Decision' }).map((r) => [r.id, r.polKey, r.supersededBy]),
            [['x1', 'USSAV', ''], ['h3', 'USNYC', 'x1'], ['h2', 'USNYC', 'h3'], ['h1', 'USNYC', 'h2']]);
        t('history: two corrections of one record both appear and supersededBy names the newer; a cycle ends; the sailing key "" is separate from a port key; seeded from the correcting key (USSAV) the chain is followed back up to h1',
            [
                history([dec('a', 'V100', '', 'cut', AT(1)), dec('b', 'V100', '', 'roll', AT(2), 'a'), dec('c', 'V100', '', 'freeze', AT(3), 'a')], { vvd: 'V100', kind: 'decision' })
                    .map((r) => [r.id, r.supersededBy]),
                history([dec('a', 'V100', '', 'cut', AT(1), 'b'), dec('b', 'V100', '', 'roll', AT(2), 'a')], { vvd: 'V100', polKey: null, kind: 'decision' }).map((r) => [r.id, r.supersededBy]),
                history(store, { vvd: 'V100', polKey: '', kind: 'decision' }),
                history(store, { vvd: 'V100', polKey: 'USSAV', kind: 'decision' }).map((r) => r.id),
            ],
            [[['c', ''], ['b', ''], ['a', 'c']], [['b', 'a'], ['a', 'b']], [], ['x1', 'h3', 'h2', 'h1', 'y1']]);
        t('history: a key that is not valid gives [] (not an object, VMS or blank vvd, a non-string polKey, an unknown kind, a throwing getter), and nothing throws',
            [history(store, null), history(store, 'V100'), history(store, { vvd: 'VMS', kind: 'decision' }), history(store, { vvd: '', kind: 'decision' }),
                history(store, { vvd: 'V100', polKey: 5, kind: 'decision' }), history(store, { vvd: 'V100', kind: 'note' }),
                safe(() => history(store, getterBoom({ vvd: 'V100', kind: 'decision' }, 'polKey'))), history(null, { vvd: 'V100', kind: 'decision' }), safe(() => history(store, proxyBoom))],
            [[], [], [], [], [], [], [], [], []]);
    }

    // ================================================================================================
    // thresholdLiveInFeed
    // ================================================================================================
    {
        const LIVE = [
            [[1.5, 1.5], true], [[1.5, '150%'], true], [[1.5, ' 1.5 '], true], [[1.5, 1.5 + 5e-10], true], [[1.5, 1.5 + 2e-9], false], [[1.5, 1.2], false],
            [[1.5, 0], false], [[1.5, 0.01], false], [[1.5, ''], false], [[1.5, null], false], [[1.5, undefined], false], [[1.5, NaN], false],
            [[0, 0], false], [[0.01, 0.01], false], [[null, null], false], [['', ''], false], [[1.5, boom], false], [[boom, 1.5], false], [[new Number(1.5), 1.5], false],
        ];
        t('thresholdLiveInFeed: true only when both are set thresholds (thresholdValue: 0, 0.01, blank, null are not set) within 1e-9; never throws',
            LIVE.map(([[a, b]]) => safe(() => live(a, b))), LIVE.map(([, want]) => want));
    }

    // ================================================================================================
    // thresholdLog
    // ================================================================================================
    {
        // P1: overall threshold of V100 proposed 1.5 (from 1.2) at 01:00 by p@, approved at 02:00 by k@. Feed now shows 1.5 -> live.
        // P2: loading threshold of V100 at USNYC#2 proposed 1.1 at 03:00; still proposed; feed shows 1.0 at USNYC -> not live.
        // P3: loading of V200 at USSAV proposed then rejected at 05:00.
        // P4: overall of V300 approved at 06:00 but the feed has V300 at 0 (not set) -> approved, not live.
        // A decision record (ignored) and an invalid threshold record (skipped) are mixed in.
        const STORE = [
            thr('p1', 'V100', '', 'overall', 1.2, 1.5, 'proposed', AT(1)),
            thr('p1b', 'V100', '', 'overall', 1.2, 1.5, 'approved', AT(2), 'p1', 'k@x.com', 'ok by Kevin'),
            thr('p2', 'V100', 'USNYC#2', 'loading', 1.0, 1.1, 'proposed', AT(3)),
            thr('p3', 'V200', 'USSAV', 'loading', null, 1.3, 'proposed', AT(4)),
            thr('p3b', 'V200', 'USSAV', 'loading', null, 1.3, 'rejected', AT(5), 'p3', 'k@x.com', 'no'),
            thr('p4', 'V300', '', 'overall', null, 1.4, 'approved', AT(6)),
            dec('d1', 'V100', '', 'cut', AT(7)),
            thr('bad', 'V100', '', 'loading', null, 1.4, 'approved', AT(8)),
        ];
        const ROWS = [
            { vvd: 'V100', pol: 'USNYC', lane: 'L1', overall: '150%', loading: 1.1 },
            { vvd: 'V100', pol: 'USSAV', lane: 'L1', overall: 1.5, loading: 1.1 },
            { vvd: 'V200', pol: 'USSAV', lane: 'L2', overall: 1.2, loading: 1.3 },
            { vvd: 'V300', pol: 'USNYC', lane: 'L3', overall: 0, loading: 1.2 },
        ];
        const full = tlog(STORE, ROWS);
        t('thresholdLog: one entry per proposal (supersedes chains joined), the latest record\'s values and status, the first record\'s proposer, newest update first',
            full.map((e) => [e.id, e.latestId, e.vvd, e.polKey, e.field, e.from, e.to, e.status, e.proposedBy, e.proposedAt, e.updatedBy, e.updatedAt, e.records, e.reason]),
            [
                ['p4', 'p4', 'V300', '', 'overall', null, 1.4, 'approved', 'p@x.com', AT(6), 'p@x.com', AT(6), 1, 'lane needs it'],
                ['p3', 'p3b', 'V200', 'USSAV', 'loading', null, 1.3, 'rejected', 'p@x.com', AT(4), 'k@x.com', AT(5), 2, 'no'],
                ['p2', 'p2', 'V100', 'USNYC#2', 'loading', 1.0, 1.1, 'proposed', 'p@x.com', AT(3), 'p@x.com', AT(3), 1, 'lane needs it'],
                ['p1', 'p1b', 'V100', '', 'overall', 1.2, 1.5, 'approved', 'p@x.com', AT(1), 'k@x.com', AT(2), 2, 'ok by Kevin'],
            ]);
        t('thresholdLog: current comes from the day\'s rows (the sailing\'s overall, the port part of polKey\'s loading); stage is live only for approved AND in the feed; rejected stays rejected even when the feed matches',
            full.map((e) => [e.id, e.current, e.liveInFeed, e.stage]),
            [['p4', null, false, 'approved'], ['p3', 1.3, true, 'rejected'], ['p2', 1.1, true, 'proposed'], ['p1', 1.5, true, 'live']]);
        t('thresholdLog: without rows (not an array) current and liveInFeed are null and an approved proposal stays "approved"; a VVD missing from the rows has current null',
            [tlog(STORE, null).map((e) => [e.id, e.current, e.liveInFeed, e.stage]), tlog(STORE, [{ vvd: 'V999', pol: 'X', overall: 1.5, loading: 1.5 }]).map((e) => e.current)],
            [[['p4', null, null, 'approved'], ['p3', null, null, 'rejected'], ['p2', null, null, 'proposed'], ['p1', null, null, 'approved']], [null, null, null, null]]);
        t('thresholdLog: since keeps proposals updated at or after it (milliseconds optional); an invalid since keeps them all',
            [ids(tlog(STORE, ROWS, '2026-10-30T05:00:00Z')), ids(tlog(STORE, ROWS, AT(5, 1))), ids(tlog(STORE, ROWS, 'yesterday')), ids(tlog(STORE, ROWS, boom)), ids(tlog(STORE, ROWS, 12))],
            [['p4', 'p3'], ['p4'], ['p4', 'p3', 'p2', 'p1'], ['p4', 'p3', 'p2', 'p1'], ['p4', 'p3', 'p2', 'p1']]);
        t('thresholdLog: a cycle is one proposal and ends (latest = its newest record); a branch (two records superseding one) is one proposal whose latest is the newest unsuperseded; a newer record superseded by an older one is not the latest; bad input gives []',
            [
                tlog([thr('a', 'V100', '', 'overall', null, 1.5, 'proposed', AT(1), 'b'), thr('b', 'V100', '', 'overall', null, 1.5, 'approved', AT(2), 'a')]).map((e) => [e.id, e.latestId, e.records]),
                tlog([thr('a', 'V100', '', 'overall', null, 1.5, 'proposed', AT(3)), thr('b', 'V100', '', 'overall', null, 1.5, 'rejected', AT(2), 'a')]).map((e) => [e.id, e.latestId, e.status]),
                tlog([thr('a', 'V100', '', 'overall', null, 1.5, 'proposed', AT(1)), thr('b', 'V100', '', 'overall', null, 1.5, 'approved', AT(3), 'a'),
                    thr('c', 'V100', '', 'overall', null, 1.5, 'rejected', AT(2), 'a')]).map((e) => [e.id, e.latestId, e.status, e.records]),
                tlog(null), tlog([null, 5, proxyBoom]), safe(() => tlog(proxyBoom, proxyBoom, proxyBoom)), tlog([dec('d1', 'V100', '', 'cut', AT(1))]),
            ],
            [[['a', 'b', 2]], [['b', 'b', 'rejected']], [['a', 'b', 'approved', 3]], [], [], [], []]);
    }

    // ================================================================================================
    // Order independence: every permutation of a seven-record store gives the same answers
    // ================================================================================================
    {
        const STORE7 = [
            dec('a', 'V100', '', 'monitor', AT(1)), dec('b', 'V100', '', 'freeze', AT(2), 'a'), dec('c', 'V100', '', 'cut', AT(2)),
            dec('d', 'V100', 'USNYC', 'roll', AT(3)), dec('d', 'V100', 'USNYC', 'cut', AT(3)),
            thr('t1', 'V100', '', 'overall', null, 1.5, 'proposed', AT(1)), thr('t2', 'V100', '', 'overall', null, 1.5, 'approved', AT(4), 't1'),
        ];
        const ref = JSON.stringify([latest(STORE7), history(STORE7, { vvd: 'V100', kind: 'decision' }), tlog(STORE7, [{ vvd: 'V100', pol: 'USNYC', overall: 1.5, loading: 1 }])]);
        const perms = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms(arr.slice(0, i).concat(arr.slice(i + 1))).map((p) => [x].concat(p))));
        const all = perms(STORE7);
        const differing = all.filter((p) => JSON.stringify([latest(p), history(p, { vvd: 'V100', kind: 'decision' }), tlog(p, [{ vvd: 'V100', pol: 'USNYC', overall: 1.5, loading: 1 }])]) !== ref).length;
        t('order independence: all 5040 orders of a store with a tie, a supersedes, a duplicate id and a threshold chain give the same latest, history and log',
            { orders: all.length, differing, latestIds: ids(JSON.parse(ref)[0]) }, { orders: 5040, differing: 0, latestIds: ['c', 't2', 'd'] });
        t('order independence: the duplicate id "d" (same time) resolves to the larger row text in every order, not to whichever came last',
            JSON.parse(ref)[0].find((r) => r.id === 'd').payload.action, 'roll');
    }

    // ================================================================================================
    // Purity
    // ================================================================================================
    {
        const Fn = BFShared.thresholdLog.constructor;
        const realm = new Fn('return this')();
        const S = [dec('a', 'V100', '', 'cut', AT(1)), dec('b', 'V100', '', 'roll', AT(2), 'a'), thr('t', 'V100', '', 'overall', 1.2, 1.5, 'approved', AT(3))];
        const battery = () => JSON.stringify([norm(S[0]), toRow(S[1]), fromRow(toRow(S[2]).row), latest(S), history(S, { vvd: 'V100', kind: 'decision' }),
            tlog(S, [{ vvd: 'V100', pol: 'P', overall: 1.5, loading: 1 }], AT(0)), live(1.5, '150%'), plain(BFShared.decisionLimits())]);
        const normal = battery();
        const realDate = realm.Date;
        const realRandom = realm.Math.random;
        const stop = () => { throw new Error('the shared code read the clock or the random source'); };
        let sabotaged = null;
        let liveCheck = null;
        try {
            realm.Date = function () { stop(); };
            realm.Date.now = stop;
            realm.Math.random = stop;
            liveCheck = ['new Date()', 'Date.now()', 'Math.random()'].map((src) => { try { new Fn(`return ${src}`)(); return 'did not throw'; } catch (e) { return 'threw'; } });
            sabotaged = safe(battery);
        } finally {
            realm.Date = realDate;
            realm.Math.random = realRandom;
        }
        t('purity: with the clock and the random source throwing (and shown to throw), every function gives exactly the answers it gave normally',
            { liveCheck, same: sabotaged === normal }, { liveCheck: ['threw', 'threw', 'threw'], same: true });
        const source = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', '65_decisions.js'), 'utf8');
        const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
        const found = ['Date', 'Math\\.random', 'performance', 'process', 'window', 'document', 'setTimeout', 'setInterval', 'eval', 'Function', 'require', 'Intl', 'toLocale[A-Za-z]*', 'getTime']
            .filter((w) => new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`).test(code));
        t('purity: the code of shared/65_decisions.js (comment lines removed) names no Date, Math.random, performance, process, window, document, timer, eval, Function, require, Intl, locale method or getTime',
            found, []);
    }

    // ================================================================================================
    // Review fixes (B7 on PR #287, 2026-10-31)
    // ================================================================================================
    {
        // decisionTime: the one ISO validator the server's getThresholdLog(since) uses (review item 5).
        const T = [['2026-10-30T14:05:09Z', '2026-10-30T14:05:09.000Z'], ['2026-10-30T14:05:09.5Z', null], ['2026-02-31T00:00:00Z', null], ['2026-02-29T00:00:00Z', null],
            ['2028-02-29T00:00:00.123Z', '2028-02-29T00:00:00.123Z'], [' 2026-10-30T00:00:00Z ', '2026-10-30T00:00:00.000Z'], ['2026-10-30', null], [12, null], [null, null], [boom, null], [proxyBoom, null]];
        t('review 5, decisionTime: a real ISO time is normalised with milliseconds; an impossible calendar day (2026-02-31), a date alone, a number and hostile values are null; never throws',
            T.map(([v]) => safe(() => BFShared.decisionTime(v))), T.map(([, w]) => w));
        t('review 5, thresholdLog: a since on an impossible day keeps every proposal (the server refuses it first; see check_decisions_logic.js)',
            ids(tlog([thr('t1', 'V100', '', 'overall', null, 1.5, 'proposed', AT(1))], null, '2026-02-31T00:00:00Z')), ['t1']);
    }
    {
        // Review item 3: every Object.prototype name (and the name without its first character, which the old 'i' prefix turned
        // back into the name) as an id, as a supersedes, and '__proto__' / 'constructor' in rows.
        const Fn = BFShared.thresholdLog.constructor;
        const realmProto = new Fn('return Object.prototype')();
        const names = Array.from(new Set(Object.getOwnPropertyNames(realmProto).concat(Object.getOwnPropertyNames(Object.prototype), ['__proto__', 'constructor'])));
        const idOk = (s) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s);
        const protoIds = Array.from(new Set(names.flatMap((n) => [n, n.slice(1)]).filter(idOk))).sort();
        const vvdFor = (i) => `PV${String(i).padStart(4, '0')}`;
        const recs = protoIds.map((id, i) => dec(id, vvdFor(i), '', 'cut', AT(1)));
        t('review 3, ids named like Object.prototype members (' + protoIds.length + ' of them, e.g. sPrototypeOf, constructor, toString) are ordinary ids: latest keeps one per VVD and history finds each',
            { latest: ids(latest(recs)).sort(), history: protoIds.map((id, i) => ids(history(recs, { vvd: vvdFor(i), kind: 'decision' }))[0]) },
            { latest: protoIds, history: protoIds });
        const chain = protoIds.map((id, i) => dec(`c${i}`, 'V100', '', 'roll', AT(2, i % 60), id));
        t('review 3, a supersedes naming such an id supersedes that record (and only it); one naming such an id that does not exist changes nothing',
            [latest(recs.concat(chain)).filter((r) => r.vvd !== 'V100').length, ids(latest([dec('a', 'V100', '', 'cut', AT(1)), dec('b', 'V200', '', 'roll', AT(2), 'sPrototypeOf')]))],
            [0, ['a', 'b']]);
        const good = thr('t1', 'V100', '', 'overall', null, 1.2, 'proposed', AT(1));
        const badRows = names.filter(idOk).map((n, i) => thr(`x${i}`, 'V900', '', 'overall', null, 1.3, 'proposed', AT(2), n))
            .concat(protoIds.map((n, i) => thr(`y${i}`, 'V901', '', 'overall', null, 1.3, 'proposed', AT(3), n.length > 1 ? n.slice(1) : n)).filter((r) => idOk(r.supersedes)));
        t('review 3, a row whose supersedes is such a name never empties the answer: the thresholdLog, the history and latest of the other records are unchanged',
            {
                log: tlog([good].concat(badRows), null).filter((e) => e.vvd === 'V100').map((e) => e.id),
                logSize: tlog([good].concat(badRows), null).length,
                history: ids(history([dec('d1', 'V100', '', 'cut', AT(1))].concat(badRows.map((r) => Object.assign({}, r, { kind: 'decision', payload: { action: 'cut', reason: 'x' } }))), { vvd: 'V100', kind: 'decision' })),
            },
            { log: ['t1'], logSize: 1 + badRows.length, history: ['d1'] });
        t('review 3, rows with "__proto__" or "constructor" in the id, vvd, polKey or supersedes cell are each skipped or read on their own; the good row always comes back',
            [
                fromRow(['__proto__', 'V100', '', 'decision', '{"action":"cut","reason":"x"}', 'a@x.com', AT(1), '']).error,
                fromRow(['constructor', 'V100', '', 'decision', '{"action":"cut","reason":"x"}', 'a@x.com', AT(1), '__proto__']).error,
                ids(latest([dec('constructor', 'V100', '', 'cut', AT(1)), dec('g', 'V200', '', 'cut', AT(1), 'constructor'), dec('h', '__proto__', '', 'cut', AT(1))])),
            ],
            ['invalid-id', 'invalid-supersedes', ['g']]);
    }
    {
        // Review item 4: D4 port keys are canonical (makePortKey).
        t('review 4, a port key is canonical: usnyc#02 and USNYC#2 are one key; #0000 is #0; a bare # or a bad sequence is refused; a plain port is kept',
            [norm(dec('d1', 'V100', 'usnyc#02', 'cut', AT(1))).record.polKey, norm(dec('d1', 'V100', ' USNYC#0000 ', 'cut', AT(1))).record.polKey,
                norm(dec('d1', 'V100', 'USNYC#', 'cut', AT(1))).error, norm(dec('d1', 'V100', 'USNYC#-1', 'cut', AT(1))).error, norm(dec('d1', 'V100', 'ussav', 'cut', AT(1))).record.polKey,
                ids(latest([dec('a', 'V100', 'USNYC#2', 'cut', AT(1)), dec('b', 'V100', 'usnyc#002', 'roll', AT(2))])),
                ids(history([dec('a', 'V100', 'USNYC#2', 'cut', AT(1)), dec('b', 'V100', 'usnyc#002', 'roll', AT(2))], { vvd: 'V100', polKey: 'USNYC#02', kind: 'decision' }))],
            ['USNYC#2', 'USNYC#0', 'invalid-polkey', 'invalid-polkey', 'USSAV', ['b'], ['b', 'a']]);
    }
    {
        // Review item 6: from is bounded like to.
        const tf = (from) => { const n = norm(thr('t1', 'V100', '', 'overall', from, 1.2, 'proposed', AT(1))); return n.ok ? n.record.payload.from : n.error; };
        t('review 6, from: null, 0 and 0.01 are null (not set); a set value must be above 0 and at most 1000 (-5, -0.5, 1000.5 and 1e300 are invalid-from); 1000 and 0.02 are kept',
            [null, 0, 0.01, -5, -0.5, 1000.5, 1e300, 1000, 0.02, 1.2].map(tf),
            [null, null, null, 'invalid-from', 'invalid-from', 'invalid-from', 'invalid-from', 1000, 0.02, 1.2]);
    }
    {
        // Review item 1: an approval decides a value, it never changes it.
        const P = thr('p', 'V100', '', 'overall', 1.0, 1.2, 'proposed', AT(1));
        t('review 1, thresholdLog value rule: an approval carrying another to (9.99) does not move the proposal\'s 1.2; a re-proposal (a newer "proposed" in the chain) does; a chain with no proposed record uses its oldest record',
            [
                tlog([P, thr('a', 'V100', '', 'overall', 5, 9.99, 'approved', AT(2), 'p', 'k@x.com')]).map((e) => [e.from, e.to, e.status, e.latestId]),
                tlog([P, thr('r', 'V100', '', 'overall', 1.0, 1.3, 'proposed', AT(2), 'p'), thr('a', 'V100', '', 'overall', 1.0, 1.3, 'approved', AT(3), 'r')]).map((e) => [e.from, e.to, e.status]),
                tlog([thr('a', 'V100', '', 'overall', null, 1.4, 'approved', AT(1)), thr('b', 'V100', '', 'overall', null, 7, 'rejected', AT(2), 'a')]).map((e) => [e.to, e.status]),
            ],
            [[[1, 1.2, 'approved', 'a']], [[1, 1.3, 'approved']], [[1.4, 'rejected']]]);
    }
    {
        // Review item 7: a call's own loading threshold when the rows carry the calling-port sequence.
        const ROWS = [
            { vvd: 'V100', pol: 'USNYC', seq: '1', overall: 1.5, loading: 1.0 },
            { vvd: 'V100', pol: 'USNYC', seq: '3', overall: 1.5, loading: 1.2 },
            { vvd: 'V100', pol: 'USSAV', seq: '2', overall: 1.5, loading: 0 },
        ];
        const cur = (polKey, to) => tlog([thr('t', 'V100', polKey, 'loading', null, to, 'approved', AT(1))], ROWS).map((e) => [e.current, e.stage])[0];
        t('review 7, current loading: USNYC#3 reads its own call (1.2, live), USNYC#1 its own (1.0); a call the rows do not have (#9) and a plain USNYC use the port\'s first set value (1.0); a call whose own value is not set is null, not the port\'s',
            [cur('USNYC#3', 1.2), cur('USNYC#01', 1.0), cur('USNYC#9', 1.0), cur('USNYC', 1.0), cur('USSAV#2', 1.1), cur('USNYC#3', 1.0)],
            [[1.2, 'live'], [1, 'live'], [1, 'live'], [1, 'live'], [null, 'approved'], [1.2, 'approved']]);
    }

    // ================================================================================================
    // Re-review fixes (B7 on 5fe3e21, 2026-10-31)
    // ================================================================================================
    t('re-review 1, value rule on a fork: P 1.2 @10:00, Q re-proposes 1.5 superseding P @12:00, A approves P @13:00 -> the entry is A\'s approval of 1.2 (walked back from A), not Q\'s 1.5; a straight chain P <- Q <- A approves 1.5',
        [
            tlog([thr('P', 'V100', '', 'overall', null, 1.2, 'proposed', AT(10)), thr('Q', 'V100', '', 'overall', null, 1.5, 'proposed', AT(12), 'P'),
                thr('A', 'V100', '', 'overall', null, 1.2, 'approved', AT(13), 'P', 'k@x.com')]).map((e) => [e.latestId, e.to, e.status]),
            tlog([thr('P', 'V100', '', 'overall', null, 1.2, 'proposed', AT(10)), thr('Q', 'V100', '', 'overall', null, 1.5, 'proposed', AT(12), 'P'),
                thr('A', 'V100', '', 'overall', null, 1.5, 'approved', AT(13), 'Q', 'k@x.com')]).map((e) => [e.latestId, e.to, e.status]),
        ],
        [[['A', 1.2, 'approved']], [['A', 1.5, 'approved']]]);
    t('re-review 2, current loading of a call when the row\'s vvd is a number (as findMissingThresholds accepts it): the call\'s own row is found',
        tlog([thr('t', '1234', 'USNYC#3', 'loading', null, 1.2, 'approved', AT(1))],
            [{ vvd: 1234, pol: 'USNYC', seq: 1, overall: 1.5, loading: 1.0 }, { vvd: 1234, pol: 'USNYC', seq: 3, overall: 1.5, loading: 1.2 }]).map((e) => [e.current, e.stage]),
        [[1.2, 'live']]);
    t('re-review 3, a call whose own rows have no set loading threshold is null even when another call at the same port has one (never the port\'s value)',
        tlog([thr('t', 'V100', 'USNYC#5', 'loading', null, 1.0, 'approved', AT(1))],
            [{ vvd: 'V100', pol: 'USNYC', seq: '1', overall: 1.5, loading: 1.0 }, { vvd: 'V100', pol: 'USNYC', seq: '5', overall: 1.5, loading: '0.01' }]).map((e) => [e.current, e.liveInFeed, e.stage]),
        [[null, false, 'approved']]);
    t('re-review 4, a port key is made canonical before its length is checked: USNYC#00002 is USNYC#2; 20 digits of zeros then 7 is #7; a canonical sequence over 4 digits, 21 digits, or two hashes are refused',
        ['USNYC#00002', `usnyc#${'0'.repeat(19)}7`, 'USNYC#12345', `USNYC#${'0'.repeat(20)}7`, 'US#1#2']
            .map((k) => { const n = norm(dec('d1', 'V100', k, 'cut', AT(1))); return n.ok ? n.record.polKey : n.error; }),
        ['USNYC#2', 'USNYC#7', 'invalid-polkey', 'invalid-polkey', 'invalid-polkey']);

    // ================================================================================================
    // slice 2b-2 (decision card, OQ1): the optional rollTo and seen of a decision (additive; nothing above changes)
    // ================================================================================================
    const decP = (payload) => norm({ id: 'd1', vvd: 'V100', polKey: 'USSAV', kind: 'decision', payload, author: 'a@x.com', createdAt: AT(1), supersedes: '' });
    t('2b-2: a decision without rollTo and seen is stored exactly as before (action, reason only); null, undefined and blank rollTo and a null seen are left out',
        [decP({ action: 'cut', reason: 'r' }), decP({ action: 'cut', reason: 'r', rollTo: null, seen: null }), decP({ action: 'cut', reason: 'r', rollTo: '   ', seen: undefined })]
            .map((x) => JSON.stringify(x.record.payload)),
        ['{"action":"cut","reason":"r"}', '{"action":"cut","reason":"r"}', '{"action":"cut","reason":"r"}']);
    t('2b-2: rollTo is trimmed and upper-cased after reason; VMS, a number, an object and a VVD outside the pattern are invalid-roll-to',
        [decP({ action: 'roll', reason: 'r', rollTo: ' cikt0015w ' }), decP({ action: 'roll', reason: 'r', rollTo: 'VMS' }), decP({ action: 'roll', reason: 'r', rollTo: 15 }),
            decP({ action: 'roll', reason: 'r', rollTo: { v: 1 } }), decP({ action: 'roll', reason: 'r', rollTo: 'X'.repeat(41) }), decP({ action: 'roll', reason: 'r', rollTo: 'A' })]
            .map((x) => x.ok ? JSON.stringify(x.record.payload) : x.error),
        ['{"action":"roll","reason":"r","rollTo":"CIKT0015W"}', 'invalid-roll-to', 'invalid-roll-to', 'invalid-roll-to', 'invalid-roll-to', 'invalid-roll-to']);
    t('2b-2: seen keeps only its known keys in a fixed order (numbers or null, two text keys trimmed); unknown keys are dropped; an object with none is left out',
        [decP({ action: 'monitor', reason: 'r', seen: { dataAsOf: ' 2026-09-01 ', extra: 1, curLaden: 1640, ceiling: null, epAsOf: null, threshold: 1.2, fallDownPct: 15, declaredFinal: 70 } }),
            decP({ action: 'monitor', reason: 'r', seen: { other: 5 } })].map((x) => JSON.stringify(x.record.payload)),
        ['{"action":"monitor","reason":"r","seen":{"curLaden":1640,"ceiling":null,"threshold":1.2,"declaredFinal":70,"fallDownPct":15,"epAsOf":null,"dataAsOf":"2026-09-01"}}',
            '{"action":"monitor","reason":"r"}']);
    t('2b-2: seen that is not a plain object, a string number, NaN, Infinity, a numeric text key or a text over 40 characters is invalid-seen; the reason is checked first',
        [decP({ action: 'cut', reason: 'r', seen: 'x' }), decP({ action: 'cut', reason: 'r', seen: [1] }), decP({ action: 'cut', reason: 'r', seen: { curLaden: '5' } }),
            decP({ action: 'cut', reason: 'r', seen: { curLaden: NaN } }), decP({ action: 'cut', reason: 'r', seen: { ceiling: Infinity } }), decP({ action: 'cut', reason: 'r', seen: { epAsOf: 5 } }),
            decP({ action: 'cut', reason: 'r', seen: { dataAsOf: 'x'.repeat(41) } }), decP({ action: 'cut', reason: ' ', seen: 'x' })].map((x) => x.ok ? 'ok' : x.error),
        ['invalid-seen', 'invalid-seen', 'invalid-seen', 'invalid-seen', 'invalid-seen', 'invalid-seen', 'invalid-seen', 'invalid-reason']);
    t('2b-2: rollTo and seen survive the row round trip; a 1000-character reason with rollTo and both 40-character texts still fits the payload limit; a threshold record ignores them',
        [(() => { const n = decP({ action: 'roll', reason: 'r', rollTo: 'V200', seen: { curLaden: 1 } }); const back = fromRow(toRow(n.record).row); return JSON.stringify(back.record.payload); })(),
            decP({ action: 'roll', reason: 'r'.repeat(1000), rollTo: 'V200', seen: { dataAsOf: 'x'.repeat(40), epAsOf: 'y'.repeat(40) }, extra: 'z'.repeat(2900) }).ok,
            JSON.stringify(norm(Object.assign(thr('t1', 'V100', '', 'overall', null, 1.5, 'proposed', AT(1)), {})).record.payload),
            JSON.stringify(norm({ id: 't2', vvd: 'V100', polKey: '', kind: 'threshold', payload: { field: 'overall', from: null, to: 1.5, reason: 'r', status: 'proposed', rollTo: 'V200', seen: { curLaden: 1 } },
                author: 'a@x.com', createdAt: AT(1), supersedes: '' }).record.payload)],
        ['{"action":"roll","reason":"r","rollTo":"V200","seen":{"curLaden":1}}', true,
            '{"field":"overall","from":null,"to":1.5,"reason":"lane needs it","status":"proposed"}', '{"field":"overall","from":null,"to":1.5,"reason":"r","status":"proposed"}']);
    t('2b-2 review: rollTo belongs to a Roll only: on Monitor, Freeze and Cut it is ignored, even a value that is not a VVD ("VMS", 5), and never stored',
        [decP({ action: 'monitor', reason: 'r', rollTo: 'V200' }), decP({ action: 'freeze', reason: 'r', rollTo: 'VMS' }), decP({ action: 'cut', reason: 'r', rollTo: 5 })].map((x) => x.ok ? JSON.stringify(x.record.payload) : x.error),
        ['{"action":"monitor","reason":"r"}', '{"action":"freeze","reason":"r"}', '{"action":"cut","reason":"r"}']);
    t('2b-2 review: seen keeps bookingSailing (the sailing\'s booking total) after the port\'s curLaden, ceiling and threshold',
        JSON.stringify(decP({ action: 'monitor', reason: 'r', seen: { dataAsOf: 'x', bookingSailing: 1777, threshold: 0.5, ceiling: 647.5, curLaden: 781 } }).record.payload.seen),
        '{"curLaden":781,"ceiling":647.5,"threshold":0.5,"bookingSailing":1777,"dataAsOf":"x"}');
};

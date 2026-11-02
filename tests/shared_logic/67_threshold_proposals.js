'use strict';
/**
 * Behaviour tests for threshold proposals (shared/67_threshold_proposals.js, D84 slice 2b-3, R-5; Q3 DECIDED 2026-10-30: the lane's
 * SPC lead plus Kevin approve): parseThresholdApprovers, thresholdApproverLanes, thresholdProposerOf, thresholdApprovalCheck,
 * thresholdProposals and thresholdProposalChip, and the optional `check` a threshold decision gains in normalizeDecisionRecord
 * (shared/65_decisions.js).
 *
 * Evidence: hand-worked records; the "live in feed" cases use the committed 9-day CSV's 2026-09-01 rows (CQAT0015W, lane PN1,
 * MCT Overall Threshold 1.15 at USTIW and CAVAN), mapped as tests/shared_logic/60_threshold_diff.js maps them. Hostile inputs.
 *
 * Calls go through local names: tests/check_shared_sync.js check E forbids a second definition of a shared name in tests/.
 */
exports.TESTS = ['parseThresholdApprovers', 'thresholdApproverLanes', 'thresholdProposerOf', 'thresholdApprovalCheck', 'thresholdProposals',
    'thresholdProposalChip', 'thresholdProposersOf'];
exports.COUNT = 24;
exports.run = function (ctx) {
    const { BFShared, t, plain, history } = ctx;
    const parse = (rows) => plain(BFShared.parseThresholdApprovers(rows));
    const lanesOf = (a, e) => plain(BFShared.thresholdApproverLanes(a, e));
    const proposerOf = (r, id) => BFShared.thresholdProposerOf(r, id);
    const check = (c) => plain(BFShared.thresholdApprovalCheck(c));
    const props = (r, rows, since) => plain(BFShared.thresholdProposals(r, rows, since));
    const chip = (p) => plain(BFShared.thresholdProposalChip(p));
    const norm = (r) => plain(BFShared.normalizeDecisionRecord(r));
    const boom = { valueOf() { throw new Error('valueOf'); }, toString() { throw new Error('toString'); } };
    const proxyBoom = new Proxy({}, { get() { throw new Error('proxy get'); }, has() { throw new Error('proxy has'); }, ownKeys() { throw new Error('proxy ownKeys'); }, getOwnPropertyDescriptor() { throw new Error('proxy gopd'); } });

    const AT = (h) => `2026-10-31T${String(h).padStart(2, '0')}:00:00.000Z`;
    const thr = (id, status, createdAt, supersedes = '', author = 'p@x.com', to = 1.5, extra = {}) =>
        ({ id, vvd: 'CQAT0015W', polKey: '', kind: 'threshold', payload: Object.assign({ field: 'overall', from: 1.15, to, reason: 'needs room', status }, extra), author, createdAt, supersedes });
    const LEAD = { check: { as: 'lead', lane: 'PN1' } };

    // ---------------------------------------------------------------- check in normalizeDecisionRecord (shared/65_decisions.js)
    t('normalizeDecisionRecord: a decided threshold keeps check { as, lane } (trimmed, as lower-cased, lane upper-cased, extra keys dropped); admin may have a blank lane',
        [norm(thr('a', 'approved', AT(1), 'p', 'k@x.com', 1.5, { check: { as: ' Lead ', lane: ' pn1 ', x: 1 } })).record.payload.check,
            norm(thr('a', 'rejected', AT(1), 'p', 'k@x.com', 1.5, { check: { as: 'admin' } })).record.payload.check,
            norm(thr('a', 'approved', AT(1), 'p', 'k@x.com', 1.5, { check: { as: 'admin', lane: null } })).record.payload.check],
        [{ as: 'lead', lane: 'PN1' }, { as: 'admin', lane: '' }, { as: 'admin', lane: '' }]);
    t('normalizeDecisionRecord: check is ignored on a proposal; absent or null on a decision leaves the payload exactly as before (no check key)',
        [norm(thr('a', 'proposed', AT(1), '', 'p@x.com', 1.5, { check: { as: 'nobody' } })).record.payload,
            norm(thr('a', 'approved', AT(1), 'p')).record.payload, norm(thr('a', 'approved', AT(1), 'p', 'p@x.com', 1.5, { check: null })).record.payload],
        [{ field: 'overall', from: 1.15, to: 1.5, reason: 'needs room', status: 'proposed' }, { field: 'overall', from: 1.15, to: 1.5, reason: 'needs room', status: 'approved' },
            { field: 'overall', from: 1.15, to: 1.5, reason: 'needs room', status: 'approved' }]);
    t('normalizeDecisionRecord: a bad check is invalid-check (lead without a lane, an unknown as, a lane too long or with a slash, not an object, a number lane); from a Sheet row too',
        [{ as: 'lead' }, { as: 'lead', lane: '  ' }, { as: 'owner', lane: 'PN1' }, { as: 'lead', lane: 'ABCDEFGHIJKLMNOPQRSTU' }, { as: 'lead', lane: 'PN/1' }, 'lead', [], { as: 'lead', lane: 5 }]
            .map((c) => norm(thr('a', 'approved', AT(1), 'p', 'p@x.com', 1.5, { check: c })).error)
            .concat([plain(BFShared.decisionRecordFromRow(['a', 'CQAT0015W', '', 'threshold', '{"field":"overall","from":null,"to":1.5,"reason":"r","status":"approved","check":{"as":"boss"}}', 'k@x.com', AT(1), 'p'])).error]),
        Array(9).fill('invalid-check'));

    // ---------------------------------------------------------------- parseThresholdApprovers
    t('parseThresholdApprovers: lane upper-cased, email lower-cased, trimmed; duplicates kept once; blank rows ignored; sorted by lane then email; extra cells ignored',
        parse([[' pn1 ', ' Ryan.T@Corp.com ', 'lead'], ['AL5', 'b@corp.com'], ['', ''], ['PN1', 'ryan.t@corp.com'], ['AL5', 'a@corp.com'], ['', '  '], [null, undefined], []]),
        { approvers: [{ lane: 'AL5', email: 'a@corp.com' }, { lane: 'AL5', email: 'b@corp.com' }, { lane: 'PN1', email: 'ryan.t@corp.com' }], skipped: 0 });
    t('parseThresholdApprovers: a row with only one cell, a bad lane or a bad email is skipped and counted; a number cell is not text; a non-array row is skipped',
        parse([['PN1', ''], ['', 'a@corp.com'], ['P/N1', 'a@corp.com'], ['PN1', 'not an email'], ['PN1', 'a @corp.com'], [5, 'a@corp.com'], ['PN1', 'x'.repeat(250) + '@c.com'], 'PN1,a@corp.com', null]),
        { approvers: [], skipped: 9 });
    t('parseThresholdApprovers: not an array, and hostile cells, never throw',
        [parse(null), parse('x'), parse({ length: 1, 0: ['PN1', 'a@corp.com'] }), parse([[boom, 'a@corp.com']]), parse(proxyBoom)],
        [{ approvers: [], skipped: 0 }, { approvers: [], skipped: 0 }, { approvers: [], skipped: 0 }, { approvers: [], skipped: 1 }, { approvers: [], skipped: 0 }]);

    // ---------------------------------------------------------------- thresholdApproverLanes
    {
        const A = [{ lane: 'PN1', email: 'ryan.t@corp.com' }, { lane: 'AL5', email: 'ryan.t@corp.com' }, { lane: 'AL5', email: 'b@corp.com' }, { lane: 'pn1', email: 'RYAN.T@corp.com' }, { lane: 'X/1', email: 'ryan.t@corp.com' }, null, 'PN1'];
        t('thresholdApproverLanes: the distinct, sorted lanes of one email, compared case-insensitively; a bad lane or entry is skipped',
            [lanesOf(A, ' Ryan.T@Corp.com '), lanesOf(A, 'b@corp.com'), lanesOf(A, 'nobody@corp.com')], [['AL5', 'PN1'], ['AL5'], []]);
        t('thresholdApproverLanes: no email, a non-address, a non-list or a hostile entry gives []',
            [lanesOf(A, ''), lanesOf(A, 'ryan.t'), lanesOf(A, null), lanesOf('x', 'ryan.t@corp.com'), lanesOf([proxyBoom], 'ryan.t@corp.com')], [[], [], [], [], []]);
    }

    // ---------------------------------------------------------------- thresholdProposerOf
    {
        // P proposed by p@, R re-proposed (new value) by r@, A approved by k@ (decides R's value), D a decision row (other kind).
        const R = [thr('P', 'proposed', AT(1)), thr('R', 'proposed', AT(2), 'P', 'r@x.com', 1.6), thr('A', 'approved', AT(3), 'R', 'k@x.com', 1.6),
            { id: 'D', vvd: 'CQAT0015W', polKey: '', kind: 'decision', payload: { action: 'cut', reason: 'x' }, author: 'd@x.com', createdAt: AT(4), supersedes: '' }];
        t('thresholdProposerOf: the author of the value a record decides (a re-proposal is a new value: A decides R\'s, so r@); a proposal is its own; a rejected-then-approved chain walks back to the proposal',
            [proposerOf(R, 'A'), proposerOf(R, 'R'), proposerOf(R, 'P'), proposerOf([thr('P', 'proposed', AT(1)), thr('X', 'rejected', AT(2), 'P', 'k@x.com'), thr('Y', 'approved', AT(3), 'X', 'm@x.com')], 'Y')],
            ['r@x.com', 'r@x.com', 'p@x.com', 'p@x.com']);
        t('thresholdProposerOf: an unknown id, a decision record\'s id, a non-string id, bad records and a cycle never throw (a cycle stops at the record it reached)',
            [proposerOf(R, 'nope'), proposerOf(R, 'D'), proposerOf(R, 5), proposerOf(null, 'A'), proposerOf(proxyBoom, 'A'),
                proposerOf([thr('a', 'approved', AT(1), 'b', 'a@x.com'), thr('b', 'approved', AT(2), 'a', 'b@x.com')], 'a')],
            ['', '', '', '', '', 'b@x.com']);
    }

    // ---------------------------------------------------------------- thresholdApprovalCheck
    {
        const base = { status: 'approved', me: 'Ryan.T@corp.com', proposer: 'p@corp.com', admin: false, configured: true, approverLanes: ['PN1'], lane: 'pn1' };
        const w = (o) => check(Object.assign({}, base, o));
        t('thresholdApprovalCheck: the lane lead (case-insensitive) approves or rejects as lead; the admin as admin whatever the lane (even unknown)',
            [w({}), w({ status: ' Rejected ' }), w({ admin: true, approverLanes: [], lane: '' }), w({ admin: true, lane: 'AL5' })],
            [{ ok: true, as: 'lead' }, { ok: true, as: 'lead' }, { ok: true, as: 'admin' }, { ok: true, as: 'admin' }]);
        t('thresholdApprovalCheck: the rules in order: invalid-status, no-user-identity, approvers-not-configured (the admin too: fail closed), own-proposal (the admin too), lane-unknown, not-approver',
            [w({ status: 'proposed' }), w({ me: '' }), w({ configured: false, admin: true }), w({ configured: 'yes' }), w({ proposer: ' RYAN.T@CORP.COM ' }),
                w({ proposer: 'kevin@corp.com', me: 'kevin@corp.com', admin: true }), w({ lane: '' }), w({ lane: 'AL5' }), w({ approverLanes: 'PN1' })]
                .map((x) => x.error),
            ['invalid-status', 'no-user-identity', 'approvers-not-configured', 'approvers-not-configured', 'own-proposal', 'own-proposal', 'lane-unknown', 'not-approver', 'not-approver']);
        t('thresholdApprovalCheck: rejecting one\'s own proposal (a withdrawal) is allowed to someone who may decide; a truthy non-true admin is not admin',
            [w({ status: 'rejected', proposer: 'ryan.t@corp.com' }), w({ admin: 1, approverLanes: [] })], [{ ok: true, as: 'lead' }, { ok: false, error: 'not-approver' }]);
        t('thresholdApprovalCheck: not an object, or hostile values, never throw',
            [check(null), check('approved'), check(proxyBoom), check(Object.assign({}, base, { me: boom })), check(Object.assign({}, base, { approverLanes: [boom] }))].map((x) => x.ok === false && x.error),
            ['invalid-status', 'invalid-status', 'invalid-status', 'no-user-identity', 'not-approver']);
    }

    // ---------------------------------------------------------------- security review (2026-10-31): sig, proposers, no revival
    t('normalizeDecisionRecord: check keeps a 64-hex sig as it is; any other sig (upper-case, short, not a string) is invalid-check',
        [norm(thr('a', 'approved', AT(1), 'p', 'k@x.com', 1.5, { check: { as: 'lead', lane: 'PN1', sig: 'ab'.repeat(32) } })).record.payload.check]
            .concat(['AB'.repeat(32), 'ab'.repeat(31), 5, ''].map((sig) => norm(thr('a', 'approved', AT(1), 'p', 'k@x.com', 1.5, { check: { as: 'lead', lane: 'PN1', sig } })).error)),
        [{ as: 'lead', lane: 'PN1', sig: 'ab'.repeat(32) }, 'invalid-check', 'invalid-check', 'invalid-check', 'invalid-check']);
    {
        const proposersOf = (r, id) => plain(BFShared.thresholdProposersOf(r, id));
        // a@ proposes 1.5, b@ re-proposes the same 1.5, c@ re-proposes 1.6, d@ re-proposes 1.5 again; X approves the latest.
        const R = [thr('P1', 'proposed', AT(1), '', 'a@x.com', 1.5), thr('P2', 'proposed', AT(2), 'P1', 'b@x.com', 1.5), thr('P3', 'proposed', AT(3), 'P2', 'c@x.com', 1.6),
            thr('P4', 'proposed', AT(4), 'P3', 'd@x.com', 1.5), thr('X', 'rejected', AT(5), 'P4', 'k@x.com', 1.5)];
        t('thresholdProposersOf: everyone who proposed the decided value in the chain (a, b and d for 1.5; c alone for 1.6), sorted; [] for an unknown id or bad input; a cycle ends',
            [proposersOf(R, 'X'), proposersOf(R, 'P4'), proposersOf(R, 'P3'), proposersOf(R, 'P2'), proposersOf(R, 'nope'), proposersOf(null, 'X'), proposersOf(proxyBoom, 'X'),
                proposersOf([thr('a', 'proposed', AT(1), 'b', 'a@x.com'), thr('b', 'proposed', AT(2), 'a', 'b@x.com')], 'a')],
            [['a@x.com', 'b@x.com', 'd@x.com'], ['a@x.com', 'b@x.com', 'd@x.com'], ['c@x.com'], ['a@x.com', 'b@x.com'], [], [], [], ['a@x.com', 'b@x.com']]);
        const base = { status: 'approved', me: 'a@x.com', proposer: 'd@x.com', admin: false, configured: true, approverLanes: ['PN1'], lane: 'PN1' };
        const w = (o) => check(Object.assign({}, base, o));
        t('thresholdApprovalCheck: proposers blocks an approval by any of them (laundering), the admin too; a rejection by one of them is allowed; a non-array proposers is ignored',
            [w({ proposers: ['B@x.com', ' A@X.COM '] }), w({ proposers: ['a@x.com'], admin: true }), w({ proposers: ['a@x.com'], status: 'rejected' }), w({ proposers: 'a@x.com' }), w({ proposers: [boom] })],
            [{ ok: false, error: 'own-proposal' }, { ok: false, error: 'own-proposal' }, { ok: true, as: 'lead' }, { ok: true, as: 'lead' }, { ok: true, as: 'lead' }]);
        t('thresholdApprovalCheck: targetRejected true refuses an approval (proposal-rejected, the admin too, before own-proposal); a rejection of it is allowed; only true counts',
            [w({ targetRejected: true }), w({ targetRejected: true, admin: true, me: 'd@x.com' }), w({ targetRejected: true, status: 'rejected' }), w({ targetRejected: 'yes' })],
            [{ ok: false, error: 'proposal-rejected' }, { ok: false, error: 'proposal-rejected' }, { ok: true, as: 'lead' }, { ok: true, as: 'lead' }]);
    }

    // ---------------------------------------------------------------- thresholdProposals and thresholdProposalChip
    {
        // The 9-day CSV's 2026-09-01 rows, mapped as tests/shared_logic/60_threshold_diff.js maps them. CQAT0015W (PN1) has overall 1.15.
        const C = history.COL;
        const rows = history.loadHistory().realRows('2026-09-01').map((r) => ({ vvd: r[C.vvd], pol: r[C.pol], lane: r[C.lane], overall: r[C.overallThreshold], loading: r[C.loadingThreshold], seq: r[C.seq] }));
        const P1 = [thr('p1', 'proposed', AT(1))];
        const P2 = P1.concat([thr('a1', 'approved', AT(2), 'p1', 'kevin@x.com', 1.5, LEAD)]);
        const P3 = P1.concat([thr('a1', 'approved', AT(2), 'p1', 'kevin@x.com', 1.5)]);
        const P4 = P1.concat([thr('r1', 'rejected', AT(2), 'p1', 'ryan.t@x.com', 1.5, LEAD)]);
        // P5 proposes the value the feed already has (1.15) and is approved: live.
        const P5 = [thr('q1', 'proposed', AT(1), '', 'p@x.com', 1.15), thr('q2', 'approved', AT(2), 'q1', 'k@x.com', 1.15, { check: { as: 'admin' } })];
        const s = (recs) => props(recs, rows).map((e) => [e.state, e.check, e.valueBy, e.current, e.liveInFeed, e.stage]);
        t('thresholdProposals (real rows, CQAT0015W overall 1.15): proposed; approved with a check; approved WITHOUT one is unchecked; rejected with a check; approved and in the feed is live',
            [s(P1), s(P2), s(P3), s(P4), s(P5)],
            [[['proposed', null, 'p@x.com', 1.15, false, 'proposed']], [['approved', { as: 'lead', lane: 'PN1' }, 'p@x.com', 1.15, false, 'approved']],
                [['unchecked', null, 'p@x.com', 1.15, false, 'approved']], [['rejected', { as: 'lead', lane: 'PN1' }, 'p@x.com', 1.15, false, 'rejected']],
                [['live', { as: 'admin', lane: '' }, 'p@x.com', 1.15, true, 'live']]]);
        {
            const log = plain(BFShared.thresholdLog(P2.concat(P5), rows));
            const got = props(P2.concat(P5), rows);
            t('thresholdProposals: each entry is thresholdLog\'s entry, in its order, plus exactly check, valueBy and state; no rows gives state approved (not live); since passes through',
                [got.map((e) => { const c = Object.assign({}, e); delete c.check; delete c.valueBy; delete c.state; return c; }), props(P5, null).map((e) => e.state), props(P2.concat(P5), rows, AT(2)).length, props(P2, rows, AT(3)).length],
                [log, ['approved'], 2, 0]);
        }
        t('thresholdProposals: not an array, hostile records and a cycle never throw',
            [props(null, rows), props(proxyBoom, rows), props([proxyBoom], rows).length, props([thr('a', 'approved', AT(1), 'b', 'a@x.com', 1.5, LEAD), thr('b', 'approved', AT(2), 'a', 'b@x.com', 1.5, LEAD)], rows).map((e) => e.state)],
            [[], [], 0, ['approved']]);
        const chips = (recs) => props(recs, rows).map(chip);
        t('thresholdProposalChip: proposed and unchecked say "Threshold proposed 150% by p"; approved says who approved and "not yet in feed"; rejected and live show nothing',
            [chips(P1), chips(P3), chips(P2), chips(P4), chips(P5)],
            [[{ show: true, tone: 'proposed', text: 'Threshold proposed 150% by p' }], [{ show: true, tone: 'proposed', text: 'Threshold proposed 150% by p' }],
                [{ show: true, tone: 'approved', text: 'Threshold approved 150% by kevin, not yet in feed' }], [{ show: false }], [{ show: false }]]);
        t('thresholdProposalChip: the percent (1.15 is 115%, 1.125 is 112.5%, 0.5 is 50%); a proposal the feed already shows is hidden; no name is "someone"',
            [chip({ state: 'proposed', to: 1.15, valueBy: 'a@x.com' }).text, chip({ state: 'proposed', to: 1.125, valueBy: 'a@x.com' }).text, chip({ state: 'approved', to: 0.5, updatedBy: '' }).text,
                chip({ state: 'proposed', to: 1.5, valueBy: 'a@x.com', liveInFeed: true })],
            ['Threshold proposed 115% by a', 'Threshold proposed 112.5% by a', 'Threshold approved 50% by someone, not yet in feed', { show: false }]);
        t('thresholdProposalChip: a value that is not set, an unknown state, not an object and hostile input give { show: false }',
            [chip({ state: 'proposed', to: 0 }), chip({ state: 'proposed', to: 0.01 }), chip({ state: 'weird', to: 1.5 }), chip(null), chip(proxyBoom), chip({ state: 'proposed', to: boom })],
            Array(6).fill({ show: false }));
    }
};

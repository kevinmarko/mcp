/**
 * Headless check for threshold proposals' approver rule in apps-script/TeamSheet.gs (D84 slice 2b-3, R-5; Q3 DECIDED 2026-10-30:
 * the lane's SPC lead plus Kevin approve): decideThresholdProposal, getThresholdApproverRights, getThresholdProposals,
 * setupThresholdApprovers, and the lane lookup from the live feed (vvdLanesFromCsv_, thresholdLaneOf_).
 *
 * Runs the REAL apps-script/Shared.gs, DataFeeds.gs and TeamSheet.gs under Node in one vm context, plus ARCHIVE_ADMIN_KEY_,
 * activeUserEmail_, currentArchiveEmail_ and assertArchiveAdmin_ cut verbatim out of the real Code.gs (the existing admin check).
 * In-memory fakes stand in for Session, PropertiesService, LockService, SpreadsheetApp (the team Sheet and the Config Sheet, each
 * with tabs), CacheService (the live feed's cached copy: meta + one gzip-base64 chunk, as DataFeeds.gs writes it), Utilities
 * (uuid counter, base64 and gunzip through Node's zlib) and console. The clock is frozen. fetchArchiveCsv_ (Code.gs) is not
 * loaded, so a cache miss's download fails, as a feed outage would.
 *
 * Real data: the live feed fixture is the committed 9-day CSV's 2026-09-01 rows (header and records re-serialised), so the lanes
 * are the export's own: CQAT0015W is PN1, NRET0084E is AL5. One check runs the Apps Script CSV parser (DataFeeds.gs
 * parseCsvRecords_) over the WHOLE 9-day file and confirms every real VVD of 2026-09-01 resolves to exactly its one lane.
 *
 * What the fakes cannot prove (UNCONFIRMED until the apps-script/README.md "Threshold proposals (2b-3)" checklist is run on
 * /exec): that Session.getActiveUser() names the visitor, that a visitor can read the Config Sheet's approver tab, the real lock,
 * and the real feed cache.
 *
 * Run:  node tests/check_threshold_approvals.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');
const history = require('./lib/history_days.js');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const sharedGs = read('apps-script', 'Shared.gs');
const feedsGs = read('apps-script', 'DataFeeds.gs');
const teamGs = read('apps-script', 'TeamSheet.gs');
const codeGs = read('apps-script', 'Code.gs');

function cutFunction(src, name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start === -1) throw new Error(`Code.gs has no function ${name}`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start + 1, end + 3);
}
const adminKeyLine = (codeGs.match(/^var ARCHIVE_ADMIN_KEY_ = .*$/m) || [])[0];
if (!adminKeyLine) throw new Error('Code.gs has no ARCHIVE_ADMIN_KEY_');
const codeParts = [adminKeyLine, cutFunction(codeGs, 'activeUserEmail_'), cutFunction(codeGs, 'currentArchiveEmail_'), cutFunction(codeGs, 'assertArchiveAdmin_')].join('\n');

let pass = 0;
const failures = [];
function t(name, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) { pass++; console.log(`  ok   ${name}`); } else {
    failures.push(`${name}\n      got:  ${a}\n      want: ${b}`);
    console.log(`  FAIL ${name}`);
  }
}

// ---- the live feed fixture: the 9-day CSV's 2026-09-01 rows (real data) ----
const hist = history.loadHistory();
const DAY = '2026-09-01';
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const FEED_CSV = [hist.headers.map(q).join(',')].concat(hist.rowsOn(DAY).map((r) => hist.headers.map((h) => q(r[h])).join(','))).join('\r\n') + '\r\n';
const FEED_B64 = zlib.gzipSync(Buffer.from(FEED_CSV, 'utf8')).toString('base64');

const NOW = Date.parse('2026-10-31T14:05:09.123Z');
const ADMIN = 'kevin@corp.com';
const APPROVER_ROWS = [['PN1', 'Ryan.T@corp.com', 'SPC lead'], ['pn1', 'alice@corp.com', 'cover'], ['AL5', 'lead.al5@corp.com', ''], ['', '', ''], ['XX', 'not-an-email', '']];

function makeEnv(opts = {}) {
  const env = {
    nowMs: NOW, user: 'alice@corp.com', props: new Map(), sheets: new Map(), uuid: 0, lockTries: 0, errors: [], cache: new Map(), configThrows: null,
  };
  env.props.set('bfrTeamSheetId', 'team-sheet-id');
  if (opts.config !== false) env.props.set('bfrConfigSheetId', 'config-sheet-id');
  env.props.set('bfrArchiveAdmin', opts.admin === undefined ? ADMIN : opts.admin);
  if (opts.feed !== false) {
    env.cache.set('bfrFeed:live:meta', JSON.stringify({ v: 1, hash: 'h', fetchedAt: '2026-10-31T13:00:00.000Z', chunks: 1 }));
    env.cache.set('bfrFeed:live:0', FEED_B64);
  }
  const display = (v) => { const s = String(v); return s.startsWith("'") ? s.slice(1) : s; };
  function makeSs(id) {
    const ss = { id, tabs: [] };
    ss.tab = (n) => ss.tabs.find((x) => x.name === n) || null;
    ss.add = (name, rows) => {
      const tab = { name, rows: rows.map((r) => r.slice()) };
      tab.api = {
        getLastRow: () => tab.rows.length,
        getMaxColumns: () => 26,
        appendRow: (row) => { tab.rows.push(row.map((x) => (x === null || x === undefined ? '' : x))); },
        getRange: (r, c, nr = 1, nc = 1) => ({
          getDisplayValues: () => {
            if (id === 'config-sheet-id' && env.configThrows) throw new Error(env.configThrows);
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = tab.rows[r - 1 + i] || [];
              const line = [];
              for (let j = 0; j < nc; j++) line.push(display(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]));
              out.push(line);
            }
            return out;
          },
          setFontWeight: () => {},
        }),
        setFrozenRows: () => {},
      };
      ss.tabs.push(tab);
      return tab;
    };
    ss.api = {
      getSheetByName: (n) => { const tab = ss.tab(n); return tab ? tab.api : null; },
      insertSheet: (n) => ss.add(n, []).api,
      getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
      getId: () => id,
    };
    env.sheets.set(id, ss);
    return ss;
  }
  env.team = makeSs('team-sheet-id');
  env.config = makeSs('config-sheet-id');
  if (opts.approvers !== false) env.config.add('Threshold Approvers', [['Lane', 'Approver Email', 'Notes']].concat(opts.approverRows || APPROVER_ROWS));
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(env.nowMs); else super(...a); }
    static now() { return env.nowMs; }
  }
  const sandbox = {
    Date: FakeDate,
    console: { log: () => {}, warn: () => {}, error: (...a) => env.errors.push(a.join(' ')) },
    Session: {
      getActiveUser: () => ({ getEmail: () => env.user }),
      getEffectiveUser: () => ({ getEmail: () => env.user }),
      getScriptTimeZone: () => 'America/New_York',
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
        setProperty: (k, v) => { env.props.set(k, String(v)); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { env.lockTries++; return true; }, releaseLock: () => {} }) },
    SpreadsheetApp: {
      openById: (id) => {
        if (id === 'config-sheet-id' && env.configThrows) throw new Error(env.configThrows);
        const ss = env.sheets.get(id);
        if (!ss) throw new Error('no such sheet');
        return ss.api;
      },
      flush: () => {},
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (env.cache.has(k) ? env.cache.get(k) : null),
        getAll: (keys) => { const o = {}; keys.forEach((k) => { if (env.cache.has(k)) o[k] = env.cache.get(k); }); return o; },
        put: (k, v) => { env.cache.set(k, String(v)); },
        remove: (k) => { env.cache.delete(k); },
      }),
    },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++env.uuid).padStart(12, '0')}`,
      base64Decode: (b64) => Buffer.from(b64, 'base64'),
      newBlob: (bytes) => ({ bytes }),
      ungzip: (blob) => ({ getDataAsString: () => zlib.gunzipSync(blob.bytes).toString('utf8') }),
      sleep: () => {},
      // Apps Script returns signed bytes (-128..127), as here.
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value, 'utf8').digest()).map((x) => (x > 127 ? x - 256 : x)),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${sharedGs}\n${feedsGs}\n${teamGs}\n${codeParts}\n`, sandbox, { filename: 'Shared.gs+DataFeeds.gs+TeamSheet.gs+Code.gs(parts)' });
  env.api = sandbox;
  env.call = (name, ...args) => JSON.parse(JSON.stringify(sandbox[name](...args)));
  env.as = (user, name, ...args) => { env.user = user; env.nowMs += 1000; return env.call(name, ...args); };
  env.logRows = () => (env.team.tab('ThresholdLog') ? env.team.tab('ThresholdLog').rows.length : 0);
  return env;
}

const failureReplies = [];
const fail = (reply) => { failureReplies.push(reply); return reply; };
const PROPOSAL = { vvd: 'CQAT0015W', polKey: '', field: 'overall', from: 1.15, to: 1.5, reason: 'PN1 needs room', status: 'proposed' };
const propose = (env, user = 'alice@corp.com', change = PROPOSAL) => env.as(user, 'saveThresholdChange', change).record;

console.log('\n[thresholds] the lane comes from the live feed (real 9-day CSV)');
{
  const env = makeEnv();
  const whole = env.api.parseCsvRecords_(read('Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv'));
  const sailings = hist.sailings(DAY);
  const wrong = [];
  sailings.forEach((s, vvd) => {
    const got = JSON.parse(JSON.stringify(env.api.vvdLanesFromCsv_(whole, vvd)));
    if (JSON.stringify(got) !== JSON.stringify([s.lane])) wrong.push([vvd, s.lane, got]);
  });
  t('every real VVD of 2026-09-01 (368) resolves to exactly its one lane over the WHOLE 9-day file, parsed by DataFeeds.gs parseCsvRecords_',
    [sailings.size, wrong], [368, []]);
  t('VMS rows name many lanes (so a placeholder has no single lane); a VVD not in the file has none; missing columns give []',
    [env.api.vvdLanesFromCsv_(whole, 'VMS').length > 1, env.call('vvdLanesFromCsv_', whole, 'ZZZZ0001W'), env.call('vvdLanesFromCsv_', [['VVD', 'Lane'], ['CQAT0015W', 'PN1']], 'CQAT0015W'), env.call('vvdLanesFromCsv_', [], 'X')],
    [true, [], [], []]);
  t('thresholdLaneOf_ reads the cached live copy: CQAT0015W is PN1, NRET0084E is AL5; an unknown VVD is ""',
    [env.call('thresholdLaneOf_', 'CQAT0015W'), env.call('thresholdLaneOf_', 'NRET0084E'), env.call('thresholdLaneOf_', 'ZZZZ0001W')], ['PN1', 'AL5', '']);
  const off = makeEnv({ feed: false });
  t('with no cached copy and a failed download, the lane is "" (never a guess) and the download failure is not thrown',
    off.call('thresholdLaneOf_', 'CQAT0015W'), '');
}

console.log('\n[thresholds] fail closed: no approver map');
{
  const noConfig = makeEnv({ config: false });
  const p1 = propose(noConfig);
  const noTab = makeEnv({ approvers: false });
  const p2 = propose(noTab);
  t('no Config Sheet, or no "Threshold Approvers" tab: every decision is approvers-not-configured (the lead AND the admin), and nothing is written',
    [fail(noConfig.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p1.id, status: 'approved', reason: 'ok' })),
      fail(noConfig.as(ADMIN, 'decideThresholdProposal', { id: p1.id, status: 'approved', reason: 'ok' })),
      fail(noTab.as(ADMIN, 'decideThresholdProposal', { id: p2.id, status: 'rejected', reason: 'no' })), noConfig.logRows(), noTab.logRows()],
    [{ ok: false, reason: 'approvers-not-configured' }, { ok: false, reason: 'approvers-not-configured' }, { ok: false, reason: 'approvers-not-configured' }, 2, 2]);
  t('getThresholdApproverRights says so: configured false, lanes [], admin still reported',
    [noTab.as(ADMIN, 'getThresholdApproverRights'), noConfig.as('ryan.t@corp.com', 'getThresholdApproverRights')],
    [{ ok: true, email: ADMIN, admin: true, configured: false, lanes: [] }, { ok: true, email: 'ryan.t@corp.com', admin: false, configured: false, lanes: [] }]);
  const empty = makeEnv({ approverRows: [] });
  const p3 = propose(empty);
  t('an EMPTY approver tab: the admin may decide, a would-be lead may not (not-approver)',
    [fail(empty.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p3.id, status: 'approved', reason: 'ok' })),
      empty.as(ADMIN, 'decideThresholdProposal', { id: p3.id, status: 'approved', reason: 'ok' }).record.payload.check],
    [{ ok: false, reason: 'not-approver' }, { as: 'admin', lane: '' }]);
}

console.log('\n[thresholds] who may decide');
{
  const env = makeEnv();
  const p = propose(env);
  const before = env.logRows();
  t('the proposer may not approve their own proposal, even as a lead of its lane (own-proposal); a lead of another lane and someone with no row are not-approver; nothing is written',
    [fail(env.as('alice@corp.com', 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'mine' })),
      fail(env.as('lead.al5@corp.com', 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'ok' })),
      fail(env.as('bob@corp.com', 'decideThresholdProposal', { id: p.id, status: 'rejected', reason: 'no' })), env.logRows() - before],
    [{ ok: false, reason: 'own-proposal' }, { ok: false, reason: 'not-approver' }, { ok: false, reason: 'not-approver' }, 0]);
  const a = env.as('Ryan.T@corp.com', 'decideThresholdProposal', { id: p.id, status: ' Approved ', reason: 'agreed on the call', field: 'loading', to: 9, check: { as: 'admin' } });
  t('the lane\'s lead (PN1 from the feed, case-insensitive email) approves: one appended row superseding the proposal, author from the session, field/from/to copied from the proposal (client values ignored), check { as: lead, lane: PN1 } set by the server',
    { ok: a.ok, author: a.record.author, supersedes: a.record.supersedes, payload: a.record.payload, rows: env.logRows() - before },
    { ok: true, author: 'ryan.t@corp.com', supersedes: p.id, payload: { field: 'overall', from: 1.15, to: 1.5, reason: 'agreed on the call', status: 'approved', check: { as: 'lead', lane: 'PN1' } }, rows: 1 });
  t('a second decision on the same (now superseded) record is stale-supersedes naming the approval, through the 2a-3 compare-and-swap',
    fail(env.as(ADMIN, 'decideThresholdProposal', { id: p.id, status: 'rejected', reason: 'late' })), { ok: false, reason: 'stale-supersedes', latestId: a.record.id });
  const r = env.as(ADMIN, 'decideThresholdProposal', { id: a.record.id, status: 'rejected', reason: 'MCT owner says no' });
  t('the admin (Kevin, by the existing admin check) decides on any lane without a feed lookup: check { as: admin, lane: "" }',
    [r.ok, r.record.payload.status, r.record.payload.check, r.record.supersedes], [true, 'rejected', { as: 'admin', lane: '' }, a.record.id]);
  const got = env.as('bob@corp.com', 'getThresholdProposals');
  t('getThresholdProposals: one proposal, state rejected with the admin\'s check, valueBy the proposer, liveInFeed null (no rows on the server); records are the three valid rows',
    [got.ok, got.proposals.map((e) => [e.id, e.latestId, e.state, e.check, e.valueBy, e.liveInFeed, e.records]), got.records.length, got.skipped],
    [true, [[p.id, r.record.id, 'rejected', { as: 'admin', lane: '' }, 'alice@corp.com', null, 3]], 3, 0]);
  const k = propose(env, ADMIN, Object.assign({}, PROPOSAL, { vvd: 'NRET0084E', to: 1.3 }));
  t('Kevin cannot approve his own proposal (own-proposal); the AL5 lead can; the PN1 lead cannot (not-approver)',
    [fail(env.as(ADMIN, 'decideThresholdProposal', { id: k.id, status: 'approved', reason: 'ok' })),
      fail(env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: k.id, status: 'approved', reason: 'ok' })),
      env.as('lead.al5@corp.com', 'decideThresholdProposal', { id: k.id, status: 'approved', reason: 'ok' }).record.payload.check],
    [{ ok: false, reason: 'own-proposal' }, { ok: false, reason: 'not-approver' }, { as: 'lead', lane: 'AL5' }]);
  const w = propose(env, 'ryan.t@corp.com', Object.assign({}, PROPOSAL, { vvd: 'YNDT0604W' }));
  t('a lead may reject (withdraw) their own proposal',
    env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: w.id, status: 'rejected', reason: 'withdrawn' }).record.payload.check, { as: 'lead', lane: 'PN1' });
  t('getThresholdApproverRights: a lead sees only their own lanes; Kevin is admin; no one else\'s address is in a reply',
    [env.as('Alice@Corp.com', 'getThresholdApproverRights'), env.as('lead.al5@corp.com', 'getThresholdApproverRights'), env.as(ADMIN, 'getThresholdApproverRights')],
    [{ ok: true, email: 'alice@corp.com', admin: false, configured: true, lanes: ['PN1'] }, { ok: true, email: 'lead.al5@corp.com', admin: false, configured: true, lanes: ['AL5'] },
      { ok: true, email: ADMIN, admin: true, configured: true, lanes: [] }]);
}

console.log('\n[thresholds] the lane must be known');
{
  const env = makeEnv({ feed: false });
  const p = propose(env);
  t('no live feed: a lead gets lane-unknown (never approved on a guess); the admin still decides',
    [fail(env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'ok' })),
      env.as(ADMIN, 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'ok' }).ok],
    [{ ok: false, reason: 'lane-unknown' }, true]);
  const env2 = makeEnv();
  const z = propose(env2, 'alice@corp.com', Object.assign({}, PROPOSAL, { vvd: 'ZZZZ0001W' }));
  t('a sailing not in the feed: lane-unknown for a lead',
    fail(env2.as('ryan.t@corp.com', 'decideThresholdProposal', { id: z.id, status: 'approved', reason: 'ok' })), { ok: false, reason: 'lane-unknown' });
  const p2 = propose(env2);
  t('the lane is the feed\'s, never the client\'s: the AL5 lead sending lane AL5 for a PN1 sailing is not-approver',
    fail(env2.as('lead.al5@corp.com', 'decideThresholdProposal', { id: p2.id, status: 'approved', reason: 'ok', lane: 'AL5', check: { as: 'lead', lane: 'AL5' } })), { ok: false, reason: 'not-approver' });
  // A feed in which CQAT0015W also has a row on AL5 (the real rows plus one edited copy): two lanes, so no single lane.
  const env3 = makeEnv();
  const extra = hist.rowsOn(DAY).find((r) => r['Vessel 1st VVD'] === 'CQAT0015W');
  const twoLanes = FEED_CSV + hist.headers.map((h) => q(h === 'Vessel 1st Lane' ? 'AL5' : extra[h])).join(',') + '\r\n';
  env3.cache.set('bfrFeed:live:0', zlib.gzipSync(Buffer.from(twoLanes, 'utf8')).toString('base64'));
  const p3 = propose(env3);
  t('a sailing whose feed rows name two lanes has no lane: lane-unknown for the lead of either',
    [fail(env3.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p3.id, status: 'approved', reason: 'ok' })),
      fail(env3.as('lead.al5@corp.com', 'decideThresholdProposal', { id: p3.id, status: 'approved', reason: 'ok' }))],
    [{ ok: false, reason: 'lane-unknown' }, { ok: false, reason: 'lane-unknown' }]);
}

console.log('\n[thresholds] bad input and errors: fixed codes, no exception text');
{
  const env = makeEnv();
  const p = propose(env);
  const before = env.logRows();
  t('bad arguments are refused before any Sheet is read: not an object, a proposed status, no id, a huge payload',
    [fail(env.as(ADMIN, 'decideThresholdProposal', null)), fail(env.as(ADMIN, 'decideThresholdProposal', [p.id])),
      fail(env.as(ADMIN, 'decideThresholdProposal', { id: p.id, status: 'proposed', reason: 'x' })), fail(env.as(ADMIN, 'decideThresholdProposal', { id: '  ', status: 'approved', reason: 'x' })),
      fail(env.as(ADMIN, 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'x'.repeat(9000) }))],
    [{ ok: false, reason: 'invalid-payload' }, { ok: false, reason: 'invalid-payload' }, { ok: false, reason: 'invalid-status' }, { ok: false, reason: 'invalid-supersedes' }, { ok: false, reason: 'payload-too-large' }]);
  t('an unknown id is unknown-supersedes; a blank reason is the normaliser\'s invalid-reason; no identity is no-user-identity; nothing is written',
    [fail(env.as(ADMIN, 'decideThresholdProposal', { id: 'nope', status: 'approved', reason: 'x' })),
      fail(env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p.id, status: 'approved', reason: '  ' })),
      fail(env.as('', 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'x' })), fail(env.as('', 'getThresholdApproverRights')), env.logRows() - before],
    [{ ok: false, reason: 'unknown-supersedes' }, { ok: false, reason: 'invalid-reason' }, { ok: false, reason: 'no-user-identity' }, { ok: false, reason: 'no-user-identity' }, 0]);
  env.configThrows = 'Exception: You do not have permission to access the requested document config-sheet-id';
  const errs = env.errors.length;
  t('a Config Sheet error is "error" for decide and rights, the text goes only to the log, and nothing is written',
    [fail(env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'x' })), fail(env.as('ryan.t@corp.com', 'getThresholdApproverRights')),
      env.errors.length - errs, env.errors.slice(errs).every((e) => e.includes('[decisions]')), env.logRows() - before],
    [{ ok: false, reason: 'error' }, { ok: false, reason: 'error' }, 2, true, 0]);
  const env2 = makeEnv();
  env2.props.delete('bfrTeamSheetId');
  t('getThresholdProposals: a bad since is invalid-since; no team Sheet is not-configured (decide too)',
    [fail(env.as(ADMIN, 'getThresholdProposals', 'yesterday')), fail(env2.as(ADMIN, 'getThresholdProposals')), fail(env2.as(ADMIN, 'decideThresholdProposal', { id: 'x', status: 'approved', reason: 'x' }))],
    [{ ok: false, reason: 'invalid-since' }, { ok: false, reason: 'not-configured' }, { ok: false, reason: 'not-configured' }]);
}

console.log('\n[thresholds] additive: the 2a-3 path is unchanged, and cannot forge a check');
{
  const env = makeEnv();
  const p = propose(env);
  const old = env.as('bob@corp.com', 'saveThresholdChange', Object.assign({}, PROPOSAL, { status: 'approved', supersedes: p.id, check: { as: 'admin', lane: 'PN1' } }));
  const got = env.as('bob@corp.com', 'getThresholdProposals');
  t('saveThresholdChange still saves an approval from anyone, as in 2a-3, but stores no check (a client check is dropped), so the proposal shows as "unchecked"; getThresholdLog still says approved',
    [old.ok, old.record.payload, got.proposals.map((e) => [e.state, e.check]), env.as('bob@corp.com', 'getThresholdLog').log.map((e) => e.status)],
    [true, { field: 'overall', from: 1.15, to: 1.5, reason: 'PN1 needs room', status: 'approved' }, [['unchecked', null]], ['approved']]);
  t('a checked decision can follow an unchecked one (the lead decides on the latest record): the proposal is then approved with a check',
    [env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: old.record.id, status: 'approved', reason: 'checked now' }).ok,
      env.as('bob@corp.com', 'getThresholdProposals').proposals.map((e) => [e.state, e.check])],
    [true, [['approved', { as: 'lead', lane: 'PN1' }]]]);
}

console.log('\n[thresholds] setupThresholdApprovers (admin only)');
{
  const env = makeEnv({ approvers: false });
  let threw = '';
  env.user = 'bob@corp.com';
  try { env.api.setupThresholdApprovers(); } catch (e) { threw = String(e.message); }
  const tabsAfterRefusal = env.config.tabs.length;
  env.user = ADMIN;
  const r = env.call('setupThresholdApprovers');
  env.config.tab('Threshold Approvers').rows.push(['PN1', 'ryan.t@corp.com', '']);
  env.call('setupThresholdApprovers');
  const env2 = makeEnv({ config: false, approvers: false });
  env2.user = ADMIN;
  let threw2 = '';
  try { env2.api.setupThresholdApprovers(); } catch (e) { threw2 = String(e.message); }
  t('a non-admin is refused (and no tab is made); the admin creates the tab with its header; a second run keeps the rows; no Config Sheet throws',
    [threw.startsWith('Only the archive admin'), tabsAfterRefusal, r, env.config.tab('Threshold Approvers').rows, threw2.startsWith('Run setupTeamSheets first')],
    [true, 0, { ok: true, tab: 'Threshold Approvers', configSheetUrl: 'https://docs.google.com/spreadsheets/d/config-sheet-id/edit' },
      [['Lane', 'Approver Email', 'Notes'], ['PN1', 'ryan.t@corp.com', '']], true]);
}

console.log('\n[thresholds] security review (2026-10-31): signed checks, laundering, no revival');
{
  const KEY = 'bfrThresholdCheckKey';
  const env = makeEnv();
  const p = propose(env);
  const keyBefore = env.props.has(KEY);
  env.as('bob@corp.com', 'getThresholdProposals');
  const keyAfterRead = env.props.has(KEY);
  const a = env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p.id, status: 'approved', reason: 'ok' });
  const tab = env.team.tab('ThresholdLog');
  const cell = JSON.parse(String(tab.rows[tab.rows.length - 1][4]).replace(/^'/, ''));
  const replies = [a, env.as('bob@corp.com', 'getThresholdProposals'), env.as('ryan.t@corp.com', 'getThresholdApproverRights')];
  t('the signing key is made by the first decision (never by a read), the stored check carries a 64-hex sig, and no reply carries the sig or the key',
    [keyBefore, keyAfterRead, env.props.has(KEY), /^[0-9a-f]{64}$/.test(cell.check.sig), a.record.payload.check,
      replies.some((r) => JSON.stringify(r).includes(env.props.get(KEY)) || JSON.stringify(r).includes(cell.check.sig))],
    [false, false, true, true, { as: 'lead', lane: 'PN1' }, false]);
  const ok = env.as('bob@corp.com', 'getThresholdProposals');
  t('a signed decision verifies: state approved, check { as, lane } without sig, checksVerified true, unverified 0',
    [ok.proposals.map((e) => [e.state, e.check]), ok.records.map((r) => r.payload.check || null), ok.checksVerified, ok.unverified],
    [[['approved', { as: 'lead', lane: 'PN1' }]], [null, { as: 'lead', lane: 'PN1' }], true, 0]);
  // Tampering: the same row with its to changed by hand (1.5 -> 1.6), then with its status changed to rejected.
  const orig = tab.rows[tab.rows.length - 1][4];
  tab.rows[tab.rows.length - 1][4] = "'" + JSON.stringify(Object.assign({}, cell, { to: 1.6 }));
  const tampered = env.as('bob@corp.com', 'getThresholdProposals');
  tab.rows[tab.rows.length - 1][4] = "'" + JSON.stringify(Object.assign({}, cell, { status: 'rejected' }));
  const tampered2 = env.as('bob@corp.com', 'getThresholdProposals');
  tab.rows[tab.rows.length - 1][4] = orig;
  t('a hand edit of a signed row (its to, or its status) breaks the signature: the proposal shows as unchecked, unverified 1',
    [tampered.proposals.map((e) => [e.state, e.check]), tampered.unverified, tampered2.proposals.map((e) => [e.state, e.check]), tampered2.unverified],
    [[['unchecked', null]], 1, [['unchecked', null]], 1]);
  // Forged rows typed into the Sheet: a check with no sig, and one with a made-up sig.
  const p2 = propose(env, 'alice@corp.com', Object.assign({}, PROPOSAL, { vvd: 'YNDT0604W' }));
  env.team.tab('ThresholdLog').rows.push(['forged-1', 'YNDT0604W', '', 'threshold',
    `'${JSON.stringify({ field: 'overall', from: 1.15, to: 1.5, reason: 'typed in', status: 'approved', check: { as: 'admin', lane: '' } })}`, ADMIN, "'2026-10-31T15:00:00.000Z", p2.id]);
  const p3 = propose(env, 'alice@corp.com', Object.assign({}, PROPOSAL, { vvd: 'NRET0084E' }));
  env.team.tab('ThresholdLog').rows.push(['forged-2', 'NRET0084E', '', 'threshold',
    `'${JSON.stringify({ field: 'overall', from: 1.15, to: 1.5, reason: 'typed in', status: 'approved', check: { as: 'lead', lane: 'AL5', sig: 'a'.repeat(64) } })}`, 'lead.al5@corp.com', "'2026-10-31T15:00:00.000Z", p3.id]);
  const forged = env.as('bob@corp.com', 'getThresholdProposals');
  t('forged approvals typed into the Sheet (a check with no sig, a check with a made-up sig) show as unchecked; the real one still verifies',
    [forged.proposals.map((e) => [e.vvd, e.state]).sort(), forged.unverified],
    [[['CQAT0015W', 'approved'], ['NRET0084E', 'unchecked'], ['YNDT0604W', 'unchecked']], 2]);
  env.props.delete(KEY);
  const nokey = env.as('bob@corp.com', 'getThresholdProposals');
  t('the key missing (deleted from Script Properties): every check is unverified, so every decided proposal is unchecked (fail closed), and the read does not make a key',
    [nokey.proposals.map((e) => e.state), nokey.unverified, env.props.has(KEY)], [['unchecked', 'unchecked', 'unchecked'], 3, false]);
}
{
  const env = makeEnv();
  const p = propose(env, 'alice@corp.com');
  const b = env.as('bob@corp.com', 'saveThresholdChange', Object.assign({}, PROPOSAL, { supersedes: p.id }));
  t('laundering: when bob re-proposes the very value alice proposed, alice (a PN1 lead) still cannot approve it (own-proposal), nor can bob; another lead can',
    [fail(env.as('alice@corp.com', 'decideThresholdProposal', { id: b.record.id, status: 'approved', reason: 'ok' })),
      fail(env.as('bob@corp.com', 'decideThresholdProposal', { id: b.record.id, status: 'approved', reason: 'ok' })),
      env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: b.record.id, status: 'approved', reason: 'ok' }).ok],
    [{ ok: false, reason: 'own-proposal' }, { ok: false, reason: 'own-proposal' }, true]);
  const q = propose(env, 'alice@corp.com', Object.assign({}, PROPOSAL, { vvd: 'YNDT0604W' }));
  const q2 = env.as('bob@corp.com', 'saveThresholdChange', Object.assign({}, PROPOSAL, { vvd: 'YNDT0604W', to: 1.6, supersedes: q.id }));
  t('a re-proposal of a DIFFERENT value is a new value: alice may approve bob\'s 1.6',
    env.as('alice@corp.com', 'decideThresholdProposal', { id: q2.record.id, status: 'approved', reason: 'ok' }).record.payload.to, 1.6);
}
{
  const env = makeEnv();
  const p = propose(env);
  const r = env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: p.id, status: 'rejected', reason: 'no' });
  const before = env.logRows();
  t('no revival: approving a checked rejection is proposal-rejected for the lead and the admin, and writes nothing; rejecting it again is allowed',
    [fail(env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: r.record.id, status: 'approved', reason: 'changed my mind' })),
      fail(env.as(ADMIN, 'decideThresholdProposal', { id: r.record.id, status: 'approved', reason: 'ok' })), env.logRows() - before,
      env.as(ADMIN, 'decideThresholdProposal', { id: r.record.id, status: 'rejected', reason: 'still no' }).ok],
    [{ ok: false, reason: 'proposal-rejected' }, { ok: false, reason: 'proposal-rejected' }, 0, true]);
  const latest = env.as('bob@corp.com', 'getThresholdProposals').proposals[0].latestId;
  const again = env.as('bob@corp.com', 'saveThresholdChange', Object.assign({}, PROPOSAL, { reason: 'new evidence', supersedes: latest }));
  t('a new proposal after the rejection can be approved (by a lead who did not propose it)',
    env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: again.record.id, status: 'approved', reason: 'ok now' }).ok, true);
  const u = propose(env, 'alice@corp.com', Object.assign({}, PROPOSAL, { vvd: 'YNDT0604W' }));
  const ur = env.as('bob@corp.com', 'saveThresholdChange', Object.assign({}, PROPOSAL, { vvd: 'YNDT0604W', status: 'rejected', supersedes: u.id }));
  t('an UNCHECKED rejection (the 2a-3 path, no signed check) does not block: a lead may approve over it',
    env.as('ryan.t@corp.com', 'decideThresholdProposal', { id: ur.record.id, status: 'approved', reason: 'ok' }).ok, true);
  const f = propose(env, 'alice@corp.com', Object.assign({}, PROPOSAL, { vvd: 'NRET0084E' }));
  env.team.tab('ThresholdLog').rows.push(['forged-rej', 'NRET0084E', '', 'threshold',
    `'${JSON.stringify({ field: 'overall', from: 1.15, to: 1.5, reason: 'typed in', status: 'rejected', check: { as: 'admin', lane: '', sig: 'b'.repeat(64) } })}`, ADMIN, "'2026-10-31T23:00:00.000Z", f.id]);
  t('a FORGED checked rejection typed into the Sheet is not verified, so it does not block either: the AL5 lead may approve over it',
    env.as('lead.al5@corp.com', 'decideThresholdProposal', { id: 'forged-rej', status: 'approved', reason: 'ok' }).ok, true);
}

t('every failure reply in this file is { ok:false, reason } (plus latestId for stale-supersedes) with a fixed lower-case code, never exception text',
  failureReplies.filter((r) => r.ok !== false || !/^[a-z-]+$/.test(r.reason) ||
    JSON.stringify(Object.keys(r)) !== (r.reason === 'stale-supersedes' ? '["ok","reason","latestId"]' : '["ok","reason"]')), []);

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  failures.forEach((f) => console.error(`  - ${f}\n`));
  process.exit(1);
}
console.log('THRESHOLD_APPROVALS_CHECK_PASSED');

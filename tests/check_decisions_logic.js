/**
 * Headless check for the decision store in apps-script/TeamSheet.gs (D84 slice 2a-3, ADR-R1; 2026-10-31): saveDecision,
 * getDecisionsFor, saveThresholdChange, getThresholdLog and setupDecisionTabs.
 *
 * Runs the REAL apps-script/Shared.gs (the generated BFShared, which holds the record rules of shared/65_decisions.js) and
 * the REAL apps-script/TeamSheet.gs under Node in one vm context, plus three functions cut verbatim out of the real Code.gs
 * (activeUserEmail_, currentArchiveEmail_, assertArchiveAdmin_) and its ARCHIVE_ADMIN_KEY_. In-memory fakes stand in for
 * Session, PropertiesService, LockService (the script lock; held or free), SpreadsheetApp (one team spreadsheet whose tabs
 * keep rows; a string that starts with = reads back as #ERROR! and an unprefixed ISO time is turned into a date display, as
 * Sheets does, while a leading apostrophe stores text and is hidden on read), Utilities.getUuid (a counter) and console. The
 * clock is frozen.
 *
 * What the fakes cannot prove: the real script lock across concurrent executions, real Sheet latency and quotas, that
 * Session.getActiveUser() names the visitor under "execute as the user accessing the web app", and sharing. The /exec
 * checklist in apps-script/README.md ("Decision store (2a-3)") covers those; until Kevin runs it they are UNCONFIRMED.
 *
 * Run:  node tests/check_decisions_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const sharedGs = read('apps-script', 'Shared.gs');
const teamGs = read('apps-script', 'TeamSheet.gs');
const codeGs = read('apps-script', 'Code.gs');

/** One top-level `function NAME(` declaration cut out of Code.gs, up to its closing brace at column 0. */
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

const NOW = Date.parse('2026-10-31T14:05:09.123Z');
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T/;

function makeEnv(opts = {}) {
  const env = {
    nowMs: NOW, user: 'Alice@Corp.com', props: new Map(), tabs: [], uuid: 0, lockBusy: false, lockHeld: false, lockTries: [], releases: 0,
    errors: [], logs: [], appendThrows: null, readThrows: null, flushes: 0,
  };
  if (opts.configured !== false) env.props.set('bfrTeamSheetId', 'team-sheet-id');
  if (opts.admin) env.props.set('bfrArchiveAdmin', opts.admin);
  const display = (v) => {
    const s = String(v);
    if (s.startsWith("'")) return s.slice(1);
    if (s.startsWith('=')) return '#ERROR!';
    if (ISO_LIKE.test(s)) return '10/31/2026 14:05:09'; // Sheets turns an unprefixed date-time into a date
    return s;
  };
  function makeTab(name) {
    const tab = { name, rows: [], bold: 0, frozen: 0 };
    tab.api = {
      getName: () => name,
      getLastRow: () => tab.rows.length,
      getMaxColumns: () => 26,
      appendRow: (row) => {
        if (env.appendThrows) throw new Error(env.appendThrows);
        tab.rows.push(row.map((x) => (x === null || x === undefined ? '' : x)));
      },
      getRange: (r, c, nr = 1, nc = 1) => ({
        getDisplayValues: () => {
          if (env.readThrows) throw new Error(env.readThrows);
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = tab.rows[r - 1 + i] || [];
            const line = [];
            for (let j = 0; j < nc; j++) line.push(display(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]));
            out.push(line);
          }
          return out;
        },
        setFontWeight: () => { tab.bold++; },
      }),
      setFrozenRows: (n) => { tab.frozen = n; },
    };
    return tab;
  }
  const ss = {
    getSheetByName: (n) => { const tab = env.tabs.find((x) => x.name === n); return tab ? tab.api : null; },
    insertSheet: (n) => { const tab = makeTab(n); env.tabs.push(tab); return tab.api; },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/team-sheet-id/edit',
    getId: () => 'team-sheet-id',
  };
  env.tab = (n) => env.tabs.find((x) => x.name === n) || null;
  env.addRawRow = (tabName, row) => { let tab = env.tab(tabName); if (!tab) { ss.insertSheet(tabName); tab = env.tab(tabName); tab.rows.push(['id', 'vvd', 'polKey', 'kind', 'payload', 'author', 'createdAt', 'supersedes']); } tab.rows.push(row); };
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(env.nowMs); else super(...a); }
    static now() { return env.nowMs; }
  }
  const sandbox = {
    Date: FakeDate,
    console: { log: (...a) => env.logs.push(a.join(' ')), error: (...a) => env.errors.push(a.join(' ')), warn: (...a) => env.logs.push(a.join(' ')) },
    Session: {
      getActiveUser: () => ({ getEmail: () => env.user }),
      getEffectiveUser: () => ({ getEmail: () => env.user }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
        setProperty: (k, v) => { env.props.set(k, String(v)); },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (ms) => { env.lockTries.push(ms); if (env.lockBusy) return false; env.lockHeld = true; return true; },
        releaseLock: () => { env.lockHeld = false; env.releases++; },
      }),
    },
    SpreadsheetApp: {
      openById: (id) => { if (id !== 'team-sheet-id') throw new Error('no such sheet'); return ss; },
      flush: () => { env.flushes++; },
    },
    Utilities: { getUuid: () => `00000000-0000-4000-8000-${String(++env.uuid).padStart(12, '0')}` },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${sharedGs}\n${teamGs}\n${codeParts}\n`, sandbox, { filename: 'Shared.gs+TeamSheet.gs+Code.gs(parts)' });
  env.api = sandbox;
  // vm-realm values become plain local ones, so JSON comparison is exact.
  env.call = (name, ...args) => JSON.parse(JSON.stringify(sandbox[name](...args)));
  return env;
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ISO_NOW = '2026-10-31T14:05:09.123Z';
const failureReplies = [];
const fail = (reply) => { failureReplies.push(reply); return reply; };

console.log('\n[decisions] not configured, no identity');
{
  const env = makeEnv({ configured: false });
  t('with no team Sheet set up, each call answers not-configured and writes nothing',
    [fail(env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'x' })), fail(env.call('getDecisionsFor', ['V100'])), fail(env.call('getThresholdLog')),
      fail(env.call('saveThresholdChange', { vvd: 'V100', polKey: '', field: 'overall', from: null, to: 1.5, reason: 'r', status: 'proposed' })), env.tabs.length],
    [{ ok: false, reason: 'not-configured' }, { ok: false, reason: 'not-configured' }, { ok: false, reason: 'not-configured' }, { ok: false, reason: 'not-configured' }, 0]);
  const env2 = makeEnv();
  env2.user = '';
  t('with no user identity a save answers no-user-identity, takes no lock and writes nothing',
    [fail(env2.call('saveDecision', 'V100', '', { action: 'cut', reason: 'x' })), env2.lockTries.length, env2.tabs.length],
    [{ ok: false, reason: 'no-user-identity' }, 0, 0]);
}

console.log('\n[decisions] save: append-only, server-set fields');
{
  const env = makeEnv();
  const r1 = env.call('saveDecision', ' v100 ', 'ussav#2', { action: 'Monitor', reason: ' ~70 TEU empties, expected fall-down ', id: 'client-id', author: 'evil@x.com', createdAt: '2020-01-01T00:00:00Z' });
  t('the first save creates the Decisions tab (bold, frozen header) and returns the stored record: id from the server, author from the session (lower-cased), createdAt from the server clock; client id/author/createdAt are ignored',
    { r1, header: env.tab('Decisions').rows[0], bold: env.tab('Decisions').bold, frozen: env.tab('Decisions').frozen, rows: env.tab('Decisions').rows.length },
    { r1: { ok: true, record: { id: uuid(1), vvd: 'V100', polKey: 'USSAV#2', kind: 'decision', payload: { action: 'monitor', reason: '~70 TEU empties, expected fall-down' },
      author: 'alice@corp.com', createdAt: ISO_NOW, supersedes: '' } },
    header: ['id', 'vvd', 'polKey', 'kind', 'payload', 'author', 'createdAt', 'supersedes'], bold: 1, frozen: 1, rows: 2 });
  t('the row is written through sheetText_ (createdAt carries the text apostrophe, so Sheets keeps it as text) and is flushed under the lock, which is released',
    { row: env.tab('Decisions').rows[1], flushes: env.flushes, lockTries: env.lockTries, held: env.lockHeld, releases: env.releases },
    { row: [uuid(1), 'V100', 'USSAV#2', 'decision', '{"action":"monitor","reason":"~70 TEU empties, expected fall-down"}', 'alice@corp.com', `'${ISO_NOW}`, ''],
      flushes: 1, lockTries: [10000], held: false, releases: 1 });
  const before = JSON.stringify(env.tab('Decisions').rows);
  env.nowMs += 60000;
  env.user = 'Bob@Corp.com';
  const r2 = env.call('saveDecision', 'V100', 'USSAV#2', { action: 'freeze', reason: 'Bob disagrees' });
  t('a second save on the same key APPENDS (the first row is unchanged); a second person is attributed by the session',
    { ok: r2.ok, author: r2.record.author, rows: env.tab('Decisions').rows.length, firstUnchanged: JSON.stringify(env.tab('Decisions').rows.slice(0, 2)) === before },
    { ok: true, author: 'bob@corp.com', rows: 3, firstUnchanged: true });
  const got = env.call('getDecisionsFor', ['v100']);
  t('getDecisionsFor returns both records and the latest per key (the newer, Bob\'s), with each author',
    { ids: got.records.map((r) => [r.id, r.author]), latest: got.latest.map((r) => [r.id, r.payload.action, r.author]), skipped: got.skipped },
    { ids: [[uuid(1), 'alice@corp.com'], [uuid(2), 'bob@corp.com']], latest: [[uuid(2), 'freeze', 'bob@corp.com']], skipped: 0 });

  env.nowMs += 60000;
  const r3 = env.call('saveDecision', 'V100', 'USSAV#2', { action: 'cut', reason: 'correction', supersedes: uuid(2) });
  const after = env.call('getDecisionsFor', ['V100']);
  t('a correction is a new row naming the row it supersedes; the superseded row stays in the Sheet; latest is the correction',
    { ok: r3.ok, supersedes: r3.record.supersedes, rows: env.tab('Decisions').rows.length, latest: after.latest.map((r) => r.id) },
    { ok: true, supersedes: uuid(2), rows: 4, latest: [uuid(3)] });
  const rowsBefore = env.tab('Decisions').rows.length;
  t('supersedes must name an existing record of the SAME key: unknown -> unknown-supersedes, another polKey or VVD -> supersedes-other-key, itself is impossible; nothing is written',
    [fail(env.call('saveDecision', 'V100', 'USSAV#2', { action: 'cut', reason: 'x', supersedes: 'nope' })),
      fail(env.call('saveDecision', 'V100', 'USNYC', { action: 'cut', reason: 'x', supersedes: uuid(3) })),
      fail(env.call('saveDecision', 'V200', 'USSAV#2', { action: 'cut', reason: 'x', supersedes: uuid(3) })),
      fail(env.call('saveDecision', 'V100', 'USSAV#2', { action: 'cut', reason: 'x', supersedes: 'bad id!' })),
      env.tab('Decisions').rows.length - rowsBefore, env.lockHeld],
    [{ ok: false, reason: 'unknown-supersedes' }, { ok: false, reason: 'supersedes-other-key' }, { ok: false, reason: 'supersedes-other-key' },
      { ok: false, reason: 'invalid-supersedes' }, 0, false]);
}

console.log('\n[decisions] validation: fixed codes, nothing written');
{
  const env = makeEnv();
  const cases = [
    [['VMS', '', { action: 'cut', reason: 'x' }], 'invalid-vvd'], [['', '', { action: 'cut', reason: 'x' }], 'invalid-vvd'], [[{ a: 1 }, '', { action: 'cut', reason: 'x' }], 'invalid-vvd'],
    [['V100', 5, { action: 'cut', reason: 'x' }], 'invalid-polkey'], [['V100', '', { action: 'delete', reason: 'x' }], 'invalid-action'],
    [['V100', '', { action: 'cut', reason: '  ' }], 'invalid-reason'], [['V100', '', { action: 'cut' }], 'invalid-reason'],
    [['V100', '', { action: 'cut', reason: 'r'.repeat(1001) }], 'reason-too-long'], [['V100', '', { action: 'cut', reason: 'r'.repeat(9000) }], 'payload-too-large'],
    [['V100', '', null], 'invalid-payload'], [['V100', '', 'cut'], 'invalid-payload'], [['V100', '', ['cut', 'x']], 'invalid-payload'], [['V100', ''], 'invalid-payload'],
  ];
  t('each bad argument gives its fixed code; no tab is created, no row written, no lock taken',
    { codes: cases.map(([args]) => fail(env.call('saveDecision', ...args)).reason), tabs: env.tabs.length, locks: env.lockTries.length },
    { codes: cases.map(([, code]) => code), tabs: 0, locks: 0 });
  const cyc = { action: 'cut', reason: 'x' };
  cyc.self = cyc;
  t('a payload that cannot be serialised is invalid-payload (never a thrown error)', fail(env.call('saveDecision', 'V100', '', cyc)), { ok: false, reason: 'invalid-payload' });
}

console.log('\n[decisions] busy and errors');
{
  const env = makeEnv();
  env.lockBusy = true;
  t('with the script lock held elsewhere a save answers busy and writes nothing',
    [fail(env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'x' })), env.tabs.length], [{ ok: false, reason: 'busy' }, 0]);
  env.lockBusy = false;
  env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'x' });
  env.appendThrows = 'Exception: Service error at https://docs.google.com/spreadsheets/d/team-sheet-id/edit (quota)';
  const r = fail(env.call('saveDecision', 'V100', '', { action: 'roll', reason: 'y' }));
  t('a Sheet error answers exactly { ok:false, reason:"error" }: no exception text or Sheet URL reaches the client; the detail is logged; the lock is released',
    { r, logged: env.errors.some((e) => e.includes('Service error')), held: env.lockHeld },
    { r: { ok: false, reason: 'error' }, logged: true, held: false });
  env.appendThrows = null;
  env.addRawRow('ThresholdLog', ['hand-1', 'V100', '', 'threshold', '{}', 'x@corp.com', "'2026-10-31T14:00:00Z", '']);
  env.readThrows = 'Exception: read failed at https://docs.google.com/spreadsheets/d/team-sheet-id';
  t('a read error answers { ok:false, reason:"error" } for getDecisionsFor, getThresholdLog and a superseding save (which reads under the lock)',
    [fail(env.call('getDecisionsFor', ['V100'])), fail(env.call('getThresholdLog')), fail(env.call('saveDecision', 'V100', '', { action: 'roll', reason: 'y', supersedes: uuid(1) })), env.lockHeld],
    [{ ok: false, reason: 'error' }, { ok: false, reason: 'error' }, { ok: false, reason: 'error' }, false]);
}

console.log('\n[decisions] getDecisionsFor');
{
  const env = makeEnv();
  t('before any save there is no tab: getDecisionsFor answers an empty list and does not create the tab',
    [env.call('getDecisionsFor', ['V100']), env.tabs.length], [{ ok: true, records: [], latest: [], skipped: 0 }, 0]);
  env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'a' });
  env.nowMs += 1000;
  env.call('saveDecision', 'V200', '', { action: 'roll', reason: 'b' });
  env.addRawRow('Decisions', ['hand-1', 'V100', '', 'decision', '{broken json', 'x@corp.com', ISO_NOW, '']);
  env.addRawRow('Decisions', ['hand-2', 'V100', '', 'decision', '{"action":"cut","reason":"z"}', 'x@corp.com', 'not a time', '']);
  // A record on V300 that supersedes V100's (written by hand; the server refuses this, a person editing the Sheet can not be stopped).
  env.addRawRow('Decisions', ['hand-3', 'V300', '', 'decision', '{"action":"monitor","reason":"moved"}', 'x@corp.com', "'2026-10-31T15:00:00.000Z", uuid(1)]);
  const got = env.call('getDecisionsFor', ['V100', ' v100 ', 'bad vvd!', null, { x: 1 }]);
  t('getDecisionsFor: only the asked VVDs plus a record of another VVD that supersedes one of them; bad rows are counted in skipped; bad entries are named in invalid; latest is limited to the asked VVDs',
    { ids: got.records.map((r) => r.id), latest: got.latest, skipped: got.skipped, invalid: got.invalid },
    { ids: [uuid(1), 'hand-3'], latest: [], skipped: 2, invalid: ['bad vvd!', 'null', 'object'] });
  t('getDecisionsFor: not an array is invalid-vvds; 201 VVDs is too-many-vvds; 200 is fine',
    [fail(env.call('getDecisionsFor', 'V100')), fail(env.call('getDecisionsFor', null)), fail(env.call('getDecisionsFor', Array.from({ length: 201 }, (_, i) => `V${i + 100}`))),
      env.call('getDecisionsFor', Array.from({ length: 200 }, (_, i) => `V${i + 100}`)).ok],
    [{ ok: false, reason: 'invalid-vvds' }, { ok: false, reason: 'invalid-vvds' }, { ok: false, reason: 'too-many-vvds' }, true]);
}

console.log('\n[decisions] threshold log');
{
  const env = makeEnv();
  const p = env.call('saveThresholdChange', { vvd: 'V100', polKey: 'USNYC#2', field: 'loading', from: 1.0, to: 1.2, reason: 'lane SPC asked', status: 'proposed' });
  t('a proposal creates the ThresholdLog tab (not Decisions) with the same header and stores the change',
    { ok: p.ok, payload: p.record.payload, kind: p.record.kind, tabs: env.tabs.map((x) => x.name), header: env.tab('ThresholdLog').rows[0] },
    { ok: true, payload: { field: 'loading', from: 1, to: 1.2, reason: 'lane SPC asked', status: 'proposed' }, kind: 'threshold', tabs: ['ThresholdLog'],
      header: ['id', 'vvd', 'polKey', 'kind', 'payload', 'author', 'createdAt', 'supersedes'] });
  t('approved or rejected must supersede an earlier record (needs-supersedes); an overall threshold with a polKey, a to of 0 and a bad status are refused; nothing is written',
    [fail(env.call('saveThresholdChange', { vvd: 'V100', polKey: 'USNYC#2', field: 'loading', from: 1.0, to: 1.2, reason: 'ok', status: 'approved' })),
      fail(env.call('saveThresholdChange', { vvd: 'V100', polKey: 'USNYC#2', field: 'overall', from: 1.0, to: 1.2, reason: 'ok', status: 'proposed' })),
      fail(env.call('saveThresholdChange', { vvd: 'V100', polKey: 'USNYC#2', field: 'loading', from: 1.0, to: 0, reason: 'ok', status: 'proposed' })),
      fail(env.call('saveThresholdChange', { vvd: 'V100', polKey: 'USNYC#2', field: 'loading', from: 1.0, to: 1.2, reason: 'ok', status: 'live' })),
      fail(env.call('saveThresholdChange', 'nope')), env.tab('ThresholdLog').rows.length],
    [{ ok: false, reason: 'needs-supersedes' }, { ok: false, reason: 'invalid-polkey' }, { ok: false, reason: 'invalid-to' }, { ok: false, reason: 'invalid-status' },
      { ok: false, reason: 'invalid-payload' }, 2]);
  env.nowMs += 3600000;
  env.user = 'kevin@corp.com';
  const a = env.call('saveThresholdChange', { vvd: 'V100', polKey: 'USNYC#2', field: 'loading', from: 1.0, to: 1.2, reason: 'approved', status: 'Approved', supersedes: p.record.id });
  const log = env.call('getThresholdLog');
  t('an approval superseding the proposal is one log entry: the approver and status from the latest row, the proposer from the first, liveInFeed null on the server',
    { ok: a.ok, log: log.log.map((e) => [e.id, e.latestId, e.status, e.proposedBy, e.updatedBy, e.records, e.liveInFeed, e.stage]), skipped: log.skipped },
    { ok: true, log: [[p.record.id, a.record.id, 'approved', 'alice@corp.com', 'kevin@corp.com', 2, null, 'approved']], skipped: 0 });
  t('getThresholdLog(since): an ISO time filters by the latest update; a bad since is invalid-since',
    [env.call('getThresholdLog', '2026-10-31T15:00:00Z').log.length, env.call('getThresholdLog', '2026-10-31T15:05:09.124Z').log.length, env.call('getThresholdLog', '').log.length,
      fail(env.call('getThresholdLog', 'yesterday')), fail(env.call('getThresholdLog', 12345)), fail(env.call('getThresholdLog', '2026-10-31'))],
    [1, 0, 1, { ok: false, reason: 'invalid-since' }, { ok: false, reason: 'invalid-since' }, { ok: false, reason: 'invalid-since' }]);
  t('a threshold save never touches the Decisions tab, and a decision save never the ThresholdLog tab',
    (() => { env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'x' }); return [env.tab('ThresholdLog').rows.length, env.tab('Decisions').rows.length]; })(), [3, 2]);
}

console.log('\n[decisions] setupDecisionTabs');
{
  const env = makeEnv({ admin: 'admin@corp.com' });
  env.user = 'admin@corp.com';
  const r = env.call('setupDecisionTabs');
  const again = env.call('setupDecisionTabs');
  env.user = 'visitor@corp.com';
  let refused = null;
  try { env.api.setupDecisionTabs(); } catch (err) { refused = String(err.message); }
  t('setupDecisionTabs (admin only) creates both tabs with their header; a re-run changes nothing; another account is refused',
    { r: r.ok, again: again.ok, tabs: env.tabs.map((x) => [x.name, x.rows.length, x.frozen]), refused: /Only the archive admin/.test(refused) },
    { r: true, again: true, tabs: [['Decisions', 1, 1], ['ThresholdLog', 1, 1]], refused: true });
  const env2 = makeEnv();
  env2.user = 'someone@corp.com';
  let noAdmin = null;
  try { env2.api.setupDecisionTabs(); } catch (err) { noAdmin = String(err.message); }
  t('with no admin recorded, setupDecisionTabs never claims the role (it throws and sets nothing)',
    [/Not set up yet/.test(noAdmin), env2.props.has('bfrArchiveAdmin'), env2.tabs.length], [true, false, 0]);
}

console.log('\n[decisions] review fixes (B7 on PR #287, 2026-10-31)');
{
  // 1. An approval decides a value; it never changes it.
  const env = makeEnv();
  const P = { vvd: 'V100', polKey: 'USNYC#2', field: 'loading', from: 1.0, to: 1.2, reason: 'lane asked', status: 'proposed' };
  const p = env.call('saveThresholdChange', P);
  env.user = 'bob@corp.com';
  const rows = () => env.tab('ThresholdLog').rows.length;
  const before = rows();
  t('review 1: an approval or rejection with another to, from or field than the proposal it supersedes is changed-value and writes nothing',
    [fail(env.call('saveThresholdChange', Object.assign({}, P, { to: 9.99, status: 'approved', supersedes: p.record.id }))),
      fail(env.call('saveThresholdChange', Object.assign({}, P, { from: null, status: 'rejected', supersedes: p.record.id }))),
      fail(env.call('saveThresholdChange', Object.assign({}, P, { from: 1.1, status: 'approved', supersedes: p.record.id }))), rows() - before],
    [{ ok: false, reason: 'changed-value' }, { ok: false, reason: 'changed-value' }, { ok: false, reason: 'changed-value' }, 0]);
  const same = env.call('saveThresholdChange', Object.assign({}, P, { polKey: 'usnyc#02', from: 1.0 + 1e-12, status: 'approved', reason: 'ok', supersedes: p.record.id }));
  const env2 = makeEnv();
  const p2 = env2.call('saveThresholdChange', P);
  const re = env2.call('saveThresholdChange', Object.assign({}, P, { to: 1.3, status: 'proposed', reason: 'make it 1.3', supersedes: p2.record.id }));
  t('review 1 and 4: the same values (within 1e-9, port key written usnyc#02) are accepted; a re-proposal (status proposed) may change the value; the log shows the proposal\'s value',
    { same: same.ok, polKey: same.record.polKey, re: re.ok, log: env.call('getThresholdLog').log.map((e) => [e.to, e.status, e.updatedBy]), log2: env2.call('getThresholdLog').log.map((e) => [e.to, e.status]) },
    { same: true, polKey: 'USNYC#2', re: true, log: [[1.2, 'approved', 'bob@corp.com']], log2: [[1.3, 'proposed']] });
}
{
  // 2. Supersedes is a compare-and-swap.
  const env = makeEnv();
  const d1 = env.call('saveDecision', 'V100', '', { action: 'monitor', reason: 'a' });
  env.nowMs += 1000;
  const d2 = env.call('saveDecision', 'V100', '', { action: 'freeze', reason: 'b', supersedes: d1.record.id });
  const before = env.tab('Decisions').rows.length;
  const stale = env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'c', supersedes: d1.record.id });
  failureReplies.push({ ok: stale.ok, reason: stale.reason });
  t('review 2: a second correction of a row that is already superseded is stale-supersedes, with the key\'s current latest id, and writes nothing; correcting the latest works',
    { stale, written: env.tab('Decisions').rows.length - before, next: env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'c', supersedes: d2.record.id }).ok, held: env.lockHeld },
    { stale: { ok: false, reason: 'stale-supersedes', latestId: d2.record.id }, written: 0, next: true, held: false });
  const P = { vvd: 'V100', polKey: '', field: 'overall', from: null, to: 1.5, reason: 'r', status: 'proposed' };
  const p = env.call('saveThresholdChange', P);
  env.nowMs += 1000;
  const a = env.call('saveThresholdChange', Object.assign({}, P, { status: 'approved', supersedes: p.record.id }));
  const r = env.call('saveThresholdChange', Object.assign({}, P, { status: 'rejected', supersedes: p.record.id }));
  failureReplies.push({ ok: r.ok, reason: r.reason });
  t('review 2: thresholds too: a rejection of a proposal that was already approved is stale-supersedes naming the approval',
    [a.ok, r], [true, { ok: false, reason: 'stale-supersedes', latestId: a.record.id }]);
}
{
  // 3. Rows named like Object.prototype members never empty a server read.
  const env = makeEnv();
  const good = env.call('saveThresholdChange', { vvd: 'V100', polKey: '', field: 'overall', from: null, to: 1.5, reason: 'r', status: 'proposed' });
  env.addRawRow('ThresholdLog', ['x1', 'V900', '', 'threshold', '{"field":"overall","from":null,"to":1.3,"reason":"r","status":"proposed"}', 'h@corp.com', "'2026-10-31T15:00:00.000Z", 'sPrototypeOf']);
  env.addRawRow('ThresholdLog', ['constructor', 'V901', '', 'threshold', '{"field":"overall","from":null,"to":1.3,"reason":"r","status":"proposed"}', 'h@corp.com', "'2026-10-31T15:00:00.000Z", 'toString']);
  env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'x' });
  env.addRawRow('Decisions', ['sPrototypeOf', 'V100', '', 'decision', '{"action":"roll","reason":"y"}', 'h@corp.com', "'2026-10-31T15:00:00.000Z", '']);
  env.addRawRow('Decisions', ['h2', 'V300', '', 'decision', '{"action":"monitor","reason":"z"}', 'h@corp.com', "'2026-10-31T16:00:00.000Z", 'hasOwnProperty']);
  const log = env.call('getThresholdLog');
  const dec = env.call('getDecisionsFor', ['V100']);
  t('review 3: hand rows with ids or supersedes such as sPrototypeOf, constructor, toString, hasOwnProperty are ordinary rows: getThresholdLog and getDecisionsFor still answer everything',
    { log: log.log.map((e) => e.id).sort(), decs: dec.records.map((r) => r.id).sort(), latest: dec.latest.map((r) => r.id) },
    { log: ['constructor', good.record.id, 'x1'].sort(), decs: [uuid(2), 'sPrototypeOf'].sort(), latest: ['sPrototypeOf'] });
}
{
  // 5 and 6.
  const env = makeEnv();
  env.call('saveDecision', 'V100', '', { action: 'cut', reason: 'x' });
  env.call('saveThresholdChange', { vvd: 'V100', polKey: '', field: 'overall', from: null, to: 1.5, reason: 'r', status: 'proposed' });
  env.addRawRow('Decisions', ['t-in-dec', 'V100', '', 'threshold', '{"field":"overall","from":null,"to":1.3,"reason":"r","status":"proposed"}', 'h@corp.com', "'2026-10-31T15:00:00.000Z", '']);
  env.addRawRow('ThresholdLog', ['d-in-log', 'V100', '', 'decision', '{"action":"roll","reason":"y"}', 'h@corp.com', "'2026-10-31T15:00:00.000Z", '']);
  t('review 5: since on an impossible calendar day (2026-02-31) or hour (24) is invalid-since',
    [fail(env.call('getThresholdLog', '2026-02-31T00:00:00Z')), fail(env.call('getThresholdLog', '2026-10-31T24:00:00Z')), env.call('getThresholdLog', '2026-10-31T00:00:00Z').log.length],
    [{ ok: false, reason: 'invalid-since' }, { ok: false, reason: 'invalid-since' }, 1]);
  t('review 6: getDecisionsFor returns only decision records and getThresholdLog only threshold records, whatever a hand edit put in their tab',
    [env.call('getDecisionsFor', ['V100']).records.map((r) => r.kind), env.call('getThresholdLog').log.map((e) => e.id === 'd-in-log')],
    [['decision'], [false]]);
  const env2 = makeEnv({ admin: 'admin@corp.com' });
  env2.user = 'admin@corp.com';
  env2.lockBusy = true;
  const busy = env2.call('setupDecisionTabs');
  env2.lockBusy = false;
  const okRun = env2.call('setupDecisionTabs');
  t('review 6: setupDecisionTabs takes the script lock: busy when it is held (no tab made), and it releases it after creating the tabs',
    { busy, tabsWhenBusy: busy.ok ? -1 : 0, ok: okRun.ok, tabs: env2.tabs.length, held: env2.lockHeld, tries: env2.lockTries },
    { busy: { ok: false, reason: 'busy' }, tabsWhenBusy: 0, ok: true, tabs: 2, held: false, tries: [10000, 10000] });
}

console.log('\n[decisions] rollTo and seen (slice 2b-2, the decision card; additive)');
{
  const env = makeEnv();
  const seen = { curLaden: 1640, ceiling: 1451, threshold: 1.2, declaredFinal: null, fallDownPct: null, epAsOf: null, dataAsOf: '2026-09-01', junk: 'x' };
  const r = env.call('saveDecision', 'V100', 'USSAV', { action: 'roll', reason: 'move to next week', rollTo: ' v101 ', seen });
  const row = env.tab('Decisions').rows[1];
  t('2b-2: saveDecision stores rollTo (normalised) and seen (known keys only) in the payload JSON, and getDecisionsFor reads them back',
    { ok: r.ok, payload: r.record.payload, cell: row[4], back: env.call('getDecisionsFor', ['V100']).records[0].payload },
    { ok: true, payload: { action: 'roll', reason: 'move to next week', rollTo: 'V101', seen: { curLaden: 1640, ceiling: 1451, threshold: 1.2, declaredFinal: null, fallDownPct: null, epAsOf: null, dataAsOf: '2026-09-01' } },
      cell: '{"action":"roll","reason":"move to next week","rollTo":"V101","seen":{"curLaden":1640,"ceiling":1451,"threshold":1.2,"declaredFinal":null,"fallDownPct":null,"epAsOf":null,"dataAsOf":"2026-09-01"}}',
      back: { action: 'roll', reason: 'move to next week', rollTo: 'V101', seen: { curLaden: 1640, ceiling: 1451, threshold: 1.2, declaredFinal: null, fallDownPct: null, epAsOf: null, dataAsOf: '2026-09-01' } } });
  const before = env.tab('Decisions').rows.length;
  t('2b-2: a bad rollTo or seen is refused with its fixed code and writes nothing; a payload with neither is stored as before',
    [fail(env.call('saveDecision', 'V100', 'USSAV', { action: 'roll', reason: 'x', rollTo: 'VMS', supersedes: r.record.id })),
      fail(env.call('saveDecision', 'V100', 'USSAV', { action: 'roll', reason: 'x', seen: { curLaden: '1' }, supersedes: r.record.id })),
      env.tab('Decisions').rows.length - before,
      env.call('saveDecision', 'V100', 'USSAV', { action: 'monitor', reason: 'plain', supersedes: r.record.id }).record.payload],
    [{ ok: false, reason: 'invalid-roll-to' }, { ok: false, reason: 'invalid-seen' }, 0, { action: 'monitor', reason: 'plain' }]);
  t('2b-2 review: rollTo sent with a non-Roll action is dropped by the server (Monitor with rollTo stores only action and reason)',
    env.call('saveDecision', 'V300', '', { action: 'monitor', reason: 'not a roll', rollTo: 'V301' }).record.payload,
    { action: 'monitor', reason: 'not a roll' });
  t('2b-2: a reason that looks like a formula or markup is stored as text with rollTo and seen beside it (the cell reads back unchanged)',
    env.call('saveDecision', 'V200', '', { action: 'cut', reason: '=HYPERLINK("x")\n<img onerror=1>', seen: { curLaden: 5 } }).record.payload,
    { action: 'cut', reason: '=HYPERLINK("x")\n<img onerror=1>', seen: { curLaden: 5 } });
}

t('every failure reply in this file is exactly { ok:false, reason } with a fixed lower-case code (no error text field)',
  failureReplies.filter((r) => JSON.stringify(Object.keys(r)) !== '["ok","reason"]' || r.ok !== false || !/^[a-z-]+$/.test(r.reason)), []);

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  failures.forEach((f) => console.error(`  - ${f}\n`));
  process.exit(1);
}
console.log('DECISIONS_LOGIC_CHECK_PASSED');

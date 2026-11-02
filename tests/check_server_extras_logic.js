/**
 * Headless check for the pure-logic pieces of the 2026-09-28 server-extras
 * extension (filter-prefs sync, "Export to Drive") -- see docs/SERVER_PREFS_CONTRACT.md's "Addendum
 * (2026-09-28)" and Code.gs's own comment above readServerExtras_ for the
 * full design.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BROWSER SUITE
 *
 * Same reasoning as check_server_prefs_logic.js, which this file mirrors
 * structurally: almost nothing about the server round trip can be tested on
 * a dev machine (google.script.run only exists inside the Apps Script
 * sandbox), but the decision logic around it -- IS the sync channel
 * available, WHICH rows survive into a snapshot -- is pure logic with no DOM and no network. This
 * pulls those blocks straight out of the app HTML and runs them under Node
 * with fake globals, so it tests the REAL shipped code, not a
 * reimplementation of what it is supposed to do.
 *
 * WHAT THIS DELIBERATELY DOES NOT COVER: dateScheduleLink/openScheduleLink
 * (the date-cell OPUS vessel schedule link) are NOT extracted here -- they depend on
 * parseKnownDate, which lives far away in the file (used by formatDate/
 * formatDateOnly too), and pulling that dependency chain in as well would
 * make this check fragile to unrelated formatting changes. That feature's
 * coverage lives in the browser suite instead (see
 * tests/booking_flash_regression_tests.js's OPUS_Schedule_Link suite),
 * where the whole file is loaded and there is no extraction boundary to get
 * wrong. The last block runs apps-script/Code.gs itself under fake Apps
 * Script services (Session/PropertiesService/Utilities/DriveApp/
 * ...) to cover saveUserFilterPrefs, including the Reset-to-defaults
 * delete -- logic only; the fakes cannot tell you the real services behave the same.
 * The per-visitor store block (2026-10-06) runs Code.gs against a fake with BOTH
 * property stores (script: one for everybody; user: one per effective user) and
 * covers the three booleans (readUserPrefs_ / saveUserPref) and the filter blob:
 * isolation between two visitors, the lazy migration from the old
 * email-namespaced script keys (including a failed copy), the fallback to the
 * old script keys when the script does not run as the visitor, and the
 * quota / unavailable error paths. Whether the real getUserProperties() is
 * per visitor on the deployment is a production question (apps-script/README.md).
 * Likewise, this does NOT prove the actual server round trip works,
 * that PropertiesService isolates users, or that DriveApp calls
 * succeed -- see apps-script/README.md's own checklist for the parts only
 * production can answer.
 *
 * Run:  node tests/check_server_extras_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

// Which app file is "current" is decided in one place: scripts/lib/app_file.js pickCurrentAppHtml.
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

let appPath;
try { appPath = findCurrentAppHtml(); } catch (err) { console.error(err.message); process.exit(1); }
console.log(`(main app file: ${path.basename(appPath)})`);
const src = fs.readFileSync(appPath, 'utf8');

function extract(startMarker, endMarker, label) {
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    console.error(`FAILED: could not locate the ${label} block in the app file (markers moved?).`);
    console.error('If it was renamed or moved, update the markers here -- do NOT');
    console.error('delete this check, and do not let it pass by finding nothing.');
    process.exit(1);
  }
  return src.slice(startIdx, endIdx);
}

// Same transform-not-reslice technique as check_server_prefs_logic.js (see
// its own long comment for why): JSX/comments in between must still parse,
// classic runtime so `React.createElement` stays a harmless bare reference
// inside code this check never calls.
const toFunctionBody = (rawBlock) => babel.transformSync(rawBlock, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  sourceType: 'script',
  configFile: false,
  babelrc: false,
}).code;

const extrasBlock = toFunctionBody(extract('const SERVER_EXTRAS = ', '// TWO-PHASE TIMEOUT', 'server-extras'));
const snapshotBlock = toFunctionBody(extract('const buildSnapshotRows = ', 'const normalizeApStatus = ', 'snapshot-rows'));

function loadExtras({ serverExtras, hasGoogle = false }) {
  const win = { __SERVER_EXTRAS__: serverExtras };
  const google = hasGoogle ? { script: { run: {} } } : undefined;
  return new Function(
    'window', 'google',
    extrasBlock + '\n; return {isServerExtrasSyncAvailable};'
  )(win, google);
}

function loadSnapshot() {
  return new Function(snapshotBlock + '\n; return {buildSnapshotRows};')();
}

let pass = 0;
const failures = [];
function t(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
  } else {
    failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
}

// --- isServerExtrasSyncAvailable: structural only, mirrors isServerPrefSyncAvailable's own checks ---
t('sync available when __SERVER_EXTRAS__ exists and google.script.run exists',
  loadExtras({ serverExtras: { filterPrefs: { available: false } }, hasGoogle: true }).isServerExtrasSyncAvailable(), true);
t('sync unavailable without the google global',
  loadExtras({ serverExtras: { filterPrefs: { available: false } }, hasGoogle: false }).isServerExtrasSyncAvailable(), false);
t('sync unavailable when __SERVER_EXTRAS__ itself is absent (localhost)',
  loadExtras({ serverExtras: undefined, hasGoogle: true }).isServerExtrasSyncAvailable(), false);
// Deliberately does NOT gate on filterPrefs.available -- Export to Drive has
// no dependency on the filter-prefs identity lookup, so the channel is
// "available" as long as the global itself was injected, independent of
// whether this VISITOR's filter-prefs identity resolved.
t('sync available even when filterPrefs.available is false (identity did not resolve for THIS visitor)',
  loadExtras({ serverExtras: { filterPrefs: { available: false, reason: 'no-user-identity' } }, hasGoogle: true }).isServerExtrasSyncAvailable(), true);

// --- buildSnapshotRows ---
const cols = [
  { header: 'VVD', get: (r) => r.vvd },
  { header: 'Vessel', get: (r) => r.vessel },
];
const snap = loadSnapshot();
t('maps rows through the given column spec',
  snap.buildSnapshotRows([{ vvd: 'ABC123S', vessel: 'EVER GIVEN' }], cols),
  [{ VVD: 'ABC123S', Vessel: 'EVER GIVEN' }]);
t('drops synthetic isBlankRow spacer rows (processedData lane-spacer rows)',
  snap.buildSnapshotRows([{ vvd: 'ABC123S', vessel: 'X' }, { isBlankRow: true, lane: 'TPT' }], cols),
  [{ VVD: 'ABC123S', Vessel: 'X' }]);
t('drops rows with neither a vvd nor a vessel (not a real sailing)',
  snap.buildSnapshotRows([{ vvd: 'ABC123S', vessel: 'X' }, { trade: 'TPEB', vvd: '', vessel: '' }], cols),
  [{ VVD: 'ABC123S', Vessel: 'X' }]);
t('a row with only a vessel (VMS-style placeholder VVD) still survives',
  snap.buildSnapshotRows([{ vvd: '', vessel: 'VMS' }], cols),
  [{ VVD: '', Vessel: 'VMS' }]);
t('null/undefined input returns an empty array rather than throwing',
  snap.buildSnapshotRows(null, cols), []);

// --- Code.gs server functions (2026-09-28 review fixes) ---
// Runs the REAL apps-script/Code.gs under Node with fake Apps Script services,
// so the filter-prefs save/reset logic is tested as shipped, not re-implemented.
function loadCodeGs(activeEmail) {
  const store = new Map();
  const sheets = [];
  const fakes = {
    Session: { getActiveUser: () => ({ getEmail: () => activeEmail() }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (store.has(k) ? store.get(k) : null),
        setProperty: (k, v) => { store.set(k, v); },
        deleteProperty: (k) => { store.delete(k); },
      }),
    },
    Utilities: {
      newBlob: (str) => ({ getBytes: () => Array.from(Buffer.from(str, 'utf8')) }),
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/exec' }) },
    SpreadsheetApp: {
      create: (title) => {
        const id = `sheet${sheets.length}`;
        sheets.push({ owner: activeEmail(), title });
        return { getId: () => id, getUrl: () => `https://docs.google.com/${id}`, getSheets: () => [{ getRange: () => ({ setValues() {}, setFontWeight() {} }) }] };
      },
    },
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ addFile() {} }),
      getFileById: () => ({}),
      getRootFolder: () => ({ removeFile() {} }),
    },
  };
  const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const names = Object.keys(fakes);
  const api = new Function(...names, code +
    '\n; return {saveUserFilterPrefs, readServerExtras_, prefStoreKeyFor_};')(...names.map((n) => fakes[n]));
  return { api, store, sheets };
}

let who = 'alice@corp.com';
const gs = loadCodeGs(() => who);
const blob = JSON.stringify({ v: 1, savedAt: 1, prefs: {} });
gs.api.saveUserFilterPrefs(blob);
const key = gs.api.prefStoreKeyFor_('alice@corp.com', 'bookingFlashFilterPrefs');
const beforeClear = gs.store.get(key);
gs.api.saveUserFilterPrefs('');
t('saveUserFilterPrefs(\'\') deletes the stored blob (Reset to defaults)',
  [beforeClear, gs.store.has(key)], [blob, false]);
gs.api.saveUserFilterPrefs(blob);
t('readServerExtras_ injects only the visitor\'s own filter blob (no digest fields)',
  gs.api.readServerExtras_(), { filterPrefs: { available: true, value: blob } });
t('an oversized blob is rejected without overwriting the stored one',
  [gs.api.saveUserFilterPrefs(JSON.stringify({ pad: 'x'.repeat(9000) })).reason, gs.store.get(key)], ['too-large', blob]);
who = '';
t('saving filter prefs without a resolved identity is rejected',
  gs.api.saveUserFilterPrefs(blob).reason, 'no-user-identity');

// --- Per-visitor store (2026-10-06): getUserProperties() when the script runs as the visitor ---
// The fake models both stores the way Google documents them: script properties are one Map for everybody;
// user properties are one Map per EFFECTIVE user (the account the script runs as). Under "User accessing the
// web app" the effective user is the visitor (env.active === env.effective); under "Execute as: Me" it is the
// owner for every visitor. Failure switches make one store operation throw, as a full store (quota) or an
// unavailable service does.
function loadTwoStores() {
  const env = {
    active: 'alice@corp.com', effective: 'alice@corp.com', effectiveThrows: false,
    script: new Map(), user: new Map(),
    fail: { userGet: false, userSet: false, userAll: false, scriptGet: false, scriptSet: false, scriptDelete: false },
    // Call counts, for the one-read-per-page-load checks (2026-10-07). env.resetCalls() zeroes them.
    calls: {},
  };
  env.resetCalls = () => { env.calls = { active: 0, effective: 0, userGetAll: 0, userGet: 0, userSet: 0, scriptGet: 0 }; };
  env.resetCalls();
  const boom = (what) => { throw new Error(what + ': You have exceeded the property storage quota.'); };
  const userStore = (who) => {
    if (!env.user.has(who)) env.user.set(who, new Map());
    const m = env.user.get(who);
    return {
      getProperty: (k) => { env.calls.userGet++; if (env.fail.userGet) boom('user get'); return m.has(k) ? m.get(k) : null; },
      getProperties: () => { env.calls.userGetAll++; if (env.fail.userGet) boom('user get'); return Object.fromEntries(m); },
      setProperty: (k, v) => { env.calls.userSet++; if (env.fail.userSet) boom('user set'); m.set(k, String(v)); },
      deleteProperty: (k) => { m.delete(k); },
    };
  };
  const fakes = {
    Session: {
      getActiveUser: () => { env.calls.active++; return { getEmail: () => env.active }; },
      getEffectiveUser: () => { env.calls.effective++; if (env.effectiveThrows) throw new Error('effective user unavailable'); return { getEmail: () => env.effective }; },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => { env.calls.scriptGet++; if (env.fail.scriptGet) boom('script get'); return env.script.has(k) ? env.script.get(k) : null; },
        setProperty: (k, v) => { if (env.fail.scriptSet) boom('script set'); env.script.set(k, String(v)); },
        deleteProperty: (k) => { if (env.fail.scriptDelete) boom('script delete'); env.script.delete(k); },
      }),
      getUserProperties: () => { if (env.fail.userAll) throw new Error('user properties unavailable'); return userStore(String(env.effective).toLowerCase()); },
    },
    Utilities: { newBlob: (str) => ({ getBytes: () => Array.from(Buffer.from(str, 'utf8')) }) },
  };
  const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const names = Object.keys(fakes);
  env.api = new Function(...names, code +
    '\n; return {saveUserPref, readUserPrefs_, saveUserFilterPrefs, readServerExtras_, readVisitorContext_, prefStoreKeyFor_};')(...names.map((n) => fakes[n]));
  env.as = (email, effective = email) => { env.active = email; env.effective = effective; };
  // A visitor's stored values, WITHOUT the "old keys checked" marker (2026-10-07), which the checks below
  // assert on its own, so the value checks above it read the same as before the marker existed.
  env.userMap = (who) => Object.fromEntries([...(env.user.get(who) || new Map())].filter(([k]) => k !== MARKER));
  env.marker = (who) => (env.user.get(who) || new Map()).get(MARKER);
  env.scriptPrefKeys = () => [...env.script.keys()].filter((k) => k.startsWith('bfrPref:')).sort();
  env.old = (email, key) => env.api.prefStoreKeyFor_(email, key);
  return env;
}
const DARK = 'bookingFlashDarkMode';
const AUTO = 'bookingFlashAutoRefresh';
const FREEZE = 'bookingFlashFreezePanes';
const FILTER = 'bookingFlashFilterPrefs';
const MARKER = 'bfrPref:legacyChecked';
const PROBE_STAMP = 'bookingFlashIdentityProbeStamp';
const blobOf = (who) => JSON.stringify({ v: 1, savedAt: 2, prefs: { who } });

{
  // Isolation: two visitors, each running as themselves.
  const e = loadTwoStores();
  e.as('alice@corp.com');
  const s1 = [e.api.saveUserPref(DARK, '1'), e.api.saveUserFilterPrefs(blobOf('alice'))];
  e.as('bob@corp.com');
  const s2 = [e.api.saveUserPref(DARK, '0'), e.api.saveUserPref(FREEZE, '1'), e.api.saveUserFilterPrefs(blobOf('bob'))];
  t('per-visitor store: saves report ok, unchanged shape', [s1, s2], [[{ ok: true }, { ok: true }], [{ ok: true }, { ok: true }, { ok: true }]]);
  t('per-visitor store: each value lands in the visitor\'s OWN user store under "bfrPref:<name>", and nothing in the shared script store',
    [e.userMap('alice@corp.com'), e.userMap('bob@corp.com'), e.scriptPrefKeys()],
    [{ ['bfrPref:' + DARK]: '1', ['bfrPref:' + FILTER]: blobOf('alice') },
      { ['bfrPref:' + DARK]: '0', ['bfrPref:' + FREEZE]: '1', ['bfrPref:' + FILTER]: blobOf('bob') }, []]);
  e.as('alice@corp.com');
  const aliceRead = [e.api.readUserPrefs_(), e.api.readServerExtras_()];
  e.as('bob@corp.com');
  const bobRead = [e.api.readUserPrefs_(), e.api.readServerExtras_()];
  t('per-visitor store: each visitor reads back only their own values (same shapes as before)',
    [aliceRead, bobRead],
    [[{ available: true, values: { [DARK]: '1', [AUTO]: null, [FREEZE]: null } }, { filterPrefs: { available: true, value: blobOf('alice') } }],
      [{ available: true, values: { [DARK]: '0', [AUTO]: null, [FREEZE]: '1' } }, { filterPrefs: { available: true, value: blobOf('bob') } }]]);
  t('per-visitor store: Reset to defaults (\'\') deletes only the caller\'s blob',
    [e.api.saveUserFilterPrefs(''), e.api.readServerExtras_().filterPrefs.value, e.userMap('alice@corp.com')['bfrPref:' + FILTER]], [{ ok: true }, null, blobOf('alice')]);
}

{
  // Lazy migration from the old email-namespaced script keys.
  const e = loadTwoStores();
  e.script.set(e.old('alice@corp.com', DARK), '1');
  e.script.set(e.old('alice@corp.com', FILTER), blobOf('alice-old'));
  e.script.set(e.old('bob@corp.com', DARK), '0');
  e.script.set(e.old('bob@corp.com', FILTER), blobOf('bob-old'));
  e.script.set('bfrArchiveAdmin', 'kevin@corp.com');
  e.as('alice@corp.com');
  const prefs = e.api.readUserPrefs_();
  const extras = e.api.readServerExtras_();
  t('migration: a read with nothing in the user store returns the visitor\'s old script value (prefs and filter blob)',
    [prefs, extras], [{ available: true, values: { [DARK]: '1', [AUTO]: null, [FREEZE]: null } }, { filterPrefs: { available: true, value: blobOf('alice-old') } }]);
  t('migration: the old values are copied into the visitor\'s user store and THEIR old script keys deleted; another visitor\'s keys and unrelated properties untouched',
    [e.userMap('alice@corp.com'), e.scriptPrefKeys(), e.script.get('bfrArchiveAdmin')],
    [{ ['bfrPref:' + DARK]: '1', ['bfrPref:' + FILTER]: blobOf('alice-old') }, [e.old('bob@corp.com', DARK), e.old('bob@corp.com', FILTER)].sort(), 'kevin@corp.com']);
  t('migration: the next read is served from the user store alone', [e.api.readUserPrefs_().values[DARK], e.api.readServerExtras_().filterPrefs.value], ['1', blobOf('alice-old')]);
}

{
  // A failed copy keeps the old key (nothing lost); once the store accepts writes, the next read moves it.
  const e = loadTwoStores();
  e.script.set(e.old('alice@corp.com', AUTO), '0');
  e.script.set(e.old('alice@corp.com', FILTER), blobOf('alice-old'));
  e.fail.userSet = true;
  const r = [e.api.readUserPrefs_(), e.api.readServerExtras_()];
  t('migration: when the copy fails (user store full) the read still returns the old value, and the old key is KEPT',
    [r, e.userMap('alice@corp.com'), e.scriptPrefKeys()],
    [[{ available: true, values: { [DARK]: null, [AUTO]: '0', [FREEZE]: null } }, { filterPrefs: { available: true, value: blobOf('alice-old') } }],
      {}, [e.old('alice@corp.com', AUTO), e.old('alice@corp.com', FILTER)].sort()]);
  t('migration: a failed copy does not write the "old keys checked" marker, so the next load tries again', e.marker('alice@corp.com'), undefined);
  e.fail.userSet = false;
  e.api.readUserPrefs_(); e.api.readServerExtras_();
  t('migration: ...and the next read after the store recovers completes the move',
    [e.userMap('alice@corp.com'), e.scriptPrefKeys()], [{ ['bfrPref:' + AUTO]: '0', ['bfrPref:' + FILTER]: blobOf('alice-old') }, []]);
}

{
  // Writes go to the user store and remove the visitor's leftover old key.
  const e = loadTwoStores();
  e.script.set(e.old('alice@corp.com', AUTO), '1');
  e.script.set(e.old('alice@corp.com', FILTER), blobOf('alice-old'));
  e.script.set(e.old('bob@corp.com', AUTO), '1');
  const w = [e.api.saveUserPref(AUTO, '0'), e.api.saveUserFilterPrefs(blobOf('alice-new'))];
  t('write: goes to the user store and deletes the caller\'s leftover old script key (only theirs)',
    [w, e.userMap('alice@corp.com'), e.scriptPrefKeys(), e.api.readUserPrefs_().values[AUTO]],
    [[{ ok: true }, { ok: true }], { ['bfrPref:' + AUTO]: '0', ['bfrPref:' + FILTER]: blobOf('alice-new') }, [e.old('bob@corp.com', AUTO)], '0']);
  e.script.set(e.old('alice@corp.com', FILTER), blobOf('alice-old'));
  e.fail.scriptDelete = true;
  t('write: a leftover old key that cannot be deleted does not fail a save, and the user store\'s value still wins',
    [e.api.saveUserFilterPrefs(blobOf('alice-newer')), e.api.readServerExtras_().filterPrefs.value], [{ ok: true }, blobOf('alice-newer')]);
  t('reset: when the leftover old key cannot be deleted, Reset reports properties-unavailable (that key would be migrated back on the next read)',
    e.api.saveUserFilterPrefs(''), { ok: false, reason: 'properties-unavailable' });
  e.fail.scriptDelete = false;
  t('reset: with the leftover deleted, Reset clears both and the old blob is not resurrected (bob\'s old key still untouched)',
    [e.api.saveUserFilterPrefs(''), e.api.readServerExtras_().filterPrefs.value, e.scriptPrefKeys(), 'bfrPref:' + FILTER in e.userMap('alice@corp.com')],
    [{ ok: true }, null, [e.old('bob@corp.com', AUTO)], false]);
}

{
  // Fallback: when the script does NOT run as the visitor, the old script-store behaviour, exactly.
  const e = loadTwoStores();
  e.as('alice@corp.com', 'owner@corp.com'); // "Execute as: Me": everyone runs as the owner
  e.script.set(e.old('alice@corp.com', FREEZE), '1');
  const w = [e.api.saveUserPref(DARK, '1'), e.api.saveUserFilterPrefs(blobOf('alice'))];
  e.as('bob@corp.com', 'owner@corp.com');
  e.api.saveUserPref(DARK, '0');
  t('fallback (effective user is not the visitor): writes go to the email-namespaced script keys, the owner\'s user store is never touched',
    [w, e.script.get(e.old('alice@corp.com', DARK)), e.script.get(e.old('alice@corp.com', FILTER)), e.script.get(e.old('bob@corp.com', DARK)), e.user.size],
    [[{ ok: true }, { ok: true }], '1', blobOf('alice'), '0', 0]);
  e.as('alice@corp.com', 'owner@corp.com');
  t('fallback: reads come from the visitor\'s own script keys (still isolated by email) and are not migrated anywhere',
    [e.api.readUserPrefs_(), e.api.readServerExtras_(), e.script.has(e.old('alice@corp.com', FREEZE)), e.user.size],
    [{ available: true, values: { [DARK]: '1', [AUTO]: null, [FREEZE]: '1' } }, { filterPrefs: { available: true, value: blobOf('alice') } }, true, 0]);
  e.as('alice@corp.com');
  e.effectiveThrows = true;
  t('fallback: an effective user that cannot be read is treated as "not the visitor" too',
    [e.api.saveUserPref(AUTO, '1'), e.script.get(e.old('alice@corp.com', AUTO)), e.user.size], [{ ok: true }, '1', 0]);
  e.effectiveThrows = false;
  e.fail.scriptSet = true;
  e.as('alice@corp.com', 'owner@corp.com');
  t('fallback: a full script store is reported exactly as before',
    [e.api.saveUserPref(DARK, '0'), e.api.saveUserFilterPrefs(blobOf('x'))], [{ ok: false, reason: 'properties-unavailable' }, { ok: false, reason: 'properties-unavailable' }]);
}

{
  // Quota and error paths in the per-visitor store keep the old reasons and shapes.
  const e = loadTwoStores();
  e.fail.userSet = true;
  t('user store full: saveUserPref and saveUserFilterPrefs report properties-unavailable, nothing is written to the shared script store',
    [e.api.saveUserPref(DARK, '1'), e.api.saveUserFilterPrefs(blobOf('a')), e.scriptPrefKeys()],
    [{ ok: false, reason: 'properties-unavailable' }, { ok: false, reason: 'properties-unavailable' }, []]);
  e.fail.userSet = false;
  e.fail.userAll = true;
  t('user properties unavailable: reads report properties-unavailable (prefs and extras), saves too',
    [e.api.readUserPrefs_(), e.api.readServerExtras_(), e.api.saveUserPref(DARK, '1'), e.api.saveUserFilterPrefs('')],
    [{ available: false, reason: 'properties-unavailable' }, { filterPrefs: { available: false, reason: 'properties-unavailable', value: null } },
      { ok: false, reason: 'properties-unavailable' }, { ok: false, reason: 'properties-unavailable' }]);
  e.fail.userAll = false;
  e.fail.scriptGet = true;
  t('the old-key lookup failing on a migration read is reported as properties-unavailable, not as "nothing stored"',
    [e.api.readUserPrefs_(), e.api.readServerExtras_().filterPrefs], [{ available: false, reason: 'properties-unavailable' }, { available: false, reason: 'properties-unavailable', value: null }]);
  e.fail.scriptGet = false;
  t('validation is unchanged and writes nothing: too-large (with byteLength), invalid-json, invalid-key, invalid-value',
    [e.api.saveUserFilterPrefs(JSON.stringify({ pad: 'x'.repeat(9000) })).reason, e.api.saveUserFilterPrefs('{nope'), e.api.saveUserPref('nope', '1'), e.api.saveUserPref(DARK, 'yes'), e.userMap('alice@corp.com')],
    ['too-large', { ok: false, reason: 'invalid-json' }, { ok: false, reason: 'invalid-key' }, { ok: false, reason: 'invalid-value' }, {}]);
  e.as('');
  t('no visitor identity: fails closed exactly as before, nothing read or written',
    [e.api.readUserPrefs_(), e.api.readServerExtras_(), e.api.saveUserPref(DARK, '1'), e.user.has('')],
    [{ available: false, reason: 'no-user-identity' }, { filterPrefs: { available: false, reason: 'no-user-identity', value: null } }, { ok: false, reason: 'no-user-identity' }, false]);
}


{
  // One read per page load (2026-10-07, code review of #190): doGet resolves the visitor once and reads the
  // visitor's own store with ONE getProperties() call; the old script keys are looked up only until the
  // "old keys checked" marker is written.
  const e = loadTwoStores();
  e.script.set(e.old('alice@corp.com', FREEZE), '1');
  const pageLoad = () => { const v = e.api.readVisitorContext_(); return [e.api.readUserPrefs_(v), e.api.readServerExtras_(v)]; };
  e.resetCalls();
  const first = pageLoad();
  t('page load, first visit: same replies as before, one user-store read, each of the four keys looked up once in the old script store, then the marker is written',
    [first, e.calls.userGetAll, e.calls.userGet, e.calls.scriptGet, e.marker('alice@corp.com'), e.scriptPrefKeys()],
    [[{ available: true, values: { [DARK]: null, [AUTO]: null, [FREEZE]: '1' } }, { filterPrefs: { available: true, value: null } }], 1, 1, 4, '1', []]);
  e.resetCalls();
  const second = pageLoad();
  t('page load, every later visit: one getProperties() call, no single-key reads, no script-store reads, and the visitor resolved once (one getActiveUser, one getEffectiveUser)',
    [second, e.calls.userGetAll, e.calls.userGet, e.calls.scriptGet, e.calls.userSet, e.calls.active, e.calls.effective],
    [first, 1, 0, 0, 0, 1, 1]);
  e.script.set(e.old('alice@corp.com', DARK), '1');
  t('page load: once the marker is set, an old script key is no longer consulted (the documented limit of the marker)',
    pageLoad()[0].values[DARK], null);
  e.as('bob@corp.com');
  e.user.set('bob@corp.com', new Map([[PROBE_STAMP, '{"email":"bob@corp.com"}'], ['bfrPrivVvdNote:ABC0001E', '{"note":"x"}']]));
  pageLoad();
  t('page load: the removed ?check=identity probe\'s leftover stamp is deleted from the visitor\'s own store; nothing else in it is touched',
    [e.user.get('bob@corp.com').has(PROBE_STAMP), e.user.get('bob@corp.com').get('bfrPrivVvdNote:ABC0001E')], [false, '{"note":"x"}']);
}

const EXPECTED = 40;
if (pass + failures.length !== EXPECTED) {
  failures.push(`expected ${EXPECTED} assertions, ran ${pass + failures.length} -- ` +
    'an assertion was added or silently dropped; update EXPECTED deliberately');
}

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  failures.forEach((f) => console.error(`  - ${f}\n`));
  process.exit(1);
}
console.log(`\n✅ PASS (${pass}/${EXPECTED})`);

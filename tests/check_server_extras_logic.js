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

// Same auto-detect rule as check_server_prefs_logic.js (exclude testing
// builds, take the highest remaining dotted version) -- see that file's own
// comment for why this differs from check_alias_landmines.py's rule.
const TESTING_BUILD = /testing/i;
function findAppHtml() {
  const root = path.resolve(__dirname, '..');
  const re = /^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$/;
  const all = fs.readdirSync(root).filter((f) => re.test(f));
  const excluded = all.filter((f) => TESTING_BUILD.test(f));
  if (excluded.length) {
    console.log(`(excluded as testing builds: ${excluded.join(', ')})`);
  }
  const candidates = all.filter((f) => !TESTING_BUILD.test(f));
  if (!candidates.length) throw new Error(`No main app HTML found in ${root}`);
  const key = (f) => f.match(/na_(?:Kevin_)?([\d.]+)_/)[1].split('.').map(Number);
  candidates.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    }
    return 0;
  });
  return path.join(root, candidates[candidates.length - 1]);
}

const appPath = findAppHtml();
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

const EXPECTED = 13;
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

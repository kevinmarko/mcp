/**
 * Headless check for the client-side preference-resolution logic.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BROWSER SUITE
 *
 * Almost nothing about server-backed preferences can be tested on a dev
 * machine: `google.script.run` exists only inside the Apps Script sandbox.
 * But the part most likely to be broken by a careless edit -- WHICH stored
 * value wins, and WHETHER a write is sent -- is pure logic with no DOM and
 * no network in it. So this file pulls that block straight out of the app
 * HTML and runs it under Node with a fake `window`.
 *
 * It extracts the REAL source rather than re-implementing it. A test that
 * re-implements the rule it is checking passes happily while the shipped
 * code does something else entirely.
 *
 * Run:  node tests/check_server_prefs_logic.js
 *
 * This does NOT prove the round trip works, that PropertiesService isolates
 * users, or that anything renders. It proves the decision table below. See
 * AGENTS.md's deployed-URL checklist for the parts only production answers.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Finds the MAIN app file -- deliberately NOT the same rule as
// check_alias_landmines.py / check_date_timezone_safety.js, which take the
// highest dotted version.
//
// That rule is wrong here and this check is where it bites first. Testing
// builds now live in the repo root under HIGHER version numbers than the main
// file (2026-09-16: 1.67_TESTING is a testing build; 1.66 is main, per Kevin),
// and server-backed preferences exist only in the main file. Taking the
// highest version would point this check at a file that has never contained
// the code it is checking.
//
// So: exclude anything whose name marks it as a testing build, then take the
// highest of what remains. The excluded names are printed, because a silently
// skipped file is how this repo has been burned before -- if a future testing
// build is named something this does not recognise, the printed list is what
// reveals it.
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

// Slice out the preference block by its declarations, so this keeps working
// when surrounding line numbers move.
const startIdx = src.indexOf('const SERVER_PREFS = ');
const endMarker = 'const isServerPrefSyncAvailable = ';
const endIdx = src.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) {
  console.error('FAILED: could not locate the preference block in the app file.');
  console.error('If it was renamed or moved, update the markers here -- do NOT');
  console.error('delete this check, and do not let it pass by finding nothing.');
  process.exit(1);
}
const closeIdx = src.indexOf('};', src.indexOf('return false;', endIdx));
const block = src.slice(startIdx, closeIdx + 2);

const DARK = 'bookingFlashDarkMode';
const AUTO = 'bookingFlashAutoRefresh';
const FREEZE = 'bookingFlashFreezePanes';

function load({ serverPrefs, local, throwLocal = false, hasGoogle = false }) {
  const store = Object.assign({}, local);
  const win = {
    __SERVER_PREFS__: serverPrefs,
    localStorage: {
      getItem: (k) => {
        if (throwLocal) throw new Error('storage blocked');
        return k in store ? store[k] : null;
      },
      setItem: (k, v) => {
        if (throwLocal) throw new Error('storage blocked');
        store[k] = v;
      },
    },
  };
  const google = hasGoogle ? { script: { run: {} } } : undefined;
  return new Function(
    'window', 'google',
    block + '\n; return {resolveUserPref, isServerPrefSyncAvailable, ' +
    'SERVER_PREF_SEED_KEYS, shouldSendPrefToServer};'
  )(win, google);
}

// The three preferences' real semantics, mirrored from their initializers.
// autoRefresh is deliberately asymmetric: null ("never set") means ON, while
// the other two collapse null/'0'/anything-else to false.
const asAuto = (s) => (s === null ? true : s === '1');
const asBool = (s) => s === '1';

let pass = 0;
const failures = [];
function t(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
  } else {
    failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
}

// --- resolution rule ---
t('server value wins over a disagreeing localStorage value',
  load({ serverPrefs: { available: true, values: { [DARK]: '1' } }, local: { [DARK]: '0' } }).resolveUserPref(DARK), '1');
t('server null falls back to localStorage',
  load({ serverPrefs: { available: true, values: { [DARK]: null } }, local: { [DARK]: '1' } }).resolveUserPref(DARK), '1');
t('available:false ignores the server entirely',
  load({ serverPrefs: { available: false, reason: 'no-user-identity' }, local: { [DARK]: '1' } }).resolveUserPref(DARK), '1');
t('global absent (localhost) uses localStorage',
  load({ serverPrefs: undefined, local: { [DARK]: '1' } }).resolveUserPref(DARK), '1');
t('nothing stored anywhere resolves to null',
  load({ serverPrefs: undefined, local: {} }).resolveUserPref(DARK), null);

// --- localStorage throwing (private windows) must not take the app down ---
const thrown = load({ serverPrefs: { available: true, values: { [DARK]: '1' } }, local: {}, throwLocal: true });
t('localStorage throwing still honours the server value', thrown.resolveUserPref(DARK), '1');
t('localStorage throwing with no server value returns null, not a crash', thrown.resolveUserPref(FREEZE), null);

// --- the autoRefresh asymmetry: the single most likely thing to get flattened ---
t('autoRefresh never set anywhere -> ON',
  asAuto(load({ serverPrefs: { available: true, values: { [AUTO]: null } }, local: {} }).resolveUserPref(AUTO)), true);
t('autoRefresh explicit 0 from server -> OFF',
  asAuto(load({ serverPrefs: { available: true, values: { [AUTO]: '0' } }, local: {} }).resolveUserPref(AUTO)), false);
t('autoRefresh explicit 0 in localStorage with server null -> OFF',
  asAuto(load({ serverPrefs: { available: true, values: { [AUTO]: null } }, local: { [AUTO]: '0' } }).resolveUserPref(AUTO)), false);
t('freezePanes unset -> OFF (the opposite default, deliberately)',
  asBool(load({ serverPrefs: { available: true, values: { [FREEZE]: null } }, local: {} }).resolveUserPref(FREEZE)), false);

// --- mount-write gating ---
const settled = load({ serverPrefs: { available: true, values: { [DARK]: '1' } }, local: { [DARK]: '1' }, hasGoogle: true });
t('no seed when the server already holds the value', settled.SERVER_PREF_SEED_KEYS[DARK], false);
t('mount run suppressed when no seeding is needed', settled.shouldSendPrefToServer(DARK, true), false);
t('a later real change still sends', settled.shouldSendPrefToServer(DARK, false), true);

const migrating = load({ serverPrefs: { available: true, values: { [DARK]: null } }, local: { [DARK]: '1' }, hasGoogle: true });
t('seeds when the server is empty but localStorage holds a choice', migrating.SERVER_PREF_SEED_KEYS[DARK], true);
t('mount run DOES send for that migration', migrating.shouldSendPrefToServer(DARK, true), true);

t('no seed when neither side holds anything',
  load({ serverPrefs: { available: true, values: { [DARK]: null } }, local: {}, hasGoogle: true }).SERVER_PREF_SEED_KEYS[DARK], false);
t('no seed when the server is unavailable',
  load({ serverPrefs: { available: false }, local: { [DARK]: '1' }, hasGoogle: true }).SERVER_PREF_SEED_KEYS[DARK], false);

// --- availability is structural, never environment-sniffed ---
t('sync available when the flag is true and google exists',
  load({ serverPrefs: { available: true, values: {} }, local: {}, hasGoogle: true }).isServerPrefSyncAvailable(), true);
t('sync unavailable without the google global',
  load({ serverPrefs: { available: true, values: {} }, local: {}, hasGoogle: false }).isServerPrefSyncAvailable(), false);
t('sync unavailable when the server said no',
  load({ serverPrefs: { available: false }, local: {}, hasGoogle: true }).isServerPrefSyncAvailable(), false);
t('sync unavailable on localhost',
  load({ serverPrefs: undefined, local: {}, hasGoogle: false }).isServerPrefSyncAvailable(), false);

// A hostname check here would make the browser suite's fake transport
// unreachable, turning Suite 10 green while it silently exercised the old
// localStorage-only path. Fail loudly if one ever appears.
// Strip line comments first: the block legitimately MENTIONS location.hostname
// in a comment explaining why it must not be used, and a check that fires on
// its own documentation is a false positive people learn to switch off.
const blockCode = block.replace(/^\s*\/\/.*$/gm, '');
if (/location\s*\.\s*hostname/.test(blockCode)) {
  failures.push('the preference block references location.hostname; the availability\n' +
    '      check must be purely structural or the test seam becomes unreachable');
}

const EXPECTED = 22;
if (pass + failures.length !== EXPECTED) {
  failures.push(`expected ${EXPECTED} assertions, ran ${pass + failures.length} -- ` +
    'an assertion was added or silently dropped; update EXPECTED deliberately');
}

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  failures.forEach((f) => console.error(`  - ${f}\n`));
  process.exit(1);
}
console.log(`SERVER_PREFS_LOGIC_PASSED (${pass} assertions)`);

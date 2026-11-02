/**
 * Headless check for the scheduled per-day historical archive in
 * apps-script/Code.gs (2026-09-29) -- snapshotLiveDataToArchive,
 * backfillArchiveFromLegacySheet, installArchiveTrigger and the doGet
 * ?archive=index / ?archive=day endpoints.
 *
 * Runs the REAL Code.gs under Node with in-memory fakes for the Apps Script
 * services it touches (Drive, Properties, Cache, Lock, UrlFetch, Script,
 * Content, Session, Utilities), fed by this repo's committed fixtures. The
 * central assertion is fidelity: every per-day file, parsed the way the app
 * parses it (SheetJS, raw:true read + raw:false/defval:'' rows), must equal
 * exactly the rows the old single-Sheet archive yields for that date. The
 * record splitter copies raw CSV records rather than re-serializing fields,
 * and this is what proves that holds on real data, quoted newlines included.
 *
 * What the fakes cannot prove: that the real services behave like them
 * (Drive permissions, trigger timing, UrlFetch reaching the published Sheet
 * from Google's servers). See apps-script/README.md's archive checklist.
 *
 * Run:  node tests/check_archive_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const codeGs = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
const liveCsv = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'live_csv_2026-08-12.csv'), 'utf8');
const legacyCsv = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'historical_data_2026-08-24_to_2026-08-26.csv'), 'utf8');

// Same auto-detect rule as check_server_prefs_logic.js (exclude testing
// builds, take the highest remaining dotted version).
function findAppHtml() {
  const re = /^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$/;
  const all = fs.readdirSync(root).filter((f) => re.test(f));
  const excluded = all.filter((f) => /testing/i.test(f));
  if (excluded.length) console.log(`(excluded as testing builds: ${excluded.join(', ')})`);
  const candidates = all.filter((f) => !/testing/i.test(f));
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
const appSrc = fs.readFileSync(appPath, 'utf8');

let pass = 0;
const failures = [];
function t(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}
function throws(fn) {
  try { fn(); return null; } catch (err) { return String(err.message || err); }
}

// The app's own parse of a CSV text (applyCsvText / the historical loader's shape).
function appRows(csvText) {
  const wb = XLSX.read(csvText, { type: 'string', raw: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
}

const LIVE_URL = appSrc.match(/const CSV_SOURCE_URL = '([^']+)'/)[1];
const LEGACY_URL = appSrc.match(/const HISTORICAL_DATA_CSV_URL = '([^']+)'/)[1];

function makeEnv({ now = new Date('2026-09-29T23:15:00Z'), tz = 'America/New_York', activeEmail = 'kevin@corp.com', effectiveEmail = 'kevin@corp.com', urls = {}, admin = 'kevin@corp.com' } = {}) {
  const props = new Map();
  // Most scenarios run after setup, as the admin (installArchiveTrigger would have set this).
  if (admin) props.set('bfrArchiveAdmin', admin);
  const cache = new Map();
  const files = new Map(); // id -> {name, content, folderId}
  const folders = new Map(); // id -> name
  const trashed = new Set(); // folder ids
  const triggers = [];
  let seq = 0;
  const env = { props, cache, files, folders, trashed, triggers, urls, activeEmail, effectiveEmail, now };

  const makeFile = (id) => ({
    getId: () => id,
    getBlob: () => ({ getDataAsString: () => files.get(id).content }),
    setContent: (c) => { files.get(id).content = c; },
  });
  const makeFolder = (id) => ({
    getId: () => id,
    isTrashed: () => trashed.has(id),
    createFile: (name, content) => {
      const fid = `file${++seq}`;
      files.set(fid, { name, content, folderId: id });
      return makeFile(fid);
    },
    getFilesByName: (name) => {
      const ids = [...files.entries()].filter(([, f]) => f.folderId === id && f.name === name).map(([fid]) => fid);
      let i = 0;
      return { hasNext: () => i < ids.length, next: () => makeFile(ids[i++]) };
    },
  });
  const textOutput = (text) => {
    const out = { text, mime: 'TEXT', setMimeType(m) { out.mime = m; return out; } };
    return out;
  };

  const fakes = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      createFolder: (name) => { const id = `folder${++seq}`; folders.set(id, name); return makeFolder(id); },
      getFolderById: (id) => { if (!folders.has(id)) throw new Error('No folder ' + id); return makeFolder(id); },
      getFileById: (id) => { if (!files.has(id)) throw new Error('No file ' + id); return makeFile(id); },
    },
    UrlFetchApp: {
      fetch: (url) => {
        const r = env.urls[url];
        if (!r) throw new Error('unexpected fetch ' + url);
        return { getResponseCode: () => r.code, getContentText: () => r.text };
      },
    },
    Session: {
      getScriptTimeZone: () => tz,
      getActiveUser: () => ({ getEmail: () => env.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => env.effectiveEmail }),
    },
    Utilities: {
      formatDate: (d, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (tr) => { triggers.splice(triggers.indexOf(tr), 1); },
      newTrigger: (handler) => {
        const spec = { handler };
        const b = {
          timeBased: () => b,
          everyDays: (n) => { spec.everyDays = n; return b; },
          atHour: (h) => { spec.atHour = h; return b; },
          create: () => { const tr = { ...spec, getHandlerFunction: () => handler }; triggers.push(tr); return tr; },
        };
        return b;
      },
      getService: () => ({ getUrl: () => 'https://script.google.com/exec' }),
    },
    ContentService: { createTextOutput: textOutput, MimeType: { JSON: 'JSON', TEXT: 'TEXT', CSV: 'CSV' } },
    MimeType: { CSV: 'text/csv', PLAIN_TEXT: 'text/plain' },
    HtmlService: {},
    console: { log() {} },
  };
  const names = Object.keys(fakes);
  const RealDate = Date;
  // Pin "now" for the job's date computation without touching the real clock.
  const FakeDate = function (...a) { return a.length ? new RealDate(...a) : new RealDate(env.now); };
  FakeDate.now = () => RealDate.now();
  env.api = new Function(...names, 'Date', codeGs + `
    ; return { splitCsvRecords_, firstCsvField_, normalizeArchiveDate_, snapshotLiveDataToArchive,
      backfillArchiveFromLegacySheet, installArchiveTrigger, archiveIndexResponse_, archiveDayResponse_, getArchiveIndex, getArchiveDayCsv, doGet,
      ARCHIVE_LIVE_CSV_URL_, ARCHIVE_LEGACY_SHEET_CSV_URL_, ARCHIVE_RUN_HOUR_ };`)(...names.map((n) => fakes[n]), FakeDate);
  env.dayFiles = () => [...files.values()].filter((f) => /^booking-flash-/.test(f.name)).map((f) => f.name).sort();
  env.dayContent = (date) => [...files.values()].find((f) => f.name === `booking-flash-${date}.csv`).content;
  return env;
}

// --- the URLs Code.gs fetches are the app's own sources ---
{
  const env = makeEnv();
  t('Code.gs live-CSV URL equals the app\'s CSV_SOURCE_URL', env.api.ARCHIVE_LIVE_CSV_URL_, LIVE_URL);
  t('Code.gs legacy-archive URL equals the app\'s HISTORICAL_DATA_CSV_URL', env.api.ARCHIVE_LEGACY_SHEET_CSV_URL_, LEGACY_URL);
}

// --- record splitter ---
{
  const { splitCsvRecords_, firstCsvField_, normalizeArchiveDate_ } = makeEnv().api;
  t('splitter keeps a quoted newline and escaped quotes inside one record',
    splitCsvRecords_('a,b\r\n"x\r\ny","say ""hi"""\r\nz,w\r\n'), ['a,b', '"x\r\ny","say ""hi"""', 'z,w']);
  t('splitter handles \\n endings, a BOM and a missing final newline',
    splitCsvRecords_('﻿a,b\n1,2'), ['a,b', '1,2']);
  t('splitter record count on the live fixture matches SheetJS rows + header',
    splitCsvRecords_(liveCsv).length, appRows(liveCsv).length + 1);
  t('firstCsvField_ unquotes a quoted first field', firstCsvField_('"2026-08-24","x"'), '2026-08-24');
  t('Record Date normalization: ISO, m/d/yy and m/d/yyyy; junk -> ""',
    ['2026-08-24', '8/5/26', '08/05/2026', 'Total', ''].map(normalizeArchiveDate_), ['2026-08-24', '2026-08-05', '2026-08-05', '', '']);
}

// --- backfill: split the legacy single Sheet into per-day files ---
{
  const env = makeEnv({ urls: { [LEGACY_URL]: { code: 200, text: legacyCsv } } });
  const res = env.api.backfillArchiveFromLegacySheet();
  t('backfill writes one file per date and reports nothing remaining',
    [res.written, res.remaining, res.unparseableRows, env.dayFiles()],
    [['2026-08-24', '2026-08-25', '2026-08-26'], 0, 0,
      ['booking-flash-2026-08-24.csv', 'booking-flash-2026-08-25.csv', 'booking-flash-2026-08-26.csv']]);

  const legacyRows = appRows(legacyCsv);
  const fidelity = ['2026-08-24', '2026-08-25', '2026-08-26'].map((d) =>
    JSON.stringify(appRows(env.dayContent(d))) === JSON.stringify(legacyRows.filter((r) => r['Record Date'] === d)));
  t('each day file parses (the app\'s way) to exactly that date\'s rows from the legacy archive', fidelity, [true, true, true]);

  const again = env.api.backfillArchiveFromLegacySheet();
  t('re-running backfill writes nothing and reports all dates as already archived',
    [again.written, again.alreadyArchived, env.dayFiles().length], [[], 3, 3]);

  const idx = env.api.doGet({ parameter: { archive: 'index' } });
  t('?archive=index lists the dates newest first as JSON', [idx.mime, JSON.parse(idx.text)],
    ['JSON', { ok: true, dates: ['2026-08-26', '2026-08-25', '2026-08-24'] }]);
  const day = env.api.doGet({ parameter: { archive: 'day', date: '2026-08-25' } });
  t('?archive=day serves that day\'s CSV unchanged', [day.mime, day.text === env.dayContent('2026-08-25')], ['CSV', true]);
  t('?archive=day rejects a malformed date and reports a missing one',
    [JSON.parse(env.api.doGet({ parameter: { archive: 'day', date: '../x' } }).text).reason,
      JSON.parse(env.api.doGet({ parameter: { archive: 'day', date: '2026-01-01' } }).text).reason],
    ['invalid-date', 'not-found']);
  t('google.script.run getArchiveIndex returns the same dates as ?archive=index',
    env.api.getArchiveIndex(), { ok: true, dates: ['2026-08-26', '2026-08-25', '2026-08-24'] });
  const runDay = env.api.getArchiveDayCsv('2026-08-25');
  t('google.script.run getArchiveDayCsv returns that day\'s file unchanged, and the same errors as ?archive=day',
    [runDay.ok, runDay.csv === env.dayContent('2026-08-25'), env.api.getArchiveDayCsv('../x').reason, env.api.getArchiveDayCsv('2026-01-01').reason],
    [true, true, 'invalid-date', 'not-found']);

  env.cache.clear();
  t('the index survives a cold cache (read back from the Drive index file)',
    JSON.parse(env.api.doGet({ parameter: { archive: 'index' } }).text).dates.length, 3);
}

// --- backfill normalizes an m/d/yy Record Date into the file name and rows ---
{
  const usCsv = legacyCsv.replace(/^2026-08-24,/gm, '8/24/26,');
  const env = makeEnv({ urls: { [LEGACY_URL]: { code: 200, text: usCsv } } });
  env.api.backfillArchiveFromLegacySheet();
  const rows = appRows(env.dayContent('2026-08-24'));
  t('an m/d/yy Record Date is written as YYYY-MM-DD in both the file name and every row',
    [rows.length, rows.every((r) => r['Record Date'] === '2026-08-24')], [7, true]);
}

// --- daily job ---
{
  const env = makeEnv({ urls: { [LIVE_URL]: { code: 200, text: liveCsv } } });
  t('index reports not-configured before anything has run',
    JSON.parse(env.api.doGet({ parameter: { archive: 'index' } }).text), { ok: false, reason: 'not-configured' });
  const res = env.api.snapshotLiveDataToArchive();
  // 23:15 UTC on 9/29 is 19:15 in New York -- still the 29th there.
  t('the job saves today (in the script time zone) with every live row', [res.date, res.rows], ['2026-09-29', 964]);
  const saved = appRows(env.dayContent('2026-09-29'));
  const live = appRows(liveCsv);
  t('the saved day file equals the live export plus a Record Date column, row for row',
    JSON.stringify(saved) === JSON.stringify(live.map((r) => ({ 'Record Date': '2026-09-29', ...r }))), true);
  const again = env.api.snapshotLiveDataToArchive();
  t('a second run the same day does nothing', [again.skipped, env.dayFiles().length], ['already-archived', 1]);

  const tokyo = makeEnv({ tz: 'Asia/Tokyo', urls: { [LIVE_URL]: { code: 200, text: liveCsv } } });
  t('the date comes from the script time zone, not UTC', tokyo.api.snapshotLiveDataToArchive().date, '2026-09-30');
}

{
  const signIn = makeEnv({ urls: { [LIVE_URL]: { code: 200, text: '<!DOCTYPE html><html>Sign in</html>' } } });
  const err = throws(() => signIn.api.snapshotLiveDataToArchive());
  t('a sign-in/HTML page instead of the export throws (trigger owner gets Google\'s failure email) and writes nothing',
    [!!err && err.includes('did not look like the export'), signIn.dayFiles().length], [true, 0]);
  const down = makeEnv({ urls: { [LIVE_URL]: { code: 500, text: '' } } });
  t('an HTTP error throws and writes nothing',
    [!!throws(() => down.api.snapshotLiveDataToArchive()), down.dayFiles().length], [true, 0]);
  const empty = makeEnv({ urls: { [LIVE_URL]: { code: 200, text: liveCsv.split(/\r?\n/)[0] + '\r\n' } } });
  t('a header with no rows throws and writes nothing',
    [!!throws(() => empty.api.snapshotLiveDataToArchive()), empty.dayFiles().length], [true, 0]);
}

// --- trigger install + admin guard ---
{
  const env = makeEnv();
  env.api.installArchiveTrigger();
  env.api.installArchiveTrigger();
  t('install leaves exactly one daily trigger for the job, at ARCHIVE_RUN_HOUR_',
    env.triggers.map((x) => [x.handler, x.everyDays, x.atHour]), [['snapshotLiveDataToArchive', 1, env.api.ARCHIVE_RUN_HOUR_]]);
  env.activeEmail = 'visitor@corp.com';
  const err = throws(() => env.api.installArchiveTrigger());
  const err2 = throws(() => env.api.backfillArchiveFromLegacySheet());
  t('a different account (e.g. a visitor via google.script.run) cannot install or backfill',
    [!!err && err.includes('Only the archive admin'), !!err2 && err2.includes('Only the archive admin'), env.triggers.length],
    [true, true, 1]);
}

// --- the job's own guards (2026-09-29 review) ---
{
  const live = { [LIVE_URL]: { code: 200, text: liveCsv } };
  const visitor = makeEnv({ urls: live });
  visitor.activeEmail = 'visitor@corp.com';
  const vErr = throws(() => visitor.api.snapshotLiveDataToArchive());
  t('a visitor (google.script.run) cannot run the daily job: no midday snapshot, no folder created',
    [!!vErr && vErr.includes('Only the archive admin'), visitor.dayFiles().length, visitor.folders.size], [true, 0, 0]);
  const fresh = makeEnv({ urls: live, admin: null });
  fresh.activeEmail = 'visitor@corp.com';
  const fErr = throws(() => fresh.api.snapshotLiveDataToArchive());
  t('before setup, calling the daily job neither claims admin nor creates a folder',
    [!!fErr && fErr.includes('not set up yet'), fresh.props.has('bfrArchiveAdmin'), fresh.folders.size], [true, false, 0]);

  const lost = makeEnv({ urls: live });
  lost.api.snapshotLiveDataToArchive();
  const folderId = lost.props.get('bfrArchiveFolderId');
  lost.now = new Date('2026-09-30T23:15:00Z');
  lost.folders.delete(folderId); // getFolderById now throws, like a transient Drive error or lost access
  const lErr = throws(() => lost.api.snapshotLiveDataToArchive());
  t('a folder that can\'t be opened throws and never repoints the archive at a new folder',
    [!!lErr && lErr.includes('Could not open the archive folder'), lost.props.get('bfrArchiveFolderId'), lost.folders.size], [true, folderId, 0]);
  const bin = makeEnv({ urls: live });
  bin.api.snapshotLiveDataToArchive();
  bin.trashed.add(bin.props.get('bfrArchiveFolderId'));
  bin.cache.clear();
  t('a trashed archive folder throws for writers and readers alike',
    [!!throws(() => bin.api.installArchiveTrigger()), bin.api.getArchiveIndex().ok, bin.folders.size], [true, false, 1]);
}

const EXPECTED = 31;
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

/**
 * Headless check for the per-day historical archive in apps-script/Code.gs
 * (redesigned 2026-09-30): the server reads the team's Drive folder of daily
 * Google Sheets -- the date in each file NAME, only the export's columns
 * inside -- and serves getArchiveIndex / getArchiveDayCsv and the doGet
 * ?archive=index / ?archive=day endpoints from it. It never writes to Drive.
 *
 * Runs the REAL Code.gs under Node with in-memory fakes for the Apps Script
 * services it touches (Drive, Cache, Properties, UrlFetch, Script, Content,
 * Session), fed by this repo's committed fixtures. The central assertion is
 * fidelity: each day's Sheet export (simulated as the old single archive's
 * rows for that date, minus the Record Date column) must come back, parsed
 * the way the app parses it (SheetJS, raw:true read + raw:false/defval:''
 * rows), as exactly that date's rows from the old archive -- quoted
 * multi-line cells included.
 *
 * What the fakes cannot prove: that the real services behave like them
 * (Drive sharing, the Sheets CSV export URL with the visitor's token, file
 * names in the real folder). checkArchiveFolder, run from the editor, is the
 * real-data check; see apps-script/README.md.
 *
 * Run:  node tests/check_archive_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const codeGs = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
const liveCsv = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'live_csv_2026-08-12.csv'), 'utf8');
const legacyCsv = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'historical_data_2026-08-24_to_2026-08-26.csv'), 'utf8');

// Which app file is "current" is decided in one place: scripts/lib/app_file.js pickCurrentAppHtml.
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');
let appPath;
try { appPath = findCurrentAppHtml(); } catch (err) { console.error(err.message); process.exit(1); }
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

const SHEET = 'application/vnd.google-apps.spreadsheet';
const TOKEN = 'visitor-token';

/**
 * A fake world. `files`: [{name, mime?, csv?, updated?, trashed?, exportCode?}].
 * `folderId` overrides ARCHIVE_FOLDER_ID_ in the source (as the admin would in
 * the editor); `folderAccess` false = the caller can't open the folder.
 */
function makeEnv({ files = [], folderId, folderAccess = true, triggers = [], overrides = {} } = {}) {
  const cache = new Map();
  const props = new Map();
  const fileMap = new Map(); // id -> file
  let seq = 0;
  // folderAccess is live (env.folderAccess): the admin's trigger can read the folder, then a
  // visitor it isn't shared with reads the cache. nowOffset moves Date.now() forward.
  const env = { cache, props, fileMap, triggers: triggers.slice(), fetches: [], listings: 0, writes: 0, folderAccess, nowOffset: 0, email: 'visitor@corp.com', scriptOwner: 'kevin@corp.com' };
  env.add = (f) => {
    const id = `sheet${++seq}`;
    fileMap.set(id, { mime: SHEET, updated: 1000 + seq, trashed: false, exportCode: 200, ...f });
    return id;
  };
  files.forEach(env.add);

  let src = folderId === undefined ? codeGs
    : codeGs.replace(/var ARCHIVE_FOLDER_ID_ = '[^']*';/, `var ARCHIVE_FOLDER_ID_ = '${folderId}';`);
  // A constant the admin would edit in the editor, set the same way.
  Object.entries(overrides).forEach(([name, value]) => {
    const re = new RegExp(`var ${name} = [^;]+;`);
    if (!re.test(src)) throw new Error(`override: ${name} not declared in Code.gs`);
    src = src.replace(re, `var ${name} = ${value};`);
  });
  const realFolderId = (src.match(/var ARCHIVE_FOLDER_ID_ = '([^']*)';/) || [])[1];
  const noWrite = () => { env.writes++; throw new Error('the archive must never write to Drive'); };

  const makeFile = (id) => {
    const f = fileMap.get(id);
    return {
      getId: () => id, getName: () => f.name, getMimeType: () => f.mime, isTrashed: () => f.trashed,
      getLastUpdated: () => new Date(f.updated), setContent: noWrite,
    };
  };
  const folder = {
    getName: () => 'Booking Flash Historical',
    isTrashed: () => false,
    getFolders: () => {
      const names = (env.subfolders || []).slice();
      return { hasNext: () => names.length > 0, next: () => ({ getName: () => names.shift() }) };
    },
    getFiles: () => {
      env.listings++;
      if (env.onListing) env.onListing();
      const ids = [...fileMap.keys()];
      let i = 0;
      return { hasNext: () => i < ids.length, next: () => makeFile(ids[i++]) };
    },
    createFile: noWrite, createFolder: noWrite,
  };

  const fakes = {
    DriveApp: {
      getFolderById: (id) => {
        if (id !== realFolderId || !env.folderAccess) throw new Error('Access denied: DriveApp.');
        return folder;
      },
      createFolder: noWrite, createFile: noWrite,
      // The script file itself, for assertArchiveAdmin_'s owner-only claim (2026-10-06).
      getFileById: (id) => {
        if (id !== 'archive-test-script') throw new Error('unexpected getFileById ' + id);
        return { getOwner: () => ({ getEmail: () => env.scriptOwner }) };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        getAll: (keys) => { const o = {}; keys.forEach((k) => { if (cache.has(k)) o[k] = cache.get(k); }); return o; },
        put: (k, v) => { cache.set(k, v); },
        putAll: (values) => { env.putAlls = (env.putAlls || 0) + 1; Object.entries(values).forEach(([k, v]) => { if (v.length > 100 * 1024) throw new Error('value over 100 KB'); cache.set(k, v); }); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        env.fetches.push({ url, auth: opts && opts.headers && opts.headers.Authorization });
        const m = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)\/export\?format=csv$/);
        const f = m && fileMap.get(m[1]);
        if (!f) throw new Error('unexpected fetch ' + url);
        return { getResponseCode: () => f.exportCode, getContentText: () => f.csv };
      },
    },
    ScriptApp: {
      getOAuthToken: () => TOKEN,
      getScriptId: () => 'archive-test-script',
      getProjectTriggers: () => env.triggers.slice(),
      deleteTrigger: (tr) => { env.triggers.splice(env.triggers.indexOf(tr), 1); },
      getService: () => ({ getUrl: () => 'https://script.google.com/exec' }),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => env.email }),
      getEffectiveUser: () => ({ getEmail: () => env.email }),
      getScriptTimeZone: () => 'America/New_York',
    },
    ContentService: {
      createTextOutput: (text) => { const out = { text, mime: 'TEXT', setMimeType(m) { out.mime = m; return out; } }; return out; },
      MimeType: { JSON: 'JSON', TEXT: 'TEXT', CSV: 'CSV' },
    },
    MimeType: { GOOGLE_SHEETS: SHEET, CSV: 'text/csv', PLAIN_TEXT: 'text/plain' },
    HtmlService: {},
    // Utilities' gzip/base64 over Node's zlib; a blob is a Buffer behind the same getters.
    Utilities: (() => {
      const blob = (buf) => ({ _buf: buf, getBytes: () => [...buf], getDataAsString: () => buf.toString('utf8') });
      return {
        newBlob: (data) => blob(Buffer.isBuffer(data) ? data : typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)),
        gzip: (b) => blob(zlib.gzipSync(b._buf)),
        ungzip: (b) => blob(zlib.gunzipSync(b._buf)),
        base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
        base64Decode: (text) => [...Buffer.from(text, 'base64')],
      };
    })(),
    console: { log: (...a) => { (env.logs = env.logs || []).push(a.join(' ')); } },
  };
  const names = Object.keys(fakes);
  const RealDate = Date;
  const FakeDate = function (...a) { return new RealDate(...(a.length ? a : [RealDate.now() + env.nowOffset])); };
  FakeDate.now = () => RealDate.now() + env.nowOffset;
  FakeDate.UTC = RealDate.UTC;
  env.api = new Function(...names, 'Date', src + `
    ; return { splitCsvRecords_, firstCsvField_, archiveDateFromName_, archiveIndexResponse_, archiveDayResponse_,
      getArchiveIndex, getArchiveDayCsv, checkArchiveFolder, snapshotLiveDataToArchive, doGet, ARCHIVE_FOLDER_ID_,
      refreshArchiveCache_, refreshArchiveCache };`)(...names.map((n) => fakes[n]), FakeDate);
  return env;
}

// The old single archive, split into what each day's Google Sheet exports:
// that date's rows WITHOUT the Record Date column (the dates are unquoted ISO
// in the fixture, so the first comma ends the field).
const legacyRecords = makeEnv().api.splitCsvRecords_(legacyCsv);
function dayExport(date) {
  const strip = (r) => r.slice(r.indexOf(',') + 1);
  return [strip(legacyRecords[0])].concat(legacyRecords.slice(1).filter((r) => r.startsWith(date + ',')).map(strip)).join('\r\n') + '\r\n';
}
const legacyRows = appRows(legacyCsv);
const DATES = ['2026-08-24', '2026-08-25', '2026-08-26'];

// --- the app still calls the server by these names (this redesign keeps the app unchanged) ---
t('the app reads the archive through google.script.run getArchiveIndex and getArchiveDayCsv',
  [/runServerCall\('getArchiveIndex'/.test(appSrc), /runServerCall\('getArchiveDayCsv'/.test(appSrc)], [true, true]);

// --- date from a file name ---
{
  const { archiveDateFromName_: d } = makeEnv().api;
  t('the team folder\'s real names (MMDDYYYY, from Kevin\'s 2026-09-30 screenshot) read as their dates',
    ['Booking Flash Report Data-09302026', 'Booking Flash Report Data-09012026', 'Booking Flash Report Data-12312026'].map(d),
    ['2026-09-30', '2026-09-01', '2026-12-31']);
  t('the folder\'s combined Sheet, "Booking_Flash_Report_Data_Historical", has no date and is skipped',
    d('Booking_Flash_Report_Data_Historical'), '');
  t('ISO, underscore/dot ISO and compact names',
    ['Booking Flash 2026-09-29', 'bf_2026_09_29', '2026.9.29 export', 'BF20260929'].map(d),
    ['2026-09-29', '2026-09-29', '2026-09-29', '2026-09-29']);
  t('US month-first names, 4- and 2-digit years (the repo\'s own 8-12-2026 style)',
    ['Booking_Flash_Data_MAIN_UPLOAD_8-12-2026', 'Booking Flash 9.29.26', 'flash 09_29_2026'].map(d),
    ['2026-08-12', '2026-09-29', '2026-09-29']);
  t('month-name names', ['Booking Flash Sep 29 2026', 'Booking Flash - September 29th, 2026', 'bf aug-3-2026'].map(d),
    ['2026-09-29', '2026-09-29', '2026-08-03']);
  t('no date, a two-date range, an impossible date and a longer digit run all give ""',
    ['Booking Flash notes', 'Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01', 'BF 2-30-2026', 'BF 13-01-2026', 'ref 1234567890', 'BF 13012026', 'BF 02302026'].map(d),
    ['', '', '', '', '', '', '']);
  t('the same date written twice in one name is still one date', d('2026-09-29 (9-29-2026 copy)'), '2026-09-29');
}

// --- record splitter (unchanged from the 2026-09-29 design) ---
{
  const { splitCsvRecords_, firstCsvField_ } = makeEnv().api;
  t('splitter keeps a quoted newline and escaped quotes inside one record',
    splitCsvRecords_('a,b\r\n"x\r\ny","say ""hi"""\r\nz,w\r\n'), ['a,b', '"x\r\ny","say ""hi"""', 'z,w']);
  t('splitter handles \\n endings, a BOM and a missing final newline',
    splitCsvRecords_('﻿a,b\n1,2'), ['a,b', '1,2']);
  t('splitter record count on the live fixture matches SheetJS rows + header',
    splitCsvRecords_(liveCsv).length, appRows(liveCsv).length + 1);
  t('firstCsvField_ unquotes a quoted first field', firstCsvField_('"2026-08-24","x"'), '2026-08-24');
}

// --- the team folder: index + day files ---
{
  const env = makeEnv({ files: [
    { name: 'Booking Flash Report Data-08242026', csv: dayExport('2026-08-24') },
    { name: 'Booking Flash Report Data-08252026 (old copy)', csv: 'junk', updated: 10 },
    { name: 'Booking Flash Report Data-08252026', csv: dayExport('2026-08-25'), updated: 5000 },
    { name: 'Booking Flash Report Data-08262026', csv: dayExport('2026-08-26') },
    { name: 'Booking_Flash_Report_Data_Historical', csv: legacyCsv },
    { name: 'Booking Flash 8-27-2026.pdf', mime: 'application/pdf' },
    { name: 'Booking Flash 8-28-2026', csv: 'x', trashed: true },
    { name: 'How to add a day', csv: 'x' },
  ] });
  const idx = env.api.getArchiveIndex();
  t('index lists one date per dated Sheet, newest first, skipping non-Sheets, trashed files and undated names',
    idx, { ok: true, dates: ['2026-08-26', '2026-08-25', '2026-08-24'] });

  const fidelity = DATES.map((date) => {
    const r = env.api.getArchiveDayCsv(date);
    return r.ok && JSON.stringify(appRows(r.csv)) === JSON.stringify(legacyRows.filter((row) => row['Record Date'] === date));
  });
  t('each day parses (the app\'s way) to exactly that date\'s rows from the old single archive, Record Date added from the name',
    fidelity, [true, true, true]);
  t('two Sheets for one date: the most recently edited one is served', env.fetches.some((f) => /sheet2\//.test(f.url)), false);
  t('each export uses the Sheets CSV export URL with the caller\'s own OAuth token',
    env.fetches.every((f) => f.auth === `Bearer ${TOKEN}`), true);

  const listed = env.listings;
  env.api.getArchiveIndex();
  env.api.getArchiveDayCsv('2026-08-25');
  t('a warm cache serves the index without listing the folder again', env.listings, listed);
  env.add({ name: 'Booking Flash 8-29-2026', csv: dayExport('2026-08-24') });
  env.cache.clear(); // the 10-minute cache expiring
  t('a Sheet someone adds appears once the cache expires', env.api.getArchiveIndex().dates[0], '2026-08-29');

  const idxGet = env.api.doGet({ parameter: { archive: 'index' } });
  t('?archive=index returns the same dates as JSON', [idxGet.mime, JSON.parse(idxGet.text).dates.length], ['JSON', 4]);
  const day = env.api.doGet({ parameter: { archive: 'day', date: '2026-08-25' } });
  t('?archive=day serves the same CSV as getArchiveDayCsv', [day.mime, day.text === env.api.getArchiveDayCsv('2026-08-25').csv], ['CSV', true]);
  t('?archive=day and getArchiveDayCsv reject a malformed date and report a missing one',
    [JSON.parse(env.api.doGet({ parameter: { archive: 'day', date: '../x' } }).text).reason,
      JSON.parse(env.api.doGet({ parameter: { archive: 'day', date: '2026-01-01' } }).text).reason,
      env.api.getArchiveDayCsv('../x').reason, env.api.getArchiveDayCsv('2026-01-01').reason],
    ['invalid-date', 'not-found', 'invalid-date', 'not-found']);
  t('nothing ever wrote to Drive', env.writes, 0);
}

// --- the live export shape, row for row ---
{
  const env = makeEnv({ files: [{ name: 'Booking Flash 9-29-2026', csv: liveCsv }] });
  const r = env.api.getArchiveDayCsv('2026-09-29');
  const live = appRows(liveCsv);
  t('a Sheet holding the full live export comes back as every live row plus Record Date',
    [appRows(r.csv).length, JSON.stringify(appRows(r.csv)) === JSON.stringify(live.map((row) => ({ 'Record Date': '2026-09-29', ...row })))],
    [964, true]);
}

// --- a Sheet that already has Record Date, and exports that aren't the export ---
{
  const withDate = legacyRecords.filter((rec, i) => i === 0 || rec.startsWith('2026-08-24,')).join('\r\n') + '\r\n';
  const env = makeEnv({ files: [
    { name: 'BF 2026-08-24', csv: withDate },
    { name: 'BF 2026-08-25', csv: '<!DOCTYPE html><html>Sign in</html>' },
    { name: 'BF 2026-08-26', csv: '', exportCode: 403 },
  ] });
  const r = env.api.getArchiveDayCsv('2026-08-24');
  t('a Sheet that already carries Record Date is served as-is (no second date column)',
    JSON.stringify(appRows(r.csv)) === JSON.stringify(legacyRows.filter((row) => row['Record Date'] === '2026-08-24')), true);
  const html = env.api.getArchiveDayCsv('2026-08-25');
  const denied = env.api.getArchiveDayCsv('2026-08-26');
  t('a sign-in page or a 403 is an error result, never served as data',
    [html.ok, /Vessel 1st VVD/.test(html.error), denied.ok, /HTTP 403/.test(denied.error)], [false, true, false, true]);
}

// --- no access / not configured ---
{
  const env = makeEnv({ files: [{ name: 'BF 2026-08-24', csv: dayExport('2026-08-24') }], folderAccess: false });
  const idx = env.api.getArchiveIndex();
  t('a visitor the folder isn\'t shared with gets an error result naming the fix (the app then falls back)',
    [idx.ok, idx.reason, /Share the folder/.test(idx.error), env.api.getArchiveDayCsv('2026-08-24').ok], [false, 'error', true, false]);
  const off = makeEnv({ folderId: '' });
  t('ARCHIVE_FOLDER_ID_ "" turns the per-day archive off', off.api.getArchiveIndex(), { ok: false, reason: 'not-configured' });
  t('ARCHIVE_FOLDER_ID_ is the team folder Kevin shared', makeEnv().api.ARCHIVE_FOLDER_ID_, '1oy0GiF_FuVfembJDrJHfRqT68WXCqxZd');
}

// --- checkArchiveFolder: the editor-run report on the real folder ---
{
  const env = makeEnv({ files: [
    { name: 'Booking Flash 8-24-2026', csv: dayExport('2026-08-24') },
    { name: 'Booking Flash 8-25-2026', csv: dayExport('2026-08-25') },
    { name: 'Booking Flash 8-24-2026 copy', csv: 'x', updated: 1 },
    { name: 'Notes', csv: 'x' },
  ] });
  env.cache.set('bfrArchiveIndexV2', '{"dates":{}}');
  env.subfolders = ['2026-07'];
  const r = env.api.checkArchiveFolder();
  t('checkArchiveFolder reports dates, range, skipped files with reasons, and the newest day\'s row count',
    [r.ok, r.files, r.dates, r.newest, r.oldest, r.skipped.length, r.newestRows],
    [true, 4, 2, '2026-08-25', '2026-08-24', 2, legacyRows.filter((row) => row['Record Date'] === '2026-08-25').length]);
  t('checkArchiveFolder explains each skip and clears the cached index',
    [r.skipped.some((s) => /Notes: no single date/.test(s)), r.skipped.some((s) => /edited more recently/.test(s)), env.cache.has('bfrArchiveIndexV2')],
    [true, true, false]);
  t('checkArchiveFolder lists subfolders it does not read, so days filed in them aren\'t silently missed',
    [r.subfolders, (env.logs || []).some((l) => /NOT READ: 1 subfolder\(s\): 2026-07/.test(l))], [['2026-07'], true]);
}

// --- the retired nightly job cleans up its own trigger ---
{
  const mk = (h) => ({ getHandlerFunction: () => h });
  const env = makeEnv({ triggers: [mk('snapshotLiveDataToArchive'), mk('refreshDataFeeds')] });
  const r = env.api.snapshotLiveDataToArchive();
  t('the leftover snapshotLiveDataToArchive trigger deletes itself, other triggers untouched, nothing written',
    [r.triggersRemoved, env.triggers.map((x) => x.getHandlerFunction()), env.writes], [1, ['refreshDataFeeds'], 0]);
}

// --- the admin-run cache: visitors the folder isn't shared with (2026-09-30) ---
{
  const env = makeEnv({ files: [
    { name: 'Booking Flash Report Data-08242026', csv: dayExport('2026-08-24') },
    { name: 'Booking Flash Report Data-08252026', csv: dayExport('2026-08-25') },
    { name: 'Booking Flash Report Data-08262026', csv: dayExport('2026-08-26') },
    { name: 'Booking Flash Report Data-09292026', csv: liveCsv },
  ], overrides: { ARCHIVE_CACHE_DAYS_: 3 } });
  env.folderAccess = false;
  const before = env.api.getArchiveIndex();
  t('before the admin job has run, a visitor without access gets an error result (the app falls back to the old Sheet)',
    [before.ok, before.reason], [false, 'error']);

  env.folderAccess = true; // the trigger runs as the admin, who can read the folder
  const run = env.api.refreshArchiveCache_();
  t('the admin job caches the most recent ARCHIVE_CACHE_DAYS_ days, newest first, and lists every date',
    [run.ok, run.dates, run.written, run.failed, run.remaining], [true, 4, ['2026-09-29', '2026-08-26', '2026-08-25'], [], 0]);
  t('a day is gzipped into chunks under the 100 KB value limit (the 964-row export needs several)',
    Number(JSON.parse(env.cache.get('bfrArc:2026-09-29:m')).chunks) > 1, true);

  env.folderAccess = false; // a visitor the folder is NOT shared with
  env.cache.delete('bfrArchiveIndexV2');
  t('that visitor sees exactly the cached dates, newest first', env.api.getArchiveIndex(), { ok: true, dates: ['2026-09-29', '2026-08-26', '2026-08-25'] });
  const fetchesBefore = env.fetches.length;
  const cachedDay = env.api.getArchiveDayCsv('2026-08-25');
  t('...and opens a cached day with no Drive or export call, row-for-row equal to the old archive',
    [cachedDay.ok, env.fetches.length === fetchesBefore,
      cachedDay.ok === true && JSON.stringify(appRows(cachedDay.csv)) === JSON.stringify(legacyRows.filter((r) => r['Record Date'] === '2026-08-25'))],
    [true, true, true]);
  const bigDay = env.api.getArchiveDayCsv('2026-09-29');
  t('a multi-chunk day reassembles to every live row plus Record Date',
    bigDay.ok === true && JSON.stringify(appRows(bigDay.csv)) === JSON.stringify(appRows(liveCsv).map((r) => ({ 'Record Date': '2026-09-29', ...r }))), true);
  const old = env.api.getArchiveDayCsv('2026-08-24');
  t('a day older than the cache is not served to a visitor without access', [old.ok, old.reason], [false, 'error']);

  env.folderAccess = true; // a visitor who CAN open the folder
  env.cache.delete('bfrArchiveIndexV2');
  const withAccess = env.api.getArchiveIndex();
  const oldDirect = env.api.getArchiveDayCsv('2026-08-24');
  t('a visitor with folder access still sees and opens every date, cached or not',
    [withAccess.dates, oldDirect.ok], [['2026-09-29', '2026-08-26', '2026-08-25', '2026-08-24'], true]);

  const again = env.api.refreshArchiveCache_();
  t('a second run with nothing changed or stale writes nothing', [again.written, again.remaining], [[], 0]);
  const f25 = [...env.fileMap.values()].find((f) => f.name.endsWith('08252026'));
  f25.updated += 1; // someone edited the 08-25 Sheet
  env.nowOffset = 4 * 60 * 60 * 1000 + 60 * 1000; // and every cached day is now over 4 h old
  const later = env.api.refreshArchiveCache_();
  t('an edited Sheet is re-copied first, then days older than 4 h are re-put before the 6 h expiry',
    later.written, ['2026-08-25', '2026-09-29', '2026-08-26']);

  const f26 = [...env.fileMap.values()].find((f) => f.name.endsWith('08262026'));
  f26.exportCode = 500; f26.updated += 1;
  const partial = env.api.refreshArchiveCache_();
  t('one day failing to export is listed and the rest still refresh; the job never throws',
    [partial.ok, partial.failed.length, /2026-08-26/.test(partial.failed[0] || '')], [true, 1, true]);

  // A scan that uses the whole 90 s budget by itself (a very large folder) used to leave the loop with no
  // time, so no day was ever cached and nothing said why. Every run now copies at least one day.
  f25.updated += 1; f26.updated += 1; f26.exportCode = 200; // two days need re-copying
  env.onListing = () => { env.nowOffset += 100 * 1000; };
  const slowScan = env.api.refreshArchiveCache_();
  env.onListing = null;
  t('a scan that uses up the whole budget still copies one day (newest changed first), reports the rest as remaining and the scan time',
    [slowScan.ok, slowScan.written, slowScan.remaining, slowScan.scanMs >= 100 * 1000], [true, ['2026-08-26'], 1, true]);

  // 2026-10-06: with no admin recorded, only the script file's owner may become admin. refreshArchiveCache is public,
  // so before this the first visitor to call it through google.script.run became the admin.
  const claim = throws(() => env.api.refreshArchiveCache());
  t('with no admin recorded, a visitor calling refreshArchiveCache is refused (only the project owner can claim) and no admin is recorded',
    [!!claim && claim.includes('only the owner of this Apps Script project can become the admin'), env.props.has('bfrArchiveAdmin')], [true, false]);
  env.email = 'Kevin@Corp.com';
  let owned;
  try { owned = env.api.refreshArchiveCache(); } catch (err) { owned = { threw: String(err.message || err) }; }
  t('the project owner (matched case-insensitively) becomes the admin and the refresh runs',
    [owned.ok, env.props.get('bfrArchiveAdmin')], [true, 'Kevin@Corp.com']);
  env.email = 'visitor@corp.com';

  env.props.set('bfrArchiveAdmin', 'kevin@corp.com');
  const guard = throws(() => env.api.refreshArchiveCache());
  t('the editor-run refreshArchiveCache is admin-only (a visitor via google.script.run is refused)',
    !!guard && guard.includes('Only the archive admin'), true);
  t('refreshDataFeeds (DataFeeds.gs, the admin\'s 30-minute trigger) calls the archive cache',
    /typeof refreshArchiveCache_ === 'function'[\s\S]{0,80}refreshArchiveCache_\(\)/.test(fs.readFileSync(path.join(root, 'apps-script', 'DataFeeds.gs'), 'utf8')), true);
  t('nothing in the cache path wrote to Drive', env.writes, 0);
}

const EXPECTED = 49;
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

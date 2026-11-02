/**
 * Headless check for the team features in apps-script/DataFeeds.gs and
 * apps-script/TeamSheet.gs (2026-09-29): the shared CSV cache (getDataFeed),
 * VVD notes (getVvdNotes / saveVvdNote, author-only), the startup-error log
 * (logClientStartupError), the config Sheet (readAppConfig_ / injectAppConfig_
 * / setupTeamSheets) and doGet's __SERVER_CONFIG__ injection.
 *
 * Runs the REAL .gs files (Code.gs + DataFeeds.gs + TeamSheet.gs, one shared
 * global namespace exactly as Apps Script loads them) under Node with
 * in-memory fakes for Session, PropertiesService, CacheService (100 KB value
 * limit enforced), LockService, UrlFetchApp, Utilities (real MD5 / gzip),
 * SpreadsheetApp, DriveApp, ScriptApp, HtmlService and ContentService, fed by
 * the committed fixtures. It also loads the app's own config validator (the
 * block between its SERVER CONFIG RESOLUTION markers) verbatim and pushes the
 * server's output through the same JSON-in-a-<script> path the browser sees.
 *
 * The fake spreadsheet mimics the two Sheets behaviours these features depend
 * on: a leading = + - @ makes a string a formula, and a string that looks like
 * a number / date / TRUE is converted on write unless it starts with an
 * apostrophe (which getDisplayValues then hides). What the fakes cannot prove:
 * that the real services behave like them -- real sharing, the onEdit trigger
 * firing, quotas, the sign-in redirect. See apps-script/README.md.
 *
 * Run:  node tests/check_team_features_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const gs = { code: read('apps-script', 'Code.gs'), feeds: read('apps-script', 'DataFeeds.gs'), team: read('apps-script', 'TeamSheet.gs') };
const liveCsv = read('tests', 'fixtures', 'live_csv_2026-08-12.csv');
const sectorCsv = read('tests', 'fixtures', 'sector_data_2026-09-16.csv');

// Same auto-detect rule as check_archive_logic.js (exclude testing builds, take the highest version).
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
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else {
    failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
    console.log(`  FAIL ${name}`);
  }
}
const throws = (fn) => { try { fn(); return null; } catch (err) { return String(err && err.message || err); } };

// ---------------------------------------------------------------------------
// In-memory Sheets. Cells keep exactly what was written; reads apply the
// Sheets semantics described in the header (see displayOf).
// ---------------------------------------------------------------------------
function displayOf(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'boolean') return String(raw).toUpperCase();
  if (typeof raw === 'number') return String(raw);
  const s = String(raw);
  if (s.startsWith("'")) return s.slice(1);                    // text prefix: stored as literal text
  if (/^[=+\-@]/.test(s)) return '#FORMULA';                   // would be evaluated, not shown as text
  if (/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return String(Number(s)); // 1E5 -> 100000, 007 -> 7
  if (/^\d{1,4}[\/.-]\d{1,2}([\/.-]\d{1,4})?/.test(s)) return '#DATE';
  if (/^\d{1,2}:\d{2}/.test(s)) return '#TIME';
  if (/^(true|false)$/i.test(s)) return s.toUpperCase();
  return s;
}

function makeSheet(name, env) {
  const sheet = { name, rows: [], frozen: 0, bold: [] };
  const lastRow = () => { for (let i = sheet.rows.length - 1; i >= 0; i--) if (sheet.rows[i].some((c) => c !== '' && c !== undefined)) return i + 1; return 0; };
  const put = (r, c, v) => {
    while (sheet.rows.length < r) sheet.rows.push([]);
    const row = sheet.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  };
  sheet.api = {
    getName: () => sheet.name,
    setName: (n) => { sheet.name = n; },
    getLastRow: lastRow,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => sheet.api.getRange(r, c, nr, nc).getDisplayValues(),
      getDisplayValues: () => (env.rangeReads++, Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => displayOf((sheet.rows[r - 1 + i] || [])[c - 1 + j])))),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => put(r + i, c + j, v))); },
      setValue: (v) => put(r, c, v),
      setFontWeight: (w) => { sheet.bold.push([r, c, nr, nc, w]); },
    }),
    appendRow: (arr) => {
      if (env.failAppend) throw new Error('append refused');
      const at = lastRow() + 1;
      arr.forEach((v, j) => put(at, j + 1, v));
    },
    deleteRow: (n) => { sheet.rows.splice(n - 1, 1); },
    setFrozenRows: (n) => { sheet.frozen = n; },
  };
  return sheet;
}

function makeSpreadsheet(id, title, env) {
  const ss = { id, title, tabs: [] };
  ss.api = {
    getId: () => id,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
    getSheets: () => ss.tabs.map((s) => s.api),
    getSheetByName: (n) => { const s = ss.tabs.find((x) => x.name === n); return s ? s.api : null; },
    insertSheet: (n) => { const s = makeSheet(n, env); ss.tabs.push(s); return s.api; },
  };
  return ss;
}

// ---------------------------------------------------------------------------
// Environment: the real .gs files under fakes.
// ---------------------------------------------------------------------------
const HTML_TEMPLATE = '<html><head></head><body><div id="root"></div>\n    <script type="text/babel">const app = 1;</script></body></html>';

function makeEnv({ activeEmail = 'a@corp.com', effectiveEmail = 'a@corp.com', codeOnly = false } = {}) {
  const props = new Map();
  const userProps = new Map(); // effective email -> Map (PropertiesService.getUserProperties)
  const cache = new Map();
  const spreadsheets = new Map();
  const triggers = [];
  let seq = 0;
  const env = {
    props, userProps, cache, spreadsheets, triggers, activeEmail, effectiveEmail, userPropsBroken: false, userPropsFull: false,
    urls: {}, fetchCount: 0, lockAvailable: true, lockHook: null, locksTaken: 0, locksReleased: 0,
    cachePutThrows: false, cacheBroken: false, opens: 0, denied: new Set(), failAppend: false,
    sharing: {}, sharingFails: new Set(), triggerFails: false, logs: [], errors: [], warns: [],
    sleeps: 0, sleepHook: null, rangeReads: 0,
    // hourFor(date) -> the hour (0-23) Utilities.formatDate(date, tz, 'H') reports; default noon (business hours).
    hourFor: null, metaGets: 0, getAllCalls: 0, scriptPropReads: {},
  };

  const cacheKeyOk = (k) => { if (String(k).length > 250) throw new Error('Argument too large: key'); };
  const cacheValOk = (v) => { if (Buffer.byteLength(String(v)) > 100 * 1024) throw new Error('Argument too large: value'); };
  const fakes = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => { env.scriptPropReads[k] = (env.scriptPropReads[k] || 0) + 1; return props.has(k) ? props.get(k) : null; },
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
      // One store per EFFECTIVE user (who the script runs as) -- the real service's keying.
      getUserProperties: () => {
        if (env.userPropsBroken) throw new Error('user properties unavailable');
        const who = String(env.effectiveEmail || '').toLowerCase();
        if (!userProps.has(who)) userProps.set(who, new Map());
        const m = userProps.get(who);
        return {
          getProperty: (k) => (m.has(k) ? m.get(k) : null),
          getProperties: () => Object.fromEntries(m),
          setProperty: (k, v) => { if (env.userPropsFull) throw new Error('quota exceeded'); m.set(k, String(v)); },
          deleteProperty: (k) => { m.delete(k); },
        };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { if (env.cacheBroken) throw new Error('cache down'); cacheKeyOk(k); if (/^bfrFeed:.*:meta$/.test(k)) env.metaGets++; return cache.has(k) ? cache.get(k) : null; },
        getAll: (keys) => { if (env.cacheBroken) throw new Error('cache down'); env.getAllCalls++; const o = {}; keys.forEach((k) => { if (cache.has(k)) o[k] = cache.get(k); }); return o; },
        put: (k, v) => { if (env.cacheBroken || env.cachePutThrows) throw new Error('cache put refused'); cacheKeyOk(k); cacheValOk(v); cache.set(k, String(v)); },
        putAll: (obj) => {
          if (env.cacheBroken || env.cachePutThrows) throw new Error('cache put refused');
          Object.keys(obj).forEach((k) => { cacheKeyOk(k); cacheValOk(obj[k]); });
          Object.keys(obj).forEach((k) => cache.set(k, String(obj[k])));
        },
        remove: (k) => { if (env.cacheBroken) throw new Error('cache down'); cache.delete(k); },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (env.lockHook) env.lockHook(); if (env.lockAvailable) env.locksTaken++; return env.lockAvailable; },
        releaseLock: () => { env.locksReleased++; },
      }),
    },
    UrlFetchApp: {
      fetch: (url) => {
        env.fetchCount++;
        const r = env.urls[url];
        if (!r) throw new Error('unexpected fetch ' + url);
        if (r.throws) throw new Error(r.throws);
        return { getResponseCode: () => r.code, getContentText: () => r.text };
      },
    },
    Session: {
      getScriptTimeZone: () => 'America/New_York',
      getActiveUser: () => ({ getEmail: () => env.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => env.effectiveEmail }),
    },
    Utilities: (() => {
      const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
      const toBuf = (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map((b) => b & 255)));
      const newBlob = (data) => {
        const buf = toBuf(data);
        return { getBytes: () => signed(buf), getDataAsString: () => buf.toString('utf8'), _buf: buf };
      };
      return {
        DigestAlgorithm: { MD5: 'md5' },
        Charset: { UTF_8: 'utf8' },
        computeDigest: (alg, text) => signed(crypto.createHash('md5').update(Buffer.from(text, 'utf8')).digest()),
        newBlob,
        gzip: (blob) => newBlob(zlib.gzipSync(blob._buf)),
        ungzip: (blob) => newBlob(zlib.gunzipSync(blob._buf)),
        base64Encode: (bytes) => toBuf(bytes).toString('base64'),
        base64Decode: (s) => signed(Buffer.from(s, 'base64')),
        formatDate: (date, tz, fmt) => (fmt === 'H' ? String(env.hourFor ? env.hourFor(date) : 12) : '2026-09-29'),
        sleep: () => { env.sleeps++; if (env.sleepHook) env.sleepHook(env.sleeps); },
      };
    })(),
    SpreadsheetApp: {
      create: (title) => {
        const id = `sheet${++seq}`;
        const ss = makeSpreadsheet(id, title, env);
        ss.tabs.push(makeSheet('Sheet1', env));
        spreadsheets.set(id, ss);
        return ss.api;
      },
      openById: (id) => {
        env.opens++;
        if (!spreadsheets.has(id) || env.denied.has(id)) throw new Error('Unable to open spreadsheet ' + id);
        return spreadsheets.get(id).api;
      },
    },
    DriveApp: {
      Access: { DOMAIN: 'DOMAIN' },
      Permission: { EDIT: 'EDIT', VIEW: 'VIEW' },
      getFileById: (id) => ({
        setSharing: (access, perm) => {
          if (env.sharingFails.has(id)) throw new Error('sharing blocked by admin policy');
          env.sharing[id] = [access, perm];
        },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (tr) => { triggers.splice(triggers.indexOf(tr), 1); },
      newTrigger: (handler) => {
        const spec = { handler };
        const b = {
          forSpreadsheet: (id) => { spec.sourceId = id; return b; },
          onEdit: () => { spec.event = 'onEdit'; return b; },
          timeBased: () => { spec.event = 'time'; return b; },
          everyMinutes: (n) => { spec.everyMinutes = n; return b; },
          create: () => {
            if (env.triggerFails) throw new Error('trigger quota exceeded');
            const tr = { ...spec, getHandlerFunction: () => handler, getTriggerSourceId: () => spec.sourceId };
            triggers.push(tr);
            return tr;
          },
        };
        return b;
      },
      getService: () => ({ getUrl: () => 'https://script.google.com/exec' }),
    },
    ContentService: { createTextOutput: (text) => ({ text, setMimeType() { return this; } }), MimeType: { JSON: 'JSON', TEXT: 'TEXT', CSV: 'CSV' } },
    HtmlService: {
      createHtmlOutputFromFile: () => ({ getContent: () => HTML_TEMPLATE }),
      createHtmlOutput: (html) => { const o = { html, setTitle() { return o; }, addMetaTag() { return o; } }; return o; },
    },
    MimeType: { CSV: 'text/csv', PLAIN_TEXT: 'text/plain' },
    console: {
      log: (...a) => env.logs.push(a.join(' ')),
      error: (...a) => env.errors.push(a.join(' ')),
      warn: (...a) => env.warns.push(a.join(' ')),
    },
  };
  const names = Object.keys(fakes);
  const exposed = ['getDataFeed', 'md5Hex_', 'writeFeedCache_', 'DATA_FEED_URLS_', 'DATA_FEED_CACHE_SECONDS_', 'DATA_FEED_CHUNK_CHARS_',
    'getVvdNotes', 'saveVvdNote', 'sheetText_', 'logClientStartupError', 'testStartupLog', 'readAppConfig_', 'injectAppConfig_', 'onConfigSheetEdit',
    'refreshAppConfig', 'setupTeamSheets', 'doGet', 'APP_CONFIG_KEYS_', 'APP_CONFIG_DEFAULTS_', 'DEFAULT_PORT_EXCLUSIONS_',
    'VVD_NOTE_MAX_CHARS_', 'getIndexVersionHash_', 'refreshDataFeeds', 'installDataFeedTrigger',
    'DATA_FEED_WAIT_MS_', 'DATA_FEED_POLL_MS_', 'DATA_FEED_TRIGGER_MINUTES_', 'DATA_FEED_BUSY_INTERVAL_MS_',
    'DATA_FEED_QUIET_INTERVAL_MS_', 'DATA_FEED_SLACK_MS_', 'DATA_FEED_QUIET_SKIP_MS_', 'DATA_FEED_BUSY_START_HOUR_',
    'DATA_FEED_BUSY_END_HOUR_', 'VVD_NOTES_CACHE_SECONDS_'];
  const src = `${gs.code}\n${gs.feeds}\n${gs.team}\n;function __setChunk(n) { DATA_FEED_CHUNK_CHARS_ = n; }\n` +
    `return { ${exposed.join(', ')}, __setChunk };`;
  // codeOnly: Code.gs deployed WITHOUT DataFeeds.gs/TeamSheet.gs (a half-finished paste).
  env.api = codeOnly
    ? new Function(...names, `${gs.code}\n;return { doGet };`)(...names.map((n) => fakes[n]))
    : new Function(...names, src)(...names.map((n) => fakes[n]));
  if (codeOnly) return env;

  env.liveUrl = env.api.DATA_FEED_URLS_.live;
  env.sectorUrl = env.api.DATA_FEED_URLS_.sector;
  env.urls[env.liveUrl] = { code: 200, text: liveCsv };
  env.urls[env.sectorUrl] = { code: 200, text: sectorCsv };

  env.feedKeys = (name) => [...cache.keys()].filter((k) => k.startsWith(`bfrFeed:${name}:`)).sort();
  env.seedTeam = () => {
    const ss = fakes.SpreadsheetApp.create('Booking Flash Team Data');
    const id = ss.getId();
    const s = spreadsheets.get(id);
    s.tabs[0].name = 'VVD Notes';
    s.tabs[0].api.appendRow(['VVD', 'Note', 'Author', 'Updated At']);
    props.set('bfrTeamSheetId', id);
    return spreadsheets.get(id);
  };
  env.seedConfig = ({ settings, ports }) => {
    const ss = fakes.SpreadsheetApp.create('Booking Flash Config');
    const id = ss.getId();
    const s = spreadsheets.get(id);
    s.tabs[0].name = 'Settings';
    s.tabs[0].api.appendRow(['Key', 'Value', 'Notes']);
    settings.forEach((row) => s.tabs[0].api.appendRow(row));
    if (ports) {
      const p = ss.insertSheet('Port Exclusions');
      p.appendRow(['Lane', 'Port']);
      ports.forEach((row) => p.appendRow(row));
    }
    props.set('bfrConfigSheetId', id);
    return spreadsheets.get(id);
  };
  env.tab = (ss, name) => ss.tabs.find((x) => x.name === name);
  return env;
}

const ownRows = (ss, tabName = 'VVD Notes') => ss.tabs.find((x) => x.name === tabName).api.getRange(1, 1, Math.max(1, ss.tabs.find((x) => x.name === tabName).api.getLastRow()), 4).getDisplayValues();
const rawRows = (ss, tabName = 'VVD Notes') => ss.tabs.find((x) => x.name === tabName).rows.map((r) => r.slice());

// ===========================================================================
console.log('\n[feeds] constants');
{
  const env = makeEnv();
  const appLive = appSrc.match(/const CSV_SOURCE_URL = '([^']+)'/)[1];
  const appSector = appSrc.match(/const SECTOR_DATA_CSV_URL = '([^']+)'/)[1];
  t('DATA_FEED_URLS_.live equals the app\'s CSV_SOURCE_URL', env.api.DATA_FEED_URLS_.live, appLive);
  t('DATA_FEED_URLS_.sector equals the app\'s SECTOR_DATA_CSV_URL', env.api.DATA_FEED_URLS_.sector, appSector);
  const a = env.api;
  t('schedule: a 30-minute trigger, every run 8:00-17:00 and hourly outside, and a cached copy outlives the hourly window',
    [a.DATA_FEED_TRIGGER_MINUTES_, a.DATA_FEED_BUSY_START_HOUR_, a.DATA_FEED_BUSY_END_HOUR_, a.DATA_FEED_BUSY_INTERVAL_MS_, a.DATA_FEED_QUIET_INTERVAL_MS_,
      a.DATA_FEED_QUIET_SKIP_MS_ > a.DATA_FEED_TRIGGER_MINUTES_ * 60000 && a.DATA_FEED_QUIET_SKIP_MS_ < a.DATA_FEED_QUIET_INTERVAL_MS_,
      a.DATA_FEED_CACHE_SECONDS_ * 1000 > a.DATA_FEED_QUIET_INTERVAL_MS_ + a.DATA_FEED_SLACK_MS_],
    [30, 8, 17, 30 * 60000, 60 * 60000, true, true]);
  t('a reader waits at most a few seconds for another visitor\'s download (the app is waiting on the reply)', a.DATA_FEED_WAIT_MS_ <= 5000, true);
  t('the notes cache lasts 1 hour (saves write through; this only bounds direct Sheet edits)', a.VVD_NOTES_CACHE_SECONDS_, 3600);
  const text = 'Vessel 1st VVD,Näme\r\n"x\ny",é漢';
  t('md5Hex_ is lowercase hex MD5 of the UTF-8 text', env.api.md5Hex_(text), crypto.createHash('md5').update(text, 'utf8').digest('hex'));
  t('md5Hex_ pads bytes below 0x10 (same digest as index-version hash)', env.api.md5Hex_(HTML_TEMPLATE), env.api.getIndexVersionHash_());
}

console.log('\n[feeds] download, encodings, chunking');
{
  const env = makeEnv();
  const md5 = crypto.createHash('md5').update(liveCsv, 'utf8').digest('hex');
  const gz = env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('gzip reply: shape, hash and ISO fetchedAt', [gz.ok, gz.name, gz.encoding, gz.hash, !Number.isNaN(Date.parse(gz.fetchedAt)), gz.unchanged], [true, 'live', 'gzip-base64', md5, true, undefined]);
  t('gzip data decodes byte-identical to the live fixture', zlib.gunzipSync(Buffer.from(gz.data, 'base64')).toString('utf8') === liveCsv, true);
  const nChunks = Math.ceil(gz.data.length / 90000);
  const keys = env.feedKeys('live');
  const meta = JSON.parse(env.cache.get('bfrFeed:live:meta'));
  console.log(`  (live fixture: ${liveCsv.length} chars -> ${gz.data.length} gzip-base64 chars -> ${nChunks} chunks)`);
  t('live fixture needs more than one chunk; keys are meta + 0..n-1', [nChunks > 1, keys], [true, ['bfrFeed:live:0', ...Array.from({ length: nChunks - 1 }, (_, i) => `bfrFeed:live:${i + 1}`), 'bfrFeed:live:meta'].sort()]);
  t('meta is {v:1, hash, fetchedAt, chunks}', [meta.v, meta.hash, meta.fetchedAt, meta.chunks], [1, md5, gz.fetchedAt, nChunks]);
  t('every chunk is at most 90,000 chars and they concatenate to the payload',
    [Array.from({ length: nChunks }, (_, i) => env.cache.get(`bfrFeed:live:${i}`).length).every((n) => n <= 90000), Array.from({ length: nChunks }, (_, i) => env.cache.get(`bfrFeed:live:${i}`)).join('') === gz.data], [true, true]);

  const before = env.fetchCount;
  const text = env.api.getDataFeed({ name: 'live', have: null, gzip: false });
  t('text reply from cache is byte-identical, same hash and fetchedAt, and did not fetch again',
    [text.encoding, text.data === liveCsv, text.hash, text.fetchedAt, env.fetchCount - before], ['text', true, md5, gz.fetchedAt, 0]);
  const gz2 = env.api.getDataFeed({ name: 'live', have: 'stale', gzip: true });
  t('a stale "have" gets full data from the cache (no fetch)', [gz2.encoding, gz2.data === gz.data, env.fetchCount - before], ['gzip-base64', true, 0]);
  const same = env.api.getDataFeed({ name: 'live', have: md5, gzip: true });
  t('"have" equal to the cached hash gets a data-free unchanged reply, with the copy\'s age',
    [same, same.ageMs >= 0 && same.ageMs < 60000], [{ ok: true, name: 'live', hash: md5, fetchedAt: gz.fetchedAt, ageMs: same.ageMs, unchanged: true }, true]);
  t('data replies carry ageMs too', [typeof gz.ageMs, typeof text.ageMs], ['number', 'number']);

  env.metaGets = 0; env.getAllCalls = 0;
  env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('a cache hit that sends data reads the meta once and the chunks once', [env.metaGets, env.getAllCalls], [1, 1]);
  env.metaGets = 0; env.getAllCalls = 0;
  env.api.getDataFeed({ name: 'live', have: md5, gzip: true });
  t('an unchanged reply reads the meta only, never the chunks', [env.metaGets, env.getAllCalls], [1, 0]);

  const sector = makeEnv();
  const sg = sector.api.getDataFeed({ name: 'sector', have: null, gzip: true });
  const st = sector.api.getDataFeed({ name: 'sector', have: null, gzip: false });
  t('sector feed round-trips (gzip and text) and is its own cache entry',
    [zlib.gunzipSync(Buffer.from(sg.data, 'base64')).toString('utf8') === sectorCsv, st.data === sectorCsv, sector.feedKeys('sector'), sector.feedKeys('live')],
    [true, true, ['bfrFeed:sector:0', 'bfrFeed:sector:meta'], []]);
}

{
  const env = makeEnv();
  const md5 = crypto.createHash('md5').update(liveCsv, 'utf8').digest('hex');
  const first = env.api.getDataFeed({ name: 'live', have: md5, gzip: true });
  t('fresh download whose hash equals "have" replies unchanged and still fills the cache',
    [first.unchanged, first.data, env.feedKeys('live').length > 0, env.fetchCount], [true, undefined, true, 1]);
}

{
  const env = makeEnv();
  env.api.__setChunk(50000);
  const gz = env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  const n = JSON.parse(env.cache.get('bfrFeed:live:meta')).chunks;
  t('a smaller chunk size forces more chunks and the reply is unaffected', [n, n > 3, gz.data.length], [Math.ceil(gz.data.length / 50000), true, gz.data.length]);
  const before = env.fetchCount;
  const cached = env.api.getDataFeed({ name: 'live', have: null, gzip: false });
  t('multi-chunk cache reassembles to the exact CSV without fetching', [cached.data === liveCsv, env.fetchCount - before], [true, 0]);
  env.cache.delete('bfrFeed:live:1');
  const again = env.api.getDataFeed({ name: 'live', have: null, gzip: false });
  t('a missing chunk is a cache miss: refetches and rewrites the whole set',
    [again.data === liveCsv, env.fetchCount - before, env.feedKeys('live').length], [true, 1, n + 1]);
}

console.log('\n[feeds] download claims, freshness, cache failures, rejects');
{
  const env = makeEnv();
  env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  env.api.getDataFeed({ name: 'sector', have: null, gzip: true });
  t('getDataFeed never takes the script lock (shared with note saves and the archive jobs)', env.locksTaken, 0);
  t('a finished download leaves no claim behind', [env.cache.has('bfrFeed:live:claim'), env.cache.has('bfrFeed:sector:claim')], [false, false]);

  const env2 = makeEnv();
  env2.cache.set('bfrFeed:live:claim', '1'); // another visitor is downloading
  env2.sleepHook = (n) => {
    if (n === 2) env2.api.writeFeedCache_('live', 'abc123', new Date().toISOString(), Buffer.from(zlib.gzipSync(Buffer.from('cached-by-someone-else'))).toString('base64'));
  };
  const r = env2.api.getDataFeed({ name: 'live', have: null, gzip: false });
  t('a claimed feed waits for that download and serves its copy (no second fetch)',
    [r.data, r.hash, env2.fetchCount, env2.sleeps], ['cached-by-someone-else', 'abc123', 0, 2]);

  const env3 = makeEnv();
  env3.cache.set('bfrFeed:live:claim', '1');
  const busy = env3.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('a claim that never produces a copy -> busy after a bounded wait, no fetch',
    [busy, env3.fetchCount, env3.sleeps], [{ ok: false, reason: 'busy' }, 0, env3.api.DATA_FEED_WAIT_MS_ / env3.api.DATA_FEED_POLL_MS_]);

  const env4 = makeEnv();
  env4.cache.set('bfrFeed:live:claim', '1');
  env4.sleepHook = () => env4.cache.delete('bfrFeed:live:claim'); // that download failed
  const gaveUp = env4.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('a claim released without a copy -> busy at once (the app fetches the Sheet directly)', [gaveUp, env4.sleeps], [{ ok: false, reason: 'busy' }, 1]);

  const env5 = makeEnv();
  env5.cache.set('bfrFeed:sector:claim', '1');
  const liveOk = env5.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('a claim on one feed does not hold up the other', [liveOk.ok, env5.sleeps, env5.fetchCount], [true, 0, 1]);

  const env6 = makeEnv();
  const md5 = crypto.createHash('md5').update(liveCsv, 'utf8').digest('hex');
  env6.api.writeFeedCache_('live', md5, new Date(Date.now() - env6.api.DATA_FEED_QUIET_INTERVAL_MS_ - env6.api.DATA_FEED_SLACK_MS_ - 1000).toISOString(), 'x');
  const stale = env6.api.getDataFeed({ name: 'live', have: md5, gzip: true });
  t('a cached copy older than the freshness window is a miss: refetched, then compared',
    [stale.unchanged, env6.fetchCount, Date.now() - Date.parse(stale.fetchedAt) < 60000], [true, 1, true]);
}

{
  // The wait loop reads chunks only once a fresh copy has landed.
  const env7 = makeEnv();
  const gzB64 = (s) => Buffer.from(zlib.gzipSync(Buffer.from(s))).toString('base64');
  env7.api.writeFeedCache_('live', 'old', new Date(Date.now() - 5 * 3600000).toISOString(), gzB64('stale copy'));
  env7.cache.set('bfrFeed:live:claim', '1');
  env7.getAllCalls = 0;
  env7.sleepHook = (n) => { if (n === 3) env7.api.writeFeedCache_('live', 'new1', new Date().toISOString(), gzB64('fresh copy')); };
  const w = env7.api.getDataFeed({ name: 'live', have: null, gzip: false });
  t('waiting on a claim polls the meta only: a stale copy\'s chunks are never read, the fresh one\'s once',
    [w.data, env7.sleeps, env7.getAllCalls, env7.fetchCount], ['fresh copy', 3, 1, 0]);
}

console.log('\n[feeds] schedule: freshness by time of day');
{
  const md5 = crypto.createHash('md5').update(liveCsv, 'utf8').digest('hex');
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const probe = (hourFor, ageMin) => {
    const env = makeEnv();
    env.hourFor = hourFor;
    env.api.writeFeedCache_('live', md5, ago(ageMin), 'x');
    const r = env.api.getDataFeed({ name: 'live', have: md5, gzip: true });
    return env.fetchCount; // 0 = served the cached copy, 1 = it was stale and re-downloaded
  };
  t('business hours (10:00): a 35-min-old copy is served, a 45-min-old one is re-downloaded', [probe(() => 10, 35), probe(() => 10, 45)], [0, 1]);
  t('outside business hours (22:00): a 65-min-old copy is served, a 75-min-old one is re-downloaded', [probe(() => 22, 65), probe(() => 22, 75)], [0, 1]);
  // Copy downloaded at 7:10 (quiet), read at 8:05 (busy): still within the hourly window it was made under.
  const at = (d) => (Date.now() - d.getTime() > 60000 ? 7 : 8);
  t('a copy from before 8:00 is not dropped the moment business hours start (longer of the two windows)', probe(at, 55), 0);
}

console.log('\n[feeds] notOlderThanMs (a browser that last fetched the Sheet directly)');
{
  const env = makeEnv();
  const md5 = crypto.createHash('md5').update(liveCsv, 'utf8').digest('hex');
  env.api.writeFeedCache_('live', md5, new Date(Date.now() - 10 * 60000).toISOString(), Buffer.from(zlib.gzipSync(Buffer.from(liveCsv))).toString('base64'));
  env.getAllCalls = 0;
  const older = env.api.getDataFeed({ name: 'live', have: null, gzip: true, notOlderThanMs: 60000 });
  t('a copy older than the browser\'s direct download -> {older:true}, no data, no chunks read, no download',
    [older.ok, older.older, older.data, older.unchanged, env.getAllCalls, env.fetchCount], [true, true, undefined, undefined, 0, 0]);
  const newer = env.api.getDataFeed({ name: 'live', have: null, gzip: true, notOlderThanMs: 20 * 60000 });
  t('a copy newer than the direct download -> full data', [newer.encoding, newer.older, env.fetchCount], ['gzip-base64', undefined, 0]);
  t('notOlderThanMs must be a non-negative number', [env.api.getDataFeed({ name: 'live', notOlderThanMs: 'x' }), env.api.getDataFeed({ name: 'live', notOlderThanMs: -1 })],
    [{ ok: false, reason: 'invalid-request' }, { ok: false, reason: 'invalid-request' }]);
}

console.log('\n[feeds] refreshDataFeeds / installDataFeedTrigger');
{
  const env = makeEnv();
  env.api.refreshDataFeeds();
  const again = env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('the trigger fills both feeds, so the next reader is served from the cache',
    [env.fetchCount, env.feedKeys('sector').length > 0, again.ok, env.cache.has('bfrFeed:live:claim')], [2, true, true, false]);
  env.cache.set('bfrFeed:sector:claim', '1');
  env.api.refreshDataFeeds();
  t('a feed someone is already downloading is skipped', env.fetchCount, 3);
  env.cache.delete('bfrFeed:sector:claim');
  env.urls[env.liveUrl] = { code: 500, text: '' };
  let threw = null;
  try { env.api.refreshDataFeeds(); } catch (err) { threw = String(err); }
  t('a failed download is logged, not thrown (a throwing trigger emails its owner every run)',
    [threw, env.warns.some((w) => /refreshDataFeeds: live fetch-failed/.test(w))], [null, true]);

  const cfg = makeEnv();
  cfg.seedConfig({ settings: [['scheduleChange.laneNetLossThreshold', 4, '']], ports: null });
  cfg.api.refreshDataFeeds();
  t('the trigger also refills an evicted config cache, so doGet never opens the config Sheet',
    JSON.parse(cfg.cache.get('bfrAppConfig')).settings, { 'scheduleChange.laneNetLossThreshold': '4' });
  const opens = cfg.opens;
  cfg.api.refreshDataFeeds();
  t('...and leaves a cached config alone', cfg.opens - opens, 0);
}
{
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const run = (hour, ageMin) => {
    const env = makeEnv();
    env.hourFor = () => hour;
    ['live', 'sector'].forEach((n) => env.api.writeFeedCache_(n, 'h', ago(ageMin), 'x'));
    env.api.refreshDataFeeds();
    return env.fetchCount;
  };
  t('business hours: every 30-minute run re-downloads both feeds, even a 5-min-old copy', run(10, 5), 2);
  t('outside business hours: a run skips copies under 45 min old (the in-between half-hour run)...', run(22, 30), 0);
  t('...and re-downloads once they are 45+ min old, so it acts hourly', run(22, 50), 2);
  t('the 8:00 and 17:00 edges: 8:xx is business hours, 17:xx is not', [run(8, 30), run(17, 30), run(7, 30), run(16, 30)], [2, 0, 0, 2]);
}
{
  const env = makeEnv();
  env.props.set('bfrArchiveAdmin', 'boss@corp.com');
  let threw = null;
  try { env.api.installDataFeedTrigger(); } catch (err) { threw = String(err); }
  t('installDataFeedTrigger is admin-only', [/archive admin/.test(threw), env.triggers.length], [true, 0]);
  env.activeEmail = 'boss@corp.com';
  const r1 = env.api.installDataFeedTrigger();
  env.api.installDataFeedTrigger();
  t('admin: one time trigger for refreshDataFeeds, replaced (not duplicated) on re-run, and it warms the cache now',
    [r1.ok, env.triggers.map((x) => [x.handler, x.event, x.everyMinutes]), env.feedKeys('live').length > 0],
    [true, [['refreshDataFeeds', 'time', env.api.DATA_FEED_TRIGGER_MINUTES_]], true]);
}

{
  const env = makeEnv();
  env.cachePutThrows = true;
  const r = env.api.getDataFeed({ name: 'sector', have: null, gzip: false });
  t('a cache write that throws does not fail the request', [r.ok, r.data === sectorCsv], [true, true]);
  const env2 = makeEnv();
  env2.cacheBroken = true;
  const r2 = env2.api.getDataFeed({ name: 'sector', have: null, gzip: false });
  t('a completely broken cache still serves a fresh download', [r2.ok, r2.data === sectorCsv], [true, true]);
}

{
  const env = makeEnv();
  env.urls[env.liveUrl] = { code: 200, text: '<!DOCTYPE html><html>Sign in</html>' };
  const r = env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('an HTML body -> not-the-export, nothing cached, claim released', [r, env.feedKeys('live').length, env.cache.has('bfrFeed:live:claim')], [{ ok: false, reason: 'not-the-export' }, 0, false]);
  env.urls[env.liveUrl] = { code: 200, text: '\uFEFF  \n<html>' };
  t('a BOM/whitespace then "<" is still HTML', env.api.getDataFeed({ name: 'live', have: null, gzip: true }).reason, 'not-the-export');
  env.urls[env.liveUrl] = { code: 200, text: ' \r\n\t ' };
  t('whitespace only -> not-the-export', env.api.getDataFeed({ name: 'live', have: null, gzip: true }).reason, 'not-the-export');
  env.urls[env.liveUrl] = { code: 200, text: 'Some,Other,Header\r\n1,2,3\r\n' };
  t('live CSV without the "Vessel 1st VVD" column -> not-the-export', env.api.getDataFeed({ name: 'live', have: null, gzip: true }).reason, 'not-the-export');
  env.urls[env.sectorUrl] = { code: 200, text: 'Some,Other,Header\r\n1,2,3\r\n' };
  t('the required-column rule is live-only (any CSV passes for sector)', env.api.getDataFeed({ name: 'sector', have: null, gzip: false }).ok, true);
  env.urls[env.sectorUrl] = { code: 200, text: '<html>' };
  env.cache.clear();
  t('sector HTML -> not-the-export', env.api.getDataFeed({ name: 'sector', have: null, gzip: false }).reason, 'not-the-export');
}

{
  const env = makeEnv();
  env.urls[env.liveUrl] = { code: 500, text: '' };
  const r = env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('HTTP 500 -> fetch-failed with the status in the message', [r.ok, r.reason, /HTTP 500/.test(r.error)], [false, 'fetch-failed', true]);
  env.urls[env.liveUrl] = { throws: 'DNS error' };
  const r2 = env.api.getDataFeed({ name: 'live', have: null, gzip: true });
  t('a thrown fetch -> fetch-failed, lock released, no throw', [r2.reason, /DNS error/.test(r2.error), env.locksTaken === env.locksReleased], ['fetch-failed', true, true]);
}

{
  const env = makeEnv();
  const bad = [undefined, null, 5, 'live', [], {}, { name: 'other' }, { name: '__proto__' }, { name: 'constructor' }, { name: 'toString' },
    { name: 'live', have: 5 }, { name: 'live', have: 'x'.repeat(65) }, { name: ['live'] }, { name: 'live ' }];
  const results = bad.map((b) => env.api.getDataFeed(b));
  t('invalid requests -> invalid-request without fetching or locking',
    [results.every((r) => r.ok === false && r.reason === 'invalid-request'), env.fetchCount, env.locksTaken], [true, 0, 0]);
  t('gzip is only honored for a literal true', env.api.getDataFeed({ name: 'sector', have: null, gzip: 'yes' }).encoding, 'text');
}

// ===========================================================================
console.log('\n[notes] VVD notes');
{
  const env = makeEnv();
  t('not configured: get and save both say not-configured',
    [env.api.getVvdNotes(), env.api.saveVvdNote('CMHF024E', 'x')], [{ ok: false, reason: 'not-configured' }, { ok: false, reason: 'not-configured' }]);

  const ss = env.seedTeam();
  t('an empty team sheet lists no notes and reports me (a caller that does not ask for private notes gets privateAvailable false)', env.api.getVvdNotes(), { ok: true, me: 'a@corp.com', notes: [], privateAvailable: false });
  const saved = env.api.saveVvdNote('  cmhf024e ', '  Hold 200 TEU for Acme  ');
  t('save normalizes the VVD, trims the note, records the author and returns the fresh list',
    [saved.ok, saved.me, saved.notes.map((n) => [n.vvd, n.note, n.author]), !Number.isNaN(Date.parse(saved.notes[0].updatedAt))],
    [true, 'a@corp.com', [['CMHF024E', 'Hold 200 TEU for Acme', 'a@corp.com']], true]);
  t('the row lands in the sheet in the documented column order', ownRows(ss)[1].slice(0, 3), ['CMHF024E', 'Hold 200 TEU for Acme', 'a@corp.com']);

  const t0 = saved.notes[0].updatedAt;
  const upd = env.api.saveVvdNote('CMHF024E', 'Now 250 TEU');
  t('saving again updates my own row in place (still one row) and refreshes Updated At',
    [upd.notes.length, upd.notes[0].note, upd.notes[0].updatedAt >= t0, ownRows(ss).length], [1, 'Now 250 TEU', true, 2]);

  const del = env.api.saveVvdNote('CMHF024E', '   ');
  t('an empty (whitespace) note deletes my row', [del.ok, del.notes, ownRows(ss).length], [true, [], 1]);
  t('an empty note with no existing row is a harmless no-op', [env.api.saveVvdNote('ZZZ1', '').ok, ownRows(ss).length], [true, 1]);
  t('the public API takes no author or identity argument (vvd, note, visibility; get takes only an options object)', [env.api.saveVvdNote.length, env.api.getVvdNotes.length], [3, 1]);
}

{
  const env = makeEnv();
  const ss = env.seedTeam();
  env.activeEmail = 'a@corp.com';
  env.api.saveVvdNote('CMHF024E', 'A note');
  env.activeEmail = 'B@Corp.com';
  const b = env.api.saveVvdNote('CMHF024E', 'B note');
  t('two users can note the same VVD: both rows exist, each under its own author (emails lowercased)',
    [b.me, b.notes.map((n) => [n.vvd, n.note, n.author]).sort()], ['b@corp.com', [['CMHF024E', 'A note', 'a@corp.com'], ['CMHF024E', 'B note', 'b@corp.com']]]);
  const b2 = env.api.saveVvdNote('CMHF024E', 'B note v2');
  t('B updating changes only B\'s row', b2.notes.map((n) => [n.author, n.note]).sort(), [['a@corp.com', 'A note'], ['b@corp.com', 'B note v2']]);
  const bdel = env.api.saveVvdNote('CMHF024E', '');
  t('B deleting leaves A\'s note untouched', [bdel.notes.map((n) => [n.author, n.note]), ownRows(ss).length], [[['a@corp.com', 'A note']], 2]);
  const bOnly = env.api.saveVvdNote('OTHER1', 'B on another VVD');
  t('a note on another VVD does not touch A\'s row', bOnly.notes.map((n) => n.vvd).sort(), ['CMHF024E', 'OTHER1']);
  // Write-through: every reply (append, update, delete, with other authors' rows around) must equal a fresh read.
  env.activeEmail = 'a@corp.com';
  const reads = env.rangeReads;
  const last = env.api.saveVvdNote('CMHF024E', 'A note v2');
  t('a save reads the notes tab once (the reply is built from that read, not a second one)', env.rangeReads - reads, 1);
  env.cache.delete('bfrVvdNotes');
  t('the written-through list equals a fresh read of the Sheet after appends, updates and deletes', env.api.getVvdNotes().notes, last.notes);
  const opens = env.opens;
  env.api.getVvdNotes();
  env.api.getVvdNotes();
  t('getVvdNotes on a cache hit does not open the spreadsheet', env.opens - opens, 0);
  env.activeEmail = 'a@corp.com';
  t('A sees B\'s notes with B as author and A as me', (() => { const r = env.api.getVvdNotes(); return [r.me, r.notes.length, r.notes.find((n) => n.vvd === 'OTHER1').author]; })(), ['a@corp.com', 2, 'b@corp.com']);
}

{
  const env = makeEnv();
  const ss = env.seedTeam();
  const r = (v, n) => env.api.saveVvdNote(v, n);
  const invalidVvds = ['', ' ', 'A', '<script>', 'AB!C', '-ABC', 'A'.repeat(41), null, undefined, {}, [], true, 'AB\nCD'].map((v) => r(v, 'x').reason);
  t('invalid VVDs -> invalid-vvd', invalidVvds.every((x) => x === 'invalid-vvd'), true);
  t('valid VVD shapes (2 chars, 40 chars, dots/slashes/spaces/dashes) are accepted',
    ['AB', 'A'.repeat(40), 'ab.c/d-e 1'].map((v) => r(v, 'x').ok), [true, true, true]);
  const invalidNotes = [5, null, undefined, {}, [], 'x'.repeat(1001), ` ${'x'.repeat(1001)} `].map((n) => r('CMHF024E', n).reason);
  t('non-string or over-1000-char notes -> invalid-note', invalidNotes.every((x) => x === 'invalid-note'), true);
  t('a note of exactly 1000 chars (even space-padded) is accepted',
    [r('LEN1', 'x'.repeat(env.api.VVD_NOTE_MAX_CHARS_)).ok, r('LEN2', `  ${'y'.repeat(1000)}  `).ok], [true, true]);
  t('rejected saves wrote nothing (only the 5 valid-shape/length rows exist)', ownRows(ss).length, 1 + 3 + 2);
}

{
  const env = makeEnv();
  const ss = env.seedTeam();
  const evil = '=HYPERLINK("http://evil.example","click")';
  const r = env.api.saveVvdNote('CMHF024E', evil);
  t('a note starting with = is stored with a leading apostrophe and read back without it',
    [rawRows(ss)[1][1], r.notes[0].note], ["'" + evil, evil]);
  const cases = ['+1+1', '-2+3', '@SUM(A1)', '\tTAB', '\rCR', '1E5', '1/2', 'true', '2026-09-29', '12:30'];
  const back = cases.map((c) => { env.api.saveVvdNote('GUARD1', c); return env.api.getVvdNotes().notes.find((n) => n.vvd === 'GUARD1').note; });
  t('every formula-like or number/date/boolean-like note round-trips as the exact text typed (trimmed)', back, cases.map((c) => c.trim()));
  t('a VVD that Sheets would turn into a number (1E5) is stored as text and found again for update/delete',
    (() => { env.api.saveVvdNote('1E5', 'first'); env.api.saveVvdNote('1E5', 'second'); const l = env.api.getVvdNotes().notes.filter((n) => n.vvd === '1E5'); env.api.saveVvdNote('1E5', ''); return [l.length, l[0].note, env.api.getVvdNotes().notes.some((n) => n.vvd === '1E5')]; })(),
    [1, 'second', false]);
  const s = env.api.sheetText_;
  t('sheetText_ prefixes formula/number/date-like text and leaves ordinary text and non-strings alone',
    [s('=A1'), s('+1'), s('-x'), s('@x'), s('\tx'), s('\rx'), s('hello'), s('CMHF024E'), s(''), s(null), s(undefined), s(5)], ["'=A1", "'+1", "'-x", "'@x", "'\tx", "'\rx", 'hello', 'CMHF024E', '', '', '', "'5"]);
}

{
  const env = makeEnv();
  env.seedTeam();
  env.activeEmail = '';
  t('no visitor identity: save -> no-user-identity, get still works with me:null',
    [env.api.saveVvdNote('CMHF024E', 'x'), env.api.getVvdNotes()], [{ ok: false, reason: 'no-user-identity' }, { ok: true, me: null, notes: [], privateAvailable: false }]);
  env.activeEmail = 'not-an-email';
  t('an identity without "@" is treated as none', env.api.saveVvdNote('CMHF024E', 'x').reason, 'no-user-identity');
}

{
  const env = makeEnv();
  const ss = env.seedTeam();
  env.api.saveVvdNote('CMHF024E', 'first');
  env.api.getVvdNotes();
  t('getVvdNotes caches the list (not me) under bfrVvdNotes', [env.cache.has('bfrVvdNotes'), 'me' in JSON.parse(env.cache.get('bfrVvdNotes'))], [true, false]);
  ss.tabs[0].api.appendRow(['SNEAK1', 'edited directly in the Sheet', 'c@corp.com', '2026-09-29T00:00:00.000Z']);
  t('while cached, a direct Sheet edit is not yet visible (proves the cache is used)', env.api.getVvdNotes().notes.length, 1);
  env.activeEmail = 'z@corp.com';
  t('the cached list is shared but me is per visitor', env.api.getVvdNotes().me, 'z@corp.com');
  env.api.saveVvdNote('CMHF024E', 'second');
  t('a save invalidates the cache (the direct edit is now visible)', [env.api.getVvdNotes().notes.length], [3]);
  env.api.saveVvdNote('AB', 'x');
  const saved = env.api.saveVvdNote('CD', 'y');
  t('the save writes its fresh list into the cache (write-through, not just invalidation)', JSON.parse(env.cache.get('bfrVvdNotes')),
    saved.notes.map(({ visibility, ...n }) => n));
  env.cachePutThrows = true;
  t('a cache that refuses writes does not break reads', env.api.getVvdNotes().ok, true);
  env.cachePutThrows = false;
  env.cacheBroken = true;
  t('a broken cache does not break reads or saves', [env.api.getVvdNotes().ok, env.api.saveVvdNote('EF', 'z').ok], [true, true]);
}

{
  const env = makeEnv();
  env.seedTeam();
  env.lockAvailable = false;
  const before = env.spreadsheets.size;
  const r = env.api.saveVvdNote('CMHF024E', 'x');
  t('lock not acquired on save -> busy, nothing written', [r, ownRows([...env.spreadsheets.values()][0]).length], [{ ok: false, reason: 'busy' }, 1]);
  env.lockAvailable = true;
  env.props.set('bfrTeamSheetId', 'gone');
  const e1 = env.api.getVvdNotes();
  const e2 = env.api.saveVvdNote('CMHF024E', 'x');
  t('a team sheet that no longer opens -> reason error with a message (no throw)', [e1.reason, typeof e1.error, e2.reason], ['error', 'string', 'error']);
  const ss = env.seedTeam();
  ss.tabs.splice(0, 1);
  t('a missing VVD Notes tab -> reason error naming the tab', [env.api.getVvdNotes().reason, /VVD Notes/.test(env.api.getVvdNotes().error), env.api.saveVvdNote('CMHF024E', 'x').reason], ['error', true, 'error']);
}

// ===========================================================================
console.log('\n[notes] private VVD notes (2026-10-01)');
const P = { privateNotes: true }; // what the page sends: it understands visibility
{
  const env = makeEnv();
  t('not configured: a private save says not-configured and writes nothing',
    [env.api.saveVvdNote('CMHF024E', 'x', 'private'), env.userProps.size], [{ ok: false, reason: 'not-configured' }, 0]);
  const ss = env.seedTeam();
  const pub = env.api.saveVvdNote('CMHF024E', 'Cut 40 TEU', 'public');
  const priv = env.api.saveVvdNote('  cmhf024e ', '  call the shipper  ', 'private');
  t('a private save normalizes the VVD, trims the note and returns it tagged private next to the public one',
    [priv.ok, priv.me, priv.privateAvailable, priv.notes.map((n) => [n.vvd, n.note, n.author, n.visibility])],
    [true, 'a@corp.com', true, [['CMHF024E', 'Cut 40 TEU', 'a@corp.com', 'public'], ['CMHF024E', 'call the shipper', 'a@corp.com', 'private']]]);
  t('the private note is in A\'s own user properties, not in the team Sheet or the shared cache',
    [JSON.parse(env.userProps.get('a@corp.com').get('bfrPrivVvdNote:CMHF024E')).note, ownRows(ss).length, /call the shipper/.test(env.cache.get('bfrVvdNotes') || '')],
    ['call the shipper', 2, false]);
  t('every public note carries visibility:public', pub.notes.map((n) => n.visibility), ['public']);
  t('getVvdNotes returns my private note to me', env.api.getVvdNotes(P).notes.filter((n) => n.visibility === 'private').map((n) => n.note), ['call the shipper']);

  env.activeEmail = 'b@corp.com'; env.effectiveEmail = 'b@corp.com';
  const asB = env.api.getVvdNotes(P);
  t('another visitor (B) sees A\'s public note but never A\'s private one',
    [asB.privateAvailable, asB.notes.map((n) => [n.author, n.note, n.visibility])], [true, [['a@corp.com', 'Cut 40 TEU', 'public']]]);
  env.api.saveVvdNote('CMHF024E', 'B private', 'private');
  env.activeEmail = 'a@corp.com'; env.effectiveEmail = 'a@corp.com';
  t('and A never sees B\'s private note', env.api.getVvdNotes(P).notes.filter((n) => n.visibility === 'private').map((n) => n.note), ['call the shipper']);

  const upd = env.api.saveVvdNote('CMHF024E', 'call again Friday', 'private');
  t('saving my private note again replaces it (still one private note on that VVD)',
    upd.notes.filter((n) => n.visibility === 'private').map((n) => n.note), ['call again Friday']);
  const delPriv = env.api.saveVvdNote('CMHF024E', '', 'private');
  t('deleting my private note leaves my public note on the same VVD',
    [delPriv.notes.map((n) => [n.note, n.visibility]), env.userProps.get('a@corp.com').has('bfrPrivVvdNote:CMHF024E')], [[['Cut 40 TEU', 'public']], false]);
  env.api.saveVvdNote('CMHF024E', 'back again', 'private');
  const delPub = env.api.saveVvdNote('CMHF024E', '', 'public');
  t('deleting my public note leaves my private note on the same VVD',
    [delPub.notes.map((n) => [n.note, n.visibility]), ownRows(ss).length], [[['back again', 'private']], 1]);

  const legacy = env.api.saveVvdNote('OLD1', 'from a page loaded before this change');
  const legacyNull = env.api.saveVvdNote('OLD2', 'null visibility', null);
  t('no visibility argument (pages loaded before 2026-10-01) or null saves a PUBLIC note, as before',
    [legacy.ok, legacyNull.ok, ownRows(ss).slice(1).map((r) => r[0]).sort()], [true, true, ['OLD1', 'OLD2']]);
  const rowsBefore = ownRows(ss).length;
  const propsBefore = env.userProps.get('a@corp.com').size;
  t('an unknown visibility is rejected without writing anything',
    [['everyone', 'PUBLIC', 'Private', 1, true, {}].map((v) => env.api.saveVvdNote('BAD1', 'x', v).reason).every((r) => r === 'invalid-visibility'),
      ownRows(ss).length === rowsBefore, env.userProps.get('a@corp.com').size === propsBefore], [true, true, true]);
  t('private notes get the same VVD and length checks as public ones',
    [env.api.saveVvdNote('<script>', 'x', 'private').reason, env.api.saveVvdNote('LEN3', 'x'.repeat(1001), 'private').reason, env.api.saveVvdNote('LEN4', 'y'.repeat(1000), 'private').ok],
    ['invalid-vvd', 'invalid-note', true]);
  const evil = '=HYPERLINK("http://evil.example","x")';
  t('a formula-like private note round-trips exactly (it never reaches a Sheet)',
    env.api.saveVvdNote('EVIL1', evil, 'private').notes.find((n) => n.vvd === 'EVIL1').note, evil);
  env.lockAvailable = false;
  const locks = env.locksTaken;
  t('a private save needs no script lock (works while the lock is busy)', [env.api.saveVvdNote('LOCK1', 'x', 'private').ok, env.locksTaken - locks], [true, 0]);
  env.lockAvailable = true;
}

{
  // "Execute as: Me": the script runs as the owner for every visitor, so getUserProperties() would be
  // the OWNER's store, shared by everyone. Private notes must refuse, not leak.
  const env = makeEnv({ activeEmail: 'owner@corp.com', effectiveEmail: 'owner@corp.com' });
  env.seedTeam();
  env.api.saveVvdNote('SECRET1', 'owner private', 'private');
  env.activeEmail = 'visitor@corp.com';
  const got = env.api.getVvdNotes(P);
  t('when the script runs as someone else (Execute as: Me), no private notes are read and privateAvailable is false',
    [got.ok, got.privateAvailable, got.notes.length], [true, false, 0]);
  t('... and a private save is refused without touching the owner\'s store',
    [env.api.saveVvdNote('SECRET2', 'visitor private', 'private'), [...env.userProps.get('owner@corp.com').keys()]],
    [{ ok: false, reason: 'private-unavailable' }, ['bfrPrivVvdNote:SECRET1']]);
  t('... while public notes still save', env.api.saveVvdNote('PUB1', 'cut', 'public').ok, true);
  env.activeEmail = '';
  t('no visitor identity: a private save -> no-user-identity', env.api.saveVvdNote('X1', 'x', 'private').reason, 'no-user-identity');
}

{
  const env = makeEnv();
  env.seedTeam();
  env.api.saveVvdNote('PUB1', 'cut', 'public');
  const store = (() => { env.api.saveVvdNote('OK1', 'fine', 'private'); return env.userProps.get('a@corp.com'); })();
  store.set('bfrPrivVvdNote:BAD JSON', '{not json');
  store.set('bfrPrivVvdNote:<bad>', JSON.stringify({ note: 'bad key' }));
  store.set('bfrPrivVvdNote:EMPTY1', JSON.stringify({ note: '' }));
  store.set('bfrPrivVvdNote:NUM1', JSON.stringify({ note: 5 }));
  store.set('someOtherKey', 'unrelated');
  t('malformed or unrelated user properties are skipped, not shown or thrown on',
    env.api.getVvdNotes(P).notes.filter((n) => n.visibility === 'private').map((n) => n.vvd), ['OK1']);
  env.userPropsFull = true;
  const full = env.api.saveVvdNote('FULL1', 'x', 'private');
  t('a full user store makes the private save fail with an error, not a throw', [full.ok, full.reason, typeof full.error], [false, 'error', 'string']);
  env.userPropsFull = false;
  env.userPropsBroken = true;
  const g = env.api.getVvdNotes(P);
  t('user properties down: getVvdNotes still returns the public notes, with privateAvailable false',
    [g.ok, g.privateAvailable, g.notes.map((n) => n.vvd)], [true, false, ['PUB1']]);
  t('user properties down: a public save still works', env.api.saveVvdNote('PUB2', 'cut', 'public').ok, true);
  t('user properties down: a private save -> error', env.api.saveVvdNote('P1', 'x', 'private').reason, 'error');
}

{
  // Review fix 2026-10-02: a tab opened BEFORE the deploy runs the old page, which treats any note
  // by its viewer as "my note" and saves with no visibility (= public). It must never be handed a
  // private note, or editing it there would publish the private text.
  const env = makeEnv();
  env.seedTeam();
  env.api.saveVvdNote('CMHF024E', 'Cut 40 TEU', 'public');
  env.api.saveVvdNote('CMHF024E', 'my private text', 'private');
  const oldGet = env.api.getVvdNotes();
  t('old page: getVvdNotes() with no options returns only public notes and privateAvailable false',
    [oldGet.privateAvailable, oldGet.notes.map((n) => [n.note, n.visibility])], [false, [['Cut 40 TEU', 'public']]]);
  const oldSave = env.api.saveVvdNote('CMHF024E', 'edited in an old tab');
  t('old page: the reply to a legacy saveVvdNote(vvd, note) carries no private note either',
    [oldSave.ok, oldSave.privateAvailable, oldSave.notes.some((n) => n.visibility === 'private' || /private text/.test(n.note))], [true, false, false]);
  t('only a literal { privateNotes: true } opts in',
    [{ privateNotes: 'true' }, { privateNotes: 1 }, 'privateNotes', true, null, []].map((o) => env.api.getVvdNotes(o).notes.some((n) => n.visibility === 'private')),
    [false, false, false, false, false, false]);
  t('the new page (opted in) still gets my private note, untouched by the old tab\'s public save',
    env.api.getVvdNotes(P).notes.filter((n) => n.visibility === 'private').map((n) => n.note), ['my private text']);
}

{
  // Review fix 2026-10-02: the private note is saved even when the public list can't be read back
  // afterwards; that must not be reported as "not saved".
  const env = makeEnv();
  env.seedTeam();
  env.cache.clear();
  env.props.set('bfrTeamSheetId', 'gone'); // configured, but the Sheet no longer opens
  const r = env.api.saveVvdNote('KEEP2', 'still saved', 'private');
  t('a private save whose public re-read fails reports ok with notes:null (the page re-reads), and the note is stored',
    [r.ok, r.notes, JSON.parse(env.userProps.get('a@corp.com').get('bfrPrivVvdNote:KEEP2')).note], [true, null, 'still saved']);
}

{
  // Call-count pin: the team-Sheet id Script Property is read ONCE per request, including on a cache miss
  // (getVvdNotes / the private save read it for the 'not-configured' guard and hand it on to openTeamSheet_).
  const env = makeEnv();
  env.seedTeam();
  const reads = () => env.scriptPropReads.bfrTeamSheetId || 0;
  const count = (fn) => { const r0 = reads(); const o0 = env.opens; const ok = fn().ok; return [ok, reads() - r0, env.opens - o0]; };
  env.cache.delete('bfrVvdNotes');
  t('getVvdNotes on a cache MISS reads the team-Sheet id property once and opens the Sheet once',
    count(() => env.api.getVvdNotes({ privateNotes: true })), [true, 1, 1]);
  t('getVvdNotes on a cache HIT reads the property once and opens no Sheet',
    count(() => env.api.getVvdNotes({ privateNotes: true })), [true, 1, 0]);
  env.cache.delete('bfrVvdNotes');
  t('a private save with a cold cache reads the property once and opens the Sheet once; a public save once and once',
    [count(() => env.api.saveVvdNote('CNT1', 'p', 'private')), count(() => env.api.saveVvdNote('CNT1', 'q', 'public'))], [[true, 1, 1], [true, 1, 1]]);
}

// ===========================================================================
console.log('\n[startup log] logClientStartupError');
{
  const env = makeEnv();
  const ss = env.seedTeam();
  const report = {
    reason: 'R'.repeat(5000), errors: Array.from({ length: 12 }, (_, i) => `err${i}` + 'e'.repeat(600)).concat([5, null, {}]),
    reactLoaded: false, userAgent: 'U'.repeat(500), page: 'P'.repeat(500), at: '2026-09-29T10:00:00.000Z',
  };
  const res = env.api.logClientStartupError(report);
  const line = env.errors[0];
  const logged = JSON.parse(line.slice('[startup-error] '.length));
  t('logs to the sheet and returns logged:"sheet"', res, { ok: true, logged: 'sheet' });
  t('the console line starts with [startup-error], parses as JSON, carries the user and is truncated per the limits',
    [line.startsWith('[startup-error] '), logged.user, logged.reason.length, logged.errors.length, logged.errors.every((e) => e.length === 500), logged.userAgent.length, logged.page.length, logged.reactLoaded],
    [true, 'a@corp.com', 2000, 8, true, 300, 300, false]);
  const tab = env.tab(ss, 'Startup Errors');
  const row = tab.api.getRange(2, 1, 1, 7).getDisplayValues()[0];
  t('the Startup Errors tab is created with its header and the row has the documented columns',
    [tab.api.getRange(1, 1, 1, 7).getDisplayValues()[0], !Number.isNaN(Date.parse(row[0])), row[1], row[2].length, row[3].split('\n').length, row[4], row[5].length, row[6].length, tab.frozen],
    [['Time', 'User', 'Reason', 'Errors', 'React Loaded', 'Browser', 'Page'], true, 'a@corp.com', 2000, 8, 'no', 300, 300, 1]);
  env.api.logClientStartupError({ reason: 'x', errors: [], reactLoaded: true });
  t('React Loaded reads yes/no', tab.api.getRange(3, 5, 1, 1).getDisplayValues()[0][0], 'yes');
  env.api.logClientStartupError({ reason: '=cmd|"/c calc"!A1', errors: ['+SUM(1)', '@x'], userAgent: '-1', page: '=1' });
  t('user-controlled strings are formula-guarded in the sheet',
    [rawRows(ss, 'Startup Errors')[3][2], rawRows(ss, 'Startup Errors')[3][3], rawRows(ss, 'Startup Errors')[3][5], rawRows(ss, 'Startup Errors')[3][6]],
    ['\'=cmd|"/c calc"!A1', "'+SUM(1)\n@x", "'-1", "'=1"]);
}

{
  // The editor's Run button passes no argument: that logs a blank report (the thing testStartupLog exists to avoid).
  const env = makeEnv();
  const ss = env.seedTeam();
  const blank = env.api.logClientStartupError();
  const blankLogged = JSON.parse(env.errors[0].slice('[startup-error] '.length));
  t('run with no argument (the editor Run button): logs an all-blank report with only the user filled in',
    [blank, blankLogged.reason, blankLogged.errors, blankLogged.reactLoaded, blankLogged.user], [{ ok: true, logged: 'sheet' }, '', [], null, 'a@corp.com']);

  const res = env.api.testStartupLog();
  const line = JSON.parse(env.errors[1].slice('[startup-error] '.length));
  t('testStartupLog sends a filled-in report through the real function and returns its result', res, { ok: true, logged: 'sheet' });
  t('the testStartupLog console line is clearly a test, with every field filled in',
    [/^manual test/.test(line.reason), line.errors.length, line.reactLoaded, line.userAgent, line.page, !Number.isNaN(Date.parse(line.at)), line.user],
    [true, 2, false, 'Apps Script editor', 'testStartupLog', true, 'a@corp.com']);
  t('testStartupLog also logs its result line', env.logs.some((l) => l.startsWith('testStartupLog result: ')), true);
  t('the test row reaches the Startup Errors tab (blank run + test run = 2 rows)', env.tab(ss, 'Startup Errors').api.getLastRow(), 3);
  const bare = makeEnv();
  t('testStartupLog without a team Sheet degrades to console, not a throw', bare.api.testStartupLog(), { ok: true, logged: 'console' });
}

{
  // testStartupLog is public (callable by any visitor via google.script.run), so once an admin is recorded it is admin-only.
  const env = makeEnv({ activeEmail: 'admin@corp.com', effectiveEmail: 'admin@corp.com' });
  const ss = env.seedTeam();
  env.props.set('bfrArchiveAdmin', 'admin@corp.com');
  const ok = env.api.testStartupLog();
  t('the recorded admin can run testStartupLog: it reaches the sheet (one row) and the admin is unchanged',
    [ok, env.tab(ss, 'Startup Errors').api.getLastRow(), env.props.get('bfrArchiveAdmin')], [{ ok: true, logged: 'sheet' }, 2, 'admin@corp.com']);

  env.activeEmail = 'visitor@corp.com';
  const rowsBefore = env.tab(ss, 'Startup Errors').api.getLastRow();
  const errsBefore = env.errors.length;
  const logsBefore = env.logs.length;
  const err = throws(() => env.api.testStartupLog());
  t('a non-admin is refused with the admin error, writes no row, logs nothing and does not touch the rate-limit counter',
    [/Only the archive admin \(admin@corp\.com\) can run this\./.test(err), env.tab(ss, 'Startup Errors').api.getLastRow(), env.errors.length, env.logs.length, env.cache.has('bfrStartupErr:visitor@corp.com'), env.props.get('bfrArchiveAdmin')],
    [true, rowsBefore, errsBefore, logsBefore, false, 'admin@corp.com']);

  env.activeEmail = ''; env.effectiveEmail = '';
  const errAnon = throws(() => env.api.testStartupLog());
  t('with an admin recorded, an unresolvable caller is refused too (no anon row, no anon rate-limit key)',
    [/Could not resolve the caller/.test(errAnon), env.tab(ss, 'Startup Errors').api.getLastRow(), env.cache.has('bfrStartupErr:anon')], [true, rowsBefore, false]);
}

{
  // No admin recorded (setup not run): still allowed, and it must never make the caller admin.
  const env = makeEnv({ activeEmail: 'owner@corp.com', effectiveEmail: 'owner@corp.com' });
  const res = env.api.testStartupLog();
  t('with no admin recorded testStartupLog still works (console only, no team Sheet) and does NOT record an admin',
    [res, env.props.has('bfrArchiveAdmin')], [{ ok: true, logged: 'console' }, false]);
  env.activeEmail = 'visitor@corp.com';
  t('with no admin recorded a visitor call also records no admin',
    [env.api.testStartupLog().ok, env.props.has('bfrArchiveAdmin')], [true, false]);
}

{
  const env = makeEnv();
  const ss = env.seedTeam();
  const outcomes = [];
  for (let i = 0; i < 7; i++) outcomes.push(env.api.logClientStartupError({ reason: 'boom ' + i }).logged);
  t('the 6th and later reports within 10 minutes are rate-limited', outcomes, ['sheet', 'sheet', 'sheet', 'sheet', 'sheet', 'rate-limited', 'rate-limited']);
  t('every report still writes its console line, but only 5 rows reach the sheet', [env.errors.length, env.tab(ss, 'Startup Errors').api.getLastRow()], [7, 6]);
  env.activeEmail = 'other@corp.com';
  t('the limit is per user', env.api.logClientStartupError({ reason: 'mine' }).logged, 'sheet');
  env.activeEmail = '';
  const anon = [1, 2, 3, 4, 5, 6].map(() => env.api.logClientStartupError({ reason: 'anon' }).logged);
  t('anonymous reports share one "anon" bucket', [anon[4], anon[5], env.cache.has('bfrStartupErr:anon')], ['sheet', 'rate-limited', true]);
}

{
  const env = makeEnv();
  t('not configured: console only', [env.api.logClientStartupError({ reason: 'x' }), env.errors.length], [{ ok: true, logged: 'console' }, 1]);
  const ss = env.seedTeam();
  env.failAppend = true;
  const r = env.api.logClientStartupError({ reason: 'x' });
  t('a sheet failure returns logged:"console" with the error, not a throw', [r.ok, r.logged, /append refused/.test(r.error)], [true, 'console', true]);
  env.failAppend = false;
  env.props.set('bfrTeamSheetId', 'gone');
  const r2 = env.api.logClientStartupError({ reason: 'x' });
  t('an unopenable team sheet also degrades to console', [r2.ok, r2.logged], [true, 'console']);
  env.cacheBroken = true;
  t('a broken cache neither blocks nor breaks logging', env.api.logClientStartupError({ reason: 'x' }).ok, true);
  void ss;
}

{
  const env = makeEnv();
  env.seedTeam();
  const throwingGetter = {}; Object.defineProperty(throwingGetter, 'reason', { get() { throw new Error('getter boom'); }, enumerable: true });
  const garbage = [undefined, null, 5, 'a string', true, [], [1, 2], {}, { errors: 'x' }, { errors: [{}, null, 5, [], () => 1] }, { reason: { toString() { throw new Error('x'); } } },
    { reason: 'x'.repeat(2e6), errors: ['y'.repeat(2e6)], userAgent: 'u'.repeat(2e6), page: 'p'.repeat(2e6), at: 'a'.repeat(2e6) }, throwingGetter, () => 1, Symbol('s')];
  let threw = null;
  const results = [];
  garbage.forEach((g, i) => { try { results.push(env.api.logClientStartupError(g)); } catch (err) { threw = `#${i}: ${err}`; } });
  t('never throws on garbage input (null, numbers, huge strings, throwing getters)', [threw, results.every((r) => r && r.ok === true)], [null, true]);
  t('the huge report was truncated in the console line', env.errors.some((l) => l.length < 5000 && l.includes('"reason":"xxx')), true);
}

// ===========================================================================
console.log('\n[config] readAppConfig_ / injectAppConfig_ / doGet');
{
  const env = makeEnv();
  t('not configured', env.api.readAppConfig_(), { available: false, reason: 'not-configured' });
  env.props.set('bfrConfigSheetId', 'gone');
  const e = env.api.readAppConfig_();
  t('a config sheet that no longer opens -> available:false, reason error (never throws)', [e.available, e.reason, typeof e.error], [false, 'error', 'string']);
  const ss = env.seedConfig({ settings: [], ports: null });
  ss.tabs.splice(0, 1);
  t('a missing Settings tab -> reason error naming the tab', [env.api.readAppConfig_().reason, /Settings/.test(env.api.readAppConfig_().error)], ['error', true]);
  t('errors and not-configured are not cached', env.cache.has('bfrAppConfig'), false);
  const opens = env.opens;
  env.api.readAppConfig_();
  t('a failed read is remembered for this visitor and this Sheet: no reopen on the next page load', env.opens - opens, 0);
  env.activeEmail = 'someone.else@corp.com';
  env.api.readAppConfig_();
  t('...but another visitor still tries the Sheet', env.opens - opens, 1);
}

{
  const env = makeEnv();
  env.seedConfig({
    settings: [
      ['scheduleChange.perLaneRemovedRatePct', 35, 'note'], ['scheduleChange.laneSizeForRatePct', '', ''], [' scheduleChange.laneNetLossThreshold ', ' 3 ', ''],
      ['sectorSummary.laneExclude', 'exe, exw ,abc', ''], ['foo.bar', 'x', ''], ['', 'orphan value', ''], ['Foo.Bar', 'y', ''], ['foo.bar', 'again', ''],
    ],
    ports: [['ms2', ' matng '], ['', 'SGSIN'], ['CP2', ''], ['fp1', 'deham'], ['', '']],
  });
  const c = env.api.readAppConfig_();
  t('settings: only the four allowed keys with a non-blank value, trimmed, as raw strings',
    c.settings, { 'scheduleChange.perLaneRemovedRatePct': '35', 'scheduleChange.laneNetLossThreshold': '3', 'sectorSummary.laneExclude': 'exe, exw ,abc' });
  t('unknownKeys lists each key present but not allowed, once (blank keys ignored)', c.unknownKeys, ['foo.bar', 'Foo.Bar']);
  t('portExclusions: rows with both cells, trimmed and uppercased', c.portExclusions, [{ lane: 'MS2', port: 'MATNG' }, { lane: 'FP1', port: 'DEHAM' }]);
  t('available, with an ISO loadedAt', [c.available, !Number.isNaN(Date.parse(c.loadedAt))], [true, true]);
  const opens = env.opens;
  const again = env.api.readAppConfig_();
  t('second read is served from the bfrAppConfig cache (no reopen, same loadedAt)', [again.loadedAt, env.opens - opens], [c.loadedAt, 0]);
  const cfgSs = [...env.spreadsheets.values()].find((x) => x.title === 'Booking Flash Config');
  env.tab(cfgSs, 'Settings').api.getRange(2, 2).setValue(36);
  t('onConfigSheetEdit re-reads the Sheet into the cache (harmless with any argument)',
    [env.api.onConfigSheetEdit({ any: 'thing' }), JSON.parse(env.cache.get('bfrAppConfig')).settings['scheduleChange.perLaneRemovedRatePct']], [undefined, '36']);
  const opens2 = env.opens;
  t('...so the next page load gets the edit without opening the Sheet',
    [env.api.readAppConfig_().settings['scheduleChange.perLaneRemovedRatePct'], env.opens - opens2], ['36', 0]);
  env.tab(cfgSs, 'Settings').api.getRange(2, 2).setValue(37);
  t('refreshAppConfig does the same and returns {ok:true}', [env.api.refreshAppConfig(), JSON.parse(env.cache.get('bfrAppConfig')).settings['scheduleChange.perLaneRemovedRatePct']], [{ ok: true }, '37']);
  env.tab(cfgSs, 'Settings').name = 'Renamed';
  t('a re-read that fails clears the cache (no stale copy) and refreshAppConfig reports it', [env.api.refreshAppConfig().ok, env.cache.has('bfrAppConfig')], [false, false]);
}

{
  const env = makeEnv();
  env.seedConfig({ settings: [['scheduleChange.laneNetLossThreshold', 4, '']], ports: null });
  t('Port Exclusions tab missing -> portExclusions null', env.api.readAppConfig_().portExclusions, null);
  const env2 = makeEnv();
  env2.seedConfig({ settings: [], ports: [] });
  const c2 = env2.api.readAppConfig_();
  t('Port Exclusions with only a header -> [] (exclude nothing); empty Settings -> no settings', [c2.portExclusions, c2.settings, c2.unknownKeys], [[], {}, []]);
  const env3 = makeEnv();
  const ss3 = env3.seedConfig({ settings: [], ports: [] });
  ss3.tabs[1].rows = [];
  t('a completely empty Port Exclusions tab is also []', env3.api.readAppConfig_().portExclusions, []);
  env3.cachePutThrows = true;
  t('an unusable cache still returns the config', env3.api.readAppConfig_().available, true);
}

{
  const env = makeEnv();
  const cfg = { available: true, settings: {}, unknownKeys: [], portExclusions: null, loadedAt: 'x' };
  const html = env.api.injectAppConfig_(HTML_TEMPLATE, cfg);
  const marker = '<script type="text/babel">';
  const tag = '<script>window.__SERVER_CONFIG__=' + JSON.stringify(cfg) + ';</script>\n    ';
  t('injected immediately before the babel marker; the rest of the page is untouched',
    [html.indexOf(tag + marker) > 0, html.replace(tag, '') === HTML_TEMPLATE], [true, true]);
  const evil = env.api.injectAppConfig_(HTML_TEMPLATE, { available: true, settings: { k: '</script><script>alert(1)</script>' } });
  t('"<" is escaped as \\u003c so a value cannot close the script tag',
    [evil.split('</script>').length === HTML_TEMPLATE.split('</script>').length + 1, evil.includes('\\u003c/script>')], [true, true]);
  t('marker missing -> html returned unchanged', env.api.injectAppConfig_('<html>no marker</html>', cfg), '<html>no marker</html>');
}

{
  // doGet's typeof guard: pasting the new Code.gs but not TeamSheet.gs must still serve the app.
  const env = makeEnv({ codeOnly: true });
  let out = null, threw = null;
  try { out = env.api.doGet({ parameter: {} }).html; } catch (err) { threw = String(err); }
  t('Code.gs alone (TeamSheet.gs not pasted yet) still serves the page, just without __SERVER_CONFIG__',
    [threw, !!out && out.includes('<script type="text/babel">'), !!out && out.includes('window.__SERVER_CONFIG__=')], [null, true, false]);
}

{
  const env = makeEnv();
  const out = env.api.doGet({ parameter: {} }).html;
  const iCfg = out.indexOf('window.__SERVER_CONFIG__=');
  const iMarker = out.indexOf('<script type="text/babel">');
  t('doGet serves __SERVER_CONFIG__ (unavailable/not-configured) before the babel script, alongside the existing globals',
    [iCfg > 0 && iCfg < iMarker, out.includes('window.__EXEC_URL__='), out.includes('window.__SERVER_PREFS__='), out.includes('window.__SERVER_EXTRAS__='),
      out.match(/window\.__SERVER_CONFIG__=(.*?);<\/script>/)[1]],
    [true, true, true, true, JSON.stringify({ available: false, reason: 'not-configured' })]);
  env.seedConfig({ settings: [['scheduleChange.laneSizeForRatePct', 9, '']], ports: null });
  const out2 = env.api.doGet({ parameter: {} }).html;
  const cfg = JSON.parse(out2.match(/window\.__SERVER_CONFIG__=(.*?);<\/script>/)[1]);
  t('doGet carries a configured sheet\'s values', [cfg.available, cfg.settings], [true, { 'scheduleChange.laneSizeForRatePct': '9' }]);
}

// ===========================================================================
console.log('\n[config] defaults and the app\'s own validator');
const appDefaults = (() => {
  const num = (key) => Number(appSrc.match(new RegExp(`appConfigValue\\('${key.replace(/\./g, '\\.')}',\\s*([0-9.]+)\\)`))[1]);
  const excl = appSrc.match(/appConfigValue\('sectorSummary\.laneExclude',\s*\[([^\]]*)\]\)/)[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).join(', ');
  const seedBlock = appSrc.match(/const PORT_EXCLUDE_SEED = \[([\s\S]*?)\];/)[1];
  const ports = [...seedBlock.matchAll(/\{\s*lane:\s*'([^']+)',\s*port:\s*'([^']+)'\s*\}/g)].map((m) => ({ lane: m[1], port: m[2] }));
  return {
    'scheduleChange.perLaneRemovedRatePct': num('scheduleChange.perLaneRemovedRatePct'),
    'scheduleChange.laneSizeForRatePct': num('scheduleChange.laneSizeForRatePct'),
    'scheduleChange.laneNetLossThreshold': num('scheduleChange.laneNetLossThreshold'),
    'sectorSummary.laneExclude': excl,
    ports,
  };
})();

const resolverSrc = (() => {
  const m = appSrc.match(/\/\/ --- SERVER CONFIG RESOLUTION START ---[\s\S]*?\/\/ --- SERVER CONFIG RESOLUTION END ---/);
  if (!m) throw new Error('SERVER CONFIG RESOLUTION markers not found in the app file');
  return m[0];
})();
// Runs the app's block with a fake window, exactly as the browser would after the injected <script> ran.
function appResolve(windowConfigJs) {
  const warns = [];
  const win = {};
  new Function('window', windowConfigJs)(win);
  const api = new Function('window', 'console', `${resolverSrc}\nreturn { SERVER_CONFIG_RULES, resolveServerConfig, APP_CONFIG, appConfigValue };`)(win, { warn: (...a) => warns.push(a.join(' ')) });
  return { ...api, warns };
}
const configJsFromHtml = (html) => html.match(/<script>(window\.__SERVER_CONFIG__=[\s\S]*?;)<\/script>/)[1];

{
  const env = makeEnv();
  t('server defaults for the four keys equal the app\'s appConfigValue fallbacks', env.api.APP_CONFIG_DEFAULTS_, {
    'scheduleChange.perLaneRemovedRatePct': appDefaults['scheduleChange.perLaneRemovedRatePct'],
    'scheduleChange.laneSizeForRatePct': appDefaults['scheduleChange.laneSizeForRatePct'],
    'scheduleChange.laneNetLossThreshold': appDefaults['scheduleChange.laneNetLossThreshold'],
    'sectorSummary.laneExclude': appDefaults['sectorSummary.laneExclude'],
  });
  t('the default port-exclusion list equals the app\'s PORT_EXCLUDE_SEED (18 pairs)', [env.api.DEFAULT_PORT_EXCLUSIONS_, appDefaults.ports.length], [appDefaults.ports, 18]);
  const app = appResolve('');
  t('SERVER_CONFIG_RULES keys equal APP_CONFIG_KEYS_ exactly (a key on one side only fails here)',
    [Object.keys(app.SERVER_CONFIG_RULES).sort(), env.api.APP_CONFIG_KEYS_.slice().sort()], [env.api.APP_CONFIG_KEYS_.slice().sort(), env.api.APP_CONFIG_KEYS_.slice().sort()]);
  t('every key the server allows is actually read by the app through appConfigValue',
    env.api.APP_CONFIG_KEYS_.every((k) => appSrc.includes(`appConfigValue('${k}',`)), true);
  const absent = appResolve('');
  t('no injected config (local dev / old Code.gs) -> unavailable, defaults apply, no warnings',
    [absent.APP_CONFIG.available, absent.APP_CONFIG.reason, absent.APP_CONFIG.warnings, absent.appConfigValue('scheduleChange.laneNetLossThreshold', 2)], [false, 'absent', [], 2]);
  const notCfg = appResolve(configJsFromHtml(env.api.doGet({ parameter: {} }).html));
  t('server "not-configured" reaches the app as unavailable with that reason', [notCfg.APP_CONFIG.available, notCfg.APP_CONFIG.reason, notCfg.APP_CONFIG.portExclusions], [false, 'not-configured', null]);
}

{
  // The sheet exactly as setupTeamSheets fills it in -> the app must resolve the same values it already uses.
  const env = makeEnv();
  env.api.setupTeamSheets();
  const app = appResolve(configJsFromHtml(env.api.doGet({ parameter: {} }).html));
  t('the setupTeamSheets defaults resolve, in the app, to exactly the app\'s built-in values (numbers, lane list, 18 port pairs), with no warnings',
    [app.APP_CONFIG.available, app.APP_CONFIG.values, app.APP_CONFIG.portExclusions, app.APP_CONFIG.warnings, app.warns],
    [true, {
      'scheduleChange.perLaneRemovedRatePct': appDefaults['scheduleChange.perLaneRemovedRatePct'],
      'scheduleChange.laneSizeForRatePct': appDefaults['scheduleChange.laneSizeForRatePct'],
      'scheduleChange.laneNetLossThreshold': appDefaults['scheduleChange.laneNetLossThreshold'],
      'sectorSummary.laneExclude': appDefaults['sectorSummary.laneExclude'].split(', '),
    }, appDefaults.ports, [], []]);
}

{
  const env = makeEnv();
  const ss = env.seedConfig({
    settings: [['scheduleChange.perLaneRemovedRatePct', '55.5', ''], ['scheduleChange.laneSizeForRatePct', '12', ''], ['scheduleChange.laneNetLossThreshold', '3', ''], ['sectorSummary.laneExclude', 'exe, exw, ex3', '']],
    ports: [['ms2', 'matng'], ['CP4', 'CNYTN']],
  });
  const run = () => { env.cache.clear(); return appResolve(configJsFromHtml(env.api.doGet({ parameter: {} }).html)); };
  const ok = run();
  t('valid values (decimal percent, whole numbers, mixed-case lane list) resolve to numbers and uppercased lists',
    [ok.APP_CONFIG.values, ok.APP_CONFIG.portExclusions, ok.APP_CONFIG.warnings], [{
      'scheduleChange.perLaneRemovedRatePct': 55.5, 'scheduleChange.laneSizeForRatePct': 12, 'scheduleChange.laneNetLossThreshold': 3, 'sectorSummary.laneExclude': ['EXE', 'EXW', 'EX3'],
    }, [{ lane: 'MS2', port: 'MATNG' }, { lane: 'CP4', port: 'CNYTN' }], []]);
  t('appConfigValue returns the override when valid and the fallback for keys not supplied',
    [ok.appConfigValue('scheduleChange.laneSizeForRatePct', 8), ok.appConfigValue('nope', 'fb')], [12, 'fb']);

  const settingsTab = ss.tabs[0];
  const setVal = (row, v) => { settingsTab.rows[row][1] = v; };
  // rows: 1 = perLane%, 2 = laneSize, 3 = netLoss, 4 = laneExclude
  setVal(1, 'abc'); setVal(2, '0'); setVal(3, '2.5'); setVal(4, 'exe, TOOLONGCODE, e$e');
  const bad = run();
  t('invalid values ("abc", "0", "2.5" for an int, bad lane codes) fall back per key with one warning each',
    [bad.APP_CONFIG.values, bad.APP_CONFIG.warnings.length, bad.APP_CONFIG.warnings.map((w) => w.split(':')[0]), bad.warns.length],
    [{}, 4, ['scheduleChange.perLaneRemovedRatePct', 'scheduleChange.laneSizeForRatePct', 'scheduleChange.laneNetLossThreshold', 'sectorSummary.laneExclude'], 1]);
  t('a rejected key makes appConfigValue fall back to the app default', bad.appConfigValue('scheduleChange.laneSizeForRatePct', 8), 8);

  setVal(1, '101'); setVal(2, '1001'); setVal(3, '-1'); setVal(4, 'EXE');
  const range = run();
  t('out-of-range numbers (101 %, 1001, -1) fall back; one valid key alongside still applies',
    [Object.keys(range.APP_CONFIG.values), range.APP_CONFIG.values['sectorSummary.laneExclude'], range.APP_CONFIG.warnings.length], [['sectorSummary.laneExclude'], ['EXE'], 3]);

  setVal(1, '40'); setVal(2, '8'); setVal(3, '2'); setVal(4, '');
  ss.tabs[0].api.appendRow(['mystery.key', 'x', '']);
  ss.tabs[1].api.appendRow(['CP2', 'ABC']);
  ss.tabs[1].api.appendRow(['bad lane!', 'CNYPG']);
  const misc = run();
  t('a blank value means "use the default" (key absent, no warning); unknown keys warn; a bad port pair is skipped with a warning',
    [Object.keys(misc.APP_CONFIG.values).sort(), misc.APP_CONFIG.values['sectorSummary.laneExclude'], misc.APP_CONFIG.warnings.filter((w) => /mystery/.test(w)).length,
      misc.APP_CONFIG.warnings.filter((w) => /Port Exclusions/.test(w)).length, misc.APP_CONFIG.portExclusions.length],
    [['scheduleChange.laneNetLossThreshold', 'scheduleChange.laneSizeForRatePct', 'scheduleChange.perLaneRemovedRatePct'], undefined, 1, 2, 2]);

  // Port list: null (tab missing) vs [] (header only) vs rows, through the same injected-script path.
  ss.tabs.splice(1, 1);
  t('Port Exclusions tab absent -> the app keeps its seed (portExclusions null)', run().APP_CONFIG.portExclusions, null);
  ss.tabs.push(makeSheet('Port Exclusions', env));
  ss.tabs[1].api.appendRow(['Lane', 'Port']);
  t('Port Exclusions header-only -> [] (the app then excludes nothing)', run().APP_CONFIG.portExclusions, []);
}

// ===========================================================================
console.log('\n[setup] setupTeamSheets');
{
  const env = makeEnv({ activeEmail: 'admin@corp.com', effectiveEmail: 'admin@corp.com' });
  const res = env.api.setupTeamSheets();
  const team = env.spreadsheets.get(env.props.get('bfrTeamSheetId'));
  const config = env.spreadsheets.get(env.props.get('bfrConfigSheetId'));
  t('returns {ok, both URLs, sharing ok for both, trigger installed}',
    [res.ok, res.teamSheetUrl === team.api.getUrl(), res.configSheetUrl === config.api.getUrl(), res.sharing, res.triggerInstalled, res.triggerError],
    [true, true, true, { team: 'ok', config: 'ok' }, true, undefined]);
  t('team data: both tabs with the documented headers, bold + frozen, no leftover Sheet1',
    [team.tabs.map((x) => x.name), rawRows(team, 'VVD Notes'), rawRows(team, 'Startup Errors'), team.tabs.map((x) => x.frozen), team.tabs.every((x) => x.bold.length === 1)],
    [['VVD Notes', 'Startup Errors'], [['VVD', 'Note', 'Author', 'Updated At']], [['Time', 'User', 'Reason', 'Errors', 'React Loaded', 'Browser', 'Page']], [1, 1], true]);
  const settingsRows = rawRows(config, 'Settings');
  t('config Settings tab: header + the four keys with their defaults and a non-empty note each',
    [settingsRows[0], settingsRows.slice(1).map((r) => [r[0], r[1]]), settingsRows.slice(1).every((r) => typeof r[2] === 'string' && r[2].length > 20)],
    [['Key', 'Value', 'Notes'], env.api.APP_CONFIG_KEYS_.map((k) => [k, env.api.APP_CONFIG_DEFAULTS_[k]]), true]);
  t('config Port Exclusions tab: header + the 18 default pairs',
    [config.tabs.map((x) => x.name), rawRows(config, 'Port Exclusions')], [['Settings', 'Port Exclusions'], [['Lane', 'Port']].concat(appDefaults.ports.map((p) => [p.lane, p.port]))]);
  t('sharing: Team Data org-EDIT, Config org-VIEW', [env.sharing[team.id], env.sharing[config.id]], [['DOMAIN', 'EDIT'], ['DOMAIN', 'VIEW']]);
  t('an onEdit trigger for onConfigSheetEdit is bound to the config sheet',
    env.triggers.map((x) => [x.handler, x.event, x.sourceId === config.id]), [['onConfigSheetEdit', 'onEdit', true]]);
  t('the props are stored and readAppConfig_ / notes work straight away', [env.props.get('bfrTeamSheetId') === team.id, env.api.readAppConfig_().available, env.api.getVvdNotes().ok], [true, true, true]);

  // Idempotent second run; admin edits survive.
  config.tabs[0].rows[1][1] = 55;
  env.api.saveVvdNote('KEEP1', 'kept');
  const counts = () => [env.spreadsheets.size, env.triggers.length, rawRows(team, 'VVD Notes').length, rawRows(config, 'Port Exclusions').length];
  const before = counts();
  const res2 = env.api.setupTeamSheets();
  t('re-running creates nothing new (same sheets, one trigger) and keeps rows and admin edits',
    [counts(), before, config.tabs[0].rows[1][1], res2.teamSheetUrl === res.teamSheetUrl, res2.triggerInstalled], [before, before, 55, true, true]);
  env.cache.set('bfrAppConfig', '{"stale":true}');
  env.api.setupTeamSheets();
  t('setup clears the cached config', env.cache.has('bfrAppConfig'), false);
  config.tabs[1].rows = [['Lane', 'Port']];
  env.api.setupTeamSheets();
  t('a header-only Port Exclusions tab (exclude nothing) is NOT refilled by a re-run', rawRows(config, 'Port Exclusions'), [['Lane', 'Port']]);
}

{
  const env = makeEnv({ activeEmail: 'admin@corp.com', effectiveEmail: 'admin@corp.com' });
  env.api.setupTeamSheets();
  const n = env.spreadsheets.size;
  env.activeEmail = 'visitor@corp.com';
  const err = throws(() => env.api.setupTeamSheets());
  t('a non-admin (e.g. a visitor via google.script.run) is rejected and creates nothing', [/Only the archive admin/.test(err), env.spreadsheets.size, env.triggers.length], [true, n, 1]);
  const first = makeEnv({ activeEmail: 'someone@corp.com', effectiveEmail: 'someone@corp.com' });
  first.props.set('bfrArchiveAdmin', 'kevin@corp.com');
  t('the admin is the SAME one the archive uses (bfrArchiveAdmin), not a new role', [/kevin@corp.com/.test(throws(() => first.api.setupTeamSheets())), first.spreadsheets.size], [true, 0]);
}

{
  const env = makeEnv({ activeEmail: 'admin@corp.com', effectiveEmail: 'admin@corp.com' });
  env.api.setupTeamSheets();
  const oldTeam = env.props.get('bfrTeamSheetId');
  const oldConfig = env.props.get('bfrConfigSheetId');
  env.spreadsheets.delete(oldConfig);
  env.denied.add(oldTeam);
  const res = env.api.setupTeamSheets();
  const newConfig = env.props.get('bfrConfigSheetId');
  t('a sheet that no longer opens is recreated (new id stored), and the stale trigger is replaced by one on the new sheet',
    [newConfig !== oldConfig, env.props.get('bfrTeamSheetId') !== oldTeam, env.triggers.map((x) => x.sourceId), res.triggerInstalled], [true, true, [newConfig], true]);
}

{
  const env = makeEnv({ activeEmail: 'admin@corp.com', effectiveEmail: 'admin@corp.com' });
  const origCreate = env.api;
  void origCreate;
  // Sharing failure for the team sheet only: reported, not thrown; the config share still runs.
  env.sharingFails.add('sheet1');
  const res = env.api.setupTeamSheets();
  t('a sharing failure is reported in the result (not thrown) and the other share still succeeds',
    [res.ok, /sharing blocked/.test(res.sharing.team), res.sharing.config, res.triggerInstalled], [true, true, 'ok', true]);
  const env2 = makeEnv({ activeEmail: 'admin@corp.com', effectiveEmail: 'admin@corp.com' });
  env2.triggerFails = true;
  const res2 = env2.api.setupTeamSheets();
  t('a trigger failure is reported (triggerInstalled:false, triggerError) rather than thrown', [res2.ok, res2.triggerInstalled, /quota/.test(res2.triggerError)], [true, false, true]);
}

// ===========================================================================
console.log('\n[notes follow the slicers] NOTES SLICER FILTER block (visibleNoteVvds / notesInView)');
{
  // The app's own code, extracted verbatim (like the config block above), plus the one-line key helper it uses.
  const keyLine = appSrc.match(/const vvdNoteKey = [^\n]*;/);
  const block = appSrc.match(/\/\/ --- NOTES SLICER FILTER START ---[\s\S]*?\/\/ --- NOTES SLICER FILTER END ---/);
  if (!keyLine || !block) throw new Error('vvdNoteKey or the NOTES SLICER FILTER markers not found in the app file');
  const { visibleNoteVvds, notesInView } = new Function(`${keyLine[0]}\n${block[0]}\nreturn { visibleNoteVvds, notesInView };`)();

  const all = [{ vvd: 'AAA1' }, { vvd: 'BBB2' }, { vvd: 'bbb2' }, { vvd: ' CCC3 ' }, { vvd: '' }, { vvd: 'DDD4' }];
  t('nothing narrowed (as many filtered rows as rows, or bad input) -> null, meaning "show every note"',
    [visibleNoteVvds(all, all), visibleNoteVvds(all.slice(), all), visibleNoteVvds(undefined, all), visibleNoteVvds(all, null), visibleNoteVvds([], [])], [null, null, null, null, null]);

  const set = visibleNoteVvds([all[0], all[2], all[3], all[4]], all);
  t('narrowed -> the set of VVD keys left in view: trimmed, upper-cased, blanks skipped, case variants merged',
    [set instanceof Set, [...set].sort()], [true, ['AAA1', 'BBB2', 'CCC3']]);
  t('a filter that leaves no rows gives an empty set (every note hidden), not null', [visibleNoteVvds([], all) instanceof Set, visibleNoteVvds([], all).size], [true, 0]);

  const notes = [
    { vvd: 'AAA1', note: 'a', author: 'x@c', visibility: 'public' },
    { vvd: 'bbb2', note: 'b private', author: 'me@c', visibility: 'private' },
    { vvd: 'DDD4', note: 'd', author: 'y@c', visibility: 'public' },
    { vvd: 'ZZ9999Z', note: 'a VVD that is not in the data', author: 'z@c' },
  ];
  t('with no set every note stays, including one on a VVD that is not in the data',
    [notesInView(notes, null).length, notesInView(notes, null) === notes, notesInView(null, null), notesInView(undefined, set)], [4, true, [], []]);
  t('with a set only notes on those VVDs stay (case-insensitive, public and private alike); the rest are hidden',
    notesInView(notes, set).map((n) => n.note), ['a', 'b private']);
  t('an empty set hides every note, and the input list is not modified', [notesInView(notes, new Set()), notes.length], [[], 4]);
  t('the app builds the set from filteredRawRows against rawRows and hands it to the dialog',
    [/visibleNoteVvds\(filteredRawRows, rawRows\)/.test(appSrc), /visibleVvds=\{notesVvdSet\}/.test(appSrc), /notesInView\(allNotes, visibleVvds\)/.test(appSrc)], [true, true, true]);
}

// ===========================================================================
console.log('\n[notes organized] NOTES ORGANIZE block (formatNoteTime / noteTimeTitle / filterNotesForList / groupNotesByVvd)');
{
  // The app's own code, extracted verbatim, plus the two one-line helpers it uses (defined just outside the block).
  const keyLine = appSrc.match(/const vvdNoteKey = [^\n]*;/);
  const privLine = appSrc.match(/const isPrivateNote = [^\n]*;/);
  const block = appSrc.match(/\/\/ --- NOTES ORGANIZE START ---[\s\S]*?\/\/ --- NOTES ORGANIZE END ---/);
  if (!keyLine || !privLine || !block) throw new Error('vvdNoteKey, isPrivateNote or the NOTES ORGANIZE markers not found in the app file');
  const { formatNoteTime, noteTimeTitle, filterNotesForList, groupNotesByVvd } =
    new Function(`${keyLine[0]}\n${privLine[0]}\n${block[0]}\nreturn { formatNoteTime, noteTimeTitle, filterNotesForList, groupNotesByVvd };`)();

  // --- times. Every date is built from LOCAL parts (new Date(y, m, d, h, mi, s)), for the note and for "now" alike,
  // so "today" / "yesterday" mean the same thing in any time zone the check runs in. Expected strings come from the
  // same Intl calls the app documents (the viewer's own locale), plus shape checks that hold in any locale.
  const FULL = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const clockOf = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fullOf = (d) => d.toLocaleString(undefined, FULL);
  const hasSeconds = (s) => /\d{1,2}:\d{2}:\d{2}/.test(s);
  const NOW = new Date(2026, 9, 2, 14, 30, 0);                 // Fri 10/2/2026 2:30 PM local
  const L = (y, m, d, h, mi, s) => new Date(y, m, d, h, mi, s);
  const fmt = (d, now = NOW) => formatNoteTime(d.toISOString(), now);

  const earlyToday = L(2026, 9, 2, 10, 49, 18), justAfterMidnight = L(2026, 9, 2, 0, 5, 59);
  t('a note from earlier today reads "Today, <clock>" (no date, no seconds)',
    [fmt(earlyToday), fmt(earlyToday).startsWith('Today, '), fmt(earlyToday).includes('10:49'), hasSeconds(fmt(earlyToday))],
    [`Today, ${clockOf(earlyToday)}`, true, true, false]);
  t('today starts at midnight sharp: 12:05 AM today is still "Today", and a note LATER than now (tomorrow) is not',
    [fmt(justAfterMidnight) === `Today, ${clockOf(justAfterMidnight)}`, fmt(L(2026, 9, 3, 9, 0, 0)) === fullOf(L(2026, 9, 3, 9, 0, 0))], [true, true]);
  const yest = L(2026, 9, 1, 15, 18, 7), yestLate = L(2026, 9, 1, 23, 59, 59);
  t('a note from the previous calendar day reads "Yesterday, <clock>", including 11:59 PM; 24 hours ago is decided by the calendar, not the clock',
    [fmt(yest), fmt(yestLate), fmt(L(2026, 9, 1, 0, 0, 0))], [`Yesterday, ${clockOf(yest)}`, `Yesterday, ${clockOf(yestLate)}`, `Yesterday, ${clockOf(L(2026, 9, 1, 0, 0, 0))}`]);
  const twoDays = L(2026, 8, 30, 15, 18, 0), lastYear = L(2025, 11, 31, 23, 59, 0);
  t('anything older is the full date and time in the viewer\'s locale: m/d/yyyy-style, with the year, no "Today"/"Yesterday"',
    [fmt(twoDays), fmt(lastYear), fmt(twoDays).includes('2026'), fmt(lastYear).includes('2025'), /^(Today|Yesterday)/.test(fmt(twoDays) + fmt(lastYear))],
    [fullOf(twoDays), fullOf(lastYear), true, true, false]);
  t('"yesterday" is found across a month, a year and a leap-day boundary (Oct 31 -> Nov 1, Dec 31 -> Jan 1, Feb 29 -> Mar 1)',
    [fmt(L(2026, 9, 31, 22, 0, 0), L(2026, 10, 1, 9, 0, 0)), fmt(L(2026, 11, 31, 8, 15, 0), L(2027, 0, 1, 0, 30, 0)), fmt(L(2028, 1, 29, 23, 0, 0), L(2028, 2, 1, 12, 0, 0))],
    [`Yesterday, ${clockOf(L(2026, 9, 31, 22, 0, 0))}`, `Yesterday, ${clockOf(L(2026, 11, 31, 8, 15, 0))}`, `Yesterday, ${clockOf(L(2028, 1, 29, 23, 0, 0))}`]);
  t('the same day number in another month or year is not "today" (10/2/2025 and 9/2/2026 vs now = 10/2/2026)',
    [fmt(L(2025, 9, 2, 14, 0, 0)), fmt(L(2026, 8, 2, 14, 0, 0))], [fullOf(L(2025, 9, 2, 14, 0, 0)), fullOf(L(2026, 8, 2, 14, 0, 0))]);
  t('a missing, empty or unreadable time gives an empty string (formatNoteTime and noteTimeTitle), never "Invalid Date"',
    [formatNoteTime('', NOW), formatNoteTime(undefined, NOW), formatNoteTime(null, NOW), formatNoteTime('not-a-date', NOW), noteTimeTitle(''), noteTimeTitle(undefined), noteTimeTitle(null), noteTimeTitle('not-a-date')],
    ['', '', '', '', '', '', '', '']);
  const secondsy = [L(2026, 9, 2, 10, 49, 18), L(2026, 9, 2, 0, 0, 59), L(2026, 9, 1, 15, 18, 7), L(2026, 8, 1, 1, 1, 1), L(2020, 0, 1, 10, 0, 33)];
  t('no timestamp ever carries seconds, whether it reads Today, Yesterday or a full date, or is the tooltip form',
    [secondsy.map((d) => fmt(d)).some(hasSeconds), secondsy.map((d) => noteTimeTitle(d.toISOString())).some(hasSeconds)], [false, false]);
  t('noteTimeTitle is always the full date and time (never "Today"/"Yesterday") and drops the seconds',
    [secondsy.map((d) => noteTimeTitle(d.toISOString())), secondsy.some((d) => /^(Today|Yesterday)/.test(noteTimeTitle(d.toISOString())))], [secondsy.map(fullOf), false]);
  t('without a "now" argument the real clock is used: a note from this very moment reads "Today, ..."',
    formatNoteTime(new Date().toISOString()).startsWith('Today, '), true);

  // --- the filters
  const ME = 'kevin.lee@x.com', nowMs = NOW.getTime(), day = 86400000;
  const iso = (d) => d.toISOString();
  const notes = [
    { vvd: 'ZBTT0349S', note: 'Cut 100 teu ex USXXX', author: 'adam.cosner@x.com', updatedAt: iso(L(2026, 9, 2, 10, 35, 15)), visibility: 'public' },
    { vvd: 'zbtt0349s', note: 'seeing if this works', author: ME, updatedAt: iso(L(2026, 9, 2, 10, 9, 0)), visibility: 'private' },
    { vvd: 'SROT0045S', note: 'hhh', author: ME, updatedAt: iso(L(2026, 9, 2, 10, 49, 18)), visibility: 'private' },
    { vvd: 'ONPT0023W', note: 'Cut 100 teu ex USTIW', author: 'adam.cosner@x.com', updatedAt: iso(L(2026, 9, 2, 10, 18, 39)) },   // no `visibility`: public
    { vvd: 'NSOT0067S', note: 'Test Test', author: ME, updatedAt: iso(L(2026, 8, 30, 15, 18, 0)), visibility: 'public' },
    { vvd: 'OLD0001S', note: 'no date', author: 'bob@x.com', visibility: 'public' },
  ];
  const snapshot = JSON.stringify(notes);
  const names = (l) => l.map((n) => `${n.vvd}:${n.visibility || 'public'}`);
  const f = (opts) => names(filterNotesForList(notes, { nowMs, me: ME, ...opts }));

  t('kind "public" keeps cut-cargo notes, and a note with no visibility at all counts as public',
    f({ kind: 'public' }), ['ZBTT0349S:public', 'ONPT0023W:public', 'NSOT0067S:public', 'OLD0001S:public']);
  t('kind "private" keeps only the private ones', f({ kind: 'private' }), ['zbtt0349s:private', 'SROT0045S:private']);
  const authorless = [{ vvd: 'NOAUTH', note: 'x' }, { vvd: 'NULLAUTH', note: 'x', author: null }, { vvd: 'EMPTYAUTH', note: 'x', author: '' }];
  t('kind "mine" keeps every note I wrote, public or private; with no known viewer (me = null, undefined or "") it keeps none, not even a note with no author',
    [f({ kind: 'mine' }), f({ kind: 'mine', me: null }), f({ kind: 'mine', me: '' }), f({ kind: 'mine', me: 'nobody@x.com' }),
      names(filterNotesForList(authorless, { kind: 'mine', me: null })), names(filterNotesForList(authorless, { kind: 'mine', me: '' })), names(filterNotesForList(authorless, { kind: 'mine' }))],
    [['zbtt0349s:private', 'SROT0045S:private', 'NSOT0067S:public'], [], [], [], [], [], []]);
  t('the query matches the VVD, the note text or the author, case-insensitively, and is trimmed',
    [f({ query: 'zbtt' }), f({ query: '  CUT 100  ' }), f({ query: 'ADAM' }), f({ query: 'hhh' })],
    [['ZBTT0349S:public', 'zbtt0349s:private'], ['ZBTT0349S:public', 'ONPT0023W:public'], ['ZBTT0349S:public', 'ONPT0023W:public'], ['SROT0045S:private']]);
  t('a query that matches nothing gives an empty list, and a query never matches across two fields ("AB" + "CD" is not "abcd")',
    [f({ query: 'xyz' }), names(filterNotesForList([{ vvd: 'AB', note: 'CD', author: 'x' }], { query: 'abcd' }))], [[], []]);
  t('ageDays keeps notes updated within that many days (the cutoff itself stays, 1 ms older goes) and KEEPS notes with a missing or unreadable date',
    [f({ ageDays: 1 }), f({ ageDays: 7 }),
      names(filterNotesForList([{ vvd: 'EDGE1', updatedAt: new Date(nowMs - 7 * day).toISOString() }, { vvd: 'EDGE2', updatedAt: new Date(nowMs - 7 * day - 1).toISOString() }, { vvd: 'BAD', updatedAt: 'garbage' }, { vvd: 'NONE' }], { ageDays: 7, nowMs }))],
    [['ZBTT0349S:public', 'zbtt0349s:private', 'SROT0045S:private', 'ONPT0023W:public', 'OLD0001S:public'],
      ['ZBTT0349S:public', 'zbtt0349s:private', 'SROT0045S:private', 'ONPT0023W:public', 'NSOT0067S:public', 'OLD0001S:public'],
      ['EDGE1:public', 'BAD:public', 'NONE:public']]);
  t('kind, query and age combine (all must hold)',
    [f({ kind: 'mine', ageDays: 1, query: 'hhh' }), f({ kind: 'public', ageDays: 1, query: 'cut' }), f({ kind: 'private', query: 'works', ageDays: 30 })],
    [['SROT0045S:private'], ['ZBTT0349S:public', 'ONPT0023W:public'], ['zbtt0349s:private']]);
  t('asking for nothing (all kinds, a blank query, no age or a non-positive one) returns the SAME array, not a copy',
    [filterNotesForList(notes) === notes, filterNotesForList(notes, { kind: 'all', query: '  ', ageDays: 0 }) === notes, filterNotesForList(notes, { ageDays: -3 }) === notes, filterNotesForList(notes, { query: null, ageDays: NaN }) === notes],
    [true, true, true, true]);
  t('any real filter returns a new array and leaves the input untouched (same length, same content, same order)',
    [filterNotesForList(notes, { kind: 'public' }) !== notes, filterNotesForList(notes, { kind: 'all', query: 'cut' }) !== notes, notes.length, JSON.stringify(notes) === snapshot], [true, true, 6, true]);
  t('missing input is an empty list, and an empty entry inside a list is dropped by a real filter',
    [filterNotesForList(null), filterNotesForList(undefined, { kind: 'public' }), filterNotesForList([], { query: 'x' }), filterNotesForList([null, notes[0]], { kind: 'public' }).length], [[], [], [], 1]);

  // --- the groups
  const groups = groupNotesByVvd(notes);
  t('one group per VVD, merging case variants: "ZBTT0349S" and "zbtt0349s" are one group keyed by the upper-cased VVD (5 groups for 6 notes)',
    [groups.length, groups.filter((g) => g.key === 'ZBTT0349S').length, groups.every((g) => g.key === g.vvd && g.key === g.key.toUpperCase())], [5, 1, true]);
  t('groups are ordered by their newest note, newest first (a private note counts for its group like any other)',
    groups.map((g) => g.key), ['SROT0045S', 'ZBTT0349S', 'ONPT0023W', 'NSOT0067S', 'OLD0001S']);
  const zb = groups.find((g) => g.key === 'ZBTT0349S');
  t('inside a group the cut-cargo notes come before the private one even when the private one is NEWER, each kind newest first, and case variants of the VVD share the group',
    groupNotesByVvd([
      { vvd: 'AAA1', note: 'old public', author: 'a', updatedAt: iso(L(2026, 9, 1, 8, 0, 0)), visibility: 'public' },
      { vvd: 'AAA1', note: 'new private', author: 'a', updatedAt: iso(L(2026, 9, 2, 9, 0, 0)), visibility: 'private' },
      { vvd: 'aaa1', note: 'newer public', author: 'b', updatedAt: iso(L(2026, 9, 2, 8, 0, 0)) },
    ]).map((g) => g.notes.map((n) => `${n.note}:${n.visibility || 'public'}`)),
    [['newer public:public', 'old public:public', 'new private:private']]);
  t('inside a kind, newest first; a group\'s `latest` is the newest updatedAt of any kind, and the real note objects are handed back',
    [zb.notes.map((n) => n.note), zb.latest === notes[0].updatedAt, zb.notes[0] === notes[0] && zb.notes[1] === notes[1]], [['Cut 100 teu ex USXXX', 'seeing if this works'], true, true]);
  t('a note with no date sorts last in its kind and its group sorts last; equal times fall back to VVD order',
    [groupNotesByVvd([{ vvd: 'B', note: 'undated' }, { vvd: 'A', note: 'dated', updatedAt: '2026-10-01T10:00:00.000Z' }]).map((g) => g.key),
      groupNotesByVvd([{ vvd: 'B', note: 'x', updatedAt: '2026-10-01T10:00:00.000Z' }, { vvd: 'A', note: 'y', updatedAt: '2026-10-01T10:00:00.000Z' }]).map((g) => g.key),
      groupNotesByVvd([{ vvd: 'A', note: 'undated' }, { vvd: 'A', note: 'dated', updatedAt: '2026-10-01T10:00:00.000Z' }])[0].notes.map((n) => n.note)],
    [['A', 'B'], ['A', 'B'], ['dated', 'undated']]);
  const safeKeys = (list) => { try { return groupNotesByVvd(list).map((g) => g.key); } catch (err) { return `threw: ${err.message}`; } };
  t('notes with a blank, whitespace-only or missing VVD are skipped, and a padded VVD is trimmed',
    [safeKeys([{ vvd: '', note: 'x' }, { vvd: '   ', note: 'y' }, { vvd: null, note: 'z' }, { note: 'w' }]), safeKeys([{ vvd: ' ccc3 ', note: 'k' }])], [[], ['CCC3']]);
  t('null and undefined entries inside the list are skipped too (no crash, the real notes still group)',
    safeKeys([null, undefined, { vvd: 'a1', note: 'n' }, null]), ['A1']);
  t('missing or empty input gives no groups, and grouping leaves the input as it was',
    [groupNotesByVvd(null), groupNotesByVvd(undefined), groupNotesByVvd([]), JSON.stringify(notes) === snapshot, notes[0].vvd, notes[1].vvd], [[], [], [], true, 'ZBTT0349S', 'zbtt0349s']);
  t('the dialog runs them in this order: slicers (notesInView) -> kind / search / age (filterNotesForList) -> one group per VVD (groupNotesByVvd)',
    [/notesInView\(allNotes, visibleVvds\)/.test(appSrc), /filterNotesForList\(listedNotes, \{ kind: effKind, query: noteQuery, ageDays, me \}\)/.test(appSrc), /groupNotesByVvd\(shownNotes\)/.test(appSrc),
      /formatNoteTime\(n\.updatedAt\)/.test(appSrc), /noteTimeTitle\(n\.updatedAt\)/.test(appSrc)], [true, true, true, true, true]);
  t('a kind filter whose chip is not offered falls back to All: Private needs privateAvailable, Mine needs a known viewer, and the chips, the summary and the filter all read the fallback (effKind)',
    [/const effKind = \(kindFilter === 'private' && !privateAvailable\) \|\| \(kindFilter === 'mine' && !me\) \? 'all' : kindFilter;/.test(appSrc),
      /privateAvailable && kindChip\('private'/.test(appSrc), /me && kindChip\('mine'/.test(appSrc),
      /aria-checked=\{effKind === kind\}/.test(appSrc), /const filtersActive = effKind !== 'all'/.test(appSrc)], [true, true, true, true, true]);
}

// ===========================================================================
console.log('\n[notes lanes] NOTES ORGANIZE block (laneByVvd / lanesInData / vvdsOnLane)');
{
  // The app's own code, extracted verbatim, plus the two one-line helpers it uses (defined just outside the block).
  const keyLine = appSrc.match(/const vvdNoteKey = [^\n]*;/);
  const privLine = appSrc.match(/const isPrivateNote = [^\n]*;/);
  const block = appSrc.match(/\/\/ --- NOTES ORGANIZE START ---[\s\S]*?\/\/ --- NOTES ORGANIZE END ---/);
  if (!keyLine || !privLine || !block) throw new Error('vvdNoteKey, isPrivateNote or the NOTES ORGANIZE markers not found in the app file');
  const { laneByVvd, lanesInData, vvdsOnLane } =
    new Function(`${keyLine[0]}\n${privLine[0]}\n${block[0]}\nreturn { laneByVvd, lanesInData, vvdsOnLane };`)();

  // Shaped like the app's rows ({vvd, lane}). On the real 964-row fixture every real VVD sails on exactly one lane
  // and only the 'VMS' placeholder spans many; the odd cases below are the defensive ones.
  const rows = [
    { vvd: 'FOWT0529S', lane: 'AN2' }, { vvd: ' fowt0529s ', lane: 'AN2' },   // case / spaces merge; the same lane is listed once
    { vvd: 'POHT0076E', lane: ' AT1 ' },                                       // lane is trimmed
    { vvd: 'WHOT2625S', lane: 'ANG' }, { vvd: 'WHOT2625S', lane: 'AN2' },       // one VVD on two lanes
    { vvd: 'VMS', lane: 'EC3' }, { vvd: '—', lane: 'EC3' }, { vvd: '', lane: 'PS3' },  // placeholders / blank VVD: skipped
    { vvd: 'NOLANE01S', lane: '' }, { vvd: 'NOLANE02S' }, null, undefined,      // no lane / bad rows: skipped
  ];
  const m = laneByVvd(rows);
  t('laneByVvd maps each real VVD (trimmed, upper-cased) to its lane; VMS, "—", a blank VVD and a blank lane are skipped',
    [m.get('FOWT0529S'), m.get('POHT0076E'), m.has('VMS'), m.has('—'), m.has(''), m.has('NOLANE01S'), m.has('NOLANE02S'), m.size],
    ['AN2', 'AT1', false, false, false, false, false, 3]);
  t('a VVD seen on two lanes lists both, sorted, joined by "/"', m.get('WHOT2625S'), 'AN2/ANG');
  t('laneByVvd on bad input gives an empty map', [laneByVvd(null).size, laneByVvd(undefined).size, laneByVvd([]).size], [0, 0, 0]);
  t('lanesInData: the sorted unique lanes of the real VVDs only -- not the VMS-only lane (EC3), not the blank-VVD lane (PS3), no blanks',
    lanesInData(rows), ['AN2', 'ANG', 'AT1']);
  t('lanesInData on bad input -> []', [lanesInData(null), lanesInData(undefined), lanesInData([])], [[], [], []]);
  const vvds = ['FOWT0529S', 'POHT0076E', 'WHOT2625S', 'OLD0001S'];
  t('vvdsOnLane: no lane -> the very same array; a lane -> only the VVDs on it, in order (a two-lane VVD matches either lane); a VVD with no known lane never matches',
    [vvdsOnLane(vvds, m, '') === vvds, vvdsOnLane(vvds, m, null) === vvds, vvdsOnLane(vvds, m, 'AN2'), vvdsOnLane(vvds, m, 'ANG'), vvdsOnLane(vvds, m, 'AT1'), vvdsOnLane(vvds, m, 'ZZZ')],
    [true, true, ['FOWT0529S', 'WHOT2625S'], ['WHOT2625S'], ['POHT0076E'], []]);
  t('vvdsOnLane matches whole lane codes only ("AN" is not "AN2"), and bad input is safe',
    [vvdsOnLane(vvds, m, 'AN'), vvdsOnLane(null, m, 'AN2'), vvdsOnLane(vvds, null, 'AN2')], [[], [], []]);
  t('vvdsOnLane does not modify its input list', vvds, ['FOWT0529S', 'POHT0076E', 'WHOT2625S', 'OLD0001S']);
}

// ===========================================================================
console.log('\n[notes hashtags] NOTES ORGANIZE block (splitNoteText / extractNoteTags / collectNoteTags / parseNoteQuery / toggleNoteQueryTag / filterNotesForList / buildNoteTagChips with #tags)');
{
  // The app's own code, extracted verbatim exactly as in [notes organized] above: the hashtag helpers live in the
  // same NOTES ORGANIZE block and use only vvdNoteKey and isPrivateNote. Hashtags (2026-10-02, per Kevin) are
  // client-only: the tag IS the text of the note, so there is no server call, Sheet column or migration to test here.
  const keyLine = appSrc.match(/const vvdNoteKey = [^\n]*;/);
  const privLine = appSrc.match(/const isPrivateNote = [^\n]*;/);
  const block = appSrc.match(/\/\/ --- NOTES ORGANIZE START ---[\s\S]*?\/\/ --- NOTES ORGANIZE END ---/);
  if (!keyLine || !privLine || !block) throw new Error('vvdNoteKey, isPrivateNote or the NOTES ORGANIZE markers not found in the app file');
  // noteTagKey and the hoisted RegExp are declared inside the block, so they are returned too (the 2026-10-03 review-fix
  // checks below test the key function and the RegExp's lastIndex directly). The RegExp is read through typeof so a
  // rename shows up as one failing check instead of a ReferenceError that takes the whole file down.
  const { splitNoteText, extractNoteTags, collectNoteTags, parseNoteQuery, toggleNoteQueryTag, filterNotesForList, buildNoteTagChips, noteTagKey, hoistedTagRe } =
    new Function(`${keyLine[0]}\n${privLine[0]}\n${block[0]}\nreturn { splitNoteText, extractNoteTags, collectNoteTags, parseNoteQuery, toggleNoteQueryTag, filterNotesForList, buildNoteTagChips, noteTagKey, hoistedTagRe: typeof NOTE_TAG_IN_TEXT_RE === 'undefined' ? null : NOTE_TAG_IN_TEXT_RE };`)();

  // Helpers. Accented and non-Latin letters appear literally below, as ONE precomposed character each (NFC), except
  // where a check spells a decomposed form on purpose with an escape ("cafe\u0301" = e + U+0301). Since 2026-10-03 a
  // decomposed accent is NOT a different tag: \p{M} is allowed inside a tag and the key is NFC-normalised (see the
  // "NFC / NFD" checks near the end of this section).
  const tagsOf = (s) => extractNoteTags(s);
  const each = (inputs, fn) => inputs.map(fn);
  const safe = (fn) => { try { return fn(); } catch (err) { return `threw: ${err && err.message}`; } };
  const toggle = toggleNoteQueryTag;
  // A seeded PRNG (mulberry32) so a fuzz failure reproduces exactly, instead of being a one-off.
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const randomStrings = (alphabet, count, maxLen, seed) => {
    const r = rng(seed);
    return Array.from({ length: count }, () => { let s = ''; const n = Math.floor(r() * (maxLen + 1)); for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)]; return s; });
  };
  const deepFreeze = (o) => { Object.getOwnPropertyNames(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); }); return Object.freeze(o); };

  // --- what is a tag (extractNoteTags)
  t('a tag is "#" + a letter + letters, digits, "_" or "-"; its key is the lower-cased word without the "#"',
    [tagsOf('Cut 40 TEU at USNYC #rolled'), tagsOf('#a1_b-c'), tagsOf('#X9'), tagsOf('#rolled')], [['rolled'], ['a1_b-c'], ['x9'], ['rolled']]);
  t('tags are case-insensitive and distinct per note, in order of first appearance: #Rolled, #rolled and #ROLLED are ONE tag',
    tagsOf('Cut #Rolled then #rolled and #ROLLED, also #USNYC #alpha #usnyc'), ['rolled', 'usnyc', 'alpha']);
  t('digit-first is NOT a tag: "bay #3", "#12", "#12ab", "TEU #40-45", "#3x #4y", "row #1 and #2"',
    each(['bay #3', '#12', '#12ab', 'TEU #40-45', '#3x #4y', 'row #1 and #2'], tagsOf), [[], [], [], [], [], []]);
  t('the first character after the "#" must be a letter: "#_x" and "#-x" are not tags, "#x_" and "#x-1" are',
    [tagsOf('#_x'), tagsOf('#-x'), tagsOf('#x_'), tagsOf('#x-1')], [[], [], ['x_'], ['x-1']]);
  t('a "#" glued to the word before it is NOT a tag: a URL fragment, "AB#cd", a period or a hyphen right before it, "#a#b" (only the first); a real tag after a URL still is',
    [tagsOf('see http://x/y#frag and AB#cd'), tagsOf('https://example.com/page#section-2'), tagsOf('end.#a'), tagsOf('a-#b'), tagsOf('#a#b'), tagsOf('http://x/y#frag #real')],
    [[], [], [], [], ['a'], ['real']]);
  t('"##x", a lone "#", "##", "# y", "# #", "#-" and "#_" are not tags (the letter must follow the "#" at once); "#x ##y" has only #x',
    [...each(['##x', '#', '##', '# y', '# #', '#-', '#_'], tagsOf), tagsOf('#x ##y')], [[], [], [], [], [], [], [], ['x']]);
  t('a trailing hyphen is punctuation, not part of the tag ("#rolled-", "#rolled--", "done #rolled-."); an interior hyphen stays ("#c-d-" -> "c-d", "#e--f")',
    [...each(['#rolled- ok', '#rolled-- ok', '#rolled-', 'done #rolled-.', '#rolled-\n'], tagsOf), tagsOf('#c-d- and #e--f')],
    [['rolled'], ['rolled'], ['rolled'], ['rolled'], ['rolled'], ['c-d', 'e--f']]);
  const wrapped = ['(#a)', '"#a,"', '#a!', '[#a]', '{#a}', '\'#a\'', '“#a”', '‘#a’', ',#a', ';#a', ':#a', '!#a', '?#a', '#a?', '#a.', '#a;', '#a:', 'x (see #a)', 'x, #a, y'];
  t('surrounding punctuation is not part of the tag, and an opening bracket or quote, or one of , ; : ! ?, may sit right before the "#" ("(#a)", "\\"#a,\\"", "#a!", ",#a", "#a?" ...)',
    each(wrapped, tagsOf), wrapped.map(() => ['a']));
  t('accented Latin letters are letters: "#café", "#CAFÉ" -> "café", "#Ñandú" -> "ñandú", and a tag may start with one ("#élan")',
    [tagsOf('#café ok'), tagsOf('#CAFÉ'), tagsOf('#Ñandú'), tagsOf('#élan'), 'é'.length, 'É'.length], [['café'], ['café'], ['ñandú'], ['élan'], 1, 1]);
  t('a tag may follow a newline, a CRLF or a tab, or sit at the very start or end of the text',
    [tagsOf('line1\n#tag2'), tagsOf('a\r\n#b'), tagsOf('a\t#c'), tagsOf('\n#d'), tagsOf('#start of note'), tagsOf('note end #fin')],
    [['tag2'], ['b'], ['c'], ['d'], ['start'], ['fin']]);
  // 2026-10-03 (review fix): REWRITTEN to the new rule. Before, a tag was '#' + a Latin letter, so "#привет" and "#日本語" were
  // plain text; now a tag is '#' + any Unicode LETTER (\p{L}), so they are tags. Not silenced: the expectation flipped.
  t('tags in other scripts ARE tags now (review fix 2026-10-03, was "not recognised"): Cyrillic, CJK, Greek and Arabic are read as tags, upper case folds to lower case, and an ASCII tag next to them is still found',
    [tagsOf('#привет'), tagsOf('#日本語'), tagsOf('#привет #ok'), tagsOf('#ПРИВЕТ'), tagsOf('#Ελλάδα'), tagsOf('#مرحبا')],
    [['привет'], ['日本語'], ['привет', 'ok'], ['привет'], ['ελλάδα'], ['مرحبا']]);
  t('extractNoteTags never throws: null, undefined, numbers, booleans, objects and arrays are read through String() (["#a", "b"] -> "#a,b" -> "a")',
    [null, undefined, 0, 42, true, false, {}, [], ['#a', 'b']].map((x) => safe(() => tagsOf(x))), [[], [], [], [], [], [], [], [], ['a']]);

  // --- splitNoteText: what the dialog renders
  t('splitNoteText gives plain segments ({text}) and tag segments ({text: "#Rolled", tag: "rolled"}) that keep the TYPED case in text and the lower-cased key in tag',
    [splitNoteText('a #Rolled-, b'), splitNoteText('#only'), splitNoteText('no tags'), splitNoteText('#a #B'), splitNoteText('x #ROLLED')],
    [[{ text: 'a ' }, { text: '#Rolled', tag: 'rolled' }, { text: '-, b' }], [{ text: '#only', tag: 'only' }], [{ text: 'no tags' }],
      [{ text: '#a', tag: 'a' }, { text: ' ' }, { text: '#B', tag: 'b' }], [{ text: 'x ' }, { text: '#ROLLED', tag: 'rolled' }]]);
  t('splitNoteText: null and undefined give no segments; any other non-string is read through String() (0 -> "0", false -> "false": never dropped)',
    [splitNoteText(null), splitNoteText(undefined), splitNoteText(0), splitNoteText(42), splitNoteText(false), splitNoteText({})],
    [[], [], [{ text: '0' }], [{ text: '42' }], [{ text: 'false' }], [{ text: '[object Object]' }]]);
  const awkward = ['', ' ', '#', '##', '#a-', '#a--#b', '  #a  ', '\n\n#a\n\n', 'x#a', '(#a)', '"#a,"', '#café- ok', '#rolled-\n#rolled-', 'line1\r\n#t',
    'a #Rolled-, b\n#x', '#only', 'no tags', '#a #a #a', '#a,#b;#c:#d', 'tab\t#t\tend', 'http://x/y#frag #real-'];
  t('splitNoteText is LOSSLESS on awkward fixed strings: the segment texts joined back are exactly the input (whitespace, line breaks and trailing hyphens included)',
    awkward.filter((s) => splitNoteText(s).map((p) => p.text).join('') !== s), []);
  // Two fuzz sets. Single characters alone rarely form a tag (it needs "#" + a letter after a lead-in), so a second set
  // is built from pieces ("#a", " ", "(", ...) that make tags, glued tags and near-misses dense. 240 + 120 strings.
  const singleChars = ['#', '#', '#', '-', '_', ' ', ' ', ' ', '\n', ',', '(', '"', 'é', '1', 'a', 'a', 'B'];
  const pieces = ['#a', '#B', '#é', '#1', '#', '##', '-', '_', ' ', ' ', '\n', ',', '(', '"', 'é', '1', 'a', 'B', '#a-', '#a_b', 'x', '\t'];
  const pieceFuzz = (count, maxPieces, seed) => {
    const r = rng(seed);
    return Array.from({ length: count }, () => { let s = ''; const n = Math.floor(r() * (maxPieces + 1)); for (let i = 0; i < n; i++) s += pieces[Math.floor(r() * pieces.length)]; return s; });
  };
  const fuzz = [...randomStrings(singleChars, 240, 40, 20261002), ...pieceFuzz(120, 12, 1002)];
  const badLossless = [];
  const badSegments = [];
  const badConsistency = [];
  let fuzzWithTags = 0;
  fuzz.forEach((s) => {
    const segs = splitNoteText(s);
    const tagSegs = segs.filter((p) => p.tag);
    if (tagSegs.length) fuzzWithTags++;
    if (segs.map((p) => p.text).join('') !== s) badLossless.push(s);
    const emptySeg = segs.some((p) => !p.text);
    const touchingPlain = segs.some((p, i) => i > 0 && !p.tag && !segs[i - 1].tag);
    const badTagSeg = tagSegs.some((p) => p.text[0] !== '#' || p.tag !== p.text.slice(1).toLowerCase() || /-$/.test(p.text) || tagsOf(p.text).join('|') !== p.tag);
    if (emptySeg || touchingPlain || badTagSeg) badSegments.push(s);
    const want = [];
    tagSegs.forEach((p) => { if (!want.includes(p.tag)) want.push(p.tag); });
    if (JSON.stringify(tagsOf(s)) !== JSON.stringify(want)) badConsistency.push(s);
  });
  t('fuzz, 360 seeded random strings over "# - _ space newline , ( \\" é 1 a B" (and pieces like "#a", "(", "#a-"): splitNoteText is lossless on every one (offenders listed)',
    badLossless.map((s) => JSON.stringify(s)), []);
  t('same fuzz: no empty segment, no two plain segments touching, and every tag segment is "#" + its own lower-cased key with no trailing hyphen and re-parses as exactly that one tag',
    badSegments.map((s) => JSON.stringify(s)), []);
  t('same fuzz: extractNoteTags is exactly the distinct tag segments in order, and the fuzz is not vacuous (at least 100 of the 360 strings contain a tag)',
    [badConsistency.map((s) => JSON.stringify(s)), fuzz.length, fuzzWithTags >= 100], [[], 360, true]);

  // --- collectNoteTags: the tag bar's chips
  const tagNotes = deepFreeze([
    { vvd: 'A1', note: 'cut 10 #rolled #usnyc', author: 'a@x' },
    { vvd: 'A2', note: 'cut cargo #Rolled and #rolled and #ROLLED again', author: 'b@x', visibility: 'private' },
    { vvd: 'A3', note: 'cut #cutcargo #alpha', author: 'a@x' },
    { vvd: 'A4', note: 'no tags here: bay #3, http://x/y#frag, AB#cd, ##x', author: 'a@x' },
    { vvd: 'A5', note: '#alpha', author: 'c@x' },
    { vvd: 'A6', note: 'x #zeta', author: 'c@x' },
    { vvd: 'A7', note: '#zeta', author: 'c@x' },
    { vvd: 'A8', note: '#zeta #beta', author: 'c@x' },
  ]);
  const tagNotesSnapshot = JSON.stringify(tagNotes);
  const tagCounts = collectNoteTags(tagNotes);
  t('collectNoteTags: one {tag, count} per distinct tag, count = number of NOTES carrying it (A2 repeats #Rolled three times and counts once), most-used first, ties alphabetical; digit-first, URL-fragment, glued and "##x" are not offered',
    tagCounts, [{ tag: 'zeta', count: 3 }, { tag: 'alpha', count: 2 }, { tag: 'rolled', count: 2 }, { tag: 'beta', count: 1 }, { tag: 'cutcargo', count: 1 }, { tag: 'usnyc', count: 1 }]);
  t('collectNoteTags order is count descending then tag ascending whatever the input order, and one note repeating a tag in any case counts once',
    [collectNoteTags(tagNotes.slice().reverse()), collectNoteTags([{ note: '#a #A #a' }]), collectNoteTags([{ note: '#b' }, { note: '#a' }, { note: '#c #c' }, { note: '#z' }, { note: '#z' }])],
    [tagCounts, [{ tag: 'a', count: 1 }], [{ tag: 'z', count: 2 }, { tag: 'a', count: 1 }, { tag: 'b', count: 1 }, { tag: 'c', count: 1 }]]);
  t('collectNoteTags on nothing: [] for null, undefined, an empty list and notes with no tag or no text; null, empty and text-less entries inside a list are skipped without changing the result',
    [collectNoteTags(null), collectNoteTags(undefined), collectNoteTags([]), collectNoteTags([null, undefined, {}, { note: null }, { note: 5 }, { note: 'plain' }, { note: 'bay #3' }]),
      collectNoteTags([...tagNotes, null, undefined, {}, { vvd: 'Z' }, { note: null }])],
    [[], [], [], [], tagCounts]);

  // --- parseNoteQuery: reading the search box
  const plainQueries = [['  Cut  Cargo ', 'cut  cargo'], ['', ''], ['   ', ''], ['USNYC', 'usnyc'], ['#', '#'], ['#12', '#12'], ['bay #3', 'bay #3'], ['##x', '##x'],
    ['http://x/y#frag', 'http://x/y#frag'], ['AB#cd', 'ab#cd'], ['#a,', '#a,'], ['(#a)', '(#a)'], ['"#a"', '"#a"'], ['#a!', '#a!'],
    ['\tCut\tCargo \n', 'cut\tcargo']];
  t('parseNoteQuery with NO tag token is exactly the old search box: no tags, text = the trimmed lower-cased query with internal double spaces kept; a lone "#", "#12", "##x", "AB#cd", "(#a)", "#a," and a URL fragment stay free text',
    plainQueries.map(([q]) => parseNoteQuery(q)), plainQueries.map(([, text]) => ({ tags: [], text })));
  // 2026-10-03 (review fix): "#привет" used to sit in the plain-text list above ("other-script #word stays free text"). It is a
  // tag now, so it moved here with the new expectation (a tag token, lower-cased, nothing left over as free text).
  t('parseNoteQuery reads an other-script "#word" as a TAG now (review fix 2026-10-03, was free text): "#привет" and "#ПРИВЕТ" are the tag привет, "#日本語" a tag, and mixed with free text the text stays free',
    [parseNoteQuery('#привет'), parseNoteQuery('#ПРИВЕТ'), parseNoteQuery('#日本語'), parseNoteQuery('срок #Привет груз')],
    [{ tags: ['привет'], text: '' }, { tags: ['привет'], text: '' }, { tags: ['日本語'], text: '' }, { tags: ['привет'], text: 'срок груз' }]);
  const oldText = (q) => String(q || '').trim().toLowerCase();   // the search box before hashtags existed
  const noLetterAfterHash = randomStrings([' ', '#', '1', '2', '-', '_', '\t', '.', '(', ')', '\n'], 120, 14, 7);   // no letter at all, so no token can be a tag
  const noHash = randomStrings([' ', 'a', 'B', 'é', '1', '-', '_', '\n', '('], 120, 14, 11);
  const queryDrift = [...noLetterAfterHash, ...noHash].filter((q) => { const p = parseNoteQuery(q); return p.tags.length !== 0 || p.text !== oldText(q); });
  t('differential vs the old search box over 240 seeded random queries with no tag token in any of them (no letter after a "#", or no "#" at all): zero tags and the old text, byte for byte (offenders listed)',
    queryDrift.map((q) => JSON.stringify(q)), []);
  t('parseNoteQuery pulls out tokens that are exactly a tag (case-insensitive, unique, in first-seen order, a trailing hyphen dropped) and joins the other tokens with ONE space as the free text',
    [parseNoteQuery('USNYC #Rolled #rolled #x-'), parseNoteQuery('#a #b'), parseNoteQuery('#CafÉ'), parseNoteQuery('x #a y'), parseNoteQuery('cut   cargo #a  y'), parseNoteQuery('#b #a #B')],
    [{ tags: ['rolled', 'x'], text: 'usnyc' }, { tags: ['a', 'b'], text: '' }, { tags: ['café'], text: '' }, { tags: ['a'], text: 'x y' }, { tags: ['a'], text: 'cut cargo y' }, { tags: ['b', 'a'], text: '' }]);
  t('only a token that is EXACTLY a tag is a tag: "#a,", "(#b)", \'"#c"\' and "#d!" stay in the free text, and so do "#12" and a lone "#" next to a real tag',
    [parseNoteQuery('#a, (#b) "#c" #d!'), parseNoteQuery('#rolled- #12 #')], [{ tags: [], text: '#a, (#b) "#c" #d!' }, { tags: ['rolled'], text: '#12 #' }]);
  t('parseNoteQuery never throws: null, undefined and "" give no tags and no text; numbers, booleans, objects and arrays are read through String()',
    [parseNoteQuery(null), parseNoteQuery(undefined), parseNoteQuery(''), safe(() => parseNoteQuery(42)), safe(() => parseNoteQuery(true)), safe(() => parseNoteQuery({}).tags), safe(() => parseNoteQuery(['#A', 'b']))],
    [{ tags: [], text: '' }, { tags: [], text: '' }, { tags: [], text: '' }, { tags: [], text: '42' }, { tags: [], text: 'true' }, [], { tags: [], text: '#a,b' }]);

  // --- toggleNoteQueryTag: clicking a tag or a chip
  t('toggleNoteQueryTag adds the tag as " #tag" at the END, lower-cased; a leading "#" on the tag is accepted; the other tokens stay in order',
    [toggle('', 'rolled'), toggle('usnyc', 'rolled'), toggle('usnyc #a', 'b'), toggle('', '#rolled'), toggle('', '#Rolled'), toggle('', 'ROLLED'), toggle('', 'CAFÉ')],
    ['#rolled', 'usnyc #rolled', 'usnyc #a #b', '#rolled', '#rolled', '#rolled', '#café']);
  t('toggleNoteQueryTag removes the tag when the query already has it: any case, with or without a trailing hyphen, every copy of it, the other tokens kept in order',
    [toggle('#rolled', 'rolled'), toggle('usnyc #Rolled #x', 'ROLLED'), toggle('#a #b', '#a'), toggle('#rolled-', 'rolled'), toggle('#a #A x', 'a'), toggle('z #a y #b x', 'a')],
    ['', 'usnyc #x', '#b', '', 'x', 'z y #b x']);
  t('toggleNoteQueryTag matches a WHOLE tag token only: "#rolled2", the plain word "rolled" and "#12" are not the tag "rolled" and stay; "#cut" and "#cutcargo" are different tags',
    [toggle('#rolled2', 'rolled'), toggle('rolled', 'rolled'), toggle('#12 x', 'a'), toggle('#cut', 'cutcargo'), toggle('#cutcargo', 'cut')],
    ['#rolled2 #rolled', 'rolled #rolled', '#12 x #a', '#cut #cutcargo', '#cutcargo #cut']);
  t('toggleNoteQueryTag collapses whitespace to single spaces and never appends a bare "#": an empty tag, "#", null and undefined are all safe',
    [toggle('  a   b  ', 'x'), toggle('  a   #x  b ', 'x'), toggle('a  b', ''), toggle('x', '#'), toggle('x', null), toggle('', ''), toggle('   ', '#'), toggle(null, null), toggle(undefined, 'a')],
    ['a b #x', 'a b', 'a b', 'x', 'x', '', '', '', '#a']);
  const toggleBad = [];
  ['rolled', 'café', 'a_b', 'c-d', 'x9'].forEach((tg) => ['', 'usnyc', 'cut  cargo #other', '#a #b', '  #a   x  '].forEach((q) => {
    const norm = q.trim().split(/\s+/).filter(Boolean).join(' ');
    const added = toggle(q, tg);
    const wantTags = [...parseNoteQuery(q).tags, tg];
    if (JSON.stringify(parseNoteQuery(added).tags) !== JSON.stringify(wantTags)) toggleBad.push(`add ${tg} to ${JSON.stringify(q)} -> ${JSON.stringify(added)} reads back as ${JSON.stringify(parseNoteQuery(added).tags)}`);
    if (toggle(added, tg) !== norm) toggleBad.push(`remove ${tg} from ${JSON.stringify(added)} -> ${JSON.stringify(toggle(added, tg))}, wanted ${JSON.stringify(norm)}`);
  }));
  t('toggleNoteQueryTag round trip over 25 tag/query pairs: the added tag reads back through parseNoteQuery after the tags already there, and toggling it again restores the original query (whitespace collapsed)',
    toggleBad, []);

  // --- filterNotesForList with #tags
  const ME = 'kevin.lee@x.com', day = 86400000, nowMs = Date.UTC(2026, 9, 2, 18, 0, 0);
  const ago = (d) => new Date(nowMs - d * day).toISOString();
  const hn = deepFreeze([
    { vvd: 'ZBTT0349S', note: 'Cut 100 teu ex USXXX #rolled #USNYC', author: 'adam.cosner@x.com', visibility: 'public', updatedAt: ago(1) },
    { vvd: 'zbtt0349s', note: 'seeing if #Rolled works at bay #3', author: ME, visibility: 'private', updatedAt: ago(2) },
    { vvd: 'SROT0045S', note: 'cut cargo #cutcargo', author: ME, visibility: 'private', updatedAt: ago(3) },
    { vvd: 'ONPT0023W', note: 'cut #cut only', author: 'adam.cosner@x.com', updatedAt: ago(10) },                    // no `visibility`: public
    { vvd: 'NSOT0067S', note: 'see http://x/y#frag and AB#cd, ref #12', author: ME, visibility: 'public', updatedAt: ago(40) },   // no real tag at all
    { vvd: 'OLD0001S', note: 'cut cargo #rolled #usnyc', author: 'bob@x.com', visibility: 'public' },                // undated: the age filter keeps it
    { vvd: 'RUS0001S', note: 'новая #привет', author: 'bob@x.com', visibility: 'public', updatedAt: ago(1) },   // other script: a tag since 2026-10-03
  ]);
  const hnSnapshot = JSON.stringify(hn);
  const names = (l) => l.map((n) => `${n.vvd}:${n.visibility || 'public'}`);
  const hf = (opts) => names(filterNotesForList(hn, { nowMs, me: ME, ...opts }));

  t('a "#tag" in the query needs that WHOLE tag on the note, case-insensitively: #rolled finds #Rolled and #rolled; #cut does NOT find #cutcargo (nor the other way round); #cu finds nothing',
    [hf({ query: '#rolled' }), hf({ query: '#ROLLED' }), hf({ query: '#cut' }), hf({ query: '#cutcargo' }), hf({ query: '#cu' })],
    [['ZBTT0349S:public', 'zbtt0349s:private', 'OLD0001S:public'], ['ZBTT0349S:public', 'zbtt0349s:private', 'OLD0001S:public'], ['ONPT0023W:public'], ['SROT0045S:private'], []]);
  t('several tags AND together, in any order and with a repeated tag; two tags that never share a note find nothing',
    [hf({ query: '#rolled #usnyc' }), hf({ query: '#usnyc #rolled' }), hf({ query: '#rolled #rolled' }), hf({ query: '#rolled #cutcargo' })],
    [['ZBTT0349S:public', 'OLD0001S:public'], ['ZBTT0349S:public', 'OLD0001S:public'], ['ZBTT0349S:public', 'zbtt0349s:private', 'OLD0001S:public'], []]);
  t('a tag plus free text: the text keeps its old meaning (substring of the VVD, the note or the author, any position in the query) and ANDs with the tag',
    [hf({ query: 'cargo #rolled' }), hf({ query: 'zbtt #rolled' }), hf({ query: 'BOB #rolled' }), hf({ query: '#rolled bob' }), hf({ query: 'xyz #rolled' })],
    [['OLD0001S:public'], ['ZBTT0349S:public', 'zbtt0349s:private'], ['OLD0001S:public'], ['OLD0001S:public'], []]);
  t('a tag plus the kind chip: Cut Cargo, Private and Mine each narrow the tagged notes, and Mine with no known viewer finds none',
    [hf({ query: '#rolled', kind: 'public' }), hf({ query: '#rolled', kind: 'private' }), hf({ query: '#rolled', kind: 'mine' }), hf({ query: '#rolled', kind: 'mine', me: null })],
    [['ZBTT0349S:public', 'OLD0001S:public'], ['zbtt0349s:private'], ['zbtt0349s:private'], []]);
  t('a tag plus the age filter: a note older than the window goes (#cut is 10 days old), a note with no date is KEPT',
    [hf({ query: '#rolled', ageDays: 7 }), hf({ query: '#cut', ageDays: 7 }), hf({ query: '#cut', ageDays: 30 })],
    [['ZBTT0349S:public', 'zbtt0349s:private', 'OLD0001S:public'], [], ['ONPT0023W:public']]);
  t('tag + free text + kind + age all AND: every part must hold',
    [hf({ kind: 'public', ageDays: 7, query: 'cargo #rolled' }), hf({ kind: 'public', ageDays: 7, query: '#rolled #usnyc' }), hf({ kind: 'private', ageDays: 1, query: '#rolled' }), hf({ kind: 'mine', ageDays: 7, query: 'seeing #rolled' })],
    [['OLD0001S:public'], ['ZBTT0349S:public', 'OLD0001S:public'], [], ['zbtt0349s:private']]);
  t('what is not a tag is searched as plain text: "#frag" (a URL fragment) and "#cd" (glued) need a real tag and find nothing, while "frag" and "cd" find the note; "#12", "#3" and a lone "#" are substring searches',
    [hf({ query: '#frag' }), hf({ query: 'frag' }), hf({ query: '#cd' }), hf({ query: 'cd' }), hf({ query: '#12' }), hf({ query: '#3' }), hf({ query: '#' })],
    [[], ['NSOT0067S:public'], [], ['NSOT0067S:public'], ['NSOT0067S:public'], ['zbtt0349s:private'],
      ['ZBTT0349S:public', 'zbtt0349s:private', 'SROT0045S:private', 'ONPT0023W:public', 'NSOT0067S:public', 'OLD0001S:public', 'RUS0001S:public']]);
  // 2026-10-03 (review fix): REWRITTEN. "#ПРИВЕТ" finds the note either way, so that alone proves nothing; the proof that the
  // other-script tag is a real TAG is that it matches WHOLE ("#приве" is a prefix, found as plain text before, nothing now).
  t('a tag in another script is a real tag now (review fix 2026-10-03, was "ordinary search text"): "#ПРИВЕТ" finds the note by tag, a PREFIX "#приве" finds nothing (a tag must match whole; as plain text it used to match), and the plain word "привет" still finds it',
    [hf({ query: '#ПРИВЕТ' }), hf({ query: '#привет' }), hf({ query: '#приве' }), hf({ query: 'привет' })],
    [['RUS0001S:public'], ['RUS0001S:public'], [], ['RUS0001S:public']]);
  t('tags come from the note TEXT only: a "#rolled" in the VVD or the author never makes a note carry the tag',
    names(filterNotesForList([{ vvd: '#rolled', note: 'plain', author: '#rolled' }], { query: '#rolled' })), []);
  t('asking for nothing returns the SAME array, tags in the picture or not: no query, a blank query, kind all, no age',
    [filterNotesForList(hn) === hn, filterNotesForList(hn, { query: '  ' }) === hn, filterNotesForList(hn, { kind: 'all', query: '', ageDays: 0, me: ME, nowMs }) === hn, filterNotesForList(hn, { query: null }) === hn],
    [true, true, true, true]);
  const oneNote = [hn[0]];
  t('a tag query returns a NEW array even when every note matches, and "#12" / "#" are real searches, not no-ops',
    [filterNotesForList(oneNote, { query: '#rolled' }) !== oneNote, names(filterNotesForList(oneNote, { query: '#rolled' })), filterNotesForList(hn, { query: '#12' }) !== hn, filterNotesForList(hn, { query: '#' }) !== hn],
    [true, ['ZBTT0349S:public'], true, true]);
  t('missing or odd input with a tag query: a null or undefined list gives [], and a null entry, a note with no text or with non-string text is dropped without throwing',
    [filterNotesForList(null, { query: '#a' }), filterNotesForList(undefined, { query: '#a' }),
      safe(() => names(filterNotesForList([null, { vvd: 'X' }, { vvd: 'Y', note: null }, { vvd: 'Z', note: 5 }, { vvd: 'W', note: '#a' }], { query: '#a' })))],
    [[], [], ['W:public']]);

  // --- the pool the dialog's tag bar is built from: collectNoteTags(filterNotesForList(listedNotes, { kind, ageDays, me })) -- the membership and order of buildNoteTagChips's chips (its counts are checked below)
  const poolOf = (opts) => collectNoteTags(filterNotesForList(hn, { me: ME, nowMs, ...opts })).map((c) => `${c.tag}:${c.count}`);
  // 2026-10-03 (review fix): the expected pools gained "привет:1" -- the fixture's RUS0001S note carries a Cyrillic tag, which is a tag now.
  t('the tag pool follows kind, age and viewer and never the search box: #cutcargo lives only on a private note, so it is offered under All, Private and Mine but not under Cut Cargo; counts follow the kind (the Cyrillic #привет note is public, so it is in the All, Cut Cargo and 7-day pools since 2026-10-03)',
    [poolOf({}), poolOf({ kind: 'public' }), poolOf({ kind: 'private' }), poolOf({ kind: 'mine' }), poolOf({ ageDays: 7 })],
    [['rolled:3', 'usnyc:2', 'cut:1', 'cutcargo:1', 'привет:1'], ['rolled:2', 'usnyc:2', 'cut:1', 'привет:1'], ['cutcargo:1', 'rolled:1'], ['cutcargo:1', 'rolled:1'], ['rolled:3', 'usnyc:2', 'cutcargo:1', 'привет:1']]);
  t('another viewer\'s list (the server never sends them a private note) offers no tag from it: the public notes alone give exactly the Cut Cargo pool (now including the Cyrillic #привет, 2026-10-03), with no #cutcargo',
    [collectNoteTags(hn.filter((n) => n.visibility !== 'private')).map((c) => `${c.tag}:${c.count}`), collectNoteTags(hn.filter((n) => n.visibility !== 'private')).some((c) => c.tag === 'cutcargo')],
    [['rolled:2', 'usnyc:2', 'cut:1', 'привет:1'], false]);
  t('none of the helpers modify their inputs (all the test lists were deep-frozen first; contents and order are unchanged afterwards)',
    [Object.isFrozen(hn), Object.isFrozen(tagNotes), JSON.stringify(hn) === hnSnapshot, JSON.stringify(tagNotes) === tagNotesSnapshot, hn.length, tagNotes.length],
    [true, true, true, true, 7, 8]);

  // --- review fixes (2026-10-02): the cases the independent real-data review found, kept from coming back
  t('the multiplication and division signs are not letters: "#×1" and "#a÷b" ("#a" is the tag, "÷b" is plain text) -- the accented range skips U+00D7 and U+00F7 but still takes "#Øre" and "#ÿes"',
    [tagsOf('#×1'), tagsOf('#a÷b'), tagsOf('#Øre'), tagsOf('#ÿes')], [[], ['a'], ['øre'], ['ÿes']]);
  const longRun = `#a${'-'.repeat(50000)}b`;
  const longStart = Date.now();
  const longTags = tagsOf(longRun);
  const longMs = Date.now() - longStart;
  t('a tag with a 50,000-hyphen run inside is read in linear time (the /-+$/ trim it replaced took ~2 s here; the bound is 500 ms), whole, and the text is still split losslessly',
    [longTags.length, (longTags[0] || '').length, longMs < 500, splitNoteText(longRun).map((p) => p.text).join('') === longRun], [1, 50002, true, true]);
  t('parseNoteQuery keeps the old non-string rule String(query || ""): 0, false, NaN, null and undefined are an empty query (no text, no tags), and filterNotesForList with query 0 filters nothing',
    [[0, false, NaN, null, undefined].map((q) => JSON.stringify(parseNoteQuery(q))), filterNotesForList([{ vvd: 'A', note: 'x' }], { query: 0 }).length],
    [Array(5).fill('{"tags":[],"text":""}'), 1]);
  t('toggleNoteQueryTag ignores a key that is not a valid tag instead of appending junk ("##a", "a b", "12", "", null), but still normalises a valid one ("rolled-" -> #rolled)',
    [toggle('x', '##a'), toggle('x', 'a b'), toggle('x', '12'), toggle('x', ''), toggle('x', null), toggle('usnyc', 'rolled-')], ['x', 'x', 'x', 'x', 'x', 'usnyc #rolled']);

  // =========================================================================
  // Review fixes, round 2 (2026-10-03): the Unicode-safe tag grammar, the NFC key, the hoisted RegExp and buildNoteTagChips.
  // Every check below was mutation-tested: a copy of the app with the matching bug put back makes it fail (see the report
  // that came with this change, and docs/CHECK_HISTORY.md).
  // =========================================================================
  // A seeded LCG (Numerical Recipes constants), so a fuzz failure reproduces exactly. Division by 2^32 uses the high bits;
  // the low bits of an LCG are the weak ones.
  const lcg = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const hex = (c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  const isSurrogate = (cp) => cp >= 0xD800 && cp <= 0xDFFF;

  // --- 1. closure: every key the grammar can produce is itself a valid, typeable tag
  // The failure this guards (review finding 5): the key is the LOWER-CASED word, and lower-casing can leave a hand-written
  // letter range ("İ" -> "i" + U+0307 COMBINING DOT ABOVE; "Ɛ" -> U+025B, outside A-Za-z and the Latin-1 range). Then the
  // chip for "#İstanbul" offered a key the grammar itself rejected, and clicking it did nothing. \p{L} + \p{M} is closed
  // under lower-casing, and this walks ALL of it instead of trusting an argument.
  const letterChars = [];
  for (let cp = 0; cp <= 0x10FFFF; cp++) { if (isSurrogate(cp)) continue; const ch = String.fromCodePoint(cp); if (/^\p{L}$/u.test(ch)) letterChars.push(ch); }
  const closureBroken = [];
  letterChars.forEach((ch) => {
    const found = tagsOf(`x #${ch}b`);
    if (found.length !== 1) { closureBroken.push(`${hex(ch)} is not read as a tag start`); return; }
    const k = found[0];
    const added = toggle('', k);
    if (added !== `#${k}`) { closureBroken.push(`${hex(ch)}: key ${JSON.stringify(k)} toggles to ${JSON.stringify(added)}`); return; }
    const back = parseNoteQuery(added).tags;
    if (back.length !== 1 || back[0] !== k) { closureBroken.push(`${hex(ch)}: ${JSON.stringify(added)} reads back as ${JSON.stringify(back)}`); return; }
    if (toggle(added, k) !== '') closureBroken.push(`${hex(ch)}: toggling ${JSON.stringify(k)} a second time does not remove it`);
  });
  t('closure over EVERY Unicode letter (all of \\p{L}, ~141,000 code points, surrogates skipped): the key of "#<letter>b" is one tag, toggleNoteQueryTag("", key) is exactly "#key", parseNoteQuery reads it back as [key], and toggling again removes it (first 5 offenders listed; the walk is not vacuous: more than 100,000 letters)',
    [closureBroken.slice(0, 5), closureBroken.length, letterChars.length > 100000], [[], 0, true]);
  // The same walk for the characters that may sit INSIDE a tag after its first letter: letters, combining marks (the \p{M} that
  // lower-casing "İ" needs), digits. "a" + one of them + "z", so a lower-casing or NFC step that moves the character is exercised
  // in the middle of a word as well as at its start.
  const innerChars = [];
  for (let cp = 0; cp <= 0x10FFFF; cp++) { if (isSurrogate(cp)) continue; const ch = String.fromCodePoint(cp); if (/^[\p{L}\p{M}\p{N}]$/u.test(ch)) innerChars.push(ch); }
  const innerBroken = [];
  innerChars.forEach((ch) => {
    const found = tagsOf(`x #a${ch}z`);
    // The whole word "a" + char + "z" must be the tag. Checking only "one tag found" would pass a grammar that stops AT the char
    // ("#a" + digit would then read as the tag "a" and the rest as plain text), so the expected key is spelled out.
    const wantKey = `a${ch}z`.normalize('NFC').toLowerCase().normalize('NFC');
    if (found.length !== 1 || found[0] !== wantKey) { innerBroken.push(`${hex(ch)} does not stay inside the tag: ${JSON.stringify(found)}`); return; }
    const k = found[0];
    if (toggle('', k) !== `#${k}` || JSON.stringify(parseNoteQuery(`#${k}`).tags) !== JSON.stringify([k])) innerBroken.push(`${hex(ch)}: key ${JSON.stringify(k)} is not typeable back`);
  });
  t('closure for the INNER characters too: after a first letter, every letter, combining mark and digit (\\p{L} \\p{M} \\p{N}) stays inside the tag ("#a" + char + "z" is ONE whole tag, its key being the NFC lower-case of "a" + char + "z") and that key is typeable back (first 5 offenders listed)',
    [innerBroken.slice(0, 5), innerBroken.length, innerChars.length > letterChars.length], [[], 0, true]);

  // --- 2. the review's two named cases
  const IST = 'i\u0307stanbul';   // "İstanbul" lower-cased: i + U+0307
  const EWE = '\u025Bwe';         // "Ɛwe" lower-cased: U+025B (LATIN SMALL LETTER OPEN E)
  const istNotes = [{ vvd: 'TR1', note: 'port call #İstanbul tomorrow' }, { vvd: 'GH1', note: 'cut at #Ɛwe berth' }, { vvd: 'XX1', note: 'plain' }];
  const istSeg = splitNoteText(istNotes[0].note).find((p) => p.tag) || {};    // what the in-note button carries ({} if a broken split lost it: the check then fails instead of throwing)
  const eweSeg = splitNoteText(istNotes[1].note).find((p) => p.tag) || {};
  t('review finding 5 (#İstanbul, #Ɛwe): the keys are "i"+U+0307 and U+025B, clicking the in-note tag or its chip now ADDS the tag to the box (it used to do nothing) and toggles it off again, and the list then shows just that note',
    [tagsOf('see #İstanbul')[0] === IST, tagsOf('#Ɛwe')[0] === EWE, istSeg.tag === IST, eweSeg.tag === EWE,
      toggle('', istSeg.tag) === `#${IST}`, toggle('', eweSeg.tag) === `#${EWE}`, toggle(`#${IST}`, IST), toggle(`#${EWE} x`, EWE),
      filterNotesForList(istNotes, { query: toggle('', istSeg.tag) }).map((n) => n.vvd), filterNotesForList(istNotes, { query: toggle('', eweSeg.tag) }).map((n) => n.vvd),
      buildNoteTagChips(istNotes, { query: '' }).filter((c) => c.tag === IST).map((c) => [c.pressed, c.count]),
      buildNoteTagChips(istNotes, { query: toggle('', istSeg.tag) }).filter((c) => c.tag === IST).map((c) => [c.pressed, c.count])],
    [true, true, true, true, true, true, '', 'x', ['TR1'], ['GH1'], [[false, 1]], [[true, 3]]]);

  // --- 3. NFC / NFD: one tag, one key, one chip; the combining mark stays inside the tag
  const CAFE_NFC = 'caf\u00E9', CAFE_NFD = 'cafe\u0301';
  // Why the key is NFC(lowercase(NFC(word))) and not just lower-case: "H" + U+0331 (COMBINING MACRON BELOW) has NO precomposed
  // capital, so NFC leaves it as two code points; its lower-case "h" + U+0331 DOES have a precomposed form, U+1E96. Only an NFC
  // step AFTER lower-casing turns it into the same single character a user gets by typing "ẖ" directly. (The reverse order of
  // operations fails the same way for "J" + U+030C -> U+01F0 and "T" + U+0308 -> U+1E97.)
  const HMAC_NFD_UPPER = 'H\u0331', HMAC_NFD_LOWER = 'h\u0331', HMAC_NFC = '\u1E96';
  t('NFC and NFD are ONE tag: precomposed "#café", decomposed "#cafe"+U+0301 and "#CAFE"+U+0301 all give the key "café" (precomposed), and the key function agrees',
    [tagsOf(`#${CAFE_NFC}`), tagsOf(`#${CAFE_NFD}`), tagsOf('#CAFE\u0301'), tagsOf(`#${CAFE_NFC} #${CAFE_NFD}`), noteTagKey(CAFE_NFD) === CAFE_NFC, CAFE_NFD !== CAFE_NFC, CAFE_NFD.length, CAFE_NFC.length],
    [[CAFE_NFC], [CAFE_NFC], [CAFE_NFC], [CAFE_NFC], true, true, 5, 4]);
  t('NFC after lower-casing matters: "#H"+U+0331 and "#h"+U+0331 and the precomposed "#ẖ" (U+1E96) are ONE key, the precomposed one; so are "J"+U+030C / U+01F0 and "T"+U+0308 / U+1E97 (a key that only lower-cases would keep the decomposed pair apart from the typed single character)',
    [tagsOf(`#${HMAC_NFD_UPPER}`), tagsOf(`#${HMAC_NFD_LOWER}`), tagsOf(`#${HMAC_NFC}`), tagsOf('#J\u030C'), tagsOf('#\u01F0'), tagsOf('#T\u0308'), tagsOf('#\u1E97'), noteTagKey(HMAC_NFD_UPPER) === HMAC_NFC],
    [[HMAC_NFC], [HMAC_NFC], [HMAC_NFC], ['\u01F0'], ['\u01F0'], ['\u1E97'], ['\u1E97'], true]);
  const nfdText = `see #${CAFE_NFD} now`;
  t('NFD in a note: splitNoteText is lossless and the combining mark is INSIDE the tag segment ("#cafe"+U+0301 is the button text, no stray mark opens the next plain segment), with the NFC key on the segment',
    [splitNoteText(nfdText), splitNoteText(nfdText).map((p) => p.text).join('') === nfdText, splitNoteText(`#${CAFE_NFD}!`)],
    [[{ text: 'see ' }, { text: `#${CAFE_NFD}`, tag: CAFE_NFC }, { text: ' now' }], true, [{ text: `#${CAFE_NFD}`, tag: CAFE_NFC }, { text: '!' }]]);
  const nfcNote = { vvd: 'N1', note: `x #${CAFE_NFC}`, author: 'a@x', visibility: 'public' };
  const nfdNote = { vvd: 'N2', note: `y #${CAFE_NFD}`, author: 'a@x', visibility: 'public' };
  t('a typed NFD query finds an NFC note and the other way round, toggling in one form removes the other, and the two spellings are ONE chip (collectNoteTags counts both notes under one key; buildNoteTagChips shows it pressed for either typed form)',
    [filterNotesForList([nfcNote], { query: `#${CAFE_NFD}` }).length, filterNotesForList([nfdNote], { query: `#${CAFE_NFC}` }).length, filterNotesForList([nfcNote, nfdNote], { query: `#${CAFE_NFC}` }).length,
      toggle('', CAFE_NFD), toggle(`#${CAFE_NFC}`, CAFE_NFD), toggle(`#${CAFE_NFD}`, CAFE_NFC), collectNoteTags([nfcNote, nfdNote]),
      buildNoteTagChips([nfcNote, nfdNote], { query: `#${CAFE_NFD}` })],
    [1, 1, 2, `#${CAFE_NFC}`, '', '', [{ tag: CAFE_NFC, count: 2 }], [{ tag: CAFE_NFC, total: 2, pressed: true, count: 2 }]]);

  // --- 4. the hoisted RegExp keeps no state between calls
  // NOTE_TAG_IN_TEXT_RE is built once and shared. String.prototype.matchAll works on a COPY, but the copy starts at the shared
  // regex's lastIndex, so any stateful use of the shared one (a .test() guard, a lone .exec()) would make the next call skip the
  // front of its text. Repeated and interleaved calls must therefore give identical answers, and lastIndex must stay 0.
  // The expected answers are written out, not taken from a first call: a version that leaks state would give the same wrong answer
  // every time it is asked in the same order, and a check that only compares a call with an earlier call would pass it.
  const hoistProbes = [
    ['#one #two', ['one', 'two']], ['(#x) #y, #z', ['x', 'y', 'z']], ['plain text', []], [`see #${CAFE_NFD} then #Привет`, [CAFE_NFC, 'привет']],
    ['', []], ['#a #a #A', ['a']],
  ];
  const hoistBad = [];
  const hoistLastIndex = [];
  const hoistCheck = (s, want, how) => {
    const got = how === 'extract' ? extractNoteTags(s) : splitNoteText(s).filter((p) => p.tag).map((p) => p.tag).filter((tg, i, all) => all.indexOf(tg) === i);
    if (JSON.stringify(got) !== JSON.stringify(want)) hoistBad.push(`${how}(${JSON.stringify(s)}) gave ${JSON.stringify(got)}`);
    if (how === 'split' && splitNoteText(s).map((p) => p.text).join('') !== s) hoistBad.push(`split(${JSON.stringify(s)}) is not lossless`);
    if (hoistedTagRe) hoistLastIndex.push(hoistedTagRe.lastIndex);
  };
  for (let round = 0; round < 3; round++) {
    hoistProbes.forEach(([s, want]) => { hoistCheck(s, want, 'extract'); hoistCheck(s, want, 'split'); });             // each text, both functions, in turn
    [...hoistProbes].reverse().forEach(([s, want]) => { hoistCheck(s, want, 'split'); hoistCheck(s, want, 'extract'); });   // interleaved the other way round
  }
  t('hoisted RegExp hygiene: three rounds of repeated and interleaved extractNoteTags / splitNoteText calls over 6 texts give the written-out correct answer every time (no lastIndex leak into the next call), the shared RegExp is global + unicode, and its lastIndex is 0 after EVERY call',
    [hoistBad.slice(0, 3), hoistBad.length, !!hoistedTagRe && hoistedTagRe.global && hoistedTagRe.unicode, hoistLastIndex.length, hoistLastIndex.every((n) => n === 0)], [[], 0, true, 72, true]);

  // --- 5. fuzz parity: extractNoteTags is exactly the distinct tags of splitNoteText, and every tag is typeable
  const fuzzAlphabet = ['a', 'a', 'B', 'x', 'Z', '#', '#', '#', ' ', ' ', ' ', '\n', '-', '_', '3', '0', '\u00E9', 'e\u0301', '\u0130', '\u044F', '\u65E5', '(', ',', '\u00D7', '!', '\u0301'];
  const fuzzPieces = ['#a', '#a', '#A', '#B', '#\u00E9', '#cafe\u0301', '#\u0130x', '#\u044F', '#a-', '#a_b', '#', '##', ' ', ' ', ' ', '\n', ',', '(', '-', '1', 'a', 'x', '\u0301', '\u00D7'];
  const rand4k = lcg(20261003);
  const fuzz4k = Array.from({ length: 4000 }, () => { let s = ''; const n = Math.floor(rand4k() * 31); for (let i = 0; i < n; i++) s += fuzzAlphabet[Math.floor(rand4k() * fuzzAlphabet.length)]; return s; });
  const randPieces = lcg(1003);
  const fuzzDense = Array.from({ length: 2000 }, () => { let s = ''; const n = Math.floor(randPieces() * 16); for (let i = 0; i < n; i++) s += fuzzPieces[Math.floor(randPieces() * fuzzPieces.length)]; return s; });
  const parityBad = [];
  let fuzzTagged = 0, fuzzRepeated = 0, fuzzMarked = 0;
  [...fuzz4k, ...fuzzDense].forEach((s) => {
    const segs = splitNoteText(s);
    const tagSegs = segs.filter((p) => p.tag);
    const viaSplit = [];
    tagSegs.forEach((p) => { if (!viaSplit.includes(p.tag)) viaSplit.push(p.tag); });
    const viaExtract = extractNoteTags(s);
    if (tagSegs.length) fuzzTagged++;
    if (tagSegs.length > viaSplit.length) fuzzRepeated++;
    if (tagSegs.some((p) => /\p{M}/u.test(p.text))) fuzzMarked++;
    const problems = [];
    if (segs.map((p) => p.text).join('') !== s) problems.push('not lossless');
    if (JSON.stringify(viaExtract) !== JSON.stringify(viaSplit)) problems.push(`extract ${JSON.stringify(viaExtract)} != split ${JSON.stringify(viaSplit)}`);
    if (new Set(viaExtract).size !== viaExtract.length) problems.push('extract has duplicates');
    segs.forEach((p, i) => {
      if (!p.text) problems.push('empty segment');
      if (i > 0 && !p.tag && !segs[i - 1].tag) problems.push('two plain segments touch');
      if (p.tag) {
        if (p.text[0] !== '#' || p.tag !== noteTagKey(p.text.slice(1))) problems.push(`segment ${JSON.stringify(p.text)} key ${JSON.stringify(p.tag)}`);
        if (JSON.stringify(tagsOf(p.text)) !== JSON.stringify([p.tag])) problems.push(`segment ${JSON.stringify(p.text)} does not re-parse as its own key`);
        if (toggle('', p.tag) !== `#${p.tag}`) problems.push(`key ${JSON.stringify(p.tag)} is not typeable`);
        if (segs[i + 1] && !segs[i + 1].tag && /^\p{M}/u.test(segs[i + 1].text)) problems.push('a combining mark is left outside the tag button');
      }
    });
    if (problems.length) parityBad.push(`${JSON.stringify(s)}: ${problems.join('; ')}`);
  });
  t('fuzz parity, 4,000 seeded strings over letters, "#", space, newline, "-", "_", digits, é, e+U+0301, İ, я, 日, "(", ",", ×, "!" (plus 2,000 dense piece strings): extractNoteTags is exactly the distinct tags of splitNoteText in order, with no duplicates; the split is lossless; every tag segment is "#" + its own NFC/lower key, re-parses as that one key, is typeable, and never leaves a combining mark outside its button (first 5 offenders listed)',
    [parityBad.slice(0, 5), parityBad.length], [[], 0]);
  t('the fuzz is not vacuous: of the 6,000 strings at least 1,500 contain a tag, at least 100 repeat a tag (so the "distinct" rule is exercised) and at least 100 have a combining mark inside a tag',
    [fuzzTagged >= 1500, fuzzRepeated >= 100, fuzzMarked >= 100], [true, true, true]);

  // --- 6. buildNoteTagChips: the chips' numbers are what a click lists
  const CME = 'kevin.lee@x.com', COTHER = 'ann@x.com', chipNow = Date.UTC(2026, 9, 3, 12, 0, 0);
  const chipAgo = (d) => new Date(chipNow - d * 86400000).toISOString();
  const chipNotes = deepFreeze([
    { vvd: 'C1', note: 'cut 10 #rolled #usnyc', author: COTHER, visibility: 'public', updatedAt: chipAgo(1) },
    { vvd: 'C2', note: 'b #rolled', author: CME, visibility: 'public', updatedAt: chipAgo(2) },
    { vvd: 'C3', note: 'c #usnyc #pubonly a', author: COTHER, visibility: 'public', updatedAt: chipAgo(20) },
    { vvd: 'C4', note: 'mine #rolled #privonly #Rolled', author: CME, visibility: 'private', updatedAt: chipAgo(1) },
    { vvd: 'C5', note: 'mine #privonly a', author: CME, visibility: 'private', updatedAt: chipAgo(30) },
    { vvd: 'C6', note: 'no tags a b', author: COTHER },
    { vvd: 'C7', note: `x #${CAFE_NFC} and #${CAFE_NFD}`, author: COTHER, visibility: 'public', updatedAt: chipAgo(3) },
    { vvd: 'C8', note: '#привет a', author: CME, visibility: 'public', updatedAt: chipAgo(5) },
  ]);
  const chipSnapshot = JSON.stringify(chipNotes);
  const chipQueries = ['', '#rolled', '#rolled #usnyc', 'a', 'zzz', '#rolled a', '#nope', '#ROLLED', '#rolled  #usnyc', '#nope #rolled', `#${CAFE_NFD}`, '#privonly'];
  const chipOpts = [{ kind: 'all' }, { kind: 'public' }, { kind: 'private' }, { kind: 'mine' }, { kind: 'mine', me: null }]
    .flatMap((o) => [0, 7].map((ageDays) => ({ me: CME, ...o, ageDays, nowMs: chipNow })));
  const chipWrong = [];
  let chipsChecked = 0, chipsCountDiffersFromTotal = 0, chipsPressed = 0, chipsEmpty = 0;
  chipOpts.forEach((o) => chipQueries.forEach((q) => {
    const chips = buildNoteTagChips(chipNotes, { ...o, query: q });
    const pool = collectNoteTags(filterNotesForList(chipNotes, { kind: o.kind, ageDays: o.ageDays, me: o.me, nowMs: chipNow }));
    const wantPressed = parseNoteQuery(q).tags;
    chips.forEach((c) => {
      chipsChecked++;
      if (c.count !== c.total) chipsCountDiffersFromTotal++;
      if (c.pressed) chipsPressed++;
      if (c.count === 0 && !c.pressed) chipsEmpty++;
      const clicked = filterNotesForList(chipNotes, { ...o, query: toggle(q, c.tag) }).length;
      const poolTotal = (pool.find((p) => p.tag === c.tag) || { count: 0 }).count;
      if (clicked !== c.count) chipWrong.push(`${o.kind}/age${o.ageDays}/me=${o.me} ${JSON.stringify(q)} #${c.tag}: count ${c.count}, a click lists ${clicked}`);
      if (c.total !== poolTotal) chipWrong.push(`${o.kind}/age${o.ageDays} ${JSON.stringify(q)} #${c.tag}: total ${c.total}, pool says ${poolTotal}`);
      if (c.pressed !== wantPressed.includes(c.tag)) chipWrong.push(`${o.kind} ${JSON.stringify(q)} #${c.tag}: pressed ${c.pressed}`);
    });
    const wantOrder = [...pool.map((p) => p.tag), ...wantPressed.filter((tg) => !pool.some((p) => p.tag === tg))];
    if (JSON.stringify(chips.map((c) => c.tag)) !== JSON.stringify(wantOrder)) chipWrong.push(`${o.kind}/age${o.ageDays} ${JSON.stringify(q)}: chip order ${JSON.stringify(chips.map((c) => c.tag))}, pool order + pressed-but-absent is ${JSON.stringify(wantOrder)}`);
  }));
  t('buildNoteTagChips over 5 kinds (all, public, private, mine, mine with no viewer) x 2 ages x 12 queries (empty, one or two tags, free text, a tag nobody has, other case, double space, NFD): EVERY chip\'s count is exactly the number of notes the list shows after clicking it (filterNotesForList with toggleNoteQueryTag), total is the kind+age pool\'s count, pressed is "the query has the tag", and the chip order is the pool\'s order (then pressed tags nobody carries); the matrix is not vacuous (first 5 offenders listed)',
    [chipWrong.slice(0, 5), chipWrong.length, chipsChecked > 300, chipsCountDiffersFromTotal > 100, chipsPressed > 50, chipsEmpty > 50], [[], 0, true, true, true, true]);
  // Membership and order must not move while the user types: only counts may change with the search text.
  const chipStable = chipOpts.filter((o) => o.ageDays === 7 || o.kind === 'all').map((o) => {
    const sigs = ['', 'a', 'zzz', 'cut cargo', '  A  ', 'rolled', '#rolled', '#ROLLED a', '#rolled #usnyc', '#privonly', `#${CAFE_NFD} a`]
      .map((q) => JSON.stringify(buildNoteTagChips(chipNotes, { ...o, query: q }).filter((c) => c.total > 0).map((c) => [c.tag, c.total])));
    return new Set(sigs).size;
  });
  t('the bar does not jump while typing: for any search text (plain words, tags, other case, NFD) the chips that exist in the kind+age pool, their order and their totals are identical; only the counts and the pressed flags move',
    [chipStable.length > 3, chipStable.every((n) => n === 1)], [true, true]);
  const nopeChips = buildNoteTagChips(chipNotes, { query: '#nope' });
  const nopeTwo = buildNoteTagChips(chipNotes, { kind: 'private', me: CME, query: '#nope #rolled' });
  t('a pressed tag that nobody carries is still a chip, last, with total 0 and pressed true, so it can be taken out again: its count is the list WITHOUT it (all 8 notes for "#nope" alone), and a real pressed tag next to it keeps its own count',
    [nopeChips[nopeChips.length - 1], nopeChips.length, nopeTwo.filter((c) => c.pressed).map((c) => [c.tag, c.total, c.count]),
      buildNoteTagChips(null, { query: '#a' }), buildNoteTagChips(undefined), buildNoteTagChips([null, undefined, {}, { note: 5 }, { note: null }], { query: '' })],
    [{ tag: 'nope', total: 0, pressed: true, count: 8 }, 6 + 1, [['rolled', 1, 0], ['nope', 0, 1]], [{ tag: 'a', total: 0, pressed: true, count: 0 }], [], []]);
  // Privacy. The helper reads nothing but the list it is handed, so what it may offer is decided by the caller passing listedNotes
  // (never allNotes), but its own kind filter must not leak either: private-only and public-only tags stay in their own kind.
  const viewer2 = chipNotes.filter((n) => n.visibility !== 'private');   // what the server sends another person: no private note
  const tagsOfKind = (list, opts) => buildNoteTagChips(list, { me: CME, nowMs: chipNow, ...opts }).filter((c) => c.total > 0).map((c) => c.tag);
  t('privacy: the Private kind never offers a tag only public notes carry (#pubonly, #usnyc), the Cut Cargo kind never offers one only private notes carry (#privonly), and a viewer whose list has no private note is offered no private tag in any kind -- a #privonly typed into their box is just a chip with total 0 and count 0 (it confirms nothing)',
    [tagsOfKind(chipNotes, { kind: 'private' }).sort(), tagsOfKind(chipNotes, { kind: 'public' }).includes('privonly'), tagsOfKind(chipNotes, { kind: 'all' }).includes('privonly'),
      ['all', 'public', 'private', 'mine'].map((kind) => tagsOfKind(viewer2, { kind }).includes('privonly')),
      buildNoteTagChips(viewer2, { query: '#privonly' }).filter((c) => c.tag === 'privonly'), buildNoteTagChips(viewer2, { kind: 'private', me: CME, query: '#privonly' }).filter((c) => c.tag === 'privonly')],
    [['privonly', 'rolled'], false, true, [false, false, false, false], [{ tag: 'privonly', total: 0, pressed: true, count: viewer2.length }], [{ tag: 'privonly', total: 0, pressed: true, count: 0 }]]);
  const frozenOpts = Object.freeze({ kind: 'all', query: '#rolled', ageDays: 0, me: CME, nowMs: chipNow });
  const chipsA = buildNoteTagChips(chipNotes, frozenOpts);
  const chipsABefore = JSON.stringify(chipsA);
  chipsA.forEach((c) => { c.count = 999; c.tag = 'junk'; }); chipsA.push({ tag: 'extra' });   // vandalise what was returned
  const chipsB = buildNoteTagChips(chipNotes, frozenOpts);
  t('buildNoteTagChips is pure: it does not modify its deep-frozen notes or options (the snapshot is byte-identical after the whole matrix above), and every call returns a FRESH array of FRESH chips (vandalising one result changes nothing in the next)',
    [Object.isFrozen(chipNotes), JSON.stringify(chipNotes) === chipSnapshot, chipNotes.length, JSON.stringify(chipsB) === chipsABefore, chipsA !== chipsB, chipsA[0] !== chipsB[0]],
    [true, true, 8, true, true, true]);

  // --- 7. the old grammar is unchanged where it was right
  const stillNotTags = ['#12', 'bay #3', '##x', 'AB#cd', 'http://x/y#frag', '#\u00D71', '#_a', '#-a'];
  t('no regression on the old rules: "#12", "bay #3", "##x", "AB#cd", "http://x/y#frag", "#×1", "#_a", "#-a" are still not tags, as before; new edge cases of the Unicode grammar agree: a combining mark, a digit-like or an emoji right after "#" is not a tag start, but marks, digits (any script), "_" and "-" are inside one',
    [stillNotTags.map((s) => tagsOf(s)), tagsOf('#\u0301a'), tagsOf('#\u0301'), tagsOf('#\u00B2'), tagsOf('#\u{1F600}'), tagsOf('#a\u{1F600}'), tagsOf('#a\u0663 #b_c-d #x\u0301y'), tagsOf('#a\u00D7b')],
    [stillNotTags.map(() => []), [], [], [], [], ['a'], ['a\u0663', 'b_c-d', 'x\u0301y'.normalize('NFC').toLowerCase().normalize('NFC')], ['a']]);
  const pathological = [`#a${'-'.repeat(50000)}b`, `#${'a'.repeat(200000)}`, ' #'.repeat(100000), `#a${'\u0301'.repeat(100000)}`, '#a-'.repeat(50000), `${'#'.repeat(100000)}a`, `x #\u0130${'\u0301'.repeat(50000)}`];
  const pathStart = Date.now();
  const pathResults = pathological.map((s) => [tagsOf(s).length, splitNoteText(s).map((p) => p.text).join('') === s]);
  const pathMs = Date.now() - pathStart;
  t('the Unicode grammar stays linear on pathological text (50,000 hyphens, a 200,000-letter tag, 100,000 "#"s, 100,000 combining marks, "#a-" x 50,000): each is read, whole and lossless, and all seven together stay under a generous 5 s bound (it takes about a tenth of a second)',
    [pathResults.map((r) => r[1]), pathResults.map((r) => r[0] >= 0), pathMs < 5000], [pathological.map(() => true), pathological.map(() => true), true]);

  // --- the dialog's wiring (grep-the-source, tolerant to formatting; the live suite checks the behaviour)
  // The pure block is stripped first, so a call inside extractNoteTags / collectNoteTags themselves cannot satisfy these.
  const panelSrc = appSrc.replace(/\/\/ --- NOTES ORGANIZE START ---[\s\S]*?\/\/ --- NOTES ORGANIZE END ---/, '');
  const tagButtonAt = panelSrc.search(/data-note-tag=/);
  const tagButtonSrc = tagButtonAt < 0 ? '' : panelSrc.slice(Math.max(0, tagButtonAt - 300), tagButtonAt + 600);
  t('every place the dialog shows a note\'s text renders it through splitNoteText: it is called outside the pure block, no note text is dropped raw into JSX any more ({n.note} / {otherKind.note}), and at least three note texts are handed to a renderer (list rows, other people\'s notes, "You also have a ... note")',
    [/splitNoteText\(/.test(panelSrc), /\>\s*\{\s*(?:n|otherKind)\.note\s*\}\s*\</.test(panelSrc),
      (panelSrc.match(/(?:[\w$]+\(\s*(?:n|otherKind)\.note\s*\)|=\{\s*(?:n|otherKind)\.note\s*\})/g) || []).length >= 3], [true, false, true]);
  t('a tag in a note is a type="button" button with data-note-tag, aria-pressed and a "Show notes tagged #" title',
    [tagButtonAt >= 0, /type="button"/.test(tagButtonSrc), /aria-pressed=/.test(tagButtonSrc), /Show notes tagged #/.test(tagButtonSrc)], [true, true, true, true]);
  // --- the 2026-10-03 review-fix wiring: the tag bar is fed by buildNoteTagChips inside a useMemo, the bar is height-bounded, the
  // in-note tag is an inline-block button. Grep-style like the checks above (tolerant to whitespace), but structural where the claim
  // is structural (which element contains which), so a button moved into the scrolling list is caught even though every word is still there.
  // Comments are stripped for these checks: a comment may describe the old code ("collectNoteTags(filterNotesForList(listedNotes ...")
  // and must neither satisfy nor break a check on the code.
  const codeSrc = panelSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  // The opening tag that starts at `start` (a "<div" / "<button"): its text and whether it is self-closing. Walks to the first ">" outside
  // {...} expressions and "..." strings, so an arrow function or a template literal inside an attribute does not end it early.
  const openingTagAt = (src, start) => {
    let depth = 0, quote = null;
    for (let i = start + 1; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) return { text: src.slice(start, i + 1), end: i + 1, selfClosing: src[i - 1] === '/' };
    }
    return null;
  };
  // [start, end) of the <div> element whose opening tag contains `marker`, by counting nested divs (self-closing ones do not nest).
  const divElementWith = (src, marker) => {
    const at = src.indexOf(marker);
    if (at < 0) return null;
    const start = src.lastIndexOf('<div', at);
    const open = start < 0 ? null : openingTagAt(src, start);
    if (!open || !open.text.includes(marker)) return null;
    let depth = 1;
    const re = /<div(?=[\s>\/])|<\/div>/g;
    re.lastIndex = open.end;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      if (m[0] === '</div>') { if (--depth === 0) return { start, openText: open.text, bodyStart: open.end, end: m.index + m[0].length }; }
      else { const o = openingTagAt(src, m.index); if (o && !o.selfClosing) depth++; }
    }
    return null;
  };
  const memoCall = /(?:const|let)\s+tagChips\s*=\s*(?:React\.)?useMemo\(\s*\(\)\s*=>\s*buildNoteTagChips\(\s*listedNotes\s*,\s*\{([^{}]*)\}\s*\)\s*,\s*\[([^\]]*)\]\s*\)/.exec(codeSrc);
  const memoDeps = memoCall ? memoCall[2].split(',').map((x) => x.trim()).filter(Boolean) : [];
  // Every input the options object reads ("kind: effKind" -> effKind, shorthand "ageDays" -> ageDays) must be a dependency, else the memo goes stale.
  const memoInputs = memoCall ? memoCall[1].split(',').map((x) => x.trim()).filter(Boolean).map((x) => (x.includes(':') ? x.split(':')[1].trim() : x)) : [];
  const chipCallers = [...codeSrc.matchAll(/\b(collectNoteTags|buildNoteTagChips)\(\s*([^,()]*(?:\([^()]*\))?)/g)].map((m) => [m[1], m[2].trim()]);
  t('the tag bar\'s chips come from buildNoteTagChips(listedNotes, { ... }) inside a useMemo whose dependency list holds listedNotes and noteQuery and every other input the options read; it is the ONLY chip call, and the old direct pool call collectNoteTags(filterNotesForList(listedNotes, ...)) is gone from the dialog',
    [!!memoCall, memoDeps.includes('listedNotes'), memoDeps.includes('noteQuery'), memoInputs.length >= 4 && memoInputs.every((x) => memoDeps.includes(x)),
      chipCallers.filter(([fn]) => fn === 'buildNoteTagChips').length, /collectNoteTags\(\s*filterNotesForList\(/.test(codeSrc)],
    [true, true, true, true, 1, false]);
  t('privacy invariant kept: every chip helper call in the dialog (buildNoteTagChips, and collectNoteTags if one ever comes back) is handed listedNotes -- the notes this viewer may already see -- and never allNotes, notesState, notesForTarget, shownNotes or noteGroups',
    [chipCallers.length >= 1, chipCallers.filter(([, arg]) => arg !== 'listedNotes').map(([fn, arg]) => `${fn}(${arg}`)], [true, []]);
  t('draftTags (the tags the note being typed will be found by) is memoized on the draft text alone: useMemo(() => extractNoteTags(draft), [draft]), not recomputed on every render',
    [/(?:const|let)\s+draftTags\s*=\s*(?:React\.)?useMemo\(\s*\(\)\s*=>\s*extractNoteTags\(\s*draft\s*\)\s*,\s*\[\s*draft\s*\]\s*\)/.test(codeSrc), /(?:const|let)\s+draftTags\s*=\s*extractNoteTags\(/.test(codeSrc)], [true, false]);
  // The memo only helps if listedNotes is the SAME array between renders that change nothing it depends on. allNotes was
  // `[...notesState.notes].sort(...)`, a new array every render; both it and notesInSlicers are memoized now and listedNotes only picks one.
  const allNotesMemo = /const\s+allNotes\s*=\s*useMemo\(\s*\(\)\s*=>[\s\S]*?,\s*\[([^\]]*)\]\s*\)\s*;/.exec(codeSrc);
  const slicersMemo = /const\s+notesInSlicers\s*=\s*useMemo\(\s*\(\)\s*=>[\s\S]*?,\s*\[([^\]]*)\]\s*\)\s*;/.exec(codeSrc);
  t('listedNotes is a STABLE reference, so the chips\' useMemo can hit: allNotes is a useMemo over notesState.notes, notesInSlicers a useMemo over allNotes and visibleVvds, and listedNotes just picks one of the two (a draft keystroke or a VVD-box change rebuilds neither)',
    [!!allNotesMemo && /notesState\.notes/.test(allNotesMemo[1]), !!slicersMemo && /\ballNotes\b/.test(slicersMemo[1]) && /\bvisibleVvds\b/.test(slicersMemo[1]),
      /const\s+listedNotes\s*=\s*showAllNotes\s*\?\s*allNotes\s*:\s*notesInSlicers\s*;/.test(codeSrc)], [true, true, true]);
  const barEl = divElementWith(codeSrc, 'data-notes-tagbar');
  const listEl = divElementWith(codeSrc, 'data-notes-tag-list');
  const moreAt = codeSrc.indexOf('data-notes-tag-more');
  const chipAt = codeSrc.indexOf('data-notes-tag-chip=');
  const listClass = listEl ? listEl.openText : '';
  t('the tag bar is height-bounded (finding 1): the chips live in div[data-notes-tag-list], which has a max-h-* cap other than none and overflow-y-auto so it scrolls inside itself, and that list sits inside the div[data-notes-tagbar] group',
    [!!barEl, !!listEl, /\bmax-h-(?!none\b)[\w\[\].-]+/.test(listClass), /\boverflow-y-auto\b/.test(listClass), !!barEl && !!listEl && listEl.start > barEl.start && listEl.end < barEl.end,
      !!listEl && chipAt > listEl.bodyStart && chipAt < listEl.end],
    [true, true, true, true, true, true]);
  t('the "Show all / Show fewer" button is a SIBLING of the scrolling list, never inside it (it would scroll out of sight with the chips): data-notes-tag-more comes after the list element has closed, and still inside the tag bar',
    [!!listEl && !!barEl && moreAt >= 0, !!listEl && moreAt >= listEl.end, !!barEl && moreAt > 0 && moreAt < barEl.end, /\bflex-none\b/.test(codeSrc.slice(Math.max(0, moreAt - 200), moreAt + 400))],
    [true, true, true, true]);
  // data-notes-tag-empty: present only on a chip that would list nothing and is not pressed (count 0, not pressed); dimmed with the same condition.
  const emptyAttr = /data-notes-tag-empty=\{\s*([\w$.!&\s=]+?)\s*\?\s*(['"])true\2\s*:\s*(undefined|null|false)\s*\}/.exec(codeSrc);
  const emptyDef = emptyAttr && /^[\w$]+$/.test(emptyAttr[1]) ? new RegExp(`(?:const|let)\\s+${emptyAttr[1].replace(/\$/g, '\\$')}\\s*=\\s*([^;]+);`).exec(codeSrc.slice(0, emptyAttr.index)) : null;
  const emptyCond = emptyAttr ? (emptyDef ? emptyDef[1] : emptyAttr[1]) : '';
  const emptyOk = /\b(?:\w+\.)?count\s*===?\s*0\b/.test(emptyCond) && /!\s*(?:\w+\.)?pressed\b/.test(emptyCond) && /&&/.test(emptyCond);
  t('data-notes-tag-empty="true" is emitted only for a chip that is empty AND not pressed (condition: count === 0 && !pressed, otherwise the attribute is absent), the same condition dims it (opacity-50), and it is never an unconditional attribute',
    [!!emptyAttr, emptyOk, !!emptyAttr && new RegExp(`${emptyAttr[1].replace(/\$/g, '\\$')}\\s*\\?\\s*['"\`]\\s*opacity-50`).test(codeSrc), /data-notes-tag-empty=(?:""|"true"|'true')/.test(codeSrc)],
    [true, true, true, false]);
  // The number on a chip is chip.count (what a click lists), never chip.total (the kind + age pool). The chips are destructured in the map
  // callback, so a bare `count` that was destructured from the chip counts as chip.count; `total` must not be rendered anywhere in the bar.
  const countSpan = /data-notes-tag-count(?:=""|=\{[^}]*\})?[^>]*>\s*\{\s*([\w$.]+)\s*\}\s*<\/span>/.exec(codeSrc);
  const chipMap = listEl ? /\.map\(\s*\(?\s*(?:\{([^}]*)\}|([\w$]+))\s*\)?\s*=>/.exec(codeSrc.slice(listEl.bodyStart, listEl.end)) : null;
  const countFromChip = !!countSpan && (countSpan[1] === 'chip.count' || (countSpan[1] === 'count' && !!chipMap && !!chipMap[1] && /\bcount\b/.test(chipMap[1]))
    || (!!chipMap && !!chipMap[2] && countSpan[1] === `${chipMap[2]}.count`));
  t('the number on a chip is chip.count (what a click lists), not total: the data-notes-tag-count span renders the count taken from the chip, and nothing in the tag list renders total',
    [!!countSpan, countFromChip, !!listEl && !/\btotal\b/.test(codeSrc.slice(listEl.start, listEl.end))], [true, true, true]);
  // The in-note tag stays a native <button> (keyboard + screen reader for free). A <button> is laid out inline-block whatever class it is
  // given, so the old `inline` class (and the comment promising it "wraps with the words around it") was false.
  const noteTagAt = codeSrc.indexOf('data-note-tag=');
  const noteTagBtnStart = noteTagAt < 0 ? -1 : codeSrc.lastIndexOf('<button', noteTagAt);
  const noteTagBtn = noteTagBtnStart < 0 ? null : openingTagAt(codeSrc, noteTagBtnStart);
  const noteTagClassRaw = noteTagBtn ? (/className=\{?\s*[`"']([^`"'$]*)/.exec(noteTagBtn.text) || [])[1] || '' : '';
  const noteTagClasses = noteTagClassRaw.split(/\s+/).filter(Boolean);
  t('the in-note tag button is a native button laid out as inline-block (finding 6): its class has inline-block, max-w-full and align-baseline and NOT the bare "inline" class, and the comment no longer claims it "wraps with the words around it"',
    [!!noteTagBtn && /^<button\b/.test(noteTagBtn.text), noteTagClasses.includes('inline-block'), noteTagClasses.includes('max-w-full'), noteTagClasses.includes('align-baseline'), noteTagClasses.includes('inline'), /wraps with the words/i.test(panelSrc)],
    [true, true, true, true, false, false]);
  t('clicking a tag or a chip toggles it in the search box (setNoteQuery with toggleNoteQueryTag), and a tag counts as pressed by reading the query with parseNoteQuery(noteQuery)',
    [/setNoteQuery\(\s*\(?\s*[\w$]+\s*\)?\s*=>\s*toggleNoteQueryTag\(\s*[\w$]+\s*,\s*[\w$.]+\s*\)\s*\)/.test(panelSrc), /parseNoteQuery\(\s*noteQuery\s*\)/.test(panelSrc)], [true, true]);
  t('the editor shows the tags of the draft (extractNoteTags(draft)) as data-note-draft-tags, or the data-note-draft-tags-hint tip when it has none',
    [/extractNoteTags\(\s*draft\s*\)/.test(panelSrc), /data-note-draft-tags-hint/.test(panelSrc), /data-note-draft-tags(?![-\w])/.test(panelSrc)], [true, true, true]);
  t('the tag bar, its chips, the "N more" toggle, the new placeholder, the "No notes are tagged" message and the intro sentence are all in the dialog',
    [/data-notes-tagbar/.test(panelSrc), /Filter notes by tag/.test(panelSrc), /data-notes-tag-chip=/.test(panelSrc), /data-notes-tag-count/.test(panelSrc), /data-notes-tag-more/.test(panelSrc),
      /Search VVD, text, author or #tag/.test(panelSrc), /No notes are tagged\s/.test(panelSrc), /Add #tags \(like #rolled\) to a note to find it later\./.test(panelSrc)],
    [true, true, true, true, true, true, true, true]);
}

const EXPECTED = 337;
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

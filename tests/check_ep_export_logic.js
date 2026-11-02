/**
 * Headless check for Empty Planning's EP_EXPORT read (D84 slice 2a-4, research idea X-4, ADR-R2; 2026-10-30):
 * apps-script/DataFeeds.gs parseEpExportCsv_, epExportCsvUrl_, refreshEpExport_, readEpExport_, withEpExport_,
 * refreshEpExportNow, and the getDataFeed wrapper.
 *
 * What the feature does: when the Script Property bfrEpExportUrl is set, the refresh trigger (refreshDataFeeds, which runs
 * as the admin) also fetches the EP_EXPORT tab as CSV, parses exactly the C3 columns of VPT's
 * new Build/docs/waves/WAVE_EP_2026-10-29.md, caches the rows, and getDataFeed's reply for 'live' carries
 * epExport: {rows, fetchedAt, hash, error?}. With the property unset the reply is exactly getDataFeedMain_'s.
 *
 * Runs the REAL apps-script/DataFeeds.gs under Node in a vm with in-memory fakes for CacheService, PropertiesService,
 * UrlFetchApp, ScriptApp.getOAuthToken, Utilities (real MD5 / gzip / base64 from node), Session, console and the Code.gs
 * helpers DataFeeds.gs calls (assertArchiveAdmin_, fetchArchiveCsv_, ARCHIVE_REQUIRED_COLUMN_). The clock is frozen.
 * What the fakes cannot prove: that Google serves the export URL to the admin's token, or what the real EP_EXPORT holds;
 * the /exec checklist in apps-script/README.md covers that (UNCONFIRMED until Kevin runs it).
 *
 * The fixture tests/fixtures/ep_export_sample.csv is SYNTHETIC (made up to the C3 contract; every remark says so), not a
 * real export.
 *
 * Run:  node tests/check_ep_export_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const feedsSrc = fs.readFileSync(path.join(root, 'apps-script', 'DataFeeds.gs'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'ep_export_sample.csv'), 'utf8');

let pass = 0;
const failures = [];
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`);
    console.log(`  FAIL ${name}`);
  }
}
const same = (got, want, msg) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${msg || 'values differ'}\n  got:  ${a}\n  want: ${b}`);
};
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'expected a truthy value'); };

const START_MS = Date.parse('2026-10-29T14:00:00Z'); // 10:00 in New York: busy hours
const QUIET_MS = Date.parse('2026-10-30T02:00:00Z'); // 22:00 in New York: quiet hours
const LIVE_CSV = 'Vessel 1st VVD,POL,Note\nCIKT0014W,USHOU,one\nOIST0090W,USLAX,two\n';
const SECTOR_CSV = 'Sector,Value\nA,1\n';
const EDITOR_URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=777';
const EXPORT_URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=csv&gid=777';
const PUB_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vEpExportKey_abc-123/pubhtml?gid=55&single=true';
const PUB_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vEpExportKey_abc-123/pub?gid=55&single=true&output=csv';
const COLS = ['as_of', 'vvd', 'lane', 'group', 'port', 'port_key', 'terminal', 'terminal_name', 'empties', 'export_laden',
  'prelim_dec', 'prelim_teu', 'final_dec', 'final_teu', 'cutoff', 'etd', 'note', 'remark'];

const toBuf = (bytes) => (Buffer.isBuffer(bytes) ? bytes : typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes.map((b) => (b + 256) % 256)));
const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
function makeBlob(data, contentType, name) {
  const buf = toBuf(data);
  return { getBytes: () => toSigned(buf), getDataAsString: () => buf.toString('utf8'), getContentType: () => contentType, getName: () => name, _buf: () => buf };
}

function makeEnv() {
  const env = {
    nowMs: START_MS, scriptProps: {}, cache: {}, fetches: [], ep: { code: 200, text: FIXTURE }, epThrow: null,
    propReads: 0, logs: [], warns: [], adminChecks: 0,
    triggers: [{ handler: 'refreshDataFeeds', uid: 'trig-42' }], asVisitor: false, tokenReads: 0, lockTries: [], lockBusy: false, lockHeld: false,
  };
  const cacheApi = {
    get: (k) => { const e = env.cache[k]; return e && e.exp > env.nowMs ? e.v : null; },
    getAll: (keys) => { const out = {}; keys.forEach((k) => { const v = cacheApi.get(k); if (v !== null) out[k] = v; }); return out; },
    put: (k, v, sec) => {
      if (String(v).length > 100 * 1024) throw new Error('Argument too large: value');
      env.cache[k] = { v: String(v), exp: env.nowMs + (sec || 600) * 1000 };
    },
    putAll: (obj, sec) => Object.keys(obj).forEach((k) => cacheApi.put(k, obj[k], sec)),
    remove: (k) => { delete env.cache[k]; },
  };
  const propsApi = {
    getProperty: (k) => { env.propReads++; return Object.prototype.hasOwnProperty.call(env.scriptProps, k) ? env.scriptProps[k] : null; },
    setProperty: (k, v) => { env.scriptProps[k] = String(v); },
    deleteProperty: (k) => { delete env.scriptProps[k]; },
  };
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(env.nowMs); else super(...a); }
    static now() { return env.nowMs; }
  }
  const Utilities = {
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, text) => toSigned(crypto.createHash('md5').update(toBuf(text)).digest()),
    newBlob: (data, contentType, name) => makeBlob(data, contentType, name),
    gzip: (blob) => makeBlob(zlib.gzipSync(blob._buf()), 'application/x-gzip', 'data.gz'),
    ungzip: (blob) => makeBlob(zlib.gunzipSync(blob._buf()), 'application/octet-stream', 'data'),
    base64Encode: (bytes) => toBuf(bytes).toString('base64'),
    base64Decode: (s) => toSigned(Buffer.from(String(s), 'base64')),
    sleep: () => {},
    formatDate: (date, tz, fmt) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
        .formatToParts(date).map((p) => [p.type, p.value]));
      if (fmt === 'H') return String(Number(parts.hour));
      if (fmt === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
      throw new Error('formatDate: unsupported pattern ' + fmt);
    },
  };
  const sandbox = {
    console: {
      log: (...a) => { env.logs.push(a.join(' ')); },
      info: (...a) => { env.logs.push(a.join(' ')); },
      warn: (...a) => { env.warns.push(a.join(' ')); },
      error: (...a) => { env.warns.push(a.join(' ')); },
    },
    Date: FakeDate,
    CacheService: { getScriptCache: () => cacheApi },
    PropertiesService: { getScriptProperties: () => propsApi },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities,
    UrlFetchApp: {
      fetch: (url, params) => {
        env.fetches.push({ url, params: JSON.parse(JSON.stringify(params || null)) });
        if (env.epThrow) throw new Error(env.epThrow);
        return { getResponseCode: () => env.ep.code, getContentText: () => env.ep.text };
      },
    },
    // getProjectTriggers lists only the EFFECTIVE user's installed triggers (Apps Script's rule): the admin owns one
    // refreshDataFeeds trigger; a visitor (env.asVisitor) owns none.
    ScriptApp: {
      getOAuthToken: () => { env.tokenReads++; return env.asVisitor ? 'visitor-token' : 'admin-token-xyz'; },
      getProjectTriggers: () => (env.asVisitor ? [] : env.triggers.map((x) => ({ getHandlerFunction: () => x.handler, getUniqueId: () => x.uid }))),
      newTrigger: () => { throw new Error('not used'); },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (ms) => { env.lockTries.push(ms); if (env.lockBusy) return false; env.lockHeld = true; return true; },
        releaseLock: () => { env.lockHeld = false; },
      }),
    },
    ARCHIVE_REQUIRED_COLUMN_: 'Vessel 1st VVD',
    assertArchiveAdmin_: () => { env.adminChecks++; if (env.adminFails) throw new Error('Only the archive admin can run this.'); return 'admin@corp.com'; },
    fetchArchiveCsv_: (url) => {
      const urls = vm.runInContext('DATA_FEED_URLS_', ctx);
      if (url === urls.live) return LIVE_CSV;
      if (url === urls.sector) return SECTOR_CSV;
      throw new Error('unexpected url ' + url);
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(feedsSrc, ctx, { filename: 'DataFeeds.gs' });
  env.call = (fn, ...args) => ctx[fn](...args);
  // The installed time trigger's run: Apps Script passes an event with the trigger's uid.
  env.trig = () => env.call('refreshDataFeeds', { triggerUid: 'trig-42', authMode: 'FULL' });
  env.hasFn = (fn) => typeof ctx[fn] === 'function';
  env.on = (url) => { env.scriptProps.bfrEpExportUrl = url || EDITOR_URL; };
  env.epKeys = () => Object.keys(env.cache).filter((k) => /^bfrFeed:epExport:/.test(k));
  return env;
}

const fixtureRows = () => makeEnv().call('parseEpExportCsv_', FIXTURE);
const LIVE_REQ = { name: 'live', have: null, gzip: false };

console.log('Empty Planning EP_EXPORT (DataFeeds.gs, D84 slice 2a-4)');

t('the functions exist', () => {
  const env = makeEnv();
  ['parseEpExportCsv_', 'parseCsvRecords_', 'epExportCsvUrl_', 'refreshEpExport_', 'readEpExport_', 'withEpExport_',
    'epExportConfigured_', 'refreshEpExportNow', 'getDataFeedMain_', 'getDataFeed'].forEach((fn) => truthy(env.hasFn(fn), fn + ' is missing'));
});

if (!failures.length) {
  // ---------------------------------------------------------------- key unset: nothing changes
  t('key unset: getDataFeed replies are identical (same keys, same order, same values) to getDataFeedMain_ for every reply shape', () => {
    const a = makeEnv();
    const b = makeEnv();
    const reqs = [
      { name: 'live', have: null, gzip: false },       // cold: download
      { name: 'live', have: null, gzip: true },        // warm: cached, gzip
      null,                                            // the hash is filled in below: unchanged
      { name: 'live', have: null, gzip: false, notOlderThanMs: 0 }, // older
      { name: 'sector', have: null, gzip: false },
      { name: 'nope' }, 'garbage', { name: 'live', have: 5 },
    ];
    let hash = null;
    reqs.forEach((req, i) => {
      a.nowMs += 1000; b.nowMs += 1000;
      const r = req === null ? { name: 'live', have: hash, gzip: false } : req;
      const ra = a.call('getDataFeed', r);
      const rb = b.call('getDataFeedMain_', r);
      same(JSON.stringify(ra), JSON.stringify(rb), 'reply ' + i + ' differs');
      same(Object.keys(ra || {}).indexOf('epExport'), -1, 'reply ' + i + ' has epExport');
      if (ra && ra.hash) hash = ra.hash;
    });
  });

  t('key unset: refreshDataFeeds makes no EP fetch and writes no EP cache entry or property', () => {
    const env = makeEnv();
    env.trig();
    env.trig();
    same(env.fetches.length, 0, 'UrlFetchApp called');
    same(env.epKeys(), [], 'EP cache keys written by the trigger');
    same(Object.keys(env.scriptProps), [], 'script properties written');
    same(env.call('refreshEpExport_', {}), { ok: true, reason: 'off' });
  });

  t('key unset: a visitor poll reads Script Properties at most once per 10 minutes (cfg flag)', () => {
    const env = makeEnv();
    env.call('getDataFeed', LIVE_REQ);
    const after1 = env.propReads;
    for (let i = 0; i < 5; i++) env.call('getDataFeed', LIVE_REQ);
    same(env.propReads, after1, 'more property reads within the flag lifetime');
    same(after1, 1, 'one property read for the first poll');
  });

  // ---------------------------------------------------------------- parsing
  t('fixture: 6 rows, every column present, TEU columns numbers or null, blanks null, quotes/commas/newlines kept', () => {
    const p = fixtureRows();
    same(p.ok, true);
    same(p.rows.length, 6, 'row count (one quoted cell holds a newline)');
    same(p.skipped, 0); same(p.badNumbers, 0);
    p.rows.forEach((r) => same(Object.keys(r), COLS, 'row keys in contract order'));
    same(p.rows[0], { as_of: '2026-10-29', vvd: 'CIKT0014W', lane: 'EC4', group: 'EC', port: 'USHOU', port_key: 'USHOU#1', terminal: 'USHOU05',
      terminal_name: 'MAHER', empties: 2188, export_laden: 975, prelim_dec: '2026-10-15', prelim_teu: 1200, final_dec: '2026-10-22', final_teu: 1950,
      cutoff: '2026-10-23', etd: '2026-10-26', note: '40xR5', remark: 'SYNTHETIC fixture: ROD omit' });
    same(p.rows[1].note, null, 'blank note is null');
    same(p.rows[2].note, '40xR5, 20xR2', 'quoted comma');
    same([p.rows[2].final_dec, p.rows[2].final_teu], [null, null], 'blank date and TEU are null');
    same(p.rows[3].note, 'split call:\nsecond line of the note', 'quoted newline');
    same([p.rows[3].port_key, p.rows[3].empties, p.rows[3].prelim_teu], [null, null, null]);
    same(p.rows[4].note, 'quote "as declared"', 'escaped quotes');
    same(p.rows[5].vvd, 'MOLT0072W');
    truthy(p.rows.every((r) => /SYNTHETIC/.test(r.remark)), 'every fixture row is labelled synthetic');
  });

  t('column order, header case and spacing, CRLF, a BOM and an extra column do not change the rows', () => {
    const p = fixtureRows();
    const order = COLS.slice().reverse();
    const q = (v) => (v === null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const lines = ['﻿' + order.map((c) => ' ' + c.toUpperCase() + ' ').join(',') + ',extra_col'];
    p.rows.forEach((r) => lines.push(order.map((c) => q(r[c])).join(',') + ',zzz'));
    const p2 = makeEnv().call('parseEpExportCsv_', lines.join('\r\n') + '\r\n');
    same(p2.ok, true, JSON.stringify(p2.error));
    same(p2.rows, p.rows);
  });

  t('a missing required column is rejected with its name; nothing is parsed', () => {
    const env = makeEnv();
    const noFinal = FIXTURE.replace(',final_teu,', ',final_teu_x,');
    const r = env.call('parseEpExportCsv_', noFinal);
    same(r.ok, false);
    truthy(/missing column\(s\): final_teu$/.test(r.error), r.error);
    const two = env.call('parseEpExportCsv_', 'vvd,port\nCIKT0014W,USHOU\n');
    truthy(/as_of/.test(two.error) && /remark/.test(two.error) && !/\bvvd\b/.test(two.error.replace(/^[^:]*:/, '')), two.error);
  });

  t('rows without a vvd are skipped, blank lines ignored, a TEU that is not a plain number becomes null and is counted', () => {
    const head = COLS.join(',');
    const row = (over) => COLS.map((c) => (over[c] !== undefined ? over[c] : '')).join(',');
    const csv = [head, row({ vvd: 'AAAA0001W', empties: '1200', final_teu: 'TBD' }), '', row({ port: 'USHOU' }), ',,,,', row({ vvd: 'BBBB0002E', export_laden: '12.5', prelim_teu: '-3' })].join('\n');
    const r = makeEnv().call('parseEpExportCsv_', csv);
    same(r.ok, true);
    same(r.rows.map((x) => x.vvd), ['AAAA0001W', 'BBBB0002E']);
    same([r.rows[0].empties, r.rows[0].final_teu, r.rows[1].export_laden, r.rows[1].prelim_teu], [1200, null, 12.5, -3]);
    same([r.skipped, r.badNumbers], [1, 1]);
  });

  t('not a CSV: empty, an HTML sign-in page, a non-string', () => {
    const env = makeEnv();
    same(env.call('parseEpExportCsv_', '').ok, false);
    truthy(/HTML/.test(env.call('parseEpExportCsv_', '  <!DOCTYPE html><html>Sign in</html>').error));
    same(env.call('parseEpExportCsv_', null).ok, false);
  });

  // ---------------------------------------------------------------- URL handling (security)
  t('URL: an editor URL becomes the CSV export of that gid, fetched with the admin token; a publish URL is fetched with no token', () => {
    const env = makeEnv();
    same(env.call('epExportCsvUrl_', EDITOR_URL), { url: EXPORT_URL, auth: true });
    same(env.call('epExportCsvUrl_', PUB_URL), { url: PUB_CSV_URL, auth: false });
    same(env.call('epExportCsvUrl_', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?usp=sharing'),
      { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=csv', auth: true });
    env.on(EDITOR_URL);
    env.trig();
    same(env.fetches.map((f) => f.url), [EXPORT_URL]);
    same(env.fetches[0].params.headers, { Authorization: 'Bearer admin-token-xyz' });
    const pub = makeEnv();
    pub.on(PUB_URL);
    pub.trig();
    same(pub.fetches.map((f) => f.url), [PUB_CSV_URL]);
    same(pub.fetches[0].params.headers, undefined, 'no token sent to a publish URL');
  });

  t('URL: anything but https://docs.google.com/spreadsheets/d/<id> is refused before any fetch (the token never leaves)', () => {
    const bad = [
      'http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://docs.google.com.evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://docs.google.com@evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://evil.example/https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view',
      'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://docs.google.com/spreadsheets/d/short/edit',
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789.evil.example/edit',
      'javascript:alert(1)',
    ];
    bad.forEach((u) => {
      const env = makeEnv();
      truthy(env.call('epExportCsvUrl_', u).error, 'accepted: ' + u);
      env.on(u);
      const r = env.call('refreshEpExport_', {});
      same(r.ok, false, u);
      same(env.fetches.length, 0, 'fetched for ' + u);
      const reply = env.call('getDataFeed', LIVE_REQ);
      truthy(/docs\.google\.com/.test(reply.epExport.error), 'reply error explains the URL rule: ' + reply.epExport.error);
    });
  });

  // ---------------------------------------------------------------- the cache path
  t('key set: the trigger fetches once, getDataFeed (live) carries {rows, fetchedAt, hash} from the cache with no fetch of its own', () => {
    const env = makeEnv();
    env.on();
    env.trig();
    same(env.fetches.length, 1, 'one fetch by the trigger');
    const main = makeEnv().call('getDataFeedMain_', LIVE_REQ);
    const reply = env.call('getDataFeed', LIVE_REQ);
    same(env.fetches.length, 1, 'getDataFeed fetched');
    same(reply.epExport.rows, fixtureRows().rows);
    same(reply.epExport.fetchedAt, new Date(START_MS).toISOString());
    truthy(/^[0-9a-f]{32}$/.test(reply.epExport.hash), 'hash');
    same(reply.epExport.error, undefined);
    // Every other field is what the main reply says (the live feed was cached by the same trigger run).
    const rest = Object.assign({}, reply); delete rest.epExport;
    same(Object.keys(rest), Object.keys(main), 'main reply keys and order');
    same(rest.data, LIVE_CSV);
    same(Object.keys(reply)[Object.keys(reply).length - 1], 'epExport', 'epExport is added last');
    // Sector replies never carry it.
    same(env.call('getDataFeed', { name: 'sector', have: null, gzip: false }).epExport, undefined);
    // An invalid live request is not decorated.
    same(env.call('getDataFeed', { name: 'live', have: 99 }), { ok: false, reason: 'invalid-request' });
  });

  t('cache path: haveEp equal to the hash gives {unchanged, fetchedAt, hash} with no rows; a stale haveEp gets rows', () => {
    const env = makeEnv();
    env.on();
    env.trig();
    const first = env.call('getDataFeed', LIVE_REQ).epExport;
    const again = env.call('getDataFeed', Object.assign({ haveEp: first.hash }, LIVE_REQ)).epExport;
    same(again, { unchanged: true, fetchedAt: first.fetchedAt, hash: first.hash });
    same(env.call('getDataFeed', Object.assign({ haveEp: 'old' }, LIVE_REQ)).epExport.rows.length, 6);
  });

  t('cache path: the copy is chunked under bfrFeed:epExport and survives a size well over one 100 KB cache value', () => {
    const env = makeEnv();
    env.on();
    const lines = [COLS.join(',')];
    for (let i = 0; i < 4000; i++) lines.push(COLS.map((c) => (c === 'vvd' ? 'V' + String(i).padStart(6, '0') + 'W' : c === 'empties' ? String(i) : c === 'note' ? crypto.randomBytes(48).toString('hex') : 'x')).join(','));
    env.ep.text = lines.join('\n');
    same(env.call('refreshEpExport_', {}).ok, true);
    const meta = JSON.parse(env.cache['bfrFeed:epExport:meta'].v);
    truthy(meta.chunks >= 2 && meta.v === 1, 'expected at least 2 chunks, got ' + meta.chunks);
    const reply = env.call('getDataFeed', LIVE_REQ).epExport;
    same(reply.rows.length, 4000);
    same(reply.rows[3999].empties, 3999);
    // Over the row cap: refused, not cached.
    const big = makeEnv();
    big.on();
    big.ep.text = lines.concat(lines.slice(1, 1002)).join('\n');
    truthy(/more than 5000 rows/.test(big.call('refreshEpExport_', {}).error), 'row cap');
    same(big.cache['bfrFeed:epExport:meta'], undefined, 'nothing cached over the cap');
  });

  t('fetch error (HTTP 500, then a thrown error): logged, the main feed is untouched, the reply gives a fixed code', () => {
    ['http', 'throw'].forEach((how) => {
      const env = makeEnv();
      env.on();
      if (how === 'http') env.ep = { code: 500, text: 'oops' }; else env.epThrow = 'Address unavailable: ' + EXPORT_URL;
      let threw = null;
      try { env.trig(); } catch (err) { threw = err; }
      same(threw, null, 'refreshDataFeeds threw');
      truthy(env.warns.some((w) => /epExport|EP_EXPORT/.test(w)), 'logged');
      const reply = env.call('getDataFeed', LIVE_REQ);
      same(reply.ok, true, 'main feed still ok');
      same(reply.data, LIVE_CSV, 'main data still served');
      same(reply.epExport.rows, []); same(reply.epExport.fetchedAt, null);
      same(reply.epExport.error, how === 'http' ? 'http 500' : 'fetch failed');
    });
  });

  t('a missing column on the live sheet: logged, reply {rows:[], fetchedAt:null, error names the column}', () => {
    const env = makeEnv();
    env.on();
    env.ep.text = FIXTURE.replace(',prelim_teu,', ',prelim_teu_old,');
    env.trig();
    const ep = env.call('getDataFeed', LIVE_REQ).epExport;
    same([ep.rows, ep.fetchedAt], [[], null]);
    truthy(/missing column\(s\): prelim_teu/.test(ep.error), ep.error);
    truthy(env.warns.some((w) => /prelim_teu/.test(w)), 'logged');
  });

  t('a later failure keeps the last good rows and adds error; a success clears it; after 3 hours of failures rows are []', () => {
    const env = makeEnv();
    env.on();
    env.trig();
    const good = env.call('getDataFeed', LIVE_REQ).epExport;
    env.nowMs += 30 * 60 * 1000;
    env.ep = { code: 403, text: '' };
    env.trig();
    const kept = env.call('getDataFeed', LIVE_REQ).epExport;
    same([kept.rows.length, kept.fetchedAt, kept.hash], [6, good.fetchedAt, good.hash]);
    same(kept.error, 'http 403', 'error shown with the kept rows');
    env.nowMs += 30 * 60 * 1000;
    env.ep = { code: 200, text: FIXTURE };
    env.trig();
    const fresh = env.call('getDataFeed', LIVE_REQ).epExport;
    same(fresh.error, undefined, 'error cleared'); same(fresh.fetchedAt, new Date(env.nowMs).toISOString());
    env.ep = { code: 500, text: '' };
    for (let i = 0; i < 7; i++) { env.nowMs += 30 * 60 * 1000; env.trig(); }
    const gone = env.call('getDataFeed', LIVE_REQ).epExport;
    same([gone.rows, gone.fetchedAt], [[], null]);
    same(gone.error, 'http 500');
  });

  t('key set but the trigger has not run: the reply says so, and the visitor path still makes no fetch', () => {
    const env = makeEnv();
    env.on();
    const ep = env.call('getDataFeed', LIVE_REQ).epExport;
    same([ep.rows, ep.fetchedAt], [[], null]);
    truthy(/not fetched yet/.test(ep.error));
    same(env.fetches.length, 0);
  });

  t('quiet hours: a copy younger than the quiet skip is not re-fetched; refreshEpExportNow forces a fetch and checks the admin', () => {
    const env = makeEnv();
    env.nowMs = QUIET_MS;
    env.on();
    env.trig();
    env.nowMs += 30 * 60 * 1000;
    env.trig();
    same(env.fetches.length, 1, 'second quiet run skipped');
    const r = env.call('refreshEpExportNow');
    same([r.ok, r.rows, env.fetches.length, env.adminChecks], [true, 6, 2, 1]);
    env.adminFails = true;
    let threw = null;
    try { env.call('refreshEpExportNow'); } catch (err) { threw = err; }
    truthy(threw, 'a non-admin is refused');
    same(env.fetches.length, 2, 'no fetch for a non-admin');
  });

  t('clearing the property: the next trigger run turns it off and replies are back to the main shape', () => {
    const env = makeEnv();
    env.on();
    env.trig();
    truthy(env.call('getDataFeed', LIVE_REQ).epExport, 'on');
    delete env.scriptProps.bfrEpExportUrl;
    env.trig();
    same(env.call('getDataFeed', LIVE_REQ).epExport, undefined, 'still decorated after the property was cleared');
  });

  t('review (a): a visitor calling refreshDataFeeds through google.script.run (no event, a forged uid, or any object) never fetches, reads no token, writes no EP key; the other feeds still refresh', () => {
    [undefined, null, {}, { triggerUid: 'trig-42' }, { triggerUid: 'trig-42', authMode: 'FULL' }, 'trig-42', { triggerUid: '' }].forEach((ev, i) => {
      const env = makeEnv();
      env.on();
      env.asVisitor = true; // runs as the visitor: getProjectTriggers lists none of theirs
      let threw = null;
      try { env.call('refreshDataFeeds', ev); } catch (err) { threw = err; }
      same(threw, null, 'case ' + i + ' threw');
      same([env.fetches.length, env.tokenReads, env.lockTries.length], [0, 0, 0], 'case ' + i + ': fetch / token / lock');
      same(env.epKeys(), [], 'case ' + i + ': EP cache keys written');
      truthy(env.cache['bfrFeed:live:meta'], 'case ' + i + ': the live feed still refreshed (rule 8)');
    });
    // The admin calling it by hand (installDataFeedTrigger does: no event) also skips the EP step; refreshEpExportNow is the manual path.
    const admin = makeEnv();
    admin.on();
    admin.call('refreshDataFeeds');
    same([admin.fetches.length, admin.epKeys()], [0, []], 'no event, even as the admin');
    // A uid that is not a refreshDataFeeds trigger of the admin's does not count either.
    const other = makeEnv();
    other.on();
    other.triggers = [{ handler: 'snapshotLiveDataToArchive', uid: 'trig-42' }];
    other.trig();
    same(other.fetches.length, 0, 'a uid of another handler');
  });

  t('review (a): the installed trigger\'s own event fetches, under the script lock, and releases it', () => {
    const env = makeEnv();
    env.on();
    env.trig();
    same(env.fetches.length, 1);
    same(env.tokenReads, 1);
    same(env.lockTries, [5000], 'one tryLock with a short wait');
    same(env.lockHeld, false, 'lock released');
    env.ep = { code: 500, text: '' };
    env.call('refreshEpExport_', {});
    same(env.lockHeld, false, 'lock released after a failure too');
  });

  t('review (a): a held lock means a skip: no fetch, no token, no EP cache or error write; the last copy stays', () => {
    const env = makeEnv();
    env.on();
    env.trig();
    const before = JSON.stringify(Object.entries(env.cache).filter(([k]) => /epExport:(meta|error|\d)/.test(k)));
    env.lockBusy = true;
    env.ep = { code: 500, text: '' };
    env.nowMs += 30 * 60 * 1000;
    const r = env.call('refreshEpExport_', {});
    same(r, { ok: true, reason: 'busy' });
    same([env.fetches.length, env.tokenReads], [1, 1], 'no second fetch');
    same(JSON.stringify(Object.entries(env.cache).filter(([k]) => /epExport:(meta|error|\d)/.test(k))), before, 'EP cache changed');
    same(env.call('getDataFeed', LIVE_REQ).epExport.error, undefined, 'no error shown for a skipped run');
  });

  t('review (b): an error that contains the fetched URL never reaches the reply (no http, no sheet id, no publish key); the detail is logged', () => {
    [[EDITOR_URL, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', EXPORT_URL], [PUB_URL, '2PACX-1vEpExportKey_abc-123', PUB_CSV_URL]].forEach(([stored, secret, fetched]) => {
      ['Address unavailable: ', 'Timeout: ', 'Exception: Request failed for ' ].forEach((prefix) => {
        const env = makeEnv();
        env.on(stored);
        env.epThrow = prefix + fetched;
        env.trig();
        const err = env.call('getDataFeed', LIVE_REQ).epExport.error;
        same(err, 'fetch failed');
        truthy(!/http/i.test(err) && err.indexOf(secret) === -1 && err.indexOf('docs.google') === -1, 'leaked: ' + err);
        truthy(env.warns.some((w) => w.indexOf(fetched) !== -1), 'the detail is in the log');
        const cached = env.cache['bfrFeed:epExport:error'].v;
        truthy(cached.indexOf(secret) === -1 && !/https?:/.test(cached), 'the cached error holds the URL: ' + cached);
      });
    });
    // Every other failure the reply can show is a fixed code too.
    const env = makeEnv();
    env.on();
    env.ep = { code: 200, text: '<html>Sign in ' + EXPORT_URL + '</html>' };
    env.trig();
    const html = env.call('getDataFeed', LIVE_REQ).epExport.error;
    truthy(html.indexOf('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789') === -1 && !/https?:/.test(html), html);
  });

  t('visitor paths never fetch or use a token (source check); only the trigger and refreshEpExportNow call refreshEpExport_', () => {
    ['getDataFeed', 'getDataFeedMain_', 'withEpExport_', 'readEpExport_', 'epExportConfigured_'].forEach((fn) => {
      const m = feedsSrc.match(new RegExp('\\nfunction ' + fn + '\\([\\s\\S]*?\\n\\}\\n'));
      truthy(m, 'could not find ' + fn);
      truthy(!/UrlFetchApp|getOAuthToken|refreshEpExport_|fetchArchiveCsv_\(\s*EP/.test(m[0]), fn + ' fetches or refreshes EP_EXPORT');
    });
    const callers = [];
    const fnRe = /\nfunction (\w+)\([^)]*\) \{[\s\S]*?\n\}\n/g;
    let m;
    while ((m = fnRe.exec(feedsSrc))) if (m[1] !== 'refreshEpExport_' && /refreshEpExport_\s*\(/.test(m[0])) callers.push(m[1]);
    same(callers.sort(), ['refreshDataFeeds', 'refreshEpExportNow']);
    const tokenUsers = [];
    const re2 = /\nfunction (\w+)\([^)]*\) \{[\s\S]*?\n\}\n/g;
    while ((m = re2.exec(feedsSrc))) if (/getOAuthToken/.test(m[0])) tokenUsers.push(m[1]);
    same(tokenUsers, ['refreshEpExport_'], 'only refreshEpExport_ uses the token');
  });
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILED:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}

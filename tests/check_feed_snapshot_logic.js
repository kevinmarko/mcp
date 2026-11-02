/**
 * Headless check for the shared Booking Flash snapshot (2026-10-29), the BF half of
 * new Build/docs/reviews/DATA_FEED_OVERLAP_2026-10-29.md option 4: apps-script/DataFeeds.gs
 * publishFeedSnapshot_() and publishFeedSnapshotNow().
 *
 * What the feature does: the 30-minute trigger (refreshDataFeeds) already downloads the live export
 * into the script cache. It now also writes that copy to ONE Drive file ("booking_flash_live.csv.gz",
 * gzip of the CSV text) with five public Drive properties (bfFormat, bfFeed, bfHash, bfFetchedAt,
 * bfChangedAt), so Vessel Planning Tool can read the same copy instead of downloading ~700 KB itself.
 * It is OFF until the Script Property bfrSnapshotFolderId is set, and it is only ever called from the
 * trigger (which runs as the admin who can write the folder), never from getDataFeed / downloadFeed_
 * (those run as visitors).
 *
 * Runs the REAL apps-script/DataFeeds.gs under Node in a vm with in-memory fakes for CacheService,
 * PropertiesService, LockService, the Drive v3 advanced service (Files.get / create / update / list, with
 * trashed, parents and 404 details), Utilities (real MD5 / gzip / base64 from node), Session, console and the Code.gs helpers
 * DataFeeds.gs calls (assertArchiveAdmin_, fetchArchiveCsv_, ARCHIVE_REQUIRED_COLUMN_). The clock is
 * frozen and moved by hand so freshness and quiet hours are exact. What the fakes cannot prove: that
 * the real Drive service accepts these calls (parents, properties and media in one update); the deploy
 * checklist covers that (run publishFeedSnapshotNow once in the editor).
 *
 * Round 2 (review fixes): the same content again updates only the properties (no chunk read, no upload); the file id is
 * kept stable (trashed = restored, moved = kept, lost = found by name in the folder before a new one is made); the
 * get-or-create step runs under the script lock; every run that is not off writes bfrSnapshotStatus; a Drive v2 service
 * is refused before any chunk is read.
 *
 * Run:  node tests/check_feed_snapshot_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const feedsSrc = fs.readFileSync(path.join(root, 'apps-script', 'DataFeeds.gs'), 'utf8');

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
// Compare through JSON so values built inside the vm (another realm) compare cleanly with ours.
const same = (got, want, msg) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${msg || 'values differ'}\n  got:  ${a}\n  want: ${b}`);
};
const truthy = (v, msg) => { if (!v) throw new Error(msg || 'expected a truthy value'); };

const md5Hex = (text) => crypto.createHash('md5').update(Buffer.from(text, 'utf8')).digest('hex');
const gunzipText = (buf) => zlib.gunzipSync(buf).toString('utf8');

// ---------------------------------------------------------------------------
// The environment: fakes + the loaded DataFeeds.gs
// ---------------------------------------------------------------------------
const FOLDER = 'folder-1';
const SNAPSHOT_NAME = 'booking_flash_live.csv.gz';
const PROP_KEYS = ['bfFormat', 'bfFeed', 'bfHash', 'bfFetchedAt', 'bfChangedAt'];
const START_MS = Date.parse('2026-10-29T14:00:00Z'); // 10:00 in New York: busy hours (8:00-17:00)
const LIVE_CSV_1 = 'Vessel 1st VVD,POL,Note\nCIKT0014W,USHOU,Müller & Sons\nOIST0090W,USLAX,two\n';
const LIVE_CSV_2 = 'Vessel 1st VVD,POL,Note\nCIKT0014W,USHOU,Müller & Sons\nOIST0090W,USLAX,three\n';
const SECTOR_CSV = 'Sector,Value\nA,1\n';

function toBuf(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
  return Buffer.from(bytes.map((b) => (b + 256) % 256));
}
const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));

function makeBlob(data, contentType, name) {
  let buf = toBuf(data);
  const blob = {
    getBytes: () => toSigned(buf),
    getDataAsString: () => buf.toString('utf8'),
    getContentType: () => contentType,
    getName: () => name,
    setContentType: (c) => { contentType = c; return blob; },
    setName: (n) => { name = n; return blob; },
    _buf: () => buf,
  };
  return blob;
}

function makeEnv() {
  const env = {
    nowMs: START_MS,
    scriptProps: {},
    cache: {},                    // key -> {v, exp}
    files: {},                    // fileId -> {id, name, mimeType, parents, properties, trashed, buf}
    nextId: 1,
    driveCalls: [],               // {fn, args}
    driveFail: {},                // {get|create|update|list: message}
    driveFailErr: null,           // a thrown object to use instead of an Error(message) on get (shape tests)
    lockBusy: false,              // LockService.getScriptLock().tryLock answers false
    lockTries: 0, lockHeld: false,
    chunkReads: 0,                // readFeedChunks_ calls (spy installed after load)
    ungzips: 0,                   // Utilities.ungzip calls
    csv: { live: LIVE_CSV_1, sector: SECTOR_CSV },
    csvFail: false,
    logs: [], warns: [], errors: [],
    adminChecks: 0,
    adminFails: false,
    warmCalls: 0,
    archiveCalls: 0,
  };
  const count = (fn) => env.driveCalls.filter((c) => c.fn === fn).length;
  env.count = count;

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
    getProperty: (k) => (Object.prototype.hasOwnProperty.call(env.scriptProps, k) ? env.scriptProps[k] : null),
    setProperty: (k, v) => { env.scriptProps[k] = String(v); },
    deleteProperty: (k) => { delete env.scriptProps[k]; },
    getProperties: () => Object.assign({}, env.scriptProps),
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
    gzip: (blob) => makeBlob(zlib.gzipSync(blob._buf()), 'application/x-gzip', (blob.getName() || 'data') + '.gz'),
    ungzip: (blob) => { env.ungzips++; return makeBlob(zlib.gunzipSync(blob._buf()), 'application/octet-stream', 'data'); },
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

  const record = (fn, args) => env.driveCalls.push({ fn, args });
  // The advanced service's GoogleJsonResponseException carries details.code; the message is only a fallback.
  const notFound = (id) => { const e = new Error('File not found: ' + id); e.details = { code: 404, message: 'File not found: ' + id }; return e; };
  const fileView = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents.slice(), properties: Object.assign({}, f.properties), trashed: f.trashed });
  const Drive = {
    Files: {
      get: (id, opts) => {
        record('get', { id, opts });
        if (env.driveFailErr) throw env.driveFailErr;
        if (env.driveFail.get) throw new Error(env.driveFail.get);
        const f = env.files[id];
        if (!f) throw notFound(id);
        return fileView(f);
      },
      create: (resource, blob, opts) => {
        record('create', { resource: JSON.parse(JSON.stringify(resource)), buf: blob ? blob._buf() : null, opts: JSON.parse(JSON.stringify(opts || null)), contentType: blob && blob.getContentType() });
        if (env.driveFail.create) throw new Error(env.driveFail.create);
        const id = 'file-' + (env.nextId++);
        env.files[id] = { id, name: resource.name, mimeType: resource.mimeType, parents: (resource.parents || []).slice(), properties: Object.assign({}, resource.properties || {}), trashed: false, buf: blob ? Buffer.from(blob._buf()) : Buffer.alloc(0) };
        return fileView(env.files[id]);
      },
      update: (resource, id, blob, opts) => {
        record('update', { resource: JSON.parse(JSON.stringify(resource || {})), id, buf: blob ? blob._buf() : null, opts: JSON.parse(JSON.stringify(opts || null)), contentType: blob && blob.getContentType() });
        if (env.driveFail.update) throw new Error(env.driveFail.update);
        const f = env.files[id];
        if (!f) throw notFound(id);
        if (resource && resource.properties) Object.assign(f.properties, resource.properties);
        if (resource && typeof resource.trashed === 'boolean') f.trashed = resource.trashed;
        if (resource && resource.name) f.name = resource.name;
        if (blob) f.buf = Buffer.from(blob._buf());
        return fileView(f);
      },
      // Only the query this code sends is understood: '<folder>' in parents and name = '<name>' and trashed = false.
      list: (opts) => {
        record('list', { opts: JSON.parse(JSON.stringify(opts || null)) });
        if (env.driveFail.list) throw new Error(env.driveFail.list);
        const m = /^'([^']*)' in parents and name = '([^']*)' and trashed = false$/.exec(opts && opts.q || '');
        if (!m) throw new Error('unexpected Drive query: ' + (opts && opts.q));
        const files = Object.values(env.files).filter((f) => !f.trashed && f.parents.indexOf(m[1]) !== -1 && f.name === m[2])
          .map((f) => ({ id: f.id, properties: Object.assign({}, f.properties) }));
        return { files };
      },
    },
  };
  const LockService = {
    getScriptLock: () => ({
      tryLock: () => { env.lockTries++; if (env.lockBusy) return false; env.lockHeld = true; return true; },
      releaseLock: () => { env.lockHeld = false; },
    }),
  };

  const sandbox = {
    console: {
      log: (...a) => { env.logs.push(a.join(' ')); },
      info: (...a) => { env.logs.push(a.join(' ')); },
      warn: (...a) => { env.warns.push(a.join(' ')); },
      error: (...a) => { env.errors.push(a.join(' ')); },
    },
    Date: FakeDate,
    CacheService: { getScriptCache: () => cacheApi, getUserCache: () => cacheApi },
    PropertiesService: { getScriptProperties: () => propsApi, getUserProperties: () => propsApi },
    Session: {
      getScriptTimeZone: () => 'America/New_York',
      getActiveUser: () => ({ getEmail: () => 'admin@corp.com' }),
      getEffectiveUser: () => ({ getEmail: () => 'admin@corp.com' }),
    },
    Utilities,
    Drive,
    LockService,
    // Code.gs pieces DataFeeds.gs relies on (the real ones are covered by check_archive_logic / check_team_features_logic).
    ARCHIVE_REQUIRED_COLUMN_: 'Vessel 1st VVD',
    assertArchiveAdmin_: () => {
      env.adminChecks++;
      if (env.adminFails) throw new Error('Only the archive admin can run this.');
      return 'admin@corp.com';
    },
    fetchArchiveCsv_: (url) => {
      if (env.csvFail) throw new Error('Download failed (HTTP 500): ' + url);
      const urls = vm.runInContext('DATA_FEED_URLS_', ctx);
      if (url === urls.live) return env.csv.live;
      if (url === urls.sector) return env.csv.sector;
      throw new Error('unexpected url ' + url);
    },
    // The other things refreshDataFeeds calls (guarded by typeof in DataFeeds.gs): spies that prove the trigger carries on.
    warmAppConfigCache_: () => { env.warmCalls++; },
    refreshArchiveCache_: () => { env.archiveCalls++; return { ok: true }; },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { throw new Error('not used'); } },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(feedsSrc, ctx, { filename: 'DataFeeds.gs' });
  env.ctx = ctx;
  // Spy: how often the cached chunks are read (a properties-only publish must not read them).
  const realChunks = ctx.readFeedChunks_;
  ctx.readFeedChunks_ = function () { env.chunkReads++; return realChunks.apply(this, arguments); };
  env.call = (fn, ...args) => ctx[fn](...args);
  env.hasFn = (fn) => typeof ctx[fn] === 'function';
  env.advance = (ms) => { env.nowMs += ms; };
  env.configure = (fileId) => {
    env.scriptProps.bfrSnapshotFolderId = FOLDER;
    if (fileId) env.scriptProps.bfrSnapshotFileId = fileId;
  };
  env.last = () => (env.scriptProps.bfrSnapshotLast ? JSON.parse(env.scriptProps.bfrSnapshotLast) : null);
  env.status = () => (env.scriptProps.bfrSnapshotStatus ? JSON.parse(env.scriptProps.bfrSnapshotStatus) : null);
  env.addFile = (id, over) => {
    env.files[id] = Object.assign({ id, name: SNAPSHOT_NAME, mimeType: 'application/gzip', parents: [FOLDER], properties: { bfFormat: 'csv-gzip-1' }, trashed: false, buf: Buffer.from('old') }, over || {});
    return env.files[id];
  };
  env.liveMeta = () => env.call('readFeedMeta_', 'live');
  return env;
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------
console.log('Booking Flash feed snapshot (DataFeeds.gs publishFeedSnapshot_)');

t('the functions exist (publishFeedSnapshot_, publishFeedSnapshotNow)', () => {
  const env = makeEnv();
  truthy(env.hasFn('publishFeedSnapshot_'), 'publishFeedSnapshot_ is missing from DataFeeds.gs');
  truthy(env.hasFn('publishFeedSnapshotNow'), 'publishFeedSnapshotNow is missing from DataFeeds.gs');
});

if (!failures.length) {

  t('off (no bfrSnapshotFolderId): the trigger makes NO Drive call and creates no property', () => {
    const env = makeEnv();
    env.call('refreshDataFeeds');
    truthy(env.liveMeta(), 'the live copy should still be cached');
    same(env.driveCalls.length, 0, 'Drive was called while the feature is off');
    same(Object.keys(env.scriptProps).sort(), [], 'a Script Property was written while the feature is off');
    const r = env.call('publishFeedSnapshot_');
    same(r.written, false);
    same(env.driveCalls.length, 0, 'publishFeedSnapshot_ called Drive while off');
  });

  t('off: a blank folder id counts as off', () => {
    const env = makeEnv();
    env.scriptProps.bfrSnapshotFolderId = '   ';
    env.call('refreshDataFeeds');
    same(env.driveCalls.length, 0);
  });

  t('on, but no cached copy yet: nothing is written', () => {
    const env = makeEnv();
    env.configure();
    const r = env.call('publishFeedSnapshot_');
    same(r.written, false);
    same(env.driveCalls.length, 0, 'wrote with nothing cached');
  });

  t('first run creates the file (name, type, folder, 5 properties), stores its id and logs it', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    same(env.count('create'), 1, 'create calls');
    same(env.count('update'), 0, 'update calls');
    const c = env.driveCalls.find((x) => x.fn === 'create').args;
    same(c.resource.name, SNAPSHOT_NAME);
    same(c.resource.mimeType, 'application/gzip');
    same(c.resource.parents, [FOLDER]);
    same(Object.keys(c.resource.properties).sort(), PROP_KEYS.slice().sort(), 'the five public properties');
    same(c.opts && c.opts.supportsAllDrives, true, 'supportsAllDrives');
    const meta = env.liveMeta();
    const p = c.resource.properties;
    same(p.bfFormat, 'csv-gzip-1');
    same(p.bfFeed, 'live');
    same(p.bfFetchedAt, meta.fetchedAt);
    same(p.bfChangedAt, meta.changedAt);
    truthy(/^[0-9a-f]{32}$/.test(p.bfHash), 'bfHash is 32 lowercase hex');
    // The content is the gzip of the CSV text, and the hash is the MD5 of the UNZIPPED text.
    const text = gunzipText(c.buf);
    same(text, LIVE_CSV_1, 'file content unzips to the live CSV');
    same(p.bfHash, md5Hex(text), 'bfHash = md5 of the unzipped content (independent md5)');
    same(p.bfHash, meta.hash, 'bfHash = the cache meta hash');
    // Id remembered, last-published remembered, id logged.
    const id = env.scriptProps.bfrSnapshotFileId;
    truthy(id && env.files[id], 'bfrSnapshotFileId points at the created file');
    same(env.last(), { hash: meta.hash, fetchedAt: meta.fetchedAt, changedAt: meta.changedAt, fileId: id }, 'bfrSnapshotLast');
    truthy(env.logs.concat(env.warns).some((l) => l.indexOf(id) !== -1 && /VPT_BF_SNAPSHOT_FILE_ID/.test(l)), 'the new file id is logged with the VPT property to update');
    same(env.count('list'), 1, 'no stored id: the folder is searched by name once before the file is created');
  });

  t('the same cached copy again: nothing is written (same fetchedAt)', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const before = { create: env.count('create'), update: env.count('update') };
    const r = env.call('publishFeedSnapshot_');
    same(r.written, false, 'written flag');
    same({ create: env.count('create'), update: env.count('update') }, before, 'no create / update');
    // The trigger running again without a newer download (quiet hours skip) also writes nothing.
  });

  t('new copy with new content: ONE update with content + all 5 properties; changedAt moves with the hash', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const fileId = env.scriptProps.bfrSnapshotFileId;
    const first = env.liveMeta();
    env.advance(31 * 60 * 1000);
    env.csv.live = LIVE_CSV_2;
    env.call('refreshDataFeeds');
    const meta = env.liveMeta();
    truthy(meta.hash !== first.hash, 'the second download should have different content');
    same(env.count('create'), 1, 'no second create');
    same(env.count('update'), 1, 'exactly one update');
    const u = env.driveCalls.find((x) => x.fn === 'update').args;
    same(u.id, fileId);
    same(u.opts && u.opts.supportsAllDrives, true, 'supportsAllDrives');
    truthy(u.buf, 'content and properties travel in the same update call (media present)');
    same(gunzipText(u.buf), LIVE_CSV_2);
    same(Object.keys(u.resource.properties).sort(), PROP_KEYS.slice().sort(), 'all five properties in the update');
    same(u.resource.properties.bfHash, md5Hex(LIVE_CSV_2), 'bfHash = md5 of the new unzipped content');
    same(u.resource.properties.bfHash, meta.hash);
    same(u.resource.properties.bfFetchedAt, meta.fetchedAt);
    same(u.resource.properties.bfChangedAt, meta.changedAt);
    truthy(meta.changedAt === meta.fetchedAt, 'a new hash starts a new changedAt');
    same(env.last(), { hash: meta.hash, fetchedAt: meta.fetchedAt, changedAt: meta.changedAt, fileId }, 'bfrSnapshotLast moved on');
    same(env.status().mode, 'content', 'status mode content');
    same(env.scriptProps.bfrSnapshotFileId, fileId, 'the file id stays');
  });

  t('new download, same content: ONE properties-only update (no upload, chunks not read, no ungzip), bfChangedAt kept', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const first = env.liveMeta();
    const fileId = env.scriptProps.bfrSnapshotFileId;
    const contentBefore = Buffer.from(env.files[fileId].buf);
    env.advance(31 * 60 * 1000);
    env.call('downloadFeed_', 'live');
    const meta = env.liveMeta();
    same(meta.hash, first.hash, 'same content');
    truthy(meta.fetchedAt !== first.fetchedAt, 'new fetchedAt');
    env.chunkReads = 0; env.ungzips = 0;
    const r = env.call('publishFeedSnapshot_');
    same([r.ok, r.written, r.mode], [true, true, 'properties']);
    same(env.chunkReads, 0, 'the cached chunks were not read');
    same(env.ungzips, 0, 'nothing was unzipped');
    same(env.count('update'), 1, 'one update');
    const u = env.driveCalls.find((x) => x.fn === 'update').args;
    same(u.id, fileId);
    same(u.buf, null, 'no content uploaded (no new Drive revision)');
    same(u.opts && u.opts.supportsAllDrives, true, 'supportsAllDrives');
    const p = u.resource.properties;
    same(Object.keys(p).sort(), PROP_KEYS.slice().sort(), 'all five properties');
    same(p.bfFetchedAt, meta.fetchedAt, 'bfFetchedAt moved');
    same(p.bfChangedAt, first.changedAt, 'bfChangedAt kept (content did not change)');
    same(p.bfHash, first.hash);
    same(env.files[fileId].buf.equals(contentBefore), true, 'the file content is untouched');
    same(env.last(), { hash: meta.hash, fetchedAt: meta.fetchedAt, changedAt: first.changedAt, fileId }, 'bfrSnapshotLast');
    same(env.status().mode, 'properties', 'status mode');
  });

  t('same content, but the cache lost the first-seen time: bfChangedAt keeps the EARLIER of last.changedAt and meta.changedAt', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const first = env.liveMeta();
    env.advance(31 * 60 * 1000);
    // A new download whose cache chain was evicted: same hash, but changedAt = its own fetchedAt.
    env.cache = {};
    env.call('downloadFeed_', 'live');
    const meta = env.liveMeta();
    same(meta.hash, first.hash);
    same(meta.changedAt, meta.fetchedAt, 'the evicted chain made the content look new');
    const r = env.call('publishFeedSnapshot_');
    same(r.mode, 'properties');
    const p = env.driveCalls.filter((x) => x.fn === 'update').pop().args.resource.properties;
    same(p.bfChangedAt, first.changedAt, 'the earlier first-seen time is kept');
    same(env.last().changedAt, first.changedAt);
  });

  t('same hash but forced (publishFeedSnapshotNow): the content is uploaded again', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    env.advance(31 * 60 * 1000);
    env.call('downloadFeed_', 'live');
    const r = env.call('publishFeedSnapshot_', { force: true });
    same(r.mode, 'content');
    const u = env.driveCalls.find((x) => x.fn === 'update').args;
    truthy(u.buf, 'content uploaded');
    same(gunzipText(u.buf), LIVE_CSV_1);
  });

  t('an older bfrSnapshotLast without fileId (or for another file id): the content is uploaded, not just properties', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const fileId = env.scriptProps.bfrSnapshotFileId;
    const first = env.liveMeta();
    env.scriptProps.bfrSnapshotLast = JSON.stringify({ hash: first.hash, fetchedAt: first.fetchedAt });
    env.advance(31 * 60 * 1000);
    env.call('downloadFeed_', 'live');
    const r = env.call('publishFeedSnapshot_');
    same([r.written, r.mode, r.fileId], [true, 'content', fileId]);
    truthy(env.driveCalls.find((x) => x.fn === 'update').args.buf, 'content uploaded');
    same(env.last().fileId, fileId, 'bfrSnapshotLast now carries the file id');
  });

  t('quiet hours: a run that skips the download still publishes a copy a visitor downloaded', () => {
    const env = makeEnv();
    env.configure();
    env.nowMs = Date.parse('2026-10-30T02:00:00Z'); // 22:00 in New York: quiet
    // A visitor (getDataFeed) downloads the copy: this must NOT touch Drive.
    const reply = env.call('getDataFeed', { name: 'live', have: null, gzip: false });
    truthy(reply && reply.ok, 'visitor download works');
    same(env.driveCalls.length, 0, 'getDataFeed called Drive');
    env.advance(10 * 60 * 1000); // younger than the quiet skip window, so the trigger skips the download
    const fetchedBefore = env.liveMeta().fetchedAt;
    env.call('refreshDataFeeds');
    same(env.liveMeta().fetchedAt, fetchedBefore, 'the quiet run did not re-download');
    same(env.count('create'), 1, 'but it published the visitor\'s copy');
  });

  t('a trashed file is restored and kept (same id, no create), then written', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const oldId = env.scriptProps.bfrSnapshotFileId;
    env.files[oldId].trashed = true;
    env.advance(31 * 60 * 1000);
    env.csv.live = LIVE_CSV_2;
    env.call('refreshDataFeeds');
    same(env.count('create'), 1, 'no second create');
    same(env.scriptProps.bfrSnapshotFileId, oldId, 'the id is kept');
    same(env.files[oldId].trashed, false, 'restored from the trash');
    const ups = env.driveCalls.filter((x) => x.fn === 'update').map((x) => x.args);
    same(ups.length, 2, 'one restore + one content update');
    same([ups[0].id, ups[0].resource, ups[0].buf, ups[0].opts && ups[0].opts.supportsAllDrives], [oldId, { trashed: false }, null, true], 'the restore call');
    same(gunzipText(env.files[oldId].buf), LIVE_CSV_2, 'then the new content was written to it');
    same(env.status().idChanged, false, 'status: id not changed');
    truthy(env.logs.some((l) => /trash/i.test(l) && l.indexOf(oldId) !== -1), 'the restore is logged');
  });

  t('a trashed file with the same content: restored, then a properties-only update', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const oldId = env.scriptProps.bfrSnapshotFileId;
    env.files[oldId].trashed = true;
    env.advance(31 * 60 * 1000);
    env.call('refreshDataFeeds');
    same(env.files[oldId].trashed, false);
    same(env.status().mode, 'properties');
    same(env.scriptProps.bfrSnapshotFileId, oldId);
  });

  t('a file that moved out of the folder keeps being written in place (same id, logged, no create)', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const oldId = env.scriptProps.bfrSnapshotFileId;
    env.files[oldId].parents = ['some-other-folder'];
    env.advance(31 * 60 * 1000);
    env.csv.live = LIVE_CSV_2;
    env.call('refreshDataFeeds');
    same(env.count('create'), 1, 'no second create');
    same(env.count('list'), 1, 'no folder search (only the first run searched)');
    same(env.scriptProps.bfrSnapshotFileId, oldId);
    same(gunzipText(env.files[oldId].buf), LIVE_CSV_2, 'written in place');
    truthy(env.logs.some((l) => /not in folder/.test(l) && l.indexOf(oldId) !== -1), 'the move is logged');
  });

  t('a missing file (404) with nothing in the folder: the folder is searched by name, then a new file is made (new id logged)', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const oldId = env.scriptProps.bfrSnapshotFileId;
    delete env.files[oldId];
    env.advance(31 * 60 * 1000);
    env.call('refreshDataFeeds');
    same(env.count('list'), 2, 'searched the folder before creating');
    const l = env.driveCalls.filter((x) => x.fn === 'list').pop().args.opts;
    same(l.q, "'" + FOLDER + "' in parents and name = '" + SNAPSHOT_NAME + "' and trashed = false", 'the query');
    same([l.fields, l.supportsAllDrives, l.includeItemsFromAllDrives], ['files(id,properties)', true, true]);
    same(env.count('create'), 2);
    const newId = env.scriptProps.bfrSnapshotFileId;
    truthy(newId !== oldId);
    same(env.status().idChanged, true, 'status: id changed');
    same(env.status().fileId, newId);
    truthy(env.logs.some((l2) => l2.indexOf(newId) !== -1 && l2.indexOf(oldId) !== -1 && /VPT_BF_SNAPSHOT_FILE_ID/.test(l2)), 'new id logged, naming the VPT property');
  });

  t('a missing file (404): an earlier snapshot file found in the folder by name is reused (no create), content uploaded', () => {
    const env = makeEnv();
    env.configure('gone-id');
    env.addFile('other-dir-file', { parents: ['elsewhere'] });                       // wrong folder: not listed
    env.addFile('stray', { properties: { bfFormat: 'something-else' } });            // not a snapshot file: skipped
    env.addFile('found-id', { properties: { bfFormat: 'csv-gzip-1', bfHash: 'x' } }); // reused
    env.call('refreshDataFeeds');
    same(env.count('create'), 0, 'no create');
    same(env.scriptProps.bfrSnapshotFileId, 'found-id', 'the found id is stored');
    same(gunzipText(env.files['found-id'].buf), LIVE_CSV_1, 'content uploaded to the found file');
    same(env.status().idChanged, true);
    same(env.status().mode, 'content');
  });

  t('not found is recognised by err.details.code 404 even when the message says nothing; another Drive code is an error (no create)', () => {
    const env = makeEnv();
    env.configure('gone-id');
    const e404 = new Error('Something went wrong'); e404.details = { code: 404 };
    env.driveFailErr = e404;
    env.call('refreshDataFeeds');
    same(env.count('create'), 1, '404 by details: searched, then created');
    const env2 = makeEnv();
    env2.configure('some-id');
    env2.addFile('some-id');
    env2.call('downloadFeed_', 'live');
    const e403 = new Error('The caller does not have permission'); e403.details = { code: 403 };
    env2.driveFailErr = e403;
    const r = env2.call('publishFeedSnapshot_');
    truthy(!r.ok && r.reason === 'error' && /permission/.test(r.error), 'a 403 is an error: ' + JSON.stringify(r));
    same([env2.count('create'), env2.count('list'), env2.count('update')], [0, 0, 0], 'no new file on a passing error');
    same(env2.scriptProps.bfrSnapshotFileId, 'some-id', 'the id is kept');
    same(env2.lockHeld, false, 'the lock was released after the error');
  });

  t('lock busy: {ok:false, reason:busy}, nothing written, the next run retries', () => {
    const env = makeEnv();
    env.configure();
    env.call('downloadFeed_', 'live');
    env.lockBusy = true;
    const r = env.call('publishFeedSnapshot_');
    same([r.ok, r.reason, r.written], [false, 'busy', false]);
    same(env.lockTries, 1);
    same([env.count('get'), env.count('list'), env.count('create'), env.count('update')], [0, 0, 0, 0], 'no Drive write or lookup without the lock');
    same(env.last(), null, 'not marked as published');
    same(env.status().reason, 'busy');
    env.lockBusy = false;
    same(env.call('publishFeedSnapshot_').written, true, 'next run writes');
  });

  t('the id is re-read under the lock (another run stored one meanwhile): that file is used, no second create', () => {
    const env = makeEnv();
    env.configure();
    env.call('downloadFeed_', 'live');
    env.addFile('made-by-other-run');
    const realLock = env.ctx.LockService.getScriptLock;
    env.ctx.LockService.getScriptLock = () => ({
      tryLock: () => { env.scriptProps.bfrSnapshotFileId = 'made-by-other-run'; return true; },
      releaseLock: () => {},
    });
    const r = env.call('publishFeedSnapshot_');
    env.ctx.LockService.getScriptLock = realLock;
    same([r.written, r.fileId, env.count('create')], [true, 'made-by-other-run', 0]);
    same(r.idChanged, undefined, 'the id did not change under the lock');
  });

  t('status (bfrSnapshotStatus): written on every run that is not off, with {at, ok, reason, fileId, idChanged, written, mode}', () => {
    const env = makeEnv();
    env.configure();
    env.call('publishFeedSnapshot_'); // nothing cached
    same(env.status(), { at: new Date(env.nowMs).toISOString(), ok: true, reason: 'no-fresh-copy', fileId: null, idChanged: false, written: false, mode: null });
    env.call('refreshDataFeeds');
    const id = env.scriptProps.bfrSnapshotFileId;
    same(env.status(), { at: new Date(env.nowMs).toISOString(), ok: true, reason: 'written', fileId: id, idChanged: true, written: true, mode: 'content' });
    env.advance(60 * 1000);
    const r = env.call('publishFeedSnapshot_'); // same copy
    same(env.status(), { at: new Date(env.nowMs).toISOString(), ok: true, reason: 'unchanged', fileId: null, idChanged: false, written: false, mode: null });
    same(r.status, env.status(), 'the reply carries the same status');
    env.driveFail.update = 'Quota exceeded';
    env.advance(31 * 60 * 1000);
    env.csv.live = LIVE_CSV_2;
    env.call('refreshDataFeeds');
    const st = env.status();
    same([st.ok, st.reason, st.written, st.mode], [false, 'error', false, null]);
    truthy(/Quota exceeded/.test(st.error), 'the error text is kept');
    // Off: no status write at all.
    const off = makeEnv();
    off.call('refreshDataFeeds');
    same(off.status(), null);
  });

  t('a status property that cannot be written does not throw or undo the publish', () => {
    const env = makeEnv();
    env.configure();
    const realSet = env.ctx.PropertiesService.getScriptProperties().setProperty;
    const props = env.ctx.PropertiesService.getScriptProperties();
    props.setProperty = (k, v) => { if (k === 'bfrSnapshotStatus') throw new Error('Property storage quota'); realSet(k, v); };
    let threw = null;
    try { env.call('refreshDataFeeds'); } catch (err) { threw = err; }
    props.setProperty = realSet;
    same(threw, null);
    truthy(env.scriptProps.bfrSnapshotFileId && env.last(), 'published anyway');
    truthy(env.warns.some((l) => /status not saved/.test(l)), 'logged');
  });

  t('the cached chunks do not match the meta hash (a download landed in between): busy, nothing written', () => {
    const env = makeEnv();
    env.configure();
    env.call('downloadFeed_', 'live');
    const metaKey = Object.keys(env.cache).find((k) => { try { return JSON.parse(env.cache[k].v).v === 1; } catch (e) { return false; } });
    truthy(metaKey, 'found the live meta in the cache');
    const m = JSON.parse(env.cache[metaKey].v);
    m.hash = md5Hex('something else');
    env.cache[metaKey].v = JSON.stringify(m);
    const r = env.call('publishFeedSnapshot_');
    same([r.ok, r.reason, r.written], [false, 'busy', false]);
    same([env.count('create'), env.count('update')], [0, 0]);
    same(env.last(), null);
    same(env.lockTries, 0, 'the lock is not even taken');
  });

  t('an unreadable bfrSnapshotLast (bad JSON) counts as nothing published: the copy is written, never throws', () => {
    const env = makeEnv();
    env.configure();
    env.scriptProps.bfrSnapshotLast = '{not json';
    env.call('refreshDataFeeds');
    same(env.count('create'), 1);
    same(env.last().fileId, env.scriptProps.bfrSnapshotFileId, 'rewritten in the new shape');
  });

  t('Drive v2 (no Files.create / list): no-drive-service, checked before the chunks are read or decoded', () => {
    const env = makeEnv();
    env.configure();
    env.call('downloadFeed_', 'live');
    const v3 = env.ctx.Drive;
    env.ctx.Drive = { Files: { get: v3.Files.get, update: v3.Files.update, insert: () => { throw new Error('v2'); } } };
    env.chunkReads = 0; env.ungzips = 0;
    const r = env.call('publishFeedSnapshot_');
    same([r.ok, r.reason, r.written], [false, 'no-drive-service', false]);
    truthy(/v3/.test(r.error), 'says it needs v3');
    same([env.chunkReads, env.ungzips, env.driveCalls.length], [0, 0, 0], 'no chunk read, no decode, no Drive call');
    same(env.status().reason, 'no-drive-service');
    delete env.ctx.Drive;
    same(env.call('publishFeedSnapshot_').reason, 'no-drive-service', 'no Drive service at all');
  });

  t('a configured file id that is not the first-ever one is used (no needless create)', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds'); // creates
    const id = env.scriptProps.bfrSnapshotFileId;
    env.advance(31 * 60 * 1000);
    env.csv.live = LIVE_CSV_2;
    env.call('refreshDataFeeds');
    same(env.count('create'), 1);
    same(env.driveCalls.find((x) => x.fn === 'update').args.id, id);
  });

  t('Drive error on create: logged, never thrown, the trigger carries on, nothing marked as published', () => {
    const env = makeEnv();
    env.configure();
    env.driveFail.create = 'Drive is down';
    let threw = null;
    try { env.call('refreshDataFeeds'); } catch (err) { threw = err; }
    same(threw, null, 'refreshDataFeeds must not throw');
    truthy(env.liveMeta(), 'the feed copy is still cached');
    same(env.warmCalls, 1, 'warmAppConfigCache_ still ran after the failure');
    same(env.archiveCalls, 1, 'refreshArchiveCache_ still ran after the failure');
    truthy(env.logs.concat(env.warns, env.errors).some((l) => /snapshot/i.test(l) && /Drive is down/.test(l)), 'the failure is logged with its reason');
    same(env.last(), null, 'bfrSnapshotLast not set, so the next run retries');
    // The direct call does not throw either, and says it did not write.
    const r = env.call('publishFeedSnapshot_');
    same(r.ok, false);
    same(r.written, false);
    // Drive is back: the next run publishes.
    delete env.driveFail.create;
    env.call('refreshDataFeeds');
    truthy(env.scriptProps.bfrSnapshotFileId, 'published after Drive came back');
  });

  t('Drive error on update (and on get): logged, never thrown, nothing marked as published', () => {
    ['update', 'get'].forEach((which) => {
      const env = makeEnv();
      env.configure();
      env.call('refreshDataFeeds');
      const before = env.last();
      env.advance(31 * 60 * 1000);
      env.csv.live = LIVE_CSV_2;
      env.driveFail[which] = 'Quota exceeded';
      let threw = null;
      try { env.call('refreshDataFeeds'); } catch (err) { threw = err; }
      same(threw, null, `${which}: refreshDataFeeds must not throw`);
      same(env.warmCalls, 2, `${which}: the trigger carried on`);
      same(env.last(), before, `${which}: bfrSnapshotLast unchanged after the failure`);
      const r = env.call('publishFeedSnapshot_');
      same(r.written, false, `${which}: direct call reports not written`);
    });
  });

  t('the download failing (no new copy) writes nothing and does not throw', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    const creates = env.count('create');
    env.advance(5 * 60 * 60 * 1000); // the cached copy is gone / stale
    env.csvFail = true;
    env.call('refreshDataFeeds');
    same(env.count('create'), creates, 'no write without a fresh copy');
    same(env.count('update'), 0);
  });

  t('a stale (not fresh) cached copy is not published', () => {
    const env = makeEnv();
    env.configure();
    env.call('getDataFeed', { name: 'live', have: null, gzip: false }); // cached at 10:00, Drive untouched
    same(env.driveCalls.length, 0);
    env.advance(2 * 60 * 60 * 1000); // still inside the cache TTL, but past the 30 + 10 minute freshness
    truthy(env.liveMeta(), 'meta still cached');
    const r = env.call('publishFeedSnapshot_');
    same(r.written, false);
    same(env.driveCalls.length, 0, 'wrote a stale copy');
  });

  t('never called from the visitor paths: getDataFeed (hit, miss, wait) and downloadFeed_ make no Drive call even when configured', () => {
    const env = makeEnv();
    env.configure('file-existing');
    env.files['file-existing'] = { id: 'file-existing', name: SNAPSHOT_NAME, mimeType: 'application/gzip', parents: [FOLDER], properties: {}, trashed: false, buf: Buffer.alloc(0) };
    const miss = env.call('getDataFeed', { name: 'live', have: null, gzip: true });
    truthy(miss.ok, 'cold getDataFeed downloads');
    const hit = env.call('getDataFeed', { name: 'live', have: null, gzip: false });
    truthy(hit.ok, 'warm getDataFeed');
    env.call('downloadFeed_', 'live');
    same(env.driveCalls.length, 0, 'a visitor path called Drive');
    // Source check: the visitor functions do not even mention it.
    ['getDataFeed', 'downloadFeed_', 'downloadFeedOrWait_', 'feedReply_', 'feedNoData_'].forEach((fn) => {
      const re = new RegExp('function ' + fn + '\\([\\s\\S]*?\\n\\}\\n');
      const m = feedsSrc.match(re);
      truthy(m, 'could not find ' + fn + ' in DataFeeds.gs');
      truthy(!/publishFeedSnapshot/.test(m[0]), fn + ' mentions publishFeedSnapshot');
    });
    // And the only callers of publishFeedSnapshot_ are refreshDataFeeds and publishFeedSnapshotNow.
    const callers = [];
    const fnRe = /\nfunction (\w+)\([^)]*\) \{[\s\S]*?\n\}\n/g;
    let m;
    while ((m = fnRe.exec(feedsSrc))) {
      if (m[1] !== 'publishFeedSnapshot_' && /publishFeedSnapshot_\s*\(/.test(m[0])) callers.push(m[1]);
    }
    same(callers.sort(), ['publishFeedSnapshotNow', 'refreshDataFeeds'], 'who calls publishFeedSnapshot_');
  });

  t('publishFeedSnapshotNow: admin-checked first; refuses (throws) for a non-admin before any Drive call', () => {
    const env = makeEnv();
    env.configure();
    env.adminFails = true;
    let msg = null;
    try { env.call('publishFeedSnapshotNow'); } catch (err) { msg = String(err.message); }
    truthy(msg && /admin/i.test(msg), 'should throw the admin error, got: ' + msg);
    same(env.adminChecks, 1);
    same(env.driveCalls.length, 0);
    same(env.liveMeta(), null, 'no download either');
  });

  t('publishFeedSnapshotNow: downloads live when nothing is cached, publishes, returns {ok, fileId, hash, fetchedAt}', () => {
    const env = makeEnv();
    env.configure();
    const r = env.call('publishFeedSnapshotNow');
    same(env.adminChecks, 1);
    same(r.ok, true);
    const meta = env.liveMeta();
    truthy(meta, 'live downloaded into the cache');
    same(r.hash, meta.hash);
    same(r.fetchedAt, meta.fetchedAt);
    same(r.fileId, env.scriptProps.bfrSnapshotFileId, 'returned id = stored id');
    truthy(r.fileId && env.files[r.fileId], 'file exists');
    same(env.count('create'), 1);
    same(r.status, env.status(), 'the reply carries bfrSnapshotStatus');
    same([r.status.idChanged, r.status.mode], [true, 'content']);
    truthy(env.logs.some((l) => /"status"/.test(l)), 'the reply (with its status) is logged');
  });

  t('publishFeedSnapshotNow: ignores bfrSnapshotLast (writes again for the same copy) and uses a fresh cached copy without downloading', () => {
    const env = makeEnv();
    env.configure();
    env.call('refreshDataFeeds');
    same(env.count('create'), 1);
    const metaBefore = env.liveMeta();
    // Break the file on purpose, so a forced publish has something visible to repair.
    env.files[env.scriptProps.bfrSnapshotFileId].buf = Buffer.from('garbage');
    env.csv.live = LIVE_CSV_2; // a download now would change the content: proves no download happened
    const r = env.call('publishFeedSnapshotNow');
    same(r.ok, true);
    same(env.liveMeta().fetchedAt, metaBefore.fetchedAt, 'the fresh cached copy was used');
    same(env.count('update'), 1, 'one forced update although bfrSnapshotLast matched');
    same(gunzipText(env.files[r.fileId].buf), LIVE_CSV_1, 'the file holds the cached copy again');
    same(r.hash, metaBefore.hash);
  });

  t('publishFeedSnapshotNow with the feature off (no folder id): no Drive call', () => {
    const env = makeEnv();
    let out;
    try { out = env.call('publishFeedSnapshotNow'); } catch (err) { out = { threw: String(err.message) }; }
    same(env.driveCalls.length, 0, 'Drive called while off');
    truthy(out && (out.ok === false || out.threw), 'should say it is not set up (ok:false or a clear error)');
  });

}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILED:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}

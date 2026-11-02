/**
 * --- Shared server cache for the live and sector CSVs (2026-09-29) ---
 *
 * Until now every visitor's browser downloaded the two published Sheets
 * (live export ~700 KB, sector ~2 KB) straight from Google on every load and
 * every auto-refresh. This serves them from the script cache instead: a
 * trigger (refreshDataFeeds) re-downloads each Sheet server side every 30
 * minutes from 8:00 to 17:00 and hourly outside that (per Kevin: the data only
 * needs refreshing that often), every visitor gets the cached copy, gzipped,
 * and a browser that already holds the current version gets a tiny
 * "unchanged" reply. The app's polls all fire at the same wall-clock moment,
 * so the trigger matters: without it the whole org would find an expired copy
 * at once. Without the trigger it still works -- the first reader after a
 * copy goes stale downloads it, the rest wait briefly for that one download
 * (downloadFeedOrWait_).
 *
 * The web app runs as the visitor, but the script cache is script-global, so
 * one visitor's download serves the whole org. The data itself is the same
 * published CSV every visitor can already fetch directly, so sharing it
 * through the cache exposes nothing new. If anything here fails, the app
 * falls back to fetching the Sheet directly (reason 'busy' / 'fetch-failed'
 * / 'not-the-export'), so the cache can only ever make loading faster.
 *
 * Public (no trailing underscore) so google.script.run can call it; the
 * request is validated and the only URLs ever fetched are the two constants
 * below, never anything the caller supplies.
 *
 * Load order: this file must not reference Code.gs variables at load time
 * (Apps Script runs files in editor order, and Code.gs may come second), so
 * the live URL is spelled out here and tests/check_team_features_logic.js
 * asserts it equals the app's CSV_SOURCE_URL. Code.gs helpers are only called from inside functions.
 */

/** live = the app's CSV_SOURCE_URL; sector = its SECTOR_DATA_CSV_URL. Both asserted equal to the app's constants by the test. */
var DATA_FEED_URLS_ = {
  live: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQNykGT8bYqwDC4k9loE5L8-j-rs9fyzPetfnrNwYAAZVRTXVLDyxrtCm9eP736OUAYEi6wULzeCaBn/pub?gid=0&single=true&output=csv',
  sector: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS-mr0DP12xhXXcsCvPDJiTolxYOA013WwHZAg5mFC4xN9cPwSNr3-O_/pub?gid=0&single=true&output=csv'
};

/**
 * Refresh schedule, in the script's time zone (Project settings): every 30 minutes from
 * DATA_FEED_BUSY_START_HOUR_ to DATA_FEED_BUSY_END_HOUR_ (8:00-16:59), hourly otherwise, every
 * day. The trigger runs every 30 minutes; outside business hours a run skips a feed whose copy is
 * younger than DATA_FEED_QUIET_SKIP_MS_, which makes it hourly. ~2 s a run, ~1 min a day in all.
 */
var DATA_FEED_TRIGGER_MINUTES_ = 30;
var DATA_FEED_BUSY_START_HOUR_ = 8;
var DATA_FEED_BUSY_END_HOUR_ = 17;
var DATA_FEED_BUSY_INTERVAL_MS_ = 30 * 60 * 1000;
var DATA_FEED_QUIET_INTERVAL_MS_ = 60 * 60 * 1000;
var DATA_FEED_QUIET_SKIP_MS_ = DATA_FEED_QUIET_INTERVAL_MS_ - 15 * 60 * 1000;

/** Readers keep using a copy this long past its scheduled refresh: a time trigger fires anywhere within a few minutes of its slot. */
var DATA_FEED_SLACK_MS_ = 10 * 60 * 1000;

/** A copy stays in the cache this long at all (well past the hourly schedule); readers decide freshness with isFeedFresh_. */
var DATA_FEED_CACHE_SECONDS_ = 3 * 60 * 60;

/** The script cache caps a value at 100 KB; chunks stay under it with headroom. */
var DATA_FEED_CHUNK_CHARS_ = 90000;

/** A download claim expires on its own after this, so a crashed download cannot block a feed. */
var DATA_FEED_CLAIM_SECONDS_ = 30;

/**
 * How long a reader waits for someone else's download before telling the app to fetch directly.
 * Short on purpose: the app is waiting on this reply before it can show anything.
 */
var DATA_FEED_WAIT_MS_ = 4000;
var DATA_FEED_POLL_MS_ = 500;

/** Lowercase hex MD5 of `text` (UTF-8). computeDigest returns signed bytes, so each is normalized to 0..255. */
function md5Hex_(text) {
  var digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return digestBytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function dataFeedKey_(name, part) {
  return 'bfrFeed:' + name + ':' + part;
}

/**
 * The cached copy's {v, hash, fetchedAt, chunks, changedAt?, refreshIntervalMsAtFetch?}, or null (none, unreadable, or cache
 * down). v stays 1: changedAt and refreshIntervalMsAtFetch are additive, so a meta written before they existed is still read
 * (they are just absent; see feedStamp_ for how an absent changedAt is treated).
 */
function readFeedMeta_(name) {
  try {
    var raw = CacheService.getScriptCache().get(dataFeedKey_(name, 'meta'));
    if (!raw) return null;
    var meta = JSON.parse(raw);
    if (!meta || meta.v !== 1 || typeof meta.hash !== 'string' || !(meta.chunks >= 1)) return null;
    return meta;
  } catch (err) {
    return null;
  }
}

/** The gzip-base64 payload for `meta`, or null if any chunk is missing. Read only once `meta` is known to be worth serving. */
function readFeedChunks_(name, meta) {
  try {
    var keys = [];
    for (var i = 0; i < meta.chunks; i++) keys.push(dataFeedKey_(name, i));
    var got = CacheService.getScriptCache().getAll(keys);
    var b64 = '';
    for (var j = 0; j < keys.length; j++) {
      var piece = got[keys[j]];
      if (typeof piece !== 'string') return null;
      b64 += piece;
    }
    return b64;
  } catch (err) {
    return null;
  }
}

/**
 * Best effort: a cache that refuses the write (size, quota) just means the next visitor downloads again.
 * `changedAt` is when this content (this hash) first appeared in the cache chain; it defaults to fetchedAt, i.e. "new content".
 * The meta also records the refresh interval in force when the copy was fetched (refreshIntervalMsAtFetch), left out if it
 * cannot be worked out.
 */
function writeFeedCache_(name, hash, fetchedAt, b64, changedAt) {
  try {
    var values = {};
    var chunks = 0;
    for (var pos = 0; pos < b64.length; pos += DATA_FEED_CHUNK_CHARS_) {
      values[dataFeedKey_(name, chunks)] = b64.slice(pos, pos + DATA_FEED_CHUNK_CHARS_);
      chunks++;
    }
    var meta = { v: 1, hash: hash, fetchedAt: fetchedAt, chunks: chunks, changedAt: changedAt || fetchedAt };
    try {
      var atFetch = refreshIntervalMs_(new Date(Date.parse(fetchedAt)));
      if (typeof atFetch === 'number' && isFinite(atFetch)) meta.refreshIntervalMsAtFetch = atFetch;
    } catch (err) { /* left out: unknown */ }
    values[dataFeedKey_(name, 'meta')] = JSON.stringify(meta);
    CacheService.getScriptCache().putAll(values, DATA_FEED_CACHE_SECONDS_);
  } catch (err) {
    console.log('Feed cache write skipped for ' + name + ': ' + err);
  }
}

/** Empty, an HTML page (a sign-in redirect), or -- for live -- a CSV without the export's own column. */
function isNotTheExport_(name, text) {
  var t = String(text || '').replace(/^﻿/, '').trim();
  if (!t || t.charAt(0) === '<') return true;
  if (name === 'live') {
    var nl = t.indexOf('\n');
    var firstLine = nl === -1 ? t : t.slice(0, nl);
    if (firstLine.indexOf(ARCHIVE_REQUIRED_COLUMN_) === -1) return true;
  }
  return false;
}

function gzipBase64_(text) {
  var blob = Utilities.newBlob(text, 'text/csv', 'feed.csv');
  return Utilities.base64Encode(Utilities.gzip(blob).getBytes());
}

function gunzipBase64_(b64) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip', 'feed.csv.gz');
  return Utilities.ungzip(blob).getDataAsString('UTF-8');
}

/**
 * request = { name: 'live'|'sector', have: <hash from a previous response or null>, gzip: <boolean>,
 *             notOlderThanMs: <optional; see below> }.
 * Every ok reply carries ageMs, the copy's age by this server's clock. notOlderThanMs is sent by a
 * browser that last fell back to fetching the Sheet directly, that many ms ago: a copy older than
 * that predates what it is showing, so the reply is {older: true} with no data rather than an
 * out-of-date export it would take for new data.
 * Every ok reply (data, unchanged and older alike) also carries two ADDITIVE fields for the browser's
 * "Data as of" stamp, from feedStamp_: fetchedDate ('yyyy-MM-dd', the calendar date of fetchedAt in
 * the script's time zone) and refreshIntervalMs (the refresh interval in force now). An older page
 * ignores both; if either cannot be worked out it is left out, never an error.
 * Three more ADDITIVE fields say when the DATA last changed, as opposed to when it was last downloaded: changedAt
 * (ISO time the current content, i.e. this hash, was first seen in the cache), changedDate (its 'yyyy-MM-dd' in the
 * script's time zone, formatted exactly like fetchedDate) and refreshIntervalMsAtFetch (the interval in force when this
 * copy was fetched; refreshIntervalMs is the interval at reply time). fetchedAt/fetchedDate move on EVERY download, even
 * when the content is identical, so they are NOT the data's as-of date: roadmap 2.2 must use changedDate for that.
 * Never throws. The reply shapes are {ok:true, name, hash, fetchedAt, ageMs, fetchedDate, refreshIntervalMs, changedAt,
 * changedDate, refreshIntervalMsAtFetch} plus {encoding, data}, or plus {unchanged:true}, or plus {older:true}; and
 * {ok:false, reason}.
 * The body below is getDataFeedMain_; getDataFeed wraps it and only adds the ADDITIVE epExport field to a live reply when
 * the Script Property bfrEpExportUrl is set (D84 slice 2a-4, ADR-R2; see the EP_EXPORT section at the end of this file).
 * With the property unset getDataFeed returns getDataFeedMain_'s reply object untouched.
 */
function getDataFeed(request) {
  return withEpExport_(request, getDataFeedMain_(request));
}

function getDataFeedMain_(request) {
  try {
    if (!request || typeof request !== 'object') return { ok: false, reason: 'invalid-request' };
    var name = request.name;
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(DATA_FEED_URLS_, name)) {
      return { ok: false, reason: 'invalid-request' };
    }
    var have = request.have;
    if (have !== undefined && have !== null && (typeof have !== 'string' || have.length > 64)) {
      return { ok: false, reason: 'invalid-request' };
    }
    var notOlderThanMs = request.notOlderThanMs;
    if (notOlderThanMs !== undefined && notOlderThanMs !== null && !(typeof notOlderThanMs === 'number' && notOlderThanMs >= 0)) {
      return { ok: false, reason: 'invalid-request' };
    }
    var wantGzip = request.gzip === true;

    var meta = readFeedMeta_(name);
    if (meta && isFeedFresh_(meta)) {
      // No data needed (same version, or older than the browser's own copy): the chunks are not even read.
      var early = feedNoData_(name, meta, have, notOlderThanMs);
      if (early) return early;
      var b64 = readFeedChunks_(name, meta);
      if (b64 !== null) return feedReply_(name, meta, b64, null, wantGzip);
    }

    var got = downloadFeedOrWait_(name);
    if (!got.ok) return got;
    return feedNoData_(name, got, have, notOlderThanMs) || feedReply_(name, got, got.b64, got.text, wantGzip);
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', error: String(err && err.message ? err.message : err) };
  }
}

function isBusyHour_(date) {
  var hour = Number(Utilities.formatDate(date, Session.getScriptTimeZone(), 'H'));
  return hour >= DATA_FEED_BUSY_START_HOUR_ && hour < DATA_FEED_BUSY_END_HOUR_;
}

function refreshIntervalMs_(date) {
  return isBusyHour_(date) ? DATA_FEED_BUSY_INTERVAL_MS_ : DATA_FEED_QUIET_INTERVAL_MS_;
}

/**
 * A copy is current until its scheduled refresh is overdue: the longer of the intervals at download
 * time and now (so a 7:40 copy is not dropped at 8:00, nor a 16:50 one at 17:30), plus slack.
 */
function isFeedFresh_(meta) {
  var t = Date.parse(meta.fetchedAt);
  if (!isFinite(t)) return false;
  var now = new Date();
  var maxAge = Math.max(refreshIntervalMs_(new Date(t)), refreshIntervalMs_(now)) + DATA_FEED_SLACK_MS_;
  return now.getTime() - t <= maxAge;
}

function feedAgeMs_(fetchedAt) {
  var t = Date.parse(fetchedAt);
  return isFinite(t) ? Math.max(0, Date.now() - t) : 0;
}

/**
 * A cache miss. One caller per feed downloads (a claim in the cache, not LockService: the
 * script lock is also taken by note saves and the archive jobs, and would make the live and
 * sector feeds wait on each other and on those). Everyone who finds a claim waits for that
 * download's result instead of starting another. The claim is best effort -- two callers can
 * both miss it and download twice, which only costs a duplicate download.
 * Returns {ok:true, hash, fetchedAt, changedAt, refreshIntervalMsAtFetch, b64, text|null} or a {ok:false, reason} reply.
 */
function downloadFeedOrWait_(name) {
  var cache = CacheService.getScriptCache();
  var claimKey = dataFeedKey_(name, 'claim');
  var claimed = null;
  try { claimed = cache.get(claimKey); } catch (err) { claimed = null; }
  if (claimed) {
    for (var waited = 0; waited < DATA_FEED_WAIT_MS_; waited += DATA_FEED_POLL_MS_) {
      Utilities.sleep(DATA_FEED_POLL_MS_);
      // Meta first: the chunks are read only once a fresh copy has landed.
      var m = readFeedMeta_(name);
      var b64 = m && isFeedFresh_(m) ? readFeedChunks_(name, m) : null;
      if (b64 !== null) return { ok: true, hash: m.hash, fetchedAt: m.fetchedAt, changedAt: m.changedAt, refreshIntervalMsAtFetch: m.refreshIntervalMsAtFetch, b64: b64, text: null };
      var still = null;
      try { still = cache.get(claimKey); } catch (err) { still = null; }
      if (!still) break; // that download failed; the app will fetch the Sheet directly
    }
    return { ok: false, reason: 'busy' };
  }
  try { cache.put(claimKey, '1', DATA_FEED_CLAIM_SECONDS_); } catch (err) { /* no claim: at worst a duplicate download */ }
  try {
    return downloadFeed_(name);
  } finally {
    try { cache.remove(claimKey); } catch (err) { /* expires on its own */ }
  }
}

/**
 * Downloads one feed, validates it, and stores it in the cache. {ok:true, hash, fetchedAt, changedAt,
 * refreshIntervalMsAtFetch, b64, text} or {ok:false, reason}. changedAt carries over from the cached copy when the new
 * download has the same hash (the content did not change, only the download time did); a cached copy from before changedAt
 * existed hands over its fetchedAt instead. With no cached copy (expired or evicted) or a different hash it is fetchedAt:
 * after an eviction it can therefore overstate how recently the data changed, never understate it.
 */
function downloadFeed_(name) {
  var text;
  try {
    text = fetchArchiveCsv_(DATA_FEED_URLS_[name]);
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', error: String(err && err.message ? err.message : err) };
  }
  if (isNotTheExport_(name, text)) return { ok: false, reason: 'not-the-export' };
  var hash = md5Hex_(text);
  var fetchedAt = new Date().toISOString();
  var b64 = gzipBase64_(text);
  var changedAt = fetchedAt;
  var prev = readFeedMeta_(name);
  if (prev && prev.hash === hash) {
    if (isTimeString_(prev.changedAt)) changedAt = prev.changedAt;
    else if (isTimeString_(prev.fetchedAt)) changedAt = prev.fetchedAt;
  }
  writeFeedCache_(name, hash, fetchedAt, b64, changedAt);
  var atFetch;
  try { atFetch = refreshIntervalMs_(new Date(Date.parse(fetchedAt))); } catch (err) { atFetch = undefined; }
  return { ok: true, hash: hash, fetchedAt: fetchedAt, changedAt: changedAt, refreshIntervalMsAtFetch: atFetch, b64: b64, text: text };
}

/**
 * Time-driven trigger handler (installDataFeedTrigger, every 30 minutes): re-downloads both feeds
 * so readers always find a fresh copy -- every run from 8:00 to 17:00, and outside that only a copy
 * at least DATA_FEED_QUIET_SKIP_MS_ old, i.e. hourly -- and re-fills the config Sheet's cache if it
 * was evicted, so doGet never has to open the config Sheet itself. Skips a feed someone is already
 * downloading. After the feeds it publishes the live copy to the shared Drive snapshot file
 * (publishFeedSnapshot_, below; off unless bfrSnapshotFolderId is set), also on a run that skipped
 * the download, so a copy a visitor downloaded still reaches the file. Logs instead of throwing: a
 * trigger that throws emails its owner every run.
 * `e` is the time-trigger event. It is used ONLY to decide whether the EP_EXPORT step runs (isOwnTriggerEvent_): every
 * other step behaves exactly as before, whoever calls this.
 */
function refreshDataFeeds(e) {
  var cache = CacheService.getScriptCache();
  var quiet = false;
  try { quiet = !isBusyHour_(new Date()); } catch (err) { quiet = false; }
  Object.keys(DATA_FEED_URLS_).forEach(function (name) {
    try {
      if (quiet) {
        var meta = readFeedMeta_(name);
        if (meta && isFinite(Date.parse(meta.fetchedAt)) && feedAgeMs_(meta.fetchedAt) < DATA_FEED_QUIET_SKIP_MS_) return;
      }
      var claimKey = dataFeedKey_(name, 'claim');
      if (cache.get(claimKey)) return;
      cache.put(claimKey, '1', DATA_FEED_CLAIM_SECONDS_);
      try {
        var r = downloadFeed_(name);
        if (!r.ok) console.warn('refreshDataFeeds: ' + name + ' ' + r.reason + (r.error ? ' ' + r.error : ''));
      } finally {
        cache.remove(claimKey);
      }
    } catch (err) {
      console.warn('refreshDataFeeds: ' + name + ' ' + err);
    }
  });
  // Only this trigger (and the editor-run publishFeedSnapshotNow) writes the snapshot: it runs as the
  // admin, who can write the folder. getDataFeed / downloadFeed_ run as visitors and never call it.
  try {
    var snap = publishFeedSnapshot_();
    if (!snap.ok) console.warn('refreshDataFeeds: snapshot ' + snap.reason + (snap.error ? ' ' + snap.error : ''));
  } catch (err) {
    console.warn('refreshDataFeeds: snapshot ' + err);
  }
  try {
    if (typeof warmAppConfigCache_ === 'function') warmAppConfigCache_();
  } catch (err) {
    console.warn('refreshDataFeeds: config ' + err);
  }
  // The historical archive's admin-run cache (Code.gs, 2026-09-30): this trigger runs as
  // the admin, so it can read the archive folder for visitors it isn't shared with.
  try {
    if (typeof refreshArchiveCache_ === 'function') {
      var archive = refreshArchiveCache_();
      if (!archive.ok && archive.reason !== 'not-configured') console.warn('refreshDataFeeds: archive ' + (archive.error || archive.reason));
      else if (archive.failed && archive.failed.length) console.warn('refreshDataFeeds: archive days failed: ' + archive.failed.join('; '));
    }
  } catch (err) {
    console.warn('refreshDataFeeds: archive ' + err);
  }
  // Empty Planning's EP_EXPORT (D84 slice 2a-4, ADR-R2): off unless bfrEpExportUrl is set. refreshDataFeeds is public, so
  // a visitor can call it through google.script.run, and then it runs as THAT visitor; the EP step therefore runs only for
  // this project's own installed trigger (isOwnTriggerEvent_), whose token is the installer's (the admin's). Its own try,
  // so it can never stop the feeds above.
  try {
    if (isOwnTriggerEvent_(e)) {
      var ep = refreshEpExport_({ quiet: quiet });
      if (!ep.ok) console.warn('refreshDataFeeds: epExport ' + ep.error);
    }
  } catch (err) {
    console.warn('refreshDataFeeds: epExport ' + err);
  }
}

/**
 * True only when `e` is the event of one of the CURRENT user's installed refreshDataFeeds triggers. A time trigger passes
 * {triggerUid, ...}; a google.script.run call passes whatever the caller sends, so the uid is matched against
 * ScriptApp.getProjectTriggers(), which lists only the triggers the effective user installed. Under "execute as user
 * accessing" a visitor's call runs as the visitor, who owns no trigger here, so even a forged uid (copied from a log)
 * matches nothing. Never throws (false).
 */
function isOwnTriggerEvent_(e) {
  try {
    if (!e || typeof e !== 'object' || e.triggerUid === undefined || e.triggerUid === null || e.triggerUid === '') return false;
    var uid = String(e.triggerUid);
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'refreshDataFeeds' && String(triggers[i].getUniqueId()) === uid) return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Run ONCE from the editor, as the archive admin (assertArchiveAdmin_ in Code.gs; with no admin
 * recorded yet, only the project owner may run it, and becomes the admin):
 * installs the every-DATA_FEED_TRIGGER_MINUTES_ trigger for refreshDataFeeds, replacing any
 * earlier one. The trigger runs as whoever installs it.
 */
function installDataFeedTrigger() {
  assertArchiveAdmin_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshDataFeeds') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshDataFeeds').timeBased().everyMinutes(DATA_FEED_TRIGGER_MINUTES_).create();
  refreshDataFeeds();
  return { ok: true, everyMinutes: DATA_FEED_TRIGGER_MINUTES_ };
}

/** A string Date.parse can read (a number such as 0 would parse as a year, so only strings count). */
function isTimeString_(v) {
  return typeof v === 'string' && isFinite(Date.parse(v));
}

/** 'yyyy-MM-dd' of an ISO time in the SCRIPT's time zone, or undefined if it cannot be worked out (never throws). */
function feedDay_(iso) {
  try {
    var t = Date.parse(iso);
    if (!isFinite(t)) return undefined;
    var day = Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
  } catch (err) {
    return undefined;
  }
}

/**
 * The additive reply fields for the browser's "Data as of" stamp (roadmap 1.1 and 2.2):
 *   fetchedDate        the calendar date of `fetchedAt` as 'yyyy-MM-dd' in the SCRIPT's time zone (Project
 *                      settings), not UTC: a copy fetched at 23:30 UTC is already the next day in Tokyo and still
 *                      the same day in New York. The browser does not know the script's zone, which is why the
 *                      server says it. It is the day of the last DOWNLOAD, which advances even when the content is
 *                      identical, so it is NOT the data's as-of date.
 *   refreshIntervalMs  the refresh interval in force NOW (30 minutes from DATA_FEED_BUSY_START_HOUR_ to
 *                      DATA_FEED_BUSY_END_HOUR_ script time, else 60), so the browser can call a stamp stale
 *                      without copying the schedule into the page.
 *   changedAt          when this content (hash) was first seen by the cache chain (see downloadFeed_). A copy whose
 *                      meta has no usable changedAt (written before the field existed) falls back to its fetchedAt.
 *   changedDate        the 'yyyy-MM-dd' of changedAt, formatted exactly like fetchedDate. Roadmap 2.2 ("the previous
 *                      available archive date") must use THIS as the as-of date, not fetchedDate.
 *   refreshIntervalMsAtFetch  the interval in force when the copy was fetched (refreshIntervalMs is the one now). Left
 *                      out when the meta does not record it (a copy written before the field existed).
 * `copy` is the cached/downloaded {changedAt, refreshIntervalMsAtFetch}; optional. Each field is worked out on its own and
 * left out when it cannot be: a time-zone lookup or date format that throws, an unreadable time, or a formatted date that
 * is not four digits, two, two. Never throws, so computing the stamp can never turn a good reply into a failed one; an
 * absent field means "unknown" to the browser.
 */
function feedStamp_(fetchedAt, copy) {
  var stamp = {};
  var day = feedDay_(fetchedAt);
  if (day !== undefined) stamp.fetchedDate = day;
  try {
    stamp.refreshIntervalMs = refreshIntervalMs_(new Date());
  } catch (err) { /* left out */ }
  try {
    var changed = copy && isTimeString_(copy.changedAt) ? copy.changedAt : fetchedAt;
    var changedMs = Date.parse(changed);
    if (isFinite(changedMs)) {
      stamp.changedAt = new Date(changedMs).toISOString();
      var changedDay = feedDay_(changed);
      if (changedDay !== undefined) stamp.changedDate = changedDay;
    }
  } catch (err) { /* left out */ }
  var atFetch = copy ? copy.refreshIntervalMsAtFetch : undefined;
  if (typeof atFetch === 'number' && isFinite(atFetch) && atFetch > 0) stamp.refreshIntervalMsAtFetch = atFetch;
  return stamp;
}

/** Adds feedStamp_'s fields to `reply` (after the keys it already has, so existing keys keep their order) and returns it. */
function withFeedStamp_(reply, copy) {
  var stamp = feedStamp_(copy.fetchedAt, copy);
  if (stamp.fetchedDate !== undefined) reply.fetchedDate = stamp.fetchedDate;
  if (stamp.refreshIntervalMs !== undefined) reply.refreshIntervalMs = stamp.refreshIntervalMs;
  if (stamp.changedAt !== undefined) reply.changedAt = stamp.changedAt;
  if (stamp.changedDate !== undefined) reply.changedDate = stamp.changedDate;
  if (stamp.refreshIntervalMsAtFetch !== undefined) reply.refreshIntervalMsAtFetch = stamp.refreshIntervalMsAtFetch;
  return reply;
}

/** The data-free reply for `copy` ({hash, fetchedAt, changedAt?, refreshIntervalMsAtFetch?}) when the browser needs no data from it, else null. */
function feedNoData_(name, copy, have, notOlderThanMs) {
  var ageMs = feedAgeMs_(copy.fetchedAt);
  var base = withFeedStamp_({ ok: true, name: name, hash: copy.hash, fetchedAt: copy.fetchedAt, ageMs: ageMs }, copy);
  if (have && have === copy.hash) { base.unchanged = true; return base; }
  if (typeof notOlderThanMs === 'number' && ageMs > notOlderThanMs) { base.older = true; return base; }
  return null;
}

/** `text` is passed when the caller already holds the plain CSV (fresh download); otherwise it is unzipped from `b64`. */
function feedReply_(name, copy, b64, text, wantGzip) {
  var reply = withFeedStamp_({ ok: true, name: name, hash: copy.hash, fetchedAt: copy.fetchedAt, ageMs: feedAgeMs_(copy.fetchedAt) }, copy);
  if (wantGzip) { reply.encoding = 'gzip-base64'; reply.data = b64; return reply; }
  reply.encoding = 'text';
  reply.data = text !== null ? text : gunzipBase64_(b64);
  return reply;
}

/**
 * --- Shared Drive snapshot of the live feed, for the Vessel Planning Tool (2026-10-29) ---
 *
 * VPT reads the same Booking Flash live export and used to download it itself, about 48 times a
 * day. This trigger already downloads it, so it now also writes that copy to ONE Drive file that
 * VPT reads instead (one cheap metadata call, and the content only when the hash moved). Both apps
 * then show the same copy, and VPT keeps its own direct download as the fallback. No library: VPT
 * opens the file by id (the libraries cost too much per call; VPT ADR-040).
 *
 * The file (format version 1, shared with VPT; change it only together with VPT's BfFeed.js):
 *   name booking_flash_live.csv.gz, mimeType application/gzip, content = exactly the bytes the cache
 *   holds (gzip of the CSV text, UTF-8). Drive `properties` (public custom properties: VPT is
 *   another Apps Script project and cannot read `appProperties`):
 *     bfFormat 'csv-gzip-1', bfFeed 'live', bfHash = md5Hex_ of the UNZIPPED text (VPT's md5_ is the
 *     same algorithm, so the hashes match), bfFetchedAt = when this copy was downloaded from Google,
 *     bfChangedAt = when this content was first seen (else bfFetchedAt).
 *   A new hash: content and properties go in one Drive.Files.update, so a reader never sees new
 *   properties on old content. The same hash again (a newer download of identical content): only
 *   the properties are updated (a fresh bfFetchedAt keeps VPT inside its age limit), with no chunk
 *   read, no decode and no upload, so Drive keeps no new revision.
 *
 * The file id is kept stable, because VPT is set up with it: a trashed file is restored, a file
 * moved out of the folder is still written in place (logged), and a lost id (404) is looked up by
 * name in the folder before a new file is made. Only a brand-new id needs VPT's
 * VPT_BF_SNAPSHOT_FILE_ID updated; that is logged and recorded in bfrSnapshotStatus.idChanged.
 *
 * Script Properties:
 *   bfrSnapshotFolderId  the folder to write into. Blank = the whole feature is off: one property
 *                        read, no Drive call, no other read or write.
 *   bfrSnapshotFileId    the file's id, stored here when this code creates or finds the file.
 *   bfrSnapshotLast      JSON {hash, fetchedAt, changedAt, fileId} of the last copy published, so a
 *                        run with nothing new (a quiet-hours run that skipped the download) writes
 *                        nothing, and a new download of the same content updates only properties.
 *   bfrSnapshotStatus    JSON {at, ok, reason, fileId, idChanged, written, mode} of the last run that
 *                        was not 'off' (mode 'content' | 'properties', null when nothing was written):
 *                        where to look when VPT says it is reading the CSV directly.
 *
 * Who writes: only the time trigger (refreshDataFeeds, which runs as the admin who installed it and
 * can write the folder) and the editor-run publishFeedSnapshotNow. Visitors never write: the web
 * app runs as them and they only have Viewer on the folder.
 */
var FEED_SNAPSHOT_FOLDER_KEY_ = 'bfrSnapshotFolderId';
var FEED_SNAPSHOT_FILE_KEY_ = 'bfrSnapshotFileId';
var FEED_SNAPSHOT_LAST_KEY_ = 'bfrSnapshotLast';
var FEED_SNAPSHOT_STATUS_KEY_ = 'bfrSnapshotStatus';
var FEED_SNAPSHOT_NAME_ = 'booking_flash_live.csv.gz';
var FEED_SNAPSHOT_MIME_ = 'application/gzip';
var FEED_SNAPSHOT_FORMAT_ = 'csv-gzip-1';
var FEED_SNAPSHOT_LOCK_MS_ = 10000;

/**
 * Publishes the cached live copy to the snapshot file. Never throws. Returns {ok, reason?, fileId?, written, mode?, status?}:
 *   {ok:true,  reason:'off',            written:false}   bfrSnapshotFolderId is blank (nothing else was read or written)
 *   {ok:true,  reason:'no-fresh-copy',  written:false}   no fresh live copy in the cache to publish
 *   {ok:true,  reason:'unchanged',      written:false}   this copy (same fetchedAt) was already published
 *   {ok:true,  fileId, written:true, mode, created?:true, idChanged?:true}
 *                                                        written: mode 'content' (new hash, a new file, or force) or
 *                                                        'properties' (same hash: new bfFetchedAt only)
 *   {ok:false, reason:'busy'|'no-drive-service'|'error', error?, written:false}
 * Every run that is not 'off' also writes bfrSnapshotStatus and returns it as `status`.
 * opts.force (publishFeedSnapshotNow) writes the content even when bfrSnapshotLast says this copy is already out.
 */
function publishFeedSnapshot_(opts) {
  var force = !!(opts && opts.force);
  var props;
  var folderId;
  try {
    props = PropertiesService.getScriptProperties();
    folderId = String(props.getProperty(FEED_SNAPSHOT_FOLDER_KEY_) || '').trim();
  } catch (err) {
    return { ok: false, reason: 'error', error: String(err && err.message ? err.message : err), written: false };
  }
  if (!folderId) return { ok: true, reason: 'off', written: false };
  var result;
  try {
    result = publishFeedSnapshotRun_(props, folderId, force);
  } catch (err) {
    result = { ok: false, reason: 'error', error: String(err && err.message ? err.message : err), written: false };
  }
  result.status = writeFeedSnapshotStatus_(props, result);
  return result;
}

/** The body of publishFeedSnapshot_ once the feature is on. May throw (a Drive error); the caller turns that into a reply. */
function publishFeedSnapshotRun_(props, folderId, force) {
  // The Drive service must be the v3 advanced service (Files.create / Files.list; v2 has insert instead), checked before
  // any cache read or decode, so a wrongly set up project fails fast with a clear reason.
  if (typeof Drive === 'undefined' || !Drive || !Drive.Files ||
      typeof Drive.Files.create !== 'function' || typeof Drive.Files.list !== 'function') {
    return { ok: false, reason: 'no-drive-service', error: 'needs the Drive advanced service v3', written: false };
  }
  var meta = readFeedMeta_('live');
  if (!meta || !isFeedFresh_(meta)) return { ok: true, reason: 'no-fresh-copy', written: false };
  var last = null;
  try { last = JSON.parse(props.getProperty(FEED_SNAPSHOT_LAST_KEY_) || 'null'); } catch (err) { last = null; }
  if (!last || typeof last !== 'object') last = null;
  if (!force && last && last.fetchedAt === meta.fetchedAt) return { ok: true, reason: 'unchanged', written: false };

  var changedAt = isTimeString_(meta.changedAt) ? meta.changedAt : meta.fetchedAt;
  // Same content as the last copy published: keep the EARLIER first-seen time (a cache that lost the chain would
  // otherwise make the unchanged content look new).
  if (last && last.hash === meta.hash && isTimeString_(last.changedAt) && Date.parse(last.changedAt) < Date.parse(changedAt)) {
    changedAt = last.changedAt;
  }
  var properties = {
    bfFormat: FEED_SNAPSHOT_FORMAT_,
    bfFeed: 'live',
    bfHash: meta.hash,
    bfFetchedAt: meta.fetchedAt,
    bfChangedAt: changedAt
  };
  var lastFileId = last && typeof last.fileId === 'string' ? last.fileId : '';
  var sameContent = !force && !!last && last.hash === meta.hash && !!lastFileId;

  // The content (bytes) is read only when it has to be uploaded: a new hash, a new or re-found file, or force.
  var content = null;
  if (!sameContent) {
    content = readFeedSnapshotContent_(meta);
    if (content.reply) return content.reply;
  }

  // Get-or-create under the script lock, so two runs (the trigger and publishFeedSnapshotNow) never make two files.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(FEED_SNAPSHOT_LOCK_MS_)) {
    return { ok: false, reason: 'busy', error: 'another run holds the snapshot lock; next run', written: false };
  }
  var fileId;
  var storedId;
  var created = false;
  try {
    storedId = String(props.getProperty(FEED_SNAPSHOT_FILE_KEY_) || '').trim(); // re-read under the lock
    fileId = feedSnapshotFileId_(storedId, folderId);
    if (!fileId) {
      if (!content) {
        content = readFeedSnapshotContent_(meta);
        if (content.reply) return content.reply;
      }
      var made = Drive.Files.create({ name: FEED_SNAPSHOT_NAME_, mimeType: FEED_SNAPSHOT_MIME_, parents: [folderId], properties: properties },
        Utilities.newBlob(content.bytes, FEED_SNAPSHOT_MIME_, FEED_SNAPSHOT_NAME_), { supportsAllDrives: true });
      if (!made || !made.id) return { ok: false, reason: 'error', error: 'Drive created the snapshot file but returned no id.', written: false };
      fileId = made.id;
      created = true;
    }
    if (fileId !== storedId) props.setProperty(FEED_SNAPSHOT_FILE_KEY_, fileId);
  } finally {
    lock.releaseLock();
  }
  var idChanged = fileId !== storedId;
  if (idChanged) {
    console.log('Booking Flash snapshot file id is now ' + fileId + (storedId ? ' (was ' + storedId + ')' : '') +
      ': set the VPT Script Property VPT_BF_SNAPSHOT_FILE_ID to this id.');
  }

  var mode;
  if (created) {
    mode = 'content';
  } else if (sameContent && fileId === lastFileId) {
    Drive.Files.update({ properties: properties }, fileId, null, { supportsAllDrives: true });
    mode = 'properties';
  } else {
    if (!content) {
      content = readFeedSnapshotContent_(meta);
      if (content.reply) return content.reply;
    }
    Drive.Files.update({ properties: properties }, fileId, Utilities.newBlob(content.bytes, FEED_SNAPSHOT_MIME_, FEED_SNAPSHOT_NAME_),
      { supportsAllDrives: true });
    mode = 'content';
  }
  props.setProperty(FEED_SNAPSHOT_LAST_KEY_, JSON.stringify({ hash: meta.hash, fetchedAt: meta.fetchedAt, changedAt: changedAt, fileId: fileId }));
  var done = { ok: true, fileId: fileId, written: true, mode: mode };
  if (created) done.created = true;
  if (idChanged) done.idChanged = true;
  return done;
}

/**
 * The cached live copy's gzip bytes for `meta`: {bytes} or {reply} (no copy any more, or a copy that does not match the hash).
 * The meta and the chunks are two cache reads; a download landing in between would pair one copy's hash with another's
 * content. The content is checked against the hash, so the file's bfHash is always the md5 of what it holds (VPT re-checks
 * it and falls back to its own download on a mismatch).
 */
function readFeedSnapshotContent_(meta) {
  var b64 = readFeedChunks_('live', meta);
  if (b64 === null) return { reply: { ok: true, reason: 'no-fresh-copy', written: false } };
  var bytes = Utilities.base64Decode(b64);
  var text = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip', 'feed.csv.gz')).getDataAsString('UTF-8');
  if (md5Hex_(text) !== meta.hash) {
    return { reply: { ok: false, reason: 'busy', error: 'the cached copy changed while it was read; next run', written: false } };
  }
  return { bytes: bytes };
}

/**
 * The id of the snapshot file to write to, or '' when a new file must be created. Keeps the id stable (VPT is set up with
 * it): a trashed file is restored; a file moved out of the folder keeps being written in place (logged); a stored id Drive
 * does not know (404), or no stored id at all, is looked up by name in the folder and an earlier snapshot file there is
 * reused. Any OTHER Drive error (a hiccup, a quota) throws, so the run fails and the next one retries: creating a new file
 * on a passing error would give it a new id and quietly cut VPT off the old one. Called under the script lock.
 */
function feedSnapshotFileId_(storedId, folderId) {
  if (storedId) {
    var f = null;
    try {
      f = Drive.Files.get(storedId, { fields: 'id,trashed,parents', supportsAllDrives: true });
    } catch (err) {
      if (!isDriveNotFound_(err)) throw err;
      console.log('Booking Flash snapshot file ' + storedId + ' not found; looking for the snapshot file in the folder.');
    }
    if (f) {
      if (f.trashed) {
        Drive.Files.update({ trashed: false }, storedId, null, { supportsAllDrives: true });
        console.log('Booking Flash snapshot file ' + storedId + ' was in the trash; restored it (same id).');
      }
      if ((f.parents || []).indexOf(folderId) === -1) {
        console.log('Booking Flash snapshot file ' + storedId + ' is not in folder ' + folderId + '; still writing to it (same id).');
      }
      return storedId;
    }
  }
  var q = "'" + feedSnapshotQ_(folderId) + "' in parents and name = '" + feedSnapshotQ_(FEED_SNAPSHOT_NAME_) + "' and trashed = false";
  var list = Drive.Files.list({ q: q, fields: 'files(id,properties)', supportsAllDrives: true, includeItemsFromAllDrives: true });
  var files = (list && list.files) || [];
  for (var i = 0; i < files.length; i++) {
    if (files[i] && files[i].id && files[i].properties && files[i].properties.bfFormat === FEED_SNAPSHOT_FORMAT_) {
      console.log('Booking Flash snapshot file found in the folder by name: ' + files[i].id + '; reusing it.');
      return files[i].id;
    }
  }
  return '';
}

/** A Drive "not found": the advanced service's error details (code 404) first, the message text only as a fallback. */
function isDriveNotFound_(err) {
  if (err && err.details && err.details.code === 404) return true;
  return /not ?found|404/i.test(String(err && err.message ? err.message : err));
}

/** A value quoted for a Drive query: backslashes and single quotes escaped. */
function feedSnapshotQ_(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Writes bfrSnapshotStatus for one run and returns it. Never throws (a failed write is logged). */
function writeFeedSnapshotStatus_(props, r) {
  var status = {
    at: new Date().toISOString(),
    ok: !!r.ok,
    reason: r.reason || (r.written ? 'written' : ''),
    fileId: r.fileId || null,
    idChanged: !!r.idChanged,
    written: !!r.written,
    mode: r.written ? (r.mode || 'content') : null
  };
  if (r.error) status.error = String(r.error).slice(0, 500);
  try {
    props.setProperty(FEED_SNAPSHOT_STATUS_KEY_, JSON.stringify(status));
  } catch (err) {
    console.warn('Booking Flash snapshot status not saved: ' + err);
  }
  return status;
}

/**
 * Run from the Apps Script editor, as the admin (assertArchiveAdmin_ in Code.gs), once after setting bfrSnapshotFolderId:
 * downloads the live feed if the cache holds no fresh copy, then publishes it whatever bfrSnapshotLast says, and returns
 * (and logs) {ok, fileId, hash, fetchedAt, status}. Copy fileId into VPT's Script Property VPT_BF_SNAPSHOT_FILE_ID (only
 * needed the first time, or when status.idChanged is true). A failure returns {ok:false, reason, error} rather than
 * throwing (only the admin check throws).
 */
function publishFeedSnapshotNow() {
  assertArchiveAdmin_();
  var folderId = String(PropertiesService.getScriptProperties().getProperty(FEED_SNAPSHOT_FOLDER_KEY_) || '').trim();
  if (!folderId) {
    return { ok: false, reason: 'off', error: 'Set the Script Property ' + FEED_SNAPSHOT_FOLDER_KEY_ + ' to the snapshot folder id first.' };
  }
  var meta = readFeedMeta_('live');
  if (!meta || !isFeedFresh_(meta) || readFeedChunks_('live', meta) === null) {
    var got = downloadFeed_('live');
    if (!got.ok) return { ok: false, reason: got.reason, error: got.error };
  }
  var r = publishFeedSnapshot_({ force: true });
  var after = readFeedMeta_('live');
  var out = { ok: r.ok && r.written === true, fileId: r.fileId, hash: after ? after.hash : undefined, fetchedAt: after ? after.fetchedAt : undefined };
  if (!out.ok) { out.reason = r.reason; if (r.error) out.error = r.error; }
  if (r.created) out.created = true;
  if (r.status) out.status = r.status;
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * --- Empty Planning's EP_EXPORT, read by the trigger (D84 slice 2a-4, research idea X-4, ADR-R2; 2026-10-30) ---
 *
 * The Empty Planning app (a separate Apps Script project with its own Sheet) publishes a flat export tab, EP_EXPORT: one
 * row per VVD x port with the empties the desk declared. Its contract is VPT's new Build/docs/waves/WAVE_EP_2026-10-29.md,
 * C3, header exactly EP_EXPORT_COLUMNS_ below. ADR-R2: a second app's data is read here, on the refresh trigger, cached
 * like the live feed, and handed to the browser inside the getDataFeed reply with its own fetchedAt. The browser never
 * fetches it (one sign-in, one cache, one age chip). The client does not use it yet (slice 2b-2 will).
 *
 * Script Property:
 *   bfrEpExportUrl  the EP_EXPORT tab's Google Sheets URL: the editor URL with the tab open (.../spreadsheets/d/<id>/edit#gid=<n>)
 *                   or its publish-to-web URL (.../spreadsheets/d/e/<key>/pub?gid=<n>...). Blank = the feature is off: the
 *                   trigger makes no fetch and getDataFeed's reply is exactly what it was before this section existed.
 *   Only https://docs.google.com/spreadsheets/ URLs are accepted (epExportCsvUrl_); the URL actually fetched is rebuilt
 *   from the id and gid alone, so nothing else in the property (path, query, another host) is ever requested.
 *
 * Who fetches: only the installed time trigger running refreshDataFeeds (it runs as the admin who installed it) and the
 * editor-run refreshEpExportNow (admin only). refreshDataFeeds itself is public, and a visitor CAN call it through
 * google.script.run (it then runs as the visitor); that call still refreshes the other feeds as before, but the EP step is
 * skipped unless the event is one of the effective user's own installed refreshDataFeeds triggers (isOwnTriggerEvent_),
 * so a visitor's call never fetches, never uses the visitor's token and never writes the EP cache or error. An editor URL
 * is fetched with the admin's OAuth token (ScriptApp.getOAuthToken), so the admin needs view access to the Empty Planning
 * Sheet; a publish-to-web URL is fetched without any token. getDataFeed only READS the cache. A fetch runs under the
 * script lock (EP_EXPORT_LOCK_MS_ wait; a run that cannot get it skips), so two runs never fetch at once.
 *
 * Errors: the reply-visible error is a fixed short code ('fetch failed', 'http 403', 'not csv', 'missing column(s): x',
 * ...) that never contains the sheet id, the publish key or a URL; the detail (which can contain the fetched URL) goes
 * to console.error only.
 *
 * Cache: the parsed rows as gzipped JSON, chunked under the feed name 'epExport' with the same writeFeedCache_ /
 * readFeedMeta_ / readFeedChunks_ the live feed uses (3 hours, so a trigger that keeps failing ends in rows:[] rather than
 * old rows forever); the last failure under bfrFeed:epExport:error; and whether the property is set under
 * bfrFeed:epExport:cfg ('on'/'off', 10 minutes), so a visitor's poll does not read Script Properties every time.
 *
 * Reply (getDataFeed, name 'live' only, every reply to a valid live request): epExport = {rows, fetchedAt, hash} from the
 * cache, plus error when the last fetch after that copy failed; {rows: [], fetchedAt: null, error} when there is no copy.
 * A request may send haveEp (the hash it already holds): when it matches, epExport is {unchanged: true, fetchedAt, hash}
 * with no rows. Each row has every EP_EXPORT_COLUMNS_ key: the four TEU columns are numbers or null, everything else a
 * trimmed string or null (blank).
 */
var EP_EXPORT_URL_KEY_ = 'bfrEpExportUrl';
var EP_EXPORT_FEED_ = 'epExport';
var EP_EXPORT_COLUMNS_ = ['as_of', 'vvd', 'lane', 'group', 'port', 'port_key', 'terminal', 'terminal_name', 'empties',
  'export_laden', 'prelim_dec', 'prelim_teu', 'final_dec', 'final_teu', 'cutoff', 'etd', 'note', 'remark'];
var EP_EXPORT_NUMBER_COLUMNS_ = ['empties', 'export_laden', 'prelim_teu', 'final_teu'];
var EP_EXPORT_MAX_ROWS_ = 5000;
var EP_EXPORT_CFG_SECONDS_ = 10 * 60;

/**
 * Pure (no Apps Script service): the parsed EP_EXPORT CSV. Header-mapped (any column order, header case and surrounding
 * spaces ignored, extra columns ignored); every EP_EXPORT_COLUMNS_ column is required. Rows with no vvd are skipped and
 * counted; a TEU cell that is not a plain number becomes null and is counted in badNumbers.
 * Returns {ok:true, rows, skipped, badNumbers} or {ok:false, error}.
 */
function parseEpExportCsv_(text) {
  if (typeof text !== 'string') return { ok: false, error: 'no CSV text' };
  var t = text.replace(/^﻿/, '');
  if (!t.trim()) return { ok: false, error: 'empty CSV' };
  if (t.replace(/^\s+/, '').charAt(0) === '<') return { ok: false, error: 'not a CSV (an HTML page: no access, or a sign-in page)' };
  var records = parseCsvRecords_(t);
  var header = records[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var index = {};
  header.forEach(function (h, i) { if (h && !Object.prototype.hasOwnProperty.call(index, h)) index[h] = i; });
  var missing = EP_EXPORT_COLUMNS_.filter(function (c) { return !Object.prototype.hasOwnProperty.call(index, c); });
  if (missing.length) return { ok: false, error: 'EP_EXPORT is missing column(s): ' + missing.join(', ') };
  if (records.length - 1 > EP_EXPORT_MAX_ROWS_) return { ok: false, error: 'EP_EXPORT has more than ' + EP_EXPORT_MAX_ROWS_ + ' rows' };
  var rows = [];
  var skipped = 0;
  var badNumbers = 0;
  for (var r = 1; r < records.length; r++) {
    var rec = records[r];
    var blank = true;
    for (var b = 0; b < rec.length; b++) if (String(rec[b]).trim()) { blank = false; break; }
    if (blank) continue;
    var row = {};
    EP_EXPORT_COLUMNS_.forEach(function (c) {
      var v = rec[index[c]];
      v = v === undefined ? '' : String(v).trim();
      if (EP_EXPORT_NUMBER_COLUMNS_.indexOf(c) !== -1) {
        if (v === '') row[c] = null;
        else if (/^-?\d+(\.\d+)?$/.test(v)) row[c] = Number(v);
        else { row[c] = null; badNumbers++; }
      } else {
        row[c] = v === '' ? null : v;
      }
    });
    if (!row.vvd) { skipped++; continue; }
    rows.push(row);
  }
  return { ok: true, rows: rows, skipped: skipped, badNumbers: badNumbers };
}

/** Pure: RFC 4180 records (quoted commas, quotes and newlines; \n or \r\n). Always at least one record. */
function parseCsvRecords_(text) {
  var records = [];
  var rec = [];
  var field = '';
  var inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { rec.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      rec.push(field); field = '';
      records.push(rec); rec = [];
    } else field += c;
  }
  if (field !== '' || rec.length) { rec.push(field); records.push(rec); }
  if (!records.length) records.push(['']);
  return records;
}

/**
 * Pure: the CSV URL to fetch for the bfrEpExportUrl value, rebuilt from the sheet id (or publish key) and gid only.
 * {url, auth} (auth true = send the admin's token: an editor URL; false = a publish-to-web URL) or {error}.
 * Anything that is not https://docs.google.com/spreadsheets/d/... is refused.
 */
function epExportCsvUrl_(raw) {
  var s = String(raw || '').trim();
  if (!s) return { error: 'bfrEpExportUrl is blank' };
  var m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/(e\/)?([A-Za-z0-9_-]{10,})(?:[/?#]|$)/.exec(s);
  if (!m) return { error: 'bfrEpExportUrl must be a https://docs.google.com/spreadsheets/d/... URL' };
  var g = /[?#&]gid=(\d+)/.exec(s);
  var gid = g ? g[1] : '';
  if (m[1]) {
    return { url: 'https://docs.google.com/spreadsheets/d/e/' + m[2] + '/pub?' + (gid ? 'gid=' + gid + '&single=true&' : '') + 'output=csv', auth: false };
  }
  return { url: 'https://docs.google.com/spreadsheets/d/' + m[2] + '/export?format=csv' + (gid ? '&gid=' + gid : ''), auth: true };
}

/** The raw bfrEpExportUrl value ('' when unset or unreadable). */
function epExportUrlProperty_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(EP_EXPORT_URL_KEY_) || '').trim();
  } catch (err) {
    return '';
  }
}

/** Whether bfrEpExportUrl is set, from the 10-minute cache flag when present (visitor path: no property read per poll). */
function epExportConfigured_() {
  var cache = CacheService.getScriptCache();
  var flag = null;
  try { flag = cache.get(dataFeedKey_(EP_EXPORT_FEED_, 'cfg')); } catch (err) { flag = null; }
  if (flag === 'on') return true;
  if (flag === 'off') return false;
  var on = !!epExportUrlProperty_();
  try { cache.put(dataFeedKey_(EP_EXPORT_FEED_, 'cfg'), on ? 'on' : 'off', EP_EXPORT_CFG_SECONDS_); } catch (err) { /* re-read next time */ }
  return on;
}

/**
 * Records a failed fetch. `code` is the reply-visible error: a fixed short text that must never hold the sheet id, the
 * publish key or a URL. `detail` (which may hold the fetched URL) goes to console.error only. Never throws.
 */
function recordEpExportError_(code, detail) {
  try {
    CacheService.getScriptCache().put(dataFeedKey_(EP_EXPORT_FEED_, 'error'),
      JSON.stringify({ error: String(code).slice(0, 200), at: new Date().toISOString() }), DATA_FEED_CACHE_SECONDS_);
  } catch (err) { /* the log line is enough */ }
  console.error('EP_EXPORT: ' + code + (detail ? ' (' + detail + ')' : ''));
}

/** How long a fetch waits for the script lock before skipping (another run, the snapshot or a note save holds it). */
var EP_EXPORT_LOCK_MS_ = 5000;

/**
 * Trigger side: called only by refreshDataFeeds for its own installed trigger (isOwnTriggerEvent_) and by the admin-only
 * refreshEpExportNow; never reachable from a visitor's call. Never throws. Returns {ok:true, reason:'off'|'skipped'|'busy'}
 * or {ok:true, rows, skipped, badNumbers} or {ok:false, error} (error = the reply-visible code). opts.quiet (quiet hours)
 * skips a copy younger than DATA_FEED_QUIET_SKIP_MS_, the live feed's rule; opts.force ignores that. The fetch, parse and
 * cache write run under the script lock; a run that cannot get it within EP_EXPORT_LOCK_MS_ skips and writes nothing.
 */
function refreshEpExport_(opts) {
  var lock = null;
  try {
    var cache = CacheService.getScriptCache();
    var raw = epExportUrlProperty_();
    if (!raw) {
      // Off. Only an 'on' flag needs undoing (the property was just cleared); otherwise nothing is written.
      var was = null;
      try { was = cache.get(dataFeedKey_(EP_EXPORT_FEED_, 'cfg')); } catch (err) { was = null; }
      if (was === 'on') {
        try { cache.put(dataFeedKey_(EP_EXPORT_FEED_, 'cfg'), 'off', EP_EXPORT_CFG_SECONDS_); } catch (err) { /* expires */ }
      }
      return { ok: true, reason: 'off' };
    }
    try { cache.put(dataFeedKey_(EP_EXPORT_FEED_, 'cfg'), 'on', EP_EXPORT_CFG_SECONDS_); } catch (err) { /* re-read later */ }
    if (opts && opts.quiet && !opts.force) {
      var meta = readFeedMeta_(EP_EXPORT_FEED_);
      if (meta && isFinite(Date.parse(meta.fetchedAt)) && feedAgeMs_(meta.fetchedAt) < DATA_FEED_QUIET_SKIP_MS_) return { ok: true, reason: 'skipped' };
    }
    var target = epExportCsvUrl_(raw);
    if (target.error) { recordEpExportError_(target.error); return { ok: false, error: target.error }; }
    var candidate = LockService.getScriptLock();
    if (!candidate.tryLock(EP_EXPORT_LOCK_MS_)) {
      console.warn('EP_EXPORT: the script lock is held; skipped this run');
      return { ok: true, reason: 'busy' };
    }
    lock = candidate;
    var text;
    var code;
    try {
      var params = { muteHttpExceptions: true, followRedirects: true };
      if (target.auth) params.headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
      var res = UrlFetchApp.fetch(target.url, params);
      code = res.getResponseCode();
      if (code === 200) text = res.getContentText('UTF-8');
    } catch (err) {
      recordEpExportError_('fetch failed', String(err && err.message ? err.message : err));
      return { ok: false, error: 'fetch failed' };
    }
    if (code !== 200) {
      var httpCode = 'http ' + (Number(code) || 0);
      recordEpExportError_(httpCode);
      return { ok: false, error: httpCode };
    }
    var parsed = parseEpExportCsv_(text);
    if (!parsed.ok) { recordEpExportError_(parsed.error); return { ok: false, error: parsed.error }; }
    var json = JSON.stringify(parsed.rows);
    var fetchedAt = new Date().toISOString();
    writeFeedCache_(EP_EXPORT_FEED_, md5Hex_(json), fetchedAt, gzipBase64_(json));
    try { cache.remove(dataFeedKey_(EP_EXPORT_FEED_, 'error')); } catch (err) { /* expires */ }
    if (parsed.skipped || parsed.badNumbers) {
      console.warn('EP_EXPORT: ' + parsed.skipped + ' row(s) without a vvd skipped, ' + parsed.badNumbers + ' TEU cell(s) not a number (null)');
    }
    return { ok: true, rows: parsed.rows.length, skipped: parsed.skipped, badNumbers: parsed.badNumbers };
  } catch (err) {
    recordEpExportError_('internal error', String(err && err.message ? err.message : err));
    return { ok: false, error: 'internal error' };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (err) { /* released when the run ends */ } }
  }
}

/** Visitor side: the cached copy as the reply's epExport value. Reads the cache only; never fetches. */
function readEpExport_(haveEp) {
  var errRec = null;
  try { errRec = JSON.parse(CacheService.getScriptCache().get(dataFeedKey_(EP_EXPORT_FEED_, 'error')) || 'null'); } catch (err) { errRec = null; }
  var meta = readFeedMeta_(EP_EXPORT_FEED_);
  var b64 = meta ? readFeedChunks_(EP_EXPORT_FEED_, meta) : null;
  if (!meta || b64 === null) {
    return { rows: [], fetchedAt: null, error: errRec && errRec.error ? errRec.error : 'not fetched yet (the refresh trigger has not run since bfrEpExportUrl was set)' };
  }
  var out = (typeof haveEp === 'string' && haveEp === meta.hash)
    ? { unchanged: true, fetchedAt: meta.fetchedAt, hash: meta.hash }
    : { rows: JSON.parse(gunzipBase64_(b64)), fetchedAt: meta.fetchedAt, hash: meta.hash };
  if (errRec && errRec.error && Date.parse(errRec.at) > Date.parse(meta.fetchedAt)) out.error = errRec.error;
  return out;
}

/**
 * Adds epExport to a reply for a valid 'live' request when bfrEpExportUrl is set; otherwise returns `reply` untouched (the
 * same object). Never throws and never changes any other field of the reply.
 */
function withEpExport_(request, reply) {
  if (!reply || typeof reply !== 'object' || !request || typeof request !== 'object' || request.name !== 'live') return reply;
  if (reply.ok === false && reply.reason === 'invalid-request') return reply;
  var on = false;
  try { on = epExportConfigured_(); } catch (err) { on = false; }
  if (!on) return reply;
  try {
    reply.epExport = readEpExport_(request.haveEp);
  } catch (err) {
    reply.epExport = { rows: [], fetchedAt: null, error: 'cache read failed: ' + String(err && err.message ? err.message : err) };
  }
  return reply;
}

/**
 * Run from the Apps Script editor, as the admin (assertArchiveAdmin_), once after setting bfrEpExportUrl: fetches EP_EXPORT
 * now (ignoring quiet hours) and returns and logs {ok, rows, skipped, badNumbers} or {ok:false, error}.
 */
function refreshEpExportNow() {
  assertArchiveAdmin_();
  var r = refreshEpExport_({ force: true });
  console.log(JSON.stringify(r, null, 2));
  return r;
}

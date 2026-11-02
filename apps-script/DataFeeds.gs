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
 */
function getDataFeed(request) {
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
 * downloading. Logs instead of throwing: a trigger that throws emails its owner every run.
 */
function refreshDataFeeds() {
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

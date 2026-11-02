/**
 * Serves the Booking Flash Report as a Google Apps Script Web App.
 *
 * This is intentionally tiny: the app fetches its data client-side (via
 * fetch() against the published Sheet CSV link, see CSV_SOURCE_URL in the
 * main HTML file), so this script has no server-side data access at all --
 * its only job is to serve the app's HTML to whoever opens the Web App URL.
 *
 * Access control happens entirely at the deployment level ("Who has
 * access" = Anyone within the organization, set at Deploy time), not in
 * this code.
 *
 * --- 2026-09-10: two small additions to support the app's "new version"
 * banner (see index.html's appUpdateAvailable/checkForAppUpdate comments for
 * the full story; this file only needs to know the "why" from the server
 * side) ---
 *
 * Apps Script's HtmlService always renders the app inside a nested sandbox
 * iframe served from a transient *.googleusercontent.com origin, DIFFERENT
 * from the stable "/exec" URL the user actually opened (and it's the
 * "/exec" URL that stays a fixed top-level document; the sandboxed content
 * can even change origin between page loads). That means two things the
 * client-side JS cannot discover on its own:
 *   1. Its own `window.location.href` is that throwaway sandbox URL, not
 *      the real page -- useless as a target for reload navigation and
 *      useless as a fetch target for detecting a new deploy (see below).
 *   2. Apps Script's sandbox does not grant `allow-top-navigation`, so even
 *      if the client *could* figure out the real URL, it cannot script its
 *      way to the top-level window -- Google's own docs say the supported
 *      escape is a genuine `<a target="_top">` link, not JS.
 *
 * So this file hands the client what it structurally cannot get itself:
 *   - `window.__EXEC_URL__`, the real "/exec" URL, via ScriptApp.getService()
 *     .getUrl() -- injected as a plain inline <script> tag by simple string
 *     insertion (see injectExecUrl_ below), NOT via HtmlService's template
 *     scriptlets (`<?= ?>`). That's deliberate: this repo's app file is one
 *     ordinary, self-contained HTML file that also has to run unmodified on
 *     every OTHER deploy path (local dev server, plain static hosting -- see
 *     README.md) with no server-side templating step at all. Baking a GAS
 *     scriptlet into index.html itself would break every one of those paths
 *     (a browser loading the raw file would try to execute the literal,
 *     invalid `<?!= ... ?>` text as JavaScript). Doing the injection here
 *     instead means index.html in this repo and the copy pasted into the
 *     Apps Script editor stay byte-identical, exactly as apps-script/
 *     README.md's setup steps assume.
 *   - A tiny `?check=version` endpoint the client can poll instead of the
 *     ~500KB page itself, returning an MD5 of index.html's own real
 *     content. Computed fresh from the file every request -- NOT a
 *     hand-maintained version constant -- so, same as the client-side
 *     design it replaces for this deploy path, nobody has to remember to
 *     bump anything on a future edit. Since 2026-10-06 the same value is also
 *     returned by getAppVersionHash() for google.script.run, because under
 *     "User accessing the web app" a plain fetch() of /exec most likely gets
 *     a sign-in page (see that function).
 *
 * The client is written to degrade gracefully if this file's version isn't
 * the one actually deployed yet (an old deployment just serves the full
 * page for any query string, including "?check=version", since old doGet
 * ignores unrecognized parameters) -- see checkForAppUpdate's comment. So
 * this update is required for the update-checker/reload-banner fix to take
 * effect on the Apps Script deploy path (see apps-script/README.md), but
 * forgetting to redeploy fails safe rather than breaking anything.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.check === 'version') {
    return ContentService.createTextOutput(getIndexVersionHash_())
      .setMimeType(ContentService.MimeType.TEXT);
  }
  if (e && e.parameter && e.parameter.archive === 'index') {
    return ContentService.createTextOutput(JSON.stringify(archiveIndexResponse_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.archive === 'day') {
    return archiveDayResponse_(e.parameter.date);
  }
  var execUrl = ScriptApp.getService().getUrl();
  var html = injectExecUrl_(HtmlService.createHtmlOutputFromFile('index').getContent(), execUrl);
  // injectServerPrefs_ re-searches `html` for the same babel marker that
  // injectExecUrl_ just inserted text in front of. That's safe, not
  // coincidental: injectExecUrl_ only ever prepends bytes strictly BEFORE
  // the marker string and never touches the marker text itself, so the
  // marker is still found at whatever (now larger) index it lives at, and
  // the __SERVER_PREFS__ tag lands immediately before it -- i.e. immediately
  // AFTER the __EXEC_URL__ tag this call already placed. Both tags therefore
  // end up before `<script type="text/babel">`, which is the one hard
  // requirement (the babel-transformed app script is what reads them, and
  // it must see both globals already set when it starts running).
  // One read of the visitor's stored values, shared by both injections (2026-10-07, see readVisitorContext_).
  var visitor = readVisitorContext_();
  html = injectServerPrefs_(html, readUserPrefs_(visitor));
  html = injectServerExtras_(html, readServerExtras_(visitor));
  // A shared view link (?view=v1.<payload>.<check>, roadmap 4.2): handed to the page only when it
  // is a well-formed link, otherwise html comes back byte for byte unchanged. Never throws.
  html = injectSharedView_(html, sharedViewParam_(e));
  // Admin-editable thresholds and exclusions from the config Sheet (TeamSheet.gs); the app falls back to its own defaults when unavailable.
  // typeof guard: a Code.gs pasted without TeamSheet.gs must still serve the page, not a ReferenceError.
  if (typeof readAppConfig_ === 'function') html = injectAppConfig_(html, readAppConfig_());
  return HtmlService.createHtmlOutput(html)
    .setTitle('Booking Flash Report NA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * MD5 of index.html's real, current content, as lowercase hex. Recomputed
 * from the live file on every call -- there is nothing to keep in sync by
 * hand. Utilities.computeDigest returns signed bytes (Apps Script's
 * underlying Java `byte` is signed -128..127), so each byte is normalized
 * into 0..255 before hex-encoding.
 */
function getIndexVersionHash_() {
  var content = HtmlService.createHtmlOutputFromFile('index').getContent();
  var digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, content, Utilities.Charset.UTF_8);
  return digestBytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

/**
 * Public, for google.script.run (2026-10-06): the same value `?check=version`
 * answers with, i.e. getIndexVersionHash_()'s 32-character lowercase hex MD5
 * of index.html, as a plain string (e.g. "9e107d9d372bb6826bd81d3542a419d6").
 * Under "Execute as: User accessing the web app" a plain fetch() of /exec
 * from the sandboxed page carries no sign-in and most likely gets Google's
 * sign-in page back instead of the hash (UNCONFIRMED on /exec, see
 * apps-script/README.md), so the app's "new version" banner cannot rely on
 * `?check=version`; google.script.run runs as the signed-in visitor. The
 * `?check=version` route stays for pages already open from older builds.
 *
 * Not cached in CacheService, on purpose (2026-10-07, code review of #190):
 * the script cache is one store for every deployed version, so a hash cached
 * by the old version could be served by the new one (and back again while
 * tabs from both are open), which the page's instability guard reads as a
 * flapping signal and switches the banner off. Every open tab polls once per
 * APP_UPDATE_POLL_INTERVAL_MS (5 min), and the cost of a call is mostly the
 * google.script.run round trip itself, which a cache would not remove.
 */
function getAppVersionHash() {
  return getIndexVersionHash_();
}

/**
 * Inserts `<script>window.__EXEC_URL__="...";</script>` immediately before
 * index.html's own `<script type="text/babel">` tag, via plain string
 * insertion (see this file's top comment for why not a GAS template
 * scriptlet). Runs as an ordinary, non-Babel script so it executes
 * immediately and __EXEC_URL__ is already set before the app's own script
 * body runs. If the marker isn't found (someone restructured index.html's
 * opening tags in a way this no longer matches), serves the content
 * unmodified rather than guessing at an insertion point -- the app already
 * treats a missing/undefined __EXEC_URL__ as "not available," which is the
 * same safe fallback this would produce anyway.
 */
function injectExecUrl_(html, execUrl) {
  var marker = '<script type="text/babel">';
  var idx = html.indexOf(marker);
  if (idx === -1) return html;
  var tag = '<script>window.__EXEC_URL__=' + JSON.stringify(execUrl) + ';</script>\n    ';
  return html.slice(0, idx) + tag + html.slice(idx);
}


/**
 * --- Server-backed preferences (see docs/SERVER_PREFS_CONTRACT.md, the
 * frozen interface this section implements exactly) ---
 *
 * These three booleans (dark mode, auto-refresh, freeze panes) used to live
 * only in localStorage, which is why they periodically "reset": localStorage
 * is per-browser-profile, so a new machine, a different browser, or a
 * cleared profile is a blank slate. This section gives each Workspace user
 * a server-side copy, keyed to THEM, that survives all of that.
 *
 * WHERE EACH VISITOR'S VALUES LIVE (rewritten 2026-10-06) -- this is the
 * central design point, so it gets its own paragraphs.
 *
 * Now: PropertiesService.getUserProperties(), the store of the account the
 * script RUNS AS. The deployment runs as "User accessing the web app"
 * (2026-09-28; see "DEPLOYMENT MODE" above readServerExtras_), so the script
 * runs as the visitor and each visitor gets a store of their own, with its
 * own 500 KB quota, that no other visitor can read. Keys there are
 * "bfrPref:<preference name>" (visitorStoreKey_) with no email in them: the
 * store itself is the isolation.
 *
 * Guarded, not assumed: visitorUserStore_ hands that store out only when the
 * effective user (who the script runs as) IS the active user (the visitor),
 * the same guard private VVD notes use (privateNotesStore_ in TeamSheet.gs
 * calls it). If the deployment were switched back to "Execute as: Me", the
 * effective user would be the owner and getUserProperties() the OWNER's
 * store, shared by every visitor -- one person's dark-mode toggle flipping it
 * for the whole org, invisible to every client-side test because the server
 * would store a value and hand it back correctly. The guard refuses that, and
 * every read and write here then falls back to the old design, unchanged.
 *
 * Before (2026-09-16 to 2026-10-06), and still the fallback: the script-
 * global store, getScriptProperties(), with per-user isolation made by
 * namespacing each key with the visitor's email ("bfrPref:<email>:<name>",
 * prefStoreKeyFor_). It was chosen while the deployment ran as "Execute as:
 * Me", when Google's description of getUserProperties() ("the current or
 * effective user") left open whose store a visitor would get. It isolated
 * users, but the script store's 500 KB total is shared by EVERYONE, admin
 * keys included: with the filter-prefs blob at up to 8,000 bytes a person,
 * about 60 heavy users fill it, and then every pref save and every admin
 * property write fails. Under "User accessing" that question is answered by
 * the deployment itself (the script runs as the visitor), which is what
 * makes the user store safe now; the guard covers a deployment change.
 *
 * Migration from the old keys is lazy and per visitor (readVisitorValues_ /
 * writeVisitorValue_): a read that finds nothing in the user store but finds
 * the visitor's OWN old email-namespaced script key returns that value,
 * copies it into the user store, and deletes the script key only once the
 * copy reads back; a write goes to the user store and deletes any leftover
 * script key for that visitor. Only keys built from the caller's own
 * server-resolved email are ever read or deleted, never another visitor's.
 * Once every old key found has moved, LEGACY_CHECKED_KEY_ in the user store
 * stops the script-store lookups for good (2026-10-07). Its one limit: if the
 * deployment ever ran as "Execute as: Me" again, values saved meanwhile go to
 * script keys, and switching back would not move them for visitors who already
 * carry the marker (their user-store values, or the defaults, would show).
 *
 * Identity is still resolved server-side on every call, never taken from
 * the client (see saveUserPref), and a blank identity still fails closed:
 * the old keys need the email, and the guard needs it to compare.
 *
 * Namespace: keys are prefixed with "bfrPref:" in both stores so that every
 * entry this feature ever writes is trivially greppable and bulk-deletable
 * (e.g. if the feature is ever removed, or a user needs their stored prefs
 * wiped) without risk of colliding with or sweeping up unrelated properties.
 */

/**
 * The three preference keys this feature persists, unchanged from the
 * names localStorage has always used for them. Shared by readUserPrefs_
 * and saveUserPref so the allowed set is defined in exactly one place.
 */
var USER_PREF_KEYS_ = [
  'bookingFlashDarkMode',
  'bookingFlashAutoRefresh',
  'bookingFlashFreezePanes'
];

/**
 * The OLD (and fallback) script-property key for one visitor and one
 * preference, e.g. "bfrPref:jane@example.com:bookingFlashDarkMode". `email`
 * is exactly what Session returned, as the old writer used it.
 */
function prefStoreKeyFor_(email, key) {
  return 'bfrPref:' + email + ':' + key;
}

/** The key for one preference in the visitor's OWN user store, e.g. "bfrPref:bookingFlashDarkMode". */
function visitorStoreKey_(key) {
  return 'bfrPref:' + key;
}

/**
 * The visitor's own PropertiesService.getUserProperties() store, or null when
 * the script is not running as the visitor: no resolvable visitor, the
 * effective user can't be read, or it is a different account (as under
 * "Execute as: Me"). Throws only if getUserProperties() itself throws.
 * Also the guard for private VVD notes (privateNotesStore_ in TeamSheet.gs).
 * `email`, when given, is the visitor's already-resolved email
 * (activeUserEmail_()), which saves one Session lookup.
 */
function visitorUserStore_(email) {
  var me = email || activeUserEmail_();
  if (!me) return null;
  var effective = null;
  try {
    effective = Session.getEffectiveUser().getEmail();
  } catch (err) {
    return null;
  }
  if (!effective || String(effective).toLowerCase() !== me.toLowerCase()) return null;
  return PropertiesService.getUserProperties();
}

/**
 * The user-store key that records "this visitor's old script keys have been
 * checked and moved" (2026-10-07). Without it, every key a visitor has never
 * saved cost one extra script-store read on every page load, forever.
 */
var LEGACY_CHECKED_KEY_ = 'bfrPref:legacyChecked';

/**
 * A user property the removed `?check=identity` probe left behind (an email
 * address and a time; see apps-script/README.md, "`?check=identity` was
 * removed"). A user property can only be deleted by code running as that
 * account, so readVisitorValues_ deletes it from the visitor's own store the
 * next time they load the page: it is in the same getProperties() reply, so
 * this costs nothing when it is absent.
 */
var PROBE_LEFTOVER_KEY_ = 'bookingFlashIdentityProbeStamp';

/**
 * The stored values for `keys`, as { <key>: string or null (never stored) },
 * for the visitor `email`. `userStore` is visitorUserStore_()'s result; null
 * means the old script-store keys, read exactly as before (one getProperty
 * per key). Otherwise ONE getProperties() call on the visitor's own store
 * (2026-10-07, code review of #190: this used to be one call per key, plus a
 * script-store read for every key never saved, on every page load), and,
 * until LEGACY_CHECKED_KEY_ is set, the lazy migration described above for
 * the keys the user store lacks. The marker is written only once every old
 * key found has been copied and deleted, so a failed copy is retried on the
 * next load. `keys` must be every key that has old script keys (doGet passes
 * all four), or the marker would stop the others from ever moving.
 * Throws when a store throws on a READ. A failed migration copy is not an
 * error: the old key is kept and its value returned, so nothing is lost.
 */
function readVisitorValues_(userStore, email, keys) {
  var out = {};
  var i;
  if (!userStore) {
    var fallbackProps = PropertiesService.getScriptProperties();
    for (i = 0; i < keys.length; i++) out[keys[i]] = fallbackProps.getProperty(prefStoreKeyFor_(email, keys[i]));
    return out;
  }
  var all = userStore.getProperties() || {};
  var missing = [];
  for (i = 0; i < keys.length; i++) {
    var value = all[visitorStoreKey_(keys[i])];
    if (value !== null && value !== undefined) {
      out[keys[i]] = value;
    } else {
      out[keys[i]] = null;
      missing.push(keys[i]);
    }
  }
  if (all[PROBE_LEFTOVER_KEY_] !== undefined) {
    try { userStore.deleteProperty(PROBE_LEFTOVER_KEY_); } catch (err) { /* harmless: tried again next load */ }
  }
  if (missing.length === 0 || all[LEGACY_CHECKED_KEY_] === '1') return out;
  var scriptProps = PropertiesService.getScriptProperties();
  var allMoved = true;
  for (i = 0; i < missing.length; i++) {
    var legacyKey = prefStoreKeyFor_(email, missing[i]);
    var legacy = scriptProps.getProperty(legacyKey);
    if (legacy === null || legacy === undefined) continue;
    out[missing[i]] = legacy;
    try {
      userStore.setProperty(visitorStoreKey_(missing[i]), legacy);
      if (userStore.getProperty(visitorStoreKey_(missing[i])) === legacy) scriptProps.deleteProperty(legacyKey);
      else allMoved = false;
    } catch (err) { allMoved = false; /* copy or delete failed: the old key stays, so the value is not lost */ }
  }
  if (allMoved) {
    try { userStore.setProperty(LEGACY_CHECKED_KEY_, '1'); } catch (err) { /* checked again next load */ }
  }
  return out;
}

/**
 * Everything a page load needs about the visitor, read once (doGet hands it
 * to readUserPrefs_ and readServerExtras_; 2026-10-07, before which each
 * resolved the visitor and read the stores on its own):
 *   { email, values: { <key>: string|null } }   or   { email, error: <reason> }
 * with error 'no-user-identity' or 'properties-unavailable'. Never throws.
 */
function readVisitorContext_() {
  var email = activeUserEmail_();
  if (!email) return { email: null, error: 'no-user-identity' };
  try {
    var keys = USER_PREF_KEYS_.concat([FILTER_PREFS_KEY_]);
    return { email: email, values: readVisitorValues_(visitorUserStore_(email), email, keys) };
  } catch (err) {
    return { email: email, error: 'properties-unavailable' };
  }
}

/**
 * Stores `value` (a string), or deletes it when `value` is null, for the
 * visitor `email`. Throws when the write fails. With a user store it also
 * deletes the visitor's leftover old script key: after a set, a failed
 * leftover delete is ignored (the user store's value wins every later read);
 * after a delete it throws, because the next read would migrate the leftover
 * back and undo the delete.
 */
function writeVisitorValue_(userStore, email, key, value) {
  var legacyKey = prefStoreKeyFor_(email, key);
  if (!userStore) {
    var props = PropertiesService.getScriptProperties();
    if (value === null) props.deleteProperty(legacyKey); else props.setProperty(legacyKey, value);
    return;
  }
  if (value === null) {
    userStore.deleteProperty(visitorStoreKey_(key));
    PropertiesService.getScriptProperties().deleteProperty(legacyKey);
    return;
  }
  userStore.setProperty(visitorStoreKey_(key), value);
  try {
    PropertiesService.getScriptProperties().deleteProperty(legacyKey);
  } catch (err) { /* harmless leftover: the user store's value is read first */ }
}

/**
 * Resolves the visiting user's stored preferences for injection into the
 * page. Returns the exact shapes docs/SERVER_PREFS_CONTRACT.md specifies:
 *   { available: true, values: { <key>: '1'|'0'|null, ... } }
 *   { available: false, reason: '...' }
 * Never throws -- every failure mode (blank/unresolvable identity,
 * PropertiesService unavailable) is converted to available:false here, so
 * doGet can inject the result unconditionally. A blank email, one with no
 * '@' (Session.getActiveUser().getEmail() documents "" as its failure
 * return, not a throw; under "User accessing the web app" the visitor is
 * the account the script runs as, so it resolves -- guarding here anyway
 * costs nothing and protects any future deployment where it doesn't), or a thrown
 * error are all treated identically: there is no per-user key available, so
 * fail closed rather than fall back to any shared/global key.
 * `visitor` is readVisitorContext_()'s result (doGet passes it so the stores
 * are read once per page load); omitted, it is read here.
 */
function readUserPrefs_(visitor) {
  visitor = visitor || readVisitorContext_();
  if (visitor.error) return { available: false, reason: visitor.error };
  var values = {};
  for (var i = 0; i < USER_PREF_KEYS_.length; i++) {
    var raw = visitor.values[USER_PREF_KEYS_[i]];
    // getProperty returns null for "never stored," which is already the
    // contract's null. Anything that isn't exactly '1' or '0' (there
    // should never be such a value, since saveUserPref is the only writer
    // and it validates -- but this is the read path, so it does not
    // trust that invariant) collapses to null rather than leaking a
    // malformed string to the client.
    values[USER_PREF_KEYS_[i]] = (raw === '1' || raw === '0') ? raw : null;
  }
  return { available: true, values: values };
}

/**
 * Inserts `<script>window.__SERVER_PREFS__=...;</script>` immediately
 * before index.html's `<script type="text/babel">` tag -- same mechanism,
 * same marker, and same failure posture as injectExecUrl_ above (see that
 * function's comment for why plain string insertion instead of a GAS
 * template scriptlet). If the marker isn't found, the html is returned
 * unmodified rather than guessing at an insertion point; the client already
 * treats a missing __SERVER_PREFS__ global as "not available," so this
 * produces the same safe fallback it would anyway.
 */
function injectServerPrefs_(html, prefs) {
  var marker = '<script type="text/babel">';
  var idx = html.indexOf(marker);
  if (idx === -1) return html;
  // Nothing visitor-controlled reaches `prefs` today: the keys are fixed
  // literals, the values are validated down to '1'/'0'/null, and `reason` is
  // a literal. The '<' escape below is therefore defence-in-depth, not a fix
  // for a live hole -- it exists because the obvious future edit here is to
  // add a diagnostic field (an email, an error string) to the payload, and
  // an unescaped '</script' in an inline script closes the tag early and
  // hands the rest of the JSON to the HTML parser. Escaping at the injection
  // point means that edit stays safe without whoever makes it having to
  // notice.
  var json = JSON.stringify(prefs).replace(/</g, '\\u003c');
  var tag = '<script>window.__SERVER_PREFS__=' + json + ';</script>\n    ';
  return html.slice(0, idx) + tag + html.slice(idx);
}

/**
 * Public (no trailing underscore) so google.script.run can call it from the
 * client -- see docs/SERVER_PREFS_CONTRACT.md's "Client -> server" section.
 * `key` must be one of USER_PREF_KEYS_ and `value` must be exactly the
 * string '1' or '0'; anything else is rejected WITHOUT writing anything.
 * The visitor's identity is re-resolved here, server-side, on every single
 * call -- never taken from a caller-supplied argument -- specifically so a
 * malicious or buggy client cannot write into another user's namespaced
 * key by passing someone else's email. There is no email parameter at all;
 * that is deliberate.
 */
function saveUserPref(key, value) {
  if (USER_PREF_KEYS_.indexOf(key) === -1) {
    return { ok: false, reason: 'invalid-key' };
  }
  if (value !== '1' && value !== '0') {
    return { ok: false, reason: 'invalid-value' };
  }

  var email;
  try {
    email = Session.getActiveUser().getEmail();
  } catch (err) {
    return { ok: false, reason: 'no-user-identity' };
  }
  if (!email || email.indexOf('@') === -1) {
    return { ok: false, reason: 'no-user-identity' };
  }

  try {
    writeVisitorValue_(visitorUserStore_(), email, key, value);
  } catch (err) {
    return { ok: false, reason: 'properties-unavailable' };
  }
  return { ok: true };
}


/**
 * --- Historical archive: the team's folder of daily Google Sheets (2026-09-30) ---
 *
 * Behind the app's "Historical Data" popover. The old way: Hoa appended each
 * day's export to ONE published Sheet (HISTORICAL_DATA_CSV_URL in the app),
 * and the app downloaded and parsed the whole thing on every popover open.
 * That Sheet caps at 10 million cells (~105 days at ~95,000 cells a day), and
 * was already 15.9 MB / ~14 s to parse at ~22k rows (measured 2026-09-15).
 *
 * The team already keeps one Google Sheet per day in a Drive folder
 * (ARCHIVE_FOLDER_ID_), added by hand, with the date in each file's NAME and
 * only the export's own columns inside. This section serves that folder
 * as-is -- it never writes to it:
 *   ?archive=index              -> {"ok":true,"dates":["YYYY-MM-DD",...]} newest first
 *   ?archive=day&date=YYYY-MM-DD -> that day's CSV (Record Date + the export columns)
 * and the google.script.run twins getArchiveIndex / getArchiveDayCsv, which
 * are what the app uses inside Apps Script. The app lists dates from the
 * index and downloads only the day(s) someone views or compares.
 *
 * - Index: listing the folder's Sheets and reading a date out of each name
 *   (archiveDateFromName_). Cached for ARCHIVE_INDEX_CACHE_SECONDS_, so a
 *   Sheet someone adds shows up within that long. Names with no date, or
 *   two different dates, are skipped; if two Sheets carry the same date, the
 *   most recently edited one wins. checkArchiveFolder (run from the editor)
 *   reports all of that.
 * - Day: Google's own CSV export of the Sheet's FIRST tab -- the same export
 *   format as the live published CSV the app already parses -- with a
 *   "Record Date" column prepended from the file name, so the app sees the
 *   old archive's exact shape. Rows are prefixed as raw CSV records, never
 *   parsed and re-serialized (see splitCsvRecords_).
 *
 * Reads run as the VISITOR (the web app executes as "User accessing the web
 * app"), and Drive only serves what is shared with them -- so the admin-run cache
 * below serves recent days to visitors the folder isn't shared with.
 *
 * Replaced 2026-09-30, the day after it shipped: a timer that snapshotted
 * the live CSV nightly into a folder the script created itself (at the top of
 * the installing account's My Drive, without asking where) plus a backfill
 * from Hoa's Sheet. Kevin pointed at the folder the team already fills, so
 * the script now reads that instead of building a second copy. See
 * snapshotLiveDataToArchive for the leftover trigger.
 */

/**
 * The team's folder of daily Sheets: the id after /folders/ in its URL. ''
 * turns the per-day archive off (index reports not-configured and the app
 * uses the old published Sheet).
 */
var ARCHIVE_FOLDER_ID_ = '1oy0GiF_FuVfembJDrJHfRqT68WXCqxZd';

var ARCHIVE_ADMIN_KEY_ = 'bfrArchiveAdmin';
/** V2: the 2026-09-29 design cached a different folder's ids under 'bfrArchiveIndex'. */
var ARCHIVE_INDEX_CACHE_KEY_ = 'bfrArchiveIndexV2';
var ARCHIVE_INDEX_CACHE_SECONDS_ = 600;

/** A column every real export has; its absence means the download was not the export (e.g. a sign-in page). */
var ARCHIVE_REQUIRED_COLUMN_ = 'Vessel 1st VVD';

var ARCHIVE_DATE_RE_ = /^\d{4}-\d{2}-\d{2}$/;

var ARCHIVE_MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Splits CSV text into records (rows) WITHOUT parsing fields: a newline only
 * ends a record when it is outside a quoted field. Returns each record's raw
 * text with its line terminator (\n or \r\n) removed. Quote parity is tracked
 * per line, which handles escaped quotes ("") for free (they add two). Drops
 * a leading BOM and a trailing empty record.
 */
function splitCsvRecords_(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var records = [];
  var len = text.length;
  var recordStart = 0;
  var pos = 0;
  var inQuotes = false;
  while (pos < len) {
    var nl = text.indexOf('\n', pos);
    if (nl === -1) nl = len;
    var q = text.indexOf('"', pos);
    while (q !== -1 && q < nl) {
      inQuotes = !inQuotes;
      q = text.indexOf('"', q + 1);
    }
    if (!inQuotes) {
      var end = (nl > recordStart && text.charAt(nl - 1) === '\r') ? nl - 1 : nl;
      records.push(text.slice(recordStart, end));
      recordStart = nl + 1;
    }
    pos = nl + 1;
  }
  if (recordStart < len) records.push(text.slice(recordStart));
  while (records.length && records[records.length - 1] === '') records.pop();
  return records;
}

/** The first field of one CSV record, unquoted. */
function firstCsvField_(record) {
  if (record.charAt(0) !== '"') {
    var comma = record.indexOf(',');
    return comma === -1 ? record : record.slice(0, comma);
  }
  var out = '';
  var i = 1;
  while (i < record.length) {
    var c = record.charAt(i);
    if (c === '"') {
      if (record.charAt(i + 1) === '"') { out += '"'; i += 2; continue; }
      break;
    }
    out += c;
    i++;
  }
  return out;
}

/** 'YYYY-MM-DD' if year/month/day form a real calendar date, else ''. */
function archiveIsoDate_(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1)) return '';
  var daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return '';
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return y + '-' + pad(m) + '-' + pad(d);
}

/**
 * The one date in a file name, as 'YYYY-MM-DD', or '' when the name has no
 * date or more than one distinct date (e.g. a "08-24 to 09-01" range, which
 * is not one day). Accepts the team folder's own naming,
 * "Booking Flash Report Data-09302026" (MMDDYYYY, no separators -- Kevin's
 * screenshot of the folder, 2026-09-30), plus 2026-09-29 / 2026_09_29 /
 * 2026.09.29, 20260929, US month-first 9-29-2026 / 9.29.26 / 9_29_26 (this
 * is the North America report; the repo's own files are named like
 * 8-12-2026), and "Sep 29 2026" / "September 29, 2026". A digit run is never
 * split to find a date inside it. An 8-digit run can't be read both ways:
 * YYYYMMDD needs a leading "20", which as MMDDYYYY would be month 20.
 */
function archiveDateFromName_(name) {
  var s = String(name || '');
  var found = {};
  var m;
  var iso = /(^|\D)(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})(?=\D|$)/g;
  while ((m = iso.exec(s))) found[archiveIsoDate_(m[2], m[3], m[4])] = true;
  var compact = /(^|\D)(20\d{2})(\d{2})(\d{2})(?=\D|$)/g;
  while ((m = compact.exec(s))) found[archiveIsoDate_(m[2], m[3], m[4])] = true;
  var compactUs = /(^|\D)(\d{2})(\d{2})(20\d{2})(?=\D|$)/g;
  while ((m = compactUs.exec(s))) found[archiveIsoDate_(m[4], m[2], m[3])] = true;
  var us = /(^|\D)(\d{1,2})[-_.](\d{1,2})[-_.](\d{4}|\d{2})(?=\D|$)/g;
  while ((m = us.exec(s))) found[archiveIsoDate_(m[4], m[2], m[3])] = true;
  var named = /(^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s_-]*(\d{1,2})(?:st|nd|rd|th)?,?[\s_-]*(\d{4})(?=\D|$)/gi;
  while ((m = named.exec(s))) found[archiveIsoDate_(m[4], ARCHIVE_MONTHS_.indexOf(m[2].toLowerCase()) + 1, m[3])] = true;
  delete found[''];
  var dates = Object.keys(found);
  return dates.length === 1 ? dates[0] : '';
}

/** The archive folder, or null when ARCHIVE_FOLDER_ID_ is ''. Throws (as the caller) when it can't be opened. */
function openArchiveFolder_() {
  if (!ARCHIVE_FOLDER_ID_) return null;
  var folder;
  try {
    folder = DriveApp.getFolderById(ARCHIVE_FOLDER_ID_);
  } catch (err) {
    throw new Error('Could not open the archive folder (' + ARCHIVE_FOLDER_ID_ + ') as ' + (currentArchiveEmail_() || 'this account') +
      ': ' + err + '. Share the folder with this account (Viewer is enough).');
  }
  if (folder.isTrashed()) throw new Error('The archive folder (' + ARCHIVE_FOLDER_ID_ + ') is in the Drive trash.');
  return folder;
}

/**
 * Every file in the folder, sorted by name, as
 * {id, name, mimeType, updated (ms), date ('' if none), use (bool), why}.
 * `use` marks the one Sheet the index serves for its date.
 */
function scanArchiveFolder_(folder) {
  var entries = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var mime = f.getMimeType();
    var name = f.getName();
    var e = { id: f.getId(), name: name, mimeType: mime, updated: f.getLastUpdated().getTime(), date: '', use: false, why: '' };
    if (mime !== MimeType.GOOGLE_SHEETS) {
      e.why = 'not a Google Sheet';
    } else {
      e.date = archiveDateFromName_(name);
      if (!e.date) e.why = 'no single date in the name';
    }
    entries.push(e);
  }
  var best = {};
  entries.forEach(function (e) {
    if (e.date && (!best[e.date] || e.updated > best[e.date].updated)) best[e.date] = e;
  });
  entries.forEach(function (e) {
    if (!e.date) return;
    e.use = best[e.date] === e;
    if (!e.use) e.why = 'another Sheet for ' + e.date + ' was edited more recently: ' + best[e.date].name;
  });
  entries.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  return entries;
}

/** {dates: {'YYYY-MM-DD': fileId}} -- from the script cache when warm, else by listing the folder. */
function readArchiveIndex_(folder) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(ARCHIVE_INDEX_CACHE_KEY_);
  if (cached) return JSON.parse(cached);
  var index = { dates: {} };
  scanArchiveFolder_(folder).forEach(function (e) { if (e.use) index.dates[e.date] = e.id; });
  try { cache.put(ARCHIVE_INDEX_CACHE_KEY_, JSON.stringify(index), ARCHIVE_INDEX_CACHE_SECONDS_); } catch (err) { /* over the cache's 100 KB value limit -- served uncached */ }
  return index;
}

/**
 * One day's Sheet as the app's CSV: Google's CSV export of its first tab,
 * with "Record Date" prepended from `date`. Fetched with the caller's own
 * token, so it works only if the caller can view the Sheet. Throws on a
 * failed download or anything that isn't the export.
 */
function archiveDayCsvText_(fileId, date) {
  var res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=csv', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
    followRedirects: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Export of the ' + date + ' Sheet failed (HTTP ' + code + ').');
  var records = splitCsvRecords_(res.getContentText('UTF-8'));
  var header = records[0] || '';
  if (header.indexOf(ARCHIVE_REQUIRED_COLUMN_) === -1) {
    throw new Error('The ' + date + ' Sheet\'s first tab has no "' + ARCHIVE_REQUIRED_COLUMN_ + '" column in its first row, so it is not the export.');
  }
  // A Sheet that already carries Record Date is served as-is.
  if (firstCsvField_(header) === 'Record Date') return records.join('\r\n') + '\r\n';
  var lines = ['Record Date,' + header];
  for (var i = 1; i < records.length; i++) lines.push(date + ',' + records[i]);
  return lines.join('\r\n') + '\r\n';
}

/**
 * --- Owner-run archive cache (2026-09-30) ---
 *
 * Kevin: people shouldn't need the folder shared with them. Everything above runs
 * as the VISITOR, and Drive only serves a visitor what is shared with them. So the
 * admin's 30-minute refreshDataFeeds trigger (DataFeeds.gs), which runs AS THE
 * ADMIN, also calls refreshArchiveCache_: it lists the folder and copies the most
 * recent ARCHIVE_CACHE_DAYS_ days, gzipped and chunked, into the script cache, which
 * every visitor of the web app can read. getArchiveIndex / getArchiveDayCsv serve
 * from that cache first and only then try Drive as the visitor, so a visitor with
 * folder access still sees every date and one without sees the cached ones.
 *
 * Limits, on purpose: CacheService entries live at most 6 hours and the cache has
 * no published total size, so only recent days are kept (~185 KB each gzipped, from
 * the 964-row fixture), and each is re-put before it can expire
 * (ARCHIVE_DAY_REFRESH_MS_ < 6 h, with the trigger at most hourly). A run stops
 * after ARCHIVE_CACHE_BUDGET_MS_ and the next continues. The budget counts the folder
 * scan too, but every run copies at least one day, so a scan slow enough to use up the
 * whole budget (a very large folder) cannot stop the cache from ever filling; the
 * result's scanMs shows how much of the budget the scan took. Days whose Sheet changed
 * are re-copied (keyed by file id + last-updated time).
 */
var ARCHIVE_CACHE_DAYS_ = 45;
var ARCHIVE_CACHE_SECONDS_ = 6 * 60 * 60;          // CacheService's maximum
var ARCHIVE_DAY_REFRESH_MS_ = 4 * 60 * 60 * 1000;  // re-put well before the 6 h expiry
var ARCHIVE_CACHE_BUDGET_MS_ = 90 * 1000;
var ARCHIVE_CACHE_CHUNK_CHARS_ = 90000;            // under CacheService's 100 KB per value

function archiveCacheKey_(date, part) {
  return date ? 'bfrArc:' + date + ':' + part : 'bfrArc:' + part;
}

/** The admin-built {dates: {'YYYY-MM-DD': {id, updated}}} of every dated Sheet, or null. */
function readArchiveCacheIndex_() {
  try {
    var raw = CacheService.getScriptCache().get(archiveCacheKey_(null, 'index'));
    var idx = raw ? JSON.parse(raw) : null;
    return idx && idx.v === 1 && idx.dates ? idx : null;
  } catch (err) {
    return null;
  }
}

/** {date: meta} for the dates whose day is cached; meta = {v, id, updated, cachedAt, chunks}. */
function readArchiveCachedMetas_(dates) {
  var out = {};
  if (!dates.length) return out;
  try {
    var keys = dates.map(function (d) { return archiveCacheKey_(d, 'm'); });
    var got = CacheService.getScriptCache().getAll(keys);
    dates.forEach(function (d, i) {
      var raw = got[keys[i]];
      if (!raw) return;
      var meta = JSON.parse(raw);
      if (meta && meta.v === 1 && meta.chunks >= 1) out[d] = meta;
    });
  } catch (err) { /* cache down -- treated as nothing cached */ }
  return out;
}

/** The cached day's CSV, or null when it isn't (fully) cached. */
function readArchiveCachedDay_(date) {
  try {
    var meta = readArchiveCachedMetas_([date])[date];
    if (!meta) return null;
    var keys = [];
    for (var i = 0; i < meta.chunks; i++) keys.push(archiveCacheKey_(date, i));
    var got = CacheService.getScriptCache().getAll(keys);
    var b64 = '';
    for (var j = 0; j < keys.length; j++) {
      if (typeof got[keys[j]] !== 'string') return null;
      b64 += got[keys[j]];
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip', 'day.csv.gz');
    return Utilities.ungzip(blob).getDataAsString('UTF-8');
  } catch (err) {
    return null;
  }
}

function writeArchiveCachedDay_(date, entry, csv) {
  var b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(csv, 'text/csv', 'day.csv')).getBytes());
  var values = {};
  var chunks = 0;
  for (var pos = 0; pos < b64.length; pos += ARCHIVE_CACHE_CHUNK_CHARS_) {
    values[archiveCacheKey_(date, chunks)] = b64.slice(pos, pos + ARCHIVE_CACHE_CHUNK_CHARS_);
    chunks++;
  }
  // The meta goes in the same putAll, so a reader never sees a meta without its chunks.
  values[archiveCacheKey_(date, 'm')] = JSON.stringify({ v: 1, id: entry.id, updated: entry.updated, cachedAt: Date.now(), chunks: chunks });
  CacheService.getScriptCache().putAll(values, ARCHIVE_CACHE_SECONDS_);
}

/**
 * The admin's side of the cache; called by refreshDataFeeds (DataFeeds.gs) on its
 * trigger. Never throws: returns what it did, with per-day failures listed.
 */
function refreshArchiveCache_() {
  var started = Date.now();
  try {
    var folder = openArchiveFolder_();
    if (!folder) return { ok: false, reason: 'not-configured' };
    var full = {};
    scanArchiveFolder_(folder).forEach(function (e) { if (e.use) full[e.date] = { id: e.id, updated: e.updated }; });
    var scanMs = Date.now() - started;
    CacheService.getScriptCache().put(archiveCacheKey_(null, 'index'),
      JSON.stringify({ v: 1, builtAt: new Date().toISOString(), dates: full }), ARCHIVE_CACHE_SECONDS_);
    var recent = Object.keys(full).sort().reverse().slice(0, ARCHIVE_CACHE_DAYS_);
    var metas = readArchiveCachedMetas_(recent);
    var now = Date.now();
    var current = function (d) { var m = metas[d]; return m && m.id === full[d].id && m.updated === full[d].updated; };
    // Missing or changed days first (newest first), then the stalest cached ones.
    var todo = recent.filter(function (d) { return !current(d); })
      .concat(recent.filter(function (d) { return current(d) && now - metas[d].cachedAt > ARCHIVE_DAY_REFRESH_MS_; })
        .sort(function (a, b) { return metas[a].cachedAt - metas[b].cachedAt; }));
    var written = [];
    var failed = [];
    for (var i = 0; i < todo.length; i++) {
      // i > 0: the first day is always attempted (one export, a few seconds), even when the scan used the budget.
      if (i > 0 && Date.now() - started > ARCHIVE_CACHE_BUDGET_MS_) break;
      var d = todo[i];
      try {
        writeArchiveCachedDay_(d, full[d], archiveDayCsvText_(full[d].id, d));
        written.push(d);
      } catch (err) {
        failed.push(d + ': ' + (err.message || err));
      }
    }
    return { ok: true, dates: Object.keys(full).length, cachedTarget: recent.length, written: written, failed: failed,
      remaining: todo.length - written.length - failed.length, scanMs: scanMs };
  } catch (err) {
    return { ok: false, reason: 'error', error: String(err.message || err) };
  }
}

/** Run from the editor (as the admin) to fill the cache now instead of waiting for the trigger. */
function refreshArchiveCache() {
  assertArchiveAdmin_();
  var result = refreshArchiveCache_();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Downloads a published CSV, throwing on anything but a 200 response. Also used by DataFeeds.gs. */
function fetchArchiveCsv_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Download failed (HTTP ' + code + '): ' + url);
  return res.getContentText('UTF-8');
}

/** The caller's email ('' if it doesn't resolve). Never throws. */
function currentArchiveEmail_() {
  try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || ''; } catch (err) { return ''; }
}

/**
 * The project's admin guard, used by the editor-run setup functions in
 * DataFeeds.gs and TeamSheet.gs (the property keeps its archive-era name,
 * bfrArchiveAdmin, because deployments already have it set). Once an admin
 * is recorded, every call must come from that account. Blocks a visitor from
 * reaching them through google.script.run (the web app runs as the visitor,
 * so the active user is the visitor).
 *
 * Claiming (no admin recorded yet; 2026-10-06): only the OWNER of the script
 * file may become admin (adminClaimRefusal_). Before, the FIRST caller of
 * setupTeamSheets / installDataFeedTrigger / refreshArchiveCache became admin,
 * and those are public, so on a project with no admin yet any visitor could
 * claim it through google.script.run.
 *
 * `allowClaim` false: never makes the caller admin.
 */
function assertArchiveAdmin_(allowClaim) {
  var email = currentArchiveEmail_();
  if (!email) throw new Error('Could not resolve the caller; run this from the Apps Script editor.');
  var props = PropertiesService.getScriptProperties();
  var admin = props.getProperty(ARCHIVE_ADMIN_KEY_);
  if (!admin) {
    if (allowClaim === false) throw new Error('Not set up yet; run the setup function from the Apps Script editor first.');
    var refusal = adminClaimRefusal_(email);
    if (refusal) throw new Error(refusal);
    props.setProperty(ARCHIVE_ADMIN_KEY_, email);
    return email;
  }
  if (admin !== email) throw new Error('Only the archive admin (' + admin + ') can run this.');
  return email;
}

/**
 * Why `email` may NOT claim the admin role, or '' when it may: it must be the
 * script file's owner (Drive's owner of ScriptApp.getScriptId(), compared
 * case-insensitively). Anything that stops the owner being known refuses:
 * a caller who cannot open the script file in Drive (a visitor; getFileById
 * throws) or a file with no single owner (a Shared Drive: getOwner() is null).
 * The owner's address is never put in the message, which a visitor may see.
 */
function adminClaimRefusal_(email) {
  var how = 'Run it from the Apps Script editor signed in as the project\'s owner, or set the Script Property ' +
    ARCHIVE_ADMIN_KEY_ + ' (Project Settings -> Script Properties) to the admin\'s email address by hand and run it again as that account.';
  var owner = null;
  try {
    var user = DriveApp.getFileById(ScriptApp.getScriptId()).getOwner();
    owner = user ? user.getEmail() : null;
  } catch (err) {
    return 'No admin is set up yet, and the owner of this Apps Script project could not be checked as ' + email +
      ' (' + String(err && err.message ? err.message : err) + '). Only the project owner can become the admin. ' + how;
  }
  if (!owner) {
    return 'No admin is set up yet, and this Apps Script project has no single owner to check against (a project in a ' +
      'Shared Drive has none). ' + how;
  }
  if (String(owner).toLowerCase() !== String(email).toLowerCase()) {
    return 'No admin is set up yet, and only the owner of this Apps Script project can become the admin; ' + email +
      ' is not the owner. ' + how;
  }
  return '';
}

/**
 * Run from the Apps Script editor to see what the archive will serve, before
 * and after changing the folder. Read-only. Logs every file with the date read
 * from its name (or why it's skipped), then downloads the newest day the same
 * way the app would and reports its header check and row count. Subfolders
 * are listed but not read.
 */
function checkArchiveFolder() {
  var folder = openArchiveFolder_();
  if (!folder) {
    console.log('ARCHIVE_FOLDER_ID_ is empty: the per-day archive is off.');
    return { ok: false, reason: 'not-configured' };
  }
  var entries = scanArchiveFolder_(folder);
  entries.forEach(function (e) {
    console.log((e.use ? 'USE   ' + e.date : 'SKIP  ' + (e.date || '          ')) + '  ' + e.name + (e.why ? '   (' + e.why + ')' : ''));
  });
  var used = entries.filter(function (e) { return e.use; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var result = {
    ok: true,
    folder: folder.getName(),
    files: entries.length,
    dates: used.length,
    newest: used.length ? used[0].date : null,
    oldest: used.length ? used[used.length - 1].date : null,
    skipped: entries.filter(function (e) { return !e.use; }).map(function (e) { return e.name + ': ' + e.why; }),
    subfolders: [],
    cachedDays: Object.keys(readArchiveCachedMetas_(used.map(function (e) { return e.date; }))).length,
  };
  // Only files directly in the folder are read; say so if days might be filed in subfolders.
  var sub = folder.getFolders();
  while (sub.hasNext()) result.subfolders.push(sub.next().getName());
  if (result.subfolders.length) console.log('NOT READ: ' + result.subfolders.length + ' subfolder(s): ' + result.subfolders.join(', '));
  if (used.length) {
    try {
      result.newestRows = splitCsvRecords_(archiveDayCsvText_(used[0].id, used[0].date)).length - 1;
    } catch (err) {
      result.ok = false;
      result.newestError = String(err.message || err);
    }
  }
  CacheService.getScriptCache().remove(ARCHIVE_INDEX_CACHE_KEY_);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * RETIRED 2026-09-30 (see the section comment). Kept only for the nightly
 * trigger the old installArchiveTrigger created: when it next fires, this
 * deletes that trigger instead of failing -- and emailing its owner a failure
 * notice -- every night. Only the trigger's owner can delete it, so it is
 * harmless from anyone else. Safe to delete once Triggers (clock icon) shows
 * no snapshotLiveDataToArchive entry.
 */
function snapshotLiveDataToArchive() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'snapshotLiveDataToArchive') { ScriptApp.deleteTrigger(t); removed++; }
  });
  console.log('snapshotLiveDataToArchive is retired; removed ' + removed + ' leftover trigger(s).');
  return { ok: true, retired: true, triggersRemoved: removed };
}

/**
 * doGet ?archive=index. The dates this caller can open: every day the admin's
 * cache holds, plus every dated Sheet if the caller can open the folder itself.
 * An error only when neither works (the app then falls back to the old Sheet).
 */
function archiveIndexResponse_() {
  if (!ARCHIVE_FOLDER_ID_) return { ok: false, reason: 'not-configured' };
  var dates = {};
  var idx = readArchiveCacheIndex_();
  if (idx) {
    var metas = readArchiveCachedMetas_(Object.keys(idx.dates));
    Object.keys(metas).forEach(function (d) { if (metas[d].id === idx.dates[d].id) dates[d] = true; });
  }
  var directError = null;
  try {
    var folder = openArchiveFolder_();
    Object.keys(readArchiveIndex_(folder).dates).forEach(function (d) { dates[d] = true; });
  } catch (err) {
    directError = String(err.message || err);
  }
  var list = Object.keys(dates).sort().reverse();
  if (!list.length && directError) return { ok: false, reason: 'error', error: directError };
  return { ok: true, dates: list };
}

/**
 * Public, called by the app through google.script.run -- its only working
 * route under "Execute as: User accessing the web app", where a plain fetch()
 * of /exec from the page carries no sign-in and gets a login page back. Runs
 * as the visitor, so the visitor needs view access to the archive folder (see
 * apps-script/README.md). Read-only. Same result as doGet ?archive=index.
 */
function getArchiveIndex() {
  return archiveIndexResponse_();
}

/** {ok:true, date, csv} or {ok:false, reason, ...} -- shared by getArchiveDayCsv and ?archive=day. */
function archiveDayResult_(date) {
  if (!ARCHIVE_DATE_RE_.test(String(date || ''))) return { ok: false, reason: 'invalid-date' };
  var cached = readArchiveCachedDay_(date);
  if (cached) return { ok: true, date: date, csv: cached };
  try {
    var folder = openArchiveFolder_();
    var id = folder ? readArchiveIndex_(folder).dates[date] : null;
    if (!id) return { ok: false, reason: 'not-found', date: date };
    return { ok: true, date: date, csv: archiveDayCsvText_(id, date) };
  } catch (err) {
    return { ok: false, reason: 'error', error: String(err.message || err) };
  }
}

/**
 * Public, google.script.run counterpart of doGet ?archive=day (see
 * getArchiveIndex). Returns {ok:true, date, csv} or {ok:false, reason}.
 */
function getArchiveDayCsv(date) {
  return archiveDayResult_(date);
}

/** doGet ?archive=day&date=YYYY-MM-DD -- the day's CSV, or a JSON error object. */
function archiveDayResponse_(date) {
  var r = archiveDayResult_(date);
  if (r.ok) return ContentService.createTextOutput(r.csv).setMimeType(ContentService.MimeType.CSV);
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * --- Extended server-backed data (2026-09-28) ---
 *
 * Two genuinely new capabilities layered ALONGSIDE the frozen
 * docs/SERVER_PREFS_CONTRACT.md three-boolean contract above -- none of this
 * touches USER_PREF_KEYS_, readUserPrefs_, saveUserPref, or
 * injectServerPrefs_, and __SERVER_PREFS__'s shape is unchanged. New data
 * travels through a SEPARATE global, __SERVER_EXTRAS__ (see
 * injectServerExtras_ below), so the frozen contract stays exactly what it
 * says it is.
 *
 *  1. A server-backed copy of FilterPrefsStore's JSON blob (per-user, stored
 *     exactly like the three booleans above: the visitor's own user store
 *     when visitorUserStore_ allows it, else the email-namespaced script
 *     key, with the same lazy migration -- see "WHERE EACH VISITOR'S VALUES
 *     LIVE" above).
 *  2. exportCurrentViewToDrive -- the on-demand "Export to Drive" button
 *     (DriveApp/SpreadsheetApp).
 *
 * The schedule-change digest email (and the automatic Drive snapshot fired
 * alongside it) was ARCHIVED 2026-09-29, per Kevin, before ever being
 * deployed -- see docs/SERVER_PREFS_CONTRACT.md's "Archived: schedule-change
 * digest" section for what it was, why it was dropped, and where to find
 * the code if it's revived.
 *
 * DEPLOYMENT MODE: "Execute as: User accessing the web app" (changed
 * 2026-09-28, per Kevin: "everything added in this PR should be as the user
 * and not me"). Under the old "Execute as: Me" mode every DriveApp call ran
 * as the deploying account whichever visitor triggered it: exports landed in
 * Kevin's Drive and the visitor's "View in Drive" link opened a file they
 * had no access to. Under "User accessing", every call here runs as the
 * visitor, and each visitor grants the Drive scope once on first open.
 * User properties are then the visitor's own (which per-user values use
 * since 2026-10-06); script properties stay script-global, which is what
 * the email-namespaced fallback relies on.
 *
 * The date-cell OPUS vessel schedule link (see the app's
 * dateScheduleLink/openScheduleLink comment; the old "Add to Calendar"
 * feature was removed 2026-10-01) is client-only -- it opens in the visitor's own browser with no server
 * call and no extra scope at all.
 */

/** Same per-user namespace convention as the three booleans above, for the filter-prefs blob. */
var FILTER_PREFS_KEY_ = 'bookingFlashFilterPrefs';

/**
 * PropertiesService's own hard limit (9 KB per value, documented) minus
 * headroom for the namespaced key itself and JSON overhead. Anything at or
 * above this is rejected by saveUserFilterPrefs rather than silently
 * truncated or thrown as an uncaught PropertiesService error. Real and
 * reachable: the client's own FILTER_PREFS_MAX_BYTES cap (200 KB,
 * FilterPrefsStore in the app) is far larger than what this server can
 * hold -- see saveUserFilterPrefs's own comment.
 */
var FILTER_PREFS_MAX_SERVER_BYTES_ = 8000;

/** The visitor's email, or null when it doesn't resolve. Never throws. */
function activeUserEmail_() {
  var email = null;
  try {
    email = Session.getActiveUser().getEmail();
  } catch (err) {
    return null;
  }
  return (email && email.indexOf('@') !== -1) ? email : null;
}

/**
 * Resolves the visitor's stored filter-prefs blob, for injection as
 * window.__SERVER_EXTRAS__. Never throws -- same fail-closed posture as
 * readUserPrefs_. filterPrefs only resolves when a visitor identity is
 * available (same reasoning as readUserPrefs_). `visitor` as for readUserPrefs_.
 */
function readServerExtras_(visitor) {
  visitor = visitor || readVisitorContext_();
  if (visitor.error) return { filterPrefs: { available: false, reason: visitor.error, value: null } };
  var raw = visitor.values[FILTER_PREFS_KEY_];
  return { filterPrefs: { available: true, value: raw === undefined ? null : raw } };
}

/**
 * Inserts window.__SERVER_EXTRAS__ before the babel script tag, alongside
 * (not replacing) __EXEC_URL__ and __SERVER_PREFS__ -- same marker, same
 * string-insertion mechanism, same "leave html unmodified if the marker is
 * gone" fallback as injectExecUrl_/injectServerPrefs_ above.
 */
function injectServerExtras_(html, extras) {
  var marker = '<script type="text/babel">';
  var idx = html.indexOf(marker);
  if (idx === -1) return html;
  var json = JSON.stringify(extras).replace(/</g, '\\u003c');
  var tag = '<script>window.__SERVER_EXTRAS__=' + json + ';</script>\n    ';
  return html.slice(0, idx) + tag + html.slice(idx);
}

/**
 * --- Shared view links: window.__SHARED_VIEW__ (roadmap slice 4.2, server half) ---
 *
 * A link such as <exec-url>?view=v1.<payload>.<check> (the text BFShared.encodeView writes, see
 * shared/30_view_codec.js) carries a report view. The page runs inside Apps Script's sandbox iframe,
 * whose own address is not the one the visitor typed, so doGet hands the link to it the way it hands
 * over __EXEC_URL__ and __SERVER_PREFS__: as an inline script before the babel block. (Google also
 * documents google.script.url.getLocation(), which returns the visitor's query parameters to a page
 * in that frame; slice 4.3 may be able to use it instead of this echo. UNCONFIRMED for this app until
 * someone runs it on /exec, which is why this server half is built first: it is cheap and dormant.)
 * The client (slice 4.3, not built yet) decodes the link again with its own valid sets and applies it
 * for one session; today NOTHING in the app reads __SHARED_VIEW__, so this is dormant.
 *
 * DORMANT BY DESIGN. No `view` parameter, a malformed link, or a page without the babel marker
 * all leave html BYTE FOR BYTE unchanged, and the function never throws, so it cannot break page
 * load. A page that has not been redeployed simply never gets the global.
 *
 * What is injected is the ORIGINAL link text as one JSON string, not the decoded view: the decoder
 * here has no valid sets (it only judges whether the text is a well-formed link), and decoded text
 * stays untrusted. A link is accepted only when the whole text decodes (decodeView reports no
 * `errors`); keys or values it would DROP do not matter here, the client decodes the same text
 * again and reports those. A well-formed link holds only letters, digits, '-', '_' and '.', so the
 * escaping below is defence in depth: it keeps the tag safe if the grammar is ever widened, or
 * the gate is ever bypassed. '<' is the escape that matters to a browser: it stops "</script" and
 * "<!--" from forming. '>' and '&' are escaped too, which a browser does not need, so that the tag
 * holds no HTML metacharacter at all. U+2028 / U+2029 are escaped because JSON.stringify leaves
 * them raw and older JavaScript engines treat them as line breaks inside a string literal.
 *
 * Load order: Shared.gs defines BFShared when Apps Script loads it, and file order is not
 * guaranteed, so BFShared is used only inside this function, which runs later. A Code.gs pasted
 * without Shared.gs just skips the injection (typeof guard).
 */
// The decoder's own cap: viewCodec_MAX_ENCODED_CHARS in shared/30_view_codec.js (inside Shared.gs, where it is private to
// BFShared and cannot be referenced from here). It was 8000 once, but viewCodec_parse refuses anything over 4000 anyway, so
// the extra range was dead and only let up to 4000 more characters reach the decoder to be refused. This is the cheap
// pre-test that keeps a huge value away from the decoder; keep it equal to the shared constant (tests/check_shared_view_injection.js
// pins both ends: 4,000 handed on, 4,001 refused without decoding).
var SHARED_VIEW_MAX_CHARS_ = 4000;

/**
 * The raw ?view= value, or undefined when there is none or it is ambiguous. A parameter repeated
 * (?view=a&view=b) puts every value in e.parameters.view and only the first in e.parameter.view;
 * the page then gets no view at all rather than whichever copy happened to come first. Never throws.
 */
function sharedViewParam_(e) {
  try {
    if (!e || !e.parameter) return undefined;
    var all = e.parameters && e.parameters.view;
    if (Array.isArray(all) && all.length > 1) return undefined;
    return e.parameter.view;
  } catch (err) {
    return undefined;
  }
}

/**
 * Returns `html` with the shared-view tag inserted immediately before the babel marker, or `html`
 * itself, unchanged, in every other case. `view` is the raw ?view= value. See the block comment above.
 */
function injectSharedView_(html, view) {
  try {
    if (typeof view !== 'string' || view.length === 0 || view.length > SHARED_VIEW_MAX_CHARS_) return html;
    var marker = '<script type="text/babel">';
    var idx = html.indexOf(marker);
    if (idx === -1) return html;
    if (typeof BFShared === 'undefined' || typeof BFShared.decodeView !== 'function') return html;
    var decoded = BFShared.decodeView(view);
    if (!decoded || !decoded.errors || decoded.errors.length !== 0) return html;
    var json = JSON.stringify(view)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    var tag = '<script>window.__SHARED_VIEW__=' + json + ';</script>\n    ';
    return html.slice(0, idx) + tag + html.slice(idx);
  } catch (err) {
    return html;
  }
}

/**
 * Public, callable via google.script.run. Persists ONE visitor's
 * FilterPrefsStore blob (a JSON string built and already-validated
 * client-side -- see FilterPrefsStore's own FILTER_PREFS_VALIDATORS).
 * An empty string deletes the stored blob (FilterPrefsStore.clear(), the
 * "Reset to defaults" button). Rejected WITHOUT writing if: not a string,
 * not valid JSON, or at/over FILTER_PREFS_MAX_SERVER_BYTES_. A too-large
 * blob stays localStorage-only; the client restores whichever copy has the
 * newer savedAt, so a stale server copy never overrides it.
 */
function saveUserFilterPrefs(json) {
  if (typeof json !== 'string') {
    return { ok: false, reason: 'invalid-value' };
  }
  var email = activeUserEmail_();
  if (!email) {
    return { ok: false, reason: 'no-user-identity' };
  }
  if (json === '') {
    try {
      writeVisitorValue_(visitorUserStore_(), email, FILTER_PREFS_KEY_, null);
    } catch (err) {
      return { ok: false, reason: 'properties-unavailable' };
    }
    return { ok: true };
  }

  // Byte length, not character length -- what PropertiesService actually
  // measures against its 9 KB/value limit is UTF-8 bytes.
  var byteLength = Utilities.newBlob(json).getBytes().length;
  if (byteLength >= FILTER_PREFS_MAX_SERVER_BYTES_) {
    return { ok: false, reason: 'too-large', byteLength: byteLength };
  }
  try {
    JSON.parse(json);
  } catch (err) {
    return { ok: false, reason: 'invalid-json' };
  }

  try {
    writeVisitorValue_(visitorUserStore_(), email, FILTER_PREFS_KEY_, json);
  } catch (err) {
    return { ok: false, reason: 'properties-unavailable' };
  }
  return { ok: true };
}

/**
 * Idempotent: reuses the folder if it already exists rather than creating a
 * duplicate on every run. Lives in the CALLING visitor's My Drive.
 */
function getOrCreateSnapshotFolder_() {
  var FOLDER_NAME = 'Booking Flash Snapshots';
  var existing = DriveApp.getFoldersByName(FOLDER_NAME);
  if (existing.hasNext()) return existing.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

/**
 * Used by exportCurrentViewToDrive. `rows` is an array of plain objects (already curated/flattened client-side -- see the
 * app's buildSnapshotRows). Builds one Sheet with a header row derived from
 * the first row's own keys, moves the resulting file into the auto-created
 * snapshot folder (see getOrCreateSnapshotFolder_), and returns its URL.
 * The classic add-then-remove-from-root idiom is used instead of
 * File.moveTo(), which is a newer API this deployment shouldn't have to
 * depend on.
 */
function buildSnapshotSheet_(rows, title) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, reason: 'no-rows' };
  }
  var headers = Object.keys(rows[0]);
  var data = [headers].concat(rows.map(function (row) {
    return headers.map(function (h) { return row[h] === undefined || row[h] === null ? '' : row[h]; });
  }));

  var ss = SpreadsheetApp.create(title);
  var sheet = ss.getSheets()[0];
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  var file = DriveApp.getFileById(ss.getId());
  var folder = getOrCreateSnapshotFolder_();
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  return { ok: true, url: ss.getUrl() };
}

/**
 * Public, callable via google.script.run from the on-demand "Export to
 * Drive" button, given the Detail tab's current filtered view (see
 * buildSnapshotRows in the app, same "what's on screen right now" semantics
 * as the existing local Excel export). The Sheet is created in the clicking visitor's own
 * Drive, so the returned URL is one they can open.
 */
function exportCurrentViewToDrive(rowsJson, sheetTitle) {
  var rows;
  try {
    rows = JSON.parse(rowsJson);
  } catch (err) {
    return { ok: false, reason: 'invalid-json' };
  }
  try {
    return buildSnapshotSheet_(rows, sheetTitle || 'Booking Flash export');
  } catch (err) {
    return { ok: false, reason: 'drive-failed', error: String(err) };
  }
}

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
 *     bump anything on a future edit.
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
  if (e && e.parameter && e.parameter.check === 'identity') {
    return ContentService.createTextOutput(JSON.stringify(runIdentityProbe_(), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
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
  html = injectServerPrefs_(html, readUserPrefs_());
  html = injectServerExtras_(html, readServerExtras_());
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
 * WHY getScriptProperties() NAMESPACED BY EMAIL, NOT getUserProperties() --
 * this is the central design point, so it gets its own paragraph rather
 * than a one-line justification. getUserProperties() sounds like exactly
 * what we want ("per-user properties," right there in the name), but
 * Google's own docs describe its behavior under "Execute as: Me" web apps
 * ambiguously -- readable by "the current or effective user," which is
 * precisely the distinction that matters here, since the executing identity
 * (the script owner) and the visiting identity (whoever opened the /exec
 * URL) are different people. runIdentityProbe_ below exists because of this
 * exact ambiguity: it was deployed to measure, empirically, on this actual
 * deployment, whether getUserProperties() is keyed to the visitor or to the
 * owner. If it turned out to be owner-keyed, every visitor would silently
 * read and write the SAME three booleans -- one person's dark-mode toggle
 * flipping it for the entire org -- which is a strictly worse bug than the
 * flaky-localStorage problem this feature exists to fix, and it would be
 * invisible to every client-side test, because from the browser's point of
 * view the server "worked": it stored a value and handed it back correctly.
 * getScriptProperties(), by contrast, is documented unambiguously as a
 * single script-global store with no per-visitor ambiguity at all -- so we
 * use it, and manufacture the per-user isolation ourselves, explicitly, by
 * namespacing every key with the visitor's own email address (resolved
 * fresh server-side on every call, never trusted from the client -- see
 * saveUserPref below). The isolation then lives in a plainly-inspectable
 * key string instead of in an under-documented API's implicit behavior.
 *
 * Quota note: the documented script-property store limit is 500 KB total
 * and 9 KB per value. Each user's footprint here is three keys holding a
 * one-character '1'/'0' value apiece -- on the order of tens of bytes all
 * in. That is not quota-relevant at any organization size this app could
 * plausibly reach; it is noted only so a future reader doesn't have to
 * re-derive it.
 *
 * Namespace: keys are prefixed with "bfrPref:" specifically so that every
 * entry this feature ever writes is trivially greppable and bulk-deletable
 * (e.g. if the feature is ever removed, or a user needs their stored prefs
 * wiped) without risk of colliding with or accidentally sweeping up
 * unrelated script properties, including the identity-probe stamp above.
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
 * Namespaces a script-property key to one visitor and one preference, e.g.
 * "bfrPref:jane@example.com:bookingFlashDarkMode". See the block comment
 * above for why this namespacing -- not getUserProperties() -- is what
 * actually provides per-user isolation here.
 */
function prefStoreKeyFor_(email, key) {
  return 'bfrPref:' + email + ':' + key;
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
 * return, not a throw, but this app has already found via runIdentityProbe_
 * that this deployment's visitors DO resolve -- guarding here anyway costs
 * nothing and protects any future deployment where they don't), or a thrown
 * error are all treated identically: there is no per-user key available, so
 * fail closed rather than fall back to any shared/global key.
 */
function readUserPrefs_() {
  var email;
  try {
    email = Session.getActiveUser().getEmail();
  } catch (err) {
    return { available: false, reason: 'no-user-identity' };
  }
  if (!email || email.indexOf('@') === -1) {
    return { available: false, reason: 'no-user-identity' };
  }

  var values = {};
  try {
    var props = PropertiesService.getScriptProperties();
    for (var i = 0; i < USER_PREF_KEYS_.length; i++) {
      var key = USER_PREF_KEYS_[i];
      var raw = props.getProperty(prefStoreKeyFor_(email, key));
      // getProperty returns null for "never stored," which is already the
      // contract's null. Anything that isn't exactly '1' or '0' (there
      // should never be such a value, since saveUserPref is the only writer
      // and it validates -- but this is the read path, so it does not
      // trust that invariant) collapses to null rather than leaking a
      // malformed string to the client.
      values[key] = (raw === '1' || raw === '0') ? raw : null;
    }
  } catch (err) {
    return { available: false, reason: 'properties-unavailable' };
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
    PropertiesService.getScriptProperties()
      .setProperty(prefStoreKeyFor_(email, key), value);
  } catch (err) {
    return { ok: false, reason: 'properties-unavailable' };
  }
  return { ok: true };
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
 *  1. A server-backed copy of FilterPrefsStore's JSON blob (per-user, same
 *     getScriptProperties()+email-namespacing pattern as the three
 *     booleans above -- see prefStoreKeyFor_'s own "why not
 *     getUserProperties()" reasoning, which applies identically here).
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
 * Script properties stay script-global in this mode, which is what the
 * per-user email namespacing below relies on.
 *
 * "Add to Calendar" stays a plain calendar.google.com deep link (see the
 * app's calendarEventDates/dateEventIcon comment) -- it already acts as the
 * visitor with no server call and no Calendar scope at all.
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
 * available (same reasoning as readUserPrefs_).
 */
function readServerExtras_() {
  var filterPrefs = { available: false, reason: 'no-user-identity', value: null };
  var email = activeUserEmail_();
  if (email) {
    try {
      var raw = PropertiesService.getScriptProperties()
        .getProperty(prefStoreKeyFor_(email, FILTER_PREFS_KEY_));
      filterPrefs = { available: true, value: raw === undefined ? null : raw };
    } catch (err) {
      filterPrefs = { available: false, reason: 'properties-unavailable', value: null };
    }
  }

  return { filterPrefs: filterPrefs };
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
  var key = prefStoreKeyFor_(email, FILTER_PREFS_KEY_);

  if (json === '') {
    try {
      PropertiesService.getScriptProperties().deleteProperty(key);
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
    PropertiesService.getScriptProperties().setProperty(key, json);
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

/**
 * TEMPORARY DIAGNOSTIC -- delete once it has been read (see below).
 *
 * Answers one question that Google's own documentation does not: under a
 * web app deployed with "Execute as: Me", does
 * PropertiesService.getUserProperties() key its store to the VISITOR or to
 * the OWNER?
 *
 * Why this matters enough to deploy a probe for it: the point of moving
 * preferences server-side is to give each person their own copy. If the
 * store is owner-keyed, every visitor reads and writes the SAME three
 * booleans -- so one person toggling dark mode would flip it for the whole
 * org. That is a strictly worse bug than the one being fixed (prefs
 * occasionally resetting), and -- this is the dangerous part -- it is
 * invisible to every client-side test, because from the browser's point of
 * view the server "worked": it stored a value and gave it back.
 *
 * The docs say getUserProperties() is readable by "the current or effective
 * user", which is precisely ambiguous when those two differ, as they do
 * here. Secondary sources contradict each other. So: measure it.
 *
 * HOW TO READ THE RESULT -- needs two different org accounts:
 *
 *   1. Account A opens  <exec-url>?check=identity
 *      Expect "userPropsVerdict": "FIRST_RUN (no stamp was present)".
 *   2. Account B (different person, or an incognito window signed into a
 *      second account) opens the SAME url. This is the discriminating step,
 *      and note that the GOOD answer here is the same string as step 1:
 *        - "FIRST_RUN" again   -> B has its own empty store, i.e.
 *                                 getUserProperties() IS per-visitor.
 *                                 Server-backed prefs are viable.
 *        - "SHARED_ACROSS_USERS" -> B read A's stamp. Owner-keyed. DO NOT
 *                                 build on getUserProperties(). See the
 *                                 fallback note below.
 *   3. Account A reloads. Expect "STABLE_FOR_SAME_USER" -- its own stamp
 *      came back. Do not skip this: it is what separates "per-user store"
 *      from "the store simply is not persisting at all", which would also
 *      show FIRST_RUN twice and otherwise look like success.
 *
 * FALLBACK IF SHARED: "activeUserEmail" below is the deciding field. Google
 * documents getActiveUser().getEmail() as returning "" for an execute-as-me
 * web app, BUT exempts visitors who share a Workspace domain with the
 * developer -- which is this deployment ("Anyone within the organization").
 * If activeUserEmail comes back as a real address, prefs can live in the
 * unambiguously-shared getScriptProperties() under a key namespaced by that
 * email, sidestepping getUserProperties() entirely. If it comes back blank,
 * there is no per-user key available on this deployment at all and the
 * whole server-backed approach should be abandoned rather than bodged.
 *
 * Exposure note: this returns the caller's own email plus the email of
 * whoever last hit it. Access is already limited to the organization, and
 * it stores nothing but a timestamp and an address -- but it is a
 * diagnostic, not a feature. Delete this function and its doGet branch once
 * the answer is recorded in AGENTS.md, and run deleteIdentityProbeStamp_()
 * to clear the stamp it left behind.
 */
function runIdentityProbe_() {
  var STAMP_KEY = 'bookingFlashIdentityProbeStamp';
  var out = {
    ranAt: new Date().toISOString(),
    activeUserEmail: null,
    effectiveUserEmail: null,
    activeUserResolves: false,
    sameIdentity: null,
    previousStamp: null,
    userPropsVerdict: null,
    userPropsWritable: false,
    error: null
  };

  // Each getEmail() is wrapped separately: getActiveUser() is the one
  // documented to be restricted, and it may throw rather than return ""
  // depending on the deployment. A throw there must not cost us the rest of
  // the report -- the whole point is to see every field at once.
  try {
    out.activeUserEmail = Session.getActiveUser().getEmail();
  } catch (err) {
    out.activeUserEmail = 'THREW: ' + err;
  }
  try {
    out.effectiveUserEmail = Session.getEffectiveUser().getEmail();
  } catch (err) {
    out.effectiveUserEmail = 'THREW: ' + err;
  }
  out.activeUserResolves = !!(out.activeUserEmail &&
    out.activeUserEmail.indexOf('@') !== -1);
  if (out.activeUserResolves && out.effectiveUserEmail) {
    out.sameIdentity = (out.activeUserEmail === out.effectiveUserEmail);
  }

  try {
    var store = PropertiesService.getUserProperties();
    var raw = store.getProperty(STAMP_KEY);
    var whoAmI = out.activeUserResolves ? out.activeUserEmail : '(unresolved)';

    if (!raw) {
      out.userPropsVerdict = 'FIRST_RUN (no stamp was present)';
    } else {
      var prev = null;
      try {
        prev = JSON.parse(raw);
      } catch (parseErr) {
        prev = { writer: '(unparseable: ' + raw + ')' };
      }
      out.previousStamp = prev;
      if (!out.activeUserResolves) {
        // Without a visitor identity we cannot tell "my own stamp" from
        // "someone else's" -- say so instead of guessing a verdict.
        out.userPropsVerdict =
          'INCONCLUSIVE (a stamp exists, but activeUserEmail is blank so ' +
          'its writer cannot be compared to the current visitor)';
      } else if (prev.writer === whoAmI) {
        out.userPropsVerdict = 'STABLE_FOR_SAME_USER (read back my own stamp)';
      } else {
        out.userPropsVerdict = 'SHARED_ACROSS_USERS (read a stamp written ' +
          'by ' + prev.writer + ' -- getUserProperties is NOT per-visitor ' +
          'on this deployment; do not build prefs on it)';
      }
    }

    store.setProperty(STAMP_KEY, JSON.stringify({
      writer: whoAmI,
      at: out.ranAt
    }));
    out.userPropsWritable = true;

    if (out.userPropsVerdict.indexOf('FIRST_RUN') === 0) {
      out.userPropsVerdict += ' -- now stamped by ' + whoAmI +
        '; have a DIFFERENT account load this url next';
    }
  } catch (err) {
    out.error = 'PropertiesService failed: ' + err;
    out.userPropsVerdict = 'UNAVAILABLE (see error)';
  }

  return out;
}

/**
 * Companion cleanup for runIdentityProbe_. Run once from the Apps Script
 * editor when removing the probe, so it does not leave an address sitting
 * in the property store.
 */
function deleteIdentityProbeStamp_() {
  PropertiesService.getUserProperties()
    .deleteProperty('bookingFlashIdentityProbeStamp');
}

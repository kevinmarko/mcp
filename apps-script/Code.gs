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
  var execUrl = ScriptApp.getService().getUrl();
  var html = injectExecUrl_(HtmlService.createHtmlOutputFromFile('index').getContent(), execUrl);
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

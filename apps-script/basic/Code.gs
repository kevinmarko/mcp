/**
 * Server for the BASIC build of the Booking Flash Report (dist/basic/index.html).
 *
 * 2026-10-01, per Kevin: while Google's API services are still in testing, this is a deployment
 * that uses none of them. It does nothing but host the page. There is no storage, no Sheet or
 * Drive access, no per-user data, no triggers, no outbound fetches and no mail -- so it needs no
 * extra authorization scopes, and the standard Apps Script consent screen is the only one a
 * first-time visitor sees. The app itself (loaded with window.__BF_GOOGLE_SERVICES_OFF__ set by
 * dist/basic/index.html) makes no google.script.run calls and gets its data from the published
 * Sheet CSV feeds directly, exactly like the static-hosting deploy path.
 *
 * SETUP. This MUST live in its OWN Apps Script project, separate from the full deployment: a
 * project has exactly one doGet, and this one deliberately lacks every full-build function
 * (archive, data feed, notes, prefs, Drive export). In that new project:
 *   - Code.gs: paste this file.
 *   - index (an HTML file named exactly "index"): paste dist/basic/index.html, NOT dist/index.html
 *     and not the source file. Re-paste it after every rebuild.
 *   - Deploy as a Web app (Execute as: Me, access as your organization requires).
 * Full steps: apps-script/README.md, "Basic deployment".
 *
 * WHAT IT KEEPS FROM THE FULL Code.gs (copied, not shared -- separate projects cannot import):
 *   - window.__EXEC_URL__ is injected, so the reload link and the "new version" banner work.
 *     ScriptApp.getService().getUrl() is just this web app's own address, not a Google API call
 *     that touches user data.
 *   - ?check=version answers with the MD5 of the index file, which that banner polls.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.check === 'version') {
    return ContentService.createTextOutput(getIndexVersionHash_())
      .setMimeType(ContentService.MimeType.TEXT);
  }
  return HtmlService.createHtmlOutput(injectExecUrl_(HtmlService.createHtmlOutputFromFile('index').getContent(), ScriptApp.getService().getUrl()))
    .setTitle('Booking Flash Report NA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * MD5 of index.html's real, current content, as lowercase hex. Recomputed from the live file on
 * every call -- nothing to keep in sync by hand. Utilities.computeDigest returns signed bytes
 * (Java `byte`, -128..127), so each byte is normalized into 0..255 before hex-encoding.
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
 * Inserts `<script>window.__EXEC_URL__="...";</script>` immediately before index.html's own
 * `<script type="text/babel">` tag, by plain string insertion (not a template scriptlet, so the
 * same file also runs unmodified on static hosting). If the marker isn't found, serves the
 * content unmodified -- the app already treats a missing __EXEC_URL__ as "not available".
 */
function injectExecUrl_(html, execUrl) {
  var marker = '<script type="text/babel">';
  var idx = html.indexOf(marker);
  if (idx === -1) return html;
  var tag = '<script>window.__EXEC_URL__=' + JSON.stringify(execUrl) + ';</script>\n    ';
  return html.slice(0, idx) + tag + html.slice(idx);
}

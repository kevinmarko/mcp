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
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Booking Flash Report NA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

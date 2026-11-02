# Deploying as a Google Apps Script Web App

The report is a single self-contained HTML file with no server-side dependency
(it fetches its own data client-side from the published Sheet CSV link — see
`CSV_SOURCE_URL` in the main app file). Apps Script's job here is only to
**host that HTML behind an org-restricted URL** — `Code.gs` in this folder is
the entire server-side code required.

This is a manual, account-level process (Google account/project setup) that
has to be done by hand in the Apps Script UI — it isn't something that can be
scripted from this repo.

## One-time setup

1. Go to **[script.google.com](https://script.google.com/)** → **New project**.
2. Rename the project (top left) to something recognizable, e.g. *Booking Flash Report App*.
3. In the file list on the left, click the **+** next to *Files* → **HTML**, and name the new file exactly `index` (Apps Script appends `.html` automatically).
4. Open the current app file in this repo — whichever `Booking_flash_report_na_*.html` has the highest version number in the repo root (currently `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` — see the main [README](../README.md#running-it-locally)'s "Current version" note; don't hardcode a specific filename here, it changes on every version bump) — copy its **entire contents**, and paste them into the `index.html` file you just created in the Apps Script editor, replacing the placeholder content.
5. Open the default `Code.gs` file in the Apps Script editor and replace its contents with **[Code.gs](Code.gs)** from this folder (it's short — just copy/paste it directly).
6. Click **Deploy → New deployment**.
7. Click the gear icon next to "Select type" → choose **Web app**.
8. Fill in:
   - **Description**: e.g. `v1`
   - **Execute as**: `Me` (your account)
   - **Who has access**: `Anyone within [your organization]` — this is what restricts the report to people signed into a company Google account
9. Click **Deploy**. The first time, Google will prompt you to authorize the script — approve it (it's your own script, running as you).
10. Copy the **Web app URL** it gives you (ends in `/exec`) — that's the stable link end users will open. Save it somewhere durable (send it to Claude too, so it can be recorded).

## Verifying it worked

Open the `/exec` URL in a browser while signed into a company Google account.
It should load the report and auto-fetch data from the published Sheet, same
as the local dev server does. Try opening it in an incognito window signed
into a *non*-company Google account (or signed out) to confirm access is
actually restricted, not just hidden.

## Updating after a code change

Whenever the app's HTML file changes (a new version/fix), the deployment
does **not** update itself automatically — repeat this each time:

1. Go back to [script.google.com](https://script.google.com/) and open the project.
2. Open `index.html` in the editor, select all, delete, and paste in the new file's full contents.
3. Click **Deploy → Manage deployments**.
4. Click the pencil/edit icon on the existing deployment (don't create a new one — that would change the URL).
5. Under **Version**, choose **New version**, then click **Deploy**.

This keeps the same `/exec` URL stable across updates — end users never need
a new link.

### Redeploying `Code.gs` itself (required once, for the update-checker/reload fix)

`Code.gs` in this folder is not just a passthrough anymore (2026-09-10) — it now
also injects the real `/exec` URL into the page as `window.__EXEC_URL__` and
serves a tiny `?check=version` endpoint, both of which the app's "new version"
banner needs to work correctly *on this deploy path specifically* (see
`index.html`'s `appUpdateAvailable`/`checkForAppUpdate` comments for the full
root-cause story — in short, this app runs inside Apps Script's sandboxed
iframe, whose own URL is a transient one Google's sandbox won't let it
navigate to or usefully re-fetch).

**Until this updated `Code.gs` is deployed** (steps above — same "Manage
deployments → edit → New version" flow, just for `Code.gs` instead of
`index.html`), the app degrades gracefully rather than breaking: the update
banner simply won't offer a working "Refresh Now" action (it tells the user
to refresh the tab manually instead) and won't poll for new versions at all
on this deploy path — it does **not** fall back to the old broken behavior
(the blank-page-on-refresh / phantom-nag bug this fix addresses). So there's
no urgency-driven risk in leaving an old `Code.gs` deployed for a while, but
redeploying it is what actually turns the fix on.

## Optional: automating updates with `clasp`

If copy-pasting on every update becomes annoying, Google's
[`clasp`](https://github.com/google/clasp) CLI can push a local file straight
into an Apps Script project from the command line (`clasp push`), which could
be scripted from this repo instead of the manual copy/paste above. Not set up
here — worth doing later if updates become frequent enough to be worth the
one-time `clasp login`/`clasp clone` setup.

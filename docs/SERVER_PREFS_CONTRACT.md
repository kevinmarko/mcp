# Server-backed preferences — frozen interface contract (2026-09-16)

All four agents implement against THIS. Do not redesign it. If you believe a
clause is wrong, STOP and report rather than diverging — a silent divergence
between the writer and the tests is the exact failure this contract prevents.

## Why this shape

`getUserProperties()` has undocumented per-user semantics under "Execute as:
Me" and may be owner-keyed, which would share one set of booleans across the
whole org. We therefore use `getScriptProperties()` — documented
unambiguously as script-global — and namespace each entry by the visitor's
email. Per-user isolation then comes from the key, not from an ambiguous API.

If the visitor's email cannot be resolved, there is NO per-user key available,
and the feature must degrade to exactly today's localStorage-only behaviour.
Fail closed. Never fall back to a shared/global key.

## The three keys (unchanged names)

    bookingFlashDarkMode
    bookingFlashAutoRefresh
    bookingFlashFreezePanes

Values are the strings '1' or '0' — identical to what localStorage holds
today. `null` means "no value stored". This is load-bearing: `autoRefresh`
distinguishes null (-> default ON) from '0' (-> explicitly off), while the
other two collapse null/'0'/garbage to false. Preserve that asymmetry.

## Server -> client: `window.__SERVER_PREFS__`

Injected by `doGet` as a plain (non-Babel) inline <script> placed before
index.html's `<script type="text/babel">` marker, exactly as `injectExecUrl_`
already does for `__EXEC_URL__`. Synchronous, so it is available before the
app's first render. There is NO async read path.

Shape, when the visitor's identity resolved:

    window.__SERVER_PREFS__ = {
      "available": true,
      "values": {
        "bookingFlashDarkMode": "1",
        "bookingFlashAutoRefresh": null,
        "bookingFlashFreezePanes": null
      }
    };

Shape, when it did not (blank email, PropertiesService threw, etc.):

    window.__SERVER_PREFS__ = { "available": false, "reason": "no-user-identity" };

On every non-Apps-Script path (localhost, static hosting) the global is simply
absent (`undefined`). All three cases must behave correctly.

## Client -> server: `saveUserPref(key, value)`

Called via `google.script.run`, fire-and-forget. Public name (no trailing
underscore) so it is callable. Server validates `key` is one of the three and
`value` is '1' or '0'; anything else is rejected without writing. Returns
`{ ok: true }` or `{ ok: false, reason: '...' }`.

## Client resolution rule (single helper, used by all three preferences)

    server value, if available === true AND the value is not null
    else localStorage value
    else null

Then each preference applies its EXISTING null/'1' logic to that string,
unchanged. Do not alter any preference's default.

## Client write rule

1. Write localStorage synchronously, exactly as today. Unconditional.
2. If server-backed writes are enabled, additionally fire `saveUserPref`.

Server-backed writes are enabled iff:

    window.__SERVER_PREFS__ && window.__SERVER_PREFS__.available === true
    && typeof google !== 'undefined' && google.script && google.script.run

This check must be purely STRUCTURAL. Never sniff `location.hostname`. A
hostname check makes the test seam unreachable and silently turns the whole
test suite into a false positive.

3. A failed write must never revert local state, never throw, never alert,
   never block. The next successful write overwrites it. Surface health
   passively in the existing Settings diagnostic line only.

## Invariants that must not change

- First paint stays synchronous. No new pending/unknown state anywhere.
- Every localStorage access stays wrapped in try/catch (it THROWS in private
  windows; an uncaught throw takes the whole app down on load).
- The existing storage probe stays exactly as it is. It is the only
  instrument that can show whether a real fix worked in production.
- No build step, no new runtime dependencies, no CDN or xlsx version changes.
- Nothing from PR #81 (filter/view persistence, testing version 1.67).

---

## Addendum (2026-09-28): `window.__SERVER_EXTRAS__` — NOT part of the frozen contract above

Everything above this line is unchanged and still governs the three booleans
exactly as written. This addendum documents a SEPARATE extension added
2026-09-28 (per Kevin: server-backed filter prefs and an "Export to Drive"
button) that deliberately does NOT touch `window.__SERVER_PREFS__`,
`saveUserPref`, `readUserPrefs_`, or `USER_PREF_KEYS_` — it travels through
its own global, `window.__SERVER_EXTRAS__`, injected by `doGet` via
`injectServerExtras_` alongside (not instead of) `injectServerPrefs_`.

This section is NOT frozen the way the section above is — it's a working
description of what exists, not a spec four agents built against in
parallel. Update it in place as this extension changes.

### Shape

    window.__SERVER_EXTRAS__ = {
      filterPrefs: { available: true, value: "<JSON string, or null>" }
                    | { available: false, reason: "no-user-identity" | "properties-unavailable", value: null }
    };

`filterPrefs` follows the exact same per-user, email-namespaced
`getScriptProperties()` pattern as the three booleans (see `prefStoreKeyFor_`
above) — same reasoning, same fail-closed posture.

### Client -> server functions

- `saveUserFilterPrefs(json)` — persists one visitor's `FilterPrefsStore`
  blob; an empty string deletes it ("Reset to defaults"). Rejects (without
  writing) a non-string, invalid JSON, or a payload at/over 8000 bytes
  (PropertiesService's real 9 KB/value limit, with headroom — the client's
  own `FILTER_PREFS_MAX_BYTES` is 200 KB). An oversized blob stays
  localStorage-only; on load the client restores whichever of the server
  copy and localStorage has the newer `savedAt`, so a stale server copy never
  overrides a newer local one.
- `exportCurrentViewToDrive(rowsJson, sheetTitle)` — the on-demand "Export to
  Drive" button's server call. Builds a Sheet from the Detail tab's current
  filtered view (`buildSnapshotRows`) in a "Booking Flash Snapshots" folder in
  the clicking visitor's own Drive.

### Deployment mode: "Execute as: User accessing the web app"

Changed 2026-09-28 (per Kevin: everything in this extension should act as
the user, not the deploying account). Under "Execute as: Me", `DriveApp` ran
as the deploying account for every visitor, so exports landed in Kevin's
Drive behind a link the visitor could not open. Under "User accessing" each
call runs as the visitor. Script properties remain script-global, so the
email-namespaced keys above are unaffected.

### Why the date-cell link is NOT one of these server functions

The small link icon next to Cutoff/ETD dates opens ONE's internal OPUS
Container vessel schedule screen. (It was an "Add to Calendar" deep link until
2026-10-01, when every calendar feature was removed.) Either way it is a client-only link
(same family as the Gmail-search feature) that opens in the visitor's own
browser, so it needs no server round trip and no OAuth scope — see the app's
`dateScheduleLink`/`openScheduleLink` comment.

### What redeploying this adds to the consent screen

Every visitor (not just Kevin) sees a one-time consent screen on first open
after the redeploy, for Drive (`exportCurrentViewToDrive`, via
`DriveApp`/`SpreadsheetApp`). No Gmail or Calendar scope. Until redeployed,
the app degrades exactly like every other server-backed feature here:
`window.__SERVER_EXTRAS__` is simply never injected, every gated code path
sees that as unavailable, and nothing breaks.

### Archived: schedule-change digest (2026-09-29)

PR #136 originally also emailed a schedule-change digest (`GmailApp`) and
saved an automatic Drive snapshot whenever the app's existing
`diffScheduleChange(...).isSignificant` fired, with an org-wide recipient
list editable in Settings. It was removed per Kevin before ever being
deployed. The last version is commit `ee8e5d3` on
`claude/gmail-vessel-names-cf4ef1` (`reportScheduleChange`,
`saveDigestRecipients` in `Code.gs`; `reportScheduleChangeToServer`,
`buildScheduleChangeDigestSummary` and the "Digest recipients" Settings field
in the app).

Why it was dropped: it only ran when someone happened to have the report open
(the browser detected the change and called the server), it went to one
shared list anyone could edit, and a browser-triggered send can't be both
"from the user" and "once per change" without electing an arbitrary visitor
as sender.

If it's revived, the design discussed was a server-side time-based trigger
instead: `Code.gs` fetches `CSV_SOURCE_URL` with `UrlFetchApp` every 30-60
minutes, diffs against a baseline stored in a Drive file (too large for a
9 KB script property), and BCCs a digest to per-user opt-in subscribers (each
person subscribes only their own address from Settings). Two things to decide
first: an installable trigger always runs as the account that created it, so
the digest would be sent from that account (Kevin's, or a shared team
mailbox), not from each user; and `diffScheduleChange` would need porting to
`Code.gs` with a check that keeps both copies in sync.

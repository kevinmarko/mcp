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

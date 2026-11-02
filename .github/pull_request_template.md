<!--
This repo has no build step and (until this PR) no CI -- see README.md's "Verifying changes"
section and AGENTS.md's "Required checks" section for the full, authoritative list. Fill in
what you actually ran; don't leave boxes checked that you didn't verify.
-->

## What changed and why

<!-- The behavior before, the behavior after, and the concrete evidence (bug report, data
mismatch, screenshot) that motivated the change -- not just a description of the diff. -->

## Verification

- [ ] **Syntax check** — extracted the app's inline script and ran it through Babel + `node --check`
- [ ] **Alias-landmine check** — ran `tests/check_alias_landmines.py` against a real export (only if this PR adds/edits a `getVal()` call)
- [ ] **Date timezone-safety check** — ran `node tests/check_date_timezone_safety.js` (only if this PR adds/edits an `XLSX.read(...)` call)
- [ ] **Live regression suite** — ran `tests/booking_flash_regression_tests.js` against real data in a real browser, read the executed-check count (not just the pass rate)

If a check was skipped, say why (e.g. "docs-only change, no app file touched").

## Related issues

<!-- Closes #123, or "none" -->

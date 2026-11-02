<!--
This repo has no build step and no GitHub Actions (D59) -- see README.md's "Verifying changes"
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
- [ ] **Branch overlap** — ran `node scripts/check_pr_overlap.js` (it matches function names, not meaning, and sees only pushed branches); paste any `OVERLAP` lines under "What changed and why" and say how they are handled, or write "none"
- [ ] **Decisions** — cited the entries from `docs/DECISIONS.md` this change relies on (D-numbers), or "none"; a new product decision was added there before it was built
- [ ] **Local gate** — ran `node scripts/run_ci_locally.js --post-status` in full on this branch with `main` merged in (there is no GitHub Actions, D59); the PR shows a green `local-gate` check on the current head. Docs-only: `--fast --post-status` is enough
- [ ] **Landing** — will merge on GitHub once `local-gate` is green on the current head and the branch is up to date with `main` (D59); use `node scripts/land.js <PR number>` instead if the overlap check flags this branch, the PR combines two sessions' logic (then also say whether a fix-removed (red) run was done), or Kevin asks

If a check was skipped, say why (e.g. "docs-only change, no app file touched").

## Related issues

<!-- Closes #123, or "none" -->

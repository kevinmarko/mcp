# Agent instructions: Booking Flash Report NA

Read this first. It's the short, operational entry point for any AI coding agent (or human)
working in this repo — **what to do before/after making a change**, not the full project
history. For everything else, go to:

- [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) — the authoritative field-mapping reference:
  every `getVal()` field, its real source column, which tab renders it, the frozen/static
  datasets, the reference `.xlsm` workbook's structure, and per-tab validation status. Read
  this — not just HANDOFF.md — before adding a new field or investigating "this number looks
  wrong."
- [HANDOFF.md](HANDOFF.md) — full project history, architecture, every non-obvious gotcha and
  bug class found so far. Read this before touching numeric/color logic or the pivot engine.
- [README.md](README.md) — how to run the app locally, tech stack, repo structure.

The app itself is one file: `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` (React 18 +
Babel Standalone, no build step — see README's "Current version" note for why the filename has
a version number baked in and how to tell which file is live; **always check that note before
trusting a filename stated anywhere else, including this file** — this exact line went stale
once already and pointed at a frozen `..._1.10_...` snapshot instead of the live file).

## Required: run the checks after every change to the app

This repo has no CI and no test framework by design (see README), which makes it easy to ship
a change that *looks* right in the diff but is broken at runtime — this has actually happened
more than once in this project's history (see [HANDOFF.md's "Known bug classes"](HANDOFF.md#known-bug-classes-read-before-touching-numericcolor-logic)
and the regression suite's own header comment for real examples, including a `ReferenceError`
that a syntax check alone did not catch because the deleted function was still called
~15 lines away). Checks 1 and 4 below are required after any change to the app file, in order —
don't stop at the first one and call the change done; check 2 is required only when the change
touches a `getVal()` call, check 3 only when it touches an `XLSX.read(...)` call or how a CSV/xlsx
file gets parsed:

1. **Syntax check** (fast, catches JSX/JS syntax errors only):
   ```bash
   python3 - <<'EOF'
   import re
   content = open('booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html').read()
   open('/tmp/extracted.jsx', 'w').write(re.search(r'<script type="text/babel">(.*?)</script>', content, re.DOTALL).group(1))
   EOF
   node -e "
   const babel = require('@babel/core');
   const fs = require('fs');
   const result = babel.transformFileSync('/tmp/extracted.jsx', { presets: ['@babel/preset-react'] });
   fs.writeFileSync('/tmp/out.js', result.code);
   " && node --check /tmp/out.js
   ```
   Use `require('@babel/core')` directly, **not** `npx babel ...`. This repo only has
   `@babel/core`/`@babel/preset-react` installed as libraries (no `@babel/cli`), so in a fresh
   container `npx babel` silently auto-installs and runs an unrelated ancient `babel@5.x` package
   from the registry instead — one that can't parse modern syntax (e.g. `??`) and falsely reports
   working code as broken. Confirmed 2026-08-25.

   This does **not** catch a runtime `ReferenceError`, a broken data computation, or a UI
   regression — it only proves the JSX parses. Do not treat a clean syntax check as "the change
   works."

2. **Alias-landmine check** (required whenever you add or edit a `getVal([...])` call —
   otherwise skip this step): `getVal()`'s substring-fallback pass can match an unrelated real
   column instead of the one you meant, silently, only on rows where the intended column happens
   to be blank — this exact bug class has broken six different fields across two audits (see
   DATA_ARCHITECTURE.md's Class E). Run:
   ```bash
   python3 tests/check_alias_landmines.py <any-current-real-export.xlsx-or-.csv>
   ```
   against whatever real data file you have on hand. It auto-detects the current app version by
   filename. A clean run prints `✅ No landmines found`; any `❌ LANDMINE(S) FOUND` line names the
   exact field/alias to fix before moving on — see DATA_ARCHITECTURE.md's Class E section for the
   fix pattern (drop the alias, or make it specific enough not to substring-collide).

3. **Date timezone-safety check** (required whenever you add or edit an `XLSX.read(...)` call,
   or change how a CSV/xlsx file gets read — otherwise skip this step): SheetJS's CSV parser
   auto-detects an ISO-shaped date cell and round-trips it through a UTC-anchored `Date` object,
   silently shifting it a day in any timezone west of UTC — invisible in a UTC sandbox, which is
   exactly why this went uncaught until Kevin reported it (2026-09-08 — see
   DATA_ARCHITECTURE.md's Class F). Run:
   ```bash
   npm install   # first time only, pulls in the pinned xlsx test dependency
   node tests/check_date_timezone_safety.js
   ```
   Needs no live browser and isn't sensitive to the sandbox's own ambient timezone — it forces
   the timezones itself via subprocess. A clean run prints `✅ PASS`; a `❌ FAIL` names the exact
   `XLSX.read()` call site missing `raw: true` (the fix — see DATA_ARCHITECTURE.md's Class F for
   why that specific flag, and why it must NOT be added to a `type: 'binary'` file-upload call).

4. **Live regression suite** (required, catches actual runtime/data bugs):
   [`tests/booking_flash_regression_tests.js`](tests/booking_flash_regression_tests.js) —
   structural/invariant checks (not hardcoded-number snapshots) covering Trade Summary, Sector
   Summary, POL Booking Flash, and Booking Flash. Run it against a **live browser** with real
   data loaded, per [HANDOFF.md's Live-testing method](HANDOFF.md#live-testing-method):
   - Serve the directory over local HTTP (never `file://`).
   - If the sandbox can't reach the CDN scripts directly (common in an isolated agent
     environment), fetch React/ReactDOM/Babel-standalone/Tailwind/SheetJS once via whatever
     proxy is available, save them locally, and swap the `<script src="https://...">` tags in a
     throwaway copy of the HTML to point at the local files — never edit the CDN URLs in the
     real file.
   - Simulate a file upload (`fetch()` the sample `.xlsx`, build a `File`/`DataTransfer`, assign
     to the hidden `<input type=file>`, dispatch `change`) — a real OS file picker isn't
     automatable.
   - Inject `tests/booking_flash_regression_tests.js` (e.g. Playwright's `page.addScriptTag`)
     and call `runBookingFlashRegressionTests()`, or open dev tools and paste the file directly.
   - Read the returned report / console output for `❌ FAIL` lines.

   **A change is not done until this suite runs clean against it** (see the exception below for
   known flakiness). If a change intentionally alters what a check asserts (e.g. removing a UI
   element the check depended on, as happened when the Grand Total rows and Sector Summary's
   KPI cards were removed on 2026-08-24), **update the test alongside the app change in the same
   commit** — don't leave the suite asserting stale behavior. A failing check that still makes
   sense for the new behavior means the app has a bug; a failing check that no longer makes
   sense for the new *intended* behavior means the test is stale and needs updating, not
   silencing.

### Known flakiness — don't let this excuse skipping the suite

Running the **entire suite in one long automated script** has intermittently produced spurious
failures in this sandbox, specifically right after a tab switch or modal close/open in quick
succession (documented in the test file's own comments and HANDOFF's Live-testing method point
6). This is **automation timing noise, not a real bug**, characterized in HANDOFF and the test
file across multiple sessions. The failure signature: a "Setup: table/modal found" check fails,
and re-running the exact same suite produces a different failure (or none) each time, while a
**deliberate, single-step check** (click the one tab, wait ~1.5–2s, then inspect — no chained
suite) reliably succeeds. When the full suite reports a failure:

1. Re-run once. If the *same* check fails identically both times with the *same* numbers, treat
   it as real — go fix it.
2. If it's a different check each time, or a "not found" failure on something you can verify
   exists with a direct, deliberate, single-step check, it's the known flakiness. Confirm with
   the deliberate check, not by re-running the automated suite over and over.

Never conclude "the suite is just flaky, skip it" — always resolve every failure to one of the
two buckets above before calling a change done.

## Full data-linkage validation workflow

Use this when asked to do a full data-correctness audit (not just verify one change) — e.g.
"check every tab/column against a new export," or after Kevin sends a new raw file and/or the
reference `.xlsm` workbook. This is what actually found and fixed the 7 bugs documented in
DATA_ARCHITECTURE.md's [Validation status](DATA_ARCHITECTURE.md#validation-status-by-tab) table
on 2026-08-25 — it's a repeatable process, not a one-off.

1. **Static sweep first** (seconds, catches the whole Class E bug class before touching a
   browser): `python3 tests/check_alias_landmines.py <the new export>`. Fix anything it finds
   before moving on to live checks — no point live-verifying a field you already know is
   mis-wired.
2. **Get the strongest ground truth available.** A fresh raw export is the minimum. If Kevin has
   also provided the current reference `.xlsm` workbook, prefer cross-checking against its own
   cached computed values over re-deriving expected values from the raw file by hand — it
   captures the real system's actual rounding/edge-case behavior, not your guess at it (see
   DATA_ARCHITECTURE.md's [Reference workbook](DATA_ARCHITECTURE.md#reference-workbook-the-real-ground-truth)
   section for how to read it).
3. **Fan out per tab/column-group, not one pass covering everything serially.** The 2026-08-25
   audit used 5 parallel agents (3 against the raw CSV, 2 against the `.xlsm`'s cached values),
   each scoped to a specific tab or column group, explicitly told what the *other* agents already
   covered so nothing was duplicated or silently skipped. Each agent: extract real values for a
   real sample of rows (aim for exhaustive — hundreds of rows, not a handful — the bugs found this
   way were often narrow, triggered on a small fraction of rows), independently recompute the
   expected value from source, and report concrete mismatches (exact identifier, expected vs.
   actual, root cause + line number if found) rather than a pass/fail summary alone.
4. **A diff against a `.xlsm` snapshot is not automatically a bug** — this app is live/auto-
   refreshing, so a stale reference file will disagree with the app on any volatile field just
   from time passing. Before calling something broken, check whether the app's value matches its
   OWN raw source row for that same field — that's the real bug signal, not disagreement with an
   older snapshot.
5. **Update [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md)** with whatever the audit found — new
   validation-status coverage, any newly-discovered frozen/static dataset, any fixed field's
   corrected source column — in the same pass, not as a follow-up someone else has to remember.

## Housekeeping this file doesn't cover

Git workflow (branch/PR conventions), the DAX formula reference, and the full bug-class catalog
live in HANDOFF.md. Field-mapping aliases, per-tab column inventory, and validation status live
in DATA_ARCHITECTURE.md. This file intentionally doesn't duplicate either.

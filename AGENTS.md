# Agent instructions: Booking Flash Report NA

Read this first. It's the short, operational entry point for any AI coding agent (or human)
working in this repo — **what to do before/after making a change**, not the full project
history. Two things to read here before you start: the
[required checks](#required-run-the-checks-after-every-change-to-the-app) you must run after any
change to the app, and the
[working practices](#working-practices-verifying-reporting-and-committing) for how to verify,
report, and commit what you find. For everything else, go to:

- [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) — the authoritative field-mapping reference:
  every `getVal()` field, its real source column, which tab renders it, the frozen/static
  datasets, the reference `.xlsm` workbook's structure, and per-tab validation status. Read
  this — not just HANDOFF.md — before adding a new field or investigating "this number looks
  wrong."
- [HANDOFF.md](HANDOFF.md) — full project history, architecture, every non-obvious gotcha and
  bug class found so far. Read this before touching numeric/color logic or the pivot engine.
- [README.md](README.md) — how to run the app locally, tech stack, repo structure.

The app itself is one file whose name changes with every version bump — currently
`Booking_flash_report_na_1.67_TESTING.html` (React 18 + Babel Standalone, no build
step — see README's "Current version" note for why the filename has a version number baked in
and how to tell which file is live; **always check that note before trusting a filename stated
anywhere else, including this file** — this exact line went stale once already, pointing at a
frozen `..._1.10_...` snapshot instead of the live file). **Do not hardcode that filename
anywhere in this repo, including below** — see the note on check 1, which went stale the exact
same way and was fixed the same day this paragraph was reworded.

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

1. **Syntax check** (fast, catches JSX/JS syntax errors only). **This line hardcoded
   `booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html` — a frozen point-in-time snapshot,
   not the live app — for a long time, which meant anyone who ran this exact command was
   syntax-checking the wrong file and got a green result that said nothing about their change.
   README.md's "Current version" note already flagged that this project's naming SCHEME itself
   changed once (2026-09-04) and that `tests/check_alias_landmines.py`'s own auto-detect went
   stale the same way at the same time — this command had the identical bug, just not caught
   until a 2026-09-10 doc-drift pass. Fixed here by deriving the filename the same way that
   script does (highest dotted-version number among `Booking_flash_report_na(_Kevin)?_<ver>_*.html`
   in the repo root, matching both naming eras) instead of a literal name, so the next version
   bump can't make this go stale a third time. If you ever find yourself typing a literal
   `..._1.NN_...html` filename into this repo's docs or scripts, stop — that is exactly the
   mistake this paragraph exists to prevent.**
   ```bash
   python3 - <<'EOF'
   import re, os
   # Same detection algorithm as tests/check_alias_landmines.py's own auto-detect (see that
   # script's header comment for the two-naming-era history this must match). Kept in sync by
   # hand since this is a doc snippet, not an importable module -- if you change one, change
   # both, and check_date_timezone_safety.js's `findAppHtml()` (a JS port of the same rule).
   repo_root = os.getcwd()
   candidates = [f for f in os.listdir(repo_root) if re.match(r'[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$', f)]
   assert candidates, f"No Booking_flash_report_na*.html file found in {repo_root}"
   version_key = lambda fname: tuple(int(p) for p in re.search(r'na_(?:Kevin_)?([\d.]+)_', fname).group(1).split('.'))
   html_path = max(candidates, key=version_key)
   print(f"(auto-detected current app version: {html_path})")
   content = open(html_path).read()
   open('/tmp/extracted.jsx', 'w').write(re.search(r'<script type="text/babel">(.*?)</script>', content, re.DOTALL).group(1))
   EOF
   node -e "
   const babel = require('@babel/core');
   const fs = require('fs');
   const result = babel.transformFileSync('/tmp/extracted.jsx', { presets: ['@babel/preset-react'] });
   fs.writeFileSync('/tmp/out.js', result.code);
   " && node --check /tmp/out.js
   ```
   Run this from the repo root (so `os.getcwd()` and `require('@babel/core')` both resolve
   correctly) and confirm the printed "(auto-detected current app version: ...)" line names the
   file you actually meant to check — don't just trust a green `node --check`.

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
   - **Optionally pin the sector data source to its committed fixture.** The Sector
     Summary's right-hand pivot is fed by a LIVE published Google Sheet
     (`SECTOR_DATA_CSV_URL`), so its numbers drift week to week. Route that request to
     `tests/fixtures/sector_data_2026-09-16.csv` and set
     `window.__BFRT_SECTOR_FIXTURE__ = true` before first paint, and the suite adds an
     exact column-mapping check against that fixture. In Playwright:
     ```js
     await page.route(u => u.href.includes('2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS'),
         r => r.fulfill({ status: 200, contentType: 'text/csv', body: fixtureCsvText }));
     await page.addInitScript(() => { window.__BFRT_SECTOR_FIXTURE__ = true; });
     ```
     Expected counts: **72 checks live, 73 pinned** — the one extra is that exact
     comparison, which is skipped (not failed) on an unpinned run because today's live
     Sheet cannot be meaningfully compared against a committed snapshot. Both modes
     should be fully green; compare counts within a mode, not across them. See the test
     file's own note above `SECTOR_RIGHT_FIXTURE_GROUND_TRUTH` for why this check is
     pinned rather than loosened, and how to refresh the fixture.
   - **Start from clean browser storage** — a fresh browser context, or clear the app's
     `localStorage` keys (the `bookingFlash*` ones) before loading. The app persists view state
     per browser, so a profile carrying saved preferences can start the suite with non-default
     filters or hidden columns. Filters are the real risk, not columns: the suite clears filters
     itself at setup but never resets column visibility, and a leaked slicer selection filters the
     table so whole suites abort at setup — producing exactly the low-executed-check-count
     signature described below, which reproduces identically on re-run and so reads convincingly
     like a real bug.
   - If the sandbox can't reach the CDN scripts directly (common in an isolated agent
     environment), fetch React/ReactDOM/Babel-standalone/Tailwind/SheetJS once via whatever
     proxy is available, save them locally, and swap the `<script src="https://...">` tags in a
     throwaway copy of the HTML to point at the local files — never edit the CDN URLs in the
     real file.
   - Simulate a file upload (`fetch()` the sample `.xlsx`, build a `File`/`DataTransfer`, assign
     to the hidden `<input type=file>`, dispatch `change`) — a real OS file picker isn't
     automatable.
   - Inject `tests/booking_flash_regression_tests.js` (e.g. Playwright's `page.addScriptTag`,
     or `page.evaluate` on its source text) — the file **self-invokes once** the moment it's
     injected/pasted (its own trailing call at the bottom). **Do NOT also call
     `runBookingFlashRegressionTests()` yourself afterward** — the file now guards against a
     second concurrent call (returns the in-flight run's own result instead of starting a
     second copy), but a script written before that guard existed, or a fresh eval context
     without it, would run TWO unsynchronized copies of the suite at once, each independently
     clicking tabs and opening/closing the Analyze modal — a race that produced a stable,
     IDENTICAL-every-time 9-failure signature in this sandbox (root-caused 2026-09-15; see the
     test file's own "DOUBLE-INVOCATION GUARD" comment). Read the result via
     `window.__bfrtLastResult` (poll it after injecting — `null` until the self-triggered run
     finishes) or by scraping console output for the `✅ ALL TESTS PASSED` / `❌ SOME TESTS
     FAILED` line, not by calling the function and awaiting its return value directly.
   - Read the returned report / console output for `❌ FAIL` lines.
   - **Read the executed-check COUNT, not just the pass rate** — see "Check the executed-check
     count, not the pass rate" below. A run reporting `28/32` is not a mostly-passing run when
     the suite contains ~75 checks; it's a run where whole suites aborted before they started.

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
   it as real — go fix it. **But first rule out a test-harness-side cause** (e.g. a script that
   injects this file and ALSO calls `runBookingFlashRegressionTests()` itself, running two
   unsynchronized copies that race each other — see the caveat below): a fully deterministic
   race reproduces identically every time in a fixed sandbox too, which otherwise satisfies this
   exact bucket without the app actually having a bug.
2. If it's a different check each time, or a "not found" failure on something you can verify
   exists with a direct, deliberate, single-step check, it's the known flakiness. Confirm with
   the deliberate check, not by re-running the automated suite over and over.

Never conclude "the suite is just flaky, skip it" — always resolve every failure to one of the
two buckets above before calling a change done.

**Caveat added 2026-09-15**: "identical failure set on re-run" does NOT always mean "real bug" —
it can also mean a fully deterministic race, which reproduces identically every time in a fixed
sandbox (same machine, same browser, same data) despite being a race, not a bug in the app under
test. This is exactly what happened here: automation that injected the test file and ALSO called
`runBookingFlashRegressionTests()` itself (the old instruction above) ran two unsynchronized
copies of the suite concurrently, racing on shared page state (tab clicks, Analyze modal open/
close). That produced the *same* 9-failure set on every re-run — satisfying bucket 1's "identical
both times, treat as real" test — even though a correct single-invocation run had 0 failures. The
test file now guards against this specific race (see its own comment), but the general lesson
generalizes: before spending real effort "fixing" an identically-reproducing failure, also rule
out a test-harness-side race (double invocation, shared global/module state two runs both mutate,
etc.), not just app-side logic — determinism proves the *timing* is stable, not that the *thing
being measured* is a real defect in the app.

## Working practices: verifying, reporting, and committing

These three rules exist because each one was learned the hard way in this repo. They apply to
any agent or human doing investigative work here (audits, bug hunts, perf passes), on top of
the required checks above.

### Verify against real data before reporting

Never report a finding — a bug, a row count, a performance number, a field mapping — that you
have only reasoned about. Run it against a real file first. The repo ships three:

- `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` — a real single-day export (964 raw rows,
  which aggregate to ~434 rows in the Booking Flash detail table).
- `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` — 9 days, **8,769 rows**.
- `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm` — the original workbook, with **cached
  computed values**. Cross-checking against those beats re-deriving expected values by hand: it
  captures the real system's actual rounding and edge-case behavior rather than your model of
  it. (But see the validation workflow below: a diff against a stale `.xlsm` is not by itself a
  bug on a live/auto-refreshing app.)

**Count rows with an RFC4180 parser, never `wc -l`.** That historical CSV reports 27,312 lines
but holds 8,769 rows — quoted cells contain embedded newlines, so a line is not a row. On
2026-09-10 a performance review was written around the inflated figure and had to be corrected
throughout after measurement; the same review separately claimed the detail table rendered "well
over 100k DOM nodes" when the real figure is ~17k, which would have justified a risky and
unnecessary virtualization rewrite. Both errors came from reasoning instead of measuring.

Report concrete evidence: the exact identifier (lane / VVD / sale week / column), the input
value, expected vs. actual, and the root cause with a line number. Not "this looks wrong," and
not a pass/fail summary on its own. And **separate confirmed findings from suspected ones** — a
suspicion you could not confirm is still worth reporting, clearly labelled as unconfirmed.
Overstating it as confirmed is what wastes the next person's time.

### One commit per confirmed bug

Each confirmed bug gets its own commit, with a message that says what was wrong and how you know
it was wrong. Do not bundle several fixes together, and never bundle a speculative refactor with
a confirmed fix.

This repo has no CI (by design — see README). Independent commits are the only cheap way to
revert one bad fix without losing four good ones, and the only way a reviewer can judge each
change on its own evidence. If a fix and a test update belong to the same behavioral change, they
*do* go in one commit together (see check 4 above) — that is one change, not two.

### Check the executed-check count, not the pass rate

When you run the regression suite, look at **how many checks actually ran** before you look at
how many passed. The suite contains roughly 75 `record()` calls; a setup failure aborts its
whole suite, so the remaining checks in it never execute and never report.

On 2026-09-10 an agent reported `28/32` and concluded the suite "does not pass on v1.66" — a
claim that was relayed onward as fact. Two other agents running the same suite against the same
file got `55/55` and `58/58`, twice each. The tell was the count, not the failures: 32 executed
checks meant roughly 23 checks' worth of suites had aborted at setup in that agent's browser
automation. Its environment was broken, not the app.

Note this is a failure mode that comparing against a baseline run **cannot** catch — that agent
did compare against unmodified v1.66, exactly as the flakiness rules above prescribe, and
reproduced its own failures there, because both of its runs shared the same broken harness. Only
cross-checking against an independently-driven run exposed it. So when a suite result surprises
you, re-derive it from a different setup rather than re-running your own.

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

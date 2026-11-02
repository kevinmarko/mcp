# Testing guide

How to run each check, what it needs, and what a correct result looks like. [AGENTS.md](../AGENTS.md)
says *which* checks a change needs; this file says *how* to run them. The story behind each rule
(the bug that caused it, the dated counts) is in [CHECK_HISTORY.md](CHECK_HISTORY.md).

## One command: `scripts/run_ci_locally.js`

Runs every job in `.github/workflows/ci.yml`, in order, with the same commands, and prints one
pass/fail table. Exit code 0 means every blocking job passed. This is the real gate while GitHub
Actions is billing-blocked (see AGENTS.md).

```bash
npm ci                              # first time, and after package.json changes
npx playwright install chromium     # first time only
python3 -m pip install openpyxl     # first time only
node scripts/run_ci_locally.js                # everything, ~5 min
node scripts/run_ci_locally.js --fast         # skip the 4 browser jobs, ~10 s
node scripts/run_ci_locally.js --ci-budgets   # highlight budgets scaled 1.5x, like CI's runners
```

In a sandbox that can't reach the CDNs or has a different Chromium build:

```bash
BF_VENDOR_CDN=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/run_ci_locally.js
```

- `BF_VENDOR_CDN=1` loads React, Babel, Tailwind and SheetJS from `tests/vendor/` instead of the CDNs.
- `PW_CHROMIUM_PATH` points Playwright at a pre-installed Chromium (symptom without it:
  `Executable doesn't exist at .../chromium_headless_shell-NNNN`).

| Job | Blocking? |
|---|---|
| Syntax check (source) | yes |
| Deployable build up to date, plus a syntax check of the compiled payload | yes |
| Alias-landmine check (needs `openpyxl`) | yes |
| Field-picker filter-gating, server prefs, server extras, archive (`Code.gs`), team features (`DataFeeds.gs`/`TeamSheet.gs`), Compare KPIs, app-file resolver, timezone safety | yes |
| Live regression suite, source | no (informational; see "Flaky or real?") |
| Live regression suite, `dist/index.html` | yes |
| Row-highlight budget, source and `dist/index.html` | yes |

**Keep it in step with `ci.yml`.** A job added to one and not the other is a check nobody runs.

## Headless checks

Each is a standalone script with no browser. Run them directly when you only touched their area.

| Script | Run after changing | Result |
|---|---|---|
| `tests/check_alias_landmines.py <export.xlsx or .csv>` | any `getVal([...])` call | `✅ No landmines found` |
| `tests/check_date_timezone_safety.js` | any `XLSX.read(...)` call, or how a CSV/xlsx is parsed | `✅ PASS` |
| `tests/check_field_filter_gating.py` | the Fields picker or slicer gating | pass |
| `tests/check_server_prefs_logic.js` | server-backed preferences, `resolveUserPref` | pass |
| `tests/check_server_extras_logic.js` | filter-prefs sync, Export to Drive, `__SERVER_EXTRAS__` | pass |
| `tests/check_archive_logic.js` | the per-day archive in `Code.gs` | 46/46 |
| `tests/check_team_features_logic.js` | `DataFeeds.gs`, `TeamSheet.gs`, `doGet`, the app's `SERVER CONFIG RESOLUTION`, `NOTES SLICER FILTER` and `NOTES ORGANIZE` blocks (the notes-dialog list helpers: hashtag search and the tag-bar chips, `buildNoteTagChips`, included) | 337/337 (was 311/311 on 2026-10-02) |
| `tests/check_compare_kpis.js` | the app's "shared capacity helpers" block or the Compare tab | pass |
| `tests/check_resolve_app_html.js` | `resolveAppHtml()` in `tests/perf_benchmark.js` | pass |

The alias check needs a real export; the repo ships `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`.
The `.gs` checks run the real Apps Script files against simulated Google services, so they prove the
logic, not real Drive/Sheets permissions, trigger timing or sharing. Only the deployed `/exec` URL
proves those (see `apps-script/README.md`).

## The live regression suite

`tests/booking_flash_regression_tests.js` holds structural and invariant checks across every tab, run
in a real browser with real data. `tests/ci_regression_runner.js` drives it headlessly and is what CI and
`run_ci_locally.js` use:

```bash
BF_VENDOR_CDN=1 node tests/ci_regression_runner.js                              # source
BF_VENDOR_CDN=1 BF_APP_HTML=dist/index.html node tests/ci_regression_runner.js  # deployed artifact
```

It prints `Executed checks: N (expect M), per suite:` followed by one line per suite counted from that run, and fails on a
count mismatch. Since 2026-10-03 the line carries only that breakdown; the dated history of totals lives only in the
comment above `EXPECTED_TOTAL_CHECKS` in the runner.

### Slow machines: `BF_RESULT_POLL_TIMEOUT_MS` (2026-10-03)

After the runner injects the suite it polls `window.__bfrtLastResult` every 0.5 s. `BF_RESULT_POLL_TIMEOUT_MS` is the
ceiling on that wait, in milliseconds. It is a **hang detector, not a speed budget**: a suite that finishes is read the
moment it lands, so a higher ceiling costs a healthy run nothing and only delays the verdict on a hung one.

- **Default 240000** (4 minutes) when unset or empty. Give it a positive whole number of milliseconds. Anything else
  (text, `0`, a negative number, a decimal, `1e5`) falls back to 240000 and prints one warning line at the top of the
  log, so a typo cannot silently remove the limit.
- **Inherited by `scripts/run_ci_locally.js`.** Its jobs are spawned with the parent's environment (`sh()` passes
  `process.env` on), so `BF_RESULT_POLL_TIMEOUT_MS=900000 node scripts/run_ci_locally.js` reaches both live-suite jobs,
  source and `dist/index.html`. No other job reads it.
- **When to raise it:** a slow or CPU-limited sandbox. The source run compiles the app in the browser with
  babel-standalone (about 5 s per page load, and the `Apps_Script_Team_Features` suite boots two more copies); in this
  sandbox it took about 7 minutes against the 4-minute default, while the `dist/` run (JSX compiled ahead of time) took
  about 2.5 minutes. The symptom is `Suite did not finish within 240000ms (window.__bfrtLastResult stayed null)` with
  nothing wrong in the app. Example: `BF_RESULT_POLL_TIMEOUT_MS=900000 BF_VENDOR_CDN=1 node tests/ci_regression_runner.js`.
- **When not to:** a real hang looks the same from the runner's side as a slow machine. If the last `[page:log]` line in
  the output stopped advancing minutes ago, the suite is stuck (a modal that never opens, an await that never settles)
  and a bigger ceiling only makes you wait longer for the same failure.
- **Why an environment variable and not an edited constant:** on 2026-10-02 the source run needed the constant raised to
  1500 s in a hand-edited copy, which is how a local workaround ends up in a commit. CI itself keeps the default.

### Current counts (2026-10-03): 325 checks

| Suite | Checks | Suite | Checks |
|---|---|---|---|
| Trade_Summary | 6 | Preferences_Persistence | 42 |
| Sector_Summary | 15 | Field_Visibility | 8 |
| POL_Booking_Flash | 18 | Filter_Persistence | 42 |
| Booking_Flash | 16 | Gmail_Search_Debounce | 9 |
| Analyze_BookingFlash | 21 | Fields_Picker_ReAnchor | 6 |
| Analyze_POLBookingFlash | 15 | OPUS_Schedule_Link | 9 |
| Trade_Summary_CommaGuard | 3 | Server_Extras_UI_Gating | 3 |
| Compare | 13 | Historical_PerDay_Archive | 12 |
| Historical_Data | 6 | Apps_Script_Team_Features | 81 (was 76) |

Suites 1-9 (left column) total 113 with both fixtures pinned. `EXPECTED_TOTAL_CHECKS` in
`tests/ci_regression_runner.js` is the source of truth; when a suite gains or loses checks, update it
there and in this table in the same commit. Re-derive counts from a real run, never from a copy.

### Read the executed-check count, not the pass rate

A setup failure aborts its whole suite, and some suites skip by design when a data source is
unreachable. Both leave a run that is "all green" with checks missing. After a run, compare per-suite
counts with the table above:

```js
const by = {}; window.__bfrtLastResult.results.forEach(x => by[x.suite] = (by[x.suite]||0)+1); by
```

A suite at zero disappears from that object entirely. If a result surprises you, re-derive it from a
different setup (another machine or browser, the runner vs. a hand-driven run) rather than re-running
your own: two runs through the same broken harness agree with each other.

### What the runner does for you, and what a hand-driven run must do too

1. **Serve over HTTP, never `file://`**, and confirm the server is serving *your* checkout (see
   "Serving the app" below).
2. **Pin every live data source to its committed fixture.** The app fetches three published Google
   Sheets on its own; unpinned, the suite measures whatever those Sheets hold today.

   | Source (URL fragment) | Fixture | Flag set before first paint |
   |---|---|---|
   | `CSV_SOURCE_URL` (`2PACX-1vQNykGT8bYqwDC4k9loE5L8`) | `tests/fixtures/live_csv_2026-08-12.csv` | (none) |
   | `SECTOR_DATA_CSV_URL` (`2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS`) | `tests/fixtures/sector_data_2026-09-16.csv` | `window.__BFRT_SECTOR_FIXTURE__ = true` |
   | `HISTORICAL_DATA_CSV_URL` (`2PACX-1vR1YNb3SKa8jS53bK`) | `tests/fixtures/historical_data_2026-08-24_to_2026-08-26.csv` | `window.__BFRT_HISTORICAL_FIXTURE__ = true` |

   ```js
   await page.route(u => u.href.includes('2PACX-1vQNykGT8bYqwDC4k9loE5L8'),
       r => r.fulfill({ status: 200, contentType: 'text/csv', body: liveCsvFixtureText }));
   await page.addInitScript(() => { window.__BFRT_SECTOR_FIXTURE__ = true; });
   ```

   The live fixture is generated from the sample `.xlsx` by `node tests/make_live_csv_fixture.js`,
   which refuses to write if a single cell differs between the two read paths. Never capture what the
   app rendered as a fixture: that freezes a bug in as "expected".
3. **Start from clean browser storage** (a fresh context, or clear the `bookingFlash*` keys). A saved
   filter from an earlier session can abort whole suites at setup.
4. **Upload the sample export** by building a `File` in a `DataTransfer`, assigning it to the hidden
   `<input type=file>` and dispatching `change`.
5. **Inject the suite once and do not call it yourself.** The file self-invokes. Read the result from
   `window.__bfrtLastResult` (null until the run finishes) or the `✅ ALL TESTS PASSED` /
   `❌ SOME TESTS FAILED` console line.
6. **POL is windowed; the suite renders it in full.** It dispatches
   `bookingflash:pol-render-all` (`detail: true`) at the start and `false` at the end. A new POL check
   that reads rows from the DOM must run while render-all is on, or it silently checks ~100 rows of
   thousands.

### Flaky or real?

An unattended full-suite run occasionally fails a "Setup: ... found" check right after a tab switch
or modal open. That is why the source run is informational in CI. When a check fails:

1. Re-run once. The **same check failing identically** both times is real: fix it. First rule out a
   harness-side race (for example, two copies of the suite running at once), because a deterministic
   race also reproduces identically.
2. A **different check each time**, or a "not found" on something a single deliberate step (click the
   tab, wait ~2 s, inspect) shows is present, is the known timing noise.
3. **A check that only sometimes fails** usually means a live data source is still unpinned. Look for
   one before looking for a bug.

Never conclude "the suite is flaky, skip it". Resolve every failure to one of these before calling a
change done.

## Row-highlight interaction budget

```bash
node tests/perf_highlight_benchmark.js                                  # source
BF_APP_HTML=dist/index.html node tests/perf_highlight_benchmark.js      # artifact
```

Needed when a change touches row highlighting, the row components' props, or how the two big tables
render rows. Budgets are per tab (POL 8000 ms, Detail 1500 ms); CI scales them with
`BF_HIGHLIGHT_BUDGET_SCALE=1.5`. Healthy numbers are tens of milliseconds, so a failure is a design
regression, not drift.

Things this benchmark has taught, each worth knowing before touching table rendering:

- **Never pass a table-wide value through per-row props.** One boolean shared by every row
  (`anyRowHighlighted`) defeated `React.memo` for ~9,232 POL rows and froze a click for ~41 s. Rows
  get primitives that differ per row, and nothing else.
- **Measure click to painted, not click to DOM.** A `requestAnimationFrame` callback runs before
  style, layout and paint; stopping the clock there hid 2.7 s of rendering for a day. Wait the extra
  frame.
- **A first-use Tailwind class restyles the whole document.** The Play CDN compiles a class the first
  time it appears, and the new rule invalidates every element's style: ~3.2 s on the POL tab versus
  ~0.3 s for an already-compiled class. The app primes the compiler at load from its own source; do not
  delete that block, and write conditional UI's classes literally in `className` so the primer finds
  them.
- **Trace before theorising.** Two confident explanations of past slowness were wrong and died on the
  first real Chrome timeline trace.
- **POL does not aggregate.** Detail shows ~463 rows for a file; POL renders ~9,232. Never size POL
  work from Detail's numbers.

## The deployable build

```bash
node scripts/build_deployable.js          # writes dist/index.html
node scripts/build_deployable.js --check  # fails if the committed copy is stale
```

Run it after any change to the app file. `dist/index.html` is what Apps Script serves: the same app
with JSX compiled ahead of time, which cut the longest main-thread task on load from ~5.3 s to ~0.26 s.

- **Edit the source, never the artifact.** It carries a `DO NOT EDIT` banner with the source's SHA-256.
- **Test the artifact too.** Its script structure differs from the source's, so CI runs the
  regression suite and the highlight benchmark against it (`BF_APP_HTML=dist/index.html`).
- Three things in the build are load-bearing (ES5 + `"use strict"` output; the inert
  `<script type="text/babel">` block kept for the Tailwind primer; the compiled script placed last).
  Read `scripts/build_deployable.js`'s header before changing any of them.

## Serving the app: confirm you're serving your checkout

`.claude/launch.json`'s static server uses `--directory ${workspaceFolder}` so it serves the worktree
you are in. Before trusting a live measurement, confirm the page is your file:

```js
(await (await fetch(location.pathname)).text()).includes('<a string you just added>')
```

If port 8791 is taken, it is probably another session's server on another worktree. Check what it
serves (`ps -p <pid> -o command`) and use a different port rather than killing it.

## The syntax check and "which file is live"

The syntax check (AGENTS.md check 1) auto-detects the app as the highest dotted version among
`Booking_flash_report_na(_Kevin)?_<ver>_*.html` in the repo root, excluding names containing
"testing". The same rule is copied into several scripts (`check_alias_landmines.py`,
`check_date_timezone_safety.js`, `check_field_filter_gating.py`, `ci_regression_runner.js`,
`check_server_prefs_logic.js`, `perf_benchmark.js`, and the AGENTS.md snippet). Change all of them
together, and always read the printed "(auto-detected current app version: ...)" line: if it names a
file you did not touch, the check did not check your work.

Use `require('@babel/core')` directly, never `npx babel`, which silently installs an unrelated
`babel@5` that rejects modern syntax.

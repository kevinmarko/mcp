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
node scripts/run_ci_locally.js --fast         # skip the 5 browser jobs, ~10 s
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
| Field-picker filter-gating, server prefs, server extras, archive (`Code.gs`), team features (`DataFeeds.gs`/`TeamSheet.gs`), Compare KPIs, app-file resolver, shared-logic sync, shared-logic behaviour, historical-days helper, timezone safety | yes |
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
| `tests/check_resolve_app_html.js` | `resolveAppHtml()` / `pickCurrentAppHtml()` in `scripts/lib/app_file.js`, `scripts/print_app_file.js` (its stdout/stderr/exit-code contract is pinned against a throwaway directory), or anything that could add a second copy of the app-file rule (the guard scans `tests/`, `scripts/` and `.github/` recursively and is itself tested) | pass |
| `tests/check_shared_sync.js` | anything in `shared/`, `scripts/sync_shared.js`, the generated shared-logic region in the app HTML, or `apps-script/Shared.gs` (needs `npm ci` for `@babel/core`) | pass |
| `tests/check_shared_logic.js` | anything in `shared/` or `tests/shared_logic/` (the sync check above proves the copies match `shared/`; this proves each shared function does the right thing). Needs no npm packages beyond Node, so it runs without `npm ci` | pass (`SHARED_LOGIC_CHECK_PASSED (N assertions in M modules)`) |
| `tests/check_history_days.js` | the historical-CSV helper, or `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` (it pins the expected values later slices test against from that committed 9-day file) | pass |

The alias check needs a real export; the repo ships `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`.
The `.gs` checks run the real Apps Script files against simulated Google services, so they prove the
logic, not real Drive/Sheets permissions, trigger timing or sharing. Only the deployed `/exec` URL
proves those (see `apps-script/README.md`).

### Shared logic (`shared/`, `scripts/sync_shared.js`)

Logic the browser app and the Apps Script server both need lives once, in `shared/`, and is copied
(generated) into two places: a marked region inside the app HTML and `apps-script/Shared.gs`. The app
is one file with no build step and Apps Script cannot import from `shared/`, so the copies have to
exist; the sync script is what keeps them from drifting the way hand-synced duplicates do.

1. Edit the source in `shared/`.
2. Run `node scripts/sync_shared.js`. It rewrites the generated region in the app HTML and
   `apps-script/Shared.gs`.
3. Commit the `shared/` edit **and** the regenerated region and `apps-script/Shared.gs` together.
4. `node scripts/sync_shared.js --check` is the staleness check CI relies on: it fails when either copy
   no longer matches `shared/`. CI's "Shared-logic sync check" job runs `node tests/check_shared_sync.js`.
   Its sibling, the "Shared-logic behaviour check" job, runs `node tests/check_shared_logic.js` (what each
   function returns; see "Adding a function to `shared/`" below).
5. Then run the usual checks for an app change (rebuild `dist/` with `node scripts/build_deployable.js`;
   the regression suite on source and `dist/`), because the region is part of the app file.

**Adding a function to `shared/`:**

1. Write `shared/NN_name.js` (two-digit prefix, see the naming rule below). No test files in `shared/`.
2. Write the test module `tests/shared_logic/NN_name.js` for it. It exports `TESTS` (the `BFShared`
   function names it tests), `COUNT` (how many `ctx.t()` assertions `run()` makes) and `run(ctx)`, where
   `ctx = { BFShared, history, t, plain }`. Compare through `ctx.t(name, got, want)`: it compares a
   canonical JSON form with sorted keys, so objects and arrays that come out of the `vm` realm compare
   correctly (it is cross-realm safe). `ctx.history` is the committed 9-day CSV helper. The full contract
   is the header comment of `tests/check_shared_logic.js`.
3. Run `node scripts/sync_shared.js` to regenerate the copies in the app HTML and `apps-script/Shared.gs`.
4. Run the checks: `node tests/check_shared_logic.js` and `node tests/check_shared_sync.js`, then the usual
   app-change checks (rebuild `dist/`, regression suite on source and `dist/`), because the region is part of
   the app file.

`tests/check_shared_logic.js` **fails** (it does not warn) when:

- a function `BFShared` exports has no test module (the only exceptions are the names in `COVERED_ELSEWHERE` at the top of the
  runner, currently `API_VERSION`, `normalizeVvd` and `isRealVvd`, which `tests/check_shared_sync.js` already
  pins across four environments);
- a module's `COUNT` differs from the number of `ctx.t()` calls it actually made, so an assertion added
  or silently dropped is caught; change `COUNT` deliberately, in the same commit;
- a module's `TESTS` names a function `BFShared` does not export (a typo, or a function that was renamed
  or removed);
- a module cannot be loaded, throws, or does not export all three of `TESTS`, `COUNT` and `run`.

Rules:

- **Never hand-edit the generated region or `apps-script/Shared.gs`.** The next sync overwrites the
  edit, and until then the check fails. Fix `shared/` and re-sync.
- **The generated region is the only app-HTML edit allowed outside the integrator.** Everything else in
  the app file still has one writer at a time (AGENTS.md, "The app file").
- **Shared-logic PRs merge one at a time.** Two PRs that both touch `shared/` regenerate the same
  files, so they conflict on every merge.
- **On a conflict in generated files, take neither side.** Resolve `shared/` itself first (if it
  conflicts), then re-run `node scripts/sync_shared.js` and commit what it writes. A hand-merged
  generated region can look right and still not match what the script would emit.
- **Never compare `typeof` with `'object'` (or `'symbol'`) in `shared/`.** The build compiles the region with
  Babel `preset-env`, which answers those two comparisons by adding a top-level `_typeof` helper, so the
  region would define a second top-level name and `tests/check_shared_sync.js` check B fails. Comparing with
  `'string'`, `'number'`, `'boolean'`, `'function'` or `'undefined'` is fine (probed against that same
  `preset-env` configuration); for a missing value write `x == null`.
- **A test module must not define a name `shared/` exports.** `tests/check_shared_sync.js` check E scans
  `tests/` too, for `function NAME(`, `NAME = function` and `var NAME =`, because a re-inlined copy of a
  shared function is exactly what it exists to catch. Call the function through a local alias that
  delegates on the same line, for example `const diff = (a, b, o) => BFShared.diffSailings(a, b, o);`.
- **Name `shared/` files with a two-digit numeric prefix** (`00_core.js`, then `10_<topic>.js`, and so on). The files are
  concatenated in filename order, so the prefix is what makes the order explicit (a name without it is refused).
  Tests do not live in `shared/`: no `*.test.js` there (it would be shipped into the app, and the sync refuses
  it, as it does `*.spec.js`); put them in `tests/`.

Writing tests for shared logic:

- **`loadShared()` (in `scripts/lib/shared.js`) hands back objects from another `vm` realm.** An array or
  object it returns has a different `Array.prototype` / `Object.prototype` from the test's own, so compare
  primitives or `JSON.stringify` output, never `assert.deepStrictEqual` on arrays or objects (it fails on the
  prototypes even when the contents match). In `tests/shared_logic/` modules `ctx.t` does this for you.
- **Behaviour tests for shared logic that touches dates must run under more than one time zone**, for example
  `TZ=UTC` and `TZ=Pacific/Kiritimati` (UTC+14). The bare-`vm` test in `tests/check_shared_sync.js` runs in
  whatever single zone the process has, so it cannot tell a date helper that is zone-safe from one that merely
  works in that zone (the same reason `tests/check_date_timezone_safety.js` runs the app's date helpers under
  several zones). `tests/check_shared_logic.js` likewise runs in the one zone the process has, so after
  changing a date-touching shared function also run it by hand, for example
  `TZ=Pacific/Kiritimati node tests/check_shared_logic.js`.

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

### Current counts (2026-10-06): 347 checks

| Suite | Checks | Suite | Checks |
|---|---|---|---|
| Trade_Summary | 6 | Preferences_Persistence | 42 |
| Sector_Summary | 15 | Field_Visibility | 8 |
| POL_Booking_Flash | 18 | Filter_Persistence | 42 |
| Booking_Flash | 16 | Gmail_Search_Debounce | 9 |
| Analyze_BookingFlash | 26 (was 21) | Fields_Picker_ReAnchor | 6 |
| Analyze_POLBookingFlash | 20 (was 15) | OPUS_Schedule_Link | 9 |
| Trade_Summary_CommaGuard | 3 | Server_Extras_UI_Gating | 3 |
| Compare | 13 | Historical_PerDay_Archive | 12 |
| Historical_Data | 6 | Apps_Script_Team_Features | 81 (was 76) |
| | | Settings_Popover_Layout | 8 (new 2026-10-05) |
| | | Historical_Popover_Placement | 4 (new 2026-10-06) |

Suites 1-9 (left column) total 123 with both fixtures pinned. `EXPECTED_TOTAL_CHECKS` in
`tests/ci_regression_runner.js` is the source of truth; when a suite gains or loses checks, update it
there and in this table in the same commit. Re-derive counts from a real run, never from a copy.

`Settings_Popover_Layout` (Suite 19, 2026-10-05) guards the Settings popover's status lines (the storage-probe line,
Cloud sync, Data and Config Sheet) wrapping inside the popover instead of running past its right edge. It asserts on the
elements, not on the one message a run happens to show: no line is `white-space: nowrap`, none overflows its own box, none
(box or text) passes the popover's right edge, and a clone of each line holding a 339-character string with a 120-character
unbroken token still wraps onto 2+ lines inside the popover. It records exactly 8 checks whether or not the Data line
exists (Data shows once a data feed is recorded; the other three always render), and fails loudly if any of the three
always-rendered lines is missing, so it cannot pass by finding nothing. Two more (2026-10-05, review fix X13) fake a short
window height and cover the popover's height cap: it ends above the window's bottom edge, scrolls inside itself, and its
Close button is on screen and is what `elementFromPoint` returns there; then a `resize` while it is open re-fits it, both
shrinking and growing the window.

`Historical_Popover_Placement` (Suite 20, 2026-10-06) guards the Historical Data popover staying inside the window. Its
default is `right-0` under its button, so when a narrow window wraps the button to the left of the masthead row the
popover's left edge went negative (-239 px at 600 wide) and its title, mode toggle and date buttons were off-screen. The
suite runs in one window size, so it recreates the geometry: it shifts the button's own `position: relative` wrapper left
(the button and popover move together, layout is untouched) and fires a `resize` event, which is what a real resize does. Four
checks: the popover opens (Setup); in the real window it is on-screen and still right-aligned under its button; with the
button pushed to the left edge it is clamped into the window (left edge >= 16 px, close button and View-a-Date toggle
on-screen), after first asserting the shift really put the default position off the edge, so it cannot pass without
exercising the clamp; and with the button back it returns to the right-aligned position (the clamp is not sticky). Real window
sizes from 1920 down to 320 px were checked by hand, see [CHECK_HISTORY.md](CHECK_HISTORY.md).

The two Analyze suites each run the shared `checkWeeklyBarTooltips` helper (2026-10-05, 5 checks per suite) on the trend
chart's weekly-bar hover cards, with every week shown (17 bars on the pinned 8-12 fixture): a Setup check; no horizontal
overflow at rest (`scrollWidth <= clientWidth`) and no card in the page until a bar is hovered; every bar's card is named for
its week, inside the modal's visible box and the window, and still over its bar; exactly one card per hover, removed when the
pointer leaves; and the card follows its bar when the modal scrolls 24px under a stationary hover. Hovering is a dispatched
`mouseover`/`mouseout` (what React turns into `onMouseEnter`/`onMouseLeave`); a CSS `:hover` cannot be forced from inside the
page, which is why the card is JS-rendered rather than `group-hover`. These do not replace a real-mouse pass at other window
sizes, a dragged or resized modal and lane filters (the in-page run is one window size): see
[CHECK_HISTORY.md](CHECK_HISTORY.md) for what was verified by hand.

To see a check like this fail on the unfixed app, run the runner against a snapshot of the old artifact. `BF_APP_HTML`
must be repo-relative (an absolute path is rejected by design), so put the snapshot under `tests/` with an underscore name
(`.gitignore` covers `tests/_*.html`) and delete it afterwards:

```bash
git show origin/main:dist/index.html > tests/_prefix_dist_tmp.html
BF_VENDOR_CDN=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium BF_RESULT_POLL_TIMEOUT_MS=900000 \
  BF_APP_HTML=tests/_prefix_dist_tmp.html node tests/ci_regression_runner.js
rm tests/_prefix_dist_tmp.html
```

Do not run two runners at once: both write and delete the same `tests/_ci_regression_throwaway_app.html`.

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
"testing". That rule has **one implementation**, `pickCurrentAppHtml()` in `scripts/lib/app_file.js`. JS checks
`require()` it; Python checks, the AGENTS.md snippet and the `ci.yml` inline step run
`node scripts/print_app_file.js`, which prints just the file name (skipped testing builds go to stderr). Do not paste
the regex anywhere else: `tests/check_resolve_app_html.js` fails if a new hand-copied version appears in `tests/`,
`scripts/` or `.github/`. If two non-testing files tie for the highest version (`2.0` and `2.0.0` tie), the resolver
exits 1 or throws and names both files; it never guesses. Rename or move one. Always read the printed
"(auto-detected current app version: ...)" line: if it names a file you did not touch, the check did not check your
work.

Use `require('@babel/core')` directly, never `npx babel`, which silently installs an unrelated
`babel@5` that rejects modern syntax.

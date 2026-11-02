# Testing guide

How to run each check, what it needs, and what a correct result looks like. [AGENTS.md](../AGENTS.md)
says *which* checks a change needs; this file says *how* to run them. The story behind each rule
(the bug that caused it, the dated counts) is in [CHECK_HISTORY.md](CHECK_HISTORY.md).

## One command: `scripts/run_ci_locally.js`

**This is the gate, and the only one: the repo does not use GitHub Actions (Kevin, 2026-10-14, D59).** It runs every check in its `jobs` array, in order, and prints one
pass/fail table. Exit code 0 means every blocking job passed. Run it in full on the tree that will land (your branch with `main` merged in, committed and pushed); its
`jobs` array is the single source of truth for what is checked, so a new check goes there and into the tables below, and nowhere else. See AGENTS.md.

The receipt: add `--post-status` and, after a full pass on a clean tree whose HEAD contains `origin/main`, it posts the free GitHub commit status `local-gate` = success on
the pushed head (a failing run posts `failure`). That green check on the PR is what the merge button is waiting for, by agreement (D59). It needs `gh` logged in and a pushed
HEAD, never changes the exit code, and says `RECEIPT NOT POSTED: <why>` rather than post something untrue. (The real POST is unconfirmed until a run on a machine where `gh` can write
commit statuses has been seen on a PR; the cloud sandbox's proxy refuses it with 403. D59, "UNCONFIRMED".) The rules are in `scripts/lib/gate_status.js`, pinned by
`tests/check_gate_status.js`.

```bash
npm ci                              # first time, and after package.json changes
npx playwright install chromium     # first time only
python3 -m pip install openpyxl     # first time only
node scripts/run_ci_locally.js                # everything, about 6 min on an M4 laptop (2026-10-30; 27.7 min before D80's sharding and background jobs, see "Speed" below)
node scripts/run_ci_locally.js --fast         # skip the 7 browser jobs, about 1 min (a receipt is allowed only for a Markdown-only change)
node scripts/run_ci_locally.js --post-status   # as the first line, then leave the `local-gate` receipt on the pushed HEAD
node scripts/run_ci_locally.js --ci-budgets   # highlight budgets scaled 1.5x, as the old hosted runners needed
node scripts/run_ci_locally.js --with-source  # also the duplicate "source" jobs the default skips (D81): the source regression run and the source halves of both budgets
node scripts/run_ci_locally.js --serial       # the pre-D80 order: every job one after another, the suite in one page per run (triage only)
```

### Speed: background jobs and shards (D80, 2026-10-30)

The gate used to run every job one after another, and each regression run drove all 48 suites through one page, so a full run was
about 28 minutes (27:39 on an M4 MacBook, 2026-10-30), of which the two regression runs were 745 s and 742 s. Two changes, neither of which
changes what is checked (861 / 861 on both runs, the same pin):

- **Background jobs.** The jobs marked `background` in the `jobs` array (both regression runs and the basic-build check) start first and
  run while the headless jobs run in the foreground; each writes its own log, printed whole under its usual banner when it finishes. The
  jobs marked `alone` (the row-highlight and column-reorder budgets) run last, after everything else has finished, so nothing competes
  with them for the CPU. The source and `dist/` runs side by side is what Kevin chose for the old CI in D51.
- **Shards.** `tests/ci_regression_runner.js` runs the suites in three shards, each in its own browser with its own clean storage and
  its own upload of the sample file, and merges the results against the one `EXPECTED_EXECUTED_CHECKS`. The suite file is not changed
  and still runs every suite in one page when pasted into a console: the runner adds, on each suite's opening line, an early return for
  the suites outside the shard it is building. `SHARD_TABLE` in the runner names the suites of the first two shards (Column_Picker
  alone; Column_Order, Quick_Filter_Shown, Offline_Cache, Column_Filters); every other suite, a new one included, runs in the last.
  A name there that the suite file no longer has stops the run. Log lines from a shard are tagged `{n/3}`, and the runner prints
  each shard's time, each suite's time and the 15 slowest single checks after the counts (`BF_SUITE_TIMES_JSON=<file>` writes
  every check's time). `BF_REGRESSION_SHARDS=1` runs one page as before.
- **Measured before D81 (M4, 10 cores, 16 GB, 2026-10-30, the same tree):** `--serial` 27:39; default 5:59 (each regression run 280-289 s in three shards of about 232-284 s; the four budgets 71 s at the end). One `dist/` run alone (2026-10-29, the tree before #266): 12:42 (762 s)
  in one page, 4:45 in three shards with another gate running on the machine at the time.
- **The default gate skips the duplicate "source" jobs (D81 items 1 and 2, Kevin, 2026-10-30: "Only run the duplicate source code tests only when it's asked for").**
  The source regression run (the same 861 checks as the `dist/` run, about 745 s of browser time, informational) and the source halves of the
  row-highlight and column-reorder budgets (about 11 s + 30 s) run only with `--with-source`; the summary lists them as `skipped (source job; pass --with-source)`.
  The `dist/` regression run (861-check pin) and both `dist/` budgets still run and still block. `--with-source` is the way to exercise
  babel-standalone in the browser, so use it when a change touches how the page compiles its script, or to triage a `dist/`-only failure
  (does the source build fail too?). `--serial` and `BF_REGRESSION_SHARDS` work with and without it. `land.js` counts the skipped jobs in `Landed-Gate-Jobs`.
- **If a check fails only when sharded,** run it with `BF_REGRESSION_SHARDS=1` (or the gate with `--serial`). Passing there means the
  check leans on state an earlier suite left behind in the shared page, which is a bug in that check: fix the check, do not move suites
  between shards to hide it. Otherwise triage as in "Flaky or real?".

In a sandbox that can't reach the CDNs or has a different Chromium build:

```bash
BF_VENDOR_CDN=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/run_ci_locally.js
```

- `BF_VENDOR_CDN=1` loads React, Babel, Tailwind and SheetJS from `tests/vendor/` instead of the CDNs.
  It does that by writing a rewritten copy of the app to a throwaway file named per run,
  `tests/_ci_regression_throwaway_app_<app file stem>_<pid>.html` (`perf_highlight_benchmark.js` uses
  `tests/_perf_highlight_throwaway_app_<pid>.html`). Until 2026-10-06 it was ONE fixed path, and two runners
  started at once overwrote each other's copy and both tested whichever build was written last (a new-build
  run and an old-build control run in parallel both measured the old build, to the hundredth of a pixel).
  Runners no longer clobber each other's files; they still compete for CPU, which the timing budgets (the
  row-highlight and column-reorder benchmarks) feel, so the gate runs those last and alone (D80, "Speed" above).
- `PW_CHROMIUM_PATH` points Playwright at a pre-installed Chromium (symptom without it:
  `Executable doesn't exist at .../chromium_headless_shell-NNNN`).

| Job | Blocking? |
|---|---|
| Syntax check (source) | yes |
| Deployable build up to date, plus a syntax check of the compiled payload | yes |
| Alias-landmine check (needs `openpyxl`) | yes |
| Field-picker filter-gating, server prefs, server extras, archive (`Code.gs`), team features (`DataFeeds.gs`/`TeamSheet.gs`), Compare KPIs, Sector Allocation placeholder, app-file resolver, shared-logic sync, shared-logic behaviour, historical-days helper, shared-view injection (`Code.gs` `doGet`), timezone safety | yes |
| Landing script (`land.js`) check, the headless `tests/check_land_script.js` (job name `Landing script (land.js) check`) | yes |
| PR function-overlap check, the headless `tests/check_pr_overlap.js` (job name `PR function-overlap check`) | yes |
| Docs-only skip rule check, the headless `tests/check_docs_only.js` (job name `Docs-only skip rule check`) | yes |
| Gate receipt logic check, the headless `tests/check_gate_status.js` (job name `Gate receipt (local-gate status) logic check`) | yes |
| Live regression suite, source (job name `Live regression suite -- source (informational)`) | no (informational; see "Flaky or real?") |
| Live regression suite, `dist/index.html` (job name `Live regression suite -- dist/index.html`) | yes |
| Row-highlight budget, source and `dist/index.html` | yes |

**Docs-only changes (D22, D51, D59).** If every file a change touches is a Markdown (`.md`) file (`scripts/lib/docs_only.js`; the CLI is `scripts/ci_docs_only.js`), the three browser jobs
(the live regression suite in both halves, the basic-build check and the row-highlight budget) cannot be affected by it, so `--fast` is enough, and `--fast --post-status` is allowed to post the
receipt (its text says "docs-only, --fast"). Any other file in the change, an empty change, or any git error makes `--fast` ineligible for a receipt and the full run is required. The headless checks run
in both modes, so a docs change that breaks one of them (the shared-sync, land-script and app-file-resolver checks read docs) is still caught. Until D59 a hosted workflow ran the source and `dist/`
regression runs at the same time; since D80 the gate does too, in the background, and runs only the two timing budgets alone.

## Headless checks

Each is a standalone script with no browser. Run them directly when you only touched their area.

| Script | Run after changing | Result |
|---|---|---|
| `tests/check_alias_landmines.py <export.xlsx or .csv>` | any `getVal([...])` call | `✅ No landmines found` |
| `tests/check_date_timezone_safety.js` | any `XLSX.read(...)` call, or how a CSV/xlsx is parsed | `✅ PASS` |
| `tests/check_csv_fast_path.js [app.html]` | `csvTextToSheetRows` (the app's fast CSV reader, 2026-10-27 perf) or `parseCsvTextToRows`, its caller. Lifts the real function out of the app file and compares it with the `xlsx` dev dependency (the same SheetJS 0.20.3 the app loads): every CSV in the repo must read identically (the real exports must take the fast path, the two-header sector Sheet must decline), 30 hand-written edge cases (15 it must answer the same as SheetJS, 15 shapes it must hand to SheetJS: BOM, `sep=`, a tab / `;` / `\|` in the first 1,024 characters, blank / repeated / padded headers, stray quotes and so on), and 20,000 generated files where every answer must equal SheetJS. Needs `npm ci`. Proven red against a removed delimiter guard and a reader that always declines | `CSV_FAST_PATH_PASSED (45 passed, 0 failed)` (43 before 2026-10-30, when the synthetic `tests/fixtures/ep_export_sample.csv` was added to the every-CSV list, D84 slice 2a-4) |
| `tests/check_sector_layout.js [app.html]` | `readSectorSheet` (the block between the `BEGIN` / `END SECTOR SHEET READER` marker lines in the app file), or anything about how the sector Google Sheet is read (D37). Cuts the reader out of the app file and runs it on the real two-header Sheet and the old one-header Sheet (same rows as the old reader), then on hand-built grids: merged and repeated labels, a title row, reordered columns, blank lines, exact-half rounding, the allocation columns, and every layout it must refuse with a sentence (renamed headings, a missing label). CI runs it on the main file | `✅ PASS` (42 checks on the main file, measured 2026-10-11 after the promotion; before it, 34 on the 2.0 main file and 36 on the 2.5 build, which also checks `blocks`) |
| `tests/check_vvd_finder_logic.js [app.html]` | The pure half of Settings > "Find a vessel" (D63): the block between the `BEGIN` / `END VVD FINDER` marker lines in the app file (matching and near matches, the Max Laden columns read by exact header and the way the report reads them (first non-blank; a 0 stops it) with a drift guard against `FIELD_ALIASES` and a second one that holds the browser suite's own copy of the Max Laden column list (`MAX_LADEN_COLUMNS`) to it, the Max Laden verdict, "is the Sheet ahead", the headline matrix and its wording, the sector line count, the hidden-by list, and the Historical archive pieces: the quote-aware record splitter, the prefilter on the real archive fixture and on a synthetic 16 MB text with a time limit, the archive summary line, the per-day timeout). Cuts the block out of the app file and runs it on the real live and sector fixtures: all 374 real voyages get a Max Laden verdict (360 filled, 6 partial, 8 blank, 3 of the 8 on the ad-hoc EXE / EXW lanes), counted separately in Python. | 93/93 (2026-11-02) |
| `tests/check_masthead_doodle.js [app.html]` | The masthead doodle's scenes and schedule (D69 and the seasonal scenes): the block between the `BEGIN` / `END MASTHEAD DOODLE` marker lines in the app file (`BFD_SCHEDULE`, `bfdSceneKeyFor`, `BFD_SCENES`, `bfdSceneFn`, `bfdImageUrl`, `bfdMastheadScene`, `bfdMastheadStyle` and the helpers they use). Each scene's drawing code is NOT in that region: it is an inert `<script type="text/x-bfd-scene" id="bfd-scene-<key>">` block ahead of the app script, run only for the scene showing. Cuts the region out and evaluates it in a `vm` sandbox (ONE_MAGENTA stubbed, a stub `window.location` for the `?headerScene=<key>` override, a pinned `Date`, and a stub `document` that serves the three blocks' text from the page, spies on `getElementById`, and runs an appended script's text in the same context like a browser, an exception staying inside the runner). Asserts the date table (Oct 31 Halloween, Nov 1-3 Muertos, Nov 4-30 Autumn, everything else Halloween, in any year, reading only `getMonth()` / `getDate()`) against an independent oracle for every day of 2026 and of the leap year 2028; the override (known key honoured, unknown ignored); and for each of the 3 scenes x light/dark that the data URI is safe in a CSS `url("...")`, well-formed XML (a pure-JS tag-balance parse, no `xmllint`), has no `<text` / `<image` / `<script` / `<foreignObject` / external reference, has unique ids that all resolve and are all used, no dead keyframes, stays under a byte budget, is cached, and that the scenes differ. Also asserts the lazy loading: a fresh page asked for one scene (or for `bfdMastheadStyle` on a Halloween / Muertos / Autumn date, or with `?headerScene=`) runs only that block, looks up only its id, never hands the other blocks' text to the script runner, runs it once per scene across both themes; a missing block, a block that throws and a block that registers nothing give `'none'` (cached, no throw) and `bfdMastheadStyle` still returns the sky gradient; and the page's structure: exactly three `text/x-bfd-scene` blocks with those ids, ahead of the `text/babel` script, none containing `</script`, `<script` or `<!--`, each parsing, each adding only its own key to `window.__bfdScenes` and no other global when run alone, each returning a string starting `<` for light and dark from stub helpers, and no scene drawing code (`function bfdSceneMuertos`, `bfdSceneAutumn`, `bfdBat`, `bfdMButterfly`, `bfdALeaf`, `scene: bfdScene...`) in the app's own text/babel script. Also asserts the D83 idle still image (+105): for each scene x light/dark, `bfdImageUrl(dark, key, true)` is a CSS-safe data URI, well-formed XML with the same root, has no `<style`, class attribute, `@keyframes`, `animation` / `animation-name` declaration or SMIL element, keeps unique resolving used ids, is smaller than the animated image, is cached apart from it (in either order, the scene's block run once), draws the same number of `<path` / `<circle` / `<rect` / `<g` / `<polygon` / `<ellipse` / `<line` as the animated image and is exactly the animated SVG minus its `<style>` and class attributes, and gives `'none'` (cached) when the block is missing, throws or registers nothing; `bfdWatchIdle(el, dark, idleMs)` is driven with a fake clock and stub `setTimeout` / `Date.now` / window and document listeners / `document.hidden` / `IntersectionObserver` / `matchMedia` / element, and asserts: still at exactly `idleMs` with `--bfd-img-still` equal to the still image of today's scene and theme and no timer left, the six input events registered on window with `capture` and `passive` and each waking it at once and re-arming, the once-a-second throttle (two pointermoves 100 ms apart re-arm once, a later event pushes the deadline back and the superseded timer never fires), a hidden tab and an off-screen masthead each making it still at once and input not waking it while either holds, the cleanup (every listener removed with the same handler and capture flag, timer cleared, observer disconnected, class and property removed, nothing happens afterwards, a new watcher for the other theme starts clean), reduced motion, a null or undefined element, no `IntersectionObserver`, no `matchMedia`, and the still image built once; and, from the HTML, the `.bfd-masthead.bfd-still` rule inside the `@media (min-width: 1500px)` block only, using `var(--bfd-img-still, var(--bfd-img))` and keeping the `var(--bfd-sky)` layer, the `useEffect(..., [darkMode])` that returns `bfdWatchIdle(mastheadRef.current, darkMode, BFD_IDLE_MS)`, `mastheadRef` on the `bfd-masthead` element, and `BFD_IDLE_MS` between 15000 and 300000. The live regression suite only sees the wiring (its window is narrower than the 1500px the doodle needs) and is date-independent on purpose | `✅ PASS` (239 checks: 85 before the scenes moved into inert blocks, +49 for the lazy-loading, failure and page-structure assertions, +105 for D83: 1 names, 66 still variant, 6 still variant failure, 24 `bfdWatchIdle`, 8 page wiring) |
| `tests/check_field_filter_gating.py` | the Fields picker or slicer gating | pass |
| `tests/check_server_prefs_logic.js` | server-backed preferences, `resolveUserPref` | pass |
| `tests/check_server_extras_logic.js` | filter-prefs sync, Export to Drive, `__SERVER_EXTRAS__`, the per-visitor store and its migration, the owner-only admin claim, `getAppVersionHash` | 40/40 (35/35 before the one-read-per-page-load and probe-leftover checks, 2026-10-07; 13/13 before the 2026-10-06 follow-ups) |
| `tests/check_archive_logic.js` | the per-day archive in `Code.gs` | 49/49 (47/47 before the owner-only admin claim, 2026-10-06; 46/46 before the at-least-one-day budget check, 2026-10-06) |
| `tests/check_team_features_logic.js` | `DataFeeds.gs`, `TeamSheet.gs` (VVD notes, the `source` column, `getVvdNotesFor`), `doGet`, the app's `SERVER CONFIG RESOLUTION`, `NOTES SLICER FILTER` and `NOTES ORGANIZE` blocks (the notes-dialog list helpers: hashtag search and the tag-bar chips, `buildNoteTagChips`, included), and the `VPT LINK` block (D84 slice 1-C: the `vptWebAppUrl` Config Sheet key, `resolveVptWebAppUrl`, `buildVptLink`, `linkVvdValue`) | 601/601 (594/594 before D84 slice 1-C, 2026-10-30: +7, the `vptWebAppUrl` key passes through the server as raw text and is never an unknown key, and the app's VPT link rules; 586/586 before the review fixes to the private-notes file, 2026-10-28, D68: row re-check, apostrophe notes, a failed move remembered, old notes shown while it is pending, no orphan file, header check on the fallback tab; 565/565 before the private-notes contract revision, 2026-10-27, D68: user lock around the private save, search after every write, one row per VVD, any failing get searches again, a Drive v2 refusal; 511/511 before the private-notes file, 2026-10-27, D68: 54 new checks, the user-property private-note checks rewritten for the file; 457/457 before the notes `source` column and `getVvdNotesFor`, 2026-10-26: 54 new checks, one expectation changed on purpose, `saveVvdNote.length` 3 to 4; 444/444 before the per-visitor prefs store and owner-only admin checks, 2026-10-06; 434/434 before the notes-cache race, flush-before-unlock and no-silent-re-create checks, 2026-10-06; 413/413 before the `changedAt` / `changedDate` / `refreshIntervalMsAtFetch` checks; 337/337 before the `fetchedDate` / `refreshIntervalMs` reply-stamp checks, 2026-10-05; 311/311 on 2026-10-02) |
| `tests/check_feed_snapshot_logic.js` | the shared Booking Flash snapshot in `DataFeeds.gs` (`publishFeedSnapshot_`, `publishFeedSnapshotNow`): off = no Drive call, first run creates the file, same copy = no write, new copy = one update with content and the five `bf*` properties, same content = properties-only update (no upload), trashed file restored and moved file kept (same id), a lost file found again by name before a new one is made, a lock around get-or-create, the `bfrSnapshotStatus` record, Drive v2 refused before any work, Drive errors never throw, never called from the visitor paths, hash = MD5 of the unzipped content | new (2026-10-29) |
| `tests/check_ep_export_logic.js` | Empty Planning's `EP_EXPORT` read in `DataFeeds.gs` (D84 slice 2a-4, ADR-R2: `parseEpExportCsv_`, `epExportCsvUrl_`, `refreshEpExport_`, `readEpExport_`, `withEpExport_`, `refreshEpExportNow`, the `getDataFeed` wrapper): with `bfrEpExportUrl` unset every `getDataFeed` reply equals `getDataFeedMain_`'s (keys, order, values) and the trigger makes no fetch and writes nothing; the synthetic fixture `tests/fixtures/ep_export_sample.csv` (quoted comma, newline and quotes, blanks as null, TEU as numbers); any column order, header case, CRLF, BOM and extra columns; a missing column rejected by name; rows without a VVD skipped; only `https://docs.google.com/spreadsheets/d/<id>` URLs, rebuilt from id and gid, the admin token sent only to an editor URL; fetch errors and HTML pages logged and never breaking the main reply; the cache (chunked, `haveEp` = unchanged, last good rows kept with an error, gone after 3 hours of failures, a 5,000-row cap); quiet-hours skip; admin-only `refreshEpExportNow`; the visitor paths never fetch; review fixes: a visitor's `google.script.run.refreshDataFeeds(...)` (no event, a forged `triggerUid`, any argument) never fetches, reads no token and writes no EP key while the other feeds still refresh, only the trigger's own event fetches, under `LockService` with a skip when held, and a network error naming the URL shows only `fetch failed` (no `http`, sheet id or publish key) | 25/25 (21/21 before the review fixes, 2026-10-30; proven red with the trigger check and the error code removed) |
| `tests/check_decisions_logic.js` | the decision store in `TeamSheet.gs` (D84 slice 2a-3, ADR-R1): `saveDecision`, `getDecisionsFor`, `saveThresholdChange`, `getThresholdLog`, `setupDecisionTabs`. Runs the real `Shared.gs` and `TeamSheet.gs` (plus `activeUserEmail_` / `assertArchiveAdmin_` cut from `Code.gs`) in a `vm` with fake Sheets, lock and session: append-only rows, server-set id / author / createdAt, `sheetText_` on every cell, supersedes must name a row of the same key, `busy`, fixed error codes with no exception text, the tabs created by the first save (never by a read), the 200-VVD cap, the threshold log and `since`, admin-only setup that never claims the role | 35/35 (32 before slice 2b-2 added 3: `rollTo` and `seen` stored and read back, refused with their codes, a formula-like reason beside them; 24/24 when new on 2026-10-31; +8 the same day for the B7 review: changed-value, stale-supersedes for decisions and thresholds, Object.prototype-named rows, impossible since, kind filters, the setup lock, a canonical port key) |
| `tests/check_threshold_approvals.js` | who may decide a threshold proposal in `TeamSheet.gs` (D84 slice 2b-3, R-5, Q3): `decideThresholdProposal`, `getThresholdApproverRights`, `getThresholdProposals`, `setupThresholdApprovers`, the lane read from the live feed (`vvdLanesFromCsv_`, `thresholdLaneOf_`). Runs the real `Shared.gs`, `DataFeeds.gs` and `TeamSheet.gs` (plus the admin check cut from `Code.gs`) in a `vm` with a fake team Sheet, Config Sheet and feed cache; the feed is the 9-day CSV's 2026-09-01 rows, and one check runs `parseCsvRecords_` over the whole 9-day file (all 368 real VVDs of that day resolve to their one lane). Fail closed with no approver tab, signed checks verified on read, the lane lead and the admin, own-proposal, not-approver, lane-unknown (no feed, unknown VVD, two lanes, a client-sent lane ignored), the 2a-3 compare-and-swap, fixed codes with no exception text, the unchanged `saveThresholdChange` path shown as unchecked, admin-only setup | 38/38 (27 new 2026-10-31; 12 mutations of the new server and shared code, 11 killed here, the 12th by `tests/shared_logic/67_threshold_proposals.js`; +11 the same day for the security review: HMAC-signed checks (a forged row, a tampered `to` or status, a missing key all read as unchecked; the key never in a reply; made only by a decision), laundering (a re-proposer of the same value cannot approve), no revival of a checked rejection (`proposal-rejected`), a forged rejection does not block; 8 more mutations, all killed) |
| `tests/check_color_contrast.js [app.html]` | slicer colours (`SLICER_TONES`, `AP_STATUS_CONFIG`, a `<SlicerBtn>` call site), or any class string that sets a fill and a text colour (`bg-*` with `text-*`). It holds them to 4.5:1 (WCAG AA): every slicer tone solid and faded in both themes on the slicer panel, the grey `SLICER_INVALID` chip, plus every fill/text pair in the app source; disabled styling (`cursor-not-allowed`) is exempt, and three pre-existing pairs Kevin chose to keep are listed in its `KNOWN_EXCEPTIONS` (D29). Needs `npm ci`. The live `Slicer_Contrast` suite measures the rendered chips | `✅ 379/379` on the main file (measured 2026-10-11 after the promotion; on 2026-10-08 it was 340/340 on the 2.0 main file and 357/357 on the 2.5 build, 337/354 before the grey invalid-chip check) |
| `tests/check_compare_kpis.js` | the app's "shared capacity helpers" block or the Compare tab | pass |
| `tests/check_review_followups.js` | `getPeakUtilPercentNum` / `normalizePeakUtilScale`, `usePruneStaleSelection`, `useFieldVisibilityPref`, the row builder's `trade:` line, or `HoverTooltipLayer` and its two callbacks (D79). Cuts the real declarations out of the app file by parsing it and runs the hooks under a tiny fake React; 19 assertions: a fraction file reads 6.0 as 600% and a percent-scale file reads 3 as 3%, the real 9-day archive reads every non-blank peak value exactly as before, pruning pauses while a historical date is viewed and resumes on live data, a preference is written only after the user changes it, a blank Trade stays blank, and the tooltip's state lives outside the dashboard. Proven red with each fix's key line removed (8 of 19 fail) | 19/19 |
| `tests/check_sector_alloc_placeholder.js` | `markMissingSectorAllocation`, `secAllocShownText` or the Sector Allocation / Sector Remarks cell (D56, the "No sector allocation" placeholder). Cuts the real functions out of the app file by parsing it; 32 assertions: the rule's edge cases, the 2026-10-14 EMA `CMDT0002E` case, and the 8-12 fixture against an independent reading of its raw columns (6 voyages / 15 legs) | 32/32 |
| `tests/check_macro_grid_order.js` | `MACRO_GRID_ORDER` / `MACRO_GRID_COMMON_ORDER`, `MACRO_GRID_EXCLUDED_KEYS`, or a `FIELD_TOGGLES` descriptor's `tabs` (D58, one macro-button order on both Booking Flash tabs). Reads those out of the app file by parsing it; 9 assertions: Booking Flash and POL Booking Flash each show Kevin's PROPOSED grid (POL adds VCO Analyst and ETA as its last row), every key a tab's grid shows is placed in that tab's order (an unplaced one would land at the end of one tab only), no duplicates, AP Frozen / AP Only stay out of the order. Proven red against POL's old order and against an unplaced `eta` | 9/9 |
| `tests/check_column_picker_logic.js` | The Fields picker's per-column list (D60, D61, D62): `COLUMN_REGISTRY_ROWS`, `FIELD_TOGGLES`' groups, the picker click logic, the saved `bookingFlashHiddenColumns` blob, `getFreezeLayout` / `FREEZE_COLUMNS` / `buildSpacerPieces`, or a filter-cell call site in either table. Cuts the region between the `BEGIN COLUMN PICKER LOGIC` and `END COLUMN PICKER LOGIC` marker lines out of the app file and runs it headless; 88 assertions: the registry equals each tab's literal `renderFilter` / `filterCell` call sites in order and every key is gated at its filter, label and body cell (so a column added to one list and not the other fails), counts are 22 / 48 on Booking Flash and 26 / 51 on POL with 8 / 10 "hidden" by default, the blob sanitiser, picker rows and clicks (a group switches off when its last column on the tab is hidden), the freeze layout (Lane, Sales Week, the two dates, VVD, Vessel Name at 0/75/155/235/315/410; Trade and Sub Trade not pinned) and the frozen spacer pieces, and a tab with no registry. D62 (columns hidden per tab): the click logic runs on `{ detail, pol_booking }` sets, a group switches off only when its last column on every tab is hidden, the v1 and v2 saved blobs, the Report Card's `columnShownByKey`, and a property check that no picker click on one tab changes the columns the other tab shows (400+ clicks, both tabs, every column and group row, four starting states). Proven red against a removed gate, a drifted registry, the old group-off rule, a group turned on without hiding the other tab's columns, and a group-off test that looks at one tab only | 88/88 |
| `tests/check_column_order_logic.js` | The drag-to-reorder column logic of Booking Flash and POL Booking Flash (D67): the block between the `BEGIN` / `END COLUMN PICKER LOGIC` marker lines in the app file (the same region the picker check above reads): `COLUMN_UNITS` / `DEFAULT_COLUMN_ORDER`, `sanitizeColumnOrder`, `serializeColumnOrder`, `columnOrderIsDefault`, `unitKeyOfColumn`, `moveColumnUnit`, `effectiveColumnOrder`, `columnRank` and the saved `bookingFlashColumnOrder` blob. Cuts the real region out of the app file and runs it headless; 129 assertions: the unit tables cover every non-lead column of `COLUMN_LIST` once, in order, with Inland and Port as three-column blocks (a column added to the registry and not to the units fails); garbage, duplicates, unknown and block-internal keys, and a column missing from a saved list are repaired to a complete permutation, the default coming back as the frozen default array itself; the two tabs stay independent; drops (before / after, the ends, the no-op cases returning the same array, blocks staying contiguous, back to default returning the default array, no input mutated); Freeze Panes forcing the default; the rank map (lead columns 0-2, cached per order array). Ends with a tripwire on the executed-assertion count (`EXPECTED_ASSERTIONS` in the file). Does not prove a drag works in a browser: the live `Column_Order` suite does. | `COLUMN_ORDER_LOGIC_PASSED (129 assertions)` |
| `tests/check_pol_only_call_logic.js` | The "POL-only call" rule of Booking Flash (D68): the block between the `BEGIN` / `END POL-ONLY CALL LOGIC` marker lines in the app file (`POL_ONLY_FOREIGN_DIRECTION`, `isPolOnlyForeignCall`). Cuts the real region out of the app file and runs it headless; 22 assertions: AL5's westbound voyage (VVD ending `W`) is hidden, trimmed and case-folded; AL5's own `E` voyages, the `VMS` placeholder, blank and one-letter VVDs, every other lane (W lanes like EC1 and PS4, and FLX which sails both ways) and a null row are kept; `buildTableData` applies the rule before it combines legs and before its VMS rule; POL Booking Flash never uses it. Ends with a tripwire on the executed-assertion count (`EXPECTED_ASSERTIONS` in the file). Does not prove the table renders without the voyage in a browser. | `POL_ONLY_CALL_LOGIC_PASSED (22 assertions)` |
| `tests/check_basic_build.js` | `dist/basic/index.html`, `apps-script/basic/Code.gs`, `scripts/build_deployable.js`'s second artifact, or anything that makes the app call an Apps Script service. A static part (no forbidden service in `Code.gs`; the flag script first in the basic build's `<head>` and absent from the full build) and a browser part (Chromium with every Apps Script fake: the basic build makes zero `google.script.run` calls and ignores the server-injected state; the full build still uses it; both boot-failure paths, and the network-failure box's wording: NA IT Ops, Reset Network, restart; D49). Needs a browser, so `--fast` skips it | pass |
| `tests/check_resolve_app_html.js` | `resolveAppHtml()` / `pickCurrentAppHtml()` in `scripts/lib/app_file.js`, `scripts/print_app_file.js` (its stdout/stderr/exit-code contract is pinned against a throwaway directory), or anything that could add a second copy of the app-file rule (the guard scans `tests/`, `scripts/` and `.github/` recursively and is itself tested) | pass |
| `tests/check_shared_sync.js` | anything in `shared/`, `scripts/sync_shared.js`, the generated shared-logic region in the app HTML, or `apps-script/Shared.gs` (needs `npm ci` for `@babel/core`) | pass |
| `tests/check_shared_logic.js` | anything in `shared/` (since D82, 2026-10-30, also `summarizeChanges` / `formatChangeDate`, `tests/shared_logic/50_what_changed.js`, 28 assertions; since D84 slice 2a-3, 2026-10-31, also the decision store's record rules, `tests/shared_logic/65_decisions.js`, 49 assertions (30, then +10 for the B7 review and +4 for its re-review the same day, +5 for slice 2b-2's optional `rollTo` and `seen`); since D84 slice 2b-2, 2026-10-31, also the decision card's figures, `decisionCeiling` / `matchDeskDeclaration` / `declarationAge`, `tests/shared_logic/75_decision_card.js`, 11 assertions; since D84 slice 2b-3, 2026-10-31, also threshold proposals, `parseThresholdApprovers` / `thresholdApproverLanes` / `thresholdProposerOf` / `thresholdApprovalCheck` / `thresholdProposals` / `thresholdProposalChip` and the threshold payload's optional `check`, `tests/shared_logic/67_threshold_proposals.js`, 24 assertions (20, +4 for the security review: `sig`, `thresholdProposersOf`, `proposers` and `targetRejected`); 706 assertions in 12 modules on 2026-10-31) or `tests/shared_logic/` (the sync check above proves the copies match `shared/`; this proves each shared function does the right thing). Needs no npm packages beyond Node, so it runs without `npm ci` | pass (`SHARED_LOGIC_CHECK_PASSED (N assertions in M modules)`) |
| `tests/check_history_days.js` | the historical-CSV helper, or `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` (it pins the expected values later slices test against from that committed 9-day file) | pass |
| `tests/check_shared_view_injection.js` | `injectSharedView_` / `sharedViewParam_` or `doGet`'s call to them in `apps-script/Code.gs` (the `?view=` link handed to the page as `window.__SHARED_VIEW__`, roadmap 4.2). Runs the real `Code.gs` and `Shared.gs` in a `vm`; reads the served page back with an independent HTML script tokenizer. Proves the injection and its escaping against fakes; whether Google delivers `?view=` to `doGet` is a production question (`apps-script/README.md`) | pass (`SHARED_VIEW_INJECTION_PASSED (181 assertions)`) |
| `tests/check_land_script.js` | `scripts/land.js`, `scripts/lib/landing.js`, or the stamp format (it runs the script against throwaway git repositories under the OS temp directory, with a bare repository as the "remote"; needs only Node and git, no browser, no network) | `LAND_SCRIPT_CHECK_PASSED (383 assertions)` |
| `tests/check_pr_overlap.js` | `scripts/check_pr_overlap.js` or `scripts/lib/pr_overlap.js` (throwaway git repositories again: same-function overlap is flagged, different functions in the same file are not, a branch inserting 200 lines above does not hide an overlap, the generated shared region and non-code files are ignored; needs only Node and git) | `PR_OVERLAP_CHECK_PASSED (166 assertions)` |
| `tests/check_gate_status.js` | `scripts/lib/gate_status.js` or the `--post-status` block of `scripts/run_ci_locally.js` (when the gate may post the `local-gate` receipt: a dirty tree, a branch behind `main`, an unreachable `main`, `--fast` on code and a real failure each have a case; the repo name parsed from https, ssh and sandbox-proxy remotes; the exact `gh` arguments; needs only Node) | `GATE_STATUS_CHECK_PASSED (25 assertions)` |
| `tests/check_docs_only.js` | `scripts/ci_docs_only.js` or `scripts/lib/docs_only.js` (the rule that lets the gate accept `--fast` for a change that touches only Markdown files; throwaway git repositories again: Markdown-only is docs-only, any other file, a rename of code to `.md`, an empty change, a push or a git error is not; needs only Node and git) | `DOCS_ONLY_CHECK_PASSED (34 assertions)` |

The alias check needs a real export; the repo ships `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`.
The `.gs` checks run the real Apps Script files against simulated Google services, so they prove the
logic, not real Drive/Sheets permissions, trigger timing or sharing. Only the deployed `/exec` URL
proves those (see `apps-script/README.md`).

### Shared logic (`shared/`, `scripts/sync_shared.js`)

Logic the browser app and the Apps Script server both need lives once, in `shared/`, and is copied
(generated) into two places: a marked region inside the app HTML and `apps-script/Shared.gs`. The app
is one file with no build step and Apps Script cannot import from `shared/`, so the copies have to
exist; the sync script is what keeps them from drifting the way hand-synced duplicates do.

**The generated copies carry no comments** (review finding 10): `shared/` is the commented, readable source, and
`scripts/sync_shared.js` strips every comment with `@babel/core` (a parser, not a regex; `comments: false`, no
presets or plugins) before writing the app HTML regions, `dist/` (via the app file) and `apps-script/Shared.gs`.
The regions and Shared.gs are about half the size, so Babel Standalone transforms less on every load of the source
file and Apps Script parses less on every execution. Each generated region starts with one `//` note line and
Shared.gs keeps its header; there are no other comments in them. Consequence: `scripts/lib/shared.js` needs
`@babel/core`, so anything that runs the sync or `check_shared_sync.js` (the gate does) needs deps installed (`npm ci`).

A third kind of output exists since 2026-10-05: **any other app build in the repo root that carries the
marker lines**, such as a testing build that the current-app resolver deliberately skips. Today there is none: the 2.5
testing build it was added for became the main file on 2026-10-11. The marker is the opt-in: an older testing build with no marker (such as
`1.67_TESTING`) is ignored without a word, while a build with a damaged marker fails the sync by name. The sync
prints one line per output (`<file>: updated|unchanged`), and `--check` names every stale one.

1. Edit the source in `shared/`.
2. Run `node scripts/sync_shared.js`. It rewrites the generated region in the app HTML and
   `apps-script/Shared.gs`.
3. Commit the `shared/` edit **and** the regenerated region and `apps-script/Shared.gs` together.
4. `node scripts/sync_shared.js --check` is the staleness check the gate relies on: it fails when either copy
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

## Landing changes with `scripts/land.js`

**What it is for.** A PR's gate tests the tree that branch would produce when the gate ran. If another PR lands afterwards, the tree that
actually ships is different and was never tested; that is how #185 and #186 each passed alone and were wrong together (see
[CHECK_HISTORY.md](CHECK_HISTORY.md#2026-10-06-semantic-merge-conflicts-185-vs-186-and-the-merge-safety-systems)). `land.js` is a local merge
queue built on one rule: **`main` only receives a tree that was tested as merged.** It merges the PR onto the current `main` in a
throwaway worktree, runs the gate there, and pushes that exact commit only if `main` has not moved in the meantime. Since 2026-10-11
(Kevin, [DECISIONS.md](DECISIONS.md), D45, superseding D21) it is **not the default**: an ordinary PR merges on GitHub once `local-gate` is green on its
current head (D59; the receipt is only posted for a branch that already contains `main`). Use `land.js` when `check_pr_overlap.js` flags the branch, when the PR combines logic from
two sessions, or when Kevin asks; a docs-only PR can use `--docs-only-fast`. Nothing can force either path.

```bash
node scripts/land.js 123                  # land PR 123 (also: #123, a branch such as feature/foo or origin/feature/foo, or a SHA)
node scripts/land.js 123 --dry-run        # everything except the push
node scripts/land.js --verify             # check the stamp on the tip of origin/main
node scripts/land.js --verify --last 20   # audit the last 20 first-parent commits of origin/main
```

It works on the git repository of the **current directory** (not the one holding the script) and never touches your checkout's branch,
HEAD, index or working tree. A PR number is fetched from `refs/pull/N/head` on the remote; the script calls no GitHub API.

**What happens, in order.**

1. Fetch the base (default `main`) and the PR head. If the head is already an ancestor of the base, print "already landed" and stop (exit 0).
2. Print `WARN:` lines (on stderr) for a branch that is behind the base (listing the files changed on both sides, at most 20), for a
   branch stacked on another unmerged branch, and for more than 25 commits. A warning does not stop the run unless `--strict` is given.
3. Make a scratch worktree at the base tip. `node_modules` from your checkout is symlinked in if the worktree has none.
4. `git merge --no-ff --no-commit` the head. A conflict stops here with **exit 2** and the conflicting paths. The script never resolves
   a conflict and never rebases anyone's branch: merge the base into your branch, resolve, push, run it again.
5. Commit the merge with the stamp (below), then run the gate in the worktree (default `node scripts/run_ci_locally.js`). A failing gate
   is **exit 3** and nothing is pushed. If the gate leaves tracked files modified, that is also exit 3: what was tested is not what
   would be pushed.
6. Amend the commit message with the gate result and the counts the gate printed. The tree hash does not change, and the script asserts that.
7. Push the merge commit to the base with a plain push, **never `--force`**. If the push is refused because the base moved, discard the
   worktree and start again from step 1 on the new base: the re-merge and the second gate run are the whole point. After
   `--max-attempts` (default 3) refusals it stops with **exit 4**.
8. After a push, `git ls-remote` must show the merge commit at the base, or it exits 1. GitHub marks the PR merged by itself, because the
   pushed commit contains the PR's head. The scratch worktree is always removed, unless `--keep`.

A full gate takes about 6 minutes since D80 (see the top of this file), so each retry on a busy `main` costs another full run; that is the price
of the guarantee. Use `--fast` or `--docs-only-fast` below only where they apply.

**Options** (all long-form):

| Option | Meaning |
|---|---|
| `--remote <name>`, `--base <branch>` | defaults `origin` and `main` |
| `--gate "<shell command>"` | replaces the default gate; runs with the scratch worktree as its working directory |
| `--fast` | the default gate becomes `node scripts/run_ci_locally.js --fast` **and the run is forced to a dry run**: a fast gate never pushes. Ignored if `--gate` is given (it then only forces the dry run) |
| `--docs-only-fast` | opt-in, off by default (approved by Kevin, 2026-10-06: D22 in [DECISIONS.md](DECISIONS.md)). If every path the merge changes is under `docs/`, ends in `.md`, or is `.github/pull_request_template.md`, the default gate runs with `--fast` and the push is allowed; the stamp says `--fast (docs-only)`. Otherwise it does nothing |
| `--dry-run` | merge, gate and stamp, but do not push; prints what would be pushed |
| `--max-attempts <n>` | retries from scratch when the base moved (default 3) |
| `--trailer "Key: value"` | repeatable; extra trailer lines placed after the stamp (for example a co-author or session line) |
| `--title "<text>"` | the merge commit subject (default `Land #<n>` for a PR, `Land <ref>` otherwise); newlines are stripped |
| `--keep`, `--json`, `--strict` | keep the scratch worktree; print one JSON object on stdout; make any `WARN:` an exit 1 before the gate runs |

**Output.** Log lines go to **stderr**, prefixed `land: `, and warnings are lines beginning `WARN: `. **Stdout is empty unless `--json`**,
which prints exactly one object:
`{"result":"landed|dry-run|already-landed|conflict|gate-failed|push-refused|verified|unstamped|mismatch|error","mergeCommit":"<sha|null>","tree":"<sha|null>","base":"..","head":"..","attempts":k,"warnings":[..],"counts":[..]}`.

**Exit codes.**

| Code | Meaning |
|---|---|
| 0 | landed, dry run passed, already landed, or `--verify` verified |
| 1 | usage or environment error (bad ref, no remote), a push that failed for a reason other than the base moving, or the post-push `ls-remote` check failing |
| 2 | merge conflict |
| 3 | the gate failed, or the gate modified tracked files |
| 4 | the push was refused on every attempt (the base kept moving) |
| 5 | `--verify`: the commit has no stamp |
| 6 | `--verify`: the stamp does not match the commit |

**The stamp.** The merge commit's message ends with a block of trailers:

```
Landed through scripts/land.js: this exact tree passed the gate before it was pushed.

Landed-Base: <40-hex>          the base tip that was merged onto (parent 1)
Landed-Head: <40-hex>          the PR head that was merged in (parent 2)
Landed-Tree: <40-hex>          the tree of the merge commit, taken after the gate ran
Landed-Gate: <command>         what ran (docs-only runs say "--fast (docs-only)")
Landed-Gate-Result: PASS
Landed-Gate-Jobs: <p> passed, <f> failed, <s> skipped   (only when the gate's summary was recognised)
Landed-Counts: <name>=<executed>/<total>; ...          (only when the gate printed such totals)
Landed-At: <ISO-8601 UTC>
Landed-Attempt: <k>
```

The counts are parsed only from lines the gate really prints; anything
unrecognised is left out, never guessed. Only the last block of `Landed-*` lines counts, and a `Landed-*` line quoted in the body above is ignored, so a PR title cannot forge a stamp.

**`--verify`.** For one commit (default: the tip of `<remote>/<base>` after a fetch) it parses the stamp and checks that the commit has
exactly two parents, parent 1 equals `Landed-Base`, parent 2 equals `Landed-Head`, the commit's tree equals `Landed-Tree`, and the
gate result is `PASS`. No stamp is exit 5; any disagreement is exit 6 and names the field. With `--last N` it prints one line per
first-parent commit, `VERIFIED`, `UNSTAMPED` or `MISMATCH` followed by the short hash and subject, and exits 6 only if a `MISMATCH` appears
(unstamped history from before the tool existed is expected).

### Worked example

Land PR 123. Commands first, then what each prints (shapes, not captured output: the lines the spec fixes are exact, the rest are paraphrased).

```bash
node scripts/land.js 123 --dry-run
```
Prints `land: ` log lines on stderr as it fetches, merges and runs the gate; any `WARN: branch is k commits behind main` line (with the
files changed on both sides) appears before the gate starts. It finishes without pushing, exit 0. Read the warnings: a branch that is
behind and shares changed files with `main` is where meaning conflicts hide. If you see exit 2, resolve the conflict in your branch and rerun.

```bash
node scripts/land.js 123 --trailer "Co-Authored-By: Name <name@example.com>"
```
The same run for real. If it exits 3 the gate failed on the *merged* tree: fix that on your branch (merge `main` in first), push, and run it again.
If it exits 4, `main` moved on every attempt: run it again when it is quiet. On exit 0 `main` points at the stamped merge commit and the PR shows as merged.

```bash
node scripts/land.js --verify
```
Fetches, then prints that `main`'s tree equals the tree that was tested (exit 0). Then:

```bash
node scripts/land.js --verify --last 20
```
```
VERIFIED <short> Land #123
UNSTAMPED <short> <subject of an older commit>
...
```
`VERIFIED` rows are landings made through the script. An `UNSTAMPED` row newer than the script's introduction means someone pushed
without it. `MISMATCH` (exit 6) means a stamped commit's tree is not the tree that was tested.

### What it cannot do

- **It cannot stop a person pushing to `main` by hand.** It is the supported path, not a lock. A direct push skips the tested-tree
  guarantee, and `--verify --last N` shows it afterwards as `UNSTAMPED`. It does not replace branch protection (which would stop the
  push; see CHECK_HISTORY for why that is not built).
- It tests what the gate tests. A gap in the gate is a gap in the guarantee, and nothing here proves the merge means what its authors intended:
  see "Checking open branches for overlap" below, and the fix-removed run in AGENTS.md.
- It does not resolve conflicts, rebase, or call the GitHub API, and the gate never lands anything: its `Landing script (land.js) check` job runs the script only against throwaway repositories.
- Run on a real repository it needs `git`, Node, and whatever the gate needs (`npm ci`, Chromium and `openpyxl` for the default gate).

## Checking open branches for overlap

```bash
node scripts/check_pr_overlap.js                       # the current branch against every other remote branch
node scripts/check_pr_overlap.js --ref 186 --fetch     # a PR number (fetched from refs/pull/186/head), after git fetch --prune
node scripts/check_pr_overlap.js --ref <branch> --base <rev> --verbose --json
```

**Why function level.** The app is one file of roughly seventeen thousand lines and nearly every PR touches it, so "the same file
changed" is always true and carries no information. The question that finds semantic conflicts is "did two branches change the same
*function*?", because that is where #185 and #186 collided (the cleanup on leaving a tab, and the feed-check helpers).

**Flags.** `--ref` is the branch under test (default `HEAD`; a number or `#number` is a pull request, fetched through
`refs/pull/N/head` into `FETCH_HEAD`, so no ref is created); `--base` defaults to `<remote>/main`; `--against <glob>` narrows the other
branches (default: every remote branch except the base and `HEAD`; two stars cross slashes); `--remote` defaults to `origin`; `--fetch` runs
`git fetch <remote> --prune` first; `--json` prints one object on stdout with logs on stderr; `--fail-on-overlap` exits 1 if any HIGH
overlap exists (otherwise 0 once it ran); `--verbose` also prints LOW overlaps, every branch and why a branch was skipped;
`--max-branches <n>` caps the branches printed in the default view (default 10, then an "... and N more branches" line). It uses no
GitHub API and no `gh`. A branch is skipped (listed with `--verbose`) when it is already merged into the base, has the same tip as
the ref, is already contained in the ref, is stacked on it, or has no code changes. **A shallow clone** has no merge-base for old
branches: those are skipped with a "git fetch --unshallow" hint (this repo's cloud checkout is shallow).

**How it works.** For the branch under test and each other branch R, it takes one `git diff -U0` from the merge-base of the base and R,
and one `git show` per changed file. For JS and Apps Script files, and for any HTML file whose content contains the app's
`<script type="text/babel">` tag (detected by content, never by file name), it maps every changed line to the innermost enclosing
*symbol path*, for example `App > handleShowInTable`. Deleted and modified lines are mapped against the merge-base copy, added-only
hunks against the branch copy, and symbols are compared **by name path, never by line number**, so a branch that inserts 200 lines
above does not hide an overlap. Branches already merged into the base (no diff) are skipped silently. Skipped entirely: the generated
shared-logic region of the app file, `dist/`, and `apps-script/Shared.gs` (their source `shared/` is checked instead), and every
non-code file (git's own merge reports textual conflicts there).

**Severity.** **HIGH**: both branches changed the same innermost symbol path, or one changed a function nested two or more levels
inside the other's. **LOW**: they changed the same top-level symbol only (shown with `--verbose`). A HIGH hit on a huge container
(`FlashReportDashboard`, the 10,000-line regression-suite function) means "both edited its body directly"; the line is tagged
`[a N-line symbol: ...]` rather than downgraded, because the tool cannot tell a harmless added `useState` from a conflicting one.
Report lines look like this (real output, from the acceptance run below):

```
OVERLAP refs/scratch/pr185  (last commit 2026-10-06 8f280f0)  HIGH 6
    HIGH <app file> :: FlashReportDashboard > runFeedCheck   you +4/-2, they +3/-2
```

grouped by branch, most shared symbols first, with both sides' changed line counts.

### Worked example

Before opening a PR for feature work, from your branch: run `node scripts/check_pr_overlap.js --fetch`. No `OVERLAP` lines means no other
pushed branch changed a function you changed. A HIGH line means someone else changed the same function: say so in your PR and ask Kevin
whether to sequence the two (land one, then merge `main` into the other and re-run its checks), rather than discovering it at merge time.
Acceptance for the tool itself, run 2026-10-06: `git fetch origin refs/pull/185/head refs/pull/186/head`, then `check_pr_overlap.js --ref <186 tip>
--base <merge-base of the two> --against <185 tip>` (1.0 s) flags six symbols, and `FlashReportDashboard > runFeedCheck` is the real collision:
#185 gave it a `prevRowCount` parameter and #185's `feedCacheVerdict` expects an array back, while #186 changed the return to
`{problems, realRows}`. It also flags `showAnalysisGroupInTable` (#185 rewrote it, #186 added a focus-ref assignment to it) and
`applyCsvText`. It does **not** flag the Undo-bar tab-leave cleanup effect, which #186 rewrote and #185 only sat next to: that flow shows up
through `showAnalysisGroupInTable`, not through the effect. That is the honest shape of a name-level check: it points at the neighbourhood.

### What it cannot do

- **It matches names, not meaning.** Two branches that change *different* functions which interact are not flagged (for instance a
  filter and the Undo bar's saved state). It narrows where to look; it does not replace reading the merged code or the fix-removed run.
- It sees only branches that are already pushed. Work nobody has pushed is invisible; that is what the claims table in
  [DECISIONS.md](DECISIONS.md) is for, and a claim is only visible once it is on `main`.
- The mapping is indentation-based, with brace depth as a veto (the app has dedented blocks that indentation alone would close early), not
  a parser: it is tuned for this repo's style (the app script is indented eight spaces). JS, Apps Script and app HTML only. Cross-checked
  against Babel on the 2.5 build: 408 of 415 named functions match on exact start and end line.
- **Known misses and mislabels:** moving a function to a different parent looks like two different symbols (a missed overlap; #186 did this
  with `showCachedFeed`); an anonymous effect is named from its first dependencies, so a branch that changes the dependency list renames it;
  anonymous callbacks (`map`, `forEach`) count as their enclosing function; one-line class methods and methods with multi-line parameter lists
  are not recognised as symbols; a regex literal right after `}` or `)` is read as division (a `WARN:` line appears if the lexer loses its place).
- It exits 0 unless `--fail-on-overlap` is given; by default it informs. CI's `PR function-overlap check` job tests the tool on throwaway repositories; it does not run it against the real branches.

## The live regression suite

`tests/booking_flash_regression_tests.js` holds structural and invariant checks across every tab, run
in a real browser with real data. `tests/ci_regression_runner.js` drives it headlessly and is what
`run_ci_locally.js` uses:

```bash
BF_VENDOR_CDN=1 node tests/ci_regression_runner.js                              # source
BF_VENDOR_CDN=1 BF_APP_HTML=dist/index.html node tests/ci_regression_runner.js  # deployed artifact
```

It runs the suites in three shards at once (D80, see "Speed" above; `BF_REGRESSION_SHARDS=1` for one page). It prints
`Executed checks: N (expect M), per suite:` followed by one line per suite counted from that run (all shards together), and fails on a
count mismatch. Since 2026-10-03 the line carries only that breakdown; the dated history of totals lives only in the
comment above `EXPECTED_EXECUTED_CHECKS` in the runner.

### One target since 2026-10-11

From 2026-10-05 to 2026-10-11 the runner had two targets, each with its own pinned count: the main file (and `dist/`) and the
2.5 testing build, which alone ran the wave-3 suites. Since the 2.5 build was promoted to production on 2026-10-11 there is
one target again: one pin, `EXPECTED_EXECUTED_CHECKS` (642 at the promotion, 648 with the review fixes in the same PR, 660 with D44, 657 after the duplicate-check cleanup, 675 with the D46 UI review fixes, 683 with Reference_Workbook, 706 with D52's Settings panel, 708 with the layout Zoom, 713 with D55's Sales Week pin and Loadable Quantity (TEU) label, 715 with D55's table-box-while-scrolled fix, 722 with D56's Sector_Alloc_Placeholder, 726 with D57's date columns in the frozen block, 765 with D60's Column_Picker suite and D61's two pinned-border checks, 770 with D62's per-tab hiding and Report Card checks, 811 with D64's heavy vertical borders, 812 with its Booking Flash blank-row follow-up, 814 with D65's Upload File move and Tools list, 843 with D67's Column_Order suite, 844 with D69's Last Refresh move, 847 with D70's voyage-detail panel, 859 with D76's Gmail_Search_Debounce rewrite, 861 with the 2026-10-29 code review's export-sign and punctuation-box checks, 877 with D82's What_Changed suite, 891 with D84 slice 1-A's Freshness_Chip suite, 904 with D84 slice 1-B's Threshold_Health suite, 906 with its review fixes, 924 with D84 slice 1-C's Vvd_Link_Menu suite, 928 with its review fix, 947 with D84 slice 2b-1's Worklist suite, 948 with its review fixes, 940 with D85's chip removal and the worklist's move into Settings, 941 with its review's footprint check, 962 with D84 slice 2b-2's Decision_Card suite and the Worklist's Decide check, 973 with D87's Analyze_Menu suite, 979 with its review, 993 with D88's Threshold_Proposals suite, 998 with its review) in `tests/ci_regression_runner.js`, and every suite runs
unconditionally on the main file and on `dist/index.html`. The runner prints `Executed-check count pinned for <file>: 770`
first. A hand-driven run (pasting the suite into a console) also runs every suite, with no flag. How the two targets were
wired (`TARGETS`, `KNOWN_TARGETS`, `window.__BFRT_TARGET__`) is in the git history of the promotion pull request, if a
future testing build needs it again.

### Slow machines: `BF_RESULT_POLL_TIMEOUT_MS` (2026-10-03)

After the runner injects the suite it polls `window.__bfrtLastResult` every 0.5 s. `BF_RESULT_POLL_TIMEOUT_MS` is the
ceiling on that wait, in milliseconds. It is a **hang detector, not a speed budget**: a suite that finishes is read the
moment it lands, so a higher ceiling costs a healthy run nothing and only delays the verdict on a hung one.

- **Default 1200000** (20 minutes) when unset or empty, since 2026-10-11 (it was 240000, 4 minutes; the 2.5 build's job,
  which ran the larger suite, always used 1200000, and that suite now runs on every target). Give it a positive whole number
  of milliseconds. Anything else (text, `0`, a negative number, a decimal, `1e5`) falls back to the default and prints one
  warning line at the top of the log, so a typo cannot silently remove the limit.
- **Inherited by `scripts/run_ci_locally.js`.** Its jobs are spawned with the parent's environment (`sh()` passes
  `process.env` on), so `BF_RESULT_POLL_TIMEOUT_MS=900000 node scripts/run_ci_locally.js` reaches both live-suite jobs
  (source and `dist/index.html`). No other job reads it.
- **When to raise it:** a slow or CPU-limited sandbox. The source run compiles the app in the browser with
  babel-standalone (about 5 s per page load; since 2026-10-06 the isolated iframe boots reuse the page's own compiled output
  instead of compiling again, see "Isolated iframe boots" below, so a run compiles twice instead of 29 or 68 times); in this
  sandbox the source run took about 6.5 minutes (394 s, 2026-10-06) against the then 4-minute default, while the `dist/` run (JSX
  compiled ahead of time) took about 2.3 minutes (136 s) and the 2.5 build's run (473 checks then, in-browser Babel) about 13.6 minutes (815 s).
  After the iframe-boot reuse (later on 2026-10-06) the same sandbox ran source 134 s, `dist/` 124 s and the 2.5 build (533 checks) 252 s, so
  the default is enough on most machines; keep the override for a slow one. The symptom is `Suite did not finish within <N>ms (window.__bfrtLastResult stayed null)` with
  nothing wrong in the app. Example: `BF_RESULT_POLL_TIMEOUT_MS=900000 BF_VENDOR_CDN=1 node tests/ci_regression_runner.js`.
- **When not to:** a real hang looks the same from the runner's side as a slow machine. If the last `[page:log]` line in
  the output stopped advancing minutes ago, the suite is stuck (a modal that never opens, an await that never settles)
  and a bigger ceiling only makes you wait longer for the same failure.
- **Why an environment variable and not an edited constant:** on 2026-10-02 the source run needed the constant raised to
  1500 s in a hand-edited copy, which is how a local workaround ends up in a commit. The gate itself keeps the default.

### Current counts (2026-10-31, 998 checks)

One target since the 2026-10-11 promotion: every suite below runs on the main file and on `dist/index.html`. Until then the
main target ran 405 of these and the 2.5 testing build all 642; the suites built for the testing build (2026-10-05 to 2026-10-11) are
described in the next subsection.

| Suite | Checks | Suite | Checks |
|---|---|---|---|
| Trade_Summary | 6 | Preferences_Persistence | 42 |
| Sector_Summary | 16 (12 + 4 "Show in table" checks; was 15 + 4 until 2026-10-11, when 3 checks that could not fail were removed) | Field_Visibility | 9 (8 until 2026-10-29, +1: the Excel export keeps an accounting negative "(-19)" negative) |
| POL_Booking_Flash | 30 (D73, 2026-10-28: `checkPinnedBorders`, `checkHeavyBorders` and `checkSpacerNoOverlay` rewritten in place, same count, to assert one 1px rgb(156, 163, 175) line owned by each cell, header cell and the scroll box, no `::before` overlay and no heavy 2px line; was 28, +2 on 2026-10-22 for D64: the heavy vertical borders and the spacer rows without vertical lines; 28 was 27, +1 on 2026-10-15 for D61: the pinned body cells keep their 1px `::before` grid-line border, and Trade / Sub Trade are not sticky; 27 was 25, +2 on 2026-10-14 for D57: the two date columns stay pinned with Freeze on and scroll away with it off; 25 was 22, +3 on 2026-10-13 for D55: Sales Week stays pinned with Freeze on and scrolls with it off, and the Loadable Quantity header says "(TEU)"; 22 was 18, +4 on 2026-10-07 for D18: a POL-only column filter applies on the POL tab only) | Filter_Persistence | 42 |
| Booking_Flash | 33 (D73, 2026-10-28: the same three checks, rewritten in place, same count; was 32, +1 on 2026-10-23 for the D64 follow-up: the blank rows have no vertical lines; 32 was 31, +1 on 2026-10-22 for D64: the heavy vertical borders; 31 was 30, +1 on 2026-10-15 for D61: the pinned body cells keep their 1px `::before` grid-line border, and Trade / Sub Trade are not sticky; 30 was 28, +2 on 2026-10-14 for D57: the two date columns stay pinned with Freeze on and scroll away with it off; 28 was 26, +2 on 2026-10-13 for D55: Sales Week stays pinned with Freeze on and scrolls with it off; 26 was 21; +3 on 2026-10-06 for the table kept mounted across tab switches; +2 on 2026-10-11, D46: on a short window the table ends inside it, so its horizontal scrollbar stays reachable) | Gmail_Search_Debounce | 21 (D76, 2026-10-29: the suite was rewritten for single-click-selects / double-click-opens; was 9, +12: the new tooltip on VVD and Vessel Name, a single click selects and opens nothing on VVD and Vessel Name, the row still highlights on a click, a drag across cells still suppresses it, a double-click opens exactly one tab with the right URL and arguments and does not toggle the row, Enter and Space, and a Detail-table pass of three checks) |
| Analyze_BookingFlash | 46 (28 + 10 "Show in table" checks + 6 on 2026-10-11 for D44: a card selects the chart and tiles; +2 the same day for D46: the table re-fits when the Undo bar appears and goes away; 28 was 26) | Fields_Picker_ReAnchor | 6 |
| Analyze_POLBookingFlash | 31 (23 + 2 "Show in table" checks + 6 on 2026-10-11 for D44; 23 was 22, +1 on 2026-10-08 for D30: Analyze has no "NO N.A. CALL" card) | OPUS_Schedule_Link | 9 |
| Trade_Summary_CommaGuard | 3 | Server_Extras_UI_Gating | 3 |
| Compare | 13 | Historical_PerDay_Archive | 12 |
| Historical_Data | 6 | Apps_Script_Team_Features | 85 (84 checks + its tripwire, 2 of them the feed-check silence checks; +2 on 2026-10-12, D52: with config warnings the Settings dot is red and Details are open on arrival, with none they are not) |
| | | Settings_Popover_Layout | 8 (new 2026-10-05) |
| | | App_Update_Check | 9 (new 2026-10-06: the version check through `google.script.run` and the `fetch` fallback) |
| | | Historical_Popover_Placement | 4 (new 2026-10-06) |
| | | Focus_Return | 8 (new 2026-10-06) |
| | | Narrow_Window_Fit | 5 (new 2026-10-06) |
| | | Slicer_Contrast | 5 (new 2026-10-08, D28: slicer chip text contrast at rest and faded, light and dark, plus its tripwire) |
| | | Sector_Layout | 7 (new 2026-10-09, D37: the sector Sheet's two header rows, 6 checks plus its tripwire) |
| | | Sector_Alloc_Placeholder | 7 (new 2026-10-14, D56: "No sector allocation" on the six flagged voyages of the 8-12 fixture, on both tabs; the controls stay blank; the quick filter finds it; a POL filter does not change it; 6 checks plus its tripwire) |
| | | Quick_Filter_Shown | 8 (new 2026-10-09, D40: the quick box finds what the column SHOWS on the 26 Booking Flash and 6 POL columns built after the per-leg row; 6 checks + its tripwire; +1 on 2026-10-29: a box holding only "(" finds Short_Fall's negatives, not every row. Both targets: it is a fix.) Each affected column gets two values taken from its rendered cells (the largest and the middle one), typed into the real box, and the table's whole row sequence must equal the rows of the unfiltered table whose cell contains the value, worked out by the suite (not by the app's accessors). Also: Trade Summary and Sector Summary read identically before and after, POL ignores a Booking Flash-only box, and a stored-text column (Lane) still narrows the summaries. |
| | | Feed_Stamp | 28 (slice 1.1) |
| | | Offline_Cache | 77 (slice 1.2; +1 on 2026-10-11, D46: the line for the cached copy behind an open snapshot) |
| | | Feed_Canary | 38 (slice 1.5; +2 on 2026-10-11, D46: Dismiss is per problem, not per code; +3 on 2026-10-28, D70: a lone voyage disagreement gets Details and an itemised panel naming the port row) |
| | | Phone_Layout | 5 (slice 1.3) |
| | | Show_In_Table_Phone | 6 (slice 1.4) |
| | | Cargo_Slicer | 12 (D32) |
| | | Column_Filters | 26 (D33; +1 on 2026-10-11: a Condition and the Values list agree, and OK keeps the Condition; +5 the same day, D46: focus or Tab leaving the menu closes it, an Esc elsewhere is not swallowed) |
| | | Show_In_Table_Filters | 6 (new 2026-10-11, D46: Show in table clears the filters that would hide the card's sailings, Undo restores them; 5 checks + its tripwire) |
| | | Sector_Cargo | 16 (D35, D37) |
| | | Report_Card_Total | 12 (D36) |
| | | POL_Vvd_Order | 12 (D39; +1 on 2026-10-11: a filter that hides a vessel's first leg does not move the vessel) |
| | | POL_Autofit_Filters | 4 (new 2026-10-11, review fix: POL column widths do not depend on a quick box typed and cleared; 3 checks + its tripwire) |
| | | Reference_Workbook | 8 (new 2026-10-12: Trade Summary, Booking Flash and POL Booking Flash against the reference workbook's cached values, cell by cell; 7 checks + its tripwire) |
| | | Settings_Folded_Layout | 24 (new 2026-10-12, D52: the Settings panel's quick strip, folded sections and footer; 20 checks + its tripwire; +2 on 2026-10-26 for D65: Upload File moved from the top bar into Settings, and the Tools list of the Feeder Flash and Bottleneck Historical links; the Macro-chip and 390 px steps also cover the two new chips without a new record; +1 on 2026-10-28 for D69: "Last Refresh" moved into the Settings footer and the masthead doodle is a 1500px-up background; the step also pins that the masthead's children are not stacking contexts; D72 adds assertions to that same step, no new record: the button-stack wrapper, the old button order below 1500px, and the one-piece sea; D74 changes them to Refresh Now and Settings only and adds: Notes, Historical Data and Analyze in `[data-tabbar-tools]` and not in the masthead, and a Last Refresh with no background and no year) |
| | | Table_Box_Scrolled_Switch | 2 (new 2026-10-13, D55: after Hide Filters, Sector Summary with Show Filters, a 100 px page scroll and a click back, the Booking Flash and POL Booking Flash table boxes end inside the window at scroll 0; the line that measured the box's top from the window instead of the page fails both. No tripwire: it always records exactly two) |
| | | Column_Picker | 42 (new 2026-10-15, D60; 37 -> 42 on the same day for D62: hiding is per tab, with checks for a first-version blob, independence in each direction, the shared group's switch-off timing and the Selection Report Card on each tab: the Fields picker lists every column of Booking Flash (48, 22 shown by default) and POL Booking Flash (51, 26 shown) and hiding any of them removes exactly its header, filter cell and body cell on every row shape, with Freeze on and off, in the Excel export, in the saved `bookingFlashHiddenColumns`, and in the "N hidden" badge, and the windowed POL table keeps its height with columns hidden (D60 fix: POL data rows are 19px); 41 checks plus its tripwire) |
| | | Vvd_Finder | 38 (new 2026-10-21, D63: Settings > Find a vessel; the Setup record + 36 checks + its tripwire; 22 until the Historical archive search was added the same day, 28 until the review fixes) |
| | | Column_Order | 29 (new 2026-10-26, D67: dragging the column headers of Booking Flash and POL Booking Flash into any order; 28 checks plus its tripwire: every movable header is `draggable="true"` with `data-col-unit` (the Inland and Port blocks one colSpan-3 header each) and Trade, Sub Trade and Lane are neither; forward, backward, both-halves, first/last and block moves on each tab with the whole head, the filter boxes and every body row shape graded against text captured in the default order; the `bf-col-drop-before` / `bf-col-drop-after` marks and a cancelled drag; ignored gestures (self, lead headers, no drag started, a drag from a filter box or the resize handle); the filter boxes following their columns; the saved `bookingFlashColumnOrder`; independence of the two tabs in each direction; a reload; a damaged blob; Freeze Panes showing the default order and giving the saved one back; hiding and showing columns; the Excel sheet; the Reset column order button; the restored state) |
| | | Zoom_Layout | 2 (new 2026-10-13, D54: zoomed out to 50%, Sector Summary leaves under 200 px blank below its last table; Zoom is back at 100% afterwards. No tripwire: it always records exactly two) |
| | | What_Changed | 16 (new 2026-10-30, D82: 3 Setup records and 13 checks; see the suite table below) |
| | | Freshness_Chip | 6 (D85, 2026-10-31: the chip was removed, so the suite pins its absence: 3 Setup records, 2 checks and its tripwire; 14 before, D84 slice 1-A) |
| | | Threshold_Health | 15 (new 2026-10-30, D84 slice 1-B: 2 Setup records, 12 checks and its tripwire; see the suite table below) |
| | | Vvd_Link_Menu | 22 (new 2026-10-30, D84 slice 1-C: 3 Setup records, 18 checks and its tripwire; 18 before the review fix that took the button away from the pointer; see the suite table below) |
| | | Worklist | 22 (+1 2026-10-31, D84 slice 2b-2: Decide in the Settings section opens the decision card; new 2026-10-31, D84 slice 2b-1: 2 Setup records, 17 checks and its tripwire; rewritten the same day for D85, the worklist's move into Settings, count unchanged; +1 the same day, the review's footprint check with the section in Settings; see the suite table below) |
| | | Decision_Card | 20 (new 2026-10-31, D84 slice 2b-2: 3 Setup records, 16 checks and its tripwire; see the suite table below) |
| | | Analyze_Menu | 17 (new 2026-10-31, D87: 3 Setup records, 13 checks and its tripwire; 11 before the review's 6; see the suite table below) |
| | | Threshold_Proposals | 19 (new 2026-10-31, D88 PROPOSED, D84 slice 2b-3: 18 records and its tripwire; 14 before the review added 5; see the suite table below) |

Suites 1-9 (left column) total 176 with both fixtures pinned (the sum of the table). The right column totals 594; 176 + 594 = 770.
`EXPECTED_EXECUTED_CHECKS` in
`tests/ci_regression_runner.js` is the source of truth; when a suite gains or loses checks, update it
there and in this table in the same commit. Re-derive counts from a real run, never from a copy.

`Sector_Layout` (2026-10-09, D37) guards Sector Summary's right-hand
table reading the sector Google Sheet. On 2026-10-09 that Sheet went from one header row to two (row 1 labels a DRY block and an
RFR block of six columns each, row 2 names the columns). The app took the first row as the header, found no "Vessel 1st Sub Trade"
and showed an empty table with no error; run on the unfixed production file this suite failed 6 of its 7 records (the one that
passed is the "usual look" check, which is a guard). It boots an isolated instance on `tests/fixtures/sector_data_two_header_2026-10-09.csv`
(a committed copy of the real Sheet, 41 PODs) and checks: the table lists all 41 PODs and no banner; all 41 x 3 numbers equal
`SECTOR_TWO_BLOCK_GT`, a literal that a Python script (csv module, exact fractions) derived from the CSV and not from the app
(the DRY allocation, both blocks' bookings added unrounded and rounded once, open space after them); the anchors AT1 NLRTM
1,166 / 281 / 885, AL5 BEANR 50 / 241 / 0, EMA GRPIR 99 / 110 / 0 (the "Sector Allocation" column and not the 115 in the "MCT" one),
AT4 ESVLC (an empty RFR block); the usual column labels and the untouched left table; and, on a second boot with one heading
renamed, the yellow "Couldn't load live Sector Allocation data" banner saying the layout was not recognised, an empty right table and
no uncaught error. The layout's edge cases are `tests/check_sector_layout.js`, not this suite. The old one-header Sheet stays
pinned for every other suite.

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

`Focus_Return` (2026-10-06) guards keyboard focus going back to the control that opened a dialog or popover when it
closes (the `useRestoreFocusOnClose` hook; CODE_NOTES.md, "Focus returns to the opener when a dialog closes"). Seven
checks and a tripwire: Settings and Historical Data closed by their Close button and by Escape, the Analysis modal by its
header X and its footer button, and the Analyze vessel list by its X (focus back on the card). Each one focuses the real
opener first and moves focus onto the Close control, so the close really removes the focused element; without the hook
every one ends on `<body>`.

`Narrow_Window_Fit` (Suite 25, 2026-10-06) guards the Fields picker, the Sales Week / Yard slicer panels
and Sector Summary fitting a 320 px window. Three CSS floors were wider than a phone: the picker panel (a fixed 320 px,
clamped to a 4 px left edge, so it ended at 324 px), the Sales Week and Yard panels (`min-w-[300px]`, which made the page
323 px wide), and Sector Summary's two pivot panels (`min-w-[520px]` / `[560px]`, 576 px wide at 320). (The slicer box
itself being squeezed beside the macro column is PR #159's fix and Booking_Flash's X12 iframe check, not this suite.) The
runner cannot resize its window, so the suite recreates each case: it overrides `window.innerWidth` (320, then 280) and
opens the picker, then constrains the filter row to 250 px and the Sector Summary row to 300 px with an inline width. Five
checks: Setup (the trigger and Sales Week found), the panel inside an 8 px margin at 320 and at 280, the Sales Week and Yard
panels inside the slicer box in a 250 px row, and both Sector pivot panels inside a 300 px row. Each first asserts the old
floor really could not fit, so it cannot pass on a layout that never exercised the rule.

`Booking_Flash` gained 4 checks on 2026-10-06 for the floating "N highlighted" pill. It is `fixed right-4` and
`whitespace-nowrap`, so it could not shrink below its text and grew leftward off the window (left edge -16 px at 320). The
check clones the pill into a throwaway 320 px and 280 px box carrying a `transform`, which makes the box the clone's
containing block, so `right-4` and the percentage max-width resolve against it as they would against a narrow window. A
Setup check proves that really happened (otherwise it would measure the real 1280 px window and pass for any code), then:
at least 8 px each side with the label, Report Card and Clear inside the pill (1- and 4-digit counts); Clear still
hit-testable; and at 640 px and up the pill is unchanged (one line, 16 px from the right and bottom).

`Analyze_BookingFlash` and `Analyze_POLBookingFlash` gained 2 checks each on 2026-10-06 (shared helper
`checkChartColumnsFitModal`, last in each suite because its Lane-slicer case closes and reopens the modal). The trend
chart's 17 week columns could not shrink below their widest line (~42.7 px each, 726 px), so the modal scrolled sideways at
768 px wide and below and with some lane filters. The chart now scrolls inside its own `[data-week-chart-scroll]` box. The
first check narrows the modal's inline width to 753, 560 and 360 px and asserts the chart section (title, legend, bars)
fits its box, plus no modal overflow at full width; the second selects MAR (the widest lane on the 8-12 fixture, 801 vs
768 px before) through the real Lane slicer and asserts the modal does not scroll sideways, then clears the slicer.

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

Two runners no longer share a throwaway file (each names its own, see `BF_VENDOR_CDN` above), but run timing comparisons one after another: parallel runs compete for CPU.

#### The wave-3 suites (built 2026-10-05 to 2026-10-11)

These were built for the 2.5 testing build. Since it was promoted to production on 2026-10-11 they run on the main file and on `dist/`
like every other suite, and their counts are in the table above. What each one guards:

| Suite | What it guards, and how its count came about |
|---|---|
| `Feed_Stamp` | 1.1, the "Data as of" stamp (a line in Settings). Count: 28 (27 checks + its tripwire; the first 23 recorded checks were written before the code, 5 came with the review fixes; 2026-10-08, D34: the stamp moved from the masthead into the Settings panel, so the checks open the panel first with `w3.showStamp`, and the two toggle checks became "no such setting" plus a "not under the title" check; count unchanged) |
| `Offline_Cache` | 1.2, the last-good CSV cache, plus the poll-path checks (M2, M8), review fixes F3 (feed-check gate) and X9 (fetched-at stamp, retry banner), and the 2026-10-06 review round (poll under a snapshot, failed Refresh Now, read gate); the 2026-10-06 saved-copy baseline (banner unchanged, recovery after a truncation, a reload of a stuck truncated feed, the way out); the 2026-10-06 healthy entry's realRows (a recovery after a truncation that also dropped real rows is saved at once, real rows collapsing alone against the saved copy are not, an old entry without realRows makes no real-row comparison). Count: 76 (75 checks + its tripwire; was 70 before D19's two "late first reply" boots, 2026-10-07; 36 originally) |
| `Feed_Canary` | 1.5, the feed-check banner, plus (2026-10-06 follow-up) the real-row baseline: a drop, a jump, and an old baseline without `realRows` that must not alarm. Count: 33 (32 checks + its tripwire; was 24) |
| `Phone_Layout` | 1.3, the slicer box at phone width. Count: 5 (4 checks + its tripwire) |
| `Show_In_Table_Phone` | 1.4, Analyze's window closes below 640 px and focus goes to the Undo bar; stays open at 700 px. Count: 6 (5 checks + its tripwire) |
| `Analyze_BookingFlash` | 1.4, Analyze's "Show in table" button, Lane tabs, plus the Undo bar; reworked 2026-10-06. Count: 10 of the suite's 44 (the "Show in table" checks, no tripwire of its own: 5 for the button (slicers kept, Lane set and Sale Week left as the reader set it; the table holds the lane's sailings under the reader's weeks, and those inside the window's weeks are exactly the card's, window stays open and announces, click stops at the button), 5 for its Undo bar (including cards unchanged under a Coast slicer and a VVD header filter, and card after card with one Undo)) |
| `Analyze_POLBookingFlash` | 1.4, the same button on the POL tab. Count: 2 of the suite's 31 (the "Show in table" checks and the Undo bar's Yard-search case; no tripwire of its own. The 4 checks for the "NO N.A. CALL" card's button and POL filter were removed with the card on 2026-10-08, D30) |
| `Sector_Summary` | 1.4 review fix, reworked 2026-10-06. Count: 4 of the suite's 19 (the button is offered only for a lane in that tab's table, plus pressing it sets Lane, leaves Sale Week as it was, and leaves the other lanes' buttons; no tripwire of its own) |
| `Apps_Script_Team_Features` | 1.5, the check says nothing on the two fixtures every other suite loads. Count: 2 of the suite's 83 (two silence checks; one tripwire for the whole suite since 2026-10-11) |
| `Cargo_Slicer` | Trade Summary's Dry / Reefer slicer. Expected values come from the pinned live fixture parsed on the test side (Trade + Sub Trade + Sale Week, Laden TEU and Reefer TEU) and are compared with every table cell and the table sum: Reefer = `Measures Reefer TEU`, Dry = Laden TEU minus it, neither or both = Laden TEU as before; Dry + Reefer = Total in every cell (255,376 + 27,038 = 282,414); Dry keeps the total Max Laden; Reefer alone divides by the reefer capacity (the Max Laden row is relabelled "Reefer Max Laden" and every cell is the fixture's largest `Measures BSA TEU RF` per lane, summed per Trade / Sub Trade / Sale Week), and its toggle puts the total Max Laden back, is offered only with Reefer alone, and is remembered; Utilization = the TEU row over the Max Laden row shown; one table row count in every mode; the chip contract (click clears, other chip isolates, Alt-click adds, the clear button empties); and independence from the Lane slicer and from Clear Filters. Setup pins the fixture totals so a changed fixture fails there.. Count: 12 (11 checks + its tripwire; new 2026-10-08, D32) |
| `Column_Filters` | The Excel-style menu behind the funnel in every filter cell of Booking Flash and POL Booking Flash. Expected values are read off the rendered cells (minus the link glyph, the notes badge and the `[NO N.A. CALL]` tag) and parsed by the suite's own number, date and wildcard readers; the app's accessors and operators never grade themselves. Two fidelity checks compare the menu's checklist (every distinct value and its count) with the rendered cells for all 48 Booking Flash and all 51 POL filter columns, so a cell that changes without its accessor changing fails naming the column. Then each operator family through the real menu: percent (greater, less, at least, at most, equals, not equals, between, reversed bounds), accounting and comma columns, top / bottom N with ties and above / below average (also with another column's filter on), text and wildcards, dates with blanks, And / Or, the checklist (single value, Blanks, search plus Select All Search Results). Also: a wildcard built to backtrack finishes in 2 s; a Values filter keeps values another filter hides; the funnel has no text; summaries, Compare and Analyze are byte-identical with a filter on; Esc, Cancel and an outside click apply nothing; focus enters the menu and returns; the bar and its chips; Clear Filters, hiding a column and per-table scope. Menu actions run inside `flushSync` because Tailwind's Play CDN re-scans every element on each DOM mutation (about 150 ms per commit with both big tables mounted); a full run is about 2 minutes longer for this suite (measured on the testing-2.5 target).. Count: 21 (20 checks + its tripwire; new 2026-10-08, D33; +1 on 2026-10-11) |
| `Sector_Cargo` | The Dry / Reefer chips on Sector Summary. The left table ("Average Max Laden vs Booking") is compared cell by cell, all 25 lanes x 4 numbers, in all three modes against a ground truth made OUTSIDE the app (Python and openpyxl on the sample xlsx, exact arithmetic, D35's formulas: Reefer Avg Booking = the sum of Avg Booking x reefer / laden TEU, Reefer Avg Max Laden = the mean over the lane's vessels with reefer capacity above 0 of `Measures BSA TEU RF`, Dry Avg Booking = the rest, Dry keeps the total Max Laden; PN1 reefer 472 / 367 / 78%); Reefer + Dry = the total per lane; labels per mode; the caption and the note appear only with exactly one chip on. The pinned ONE-block Sheet (the layout the app read until 2026-10-09): `data-sector-cargo-blocks="no"`, the right table identical in every mode and equal to the Sheet, and the note says the Sheet has no DRY / RFR blocks. The right table's blocks are tested on ONE isolated instance booted (`w3.boot({ sectorText })`) on `tests/fixtures/sector_data_two_header_2026-10-09.csv`, a committed copy of the REAL two-header Sheet (41 PODs): all 41 PODs x 3 numbers in each of the three states against `SECTOR_TWO_BLOCK_GT` (neither or both chips = the whole POD, Reefer = the RFR block's own Sector Alloc / Average Booking / Open Space, Dry = the DRY block's own), a literal a Python script derived from the CSV; the Setup check re-derives it from the CSV's cells with the suite's own small reader and pins both Sheets' header rows and block labels. Anchors: AT1 NLRTM 1,166 / 281 / 885 whole, 820 / 6 / 815 reefer, 1,166 / 275 / 891 dry; the 14 PODs with no reefer figures stay listed as 0 / 0 / 0; EMA GRPIR reefer 99 / 0 / 99 (D41: a blank Open Space with nothing booked is the allocation); labels follow the chips only where the number changes meaning ("Reefer Sector Alloc", "Dry Open Space"); the note says which block is read. Across the modes: Dry's allocation is the whole POD's on all 41, Reefer's is never larger and smaller on exactly 2 PODs, Reefer + Dry booking is the whole POD's within 1, each block's Open Space is its allocation less its booking within 1. Then Trade Summary untouched and the choice shared between the tabs, and the chip contract with a Lane slicer and Clear Filters. Fix-removed run: making the chips ignore the blocks fails exactly the Reefer, Dry and across-modes checks.. Count: 16 (15 checks + its tripwire; new 2026-10-09, D35; its right-hand half rewritten for the real Sheet by D37, was 17) |
| `Report_Card_Total` | The Total row of the Selection Report Card on Booking Flash and POL Booking Flash, opened from the real highlight pill. Two oracles, neither the app's own total. (1) Every summed column is compared with the sum of the cells shown above it, using the suite's own parse and formatter; the percent columns and every text column must be blank (the percent columns must hold numbers, so blank is a decision); POL's BSA TEU is summed over distinct VVDs. (2) Literal anchors made outside the app from the 8/12 workbook for YMKT0113W + POHT0076E: Booking Flash Max LDN 4,500, Current Laden 2,602, Short_Fall (-1,898), ONE Quote 23, Broken Routes 0; POL, six legs: BSA TEU 5,967 (the six cells add to 17,306), POL Max Laden 4,500, Discharge 5,882, Current Laden 2,602; and after three of POHT0076E's legs are un-highlighted with the card closed, BSA 5,967, POL Max Laden 2,750, Discharge 4,134, Current Laden 1,355. Also: the Total is the table's last row with one cell per column and "Total" first; a VMS placeholder in the selection adds nothing; one highlighted row shows no Total and no note; the table scrape behind the CSV and Excel buttons ends with the Total row and never carries the note; the note's wording on each tab. Two fix-removed runs on the testing build: dropping the once-per-vessel rule fails exactly the 3 POL checks, formatting Short_Fall as a plain number fails exactly the 2 Booking Flash checks. Planned / Actual Mty are 0 throughout the export, so their totals are only ever checked as 0 (Kevin confirmed on 2026-10-09 that they are per-POL, so they are summed, D36); a non-zero case would need a synthetic feed.. Count: 12 (11 checks + its tripwire; new 2026-10-09, D36) |
| `POL_Vvd_Order` | POL Booking Flash keeps a vessel's legs together inside a lane's sailing week and orders the vessels by their first sailing (Kevin: "first sort by Sales Week then VVD then ETD", then "ordered by each vessel's earliest ETD"). The rendered table is read the way a person reads it (cell text minus the OPUS link, the notes badge and the `[NO N.A. CALL]` tag; Trade / Sub Trade / Service carried down from the row above) and graded against the rule written in the suite; the app's comparator never grades itself. Setup ties the table to the fixture (964 rows, 5 lane-weeks with two real vessels) and recomputes the OLD order from the same rows to prove the fixture holds a vessel it splits (`PS4 2026/W27`). Checks: no vessel is split in any of the 5 weeks; vessels follow the order of their first sailing, VVD A to Z on a tie (`EC3 2026/W36` reads `ONGT0031W`, sails 8/25, before `NCMT0031W`, sails 9/7); legs inside a vessel follow Coastal ETD (333 vessels with two or more legs) and a PAROD leg that sails last is still last; a known answer for `PS4 2026/W27`; Sale Weeks, blocks and spacer rows unchanged; a copy of the fixture with YM UNICORN turned into a VMS placeholder keeps it last in its week; a second copy, built so two vessels first sail on the same day, proves the VVD tie-break (these two are the checks that boot a second app); Booking Flash keeps its own ETD Last Port order (`EC3 2026/W36` reads `ONGT0031W` before `NCMT0031W` there) | POL tab, VVD grouping. Count: 12 (11 checks + its tripwire; new 2026-10-09, D39; +1 on 2026-10-11) |
| `Settings_Folded_Layout` | The Settings panel after D52 (Option D). Five boots, each isolated because the open or folded choice lives in localStorage, which the iframe shares with the page: (1) a fresh browser, to prove Data & safety and Export are folded by default with none of their controls mounted, the quick strip (Zoom, the A- / A+ text-size stepper over 12 to 24, Light | Dark, the chips) is on screen, the folded headers read their live summaries, the Macro-buttons chip and the Screenshot entry follow the tab, a switch flips and its header follows, the stepper walks all seven sizes and stops at both ends, Theme puts the app in dark mode and back with the pressed button wearing the brand token `bg-one` (D47, not a hard-coded pink), the healthy footer has one stamp with a green dot and no status lines, Details mounts and folds the four lines, and the folded panel is at most 420 x 335 px (open: 575 tall; since D63's third folded header, "Find a vessel", measured 303 folded; it was 300 / 540 under D52 and about 440 x 540 before that); (2) a boot with the controllable clock, where the stamp goes stale and the dot turns amber; (3) a reload, where both sections come back open from the stored `1` values and Excel calls the workbook writer once and closes the panel; (4) a 390 px window, where the strip wraps inside the panel. The Config-warning case (red dot, Details open on arrival) is asserted in `Apps_Script_Team_Features`, which already boots six warnings. Controls are found by `data-settings-section`, `data-settings-action`, `data-settings-theme`, `data-settings-status-toggle` and `data-setting`, never by visible text, and every "absent" assertion has a control present in the same state. |
| `Vvd_Finder` | Settings > Find a vessel (D63, 2026-10-21). Eight isolated boots (A to H). (A) a fresh browser: the section is the middle of three (`data`, `find`, `export`), folded with no search box mounted, "Is a VVD in the data?" on its header; opening it mounts the box and a Search button that is disabled while empty and writes `1` to `bookingFlashSettingsFindOpen`; then the answers, with what the app's direct download of the live Sheet returns controlled through `b.ctl.liveText` / `liveMode`: the real SROT0045S typed as `" srot0045s "` is in both (2 port rows each, Max Laden 140 / 140 / 110 and 140 / 140 / 30, on screen 2 of 2, AN2 has no sector line = neutral), one search downloads the live and sector Sheets once each and leaves the stamp, the row count and the page unchanged, Enter submits the form; a voyage the Sheet gained (ZNEW0001E) is "not in this report yet", is not staged or added by looking, and Refresh Now then really brings it in; one the Sheet lost is "no longer in the live Sheet"; an absent one is "in neither" and shows only the two location lines (the Max Laden, Sector and On screen lines have nothing to say and are not drawn); a typo (SROT0045) offers SROT0045S as a button that searches it; a network error and a 200 sign-in page are said plainly while the same VVD is found once the Sheet is back; YUNT0080W filled to 900 in the Sheet is "newer values"; the four Max Laden outcomes on real voyages (YUNT0080W blank on lane PS4, GJMT0003W 0 on the ad-hoc EXE lane, OSUT0120E partial, SROT0045S filled, and no red cell in the port-row table of a voyage where blank is normal); a Lane slicer and a column filter box are each named as what hides SROT0045S (with the control: cleared, the same VVD is on screen again); VMS is refused without a download; no uncaught page error. (B) a reload keeps the section open. (C) with an uploaded file that lacks SROT0045S, the answer names "the uploaded file" and gives no Refresh Now advice. (D) at 390 px the panel has no sideways overflow. The Historical archive search (the opt-in button under the checklist; added the same day): a normal search downloads no archive; a voyage the Sheet lost (BYBT0216W) is "in 1 of 3 archived days ... missing since" from one archive download and a new search clears it; TTLT0028W (two archived days, one a quoted multi-line record) is ok with Max Laden filled on 2 of 2; a copy of SROT0045S is "new in the feed"; (E) an archive with OEHT0100W's Max Laden blanked on the 25th reads "filled on 1 of 2"; (F) through the per-day archive's fake server the same answer comes from 1 index call and 3 day downloads and no Sheet download, a failing day (`{ok:false, reason:"boom"}`) is said with its reason with a retry that works, a day that is a sign-in page is an error naming the day, one failing day among 12 ends the search after exactly 3 downloads, and (no `getDataFeed` on that server) the plain "Refresh Now brings it in." is said. Review fixes (2026-10-21): in (A) a 4-letter search shows "Type the whole VVD" and no archive button, and a second search against a Sheet answering 1.5 s late leaves the first answer on screen with the archive button disabled and starts nothing if clicked; (C) a file holding a VVD the live Sheet lacks is neutral, not "removed upstream"; (E) archives edited so OEHT0100W is blank in both Max Laden columns on the 25th, TTLT0028W is blank in Update only (the older column still shows capacity, so the archive says filled 2 of 2) and BYBT0216W is on the ad-hoc EXE lane with 0 (not counted missing); (G) an archive holding one VVD 2,601 times stops at the 2,500-row budget with a control in the same boot; (H) a server with `getDataFeed` gets the shared-copy caveat and the search never asks that server for the feed. Controls are found by `data-vvd-finder-*` hooks and `data-settings-section`, never by visible text; the expected figures are typed from a Python pass over the CSV. |
| `What_Changed` | The what-changed banner (D82, 2026-10-30; roadmap 2.2 and 2.3). Three isolated boots with a fake `google.script.run`. (A) `getDataFeed` serves the live fixture with `changedDate` 2026-08-26 and the archive lists 08-24, 08-26, 08-25 out of order: the baseline is 08-25 and only it is downloaded; its file is the live fixture plus one copied row renamed ZZZT0001W, so the banner reads exactly "Since Tue 8/25: 1 sailing removed (ZZZT0001W)"; Details shows a Removed (1) table, Escape closes it and returns focus, Dismiss stores `2026-08-25|2026-08-26|ZZZT0001W` and focuses the masthead, and the Settings switch (on by default) hides it, clears the dismissal, and brings it back. (B) direct live path and only a 2099 date: "No earlier day on file to compare with yet.", no day downloaded. (C) a 2020-01-02 baseline equal to the live fixture: "No material change since Thu 1/2 (N days earlier)." Leaves `bookingFlashWhatChanged` and its dismissal key cleared. `Historical_PerDay_Archive` switches the banner off for its own boots |
| `Freshness_Chip` | The masthead freshness chip's absence (D85, 2026-10-31, per Kevin: "remove the Flash data chip from the header"; the chip was D84 slice 1-A). Two isolated boots: (A) a fake `getDataFeed`, (B) a direct download. In each: no `[data-freshness-chip]` and no "Flash data:" text in the masthead, and Last Refresh unchanged (one, in the masthead cluster, its exact D73/D74 class string, "Last Refresh: ..." text and "Data last applied ..." title). |
| `Threshold_Health` | The threshold-health banner (D84 slice 1-B, R-2, 2026-10-30) beside What changed. One isolated boot with a fake `getDataFeed` (changedDate 2026-08-26) and a fake per-day archive (2026-08-18, 08-19, 08-24, 08-25, 08-26, built from the live fixture with known edits). Pins: "81 sailing-ports have no threshold" on the live fixture (an independent Python reading of the CSV, recomputed in-page from the raw cells); clicking it opens POL Booking narrowed to exactly those 81 (VVD, POL) pairs under a `[data-threshold-filter]` bar, and "Show all rows" restores the table; "Thresholds changed in the last 7 days: 4"; the 7-day boundary (08-19, exactly 7 days before the as-of 08-26, is the baseline and is downloaded with 08-24 and 08-25; 08-18 and 08-26 are not); the table's four rows (one "not set" -> 150%, none first seen on the baseline day) and the change first seen on 08-24 after a gap and the note that the archive does not record who changed it; a historical day (82 missing, no change list), Back to Live (the list returns), an upload (missing only) and the session dismissal. |
| `Vvd_Link_Menu` | The row link menu and the `?vvd=` link (D84 slice 1-C, R-3 and X-3, 2026-10-30). Four isolated direct-download boots. (A) `vptWebAppUrl` set in a fake `window.__SERVER_CONFIG__`: every Booking Flash row with a real VVD has one `[data-row-menu="vvd"]` and one `[data-row-menu="vessel"]` keyboard button, with no text, `opacity: 0`, `pointer-events: none` and no effect on any cell's width; `document.elementFromPoint` 2 px and 6 px inside the end of a pinned VVD's and Vessel Name's text (Freeze Panes ON) returns the text, and at the next cell's left edge (Freeze OFF) that cell, never the button; a real click there still toggles the highlight and a real double-click still opens one Gmail search; a right-click (dispatched `contextmenu` at the text) is default-prevented and opens the menu at the pointer (three items, the Shift+right-click hint, focus inside), Shift+right-click and a Sales Week right-click are left to the browser; Open in Vessel Planning opens exactly `<url>?vvd=<VVD>&lane=<the fixture's lane>` with `_blank` and `noopener,noreferrer`; Search Gmail opens the URL the double-click opened; Copy VVD (execCommand and the `navigator.clipboard` fallback, "Copied <VVD>"); the focused button's activation opens the menu without reaching the row; Escape closes and returns focus. (B) `?vvd=<VVD>` in lower case: the `[data-vvd-link]` bar "Showing VVD <VVD> from a link", the VVD column filter on both tables, every row that VVD; the Vessel Planning item with the key unset is `aria-disabled` with a title naming `vptWebAppUrl`; Show all restores every row. (C) `?vvd=VMS` and (D) a `?view=` link load exactly like a plain load. |
| `Worklist` | The worklist, "Needs attention (N)", a folded section of the Settings menu (D84 slice 2b-1, R-4, roadmap 3.3; moved from under the masthead into Settings by D85, 2026-10-31). Three isolated boots. (A) A fake `getDataFeed` whose live rows are the 2026-09-01 rows of the committed 9-day CSV (changedDate 2026-09-01) and a per-day archive of every day of that CSV, split by Record Date in-page (8,769 records). Pins: nothing under the masthead (no `[data-worklist]`, no `[data-worklist-slot]`); the section `[data-settings-section="worklist"]` is the first folded section, titled "Needs attention (12)" with the summary "2 unowned · 7 bookings over threshold · 3 laden over threshold", folded on a fresh browser, its header one line ("Longest-running first"; the per-kind preview is the first line inside); the Settings footprint with the section (folded at most 480 x 480 px, with Data & safety, Export and Details open at most 750 px: D86's caps, 100 px over what was measured); `findExceptions` as of 2026-09-01 is the shared test's pinned answer (unowned 2, over_booking 15, over_laden 6, no_cutoff 0) and 11 over-threshold sailings past their cut-off are left out; the archive days fetched are exactly threshold health's window (08-25 to 08-31, never 08-24); the open list's 12 rows in `sortExceptions` 'days' order with their exact copy, the scope footer and the group label "Needs attention, 12 items: ..."; Escape closes Settings; 390 px (44 px rows, nothing wider than the page); the click-through from Trade Summary (Settings closes, exactly lane EXW and sale week 2026/W41 pressed, the sub-trade chip cleared, the table holding exactly that lane and week's VVDs, focus on the table container, the status line); a date rollover (changedDate moved to 09-02 by a refresh) that keeps the open list on screen and takes no focus; the first 25 rows of Booking Flash and POL Booking Flash identical in text and class with the worklist on and off; no section with Settings off (stored `'0'`), What changed off, a historical day, an upload. (B) The basic build's flag: no section and no switch. (C) An archive with no 3-day streak: no section (spec K9). |
| `Decision_Card` | The decision card (D84 slice 2b-2, research idea R-4, spec `docs/specs/R-4-decision-card.md`). Two isolated boots. (A) A fake server with the live fixture, `getDecisionsFor` and `saveDecision` over an in-memory store, and an `epExport` the test sets per refresh. Pins: the row menu keeps exactly its three items (the fourth is built but off until Kevin decides); the card opened for a POL Booking Flash row's VVD and Port shows that Port, focus on its heading, Escape returns focus to the opener; the sailing line shows the Booking Flash table's own Current Laden, Max LDN, Short_Fall and Standby Threshold cells for the VVD (header-mapped), also with its Lane slicer pressed, and all seven lines; none stored is `empty`, an empty reason is refused with no call; Ctrl+Enter sends exactly one `saveDecision(vvd, pol, { action, reason, seen, supersedes })` and the re-read shows the latest and the polite status; a second save supersedes the first (`data-dc-superseded="1"`); `stale-supersedes` keeps the text and action, shows the conflict and the next save carries the newer id; `busy`; `no-user-identity` disables the actions; a fork shows the conflict note; a formula / `<img onerror>` / newline reason is sent and shown as text; a failed read is `error` and Try again reads once more; the declaration states off / none / ok / stale / unmatched with their copy; a VVD with no rows in the data shows a message instead of the card; the first 25 rows of Booking Flash and POL Booking Flash identical in text and class before and after the card was used (rule 8); 390 px with no horizontal scroll and Save inside the window. (B) The basic build's flag: the card shows its figures, `basic`, no action buttons and no `google.script.run` call. |
| `Analyze_Menu` | The Analyze button's menu (D87, 2026-10-31, per Kevin: "Let's move the threshold bar and all those notifications and just put that in the analyze menu button"). One isolated boot with the committed 9-day CSV (live = the 2026-09-01 rows, every day in the archive). Pins: the banner stack holds neither What changed nor Threshold health nor a schedule-change warning; the badge says 2 and the button's label "Analyze, 2 notifications"; the menu has Open analysis (enabled) above Notifications with both banners and their buttons; Escape closes it with focus back on the button; on Trade Summary the button stays with its badge and Open analysis is disabled with its reason; 390 px inside the window with no sideways scroll; dismissing in the menu takes the badge 2 -> 1 -> none and the menu says "No notifications."; the first 25 rows of Booking Flash and POL Booking Flash identical in text and class before and after; the button's aria-controls is the menu's id and a polite status announces new notifications; Settings and the menu close each other; the button keeps its width with and without a badge. A second boot raises the schedule-change warning with a refresh that drops one lane's sailings: in the menu, not the stack, counted on the badge; Full Details opens over the menu and Escape there leaves the menu open; dismissing it in the menu works. Since D87, What_Changed, Threshold_Health and Worklist read those banners inside the menu, and the Analyze suites and Focus_Return open the analysis through "Open analysis" (locators only). |
| `Threshold_Proposals` | The threshold-approval screens (D84 slice 2b-3, R-5; D88 PROPOSED), the client of `getThresholdApproverRights`, `getThresholdProposals` and `decideThresholdProposal`, against a fake server holding three proposals on the live fixture's biggest lane (one by someone else, one by the signed-in lead, one decided through the older unchecked path). Pins: the folded block "Threshold proposals: 3 pending" in the Analyze menu, counted on the badge; grouped by lane with `BFShared.thresholdProposalChip` text and "unchecked"; for the lane's lead Approve and Reject on for someone else's proposal, Approve off with the own-proposal words and Reject on for their own; a reason required (no call without one); exactly one `decideThresholdProposal({ id: latestId, status, reason })` per decision and the list re-read; a not-approver refusal in words; stale-supersedes with Refresh, which re-reads; rights off and the approver tab missing turn both buttons off with their words; the first 25 rows of both tables identical before and after; the basic build opens the menu with no block and makes no `google.script.run` call at all; an older Code.gs (no threshold functions) shows no block. Since the review: after a decision focus moves to the next row's reason box and "Approved: <VVD>." is announced; an approver of another lane, and a VVD with no lane, get both buttons off with their words before any call; a failed refresh keeps the list and the typed reason and says "Couldn't refresh. Try again."; the badge is exactly one higher with pending proposals than without. |

Total **998** since 2026-10-31: 993 before the review of the 2b-3 screens (+5 Threshold_Proposals). **993** since 2026-10-31: 979 before D88 (+14 Threshold_Proposals, new: the threshold-approval screens). **979** since 2026-10-31: 973 before the D87 review (+6 Analyze_Menu: wiring and announcement, one popover at a time, the fixed badge slot, the schedule-change warning in the menu). **973** since 2026-10-31: 962 before D87 (+11 Analyze_Menu, new: the notifications in the Analyze menu). **962** since 2026-10-31: 941 before D84 slice 2b-2 (+20 Decision_Card, new: the decision card; +1 Worklist: Decide in the Settings section opens it). **941** since 2026-10-31: 940 before the D85 review (+1 Worklist: the Settings footprint with the section, folded 379 px against 410, one folded header over Settings_Folded_Layout's 375, as D63 moved it). **940** since 2026-10-31: 948 before D85 (-8 Freshness_Chip, 14 -> 6: the masthead chip removed, the suite pins its absence; Worklist rewritten for its move into Settings, count unchanged). **948** since 2026-10-31: 947 before the slice 2b-1 review fixes (+1 Worklist: the date rollover). **947** since 2026-10-31: 928 before D84 slice 2b-1 (+19 Worklist, new: the worklist bar; taken from a real run). **928** since 2026-10-30: 924 before the slice 1-C review fix (+4 Vvd_Link_Menu: the pointer never hits the row menu button, Freeze ON and OFF; the real click and double-click on the text; right-click; taken from a real run on `dist/index.html`). **924** since 2026-10-30: 906 before D84 slice 1-C (+18 Vvd_Link_Menu, new: the row link menu and the `?vvd=` link; taken from a real run on `dist/index.html`). **906** since 2026-10-30: 904 before the slice 1-B review fixes (+2 Threshold_Health: the 7-day boundary and the baseline-day gap). **904** since 2026-10-30: 891 before D84 slice 1-B (+13 Threshold_Health, new: the threshold-health banner; counted from the suite's records, to be re-taken from a real run). **891** since 2026-10-30: 877 before D84 slice 1-A (+14 Freshness_Chip, new: the masthead freshness chip; counted from the suite's records, to be re-taken from a real run). **877** since 2026-10-30: 861 before D82 (+16 What_Changed, new: the what-changed banner; counted from the suite's records, to be re-taken from a real run). **861** since 2026-10-29: 859 before the code review's two bug checks (+1 Field_Visibility: the Excel export keeps an accounting negative "(-19)" negative; +1 Quick_Filter_Shown: a box holding only "(" finds the cells that show it, not every row; taken from a real run, which also confirmed 859). **859** since 2026-10-29: 847 before D76 (+12 Gmail_Search_Debounce, 9 -> 21: the suite was rewritten for D76, a single click on a VVD or Vessel Name selects it and opens nothing, a double-click opens the Gmail search; count read from the suite's happy path, to be re-taken from a real run). **847** since 2026-10-28: 844 before D70 (+3 Feed_Canary: a copy of the live fixture with one port row of a real voyage on another Sale Week gives exactly VOYAGE_DISAGREEMENT with a collapsed Details button and no panel; Details opens the panel naming the column, both weeks and the changed port row by yard and seq, with no extra list items; a second click closes it). **844** since 2026-10-28: 843 before D69 (+1 Settings_Folded_Layout: "Last Refresh" lives in the Settings footer, not the masthead, the doodle background is wired inside the 1500px media query, and no masthead child is a stacking context). **843** since 2026-10-26: 814 before D67 (+29 Column_Order, new: 28 checks plus its tripwire; the order key `bookingFlashColumnOrder` and the hidden-columns key are saved and restored, and both tabs end in default order, so no other suite sees a reordered table). **814** since 2026-10-26: 812 before D65 (+2 Settings_Folded_Layout: Upload File moved from the top bar into Settings, and the Tools list with the Feeder Flash and Bottleneck Historical links; two existing steps there also cover the new chips without a new record). **812** since 2026-10-23: 811 before the D64 follow-up (+1 Booking_Flash: `checkSpacerNoOverlay` now also runs on Booking Flash). **811** since 2026-10-22: 808 before D64 (+2 POL_Booking_Flash, +1 Booking_Flash: `checkHeavyBorders` records one check per table that the heavy vertical borders are 2px on exactly the written-out columns, and POL gains `checkSpacerNoOverlay`: the spacer rows have no `::before` overlay; `checkPinnedBorders` now expects each pinned cell's overlay weight, count unchanged). **808** since 2026-10-21: 770 before D63 (+38 Vvd_Finder, new: the Setup record, 36 checks and its tripwire, of which 6 are the Historical archive search and 10 the review fixes; the Settings footprint check's caps moved by one folded header, 300 -> 335 and 540 -> 575, count unchanged; the three Settings keys are saved and restored, so no other suite sees the new section open). **770** since 2026-10-15: 726 before D60 / D61 / D62 (+42 Column_Picker, new: 41 checks plus its tripwire; +1 POL_Booking_Flash, +1 Booking_Flash: `checkPinnedBorders` records one Freeze-ON check per table that the pinned body cells keep their `::before` border; D61 also changed the offsets the existing freeze checks expect to Lane 0 / Sales Week 75 / dates 155 and 235 / VVD 315 / Vessel Name 410, count unchanged). **726** since 2026-10-14: 722 before D57 (+2 POL_Booking_Flash, +2 Booking_Flash: `checkDateColumnsFreeze` records one Freeze-ON and one Freeze-OFF check per table; `checkFreezePins` and `checkSalesWeekFreeze` are unchanged in count). **722** since 2026-10-14: 715 before D56 (+7 Sector_Alloc_Placeholder, new: 6 checks plus its tripwire). **715** since 2026-10-13: 713 before the second D55 fix (+2 Table_Box_Scrolled_Switch, new: the table box sized while the page is scrolled). **713** since 2026-10-13: 708 before D55 (+3 POL_Booking_Flash, +2 Booking_Flash: `checkSalesWeekFreeze` records one Freeze-ON and one Freeze-OFF check per table, and POL gains the Loadable Quantity "(TEU)" header check; `checkFreezePins` is unchanged in count). **708** since 2026-10-13: 706 before the layout Zoom (D54: +2 Zoom_Layout, new). **706** since 2026-10-12: 683 before D52's Settings panel (+21 Settings_Folded_Layout, +2 Apps_Script_Team_Features = 23), and 675 before Reference_Workbook (+8). **675** since 2026-10-11: 657 before the D46 UI review fixes (+2 Booking_Flash, +2 Analyze_BookingFlash, +1 Offline_Cache, +2 Feed_Canary, +5 Column_Filters, +6 Show_In_Table_Filters = 18); 657 was 660 until the duplicate-check cleanup took out 3, on the main file and `dist/`: 642 at the promotion (the 405 the old main target ran plus the 237 that ran only on the testing build: 28 + 76 + 33 + 5 + 6 + 16 + 2 + 12 + 20 + 16 + 12 + 11), plus 6 from the review fixes in the same PR (+1 Column_Filters, +1 POL_Vvd_Order, +4 POL_Autofit_Filters), plus 12 from D44 (+6 Analyze_BookingFlash, +6 Analyze_POLBookingFlash: selecting a card scopes the trend chart and the Overall Snapshot tiles to it; one shared helper, `checkCardScopesChart`). The testing target's pin before the promotion, for the record: 642 from 2026-10-09; 2026-10-09: D40 added 7 `Quick_Filter_Shown` to BOTH targets (6 checks plus the tripwire; main 398, this target 635 before it); D39 added 11 `POL_Vvd_Order` to this target only (10 checks plus the tripwire), 624 before it; D37 added 7 `Sector_Layout` to BOTH targets (6 checks plus the tripwire; main 391, this target 618 before it) and took 1 from `Sector_Cargo` on this one (17 -> 16: the six checks on the invented tall-layout Sheet became five on the real one); D36 added 12 `Report_Card_Total` to this target only (11 checks plus the tripwire), 606 before it; D35 added 17 `Sector_Cargo` to this target only (16 checks plus the tripwire), 589 before it; 2026-10-08: D33 added 20 `Column_Filters` to this target only (16 written first, 3 more from the review of the feature, plus the tripwire), 569 before it; D32 added 12 `Cargo_Slicer` to this target only (10, then 2 for the reefer capacity basis and its toggle), 557 before it; D30 added 1 to both targets (`Analyze_POLBookingFlash`) and removed 4 from this one, 560 before it; D28 added 5 `Slicer_Contrast` to both targets, 555 before it; 2026-10-07: D18 added 4 to both targets and D19 added 6 to `Offline_Cache`, 545 before them; the 2026-10-06 code-review follow-ups added 12 to both targets (`App_Update_Check` 9, `Booking_Flash` +3), 533 before them; the 2026-10-06 narrow-window fixes added 13 to both targets, 520 before them; 520 was after the healthy entry's realRows change, 2026-10-06, taken from a real run: `Offline_Cache` +4; 516 (356 + 28 + 66 + 33 + 5 + 6 + 20 + 2) after the 2026-10-06 follow-up round, taken from a real run: `Focus_Return` +8 on both targets, `Offline_Cache` +6, `Feed_Canary` +9, "Show in table" +3; 490 (348 + 28 + 60 + 24 + 5 + 6 + 17 + 2) after Kevin's 2026-10-06 decisions, +16, measured as 451 -> 467 on the pre-landing stack and re-run on main; 474 before them, taken from a real run of the tree with main's #162/#167/#180/#181 and #159 merged in; it was 473 before #159's phone-slicer check, 451 while main's pin was 325, 384, 396 on the review-fix branch alone, 419/414 for the slice stacks before the 2026-10-05 review fixes, 442 with those fixes, and 432 on the slice stack after its own 2026-10-06 review round). The suites were written before the code (the pristine copy fails 18 of the 23 for the missing stamp; the
five that pass are the four `Setup:` checks and the tripwire), then run against the implementation; see
[CHECK_HISTORY.md](CHECK_HISTORY.md), "the Feed_Stamp suite".

### Isolated iframe boots reuse the compiled app (2026-10-06)

Several suites boot a second, isolated copy of the app in an iframe (`fetch(location.href)`, then `document.write`). On the source
file and the 2.5 build each boot used to make babel-standalone recompile the whole 1.2 MB script, about 5 s each: the log printed
"[BABEL] Note: ... exceeds the max of 500KB" 29 times in a source run and 68 in a 2.5 run. `isolatedBootHtml(appHtml, win)` in
`tests/booking_flash_regression_tests.js` now hands those boots the code babel-standalone already produced for the page itself,
in place of the babel `<script src>` tag, run at DOMContentLoaded as babel would. It does so only when that code is provably the
app: its inline source map names "Inline Babel script" and carries a source byte-identical to both the page's and the iframe's
text/babel block; anything else leaves the HTML untouched. On `dist/` (no Babel) it changes nothing. One boot, the first
`Preferences_Persistence` scenario, is marked `fullBabel: true` and still compiles in the iframe, so that path stays covered. The log
says which path each boot took. Measured in this sandbox on 2026-10-06: source run 264 s to 123 s, 2.5 run 645 s to 245 s, `dist/`
unchanged, executed-check counts unchanged (369, 369, 533 at the time).

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

   `tests/fixtures/sector_data_two_header_2026-10-09.csv` is a second sector fixture, a copy of the real Sheet after it became two header
   rows (D37). The runner does not serve it for the page: the `Sector_Layout` and `Sector_Cargo` suites hand it to their own isolated
   instances, so every other suite still sees the pinned one-header file above.

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
or modal open. That is why the source run is informational in the gate. When a check fails:

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
render rows. Budgets are per tab (POL 8000 ms, Detail 1500 ms); the old hosted runners needed them scaled with
`BF_HIGHLIGHT_BUDGET_SCALE=1.5` (`--ci-budgets`; the gate leaves them unscaled). Healthy numbers are tens of milliseconds, so a failure is a design
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

## Column-reorder remount check and budget (D67)

```bash
node tests/perf_column_reorder_benchmark.js                                  # source
BF_APP_HTML=dist/index.html node tests/perf_column_reorder_benchmark.js      # artifact
```

Needed when a change touches `reorderColumnCells`, the column-order state, `useColumnHeaderDrag`, or the keys or
nesting of the cells in the Booking Flash / POL rows and header rows. About 2 minutes. On each tab (POL with every row
rendered, the test-only `bookingflash:pol-render-all` event) it performs six real header drags / toggles: a first move
away from the default order, a second move, Freeze Panes on and off with an order saved, Reset column order, and a move
that lands back on the default order. Before each it tags the header cells and every cell of about 20 rows; afterwards it
requires at least 90% of them to still be in the document (`MIN_SURVIVAL`), and the time to paint to be within budget
(`BUDGETS_MS`, scaled by `BF_COLREORDER_BUDGET_SCALE`).

**Survival is the real gate.** React keeps a DOM node when its keyed element moves within one array; a change in the
*shape* of the children (a Fragment one render, a re-keyed flat array the next) rebuilds every cell. The first D67
version did that on every switch between the default and a custom order: about 1-2% of cells survived, and one action
on the full POL table froze the page for 8-14 s. Fixed 2026-10-27: 100% survive and the same actions take 0.15-0.4 s on
Booking Flash and 3-6 s on the full 8,769-row POL table. On POL's normal windowed view (`--pol-windowed`, what people
see) they went from 1.3-1.4 s to 0.12-0.28 s. See CODE_NOTES.md,
"Column Reorder Keeps Cells Mounted (D67)".

## The deployable build

```bash
node scripts/build_deployable.js          # writes dist/index.html
node scripts/build_deployable.js --check  # fails if the committed copy is stale
```

Run it after any change to the app file. `dist/index.html` is what Apps Script serves: the same app
with JSX compiled ahead of time, which cut the longest main-thread task on load from ~5.3 s to ~0.26 s.

- **Edit the source, never the artifact.** It carries a `DO NOT EDIT` banner with the source's SHA-256.
- **Test the artifact too.** Its script structure differs from the source's, so the gate runs the
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
`require()` it; Python checks, and the AGENTS.md snippet run
`node scripts/print_app_file.js`, which prints just the file name (skipped testing builds go to stderr). Do not paste
the regex anywhere else: `tests/check_resolve_app_html.js` fails if a new hand-copied version appears in `tests/`,
`scripts/` or `.github/`. If two non-testing files tie for the highest version (`2.0` and `2.0.0` tie), the resolver
exits 1 or throws and names both files; it never guesses. Rename or move one. Always read the printed
"(auto-detected current app version: ...)" line: if it names a file you did not touch, the check did not check your
work.

Use `require('@babel/core')` directly, never `npx babel`, which silently installs an unrelated
`babel@5` that rejects modern syntax.

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
node scripts/run_ci_locally.js                # everything, about 11 min (2026-10-06, after the iframe-boot reuse: about 10.5 min, of which the 2.5 build's suite, a separate job until the 2026-10-11 promotion, was ~4 min; it was ~25 min before)
node scripts/run_ci_locally.js --fast         # skip the 5 browser jobs, about 1 min (a receipt is allowed only for a Markdown-only change)
node scripts/run_ci_locally.js --post-status   # as the first line, then leave the `local-gate` receipt on the pushed HEAD
node scripts/run_ci_locally.js --ci-budgets   # highlight budgets scaled 1.5x, as the old hosted runners needed
```

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
  Runners no longer clobber each other's files; they still compete for CPU, which the timing-sensitive
  checks (debounce windows, the highlight budgets) feel, so the gate keeps running its jobs one after another.
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
regression runs at the same time; the gate runs its jobs one after another on purpose (the timing-sensitive checks feel CPU contention), so the full run is the sum of both halves.

## Headless checks

Each is a standalone script with no browser. Run them directly when you only touched their area.

| Script | Run after changing | Result |
|---|---|---|
| `tests/check_alias_landmines.py <export.xlsx or .csv>` | any `getVal([...])` call | `✅ No landmines found` |
| `tests/check_date_timezone_safety.js` | any `XLSX.read(...)` call, or how a CSV/xlsx is parsed | `✅ PASS` |
| `tests/check_sector_layout.js [app.html]` | `readSectorSheet` (the block between the `BEGIN` / `END SECTOR SHEET READER` marker lines in the app file), or anything about how the sector Google Sheet is read (D37). Cuts the reader out of the app file and runs it on the real two-header Sheet and the old one-header Sheet (same rows as the old reader), then on hand-built grids: merged and repeated labels, a title row, reordered columns, blank lines, exact-half rounding, the allocation columns, and every layout it must refuse with a sentence (renamed headings, a missing label). CI runs it on the main file | `✅ PASS` (42 checks on the main file, measured 2026-10-11 after the promotion; before it, 34 on the 2.0 main file and 36 on the 2.5 build, which also checks `blocks`) |
| `tests/check_field_filter_gating.py` | the Fields picker or slicer gating | pass |
| `tests/check_server_prefs_logic.js` | server-backed preferences, `resolveUserPref` | pass |
| `tests/check_server_extras_logic.js` | filter-prefs sync, Export to Drive, `__SERVER_EXTRAS__`, the per-visitor store and its migration, the owner-only admin claim, `getAppVersionHash` | 40/40 (35/35 before the one-read-per-page-load and probe-leftover checks, 2026-10-07; 13/13 before the 2026-10-06 follow-ups) |
| `tests/check_archive_logic.js` | the per-day archive in `Code.gs` | 49/49 (47/47 before the owner-only admin claim, 2026-10-06; 46/46 before the at-least-one-day budget check, 2026-10-06) |
| `tests/check_team_features_logic.js` | `DataFeeds.gs`, `TeamSheet.gs`, `doGet`, the app's `SERVER CONFIG RESOLUTION`, `NOTES SLICER FILTER` and `NOTES ORGANIZE` blocks (the notes-dialog list helpers: hashtag search and the tag-bar chips, `buildNoteTagChips`, included) | 457/457 (444/444 before the per-visitor prefs store and owner-only admin checks, 2026-10-06; 434/434 before the notes-cache race, flush-before-unlock and no-silent-re-create checks, 2026-10-06; 413/413 before the `changedAt` / `changedDate` / `refreshIntervalMsAtFetch` checks; 337/337 before the `fetchedDate` / `refreshIntervalMs` reply-stamp checks, 2026-10-05; 311/311 on 2026-10-02) |
| `tests/check_color_contrast.js [app.html]` | slicer colours (`SLICER_TONES`, `AP_STATUS_CONFIG`, a `<SlicerBtn>` call site), or any class string that sets a fill and a text colour (`bg-*` with `text-*`). It holds them to 4.5:1 (WCAG AA): every slicer tone solid and faded in both themes on the slicer panel, the grey `SLICER_INVALID` chip, plus every fill/text pair in the app source; disabled styling (`cursor-not-allowed`) is exempt, and three pre-existing pairs Kevin chose to keep are listed in its `KNOWN_EXCEPTIONS` (D29). Needs `npm ci`. The live `Slicer_Contrast` suite measures the rendered chips | `✅ 379/379` on the main file (measured 2026-10-11 after the promotion; on 2026-10-08 it was 340/340 on the 2.0 main file and 357/357 on the 2.5 build, 337/354 before the grey invalid-chip check) |
| `tests/check_compare_kpis.js` | the app's "shared capacity helpers" block or the Compare tab | pass |
| `tests/check_sector_alloc_placeholder.js` | `markMissingSectorAllocation`, `secAllocShownText` or the Sector Allocation / Sector Remarks cell (D56, the "No sector allocation" placeholder). Cuts the real functions out of the app file by parsing it; 32 assertions: the rule's edge cases, the 2026-10-14 EMA `CMDT0002E` case, and the 8-12 fixture against an independent reading of its raw columns (6 voyages / 15 legs) | 32/32 |
| `tests/check_macro_grid_order.js` | `MACRO_GRID_ORDER` / `MACRO_GRID_COMMON_ORDER`, `MACRO_GRID_EXCLUDED_KEYS`, or a `FIELD_TOGGLES` descriptor's `tabs` (D58, one macro-button order on both Booking Flash tabs). Reads those out of the app file by parsing it; 9 assertions: Booking Flash and POL Booking Flash each show Kevin's PROPOSED grid (POL adds VCO Analyst and ETA as its last row), every key a tab's grid shows is placed in that tab's order (an unplaced one would land at the end of one tab only), no duplicates, AP Frozen / AP Only stay out of the order. Proven red against POL's old order and against an unplaced `eta` | 9/9 |
| `tests/check_column_picker_logic.js` | The Fields picker's per-column list (D60, D61, D62): `COLUMN_REGISTRY_ROWS`, `FIELD_TOGGLES`' groups, the picker click logic, the saved `bookingFlashHiddenColumns` blob, `getFreezeLayout` / `FREEZE_COLUMNS` / `buildSpacerPieces`, or a filter-cell call site in either table. Cuts the region between the `BEGIN COLUMN PICKER LOGIC` and `END COLUMN PICKER LOGIC` marker lines out of the app file and runs it headless; 88 assertions: the registry equals each tab's literal `renderFilter` / `filterCell` call sites in order and every key is gated at its filter, label and body cell (so a column added to one list and not the other fails), counts are 22 / 48 on Booking Flash and 26 / 51 on POL with 8 / 10 "hidden" by default, the blob sanitiser, picker rows and clicks (a group switches off when its last column on the tab is hidden), the freeze layout (Lane, Sales Week, the two dates, VVD, Vessel Name at 0/75/155/235/315/410; Trade and Sub Trade not pinned) and the frozen spacer pieces, and a tab with no registry. D62 (columns hidden per tab): the click logic runs on `{ detail, pol_booking }` sets, a group switches off only when its last column on every tab is hidden, the v1 and v2 saved blobs, the Report Card's `columnShownByKey`, and a property check that no picker click on one tab changes the columns the other tab shows (400+ clicks, both tabs, every column and group row, four starting states). Proven red against a removed gate, a drifted registry, the old group-off rule, a group turned on without hiding the other tab's columns, and a group-off test that looks at one tab only | 88/88 |
| `tests/check_basic_build.js` | `dist/basic/index.html`, `apps-script/basic/Code.gs`, `scripts/build_deployable.js`'s second artifact, or anything that makes the app call an Apps Script service. A static part (no forbidden service in `Code.gs`; the flag script first in the basic build's `<head>` and absent from the full build) and a browser part (Chromium with every Apps Script fake: the basic build makes zero `google.script.run` calls and ignores the server-injected state; the full build still uses it; both boot-failure paths, and the network-failure box's wording: NA IT Ops, Reset Network, restart; D49). Needs a browser, so `--fast` skips it | pass |
| `tests/check_resolve_app_html.js` | `resolveAppHtml()` / `pickCurrentAppHtml()` in `scripts/lib/app_file.js`, `scripts/print_app_file.js` (its stdout/stderr/exit-code contract is pinned against a throwaway directory), or anything that could add a second copy of the app-file rule (the guard scans `tests/`, `scripts/` and `.github/` recursively and is itself tested) | pass |
| `tests/check_shared_sync.js` | anything in `shared/`, `scripts/sync_shared.js`, the generated shared-logic region in the app HTML, or `apps-script/Shared.gs` (needs `npm ci` for `@babel/core`) | pass |
| `tests/check_shared_logic.js` | anything in `shared/` or `tests/shared_logic/` (the sync check above proves the copies match `shared/`; this proves each shared function does the right thing). Needs no npm packages beyond Node, so it runs without `npm ci` | pass (`SHARED_LOGIC_CHECK_PASSED (N assertions in M modules)`) |
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

A full gate takes about 11 minutes (see the top of this file), so each retry on a busy `main` costs another full run; that is the price
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

It prints `Executed checks: N (expect M), per suite:` followed by one line per suite counted from that run, and fails on a
count mismatch. Since 2026-10-03 the line carries only that breakdown; the dated history of totals lives only in the
comment above `EXPECTED_EXECUTED_CHECKS` in the runner.

### One target since 2026-10-11

From 2026-10-05 to 2026-10-11 the runner had two targets, each with its own pinned count: the main file (and `dist/`) and the
2.5 testing build, which alone ran the wave-3 suites. Since the 2.5 build was promoted to production on 2026-10-11 there is
one target again: one pin, `EXPECTED_EXECUTED_CHECKS` (642 at the promotion, 648 with the review fixes in the same PR, 660 with D44, 657 after the duplicate-check cleanup, 675 with the D46 UI review fixes, 683 with Reference_Workbook, 706 with D52's Settings panel, 708 with the layout Zoom, 713 with D55's Sales Week pin and Loadable Quantity (TEU) label, 715 with D55's table-box-while-scrolled fix, 722 with D56's Sector_Alloc_Placeholder, 726 with D57's date columns in the frozen block, 765 with D60's Column_Picker suite and D61's two pinned-border checks, 770 with D62's per-tab hiding and Report Card checks) in `tests/ci_regression_runner.js`, and every suite runs
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

### Current counts (2026-10-15, 770 checks)

One target since the 2026-10-11 promotion: every suite below runs on the main file and on `dist/index.html`. Until then the
main target ran 405 of these and the 2.5 testing build all 642; the suites built for the testing build (2026-10-05 to 2026-10-11) are
described in the next subsection.

| Suite | Checks | Suite | Checks |
|---|---|---|---|
| Trade_Summary | 6 | Preferences_Persistence | 42 |
| Sector_Summary | 16 (12 + 4 "Show in table" checks; was 15 + 4 until 2026-10-11, when 3 checks that could not fail were removed) | Field_Visibility | 8 |
| POL_Booking_Flash | 28 (was 27, +1 on 2026-10-15 for D61: the pinned body cells keep their 1px `::before` grid-line border, and Trade / Sub Trade are not sticky; 27 was 25, +2 on 2026-10-14 for D57: the two date columns stay pinned with Freeze on and scroll away with it off; 25 was 22, +3 on 2026-10-13 for D55: Sales Week stays pinned with Freeze on and scrolls with it off, and the Loadable Quantity header says "(TEU)"; 22 was 18, +4 on 2026-10-07 for D18: a POL-only column filter applies on the POL tab only) | Filter_Persistence | 42 |
| Booking_Flash | 31 (was 30, +1 on 2026-10-15 for D61: the pinned body cells keep their 1px `::before` grid-line border, and Trade / Sub Trade are not sticky; 30 was 28, +2 on 2026-10-14 for D57: the two date columns stay pinned with Freeze on and scroll away with it off; 28 was 26, +2 on 2026-10-13 for D55: Sales Week stays pinned with Freeze on and scrolls with it off; 26 was 21; +3 on 2026-10-06 for the table kept mounted across tab switches; +2 on 2026-10-11, D46: on a short window the table ends inside it, so its horizontal scrollbar stays reachable) | Gmail_Search_Debounce | 9 |
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
| | | Quick_Filter_Shown | 7 (new 2026-10-09, D40: the quick box finds what the column SHOWS on the 26 Booking Flash and 6 POL columns built after the per-leg row; 6 checks + its tripwire. Both targets: it is a fix.) Each affected column gets two values taken from its rendered cells (the largest and the middle one), typed into the real box, and the table's whole row sequence must equal the rows of the unfiltered table whose cell contains the value, worked out by the suite (not by the app's accessors). Also: Trade Summary and Sector Summary read identically before and after, POL ignores a Booking Flash-only box, and a stored-text column (Lane) still narrows the summaries. |
| | | Feed_Stamp | 28 (slice 1.1) |
| | | Offline_Cache | 77 (slice 1.2; +1 on 2026-10-11, D46: the line for the cached copy behind an open snapshot) |
| | | Feed_Canary | 35 (slice 1.5; +2 on 2026-10-11, D46: Dismiss is per problem, not per code) |
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
| | | Settings_Folded_Layout | 21 (new 2026-10-12, D52: the Settings panel's quick strip, folded sections and footer; 20 checks + its tripwire) |
| | | Table_Box_Scrolled_Switch | 2 (new 2026-10-13, D55: after Hide Filters, Sector Summary with Show Filters, a 100 px page scroll and a click back, the Booking Flash and POL Booking Flash table boxes end inside the window at scroll 0; the line that measured the box's top from the window instead of the page fails both. No tripwire: it always records exactly two) |
| | | Column_Picker | 42 (new 2026-10-15, D60; 37 -> 42 on the same day for D62: hiding is per tab, with checks for a first-version blob, independence in each direction, the shared group's switch-off timing and the Selection Report Card on each tab: the Fields picker lists every column of Booking Flash (48, 22 shown by default) and POL Booking Flash (51, 26 shown) and hiding any of them removes exactly its header, filter cell and body cell on every row shape, with Freeze on and off, in the Excel export, in the saved `bookingFlashHiddenColumns`, and in the "N hidden" badge, and the windowed POL table keeps its height with columns hidden (D60 fix: POL data rows are 19px); 41 checks plus its tripwire) |
| | | Zoom_Layout | 2 (new 2026-10-13, D54: zoomed out to 50%, Sector Summary leaves under 200 px blank below its last table; Zoom is back at 100% afterwards. No tripwire: it always records exactly two) |

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
| `Settings_Folded_Layout` | The Settings panel after D52 (Option D). Five boots, each isolated because the open or folded choice lives in localStorage, which the iframe shares with the page: (1) a fresh browser, to prove Data & safety and Export are folded by default with none of their controls mounted, the quick strip (Zoom, the A- / A+ text-size stepper over 12 to 24, Light | Dark, the chips) is on screen, the folded headers read their live summaries, the Macro-buttons chip and the Screenshot entry follow the tab, a switch flips and its header follows, the stepper walks all seven sizes and stops at both ends, Theme puts the app in dark mode and back with the pressed button wearing the brand token `bg-one` (D47, not a hard-coded pink), the healthy footer has one stamp with a green dot and no status lines, Details mounts and folds the four lines, and the folded panel is at most 420 x 300 px (open: 540 tall; it was about 440 x 540); (2) a boot with the controllable clock, where the stamp goes stale and the dot turns amber; (3) a reload, where both sections come back open from the stored `1` values and Excel calls the workbook writer once and closes the panel; (4) a 390 px window, where the strip wraps inside the panel. The Config-warning case (red dot, Details open on arrival) is asserted in `Apps_Script_Team_Features`, which already boots six warnings. Controls are found by `data-settings-section`, `data-settings-action`, `data-settings-theme`, `data-settings-status-toggle` and `data-setting`, never by visible text, and every "absent" assertion has a control present in the same state. |

Total **770** since 2026-10-15: 726 before D60 / D61 / D62 (+42 Column_Picker, new: 41 checks plus its tripwire; +1 POL_Booking_Flash, +1 Booking_Flash: `checkPinnedBorders` records one Freeze-ON check per table that the pinned body cells keep their `::before` border; D61 also changed the offsets the existing freeze checks expect to Lane 0 / Sales Week 75 / dates 155 and 235 / VVD 315 / Vessel Name 410, count unchanged). **726** since 2026-10-14: 722 before D57 (+2 POL_Booking_Flash, +2 Booking_Flash: `checkDateColumnsFreeze` records one Freeze-ON and one Freeze-OFF check per table; `checkFreezePins` and `checkSalesWeekFreeze` are unchanged in count). **722** since 2026-10-14: 715 before D56 (+7 Sector_Alloc_Placeholder, new: 6 checks plus its tripwire). **715** since 2026-10-13: 713 before the second D55 fix (+2 Table_Box_Scrolled_Switch, new: the table box sized while the page is scrolled). **713** since 2026-10-13: 708 before D55 (+3 POL_Booking_Flash, +2 Booking_Flash: `checkSalesWeekFreeze` records one Freeze-ON and one Freeze-OFF check per table, and POL gains the Loadable Quantity "(TEU)" header check; `checkFreezePins` is unchanged in count). **708** since 2026-10-13: 706 before the layout Zoom (D54: +2 Zoom_Layout, new). **706** since 2026-10-12: 683 before D52's Settings panel (+21 Settings_Folded_Layout, +2 Apps_Script_Team_Features = 23), and 675 before Reference_Workbook (+8). **675** since 2026-10-11: 657 before the D46 UI review fixes (+2 Booking_Flash, +2 Analyze_BookingFlash, +1 Offline_Cache, +2 Feed_Canary, +5 Column_Filters, +6 Show_In_Table_Filters = 18); 657 was 660 until the duplicate-check cleanup took out 3, on the main file and `dist/`: 642 at the promotion (the 405 the old main target ran plus the 237 that ran only on the testing build: 28 + 76 + 33 + 5 + 6 + 16 + 2 + 12 + 20 + 16 + 12 + 11), plus 6 from the review fixes in the same PR (+1 Column_Filters, +1 POL_Vvd_Order, +4 POL_Autofit_Filters), plus 12 from D44 (+6 Analyze_BookingFlash, +6 Analyze_POLBookingFlash: selecting a card scopes the trend chart and the Overall Snapshot tiles to it; one shared helper, `checkCardScopesChart`). The testing target's pin before the promotion, for the record: 642 from 2026-10-09; 2026-10-09: D40 added 7 `Quick_Filter_Shown` to BOTH targets (6 checks plus the tripwire; main 398, this target 635 before it); D39 added 11 `POL_Vvd_Order` to this target only (10 checks plus the tripwire), 624 before it; D37 added 7 `Sector_Layout` to BOTH targets (6 checks plus the tripwire; main 391, this target 618 before it) and took 1 from `Sector_Cargo` on this one (17 -> 16: the six checks on the invented tall-layout Sheet became five on the real one); D36 added 12 `Report_Card_Total` to this target only (11 checks plus the tripwire), 606 before it; D35 added 17 `Sector_Cargo` to this target only (16 checks plus the tripwire), 589 before it; 2026-10-08: D33 added 20 `Column_Filters` to this target only (16 written first, 3 more from the review of the feature, plus the tripwire), 569 before it; D32 added 12 `Cargo_Slicer` to this target only (10, then 2 for the reefer capacity basis and its toggle), 557 before it; D30 added 1 to both targets (`Analyze_POLBookingFlash`) and removed 4 from this one, 560 before it; D28 added 5 `Slicer_Contrast` to both targets, 555 before it; 2026-10-07: D18 added 4 to both targets and D19 added 6 to `Offline_Cache`, 545 before them; the 2026-10-06 code-review follow-ups added 12 to both targets (`App_Update_Check` 9, `Booking_Flash` +3), 533 before them; the 2026-10-06 narrow-window fixes added 13 to both targets, 520 before them; 520 was after the healthy entry's realRows change, 2026-10-06, taken from a real run: `Offline_Cache` +4; 516 (356 + 28 + 66 + 33 + 5 + 6 + 20 + 2) after the 2026-10-06 follow-up round, taken from a real run: `Focus_Return` +8 on both targets, `Offline_Cache` +6, `Feed_Canary` +9, "Show in table" +3; 490 (348 + 28 + 60 + 24 + 5 + 6 + 17 + 2) after Kevin's 2026-10-06 decisions, +16, measured as 451 -> 467 on the pre-landing stack and re-run on main; 474 before them, taken from a real run of the tree with main's #162/#167/#180/#181 and #159 merged in; it was 473 before #159's phone-slicer check, 451 while main's pin was 325, 384, 396 on the review-fix branch alone, 419/414 for the slice stacks before the 2026-10-05 review fixes, 442 with those fixes, and 432 on the slice stack after its own 2026-10-06 review round). The suites were written before the code (the pristine copy fails 18 of the 23 for the missing stamp; the
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

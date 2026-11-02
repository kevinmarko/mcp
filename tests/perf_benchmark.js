#!/usr/bin/env node
/**
 * Reproducible before/after performance harness for the v1.66 performance pass
 * (see PERFORMANCE_REVIEW.md at the repo root for the plan of record this measures against).
 * Standalone, no test framework -- matches this repo's existing tests/ convention
 * (tests/check_alias_landmines.py, tests/check_date_timezone_safety.js): a single
 * self-contained script with its own header comment, run directly with `node`, printing
 * a human-readable ✅/❌-style report and a machine-readable JSON summary.
 *
 * ROW COUNT -- READ BEFORE RE-DERIVING IT YOURSELF: the sample file's row count is 8,769, NOT
 * the 27,312 `wc -l` reports. Some quoted cells (e.g. free-text "Voyage Remarks") contain
 * embedded newlines, so a line is not a row -- `wc -l` counts embedded newlines inside a single
 * CSV record as separate lines. An earlier draft of this script (and of PERFORMANCE_REVIEW.md)
 * used the inflated `wc -l` figure throughout; both were corrected together once caught. Always
 * count with an RFC4180-aware parser (Python's `csv` module, or SheetJS's own reader, both used
 * to verify the 8,769 figure here) -- never `wc -l` -- if you ever need to re-derive this number.
 *
 * WHAT THIS MEASURES (see PERFORMANCE_REVIEW.md's "Findings, ranked by impact" for the
 * root-cause writeups these numbers are meant to hold accountable):
 *
 *   1. LOAD/PARSE  -- wall-clock time from "user just picked a file" to "the un-virtualized
 *      detail table has its first rows in the DOM", against the real 8,769-row historical
 *      CSV. Decomposed into (a) time actually spent inside the SheetJS `XLSX.read()` call
 *      (the underlying library) and (b) everything else -- which on the unoptimized app is
 *      almost entirely F1's per-row alias/getVal() normalization loop, since XLSX.read()
 *      itself is comparatively fast. This decomposition is why (b) is the number that should
 *      move after an F1 fix and (a) should barely move at all -- if a "parse fix" instead only
 *      moves (a), something else changed.
 *
 *   2. FILTER -- wall-clock time for one FULL recompute of the F3 filter memo (`processedData`)
 *      over all 8,769 raw rows, triggered two ways that both hit the exact same memo:
 *        - one keystroke into a header-filter text input (F4's "not debounced" concern) --
 *          reports both elapsed time AND the number of React commits it caused, since F4's fix
 *          (useDeferredValue) should specifically change the SECOND number (fewer, batched
 *          commits per burst of keystrokes) more than the first.
 *        - one slicer-button click with a real, high-cardinality value ("AW", the single most
 *          common "Sub Trade" in the sample data) -- a second independent trigger of the exact
 *          same memo, so a fix that only special-cases the text-input path (rather than the
 *          memo itself) would show up as an improvement on one measurement but not the other.
 *          Note this is a SLICER BUTTON (`selectedSubTrades`), a distinct filter dimension from
 *          the "Trade" header-filter TEXT INPUT the keystroke measurement above uses -- this app
 *          has no Trade slicer button, only a Trade text-filter column, confirmed by enumerating
 *          the live rendered button list rather than assumed from the CSV's own column names
 *          (easy to conflate: "Trade" and "Sub Trade" are two different real columns here).
 *
 *   3. RENDER / INTERACTION --
 *        - time-to-first-painted-table is the same signal as metric 1's end time, reported
 *          again on its own since it's the number a real user actually perceives ("did the
 *          freeze end").
 *        - simulated drag: real Playwright mouse events dispatched over one of the table's own
 *          column-resize handles (`[data-resize-handle="true"]`, e.g. the Detail table's
 *          "Trade" column) -- not by calling any internal handler directly, so this keeps
 *          working regardless of which handler is under test. Reports total wall-clock for the
 *          whole drag gesture AND the React commit count it caused.
 *
 *          CORRECTION, 2026-09-21: this paragraph used to describe commits == steps as itself
 *          proof of "F5's exact bug shape" (an unthrottled mousemove -> setState with no rAF
 *          coalescing). That was checked against the CURRENT column-resize handler
 *          (`makeColResizer` in the app source) and is wrong -- it already guards its
 *          `setState` behind `if (rafId == null) rafId = requestAnimationFrame(flush)`, the
 *          same pattern F5 shipped elsewhere. On a large table this metric still reports
 *          commits == steps anyway (see PERFORMANCE_REVIEW.md's pass-2b drag finding for the
 *          DevTools trace and the honest state of why), so do NOT read that shape as proof of
 *          an uncoalesced handler on its own -- confirm what the handler under test actually
 *          does before diagnosing it as F5's bug. The metric itself (total wall-clock + commit
 *          count) is still a valid signal; only the standing interpretation of it was wrong.
 *
 *          FOLLOW-UP, 2026-09-21: why commits == steps despite the guard is now diagnosed too
 *          (see PERFORMANCE_REVIEW.md's pass-2b section for the instrumented A/B). Short
 *          version: it is THIS mechanism, `mouse.move(x, y, { steps })`, that causes it --
 *          Playwright awaits each step's CDP dispatch before sending the next, and Chromium
 *          doesn't resolve that command until the renderer can process it, so the synthetic
 *          drag self-throttles to the app's own commit pace and never queues two events for the
 *          guard to coalesce, at any speed. That's a property of driving the app through this
 *          API, not of `makeColResizer`. A continuously-driven hardware mouse (no per-event CDP
 *          round trip) remains untested and could behave differently.
 *        - React commit count for a header-filter keystroke (see FILTER above) is the direct
 *          proxy for F6 (no memo boundaries): with real memo boundaries, a keystroke that only
 *          changes the detail table's own filtered rows should not need to re-render unrelated
 *          leaf components, but commit COUNT alone can't see that distinction (a commit is a
 *          commit whether it re-rendered 3 nodes or 30,000) -- see "resolution limits" below.
 *
 * HOW COMMITS AND LIBRARY TIME ARE OBSERVED WITHOUT TOUCHING THE APP FILE
 * ------------------------------------------------------------------------
 * This script's own scope (see AGENTS.md's workstream table) is explicitly barred from editing
 * the parse path, the filter memo, the header-filter input, the drag handlers, or the leaf
 * components -- exactly the regions the other 3 parallel agents own. Every measurement above is
 * therefore taken from OUTSIDE the app's own source, via two well-established, non-invasive
 * instrumentation points injected as a Playwright `addInitScript` (runs before any of the page's
 * own <script> tags, so it's in place before React/XLSX ever load -- never a diff to the HTML
 * file itself):
 *   - React commit counting: React's UMD build checks for `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
 *     at load time and, if present, calls its `onCommitFiberRoot` after every commit -- this is
 *     the exact mechanism the real React DevTools browser extension uses, not a hack specific to
 *     this script. Installing a minimal fake hook object before react.production.min.js loads is
 *     enough to get a timestamped commit log with zero app-code changes.
 *   - XLSX.read timing: `window.XLSX` is defined via a property setter trap installed before
 *     xlsx.full.min.js loads. Two layers deep, confirmed necessary by tracing the real
 *     xlsx-0.20.3 bundle live: it assigns `window.XLSX = {}` (empty, `.read` doesn't exist yet)
 *     once near the top, then mutates that SAME object in place later (`XLSX.read = function
 *     ...`) once the module finishes building it -- a trap that only watches the window.XLSX
 *     assignment fires once while `.read` is still undefined and never fires again, silently
 *     recording 0ms forever (an earlier version of this script had exactly that bug). The
 *     second trap watches for that later `.read = ...` assignment on the object itself and
 *     wraps THAT. The app calls `window.XLSX.read(...)` exactly the same way either way.
 *
 * WHY A THROWAWAY COPY OF THE APP FILE, NEVER THE REAL ONE
 * -----------------------------------------------------------
 * AGENTS.md/HANDOFF's live-testing method is explicit that the pinned CDN URLs (React,
 * ReactDOM, Babel Standalone, Tailwind, SheetJS) must never be edited in the real app file, and
 * that when the sandbox can't reach the CDN directly, the fix is to fetch each script ONCE, cache
 * it locally, and swap the `<script src="https://...">` tags only in a disposable copy used for
 * testing. This script does exactly that: `tests/vendor/*.js` are fetched on first run (cached,
 * gitignored -- not vendored into the repo as committed binaries) and a throwaway copy of
 * whichever `Booking_flash_report_na_*.html` is current (auto-detected by
 * scripts/lib/app_file.js, via findCurrentAppHtml() below) is written to
 * `tests/_perf_throwaway_app.html`, with only its discovered CDN script tags rewritten to point at the
 * local cached copies, and deleted again at the end of the run. The real app file is never
 * touched.
 *
 * WHY setInputFiles INSTEAD OF THE MANUAL fetch+File+DataTransfer DANCE
 * ------------------------------------------------------------------------
 * HANDOFF's live-testing method describes simulating a file upload via `fetch()` + `File` +
 * `DataTransfer` + a dispatched `change` event, because that method predates this harness and
 * was written for plain browser automation with no better primitive available. Playwright ships
 * a native `locator.setInputFiles(path)` that does the equivalent (assigns the input's `files`
 * FileList from a real file on disk and fires `change`) through the browser's own input-element
 * machinery, without needing a network round-trip to fetch the CSV back into the page first --
 * strictly more direct for the exact same effect. Both ultimately exercise the same
 * `handleFileUpload` -> `processFile` -> `FileReader.readAsBinaryString` -> `XLSX.read` path.
 *
 * REPRODUCIBILITY / VARIANCE
 * ----------------------------
 * Every metric below runs several independent trials (see the *_TRIALS constants) and reports
 * median, min, max, and a spread figure (max-min, and %-of-median) instead of a single number --
 * a single sample cannot distinguish a real 20% win from this sandbox's own run-to-run jitter.
 * cold-start metrics (LOAD) use a fresh browser context per trial (closest to what a real user
 * experiences on first open); warm-state metrics (FILTER, DRAG) reuse one already-loaded page
 * across trials, resetting only the specific filter/column-width state each measures, since
 * those interactions only make sense against already-loaded data and re-loading 27k rows before
 * every trial would make the run impractically slow without adding anything the LOAD metric
 * doesn't already cover.
 *
 * RESOLUTION LIMITS -- READ BEFORE COMPARING TWO RUNS
 * -------------------------------------------------------
 * - `performance.now()` itself is sub-millisecond, but this is a single shared, often
 *   single-core, virtualized sandbox with no isolation from whatever else is scheduled on the
 *   same host at the same moment -- observed run-to-run spread on LOAD (a multi-second
 *   operation) has been as high as ~15-20% of the median in practice (see the recorded
 *   baseline's own spread numbers below/in this file's header once run). A candidate "fix" whose
 *   reported improvement is smaller than that spread has NOT been shown to be a real win by this
 *   harness alone -- re-run it, and prefer the decomposed sub-metrics (e.g. F1's mapMs vs
 *   xlsxReadMs) which isolate the change better than the end-to-end total.
 * - React commit COUNT is a coarse proxy: it cannot distinguish "3 unrelated leaf components
 *   re-rendered" from "the entire 8,769-row table re-rendered" -- both count as one commit. It
 *   is a real, meaningful signal for F4/F5 (both are precisely about NUMBER of commits caused by
 *   one input event), but it says nothing about F6/F7 (react-render COST per commit). Cross-check
 *   any F6/F7 claim against the FILTER/LOAD wall-clock numbers, not commit count alone.
 * - The simulated drag dispatches real OS-level-equivalent mouse events via Playwright's CDP
 *   mouse API with a fixed step count (see DRAG_STEPS) -- this is a reasonable stand-in for a
 *   human drag gesture but is not literally recorded human input, so absolute timings won't
 *   match a real trackpad session; only relative before/after comparisons on THIS harness, on
 *   the same machine, are meaningful.
 * - This script measures wall-clock and commit counts, not CPU/scripting time in isolation from
 *   paint/layout (that would require parsing a full Chrome DevTools Protocol trace, which this
 *   repo's no-framework/no-build-step convention argues against as a first pass) -- a change
 *   that trades scripting time for layout time (or vice versa) would look neutral here even
 *   though it might feel different to a user. Treat this as a first-order signal, not a
 *   substitute for opening the actual DevTools Performance panel on a suspicious result.
 *
 * REQUIREMENTS / SETUP
 * -----------------------
 *   npm install          -- installs playwright as a devDependency (already added to
 *                            package.json; this repo's app itself has zero runtime deps, this is
 *                            dev-only tooling, matching tests/check_date_timezone_safety.js's own
 *                            xlsx devDependency).
 *   Do NOT run `npx playwright install` -- this sandbox already has Chromium preinstalled at
 *   /opt/pw-browsers (see CHROMIUM_PATH below); this script points executablePath there directly
 *   instead of letting Playwright manage/download its own browser copy.
 *
 * USAGE
 * -------
 *   node tests/perf_benchmark.js
 *   node tests/perf_benchmark.js --load-trials=3 --filter-trials=5 --drag-trials=5   (override trial counts)
 *   node tests/perf_benchmark.js --tab=pol_booking       (run the interaction metrics on POL)
 *   BF_APP_HTML=dist/index.html node tests/perf_benchmark.js --tab=pol_booking   (the artifact)
 *
 *   NOTE THE "=" IN EVERY FLAG. The space-separated form (`--load-trials 15`) is rejected with
 *   an error as of 2026-09-21; it used to be silently ignored, so the run quietly used default
 *   trial counts while printing what looked like a 15-trial result.
 *
 *   --settle-quiet=N tunes how long a burst must be commit-free before it counts as settled
 *   (default 5000ms). It is deliberately large: POL's deferred render lands ~3.3s after the
 *   click's first commit, so a short window reports the interaction as finished before the
 *   table has started. See the SETTLE_QUIET_MS comment for the measured commit offsets.
 *
 *   --tab= accepts the app's own internal tab keys: detail (default, the tab the app opens on),
 *   pol_booking, trade_summary, sector_summary, compare. LOAD always measures the default tab
 *   regardless, so its numbers stay comparable across --tab runs; only metrics 2, 2b and 3 move.
 *   Metrics whose control is not rendered on the chosen tab SKIP with a printed reason.
 *
 *   WHY --tab EXISTS: until 2026-09-21 every metric here ran on whichever tab the app opened
 *   on, so POL Booking Flash -- the tab reported as worst -- had no coverage at all, and a
 *   slicer click that froze POL for up to 3.8s measured a healthy ~70ms on Detail. See
 *   PERFORMANCE_REVIEW.md's pass-2 section.
 *
 * Exit code 0 on a completed run (this is a measurement tool, not a pass/fail gate -- there is
 * no "correct" number to assert against, only a baseline to compare a later run to), 1 if the
 * harness itself failed to complete (missing Chromium, can't reach the CDN to seed the vendor
 * cache on first run, etc).
 *
 * ---------------------------------------------------------------------------------------------
 * RECORDED BASELINE -- unmodified v1.66, run 2026-09-10 in this sandbox against
 * `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` (6,453 lines) at git commit `13c5ee1`
 * ("Add the performance & correctness review plan for v1.66", branch
 * `claude/pensive-noether-szxhhw` -- the plan-of-record commit every workstream's diff is meant
 * to apply on top of; verify your own worktree is actually based here before trusting any
 * baseline in this file, the same lesson as this file's own ROW COUNT note above). See this
 * run's own printed "sandbox" line for CPU count -- re-run and compare spread, not just the
 * median, before concluding any later change is a real win or regression:
 *
 *   LOAD    (n=5): median 5765ms  (min 5278 / max 6200, spread 16% of median)
 *             xlsxReadMs  median 1559ms  (min 1352 / max 2168, spread 52% -- the noisiest of
 *                         the sub-measurements; SheetJS's own parse of an 8,769x98 sheet is
 *                         apparently more sensitive to this sandbox's scheduling jitter than
 *                         the getVal() loop is, plausibly because it's the more allocation-heavy
 *                         of the two -- treat single-digit-percent deltas on this sub-metric
 *                         specifically as noise, not signal)
 *             mapMs       median 4032ms (min 3926 / max 4206, spread 7%)   <- F1's real target;
 *                         ~70% of total LOAD time, the dominant cost exactly as F1 predicts
 *   FILTER  keystroke (n=7): median 358ms, 1 commit/keystroke (min 338 / max 390, spread 15%)
 *           slicer-click "AW" (n=7): median 139ms, 1 commit (min 129 / max 159, spread 22%) --
 *           notably ~2.6x FASTER than the keystroke trigger despite hitting the identical F3
 *           memo; plausible explanation is the keystroke path's `pressSequentially` round-trips
 *           through a real synthetic keyboard event + controlled-input re-render before the
 *           filter-changing state update even fires, which the slicer's plain `.click()` doesn't
 *           -- a real difference worth re-checking after an F3/F4 fix, not assumed away.
 *   DRAG    (n=5, 40 mousemove steps): median 5817ms total, 40 commits (= 40 steps -- F5's exact
 *           "one setState per mousemove, zero coalescing" bug signature), median 145ms/commit
 *           (min 5502 / max 6050ms total, spread 9%) -- by far the most expensive metric here,
 *           consistent with F5+F7 compounding (every mousemove re-renders the entire
 *           un-virtualized table, not just the dragged column)
 *
 * Sandbox for this run: 4 logical CPUs, linux, node v22.22.2 (see the harness's own printed
 * "Sandbox:" line on any run for the numbers that actually matter for interpreting spread).
 *
 * Full numbers (including every individual trial) are in this script's own console output --
 * re-run it and diff the printed JSON summary against a saved copy rather than trusting this
 * comment to stay perfectly in sync with the code (it won't, the same way AGENTS.md's syntax
 * check line didn't -- treat this block as a snapshot of one real run, not a live source of
 * truth; the harness itself is the source of truth).
 * ---------------------------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const http = require('http');

const REPO_ROOT = path.dirname(__dirname);
const TESTS_DIR = __dirname;
const VENDOR_DIR = path.join(TESTS_DIR, 'vendor');
const THROWAWAY_HTML = path.join(TESTS_DIR, '_perf_throwaway_app.html');
const CSV_PATH = path.join(REPO_ROOT, 'Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv');

// Preinstalled Chromium in this sandbox -- see this file's header comment for why we point
// here instead of running `playwright install`. Overridable via env var for a different sandbox.
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// The app's CDN <script src="https://..."> tags are discovered by SCANNING THE LIVE FILE
// itself (extractCdnScriptUrls below), not hardcoded here -- a hardcoded list is exactly the
// class of bug this whole workstream's Deliverable 1 exists to fix (see AGENTS.md's syntax-check
// section), and this app's CDN references have already moved once during this same performance
// pass (the 2026-09-10 xlsx security bump, off cdnjs 0.18.5 onto cdn.sheetjs.com's 0.20.3 --
// see the app's own <head> comment). A future CDN bump therefore needs zero changes here.

// ---- Which tab the interaction metrics run on (--tab=, see parseArgs below) ----
//
// Maps the app's OWN internal tab key (its `activeTab` state values -- grep setActiveTab in the
// app file) to the exact button TEXT its tab bar renders. The mapping has to exist because those
// buttons carry no id, no data attribute and no aria-label; text is the only handle.
//
// MATCH ON EXACT TEXT, NEVER SUBSTRING. The Detail tab's button reads "Booking Flash", which is
// a substring of "POL Booking Flash" -- a substring or hasText match resolves to whichever comes
// first in the DOM and silently benchmarks the wrong tab, reporting plausible numbers for a tab
// you did not ask for. switchToTab() below uses getByRole(..., { exact: true }) for this reason.
const TAB_LABELS = {
    detail: 'Booking Flash',
    pol_booking: 'POL Booking Flash',
    trade_summary: 'Trade Summary',
    sector_summary: 'Sector Summary',
    compare: 'Compare',
};

// ---- CLI args: trial counts, plus --tab= for which tab the interaction metrics run on ----
//
// UNRECOGNIZED ARGUMENTS ARE A HARD ERROR, deliberately. The previous version of this function
// silently ignored anything that did not match its one regex, which made the space-separated
// form a trap: `--load-trials 15` parses as two argv entries, neither of which matched, so the
// run quietly used the DEFAULT trial counts while printing numbers that looked like a 15-trial
// run. That cost a full measurement pass on 2026-09-20 before it was noticed. Only the
// `--flag=value` form is supported; anything else now stops the run and says so.
function parseArgs(argv) {
    const opts = { loadTrials: 5, filterTrials: 7, dragTrials: 5, dragSteps: 40, tab: 'detail', settleQuiet: SETTLE_QUIET_MS };
    const numericKeys = { 'load-trials': 'loadTrials', 'filter-trials': 'filterTrials', 'drag-trials': 'dragTrials', 'drag-steps': 'dragSteps', 'settle-quiet': 'settleQuiet' };
    for (const arg of argv) {
        const m = /^--([\w-]+)=(.+)$/.exec(arg);
        if (!m) {
            throw new Error(`Unrecognized argument "${arg}". Flags must use the --flag=value form (note the "="); the space-separated form is not supported.`);
        }
        const [, name, value] = m;
        if (Object.prototype.hasOwnProperty.call(numericKeys, name)) {
            if (!/^\d+$/.test(value)) throw new Error(`--${name}=${value} must be a whole number.`);
            opts[numericKeys[name]] = parseInt(value, 10);
            continue;
        }
        if (name === 'tab') {
            if (!Object.prototype.hasOwnProperty.call(TAB_LABELS, value)) {
                throw new Error(`--tab=${value} is not a known tab. Known tabs: ${Object.keys(TAB_LABELS).join(', ')}.`);
            }
            opts.tab = value;
            continue;
        }
        throw new Error(`Unrecognized flag --${name}. Supported: ${Object.keys(numericKeys).map((k) => '--' + k + '=N').join(', ')}, --tab=${Object.keys(TAB_LABELS).join('|')}.`);
    }
    return opts;
}

// ---- App-file auto-detection: the rule lives in scripts/lib/app_file.js (the one implementation;
// see the comment there for why it was moved out of this harness and why ties throw). Re-exported
// below so every existing `require('./perf_benchmark.js')` caller keeps working unchanged.
const { APP_HTML_NAME_RE, pickCurrentAppHtml, findCurrentAppHtml } = require('../scripts/lib/app_file.js');

// ---- Shared "which app HTML file to test" resolver: wraps findCurrentAppHtml() above with an
// optional env-var override, so every test script that needs to point at a specific app file
// (instead of always auto-detecting) shares ONE override implementation instead of each
// hand-rolling its own copy. tests/ci_regression_runner.js's BF_APP_HTML handling was the first
// (and, until now, only) of these; tests/perf_highlight_benchmark.js has none at all today even
// though it also tests against an app HTML file -- both are meant to call this instead.
//
// Deliberately does NOT touch findCurrentAppHtml() above, and is not used by
// scripts/build_deployable.js: that script rebuilds the deploy artifact FROM the auto-detected
// source file, never tests against a target, so it must always auto-detect -- honoring an env
// override there would let a stale override redirect the build's own input.
//
// Deliberately adds no logging of its own. The two intended callers want different things:
// tests/ci_regression_runner.js prints one of two specific log-line shapes today
// ("(BF_APP_HTML override: testing ${name})" / "(auto-detected current app version: ${name})")
// that this function must not silently change the wording of, while
// tests/perf_highlight_benchmark.js wants the resolved path with no logging at all. Baking
// either shape in here would force one of the two callers to suppress or fight it, so logging
// stays each caller's own job. (resolveAppHtml itself never logs; the auto-detect path it falls back
// to does print one "(excluded as testing builds: ...)" line when a testing build is skipped.)
//
// Returns the FULL resolved path, same shape as findCurrentAppHtml()'s own return value. A
// caller that also needs the path relative to the repo root (e.g. to build a URL, or to log the
// same value the env var was set to) should use path.relative(REPO_ROOT, resolved) -- NOT
// path.basename(resolved): an override like BF_APP_HTML=dist/index.html must round-trip as
// "dist/index.html", not get flattened to "index.html", or a caller that builds a URL straight
// from it (as tests/ci_regression_runner.js does) would 404 on the subdirectory.
//
// Not the same tool as tests/perf_toggle_benchmark.js's PERF_APP_HTML: that env var takes an
// ARBITRARY absolute path (including files outside the repo, e.g. a before/after snapshot
// written to /tmp), a deliberately different job from this function's repo-relative artifact
// selection -- do not fold the two together.
function resolveAppHtml(envVarName) {
    envVarName = envVarName || 'BF_APP_HTML';
    const override = process.env[envVarName];
    if (!override) {
        return findCurrentAppHtml(); // unset -- auto-detect, unchanged behavior
    }
    if (path.isAbsolute(override)) {
        throw new Error(`${envVarName}=${override} must be relative to the repo root, not absolute (e.g. ${envVarName}=dist/index.html)`);
    }
    const resolved = path.join(REPO_ROOT, override);
    if (!fs.existsSync(resolved)) {
        throw new Error(`${envVarName}=${override} does not exist (expected a path relative to the repo root)`);
    }
    return resolved;
}

// ---- Fetch-once vendor cache (follows redirects; unpkg/cdnjs both 30x to a versioned URL) ----
function fetchUrl(url, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                res.resume();
                resolve(fetchUrl(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
                res.resume();
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// ---- Discover every external <script src="https://..."> tag directly from whatever app HTML
// is currently live, instead of a hardcoded list (see the comment above this file's constants
// section for why that matters here specifically). ----
function extractCdnScriptUrls(html) {
    const urls = [];
    const re = /<script[^>]*\ssrc="(https:\/\/[^"]+)"[^>]*>/g;
    let m;
    while ((m = re.exec(html))) urls.push(m[1]);
    if (urls.length === 0) throw new Error('No external <script src="https://..."> tags found in the app file -- did its <head> structure change?');
    return urls;
}

// Deterministic, filesystem-safe local cache filename derived from the URL itself, so two
// different CDN URLs never collide and a cached file's name always tells you which URL it came
// from (helpful when inspecting tests/vendor/ by hand).
function vendorFileNameFor(url) {
    return url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function ensureVendorFiles(urls) {
    fs.mkdirSync(VENDOR_DIR, { recursive: true });
    const urlToFile = {};
    for (const url of urls) {
        const file = vendorFileNameFor(url);
        const dest = path.join(VENDOR_DIR, file);
        if (!(fs.existsSync(dest) && fs.statSync(dest).size > 0)) {
            console.log(`  fetching ${url} -> tests/vendor/${file} (first run only, cached after)`);
            const body = await fetchUrl(url);
            fs.writeFileSync(dest, body);
        }
        urlToFile[url] = file;
    }
    return urlToFile;
}

// ---- Throwaway HTML copy: same content as the real live app file, only its external CDN
// <script src="https://..."> tags rewritten to the local vendor/ cache. Never touches the real
// file (see this file's header comment for why). ----
function buildThrowawayCopy(appHtmlPath, urlToFile) {
    let html = fs.readFileSync(appHtmlPath, 'utf8');
    for (const [url, file] of Object.entries(urlToFile)) {
        const before = html;
        html = html.split(`src="${url}"`).join(`src="vendor/${file}"`);
        if (html === before) throw new Error(`Expected CDN script tag not found while rewriting (unexpected -- URL was just extracted from this same file): ${url}`);
    }
    fs.writeFileSync(THROWAWAY_HTML, html);
    return THROWAWAY_HTML;
}

// ---- Minimal static file server (no extra deps) rooted at the repo root, so the throwaway
// copy under tests/ can load its sibling vendor/ files by relative path, and so the app is
// served over real HTTP rather than file:// (required -- see AGENTS.md/HANDOFF: file:// blocks
// fetch(), which this app's auto-refresh path uses on mount even though this harness doesn't
// exercise that path). ----
const CONTENT_TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.csv': 'text/csv' };
function startStaticServer(rootDir) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            const filePath = path.join(rootDir, urlPath);
            if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end(); return; }
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

// ---- Init script injected before every page's own scripts run (see header comment's
// "HOW COMMITS AND LIBRARY TIME ARE OBSERVED" section) -- pure test-harness instrumentation,
// zero bytes changed in the app file itself. ----
const INIT_SCRIPT = `
    window.__perf = { commits: [], xlsxReadMs: 0 };
    // React DevTools hook protocol: React's own UMD build looks for this global at load time
    // and calls onCommitFiberRoot after every commit if present. This is the same mechanism
    // the real React DevTools browser extension relies on -- not a hack specific to this file.
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        inject: function () {},
        onCommitFiberRoot: function () { window.__perf.commits.push(performance.now()); },
        onCommitFiberUnmount: function () {},
    };
    // Property-setter trap, TWO LAYERS DEEP -- confirmed necessary by tracing the real
    // xlsx-0.20.3 UMD bundle live rather than assumed: it does "window.XLSX = {}" (an EMPTY
    // object -- read() doesn't exist yet) once near the top, then separately mutates that SAME
    // object in place later ("XLSX.read = function(){...}") once the module body finishes
    // building it. A naive trap that only watches the window.XLSX ASSIGNMENT (layer 1) fires
    // once while .read is still undefined and never fires again, silently recording 0ms for
    // every load -- this is exactly the bug an earlier version of this script had, caught by
    // noticing xlsxReadMs was suspiciously always exactly 0. The fix is a second accessor trap
    // (layer 2), installed on the object itself the moment it's assigned to window.XLSX, that
    // watches for the LATER ".read = ..." property assignment and wraps THAT.
    let _XLSX;
    Object.defineProperty(window, 'XLSX', {
        configurable: true,
        get: function () { return _XLSX; },
        set: function (v) {
            _XLSX = v;
            if (v && !v.__perfTrapped) {
                v.__perfTrapped = true;
                let _read;
                Object.defineProperty(v, 'read', {
                    configurable: true,
                    get: function () { return _read; },
                    set: function (fn) {
                        _read = function () {
                            const t0 = performance.now();
                            const result = fn.apply(this, arguments);
                            window.__perf.xlsxReadMs += (performance.now() - t0);
                            return result;
                        };
                    },
                });
            }
        },
    });
`;

// ---- Stats helpers ----
function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function summarize(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const med = median(s);
    const spread = s[s.length - 1] - s[0];
    return { n: s.length, median: Math.round(med * 10) / 10, min: Math.round(s[0] * 10) / 10, max: Math.round(s[s.length - 1] * 10) / 10, spreadPctOfMedian: med > 0 ? Math.round((spread / med) * 1000) / 10 : 0, samples: s.map((v) => Math.round(v * 10) / 10) };
}

// ---- Metric 1: LOAD/PARSE -- fresh browser context per trial (cold, like a real first open) ----
async function measureLoad(chromium, appUrl) {
    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(INIT_SCRIPT);
        await page.goto(appUrl, { waitUntil: 'load' });
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached' });

        await page.evaluate(() => { window.__perf.loadStart = performance.now(); });
        await fileInput.setInputFiles(CSV_PATH);
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, undefined, { timeout: 30000 });
        const result = await page.evaluate(() => ({
            totalMs: performance.now() - window.__perf.loadStart,
            xlsxReadMs: window.__perf.xlsxReadMs,
            rowCount: document.querySelectorAll('tbody tr').length,
        }));
        await context.close();
        return result;
    } finally {
        await browser.close();
    }
}

// ---- Tab switching for the interaction metrics (--tab=, default 'detail') ----
//
// Added 2026-09-21. Before this, every metric in this file ran on whatever tab the app opens on
// by itself ('detail'), and there was no way to point it anywhere else -- so POL Booking Flash,
// the tab actually reported as worst, had ZERO coverage. That gap hid a real defect: a slicer
// click on POL was freezing for up to 3.8s (bimodal, see PERFORMANCE_REVIEW.md's pass-2
// section) while the very same click measured ~70ms on Detail, so this harness reported a
// healthy app for the exact interaction being complained about.
//
// Do not delete this flag without replacing the coverage. The pass-2 slicer deferral has no
// other regression guard: revert it and every other check in this repo still passes green.
async function switchToTab(page, tabKey) {
    const label = TAB_LABELS[tabKey];
    const btn = page.getByRole('button', { name: label, exact: true }).first();
    // exact:true is load-bearing -- see TAB_LABELS' own comment. "Booking Flash" (Detail) is a
    // substring of "POL Booking Flash", so a substring match silently benchmarks the wrong tab.
    if ((await btn.count()) === 0) {
        throw new Error(`No tab button with the exact text "${label}" -- has the tab bar been relabeled? Update TAB_LABELS.`);
    }
    await btn.click();
    // Confirm the app actually SWITCHED rather than assuming the click landed. The active tab
    // is styled with the brand pink background (see the app's own tab-bar JSX); that is the only
    // signal the markup offers, since the buttons carry no aria-selected or data attribute. If
    // the styling ever changes this throws instead of quietly measuring the previous tab -- the
    // right failure mode for a harness whose whole job is to be trusted.
    await page.waitForFunction(
        (wanted) => {
            const b = Array.from(document.querySelectorAll('button')).find((el) => el.textContent.trim() === wanted);
            return !!b && b.className.includes('bg-one');
        },
        label,
        { timeout: 30000 },
    );
    await waitForCommitQuiet(page); // POL's first render of 9,232 rows takes seconds; don't time into it
}

// ---- Shared commit-burst timer, used by every interaction metric below ----
//
// Reports TWO numbers per interaction, not one, because `useDeferredValue` (the app's F4 header
// filters and the pass-2 slicer deferral) deliberately splits them apart:
//   - firstCommitMs -- click to the first React commit. What the user perceives as "did the
//     button respond". This is the number the deferral moves, and the number that catches a
//     regression that makes an interaction block again.
//   - settledMs -- click to the LAST commit of the burst. Total work done. Deferral makes this
//     slightly WORSE by design (the approved "button leads the table by a beat" tradeoff), so
//     reporting only this one would read a successful fix as a regression, and reporting only
//     firstCommitMs would hide its cost. Both, always.
//
// This replaces a single `elapsedMs` that was neither: it read the last commit timestamp at
// whatever moment Playwright's polling first observed a non-empty commit list, so its value
// depended on poll timing. Old single-number runs are not comparable to these; re-baseline.
//
// Note the arg-vs-options position in waitForFunction(fn, arg, options). The previous code
// wrote `waitForFunction(fn, { timeout: 5000 })`, which passes the options object as the page
// function's ARGUMENT -- the 5s timeout was never in effect and every wait silently used the
// 30s default. Keep the explicit `undefined` below.
//
// THE QUIET WINDOW HAS TO BE LONGER THAN YOU THINK -- 5s, not the few hundred ms that looks
// obviously sufficient. Measured directly on POL Booking Flash (9,232 rows), the commit
// offsets after one slicer click are:
//
//     [57, 3744, 3772]   [67, 3735, 3793]   [77, 3756, 3794]   (ms after the click)
//
// The deferred render lands roughly 3.3 SECONDS after the first commit -- that gap is the whole
// point of the pass-2 deferral (the button repaints at ~60ms and the table follows later), and
// it is dead silent in between. A 400ms window, which was this file's first attempt, returns at
// ~460ms and reports "settled in 395ms" for an interaction that is genuinely still working
// 3.3s later. Worse, it lets one trial's deferred work land inside the NEXT trial's measurement
// window, which is how that first attempt produced 3-commit trials with impossible timings.
// If you shorten this, re-run the commit-offset probe above on POL first and prove the gap
// closed. Tunable per run with --settle-quiet=N for a tab whose profile differs.
const SETTLE_QUIET_MS = 5000;

let settleQuietMs = SETTLE_QUIET_MS; // overridden by --settle-quiet=N in main()

async function waitForCommitQuiet(page, quietMs = settleQuietMs, timeout = 120000) {
    await page.evaluate(() => { window.__perf.commits.push(performance.now()); }); // floor, so an already-idle page settles immediately
    await page.waitForFunction(
        (q) => {
            const c = window.__perf.commits;
            return c.length > 0 && performance.now() - c[c.length - 1] > q;
        },
        quietMs,
        { timeout },
    );
}

async function timeCommitBurst(page, action, { firstCommitTimeout = 30000, settleTimeout = 120000, quietMs = settleQuietMs } = {}) {
    await page.evaluate(() => { window.__perf.commits = []; window.__perf.t0 = performance.now(); });
    await action();
    await page.waitForFunction(() => window.__perf.commits.length > 0, undefined, { timeout: firstCommitTimeout });
    await page.waitForFunction(
        (q) => {
            const c = window.__perf.commits;
            return c.length > 0 && performance.now() - c[c.length - 1] > q;
        },
        quietMs,
        { timeout: settleTimeout },
    );
    return page.evaluate(() => ({
        firstCommitMs: window.__perf.commits[0] - window.__perf.t0,
        settledMs: window.__perf.commits[window.__perf.commits.length - 1] - window.__perf.t0,
        commits: window.__perf.commits.length,
    }));
}

// ---- Metric 2: FILTER -- reuses one already-loaded page; resets the specific filter it
// exercises between trials so each trial is an independent full recompute, not a no-op.
//
// Both filter metrics SKIP rather than throw when their control is not on the selected tab:
// the header-filter text inputs are per-column, so "Filter by Trade" exists on some tabs and
// not others. A skip prints a reason and leaves the other metrics running; a throw would make
// `--tab=` useless for any tab that does not happen to render every control. ----
async function measureFilterKeystroke(page, trials) {
    const input = page.locator('input[aria-label="Filter by Trade"]').first();
    if ((await input.count()) === 0) {
        return { skipped: true, reason: 'No header-filter input labeled "Filter by Trade" on this tab.' };
    }
    const results = [];
    for (let i = 0; i < trials; i++) {
        await input.fill('');
        await waitForCommitQuiet(page); // let the empty-filter recompute settle before timing the next one
        const r = await timeCommitBurst(page, () => input.pressSequentially('T', { delay: 0 })); // one keystroke -- exactly what F4 targets
        results.push(r);
    }
    await input.fill('');
    return results;
}

async function measureFilterSlicerClick(page, trials) {
    // "AW" is the single most common real "Vessel 1st Sub Trade" value in the checked-in sample
    // CSV (2,454 of 8,769 rows, ~28%) -- a real, high-cardinality filter, not a degenerate
    // all-or-nothing case. This is a SlicerBtn (selectedSubTrades), not the "Trade" column --
    // this app has no Trade slicer button, only a Trade header-filter text input (see
    // measureFilterKeystroke above), confirmed by enumerating the live rendered button list
    // rather than assumed from the CSV's own column names.
    //
    // The slicer panel is shared across tabs (one render site in the app, below the tab bar),
    // so this same button drives the filter on every tab -- which is what makes it a fair
    // cross-tab comparison: identical input, identical memo, only the rendered table differs.
    const btn = page.locator('button', { hasText: /^AW$/ }).first();
    const found = await btn.count();
    if (found === 0) return { skipped: true, reason: 'No slicer button labeled "AW" found -- data file may differ from the expected sample.' };
    const results = [];
    for (let i = 0; i < trials; i++) {
        const pressed = await btn.getAttribute('aria-pressed');
        if (pressed === 'true') { await btn.click(); await waitForCommitQuiet(page); } // start deselected each trial
        const r = await timeCommitBurst(page, () => btn.click());
        results.push(r);
        await btn.click(); // deselect again for the next trial
        await waitForCommitQuiet(page);
    }
    return results;
}

// ---- Metric 3: DRAG -- real Playwright mouse events over a column-resize handle
// ([data-resize-handle="true"]), reproducing F5's exact "unthrottled mousemove -> setState"
// shape from OUTSIDE the app (see header comment). ----
async function measureDrag(page, trials, steps) {
    const handle = page.locator('[data-resize-handle="true"]').first();
    // Skip, don't throw, when the selected tab renders no resizable column at all (the summary
    // tabs do not) -- same reasoning as the filter metrics above. This is NOT the same condition
    // as the bounding-box race documented below, which is a handle that exists and is correct.
    if ((await handle.count()) === 0) {
        return { skipped: true, reason: 'No [data-resize-handle="true"] element on this tab.' };
    }
    // 'visible', not 'attached'. Metric 2b immediately precedes this one on the SAME page and
    // stops as soon as it sees one React commit, so it can hand over while a trailing render
    // is still in flight -- and since the slicer selections became deferred values, there is
    // reliably one more render after the commit 2b waited for. The handle is attached and
    // correct the whole time (probed directly: getBoundingClientRect reports 6x38, the table
    // holds its full 536 rows, and the slicer reads aria-pressed="false"), but Playwright's
    // own boundingBox() returns null for a frame or two during that settle, which made this
    // metric throw "is the detail table rendered?" about a table that was rendered fine.
    // Waiting for visibility plus a short bounded retry below rides that out instead of
    // failing a perf run over a harness race. Do NOT downgrade this back to 'attached'.
    await handle.waitFor({ state: 'visible' });
    const results = [];
    for (let i = 0; i < trials; i++) {
        let box = await handle.boundingBox();
        for (let waited = 0; !box && waited < 2000; waited += 50) {
            await page.waitForTimeout(50);
            box = await handle.boundingBox();
        }
        if (!box) throw new Error('Resize handle still has no bounding box after 2s -- is the detail table rendered?');
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        await page.mouse.move(startX, startY);
        await page.evaluate(() => { window.__perf.commits = []; window.__perf.t0 = performance.now(); });
        await page.mouse.down();
        // steps>1 makes Playwright interpolate and dispatch one real mousemove DOM event per
        // intermediate point -- exactly the "mouse move fires at 60-1000Hz" scenario F5 describes.
        await page.mouse.move(startX + 120, startY, { steps });
        await page.mouse.up();
        const r = await page.evaluate(() => ({
            elapsedMs: performance.now() - window.__perf.t0,
            commits: window.__perf.commits.length,
        }));
        results.push(r);
    }
    return results;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    console.log(`Sandbox: ${os.cpus().length} logical CPU(s), node ${process.version}, platform ${process.platform}`);
    console.log(`Trials: load=${opts.loadTrials} filter=${opts.filterTrials} drag=${opts.dragTrials} (drag steps/trial=${opts.dragSteps})`);
    console.log(`Tab for interaction metrics: ${opts.tab} (settle quiet window ${opts.settleQuiet}ms)\n`);
    settleQuietMs = opts.settleQuiet;

    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch (e) {
        console.error('❌ playwright is not installed. Run `npm install` first (playwright is a devDependency).');
        process.exit(1);
    }
    if (!fs.existsSync(CHROMIUM_PATH)) {
        console.error(`❌ Chromium not found at ${CHROMIUM_PATH}. Set PW_CHROMIUM_PATH if this sandbox's browser lives elsewhere. Do NOT run \`playwright install\` per AGENTS.md.`);
        process.exit(1);
    }
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`❌ Sample data file not found: ${CSV_PATH}`);
        process.exit(1);
    }

    console.log('Preparing vendor cache + throwaway app copy...');
    // resolveAppHtml(), NOT findCurrentAppHtml(): this harness used to call the auto-detector
    // directly, which meant it silently ignored BF_APP_HTML and could only ever benchmark the
    // source file -- never dist/index.html, which is the artifact Apps Script actually serves.
    // The other harnesses already honored the override; this one was the odd one out.
    // path.relative, not path.basename: an override of dist/index.html must round-trip as
    // "dist/index.html", not get flattened to "index.html" (see resolveAppHtml's own comment).
    const appHtmlPath = resolveAppHtml();
    const appHtmlLabel = path.relative(REPO_ROOT, appHtmlPath);
    console.log(`  benchmarking: ${appHtmlLabel}${process.env.BF_APP_HTML ? ' (BF_APP_HTML override)' : ' (auto-detected)'}`);
    console.log(`  interaction metrics run on tab: ${opts.tab} ("${TAB_LABELS[opts.tab]}")`);
    const cdnUrls = extractCdnScriptUrls(fs.readFileSync(appHtmlPath, 'utf8'));
    const urlToFile = await ensureVendorFiles(cdnUrls);
    buildThrowawayCopy(appHtmlPath, urlToFile);

    const server = await startStaticServer(REPO_ROOT);
    const port = server.address().port;
    const appUrl = `http://127.0.0.1:${port}/tests/_perf_throwaway_app.html`;

    // appFile/tab are in the summary so a saved JSON run can never be mistaken for one taken
    // against a different artifact or a different tab -- the two things that silently change
    // what these numbers mean.
    const summary = { appFile: appHtmlLabel, tab: opts.tab, sandbox: { cpus: os.cpus().length, platform: process.platform }, load: null, filterKeystroke: null, filterSlicerClick: null, drag: null };

    try {
        console.log('\n--- Metric 1: LOAD/PARSE (fresh page per trial) ---');
        const loadRuns = [];
        for (let i = 0; i < opts.loadTrials; i++) {
            const r = await measureLoad(chromium, appUrl);
            loadRuns.push(r);
            console.log(`  trial ${i + 1}: total=${r.totalMs.toFixed(1)}ms  xlsxRead=${r.xlsxReadMs.toFixed(1)}ms  mapMs=${(r.totalMs - r.xlsxReadMs).toFixed(1)}ms  rows=${r.rowCount}`);
        }
        summary.load = {
            total: summarize(loadRuns.map((r) => r.totalMs)),
            xlsxReadMs: summarize(loadRuns.map((r) => r.xlsxReadMs)),
            mapMs: summarize(loadRuns.map((r) => r.totalMs - r.xlsxReadMs)),
            rowCount: loadRuns[0].rowCount,
        };
        console.log(`  ✅ LOAD total: median ${summary.load.total.median}ms (spread ${summary.load.total.spreadPctOfMedian}% of median)`);
        console.log(`     mapMs (F1's target): median ${summary.load.mapMs.median}ms  |  xlsxReadMs (library only): median ${summary.load.xlsxReadMs.median}ms`);

        // Filter + drag reuse one loaded page (see header comment on why).
        const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(INIT_SCRIPT);
        await page.goto(appUrl, { waitUntil: 'load' });
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached' });
        await fileInput.setInputFiles(CSV_PATH);
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, undefined, { timeout: 30000 });

        // Switch AFTER the file is loaded, not before: the LOAD metric above deliberately
        // always measures the app's own default tab, so its numbers stay comparable across
        // --tab runs. Only the interaction metrics below move.
        console.log(`\nSwitching to tab: ${opts.tab} ("${TAB_LABELS[opts.tab]}")`);
        await switchToTab(page, opts.tab);

        // Shared reporter for the two commit-burst metrics: both now report first-commit
        // (responsiveness) and settled (total work) rather than one poll-dependent number.
        const reportBurst = (label, runs, unit) => {
            if (runs.skipped) {
                console.log(`  ⏭️  skipped: ${runs.reason}`);
                return runs;
            }
            runs.forEach((r, i) => console.log(`  trial ${i + 1}: firstCommit=${r.firstCommitMs.toFixed(1)}ms  settled=${r.settledMs.toFixed(1)}ms  ${r.commits} commit(s)`));
            const out = {
                firstCommit: summarize(runs.map((r) => r.firstCommitMs)),
                settled: summarize(runs.map((r) => r.settledMs)),
                commits: summarize(runs.map((r) => r.commits)),
            };
            console.log(`  ✅ ${label}: firstCommit median ${out.firstCommit.median}ms | settled median ${out.settled.median}ms | ${out.commits.median} commit(s)/${unit}`);
            return out;
        };

        console.log('\n--- Metric 2: FILTER (header-filter keystroke, forces full 8,769-row recompute) ---');
        summary.filterKeystroke = reportBurst('keystroke', await measureFilterKeystroke(page, opts.filterTrials), 'keystroke');

        console.log('\n--- Metric 2b: FILTER (slicer-button click on "AW", same memo via a different trigger) ---');
        summary.filterSlicerClick = reportBurst('slicer click', await measureFilterSlicerClick(page, opts.filterTrials), 'click');

        console.log(`\n--- Metric 3: DRAG (${opts.dragSteps} real mousemove events over a column-resize handle) ---`);
        const dragRuns = await measureDrag(page, opts.dragTrials, opts.dragSteps);
        if (dragRuns.skipped) {
            console.log(`  ⏭️  skipped: ${dragRuns.reason}`);
            summary.drag = dragRuns;
        } else {
            dragRuns.forEach((r, i) => console.log(`  trial ${i + 1}: total=${r.elapsedMs.toFixed(1)}ms, ${r.commits} commit(s) (${(r.elapsedMs / Math.max(r.commits, 1)).toFixed(1)}ms/commit)`));
            summary.drag = { elapsed: summarize(dragRuns.map((r) => r.elapsedMs)), commits: summarize(dragRuns.map((r) => r.commits)) };
            // Not necessarily "no coalescing" -- the handler under test may already rAF-guard
            // its setState and still show commits == steps on a large table. See this file's
            // own header comment on the DRAG metric (2026-09-21 correction) before diagnosing
            // this shape as an uncoalesced handler.
            console.log(`  ✅ median ${summary.drag.elapsed.median}ms total, ${summary.drag.commits.median} commit(s)`);
        }

        await context.close();
        await browser.close();
    } finally {
        server.close();
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML); // never leave the throwaway copy lying around
    }

    console.log('\n=== JSON SUMMARY (save this to diff against a later run) ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log('\n✅ Benchmark run complete. See this file\'s own header comment for the recorded v1.66 baseline to compare against, and "RESOLUTION LIMITS" before calling any delta a real win.');
}

// Run the full benchmark only when this file is executed directly (`node tests/perf_benchmark.js`).
// The guard exists so tests/perf_toggle_benchmark.js can `require()` the plumbing below --
// app-file auto-detection, the CDN vendor cache, the throwaway-copy builder and the static
// server -- instead of hand-copying it. That detection rule is already duplicated across
// several files by necessity (Python/JS/docs can't share a module without a build step this
// repo doesn't have); two JS harnesses in the same directory CAN share one, and a drifted
// copy of it is a bug this repo has actually shipped before. Running this file directly
// behaves exactly as it did before the guard.
if (require.main === module) {
    main().catch((e) => {
        console.error('❌ Benchmark run failed:', e);
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML);
        process.exit(1);
    });
}

module.exports = {
    APP_HTML_NAME_RE,
    pickCurrentAppHtml,
    findCurrentAppHtml,
    resolveAppHtml,
    ensureVendorFiles,
    extractCdnScriptUrls,
    buildThrowawayCopy,
    startStaticServer,
    median,
    summarize,
    INIT_SCRIPT,
    CHROMIUM_PATH,
    REPO_ROOT,
    TESTS_DIR,
};

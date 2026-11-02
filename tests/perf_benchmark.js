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
 *        - simulated drag: F5's exact bug shape (an unthrottled `window.addEventListener(
 *          'mousemove', ...) -> setState` pair) is reproduced from OUTSIDE the app -- real
 *          Playwright mouse events dispatched over one of the table's own column-resize
 *          handles (`[data-resize-handle="true"]`, e.g. the Detail table's "Trade" column) --
 *          not by calling any internal handler directly, so this keeps working regardless of
 *          which of the app's several resize/drag handlers ends up fixed first. Reports total
 *          wall-clock for the whole drag gesture AND the React commit count it caused (one
 *          commit per mousemove is exactly the bug; a rAF-coalescing fix should collapse many
 *          commits into very few regardless of how many mousemove events fired).
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
 * whichever `Booking_flash_report_na_*.html` is current (auto-detected the same way
 * tests/check_alias_landmines.py does -- see findCurrentAppHtml() below) is written to
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

// ---- CLI args (trial counts only -- everything else is fixed to keep runs comparable) ----
function parseArgs(argv) {
    const opts = { loadTrials: 5, filterTrials: 7, dragTrials: 5, dragSteps: 40 };
    for (const arg of argv) {
        const m = /^--([\w-]+)=(\d+)$/.exec(arg);
        if (!m) continue;
        const key = { 'load-trials': 'loadTrials', 'filter-trials': 'filterTrials', 'drag-trials': 'dragTrials', 'drag-steps': 'dragSteps' }[m[1]];
        if (key) opts[key] = parseInt(m[2], 10);
    }
    return opts;
}

// ---- App-file auto-detection: IDENTICAL algorithm to tests/check_alias_landmines.py's own
// auto-detect (see that script's header comment for the two-naming-era history this must
// match) and to AGENTS.md's syntax-check command -- kept in sync by hand across the 3 places
// since Python/JS/a doc snippet can't share one module without a build step this repo doesn't
// have. If you change the detection rule, change it in all 3. ----
function findCurrentAppHtml() {
    const all = fs.readdirSync(REPO_ROOT)
        .filter((f) => /^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$/.test(f));
    // Exclude testing builds before picking the highest version -- benchmarking the testing
    // build against a baseline recorded on the main file would compare two different apps.
    const excluded = all.filter((f) => /testing/i.test(f));
    if (excluded.length > 0) {
        console.log(`(excluded as testing builds: ${excluded.join(', ')})`);
    }
    const candidates = all.filter((f) => !/testing/i.test(f));
    if (candidates.length === 0) {
        throw new Error(`No main Booking_flash_report_na*.html file found in ${REPO_ROOT}`);
    }
    const versionKey = (fname) => {
        const m = /na_(?:Kevin_)?([\d.]+)_/.exec(fname);
        return m ? m[1].split('.').map(Number) : [0];
    };
    const cmp = (a, b) => {
        const va = versionKey(a), vb = versionKey(b);
        for (let i = 0; i < Math.max(va.length, vb.length); i++) {
            const d = (va[i] || 0) - (vb[i] || 0);
            if (d !== 0) return d;
        }
        return 0;
    };
    return path.join(REPO_ROOT, candidates.sort(cmp).pop());
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
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 30000 });
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

// ---- Metric 2: FILTER -- reuses one already-loaded page; resets the specific filter it
// exercises between trials so each trial is an independent full recompute, not a no-op. ----
async function measureFilterKeystroke(page, trials) {
    const input = page.locator('input[aria-label="Filter by Trade"]');
    const results = [];
    for (let i = 0; i < trials; i++) {
        await input.fill('');
        await page.waitForTimeout(60); // let the empty-filter recompute settle before timing the next one
        await page.evaluate(() => { window.__perf.commits = []; window.__perf.t0 = performance.now(); });
        await input.pressSequentially('T', { delay: 0 }); // one keystroke -- exactly what F4 targets
        await page.waitForFunction(() => window.__perf.commits.length > 0, { timeout: 5000 });
        const r = await page.evaluate(() => ({
            elapsedMs: window.__perf.commits[window.__perf.commits.length - 1] - window.__perf.t0,
            commits: window.__perf.commits.length,
        }));
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
    const btn = page.locator('button', { hasText: /^AW$/ }).first();
    const found = await btn.count();
    if (found === 0) return { skipped: true, reason: 'No slicer button labeled "AW" found -- data file may differ from the expected sample.' };
    const results = [];
    for (let i = 0; i < trials; i++) {
        const pressed = await btn.getAttribute('aria-pressed');
        if (pressed === 'true') { await btn.click(); await page.waitForTimeout(60); } // start deselected each trial
        await page.evaluate(() => { window.__perf.commits = []; window.__perf.t0 = performance.now(); });
        await btn.click();
        await page.waitForFunction(() => window.__perf.commits.length > 0, { timeout: 5000 });
        const r = await page.evaluate(() => ({
            elapsedMs: window.__perf.commits[window.__perf.commits.length - 1] - window.__perf.t0,
            commits: window.__perf.commits.length,
        }));
        results.push(r);
        await btn.click(); // deselect again for the next trial
        await page.waitForTimeout(60);
    }
    return results;
}

// ---- Metric 3: DRAG -- real Playwright mouse events over a column-resize handle
// ([data-resize-handle="true"]), reproducing F5's exact "unthrottled mousemove -> setState"
// shape from OUTSIDE the app (see header comment). ----
async function measureDrag(page, trials, steps) {
    const handle = page.locator('[data-resize-handle="true"]').first();
    await handle.waitFor({ state: 'attached' });
    const results = [];
    for (let i = 0; i < trials; i++) {
        const box = await handle.boundingBox();
        if (!box) throw new Error('Resize handle has no bounding box -- is the detail table rendered?');
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
    console.log(`Trials: load=${opts.loadTrials} filter=${opts.filterTrials} drag=${opts.dragTrials} (drag steps/trial=${opts.dragSteps})\n`);

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
    const appHtmlPath = findCurrentAppHtml();
    console.log(`  benchmarking: ${path.basename(appHtmlPath)}`);
    const cdnUrls = extractCdnScriptUrls(fs.readFileSync(appHtmlPath, 'utf8'));
    const urlToFile = await ensureVendorFiles(cdnUrls);
    buildThrowawayCopy(appHtmlPath, urlToFile);

    const server = await startStaticServer(REPO_ROOT);
    const port = server.address().port;
    const appUrl = `http://127.0.0.1:${port}/tests/_perf_throwaway_app.html`;

    const summary = { appFile: path.basename(appHtmlPath), sandbox: { cpus: os.cpus().length, platform: process.platform }, load: null, filterKeystroke: null, filterSlicerClick: null, drag: null };

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
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 30000 });

        console.log('\n--- Metric 2: FILTER (header-filter keystroke, forces full 8,769-row recompute) ---');
        const keystrokeRuns = await measureFilterKeystroke(page, opts.filterTrials);
        keystrokeRuns.forEach((r, i) => console.log(`  trial ${i + 1}: ${r.elapsedMs.toFixed(1)}ms, ${r.commits} commit(s)`));
        summary.filterKeystroke = { elapsed: summarize(keystrokeRuns.map((r) => r.elapsedMs)), commits: summarize(keystrokeRuns.map((r) => r.commits)) };
        console.log(`  ✅ median ${summary.filterKeystroke.elapsed.median}ms, ${summary.filterKeystroke.commits.median} commit(s)/keystroke`);

        console.log('\n--- Metric 2b: FILTER (slicer-button click on "AW", same memo via a different trigger) ---');
        const slicerRuns = await measureFilterSlicerClick(page, opts.filterTrials);
        if (slicerRuns.skipped) {
            console.log(`  ⏭️  skipped: ${slicerRuns.reason}`);
            summary.filterSlicerClick = slicerRuns;
        } else {
            slicerRuns.forEach((r, i) => console.log(`  trial ${i + 1}: ${r.elapsedMs.toFixed(1)}ms, ${r.commits} commit(s)`));
            summary.filterSlicerClick = { elapsed: summarize(slicerRuns.map((r) => r.elapsedMs)), commits: summarize(slicerRuns.map((r) => r.commits)) };
            console.log(`  ✅ median ${summary.filterSlicerClick.elapsed.median}ms, ${summary.filterSlicerClick.commits.median} commit(s)/click`);
        }

        console.log(`\n--- Metric 3: DRAG (${opts.dragSteps} real mousemove events over a column-resize handle) ---`);
        const dragRuns = await measureDrag(page, opts.dragTrials, opts.dragSteps);
        dragRuns.forEach((r, i) => console.log(`  trial ${i + 1}: total=${r.elapsedMs.toFixed(1)}ms, ${r.commits} commit(s) (${(r.elapsedMs / Math.max(r.commits, 1)).toFixed(1)}ms/commit)`));
        summary.drag = { elapsed: summarize(dragRuns.map((r) => r.elapsedMs)), commits: summarize(dragRuns.map((r) => r.commits)) };
        console.log(`  ✅ median ${summary.drag.elapsed.median}ms total, ${summary.drag.commits.median} commit(s) (bug signature: commits ≈ steps means one setState per mousemove, no coalescing)`);

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
    findCurrentAppHtml,
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

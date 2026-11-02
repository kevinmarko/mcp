#!/usr/bin/env node
/**
 * CI driver for tests/booking_flash_regression_tests.js -- serves the current app over local
 * HTTP, drives a real headless Chromium (Playwright) through a file upload exactly like
 * HANDOFF.md's "Live-testing method" and AGENTS.md's check 4 describe, injects the regression
 * suite, and reports its result with a process exit code.
 *
 * THE SOURCE RUN IS NON-BLOCKING BY DESIGN (the `dist/index.html` run, BF_APP_HTML=dist/index.html, BLOCKS; see
 * scripts/run_ci_locally.js, where the source run is marked informational). AGENTS.md's
 * own "Known flakiness" section documents that running the *entire* suite in one long automated
 * script has intermittently produced spurious failures in this project's own sandbox (a "Setup:
 * table/modal found" check failing right after a tab switch or modal close/open) -- that is
 * exactly the shape of run this script performs unattended. A red run here is a signal to
 * investigate by hand (per AGENTS.md's two-bucket flakiness rule), not proof by itself that a
 * change is broken -- so it must not block a merge on its own. Checks 1-3 (syntax, alias
 * landmines, timezone safety) are the deterministic, blocking CI gates; this one is advisory.
 *
 * Pins the Sector Summary data source to the committed fixture (tests/fixtures/sector_data_
 * 2026-09-16.csv) and the Historical Data archive to tests/fixtures/historical_data_2026-08-24_
 * to_2026-08-26.csv, exactly as documented in AGENTS.md check 4, so both suites' extra
 * ground-truth checks run and CI never depends on either live published Google Sheet -- in
 * particular, pinning Historical Data eliminates that suite's own wait-timeout race (8s
 * originally, raised to 30s the same day a separate change made the archive's fetch+parse
 * lazy/click-triggered instead of eager-on-mount -- see AGENTS.md/HANDOFF.md's 2026-09-16
 * "reachable-but-slow" writeup) against a real, possibly-slow archive response.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const util = require('util');

const REPO_ROOT = path.dirname(__dirname);
const SAMPLE_XLSX = path.join(REPO_ROOT, 'Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx');
const LIVE_CSV_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'live_csv_2026-08-12.csv');
const SECTOR_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'sector_data_2026-09-16.csv');
const HISTORICAL_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'historical_data_2026-08-24_to_2026-08-26.csv');
const REGRESSION_SUITE = path.join(REPO_ROOT, 'tests', 'booking_flash_regression_tests.js');
// Matches the CSV_SOURCE_URL / SECTOR_DATA_CSV_URL / HISTORICAL_DATA_CSV_URL fetches the app
// makes -- the same fragments AGENTS.md's check 4 documents pinning against. Every live
// Google Sheet the app reads is pinned; none of the three is left to the network.
const LIVE_CSV_URL_FRAGMENT = '2PACX-1vQNykGT8bYqwDC4k9loE5L8';
const SECTOR_URL_FRAGMENT = '2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS';
const HISTORICAL_URL_FRAGMENT = '2PACX-1vR1YNb3SKa8jS53bK';
// How long main() waits for window.__bfrtLastResult before it gives up on the suite.
//
// This is a HANG DETECTOR, not a performance budget. The suite either finishes or it is stuck (a
// modal that never opens, an await that never settles); a finished run is read the moment it lands,
// so a bigger ceiling costs a healthy run nothing -- it only delays the verdict on a hung one.
// Nothing here measures how fast the suite is, so never tune it to "just above the usual time".
// Pick it from the slowest healthy machine you run on, with headroom.
//
// 180s -> 240s (2026-09-29): Suite 18 (Apps_Script_Team_Features) boots two isolated app instances
// and adds ~35s to a run that already took ~75s locally; the old limit left too little headroom
// for a slower CI runner.
// 2026-10-03: overridable with BF_RESULT_POLL_TIMEOUT_MS (a positive integer, in milliseconds). The
// default stayed 240s, which the compiled dist/ run beats easily (~2.5 min) but the SOURCE run does
// not in a CPU-limited sandbox: it compiles the app in the browser (babel-standalone, ~5 s per load,
// and Suite 18 boots two more copies of it), and took ~7 min. A hard-coded limit made that run fail
// with "did not finish" although nothing was wrong. A bad value (not a whole number, or <= 0) falls
// back to the default with one warning rather than silently disabling the limit.
// 240s -> 1200s (2026-10-11): the 2.5 build's promotion put its ~240 extra checks on the main file and dist/. The 2.5 job had
// always run with BF_RESULT_POLL_TIMEOUT_MS=1200000 for that reason (a hosted runner timed out at 240 s with the suite still
// making progress), so that ceiling is now the default for every run.
const DEFAULT_RESULT_POLL_TIMEOUT_MS = 1200000;
function resolveResultPollTimeoutMs(raw) {
    if (raw === undefined || String(raw).trim() === '') return { ms: DEFAULT_RESULT_POLL_TIMEOUT_MS, overridden: false, warning: null };
    const text = String(raw).trim();
    const ms = Number(text);
    if (/^\d+$/.test(text) && Number.isSafeInteger(ms) && ms > 0) return { ms, overridden: true, warning: null };
    return {
        ms: DEFAULT_RESULT_POLL_TIMEOUT_MS, overridden: false,
        warning: `(ignoring BF_RESULT_POLL_TIMEOUT_MS=${JSON.stringify(text)}: it must be a positive whole number of milliseconds; using the default ${DEFAULT_RESULT_POLL_TIMEOUT_MS}ms)`,
    };
}
const RESULT_POLL = resolveResultPollTimeoutMs(process.env.BF_RESULT_POLL_TIMEOUT_MS);
const RESULT_POLL_TIMEOUT_MS = RESULT_POLL.ms;

// RETIRED 2026-10-11 (D42): there is ONE target now, the production file (and its dist/ copy), and ONE pin, EXPECTED_EXECUTED_CHECKS above.
// There is no TARGETS table, no 'testing-2.5' target and no window.__BFRT_TARGET__ left in the code. Everything from here down to the
// "Throwaway copy" comment is the DATED HISTORY of how the number got here, kept as a record. Read it as history, not as instructions.
//
// TARGETS (wave 3, 2026-10-05): which build of the app a run is testing, and the exact number of checks
// that build must execute. The same suite file tests both; the wave-3 suites (the "data as of" stamp,
// the last-good CSV cache, the feed canary banner) exist only for features that live only in the 2.5
// testing build, so they run only for the 'testing-2.5' target and are counted only there.
//   main         everything that is not the 2.5 testing build: the auto-detected main file (the file
//                scripts/lib/app_file.js picks) and dist/index.html. 369 is the history written above
//                EXPECTED_TOTAL_CHECKS inside main(); it must not move until a main-file suite changes.
//                (It was 325 when this table was written; 347 after main's #162/#167/#180/#181 suites, 348 with
//                #159's check, 356 with Focus_Return on 2026-10-06, 369 after the 2026-10-06 narrow-window batch, 378 with App_Update_Check, 381 with the kept-mounted Booking Flash checks, 385 with the D18 POL-filter checks, 390 with Slicer_Contrast (D28).)
//   testing-2.5  Booking_flash_report_na_2.5_TESTING.html, reached only through BF_APP_HTML (its name
//                contains "TESTING", so scripts/lib/app_file.js deliberately never auto-detects it).
//                = the main count + the wave-3 checks. On a pristine copy of the main file the same number of
//                checks execute (the missing features make them FAIL, they do not make them skip),
//                so a silent skip on this target moves the total and fails the run.
//                490 = 348 + 142: Feed_Stamp 28 (27 checks + its tripwire), Offline_Cache 60 (59 + tripwire), Feed_Canary 24 (23 + tripwire),
//                Phone_Layout 5 (4 + tripwire), Show_In_Table_Phone 6 (5 + tripwire), 2 feed-canary silence checks added to
//                Apps_Script_Team_Features (81 -> 83 on this target only; its tripwire is per target), and 17 "Show in table"
//                checks outside any tripwire: 10 in Analyze_BookingFlash (5 for the button, 5 for its Undo bar), 3 in
//                Analyze_POLBookingFlash (2 for the button, 1 for the Undo bar's Yard-search case) and 4 in Sector_Summary (the
//                button only for a lane that has a row in that tab's table, and pressing it). Those have no tripwire of their own, so this
//                pin is what notices one going missing.
//                (474 before Kevin's 2026-10-06 decisions, measured 451 -> 467 on the pre-landing stack and 490 on main on Show in table and the offline-copy baseline: +4 Analyze_BookingFlash, +1 Sector_Summary,
//                +5 Offline_Cache, +6 Show_In_Table_Phone.)
//                (442 before the slice stack's 2026-10-06 review round: Offline_Cache +8, Feed_Canary +1; 396 on the
//                review-fix branch alone; 384 before the 2026-10-05 review fixes.)
//                451 was the pin while main's pin was 325; main's #162/#167/#180/#181 suites (Analyze +10, Settings_Popover_Layout 8,
//                Historical_Popover_Placement 4: 347 - 325 = 22) also run on this target, so 451 + 22 = 473. The pin was taken from a
//                real run of the merged tree (executed 473, with the per-suite counts this runner prints), not from that sum.
//                #159's phone-slicer check (main 347 -> 348) also runs on this target and passes there, because #171 carries the same
//                `basic-full` fix in the 2.5 file: 473 + 1 = 474, again taken from a real run of the landing tree.
//                516 = 490 + 26 (2026-10-06 follow-up round, after Kevin's decisions above; taken from a real run): the main
//                count +8 (Focus_Return, 7 checks + its tripwire, on both targets), and on this target only Offline_Cache
//                +6 (gap 3, the cached copy on any failed first load; 60 -> 66 with its tripwire), Feed_Canary 24 -> 33
//                (the real-row baseline), and 3 more "Show in table" checks outside any tripwire in Analyze_POLBookingFlash
//                (2 for the "NO N.A. CALL" POL filter off its tab, 1 that a hand-edited POL filter is left alone):
//                490 + 8 + 6 + 9 + 3 = 516. 520 = 516 + 4 (2026-10-06, the offline copy's verdict compares real rows with the healthy
//                entry's own realRows): Offline_Cache 66 -> 70 (a recovery after a truncation that also dropped real rows, real rows
//                collapsing alone against the saved copy, and the OLD-HEALTHY boot's setup + check), taken from a real run. (The round's own branch measured 502 against 474 before Kevin's decisions
//                landed; its Focus_Return_Show_In_Table suite, 2, was dropped with them: the window no longer closes on desktop.)
//                533 after the 2026-10-06 narrow-window batch (+13 on both targets); 542 = 533 + 9 with App_Update_Check (both targets); 545 = 542 + 3 Booking_Flash (kept-mounted table, both targets);
//                555 = 545 + 4 POL_Booking_Flash (D18, both targets) + 6 Offline_Cache (D19 late first reply, testing only).
//                560 = 555 + 5 Slicer_Contrast (D28, both targets).
//                557 = 560 - 4 + 1 (D30, 2026-10-08: the 4 testing-only checks of the "NO N.A. CALL" card's Show in table button went, 1 check that Analyze
//                has no such card was added on both targets; main 390 -> 391).
//                567 = 557 + 10 Cargo_Slicer (D32, 2026-10-08, testing only: 9 checks + its tripwire; main stays 391).
//                569 = 567 + 2 Cargo_Slicer (D32, 2026-10-08, Kevin's answer 2: reefer measured against reefer capacity, with a toggle to the total; 11 checks + its tripwire = 12).
//                589 = 569 + 20 Column_Filters (D33, 2026-10-08, testing only: the Excel-style menu on every filter cell of Booking Flash and POL; 19 checks + its tripwire; main stays 391).
//                606 = 589 + 17 Sector_Cargo (D35, 2026-10-09, testing only: the Dry / Reefer chips on Sector Summary; 16 checks + its tripwire; main stays 391).
//                618 = 606 + 12 Report_Card_Total (D36, 2026-10-09, testing only: the Total row of the Selection Report Card; 11 checks + its tripwire; main stays 391).
//                398 / 624 = 391 / 618 + 7 Sector_Layout on BOTH targets (D37, 2026-10-09: 6 checks + its tripwire, the real two-header sector Sheet read by the app and a Sheet
//                with unrecognised headings reported in a banner; the fix is in the production file), and on testing-2.5 only Sector_Cargo 17 -> 16 (D37: the Dry / Reefer chips now
//                follow the real Sheet's DRY and RFR blocks; the 6 checks on the invented tall-layout Sheet became 5 on the real one, and the "other names for the cargo column"
//                check went with that layout: 618 + 7 - 1 = 624). Taken from real runs of both targets.
//                635 = 624 + 11 POL_Vvd_Order (D39, 2026-10-09, testing only: POL Booking Flash keeps a vessel's legs together inside a lane's week, vessels in order of their first sailing; 10 checks + its tripwire; main stays 391).
//                405 / 642 = 398 / 635 + 7 Quick_Filter_Shown on BOTH targets (D40, 2026-10-09: the quick boxes on the 32 computed columns; 6 checks + its tripwire; the fix is in the production file and ported). Taken from real runs of both targets.
//                765 = 726 + 37 Column_Picker (D60, 2026-10-15: the Fields picker lists and hides every column of Booking Flash and POL Booking Flash, and POL windowing survives hidden columns; 36 checks + its tripwire) + 2 Pinned_Borders
//                (D61: one check per tab, in Booking_Flash and POL_Booking_Flash, that the pinned body cells keep their ::before grid-line border). Both targets.
//                770 = 765 + 5 Column_Picker (D62, 2026-10-15: hiding is per tab, so 37 -> 42: a first-version blob read as both tabs, independence in each direction, the shared group's switch-off timing and the Report Card on each tab; 41 checks + its tripwire).
//                792 = 770 + 22 Vvd_Finder (D63, 2026-10-21: Settings > "Find a vessel", the Setup fixtures record + 20 checks + its tripwire (the first run measured 792, not 791: the Setup record counts): the section folded by default and remembered, a real voyage found in both places, a search that changes nothing on screen, a voyage the Sheet gained / lost / never had, a typo's suggestion, an unreachable or sign-in-page Sheet, newer Max Laden, the four Max Laden outcomes on real voyages, a Lane slicer and a column filter box each named as what hides a voyage, VMS refused, an uploaded file not given "Refresh Now" advice, a 390 px phone). Both runs.
//                798 = 792 + 6 Vvd_Finder (D63 follow-up, 2026-10-21: the opt-in Historical archive search: 28 records, up from 22: a voyage the Sheet lost is "missing since" from one archive download and a new search clears it, a voyage archived on two days incl. a quoted multi-line record, a voyage never archived, Max Laden blank on one archived day, the per-day archive through the fake server (1 index call, 3 day downloads, no Sheet download), and a failing day said with its reason with a working retry). Both runs.
//                808 = 798 + 10 Vvd_Finder (D63 review fixes, 2026-10-21, after an independent read of the diff: 38 records, up from 28: Max Laden read the way the report reads it (an older column filled while Update is blank), the archive offered only for a whole VVD and stopped by a hit budget, the archive button off during a newer search, one failing day ending the search and naming the day, a sign-in-page day an error, ad-hoc lanes not counted missing, report-only on an uploaded file neutral, and the Refresh Now wording inside Apps Script with the shared copy; 10 new checks). Both targets.
//                811 = 808 + 3 (D64, 2026-10-22: heavier vertical borders on the pinned block and the date columns, and no vertical lines in POL's blank spacer rows: +1 POL_Booking_Flash and +1 Booking_Flash `checkHeavyBorders`, +1 POL_Booking_Flash `checkSpacerNoOverlay`; `checkPinnedBorders` now expects each pinned cell's overlay weight, count unchanged). Both targets.
//                812 = 811 + 1 (D64 follow-up, 2026-10-23: Booking Flash's blank rows lose their vertical lines too, like POL's; `checkSpacerNoOverlay` now runs on both tabs: +1 Booking_Flash). Both targets.
//                814 = 812 + 2 (D65, 2026-10-26: Settings gets "Tools" (Feeder Flash and Bottleneck Historical links) and takes over "Upload File" from the top bar: +2 Settings_Folded_Layout, one for Upload File's move and one for the Tools list; two existing steps there also got stricter without a new record). Both runs.
//                843 = 814 + 29 Column_Order (D67, 2026-10-26: dragging the column headers of Booking Flash and POL Booking Flash into any order; 28 checks + its tripwire: the header contract per tab, forward / backward / both-halves / edge / block moves per tab with the whole head and every row shape graded against the default order, the drop marks, ignored gestures, filter boxes and resize handles never dragging, the filter boxes following their columns, the saved bookingFlashColumnOrder, per-tab independence in each direction, a reload, a damaged blob, Freeze Panes showing the default order, hiding and showing columns, the Excel sheet, the Reset column order button and the restored state). Both runs.
//                844 = 843 + 1 (D69, 2026-10-28: "Last Refresh" moved from the masthead into the Settings footer and the masthead gained the decorative doodle band: +1 Settings_Folded_Layout: the move, the 1500px background wiring and no stacking context). Both targets.
// (Until 2026-10-11 the runner told the page which target it was, through window.__BFRT_TARGET__, and failed when the page
// reported a different one; that went with the second target.)
// 2026-10-11: the 2.5 testing build was PROMOTED to production (Kevin), so there is one target again: the main file and
// dist/index.html run every suite above, and the pin is the number the 'testing-2.5' target had (642, the last real run of each
// target: main 405, testing-2.5 642). The two-target history above is kept as the record of how the number got here; from now on
// a change to the count is written next to EXPECTED_TOTAL_CHECKS in main().
const EXPECTED_EXECUTED_CHECKS = 998;
// SHARDS (2026-10-29, gate speed). One page ran the 48 suites one after another for about 12.5 minutes, on one core of a machine that
// has ten, and the gate ran that twice (source, then dist/). The suite file is unchanged and still runs every suite in one page when
// pasted into a console. Here each suite block (every `await (async function name() {` line at the suite file's top level) is held to
// one shard: the runner adds, on that same line, an early return when the suite is not in the shard it is building, and runs the
// shards at the same time, each in its own browser with its own clean storage and its own upload of the sample file. Every check
// still runs exactly once: the shards partition the suites, every record() call lives inside a suite block (only helpers and the
// clear-filters / reset-Fields preamble sit outside them, and the preamble records nothing), and the merged count is held to the
// same EXPECTED_EXECUTED_CHECKS, so a suite that ran twice or not at all fails the run.
//
// SHARD_TABLE names the suites of every shard but the last, by function name; the last shard runs every suite not named, so a new
// suite lands there with nothing to edit. Balanced on the per-suite times this runner prints (2026-10-29, dist/: Column_Picker
// 227 s, Column_Order 128 s, Quick_Filter_Shown 55 s, Offline_Cache 42 s, Column_Filters 34 s, everything else about 275 s).
// A name here that the suite file no longer has stops the run (a renamed suite would otherwise move silently).
// BF_REGRESSION_SHARDS=1 runs every suite in one page, as before 2026-10-29 (for triage: a check that fails only when sharded is
// leaning on state an earlier suite left behind, which is a bug in that check). Any other value uses the table.
const SHARD_TABLE = [
    ['columnPickerSuite'],
    ['columnOrderSuite', 'quickFilterShownSuite', 'offlineCacheSuite', 'columnFiltersSuite'],
];
const REGRESSION_SHARDS = String(process.env.BF_REGRESSION_SHARDS || '').trim() === '1' ? 1 : SHARD_TABLE.length + 1;
const SUITE_OPENER = /^ {4}await \(async function ([A-Za-z0-9_]+)\(\) \{$/gm;
function planShards(src, shards) {
    const names = Array.from(src.matchAll(SUITE_OPENER), (m) => m[1]);
    if (shards === 1) return [{ label: '1/1', suites: names, src }];
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) throw new Error(`two suites are both called ${dup}; sharding needs unique suite function names`);
    const named = [].concat(...SHARD_TABLE);
    const missing = named.filter((n) => !names.includes(n));
    if (missing.length) throw new Error(`SHARD_TABLE names suites the suite file does not have: ${missing.join(', ')} (renamed or removed? update SHARD_TABLE in tests/ci_regression_runner.js)`);
    const groups = SHARD_TABLE.map((g) => names.filter((n) => g.includes(n))).concat([names.filter((n) => !named.includes(n))]);
    return groups.map((suites, i) => ({
        label: `${i + 1}/${groups.length}`,
        suites,
        // Same line, so line numbers in a stack trace still match the file.
        src: src.replace(SUITE_OPENER, (line, name) => `${line} if (!${JSON.stringify(suites)}.includes(${JSON.stringify(name)})) return;`),
    }));
}
// Throwaway copy written only when BF_VENDOR_CDN=1 (see main()); always deleted again in the
// finally below, so a crashed run cannot leave a stale build lying around for the next one to
// pick up -- the app-file auto-detect deliberately ignores it, but a human reading `ls tests/`
// should not find a mystery HTML file either.
//
// The name MUST contain "throwaway": .gitignore's `tests/_*throwaway*.html` glob exists
// precisely so a crashed run cannot leave one staged by accident, and an earlier revision of
// this line called the file `_ci_regression_vendored_app.html` -- which matched no glob, so a
// `git add -A` while a run was in flight committed all 10,712 lines of generated app to the
// repo. The glob has since been widened to `tests/_*.html` as well, but keep the convention.
//
// One name PER PROCESS AND TARGET (2026-10-06): it used to be one fixed name, so two runners started at once (a source run
// and a control run, say) overwrote each other's copy and both tested whichever was written last. The pid keeps parallel
// runs apart; the file name in it says which build a leftover copy was. Set in main() once the file is known.
const vendoredAppPath = (label) => path.join(REPO_ROOT, 'tests', `_ci_regression_throwaway_app_${String(label).replace(/[^A-Za-z0-9.-]/g, '_')}_${process.pid}.html`);
let VENDORED_APP = null;

// ---- Minimal static file server rooted at the repo root (same approach as tests/
// perf_benchmark.js's startStaticServer) -- serves the real app file over real HTTP, never
// file:// (this app's auto-refresh path calls fetch() on mount, which file:// blocks). ----
const CONTENT_TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.csv': 'text/csv', '.json': 'application/json' };
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

async function main() {
    // Printed first, once, so a typo in the variable is visible at the top of the log and not only
    // after minutes of waiting (the value is read at load time, see RESULT_POLL above).
    if (RESULT_POLL.warning) console.warn(RESULT_POLL.warning);
    else if (RESULT_POLL.overridden) console.log(`(BF_RESULT_POLL_TIMEOUT_MS override: waiting up to ${RESULT_POLL_TIMEOUT_MS}ms for the suite)`);

    // Shared with tests/perf_benchmark.js's own callers (see that file's require below, which
    // also pulls in ensureVendorFiles/extractCdnScriptUrls for the BF_VENDOR_CDN path further
    // down) -- one require for the whole module instead of a second copy of this line.
    const { resolveAppHtml, ensureVendorFiles, extractCdnScriptUrls } = require('./perf_benchmark.js');

    // BF_APP_HTML points the suite at a specific file instead of the auto-detected main one,
    // as a repo-root-relative path. It exists for the precompiled deploy artifact
    // (BF_APP_HTML=dist/index.html), which is the file production actually serves but which
    // deliberately does NOT live in the repo root and so is invisible to findCurrentAppHtml.
    // Verifying the artifact matters more than verifying the source it was built from: the
    // artifact is what users load, and a build bug would otherwise reach production with a
    // fully green suite behind it. Unset by default, so normal runs are unchanged.
    //
    // The override/validation/auto-detect-fallback logic itself now lives in
    // tests/perf_benchmark.js's resolveAppHtml() (shared with tests/perf_highlight_benchmark.js) --
    // including the "must be relative to the repo root" and "does not exist" errors, which
    // resolveAppHtml() throws directly, so they propagate out of this function unchanged. This
    // file's own job is just picking which of its two log-line shapes to print, and converting
    // the FULL path resolveAppHtml() returns back into the repo-root-relative string the rest of
    // this file uses as appHtmlName -- via path.relative, never path.basename, so a subdirectory
    // override like dist/index.html round-trips intact instead of being flattened to index.html
    // (appHtmlName is later used both as a filesystem path segment and, directly, as a URL path
    // segment for appPathForUrl/appUrl below).
    const appHtmlName = path.relative(REPO_ROOT, resolveAppHtml());
    if (process.env.BF_APP_HTML) {
        console.log(`(BF_APP_HTML override: testing ${appHtmlName})`);
    } else {
        console.log(`(auto-detected current app version: ${appHtmlName})`);
    }
    // Printed up front so the log says what was tested and against which pin even if the run dies before the summary.
    console.log(`Executed-check count pinned for ${appHtmlName}: ${EXPECTED_EXECUTED_CHECKS}`);

    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch (e) {
        console.error('playwright is not installed -- run `npm ci` (and `npx playwright install chromium`) first.');
        process.exitCode = 1;
        return;
    }

    const server = await startStaticServer(REPO_ROOT);
    const { port } = server.address();

    // BF_VENDOR_CDN=1 serves a throwaway copy of the app whose CDN <script src> tags point at
    // tests/vendor/ instead. Off by default, so CI keeps loading the real CDNs and keeps testing
    // what production actually loads.
    //
    // It exists because this script could not be run at all in the agent sandbox this repo is
    // developed in: that sandbox reaches the network only through a TLS-intercepting proxy the
    // browser does not trust, so every CDN tag fails with ERR_CERT_AUTHORITY_INVALID, `tailwind
    // is not defined` throws at the app's own config script, and the run dies before the suite is
    // ever injected. AGENTS.md check 4 has prescribed exactly this workaround in prose the whole
    // time ("swap the <script src=...> tags in a throwaway copy"); every agent was re-implementing
    // it by hand in an untracked file. tests/perf_benchmark.js already had the implementation, so
    // this imports it rather than adding an eighth copy of anything -- see the seven-copies
    // warning in AGENTS.md check 1.
    //
    // This is the mirror image of the bug fixed in tests/perf_highlight_benchmark.js (bf6d15a),
    // which hardcoded the sandbox's own browser path and so worked in the sandbox but not in CI.
    // Called out in that file's comment as "worth fixing the same way"; this is that fix.
    let appPathForUrl = appHtmlName;
    if (process.env.BF_VENDOR_CDN === '1') {
        let html = fs.readFileSync(path.join(REPO_ROOT, appHtmlName), 'utf8');
        const urlToFile = await ensureVendorFiles(extractCdnScriptUrls(html));
        for (const [url, file] of Object.entries(urlToFile)) {
            const before = html;
            html = html.split(`src="${url}"`).join(`src="vendor/${file}"`);
            if (html === before) throw new Error(`BF_VENDOR_CDN: expected CDN script tag not found: ${url}`);
        }
        VENDORED_APP = vendoredAppPath(path.basename(appHtmlName, '.html'));
        fs.writeFileSync(VENDORED_APP, html);
        appPathForUrl = `tests/${path.basename(VENDORED_APP)}`;
        console.log(`(BF_VENDOR_CDN=1: serving ${appPathForUrl} with ${Object.keys(urlToFile).length} CDN tags rewritten to tests/vendor/)`);
    }
    const appUrl = `http://127.0.0.1:${port}/${appPathForUrl}`;
    const liveCsvFixture = fs.readFileSync(LIVE_CSV_FIXTURE, 'utf8');
    const sectorFixtureCsv = fs.readFileSync(SECTOR_FIXTURE, 'utf8');
    const historicalFixtureCsv = fs.readFileSync(HISTORICAL_FIXTURE, 'utf8');
    const suiteSrc = fs.readFileSync(REGRESSION_SUITE, 'utf8');

    // PW_CHROMIUM_PATH overrides the browser binary Playwright launches -- unset by default so
    // CI (which runs `npx playwright install --with-deps chromium` first) uses whatever revision
    // that installs. Some sandboxes ship a pre-installed Chromium at a fixed path whose revision
    // doesn't match this repo's pinned `playwright` package version; point this at it there
    // (same override tests/perf_benchmark.js's CHROMIUM_PATH const supports).
    const launchOpts = { args: ['--no-sandbox'] };
    if (process.env.PW_CHROMIUM_PATH) launchOpts.executablePath = process.env.PW_CHROMIUM_PATH;
    // SHARDS (2026-10-29, gate speed): the suites run in parallel, each shard in its own browser with its own upload of the
    // sample file, and the results are merged and held to the same EXPECTED_EXECUTED_CHECKS. See planShards() above.
    const plan = planShards(suiteSrc, REGRESSION_SHARDS);
    if (plan.length > 1) console.log(`Running the suites in ${plan.length} shards, one browser each: ${plan.map(s => `{${s.label}} ${s.suites.length} suite(s)`).join(', ')}. Lines tagged {n/${plan.length}} come from shard n. BF_REGRESSION_SHARDS=1 runs them all in one page, as before.`);
    const runShard = async (shard) => {
        const tag = plan.length > 1 ? `{${shard.label}} ` : '';
        const log = (...a) => console.log(tag + util.format(...a));
        const logErr = (...a) => console.error(tag + util.format(...a));
        const browser = await chromium.launch(launchOpts);
        try {
            const context = await browser.newContext();
            const page = await context.newPage();
            // Per-suite wall time (2026-10-29, gate speed): the time since the previous record is charged to the suite of the next one, so a
            // suite's setup (boots, reloads, waits) counts against it. Printed after the counts; it measures, it never decides pass or fail.
            const suiteMs = new Map(), recordMs = [];
            let lastRecordAt = null;
            page.on('console', (msg) => {
                const text = msg.text();
                log(`[page:${msg.type()}] ${text}`);
                const m = /^(?:✅ PASS|❌ FAIL) — \[([^\]]+)\] ?([^:]{0,90})/.exec(text);
                if (m && lastRecordAt !== null) {
                    const now = Date.now();
                    suiteMs.set(m[1], (suiteMs.get(m[1]) || 0) + (now - lastRecordAt));
                    recordMs.push([`[${m[1]}] ${m[2]}`, now - lastRecordAt]);
                    lastRecordAt = now;
                }
            });
            page.on('pageerror', (err) => logErr('[page:uncaught]', err));
            // Requests in flight, for the settle wait before the suite is injected (see there).
            const net = { inflight: 0, lastChange: Date.now() };
            const netDone = () => { net.inflight = Math.max(0, net.inflight - 1); net.lastChange = Date.now(); };
            page.on('request', () => { net.inflight++; net.lastChange = Date.now(); });
            page.on('requestfinished', netDone);
            page.on('requestfailed', netDone);

            // Pin the app's PRIMARY data source, CSV_SOURCE_URL, to a committed fixture.
            //
            // This closes a real race, not a theoretical one. The suite uploads
            // Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx and then asserts against ground truth
            // derived from the August reference workbook -- but the app ALSO fetches CSV_SOURCE_URL
            // (a live published Google Sheet) on mount, and applyCsvText commits it with an
            // unconditional setRawRows(). Whether that live response lands before or after the
            // upload decides which dataset the suite ends up measuring:
            //   upload wins -> August data -> Sector_Summary "Class A: Average Max Laden vs Booking"
            //                  matches its ground truth and passes;
            //   live wins   -> today's genuinely-drifted numbers -> the same check fails, with
            //                  nothing wrong in the app.
            // Caught 2026-09-19 the only way a race like this can be caught honestly: one commit
            // (f4263fa) ran the suite twice -- a push run and a pull_request run of the SAME code,
            // concurrently, finishing three seconds apart -- and they disagreed, one green and one
            // red on exactly that check. Re-running would never have settled it, and AGENTS.md had
            // it recorded as a "known open failure" that in fact passes on main. The drift is
            // visible in the record too: the same lane was reported as avgBkg 576 on 2026-09-16 and
            // 561 on 2026-09-19, against a fixed expected 923.
            //
            // This is the identical defect, and the identical fix, applied to the right-hand Sector
            // pivot on 2026-09-16 (see that fixture's own note in booking_flash_regression_tests.js
            // for why pinning the INPUT beats loosening the assertion). The left-hand pivot and the
            // main dataset simply never got the same treatment.
            //
            // The fixture is generated FROM Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx, so both
            // orderings now deliver the same rows and the race stops mattering rather than merely
            // becoming less likely. Verified lossless rather than assumed: the app makes exactly one
            // sheet_to_json({raw:false, defval:''}) pass in parseWorkbookToRows, and running the
            // .xlsx through the upload path (binary read) and the fixture through the live path
            // (string read + raw:true, per applyCsvText) produces byte-identical values for all 964
            // rows x 97 columns -- 0 differences in 93,508 cells, checked with the vendored SheetJS
            // 0.20.3, the same build the browser loads.
            //
            // Trade-off, stated plainly: the suite no longer exercises a real network fetch of the
            // live Sheet. It never asserted anything about that fetch -- the only thing the live
            // path contributed was the "Couldn't load data automatically" banner, which the
            // Historical_Data suite already had to defend against by name because it kept producing
            // false positives. Determinism is worth more here than reaching docs.google.com.
            await page.route((u) => u.href.includes(LIVE_CSV_URL_FRAGMENT), (route) =>
                route.fulfill({ status: 200, contentType: 'text/csv', body: liveCsvFixture }));

            // Pin the Sector Summary source to the committed fixture (AGENTS.md check 4) --
            // must be wired up before navigation so it's in place for the app's own mount-time fetch.
            await page.route((u) => u.href.includes(SECTOR_URL_FRAGMENT), (route) =>
                route.fulfill({ status: 200, contentType: 'text/csv', body: sectorFixtureCsv }));
            await page.addInitScript(() => { window.__BFRT_SECTOR_FIXTURE__ = true; });
            // Same pinning for Historical Data (AGENTS.md check 4) -- also must be wired up before
            // navigation so it's in place for the app's own mount-time fetchHistoricalData() call.
            await page.route((u) => u.href.includes(HISTORICAL_URL_FRAGMENT), (route) =>
                route.fulfill({ status: 200, contentType: 'text/csv', body: historicalFixtureCsv }));
            await page.addInitScript(() => { window.__BFRT_HISTORICAL_FIXTURE__ = true; });

            log(`Loading ${appUrl} ...`);
            await page.goto(appUrl, { waitUntil: 'load' });

            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.waitFor({ state: 'attached' });
            log(`Uploading ${path.basename(SAMPLE_XLSX)} ...`);
            await fileInput.setInputFiles(SAMPLE_XLSX);

            await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 30000 });
            // Let the initial render settle before injecting the suite -- AGENTS.md's live-testing
            // guidance calls for ~1.5-2s here rather than trusting the very first paint. Was a fixed
            // 2000 ms until 2026-10-06, then "until the DOM has had no mutation for 300 ms". A code
            // review (2026-10-07) found that rule can end while a pinned fetch is still in flight: a
            // pending request changes nothing in the DOM. Now BOTH must have held for 300 ms, no DOM
            // mutation and no request in flight (the `net` counter above), with the same 2000 ms
            // ceiling, so it still never waits longer than the original fixed wait.
            await page.evaluate(() => {
                window.__bfrtLastMutation = performance.now();
                window.__bfrtSettleObserver = new MutationObserver(() => { window.__bfrtLastMutation = performance.now(); });
                window.__bfrtSettleObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
            });
            const SETTLE_IDLE_MS = 300, SETTLE_CAP_MS = 2000, settleStart = Date.now();
            let settledIdle = false;
            while (Date.now() - settleStart < SETTLE_CAP_MS) {
                const sinceMutation = await page.evaluate(() => performance.now() - window.__bfrtLastMutation);
                if (net.inflight === 0 && Date.now() - net.lastChange >= SETTLE_IDLE_MS && sinceMutation >= SETTLE_IDLE_MS) { settledIdle = true; break; }
                await new Promise((r) => setTimeout(r, 50));
            }
            await page.evaluate(() => { window.__bfrtSettleObserver.disconnect(); delete window.__bfrtSettleObserver; delete window.__bfrtLastMutation; });
            log(`Settled after ${Date.now() - settleStart} ms (${settledIdle ? 'DOM and network idle' : `ceiling; ${net.inflight} request(s) still in flight`}).`);

            log('Injecting regression suite ...');
            await page.evaluate(() => { window.__bfrtLastResult = null; });
            await page.addScriptTag({ content: shard.src });

            log('Waiting for the suite to finish (self-invokes on injection) ...');
            const start = Date.now();
            lastRecordAt = start;
            let result = null;
            while (Date.now() - start < RESULT_POLL_TIMEOUT_MS) {
                result = await page.evaluate(() => window.__bfrtLastResult);
                if (result !== null) break;
                await new Promise((r) => setTimeout(r, 500));
            }

            if (result === null) {
                logErr(`❌ Suite did not finish within ${RESULT_POLL_TIMEOUT_MS}ms (window.__bfrtLastResult stayed null). A hung suite and a slow machine look the same from here: read the last "[page:log]" line above to see where it stopped, and if it was still making progress, wait longer with BF_RESULT_POLL_TIMEOUT_MS=<ms> (the in-browser-Babel source run can need ~7 minutes in a CPU-limited sandbox).`);
                return null;
            }
            if (result.crashed) {
                logErr(`❌ Suite crashed: ${result.error}`);
                return null;
            }
            return { result, suiteMs, recordMs, ms: Date.now() - start, label: shard.label };
        } finally {
            await browser.close();
        }
    };
    // allSettled, not all: a shard that throws (a page that never loads, say) must not leave its siblings running against a closed server.
    let settled;
    try {
        settled = await Promise.allSettled(plan.map(runShard));
    } finally {
        server.close();
        if (VENDORED_APP && fs.existsSync(VENDORED_APP)) fs.unlinkSync(VENDORED_APP);
    }
    settled.forEach((s, i) => { if (s.status === 'rejected') console.error(`❌ shard ${plan[i].label} crashed:`, s.reason); });
    const outcomes = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
    if (outcomes.some(o => !o)) { process.exitCode = 1; return; }
    // Merged in shard order; within a shard the suites keep the file's order.
    const result = { results: [].concat(...outcomes.map(o => o.result.results)), allPassed: outcomes.every(o => o.result.allPassed) };
    const suiteMs = new Map(), recordMs = [];
    for (const o of outcomes) {
        for (const [s, ms] of o.suiteMs) suiteMs.set(s, (suiteMs.get(s) || 0) + ms);
        recordMs.push(...o.recordMs);
    }
    if (outcomes.length > 1) console.log(`Shard times: ${outcomes.map(o => `{${o.label}} ${(o.ms / 1000).toFixed(0)} s`).join(', ')}`);
    const suiteSeconds = Math.max(...outcomes.map(o => o.ms)) / 1000;

    // EXPECTED_TOTAL_CHECKS is the single source of truth for how many checks this suite
    // should execute. It used to exist only as a number typed into the log string below,
    // which meant it was decorative text that nothing ever compared `total` against --
    // if a refactor broke something upstream (e.g. an isolated-app-instance boot helper
    // shared by Suite 10/12's own runScenario() changed shape and every scenario's own
    // "Setup: isolated app instance mounted" check started failing, short-circuiting each
    // scenario's remaining assertions via an early `return`), `total` could silently drop
    // far below this number while every check that DID execute still passed -- allPassed
    // stays true and this script exits 0, a green run that barely ran anything. That is
    // exactly the failure mode AGENTS.md's "Check the executed-check count, not the pass
    // rate" section documents happening twice already in this repo's history (28/32 misread
    // as a mostly-passing run; a whole 4-check suite silently skipping while the pass RATE
    // improved). Declared once here and reused both in the log line and in the real
    // pass/fail decision below so the two cannot drift apart.
    // 2026-09-24: 77 from Suites 1-9, 42 from Suite 10, 8 from Suite 11, 42 from Suite 12
    // (Filter_Persistence, added 2026-09-24 -- 41 assertions + its own tripwire -- moved the
    // total from 127 to 164). Same day, a code-review pass found and fixed 3 more confirmed
    // bugs in the filter-persistence feature (the wasRestored() banner false-positive, the
    // restore-only hazard rule wrongly applied on the live write path, and the
    // byte-identical-write guard being defeated by its own savedAt timestamp) plus a
    // pre-existing gap (stale multi-select values never pruned once real data loads) --
    // Suite 12 grew from 36 to 41 assertions (37 to 42 with its own tripwire) to cover all
    // four directly, moving the total from 164 to 169. See AGENTS.md check 4's table for the
    // full breakdown and HANDOFF.md's dated addendum for the bug-by-bug writeup.
    // 2026-09-25: 82 from Suites 1-9 -- the POL Booking Flash table is now windowed and
    // Suite 3 gained 5 checks of the windowing itself (mounted < total, spacer height exact,
    // rowSpan column grid, scroll -> row mapping, widths stable), 169 to 174.
    // 2026-09-26: 84 from Suites 1-9 -- a Booking_Flash check that Current Laden Utiliz % is
    // the vessel-level Laden TEU / Max Laden ratio and a Compare check that the Vessels tile
    // excludes the VMS placeholder VVD, both from that day's data-mapping audit, 174 to 176.
    // Then 94: Analyze_BookingFlash and Analyze_POLBookingFlash each gained 5 checks that
    // rebuild every Analyze card from the tab's own table, 176 to 186. Then 95: +1 check that
    // Analyze's default window ends at the current sale week, 186 to 187. Then 97: +2 for the
    // By week / By port peak toggle, 187 to 189. Then 100: +3 Compare checks when its KPI tiles
    // were aligned with the Analyze modal's Overall Snapshot (tiles reconcile; exact fixture
    // values; Compare New == Analyze on the same rows), 189 to 192.
    // 2026-09-28: Suite 13 (renamed VVD_Gmail_Debounce -> Gmail_Search_Debounce) gained 4
    // checks when the click-to-search-Gmail feature was generalized from VVD-only to also
    // cover Vessel Name (a real vessel cell found, clicking it right after the VVD debounce
    // tests still opens Gmail -- proving the shared debounce is keyed on value, not "any
    // prior click" -- the opened URL is correct, and a same-field rapid second click is
    // debounced too), 204 to 208.
    // Same day, two more suites for the server-extras extension (filter-prefs sync, digest
    // recipients, schedule-change digest/snapshot, Export to Drive -- see
    // docs/SERVER_PREFS_CONTRACT.md's "Addendum (2026-09-28)"): Suite 15
    // (Calendar_Event_Link, the "Add to Calendar" deep link -- since 2026-10-01 OPUS_Schedule_Link,
    // the OPUS vessel schedule link) contributes 6, not 5 -- its
    // one data-dependent check (a blank Coastal ETD cell rendering no icon) DOES fire
    // against the committed sample export (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`
    // genuinely contains a row with a blank Coastal ETD), verified live 2026-09-28 against
    // both the source and `dist/index.html`, identically on both. Suite 16
    // (Server_Extras_UI_Gating) contributes 4, not 5 -- its "Setup: ...Settings button
    // found" check only records on the FAILURE branch (same convention as this file's other
    // Setup checks, e.g. OPUS_Schedule_Link's own "Setup: tab button found"), so the happy
    // path is 4 checks (precondition, popover-opened confirmation, digest-input-absent,
    // export-button-absent), not 5. The two miscounts happen to cancel (208 + 6 + 4 = 218,
    // same total a 208 + 5 + 5 guess would have landed on) -- this comment previously stated
    // the wrong 5/5 breakdown for the right total; fixed here to match what was actually
    // verified rather than leave a coincidentally-correct number with incorrect reasoning.
    // 2026-09-29: the schedule-change digest was archived before deploying (see the
    // contract doc's "Archived" section), so Suite 16 no longer checks for the
    // digest-recipients input -- 3 checks, 218 to 217.
    // Then Suite 17 (Historical_PerDay_Archive, 12 -- the Historical Data popover's per-day
    // Apps Script archive over /exec and over google.script.run, its fallback, and the paths
    // rendering identical rows), 229.
    // Then Suite 18 (Apps_Script_Team_Features, 38 -- 37 checks + its own tripwire: the data
    // feed, VVD notes, startup-error log and config-Sheet features that exist only inside Apps
    // Script, run in two isolated iframe boots against a fake google.script.run), 267.
    // Then +3 in Suite 18 from the speed review (notes load waits for the data, an unchanged
    // Refresh Now parses nothing, a direct fallback is never undone by an older server copy), 270.
    // 2026-09-30: +1 Analyze_BookingFlash check that the vessel list has one header for every
    // row -- each added port column named in it, every row spanning exactly its columns -- 271.
    // 2026-10-01: +3 in Suite 18 for public (cut cargo) / private VVD notes -- the editor's
    // default state, a public save after switching, and deleting each kind separately -- 281.
    // 2026-10-02: +2 Analyze_BookingFlash, +1 Analyze_POLBookingFlash for the trend chart's "N vsl"
    // (distinct VVDs per week) and VMS-only weeks keeping their label in line -- 284.
    // 2026-10-02: the Notes dialog now starts on Public (most notes are cut-cargo notes for the
    // team; nobody should save one as private by accident) -- the default-state check was
    // rewritten in place, count unchanged. Same day (code review): the Private -> Public switch
    // check now edits the saved private text first and still expects an empty Public editor, and
    // +1 Suite 18 check that a poll reporting private notes unavailable (and the one restoring
    // them) never wipes text being typed in the Public editor -- 284 to 285.
    // 2026-10-02 (per Kevin): the slicers filter the notes -- +1 Suite 18 check that isolating a Lane
    // narrows the Notes button count and the dialog's list (and "Show all" / clearing restore them) -- 285 to 286.
    // 2026-10-02: +1 Suite 18 check -- the notes dialog shows note times to the minute, never with
    // seconds -- 286 to 287.
    // 2026-10-02 (per Kevin): the notes dialog was reorganized -- +11 Suite 18 checks: notes grouped one
    // group per VVD (newest first, heading click fills the VVD box), the editor/list layout (editor region
    // above a scrolling list), kind order inside a group, kind chips with counts, search, "Clear filters"
    // and the empty state, the age filter, relative times (Today/Yesterday/full date), filters never touching
    // the editor, the Private chip gated on private notes being available, and a Private filter falling
    // back to All when its chip goes away -- 287 to 298. The existing "isolating a Lane" check was
    // updated in place (one heading button per VVD, not per note).
    // 2026-10-02, per Kevin: the service lane after each VVD in the list, and a Lane drop-down narrowing the VVD box's
    // suggestions -- +2 Apps_Script_Team_Features checks (lane in the heading; the drop-down's options, labels,
    // narrowing and restore) -- 298 to 300.
    // 2026-10-02, per Kevin: highlighting a row used to move the whole page (Clear Highlights and Report
    // Card appeared in the masthead and wrapped it). They moved into the floating highlight pill and the
    // table height now re-fits when the masthead changes height -- +4 Booking_Flash checks -- 300 to 304.
    // 2026-10-02, per Kevin: hashtag search in the notes dialog (a "#tag" typed in a note is a button that filters
    // the list, a tag bar of chips sits under the kind / search / age row, the editor hints at tags) -- +16
    // Apps_Script_Team_Features checks: one Setup check plus 15 (placeholder and intro, no bar without tags, a
    // zero-count chip, tags in the list rows, click and aria-pressed, the bar's chips and counts, several tags
    // ANDed, combos with kind / text / age, a private-only tag, the other two places a note's text is shown, the
    // editor's tag line, Clear filters, the editor untouched, the slicers, "Show all N tags") -- 304 to 320.
    // 2026-10-03, code review of that feature (hashtag search): a chip's number now means "notes the list shows
    // after clicking this chip", chips that would list nothing are dimmed, the tag bar is bounded (its chips scroll
    // inside a 96 px box so they can no longer push the note rows out of a short window), tags are Unicode letters
    // (a capital dotted I, accents typed in either composed or decomposed form) and the in-note tag button is a native
    // inline-block button -- +5 Apps_Script_Team_Features checks: what clicking a chip lists (number, title and the
    // rows really listed, over four search-box states), the dimming (judged against what the click really lists, a
    // pressed chip never dimmed), the bounded bar (700 px window, 45 tags, "Show all": bar <= 120 px, chips scroll in
    // their own box, the button stays put, note rows still visible), Unicode tags (#Istanbul, composed and decomposed
    // #cafe as ONE chip) and the in-note button's layout (inline-block, a tag longer than the line wraps in its own
    // box) -- 320 to 325. The 15 older hashtag checks were updated in place (their expected chip numbers are the new
    // meaning), and the stage's wait-for-a-duration sleeps became waits for a condition: it went from ~29 s to ~11 s
    // although it now does more. No other suite changed.
    // 2026-10-05: +6 for Suite 19 (Settings_Popover_Layout), a new suite: the status lines at the bottom of the Settings
    // popover (storage probe, Cloud sync, Data, Config Sheet) inherited the popover's `whitespace-nowrap` and ran past its
    // right edge instead of wrapping. Two Setup checks (the popover opens; the three always-rendered lines are found, so the
    // suite cannot pass by finding nothing) and four layout checks over whichever lines exist (none is nowrap; none overflows
    // its own box; none reaches past the popover's right edge; a ~340-character string with a 120-character unbroken token
    // still wraps onto 2+ lines inside it, for every line) -- 325 to 331. Counted from a real run of the suite against the
    // unfixed `dist/index.html`: 331 executed, the 4 layout checks red, the 2 Setup checks and the other 325 green.
    // 2026-10-05: +10 for the Analyze trend chart's weekly-bar hover cards, 5 in each of Analyze_BookingFlash and
    // Analyze_POLBookingFlash (one shared helper, checkWeeklyBarTooltips): a Setup check (bars found with every week shown),
    // no horizontal overflow at rest and no card in the page, every bar's card inside the modal's visible box and the window
    // and still over its bar, one card at a time and gone on leave, and the card following its bar when the modal scrolls
    // under a stationary pointer -- 331 to 341. Counted from a real run: Analyze_BookingFlash 21 -> 26, Analyze_POLBookingFlash
    // 15 -> 20, no other suite changed.
    // 2026-10-06: +4 for Suite 20 (Historical_Popover_Placement), a new suite: the Historical Data popover is
    // `absolute right-0` under its button, so when a narrow window wraps the button to the left its left edge went
    // off-screen. A Setup check (the popover opens), then three placement checks: in the real window it is on-screen
    // and right-aligned with its button; with the button pushed to the left edge (simulated by shifting the button's
    // wrapper, then a resize event) it is clamped into the window with its close button and mode toggle on-screen;
    // and with the button back it returns to its right-aligned position -- 341 to 345 on main.
    // 2026-10-05 (review fix X13, Settings popover height): +2 Settings_Popover_Layout. On a short (faked) window the
    // popover ends above the window's bottom edge, scrolls inside itself and keeps its Close button on screen and
    // hittable; and resizing the window while it is open re-fits it (shrinks and grows back) -- 341 to 343 on its own branch.
    // Both together: 341 + 4 + 2 = 347.
    // 2026-10-05 (wave 3): the pin became per target (TARGETS above). The history in this comment is the
    // 'main' target's: its number is TARGETS.main.expected (348 with the 2026-10-05 entry for #159 below). The 'testing-2.5'
    // target adds the wave-3 suites on top of the same main suites; their own history is written next to the
    // 'testing-2.5' row's number as it moves.
    // 2026-10-05 (review fix X12, PR #159's phone-width slicer-box fix had no test): +1 Booking_Flash. The filter
    // panel's row is cloned into a 390px iframe carrying the page's generated stylesheet and the slicer box must take
    // the whole line with nothing beside it (it measured ~149px beside the Fields column without `basis-full`) -- 347 to 348
    // with the shared-logic slices below it in the stack (325 to 326 on its own branch).
    // 2026-10-06 (Focus_Return, accessibility): closing a dialog or popover gives keyboard focus back to the control that
    // opened it (Settings and Historical Data by Close and by Escape, the Analysis modal by both close buttons, the vessel
    // list by its X); 7 checks + its tripwire, on both targets -- 348 to 356.
    // 2026-10-06: +13 on BOTH targets for three narrow-window fixes (main 348 -> 361, testing-2.5 474 -> 487, then 490 -> 503
    // after #185's +16, and on top of #189 main 356 -> 369, testing-2.5 520 -> 533; the fixes
    // are ported into the 2.5 file per the features/fixes rule). Booking_Flash +4 (17 -> 21): the floating "N
    // highlighted" pill, measured in a throwaway transformed 320px / 280px box that becomes its containing block (a
    // Setup check proving that, at least 8px each side with label / Report Card / Clear inside the pill, Clear still
    // hit-testable, unchanged one line at 640px and up). Analyze_BookingFlash +2 (26 -> 28) and Analyze_POLBookingFlash
    // +2 (20 -> 22), one shared helper, checkChartColumnsFitModal: the trend chart's section stays inside its box
    // with the modal narrowed to 753 / 560 / 360px, and the modal does not scroll sideways with the MAR lane selected
    // through the Lane slicer. Suite 25 (Narrow_Window_Fit), new, 5: Setup, the Fields picker panel inside an 8px
    // margin with window.innerWidth stubbed to 320 and to 280, the Sales Week / Yard panels inside a 250px filter row,
    // and both Sector Summary pivot panels inside a 300px row. (Written against 02395b6 it also asserted the slicer
    // box itself in a 400px row; on this base that is #159's `basis-full sm:basis-[0%]`, guarded by X12, so it went.)
    // 2026-10-06: +9 on BOTH targets (main 369 -> 378, testing-2.5 533 -> 542), Suite 17b App_Update_Check, new: the
    // version banner's hash comes from google.script.run.getAppVersionHash when google.script.run exists (never a fetch
    // of /exec, which gets a login page under "Execute as: User accessing"), unchanged and changed hash; the
    // ?check=version fetch without google.script.run, unchanged and changed; and a Code.gs without getAppVersionHash
    // switching the check off. 3 Setup + 6 checks, taken from a real run.
    // 2026-10-06: +3 Booking_Flash on BOTH targets (main 378 -> 381, testing-2.5 542 -> 545): the Booking Flash table is kept
    // mounted (the same element after a round trip, hidden + aria-hidden while away), nothing in it takes focus while
    // hidden, and a slicer set on another tab shows in it, row for row, as soon as the tab is back.
    // 2026-10-07: +4 POL_Booking_Flash on BOTH targets (main 381 -> 385, testing-2.5 545 -> 551; per Kevin, D18): a POL value
    // typed by hand narrows POL, does not follow to Booking Flash, is still applied on the way back, and a column both tables
    // show (Service = Lane) still applies on Booking Flash. +6 Offline_Cache on testing-2.5 only (551 -> 555; D19): two
    // "late first reply" boots, 3 records each. Taken from real runs.
    // 2026-10-08: +5 Slicer_Contrast on BOTH targets (main 385 -> 390, testing-2.5 555 -> 560; D28): slicer chip text
    // contrast at rest and faded, light and dark, plus its tripwire. Taken from a real run.
    // 2026-10-08: +1 Analyze_POLBookingFlash on BOTH targets (main 390 -> 391; D30): no "NO N.A. CALL" card in Analyze's Breakdown by POL.
    // -4 on testing-2.5 only (560 -> 556 -> 557 with that +1): the card's Show in table checks (1 in the first guard, 2 in the
    // POL-filter visibility guard, 1 in the hand-edit guard) are gone with the card. Taken from real runs: 391 and 557.
    // 2026-10-08: +10 Cargo_Slicer on testing-2.5 ONLY (557 -> 567; D32): Trade Summary's Dry / Reefer slicer, 9 checks plus its
    // tripwire. It is a feature, so main stays 391. Taken from a real run of the testing build.
    // 2026-10-08, later the same day: +2 Cargo_Slicer on testing-2.5 ONLY (567 -> 569; D32, Kevin's answer 2): the reefer capacity
    // basis (Max Laden row, Utilization) and its toggle. Taken from a real run of the testing build.
    // 2026-10-08, later still: +20 Column_Filters on testing-2.5 ONLY (569 -> 589; D33): the Excel-style column filters on Booking Flash and POL
    // Booking Flash, 19 checks plus its tripwire. 16 were written first (setup, funnels carry no text, shown-text fidelity for every filter
    // column of each table, the operator families, the checklist, POL, nothing else changes, the menu, the bar, scope); the review of the
    // feature then added 3 (keyboard focus in and back, a wildcard pattern built to backtrack, a Values filter keeping values another
    // column's filter hides). It is a feature, so main stays 391. Taken from a real run of the testing build.
    // 2026-10-09: +17 Sector_Cargo on testing-2.5 ONLY (589 -> 606; D35): the Dry / Reefer chips on Sector Summary, 16 checks plus its tripwire
    // (setup, chips and labels, the left table against an independent per-lane ground truth in all three modes, Reefer + Dry = the total,
    // today's sheet unchanged on the right, the caption and the note, then an isolated instance on a SYNTHETIC two-lines-per-POD sheet for the
    // right table, the other names and spellings of the cargo column (Cargo / Cargo Type, RF / RFR / DC / DV), Trade Summary untouched and
    // the choice shared, the chip contract). It is a feature, so main stays 391. Written from the
    // spec before the implementation; the number is confirmed by a real run of the testing build.
    // 2026-10-09: +12 Report_Card_Total on testing-2.5 ONLY (606 -> 618; D36): the Total row of the Selection Report Card, 11 checks plus its tripwire
    // (the row's structure on Booking Flash, the workbook anchors, the per-column oracle, a VMS placeholder adding nothing, one row showing no
    // Total, the CSV / Excel scrape carrying it; then the same on POL Booking Flash with BSA TEU counted once per vessel, a partial selection, and
    // the note). It is a feature, so main stays 391. Written against the real page through a scratch runner, with two fix-removed runs; the number
    // is confirmed by a real run of the testing build.
    // 2026-10-09: +7 Sector_Layout on BOTH targets (main 391 -> 398, testing-2.5 618 -> 624 with the line below; D37): 6 checks plus its tripwire. The Sector
    // Google Sheet became two header rows with DRY and RFR blocks and the app showed an empty table; the suite boots the app on a committed copy of the real
    // Sheet and reads the table (41 PODs, 123 numbers against an independent Python derivation), and on a Sheet with a renamed heading it expects the banner.
    // Run on the UNFIXED production file it failed 6 of 7 (the table had no rows, no banner). On testing-2.5 only, Sector_Cargo went 17 -> 16 (-1): its
    // right-hand checks were rewritten for the real Sheet's blocks and the "other names for the cargo column" check was dropped with the invented layout.
    // 2026-10-09: +11 POL_Vvd_Order on testing-2.5 ONLY (624 -> 635; D39): POL Booking Flash keeps a vessel's legs together inside a lane's sailing
    // week and orders the vessels by their first sailing, so a vessel's legs are never split by another vessel's, 10 checks plus its tripwire. It is
    // a feature, so main stays 391.
    // Taken from a real run of the testing build.
    // 2026-10-11: the 2.5 build was promoted (see EXPECTED_EXECUTED_CHECKS): one target, 642, every suite on the main file and dist/.
    // 2026-10-11 (review fixes, same PR): 642 -> 648. +1 POL_Vvd_Order (a filter that hides a vessel's first leg does not move the vessel),
    // +1 Column_Filters (a Condition and the Values list agree, and OK keeps the Condition), +4 POL_Autofit_Filters (new: 3 checks + its
    // tripwire; widths do not depend on a quick box typed and cleared). Taken from a real run.
    // 2026-10-11 (D44): 648 -> 660. +6 Analyze_BookingFlash and +6 Analyze_POLBookingFlash (one shared helper, checkCardScopesChart): selecting a
    // card in Analyze scopes the trend chart and the four Overall Snapshot tiles to that card's POL / Lane. Per tab: nothing selected is the whole
    // view; the tiles equal the card; the title, badge and note name the card; the chart differs from the whole view; the cards' Max Laden adds up
    // to the whole chart week by week; pressing the card again restores the whole view. Each runs over every card. Taken from a real run.
    // 2026-10-11 (duplicate-check cleanup): 660 -> 657. -3 Sector_Summary (19 -> 16): the roll-up identity check on both pivots (its two sides sum
    // the same leaf array, so it could not fail) and 'Class B fix is not overbroad' (a subset of the 'not stale' check above it). The rewritten OPUS
    // blank-cell check keeps its count. Taken from a real run.
    // 2026-10-11 (D46, the nine findings of the UI code review plus Kevin's scrollbar report, one PR): 657 -> 675.
    // +2 Booking_Flash (Kevin, "the scroll bar has a tendency to disappear" after adding columns: on a short window the
    // table ends inside the window, so its horizontal scrollbar stays reachable),
    // +2 Analyze (finding 1: the table's max-height follows the Undo bar appearing and being dismissed), +1 Offline_Cache
    // (finding 6: the cached-copy line behind an open snapshot), +2 Feed_Canary (finding 2: the dismissal is per problem, not
    // per code), +5 Column_Filters (finding 5: focus or Tab leaving the funnel menu closes it, focus moving inside keeps it
    // open, an Esc elsewhere is not swallowed, Esc inside still closes it), +6 Show_In_Table_Filters (finding 3, new: 5 checks
    // + its tripwire; Show in table clears the filters that would hide the card's sailings and Undo restores them). Findings
    // 7, 8 and 9 change no result; finding 4 was not changed (Kevin: "keep the totals in the export").
    // 2026-10-12: 675 -> 683. +8 Reference_Workbook (new: 7 checks + its tripwire): Trade Summary, Booking Flash and POL Booking
    // Flash compared cell by cell with the values Excel cached in the reference workbook (validation_ground_truth.json), which no
    // check read before. Taken from a real run.
    // 2026-10-12 (D52, the Settings panel rebuilt as Option D): 683 -> 706 (on top of the Reference_Workbook +8 above). +21 Settings_Folded_Layout (new: 20 checks + its tripwire: folded by
    // default, the quick strip, the summaries, conditional rows per tab, the switches, the text-size stepper, the theme, the healthy and the stale
    // footer, Details, remembered across a reload, Excel, the footprint, a 390 px window) and +2 Apps_Script_Team_Features (with config warnings the
    // dot is red and Details are open on arrival; with none they are not). No existing check was dropped: the ones that found Export, Dark or the
    // switches by their visible text now use data-settings-* hooks, with a positive control where they assert that something is absent.
    // 2026-10-13 (Zoom is a layout zoom): 706 -> 708. +2 Zoom_Layout (new, no tripwire: it always records exactly two): zoomed out to 50%,
    // Sector Summary leaves under 200 px blank below its last table (a transform scale left the full page height, about 635 px in this
    // runner's window), and Zoom is back at 100% afterwards. Taken from a real run.
    // 2026-10-13 (D55, Sales Week joins the frozen columns, "(TEU)" on POL's Loadable Quantity header): 708 -> 713. +2 POL_Booking_Flash and
    // +2 Booking_Flash (one Freeze ON and one Freeze OFF check each, from checkSalesWeekFreeze: Sales Week's header, body cells and spacer
    // row sit at the container's left + 225 px after scrolling right and scroll away with Freeze off) and +1 POL_Booking_Flash (the
    // Loadable Quantity header says "(TEU)" and its body cells carry the same data-autofit-col key). checkFreezePins (existing) now also
    // asserts Sales Week and the new offsets (0/75/150/225/305/400) but records the same one check per table. Taken from a real run.
    // 2026-10-13 (D55, the table box measured while the page is scrolled): 713 -> 715. +2 Table_Box_Scrolled_Switch (new, no tripwire: it always
    // records exactly two, one for Booking Flash and one for POL Booking Flash): after Hide Filters, Sector Summary with Show Filters, a 100 px
    // page scroll and a click back, the table box ends inside the window at scroll 0. Taken from a real run.
    // 2026-10-14 (D56, "No sector allocation" placeholder): 715 -> 722. +7 Sector_Alloc_Placeholder (new: 6 checks + its tripwire): the six flagged voyages show the
    // placeholder on every leg on POL Booking Flash and one row each on Booking Flash, the controls stay blank and every other cell keeps the feed's text,
    // the quick filter finds it, and a POL filter does not change the answer. Taken from a real run.
    // 2026-10-14 (D57, the two date columns join the frozen columns): 722 -> 726. +2 POL_Booking_Flash and +2 Booking_Flash (one Freeze ON and one Freeze OFF
    // check each, from checkDateColumnsFreeze: the dates' filter cell, label cell, body cells and spacer row sit at the container's left + 305 px and + 385 px
    // after scrolling right, 80 px wide, no date overflows its cell and no row is taller than with Freeze off; with Freeze off they scroll away).
    // checkFreezePins and checkSalesWeekFreeze (existing) now assert the new offsets (0/75/150/225/305/385/465/560) but record the same checks as before.
    // 2026-10-28 (D70, the voyage-disagreement Details panel): 844 -> 847. +3 Feed_Canary (a live load with one port row of a real voyage on another
    // Sale Week gives exactly VOYAGE_DISAGREEMENT with a collapsed Details button and no panel; Details opens the panel naming the column, both weeks and
    // the changed port row by yard and seq, with no extra list items; a second click closes it). Taken from a real run: Feed_Canary 35 -> 38 with its tripwire.
    // 2026-10-29 (D76, a single click on a VVD / Vessel Name cell selects it, a double-click opens Gmail): 847 -> 859. Gmail_Search_Debounce 9 -> 21 (+12): the suite was
    // rewritten to the new model (single click selects and opens nothing, the row still highlights, a drag across cells still suppresses the toggle, a real
    // click-click-dblclick opens exactly one tab and does not toggle the row, the 800ms debounce, Enter and Space, the new tooltip, the Detail table). Counted by
    // reading the suite's happy path (21 records); the pin must be re-taken from a real run.
    // 2026-10-29 (code review, no decision: two bugs fixed): 859 -> 861. +1 Field_Visibility (the Excel export keeps an accounting negative "(-19)"
    // negative; SheetJS read it as +19) and +1 Quick_Filter_Shown (a box holding only "(" finds Short_Fall's negatives, not every row; tripwire 6 -> 7).
    // Taken from a real run, which also confirmed D76's 859 for the other suites.
    // 2026-10-30 (D82, the what-changed banner): 861 -> 877. +16 What_Changed, new (the Setup records and 13 checks: baseline date,
    // the one removed sailing, Details, Escape, Dismiss, the Settings switch, "no earlier day", "no material change"). Historical_PerDay_Archive
    // and Vvd_Finder's per-day boot switch the banner off for their boots, count unchanged. It lands in the last shard (not in SHARD_TABLE).
    // 2026-10-30 (D84 slice 1-A, R-1, the masthead freshness chip): 877 -> 891. +14 Freshness_Chip, new (the fixtures Setup record, 2 boot
    // Setup records, 10 checks and its tripwire: the server chip and its tooltip, fresh / amber / red text, level and colour, the tick, Last
    // Refresh unchanged beside it, the direct chip, none for a historical snapshot or an upload). It lands in the last shard (not in SHARD_TABLE).
    // 2026-10-30 (D84 slice 1-B, R-2, the threshold-health banner): 891 -> 904. +13 Threshold_Health, new (2 Setup records, 10 checks and its
    // tripwire: the missing count 81, the 7-day change list and its table and note, the POL filter and its clearing, historical, Back to Live,
    // upload, dismissal). It lands in the last shard (not in SHARD_TABLE).
    // 2026-10-30 (D84 slice 1-B review fixes): 904 -> 906. +2 Threshold_Health: the 7-day boundary (which archive days are downloaded) and
    // the baseline-day gap (a change first seen on the first in-window day after a gap is reported).
    // 2026-10-30 (D84 slice 1-C, R-3 and X-3, the row link menu and the ?vvd= link): 906 -> 924. +18 Vvd_Link_Menu, new (the fixtures Setup
    // record, 2 boot Setup records, 14 checks and its tripwire: the buttons and their zero width, the menu from a VVD and a Vessel Name cell, the
    // exact Vessel Planning URL, the disabled item and its tooltip, Search Gmail = the double-click, Copy VVD, no row highlight or Gmail from the
    // button, Escape and focus, ?vvd= on both tables with its bar and Show all, an invalid ?vvd= and a ?view= link). Taken from a real run on
    // dist/index.html. It lands in the last shard (not in SHARD_TABLE).
    // 2026-10-30 (D84 slice 1-C review fix: the mouse never hits the row menu button; right-click opens the menu): 924 -> 928. Vvd_Link_Menu
    // 18 -> 22: elementFromPoint at the end of a pinned VVD and Vessel Name (Freeze ON) and at the next cell's left edge (Freeze OFF) hits the
    // text, a real click there still highlights and a real double-click still searches Gmail, Shift+right-click and other cells are left to the
    // browser, and the keyboard path. Taken from a real run on dist/index.html.
    // 2026-10-31 (D84 slice 2b-1, R-4, the Worklist bar): 928 -> 947. +19 Worklist, new (2 Setup records, 16 checks and its tripwire: the
    // 9-day CSV's pinned findExceptions counts for 2026-09-01, L1 and L2 with the exact copy, no downloads of its own, Escape, 390 px, the
    // click-through, the tables unchanged with it on and off, and L0 for Settings off, What changed off, a historical day, an upload, the
    // basic build and nothing to list). It lands in the last shard (not in SHARD_TABLE).
    // 2026-10-31 (slice 2b-1 review fixes): 947 -> 948. +1 Worklist: a date rollover keeps the open list on screen and open, takes no focus.
    // 2026-10-31 (D85, per Kevin: "Lets move the worklist into settings menu and remove the Flash data chip from the header"): 948 -> 940.
    // Freshness_Chip 14 -> 6 (-8): the chip is gone, so the suite now pins its absence (fixtures Setup, 2 boot Setups, no chip with server
    // and with direct data, Last Refresh unchanged, and its tripwire). Worklist stays 20: rewritten for its new home, the Settings section
    // "Needs attention (N)" (the bar, its Escape-to-bar and its slot checks became the section's placement, Escape closing Settings and
    // no-section checks), the tables-unchanged-on/off checks kept.
    // 2026-10-31 (D85 review): 940 -> 941. +1 Worklist: the Settings footprint with the section present (Settings_Folded_Layout's boot has
    // no archive history, so it never sees it): folded 379 px, capped at 410 (375 plus one folded header, as D63 moved it); all open <= 650.
    // 2026-10-31 (D84 slice 2b-2, R-4, the decision card; merged onto D85): 941 -> 962. +20 Decision_Card, new (3 Setup records, 16 checks
    // and its tripwire: the row menu still three items, the POL row's port, the table's own cells with and without a slicer, empty / save /
    // supersede / stale-supersedes / busy / no identity / fork / text-only reason / failed read, the five declaration states, a VVD with no
    // rows, the tables unchanged before and after (rule 8), 390 px, and the basic build) and +1 Worklist (Decide in the Settings section
    // opens the card on USTIW02; Escape returns focus to the Settings button). It lands in the last shard (not in SHARD_TABLE).
    // 2026-10-31 (D87, per Kevin: the notifications move into the Analyze button's menu): 962 -> 973. +11 Analyze_Menu, new (2 Setup records,
    // 8 checks and its tripwire). What_Changed, Threshold_Health, Worklist, Focus_Return and the Analyze suites only locate the moved banners and
    // the analysis differently (through the menu); their counts are unchanged. It lands in the last shard (not in SHARD_TABLE).
    // 2026-10-31 (D87 review): 973 -> 979. Analyze_Menu 11 -> 17: aria-controls and the announcement, one popover at a time, the fixed badge
    // slot, and a second boot that raises the schedule-change warning (setup, in the menu and counted, Full Details over the menu, dismiss).
    // 2026-10-31 (D88 PROPOSED, D84 slice 2b-3, the threshold-approval screens): 979 -> 993. +14 Threshold_Proposals, new (3 Setup records,
    // 10 checks and its tripwire: the block and its chips, rights for a lead and on an own proposal, approve with and without a reason,
    // reject, a server refusal, stale-supersedes and Refresh, rights off and unconfigured, the tables unchanged, and the basic build).
    // 2026-10-31 (review of the 2b-3 screens): 993 -> 998. Threshold_Proposals 14 -> 19: focus and the announcement after a decision, the
    // lane checks (another lane's approver, a VVD with no lane), a failed refresh keeping the list, the badge exactly +1, and an older Code.gs.
    const EXPECTED_TOTAL_CHECKS = EXPECTED_EXECUTED_CHECKS;

    const total = result.results.length;
    const failed = result.results.filter((r) => !r.pass);
    // AGENTS.md: read the executed-check COUNT, not just the pass rate -- a low count means
    // whole suites aborted at setup, not that most checks passed.
    // 2026-09-19: was "expect ~98 ... 15 from Suite 10", which described a run where Suite
    // 10's isolated iframe instances could not reach the network and most of its assertions
    // never executed. Now that all three live Sheets are pinned, Suite 10 runs in full and
    // the expected total is the same 125 everywhere -- including in a sandbox with no
    // outbound access, which previously could not finish this suite at all.
    const countMismatch = total !== EXPECTED_TOTAL_CHECKS;
    // One line per suite, counted from the results of THIS run (never typed in by hand, so it cannot go stale):
    // a suite that aborted at setup shows a smaller number, or is missing, right here. The history of why the
    // total moved is the comment above EXPECTED_TOTAL_CHECKS and docs/CHECK_HISTORY.md, not this output.
    const executedBySuite = new Map();
    for (const r of result.results) executedBySuite.set(r.suite, (executedBySuite.get(r.suite) || 0) + 1);
    console.log(`Executed checks: ${total} (expect ${EXPECTED_TOTAL_CHECKS}), per suite:`);
    for (const [suite, n] of executedBySuite) console.log(`  ${suite}: ${n}`);
    console.log(`Suite time: ${suiteSeconds.toFixed(0)} s (the slowest shard); slowest suites (s):`);
    for (const [suite, ms] of [...suiteMs].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${suite}: ${(ms / 1000).toFixed(1)}`);
    // BF_SUITE_TIMES_JSON=<file> also writes every check's time, in run order, for a closer look.
    if (process.env.BF_SUITE_TIMES_JSON) fs.writeFileSync(process.env.BF_SUITE_TIMES_JSON, JSON.stringify(recordMs, null, 1));
    console.log('Slowest single checks (s, including the setup before each):');
    for (const [name, ms] of [...recordMs].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${(ms / 1000).toFixed(1)}  ${name}`);
    console.log(`Passed: ${total - failed.length} / ${total}`);
    if (failed.length > 0) {
        console.log('\nFailed checks:');
        for (const f of failed) {
            console.log(`  ❌ [${f.suite}] ${f.name}${f.detail ? ' -- ' + JSON.stringify(f.detail) : ''}`);
        }
    }
    if (countMismatch) {
        // Independent of whether every executed check passed -- see the EXPECTED_TOTAL_CHECKS
        // comment above. A mismatch here means the run cannot be trusted as a real full-count
        // pass even if `failed.length` is 0.
        console.error(`\n❌ EXECUTED-CHECK COUNT MISMATCH: expected exactly ${EXPECTED_TOTAL_CHECKS} checks to execute, but ${total} did. This means one or more suites likely aborted partway through (a setup failure short-circuits the rest of that suite's assertions) or a suite's own check count changed without updating EXPECTED_TOTAL_CHECKS here -- see AGENTS.md's "Check the executed-check count, not the pass rate" section. This is a failure on its own, regardless of whether the checks that DID run all passed.`);
    }
    const success = result.allPassed && !countMismatch;
    let finalLine;
    if (!result.allPassed) {
        finalLine = '\n❌ SOME TESTS FAILED';
    } else if (countMismatch) {
        finalLine = '\n❌ EXECUTED-CHECK COUNT MISMATCH (every check that ran passed, but not the expected number of checks ran -- see above)';
    } else {
        finalLine = '\n✅ ALL TESTS PASSED';
    }
    console.log(finalLine);
    process.exitCode = success ? 0 : 1;
}

main().catch((err) => {
    console.error('❌ ci_regression_runner.js crashed:', err);
    process.exitCode = 1;
});

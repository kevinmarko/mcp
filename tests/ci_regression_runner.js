#!/usr/bin/env node
/**
 * CI driver for tests/booking_flash_regression_tests.js -- serves the current app over local
 * HTTP, drives a real headless Chromium (Playwright) through a file upload exactly like
 * HANDOFF.md's "Live-testing method" and AGENTS.md's check 4 describe, injects the regression
 * suite, and reports its result with a process exit code.
 *
 * NON-BLOCKING BY DESIGN: the CI workflow runs this job with `continue-on-error: true`. AGENTS.md's
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
const RESULT_POLL_TIMEOUT_MS = 180000;
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
const VENDORED_APP = path.join(REPO_ROOT, 'tests', '_ci_regression_throwaway_app.html');

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
    const browser = await chromium.launch(launchOpts);
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[page:${msg.type()}] ${msg.text()}`));
        page.on('pageerror', (err) => console.error('[page:uncaught]', err));

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

        console.log(`Loading ${appUrl} ...`);
        await page.goto(appUrl, { waitUntil: 'load' });

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached' });
        console.log(`Uploading ${path.basename(SAMPLE_XLSX)} ...`);
        await fileInput.setInputFiles(SAMPLE_XLSX);

        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 30000 });
        // Let the initial render settle before injecting the suite -- AGENTS.md's live-testing
        // guidance calls for ~1.5-2s here rather than trusting the very first paint.
        await page.waitForTimeout(2000);

        console.log('Injecting regression suite ...');
        await page.evaluate(() => { window.__bfrtLastResult = null; });
        await page.addScriptTag({ content: suiteSrc });

        console.log('Waiting for the suite to finish (self-invokes on injection) ...');
        const start = Date.now();
        let result = null;
        while (Date.now() - start < RESULT_POLL_TIMEOUT_MS) {
            result = await page.evaluate(() => window.__bfrtLastResult);
            if (result !== null) break;
            await new Promise((r) => setTimeout(r, 500));
        }

        if (result === null) {
            console.error(`❌ Suite did not finish within ${RESULT_POLL_TIMEOUT_MS}ms (window.__bfrtLastResult stayed null).`);
            process.exitCode = 1;
            return;
        }
        if (result.crashed) {
            console.error(`❌ Suite crashed: ${result.error}`);
            process.exitCode = 1;
            return;
        }

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
        const EXPECTED_TOTAL_CHECKS = 169;

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
        console.log(`\nExecuted checks: ${total} (expect ${EXPECTED_TOTAL_CHECKS} -- 77 from Suites 1-9, 42 from Suite 10, 8 from Suite 11, 42 from Suite 12; see AGENTS.md check 4's table. 2026-09-24: added Suite 12 (Filter_Persistence), regression coverage for the filter-saving feature ported from 1.67_TESTING into FilterPrefsStore -- moved the total from 127 to 164. Building it surfaced a real, confirmed bug in the port -- a pre-existing, unrelated effect keyed on [yardSearchText, availableYards] silently discarded a restored Yard selection whenever yardSearchText restored empty -- fixed the same day (ported from 1.67_TESTING's own identical 2026-09-15 fix for the same effect; see that effect's own comment in the app). Suite 12's Scenario 1 and Scenario 2 assert the FIXED behavior directly rather than working around the bug. Same day, a follow-up code-review pass found and fixed 3 more confirmed bugs (banner false-positive, write-path hazard misapplication, byte-identical-write guard defeated by its own timestamp) plus added coverage for a pre-existing gap (stale multi-select values never pruned) -- Suite 12 grew from 36 to 41 assertions, moving the total from 164 to 169; see HANDOFF.md's dated addendum.)`);
        console.log(`Passed: ${total - failed.length} / ${total}`);
        if (failed.length > 0) {
            console.log('\nFailed checks:');
            for (const f of failed) {
                console.log(`  ❌ [${f.suite}] ${f.name}${f.detail ? ' -- ' + JSON.stringify(f.detail) : ''}`);
            }
        }
        if (countMismatch) {
            // Independent of whether every executed check passed -- see the EXPECTED_TOTAL_CHECKS
            // comment above. A mismatch here means the run cannot be trusted as a real 164-check
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
    } finally {
        await browser.close();
        server.close();
        if (fs.existsSync(VENDORED_APP)) fs.unlinkSync(VENDORED_APP);
    }
}

main().catch((err) => {
    console.error('❌ ci_regression_runner.js crashed:', err);
    process.exitCode = 1;
});

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
 * 2026-09-16.csv), exactly as documented in AGENTS.md check 4, so the suite's extra ground-truth
 * comparison check runs too (73 checks pinned vs. 72 unpinned) and CI never depends on today's
 * live published Google Sheet.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO_ROOT = path.dirname(__dirname);
const SAMPLE_XLSX = path.join(REPO_ROOT, 'Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx');
const SECTOR_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'sector_data_2026-09-16.csv');
const REGRESSION_SUITE = path.join(REPO_ROOT, 'tests', 'booking_flash_regression_tests.js');
// Matches the SECTOR_DATA_CSV_URL fetch the app makes -- same fragment AGENTS.md's check 4
// documents pinning against.
const SECTOR_URL_FRAGMENT = '2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS';
const RESULT_POLL_TIMEOUT_MS = 180000;

// ---- App-file auto-detection: same algorithm as tests/check_alias_landmines.py, tests/
// check_date_timezone_safety.js's findAppHtml(), tests/perf_benchmark.js's findCurrentAppHtml(),
// and AGENTS.md's check-1 snippet. Kept in sync by hand across all of them -- change the
// detection rule in one, change it everywhere. ----
function findCurrentAppHtml() {
    const candidates = fs.readdirSync(REPO_ROOT)
        .filter((f) => /^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$/.test(f));
    if (candidates.length === 0) {
        throw new Error(`No Booking_flash_report_na*.html file found in ${REPO_ROOT}`);
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
    return candidates.sort(cmp).pop();
}

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
    const appHtmlName = findCurrentAppHtml();
    console.log(`(auto-detected current app version: ${appHtmlName})`);

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
    const appUrl = `http://127.0.0.1:${port}/${appHtmlName}`;
    const sectorFixtureCsv = fs.readFileSync(SECTOR_FIXTURE, 'utf8');
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

        // Pin the Sector Summary source to the committed fixture (AGENTS.md check 4) --
        // must be wired up before navigation so it's in place for the app's own mount-time fetch.
        await page.route((u) => u.href.includes(SECTOR_URL_FRAGMENT), (route) =>
            route.fulfill({ status: 200, contentType: 'text/csv', body: sectorFixtureCsv }));
        await page.addInitScript(() => { window.__BFRT_SECTOR_FIXTURE__ = true; });

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

        const total = result.results.length;
        const failed = result.results.filter((r) => !r.pass);
        // AGENTS.md: read the executed-check COUNT, not just the pass rate -- a low count means
        // whole suites aborted at setup, not that most checks passed.
        console.log(`\nExecuted checks: ${total} (expect ~73 with the sector fixture pinned)`);
        console.log(`Passed: ${total - failed.length} / ${total}`);
        if (failed.length > 0) {
            console.log('\nFailed checks:');
            for (const f of failed) {
                console.log(`  ❌ [${f.suite}] ${f.name}${f.detail ? ' -- ' + JSON.stringify(f.detail) : ''}`);
            }
        }
        console.log(result.allPassed ? '\n✅ ALL TESTS PASSED' : '\n❌ SOME TESTS FAILED');
        process.exitCode = result.allPassed ? 0 : 1;
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch((err) => {
    console.error('❌ ci_regression_runner.js crashed:', err);
    process.exitCode = 1;
});

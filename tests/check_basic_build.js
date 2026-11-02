#!/usr/bin/env node
/**
 * Guards the "basic" build -- dist/basic/index.html + apps-script/basic/Code.gs -- which must use
 * NONE of Google's Apps Script server services. See scripts/build_deployable.js (second artifact)
 * and apps-script/README.md ("Basic deployment").
 *
 * The basic artifact is the full deployable build plus ONE plain script as the first child of
 * <head>:  <script>window.__BF_GOOGLE_SERVICES_OFF__=true;</script>. With that flag the app must make
 * ZERO google.script.run calls, ignore the server-injected window.__SERVER_PREFS__ /
 * __SERVER_EXTRAS__ / __SERVER_CONFIG__, and never request ?archive= from window.__EXEC_URL__.
 *
 * Two parts, both blocking (exit 0 = pass, 1 = fail):
 *
 * 1. STATIC (no browser)
 *    - apps-script/basic/Code.gs defines doGet and references none of the forbidden Apps Script
 *      services (PropertiesService, CacheService, DriveApp, SpreadsheetApp, UrlFetchApp, Session.,
 *      MailApp, GmailApp, CalendarApp, LockService, ScriptApp triggers). Comments are stripped first
 *      so prose that names a service does not count.
 *    - dist/basic/index.html exists, carries the flag script as the very first thing inside
 *      <head>, and dist/index.html (the full build) does NOT carry the flag.
 *
 * 2. BROWSER (headless Chromium via Playwright, same setup as tests/ci_regression_runner.js)
 *    runScenario(appPath) loads an app file with every Apps Script fake the server would provide
 *    -- a google.script.run that records every call and never answers, __EXEC_URL__, __SERVER_PREFS__
 *    (dark mode ON), __SERVER_EXTRAS__ (filter prefs + export available) and __SERVER_CONFIG__ (one
 *    valid setting + one unknown key, which shows in the Settings popover only if honored) -- then
 *    loads data, opens Settings, flips a pref and visits the Booking Flash / POL Booking Flash tabs.
 *    A second scenario (boot failure, React blocked) drives the head script's startup-error report.
 *      - dist/basic/index.html must show: zero server calls, no ?archive= request, rows rendered,
 *        none of the injected server state applied, no Export to Drive button, flag === true.
 *      - dist/index.html is the CONTROL run with the identical harness: it must record server calls
 *        (and honor the injected state), otherwise "zero calls" in the basic run would mean nothing
 *        (a harness that cannot see calls passes everything).
 *
 * Env (same as ci_regression_runner.js): PW_CHROMIUM_PATH picks the browser binary; BF_VENDOR_CDN=1
 * serves a throwaway copy whose CDN <script> tags point at tests/vendor/ (sandboxes whose TLS proxy
 * the browser does not trust).
 *
 * Run:  node tests/check_basic_build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO_ROOT = path.dirname(__dirname);
const BASIC_CODE_GS = path.join(REPO_ROOT, 'apps-script', 'basic', 'Code.gs');
const BASIC_HTML = path.join(REPO_ROOT, 'dist', 'basic', 'index.html');
const FULL_HTML = path.join(REPO_ROOT, 'dist', 'index.html');
const BASIC_REL = 'dist/basic/index.html';
const FULL_REL = 'dist/index.html';
const SAMPLE_XLSX = path.join(REPO_ROOT, 'Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx');
const LIVE_CSV_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'live_csv_2026-08-12.csv');
const SECTOR_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'sector_data_2026-09-16.csv');
const HISTORICAL_FIXTURE = path.join(REPO_ROOT, 'tests', 'fixtures', 'historical_data_2026-08-24_to_2026-08-26.csv');
// Same URL fragments as tests/ci_regression_runner.js -- the three published Google Sheet CSVs.
const LIVE_CSV_URL_FRAGMENT = '2PACX-1vQNykGT8bYqwDC4k9loE5L8';
const SECTOR_URL_FRAGMENT = '2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS';
const HISTORICAL_URL_FRAGMENT = '2PACX-1vR1YNb3SKa8jS53bK';

const FLAG_SCRIPT = '<script>window.__BF_GOOGLE_SERVICES_OFF__=true;</script>';
const FLAG_ASSIGNMENT = '__BF_GOOGLE_SERVICES_OFF__=true';
const FAKE_EXEC_URL = 'https://script.google.com/macros/s/FAKE/exec';
// Marker the harness injects through __SERVER_CONFIG__.unknownKeys; the app lists an unknown key in
// the Settings popover as a warning, so seeing it there proves the injected config was read.
const CONFIG_CANARY_KEY = 'BASIC_BUILD_CANARY_KEY';

let failures = 0;
function check(name, ok, detail) {
    if (ok) console.log(`PASS  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail === undefined ? '' : ' -- ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`); }
}

// ===================================================================================
// 1. STATIC
// ===================================================================================

// Remove // line comments, /* */ block comments and keep string literals intact, so prose in a
// comment that names a forbidden service ("no PropertiesService here") does not count while a real
// reference -- even one inside a string such as a method name -- still does.
function stripJsComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (c === '/' && d === '/') {
            while (i < n && src[i] !== '\n') i++;
        } else if (c === '/' && d === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
        } else if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            out += c; i++;
            while (i < n && src[i] !== quote) {
                if (src[i] === '\\') { out += src[i]; i++; }
                if (i < n) { out += src[i]; i++; }
            }
            if (i < n) { out += src[i]; i++; }
        } else {
            out += c; i++;
        }
    }
    return out;
}

const FORBIDDEN_SERVER_APIS = [
    ['PropertiesService', /\bPropertiesService\b/],
    ['CacheService', /\bCacheService\b/],
    ['DriveApp', /\bDriveApp\b/],
    ['SpreadsheetApp', /\bSpreadsheetApp\b/],
    ['UrlFetchApp', /\bUrlFetchApp\b/],
    ['Session.', /\bSession\s*\./],
    ['MailApp', /\bMailApp\b/],
    ['GmailApp', /\bGmailApp\b/],
    ['CalendarApp', /\bCalendarApp\b/],
    ['LockService', /\bLockService\b/],
    ['ScriptApp.newTrigger', /\bScriptApp\s*\.\s*newTrigger\b/],
    ['getProjectTriggers', /\bgetProjectTriggers\b/],
    ['ScriptApp.deleteTrigger', /\bScriptApp\s*\.\s*deleteTrigger\b/],
];

function staticChecks() {
    console.log('\n=== Static checks ===');
    // ---- apps-script/basic/Code.gs ----
    if (!fs.existsSync(BASIC_CODE_GS)) {
        check('apps-script/basic/Code.gs exists', false, 'missing');
    } else {
        check('apps-script/basic/Code.gs exists', true);
        const code = stripJsComments(fs.readFileSync(BASIC_CODE_GS, 'utf8'));
        check('apps-script/basic/Code.gs defines doGet', /\bfunction\s+doGet\s*\(/.test(code) || /\bdoGet\s*=\s*function/.test(code));
        const hits = FORBIDDEN_SERVER_APIS.filter(([, re]) => re.test(code)).map(([label]) => label);
        check('apps-script/basic/Code.gs references no forbidden Apps Script service', hits.length === 0, hits.length ? `found: ${hits.join(', ')}` : undefined);
        // Only trigger-free ScriptApp use (ScriptApp.getService().getUrl()) is allowed.
        const scriptApp = Array.from(new Set((code.match(/\bScriptApp\s*\.\s*\w+/g) || []).map(s => s.replace(/\s+/g, ''))));
        const badScriptApp = scriptApp.filter(s => s !== 'ScriptApp.getService');
        check('apps-script/basic/Code.gs uses ScriptApp only for getService().getUrl()', badScriptApp.length === 0, badScriptApp.length ? `found: ${badScriptApp.join(', ')}` : undefined);
    }

    // ---- dist/basic/index.html and dist/index.html ----
    if (!fs.existsSync(BASIC_HTML)) {
        check('dist/basic/index.html exists', false, 'missing -- run `node scripts/build_deployable.js`');
    } else {
        check('dist/basic/index.html exists', true);
        const html = fs.readFileSync(BASIC_HTML, 'utf8');
        // The flag must be set before ANY other script can run, so it has to be the first thing in
        // <head> -- only whitespace/nothing between <head> and it.
        const headMatch = /<head(?:\s[^>]*)?>\s*([\s\S]*)/i.exec(html);
        check('dist/basic/index.html: flag script is the first thing inside <head>',
            !!headMatch && headMatch[1].startsWith(FLAG_SCRIPT),
            headMatch ? `head starts with: ${JSON.stringify(headMatch[1].slice(0, 80))}` : 'no <head> found');
        const occurrences = html.split(FLAG_ASSIGNMENT).length - 1;
        check('dist/basic/index.html: flag assigned exactly once', occurrences === 1, `${occurrences} occurrences`);
    }
    if (!fs.existsSync(FULL_HTML)) {
        check('dist/index.html exists', false, 'missing');
    } else {
        const full = fs.readFileSync(FULL_HTML, 'utf8');
        check('dist/index.html (full build) does NOT set __BF_GOOGLE_SERVICES_OFF__=true', !full.includes(FLAG_ASSIGNMENT));
    }
}

// ===================================================================================
// 2. BROWSER
// ===================================================================================

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.csv': 'text/csv', '.json': 'application/json' };
function startStaticServer(rootDir) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            const filePath = path.join(rootDir, urlPath);
            if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end(); return; }
                res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

// Shared across scenarios; filled in by main().
const env = { browser: null, port: 0, fixtures: null, archive: null, vendored: [] };

// Splits CSV text into records on newlines that are outside double quotes.
function splitCsvRecords(text) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') q = !q;
        if (c === '\n' && !q) { out.push(cur.replace(/\r$/, '')); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur.replace(/\r$/, ''));
    return out;
}
// Per-day archive fake built from the committed historical fixture: { dates, csvByDate } where each
// day's CSV is the header plus that day's rows (Record Date is the first column), as getArchiveDayCsv serves.
function buildArchiveFixture(historicalCsv) {
    const recs = splitCsvRecords(historicalCsv);
    const header = recs[0];
    const csvByDate = {};
    for (const r of recs.slice(1)) {
        const m = /^"?(\d{4}-\d{2}-\d{2})/.exec(r);
        if (m) (csvByDate[m[1]] = csvByDate[m[1]] || [header]).push(r);
    }
    const dates = Object.keys(csvByDate).sort().reverse();
    dates.forEach(d => { csvByDate[d] = csvByDate[d].join('\r\n') + '\r\n'; });
    return { dates, csvByDate };
}

// Serves `appRel` (repo-root-relative). With BF_VENDOR_CDN=1 it writes a throwaway copy under tests/
// whose CDN script tags point at tests/vendor/ (the name matches .gitignore's tests/_*throwaway*.html
// and is deleted again in main()'s finally) and returns that copy's path instead.
async function servedPathFor(appRel) {
    if (process.env.BF_VENDOR_CDN !== '1') return appRel;
    const { ensureVendorFiles, extractCdnScriptUrls } = require('./perf_benchmark.js');
    let html = fs.readFileSync(path.join(REPO_ROOT, appRel), 'utf8');
    const urlToFile = await ensureVendorFiles(extractCdnScriptUrls(html));
    for (const [url, file] of Object.entries(urlToFile)) {
        const before = html;
        html = html.split(`src="${url}"`).join(`src="vendor/${file}"`);
        if (html === before) throw new Error(`BF_VENDOR_CDN: expected CDN script tag not found: ${url}`);
    }
    const name = `_check_basic_build_throwaway_${appRel.replace(/[^a-zA-Z0-9]+/g, '_')}.html`;
    const dest = path.join(REPO_ROOT, 'tests', name);
    fs.writeFileSync(dest, html);
    env.vendored.push(dest);
    return `tests/${name}`;
}

/**
 * Loads `appPath` (repo-root-relative, e.g. 'dist/basic/index.html') with every Apps Script fake
 * installed BEFORE the page's own scripts run, drives it, and reports what the app did.
 *
 * opts.blockReact: abort the React scripts so the head script's boot-failure box (and its
 * startup-error report to the server) runs instead of the app.
 */
async function runScenario(appPath, opts = {}) {
    const served = await servedPathFor(appPath);
    const context = await env.browser.newContext();
    const page = await context.newPage();
    const result = {
        appPath, gsrCalls: [], gsrRunAccesses: 0, execRequests: [], pageErrors: [], configWarnLogged: false,
        rowCount: 0, historyRows: 0, flag: undefined, darkAtLoad: null, serverPrefHonored: null, exportButtonPresent: null,
        configLine: null, configCanaryShown: null, bootFailureShown: null, bootFailureText: null,
        historyPopoverOpened: null, historyDates: [], historyViewed: null, historyError: null,
    };
    try {
        page.on('console', (msg) => { if (/\[config sheet\]/.test(msg.text())) result.configWarnLogged = true; });
        page.on('pageerror', (err) => result.pageErrors.push(String(err && err.message || err)));

        // ---- the Apps Script fakes, installed before any page script runs ----
        await page.addInitScript(({ execUrl, canary, archiveFixture }) => {
            window.__archiveFixture = archiveFixture;
            window.__gsrCalls = [];
            window.__gsrRunAccesses = 0;
            window.__gsrStep = 'load';
            // Any property read on google.script.run is a method call on the runner. The three
            // handler setters chain (returning the runner) and are not server calls themselves;
            // every other name is the server function the app asked for. Nothing ever answers.
            const SETTERS = new Set(['withSuccessHandler', 'withFailureHandler', 'withUserObject']);
            // Only the archive functions are answered (shapes per Code.gs getArchiveIndex /
            // getArchiveDayCsv); everything else still never answers. Each runner carries its own
            // success/failure handlers, like the real one, so the answer reaches the right caller.
            const makeRunner = (onOk, onFail) => new Proxy({}, {
                get(_t, prop) {
                    if (typeof prop !== 'string') return undefined;
                    if (prop === 'withSuccessHandler') return (fn) => makeRunner(fn, onFail);
                    if (prop === 'withFailureHandler') return (fn) => makeRunner(onOk, fn);
                    return (...args) => {
                        if (!SETTERS.has(prop)) {
                            window.__gsrCalls.push({ fn: prop, step: window.__gsrStep, args: args.length });
                            const answer = window.__archiveAnswers && window.__archiveAnswers[prop];
                            if (answer && onOk) setTimeout(() => { try { onOk(answer(...args)); } catch (e) { if (onFail) onFail(e); } }, 5);
                        }
                        return makeRunner(onOk, onFail);
                    };
                },
            });
            const runner = makeRunner(null, null);
            window.__archiveAnswers = {
                getArchiveIndex: () => ({ ok: true, dates: window.__archiveFixture.dates.slice() }),
                getArchiveDayCsv: (date) => ({ ok: true, date, csv: window.__archiveFixture.csvByDate[date] || '' }),
            };
            const script = {};
            Object.defineProperty(script, 'run', { get() { window.__gsrRunAccesses++; return runner; } });
            window.google = { script };

            window.__EXEC_URL__ = execUrl;
            // Shape per resolveUserPref / SERVER_PREF_SEED_KEYS: { available, values: { key: '1'|'0'|null } }.
            // Dark mode ON is visible at first paint if (and only if) the server value is honored.
            window.__SERVER_PREFS__ = {
                available: true,
                values: { bookingFlashDarkMode: '1', bookingFlashAutoRefresh: null, bookingFlashFreezePanes: null },
            };
            // Shape per SERVER_EXTRAS: a non-null object makes the Export to Drive button render;
            // filterPrefs.value is the JSON blob (v === FILTER_PREFS_VERSION, 1) FilterPrefsStore reads.
            window.__SERVER_EXTRAS__ = {
                filterPrefs: { available: true, value: JSON.stringify({ v: 1, savedAt: Date.now() + 1000, prefs: { topPanelCollapsed: true } }) },
                exportToDrive: { available: true },
            };
            // Shape per resolveServerConfig: one valid setting plus an unknown key. When honored the
            // Settings popover says "1 setting(s) applied" and lists the unknown key as a warning.
            window.__SERVER_CONFIG__ = {
                available: true,
                settings: { 'scheduleChange.laneNetLossThreshold': '7' },
                unknownKeys: [canary],
                portExclusions: null,
            };
        }, { execUrl: FAKE_EXEC_URL, canary: CONFIG_CANARY_KEY, archiveFixture: env.archive });

        // ---- network: record + 404 anything aimed at script.google.com; pin the data sources ----
        await page.route((u) => u.hostname === 'script.google.com', (route) => {
            result.execRequests.push(route.request().url());
            return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
        });
        await page.route((u) => u.href.includes(LIVE_CSV_URL_FRAGMENT), (route) =>
            route.fulfill({ status: 200, contentType: 'text/csv', body: env.fixtures.live }));
        await page.route((u) => u.href.includes(SECTOR_URL_FRAGMENT), (route) =>
            route.fulfill({ status: 200, contentType: 'text/csv', body: env.fixtures.sector }));
        await page.route((u) => u.href.includes(HISTORICAL_URL_FRAGMENT), (route) =>
            route.fulfill({ status: 200, contentType: 'text/csv', body: env.fixtures.historical }));
        if (opts.blockReact) {
            await page.route((u) => /react/i.test(u.pathname + u.hostname) && /\.js$|unpkg/i.test(u.href), (route) => route.abort());
        }

        const setStep = (step) => page.evaluate((s) => { window.__gsrStep = s; }, step);
        const url = `http://127.0.0.1:${env.port}/${served}`;
        await page.goto(url, { waitUntil: 'load' });

        if (opts.blockReact) {
            // Head script shows the boot-failure box (and, outside the basic build, reports it).
            await page.waitForSelector('#bf-boot-failure', { timeout: 30000 }).then(
                () => { result.bootFailureShown = true; }, () => { result.bootFailureShown = false; });
            // textContent, not innerText: the wording is what is asserted, not how it is laid out.
            result.bootFailureText = await page.evaluate(() => {
                const box = document.getElementById('bf-boot-failure');
                return box ? box.textContent : null;
            });
            await page.waitForTimeout(2000);
        } else {
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.waitFor({ state: 'attached', timeout: 30000 });
            await setStep('upload');
            await fileInput.setInputFiles(SAMPLE_XLSX);
            await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, null, { timeout: 30000 });
            await page.waitForTimeout(2000);
            result.rowCount = await page.evaluate(() => document.querySelectorAll('tbody tr').length);

            // Was the server's dark-mode value applied at first paint? (localStorage is empty in a
            // fresh context, so dark here can only come from the injected __SERVER_PREFS__.)
            result.darkAtLoad = await page.evaluate(() => !!document.querySelector('.dark'));
            result.serverPrefHonored = result.darkAtLoad;

            // ---- Settings popover: read it, then flip a pref that would be saved to the server ----
            await setStep('settings');
            await page.locator('[data-settings-trigger]').first().click();
            await page.waitForSelector('[data-settings-panel]', { timeout: 10000 });
            // The Settings panel folds its Export section and its status Details by default (Details opens by itself on a warning, as the
            // control run's config canary causes), so each is opened here, never toggled: a plain click would shut an already-open one.
            // The Excel button is the positive control, in the control run too: "no Drive button" only means something with the section open.
            await page.evaluate(() => {
                for (const sel of ['[data-settings-section="export"]', '[data-settings-status-toggle]']) {
                    const el = document.querySelector(sel);
                    if (el && el.getAttribute('aria-expanded') !== 'true') el.click();
                }
            });
            await page.waitForSelector('[data-settings-action="export-excel"]', { timeout: 10000 });
            await page.waitForFunction(() => /Config Sheet:/.test(document.body.innerText), null, { timeout: 10000 });
            const popover = await page.evaluate((canary) => {
                const text = document.body.innerText;
                const m = /Config Sheet:[^\n]*/.exec(text);
                return {
                    exportButton: !!document.querySelector('[data-settings-action="export-drive"]'),
                    configLine: m ? m[0] : null,
                    canary: text.includes(canary),
                };
            }, CONFIG_CANARY_KEY);
            result.exportButtonPresent = popover.exportButton;
            result.configLine = popover.configLine;
            result.configCanaryShown = popover.canary;
            // The Theme control shows both choices; the one that is not pressed is the click that flips the mode.
            await page.locator('[data-settings-theme][aria-pressed="false"]').first().click();
            await page.waitForTimeout(800);
            await page.locator('[data-settings-trigger]').first().click(); // close
            await page.waitForTimeout(300);

            // ---- tabs ----
            for (const label of ['Booking Flash', 'POL Booking Flash']) {
                await setStep(`tab:${label}`);
                const btn = page.locator('button', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
                await btn.click();
                await page.waitForTimeout(1200);
            }

            // ---- Historical Data popover: the per-day archive UI (same selectors as the regression
            // suite Historical_PerDay_Archive). Control: getArchiveIndex answers with env.archive's
            // dates and picking one calls getArchiveDayCsv. Basic: no server call may happen; the
            // popover lists the dates of the published historical CSV instead.
            await setStep('history');
            const histBtn = page.locator('button', { hasText: /^\s*🗓️ Historical Data/ }).first();
            await histBtn.click();
            const dateButtons = () => page.locator('div.absolute:has(button[aria-label="Close historical data panel"]) button').filter({ hasText: /^\s*\d{4}-\d{2}-\d{2}\s*$/ });
            result.historyPopoverOpened = await dateButtons().first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
            if (result.historyPopoverOpened) {
                result.historyDates = (await dateButtons().allTextContents()).map(t => t.trim());
                const pick = env.archive.dates[0];
                const target = dateButtons().filter({ hasText: pick }).first();
                if (await target.count()) {
                    await setStep('history:view');
                    await target.click();
                    result.historyViewed = await page.waitForFunction((d) =>
                        Array.from(document.querySelectorAll('span')).some(s => s.textContent.includes(`Viewing historical data for ${d}`)),
                        pick, { timeout: 15000 }).then(() => true, () => false);
                    await page.waitForTimeout(1000);
                    result.historyRows = await page.evaluate(() => {
                        const t = Array.from(document.querySelectorAll('table')).find(x => x.checkVisibility && x.checkVisibility());
                        return t ? t.querySelectorAll('tbody tr').length : 0;
                    });
                }
            }
            await setStep('idle');
            await page.waitForTimeout(3000);
        }

        result.gsrCalls = await page.evaluate(() => window.__gsrCalls.slice());
        result.gsrRunAccesses = await page.evaluate(() => window.__gsrRunAccesses);
        result.flag = await page.evaluate(() => window.__BF_GOOGLE_SERVICES_OFF__);
    } finally {
        await context.close();
    }
    return result;
}

const fmtCalls = (calls) => calls.length ? calls.map(c => `${c.fn}@${c.step}`).join(', ') : '(none)';

async function browserChecks() {
    let chromium;
    try { ({ chromium } = require('playwright')); } catch (e) {
        check('playwright is installed', false, 'run `npm ci` and `npx playwright install chromium`');
        return;
    }
    if (!fs.existsSync(BASIC_HTML) || !fs.existsSync(FULL_HTML)) {
        check('browser scenarios can run', false, 'dist/basic/index.html or dist/index.html missing');
        return;
    }
    env.archive = buildArchiveFixture(fs.readFileSync(HISTORICAL_FIXTURE, 'utf8'));
    env.fixtures = {
        live: fs.readFileSync(LIVE_CSV_FIXTURE, 'utf8'),
        sector: fs.readFileSync(SECTOR_FIXTURE, 'utf8'),
        historical: fs.readFileSync(HISTORICAL_FIXTURE, 'utf8'),
    };
    const server = await startStaticServer(REPO_ROOT);
    env.port = server.address().port;
    const launchOpts = { args: ['--no-sandbox'] };
    if (process.env.PW_CHROMIUM_PATH) launchOpts.executablePath = process.env.PW_CHROMIUM_PATH;
    env.browser = await chromium.launch(launchOpts);
    try {
        console.log('\n=== Browser: BASIC build (dist/basic/index.html) ===');
        const basic = await runScenario(BASIC_REL);
        console.log(`  server calls: ${fmtCalls(basic.gsrCalls)}`);
        console.log(`  script.google.com requests: ${basic.execRequests.length ? basic.execRequests.join(' | ') : '(none)'}`);
        console.log(`  rows=${basic.rowCount} darkAtLoad=${basic.darkAtLoad} export=${basic.exportButtonPresent} config="${basic.configLine}" flag=${basic.flag} google.script.run reads=${basic.gsrRunAccesses}`);
        if (basic.pageErrors.length) console.log(`  page errors: ${basic.pageErrors.slice(0, 3).join(' | ')}`);
        check('basic: window.__BF_GOOGLE_SERVICES_OFF__ === true', basic.flag === true, basic.flag);
        check('basic: zero google.script.run server calls', basic.gsrCalls.length === 0, fmtCalls(basic.gsrCalls));
        check('basic: no request to script.google.com with archive=', !basic.execRequests.some(u => u.includes('archive=')), basic.execRequests);
        // The only /exec request the basic build may make is the plain update-banner poll
        // (?check=version, answered by doGet -- no Google API behind it, kept on purpose).
        const unexpectedExec = basic.execRequests.filter(u => !/[?&]check=version(?:&|$)/.test(u));
        check('basic: only /exec request is the ?check=version update poll', unexpectedExec.length === 0, unexpectedExec);
        // Historical Data UI really exercised: the popover opened, listed dates and (when a date was
        // picked) the day loaded -- all with zero server calls, from the published historical CSV.
        console.log(`  history popover: opened=${basic.historyPopoverOpened} dates=${basic.historyDates.join(',') || '(none)'} viewed=${basic.historyViewed} rows=${basic.historyRows}`);
        check('basic: Historical Data popover opens and lists dates from the published historical CSV', basic.historyPopoverOpened === true && basic.historyDates.length > 0, { opened: basic.historyPopoverOpened, dates: basic.historyDates });
        check('basic: picking a historical date shows it without server calls', basic.historyViewed === true && basic.historyRows > 0 && basic.gsrCalls.length === 0, { viewed: basic.historyViewed, rows: basic.historyRows });
        check('basic: no getArchiveIndex / getArchiveDayCsv call', !basic.gsrCalls.some(c => /^getArchive/.test(c.fn)), fmtCalls(basic.gsrCalls));
        check('basic: data rows render (> 5)', basic.rowCount > 5, `rowCount=${basic.rowCount}`);
        check('basic: injected __SERVER_PREFS__ not applied (dark mode off at first paint)', basic.serverPrefHonored === false, `darkAtLoad=${basic.darkAtLoad}`);
        check('basic: injected __SERVER_CONFIG__ not applied', basic.configCanaryShown === false && /not in use/.test(basic.configLine || ''), basic.configLine);
        check('basic: Export to Drive button absent', basic.exportButtonPresent === false, `present=${basic.exportButtonPresent}`);

        console.log('\n=== Browser: CONTROL (full build, dist/index.html, identical harness) ===');
        const control = await runScenario(FULL_REL);
        console.log(`  server calls: ${fmtCalls(control.gsrCalls)}`);
        console.log(`  script.google.com requests: ${control.execRequests.length ? control.execRequests.join(' | ') : '(none)'}`);
        console.log(`  rows=${control.rowCount} darkAtLoad=${control.darkAtLoad} export=${control.exportButtonPresent} config="${control.configLine}" flag=${control.flag} google.script.run reads=${control.gsrRunAccesses}`);
        if (control.pageErrors.length) console.log(`  page errors: ${control.pageErrors.slice(0, 3).join(' | ')}`);
        check('control: harness records google.script.run server calls (> 0)', control.gsrCalls.length > 0, 'the harness cannot see server calls, so the basic run proves nothing');
        console.log(`  history popover: opened=${control.historyPopoverOpened} dates=${control.historyDates.join(',') || '(none)'} viewed=${control.historyViewed} rows=${control.historyRows}`);
        check('control: Historical Data UI calls getArchiveIndex (harness really exercises the archive path)', control.gsrCalls.some(c => c.fn === 'getArchiveIndex'), fmtCalls(control.gsrCalls));
        check('control: popover lists exactly the fake archive index dates', control.historyPopoverOpened === true && JSON.stringify(control.historyDates) === JSON.stringify(env.archive.dates), { dates: control.historyDates, expected: env.archive.dates });
        check('control: picking a date calls getArchiveDayCsv and shows it', control.gsrCalls.some(c => c.fn === 'getArchiveDayCsv') && control.historyViewed === true && control.historyRows > 0, { viewed: control.historyViewed, rows: control.historyRows });
        check('control: full build has no flag', control.flag !== true, control.flag);
        // The injected shapes must really be ones the app reads, or "not applied" in the basic run is vacuous.
        check('control: injected __SERVER_PREFS__ IS applied (dark mode on at first paint)', control.serverPrefHonored === true, `darkAtLoad=${control.darkAtLoad}`);
        check('control: injected __SERVER_CONFIG__ IS applied', control.configCanaryShown === true, control.configLine);
        check('control: Export to Drive button present', control.exportButtonPresent === true, `present=${control.exportButtonPresent}`);

        console.log('\n=== Browser: boot failure (React blocked) -- startup-error report ===');
        const bootBasic = await runScenario(BASIC_REL, { blockReact: true });
        console.log(`  basic   server calls: ${fmtCalls(bootBasic.gsrCalls)} bootFailureShown=${bootBasic.bootFailureShown}`);
        const bootControl = await runScenario(FULL_REL, { blockReact: true });
        console.log(`  control server calls: ${fmtCalls(bootControl.gsrCalls)} bootFailureShown=${bootControl.bootFailureShown}`);
        check('boot failure (control): the boot-failure box shows and reports to the server (logClientStartupError)',
            bootControl.bootFailureShown === true && bootControl.gsrCalls.some(c => c.fn === 'logClientStartupError'), fmtCalls(bootControl.gsrCalls));
        check('boot failure (basic): the boot-failure box shows but nothing is reported to the server',
            bootBasic.bootFailureShown === true && bootBasic.gsrCalls.length === 0, `shown=${bootBasic.bootFailureShown} calls=${fmtCalls(bootBasic.gsrCalls)}`);
        // 2026-10-12 (per Kevin): the network-failure box tells the reader to run Reset Network from
        // the NA IT Ops toolbox and restart. Both builds carry the same head script, so both are checked.
        // Not vacuous: a missing box gives null text, which fails every phrase below.
        const RESET_NETWORK_PHRASES = ['NA IT Ops', 'Network', 'Reset Network', 'restart your computer'];
        for (const [label, run] of [['basic', bootBasic], ['control', bootControl]]) {
            const text = run.bootFailureText || '';
            const missing = RESET_NETWORK_PHRASES.filter(p => !text.includes(p));
            check(`boot failure (${label}): the network-failure box tells the reader to run Reset Network from the NA IT Ops toolbox, then restart`,
                text !== '' && missing.length === 0, text === '' ? 'no box text captured' : `missing: ${missing.join(', ') || 'none'}`);
        }
    } finally {
        await env.browser.close();
        server.close();
        for (const f of env.vendored) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
    }
}

async function main() {
    staticChecks();
    await browserChecks();
    console.log(failures === 0 ? '\nPASS: basic build uses no Google Apps Script services' : `\nFAIL: ${failures} check(s) failed`);
    process.exitCode = failures === 0 ? 0 : 1;
}

if (require.main === module) {
    main().catch((err) => {
        console.error('FAIL: check_basic_build.js crashed:', err);
        process.exitCode = 1;
    });
}

module.exports = { stripJsComments, FORBIDDEN_SERVER_APIS, runScenario };

#!/usr/bin/env node
/**
 * POL Booking Flash field-toggle performance harness.
 *
 * WHY THIS EXISTS SEPARATELY FROM tests/perf_benchmark.js
 * ---------------------------------------------------------
 * perf_benchmark.js measures the v1.66 performance pass's five findings (load/parse, the filter
 * memo, drag). None of them is the cost this script exists to hold accountable: clicking ONE
 * field-visibility toggle on the POL Booking Flash tab used to block the main thread for
 * multiple SECONDS, because the auto-fit `useLayoutEffect` re-measured every
 * `[data-autofit-col]` cell in the table (~19.5k of them on the real sample export) to produce
 * ~23 column widths. That is a distinct interaction with a distinct root cause, so it gets its
 * own script rather than a sixth metric bolted onto a harness whose header comment is already a
 * plan-of-record for a different workstream.
 *
 * All the browser plumbing -- app-file auto-detection, the fetch-once CDN vendor cache, the
 * throwaway-copy rewrite, the static server, the React-commit-counting init script -- is
 * `require()`d from perf_benchmark.js rather than copied. Read that file's header for why a
 * throwaway copy is used and why the real app file's CDN tags are never edited.
 *
 * WHICH DATA FILE, AND WHY NOT THE BIG CSV
 * -------------------------------------------
 * perf_benchmark.js loads the 8,769-row historical CSV because it is measuring parse cost.
 * This script loads `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` instead -- the same export
 * CI's check_alias_landmines.py uses, and the one every POL column-grain measurement recorded
 * in DATA_ARCHITECTURE.md was taken against. It yields 964 POL rows, which is what makes the
 * numbers here directly comparable to the per-toggle figures quoted in the app file's own
 * comments (the `polAutoFitDeps` block and the `show<Key>` block on the POL tab).
 *
 * WHAT IS MEASURED, AND WHY BOTH NUMBERS
 * -----------------------------------------
 *   syncMs  -- wall-clock for `element.click()` to RETURN. This app mounts through
 *              `ReactDOM.createRoot`, and React 18 flushes discrete events (click) synchronously,
 *              so this single number contains the state update, the full re-render of the
 *              un-virtualized POL table, AND the auto-fit useLayoutEffect that runs before the
 *              browser is allowed to paint. It is therefore the closest available proxy for
 *              "how long the tab is frozen", which is the thing a user actually complains about.
 *   paintMs -- from just before the click to two animation frames later, i.e. including the
 *              paint the user waits for. Reported alongside syncMs deliberately: a "fix" that
 *              merely moves work off the synchronous path (useLayoutEffect -> useEffect) would
 *              cut syncMs while leaving paintMs alone, and that distinction should be visible
 *              here rather than hidden behind one headline number.
 *
 * Both directions of every toggle are measured (reveal columns, then hide them again) because
 * they are not symmetric: revealing adds cells to measure, hiding removes them.
 *
 * ATTRIBUTION MICROBENCHMARK
 * -----------------------------
 * Per-toggle wall clock says how bad it is, not where it goes. `--attribute` additionally
 * replicates the auto-fit effect's three passes directly against the live DOM -- (1) write
 * `white-space: nowrap` inline on every cell, (2) Range + getBoundingClientRect per cell,
 * (3) restore every inline style -- and times each separately, so a change to the effect can be
 * justified against the pass it actually removes instead of against a hunch. This measures the
 * DOM, not the app's own code path, so it stays valid whatever the effect is refactored into.
 *
 * RECORDED BASELINE -- 2026-09-18, this sandbox, Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx,
 * 1600x900, 3 trials. Medians of the SYNC number, in ms. Treat these as the numbers a later run
 * has to beat or match, not as absolutes: they are sandbox-specific and this harness reports
 * spread for exactly that reason.
 *
 *   POL Booking Flash (1,398 body rows, ~19.8k -> 21.7k td/th)
 *                        before      after
 *     worst toggle       9116.2       150.0     (activity, hide direction)
 *     sum of all        31263.5      2589.3
 *     activity      577 /  9116   108 /  104     (click1 = reveal, click2 = hide)
 *     opIssues     5761 /   582    90 /   92
 *     eta           525 /  4358   100 /  116
 *     reefer        549 /  4147   100 /   96
 *     vco           501 /  1555   108 /  107
 *     apStatus       54 /  1093    93 /   88
 *     polStatus    1259 /    32   101 /   96
 *
 *   Booking Flash (467 body rows, 8,008 td/th) -- NOT changed by the 2026-09-18 fix and it did
 *   not need to be. Measured on the pre-change build in isolation: worst 21.3, sum 387.2; on the
 *   post-change build: worst 26.9, sum 403.5. Note the trap: in a combined run that measures POL
 *   FIRST, this tab's pre-change numbers came out ~10x worse (worst 273.6) purely because it ran
 *   straight after 31s of pathological POL DOM churn. If you are comparing this tab across
 *   builds, measure it with --tab=detail on its own, or you will credit a fix for something the
 *   harness ordering caused.
 *
 * USAGE
 *   node tests/perf_toggle_benchmark.js                 # both tabs, every toggle, 3 trials each
 *   node tests/perf_toggle_benchmark.js --trials=5
 *   node tests/perf_toggle_benchmark.js --tab=pol_booking
 *   node tests/perf_toggle_benchmark.js --only=reefer,eta
 *   node tests/perf_toggle_benchmark.js --attribute     # add the three-pass attribution run
 *   node tests/perf_toggle_benchmark.js --json=out.json # save the summary for a before/after diff
 *
 *   # before/after against a pre-change build, without touching the working tree:
 *   git show "HEAD:$(node scripts/print_app_file.js)" > /tmp/before.html
 *   PERF_APP_HTML=/tmp/before.html node tests/perf_toggle_benchmark.js --tab=pol_booking
 */

const fs = require('fs');
const path = require('path');

const {
    findCurrentAppHtml,
    ensureVendorFiles,
    extractCdnScriptUrls,
    startStaticServer,
    summarize,
    INIT_SCRIPT,
    CHROMIUM_PATH,
    REPO_ROOT,
    TESTS_DIR,
} = require('./perf_benchmark.js');

// A distinct filename from perf_benchmark.js's own throwaway copy, so running one script never
// clobbers or deletes the other's working file.
const THROWAWAY_HTML = path.join(TESTS_DIR, '_perf_toggle_throwaway_app.html');
const XLSX_PATH = path.join(REPO_ROOT, 'Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx');

// Both table tabs are measured, not just POL. They share the same root cause (React patching a
// large un-virtualized table cell-by-cell), and since 2026-09-18 they share most of their
// toggle set too, so fixing one and not checking the other would leave half the bug shipped.
const TABS = {
    pol_booking: 'POL Booking Flash',
    detail: 'Booking Flash',
};

function parseArgs(argv) {
    const opts = { trials: 3, only: null, attribute: false, json: null, tabs: Object.keys(TABS) };
    for (const arg of argv) {
        let m;
        if ((m = /^--trials=(\d+)$/.exec(arg))) opts.trials = parseInt(m[1], 10);
        else if ((m = /^--only=(.+)$/.exec(arg))) opts.only = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        else if ((m = /^--tab=(.+)$/.exec(arg))) opts.tabs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        else if (arg === '--attribute') opts.attribute = true;
        else if ((m = /^--json=(.+)$/.exec(arg))) opts.json = m[1];
    }
    return opts;
}

function buildThrowawayCopy(appHtmlPath, urlToFile) {
    let html = fs.readFileSync(appHtmlPath, 'utf8');
    for (const [url, file] of Object.entries(urlToFile)) {
        const before = html;
        html = html.split(`src="${url}"`).join(`src="vendor/${file}"`);
        if (html === before) throw new Error(`Expected CDN script tag not found while rewriting: ${url}`);
    }
    fs.writeFileSync(THROWAWAY_HTML, html);
    return THROWAWAY_HTML;
}

// ---- Open the Fields picker. Since #88 it lived INSIDE the Settings popover, so the trigger
// chain used to be [data-settings-trigger] -> [data-field-picker-trigger]. 2026-09-21 (per
// Kevin: "put the fields button next to the coast button") moved [data-field-picker-trigger]
// back OUT of that popover to stand alone in the tab-bar row -- see its own comment at the
// Settings trigger button in the app file. Clicking [data-settings-trigger] first is not just
// unnecessary now, it actively BREAKS this: the popover it opens visually overlaps the
// relocated field-picker button and intercepts the click, timing out after 30s
// ("<div ...cursor-move...> subtree intercepts pointer events"). Found live, not guessed: a
// throwaway run with the Settings click removed completed cleanly end to end, same body-row/
// td-th counts as this file's own documented baseline, no errors. Idempotent: if the toggles
// are already on screen it returns without clicking, so it is safe to call between trials to
// recover from a picker that closed itself. ----
async function openFieldPicker(page) {
    const anyToggle = await page.locator('[data-field-toggle]').count();
    if (anyToggle > 0) return;
    const picker = page.locator('[data-field-picker-trigger]').first();
    if (await picker.count()) {
        await picker.click();
        await page.waitForTimeout(120);
    }
    await page.locator('[data-field-toggle]').first().waitFor({ state: 'visible', timeout: 5000 });
}

// ---- One measured click. Runs entirely inside the page so the timer brackets the click with
// nothing but page-local work in between -- a Playwright-side timer would fold CDP round-trip
// latency into a number reported in milliseconds. ----
async function measureToggleClick(page, key) {
    return page.evaluate(async (k) => {
        const el = document.querySelector(`[data-field-toggle="${k}"]`);
        if (!el) throw new Error(`no [data-field-toggle="${k}"] in the DOM`);
        // Let anything left over from the previous trial settle, so its work is not billed here.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const t0 = performance.now();
        el.click();
        const tSync = performance.now();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const tPaint = performance.now();
        return { syncMs: tSync - t0, paintMs: tPaint - t0 };
    }, key);
}

function polContainerExpr() {
    // The POL table's scroll container is the nearest scrollable ancestor of any auto-fit cell.
    // Located structurally rather than by class string so a Tailwind class tweak on that div
    // (there have been several) doesn't silently turn this into a no-op that reports 0ms.
    return `(() => {
        const cell = document.querySelector('[data-autofit-col]');
        return cell ? cell.closest('div.overflow-auto') : null;
    })()`;
}

async function countAutofitCells(page) {
    return page.evaluate(`(() => {
        const c = ${polContainerExpr()};
        return c ? c.querySelectorAll('[data-autofit-col]').length : 0;
    })()`);
}

// ---- Three-pass attribution against the live DOM (see this file's header). ----
async function measureAttribution(page) {
    return page.evaluate(`(() => {
        const container = ${polContainerExpr()};
        if (!container) return null;
        const measure = (el) => {
            try {
                const range = document.createRange();
                range.selectNodeContents(el);
                const handle = el.querySelector(':scope > [data-resize-handle]');
                if (handle) range.setEndBefore(handle);
                return range.getBoundingClientRect().width;
            } catch { return el.scrollWidth || 0; }
        };

        const tQuery0 = performance.now();
        const cells = container.querySelectorAll('[data-autofit-col]');
        const tQuery = performance.now() - tQuery0;

        const originalStyles = [];
        const tWrite0 = performance.now();
        cells.forEach(el => { originalStyles.push(el.style.whiteSpace); el.style.whiteSpace = 'nowrap'; });
        const tWrite = performance.now() - tWrite0;

        const maxByKey = {};
        const tRead0 = performance.now();
        cells.forEach(el => {
            const key = el.getAttribute('data-autofit-col');
            const w = measure(el);
            if (!(key in maxByKey) || w > maxByKey[key]) maxByKey[key] = w;
        });
        const tRead = performance.now() - tRead0;

        const tRestore0 = performance.now();
        cells.forEach((el, i) => { el.style.whiteSpace = originalStyles[i]; });
        const tRestore = performance.now() - tRestore0;

        // The same work with the class-based approach the fix uses: one class toggle on the
        // container instead of 2 x N inline style writes. Timed here so the saving is measured
        // rather than asserted. The stylesheet rule is injected on first use.
        if (!document.getElementById('__perfAutofitMeasuringRule')) {
            const style = document.createElement('style');
            style.id = '__perfAutofitMeasuringRule';
            style.textContent = '.__perf_measuring [data-autofit-col]{white-space:nowrap !important;}';
            document.head.appendChild(style);
        }
        const tClass0 = performance.now();
        container.classList.add('__perf_measuring');
        container.getBoundingClientRect(); // force the style/layout recalc into this window
        const tClassOn = performance.now() - tClass0;
        const tClassOff0 = performance.now();
        container.classList.remove('__perf_measuring');
        container.getBoundingClientRect();
        const tClassOff = performance.now() - tClassOff0;

        return {
            cells: cells.length,
            distinctKeys: Object.keys(maxByKey).length,
            queryMs: tQuery,
            inlineWriteMs: tWrite,
            rangeReadMs: tRead,
            inlineRestoreMs: tRestore,
            classOnMs: tClassOn,
            classOffMs: tClassOff,
        };
    })()`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    let chromium;
    try {
        ({ chromium } = require('playwright'));
    } catch {
        console.error('❌ playwright is not installed. Run `npm install` first.');
        process.exit(1);
    }
    if (!fs.existsSync(CHROMIUM_PATH)) {
        console.error(`❌ Chromium not found at ${CHROMIUM_PATH}. Set PW_CHROMIUM_PATH. Do NOT run \`playwright install\` (see AGENTS.md).`);
        process.exit(1);
    }
    if (!fs.existsSync(XLSX_PATH)) {
        console.error(`❌ Sample export not found at ${XLSX_PATH}`);
        process.exit(1);
    }

    // PERF_APP_HTML points the run at a specific build instead of the auto-detected current
    // one. That is what makes an honest before/after possible: dump the pre-change file with
    // `git show HEAD:<app>.html > /tmp/before.html` and benchmark both without moving files
    // around in the working tree (which is easy to get interrupted half-done, leaving the repo
    // holding a stale app file). It must stay an override, never the default -- a benchmark
    // that silently measured something other than the live app would be worse than none.
    const appHtmlPath = process.env.PERF_APP_HTML || findCurrentAppHtml();
    if (process.env.PERF_APP_HTML) console.log(`(PERF_APP_HTML override in effect)`);
    console.log(`App file: ${appHtmlPath}`);
    const urls = extractCdnScriptUrls(fs.readFileSync(appHtmlPath, 'utf8'));
    const urlToFile = await ensureVendorFiles(urls);
    buildThrowawayCopy(appHtmlPath, urlToFile);

    const server = await startStaticServer(REPO_ROOT);
    const port = server.address().port;
    const appUrl = `http://127.0.0.1:${port}/tests/${path.basename(THROWAWAY_HTML)}`;
    const summary = { appFile: path.basename(appHtmlPath), toggles: {} };

    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript(INIT_SCRIPT);
        await page.goto(appUrl, { waitUntil: 'load' });

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached' });
        await fileInput.setInputFiles(XLSX_PATH);
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 60000 });

        for (const tabKey of opts.tabs) {
            const tabLabel = TABS[tabKey];
            if (!tabLabel) throw new Error(`unknown --tab value "${tabKey}" (known: ${Object.keys(TABS).join(', ')})`);
            const tabResult = { label: tabLabel, toggles: {} };
            summary.toggles[tabKey] = tabResult;

            console.log(`\n${'='.repeat(78)}\n== ${tabLabel}\n${'='.repeat(78)}`);

            // ---- Metric A: arriving on the tab ----
            const tabSwitch = await page.evaluate(async (label) => {
                const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === label);
                if (!btn) throw new Error(`tab button "${label}" not found`);
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                const t0 = performance.now();
                btn.click();
                const tSync = performance.now();
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                return { syncMs: tSync - t0, paintMs: performance.now() - t0 };
            }, tabLabel);
            await page.waitForTimeout(600);

            // VISIBLE only: once POL Booking Flash has been visited it stays mounted-but-hidden,
            // so an unscoped document-wide count here would double-count its rows/cells into
            // every OTHER tab's reported total too (see perf_highlight_benchmark.js's isVisible
            // for the same fix and its full explanation).
            const bodyRows = await page.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).filter((el) => el.checkVisibility()).length);
            const cellCount = await page.evaluate(() => Array.from(document.querySelectorAll('td,th')).filter((el) => el.checkVisibility()).length);
            tabResult.bodyRows = bodyRows;
            tabResult.cells = cellCount;
            tabResult.autofitCells = await countAutofitCells(page);
            tabResult.tabSwitch = { syncMs: Math.round(tabSwitch.syncMs * 10) / 10, paintMs: Math.round(tabSwitch.paintMs * 10) / 10 };
            console.log(`  ${bodyRows} body rows, ${cellCount} td/th, ${tabResult.autofitCells} [data-autofit-col]`);
            console.log(`  Metric A (switch to tab): sync ${tabSwitch.syncMs.toFixed(1)}ms, to-paint ${tabSwitch.paintMs.toFixed(1)}ms`);

            await openFieldPicker(page);
            let keys = await page.evaluate(() =>
                Array.from(document.querySelectorAll('[data-field-toggle]')).map((el) => el.getAttribute('data-field-toggle'))
            );
            if (opts.only) keys = keys.filter((k) => opts.only.includes(k));
            console.log(`\n  Metric B: ${keys.length} toggle(s), ${opts.trials} trial(s) each, both directions`);
            console.log(`  (click1 = flip from current state, click2 = flip back)\n`);

            for (const key of keys) {
                const first = [], firstPaint = [], back = [], backPaint = [];
                for (let t = 0; t < opts.trials; t++) {
                    await openFieldPicker(page);
                    const a = await measureToggleClick(page, key);
                    first.push(a.syncMs);
                    firstPaint.push(a.paintMs);
                    await openFieldPicker(page);
                    const b = await measureToggleClick(page, key); // restore original state
                    back.push(b.syncMs);
                    backPaint.push(b.paintMs);
                }
                const s1 = summarize(first), s2 = summarize(back);
                const p1 = summarize(firstPaint), p2 = summarize(backPaint);
                tabResult.toggles[key] = { click1: { sync: s1, paint: p1 }, click2: { sync: s2, paint: p2 } };
                const worst = Math.max(s1.median, s2.median);
                const flag = worst > 1000 ? '❌' : worst > 300 ? '⚠️ ' : '✅';
                console.log(
                    `  ${flag} ${key.padEnd(16)} click1 sync ${String(s1.median).padStart(8)}ms / paint ${String(p1.median).padStart(8)}ms` +
                    `   click2 sync ${String(s2.median).padStart(8)}ms / paint ${String(p2.median).padStart(8)}ms`
                );
            }

            const medians = Object.values(tabResult.toggles).flatMap((v) => [v.click1.sync.median, v.click2.sync.median]);
            tabResult.worstToggleSyncMs = medians.length ? Math.max(...medians) : 0;
            tabResult.totalToggleSyncMs = Math.round(medians.reduce((a, b) => a + b, 0) * 10) / 10;
            console.log(`\n  worst single toggle: ${tabResult.worstToggleSyncMs}ms sync   |   sum of all: ${tabResult.totalToggleSyncMs}ms`);
        }

        if (opts.attribute) {
            // Attribution is POL-specific (it is the only tab with an auto-fit pass), so make
            // sure we are standing on it before replicating that pass.
            await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'POL Booking Flash');
                if (b) b.click();
            });
            await page.waitForTimeout(600);
            console.log(`\n--- Metric C: where the auto-fit pass's time goes (replicated against the live DOM) ---`);
            const attr = await measureAttribution(page);
            summary.attribution = attr;
            if (!attr) {
                console.log('  (POL container not found -- skipped)');
            } else {
                console.log(`  cells=${attr.cells}, distinct column keys produced=${attr.distinctKeys}`);
                console.log(`  querySelectorAll          ${attr.queryMs.toFixed(1)}ms`);
                console.log(`  pass 1: inline nowrap x${attr.cells}   ${attr.inlineWriteMs.toFixed(1)}ms`);
                console.log(`  pass 2: Range+rect x${attr.cells}      ${attr.rangeReadMs.toFixed(1)}ms   <-- forced layout lives here`);
                console.log(`  pass 3: restore inline x${attr.cells}  ${attr.inlineRestoreMs.toFixed(1)}ms`);
                console.log(`  ALTERNATIVE to passes 1+3: one container class`);
                console.log(`            add  ${attr.classOnMs.toFixed(1)}ms   remove ${attr.classOffMs.toFixed(1)}ms`);
                const saved = attr.inlineWriteMs + attr.inlineRestoreMs - attr.classOnMs - attr.classOffMs;
                console.log(`            => saves ${saved.toFixed(1)}ms per pass`);
            }
        }

        await context.close();
    } finally {
        await browser.close();
        server.close();
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML);
    }

    if (opts.json) {
        fs.writeFileSync(opts.json, JSON.stringify(summary, null, 2));
        console.log(`\nSaved JSON summary to ${opts.json}`);
    }
    console.log('\n=== JSON SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
    main().catch((e) => {
        console.error('❌ Toggle benchmark failed:', e);
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML);
        process.exit(1);
    });
}

#!/usr/bin/env node
/**
 * Row-highlight interaction benchmark ("click a row to highlight it").
 *
 * WHY THIS EXISTS. On 2026-09-18 Kevin reported "the app pretty much crashes when you are
 * highlighting / selecting rows". It did: on the POL Booking Flash tab with the real
 * historical CSV loaded, a single click on a single row froze the whole page for ~38s, with
 * the React commit landing ~41,081ms after the click. A hard main-thread wedge that long is
 * indistinguishable from a crash to a user, and Chrome will offer to kill the tab.
 *
 * ROOT CAUSE (fixed in the same commit that added this file). The 2026-09-15 "Row Highlighting
 * & Focus" feature dimmed every unselected row by passing `anyRowHighlighted =
 * highlightedRowIds.size > 0` as a prop to EVERY row component. Those components are
 * React.memo'd precisely so a highlight only re-renders the row you clicked -- but a
 * table-wide boolean threaded through per-row props defeats that entirely: the very first
 * highlight flips it false->true for all rows at once, every row fails memo's shallow compare
 * simultaneously, and React re-renders and reconciles the whole un-virtualized table
 * synchronously inside the click handler. The fix moves the dim into CSS
 * (`.bf-has-highlight tbody tr:not(.bf-row-hl)`), so the 0<->1 transition changes exactly one
 * class on the <table> and zero row components re-render.
 *
 * WHY POL IS THE WORST CASE -- AND WHY THE "463 ROWS" NUMBER ELSEWHERE IN THIS REPO DOES NOT
 * APPLY TO IT. The app file's own comment above DetailTableRow justifies skipping
 * virtualization by noting the Detail table aggregates 8,769 raw rows down to 463. That is
 * true, and it is about the DETAIL tab. POL Booking Flash renders `filteredRawRows`
 * UNAGGREGATED -- measured at 9,232 <tr> / 193,417 <td> for the same file. Any future
 * reasoning about "how many rows can this table have" must not reuse the Detail number.
 *
 * ROW COUNT: the historical CSV has 8,769 rows, NOT the 27,312 `wc -l` reports -- quoted cells
 * contain embedded newlines. See perf_benchmark.js's header for the full warning.
 *
 * WHAT IT MEASURES, per tab, against the real historical CSV:
 *   0->1  first highlight (the expensive transition: `anyRowHighlighted` used to flip here)
 *   1->2  highlighting a second row while one is already highlighted (was always cheap --
 *         it is the control, and proves the harness is measuring the transition, not the click)
 *   >0->0 "Clear Highlights" (the other transition that used to flip the boolean back)
 * Each is reported as click->painted wall clock (minus the app's deliberate 300ms click/
 * double-click disambiguation defer), with click->DOM shown alongside it, plus the longest
 * single main-thread task observed during the interaction -- the longtask number is the one
 * that corresponds to "the page is frozen", since that is what blocks input. See
 * measureTransition's header for why there are two clocks and why measuring only the first
 * one hid seconds of real cost.
 *
 * Standalone, no test framework, matching this repo's tests/ convention. Shares
 * perf_benchmark.js's plumbing via require() rather than copying it -- see that file's
 * `require.main === module` guard comment for why copying the app-file detection rule is a bug
 * this repo has actually shipped.
 *
 *   node tests/perf_highlight_benchmark.js [--tab=pol_booking,detail] [--json=out.json]
 *
 * Exits non-zero if any transition exceeds its tab's budget, so it can gate CI.
 */

const fs = require('fs');
const path = require('path');
const {
    findCurrentAppHtml,
    ensureVendorFiles,
    extractCdnScriptUrls,
    startStaticServer,
    INIT_SCRIPT,
    CHROMIUM_PATH,
    REPO_ROOT,
    TESTS_DIR,
} = require('./perf_benchmark.js');

const THROWAWAY_HTML = path.join(TESTS_DIR, '_perf_highlight_throwaway_app.html');
const CSV_PATH = path.join(REPO_ROOT, 'Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv');
const CLICK_DEFER_MS = 300; // the app's own click/double-click disambiguation timer

// Budgets, set from MEASURED values rather than round numbers -- and the measurements are
// recorded here so nobody has to re-derive them, or quietly raise the bar to make a red run
// green. Three consecutive runs on this sandbox, real 8,769-row historical CSV, AFTER the
// 2026-09-19 Tailwind-JIT priming fix, reported as click->painted (click->DOM in brackets):
//
//   POL     0->1    3116.1 (1386.3)   1206.1 (280.5)   1182.8 (278.4)  ms
//   POL     1->2     557.3  (282.4)    653.6 (305.0)    559.2 (267.8)  ms
//   POL    >0->0    1073.3 (1067.8)   1112.5 (1112.2)  1010.0 (1009.7) ms
//   Detail  every transition   <=76.4ms painted in run 1, <=83.2ms across all three.
//
// Run 1 is simply a contended run -- its longest blocking task is 1678ms against 932/911ms in
// the other two, and every one of its numbers is inflated in proportion. Runs 2 and 3 agree to
// within 24ms on 0->1. Cross-run comparison on a busy machine is not evidence; for a real
// before/after, run both sides back to back in one process on a quiet box.
//
// WHY THE BUDGET IS LOOSER THAN IT USED TO BE. It was 3000ms against click->DOM. click->DOM
// stopped the clock before the browser did any of the work to show the change, so it was
// scoring roughly a quarter of the interaction: on the pre-fix build the first highlight
// reported 533.6ms of React with 3,521.6ms of rendering after it. Measuring what the user
// actually waits for raises every number, so the bar has to rise with it. 8000ms for POL still
// sits ~5x below the 41,000ms regression this file exists to catch, and 1500ms for Detail is
// ~18x above anything observed there -- a tab that is 20x smaller deserves its own bar rather
// than hiding behind POL's. Resist tightening either to "catch more": a perf gate that goes red
// on machine contention is one people learn to ignore, which is how the repo ends up with a
// check nobody trusts (see AGENTS.md's "Known flakiness" on exactly that failure mode for the
// regression suite). CI scales both via BF_HIGHLIGHT_BUDGET_SCALE, because shared runners are
// slower; read the printed per-transition numbers before ever touching that value.
//
// TWO THINGS THIS COMMENT USED TO SAY THAT WERE WRONG. Both are recorded rather than quietly
// deleted, because each cost a day.
//
// 1. "0->1 IS BIMODAL, not noisy" -- ~550ms on some runs and ~1720ms on others, with nothing in
//    between and the high readings agreeing to within 15ms, which looked far too tight to be
//    noise. It was noise: specifically, sustained machine load. Running the SAME 0->1 eight
//    times in one page session settles it, since only round 1 can carry a first-time cost:
//        busy box   1534 1529 1482 1491 1455 1496 1536 1486 ms
//        idle box    534  267  265  282  272  264  266  260 ms
//    Every round moves together by ~5x. A second deterministic code path cannot do that to
//    rounds 2-8; a loaded box can. Three readings agreeing to within 15ms means the load was
//    steady during that run, not that the app has two modes.
//
// 2. "The remaining cost is React rebuilding ~9,232 element descriptors ... the fix is to
//    useMemo the mapped row array." Built and measured (clean A/B, one process, idle box): ~7%
//    on 0->1 and nothing at all on Clear -- inside the run-to-run spread. Element construction
//    was never the bottleneck. Reverted rather than shipped.
//
// What the cost actually was, found by tracing instead of theorising: the FIRST highlight of a
// session inserted 7 new rules into the Tailwind Play CDN's stylesheet (the floating
// "N highlighted / Clear" button is the only user of `fixed bottom-4 right-4 z-40 rounded-full
// shadow-lg dark:hover:bg-blue-900`), and Blink answers any stylesheet rule change with a
// whole-document style invalidation -- 221,512 elements, 2.6-5.1s, reason "Style rule change".
// Fixed at the source by priming the JIT at load; see the block at the bottom of the app file.
// If you are here because 0->1 is slow again, check whether something re-introduced a
// first-use-at-click utility class before assuming it is React.
const BUDGETS_MS = { pol_booking: 8000, detail: 1500 };
const BUDGET_SCALE = Number(process.env.BF_HIGHLIGHT_BUDGET_SCALE) || 1;
const budgetFor = (tabKey) => Math.round((BUDGETS_MS[tabKey] || BUDGETS_MS.pol_booking) * BUDGET_SCALE);

const TABS = { pol_booking: 'POL Booking Flash', detail: 'Booking Flash' };

// Printed with the results so a run's numbers are never read without the bar they were judged
// against -- the same reason the app-file auto-detect prints which file it picked.
const BUDGET_SOURCE = process.env.BF_HIGHLIGHT_BUDGET_SCALE ? `BF_HIGHLIGHT_BUDGET_SCALE=${BUDGET_SCALE}` : 'default scale 1';

function parseArgs(argv) {
    const opts = { tabs: Object.keys(TABS), json: null };
    for (const arg of argv) {
        let m;
        if ((m = /^--tab=(.+)$/.exec(arg))) opts.tabs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
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

/**
 * Click a row (or the Clear Highlights button) and wait for the resulting visual state,
 * recording the longest main-thread task while we wait. Runs entirely in-page so the timer
 * is not distorted by CDP round-trips -- the bug being guarded against wedges the main
 * thread, which would make any out-of-page polling wildly optimistic.
 *
 * TWO clocks, because stopping at the first one hid a 2.7-SECOND cost for a full day (fixed
 * 2026-09-19):
 *
 *   reactMs    click -> the DOM carries the new .bf-row-hl state. This is React's render and
 *              commit, and it is ALL the old version of this file measured.
 *   paintedMs  click -> the frame that renders that change has finished. A rAF callback runs
 *              at the START of a frame, before style/layout/paint, so the first rAF that sees
 *              the new DOM fires BEFORE the browser has done any of the work to show it. One
 *              more rAF lands after that work. Everything expensive about this interaction --
 *              the whole-document style recalc, the 9,232-row layout, the paint -- lives in
 *              that gap, which reactMs skipped entirely. Measured on the pre-fix build: the
 *              first highlight reported 533.6ms of reactMs with 3,521.6ms of rendering after
 *              it.
 *
 * paintedMs is what the user waits for, so it is the number the budget gates on. reactMs is
 * still reported because the split localises a regression: reactMs moving means the React
 * side (a memo break, a prop that changes for every row), paintedMs moving alone means the
 * browser side (selector cost, stylesheet churn, element count).
 *
 * paintedMs can include up to one extra idle frame (~16ms) when the state update happened to
 * land inside a BeginMainFrame that also did the rendering, which is the usual case for Clear
 * Highlights. At this budget that rounding does not matter.
 */
async function measureTransition(page, action, expect) {
    return page.evaluate(async ({ action, expect, deferMs }) => {
        const settled = () => {
            const n = document.querySelectorAll('tbody tr.bf-row-hl').length;
            return expect === 'none' ? n === 0 : n === expect;
        };
        let maxLongTask = 0;
        let obs = null;
        try {
            obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) maxLongTask = Math.max(maxLongTask, e.duration);
            });
            obs.observe({ entryTypes: ['longtask'] });
        } catch (_) { /* longtask unsupported -- fall back to wall clock only */ }

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        let target;
        if (action.kind === 'row') {
            // Only real rows are clickable: blank spacer rows carry no onClick at all.
            const rows = Array.from(document.querySelectorAll('tbody tr'))
                .filter((tr) => !tr.querySelector('td[colspan]'));
            target = rows[Math.min(action.index, rows.length - 1)];
            if (!target) throw new Error('no clickable row found');
        } else {
            target = Array.from(document.querySelectorAll('button'))
                .find((b) => b.textContent.trim() === 'Clear Highlights');
            if (!target) throw new Error('Clear Highlights button not found');
        }

        const t0 = performance.now();
        target.click();
        const syncMs = performance.now() - t0;

        const deadline = t0 + 120000;
        while (!settled()) {
            if (performance.now() > deadline) throw new Error('timed out waiting for highlight state');
            await new Promise((r) => requestAnimationFrame(r));
        }
        const domMs = performance.now() - t0;
        // One more frame: this callback runs after the browser has finished the style, layout
        // and paint for the frame that renders the change. See this function's header.
        const paintedRaw = await new Promise((r) => requestAnimationFrame(() => r(performance.now() - t0)));
        if (obs) obs.disconnect();

        // Subtract the app's deliberate 300ms defer, which is intended UX, not cost.
        const defer = action.kind === 'row' ? deferMs : 0;
        return {
            syncMs: Math.round(syncMs * 10) / 10,
            reactMs: Math.round(Math.max(0, domMs - defer) * 10) / 10,
            paintedMs: Math.round(Math.max(0, paintedRaw - defer) * 10) / 10,
            maxLongTaskMs: Math.round(maxLongTask * 10) / 10,
        };
    }, { action, expect, deferMs: CLICK_DEFER_MS });
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    let chromium;
    try { ({ chromium } = require('playwright')); }
    catch (e) { console.error('❌ playwright not installed. Run: npm install'); process.exit(1); }

    if (!fs.existsSync(CSV_PATH)) { console.error(`❌ missing data file: ${CSV_PATH}`); process.exit(1); }

    const appHtmlPath = findCurrentAppHtml();
    console.log(`(auto-detected current app version: ${path.basename(appHtmlPath)})`);
    console.log(`(budgets: ${Object.keys(TABS).map((k) => `${k} ${budgetFor(k)}ms`).join(', ')}, ${BUDGET_SOURCE})`);

    const urls = extractCdnScriptUrls(fs.readFileSync(appHtmlPath, 'utf8'));
    const urlToFile = await ensureVendorFiles(urls);
    buildThrowawayCopy(appHtmlPath, urlToFile);

    const server = await startStaticServer(REPO_ROOT);
    const port = server.address().port;
    const appUrl = `http://127.0.0.1:${port}/tests/${path.basename(THROWAWAY_HTML)}`;
    const summary = { appFile: path.basename(appHtmlPath), budgetsMs: Object.fromEntries(Object.keys(TABS).map((k) => [k, budgetFor(k)])), tabs: {} };
    const failures = [];

    // Point at a specific Chromium ONLY when that path actually exists. CHROMIUM_PATH defaults
    // to this repo's sandbox location (/opt/pw-browsers/...), where AGENTS.md forbids
    // `playwright install` -- but a CI runner installs to ~/.cache/ms-playwright instead, so
    // passing the sandbox path there fails with "executable doesn't exist" before a single
    // measurement runs. That is exactly how this job went red the first time it ever ran.
    // Falling back to Playwright's own resolution keeps both environments working: the sandbox
    // still uses its pre-installed browser and never downloads one, CI uses what it installed.
    // (tests/ci_regression_runner.js has the mirror-image bug -- it ALWAYS uses Playwright's
    // default, so it works in CI and cannot run in the sandbox at all. Worth fixing the same
    // way; deliberately not done here, to keep this commit to its own subject.)
    const launchOpts = { args: ['--no-sandbox'] };
    if (fs.existsSync(CHROMIUM_PATH)) launchOpts.executablePath = CHROMIUM_PATH;
    else console.log(`(no browser at ${CHROMIUM_PATH} -- using Playwright's own resolution)`);
    const browser = await chromium.launch(launchOpts);
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript(INIT_SCRIPT);
        page.on('pageerror', (e) => { failures.push(`page error: ${e.message}`); });
        await page.goto(appUrl, { waitUntil: 'load' });

        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached' });
        await fileInput.setInputFiles(CSV_PATH);
        await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 180000 });

        for (const tabKey of opts.tabs) {
            const label = TABS[tabKey];
            if (!label) throw new Error(`unknown --tab value "${tabKey}" (known: ${Object.keys(TABS).join(', ')})`);
            console.log(`\n${'='.repeat(74)}\n== ${label}\n${'='.repeat(74)}`);

            await page.evaluate((l) => {
                const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === l);
                if (!btn) throw new Error(`tab button "${l}" not found`);
                btn.click();
            }, label);
            await page.waitForTimeout(800);

            const rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
            const cells = await page.evaluate(() => document.querySelectorAll('td,th').length);
            console.log(`  ${rows} body rows, ${cells} td/th`);

            const r = { label, bodyRows: rows, cells, transitions: {} };
            summary.tabs[tabKey] = r;

            r.transitions['0->1'] = await measureTransition(page, { kind: 'row', index: 0 }, 1);
            r.transitions['1->2'] = await measureTransition(page, { kind: 'row', index: 5 }, 2);
            r.transitions['>0->0'] = await measureTransition(page, { kind: 'clear' }, 'none');

            const budget = budgetFor(tabKey);
            for (const [name, m] of Object.entries(r.transitions)) {
                const worst = Math.max(m.paintedMs, m.maxLongTaskMs);
                const ok = worst <= budget;
                if (!ok) failures.push(`${label} ${name}: ${worst.toFixed(1)}ms > ${budget}ms budget`);
                console.log(
                    `  ${ok ? '✅' : '❌'} ${name.padEnd(6)} click->painted ${String(m.paintedMs).padStart(8)}ms` +
                    `   (react ${String(m.reactMs).padStart(7)}ms)` +
                    `   longest blocking task ${String(m.maxLongTaskMs).padStart(8)}ms`
                );
            }
        }
    } finally {
        await browser.close();
        server.close();
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML);
    }

    if (opts.json) { fs.writeFileSync(opts.json, JSON.stringify(summary, null, 2)); console.log(`\nwrote ${opts.json}`); }

    console.log(`\n${'='.repeat(74)}`);
    if (failures.length) { console.log('❌ FAIL'); for (const f of failures) console.log(`   - ${f}`); process.exit(1); }
    console.log('✅ PASS -- every highlight transition within its budget');
}

if (require.main === module) {
    main().catch((e) => {
        console.error('❌ Highlight benchmark run failed:', e);
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML);
        process.exit(1);
    });
}

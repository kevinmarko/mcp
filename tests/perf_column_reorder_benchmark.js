#!/usr/bin/env node
/**
 * Column-reorder remount benchmark + regression check (D67, "drag column headers to rearrange columns").
 *
 * WHY THIS EXISTS. D67 (PR #250) lets the user drag a header to move a column. `reorderColumnCells(rank, cells,
 * decorate)` returns the caller's own nested Fragment while a tab is in its DEFAULT order, but a flat,
 * React.Children.toArray-rekeyed array in a CUSTOM order. React cannot reconcile a nested Fragment against a flat keyed
 * array, so every time a tab's order switches default <-> custom it UNMOUNTS AND REMOUNTS EVERY CELL OF EVERY ROW. The
 * header rows flip between the decorated (draggable) and raw paths the same way when Freeze Panes is toggled. The
 * switches happen on: the first drop on a tab, a Freeze Panes toggle while a custom order is saved (freeze forces the
 * default order), "Reset column order", and a drop that happens to restore the default order. POL Booking Flash renders up
 * to ~9,232 unaggregated rows (~190k cells) with the historical CSV and Detail ~450 rows, so a remount is seconds of
 * main-thread time, not milliseconds. The functional regression suite cannot see this: the cells are re-created with the
 * right content, so every text assertion still passes. Only DOM-node IDENTITY and the wall clock show it.
 *
 * WHAT IT MEASURES, per tab (Detail "Booking Flash" and "POL Booking Flash"), against the real historical CSV:
 *   a  first move away from the default order            (drag, default -> custom)
 *   b  a second move while already in a custom order      (drag, custom -> custom)
 *   c  Freeze Panes ON, then OFF, with a custom order saved (freeze forces default order, so ON is custom -> default and
 *      OFF is default -> custom)
 *   d  the Fields picker's "Reset column order" button    (custom -> default)
 *   e  a move that puts the columns back in default order (drag, custom -> default)
 * For each action:
 *   SURVIVAL  before the action a sample of body <td> nodes (~20 rows spread through the table, every cell in them) and
 *             EVERY header <th> node is tagged with an expando (node.__bfProbe = 1). After the commit we count how many
 *             tagged nodes are still connected AND still carry the tag. React keeps the DOM node when it MOVES a keyed
 *             child, so a correct implementation keeps ~100%; a remount keeps 0%. This is the pass/fail signal.
 *   TIMING    action -> DOM commit (the column order in the DOM changed / the toggle flipped) and action -> painted
 *             (double rAF: the second callback runs after style/layout/paint of the frame that shows the change), plus
 *             the longest main-thread task (PerformanceObserver 'longtask') -- the number that corresponds to "the
 *             page is frozen". Same two-clock reasoning as perf_highlight_benchmark.js's measureTransition.
 * The drag is real HTML5 drag events (dragstart / dragover / drop / dragend, with a DataTransfer and clientX in the left or
 * right quarter of the target th) dispatched on `th[data-col-unit]` cells, the way the regression suite does it. After
 * each drag the DOM column order is read back and must have changed (or equal the default, for d and e), so a drag that
 * silently did nothing cannot pass as "100% survival".
 *
 * A fresh browser context (so empty localStorage, hence no saved bookingFlashColumnOrder -- COLUMN_ORDER_STORAGE_KEY)
 * is used for each tab, and the CSV is loaded in it; the tabs do not leak a custom order into each other.
 *
 * Standalone, no test framework. Shares perf_benchmark.js's plumbing via require() rather than copying it -- see that file's
 * `require.main === module` guard comment for why copying the app-file detection rule is a bug this repo has shipped.
 * BF_APP_HTML=dist/index.html measures the deploy artifact (resolveAppHtml honours it).
 *
 *   node tests/perf_column_reorder_benchmark.js [--tab=pol_booking,detail] [--json=out.json] [--pol-windowed]
 *     --pol-windowed: leave POL in its normal windowed view (what people see) instead of rendering every row.
 *   BF_APP_HTML=dist/index.html node tests/perf_column_reorder_benchmark.js
 *
 * Exits non-zero if any action's header or body survival is below MIN_SURVIVAL, if a drag did not change the DOM order, or if
 * an action exceeds its tab's timing budget.
 */

const fs = require('fs');
const path = require('path');
const {
    resolveAppHtml,
    ensureVendorFiles,
    extractCdnScriptUrls,
    startStaticServer,
    INIT_SCRIPT,
    CHROMIUM_PATH,
    REPO_ROOT,
    TESTS_DIR,
} = require('./perf_benchmark.js');

// Per process, like perf_highlight_benchmark.js, so a source run and a dist/ run at once cannot overwrite each other.
// The name matches .gitignore's tests/_*throwaway*.html and every exit path deletes it.
const THROWAWAY_HTML = path.join(TESTS_DIR, `_perf_colreorder_throwaway_app_${process.pid}.html`);
const CSV_PATH = path.join(REPO_ROOT, 'Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv');
const TABS = { detail: 'Booking Flash', pol_booking: 'POL Booking Flash' };
const SAMPLE_ROWS = 20;

// A correct implementation moves keyed DOM nodes, so ~100% survive. 90% leaves room for a handful of legitimately
// re-created nodes (a cell whose key or span changes) without letting a wholesale remount (0%) anywhere near passing.
const MIN_SURVIVAL = 0.9;

// Timing budgets (ms), applied to max(action->painted, longest task) of EVERY action. Survival is the primary gate; these
// only stop a different kind of regression. Measured 2026-10-27 on the UNFIXED build (remount on order switches), this
// sandbox, source and dist/ within ~25% of each other, action->painted:
//   Detail (495 rows)  b (no remount, pure re-render) 194-241ms; remounting actions 317-719ms.
//   POL (8,769 rows)   b (no remount, pure re-render) 3.8-5.6s;  remounting actions 7.2-14.5s (c1/c2/d/a worst).
// So 100% survival does NOT make POL cheap: the second drag, which keeps every node, still re-renders ~200k cells in 4-6s.
// Detail 1500 is ~2x the worst remount seen. POL 12000 sits between the worst b (5.6s) and the worst remount (14.5s): a fixed
// build whose order switches cost about what b costs passes with 2x headroom, the unfixed one fails c2/d/a. Tighten after
// the fix lands and its numbers are known. BF_COLREORDER_BUDGET_SCALE scales both for slower runners.
const BUDGETS_MS = { detail: 1500, pol_booking: 12000 };
const BUDGET_SCALE = Number(process.env.BF_COLREORDER_BUDGET_SCALE) || 1;
const budgetFor = (tabKey) => Math.round(BUDGETS_MS[tabKey] * BUDGET_SCALE);

function parseArgs(argv) {
    const opts = { tabs: Object.keys(TABS), json: null, polWindowed: false };
    for (const arg of argv) {
        let m;
        if (arg === '--pol-windowed') opts.polWindowed = true;
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
 * Runs in the page. Tags nodes, performs one action, waits for the commit and the paint, and reports survival + timing.
 * spec: { kind: 'drag'|'freeze'|'reset', src, tgt, side, expect: 'changed'|'default'|'freezeOn'|'freezeOff', sample }
 * Everything that is not the action itself (finding elements, tagging, counting) happens outside the timed window.
 */
function inPageAction(spec) {
    const tableOf = () => Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility() && !t.closest('[data-analysis-modal]') && t.querySelector('thead input[aria-label^="Filter by "]')) || null;
    const unitOrder = () => {
        const t = tableOf();
        const seen = [];
        if (t) t.querySelectorAll('thead th[data-col-unit]').forEach((th) => { const u = th.getAttribute('data-col-unit'); if (seen.indexOf(u) < 0) seen.push(u); });
        return seen;
    };
    const thOf = (u) => { const t = tableOf(); return t ? t.querySelector(`thead th[data-col-unit="${u}"]`) : null; };
    const point = (el, side) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * (side === 'before' ? 0.25 : 0.75), y: r.top + r.height / 2 }; };
    const fire = (type, el, dt, p) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: p.x, clientY: p.y }));
    const freezeBtn = () => document.querySelector('button[data-setting="freeze-panes"]');
    const resetBtn = () => {
        const all = Array.from(document.querySelectorAll('[data-column-order-reset]')).filter((b) => b.checkVisibility());
        return all.find((b) => b.closest('[data-field-picker-panel]')) || all[0] || null;
    };

    return (async () => {
        const table = tableOf();
        if (!table) throw new Error('no visible filterable table');
        const before = unitOrder();
        const dflt = spec.defaultOrder;

        // ---- tag (untimed) ----
        const rows = Array.from(table.tBodies[0].rows).filter((tr) => !tr.querySelector('td[colspan]') && tr.cells.length > 3);
        const step = Math.max(1, Math.floor(rows.length / spec.sample));
        const tagged = { td: [], th: [], tr: [] };
        for (let i = 0, n = 0; i < rows.length && n < spec.sample; i += step, n++) {
            tagged.tr.push(rows[i]);
            Array.from(rows[i].cells).forEach((c) => tagged.td.push(c));
        }
        table.querySelectorAll('thead th').forEach((th) => tagged.th.push(th));
        ['td', 'th', 'tr'].forEach((k) => tagged[k].forEach((n) => { n.__bfProbe = 1; }));

        let maxLongTask = 0;
        let obs = null;
        try {
            obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) maxLongTask = Math.max(maxLongTask, e.duration); });
            obs.observe({ entryTypes: ['longtask'] });
        } catch (_) { /* longtask unsupported: wall clock only */ }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const maxLongTaskBefore = maxLongTask; // long tasks from our own tagging, if any

        let target = null, dt = null, s0 = null, t1 = null, btn = null;
        if (spec.kind === 'drag') {
            s0 = thOf(spec.src); t1 = thOf(spec.tgt);
            if (!s0 || !t1) throw new Error(`no draggable header for ${!s0 ? spec.src : spec.tgt}`);
            dt = new DataTransfer();
            // dragstart + dragover only set refs / a CSS mark, so they are outside the clock; the DROP is the action.
            fire('dragstart', s0, dt, point(s0, 'before'));
            fire('dragover', t1, dt, point(t1, spec.side));
            await new Promise((r) => setTimeout(r, 30));
            t1 = thOf(spec.tgt) || t1;
        } else if (spec.kind === 'freeze') {
            btn = freezeBtn();
            if (!btn) throw new Error('no Freeze panes button (is Settings open?)');
        } else {
            btn = resetBtn();
            if (!btn || btn.disabled) throw new Error('Reset column order button missing or disabled');
        }

        const settled = () => {
            if (spec.expect === 'freezeOn') return freezeBtn() && freezeBtn().getAttribute('aria-pressed') === 'true';
            if (spec.expect === 'freezeOff') return freezeBtn() && freezeBtn().getAttribute('aria-pressed') === 'false';
            const now = unitOrder();
            if (spec.expect === 'default') return now.join() === dflt.join();
            return now.join() !== before.join();
        };

        // ---- the action (timed) ----
        const t0 = performance.now();
        if (spec.kind === 'drag') fire('drop', t1, dt, point(t1, spec.side));
        else btn.click();
        const syncMs = performance.now() - t0;
        const deadline = t0 + 120000;
        while (!settled()) {
            if (performance.now() > deadline) throw new Error(`timed out waiting for the DOM to settle (${spec.expect})`);
            await new Promise((r) => requestAnimationFrame(r));
        }
        const domMs = performance.now() - t0;
        const paintedMs = await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t0))));
        if (obs) obs.disconnect();
        if (spec.kind === 'drag') { const e = s0.isConnected ? s0 : (thOf(spec.src) || table); fire('dragend', e, dt, point(e, 'before')); }

        // ---- survival (untimed) ----
        const alive = (arr) => arr.filter((n) => n.isConnected && n.__bfProbe === 1).length;
        const pct = (a, n) => (n ? a / n : 1);
        const after = unitOrder();
        const out = {
            syncMs: Math.round(syncMs * 10) / 10,
            domMs: Math.round(domMs * 10) / 10,
            paintedMs: Math.round(paintedMs * 10) / 10,
            maxLongTaskMs: Math.round(Math.max(0, maxLongTask) * 10) / 10,
            body: { tagged: tagged.td.length, alive: alive(tagged.td), rate: pct(alive(tagged.td), tagged.td.length) },
            head: { tagged: tagged.th.length, alive: alive(tagged.th), rate: pct(alive(tagged.th), tagged.th.length) },
            rowsAlive: { tagged: tagged.tr.length, alive: alive(tagged.tr) },
            orderBefore: before, orderAfter: after,
            orderChanged: after.join() !== before.join(),
            orderIsDefault: after.join() === dflt.join(),
            tableChanged: tableOf() !== table,
        };
        ['td', 'th', 'tr'].forEach((k) => tagged[k].forEach((n) => { try { delete n.__bfProbe; } catch (_) { /* ignore */ } }));
        void maxLongTaskBefore;
        return out;
    })();
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    let chromium;
    try { ({ chromium } = require('playwright')); }
    catch (e) { console.error('❌ playwright not installed. Run: npm install'); process.exit(1); }
    if (!fs.existsSync(CSV_PATH)) { console.error(`❌ missing data file: ${CSV_PATH}`); process.exit(1); }
    for (const t of opts.tabs) if (!TABS[t]) { console.error(`❌ unknown --tab value "${t}" (known: ${Object.keys(TABS).join(', ')})`); process.exit(1); }

    const appHtmlPath = resolveAppHtml();
    console.log(`(app file under test: ${path.relative(REPO_ROOT, appHtmlPath)})`);
    console.log(`(min survival ${MIN_SURVIVAL * 100}%; budgets: ${Object.keys(TABS).map((k) => `${k} ${budgetFor(k)}ms`).join(', ')}${process.env.BF_COLREORDER_BUDGET_SCALE ? `, BF_COLREORDER_BUDGET_SCALE=${BUDGET_SCALE}` : ''})`);

    const urls = extractCdnScriptUrls(fs.readFileSync(appHtmlPath, 'utf8'));
    const urlToFile = await ensureVendorFiles(urls);
    buildThrowawayCopy(appHtmlPath, urlToFile);
    const server = await startStaticServer(REPO_ROOT);
    const appUrl = `http://127.0.0.1:${server.address().port}/tests/${path.basename(THROWAWAY_HTML)}`;

    const summary = { appFile: path.relative(REPO_ROOT, appHtmlPath), minSurvival: MIN_SURVIVAL, budgetsMs: Object.fromEntries(Object.keys(TABS).map((k) => [k, budgetFor(k)])), tabs: {} };
    const failures = [];
    const launchOpts = { args: ['--no-sandbox'] };
    if (fs.existsSync(CHROMIUM_PATH)) launchOpts.executablePath = CHROMIUM_PATH;
    const browser = await chromium.launch(launchOpts);
    try {
        for (const tabKey of opts.tabs) {
            const label = TABS[tabKey];
            console.log(`\n${'='.repeat(96)}\n== ${label}\n${'='.repeat(96)}`);
            // Fresh context = empty localStorage = no saved column order for this tab (see header).
            const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
            const page = await context.newPage();
            await page.addInitScript(INIT_SCRIPT);
            page.on('pageerror', (e) => { failures.push(`${label}: page error: ${e.message}`); });
            await page.goto(appUrl, { waitUntil: 'load' });
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.waitFor({ state: 'attached' });
            await fileInput.setInputFiles(CSV_PATH);
            await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 180000 });
            await page.evaluate(() => { try { localStorage.removeItem('bookingFlashColumnOrder'); } catch (_) { /* ignore */ } });

            await page.evaluate((l) => {
                const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === l);
                if (!btn) throw new Error(`tab button "${l}" not found`);
                btn.click();
            }, label);
            await page.waitForTimeout(800);
            if (tabKey === 'pol_booking' && !opts.polWindowed) {
                // POL is windowed (~120 rows). Remount cost scales with rows, so measure the full table, as perf_highlight_benchmark does.
                await page.evaluate(() => window.dispatchEvent(new CustomEvent('bookingflash:pol-render-all', { detail: true })));
                await page.waitForFunction(() => {
                    const t = Array.from(document.querySelectorAll('table')).find((el) => el.checkVisibility() && el.querySelector('caption') && el.querySelector('caption').textContent.trim() === 'POL Booking Flash');
                    return t && !t.querySelector('tr[data-pol-vt-spacer]') && t.tBodies[0].rows.length > 1000;
                }, { timeout: 60000 });
                await page.waitForTimeout(800);
            }

            const info = await page.evaluate(() => {
                const t = Array.from(document.querySelectorAll('table')).find((el) => el.checkVisibility() && !el.closest('[data-analysis-modal]') && el.querySelector('thead input[aria-label^="Filter by "]'));
                const units = [];
                t.querySelectorAll('thead th[data-col-unit]').forEach((th) => { const u = th.getAttribute('data-col-unit'); if (units.indexOf(u) < 0) units.push(u); });
                const rows = Array.from(t.tBodies[0].rows).filter((tr) => !tr.querySelector('td[colspan]')).length;
                return { units, rows, cells: Array.from(t.querySelectorAll('td,th')).length };
            });
            const U = info.units;
            if (U.length < 12) throw new Error(`${label}: only ${U.length} draggable units found; expected a full default view`);
            console.log(`  ${info.rows} body rows, ${info.cells} td/th, ${U.length} draggable units; default order: ${U.slice(0, 6).join(',')},...`);
            const defaultOrder = U.slice();
            // Two adjacent pairs far apart. Swap u1 after u2 (a, e restores); move u3 after u4 (b).
            const [u1, u2, u3, u4] = [U[2], U[3], U[7], U[8]];

            const openSettings = () => page.evaluate(async () => {
                if (document.querySelector('button[data-setting="freeze-panes"]')) return;
                document.querySelector('[data-settings-trigger]').click();
                for (let i = 0; i < 100 && !document.querySelector('button[data-setting="freeze-panes"]'); i++) await new Promise((r) => setTimeout(r, 30));
                if (!document.querySelector('button[data-setting="freeze-panes"]')) throw new Error('Settings did not open');
            });
            const closeSettings = () => page.evaluate(async () => {
                if (!document.querySelector('button[data-setting="freeze-panes"]')) return;
                document.querySelector('[data-settings-trigger]').click();
                await new Promise((r) => setTimeout(r, 200));
            });
            const openPicker = () => page.evaluate(async () => {
                if (!document.querySelector('[data-field-picker-panel]')) document.querySelector('[data-field-picker-trigger]').click();
                for (let i = 0; i < 100 && !document.querySelector('[data-field-picker-panel]'); i++) await new Promise((r) => setTimeout(r, 30));
                if (!document.querySelector('[data-field-picker-panel]')) throw new Error('Fields picker did not open');
            });
            const closePicker = () => page.evaluate(async () => {
                if (!document.querySelector('[data-field-picker-panel]')) return;
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await new Promise((r) => setTimeout(r, 200));
            });
            const run = (spec) => page.evaluate(inPageAction, Object.assign({ sample: SAMPLE_ROWS, defaultOrder }, spec));
            const settle = () => page.waitForTimeout(600);

            const results = [];
            const record = async (id, name, spec, expectOrder) => {
                const m = await run(spec);
                m.id = id; m.name = name;
                m.orderOk = expectOrder === 'changed' ? m.orderChanged : expectOrder === 'default' ? m.orderIsDefault : true;
                results.push(m);
                await settle();
                return m;
            };

            // a: default -> custom
            await record('a', 'first move (default->custom)', { kind: 'drag', src: u1, tgt: u2, side: 'after', expect: 'changed' }, 'changed');
            // b: custom -> custom
            await record('b', 'second move (custom->custom)', { kind: 'drag', src: u3, tgt: u4, side: 'after', expect: 'changed' }, 'changed');
            // c: Freeze Panes on (custom saved -> forced default), then off (back to the saved custom)
            await openSettings();
            await record('c1', 'Freeze ON, custom saved (->default)', { kind: 'freeze', expect: 'freezeOn' }, null); // frozen headers carry no data-col-unit, so there is no order to read back
            await record('c2', 'Freeze OFF (->saved custom)', { kind: 'freeze', expect: 'freezeOff' }, 'changed');
            await closeSettings();
            // d: Reset column order (custom -> default)
            await openPicker();
            await record('d', 'Reset column order (custom->default)', { kind: 'reset', expect: 'default' }, 'default');
            await closePicker();
            // e: untimed move to custom, then the timed move that restores the default order
            await run({ kind: 'drag', src: u1, tgt: u2, side: 'after', expect: 'changed' });
            await settle();
            await record('e', 'move restoring default (custom->default)', { kind: 'drag', src: u1, tgt: u2, side: 'before', expect: 'default' }, 'default');

            summary.tabs[tabKey] = { label, bodyRows: info.rows, cells: info.cells, results };
            const budget = budgetFor(tabKey);
            for (const m of results) {
                const problems = [];
                if (m.body.rate < MIN_SURVIVAL) problems.push(`body survival ${(m.body.rate * 100).toFixed(1)}% < ${MIN_SURVIVAL * 100}%`);
                if (m.head.rate < MIN_SURVIVAL) problems.push(`header survival ${(m.head.rate * 100).toFixed(1)}% < ${MIN_SURVIVAL * 100}%`);
                if (!m.orderOk) problems.push('the DOM column order did not end up as expected');
                const worst = Math.max(m.paintedMs, m.maxLongTaskMs);
                if (worst > budget) problems.push(`${worst.toFixed(0)}ms > ${budget}ms budget`);
                m.problems = problems;
                if (problems.length) failures.push(`${label} ${m.id} ${m.name}: ${problems.join('; ')}`);
                console.log(
                    `  ${problems.length ? '❌' : '✅'} ${m.id.padEnd(2)} ${m.name.padEnd(38)}` +
                    ` body ${String(m.body.alive).padStart(5)}/${String(m.body.tagged).padEnd(5)} ${(m.body.rate * 100).toFixed(0).padStart(3)}%` +
                    `  head ${String(m.head.alive).padStart(3)}/${String(m.head.tagged).padEnd(3)} ${(m.head.rate * 100).toFixed(0).padStart(3)}%` +
                    `  dom ${String(m.domMs).padStart(8)}ms  painted ${String(m.paintedMs).padStart(8)}ms  longtask ${String(m.maxLongTaskMs).padStart(8)}ms` +
                    `${m.tableChanged ? '  [TABLE ELEMENT REPLACED]' : ''}`
                );
            }
            await context.close();
        }
    } finally {
        await browser.close();
        server.close();
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML);
    }

    if (opts.json) { fs.writeFileSync(opts.json, JSON.stringify(summary, null, 2)); console.log(`\nwrote ${opts.json}`); }
    console.log(`\n${'='.repeat(96)}`);
    if (failures.length) { console.log('❌ FAIL'); for (const f of failures) console.log(`   - ${f}`); process.exit(1); }
    console.log('✅ PASS -- every column-order action kept its DOM nodes and stayed within budget');
}

if (require.main === module) {
    main().catch((e) => {
        console.error('❌ Column-reorder benchmark run failed:', e);
        if (fs.existsSync(THROWAWAY_HTML)) fs.unlinkSync(THROWAWAY_HTML);
        process.exit(1);
    });
}

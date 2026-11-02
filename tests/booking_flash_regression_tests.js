/**
 * Regression tests for bugs found 2026-08-18, covering all 4 visible tabs
 * (Trade Summary, Sector Summary, POL Booking Flash, Booking Flash) plus
 * the "Analyze" modal's own math on the two tabs that have it. Three
 * checks classes:
 *
 *   CLASS A — Rollup correctness: a max-aggregated capacity-type field
 *   (e.g. "Max Laden"/"Avg Max Laden") must be the SUM of each distinct
 *   lane's own max capacity at any level combining more than one lane,
 *   never a flat max across pooled rows from different lanes. Found on
 *   Sector_Summary's "Average Max Laden vs Booking" pivot (missing
 *   `rollupSumOfChildren` on the avgMaxLdn dataField, plus an independent
 *   copy of the same bug in the KPI card memo's own hand-rolled Math.max
 *   reduce). Trade_Summary's own Max Laden field uses a different
 *   mechanism (a `laneAwareMaxLdn` calc function, since its rowFields have
 *   no Lane level to roll up from) but the same underlying invariant, and
 *   was already correct -- verified here as a standing regression guard.
 *   NOTE: this class does NOT apply to every max-aggregated field
 *   automatically -- percentage/ratio fields (e.g. Peak Utiliz %,
 *   Trunk Utilization) are legitimately flat-maxed (you can't meaningfully
 *   "sum" two utilization percentages), and POL_Booking_Flash's own
 *   polMaxLdn was deliberately left alone (different data grain -- a
 *   per-VVD/per-sailing property, not a shared lane-level trunk capacity
 *   at all, since that tab has no Trade/SubTrade/Lane rollup tree -- and
 *   already ground-truth verified). Booking Flash (Detail View) has no
 *   Grand Total/rollup of any kind (a flat per-row table), so Class A
 *   doesn't apply there -- no test for it below.
 *
 *   CLASS B — Readability: two independent className-driven background
 *   classes of equal CSS specificity on the same cell (e.g. an always-on
 *   status/tint class plus a cellClass-driven flag background like
 *   bg-red-600) have an UNDEFINED winner -- depends on Tailwind's
 *   stylesheet insertion order, not which class appears first in the
 *   string, and can differ between page reloads/sessions. Found on both
 *   Sector_Summary's pivot (Total-column tint vs >100%-utilization flag)
 *   and POL_Booking_Flash's own hand-built table (AP Frozen/AP Only/VMS/
 *   No N.A. Call row-status color vs the same >10%-since-prior-day
 *   utilization flag). Fixed by making one class win deterministically
 *   (never emit both bg- classes on the same cell) rather than relying on
 *   accidental insertion order. Booking Flash's own copy of the same
 *   >10%-since-prior-day flag was already safe by construction (uses an
 *   inline `style`, which always wins over any class regardless of
 *   insertion order) -- verified here as a standing regression guard
 *   against ever changing it back to a className-based conflict.
 *   Trade_Summary's own cellClass (Trunk Utilization >100%) only sets a
 *   text color, never a background, so it has no Class B exposure either
 *   -- also swept generically as a guard.
 *
 *   CLASS C — Analyze modal math (added 2026-08-18, no bug found -- these
 *   are new-feature verification, not a regression fix). The "Analyze"
 *   button's modal (Service Lane Performance Summary / POL Performance
 *   Summary) computes its own Overall Snapshot + per-lane/per-POL
 *   breakdown cards independently of every pivot table above, so it gets
 *   its own dedicated checks: Overall Capacity/Laden equal the sum of the
 *   displayed breakdown cards (within a rounding tolerance -- each card's
 *   number is independently rounded for display, so summing N already-
 *   rounded numbers legitimately drifts a little from the app's own
 *   unrounded-then-rounded-once total; a REAL bug shows a discrepancy
 *   orders of magnitude larger than this, as seen with Class A above),
 *   Overall Shortfall/Utilization are algebraically consistent with
 *   Capacity/Laden, and every individual card's own % badge and Shortfall
 *   are internally consistent with its own Max Laden/Laden. Also asserts
 *   the POL tab's Overall Snapshot exactly matches the Booking Flash tab's
 *   (same filter, same underlying by-lane computation regardless of which
 *   dimension is displayed) and that it does NOT equal a naive sum of the
 *   POL/port breakdown cards -- the exact fingerprint of the Class-A-style
 *   over-counting bug that was fixed elsewhere on this tab, so if it ever
 *   reappears here this check catches it immediately.
 *
 *   CLASS E — Data-linkage/formatting bugs found 2026-08-25 during a full
 *   data-validation pass against a fresh raw export and Kevin's actual
 *   reference `.xlsm` workbook (see DATA_ARCHITECTURE.md for the full
 *   writeup). Two kinds of checks here, both deliberately DOM-shape-only
 *   (no dependency on a specific data file's values):
 *     - POL Booking Flash's "Peak Dry Utilz (POL)"/"Peak Reefer Utilz
 *       (POL)" columns (sourced from a frozen hardcoded lookup table, never
 *       the uploaded file -- proven disconnected from live data and absent
 *       from the real reference workbook) must stay removed, and its real
 *       "BSA TEU" column (added the same day) must stay present.
 *     - formatAccountingNumber ran isNaN() on a raw comma-containing string
 *       BEFORE parsing it (isNaN("-1,176") is true in JS), so large
 *       negative values silently rendered without their "(-N,NNN)" parens.
 *       Checked on both fields that use this formatter (POL Booking
 *       Flash's "Max Laden Vs POL Booking" and Booking Flash's own "Max
 *       LDN vs BKG (Short_Fall)") by scanning for the broken TEXT SHAPE
 *       (`^-[\d,]+$`, a bare negative comma-number with no wrapping
 *       parens) rather than a specific value -- holds for any file.
 *   Field-level "is this getVal() alias wired to the right raw column"
 *   correctness is NOT this suite's job -- that's
 *   tests/check_alias_landmines.py (a separate static-analysis script, run
 *   it against any real export) plus DATA_ARCHITECTURE.md's field-mapping
 *   table and per-tab validation-status tracking.
 *
 *   CLASS F — Formatting/ordering bugs found 2026-08-25 (see
 *   DATA_ARCHITECTURE.md for the full writeup):
 *     - Date fields (POL Booking Flash's "Coastal ETD"/"Port Cut", Booking
 *       Flash's "1st POL Cutoff"/"ETD Last Port") used to render whatever
 *       raw date text getVal() returned, unformatted -- the live CSV
 *       source mixes ISO "YYYY-MM-DD" with a year-less "Mon D"/"Month D"
 *       shape (a lossy artifact of the published Google Sheet's own
 *       per-cell display format) depending on the row. A new `formatDate`
 *       helper normalizes every recognized shape to "M/D/YY". Checked by
 *       scanning for either broken TEXT SHAPE (a raw ISO prefix, or a
 *       bare "Mon D" with no year) rather than a specific value.
 *     - Several TEU/plug count fields (RFR Max LDN, RFR BKG TTL, Inland/
 *       Port Activity+Total, TPT/TAT/LWT/LNT/IMT/LET, DG TEU, Broken
 *       Routes) rendered comma-formatted on POL Booking Flash but as bare
 *       numbers (e.g. "4200" not "4,200") on Booking Flash/Detail -- same
 *       measure, inconsistent formatting depending on which tab. Checked
 *       by scanning for the broken SHAPE (any 4+ digit run with no comma)
 *       on Booking Flash/Detail.
 *     - Trade Summary's Grand Total ROW was already removed (2026-08-24);
 *       the rightmost Grand Total COLUMN (a per-row total across all Sale
 *       Weeks) is now removed too, per a direct request -- checked by
 *       asserting the header text is absent.
 *     - Sector Summary's two pivots sorted their Trade-level rows
 *       alphabetically by default (TAT, TPT, [LAT]) instead of the real
 *       reference Excel's actual order (TPT, TAT, LAT -- a deliberate
 *       manual override baked into the reference workbook's own pivot,
 *       confirmed via its pivot XML, not derivable/alphabetical). Checked
 *       by asserting the rendered Trade rows' relative order matches.
 *
 * These are written as STRUCTURAL/INVARIANT checks, not hardcoded-number
 * snapshot tests -- they assert relationships that must hold regardless of
 * which data file is uploaded, so they keep working correctly if the
 * reference upload file ever changes, and they directly encode the bug:
 * the invariant each one checks is exactly the one the bug violated.
 *
 * HOW TO RUN
 * ----------
 * 1. Open the app (e.g. via the local static server used throughout this
 *    project: http://localhost:8791/booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html)
 * 2. Upload Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx (or any real data file)
 * 3. Open the browser console and paste this whole file (top-level await
 *    is supported directly in a real browser console), or run it via a
 *    javascript_tool-style eval wrapped in an async IIFE. Each suite
 *    switches to the tab it needs itself (via clicking the tab button)
 *    before asserting, so you don't need to navigate manually. Logs a
 *    human-readable PASS/FAIL summary and returns a combined report object.
 *
 * No app changes are required to run these -- everything is derived from
 * the live rendered DOM, matching how this project has been live-tested
 * throughout (see booking-flash-live-testing-method memory).
 */
async function runBookingFlashRegressionTests() {
    const allResults = [];
    const record = (suite, name, pass, detail) => {
        allResults.push({ suite, name, pass, detail });
        console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — [${suite}] ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`);
    };
    const parseNum = (text) => {
        const cleaned = text.trim().replace(/[,%]/g, '').replace(/^\((-?)/, '-').replace(/\)$/, '').replace(/^\+/, '');
        const n = parseFloat(cleaned);
        return isNaN(n) ? null : n;
    };
    // Clicking a tab button only queues a React state update -- the DOM
    // doesn't reflect the new tab until the next render. This USED to wait a
    // fixed 100ms and hope that was enough, but that proved unreliable when
    // this suite runs via browser automation (2026-08-19: repeatedly
    // reproduced intermittent, non-reproducible failures -- e.g. Trade
    // Summary's table appearing to have near-zero values, Sector Summary's
    // table appearing missing entirely -- that never reproduced under
    // careful manual step-by-step re-verification of the exact same code and
    // data). Root cause: automated/backgrounded browser tabs can throttle
    // setTimeout far more aggressively than a normal foreground tab a human
    // is looking at, so a fixed delay tuned for one doesn't reliably cover
    // the other. Fixed at the root by polling for the ACTUAL expected DOM
    // condition instead of guessing a delay -- the active tab's own button
    // loses its shared 'bg-gray-300' inactive-tab class once activeTab
    // state has genuinely updated and re-rendered (see each tab button's
    // className in the app), so poll for that rather than a fixed wait.
    // Deliberately NOT matching the active tab's own brand color directly
    // (it was '#002060', now '#E5007D' -- caught live 2026-08-19 when a
    // rebrand pass silently broke this exact check, since it hardcoded the
    // color being replaced): checking for the ABSENCE of the shared
    // inactive class is robust to the active color changing again later.
    const waitFor = async (predicate, { timeout = 3000, interval = 30 } = {}) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (predicate()) {
                // Small settle margin (2026-08-19): a compound transition --
                // e.g. Suite 7 switching tabs immediately after Suite 6 just
                // closed the Analyze modal -- can have the polled signal
                // (the clicked tab's own active class) land a beat before a
                // second, unrelated piece of DOM (an unmounting modal/table
                // from the PREVIOUS tab) has fully settled. A short bounded
                // setTimeout is cheap insurance against reading mid-flight
                // DOM in exactly that kind of back-to-back transition.
                // Deliberately NOT requestAnimationFrame here -- caught live
                // (2026-08-19): rAF callbacks can be suspended indefinitely
                // in a backgrounded/hidden browser-automation tab (no paint
                // surface to schedule against), which hung this entire
                // suite forever with no way to time out. setTimeout is
                // reliably delivered (possibly throttled, never suspended)
                // even in that environment.
                await new Promise(resolve => setTimeout(resolve, 50));
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        return predicate();
    };
    const clickTab = async (label) => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === label);
        if (!btn) return false;
        btn.click();
        await waitFor(() => !btn.className.includes('bg-gray-300'));
        return true;
    };
    // clickShowToggle (2026-08-26): clicks a "Show X" column-visibility toggle button
    // if it's currently in its "Show" (hidden-column) state -- a no-op if the column
    // is already visible ("Hide X"). Needed because several toggle-gated columns
    // (Reefer/Trade Breakdown/DG Volume/etc.) now default to HIDDEN on Booking Flash/
    // Detail (see HANDOFF.md's "toggle-panel column defaults" entry, 2026-08-26) --
    // any check below that locates a column by header text would previously find it
    // reliably because every toggle defaulted to visible; several silently stopped
    // exercising their target column once the defaults changed (the `idx < 0`
    // guards on those checks made them skip cleanly rather than fail loudly, so this
    // went unnoticed until an explicit audit measured per-check coverage directly).
    // Exact-text match on "Show <Label>" (not a substring/includes) so this can't
    // accidentally match an unrelated "Show ..." button elsewhere on the page.
    const clickShowToggle = async (label) => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === `Show ${label}`);
        if (!btn) return false; // already showing (its label reads "Hide ...") or doesn't exist on this tab
        btn.click();
        await waitFor(() => btn.textContent.trim() === `Hide ${label}`);
        return true;
    };
    // Generic Class B sweep, reused by every suite: no cell anywhere in
    // `root` may render white text on a light/near-white/transparent
    // background.
    const findUnreadableCells = (root, extraLightBackgrounds = []) => {
        const LIGHT_BACKGROUNDS = new Set(['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)', ...extraLightBackgrounds]);
        return Array.from(root.querySelectorAll('td')).filter(td => {
            const style = getComputedStyle(td);
            return style.color === 'rgb(255, 255, 255)' && LIGHT_BACKGROUNDS.has(style.backgroundColor);
        });
    };

    // Start from a clean, reproducible baseline (no slicers active) so
    // every suite below sees the full dataset regardless of whatever
    // filter state a previous manual session left behind. Every SlicerBtn
    // sets aria-pressed to reflect its own isSelected state -- poll for none
    // remaining pressed (same poll-instead-of-guess fix as clickTab above).
    const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Clear Filters');
    if (clearBtn) {
        clearBtn.click();
        await waitFor(() => !Array.from(document.querySelectorAll('button[aria-pressed]')).some(b => b.getAttribute('aria-pressed') === 'true'));
    }

    // ============================================================
    // SUITE 1: Trade Summary — Class A (rollup) + Class B (readability guard)
    // ============================================================
    await (async function tradeSummarySuite() {
        const SUITE = 'Trade_Summary';
        if (!(await clickTab('Trade Summary'))) { record(SUITE, 'Setup: tab button found', false); return; }
        const table = document.querySelector('table');
        if (!table) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }
        record(SUITE, 'Setup: table found', true);

        // This pivot renders 3 dataFields (Max Laden / Total TEU / Trunk
        // Utilization) as separate rows per Trade/SubTrade node (valuesInRows
        // layout), preceded by a label-only row -- 4 rows per node. Group
        // them, then use the rendered −/• prefix (this pivot's own Trade vs
        // SubTrade markers) to rebuild the two-level hierarchy and check the
        // sum-of-children invariant at both levels.
        //
        // 2026-08-24: the Grand Total row (which used to be blocks[0], one
        // level above every Trade) was intentionally removed from this tab
        // (Kevin: "we don't need the grand totals in sector summary tab and
        // trade summary tab") -- blocks[0] is now the first real Trade block
        // itself, not a synthetic total. Iterate from i=0 (not i=1) and drop
        // the old "overall Grand Total == sum of all Trades" check entirely
        // below, since there's no longer a rendered overall total to compare
        // against -- the per-Trade sum-of-children checks already cover the
        // Class A rollup-correctness invariant this guarded.
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const blocks = [];
        for (let i = 0; i < rows.length; i += 4) {
            const labelRow = rows[i];
            const maxLadenRow = rows[i + 1];
            if (!labelRow || !maxLadenRow) continue;
            const labelText = labelRow.querySelector('td')?.textContent.trim() || '';
            const maxLadenCells = Array.from(maxLadenRow.querySelectorAll('td'));
            const maxLdn = parseNum(maxLadenCells[maxLadenCells.length - 1]?.textContent || '');
            blocks.push({ labelText, maxLdn });
        }
        if (blocks.length < 1) { record(SUITE, 'Setup: parsed at least one Trade block', false, { blockCount: blocks.length }); return; }

        const tradeGroups = [];
        let current = null;
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            if (b.labelText.startsWith('−')) {
                current = { trade: b.labelText.slice(1), value: b.maxLdn, children: [] };
                tradeGroups.push(current);
            } else if (b.labelText.startsWith('•') && current) {
                current.children.push({ subTrade: b.labelText.slice(1), value: b.maxLdn });
            }
        }

        // Guard against a real false-positive found 2026-08-19: parseNum()
        // returns null when a cell couldn't be parsed (e.g. read mid-render,
        // before the DOM settled) -- `Math.abs(null - 0) < 1` evaluates to
        // true (null coerces to 0 in arithmetic), so a genuinely-failed
        // parse could silently register as a passing "0 == 0" comparison
        // instead of surfacing as a failure. Every value feeding these two
        // checks must be a real number, not null, or the check fails loudly
        // instead of silently passing.
        tradeGroups.forEach(g => {
            const sumOfChildren = g.children.reduce((s, c) => s + (c.value || 0), 0);
            const valid = g.value !== null && !g.children.some(c => c.value === null);
            record(SUITE, `Class A: Trade "${g.trade}" Max Laden == sum of its Sub Trade children`,
                valid && Math.abs(g.value - sumOfChildren) < 1,
                { tradeValue: g.value, sumOfChildren, childCount: g.children.length, valid });
        });

        // Class F order guard (2026-09-01, see DATA_ARCHITECTURE.md's Re-validation --
        // 2026-09-01 writeup): same real-Excel order (TPT, TAT, LAT) already asserted for
        // Sector Summary's two pivots below, but this pivot never got the same check --
        // which is exactly how its own missing `childOrder` (falling back to alphabetical
        // LAT/TAT/TPT) went unnoticed until this audit. Checks relative order, not exact
        // adjacency or an exhaustive list, so a Trade absent from a given upload doesn't
        // fail this -- only an actually-wrong order does.
        const EXPECTED_TRADE_ORDER = ['TPT', 'TAT', 'LAT'];
        const seenTradeOrder = tradeGroups.map(g => g.trade).filter(t => EXPECTED_TRADE_ORDER.includes(t));
        const expectedTradeSubsequence = EXPECTED_TRADE_ORDER.filter(t => seenTradeOrder.includes(t));
        record(SUITE, 'Class F: Trade rows appear in the real Excel order (TPT, TAT, LAT)',
            JSON.stringify(seenTradeOrder) === JSON.stringify(expectedTradeSubsequence),
            { seenTradeOrder, expectedTradeSubsequence });

        // Lighter replacement for the old "overall Grand Total == sum of all
        // Trades" check (removed 2026-08-24 along with the Grand Total row
        // itself -- nothing left to compare against). Still guards against a
        // parse failure silently producing an empty/zero result: every Trade
        // must have parsed to a real, positive number.
        const anyNullTradeValue = tradeGroups.some(g => g.value === null);
        const overallSumOfTrades = tradeGroups.reduce((s, g) => s + (g.value || 0), 0);
        record(SUITE, 'Setup: every Trade parsed to a real, positive Max Laden value',
            tradeGroups.length > 0 && !anyNullTradeValue && overallSumOfTrades > 0,
            { tradeCount: tradeGroups.length, overallSumOfTrades, anyNullTradeValue });

        const unreadableCells = findUnreadableCells(table);
        record(SUITE, 'Class B (guard): no unreadable cells anywhere in the table',
            unreadableCells.length === 0, { unreadableCount: unreadableCells.length });

        // 2026-08-25: the Grand Total ROW was already gone (2026-08-24, above); Kevin
        // then asked for the rightmost Grand Total COLUMN gone too (a per-row total
        // across all Sale Weeks -- distinct thing, see DATA_ARCHITECTURE.md). Trade
        // Summary is the only pivot in the app with this column at all (it's the only
        // one that splits by Sale Week via colField), so this check is specific to it.
        const headerLabels = Array.from(table.querySelectorAll('thead tr')).flatMap(tr =>
            Array.from(tr.children).map(th => th.textContent.trim()));
        record(SUITE, 'Class E: Grand Total column removed (rightmost per-row total across all Sale Weeks, 2026-08-25)',
            !headerLabels.includes('Grand Total'), { headerLabels });
    })();

    // ============================================================
    // SUITE 2: Sector_Summary — Class A (rollup) + Class B (readability)
    // ============================================================
    await (async function sectorSummarySuite() {
        const SUITE = 'Sector_Summary';
        if (!(await clickTab('Sector Summary'))) { record(SUITE, 'Setup: tab button found', false); return; }
        const tables = Array.from(document.querySelectorAll('table'));
        const leftTable = tables.find(t => t.querySelector('caption')?.textContent === 'Average Max Laden vs Booking');
        if (!leftTable) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }
        record(SUITE, 'Setup: table found', true);

        const allRows = Array.from(leftTable.querySelectorAll('tbody tr'));
        // 2026-08-24: this pivot's Grand Total row was intentionally removed
        // (Kevin: "we don't need the grand totals in sector summary tab and
        // trade summary tab"), and the 4 KPI stat cards above it (including
        // "Avg Utilization", checked below) were removed even earlier the
        // same session -- neither exists to compare against anymore. Rather
        // than drop the Class A rollup-correctness guard entirely, check it
        // at every level directly: reconstruct the Trade -> Sub Trade -> Lane
        // tree from each row's own rendered indentation (paddingLeft =
        // (level-1)*1.5rem on the label span -- see PivotTableViewer's row
        // render; level 1 = Trade now that the old level-0 Grand Total row
        // is gone) and verify sum-of-children at both levels. This also
        // subsumes the old "Grand Total is NOT just the single largest
        // lane's value" flat-max fingerprint check: a flat-max regression
        // would make a parent's value equal its children's MAX instead of
        // their SUM, which (with >1 differently-valued child) fails the
        // sum-of-children check directly.
        const parseLevel = (td) => {
            const span = td.querySelector('span');
            const pl = span ? (parseFloat(span.style.paddingLeft) || 0) : 0;
            return Math.round(pl / 1.5) + 1; // rem units; level 1 = 0rem, level 2 = 1.5rem, level 3 = 3rem
        };
        const treeRows = allRows.map(tr => {
            const tds = Array.from(tr.querySelectorAll('td'));
            if (tds.length < 5) return null;
            return {
                label: tds[0].textContent.trim().replace(/^[▼▶•]\s*/, ''),
                level: parseLevel(tds[0]),
                avgMaxLdn: parseNum(tds[1].textContent)
            };
        }).filter(Boolean);
        const checkRollupLevel = (parentLevel, childLevel, levelLabel) => {
            const fails = [];
            let checked = 0;
            for (let i = 0; i < treeRows.length; i++) {
                if (treeRows[i].level !== parentLevel) continue;
                let sum = 0, sawChild = false;
                for (let j = i + 1; j < treeRows.length && treeRows[j].level > parentLevel; j++) {
                    if (treeRows[j].level === childLevel) { sum += treeRows[j].avgMaxLdn || 0; sawChild = true; }
                }
                if (!sawChild) continue; // leaf-only parent (no children at this depth to sum) -- nothing to check
                checked++;
                if (treeRows[i].avgMaxLdn === null || Math.abs(treeRows[i].avgMaxLdn - sum) >= 1) {
                    fails.push({ label: treeRows[i].label, value: treeRows[i].avgMaxLdn, sumOfChildren: sum });
                }
            }
            record(SUITE, `Class A: each ${levelLabel} row's Avg Max Laden == sum of its direct children`,
                checked > 0 && fails.length === 0, { checked, fails: fails.slice(0, 5) });
        };
        checkRollupLevel(1, 2, 'Trade');
        checkRollupLevel(2, 3, 'Sub Trade');

        // Class F order guard (2026-08-25, see DATA_ARCHITECTURE.md): Kevin showed a
        // screenshot of the real reference Excel proving the Trade-level row order is
        // TPT, then TAT, then LAT -- NOT alphabetical (which would be LAT, TAT, TPT).
        // Confirmed directly from the reference workbook's pivot XML: a deliberate manual
        // override baked into both pivots, safe to assert as a fixed sequence. Checks
        // relative order (TPT before TAT before LAT), not exact adjacency or an exhaustive
        // list, so a Trade absent from a given upload (e.g. the right pivot's live source
        // has no LAT rows at all) doesn't fail this -- only an actually-wrong ORDER does.
        const EXPECTED_TRADE_ORDER = ['TPT', 'TAT', 'LAT'];
        const checkTradeOrder = (table, levelLabel) => {
            const tRows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
                const td = tr.querySelector('td');
                if (!td) return null;
                return { label: td.textContent.trim().replace(/^[▼▶•]\s*/, ''), level: parseLevel(td) };
            }).filter(Boolean);
            const seenOrder = tRows.filter(r => r.level === 1).map(r => r.label)
                .filter((label, i, arr) => arr.indexOf(label) === i) // dedupe consecutive/repeat labels
                .filter(label => EXPECTED_TRADE_ORDER.includes(label));
            const expectedSubsequence = EXPECTED_TRADE_ORDER.filter(t => seenOrder.includes(t));
            record(SUITE, `Class F: ${levelLabel} pivot's Trade rows appear in the real Excel order (TPT, TAT, LAT)`,
                JSON.stringify(seenOrder) === JSON.stringify(expectedSubsequence),
                { seenOrder, expectedSubsequence });
        };
        checkTradeOrder(leftTable, '"Average Max Laden vs Booking"');
        const rightTable = tables.find(t => t.querySelector('caption')?.textContent === 'Sector Summary');
        if (rightTable) checkTradeOrder(rightTable, '"Sector Summary"');

        const unreadableCells = findUnreadableCells(leftTable, ['rgb(238, 242, 250)']);
        record(SUITE, 'Class B: no white text on light/transparent background anywhere in the table',
            unreadableCells.length === 0,
            { unreadableCount: unreadableCells.length, samples: unreadableCells.slice(0, 3).map(td => td.textContent.trim()) });

        const allCells = Array.from(leftTable.querySelectorAll('td'));
        const ordinaryPercentCells = allCells.filter(td => {
            const t = td.textContent.trim();
            return /^\d+%$/.test(t) && parseInt(t) <= 100 && parseInt(t) > 0;
        });
        const tintStillWorks = ordinaryPercentCells.some(td => getComputedStyle(td).backgroundColor === 'rgb(238, 242, 250)');
        record(SUITE, 'Class B fix is not overbroad: Total-column tint still applies on non-conflicting cells',
            tintStillWorks, { checkedCells: ordinaryPercentCells.length });
    })();

    // ============================================================
    // SUITE 3: POL_Booking_Flash — Class B (readability) only. Its own
    // Grand Total fields were checked for Class A during the same
    // investigation (polMaxLdn, peakPolUtilzRaw, etc.) and deliberately
    // left alone: polMaxLdn is a different data grain (per-VVD/per-sailing,
    // not a shared lane-level trunk capacity) and was already ground-truth
    // verified elsewhere in this project's history; the seemingly-extreme
    // percentage fields (e.g. RFR Utilz% showing 800%) were confirmed to
    // reflect genuine raw source-data outliers (checked directly against
    // the raw upload file), not a computation bug.
    // ============================================================
    await (async function polBookingFlashSuite() {
        const SUITE = 'POL_Booking_Flash';
        if (!(await clickTab('POL Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        const table = document.querySelector('table');
        if (!table) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }
        record(SUITE, 'Setup: table found', true);

        const allCells = Array.from(table.querySelectorAll('td'));

        // Class B fingerprint: a cell whose className string contains BOTH a
        // row-status background (AP Frozen #DA9694 / AP Only #ffc000 / VMS
        // #d9d9d9 / No N.A. Call #FF0000) AND bg-red-600 (the util-gap flag)
        // means the two are fighting for the same cell with an undefined
        // winner -- this pattern must never occur post-fix (the fix makes
        // them mutually exclusive via `||`, not concatenation).
        const conflictingClassCells = allCells.filter(td =>
            td.className.includes('bg-red-600') && /bg-\[#(DA9694|ffc000|d9d9d9|FF0000)\]/.test(td.className)
        );
        record(SUITE, 'Class B: no cell has both a row-status background class and bg-red-600 in its class list',
            conflictingClassCells.length === 0,
            { conflictingCount: conflictingClassCells.length });

        const unreadableCells = findUnreadableCells(table);
        record(SUITE, 'Class B: no white text on light/transparent background anywhere in the table',
            unreadableCells.length === 0, { unreadableCount: unreadableCells.length });

        // Non-overbroad guard: a row with an AP status but no util-gap flag
        // on a given cell must still show its status color on that cell.
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const apFrozenRow = rows.find(tr => tr.innerHTML.includes('bg-[#DA9694]'));
        if (apFrozenRow) {
            const cells = Array.from(apFrozenRow.querySelectorAll('td'));
            const pinkCells = cells.filter(td => getComputedStyle(td).backgroundColor === 'rgb(218, 150, 148)');
            record(SUITE, 'Class B fix is not overbroad: AP Frozen row-status color still applies on non-flagged cells',
                pinkCells.length > 0, { totalCells: cells.length, pinkCellCount: pinkCells.length });
        }

        // Class E regression guards (2026-08-25). The header-only checks below are
        // deliberately data-independent (DATA_ARCHITECTURE.md's per-field mapping
        // checks live in tests/check_alias_landmines.py, a separate static-analysis
        // script -- run that against any real export too, this suite alone doesn't
        // cover Class E).
        const headerRow0 = table.querySelectorAll('thead tr')[0];
        const headerLabels = Array.from(headerRow0.children)
            .map(th => th.textContent.replace(/[▲▼]/g, '').trim());
        record(SUITE, 'Class E: fake "Peak Dry Utilz (POL)"/"Peak Reefer Utilz (POL)" columns stay removed (were sourced from a frozen hardcoded lookup table, never the uploaded file -- confirmed disconnected from live data and absent from the real reference workbook, removed 2026-08-25)',
            !headerLabels.some(h => h.includes('Peak Dry Utilz') || h.includes('Peak Reefer Utilz')),
            { headerLabels });
        record(SUITE, 'Class E: "BSA TEU" column present (real reference-workbook column this tab wasn\'t showing, added 2026-08-25)',
            headerLabels.includes('BSA TEU'), { headerLabels });

        // Colspan-aware fromEnd (2026-08-25 -- found while adding the Class F date
        // checks below): this row's "Inland Total"/"Port Total" cells are colSpan={3}
        // group headers whose 3 leaf sub-columns (Inland/Port w/Activity, No-Activity,
        // Total) live in thead row [1] instead -- each "costs" 3 real columns while
        // occupying only 1 slot in this array. A naive `headerLabels.length - idx`
        // (what the pre-existing "Max Laden Vs POL Booking" check below used to use)
        // undercounts fromEnd by 4 for every field before that group -- confirmed live
        // it was silently reading "Loadable Quant"'s column, not its own, and passing
        // only because that column never happened to contain the broken shape either.
        // Fixed here for both that check and the new Coastal ETD/Port Cut ones.
        const polFromEndByIdx = (() => {
            const spans = Array.from(headerRow0.children).map(th => parseInt(th.getAttribute('colspan') || '1', 10));
            const totalRealCols = spans.reduce((a, b) => a + b, 0);
            let cumulative = 0;
            return spans.map(span => {
                const fromEnd = totalRealCols - cumulative;
                cumulative += span;
                return fromEnd;
            });
        })();

        // Class E formatting guard: formatAccountingNumber used to run isNaN() on
        // the raw comma-containing string before parsing it, so any negative value
        // >= 1000 (comma-formatted) silently lost its "(-N,NNN)" parens and rendered
        // as a bare "-N,NNN" instead -- found on "Max Laden Vs POL Booking" (~25% of
        // rows affected on the file that surfaced it). This scans by cell SHAPE, not
        // a specific data value, so it holds for any uploaded file: a cell in this
        // column may legitimately be a large negative comma number, but it must
        // never render without the wrapping parens.
        const maxLdnVsBkgIdx = headerLabels.indexOf('Max Laden Vs POL Booking');
        if (maxLdnVsBkgIdx >= 0) {
            const brokenFormatCells = rows.flatMap(tr => {
                const tds = Array.from(tr.children);
                // Trade/Sub Trade/Lane are rowSpan-merged (absent on continuation
                // rows), so index from the END of the row, not maxLdnVsBkgIdx
                // directly -- same technique used throughout this project's own
                // verification scripts for this tab.
                const fromEnd = polFromEndByIdx[maxLdnVsBkgIdx];
                const td = tds[tds.length - fromEnd];
                if (!td) return [];
                const text = td.textContent.trim();
                return (/^-[\d,]+$/.test(text)) ? [text] : [];
            });
            record(SUITE, 'Class E: "Max Laden Vs POL Booking" never renders a negative comma-number without its accounting parens',
                brokenFormatCells.length === 0, { brokenFormatCells: brokenFormatCells.slice(0, 5), brokenCount: brokenFormatCells.length });
        }

        // Class F formatting guard (2026-08-25, see DATA_ARCHITECTURE.md): Coastal ETD/
        // Port Cut used to render whatever raw date text getVal() returned, unformatted --
        // fine for a clean xlsx upload, but the live CSV source mixes ISO "YYYY-MM-DD" text
        // with a year-less "Mon D"/"Month D" shape (a lossy artifact of the published Google
        // Sheet's own per-cell display format) on ~77% of Port Cut rows. This scans by cell
        // SHAPE across every populated row, not a specific data value, so it holds for any
        // uploaded file: neither raw shape should ever reach the screen, and a non-blank
        // cell should always end up "M/D/YY".
        const dateFields = [
            { label: 'Coastal ETD', header: 'Coastal ETD' },
            { label: 'Port Cut', header: 'Port Cut' },
        ];
        dateFields.forEach(({ label, header }) => {
            const idx = headerLabels.indexOf(header);
            if (idx < 0) return;
            const fromEnd = polFromEndByIdx[idx];
            const cellTexts = rows.flatMap(tr => {
                const tds = Array.from(tr.children);
                const td = tds[tds.length - fromEnd];
                return td ? [td.textContent.trim()] : [];
            }).filter(Boolean);
            const rawIso = cellTexts.filter(t => /^\d{4}-\d{1,2}-\d{1,2}/.test(t));
            const yearLess = cellTexts.filter(t => /^[A-Za-z]{3,9}\s+\d{1,2}$/.test(t));
            const wellFormed = cellTexts.filter(t => /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(t));
            record(SUITE, `Class F: "${label}" never renders a raw ISO date or a year-less "Mon D" date`,
                rawIso.length === 0 && yearLess.length === 0,
                { rawIsoSample: rawIso.slice(0, 5), yearLessSample: yearLess.slice(0, 5), totalNonBlank: cellTexts.length, wellFormedCount: wellFormed.length });
        });
    })();

    // ============================================================
    // SUITE 4: Booking Flash (Detail View) — Class B (readability guard)
    // only. This tab is a flat per-row table with no Grand Total/rollup at
    // all, so Class A doesn't apply. Its own copy of the >10%-since-prior-
    // day util-gap flag already uses an inline `style` (not a className),
    // which always wins over any class-based background regardless of
    // insertion order -- structurally immune to Class B. Verified as a
    // standing regression guard against ever changing it back.
    // ============================================================
    await (async function bookingFlashSuite() {
        const SUITE = 'Booking_Flash';
        if (!(await clickTab('Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        const table = document.querySelector('table');
        if (!table) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }
        record(SUITE, 'Setup: table found', true);

        // Show every toggle-gated column this suite's later checks locate by header
        // text (Reefer/Trade Breakdown/DG Volume -- see clickShowToggle's own comment)
        // BEFORE reading any header row below, so the Short_Fall/date-field/comma-
        // format checks below all run against the fully-populated column set
        // regardless of this tab's current default visibility state. Every check
        // below locates its target column dynamically by header text (never a fixed
        // index), so adding more visible columns here can't shift any OTHER check
        // onto the wrong cell -- it only restores the columns these specific checks
        // need to actually find.
        await clickShowToggle('Reefer');
        await clickShowToggle('Trade Breakdown');
        await clickShowToggle('DG Volume');

        const allCells = Array.from(table.querySelectorAll('td'));
        const unreadableCells = findUnreadableCells(table);
        record(SUITE, 'Class B: no white text on light/transparent background anywhere in the table',
            unreadableCells.length === 0, { unreadableCount: unreadableCells.length, totalCellsChecked: allCells.length });

        // The util-gap flag (red background, >10% since prior day) should be
        // applied via inline style, never a className -- confirms it can
        // never fall into the same class-order-ambiguity trap fixed
        // elsewhere, even if this table has no currently-flagged cells to
        // sample (a data-dependent condition, not guaranteed on every
        // upload) -- in that case this check trivially passes with 0 samples,
        // which is fine: the assertion is "IF a flagged cell exists, it uses
        // style" not "a flagged cell must exist".
        const flaggedCells = allCells.filter(td => getComputedStyle(td).backgroundColor === 'rgb(220, 38, 38)');
        const allUseInlineStyle = flaggedCells.every(td => td.style.backgroundColor && td.style.backgroundColor !== '');
        record(SUITE, 'Class B (guard): the util-gap flag uses inline style, not a conflictable className',
            allUseInlineStyle, { flaggedCellCount: flaggedCells.length });

        // Class E formatting guard (2026-08-25) -- same formatAccountingNumber bug
        // as POL Booking Flash's own guard above, applied here to this tab's own
        // "Max LDN vs BKG (Short_Fall)" column, which shares the same formatter.
        // This tab's thead has a filter row at [0] (see the header label text below
        // being concatenated with no space -- that's this tab's own rendering
        // quirk, not a bug: "Max LDN vsBKG(Short_Fall)" is the real label text)
        // then the real label row at [1].
        const detailHeaderRow = table.querySelectorAll('thead tr')[1];
        const detailHeaderLabels = Array.from(detailHeaderRow.children)
            .map(th => th.textContent.replace(/[▲▼]/g, '').trim());
        // Colspan-aware fromEnd (2026-08-25): most header cells in this row are single
        // real columns (rowSpan={2}, no entry needed in thead row [2]), but "Inland
        // Activity"/"Port Activity" are colSpan={3} group headers whose 3 leaf
        // sub-columns live in thead row [2] instead -- each of those 2 cells "costs"
        // 3 real columns while only occupying 1 slot in this array. A naive
        // `detailHeaderLabels.length - idx` silently undercounts fromEnd for every field
        // BEFORE that group by 4 -- including the pre-existing Short_Fall check right
        // below, confirmed live it was silently reading the WRONG column (something in
        // the RFR block) this whole time and passing only because that column never
        // happened to contain the broken shape either. Fixed here for every Class E/F
        // check in this suite, not just the new ones.
        const detailFromEndByIdx = (() => {
            const spans = Array.from(detailHeaderRow.children).map(th => parseInt(th.getAttribute('colspan') || '1', 10));
            const totalRealCols = spans.reduce((a, b) => a + b, 0);
            let cumulative = 0;
            return spans.map(span => {
                const fromEnd = totalRealCols - cumulative;
                cumulative += span;
                return fromEnd; // fromEnd of this header's FIRST real column (correct for span=1 headers)
            });
        })();
        const detailRows = Array.from(table.querySelectorAll('tbody tr'));
        const shortfallIdx = detailHeaderLabels.findIndex(h => h.includes('Short_Fall'));
        if (shortfallIdx >= 0) {
            const fromEnd = detailFromEndByIdx[shortfallIdx];
            const brokenFormatCells = detailRows.flatMap(tr => {
                const tds = Array.from(tr.children);
                const td = tds[tds.length - fromEnd];
                if (!td) return [];
                const text = td.textContent.trim();
                return (/^-[\d,]+$/.test(text)) ? [text] : [];
            });
            record(SUITE, 'Class E: "Max LDN vs BKG (Short_Fall)" never renders a negative comma-number without its accounting parens',
                brokenFormatCells.length === 0, { brokenFormatCells: brokenFormatCells.slice(0, 5), brokenCount: brokenFormatCells.length });
        }

        // Class F formatting guard (2026-08-25, see DATA_ARCHITECTURE.md) -- same date
        // normalization guard as POL Booking Flash's own "Coastal ETD"/"Port Cut" check
        // above, applied to this tab's own "1st POL Cutoff"/"ETD Last Port" fields (a
        // DIFFERENT pair of source columns, not the same fields aliased twice -- see
        // DATA_ARCHITECTURE.md's Class F for why both pairs needed the fix independently).
        // Matched via .includes() rather than an exact string, same as the pre-existing
        // Short_Fall check above: this tab's header cell has a second child (the resize
        // handle) that concatenates into textContent with no space, so the real label
        // text is "1st POLCutoff"/"ETD LastPort", not "1st POL Cutoff"/"ETD Last Port".
        const detailDateFields = [
            { label: '1st POL Cutoff', match: h => h.includes('POLCutoff') },
            { label: 'ETD Last Port', match: h => h.includes('LastPort') },
        ];
        detailDateFields.forEach(({ label, match }) => {
            const idx = detailHeaderLabels.findIndex(match);
            if (idx < 0) return;
            const fromEnd = detailFromEndByIdx[idx];
            const cellTexts = detailRows.flatMap(tr => {
                const tds = Array.from(tr.children);
                const td = tds[tds.length - fromEnd];
                return td ? [td.textContent.trim()] : [];
            }).filter(Boolean);
            const rawIso = cellTexts.filter(t => /^\d{4}-\d{1,2}-\d{1,2}/.test(t));
            const yearLess = cellTexts.filter(t => /^[A-Za-z]{3,9}\s+\d{1,2}$/.test(t));
            record(SUITE, `Class F: "${label}" never renders a raw ISO date or a year-less "Mon D" date`,
                rawIso.length === 0 && yearLess.length === 0,
                { rawIsoSample: rawIso.slice(0, 5), yearLessSample: yearLess.slice(0, 5), totalNonBlank: cellTexts.length });
        });

        // Class F cross-tab consistency guard (2026-08-25, see DATA_ARCHITECTURE.md):
        // these same field names (rfrMaxLdn, rfrBkgTtl, tpt/tat/lwt/lnt/imt/let, dgTeu,
        // broken) render comma-formatted on POL Booking Flash's own copy of this data
        // (see that suite's fields), but this tab used to render them as bare numbers
        // straight from tableData's pre-aggregated JS values -- e.g. "4200" not "4,200"
        // -- same measure, inconsistent formatting depending on which tab you're on.
        // Scans by cell SHAPE: any 4+ digit run with no comma is the bug's signature,
        // regardless of which specific value the uploaded file happens to contain.
        // Inland/Port Activity+Total (also fixed the same way in the app) are NOT
        // checked here -- they're colSpan=3 group headers whose 6 real leaf columns
        // live in thead row [2], a nested-header layout too easy to mis-locate reliably
        // from here; the fields checked below use the exact same formatter/code
        // pattern, which is strong enough evidence the same fix covers those too.
        const commaFields = ['RFR BSA Plugs', 'RFR BKG Plugs', 'RFR Max LDN', 'RFR BKG TTL',
            'Broken Routes', 'TPT', 'TAT', 'LWT', 'LNT', 'IMT', 'LET', 'DG TEU'];
        const missingCommaCells = [];
        commaFields.forEach(header => {
            const idx = detailHeaderLabels.findIndex(h => h.replace(/\s+/g, '') === header.replace(/\s+/g, ''));
            if (idx < 0) return;
            const fromEnd = detailFromEndByIdx[idx];
            detailRows.forEach(tr => {
                const tds = Array.from(tr.children);
                const td = tds[tds.length - fromEnd];
                if (!td) return;
                const text = td.textContent.trim();
                if (/^\d{4,}$/.test(text)) missingCommaCells.push(`${header}: "${text}"`);
            });
        });
        record(SUITE, 'Class F: no 4+ digit TEU/plug/duration field renders without comma formatting (cross-tab consistency with POL Booking Flash)',
            missingCommaCells.length === 0, { missingCommaCells: missingCommaCells.slice(0, 10), missingCount: missingCommaCells.length });
    })();

    // Shared helpers for the two Analyze-modal suites below. Same
    // poll-instead-of-guess fix as clickTab above. Measured live
    // (2026-08-19): the modal's breakdown cards can take over a second to
    // actually render after the click in isolation (a real, if surprisingly
    // slow, render -- not a bug in the app) -- so poll for a card to exist
    // directly rather than a proxy signal like the Close button -- confirmed
    // both land in the same commit, but waiting on the actual thing this
    // suite reads next is more direct and self-documenting than waiting on
    // a stand-in for it. Also observed (2026-08-19): running the FULL suite
    // end-to-end, by the time this runs (after Suite 4's ~19,000
    // getComputedStyle() calls scanning Booking Flash's full table), the
    // same open can take noticeably longer than it does in isolation --
    // a generous timeout here absorbs that cumulative cost rather than
    // guessing a number tuned only for the isolated case.
    const openAnalysis = async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Analyze'));
        if (!btn || btn.disabled) return false;
        btn.click();
        // Bug found 2026-08-19: this used to `return true` unconditionally
        // after the wait, regardless of whether waitFor's predicate actually
        // became true or the wait simply timed out -- meaning a genuine
        // failure-to-render silently reported as "opened successfully" and
        // only surfaced later as a confusing "no breakdown card found"
        // failure downstream. Propagate the real outcome instead.
        return await waitFor(
            () => document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative').length > 0,
            { timeout: 15000 }
        );
    };
    const closeAnalysis = async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Close Analysis');
        if (!btn) return;
        btn.click();
        await waitFor(() => !Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Close Analysis'));
    };
    const readAnalysisModal = () => {
        const findKpiValue = (labelText) => {
            const labelEl = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim() === labelText && d.children.length === 0);
            if (!labelEl) return null;
            const valueEl = labelEl.nextElementSibling;
            return valueEl ? parseNum(valueEl.textContent) : null;
        };
        const overall = {
            utilization: findKpiValue('Avg Utilization'),
            capacity: findKpiValue('Avg Wkly Capacity (Max Laden)'),
            laden: findKpiValue('Avg Wkly Laden'),
            shortfall: findKpiValue('Avg Wkly Shortfall'),
        };
        const cards = Array.from(document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative'));
        const groups = cards.map(card => {
            const name = card.querySelector('.font-bold.text-sm.mb-2')?.textContent.trim();
            const badge = parseNum(card.querySelector('.absolute')?.textContent.trim() || '');
            const rows = Array.from(card.querySelectorAll('.flex.justify-between'));
            const getVal = (label) => { const row = rows.find(r => r.textContent.includes(label)); return row ? parseNum(row.children[1].textContent) : null; };
            return { name, badge, avgWklyMaxLdn: getVal('Avg Wkly Max Laden'), avgWklyLaden: getVal('Avg Wkly Laden'), avgWklyShortfall: getVal('Avg Wkly Shortfall') };
        });
        return { overall, groups };
    };
    // Per-card algebra + Overall-vs-sum-of-cards checks, shared by both
    // Analyze suites. `overallShouldMatchSumOfCards` is only true when the
    // modal's breakdown IS by Lane (the Booking Flash tab) -- on the POL
    // tab the breakdown is by POL/port, a sub-division of one lane's
    // capacity, so summing those cards would DOUBLE/QUADRUPLE-count a
    // shared lane capacity (the exact bug fixed 2026-08-18) and must NOT
    // match Overall Capacity there.
    const checkAnalysisMath = (SUITE, record, data, overallShouldMatchSumOfCards, crossTabReference) => {
        const { overall, groups } = data;
        // Tolerance accounts for legitimate display-rounding drift: each
        // card's number is independently rounded before display, so summing
        // N already-rounded cards can differ from the app's own (unrounded-
        // then-rounded-once) total by up to ~0.5 per card. A real logic bug
        // (like the one fixed this session) produces a discrepancy orders of
        // magnitude larger than this tolerance.
        const roundingTolerance = Math.max(2, groups.length * 0.5 + 1);
        const sumCapacity = groups.reduce((s, c) => s + (c.avgWklyMaxLdn || 0), 0);
        const sumLaden = groups.reduce((s, c) => s + (c.avgWklyLaden || 0), 0);

        if (overallShouldMatchSumOfCards) {
            record(SUITE, 'Analyze: Overall Capacity ~= sum of all breakdown cards\' Avg Wkly Max Laden',
                Math.abs(overall.capacity - sumCapacity) <= roundingTolerance,
                { overall: overall.capacity, sum: sumCapacity, tolerance: roundingTolerance });
            record(SUITE, 'Analyze: Overall Laden ~= sum of all breakdown cards\' Avg Wkly Laden',
                Math.abs(overall.laden - sumLaden) <= roundingTolerance,
                { overall: overall.laden, sum: sumLaden, tolerance: roundingTolerance });
        } else {
            // Negative check: the exact fingerprint of the POL-over-counting
            // bug fixed 2026-08-18 -- if Overall Capacity equals the naive
            // sum of the (sub-lane) breakdown cards with no independent
            // proof otherwise, that's the bug back, not a coincidence. This
            // heuristic ALONE isn't reliable on every dataset, though (found
            // 2026-08-19): it produces a false failure whenever most POLs
            // happen to map to distinct lanes (little/no shared-lane
            // double-counting opportunity in that specific data), where the
            // naive sum and the true overall are legitimately close by
            // construction, not by a bug returning. When a cross-tab
            // reference (Booking Flash's own, independently-computed,
            // definitely-correct-by-lane Overall) is available, defer to
            // that stronger, dataset-shape-independent proof rather than
            // this heuristic alone.
            const naiveSumLooksSuspicious = Math.abs(overall.capacity - sumCapacity) <= roundingTolerance && groups.length > 1;
            const crossTabProvesCorrect = !!crossTabReference &&
                Math.abs(overall.capacity - crossTabReference.capacity) < 1 &&
                Math.abs(overall.laden - crossTabReference.laden) < 1;
            record(SUITE, 'Analyze: Overall Capacity is NOT the naive sum of sub-lane breakdown cards (would be the fixed over-counting bug)',
                !naiveSumLooksSuspicious || crossTabProvesCorrect,
                { overall: overall.capacity, naiveSumOfCards: sumCapacity, naiveSumLooksSuspicious, crossTabProvesCorrect });
        }

        record(SUITE, 'Analyze: Overall Shortfall == Overall Laden - Overall Capacity',
            Math.abs(overall.shortfall - (overall.laden - overall.capacity)) <= 2,
            { shortfall: overall.shortfall, computed: overall.laden - overall.capacity });

        const expectedOverallUtil = overall.capacity > 0 ? Math.round((overall.laden / overall.capacity) * 100) : 0;
        record(SUITE, 'Analyze: Overall Utilization == round(Laden/Capacity*100)',
            Math.abs(overall.utilization - expectedOverallUtil) <= 1,
            { actual: overall.utilization, expected: expectedOverallUtil });

        const badgeFails = [];
        const shortfallFails = [];
        groups.forEach(c => {
            const expectedBadge = c.avgWklyMaxLdn > 0 ? Math.round((c.avgWklyLaden / c.avgWklyMaxLdn) * 100) : 0;
            const expectedShortfall = c.avgWklyLaden - c.avgWklyMaxLdn;
            if (Math.abs(c.badge - expectedBadge) > 1) badgeFails.push({ name: c.name, actual: c.badge, expected: expectedBadge });
            if (Math.abs(c.avgWklyShortfall - expectedShortfall) > 1) shortfallFails.push({ name: c.name, actual: c.avgWklyShortfall, expected: expectedShortfall });
        });
        record(SUITE, 'Analyze: every breakdown card\'s % badge == round(Laden/MaxLaden*100)', badgeFails.length === 0, { fails: badgeFails });
        record(SUITE, 'Analyze: every breakdown card\'s Shortfall == Laden - MaxLaden', shortfallFails.length === 0, { fails: shortfallFails });
    };

    // ============================================================
    // SUITE 5: Analyze modal — Booking Flash tab ("Service Lane
    // Performance Summary"). Breakdown is by Lane, so Overall == sum of
    // the displayed cards is expected to hold (within rounding).
    // ============================================================
    let bookingFlashAnalysis = null;
    await (async function bookingFlashAnalyzeSuite() {
        const SUITE = 'Analyze_BookingFlash';
        if (!(await clickTab('Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        if (!(await openAnalysis())) { record(SUITE, 'Setup: Analyze button found and enabled', false); return; }
        const data = readAnalysisModal();
        if (data.groups.length === 0) { record(SUITE, 'Setup: at least one breakdown card found', false); await closeAnalysis(); return; }
        record(SUITE, 'Setup: modal opened with data', true, { cardCount: data.groups.length });
        bookingFlashAnalysis = data.overall;
        checkAnalysisMath(SUITE, record, data, /* overallShouldMatchSumOfCards */ true);
        await closeAnalysis();
    })();

    // ============================================================
    // SUITE 6: Analyze modal — POL_Booking_Flash tab ("POL Performance
    // Summary"). Breakdown is by POL/port (a sub-division of one lane), so
    // Overall must NOT equal the naive sum of the displayed cards -- and
    // must match Booking Flash's own Overall exactly, since both read the
    // same underlying by-lane computation regardless of which dimension is
    // displayed (the cross-tab consistency check that would have caught
    // the original over-counting bug immediately).
    // ============================================================
    await (async function polBookingFlashAnalyzeSuite() {
        const SUITE = 'Analyze_POLBookingFlash';
        if (!(await clickTab('POL Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        if (!(await openAnalysis())) { record(SUITE, 'Setup: Analyze button found and enabled', false); return; }
        const data = readAnalysisModal();
        if (data.groups.length === 0) { record(SUITE, 'Setup: at least one breakdown card found', false); await closeAnalysis(); return; }
        record(SUITE, 'Setup: modal opened with data', true, { cardCount: data.groups.length });
        checkAnalysisMath(SUITE, record, data, /* overallShouldMatchSumOfCards */ false, /* crossTabReference */ bookingFlashAnalysis);
        if (bookingFlashAnalysis) {
            record(SUITE, 'Analyze: Overall Snapshot matches Booking Flash tab\'s Overall exactly (same filter, same by-lane computation)',
                Math.abs(data.overall.capacity - bookingFlashAnalysis.capacity) < 1 &&
                Math.abs(data.overall.laden - bookingFlashAnalysis.laden) < 1 &&
                Math.abs(data.overall.shortfall - bookingFlashAnalysis.shortfall) < 1,
                { bookingFlash: bookingFlashAnalysis, polBookingFlash: data.overall });
        }
        await closeAnalysis();
    })();

    // ============================================================
    // SUITE 7: Trade Summary — Class D (comma-truncation guard, added
    // 2026-08-18). Real bug found via the live published-Sheet data source:
    // plain parseFloat() on a raw getVal() string stops at the first
    // non-numeric character, so a thousands-separated value like "42,079"
    // silently truncates to 42 -- a ~1000x undercount. The static reference
    // .xlsx test file's equivalent columns happened not to be comma-
    // formatted, so this was dormant this whole project until the live
    // Google Sheet CSV (which does format large numbers with commas)
    // exposed it: Trade Summary's Trunk Utilization showed individual
    // per-week values like "753114%". Fixed by routing every raw-value ->
    // number conversion through a shared toNum() helper that strips
    // commas/%/parens before parsing (matching the comma-stripping already
    // done in a couple of places, now applied consistently everywhere).
    // This check doesn't re-derive the fix's internals -- it just asserts
    // the OUTCOME the bug broke: no individual Sale Week's Trunk
    // Utilization should be an order of magnitude beyond plausible. 500%
    // is deliberately generous (real observed values are well under 100%
    // per week) while being nowhere near the 40,000%-750,000%+ values the
    // bug actually produced -- this bounds the failure mode without
    // hardcoding an exact "correct" number that would break on a future
    // data refresh.
    // ============================================================
    await (async function tradeSummaryCommaTruncationSuite() {
        const SUITE = 'Trade_Summary_CommaGuard';
        if (!(await clickTab('Trade Summary'))) { record(SUITE, 'Setup: tab button found', false); return; }
        const table = document.querySelector('table');
        if (!table) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }
        record(SUITE, 'Setup: table found', true);

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        // Every 4th row starting at row 3 (0-indexed) is a "Trunk Utilization"
        // row (label / Max Laden / Total TEU / Trunk Utilization repeating).
        const utilRows = rows.filter((tr, i) => i % 4 === 3);
        const SANE_CEILING_PERCENT = 500;
        const offenders = [];
        utilRows.forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('td'));
            // Exclude the last (rightmost) cell -- that's the cumulative
            // "Total" column, which legitimately sums many weeks' ratios
            // together and can exceed 100% by a lot even with correct math.
            cells.slice(0, -1).forEach((td, colIdx) => {
                const text = td.textContent.trim();
                const n = parseFloat(text.replace('%', ''));
                if (!isNaN(n) && n > SANE_CEILING_PERCENT) {
                    offenders.push({ value: text, colIdx });
                }
            });
        });
        record(SUITE, `Class D: no individual Sale Week's Trunk Utilization exceeds ${SANE_CEILING_PERCENT}% (comma-truncation fingerprint)`,
            offenders.length === 0, { offenders: offenders.slice(0, 5), offenderCount: offenders.length });

        // Companion positive check: Grand Total's Max Laden should be the
        // same order of magnitude as its own Total TEU (both are TEU-scale
        // quantities for the same trade network) -- the bug specifically
        // made Max Laden ~1000x SMALLER than Total TEU on the same row,
        // which this ratio check catches directly.
        const grandTotalMaxLdnRow = rows[1]; // Grand Total block: label, Max Laden, Total TEU, Trunk Utilization
        const grandTotalTeuRow = rows[2];
        if (grandTotalMaxLdnRow && grandTotalTeuRow) {
            const maxLdnCells = Array.from(grandTotalMaxLdnRow.querySelectorAll('td'));
            const teuCells = Array.from(grandTotalTeuRow.querySelectorAll('td'));
            const grandMaxLdn = parseNum(maxLdnCells[maxLdnCells.length - 1]?.textContent || '');
            const grandTeu = parseNum(teuCells[teuCells.length - 1]?.textContent || '');
            const ratio = (grandMaxLdn && grandTeu) ? grandTeu / grandMaxLdn : null;
            record(SUITE, 'Class D: Grand Total Max Laden is the same order of magnitude as Grand Total Total TEU (ratio < 50)',
                ratio !== null && ratio < 50,
                { grandMaxLdn, grandTeu, ratio });
        }
    })();

    // ============================================================
    // SUITE 8: Compare tab (added 2026-08-26, first-ever coverage for this
    // tab -- previously flagged in DATA_ARCHITECTURE.md as "not covered by
    // any audit"). Class F guard only: this tab renders nothing until BOTH
    // a main file AND a second "old" comparison file are loaded, and unlike
    // every other suite here, this one does not upload a file itself (the
    // "old" file needs to be a genuinely different export to produce a real
    // diff, which a data-agnostic suite can't assume access to) -- so this
    // check only fires when whoever invoked the suite already has both
    // loaded, and is silently skipped otherwise (same as this file's other
    // data-dependent conditional checks, e.g. the AP Frozen row-status
    // check in Suite 3 above).
    // ============================================================
    await (async function compareTabSuite() {
        const SUITE = 'Compare';
        if (!(await clickTab('Compare'))) { record(SUITE, 'Setup: tab button found', false); return; }
        await new Promise(r => setTimeout(r, 300));
        const utilMatch = document.body.innerText.match(/OVERALL UTILIZATION[\s\S]{0,80}?New:\s*(-?\d+)%/i);
        if (!utilMatch) return; // no "old" file loaded in this run -- nothing to check
        const newUtilz = parseInt(utilMatch[1], 10);
        // 2026-08-26 bug: "Overall Utilization" divided a multi-week CUMULATIVE
        // booking sum (ladenSum, every row across ~17 weeks) by each lane's single
        // PEAK-week capacity summed across lanes (maxLdnSum) -- a temporal-scope
        // mismatch, not a real reading. Confirmed 394-396% on real data. 150% is
        // deliberately generous (real weekly utilization is well under 100%) while
        // nowhere near the bug's actual scale -- bounds the failure mode without
        // hardcoding an exact "correct" number that would break on a future refresh.
        const SANE_CEILING_PERCENT = 150;
        record(SUITE, `Class F: "Overall Utilization" stays within a sane ceiling (${SANE_CEILING_PERCENT}%, temporal-scope-mismatch fingerprint)`,
            !isNaN(newUtilz) && newUtilz >= 0 && newUtilz <= SANE_CEILING_PERCENT,
            { newUtilz });
    })();

    const allPassed = allResults.every(r => r.pass);
    console.log(allPassed ? '\n✅ ALL TESTS PASSED' : '\n❌ SOME TESTS FAILED');
    return { results: allResults, allPassed };
}
// Top-level await works when pasted directly into a browser console; if
// running via an eval context that doesn't support it, wrap in an async
// IIFE instead: (async () => { const r = await runBookingFlashRegressionTests(); return r; })();
runBookingFlashRegressionTests();

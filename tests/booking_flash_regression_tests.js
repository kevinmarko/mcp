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
    // doesn't reflect the new tab until the next render, which hasn't
    // happened yet by the time a synchronous click() call returns. Wait a
    // tick before querying the DOM for that tab's content, or the first
    // suite to run can see the PREVIOUS tab's stale DOM (a test-script
    // race confirmed live during development, not an app bug).
    const clickTab = async (label) => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === label);
        if (!btn) return false;
        btn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
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
    // filter state a previous manual session left behind.
    const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Clear Filters');
    if (clearBtn) { clearBtn.click(); await new Promise(resolve => setTimeout(resolve, 100)); }

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
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const blocks = [];
        for (let i = 0; i < rows.length; i += 4) {
            const labelRow = rows[i];
            const maxLadenRow = rows[i + 1];
            if (!labelRow || !maxLadenRow) continue;
            const labelText = labelRow.querySelector('td')?.textContent.trim() || '';
            const maxLadenCells = Array.from(maxLadenRow.querySelectorAll('td'));
            const grandTotalMaxLdn = parseNum(maxLadenCells[maxLadenCells.length - 1]?.textContent || '');
            blocks.push({ labelText, grandTotalMaxLdn });
        }
        if (blocks.length < 2) { record(SUITE, 'Setup: parsed at least one Trade block', false, { blockCount: blocks.length }); return; }

        const overallGrandTotal = blocks[0];
        const tradeGroups = [];
        let current = null;
        for (let i = 1; i < blocks.length; i++) {
            const b = blocks[i];
            if (b.labelText.startsWith('−')) {
                current = { trade: b.labelText.slice(1), value: b.grandTotalMaxLdn, children: [] };
                tradeGroups.push(current);
            } else if (b.labelText.startsWith('•') && current) {
                current.children.push({ subTrade: b.labelText.slice(1), value: b.grandTotalMaxLdn });
            }
        }

        tradeGroups.forEach(g => {
            const sumOfChildren = g.children.reduce((s, c) => s + (c.value || 0), 0);
            record(SUITE, `Class A: Trade "${g.trade}" Max Laden == sum of its Sub Trade children`,
                Math.abs(g.value - sumOfChildren) < 1,
                { tradeValue: g.value, sumOfChildren, childCount: g.children.length });
        });

        const overallSumOfTrades = tradeGroups.reduce((s, g) => s + (g.value || 0), 0);
        record(SUITE, 'Class A: overall Grand Total Max Laden == sum of all Trades',
            Math.abs(overallGrandTotal.grandTotalMaxLdn - overallSumOfTrades) < 1,
            { grandTotal: overallGrandTotal.grandTotalMaxLdn, sumOfTrades: overallSumOfTrades });

        const unreadableCells = findUnreadableCells(table);
        record(SUITE, 'Class B (guard): no unreadable cells anywhere in the table',
            unreadableCells.length === 0, { unreadableCount: unreadableCells.length });
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
        const laneMaxByLane = {};
        allRows.forEach(tr => {
            const tds = Array.from(tr.querySelectorAll('td'));
            if (tds.length < 5) return;
            const label = tds[0].textContent.trim();
            if (!label.startsWith('•')) return; // leaf (Lane-depth) rows only
            const lane = label.replace(/^•\s*/, '');
            const avgMaxLdn = parseNum(tds[1].textContent);
            if (avgMaxLdn === null) return;
            if (!(lane in laneMaxByLane) || avgMaxLdn > laneMaxByLane[lane]) laneMaxByLane[lane] = avgMaxLdn;
        });
        const expectedGrandTotalMaxLdn = Object.values(laneMaxByLane).reduce((s, v) => s + v, 0);

        const grandTotalRow = allRows.find(tr => tr.querySelector('td')?.textContent.trim() === 'Grand Total');
        const grandTotalCells = grandTotalRow ? Array.from(grandTotalRow.querySelectorAll('td')) : [];
        const actualGrandTotalMaxLdn = grandTotalCells[1] ? parseNum(grandTotalCells[1].textContent) : null;

        record(SUITE, 'Class A: Grand Total Avg Max Laden == sum of each distinct lane\'s own max',
            actualGrandTotalMaxLdn !== null && Math.abs(actualGrandTotalMaxLdn - expectedGrandTotalMaxLdn) < 1,
            { expected: expectedGrandTotalMaxLdn, actual: actualGrandTotalMaxLdn, laneCount: Object.keys(laneMaxByLane).length });

        const singleLaneMax = Math.max(...Object.values(laneMaxByLane));
        const looksLikeFlatMaxRegression = actualGrandTotalMaxLdn !== null && Object.keys(laneMaxByLane).length > 1 && Math.abs(actualGrandTotalMaxLdn - singleLaneMax) < 1;
        record(SUITE, 'Class A: Grand Total is NOT just the single largest lane\'s value (flat-max fingerprint)',
            !looksLikeFlatMaxRegression, { singleLaneMax, actual: actualGrandTotalMaxLdn });

        // KPI card label renders as "Avg Utilization" in the DOM even though
        // it visually appears as "AVG UTILIZATION" -- CSS uppercase
        // text-transform, not the real text content.
        const findKpiValue = (labelText) => {
            const labelEl = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim() === labelText && d.children.length === 0);
            if (!labelEl) return null;
            const valueEl = labelEl.nextElementSibling;
            return valueEl ? parseNum(valueEl.textContent) : null;
        };
        const kpiUtilz = findKpiValue('Avg Utilization');
        const actualUtilzCell = grandTotalCells[4] ? parseNum(grandTotalCells[4].textContent) : null;
        record(SUITE, 'Class A: KPI card "Avg Utilization" matches pivot Grand Total exactly',
            kpiUtilz !== null && actualUtilzCell !== null && Math.abs(kpiUtilz - actualUtilzCell) < 1,
            { kpiCard: kpiUtilz, pivotGrandTotal: actualUtilzCell });

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
    })();

    // Shared helpers for the two Analyze-modal suites below.
    const openAnalysis = async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Analyze'));
        if (!btn || btn.disabled) return false;
        btn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        return true;
    };
    const closeAnalysis = async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Close Analysis');
        if (btn) btn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
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
    const checkAnalysisMath = (SUITE, record, data, overallShouldMatchSumOfCards) => {
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
            // Negative check: this is the exact fingerprint of the
            // POL-over-counting bug fixed 2026-08-18 -- if Overall Capacity
            // ever again equals the naive sum of the (sub-lane) breakdown
            // cards, that's the bug back, not a coincidence.
            record(SUITE, 'Analyze: Overall Capacity is NOT the naive sum of sub-lane breakdown cards (would be the fixed over-counting bug)',
                Math.abs(overall.capacity - sumCapacity) > roundingTolerance || groups.length <= 1,
                { overall: overall.capacity, naiveSumOfCards: sumCapacity });
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
        checkAnalysisMath(SUITE, record, data, /* overallShouldMatchSumOfCards */ false);
        if (bookingFlashAnalysis) {
            record(SUITE, 'Analyze: Overall Snapshot matches Booking Flash tab\'s Overall exactly (same filter, same by-lane computation)',
                Math.abs(data.overall.capacity - bookingFlashAnalysis.capacity) < 1 &&
                Math.abs(data.overall.laden - bookingFlashAnalysis.laden) < 1 &&
                Math.abs(data.overall.shortfall - bookingFlashAnalysis.shortfall) < 1,
                { bookingFlash: bookingFlashAnalysis, polBookingFlash: data.overall });
        }
        await closeAnalysis();
    })();

    const allPassed = allResults.every(r => r.pass);
    console.log(allPassed ? '\n✅ ALL TESTS PASSED' : '\n❌ SOME TESTS FAILED');
    return { results: allResults, allPassed };
}
// Top-level await works when pasted directly into a browser console; if
// running via an eval context that doesn't support it, wrap in an async
// IIFE instead: (async () => { const r = await runBookingFlashRegressionTests(); return r; })();
runBookingFlashRegressionTests();

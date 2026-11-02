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
 *   Utilization) are legitimately flat-maxed (you can't meaningfully
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
 *   2026-09-04: Sector_Summary's own Total-column tint (bg-[#eef2fa]) was
 *   removed entirely (Kevin: "make the data background white") -- the shared
 *   PivotTableViewer's "tabular without valuesInRows" branch it lived in is
 *   used ONLY by Sector_Summary's two tables (Trade_Summary uses a different
 *   branch and keeps its own real Grand Total column's #eef2fa tint, since
 *   that column is a genuine aggregate, unlike Sector_Summary where every
 *   cell was mistakenly treated as "the Total column" for lack of a real
 *   colField breakdown). The mutual-exclusivity fix itself (never emit the
 *   baseline background and a field's own flag background on the same
 *   cell) is untouched -- only the baseline color changed, from #eef2fa to
 *   plain white.
 *   No N.A. Call row-status color vs the same >10%-since-prior-day
 *   utilization flag). Fixed by making one class win deterministically
 *   (never emit both bg- classes on the same cell) rather than relying on
 *   accidental insertion order. Booking Flash's own copy of the same
 *   >10%-since-prior-day flag was already safe by construction (uses an
 *   inline `style`, which always wins over any class regardless of
 *   insertion order) -- verified here as a standing regression guard
 *   against ever changing it back to a className-based conflict.
 *   Trade_Summary's own cellClass (Utilization row, 2026-09-03: always-on
 *   bg-[#DA9694] + bold, red text past 100%) is the row's ONLY background
 *   source -- no other class ever contends for this cell -- so it still has
 *   no Class B exposure despite now always emitting a background, and stays
 *   swept generically as a guard.
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

        // 2026-09-02 rewrite: this pivot's config is tabular:true +
        // valuesInRows:true + hideRowToggles:true + showGrandTotal:false +
        // showGrandTotalColumn:false (see the tabular-and-valuesInRows render
        // branch in the app source, ~line 1078-1163). Under that combination
        // rows come in a 3-row cycle per Sub Trade leaf -- Max Laden, then
        // Total TEU, then Utilization -- NOT the old assumed 4-row
        // cycle (label row + 3 data rows): there is no separate label-only
        // row and no −/• toggle-glyph prefix (hideRowToggles suppresses that
        // JSX entirely, and this render branch never emits it in the first
        // place). Instead the Trade/Sub Trade label is rowSpan-merged into
        // the FIRST of the 3 rows as plain text: that row carries a Trade
        // <td> only when it's the first Sub Trade of a new Trade (rowSpan
        // covers every Sub Trade under it), and always carries a Sub Trade
        // <td> (rowSpan covering just its own 3 rows); the middle/last rows
        // of each cycle carry no label cells at all. Also, since there's no
        // Grand Total row in this config, blocks[0]/[1]/[2] are simply the
        // first Sub Trade's own 3 rows, not a synthetic overall total.
        //
        // Locate each cycle's dataField label cell by its own text (rather
        // than assuming a fixed column count), then everything to its left
        // in that row is the label cell(s) rowSpan-merged in -- this stays
        // correct regardless of whether 0, 1, or 2 label cells land in a
        // given row.
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const DATA_FIELD_LABELS = ['Max Laden', 'Total TEU', 'Utilization'];
        const subTradeGroups = [];
        let currentTrade = null;
        for (let i = 0; i + 2 < rows.length; i += 3) {
            const cycle = [rows[i], rows[i + 1], rows[i + 2]].map(tr => {
                const cells = Array.from(tr.querySelectorAll('td'));
                const dfIdx = cells.findIndex(td => DATA_FIELD_LABELS.includes(td.textContent.trim()));
                return {
                    dfLabel: dfIdx >= 0 ? cells[dfIdx].textContent.trim() : null,
                    labelCells: dfIdx > 0 ? cells.slice(0, dfIdx).map(td => td.textContent.trim()) : [],
                    valueCells: dfIdx >= 0 ? cells.slice(dfIdx + 1) : cells,
                };
            });
            // Only treat this as a real cycle if the 3 rows carry the 3 dataField
            // labels in the expected order -- guards against ever mis-grouping if
            // the tbody's row count isn't a clean multiple of 3.
            if (cycle[0].dfLabel !== 'Max Laden' || cycle[1].dfLabel !== 'Total TEU' || cycle[2].dfLabel !== 'Utilization') break;
            const labelCells = cycle[0].labelCells;
            let trade, subTrade;
            if (labelCells.length >= 2) {
                trade = labelCells[labelCells.length - 2];
                subTrade = labelCells[labelCells.length - 1];
                currentTrade = trade;
            } else {
                trade = currentTrade;
                subTrade = labelCells[0] || null;
            }
            subTradeGroups.push({
                trade, subTrade,
                maxLdnValues: cycle[0].valueCells.map(td => parseNum(td.textContent)),
            });
        }
        if (subTradeGroups.length < 1) { record(SUITE, 'Setup: parsed at least one Sub Trade group', false, { groupCount: subTradeGroups.length }); return; }

        // Roll each Sub Trade's Max Laden (summed across every Sale Week column)
        // up to its Trade (TPT/TAT/LAT). There's no rendered Trade-level row to
        // read directly under this config (no Grand Total row, and no Trade
        // subtotal row either -- flattenTabular only emits a row once it reaches
        // a leaf), so the Trade total is derived by summing its own Sub Trade
        // children -- there's nothing independent left to compare it against, so
        // this replaces the old "Trade == sum of children" equality check with
        // the real invariant that's still checkable here: every group's numbers
        // must have actually parsed, not come back as 0/NaN/blank.
        const tradeGroups = [];
        const tradeByName = new Map();
        subTradeGroups.forEach(g => {
            const anyNull = g.maxLdnValues.some(v => v === null);
            const sum = g.maxLdnValues.reduce((s, v) => s + (v || 0), 0);
            let trade = tradeByName.get(g.trade);
            if (!trade) {
                trade = { trade: g.trade, value: 0, anyNull: false, childCount: 0 };
                tradeByName.set(g.trade, trade);
                tradeGroups.push(trade);
            }
            trade.value += sum;
            trade.anyNull = trade.anyNull || anyNull;
            trade.childCount++;
        });

        // Guard against a real false-positive found 2026-08-19: parseNum()
        // returns null when a cell couldn't be parsed (e.g. read mid-render,
        // before the DOM settled) -- `Math.abs(null - 0) < 1` evaluates to
        // true (null coerces to 0 in arithmetic), so a genuinely-failed
        // parse could silently register as a passing "0 == 0" comparison
        // instead of surfacing as a failure. Every value feeding these checks
        // must be a real number, not null, or the check fails loudly instead
        // of silently passing.
        const anyNullSubTradeValue = subTradeGroups.some(g => g.maxLdnValues.some(v => v === null));
        record(SUITE, 'Class A: every Sub Trade group\'s Max Laden parsed to real (non-null) values across all Sale Weeks',
            !anyNullSubTradeValue, { subTradeGroupCount: subTradeGroups.length, anyNullSubTradeValue });

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

        // Class A: the original "Class A" intent (2026-09-02 rewrite) -- with no
        // Grand Total row/column left to compare against (showGrandTotal:false,
        // showGrandTotalColumn:false), the useful guard left is that every Trade
        // (TPT/TAT/LAT) parsed to a real, positive Max Laden value, catching a
        // case where the table renders but a group's numbers come back as
        // 0/NaN/blank.
        const anyNullTradeValue = tradeGroups.some(g => g.anyNull);
        const overallSumOfTrades = tradeGroups.reduce((s, g) => s + (g.value || 0), 0);
        record(SUITE, 'Class A: every Trade parsed to a real, positive Max Laden value',
            tradeGroups.length > 0 && !anyNullTradeValue && tradeGroups.every(g => g.value > 0) && overallSumOfTrades > 0,
            { trades: tradeGroups.map(g => ({ trade: g.trade, value: g.value, childCount: g.childCount })), overallSumOfTrades, anyNullTradeValue });

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
        const rightTable = tables.find(t => t.querySelector('caption')?.textContent === 'Sector Summary');

        // parseLevel (2026-08-24, updated 2026-09-02): both of this tab's
        // pivots use `tabular: true` WITHOUT `valuesInRows` -- under that
        // config the "Tabular without Values In Rows" render branch renders
        // each rowField's label as a BARE TEXT NODE directly inside a
        // rowSpan-merged <td> ({row.path[rfIdx]}, no wrapping <span>), so
        // `td.querySelector('span')` always returns null and this always
        // returns level 1. That's harmless for checkTradeOrder below (it
        // only cares whether a row's first surviving <td> is literally a
        // Trade label, which the rowSpan DOM structure guarantees regardless
        // of level classification) but means it can NOT be used to
        // reconstruct a Trade -> Sub Trade -> Lane tree -- see the Class A
        // rewrite below, which reads the real structural signal instead
        // (each label/value <td>'s own `data-autofit-col="rowLabels-N"` /
        // `data-autofit-col="<dataField.name>"` attribute, set unconditionally
        // by the render code regardless of any span).
        const parseLevel = (td) => {
            const span = td.querySelector('span');
            const pl = span ? (parseFloat(span.style.paddingLeft) || 0) : 0;
            return Math.round(pl / 1.5) + 1; // rem units; level 1 = 0rem, level 2 = 1.5rem, level 3 = 3rem
        };

        // Class A rewrite (2026-09-02): the old version of this check
        // reconstructed Trade -> Sub Trade -> Lane parent rows from
        // `parseLevel` and looked for a row whose OWN value equals the sum
        // of its children's. That doesn't exist to find: this render mode
        // (tabular without valuesInRows) never emits a separate row for an
        // intermediate Trade or Sub Trade node in a fully populated tree --
        // `flattenTabular` only pushes a row once it reaches the deepest
        // rowField (Lane for the left pivot, POD Sector for the right one),
        // rowSpan-merging every ancestor label into that one leaf row. So
        // "each Trade/Sub Trade row == sum of its children" was checking a
        // DOM shape that can't occur, and both checks always reported
        // checked:0 (never found a row it could classify as a parent with a
        // detected child).
        //
        // What actually exists to check: every LEAF row (Trade + Sub Trade +
        // Lane [+ POD Sector], rowSpan-merged) and its own values. This
        // extracts those leaves using the render's real structural markers
        // -- each surviving <td>'s `data-autofit-col` attribute names either
        // its rowField index ("rowLabels-N") or its dataField ("avgMaxLdn",
        // etc.) -- and carries the last-seen label for each rowField index
        // forward across rows (exactly what the rowSpan visually does), so
        // a row that doesn't re-render an ancestor cell (because it's still
        // merged into an earlier row) still gets that ancestor's real value.
        const extractLeafRows = (table, rowFieldCount, dataFieldNames) => {
            const trs = Array.from(table.querySelectorAll('tbody tr'));
            const currentPath = new Array(rowFieldCount).fill(null);
            const leaves = [];
            for (const tr of trs) {
                const tds = Array.from(tr.children);
                // A Trade/Sub Trade "<Label> Total" subtotal cell (or a
                // "Grand Total" cell) carries no data-autofit-col of its own
                // in this render mode -- if one is present this row isn't a
                // genuine leaf, skip it. In practice this never fires for a
                // fully populated tree (every Trade has Sub Trades, every
                // Sub Trade has Lanes, ...) -- see comment above -- but it's
                // cheap insurance against ever silently misreading a
                // genuine subtotal row as a leaf if that ever changes.
                if (tds.some(td => / Total$/.test(td.textContent.trim()))) continue;
                let sawDataCell = false;
                const values = {};
                for (const td of tds) {
                    const key = td.getAttribute('data-autofit-col');
                    if (!key) continue;
                    const m = /^rowLabels-(\d+)$/.exec(key);
                    if (m) {
                        currentPath[Number(m[1])] = td.textContent.trim();
                    } else if (dataFieldNames.includes(key)) {
                        values[key] = parseNum(td.textContent);
                        sawDataCell = true;
                    }
                }
                if (!sawDataCell) continue; // header/toggle row or similar -- not a leaf data row
                if (currentPath.slice(0, rowFieldCount).some(v => v === null)) continue; // path not fully known yet
                leaves.push({ path: currentPath.slice(0, rowFieldCount), values });
            }
            return leaves;
        };
        // Sums every leaf's `field` grouped by its path truncated to
        // `prefixLen` levels (1 = per-Trade, 2 = per-Sub-Trade, ...).
        const sumByPathPrefix = (leaves, prefixLen, field) => {
            const map = new Map();
            for (const leaf of leaves) {
                const v = leaf.values[field];
                if (v === null || v === undefined) continue;
                const key = leaf.path.slice(0, prefixLen).join('|');
                map.set(key, (map.get(key) || 0) + v);
            }
            return map;
        };
        // Trade-level total == that Trade's Sub Trade totals rolled up.
        // Trivial by construction (both sides are sums over the same leaf
        // set), but it's exactly the invariant a real bug would break: a
        // leaf silently dropped, double-counted, or grouped under the wrong
        // ancestor (e.g. a rowSpan/path-reconstruction mistake in
        // extractLeafRows above, or a genuinely duplicated <tr> in the live
        // DOM) makes the two sides disagree immediately.
        const checkRollupIdentity = (leaves, field, fieldLabel, pivotLabel) => {
            const tradeSums = sumByPathPrefix(leaves, 1, field);
            const subTradeSums = sumByPathPrefix(leaves, 2, field);
            const rolledUp = new Map();
            for (const [key, val] of subTradeSums) {
                const trade = key.split('|')[0];
                rolledUp.set(trade, (rolledUp.get(trade) || 0) + val);
            }
            const mismatches = [];
            for (const [trade, directSum] of tradeSums) {
                const rolled = rolledUp.get(trade);
                if (rolled === undefined || Math.abs(directSum - rolled) >= 1) {
                    mismatches.push({ trade, directSum, rolledFromSubTrades: rolled });
                }
            }
            record(SUITE, `Class A: ${pivotLabel} -- leaf-row ${fieldLabel} sums consistently (Trade-level total == its Sub Trade totals rolled up)`,
                tradeSums.size > 0 && mismatches.length === 0,
                { tradeCount: tradeSums.size, subTradeCount: subTradeSums.size, mismatches: mismatches.slice(0, 5) });
        };

        // Independent cross-check, the strongest check in this suite: every
        // leaf's values compared against the frozen numbers cached in
        // Kevin's real reference workbook (Booking_Flash_Report_REFERENCE_
        // 08-12-2026.xlsm), extracted verbatim into validation_ground_truth.
        // json's sector_summary_pivot1/sector_summary_pivot2 (see that
        // file's own extracted_at_note) and inlined below. Unlike the
        // internal-consistency check above -- which holds by construction
        // even if the app's rollup math were wrong the SAME way at every
        // leaf -- this catches the app's numbers disagreeing with a
        // genuinely independent, already-verified source. Matched by
        // (Trade, Sub Trade, Lane [, POD Sector]) key, so only rows present
        // in BOTH the live upload and the reference snapshot are compared --
        // still holds if a different data file (different lane/POD mix) is
        // uploaded, same as every other check in this suite.
        //
        // 2026-09-04 KNOWN-STALE NOTE (found during a full field-mapping
        // audit, not a regression): SECTOR_RIGHT_GROUND_TRUTH's TAT/TA/EMA/
        // GRPIR row (sectorAlloc:115) is frozen from the 2026-08-12
        // reference workbook. That same day, the live SECTOR_DATA_CSV_URL
        // sheet's duplicate "MCT Sector Allocation" column was fixed to
        // correctly read 99 for this one row (see DATA_ARCHITECTURE.md's
        // sectorAlloc entry) -- so against a live-fetched Sheet this one
        // row will now legitimately mismatch this frozen 115, which is
        // EXPECTED and NOT a sign the fix broke something. This sits
        // alongside the pre-existing, more general staleness this array
        // already has on nearly every row's avgBooking/openSpace (normal
        // week-to-week drift, same caveat this file's header already
        // documents for reference-workbook comparisons) -- GRPIR is simply
        // the one row where the drift has a known, explainable root cause
        // instead of being ordinary data aging. In practice this check
        // rarely exercises live data anyway: most sandboxed test runs fall
        // back to the frozen SECTOR_DATA_SEED (no network path to
        // docs.google.com), which still matches this snapshot closely
        // since both were captured around the same date.
        const SECTOR_LEFT_GROUND_TRUTH = [{"trade":"TPT","subTrade":"AW","lane":"EC1","avgMaxLdn":3400,"avgBkg":923},{"trade":"TPT","subTrade":"AW","lane":"EC2","avgMaxLdn":5225,"avgBkg":2349},{"trade":"TPT","subTrade":"AW","lane":"EC3","avgMaxLdn":4856.25,"avgBkg":1275},{"trade":"TPT","subTrade":"AW","lane":"EC4","avgMaxLdn":2491.6666666666665,"avgBkg":1142},{"trade":"TPT","subTrade":"AW","lane":"WIN","avgMaxLdn":2700,"avgBkg":2368},{"trade":"TPT","subTrade":"PN","lane":"FP2","avgMaxLdn":3303.3333333333335,"avgBkg":1468},{"trade":"TPT","subTrade":"PN","lane":"PN1","avgMaxLdn":2030,"avgBkg":1034},{"trade":"TPT","subTrade":"PN","lane":"PN3","avgMaxLdn":1441.6666666666667,"avgBkg":805},{"trade":"TPT","subTrade":"PS","lane":"MS2","avgMaxLdn":6993.75,"avgBkg":386},{"trade":"TPT","subTrade":"PS","lane":"PS1","avgMaxLdn":4385,"avgBkg":2412},{"trade":"TPT","subTrade":"PS","lane":"PS3","avgMaxLdn":3801.25,"avgBkg":1869},{"trade":"TPT","subTrade":"PS","lane":"PS4","avgMaxLdn":1860,"avgBkg":1337},{"trade":"TPT","subTrade":"PS","lane":"PS6","avgMaxLdn":2793.75,"avgBkg":965},{"trade":"TPT","subTrade":"PS","lane":"PS7","avgMaxLdn":2175,"avgBkg":792},{"trade":"TPT","subTrade":"PS","lane":"PS8","avgMaxLdn":1383.3333333333333,"avgBkg":65},{"trade":"TPT","subTrade":"PS","lane":"VSE","avgMaxLdn":3525,"avgBkg":503},{"trade":"TAT","subTrade":"TA","lane":"AL5","avgMaxLdn":1326.6666666666667,"avgBkg":1072},{"trade":"TAT","subTrade":"TA","lane":"AT1","avgMaxLdn":2226,"avgBkg":1361},{"trade":"TAT","subTrade":"TA","lane":"AT3","avgMaxLdn":476.6666666666667,"avgBkg":475},{"trade":"TAT","subTrade":"TA","lane":"AT4","avgMaxLdn":834,"avgBkg":355},{"trade":"TAT","subTrade":"TA","lane":"EMA","avgMaxLdn":867,"avgBkg":515},{"trade":"LAT","subTrade":"LN","lane":"AN2","avgMaxLdn":140,"avgBkg":158},{"trade":"LAT","subTrade":"LN","lane":"ANG","avgMaxLdn":252.5,"avgBkg":138},{"trade":"LAT","subTrade":"LN","lane":"FLX","avgMaxLdn":325,"avgBkg":278},{"trade":"LAT","subTrade":"LN","lane":"MAR","avgMaxLdn":1176,"avgBkg":425}];
        const SECTOR_RIGHT_GROUND_TRUTH = [{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"CNSHA","sectorAlloc":0,"avgBooking":6,"openSpace":0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"CNTAO","sectorAlloc":0,"avgBooking":28,"openSpace":0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"LKCMB","sectorAlloc":20,"avgBooking":51,"openSpace":0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"PAMIT","sectorAlloc":0,"avgBooking":84,"openSpace":0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"SGSIN","sectorAlloc":350,"avgBooking":271,"openSpace":79},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"THLCH","sectorAlloc":500,"avgBooking":205,"openSpace":295},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"VNCMP","sectorAlloc":325,"avgBooking":128,"openSpace":198},{"trade":"TPT","subTrade":"PN","lane":"FP2","podSec":"SGSIN","sectorAlloc":200,"avgBooking":215,"openSpace":0},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"CNSHA","sectorAlloc":300,"avgBooking":49,"openSpace":251},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"CNSHK","sectorAlloc":20,"avgBooking":47,"openSpace":0},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"INNSA","sectorAlloc":380,"avgBooking":375,"openSpace":5},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"SGSIN","sectorAlloc":180,"avgBooking":251,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"BEANR","sectorAlloc":50,"avgBooking":296,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"DEHAM","sectorAlloc":220,"avgBooking":169,"openSpace":51},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"FRLEH","sectorAlloc":450,"avgBooking":48,"openSpace":402},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"GBSOU","sectorAlloc":700,"avgBooking":393,"openSpace":307},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"BEANR","sectorAlloc":175,"avgBooking":251,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"DEBRV","sectorAlloc":990,"avgBooking":311,"openSpace":680},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"FRLEH","sectorAlloc":210,"avgBooking":59,"openSpace":151},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"GBSOU","sectorAlloc":231,"avgBooking":330,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"NLRTM","sectorAlloc":1080,"avgBooking":407,"openSpace":673},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"BEANR","sectorAlloc":50,"avgBooking":217,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"DEBRV","sectorAlloc":50,"avgBooking":63,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"GBSOU","sectorAlloc":200,"avgBooking":89,"openSpace":111},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"NLRTM","sectorAlloc":200,"avgBooking":106,"openSpace":94},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"USHOU","sectorAlloc":0,"avgBooking":0,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ESALG","sectorAlloc":28,"avgBooking":128,"openSpace":0},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ESVLC","sectorAlloc":209,"avgBooking":72,"openSpace":138},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"FRFOS","sectorAlloc":77,"avgBooking":61,"openSpace":17},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ITGOA","sectorAlloc":312,"avgBooking":65,"openSpace":247},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ITSPE","sectorAlloc":262,"avgBooking":28,"openSpace":234},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"GRPIR","sectorAlloc":115,"avgBooking":99,"openSpace":1},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"ITSAL","sectorAlloc":20,"avgBooking":5,"openSpace":15},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"TRALI","sectorAlloc":275,"avgBooking":26,"openSpace":249},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"TRISK","sectorAlloc":235,"avgBooking":144,"openSpace":91},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"TRIST","sectorAlloc":347,"avgBooking":241,"openSpace":106}];

        // --- Left pivot: "Average Max Laden vs Booking" (Trade/Sub Trade/Lane) ---
        const leftLeaves = extractLeafRows(leftTable, 3, ['avgMaxLdn', 'avgBkg', 'avgMaxVsBkg', 'avgUtilz']);
        record(SUITE, 'Setup: parsed at least one leaf (Trade/Sub Trade/Lane) row on "Average Max Laden vs Booking"',
            leftLeaves.length > 0, { leafCount: leftLeaves.length });

        const leftBadLeaves = leftLeaves.filter(l => l.values.avgMaxLdn === null || l.values.avgMaxLdn < 0);
        record(SUITE, 'Class A: "Average Max Laden vs Booking" -- every leaf row\'s Avg Max Laden parsed to a real, non-negative number',
            leftLeaves.length > 0 && leftBadLeaves.length === 0,
            { leafCount: leftLeaves.length, badCount: leftBadLeaves.length, badSamples: leftBadLeaves.slice(0, 5).map(l => l.path.join(' / ')) });

        checkRollupIdentity(leftLeaves, 'avgMaxLdn', 'Avg Max Laden', '"Average Max Laden vs Booking"');

        const leftGtByKey = new Map(SECTOR_LEFT_GROUND_TRUTH.map(g => [`${g.trade}|${g.subTrade}|${g.lane}`, g]));
        const leftGtMismatches = [];
        let leftGtChecked = 0;
        for (const leaf of leftLeaves) {
            const gt = leftGtByKey.get(leaf.path.join('|'));
            if (!gt) continue;
            leftGtChecked++;
            const maxLdnOk = leaf.values.avgMaxLdn !== null && Math.abs(leaf.values.avgMaxLdn - gt.avgMaxLdn) < 1;
            const bkgOk = leaf.values.avgBkg !== null && Math.abs(leaf.values.avgBkg - gt.avgBkg) < 1;
            if (!maxLdnOk || !bkgOk) {
                leftGtMismatches.push({ path: leaf.path.join(' / '), got: { avgMaxLdn: leaf.values.avgMaxLdn, avgBkg: leaf.values.avgBkg }, expected: { avgMaxLdn: gt.avgMaxLdn, avgBkg: gt.avgBkg } });
            }
        }
        record(SUITE, 'Class A: "Average Max Laden vs Booking" -- leaf-row Avg Max Laden/Avg Booking match the reference workbook for overlapping Trade/Sub Trade/Lane rows',
            leftGtChecked > 0 && leftGtMismatches.length === 0,
            { leftGtChecked, gtTotal: SECTOR_LEFT_GROUND_TRUTH.length, mismatches: leftGtMismatches.slice(0, 5) });

        // --- Right pivot: "Sector Summary" (Trade/Sub Trade/Lane/POD Sector) ---
        if (rightTable) {
            const rightLeaves = extractLeafRows(rightTable, 4, ['sectorAlloc', 'avgBooking', 'openSpace']);
            record(SUITE, 'Setup: parsed at least one leaf (Trade/Sub Trade/Lane/POD Sector) row on "Sector Summary"',
                rightLeaves.length > 0, { leafCount: rightLeaves.length });

            const rightBadLeaves = rightLeaves.filter(l => l.values.sectorAlloc === null || l.values.sectorAlloc < 0);
            record(SUITE, 'Class A: "Sector Summary" -- every leaf row\'s Sector Alloc parsed to a real, non-negative number',
                rightLeaves.length > 0 && rightBadLeaves.length === 0,
                { leafCount: rightLeaves.length, badCount: rightBadLeaves.length, badSamples: rightBadLeaves.slice(0, 5).map(l => l.path.join(' / ')) });

            checkRollupIdentity(rightLeaves, 'sectorAlloc', 'Sector Alloc', '"Sector Summary"');

            const rightGtByKey = new Map(SECTOR_RIGHT_GROUND_TRUTH.map(g => [`${g.trade}|${g.subTrade}|${g.lane}|${g.podSec}`, g]));
            const rightGtMismatches = [];
            let rightGtChecked = 0;
            for (const leaf of rightLeaves) {
                const gt = rightGtByKey.get(leaf.path.join('|'));
                if (!gt) continue;
                rightGtChecked++;
                const ok = leaf.values.sectorAlloc !== null && Math.abs(leaf.values.sectorAlloc - gt.sectorAlloc) < 1 &&
                    leaf.values.avgBooking !== null && Math.abs(leaf.values.avgBooking - gt.avgBooking) < 1 &&
                    leaf.values.openSpace !== null && Math.abs(leaf.values.openSpace - gt.openSpace) < 1;
                if (!ok) {
                    rightGtMismatches.push({ path: leaf.path.join(' / '), got: leaf.values, expected: gt });
                }
            }
            record(SUITE, 'Class A: "Sector Summary" -- leaf-row Sector Alloc/Average Booking/Open Space match the reference workbook for overlapping rows',
                rightGtChecked > 0 && rightGtMismatches.length === 0,
                { rightGtChecked, gtTotal: SECTOR_RIGHT_GROUND_TRUTH.length, mismatches: rightGtMismatches.slice(0, 5) });
        }

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
        if (rightTable) checkTradeOrder(rightTable, '"Sector Summary"');

        const unreadableCells = findUnreadableCells(leftTable);
        record(SUITE, 'Class B: no white text on light/transparent background anywhere in the table',
            unreadableCells.length === 0,
            { unreadableCount: unreadableCells.length, samples: unreadableCells.slice(0, 3).map(td => td.textContent.trim()) });

        // 2026-09-04: the old #eef2fa Total-column tint was removed from both
        // Sector_Summary tables (Kevin: "make the data background white") --
        // checked across BOTH leftTable and rightTable since they share the
        // exact same PivotTableViewer render branch. No cell in either table
        // should carry that class anymore.
        const allCells = [...leftTable.querySelectorAll('td'), ...(rightTable ? rightTable.querySelectorAll('td') : [])];
        const staleTintCells = allCells.filter(td => td.className.includes('bg-[#eef2fa]'));
        record(SUITE, 'Class B fix is not stale: the old Total-column tint is gone from both tables (now plain white per Kevin\'s request)',
            staleTintCells.length === 0, { checkedCells: allCells.length, staleTintCount: staleTintCells.length });

        // Class B fix still holds with the new baseline: any cell that IS
        // actually flagged (>100% Avg Utilization, bg-red-600) keeps its own
        // flag undisturbed by the tint removal -- mutual exclusivity intact.
        const flaggedCells = allCells.filter(td => td.className.includes('bg-red-600'));
        record(SUITE, 'Class B fix is not overbroad: >100%-utilization flagged cells still carry their own bg-red-600 flag',
            flaggedCells.every(td => !td.className.includes('bg-[#eef2fa]')),
            { flaggedCount: flaggedCells.length });
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
        // POL Booking Flash's thead has TWO rows: row [0] is a per-column filter
        // row (each <th> holds only a bare <input type="text">, so textContent is
        // "" for every cell) and row [1] holds the real column labels, including
        // "BSA TEU" -- same two-row-thead shape as the Booking_Flash suite's own
        // detailHeaderRow below (see that suite's comment). Picked defensively
        // (first thead row with any non-empty cell text) rather than hardcoding
        // index [1], so this keeps working if a future markup change reorders or
        // adds thead rows.
        const theadRowsForHeader = Array.from(table.querySelectorAll('thead tr'));
        const headerRow0 = theadRowsForHeader.find(tr =>
            Array.from(tr.children).some(th => th.textContent.replace(/[▲▼]/g, '').trim() !== '')
        ) || theadRowsForHeader[0];
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

        // VMS row blanking (2026-09-04, Item 21): "if the VVD or Vessel name = 'VMS'
        // make all following fields blank". Before this fix, POL Booking Flash used a
        // narrow whitelist (VMS_ZERO_MASK_FIELDS) that only blanked a handful of fields
        // and only when the value was literally zero -- BSA TEU/RFR Utilz%/POL Max
        // Laden/POL Laden Threshold/Current Laden Utilz %/Max Laden Vs POL Booking still
        // showed a stray "0"/"0%" on VMS rows. Checked by cell SHAPE across every column
        // actually present after Vessel Name (works regardless of which toggle-gated
        // columns are currently shown), not a specific field list -- a future field added
        // after Vessel Name is automatically covered.
        // Matched via the same whitespace-stripped normalization this suite's own
        // commaFields/date-field checks use elsewhere -- confirmed live this row's
        // labels concatenate inconsistently (e.g. "VesselName", "Peak LadenUtilz %"),
        // so an exact-string match silently found neither column (idx === -1, gated
        // by the `>= 0` check below never firing) the first time this was written.
        const vvdIdx = headerLabels.findIndex(h => h.replace(/\s+/g, '') === 'VVD');
        const vesselIdx = headerLabels.findIndex(h => h.replace(/\s+/g, '') === 'VesselName');
        if (vvdIdx >= 0 && vesselIdx >= 0) {
            const afterVesselIdx = Math.max(vvdIdx, vesselIdx) + 1;
            const leakedCells = [];
            let vmsRowCount = 0;
            rows.forEach(tr => {
                const tds = Array.from(tr.children);
                const vvdText = tds[tds.length - polFromEndByIdx[vvdIdx]]?.textContent.trim();
                const vesselText = tds[tds.length - polFromEndByIdx[vesselIdx]]?.textContent.trim();
                if (vvdText !== 'VMS' && vesselText !== 'VMS') return;
                vmsRowCount++;
                for (let i = afterVesselIdx; i < headerLabels.length; i++) {
                    const td = tds[tds.length - polFromEndByIdx[i]];
                    const text = td ? td.textContent.trim() : '';
                    if (text !== '') leakedCells.push({ header: headerLabels[i], value: text });
                }
            });
            record(SUITE, 'Item 21 (2026-09-04): VMS rows (VVD or Vessel Name = "VMS") render every field after Vessel Name blank',
                leakedCells.length === 0, { vmsRowCount, leakedCells: leakedCells.slice(0, 10), leakedCount: leakedCells.length });
        }

        // Peak Utilz scale-correction guard (2026-09-04): "Measures Peak Overall/Pol
        // Utilz" has been observed arriving both as a true fraction (0.06 meaning 6%)
        // and already percent-scale (214 meaning 214%) -- the naive always-*100 parser
        // double-scaled the latter case (21400% instead of 214%). Fixed via
        // getPeakUtilPercentNum (see DATA_ARCHITECTURE.md's peakUtilRaw entry). A real
        // peak utilization, however extreme, will never legitimately reach 4 digits --
        // any cell shaped like that is this exact double-scaling bug back, regardless
        // of which file is uploaded.
        const peakUtilzPolIdx = headerLabels.findIndex(h => h.replace(/\s+/g, '') === 'PeakLadenUtilz%');
        if (peakUtilzPolIdx >= 0) {
            const fromEnd = polFromEndByIdx[peakUtilzPolIdx];
            const inflated = rows.flatMap(tr => {
                const tds = Array.from(tr.children);
                const td = tds[tds.length - fromEnd];
                if (!td) return [];
                const text = td.textContent.trim();
                return /^\d{4,}%$/.test(text) ? [text] : [];
            });
            record(SUITE, 'Item 21 fix guard (2026-09-04): "Peak Laden Utilz %" never renders a 4+ digit percent (peakPolUtilzRaw double-scaling fingerprint)',
                inflated.length === 0, { inflated: inflated.slice(0, 5), inflatedCount: inflated.length });
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

        // VMS row blanking (2026-09-04, Item 21) -- same fix/rationale as POL Booking
        // Flash's own guard above, applied here to this tab's Detail-view row shape.
        // This tab had NO VMS-based content masking at all before this fix (isVMS only
        // drove background color) -- checked by cell SHAPE across every column present
        // after Vessel Name, same "whatever's currently visible" approach as above.
        const detailVvdIdx = detailHeaderLabels.findIndex(h => h.replace(/\s+/g, '') === 'VVD');
        const detailVesselIdx = detailHeaderLabels.findIndex(h => h.replace(/\s+/g, '') === 'VesselName');
        if (detailVvdIdx >= 0 && detailVesselIdx >= 0) {
            const afterVesselIdx = Math.max(detailVvdIdx, detailVesselIdx) + 1;
            const leakedCells = [];
            let vmsRowCount = 0;
            detailRows.forEach(tr => {
                const tds = Array.from(tr.children);
                const vvdText = tds[tds.length - detailFromEndByIdx[detailVvdIdx]]?.textContent.trim();
                const vesselText = tds[tds.length - detailFromEndByIdx[detailVesselIdx]]?.textContent.trim();
                if (vvdText !== 'VMS' && vesselText !== 'VMS') return;
                vmsRowCount++;
                for (let i = afterVesselIdx; i < detailHeaderLabels.length; i++) {
                    const td = tds[tds.length - detailFromEndByIdx[i]];
                    const text = td ? td.textContent.trim() : '';
                    if (text !== '') leakedCells.push({ header: detailHeaderLabels[i], value: text });
                }
            });
            record(SUITE, 'Item 21 (2026-09-04): VMS rows (VVD or Vessel Name = "VMS") render every field after Vessel Name blank',
                leakedCells.length === 0, { vmsRowCount, leakedCells: leakedCells.slice(0, 10), leakedCount: leakedCells.length });
        }

        // Peak Utilz scale-correction guard (2026-09-04) -- same rationale as POL
        // Booking Flash's own guard above, applied to this tab's "Peak Utiliz %"
        // column (peakUtilRaw, via getPeakUtilPercentNum). Header text concatenates
        // to "PeakUtiliz %" (the <br/> between "Peak" and "Utiliz" contributes no
        // space, but the literal space before "%" is real) -- normalized the same
        // way this suite's own commaFields matching above already does.
        const peakUtilzDetailIdx = detailHeaderLabels.findIndex(h => h.replace(/\s+/g, '') === 'PeakUtiliz%');
        if (peakUtilzDetailIdx >= 0) {
            const fromEnd = detailFromEndByIdx[peakUtilzDetailIdx];
            const inflated = detailRows.flatMap(tr => {
                const tds = Array.from(tr.children);
                const td = tds[tds.length - fromEnd];
                if (!td) return [];
                const text = td.textContent.trim();
                return /^\d{4,}%$/.test(text) ? [text] : [];
            });
            record(SUITE, 'Item 21 fix guard (2026-09-04): "Peak Utiliz %" never renders a 4+ digit percent (peakUtilRaw double-scaling fingerprint)',
                inflated.length === 0, { inflated: inflated.slice(0, 5), inflatedCount: inflated.length });
        }
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
        // 2026-09-10: matches either the plain label or its "POL" qualified form
        // ("Avg Utilization" / "Avg POL Utilization") -- these two Overall Snapshot
        // tiles picked up the same conditional qualifier the per-card labels already
        // had (see the app's own comment at this tile), once Overall itself became
        // POL-scoped on the POL Booking Flash tab. An exact-only match would silently
        // return null for these two on that tab now -- the same label-drift class of
        // issue already handled below for the per-card 'Max Laden:' lookup.
        const findKpiValue = (labelText) => {
            const qualified = labelText.replace(/^Avg /, 'Avg POL ');
            const labelEl = Array.from(document.querySelectorAll('div')).find(d => {
                const text = d.textContent.trim();
                return (text === labelText || text === qualified) && d.children.length === 0;
            });
            if (!labelEl) return null;
            const valueEl = labelEl.nextElementSibling;
            return valueEl ? parseNum(valueEl.textContent) : null;
        };
        const overall = {
            utilization: findKpiValue('Avg Utilization'),
            // Label shortened to "Avg Max Laden" 2026-09-03 (was "Avg Wkly Capacity
            // (Max Laden)") so it fits on one line in the tile -- see the app source's
            // own comment at this same tile for why.
            capacity: findKpiValue('Avg Max Laden'),
            laden: findKpiValue('Avg Wkly Laden'),
            shortfall: findKpiValue('Avg Wkly Shortfall'),
        };
        const cards = Array.from(document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative'));
        const groups = cards.map(card => {
            const name = card.querySelector('.font-bold.text-sm.mb-2')?.textContent.trim();
            const badge = parseNum(card.querySelector('.absolute')?.textContent.trim() || '');
            const rows = Array.from(card.querySelectorAll('.flex.justify-between'));
            const getVal = (label) => { const row = rows.find(r => r.textContent.includes(label)); return row ? parseNum(row.children[1].textContent) : null; };
            // 2026-09-09: matches on 'Max Laden:' rather than the full 'Avg Wkly Max
            // Laden' -- the POL tab's breakdown cards now read 'Avg Wkly POL Max
            // Laden:' (see the app's own comment on this label, added alongside the
            // maxLdn-vs-polMaxLdn scope fix), which breaks the old label as one
            // contiguous substring. 'Max Laden:' is still unambiguous within a card's
            // 4 rows (Avg Wkly Laden's own row has no 'Max' before 'Laden').
            return { name, badge, avgWklyMaxLdn: getVal('Max Laden:'), avgWklyLaden: getVal('Avg Wkly Laden'), avgWklyShortfall: getVal('Avg Wkly Shortfall') };
        });
        return { overall, groups };
    };
    // Per-card algebra + Overall-vs-sum-of-cards checks, shared by both
    // Analyze suites.
    //
    // 2026-09-10: this used to branch on an `overallShouldMatchSumOfCards` flag
    // (false on the POL tab, asserting the OPPOSITE -- that Overall must NOT equal
    // the naive sum of POL cards, since summing them used to double/quadruple-count
    // a shared lane's vessel-wide capacity, the exact bug fixed 2026-08-18). That
    // stopped being true today: per Kevin ("I'm thinking they should all be POL
    // level as well, for this tab specifically... when you filter down to just one
    // port of call, you are not still seeing averages relative to the overall"),
    // POL Booking Flash's Overall Snapshot now aggregates by POL too (see the app's
    // own `laneSummaries` comment for the full writeup, including the real-data
    // validation that summing POL-specific `polMaxLdn` reconstructs a VVD's
    // vessel-wide capacity rather than multiplying it) -- so Overall IS now expected
    // to match the sum of the displayed cards on BOTH tabs, and the old negative
    // check (plus its `crossTabReference`-against-Booking-Flash fallback, no longer
    // meaningful now that the two tabs intentionally aggregate on different bases)
    // was retired rather than left asserting stale behavior.
    const checkAnalysisMath = (SUITE, record, data) => {
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

        record(SUITE, 'Analyze: Overall Capacity ~= sum of all breakdown cards\' Avg Wkly Max Laden',
            Math.abs(overall.capacity - sumCapacity) <= roundingTolerance,
            { overall: overall.capacity, sum: sumCapacity, tolerance: roundingTolerance });
        record(SUITE, 'Analyze: Overall Laden ~= sum of all breakdown cards\' Avg Wkly Laden',
            Math.abs(overall.laden - sumLaden) <= roundingTolerance,
            { overall: overall.laden, sum: sumLaden, tolerance: roundingTolerance });

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
    await (async function bookingFlashAnalyzeSuite() {
        const SUITE = 'Analyze_BookingFlash';
        if (!(await clickTab('Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        if (!(await openAnalysis())) { record(SUITE, 'Setup: Analyze button found and enabled', false); return; }
        const data = readAnalysisModal();
        if (data.groups.length === 0) { record(SUITE, 'Setup: at least one breakdown card found', false); await closeAnalysis(); return; }
        record(SUITE, 'Setup: modal opened with data', true, { cardCount: data.groups.length });
        checkAnalysisMath(SUITE, record, data);

        // "Departed" star AND-across-lanes guard (2026-09-04/06, Item 22): Kevin --
        // "make it only display the stars if all services selected have departed...
        // currently, if any service selected has sailed within that week, the star
        // displays". Fixed by changing the trend chart's per-week rollup from OR to
        // AND across every lane present that week. Independently re-derives the
        // expected per-week departed set from this tab's own raw rows (Lane/Sales
        // Week/ETD Last Port), using the exact "on or before today" day-granularity
        // rule the app itself uses (isOnOrBeforeDay), then cross-checks against the
        // chart's rendered star markers -- an independent-recomputation guard (same
        // pattern as this suite's own Class A checks), not a hardcoded week list,
        // so it keeps working as "today" advances or a different file is uploaded.
        // Click "All" first so the comparison covers every week the chart CAN show,
        // not just the default last-4-weeks window -- done after checkAnalysisMath
        // above so it can't affect that check's own (window-independent) math.
        await (async function departedStarGuard() {
            // className.includes(...) rather than a querySelectorAll CSS selector --
            // Tailwind's bracket-notation classes (text-[11px]) need escaping in a raw
            // CSS selector; filtering className text avoids that pitfall entirely, same
            // approach the chartWeeks scrape below (and this file's other suites) use.
            const countChartWeeks = () => Array.from(document.querySelectorAll('div')).filter(d =>
                d.className.includes('text-[11px]') && d.className.includes('font-bold') && /^W\d+★?$/.test(d.textContent.trim())
            ).length;
            const weeksBeforeClick = countChartWeeks();
            const allWeeksBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All');
            // Poll for the actual expected effect (more week-bars rendered) rather than
            // a fixed delay -- same poll-instead-of-guess convention as clickTab/
            // openAnalysis above. If the default view already showed every week (a
            // dataset with <=4 weeks total), the count won't change; that's fine, the
            // check below still runs against whatever's currently shown.
            if (allWeeksBtn) { allWeeksBtn.click(); await waitFor(() => countChartWeeks() !== weeksBeforeClick, { timeout: 2000 }); }

            const table = document.querySelector('table');
            if (!table) return;
            const theadRows = Array.from(table.querySelectorAll('thead tr'));
            const labelRow = theadRows[1] || theadRows[0];
            const headers = Array.from(labelRow.children).map(th => th.textContent.replace(/[▲▼]/g, '').trim());
            const saleWeekIdx = headers.findIndex(h => h.replace(/\s+/g, '') === 'SalesWeek');
            const etdIdx = headers.findIndex(h => h.includes('LastPort'));
            if (saleWeekIdx < 0 || etdIdx < 0) return;
            // Colspan-aware fromEnd, same technique as every other suite's own header
            // parsing (this table's Inland/Port Activity group headers are colSpan=3).
            const spans = Array.from(labelRow.children).map(th => parseInt(th.getAttribute('colspan') || '1', 10));
            const totalRealCols = spans.reduce((a, b) => a + b, 0);
            let cumulative = 0;
            const fromEndByIdx = spans.map(span => { const fromEnd = totalRealCols - cumulative; cumulative += span; return fromEnd; });
            const saleWeekFromEnd = fromEndByIdx[saleWeekIdx];
            const etdFromEnd = fromEndByIdx[etdIdx];

            // Trade/Sub Trade/Lane are rowSpan-merged in this table (only the row that
            // starts a new group has its own cell; continuation rows omit however many
            // of the three are still unchanged) -- track the last-seen Lane forward,
            // same technique this project's own live-testing scripts already use for
            // this exact table shape. shift = how many of the 3 leading columns this
            // row omits (0 = all present, Lane at index 2; 1 = Trade omitted, Lane at
            // index 1; 2 = Trade+SubTrade omitted, Lane at index 0; 3 = all omitted,
            // reuse the tracked lane).
            let lastLane = null;
            const perRow = [];
            Array.from(table.querySelectorAll('tbody tr')).forEach(tr => {
                const tds = Array.from(tr.children);
                const shift = headers.length - tds.length;
                if (shift < 0 || shift > 3) return; // not a normal data row (e.g. "no data" placeholder)
                const lane = shift === 3 ? lastLane : tds[2 - shift]?.textContent.trim();
                if (shift < 3) lastLane = lane;
                const saleWeekText = tds[tds.length - saleWeekFromEnd]?.textContent.trim();
                const etdText = tds[tds.length - etdFromEnd]?.textContent.trim();
                if (lane && saleWeekText) perRow.push({ lane, saleWeek: saleWeekText, etdText });
            });

            const parseMDYY = (text) => {
                const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(text || '');
                if (!m) return null;
                return new Date(2000 + parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
            };
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const isDeparted = (etdText) => {
                const d = parseMDYY(etdText);
                if (!d) return false;
                d.setHours(0, 0, 0, 0);
                return d.getTime() <= today.getTime();
            };

            // Bucket by (lane, week week-suffix) -- OR across rows in the SAME lane's
            // own bucket (unchanged by this fix), matching row.saleWeek's "YYYY/Wnn"
            // shape reduced to just "Wnn" to align with the chart's own week-label key.
            const laneWeekDeparted = {};
            perRow.forEach(({ lane, saleWeek, etdText }) => {
                const weekKey = saleWeek.split('/')[1] || saleWeek;
                const key = `${lane}|${weekKey}`;
                if (!(key in laneWeekDeparted)) laneWeekDeparted[key] = false;
                if (isDeparted(etdText)) laneWeekDeparted[key] = true;
            });
            const expectedWeekDeparted = {};
            Object.entries(laneWeekDeparted).forEach(([key, departed]) => {
                const weekKey = key.split('|')[1];
                if (!(weekKey in expectedWeekDeparted)) expectedWeekDeparted[weekKey] = true;
                if (!departed) expectedWeekDeparted[weekKey] = false; // AND across lanes
            });

            const chartWeeks = Array.from(document.querySelectorAll('div')).filter(d =>
                d.className.includes('text-[11px]') && d.className.includes('font-bold') && /^W\d+★?$/.test(d.textContent.trim())
            ).map(d => ({ week: d.textContent.trim().replace('★', ''), hasStar: d.textContent.includes('★') }));

            const mismatches = chartWeeks
                .filter(({ week }) => week in expectedWeekDeparted)
                .map(({ week, hasStar }) => ({ week, hasStar, expected: expectedWeekDeparted[week] }))
                .filter(({ hasStar, expected }) => hasStar !== expected);

            record(SUITE, 'Item 22 (2026-09-04): "Departed" star reflects AND across every lane present that week, independently re-derived from raw ETD data',
                chartWeeks.length > 0 && mismatches.length === 0,
                { weeksChecked: chartWeeks.length, mismatches: mismatches.slice(0, 10) });
        })();

        await closeAnalysis();
    })();

    // ============================================================
    // SUITE 6: Analyze modal — POL_Booking_Flash tab ("POL Performance
    // Summary"). Breakdown is by POL/port. Until 2026-09-10 Overall Snapshot
    // was always Lane-wide here regardless (so Overall must NOT equal the
    // naive sum of the POL cards, and instead was cross-checked against
    // Booking Flash's own Overall as independent proof) -- per Kevin, that
    // changed today: Overall Snapshot now aggregates by POL on this tab too
    // (see the app's own `laneSummaries` comment for the full writeup), so
    // Overall == sum of the displayed cards is expected to hold here now,
    // same as Booking Flash's own suite, via the shared checkAnalysisMath.
    // No longer cross-checked against Booking Flash's Overall -- the two
    // tabs are now intentionally on different bases (POL vs. Lane), so
    // equality between them is no longer a meaningful invariant.
    // ============================================================
    await (async function polBookingFlashAnalyzeSuite() {
        const SUITE = 'Analyze_POLBookingFlash';
        if (!(await clickTab('POL Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        if (!(await openAnalysis())) { record(SUITE, 'Setup: Analyze button found and enabled', false); return; }
        const data = readAnalysisModal();
        if (data.groups.length === 0) { record(SUITE, 'Setup: at least one breakdown card found', false); await closeAnalysis(); return; }
        record(SUITE, 'Setup: modal opened with data', true, { cardCount: data.groups.length });
        checkAnalysisMath(SUITE, record, data);
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
    // exposed it: Trade Summary's Utilization showed individual
    // per-week values like "753114%". Fixed by routing every raw-value ->
    // number conversion through a shared toNum() helper that strips
    // commas/%/parens before parsing (matching the comma-stripping already
    // done in a couple of places, now applied consistently everywhere).
    // This check doesn't re-derive the fix's internals -- it just asserts
    // the OUTCOME the bug broke: no individual Sale Week's
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

        // 2026-09-02 rewrite: same 3-row-cycle DOM shape established in the
        // Trade_Summary suite above (tabular:true + valuesInRows:true +
        // hideRowToggles:true + showGrandTotal:false + showGrandTotalColumn:
        // false) -- Max Laden, then Total TEU, then Utilization per Sub
        // Trade leaf, no label-only row, no −/• prefix, and the Trade/Sub
        // Trade label rowSpan-merged as plain text into only the FIRST row
        // of each cycle. Re-derived independently here (this suite runs
        // standalone) rather than assuming the old fixed "every 4th row" cycle.
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const DATA_FIELD_LABELS = ['Max Laden', 'Total TEU', 'Utilization'];
        const subTradeGroups = [];
        let currentTrade = null;
        for (let i = 0; i + 2 < rows.length; i += 3) {
            const cycle = [rows[i], rows[i + 1], rows[i + 2]].map(tr => {
                const cells = Array.from(tr.querySelectorAll('td'));
                const dfIdx = cells.findIndex(td => DATA_FIELD_LABELS.includes(td.textContent.trim()));
                return {
                    dfLabel: dfIdx >= 0 ? cells[dfIdx].textContent.trim() : null,
                    labelCells: dfIdx > 0 ? cells.slice(0, dfIdx).map(td => td.textContent.trim()) : [],
                    valueCells: dfIdx >= 0 ? cells.slice(dfIdx + 1) : cells,
                };
            });
            if (cycle[0].dfLabel !== 'Max Laden' || cycle[1].dfLabel !== 'Total TEU' || cycle[2].dfLabel !== 'Utilization') break;
            const labelCells = cycle[0].labelCells;
            if (labelCells.length >= 2) currentTrade = labelCells[labelCells.length - 2];
            subTradeGroups.push({
                trade: currentTrade,
                maxLdnCells: cycle[0].valueCells,
                totalTeuCells: cycle[1].valueCells,
                utilCells: cycle[2].valueCells,
            });
        }
        if (subTradeGroups.length < 1) { record(SUITE, 'Setup: parsed at least one Sub Trade group', false, { groupCount: subTradeGroups.length }); return; }

        // Class D: correctly scoped to actual Utilization cells now (row 3 of
        // each 3-row cycle), not whatever "every 4th row" happened to land on under
        // the stale 4-row assumption. Every value cell here is a real per-Sale-Week
        // reading -- showGrandTotalColumn:false means there's no rightmost cumulative
        // "Total" column in this pivot at all anymore, so (unlike the old code) none
        // needs to be excluded.
        const SANE_CEILING_PERCENT = 500;
        const offenders = [];
        subTradeGroups.forEach(g => {
            g.utilCells.forEach((td, colIdx) => {
                const text = td.textContent.trim();
                const n = parseFloat(text.replace('%', ''));
                if (!isNaN(n) && n > SANE_CEILING_PERCENT) {
                    offenders.push({ trade: g.trade, value: text, colIdx });
                }
            });
        });
        record(SUITE, `Class D: no individual Sale Week's Utilization exceeds ${SANE_CEILING_PERCENT}% (comma-truncation fingerprint)`,
            offenders.length === 0, { offenders: offenders.slice(0, 5), offenderCount: offenders.length });

        // Companion positive check (2026-09-02 rewrite): showGrandTotal:false and
        // showGrandTotalColumn:false mean this pivot no longer renders a Grand
        // Total row OR column to read directly -- compute the equivalent grand
        // totals ourselves by summing every Sub Trade group's Max Laden row and
        // Total TEU row (across every Sale Week cell, across every group). Same
        // underlying invariant as before: both are TEU-scale quantities for the
        // same trade network, and the bug this guards against made Max Laden
        // ~1000x SMALLER than Total TEU on the same row -- this ratio check
        // catches that directly, just against the derived grand totals instead
        // of a rendered Grand Total row.
        let grandMaxLdn = 0, grandTeu = 0, anyNullCell = false;
        subTradeGroups.forEach(g => {
            g.maxLdnCells.forEach(td => {
                const v = parseNum(td.textContent);
                if (v === null) anyNullCell = true; else grandMaxLdn += v;
            });
            g.totalTeuCells.forEach(td => {
                const v = parseNum(td.textContent);
                if (v === null) anyNullCell = true; else grandTeu += v;
            });
        });
        const ratio = (grandMaxLdn && grandTeu) ? grandTeu / grandMaxLdn : null;
        record(SUITE, 'Class D: Grand Total Max Laden is the same order of magnitude as Grand Total Total TEU (ratio < 50)',
            !anyNullCell && ratio !== null && ratio < 50,
            { grandMaxLdn, grandTeu, ratio, anyNullCell });
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

        // 2026-09-04 audit: "Peak Utilz" diffs in the Notable Vessel Changes table used
        // getPercentNum (assumes a fraction, *100 always) instead of getPeakUtilPercentNum
        // (self-corrects for peakUtilRaw's real-world dual-scale ambiguity -- see
        // DATA_ARCHITECTURE.md's peakUtilRaw entry), so a raw value that's already
        // percent-scale (e.g. 214 meaning 214%) rendered as 21400%. Any 4+ digit percent
        // in a "Peak Utilz: X% -> Y%" diff line is that exact double-scaling fingerprint --
        // a real peak utilization change, however extreme, will never legitimately reach
        // four digits.
        const peakUtilzDiffs = [...document.body.innerText.matchAll(/Peak Utilz:\s*(\d+)%\s*→\s*(\d+)%/g)];
        if (peakUtilzDiffs.length > 0) {
            const inflated = peakUtilzDiffs.filter(m => parseInt(m[1], 10) >= 1000 || parseInt(m[2], 10) >= 1000);
            record(SUITE, 'Class F: "Peak Utilz" diff values never 4+ digits (double-scaling fingerprint)',
                inflated.length === 0, { checked: peakUtilzDiffs.length, inflated });
        }

        // 2026-09-04 audit: the "Vessels" tile counted rows.length (per-POL-leg rows,
        // same grain as POL Booking Flash) instead of distinct vessels -- a ~2.6x
        // overcount on real data (964 rows vs 374 distinct VVDs) on a tile literally
        // labeled "Vessels". A distinct-VVD count can never exceed the file's total row
        // count, so New/Old exceeding the corresponding file's own vessel-count-vs-
        // row-count sanity (via the header line's own vessel counts, which now share the
        // same fixed computation) is a structural invariant, not a data-dependent guess.
        const vesselsMatch = document.body.innerText.match(/VESSELS[\s\S]{0,80}?Old:\s*([\d,]+)[\s\S]{0,40}?New:\s*([\d,]+)/i);
        const comparingMatch = document.body.innerText.match(/Comparing\s+\S[\s\S]*?\((\d[\d,]*)\s+vessels\)[\s\S]*?\((\d[\d,]*)\s+vessels/);
        if (vesselsMatch && comparingMatch) {
            const tileOld = parseInt(vesselsMatch[1].replace(/,/g, ''), 10);
            const tileNew = parseInt(vesselsMatch[2].replace(/,/g, ''), 10);
            const headerOld = parseInt(comparingMatch[1].replace(/,/g, ''), 10);
            const headerNew = parseInt(comparingMatch[2].replace(/,/g, ''), 10);
            record(SUITE, '"Vessels" tile matches the header line\'s vessel count (both use the same distinct-VVD fix)',
                tileOld === headerOld && tileNew === headerNew,
                { tileOld, tileNew, headerOld, headerNew });
        }
    })();

    // ============================================================
    // SUITE 9: Historical Data (added 2026-09-06) -- first-ever regression
    // coverage for this feature. Everything about it (fetching the archive,
    // viewing a date, Back to Live) depends on HISTORICAL_DATA_CSV_URL
    // (a real published Google Sheet) actually being reachable -- true from
    // Kevin's own browser, but this sandbox's headless Chromium has
    // repeatedly been confirmed unable to reach docs.google.com directly
    // even though host-level curl succeeds (a sandbox networking quirk, not
    // an app bug). So this suite gracefully skips (no records at all, same
    // convention as the Compare suite's own "no old file loaded" skip
    // above) whenever the archive isn't actually reachable in whatever
    // browser runs this -- it only asserts anything once real historical
    // dates are confirmed to have loaded, which happens automatically
    // wherever the fetch actually succeeds.
    // ============================================================
    await (async function historicalDataSuite() {
        const SUITE = 'Historical_Data';
        const histBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('🗓️ Historical Data'));
        if (!histBtn) return; // feature not present in this build at all
        histBtn.click();
        // Popover shows either date buttons (fetch succeeded) or an error banner
        // (fetch failed/unreachable) -- poll for either rather than a fixed delay.
        const dateButtonSelector = () => Array.from(document.querySelectorAll('button')).filter(b =>
            /^\d{4}-\d{2}-\d{2}$/.test(b.textContent.trim())
        );
        const errorBannerVisible = () => Array.from(document.querySelectorAll('div')).some(d =>
            d.textContent.includes('Fetch failed') || d.textContent.includes('Failed to fetch') || d.textContent.includes('Couldn\'t load')
        );
        await waitFor(() => dateButtonSelector().length > 0 || errorBannerVisible(), { timeout: 8000 });
        const dateButtons = dateButtonSelector();
        if (dateButtons.length === 0) {
            // Unreachable in this environment -- close the popover and skip
            // silently, same as the Compare suite's own no-data skip.
            histBtn.click();
            return;
        }
        record(SUITE, 'Setup: historical archive reachable, at least one date loaded', true, { dateCount: dateButtons.length });

        const targetDate = dateButtons[0].textContent.trim();
        dateButtons[0].click();
        const bannerHasDate = () => Array.from(document.querySelectorAll('span')).some(s => s.textContent.includes(`Viewing historical data for ${targetDate}`));
        const tabBtnHasDate = () => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === `🗓️ Historical Data: ${targetDate}`);
        const viewedOk = await waitFor(() => bannerHasDate() && tabBtnHasDate(), { timeout: 10000 });
        record(SUITE, 'Viewing a historical date shows the indigo banner and updates the tab-bar button label',
            viewedOk, { targetDate });

        // Item 21/22-adjacent guard (2026-09-04 audit, PR #49): Auto-Refresh must
        // NOT have silently reset this the moment it was set -- confirms the
        // viewing state is still stable a beat later, a cheap proxy for the
        // "silently snapped back to live" bug class fixed that day (the full
        // virtual-clock reproduction that found it isn't practical to run inside
        // a paste-into-console suite, but this at least catches the view not
        // holding at all).
        await new Promise(r => setTimeout(r, 300));
        record(SUITE, 'Historical view is still active a moment later (not immediately reset)',
            bannerHasDate() && tabBtnHasDate(), { targetDate });

        const backToLiveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Back to Live');
        if (backToLiveBtn) {
            backToLiveBtn.click();
            const backToLiveOk = await waitFor(() => !bannerHasDate() && !tabBtnHasDate(), { timeout: 5000 });
            record(SUITE, '"Back to Live" clears the historical-viewing banner and tab-bar label', backToLiveOk, { targetDate });
        } else {
            record(SUITE, 'Setup: "Back to Live" button found', false);
        }

        // Close the popover if still open (best-effort cleanup, not itself asserted).
        const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Close historical data panel');
        if (closeBtn) closeBtn.click();
    })();

    const allPassed = allResults.every(r => r.pass);
    console.log(allPassed ? '\n✅ ALL TESTS PASSED' : '\n❌ SOME TESTS FAILED');
    return { results: allResults, allPassed };
}
// Top-level await works when pasted directly into a browser console; if
// running via an eval context that doesn't support it, wrap in an async
// IIFE instead: (async () => { const r = await runBookingFlashRegressionTests(); return r; })();
runBookingFlashRegressionTests();

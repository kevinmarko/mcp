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
 * 1. Open the app (e.g. via the local static server used throughout this project, at
 *    whichever `Booking_flash_report_na_*.html` has the highest version number in the repo
 *    root -- see AGENTS.md's syntax-check section and README's "Current version" note for why
 *    this must never be a hardcoded filename; this exact line was found still pointing at the
 *    frozen `..._1.10_AUTO_REFRESH.html` snapshot during the 2026-09-10 doc-drift pass that
 *    fixed AGENTS.md/README's copies of the same bug)
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
 *
 * DOUBLE-INVOCATION GUARD (2026-09-15): this file self-invokes once at the
 * bottom the instant it's injected/pasted (see the trailing call), so
 * automation can just inject it and read the result -- it must NEVER also
 * call runBookingFlashRegressionTests() itself afterward (AGENTS.md used to
 * say to do exactly that). Two copies of this suite running concurrently on
 * the same page independently click tabs and open/close the Analyze modal,
 * racing each other -- one copy can read the DOM mid-transition while the
 * OTHER copy is switching it. Root-caused 2026-09-15 after this exact
 * pattern had been silently misdiagnosed as "one known pre-existing flaky
 * Sector Summary failure" across many earlier HANDOFF.md entries: the race
 * is fully DETERMINISTIC in this sandbox (same machine, same browser, same
 * data, same two scripts always racing the same way), so it produced an
 * IDENTICAL failure set on every re-run -- which is exactly what AGENTS.md's
 * own "known flakiness" heuristic (identical-both-times = real, treat it as
 * a bug) told you to trust. A live single-invocation run the same day showed
 * 0 real failures (89/89) where the double-invoked version had reported
 * 89 passed / 9 failed, with the "failed" set exactly matching whichever
 * suites happen to run mid-transition of the OTHER copy's tab/modal clicks.
 * This guard makes a second concurrent call return the in-flight run's own
 * result instead of starting a racing second copy.
 *
 * Both wrapped in an IIFE (2026-09-15, same-day follow-up): a top-level
 * `let`/`const` guard variable would go into the page's shared global
 * LEXICAL scope, which -- unlike `var` or a `window.` property -- cannot be
 * redeclared across separate script evaluations in the same page. Re-
 * injecting/re-pasting this file a SECOND time in the same tab (exactly
 * AGENTS.md's own "re-run once" flakiness check, or just re-testing a
 * second upload) would throw `Identifier '__bfrtInFlight' has already been
 * declared` before a single line of the suite ran -- silently breaking
 * every run after the first per page load. Separately, the un-wrapped
 * `_runBookingFlashRegressionTestsImpl` was a plain top-level function
 * declaration, which leaks onto `window` in a classic (non-module) script
 * context -- directly callable as `window._runBookingFlashRegressionTestsImpl()`,
 * completely bypassing the guard above (confirmed live: both bugs
 * reproduced exactly as described). The IIFE keeps the real implementation
 * a true closure-private local -- nothing but the one explicit
 * `window.runBookingFlashRegressionTests = ...` assignment at the end is
 * ever exposed.
 *
 * GUARD STATE LIVES ON `window`, NOT AS A CLOSURE-LOCAL VARIABLE (2026-09-15,
 * second follow-up, found by code review): an earlier version of this guard
 * used a closure-local `let __bfrtInFlight` declared INSIDE this IIFE. That
 * only guards a second call made through the SAME injection's closure --
 * injecting/pasting the whole file a SECOND time (e.g. re-running it before
 * polling `window.__bfrtLastResult` to completion first) creates a brand-new
 * IIFE invocation with its own fresh, independent `__bfrtInFlight`, with zero
 * visibility into whether an earlier injection's run is still in flight, so
 * the exact race this guard exists to prevent reproduces via re-injection
 * instead of a same-injection double-call. `window` is the one object every
 * separate script evaluation on the page actually shares, so the guard flag
 * has to live there for "regardless of how a future script invokes this
 * file" (the claim two lines up) to actually hold.
 */
(function () {
async function runBookingFlashRegressionTests() {
    if (window.__bfrtInFlight) {
        console.warn('⚠️ runBookingFlashRegressionTests() called while a run was already in progress -- either a same-injection double-call, or this file was injected/pasted a second time before the first injection\'s run finished. Returning the IN-PROGRESS run\'s own result instead of starting a second copy that would race it on the same page.');
        return window.__bfrtInFlight;
    }
    // POL RENDER-ALL (2026-09-25). The POL Booking Flash table is windowed -- it mounts only the
    // rows near its scroll position (see POL_VT_OVERSCAN in the app) -- but every POL check in
    // this file asserts an invariant over EVERY rendered row, and would otherwise quietly check
    // ~100 of 1,398 while still passing. This event makes the app render all rows for the
    // length of the run (the POL suite turns it off briefly to test the windowing itself), and
    // the finally below always turns it back off, crash included.
    window.dispatchEvent(new CustomEvent('bookingflash:pol-render-all', { detail: true }));
    window.__bfrtInFlight = _runBookingFlashRegressionTestsImpl();
    try {
        return await window.__bfrtInFlight;
    } finally {
        window.__bfrtInFlight = null;
        window.dispatchEvent(new CustomEvent('bookingflash:pol-render-all', { detail: false }));
    }
}
async function _runBookingFlashRegressionTestsImpl() {
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
    // checkFreezePins (2026-09-30, per Kevin: "Freeze Panes doesn't seem to work anymore";
    // five pinned columns since 2026-10-01: Trade, Sub Trade, Lane lead, then Sales Week..
    // Status, VVD, Vessel Name, VSL OPR, per Kevin): drives the real ⚙️ Settings
    // toggle, scrolls the ACTIVE tab's table far right, and checks Trade, Sub Trade, Lane, VVD
    // and Vessel Name stayed pinned at the app's FREEZE_LAYOUT offsets -- header labels, a
    // group's first data row (which carries the rowSpan'd trade cells, so its cell index is
    // the column index) and a group's later row (which doesn't: 3 cells fewer) -- and that
    // the unpinned VSL OPR scrolled away (left of VVD's offset, under the pinned area).
    // Always restores the scroll and Freeze Panes' prior state, since
    // Preferences_Persistence below asserts the pref's default.
    const FREEZE_OFFSETS = { trade: 0, subTrade: 75, lane: 150, vvd: 225, vessel: 320 };
    const checkFreezePins = async (SUITE) => {
        const LABEL = 'Freeze Panes pins Trade, Sub Trade, Lane, VVD + Vessel Name at the left edge while scrolled, and VSL OPR scrolls away (real Settings toggle)';
        const trigger = document.querySelector('[data-settings-trigger]');
        const freezeBtn = () => document.querySelector('button[title^="Pin the Trade"]');
        if (!trigger) { record(SUITE, LABEL, false, { error: 'no [data-settings-trigger]' }); return; }
        trigger.click();
        await waitFor(() => freezeBtn());
        const btn = freezeBtn();
        const wasOn = btn && btn.getAttribute('aria-pressed') === 'true';
        if (btn && !wasOn) { btn.click(); await waitFor(() => freezeBtn() && freezeBtn().getAttribute('aria-pressed') === 'true'); }
        trigger.click(); // close Settings
        await new Promise(r => setTimeout(r, 500));
        const table = Array.from(document.querySelectorAll('table')).find(t => t.checkVisibility() && Array.from(t.querySelectorAll('thead th')).some(th => th.textContent.trim() === 'VVD'));
        let scroller = table && table.parentElement;
        while (scroller && !(['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX) && scroller.scrollWidth > scroller.clientWidth)) scroller = scroller.parentElement;
        const detail = { freezeButtonFound: !!btn };
        if (table && scroller) {
            // .pop(): the label row's cell, not the filter row's, for each column.
            const heads = Array.from(table.querySelectorAll('thead th'));
            const th = (...labels) => heads.filter(h => labels.includes(h.textContent.replace(/\s+/g, ''))).pop();
            const headCells = { trade: th('Trade'), subTrade: th('SubTrade'), lane: th('Lane', 'Service'), vvd: th('VVD'), vessel: th('VesselName') };
            const unpinnedHeads = [th('VSLOPR')];
            const bodyRows = Array.from(table.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 8);
            const spanned = (td) => td && td.hasAttribute('rowspan');
            const firstRow = bodyRows.find(tr => [0, 1, 2].every(i => spanned(tr.children[i])) && tr.children[3].textContent.trim());
            const laterRow = bodyRows.find(tr => !spanned(tr.children[0]) && tr.children[0].textContent.trim() && !tr.children[0].hasAttribute('colspan'));
            const x = (el) => el ? Math.round(el.getBoundingClientRect().left - scroller.getBoundingClientRect().left) : null;
            const prevLeft = scroller.scrollLeft;
            scroller.scrollLeft = 1500;
            await new Promise(r => setTimeout(r, 400));
            detail.scrollLeft = scroller.scrollLeft;
            detail.head = Object.fromEntries(Object.entries(headCells).map(([k, el]) => [k, x(el)]));
            // Column index of VVD = its label cell's index in its header row (no colSpan groups
            // precede it in either table); Vessel Name and VSL OPR follow it.
            const vvdCol = headCells.vvd ? Array.from(headCells.vvd.parentElement.children).indexOf(headCells.vvd) : -1;
            const cellsAt = (tr, idx) => tr ? Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, x(tr.children[i])])) : null;
            detail.vvdCol = vvdCol;
            detail.firstRow = cellsAt(firstRow, { trade: 0, subTrade: 1, lane: 2, vvd: vvdCol, vessel: vvdCol + 1 });
            detail.laterRow = cellsAt(laterRow, { vvd: vvdCol - 3, vessel: vvdCol - 2 });
            detail.unpinned = [...unpinnedHeads.map(x), ...(laterRow ? [x(laterRow.children[vvdCol - 1])] : [])];
            scroller.scrollLeft = prevLeft;
        }
        if (!wasOn) {
            trigger.click();
            await waitFor(() => freezeBtn());
            if (freezeBtn() && freezeBtn().getAttribute('aria-pressed') === 'true') freezeBtn().click();
            await waitFor(() => freezeBtn() && freezeBtn().getAttribute('aria-pressed') === 'false');
            trigger.click();
            await new Promise(r => setTimeout(r, 300));
        }
        const near = (v, want) => typeof v === 'number' && Math.abs(v - want) <= 3;
        const allNear = (got) => !!got && Object.keys(got).every(k => near(got[k], FREEZE_OFFSETS[k]));
        const scrolledAway = (xs) => Array.isArray(xs) && xs.length === 2 && xs.every(v => typeof v === 'number' && v < FREEZE_OFFSETS.vvd);
        record(SUITE, LABEL,
            !!btn && detail.scrollLeft > 500 && allNear(detail.head) && allNear(detail.firstRow) && allNear(detail.laterRow) && scrolledAway(detail.unpinned), detail);
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
    //
    // REWRITTEN 2026-09-16, and it was already broken before the rewrite. The macro
    // toggle buttons this drove rendered `{hidden ? label : `Hide ${label}`}` -- so a
    // hidden column's button read "Reefer", never "Show Reefer". The exact-text match
    // above could therefore never match a hidden column's button, and every call
    // returned false and no-opped. The `idx < 0` guards downstream then skipped those
    // checks cleanly rather than failing, which is exactly the silent-coverage-loss
    // failure mode this helper's own comment was written to warn about -- it just
    // happened to the helper itself. Caught by counting, not by a red test.
    //
    // The macro grids are gone as of 2026-09-16 (replaced by the Fields picker), so
    // this now drives the picker instead, and keys off data-* attributes rather than
    // visible button text so a label reword cannot silently break it again.
    //
    // REWRITTEN AGAIN 2026-09-17: the Fields trigger moved from its own standalone
    // tab-bar button into the ⚙️ Settings popover (a peer of Dark Mode/Export now,
    // per Kevin), so `[data-field-picker-trigger]` only existed in the DOM while
    // Settings itself was open -- Settings' content is conditionally rendered the
    // same way the Fields panel always has been. `data-settings-trigger` was added
    // as a stable hook on the Settings button for that same change.
    //
    // REWRITTEN AGAIN 2026-09-21: the 2026-09-17 move was itself undone. The Fields
    // trigger moved back OUT of Settings entirely (commit `0a4d17b`, per Kevin: "put
    // the fields button next to the coast button") and now lives in the tab-bar row
    // as a peer of Coast/AP Frozen/AP Only, gated purely on
    // `!topPanelCollapsed && (activeTab === 'detail' || activeTab === 'pol_booking')`
    // -- see that group's own comments in the app file. It has no relationship to
    // Settings' open/closed state at all any more, so the "click Settings, then wait
    // for the trigger to appear" fallback below could never succeed again: the
    // trigger will never appear as a result of opening Settings, because Settings no
    // longer renders it under any state. Renamed from `openSettings` (which now
    // described an action this helper no longer performs) to
    // `fieldPickerTriggerAvailable`, and the dead click-and-wait-on-Settings fallback
    // was dropped -- this now just reports whether the trigger is in the DOM, which
    // is exactly what "wrong tab" or "filters hidden" (both legitimate, non-bug
    // states) or a build predating the picker all look like from here.
    // `data-settings-trigger` is unused by this helper now; it's still exercised
    // separately by `openSettingsAndFindDarkToggle` below, which still opens the
    // real Settings popover for Dark Mode/Auto-Refresh/etc. -- those controls are
    // unaffected by this move.
    const fieldPickerTriggerAvailable = async () => !!document.querySelector('[data-field-picker-trigger]');
    const openFieldPicker = async () => {
        if (!(await fieldPickerTriggerAvailable())) return null;
        const trigger = document.querySelector('[data-field-picker-trigger]');
        if (!document.querySelector('[data-field-picker-panel]')) trigger.click();
        await waitFor(() => !!document.querySelector('[data-field-picker-panel]'));
        return document.querySelector('[data-field-picker-panel]');
    };
    // Escape, not "click the trigger again": the Fields trigger's own onClick closes
    // Settings as a side effect (mirrors Export's onClick in the app -- see its
    // comment there), which unmounts the trigger button itself, so a second click on
    // the same element is not reliably available once the picker is open. Escape
    // closes the Fields panel independently of whatever state Settings is in (the
    // app's own fieldPickerPinned Escape effect isn't gated on Settings at all), so
    // it works whether Settings happens to still be open or already closed. This
    // deliberately does NOT reopen Settings first -- by the normal flow Settings is
    // already closed by the time a test calls this (the trigger closed it on the way
    // in), and closing the field picker should not have the side effect of popping
    // Settings back open.
    const closeFieldPicker = async () => {
        if (!document.querySelector('[data-field-picker-panel]')) return;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await waitFor(() => !document.querySelector('[data-field-picker-panel]'));
    };
    // Ticks a field ON (visible) if it isn't already. Returns false when the field
    // doesn't exist or isn't applicable to the current tab, matching the old contract.
    const setFieldVisible = async (fieldKey, visible = true) => {
        const panel = await openFieldPicker();
        if (!panel) return false;
        const box = panel.querySelector(`input[data-field-toggle="${fieldKey}"]`);
        if (!box || box.disabled) { await closeFieldPicker(); return false; }
        if (box.checked !== visible) {
            box.click();
            await waitFor(() => box.checked === visible);
        }
        await closeFieldPicker();
        return true;
    };
    const clickShowToggle = async (fieldKey) => setFieldVisible(fieldKey, true);
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

    // Field visibility is persisted to localStorage as of 2026-09-16, which means a
    // previous session (or a previous run of this suite) can leave columns hidden and
    // silently change what every check below sees. Clearing localStorage would NOT fix
    // that: the app reads those keys once, in a useState initializer at mount, so
    // deleting them mid-session leaves the already-mounted React state untouched. The
    // picker's own Reset control is what actually restores default visibility here and
    // now, so use that.
    // Goes through the standard openFieldPicker/closeFieldPicker helpers (2026-09-17)
    // rather than driving the trigger directly -- the trigger lives in the tab-bar
    // row next to Coast, gated to the default 'detail' tab with filters shown (both
    // true at this point, before any suite has switched tabs or touched Hide
    // Filters), and those helpers already account for it being absent otherwise.
    const resetPanel = await openFieldPicker();
    if (resetPanel) {
        const resetBtn = resetPanel.querySelector('[data-field-picker-reset]');
        if (resetBtn) resetBtn.click();
        await closeFieldPicker();
    }

    // ============================================================
    // SUITE 1: Trade Summary — Class A (rollup) + Class B (readability guard)
    // ============================================================
    await (async function tradeSummarySuite() {
        const SUITE = 'Trade_Summary';
        if (!(await clickTab('Trade Summary'))) { record(SUITE, 'Setup: tab button found', false); return; }
        // .find(visible) instead of querySelector: POL Booking Flash's panel stays
        // mounted (hidden, not removed) when another tab is active -- see this file's
        // AGENTS.md/app comment on the keep-mounted POL tab -- so a plain
        // querySelector('table') could match POL's hidden table instead of this
        // tab's own visible one if DOM order ever changed. checkVisibility() is
        // this file's existing visible-element convention -- the hidden POL panel uses
        // content-visibility:hidden (not display:none), which offsetParent!==null can no
        // longer detect but checkVisibility() correctly reports as not visible.
        const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
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
        // 2026-09-16: the RIGHT-hand pivot's ground truth below is no longer a
        // frozen snapshot of a live Google Sheet. It is derived directly from
        // tests/fixtures/sector_data_2026-09-16.csv -- a committed copy of that
        // Sheet -- and is only compared when the test runner has PINNED the app's
        // sector fetch to that same fixture (window.__BFRT_SECTOR_FIXTURE__).
        //
        // Why this changed. The old array was captured 2026-08-12 and compared
        // against whatever SECTOR_DATA_CSV_URL returned at run time, which made this
        // check's pass/fail depend on HOW the app was served rather than on whether
        // the app was correct:
        //   - under file://  the fetch sends Origin: null, Google returns no ACAO
        //     header, the browser blocks it, the app falls back to SECTOR_DATA_SEED
        //     (captured ~the same August date) -- and the check "passed" while never
        //     exercising the live path at all;
        //   - under http://  the fetch succeeds, today's genuinely-drifted numbers
        //     replace the seed, and the check failed purely because time had passed.
        // Neither outcome said anything about the app. Worse, it left a permanently
        // red check that readers learn to wave past, which is exactly what AGENTS.md's
        // "resolve every failure into a bucket" rule exists to prevent.
        //
        // Pinning the INPUT rather than loosening the assertion keeps the coverage
        // that actually matters here: that the app reads the right COLUMN out of this
        // source and renders it unmangled. That is this repo's Class E bug class (see
        // DATA_ARCHITECTURE.md), and it is the one thing structural invariants cannot
        // catch -- note sectorDataMapped's own comment about the Sheet once having
        // "MCT Sector Allocation" as a header TWICE, which SheetJS silently resolved
        // to a "_1" key. To refresh: re-download the Sheet over the fixture and
        // re-derive this array from the fixture's own columns (never by capturing what
        // the app rendered -- that would freeze a bug in as "expected").
        //
        // When the fixture is NOT pinned (an ordinary live run), the exact comparison
        // is skipped and the structural invariants below still run. So a live run is
        // 72 executed checks and a pinned-fixture run is 73 -- a documented, expected
        // difference between the two modes, NOT a suite aborting at setup. Compare
        // counts within a mode, per AGENTS.md's "check the executed-check count".
        const SECTOR_LEFT_GROUND_TRUTH = [{"trade":"TPT","subTrade":"AW","lane":"EC1","avgMaxLdn":3400,"avgBkg":923},{"trade":"TPT","subTrade":"AW","lane":"EC2","avgMaxLdn":5225,"avgBkg":2349},{"trade":"TPT","subTrade":"AW","lane":"EC3","avgMaxLdn":4856.25,"avgBkg":1275},{"trade":"TPT","subTrade":"AW","lane":"EC4","avgMaxLdn":2491.6666666666665,"avgBkg":1142},{"trade":"TPT","subTrade":"AW","lane":"WIN","avgMaxLdn":2700,"avgBkg":2368},{"trade":"TPT","subTrade":"PN","lane":"FP2","avgMaxLdn":3303.3333333333335,"avgBkg":1468},{"trade":"TPT","subTrade":"PN","lane":"PN1","avgMaxLdn":2030,"avgBkg":1034},{"trade":"TPT","subTrade":"PN","lane":"PN3","avgMaxLdn":1441.6666666666667,"avgBkg":805},{"trade":"TPT","subTrade":"PS","lane":"MS2","avgMaxLdn":6993.75,"avgBkg":386},{"trade":"TPT","subTrade":"PS","lane":"PS1","avgMaxLdn":4385,"avgBkg":2412},{"trade":"TPT","subTrade":"PS","lane":"PS3","avgMaxLdn":3801.25,"avgBkg":1869},{"trade":"TPT","subTrade":"PS","lane":"PS4","avgMaxLdn":1860,"avgBkg":1337},{"trade":"TPT","subTrade":"PS","lane":"PS6","avgMaxLdn":2793.75,"avgBkg":965},{"trade":"TPT","subTrade":"PS","lane":"PS7","avgMaxLdn":2175,"avgBkg":792},{"trade":"TPT","subTrade":"PS","lane":"PS8","avgMaxLdn":1383.3333333333333,"avgBkg":65},{"trade":"TPT","subTrade":"PS","lane":"VSE","avgMaxLdn":3525,"avgBkg":503},{"trade":"TAT","subTrade":"TA","lane":"AL5","avgMaxLdn":1326.6666666666667,"avgBkg":1072},{"trade":"TAT","subTrade":"TA","lane":"AT1","avgMaxLdn":2226,"avgBkg":1361},{"trade":"TAT","subTrade":"TA","lane":"AT3","avgMaxLdn":476.6666666666667,"avgBkg":475},{"trade":"TAT","subTrade":"TA","lane":"AT4","avgMaxLdn":834,"avgBkg":355},{"trade":"TAT","subTrade":"TA","lane":"EMA","avgMaxLdn":867,"avgBkg":515},{"trade":"LAT","subTrade":"LN","lane":"AN2","avgMaxLdn":140,"avgBkg":158},{"trade":"LAT","subTrade":"LN","lane":"ANG","avgMaxLdn":252.5,"avgBkg":138},{"trade":"LAT","subTrade":"LN","lane":"FLX","avgMaxLdn":325,"avgBkg":278},{"trade":"LAT","subTrade":"LN","lane":"MAR","avgMaxLdn":1176,"avgBkg":425}];
        const SECTOR_RIGHT_FIXTURE_GROUND_TRUTH = [{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"BEANR","sectorAlloc":50.0,"avgBooking":235.0,"openSpace":0.0},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"DEBRV","sectorAlloc":0.0,"avgBooking":64.0,"openSpace":0.0},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"DEHAM","sectorAlloc":220.0,"avgBooking":140.0,"openSpace":80.0},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"FRLEH","sectorAlloc":450.0,"avgBooking":51.0,"openSpace":399.0},{"trade":"TAT","subTrade":"TA","lane":"AL5","podSec":"GBSOU","sectorAlloc":700.0,"avgBooking":348.0,"openSpace":352.0},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"BEANR","sectorAlloc":175.0,"avgBooking":278.0,"openSpace":0.0},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"DEBRV","sectorAlloc":990.0,"avgBooking":278.0,"openSpace":712.0},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"FRLEH","sectorAlloc":210.0,"avgBooking":55.0,"openSpace":155.0},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"GBSOU","sectorAlloc":231.0,"avgBooking":280.0,"openSpace":0.0},{"trade":"TAT","subTrade":"TA","lane":"AT1","podSec":"NLRTM","sectorAlloc":1080.0,"avgBooking":330.0,"openSpace":750.0},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"BEANR","sectorAlloc":50.0,"avgBooking":142.0,"openSpace":0.0},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"DEBRV","sectorAlloc":50.0,"avgBooking":55.0,"openSpace":0.0},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"GBSOU","sectorAlloc":200.0,"avgBooking":97.0,"openSpace":104.0},{"trade":"TAT","subTrade":"TA","lane":"AT3","podSec":"NLRTM","sectorAlloc":200.0,"avgBooking":55.0,"openSpace":145.0},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ESALG","sectorAlloc":25.0,"avgBooking":171.0,"openSpace":0.0},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ESVLC","sectorAlloc":190.0,"avgBooking":101.0,"openSpace":90.0},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"FRFOS","sectorAlloc":70.0,"avgBooking":68.0,"openSpace":3.0},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ITGOA","sectorAlloc":284.0,"avgBooking":61.0,"openSpace":223.0},{"trade":"TAT","subTrade":"TA","lane":"AT4","podSec":"ITSPE","sectorAlloc":238.0,"avgBooking":25.0,"openSpace":214.0},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"GRPIR","sectorAlloc":99.0,"avgBooking":80.0,"openSpace":19.0},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"ITSAL","sectorAlloc":20.0,"avgBooking":8.0,"openSpace":12.0},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"TRALI","sectorAlloc":275.0,"avgBooking":2.0,"openSpace":273.0},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"TRISK","sectorAlloc":235.0,"avgBooking":75.0,"openSpace":160.0},{"trade":"TAT","subTrade":"TA","lane":"EMA","podSec":"TRIST","sectorAlloc":347.0,"avgBooking":289.0,"openSpace":58.0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"CNTAO","sectorAlloc":0.0,"avgBooking":21.0,"openSpace":0.0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"CNYTN","sectorAlloc":0.0,"avgBooking":0.0,"openSpace":0.0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"LKCMB","sectorAlloc":20.0,"avgBooking":2.0,"openSpace":19.0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"PAMIT","sectorAlloc":0.0,"avgBooking":121.0,"openSpace":0.0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"SGSIN","sectorAlloc":350.0,"avgBooking":433.0,"openSpace":0.0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"THLCH","sectorAlloc":500.0,"avgBooking":78.0,"openSpace":422.0},{"trade":"TPT","subTrade":"AW","lane":"EC3","podSec":"VNCMP","sectorAlloc":325.0,"avgBooking":82.0,"openSpace":243.0},{"trade":"TPT","subTrade":"PN","lane":"FP2","podSec":"SGSIN","sectorAlloc":200.0,"avgBooking":206.0,"openSpace":0.0},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"CNSHA","sectorAlloc":300.0,"avgBooking":47.0,"openSpace":253.0},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"CNSHK","sectorAlloc":20.0,"avgBooking":9.0,"openSpace":11.0},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"INNSA","sectorAlloc":380.0,"avgBooking":280.0,"openSpace":100.0},{"trade":"TPT","subTrade":"PS","lane":"PS3","podSec":"SGSIN","sectorAlloc":180.0,"avgBooking":75.0,"openSpace":105.0},{"trade":"TPT","subTrade":"PS","lane":"VSE","podSec":"CNNGB","sectorAlloc":0.0,"avgBooking":60.0,"openSpace":0.0},{"trade":"TPT","subTrade":"PS","lane":"VSE","podSec":"CNSHA","sectorAlloc":50.0,"avgBooking":65.0,"openSpace":0.0},{"trade":"TPT","subTrade":"PS","lane":"VSE","podSec":"CNSHK","sectorAlloc":25.0,"avgBooking":23.0,"openSpace":2.0},{"trade":"TPT","subTrade":"PS","lane":"VSE","podSec":"CNTAO","sectorAlloc":0.0,"avgBooking":64.0,"openSpace":0.0},{"trade":"TPT","subTrade":"PS","lane":"VSE","podSec":"KRPUS","sectorAlloc":0.0,"avgBooking":179.0,"openSpace":0.0},{"trade":"TPT","subTrade":"PS","lane":"VSE","podSec":"SGSIN","sectorAlloc":250.0,"avgBooking":157.0,"openSpace":93.0}];

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

            // 2026-09-24: sectorSourceRows (the state backing this pivot) no longer seeds
            // itself from the hardcoded SECTOR_DATA_SEED snapshot before SECTOR_DATA_CSV_URL's
            // live fetch first succeeds -- see that useState's own comment in the app file.
            // Kevin, explicitly: "We can only show real numbers and not hard coded numbers."
            // So on an UNPINNED run this pivot can now be genuinely, correctly empty -- before
            // the first successful fetch, or forever if the source is unreachable -- which was
            // never possible before (the seed made rightLeaves non-empty from the very first
            // render, fetch outcome notwithstanding). Concretely true in this project's own
            // sandbox, which cannot reach docs.google.com in a browser context (see AGENTS.md's
            // repeated notes on Suite 9/Suite 10). A PINNED run (window.__BFRT_SECTOR_FIXTURE__)
            // is unaffected: the fixture resolves the mount-time fetch almost immediately, so
            // rightLeaves.length === 0 there still means a real bug -- handled below simply by
            // never treating the pinned case as skippable.
            //
            // Distinguishing "legitimately empty because unreachable/not-yet-loaded" from "empty
            // because something is actually broken" follows the SAME confirmed-vs-ambiguous
            // convention Historical_Data uses below for its own unreachable archive: a confirmed
            // sectorFetchError banner on screen (rendered by the app itself, ~line 9013) means
            // the fetch definitely failed, so zero rows is expected -- these checks are skipped
            // exactly like Historical_Data's own confirmed-unreachable branch (no record() calls
            // at all; see AGENTS.md's note on why that is a legitimate silent skip, not coverage
            // silently vanishing). No banner and still zero rows is ambiguous, and per AGENTS.md's
            // own lesson about Suite 9's old 8s timeout, an ambiguous empty must never disappear
            // silently, so that case records one explicit loud failure instead of skipping.
            //
            // What "ambiguous" actually covers here (investigated 2026-09-24, do not re-derive
            // this from reasoning alone -- see the evidence below): the obvious candidate is a
            // fetch that's still in flight when this suite runs. A second, code-review-flagged
            // candidate is fetchAndApplySectorData's own `if (rows && rows.length > 0)` guard
            // (app file, ~line 6623): a fetch that SUCCEEDS (200 OK, valid CSV) but legitimately
            // parses to zero data rows never sets sectorFetchError (nothing failed) and never
            // commits rows either (nothing to commit) -- so it produces this exact same
            // no-banner/zero-rows signature and would land here too, indistinguishable from the
            // still-pending case.
            //
            // Checked whether that second candidate is reachable in this suite's actual
            // execution paths, not just theoretically possible -- it is NOT, in either of the
            // two that exist today:
            //  - This project's own sandbox: an unpinned Playwright run against SECTOR_DATA_CSV_URL
            //    fails the fetch outright with net::ERR_CERT_AUTHORITY_INVALID (the sandbox's
            //    proxy TLS-intercepts and this sandbox's Chromium doesn't trust it) BEFORE any
            //    response body is ever parsed -- confirmed live, 2026-09-24: the sectorFetchError
            //    banner ("Couldn't load live Sector Allocation data (Failed to fetch)...") was on
            //    screen every time, i.e. sectorConfirmedUnreachable, never this branch. Curling
            //    SECTOR_DATA_CSV_URL directly (bypassing the browser's TLS trust store entirely)
            //    the same day shows the live Sheet currently holds 44 real data rows, not zero --
            //    so even the network layer that curl CAN reach isn't serving an empty sheet today.
            //  - tests/ci_regression_runner.js, the only place this suite runs unattended in CI,
            //    pins window.__BFRT_SECTOR_FIXTURE__ unconditionally (see its own header comment)
            //    -- so sectorLegitimatelyEmpty is false by construction there and this whole
            //    confirmed/ambiguous split is never evaluated at all.
            // The only way a genuinely successful-but-empty fetch reaches this branch is a human
            // manually running this suite UNPINNED on a machine with real, non-intercepted network
            // access to docs.google.com, at the exact moment the live Sheet returns zero rows --
            // narrow, not exercised by anything automated in this repo today. Re-verify this if
            // ci_regression_runner.js ever stops pinning the sector fixture unconditionally, since
            // that would open the one automated path this reasoning currently rules out.
            //
            // Recording a loud failure here rather than silently skipping is intentional either
            // way (see the still-pending-fetch case above and AGENTS.md's Suite 9 lesson) -- this
            // comment update does not change that choice, only documents what actually triggers it.
            const sectorErrorBannerVisible = () => Array.from(document.querySelectorAll('div[role="alert"]'))
                .some(d => d.textContent.includes("Couldn't load live Sector Allocation data"));
            const sectorLegitimatelyEmpty = !window.__BFRT_SECTOR_FIXTURE__ && rightLeaves.length === 0;
            const sectorConfirmedUnreachable = sectorLegitimatelyEmpty && sectorErrorBannerVisible();
            const sectorAmbiguousEmpty = sectorLegitimatelyEmpty && !sectorErrorBannerVisible();

            if (sectorAmbiguousEmpty) {
                record(SUITE, 'Setup: "Sector Summary" pivot has rows, OR a confirmed sectorFetchError banner explains why it doesn\'t (neither -- ambiguous: either the live fetch just hasn\'t resolved yet, or it succeeded but legitimately parsed to zero rows; not a confirmed-unreachable skip, see AGENTS.md\'s Suite 9 timeout lesson about not letting this vanish silently, and the comment above about which of these two is actually reachable today)',
                    false, { leafCount: rightLeaves.length });
            }

            // The leaf-count-dependent checks below only run when there is something real to
            // check: either real leaves parsed, or -- on an unpinned run -- a confirmed-unreachable
            // skip was NOT hit (sectorConfirmedUnreachable) and the ambiguous case above already
            // recorded its own explicit failure and has nothing further to add.
            if (!sectorConfirmedUnreachable && !sectorAmbiguousEmpty) {
                record(SUITE, 'Setup: parsed at least one leaf (Trade/Sub Trade/Lane/POD Sector) row on "Sector Summary"',
                    rightLeaves.length > 0, { leafCount: rightLeaves.length });

                checkRollupIdentity(rightLeaves, 'sectorAlloc', 'Sector Alloc', '"Sector Summary"');

                // Structural invariants -- run on EVERY run, pinned fixture or live.
                // These are the only properties that stay true as the underlying Sheet
                // drifts week to week, which is what the rest of this suite asserts too.
                //
                // Deliberately NOT asserted here: `openSpace === max(0, sectorAlloc -
                // avgBooking)`. It looks like a law and is not one -- measured against the
                // real 2026-09-16 Sheet it is violated by 5 of 42 rows (e.g. AT3/GBSOU
                // alloc=200 avgBooking=97 openSpace=104, where the identity predicts 103).
                // The Sheet evidently computes open space from unrounded inputs and rounds
                // it independently, so the identity is off by one on some rows. Asserting
                // it would have added a brand-new permanently-failing check -- exactly the
                // thing this rewrite exists to remove.
                const rightBadNumbers = rightLeaves.filter(l =>
                    l.values.sectorAlloc === null || l.values.sectorAlloc < 0 ||
                    l.values.avgBooking === null || l.values.avgBooking < 0 ||
                    l.values.openSpace === null || l.values.openSpace < 0);
                record(SUITE, 'Class A: "Sector Summary" -- every leaf row\'s Sector Alloc/Average Booking/Open Space is a real, non-negative number',
                    rightLeaves.length > 0 && rightBadNumbers.length === 0,
                    { leafCount: rightLeaves.length, badCount: rightBadNumbers.length,
                      badSamples: rightBadNumbers.slice(0, 5).map(l => ({ path: l.path.join(' / '), values: l.values })) });

                // Open space cannot exceed the allocation it is measured against. Verified
                // to hold on two independent real snapshots before being asserted: all 42
                // rows of the 2026-09-16 live Sheet, and every row of the older 2026-08-12
                // reference capture this check used to compare against.
                const rightOverOpen = rightLeaves.filter(l =>
                    l.values.openSpace !== null && l.values.sectorAlloc !== null &&
                    l.values.openSpace > l.values.sectorAlloc + 1);
                record(SUITE, 'Class A: "Sector Summary" -- no leaf row reports more Open Space than its own Sector Alloc',
                    rightLeaves.length > 0 && rightOverOpen.length === 0,
                    { leafCount: rightLeaves.length, badCount: rightOverOpen.length,
                      badSamples: rightOverOpen.slice(0, 5).map(l => ({ path: l.path.join(' / '), values: l.values })) });
            }

            // Exact value comparison -- ONLY when the runner has pinned the app's
            // sector fetch to the committed fixture this ground truth was derived from
            // (see the big note above). On an unpinned live run the app is showing
            // today's Sheet, which this array cannot meaningfully be compared against,
            // so the check is skipped rather than recorded as a pass or a failure.
            if (window.__BFRT_SECTOR_FIXTURE__) {
                const rightGtByKey = new Map(SECTOR_RIGHT_FIXTURE_GROUND_TRUTH.map(g => [`${g.trade}|${g.subTrade}|${g.lane}|${g.podSec}`, g]));
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
                record(SUITE, 'Class A: "Sector Summary" -- leaf rows match the PINNED fixture exactly (column-mapping guard)',
                    rightGtChecked > 0 && rightGtMismatches.length === 0,
                    { rightGtChecked, gtTotal: SECTOR_RIGHT_FIXTURE_GROUND_TRUTH.length, mismatches: rightGtMismatches.slice(0, 5) });
            }
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
        // Visible-table lookup (not plain querySelector) -- see SUITE 1's comment above
        // for why (POL Booking Flash's own panel stays mounted+hidden across switches).
        const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
        if (!table) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }
        record(SUITE, 'Setup: table found', true);

        // ---- Windowing (2026-09-25). This table mounts only the rows near its scroll
        // position, with two spacer rows (data-pol-vt-spacer) standing in for the rest. The run
        // renders every row (see POL RENDER-ALL at the top of this file), so switch that off
        // here, probe the windowed table at three scroll positions, then compare it against the
        // full render at the SAME scroll position. What each check guards:
        //   - mounted < total: the windowing is actually on (a regression to full rendering
        //     would pass every other check in this file);
        //   - tbody height identical: the spacer model matches real row heights, so the
        //     scrollbar and every row's position are what the full table would give;
        //   - column grid: Trade/Sub Trade/Service are rowSpan cells on a group's FIRST row;
        //     when that row is scrolled out of the window the app re-creates them on the
        //     window's first row -- if it didn't, every cell after them shifts three columns;
        //   - same first visible row: the scroll-position -> row mapping is exact;
        //   - no body cell overflows its column in the full render: auto-fit comes from ALL
        //     rows' data, not from whichever rows happen to be mounted. (Widths being identical
        //     at every scroll position is checked too, but on its own it proves nothing: auto-fit
        //     never re-runs on scroll, so widths fitted to only the first window would also
        //     match everywhere. A value wider than its column further down is what exposes it.)
        //     The run turns render-all on before this tab is ever visited, so every column
        //     already on screen was fitted against the full table; three default-hidden
        //     free-text columns are therefore revealed WHILE windowed, which is the only way
        //     their fit can come from the window, and hidden again at the end. Confirmed to
        //     fail against a copy whose auto-fit measures the mounted rows instead.
        // Scroll handling: setting scrollTop and ALSO dispatching a scroll event, since a
        // backgrounded automation tab may never deliver the browser's own (see waitFor's note
        // on suspended rendering steps). React picks up a dispatched 'scroll' like a real one.
        const polContainer = table.parentElement;
        // Distinct body cells whose text is wider than the cell itself, i.e. clipped or spilling
        // into the next column -- what a column fitted to only the mounted rows looks like once
        // every row is rendered. Both widths are screen-space rects, so the tab's zoom/scale
        // cancels out. Deduped on the same signature the app's auto-fit uses.
        const polOverflowingCells = () => {
            const seen = new Set();
            const bad = [];
            table.tBodies[0].querySelectorAll('td[data-autofit-col]').forEach(td => {
                const sig = `${td.getAttribute('data-autofit-col')}\u0000${td.parentElement.className}\u0000${td.className}\u0000${td.textContent}`;
                if (seen.has(sig)) return;
                seen.add(sig);
                const range = document.createRange();
                range.selectNodeContents(td);
                const textW = range.getBoundingClientRect().width;
                const cellW = td.getBoundingClientRect().width;
                if (textW > cellW + 0.5) bad.push({ col: td.getAttribute('data-autofit-col'), text: td.textContent, textW: Math.round(textW), cellW: Math.round(cellW) });
            });
            return bad;
        };
        const polSetRenderAll = (on) => window.dispatchEvent(new CustomEvent('bookingflash:pol-render-all', { detail: on }));
        const polSpacerCount = () => table.querySelectorAll('tbody tr[data-pol-vt-spacer]').length;
        const polScrollTo = async (top) => {
            polContainer.scrollTop = top;
            polContainer.dispatchEvent(new Event('scroll'));
            await new Promise(resolve => setTimeout(resolve, 250));
        };
        const polProbe = () => {
            const tbody = table.tBodies[0];
            const trs = Array.from(tbody.rows);
            const headerCols = Array.from(table.tHead.rows[0].children).reduce((a, th) => a + (parseInt(th.getAttribute('colspan') || '1', 10)), 0);
            const occupied = [];
            let misaligned = 0;
            trs.forEach((tr, ri) => {
                occupied[ri] = occupied[ri] || [];
                let col = 0;
                Array.from(tr.children).forEach(td => {
                    while (occupied[ri][col]) col++;
                    const rs = parseInt(td.getAttribute('rowspan') || '1', 10), cs = parseInt(td.getAttribute('colspan') || '1', 10);
                    for (let r = 0; r < rs; r++) { occupied[ri + r] = occupied[ri + r] || []; for (let k = 0; k < cs; k++) occupied[ri + r][col + k] = true; }
                    col += cs;
                });
                if (occupied[ri].filter(Boolean).length !== headerCols) misaligned++;
            });
            const box = polContainer.getBoundingClientRect();
            const headBottom = table.tHead.getBoundingClientRect().bottom;
            const firstVisible = trs.find(tr => !tr.hasAttribute('data-pol-vt-spacer') && tr.getBoundingClientRect().bottom > headBottom + 1 && tr.getBoundingClientRect().top < box.bottom);
            return {
                mounted: trs.filter(tr => !tr.hasAttribute('data-pol-vt-spacer')).length,
                tbodyHeight: tbody.offsetHeight,
                misaligned,
                firstVisibleText: firstVisible ? firstVisible.textContent : null,
                widths: Array.from(table.tHead.querySelectorAll('[data-autofit-col]')).map(el => el.closest('th').offsetWidth).join(','),
            };
        };
        polSetRenderAll(false);
        await waitFor(() => polSpacerCount() > 0, { timeout: 5000 });
        await polScrollTo(0);
        const POL_WINDOWED_REVEAL = ['remarks', 'rotation', 'vco'];
        const polRevealed = [];
        for (const key of POL_WINDOWED_REVEAL) polRevealed.push(await setFieldVisible(key, true));
        await waitFor(() => polSpacerCount() > 0, { timeout: 5000 });
        await polScrollTo(0);
        const vtTop = polProbe();
        const polMidTop = Math.round((polContainer.scrollHeight - polContainer.clientHeight) * 0.47);
        await polScrollTo(polMidTop);
        const vtMid = polProbe();
        await polScrollTo(polContainer.scrollHeight);
        const vtBottom = polProbe();
        await polScrollTo(polMidTop);
        const vtMidAgain = polProbe();
        polSetRenderAll(true);
        await waitFor(() => polSpacerCount() === 0 && table.tBodies[0].rows.length > vtMidAgain.mounted, { timeout: 15000 });
        await polScrollTo(polMidTop);
        const fullMid = polProbe();
        const fullOverflow = polOverflowingCells();
        await polScrollTo(0);
        for (const key of POL_WINDOWED_REVEAL) await setFieldVisible(key, false);
        record(SUITE, 'Windowing: only a window of rows is mounted, not the whole table',
            vtMid.mounted > 0 && vtMid.mounted < fullMid.mounted,
            { windowedMounted: { top: vtTop.mounted, mid: vtMid.mounted, bottom: vtBottom.mounted }, fullMounted: fullMid.mounted });
        record(SUITE, 'Windowing: the windowed tbody is exactly as tall as the fully rendered one (spacer rows model the unmounted rows exactly)',
            [vtTop, vtMid, vtBottom].every(p => Math.abs(p.tbodyHeight - fullMid.tbodyHeight) <= 1),
            { windowed: [vtTop.tbodyHeight, vtMid.tbodyHeight, vtBottom.tbodyHeight], full: fullMid.tbodyHeight });
        record(SUITE, 'Windowing: every mounted row fills exactly the header\'s column count at top, middle and bottom (Trade/Sub Trade/Service rowSpan cells re-created at the window edge)',
            [vtTop, vtMid, vtBottom, fullMid].every(p => p.misaligned === 0),
            { misaligned: { top: vtTop.misaligned, mid: vtMid.misaligned, bottom: vtBottom.misaligned, full: fullMid.misaligned } });
        record(SUITE, 'Windowing: at the same scroll position the windowed table shows the same first visible row as the full table',
            vtMidAgain.firstVisibleText !== null && vtMidAgain.firstVisibleText === fullMid.firstVisibleText,
            { windowed: vtMidAgain.firstVisibleText, full: fullMid.firstVisibleText, scrollTop: polMidTop });
        record(SUITE, 'Windowing: column widths are identical at top, middle, bottom and in the full render, and no body cell overflows its column in the full render (auto-fit reads every row\'s data, not the mounted rows)',
            polRevealed.every(Boolean) && new Set([vtTop.widths, vtMid.widths, vtBottom.widths, fullMid.widths]).size === 1 && fullOverflow.length === 0,
            { revealedWhileWindowed: Object.fromEntries(POL_WINDOWED_REVEAL.map((k, i) => [k, polRevealed[i]])), top: vtTop.widths, full: fullMid.widths, overflowing: fullOverflow.length, sample: fullOverflow.slice(0, 5) });

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
        //
        // SILENT-SKIP BUG (found/fixed 2026-09-10, dead since this check was written
        // 2026-08-25): the line above used to be
        // `headerLabels.indexOf('Max Laden Vs POL Booking')`, guarded by `idx >= 0`.
        // That NEVER matched, on any run, ever -- `formatHeader2Lines`'s `manualSplits`
        // table (app source, ~line 6362) renders this header's ON-SCREEN text as the
        // deliberately-abbreviated two-line "Max Ldn Vs" / "POL Bkg" (narrower column,
        // a real UI choice, not a bug -- not something this test should ever push back
        // on), so `th.textContent` for this header is literally "Max Ldn VsPOL Bkg"
        // (React renders the two fragments either side of a `<br/>`, which contributes
        // no text of its own -- same no-space-concatenation quirk this suite's own
        // Booking Flash/Detail sibling check already documents for "Short_Fall", see
        // that check's comment below) -- never `'Max Laden Vs POL Booking'` under any
        // whitespace normalization, because the abbreviation swaps actual letters
        // ("Ldn"/"Bkg" for "Laden"/"Booking"), not just spacing. `indexOf` therefore
        // always returned -1, `idx >= 0` was always false, and this whole check's
        // `record(...)` call never ran -- not one single time since it was written --
        // which is indistinguishable from a passing suite in the summary. Confirmed by
        // instrumenting a throwaway copy of this file to log `maxLdnVsBkgIdx` on a live
        // run against real data: -1, every time.
        //
        // FIXED two ways, addressing both the symptom and the root cause:
        //  1. Locate the column the way it actually renders: `thLabel('Max Laden Vs
        //     POL Booking')` (app source, the th right above this column) stamps the
        //     column's real/unabbreviated name onto a stable `data-autofit-col`
        //     attribute on its own wrapper div -- set once, at render time, from the
        //     same literal string this test wants to find, independently of whatever
        //     `formatHeader2Lines` does to the VISIBLE text for width reasons. Finding
        //     the `<th>` by that attribute instead of by its display text means a
        //     future re-abbreviation (e.g. "Mx Ldn/POL Bk") can't silently re-break
        //     this check the same way again -- only a change to the column's actual
        //     identity would.
        //  2. A column that cannot be found is now a FAILURE, not a skip. This column
        //     is unconditionally rendered on this tab (no `showXxx &&` toggle guards
        //     it, unlike the real toggle-gated Reefer/Activity/ETA/Operational Issues/
        //     VCO Analyst columns) -- there is no legitimate dataset on which it's
        //     absent, so "couldn't find it" must read as "this check is broken or the
        //     column regressed," never as silent success. See DATA_ARCHITECTURE.md's
        //     "toggle-hidden columns" silent-skip writeup for the same defect shape
        //     with a different trigger (a toggle default, not a permanent abbreviation).
        const maxLdnVsBkgTh = Array.from(headerRow0.children)
            .find(th => th.querySelector('[data-autofit-col="Max Laden Vs POL Booking"]'));
        const maxLdnVsBkgIdx = maxLdnVsBkgTh ? Array.from(headerRow0.children).indexOf(maxLdnVsBkgTh) : -1;
        if (maxLdnVsBkgIdx < 0) {
            record(SUITE, 'Class E: "Max Laden Vs POL Booking" never renders a negative comma-number without its accounting parens',
                false, { reason: 'column not found via data-autofit-col="Max Laden Vs POL Booking" -- this column is not toggle-gated, so not-found is a real failure, not a skip', headerLabels });
        } else {
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
        //
        // SILENT-SKIP SIBLING (found/fixed 2026-09-10, same audit as the Max Laden Vs POL
        // Booking check above): this used exact `headerLabels.indexOf(header)`, which is
        // ALSO always -1 for both fields here -- unlike Max Laden Vs POL Booking, these two
        // headers aren't abbreviated to different words, just line-wrapped at their own
        // natural space ("Coastal ETD" -> "Coastal<br/>ETD", "Port Cut" -> "Port<br/>Cut",
        // per `manualSplits`), so the on-screen text is "CoastalETD"/"PortCut" -- the exact
        // same words with the space silently eaten by the `<br/>`'s zero-length textContent.
        // Since the words themselves are unchanged here (no abbreviation), matching with all
        // whitespace stripped from both sides is sufficient and correct -- the same defensive
        // idiom this file already uses successfully for VVD/Vessel Name/Peak Laden Utilz %
        // lookups elsewhere in this suite (search this file for `replace(/\s+/g, '')`) --
        // rather than the data-autofit-col approach used above, which would require this
        // black-box test to know the app's internal state keys ('coastalEtd'/'portCut')
        // instead of the column's own real display name.
        const dateFields = [
            { label: 'Coastal ETD', header: 'Coastal ETD' },
            { label: 'Port Cut', header: 'Port Cut' },
        ];
        dateFields.forEach(({ label, header }) => {
            const idx = headerLabels.findIndex(h => h.replace(/\s+/g, '') === header.replace(/\s+/g, ''));
            if (idx < 0) {
                // Neither field is toggle-gated on this tab (both rendered
                // unconditionally via `headerCell(...)`, no `showXxx &&` guard) --
                // not-found has no legitimate explanation, so it fails loudly
                // instead of vanishing the way this check used to.
                record(SUITE, `Class F: "${label}" never renders a raw ISO date or a year-less "Mon D" date`,
                    false, { reason: `column not found (whitespace-stripped header match for "${header}")`, headerLabels });
                return;
            }
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
        //
        // 2026-10-01: Trade/Sub Trade/Service lead the row again, then VVD + Vessel Name (per
        // Kevin; Freeze Panes pins all five). VVD/Vessel come after the rowSpan'd trade cells,
        // so they are read by counting from the row's end, as before 2026-09-30. "Every field
        // after Vessel Name" would span Sales Week/Coastal ETD/Port Cut/Status, which ARE
        // filled on VMS rows, so the checked range starts at POL -- the column that directly
        // followed Vessel Name before 2026-09-30, i.e. the same data fields as always.
        const vvdIdx = headerLabels.findIndex(h => h.replace(/\s+/g, '') === 'VVD');
        const vesselIdx = headerLabels.findIndex(h => h.replace(/\s+/g, '') === 'VesselName');
        const firstDataIdx = headerLabels.findIndex(h => h.replace(/\s+/g, '') === 'POL');
        const leadPol = headerLabels.slice(0, 11).map(h => h.replace(/\s+/g, ''));
        record(SUITE, 'Column order (2026-10-01): Trade, Sub Trade, Service, Sales Week, Coastal ETD, Port Cut, Status, VVD, Vessel Name, VSL OPR, POL',
            leadPol.join('|') === 'Trade|SubTrade|Service|SalesWeek|CoastalETD|PortCut|Status|VVD|VesselName|VSLOPR|POL', { first: leadPol });
        await checkFreezePins(SUITE);
        if (vvdIdx >= 0 && vesselIdx >= 0 && firstDataIdx >= 0) {
            const leakedCells = [];
            let vmsRowCount = 0;
            rows.forEach(tr => {
                const tds = Array.from(tr.children);
                const vvdText = tds[tds.length - polFromEndByIdx[vvdIdx]]?.textContent.trim();
                const vesselText = tds[tds.length - polFromEndByIdx[vesselIdx]]?.textContent.trim();
                if (vvdText !== 'VMS' && vesselText !== 'VMS') return;
                vmsRowCount++;
                for (let i = firstDataIdx; i < headerLabels.length; i++) {
                    const td = tds[tds.length - polFromEndByIdx[i]];
                    const text = td ? td.textContent.trim() : '';
                    if (text !== '') leakedCells.push({ header: headerLabels[i], value: text });
                }
            });
            record(SUITE, 'Item 21 (2026-09-04): VMS rows (VVD or Vessel Name = "VMS") render every data field (POL onward) blank',
                vmsRowCount > 0 && leakedCells.length === 0, { vmsRowCount, leakedCells: leakedCells.slice(0, 10), leakedCount: leakedCells.length });
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
        // Visible-table lookup (not plain querySelector) -- see SUITE 1's comment above
        // for why (POL Booking Flash's own panel stays mounted+hidden across switches).
        const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
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
        // Field KEYS (FIELD_TOGGLES[].key in the app), not display labels -- see
        // clickShowToggle's rewritten comment for why matching on label text rotted.
        await clickShowToggle('reefer');
        await clickShowToggle('tradeBreakdown');
        await clickShowToggle('dgVolume');

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

        // 2026-09-26: "Current Laden Utiliz %" must be the vessel-level ratio SUM(Laden TEU) /
        // Max Laden -- what the reference workbook's cached column holds (26/26) -- not a sum of
        // each POL leg's pre-rounded percentage, which drifted 1 point on 90 of 366 real VVDs.
        // Short_Fall renders as Laden TEU - Max Laden on every row with a Max Laden, so Laden TEU
        // is recoverable from the table itself: this is a structural invariant, not a fixture
        // snapshot. Headers are matched with whitespace stripped (the resize handle concatenates
        // into textContent); "Max LDN" is an exact match so it can't hit "Max LDN vs BKG".
        const normHeader = (h) => h.replace(/\s+/g, '');
        const maxLdnIdx = detailHeaderLabels.findIndex(h => normHeader(h) === 'MaxLDN');
        const curUtilIdx = detailHeaderLabels.findIndex(h => normHeader(h) === 'CurrentLadenUtiliz%');
        if (maxLdnIdx >= 0 && curUtilIdx >= 0 && shortfallIdx >= 0) {
            const parseSigned = (t) => Number(t.replace(/[(),+\s]/g, ''));
            let utilChecked = 0;
            const utilMismatches = [];
            detailRows.forEach(tr => {
                const tds = Array.from(tr.children);
                const cell = (idx) => (tds[tds.length - detailFromEndByIdx[idx]] || {}).textContent;
                const maxText = (cell(maxLdnIdx) || '').trim();
                const sfText = (cell(shortfallIdx) || '').trim();
                const utilText = (cell(curUtilIdx) || '').trim();
                const max = parseSigned(maxText);
                if (!maxText || !sfText || !utilText || !(max > 0)) return;
                utilChecked++;
                const expected = Math.round(((parseSigned(sfText) + max) / max) * 100);
                if (parseInt(utilText, 10) !== expected) utilMismatches.push({ maxText, sfText, utilText, expected });
            });
            record(SUITE, '"Current Laden Utiliz %" == (Short_Fall + Max LDN) / Max LDN on every row with a Max LDN (vessel-level ratio, not summed per-leg percentages)',
                utilChecked > 0 && utilMismatches.length === 0, { utilChecked, mismatchCount: utilMismatches.length, mismatches: utilMismatches.slice(0, 5) });
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
        // 2026-10-01: Trade/Sub Trade/Lane lead the row again, then VVD + Vessel Name -- see
        // the POL suite's identical note; the data fields checked start at Max LDN.
        const detailVvdIdx = detailHeaderLabels.findIndex(h => h.replace(/\s+/g, '') === 'VVD');
        const detailVesselIdx = detailHeaderLabels.findIndex(h => h.replace(/\s+/g, '') === 'VesselName');
        const detailFirstDataIdx = detailHeaderLabels.findIndex(h => h.replace(/\s+/g, '') === 'MaxLDN');
        const leadDetail = detailHeaderLabels.slice(0, 12).map(h => h.replace(/\s+/g, ''));
        record(SUITE, 'Column order (2026-10-01): Trade, Sub Trade, Lane, Sales Week, PIC, 1st POL Cutoff, ETD Last Port, Status, VVD, Vessel Name, VSL OPR, Max LDN',
            leadDetail.join('|') === 'Trade|SubTrade|Lane|SalesWeek|PIC(spc/mkg)|1stPOLCutoff|ETDLastPort|Status|VVD|VesselName|VSLOPR|MaxLDN', { first: leadDetail });
        await checkFreezePins(SUITE);
        if (detailVvdIdx >= 0 && detailVesselIdx >= 0 && detailFirstDataIdx >= 0) {
            const leakedCells = [];
            let vmsRowCount = 0;
            detailRows.forEach(tr => {
                const tds = Array.from(tr.children);
                const vvdText = tds[tds.length - detailFromEndByIdx[detailVvdIdx]]?.textContent.trim();
                const vesselText = tds[tds.length - detailFromEndByIdx[detailVesselIdx]]?.textContent.trim();
                if (vvdText !== 'VMS' && vesselText !== 'VMS') return;
                vmsRowCount++;
                for (let i = detailFirstDataIdx; i < detailHeaderLabels.length; i++) {
                    const td = tds[tds.length - detailFromEndByIdx[i]];
                    const text = td ? td.textContent.trim() : '';
                    if (text !== '') leakedCells.push({ header: detailHeaderLabels[i], value: text });
                }
            });
            record(SUITE, 'Item 21 (2026-09-04): VMS rows (VVD or Vessel Name = "VMS") render every data field (Max LDN onward) blank',
                vmsRowCount > 0 && leakedCells.length === 0, { vmsRowCount, leakedCells: leakedCells.slice(0, 10), leakedCount: leakedCells.length });
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

        // ---- Highlighting must not move the page (2026-10-02, per Kevin: "why is it moving
        // everything around when highlighting?"; CODE_NOTES.md -- "Highlighting Must Not Move
        // The Page"). Clear Highlights and Report Card used to sit in the masthead, hidden until
        // the first highlight; showing them wrapped the masthead and shoved the slicers and the
        // table ~46px down, and the table kept the max-height measured for its old position.
        // These checks pass at ANY window size, because they do not wait for the real viewport to
        // be narrow enough to wrap: the masthead is pinned to the exact width of its own contents
        // (so anything that appears in it MUST wrap), and the window is faked taller so the table
        // is out of the 300px floor of its max-height formula (a 1280x720 headless window is
        // inside that floor, where "the table follows the masthead" cannot be told from "the table
        // is clamped"). Verified to fail against the pre-fix app, not just to pass against this one.
        await (async function highlightMustNotMovePage() {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const masthead = document.querySelector('[data-bf-masthead]');
            const tbl = Array.from(document.querySelectorAll('table.bf-highlight-host')).find(t => t.checkVisibility());
            const box = tbl && tbl.closest('div.overflow-auto');
            if (!masthead || !box) {
                record(SUITE, 'Setup: masthead ([data-bf-masthead]) and the Detail table container found for the highlight-layout checks', false,
                    { masthead: !!masthead, tableContainer: !!box });
                return;
            }
            const pill = () => document.querySelector('[data-bf-highlight-pill]');
            const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
            const highlightedCount = () => Array.from(document.querySelectorAll('tbody tr[data-bf-highlighted="true"]')).filter(tr => tr.checkVisibility()).length;
            const mastheadHasHighlightButtons = () => Array.from(masthead.querySelectorAll('button')).some(b => /Clear Highlights|Report Card/.test(b.textContent));
            const topOf = (el) => el.getBoundingClientRect().top;
            const heightOf = (el) => el.getBoundingClientRect().height;
            const hadInlineStyle = masthead.getAttribute('style');
            const restoreMasthead = () => { if (hadInlineStyle === null) masthead.removeAttribute('style'); else masthead.setAttribute('style', hadInlineStyle); };

            // ---- A: highlighting changes nothing about the layout ----
            let layout, placement, behaviour;
            try {
                // Exact fit: max-content is every child on one line; +1px absorbs sub-pixel rounding.
                masthead.style.width = 'max-content';
                const fitWidth = masthead.getBoundingClientRect().width;
                masthead.style.width = (fitWidth + 1) + 'px';
                await sleep(100);
                const before = { mastheadH: heightOf(masthead), tableTop: topOf(box), highlighted: highlightedCount(), pillShown: shown(pill()) };
                const rowCell = Array.from(tbl.querySelectorAll('tbody tr')).find(tr => !tr.querySelector('td[colspan]'))?.querySelector('td');
                if (rowCell) rowCell.click();
                await sleep(450); // past the 300ms click/double-click defer
                const after = { mastheadH: heightOf(masthead), tableTop: topOf(box), highlighted: highlightedCount(), pillShown: shown(pill()) };
                layout = { fitWidth, before, after };

                const reportBtn = pill() && pill().querySelector('[data-bf-report-card]');
                const clearBtn = pill() && pill().querySelector('[data-bf-clear-highlights]');
                placement = {
                    mastheadHasHighlightButtons: mastheadHasHighlightButtons(),
                    pillHiddenBefore: !before.pillShown, pillShownAfter: after.pillShown,
                    reportCardText: reportBtn && reportBtn.textContent.trim(), reportCardShown: shown(reportBtn),
                    hasClear: !!clearBtn, clearShown: shown(clearBtn),
                    pillText: pill() && pill().textContent.replace(/\s+/g, ' ').trim(),
                };

                // Report Card opens with the one highlighted row; Clear un-highlights and hides the pill.
                if (reportBtn) reportBtn.click();
                await waitFor(() => Array.from(document.querySelectorAll('h2')).some(h => h.textContent.includes('Selection Report Card')), { timeout: 3000 });
                const cardTitle = (Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('Selection Report Card')) || {}).textContent;
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                await waitFor(() => !Array.from(document.querySelectorAll('h2')).some(h => h.textContent.includes('Selection Report Card')), { timeout: 3000 });
                const cardClosed = !Array.from(document.querySelectorAll('h2')).some(h => h.textContent.includes('Selection Report Card'));
                if (clearBtn) clearBtn.click();
                await waitFor(() => highlightedCount() === 0 && !shown(pill()), { timeout: 3000 });
                behaviour = { cardTitle, cardClosed, highlightedAfterClear: highlightedCount(), pillShownAfterClear: shown(pill()) };
            } finally {
                restoreMasthead();
                if (highlightedCount() > 0) { const c = document.querySelector('[data-bf-clear-highlights]'); if (c) c.click(); await sleep(100); }
            }
            record(SUITE, 'Highlighting a row moves nothing: with the masthead pinned to its exact one-row width, the first highlight leaves its height and the table\'s position unchanged',
                !!layout && layout.before.highlighted === 0 && layout.after.highlighted === 1 &&
                    Math.abs(layout.after.mastheadH - layout.before.mastheadH) < 0.5 && Math.abs(layout.after.tableTop - layout.before.tableTop) < 0.5,
                layout);
            record(SUITE, 'Report Card and Clear live in the floating highlight pill, never in the masthead: pill hidden with nothing highlighted, shown with "1 highlighted", Report Card (1) + Clear inside it',
                !!placement && !placement.mastheadHasHighlightButtons && placement.pillHiddenBefore && placement.pillShownAfter &&
                    placement.reportCardShown && /Report Card \(1\)/.test(placement.reportCardText || '') && placement.hasClear && placement.clearShown &&
                    /^1 highlighted/.test(placement.pillText || ''),
                placement);
            record(SUITE, 'The pill\'s Report Card opens the report card for the highlighted row (Escape closes it) and its Clear un-highlights every row and hides the pill',
                !!behaviour && /Selection Report Card \(1 row\)/.test(behaviour.cardTitle || '') && behaviour.cardClosed && behaviour.highlightedAfterClear === 0 && !behaviour.pillShownAfterClear,
                behaviour);

            // ---- C: the table re-fits when the masthead changes height ----
            const realDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight');
            const realInnerHeight = window.innerHeight;
            const maxOf = () => parseFloat(box.style.maxHeight);
            const originalMax = maxOf();
            let refit;
            try {
                Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => realInnerHeight + 1500 });
                window.dispatchEvent(new Event('resize'));
                await waitFor(() => Math.abs(maxOf() - originalMax) > 100, { timeout: 3000 });
                await sleep(100);
                const max0 = maxOf(), top0 = topOf(box), h0 = heightOf(masthead);
                // Narrower than the first child plus the cluster: the cluster drops to its own line.
                masthead.style.width = (masthead.children[0].getBoundingClientRect().width + 40) + 'px';
                await sleep(50);
                const shift = topOf(box) - top0;
                const followed = shift > 10 && await waitFor(() => Math.abs((max0 - maxOf()) - shift) < 2, { timeout: 3000 });
                refit = { realInnerHeight, fakedInnerHeight: window.innerHeight, h0, h1: heightOf(masthead), shift, max0, max1: maxOf(), followed };
            } finally {
                restoreMasthead();
                if (realDesc) Object.defineProperty(window, 'innerHeight', realDesc); else delete window.innerHeight;
                window.dispatchEvent(new Event('resize'));
                await waitFor(() => Math.abs(maxOf() - originalMax) < 1.5, { timeout: 3000 });
            }
            record(SUITE, 'The table re-fits when the masthead wraps: its max-height follows the table\'s new position (the old code left it stale, so the table ran off the bottom of the window)',
                !!refit && refit.shift > 10 && refit.followed === true, refit);
        })();
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
    // Weekly-bar hover cards on the Analyze trend chart (2026-10-05, shared by both Analyze suites).
    // Before this the card was an absolute child of each bar: with every week shown, the first and
    // last bars' cards stuck out past the modal's edges (clipped on the left) and their invisible
    // boxes gave the modal a permanent horizontal scrollbar (scrollWidth 807 vs 768 on the 8-12
    // fixture). It is now portaled to <body> (the modal's drag transform makes it the containing
    // block for a `fixed` child, so a fixed card left inside it would still be clipped). Four
    // checks per tab: (1) at rest the modal does not scroll sideways and no card is in the DOM,
    // (2) every bar's card lands inside the modal's visible box and the window, named for its own
    // week, and still over its bar whenever that bar is visible (the chart's own box is not the
    // bound: the bars can be wider than it, which first detached the card from its bar at narrow
    // widths and with some lane filters), (3) one card at a time, gone when the pointer leaves,
    // (4) the card follows its bar when the modal scrolls under a stationary pointer. Hovering is
    // driven the way React sees it (mouseover / mouseout with no relatedTarget); a CSS :hover cannot
    // be forced from here, but the card no longer depends on :hover at all. Geometry is read from
    // getBoundingClientRect, not inferred from classes. Real-mouse geometry across window sizes, a
    // dragged / resized modal and lane filters was verified by hand, see docs/CHECK_HISTORY.md.
    const checkWeeklyBarTooltips = async (SUITE) => {
        const modal = document.querySelector('[data-analysis-modal]');
        const bars = () => Array.from(document.querySelectorAll('[data-week-bar]'));
        const cards = () => Array.from(document.querySelectorAll('[data-week-bar-tooltip]'));
        if (!modal) { record(SUITE, 'Trend chart hover cards: setup -- Analyze modal found', false); return; }
        const allBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All');
        if (allBtn && allBtn.getAttribute('aria-pressed') !== 'true') allBtn.click();
        await waitFor(() => bars().length > 0, { timeout: 3000 });
        const barList = bars();
        if (barList.length < 5) { record(SUITE, 'Trend chart hover cards: setup -- at least 5 weeks shown (All)', false, { bars: barList.length }); return; }
        record(SUITE, 'Trend chart hover cards: setup -- bars found with every week shown', true, { bars: barList.length });

        // (1) At rest: nothing stretching the modal sideways, and no hidden card left in the DOM.
        record(SUITE, 'Trend chart hover cards: with every week shown the modal has no horizontal overflow at rest, and no card sits in the page until a bar is hovered',
            modal.scrollWidth <= modal.clientWidth + 1 && cards().length === 0,
            { scrollWidth: modal.scrollWidth, clientWidth: modal.clientWidth, cardsAtRest: cards().length });

        const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget: null }));
        const modalBox = modal.getBoundingClientRect();
        const tol = 0.5;
        const geometryFails = [];
        const lifecycleFails = [];
        let measured = 0;
        for (const bar of barList) {
            const week = bar.getAttribute('data-week-bar');
            fire(bar, 'mouseover');
            const shown = await waitFor(() => cards().length === 1 && getComputedStyle(cards()[0]).visibility === 'visible', { timeout: 2000 });
            const found = cards();
            if (!shown) { lifecycleFails.push({ week, problem: `hover showed ${found.length} cards (expected exactly 1, visible)` }); fire(bar, 'mouseout'); continue; }
            measured++;
            const card = found[0].getBoundingClientRect();
            const view = { left: modalBox.left + modal.clientLeft, right: modalBox.left + modal.clientLeft + modal.clientWidth };
            const barRect = bar.getBoundingClientRect();
            const barCx = barRect.left + barRect.width / 2;
            const header = (found[0].firstElementChild?.textContent || '').trim();
            const viewFitsCard = view.right - view.left >= card.width;
            const outside = {
                left: viewFitsCard ? +(view.left - card.left).toFixed(1) : 0,
                right: viewFitsCard ? +(card.right - view.right).toFixed(1) : 0,
                windowLeft: +(0 - card.left).toFixed(1),
                windowRight: +(card.right - window.innerWidth).toFixed(1),
                windowTop: +(0 - card.top).toFixed(1),
                windowBottom: +(card.bottom - window.innerHeight).toFixed(1),
            };
            const worst = Math.max(...Object.values(outside));
            const barVisible = barCx >= view.left && barCx <= view.right;
            const detached = barVisible && (barCx < card.left - tol || barCx > card.right + tol);
            if (worst > tol || header !== week || detached) geometryFails.push({ week, header, detached, barCx: +barCx.toFixed(1), outside, card: { l: +card.left.toFixed(1), r: +card.right.toFixed(1), w: +card.width.toFixed(1) }, view });
            fire(bar, 'mouseout');
            const gone = await waitFor(() => cards().length === 0, { timeout: 2000 });
            if (!gone) lifecycleFails.push({ week, problem: `card still in the page after the pointer left (${cards().length})` });
        }
        record(SUITE, 'Trend chart hover cards: every bar\'s card is named for its week, sits inside the modal\'s visible box and the window, and stays over its bar (centred unless that would cross an edge)',
            measured === barList.length && geometryFails.length === 0, { bars: barList.length, measured, fails: geometryFails.slice(0, 6) });
        record(SUITE, 'Trend chart hover cards: hovering a bar shows exactly one card and it is removed when the pointer leaves',
            lifecycleFails.length === 0 && cards().length === 0, { fails: lifecycleFails.slice(0, 6), cardsLeft: cards().length });

        // (4) The card is placed once from the bar's rect, so it must be re-placed when the bar
        // moves without the pointer moving: scroll the modal 24px under a stationary hover and the
        // gap between the card and its bar must not change. (A mid-chart bar, so the card never
        // flips below it; the sign of the scroll is chosen from the room the modal has.)
        await (async function followsScroll() {
            const NAME = 'Trend chart hover cards: the card follows its bar when the modal scrolls under a stationary pointer';
            const bar = barList[Math.floor(barList.length / 2)];
            const room = modal.scrollHeight - modal.clientHeight;
            const delta = modal.scrollTop >= 24 ? -24 : 24;
            if (room < 24) { record(SUITE, NAME, false, { problem: 'the modal has no room to scroll', room }); return; }
            const gap = (card) => bar.getBoundingClientRect().top - card.getBoundingClientRect().bottom;
            fire(bar, 'mouseover');
            const shown = await waitFor(() => cards().length === 1 && getComputedStyle(cards()[0]).visibility === 'visible', { timeout: 2000 });
            if (!shown) { record(SUITE, NAME, false, { problem: 'no card on hover' }); return; }
            const topBefore = bar.getBoundingClientRect().top;
            const gapBefore = gap(cards()[0]);
            modal.scrollTop += delta;
            await waitFor(() => Math.abs(bar.getBoundingClientRect().top - topBefore) > 1, { timeout: 2000 });
            const followed = await waitFor(() => cards().length === 1 && Math.abs(gap(cards()[0]) - gapBefore) <= 1, { timeout: 2000 });
            const detail = { delta, barMoved: +(bar.getBoundingClientRect().top - topBefore).toFixed(1), gapBefore: +gapBefore.toFixed(1), gapAfter: cards().length === 1 ? +gap(cards()[0]).toFixed(1) : null };
            fire(bar, 'mouseout');
            modal.scrollTop -= delta;
            record(SUITE, NAME, followed && Math.abs(detail.barMoved) > 1, detail);
        })();
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
            // 2026-09-21, code-review finding: this card's "Avg Peak Utilization" value
            // (avgPeakUtilization in the app source) was previously unscraped, so the
            // same-session clamp removal and isFinite fix around it shipped with zero
            // regression coverage. 'Peak' is unambiguous within a card's rows (the only
            // other three are 'Max Laden:'/'Avg Wkly Laden'/'Avg Wkly Shortfall'), and
            // matches both the Lane-tab label ("Avg Peak Utilization:") and the POL-tab
            // label ("Avg Peak POL Utilization:").
            return { name, badge, avgWklyMaxLdn: getVal('Max Laden:'), avgWklyLaden: getVal('Avg Wkly Laden'), avgWklyShortfall: getVal('Avg Wkly Shortfall'), avgPeakUtilization: getVal('Peak') };
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

        // 2026-09-21, code-review finding: the finite half of this check can't
        // currently be tripped by any value that reaches this point -- groupBy's own
        // isFinite(parsedPeakUtil) push-filter (app file line 7551) already excludes
        // non-finite values before groupPeakUtils' average is computed (app file line
        // 7581), so avgPeakUtilization can never itself be NaN/Infinity today. It's
        // kept as a regression guard on that upstream filter: if it were ever
        // weakened back to a bare isNaN(...) check (the original bug this session's
        // fix corrected), a poisoned "Infinity%" input would flow through, and this
        // is the assertion that would catch it. The non-negative half remains a live
        // check today. Deliberately does NOT assert it stays <=100 or that some card
        // must exceed 100 -- either would hard-code an assumption about today's live
        // data (whether any lane's real peak utilization happens to exceed 100%
        // varies by date), the same brittleness this suite's other live-data-dependent
        // checks are already documented to avoid (see AGENTS.md's live-testing notes).
        const peakUtilFails = groups.filter(c => c.avgPeakUtilization !== null && (!Number.isFinite(c.avgPeakUtilization) || c.avgPeakUtilization < 0))
            .map(c => ({ name: c.name, avgPeakUtilization: c.avgPeakUtilization }));
        record(SUITE, 'Analyze: every breakdown card\'s Avg Peak Utilization is a finite, non-negative percentage', peakUtilFails.length === 0, { fails: peakUtilFails });
    };

    // ============================================================
    // SUITE 5: Analyze modal — Booking Flash tab ("Service Lane
    // Performance Summary"). Breakdown is by Lane, so Overall == sum of
    // the displayed cards is expected to hold (within rounding).
    // ============================================================
    // Analyze vs. the table underneath it (2026-09-26). checkAnalysisMath above only proves the
    // modal agrees WITH ITSELF (Overall == sum of cards, badge == laden/capacity), and that is
    // exactly why the per-lane-week Math.max capacity bug survived: every self-consistency check
    // passed while a port like USSAV01 read 117% against a real 35%. This rebuilds every card
    // independently from the tab's own visible table -- one row per vessel (Booking Flash) or per
    // vessel x POL (POL Booking Flash) -- using the definitions the modal now states on screen:
    // each week's capacity/laden SUMMED over its vessels, averaged over the weeks that have at
    // least one real vessel (VMS-only weeks left out); peak = mean of one value per sailing. Then opens one card's vessel list and checks it reconciles to the card.
    // Call with the modal open and the "All" weeks chip active (the departed-star guards above
    // already click it), so the modal's week window is every week the table shows.
    const crossCheckAnalysisAgainstTable = async (SUITE, mode) => {
        const isPol = mode === 'pol';
        const allBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All');
        if (allBtn && allBtn.getAttribute('aria-pressed') !== 'true') { allBtn.click(); await new Promise(r => setTimeout(r, 800)); }

        // The tab's main table: the visible table with the most body rows (the modal has none
        // open at this point; its vessel list only exists once a card is clicked, below).
        const table = Array.from(document.querySelectorAll('table')).filter(t => t.checkVisibility())
            .sort((a, b) => b.querySelectorAll('tbody tr').length - a.querySelectorAll('tbody tr').length)[0];
        if (!table) { record(SUITE, 'Analyze vs table: setup -- table found', false); return; }
        // rowSpan/colSpan-expanded grid, so every row reads its own Lane/Trade even where the table
        // merges them; header labels come from the expanded LAST thead row (leaf labels).
        const expand = (trs) => {
            const grid = [];
            trs.forEach((tr, ri) => {
                grid[ri] = grid[ri] || [];
                let col = 0;
                Array.from(tr.children).forEach(td => {
                    while (grid[ri][col] !== undefined) col++;
                    const rs = +(td.getAttribute('rowspan') || 1), cs = +(td.getAttribute('colspan') || 1);
                    for (let r = 0; r < rs; r++) { grid[ri + r] = grid[ri + r] || []; for (let k = 0; k < cs; k++) grid[ri + r][col + k] = td.textContent.trim(); }
                    col += cs;
                });
            });
            return grid.slice(0, trs.length);
        };
        const headGrid = expand(Array.from(table.tHead.rows));
        const headers = (headGrid[headGrid.length - 1] || []).map(h => h.replace(/[▲▼\s]/g, ''));
        const col = (label) => headers.indexOf(label);
        const idx = isPol
            ? { group: col('POL'), week: col('SalesWeek'), vvd: col('VVD'), cap: col('POLMaxLaden(TEU)'), laden: col('CurrentLaden(TEU)'), peak: col('PeakLadenUtilz%') }
            : { group: col('Lane'), week: col('SalesWeek'), vvd: col('VVD'), cap: col('MaxLDN'), laden: col('CurrentLaden(TEU)'), peak: col('PeakUtiliz%') };
        if (Object.values(idx).some(i => i < 0)) { record(SUITE, 'Analyze vs table: setup -- every needed column found', false, { idx, headers }); return; }
        const bodyTrs = Array.from(table.tBodies).flatMap(b => Array.from(b.rows)).filter(tr => !tr.hasAttribute('data-pol-vt-spacer'));

        const sailings = {};
        const weekVvds = {}; // distinct real VVDs per sale week, across every group (the trend chart's "N vsl")
        expand(bodyTrs).forEach(cells => {
            const group = cells[idx.group], week = cells[idx.week], vvd = cells[idx.vvd];
            if (week && vvd && vvd.toUpperCase() !== 'VMS') (weekVvds[week] || (weekVvds[week] = new Set())).add(vvd.toUpperCase());
            if (!group || !week || !vvd) return; // group spacer rows; blank-POL VMS rows (no card)
            const key = `${group}|${week}|${vvd}`;
            const s = sailings[key] || (sailings[key] = { group, week, real: vvd.toUpperCase() !== 'VMS', cap: 0, laden: 0, peak: null });
            s.cap = Math.max(s.cap, parseNum(cells[idx.cap]) || 0);
            s.laden += parseNum(cells[idx.laden]) || 0;
            const p = parseNum(cells[idx.peak]);
            if (s.real && cells[idx.peak] !== '' && Number.isFinite(p)) s.peak = s.peak === null ? p : Math.max(s.peak, p);
        });
        const expected = {};
        Object.values(sailings).forEach(s => {
            const e = expected[s.group] || (expected[s.group] = { weeks: {}, peaks: [], sailings: 0 });
            const w = e.weeks[s.week] || (e.weeks[s.week] = { cap: 0, laden: 0, vessels: 0 });
            w.cap += s.cap; w.laden += s.laden;
            if (s.real) w.vessels++;
            if (s.real) e.sailings++;
            if (s.peak !== null) e.peaks.push(s.peak);
        });

        const cards = Array.from(document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative'));
        const readCard = (card) => {
            const rows = Array.from(card.querySelectorAll('.flex.justify-between'));
            const val = (label) => { const r = rows.find(x => x.textContent.includes(label)); return r ? r.children[1].textContent.trim() : null; };
            const countText = val(isPol ? 'Vessel calls:' : 'Sailings:') || '';
            const m = /^(\d+) in (\d+) wk/.exec(countText);
            return {
                name: card.querySelector('.font-bold.text-sm.mb-2')?.textContent.trim(),
                cap: parseNum(val('Max Laden:')), laden: parseNum(val('Avg Wkly Laden')), peak: parseNum(val('Peak')),
                sailings: m ? +m[1] : null, weeks: m ? +m[2] : null,
            };
        };
        const fails = { cap: [], laden: [], peak: [], count: [] };
        cards.map(readCard).forEach(c => {
            const e = expected[c.name];
            if (!e) { fails.count.push({ card: c.name, problem: 'no rows for this card in the table' }); return; }
            // Weeks holding only a VMS placeholder are left out of the averages (2026-09-26).
            const weeks = Object.values(e.weeks).filter(w => w.vessels > 0);
            const cap = weeks.length ? weeks.reduce((a, w) => a + w.cap, 0) / weeks.length : 0;
            const laden = weeks.length ? weeks.reduce((a, w) => a + w.laden, 0) / weeks.length : 0;
            const peak = e.peaks.length ? e.peaks.reduce((a, v) => a + v, 0) / e.peaks.length : 0;
            // Tolerance 1: the table shows rounded per-vessel values, the card a rounded average.
            if (Math.abs(c.cap - cap) > 1) fails.cap.push({ card: c.name, card_value: c.cap, from_table: Math.round(cap) });
            if (Math.abs(c.laden - laden) > 1) fails.laden.push({ card: c.name, card_value: c.laden, from_table: Math.round(laden) });
            if (Math.abs(c.peak - peak) > 1) fails.peak.push({ card: c.name, card_value: c.peak, from_table: Math.round(peak) });
            if (c.sailings !== e.sailings || c.weeks !== weeks.length) fails.count.push({ card: c.name, card_value: `${c.sailings} in ${c.weeks}`, from_table: `${e.sailings} in ${weeks.length}` });
        });
        const noun = isPol ? 'POL' : 'lane';
        record(SUITE, `Analyze vs table: every card's Avg Wkly${isPol ? ' POL' : ''} Max Laden == each week's SUM over its vessels' ${isPol ? 'POL ' : ''}Max Laden, averaged over weeks (rebuilt from the ${noun} table, not from the modal)`,
            cards.length > 0 && fails.cap.length === 0, { cardsChecked: cards.length, fails: fails.cap.slice(0, 5), failCount: fails.cap.length });
        record(SUITE, `Analyze vs table: every card's Avg Wkly Laden == each week's SUM of Current Laden, averaged over weeks${isPol ? '' : ' (PAROD already excluded by the table)'}`,
            cards.length > 0 && fails.laden.length === 0, { cardsChecked: cards.length, fails: fails.laden.slice(0, 5), failCount: fails.laden.length });
        record(SUITE, `Analyze vs table: every card's Avg Peak${isPol ? ' POL' : ''} Utilization == mean of one peak per sailing`,
            cards.length > 0 && fails.peak.length === 0, { cardsChecked: cards.length, fails: fails.peak.slice(0, 5), failCount: fails.peak.length });
        record(SUITE, `Analyze vs table: every card's "${isPol ? 'Vessel calls' : 'Sailings'}: N in W wks" matches the table's distinct vessels and weeks`,
            cards.length > 0 && fails.count.length === 0, { cardsChecked: cards.length, fails: fails.count.slice(0, 5), failCount: fails.count.length });

        // Trend chart "N vsl" under each week (2026-10-02, per Kevin): the number of DISTINCT VVDs
        // sailing that week, not one per group. The POL tab summed per-POL counts, so one vessel
        // calling USHOU01 and USMIA01 read "2 vsl" (on the 8-12 fixture, W27 read 56 against 24
        // distinct VVDs). Chart labels are "W##", so weeks are matched on that suffix; a suffix
        // shared by two years in the table is skipped rather than guessed at. The VMS-only-week
        // layout half of the same request is checked by vmsWeekAlignmentGuard (lane suite).
        (function chartVesselCountGuard() {
            const expectedByWk = {}, wkYears = {};
            Object.keys(weekVvds).forEach(w => { const wk = w.split('/')[1] || w; wkYears[wk] = (wkYears[wk] || 0) + 1; expectedByWk[wk] = weekVvds[w].size; });
            const labels = Array.from(document.querySelectorAll('div')).filter(d =>
                d.className.includes('text-[11px]') && d.className.includes('font-bold') && /^W\d+★?$/.test(d.textContent.trim()));
            const countMismatches = [], missingLine = [];
            labels.forEach(d => {
                const wk = d.textContent.trim().replace('★', '');
                const m = /^(\d+) vsl$/.exec(d.nextElementSibling?.textContent.trim() || '');
                if (!m) { missingLine.push(wk); return; }
                if (wkYears[wk] === 1 && +m[1] !== expectedByWk[wk]) countMismatches.push({ week: wk, chart: +m[1], distinctVvdsInTable: expectedByWk[wk] });
                if (!wkYears[wk] && +m[1] !== 0) countMismatches.push({ week: wk, chart: +m[1], distinctVvdsInTable: 0 });
            });
            record(SUITE, `Trend chart: each week's "N vsl" == the ${noun} table's distinct real VVDs that week (a vessel calling several ${isPol ? 'POLs' : 'lanes'} counts once)`,
                labels.length > 0 && missingLine.length === 0 && countMismatches.length === 0,
                { weeksChecked: labels.length, missingVslLine: missingLine.slice(0, 10), mismatches: countMismatches.slice(0, 10) });
        })();

        // Vessel list: open the card with the most sailings (the one most likely to have a
        // shared week), check it lists exactly that card's sailings and its footer IS the card.
        const target = cards.map(c => ({ el: c, ...readCard(c) })).sort((a, b) => (b.sailings || 0) - (a.sailings || 0))[0];
        let drill = null;
        if (target) {
            target.el.click();
            await waitFor(() => document.querySelector('[data-analysis-drilldown]'), { timeout: 3000 });
            const panel = document.querySelector('[data-analysis-drilldown]');
            if (panel) {
                const realRows = Array.from(panel.querySelectorAll('tbody tr[data-analysis-sailing]')).filter(tr => !tr.textContent.includes('VMS placeholder')).length;
                // Read by header name (2026-09-30): the list's columns vary with the port columns shown.
                const listTable = panel.querySelector('table');
                const listHeads = expand(Array.from(listTable.tHead.rows)).pop() || [];
                const foot = (expand(Array.from(listTable.tFoot.rows))[0] || []).map(parseNum);
                const at = (i) => i === -1 ? NaN : foot[i];
                drill = { card: target.name, panelFor: panel.getAttribute('data-analysis-drilldown'), realRows, cardSailings: target.sailings,
                    footer: { cap: at(listHeads.findIndex(h => /^(POL )?Max Laden$/.test(h))), laden: at(listHeads.indexOf('Current Laden')), peak: at(listHeads.findIndex(h => h.startsWith('Peak'))) },
                    cardValues: { cap: target.cap, laden: target.laden, peak: target.peak } };
                target.el.click(); // close it again so later suites see the modal as they left it
                await waitFor(() => !document.querySelector('[data-analysis-drilldown]'), { timeout: 3000 });
                drill.closedAgain = !document.querySelector('[data-analysis-drilldown]');
            }
        }
        record(SUITE, 'Analyze vessel list: clicking a card lists exactly its sailings, its footer equals the card, and clicking again closes it',
            !!drill && drill.panelFor === drill.card && drill.realRows === drill.cardSailings
                && Math.abs(drill.footer.cap - drill.cardValues.cap) <= 1 && Math.abs(drill.footer.laden - drill.cardValues.laden) <= 1
                && Math.abs(drill.footer.peak - drill.cardValues.peak) <= 1 && drill.closedAgain,
            drill || { problem: 'no card, or the vessel list never appeared' });

        // "By port" Avg Peak Utilization (lane tabs only, 2026-09-26): each port call's own Peak
        // POL Utilz -- the POL tab's measure -- so it is rebuilt from the POL Booking Flash table
        // (kept mounted, render-all during this suite): its Service = lane, and "Peak Laden Utilz %"
        // per port call. PAROD and "NO N.A. CALL" legs are not NA port calls and are skipped, as in
        // the app. Then switch back to "By week" and require every card's original value to return.
        if (!isPol) {
            const polTable = Array.from(document.querySelectorAll('table')).find(t => {
                if (!t.tHead) return false;
                const hg = expand(Array.from(t.tHead.rows));
                const last = (hg[hg.length - 1] || []).map(h => h.replace(/[▲▼\s]/g, ''));
                return last.includes('PeakLadenUtilz%') && last.includes('Service');
            });
            const byPortBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'By port');
            const byWeekBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'By week');
            if (!polTable || !byPortBtn || !byWeekBtn) {
                record(SUITE, 'Analyze "By port": every lane card == mean of its port calls\' own Peak Laden Utilz % in the POL table', false,
                    { polTable: !!polTable, byPortBtn: !!byPortBtn, byWeekBtn: !!byWeekBtn });
            } else {
                const hg = expand(Array.from(polTable.tHead.rows));
                const ph = (hg[hg.length - 1] || []).map(h => h.replace(/[▲▼\s]/g, ''));
                const pi = { lane: ph.indexOf('Service'), vvd: ph.indexOf('VVD'), pol: ph.indexOf('POL'), peak: ph.indexOf('PeakLadenUtilz%') };
                const portPeaks = {};
                expand(Array.from(polTable.tBodies).flatMap(b => Array.from(b.rows)).filter(tr => !tr.hasAttribute('data-pol-vt-spacer'))).forEach(cells => {
                    const lane = cells[pi.lane], vvd = cells[pi.vvd], pol = (cells[pi.pol] || '').toUpperCase();
                    if (!lane || !vvd || vvd.toUpperCase() === 'VMS' || !pol || pol.startsWith('PAROD') || pol === 'NO N.A. CALL') return;
                    const p = parseNum(cells[pi.peak]);
                    if (Number.isFinite(p)) (portPeaks[lane] = portPeaks[lane] || []).push(p);
                });
                const peaksNow = () => Object.fromEntries(Array.from(document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative')).map(c => { const r = readCard(c); return [r.name, r.peak]; }));
                const weekPeaks = peaksNow();
                byPortBtn.click();
                await waitFor(() => Array.from(document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative')).some(c => c.textContent.includes('(by port)')), { timeout: 3000 });
                const portFails = [];
                let portChecked = 0;
                Object.entries(peaksNow()).forEach(([lane, value]) => {
                    const list = portPeaks[lane];
                    if (!list || list.length === 0) return;
                    portChecked++;
                    const want = list.reduce((a, v) => a + v, 0) / list.length;
                    if (Math.abs(value - want) > 1) portFails.push({ lane, card_value: value, from_pol_table: Math.round(want), portCalls: list.length });
                });
                record(SUITE, 'Analyze "By port": every lane card == mean of its port calls\' own Peak Laden Utilz % in the POL table (PAROD / NO N.A. CALL excluded)',
                    portChecked > 0 && portFails.length === 0, { lanesChecked: portChecked, fails: portFails.slice(0, 5), failCount: portFails.length });

                // Vessel list port sub-rows (2026-09-26): "By port" opens every vessel's port calls.
                // Each vessel's rows must be exactly its non-PAROD legs in the POL table (same POLs,
                // same Current Laden, rebuilt from that table, not from the modal), and its "Vessel
                // total" Current Laden must be their sum.
                const ci = ph.indexOf('CurrentLaden(TEU)');
                const polLegs = {};
                expand(Array.from(polTable.tBodies).flatMap(b => Array.from(b.rows)).filter(tr => !tr.hasAttribute('data-pol-vt-spacer'))).forEach(cells => {
                    const lane = cells[pi.lane], vvd = cells[pi.vvd], pol = (cells[pi.pol] || '').toUpperCase();
                    if (!lane || !vvd || vvd.toUpperCase() === 'VMS' || !pol || pol.startsWith('PAROD')) return;
                    (polLegs[`${lane}|${vvd}`] = polLegs[`${lane}|${vvd}`] || []).push(`${pol}=${Math.round(parseNum(cells[ci]) || 0)}`);
                });
                let sub = null;
                let colCheck = { problem: 'no card, no Current Laden (TEU) column, or the port sub-rows never appeared' };
                if (target && ci !== -1) {
                    target.el.click();
                    await waitFor(() => document.querySelector('[data-analysis-drilldown] tr[data-analysis-port-row]'), { timeout: 3000 });
                    const panel = document.querySelector('[data-analysis-drilldown]');
                    if (panel) {
                        // Since 2026-09-30 the port rows are rows of the vessel list's own table, under
                        // its one header (they were a nested table with its own header before).
                        const table = panel.querySelector('table');
                        const h = expand(Array.from(table.tHead.rows)).pop() || [];
                        const pc = h.indexOf('Port'), lc = h.indexOf('Current Laden');
                        const portRows = {};
                        Array.from(table.querySelectorAll('tr[data-analysis-port-row]')).forEach(tr => {
                            const cells = expand([tr])[0];
                            const vvd = tr.getAttribute('data-analysis-port-row');
                            (portRows[vvd] = portRows[vvd] || []).push([(cells[pc] || '').toUpperCase(), Math.round(parseNum(cells[lc]) || 0)]);
                        });
                        // The vessel's own row carries its totals, in the same columns as its port rows.
                        const totals = Object.fromEntries(Array.from(table.querySelectorAll('tr[data-analysis-sailing]')).map(tr => [tr.getAttribute('data-analysis-sailing'), parseNum(expand([tr])[0][lc])]));
                        const blocks = Object.keys(portRows);
                        const fails = [];
                        blocks.forEach(vvd => {
                            const rows = portRows[vvd];
                            const shown = rows.map(([pol, l]) => `${pol}=${l}`).sort();
                            const want = (polLegs[`${target.name}|${vvd}`] || []).slice().sort();
                            const total = totals[vvd];
                            const sum = rows.reduce((a, [, l]) => a + l, 0);
                            if (pc === -1 || lc === -1 || JSON.stringify(shown) !== JSON.stringify(want) || !(Math.abs(total - sum) <= 1)) fails.push({ vvd, shown, from_pol_table: want, total, sum });
                        });
                        sub = { card: target.name, vesselsWithPorts: blocks.length, fails: fails.slice(0, 3), failCount: fails.length };

                        // One header for every row (2026-09-30, per Kevin): with port calls open,
                        // adding a column must put its name in the list's header, and every row --
                        // vessel, port call, Weekly average -- must span exactly the
                        // header's columns, so each value sits under its own name. Before, the port
                        // calls were a nested table whose header lined up with nothing above it, and
                        // added columns were named only in that nested header. Port Cut is added
                        // through the real "Add Columns" menu; a date must then show under "Port Cut"
                        // on a port row (a misaligned row would put a POL or a TEU figure there).
                        const aligned = () => {
                            const t = panel.querySelector('table');
                            const heads = expand(Array.from(t.tHead.rows)).pop() || [];
                            const bad = [...t.tBodies[0].rows, ...t.tFoot.rows].map(tr => [tr, expand([tr])[0].length]).filter(([, n]) => n !== heads.length)
                                .map(([tr, n]) => ({ row: tr.textContent.trim().slice(0, 40), cells: n }));
                            return { heads, bad };
                        };
                        const menuBtn = Array.from(panel.querySelectorAll('button')).find(b => b.textContent.includes('Add Columns'));
                        colCheck = { problem: 'no "Add Columns" button' };
                        if (menuBtn) {
                            menuBtn.click();
                            await waitFor(() => panel.querySelector('[data-analysis-port-col-menu] input[type="checkbox"]'), { timeout: 3000 });
                            const box = (label) => Array.from(panel.querySelectorAll('[data-analysis-port-col-menu] label')).find(l => l.textContent.trim().replace(/ \(always\)$/, '') === label)?.querySelector('input');
                            const portCut = box('Port Cut');
                            const wasOn = !!portCut && portCut.checked;
                            if (portCut && !wasOn) { portCut.click(); await waitFor(() => aligned().heads.includes('Port Cut'), { timeout: 3000 }); }
                            const { heads, bad } = aligned();
                            const checked = Array.from(panel.querySelectorAll('[data-analysis-port-col-menu] label')).filter(l => l.querySelector('input').checked).map(l => l.textContent.trim().replace(/ \(always\)$/, ''));
                            const unnamed = checked.filter(label => !heads.includes(label));
                            const cutCol = heads.indexOf('Port Cut');
                            const cutDates = cutCol === -1 ? 0 : Array.from(panel.querySelectorAll('tr[data-analysis-port-row]')).filter(tr => /^\d{1,2}\/\d{1,2}\/\d{2}/.test(expand([tr])[0][cutCol] || '')).length;
                            colCheck = { headerCells: heads.length, misalignedRows: bad.slice(0, 3), misalignedCount: bad.length, checkedButNotInHeader: unnamed, portRowsWithPortCutDate: cutDates };
                            if (portCut && !wasOn) { portCut.click(); await waitFor(() => !aligned().heads.includes('Port Cut'), { timeout: 3000 }); }
                            menuBtn.click();
                        }
                        target.el.click();
                        await waitFor(() => !document.querySelector('[data-analysis-drilldown]'), { timeout: 3000 });
                    }
                }
                record(SUITE, 'Analyze vessel list: every shown port column is named in the list\'s one header, and every row (vessel, port call, Weekly average) spans exactly its columns -- checked after adding Port Cut from the menu',
                    !colCheck.problem && colCheck.misalignedCount === 0 && colCheck.checkedButNotInHeader.length === 0 && colCheck.portRowsWithPortCutDate > 0, colCheck);
                record(SUITE, 'Analyze vessel list "By port": each vessel\'s port sub-rows are its legs in the POL table (same POLs and Current Laden) and the vessel row\'s Current Laden above them is their sum',
                    !!sub && sub.vesselsWithPorts > 0 && sub.failCount === 0, sub || { problem: 'no card, no Current Laden (TEU) column, or the port sub-rows never appeared', target: !!target, currentLadenCol: ci });
                byWeekBtn.click();
                await waitFor(() => !Array.from(document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative')).some(c => c.textContent.includes('(by port)')), { timeout: 3000 });
                const back = peaksNow();
                const changed = Object.keys(weekPeaks).filter(k => back[k] !== weekPeaks[k]);
                record(SUITE, 'Analyze "By week" restores every card\'s original Avg Peak Utilization after "By port"',
                    Object.keys(weekPeaks).length > 0 && changed.length === 0, { cards: Object.keys(weekPeaks).length, changed: changed.slice(0, 5) });
            }
        }
        return expected; // per group, per week: { cap, laden, vessels } rebuilt from the table
    };

    await (async function bookingFlashAnalyzeSuite() {
        const SUITE = 'Analyze_BookingFlash';
        if (!(await clickTab('Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        if (!(await openAnalysis())) { record(SUITE, 'Setup: Analyze button found and enabled', false); return; }
        const data = readAnalysisModal();
        if (data.groups.length === 0) { record(SUITE, 'Setup: at least one breakdown card found', false); await closeAnalysis(); return; }
        record(SUITE, 'Setup: modal opened with data', true, { cardCount: data.groups.length });
        checkAnalysisMath(SUITE, record, data);

        // Default week window (2026-09-26): the current sale week and the 3 before it, taken from
        // the source's "Route Date Past 4 Week Flag". Before this it was "the last 4 weeks with any
        // ETD on or before today", which ran ahead of the calendar -- a vessel's ETD comes before
        // its own sale week -- and on 2026-09-26 (current week W36) defaulted to W37-W40. Checked
        // structurally, not against a hardcoded week: the window must END at the current week the
        // modal names and span at most 4 weeks. (On the pinned 8-12 fixture that is W27-W30.)
        (function defaultWindowGuard() {
            const texts = Array.from(document.querySelectorAll('p')).map(p => p.textContent);
            const msg = texts.find(t => /^Showing the last 4 sale weeks through the current week/.test(t)) || '';
            const current = /current week, (\d{4}\/W\d{1,2})/.exec(msg)?.[1] || null;
            const range = texts.map(t => /-week window \(([^)]+)\)/.exec(t)).find(Boolean)?.[1] || '';
            const [first, last] = range.includes(' to ') ? range.split(' to ') : [range, range];
            const wk = (w) => { const m = /(\d{4})\/W(\d{1,2})/.exec(w || ''); return m ? (+m[1]) * 100 + (+m[2]) : NaN; };
            record(SUITE, "Analyze default window = the 4 sale weeks ending at the current week (the data's Past 4 Week Flag), not upcoming weeks",
                !!current && wk(last) === wk(current) && wk(last) - wk(first) <= 3 && msg.includes('Past 4 Week Flag'),
                { current, window: range, message: msg.split(' — ')[0] });
        })();

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

            // Visible-table lookup (not plain querySelector) -- see SUITE 1's comment above
            // for why (POL Booking Flash's own panel stays mounted+hidden across switches).
            const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
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

        await checkWeeklyBarTooltips(SUITE);

        const laneWeeks = await crossCheckAnalysisAgainstTable(SUITE, 'lane');

        // VMS-only weeks keep the chart's week labels in line (2026-10-02, per Kevin). A week whose
        // only row is the VMS placeholder had no "N vsl" line under its label, so that column was
        // one line shorter and its "W##" sat lower than its neighbours'; it now reads "0 vsl". The
        // unfiltered chart never has such a week (some lane always sails), so this narrows to one
        // lane that has one -- picked from the table the cross-check above just rebuilt, not
        // hardcoded -- through the real Lane slicer, then clears the slicer again.
        await (async function vmsWeekAlignmentGuard() {
            const NAME = 'Trend chart: a VMS-only week shows "0 vsl" and every week label stays on one line (one lane selected through the Lane slicer)';
            const pick = Object.entries(laneWeeks || {}).map(([lane, e]) => {
                const weeks = Object.entries(e.weeks);
                const vmsOnly = weeks.filter(([, w]) => w.vessels === 0).map(([wk]) => wk);
                return { lane, vmsOnly, sailing: weeks.length - vmsOnly.length };
            }).find(c => c.vmsOnly.length > 0 && c.sailing > 0);
            const laneBtn = pick && Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === pick.lane && b.className.includes('w-[44px]'));
            if (!pick || !laneBtn) { record(SUITE, NAME, false, { problem: !pick ? 'no lane in the table has both a VMS-only week and a sailing week' : `no Lane slicer button for ${pick.lane}` }); return; }
            const mainRowCount = () => Math.max(0, ...Array.from(document.querySelectorAll('table')).filter(t => t.checkVisibility()).map(t => t.querySelectorAll('tbody tr').length));
            const rowsBefore = mainRowCount();
            await closeAnalysis();
            laneBtn.click();
            const opened = await waitFor(() => !Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Analyze'))?.disabled, { timeout: 5000 }) && await openAnalysis();
            let detail = { lane: pick.lane, vmsOnlyWeeks: pick.vmsOnly, opened };
            if (opened) {
                const allBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All');
                if (allBtn && allBtn.getAttribute('aria-pressed') !== 'true') allBtn.click();
                const readLabels = () => Array.from(document.querySelectorAll('div')).filter(d =>
                    d.className.includes('text-[11px]') && d.className.includes('font-bold') && /^W\d+★?$/.test(d.textContent.trim()));
                const wanted = pick.vmsOnly.map(w => w.split('/')[1] || w);
                await waitFor(() => wanted.every(wk => readLabels().some(d => d.textContent.trim().replace('★', '') === wk)), { timeout: 3000 });
                const labels = readLabels();
                const vslOf = (wk) => labels.find(d => d.textContent.trim().replace('★', '') === wk)?.nextElementSibling?.textContent.trim() || null;
                const tops = [...new Set(labels.map(d => Math.round(d.getBoundingClientRect().top)))];
                detail = { ...detail, weeksShown: labels.length, vmsWeekLines: wanted.map(wk => ({ week: wk, line: vslOf(wk) })), distinctLabelTops: tops };
                detail.pass = labels.length > 1 && tops.length === 1 && wanted.every(wk => vslOf(wk) === '0 vsl');
                await closeAnalysis();
            }
            laneBtn.click(); // clear the slicer so later suites see the unfiltered data
            detail.slicerCleared = await waitFor(() => mainRowCount() === rowsBefore, { timeout: 5000 });
            record(SUITE, NAME, !!detail.pass && detail.slicerCleared, detail);
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

        // POL-scoped equivalent of Suite 5's departedStarGuard above, added 2026-09-11
        // alongside the row.coastalEtd fix in the app's "Departed" trend-chart
        // computation (fix + its regression coverage together, per AGENTS.md's
        // one-commit-per-confirmed-bug rule for a fix and its test update). Before
        // this, SUITE 6 had zero coverage of the chart's departed-star logic --
        // checkAnalysisMath doesn't touch departed/ETD at all, so the bug this fixes
        // (the POL-scoped chart reading the voyage-wide "ETD Last Port" instead of
        // the POL-specific "Coastal ETD", both cross-checked live against VVD
        // NOCT0082W's 2026/W32 in Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx)
        // shipped unnoticed. Same independent-recomputation approach as Suite 5's
        // guard (re-derives expected departed status straight from this table's own
        // rendered cells, not from the app's computed state), but bucketed by POL
        // instead of Lane, and reading the "Coastal ETD" column (data-autofit-col=
        // "coastalEtd" / headerCell('coastalEtd', 'Coastal ETD')) instead of "ETD
        // Last Port" -- the two are identical per VVD on a single-POL voyage but
        // diverge exactly on a multi-POL voyage where each POL's own leg departs on
        // a different day, which is the scenario this fix addresses.
        await (async function polDepartedStarGuard() {
            const countChartWeeks = () => Array.from(document.querySelectorAll('div')).filter(d =>
                d.className.includes('text-[11px]') && d.className.includes('font-bold') && /^W\d+★?$/.test(d.textContent.trim())
            ).length;
            const weeksBeforeClick = countChartWeeks();
            const allWeeksBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All');
            if (allWeeksBtn) { allWeeksBtn.click(); await waitFor(() => countChartWeeks() !== weeksBeforeClick, { timeout: 2000 }); }

            // Visible-table lookup (not plain querySelector) -- see SUITE 1's comment above
            // for why (POL Booking Flash's own panel stays mounted+hidden across switches).
            const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
            if (!table) return;
            const theadRows = Array.from(table.querySelectorAll('thead tr'));
            const labelRow = theadRows[1] || theadRows[0];
            const headers = Array.from(labelRow.children).map(th => th.textContent.replace(/[▲▼]/g, '').trim());
            const saleWeekIdx = headers.findIndex(h => h.replace(/\s+/g, '') === 'SalesWeek');
            const etdIdx = headers.findIndex(h => h.replace(/\s+/g, '') === 'CoastalETD');
            const polIdx = headers.findIndex(h => h.trim() === 'POL');
            if (saleWeekIdx < 0 || etdIdx < 0 || polIdx < 0) return;
            // Colspan-aware fromEnd, same technique as Suite 5's own header parsing
            // (this table's Inland/Port Activity group headers are colSpan=3 too).
            const spans = Array.from(labelRow.children).map(th => parseInt(th.getAttribute('colspan') || '1', 10));
            const totalRealCols = spans.reduce((a, b) => a + b, 0);
            let cumulative = 0;
            const fromEndByIdx = spans.map(span => { const fromEnd = totalRealCols - cumulative; cumulative += span; return fromEnd; });
            const saleWeekFromEnd = fromEndByIdx[saleWeekIdx];
            const etdFromEnd = fromEndByIdx[etdIdx];
            const polFromEnd = fromEndByIdx[polIdx];

            // Unlike Lane on the Booking Flash tab, POL is never rowSpan-merged in
            // this table (only Trade/Sub Trade/Lane are, per PolTableRow's row.showTrade/
            // row.showSub/row.showLane) -- every data row carries its own POL cell
            // directly, so (unlike Suite 5's lastLane carry-forward) no forward-fill
            // tracking is needed here; the fromEnd offset alone locates it in every row.
            const perRow = [];
            Array.from(table.querySelectorAll('tbody tr')).forEach(tr => {
                const tds = Array.from(tr.children);
                const shift = headers.length - tds.length;
                if (shift < 0 || shift > 3) return; // not a normal data row (e.g. "no data" placeholder)
                // Blank POL is its own real bucket, not a row to skip -- the app's own
                // groupBy keys every row by `row[groupKey] || '(blank)'` (see the app's
                // "blank-group row" comment above laneSummaries), and on this tab a
                // VMS placeholder row (vvd === 'VMS', a not-yet-nominated future
                // sailing) genuinely has a blank POL (and blank Coastal ETD/ETD Last
                // Port) while still carrying a real Lane -- confirmed live via
                // Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx. Requiring `pol` to be
                // truthy here would silently drop those rows from the AND-across-POLs
                // computation below and disagree with the app, which still ANDs in
                // that blank bucket (and so correctly never stars a week that still has
                // an un-departed VMS placeholder in it).
                const saleWeekText = tds[tds.length - saleWeekFromEnd]?.textContent.trim();
                if (!saleWeekText) return;
                const pol = tds[tds.length - polFromEnd]?.textContent.trim() || '(blank)';
                const etdText = tds[tds.length - etdFromEnd]?.textContent.trim();
                perRow.push({ pol, saleWeek: saleWeekText, etdText });
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

            // Bucket by (POL, week suffix) -- OR across rows in the SAME POL's own
            // bucket, then AND across POLs present that week, mirroring Suite 5's
            // lane-level rule exactly (see Item 22, 2026-09-04/06) but on the POL grain.
            const polWeekDeparted = {};
            perRow.forEach(({ pol, saleWeek, etdText }) => {
                const weekKey = saleWeek.split('/')[1] || saleWeek;
                const key = `${pol}|${weekKey}`;
                if (!(key in polWeekDeparted)) polWeekDeparted[key] = false;
                if (isDeparted(etdText)) polWeekDeparted[key] = true;
            });
            const expectedWeekDeparted = {};
            Object.entries(polWeekDeparted).forEach(([key, departed]) => {
                const weekKey = key.split('|')[1];
                if (!(weekKey in expectedWeekDeparted)) expectedWeekDeparted[weekKey] = true;
                if (!departed) expectedWeekDeparted[weekKey] = false; // AND across POLs
            });

            const chartWeeks = Array.from(document.querySelectorAll('div')).filter(d =>
                d.className.includes('text-[11px]') && d.className.includes('font-bold') && /^W\d+★?$/.test(d.textContent.trim())
            ).map(d => ({ week: d.textContent.trim().replace('★', ''), hasStar: d.textContent.includes('★') }));

            const mismatches = chartWeeks
                .filter(({ week }) => week in expectedWeekDeparted)
                .map(({ week, hasStar }) => ({ week, hasStar, expected: expectedWeekDeparted[week] }))
                .filter(({ hasStar, expected }) => hasStar !== expected);

            record(SUITE, '"Departed" star (POL-scoped) reflects AND across every POL present that week, independently re-derived from raw Coastal ETD data',
                chartWeeks.length > 0 && mismatches.length === 0,
                { weeksChecked: chartWeeks.length, mismatches: mismatches.slice(0, 10) });
        })();

        await checkWeeklyBarTooltips(SUITE);

        await crossCheckAnalysisAgainstTable(SUITE, 'pol');
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
        // Visible-table lookup (not plain querySelector) -- see SUITE 1's comment above
        // for why (POL Booking Flash's own panel stays mounted+hidden across switches).
        const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
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
    // any audit"). Class F guards below, plus (2026-09-15) real regression
    // coverage for the two newest TRACKED_FIELDS entries, "1st POL Cutoff"
    // and "ETD Last Port" (added the same day to compareData's useMemo).
    //
    // SELF-UPLOADING as of 2026-09-15 -- this used to be the one suite in
    // this file that didn't upload a file itself: this tab renders nothing
    // until BOTH a main file AND a second "old" comparison file are loaded,
    // and the "old" file needs to be a genuinely different export to
    // produce a real diff, which a data-agnostic suite couldn't assume
    // access to -- so every check below used to only fire when whoever
    // invoked the suite already happened to have both loaded, and silently
    // skipped otherwise. That's exactly why the two new date fields above
    // had ZERO regression coverage despite being live in TRACKED_FIELDS:
    // nobody's normal test-running flow uploads two files. Fixed by having
    // this suite load two purpose-built fixtures itself --
    // tests/fixtures/compare_new.xlsx (used as the MAIN/current upload,
    // via the header's own fileInputRef) and tests/fixtures/compare_old.xlsx
    // (used as the "old" comparison file, via this tab's own
    // oldFileInputRef) -- both real, near-complete copies of the real
    // sample file (Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx) with
    // exactly 3 cells changed between them, keyed by vvd|pol (matching
    // compareData's own keyOf()):
    //   Row A (VVD R2JT0018W / POL USLAX06): "Route Date Cut/off Date"
    //     6/29/26 (old) -> 6/30/26 (new) -- a genuine CHANGE. ETD unchanged
    //     (7/2/26 both sides).
    //   Row B (VVD MXQT0104W / POL USLAX01): "Route Date Last Port ETD
    //     Date" 7/4/26 (old) -> blank (new) -- populated-to-blank. Cutoff
    //     unchanged (6/26/26 both sides).
    //   Row C (VVD YMKT0113W / POL USTIW02): same ETD field blank (old) ->
    //     7/12/26 (new) -- blank-to-populated. Cutoff unchanged (7/2/26
    //     both sides).
    // Every other cell in both fixtures is identical to the real source
    // file, so comparing them should surface EXACTLY these 3 changes and
    // nothing else -- see the "exactly 3" check at the end of this suite.
    //
    // No app changes were needed to make this possible: both <input
    // type=file> elements (fileInputRef/oldFileInputRef) are unconditionally
    // present in the DOM from the app's very first render (declared
    // back-to-back right after the top-level wrapper <div>, before any
    // activeTab-conditional block -- see the app's own JSX), so they can be
    // driven regardless of which tab is active. Simulated the same way
    // HANDOFF's Live-testing method documents for every other upload in
    // this project (no other suite in this file has needed to do this
    // itself before now, since normally the CALLER uploads the one main
    // file up front): fetch() the fixture, build a File/DataTransfer, assign
    // it to the input's .files, dispatch a real 'change' event.
    //
    // fetch() of a local file only resolves under a genuine HTTP origin --
    // under a bare file:// origin (confirmed live: Chromium blocks it, no
    // --allow-file-access-from-files flag) it always fails. AGENTS.md's own
    // required method is explicit that this suite must be run over local
    // HTTP, never file:// (see HANDOFF's Live-testing method POINT 1 --
    // "Serve the directory over local HTTP... not file://" -- not point 6,
    // which is about automated multi-step scripts being flaky, a different
    // topic; an earlier version of this comment cited the wrong point and
    // also soft-pedaled this as AGENTS.md merely "preferring" HTTP, when the
    // rule is an explicit "never"). Self-upload only works correctly under
    // that documented method; under file:// it fails cleanly and this suite
    // SKIPs its own checks below rather than reporting a false failure for
    // an environment reason unrelated to the app (see the SKIP branch).
    //
    // 2026-09-15 follow-up (code review): self-upload is gated behind
    // `alreadyHasCompareData` below -- it never runs if a caller already
    // uploaded both files themselves (this suite's original, pre-2026-09-15
    // behavior), so it can't clobber real, already-loaded data. When it does
    // run, it still touches the SAME app state a real upload would
    // (rawRows/oldRawRows, and the schedule-change-warning baseline via
    // liveRawRowsRef/csvApplySeqRef) with no restoration afterward -- fine
    // for a disposable automated run, but worth knowing if this suite is
    // ever pasted into a long-lived tab with real data NOT already loaded
    // (see the console.warn emitted right before self-upload).
    // ============================================================
    await (async function compareTabSuite() {
        const SUITE = 'Compare';
        if (!(await clickTab('Compare'))) { record(SUITE, 'Setup: tab button found', false); return; }

        const findNotableHeading = () => Array.from(document.querySelectorAll('h3'))
            .find(h => h.textContent.trim().startsWith('Notable Vessel Changes'));
        // "Avg Utilization" since 2026-09-26 (was "Overall Utilization") -- the tiles now carry the
        // Analyze modal's Overall Snapshot labels, see the alignment checks at the end of this suite.
        const utilMatchOf = () => document.body.innerText.match(/AVG UTILIZATION[\s\S]{0,80}?New:\s*(-?\d+)%/i);
        // Every KPI tile's Old/New value, keyed by its label (Vessels, Avg Utilization, ...). Read
        // from the tile's own data-compare-kpi / data-old / data-new attributes -- the exact rounded
        // values it displays -- not from class names or display text (code review: a class tweak
        // would otherwise turn every tile lookup into undefined and look like a data regression).
        const readCompareTiles = () => {
            const tiles = {};
            document.querySelectorAll('[data-compare-kpi]').forEach(el => {
                tiles[el.getAttribute('data-compare-kpi')] = { old: Number(el.getAttribute('data-old')), cur: Number(el.getAttribute('data-new')) };
            });
            return tiles;
        };

        // 2026-09-15 follow-up (found via code review, not live testing): the first version of
        // this self-upload unconditionally replaced whatever was currently loaded. That's a real
        // hazard this suite never had before -- AGENTS.md documents running this file by pasting
        // it into a live browser console, potentially in the same tab someone (Kevin) is using
        // for real work. Self-uploading over a caller's already-loaded real data would silently
        // destroy it with no way to restore it (only already-parsed rows, never original file
        // bytes, are ever available here to re-upload from). Fixed by checking FIRST whether
        // Compare data is already rendered -- if so, this is a caller who already uploaded both
        // files themselves (this suite's original, pre-2026-09-15 behavior), and self-upload is
        // skipped entirely; only the generic checks below run, against whatever is already there.
        const alreadyHasCompareData = !!findNotableHeading() || !!utilMatchOf();
        let usingOwnFixtures = false;

        if (!alreadyHasCompareData) {
            // Upload one fixture into one <input type=file>: fetch its bytes, wrap them in a
            // File via a DataTransfer (the standard way to programmatically populate a file
            // input -- assigning .value directly is blocked by browsers), and dispatch the same
            // 'change' event the app's own onChange handlers listen for. Returns a reason string
            // alongside ok so a genuinely broken fixture path/server is distinguishable from the
            // expected file:// CORS block (2026-09-15 follow-up: a bare `catch (e) { return
            // false; }` made every failure mode -- network error, 404, wrong path, CORS -- look
            // identical, so a moved/renamed fixture would silently report the same benign-looking
            // "SKIP" as the expected file:// case).
            const uploadFixtureFile = async (input, path) => {
                if (!input) return { ok: false, reason: 'no matching <input type=file> found on the page' };
                let resp;
                try {
                    resp = await fetch(path);
                } catch (e) {
                    return { ok: false, reason: `fetch() threw: ${e.message} (expected under a bare file:// origin -- Chromium blocks fetch() of a local file there)` };
                }
                if (!resp.ok) return { ok: false, reason: `fetch() returned HTTP ${resp.status} for ${path}` };
                const blob = await resp.blob();
                const fileName = path.split('/').pop(); // derive from path -- keeps one source of truth instead of a second, separately-passed name that could drift from it
                const file = new File([blob], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true, reason: null };
            };
            // Root-relative paths so this resolves the same way regardless of which
            // Booking_flash_report_na_*.html happens to be the current live file (see AGENTS.md's
            // syntax-check section for why that filename must never be hardcoded) -- both it and
            // tests/fixtures/ hang off the same repo-root HTTP server (see README's "Running it
            // locally"). fileInputs[0]/[1] are positional, not queried by ref (refs aren't visible
            // from outside React) -- reliable here because both inputs are declared in that fixed
            // order (main upload, then old-file upload) and neither is ever conditionally
            // rendered. Both fetches are independent (disjoint state, disjoint refs, separate
            // FileReader instances -- see processFile/processOldFile), so run them concurrently.
            console.warn(`⚠️ [${SUITE}] About to self-upload synthetic test fixtures (tests/fixtures/compare_*.xlsx) into the app's main + old-file inputs. This is only reached when nothing is already loaded (see alreadyHasCompareData above), so it can't destroy a caller's real data -- but it DOES also reset this tab's schedule-change-warning baseline (liveRawRowsRef/csvApplySeqRef), so a long-lived tab running this suite may show a "Schedule Change Detected" banner on its next auto-refresh poll afterward. Nothing is restored.`);
            const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
            const [main, old] = await Promise.all([
                uploadFixtureFile(fileInputs[0], '/tests/fixtures/compare_new.xlsx'),
                uploadFixtureFile(fileInputs[1], '/tests/fixtures/compare_old.xlsx'),
            ]);

            if (main.ok && old.ok) {
                usingOwnFixtures = true;
                // Wait for OUR OWN fixture's filename specifically, not just "some heading exists"
                // -- alreadyHasCompareData being false already rules out a stale prior render, but
                // this is also robust against a slow FileReader -> XLSX.read -> setState chain that
                // hasn't finished yet (a generic heading/regex check could otherwise pass against
                // stale intermediate DOM).
                const oldFixtureRendered = await waitFor(() => document.body.innerText.includes('compare_old.xlsx'), { timeout: 10000 });
                record(SUITE, 'Setup: Compare view rendered after self-uploading both fixtures', oldFixtureRendered);
                if (!oldFixtureRendered) return;
            } else if (main.ok !== old.ok) {
                // Partial failure is NOT a benign skip: whichever upload succeeded already fired a
                // real 'change' event and started mutating live app state (rawRows/oldRawRows),
                // but the Compare view can never fully render with only one side loaded -- a real
                // problem, not "nothing happened."
                record(SUITE, 'Setup: both Compare fixtures uploaded (partial failure -- live app state was already mutated by whichever upload succeeded)',
                    false, { mainOk: main.ok, mainReason: main.reason, oldOk: old.ok, oldReason: old.reason });
                return;
            } else {
                // Both failed before touching any input (see uploadFixtureFile: fetch() is
                // checked before any DOM mutation) -- a true no-op, safe to treat as a skip.
                console.log(`ℹ️ SKIP — [${SUITE}] Self-upload of both Compare fixtures didn't complete (main: ${main.reason}; old: ${old.reason}). The Compare-tab checks below only run when this suite is served over local HTTP (where the fetch succeeds), or when a caller has already uploaded both an old and current file before invoking this suite.`);
                return;
            }
        }

        const utilMatch = utilMatchOf();
        record(SUITE, 'Setup: "Avg Utilization" KPI tile found', !!utilMatch);
        if (!utilMatch) return;
        const newUtilz = parseInt(utilMatch[1], 10);
        // 2026-08-26 bug: "Overall Utilization" divided a multi-week CUMULATIVE
        // booking sum (ladenSum, every row across ~17 weeks) by each lane's single
        // PEAK-week capacity summed across lanes (maxLdnSum) -- a temporal-scope
        // mismatch, not a real reading. Confirmed 394-396% on real data. 150% is
        // deliberately generous (real weekly utilization is well under 100%) while
        // nowhere near the bug's actual scale -- bounds the failure mode without
        // hardcoding an exact "correct" number that would break on a future refresh.
        const SANE_CEILING_PERCENT = 150;
        record(SUITE, `Class F: "Avg Utilization" stays within a sane ceiling (${SANE_CEILING_PERCENT}%, temporal-scope-mismatch fingerprint)`,
            !isNaN(newUtilz) && newUtilz >= 0 && newUtilz <= SANE_CEILING_PERCENT,
            { newUtilz });

        // 2026-09-26: the measure tiles must reconcile with each other on BOTH sides -- Utilization
        // is Laden / Max Laden and Shortfall is Laden - Max Laden, the same algebra the Analyze modal
        // states. The tiles they replaced could not pass this: "Total Max Laden" was each lane's
        // single largest vessel and "Total Booked TEU" summed every week in the file (Class G), so
        // Booked / Max Laden read ~396% next to a 32% utilization tile. Data-agnostic, so it runs on
        // whatever pair is loaded. +/-1 on each for display rounding.
        {
            const t = readCompareTiles();
            const sides = ['old', 'cur'].map(side => {
                const util = t['Avg Utilization']?.[side], cap = t['Avg Max Laden']?.[side];
                const laden = t['Avg Wkly Laden']?.[side], shortfall = t['Avg Wkly Shortfall']?.[side];
                const ok = [util, cap, laden, shortfall].every(v => typeof v === 'number') &&
                    (cap > 0 ? Math.abs(util - (laden / cap) * 100) <= 1 : util === 0) &&
                    Math.abs(shortfall - (laden - cap)) <= 1;
                return { side, util, cap, laden, shortfall, ok };
            });
            record(SUITE, 'Tiles reconcile on both sides: Avg Utilization = Avg Wkly Laden / Avg Max Laden, Avg Wkly Shortfall = Laden - Max Laden',
                sides.every(x => x.ok), { sides });
        }

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
        // labeled "Vessels". 2026-09-26: the tile now counts the sale weeks BOTH files cover
        // (like every other tile) while the header line counts each whole file, so the
        // invariant is tile <= header on each side -- a window is a subset of its file, and
        // the pre-fix per-leg count (964 legs vs 374 vessels) breaks it immediately. Equality
        // on the fixtures, which cover the same weeks, is the 374 check just below.
        const vesselTiles = readCompareTiles()['Vessels'];
        const comparingMatch = document.body.innerText.match(/Comparing\s+\S[\s\S]*?\((\d[\d,]*)\s+vessels\)[\s\S]*?\((\d[\d,]*)\s+vessels/);
        if (vesselTiles && comparingMatch) {
            const headerOld = parseInt(comparingMatch[1].replace(/,/g, ''), 10);
            const headerNew = parseInt(comparingMatch[2].replace(/,/g, ''), 10);
            record(SUITE, '"Vessels" tile (shared weeks) never exceeds the header line\'s whole-file vessel count, either side',
                vesselTiles.old <= headerOld && vesselTiles.cur <= headerNew && vesselTiles.old > 0 && vesselTiles.cur > 0,
                { tileOld: vesselTiles.old, tileNew: vesselTiles.cur, headerOld, headerNew });
        }
        // 2026-09-26: the distinct-VVD count must not count the "VMS" placeholder VVD (a
        // not-yet-nominated sailing) as a vessel -- it did, so every VMS row collapsed into one
        // phantom vessel and the tile read 375. Both compare fixtures hold exactly 374 distinct
        // real VVDs plus VMS rows (counted from the xlsx files, not from what the app rendered),
        // so this is only meaningful against OUR OWN fixtures.
        if (usingOwnFixtures) {
            const tileOld = vesselTiles ? vesselTiles.old : null;
            const tileNew = vesselTiles ? vesselTiles.cur : null;
            record(SUITE, '"Vessels" tile excludes the VMS placeholder VVD (fixtures: 374 real vessels each side)',
                tileOld === 374 && tileNew === 374, { tileOld, tileNew, expected: 374 });
        }

        // ---- 2026-09-15: real coverage for the two newest TRACKED_FIELDS entries, "1st POL
        // Cutoff" and "ETD Last Port" -- see this suite's own header comment for the full
        // writeup of the 3 known fixture mutations (Rows A/B/C) this checks against. Only
        // meaningful against OUR OWN fixtures (the specific VVDs/values below are hardcoded to
        // match them) -- skip gracefully if a caller's real data is what's actually loaded
        // instead (alreadyHasCompareData was true above), since real data won't contain these
        // synthetic VVDs.
        if (usingOwnFixtures) {
            // Locate each row by its own VVD+POL cells (matching compareData's real vvd|pol
            // key) rather than assuming a fixed row order in compareData.changed, so this stays
            // correct regardless of that array's own ordering.
            const changeTable = Array.from(document.querySelectorAll('table')).find(t => {
                const headers = Array.from(t.querySelectorAll('thead th')).map(th => th.textContent.trim());
                return headers.includes('VVD') && headers.includes('POL') && headers.includes('What Changed');
            });
            const changeTableHeaders = changeTable ? Array.from(changeTable.querySelectorAll('thead th')).map(th => th.textContent.trim()) : [];
            const vvdIdx = changeTableHeaders.indexOf('VVD');
            const polIdx = changeTableHeaders.indexOf('POL');
            const whatChangedIdx = changeTableHeaders.indexOf('What Changed');
            const findChangeRowText = (vvd, pol) => {
                if (!changeTable) return null;
                const row = Array.from(changeTable.querySelectorAll('tbody tr')).find(tr => {
                    const cells = Array.from(tr.querySelectorAll('td'));
                    return cells[vvdIdx] && cells[vvdIdx].textContent.trim() === vvd &&
                           cells[polIdx] && cells[polIdx].textContent.trim() === pol;
                });
                if (!row) return null;
                const cells = Array.from(row.querySelectorAll('td'));
                return cells[whatChangedIdx] ? cells[whatChangedIdx].textContent : null;
            };
            record(SUITE, 'Setup: "Notable Vessel Changes" table found (VVD/POL/What Changed columns)', !!changeTable);

            // Row A -- cutoff CHANGE (6/29/26 -> 6/30/26), ETD unchanged both sides at 7/2/26.
            // This is the plain "both sides populated, value actually differs" case for the new
            // 'cutoff' TRACKED_FIELDS entry -- confirms it reads "Route Date Cut/off Date" (NOT
            // the decoy "Route Date POL Cut/off Date" column that feeds the unrelated
            // 'portCut'/"Port Cut" field -- see DATA_ARCHITECTURE.md's Class E) and renders via
            // formatDateOnly as "M/D/YY".
            const rowAText = findChangeRowText('R2JT0018W', 'USLAX06');
            record(SUITE, 'Cutoff change (Row A, VVD R2JT0018W / POL USLAX06) renders "1st POL Cutoff: 6/29/26 → 6/30/26"',
                !!rowAText && /1st POL Cutoff:\s*6\/29\/26\s*→\s*6\/30\/26/.test(rowAText),
                { rowAText });

            // Row B -- ETD populated -> blank (7/4/26 -> blank), cutoff unchanged both sides at
            // 6/26/26. formatFieldVal's date branch falls back to '—' for a blank value by
            // design (see its own comment: "so a date going missing shows as '... -> —' in
            // Notable Vessel Changes, not a blank cell") -- assert the actual em-dash text
            // renders, not a blank or omitted diff line (a diff line disappearing entirely, or
            // rendering as "7/4/26 -> " with nothing after the arrow, would both be real
            // regressions this needs to catch).
            const rowBText = findChangeRowText('MXQT0104W', 'USLAX01');
            record(SUITE, 'ETD populated→blank (Row B, VVD MXQT0104W / POL USLAX01) renders "ETD Last Port: 7/4/26 → —" (not blank/omitted)',
                !!rowBText && /ETD Last Port:\s*7\/4\/26\s*→\s*—/.test(rowBText),
                { rowBText });

            // Row C -- ETD blank -> populated (blank -> 7/12/26), cutoff unchanged both sides at
            // 7/2/26. The mirror-image case of Row B -- confirms the '—' fallback also applies
            // correctly on the OLD side, not just the new side.
            const rowCText = findChangeRowText('YMKT0113W', 'USTIW02');
            record(SUITE, 'ETD blank→populated (Row C, VVD YMKT0113W / POL USTIW02) renders "ETD Last Port: — → 7/12/26"',
                !!rowCText && /ETD Last Port:\s*—\s*→\s*7\/12\/26/.test(rowCText),
                { rowCText });

            // Exactly 3 total notable changes: guards against the 3 fixture mutations above
            // accidentally producing extra or fewer diffs than expected -- e.g. from a stale
            // getVal() alias match (the Class E landmine noted above) causing some OTHER
            // vessel's unrelated field to also register as "changed", or one of these 3 rows
            // registering more than one diff because the wrong source column was actually read.
            // Every other cell in both fixtures is identical to the real source file, so 3 is
            // not a guess -- it's the exact, verified count of real differences between the two
            // fixtures.
            const headingEl = findNotableHeading();
            const countMatch = headingEl ? headingEl.textContent.match(/\((\d+)\)/) : null;
            const changeCount = countMatch ? parseInt(countMatch[1], 10) : null;
            record(SUITE, 'Exactly 3 notable changes are shown (no extra/missing diffs from an alias landmine or unrelated data drift)',
                changeCount === 3, { changeCount });

            // ---- 2026-09-26, per Kevin: "align [Compare] with the Analyze button". The measure tiles
            // now come from the same shared functions as the Analyze modal's Overall Snapshot
            // (buildSailingBuckets + summarizeSailingGroups, via compareKpiSnapshots). Two checks:
            //
            // (1) Exact values, counted from the fixture xlsx files by an independent script -- not
            //     from what the app rendered: sailings per (lane, week, VVD), capacity MAX per sailing
            //     and SUMMED per week, VMS-only weeks out of the divisor, per-lane weekly averages
            //     summed across lanes. The fixtures differ only in 3 date cells, so both sides are
            //     equal. Pre-alignment the same tiles read Overall Utilization 32%, Total Max Laden
            //     71,258, Total Booked TEU 282,414.
            const EXPECTED_TILES = { 'Avg Utilization': 34, 'Avg Max Laden': 61943, 'Avg Wkly Laden': 21010, 'Avg Wkly Shortfall': -40933 };
            const compareTiles = readCompareTiles();
            const tileMismatches = Object.entries(EXPECTED_TILES)
                .filter(([label, v]) => compareTiles[label]?.old !== v || compareTiles[label]?.cur !== v)
                .map(([label, v]) => ({ label, expected: v, got: compareTiles[label] || null }));
            record(SUITE, 'Measure tiles match an independent recompute from the fixtures (34% / 61,943 / 21,010 / -40,933 both sides)',
                tileMismatches.length === 0, { tileMismatches });

            // (2) The alignment itself: Compare's New side must equal what the Analyze modal shows for
            //     the same rows and weeks -- Booking Flash tab, same slicers (the suite clears them
            //     at setup), and the weeks Compare averaged over. The fixtures cover the same 17
            //     weeks, so that is Analyze's "All"; the check also asserts the two week counts
            //     match, so it cannot pass by comparing different windows. Read live from the modal,
            //     so it fails if either side ever stops using the shared calculation.
            //     The modal's week window needs no restoring: closeAnalysisModal resets it to the
            //     default on every close (an earlier version clicked "Reset" before closing, which
            //     did nothing the close didn't, and raced the close -- code review). "All" is looked
            //     up inside the modal only, so a slicer's own "All" button can never be clicked.
            const compareWindow = Number(document.querySelector('[data-compare-window]')?.getAttribute('data-compare-window') || NaN);
            let analyzeOverall = null, analyzeWeeks = NaN, allPressed = false;
            if ((await clickTab('Booking Flash')) && (await openAnalysis())) {
                const modalRoot = () => {
                    let el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Close Analysis');
                    while (el && !String(el.className || '').split(/\s+/).includes('fixed')) el = el.parentElement;
                    return el;
                };
                const allBtnOf = () => { const root = modalRoot(); return root ? Array.from(root.querySelectorAll('button')).find(b => b.textContent.trim() === 'All') : null; };
                if (allBtnOf() && allBtnOf().getAttribute('aria-pressed') !== 'true') allBtnOf().click();
                allPressed = await waitFor(() => allBtnOf()?.getAttribute('aria-pressed') === 'true', { timeout: 3000 });
                if (allPressed) {
                    await new Promise(r => setTimeout(r, 300));
                    analyzeOverall = readAnalysisModal().overall;
                    analyzeWeeks = Number((/(\d+)-week window/.exec(modalRoot()?.textContent || '') || [])[1]);
                }
                await closeAnalysis();
            }
            await clickTab('Compare');
            const pairs = [['Avg Utilization', 'utilization'], ['Avg Max Laden', 'capacity'], ['Avg Wkly Laden', 'laden'], ['Avg Wkly Shortfall', 'shortfall']]
                .map(([label, key]) => ({ label, compareNew: compareTiles[label]?.cur ?? null, analyze: analyzeOverall ? analyzeOverall[key] : null }));
            record(SUITE, "Compare's New side equals the Analyze modal's Overall Snapshot over the same weeks (Booking Flash) -- same shared calculation",
                allPressed && !!analyzeOverall && compareWindow === analyzeWeeks && pairs.every(x => x.compareNew !== null && x.compareNew === x.analyze),
                { allPressed, compareWindow, analyzeWeeks, pairs });
        }
    })();

    // ============================================================
    // SUITE 9: Historical Data (added 2026-09-06; fixture-pinning rewrite 2026-09-16 -- same
    // defect class and same fix shape as the Sector Summary fix, commit "Pin the Sector check
    // to a committed fixture, add live-path invariants". See tests/fixtures/historical_data_
    // 2026-08-24_to_2026-08-26.csv, AGENTS.md check 4's Historical Data paragraph for the
    // pinning recipe, and HANDOFF.md for the full writeup.)
    //
    // Everything about this suite (fetching the archive, viewing a date, Back to Live) depends
    // on HISTORICAL_DATA_CSV_URL (a real published Google Sheet) actually responding -- true
    // from Kevin's own browser, but this sandbox's headless Chromium has repeatedly been
    // confirmed unable to reach docs.google.com directly even though host-level curl succeeds
    // (a sandbox networking quirk, not an app bug).
    //
    // THE DEFECT: the suite used to poll for EITHER date buttons (fetch succeeded) or an error
    // banner (fetch failed) for up to 8 seconds (since raised to 30s -- see below), and if the
    // wait simply timed out -- neither ever appeared -- it closed the popover and did a silent
    // `return` with ZERO record() calls, exactly like this section's own header used to describe
    // as "gracefully skips ... whenever the archive isn't actually reachable." That wording
    // quietly conflated two very different situations:
    //   (a) CONFIRMED unreachable (a real error banner rendered, e.g. this sandbox's TLS/DNS
    //       block) -- a definite negative, where a silent skip is the right call, same
    //       convention as the Compare suite's own "both fixture uploads failed before
    //       touching state" no-op above.
    //   (b) UNCONFIRMED -- the wait simply ran out with no error and no dates, which could mean
    //       (a) just hadn't surfaced yet, OR it could mean the archive is reachable but merely
    //       SLOW to respond (a real Google Sheet under normal network conditions, not this
    //       sandbox's synthetic block). Case (b) used to vanish identically to case (a): all 4
    //       potential checks in this suite disappear from the report with zero signal, making a
    //       "68/68, all green" run indistinguishable from a run where a slow-but-working
    //       archive silently dropped 4 checks. Exactly the failure mode AGENTS.md's "check the
    //       executed-check count, not the pass rate" section exists to catch.
    //
    // THE FIX, mirroring the Sector fix's own two-part shape (pin the input, AND make the
    // live/unpinned path more accountable -- it did NOT just loosen or remove the risky check):
    //   1. PIN THE INPUT. When window.__BFRT_HISTORICAL_FIXTURE__ is set (see AGENTS.md check
    //      4), the runner has routed HISTORICAL_DATA_CSV_URL to a small committed fixture
    //      instead of the live Sheet. A local fixture response is effectively instant, which
    //      eliminates the race against the wait timeout entirely for the path this suite is
    //      actually exercised on day to day: the wait always resolves via the
    //      dateButtonSelector() branch, nowhere near the wait budget, never the ambiguous
    //      timeout branch below.
    //   2. MAKE THE AMBIGUOUS UNPINNED CASE LOUD, not silent. (a) and (b) above are now told
    //      apart by checking errorBannerVisible() specifically instead of just "no date buttons
    //      yet": a real error banner is still treated as confirmed-unreachable and still skips
    //      silently (that legitimate, documented skip is NOT removed -- see the branch below),
    //      but a timeout with NEITHER dates NOR an error banner now records an explicit FAILING
    //      check instead of vanishing. This mirrors the Compare suite's own "partial failure is
    //      NOT a benign skip" rule a few hundred lines above: an unconfirmed/ambiguous state
    //      gets a loud record(), only a clean, positively-confirmed no-op gets to skip silently.
    // THE TIMEOUT VALUE ITSELF moved from 8s to 30s the same day this suite's fixture-pinning
    // rewrite landed, but for an unrelated, orthogonal reason: a separate performance change
    // (see AGENTS.md's Server-backed-preferences/perf writeup) made the historical archive load
    // LAZILY -- the fetch now starts on this suite's own click below instead of during an eager
    // page-mount effect -- so on a genuinely live, unpinned run the wait must now cover the real
    // network fetch and (when a Web Worker can be spun up -- see parseHistoricalArchiveInWorker
    // in the app) worker startup, or (when it can't) the full main-thread parse fallback, none of
    // which the old 8s budget was ever tested against. Verified live (see HANDOFF.md) that a
    // pinned local fixture still resolves in well under 100ms regardless, so 30s remains a
    // generous, effectively irrelevant ceiling on the pinned path -- only the genuinely-ambiguous
    // unpinned case actually depends on the larger budget.
    // ============================================================
    await (async function historicalDataSuite() {
        const SUITE = 'Historical_Data';
        const histBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('🗓️ Historical Data'));
        if (!histBtn) return; // feature not present in this build at all
        histBtn.click();
        // Popover shows either date buttons (fetch succeeded) or an error banner
        // (fetch failed/unreachable) -- poll for either rather than a fixed delay.
        //
        // 2026-09-16: scoped to the POPOVER ITSELF (found via its own "Close historical data
        // panel" close button, walked up to the nearest ancestor still carrying the popover's
        // `absolute` positioning class -- resilient to markup depth changes, unlike a fixed
        // number of .parentElement hops), not the whole document. The unscoped version used to
        // scan every <div> on the page for these phrases -- harmless when this suite runs in
        // isolation, but this app ALSO shows its own unrelated "Couldn't load data
        // automatically ..." banner (autoFetchError, ~line 4252) whenever CSV_SOURCE_URL's
        // separate auto-refresh fetch fails, which contains the same "Couldn't load" substring.
        // Confirmed live: in a sandbox where CSV_SOURCE_URL is *also* unreachable (this
        // project's own agent sandbox, unrelated to whether the historical archive specifically
        // is slow or hung), the unscoped check reported a false positive "confirmed error"
        // purely from that unrelated banner, which would have silently swallowed this suite's
        // new ambiguous-timeout failure below into the legitimate-skip branch instead -- exactly
        // the kind of silent disappearance this whole rewrite exists to close. Scoping to the
        // popover's own subtree makes the confirmed-vs-ambiguous distinction actually reliable.
        // 2026-09-16 merge follow-up: popoverScope() used to fall back to `document` whenever
        // the close button hadn't rendered yet, on the theory that "no popover found" should
        // still let callers search *something*. That fallback is itself a live race, reproduced
        // against the new lazy/click-triggered fetch this same day: the very FIRST waitFor() poll
        // below runs synchronously, in the same tick as histBtn.click() above, before React has
        // committed the popover's own DOM (including its close button). At that exact instant
        // popoverScope() falls back to `document`, and errorBannerVisible() then matches this
        // app's OWN unrelated, page-level "Couldn't load data automatically ..." banner
        // (autoFetchError, ~line 4252) -- which is already sitting in the DOM anytime the main
        // CSV_SOURCE_URL auto-fetch has failed (true on every run in a sandbox that can't reach
        // docs.google.com, since this suite runs long after that mount-time fetch has already
        // failed and rawRows.length > 0 from the suite's own earlier xlsx upload). Confirmed
        // live: waitFor resolved `true` after ~50ms even though NEITHER the real popover's date
        // buttons NOR its own error banner had rendered yet (both genuinely false), because that
        // one stray poll saw the unrelated document-wide banner instead -- then, a poll or two
        // later once the popover's real close button exists and scoping narrows correctly, both
        // checks correctly read false again, and the suite recorded a false
        // "reachable-but-slow/ambiguous" FAILURE despite having waited only milliseconds, not the
        // full budget. The same false-positive-then-reverts shape could just as easily land on
        // the CONFIRMED-unreachable branch instead (a false "error banner" match closes the
        // popover and skips silently) depending on exactly which poll tick wins the race --
        // reintroducing this suite's own original silent-skip bug from underneath the fix meant
        // to close it. Fixed by never treating "the popover isn't mounted yet" as "search the
        // whole page": an absent close button now means an EMPTY scope (nothing found, by
        // design) rather than a document-wide fallback, so both checks correctly report "not yet"
        // until the real popover -- and only the real popover -- has something to say.
        const EMPTY_SCOPE = { querySelectorAll: () => [] };
        const popoverScope = () => {
            const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Close historical data panel');
            return (closeBtn && closeBtn.closest('.absolute')) || EMPTY_SCOPE;
        };
        const dateButtonSelector = () => Array.from(popoverScope().querySelectorAll('button')).filter(b =>
            /^\d{4}-\d{2}-\d{2}$/.test(b.textContent.trim())
        );
        const errorBannerVisible = () => Array.from(popoverScope().querySelectorAll('div')).some(d =>
            d.textContent.includes('Fetch failed') || d.textContent.includes('Failed to fetch') || d.textContent.includes('Couldn\'t load')
        );
        // Timeout raised 8s -> 30s on 2026-09-15, and it MUST stay well above the archive's
        // real first-open cost. Until that day the app fetched the historical archive eagerly
        // in a mount effect, so by the time this suite (the last of 9) clicked the button the
        // dates were already in state and rendered instantly -- 8s was never actually tested
        // against a cold fetch. That mount effect was removed (it cost every page load ~10.9s
        // for a feature most users never open -- see HISTORICAL_REFETCH_WINDOW_MS in the app
        // file), so the fetch now STARTS on the click below. Against the live archive this can
        // legitimately take several seconds (a real network fetch plus a yield-for-paint before
        // the parse begins -- see fetchHistoricalData's own comments in the app for the current
        // measured costs); 2026-09-16's Web Worker fix (see parseHistoricalArchiveInWorker in
        // the app) took the PARSE itself off this critical path when a worker can spin up, but
        // this wait still covers the network fetch, the worker/importScripts startup, and the
        // guaranteed main-thread fallback for whenever a worker can't be used (CSP block, no
        // Worker support) -- so 30s stays the right generous ceiling for the unpinned/live case,
        // not just a leftover from before the worker existed.
        //
        // With the old 8s the whole suite silently skipped all 4 of its assertions and the
        // run just reported 68 tests instead of 72 -- no failure, no warning, exactly the
        // silent-coverage-loss shape this file warns about elsewhere. Caught only by diffing
        // per-suite assertion COUNTS against a baseline run, which is worth doing whenever
        // this total changes. If the archive keeps growing, raise this again rather than
        // letting the skip come back. On the PINNED path (see below) this is irrelevant either
        // way -- a local fixture resolves in single-digit milliseconds, nowhere near either
        // budget.
        const HIST_WAIT_TIMEOUT_MS = 30000; // see immediately above for why this isn't 8s anymore
        await waitFor(() => dateButtonSelector().length > 0 || errorBannerVisible(), { timeout: HIST_WAIT_TIMEOUT_MS });
        const dateButtons = dateButtonSelector();
        if (dateButtons.length === 0) {
            if (errorBannerVisible()) {
                // CONFIRMED unreachable (a real error banner rendered) -- the legitimate skip
                // this rewrite deliberately keeps, same convention as the Compare suite's own
                // "both fixture uploads failed before touching state" no-op above.
                histBtn.click();
                return;
            }
            // Timed out with NEITHER dates NOR an error banner -- unconfirmed/ambiguous, not a
            // clean no-op (see this suite's header comment: this is the gap that used to let a
            // reachable-but-slow archive vanish with the exact same silent shape as a confirmed
            // failure). Record it loudly instead of vanishing, then abort the rest of the suite
            // -- there is no historical data to assert anything further against.
            record(SUITE, `Setup: historical archive answered within ${HIST_WAIT_TIMEOUT_MS}ms (neither date buttons nor an error banner appeared -- reachable-but-slow or hung, NOT a confirmed-unreachable no-op)`,
                false, { waitedMs: HIST_WAIT_TIMEOUT_MS });
            histBtn.click();
            return;
        }
        record(SUITE, 'Setup: historical archive reachable, at least one date loaded', true, { dateCount: dateButtons.length });

        // ---- Pinned-fixture-only exact checks ---------------------------------------------
        // Ground truth derived directly from tests/fixtures/historical_data_2026-08-24_to_
        // 2026-08-26.csv's OWN columns -- a small, real, committed subset of the actual
        // archive (trimmed from Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv,
        // the repo's own 9-day/8,769-row ground-truth export), never derived by capturing what
        // the app renders (see the Sector fix's rationale for why that would freeze any bug
        // present at capture time in as "expected"). Only runs when the runner has pinned
        // HISTORICAL_DATA_CSV_URL to that exact fixture; skipped (not failed) otherwise, same
        // convention as Sector's own SECTOR_RIGHT_FIXTURE_GROUND_TRUTH comparison.
        if (window.__BFRT_HISTORICAL_FIXTURE__) {
            const HISTORICAL_FIXTURE_DATES = ['2026-08-26', '2026-08-25', '2026-08-24']; // newest first, matches historicalDates' own sort().reverse()
            // Every one of the fixture's 16 rows has a UNIQUE trade/subTrade/lane/saleWeek/
            // vvd/vessel combination (tableData's real aggregation key, ~line 5915 of the app)
            // -- verified when the fixture was built, specifically so these counts need no
            // arithmetic: the Booking Flash tab's aggregated row count for a given date equals
            // that date's raw row count exactly, with no rows ever collapsing into each other.
            const HISTORICAL_FIXTURE_ROW_COUNTS = { '2026-08-24': 7, '2026-08-25': 5, '2026-08-26': 4 };

            const gotDates = dateButtons.map(b => b.textContent.trim());
            const datesMatch = gotDates.length === HISTORICAL_FIXTURE_DATES.length &&
                gotDates.every((d, i) => d === HISTORICAL_FIXTURE_DATES[i]);
            record(SUITE, 'Pinned fixture: popover lists exactly the fixture\'s own 3 dates, newest first (Record-Date grouping/sort guard)',
                datesMatch, { got: gotDates, expected: HISTORICAL_FIXTURE_DATES });

            // Exercises the FULL pipeline per date -- fetch -> group by Record Date ->
            // parseWorkbookToRows -> tableData aggregation -> render -- not just grouping. A
            // real column-mapping or row-loss bug (a mis-wired getVal() alias, a dropped row,
            // an off-by-one in the CSV-to-per-date split) would show up here as a wrong count.
            // ONE record() call covers all 3 dates (mirroring SECTOR_RIGHT_FIXTURE_GROUND_TRUTH's
            // own single check spanning all 42 fixture rows, not one check per row) -- the exact
            // per-date expected/got is still all in `detail` so a real mismatch is fully
            // diagnosable from the report, it just doesn't cost 3 separate pass/fail lines for
            // what is conceptually one guard.
            const rowCountResults = [];
            for (const date of HISTORICAL_FIXTURE_DATES) {
                const btn = dateButtonSelector().find(b => b.textContent.trim() === date);
                if (!btn) {
                    rowCountResults.push({ date, expectedCount: HISTORICAL_FIXTURE_ROW_COUNTS[date], rowCount: null, error: 'date button not found' });
                    continue;
                }
                btn.click();
                const bannerHasThisDate = () => Array.from(document.querySelectorAll('span')).some(s => s.textContent.includes(`Viewing historical data for ${date}`));
                await waitFor(bannerHasThisDate, { timeout: 5000 });
                await clickTab('Booking Flash');
                await waitFor(() => document.querySelectorAll('tbody tr').length > 0, { timeout: 5000 });
                // Visible-table lookup (not plain querySelector) -- see SUITE 1's comment above
                // for why (POL Booking Flash's own panel stays mounted+hidden across switches).
                const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
                const allBodyRows = table ? Array.from(table.querySelectorAll('tbody tr')) : [];
                // The Detail table inserts one blank/spacer <tr> after the LAST row of every
                // distinct Lane group (processedData's `withBlanks`, ~line 6146 of the app) --
                // every fixture row happens to carry its own distinct Lane, so without
                // filtering these out every real row would show up paired with a spacer row,
                // exactly doubling the count (confirmed live: got 8/10/14 against an expected
                // 4/5/7 before this filter was added). A blank row's filler cell is the ONLY
                // <td> in this table that ever carries a `colspan` attribute -- real rows only
                // ever use `rowSpan` on their Trade/Sub Trade/Lane group-header cells -- so this
                // is a reliable structural marker, not a content-based guess.
                const rowCount = allBodyRows.filter(tr => !tr.querySelector('td[colspan]')).length;
                rowCountResults.push({ date, expectedCount: HISTORICAL_FIXTURE_ROW_COUNTS[date], rowCount });
            }
            const rowCountMismatches = rowCountResults.filter(r => r.rowCount !== r.expectedCount);
            record(SUITE, 'Pinned fixture: viewing each fixture date renders exactly that date\'s own raw Booking Flash row count (fixture rows are collision-free, so no arithmetic is needed)',
                rowCountResults.length === HISTORICAL_FIXTURE_DATES.length && rowCountMismatches.length === 0,
                { checked: rowCountResults, mismatches: rowCountMismatches });
        }

        // ---- Runs on every run, pinned or not ----------------------------------------------
        const liveDateButtons = dateButtonSelector(); // re-query -- the pinned loop above may have clicked through several dates already
        const targetDate = liveDateButtons[0].textContent.trim();
        liveDateButtons[0].click();
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

    // ============================================================
    // SUITE 10: Preferences_Persistence (added 2026-09-16) -- regression
    // coverage for the server-backed preference sync described in
    // docs/SERVER_PREFS_CONTRACT.md (the three keys: bookingFlashDarkMode /
    // bookingFlashAutoRefresh / bookingFlashFreezePanes). That contract is
    // FROZEN and shared by four agents working concurrently (the app writer,
    // Code.gs's doGet, and this suite); this suite tests against the
    // contract's documented behavior, not against the app's in-progress
    // internals.
    //
    // WHY THIS SUITE IS STRUCTURALLY DIFFERENT FROM SUITES 1-9: every suite
    // above drives the ONE already-mounted app instance on this page (click a
    // tab, read the DOM). The seam this suite exercises -- "read
    // window.__SERVER_PREFS__ / window.google.script.run before the app's
    // own <script type="text/babel"> ever evaluates" -- cannot be reached on
    // an already-mounted page; by the time this file is pasted into a
    // console, the real app has already read those globals (or their
    // absence) once, at module-load time, and nothing after that point can
    // put a fake in front of it. So this suite instead boots FRESH, isolated
    // copies of the app in hidden iframes, seeding the fakes on each
    // iframe's own `window` before the app script inside it ever parses.
    //
    // HOW: `document.open()` on an iframe's initial (same-origin,
    // about:blank) document reuses that same Window object rather than
    // navigating to a new one -- so properties set on `iframe.contentWindow`
    // beforehand survive into the document `document.write()` then parses
    // and executes. This exactly reproduces the ordering guarantee the real
    // Code.gs relies on (doGet injects `window.__SERVER_PREFS__` via a plain
    // synchronous <script> tag placed before the app's own babel-tagged
    // script -- see the contract's "Server -> client" section). The HTML
    // fetched is `location.href` -- i.e. whichever
    // Booking_flash_report_na_*.html is the CURRENT live file in this very
    // tab -- never a hardcoded filename (see AGENTS.md's syntax-check
    // section and README's "Current version" note for why hardcoding that
    // filename has silently broken checks before). Like Suite 8's
    // self-upload, `fetch()` of a same-origin file only resolves under a
    // real HTTP origin, never file:// -- this suite has the same
    // requirement (see its own fetch-failure Setup record below).
    //
    // Because an iframe created this way (no `src` navigation) inherits the
    // PARENT PAGE'S OWN ORIGIN, its `localStorage` is the exact same storage
    // area as this tab's -- convenient (a preset "existing" value just needs
    // a plain `localStorage.setItem` before boot), but it means every
    // scenario below that touches the three real preference keys must
    // snapshot and restore them around itself, or it would corrupt whatever
    // Kevin's own browser had saved. See snapshotRealStorage/
    // restoreRealStorage below -- every scenario runs inside a try/finally
    // that restores the exact pre-scenario value (or removes the key if it
    // didn't exist), regardless of pass/fail/throw.
    //
    // THE MOST IMPORTANT ASSERTION IN THIS SUITE is the very first one
    // recorded below: that the app's own code actually READ
    // `window.__SERVER_PREFS__` at all. Every other check in this suite
    // would still pass, for a plausible-looking reason, even if the app
    // never consulted the fake -- it would just silently fall through to the
    // exact same localStorage-only behavior this feature is layered on top
    // of, and this whole 41-assertion suite would be a false positive that
    // no single one of its own failures could ever reveal (see the contract:
    // "A hostname check makes the test seam unreachable"). That's why the
    // fake server-prefs object below is a Proxy that LOGS every property
    // access rather than a plain object -- the log itself, not any resolved
    // value, is the thing that proves the seam is real.
    //
    // ANTI-SILENT-SKIP: this suite installs every fake it depends on itself
    // (unlike Suite 8/9, which depend on real external resources -- a
    // fixture file over HTTP, a live Google Sheet -- that can legitimately
    // be unreachable in some environments). It has no legitimate reason to
    // ever skip, so nothing below ever `return`s without first calling
    // record() with a loud failure (see runScenario's own Setup record, and
    // every inner Setup check before a conditional early return). The very
    // last check in this suite asserts the suite recorded EXACTLY 41
    // results, a hardcoded tripwire against a future refactor silently
    // dropping an assertion while still reporting "PASS" on a smaller set --
    // precisely the failure mode AGENTS.md's "Check the executed-check
    // count, not the pass rate" section and Suite 9's own header comment
    // both document having already happened twice in this repo, from a
    // *different* root cause (a slow real dependency) than what this suite
    // exercises, but with an identical silent-shrinkage symptom.
    // ============================================================
    await (async function preferencesPersistenceSuite() {
        const SUITE = 'Preferences_Persistence';
        const PREF_KEYS = {
            dark: 'bookingFlashDarkMode',
            autoRefresh: 'bookingFlashAutoRefresh',
            freeze: 'bookingFlashFreezePanes',
        };
        const REAL_KEYS = [PREF_KEYS.dark, PREF_KEYS.autoRefresh, PREF_KEYS.freeze];
        // Hardcoded, not derived -- see this suite's header comment for why. Verified against
        // this file's own record() calls below (41 inner assertions; the count-check itself,
        // right at the end, is NOT one of the 41 it verifies).
        const EXPECTED_RECORD_COUNT = 41;
        const startCount = allResults.length;

        // --- localStorage snapshot/restore (shared real storage -- see header comment) ---
        const snapshotRealStorage = () => {
            const snap = {};
            REAL_KEYS.forEach(k => { try { snap[k] = window.localStorage.getItem(k); } catch { snap[k] = undefined; } });
            return snap;
        };
        const restoreRealStorage = (snap) => {
            REAL_KEYS.forEach(k => {
                try {
                    if (snap[k] === null || snap[k] === undefined) window.localStorage.removeItem(k);
                    else window.localStorage.setItem(k, snap[k]);
                } catch { /* best-effort -- if storage is genuinely broken there is nothing more to do */ }
            });
        };

        // --- the tracked fake for window.__SERVER_PREFS__ ---
        // spec: null/undefined      -> global left entirely unset (localhost/static hosting).
        //       { available:false } -> identity didn't resolve server-side.
        //       { available:true, values:{...} } -> normal case.
        // Every property read anywhere in this structure (outer object, and the nested
        // `values` object) is appended to `log` via a Proxy `get`/`getOwnPropertyDescriptor`
        // trap -- this is what the CRITICAL first assertion below inspects.
        const makeTrackedServerPrefs = (spec) => {
            if (spec == null) return { value: undefined, log: [] };
            const log = [];
            let valuesProxy;
            if (spec.available === true) {
                valuesProxy = new Proxy(spec.values || {}, {
                    get(target, prop, receiver) { log.push(`values.${String(prop)}`); return Reflect.get(target, prop, receiver); },
                    getOwnPropertyDescriptor(target, prop) { log.push(`values.hasOwnProperty(${String(prop)})`); return Reflect.getOwnPropertyDescriptor(target, prop); },
                });
            }
            const base = spec.available === true
                ? { available: true, values: valuesProxy }
                : { available: false, reason: spec.reason || 'no-user-identity' };
            const proxy = new Proxy(base, {
                get(target, prop, receiver) { log.push(String(prop)); return Reflect.get(target, prop, receiver); },
                getOwnPropertyDescriptor(target, prop) { log.push(`hasOwnProperty(${String(prop)})`); return Reflect.getOwnPropertyDescriptor(target, prop); },
            });
            return { value: proxy, log };
        };

        // --- the fake for window.google.script.run ---
        // Mirrors the real API's chaining shape (`.withSuccessHandler(fn).withFailureHandler(fn)
        // .saveUserPref(key, value)`, each `.with*Handler` returning a NEW bound object rather
        // than mutating a shared one, matching the real google.script.run so concurrent/rapid
        // toggles can't cross-talk each other's handlers). `hasSaveUserPref:false` reproduces a
        // partially-deployed Code.gs (google.script.run exists, saveUserPref doesn't). The
        // simulated round trip is genuinely async (setTimeout), matching the real fire-and-forget
        // RPC this replaces.
        const makeFakeScriptRun = ({ hasSaveUserPref = true, failSave = false, asyncDelayMs = 20 } = {}) => {
            const calls = [];
            const makeRunner = (handlers) => {
                const obj = {
                    withSuccessHandler(fn) { return makeRunner({ ...handlers, success: fn }); },
                    withFailureHandler(fn) { return makeRunner({ ...handlers, failure: fn }); },
                };
                if (hasSaveUserPref) {
                    obj.saveUserPref = (key, value) => {
                        calls.push({ key, value });
                        setTimeout(() => {
                            if (failSave) { try { handlers.failure && handlers.failure({ message: 'simulated failure (test)' }); } catch { /* app's own handler threw -- surfaced by the scenario's own error listener, not here */ } }
                            else { try { handlers.success && handlers.success({ ok: true }); } catch { /* ditto */ } }
                        }, asyncDelayMs);
                    };
                }
                return obj;
            };
            return { scriptRun: makeRunner({}), calls };
        };

        // --- fetch the app's own HTML ONCE, reused by every iframe boot below ---
        let appHtml = null;
        try {
            const resp = await fetch(location.href);
            if (resp.ok) appHtml = await resp.text();
        } catch { /* recorded below either way */ }
        record(SUITE, 'Setup: fetched the app\'s own HTML (location.href) for isolated iframe boots', !!appHtml,
            appHtml ? undefined : { note: 'fetch(location.href) failed or returned non-OK. This suite must be served over real local HTTP, never file:// -- same requirement documented for the Compare suite\'s own self-upload (see its header comment above). Every scenario below will fail its Setup mount check as a direct consequence of this, rather than silently skipping.' });

        // --- boot a fresh, isolated app instance with the given fakes pre-seeded ---
        const bootApp = async ({ serverPrefsSpec, hasGoogle = false, scriptRunOpts = {}, presetLocalStorage = {}, throwLocalStorage = false } = {}) => {
            Object.entries(presetLocalStorage).forEach(([k, v]) => {
                try { if (v === null || v === undefined) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* nothing more we can do */ }
            });

            const { value: serverPrefsValue, log: serverPrefsLog } = makeTrackedServerPrefs(serverPrefsSpec);
            const { scriptRun, calls: scriptRunCalls } = hasGoogle ? makeFakeScriptRun(scriptRunOpts) : { scriptRun: null, calls: [] };

            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-3000px;left:-3000px;width:1280px;height:900px;border:0;';
            document.body.appendChild(iframe);
            const win = iframe.contentWindow;

            // Seed BEFORE the app's script ever parses -- see this suite's header comment for
            // why document.open/write/close on the iframe's OWN initial document (rather than
            // navigating it via `src`) is what makes this ordering guarantee hold.
            if (!appHtml) return { iframe, win, doc: null, mounted: false, serverPrefsLog, scriptRunCalls, cleanup: () => { try { iframe.remove(); } catch { } } };
            if (serverPrefsValue !== undefined) win.__SERVER_PREFS__ = serverPrefsValue;
            if (hasGoogle) win.google = { script: { run: scriptRun } };
            if (throwLocalStorage) {
                // Patches THIS iframe's own Storage.prototype only -- a separate JS realm from
                // the parent page (and from every other scenario's own fresh iframe), so this
                // can never leak into the real page's localStorage or into any other scenario.
                // Destroyed wholesale (no restore needed) when this iframe is removed below.
                try {
                    win.Storage.prototype.getItem = function () { throw new Error('simulated localStorage failure (test)'); };
                    win.Storage.prototype.setItem = function () { throw new Error('simulated localStorage failure (test)'); };
                } catch { /* if this itself throws, the scenario's own mount check will surface it */ }
            }

            iframe.contentDocument.open();
            iframe.contentDocument.write(appHtml);
            iframe.contentDocument.close();

            const doc = iframe.contentDocument;
            // Same anchor `clickTab` uses elsewhere in this file (a real tab button's exact
            // text) -- proves the app fully mounted, not just that Babel/React loaded. Timeout
            // deliberately generous and UNMEASURED (unlike Suite 9's own dated 30s figure) --
            // this suite boots the app's full ~9,000+ line script from scratch, transpiled by
            // Babel Standalone, once per scenario below; if this proves too tight in practice,
            // raise it rather than letting boots silently start timing out into false Setup
            // failures.
            const mounted = await waitFor(() => !!doc && Array.from(doc.querySelectorAll('button')).some(b => b.textContent.trim() === 'Trade Summary'), { timeout: 25000 });
            return { iframe, win, doc, mounted, serverPrefsLog, scriptRunCalls, cleanup: () => { try { iframe.remove(); } catch { } } };
        };

        // Runs one scenario: snapshots real storage, boots, records a loud Setup pass/fail
        // (never a silent return), runs the scenario's own checks only if mount succeeded, and
        // ALWAYS tears the iframe down + restores real storage afterward regardless of outcome.
        const runScenario = async (scenarioLabel, opts, testFn) => {
            const snap = snapshotRealStorage();
            let boot = null;
            try {
                boot = await bootApp(opts);
                record(SUITE, `Setup: isolated app instance mounted for "${scenarioLabel}"`, boot.mounted,
                    boot.mounted ? undefined : { note: 'iframe boot did not render a "Trade Summary" tab button within the timeout -- see the app-HTML fetch Setup record above for the most likely cause.' });
                if (!boot.mounted) return;
                await testFn(boot);
            } finally {
                if (boot) boot.cleanup();
                restoreRealStorage(snap);
            }
        };

        // Opens the Settings popover and returns a live finder for the Dark Mode toggle button
        // (unconditionally rendered, unlike Auto-Refresh's own toggle which is gated behind
        // isCsvSourceConfigured() -- see its own comment in the app source -- so Dark Mode is
        // the one preference reachable for click-interaction on a bare fresh boot with nothing
        // uploaded). Records its own Setup checks; returns null (after recording) if either step
        // fails, so callers can bail without themselves ever returning silently.
        const openSettingsAndFindDarkToggle = async (boot, scenarioLabel) => {
            const { doc } = boot;
            const settingsBtn = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === '⚙️ Settings');
            record(SUITE, `Setup: "⚙️ Settings" button found (${scenarioLabel})`, !!settingsBtn);
            if (!settingsBtn) return null;
            settingsBtn.click();
            const findDarkToggle = () => Array.from(doc.querySelectorAll('button')).find(b => b.getAttribute('title') === 'Toggle dark mode');
            const opened = await waitFor(() => !!findDarkToggle(), { timeout: 5000 });
            record(SUITE, `Setup: Settings popover opened, exposing the Dark Mode toggle (${scenarioLabel})`, opened);
            return opened ? findDarkToggle : null;
        };
        const isDarkAtFirstPaint = (doc) => {
            const wrapperDiv = Array.from(doc.querySelectorAll('div')).find(d => d.classList.contains('min-h-screen'));
            return !!wrapperDiv && wrapperDiv.classList.contains('dark');
        };
        const readLS = (win, key) => { try { return win.localStorage.getItem(key); } catch { return null; } };

        // ---- Scenario 1: server value present and disagreeing with localStorage -> server wins ----
        await runScenario('server value wins over disagreeing localStorage', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: '1', [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            presetLocalStorage: { [PREF_KEYS.dark]: '0', [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null },
        }, async (boot) => {
            // THE MOST IMPORTANT ASSERTION IN THIS SUITE -- deliberately first. See this suite's
            // header comment for why every check below it would still pass, for a
            // plausible-looking reason, even if the app never touched window.__SERVER_PREFS__ at
            // all: it would just silently take the plain localStorage path, and for THIS
            // scenario that path reads '0' -- a different, equally plausible-looking boolean --
            // so a broken seam would not even look obviously wrong downstream. Only this access
            // log, populated purely by the fake's own Proxy traps, can prove the app actually
            // read the structure rather than sniffing its way around it.
            record(SUITE, 'App structurally consults window.__SERVER_PREFS__ (its Proxy access log is non-empty)',
                boot.serverPrefsLog.length > 0,
                {
                    logLength: boot.serverPrefsLog.length,
                    sample: boot.serverPrefsLog.slice(0, 10),
                    ifFailing: 'A 0-length log means the app never touched window.__SERVER_PREFS__ at all. The most likely cause is isServerPrefSyncAvailable/resolveUserPref sniffing location.hostname (or some other environment signal) instead of the REQUIRED purely structural check (window.__SERVER_PREFS__ && .available === true && typeof google...). A hostname check makes this entire suite\'s test seam unreachable -- every other assertion below would then keep passing by silently exercising the plain localStorage path, turning this whole file into a false positive.',
                });

            record(SUITE, 'Server value ("1", Dark) wins over disagreeing localStorage ("0") at first paint, and is written back to localStorage',
                isDarkAtFirstPaint(boot.doc) === true && readLS(boot.win, PREF_KEYS.dark) === '1',
                { isDarkAtFirstPaint: isDarkAtFirstPaint(boot.doc), persistedAfterMount: readLS(boot.win, PREF_KEYS.dark), serverValue: '1', localStorageValueBeforeBoot: '0' });
        });

        // ---- Scenario 2: server available:true but the key is null -> falls back to localStorage ----
        await runScenario('server available:true with a null value falls back to localStorage', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: null, [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            presetLocalStorage: { [PREF_KEYS.freeze]: '1' },
        }, async (boot) => {
            record(SUITE, 'Server available:true with a null value for the key falls back to the localStorage value ("1")',
                readLS(boot.win, PREF_KEYS.freeze) === '1',
                { persistedAfterMount: readLS(boot.win, PREF_KEYS.freeze), serverValueForKey: null, localStorageValueBeforeBoot: '1' });
        });

        // ---- Scenario 3: neither source has a value -> each preference's documented default ----
        await runScenario('neither server nor localStorage has a value -> documented default', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: null, [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            presetLocalStorage: { [PREF_KEYS.dark]: null, [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null },
        }, async (boot) => {
            record(SUITE, 'Dark Mode defaults to OFF ("0") when neither source has a value',
                readLS(boot.win, PREF_KEYS.dark) === '0', { persisted: readLS(boot.win, PREF_KEYS.dark) });
            record(SUITE, 'Freeze Panes defaults to OFF ("0") when neither source has a value',
                readLS(boot.win, PREF_KEYS.freeze) === '0', { persisted: readLS(boot.win, PREF_KEYS.freeze) });
            record(SUITE, 'Auto-Refresh defaults to ON ("1") when neither source has a value (the documented null-means-on asymmetry)',
                readLS(boot.win, PREF_KEYS.autoRefresh) === '1', { persisted: readLS(boot.win, PREF_KEYS.autoRefresh) });
        });

        // ---- Scenario 4: available:false -> localStorage only, no save call attempted ----
        await runScenario('server available:false behaves exactly like today (localStorage only, no save attempted)', {
            serverPrefsSpec: { available: false, reason: 'no-user-identity' },
            // google.script.run IS present here on purpose: the point of this scenario is that
            // available:false alone must suppress writes even though the OTHER half of
            // isServerPrefSyncAvailable's structural check is satisfied.
            hasGoogle: true,
            presetLocalStorage: { [PREF_KEYS.dark]: '1', [PREF_KEYS.autoRefresh]: '0', [PREF_KEYS.freeze]: '1' },
        }, async (boot) => {
            record(SUITE, 'available:false resolves every preference from localStorage alone, unchanged',
                readLS(boot.win, PREF_KEYS.dark) === '1' && readLS(boot.win, PREF_KEYS.autoRefresh) === '0' && readLS(boot.win, PREF_KEYS.freeze) === '1',
                { dark: readLS(boot.win, PREF_KEYS.dark), autoRefresh: readLS(boot.win, PREF_KEYS.autoRefresh), freeze: readLS(boot.win, PREF_KEYS.freeze) });
            // The write-back effects' saveUserPref calls are synchronous-dispatch/async-settle --
            // give them a real moment to have fired if they were ever going to. This is
            // deliberately a fixed delay, not a waitFor predicate, because the assertion below IS
            // "nothing happened."
            await new Promise(r => setTimeout(r, 200));
            record(SUITE, 'available:false means NO saveUserPref call is ever attempted, even though google.script.run exists',
                boot.scriptRunCalls.length === 0, { calls: boot.scriptRunCalls });
        });

        // ---- Scenario 5: window.__SERVER_PREFS__ absent entirely (localhost) -> identical to today ----
        await runScenario('window.__SERVER_PREFS__ absent entirely (localhost/static hosting) -> identical to today', {
            serverPrefsSpec: null,
            hasGoogle: false,
            presetLocalStorage: { [PREF_KEYS.dark]: '1', [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: '0' },
        }, async (boot) => {
            const hasGlobal = (() => { try { return Object.prototype.hasOwnProperty.call(boot.win, '__SERVER_PREFS__'); } catch { return true; } })();
            record(SUITE, 'Setup: window.__SERVER_PREFS__ is genuinely absent for this scenario (test-setup sanity check)', !hasGlobal, { hasGlobal });
            record(SUITE, 'With the global absent, every preference resolves from localStorage exactly as before (dark=1 kept, autoRefresh null->ON default, freeze=0 kept)',
                readLS(boot.win, PREF_KEYS.dark) === '1' && readLS(boot.win, PREF_KEYS.autoRefresh) === '1' && readLS(boot.win, PREF_KEYS.freeze) === '0',
                { dark: readLS(boot.win, PREF_KEYS.dark), autoRefresh: readLS(boot.win, PREF_KEYS.autoRefresh), freeze: readLS(boot.win, PREF_KEYS.freeze) });
        });

        // ---- Scenario 6: the autoRefresh null/'0' asymmetry, tested explicitly (not folded into
        // the scenarios above) -- for BOTH the server source and the localStorage source. This is
        // the single most likely thing a uniform ("treat all three prefs the same") implementation
        // would get wrong (see the contract's own warning), so each of the 4 combinations below is
        // its own isolated, independently-diagnosable scenario/record rather than sharing one.
        await runScenario('autoRefresh asymmetry -- server value null means ON (even over a conflicting localStorage OFF)', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: null, [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            presetLocalStorage: { [PREF_KEYS.autoRefresh]: null },
        }, async (boot) => {
            record(SUITE, 'Auto-Refresh asymmetry: resolved-null (server null, localStorage also unset) resolves to ON ("1")',
                readLS(boot.win, PREF_KEYS.autoRefresh) === '1', { persisted: readLS(boot.win, PREF_KEYS.autoRefresh) });
        });
        await runScenario('autoRefresh asymmetry -- server value "0" means explicitly OFF', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: null, [PREF_KEYS.autoRefresh]: '0', [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            presetLocalStorage: { [PREF_KEYS.autoRefresh]: '1' }, // conflicting -- proves the server's "0" actually won, not a coincidental localStorage read
        }, async (boot) => {
            record(SUITE, 'Auto-Refresh asymmetry: an explicit server value "0" resolves to OFF, overriding a conflicting localStorage "1"',
                readLS(boot.win, PREF_KEYS.autoRefresh) === '0', { persisted: readLS(boot.win, PREF_KEYS.autoRefresh), serverValue: '0', localStorageValueBeforeBoot: '1' });
        });
        await runScenario('autoRefresh asymmetry -- localStorage-source null (no server) means ON', {
            serverPrefsSpec: null,
            hasGoogle: false,
            presetLocalStorage: { [PREF_KEYS.autoRefresh]: null },
        }, async (boot) => {
            record(SUITE, 'Auto-Refresh asymmetry: no server + no localStorage value resolves to ON ("1")',
                readLS(boot.win, PREF_KEYS.autoRefresh) === '1', { persisted: readLS(boot.win, PREF_KEYS.autoRefresh) });
        });
        await runScenario('autoRefresh asymmetry -- localStorage-source "0" (no server) means explicitly OFF', {
            serverPrefsSpec: null,
            hasGoogle: false,
            presetLocalStorage: { [PREF_KEYS.autoRefresh]: '0' },
        }, async (boot) => {
            record(SUITE, 'Auto-Refresh asymmetry: no server, localStorage explicitly "0" resolves to OFF',
                readLS(boot.win, PREF_KEYS.autoRefresh) === '0', { persisted: readLS(boot.win, PREF_KEYS.autoRefresh) });
        });

        // ---- Scenario 7: toggling fires exactly one save carrying the final value ----
        await runScenario('toggling a preference fires exactly one save carrying the final value', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: '0', [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            presetLocalStorage: {},
        }, async (boot) => {
            const findDarkToggle = await openSettingsAndFindDarkToggle(boot, 'exactly-one-save scenario');
            if (!findDarkToggle) return;
            const { scriptRunCalls } = boot;
            // Mount itself already fires each write-back effect once (with the resolved initial
            // value) -- baseline AFTER that has settled measures only what THIS click adds, not
            // the unrelated mount-time write every preference always does.
            await waitFor(() => scriptRunCalls.some(c => c.key === PREF_KEYS.dark), { timeout: 5000 });
            const baseline = scriptRunCalls.length;
            findDarkToggle().click(); // '0' (Light) -> '1' (Dark)
            await waitFor(() => scriptRunCalls.length > baseline, { timeout: 5000 });
            await new Promise(r => setTimeout(r, 150)); // settle margin -- want the FULL set this click produced, not just the first
            const newCalls = scriptRunCalls.slice(baseline);
            const only = newCalls.length === 1 ? newCalls[0] : null;
            record(SUITE, 'Exactly one saveUserPref call fires from a single toggle click, carrying the right key and the flipped ("1") value',
                newCalls.length === 1 && !!only && only.key === PREF_KEYS.dark && only.value === '1',
                { newCalls, baselineCount: baseline });
        });

        // ---- Scenario 8: a save whose failure handler fires ----
        await runScenario('a failed save never reverts local state, never throws, and subsequent toggles still work', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: '0', [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            scriptRunOpts: { failSave: true },
            presetLocalStorage: {},
        }, async (boot) => {
            const findDarkToggle = await openSettingsAndFindDarkToggle(boot, 'failed-save scenario');
            if (!findDarkToggle) return;
            const { win, scriptRunCalls } = boot;
            let uncaught = null;
            const onError = (e) => { uncaught = (e && (e.message || e.reason)) || String(e); };
            win.addEventListener('error', onError);
            win.addEventListener('unhandledrejection', onError);
            try {
                findDarkToggle().click(); // '0' -> '1'
                await waitFor(() => scriptRunCalls.some(c => c.key === PREF_KEYS.dark && c.value === '1'), { timeout: 5000 });
                // Let the fake's failure handler actually fire (dispatched async -- see
                // makeFakeScriptRun's own setTimeout) before checking anything downstream of it.
                await new Promise(r => setTimeout(r, 250));

                record(SUITE, 'A failing saveUserPref never throws/rejects uncaught inside the app', uncaught === null, { uncaught });

                const toggleStillDark = findDarkToggle().getAttribute('aria-pressed') === 'true';
                record(SUITE, 'Local state is NOT reverted after the server write fails (toggle still shows Dark/on)',
                    toggleStillDark, { ariaPressed: findDarkToggle().getAttribute('aria-pressed') });

                const beforeSecondClick = scriptRunCalls.length;
                findDarkToggle().click(); // flip back '1' -> '0'
                const secondFired = await waitFor(() => scriptRunCalls.length > beforeSecondClick, { timeout: 5000 });
                record(SUITE, 'A subsequent toggle after a failed save still fires its own save call (feature is not wedged)',
                    secondFired, { beforeSecondClick, after: scriptRunCalls.length });
            } finally {
                win.removeEventListener('error', onError);
                win.removeEventListener('unhandledrejection', onError);
            }
        });

        // ---- Scenario 9: localStorage throwing while the server global is present ----
        await runScenario('localStorage throwing on every access still boots the app and still honors the server value', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: '1', [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            throwLocalStorage: true,
            presetLocalStorage: {},
        }, async (boot) => {
            // runScenario's own Setup record already proved the app mounted at all despite every
            // localStorage access throwing -- what's left to check here is that the SERVER value
            // specifically still won, since a naive implementation could plausibly crash (or
            // silently produce the wrong default) inside the try/catch-wrapped localStorage
            // fallback path itself, rather than failing at mount overall.
            record(SUITE, 'Server value ("1", Dark) still applies at first paint even though localStorage throws on every access',
                isDarkAtFirstPaint(boot.doc) === true, { isDarkAtFirstPaint: isDarkAtFirstPaint(boot.doc) });
        });

        // ---- Scenario 10: google.script.run present but missing saveUserPref ----
        await runScenario('google.script.run present but missing saveUserPref does not throw from the click handler', {
            serverPrefsSpec: { available: true, values: { [PREF_KEYS.dark]: '0', [PREF_KEYS.autoRefresh]: null, [PREF_KEYS.freeze]: null } },
            hasGoogle: true,
            scriptRunOpts: { hasSaveUserPref: false },
            presetLocalStorage: {},
        }, async (boot) => {
            const findDarkToggle = await openSettingsAndFindDarkToggle(boot, 'missing-saveUserPref scenario');
            if (!findDarkToggle) return;
            const { win } = boot;
            let uncaught = null;
            const onError = (e) => { uncaught = (e && (e.message || e.reason)) || String(e); };
            win.addEventListener('error', onError);
            try {
                findDarkToggle().click();
                // No saveUserPref call will ever fire here (it doesn't exist) -- give the click's
                // synchronous handler + effect a real moment to have thrown if it was going to.
                await new Promise(r => setTimeout(r, 250));
                record(SUITE, 'Clicking the toggle with a partially-deployed server (google.script.run.saveUserPref missing) never throws',
                    uncaught === null, { uncaught });
                const toggleFlipped = findDarkToggle().getAttribute('aria-pressed') === 'true';
                record(SUITE, 'The local (client-only) write still succeeds even though the server call is unavailable',
                    toggleFlipped, { ariaPressed: findDarkToggle().getAttribute('aria-pressed') });
            } finally {
                win.removeEventListener('error', onError);
            }
        });

        // ANTI-SILENT-SKIP tripwire -- see this suite's header comment. Not itself one of the 41
        // it counts.
        const recordedCount = allResults.length - startCount;
        record(SUITE, `Exactly ${EXPECTED_RECORD_COUNT} assertions were recorded for this suite (hardcoded tripwire against a future refactor silently dropping a check -- this suite depends entirely on fakes it installs itself, so unlike Suite 8/9 it has no legitimate reason to ever skip; see AGENTS.md's "Check the executed-check count, not the pass rate" section)`,
            recordedCount === EXPECTED_RECORD_COUNT, { recordedCount, expected: EXPECTED_RECORD_COUNT });
    })();

    // SUITE 11: Field visibility picker (2026-09-16)
    //
    // Covers the feature asked for in the 2026-09-15 meeting: untick a field and it
    // disappears from the table AND from the download. The export check is the one that
    // matters -- the stated business reason for the request was downloading a report
    // with the person-in-charge and status columns removed, so a version of this feature
    // that only hid columns on screen would look correct and still fail the actual ask.
    // ============================================================
    await (async function fieldVisibilitySuite() {
        const SUITE = 'Field_Visibility';
        if (!(await clickTab('Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }

        // SKIP, don't fail, when the picker is absent. This suite is feature-specific and the
        // repo carries more than one app file -- a build that predates the Fields picker is not
        // a regression, the same way Suite 9 skips when the historical archive is unreachable.
        // Records NOTHING, so the executed-check count makes the skip visible rather than
        // leaving a green check that tested nothing (AGENTS.md: read the count, not the rate).
        //
        // Single check as of 2026-09-21 (was two steps -- Settings itself, then the Fields
        // trigger inside it -- from 2026-09-17 to 2026-09-21, while the trigger briefly lived
        // inside the Settings popover). It moved back out into the tab-bar row next to Coast
        // (commit `0a4d17b`) and is no longer related to Settings at all, so there is nothing
        // left to distinguish between: `[data-field-picker-trigger]` is gated purely on
        // `!topPanelCollapsed && (activeTab === 'detail' || activeTab === 'pol_booking')`. The
        // `clickTab('Booking Flash')` above already puts activeTab on 'detail', and this suite
        // never touches Hide Filters, so on any current build the trigger should already be
        // present here; its absence now means either a genuinely older build predating the
        // picker, or (if this suite is ever reordered/extended) landing on the wrong tab or
        // with filters hidden -- all still legitimate skip conditions, not a regression.
        if (!(await fieldPickerTriggerAvailable())) {
            console.log(`\u2139\ufe0f  SKIP [${SUITE}] -- no [data-field-picker-trigger] in this build/state; field picker not present.`);
            return;
        }
        const panel = await openFieldPicker();
        if (!panel) { record(SUITE, 'Setup: field picker opens on click', false, 'trigger present but panel never opened'); return; }
        record(SUITE, 'Setup: field picker opens on click', true);

        // Opening by CLICK (not only hover) is load-bearing for testability: a synthetic
        // .click() fires neither :hover nor onMouseEnter, so a hover-only panel would be
        // unreachable from here. If this check ever fails because the panel went
        // hover-only, that is a regression in the feature's testability, not in the test.
        const picBox = panel.querySelector('input[data-field-toggle="pic"]');
        if (!picBox) { record(SUITE, 'Setup: PIC entry present in picker', false); await closeFieldPicker(); return; }
        record(SUITE, 'Setup: PIC entry present in picker', true);
        await closeFieldPicker();

        const headerTexts = () => Array.from(document.querySelectorAll('thead th')).map(th => th.textContent.trim());
        const picVisibleBefore = headerTexts().some(t => t.includes('PIC'));
        record(SUITE, 'PIC column visible by default (export layout unchanged unless opted out)', picVisibleBefore);

        // ---- hide PIC, assert it leaves the DOM entirely (not just CSS-hidden) ----
        await setFieldVisible('pic', false);
        const picGoneFromHeader = !headerTexts().some(t => t.includes('PIC'));
        record(SUITE, 'Unticking PIC removes its header cell from the DOM', picGoneFromHeader);

        // ---- the check that actually encodes the business requirement ----
        // exportToExcel() calls XLSX.utils.table_to_sheet(table) with NO options object.
        // SheetJS does not skip display:none cells without {display:true}, so a CSS-based
        // implementation would still emit the column here even though the DOM check above
        // passed. Monkey-patching writeFile captures the workbook rather than triggering a
        // real browser download -- consistent with this suite's "poll internal JS state"
        // approach, and it avoids filesystem I/O entirely.
        let exportedHeaders = null;
        if (window.XLSX && typeof window.XLSX.writeFile === 'function') {
            const realWriteFile = window.XLSX.writeFile;
            window.XLSX.writeFile = function (wb) {
                try {
                    const firstSheet = wb.Sheets[wb.SheetNames[0]];
                    const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                    exportedHeaders = (rows || []).slice(0, 6).flat().map(v => String(v == null ? '' : v));
                } catch (e) { exportedHeaders = { error: String(e && e.message || e) }; }
                // Deliberately does NOT call through: we want the workbook, not a download.
            };
            try {
                // "Export" lives INSIDE the Settings popover, so it is not in the DOM until
                // that popover is opened -- looking for it directly finds nothing and the
                // check would silently never run.
                const settingsBtn = Array.from(document.querySelectorAll('button'))
                    .find(b => b.textContent.trim().endsWith('Settings'));
                if (settingsBtn) {
                    settingsBtn.click();
                    await waitFor(() => Array.from(document.querySelectorAll('button'))
                        .some(b => b.textContent.trim() === 'Export'), { timeout: 5000 });
                }
                const exportBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Export');
                if (exportBtn) {
                    exportBtn.click();   // this also closes the popover (setDisplaySettingsOpen(false))
                    await waitFor(() => exportedHeaders !== null, { timeout: 8000 });
                } else if (settingsBtn) {
                    settingsBtn.click(); // leave no popover open behind us
                }
            } finally {
                window.XLSX.writeFile = realWriteFile;
            }
        }

        if (Array.isArray(exportedHeaders)) {
            const leaked = exportedHeaders.filter(h => h.includes('PIC'));
            record(SUITE, 'Unticking PIC removes it from the Excel export too', leaked.length === 0,
                leaked.length ? { leaked, hint: 'Column is CSS-hidden rather than conditionally rendered?' } : undefined);
        } else {
            // Not a pass: an un-run check must not read as a green one. See AGENTS.md on
            // reading the executed-check count rather than the pass rate.
            record(SUITE, 'Unticking PIC removes it from the Excel export too', false,
                { reason: 'Could not capture a workbook', exportedHeaders });
        }

        // ---- Reset restores everything ----
        const panel2 = await openFieldPicker();
        if (panel2) {
            const resetBtn = document.querySelector('[data-field-picker-reset]');
            if (resetBtn) resetBtn.click();
            await closeFieldPicker();
            const picBack = headerTexts().some(t => t.includes('PIC'));
            record(SUITE, 'Reset to defaults restores a hidden field', picBack);
        } else {
            record(SUITE, 'Reset to defaults restores a hidden field', false, 'picker would not reopen');
        }

        // ---- persistence mechanism ----
        // A true end-to-end check needs location.reload(), which no other suite here does
        // and which would discard the uploaded dataset mid-run. Assert the mechanism
        // instead: the toggle writes the '1'/'0' key the mount-time initializer reads.
        // The reload path is covered by the manual verification note in the PR.
        await setFieldVisible('pic', false);
        // Reads the SINGLE view-prefs blob (`{v, savedAt, prefs:{...}}` under
        // 'bookingFlashViewPrefs'), not a per-field key: field visibility rides the same
        // store as slicers/zoom/tab, by design -- one key is one round trip for the
        // Apps Script per-user backend that store is shaped for. Polled rather than read
        // once because the write is debounced (~400ms), so a bare getItem races it.
        // Two storage shapes are legitimate here and the suite must accept either, because it
        // runs against whichever app file is served: the MAIN file stores one '1'/'0' key per
        // field (reads resolve through resolveUserPref, so a server value would win once these
        // keys join the frozen SERVER_PREFS contract), while the TESTING build folds the same
        // state into a single versioned bookingFlashViewPrefs blob. Asserting only one shape
        // would make this a false failure on the other file rather than a real signal.
        // Polled, not read once: the blob write is debounced (~400ms), so a bare read races it.
        let storedPic;
        const persisted = await waitFor(() => {
            try {
                const perKey = localStorage.getItem('bookingFlashPicHidden');
                if (perKey !== null) { storedPic = perKey; return perKey === '1'; }
                const raw = localStorage.getItem('bookingFlashViewPrefs');
                if (!raw) return false;
                storedPic = ((JSON.parse(raw) || {}).prefs || {}).picHidden;
                return storedPic === true;
            } catch (e) { storedPic = 'THREW: ' + e.message; return false; }
        }, { timeout: 5000 });
        record(SUITE, 'Hiding a field persists for the next page load', persisted, { storedPic });
        await setFieldVisible('pic', true);

        // ---- Escape closes a pinned panel ----
        // Regression guard for the silent-stale-closure bug already root-caused in this
        // app for the Historical Data popover: an Escape handler declared above the state
        // it reads arms once at mount and then never works again, with no thrown error.
        const panel3 = await openFieldPicker();
        if (panel3) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const closed = await waitFor(() => !document.querySelector('[data-field-picker-panel]'), { timeout: 3000 });
            record(SUITE, 'Escape closes the field picker', closed);
            if (!closed) await closeFieldPicker();
        } else {
            record(SUITE, 'Escape closes the field picker', false, 'picker would not reopen');
        }
    })();

    // SUITE 12: Filter_Persistence (added 2026-09-24) -- regression coverage for the
    // filter-saving feature ported from Booking_flash_report_na_1.67_TESTING.html's
    // ViewPrefsStore into this file's own FilterPrefsStore (module scope, right before
    // `function FlashReportDashboard()`). Scope is narrower than 1.67's own feature on
    // purpose, per Kevin: only the actual filters/slicers persist (the 10 real filter
    // fields) plus topPanelCollapsed (has to travel WITH them -- see its own safety-net
    // check below) -- NOT the 12 legacy column-visibility booleans 1.67 also persisted
    // (this file replaced those with FIELD_TOGGLES/useFieldVisibilityPref, covered by
    // Suite 11 above), and NOT zoom/text-size/active-tab/column-widths (chrome, not
    // filters, out of scope).
    //
    // STRUCTURALLY THIS SUITE FOLLOWS SUITE 10, not Suites 1-9: the thing under test --
    // "what does a `useState(() => restoredFilterValue('x'))` lazy initializer see the
    // very first time this component ever mounts" -- can only be controlled by seeding
    // localStorage BEFORE a fresh instance's module script ever runs, exactly like Suite
    // 10's own reasoning for booting isolated iframes rather than driving the one
    // already-mounted page. See Suite 10's header comment (above) for the full mechanics
    // (document.open/write/close reusing the iframe's own about:blank Window so a global
    // seeded beforehand survives into the app's own <script> parse) -- reused verbatim
    // below, minus every piece of Suite 10 that's specific to google.script.run/
    // window.__SERVER_PREFS__, which this feature has nothing to do with (pure
    // localStorage, no server round trip at all, unlike the three booleans Suite 10
    // covers).
    //
    // WHY topPanelCollapsed STANDS IN FOR "A FILTER" IN THE LIVE-INTERACTION SCENARIO
    // (Scenario 5 below): every one of the 10 real filters' own clickable controls
    // (SlicerBtn for Sub Trade/Coast/Lane/etc., the Yard search box) is gated on data
    // actually being loaded (`availableSubTrades`/`availableYards`/etc. are `useMemo`s
    // over `rawRows`, and the Yard block is additionally gated on
    // `availableYards.length > 0`) -- confirmed by reading their own JSX -- so a freshly
    // booted iframe with nothing uploaded renders none of them, the same constraint
    // Suite 10 already lives with for every OTHER data-dependent control. Uploading a
    // real file into N isolated iframes just for this one scenario would also make this
    // suite's own executed-check count depend on a live/pinned data fetch racing each
    // iframe's boot -- precisely the nondeterminism AGENTS.md's check 4 spent multiple
    // dated write-ups eliminating elsewhere in this file, and exactly what this suite's
    // own hardcoded tripwire at the bottom (see ANTI-SILENT-SKIP below) assumes never
    // happens. topPanelCollapsed is not itself one of the 10 "real" filters, but it IS
    // one of the 11 fields in FILTER_PREFS_DEFAULTS, reads through the exact same
    // `restoredFilterValue` lazy initializer, and is written by the exact same single
    // write-effect/400ms-debounce/flushNow code path every other field uses (see the
    // app's own write-effect, keyed on all 11 fields together) -- so driving it via its
    // own always-rendered, data-independent "▲ Hide Filters"/"▼ Show Filters" button
    // exercises the real debounce/write mechanism end-to-end without depending on any
    // external data source. The 10 real filters' RESTORE path (reading a pre-seeded
    // blob into initial state) is still fully covered without this problem -- Scenarios
    // 1-4 below seed localStorage directly and never need a filter's own UI control to
    // exist, only the write-effect's own round-trip back to localStorage, which fires on
    // every mount regardless of data.
    //
    // FULL-STORAGE SNAPSHOT/RESTORE, not a fixed 1-key list: unlike Suite 10 (which only
    // snapshots/restores its own 3 real preference keys), every scenario below boots a
    // COMPLETE app instance, which also reads/writes bookingFlashDarkMode/AutoRefresh/
    // FreezePanes, the storage probe key, and every bookingFlash*Hidden field-visibility
    // key (all real localStorage, same origin, same store as Kevin's own browser -- see
    // Suite 10's header comment for why an iframe built this way shares storage with the
    // parent tab). Snapshotting/restoring only 'bookingFlashFilterPrefs' would leave
    // every one of those OTHER keys free to be clobbered by each boot as a side effect of
    // testing something unrelated to them, so snapshotAllStorage/restoreAllStorage below
    // capture and restore the WHOLE localStorage store around every scenario, not just
    // this feature's one key.
    //
    // ANTI-SILENT-SKIP: like Suite 10 (and unlike Suite 8/9, which depend on a real
    // external resource that can be legitimately unreachable), this suite depends on
    // nothing but this same page's own HTML fetched via fetch(location.href) and plain
    // localStorage -- it has no legitimate reason to ever skip, so every scenario records
    // a loud Setup pass/fail rather than silently returning, and the final tripwire
    // record asserts an EXACT count (see AGENTS.md's "Check the executed-check count, not
    // the pass rate" section, and Suite 10's own identical convention).
    // ============================================================
    await (async function filterPersistenceSuite() {
        const SUITE = 'Filter_Persistence';
        const FILTER_KEY = 'bookingFlashFilterPrefs';
        const FILTER_VERSION = 1;
        // Mirrors FILTER_PREFS_DEFAULTS in the app exactly (same key set, same key order --
        // see the app's own module-scope declaration right before FlashReportDashboard).
        const FILTER_DEFAULTS_LITERAL = {
            topPanelCollapsed: false,
            selectedSubTrades: [],
            selectedAnalysts: [],
            selectedMktgAnalysts: [],
            selectedCoasts: [],
            selectedLanes: [],
            selectedSaleWeeks: [],
            selectedYards: [],
            yardSearchText: '',
            selectedApStatuses: [],
            headerFilters: {},
        };
        // Hardcoded, not derived -- see this suite's header comment (ANTI-SILENT-SKIP) and
        // Suite 10's own identical convention for why. Verified against this file's own
        // record() calls below once this suite was actually run (AGENTS.md: "Don't guess the
        // number; run the suite and read it off"). Moved from 36 to 41 on 2026-09-24 when a
        // code-review pass added coverage for 4 confirmed bugs found in this same feature
        // (see HANDOFF.md's dated addendum): Scenario 1b (+3: its own Setup-mounted check
        // plus 2 assertions, a new boot -- the banner false-positive fix) and, reusing
        // existing boots, Scenario 2 (+1: the stale-selection pruning fix) and Scenario 5
        // (+1 net: the write-path hazard fix strengthens an existing assertion rather than
        // adding one, and the byte-identical-write-guard fix adds one new bounce check).
        const EXPECTED_RECORD_COUNT = 41;
        const startCount = allResults.length;

        // --- order-independent deep-equality for the plain JSON-safe values every field here
        // is (booleans/strings/string-arrays/a flat string->string object) -- avoids a false
        // failure from Object.keys() ordering differing between a hand-authored literal here
        // and the app's own {...DEFAULTS, ...} spread order. ---
        const canon = (v) => {
            if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
            if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
            return JSON.stringify(v);
        };

        // --- full localStorage snapshot/restore (see header comment for why this is the
        // WHOLE store, not just FILTER_KEY) ---
        const snapshotAllStorage = () => {
            const snap = {};
            try {
                for (let i = 0; i < window.localStorage.length; i++) {
                    const k = window.localStorage.key(i);
                    snap[k] = window.localStorage.getItem(k);
                }
            } catch { /* best-effort, same posture as every other storage access in this file */ }
            return snap;
        };
        const restoreAllStorage = (snap) => {
            try {
                const currentKeys = [];
                for (let i = 0; i < window.localStorage.length; i++) currentKeys.push(window.localStorage.key(i));
                // Remove anything added during the scenario that wasn't there before it.
                currentKeys.forEach(k => { if (!(k in snap)) { try { window.localStorage.removeItem(k); } catch { } } });
                // Put every pre-existing key back to its exact prior value.
                Object.keys(snap).forEach(k => { try { window.localStorage.setItem(k, snap[k]); } catch { } });
            } catch { /* best-effort */ }
        };

        // --- fetch the app's own HTML ONCE, reused by every iframe boot below (Suite 10's
        // own pattern, independently re-fetched here since each suite is its own scope) ---
        let appHtml = null;
        try {
            const resp = await fetch(location.href);
            if (resp.ok) appHtml = await resp.text();
        } catch { /* recorded below either way */ }
        record(SUITE, 'Setup: fetched the app\'s own HTML (location.href) for isolated iframe boots', !!appHtml,
            appHtml ? undefined : { note: 'fetch(location.href) failed or returned non-OK -- this suite must be served over real local HTTP, never file://. Every scenario below will fail its own Setup mount check as a direct consequence.' });

        // --- boot a fresh, isolated app instance with FILTER_KEY pre-seeded (or absent) ---
        // presetFilterPrefsRaw is written VERBATIM (not JSON.stringify'd here) so a scenario
        // can seed either a well-formed blob (JSON.stringify'd by the caller) or a
        // deliberately unparseable raw string (Scenario 4b) through the same parameter.
        // Undefined means "start clean" (key removed, not just left alone -- a previous
        // scenario's restoreAllStorage already put back whatever was there before this SUITE
        // ran, which might itself be a real stored blob from Kevin's own browser).
        const bootApp = async ({ presetFilterPrefsRaw } = {}) => {
            try {
                if (presetFilterPrefsRaw === undefined) window.localStorage.removeItem(FILTER_KEY);
                else window.localStorage.setItem(FILTER_KEY, presetFilterPrefsRaw);
            } catch { /* nothing more we can do; the Setup mount check below will surface the fallout */ }

            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-3000px;left:-3000px;width:1280px;height:900px;border:0;';
            document.body.appendChild(iframe);
            const win = iframe.contentWindow;
            const uncaughtErrors = [];
            const onError = (e) => uncaughtErrors.push((e && (e.message || e.reason)) || String(e));
            try { win.addEventListener('error', onError); win.addEventListener('unhandledrejection', onError); } catch { /* if this itself throws, mount will fail visibly below */ }

            const cleanup = () => { try { iframe.remove(); } catch { } };
            if (!appHtml) return { iframe, win, doc: null, mounted: false, uncaughtErrors, cleanup };

            iframe.contentDocument.open();
            iframe.contentDocument.write(appHtml);
            iframe.contentDocument.close();
            const doc = iframe.contentDocument;
            const mounted = await waitFor(() => !!doc && Array.from(doc.querySelectorAll('button')).some(b => b.textContent.trim() === 'Trade Summary'), { timeout: 25000 });
            return { iframe, win, doc, mounted, uncaughtErrors, cleanup };
        };

        const runScenario = async (scenarioLabel, opts, testFn) => {
            const snap = snapshotAllStorage();
            let boot = null;
            try {
                boot = await bootApp(opts);
                record(SUITE, `Setup: isolated app instance mounted for "${scenarioLabel}"`, boot.mounted,
                    boot.mounted ? undefined : { note: 'iframe boot did not render a "Trade Summary" tab button within the timeout -- see the app-HTML fetch Setup record above for the most likely cause.' });
                if (!boot.mounted) return;
                await testFn(boot);
            } finally {
                if (boot) boot.cleanup();
                restoreAllStorage(snap);
            }
        };

        // --- small shared readers ---
        const bannerVisible = (doc) => Array.from(doc.querySelectorAll('[role="status"]'))
            .some(el => el.textContent.includes('Your filters from last time were restored.'));
        const findHideShowBtn = (doc) => Array.from(doc.querySelectorAll('button'))
            .find(b => { const t = b.textContent.trim(); return t === '▲ Hide Filters' || t === '▼ Show Filters'; });
        const findResetBtn = (doc) => Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === 'Reset to defaults');
        const findDismissBtn = (doc) => doc.querySelector('button[aria-label="Dismiss restored-filters notice"]');
        const readFilterPrefs = (win) => { try { return JSON.parse(win.localStorage.getItem(FILTER_KEY)); } catch { return null; } };
        // Polls readFilterPrefs(win) against predicate -- used both to WAIT for the
        // mount-time (or click-triggered) debounced write-effect to flush, and as the
        // assertion itself (waitFor's own return value already reflects the final
        // predicate() result at timeout, so no separate re-check is needed).
        const waitForWrite = (win, predicate, timeout = 2500) => waitFor(() => { const p = readFilterPrefs(win); return !!p && predicate(p); }, { timeout });

        // ---- Scenario 1: a full 10-filter set (+ topPanelCollapsed) restores unchanged,
        // and the restored-filters banner appears ----
        //
        // selectedYards is seeded NON-EMPTY here with yardSearchText left EMPTY --
        // deliberately, not an oversight: that's exactly "a yard selected by clicking its
        // own chip, never typed into the search box," which used to be silently lost on
        // restore. Root cause (found and fixed 2026-09-24, in the same change that added
        // this suite): a pre-existing, unrelated effect (search "yard mount-guard effect"
        // in the app, a few lines below FILTER_PREFS_VALIDATORS) is keyed on
        // [yardSearchText, availableYards] and used to run unconditionally on every mount,
        // including before FilterPrefsStore's restored selectedYards was ever visible --
        // with yardSearchText empty, its old body unconditionally called
        // setSelectedYards([]), clobbering the just-restored value within the same initial
        // render pass. The app fix (ported from the 1.67_TESTING branch's own identical
        // 2026-09-15 fix for the same effect) adds two guards: an
        // `availableYards.length === 0` early return (nothing to derive against before
        // real data exists, so don't touch selectedYards at all yet) and a
        // `searchTextChanged` gate on the empty-search clear branch (only clear when the
        // user actually emptied the box, not merely because the effect re-ran). This
        // scenario seeds a real, non-empty Yard alongside all 9 other filters and asserts
        // the FULL 10-filter set -- Yard included -- round-trips through restore and back
        // to storage unchanged, proving the fix rather than working around the bug.
        //
        // 'USLAX01' specifically (a real yard code from tests/fixtures/live_csv_2026-08-12.csv,
        // not a shortened/synthetic one like 'LAX') -- deliberately, not arbitrarily: this
        // suite's own fixture data loads for real during this scenario (CSV_SOURCE_URL is
        // pinned by tests/ci_regression_runner.js), which now also feeds the 2026-09-24
        // stale-selection pruning fix (usePruneStaleSelection, app file, module scope). A
        // synthetic code like 'LAX' would eventually get pruned once real data loads,
        // racing this scenario's own waitForWrite against however long that takes --
        // exactly the same race a real code doesn't have, since it's never a pruning
        // target in the first place. Confirmed live: 'LAX' intermittently failed this
        // assertion once the pruning fix landed, for exactly this reason.
        await runScenario('a full 10-filter set restores into live state and round-trips back to storage unchanged', {
            presetFilterPrefsRaw: JSON.stringify({
                v: FILTER_VERSION, savedAt: Date.now(), prefs: {
                    topPanelCollapsed: false,
                    selectedSubTrades: ['TPT'],
                    selectedAnalysts: ['Alex R'],
                    selectedMktgAnalysts: ['Ryan T'],
                    selectedCoasts: ['WC'],
                    selectedLanes: ['AN2'],
                    selectedSaleWeeks: ['2026/W30'],
                    selectedYards: ['USLAX01'],
                    yardSearchText: '',
                    selectedApStatuses: ['AP FROZEN'],
                    headerFilters: { vessel: 'MSC' },
                },
            }),
        }, async (boot) => {
            const seedPrefs = {
                topPanelCollapsed: false, selectedSubTrades: ['TPT'], selectedAnalysts: ['Alex R'],
                selectedMktgAnalysts: ['Ryan T'], selectedCoasts: ['WC'], selectedLanes: ['AN2'],
                selectedSaleWeeks: ['2026/W30'], selectedYards: ['USLAX01'], yardSearchText: '',
                selectedApStatuses: ['AP FROZEN'], headerFilters: { vessel: 'MSC' },
            };
            record(SUITE, 'Restored-filters banner is shown when a valid, versioned, non-empty stored filter set exists', bannerVisible(boot.doc));
            const ok = await waitForWrite(boot.win, p => p.v === FILTER_VERSION && canon(p.prefs) === canon(seedPrefs));
            record(SUITE, 'All 10 filters (including a chip-selected Yard with no search text) + topPanelCollapsed restore into live state unchanged and round-trip back through the write-effect identically',
                ok, { written: readFilterPrefs(boot.win) });
        });

        // ---- Scenario 1b (2026-09-24): a valid, version-matching, but all-DEFAULT-shaped
        // blob does NOT show the restored-filters banner ----
        //
        // Direct regression coverage for the wasRestored() false-positive fix. Before the
        // fix, hydrate()'s doRead() always returned `restored: true` whenever a parseable,
        // version-matching blob existed at all -- which became true for essentially EVERY
        // return visitor, restored filters or not, because the mount-time write-effect
        // persists a valid v:1 blob unconditionally on every mount, including one whose
        // `prefs` is nothing but FILTER_PREFS_DEFAULTS. The fix (filterPrefsEqualsDefaults,
        // module scope, right before FilterPrefsStore) changes `restored` to
        // `!filterPrefsEqualsDefaults(prefs)`, so "restored" now means "something actually
        // differs from defaults," not merely "a parseable blob exists." Contrasts directly
        // with Scenario 1 just above, whose seeded blob is non-default in every one of the
        // 10 real filter fields and correctly shows the banner.
        //
        // Deliberately a NEW boot, not an extension of an existing scenario: this is the
        // one code path in hydrate() (parsed + version-matched, then compared against
        // defaults) that none of the other scenarios exercise -- Scenario 5's `{}` boot hits
        // the "no blob at all" branch (`!raw`), and Scenarios 4a/4b hit the
        // version-mismatch/unparseable branches, neither of which ever reaches
        // filterPrefsEqualsDefaults.
        await runScenario('a valid, version-matching, but all-default-shaped blob does NOT show the restored-filters banner', {
            presetFilterPrefsRaw: JSON.stringify({ v: FILTER_VERSION, savedAt: Date.now(), prefs: { ...FILTER_DEFAULTS_LITERAL } }),
        }, async (boot) => {
            record(SUITE, 'The restored-filters banner does NOT appear for a valid, version-matching blob whose content is identical to defaults (wasRestored() false-positive fix: "restored" now means content actually differs from defaults, not merely that a parseable blob exists)',
                !bannerVisible(boot.doc));
            const ok = await waitForWrite(boot.win, p => p.v === FILTER_VERSION && canon(p.prefs) === canon(FILTER_DEFAULTS_LITERAL));
            record(SUITE, 'An all-default-shaped blob round-trips back through the write-effect unchanged (still exactly the defaults)',
                ok, { written: readFilterPrefs(boot.win) });
        });

        // ---- Scenario 2: a corrupted/malformed blob degrades field-by-field to defaults,
        // never discarding the whole blob ----
        //
        // selectedYards IS asserted to become ['USLAX01','USLAX03'] here -- exactly what
        // FILTER_PREFS_VALIDATORS.selectedYards alone produces from this stored array
        // (strips the '__NO_MATCH__' sentinel, keeps the two real codes). Before the
        // 2026-09-24 mount-guard fix (see Scenario 1's own header comment a few lines up),
        // this would NOT have held: this corrupted blob has no yardSearchText of its own,
        // so it validates to the default '' (empty), and the pre-existing yard-search
        // mount effect used to unconditionally overwrite whatever the read-side validator
        // just produced for selectedYards, back to []. With the fix, the effect no longer
        // touches selectedYards at all until real data exists (availableYards.length===0
        // guard), and even once data loads, the empty-search clear branch only fires when
        // the search text itself changed -- it didn't here (still '' both before and
        // after) -- so the validator's own output survives untouched. This is the
        // corrupted-blob counterpart to Scenario 1's happy-path Yard coverage.
        //
        // Both surviving Yard codes are REAL ones from tests/fixtures/live_csv_2026-08-12.csv
        // (not shortened/synthetic codes like 'LAX'/'OAK'), for the same reason Scenario 1
        // switched to 'USLAX01': a synthetic code would be a legitimate target for the
        // 2026-09-24 stale-selection pruning fix (usePruneStaleSelection) once real data
        // loads, racing this scenario's own waitForWrite. Real codes are never pruned, so
        // that assertion is stable regardless of how fast the pinned CSV_SOURCE_URL fetch
        // resolves relative to the debounced write.
        //
        // selectedLanes is DELIBERATELY seeded with a real lane PLUS a stale one
        // ('ZZZFAKE-LANE', syntactically valid so it survives FILTER_PREFS_VALIDATORS.
        // selectedLanes unchanged -- validation and pruning are two separate passes) to
        // give this suite its item-5 (pruning) coverage: `expected.selectedLanes` below is
        // just `['AN2']`, unchanged from before this addition, so this reuses Scenario 2's
        // existing boot and existing exact-match assertion rather than needing a dedicated
        // one. usePruneStaleSelection is a SINGLE hook applied identically to all 7
        // multi-select fields (Sub Trade/Analyst/Mktg Analyst/Coast/Lane/Sale Week/Yard),
        // not 7 independent implementations, so this one field's coverage reasonably stands
        // in for the rest -- see the dedicated record() below for the explicit assertion.
        await runScenario('a corrupted/malformed blob degrades field-by-field instead of being discarded wholesale', {
            presetFilterPrefsRaw: JSON.stringify({
                v: FILTER_VERSION, savedAt: Date.now(), prefs: {
                    topPanelCollapsed: 'yes',                 // wrong type -> default false
                    selectedSubTrades: 'TPT',                 // not an array -> default []
                    selectedAnalysts: [1, 2, 3],               // array of numbers, not strings -> default []
                    selectedMktgAnalysts: null,                // -> default []
                    selectedCoasts: ['WC', 42],                // mixed types fail isPlainFilterStringArray -> default []
                    selectedLanes: ['AN2', 'ZZZFAKE-LANE'],    // real lane passes validation unchanged; the stale one also passes validation but is pruned once real data loads (item 5 coverage, see header comment)
                    selectedSaleWeeks: { not: 'array' },       // -> default []
                    selectedYards: ['USLAX01', '__NO_MATCH__', 'USLAX03'], // validator strips the sentinel -> ['USLAX01','USLAX03'], and the mount-guard fix lets that value stick (see this scenario's own header comment)
                    yardSearchText: 12345,                     // not a string -> default ''
                    selectedApStatuses: ['AP FROZEN', 'BOGUS', 'AP ONLY'], // whitelist -> drops 'BOGUS'
                    headerFilters: { vessel: 'MSC', bad: 42, nested: { x: 1 } }, // non-string values dropped
                    extraGarbageKey: 'should be ignored entirely -- not in FILTER_PREFS_DEFAULTS',
                },
            }),
        }, async (boot) => {
            const expected = {
                topPanelCollapsed: false, selectedSubTrades: [], selectedAnalysts: [], selectedMktgAnalysts: [],
                selectedCoasts: [], selectedLanes: ['AN2'], selectedSaleWeeks: [], selectedYards: ['USLAX01', 'USLAX03'],
                yardSearchText: '', selectedApStatuses: ['AP FROZEN', 'AP ONLY'], headerFilters: { vessel: 'MSC' },
            };
            record(SUITE, 'The restored-filters banner still appears for a corrupted-but-parseable, correctly-versioned blob (wasRestored() only checks v/JSON.parse, not per-field validity)',
                bannerVisible(boot.doc));
            const ok = await waitForWrite(boot.win, p => p.v === FILTER_VERSION && canon(p.prefs) === canon(expected));
            const written = readFilterPrefs(boot.win);
            record(SUITE, 'Every corrupted/wrong-type field (including an unknown "extraGarbageKey") independently falls back to its own default -- the whole blob is not discarded',
                ok, { written });
            record(SUITE, 'selectedApStatuses restore whitelists to AP FROZEN / AP ONLY only, dropping any other stored value',
                !!written && Array.isArray(written.prefs.selectedApStatuses) && written.prefs.selectedApStatuses.length === 2 && written.prefs.selectedApStatuses.includes('AP FROZEN') && written.prefs.selectedApStatuses.includes('AP ONLY'),
                { selectedApStatuses: written && written.prefs.selectedApStatuses });
            // Item 5 (2026-09-24, usePruneStaleSelection): a stale value in a restored
            // multi-select field is pruned once real data loads, while a real value seeded
            // alongside it survives. Covering selectedLanes here (one field) reasonably
            // stands in for all 7 -- usePruneStaleSelection is a single shared hook called
            // identically for each of them (module scope, app file), not 7 separate
            // implementations, so this one scenario is not meant to be 7x'd; see that
            // hook's own comment in the app file for why an empty `available` list on
            // mount can never wrongly prune a not-yet-loaded restore.
            record(SUITE, 'A stale value in a restored multi-select field (selectedLanes: a real lane plus "ZZZFAKE-LANE", which does not exist in the loaded dataset) is pruned once real data loads, while the real value survives',
                !!written && Array.isArray(written.prefs.selectedLanes) && written.prefs.selectedLanes.length === 1 && written.prefs.selectedLanes[0] === 'AN2',
                { selectedLanes: written && written.prefs.selectedLanes });
        });

        // ---- Scenario 2b: the selectedYards validator strips an app-generated
        // "__NO_MATCH__" sentinel before it is ever written to storage ----
        //
        // Demonstrates the WRITE side: a yardSearchText seeded here that cannot possibly
        // match any real yard code, so once real data loads and the yard-search effect's
        // own "no match" branch runs, it deterministically sets
        // selectedYards=['__NO_MATCH__'] itself (see that effect's own else-branch), using
        // the exact same validator function (FILTER_PREFS_VALIDATORS.selectedYards --
        // hydrate() and flushNow() both call filterPrefsValidateAll, there is only one copy
        // of this logic) to strip that sentinel before it is ever written to storage.
        // Depends on real data loading (availableYards becoming non-empty) within
        // waitForWrite's timeout, unlike Scenario 2 above -- this is the one place in this
        // suite that leans on the 2026-09-24 mount-guard fix's OTHER half (the
        // availableYards.length===0 early return means selectedYards is left completely
        // untouched, not set to ['__NO_MATCH__'], until data actually exists), which is
        // exactly why this scenario waits for the SPECIFIC settled shape below rather than
        // treating "any array showed up" as sufficient. Reliable here because
        // tests/ci_regression_runner.js pins CSV_SOURCE_URL to a local fixture (AGENTS.md
        // check 4), so the fetch this depends on is fast and deterministic, not a real
        // network round trip.
        await runScenario('the selectedYards validator strips an app-generated "__NO_MATCH__" sentinel before it is ever written to storage', {
            presetFilterPrefsRaw: JSON.stringify({
                v: FILTER_VERSION, savedAt: Date.now(), prefs: { ...FILTER_DEFAULTS_LITERAL, yardSearchText: 'zzz-no-such-yard-code-zzz' },
            }),
        }, async (boot) => {
            // The predicate itself waits for the SPECIFIC expected settled shape, not merely
            // "any array" -- the yard-search effect's own setSelectedYards(['__NO_MATCH__'])
            // and the write-effect's later, validated re-write are two separate render/effect
            // passes (a setState inside an effect schedules a follow-up render, it does not
            // apply synchronously), so a generic "some array showed up" predicate can resolve
            // on the FIRST (pre-validation) write instead of the final settled one. Waiting
            // for the exact expected end state is what every OTHER scenario in this suite
            // already does via a full canon() comparison; this one and 2c match that same
            // discipline instead of a weaker Array.isArray() check.
            const ok = await waitForWrite(boot.win, p => Array.isArray(p.prefs.selectedYards) && p.prefs.selectedYards.length === 0 && !p.prefs.selectedYards.includes('__NO_MATCH__'));
            record(SUITE, 'A yard search matching nothing never leaves the literal "__NO_MATCH__" sentinel in the stored blob, and settles to an empty selectedYards',
                ok, { written: readFilterPrefs(boot.win) });
        });

        // "Scenario 2c" history: while this suite was first being built (before the
        // mount-guard fix existed), a scenario here demonstrated that a validly-restored,
        // non-empty selectedYards (e.g. ['LAX'], no sentinel involved) was silently
        // overwritten to [] on mount whenever yardSearchText restored empty -- a real,
        // confirmed bug, not a test artifact. That bug is now fixed (2026-09-24, see
        // Scenario 1's own header comment for the root cause and the fix), and Scenario 1
        // above now directly asserts the FIXED behavior (a chip-selected Yard with no
        // search text survives a restore) instead of working around the old one. No
        // separate scenario is needed here any more -- kept as a short pointer rather than
        // silently deleted, so the fact that this was once a real, found-and-fixed defect
        // stays on record for whoever reads this file next.

        // ---- Scenario 3: topPanelCollapsed:true is forced back to visible when a filter
        // actually restored non-empty (the safety-net behavior) ----
        await runScenario('topPanelCollapsed:true is forced back to visible when a filter actually restored non-empty', {
            presetFilterPrefsRaw: JSON.stringify({
                v: FILTER_VERSION, savedAt: Date.now(), prefs: { ...FILTER_DEFAULTS_LITERAL, topPanelCollapsed: true, selectedLanes: ['AN2'] },
            }),
        }, async (boot) => {
            const btn = findHideShowBtn(boot.doc);
            record(SUITE, 'A restored topPanelCollapsed:true is forced open ("▲ Hide Filters", aria-pressed=false) when a filter actually restored non-empty, regardless of what was stored for topPanelCollapsed itself',
                !!btn && btn.textContent.trim() === '▲ Hide Filters' && btn.getAttribute('aria-pressed') === 'false',
                { text: btn && btn.textContent.trim(), ariaPressed: btn && btn.getAttribute('aria-pressed') });
            const ok = await waitForWrite(boot.win, p => p.prefs.topPanelCollapsed === false && canon(p.prefs.selectedLanes) === canon(['AN2']));
            record(SUITE, 'The forced-open (false) value is what actually gets written back to storage, not the originally-stored true',
                ok, { written: readFilterPrefs(boot.win) });
        });

        // A "Scenario 3b" negative control (topPanelCollapsed:true with every filter field
        // still empty stays collapsed -- the safety net only fires when it needs to) was
        // built and independently verified passing while building this suite, then removed
        // as its own boot for the same fixed-total-time-budget reason documented above
        // Scenario 3 -- see that comment (and Scenario 2c's removal note further up) for
        // the measured cost per boot and the 180s ci_regression_runner.js budget this
        // suite shares with every other suite in the file. `filterPrefsValidateAll`'s own
        // `hasRestoredFilters` guard (module scope, right before FlashReportDashboard) is
        // the single source of truth this scenario would have exercised: it only forces
        // `topPanelCollapsed` false when at least one OTHER field restored non-empty, so a
        // topPanelCollapsed:true stored with nothing else set is never touched by it.

        // ---- Scenario 4a: a version-mismatched blob resolves to defaults, not the stored
        // payload, and self-heals to v:1 on the next write ----
        await runScenario('a version-mismatched blob (v !== 1) resolves to defaults, not the stored payload', {
            presetFilterPrefsRaw: JSON.stringify({ v: 2, savedAt: Date.now(), prefs: { selectedLanes: ['AN2'] } }),
        }, async (boot) => {
            record(SUITE, 'The restored-filters banner does NOT appear for a version-mismatched blob (treated as nothing restored)', !bannerVisible(boot.doc));
            const ok = await waitForWrite(boot.win, p => p.v === FILTER_VERSION && canon(p.prefs) === canon(FILTER_DEFAULTS_LITERAL));
            record(SUITE, 'A v:2 stored blob resolves to plain defaults (not its own selectedLanes) and self-heals to a v:1 defaults blob on the next debounced write',
                ok, { written: readFilterPrefs(boot.win) });
        });

        // ---- Scenario 4b: unparseable JSON resolves to defaults without crashing ----
        await runScenario('unparseable JSON in storage resolves to defaults without throwing', {
            presetFilterPrefsRaw: '{not valid json!!!',
        }, async (boot) => {
            record(SUITE, 'The restored-filters banner does NOT appear when the stored value is not valid JSON', !bannerVisible(boot.doc));
            record(SUITE, 'No uncaught error/rejection occurs while hydrating an unparseable stored value', boot.uncaughtErrors.length === 0, { uncaughtErrors: boot.uncaughtErrors });
            const ok = await waitForWrite(boot.win, p => p.v === FILTER_VERSION && canon(p.prefs) === canon(FILTER_DEFAULTS_LITERAL));
            record(SUITE, 'Unparseable JSON resolves to plain defaults and self-heals to a valid v:1 defaults blob on the next debounced write',
                ok, { written: readFilterPrefs(boot.win) });
        });

        // ---- Scenario 5: changing a live, persisted field writes to storage only AFTER the
        // 400ms debounce -- driven via topPanelCollapsed's own always-rendered button (see
        // this suite's header comment for why the 10 data-dependent filters' own controls
        // can't be used here) ----
        //
        // Boots with selectedLanes:['AN2'] ALREADY seeded (a real lane, never a pruning
        // target -- see Scenario 1's own header comment for why a real code is required
        // here rather than a synthetic one) -- deliberately, not incidentally: with a
        // filter genuinely active, this is also this suite's item-2 coverage (the
        // write-path hazard fix, 2026-09-24). Before that fix, flushNow() ran the SAME
        // restore-only "force topPanelCollapsed open" hazard rule hydrate() uses
        // (filterPrefsValidateAll, applied unconditionally on every live write too), so a
        // user who clicked "Hide Filters" while any filter was active could never actually
        // persist that collapse -- the very next debounced write saw a filter was active and
        // forced topPanelCollapsed back to false in the blob it was about to save. With no
        // filter active (this scenario's old boot, `{}`) that hazard condition
        // (`hasRestoredFilters`) never fires regardless of whether the bug exists, so the
        // existing "does topPanelCollapsed:true actually get written" check below could not
        // have caught it -- seeding a real, active filter is what turns it into the direct
        // regression test the task asked for.
        await runScenario('toggling the filter panel on a live instance writes to localStorage only after the debounce window', {
            presetFilterPrefsRaw: JSON.stringify({
                v: FILTER_VERSION, savedAt: Date.now(), prefs: { ...FILTER_DEFAULTS_LITERAL, selectedLanes: ['AN2'] },
            }),
        }, async (boot) => {
            const baselineOk = await waitForWrite(boot.win, () => true, 2500);
            record(SUITE, 'Setup: the initial mount-time write-effect establishes a clean baseline write in localStorage', baselineOk);
            if (!baselineOk) return;
            // Compare .prefs specifically, not the whole parsed blob -- flushNow() stamps a
            // fresh `savedAt: Date.now()` into every write regardless of whether `prefs`
            // itself changed, and (see Scenario 6b's own header comment for the full
            // explanation) an unrelated background write can legitimately land in this
            // window once the pinned CSV_SOURCE_URL fixture finishes loading. Comparing the
            // whole object would make this check spuriously fail on that timing, not on
            // anything this scenario actually cares about.
            const baseline = readFilterPrefs(boot.win).prefs;
            const btn = findHideShowBtn(boot.doc);
            if (!btn) { record(SUITE, 'Setup: "▲ Hide Filters" / "▼ Show Filters" button found', false); return; }
            btn.click(); // topPanelCollapsed false -> true
            await new Promise(r => setTimeout(r, 150)); // well under the 400ms debounce
            const tooEarly = readFilterPrefs(boot.win).prefs;
            record(SUITE, 'A single toggle click does NOT write to localStorage immediately -- the write is genuinely debounced, not synchronous',
                canon(tooEarly) === canon(baseline), { baseline, tooEarly });
            // Item 2 (2026-09-24, write-path hazard fix): with a real filter (selectedLanes)
            // active the WHOLE time, this predicate can only settle true if flushNow() left
            // the user's explicit collapse alone -- before the fix, the hazard rule forced
            // topPanelCollapsed back to false on every single write while any filter stayed
            // non-empty, so this would never have resolved and `ok` would time out false.
            const ok = await waitForWrite(boot.win, p => p.prefs.topPanelCollapsed === true && canon(p.prefs.selectedLanes) === canon(['AN2']), 2500);
            record(SUITE, 'After the ~400ms debounce window elapses, the toggled value IS written to localStorage as true -- with an active filter (selectedLanes) present the whole time, this is the direct regression check for the 2026-09-24 write-path hazard fix: flushNow() no longer applies the restore-only "force topPanelCollapsed open" rule, so a live, deliberate collapse is not silently overridden back to false just because a filter is active',
                ok, { written: readFilterPrefs(boot.win) });
            const btnAfter = findHideShowBtn(boot.doc);
            record(SUITE, 'The live DOM reflects the same toggled value ("▼ Show Filters", aria-pressed=true)',
                !!btnAfter && btnAfter.textContent.trim() === '▼ Show Filters' && btnAfter.getAttribute('aria-pressed') === 'true',
                { text: btnAfter && btnAfter.textContent.trim(), ariaPressed: btnAfter && btnAfter.getAttribute('aria-pressed') });

            // Item 3 (2026-09-24, byte-identical-write guard fix), same live instance --
            // reuses this boot rather than adding a new one, per Suite 12's own iframe-count
            // budget (see this suite's header comment). Two quick clicks (well under the
            // 400ms debounce, so they coalesce into ONE flushNow call, the same coalescing
            // FilterPrefsStore.save()'s own comment describes and the "too-early" check
            // above already relies on) take live topPanelCollapsed true -> false -> true,
            // landing back on content byte-for-byte identical (via filterPrefsCanon) to what
            // is already stored from the single toggle above -- not merely "the same values
            // happen to be seeded twice", but the SAME content the store's own guard
            // compares against. Before the fix, flushNow() compared the WHOLE stringified
            // blob, including a fresh `savedAt: Date.now()` stamped into every call, so the
            // guard could never actually skip a write no matter how unchanged `prefs` itself
            // was -- every debounced flush produced a new `savedAt` regardless. Comparing
            // `savedAt` (not just content, which Scenario 6b's own check already does for a
            // different reason) is what tells a genuine skip apart from a redundant rewrite
            // that happens to settle on the same values -- the same distinction Scenario
            // 6b's own header comment draws.
            if (!ok) {
                record(SUITE, 'Setup: skipped the write-guard bounce check because the debounced write above never settled', false);
            } else {
                const beforeBounce = readFilterPrefs(boot.win);
                const btnA = findHideShowBtn(boot.doc);
                if (!btnA) { record(SUITE, 'Setup: "▲ Hide Filters" / "▼ Show Filters" button found for the write-guard bounce', false); }
                else {
                    btnA.click(); // topPanelCollapsed true -> false
                    await new Promise(r => setTimeout(r, 150)); // well under 400ms -- reschedules the pending flush, does not let it fire yet
                    const btnB = findHideShowBtn(boot.doc);
                    if (!btnB) { record(SUITE, 'Setup: "▲ Hide Filters" / "▼ Show Filters" button found after the first bounce click', false); }
                    else {
                        btnB.click(); // topPanelCollapsed false -> true again -- net content identical to what is already stored
                        await new Promise(r => setTimeout(r, 700)); // comfortably past the debounce from the second click
                        const afterBounce = readFilterPrefs(boot.win);
                        record(SUITE, 'Two quick clicks that land back on content identical to what is already stored (true -> false -> true, coalesced by the debounce into one flushNow call) do NOT change savedAt in the stored blob -- the byte-identical-write guard actually skips the write, it does not merely happen to look content-unchanged',
                            !!afterBounce && !!beforeBounce && afterBounce.savedAt === beforeBounce.savedAt && canon(afterBounce.prefs) === canon(beforeBounce.prefs),
                            { beforeBounce, afterBounce });
                    }
                }
            }
        });

        // ---- Scenario 6a: "Reset to defaults" clears live state AND the stored blob ----
        await runScenario('clicking "Reset to defaults" on the restored-filters banner clears live state and the stored blob', {
            presetFilterPrefsRaw: JSON.stringify({
                v: FILTER_VERSION, savedAt: Date.now(), prefs: { ...FILTER_DEFAULTS_LITERAL, selectedLanes: ['AN2'] },
            }),
        }, async (boot) => {
            record(SUITE, 'Setup: restored-filters banner is visible before "Reset to defaults" is clicked', bannerVisible(boot.doc));
            const resetBtn = findResetBtn(boot.doc);
            if (!resetBtn) { record(SUITE, 'Setup: "Reset to defaults" button found in the banner', false); return; }
            resetBtn.click(); // resetFilterPrefs(): clearSlicers() + setTopPanelCollapsed(false) + FilterPrefsStore.clear() + setFilterPrefsRestored(false)
            // FilterPrefsStore.clear()'s localStorage.removeItem runs synchronously inside the
            // click handler, before React even re-renders -- no wait needed to observe it.
            record(SUITE, 'Clicking "Reset to defaults" synchronously clears the stored blob (FilterPrefsStore.clear())',
                boot.win.localStorage.getItem(FILTER_KEY) === null);
            const bannerGone = await waitFor(() => !bannerVisible(boot.doc), { timeout: 3000 });
            record(SUITE, 'Clicking "Reset to defaults" also dismisses the restored-filters banner', bannerGone);
            const btn = findHideShowBtn(boot.doc);
            record(SUITE, 'Live topPanelCollapsed state is (re)set to visible, not collapsed, as part of Reset',
                !!btn && btn.textContent.trim() === '▲ Hide Filters' && btn.getAttribute('aria-pressed') === 'false',
                { text: btn && btn.textContent.trim(), ariaPressed: btn && btn.getAttribute('aria-pressed') });
        });

        // ---- Scenario 6b: the "×" dismiss button hides the banner but leaves the
        // stored blob completely untouched ----
        await runScenario('clicking the "×" dismiss button hides the banner but leaves the stored blob untouched', {
            presetFilterPrefsRaw: JSON.stringify({
                v: FILTER_VERSION, savedAt: Date.now(), prefs: { ...FILTER_DEFAULTS_LITERAL, selectedLanes: ['AN2'] },
            }),
        }, async (boot) => {
            record(SUITE, 'Setup: restored-filters banner is visible before the "×" dismiss button is clicked', bannerVisible(boot.doc));
            // Wait for the mount-time write-effect's own natural debounced flush to land
            // FIRST, and capture beforeRaw from THAT settled point -- not from immediately
            // after mount. Reading beforeRaw too early (before the app's own first write
            // has ever landed) would capture null, and the "still unchanged after the
            // debounce window" check below would then trivially fail once that unrelated,
            // always-happens-anyway mount write finally lands mid-wait -- a false failure
            // in this test, not a real bug (confirmed live while building this suite; see
            // Scenario 5 above, which gets this right via the same waitForWrite-first
            // pattern).
            const baselineOk = await waitForWrite(boot.win, () => true, 2500);
            record(SUITE, 'Setup: the initial mount-time write-effect establishes a clean baseline write in localStorage', baselineOk);
            if (!baselineOk) return;
            // Compare the PARSED prefs content (canon()), not the raw string. Confirmed
            // live while building this suite: the raw string is not a valid "unchanged"
            // signal here, because flushNow() stamps a fresh `savedAt: Date.now()` into
            // EVERY write regardless of whether `prefs` itself changed, and an entirely
            // UNRELATED background event -- the pinned CSV_SOURCE_URL fixture finishing its
            // load shortly after mount -- changes `availableYards`, which is in the
            // pre-existing yard-search mount effect's own dependency array (see this
            // suite's header comment and Scenario 2/2b above for that effect). That effect
            // re-fires, calls setSelectedYards([]) again (a semantically-unchanged, but
            // reference-NEW, empty array), which re-fires the write-effect and produces a
            // genuine extra localStorage write -- same prefs content, new savedAt, new raw
            // string. A raw-string comparison flags that as "changed"; comparing prefs
            // content does not, and is the correct standard for "did Dismiss alter the
            // stored filters" -- it explicitly does not, by design (see resetFilterPrefs
            // just above for the one action that does).
            const beforePrefs = readFilterPrefs(boot.win).prefs;
            const dismissBtn = findDismissBtn(boot.doc);
            if (!dismissBtn) { record(SUITE, 'Setup: "×" dismiss button found in the banner', false); return; }
            dismissBtn.click(); // setFilterPrefsRestored(false) ONLY -- no FilterPrefsStore.clear()
            const bannerGone = await waitFor(() => !bannerVisible(boot.doc), { timeout: 3000 });
            record(SUITE, 'Clicking the "×" dismiss button hides the banner', bannerGone);
            record(SUITE, 'Dismissing the banner does NOT clear or alter the stored filters (prefs content unchanged immediately after)',
                canon(readFilterPrefs(boot.win).prefs) === canon(beforePrefs));
            await new Promise(r => setTimeout(r, 500)); // past the 400ms debounce window
            record(SUITE, 'The stored filters are still content-identical after the debounce window elapses (dismiss never alters them, regardless of any unrelated background write incidentally refreshing savedAt in the meantime)',
                canon(readFilterPrefs(boot.win).prefs) === canon(beforePrefs));
        });

        // ANTI-SILENT-SKIP tripwire -- see this suite's header comment and Suite 10's
        // identical convention. Not itself one of the EXPECTED_RECORD_COUNT it counts.
        const recordedCount = allResults.length - startCount;
        record(SUITE, `Exactly ${EXPECTED_RECORD_COUNT} assertions were recorded for this suite (hardcoded tripwire against a future refactor silently dropping a check -- this suite depends on nothing but this page's own HTML and localStorage, so unlike Suite 8/9 it has no legitimate reason to ever skip; see AGENTS.md's "Check the executed-check count, not the pass rate" section)`,
            recordedCount === EXPECTED_RECORD_COUNT, { recordedCount, expected: EXPECTED_RECORD_COUNT });
    })();

    // ============================================================
    // SUITE 13: Gmail_Search_Debounce (VVD coverage added 2026-09-26; renamed and extended
    // to Vessel Name 2026-09-28) -- regression coverage for the "double-click a VVD cell
    // opens two Gmail tabs" bug fixed 2026-09-26, plus coverage that the SAME mechanism now
    // also drives Vessel Name cells. Every VVD/Vessel Name cell in this file is rendered by
    // the shared `vvdCell(vvd)`/`vesselCell(vessel)` helpers (search `const vvdCell = (vvd)
    // =>` in the app, ~line 970), whose <span role="button" tabIndex={0} data-gmail-search>
    // calls window.open() to search Gmail for that value on click/Enter/Space, via ONE
    // delegated listener pair shared by both fields (see the app's own comment on
    // `gmailSearchCellFromEvent`, and CODE_NOTES.md's "Gmail-Search Clickable Cells: URL,
    // Debounce, And Delegated Listener"). A real double-click fires two ordinary 'click'
    // events on the same span in quick succession -- without a guard, both call
    // window.open() and leave the user with two duplicate Gmail tabs. The fix is a plain
    // module-level debounce (`let lastGmailSearchOpen = { value: null, at: 0 }`,
    // deliberately NOT React state -- see its own comment for why), SHARED across both
    // fields since they funnel through the one listener pair: a second click on the SAME
    // value within 800ms of the first is a no-op; the same value clicked again after 800ms,
    // or a DIFFERENT value (VVD or vessel name) clicked at any time, opens normally.
    //
    // This suite runs on the MAIN page (not an isolated iframe, unlike Suites 10-12) --
    // the bug and its fix live entirely in module-scope state + window.open, nothing to
    // do with localStorage/server prefs, so there is no reason to boot a fresh instance.
    // No EXPECTED_RECORD_COUNT tripwire, matching Suites 1-9's convention rather than
    // Suites 10-12's isolated-iframe one.
    //
    // WHY POL BOOKING FLASH, NOT DETAIL: POL's row renderer (polDataRowElement) tags its
    // VVD/Vessel <td>s with `data-autofit-col="vvd"`/`data-autofit-col="vessel"` (used
    // elsewhere in this file for auto-fit overflow checks -- see Suite 3 above); Detail's
    // own VVD/Vessel <td>s carry no such attribute. That makes a real, currently-rendered
    // cell trivial and unambiguous to locate here: `td[data-autofit-col="vvd"]
    // span[role="button"]` can only ever match a REAL vvdCell span (a VMS/blank value
    // renders as plain text, no span at all -- see vvdCell/vesselCell's own early-return),
    // so no separate "is this a real value" filtering is needed.
    //
    // WHY THE VESSEL COVERAGE IS SHORTER THAN THE VVD COVERAGE: the double-click guard and
    // the 800ms-elapses-then-reopens behavior are properties of the ONE shared listener
    // pair, already exercised end-to-end against a VVD span above -- re-running that same
    // sequence against a vessel span would prove the same code path twice, not new
    // behavior. What IS new and worth its own assertions: that a real vessel cell renders
    // as a clickable Gmail-search span with the correct URL, and that the shared debounce
    // is keyed on VALUE, not "any Gmail-search click ever" -- i.e. clicking a vessel name
    // right after the VVD debounce tests above (different string, same 800ms window) still
    // opens Gmail rather than being silently swallowed by the VVD's still-active debounce
    // entry.
    //
    // WINDOW.OPEN STUBBING: same window/global `window` the app itself reads and writes
    // (this file runs injected into the live page, not a separate context), so replacing
    // `window.open` here really does intercept vvdCell's/vesselCell's own call. No suite in
    // this file has stubbed window.open before; Suite 11's XLSX.writeFile monkey-patch is
    // the existing precedent for "temporarily replace a global, always restore it in a
    // finally".
    // ============================================================
    await (async function gmailSearchDebounceSuite() {
        const SUITE = 'Gmail_Search_Debounce';
        if (!(await clickTab('POL Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
        if (!table) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }

        window.dispatchEvent(new CustomEvent('bookingflash:pol-render-all', { detail: true }));

        // waitFor, not a bare querySelector: a real VVD span still depends on at least one
        // non-VMS row existing in the uploaded file -- poll briefly rather than assume it's
        // already there the instant render-all/the tab switch resolves.
        await waitFor(() => !!table.querySelector('td[data-autofit-col="vvd"] span[role="button"]'));
        const vvdSpan = table.querySelector('td[data-autofit-col="vvd"] span[role="button"]');
        if (!vvdSpan) { record(SUITE, 'Setup: a real (non-VMS) VVD cell found on POL Booking Flash', false); return; }
        const vvdText = vvdSpan.textContent.trim();
        record(SUITE, 'Setup: a real (non-VMS) VVD cell found on POL Booking Flash', true, { vvd: vvdText });

        const realOpen = window.open;
        const openCalls = [];
        window.open = (...args) => { openCalls.push(args); return null; };
        // A mouse click opens Gmail after a 300ms defer (2026-09-28: so a double-click or a
        // text selection that ends on a VVD can cancel it) -- wait past it before counting.
        const settle = () => new Promise(r => setTimeout(r, 400));
        try {
            // A real double-click (click detail 1, then click detail 2) is text selection, not a
            // search: it must open nothing. getSelection is cleared first so only the detail-2
            // cancel is under test.
            window.getSelection()?.removeAllRanges();
            vvdSpan.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
            vvdSpan.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
            await settle();
            record(SUITE, 'A double-click on a VVD cell (click detail 1 then 2) opens NO Gmail tab -- it is text selection',
                openCalls.length === 0, { openCallCount: openCalls.length });

            // Two rapid synthetic clicks (.click(): detail 0), well within the 800ms debounce
            // window -- the second restarts the 300ms defer, so exactly one open results.
            vvdSpan.click();
            vvdSpan.click();
            await settle();
            const firstOpenAt = Date.now();
            record(SUITE, 'Two rapid clicks on the same VVD cell call window.open() exactly ONCE (800ms debounce), not twice',
                openCalls.length === 1, { openCallCount: openCalls.length, calls: openCalls.map(a => a[0]) });

            const firstUrl = openCalls[0] && openCalls[0][0];
            const strippedVvd = vvdText.replace(/"/g, ''); // vvdCell strips embedded quotes before encoding, same as here
            // Gmail's search route is a hash fragment (#search/...), not a path segment --
            // split on '#search/' below, not '/search/' (that literal never matches a hash
            // route and would make this assertion fail unconditionally regardless of VVD).
            record(SUITE, 'The single call opens a Gmail search for this VVD (not a blank/incorrect target)',
                typeof firstUrl === 'string' && firstUrl.startsWith('https://mail.google.com/mail/#search/') &&
                decodeURIComponent(firstUrl.split('#search/')[1] || '').includes(strippedVvd),
                { firstUrl });

            // A third click, after the 800ms debounce window has really elapsed (the open now
            // happens inside a timer, so patching Date.now around .click() no longer reaches it).
            await new Promise(r => setTimeout(r, Math.max(0, 850 - (Date.now() - firstOpenAt))));
            vvdSpan.click();
            await settle();
            record(SUITE, 'A click after the 800ms debounce window elapses opens Gmail again (the debounce does not permanently disable the cell)',
                openCalls.length === 2, { openCallCount: openCalls.length });

            // Vessel Name coverage (added 2026-09-28) -- see this suite's own header comment
            // for why this is shorter than the VVD coverage above rather than a full second
            // copy of the double-click/debounce/reopen sequence.
            await waitFor(() => !!table.querySelector('td[data-autofit-col="vessel"] span[role="button"]'));
            const vesselSpan = table.querySelector('td[data-autofit-col="vessel"] span[role="button"]');
            if (!vesselSpan) {
                record(SUITE, 'Setup: a real (non-VMS) Vessel Name cell found on POL Booking Flash', false);
            } else {
                const vesselText = vesselSpan.textContent.trim();
                record(SUITE, 'Setup: a real (non-VMS) Vessel Name cell found on POL Booking Flash', true, { vessel: vesselText });

                // The VVD debounce entry above (still within its own 800ms window as of the
                // prior assertion) must NOT suppress this click -- the shared debounce is
                // keyed on the clicked value, and a vessel name is a different string from
                // the VVD used above (POL's own data never puts the same string in both
                // columns on one row -- one is an alphanumeric code, the other a ship name).
                vesselSpan.click();
                await settle();
                record(SUITE, 'Clicking a Vessel Name cell right after the VVD debounce tests above still opens Gmail (the shared debounce is keyed on value, not "any prior Gmail-search click")',
                    openCalls.length === 3, { openCallCount: openCalls.length });

                const vesselUrl = openCalls[2] && openCalls[2][0];
                const strippedVessel = vesselText.replace(/"/g, ''); // vesselCell strips embedded quotes before encoding, same as here
                record(SUITE, 'That call opens a Gmail search for this Vessel Name (not a blank/incorrect target)',
                    typeof vesselUrl === 'string' && vesselUrl.startsWith('https://mail.google.com/mail/#search/') &&
                    decodeURIComponent(vesselUrl.split('#search/')[1] || '').includes(strippedVessel),
                    { vesselUrl });

                // Same-field double-click-shaped debounce also applies to Vessel Name --
                // the shared listener pair does not special-case which field it came from.
                vesselSpan.click();
                await settle();
                record(SUITE, 'A second rapid click on the SAME Vessel Name cell calls window.open() exactly ONCE total (800ms debounce applies to Vessel Name too)',
                    openCalls.length === 3, { openCallCount: openCalls.length });
            }
        } finally {
            window.open = realOpen;
        }
    })();

    // ============================================================
    // SUITE 14: Fields_Picker_ReAnchor (added 2026-09-26) -- regression coverage for the
    // "Fields popover stays anchored to where the trigger USED to be" bug fixed the same
    // day. The "⚙ Fields" trigger is rendered from ONE function
    // (`renderFieldPickerTrigger`, ~line 6415) but mounted at one of THREE mutually
    // exclusive call sites depending on `topPanelCollapsed`/`macroButtonsInFieldsOnly`/
    // `activeTab` (search `showFieldsTriggerCollapsed`/`showFieldsTriggerTabBarFallback`/
    // `showFieldsTriggerInMacroColumn`, ~line 6311-6313) -- e.g. inside the macro-button
    // column when filters are shown, or up in the tab-bar row once "Hide Filters" is
    // clicked (the whole macro column, including its copy of the trigger, unmounts).
    // `fieldPickerRect` (the popover's own anchor, set by `anchorFieldPicker()` reading
    // `fieldPickerBtnRef.current.getBoundingClientRect()`, ~line 6347) used to be
    // recomputed ONLY inside the trigger's own onClick -- fine while the popover's own
    // open/close is what moves it, but if the MOUNTED COPY swaps out from under an
    // ALREADY-OPEN popover (exactly what clicking "Hide Filters" does), nothing
    // recomputed `fieldPickerRect`, so the panel stayed floating at the old (now-vacated)
    // trigger's screen position. The fix is a `useLayoutEffect` keyed on
    // `[fieldPickerPinned, topPanelCollapsed, macroButtonsInFieldsOnly, activeTab]`
    // (~line 6389-6392) that re-anchors whenever any of those change while the popover
    // (`fieldPickerPinned`) is open.
    //
    // WHY A PLAIN .click() ON "HIDE FILTERS" ACTUALLY EXERCISES THIS: the app's own
    // comment on that useLayoutEffect notes this is confirmed reachable via keyboard --
    // pressing Enter on the Hide/Show Filters toggle fires no mousedown, so the
    // outside-click effect never closes the popover either. A synthetic
    // HTMLElement.click() (used below, and throughout this file) likewise dispatches
    // only a 'click' event, no 'mousedown' -- so it reaches the SAME code path as the
    // keyboard case without this suite needing to simulate a real keypress.
    //
    // This suite runs on the MAIN page for the same reason Suite 13 does: nothing here
    // touches localStorage/server prefs, so an isolated iframe would add mechanics with
    // no benefit.
    // ============================================================
    await (async function fieldsPickerReAnchorSuite() {
        const SUITE = 'Fields_Picker_ReAnchor';
        if (!(await clickTab('POL Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }

        const rectSummary = (r) => ({ top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), right: Math.round(r.right) });
        const findFilterToggleBtn = () => Array.from(document.querySelectorAll('button'))
            .find(b => { const t = b.textContent.trim(); return t === '▲ Hide Filters' || t === '▼ Show Filters'; });

        // Known starting state: filters SHOWN, so the trigger mounts in the macro-button
        // column (showFieldsTriggerInMacroColumn) -- the same starting position the
        // 2026-09-26 bug report reproduced from. Poll into a known state rather than
        // assume it, matching this file's own "poll for the actual condition" convention
        // (see waitFor's own header comment).
        let toggleBtn = findFilterToggleBtn();
        if (!toggleBtn) { record(SUITE, 'Setup: "▲ Hide Filters" / "▼ Show Filters" button found', false); return; }
        if (toggleBtn.textContent.trim() === '▼ Show Filters') {
            toggleBtn.click();
            await waitFor(() => findFilterToggleBtn().textContent.trim() === '▲ Hide Filters');
        }
        record(SUITE, 'Setup: filter panel starts visible ("▲ Hide Filters")',
            findFilterToggleBtn().textContent.trim() === '▲ Hide Filters');

        if (!(await fieldPickerTriggerAvailable())) {
            // Legitimate skip, not a failure -- same convention as Suite 11's own skip when
            // the picker is absent from an older build. Records nothing further, so the
            // executed-check count (not a false green) shows the skip.
            console.log(`ℹ️  SKIP [${SUITE}] -- no [data-field-picker-trigger] in this build/state.`);
            return;
        }

        const trigger = document.querySelector('[data-field-picker-trigger]');
        const triggerRectBefore = trigger.getBoundingClientRect();
        const panel = await openFieldPicker();
        if (!panel) { record(SUITE, 'Setup: field picker opens on click', false); return; }
        record(SUITE, 'Setup: field picker opens on click', true);

        // The action under test: toggle "Hide Filters" WITHOUT closing the popover first.
        // This swaps the mounted trigger copy out from under fieldPickerPinned -- exactly
        // the scenario the 2026-09-26 useLayoutEffect fix targets.
        const hideFiltersBtn = findFilterToggleBtn();
        hideFiltersBtn.click(); // topPanelCollapsed: false -> true
        // Poll for the trigger to have actually relocated, not a fixed delay -- same
        // reasoning as waitFor's own header comment on why clickTab polls instead of
        // guessing a settle time.
        await waitFor(() => {
            const t = document.querySelector('[data-field-picker-trigger]');
            return !!t && Math.abs(t.getBoundingClientRect().top - triggerRectBefore.top) > 5;
        });

        record(SUITE, 'The filter panel actually collapsed ("▼ Show Filters")',
            findFilterToggleBtn().textContent.trim() === '▼ Show Filters');

        const panelStillOpen = !!document.querySelector('[data-field-picker-panel]');
        record(SUITE, 'The Fields popover is STILL OPEN after "Hide Filters" swaps the mounted trigger copy out from under it (not silently closed)',
            panelStillOpen);
        if (!panelStillOpen) return;

        const triggerAfter = document.querySelector('[data-field-picker-trigger]');
        const triggerRectAfter = triggerAfter.getBoundingClientRect();
        const panelRectAfter = document.querySelector('[data-field-picker-panel]').getBoundingClientRect();

        record(SUITE, 'The mounted trigger copy actually moved to a materially different screen position',
            Math.abs(triggerRectAfter.top - triggerRectBefore.top) > 20 || Math.abs(triggerRectAfter.left - triggerRectBefore.left) > 20,
            { triggerRectBefore: rectSummary(triggerRectBefore), triggerRectAfter: rectSummary(triggerRectAfter) });

        // GAP matches the app's own panel-positioning constant (search `const GAP = 4` near
        // the panel's own render block, ~line 11698): `left = fieldPickerRect.left`
        // (clamped near viewport edges, not reproduced here) and, when not flipped up,
        // `top = fieldPickerRect.bottom + GAP`. TOL is tight (10px, not a generous band) and
        // requires the LEFT edge to match too -- a first version of this check compared only
        // top/bottom against a 60px band and passed for both the old AND new trigger
        // position simultaneously in a real layout where they sit ~40px apart vertically,
        // silently proving nothing. Requiring left to match as well is what actually
        // distinguishes "anchored to the new trigger" from "still stale at the old one".
        //
        // 2026-09-27: the viewport clamp IS reproduced now. Leaving it out made this check
        // fail whenever the trigger sits within a panel-width of the right edge -- e.g. the CI
        // runner's 1280px viewport: trigger.left 992, but the app (correctly) clamps the
        // panel to 1280 - (320 + 8) = 952 so it stays on screen. Same formula as the app's
        // own `left: Math.max(4, Math.min(fieldPickerRect.left, window.innerWidth - (PANEL_W + 8)))`,
        // with the panel's rendered width standing in for PANEL_W. The old/new distinction
        // still holds when both clamp to the same left: they then differ vertically.
        const GAP = 4, TOL = 10;
        const expectedLeft = (panelRect, triggerRect) =>
            Math.max(4, Math.min(triggerRect.left, window.innerWidth - (panelRect.width + 8)));
        const nearTrigger = (panelRect, triggerRect) =>
            Math.abs(panelRect.left - expectedLeft(panelRect, triggerRect)) <= TOL &&
            (Math.abs(panelRect.top - (triggerRect.bottom + GAP)) <= TOL ||
             Math.abs(panelRect.bottom - (triggerRect.top - GAP)) <= TOL);
        record(SUITE, 'The re-anchored popover is positioned against the NEW trigger rect, not left stale against the OLD one',
            nearTrigger(panelRectAfter, triggerRectAfter) && !nearTrigger(panelRectAfter, triggerRectBefore),
            {
                panelRectAfter: rectSummary(panelRectAfter),
                triggerRectBefore: rectSummary(triggerRectBefore),
                triggerRectAfter: rectSummary(triggerRectAfter),
            });

        // Cleanup: leave the page as this suite found it (filters visible, popover closed),
        // matching e.g. Suite 11's own end-of-suite restoration of the fields it toggled.
        await closeFieldPicker();
        const showBtn = findFilterToggleBtn();
        if (showBtn && showBtn.textContent.trim() === '▼ Show Filters') {
            showBtn.click();
            await waitFor(() => findFilterToggleBtn().textContent.trim() === '▲ Hide Filters');
        }
    })();

    // ============================================================
    // SUITE 15: OPUS_Schedule_Link (added 2026-09-28 as Calendar_Event_Link; repointed and
    // renamed 2026-10-01) -- regression coverage for the date-cell link icon
    // (dateScheduleLink/openScheduleLink in the app, search `const dateScheduleLink = `). It
    // started as an "Add to Google Calendar" deep link; on 2026-10-01 (per Kevin) every calendar
    // feature was removed and the icon now opens ONE's internal OPUS Container vessel schedule
    // screen. Same delegated-listener shape (a `data-schedule-link` span,
    // one document-level capture-phase 'click'/'keydown' pair, a 300ms defer + text-selection
    // guard so a double-click/drag-select doesn't open a tab) as Gmail_Search_Debounce's
    // `data-gmail-search` mechanism -- see that suite's own header comment.
    //
    // WHY POL, NOT DETAIL: POL's row renderer tags its Coastal ETD <td> with
    // `data-autofit-col="coastalEtd"` (used elsewhere for auto-fit checks -- see Suite 3), which
    // makes a real, currently-rendered date cell trivial to locate. render-all is dispatched
    // first, same reasoning as Suite 13.
    // ============================================================
    await (async function opusScheduleLinkSuite() {
        const SUITE = 'OPUS_Schedule_Link';
        const OPUS_URL = 'https://cntr.one-line.com/opuscntr/VOP_VSK_0012.do?pid=VOP_VSK_M007&MENU=Y&pgmNo=VOP_VSK_0012&parentPgmNo=VOP_VSK_M001&main_page=true&mainMenuLinkFlag=true&menuflag=true&mainPage=true';
        if (!(await clickTab('POL Booking Flash'))) { record(SUITE, 'Setup: tab button found', false); return; }
        const table = Array.from(document.querySelectorAll('table')).find((t) => t.checkVisibility());
        if (!table) { record(SUITE, 'Setup: table found', false, 'No data uploaded?'); return; }

        window.dispatchEvent(new CustomEvent('bookingflash:pol-render-all', { detail: true }));

        await waitFor(() => !!table.querySelector('td[data-autofit-col="coastalEtd"] span[data-schedule-link]'));
        const icon = table.querySelector('td[data-autofit-col="coastalEtd"] span[data-schedule-link]');
        if (!icon) { record(SUITE, 'Setup: a real (parseable-date) Coastal ETD OPUS link icon found on POL Booking Flash', false); return; }
        record(SUITE, 'Setup: a real (parseable-date) Coastal ETD OPUS link icon found on POL Booking Flash', true);

        const tip = icon.getAttribute('title') || '';
        record(SUITE, 'The icon tooltip names the sailing and says it opens OPUS',
            /Coastal ETD/.test(tip) && /OPUS/.test(tip), { tip });

        const realOpen = window.open;
        const openCalls = [];
        window.open = (...args) => { openCalls.push(args); return null; };
        // Capture what the click copies: the app copies via a hidden <textarea> +
        // execCommand('copy') (see copyTextToClipboard's comment for why that comes first), so
        // record the newest textarea's value at the moment 'copy' is executed.
        const realExec = document.execCommand;
        const copied = [];
        document.execCommand = function (cmd, ...rest) {
            if (cmd === 'copy') { const tas = document.body.querySelectorAll('textarea'); copied.push(tas.length ? tas[tas.length - 1].value : null); return true; }
            return realExec.call(document, cmd, ...rest);
        };
        const settle = () => new Promise(r => setTimeout(r, 400));
        try {
            // Same double-click-is-text-selection guard as Gmail_Search_Debounce -- see that
            // suite's own comment for why detail-1-then-2 must open nothing.
            window.getSelection()?.removeAllRanges();
            icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
            icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
            await settle();
            record(SUITE, 'A double-click on the OPUS link icon (click detail 1 then 2) opens NO tab -- it is text selection',
                openCalls.length === 0, { openCallCount: openCalls.length });

            icon.click();
            await settle();
            record(SUITE, 'A single click opens exactly one tab', openCalls.length === 1, { openCallCount: openCalls.length });

            const url = openCalls[0] && openCalls[0][0];
            record(SUITE, 'The opened URL is the OPUS Container vessel schedule screen',
                url === OPUS_URL, { url });

            // 2026-10-01: the click also copies the row's VVD (OPUS's URL can't carry it) and
            // shows a "Copied" note. The VVD must be the one shown in the icon's own row.
            const vvd = icon.getAttribute('data-vvd');
            const rowText = icon.closest('tr')?.textContent || '';
            record(SUITE, 'A single click copies the row\'s VVD to the clipboard and shows a "Copied" note',
                !!vvd && copied.length === 1 && copied[0] === vvd && rowText.includes(vvd) &&
                !!document.querySelector('[data-copied-note]') && document.querySelector('[data-copied-note]').textContent.includes(vvd),
                { vvd, copied, note: document.querySelector('[data-copied-note]')?.textContent });

            // 2026-10-01 review: the keyboard path. Enter on the focused icon opens exactly one tab
            // and leaves focus ON the icon (the hidden copy textarea used to drop it to <body>);
            // a held key (keydown with repeat:true) must not open again.
            openCalls.length = 0;
            icon.focus();
            icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat: true }));
            icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat: true }));
            await settle();
            record(SUITE, 'Enter on the focused icon opens exactly one tab (held-key repeats ignored) and keeps focus on the icon',
                openCalls.length === 1 && document.activeElement === icon,
                { openCallCount: openCalls.length, activeElement: document.activeElement && (document.activeElement.tagName + (document.activeElement.getAttribute('data-schedule-link') ? '[data-schedule-link]' : '')) });
        } finally {
            window.open = realOpen;
            document.execCommand = realExec;
        }

        // 2026-10-01 review: the 🔗 icon is UI, not data -- the Excel export must not carry it
        // (it used to turn every Coastal ETD / Port Cut cell into text like "6/19/26🔗").
        let exportedCells = null;
        if (window.XLSX && typeof window.XLSX.writeFile === 'function') {
            const realWriteFile = window.XLSX.writeFile;
            window.XLSX.writeFile = function (wb) {
                try {
                    exportedCells = [];
                    wb.SheetNames.forEach(n => window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false })
                        .forEach(r => (r || []).forEach(v => exportedCells.push(String(v == null ? '' : v)))));
                } catch (e) { exportedCells = { error: String(e && e.message || e) }; }
            };
            try {
                const settingsBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().endsWith('Settings'));
                if (settingsBtn) {
                    settingsBtn.click();
                    await waitFor(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Export'), { timeout: 5000 });
                }
                const exportBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Export');
                if (exportBtn) { exportBtn.click(); await waitFor(() => exportedCells !== null, { timeout: 15000 }); }
                else if (settingsBtn) settingsBtn.click();
            } finally {
                window.XLSX.writeFile = realWriteFile;
            }
        }
        const leakedIcons = Array.isArray(exportedCells) ? exportedCells.filter(v => v.includes('🔗')) : null;
        record(SUITE, 'The Excel export carries no 🔗 icon text in any cell (dates export as dates)',
            Array.isArray(exportedCells) && exportedCells.length > 0 && leakedIcons.length === 0,
            { exportedCellCount: Array.isArray(exportedCells) ? exportedCells.length : exportedCells, leakedSample: leakedIcons && leakedIcons.slice(0, 3) });

        // A blank/unparseable date must render NO icon at all (dateScheduleLink's own
        // early-return) -- best-effort: only asserted when a real example exists in the
        // currently-mounted rows, since whether one does depends on the uploaded file's data.
        const blankCoastalEtdCell = Array.from(table.querySelectorAll('td[data-autofit-col="coastalEtd"]'))
            .find(td => !td.querySelector('span[data-schedule-link]') && td.textContent.trim() === '');
        if (blankCoastalEtdCell) {
            record(SUITE, 'A blank Coastal ETD cell renders no OPUS link icon', true);
        } else {
            console.log(`ℹ️  SKIP [${SUITE}] -- no blank Coastal ETD cell in the currently-mounted rows to check against.`);
        }
    })();

    // ============================================================
    // SUITE 16: Server_Extras_UI_Gating (added 2026-09-28) -- regression coverage that the
    // Settings UI gated on `SERVER_EXTRAS` (the "Export to Drive" button -- search
    // `{SERVER_EXTRAS && (` in the app, near the Export button) renders NOTHING on this
    // deployment path. (A digest-recipients input was also checked here until the digest
    // feature was archived 2026-09-29.) This
    // suite runs the local static server with no Code.gs involved at all, so
    // `window.__SERVER_EXTRAS__` is never injected and `SERVER_EXTRAS` is `null` -- the exact
    // shape docs/SERVER_PREFS_CONTRACT.md's addendum documents as "on every non-Apps-Script
    // path... the global is simply absent". A regression here (the gate silently dropped) would
    // render a Save/Export button whose click handler checks `isServerExtrasSyncAvailable()`
    // internally and no-ops -- easy to miss visually, since the button would still LOOK clickable
    // -- which is exactly why this is asserted directly rather than left to "someone will notice
    // a dead button".
    //
    // Deliberately does NOT attempt to fake window.__SERVER_EXTRAS__/google.script.run to test
    // the POSITIVE case (the round trip actually saving/exporting) -- see
    // apps-script/README.md's own "cannot be meaningfully verified from a dev machine" note for
    // why, same reasoning as the three-boolean server prefs feature. This suite only proves the
    // negative-path gating, which IS fully testable locally.
    // ============================================================
    await (async function serverExtrasUiGatingSuite() {
        const SUITE = 'Server_Extras_UI_Gating';
        record(SUITE, 'Precondition: window.__SERVER_EXTRAS__ is absent on this deployment path (no Code.gs involved)',
            typeof window.__SERVER_EXTRAS__ === 'undefined');

        const settingsBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().endsWith('Settings'));
        if (!settingsBtn) { record(SUITE, 'Setup: "...Settings" button found', false); return; }
        settingsBtn.click();
        await waitFor(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Export'), { timeout: 5000 });
        record(SUITE, 'Setup: Settings popover opened (found the existing "Export" button)', true);

        const hasDriveExportBtn = Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim().includes('Export to Drive'));
        record(SUITE, 'The "Export to Drive" button does NOT render when SERVER_EXTRAS is unavailable', !hasDriveExportBtn);

        // Cleanup: close the popover, leaving the page as this suite found it.
        settingsBtn.click();
    })();

    // ============================================================
    // SUITE 17: Historical_PerDay_Archive (added 2026-09-29) -- the Historical Data popover's
    // per-day archive path (fetchPerDayArchiveIndex / loadParsedHistoricalRows in the app,
    // served by apps-script/Code.gs's ?archive=index and ?archive=day). That path only runs
    // when window.__EXEC_URL__ is set, which never happens on this local static server, so
    // Suite 9 above only ever covers the single-Sheet fallback. This suite boots two
    // isolated app instances in iframes (same document.write technique as Suite 10) with a
    // fake __EXEC_URL__ and a fetch wrapper standing in for Code.gs, serving the committed
    // historical fixture split per day:
    //   A. a working per-day archive -- the date list comes from the index (sorted newest
    //      first even when the server lists them out of order), the single published Sheet
    //      is never downloaded, viewing a date downloads just that date and renders its
    //      rows, and re-viewing a date uses the cache;
    //   B. an older Code.gs that answers ?archive=index with the app's HTML -- the popover
    //      must fall back to the single published Sheet, not show an empty list; and the same
    //      date viewed through that path must render the same rows, cell for cell, as A did;
    //   C. inside Apps Script (google.script.run present), the archive is read through
    //      getArchiveIndex / getArchiveDayCsv, never the ?archive= URLs (added 2026-09-29, once
    //      the web app moved to "Execute as: User accessing", where those URLs get a login page).
    // Every other request passes through to the real fetch (so the runner's CSV_SOURCE_URL
    // pin still applies). Nothing here depends on the Sector/Historical fixture pins.
    // ============================================================
    await (async function historicalPerDayArchiveSuite() {
        const SUITE = 'Historical_PerDay_Archive';
        const FAKE_EXEC = 'https://bfrt-fake-exec.test/exec';
        const LEGACY_SHEET_MARKER = '2PACX-1vR1YNb3SKa8jS53bK'; // HISTORICAL_DATA_CSV_URL's published-Sheet id
        const FIXTURE_ROW_COUNTS = { '2026-08-24': 7, '2026-08-25': 5, '2026-08-26': 4 }; // see Suite 9's own note: collision-free rows

        let appHtml = null, fixtureCsv = null;
        try {
            const [a, f] = await Promise.all([fetch(location.href), fetch('/tests/fixtures/historical_data_2026-08-24_to_2026-08-26.csv')]);
            if (a.ok) appHtml = await a.text();
            if (f.ok) fixtureCsv = await f.text();
        } catch { /* recorded by each scenario's Setup check below */ }
        // Split into CSV RECORDS, not lines: the fixture has a quoted cell with embedded line
        // breaks (TTLT0028W's remark), and a plain line split cuts that record in two -- which
        // silently drops/blanks rows and looks exactly like an app bug. Same quote-parity rule
        // as Code.gs's splitCsvRecords_.
        const splitRecords = (text) => {
            const out = [];
            let cur = [], inQuotes = false;
            for (const line of text.split(/\r?\n/)) {
                cur.push(line);
                inQuotes = (line.split('"').length - 1) % 2 === 1 ? !inQuotes : inQuotes;
                if (!inQuotes) { out.push(cur.join('\n')); cur = []; }
            }
            if (cur.length) out.push(cur.join('\n'));
            return out.filter(r => r !== '');
        };
        const fixtureRecords = fixtureCsv ? splitRecords(fixtureCsv) : [];
        const dayCsv = (date) => [fixtureRecords[0]].concat(fixtureRecords.slice(1).filter(r => r.startsWith(date + ','))).join('\r\n') + '\r\n';

        // Boots an isolated instance whose fetch answers the fake /exec URL via `serveExec`
        // and the single published Sheet with the fixture, logging every request it handles.
        // `scriptRunHandlers` (optional) installs a fake google.script.run whose methods answer
        // asynchronously from those handlers, like the real one; each call is logged in log.run.
        const boot = async (serveExec, scriptRunHandlers) => {
            const log = { exec: [], legacySheet: 0, run: [] };
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-3000px;left:-3000px;width:1280px;height:900px;border:0;';
            document.body.appendChild(iframe);
            const win = iframe.contentWindow;
            const cleanup = () => { try { iframe.remove(); } catch { } };
            if (!appHtml || !fixtureCsv) return { win, doc: null, mounted: false, log, cleanup };
            const realFetch = win.fetch.bind(win);
            const reply = (body, type) => Promise.resolve(new win.Response(body, { status: 200, headers: { 'Content-Type': type } }));
            win.__EXEC_URL__ = FAKE_EXEC;
            if (scriptRunHandlers) {
                const runner = (onOk, onFail) => {
                    const r = { withSuccessHandler: fn => runner(fn, onFail), withFailureHandler: fn => runner(onOk, fn) };
                    Object.keys(scriptRunHandlers).forEach(name => {
                        r[name] = (...args) => {
                            log.run.push(args.length ? `${name}:${args[0]}` : name);
                            setTimeout(() => {
                                let out;
                                try { out = scriptRunHandlers[name](...args); } catch (err) { if (onFail) onFail(err); return; }
                                if (onOk) onOk(out);
                            }, 5);
                        };
                    });
                    return r;
                };
                win.google = { script: { run: runner(null, null) } };
            }
            win.fetch = (input, init) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url.startsWith(FAKE_EXEC)) {
                    const q = new URL(url).searchParams;
                    if (q.get('check') === 'version') return reply('0123456789abcdef0123456789abcdef', 'text/plain');
                    log.exec.push(q.get('archive') === 'day' ? `day:${q.get('date')}` : q.get('archive'));
                    return serveExec(q, reply);
                }
                if (url.includes(LEGACY_SHEET_MARKER)) {
                    log.legacySheet++;
                    return reply(fixtureCsv, 'text/csv');
                }
                return realFetch(input, init);
            };
            iframe.contentDocument.open();
            iframe.contentDocument.write(appHtml);
            iframe.contentDocument.close();
            const doc = iframe.contentDocument;
            const mounted = await waitFor(() => Array.from(doc.querySelectorAll('button')).some(b => b.textContent.trim() === 'Trade Summary'), { timeout: 25000 });
            return { win, doc, mounted, log, cleanup };
        };
        const popoverDates = (doc) => {
            const closeBtn = Array.from(doc.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Close historical data panel');
            const scope = closeBtn && closeBtn.closest('.absolute');
            return scope ? Array.from(scope.querySelectorAll('button')).filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.textContent.trim())) : [];
        };
        const openPopover = async (doc) => {
            const histBtn = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('🗓️ Historical Data'));
            if (!histBtn) return false;
            histBtn.click();
            return waitFor(() => popoverDates(doc).length > 0, { timeout: 15000 });
        };
        const viewDate = async (doc, date) => {
            const btn = popoverDates(doc).find(b => b.textContent.trim() === date);
            if (!btn) return false;
            btn.click();
            return waitFor(() => Array.from(doc.querySelectorAll('span')).some(s => s.textContent.includes(`Viewing historical data for ${date}`)), { timeout: 10000 });
        };
        // Visible Booking Flash rows' cell text, spacer rows excluded -- for comparing the two
        // parse paths row for row.
        const bookingFlashRowTexts = (doc) => {
            const table = Array.from(doc.querySelectorAll('table')).find(t => t.checkVisibility());
            return table ? Array.from(table.querySelectorAll('tbody tr')).filter(tr => !tr.querySelector('td[colspan]'))
                .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()).join('|')) : [];
        };
        let perDayRowTexts = null;
        const bookingFlashRowCount = async (doc) => {
            const tab = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === 'Booking Flash');
            if (tab) tab.click();
            await waitFor(() => Array.from(doc.querySelectorAll('table')).some(t => t.checkVisibility() && t.querySelector('tbody tr')), { timeout: 5000 });
            const table = Array.from(doc.querySelectorAll('table')).find(t => t.checkVisibility());
            // Exclude the Detail table's per-Lane spacer rows (see Suite 9's row-count note).
            return table ? Array.from(table.querySelectorAll('tbody tr')).filter(tr => !tr.querySelector('td[colspan]')).length : null;
        };

        // --- A: a working per-day archive ---
        const a = await boot((q, reply) => {
            if (q.get('archive') === 'index') {
                return reply(JSON.stringify({ ok: true, dates: ['2026-08-24', '2026-08-26', '2026-08-25'] }), 'application/json');
            }
            return reply(dayCsv(q.get('date')), 'text/csv');
        });
        try {
            record(SUITE, 'Setup: isolated app instance mounted with a fake Apps Script archive', a.mounted,
                a.mounted ? undefined : { appHtml: !!appHtml, fixtureCsv: !!fixtureCsv });
            if (a.mounted) {
                await openPopover(a.doc);
                const dates = popoverDates(a.doc).map(b => b.textContent.trim());
                record(SUITE, 'Per-day: the popover lists the archive index\'s dates, newest first',
                    JSON.stringify(dates) === JSON.stringify(['2026-08-26', '2026-08-25', '2026-08-24']), { dates });
                record(SUITE, 'Per-day: the single published Sheet is never downloaded',
                    a.log.legacySheet === 0, { legacySheetFetches: a.log.legacySheet });

                const viewed = await viewDate(a.doc, '2026-08-24');
                record(SUITE, 'Per-day: viewing a date downloads only that date and shows it',
                    viewed && JSON.stringify(a.log.exec) === JSON.stringify(['index', 'day:2026-08-24']), { viewed, execCalls: a.log.exec });
                const rows = await bookingFlashRowCount(a.doc);
                perDayRowTexts = bookingFlashRowTexts(a.doc);
                record(SUITE, 'Per-day: the viewed date renders exactly its own fixture row count on Booking Flash',
                    rows === FIXTURE_ROW_COUNTS['2026-08-24'], { rows, expected: FIXTURE_ROW_COUNTS['2026-08-24'] });

                // The popover stays open across a view (see its own markup), so pick again.
                if (popoverDates(a.doc).length === 0) await openPopover(a.doc);
                await viewDate(a.doc, '2026-08-25');
                const back = await viewDate(a.doc, '2026-08-24');
                record(SUITE, 'Per-day: re-viewing an already-downloaded date uses the cache (no second download)',
                    back && a.log.exec.filter(c => c === 'day:2026-08-24').length === 1, { execCalls: a.log.exec });
            }
        } finally {
            a.cleanup();
        }

        // --- B: an older Code.gs that serves the app's HTML for any query string ---
        const b = await boot((q, reply) => reply('<!DOCTYPE html><html><body>app</body></html>', 'text/html'));
        try {
            record(SUITE, 'Setup: isolated app instance mounted with an older Code.gs (no archive endpoint)', b.mounted);
            if (b.mounted) {
                await openPopover(b.doc);
                const dates = popoverDates(b.doc).map(x => x.textContent.trim());
                record(SUITE, 'Fallback: with no usable archive index, the popover falls back to the single published Sheet',
                    b.log.legacySheet === 1 && JSON.stringify(dates) === JSON.stringify(['2026-08-26', '2026-08-25', '2026-08-24']),
                    { legacySheetFetches: b.log.legacySheet, dates, execCalls: b.log.exec });
                // Same date through the single-Sheet path: every cell must match what the
                // per-day path rendered in scenario A (the per-day file is parsed like the live
                // export; the Sheet path goes through a json_to_sheet round trip).
                await viewDate(b.doc, '2026-08-24');
                await bookingFlashRowCount(b.doc);
                const sheetRowTexts = bookingFlashRowTexts(b.doc);
                record(SUITE, 'The per-day path renders the same Booking Flash rows, cell for cell, as the single-Sheet path for the same date',
                    !!perDayRowTexts && perDayRowTexts.length > 0 && JSON.stringify(perDayRowTexts) === JSON.stringify(sheetRowTexts),
                    { perDayRows: perDayRowTexts && perDayRowTexts.length, sheetRows: sheetRowTexts.length });
            }
        } finally {
            b.cleanup();
        }

        // --- C: inside Apps Script (google.script.run present) ---
        // The deployed web app runs as the visitor, so a fetch() of /exec carries no sign-in
        // and gets a login page; the app must read the archive through google.script.run
        // instead, and must not touch the ?archive= URLs at all. The fake /exec answers with
        // HTML here, exactly what the real one would, so a regression to fetch() fails loudly.
        const c = await boot((q, reply) => reply('<!DOCTYPE html><html><body>sign in</body></html>', 'text/html'), {
            getArchiveIndex: () => ({ ok: true, dates: ['2026-08-24', '2026-08-26', '2026-08-25'] }),
            getArchiveDayCsv: (date) => ({ ok: true, date, csv: dayCsv(date) }),
        });
        try {
            record(SUITE, 'Setup: isolated app instance mounted with a fake google.script.run archive', c.mounted);
            if (c.mounted) {
                await openPopover(c.doc);
                const dates = popoverDates(c.doc).map(x => x.textContent.trim());
                record(SUITE, 'google.script.run: the popover lists the archive\'s dates, without fetching /exec or the single Sheet',
                    JSON.stringify(dates) === JSON.stringify(['2026-08-26', '2026-08-25', '2026-08-24']) &&
                        c.log.exec.length === 0 && c.log.legacySheet === 0,
                    { dates, execCalls: c.log.exec, legacySheetFetches: c.log.legacySheet, runCalls: c.log.run });
                await viewDate(c.doc, '2026-08-24');
                await bookingFlashRowCount(c.doc);
                const runRowTexts = bookingFlashRowTexts(c.doc);
                record(SUITE, 'google.script.run: viewing a date loads it with getArchiveDayCsv and renders the same rows as the /exec path',
                    JSON.stringify(c.log.run) === JSON.stringify(['getArchiveIndex', 'getArchiveDayCsv:2026-08-24']) &&
                        !!perDayRowTexts && perDayRowTexts.length > 0 && JSON.stringify(runRowTexts) === JSON.stringify(perDayRowTexts),
                    { runCalls: c.log.run, rows: runRowTexts.length, perDayRows: perDayRowTexts && perDayRowTexts.length });
            }
        } finally {
            c.cleanup();
        }
    })();

    // ============================================================
    // SUITE 18: Apps_Script_Team_Features (added 2026-09-29) -- the four features that only exist
    // inside Apps Script (google.script.run present), none of which the normal local run can
    // reach, so Suites 1-17 never exercise them:
    //   1. Data feed: fetchCsvText / fetchAndApplySectorData read the live export and the sector
    //      CSV through google.script.run.getDataFeed (gzip, `have`/`unchanged`), and fall back to
    //      fetching the published Sheets directly when it answers {ok:false}.
    //   2. VVD notes: getVvdNotes / saveVvdNote, the "📝 Notes" button, the per-VVD badge on the
    //      Detail and POL tables, and the notes dialog.
    //   3. Startup-error log: __bfShowBootFailure also calls logClientStartupError.
    //   4. Config: window.__SERVER_CONFIG__, validated by resolveServerConfig.
    // Same technique as Suites 10 and 17: isolated iframes booted with document.open/write, the
    // fakes (google.script.run, __SERVER_CONFIG__, a fetch wrapper) installed on the iframe's own
    // window BEFORE the app script parses. Two boots, the minimum for both directions:
    //   CONTROL  every server call fails or is refused ({ok:false,'busy'}, 'not-configured',
    //            'rate-limited') and __SERVER_CONFIG__ is full of bad values -> the data comes from
    //            the direct fetch, no notes UI, defaults everywhere, a warning per bad value. It is
    //            also this suite's baseline for what the same data looks like with no server help.
    //   SERVER   everything works: gzip feed, notes, a valid config.
    // The fake google.script.run deep-copies every argument and reply (like the real one):
    // returning shared objects once let a test mutate app state in place.
    // Nothing depends on the Sector/Historical fixture pins: the wrapper serves the committed
    // fixtures for the two live Sheet URLs itself. The parent page is used only as a reference for
    // "the same data loaded the direct way".
    // POL EXCEL EXPORT AND AUTO-FIT: the export builder (polExportBuilderRef) is not reachable from
    // outside the app, but exportToExcel itself is -- the suite stubs the iframe's XLSX.writeFile
    // (Suite 11's technique), clicks Settings > Export and reads every exported cell. Auto-fit is
    // checked behaviorally: with notes on screen the POL VVD column must come out the same width
    // as in the notes-free control (the badge would make the widest VVD cell wider).
    // ANTI-SILENT-SKIP: like Suite 10, this suite installs every fake it needs and has no
    // legitimate reason to skip; the last check pins the exact number of records.
    // ============================================================
    await (async function appsScriptTeamFeaturesSuite() {
        const SUITE = 'Apps_Script_Team_Features';
        // Hardcoded, not derived -- see Suite 10's note. Excludes the tripwire record itself.
        const EXPECTED_RECORD_COUNT = 80;
        const startCount = allResults.length;
        const rec = (name, pass, detail) => record(SUITE, name, pass, detail);
        const LIVE_MARKER = '2PACX-1vQNykGT8bYqwDC4k9loE5L8';     // CSV_SOURCE_URL's published-Sheet id
        const SECTOR_MARKER = '2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS';  // SECTOR_DATA_CSV_URL's
        const ME = 'kevin@example.com';
        const NOTE_SUFFIX = '\n(click to open notes)';
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const HAS_RED = (tr) => /fecaca/.test(tr.className);

        let appHtml = null, liveCsv = null, sectorCsv = null;
        try {
            const [a, l, s] = await Promise.all([fetch(location.href), fetch('/tests/fixtures/live_csv_2026-08-12.csv'), fetch('/tests/fixtures/sector_data_2026-09-16.csv')]);
            if (a.ok) appHtml = await a.text();
            if (l.ok) liveCsv = await l.text();
            if (s.ok) sectorCsv = await s.text();
        } catch { /* recorded just below */ }
        rec('Setup: fetched the app HTML and the live + sector fixtures for the isolated boots', !!(appHtml && liveCsv && sectorCsv),
            { appHtml: !!appHtml, liveCsv: !!liveCsv, sectorCsv: !!sectorCsv });

        const gzipBase64 = async (text) => {
            const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
            const b = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
            return btoa(bin);
        };
        const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

        // A fake google.script.run: `handlers[name](...args)` may be async; each call is logged in
        // `calls` and answers (or fails) a few ms later through the with*Handler chain.
        const makeFake = (handlers) => {
            const calls = [], replies = [];
            let seq = 0; // one counter across calls and replies, so their relative order can be checked
            const runner = (onOk, onFail) => {
                const r = { withSuccessHandler: fn => runner(fn, onFail), withFailureHandler: fn => runner(onOk, fn) };
                Object.keys(handlers).forEach(name => {
                    r[name] = (...args) => {
                        const argsCopy = copy(args);
                        calls.push({ name, args: argsCopy, at: ++seq });
                        setTimeout(async () => {
                            let out;
                            try { out = copy(await handlers[name](...argsCopy)); } catch (err) { if (onFail) onFail(err); return; }
                            replies.push({ name, out, at: ++seq });
                            if (onOk) onOk(out);
                        }, 10);
                    };
                });
                return r;
            };
            return { run: runner(null, null), calls, replies };
        };

        const tabBtn = (doc, label) => Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === label);
        const gotoTab = async (doc, label) => {
            const btn = tabBtn(doc, label);
            if (!btn) return false;
            btn.click();
            await waitFor(() => !btn.className.includes('bg-gray-300'));
            return true;
        };
        const visibleTable = (doc) => Array.from(doc.querySelectorAll('table')).find(t => t.checkVisibility());
        // Booking Flash rows, spacer rows excluded (see Suite 9's note on the Detail table).
        const detailRows = (doc) => {
            const t = visibleTable(doc);
            return t ? Array.from(t.querySelectorAll('tbody tr')).filter(tr => !tr.querySelector('td[colspan]')) : [];
        };
        const detailRowCount = async (doc) => {
            await gotoTab(doc, 'Booking Flash');
            await waitFor(() => detailRows(doc).length > 0, { timeout: 30000 });
            return detailRows(doc).length;
        };
        // Sector Summary's two pivots as leaf rows (Trade/Sub Trade/Lane[/POD Sector] carried
        // forward across rowSpan-merged cells, exactly like Suite 2's extractLeafRows).
        const sectorLeaves = (doc, caption, depth) => {
            const table = Array.from(doc.querySelectorAll('table')).find(t => t.querySelector('caption') && t.querySelector('caption').textContent === caption);
            if (!table) return null;
            const path = new Array(depth).fill(null), out = [];
            Array.from(table.querySelectorAll('tbody tr')).forEach(tr => {
                let sawDeepest = false;
                Array.from(tr.children).forEach(td => {
                    const m = /^rowLabels-(\d+)$/.exec(td.getAttribute('data-autofit-col') || '');
                    if (!m) return;
                    path[Number(m[1])] = td.textContent.trim().replace(/^\[Port Excluded\] /, '');
                    if (Number(m[1]) === depth - 1) sawDeepest = true;
                });
                if (sawDeepest && path.every(p => p !== null)) out.push({ path: path.slice(), red: HAS_RED(tr), labelled: tr.textContent.includes('[Port Excluded]') });
            });
            return out;
        };
        const sectorView = async (doc) => {
            await gotoTab(doc, 'Sector Summary');
            await waitFor(() => !!sectorLeaves(doc, 'Average Max Laden vs Booking', 3) && !!sectorLeaves(doc, 'Sector Summary', 4) && sectorLeaves(doc, 'Sector Summary', 4).length > 0, { timeout: 15000 });
            const left = sectorLeaves(doc, 'Average Max Laden vs Booking', 3) || [];
            const right = sectorLeaves(doc, 'Sector Summary', 4) || [];
            return {
                lanes: Array.from(new Set(left.map(l => l.path[2]))),
                rightPairs: right.map(l => `${l.path[2]}|${l.path[3]}`),
                redPairs: right.filter(l => l.red).map(l => `${l.path[2]}|${l.path[3]}`),
                labelledPairs: right.filter(l => l.labelled).map(l => `${l.path[2]}|${l.path[3]}`),
            };
        };
        // Settings popover text lines. Returns null (after closing nothing) if Settings is absent.
        const settingsBtn = (doc) => Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim().endsWith('Settings'));
        const readSettingsLines = async (doc) => {
            const btn = settingsBtn(doc);
            if (!btn) return null;
            btn.click();
            await waitFor(() => Array.from(doc.querySelectorAll('button')).some(b => b.textContent.trim() === 'Export'), { timeout: 5000 });
            const dataDiv = Array.from(doc.querySelectorAll('div')).find(d => /^Data:/.test(d.textContent));
            const cfgDiv = Array.from(doc.querySelectorAll('div')).find(d => /^Config Sheet:/.test(d.textContent));
            const out = {
                data: dataDiv ? dataDiv.textContent.trim() : null,
                config: cfgDiv && cfgDiv.firstChild ? cfgDiv.firstChild.textContent.trim() : null,
                warnings: cfgDiv ? Array.from(cfgDiv.children).map(c => c.textContent.trim()).filter(t => t.startsWith('⚠️')) : [],
            };
            btn.click(); // close again
            return out;
        };
        // Clicks Settings > Export with XLSX.writeFile stubbed; resolves to every exported cell.
        const captureExport = async (doc, win) => {
            let cells = null;
            const real = win.XLSX.writeFile;
            win.XLSX.writeFile = (wb) => {
                cells = [];
                wb.SheetNames.forEach(n => {
                    const ws = wb.Sheets[n];
                    Object.keys(ws).forEach(k => { if (k[0] !== '!') { const c = ws[k]; cells.push(String(c.w != null ? c.w : (c.v != null ? c.v : ''))); } });
                });
            };
            try {
                const btn = settingsBtn(doc);
                if (btn) {
                    btn.click();
                    await waitFor(() => Array.from(doc.querySelectorAll('button')).some(b => b.textContent.trim() === 'Export'), { timeout: 5000 });
                }
                const exportBtn = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === 'Export');
                if (exportBtn) {
                    exportBtn.click();
                    await waitFor(() => cells !== null, { timeout: 15000 });
                } else if (btn) btn.click();
            } finally {
                win.XLSX.writeFile = real;
            }
            return cells;
        };

        // Boots one isolated app instance. `handlers` becomes google.script.run, `config`
        // becomes window.__SERVER_CONFIG__, and every fetch of the two live Sheet URLs is answered
        // with the committed fixture (and counted).
        const boot = async ({ handlers, config }) => {
            const log = { direct: { live: 0, sector: 0 } };
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-3000px;left:-3000px;width:1280px;height:900px;border:0;';
            document.body.appendChild(iframe);
            const win = iframe.contentWindow;
            const cleanup = () => { try { iframe.remove(); } catch { } };
            const fake = makeFake(handlers);
            const out = { win, doc: null, mounted: false, log, fake, cleanup };
            if (!appHtml || !liveCsv || !sectorCsv) return out;
            const realFetch = win.fetch.bind(win);
            const csvReply = (text) => Promise.resolve(new win.Response(text, { status: 200, headers: { 'Content-Type': 'text/csv' } }));
            win.fetch = (input, init) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url.includes(LIVE_MARKER)) { log.direct.live++; return csvReply(liveCsv); }
                if (url.includes(SECTOR_MARKER)) { log.direct.sector++; return csvReply(sectorCsv); }
                return realFetch(input, init);
            };
            win.google = { script: { run: fake.run } };
            win.__SERVER_CONFIG__ = config;
            iframe.contentDocument.open();
            iframe.contentDocument.write(appHtml);
            iframe.contentDocument.close();
            out.doc = iframe.contentDocument;
            out.mounted = await waitFor(() => Array.from(out.doc.querySelectorAll('button')).some(b => b.textContent.trim() === 'Trade Summary'), { timeout: 25000 });
            return out;
        };
        const polSetRenderAll = (win, on) => win.dispatchEvent(new win.CustomEvent('bookingflash:pol-render-all', { detail: on }));
        const polVvdSpans = (doc) => { const t = visibleTable(doc); return t ? Array.from(t.querySelectorAll('td[data-autofit-col="vvd"] span[data-gmail-search]')) : []; };
        const polVvdThWidth = (doc) => {
            const t = visibleTable(doc);
            const d = t && t.querySelector('thead [data-autofit-col="vvd"]');
            const th = d && d.closest('th');
            return th ? th.style.width : null;
        };
        const norm = (s) => String(s).trim().toUpperCase();

        // ---------------- CONTROL boot ----------------
        // Everything server-side fails: the baseline, and the fallback / not-configured paths.
        const controlConfig = {
            available: true,
            settings: {
                'scheduleChange.perLaneRemovedRatePct': '150',   // above the 1-100 range
                'scheduleChange.laneSizeForRatePct': '2.5',      // not a whole number
                'scheduleChange.laneNetLossThreshold': 'abc',    // not a number
                'sectorSummary.laneExclude': 'EXE, no way!',     // "WAY!" is not a lane code
            },
            unknownKeys: ['foo.bar'],
            portExclusions: [{ lane: 'MS2', port: 'SG' }],       // port is not 5 letters
        };
        const control = await boot({
            handlers: {
                getDataFeed: () => ({ ok: false, reason: 'busy' }),
                getVvdNotes: () => ({ ok: false, reason: 'not-configured' }),
                logClientStartupError: () => ({ ok: true, logged: 'rate-limited' }),
            },
            config: controlConfig,
        });
        let controlRows = null, controlSector = null, controlPolWidth = null;
        try {
            rec('Setup: isolated app instance mounted with every server call failing (control)', control.mounted);
            if (control.mounted) {
                controlRows = await detailRowCount(control.doc);
                const feedCalls = control.fake.calls.filter(c => c.name === 'getDataFeed').map(c => c.args[0].name).sort();
                rec('Fallback: getDataFeed answered {ok:false,"busy"} for both feeds, and the data still loaded through the direct Sheet fetch',
                    JSON.stringify(feedCalls) === JSON.stringify(['live', 'sector']) && control.log.direct.live >= 1 && control.log.direct.sector >= 1 && controlRows > 0,
                    { feedCalls, directFetches: control.log.direct, rows: controlRows });
                const lines = await readSettingsLines(control.doc);
                rec('Fallback: Settings says the data was downloaded directly from the published Sheet',
                    !!lines && lines.data === 'Data: downloaded directly from the published Sheet.', { lines });
                rec('Config (invalid): every bad value is ignored with its own warning, and only the Port Exclusions array counts as applied',
                    !!lines && lines.config === 'Config Sheet: 1 setting(s) applied.' && lines.warnings.length === 6 &&
                        lines.warnings.some(w => w.includes('scheduleChange.perLaneRemovedRatePct: "150" must be a number from 1 to 100; using the default')) &&
                        lines.warnings.some(w => w.includes('scheduleChange.laneSizeForRatePct: "2.5" must be a whole number from 1 to 1000; using the default')) &&
                        lines.warnings.some(w => w.includes('scheduleChange.laneNetLossThreshold: "abc" must be a whole number from 1 to 1000; using the default')) &&
                        lines.warnings.some(w => w.includes('sectorSummary.laneExclude: "WAY!" is not a lane code; using the default')) &&
                        lines.warnings.some(w => w.includes('"foo.bar" is not a setting this app reads')) &&
                        lines.warnings.some(w => w.includes('Port Exclusions: "MS2 / SG" is not a lane + 5-letter port code; skipped')),
                    { lines });

                controlSector = await sectorView(control.doc);
                // Notes UI must stay hidden: the server said not-configured.
                await detailRowCount(control.doc);
                const detailBadges = control.doc.querySelectorAll('[data-vvd-notes]').length;
                await gotoTab(control.doc, 'POL Booking Flash');
                await waitFor(() => polVvdSpans(control.doc).length > 0, { timeout: 15000 });
                const polBadges = control.doc.querySelectorAll('[data-vvd-notes]').length;
                controlPolWidth = polVvdThWidth(control.doc);
                const notesBtn = Array.from(control.doc.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('📝'));
                rec('Notes (not configured): getVvdNotes was asked and refused, and there is no Notes button and no badge on Detail or POL',
                    control.fake.calls.some(c => c.name === 'getVvdNotes') && !notesBtn && detailBadges === 0 && polBadges === 0 && polVvdSpans(control.doc).length > 0,
                    { asked: control.fake.calls.some(c => c.name === 'getVvdNotes'), notesBtn: !!notesBtn, detailBadges, polBadges });

                // Startup log: rate-limited -> the box's "sent" line stays empty.
                const startupBefore = control.fake.calls.filter(c => c.name === 'logClientStartupError').length;
                control.win.__bfShowBootFailure('synthetic control');
                await waitFor(() => control.fake.replies.some(r => r.name === 'logClientStartupError'), { timeout: 5000 });
                await sleep(300);
                const reported = control.doc.getElementById('bf-boot-reported');
                rec('Startup log (rate-limited): the boot-failure box calls logClientStartupError but its "sent" line stays empty',
                    startupBefore === 0 && !!reported && reported.textContent === '' &&
                        control.fake.calls.filter(c => c.name === 'logClientStartupError').length === 1,
                    { startupBefore, reportedText: reported && reported.textContent });
            }
        } catch (err) {
            rec('Control scenario ran to the end without throwing', false, { error: String(err && err.stack || err) });
        } finally {
            control.cleanup();
        }

        // ---------------- SERVER boot ----------------
        // Reference values from the control (or the parent page when the control is missing).
        await gotoTab(document, 'Booking Flash');
        await waitFor(() => detailRows(document).length > 0, { timeout: 15000 });
        const parentRows = detailRows(document).length;
        const parentSector = await sectorView(document);
        // The lane to hide and the (lane, port) pair to paint red both come from the control's own
        // pivots, so they are guaranteed to exist in this data.
        const hideLane = controlSector ? controlSector.lanes.filter(l => l !== 'EXE' && l !== 'EXW').slice(-1)[0] : null;
        const redPair = controlSector && controlSector.rightPairs.length ? controlSector.rightPairs[controlSector.rightPairs.length - 1] : null;
        const [redLane, redPort] = redPair ? redPair.split('|') : [null, null];

        const feedStore = {};
        // feedMode.liveBusy: answer the next live request `busy` (the app then fetches directly).
        // feedMode.olderThanDirect: answer a request carrying notOlderThanMs with `older`, the way
        // the server does when its copy predates the browser's own direct download.
        const feedMode = { liveBusy: false, olderThanDirect: false };
        const feedReply = async (name, have, gzip, notOlderThanMs) => {
            if (name === 'live' && feedMode.liveBusy) { feedMode.liveBusy = false; return { ok: false, reason: 'busy' }; }
            if (!feedStore[name]) { const text = name === 'live' ? liveCsv : sectorCsv; feedStore[name] = { text, hash: `${name}-${text.length}`, gz: null }; }
            const s = feedStore[name];
            const base = { ok: true, name, hash: s.hash, fetchedAt: '2026-09-29T12:00:00.000Z' };
            if (have === s.hash) return { ...base, unchanged: true };
            if (feedMode.olderThanDirect && typeof notOlderThanMs === 'number') return { ...base, ageMs: notOlderThanMs + 60000, older: true };
            if (gzip) { if (!s.gz) s.gz = await gzipBase64(s.text); return { ...base, encoding: 'gzip-base64', data: s.gz }; }
            return { ...base, encoding: 'text', data: s.text };
        };
        const notesStore = { notes: [{ vvd: 'ZZ9999Z', note: 'a note on a VVD that is not in the data', author: 'bob@example.com', updatedAt: '2020-01-01T08:00:00.000Z' }] };
        const server = await boot({
            handlers: {
                getDataFeed: (req) => (liveCsv && sectorCsv ? feedReply(req.name, req.have, req.gzip, req.notOlderThanMs) : { ok: false, reason: 'no-fixture' }),
                // Like TeamSheet.gs: public notes for everyone plus ME's own private ones (the real
                // server never returns another visitor's private note), one note per (VVD, author, visibility).
                getVvdNotes: () => ({ ok: true, me: ME, notes: notesStore.notes, privateAvailable: notesStore.privateAvailable !== false }),
                saveVvdNote: (vvd, note, visibility) => {
                    notesStore.notes = notesStore.notes.filter(n => !(n.vvd === vvd && n.author === ME && n.visibility === visibility));
                    if (note) notesStore.notes.push({ vvd, note, author: ME, updatedAt: new Date().toISOString(), visibility });
                    return { ok: true, me: ME, notes: notesStore.notes, privateAvailable: true };
                },
                logClientStartupError: () => ({ ok: true, logged: 'sheet' }),
            },
            config: {
                available: true,
                settings: {
                    'scheduleChange.perLaneRemovedRatePct': '35',
                    'scheduleChange.laneSizeForRatePct': '8',
                    'scheduleChange.laneNetLossThreshold': '2',
                    'sectorSummary.laneExclude': `EXE, EXW${hideLane ? ', ' + hideLane.toLowerCase() : ''}`,
                },
                unknownKeys: [],
                portExclusions: redPair ? [{ lane: redLane, port: redPort }] : [],
            },
        });
        const serverScenario = async () => {
            rec('Setup: isolated app instance mounted with a working fake server', server.mounted);
            if (!server.mounted) return;
            const { win, doc, fake, log } = server;

            // ---- data feed ----
            const rows = await detailRowCount(doc);
            const feedCalls = fake.calls.filter(c => c.name === 'getDataFeed');
            rec('Data feed: the live export and the sector CSV both come from getDataFeed, asked with gzip:true and no `have` yet',
                feedCalls.length >= 2 && ['live', 'sector'].every(n => feedCalls.some(c => c.args[0].name === n && c.args[0].gzip === true && c.args[0].have === null)) &&
                    fake.replies.filter(r => r.name === 'getDataFeed' && r.out && r.out.encoding === 'gzip-base64').length >= 2,
                { calls: feedCalls.map(c => c.args[0]) });
            rec('Data feed: the iframe never fetched either published Sheet directly',
                log.direct.live === 0 && log.direct.sector === 0, { directFetches: log.direct });
            rec('Data feed: the gunzipped export renders the same Booking Flash rows as the direct fetch (control) and the parent page',
                rows > 0 && rows === controlRows && rows === parentRows, { serverRows: rows, controlRows, parentRows });
            const sv = await sectorView(doc);
            rec('Data feed: the gunzipped sector CSV renders the same Sector Summary right pivot as the direct fetch (control)',
                !!controlSector && sv.rightPairs.length > 0 && JSON.stringify(sv.rightPairs) === JSON.stringify(controlSector.rightPairs),
                { serverPairs: sv.rightPairs.length, controlPairs: controlSector && controlSector.rightPairs.length });
            const lines = await readSettingsLines(doc);
            rec('Data feed: Settings says "shared server copy" with the download time',
                !!lines && /^Data: shared server copy \(downloaded .+\)\.$/.test(lines.data), { lines });
            await waitFor(() => fake.calls.some(c => c.name === 'getVvdNotes'), { timeout: 20000 });
            const firstNotesCall = fake.calls.find(c => c.name === 'getVvdNotes');
            const firstLiveReply = fake.replies.find(r => r.name === 'getDataFeed' && r.out && r.out.name === 'live' && r.out.ok);
            rec('Notes load waits for the data: the first getVvdNotes call comes after the live data-feed reply, not alongside it on page load',
                !!firstNotesCall && !!firstLiveReply && firstNotesCall.at > firstLiveReply.at,
                { notesCallAt: firstNotesCall && firstNotesCall.at, liveReplyAt: firstLiveReply && firstLiveReply.at });

            // ---- config (valid) ----
            rec('Config (valid): four valid settings plus the Port Exclusions array are reported as applied, with no warnings',
                !!lines && lines.config === 'Config Sheet: 5 setting(s) applied.' && lines.warnings.length === 0, { lines });
            const setup = !!hideLane && !!redPair;
            rec('Setup: the control pivots offered a lane to hide and a (lane, port) pair to paint red', setup, { hideLane, redPair });
            if (setup) {
                rec('Config: sectorSummary.laneExclude hides the extra lane from the left pivot in this instance while the control and the parent page still show it',
                    !sv.lanes.includes(hideLane) && controlSector.lanes.includes(hideLane) && parentSector.lanes.includes(hideLane) &&
                        JSON.stringify(sv.lanes) === JSON.stringify(controlSector.lanes.filter(l => l !== hideLane)),
                    { hideLane, serverLanes: sv.lanes, controlLanes: controlSector.lanes, parentLanes: parentSector.lanes });
                rec('Config: portExclusions replaces the built-in list -- exactly the configured pair is painted red and tagged [Port Excluded] (control: none; parent: not that pair)',
                    JSON.stringify(sv.redPairs) === JSON.stringify([redPair]) && JSON.stringify(sv.labelledPairs) === JSON.stringify([redPair]) && controlSector.redPairs.length === 0 && !parentSector.redPairs.includes(redPair),
                    { redPair, serverRed: sv.redPairs, serverLabelled: sv.labelledPairs, controlRed: controlSector.redPairs, parentRed: parentSector.redPairs });
            }
            rec('Config (invalid): the default lane list is what the control shows (matches the parent page)',
                !!controlSector && JSON.stringify(controlSector.lanes) === JSON.stringify(parentSector.lanes),
                { controlLanes: controlSector && controlSector.lanes, parentLanes: parentSector.lanes });

            // ---- Refresh Now: `have` = the previous hash -> unchanged ----
            const firstHashes = {};
            fake.replies.filter(r => r.name === 'getDataFeed' && r.out && r.out.ok).forEach(r => { firstHashes[r.out.name] = r.out.hash; });
            const callsBefore = fake.calls.filter(c => c.name === 'getDataFeed').length;
            await gotoTab(doc, 'Booking Flash');
            const refreshBtn = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === 'Refresh Now');
            rec('Setup: the Refresh Now button is present', !!refreshBtn);
            // Every parse of a CSV goes through XLSX.read; count them to prove a refresh that
            // finds nothing new parses nothing.
            const realRead = win.XLSX.read;
            let parses = 0;
            win.XLSX.read = function () { parses++; return realRead.apply(this, arguments); };
            const refreshAndWait = async (calls) => {
                const before = fake.calls.filter(c => c.name === 'getDataFeed').length;
                const repliesBefore = fake.replies.filter(r => r.name === 'getDataFeed').length;
                refreshBtn.click();
                await waitFor(() => fake.calls.filter(c => c.name === 'getDataFeed').length >= before + calls &&
                    fake.replies.filter(r => r.name === 'getDataFeed').length >= repliesBefore + calls && refreshBtn.textContent.trim() === 'Refresh Now', { timeout: 15000 });
                await sleep(300);
            };
            if (refreshBtn) {
                parses = 0;
                refreshBtn.click();
                await waitFor(() => fake.calls.filter(c => c.name === 'getDataFeed').length >= callsBefore + 2 &&
                    fake.replies.filter(r => r.name === 'getDataFeed').length >= callsBefore + 2 && refreshBtn.textContent.trim() === 'Refresh Now', { timeout: 15000 });
                await sleep(200);
                const after = fake.calls.filter(c => c.name === 'getDataFeed').slice(callsBefore).map(c => c.args[0]);
                const afterReplies = fake.replies.filter(r => r.name === 'getDataFeed').slice(callsBefore).map(r => r.out);
                const rowsAfter = detailRows(doc).length;
                rec('Refresh Now: both feeds are re-requested with `have` equal to the hash they were loaded with, the server answers `unchanged`, and the rows are untouched',
                    after.length === 2 && ['live', 'sector'].every(n => after.some(a => a.name === n && a.have === firstHashes[n])) &&
                        afterReplies.length === 2 && afterReplies.every(r => r.unchanged === true) && rowsAfter === rows && log.direct.live === 0 && log.direct.sector === 0,
                    { after, unchanged: afterReplies.map(r => r.unchanged), rows, rowsAfter, directFetches: log.direct });
                rec('Refresh Now (unchanged): nothing is parsed again (no XLSX.read) -- the rows on screen are already that export', parses === 0, { parses });
            }

            // ---- VVD notes ----
            const notesBtn = () => Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('📝 Notes'));
            const detailBadges = () => Array.from((visibleTable(doc) || doc).querySelectorAll('[data-vvd-notes]'));
            rec('Notes: the Notes button appears once getVvdNotes answers ok, counting the one existing note',
                await waitFor(() => !!notesBtn(), { timeout: 10000 }) && notesBtn().textContent.trim() === '📝 Notes (1)', { label: notesBtn() && notesBtn().textContent.trim() });
            rec('Notes: a note on a VVD that is not in the data produces no badge on Detail', detailBadges().length === 0, { badges: detailBadges().length });

            // Pick three real VVDs: the first spans of the first Detail rows, cross-checked against
            // the fixture's own VVD column so a vessel-name link can never be mistaken for one.
            const fixtureWb = window.XLSX.read(liveCsv, { type: 'string', raw: true });
            const fixtureVvds = new Set(window.XLSX.utils.sheet_to_json(fixtureWb.Sheets[fixtureWb.SheetNames[0]], { raw: false, defval: '' })
                .map(r => norm(r['Vessel 1st VVD'])).filter(v => v && v !== 'VMS'));
            const detailVvds = [];
            detailRows(doc).forEach(tr => {
                const s = tr.querySelector('span[data-gmail-search]');
                const v = s && norm(s.getAttribute('data-gmail-search'));
                if (v && fixtureVvds.has(v) && !detailVvds.includes(v)) detailVvds.push(v);
            });
            const [V1, V2, V3] = detailVvds;
            const vvdSetup = !!(V1 && V2 && V3);
            rec('Setup: three real VVDs found on Detail to attach notes to', vvdSetup, { detailVvds: detailVvds.slice(0, 5) });
            if (!vvdSetup) return;

            // V1/V2: public (cut cargo) notes by others; V3: ME's private note. bob's V1 note has no
            // `visibility` at all, as a server from before 2026-10-01 sends -- it must count as public.
            notesStore.notes.push(
                { vvd: V1, note: 'first note by bob', author: 'bob@example.com', updatedAt: '2020-01-01T10:00:00.000Z' },
                { vvd: V2, note: 'b2 from bob', author: 'bob@example.com', updatedAt: '2020-01-01T09:00:00.000Z', visibility: 'public' },
                { vvd: V2, note: 'c2 from carol', author: 'carol@example.com', updatedAt: '2020-01-01T11:00:00.000Z', visibility: 'public' },
                { vvd: V3, note: 'mine on v3', author: ME, updatedAt: '2020-01-01T12:00:00.000Z', visibility: 'private' },
            );
            notesStore.notes.forEach(n => { if (n.vvd === V1) delete n.visibility; });
            // The panel's own load is what re-reads the server list (as it would on a poll).
            notesBtn().click();
            await waitFor(() => detailBadges().length > 0 && !!doc.querySelector('[data-vvd-notes-panel]'), { timeout: 10000 });
            const closeX = doc.querySelector('[aria-label="Close notes"]');
            if (closeX) closeX.click();
            await waitFor(() => !doc.querySelector('[data-vvd-notes-panel]'));
            rec('Notes: the Notes button count follows the server list (5 notes)', notesBtn().textContent.trim() === '📝 Notes (5)', { label: notesBtn().textContent.trim() });

            // ---- the slicers filter the notes (2026-10-02, per Kevin) ----
            // Through the real Lane slicer: isolate the lane of V3 (my private note's VVD). Which notes that
            // keeps is worked out from the fixture itself (a note stays when its VVD is in that lane), and
            // the orphan note on a VVD that is in no lane always drops out, so the list must narrow. The
            // button count, the dialog's list and its heading follow, "Show all" restores everything, and
            // the slicer is cleared again before anything below runs.
            {
                const NAME = 'Notes (slicers): isolating a Lane narrows the Notes button count and the dialog list to the notes on that lane\'s VVDs, "Show all" lists every note, and clearing the slicer restores them';
                const fixtureRows = window.XLSX.utils.sheet_to_json(fixtureWb.Sheets[fixtureWb.SheetNames[0]], { raw: false, defval: '' });
                const laneOfVvd = (v) => { const r = fixtureRows.find(x => norm(x['Vessel 1st VVD']) === v); return r ? String(r['Vessel 1st Lane']).trim() : ''; };
                const lane = laneOfVvd(V3);
                const laneVvds = new Set(fixtureRows.filter(x => String(x['Vessel 1st Lane']).trim() === lane).map(x => norm(x['Vessel 1st VVD'])));
                const total = notesStore.notes.length;
                const inLane = notesStore.notes.filter(n => laneVvds.has(norm(n.vvd)));
                const laneBtn = lane && Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === lane && b.className.includes('w-[44px]'));
                if (!lane || !laneBtn || inLane.length === 0 || inLane.length >= total) {
                    rec(NAME, false, { problem: !lane ? 'no lane for V3 in the fixture' : !laneBtn ? `no Lane slicer button for ${lane}` : 'this lane would not narrow the notes', V3, lane, inLane: inLane.length, total });
                } else {
                    const label = () => notesBtn().textContent.trim();
                    const detail = { V3, lane, total, expectedShown: inLane.length };
                    try {
                        laneBtn.click();
                        detail.narrowedLabelOk = await waitFor(() => label() === `📝 Notes (${inLane.length} of ${total})`, { timeout: 10000 });
                        detail.narrowedLabel = label();
                        notesBtn().click();
                        await waitFor(() => !!doc.querySelector('[data-vvd-notes-panel]'), { timeout: 5000 });
                        await sleep(300);
                        const panelS = doc.querySelector('[data-vvd-notes-panel]');
                        const headingS = () => { const h = panelS && panelS.querySelector('[data-notes-list-heading]'); return h ? h.textContent.trim() : null; };
                        // The list is grouped (2026-10-02, per Kevin): ONE heading button per VVD, however many
                        // notes that VVD has (V2 has two), so the expected list is the UNIQUE sorted VVDs.
                        const listedVvds = () => Array.from(panelS.querySelectorAll('ul > li > button')).map(b => b.textContent.trim().toUpperCase()).sort();
                        const sortedVvds = (notes) => Array.from(new Set(notes.map(n => norm(n.vvd)))).sort();
                        detail.narrowedHeading = headingS();
                        detail.narrowedList = listedVvds();
                        const narrowedOk = detail.narrowedHeading === `Notes Matching the Current Filters (${inLane.length} of ${total})` &&
                            JSON.stringify(detail.narrowedList) === JSON.stringify(sortedVvds(inLane));
                        const showAll = panelS.querySelector('[data-notes-show-all]');
                        detail.showAllText = showAll && showAll.textContent.trim();
                        if (showAll) {
                            showAll.click();
                            await waitFor(() => headingS() === `All Notes (${total})`, { timeout: 5000 });
                        }
                        detail.allHeading = headingS();
                        detail.allList = listedVvds();
                        detail.backToFilteredText = (panelS.querySelector('[data-notes-show-all]') || {}).textContent;
                        const allOk = detail.showAllText === `Show all ${total}` && detail.allHeading === `All Notes (${total})` &&
                            JSON.stringify(detail.allList) === JSON.stringify(sortedVvds(notesStore.notes)) &&
                            String(detail.backToFilteredText).trim() === 'Only the current filters';
                        const closeS = doc.querySelector('[aria-label="Close notes"]');
                        if (closeS) closeS.click();
                        await waitFor(() => !doc.querySelector('[data-vvd-notes-panel]'));
                        laneBtn.click(); // clear the slicer so everything below sees the unfiltered data
                        detail.clearedLabelOk = await waitFor(() => label() === `📝 Notes (${total})`, { timeout: 10000 });
                        rec(NAME, narrowedOk && allOk && detail.narrowedLabelOk && detail.clearedLabelOk, { ...detail, narrowedOk, allOk });
                    } catch (err) {
                        // Record the failure (with how far it got) instead of leaving the suite one check short.
                        rec(NAME, false, { ...detail, error: String(err && err.message || err) });
                    } finally {
                        // If anything above threw or timed out with the slicer still isolated, clear it.
                        if (label() !== `📝 Notes (${total})`) { laneBtn.click(); await waitFor(() => label() === `📝 Notes (${total})`, { timeout: 10000 }); }
                        const leftover = doc.querySelector('[aria-label="Close notes"]');
                        if (leftover) { leftover.click(); await waitFor(() => !doc.querySelector('[data-vvd-notes-panel]')); }
                    }
                }
            }

            // ---- the dialog's list is organized (2026-10-02, per Kevin) ----
            // Notes grouped under their VVD (newest activity first), kind chips with counts, a search box and an
            // age filter, with the editor pinned in its own region above a scrolling list. Two stages: the layout
            // and grouping checks run first on a fresh dialog over the seeded 2020 notes (a fixed, clock-free
            // expectation); the chip / search / age / time checks run inside the V1 flow below, once this test has
            // saved notes of its own (those are dated NOW, so the age filter and "Today" have something to find).
            // Closing the dialog unmounts it, which resets its filter state, so no stage leaks into the next.
            const N_GROUPED = 'Notes (organized): the dialog lists one group per VVD, newest activity first, with a "· N notes" count (V2\'s two notes share one group), and clicking a group\'s VVD heading fills the VVD box';
            const N_LAYOUT = 'Notes (layout): the editor and the list are separate regions -- the textarea lives in the editor region, the list region scrolls (overflow-y auto), and scrolling a long list does not move the editor';
            const N_INGROUP = 'Notes (organized): inside a VVD\'s group the cut cargo notes come before the private one even though it is newer, and a group with a fresh note moves to the top';
            const N_CHIPS = 'Notes (kind chips): All / Cut Cargo / Private / Mine show their note counts, each filters the list to exactly those notes, the heading stays "All Notes (N)", and All restores the full list';
            const N_SEARCH = 'Notes (search): the search box narrows the list by note text, author or VVD (case-insensitive) and says "Showing X of Y"; a blank search filters nothing';
            const N_CLEAR = 'Notes (filters): a search that matches nothing shows the "No notes match" message, and "Clear filters" puts the chip, the search box and the age filter back and brings every note back';
            const N_AGE = 'Notes (age): "Last 7 Days" hides the 2020 notes and keeps the ones saved during this test, "Last 30 Days" does the same, and "Any Time" restores the list';
            const N_TIMES = 'Notes (times): a note saved just now reads "Today, h:mm" while a 2020 note shows its full date, each with the full time in its tooltip and the ISO value in dateTime';
            const N_EDITOR = 'Notes (filters never touch the editor): a chip, a search and an age leave the VVD box, the unsaved draft, the Public/Private choice and the status line exactly as they were';
            const N_EFFKIND = 'Notes (kind chips): a Private filter whose chip goes away (a poll reports private notes unavailable) falls back to All -- the All chip shows as selected, the whole list is shown instead of staying narrowed or empty, and there is no "Showing X of Y" line';
            const N_PRIVCHIP = 'Notes (kind chips): the 🔒 Private chip is offered only while private notes are available (it leaves when a poll reports them unavailable and returns when they come back)';
            // Records each named check exactly once; if the body throws, every check it has not recorded yet is
            // recorded as failed (with the error) instead of leaving the suite short of its tripwire count.
            const runGuarded = async (names, body) => {
                const left = new Set(names);
                const once = (name, pass, detail) => { left.delete(name); rec(name, pass, detail); };
                try { await body(once); } catch (err) {
                    left.forEach(name => rec(name, false, { error: String(err && err.stack || err), problem: 'threw before this check was recorded' }));
                }
            };
            const editorRegionOf = (p) => p.querySelector('[data-notes-editor-region]');
            const listRegionOf = (p) => p.querySelector('[data-notes-list-region]');
            const noteRowInfo = (li) => {
                const parts = (li.children[0] ? li.children[0].textContent : '').split(' · ');
                const time = li.querySelector('time');
                return { kind: li.getAttribute('data-notes-row'), author: (parts[1] || '').trim(), text: li.children[1] ? li.children[1].textContent.trim() : '', time: time ? time.textContent : null };
            };
            const groupLisOf = (p) => Array.from(p.querySelectorAll('ul[data-notes-groups] > li[data-notes-group]'));
            const groupInfo = (li) => ({
                key: li.getAttribute('data-notes-group'),
                headings: Array.from(li.children).filter(c => c.tagName === 'BUTTON').map(b => b.textContent.trim()),
                count: ((li.querySelector(':scope > [data-notes-group-count]') || {}).textContent || '').trim(),
                rows: Array.from(li.querySelectorAll(':scope > ul > li[data-notes-row]')).map(noteRowInfo),
            });
            const groupsOf = (p) => groupLisOf(p).map(groupInfo);
            const rowCountOf = (p) => p.querySelectorAll('ul[data-notes-groups] li[data-notes-row]').length;
            const openNotesDialog = async () => {
                notesBtn().click();
                await waitFor(() => !!doc.querySelector('[data-vvd-notes-panel]'), { timeout: 5000 });
                await sleep(300);
                return doc.querySelector('[data-vvd-notes-panel]');
            };
            const closeNotesDialog = async () => {
                const x = doc.querySelector('[aria-label="Close notes"]');
                if (x) x.click();
                await waitFor(() => !doc.querySelector('[data-vvd-notes-panel]'), { timeout: 5000 });
            };
            // ---- lanes (2026-10-02, per Kevin): the lane after each VVD in the list, and a Lane drop-down for the VVD box ----
            // The oracle is the fixture itself: a VVD's lane is its 'Vessel 1st Lane', the real VVDs are every
            // 'Vessel 1st VVD' except the 'VMS' placeholder (which spans many lanes), and none is blank.
            {
                const N_LANEHEAD = 'Notes (lanes): each group heading shows its VVD\'s service lane from the data in parentheses -- "(AN2)" in its own span after the heading button -- and nothing for a VVD that is not in the data; the heading button still holds only the bare VVD';
                const N_LANEBOX = 'Notes (lanes): the Lane drop-down offers "All Lanes" plus exactly the lanes of the real VVDs, each VVD suggestion is labelled with its lane, choosing a lane narrows the suggestions to exactly that lane\'s VVDs without touching the VVD box or the notes list, and "All Lanes" restores them all';
                await runGuarded([N_LANEHEAD, N_LANEBOX], async (once) => {
                    const fxRows = window.XLSX.utils.sheet_to_json(fixtureWb.Sheets[fixtureWb.SheetNames[0]], { raw: false, defval: '' });
                    const lanesOfVvd = new Map();
                    fxRows.forEach(r => {
                        const v = norm(r['Vessel 1st VVD']), l = String(r['Vessel 1st Lane']).trim();
                        if (!v || v === 'VMS' || !l) return;
                        if (!lanesOfVvd.has(v)) lanesOfVvd.set(v, new Set());
                        lanesOfVvd.get(v).add(l);
                    });
                    const labelOf = (v) => [...lanesOfVvd.get(v)].sort().join('/');
                    const realVvds = [...lanesOfVvd.keys()].sort();
                    const allLanes = [...new Set([...lanesOfVvd.values()].flatMap(set => [...set]))].sort();
                    const setSelectValue = (el, v) => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new win.Event('change', { bubbles: true })); };
                    const panelL = await openNotesDialog();
                    try {
                        // ---- the lane after each heading ----
                        const headInfo = groupLisOf(panelL).map(li => {
                            const laneEl = li.querySelector(':scope > [data-notes-group-lane]');
                            const btn = li.querySelector(':scope > button');
                            return { key: li.getAttribute('data-notes-group'), lane: laneEl ? laneEl.textContent.trim() : null, laneAfterButton: !!laneEl && !!btn && btn.nextElementSibling === laneEl, button: btn ? btn.textContent.trim() : null };
                        });
                        const wantHead = headInfo.map(h => ({ key: h.key, lane: lanesOfVvd.has(h.key) ? `(${labelOf(h.key)})` : null }));
                        const headOk = headInfo.length === 4 && headInfo.every((h, i) => h.lane === wantHead[i].lane && h.button === h.key && (h.lane === null || h.laneAfterButton)) &&
                            [V1, V2, V3].every(v => (headInfo.find(h => h.key === v) || {}).lane && lanesOfVvd.has(v)) && (headInfo.find(h => h.key === 'ZZ9999Z') || {}).lane === null;
                        once(N_LANEHEAD, headOk, { headInfo, wantHead });

                        // ---- the Lane drop-down and the VVD suggestions ----
                        const sel = doc.getElementById('vvd-note-lane'), list = doc.getElementById('vvd-note-vvd-list'), box = doc.getElementById('vvd-note-vvd');
                        if (!sel || !list || !box) { once(N_LANEBOX, false, { problem: 'the Lane select, the datalist or the VVD box is missing', sel: !!sel, list: !!list, box: !!box }); return; }
                        const optionTexts = Array.from(sel.options).map(o => o.textContent.trim());
                        const optionValues = Array.from(sel.options).map(o => o.value);
                        const suggestions = () => Array.from(list.options).map(o => ({ v: o.value, label: o.getAttribute('label') }));
                        const startSug = suggestions();
                        const labelsOk = startSug.every(o => o.label === labelOf(o.v));
                        const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
                        const lane = labelOf(V3);                       // a real lane, and V3 is on it
                        const onLane = realVvds.filter(v => lanesOfVvd.get(v).has(lane));
                        const groupsBefore = groupLisOf(panelL).map(li => li.getAttribute('data-notes-group'));
                        const headingBefore = (panelL.querySelector('[data-notes-list-heading]') || {}).textContent;
                        const boxBefore = box.value;
                        setSelectValue(sel, lane);
                        await waitFor(() => list.options.length === onLane.length, { timeout: 4000 });
                        const narrowed = suggestions();
                        const boxAfter = box.value;
                        const groupsAfter = groupLisOf(panelL).map(li => li.getAttribute('data-notes-group'));
                        const headingAfter = (panelL.querySelector('[data-notes-list-heading]') || {}).textContent;
                        setSelectValue(sel, '');
                        await waitFor(() => list.options.length === realVvds.length, { timeout: 4000 });
                        const restored = suggestions();
                        const ok = sameList(optionValues, ['', ...allLanes]) && optionTexts[0] === 'All Lanes' && sameList(optionTexts.slice(1), allLanes) &&
                            sameList(startSug.map(o => o.v), realVvds) && labelsOk &&
                            sameList(narrowed.map(o => o.v), onLane) && onLane.length > 0 && onLane.length < realVvds.length && narrowed.every(o => o.label === labelOf(o.v)) &&
                            boxBefore === boxAfter && sameList(groupsBefore, groupsAfter) && headingBefore === headingAfter &&
                            sameList(restored.map(o => o.v), realVvds);
                        once(N_LANEBOX, ok, { optionTexts: optionTexts.slice(0, 4), laneCount: allLanes.length, wantLaneCount: allLanes.length, suggestionsAtStart: startSug.length, wantSuggestions: realVvds.length, labelsOk, lane, narrowedTo: narrowed.length, wantOnLane: onLane.length, boxBefore, boxAfter, groupsBefore, groupsAfter, headingBefore, headingAfter, restoredTo: restored.length });
                    } finally {
                        await closeNotesDialog();
                    }
                });
            }
            {
                const SEED_ORDER = [V3, V2, V1, 'ZZ9999Z']; // newest note per VVD: V3 12:00, V2 11:00, V1 10:00, ZZ9999Z 08:00 (2020-01-01 UTC)
                let frame = null, frameHeight = '';
                await runGuarded([N_GROUPED, N_LAYOUT], async (once) => {
                    try {
                        const pA = await openNotesDialog();
                        const boxStart = (doc.getElementById('vvd-note-vvd') || {}).value;
                        const focusedOnOpen = doc.activeElement && doc.activeElement.id;
                        const groups = groupsOf(pA);
                        const headingButtons = pA.querySelectorAll('ul[data-notes-groups] > li > button').length;
                        const v2g = groups.find(g => g.key === V2);
                        const groupedOk = pA.contains(listRegionOf(pA)) && JSON.stringify(groups.map(g => g.key)) === JSON.stringify(SEED_ORDER) &&
                            groups.every(g => g.headings.length === 1 && g.headings[0] === g.key) && headingButtons === groups.length &&
                            JSON.stringify(groups.map(g => g.count)) === JSON.stringify(['· 1 note', '· 2 notes', '· 1 note', '· 1 note']) &&
                            groups.reduce((n, g) => n + g.rows.length, 0) === notesStore.notes.length && rowCountOf(pA) === notesStore.notes.length &&
                            !!v2g && JSON.stringify(v2g.rows.map(r => r.text)) === JSON.stringify(['c2 from carol', 'b2 from bob']);
                        // Clicking a group's VVD heading fills the VVD box (and the V2 notes by others appear in the editor
                        // region), without filtering the list.
                        const v2Li = groupLisOf(pA).find(li => li.getAttribute('data-notes-group') === V2);
                        const v2Heading = v2Li && v2Li.querySelector(':scope > button');
                        if (v2Heading) {
                            v2Heading.click();
                            await waitFor(() => (doc.getElementById('vvd-note-vvd') || {}).value === V2, { timeout: 4000 });
                            await waitFor(() => !!doc.getElementById('vvd-note-text'), { timeout: 4000 });
                        }
                        const boxAfter = doc.getElementById('vvd-note-vvd').value;
                        const edText = editorRegionOf(pA).textContent;
                        const clickOk = !!v2Heading && boxStart === '' && boxAfter === V2 && edText.includes('c2 from carol') && edText.includes('b2 from bob') && groupLisOf(pA).length === SEED_ORDER.length;
                        once(N_GROUPED, groupedOk && clickOk, { boxStart, focusedOnOpen, boxAfter, headingButtons, groups: groups.map(g => ({ key: g.key, count: g.count, rows: g.rows.length, headings: g.headings })), v2Texts: v2g && v2g.rows.map(r => r.text), expectedOrder: SEED_ORDER, groupsAfterClick: groupLisOf(pA).length });

                        // ---- layout ----
                        const ed = editorRegionOf(pA), lr = listRegionOf(pA);
                        const ta = doc.getElementById('vvd-note-text'), box = doc.getElementById('vvd-note-vvd');
                        if (!ed || !lr || !ta) {
                            once(N_LAYOUT, false, { problem: 'a region or the textarea is missing, so the layout cannot be measured', editorRegion: !!ed, listRegion: !!lr, textarea: !!ta });
                            return;
                        }
                        const FOLLOWING = win.Node.DOCUMENT_POSITION_FOLLOWING;
                        const structure = {
                            regions: !!ed && !!lr,
                            dialogChildren: !!ed && !!lr && ed.parentElement === pA && lr.parentElement === pA,
                            editorFirst: !!ed && !!lr && !!(ed.compareDocumentPosition(lr) & FOLLOWING),
                            notNested: !!ed && !!lr && !ed.contains(lr) && !lr.contains(ed),
                            textareaInEditor: !!ed && !!ta && ed.contains(ta) && !lr.contains(ta),
                            vvdBoxInEditor: !!ed && !!box && ed.contains(box) && !lr.contains(box),
                            listHoldsHeadingChipsAndGroups: !!lr && lr.contains(pA.querySelector('[data-notes-list-heading]')) && lr.contains(pA.querySelector('[role="radiogroup"][aria-label="Filter notes by kind"]')) && lr.contains(pA.querySelector('ul[data-notes-groups]')),
                        };
                        const overflowList = lr ? win.getComputedStyle(lr).overflowY : null;
                        // Behavioral half: shrink the iframe until the list overflows its region, scroll it to the
                        // bottom and check the textarea did not move while the list did. Windows taller than 600px come
                        // first: at 600px or less the app switches to a compact layout (smaller dialog margins, the
                        // filter block scrolls away instead of sticking), which is not the layout most viewers see.
                        frame = win.frameElement; frameHeight = frame.style.height;
                        let used = null;
                        for (const h of [700, 640, 610, 420, 340, 280]) {
                            frame.style.height = h + 'px';
                            await sleep(200);
                            if (lr.scrollHeight > lr.clientHeight + 4) { used = h; break; }
                        }
                        const taTopBefore = ta.getBoundingClientRect().top, edScrollBefore = ed.scrollTop;
                        const listAbove = { scrollTop: lr.scrollTop, scrollHeight: lr.scrollHeight, clientHeight: lr.clientHeight };
                        lr.scrollTop = lr.scrollHeight;
                        await sleep(150);
                        const taTopAfter = ta.getBoundingClientRect().top;
                        const scrolled = { listScrollTop: lr.scrollTop, textareaMoved: Math.round((taTopAfter - taTopBefore) * 10) / 10, editorScrollTop: ed.scrollTop, dialogScrollTop: pA.scrollTop };
                        const listBelowEditor = lr.getBoundingClientRect().top >= ed.getBoundingClientRect().bottom - 1;
                        // In the normal (taller than 600px) layout the heading, kind chips, search box and age filter stick
                        // to the top of the list region, so they are still in view with the list scrolled to the bottom.
                        const chipsEl = lr.querySelector('[role="radiogroup"][aria-label="Filter notes by kind"]');
                        const lrRect = lr.getBoundingClientRect(), chRect = chipsEl ? chipsEl.getBoundingClientRect() : null;
                        const tallLayout = used !== null && used > 600;
                        const filterBlockInView = !!chRect && chRect.top >= lrRect.top - 1 && chRect.bottom <= lrRect.bottom + 1;
                        const pinnedOk = used !== null && scrolled.listScrollTop > 0 && Math.abs(scrolled.textareaMoved) < 1 && scrolled.editorScrollTop === edScrollBefore && scrolled.dialogScrollTop === 0 && listBelowEditor &&
                            (!tallLayout || filterBlockInView);
                        once(N_LAYOUT, Object.values(structure).every(Boolean) && overflowList === 'auto' && pinnedOk, { structure, overflowList, iframeHeightUsed: used, tallLayout, listAbove, scrolled, listBelowEditor, filterBlockInView, chipsTopInList: chRect && Math.round((chRect.top - lrRect.top) * 10) / 10 });
                    } finally {
                        if (frame) frame.style.height = frameHeight;
                        const leftover = doc.querySelector('[aria-label="Close notes"]');
                        if (leftover) await closeNotesDialog();
                    }
                });
            }

            const spansFor = (table, v, poll) => Array.from(table.querySelectorAll('span[data-gmail-search]')).filter(s => norm(s.getAttribute('data-gmail-search')) === v && (!poll || s.closest('td[data-autofit-col="vvd"]')));
            const badgeReport = (table, poll) => {
                const badges = Array.from(table.querySelectorAll('[data-vvd-notes]'));
                const set = Array.from(new Set(badges.map(b => b.getAttribute('data-vvd-notes')))).sort();
                const perVvd = {};
                [V1, V2, V3].forEach(v => {
                    const mine = badges.filter(b => b.getAttribute('data-vvd-notes') === v);
                    perVvd[v] = { badges: mine.length, links: spansFor(table, v, poll).length, text: mine[0] && mine[0].textContent, title: mine[0] && mine[0].title,
                        publicMark: mine.length > 0 && mine.every(b => b.hasAttribute('data-vvd-notes-public')) ? true : (mine.some(b => b.hasAttribute('data-vvd-notes-public')) ? 'mixed' : false) };
                });
                // every badge sits right after its own VVD's Gmail link
                const attached = badges.every(b => b.previousElementSibling && b.previousElementSibling.hasAttribute('data-gmail-search') &&
                    norm(b.previousElementSibling.getAttribute('data-gmail-search')) === b.getAttribute('data-vvd-notes'));
                return { set, perVvd, attached };
            };
            const expectedTitles = { [V1]: '✂️ bob: first note by bob' + NOTE_SUFFIX, [V2]: '✂️ carol: c2 from carol\n✂️ bob: b2 from bob' + NOTE_SUFFIX, [V3]: '🔒 kevin: mine on v3' + NOTE_SUFFIX };
            const expectedText = { [V1]: '✂️', [V2]: '✂️2', [V3]: '🔒' };
            const expectedPublic = { [V1]: true, [V2]: true, [V3]: false };
            const badgesOk = (rep) => JSON.stringify(rep.set) === JSON.stringify([V1, V2, V3].sort()) && rep.attached &&
                [V1, V2, V3].every(v => rep.perVvd[v].badges > 0 && rep.perVvd[v].badges === rep.perVvd[v].links && rep.perVvd[v].text === expectedText[v] &&
                    rep.perVvd[v].title === expectedTitles[v] && rep.perVvd[v].publicMark === expectedPublic[v]);
            const detailRep = badgeReport(visibleTable(doc), false);
            rec('Notes (Detail): a badge on every VVD cell of exactly the three noted VVDs -- red ✂️ (with a count) for public cut cargo notes, 🔒 for my private one -- with the right hover text, each right after its Gmail link',
                badgesOk(detailRep), { V1, V2, V3, detailRep });

            // ---- badge click on Detail ----
            const realOpen = win.open;
            const openCalls = [];
            win.open = (...a) => { openCalls.push(a); return null; };
            try {
                const highlighted = () => doc.querySelectorAll('[data-bf-highlighted="true"]').length;
                const badge1 = detailBadges().find(b => b.getAttribute('data-vvd-notes') === V1);
                badge1.click();
                await waitFor(() => !!doc.querySelector('[data-vvd-notes-panel]'), { timeout: 5000 });
                await sleep(500); // past the 300ms Gmail defer and the 300ms row-click defer
                const panel = doc.querySelector('[data-vvd-notes-panel]');
                const vvdBox = doc.getElementById('vvd-note-vvd');
                rec('Notes: clicking a badge opens the dialog on that VVD, opens no Gmail tab and highlights no row',
                    !!panel && !!vvdBox && vvdBox.value === V1 && openCalls.length === 0 && highlighted() === 0,
                    { panel: !!panel, boxValue: vvdBox && vvdBox.value, opens: openCalls.length, highlighted: highlighted() });
                // Control: the same kind of click on a plain cell of that row DOES highlight it,
                // so the zero above is not just "highlighting is broken".
                const row1 = badge1.closest('tr');
                row1.querySelector('td').click();
                await sleep(450);
                const highlightedAfterPlain = highlighted();
                row1.querySelector('td').click();
                await sleep(450);
                rec('Notes: (control) a click on a plain cell of the same row does highlight it, and a second click clears it',
                    highlightedAfterPlain === 1 && highlighted() === 0, { highlightedAfterPlain, highlightedNow: highlighted() });

                const btn = (label) => Array.from(panel.querySelectorAll('button')).find(b => b.textContent.trim() === label);
                const hasBtn = (label) => !!btn(label);
                const checkedKind = () => { const r = panel.querySelector('[data-note-visibility][aria-checked="true"]'); return r && r.getAttribute('data-note-visibility'); };
                const bobRow = Array.from(panel.querySelectorAll('div')).find(d => d.textContent.includes('bob@example.com') && d.querySelector('[data-note-kind]'));
                rec('Notes: another author\'s note is shown read-only and labelled cut cargo -- the dialog lists it with its author and offers no Delete button',
                    !!bobRow && bobRow.querySelector('[data-note-kind]').getAttribute('data-note-kind') === 'public' && panel.textContent.includes('first note by bob') &&
                        !hasBtn('Delete public note') && !hasBtn('Delete private note'),
                    { bobKind: bobRow && bobRow.querySelector('[data-note-kind]').getAttribute('data-note-kind'), deletePublic: hasBtn('Delete public note'), deletePrivate: hasBtn('Delete private note') });
                // Times are shown to the minute: "1/1/2020, 10:00 AM", never "10:00:00 AM". The panel lists
                // bob's note twice (the card for this VVD and the All notes list), so there are timestamps to see.
                const timeStamps = panel.textContent.match(/\d{1,2}:\d{2}(:\d{2})?/g) || [];
                rec('Notes: note times are shown to the minute -- the dialog shows timestamps and none of them has seconds',
                    timeStamps.length > 0 && timeStamps.every(t => !/^\d{1,2}:\d{2}:\d{2}$/.test(t)),
                    { timeStamps });
                const getArgs = fake.calls.filter(c => c.name === 'getVvdNotes').map(c => JSON.stringify(c.args));
                rec('Notes: with no note of mine on the VVD, the editor starts on ✂️ Public (so a note is never saved as private by accident), and every getVvdNotes call opts in to private notes',
                    checkedKind() === 'public' && hasBtn('Save public note') && !hasBtn('Save private note') &&
                        getArgs.length > 0 && getArgs.every(a => a === JSON.stringify([{ privateNotes: true }])),
                    { checked: checkedKind(), getArgs: [...new Set(getArgs)] });
                const typeNote = async (text) => {
                    const ta = doc.getElementById('vvd-note-text');
                    const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
                    setter.call(ta, text);
                    ta.dispatchEvent(new win.Event('input', { bubbles: true }));
                };
                const v1Badges = () => detailBadges().filter(b => b.getAttribute('data-vvd-notes') === V1);
                const v1BadgesAre = (text) => v1Badges().length > 0 && v1Badges().every(b => b.textContent === text);

                // ---- save private (an explicit choice: the dialog starts on Public) ----
                panel.querySelector('[data-note-visibility="private"]').click();
                await waitFor(() => checkedKind() === 'private');
                await typeNote('  my note v1  ');
                await waitFor(() => btn('Save private note') && !btn('Save private note').disabled);
                btn('Save private note').click();
                await waitFor(() => panel.textContent.includes('only you can see it'), { timeout: 5000 });
                await waitFor(() => v1BadgesAre('✂️🔒'), { timeout: 5000 });
                const saves = fake.calls.filter(c => c.name === 'saveVvdNote');
                rec('Notes: "Save private note" calls saveVvdNote(VVD, trimmed text, "private"), says only I can see it, and every V1 badge becomes ✂️🔒 with my note listed after bob\'s',
                    saves.length === 1 && JSON.stringify(saves[0].args) === JSON.stringify([V1, 'my note v1', 'private']) &&
                        v1BadgesAre('✂️🔒') && v1Badges()[0].title === '✂️ bob: first note by bob\n🔒 kevin: my note v1' + NOTE_SUFFIX && hasBtn('Delete private note'),
                    { saves: saves.map(s => s.args), badgeTexts: v1Badges().map(b => b.textContent), title: v1Badges()[0] && v1Badges()[0].title });

                // ---- switch to public: my SAVED private text must not carry over (it could be published by one click), then save a public note ----
                // Edit the private text first, so the draft differs from the saved private note: an
                // EDITED saved private note must not carry into Public either.
                await typeNote('my note v1 -- edited, not saved');
                await waitFor(() => doc.getElementById('vvd-note-text').value === 'my note v1 -- edited, not saved');
                panel.querySelector('[data-note-visibility="public"]').click();
                await waitFor(() => checkedKind() === 'public');
                const carried = doc.getElementById('vvd-note-text').value;
                await typeNote('Cut 40 TEU at USNYC');
                await waitFor(() => btn('Save public note') && !btn('Save public note').disabled);
                btn('Save public note').click();
                await waitFor(() => panel.textContent.includes('everyone can see it'), { timeout: 5000 });
                await waitFor(() => v1BadgesAre('✂️2🔒'), { timeout: 5000 });
                const savesP = fake.calls.filter(c => c.name === 'saveVvdNote');
                rec('Notes: switching to ✂️ Public does NOT carry my saved private text (even edited and unsaved) into the public editor; "Save public note" calls saveVvdNote(VVD, text, "public"), the badge becomes ✂️2🔒, and the dialog notes my private one is still there',
                    carried === '' && savesP.length === 2 && JSON.stringify(savesP[1].args) === JSON.stringify([V1, 'Cut 40 TEU at USNYC', 'public']) &&
                        v1BadgesAre('✂️2🔒') && panel.textContent.includes('You also have a 🔒 private note'),
                    { carried, saves: savesP.map(s => s.args), badgeTexts: v1Badges().map(b => b.textContent) });

                // ---- the organized list, now that this test has saved notes of its own (2026-10-02, per Kevin) ----
                // State here: the 5 seeded notes (2020) plus my private note and my public note on V1 (both dated NOW),
                // so 7 notes: 5 cut cargo (bob's V1 note has no `visibility` and counts as public), 2 private, 3 mine.
                // The four counts differ on purpose, so no chip can pass by showing another chip's list.
                await runGuarded([N_INGROUP, N_CHIPS, N_SEARCH, N_CLEAR, N_AGE, N_TIMES, N_EDITOR], async (once) => {
                    const stored = notesStore.notes.slice();
                    const total = stored.length;
                    const headingText = () => { const h = panel.querySelector('[data-notes-list-heading]'); return h ? h.textContent.trim() : null; };
                    const summaryText = () => { const s = panel.querySelector('[data-notes-filter-summary]'); return s ? s.textContent.replace(/\s+/g, ' ').trim() : null; };
                    const chipsOf = () => { const g = panel.querySelector('[role="radiogroup"][aria-label="Filter notes by kind"]'); return g ? Array.from(g.querySelectorAll('[data-notes-kind-filter]')).map(b => ({ kind: b.getAttribute('data-notes-kind-filter'), text: b.textContent.trim(), checked: b.getAttribute('aria-checked') })) : []; };
                    const searchEl = () => panel.querySelector('input[data-notes-search]');
                    const ageEl = () => panel.querySelector('select[data-notes-age]');
                    const setInputValue = (el, v) => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new win.Event('input', { bubbles: true })); };
                    const setSelectValue = (el, v) => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new win.Event('change', { bubbles: true })); };
                    const pickChip = async (kind) => {
                        panel.querySelector(`[data-notes-kind-filter="${kind}"]`).click();
                        await waitFor(() => chipsOf().some(c => c.kind === kind && c.checked === 'true'), { timeout: 4000 });
                    };
                    const rowTexts = () => groupsOf(panel).flatMap(g => g.rows.map(r => r.text)).sort();
                    const expectTexts = (notes) => notes.map(n => n.note).sort();
                    const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
                    const clearFiltersViaButton = async () => {
                        const clr = panel.querySelector('[data-notes-clear-filters]');
                        if (clr) { clr.click(); await waitFor(() => !panel.querySelector('[data-notes-filter-summary]'), { timeout: 4000 }); }
                    };
                    try {
                        // -- order inside a group, and the group order --
                        const groups = groupsOf(panel);
                        const v1g = groups.find(g => g.key === V1);
                        const privV1 = stored.find(n => n.vvd === V1 && n.author === ME && n.visibility === 'private');
                        const bobV1 = stored.find(n => n.vvd === V1 && n.author === 'bob@example.com');
                        once(N_INGROUP,
                            sameList(groups.map(g => g.key), [V1, V3, V2, 'ZZ9999Z']) && !!v1g && v1g.count === '· 3 notes' &&
                                sameList(v1g.rows.map(r => r.kind), ['public', 'public', 'private']) && sameList(v1g.rows.map(r => r.author), ['kevin', 'bob', 'kevin']) &&
                                sameList(v1g.rows.map(r => r.text), ['Cut 40 TEU at USNYC', 'first note by bob', 'my note v1']) &&
                                !!privV1 && !!bobV1 && privV1.updatedAt > bobV1.updatedAt,
                            { groupOrder: groups.map(g => g.key), v1Count: v1g && v1g.count, v1Rows: v1g && v1g.rows.map(r => `${r.kind}/${r.author}/${r.text}`), privateIsNewerThanBobs: !!privV1 && !!bobV1 && privV1.updatedAt > bobV1.updatedAt });

                        // -- kind chips --
                        const exp = {
                            all: stored,
                            public: stored.filter(n => n.visibility !== 'private'),
                            private: stored.filter(n => n.visibility === 'private'),
                            mine: stored.filter(n => n.author === ME),
                        };
                        const wantLabels = [`All (${exp.all.length})`, `✂️ Cut Cargo (${exp.public.length})`, `🔒 Private (${exp.private.length})`, `Mine (${exp.mine.length})`];
                        const chipsStart = chipsOf();
                        const perKind = {};
                        let chipsOk = new Set(Object.values(exp).map(l => l.length)).size === 4 && sameList(chipsStart.map(c => c.text), wantLabels) &&
                            sameList(chipsStart.map(c => c.checked), ['true', 'false', 'false', 'false']) && headingText() === `All Notes (${total})` && summaryText() === null;
                        for (const kind of ['public', 'private', 'mine']) {
                            await pickChip(kind);
                            await waitFor(() => rowCountOf(panel) === exp[kind].length, { timeout: 4000 });
                            const rows = groupsOf(panel).flatMap(g => g.rows);
                            const st = chipsOf();
                            perKind[kind] = {
                                rows: rows.length, texts: rowTexts(), checked: st.filter(c => c.checked === 'true').map(c => c.kind), labels: st.map(c => c.text),
                                heading: headingText(), summary: summaryText(),
                                kindsOk: kind === 'mine' ? rows.every(r => r.author === 'kevin') : rows.every(r => r.kind === kind),
                            };
                            const p = perKind[kind];
                            chipsOk = chipsOk && p.rows === exp[kind].length && sameList(p.texts, expectTexts(exp[kind])) && p.kindsOk && sameList(p.checked, [kind]) &&
                                sameList(p.labels, wantLabels) && p.heading === `All Notes (${total})` && !!p.summary && p.summary.startsWith(`Showing ${exp[kind].length} of ${total}`);
                        }
                        await pickChip('all');
                        await waitFor(() => rowCountOf(panel) === total && !summaryText(), { timeout: 4000 });
                        const chipsEnd = chipsOf();
                        chipsOk = chipsOk && rowCountOf(panel) === total && summaryText() === null && sameList(chipsEnd.map(c => c.checked), ['true', 'false', 'false', 'false']) && headingText() === `All Notes (${total})`;
                        once(N_CHIPS, chipsOk, { wantLabels, chipsStart, perKind, afterAll: { rows: rowCountOf(panel), summary: summaryText(), heading: headingText() } });

                        // -- search --
                        const searchCases = [
                            { q: '   ', want: stored, label: 'blank' },
                            { q: 'BOB', want: stored.filter(n => n.author === 'bob@example.com'), label: 'author, upper-case' },
                            { q: 'cut 40', want: stored.filter(n => n.note === 'Cut 40 TEU at USNYC'), label: 'note text, case-insensitive' },
                            { q: V2.toLowerCase(), want: stored.filter(n => n.vvd === V2), label: 'VVD, lower-case' },
                            { q: 'carol', want: stored.filter(n => n.author === 'carol@example.com'), label: 'author' },
                        ];
                        const searchSeen = [];
                        let searchOk = true;
                        for (const c of searchCases) {
                            setInputValue(searchEl(), c.q);
                            await sleep(150);
                            await waitFor(() => rowCountOf(panel) === c.want.length && (c.want.length === total ? summaryText() === null : !!summaryText()), { timeout: 4000 });
                            const seen = { label: c.label, q: c.q, rows: rowCountOf(panel), texts: rowTexts(), summary: summaryText(), heading: headingText() };
                            searchSeen.push(seen);
                            const summaryWant = c.want.length === total ? null : `Showing ${c.want.length} of ${total}`;
                            searchOk = searchOk && seen.rows === c.want.length && sameList(seen.texts, expectTexts(c.want)) && seen.heading === `All Notes (${total})` &&
                                (summaryWant === null ? seen.summary === null : !!seen.summary && seen.summary.startsWith(summaryWant));
                        }
                        searchOk = searchOk && searchCases.slice(1).every(c => c.want.length > 0 && c.want.length < total);
                        setInputValue(searchEl(), '');
                        await waitFor(() => rowCountOf(panel) === total && !summaryText(), { timeout: 4000 });
                        once(N_SEARCH, searchOk && rowCountOf(panel) === total, { searchSeen, afterClearingTheBox: { rows: rowCountOf(panel), summary: summaryText() } });

                        // -- nothing matches, then Clear filters --
                        await pickChip('public');
                        setSelectValue(ageEl(), '7');
                        setInputValue(searchEl(), 'zzzz-no-such-note');
                        await waitFor(() => !!panel.querySelector('[data-notes-empty]'), { timeout: 4000 });
                        const emptyEl = panel.querySelector('[data-notes-empty]');
                        const empty = { emptyText: emptyEl && emptyEl.textContent.trim(), groups: groupLisOf(panel).length, summary: summaryText() };
                        await clearFiltersViaButton();
                        await waitFor(() => rowCountOf(panel) === total, { timeout: 4000 });
                        const cleared = { chips: chipsOf().map(c => `${c.kind}:${c.checked}`), search: searchEl().value, age: ageEl().value, rows: rowCountOf(panel), summary: summaryText(), emptyShown: !!panel.querySelector('[data-notes-empty]'), heading: headingText() };
                        once(N_CLEAR,
                            !!empty.emptyText && empty.emptyText.startsWith('No notes match your search or filters.') && empty.groups === 0 && !!empty.summary && empty.summary.startsWith(`Showing 0 of ${total}`) &&
                                sameList(cleared.chips, ['all:true', 'public:false', 'private:false', 'mine:false']) && cleared.search === '' && cleared.age === '0' &&
                                cleared.rows === total && cleared.summary === null && cleared.emptyShown === false && cleared.heading === `All Notes (${total})`,
                            { empty, cleared });

                        // -- age --
                        const recent = stored.filter(n => Date.now() - Date.parse(n.updatedAt) < 7 * 86400000);
                        const ageSeen = {};
                        let ageOk = recent.length > 0 && recent.length < total;
                        for (const days of ['7', '30', '0']) {
                            const want = days === '0' ? total : recent.length;
                            setSelectValue(ageEl(), days);
                            await waitFor(() => rowCountOf(panel) === want && (days === '0' ? !summaryText() : !!summaryText()), { timeout: 4000 });
                            ageSeen[days] = { rows: rowCountOf(panel), groups: groupsOf(panel).map(g => g.key), texts: rowTexts(), summary: summaryText(), select: ageEl().value };
                            const a = ageSeen[days];
                            ageOk = ageOk && a.rows === want && a.select === days &&
                                (days === '0' ? a.summary === null && a.texts.length === total : sameList(a.texts, expectTexts(recent)) && sameList(a.groups, [V1]) && !!a.summary && a.summary.startsWith(`Showing ${recent.length} of ${total}`));
                        }
                        once(N_AGE, ageOk, { recentCount: recent.length, total, ageSeen });

                        // -- relative times --
                        const FULL = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' };
                        const full = (iso) => new Date(iso).toLocaleString(undefined, FULL);
                        const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                        const mineV1 = stored.find(n => n.vvd === V1 && n.author === ME && n.visibility === 'public');
                        const v1Li = groupLisOf(panel).find(li => li.getAttribute('data-notes-group') === V1);
                        const v1Lis = v1Li ? Array.from(v1Li.querySelectorAll(':scope > ul > li[data-notes-row]')) : [];
                        const timeOf = (text) => { const li = v1Lis.find(l => l.children[1] && l.children[1].textContent.trim() === text); return li ? li.querySelector('time') : null; };
                        const tNew = timeOf('Cut 40 TEU at USNYC'), tOld = timeOf('first note by bob');
                        const word = new Date(mineV1.updatedAt).toDateString() === new Date().toDateString() ? 'Today' : 'Yesterday';
                        const noSeconds = (s) => !/\d{1,2}:\d{2}:\d{2}/.test(s);
                        const allTimes = Array.from(panel.querySelectorAll('time'));
                        const seenTimes = {
                            fresh: tNew && { text: tNew.textContent, title: tNew.title, dateTime: tNew.getAttribute('datetime') },
                            old: tOld && { text: tOld.textContent, title: tOld.title, dateTime: tOld.getAttribute('datetime') },
                        };
                        const freshOk = !!tNew && tNew.textContent === `${word}, ${clock(mineV1.updatedAt)}` && tNew.title === full(mineV1.updatedAt) && !/^(Today|Yesterday)/.test(tNew.title) && tNew.getAttribute('datetime') === mineV1.updatedAt && noSeconds(tNew.textContent);
                        const oldOk = !!tOld && tOld.textContent === full(bobV1.updatedAt) && !/^(Today|Yesterday)/.test(tOld.textContent) && /2019|2020/.test(tOld.textContent) && tOld.title === tOld.textContent && tOld.getAttribute('datetime') === bobV1.updatedAt && noSeconds(tOld.textContent);
                        const everyTimeOk = allTimes.length >= 7 && allTimes.every(t => t.title !== '' && t.getAttribute('datetime') !== '' && noSeconds(t.textContent) && noSeconds(t.title));
                        once(N_TIMES, freshOk && oldOk && everyTimeOk, { expectedWord: word, expectedFreshText: `${word}, ${clock(mineV1.updatedAt)}`, expectedOldText: full(bobV1.updatedAt), seenTimes, timeElements: allTimes.length });

                        // -- the editor is never touched by the filters --
                        await typeNote('draft in progress');
                        await waitFor(() => doc.getElementById('vvd-note-text').value === 'draft in progress', { timeout: 4000 });
                        const editorSnap = () => ({
                            box: doc.getElementById('vvd-note-vvd').value, draft: doc.getElementById('vvd-note-text').value, checked: checkedKind(),
                            savedStatusShown: editorRegionOf(panel).textContent.includes('Saved — everyone can see it.'),
                            saveEnabled: !!btn('Save public note') && !btn('Save public note').disabled, deleteShown: hasBtn('Delete public note'),
                        });
                        const edBefore = editorSnap();
                        await pickChip('private');
                        setInputValue(searchEl(), 'zzzz-no-such-note');
                        setSelectValue(ageEl(), '7');
                        await waitFor(() => !!panel.querySelector('[data-notes-empty]'), { timeout: 4000 });
                        const edFiltered = editorSnap();
                        await clearFiltersViaButton();
                        await waitFor(() => rowCountOf(panel) === total, { timeout: 4000 });
                        const edCleared = editorSnap();
                        once(N_EDITOR,
                            edBefore.box === V1 && edBefore.draft === 'draft in progress' && edBefore.checked === 'public' && edBefore.savedStatusShown && edBefore.saveEnabled && edBefore.deleteShown &&
                                sameList(edFiltered, edBefore) && sameList(edCleared, edBefore),
                            { edBefore, edFiltered, edCleared });
                        await typeNote('Cut 40 TEU at USNYC'); // back to the saved text, as the steps below expect
                        await waitFor(() => doc.getElementById('vvd-note-text').value === 'Cut 40 TEU at USNYC', { timeout: 4000 });
                    } finally {
                        await clearFiltersViaButton(); // whatever happened above, hand a clean list to the steps below
                        if (chipsOf().length) await pickChip('all');
                    }
                });

                // ---- delete public, then private ----
                btn('Delete public note').click();
                await waitFor(() => panel.textContent.includes('Your cut cargo note was deleted.'), { timeout: 5000 });
                await waitFor(() => v1BadgesAre('✂️🔒'), { timeout: 5000 });
                const savesD = fake.calls.filter(c => c.name === 'saveVvdNote');
                rec('Notes: "Delete public note" calls saveVvdNote(VVD, "", "public") and leaves my private note (badge back to ✂️🔒)',
                    savesD.length === 3 && JSON.stringify(savesD[2].args) === JSON.stringify([V1, '', 'public']) && v1BadgesAre('✂️🔒'),
                    { saves: savesD.map(s => s.args), badgeTexts: v1Badges().map(b => b.textContent) });
                panel.querySelector('[data-note-visibility="private"]').click();
                await waitFor(() => checkedKind() === 'private' && doc.getElementById('vvd-note-text').value === 'my note v1');
                btn('Delete private note').click();
                await waitFor(() => panel.textContent.includes('Your private note was deleted.'), { timeout: 5000 });
                await waitFor(() => v1BadgesAre('✂️'), { timeout: 5000 });
                const saves2 = fake.calls.filter(c => c.name === 'saveVvdNote');
                rec('Notes: "Delete private note" calls saveVvdNote(VVD, "", "private"), and the badge goes back to a red ✂️ with only bob\'s note left',
                    saves2.length === 4 && JSON.stringify(saves2[3].args) === JSON.stringify([V1, '', 'private']) && v1BadgesAre('✂️') && v1Badges()[0].title === expectedTitles[V1] &&
                        !hasBtn('Delete private note') && !hasBtn('Delete public note') && panel.textContent.includes('first note by bob'),
                    { saves: saves2.map(s => s.args), badgeTexts: v1Badges().map(b => b.textContent) });

                // ---- a poll that cannot read the private notes must not wipe what is being typed ----
                // On the Public editor, type, then have the next polls answer privateAvailable:false and
                // then true again. Opening-event = the same loadVvdNotes call a poll makes.
                panel.querySelector('[data-note-visibility="public"]').click();
                await waitFor(() => checkedKind() === 'public');
                await typeNote('typing in flight');
                const privateBtn = () => panel.querySelector('[data-note-visibility="private"]');
                const pollNotes = async () => {
                    const before = fake.replies.filter(r => r.name === 'getVvdNotes').length;
                    win.dispatchEvent(new win.CustomEvent('bookingflash:open-vvd-notes', { detail: V1 }));
                    await waitFor(() => fake.replies.filter(r => r.name === 'getVvdNotes').length > before, { timeout: 5000 });
                };
                const chipKinds = () => Array.from(panel.querySelectorAll('[role="radiogroup"][aria-label="Filter notes by kind"] [data-notes-kind-filter]')).map(b => b.getAttribute('data-notes-kind-filter'));
                const chipsChecked = () => Array.from(panel.querySelectorAll('[role="radiogroup"][aria-label="Filter notes by kind"] [data-notes-kind-filter][aria-checked="true"]')).map(b => b.getAttribute('data-notes-kind-filter'));
                const listRows = () => panel.querySelectorAll('ul[data-notes-groups] li[data-notes-row]').length;
                const summaryNow = () => { const sEl = panel.querySelector('[data-notes-filter-summary]'); return sEl ? sEl.textContent.replace(/\s+/g, ' ').trim() : null; };
                // Select the Private chip first (the list narrows to my private notes), so the poll below takes the chip away
                // from under an active Private filter.
                panel.querySelector('[data-notes-kind-filter="private"]').click();
                await waitFor(() => chipsChecked().join() === 'private', { timeout: 4000 });
                const privateOnly = { checked: chipsChecked(), rows: listRows(), summary: summaryNow() };
                let chipsWhileUnavailable = null, whileUnavailable = null;
                notesStore.privateAvailable = false;
                try {
                    await pollNotes();
                    await waitFor(() => privateBtn().disabled, { timeout: 5000 });
                    await sleep(300);
                    chipsWhileUnavailable = chipKinds();
                    whileUnavailable = { checked: chipsChecked(), rows: listRows(), summary: summaryNow(), emptyShown: !!panel.querySelector('[data-notes-empty]') };
                } finally {
                    notesStore.privateAvailable = true;
                }
                const keptWhileUnavailable = doc.getElementById('vvd-note-text').value;
                await pollNotes();
                await waitFor(() => !privateBtn().disabled, { timeout: 5000 });
                await sleep(300);
                const keptAfterRecovery = doc.getElementById('vvd-note-text').value;
                rec('Notes: a poll that reports private notes unavailable (and the one that restores them) does not wipe the text being typed in the Public editor',
                    keptWhileUnavailable === 'typing in flight' && keptAfterRecovery === 'typing in flight' && checkedKind() === 'public',
                    { keptWhileUnavailable, keptAfterRecovery, checked: checkedKind() });
                // The list's kind chips follow the same flag: no 🔒 Private chip while private notes are unavailable
                // (there is nothing to filter to), and it is back once they are.
                const chipsAfterRecovery = chipKinds();
                rec(N_PRIVCHIP,
                    JSON.stringify(chipsWhileUnavailable) === JSON.stringify(['all', 'public', 'mine']) && JSON.stringify(chipsAfterRecovery) === JSON.stringify(['all', 'public', 'private', 'mine']),
                    { chipsWhileUnavailable, chipsAfterRecovery });
                // A Private filter whose chip has gone must not stay on invisibly: with no Private chip the list falls
                // back to All -- the All chip shows as selected (never "no chip selected"), every note is listed (the
                // fake server still returns my private note as well as the cut cargo ones, 5 in all, so a stuck Private
                // filter would show 1) and there is no "Showing X of Y" line. What the Private chip does once private
                // notes return is recorded, not asserted: the viewer's choice was never cleared.
                const allStored = notesStore.notes.length;
                rec(N_EFFKIND,
                    JSON.stringify(privateOnly.checked) === JSON.stringify(['private']) && privateOnly.rows < allStored && !!privateOnly.summary &&
                        !!whileUnavailable && JSON.stringify(whileUnavailable.checked) === JSON.stringify(['all']) && whileUnavailable.rows === allStored && allStored > 1 &&
                        whileUnavailable.summary === null && whileUnavailable.emptyShown === false,
                    { allStored, privateOnly, whileUnavailable, afterRecovery: { checked: chipsChecked(), rows: listRows(), summary: summaryNow() } });
                panel.querySelector('[data-notes-kind-filter="all"]').click(); // leave the list on All for the steps below
                await waitFor(() => chipsChecked().join() === 'all', { timeout: 4000 });

                // Escape closes it.
                doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await waitFor(() => !doc.querySelector('[data-vvd-notes-panel]'));
                rec('Notes: Escape closes the dialog', !doc.querySelector('[data-vvd-notes-panel]'));

                // ---- hashtag search in the dialog (2026-10-02, per Kevin; chip counts, bounded bar, Unicode tags 2026-10-03) ----
                // A "#tag" typed inside a note is searchable: tags in note text are buttons, a tag bar lists the tags
                // of the notes the viewer can see, and the search box is the one source of truth (typing "#rolled"
                // and clicking a tag are the same thing). This stage runs on its own seeded set so the checks above
                // and below keep their exact expectations: six tagged notes on VVDs that are NOT in the data (so
                // they add no badge on Detail or POL) are added to the fake server, and the store is put back and the
                // app re-synced at the end. Phase A runs before the tagged notes exist: no seeded note contains a "#",
                // so the tag bar must be absent. The fake returns every note in the store, so "private notes
                // unavailable" / "another visitor" is modelled the way the real server behaves: by not sending them.
                //
                // A chip's number is what clicking it LISTS (2026-10-03): a chip that is not pressed shows the notes the
                // list would hold with that tag added to the box, a pressed one the notes it would hold with the tag taken
                // out. Which chips exist, and their order, follow only the kind chip and the age filter (the bar must not
                // jump while typing). Every expected number below is worked out by hand from the six notes; the COUNT
                // check then proves the same thing against what a click really lists.
                //
                // SPEED (2026-10-03). The first version of this stage took ~29 s of a 150 s run. Measured, not guessed
                // (counters wrapped around the helpers, one stage-only run): 96 fixed 120 ms sleeps after actions = 11.6 s
                // (the source shows only 39 call sites; loops multiply them), 15 fresh dialogs (each a 300 ms sleep plus
                // the 50 ms margin every waitFor adds) = 7.7 s, and every waitFor call carries that 50 ms margin on top
                // of the condition: 163 calls waited 11.3 s in all. The DOM work itself was a small remainder. So this
                // stage (a) waits for the CONCRETE condition and not a duration: `until` polls the
                // condition every 10 ms and returns the moment it holds, `quiet` resolves once the dialog's DOM has not
                // changed for 40 ms (a MutationObserver, attached before React's microtask flush) -- a stability window
                // that costs 40 ms when nothing is pending and still waits as long as something is; the dialog's own
                // reload after opening is awaited by its getVvdNotes REPLY, not by a 300 ms guess; and (b) shares one
                // dialog between steps that only drive the filter controls, putting it back to its just-opened state
                // through those same controls (and opening a fresh one if that does not work). Steps that need the
                // server's list changed, the editor, or another window height still open their own dialog.
                {
                    const N_TAGUI = 'Notes (hashtags): the search box now says "Search VVD, text, author or #tag" (its aria-label stays "Search notes") and the dialog\'s intro says "Add #tags (like #rolled) to a note to find it later."';
                    const N_TAGBARNONE = 'Notes (hashtags): with no #tag in any listed note there is NO tag bar (and no tag button), whatever kind chip or search is active -- the bar never renders empty';
                    const N_TAGZERO = 'Notes (hashtags): a typed #tag that no note carries shows ONE pressed chip (its number is the notes the list holds once it is taken out) and "No notes are tagged #x"; clicking the chip takes it out again; "#12", a lone "#" and plain text are not tags and keep the old "No notes match your search or filters." message with no chip';
                    const N_TAGLINK = 'Notes (hashtags): in the list rows every #tag is a button[data-note-tag] (type=button, aria-pressed=false, title "Show notes tagged #key") while the row\'s text element still reads EXACTLY the note (newlines, double spaces, the hyphen after "#cutcargo-" outside the button), and "#frag" in a URL, "#3" and "#12" stay plain text';
                    const N_TAGCLICK = 'Notes (hashtags): clicking a tag in a row fills the search box with "#key" (lower-case even for "#Rolled"), narrows the list, sets aria-pressed=true on every button for that tag and on its chip and only those; clicking again clears it; a chip click does the same; the tag joins text already typed ("bob #usnyc") and leaves it when removed';
                    const N_TAGBAR = 'Notes (hashtags): the tag bar (div[data-notes-tagbar] role=group "Filter notes by tag", in the sticky header below the kind/search/age row) offers one chip per tag, most-used first then alphabetical, with its chips inside the scrolling div[data-notes-tag-list]; "#12", "#3" and the URL fragment are not offered; the chips do not move while a text search narrows the list, only their numbers change (what clicking each would list)';
                    const N_TAGAND = 'Notes (hashtags): several tags AND together -- via chips or typed, in any order or case; a tag typed with its comma ("#rolled,") is plain text, not a tag; adding a tag no note shares with the others lists nothing and says "No notes are tagged #a #b #c"';
                    const N_TAGCOMBO = 'Notes (hashtags): a tag combines with the kind chips, free text and the age filter (all must hold); the bar\'s tags follow kind and age (never the search box), its numbers follow all of them, and a typed tag that is in no listed note under that kind or age stays as a pressed chip that can be clicked away';
                    const N_TAGPRIV = 'Notes (hashtags): a tag that lives only on my private note is offered under All, Private and Mine but not under Cut Cargo, and not at all while private notes are unavailable (the server then sends none): its chip and buttons vanish, typing it finds nothing, and everything is back when they return';
                    const N_TAGPLACES = 'Notes (hashtags): the other two places a note\'s text is shown also render tags as buttons with the exact text -- other people\'s notes above the editor, and the "You also have a ... note" line -- and clicking one toggles the search box without touching the VVD box';
                    const N_TAGDRAFT = 'Notes (hashtags): under the editor\'s textarea exactly ONE of p[data-note-draft-tags-hint] ("Tip: add #tags such as #rolled ...") and p[data-note-draft-tags] ("Tags: #a #b", distinct and lower-case) shows while a VVD is typed -- the tip until the draft has a real tag; the placeholders are unchanged';
                    const N_TAGCLEAR = 'Notes (hashtags): a tag alone makes "Showing X of Y" + "Clear filters" appear, and Clear filters empties a tag query (with kind chip, free text and age too, and a pressed chip no listed note carries goes with it), leaving every chip and tag button unpressed';
                    const N_TAGEDITOR = 'Notes (hashtags): a tag click, a chip click, a typed tag query and Clear filters never change the VVD box, the UNSAVED draft, the Public/Private choice or the save button, and call no saveVvdNote -- on the Private editor and on the Public one';
                    const N_TAGSLICER = 'Notes (hashtags): the tag bar describes only the notes the dialog LISTS -- with a Lane slicer hiding the tagged notes no tag is offered (and a typed tag says "No notes are tagged #x" plus the slicer hint), "Show all" brings the tags back, "Only the current filters" takes them away again';
                    const N_TAGMORE = 'Notes (hashtags): with more than 12 tags the bar shows 12 chips and a "Show all 19 tags" button that sits beside the scrolling chip list, not inside it; a pressed tag beyond the first 12 is shown too (13 chips); the button toggles "Show all" / "Show fewer"';
                    const N_TAGCOUNT = 'Notes (hashtags): a chip\'s number and title are what clicking it lists -- with tags (and a kind chip or text) already in the search box, a chip that is not pressed shows the number of notes the list holds after pressing it, a pressed chip the number after taking it back out, and the rows really listed after the click are exactly that many';
                    const N_TAGDIM = 'Notes (hashtags): a chip that would list nothing is dimmed (data-notes-tag-empty="true", half opacity) yet stays an enabled button, a chip that would list notes never is, and a pressed chip never is even when taking it out lists nothing';
                    const N_TAGBOUND = 'Notes (hashtags): the tag bar is bounded -- in a 700 px high window with 45 tags and "Show all" the bar stays within 120 px, its chips scroll inside div[data-notes-tag-list] (overflow-y auto) while the "Show fewer" button stays put inside the bar and visible, and note rows are still visible below it';
                    const N_TAGUNICODE = 'Notes (hashtags): a tag in note text works whatever its letters -- the buttons for #İstanbul and for a decomposed #cafe + U+0301 fill the search box with a valid tag token and list their note (the mark stays inside the button), a typed #cafe + U+0301 does too, and #café with its decomposed twin is ONE chip counting both notes';
                    const N_TAGINLINE = 'Notes (hashtags): the in-note tag button is a native button laid out inline-block (its class says so, not "inline"), and a tag longer than the line wraps inside its own box instead of overflowing the note';
                    const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
                    const baseNotes = notesStore.notes.slice();
                    const baseAvailable = notesStore.privateAvailable;
                    const N1 = { vvd: 'HTAG0001X', note: 'Cut 40 TEU at USNYC\n#rolled  #usnyc', author: 'bob@example.com', visibility: 'public', updatedAt: ago(5) };
                    const N2 = { vvd: 'HTAG0002X', note: 'rolled again #Rolled, see http://x.test/page#frag at bay #3 ref #12', author: 'carol@example.com', visibility: 'public', updatedAt: ago(4) };
                    const N3 = { vvd: 'HTAG0003X', note: 'cut cargo\nplan: #cutcargo- ok', author: 'bob@example.com', visibility: 'public', updatedAt: ago(3) };
                    const N4 = { vvd: 'HTAG0004X', note: 'cut #cut only', author: 'carol@example.com', visibility: 'public', updatedAt: '2020-01-01T07:00:00.000Z' };
                    const N5 = { vvd: 'HTAG0005E', note: 'my public #usnyc note', author: ME, visibility: 'public', updatedAt: ago(2) };
                    const N6 = { vvd: 'HTAG0005E', note: 'private only #secret and #rolled', author: ME, visibility: 'private', updatedAt: ago(1) };
                    const tagged = [N1, N2, N3, N4, N5, N6];
                    const baseCount = baseNotes.length, total = baseCount + tagged.length;
                    // Expected tag pools. rolled: N1 N2 N6, usnyc: N1 N5, cut: N4, cutcargo: N3, secret: N6.
                    const POOL_ALL = ['rolled:3', 'usnyc:2', 'cut:1', 'cutcargo:1', 'secret:1'];
                    const POOL_PUBLIC = ['rolled:2', 'usnyc:2', 'cut:1', 'cutcargo:1'];
                    const POOL_PRIVATE = ['rolled:1', 'secret:1'];
                    const POOL_MINE = ['rolled:1', 'secret:1', 'usnyc:1'];
                    // Sizes of the lists a chip can lead to, from the seeded notes (N1..N5 are public, N6 private; N5 and N6 are mine).
                    const publicTotal = baseNotes.filter(n => n.visibility !== 'private').length + 5;
                    const privateTotal = baseNotes.filter(n => n.visibility === 'private').length + 1;
                    const mineTotal = baseNotes.filter(n => n.author === ME).length + 2;

                    rec('Setup: the hashtag test notes sit on VVDs that are not in the data (so they add no badge to Detail or POL) and none of the seeded notes contains a "#" (so every tag below comes from the notes this stage adds)',
                        tagged.every(n => !fixtureVvds.has(norm(n.vvd))) && baseCount > 0 && baseNotes.every(n => !/#/.test(n.note)),
                        { clashes: tagged.filter(n => fixtureVvds.has(norm(n.vvd))).map(n => n.vvd), baseCount, baseNotesWithHash: baseNotes.filter(n => /#/.test(n.note)).map(n => n.note) });

                    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
                    const dlg = () => doc.querySelector('[data-vvd-notes-panel]');
                    const q$ = (sel) => dlg().querySelector(sel);
                    const setIn = (el, v) => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new win.Event('input', { bubbles: true })); };
                    const setSel = (el, v) => { Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new win.Event('change', { bubbles: true })); };
                    const setTa = (el, v) => { Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new win.Event('input', { bubbles: true })); };
                    // See the SPEED note above: `until` returns the moment the condition holds (no margin), `quiet` is the
                    // stability window. `settle` keeps its old name and meaning ("let the dialog finish what it is doing").
                    const until = async (predicate, timeout = 4000) => {
                        const end = Date.now() + timeout;
                        for (;;) {
                            if (predicate()) return true;
                            if (Date.now() >= end) return false;
                            await sleep(10);
                        }
                    };
                    const quiet = (idleMs = 40, capMs = 2000) => new Promise((resolve) => {
                        let idle, hard;
                        const finish = () => { clearTimeout(idle); clearTimeout(hard); observer.disconnect(); resolve(); };
                        const observer = new win.MutationObserver(() => { clearTimeout(idle); idle = setTimeout(finish, idleMs); });
                        observer.observe(dlg() || doc.body, { subtree: true, childList: true, attributes: true, characterData: true });
                        idle = setTimeout(finish, idleMs);
                        hard = setTimeout(finish, capMs);
                    });
                    const settle = () => quiet();
                    const searchEl = () => q$('input[data-notes-search]');
                    const barEl = () => q$('[data-notes-tagbar]');
                    const chipEl = (tag) => q$(`[data-notes-tag-chip="${tag}"]`);
                    const chipInfos = () => Array.from(dlg().querySelectorAll('[data-notes-tagbar] [data-notes-tag-chip]')).map(b => ({
                        tag: b.getAttribute('data-notes-tag-chip'), count: Number((b.querySelector('[data-notes-tag-count]') || {}).textContent), pressed: b.getAttribute('aria-pressed'), text: b.textContent.replace(/\s+/g, ' ').trim(),
                        isButton: b.tagName === 'BUTTON' && b.getAttribute('type') === 'button',
                    }));
                    const chipPairs = () => chipInfos().map(c => `${c.tag}:${c.count}`);
                    const chipFull = () => chipInfos().map(c => `${c.tag}:${c.count}:${c.pressed}`);
                    const pressedTags = () => chipInfos().filter(c => c.pressed === 'true').map(c => c.tag);
                    const rowEls = () => Array.from(dlg().querySelectorAll('ul[data-notes-groups] li[data-notes-row]'));
                    const rowTexts = () => rowEls().map(li => (li.children[1] ? li.children[1].textContent : null));
                    const rowTextsSorted = () => rowTexts().slice().sort();
                    const sortedTexts = (notes) => notes.map(n => n.note).sort();
                    const summary = () => { const s = q$('[data-notes-filter-summary]'); return s ? s.textContent.replace(/\s+/g, ' ').trim() : null; };
                    const emptyMsg = () => { const e = q$('[data-notes-empty]'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
                    const heading = () => { const h = q$('[data-notes-list-heading]'); return h ? h.textContent.trim() : null; };
                    const tagBtns = (key, root) => Array.from((root || dlg()).querySelectorAll(`[data-note-tag="${key}"]`));
                    const pressedOf = (els) => els.map(e => e.getAttribute('aria-pressed'));
                    const listUl = () => q$('ul[data-notes-groups]');
                    const rowTagBtn = (key) => tagBtns(key, listUl())[0];
                    const waitQuery = (v) => until(() => searchEl().value === v, 4000);
                    const waitRows = (n) => until(() => rowEls().length === n, 4000);
                    const clickChip = async (tag, wantQuery) => { chipEl(tag).click(); await waitQuery(wantQuery); await settle(); };
                    const typeQuery = async (v, wantNotes) => {
                        setIn(searchEl(), v);
                        const ok = wantNotes ? await until(() => same(rowTextsSorted(), sortedTexts(wantNotes)), 3000) : true;
                        await settle();
                        return { q: v, ok, texts: rowTextsSorted(), pressed: pressedTags() };
                    };
                    const pickKind = async (kind) => { q$(`[data-notes-kind-filter="${kind}"]`).click(); await until(() => !!q$(`[data-notes-kind-filter="${kind}"][aria-checked="true"]`), 4000); await settle(); };
                    const vvdBox = () => doc.getElementById('vvd-note-vvd');
                    const taEl = () => doc.getElementById('vvd-note-text');
                    const setVvd = async (v) => { setIn(vvdBox(), v); await until(() => vvdBox().value === v && !!taEl(), 4000); await settle(); };
                    const typeDraft = async (v) => { setTa(taEl(), v); await until(() => taEl().value === v, 4000); await settle(); };
                    const draftState = () => { const t = q$('[data-note-draft-tags]'), h = q$('[data-note-draft-tags-hint]'); return { tags: t ? t.textContent.trim() : null, hint: h ? h.textContent.trim() : null }; };
                    const edRegion = () => q$('[data-notes-editor-region]');
                    const notesLoads = () => fake.replies.filter(r => r.name === 'getVvdNotes').length;
                    const closeDialog = async () => {
                        const x = doc.querySelector('[aria-label="Close notes"]');
                        if (x) x.click();
                        await until(() => !dlg(), 5000);
                    };
                    // Opens a brand-new dialog (closing the open one unmounts it and drops all its state). The panel re-reads
                    // the list from the server when it mounts, so wait for that reply, then for the rows it brings.
                    const freshDialog = async (rowCount) => {
                        if (dlg()) await closeDialog();
                        const loadsBefore = notesLoads();
                        notesBtn().click();
                        await until(() => !!dlg(), 5000);
                        await until(() => notesLoads() > loadsBefore, 3000);
                        await until(() => rowEls().length === rowCount, 5000);
                        await settle();
                    };
                    const kindChecked = () => { const c = q$('[data-notes-kind-filter][aria-checked="true"]'); return c ? c.getAttribute('data-notes-kind-filter') : null; };
                    // Puts an open dialog that only had filter controls driven back into its just-opened state, through those
                    // same controls. True only if it really is back (all rows, nothing typed, kind All, Any Time, nothing pressed).
                    const resetFilters = async (rowCount) => {
                        if (!dlg() || (vvdBox() && vvdBox().value !== '')) return false;
                        if (searchEl().value !== '') setIn(searchEl(), '');
                        if (kindChecked() !== 'all') q$('[data-notes-kind-filter="all"]').click();
                        if (q$('select[data-notes-age]').value !== '0') setSel(q$('select[data-notes-age]'), '0');
                        await until(() => rowEls().length === rowCount && searchEl().value === '' && kindChecked() === 'all' && q$('select[data-notes-age]').value === '0' && !summary() && pressedTags().length === 0, 3000);
                        await settle();
                        return rowEls().length === rowCount && searchEl().value === '' && kindChecked() === 'all' && q$('select[data-notes-age]').value === '0' && !summary() && pressedTags().length === 0;
                    };
                    const cleanDialog = async (rowCount) => { if (!(await resetFilters(rowCount))) await freshDialog(rowCount); };
                    const attrsOk = (btns) => btns.length > 0 && btns.every(b => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button' && b.getAttribute('aria-pressed') === 'false' && b.getAttribute('title') === `Show notes tagged #${b.getAttribute('data-note-tag')}`);

                    await runGuarded([N_TAGUI, N_TAGBARNONE, N_TAGZERO, N_TAGLINK, N_TAGCLICK, N_TAGBAR, N_TAGAND, N_TAGCOMBO, N_TAGCOUNT, N_TAGDIM, N_TAGPRIV, N_TAGPLACES, N_TAGDRAFT, N_TAGCLEAR, N_TAGEDITOR, N_TAGSLICER, N_TAGMORE, N_TAGBOUND, N_TAGUNICODE, N_TAGINLINE], async (once) => {
                        // One step = one check; a step that throws fails only itself (the steps that open their own dialog say so,
                        // the others call cleanDialog, which reuses the open one only if it can put it back to its just-opened state).
                        const step = async (name, body) => {
                            try { const r = await body(); once(name, !!r.pass, r.detail); }
                            catch (err) { once(name, false, { error: String(err && err.stack || err), problem: 'threw before this check could finish' }); }
                        };
                        // A step that records several checks from one pass over the same dialog: `body(record)`, and whatever it
                        // has not recorded when it throws is recorded as failed.
                        const stepMulti = async (names, body) => {
                            const left = new Set(names);
                            const record = (name, pass, detail) => { left.delete(name); once(name, pass, detail); };
                            try { await body(record); }
                            catch (err) { left.forEach(name => once(name, false, { error: String(err && err.stack || err), problem: 'threw before this check could finish' })); }
                        };
                        try {
                            // ---------- phase A: no tagged note exists yet ----------
                            await step(N_TAGUI, async () => {
                                await freshDialog(baseCount);   // the one dialog the three phase-A steps share
                                const d = { placeholder: searchEl().getAttribute('placeholder'), ariaLabel: searchEl().getAttribute('aria-label'), intro: dlg().textContent.includes('Add #tags (like #rolled) to a note to find it later.'), introKeepsOldText: dlg().textContent.includes('notes are for VVDs where cargo has been cut') };
                                return { pass: d.placeholder === 'Search VVD, text, author or #tag' && d.ariaLabel === 'Search notes' && d.intro && d.introKeepsOldText, detail: d };
                            });
                            await step(N_TAGBARNONE, async () => {
                                await cleanDialog(baseCount);
                                const seen = { start: { bar: !!barEl(), tagButtons: dlg().querySelectorAll('[data-note-tag]').length, rows: rowEls().length } };
                                for (const kind of ['public', 'private', 'mine']) { await pickKind(kind); seen[kind] = { bar: !!barEl(), tagButtons: dlg().querySelectorAll('[data-note-tag]').length }; }
                                await pickKind('all');
                                setIn(searchEl(), 'bob'); await settle();
                                seen.text = { bar: !!barEl(), rows: rowEls().length };
                                return { pass: seen.start.rows === baseCount && seen.start.rows > 0 && Object.values(seen).every(s => s.bar === false && (s.tagButtons === undefined || s.tagButtons === 0)), detail: seen };
                            });
                            await step(N_TAGZERO, async () => {
                                await cleanDialog(baseCount);
                                const seen = {};
                                setIn(searchEl(), '#nosuchtag'); await until(() => !!chipEl('nosuchtag'), 4000); await settle();
                                seen.typed = { chips: chipFull(), empty: emptyMsg(), summary: summary(), groups: rowEls().length };
                                chipEl('nosuchtag').click(); await waitQuery(''); await settle();
                                seen.removed = { query: searchEl().value, bar: !!barEl(), rows: rowEls().length, summary: summary() };
                                const notTags = {};
                                for (const q of ['#12', '#', 'zzzz-no-such-note']) {
                                    setIn(searchEl(), q); await until(() => !!q$('[data-notes-empty]'), 4000); await settle();
                                    notTags[q] = { bar: !!barEl(), chips: chipInfos().length, empty: emptyMsg() };
                                }
                                seen.notTags = notTags;
                                const oldMsg = (m) => !!m && m.startsWith('No notes match your search or filters.') && !m.startsWith('No notes are tagged');
                                const pass = same(seen.typed.chips, [`nosuchtag:${baseCount}:true`]) && !!seen.typed.empty && seen.typed.empty.startsWith('No notes are tagged #nosuchtag') && seen.typed.groups === 0 && !!seen.typed.summary && seen.typed.summary.startsWith(`Showing 0 of ${baseCount}`) &&
                                    seen.removed.query === '' && seen.removed.bar === false && seen.removed.rows === baseCount && seen.removed.summary === null &&
                                    Object.values(notTags).every(s => s.bar === false && s.chips === 0 && oldMsg(s.empty));
                                return { pass, detail: seen };
                            });

                            // ---------- phase B: the tagged notes are on the server ----------
                            notesStore.notes = baseNotes.concat(tagged);

                            await step(N_TAGLINK, async () => {
                                await freshDialog(total);   // the server's list just changed: a fresh mount re-reads it. The steps up to CLEAR share this dialog
                                const spec = [[N1, [['rolled', '#rolled'], ['usnyc', '#usnyc']]], [N2, [['rolled', '#Rolled']]], [N3, [['cutcargo', '#cutcargo']]], [N4, [['cut', '#cut']]], [N5, [['usnyc', '#usnyc']]], [N6, [['secret', '#secret'], ['rolled', '#rolled']]]];
                                const perNote = {};
                                let notesOk = true;
                                spec.forEach(([n, tags]) => {
                                    const li = rowEls().find(l => l.children[1] && l.children[1].textContent === n.note);
                                    const holder = li && li.children[1];
                                    const btns = holder ? Array.from(holder.querySelectorAll('[data-note-tag]')) : [];
                                    const info = { found: !!li, textExact: !!holder && holder.textContent === n.note, keepsClass: !!holder && /whitespace-pre-wrap/.test(holder.className), buttons: btns.map(b => [b.getAttribute('data-note-tag'), b.textContent]), attrsOk: attrsOk(btns) };
                                    info.ok = info.found && info.textExact && info.keepsClass && same(info.buttons, tags) && info.attrsOk;
                                    perNote[`${n.vvd}/${n.visibility}`] = info;
                                    notesOk = notesOk && info.ok;
                                });
                                const taggedTexts = new Set(tagged.map(n => n.note));
                                const plain = rowEls().filter(l => !taggedTexts.has(l.children[1].textContent));
                                const plainOk = plain.length === baseCount && same(plain.map(l => l.children[1].textContent).sort(), sortedTexts(baseNotes)) && plain.every(l => l.querySelectorAll('[data-note-tag]').length === 0);
                                const buttonsInList = listUl().querySelectorAll('[data-note-tag]').length;
                                const falseTags = dlg().querySelectorAll('[data-note-tag="frag"], [data-note-tag="3"], [data-note-tag="12"]').length;
                                return { pass: notesOk && plainOk && buttonsInList === 8 && falseTags === 0, detail: { perNote, plainRows: plain.length, plainOk, buttonsInList, falseTags } };
                            });

                            await step(N_TAGCLICK, async () => {
                                await cleanDialog(total);
                                const seen = {};
                                const startPressed = pressedOf(tagBtns('rolled'));
                                // 1: the button typed "#Rolled" fills the lower-case key
                                const n2Btn = rowEls().find(l => l.children[1].textContent === N2.note).querySelector('[data-note-tag]');
                                n2Btn.click();
                                await waitQuery('#rolled'); await waitRows(3); await settle();
                                seen.afterClick = { query: searchEl().value, texts: rowTextsSorted(), summary: summary(), heading: heading(), chips: chipFull(), rolledPressed: pressedOf(tagBtns('rolled')), othersPressed: pressedOf(tagBtns('usnyc').concat(tagBtns('secret'))), open: !!dlg() };
                                // 2: any button of the same tag toggles it off
                                rowTagBtn('rolled').click();
                                await waitQuery(''); await waitRows(total); await settle();
                                seen.afterSecondClick = { query: searchEl().value, rows: rowEls().length, summary: summary(), pressedButtons: pressedOf(Array.from(dlg().querySelectorAll('[data-note-tag]'))).filter(p => p !== 'false').length, pressedChips: pressedTags() };
                                // 3: a chip click is the same
                                await clickChip('cut', '#cut'); await waitRows(1);
                                seen.chipOn = { query: searchEl().value, texts: rowTextsSorted(), buttons: pressedOf(tagBtns('cut')), pressedChips: pressedTags() };
                                await clickChip('cut', ''); await waitRows(total);
                                seen.chipOff = { query: searchEl().value, rows: rowEls().length, pressedChips: pressedTags(), buttons: pressedOf(tagBtns('cut')) };
                                // 4: next to text already typed
                                setIn(searchEl(), 'bob'); await settle();
                                const bobCount = notesStore.notes.filter(n => n.author === 'bob@example.com').length;
                                const n1Usnyc = rowEls().find(l => l.children[1].textContent === N1.note).querySelector('[data-note-tag="usnyc"]');
                                n1Usnyc.click();
                                await waitQuery('bob #usnyc'); await waitRows(1); await settle();
                                seen.withText = { query: searchEl().value, texts: rowTextsSorted() };
                                tagBtns('usnyc', listUl())[0].click();
                                await waitQuery('bob'); await waitRows(bobCount); await settle();
                                seen.textKept = { query: searchEl().value, rows: rowEls().length, bobCount };
                                const a = seen.afterClick;
                                const pass = same(startPressed, ['false', 'false', 'false']) &&
                                    a.query === '#rolled' && same(a.texts, sortedTexts([N1, N2, N6])) && !!a.summary && a.summary.startsWith(`Showing 3 of ${total}`) && a.heading === `All Notes (${total})` &&
                                    same(a.chips, [`rolled:${total}:true`, 'usnyc:1:false', 'cut:0:false', 'cutcargo:0:false', 'secret:1:false']) && same(a.rolledPressed, ['true', 'true', 'true']) && a.othersPressed.length > 0 && a.othersPressed.every(p => p === 'false') && a.open &&
                                    seen.afterSecondClick.query === '' && seen.afterSecondClick.rows === total && seen.afterSecondClick.summary === null && seen.afterSecondClick.pressedButtons === 0 && same(seen.afterSecondClick.pressedChips, []) &&
                                    seen.chipOn.query === '#cut' && same(seen.chipOn.texts, sortedTexts([N4])) && same(seen.chipOn.buttons, ['true']) && same(seen.chipOn.pressedChips, ['cut']) &&
                                    seen.chipOff.query === '' && seen.chipOff.rows === total && same(seen.chipOff.pressedChips, []) && same(seen.chipOff.buttons, ['false']) &&
                                    seen.withText.query === 'bob #usnyc' && same(seen.withText.texts, sortedTexts([N1])) && seen.textKept.query === 'bob' && seen.textKept.rows === bobCount && bobCount > 2;
                                return { pass, detail: { startPressed, ...seen } };
                            });

                            await step(N_TAGBAR, async () => {
                                await cleanDialog(total);
                                const FOLLOWING = win.Node.DOCUMENT_POSITION_FOLLOWING;
                                const bar = barEl();
                                const kindGroup = q$('[role="radiogroup"][aria-label="Filter notes by kind"]');
                                const stickyOf = (el) => { for (let e = el && el.parentElement; e && e !== q$('[data-notes-list-region]'); e = e.parentElement) if (win.getComputedStyle(e).position === 'sticky') return e; return null; };
                                const infos = chipInfos();
                                const tagList = bar && bar.querySelector('[data-notes-tag-list]');
                                const structure = {
                                    present: !!bar, isDiv: !!bar && bar.tagName === 'DIV', role: !!bar && bar.getAttribute('role') === 'group', label: !!bar && bar.getAttribute('aria-label') === 'Filter notes by tag',
                                    listInBar: !!tagList && tagList.tagName === 'DIV', chipsInList: !!tagList && Array.from(bar.querySelectorAll('[data-notes-tag-chip]')).every(c => tagList.contains(c)),
                                    inListRegion: !!bar && q$('[data-notes-list-region]').contains(bar),
                                    belowKindSearchAge: !!bar && !!(kindGroup.compareDocumentPosition(bar) & FOLLOWING) && !!(searchEl().compareDocumentPosition(bar) & FOLLOWING) && !!(q$('select[data-notes-age]').compareDocumentPosition(bar) & FOLLOWING),
                                    aboveTheList: !!bar && !!(bar.compareDocumentPosition(listUl()) & FOLLOWING),
                                    sameStickyHeaderAsSearch: !!bar && stickyOf(bar) === stickyOf(searchEl()),
                                };
                                const chipsDetail = { pairs: chipPairs(), want: POOL_ALL, allUnpressed: infos.every(c => c.pressed === 'false'), textsOk: infos.every(c => c.text === `#${c.tag} ${c.count}`), buttonsOk: infos.every(c => c.isButton), noMoreButton: !q$('[data-notes-tag-more]'),
                                    notOffered: ['12', '3', 'frag'].filter(k => !!chipEl(k)) };
                                // The tags (membership and order) must not move while a text search narrows the list; only the numbers do
                                // (what clicking each chip would list with that text still in the box: bob wrote #rolled+#usnyc on N1 and #cutcargo on N3).
                                const typing = {};
                                for (const q of ['bob', 'zzzz-no-such-note']) {
                                    setIn(searchEl(), q); await settle();
                                    typing[q] = { pairs: chipPairs(), rows: rowEls().length, tags: chipInfos().map(c => c.tag) };
                                }
                                // the summary line (shown now: a search is active) sits below the bar
                                const sum = q$('[data-notes-filter-summary]');
                                typing.summaryBelowBar = !!sum && !!bar && !!(bar.compareDocumentPosition(sum) & FOLLOWING);
                                const pass = Object.values(structure).every(Boolean) && same(chipsDetail.pairs, POOL_ALL) && chipsDetail.allUnpressed && chipsDetail.textsOk && chipsDetail.buttonsOk && chipsDetail.noMoreButton && chipsDetail.notOffered.length === 0 &&
                                    same(typing.bob.tags, POOL_ALL.map(x => x.split(':')[0])) && same(typing['zzzz-no-such-note'].tags, POOL_ALL.map(x => x.split(':')[0])) && same(typing.bob.pairs, ['rolled:1', 'usnyc:1', 'cut:0', 'cutcargo:1', 'secret:0']) && typing.bob.rows > 0 && typing.bob.rows < total && same(typing['zzzz-no-such-note'].pairs, ['rolled:0', 'usnyc:0', 'cut:0', 'cutcargo:0', 'secret:0']) && typing['zzzz-no-such-note'].rows === 0 && typing.summaryBelowBar;
                                return { pass, detail: { structure, chips: chipsDetail, typing } };
                            });

                            await step(N_TAGAND, async () => {
                                await cleanDialog(total);
                                const seen = {};
                                await clickChip('rolled', '#rolled');
                                await clickChip('usnyc', '#rolled #usnyc'); await waitRows(1);
                                seen.two = { query: searchEl().value, texts: rowTextsSorted(), summary: summary(), pressed: pressedTags(), chips: chipPairs() };
                                await clickChip('secret', '#rolled #usnyc #secret'); await until(() => !!q$('[data-notes-empty]'), 4000); await settle();
                                seen.three = { query: searchEl().value, rows: rowEls().length, empty: emptyMsg(), summary: summary(), pressed: pressedTags() };
                                await clickChip('rolled', '#usnyc #secret');
                                seen.firstRemoved = { query: searchEl().value, rows: rowEls().length, empty: emptyMsg(), pressed: pressedTags() };
                                await clickChip('secret', '#usnyc'); await waitRows(2);
                                seen.one = { query: searchEl().value, texts: rowTextsSorted(), pressed: pressedTags() };
                                seen.typed = [
                                    await typeQuery('#rolled #secret', [N6]),
                                    await typeQuery('#Rolled #USNYC', [N1]),
                                    await typeQuery('#usnyc #rolled', [N1]),
                                    await typeQuery('carol #rolled', [N2]),
                                    await typeQuery('#rolled,', [N2]),      // a comma makes it plain text: matches "#Rolled," as a substring, creates no tag
                                ];
                                const t = seen.typed;
                                const pass = seen.two.query === '#rolled #usnyc' && same(seen.two.texts, sortedTexts([N1])) && !!seen.two.summary && seen.two.summary.startsWith(`Showing 1 of ${total}`) && same(seen.two.pressed, ['rolled', 'usnyc']) && same(seen.two.chips, ['rolled:2', 'usnyc:3', 'cut:0', 'cutcargo:0', 'secret:0']) &&
                                    seen.three.rows === 0 && !!seen.three.empty && seen.three.empty.startsWith('No notes are tagged #rolled #usnyc #secret') && !!seen.three.summary && seen.three.summary.startsWith(`Showing 0 of ${total}`) && same(seen.three.pressed, ['rolled', 'usnyc', 'secret']) &&
                                    seen.firstRemoved.query === '#usnyc #secret' && seen.firstRemoved.rows === 0 && !!seen.firstRemoved.empty && seen.firstRemoved.empty.startsWith('No notes are tagged #usnyc #secret') && same(seen.firstRemoved.pressed, ['usnyc', 'secret']) &&
                                    seen.one.query === '#usnyc' && same(seen.one.texts, sortedTexts([N1, N5])) && same(seen.one.pressed, ['usnyc']) &&
                                    t[0].ok && same(t[0].pressed, ['rolled', 'secret']) && t[1].ok && same(t[1].pressed, ['rolled', 'usnyc']) && t[2].ok && same(t[2].pressed, ['rolled', 'usnyc']) && t[3].ok && same(t[3].pressed, ['rolled']) && t[4].ok && same(t[4].pressed, []);
                                return { pass, detail: seen };
                            });

                            await step(N_TAGCOMBO, async () => {
                                await cleanDialog(total);
                                const seen = {};
                                // Notes saved within the last 7 days, counted from the server's own timestamps (N4 and the seeded notes are 2020).
                                const recentCount = notesStore.notes.filter(n => Date.now() - Date.parse(n.updatedAt) <= 7 * 86400000).length;
                                await pickKind('public');
                                await clickChip('rolled', '#rolled'); await waitRows(2);
                                seen.publicRolled = { texts: rowTextsSorted(), summary: summary(), chips: chipPairs(), pressed: pressedTags() };
                                await pickKind('private'); await waitRows(1);
                                seen.privateRolled = { texts: rowTextsSorted(), chips: chipPairs(), pressed: pressedTags() };
                                await pickKind('mine'); await waitRows(1);
                                seen.mineRolled = { texts: rowTextsSorted(), chips: chipPairs(), pressed: pressedTags() };
                                // a tag that exists under other kinds but not this one: a pressed chip with count 0
                                await pickKind('private');
                                seen.zeroTyped = await typeQuery('#rolled #usnyc', []);
                                seen.zero = { chips: chipFull(), empty: emptyMsg() };
                                chipEl('usnyc').click(); await waitQuery('#rolled'); await waitRows(1); await settle();
                                seen.zeroRemoved = { query: searchEl().value, chips: chipFull(), texts: rowTextsSorted() };
                                // free text + tag, kind back to All
                                await pickKind('all');
                                const textA = await typeQuery('cargo #cutcargo', [N3]);
                                const textB = await typeQuery('bob #cut', []);
                                seen.textEmpty = emptyMsg();   // read while "bob #cut" lists nothing (the next query finds N4)
                                const textC = await typeQuery('carol #cut', [N4]);
                                seen.text = [textA, textB, textC];
                                // age: the 2020 note (#cut) drops out of the bar and the list
                                await typeQuery('', null);
                                setSel(q$('select[data-notes-age]'), '7'); await until(() => !chipEl('cut'), 4000); await settle();
                                seen.age7 = { chips: chipPairs(), rows: rowEls().length };
                                seen.age7Cut = await typeQuery('#cut', []);
                                seen.age7CutState = { chips: chipFull(), empty: emptyMsg() };
                                setSel(q$('select[data-notes-age]'), '0'); await waitRows(1); await settle();
                                seen.age0Cut = { texts: rowTextsSorted(), chips: chipFull() };
                                // everything at once
                                await typeQuery('', null);
                                await pickKind('public');
                                setSel(q$('select[data-notes-age]'), '30'); await settle();
                                seen.all4 = await typeQuery('carol #rolled', [N2]);
                                const pass = same(seen.publicRolled.texts, sortedTexts([N1, N2])) && !!seen.publicRolled.summary && seen.publicRolled.summary.startsWith(`Showing 2 of ${total}`) && same(seen.publicRolled.chips, [`rolled:${publicTotal}`, 'usnyc:1', 'cut:0', 'cutcargo:0']) && same(seen.publicRolled.pressed, ['rolled']) &&
                                    same(seen.privateRolled.texts, sortedTexts([N6])) && same(seen.privateRolled.chips, [`rolled:${privateTotal}`, 'secret:1']) && same(seen.privateRolled.pressed, ['rolled']) &&
                                    same(seen.mineRolled.texts, sortedTexts([N6])) && same(seen.mineRolled.chips, [`rolled:${mineTotal}`, 'secret:1', 'usnyc:0']) && same(seen.mineRolled.pressed, ['rolled']) &&
                                    seen.zeroTyped.ok && same(seen.zero.chips, ['rolled:0:true', 'secret:0:false', 'usnyc:1:true']) && !!seen.zero.empty && seen.zero.empty.startsWith('No notes are tagged #rolled #usnyc') &&
                                    seen.zeroRemoved.query === '#rolled' && same(seen.zeroRemoved.chips, [`rolled:${privateTotal}:true`, 'secret:1:false']) && same(seen.zeroRemoved.texts, sortedTexts([N6])) &&
                                    seen.text.every(x => x.ok) && !!seen.textEmpty && seen.textEmpty.startsWith('No notes are tagged #cut') &&
                                    same(seen.age7.chips, ['rolled:3', 'usnyc:2', 'cutcargo:1', 'secret:1']) && seen.age7Cut.ok && same(seen.age7CutState.chips, ['rolled:0:false', 'usnyc:0:false', 'cutcargo:0:false', 'secret:0:false', `cut:${recentCount}:true`]) && seen.age7.rows === recentCount && !!seen.age7CutState.empty && seen.age7CutState.empty.startsWith('No notes are tagged #cut') &&
                                    same(seen.age0Cut.texts, sortedTexts([N4])) && seen.age0Cut.chips.includes(`cut:${total}:true`) &&
                                    seen.all4.ok;
                                return { pass, detail: seen };
                            });

                            // COUNT and DIM share one pass: for every chip of four search-box states, read what the chip promises
                            // (number, title, dimming), click it, count the rows really listed, and put the box back.
                            await stepMulti([N_TAGCOUNT, N_TAGDIM], async (record) => {
                                await cleanDialog(total);
                                const bobPublic = notesStore.notes.filter(n => n.visibility !== 'private' && n.author === 'bob@example.com').length;
                                const titleOf = (pressed, tag, n) => `${pressed ? 'Remove' : 'Add'} #${tag} ${pressed ? 'from' : 'to'} the search: ${n} ${n === 1 ? 'note' : 'notes'} listed`;
                                // What every chip must promise in each state, worked out by hand from the six notes (rolled: N1 N2 N6, usnyc: N1 N5,
                                // cut: N4, cutcargo: N3, secret: N6; N5 and N6 are mine, N6 is the only private one).
                                const states = [
                                    { name: 'one tag in the box', kind: 'all', query: '#rolled', want: [`rolled:${total}`, 'usnyc:1', 'cut:0', 'cutcargo:0', 'secret:1'] },
                                    { name: 'two tags in the box', kind: 'all', query: '#rolled #usnyc', want: ['rolled:2', 'usnyc:3', 'cut:0', 'cutcargo:0', 'secret:0'] },
                                    { name: 'kind chip + text + tag', kind: 'public', query: 'bob #usnyc', want: ['rolled:1', `usnyc:${bobPublic}`, 'cut:0', 'cutcargo:0'] },
                                    { name: 'a pressed chip whose removal lists nothing', kind: 'private', query: '#rolled #usnyc', want: ['rolled:0', 'secret:0', 'usnyc:1'] },
                                ];
                                const seen = { states: [] };
                                const all = [];
                                for (const st of states) {
                                    await pickKind(st.kind);
                                    setIn(searchEl(), st.query); await settle();
                                    const entry = { state: st.name, kind: st.kind, query: st.query, shown: chipPairs(), want: st.want, chips: [] };
                                    for (const c of chipInfos()) {
                                        const el = chipEl(c.tag);
                                        const pressed = c.pressed === 'true';
                                        const info = { tag: c.tag, pressed, claimed: c.count, title: el.getAttribute('title'), emptyAttr: el.getAttribute('data-notes-tag-empty'), opacity: win.getComputedStyle(el).opacity, disabled: el.disabled === true };
                                        el.click();
                                        await until(() => searchEl().value !== st.query, 3000); await settle();
                                        info.queryAfter = searchEl().value;
                                        info.tagInBoxAfter = info.queryAfter.split(/\s+/).includes(`#${c.tag}`);
                                        info.listed = rowEls().length;
                                        entry.chips.push(info); all.push(info);
                                        setIn(searchEl(), st.query); await settle();   // the next chip starts from the same box
                                    }
                                    seen.states.push(entry);
                                }
                                const wantOf = (st, tag) => { const w = st.want.find(x => x.split(':')[0] === tag); return w === undefined ? null : Number(w.split(':')[1]); };
                                const countOk = seen.states.every((e, i) => same(e.shown, e.want) && e.chips.length === e.want.length && e.chips.every(i2 =>
                                    i2.listed === i2.claimed && i2.claimed === wantOf(states[i], i2.tag) && i2.title === titleOf(i2.pressed, i2.tag, i2.listed) && i2.tagInBoxAfter === !i2.pressed));
                                record(N_TAGCOUNT, countOk && all.length >= 14 && all.some(i2 => i2.pressed) && all.some(i2 => !i2.pressed && i2.claimed > 0), seen);
                                // DIM: judged against what the click really lists, not against the number on the chip
                                const dimmedWant = (i2) => i2.listed === 0 && !i2.pressed;
                                const dimOk = all.every(i2 => (i2.emptyAttr === (dimmedWant(i2) ? 'true' : null)) && (dimmedWant(i2) ? parseFloat(i2.opacity) < 0.9 : parseFloat(i2.opacity) === 1) && i2.disabled === false);
                                const pressedEmpty = all.filter(i2 => i2.pressed && i2.listed === 0);
                                const dimmed = all.filter(dimmedWant), live = all.filter(i2 => !i2.pressed && i2.listed > 0);
                                record(N_TAGDIM, dimOk && dimmed.length >= 4 && live.length >= 3 && pressedEmpty.length >= 1 && pressedEmpty.every(i2 => i2.emptyAttr === null),
                                    { dimOk, dimmed: dimmed.map(i2 => i2.tag), live: live.map(i2 => i2.tag), pressedEmpty: pressedEmpty.map(i2 => [i2.tag, i2.emptyAttr, i2.opacity]), sample: all.map(i2 => [i2.tag, i2.pressed, i2.listed, i2.emptyAttr, i2.opacity, i2.disabled]) });
                            });

                            await step(N_TAGCLEAR, async () => {
                                await cleanDialog(total);
                                const seen = {};
                                const unpressedAll = () => Array.from(dlg().querySelectorAll('[data-note-tag]')).every(b => b.getAttribute('aria-pressed') === 'false') && chipInfos().every(c => c.pressed === 'false');
                                rowTagBtn('rolled').click(); await waitQuery('#rolled'); await waitRows(3); await settle();
                                seen.active = { summary: summary(), clearButton: !!q$('[data-notes-clear-filters]') };
                                q$('[data-notes-clear-filters]').click();
                                await until(() => rowEls().length === total && !summary(), 4000); await settle();
                                seen.cleared = { query: searchEl().value, rows: rowEls().length, summary: summary(), unpressed: unpressedAll(), chips: chipPairs() };
                                // everything at once
                                await pickKind('public');
                                setSel(q$('select[data-notes-age]'), '7'); await settle();
                                seen.combined = await typeQuery('#rolled #usnyc bob', [N1]);
                                seen.combinedSummary = summary();
                                q$('[data-notes-clear-filters]').click();
                                await until(() => rowEls().length === total && !summary(), 4000); await settle();
                                seen.combinedCleared = { query: searchEl().value, kindChecked: (q$('[data-notes-kind-filter][aria-checked="true"]') || { getAttribute: () => null }).getAttribute('data-notes-kind-filter'), age: q$('select[data-notes-age]').value, rows: rowEls().length, unpressed: unpressedAll() };
                                // a zero-count pressed chip goes with the query
                                setIn(searchEl(), '#nosuchtag'); await until(() => !!chipEl('nosuchtag'), 4000); await settle();
                                seen.zeroShown = { chips: chipFull() };
                                q$('[data-notes-clear-filters]').click();
                                await until(() => !chipEl('nosuchtag') && rowEls().length === total, 4000); await settle();
                                seen.zeroCleared = { query: searchEl().value, chips: chipPairs(), unpressed: unpressedAll() };
                                const pass = !!seen.active.summary && seen.active.summary.startsWith(`Showing 3 of ${total}`) && seen.active.summary.includes('Clear filters') && seen.active.clearButton &&
                                    seen.cleared.query === '' && seen.cleared.rows === total && seen.cleared.summary === null && seen.cleared.unpressed && same(seen.cleared.chips, POOL_ALL) &&
                                    seen.combined.ok && !!seen.combinedSummary && seen.combinedSummary.startsWith(`Showing 1 of ${total}`) &&
                                    seen.combinedCleared.query === '' && seen.combinedCleared.kindChecked === 'all' && seen.combinedCleared.age === '0' && seen.combinedCleared.rows === total && seen.combinedCleared.unpressed &&
                                    same(seen.zeroShown.chips, [...POOL_ALL.map(x => `${x.split(':')[0]}:0:false`), `nosuchtag:${total}:true`]) && seen.zeroCleared.query === '' && same(seen.zeroCleared.chips, POOL_ALL) && seen.zeroCleared.unpressed;
                                return { pass, detail: seen };
                            });

                            // The three editor steps below each open their own dialog: they type into the VVD box and the draft, state
                            // no filter control can put back.
                            await step(N_TAGPLACES, async () => {
                                await freshDialog(total);
                                const seen = {};
                                // (i) other people's notes above the editor
                                await setVvd(N1.vvd);
                                const holderOf = (note) => Array.from(edRegion().querySelectorAll('.whitespace-pre-wrap')).find(h => h.textContent === note);
                                const hOthers = holderOf(N1.note);
                                const bOthers = hOthers ? Array.from(hOthers.querySelectorAll('[data-note-tag]')) : [];
                                seen.others = { found: !!hOthers, buttons: bOthers.map(b => [b.getAttribute('data-note-tag'), b.textContent]), attrsOk: attrsOk(bOthers) };
                                const usnycInEditor = bOthers.find(b => b.getAttribute('data-note-tag') === 'usnyc');
                                if (usnycInEditor) usnycInEditor.click();
                                await waitQuery('#usnyc'); await waitRows(2); await settle();
                                seen.othersClick = { query: searchEl().value, box: vvdBox().value, pressedEverywhere: pressedOf(tagBtns('usnyc')), inEditorPressed: pressedOf(tagBtns('usnyc', edRegion())), chips: pressedTags(), texts: rowTextsSorted() };
                                tagBtns('usnyc', edRegion())[0].click();
                                await waitQuery(''); await waitRows(total); await settle();
                                seen.othersOff = { query: searchEl().value, box: vvdBox().value, pressedEverywhere: pressedOf(tagBtns('usnyc')) };
                                // (ii) the "You also have a ... note" line
                                await setVvd(N5.vvd);
                                const alsoP = () => Array.from(edRegion().querySelectorAll('p')).find(p => p.textContent.startsWith('You also have a'));
                                await until(() => !!alsoP(), 4000);
                                const span = alsoP() && alsoP().querySelector('span.whitespace-pre-wrap');
                                const bAlso = span ? Array.from(span.querySelectorAll('[data-note-tag]')) : [];
                                seen.also = { found: !!span, textExact: !!span && span.textContent === N6.note, buttons: bAlso.map(b => [b.getAttribute('data-note-tag'), b.textContent]), attrsOk: attrsOk(bAlso) };
                                const draftBefore = taEl().value;
                                const secretInLine = bAlso.find(b => b.getAttribute('data-note-tag') === 'secret');
                                if (secretInLine) secretInLine.click();
                                await waitQuery('#secret'); await waitRows(1); await settle();
                                seen.alsoClick = { query: searchEl().value, box: vvdBox().value, draftKept: taEl().value === draftBefore && draftBefore === N5.note, texts: rowTextsSorted(), pressedEverywhere: pressedOf(tagBtns('secret')) };
                                const pass = seen.others.found && same(seen.others.buttons, [['rolled', '#rolled'], ['usnyc', '#usnyc']]) && seen.others.attrsOk && !!hOthers && hOthers.textContent === N1.note &&
                                    seen.othersClick.query === '#usnyc' && seen.othersClick.box === N1.vvd && seen.othersClick.pressedEverywhere.length >= 3 && seen.othersClick.pressedEverywhere.every(p => p === 'true') && same(seen.othersClick.chips, ['usnyc']) && same(seen.othersClick.texts, sortedTexts([N1, N5])) &&
                                    seen.othersOff.query === '' && seen.othersOff.box === N1.vvd && seen.othersOff.pressedEverywhere.every(p => p === 'false') &&
                                    seen.also.found && seen.also.textExact && same(seen.also.buttons, [['secret', '#secret'], ['rolled', '#rolled']]) && seen.also.attrsOk &&
                                    seen.alsoClick.query === '#secret' && seen.alsoClick.box === N5.vvd && seen.alsoClick.draftKept && same(seen.alsoClick.texts, sortedTexts([N6])) && seen.alsoClick.pressedEverywhere.length >= 2 && seen.alsoClick.pressedEverywhere.every(p => p === 'true');
                                return { pass, detail: seen };
                            });

                            await step(N_TAGDRAFT, async () => {
                                await freshDialog(total);
                                const HINT = 'Tip: add #tags such as #rolled to make this note searchable.';
                                const FOLLOWING = win.Node.DOCUMENT_POSITION_FOLLOWING;
                                const seen = {};
                                const one = (s) => (s.tags === null) !== (s.hint === null);   // exactly one of the two
                                seen.noVvd = draftState();
                                await setVvd(N1.vvd);
                                seen.emptyDraft = { ...draftState(), draft: taEl().value, placeholder: taEl().getAttribute('placeholder') };
                                const p = q$('[data-note-draft-tags-hint]');
                                seen.position = { afterTextarea: !!p && !!(taEl().compareDocumentPosition(p) & FOLLOWING), inEditorRegion: !!p && edRegion().contains(p) };
                                const drafts = [['Cut 5 TEU #Rolled and #usnyc #ROLLED', 'Tags: #rolled #usnyc'], ['bay #3, ref #12, http://x/y#frag', null], ['#a', 'Tags: #a'], ['', null], ['x #cafe_1-b- y', 'Tags: #cafe_1-b']];
                                seen.drafts = [];
                                for (const [text, want] of drafts) { await typeDraft(text); const s = draftState(); seen.drafts.push({ text, ...s, ok: one(s) && (want === null ? s.hint === HINT : s.tags === want) }); }
                                // Switching to Private carries an unsaved draft along (the app's rule when no private note is saved on the VVD),
                                // so the line under the textarea must keep describing THAT draft -- and then follow it as it is emptied and retyped.
                                q$('[data-note-visibility="private"]').click();
                                await until(() => !!q$('[data-note-visibility="private"][aria-checked="true"]'), 4000); await settle();
                                seen.privateCarried = { ...draftState(), draft: taEl().value };
                                await typeDraft('');
                                seen.privateEmpty = { ...draftState(), placeholder: taEl().getAttribute('placeholder') };
                                await typeDraft('#secret');
                                seen.privateTyped = draftState();
                                const pass = seen.noVvd.tags === null && seen.noVvd.hint === null &&
                                    seen.emptyDraft.draft === '' && seen.emptyDraft.hint === HINT && seen.emptyDraft.tags === null && seen.emptyDraft.placeholder === 'What was cut, e.g. "Cut 40 TEU at USNYC -- rolled to next week"' &&
                                    seen.position.afterTextarea && seen.position.inEditorRegion && seen.drafts.every(s => s.ok) &&
                                    seen.privateCarried.draft === 'x #cafe_1-b- y' && seen.privateCarried.tags === 'Tags: #cafe_1-b' && seen.privateCarried.hint === null &&
                                    one(seen.privateEmpty) && seen.privateEmpty.hint === HINT && seen.privateEmpty.placeholder === 'Only you will see this' && seen.privateTyped.tags === 'Tags: #secret' && seen.privateTyped.hint === null;
                                return { pass, detail: seen };
                            });

                            await step(N_TAGEDITOR, async () => {
                                await freshDialog(total);
                                const savesBefore = fake.calls.filter(c => c.name === 'saveVvdNote').length;
                                const savesNow = () => fake.calls.filter(c => c.name === 'saveVvdNote').length;
                                await setVvd(N5.vvd);   // ME has a public (N5) and a private (N6) note here, so the Public editor opens
                                const snap = () => {
                                    const checked = q$('[data-note-visibility][aria-checked="true"]');
                                    const saveBtn = Array.from(edRegion().querySelectorAll('button')).find(b => /^Save (public|private) note$/.test(b.textContent.trim()));
                                    return { box: vvdBox().value, draft: taEl().value, checked: checked && checked.getAttribute('data-note-visibility'), draftTags: draftState(), saveLabel: saveBtn && saveBtn.textContent.trim(), saveDisabled: saveBtn && saveBtn.disabled, savedStatus: edRegion().textContent.includes('Saved'), open: !!dlg() };
                                };
                                const alsoBtn = (key) => { const p = Array.from(edRegion().querySelectorAll('p')).find(x => x.textContent.startsWith('You also have a')); return p ? tagBtns(key, p)[0] : null; };
                                const seen = { private: {}, public: {} };
                                const run = async (bucket, snap0, actions) => {
                                    for (const [label, act, wantQuery] of actions) {
                                        await act(); await waitQuery(wantQuery); await settle();
                                        const s = snap();
                                        bucket[label] = { query: searchEl().value, unchanged: same(s, snap0), snap: same(s, snap0) ? undefined : s };
                                    }
                                };
                                // Private editor with an unsaved edit of the saved private note
                                q$('[data-note-visibility="private"]').click();
                                await until(() => !!q$('[data-note-visibility="private"][aria-checked="true"]') && taEl().value === N6.note, 4000);
                                await typeDraft(`${N6.note} -- edited, unsaved`);
                                const snapPrivate = snap();
                                await run(seen.private, snapPrivate, [
                                    ['rowTag', async () => rowTagBtn('cut').click(), '#cut'],
                                    ['chip', async () => chipEl('usnyc').click(), '#cut #usnyc'],
                                    ['alsoLine', async () => alsoBtn('usnyc').click(), '#cut'],
                                    ['typed', async () => setIn(searchEl(), '#rolled #secret'), '#rolled #secret'],
                                    ['clear', async () => q$('[data-notes-clear-filters]').click(), ''],
                                ]);
                                // Public editor with an unsaved edit of the saved public note
                                q$('[data-note-visibility="public"]').click();
                                await until(() => !!q$('[data-note-visibility="public"][aria-checked="true"]') && taEl().value === N5.note, 4000);
                                await typeDraft(`${N5.note} -- edited, unsaved`);
                                const snapPublic = snap();
                                await run(seen.public, snapPublic, [
                                    ['rowTag', async () => rowTagBtn('rolled').click(), '#rolled'],
                                    ['chip', async () => chipEl('secret').click(), '#rolled #secret'],
                                    ['alsoLine', async () => alsoBtn('secret').click(), '#rolled'],
                                    ['clear', async () => q$('[data-notes-clear-filters]').click(), ''],
                                ]);
                                const everyUnchanged = (b) => Object.values(b).length > 0 && Object.values(b).every(x => x.unchanged);
                                const pass = snapPrivate.box === N5.vvd && snapPrivate.checked === 'private' && snapPrivate.draft === `${N6.note} -- edited, unsaved` && snapPrivate.saveDisabled === false && snapPrivate.savedStatus === false && snapPrivate.draftTags.tags === 'Tags: #secret #rolled' &&
                                    snapPublic.box === N5.vvd && snapPublic.checked === 'public' && snapPublic.draft === `${N5.note} -- edited, unsaved` && snapPublic.saveDisabled === false && snapPublic.draftTags.tags === 'Tags: #usnyc' &&
                                    Object.keys(seen.private).length === 5 && everyUnchanged(seen.private) && Object.keys(seen.public).length === 4 && everyUnchanged(seen.public) && savesNow() === savesBefore;
                                return { pass, detail: { snapPrivate, snapPublic, ...seen, savesBefore, savesAfter: savesNow() } };
                            });

                            await step(N_TAGPRIV, async () => {
                                const seen = {};
                                await freshDialog(total);
                                seen.pools = {};
                                for (const kind of ['all', 'public', 'private', 'mine']) { await pickKind(kind); seen.pools[kind] = chipPairs(); }
                                // Private notes unavailable: the real server sends only the public notes (and nobody else's private ones, ever).
                                await closeDialog();
                                const everything = notesStore.notes;
                                const publicOnly = everything.filter(n => n.visibility !== 'private');
                                notesStore.notes = publicOnly; notesStore.privateAvailable = false;
                                try {
                                    await freshDialog(publicOnly.length);
                                    await until(() => !q$('[data-notes-kind-filter="private"]'), 5000);
                                    seen.unavailable = { rows: rowEls().length, wantRows: publicOnly.length, chips: chipPairs(), privateKindChip: !!q$('[data-notes-kind-filter="private"]'), secretButtons: tagBtns('secret').length, dialogShowsSecret: dlg().textContent.includes('#secret') };
                                    seen.typedSecret = await typeQuery('#secret', []);
                                    seen.typedSecretState = { chips: chipFull(), empty: emptyMsg() };
                                } finally {
                                    notesStore.notes = everything; notesStore.privateAvailable = baseAvailable;
                                }
                                await freshDialog(total);
                                seen.restored = { rows: rowEls().length, chips: chipPairs(), privateKindChip: !!q$('[data-notes-kind-filter="private"]'), secretButtons: tagBtns('secret').length };
                                const pass = same(seen.pools.all, POOL_ALL) && same(seen.pools.public, POOL_PUBLIC) && same(seen.pools.private, POOL_PRIVATE) && same(seen.pools.mine, POOL_MINE) && !seen.pools.public.some(x => x.startsWith('secret:')) &&
                                    seen.unavailable.rows === seen.unavailable.wantRows && same(seen.unavailable.chips, POOL_PUBLIC) && seen.unavailable.privateKindChip === false && seen.unavailable.secretButtons === 0 && seen.unavailable.dialogShowsSecret === false &&
                                    seen.typedSecret.ok && same(seen.typedSecretState.chips, [...POOL_PUBLIC.map(x => `${x.split(':')[0]}:0:false`), `secret:${seen.unavailable.wantRows}:true`]) && !!seen.typedSecretState.empty && seen.typedSecretState.empty.startsWith('No notes are tagged #secret') &&
                                    seen.restored.rows === total && same(seen.restored.chips, POOL_ALL) && seen.restored.privateKindChip === true && seen.restored.secretButtons === 1;
                                return { pass, detail: seen };
                            });

                            await step(N_TAGSLICER, async () => {
                                // The slicers narrow the list first (visibleNoteVvds / notesInView), and the tag bar is built from what is
                                // left -- so a tag on a note the slicers hide is not offered. Same Lane-slicer technique as the slicer check above:
                                // the lane of V3 comes from the fixture, and the tagged notes sit on VVDs that are in no lane, so they drop out.
                                const fxRows = window.XLSX.utils.sheet_to_json(fixtureWb.Sheets[fixtureWb.SheetNames[0]], { raw: false, defval: '' });
                                const fxRow = fxRows.find(x => norm(x['Vessel 1st VVD']) === V3);
                                const lane = fxRow ? String(fxRow['Vessel 1st Lane']).trim() : '';
                                const laneBtn = lane && Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === lane && b.className.includes('w-[44px]'));
                                if (!laneBtn) return { pass: false, detail: { problem: 'no Lane slicer button for the lane of V3', V3, lane } };
                                if (dlg()) await closeDialog();
                                const label = () => notesBtn().textContent.trim();
                                const labelBefore = label();
                                const seen = { lane, labelBefore };
                                try {
                                    laneBtn.click();
                                    seen.narrowedLabelOk = await until(() => / of \d+\)$/.test(label()), 10000);
                                    seen.narrowedLabel = label();
                                    notesBtn().click();
                                    await until(() => !!dlg() && /^Notes Matching the Current Filters/.test(heading() || ''), 5000);
                                    await settle();
                                    seen.narrowed = { heading: heading(), rows: rowEls().length, bar: !!barEl(), tagButtons: dlg().querySelectorAll('[data-note-tag]').length, showAll: (q$('[data-notes-show-all]') || {}).textContent };
                                    setIn(searchEl(), '#rolled'); await until(() => !!q$('[data-notes-empty]'), 4000); await settle();
                                    seen.typed = { chips: chipFull(), empty: emptyMsg() };
                                    setIn(searchEl(), ''); await until(() => !chipEl('rolled'), 4000); await settle();
                                    q$('[data-notes-show-all]').click();
                                    await until(() => rowEls().length === total, 5000); await settle();
                                    seen.showAll = { heading: heading(), chips: chipPairs(), backButton: (q$('[data-notes-show-all]') || {}).textContent };
                                    q$('[data-notes-show-all]').click();
                                    await until(() => !barEl() && /^Notes Matching/.test(heading() || ''), 5000); await settle();
                                    seen.back = { heading: heading(), bar: !!barEl() };
                                } finally {
                                    if (dlg()) await closeDialog();
                                    laneBtn.click();   // clear the slicer so everything after this sees the unfiltered data
                                    seen.clearedOk = await until(() => label() === labelBefore, 10000);
                                }
                                const n = seen.narrowed;
                                const pass = !!seen.narrowedLabelOk && !!n && /^Notes Matching the Current Filters \(\d+ of \d+\)$/.test(n.heading) && n.rows > 0 && n.rows < total && n.bar === false && n.tagButtons === 0 && n.showAll === `Show all ${total}` &&
                                    same(seen.typed.chips, [`rolled:${n.rows}:true`]) && !!seen.typed.empty && seen.typed.empty.startsWith('No notes are tagged #rolled') && seen.typed.empty.includes('The slicers are also hiding') && seen.typed.empty.includes(`Show all ${total}`) &&
                                    seen.showAll.heading === `All Notes (${total})` && same(seen.showAll.chips, POOL_ALL) && seen.showAll.backButton === 'Only the current filters' &&
                                    !!seen.back && seen.back.bar === false && /^Notes Matching the Current Filters/.test(seen.back.heading) && seen.clearedOk === true;
                                return { pass, detail: seen };
                            });

                            await step(N_TAGMORE, async () => {
                                const many = { vvd: 'HTAG0007G', note: Array.from({ length: 14 }, (_, i) => `#t${String(i + 1).padStart(2, '0')}`).join(' '), author: 'bob@example.com', visibility: 'public', updatedAt: ago(6) };
                                const before = notesStore.notes;
                                notesStore.notes = before.concat([many]);
                                try {
                                    await freshDialog(total + 1);
                                    const moreEl = () => q$('[data-notes-tag-more]');
                                    const first12 = ['rolled', 'usnyc', 'cut', 'cutcargo', 'secret', 't01', 't02', 't03', 't04', 't05', 't06', 't07'];
                                    const seen = {};
                                    seen.start = { tags: chipInfos().map(c => c.tag), more: moreEl() && moreEl().textContent.trim() };
                                    // the button is a sibling of the scrolling chip list inside the bar, never one of the things that scroll
                                    seen.place = { inBar: !!moreEl() && barEl().contains(moreEl()), besideList: !!moreEl() && moreEl().parentElement === q$('[data-notes-tag-list]').parentElement, insideList: !!moreEl() && q$('[data-notes-tag-list]').contains(moreEl()) };
                                    setIn(searchEl(), '#t14'); await until(() => !!chipEl('t14'), 4000); await settle();
                                    seen.pressedHidden = { tags: chipInfos().map(c => c.tag), t14: chipFull().find(x => x.startsWith('t14:')), more: moreEl() && moreEl().textContent.trim() };
                                    moreEl().click(); await until(() => chipInfos().length === 19, 4000); await settle();
                                    seen.all = { chips: chipInfos().length, more: moreEl() && moreEl().textContent.trim() };
                                    moreEl().click(); await until(() => chipInfos().length === 13, 4000); await settle();
                                    seen.fewer = { chips: chipInfos().length, more: moreEl() && moreEl().textContent.trim() };
                                    setIn(searchEl(), ''); await until(() => chipInfos().length === 12, 4000); await settle();
                                    seen.cleared = { chips: chipInfos().length, more: moreEl() && moreEl().textContent.trim() };
                                    const pass = same(seen.start.tags, first12) && seen.start.more === 'Show all 19 tags' && seen.place.inBar && seen.place.besideList && !seen.place.insideList &&
                                        seen.pressedHidden.tags.length === 13 && same(seen.pressedHidden.tags.slice(0, 12), first12) && seen.pressedHidden.tags[12] === 't14' && seen.pressedHidden.t14 === `t14:${total + 1}:true` && seen.pressedHidden.more === 'Show all 19 tags' &&
                                        seen.all.chips === 19 && seen.all.more === 'Show fewer' && seen.fewer.chips === 13 && seen.fewer.more === 'Show all 19 tags' && seen.cleared.chips === 12 && seen.cleared.more === 'Show all 19 tags';
                                    return { pass, detail: seen };
                                } finally {
                                    notesStore.notes = before;
                                }
                            });

                            // UNICODE and INLINE share one dialog over four extra notes: a tag with a capital dotted I, the same word
                            // spelled with a precomposed and with a decomposed accent, and a tag longer than any line. The tags are written
                            // as escapes so no editor can "normalise" the fixture: U+0130 is "İ" (lower-cases to "i" + U+0307, a different
                            // letter count and a lower-case that a case-sensitive pattern does not accept), U+00E9 is "é", and "e" + U+0301
                            // is the same letter built from two code points (it used to leave the mark outside the button).
                            await stepMulti([N_TAGUNICODE, N_TAGINLINE], async (record) => {
                                const NI = { vvd: 'HTAG0008I', note: 'transit via #İstanbul next week', author: 'bob@example.com', visibility: 'public', updatedAt: ago(7) };
                                const NC = { vvd: 'HTAG0009C', note: 'stop at #café today', author: 'carol@example.com', visibility: 'public', updatedAt: ago(8) };
                                const ND = { vvd: 'HTAG0010C', note: 'also #café later', author: 'carol@example.com', visibility: 'public', updatedAt: ago(9) };
                                const LONG = 'w'.repeat(140);
                                const NL = { vvd: 'HTAG0011L', note: `long #${LONG} tag`, author: 'bob@example.com', visibility: 'public', updatedAt: ago(10) };
                                const before = notesStore.notes;
                                notesStore.notes = before.concat([NI, NC, ND, NL]);
                                try {
                                    await freshDialog(total + 4);
                                    const KEY_I = 'İstanbul'.toLowerCase().normalize('NFC');   // "i" + U+0307 + "stanbul"
                                    const KEY_C = 'café';
                                    const VALID_TOKEN = /^#\p{L}[\p{L}\p{M}\p{N}_-]*$/u;
                                    const holderOf = (n) => { const li = rowEls().find(l => l.children[1] && l.children[1].textContent === n.note); return li ? li.children[1] : null; };
                                    const btnsOf = (n) => { const h = holderOf(n); return h ? Array.from(h.querySelectorAll('[data-note-tag]')) : []; };
                                    const describe = (n) => ({ holderText: !!holderOf(n), buttons: btnsOf(n).map(b => [b.getAttribute('data-note-tag'), b.textContent]) });
                                    const seen = { istanbul: describe(NI), cafe: describe(NC), decomposed: describe(ND) };
                                    const chipsNow = chipInfos();
                                    seen.chips = { istanbul: chipsNow.filter(c => c.tag === KEY_I).map(c => `${c.tag}:${c.count}`), cafe: chipsNow.filter(c => c.tag.normalize('NFC') === KEY_C).map(c => `${c.tag}:${c.count}`), notNfc: chipsNow.filter(c => c.tag !== c.tag.normalize('NFC')).length };
                                    // the Istanbul button
                                    btnsOf(NI)[0].click(); await until(() => searchEl().value !== '', 3000); await settle();
                                    seen.istanbulOn = { query: searchEl().value, valid: VALID_TOKEN.test(searchEl().value), texts: rowTextsSorted(), buttons: pressedOf(btnsOf(NI)), chips: pressedTags() };
                                    btnsOf(NI)[0].click(); await until(() => searchEl().value === '', 3000); await settle();
                                    seen.istanbulOff = { query: searchEl().value, rows: rowEls().length, buttons: pressedOf(btnsOf(NI)) };
                                    // the decomposed cafe button, then the precomposed one switches it off again (one key for both spellings)
                                    btnsOf(ND)[0].click(); await until(() => searchEl().value !== '', 3000); await settle();
                                    seen.decomposedOn = { query: searchEl().value, valid: VALID_TOKEN.test(searchEl().value), texts: rowTextsSorted(), buttons: pressedOf(btnsOf(NC).concat(btnsOf(ND))), chips: pressedTags() };
                                    btnsOf(NC)[0].click(); await until(() => searchEl().value === '', 3000); await settle();
                                    seen.precomposedOff = { query: searchEl().value, rows: rowEls().length, buttons: pressedOf(btnsOf(NC).concat(btnsOf(ND))) };
                                    // typed, not clicked
                                    seen.typed = [await typeQuery('#café', [NC, ND]), await typeQuery('#İSTANBUL', [NI])];
                                    await typeQuery('', null);
                                    const holderIstanbul = holderOf(NI), holderDecomposed = holderOf(ND);
                                    const pass = !!holderIstanbul && holderIstanbul.textContent === NI.note && same(seen.istanbul.buttons, [[KEY_I, '#İstanbul']]) &&
                                        !!holderDecomposed && holderDecomposed.textContent === ND.note && same(seen.decomposed.buttons, [[KEY_C, '#café']]) && same(seen.cafe.buttons, [[KEY_C, '#café']]) &&
                                        same(seen.chips.istanbul, [`${KEY_I}:1`]) && same(seen.chips.cafe, [`${KEY_C}:2`]) && seen.chips.notNfc === 0 &&
                                        seen.istanbulOn.query === `#${KEY_I}` && seen.istanbulOn.valid && same(seen.istanbulOn.texts, sortedTexts([NI])) && same(seen.istanbulOn.buttons, ['true']) && same(seen.istanbulOn.chips, [KEY_I]) &&
                                        seen.istanbulOff.query === '' && seen.istanbulOff.rows === total + 4 && same(seen.istanbulOff.buttons, ['false']) &&
                                        seen.decomposedOn.query === `#${KEY_C}` && seen.decomposedOn.valid && same(seen.decomposedOn.texts, sortedTexts([NC, ND])) && same(seen.decomposedOn.buttons, ['true', 'true']) && same(seen.decomposedOn.chips, [KEY_C]) &&
                                        seen.precomposedOff.query === '' && seen.precomposedOff.rows === total + 4 && same(seen.precomposedOff.buttons, ['false', 'false']) &&
                                        seen.typed[0].ok && same(seen.typed[0].pressed, [KEY_C]) && seen.typed[1].ok && same(seen.typed[1].pressed, [KEY_I]);
                                    record(N_TAGUNICODE, pass, seen);

                                    // INLINE: every in-note tag button, in the list rows, as the browser really lays it out
                                    const allBtns = Array.from(listUl().querySelectorAll('[data-note-tag]'));
                                    const n1Btns = btnsOf(N1);
                                    const longBtn = btnsOf(NL)[0], longHolder = holderOf(NL), panel = dlg();
                                    const lb = longBtn && longBtn.getBoundingClientRect(), lh = longHolder && longHolder.getBoundingClientRect();
                                    const lcs = longBtn && win.getComputedStyle(longBtn);
                                    const inl = {
                                        buttons: allBtns.length,
                                        displays: Array.from(new Set(allBtns.map(b => win.getComputedStyle(b).display))),
                                        classSaysInlineBlock: allBtns.every(b => b.classList.contains('inline-block') && !b.classList.contains('inline')),
                                        // two short tags in one line of text (N1: "#rolled  #usnyc") sit side by side, as inline-blocks do
                                        sameLine: n1Btns.length === 2 && Math.abs(n1Btns[0].getBoundingClientRect().top - n1Btns[1].getBoundingClientRect().top) < 3,
                                        longTag: longBtn ? { text: longBtn.textContent.length, width: Math.round(lb.width), holderWidth: Math.round(lh.width), height: Math.round(lb.height), fontSize: lcs.fontSize, insideHolder: lb.right <= lh.right + 1 && lb.left >= lh.left - 1, buttonOverflows: longBtn.scrollWidth > longBtn.clientWidth + 1, holderOverflows: longHolder.scrollWidth > longHolder.clientWidth + 1, panelOverflows: panel.scrollWidth > panel.clientWidth + 1 } : null,
                                    };
                                    const lt = inl.longTag;
                                    record(N_TAGINLINE, allBtns.length >= 12 && same(inl.displays, ['inline-block']) && inl.classSaysInlineBlock && inl.sameLine && !!lt && lt.text === LONG.length + 1 && lt.insideHolder && !lt.buttonOverflows && !lt.holderOverflows && !lt.panelOverflows && lt.height > 2 * parseFloat(lt.fontSize), inl);
                                } finally {
                                    notesStore.notes = before;
                                }
                            });

                            // BOUND: the bar must not take over the dialog. 45 tags and "Show all" in a window 700 px high -- the case where
                            // the chips used to push every note row out of sight. The frame is the app's whole viewport, so its height is the window's.
                            await step(N_TAGBOUND, async () => {
                                const tags = Array.from({ length: 40 }, (_, i) => `#bound_tag_${String(i + 1).padStart(2, '0')}`);
                                const wide = { vvd: 'HTAG0012B', note: `forty tags ${tags.join(' ')}`, author: 'bob@example.com', visibility: 'public', updatedAt: ago(11) };
                                const before = notesStore.notes;
                                const frame = win.frameElement, frameHeight = frame.style.height;
                                notesStore.notes = before.concat([wide]);
                                try {
                                    frame.style.height = '700px';
                                    await freshDialog(total + 1);
                                    const R = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
                                    const inside = (inner, outer) => inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1 && inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
                                    const hit = (el) => { const r = el.getBoundingClientRect(); const top = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (el === top || el.contains(top)); };
                                    const moreEl = () => q$('[data-notes-tag-more]'), listEl = () => q$('[data-notes-tag-list]'), regionEl = () => q$('[data-notes-list-region]');
                                    const headerEl = () => { for (let e = barEl() && barEl().parentElement; e && e !== regionEl(); e = e.parentElement) if (win.getComputedStyle(e).position === 'sticky') return e; return null; };
                                    const seen = { innerHeight: win.innerHeight };
                                    seen.collapsed = { chips: chipInfos().length, barHeight: R(barEl()).height, more: moreEl() && moreEl().textContent.trim() };
                                    moreEl().click(); await until(() => chipInfos().length === 45, 3000); await settle();
                                    const bar = barEl(), list = listEl(), more = moreEl(), head = headerEl(), region = regionEl();
                                    const barR = R(bar), moreR = R(more), regionR = R(region), headR = head && R(head);
                                    seen.expanded = {
                                        chips: chipInfos().length, more: more.textContent.trim(), barHeight: barR.height, headerHeight: headR && headR.height,
                                        listHeight: R(list).height, listClientHeight: list.clientHeight, listScrollHeight: list.scrollHeight, overflowY: win.getComputedStyle(list).overflowY,
                                        moreInBar: inside(moreR, barR), moreInsideList: list.contains(more), moreBesideList: more.parentElement === list.parentElement, moreVisible: more.checkVisibility(), moreHit: hit(more),
                                    };
                                    const rowsArea = headR ? regionR.bottom - headR.bottom : null;
                                    const visibleRows = rowEls().filter(li => {
                                        const r = R(li), top = Math.max(r.top, headR ? headR.bottom : regionR.top), bottom = Math.min(r.bottom, regionR.bottom);
                                        if (bottom - top < 10) return false;
                                        const e = doc.elementFromPoint(r.left + 24, (top + bottom) / 2);
                                        return !!e && li.contains(e);
                                    }).length;
                                    seen.rows = { rowsArea, regionHeight: regionR.height, visibleRows };
                                    // the chips scroll inside their own box while the button does not move
                                    list.scrollTop = list.scrollHeight; await settle();
                                    const chips = Array.from(list.querySelectorAll('[data-notes-tag-chip]')), listR = R(list), moreAfter = R(more);
                                    seen.scrolled = { scrollTop: list.scrollTop, lastChipInView: inside(R(chips[chips.length - 1]), listR), firstChipOutOfView: R(chips[0]).bottom <= listR.top + 1, moreMoved: Math.abs(moreAfter.top - moreR.top) > 0.5 || Math.abs(moreAfter.left - moreR.left) > 0.5, moreHit: hit(more) };
                                    const e = seen.expanded, sc = seen.scrolled;
                                    const pass = seen.innerHeight === 700 && seen.collapsed.chips === 12 && seen.collapsed.barHeight <= 120 && seen.collapsed.more === 'Show all 45 tags' &&
                                        e.chips === 45 && e.more === 'Show fewer' && e.barHeight <= 120 && e.listHeight <= 100 && e.overflowY === 'auto' && e.listScrollHeight > e.listClientHeight + 20 &&
                                        e.moreInBar && !e.moreInsideList && e.moreBesideList && e.moreVisible && e.moreHit &&
                                        rowsArea !== null && rowsArea >= 60 && visibleRows >= 1 &&
                                        sc.scrollTop > 0 && sc.lastChipInView && sc.firstChipOutOfView && !sc.moreMoved && sc.moreHit;
                                    return { pass, detail: seen };
                                } finally {
                                    notesStore.notes = before;
                                    if (dlg()) await closeDialog();
                                    frame.style.height = frameHeight;
                                }
                            });
                        } finally {
                            // Whatever happened above: close the dialog, put the server's notes back exactly as they were, and
                            // re-sync the app (opening the dialog re-reads the list), so nothing below sees a tagged note.
                            notesStore.notes = baseNotes;
                            notesStore.privateAvailable = baseAvailable;
                            try {
                                if (dlg()) await closeDialog();
                                await freshDialog(baseCount);
                                await closeDialog();
                            } catch (err) { /* the checks below will show it if the dialog is stuck */ }
                        }
                    });
                }

                // ---- export from Detail ----
                const detailCells = await captureExport(doc, win);
                const hasBadgeText = (c) => /📝|✂️|🔒/u.test(c);
                rec('Excel export (Detail): the exported cells carry the VVDs but never a notes badge (✂️ / 🔒)',
                    !!detailCells && detailCells.includes(V1) && !detailCells.some(hasBadgeText),
                    { cells: detailCells && detailCells.length, hasV1: !!detailCells && detailCells.includes(V1), badgeCells: detailCells && detailCells.filter(hasBadgeText).slice(0, 5) });

                // ---- POL ----
                polSetRenderAll(win, true);
                await gotoTab(doc, 'POL Booking Flash');
                await waitFor(() => polVvdSpans(doc).length > 0 && Array.from(visibleTable(doc).querySelectorAll('[data-vvd-notes]')).length > 0, { timeout: 30000 });
                await sleep(500);
                const polRep = badgeReport(visibleTable(doc), true);
                rec('Notes (POL): a badge on every VVD cell of exactly the same three VVDs, with the same marks and hover text (V1 is back to bob\'s one note)',
                    badgesOk(polRep), { polRep });
                const polWidth = polVvdThWidth(doc);
                // The VVD column fits at ~106px (its header, wider than any plain VVD), so equality
                // alone would pass even if the badge were measured -- unless a badged cell needs MORE
                // than that. The app fits a column at ceil(widest content + AUTO_FIT_PADDING); require
                // that the widest badged cell's content + that padding exceeds the fitted width, so
                // this check cannot be vacuous.
                const AUTO_FIT_PADDING = 22;
                let widestBadged = 0;
                Array.from(visibleTable(doc).querySelectorAll('[data-vvd-notes]')).forEach(b => {
                    const range = doc.createRange();
                    range.selectNodeContents(b.closest('td'));
                    widestBadged = Math.max(widestBadged, range.getBoundingClientRect().width + AUTO_FIT_PADDING);
                });
                widestBadged = Math.round(widestBadged * 10) / 10;
                rec('Notes (POL): auto-fit measures the VVD column without the badge -- same width as in the control with no notes, although a badged cell would need more',
                    !!polWidth && polWidth === controlPolWidth && widestBadged > parseFloat(polWidth), { polWidth, controlPolWidth, widestBadgedCellNeeds: widestBadged });

                // Badge click on POL, on V3, where the viewer already has a note.
                openCalls.length = 0;
                const polBadge3 = Array.from(visibleTable(doc).querySelectorAll('[data-vvd-notes]')).find(b => b.getAttribute('data-vvd-notes') === V3);
                polBadge3.click();
                await waitFor(() => !!doc.querySelector('[data-vvd-notes-panel]'), { timeout: 5000 });
                await sleep(500);
                const panel3 = doc.querySelector('[data-vvd-notes-panel]');
                const box3 = doc.getElementById('vvd-note-vvd');
                const ta3 = doc.getElementById('vvd-note-text');
                const checked3 = panel3 && panel3.querySelector('[data-note-visibility][aria-checked="true"]');
                rec('Notes (POL): clicking a badge opens the dialog on that VVD with the viewer\'s own private note ready to edit or delete, opens no Gmail tab and highlights no row',
                    !!panel3 && box3.value === V3 && !!ta3 && ta3.value === 'mine on v3' && !!checked3 && checked3.getAttribute('data-note-visibility') === 'private' &&
                        Array.from(panel3.querySelectorAll('button')).some(b => b.textContent.trim() === 'Delete private note') && openCalls.length === 0 && highlighted() === 0,
                    { boxValue: box3 && box3.value, draft: ta3 && ta3.value, checked: checked3 && checked3.getAttribute('data-note-visibility'), opens: openCalls.length, highlighted: highlighted() });
                const closeX3 = doc.querySelector('[aria-label="Close notes"]');
                if (closeX3) closeX3.click();
                await waitFor(() => !doc.querySelector('[data-vvd-notes-panel]'));

                // ---- export from POL (built from data by polExportBuilderRef) ----
                const polCells = await captureExport(doc, win);
                rec('Excel export (POL): the exported cells carry the VVDs but never a notes badge (✂️ / 🔒)',
                    !!polCells && polCells.includes(V3) && !polCells.some(hasBadgeText),
                    { cells: polCells && polCells.length, hasV3: !!polCells && polCells.includes(V3), badgeCells: polCells && polCells.filter(hasBadgeText).slice(0, 5) });
            } finally {
                win.open = realOpen;
                polSetRenderAll(win, false);
            }

            // ---- a direct fallback is never undone by an older server copy ----
            if (refreshBtn) {
                await gotoTab(doc, 'Booking Flash');
                const rowsBefore = detailRows(doc).length;
                const directBefore = log.direct.live;
                feedMode.liveBusy = true;
                await refreshAndWait(2);
                const fellBack = log.direct.live === directBefore + 1;
                feedMode.olderThanDirect = true;
                parses = 0;
                const liveCallsBefore = fake.calls.filter(c => c.name === 'getDataFeed' && c.args[0].name === 'live').length;
                await refreshAndWait(2);
                const liveCall = fake.calls.filter(c => c.name === 'getDataFeed' && c.args[0].name === 'live')[liveCallsBefore];
                const liveReply = fake.replies.filter(r => r.name === 'getDataFeed' && r.out && r.out.name === 'live').slice(-1)[0];
                rec('Direct fallback: after a busy reply sends the tab to the Sheet directly, the next request carries notOlderThanMs, an `older` server copy is ignored (no parse, no new direct fetch, same rows)',
                    fellBack && !!liveCall && typeof liveCall.args[0].notOlderThanMs === 'number' && liveCall.args[0].notOlderThanMs >= 0 &&
                        !!liveReply && liveReply.out.older === true && parses === 0 && log.direct.live === directBefore + 1 && detailRows(doc).length === rowsBefore,
                    { fellBack, request: liveCall && liveCall.args[0], reply: liveReply && liveReply.out, parses, directFetches: log.direct.live - directBefore, rowsBefore, rowsAfter: detailRows(doc).length });
                feedMode.olderThanDirect = false;
            }
            win.XLSX.read = realRead;

            // ---- startup log ----
            win.__bfShowBootFailure('synthetic');
            await waitFor(() => { const el = doc.getElementById('bf-boot-reported'); return !!el && el.textContent !== ''; }, { timeout: 5000 });
            const startupCalls = fake.calls.filter(c => c.name === 'logClientStartupError');
            const payload = startupCalls[0] && startupCalls[0].args[0];
            rec('Startup log: the boot-failure box sends the reason and details to logClientStartupError and shows that they were sent',
                startupCalls.length === 1 && !!payload && payload.reason === 'synthetic' && Array.isArray(payload.errors) && payload.reactLoaded === true &&
                    typeof payload.userAgent === 'string' && typeof payload.page === 'string' && typeof payload.at === 'string' &&
                    doc.getElementById('bf-boot-reported').textContent === 'These details were sent to the report owner automatically.',
                { payload, reportedText: doc.getElementById('bf-boot-reported').textContent });
        };
        try {
            await serverScenario();
        } catch (err) {
            rec('Server scenario ran to the end without throwing', false, { error: String(err && err.stack || err) });
        } finally {
            server.cleanup();
            await clickTab('Booking Flash');
        }

        const recordedCount = allResults.length - startCount;
        rec(`Exactly ${EXPECTED_RECORD_COUNT} assertions were recorded for this suite (hardcoded tripwire against a future refactor silently dropping a check -- this suite installs every fake it depends on itself, so it has no legitimate reason to ever skip; see AGENTS.md's "Check the executed-check count, not the pass rate" section)`,
            recordedCount === EXPECTED_RECORD_COUNT, { recordedCount, expected: EXPECTED_RECORD_COUNT });
    })();

    // ============================================================
    // SUITE 19: Settings_Popover_Layout (added 2026-10-05) -- the status lines at the bottom of the
    // ⚙️ Settings popover must wrap inside it, whatever their text says. The popover container carries
    // `whitespace-nowrap` (so its button rows stay on one line) and the status lines -- the storage-probe
    // line, Cloud sync, Data (only once a data feed has been recorded) and Config Sheet, each a
    // `<div class="w-full text-[11px] leading-snug ...">` -- inherited it, so a long message ran past the
    // popover's right edge instead of wrapping. The first-run storage line is ~85 characters, the
    // origin-rotated warning embeds two full origins, and a Config Sheet warning embeds arbitrary Sheet
    // text; none of those is the text a given run happens to show, so this suite asserts on the ELEMENTS
    // (the same four divs whatever they say), in two ways:
    //   1. the lines as rendered right now: computed white-space is not nowrap/pre, the line's own text
    //      does not overflow its box (scrollWidth <= clientWidth), and neither its box nor its text
    //      reaches past the popover's right edge;
    //   2. a probe: a clone of each line (same classes, same parent, so the same inherited styles) given a
    //      string far longer than the popover is wide, with a 120-character unbroken token in it, must
    //      still fit and must actually wrap onto 2+ lines. This is what proves the fix covers ANY text,
    //      not just whichever message the run shows -- on a fresh browser that is the first-run line,
    //      but under another storage state or a config warning it would be another one.
    // WHY THE TEXT'S EXTENT IS MEASURED AS WELL AS THE BOX: a `w-full` div's own box is always exactly the
    // popover's content width, so `box.right <= popover.right` passes even while its nowrap text pours out
    // of the box. The text's extent comes from a Range over the element's contents.
    // WHY A CLONE AND NOT EDITING THE REAL LINE'S TEXT: React owns those nodes. The clone is inserted,
    // measured and removed in one synchronous block (no await in between), so no render can interleave,
    // and the real nodes are never touched.
    // POPOVER SCOPING (same lesson as Suite 9's popoverScope, 2026-09-16): the popover is found from its
    // own "Close settings" button, and "not mounted yet" means NULL, never a document-wide fallback --
    // a fallback would let this suite measure some unrelated div and pass for the wrong reason.
    // NOT VACUOUS: it fails loudly unless the three always-rendered lines (storage probe, Cloud sync,
    // Config Sheet) are all found; Data is measured when present. The record count is the same either
    // way (each check aggregates over whichever lines exist). No tripwire: unlike Suites 10/12/18 there
    // is no multi-scenario setup that can drop checks halfway -- every early return records a failing check.
    // ============================================================
    await (async function settingsPopoverLayoutSuite() {
        const SUITE = 'Settings_Popover_Layout';
        const trigger = document.querySelector('[data-settings-trigger]');
        if (!trigger) { record(SUITE, 'Setup: the ⚙️ Settings button ([data-settings-trigger]) found', false); return; }

        // The popover = the nearest positioned ancestor of its own "Close settings" button (resilient to
        // markup depth changes, unlike a fixed number of .parentElement hops). null when it is not open.
        const findPopover = () => {
            const closeBtn = document.querySelector('button[aria-label="Close settings"]');
            let el = closeBtn && closeBtn.parentElement;
            while (el && el !== document.body && !['fixed', 'absolute'].includes(getComputedStyle(el).position)) el = el.parentElement;
            return el && el !== document.body ? el : null;
        };
        // The status lines are the popover's direct `w-full ... leading-snug` divs. The storage-probe line's
        // text varies with the storage state, so it is the line that is none of the other three.
        const statusLines = (pop) => Array.from(pop.children).filter(c =>
            c.tagName === 'DIV' && c.classList.contains('w-full') && c.classList.contains('leading-snug'));
        const roleOf = (el) => {
            const t = el.textContent.trim();
            if (/^(⚠️\s*)?Cloud sync:/.test(t)) return 'cloud-sync';
            if (/^Data:/.test(t)) return 'data';
            if (/^Config Sheet:/.test(t)) return 'config-sheet';
            return 'storage-probe';
        };
        const ALWAYS = ['storage-probe', 'cloud-sync', 'config-sheet'];
        const noWrap = (el) => /^(nowrap|pre)$/.test(getComputedStyle(el).whiteSpace);
        const textRight = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right; };
        // Everything one line contributes to a check, in px (rounded for readable failure output).
        const measure = (el, role, popRight) => {
            const cs = getComputedStyle(el);
            const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.375;
            const box = el.getBoundingClientRect();
            return {
                role,
                whiteSpace: cs.whiteSpace,
                nowrap: noWrap(el) || Array.from(el.querySelectorAll('*')).some(noWrap),
                overflowPx: el.scrollWidth - el.clientWidth,
                boxRight: Math.round(box.right),
                textRight: Math.round(textRight(el)),
                popoverRight: Math.round(popRight),
                lines: Math.round(box.height / lineHeight),
                textStart: el.textContent.trim().slice(0, 48),
            };
        };
        const fits = (m) => m.overflowPx <= 1 && m.boxRight <= m.popoverRight + 1 && m.textRight <= m.popoverRight + 1;

        const wasOpen = !!findPopover();
        try {
            if (!wasOpen) {
                trigger.click();
                await waitFor(() => !!findPopover(), { timeout: 5000 });
            }
            const pop = findPopover();
            if (!pop) { record(SUITE, 'Setup: the Settings popover opens (found via its own "Close settings" button)', false); return; }
            record(SUITE, 'Setup: the Settings popover opens (found via its own "Close settings" button)', true);

            // Everything below is one synchronous block: nothing can re-render between collecting the lines
            // and measuring them, so the elements and numbers belong to the same commit.
            const popRight = pop.getBoundingClientRect().right;
            const lines = statusLines(pop).map(el => ({ el, role: roleOf(el) }));
            const found = lines.map(l => l.role);
            const missing = ALWAYS.filter(r => !found.includes(r));
            record(SUITE, 'Setup: the three always-rendered status lines (storage probe, Cloud sync, Config Sheet) are all found in the popover; Data is measured too when present',
                missing.length === 0 && lines.length >= ALWAYS.length, { found, missing, dataLinePresent: found.includes('data') });
            if (missing.length || lines.length < ALWAYS.length) return;

            const natural = lines.map(l => measure(l.el, l.role, popRight));
            const worst = (ms) => ms.map(m => ({ role: m.role, whiteSpace: m.whiteSpace, overflowPx: m.overflowPx, boxRight: m.boxRight, textRight: m.textRight, popoverRight: m.popoverRight, textStart: m.textStart }));

            record(SUITE, 'No status line is white-space: nowrap (the popover\'s own nowrap, there for its button rows, must not reach them)',
                natural.every(m => !m.nowrap), { offenders: worst(natural.filter(m => m.nowrap)) });
            record(SUITE, 'No status line\'s text overflows its own box (scrollWidth <= clientWidth)',
                natural.every(m => m.overflowPx <= 1), { offenders: worst(natural.filter(m => m.overflowPx > 1)) });
            record(SUITE, 'No status line, box or text, extends past the popover\'s right edge',
                natural.every(m => m.boxRight <= m.popoverRight + 1 && m.textRight <= m.popoverRight + 1),
                { offenders: worst(natural.filter(m => m.boxRight > m.popoverRight + 1 || m.textRight > m.popoverRight + 1)) });

            // The probe, for ANY text: 339 characters, spaces plus a closing 120-character unbroken token (an
            // origin, a URL or a config value looks like that), far longer than the 440px popover.
            const LONG = 'Probe: this status text is deliberately much longer than the Settings popover is wide, so it can only stay inside the popover by wrapping onto several lines, and it ends in one token with no break opportunities at all: ' + 'UNBROKEN'.repeat(15);
            const probed = lines.map(l => {
                const clone = l.el.cloneNode(false);
                clone.textContent = LONG;
                clone.setAttribute('data-bfrt-probe', '');
                l.el.after(clone);
                try { return measure(clone, l.role, popRight); } finally { clone.remove(); }
            });
            const unwrapped = probed.filter(m => m.nowrap || !fits(m) || m.lines < 2);
            record(SUITE, 'A ~340-character status string with a 120-character unbroken token wraps onto 2+ lines inside the popover for every status line (the fix covers any text, not just the one showing)',
                unwrapped.length === 0, { offenders: unwrapped.map(m => ({ role: m.role, whiteSpace: m.whiteSpace, lines: m.lines, overflowPx: m.overflowPx, textRight: m.textRight, popoverRight: m.popoverRight })) });
        } catch (err) {
            record(SUITE, 'The layout checks ran to the end without throwing', false, { error: String(err && err.stack || err) });
        } finally {
            // Leave the page as this suite found it (popover closed, unless it was already open).
            if (!wasOpen && findPopover()) {
                trigger.click();
                await waitFor(() => !findPopover(), { timeout: 5000 });
            }
        }
    })();

    const allPassed = allResults.every(r => r.pass);
    console.log(allPassed ? '\n✅ ALL TESTS PASSED' : '\n❌ SOME TESTS FAILED');
    return { results: allResults, allPassed };
}
window.runBookingFlashRegressionTests = runBookingFlashRegressionTests;
})();
// Top-level await works when pasted directly into a browser console; if
// running via an eval context that doesn't support it, wrap in an async
// IIFE instead: (async () => { const r = await runBookingFlashRegressionTests(); return r; })();
//
// This self-invocation is what makes "inject the file and read the result"
// work without automation ever calling runBookingFlashRegressionTests()
// itself (see the double-invocation guard above for why that matters). The
// result is stored on window.__bfrtLastResult once this run finishes, so
// automation can poll that (or listen for the "ALL TESTS PASSED"/"SOME
// TESTS FAILED" console line) instead of adding its own call. The .catch
// below is required, not defensive boilerplate: without it, a thrown error
// inside a run leaves window.__bfrtLastResult stuck at null forever (only
// an easy-to-miss unhandled-rejection console entry), so automation
// polling for a non-null result hangs/times out with no way to tell "still
// running" from "crashed."
if (typeof window !== 'undefined') window.__bfrtLastResult = null;
runBookingFlashRegressionTests().then(
    r => { if (typeof window !== 'undefined') window.__bfrtLastResult = r; },
    err => {
        console.error('❌ runBookingFlashRegressionTests() crashed:', err);
        if (typeof window !== 'undefined') window.__bfrtLastResult = { crashed: true, error: String(err && err.message || err) };
    }
);

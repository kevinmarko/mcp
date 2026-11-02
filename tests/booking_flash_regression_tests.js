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
        expand(bodyTrs).forEach(cells => {
            const group = cells[idx.group], week = cells[idx.week], vvd = cells[idx.vvd];
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
                const foot = Array.from(panel.querySelectorAll('tfoot[data-analysis-footer] td')).map(td => parseNum(td.textContent));
                drill = { card: target.name, panelFor: panel.getAttribute('data-analysis-drilldown'), realRows, cardSailings: target.sailings,
                    footer: { cap: foot[1], laden: foot[2], peak: foot[3] }, cardValues: { cap: target.cap, laden: target.laden, peak: target.peak } };
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
                if (target && ci !== -1) {
                    target.el.click();
                    await waitFor(() => document.querySelector('[data-analysis-drilldown] tr[data-analysis-port-rows]'), { timeout: 3000 });
                    const panel = document.querySelector('[data-analysis-drilldown]');
                    if (panel) {
                        const blocks = Array.from(panel.querySelectorAll('tr[data-analysis-port-rows]'));
                        const fails = [];
                        blocks.forEach(tr => {
                            const vvd = tr.getAttribute('data-analysis-port-rows');
                            const t = tr.querySelector('table');
                            const h = Array.from(t.tHead.rows[0].cells).map(c => c.textContent.trim());
                            const pc = h.indexOf('Port'), lc = h.indexOf('Current Laden');
                            const rows = Array.from(t.tBodies[0].rows).map(r => [r.cells[pc].textContent.trim().toUpperCase(), Math.round(parseNum(r.cells[lc].textContent) || 0)]);
                            const shown = rows.map(([pol, l]) => `${pol}=${l}`).sort();
                            const want = (polLegs[`${target.name}|${vvd}`] || []).slice().sort();
                            const total = parseNum(t.tFoot.rows[0].cells[lc].textContent);
                            const sum = rows.reduce((a, [, l]) => a + l, 0);
                            if (lc === -1 || JSON.stringify(shown) !== JSON.stringify(want) || Math.abs(total - sum) > 1) fails.push({ vvd, shown, from_pol_table: want, total, sum });
                        });
                        sub = { card: target.name, vesselsWithPorts: blocks.length, fails: fails.slice(0, 3), failCount: fails.length };
                        target.el.click();
                        await waitFor(() => !document.querySelector('[data-analysis-drilldown]'), { timeout: 3000 });
                    }
                }
                record(SUITE, 'Analyze vessel list "By port": each vessel\'s port sub-rows are its legs in the POL table (same POLs and Current Laden) and its Vessel total Current Laden is their sum',
                    !!sub && sub.vesselsWithPorts > 0 && sub.failCount === 0, sub || { problem: 'no card, no Current Laden (TEU) column, or the port sub-rows never appeared', target: !!target, currentLadenCol: ci });
                byWeekBtn.click();
                await waitFor(() => !Array.from(document.querySelectorAll('div.border.border-gray-200.rounded-md.p-3.relative')).some(c => c.textContent.includes('(by port)')), { timeout: 3000 });
                const back = peaksNow();
                const changed = Object.keys(weekPeaks).filter(k => back[k] !== weekPeaks[k]);
                record(SUITE, 'Analyze "By week" restores every card\'s original Avg Peak Utilization after "By port"',
                    Object.keys(weekPeaks).length > 0 && changed.length === 0, { cards: Object.keys(weekPeaks).length, changed: changed.slice(0, 5) });
            }
        }
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

        await crossCheckAnalysisAgainstTable(SUITE, 'lane');
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
    // SUITE 13: VVD_Gmail_Debounce (added 2026-09-26) -- regression coverage for the
    // "double-click a VVD cell opens two Gmail tabs" bug fixed the same day. Every VVD
    // cell in this file is rendered by the shared `vvdCell(vvd)` helper (search
    // `const vvdCell = (vvd) =>` in the app, ~line 955), whose <span role="button"
    // tabIndex={0}> calls window.open() to search Gmail for that VVD on click/Enter/
    // Space. A real double-click fires two ordinary 'click' events on the same span in
    // quick succession -- without a guard, both call window.open() and leave the user
    // with two duplicate Gmail tabs. The fix is a plain module-level debounce
    // (`let lastVvdGmailOpen = { vvd: null, at: 0 }`, ~line 929, deliberately NOT React
    // state -- see its own comment for why): a second click on the SAME vvd within
    // 800ms of the first is a no-op; the same VVD clicked again after 800ms, or a
    // DIFFERENT VVD clicked at any time, opens normally.
    //
    // This suite runs on the MAIN page (not an isolated iframe, unlike Suites 10-12) --
    // the bug and its fix live entirely in module-scope state + window.open, nothing to
    // do with localStorage/server prefs, so there is no reason to boot a fresh instance.
    // No EXPECTED_RECORD_COUNT tripwire, matching Suites 1-9's convention rather than
    // Suites 10-12's isolated-iframe one.
    //
    // WHY POL BOOKING FLASH, NOT DETAIL: POL's row renderer (polDataRowElement) tags its
    // VVD <td> with `data-autofit-col="vvd"` (used elsewhere in this file for auto-fit
    // overflow checks -- see Suite 3 above); Detail's own VVD <td> carries no such
    // attribute. That makes a real, currently-rendered VVD cell trivial and unambiguous
    // to locate here: `td[data-autofit-col="vvd"] span[role="button"]` can only ever
    // match a REAL vvdCell span (a VMS/blank VVD renders as plain text, no span at all --
    // see vvdCell's own early-return), so no separate "is this a real VVD" filtering is
    // needed.
    //
    // WINDOW.OPEN STUBBING: same window/global `window` the app itself reads and writes
    // (this file runs injected into the live page, not a separate context), so replacing
    // `window.open` here really does intercept vvdCell's own call. No suite in this file
    // has stubbed window.open before; Suite 11's XLSX.writeFile monkey-patch is the
    // existing precedent for "temporarily replace a global, always restore it in a
    // finally".
    // ============================================================
    await (async function vvdGmailDebounceSuite() {
        const SUITE = 'VVD_Gmail_Debounce';
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
        const realDateNow = Date.now;
        const openCalls = [];
        window.open = (...args) => { openCalls.push(args); return null; };
        try {
            // Two rapid clicks, well within the 800ms debounce window -- exactly what a real
            // double-click delivers to the DOM (two ordinary 'click' events on the same span).
            // .click() dispatches only 'click', matching the app's own vvdCell onClick handler
            // (not onMouseDown/onDblClick), so this is the correct simulation, not a shortcut.
            vvdSpan.click();
            vvdSpan.click();
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

            // A third click, simulated well past the 800ms window via Date.now (deterministic,
            // vs. a real setTimeout wait -- the debounce keys off Date.now() alone, not a real
            // timer). Patched and restored synchronously around a single .click() call -- the
            // handler reads Date.now() and calls window.open() before this function ever
            // yields, so no other code on the page observes the patched clock.
            Date.now = () => realDateNow() + 900;
            vvdSpan.click();
            Date.now = realDateNow;
            record(SUITE, 'A click after the 800ms debounce window elapses opens Gmail again (the debounce does not permanently disable the cell)',
                openCalls.length === 2, { openCallCount: openCalls.length });
        } finally {
            window.open = realOpen;
            Date.now = realDateNow;
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
        const GAP = 4, TOL = 10;
        const nearTrigger = (panelRect, triggerRect) =>
            Math.abs(panelRect.left - triggerRect.left) <= TOL &&
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

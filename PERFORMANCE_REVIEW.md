# Performance & Correctness Review — Booking Flash Report NA v1.66

**Date:** 2026-09-10 · **Target:** `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` (6,453 lines)
**Baseline data scale:** 8,769 rows × 98 columns (`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`)

> **Row count — read before quoting a number.** `wc -l` reports 27,312 lines for that file, but the
> true row count is **8,769**. Some quoted cells contain embedded newlines, so a line is not a row.
> Always count with an RFC4180 parser (`python3 -c "import csv; ..."`), never `wc -l`. An earlier
> draft of this document used the inflated figure throughout; the findings below were re-derived
> against the real count.

This document is the plan of record for the performance pass. It explains *why* each item is
slow, not just what to change — the "how it works" notes are deliberate, so the reasoning
survives after the diff lands.

---

## Baseline: what currently passes

Run before any changes, on the live 1.66 file:

| Check | Result |
|---|---|
| Syntax check (Babel + `node --check`) | ✅ PASS |
| Alias-landmine sweep vs `MAIN_UPLOAD` xlsx (97 headers, 75 fields) | ✅ No landmines |
| Alias-landmine sweep vs historical CSV (98 headers, 75 fields) | ✅ No landmines |
| Date timezone safety (8 `XLSX.read`, 5 CSV-text, real TZ sweep) | ✅ PASS |
| Live regression suite (`tests/booking_flash_regression_tests.js`) | ⏳ needs browser run |

So there is **no known static-check failure to fix**. The correctness work in this pass is
(a) the documentation bug in W4 below, which causes *false passes*, and (b) whatever the live
regression suite surfaces.

---

## The core structural problem

`FlashReportDashboard()` is a single ~4,500-line component holding **70 `useState` hooks**, and
the file contains **zero `React.memo` and zero `useCallback`**. In React, every `setState`
re-runs the whole component body and re-creates every child element. With no memo boundaries,
that means: *one keystroke in a header filter, or one pixel of a modal drag, re-runs every
`useMemo` whose deps changed and re-renders the entire un-virtualized table.*

Almost every symptom below is a consequence of that one fact plus per-row work that should
have been hoisted out of a loop.

---

## Findings, ranked by impact

### Tier 1 — Load / parse (the freeze after picking a file)

**F1. `getVal()` is rebuilt per row and re-normalizes every alias per row.** — `:2388`

```js
const formattedData = rawData.map((row, index) => {
    const cleanRow = {};
    rowKeys.forEach(k => {                          // ~98 keys
        const cleanK = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
        cleanRow[cleanK] = row[k];
    });
    const getVal = (aliases) => {                   // re-allocated every row
        for (let alias of aliases) {
            const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');   // per row!
            ...
        }
        for (let alias of aliases) {                // substring fallback
            const matchingKey = cleanRowKeys.find(k => k.includes(cleanAlias)); // O(98)
        }
    };
    return { trade: getVal([...]), subTrade: getVal([...]), /* ~84 fields */ };
});
```

The header names are **identical on every row**, yet all of this normalization is redone
8,769 times. Per row: ~98 regex replaces for `cleanRow`, plus ~84 `getVal` calls × 2–4
aliases × 1 regex each (~200 more), plus O(98) scans in the fallback pass. That is on the
order of **2.6 million regex allocations and millions of string comparisons per load**.

*The fix, and the subtlety that makes it non-trivial:* you cannot simply resolve
`alias → column` once, because the current code's first pass skips a column when **that row's
value is empty** (`!== ''`) and falls through to the next alias. Resolution is therefore
row-dependent whenever a cell is blank. The correct optimization is to precompute, once from
the header, an **ordered candidate list of real column keys per field** (exact matches first,
then substring-fallback matches, preserving current alias order and the `length < 3` guard),
then per row walk that short list and take the first non-empty value. That is semantically
identical — including the Class E landmine behaviour the alias checker guards — with zero
regex inside the loop.

**F2. `localeCompare` in sort comparators — 13 sites.** — e.g. `:4281`

`String.prototype.localeCompare` constructs collation state on each call and is roughly 10–100×
slower than a reused `Intl.Collator`. `processedData`'s comparator can call it up to 5 times per
comparison, over ~8.8k rows (≈115k comparisons). Hoisting one module-level
`const collator = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'})` and calling
`collator.compare(a,b)` is a drop-in, behaviour-preserving swap — but note `numeric:true` changes
ordering of digit-containing strings, so it must be introduced **without** that option unless a
diff of sorted output confirms it is safe.

### Tier 2 — Interaction (the "not snappy" feel)

**F3. The main filter memo redoes constant work per row, and re-runs on tab switch.** — `:3305`

```js
selectedAnalysts.some(analyst => row.pic.toLowerCase().includes(analyst.toLowerCase()))
//                                                              ^ recomputed per row
selectedSubTrades.includes(row.subTrade)   // O(k) array scan per row, should be a Set
const searchVal = filterValue.toLowerCase().trim();          // per row, per active filter
const cleanedSearchVal = searchVal.replace(/[,%()]/g, '');   // per row, per active filter
```

All the right-hand sides are loop-invariant. Hoisting them above `rawRows.forEach` and turning
the `selected*` arrays into `Set`s is pure win, no behaviour change.

Separately, `activeTab` sits in the dependency array. It is used for exactly two narrow
branches (`matchYard` and which status field to read), yet its presence means **every tab switch
re-filters all 8,769 rows** and rebuilds eight `Set`s. Splitting the tab-invariant work out, or
keying the two branches differently, removes the tab-switch stall.

**F4. Header-filter typing is not debounced.** — `:2327`

`setHeaderFilters` fires on every keystroke → the F3 memo re-runs over 8,769 rows → the
un-virtualized table re-renders. Every character typed. Needs a debounced/deferred value
(`useDeferredValue` is ideal here and is available in React 18) so the input stays responsive
while the expensive recompute trails it.

**F5. Three unthrottled `mousemove` → `setState` handlers.** — `:1149`, `:1966`, `:2026`

```js
const onMove = (moveEvent) => { setPos({ x: ..., y: ... }); };
window.addEventListener('mousemove', onMove);
```

Mouse move events fire at 60–1000 Hz. Each one calls `setState` on the **root** component,
re-rendering the entire 4,500-line tree and the whole table. This is the most viscerally
janky thing in the app. Fix: coalesce into `requestAnimationFrame` (store the latest event in a
ref, schedule one state write per frame) and/or drive the drag through a direct style write on a
ref, committing to state only on `mouseup`.

### Tier 3 — Render

**F6. No memo boundaries at all.** Zero `React.memo`, zero `useCallback`. Leaf components
(`SlicerBtn` `:545`, `SlicerClearBtn` `:588`, `PivotTableViewer` `:1122`) and the table body
re-render on every unrelated state change. Wrapping stable leaves in `React.memo` and giving
them `useCallback`'d handlers converts a full-tree re-render into a handful of node updates.

**F7. The detail table is not virtualized — CORRECTED, see below.** `processedData.map(...)`
emits every row with ~40 `<td>` each, every className built by template-literal concatenation
per cell, and fresh closures (`getBg`, `vmsBlank`) allocated per row.

> **Correction (W6, 2026-09-10, re-derived against the real exports):** the "well over 100k DOM
> nodes" premise above is wrong for this table and the virtualization prescription it implies is
> the wrong fix. `processedData` is NOT the raw per-row data — it's `tableData` (an aggregation
> of `filteredRawRows` by trade-subTrade-lane-saleWeek-vvd-vessel), sorted, with rowSpan/blank-row
> bookkeeping layered on top. Measured against this repo's own sample exports:
> `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` (964 raw rows) aggregates to **434** Detail
> rows (~17k `<td>` at ~40 cols/row); the 9-day historical CSV (8,769 raw rows) aggregates to
> **463**. Windowing pays off in the 5k-100k+ row range; at ~450 rows its own overhead (scroll
> listener, position math, a re-render per scroll frame) is net-negative, and it would actively
> break three things this table depends on: (1) the `rowSpan` Trade/Sub-Trade/Lane grouping —
> a window of only the visible rows makes a span incoherent unless spans are recomputed
> per-window, which changes the rendered output; (2) the auto-fit `useLayoutEffect` (measures
> every `[data-autofit-col]` cell) — column widths would shift as the user scrolls past
> never-measured rows; (3) `tests/booking_flash_regression_tests.js`, which reads the live DOM
> to assert structural invariants — an unmounted row silently turns those checks into no-ops.
>
> The REAL, measured symptom (W3's DRAG benchmark: a column-resize drag re-rendered every one of
> those ~450 rows on every animation frame, because there was no memo boundary between the
> header — the only part a column-width change actually affects, since widths live on
> `<th style>` and `<td>` cells never set their own width — and the body) is re-render COST, not
> DOM node count. Fixed by wrapping each row in `React.memo` (`DetailTableRow`/`PolTableRow` in
> the app file, right before `FlashReportDashboard`) instead of windowing, plus hoisting the
> per-row `getBg`/`vmsBlank`/`rowStatusInfo`/`numVal` closures to module scope (they're pure
> functions of their row argument, never needed to live inside the render body). Measured with
> `tests/perf_benchmark.js`'s existing DRAG scenario (targets this exact table by default):
> median wall-clock dropped from 6168ms to 4987ms (n=10, 12.7% spread — above this harness's own
> ~15-20% sandbox noise floor) with an unchanged 40 React commits (commit count reflects
> mousemove-driven rAF flushes, not row-render cost — see F5). Visual output (grouping, blank
> rows, column widths, VMS/AP-ONLY/AP-FROZEN colors) confirmed pixel-identical before/after via
> screenshot diff. POL Booking Flash shares the same "no memo boundary" defect on its own column
> resizer (same `makeColResizer` factory) and, unlike Detail, its sort/blank-row/span pipeline
> ran inline in the render body on every render (not even a `useMemo`) — both are fixed the same
> way (`PolTableRow` + a new `polSpannedRows` useMemo).
>
> Windowing was not implemented. This is not a partial fix deferred for later — at the row
> counts this app actually renders, windowing is the wrong tool, and reaching for it anyway
> would have traded a real, working, behavior-preserving fix for a correctness risk (grouping,
> auto-fit, and regression-suite coverage all depend on every row staying mounted) in exchange
> for no measurable benefit. If a future data source pushes the Detail table's aggregated row
> count into the 5k+ range, re-open this finding — the memo boundary this fix adds is still a
> prerequisite either way, and would not need to be undone.

**F8. `Math.max(...)` recomputed inside `.map()` — genuine O(n²).** — `:5194`, `:5217`

```js
{serviceLaneAnalysis.weeklySeries.map((wData) => {
    const globalMax = Math.max(...serviceLaneAnalysis.weeklySeries.map(w => ...)); // per row!
```

`globalMax` is loop-invariant. Hoist above the `.map()`. (Also note the spread into `Math.max`
throws `RangeError` on very large arrays — bounded here, but the hoist fixes both.)

### Things I checked that are **not** bugs — do not "fix" these

- **The "Booking Summary" pivot (`activeTab === 'booking_flash'`) was not dead code — and has
  since been removed anyway, on purpose.** It had no tab button, so it looked unreachable, and
  **three separate agents flagged it as dead code during the 2026-09-10 audit, all three
  wrongly** — it was deliberate, and documented in both `README.md` and `HANDOFF.md`. The
  standing instruction here was "do not delete it; if it should genuinely go, that is Kevin's
  call, not a cleanup." **On 2026-09-15 Kevin made that call explicitly and it was removed.**
  The distinction still matters and is why this entry stays: those three agents were wrong at
  the time, because "no caller in the file" was never sufficient evidence on its own. What
  changed was an owner decision, not a discovery. Note the removal also left the engine's
  tree-mode renderer (`flatten()`/`collapsedNodes`/`toggleCollapse`) with no caller, since that
  tab was the app's only non-`tabular` config — that machinery was left in place deliberately;
  see the note above `renderRows` in the app file before "cleaning up" that too.


- The `rowSpan` span loops at `:4313` look O(n²) but every inner loop `break`s on first
  mismatch, so they are O(n) amortized. Leave them.
- The auto-fit `useLayoutEffect` at `:3391` correctly batches all style **writes**, then all
  **reads**, then all writes — that is the right anti-layout-thrash pattern already.
- CDN `<script>` tags and `xlsx-0.20.3` are pinned deliberately (security bump, 2026-09-10). Do
  not change versions or URLs.

---

## Workstreams (4 parallel agents, isolated git worktrees)

Each agent works in its own worktree off the same base commit and touches a **disjoint region**
of the single HTML file, so the diffs integrate cleanly.

| # | Workstream | Findings | Regions (v1.66 line numbers) |
|---|---|---|---|
| **W1** | Parse pipeline | F1, F2 | `2340–2600`, comparator sites |
| **W2** | Filter pipeline & input responsiveness | F3, F4 | `2320–2340`, `3300–3400` |
| **W3** | Interaction churn & memo boundaries | F5, F6, F8 | `536–600`, `1122–1180`, `1940–2040`, `5190–5230` |
| **W4** | Perf harness, live regression run, doc-drift bug | see below | `tests/`, `README.md`, `AGENTS.md`, table body |

### W4's correctness bug (real, and it causes false passes)

`AGENTS.md:38` — the **required** syntax-check command — hardcodes
`booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html`, a frozen snapshot from an older naming
scheme. Anyone following the documented procedure syntax-checks the **wrong file** and gets a
green result that says nothing about their change. `README.md:35` and `README.md:56` have the
same stale pointer. AGENTS.md line 19 explicitly warns this exact line went stale once before;
it is stale again. Fix: derive the filename (highest version in repo root) rather than hardcode.

---

## Non-negotiable constraints for every agent

1. **No build step. No new runtime dependencies.** The app stays one self-contained HTML file
   loading React/Babel/Tailwind/SheetJS from the pinned CDN URLs. Dev-only tooling in
   `tests/` may add devDependencies.
2. **Do not change CDN URLs or the pinned `xlsx` version** (deliberate security state).
3. **Behaviour-preserving only.** These are performance refactors. If a change alters a rendered
   number, a sort order, a colour, or a filter result, it is a bug — not an improvement.
4. **Run the AGENTS.md checklist** after every change: syntax check (against the *live* file),
   alias-landmine sweep if a `getVal()` call is touched, timezone check if an `XLSX.read` is
   touched, live regression suite before declaring done.
5. **Measure, don't assert.** Report before/after numbers from W4's harness. "Should be faster"
   is not a result.

---

## Integration note — the stale-worktree incident (2026-09-10)

All four agent worktrees were created from `4fd6545`, **53 commits behind** the target branch
(`13c5ee1` on `claude/pensive-noether-szxhhw`) — a drift of **+1,614/−108 lines in the app file**,
plus changes to `AGENTS.md`, `README.md`, `package.json`, the regression suite (+403 lines), and
`tests/check_date_timezone_safety.js`, which did not exist at all on that base.

This produced a concrete near-miss worth recording, because it is the exact failure mode this
repo is most vulnerable to (no CI, one enormous file, a change that *looks* right in the diff):

> W1's diff cleanly rewrote two sort comparators to use `Intl.Collator` — and in doing so
> **silently dropped the `compareEtd` step** that HEAD had added in commit `e10375d`
> ("Sort POL/Booking Flash rows by Sale Week then ETD, not alphabetically"). On the stale base
> that step did not exist, so nothing in the rewrite looked wrong. A `-X theirs` merge, or a
> reviewer skimming a plausible-looking comparator, would have reverted a real bug fix.

**Where the stale base actually came from** (found while verifying the final merge): the local
`main` / `origin/main` refs in this session's checkout were themselves pinned at `4fd6545` —
53 commits behind the real `origin/main` (`15639e0`) — because they had not been re-fetched
since the container was created. The agent worktrees inherited that stale ref as their base. A
`git fetch origin main` resolved it, and confirmed the real `origin/main` is a clean ancestor of
this branch with nothing reverted. So the trigger was a stale remote-tracking ref, not a bad
branch choice — which makes it easy to hit again and worth the explicit check below.

Takeaways for anyone running a fan-out on this repo:

1. **`git fetch` before spawning anything, then verify the base commit of every agent worktree
   before trusting its diff.** `git -C <worktree> merge-base --is-ancestor <target> HEAD` — one
   command, catches this class entirely.
2. **Auto-merge succeeding is not evidence of correctness.** Only the two comparator hunks
   conflicted; everything else merged silently. The conflicts were the lucky part.
3. **Line numbers in a task brief are a liability across bases.** Brief agents with symbol names
   and code excerpts, and treat line numbers as hints to be re-derived.

## Correction log

- **"No real label contains a hyphen" was wrong.** When the pivot `nodeId` collision was first
  reported (ids built as `` `${parentId}-${node.label}` `` with no escaping), it was assessed as
  latent on the basis that no trade/sub-trade/lane code contains a `-`. That held for
  trade/subTrade/lane/saleWeek/VVD — but **not** for vessel names: `X-PRESS ANTLIA` appears in
  both real exports, and `vessel` is usable as a pivot `rowField`. So the bug was materially
  more reachable than the original assessment implied. Found by W14 checking *every* field that
  can become a node label rather than only the ones named in its brief. Ids are now keyed on
  `JSON.stringify(path)`.


- **Row count.** An earlier draft of this document cited 27,311 rows for the historical export,
  taken from `wc -l`. The true count is **8,769** (RFC4180); the file contains quoted cells with
  embedded newlines. The per-load regex estimate in F1 was revised from ~8M to ~2.6M accordingly.
  The finding itself held up under measurement — W1 recorded a ~3.8× parse speedup on the real
  file — but the scale figure was wrong and is corrected throughout.

- **F7 (detail table virtualization).** The original finding assumed `processedData.map(...)`
  renders raw per-row data at "well over 100k DOM nodes" and prescribed windowing. Wrong: it
  renders the aggregated `tableData` (~434-463 rows against this repo's real exports), and at
  that scale windowing is net-negative and would break rowSpan grouping, the auto-fit pass, and
  the regression suite's DOM-reading assertions. See F7's own corrected entry above (W6,
  2026-09-10) for the measured numbers and the memoization fix applied instead.

- **`XLSX.read` call count.** The Baseline table above said "7 `XLSX.read`". Re-running
  `node tests/check_date_timezone_safety.js` (2026-09-16) reports **8 total, 5 of them
  CSV-text** against the current app file. The CSV-text count (5) was already correct; only the
  total was stale. Since the app file is under active development, re-run the script rather than
  trusting either number at a glance.

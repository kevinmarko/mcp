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
  **Still true, and still not the whole story — see F9 in the correction log (2026-09-18).**
  Batching was never the problem; the pass measuring *every* cell to produce ~23 widths was.
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

- **F9 — the POL field-toggle freeze (found and fixed 2026-09-18).** This review never covered
  it, because the review's interaction tier was scoped to load, filtering and drag. Clicking a
  single field-visibility toggle on **POL Booking Flash** blocked the main thread for up to
  **9.1 seconds**. Two things are worth recording, because both of my first two hypotheses were
  wrong and measurement is the only reason the fix is the right one:

  1. **It was not the auto-fit pass.** A CDP timeline trace of one toggle showed 16.9s inside a
     single `EventDispatch` with only ~1.2s of `UpdateLayoutTree` + `Layout` + `Paint` combined.
     A CPU profile then put **16,866ms of self time in native `removeChild`**, against <4ms in
     React's own render functions and 358ms in `getBoundingClientRect`.
  2. **It was one-directional.** Profiling the reveal click and the hide click separately: 56ms
     in `removeChild` to reveal six columns, 16,866ms to hide them. React applies a column change
     by patching the live table, calling `tr.removeChild(td)` ~5,800 times on a `<table>` that is
     in the document; adding cells does not have that shape, because React builds new subtrees
     detached and inserts them. Every toggle on the tab showed the same asymmetry.

  Fix: a `key` on POL's `<tbody>` derived from which columns are visible (`polColumnSignature`),
  so a column-set change deletes the old body with **one** `removeChild` and inserts a
  freshly-built one, instead of ~5,800 live-table removals. Separately, the auto-fit pass now
  measures only the columns that do not already have a width, which made it cheap enough to
  finally track all twelve POL toggles rather than five.

  Measured with the new `tests/perf_toggle_benchmark.js`: worst single toggle **9,116ms →
  150ms**, sum over all toggles **31,264ms → 2,589ms**. Column widths verified byte-identical
  across all 48 pre-existing columns.

  **A trap worth naming:** in a combined run the Booking Flash tab's *pre-change* numbers looked
  ~10× worse than they really were (worst 273.6ms) purely because that tab was measured
  immediately after 31 seconds of pathological POL DOM churn. Measured on its own it was 21.3ms
  before and 26.9ms after — that tab was never slow and was not changed. Benchmark one tab at a
  time before crediting a fix.

---

## Pass 2 (2026-09-20) — measured on Kevin's Mac, v2.0

Kevin: "how can we speed up our code and the app." Pain reported in (a) loading a data file
and (b) clicking around; worst tabs POL Booking Flash and Detail; behaviour-preserving only.

**First, a correction to this document's own framing.** Every number above was taken on a
4-CPU Linux sandbox against v1.66. Re-measured on Kevin's own machine against v2.0, the app is
far faster than those figures suggest — LOAD total median **1,031 ms**, not 5,765 ms. The F1–F9
fixes did land and did work. Do not quote the v1.66 table as a current baseline.

### What shipped

| # | Change | Measured |
|---|---|---|
| 1 | Dead `sectorRows` memo deleted | one full-dataset pass removed per filter change |
| 2 | `getVal` alias arrays hoisted out of the row loop | `mapMs` 730 → 618 ms (−15.3%) |
| 3 | F3's hoisting applied to `compareData`'s duplicate predicate | not separately timed; Compare-only path |
| 4 | `resize`/`ResizeObserver` rAF-coalesced | forced layout per frame, not per event |
| 5 | Slicer selections deferred (`useDeferredValue`) | POL click→first-commit 469 → 142 ms |

On #2, the before/after `mapMs` distributions do not overlap (n=15 each, P(after<before) =
1.000), while `xlsxReadMs` — untouched — stays statistically identical (P = 0.516). That
control is what rules out ambient machine drift; use the same trick for any future LOAD claim.

On #5, the medians understate it. Pre-change click→first-commit on POL was **bimodal** — 3772,
454, 464, 3743, 469, 455, 461, 469 — exactly the shape AGENTS.md warns about. After: 86, 62,
69, 69, 174, 146, 142, 142. The worst deferred click beats the best pre-change one and the slow
mode is gone. The cost is that the table takes ~55% longer to fully settle (497 → 769 ms),
which is the approved "button leads the table by a beat" tradeoff.

### F10 — the derived-data memos are NOT the POL bottleneck. Measured and declined.

The obvious next move was to stop `tableData`/`processedData`/`polSpannedRows`/`past4WeekRows`/
`sectorDataMapped` recomputing for every tab on every filter change — five full passes over up
to 9,232 rows, most of it for tabs that were not on screen. It was built (ref cache keyed on
`filteredRawRows` identity, each memo gated on the exact condition its consumers are read
under), verified byte-identical across 12 DOM snapshots covering four tabs, a slicer filter, a
tab round-trip and a filter-changed-while-away trap, plus a separate Report Card cross-tab
check. Then measured, slicer click, median of 6:

| tab | settled before | settled after |
|---|---|---|
| Trade Summary | 134 ms | 111 ms |
| Sector Summary | 79 ms | 50 ms |
| Detail | 86 ms | 71 ms |
| **POL Booking Flash** | **3,774 ms** | **3,730 ms** |

So the whole derivation chain is worth ~20 ms. **POL's ~3.7 s is the render of 9,232 rows ×
~21 cells, not the memos that feed it.** Reverted: a latent-bug-shaped ref cache in four memos
is not worth 20 ms, and AGENTS.md:425-432 already records the precedent for reverting a ~7%
change that sat inside the noise.

Two things worth keeping from it:
- The gating condition for `tableData` is `activeTab === 'detail' || reportCardOpen`, not just
  the tab. The Report Card is a top-level sibling gated only on `reportCardOpen` and
  `reportCardRows` re-reads `activeTab` live, so it can be showing Detail's rows from another
  tab. Anyone re-attempting this needs that term.
- The version that was reverted had a real bug worth not repeating: the cache key checked only
  `filteredRawRows`, but `sectorDataMapped` also depends on `sectorSourceRows` (independent
  state, filled by its own CSV fetch). A fetch completing while off the Sector tab would have
  left that tab showing seed data. A gated memo's cache key must cover **every** dependency,
  not just the obvious one.

**If POL is to get materially faster, the row count is the only remaining lever**, and that is
the virtualization question F7 answers for Detail but explicitly does not answer for POL (Detail
aggregates 8,769 rows to ~463; POL does not aggregate at all). That is a scope decision, not a
refactor.

### A harness trap that cost real time here

The DOM-equivalence test above initially reported six differing snapshots, which looked exactly
like a stale-cache regression. It was not: the test did not pin the three live CSV sources the
way `tests/ci_regression_runner.js` does, so the app's own auto-refresh swapped the dataset
mid-run and the two builds were compared against different data. The tell was that the
differing snapshots showed a shifted sale-week window (W29 vs W32), not shuffled values. **Any
ad-hoc Playwright comparison on this app must pin those three URLs**, or it is comparing noise.

Separately, `tests/perf_benchmark.js`'s DRAG metric was throwing "is the detail table rendered?"
about a table that was rendered fine — it waited for `attached` and read `boundingBox()`
immediately, which returns null for a frame or two while a trailing render settles. Fixed in its
own commit. Note also that its trial flags only parse as `--load-trials=N`; the space-separated
form was silently ignored and you got the defaults — that is now a hard error (see pass 2b).

---

## Pass 2b (2026-09-21) — closing the harness gap that hid all of pass 2

Everything above was found and fixed *in spite of* the benchmark, not because of it. Worth
stating plainly, because it is the reusable lesson: **every metric in `tests/perf_benchmark.js`
ran on whatever tab the app opens on** (`detail`), with no way to point it anywhere else. POL
Booking Flash — the tab reported as worst, and the one where a slicer click was freezing for up
to 3.8 s — had no coverage at all. The same click measured a healthy ~70 ms on Detail. The
harness was reporting a fast app for the exact interaction being complained about.

That gap also meant the pass-2 slicer deferral shipped with **no regression guard**: revert it
and every check in this repo still passes green.

### What changed in the harness

| Change | Why |
|---|---|
| `--tab=<key>` | Runs metrics 2, 2b and 3 on any tab. LOAD deliberately still always measures the app's default tab, so its numbers stay comparable across `--tab` runs. |
| `resolveAppHtml()` instead of `findCurrentAppHtml()` | This harness was the only one ignoring `BF_APP_HTML`, so it could never benchmark `dist/index.html` — the artifact Apps Script actually serves. |
| `firstCommitMs` + `settledMs` instead of one `elapsedMs` | `useDeferredValue` splits these apart on purpose. Reporting only settle reads a successful deferral as a regression; reporting only first-commit hides its cost. |
| `--settle-quiet=N` (default **5000 ms**) | See below — this one nearly produced a false result. |
| Unrecognized args are a hard error | `--load-trials 15` (space form) used to be silently discarded, so the run used defaults while printing what looked like a 15-trial result. |

Metrics whose control is not rendered on the chosen tab now **skip with a printed reason**
instead of throwing, so `--tab=` stays usable on tabs that do not render every control.

### The quiet window had to be measured, not guessed

The natural way to detect "the interaction has finished" is to wait for a gap with no React
commits. The first attempt used 400 ms, which looks generously long. It is not. Measured commit
offsets after one slicer click on POL, in ms after the click:

```
[57, 3744, 3772]   [67, 3735, 3793]   [77, 3756, 3794]
```

**The deferred render lands ~3.3 seconds after the first commit, with dead silence in between** —
that gap *is* the deferral working. A 400 ms window returns at ~460 ms and reports "settled in
395 ms" for an interaction still working 3.3 s later, and lets one trial's deferred work land
inside the next trial's measurement window. If you ever shorten `SETTLE_QUIET_MS`, re-run the
commit-offset probe on POL and prove the gap closed first.

### POL baseline, recorded on Kevin's Mac against v2.0 at this branch's HEAD

Historical CSV, 8,769 rows. Detail aggregates it to **536 rows / 9,208 cells**; POL does not
aggregate and renders **9,232 rows / 193,417 cells** — a 21× difference in DOM, and the reason
the two tabs behave nothing alike. Both columns are the same app, same data, same click:

| Metric | Detail firstCommit / settled | POL firstCommit / settled |
|---|---|---|
| Header-filter keystroke | 8 ms / 156 ms | 145 ms / 1,213 ms |
| Slicer click ("AW") | **33 ms / 89 ms** | **76 ms / 832 ms** |
| Column-resize drag (40 moves) | 1,002 ms total | **14,333 ms total** |

That Detail column is what this harness reported as the app's performance for its entire
existence. It is not wrong — it is just not the tab anyone was complaining about.

**Quote `firstCommit` across sessions. Do NOT quote `settled`.** Merging `main` into this branch
appeared to move POL's slicer settle from 832 ms to ~4,900 ms, which looked exactly like a
regression introduced by the merge. It was not. An A/B/A/B — the pre-merge and merged app files
alternated on the same machine, in the same session — does not separate them on settle:

| Round | app | slicer firstCommit | slicer settled | drag total (commits) | drag per commit |
|---|---|---|---|---|---|
| 1 | pre-merge | 99 ms | 4,874 ms | 12,054 ms (44) | 274 ms |
| 1 | merged | 105 ms | 4,842 ms | 17,327 ms (40) | 433 ms |
| 2 | pre-merge | 99 ms | 5,088 ms | 18,303 ms (40) | 458 ms |
| 2 | merged | 118 ms | 5,370 ms | **2,427 ms** (40) | 61 ms |

**Settled** interleaves with no ordering — merged is lower in round 1 and higher in round 2 — so
on that metric the merge cannot be separated from the machine at all. **firstCommit does show an
ordering**: merged is higher in both rounds (105 > 99 and 118 > 99). Two rounds is nowhere near
enough to call that a regression, and the gap sits well inside the session drift quoted below —
but it is not "no separation" either, so do not cite this table as a clean bill of health for
firstCommit specifically.

The drag control is the clearest read, and it has to be taken per commit, not as a raw total: the
round-1 pre-merge trial fired 44 commits where the other three fired 40, so its 12,054 ms is 10%
more work, not just a faster run. Normalised, one metric on one machine with only the app file
alternating under it swings **7.5×** (458 ms against 61 ms per commit). The machine, not the code,
is the dominant variable for anything downstream of the deferred render.

So: across this whole session `firstCommit` ranged 76 → 118 ms, **55%** drift on unchanged code.
Treat that as its noise band, not a tighter figure — and still prefer it to settle, which moved
**6.4×** across sessions (the 832 ms recorded earlier against the ~5,370 ms here). That 6.4× is a
cross-session figure and is *not* visible in the table above, where settled spans only 1.11×.
Compare settle only within a single interleaved A/B run, never against a figure recorded on
another day — including the 832 ms above, which is real but was taken on a quieter machine.

The slicer settle is **bimodal** — 530, 612, 615, 832, 3760, 3774, 3880 — the same two-mode
shape pass 2 found in the pre-deferral first-commit numbers. First-commit is not bimodal, which
is the point: the button is consistently responsive, and it is the deferred table render that
sometimes takes the slow path. Quote the first-commit number as the responsiveness guard and
the full sample list, not the median, for settle.

### New finding this coverage immediately exposed — column-resize drag on POL

Metric 3, 40 real mousemove events over a column-resize handle, Detail vs POL:

```
Detail: total  1,002 ms, 40 commits ( 25 ms/commit)
POL:    total 14,333 ms, 40 commits (358 ms/commit)
```

**Correction, 2026-09-21: this is NOT an uncoalesced handler.** An earlier draft of this
section called "commits ≈ steps" F5's exact bug signature — one `setState` per mousemove, no
rAF coalescing. That is wrong, and the wrong claim also ended up printed by the benchmark itself
(see the harness fix below). `makeColResizer` at
`Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html:3936` already guards its `setState` behind
`if (rafId == null) rafId = requestAnimationFrame(flush)` — the same pattern F5 shipped
elsewhere. Whatever is happening here, it is not that bug.

Why commits still equal steps despite the guard is NOT fully diagnosed — flagging the honest
state rather than a second unverified explanation. The commit timestamps land ~320-330ms apart,
matching the per-commit cost measured below, which is consistent with `flush()` resetting
`rafId = null` on its very first line, before the expensive `setState` render runs — so a new
rAF is eligible to be scheduled again well before that render finishes. Whether a real,
continuously-driven mouse drag actually gets coalesced by this guard (multiple native
mousemoves queuing up while the main thread is busy, then collapsing to one flush) or behaves
like this benchmark either way is not established here — this harness drives the drag via
Playwright's `mouse.move(..., { steps })`, which may serialize each step's dispatch against the
renderer rather than reproducing how a real OS mouse queues input. Don't assume either the
"real dragging is fine" or "real dragging is just as bad" reading without checking it. What is
established, independent of that question: rAF coalescing cannot make a 9,232-row commit
itself faster, so this is not primarily a coalescing problem either way.

A DevTools trace of one 40-step drag on POL (main-thread self time, 13.2s total) shows why it's
slow — and why it's a **different bottleneck from the slicer click above**:

```
PrePaint + Layout + Paint   64%   (8,441ms)  <- browser re-laying-out 9,232 rows per commit
FunctionCall (JS)           30%   (3,930ms)  <- React building/reconciling those rows
```

That's the inverse of the slicer click, which traced at roughly 51% JS / 27% layout+paint on
the same tab. The click's cost is React work (virtualization is the lever); the drag's cost is
the browser laying out and painting a 9,232-row table on every commit, which is what
`content-visibility: auto` on off-screen row groups is built to skip. The two findings want
different fixes, and this section previously pointed future work at the wrong one for the drag.

This is pre-existing, not a pass-2 regression (the v1.66 baseline shows the same
40-commits-for-40-steps shape on Detail, just far cheaper per commit — see the totals above).
Not fixed here: it is out of pass 2's scope and wants its own measured pass, informed by the
trace above rather than by the retracted bug-signature claim.

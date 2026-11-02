# Handoff: Booking Flash Report NA

Full project history, data model, and every non-obvious gotcha found while building this,
written for whoever (human or AI) picks this project up next. Read this before making
changes — several bugs in this project's history were re-introductions of things already
fixed once, because the reasoning wasn't written down anywhere the next session could find it.

See also [README.md](README.md) for "how do I run/test/deploy this," [AGENTS.md](AGENTS.md) for
the required after-every-change checklist (syntax check + live regression suite), and
[DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) — added 2026-08-25, now the primary reference for
field-mapping aliases, per-tab column inventory, frozen/static datasets, and validation status;
this document's own "Confirmed column mapping" and "Known bug classes" sections below are kept
for history but DATA_ARCHITECTURE.md is more complete and current.

## What this project is

Kevin is rebuilding `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm` — an Excel workbook with
Power Pivot/DAX pivots and VBA macros — as a single-file React web app with no build step and
no backend. The app renders 4 visible report tabs (Trade Summary, Sector Summary, POL Booking
Flash, Booking Flash) plus one hidden tab (Booking Summary — kept in the code, just not linked
in the tab bar), fed either by a manual file upload or, as of v1.10, automatically from a
published Google Sheet.

**Business context**: this feeds ocean-freight booking/capacity operations — "Max Laden" is
trunk vessel capacity per lane, "Booking Utilz"/"Trunk Utilization" is booked-vs-capacity, and
the report exists so operations/sales staff can see at a glance which service lanes are
over- or under-booked. Numbers being wrong here has real business impact — treat correctness
bugs in this codebase as high-severity, not cosmetic.

## Architecture

**One HTML file, three CDN scripts, zero build step:**
- React 18 (UMD) + Babel Standalone (in-browser JSX transform) + SheetJS (XLSX) for spreadsheet parsing, both for real files and for fetched CSV text
- Tailwind CSS via CDN
- The whole app is the `FlashReportDashboard` function component (~2,300 lines); a shared
  `PivotTableViewer` component (config-driven tree pivot renderer) backs 4 of the 5 tabs; POL
  Booking Flash and Booking Flash (Detail View) are hand-built flat tables (not tree pivots —
  see **Tab-naming and structure traps** below for why)

### ⚠️ The tab-naming trap

The app's tab **labels** don't map 1:1 to the reference workbook's **sheet names** — always
verify structure/dataFields, never trust the label alone:

| App tab label | Reference Excel's actual matching sheet | Structure |
|---|---|---|
| "Trade Summary" | `Booking_Flash` (yes, really) | Tree pivot, Max Laden/Total TEU/Trunk Utilization, Trade→SubTrade rollup, no Grand Total row (removed 2026-08-24, see below) |
| "Booking Flash" | `Trade_Summary` (yes, really) — but see below | Flat table, one row per VVD/POL, `rowSpan`-merged, no rollup |
| "Booking Summary" (hidden) | doesn't correspond to any single reference sheet | Tree pivot, kept in code but unlinked from the tab bar |

This was discovered and partially fixed 2026-08-14 (swapped which `PivotTableViewer` config
renders under which `activeTab` key), then further clarified the same day when it turned out
the reference's real flat "row-level" sheets (POL_Booking_Flash, Booking_Flash) are Excel
**Tabular Form** pivots — one column per row-field, cell-merged repeats, blank spacer row after
each group, no subtotal rows — not tree pivots at all. The app's "Booking Flash" tab (internal
state key `detail`, sometimes called "Detail View" in code comments) was rebuilt to match this
using the same `rowSpan`-merge + blank-row-after-group algorithm POL_Booking_Flash uses, not
the generic `PivotTableViewer` engine. **Internal `activeTab` state keys were never renamed to
match the display labels** — `'trade_summary'`/`'sector_summary'`/`'pol_booking'`/`'detail'`/
`'booking_flash'` are the real keys; don't assume a key matches its button's visible text.

### Field mapping: `getVal()`

Every raw row is built via one large `getVal(['PrimaryAlias', 'fallback1', ...])` block per
row (inside `processFile`/`parseWorkbookToRows`) — normalized (lowercase, alphanumeric-only)
exact match first, then substring fallback. This is why column names can drift slightly
between exports and the app still works, but it also means a genuinely wrong alias can silently
match the WRONG column if a substring collision exists — when adding a new field, check the
[authoritative Ref-sheet mapping](#confirmed-column-mapping-ref-sheet) below rather than
guessing an alias.

### Pivot engine internals

- `rollupSumOfChildren: true` on a `PivotTableViewer` dataField makes parent tree nodes SUM
  their children's values instead of re-aggregating raw rows directly — needed wherever a
  "max"-aggregated field should combine sub-groups additively (e.g. Max Laden: the real DAX is
  "sum of each lane's own max," not a flat max across every row). Has an optional
  `rollupStableAtDepth: N` for fields that are already constant within a deeper dimension (e.g.
  Sector Alloc is constant across Sale Week within one Lane — summing must only kick in above
  the Lane depth).
- Trade Summary's Max Laden has no Lane rowField to roll up from (its rowFields are only
  Trade/SubTrade), so it uses a different mechanism: a hand-written `laneAwareMaxLdn(ctx, cKey)`
  helper that groups matching raw rows by lane, takes each lane's max, and sums — same
  underlying invariant as `rollupSumOfChildren`, different implementation because the tree
  shape doesn't have a Lane level to hang it on.
- DAX measures live in the workbook's Power Pivot Data Model (`xl/model/item.data`, compressed
  VertiPaq binary) — **confirmed unreadable by any file tool** (manual XML parsing and
  openpyxl both return empty `calculatedFields`). The only way to get a DAX formula is Excel's
  Manage Measures dialog (Power Pivot tab → Manage → Measures list, or per-measure "Edit
  Measure") — ask Kevin for a screenshot if you need to verify a calculation.

### Confirmed DAX formulas

All reference the `Data_download` table unless noted. Source: Kevin's screenshots of Excel's
Manage Measures dialog (2026-08-13/14) — this is the ONLY way these were obtained (see above).

| Measure | Formula | Notes |
|---|---|---|
| Trunk Utilization | `DIVIDE([Sum of Measures Laden TEU], [Max Laden], 0)` | |
| Max Laden | `SUMX(VALUES([Vessel 1st Lane]), CALCULATE(MAX([MCT Max Laden Update])))` | Raw column is **"MCT Max Laden Update"**, NOT "MCT Max Laden" (different column, no display mapping) |
| RFR Utilz | `DIVIDE([Sum of Measures Reefer TEU], [Max of Measures BSA TEU RF], 0)` | |
| Avg Max Laden vs Bkg | `[Sum of Trade Summary Avg Booking] - [Max of Trade Summary Avg Max Laden]` | Uses two PRE-COMPUTED raw columns directly, not a row-level average |
| Avg Utilization | `DIVIDE([Sum of Trade Summary Avg Booking], [Max of Trade Summary Avg Max Laden], 0)` | Same two raw columns |
| Sector Allocation (text) | `CONCATENATEX(DISTINCT([Sector Remarks]), ...)` | Sourced from "Sector Remarks", NOT "MCT Sector Allocation" (zero display mapping). The separate *numeric* "Sector Alloc" pivot field (Sector Summary tab) is unrelated, sourced from the Sector_Data sheet |
| Max LDN vs BKG (Shortfall) | `[Sum of Measures Laden TEU] - [Max of MCT Max Laden Update]` | Uses "Measures Laden TEU" (`ladenTeu`), NOT "Measures POL Laden TEU" (`curLaden`) — a different raw column, easy to confuse |
| ONE Volume | `SUMX(Data_download, VALUE([Measures ONE Quote volume]))` | |
| Operation Issue / AP Status / Rotation / Actual Rotation / Voyage Remarks / SGSIN Dry vs Reefer | `CONCATENATEX(DISTINCT(...))` | Plain text concatenation, not real calculations |
| Activity vs Booking Utilz | `DIVIDE(SUM([Measures Active total TEU]), [Sum of Measures Laden TEU], 0)` | Uses `activeTotalTeu` directly, NOT a manual `inlandAct+portAct` sum |
| Activity vs Max Laden | `SUM([Measures Active total TEU]) - [Max of MCT Max Laden Update]` | Same `activeTotalTeu` source |

**Confirmed NOT custom DAX** (plain Excel aggregates, don't go looking for a formula):
Peak Utiliz %/Peak Overall Utilz (plain MAX); VCO (not a measure, a plain analyst-name lookup
from the source Google Sheet's `VCO_Analyst` tab).

### Confirmed column mapping (Ref sheet)

Kevin pasted a full screenshot of the reference workbook's hidden `Ref` sheet (2026-08-13) —
format: raw `Data_download` column letter → Data Model Field (raw header) → Bkg Flash Field
(display caption). **Column letters drift between this table and the live raw file** (e.g.
"Measures Laden TEU" is column AZ live vs AY in the Ref sheet) — always match by **field name**,
never by letter position.

Bugs this table caught (already fixed, listed so the same mistake isn't repeated):
- `etd`: real column is `Route Date Last Port ETD Date` (caption "ETD Last port") — the old
  alias "ETD Last Port" was word-order-reversed and never matched anything.
- `bsaWgt`: real column is `Measures Last NA Port BSA Wgt` — "Measures BSA WGT" has zero
  display mapping.
- `curLaden` vs `ladenTeu`: "Measures POL Laden TEU" (`curLaden`) and "Measures Laden TEU"
  (`ladenTeu`) are DIFFERENT raw columns (958/964 rows identical, 6 differ). `ladenTeu` feeds
  Trunk Utilization/Shortfall per the DAX; `curLaden` feeds POL Booking Flash's own "Current
  Laden (TEU)" display column. Don't merge these into one field.
- `secAlloc`: "MCT Sector Allocation" has NO Bkg Flash Field mapping — confirms the numeric
  Sector Alloc display should never read this column (see Sector Allocation DAX note above).

## Data pipeline

```
Looker (scheduled delivery, Overwrite: Yes, overwrites the first tab of the target Sheet)
   → Google Sheet in shared Drive
       https://docs.google.com/spreadsheets/d/1M4mL7eNKNVGkW_JJfqSBrgC09TDMoJynjqqtt_FkzbM (tab gid=0)
   → that Sheet's "Publish to the web" CSV export link
   → this app fetches it client-side (CSV_SOURCE_URL constant near the top of the HTML file)
       - fetched on load
       - polled every 5 min (POLL_INTERVAL_MS)
       - shows a "New data available" banner on change rather than silently swapping data
       - a manual "Refresh Now" button and the original drag/drop upload remain as fallbacks
```

**Security posture, explicitly chosen by Kevin** (not the default recommendation): the CSV
source is a public-but-unlisted "Publish to the web" link — anyone with the URL can read it,
independent of the Sheet's own Drive sharing settings, until it's unpublished. This tradeoff was
made deliberately for setup simplicity over an OAuth/Apps-Script-gated alternative. If this ever
needs tightening, the alternatives (Sheets API + GIS OAuth restricted to "Internal," or an Apps
Script Web App gate) were researched and are a re-architecture, not a small tweak — ask before
assuming you can silently swap the approach.

**A second Sheet was mentioned during this setup** (`1Nx-i11JQB98ggfst1qS0V4NttHiyqGOKcVWUuSHYivs`)
and Kevin confirmed it's unrelated/reference, not a data source — don't wire anything to it
without asking first.

**Hosting**: the app itself is meant to be served as a Google Apps Script Web App with
"Anyone within the organization" access, so opening the report requires a signed-in company
Google account — even though the data fetch itself is unauthenticated. See
[apps-script/README.md](apps-script/README.md) for the full deploy walkthrough. **This step
has not been done yet as of this writing** — see Outstanding work below.

### Live-testing method

The sandboxed dev environment this project has been built in declines `file://` access to new
local paths — a static Babel syntax check is not a substitute for real rendering, and this
project has repeatedly caught real bugs (crashes, wrong numbers) that only appear with real
data live-rendered in a browser, never from reading the code alone.

1. Serve the directory over local HTTP (see README's "Running it locally"), not `file://`.
2. Navigate a real browser to `http://localhost:<port>/<file>.html`.
3. **Simulate a file upload** (since a real OS file picker isn't automatable): `fetch()` the raw
   `.xlsx`/`.csv` from the same origin, build a `File`/`DataTransfer`, assign it to the hidden
   `<input type=file>`'s `.files`, dispatch a `change` event. This drives the real
   `handleFileUpload` path with actual data.
4. For unminified React error messages, swap the CDN script tags to `react.development.js`/
   `react-dom.development.js` in a throwaway debug copy — never ship that swap.
5. **`read_console_messages`-style tools can show accumulated history across navigations in the
   same browser tab**, not just the current page load — stale errors from an earlier test can
   resurface and look like a current bug. When in doubt whether an error is current, open a
   fresh tab, or corroborate with a direct DOM/state check rather than trusting console output
   alone.
6. **Automated multi-step browser scripts (many sequential clicks/waits in one long script) have
   been unreliable in this environment** — intermittent truncated/incomplete results that don't
   reproduce the same way twice. When an automated multi-step test gives a suspicious result,
   don't conclude a regression from that alone — re-verify with careful, deliberate, single-step
   checks (one action, wait, read state, repeat) before trusting a "clean automated run" or
   distrusting a "failed automated run."

## Known bug classes (read before touching numeric/color logic)

These aren't one-off fixes — they're **patterns** that have recurred multiple times across
different tabs. If you're adding a new numeric field or a new conditional background color,
check whether it falls into one of these traps.

**Class A — Rollup correctness.** Any MAX-aggregated capacity-type field (Max Laden, Avg Max
Laden) must be the SUM of each distinct lane's own max at any tree level spanning more than one
lane — never a flat max across pooled rows from different lanes. Found and fixed independently
on Trade Summary (`laneAwareMaxLdn`) and twice on Sector Summary (once in the pivot's own
`rollupSumOfChildren` config, once in a completely separate hand-rolled KPI-card calculation
that duplicated the same wrong logic via its own code path). **Does not apply** to genuine
percentage/ratio fields (you can't meaningfully "sum" two utilization percentages) or to fields
at a data grain with no Lane rollup tree at all (POL Booking Flash's own Max Laden is
per-VVD/per-sailing, already ground-truth verified, deliberately left alone).

**Class B — CSS specificity/readability.** Two Tailwind utility classes of EQUAL specificity on
the same cell (e.g. an always-on tint class plus a conditional flag background like
`bg-red-600`) have an **undefined winner** — depends on Tailwind's stylesheet insertion order,
not the order the classes appear in the JSX string, and can differ between page reloads. Found
three times (Sector Summary's pivot, POL Booking Flash's hand-built table, twice with the same
root cause). Fix pattern: make one class win deterministically — either conditionally omit the
tint when a flag class is already present, or use an exclusive `||` choice between the two
classes — never string-concatenate two potentially-conflicting `bg-` classes onto one cell. A
revert-and-retest of a Class B fix can legitimately "pass" on the buggy code by chance (the
insertion-order tie-break isn't guaranteed to reproduce) — don't treat one clean revert-test as
proof there's no conflict; inspect the actual computed `className`/specificity directly.

**The sticky-header border-collapse bug** (found 2026-08-26, a recurring CSS pattern from prior
projects, not a data bug — no Class letter, since the A-G scheme above is specifically for
data-correctness bugs). Every data table's `<thead>` uses `position: sticky` on a
`border-collapse` table so the header stays visible while the body scrolls underneath it. In that
combination, the *collapsed* border shared between the header's last row and the body's first row
is a real Chromium rendering bug: once the header is stuck and the body has scrolled past its
original layout position, the collapsed border along that shared edge intermittently repaints
using the *body row's* border color instead of the header's, even though `getComputedStyle` still
reports the header's own border as solid black — confirmed via an isolated repro table (outside
this app) and pixel-sampling real screenshots before/after scroll, not just eyeballing it. The
practical symptom (and the exact wording used to describe it before): "when I scroll down the
borders around the header turn from black to transparent." Fixed by adding an explicit outset
`box-shadow` to the `<thead>` element itself (`shadow-[..., 0_1px_0_black]`, combined into the
existing `shadow-sm` utility since an element can only have one `box-shadow` declaration) — a
solid 1px black line painted directly on the sticky element's own box, immune to the
collapsed-border resolution algorithm since it isn't part of it. Deliberately **not** fixed by
switching the table to `border-collapse: separate` (the other standard fix for this bug class):
tested both in an isolated repro, and separate mode requires every cell to declare only one side
of each shared edge to avoid doubling border weight, which isn't safe to blanket-apply across
these tables' many `rowSpan`/`colSpan`-merged cells (Trade/Sub Trade/Lane merged cells, Inland/
Port Total's 2-row group headers) without risking missing or doubled borders elsewhere — the
box-shadow fix is equivalent in this case and additive-only. Applies to all 3 of the app's sticky
`<thead>` elements: `PivotTableViewer` (shared by Trade Summary and both Sector Summary pivots),
POL Booking Flash, and Booking Flash/Detail. The Compare tab's own small tables (New/Removed/
Changed Bookings) don't use `position: sticky`, so they're not affected. **If a new sticky
`<thead>` is ever added, give it this same box-shadow treatment up front** rather than waiting for
the bug to resurface.

**Class D — Comma-truncation in numeric parsing** (found 2026-08-18, the most recent and most
severe). Plain `parseFloat()` on a raw source-value string stops at the first non-numeric
character, so a thousands-separated value like `"42,079"` silently truncates to `42` — up to a
~1000x undercount. **This was dormant the entire project** because the static reference `.xlsx`
test file's affected columns happened not to be comma-formatted; only the live Google Sheet CSV
(which does format large numbers with commas) exposed it, showing Trunk Utilization values like
`753114%`. Fixed with a shared `toNum(val)` helper
(`parseFloat(String(val ?? '').replace(/[,%()]/g, '')) || 0`) applied everywhere a raw
`getVal()`-derived string becomes a number for real math. **When adding any new raw-value
arithmetic, always route it through `toNum`, never bare `parseFloat`** — display-only formatters
(`formatNumberWithCommas` etc.) that receive already-computed numbers are fine as-is; the risk
is specifically at the raw-string → number boundary.

**Class E — Fuzzy-alias landmine** (found 2026-08-18 on `tat`/`let`, found again on 4 more fields
2026-08-25 — see [DATA_ARCHITECTURE.md's Class E section](DATA_ARCHITECTURE.md#class-e--the-fuzzy-alias-landmine-read-this-before-adding-any-getval-call)
for the full writeup and the standing rule for any new `getVal()` call). A short, generic
trailing alias (`'Cutoff'`, `'ETD'`, `'Remarks'`) sits harmlessly unused as long as its field's
primary source column is populated on every row — the moment one row has that column blank,
`getVal()`'s substring-fallback pass can silently match a completely unrelated real column
instead. Confirmed live-broken on `cutoff`/`etd`/`proformaRot`/`remarks` (worst: Voyage Remarks
leaking in that row's Sector Remarks text on 347 rows). Fixed by removing every alias proven to
fuzzy-collide against the full header set; run `tests/check_alias_landmines.py` against any real
export before adding a new alias.

**Class F — Inconsistent/lossy formatting from the live source** (found 2026-08-25 — see
[DATA_ARCHITECTURE.md's Class F section](DATA_ARCHITECTURE.md#class-f--inconsistentlossy-formatting-from-the-live-source-found-2026-08-25)
for the full writeup). `getVal()` never formats anything — it just returns raw text, which is
fine only as long as every source renders a given field's text *consistently*. It doesn't: the
live CSV source (a Google Sheet's own "Publish to the web" export) writes each cell's *displayed*
text respecting that cell's own individual number format, so the SAME column can carry different
shapes row-to-row if the sheet itself was ever formatted inconsistently — confirmed live on
"Route Date POL Cut/off Date" (~77% of rows a year-less `"Mon D"` like `"Jul 10"`, the rest ISO
`"YYYY-MM-DD"`; the underlying `.xlsm` data has a real year on 100% of rows, so this is genuinely
lost by the CSV export step, not a real gap in the source). New `formatDate()` normalizer fixes
this (see DATA_ARCHITECTURE.md's Class F for the exact mechanism, including a real gotcha:
SheetJS's own CSV parser already reformats ISO-shaped cells to `"M/D/YY"` *before* this app's code
runs at all, so a year-hint parser expecting raw ISO silently never fires). Also folded into
Class F: several TEU/plug fields rendered comma-formatted on POL Booking Flash but as bare numbers
on Booking Flash/Detail (same fields, inconsistent tabs) — fixed by wrapping the Detail tab's
render sites in `formatNumberWithCommas()` too. **Worth remembering for the next DOM-indexed
regression check**: while adding tests for the above, found that this suite's own pre-existing
`fromEnd = headerLabels.length - idx` column-lookup math was silently reading the wrong `<td>`
whenever the target field sat before a `colSpan`-grouped header later in the same row (a
`colSpan={3}` header inflates the real column count without adding array entries) — this had been
quietly true for the pre-existing "Max Laden Vs POL Booking"/"Short_Fall" checks too, both fixed
alongside the new ones by computing `fromEnd` from each header cell's actual `colspan` attribute.

**Class G — Temporal-scope mismatch in a derived ratio** (found 2026-08-26 — see
[DATA_ARCHITECTURE.md's Class G section](DATA_ARCHITECTURE.md#class-g--temporal-scope-mismatch-in-a-derived-ratio-found-2026-08-26)
for the full writeup). A ratio built from two aggregates summed over *different* time windows
looks like a normal percentage but is arithmetically meaningless, and nothing in the code signals
the mismatch. Found on the Compare tab's "Overall Utilization" KPI: numerator summed booked Laden
TEU across every Sale Week in the file, denominator summed each lane's single peak Max Laden
pooled across the same weeks — cumulative multi-week total over a single-week capacity snapshot,
producing 394%/396% on real data. Fixed with a separately-scoped weekly-averaged computation
(mirroring the Analyze modal's already-correct `serviceLaneAnalysis` methodology) used only for
this ratio; the KPI cards' own Total Max Laden/Total Booked TEU values were independently verified
correct and left untouched.

**A related, structural discovery**: the raw source data has multiple rows per VVD (voyage) —
confirmed ~2.6 rows/VVD on average, most likely one row per POL/network-leg. This is NOT new or
specific to the live Sheet (the old static reference `.xlsx` has the identical pattern — 964
rows / 375 distinct VVDs). MAX-aggregated fields (Max Laden) are insensitive to this by
construction; SUM-aggregated fields (Total TEU, Laden TEU) legitimately need every row's own
contribution summed — that's correct as long as each row's TEU value is that row's own
proportional slice, not a repeated per-voyage total. This has not been independently verified
against a DAX/Ref-sheet source — if a future SUM-based field looks implausibly large, check
whether it's this (correct, expected) row-duplication before assuming a bug.

## Testing

**Required after every app change — see [AGENTS.md](AGENTS.md) for the full checklist.** In
short: a Babel/`node --check` syntax pass alone is not enough (it's caught real bugs missing —
see AGENTS.md's example), so [`tests/booking_flash_regression_tests.js`](tests/booking_flash_regression_tests.js)
must also be run live against a real browser with real data before a change counts as done.

The suite itself: a standalone script (this project has no test framework) with check classes
A/B/C/D/E/F/G (matching the bug classes above; C is Analyze-modal math verification, not tied to a
specific bug). Written as **structural/invariant checks**, not hardcoded-number snapshots — they
assert relationships that hold regardless of which data file is loaded (e.g. "each Trade/Sub
Trade row's Max Laden == sum of its children," never "Max Laden == 71,258"), so they stay valid
as the live data changes. (Sector Summary's and Trade Summary's own Grand Total ROW no longer
exists as of 2026-08-24 — the Class A checks that used to compare against it now check the
sum-of-children invariant at every row level directly instead; see the test file's own comments
on the `Trade_Summary`/`Sector_Summary` suites if you're editing them.)

A second, separate script — [`tests/check_alias_landmines.py`](tests/check_alias_landmines.py) —
covers what the browser suite above deliberately doesn't: whether each `getVal()` field's alias
list is actually wired to the right raw column (Class E). It's a static analysis, no browser
needed: point it at any real export and it flags every alias that would fuzzy-match the wrong
column. Run both — the browser suite for rendering/rollup/formatting correctness, this one for
field-linkage correctness — see [AGENTS.md's full data-linkage validation workflow](AGENTS.md#full-data-linkage-validation-workflow)
for how they fit together in a full audit.

Run the browser suite by pasting into the browser console after real data is loaded, or by
injecting it into an automated Playwright/similar session (see the file's own header for exact
instructions).
**A caveat from experience**: running the whole suite via one long automated script in this
project's dev sandbox has been unreliable (see Live-testing method point 6 above and AGENTS.md's
"Known flakiness" section) — if a run looks broken, re-verify the specific failing assertion by
hand (a single deliberate tab-click + wait + inspect, not another full automated run) before
trusting it as a real regression, and before dismissing it as flakiness.

## Outstanding work

- **Toggle-panel column defaults changed.** Done 2026-08-26, per Kevin's own screenshot of the
  desired arrangement, confirmed via follow-up clarification. Every toggleable column across POL
  Booking Flash's and Booking Flash/Detail's panels now defaults to **hidden** except **Sector
  Allocation** and **Operational Issues**, which default to **shown** — a near-total flip from the
  old all-shown-by-default state (`sectorAllocHidden`/`opIssuesHidden` were already `false` and
  didn't need changing; `remarksHidden` was already `true`; every other toggle's `useState` default
  flipped `false` → `true`: `reeferHidden`, `bsaHidden`, `activityHidden`, `dgVolumeHidden`,
  `apStatusHidden`, `rotationHidden`, `tradeBreakdownHidden`, `vcoHidden`, `etaHidden`). Reefer/
  Activity/Operational Issues are shared state between the two tabs' panels (same variables), so
  this one change affects both at once, not per-tab. Live-verified both panels render exactly the
  requested Show/Hide pattern on a fresh load. Full regression suite: 47/47 passing.
- **Trade Summary's Row Labels column was rendering far wider than its content needed** (a real
  bug, not a preference — Kevin flagged it against a reference screenshot showing the correct,
  narrow look). Done 2026-08-26. Root cause: the row-label `<span>` in `PivotTableViewer`'s
  `valuesInRows` branch (Trade Summary's own layout — the sibling non-`valuesInRows` branch used
  by Sector Summary has no such span/class and was unaffected) used `className="flex items-center"`
  for icon+text alignment. `flex` makes a `<span>` a BLOCK-level flex container, which — having no
  explicit width — stretches to fill its containing `<td>`'s full width regardless of how short its
  actual text is. That's invisible in normal rendering, but broke the auto-fit column-width
  measurement added earlier this session: `measureRenderedTextWidth`'s Range selects this span's
  contents and measures ITS box, so every row (`"LAT"`, `"TAT"`, whatever) reported back the
  column's OWN CURRENT width, not its real text width — a self-reinforcing loop where "measured"
  width was just whatever width the column already happened to have, compounding upward across
  renders (confirmed empirically: it grew further at LOWER zoom levels, the opposite of a real
  content-driven width). Fixed by changing `flex` to `inline-flex` (inline-level, shrink-to-fit,
  same icon+text alignment) — Row Labels now correctly sizes to its actual content: ~305px → ~128px
  in the live-verified case. Full regression suite: 47/47 passing.
- **Slicer panel decluttered; Sale Week/Yard grid fixed to render uniformly.** Done 2026-08-26,
  per Kevin's direct feedback on a screenshot. Three separate fixes:
  1. Sale Week/Yard's `max-h-[56px]` (was 44px, see the box's own comment for the exact math) --
     44px undershot 2 full button rows by several px, silently clipping the bottom of the 2nd row
     and making whichever 2 weeks happened to land there look like "smaller buttons" when they
     were really the same size, just cut short.
  2. Added `items-start` to that row (was relying on default `align-items:stretch`) plus
     `whitespace-nowrap` on every button: one long Yard code wrapping to 2 lines inside its own
     button was stretching every OTHER button sharing that flex-wrap line up to match it
     (flexbox's cross-axis stretch applies per line, not per item) -- this is why Yard's grid
     looked visually different from Sale Week's uniform one. Also excluded the literal value
     `"NO N.A. CALL"` from `availableYards` entirely per Kevin's follow-up ("don't include NO N.A.
     CALL in the slicer") -- a real Yard-column value (rows with no actual North America call),
     just not one worth a slicer button; rows carrying it are untouched everywhere else.
  3. Zoom/Text Size/Dark mode (previously permanently visible in the slicer panel's toggle
     column on every tab) moved into a new "⚙️ Display Settings" popover button, positioned
     directly above the Upload File button in the top header per Kevin's request. Business Rules
     moved out of that same old row too, to sit next to the Analyze button in the tab-bar's
     button row instead (always rendered regardless of tab, since the NOTES it shows are
     report-wide) -- same state/click-to-toggle behavior for both, just relocated. This also
     freed up real width in the slicer panel now that the old Zoom row is gone.
  Live-verified across all 5 tabs, light and dark mode. Full regression suite: 47/47 passing.
- ~~**Sector Summary's right-hand pivot can likely go live.**~~ **Done 2026-08-25.** It now fetches
  the real source Kevin provided (`SECTOR_DATA_CSV_URL`, a "Publish to the web" CSV export) the
  same way `CSV_SOURCE_URL` is fetched — initial load, its own independent poll, and manual
  refresh, all gated on `isSectorCsvSourceConfigured()`. `sectorDataMapped` now depends on
  `sectorSourceRows` state instead of the static `SECTOR_DATA_SEED`, which is kept only as that
  state's initial fallback value. Live-verified via Playwright (real fetched TAT/AL5/BEANR
  Average Booking = 158, not the old frozen 296; row order per the `childOrder` config — see
  Class F — still holds; manual refresh re-fetches; no console errors). See
  DATA_ARCHITECTURE.md's `SECTOR_DATA_SEED` entry for the full detail. `DRY_REEFER_SECTOR_SEED`
  (the separate supplementary table) was audited and removed 2026-08-26 — see below.
- ~~**Sector Summary tab slicers only filtered the left-hand pivot.**~~ **Done 2026-08-26.**
  `sectorDataMapped` (the right-hand "Sector Summary" pivot) ignored every slicer selection
  entirely, since it maps `sectorSourceRows` with no filtering at all, unlike the left pivot
  which is built from `filteredRawRows`. Fixed by filtering on Sub Trade and Lane only — the
  only two slicer fields this source actually has columns for; Coast/SPC Analyst/Sale
  Week/Yard/AP Status still don't apply here by design. See DATA_ARCHITECTURE.md's
  `SECTOR_DATA_SEED` entry for the full detail.
- ~~**Slicer panel: Sale Week/Yard's scroll box only ever showed one row, and Lane wrapped to 2
  lines.**~~ **Done 2026-08-26.** Sale Week/Yard's `max-h-[27px]` scroll box was tall enough for
  only one button row — with more rows below it, scrolling felt like "limbo" (no visible sign a
  2nd row existed until you scrolled blind). Raised to `max-h-[44px]` (2 full rows, rest
  scrollable). Separately, `SlicerBtn`'s font shrank from `text-[10px]` to `text-[9px]` (also
  answers "what's the slicer font size") and Sub Trade/Coast/Lane's fixed button width from
  `w-[45px]` to `w-[40px]` (SPC Analyst/Sale Week/Yard unchanged — their longer text needs the
  room), which was enough on its own to fit all of Lane's ~28 buttons on one row within the
  panel's existing width — no separate box-widening needed. Clear Filters' placement (already on
  the Sub Trade/Coast/SPC Analyst row, from the 2026-08-25 pass) was unaffected, confirmed still
  correctly positioned after these changes. Live-verified across all 5 tabs, light and dark mode.
- ~~**Sector Summary's row order should match the real Excel.**~~ **Done 2026-08-25.** Both
  pivots' Trade level sorted alphabetically by default (TAT, TPT, [LAT]); the real reference
  workbook's actual order — confirmed via its pivot XML, a deliberate manual override, not
  derivable — is TPT, then TAT, then LAT. Fixed via a new `childOrder` config (replacing the
  narrower, level-0-only `topLevelOrder`) that also orders Sub Trade/Lane/POD Sector beneath each
  Trade, hardcoded from the reference workbook's own row order at every level. See
  DATA_ARCHITECTURE.md's Class F.
- ~~**Sub Trade/Coast/SPC Analyst/Lane slicers should auto-update as new values appear in the
  data.**~~ **Done 2026-08-26.** These four were hardcoded literal arrays — correct when written,
  silently stale the moment a new value appeared in later data (rows still filtered fine, they
  just got no slicer button). Replaced with `useMemo`s deriving each list live from `rawRows`,
  matching the pre-existing Sale Week/Yard pattern. Live-verified via synthetic injection, which
  also surfaced two real pre-existing lanes (`EXE`, `INE`) missing from the old hardcoded list.
  See DATA_ARCHITECTURE.md's "Dynamic slicers" section.
- ~~**Compare tab needs a correctness audit.**~~ **Done 2026-08-26.** Matching-key uniqueness,
  added/removed/changed counts, and every KPI independently recomputed against real source files.
  Found and fixed one real bug: "Overall Utilization" was a temporal-scope-mismatched ratio (Class
  G, see above) — 394%/396% before the fix, 31%/32% after; the Total Max Laden/Total Booked TEU
  cards were already correct and untouched. See DATA_ARCHITECTURE.md's Validation status table.
- ~~**Sector Summary's Dry/Reefer supplementary table needs an audit.**~~ **Removed 2026-08-26**,
  per direct confirmation it isn't part of the original reference workbook. The audit that
  preceded removal found ~7% real lane coverage (93% of lanes silently rendered as 0) and one lane
  (FP2) ~10.5x overstated from 5 stale ghost VVD rows on top of its own aggregate row — no live
  per-lane source exists for this table, so it was removed outright (seed constant, join logic,
  and render block) rather than patched. See DATA_ARCHITECTURE.md's Frozen/static datasets table.
- **POL Booking Flash / Booking Flash row height reduced.** Done 2026-08-26. Kevin asked to
  shrink the pivot data row height from a guessed 18px toward 14px. Measured first: both tabs'
  hand-built, `rowSpan`-merged tables (not `PivotTableViewer`) were actually rendering body rows
  at 24px — `text-sm` (14px font / 20px line-height, inherited from the `<table>` className) plus
  `p-1.5` (6px top+bottom padding) on every `<td>`. Padding alone can't get under the font's own
  20px line-height, so both had to shrink together: `<tbody>` now carries `text-xs leading-[14px]`
  (12px font, a fixed 14px line-height) and every body `<td>`'s padding dropped from
  `p-1.5`/`pt-1.5`/`py-1.5` to `p-0.5`/`pt-0.5`/`py-0.5` — same recipe on both tabs' `<tbody>`s so
  they stay visually consistent with each other. Real data rows now measure 13.95px (~14px, an
  artifact of collapsed-border sub-pixel rounding) on both tabs, verified live. Header row/font
  untouched. Verified against 2 different datasets (the reference `.xlsx` and a separate live CSV
  export): text stays fully legible at 2x–4x zoom in both light and dark mode (no clipping/
  overlap), and the `rowSpan`-merged Trade/Sub Trade/Lane cells still track the shorter row height
  correctly across groups of very different sizes (18 to 193 spanned rows) with no visible
  overshoot/undershoot. Full regression suite still passes 47/47 (same count as the last
  known-good run).
- **Trade Summary / Sector Summary column widths now auto-fit their real content.** Done
  2026-08-26. Kevin asked to auto-fit column width on these two tabs. Before: every column fell
  back to a fixed `min-w-[80px]` (data columns) or `min-w-[200px]` (Row Labels) whenever the user
  hadn't manually dragged it — a uniform guess regardless of actual content, so a short 3-4 char
  Lane code reserved the same width as a long formatted number, and a long Trade→SubTrade→Lane row
  label got no more room than a short one. Investigated the native-CSS route first (the table
  already has no `table-fixed`, i.e. default `table-layout: auto`) — confirmed empirically it
  isn't sufficient on its own: the table's `w-full` still makes `table-layout: auto` redistribute
  leftover width proportionally across all columns to fill 100%, regardless of any per-column
  hint (min-w class or explicit `width` style alike) — pre-existing behavior, not something this
  change caused, and not worth touching (removing `w-full` would shrink the outer bordered/shadowed
  wrapper's box away from the now-narrower table, a real layout regression on Sector Summary's
  side-by-side pair). Went with the **computed** approach instead: each column's true content width
  is measured directly from the live DOM (`measureRenderedTextWidth`, the Range API against the
  actual rendered `<th>`/`<td>`, which reports genuine glyph-run extent independent of the
  containing cell's stretched box — no canvas font-matching, so it can't drift from the real
  font/weight/zoom) and seeded into the pivot's existing `colWidths` state as the DEFAULT via a new
  `useLayoutEffect`, tagged per cell with a `data-autofit-col` attribute keyed identically to
  `colWidths` (`'rowLabels'`, a dataField's `name`, or — Trade Summary's `colField`+`valuesInRows`
  layout only, which previously had NO width control on its Values/Sale-Week columns at all, no
  min-w, no `colWidths`, no `ColResizeHandle` — `'valuesCol'`/`` `col:${weekKey}` ``, now wired into
  the same mechanism for consistency across all 3 pivot instances). A `manualColWidthKeysRef` set
  (populated on an actual drag, not just a click) makes the effect skip any column the user has
  manually resized, so `ColResizeHandle` still overrides exactly as before, permanently for that
  pivot instance — confirmed live: dragging a column to a new width holds through a data reload, a
  config swap, and a tree collapse/expand toggle (each of which re-runs the auto-fit effect, since
  it depends on `renderRows`/`colKeysWithTotal`/`dataFields`, but skips any manually-set key).
  Recomputes automatically on data change (new upload, live refresh) since those same deps only
  change identity on real content/config changes. One real bug found and fixed live-testing this:
  the `ColResizeHandle`'s absolutely-positioned span is normally contained by its `<th>`'s own
  `position: relative` (adding only its own ~6px to the measured range), but Tailwind's CDN JIT
  compiles utility classes on the fly — on an early render before `relative` finished compiling,
  the handle was measured positioned against a far larger ancestor, ballooning that column's
  measured width into the hundreds of px. Fixed by tagging the handle `data-resize-handle="true"`
  and having `measureRenderedTextWidth` explicitly stop its Range before that node, so the
  decorative handle is never part of the measured content regardless of its positioning context.
  Verified against 2 different datasets (the reference `.xlsx` and a separate live CSV export) —
  column widths visibly track each dataset's own content (e.g. Trade Summary's Row Labels column:
  259px → 221px between the two uploads, tree row count 34 → 35), not frozen at the first
  render's values. Full regression suite passes 47/47 (same count as the last known-good run) —
  note for whoever runs this suite next: the test file's own trailing
  `runBookingFlashRegressionTests();` self-invokes on `addScriptTag` injection, so also calling it
  yourself via `page.evaluate` runs two overlapping instances that race each other's tab clicks —
  the actual root cause (confirmed here, not an app bug) behind the "different Setup check fails
  each time" flakiness signature described above; strip that trailing line before injecting (see
  `tests/booking_flash_regression_tests.js`'s own header comment / the working pattern in a prior
  session's `run_regression.js`) rather than re-running the suite hoping it clears up.
- **Investigated 2026-08-26 (Kevin: "the data currently filtered on the screen should auto-size
  only"): auto-fit column widths on Trade Summary's Sale-Week data columns don't visibly change
  as slicer filters are applied — confirmed this is NOT a stale-measurement bug (the effect does
  re-measure on every filter change; the underlying data cells' own content widths genuinely do
  shrink when filtered, e.g. `col:2026/W27`'s widest data cell measured 48.34px unfiltered vs
  39.55px filtered to Sub Trade=TA). The reason the column's rendered width never moves is that
  `maxByKey` takes the max across BOTH the header `<th>` and every data `<td>` sharing that key,
  and the bold ~8-character header label (`"2026/W27"`) is wider (77.95px) than any realistic
  numeric value under it in either state — so the header, not the data, is the actual binding
  constraint on this column's width, in both the filtered and unfiltered case. Asked Kevin whether
  to exclude the header from the measurement (would let these columns visibly shrink/grow with
  filters, at the cost of the header label wrapping or getting tight at narrow widths) or keep it
  as-is; he chose to keep the header included (matches Excel's own AutoFit Column Width, which
  also sizes to the header) — so no code change was made here. Leaving this written down so a
  future "auto-fit doesn't seem to respond to filters" report on this same column type doesn't
  need to be re-diagnosed from scratch.
- **Apps Script Web App deployment has not been done yet.** Code and instructions are ready
  ([apps-script/](apps-script/)) but the actual deployment (creating the Apps Script project,
  pasting in the code, deploying, getting the `/exec` URL) is a manual, account-level step only
  Kevin can do. Once he has the URL, it should be recorded somewhere durable (this doc, or
  wherever Kevin tracks project links).
- **Looker schedule setup/verification** — confirm the Looker delivery to the Sheet is
  Look/Explore-based (not Dashboard-based, which Looker can't schedule to Sheets), set to
  Overwrite: Yes, targeting the correct Sheet/tab. Not verified as of this writing.
- **The row-duplication-per-VVD question above** — worth a real ground-truth check (does a
  SUM-based field's live value match hand-summing the raw rows for a known voyage?) if a future
  bug report suggests a SUM-based number is implausible in a new way.
- Detail View / Booking Flash's own header cells (~40 individually-hardcoded `<th>` elements)
  don't have per-column drag-resize like every other tab — deliberately deferred as a larger,
  riskier edit; flagged to Kevin as a follow-up option, not yet requested.
- General repo cleanup: the large number of one-off Python scripts (`fix_*.py`, `patch_*.py`,
  `parse_*.py`, etc.) and `.orig` files in the repo root were working scaffolding from early
  build phases and aren't part of the live app's dependency graph — safe to archive/remove in a
  future pass, not currently blocking anything.
- **Text Size now defaults per-tab, and slicer/toggle-button text is bigger.** Done 2026-08-26.
  Kevin: "the text size should be 120% for the Trade summary tab and the rest should be at
  130%... increase the font size by 1 or 2 sizes up for the slicers and buttons, but... keep the
  same look we have now." Two independent changes:
  - `textSizePercent` (the Display Settings menu's "Text Size" control, whose displayed `N%` is
    literally this state's own value, separate from the further `*0.72` zoom-multiplier math —
    see its own useState comment) was a single global default (160) shared by every tab. Replaced
    with a `useEffect([activeTab])` that resets it to 120 on `trade_summary` and 130 on every
    other tab, every time the active tab changes — matches this app's existing per-tab-reset
    precedent (`colWidths` also resets per tab) rather than trying to remember a manual override
    across tabs. The +/- control still adjusts freely from that baseline while on a given tab.
  - `SlicerBtn` (the shared chip component behind every Trade/Sub Trade/Coast/SPC Analyst/Lane/
    Sale Week/Yard/AP Status button on every tab) had its text bumped `text-[9px]` →
    `text-[11px]`; the 15 Show/Hide toggle buttons (Reefer/Activity/BSA/DG Volume/etc.) and Clear
    Filters went `text-[10px]` → `text-[12px]`. To "keep the same look" (no wrapping/clipping at
    the larger size) the per-instance fixed chip widths were widened a few px to match (Sub
    Trade/Coast/Lane `w-[40px]`→`w-[44px]`, SPC Analyst `w-[65px]`→`w-[70px]`, Sale Week/Yard
    `w-[75px]`→`w-[80px]`), the Sale Week/Yard quick-select search boxes went `w-16 text-[9px]` →
    `w-20 text-[11px]`, and the Sale Week/Yard button grid's `max-h` (tuned earlier this session
    to fit exactly 2 rows of buttons before scrolling) was bumped `56px`→`62px` to match the
    ~3px-taller buttons at the new font size — measured live (button height 19.5px→22.5px, box
    content height 61px at the new size) rather than guessed, so it still fits exactly 2 rows with
    the same small headroom as before, no more/less scrolling than previously. Verified live in
    both light and dark mode across Booking Flash/POL Booking Flash's slicer panels (no wrapping,
    no overflow, all button labels — including longer ones like "Ryan H"/"USHOU01" — fully
    legible) and Trade Summary at its new 120% default (still legible, no column wrapping). Full
    regression suite passes 47/47.
- **POL Booking Flash / Booking Flash (Detail) sticky-header scroll glitch fixed.** Done
  2026-08-26. Kevin: "for the Header as you scroll the boarders become transparent or something."
  The box-shadow mitigation added earlier this session (see the now-superseded comment history at
  each `<thead>`) only patched a border-*color* symptom and didn't fix the real bug: a sticky
  `<thead>`'s bottom border is resolved through `border-collapse`'s shared-border algorithm, and
  Chromium doesn't always re-run that resolution correctly once the header is stuck and the body
  is scrolling underneath it — for a single compositor frame the border (and anything painted on
  top of it, box-shadow included, since it's the same element in the same stale frame) can show a
  stale color/content lifted from whatever tbody row is currently passing underneath, then
  self-correct the next frame. Confirmed directly via a CDP screencast capturing every compositor
  frame of a real wheel-driven scroll: caught the thead's bottom edge painting an AP-Only row's
  `#ffc000` yellow for exactly one frame, reproducible 3/3 scripted runs on the unpatched file.
  Tried and empirically ruled out first (not just by reputation): widening the box-shadow,
  `contain: paint`, and `will-change-transform`/`transform: translateZ(0)` on the thead alone —
  translateZ(0) specifically made it *worse* on the Detail table, showing a persistent yellow
  sliver even at rest, because this table already sits inside `activeTabContentRef`'s own
  permanent `transform: scale(zoomLevel)`, and a second transform on the thead fights that one.
  **Real fix**: converted both tables from `border-collapse` to `border-collapse: separate;
  border-spacing: 0`, which removes the shared-border-resolution algorithm entirely — there's no
  more shared edge left for Chromium to resolve wrong. POL Booking Flash (fewer, more centralized
  header cells via its `th(label)`/`headerCell(...)` helpers) got its width/border classes
  adjusted directly; Booking Flash/Detail (~40 individually-hardcoded `<th>` cells, see the
  existing note below about its missing drag-resize) instead got one scoped `<style>` rule
  (`.detail-flash-table th, .detail-flash-table td { border-top: none !important; border-left:
  none !important; }`) so its many existing full-border classNames keep working unmodified,
  stripped down to only their own right+bottom edge — same single-hairline grid as
  `border-collapse` used to produce, just resolved per-cell instead of through the buggy shared
  algorithm; the outer top/left frame line comes from the scroll container div's own `border-2
  border-black` sitting flush against the table. POL Booking Flash's `<thead>` additionally got
  `will-change`/`translateZ(0)`/`backface-visibility`/`isolation` hints (harmless there, unlike on
  Detail, since POL's ancestor chain differs slightly) as a secondary compositor-layer-isolation
  measure. Both tables kept their existing box-shadow as a secondary safety net. Verified: POL
  Booking Flash — reproduced the bleed-through consistently pre-fix (5/5 attempts at a fixed
  scroll offset), confirmed clean across 20+ repeated attempts and 9 different scroll offsets
  post-fix, including AP FROZEN/AP ONLY/VMS-colored rows landing right at the boundary. Booking
  Flash/Detail — 3/3 glitched pre-fix via the CDP screencast method, 0/5 post-fix. Both: no visual
  regression (grid still reads as a single hairline, not doubled, in light/dark mode and when
  scrolled horizontally), zero console/page errors, full regression suite 47/47.
  **Residual risk, stated plainly**: this is a flaky, timing-dependent Chromium compositor bug —
  removing the shared-border mechanism is the structurally sound fix (there's no more mechanism
  left to misfire, versus papering over one specific symptom), but it was verified in sandboxed
  headless Chromium, not Kevin's own machine/browser/GPU, so treat "fixed" here as "the causal
  mechanism is gone, verified extensively" rather than "provably impossible to ever glimpse again
  under every real-world timing condition."
- **Text Size control redone as 4 literal px buttons (12/14/16/18), replacing the %-based
  stepper.** Done 2026-08-26, in 3 quick rounds the same session: Kevin first asked "can we have
  the text size 12px for each table? what size is it now" — answered that it wasn't actually 12px
  anywhere (the old `textSizePercent * 0.72` formula meant the just-added 120%/130% per-tab
  defaults were rendering ~10.4px/~11.2px, not their own displayed numbers), then implemented a
  literal, flat 12px on every table by dropping the `*0.72` multiplier entirely (making the
  control's own "100%" mean the table's real 12px CSS base, an intuitive 1:1 mapping) and removing
  the now-pointless per-tab split. Immediately after seeing that live, Kevin said "the font size is
  already too small so make it 16xp[sic]" — raised the default accordingly. Then, a request to
  simplify the control itself: "Text size in the menu should say 12, 14, 16, 18 and not the %" —
  replaced the old unbounded +/- stepper (`textSizePercent` state + `-`/`+` buttons + a raw `N%`
  readout) with `textSizePx` state (one of 12/14/16/18, default 16) and 4 discrete buttons showing
  those exact numbers, the active one highlighted. Under the hood it's still the same CSS `zoom`
  mechanism this session has relied on throughout (a derived `textSizeZoomPct = textSizePx/12*100`
  feeds the wrapper's `zoom` style) — nothing about *how* the scaling works changed, only the
  control's own unit (px instead of an indirect, historically-confusing percentage). **Real bug
  caught mid-verification**: `getComputedStyle(td).fontSize` reports the pre-zoom *declared* CSS
  value (always `"12px"`), not the real post-zoom on-screen size — the first verification pass
  using it appeared to confirm "12px everywhere" even when the actual rendered size differed, a
  false-positive that would have gone uncaught if not for cross-checking. Fixed by measuring with
  the same Range API technique `measureRenderedTextWidth` already uses elsewhere in this app (a
  live-DOM Range's `getBoundingClientRect()`, not `getComputedStyle`) — confirmed live: 12/14/16/18
  produce wrapper `zoom` values of exactly 100%/116.67%/133.33%/150%, and a real table cell's
  measured rendered height scales in the exact same ratio (1.167/1.333/1.5 relative to the 12px
  baseline, matching to 3 decimal places). Full regression suite: 47/47 at every step. Worth
  remembering: **`getComputedStyle().fontSize` is not a valid way to verify this app's CSS-zoom-
  scaled text size** — always measure real rendered extent via Range/`getBoundingClientRect()`
  instead, matching the app's own established technique.
- **POL Booking Flash now auto-fits its columns too, and its grid regression is fixed.** Done
  2026-08-26, same round as the Text Size work above. Two things, from one screenshot: Kevin said
  "the trade summary table can auto-fit the columns as well" (referencing Trade Summary's existing
  auto-fit, since POL Booking Flash — a hand-built table, not a `PivotTableViewer` instance — never
  had it, only manual drag-resize) while attaching a POL Booking Flash screenshot and separately
  noting "the grid in the POL booking flash tab -- looks to have changed too.. lets change the
  borderlines back to what they were before."
  - **Grid regression**: real, confirmed by inspecting the actual cell classNames — every `<th>`/
    `<td>` here still declares its own full 4-side `border` className (same as the sibling Booking
    Flash/Detail table before ITS copy of this fix), so the earlier border-collapse→separate fix
    (for the sticky-header scroll glitch) rendered every internal seam as two full-weight borders
    touching edge-to-edge instead of one shared hairline — visibly thicker than before. The
    existing fix's own comment claiming "verified live, not doubled" was simply wrong; corrected
    it. Fixed the same way Detail's copy already was: a scoped `.pol-flash-table` style strips
    each cell's own top+left border (leaving right+bottom only) — confirmed live: sample cell
    border widths now 0px top/left, 1px right/bottom, and the sticky-header scroll fix still holds
    (clean scroll, no bleed-through) with this change in place.
  - **Auto-fit**: added the same mechanism `PivotTableViewer` already uses (`measureRenderedTextWidth`
    Range-based measurement, widest cell per column wins, `AUTO_FIT_PADDING`/`AUTO_FIT_MIN` = 22/40
    matching every other auto-fit table) via a new top-level `useLayoutEffect`, `[data-autofit-col]`
    tags on every header and body cell (keyed identically to the pre-existing `polColWidths` keys,
    so no new naming scheme), and a new `manualPolColWidthKeysRef` (mirroring
    `PivotTableViewer`'s own `manualColWidthKeysRef`) so a user's manual drag-resize always wins —
    `makeColResizer` (shared with Detail's own resizer) grew an optional third `manualKeysRef` param
    for this, populated in `onMove` only (not `onMouseDown`, so a stray click doesn't lock a column
    out of auto-fit for nothing). One real subtlety found while wiring the header cells: `headerCell`
    (the filterable-column helper) contains its own `renderFilter` `<input>` inside the `<th>` — tagging
    the whole `<th>` would have measured the input's own `w-full` box (a circular, self-reinforcing
    measurement, the same bug class as Trade Summary's earlier Row Labels `flex`→`inline-flex` fix),
    so `data-autofit-col` goes on the inner `<div>{label}</div>` instead for that helper; the
    filter-less `th` helper and the Inland/Port sub-header cells (no `<input>` inside either) tag the
    `<th>` directly. Also added `data-resize-handle="true"` to the shared top-level `ColResizeHandle`
    component (it was missing this, unlike `PivotTableViewer`'s own internal copy), so its absolutely-
    positioned handle span is excluded from measurement the same way. Verified live: columns visibly
    tightened to real content (e.g. Trade/Sub Trade/BSA TEU down to the 40px+padding floor for their
    short values, Vessel Name/Operational Issues sized to their actual longer text, no more uniform
    fixed-width guesses) in both light and dark mode and when scrolled horizontally; manually dragging
    a column wider and then triggering a re-render (toggling a column-visibility button, which the
    effect's own dependency array reacts to) confirmed the manual width survives, not reset by
    auto-fit. Full regression suite: 47/47. Zero console errors.
- **Text Size default reverted from 16 back to 12 (its own "100%").** Done 2026-08-26, same round
  as the two entries above — Kevin: "put the text zoom back to 100% for all tabs" (referring to
  this control's own underlying CSS zoom%, not the separate whole-report "Zoom" control, which was
  already at its own 100%/untouched). `textSizePx` default: `16` → `12`; see its own useState
  comment for the full 12→16→"100%" back-and-forth history in one place.
- **Text Size options extended to 24px, and PivotTableViewer's shared title bar shrunk.** Done
  2026-08-26. Kevin: "for front size[sic] have it go up to 24" — extended the discrete button set
  from `[12,14,16,18]` to `[12,14,16,18,20,22,24]`, continuing the same +2 step. Verified 24px
  produces exactly 200% zoom, all 7 buttons still fit cleanly in the Display Settings menu with no
  overflow, and auto-fit columns still adapt correctly at the larger size.
  Separately, on a Trade Summary screenshot: "the header here doesn't have to be so big and remove
  the Columns: SalesWeek" — `PivotTableViewer`'s shared `<h2>` title bar (used by Trade Summary and
  both Sector Summary pivots) shrunk `text-xl`/`p-2` → `text-lg`/`py-1.5 px-2`, and its
  `colField && <span>Columns: {colField}</span>` (only ever rendered for Trade Summary, the only
  config that sets `colField`) removed outright. Since the `<h2>` is shared, the size reduction
  applies to Sector Summary's two pivots too — verified live this keeps all 3 title bars visually
  consistent with each other rather than leaving Trade Summary's a different size from its
  siblings. Full regression suite: 47/47 both changes. Zero console errors.
- **Analyze modal ("Service Lane Performance Summary" / "POL Performance Summary") got its own
  Sale Week selector.** Done 2026-08-26. Kevin: "a filter for sales week" (asked alongside a
  request to verify the modal's math — see the math-audit note above/below this one). Real gap
  found while investigating: `serviceLaneAnalysis` (the modal's data source) always hard-coded to
  the **last 4 distinct Sale Weeks present in `filteredRawRows`** with no way to see a different
  window from inside the modal, and silently truncated to those last 4 even if the main panel's
  global Sale Week slicer had more than 4 weeks selected — no indication any weeks were dropped.
  Added a new `analysisSelectedWeeks` state + a Sale Week chip row inside the modal itself
  (`serviceLaneAnalysis.weeksPresent`, NOT capped at 4 — matches the main panel's own `SlicerBtn`
  chip styling), decoupled from the main global slicer: empty selection (untouched, the default)
  preserves the exact old "last 4 weeks" behavior; picking specific weeks overrides it, and
  selecting 5+ is fully supported (`weekCount`/`weekRange` reflect the real count, nothing silently
  dropped). A "Reset to last 4" affordance clears back to default, and every close path (backdrop
  click, ×, "Close Analysis") resets the selection so a stale pick can never carry into a future
  reopen — `serviceLaneAnalysis` also intersects the selection against `weeksPresent` on every
  recompute as a second guard, so a selection referencing weeks that vanished (filter/upload
  changed) can never blank/break the modal, it just falls back to default. Verified live: default
  behavior byte-identical to pre-change (diffed full modal text before/after); a 2-non-contiguous-
  week selection's numbers hand-verified exactly against the raw xlsx (per-week MAX for capacity,
  SUM for laden, averaged across the 2 selected weeks); 5- and 6-week selections confirmed not
  truncated; reset reproduces the default byte-for-byte; works identically on both tabs this modal
  appears on (Lane breakdown / POL breakdown). Full regression suite: 47/47. Zero console errors.
- **Analyze modal math re-audited (2026-08-26, Kevin: "make sure all the math works in it") —
  verified correct, plus one real documentation/comment-accuracy finding fixed.** Independent
  Python/pandas recomputation (reading the raw `.xlsx` directly, no reuse of the app's own JS)
  checked all 305 individual displayed values across 4 scenarios (no filter / Sub Trade="PS"
  filter, × Booking Flash / POL Booking Flash tabs) plus the new Sale Week selector's own
  non-contiguous-week math — **0 mismatches**. Both previously-fixed bugs (Class G's temporal-
  scope fix, and the POL-tab quadruple-counting fix) confirmed still correct on fresh
  re-verification. `weekCount`/`weekRange` confirmed to genuinely reflect the real week count in
  every scenario tested (2/3/4/5/6 weeks), not hardcoded. The algebraic identity `shortfall =
  laden − capacity` holds exactly (to 6 decimal places) in every scenario.
  **One real finding, not a wrong displayed number but a documented-assumption gap**: the
  `serviceLaneAnalysis` comment claimed "POL is a sub-division of one lane's capacity" — checked
  directly against real data and that's false; POL:Lane is many-to-many (e.g. POL "USLAX" appears
  under 10+ distinct lanes; lane "AT4" spans 5 distinct POLs). This doesn't make any number the
  app displays wrong (the Overall Snapshot's by-lane grouping is correct regardless, and
  `exportAnalysisToExcel`'s "OVERALL" row sources from `serviceLaneAnalysis.overall` directly,
  never by summing the per-group rows it also exports) — but it does mean the per-POL breakdown
  cards' own "Avg Wkly Max Laden" isn't meaningfully additive across POLs (confirmed live: summing
  all 19 POL cards on an unfiltered file gave 57,137 vs. the correct by-lane Overall Snapshot total
  of 50,123, ~14% over). A user manually totaling the visible/exported per-POL capacity column (a
  natural thing to do) would get a materially wrong number with no indication why. Fixed 3 ways:
  corrected the inaccurate comment in `serviceLaneAnalysis`, added an on-screen caveat next to
  "Breakdown by POL" (only shown for the POL breakdown — Booking Flash's own Lane cards ARE
  additive, so the note would be misleading there), and added the same caveat as a trailing note
  row in `exportAnalysisToExcel`'s POL export (only when `groupLabel === 'POL'`). Verified live via
  a DOM-subtree-scoped check (not `document.body.textContent`, which false-positives by matching
  the literal JSX source text inside the page's own `<script>` tag — a real methodology trap worth
  remembering for future verification: always scope a "does X text appear" check to the actual
  rendered subtree, never the whole page, when the same literal string also exists as source code
  on the page). Full regression suite: 47/47. Zero console errors.
- **Header row height reduced across all 4 tables.** Done 2026-08-26. Kevin: "We can make the
  headers in each table smaller height wise, but still in line with our other restrictions" —
  interpreted as: tighten padding only, don't touch font size/line-height/column layout (the
  things this session already tuned carefully elsewhere — row height, auto-fit, text size).
  Reduced `<th>` padding on every header cell across all 4 tables' `<thead>`s:
  `py-1`→`py-0.5` on `PivotTableViewer`'s header row (Trade Summary, both Sector Summary pivots —
  including the `valuesCol`/`col:${c}`/`grandTotalValuesCol` cells specific to Trade Summary's
  `colField`+`valuesInRows` layout, which live in the SAME `<tr>` as the Row Labels cell and so
  were silently capping the row's overall height even after Row Labels' own padding was reduced —
  found by measuring `thead.getBoundingClientRect().height` and seeing zero change on the first
  pass, not by inspection alone); `p-2`→`p-1` on POL Booking Flash's own header cells (both the
  regular columns and the Inland/Port group-header row); `p-1.5`→`p-1` on Booking Flash/Detail's
  filter row (47 cells) and `p-2`→`p-1` on its label row (47 cells) and Inland/Port Activity
  group-header row. Measured live (`thead` height, before via `git show HEAD:...` vs. after):
  Trade Summary 25px→21px, Sector Summary 25px→21px, POL Booking Flash 69px→65px, Booking
  Flash/Detail 116px→89px (the biggest win — its label row's multi-line `<br/>`-wrapped labels,
  e.g. "Current<br/>Laden<br/>(TEU)", meant its padding mattered proportionally more). Verified
  live in light and dark mode, at the Inland/Port group-header rows specifically (both tables),
  and with horizontal scroll — no clipping/overlap, every label still fully legible. Full
  regression suite: 47/47. Zero console errors.

## Git workflow used on this project

Every change (including small ones) has gone through a feature/fix branch + PR, even without
CI configured (there is none) — merge commits (not squash/rebase) once the change is verified
live. See closed PRs #1-#5 for the pattern and level of detail expected in a PR description
(what was found, what was fixed, exactly how it was verified live with real numbers).

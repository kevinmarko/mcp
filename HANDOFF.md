# Handoff: Booking Flash Report NA

Full project history, data model, and every non-obvious gotcha found while building this,
written for whoever (human or AI) picks this project up next. Read this before making
changes — several bugs in this project's history were re-introductions of things already
fixed once, because the reasoning wasn't written down anywhere the next session could find it.

See also [README.md](README.md) for "how do I run/test/deploy this."

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
| "Trade Summary" | `Booking_Flash` (yes, really) | Tree pivot, Max Laden/Total TEU/Trunk Utilization, Trade→SubTrade rollup, has Grand Total |
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

[`tests/booking_flash_regression_tests.js`](tests/booking_flash_regression_tests.js) — a
standalone script (this project has no test framework) with 4 check classes (A/B/C/D, matching
the bug classes above; C is Analyze-modal math verification, not tied to a specific bug).
Written as **structural/invariant checks**, not hardcoded-number snapshots — they assert
relationships that hold regardless of which data file is loaded (e.g. "Grand Total == sum of
children," never "Grand Total == 71,258"), so they stay valid as the live data changes.

Run it by pasting into the browser console after real data is loaded, or by fetching + `new
Function(...)` in an automation context (see the file's own header for exact instructions).
**A caveat from experience**: running the whole suite via one long automated script in this
project's dev sandbox has been unreliable (see Live-testing method point 6 above) — if a run
looks broken, re-verify the specific failing assertion by hand before trusting it as a real
regression.

## Outstanding work

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

## Git workflow used on this project

Every change (including small ones) has gone through a feature/fix branch + PR, even without
CI configured (there is none) — merge commits (not squash/rebase) once the change is verified
live. See closed PRs #1-#5 for the pattern and level of detail expected in a PR description
(what was found, what was fixed, exactly how it was verified live with real numbers).

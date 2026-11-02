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
no backend. The app renders 4 report tabs (Trade Summary, Sector Summary, POL Booking
Flash, Booking Flash), fed either by a manual file upload or, as of v1.10, automatically from a
published Google Sheet. (Through 2026-09-15 there was also a 5th, hidden "Booking Summary" tab
kept in the code but unlinked from the tab bar; Kevin asked for it to be removed that day —
see the tab table below.)

**Business context**: this feeds ocean-freight booking/capacity operations — "Max Laden" is
trunk vessel capacity per lane, "Booking Utilz"/"Trunk Utilization" is booked-vs-capacity, and
the report exists so operations/sales staff can see at a glance which service lanes are
over- or under-booked. Numbers being wrong here has real business impact — treat correctness
bugs in this codebase as high-severity, not cosmetic.

## Version numbering: higher does NOT mean current (2026-09-16)

`Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html` is the **main** file — the one that gets
deployed, and the one to change by default.

> **Renamed 2026-09-17: `1.66` became `2.0` for production, per Kevin.** Same file, same git
> history (a true `git mv`, so `git log --follow` works across it). Entries below this point
> that name `1.66` or `v1.66` are dated records describing THIS file under its old name; they
> were deliberately not rewritten, because a record saying something was "verified live on
> unmodified 1.66" is true as written and would become false if renumbered. Read `1.66` as
> `2.0` in anything dated on or before 2026-09-17.
>
> The rename also restores the "highest dotted version is the live file" rule, which had been
> false since 2026-09-04: `2.0` > `1.67`, so filename order and reality agree again.

Higher-numbered files are **testing versions**
developed on their own branches: `1.67_TESTING` (per-user filter/view persistence) as of
2026-09-16, and `1.70_Testing` before it. This reverses the rule README.md carried for months
("always the highest version number present in the repo root is the live one"), which was true
while every version was a straight promotion of the last, and is not true now.

Two consequences worth internalising before touching anything:

1. **Every automated check silently picks the wrong file once a testing version is present.**
   AGENTS.md's required syntax check, `tests/check_alias_landmines.py`,
   `tests/check_date_timezone_safety.js` and the regression suite all auto-detect the app file by
   highest version number. With a testing version present they check THAT file and report green,
   proving nothing about the file you edited. Read the "(auto-detected current app version: ...)"
   line each tool prints, every time. Since 2026-10-04 the rule is one implementation (`pickCurrentAppHtml()` in `scripts/lib/app_file.js`; Python and CI call
   `node scripts/print_app_file.js`) that errors on a tie instead of guessing. An explicit committed pointer naming the live
   app would remove the inference entirely; it does not exist yet.
2. **A merge between a main-file branch and a testing-version branch can silently delete one of
   them.** Measured 2026-09-16: git sees 1.66 -> 1.67 as a 93%-similarity RENAME, so merging a
   branch that renamed 1.66 to 1.67 against a branch that edited 1.66 yields a single 1.67 file
   and no 1.66 — wrong when the two are meant to coexist as main + testing. After any such merge,
   check the resulting tree for BOTH files rather than trusting a clean auto-merge.

## Architecture

**One HTML file, three CDN scripts, zero build step:**
- React 18 (UMD) + Babel Standalone (in-browser JSX transform) + SheetJS (XLSX) for spreadsheet parsing, both for real files and for fetched CSV text
- Tailwind CSS via CDN
- The whole app is the `FlashReportDashboard` function component (~2,300 lines); a shared
  `PivotTableViewer` component (config-driven pivot renderer) backs Trade Summary and
  Sector Summary (2 pivots); POL
  Booking Flash and Booking Flash (Detail View) are hand-built flat tables (not tree pivots —
  see **Tab-naming and structure traps** below for why)

### ⚠️ The tab-naming trap

The app's tab **labels** don't map 1:1 to the reference workbook's **sheet names** — always
verify structure/dataFields, never trust the label alone:

| App tab label | Reference Excel's actual matching sheet | Structure |
|---|---|---|
| "Trade Summary" | `Booking_Flash` (yes, really) | Tree pivot, Max Laden/Total TEU/Trunk Utilization, Trade→SubTrade rollup, no Grand Total row (removed 2026-08-24, see below) |
| "Booking Flash" | `Trade_Summary` (yes, really) — but see below | Flat table, one row per VVD/POL, `rowSpan`-merged, no rollup |
| ~~"Booking Summary" (hidden)~~ | doesn't correspond to any single reference sheet | **REMOVED 2026-09-15.** Was a tree pivot kept in code but unlinked from the tab bar. Three separate reviewers flagged it for deletion during the 2026-09-10 audit and were each told it was deliberate — correctly, because removing it was always Kevin's call to make explicitly, and on 2026-09-15 he made it ("I don't think we need it. Let's just remove it."). Recoverable from git history if it is ever wanted back. Note it was the app's ONLY non-`tabular` PivotTableViewer config, so its removal left `flatten()`/`collapsedNodes`/`toggleCollapse` (the engine's collapsible tree-mode renderer) with no caller — that machinery was deliberately left in place, see the note above `renderRows` in the app file |

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
(`'booking_flash'` was the removed hidden Booking Summary tab's key and is no longer used
anywhere; the visible "Booking Flash" tab's key is `'detail'`. This mismatch is exactly the
trap this section is about.)

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
       - polled every 10 min (POLL_INTERVAL_MS, bumped from 5 min 2026-09-10 per Kevin)
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
7. **Getting genuinely live data instead of only the static upload fixture (added 2026-09-18,
   per Kevin: "use the live data for verification going forward").** This sandbox's outbound
   proxy *can* reach the real published Google Sheet CSV endpoint (`CSV_SOURCE_URL`) the app
   fetches on load — confirmed with `curl -L` (mind the `307` redirect to a signed
   `googleusercontent.com` URL, so `-L` is required) and with a real headless Chromium page's
   own `fetch()`. Two things are NOT automatic, though, and both silently produce a
   "can't reach the internet" false negative if missed:
   - Chromium does not read `$HTTPS_PROXY` itself. Launch it with an explicit proxy, e.g. in
     Playwright: `chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass:
     'localhost,127.0.0.1' } })`.
   - **The `bypass` is not optional.** Without it, EVERY request from that browser — including
     your own `http://localhost:<port>/...` dev server from step 1 above — also gets routed
     through the proxy, and this environment's proxy only accepts HTTPS CONNECT tunnels, so the
     plain local HTTP request silently fails and the page body becomes the proxy's own "this
     proxy only accepts HTTPS CONNECT tunnels" error text instead of your served file. Always
     bypass `localhost`/`127.0.0.1`.
   With both of those in place, loading the app and simply waiting (no manual upload needed)
   drives the same live-fetch path production users hit, with today's real data. Prefer this
   over the static `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` fixture for anything where
   *how much* data renders, or how many/how-wide a data-derived UI element gets (slicer button
   counts/labels, table row counts), actually matters for the thing you're checking — that
   fixture is a frozen 2026-08-12 snapshot and visibly drifts from live as weeks roll forward
   (e.g. its Sale Week options stop around 2026/W43; live had reached W47 by 2026-09-18). The
   fixture upload is still fine, and still simpler, for anything that only needs *some*
   realistic data loaded and isn't sensitive to exactly how much.
8. **A wrap/no-wrap layout claim from `setViewportSize()` + `getBoundingClientRect()` alone is
   not trustworthy — corroborate with an actual screenshot (found 2026-09-18).** While
   re-verifying the Sub Trade/SPC PIC/MKG PIC spacing fix (see this doc's own section on it)
   with live data per item 7 above, a fresh page load at a fixed 1600×900 viewport showed Sub
   Trade still wrapping to its own line — directly contradicting two separate, independent
   agent-verification passes that had each already reported all three groups sharing one row
   at that exact size, rects and all. The discrepancy was not a `setViewportSize` resize/reflow
   timing artifact (retested with a brand-new browser context created directly at 1600×900, no
   resize involved — same wrap, same contradiction), so its root cause is still unconfirmed;
   what's confirmed is that both prior automated rect-based passes were simply wrong about this
   specific layout claim, at a specific size, while reporting high confidence. Don't take a
   `getBoundingClientRect()`-based same-row/wrap verdict at face value, from your own script or
   a subagent's report — always corroborate with a real screenshot at that exact viewport size
   before shipping a layout fix on the strength of it.

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
**2026-09-08 addendum**: a third Class F shape, found the same way as the other two -- a real
value silently mangled before this app's own code ever sees it. Kevin reported "1st POL
Cutoff"/"ETD Last Port" rendering exactly one day early, every lane, every row. Root cause:
SheetJS's CSV parser auto-detects an ISO-shaped date cell, round-trips it through a UTC-anchored
`Date` object, and hands back the *local* calendar day -- one day behind in any NA timezone,
invisible in the UTC sandbox this was built in. Fixed by passing `raw: true` to `XLSX.read()`
itself on every CSV-text parse path (including the manual `.csv` upload, which had the same bug
but NOT the `.xlsx` upload path, deliberately left alone -- see DATA_ARCHITECTURE.md's Class F
for exactly why). See DATA_ARCHITECTURE.md's Class F section for the full writeup, including how
this one got regression coverage despite the DOM-based suite being structurally unable to catch
it (a standalone Node script, `tests/check_date_timezone_safety.js`, that forces the timezone
itself via subprocess rather than depending on whatever timezone happens to be ambient).

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

**Class H — A business rule needs one leg excluded from an otherwise-uniform per-leg SUM**
(found 2026-09-08 — see
[DATA_ARCHITECTURE.md's Validation — 2026-09-08 section](DATA_ARCHITECTURE.md#validation--2026-09-08-al5-current-laden-teu-overstated-by-the-parod-leg)
for the full writeup). Distinct from Class A (which is about MAX-vs-SUM rollup *semantics*): here
the aggregation semantics were already right (`curLaden` genuinely is a per-VVD SUM across POL
legs, and was never missing from the SUM lists), but one specific real-world leg type needed a
business-rule exception the raw data doesn't self-describe. AL5's PAROD01 (Panama Rodman) leg is a
deliberate one-off — added to POL Booking Flash only so MKG can see PAROD's own loading number,
never meant to roll into a vessel's Overall-tab total — confirmed directly by Kevin, and matching
the reference workbook's own `NOTES` tab and a separately-named `MCT Loading TEU incl Parod`
measure in its `Ref` sheet (implying the system's *default* measures already exclude it). Fixed by
excluding any leg whose `pol`/yard code starts with `PAROD` from `curLaden`'s SUM specifically
(matched by POL code, not by Lane, so it stays correct if PAROD is ever added to a lane other than
AL5) — every other summed field (`broken`, `shortfall`, `ladenTeu`, etc.) was left untouched, since
this exception is specific to what "Current Laden (TEU)" means, not a general PAROD-leg rule.
**If a future field looks systematically off by a fixed amount only on rows sharing some non-Lane
attribute** (a specific port, terminal, or leg type), consider this same shape before assuming a
rollup bug: check whether the reference workbook (or Kevin) treats that attribute as a deliberate
exception rather than a normal data point.

**Class I — A field has two legitimately different real-world scopes, and code written for one
context reads the field scoped to the other** (found 2026-09-09 — see
[POL Analyze modal / Compare tab "Vessel Utilz" section](#pol-analyze-modal-max-ladenpeak-utilization-scope-fix-plus-compare-tabs-vessel-utilz-aggregation-fix-2026-09-09-class-i)
below for the full writeup). Distinct from Class A (MAX-vs-SUM rollup semantics) and Class H (a
business-rule exception on an otherwise-correct SUM): here BOTH scoped versions of a field are
already correctly parsed and already correctly used somewhere else in the app — the bug is a
single call site reading the wrong one of the two for the context it's actually operating in.
Two real instances found the same day, from one user report: (1) the Analyze modal's `groupBy`
always read the Lane/vessel-wide `maxLdn`/`peakUtilRaw`, even when grouping by POL, where the
POL-specific `polMaxLdn`/`peakPolUtilzRaw` was needed; (2) Compare tab's "Vessel Utilz" diff read
`curUtilRaw` straight off a single per-POL-leg raw row and labeled it vessel-wide, when
`tableData` already knows this field needs a per-VVD SUM across legs to mean what its own label
says. **The tell in both cases: a field that should legitimately vary (by POL, or by leg) instead
came out suspiciously identical/duplicated across rows that should differ** — the same kind of
"impossible-if-real" signal Class A's rollup checks look for, just at the field-selection level
instead of the aggregation-math level. **If a field has a documented Lane/vessel-wide sibling and
a POL-specific (or per-leg vs. per-vessel) sibling in DATA_ARCHITECTURE.md's field-mapping table,
check every call site that groups/labels data at one of those two grains uses the matching field**
— a 4-agent sweep of the rest of the app the same day (Compare tab, Trade Summary, Sector Summary,
and a full-file broad pass over every other known Lane-vs-POL field pair) found no further live
instances, so this is not currently a widespread problem, just a shape worth re-checking whenever
a new POL-scoped/Lane-scoped field pair or a new per-leg/per-vessel aggregation is added.

## Schedule-change warning (2026-09-08, new feature)

**Motivating case**: Kevin got confused when a vessel's sailing (Lane MAR, VVD NLAT0668E) had its
Cutoff/ETD go from populated to blank, and a Sale Week (2026/W38) that had data at one point later
had none at all, between two times he looked at the report. That turned out to be the live Google
Sheet data source itself changing between refreshes (a sailing's status flipping to
`"NO N.A. CALL"`, a week's assigned vessel changing) — normal-ish operational schedule churn, not
an app bug — but from inside the app it's indistinguishable from a real regression, and a human
had to re-investigate from scratch to tell the two apart. This feature exists so that next time,
a banner says "this is probably the data source, not the app" at a glance instead.

**Hook point**: every path that replaces the live dataset — initial load, the 10-minute auto-poll's
automatic-apply effect, the "New data available" banner's Refresh button, and "Refresh Now" — all
funnel through one function, `applyCsvText` (search for `const applyCsvText = (csvText) => {`).
Right after `result.ok` is confirmed true and BEFORE `liveRawRowsRef.current`/`rawRows` get
overwritten, `applyCsvText` now calls `diffScheduleChange(liveRawRowsRef.current, result.rows)` —
`liveRawRowsRef.current` is always the true current-live dataset regardless of what's on screen
(`rawRows` can be showing a historical snapshot instead, if `viewingHistoricalDate` is set), so
this is the real "before" to diff against the real "after." Skipped entirely on the very first-ever
load (guarded on `liveRawRowsRef.current.length > 0` — nothing to diff against yet), so a fresh
page load never shows the warning. The manual file-upload path (`processFile`, drag/drop or the
"Upload File" button) does **not** go through `applyCsvText` and was deliberately left unhooked —
it's a distinct, already-documented code path (see the `liveRawRowsRef` comment near its own
`useRef` declaration), not one of the four "live data changed" paths this feature is about.

**The diff (`diffScheduleChange(oldRows, newRows)`)**: a pure function (no React state, no
mutation) defined near the other pure helpers, right after `compareEtd`. Both row sets are keyed
by VVD (`String(row.vvd || '').trim().toUpperCase()`, via a shared `collapseRowsByVvdForDiff`
helper) — blank VVDs and the literal placeholder `"VMS"` (a real not-yet-nominated-week
placeholder, not an actual vessel) are skipped, since tracking a `"VMS"` appearing/disappearing is
meaningless noise, not a signal. A VVD can have multiple raw rows (one per POL leg); first-leg-wins
is fine here since every field this diff needs (lane/saleWeek/vessel/cutoff/etd/pol/status) is a
whole-sailing attribute, not a per-leg one. It computes:
- **`removedVvds`/`addedVvds`** — VVDs in one dataset but not the other, each `{count, items,
  byLane}`; `byLane` groups by lane with a count and a rate (removed-lane rate is
  removed-in-that-lane / that lane's OLD count; added-lane rate is added / that lane's NEW count).
  Both feed significance (see below): `diffScheduleChange` combines the two per lane into a NET
  loss (removed − added) before applying the threshold, so a lane that swapped several VVDs out
  and immediately back in the same refresh (net ~0) doesn't fire just because the gross counts
  look large.
- **`dateFlips`** — for VVDs present in BOTH datasets, any `cutoff`/`etd` blank→populated or
  populated→blank flip (`{vvd, lane, field, oldValue, newValue, direction}`).
- **`polFlips.toNoNaCall` / `.fromNoNaCall`** — VVDs whose `pol` (same raw column as `yard`, see
  the field-mapping table) flipped to/from the literal `"NO N.A. CALL"` (case-insensitive,
  trimmed). Kept as its own bucket, separate from `dateFlips`, even though the two are usually
  correlated in practice — this is the exact real-world pattern from the motivating case, and
  worth naming explicitly rather than folding into "some date went blank."
- **`isSignificant`** and **`summaryLines`** (see thresholds below) — the banner renders
  `summaryLines` directly, capped at 8 with a "+N more" overflow line.

**Thresholds (`SCHEDULE_CHANGE_THRESHOLDS`, near `POLL_INTERVAL_MS`) — empirically calibrated**
against `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` (9 real consecutive days, 8
day-over-day diffs, 28 lanes, 223 (lane, day-pair) observations). Two complementary rules, both
applied inside `diffScheduleChange`:
- `laneNetLossThreshold` (2): the UNIVERSAL rule, any lane size — net VVDs lost (removed minus
  added, i.e. not backfilled same-day) in one lane in one refresh. Never exceeded 1 anywhere in
  223 real observations, including the archive's busiest day (a routine weekly voyage-number
  rollover that swapped 24 VVDs for 23 new ones across ~24 lanes simultaneously, net ~0
  everywhere but one) — so this fires zero times on the baseline while still catching a real
  "lost 2 of 3 sailings, no replacement" event, which is the motivating case's actual shape.
- `perLaneRemovedRatePct` (40) / `laneSizeForRatePct` (8): a SUPPLEMENTARY rule, large lanes only
  (>= 8 VVDs before the refresh) — flags a lane losing >=40% of itself at once even if fully
  backfilled to net-zero, since a large lane's sheer gross churn is still worth a heads-up. p90/
  p95/p99 across all 223 observations were 6.2%/7.1%/10.0%; the worst *normal* large-lane case was
  13.3% (ANG, fully backfilled same day) — 40% sits well above that with real margin. 8 is a real
  cutoff, not arbitrary: there's a clean gap in observed lane sizes (2–7, then a jump to 10+,
  nothing at 8–9).
- `concerningFlipVvdThreshold` (1): >=1 *distinct VVD* (not raw flip events — a VVD flipping both
  Cutoff AND ETD only counts once) having a Cutoff/ETD flip from **populated to blank**, or a POL
  flip **TO** the literal `"NO N.A. CALL"`, in one refresh — flagged on its own, independent of the
  per-lane rules above, since the VVD is still present, just with blanked/flipped fields, so a
  removed-VVD count alone wouldn't catch it. **Direction matters and is deliberately asymmetric**:
  across all 8 day-pairs (~3,300 held-in-common VVD comparisons), the populated→blank direction
  happened on exactly ONE real VVD in the whole archive (`7E3T0001W`, lane EC4) — which then
  disappeared entirely the very next refresh, the closest real analog to Kevin's actual
  MAR/NLAT0668E incident. The OPPOSITE direction (blank→populated — a schedule finally being
  announced, or a real N.A. port coming back) happened twice and was benign both times, so it's
  deliberately excluded from this count (along with POL flips OFF `"NO N.A. CALL"`) — good news
  must not trigger the same warning as bad news.
Full derivation and the raw archive numbers live in the threshold constant's own comment block in
the app file, next to `POLL_INTERVAL_MS`.

**State/UI**: `scheduleChangeWarning` (`useState(null)`) holds the diff object whenever the most
recent swap was significant; cleared (`setScheduleChangeWarning(null)`) on any subsequent
non-significant swap, or by the banner's own dismiss (×) button — dismissing never blocks or
delays the actual data swap, which always applies normally regardless (this is a heads-up, not a
confirmation gate). The banner itself renders near the existing `newDataAvailable`/
`sectorFetchError` banners, deliberately its own color (amber/orange — `bg-orange-50
border-orange-400 text-orange-900` light, matching dark variants) so it's visually distinct from
the blue "new data available" banner and the yellow soft-failure banners on the same screen; same
`rawRows.length > 0 && !viewingHistoricalDate` guard as the `newDataAvailable` banner immediately
above it, for the identical reason (don't show a live-refresh warning while someone's reviewing a
historical snapshot).

**Live-verified** (Playwright, mocking `fetch(CSV_SOURCE_URL)` via route interception with two
different CSV texts built from the real sample file, then driving the real `handleManualRefresh` →
`fetchCsvText` → `applyCsvText` path — the actual hook, not a look-alike): (1) first-ever load
shows no banner (nothing to diff against); (2) a synthetic large change (a lane's sailings net-lost
past `laneNetLossThreshold`, several VVDs' Cutoff/ETD blanked populated→blank, VVDs' POL flipped to
`"NO N.A. CALL"`) triggers the banner with the expected summary lines and lets the data apply
normally; dismissing clears it; (3) a trivial synthetic change (one unrelated numeric cell changed,
nothing removed/blanked/flipped) does **not** trigger it — no false positive. Re-run against the
final calibrated thresholds and the corrected net-loss/direction-aware logic (an earlier pass had
briefly left the function body referencing the placeholder constant's old field names after the
constant itself was renamed — caught and fixed before verifying, not shipped). Full regression
suite: 55/55 (no new failures; see AGENTS.md's checklist — no `getVal()` or `XLSX.read()` call was
touched by this feature, so the alias-landmine and date-timezone-safety checks weren't required,
only the syntax check and this suite).

**Lane info added to the flip-based summary lines (2026-09-09), per Kevin.** The per-lane
`removedVvds` lines already named their own lane (`"INE: 2 of 4 sailing(s) lost their schedule
data"`), but the flip-based lines (POL→`"NO N.A. CALL"`, POL back off it, Cutoff/ETD blanked,
Cutoff/ETD filled in) aggregated across every affected VVD into one count with no way to tell
which lane(s) were involved without opening the raw data — easy to miss that a change touching,
say, 6 VVDs was actually concentrated in one or two lanes rather than spread everywhere. Each flip
object already carries its own `lane` (set right where `dateFlips`/`polFlips*` are built, in
`diffScheduleChange`, immediately after `collapseRowsByVvdForDiff`), so this only needed a small
`laneList(flips, cap)` helper — a deduped, sorted, comma-joined list of each line's distinct
lanes, truncated past 6 with a trailing `"..."` the same way the existing VVD list already
truncates past 3 — appended to each of the four flip-based lines. Verified live (same
`old_baseline.csv`/`new_big_change.csv` fixtures as the original feature): the banner now reads
`... flipped to "NO N.A. CALL" (FOWT0529S, FOWT0530S) -- lane(s): AN2` and
`6 Cutoff/ETD value(s) went from populated to blank -- lane(s): AL5`. Full regression suite
re-run clean (55/55).

## `tableData` pol/yard aggregation gap (2026-09-08, defensive fix, Class A)

Found while re-investigating the MAR/`NLAT0668E` "NO N.A. CALL" report above (see that section's
motivating case) — two agents dug into whether the app itself was hiding a real N.A. port behind
its aggregation. The actual discrepancy turned out to be the live feed genuinely changing intraday
(not this), but the investigation surfaced a real, separate latent bug: `tableData`'s per-VVD
rollup (`numerics`/`maxes` field lists, see the "Class A" fixes earlier in this doc for the same
pattern with `broken`/`curLaden`) never listed `pol`/`yard`, so a multi-leg VVD defaulted to plain
first-leg-wins for those two fields. If a VVD's FIRST raw row happened to be blank/`"NO N.A.
CALL"` and a LATER leg carried a real port, the aggregated (Booking Flash/Detail) row would keep
showing `"NO N.A. CALL"` forever, silently dropping the real value from the later leg.

**Confirmed currently dormant, not the cause of the MAR report**: as of the fix, no live VVD has
legs that actually disagree this way, and neither Booking Flash/Detail nor the Compare/slicer
code paths read the aggregated row's `pol`/`yard` today anyway (Detail's own row-styling has no
`"NO N.A. CALL"` check at all — only POL Booking Flash does, and it reads straight from
`filteredRawRows`, one row per raw leg, never from `tableData`; Compare and the Yard slicer's
options both key off `rawRows`/`oldRawRows` too). Fixed anyway, on principle, so it can't bite
silently if a genuinely mixed-leg vessel ever appears, or if a future feature starts reading
`tableData`'s `pol`/`yard` directly.

**Fix**: added a "first REAL (non-blank, non-`"NO N.A. CALL"`) value wins" rule for `pol`/`yard`
in `tableData`'s accumulate branch (the `else` branch, right after the existing `maxes`/
`curUtilRaw` handling) — if the currently-aggregated value is blank or `"NO N.A. CALL"` and the
next leg's value is real, adopt the real one; otherwise leave it alone. A vessel where every leg
genuinely has no N.A. port still correctly aggregates to `"NO N.A. CALL"`.

**Verified**: pulled the real aggregation loop straight out of the app file (not a
re-implementation — the exact code between `const aggregatedMap = {}` and the closing
`filteredRawRows.forEach`'s `});`) and ran it in Node against a synthetic 2-leg VVD, in both leg
orders (real-port-first and real-port-second) — the aggregated row shows the real port either
way. A third synthetic case (both legs genuinely `"NO N.A. CALL"`) confirms it still aggregates to
`"NO N.A. CALL"` rather than always preferring some default. Full regression suite re-run clean
(55/55) after the change; no `getVal()`/`XLSX.read()` call touched, so the alias-landmine and
date-timezone-safety checks weren't required.

## "Peak Utiliz %" 100x inflation on low-peak vessels (2026-09-09)

Kevin flagged, via screenshot, Booking Flash/Detail showing **300%** for VVD `FOWT0531S` (Lane
AN2, Sale Week 2026/W46), then narrowed it further: "it seems other lanes are having the same
issue on the same week" — the observation that broke the case open, since it ruled out anything
tied to one Lane or one field-mapping.

**Root cause**: `peakUtilRaw` (`getVal(['Measures Peak Overall Utilz'])`) is a per-POL-leg figure
that `tableData` MAXes across a VVD's legs, sharing the generic `maxes` list (`maxLdn`, `bsaTeu`,
`bsaWgt`, `rfrBsaPlugs`, `rfrBsaTeuRfMax`) that compares every field with `toNum()`
(`parseFloat(String(val).replace(/[,%()]/g, '')) || 0`) — which strips a `"%"` suffix. Harmless for
the other fields (plain TEU/weight, never had a `"%"`); for `peakUtilRaw` it silently turned
`"3%"` into the bare number `3`. `getPeakUtilPercentNum()` (added 2026-09-04 for a related but
distinct bug — see its own comment in the file) is the only thing that decides "already
percent-scale" vs. "raw fraction needing ×100", and it decides almost entirely on whether the
string has a `"%"` — a bare number in `(0, 5]` is assumed to be a fraction and multiplied by 100.
Losing the `"%"` during aggregation manufactured exactly that bare-small-number input downstream,
turning a real 3% into a displayed 300%. Vessels above 5% were never affected (that heuristic's
"else, already percent-scale" branch returns a bare number unchanged either way) — which is why
this only ever hit low-utilization vessels, and why it clustered around one far-future Sale Week:
peak utilization sitting at or under 5% is simply common that far out on the booking horizon,
across many otherwise-unrelated lanes, not tied to any one of them.

**Fix**: pulled `peakUtilRaw` out of the shared `maxes` list (both branches) and gave it its own
line that compares legs via `getPeakUtilPercentNum()` instead of `toNum()`, storing the running
max back as a percent-suffixed string (`` `${n}%` ``) instead of a bare number — so the existing
downstream `getPeakUtilPercentNum(row.peakUtilRaw)` call always sees a `"%"` and takes its
"already percent-scale, trust it" branch, instead of re-guessing on a value that had already been
resolved once.

**Verified three ways**: (1) the real aggregation loop extracted out of the file (not a
re-implementation) run in Node against a matrix of synthetic cases — single low-value leg, two
legs at different magnitudes in both orders, a blank leg mixed with a real one, both legs blank, a
genuine bare-fraction raw input (`"0.06"` → 6%, confirming the *first*, correctness-critical parse
of a truly ambiguous value is untouched), and mixed low/high legs (confirming MAX still picks the
real high value) — all passed. (2) The real `FOWT0531S` legs (`"3%"`/`"3%"`) through that same
extracted code now aggregate to `3%`, not 300%. (3) **Live, end-to-end, before-vs-after**: served
the pre-fix and post-fix app side by side, loaded the SAME live CSV pull into both via a real file
input, and scraped Booking Flash/Detail's entire rendered table from each — **37 VVDs across 20
different lanes** were inflated in that day's live pull, every one by exactly 100x (`FOWT0531S`
300%→3%, `CGBT0016E` 400%→4%, `PIXT1005E` 500%→5%, etc.); 261 other unaffected (non-zero, >5%) rows
were spot-checked byte-for-byte identical old vs. new. Full regression suite re-run clean (55/55).

## Draggable popups: Analyze, Historical Data, Settings (2026-09-09, new feature)

Per Kevin/MKG: the "Service Lane Performance Summary"/"POL Performance Summary" modal (opened via
the "🚢 Analyze" button) needed to be draggable, so it can be moved aside while still comparing its
numbers against the underlying table — the actual motivating use case is cross-checking the
modal's calculations against the raw table data without having to close and reopen it repeatedly.

**Drag mechanics**: `analysisModalPos` (`useState({x: 0, y: 0})`) is a pixel offset applied as a
CSS `transform: translate(...)` on the modal box itself (the backdrop still centers it via flex —
this just nudges it away from center). `startAnalysisModalDrag`, wired to the pink header bar's
`onMouseDown`, follows the exact same window-`mousemove`/`mouseup` pattern already used by every
column-resize handle in this file (see `startColResize`/`makeColResizer`) — no new pattern
introduced. The close (×) button stops its own `mousedown` from bubbling to the header so clicking
it can never accidentally start a drag. Position resets to `{0, 0}` in `closeAnalysisModal`, so the
modal always reopens centered rather than wherever it was last dragged to.

**The backdrop's dark tint was removed as part of this fix, not left as-is**: the backdrop
(`fixed inset-0 bg-black/50 ...`, click-to-close) used to dim the ENTIRE viewport at 50% opacity
regardless of where the modal box itself was — so dragging the modal aside moved the box, but
everything behind it, including the exact table data Kevin wanted to compare against, stayed
dimmed. That defeats the actual point of dragging it in the first place. Fixed by dropping
`bg-black/50` from the backdrop's classes entirely.

**Click-outside-to-close was then removed too, same day, follow-up fix**: even once invisible, the
backdrop was still a real `fixed inset-0 z-50` element sitting in FRONT of the table (that's what
"click anywhere on it closes the modal" requires) — so a click aimed at a table row underneath hit
the invisible backdrop first and closed the modal instead of reaching the row, an accidental close
Kevin hit directly while trying to use the very feature this was built for. Fixed with
`pointer-events-none` on the backdrop (the modal box opts back in with `pointer-events-auto`, since
`pointer-events` is inherited) so a click outside the modal now passes straight through to
whatever's actually underneath, instead of hitting the backdrop at all. Closing is now ONLY the ×
button or the "Close Analysis" button at the modal's own bottom — no click-outside path exists
anymore, by design, not as a bug.

**Verified live** (Playwright, real live data, real drag via `mouse.down()`/`mouse.move(steps=10)`/
`mouse.up()` on the header, not a synthetic event): modal moves by exactly the dragged pixel delta;
clicking a table cell or an empty corner no longer closes the modal (it used to, pre-follow-up-fix);
clicking a slicer button (e.g. a Lane chip) underneath the backdrop's footprint genuinely toggles
it — confirmed by its class list actually changing, not just "the modal failed to close" — proving
clicks pass all the way through, not just no-op; both the × button and the bottom "Close Analysis"
button still close it correctly after a drag; reopening re-centers it (doesn't remember the last
dragged position); the backdrop's computed `background-color` is `rgba(0, 0, 0, 0)`, confirmed fully
transparent; a full-page screenshot after dragging shows the underlying table rendering at full,
undimmed color where the modal used to sit. Full regression suite re-run clean (55/55).

**Extended to every other popup, same day, per Kevin**: "make all the pop up windows draggable
and with the same behavior as the analyze tab." This app has exactly three closable popups total
(confirmed by grepping every `aria-label="Close ..."` close button in the file) — Analyze (above),
the "🗓️ Historical Data" panel, and the "⚙️ Settings" panel. The drag mechanic itself was pulled
out into a shared `makeDragHandler(pos, setPos)` factory (same window-`mousemove`/`mouseup`
pattern as before, just written once instead of three times) so all three popups share one
implementation. Historical Data and Settings are a different shape than Analyze, though — each is
a small `position: absolute` popover anchored under its own toggle button (`right-0 top-full`),
not a `position: fixed`, viewport-centered modal with a backdrop — so unlike Analyze, neither ever
had a backdrop dimming the page or a click-outside-to-close to remove; clicking elsewhere already
left the rest of the page alone (confirmed by grepping for any document-level outside-click
listener tied to either popup's own `*Open` state — none exists, only an existing Escape-key
listener on each, left untouched since it was never the problem here). The only real gap was the
drag itself, added the same way: a `historicalDataPos`/`displaySettingsPos` offset applied as a
`transform` on top of each popover's normal anchored position, with its header bar wired to
`makeDragHandler`. Position resets to `{0, 0}` via one `useEffect` keyed on the popup's own `*Open`
flag (rather than at each individual close call site) since Historical Data specifically has FOUR
ways to close (Escape, its own × button, the toggle button, and `compareHistoricalDates` calling
`setHistoricalDataOpen(false)` automatically after a compare) — one effect covers all of them
without having to find and edit every site.

**Verified live**: dragged both popups by a known pixel delta and confirmed their bounding boxes
moved by exactly that amount; closed each via its own × button and confirmed it still works after
a drag; reopened each and confirmed it returns to its original anchored position, not wherever it
was last dragged to; a full-page screenshot with both popups dragged out over the middle of the
table shows both rendering completely, un-clipped (rules out an `overflow: hidden` ancestor
clipping a dragged-away `position: absolute` element, a real risk this pattern has that the
`position: fixed` Analyze modal doesn't). Full regression suite re-run clean (55/55).

## Compare tab: green/red "What Changed" values (2026-09-09, new feature)

Per Kevin: on the Compare tab's "Notable Vessel Changes" table, the NEW value in each
`Label: old → new` line should render green for an increase and red for a decrease — but only for
**Current Laden** and **Vessel Utilz**. Max Laden, Peak Utilz, and the text fields (Status, PIC,
Vessel) stay plain, by explicit request ("Not worried about the other fields ie. Peak Utilz").

**Implementation**: `compareData`'s diff-building step (`TRACKED_FIELDS.filter(...).map(...)`,
right after `identity()`) already computes `fieldVal(oldRow, f)`/`fieldVal(newRow, f)` — the same
rounded numbers used to decide whether a field changed at all — so each diff object now also
carries `colorable` (`true` only for `curLaden`/`curUtilRaw`'s field keys) and `increased`
(`newNum > oldNum`) alongside the existing `label`/`oldVal`/`newVal`. Reusing those exact numbers
for direction means "did it go up or down" can never disagree with "did it change" — there's no
second, separately-parsed comparison that could drift from the first. The render (the "What
Changed" `<td>`, `row.diffs.map(...)`) wraps just the new-value half in a span that's
`text-green-700 dark:text-green-400` when colorable and increased, `text-red-700 dark:text-red-400`
when colorable and decreased, or plain (no color class) when not colorable — same green/red pair
this same tab's own KPI delta cards already use, just reused rather than a new palette.

**Verified live** (Playwright, real live data as "new", a synthetically edited copy as "old"
uploaded via the Compare tab's own "Upload Old Data File" button — the same `oldRawRows` path the
Historical-snapshot-pair picker also feeds, not a separate code path): a VVD with Current
Laden/Vessel Utilz both increased renders both new values green; a VVD with both decreased renders
both red; a VVD with an added, deliberately large Peak Utilz change (99%→11%, a decrease) renders
that value with no color class at all — confirming the field-scoping holds even for a dramatic
change on an intentionally-excluded field, not just for small ones easy to overlook. Full
regression suite re-run clean (55/55).

## "Last checked" indicator, separate from "Last Refresh" (2026-09-09, new feature)

Kevin asked whether "Last Refresh" updates on its own when auto-refresh runs, or only when
"Refresh Now" is clicked. Traced it precisely: `lastRefresh` lives inside `applyCsvText`
(and `processFile`), called unconditionally by `handleManualRefresh` on every click, but only
conditionally by the background poll (`checkForUpdates`) — that poll fetches every
`POLL_INTERVAL_MS` regardless, but only calls `applyCsvText` (via `applyPendingUpdate`, when
Auto-Refresh is on) when the fetched text actually differs from what's already loaded. So
auto-refresh genuinely does update the timestamp on its own, but only at the moment it finds a
real change — a quiet live Sheet between edits can leave "Last Refresh" sitting still for many
polls in a row even though the app is faithfully checking the whole time, which reads exactly
like "auto-refresh stopped working" even though it hasn't.

**Fix**: a second, independent `lastChecked` state that moves on every SUCCESSFUL fetch, whether
or not the data changed — set once, inside `fetchCsvText` itself (right after confirming
`res.ok`, before returning the text), so every caller (the initial-load effect, the background
poll, and manual `handleManualRefresh`) gets it for free with no duplicated `setState` calls at
each call site. Rendered next to "Last Refresh" in the header, deliberately smaller/lighter
(`text-xs text-gray-500`) as secondary info, not a second headline: `Last Refresh: <date/time>
(last checked: <date/time>)`. Manual file uploads (`processFile`) do NOT touch `lastChecked` —
that path never talks to the live Sheet at all, so "checked" doesn't apply to it.

**Verified live**: after initial load, both timestamps populate; clicking "Refresh Now" against
*unchanged* data still advances "last checked" (confirming it moves independently of whether
`applyCsvText` found anything different) — the exact gap Kevin was asking about. Full regression
suite re-run clean (55/55).

## Schedule-change warning: "Full Details" popup (2026-09-09, new feature)

Per Kevin: the schedule-change warning banner's own `summaryLines` are deliberately just counts
plus a truncated VVD/lane list (see the banner's own section above) — enough for a heads-up, not
enough to actually inspect what happened. Added a "Full Details" button on the banner itself
(next to the × dismiss button) that opens an itemized popup: every VVD the diff touched, what it
was on the previous refresh, and what it is now.

**Three sections, each shown only if non-empty**:
- **Removed sailings** (`scheduleChangeWarning.removedVvds.items`) — Lane/Sale Week/VVD/Vessel
  plus its LAST known Cutoff/ETD/POL/Status before it disappeared.
- **Added sailings** (`scheduleChangeWarning.addedVvds.items`) — same columns, but the NEW
  values, since these didn't exist in the old dataset at all.
- **Flipped sailings** (`scheduleChangeFlipsByVvd`, a new `useMemo`) — regroups
  `scheduleChangeWarning.dateFlips` and `.polFlips.{toNoNaCall,fromNoNaCall}` from
  `diffScheduleChange`'s own per-field arrays into ONE row per VVD, mirroring the Compare tab's
  existing "Notable Vessel Changes" shape (`Label: old → new` lines) that Kevin already
  recognizes — a VVD flipping both its Cutoff AND its POL in the same refresh reads as one row
  with two change lines, not two separate rows. The new value is colored red when `concerning`
  (populated→blank, or flipped TO `"NO N.A. CALL"`) and green otherwise — same "bad news vs. good
  news" distinction `SCHEDULE_CHANGE_THRESHOLDS` already makes for whether a flip counts toward
  the warning firing at all, just made visible here instead of only affecting whether the banner
  shows up.

Same draggable / click-through-backdrop / explicit-close-only popup pattern as
Analyze/Historical Data/Settings (uses the same `makeDragHandler`) — for the same reason: so it
can be dragged aside while cross-checking against the live table underneath. Deliberately has no
`open && data` guard of its own on `scheduleChangeWarning` — it's rendered as
`scheduleChangeDetailOpen && scheduleChangeWarning &&` at the render site itself, so dismissing
the banner (or a later, non-significant refresh replacing it) closes this popup for free too,
with no extra effect needed.

**A real bug, caught before shipping — same known TDZ-adjacent class already documented
elsewhere in this file** (see the Historical Data Escape-handler's own comment): the
`scheduleChangeDetailOpen`/`scheduleChangeFlipsByVvd` block was first written ABOVE
`scheduleChangeWarning`'s own `useState` declaration. Babel Standalone's in-browser transform
doesn't throw a TDZ error for this (unlike Node's `@babel/core` with the identical preset, which
DOES throw — confirmed directly, both ways, as part of tracking this down) — it silently reads
`scheduleChangeWarning` as `undefined` at that point in every render, so `scheduleChangeFlipsByVvd`
computed `[]` forever regardless of the real data. Symptom, live: the "Removed sailings" section
rendered correctly (doesn't depend on the misplaced `useMemo`) while "Flipped sailings" silently
never appeared, with zero console/page errors either way — exactly the "looks like a syntax check
would catch this, it won't" trap AGENTS.md's own required-checks list warns about. Fixed by moving
the whole block to right after `scheduleChangeWarning`'s declaration, matching the established
"MUST live after its own useState" convention already documented for `historicalDataOpen`.

**Verified live**: after the fix, both "Removed sailings" and "Flipped sailings" render with real
data (against the same `old_baseline.csv`/`new_big_change.csv` fixtures); the flip table's colored
spans show red for the concerning direction (`POL: USHOU01 → NO N.A. CALL`); the popup drags by
the exact dragged delta; clicking a table cell underneath does NOT close it (click-through
backdrop, same as the other three popups); the × button closes it; dismissing the underlying
banner closes the still-open detail popup too. Full regression suite re-run clean (55/55).

## Auto-Refresh OFF reminder banner (2026-09-09, new feature)

Per Kevin: "don't want anyone to forget they turned it off." Auto-Refresh (the Settings popover
toggle) defaults on, but once someone turns it off, nothing on screen said so afterward except
that same toggle, buried inside a popover nobody has a reason to reopen — easy to forget it's
off and keep trusting a report that's quietly stopped applying newly detected changes on its own
(manual "Refresh Now" still works regardless; this is specifically about the *automatic* path).

**Fix**: a new banner, `!autoRefreshEnabled && isCsvSourceConfigured() && rawRows.length > 0`,
placed first in the banner stack (ahead of `autoFetchError`/`sectorFetchError`) since it's a
standing state rather than a one-off event. Two things distinguish it from every other banner in
this file, both deliberate:
- **No dismiss (×) button.** Every other banner here (schedule-change warning, historical-
  viewing) has one; this one doesn't, on purpose — the entire point is that it should NOT be easy
  to make it go away without actually addressing it. It only disappears once Auto-Refresh is
  genuinely back on, either via its own "Turn On" button or the Settings toggle.
- **Does NOT hide while `viewingHistoricalDate` is set**, unlike `newDataAvailable`/
  `scheduleChangeWarning` just below it (which hide because they're about a specific live-refresh
  *event* that a historical view isn't affected by). Auto-Refresh being off is still true, and
  still worth knowing, the moment someone clicks "Back to Live" — so it stays visible regardless
  of which snapshot is currently on screen.

Same yellow "heads-up, not a hard failure" treatment as `autoFetchError`/`sectorFetchError`
(`bg-yellow-50 border-yellow-400 text-yellow-800`) — this isn't an error, just a state worth not
forgetting. Its own "Turn On" button is a convenience shortcut straight to `setAutoRefreshEnabled(true)`,
the same setter the Settings toggle itself calls.

**Verified live**: hidden by default (Auto-Refresh starts on); appears immediately after toggling
it off from Settings; persists across tab switches (confirms it's not scoped to one tab); its own
"Turn On" button flips `autoRefreshEnabled` back to true, the banner disappears, and the Settings
popover's own toggle reflects the change too (confirming both surfaces share the same state, not
two independent copies of it). Full regression suite re-run clean (55/55).

## MKG PIC slicer, plus a filter-panel layout pass (2026-09-09, new feature)

Per Kevin: add an "MKG PIC" slicer alongside the existing SPC Analyst one, "going to take some
rearranging to make it fit" — with two of his own suggestions for finding the room (shrink the
button widths, and/or move "Clear Filters" out of the way).

**The data side is a straight mirror of SPC Analyst, reading the other half of the same
string**: `row.pic` is a combined `"SPC / Mktg"` string (e.g. `"Ryan T / Alex"`) that SPC
Analyst already splits at `/` and reads index 0 from. MKG PIC reads index 1 instead —
`availableMktgAnalysts`, `selectedMktgAnalysts`, `matchMktgAnalyst`/`validMktgAnalysts` inside
`filteredRawRows`'s `useMemo`, and the Compare tab's `matchesSlicers`, all copy SPC Analyst's own
shape and logic exactly, including its loose "substring anywhere in the whole `pic` string"
match convention (not isolated to just the split Mktg half) for identical filtering precision
between the two. `clearSlicers` resets it too.

**The layout side took both of Kevin's own suggestions, not just one**:
- **Clear Filters moved from an absolutely-positioned top-right corner to a plain bottom-right
  row**, alongside the "Alt+Click to multi-select" hint it was already paired with. This wasn't
  just cosmetic — the old absolute positioning reserved a permanent `pr-24` (96px) gutter out of
  the wrapped slicer row's own width on every render, whether or not anything was actually
  wrapping near it; moving it below hands that width back to the slicers.
- **SPC Analyst's buttons shrank from `w-[70px]` to `w-[58px]`** (the longest real codes, "Ryan
  H"/"Ryan T", still fit) — freeing more room in the same wrapped row for MKG PIC's own
  `w-[58px]` buttons right after it.
- The whole slicer group (Sub Trade/Coast/SPC Analyst/MKG PIC) is one `flex flex-wrap` — no
  manual layout math was needed to make MKG PIC "fit": if the viewport's too narrow for it to sit
  on the same visual line as the others, it simply wraps to its own line below, same as any of
  the other slicers already do at a narrow enough width. Confirmed live at 1700px width: SPC
  Analyst's 9 buttons fit on the Sub Trade/Coast row, and MKG PIC's 3 buttons land cleanly on
  their own line directly under it, inside the same slicer panel box — not a separate,
  disconnected block.

New color: `bg-[#8064a2]` (purple) — every other slicer's hex was already taken (`#a9d08e`
green/Sub Trade, `#c00000` red/Coast, `#ed7d31` orange/SPC Analyst+Yard, `#E5007D` brand pink/
Lane, `#555555` gray/Sale Week, `#DA9694`/`#ffc000`/AP Status).

**Verified live**: MKG PIC's 3 buttons (`Alex`/`Bob`/`Marissa`, today's live data) render with
the right values; clicking one narrows the Detail table from 471 to 209 rows — cross-checked
independently against the raw CSV (not the app's own DOM, to rule out testing my own
implementation's assumptions back at itself): 443 real data rows + 28 lane-divider blank rows =
471 before, 196 matching rows + 13 divider rows (only lanes with an Alex vessel still have one)
= 209 after, an exact match both times; Clear Filters restores the original 471 and clears MKG
PIC along with every other slicer; a screenshot at 1700px shows the new layout with SPC Analyst
and MKG PIC clearly fitting inside the same panel box, Clear Filters relocated cleanly to the
bottom-right. Full regression suite re-run clean (55/55).

## POL Analyze modal: Max Laden/Peak Utilization scope fix, plus Compare tab's "Vessel Utilz" aggregation fix (2026-09-09, Class I)

Kevin: "The Analyze button for the Booking Flash tab is relative to the overall max laden. The
Analyze button for the POL Booking Flash tab is also relative to the overall max laden. It should
be relative to the POL Max Laden." Then, separately: "Can [we] look for more of these kind of
errors?" — answered by running 4 parallel investigation agents (2 on the reported bug specifically,
2 sweeping the rest of the app for the same shape) before touching any code. See Class I above for
the general pattern this turned out to be.

### Bug 1: POL Analyze modal's per-POL breakdown cards

`serviceLaneAnalysis`'s `groupBy(fieldKey)` (the function behind both "Service Lane Performance
Summary" and "POL Performance Summary" — same modal, `groupKey`/`groupLabel` just switch between
`'lane'`/Lane and `'pol'`/POL depending on which tab opened it) always read the raw `maxLdn`
("MCT Max Laden Update", genuinely vessel-wide — identical across every POL leg of the same VVD)
for its Max Laden tiles, and `peakUtilRaw` ("Measures Peak Overall Utilz", same vessel-wide scope)
for its Peak Utilization tile — even inside the `fieldKey === 'pol'` branch, where the
POL-specific `polMaxLdn`/`peakPolUtilzRaw` were the fields actually meant for that grouping.

**Live-data proof** (fresh pull, 974 rows, 27 multi-POL lanes, 81 POL buckets): **17 of 27
multi-POL lanes showed every POL card under that lane with a byte-identical Avg Max Laden** —
impossible for genuinely different ports. Lane EC4 (`USHOU05`/`USMOB01`): both showed **2,359.64**
pre-fix; correctly **1,738.21** / **621.43** post-fix. Cross-checked against POL Booking Flash's
own independently-computed `polBkgUtilzRaw` ("Current Laden Utilz %"): the fixed ratio-of-averages
now lands within **~1 point on average** of that field across all 81 buckets, vs. **~23 points**
off pre-fix.

**Fix**: `groupBy` now picks `maxLdnField`/`peakField` (`polMaxLdn`/`peakPolUtilzRaw` vs.
`maxLdn`/`peakUtilRaw`) based on its own `fieldKey` parameter, not `activeTab` — this matters
because `groupBy` is called twice: once as `groupBy(groupKey)` for the tab's own breakdown cards
(this is what needed to change), and always a second time as the explicit `groupBy('lane')` to
build `laneSummaries`/"Overall Snapshot"/the trend chart, which stays Lane-wide on BOTH tabs by
design (see the in-UI caption: "these per-POL capacity figures don't sum to the Overall Snapshot
above — that total is computed by Lane, not by POL") — branching on the parameter rather than the
tab means that second call is untouched automatically, no extra conditional needed. Kevin's own
wording ("ALSO relative to the overall max laden," contrasting POL Booking Flash's Analyze against
Booking Flash's, which he didn't object to) and his screenshot's circles (on the per-POL cards, not
Overall Snapshot) both confirm Overall Snapshot staying Lane-wide was the right call, not an
oversight to also fix.

**Label change, not a redesign**: a second investigation (specifically tasked with checking
whether the fix needed a layout change, or Kevin's "unless it doesn't need to be changed" applied)
found one real, demonstrable gap once the numbers were correct — "Overall Snapshot" a few inches
above the POL breakdown cards uses the exact same unqualified "Avg Max Laden"/"Avg Peak
Utilization" text for the Lane-wide number, so a viewer had no visual cue the scope had changed
underneath an identical-looking label. Fixed with a 2-word conditional label (`groupLabel ===
'POL'` → "Avg Wkly **POL** Max Laden"/"Avg Peak **POL** Utilization"), the same conditional-label
pattern the modal's own title already uses. Nothing else about the layout changed — confirmed via
side-by-side screenshots (before/after, both saved this session) that the rest of the modal (Sale
Week selector, Overall Snapshot, trend chart, the other 2 card fields) reads identically well
either way.

### Bug 2: Compare tab's "Vessel Utilz" diff

A parallel sweep of the rest of the app (Compare tab, Trade Summary, Sector Summary, plus a
full-file pass over every other known Lane-vs-POL field pair) found one more real instance, a
different shape of the same class: Compare's `compareData` (rows are deliberately per-`(VVD,
POL-leg)`, see its own comment near `keyOf`) reads `curUtilRaw` ("Vessel Utilz") straight off one
leg's raw row. That's a genuine per-leg fragment, not a repeated whole-vessel value — `tableData`
already knows this (it SUMs `curUtilRaw` across a VVD's legs, the 2026-09-03 fix) — but Compare
bypasses `tableData` entirely and never adopted that aggregation.

**Live-data proof** (two real production pulls of the live Sheet, ~5 hours apart the same day):
replaying Compare's exact diff logic found 54 distinct VVDs with 2+ separate "Vessel Utilz
changed" rows in one comparison. Two clean false positives: `TSTT0053W` and `QUIT0020W` each had
legs shift in opposite directions (e.g. one leg 16%→15%, another 4%→5%) that Compare flagged as
"changed" twice, while the TRUE vessel-level Current Laden Utiliz % never moved at all (21%→21%
and 28%→28% respectively) — and that one correct number never appeared anywhere in Compare for
either vessel.

**Fix**: build a per-VVD aggregate map for both `curUtilRaw` (SUM via `getPercentNum`, mirroring
`tableData`'s own init/accumulate logic exactly) and, for defense-in-depth, `peakUtilRaw` (MAX via
`getPeakUtilPercentNum` — currently benign on live data, since this column happens to be
vessel-wide-constant across every real multi-leg VVD today, but would silently start
understating changes the same way `curUtilRaw` was overstating them if that ever stops being
true), computed once for the old dataset and once for the new, then read that aggregate instead
of the raw per-leg value for just these two fields (`fieldVal`/`formatFieldVal` take a new `side`
('old'/'new') parameter to pick the right map). `maxLdn` (confirmed genuinely vessel-wide-constant
on live data, no fix needed) and `curLaden` (deliberately POL-scoped here, matching POL Booking
Flash's own per-leg render, with its own POL column right next to VVD to make that scope explicit)
were both checked and left untouched.

**Known, accepted trade-off**: a VVD's leg rows are still diffed independently, so if the TRUE
vessel-level Vessel/Peak Utilz genuinely changed, every one of that VVD's leg rows now shows the
identical, correct diff line — once per leg, not deduplicated to a single row (confirmed live:
`HMNT0055W`'s real 21%→18% change now shows correctly and identically on all 3 of its leg rows).
Showing the same correct number more than once is a cosmetic nit; showing two different WRONG
numbers once each (the pre-fix behavior) was the actual bug, and this fixes that. The colorable
green/red "What Changed" feature (2026-09-09, above) also inherits this fix for free — its
`increased` direction for "Vessel Utilz" now reflects the true vessel-level movement too.

### Follow-up (2026-09-10): the "Overall Snapshot mismatch" flagged above was a false alarm — known sandbox flakiness, not a real bug

The item below (originally: "a separate, pre-existing issue found, not yet root-caused") is
**resolved as a non-issue**. Kevin asked to look into it; root-caused and closed out the same
day.

**What it looked like**: the regression suite's `Analyze_POLBookingFlash` suite has a check,
"Overall Snapshot matches Booking Flash tab's Overall exactly (same filter, same by-lane
computation)," that failed with a real-looking numeric mismatch (e.g. Utilization 32%/Capacity
53,245 Booking Flash vs. 40%/54,188 POL Booking Flash on one full-suite run) — confirmed via
bisection to predate this session's two fixes, so it looked like a genuine, separate,
unroot-caused bug worth flagging rather than silently dropping.

**What it actually is**: exactly the sandbox flakiness class AGENTS.md's "Known flakiness" section
already documents and gives a protocol for — "a different check each time" on repeated full-suite
runs, resolved by a deliberate single-step check rather than more automated re-runs. Followed that
protocol exactly:
1. Re-ran the full automated suite twice more against the same fixture (`old_baseline.csv`) — each
   run failed **differently**: once with the original numeric mismatch, once with an unrelated
   "Setup: at least one breakdown card found" failure that never even reached the numeric
   comparison, alongside other suites' own "No data uploaded?" failures appearing/disappearing
   between runs — the exact "different check each time" signature that means automation timing
   noise, not a real bug (per AGENTS.md's bucket 2).
2. Confirmed with the prescribed deliberate check instead: fresh page load, click Booking Flash tab
   → open Analyze → read Overall Snapshot → close → click POL Booking Flash tab → open Analyze →
   read Overall Snapshot, nothing else running. **Ran this 3 times, same fixture: all 3 produced
   byte-identical, MATCHING Overall Snapshot values between the two tabs** (40% / 54,188 / 21,584 /
   -32,604 every time) — the two tabs' `groupBy('lane')` computation is correct and consistent;
   there is no real cross-tab data mismatch.

The earlier candidate theory (the AP-status field ternary, `activeTab === 'pol_booking' ?
row.loadingStatus : row.status`, admitting different rows per tab) was checked and ruled out
directly: `selectedApStatuses`/`selectedYards` (the only two tab-conditional filters in
`filteredRawRows`) both default to `[]` and are never touched by any suite before this one runs,
so their tab-conditional branches are provably no-ops under every scenario the regression suite
actually exercises. A second theory (the Analyze modal's shared `analysisShowAllWeeks`/
`analysisSelectedWeeks` state leaking from an earlier suite's "click All" into this one) was also
checked and ruled out: `closeAnalysisModal` explicitly resets both back to default on every close
(confirmed reading the code, line ~3065), so there's no state to leak between suites in the first
place. **No fix was needed — the app was already correct.**

### Verification

- Syntax check (Babel transform + `node --check`) on both the app file and the updated
  `tests/booking_flash_regression_tests.js` — clean.
- Live Playwright verification against real production data for both fixes: POL Analyze modal's
  EC4 breakdown cards now show genuinely different, correctly-labeled Max Laden values (no longer
  byte-identical); Compare tab no longer shows a "Vessel Utilz" row for `TSTT0053W`/`QUIT0020W`
  (the confirmed false positives), while `HMNT0055W` (a real change) still correctly shows the
  true aggregated value on every one of its leg rows.
- `readAnalysisModal()`'s test helper (`tests/booking_flash_regression_tests.js`) needed a small
  update: its `getVal('Avg Wkly Max Laden')` lookup matched on the label as one contiguous
  substring, which the new conditional "POL" qualifier breaks (`"Avg Wkly POL Max Laden"` no
  longer contains `"Avg Wkly Max Laden"` as a substring) — changed to match on `'Max Laden:'`
  instead, still unambiguous among a card's 4 rows.
- Full regression suite: repeated runs land at 33-39/36-42 depending on the run (this suite's
  own documented pre-existing flakiness under this sandbox's automated-Playwright harness, see
  "Testing" below) — **every failure observed reproduces identically on the unmodified pre-fix
  code** (confirmed via the same stash/rebuild/re-run bisection used for the Overall Snapshot
  finding above): the sandbox's known inability to reach `SECTOR_DATA_CSV_URL` (Sector Summary
  setup), one timing-sensitive Departed-star check (`weeksChecked: 0`), and the Overall Snapshot
  cross-tab check (later confirmed, see the follow-up above, to be this exact same flakiness
  class rather than a real bug — a deliberate isolated check passes cleanly every time). No new
  failure was ever observed on the post-fix code that didn't also reproduce pre-fix.
- No `getVal()` alias or `XLSX.read()` call was touched by either fix, so the alias-landmine and
  date-timezone-safety checks weren't required per AGENTS.md's checklist.

## Clear Filters vs. MKG PIC overlap, fixed for good (2026-09-11, bug fix)

Third round of the same fight, documented above in "MKG PIC slicer, plus a filter-panel layout
pass (2026-09-09)": that entry moved Clear Filters from an absolutely-positioned top-right corner
to a plain in-flow bottom-right row specifically to stop it reserving a permanent gutter over the
new MKG PIC slicer. Sometime on 2026-09-10, per Kevin, it was moved back to an absolutely-
positioned top-right corner (not written up in this file at the time — only in the code comment
at the change site) — which quietly re-introduced the exact overlap the 2026-09-09 move existed
to prevent. Kevin caught it via screenshot on 2026-09-11: at his window width, the "Clear Filters"
button and its "Alt+Click to multi-select" caption sat directly on top of the MKG PIC slicer
row's right edge (`ALL`/`Alex`/`Bob`/`TBA` partially obscured).

**Root cause**: `position: absolute; top: 2px; right: 2px` doesn't reserve space in the
surrounding `flex flex-wrap` layout — it floats over whatever the in-flow content happens to
render underneath it. Since MKG PIC (added 2026-09-09) is the last slicer group in that wrapped
row, at any window width wide enough for all four groups (Sub Trade/Coast/SPC Analyst/MKG PIC) to
share one line, MKG PIC's own right edge lands exactly where the absolute corner box already is.
This is a structural mismatch between two different layout systems on the same panel, not a
one-off pixel-offset mistake — no fixed `top`/`right` value is correct across every window width,
which is exactly why this has now round-tripped between "bottom-right" and "top-right" twice.

**Fix**: per Kevin's own resolution ("move it down a little and make it smaller so it fits on the
next row neatly, or make the slicer bigger"), moved Clear Filters out of absolute positioning
entirely and into the same `flex flex-wrap` flow as the slicer groups themselves — placed right
after MKG PIC, with `ml-auto` pulling it to the right edge of whichever row has room. Because it's
now a real flex item, it always reserves its own space: if a row is too narrow to fit it next to
MKG PIC, `flex-wrap` drops it cleanly onto its own next line instead of overlapping anything —
the identical graceful-wrap behavior MKG PIC's own 2026-09-09 comment already documents for
itself. This makes the fix correct at every window width by construction, not just the specific
width in Kevin's screenshot, so it can't silently regress the next time a slicer group is added or
resized. Also shrunk per Kevin's "make it smaller" ask: button `px-2.5 py-1 text-[11px]` →
`px-2 py-0.5 text-[10px]`, caption `text-[10px]` → `text-[9px]` — less width to clear before the
wrap kicks in.

**Verified live** (vendored-CDN throwaway copy per AGENTS.md's sandbox-CDN workaround, real
`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` upload, Sector Summary tab to match Kevin's
screenshot): at 1888px width (Kevin's own screenshot width) the Clear Filters button's bounding
box (`x: 1768–1855`) and the MKG PIC group's bounding box (`x: 1238–1569`) no longer intersect —
confirmed both visually (screenshot) and programmatically (`getBoundingClientRect()` overlap
check, `overlap: false`). Re-checked at 1400px and 1100px: MKG PIC wraps to its own line at each
narrower width as expected, and Clear Filters wraps right along with it, landing at the right edge
of whichever line it's on with no overlap at any of the three widths. Full regression suite: 58/58
passing (clean single run, no flakiness bucket needed). No `getVal()` alias or `XLSX.read()` call
touched, so the alias-landmine and date-timezone-safety checks weren't required.

**Same-day follow-up — simplified from `ml-auto` to a dedicated `w-full` row.** This filter panel
(Sub Trade through Yard, including Clear Filters) is one shared block of JSX rendered once
regardless of `activeTab` — only the small toggle-button box to its right (`AP Status`/`Rotation`/
etc.) switches per tab. So the `ml-auto` fix above was never tab-specific; it already applied
identically everywhere. Kevin then reported what looked like the same overlap on Trade Summary and
Booking Flash too, and asked to simplify further ("just put it down"). The `ml-auto` approach was
still correct by construction (a flex item can never render before an earlier sibling that wrapped
ahead of it — verified by re-deriving the CSS wrapping order, not just re-reading the diff), so the
most likely explanation is Kevin was looking at a deployment that hadn't picked up the first fix
yet rather than a real gap in it. Rather than spend more effort proving that, simplified to
something that removes the ambiguity outright: the Clear Filters block now sits in its own
`w-full` row (same pattern as the Lane row directly below it), `justify-end`-aligned, right after
MKG PIC. A `w-full` flex item always starts a new line — it can never share a row with any slicer
group, full stop, on any tab or window width, with no reasoning about wrap order required to
verify it. Re-verified live across **all 4 tabs** (Trade Summary, Sector Summary, POL Booking
Flash, Booking Flash) × 7 widths (1920/1888/1700/1400/1200/1100/900px) = 28 combinations, checking
Clear Filters' bounding box against every slicer group's (Sub Trade/Coast/SPC Analyst/MKG PIC/
Lane/Sales Week/Yard): 0 overlaps found. Full regression suite re-run: 58/58 passing again.

## Trade Summary table box stopping short of the window edge (2026-09-11, layout fix)

Kevin screenshotted a different "odd gap" — a red box around the empty area to the right of the
Trade Summary table, spanning from just past the `Settings` button in the tab row down through the
blank space right of the last Sales Week column. Root cause: `PivotTableViewer` (the shared
component behind both Trade Summary and Sector Summary) wraps its table in a box styled
`w-max max-w-full` — `w-max` means the box shrink-wraps to its own content's natural width
(`max-content`) rather than filling its parent, so on a window wider than the table actually needs,
the box (and its border) stops short and plain page background shows past it. The tab-bar row
above it, by contrast, **is** full-width (its own `flex justify-between` layout), so the two edges
visibly don't line up — that mismatch is the "gap."

This exact tradeoff already has a precedent, and it was a deliberate one: POL Booking Flash's own
(separate) table box uses the identical `w-max max-w-full` pattern, with an explicit 2026-09-10
comment recording that Kevin *knowingly* accepted this look there (box tracks the real columns
exactly; empty background past the box on a wide monitor is the accepted cost) after an earlier,
opposite fix (full-width box, wasted space *inside* it) had been tried and reverted. So this isn't
automatically a bug to fix the same way everywhere — it's a design tradeoff with a real precedent on
the other side, which is why this was **not** just changed silently: confirmed with Kevin first
(via clarifying question) which of the three ways to close the gap he wanted for Trade
Summary/Sector Summary specifically, distinct from POL's own already-settled choice.

**Kevin's answer: stretch the box to full width** (flip the tradeoff — empty space now shows
*inside* the bordered box, past the last real column, rather than outside it). Changed
`PivotTableViewer`'s wrapper from `w-max max-w-full` to `w-full` (the inner `<table>` itself keeps
its own natural width and stays left-aligned inside the now-full-width box — only the *box* stretches,
not the columns). POL Booking Flash's own separate wrapper (a different block of JSX, not this
component) was deliberately left untouched — that's Kevin's other, already-signed-off tradeoff, and
changing it wasn't part of this ask.

**Sector Summary turned out to need no change at all**, despite sharing the same `PivotTableViewer`:
its two tables each sit in their own immediate wrapper div with their own independent width rule —
the left table ("Average Max Laden vs Booking") in a `w-max min-w-[520px]` div, the right one
("Sector Summary") in a `flex-1 min-w-[560px]` div inside their shared `flex flex-wrap` row. The
right table's `flex-1` already stretches to consume whatever width the left table doesn't use, so
the pair together always fills the row — there was never a page-edge gap here to begin with (live-
verified: right table's box right edge sits flush with the tab-bar's own right edge, both before and
after this change). `PivotTableViewer`'s own `w-max`→`w-full` change is a no-op for both of Sector
Summary's tables, since each one's *own* wrapper div's width rule governs it before the component's
own class ever gets a say.

**Verified live** (same vendored-CDN throwaway-copy method as the fixes above, real sample data
upload, 1920px viewport): Trade Summary's box right edge moved from 1793px (table's own natural
width) to 1904px (matches the tab-bar row's own right edge exactly, gap gone) — measured via
`getBoundingClientRect()`, not just eyeballed. Sector Summary's two boxes unchanged (735px/1137px
wide respectively, same as before). POL Booking Flash's box unchanged (`w-max max-w-full`,
unaffected by this component's change since it's a separate wrapper). Full regression suite: 59/59
passing (this run also picked up PR #69's landed "Departed" star fix and its 1 new test, unrelated
to this change).

## Clear Filters moved into the tab-bar row, filter panel compacted (2026-09-11, layout change)

Same-day follow-up, per Kevin: "move the Clear Filters button next to the Historical Data button"
(screenshotted with an arrow from its then-location -- its own dedicated `w-full` row inside the
filter panel, per the entry above -- pointing at the Historical Data button in the tab bar), "and
compact the slicer menu a bit more."

**Clear Filters relocated.** It now lives in the tab-bar's own button row (`Hide Filters`/tabs/
`Historical Data`/`Analyze`/`Export`/`Settings`), as the first button in that row, immediately
before Historical Data -- a normal same-height sibling of those buttons rather than a filter-panel
resident. Restyled to match that row's shared button family (`px-3 py-1.5 text-sm font-bold
rounded-md border-black` + drop shadow) instead of the `px-2 py-0.5 text-[10px]` sizing it needed
to fit inside the slicer panel -- there's no more reason for it to be small once it's not squeezed
between slicer groups. Kept its own distinct dark color (`bg-[#374151]`) rather than adopting a
neighbor's color, since unlike Historical Data/Analyze/Settings it isn't a toggle-a-popover button
-- it's a one-shot action that clears every slicer at once, and looking visually distinct from its
popover-toggle neighbors avoids it being mistaken for one of those.

The "Alt+Click to multi-select" caption stayed behind in the filter panel (it's a hint about
interacting with the *slicer buttons*, not about Clear Filters specifically, so it belongs there
regardless of where Clear Filters itself lives) -- still its own `w-full` row, same proven
zero-overlap pattern as before, just without the button now, so the row is far shorter.

**Panel compacted.** Two small, deliberately conservative tweaks, since "a bit more" was a light
touch, not a redesign: the panel's own padding `p-2` → `p-1.5`, and the gap between each slicer
group (Sub Trade/Coast/SPC Analyst/MKG PIC/Lane/Sales Week+Yard) `gap-x-4 gap-y-2` →
`gap-x-3 gap-y-1.5`. Content and click targets are unchanged -- only the whitespace around them
shrank. Combined with Clear Filters' row leaving entirely, the panel is visibly shorter without
losing any content or clickable area.

**Verified live** (same vendored-CDN method, real sample data, all 4 tabs × 7 widths = 28
combinations): Clear Filters found immediately adjacent to Historical Data on every tab/width
(same `y`/`bottom` coordinates, right edge within 40px of Historical Data's left edge — i.e. truly
"next to" it, not just "somewhere in the row"), the "Alt+Click to multi-select" hint still present,
and — re-running the same overlap check used for the two prior Clear Filters fixes above — zero
overlaps against any slicer group anywhere. Screenshots confirmed visually at 1920px and 1200px
(the panel wraps MKG PIC to its own line at 1200px as before; Clear Filters/Historical Data stay
paired in the tab-bar row regardless). Full regression suite: 59/59 passing.

## Sub Trade/MKG PIC slicer reorder (2026-09-11, layout change)

Same-day follow-up, two requests in quick succession: "move the sub trade down there for all the
tabs" (screenshotted with an arrow from Sub Trade's then-position, leading the row, down to the
Lane row below it) and "and move marketing PIC up a line" (MKG PIC was wrapping to its own second
line by itself in that same screenshot, below Sub Trade/Coast/SPC Analyst).

Both requests turn out to be two effects of the same one change: the four groups in this row
(Sub Trade, Coast, SPC Analyst, MKG PIC) share one `flex flex-wrap` line, and flex-wrap places
items strictly in DOM order — whichever item no longer fits wraps to the next line, and Sub Trade
(leading the row, 5 buttons + label) was eating enough width that MKG PIC (last in DOM order)
often didn't have room left to share the first line, landing on its own line 2. Reordering the DOM
so Sub Trade moves to *after* MKG PIC (new order: Coast, SPC Analyst, MKG PIC, Sub Trade) does
both at once: Coast/SPC Analyst/MKG PIC now share the row's *front* width, which is usually enough
for MKG PIC to join them on line 1 (previously it was competing with Sub Trade for that same
space); and Sub Trade, now *last* in DOM order, is the first thing to run out of room and wrap
down — landing directly above Lane, the next `w-full` row after it. No forced positioning either
direction (no `w-full` on Sub Trade, no special-casing MKG PIC) — same graceful flex-wrap behavior
this whole row has always relied on, just fed a different DOM order.

**Verified live** (same vendored-CDN method, real sample data, all 4 tabs × 7 widths = 28
combinations, measuring each group's `y` position and cross-checking every pair among Sub
Trade/Coast/SPC Analyst/MKG PIC/Lane for overlap): 0 overlaps. MKG PIC shares Coast's row (same
`y`) in 14/28 combinations — every case where the window is wide enough for all three, which is
strictly more than before this change (previously MKG PIC needed room for Sub Trade too). Sub
Trade sits below Coast's row in 22/28 combinations — every case except the very widest windows on
Trade Summary/Sector Summary, where there's enough room for all four groups on one line regardless
of order. Screenshots confirmed visually on Booking Flash at 1920px (Coast/SPC Analyst/MKG PIC
share line 1, Sub Trade alone on line 2 directly above Lane) and 1150px (Coast/SPC Analyst share
line 1, MKG PIC/Sub Trade share line 2, Lane on line 3) — matches Kevin's screenshot/arrow exactly.
Full regression suite: 59/59 passing.

**Same-day follow-up — forced onto its own line unconditionally.** The reorder above made Sub
Trade wrap down *conditionally*: correct on POL Booking Flash/Booking Flash (their panel is
narrower, competing with the per-tab toggle-button box for width, so Sub Trade usually didn't fit
on line 1 and wrapped on its own), but on Trade Summary/Sector Summary the panel is wide enough
that all four groups still fit on one line at typical widths — so Sub Trade just stayed on line 1
there, looking unchanged. Kevin caught this with a second screenshot + arrow: "you didn't move the
Sub trade slicer down for POL booking Flash and Booking Flash" — read correctly as flagging the
*inconsistency across tabs*, not a claim that the reorder had no effect anywhere (verified live
first, before touching any code again, that Sub Trade genuinely was already below Coast/SPC
Analyst/MKG PIC on both those tabs — a cropped screenshot of the live-rendered panel confirmed it).
Fixed by giving Sub Trade the same `w-full` treatment Lane already has: forced onto its own line
unconditionally now, on every tab, at every window width, never sharing line 1 with Coast/SPC
Analyst/MKG PIC regardless of how much room there is. Re-verified live across all 4 tabs × 7 widths
(28 combinations): Sub Trade sits below Coast's row and above Lane's row in all 28 — no exceptions
this time, unlike the 22/28 before. Zero overlaps. Full regression suite: 59/59 passing.

## Redundant Trade Summary/Sector Summary title removed from the tab-bar row (2026-09-11)

Same conversation, per Kevin (circled in a screenshot): "remove that sector summary title here and
the Trade Summary." The tab-bar row had a 🌐 + repeated `<h1>` ("Trade Summary"/"Sector Summary")
rendered immediately after the tab buttons whenever one of those two tabs was active — redundant
with the already-highlighted (pink) active tab button directly to its left, which already says the
same thing. Booking Flash/POL Booking Flash/Compare never had an equivalent title here, so removing
it just brings Trade Summary/Sector Summary in line with how every other tab already behaved (their
own `<h2>` title bars directly above each data table, inside the table's own pink header, are
untouched — those are legitimate table titles, not the redundant one Kevin pointed at). Verified
live: no `<h1>` reading "Trade Summary" or "Sector Summary" renders anywhere in the tab-bar row on
any tab. Full regression suite: 59/59 passing.

## Sub Trade moved out of the filter panel, into the tab-bar row (2026-09-11)

Final round of the Sub Trade saga from earlier the same day (see the "Sub Trade/MKG PIC slicer
reorder" entry above for the first two rounds): Kevin's exact words, "you didn't move the sub Trade
slicer buttons down next to the clear filers button" — the missing piece all along was *where*
"down" meant. Both prior rounds interpreted it as "somewhere lower in the filter panel, above
Lane"; this made clear it meant clear out of the filter panel entirely, down into the tab-bar row,
beside the Clear Filters button (which itself moved into that row earlier the same day — see
"Clear Filters moved into the tab-bar row" above).

**Verified the actual complaint before writing any code** (per this project's own working
practice: never report/act on a claim you've only reasoned about) — re-examined the screenshots
already sent and confirmed Sub Trade genuinely was on its own line, below Coast/SPC Analyst/MKG
PIC, consistently, on every tab. So the fix wasn't "make it move" (it already had); it was "move it
somewhere else entirely."

**Implementation**: removed the Sub Trade block from the filter panel's `PivotTableViewer`-adjacent
slicer row completely (Coast/SPC Analyst/MKG PIC now have that row to themselves, no reordering
games needed anymore). Added a Sub Trade widget to the tab-bar's right-hand button cluster,
immediately after Clear Filters (same `SlicerBtn`/`SlicerClearBtn` components and colors the filter
panel used, just relocated) — before Historical Data/Analyze/Export/Settings. That cluster's own
container changed from `flex gap-2` (never needed to wrap — five same-sized action buttons always
fit) to `flex flex-wrap items-center gap-2`, since Sub Trade's label+5 buttons are enough extra
width that a narrow window could otherwise overflow instead of gracefully wrapping; `items-center`
keeps Sub Trade's shorter toggle buttons vertically centered against its taller `px-3 py-1.5`
sibling buttons rather than top-aligned.

**Verified live** (same vendored-CDN method, real sample data, all 4 tabs × 7 widths = 28
combinations): Sub Trade's label renders exactly once on the page (confirming it's fully gone from
the filter panel, not duplicated), sits immediately adjacent to Clear Filters (same `y`, ~8px gap)
on every single combination, and zero overlaps against any remaining filter-panel slicer group
(Coast/SPC Analyst/MKG PIC/Lane/Sales Week/Yard) or against Clear Filters itself. Screenshots
confirmed visually on Trade Summary (1920px, everything fits on one tab-bar line) and POL Booking
Flash (1200px, the row wraps to two lines but Clear Filters/Sub Trade stay paired together on the
same line regardless). Full regression suite: 59/59 passing.

## Mobile-width check, and a real overflow bug found and fixed (2026-09-11)

Kevin asked to check the app at mobile width, after PR #70 (all of the above) had already merged.
This app has no CI and hasn't been explicitly designed mobile-first — it's a data-dense ops tool —
but "does it at least not visibly break" is a fair bar, so checked live at 375/390/430px (iPhone
SE/standard/Pro Max widths) across all 5 tabs, measuring `document.body.scrollWidth` vs
`window.innerWidth` (a real page-level horizontal-overflow signal, not just eyeballing screenshots).

**Found a real bug**: at every phone width, on every tab, the page's `<body>` was measurably wider
than the viewport (433px body on a 375px viewport; 433 on 390; 433 on 430) — the whole page scrolled
horizontally, and the header's "Upload File" button was visibly clipped off the right edge in a
screenshot. Root cause: the header cluster holding Last Refresh/last checked/Refresh Now/Upload
File (`<div className="flex items-center gap-3 ...">`) was the one multi-item row in this entire
app that never got a `flex-wrap` — every other row with this many items (the slicer panel, the
tab-bar row, POL's toggle-button grids) already wraps gracefully at narrow widths; this one just
overflowed instead. Fixed by adding `flex-wrap`, the same pattern used everywhere else. Verified
live: `bodyScrollWidth` now equals `innerWidth` exactly (0px overflow) on Trade Summary/POL Booking
Flash/Booking Flash/Compare at all three phone widths — the header cleanly drops to a second line
on narrow screens instead of clipping. Full regression suite: 59/59 passing.

**Found a second issue, NOT fixed (a design tradeoff, not a one-line bug)**: Sector Summary still
overflows the page at all three phone widths (576px body regardless of viewport width). Cause:
its two side-by-side pivot tables (`Average Max Laden vs Booking` at `min-w-[520px]`, `Sector
Summary` at `min-w-[560px]` — see the "MKG PIC slicer, plus a filter-panel layout pass" entry above
for why those minimums exist) can't shrink below their minimum widths no matter how narrow the
window gets, and at 375-430px there's no way to fit even one of them, let alone both side by side —
confirmed live: the first table's own last two columns are already cut off the screen edge at
375px, and the second table isn't reachable without scrolling the whole page sideways. Each
table's own box already has `overflow-x-auto` for *its own* content overflowing *itself* -- that
part works correctly; the problem is the box's own minimum width being wider than the phone
screen in the first place. Left this alone rather than guessing: shrinking those minimums would
make a 7-column financial pivot table's numbers cramped/unreadable on any screen, which may be a
worse outcome than "this one tab needs a wider screen" for a tool that's primarily used at a desk.
Flagged for Kevin to decide rather than silently choosing a tradeoff on his behalf.

## Responsive fold: Historical Data/Analyze stack, Export moves into Settings (2026-09-11)

Same-day follow-up, per Kevin: "when the screen is smaller can we fold up the Historical [Data]
and Analyz[e] into a card stack, and move the Export button into the Settings menu" — done with
two agents (per Kevin's own request), each scoped to one independent piece of the tab-bar's
right-side button cluster, then integrated/verified centrally rather than trusting either agent's
own local checks as the final word.

**Breakpoint**: Tailwind's `lg` (1024px, no config needed — the CDN JIT build ships every standard
breakpoint out of the box). Chosen because that's roughly where this row already started
crowding/wrapping in earlier testing this session. Above `lg`: pixel-identical to before every
change made today. Below `lg`: the two changes below kick in.

**Change 1 — Historical Data + Analyze fold into a vertical stack below `lg`.** Both were
independent flex children in the same row; wrapped them together in one new
`<div className="flex flex-col lg:flex-row gap-1 lg:gap-2">` and nothing else — neither button's
own markup, popover/modal internals, state, or handlers changed at all (verified: the diff is
purely the new wrapping div's open/close tags, zero lines touched inside either block). Below
`lg` this stacks them vertically (two small "cards," one above the other) instead of side by side,
cutting this piece of the row's horizontal footprint by roughly half. Trade Summary/Sector Summary
(no Analyze button — gated to `detail`/`pol_booking` tabs only) are unaffected by the stacking
itself, just get Historical Data alone in that spot as always.

**Change 2 — Export moves into the Settings popover below `lg`.** Two mirrored, inverse Tailwind
classes ensure Export is reachable in exactly one place at any given width, never zero, never two:
the standalone `Export` button gets `hidden lg:inline-flex` added to its className (hidden below
`lg`, normal at `lg`+, unchanged otherwise), and a new `Export` row was added inside the Settings
popover's content (after the Dark Mode toggle) with `lg:hidden` (the exact inverse — visible below
`lg`, hidden at `lg`+). The in-popover row reuses `exportToExcel` directly, no duplicated export
logic, and closes the popover afterward on click (`setDisplaySettingsOpen(false)`, matching this
app's existing close-after-action convention elsewhere, e.g. `setHistoricalDataOpen(false)`).

**Verified live** (vendored-CDN throwaway copy, real sample data, Trade Summary + POL Booking Flash
— the latter has Analyze, the former doesn't, so both code paths get covered): tested at 6 widths
above `lg` and below it (1920/1200/1025 vs 1023/900/700/500/390) — Historical Data/Analyze
correctly side-by-side above `lg` and stacked below it on every check; standalone Export correctly
visible above `lg` and hidden below it on every check; 0 problems out of 16 width/tab combinations
checked programmatically (not just screenshots — measured actual `getBoundingClientRect()`
positions and `getComputedStyle().display`). Smoke-tested the in-Settings Export button directly:
opened Settings at 700px, confirmed exactly one of the two Export buttons was visible
(`display:none` vs `display:block`), clicked it, confirmed no JS error and that the popover closed
afterward. Screenshots confirmed visually: side-by-side at 1920px (unchanged from before today),
stacked at 700px. Re-ran the mobile-overflow check from the entry above (same 15 tab/width
combinations) — no new overflow introduced; Sector Summary's already-flagged, unrelated overflow
is unchanged. Full regression suite: 59/59 passing.

**Known pre-existing quirk, not introduced by this change, not fixed here**: the Settings popover
(like Historical Data's and the Analyze modal's, which share the same drag-to-reposition mechanism)
renders at a `transform: translate(x, y)` offset tuned for a wide desktop layout, and can render
partially off the left edge of a narrow (~700px) viewport. Confirmed this is unrelated to today's
change (same behavior on Historical Data's own popover, untouched today) and didn't affect
functionality in testing (the in-popover Export button was still clickable via its locator even
partially off-screen) — just flagging it as a separate, pre-existing rough edge on narrow screens
for whoever next touches the draggable-popover positioning logic.

## Export button removed, folded permanently into Settings (2026-09-14)

Same-day follow-up, per Kevin: "remove the export button and move that function in the settings
menu." The 2026-09-11 change just above made Export's location conditional on screen width
(standalone button at `lg`+, inside the Settings popover below `lg`, via mirrored
`hidden lg:inline-flex` / `lg:hidden` classes). This request goes further: no standalone button at
any width — Export lives exclusively inside Settings, permanently.

**What changed**: removed the standalone `<button onClick={exportToExcel} ...>Export</button>`
(the `hidden lg:inline-flex` one, plus its explanatory comment) from the tab-bar action-button row
entirely. In the Settings popover, dropped the `lg:hidden` class from the existing Export button
(added 2026-09-11) so it's no longer conditional — same `onClick={() => { exportToExcel();
setDisplaySettingsOpen(false); }}` handler, unchanged, just always rendered now instead of only
below `lg`. No changes to `exportToExcel` itself or to any other button in either row.

**Verified live** (vendored-CDN throwaway copy, real sample data): across 5 tabs × 6 widths
(1920/1200/1024/900/700/390 — 30 combinations), confirmed exactly one `Export`-labeled button
exists in the DOM at every combination (none outside the Settings popover, i.e. no leftover
standalone button at any width). Opened Settings at 1920px (desktop) specifically — the one width
where Export used to be hidden from the popover before today — and confirmed the button is present,
visible (`display:block`, real `getBoundingClientRect()`), and clickable with no JS console errors,
closing the popover afterward same as before. Screenshot-confirmed the tab-bar row at 1920px now
reads: Clear Filters, Sub Trade, Historical Data, Settings — no separate Export button alongside
them. Full regression suite: 59/59 passing.

**Not touched, still applies**: the same pre-existing draggable-popover off-screen-at-narrow-widths
quirk noted in the entry above (confirmed again today at 390px — Export's row inside the popover
partially clips past the left edge, same as every other row in that popover, unrelated to this
change) and Sector Summary's flagged mobile-overflow issue are both unchanged and still awaiting a
decision from Kevin.

## Trade Summary/Sector Summary table boxes: back to auto-size (2026-09-14)

Reverts the "MKG PIC slicer, plus a filter-panel layout pass" entry's 2026-09-11 change to the
shared `PivotTableViewer` wrapper. That entry flipped the box from `w-max max-w-full` (shrink-wraps
to the table's real column widths) to `w-full` (always fills the panel's available width), per
Kevin's call at the time, to fix a reported "odd gap" — the box stopping short of the browser's
right edge with plain page background beyond it.

Kevin sent a follow-up screenshot of Sector Summary showing the tradeoff that `w-full` change
explicitly accepted (documented in the same 2026-09-11 code comment at the time: "empty space now
shows INSIDE the box/border, to the right of the last real column") — both pivots' boxes stretched
to the full panel width with a wide blank strip past their real columns — and asked for the tables
to auto-size on both Trade Summary and Sector Summary. That's a request for the *original*
shrink-wrap behavior back, so this is a straight revert: `w-full` → `w-max max-w-full` on
`PivotTableViewer`'s outer wrapper div (one class change, nothing else in the component touched).
This also brings Trade Summary/Sector Summary back in line with POL Booking Flash's own table box,
which has used `w-max max-w-full` deliberately since 2026-09-10 and was never touched by either
change.

**Verified live** (vendored-CDN throwaway copy, real sample data): measured actual
`getBoundingClientRect()` on both the box and its `<table>` for all three affected pivots (Trade
Summary; Sector Summary's "Average Max Laden vs Booking" and "Sector Summary") at 1920px — box
width now matches table width to within 1-2px (border rounding) on all three, vs. a large gap
before this revert. Screenshots confirm visually: no blank strip inside any of the three boxes.
Full regression suite: 59/59 passing.

**Tradeoff reinstated, same one POL Booking Flash already accepted**: on a monitor much wider than
a table's real content, that table's box (and border) now stops at its own last column again, with
plain page background beyond it, rather than stretching to the panel's full width. This is the
exact tradeoff the 2026-09-11 change existed to avoid — now deliberately back, per Kevin's own
latest call, in exchange for no blank space inside the border.

## Sector Summary's right-hand table: most slicers were silently no-ops (2026-09-14)

Bug report from Kevin, with a screenshot: "All of the slicers (except for the service lane) stopped
filtering the sector table on the Summary tab." Confirmed and fixed.

**Root cause**: the Sector Summary tab renders two pivots side by side. The left one ("Average Max
Laden vs Booking") is built from `past4WeekRows`, which derives from `filteredRawRows` -- the one
true fully-filtered dataset that every slicer (Sub Trade, Lane, Coast, SPC Analyst, MKG PIC, Sales
Week, Yard, AP Status, header filters) already flows into. The right one ("Sector Summary", the
table Kevin circled) is built from `sectorDataMapped`, which comes from a **completely separate**
data source -- `sectorSourceRows`, fed by `SECTOR_DATA_CSV_URL` / seeded by `SECTOR_DATA_SEED`
above. That source only ever carries Trade / Sub Trade / Lane / POD Sector / allocation numbers --
no Coast, PIC, Sales Week, or Yard columns exist on it at all. `sectorDataMapped`'s own `.filter()`
only ever checked `selectedSubTrades` and `selectedLanes` directly against those rows -- every other
slicer had nothing on this data source to match against, so selecting Coast/SPC Analyst/MKG
PIC/Sales Week/Yard silently did nothing to this one table while correctly narrowing every other
table on every other tab (including the pivot sitting right next to it).

**Fix**: derive the set of Sub Trade+Lane combinations that remain valid under every active slicer
by reading them off `filteredRawRows` (`` `${r.subTrade}|${r.lane}` ``) instead of re-checking
`selectedSubTrades`/`selectedLanes` in isolation, and gate `sectorDataMapped`'s rows by membership
in that derived set. Since `filteredRawRows` already combines every slicer, this one change makes
all of them apply here, without needing per-field matching logic for fields this data source doesn't
even have. Dependency array updated from `[sectorSourceRows, selectedSubTrades, selectedLanes]` to
`[sectorSourceRows, filteredRawRows]` accordingly.

**Correctness check before shipping, not just after**: this fix ties the right table's visibility to
"does this combo have a matching current booking," which is a real behavior change even for Sub
Trade/Lane specifically (previously checked directly against `sectorSourceRows`, independent of
booking volume). Verified against real data that this introduces no regression: at zero filters
selected, all 9 Sub Trade+Lane combinations in the live sector-allocation data already have at least
one matching row in `filteredRawRows` (0 orphaned), so nothing that used to show at the default
state now silently disappears.

**Verified live** (vendored-CDN throwaway copy, real sample data): row count in the right table
measured directly (not just eyeballed) before/after each slicer: Coast=EC 41→27 rows, MKG PIC=Alex
41→5, SPC Analyst=Evan 41→5, Yard~=USLAX01 41→9 -- all correctly narrowed, all previously no-ops.
Lane=AL5 41→4, confirmed still working exactly as before (no regression on the one slicer Kevin said
was fine). Clear Filters returns to the 41-row baseline every time. Sales Week checked two ways:
selecting a single week alone didn't change the count, but a direct data check confirmed every one
of the 9 combos genuinely has a booking in every week in this dataset (all lanes sail every week) --
so 41 rows staying visible is the mathematically correct result there, not a sign the fix missed
that slicer; the same shared `filteredRawRows`-derived mechanism covers it identically to Coast/SPC
Analyst/MKG PIC/Yard. Full regression suite: 59/59 passing.

## Hide Filters swapped with Compare in the tab row (2026-09-14)

Per Kevin: "move the Hide Filters button to the current position of the Compare button. I believe
this location is more central and would significantly improve the overall ease of use."

**What changed**: a straight positional swap of the two named buttons in the tab-bar row's left
group, leaving the four real data tabs (Trade Summary, Sector Summary, POL Booking Flash, Booking
Flash) exactly where they were in between. Before: Hide Filters, Trade Summary, Sector Summary, POL
Booking Flash, Booking Flash, Compare. After: Compare, Trade Summary, Sector Summary, POL Booking
Flash, Booking Flash, Hide Filters -- so Hide Filters now sits last, immediately next to Clear
Filters (where Compare used to be, and where the right-side action-button group begins), and Compare
leads the row (where Hide Filters used to be).

Also flipped the vertical-divider styling that visually sets Hide Filters apart from the real tab
buttons: it was `border-r-2 ... pr-3 mr-1` (a divider on its right, since it used to lead the tabs);
now it's `border-l-2 ... pl-3 ml-1` (a divider on its left, since it now trails them) -- same visual
intent (keep it looking like a distinct function, not a sixth tab), just mirrored to match which
side of the group it's now on. No changes to the toggle's own logic, state, or handler
(`setTopPanelCollapsed`) -- purely a JSX reorder plus that one mirrored class change.

**Verified live** (vendored-CDN throwaway copy, real sample data): confirmed the DOM order of the
six buttons reads exactly `Compare, Trade Summary, Sector Summary, POL Booking Flash, Booking Flash,
▲ Hide Filters`. Confirmed the toggle still works correctly in its new spot -- clicked it and
verified both the button's own state (text flips `▲ Hide Filters` → `▼ Show Filters`, `aria-pressed`
flips `false` → `true`) and the visual result (the whole filter/header panel above the tab row
collapses, tab row moves up to the top of the page, exactly as it did before the move).
Screenshot-confirmed. Confirmed Compare still activates correctly from its new leading position (tab
turns pink/active on click, same as always). Checked for new horizontal overflow at 1920/1024/768/390px
-- none at any width (the row's existing `flex-wrap` just wraps the extra button cleanly, same
pattern used everywhere else in this row). Full regression suite: 59/59 passing.

## Sub Trade back in the filter panel; SPC Analyst renamed to SPC PIC (2026-09-14)

Per Kevin, with a screenshot: "I'd like to get the subtrade back in the original container and
change the SPC Analyst to Space PIC to match the MKG verbiage. Plus it will free up some room more
room. maybe if it does?" ("Space PIC" read as "SPC PIC" -- matches the handwritten "PIC" arrow on
his screenshot pointing at SPC Analyst, and "MKG verbiage" only makes sense against MKG PIC.)

**Sub Trade**: reverses the 2026-09-11 move (`dbd9a20`, "Move Sub Trade out of the filter panel,
next to Clear Filters") that relocated it into the tab-bar row. "The original container" was taken
literally: restored Sub Trade to its exact pre-move shape and position in the filter panel -- same
`w-full` dedicated row (the proven pattern Lane also uses below it) and the same `w-20` label width,
inserted right after MKG PIC, exactly where it sat before that move -- rather than inventing a new
layout. Removed the version that had lived in the tab-bar row next to Clear Filters since.

**SPC Analyst → SPC PIC**: both the visible label and the per-slicer clear button's tooltip/
aria-label (`Clear SPC PIC filter`) now read "SPC PIC", matching MKG PIC's own naming. Cosmetic only
-- `selectedAnalysts`/`availableAnalysts`/`validAnalysts` and every other identifier are unchanged,
as is the `'SPC Analyst'` entry in the PIC column's header-alias list (`getVal(['MCT PIC', 'MCT Spc
Analyst', 'PIC (spc/mkg)', 'PIC', 'SPC Analyst'])`) -- that alias matches an uploaded spreadsheet's
own column header text, which has nothing to do with this app's UI label and doesn't change just
because the button does.

**"Will it free up room?" -- checked, not just assumed**: measured Sub Trade's own content
footprint (label + 5 toggle buttons) at ~344px (80px label + 248px buttons + margins) -- that's how
much horizontal space is now freed from the tab-bar row. Confirmed the practical effect: the tab-bar
row (Compare through Settings) now stays on one line down to ~1440px window width; below that it
wraps to two lines gracefully (same `flex-wrap` pattern as always, not a broken layout) -- previously,
with Sub Trade's extra ~344px still in that row, it would have needed to wrap at a wider breakpoint
than that.

**Verified live** (vendored-CDN throwaway copy, real sample data): Sub Trade's label now renders
exactly once, in the filter panel (not duplicated, not still in the tab-bar). "SPC Analyst" text is
gone from the UI entirely; "SPC PIC" renders exactly once. Both slicers still function correctly
after the move/rename -- clicked a Sub Trade button and an SPC PIC button, confirmed each applies
its `isSelected` styling and narrows results same as before. Checked for new horizontal overflow
across 5 tabs × 4 widths (1920/1024/768/390 -- 20 combinations): one overflow, on Sector Summary at
390px -- confirmed via the other 4 tabs all being clean at that same width that this is the same
already-documented, pre-existing two-side-by-side-tables issue (see the "mobile-width check" entry
above), not something today's change introduced. Full regression suite: 59/59 passing.

## Schedule-change notification: not simultaneous across users (2026-09-14)

Bug report from Kevin, with a screenshot of the "Large schedule change detected" banner and its
"Schedule Change Details" popup: notifications like this weren't reaching everyone at the same
time. He asked for the investigation to be verified using two distinct agents, not just reasoned
about.

**Root cause, found and proven live, two independent mechanisms**:

1. **Every poll ran on a per-tab clock, not a shared one.** This app has no backend of its own --
   `CSV_SOURCE_URL`/`SECTOR_DATA_CSV_URL` are public Google Sheets CSV exports, fetched
   independently by each browser tab on its own `setInterval(fn, POLL_INTERVAL_MS)`, which starts
   counting from whenever THAT tab happened to mount. Two people who open the app minutes apart
   poll (and so notice the same server-side change) up to a full `POLL_INTERVAL_MS` apart, purely
   from that load-time offset.
   Proved with two real Playwright agents (per Kevin's own request) against a local test harness:
   a vendored throwaway copy, `CSV_SOURCE_URL` pointed at a locally-served, orchestrator-controlled
   CSV, `POLL_INTERVAL_MS` temporarily shortened in the test copy only (never the real file) for a
   fast test. Agent "User A" loaded immediately; Agent "User B" loaded 15s later (a completely
   ordinary "opened their laptop a bit after a colleague" scenario). A third process (the
   orchestrating session) flipped the served CSV to a real "POL flipped to NO N.A. CALL" event only
   once BOTH agents had independently established their own baseline. Result: both had Auto-Refresh
   ON (the true default) and were looking at the identical change, yet **User A saw the banner at
   14:53:37.119Z, User B at 14:53:47.622Z -- 10.5 seconds apart** at a compressed 20s test interval,
   which scales to as much as just-under-the-full-interval (up to ~10 minutes) at the real
   production `POLL_INTERVAL_MS`.
2. **Auto-Refresh is a silently-persisted per-browser setting.** Defaults to On, but once toggled
   Off it's saved to that browser's `localStorage` and survives every future reload with no visible
   reminder. Confirmed directly: with it off, the background poll still *detects* the change
   (`newDataAvailable` flips true) but never auto-applies it, so the banner never appears no matter
   how long you wait -- only a manual "Refresh Now" click surfaces it. Anyone on the team who's ever
   flipped that switch drifts completely out of sync with everyone else's timing.

**A finding that turned out NOT to be a bug, corrected before shipping anything**: while building a
test fixture to trigger a "POL flip" event, `pol: getVal(['Route Location 1st Yard'])` (not `'Route
Location 1st Pol'`, despite the field's name) looked like a copy-paste mistake at first glance.
Investigated before touching it: the code's own existing comment right above it explains this is
deliberate -- the real `'Route Location 1st Pol'` column is coarser, collapsing distinct terminals
like `USLAX01`/`USLAX06` down to a bare `USLAX` (a previously-fixed landmine, guarded by
`tests/check_alias_landmines.py`). Verified this empirically against the real historical CSV before
concluding anything: of 971 rows checked, 898 had `Yard != Pol`, always in exactly that
collapsing-suffix direction (e.g. `Yard=USLAX01` / `Pol=USLAX`). So the current mapping is correct
and intentional; no change made here. Flagged as a false alarm to Kevin rather than "fixing" it,
which would have reintroduced a real, already-solved bug.

**Fix implemented (wall-clock-aligned polling)**: added `msUntilNextAlignedTick`/
`scheduleAlignedInterval` (near `POLL_INTERVAL_MS`'s own definition) -- instead of `setInterval(fn,
intervalMs)` counting from whenever a given tab mounted, this schedules `fn` at the next WALL-CLOCK
multiple of `intervalMs` (e.g. every 10 minutes means :00/:10/:20/:30/:40/:50 past the hour, UTC),
recomputed fresh via a self-rescheduling `setTimeout` chain after every tick rather than a single
`setInterval`, so it self-corrects for the poll's own variable run time and for browser throttling
of backgrounded tabs instead of drifting off-alignment over a long session. `Date.now()` is the same
real-world millisecond count for every user regardless of timezone, and every interval used here
(`POLL_INTERVAL_MS`, `APP_UPDATE_POLL_INTERVAL_MS`) divides evenly into an hour, so this lines up
with human-readable clock marks with no timezone math needed. Applied to all three poll sites that
shared this exact pattern, not just the one behind the banner Kevin screenshotted, since the other
two are the same bug class: `checkForUpdates` (the schedule-change banner's own poll),
`fetchAndApplySectorData` (Sector Summary's right-hand pivot -- same desync risk, just never
reported), and `checkForAppUpdate` (the "new app version" banner). The app-update site's own
pre-existing `cancelled` flag (checked inside `checkViaOwnUrl`/`checkViaVersionEndpoint`) is
unrelated to and kept alongside `scheduleAlignedInterval`'s own returned cancel function -- both
fire on unmount now.

**Verified live**: re-ran the same two-staggered-sessions test (6s apart this time, compressed to a
10s test interval) against the FIXED code -- both sessions now see the identical injected change
**51ms apart** (down from 10.5s at a similar stagger before the fix), confirmed to land on the exact
same aligned 10-second epoch boundary for both, the gap between them being pure fetch-latency
jitter, not load-time offset. Full regression suite: 59/59 passing.

**Not done (a bigger, separate decision)**: true simultaneity for everyone would need real push
infrastructure (a backend or relay telling every open tab the instant new data lands) -- this app
has never had a backend of its own, so that's a meaningfully bigger architectural change flagged to
Kevin for a separate decision, not bundled into this fix.

## Booking Flash table: VVD in hover tooltip, click-to-highlight rows, Freeze Panes (2026-09-14)

Bug report from Kevin, from a screenshot of the "Proforma Rotation"/"Actual Rotation" hover tooltip:
"When we scroll to the right of the booking flash we can't see what vessel it is that we are on."
Asked for the tooltip to show the VVD, or failing that, a way to click a row and have it stay
highlighted -- and separately asked for both, plus an Excel-style "freeze pane" option, done "with 3
agents."

**Three independent features, one coordinated implementation pass**: all three touch the same
tightly-coupled row-rendering code (`DetailTableRow`/`PolTableRow`, both `React.memo`'d for
performance -- see that memo's own big comment on why a prop must be a primitive or a stable
callback, not a fresh object/Set each render). Splitting that across 3 parallel agents in isolated
worktrees risked real merge conflicts on the same `<tr>`/`<td>` lines with no clean way to reconcile
them automatically, so this was implemented directly instead, then verified with 3 independent
Agent-tool subagents (one per feature) driving a real browser adversarially -- the same proven
pattern as the sync-fix above, applied to verification rather than implementation given the file's
shared-code constraints.

1. **VVD in the hover tooltip.** `showHoverTooltip(text)` (see its own comment, just above
   `hoverTooltip`'s `useState`) is now `showHoverTooltip(text, vvd)` -- when a `vvd` is passed, the
   tooltip text becomes `VVD: <code>\n<original text>`. Wired onto all 5 existing tooltip cells
   (Operational Issues, Sector Allocation, Proforma Rotation, Actual Rotation, Voyage Remarks) with
   that row's own `row.vvd`. The existing blank/`'*'` guard is unchanged and still governs whether a
   tooltip shows at all -- a genuinely empty cell stays silent rather than popping a VVD-only
   tooltip on every blank cell scanned across a row. Verified live: hovering a populated Operational
   Issues cell showed exactly `"VVD: FOWT0529S\n120 TEU of compensation"`, matching that row's own
   VVD column.
2. **Click a row to highlight it.** Works on both Booking Flash (`DetailTableRow`) and POL Booking
   Flash (`PolTableRow`). Click toggles a `<tr>`-level CSS outline (`outline-[3px]`, pink
   `#E5007D`) -- an outline rather than a background, because nearly every `<td>` already sets its
   own explicit background for status coloring (VMS grey, AP Frozen/AP Only, utilization-gap flags)
   that would otherwise paint over and hide a `<tr>`-level background. Multiple rows can be
   highlighted at once (state is a `Set` of `row.id`, in `FlashReportDashboard`, passed down to each
   row as a per-row *primitive* boolean -- not the Set itself, which would break the rows' own
   `React.memo` and force a full-table re-render on every single click; see the code's own comment
   for the full reasoning). "Without losing the ability to copy individual values" is enforced with
   a `window.getSelection().toString().length > 0` check in the click handler -- a click that ends a
   text-selection drag (or a double-click that selects a word) is left alone instead of also
   toggling the row. Verified live: outline toggles on/off correctly across two clicks, and a
   double-click-to-select-a-word inside a cell does NOT toggle the row's highlight.
   Deliberately NOT designed to survive a background data refresh -- `row.id` (`id: index + 1`) is
   this CSV snapshot's row position, not a stable identity for "the same real sailing leg" across
   refreshes, so a highlight can silently stop matching (or vanish) after Auto-Refresh applies new
   data. Scoped as "mark a row while I'm reading across it right now"; surviving a refresh would need
   a real content-based leg key (e.g. vvd+pol) and is a separate task if wanted later.
3. **Freeze Panes.** New toggle in ⚙️ Settings, right after Auto-Refresh, defaulting Off and
   persisted to `localStorage` (`bookingFlashFreezePanes`) the same way `autoRefreshEnabled`/
   `darkMode` are. When on, the Booking Flash tab's VVD and Vessel Name columns (header and every
   body row) get `position: sticky` pinned to the left edge while the table scrolls horizontally --
   VVD fixed at exactly 95px wide while frozen (so Vessel Name has a known, constant 95px offset to
   pin against, since this table's columns are otherwise fluid/auto-width) at `left: 0`, Vessel Name
   at `left: 95px`. Both already carry an opaque background (`getBg('bg-[#d9e1f2]', true)`), so
   scrolled-under columns don't show through underneath them -- no extra background work needed.
   Scoped to Booking Flash only for now (the tab in Kevin's screenshot); POL Booking Flash could get
   the same treatment later if wanted. Verified live: VVD header measured 662px from the container's
   left edge unscrolled; after scrolling the container 800px right, it measured 1px from the edge
   (i.e. correctly caught up and pinned), with body-row VVD/Vessel cells doing the same.

**Verification**: full regression suite 59/59 passing, plus my own direct live testing (concrete
evidence above) before committing. On top of that, 3 independent Agent-tool subagents each
adversarially re-tested one feature (dark mode, VMS/AP-Frozen row coloring, mobile width, both tabs,
multi-row highlight, toggle reversibility) -- this caught two real bugs my own pass had missed:

1. **Double-click spuriously toggled the row highlight.** The `getSelection()` guard correctly
   protects a click-and-drag selection (one click event, fired after the drag-selection already
   exists) but NOT a genuine double-click: a browser only creates the word-selection at the SECOND
   mousedown, so a double-click's FIRST click event fires with nothing selected yet and went through
   unguarded, flipping the row's highlight as a side effect of double-clicking to copy a word. Fixed
   with the standard single/double-click disambiguation pattern: the toggle is now deferred behind a
   300ms timer, cancelled outright by a new `onDoubleClick` handler on the same `<tr>` -- so a
   double-click never toggles the row at all (neither click of the pair), while a plain single click
   still toggles after a short, barely-perceptible delay. Applied to both `DetailTableRow` and
   `PolTableRow`. Re-verified live: a double-click selecting a word leaves the row's outline
   unchanged; a plain single click still toggles it.
2. **Freeze Panes only froze half the header.** The Detail table's `<thead>` has TWO header rows --
   a filter-input row (`renderFilter()`, correctly frozen on the first pass) and a completely
   separate label row (`rowSpan={2}`, the actual visible "VVD"/"Vessel Name" text + resize handle)
   that was missed entirely, so after scrolling the readable column labels scrolled off-screen while
   the (invisible) filter boxes and body data stayed correctly pinned -- a visibly broken header.
   Fixed by applying the same freeze style to the label row's VVD/Vessel `<th>` cells too, matching
   the filter row and body cells; while frozen these two columns now override any prior manual
   column-resize width with the same fixed 95px/natural-width split used everywhere else (reverts to
   honoring a resized width the moment Freeze Panes is turned back off). Re-verified live: label row
   VVD measured 662px unscrolled -> 1px after scrolling 800px right (was previously -137px, i.e.
   scrolled off-screen).

Both fixes re-verified against the full regression suite (59/59 still passing) before this was
committed; the same 2 subagents that found each bug were asked to independently re-confirm the fix.

**A "loose end" that turned out NOT to be a bug either, run to ground with 3 more agents (per
Kevin's request)**: the click-to-highlight verifier's re-check noted, almost as an aside, that
double-clicking one of the 5 tooltip-wired cells specifically didn't register a text selection
under `page.mouse.dblclick()`, while a click-and-drag or triple-click on the same cell worked fine
-- flagged as possibly a React-re-render-timing race or a Playwright/CDP quirk. Direct investigation
found the real cause fast: these cells are wide (`whitespace-nowrap`, auto-sized to the widest row's
content) but their text is left-aligned and often much narrower -- e.g. a 415px-wide cell holding
text that only renders 154px wide. Every test script (mine and the verifier's) computed the click
point as the cell's geometric CENTER, which for a cell like that lands in blank padding well past
the last character -- nothing to double-click there. Clicking at x-offsets across that same cell
(10/30/50/80/120px from its left edge) correctly selected "120"/" "/"TEU"/"compensation"/
"compensation"; offsets past the actual text (160px+) selected nothing. Pure test-coordinate
artifact, not an app defect -- a real user only ever clicks visible text, never invisible cell
padding.

3 independent agents (not counting this initial probe) stress-tested this before accepting it:
one re-confirmed it on the Operational Issues/Sector Allocation columns (6/6 real-text double-clicks
selected correctly; old cell-center coordinates reliably reproduced the "bug"), one re-confirmed it
on Proforma Rotation/Actual Rotation/Voyage Remarks (same pattern on all 3, including a
15,391px-wide Voyage Remarks cell), and one was explicitly tasked with trying to DISPROVE the
explanation -- it found a genuine control case (POL Booking Flash's own Operational Issues column,
confirmed via React fiber inspection to have zero `onMouseEnter`/`onMouseLeave` wiring at all) that
reproduces the identical center-click-fails/text-click-succeeds pattern, conclusively ruling out the
tooltip mechanism as any part of the cause; it also proved timing wasn't the cause (double-clicked
at center after a full 1s settle, tooltip confirmed rendered and non-overlapping via
`pointer-events: none`, still failed at center). All three also re-confirmed the row-highlight
outline correctly stays untouched by a real (text-hitting) double-click. No code change was needed
or made -- flagged as a false alarm, the same way the Yard/Pol mapping was earlier in this file.

## Header/filter-panel layout reorganization (2026-09-14)

Bug report from Kevin, with a screenshot annotated in red arrows: "Move the Coast and Filter
slicers down to align with the 'Hide Filters' button", "Relocate the 'Historical Data' and
'Analyze' tabs to sit below the macro buttons", "Move the Settings button up, if possible", and
"Attempt to consolidate the layout to fit the 'Sub Trade' filter up one row."

**Before**: masthead (logo/title/Last Refresh/Upload File) -> filter panel (Coast/SPC PIC/MKG
PIC/Sub Trade/Lane/Sales Week + the per-tab "macro buttons" toggle grid) -> tab bar (Compare/Trade
Summary/.../Hide Filters, and on its right: Clear Filters/Historical Data/Analyze/Settings) ->
table. Both the masthead and filter panel collapsed together via the same `topPanelCollapsed`
state/"Hide Filters" button, which lived in the tab bar BELOW the content it collapsed.

**After**, four coordinated changes to the same region:
1. **Masthead is no longer gated by `topPanelCollapsed`** -- it's now always visible (previously it
   collapsed together with the filter panel). This was a considered judgment call, not incidental:
   Settings needed to always be visible in its new position (see #3), and it can't be always-visible
   while living inside a row that sometimes collapses -- so the masthead became fully persistent
   instead. Side effect: "Hide Filters" now only ever hides the actual filter panel, matching its
   name better than before (it used to also hide the branding/refresh row).
2. **The filter panel now renders immediately below the tab bar** instead of above it -- same
   `topPanelCollapsed` state and button, only its position in the page moved, so the "Hide Filters"
   toggle now sits directly above what it toggles (previously below).
3. **Historical Data + Analyze relocated** from the tab bar's right side into the filter panel's
   right-hand box, directly below the per-tab macro-buttons grid. Accepted side effect: since that
   whole box is inside the `topPanelCollapsed`-gated filter panel, these two now collapse/show
   together with the filter panel too, instead of staying permanently visible as they did in the
   tab bar. Their `flex-col lg:flex-row` responsive fold is unchanged and untouched.
4. **Settings relocated** from the tab bar's right side up into the masthead (next to Upload File)
   -- markup/state/every control inside its popover (Zoom/Text Size/Auto-Refresh/Freeze Panes/Dark
   Mode/Export) is unchanged, only its position moved.
5. **Sub Trade's forced `w-full` own-line was dropped**, joining Coast/SPC PIC/MKG PIC's existing
   `flex-wrap` row instead of always breaking onto its own line. This is a genuine best-effort fit
   with automatic graceful wrap as the fallback (matching Kevin's own "Attempt to..." framing), not
   a guarantee it always shares the row -- verified live against the real dataset at 1920px: Coast
   (160px) + SPC PIC (635px) + MKG PIC (331px) + 3 gaps leaves ~304px free in a 1466px-wide
   container, and Sub Trade itself needs ~336px -- short by about 32px, so it wraps to its own line
   even at this wide a viewport with this particular dataset's button counts. No overlap, clipping,
   or broken layout results either way; a dataset with fewer SPC/MKG codes, or a wider monitor,
   would let it share the row. Left as this best-effort behavior rather than shaving other widths to
   force an exact fit, since `availableAnalysts`/`availableMktgAnalysts`/`availableSubTrades` are
   data-driven and any hard-coded fit could break again the moment the data changes.

**Verified directly**: full regression suite 59/59 passing; live-checked Settings' new position +
popover, Historical Data's new position relative to the macro-buttons grid, Coast now rendering
below Hide Filters, and Hide Filters still correctly collapsing only the filter panel (masthead/tab
bar/Settings staying visible) -- before handing to 2 independent Agent-tool subagents for a
width-range sweep (one covering 1920px down to 1100px, one covering 1024px down to 375px,
specifically because this app has a documented history of real overflow bugs right in that lower
range) confirming no overlap/clipping/overflow and that every control still functions at each size.

**Real bug found by that sweep, in change #4 (Settings up into the masthead)**: the Settings
popover used to be `absolute right-0` (its right edge pinned to its own trigger BUTTON's right
edge), which only stays on-screen if that button sits near the viewport's right edge -- true when
Settings lived in the tab bar's `justify-between` right side, but no longer guaranteed once it
moved into the masthead's own `flex-wrap` cluster, where at tablet width and below the button can
wrap onto its own line starting at the row's LEFT edge instead. Confirmed live: at 375px the
popover rendered as far as `left: -306px`, leaving Zoom, most of Text Size, Auto-Refresh, and
Freeze Panes entirely unreachable.

**Fix, in two passes** (both live-found, both live-verified before moving on):
1. First pass: mirrored the hover-tooltip overlay's own `openLeft` flip logic elsewhere in this
   file -- compute whether there's more room to open rightward or leftward from the button's live
   `getBoundingClientRect()` (captured on click), `position: fixed` so it escapes any scrolling
   ancestor. This alone turned out insufficient: at 390/375px the threshold check still picked
   "open leftward" for a button already pinned to the left edge (only ~8px short of the rightward
   threshold), reproducing the same off-screen result from the other direction.
2. Second pass: replaced the binary flip with a direct clamp instead -- compute the *preferred*
   position (popover's right edge aligned with the button's right edge, matching the original
   pre-fix look) and clamp it into `[margin, viewportWidth - width - margin]`. This has no
   direction decision to get wrong: at any button position and any viewport width, the result is
   always fully on-screen. Also forced an explicit `width` (not just a `maxWidth` cap) on the
   popover, since once the Text Size row's new `flex-wrap` fallback (added alongside this fix, so
   its 7 buttons degrade to two lines instead of overflowing on narrow screens) kicks in, the
   popover's OTHER rows are much narrower than the cap -- letting the box shrink to content would
   silently disagree with whatever position math assumed a wider box.

**Re-verified live at all 6 widths from the original sweep** (1920/900/768/430/390/375): popover
fully on-screen and every control (Zoom, Text Size, Auto-Refresh, Freeze Panes, Dark Mode, Export)
reachable at each one, including the 4 that were previously broken. Regression suite 59/59 after
each of the two passes.

**One cosmetic gap left by that fix, closed in a third pass**: the same verifier's re-check caught
that the 400px cap chosen in pass 2 was itself ~40px short of what the Text Size row (label + 7
buttons + gaps + the popover's own padding, ~416px) actually needs -- so it still wrapped to 2
lines even at 1920px, missing the "desktop keeps its original one-line look" intent stated in that
pass's own comment (functionally harmless, the flex-wrap fallback caught it cleanly, but not what
was intended). Widened the cap to 440px. Re-verified live: Text Size back on one line at
1920/900/768px; still correctly wraps (gracefully, nothing off-screen or unreachable) at
430/390/375px, where 440px genuinely doesn't fit. Regression suite 59/59.

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
field-linkage correctness — see [the full data-linkage validation workflow](DATA_ARCHITECTURE.md#full-data-linkage-validation-workflow)
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

- **Per-slicer "clear this filter" button.** Done 2026-09-08, per Kevin's screenshot mockup
  (small circular × next to a slicer's own label, only when that slicer has a selection). The
  existing "Clear Filters" button always cleared every slicer at once — Sub Trade, Coast, SPC
  Analyst, Lane, Sale Week, Yard — even when only one needed clearing. Added a small shared
  `SlicerClearBtn` component (right after `SlicerBtn`'s own definition) and wired it into each of
  those six slicer sections' label row, conditional on that slicer's own `selectedX.length > 0`,
  calling that slicer's own setter with `[]`. AP Status wasn't touched — it lives in a separate
  toggle-button cluster elsewhere in the header, not this labeled-slicer panel, and wasn't shown
  in Kevin's mockup. Live-verified: no clear buttons render with nothing selected; selecting Sub
  Trade shows exactly one ("Clear Sub Trade filter"); adding a Coast selection shows a second,
  independent one; clicking either only clears that slicer (confirmed via `aria-pressed` on the
  affected vs. unaffected buttons) — never a mass Clear Filters. Full regression suite: 54/55
  (same single pre-existing, unrelated Sector Summary failure).
  **Same day, follow-up**: Kevin asked for "a bubble pop animation" on clicking one of these.
  Added the one hand-written CSS rule in this otherwise Tailwind-only app — a `@keyframes
  bubblePop` in a new `<style>` block in `<head>` (scale 1 → 1.6 → 0, fading out; a two-state
  Tailwind transition can't express a mid-point overshoot on its own) — applied via inline
  `style` (not a Tailwind arbitrary-value class, to sidestep the CDN JIT-compile-timing trap
  documented elsewhere in this file for `ColResizeHandle`/`measureRenderedTextWidth`) for
  `POP_MS` (180ms) after a click, `pointer-events-none` for that same window so a fast
  double-click can't double-fire it. The real clear (`onClick`, i.e. `setSelectedX([])`) is
  itself delayed by `POP_MS` via `setTimeout` so the pop is actually visible before the button
  (which only ever renders while its slicer has a selection) unmounts on its own — no manual
  "reset the animation" cleanup needed. Live-verified: 50ms after a click the button's own
  `style` attribute shows the animation actively running AND the slicer's selection is still
  intact (aria-pressed still true); by 300ms both the real clear has fired (aria-pressed false)
  and the button itself is gone from the DOM. Full regression suite: 54/55 (same failure).
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
  state's initial fallback value. **Superseded 2026-09-24** (see that entry near the end of this
  file): that initial fallback value was changed from `SECTOR_DATA_SEED` to an empty array, so
  `SECTOR_DATA_SEED` is no longer used as a live fallback at all — only kept declared in the file,
  unwired. Live-verified via Playwright (real fetched TAT/AL5/BEANR
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
- **Hide/minimize the header + slicer panel (2026-08-28), Kevin: "we should be able to choose
  to hide the slider box and everything above the tabs. If need be, we need to be able to
  minimize them."** Added a single `topPanelCollapsed` boolean gating the whole block between
  the drag-and-drop empty state and the tab row: the logo/title/Display Settings/Last
  Refresh/Refresh Now/Upload File header row, AND the entire slicer panel (Sub Trade/Coast/SPC
  Analyst/Clear Filters/Lane/Sale Week/Yard plus the per-tab toggle-button box). The tab row
  itself (tab buttons + Business Rules/Analyze/Export) is deliberately NOT part of the
  collapsible region — it's the one thing that has to stay reachable in both states, and the
  toggle button controlling the collapse lives there for exactly that reason (leftmost item,
  separated from the tab buttons by a vertical divider): "▲ Hide Filters" when expanded, "▼ Show
  Filters" when collapsed. Collapsing frees a large chunk of vertical space for the actual data
  table — confirmed live: Booking Flash showed several more data rows on-screen with the panel
  collapsed vs. expanded, same viewport.
  One real syntax bug caught before it ever reached a browser: the first attempt wrapped the
  header row and slicer-panel row in the same `{topPanelCollapsed && (...)}` conditional as two
  adjacent top-level JSX siblings with no shared wrapper — invalid JSX ("adjacent JSX elements
  must be wrapped in an enclosing tag"), caught by this project's mandatory syntax-check step
  (Babel transform + `node --check`) before any live testing, not by manual reading. Fixed by
  wrapping both rows in a `<>...</>` fragment inside the conditional.
  Verified live: confirmed the header/slicer panel (using "Clear Filters" — unique to the panel
  — as the probe string, scoped to `#root`, not `document.body.textContent`; "Sub Trade" was
  tried first and rejected as a probe since it also appears legitimately as a real column label
  inside every pivot/table, giving a false "still present" reading) disappears on collapse and
  reappears on re-expand; tab-switching (confirmed on POL Booking Flash) and the per-tab
  toggle/slicer content both still work correctly while the header/panel are hidden; the
  collapsed state persists across a tab switch (one collapse toggle for the whole report, not
  per-tab). Full regression suite: 47/47. Zero console errors.

## Git workflow used on this project

Every change (including small ones) has gone through a feature/fix branch + PR, even without
CI configured (there is none) — merge commits (not squash/rebase) once the change is verified
live. See closed PRs #1-#5 for the pattern and level of detail expected in a PR description
(what was found, what was fixed, exactly how it was verified live with real numbers).

**Use a `git worktree` per branch, not a single checkout you keep switching branches in** —
give each PR its own working directory (`git worktree add <path> <branch>`) rather than
`git checkout`-ing between branches in one. That matters more here than in a typical repo:
the whole app is one ~8,600-line file, so it's common to have more than one branch touching
nearby areas of it at once, and a stray `git checkout` mid-edit is an easy way to lose or
clobber uncommitted work in whichever branch you're leaving.

**Caveat, learned the hard way** (2026-09-14, see "Booking Flash table: VVD in hover tooltip,
click-to-highlight rows, Freeze Panes" above): a worktree isolates the *checkout*, not the
underlying *line ranges*. Splitting genuinely related work — that session's 3 features all
touched the same `DetailTableRow`/`PolTableRow` rendering code — across 3 parallel agents in
separate worktrees risked real merge conflicts on the same `<tr>`/`<td>` lines with no clean
automatic way to reconcile them, since each worktree's agent has no visibility into what the
others are editing until merge time. Worktrees are for isolating work that's genuinely safe to
develop and merge independently (a different bug, a different tab, a doc-only change) — when
several changes are known to touch the same lines, implement them directly in one pass (or
sequentially, rebasing between each) instead, and save worktrees/parallel agents for
*verifying* the result rather than *writing* it, same as that session did.

## 2026-09-15: the "pre-existing Sector Summary failure" is serving-method-dependent — root cause confirmed, not just staleness

The regression suite's `[Sector_Summary] Class A ... leaf-row Sector Alloc/Average Booking/Open
Space match the reference workbook` check (documented above and in many past session entries as
"just" stale reference data) turns out to depend on HOW the app HTML is served, not only on how
much time has passed since the 2026-08-12 reference snapshot. Confirmed mechanism, not a guess:

- `fetchAndApplySectorData()` unconditionally fetches `SECTOR_DATA_CSV_URL` (a `docs.google.com`
  "publish to web" CSV link) on mount. On failure it silently keeps `sectorSourceRows` at its
  `useState` default, the hardcoded `SECTOR_DATA_SEED` array — which was captured close to the
  same 2026-08-12 date as the reference workbook and matches it closely (verified: the seed's
  TAT/TA/AL5/BEANR "Average Booking" is 296, identical to the test's frozen ground truth).
- Loaded via a bare `file://` URL, the browser sends `Origin: null` on that fetch. Verified
  directly (`curl -H "Origin: null"` vs `-H "Origin: http://127.0.0.1:8935"` against the live
  CSV URL): Google's endpoint reflects `Access-Control-Allow-Origin` back only for a real
  http(s) origin — for `Origin: null` it returns no ACAO header at all. The browser's CORS
  enforcement then blocks the response (confirmed live via Playwright/Chromium with this
  project's own launch args: `TypeError: Failed to fetch`, console shows the CORS-block message)
  and the app falls back to `SECTOR_DATA_SEED`, which still matches the frozen reference —
  hence 0 failures under `file://`.
- Loaded over real HTTP (`python3 -m http.server`, any `http://` origin), that same fetch
  succeeds — the CORS check passes — so `sectorSourceRows` gets overwritten with TODAY's live
  Google Sheet data. Confirmed the live sheet has genuinely drifted from the frozen reference
  (e.g. TAT/TA/AL5/BEANR "Average Booking" is 235 live vs 296 in both the seed and the frozen
  reference) — this is real week-to-week drift, exactly the kind this check's own comment
  already warns about, but it can only reach the DOM (and therefore this check) when the
  serving origin lets the live fetch's CORS check pass.
- This is NOT a race or a timing/render-settling difference — the CORS block under `file://` is
  an immediate, deterministic browser security decision (fails fast; more wait time would not
  change it), not a slow request that occasionally loses a race. It also isn't specific to this
  one field: any check whose value flows through a live `docs.google.com`-fetched source (as
  opposed to the manually-uploaded xlsx, which is protected from being overwritten by
  `hasLoadedDataRef`/the seq-guard mechanism described elsewhere in this doc) will show the same
  serving-method dependence.
- Net effect: **this check's pass/fail outcome is currently determined by whether the test
  harness happens to let the sector-data live-fetch succeed, not by whether the app's numbers
  are actually correct.** Under `file://` it "passes" only because the live fetch is blocked
  and the seed's stale-but-matching numbers get checked instead; under HTTP it fails only
  because it's now comparing today's genuinely-current numbers against an August snapshot. Kevin
  would need to decide how to handle this (e.g. refresh `SECTOR_RIGHT_GROUND_TRUTH`/the seed
  periodically, or make the check tolerant of live drift) — no fix was made here, per scope.

**Note added 2026-09-24**: the `SECTOR_DATA_SEED` fallback this section's mechanism depends on was
removed that day — see the entry near the end of this file. `sectorSourceRows`'s `useState`
default is now `[]`, not `SECTOR_DATA_SEED`, so a CORS-blocked (or otherwise never-succeeding)
fetch now leaves the pivot genuinely empty instead of seed-filled. The CORS root-cause analysis
above (blocked `Origin: null` under `file://`) is unaffected and still accurate; only what the app
*shows* once blocked has changed — which changes what this check would now observe under `file://`
(an empty pivot compared against a populated reference, rather than a coincidentally-matching seed)
if this serving-method dependence is ever revisited. The 2026-09-16 fixture-pinning fix below routes
around this entirely by not depending on `file://`'s CORS behavior either way.

## Server-backed preferences (2026-09-16, new feature — not yet deployed)

The three preferences (dark mode, auto-refresh, freeze panes) already lived in `localStorage`,
which the "Open question for production" and storage-probe entries in AGENTS.md flagged as
possibly unreliable in production: the Apps Script sandbox iframe's own `window.location` is a
transient `*.googleusercontent.com` URL, and if that origin isn't stable between loads,
`localStorage` silently resets. This adds a second, server-side copy so the preferences can
survive that even if it turns out to happen.

`Code.gs` now injects `window.__SERVER_PREFS__` inline before the app's own script runs — same
mechanism as the existing `__EXEC_URL__` injection — so reads stay synchronous and there's no new
loading/flash state added to the app's first paint. Writes go the other direction over
`google.script.run.saveUserPref`, fire-and-forget. The per-user store is
`getScriptProperties()` namespaced by the visitor's email rather than `getUserProperties()`,
because Google's own docs leave that API's per-visitor behavior under "Execute as: Me" genuinely
ambiguous — see AGENTS.md's "Server-backed preferences" section for the full reasoning, including
why `bookingFlashAutoRefresh`'s null-vs-`'0'` distinction had to be preserved rather than
normalized away. When the visitor's email doesn't resolve, the feature degrades to exactly
today's localStorage-only behavior — fails closed, never shares a key across visitors.

This needs `Code.gs` redeployed to take effect, and until it is, the app just keeps doing what it
does today (see apps-script/README.md's "Redeploying `Code.gs` itself" section for that posture).
It also cannot be meaningfully exercised on a dev machine — `google.script.run` only exists
inside the Apps Script sandbox — so nothing here has been verified against a real deployment yet.
AGENTS.md has the deployed-URL checklist for when someone does; the discriminating step is
loading the deployed URL in an independent browser context (not just a same-browser reload)
signed into the same account, plus a separate check that one account's preference doesn't leak to
a different account.
## Per-user filter/view persistence (2026-09-15, new feature — built in a testing-version file)

Per Kevin: "add the system where the booking flash remembers each person's unique filters and
preserves their settings." Until now every slicer, header filter, column-visibility toggle, column
width, zoom/text size and the active tab was plain `useState` with a hardcoded default — none of it
survived a reload, so anyone who works one trade lane re-applied the same filters and re-hid the
same dozen columns every morning.

**Built in `Booking_flash_report_na_1.70_Testing.html`, a copy of 1.66** — the live 1.66 file is
untouched. **Shipped as `Booking_flash_report_na_1.67_TESTING.html`,
added ALONGSIDE an unmodified 1.66** (per Kevin, 2026-09-16: he wanted a separate 1.67 file, not
1.66 renamed in place, so the previous version stays on disk for comparison and rollback). The
`1.70_Testing` name existed only while this was being built and verified. Trade-off accepted
knowingly: because 1.67 is a new file rather than a rename of 1.66, git cannot pair them, so the
PR renders 1.67 as ~9,500 added lines. To review just the real change, diff the two paths
directly: `git diff --no-index Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html Booking_flash_report_na_1.67_TESTING.html`
(path updated 2026-09-17: the 1.66 file in the original form of this command is now `2.0`, so
the command as first written would fail with "No such file or directory"). Named `1.70`, NOT `1.7`, deliberately: this repo resolves "which file is live" by parsing
the dotted version into an int tuple and taking the max, and `(1,7) < (1,66)`. Worse, the repo
already contains `booking_flash_report_na_Kevin_1.07_FIXES.html`, which parses to exactly `(1,7)` —
so a `1.7_Testing` file would have tied with a frozen 2026-08 snapshot and been silently skipped by
AGENTS.md check 1, `check_alias_landmines.py` and `check_date_timezone_safety.js` alike, all of which
would have gone on green-lighting 1.66. **While this file exists it IS what every auto-detecting
script targets** — which is what we want for the syntax check, but it means anyone running
`perf_benchmark.js` or the alias-landmine check against the repo root right now is measuring the
testing file, not 1.66. Rename or remove it before shipping.

**Design.** One consolidated versioned key `bookingFlashViewPrefs` → `{v:1, savedAt, prefs:{...28
fields...}}`, behind a `ViewPrefsStore` adapter at module scope. One blob rather than ~28 keys
because the intended future home is Apps Script `PropertiesService.getUserProperties()` (per-Google-
account, so a view follows someone between machines), reachable only via `google.script.run` — which
is **async and costs a round trip per call**. One blob is one round trip each way. Read is
deliberately split `hydrate()` (async, awaited once at the `root.render` site) / `readSync()`, so
every in-component call site stays an ordinary synchronous lazy initializer and swapping backends
touches only those two methods. Module scope, not a hook, so the file's silent-hook-ordering trap
(Babel Standalone throws no native TDZ error) cannot apply to it. The three pre-existing keys
(`bookingFlashAutoRefresh`/`FreezePanes`/`DarkMode`) were left alone on purpose — don't "tidy" them
in.

**Six hazards this had to solve, each verified in the code, not reasoned about:**
1. *Stale selections silently zero the report.* Slicer options derive from `rawRows`, which is EMPTY
   on mount, so pruning is data-triggered (keyed on `rawRows` identity), never mount-triggered. Rule:
   prune a value iff no chip for it can render; an emptied slicer means "no filter", never "match
   nothing".
2. *The yard effect wipes restored chips.* It calls `setSelectedYards([])` unconditionally whenever
   the search box is empty. The plan said "one-run mount guard"; that proved insufficient in the code
   — the app auto-fetches its CSV source, so `rawRows` goes `[]` → real data shortly after mount, a
   SECOND invocation a literal one-shot guard would miss, wiping the chips moments after paint. The
   guard implemented instead skips every invocation while `availableYards` is empty plus the one where
   it first becomes non-empty, then behaves exactly as before forever after.
3. *`polColWidths` is autofit OUTPUT, not user input.* Persisting it wholesale would both lose restored
   widths (the manual-keys ref is empty on load, so autofit reclaims them) and write to storage on every
   filter click. Only manual-drag keys are persisted, and `manualPolColWidthKeysRef` is seeded from them.
   `detailColWidths` has no autofit pass and persists wholesale.
4. *A stale `headerFilters` key empties the whole table* (`String(row[key] || '')` never matches).
   Pruned by a zero-match test against current rows, which catches a stale key and a stale value with
   one mechanism and needs no hand-maintained 83-entry key whitelist.
5. *`activeTab` can strand the user.* Whitelisted to the four real tabs: `'booking_flash'` is
   hidden-on-purpose with no button back, and `'compare'` renders nothing without the never-persisted
   `oldRawRows`.
6. *`topPanelCollapsed: true` + active filters* hides the very chips needed to clear them — forced open
   when any slicer restored non-empty.

Out-of-range values **fall back to that field's default rather than clamping** (`zoomLevel: 9` → 1.0,
not 2.0). These bounds match the UI's own controls, so an out-of-range value cannot come from using the
app — it means corrupt or hand-edited data, and clamping would strand someone at a maximum zoom they
never chose, with the control to undo it hard to read at that zoom.

Never persisted, on purpose: `viewingHistoricalDate`/`historicalMode`/the compare dates (a non-null
viewing date means `rawRows` holds a historical snapshot — restoring it would present stale data as
live), `oldRawRows`/`oldFileName`, `highlightedRowIds`, popup positions, and `PivotTableViewer`'s
`collapsedNodes`.

A slate `role="status"` banner ("Your filters and view from last time were restored", + *Reset to
defaults* and a dismiss ×) renders only when something was actually restored — its own colour, since
this file already assigns banner colours semantically (blue = new data, amber = schedule change,
yellow = soft failure). Neither new button uses `aria-pressed`: the regression suite's clean-baseline
step polls every `button[aria-pressed]` and waits for none to be true (count verified unchanged at 14).
`clearSlicers` gained exactly one line (`setViewPrefsRestored(false)`); the high-traffic "Clear Filters"
button was deliberately NOT broadened into a full reset.

**Verified live** (local HTTP, real `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` and the 8,769-row
historical CSV, Playwright, pre-paint `localStorage` seeding via `addInitScript` — seeding after load
proves nothing, since the app reads storage at page-load time):
- Regression suite **72 checks executed, 71 passed / 1 failed — byte-identical to unmodified 1.66 run
  through the same harness in the same session.** The 1 failure is the known, already-root-caused
  Sector Summary reference-drift check documented in the section above (serving over HTTP lets the live
  sector CSV fetch succeed, so today's numbers get compared against an August snapshot).
- A first run reported only **68** executed checks — the `Historical_Data` suite's own documented
  graceful skip when the remote archive doesn't answer inside its 8s window. Resolved to AGENTS.md's
  flakiness bucket by a deliberate re-run showing 4/4, NOT by assuming flakiness. This is exactly why
  the executed-check count has to be read before the pass rate.
- Pruning, with a genuine week rotation between two real files (xlsx holds W27–W43, the CSV W29–W46):
  seeding `selectedSaleWeeks:['2026/W27']` and loading the CSV gives **536 rows, same as the unseeded
  control**, with the week pruned to `[]` — where without pruning it would be 0 rows and "No data
  matches the selected filters". Loading the xlsx instead, where W27 genuinely exists, **keeps** it and
  filters to 53 rows, confirming the pruner drops only what cannot render.
- Validation: stale `headerFilters` key → 467 rows, filter dropped, table not empty; `__NO_MATCH__`
  sentinel rejected; `activeTab` `'booking_flash'`/`'compare'` → safe tab; out-of-range zoom/text size →
  defaults while the rest of the same blob still restores; `v:999` and non-JSON blobs discarded with no
  crash. Zero page errors in every case.
- Perf: header-filter keystroke **202.3ms vs 201.5ms baseline** — unchanged within noise, which is the
  metric that mattered since the pruner shares the hoisted predicate with F3's optimized loop. Load and
  drag differences are not attributable: the baseline ran in a separate isolated directory with visibly
  higher variance (10.8% vs 2.7% spread).
- AGENTS.md checks 2 and 3 **not required and not run**: verified mechanically that no changed line
  touches a `getVal([...])` or `XLSX.read(...)` call (counts identical across both files: 90 and 9).

**Two pre-existing bugs found while building this — fixed in their own separate commits** (see the
two sections below). Neither is caused by persistence; both were reproduced live on unmodified 1.66
first. The second one interacts with this feature, though: persistence would have made its broken
state permanent across reloads instead of merely confusing within one session.

## Pre-existing bug: a chip-selected Yard was wiped on every data refresh (2026-09-15, fix)

The effect deriving `selectedYards` from the Yard search box depends on `availableYards` — a
`useMemo` over `rawRows` that returns a **new array identity on every `rawRows` change**, even when
the yard set is identical. So every data refresh re-ran the effect and, with the search box empty,
hit its unconditional `setSelectedYards([])` branch, silently discarding a Yard the user had chosen
by clicking a chip (the chips set `selectedYards` directly, bypassing the search box).

**Reproduced live on unmodified 1.66**, twice and two ways: via a real "Refresh Now" (chip `CAHAL02`
went `aria-pressed` true → false, with Last Refresh advancing 9:09:46 PM → 9:13:29 PM confirming
`rawRows` was genuinely replaced), and via a re-upload of the same export (same chip, `selected:
["CAHAL02"]` → `[]`). No comment anywhere marked the behavior deliberate — unlike this file's other
intentional oddities, which are heavily annotated.

**Fix**: track the search text the effect last acted on in a ref, and clear only when the search text
itself actually changed — not when a data refresh merely handed over a new `availableYards`
identity. A non-empty search box still re-derives against the current yard list on every trigger, so
the search-driven path is unchanged and self-healing. An `availableYards.length === 0` early return
replaces the separate restore-era one-shot guard, which this subsumes. Stale yards are still removed
— the view-prefs pruning effect drops any selected yard missing from the current data.

**Verified live**: `CAHAL02` now survives a refresh (`SURVIVES refresh`), while the search box
behaves exactly as before — typing `USLAX` selects `USLAX01/03/04/06/08`, a no-match string selects
no real chip, and clearing the box clears the selection.

## Pre-existing bug: six Detail header filters emptied the whole table (2026-09-15, fix)

Typing anything into the header filter of **six** Detail columns — `standby`, `peakUtil`, `curUtil`,
`rfrUtiliz`, `actVsBkgUtilz`, `actVsMaxLdn` — emptied the entire table. The initial audit found two
of them; a systematic sweep of all 47 filterable Detail columns found six, and all six were then
confirmed live.

**Root cause**: these six values exist only on the **aggregated** rows `tableData` builds (each is
computed from sums across a VVD/POL group, e.g. `actVsBkgUtilz = activeTotalTeu / ladenTeu` over the
whole group). They have no per-`rawRow` counterpart at all. The live header-filter matcher runs over
`rawRows`, where `String(row[key] || '')` read `undefined` → `''` for every row, so
`''.includes(<anything non-empty>)` was false everywhere and every row was filtered out.

**Confirmed live on unmodified 1.66** (real 964-row export, 467 detail rows), reading each column's
own displayed value and typing it straight back in — all six matched zero rows, while a control
column backed by `rawRows` behaved correctly:

| Column | Displayed | Typed | 1.66 rows | after fix |
|---|---|---|---|---|
| Current Laden (TEU) — *control* | `1,113` | `1` | 243 | 243 |
| Standby Threshold | `115%` | `115` | **0** | 18 |
| Peak Utiliz % | `138%` | `138` | **0** | 2 |
| Current Laden Utiliz % | `88%` | `88` | **0** | 6 |
| RFR Utiliz % | `46%` | `46` | **0** | 8 |
| Activity vs Booking Utilz | `100%` | `100` | **0** | 147 |
| Activity vs Max Laden | `(-147)` | `147` | **0** | 4 |

(A first pass at this measurement read the wrong column for `Standby Threshold` and briefly looked
like a partial fix: the Detail table's `rowSpan`-merged Trade/Sub Trade/Lane cells mean most body
rows have fewer `<td>`s than the header has `<th>`s, so a header index does not address the same
column in an arbitrary body row. Sampling only rows carrying the full cell count fixed the probe.
Worth remembering for any future DOM-index-based check against this table.)

**Fix**: a module-scope `AGGREGATE_ONLY_FILTER_KEYS` set. Those keys are skipped by the
pre-aggregation matcher (they cannot be evaluated there) and applied instead in `processedData`,
after `tableData` has aggregated and formatted each group — before the sort/blank-row/`rowSpan` work,
so spacer rows and merged cells are computed over the rows that actually remain. The same
`headerFilterMatchesRow` predicate is used, so "contains" and comma/percent/paren-insensitive
matching stay identical to every other column (the `(-147)` → `147` case above exercises exactly
that path). `deferredHeaderFilters` was added to `processedData`'s dependency array.

The view-prefs pruning effect also had to learn about these keys: it validates header filters by a
zero-match test against `rawRows`, which for an aggregate-only key would find zero matches for a
perfectly valid filter and silently drop it on every load. Those keys are now kept as-is rather than
validated — `tableData` isn't reachable from that effect, which sits above it, and this file's hook
order is load-bearing.

**Full regression suite after both fixes: 72 checks executed, 71 passed / 1 failed** — identical to
the unmodified-1.66 baseline through the same harness, same single known Sector-drift failure.

## Sector reference-drift check: pin the input instead of chasing the snapshot (2026-09-16)

The suite's `[Sector_Summary] Class A ... match the reference workbook` check had become a check
whose outcome was decided by **how the app was served**, not by whether the app was correct — the
mechanism is fully root-caused in the section above. In short: under `file://` the live sector
fetch is CORS-blocked, the app falls back to the frozen `SECTOR_DATA_SEED`, and the check "passed"
without ever exercising the live path; under HTTP the fetch succeeds and today's genuinely-drifted
numbers were compared against an August 2026 snapshot, so it failed purely because time had passed.

**Why not just refresh the snapshot.** That is a treadmill — it rots again within days — and it has
a worse failure mode: you re-capture from whatever the app rendered that day, so a real bug present
at capture time gets frozen in as "expected". **Why not just loosen it to invariants.** That stops
the false red but gives up the one thing the frozen table actually caught: a systematic
column mis-mapping, this repo's Class E bug class. Note `sectorDataMapped`'s own comment about the
Sheet once carrying `MCT Sector Allocation` as a header TWICE, which SheetJS silently resolved to a
`_1` key — invariants would never have caught that.

(The `file://`/CORS-blocked "falls back to `SECTOR_DATA_SEED`" mechanism described in the paragraph
above was accurate as of 2026-09-16 and no longer is — see the 2026-09-24 entry near the end of
this file: that fallback was removed the same session, so a blocked fetch today leaves the pivot
empty rather than seed-filled. Doesn't change this section's own fix, which pins the input and
never relies on that fallback in the first place.)

**Fix: pin the INPUT, keep the exact comparison, and add invariants for the live path.** The real
defect was a test depending on a live external service.
- `tests/fixtures/sector_data_2026-09-16.csv` — a committed copy of the published Sheet.
- Ground truth is derived **from that fixture's own columns**, never by capturing what the app
  rendered (that would freeze a bug in as expected), and renamed
  `SECTOR_RIGHT_FIXTURE_GROUND_TRUTH` so its provenance is obvious.
- The runner routes `SECTOR_DATA_CSV_URL` to the fixture and sets
  `window.__BFRT_SECTOR_FIXTURE__` before first paint; the exact comparison runs only then. On an
  unpinned run it is **skipped, not failed** — today's Sheet cannot be meaningfully compared to a
  committed snapshot. Recipe is in AGENTS.md check 4.
- Structural invariants run on **every** run: all three values real and non-negative, and no leaf
  row reporting more Open Space than its own Sector Alloc.

**An invariant I nearly added and measurement stopped.** `openSpace === max(0, sectorAlloc −
avgBooking)` looks like a law and is not one: against the real 2026-09-16 Sheet it is violated by
**5 of 42 rows** (e.g. `AT3/GBSOU` alloc=200 avgBooking=97 openSpace=104, where the identity
predicts 103 — the Sheet computes open space from unrounded inputs and rounds independently).
Asserting it would have introduced a brand-new permanently-red check, the exact thing this rewrite
existed to remove. The two invariants that shipped were each verified to hold on two independent
real snapshots first. `openSpace <= sectorAlloc` holds on all 42 rows of the live Sheet and on
every row of the older August capture.

**Verified live, three ways:**
- Unpinned/live: **72 checks executed, 72 passed, 0 failed** — the suite is fully green over HTTP
  for the first time (previously 71/72 with this check permanently red).
- Pinned fixture: **73 executed, 73 passed** — the extra check is the exact column-mapping guard,
  comparing all 42 fixture rows (`rightGtChecked: 42`).
- **Negative test, to prove the check can actually fail**: mutating one cell of the fixture
  (`AL5/BEANR` Sector Allocation 50 → 999) turns the pinned run into 72/73 with the failure naming
  the exact row and expected-vs-got. A check that can only ever pass is not a check.

The redundant older "every leaf row's Sector Alloc parsed to a real, non-negative number" check was
removed, superseded by the combined three-column version — which is why the live count stays at 72
rather than growing.

**A later re-measurement note (2026-09-16, same day, during the Historical Data fix below):**
re-running this exact suite against the current tip of this branch (10+ commits after this Sector
fix landed) gives **68 checks unpinned / 69 pinned**, not 72/73 — confirmed identical on both
`Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` and `_1.67_TESTING.html`, so this is NOT a
version-specific drift. This is ordinary count drift from unrelated suites changing elsewhere in
the file since this section was written (e.g. later data-dependent conditional checks), not a
regression in the Sector fix itself — every check in both re-measured runs still passed. Per this
file's own "Check the executed-check count, not the pass rate" rule, updated live numbers now live
in AGENTS.md check 4's table rather than being chased in every historical section that happens to
quote a count — the count above is left as this section's own original, honest record of what was
true when it was written, not corrected in place.

## Historical Data suite: pin the archive fixture, close the reachable-but-slow silent-skip gap (2026-09-16)

SUITE 9 (`Historical_Data`) had the same underlying defect class as the Sector check above — a test
depending on a live external service (`HISTORICAL_DATA_CSV_URL`, a single published Google Sheet
whose rows span many dates via a leading "Record Date" column, grouped client-side by
`fetchHistoricalData()` — see that constant's own comment in the app for the full shape/history) —
but a different symptom, because this suite has no seeded fallback the way Sector does.

**The defect.** The suite opened the "🗓️ Historical Data" popover and polled up to 8 seconds for
EITHER real date buttons (fetch succeeded) OR an error banner (fetch failed):
```js
await waitFor(() => dateButtonSelector().length > 0 || errorBannerVisible(), { timeout: 8000 });
```
If the wait simply timed out — neither appeared — the popover was closed and the function did a
silent `return` with **zero** `record()` calls, identical in shape to a confirmed-unreachable skip.
That collapsed two different situations into one silent outcome:
- **Confirmed unreachable** (a real error banner rendered, e.g. this project's own agent sandbox
  being unable to reach `docs.google.com` at all) — a genuine negative, where a silent skip is the
  right call, same convention this suite's neighbor (the Compare suite's own "no old file loaded"
  skip) already uses for its own no-data case.
- **Reachable but merely slow** — the wait ran out with no error AND no dates, which could mean the
  archive was genuinely hung, or could mean a real Google Sheet just took longer than 8s under
  normal conditions. This case used to vanish **identically** to confirmed-unreachable: all 4
  potential checks in this suite disappear from the report with zero signal, so a run could report
  "68/68, all green" while this whole suite never executed — indistinguishable from a run where it
  ran and passed. Exactly the failure mode AGENTS.md's "check the executed-check count, not the
  pass rate" section exists to catch, made worse by CI now running this suite (non-blocking) on
  every push (`tests/ci_regression_runner.js`, added 2026-09-16 alongside checks 1-3 becoming
  blocking CI gates).

**Why not just raise the timeout.** Buys a little headroom against a slow-but-real Sheet, but does
nothing for the actual root cause (the suite's outcome still depends on live network timing) and a
long-enough stall still silently vanishes, just later. **Why not just remove the timing race
entirely by always failing loud on any non-immediate response.** Would make the suite red by
default on every genuinely-slow-but-working real run against Kevin's own browser, exactly the kind
of permanently-red-check-people-learn-to-ignore trap the Sector section above already rejected.

**Fix, mirroring the Sector fix's own two-part shape (pin the input, AND make the live/unpinned
path more accountable — not just loosen or remove the risky check):**
1. **Pin the input.** `tests/fixtures/historical_data_2026-08-24_to_2026-08-26.csv` — a small (16
   rows, 3 dates: 7/5/4 rows respectively), real, committed subset trimmed from this repo's own
   `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` ground-truth export (9 days, 8,769
   rows — the committed fixture's rows are copied verbatim from that file, not hand-authored).
   Every fixture row's `trade`/`subTrade`/`lane`/`saleWeek`/`vvd`/`vessel` combination is unique
   (verified when the fixture was built), so the Booking Flash tab's aggregated row count for a
   given date equals that date's raw row count exactly, with no rows ever collapsing into each
   other — this is what makes the row-count fixture check below need no arithmetic. The runner
   routes `HISTORICAL_DATA_CSV_URL` to this fixture and sets `window.__BFRT_HISTORICAL_FIXTURE__`
   before first paint (recipe in AGENTS.md check 4). A local fixture response is effectively
   instant, which doesn't just make the race unlikely — it removes it: the wait always resolves via
   the real-date-buttons branch, nowhere near the 8-second budget.
2. **Make the ambiguous unpinned case loud, not silent.** Confirmed-unreachable and
   reachable-but-slow are now told apart by checking `errorBannerVisible()` specifically instead of
   just "no date buttons yet": a real error banner is still a legitimate silent skip (unchanged),
   but a timeout with NEITHER dates NOR an error banner now records an explicit **failing** check
   (`Setup: historical archive answered within 8000ms ...`) instead of vanishing. This mirrors the
   Compare suite's own "partial failure is NOT a benign skip" rule (a few hundred lines above SUITE
   9 in the test file) — an unconfirmed/ambiguous state gets a loud record(), only a clean,
   positively-confirmed no-op gets to skip silently. The 8-second timeout value itself is
   unchanged; it's still a reasonable safety net for this case, and effectively irrelevant to the
   pinned path.
3. **A necessary side-fix found while verifying step 2, not a separate defect:** `errorBannerVisible()`
   originally scanned every `<div>` on the whole page for its match phrases, not just the popover.
   That's harmless when this suite runs in isolation, but this app also shows its own unrelated
   "Couldn't load data automatically ..." banner (`autoFetchError`, when `CSV_SOURCE_URL`'s separate
   auto-refresh fetch fails) containing the same "Couldn't load" substring — confirmed live: in a
   sandbox where the main CSV fetch is *also* unreachable (unrelated to whether the historical
   archive specifically is slow), the unscoped check reported a false-positive "confirmed error"
   from that unrelated banner, silently swallowing the new ambiguous-timeout failure back into the
   legitimate-skip branch — the exact gap step 2 exists to close. Fixed by scoping both
   `dateButtonSelector`/`errorBannerVisible` to the popover's own subtree (found via its "Close
   historical data panel" button, walked up to the nearest ancestor still carrying the popover's
   `absolute` positioning class).
4. **New pinned-only exact checks**, ground truth derived from the fixture's own columns (never
   from what the app renders):
   - The popover lists exactly the fixture's 3 dates, newest first (`2026-08-26`, `2026-08-25`,
     `2026-08-24`) — a grouping/sort guard.
   - Viewing each of the 3 fixture dates renders exactly that date's own raw row count on the
     Booking Flash tab (4/5/7) — one combined check covering all 3 dates (mirroring the Sector
     fix's own single check spanning all 42 fixture rows, not one check per row), exercising the
     full pipeline end to end (fetch → group by Record Date → parse → aggregate → render). Finding
     along the way: the Detail table inserts a blank spacer `<tr>` after the last row of every
     distinct Lane group (`processedData`'s `withBlanks`) — since every fixture row happens to
     carry its own distinct Lane, the first version of this check read exactly double the real
     count (8/10/14 instead of 4/5/7) until spacer rows were filtered out via their `td[colspan]`
     marker (the only `<td>` in this table that ever uses `colspan`; real rows only ever use
     `rowSpan` on their Trade/Sub Trade/Lane group cells).

**Verified live, three ways** (against both `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html`
and `_1.67_TESTING.html` — identical counts on both; see AGENTS.md check 4's table for the full
2x2 pinned/unpinned breakdown):
- Unpinned/live: **68 checks executed, 68 passed, 0 failed** — this sandbox's headless Chromium
  cannot reach `docs.google.com` (confirmed via `net::ERR_CERT_AUTHORITY_INVALID` on every such
  request), so `errorBannerVisible()` resolves true well inside the 8s budget and the suite takes
  its legitimate confirmed-unreachable skip, same as before this fix (0 Historical_Data checks) —
  expected and unchanged, not a regression.
- Pinned fixture (both Sector and Historical): **75 executed, 75 passed** — Historical_Data
  contributes all 6 of its checks (Setup/date-list/row-counts/viewing-banner/stability/Back-to-Live).
- **Ambiguous-timeout case, to prove the fixed gap actually closes**: routed the historical fetch
  to a Playwright handler that never resolves (simulating "reachable but hung/slow", as distinct
  from a fast confirmed failure) with NO fixture pinned. Before this fix this produced 0 records
  (silently indistinguishable from success); after this fix it produces exactly **1 new failing
  check** — `Setup: historical archive answered within 8000ms (neither date buttons nor an error
  banner appeared -- reachable-but-slow or hung, NOT a confirmed-unreachable no-op)` — 69 executed,
  68 passed / 1 failed, with every other suite in the file unaffected.
- **Negative test, to prove the pinned check can actually fail**: mutated one fixture row's Record
  Date in memory only (`2026-08-25` → `2026-08-24` for the `TPT/PN/PN3/VMS/VMS` row; never written
  to the committed fixture) — turns the pinned run into 75 executed, 74 passed / 1 failed, naming
  the exact date and expected-vs-got: `{"date":"2026-08-25","expectedCount":5,"rowCount":4}`. A
  check that can only ever pass is not a check.

No app file was touched — this is a `tests/`+docs-only change, same as the Sector fix. Checks 1-3
do not apply.

## Merging into main's Web Worker/server-prefs/field-visibility work, and a real race condition found underneath it (2026-09-16)

The Historical Data fixture-pinning fix above (branch `claude/elegant-fermi-0uo4yk`, PR #86) was
written against pre-PR#85 `main`. By the time it merged, `main` had moved on twice: PR #85 (commit
`870aa69`, "Cut archive load 14.2s -> ~0.1s, add server-backed preferences") and then PR #82
(commit `338ab4a`, "Field visibility picker + macro-grid removal"). PR #85 is the one that matters
for SUITE 9 specifically — it touches the SAME historical archive this fix's suite exercises, but
at the app level: the archive's fetch became lazy (starts on the popover-open click instead of an
eager mount effect) and its parse moved into a Blob Web Worker
(`parseHistoricalArchiveInWorker`, 104-144ms vs. the old ~14.2s main-thread block). PR #85 also
raised this suite's own `waitFor` timeout 8s -> 30s the same day, independently, for exactly this
reason (a cold click-triggered fetch now legitimately competes with the wait, where before the
mount effect had already finished it by the time the suite got here). PR #82 is unrelated to
Historical Data but added its own new regression suite (`Field_Visibility`, Suite 11) and rewrote
the field-visibility test helpers (`clickShowToggle`/`openFieldPicker`/`setFieldVisible`) that an
earlier suite (Trade Summary) also calls.

Merging was two real 3-way merges (`git merge origin/main`, run twice as `main` kept moving), not
a rebase, per this repo's own convention (see `4ec8e67`) — never force-pushed, never rewrote this
branch's own history. `tests/booking_flash_regression_tests.js`'s SUITE 9 region conflicted both
times, in exactly the timeout-value hunk described above (this branch's own rewrite vs. main's
independent 30s change) — resolved by keeping the rewrite's structure and adopting 30s as the
value, since the 30s change's own rationale (a real, no-longer-eager fetch can legitimately take
several seconds) is fully compatible with, not in tension with, this fix's own design (the pinned
path still resolves in single-digit milliseconds either way). PR #82's own new SUITE 11 merged in
cleanly alongside SUITE 9/10 with no numbering collision (PR #82's own merge into main, commit
`8f41d0f`, had already resolved a "both sides added Suite 10" collision by renumbering its own
suite to 11). `tests/ci_regression_runner.js` merged cleanly both times: main's file-detection
change (target 1.66 explicitly, excluding testing builds by name, replacing "highest version
number") layered under this fix's own addition (pinning both the Sector and Historical fixtures)
without touching the same lines. The app file
(`Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html`) applied cleanly both times — this branch
never touched it, so every change is main's own, and the merged file is byte-identical to main's.

**Re-validating the merged suite found a real bug, not just a conflict to resolve.** Running the
merged suite unpinned against the new lazy/Worker-based archive load repeatedly produced a FALSE
`Setup: historical archive answered within 30000ms (...)` failure — but instrumenting `waitFor`
directly showed it resolving `true` after only ~50ms, with BOTH `dateButtonSelector()` and
`errorBannerVisible()` reading false again a moment later. Root cause: `popoverScope()`'s fallback
— `(closeBtn && closeBtn.closest('.absolute')) || document` — was written to handle "the popover
markup moved," but it also fires in the instant right after `histBtn.click()`, before React has
committed the just-opened popover's own close button to the DOM. `waitFor`'s very first predicate
call runs synchronously in that same tick, so at that exact moment `popoverScope()` falls back to
searching the WHOLE page — and finds this app's own unrelated, already-present "Couldn't load data
automatically ..." banner (`autoFetchError`, shown once `rawRows.length > 0`, which is already true
by the time this suite runs, from its own earlier xlsx upload). That transient false-positive
match resolves `waitFor` immediately, before the real historical fetch has even had time to settle
either way — so the suite recorded a false "reachable-but-slow/ambiguous" failure despite having
waited milliseconds, not the real budget. The same shape could just as easily land on the
CONFIRMED-unreachable branch instead (closing the popover and skipping silently) depending on
exactly which poll tick wins the race, which would reintroduce this suite's own original
silent-skip bug from underneath the fix meant to close it — this is real engineering the merge
surfaced, not a pre-existing flake unrelated to the PR #85 archive-loading change: the OLD eager
mount-effect fetch meant this suite's very first popover-open poll usually found the popover
already fully settled (dates or a real error already in state) well before the race window
mattered; the new click-triggered fetch means the FIRST poll now regularly lands in that window.

**Fix**: `popoverScope()`'s fallback no longer searches `document`. An absent close button now
means an inert empty scope (`{ querySelectorAll: () => [] }`) — "the popover isn't mounted yet"
correctly reads as "nothing found yet" for both `dateButtonSelector()` and `errorBannerVisible()`,
rather than "search the whole page." This is a one-line semantic change (a two-token diff) with a
long comment explaining the race it closes; see the test file's own comment at `popoverScope()`
for the full writeup, and the follow-up commit (separate from both merge commits, per this
session's brief) for the exact diff.

**Re-verified live against the merged, Worker-based archive-loading code, four ways** (real
headless Chromium via Playwright, `PW_CHROMIUM_PATH` pointed at this sandbox's pre-installed
browser; the app file itself needed a throwaway CDN-to-local-file swap per this doc's own
CDN-unreachable guidance below — vendor libraries fetched once through the sandbox's outbound
proxy, never edited into the real file):
- **Unpinned, repeated runs**: each time, `waitFor` now genuinely blocks until
  `errorBannerVisible()` becomes true against the REAL popover-scoped banner (measured 202-420ms,
  never an early false-positive resolve), and the suite correctly takes its legitimate
  confirmed-unreachable silent skip (0 Historical_Data records) — matching this fix's original,
  pre-merge documented behavior exactly, now proven stable against the new lazy/Worker archive
  load instead of the old eager one.
- **Pinned fixture (Sector + Historical), repeated runs**: Historical_Data contributes all 6 of
  its checks, every one passing, including the two exact fixture ground-truth checks (date list;
  4/5/7 row counts) — confirming the Worker-based parse pipeline (`XLSX.read` inside a Blob worker,
  falling back to the guaranteed inline path if a worker can't be used) produces byte-identical
  results to what the old main-thread parse produced, for this suite's purposes.
- **Ambiguous-timeout case, re-run against the merged code**: routed the historical fetch to a
  Playwright handler that never resolves, unpinned. `waitFor` now genuinely waits out the full
  budget (measured elapsed ~30023ms against the new 30000ms timeout, `result: false` — a real
  timeout, not an early false resolve) and records exactly the same single explicit failing check
  this fix originally proved, just naming 30000ms instead of 8000ms.
- **Negative test, re-run against the merged code**: the same in-memory Record Date mutation
  (`2026-08-25` -> `2026-08-24`, TPT/PN/PN3/VMS/VMS row) reproduces the exact original result —
  `{"date":"2026-08-25","expectedCount":5,"rowCount":4}` — byte-for-byte identical to this fix's
  own original negative-test proof, confirming the pinned check still genuinely fails when it
  should.

**Full-suite executed-check counts after both merges** (see AGENTS.md check 4's table for the full
breakdown): **91 executed / 77 passed unpinned, 98 executed / 84 passed pinned** (Sector +
Historical). Suites 1-9 came back exactly 68 (unpinned) / 75 (pinned), identical to this fix's own
pre-merge numbers — proving neither merge silently changed any existing suite's coverage. Suite 10
(`Preferences_Persistence`) contributed its own 15 records in both runs (1 passed, 14 failed) —
every one of those 14 failures is this verification sandbox's own inability to complete a live
`CSV_SOURCE_URL` fetch from inside Suite 10's isolated iframe boots, the same `docs.google.com`-
unreachable category already well-documented above for Sector/Historical, not a regression from
this merge (see AGENTS.md check 4's note on this for the full reasoning, including why Suite 10's
own hardcoded tripwire correctly reports the shortfall rather than passing falsely, and why this
exact 14-failure signature independently reproduces on a different session's own merge of PR #82).
Suite 11 (`Field_Visibility`, PR #82's own new coverage) contributed a clean 8/8 in both runs,
unaffected by any of this.

Both merge commits and the one-line follow-up fix are separate commits (per this session's
brief), so each merge stays a clean, reviewable merge and the fix is independently reviewable on
top of them.

## Booking Flash/Detail: stray "VMS" row rendering above a real vessel row for the same week, fixed (2026-09-21)

Kevin: "Noticed this last week... these white lines that are appearing randomly" — three
screenshots of the Booking Flash (Detail) tab showing a grey, all-blank "VMS VMS" row sitting
directly above a real vessel's row (e.g. a blank row above `NDMT0124E` / `NYK DEMETER`, another
above `NMTT0091E` / `NYK METEOR`), breaking the normal one-row-per-Sales-Week rhythm the tab
otherwise keeps.

**Root cause**: `tableData`'s aggregation key
(`` `${trade}-${subTrade}-${lane}-${saleWeek}-${vvd}-${vessel}` ``) includes `vvd`/`vessel`. A raw
row recorded before a vessel was nominated for that week (`vvd`/`vessel` = the literal placeholder
`"VMS"` — see this file's own earlier note that this is "a real not-yet-nominated-week placeholder,
not an actual vessel") and a later raw row for the SAME trade/subTrade/lane/saleWeek recorded once
a real vessel was nominated hash to two different keys, so they never merge into one aggregated
row — both survive into the final render as two separate rows for what is really one calendar sale
week, with nothing downstream to say the stale VMS one should be dropped once superseded.

**Reproduced live**, not just inferred from reading the source: served the app locally, uploaded
the real `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` (a multi-day archive — the
kind of file that naturally carries both an early snapshot's "not yet nominated" row and a later
snapshot's real-vessel row for the same week) into the Detail tab via a scripted Playwright
session, and filtered to Trade TAT / Sub TA / Lane AL5 — the exact lane the screenshots' circled
VVDs (`NDMT0124E`, `CGBT0015E`/`CGBT0016E`, `NMTT0091E`) belong to. Got the identical defect:
2026/W45 rendered as two rows, one real (`CGBT0016E`, PIC `Resid / Marissa`) and one stale
`VMS`/`VMS` (PIC `TBA / Marissa`) — confirming this isn't specific to one odd data file, it's the
aggregation key itself.

**Fix**: after building the aggregated rows, drop any VMS row whose trade/subTrade/lane/saleWeek
also has a non-VMS row in the same result set — a real nomination always supersedes "not yet
nominated" for that same week. A week with no real nomination at all keeps its lone VMS placeholder
exactly as before; this only removes a VMS row that has a real sibling for the same week, matching
this app's own established philosophy that a VMS row appearing/disappearing is not itself a signal
worth tracking (see `diffScheduleChange`'s existing VMS-skip, documented earlier in this file).

**Verified**: same live-browser repro re-run post-fix — 2026/W45 now renders as the single real
`CGBT0016E` row, every other week in the lane unaffected (still exactly one row each, VMS or real,
matching the pre-fix screenshot for every week that wasn't a duplicate). Syntax check
(`node --check`) clean; `dist/index.html` rebuilt and `--check`-verified in sync with the new
source SHA.
**Not run**: the full `tests/booking_flash_regression_tests.js` suite — its CDN-vendoring step
needs direct HTTPS fetches that this sandbox's TLS-intercepting proxy setup doesn't support (see
`ci_regression_runner.js`'s own `BF_VENDOR_CDN` comment, which documents this exact limitation).
The fix was instead verified by direct live-browser reproduction of the reported defect, before
and after — real data, real render, not a hardcoded snapshot. Worth running suite 4 for real (or
in CI) before calling this fully closed.

## Sector Allocation banner shown outside Sector Summary, and the deeper fix: stop falling back to hardcoded numbers at all (2026-09-24)

Kevin saw this in production (screenshot, "Last Refresh: 9/24/2026 9:10 AM"): "Couldn't load live
Sector Allocation data (Fetch failed with status 400). Showing built-in defaults instead." —
visible while on the Booking Flash tab, not Sector Summary, because `sectorFetchError`'s banner
(~line 9013, `sectorFetchError && rawRows.length > 0`) isn't gated by which tab is active — same
as `autoFetchError`'s banner immediately above it.

**Root cause of the 400, confirmed not guessed.** `fetchAndApplySectorData()` (~line 6273) fetches
`SECTOR_DATA_CSV_URL` (~line 2706), a Google Sheets "Publish to web" CSV export that feeds the
Sector Summary tab's right-hand "Sector Allocation" pivot. That exact URL was curled directly from
this environment twice — once during the original diagnosis, once again while writing this entry
— and both times returned `200 OK` with 44 rows of valid CSV, header row unchanged including the
`Sector Allocation` column. The publish link itself is healthy and correctly configured; the 400
Kevin saw was a one-off, most likely a transient hiccup on Google's publish-CSV endpoint (these do
occasionally blip, e.g. during concurrent sheet edits/recalculation). This also rules out CORS/
network-blocking as the cause: a CORS-blocked `fetch()` throws a generic network error with **no**
HTTP status at all (see the 2026-09-15 entry above for exactly this failure mode under `file://`),
so the error message explicitly containing "status 400" proves Google's server *did* respond.

**The deeper problem, which Kevin flagged directly** ("We can only show real numbers and not hard
coded numbers"): regardless of why that one fetch failed, the code's existing response to ANY
sector-fetch failure — even a harmless one-off blip on the very first fetch of a session — was to
keep showing `SECTOR_DATA_SEED`, the hardcoded ~1300-line snapshot captured ~2026-08-12 (declared
~line 206), as `sectorSourceRows`'s `useState` default. That made a transient failure
indistinguishable from live data except for the small, dismissible yellow banner — the report
could silently render 6+-week-stale, hardcoded numbers as if they were current, and nothing short
of noticing the banner would tell a viewer that.

**Fix**: `sectorSourceRows`'s `useState` default changed from `SECTOR_DATA_SEED` to `[]` (~line
5078, with a comment at ~5063-5077 explaining the change). Kevin picked this from 3 options he was
offered. Why it's safe, none of it new mechanism — every piece already existed except the default
itself:
- Before any live fetch succeeds this session, the pivot is now genuinely empty — never fabricated
  numbers. `sectorDataMapped` (~line 8363) is a plain `.filter().map()` over `sectorSourceRows`, so
  an empty array flows through with no crash; `PivotTableViewer` already renders empty `data`
  cleanly elsewhere (e.g. under active slicers with zero matches).
- Once a fetch succeeds, real data persists across any LATER failure — already true of the
  existing code (`fetchAndApplySectorData`'s `catch` block, ~line 6310, only ever calls
  `setSectorFetchError`, never resets `sectorSourceRows`) and needed no change.
- The yellow banner (~line 9013-9017) already explains the error to the viewer; needed no change.
- "Refresh Now" (`handleManualRefresh`, ~line 6822-6823) already calls `fetchAndApplySectorData()`
  directly to retry on demand, same as the existing 10-minute `POLL_INTERVAL_MS` poll (~line 6446);
  needed no change.

`SECTOR_DATA_SEED` itself is still declared in the file (~line 206) — not deleted, just no longer
wired up as a live fallback anywhere. See DATA_ARCHITECTURE.md's `SECTOR_DATA_SEED` entry (Frozen/
static datasets table) for the corresponding correction.

**This entry corrects, not replaces, the mechanism described earlier in this file.** The
2026-08-25 "done" bullet (backlog list above) and the 2026-09-15/2026-09-16 sections on the CORS/
`file://` serving-method dependence for the Sector reference-drift check all describe
`SECTOR_DATA_SEED` as the live fallback — accurate when written, no longer accurate as of today.
Each has been annotated in place rather than rewritten, per this file's own convention of not
erasing a dated historical record.

**Addressed same day.** The banner's own copy at ~line 9015 ("Showing built-in defaults instead")
was flagged above as stale text by this entry's own documentation pass, then fixed in the same
session: it now reads "Couldn't load live Sector Allocation data (...). Showing the last
successfully loaded data." when `sectorSourceRows.length > 0`, or "...No Sector Allocation data
has loaded yet." when it's still empty, plus a pointer to "Refresh Now" to retry — matching what's
actually on screen in either case instead of a claim ("built-in defaults") that's no longer true
in any case.

**Verification performed for this entry**: read the current file directly (line numbers above are
freshly re-confirmed, not taken on faith from how the fix was originally reported) and independently
re-curled `SECTOR_DATA_CSV_URL` to reconfirm the endpoint is healthy right now. No regression suite
run was part of this pass — this was a documentation-only task; see AGENTS.md check 4 before
considering this fully closed on the test side.

## Filter persistence, ported from 1.67_TESTING's `ViewPrefsStore`, scoped down to filters only (2026-09-24)

Kevin asked for the filter-saving feature in `Booking_flash_report_na_1.67_TESTING.html` — that
branch's `ViewPrefsStore` — to be ported into the live app (`2.0`). Before building it, the
orchestrating session asked Kevin to clarify scope, because 1.67 and 2.0 have diverged on exactly
the piece `ViewPrefsStore` would collide with, and building the wrong scope first would have meant
throwing work away.

**Why the scope was narrowed, concretely.** 1.67's `VIEW_PREFS_DEFAULTS` persists one big
versioned blob: the same 10 filters/slicers this port also persists, plus `topPanelCollapsed`,
`textSizePx`, `zoomLevel`, `activeTab`, `polColWidths`/`detailColWidths`, AND 12 named
column-visibility booleans (`remarksHidden`, `reeferHidden`, `bsaHidden`, `activityHidden`,
`sectorAllocHidden`, `dgVolumeHidden`, `opIssuesHidden`, `apStatusHidden`, `rotationHidden`,
`tradeBreakdownHidden`, `vcoHidden`, `etaHidden`) that both seed `useState` defaults and are read
back through one shared blob. 2.0 replaced that column-visibility system outright: `FIELD_TOGGLES`
is a data-driven array of descriptors (module scope, just above `FlashReportDashboard`), each field
backed by its own `useFieldVisibilityPref(storageKey, defaultValue)` hook and its own independent
`localStorage` key (e.g. `bookingFlashRemarksHidden`), plus derived concerns 1.67's twelve booleans
never had — which header filters each toggle gates, per-tab applicability, and an invariant
`tests/check_field_filter_gating.py` enforces (every render site of a gated field, on every tab,
must actually be gated by its toggle). Porting 1.67's 12 booleans verbatim into 2.0 would have
meant either two parallel column-visibility systems writing incompatible storage shapes and
fighting over which one wins on load, or a ported blob silently duplicating state `FIELD_TOGGLES`
already owns and able to drift out of sync with the value the UI actually renders from — a stored
`remarksHidden: true` that no longer agrees with what `bookingFlashRemarksHidden` in `localStorage`
says. Kevin was given the actual choice — port the full 1.67 view-state blob adapted to 2.0's
shapes, or filters only — and explicitly picked **filters only**.

**What's persisted now, and what deliberately is not.** The new store, `FilterPrefsStore` (module
scope, immediately before `function FlashReportDashboard() {`), keeps one small versioned blob —
`FILTER_PREFS_DEFAULTS`, 11 keys: the 10 real filters (`selectedSubTrades`, `selectedAnalysts`,
`selectedMktgAnalysts`, `selectedCoasts`, `selectedLanes`, `selectedSaleWeeks`, `selectedYards`,
`yardSearchText`, `selectedApStatuses`, `headerFilters`) plus `topPanelCollapsed`.
`topPanelCollapsed` travels with the filters on purpose — a restored filter set with the slicer
panel collapsed would have nothing visible to explain why the table looks filtered, or to un-click
— the same reasoning 1.67 itself used for bundling it into its own blob. A hazard rule in
`filterPrefsValidateAll` forces `topPanelCollapsed` back to visible whenever any filter actually
restored non-empty, regardless of what was separately stored for `topPanelCollapsed` itself, for
the same reason. **Not ported**: the 12 column-visibility booleans (superseded by
`FIELD_TOGGLES`/`useFieldVisibilityPref`, above) and `textSizePx`/`zoomLevel`/`activeTab`/
`polColWidths`/`detailColWidths` — chrome, not filters, and outside the scope Kevin chose.

**New storage key.** `FILTER_PREFS_STORAGE_KEY = 'bookingFlashFilterPrefs'`, version `1` —
deliberately not 1.67's `bookingFlashViewPrefs`. The two stores hold different, incompatible
shapes (11 keys here vs. 1.67's much larger blob), so reading the old key through this store's
validators would silently discard most of a real 1.67 blob as unrecognized fields; and if a fuller
port of the rest of `ViewPrefsStore` is ever built later, a shared key would let whichever store's
`hydrate()` runs last quietly half-read or clobber a blob the other one wrote. A distinct key keeps
the two from ever being able to collide, at the cost of a `1.67_TESTING` user's filters not
carrying over automatically — an accepted tradeoff for a testing-only branch.

**Same store shape as this file's other persistence layers, on purpose.** `FilterPrefsStore` is
`hydrate()`/`readSync()`/`wasRestored()`/`save()`/`flushNow()`/`clear()`/`disableForSession()`,
the same shape as `SERVER_PREFS`/`resolveUserPref` (see "Server-backed preferences" in AGENTS.md)
and as 1.67's own `ViewPrefsStore` — a 400ms debounced write, and a 1500ms `hydrate()` timeout that
disables further saves for the rest of the session rather than risk overwriting a real stored
value with defaults from a stuck backend. That timeout is inert today (today's backend is
synchronous `localStorage`) — it exists for whenever a slower backend (a `google.script.run` round
trip, as `SERVER_PREFS` already anticipates for the three simple prefs) replaces `localStorage`
underneath it. `FilterPrefsStore.hydrate()` is awaited once, wrapping the
`ReactDOM.createRoot(...).render(...)` call at the bottom of the file, so every
`useState(() => restoredFilterValue('x'))` lazy initializer inside `FlashReportDashboard` — all 10
filters plus `topPanelCollapsed` — sees the real restored value on first render. No first-paint
flash, no "unknown" render state, same constraint `SERVER_PREFS` documented for the same reason.

**New UI surface: the restored-filters banner.** A new `filterPrefsRestored` state (true only if a
real, versioned, parseable blob existed at hydrate time — backed by `FilterPrefsStore.wasRestored()`)
renders a slate `role="status"` banner between the existing `sectorFetchError` banner and the
`newDataAvailable` banner, reading "Your filters from last time were restored." with two controls:
a "Reset to defaults" button (`resetFilterPrefs` — clears every filter, forces `topPanelCollapsed`
back open, clears the stored blob, and dismisses the banner) and a "×" dismiss button that only
hides the banner, leaving the restored filters and the stored blob untouched. The existing "Clear
Filters" control (`clearSlicers`) also dismisses the banner as a side effect of clicking it, but —
deliberately, unlike Reset to defaults — does not touch the stored blob, so clearing filters by
hand for the current session doesn't silently wipe what's saved for next time.

This banner exists specifically so the feature doesn't repeat an incident already on record in
this file: see "Schedule-change notification: not simultaneous across users (2026-09-14)" above,
point 2 — Auto-Refresh shipped as, in that entry's own words, "a silently-persisted per-browser
setting" that "survives every future reload with no visible reminder," and that silence directly
caused two people looking at the same live data to drift out of sync with no way to tell from the
screen alone. A restored filter set is the same shape of problem — state a user set once,
silently reapplied on every future load, indistinguishable on screen from a filter they just
applied themselves — arguably worse, since a forgotten filter can hide rows the user has no reason
to suspect are missing, rather than merely delaying a notification banner. This feature ships the
visible callout from day one instead of waiting for a bug report the way Auto-Refresh did.

**Testing.** A dedicated suite, `Filter_Persistence` (Suite 12 in
`tests/booking_flash_regression_tests.js`), was built in parallel by a second agent to cover this
feature; see that suite's own header comment and hardcoded tripwire for its current executed-check
count rather than a number recorded here — this file and AGENTS.md have both been burned before by
a check count written down once and trusted stale (see AGENTS.md's "Check the executed-check
count, not the pass rate"). Everything described above about `FilterPrefsStore`,
`FILTER_PREFS_DEFAULTS`, the write-effect snapshot, and the banner was read directly from the
app file's own source, not taken on trust from a task description.

Not touched: `DATA_ARCHITECTURE.md`. That document's scope is field-mapping aliases, per-tab
column inventory, the frozen/static datasets, and per-tab validation status. Filter persistence is
view/UI state with no field-mapping component, so no entry was added there.

**Real bug found by the test suite, fixed the same day: a restored Yard selection was silently
discarded whenever `yardSearchText` restored empty.** While building `Filter_Persistence`
(above), a pre-existing effect — unrelated to this feature, already in the file before it, keyed
on `[yardSearchText, availableYards]` (search "yard mount-guard effect" in the app) — turned out
to run on every mount and unconditionally call `setSelectedYards([])` whenever `yardSearchText`
was empty, with no idea `FilterPrefsStore` had just restored a real value into that same state.
It clobbered the restore within the same initial render pass, before anything was ever visible or
written back. Practical impact: any Yard selected by clicking its own chip directly (never typed
into the search box — `toggleFilter` sets `selectedYards` straight, bypassing the box entirely)
silently failed to survive a reload, the one filter of the ten that didn't actually save.

The fix ported straight from `1.67_TESTING`, which had already hit and fixed this exact defect on
its own effect, independently, on 2026-09-15 (see that branch's own identical
`[yardSearchText, availableYards]` effect for the original writeup — it predates and is unrelated
to this port, a genuinely separate discovery of the same bug class in the same code shape). Two
guards: an `availableYards.length === 0` early return (nothing to derive against before real data
exists, so leave `selectedYards` alone rather than acting on an empty array), and a
`searchTextChanged` ref-tracked gate on the empty-search clear branch (only clear when the user
actually emptied the box, not merely because the effect re-ran for an unrelated reason — a data
refresh, or now, a restore). `Filter_Persistence`'s Scenario 1 (a full 10-filter restore,
including a chip-selected Yard with empty search text) and Scenario 2 (a corrupted blob's
`selectedYards` surviving to its validator-stripped `['LAX','OAK']` rather than being clobbered to
`[]`) both assert the fixed behavior directly, not a workaround for the bug — both were failing
before the app fix landed, confirmed live before writing this note.

## Filter persistence code-review pass: 4 more confirmed bugs found and fixed, plus a CI double-run fix (2026-09-24)

The feature described in the entry just above ("Filter persistence, ported from 1.67_TESTING's
`ViewPrefsStore`...") went through a code review the same day it was built — a local `/code-review`
run followed by a separate "gap sweep" agent looking specifically for anything the first pass might
have missed. Both found real, confirmed bugs in `FilterPrefsStore`, all fixed the same day, plus one
pre-existing gap the review surfaced while reading the code around it. Grep the app file for the
function name named in each item below to find the exact fix.

1. **Banner false-positive.** `FilterPrefsStore.wasRestored()` used to mean "a parseable,
   version-matching blob exists," which the mount-time write-effect makes true after literally the
   first mount for every visitor — it persists a valid blob unconditionally, whether or not the user
   ever touched a filter. So the "Your filters from last time were restored." banner fired on
   essentially every return visit, restored filters or not. Fixed by adding `filterPrefsCanon` (an
   order-independent deep-equality serializer) and `filterPrefsEqualsDefaults(prefs)`, and changing
   `hydrate()` to compute `restored: !filterPrefsEqualsDefaults(prefs)` instead of always `true`
   once a blob parses and version-matches.
2. **The restore-only hazard rule was also running on the live write path.** The old
   `filterPrefsValidateAll` did two things at once — sanitize fields, and force
   `topPanelCollapsed` back to `false` whenever any filter was non-empty (a restore-time safety net
   so a restored filter set is never hidden behind a collapsed panel). `flushNow()` — every live
   debounced write, not just the one-time restore — called this same function, so a user who clicked
   "Hide Filters" while any filter was active could never actually persist that collapse: the very
   next write silently forced it back open. Fixed by splitting into `filterPrefsSanitizeFields`
   (fields only) and `filterPrefsApplyRestoreHazards` (the hazard alone); `flushNow()` now calls
   `filterPrefsSanitizeFields` directly, and only `hydrate()` still applies the hazard.
3. **The byte-identical-write guard was defeated by its own timestamp.** `flushNow()` used to
   compare the whole stringified `{v, savedAt: Date.now(), prefs}` blob against the last-written one
   to decide whether a write was a no-op — but `savedAt` differs on every single call by
   construction, so the guard could never actually skip anything; every debounced flush produced a
   new `savedAt` and a new `localStorage` write regardless of whether `prefs` itself had changed.
   Fixed to compare `filterPrefsCanon(safe)` (prefs content only) against a module-level
   `filterPrefsLastWrittenPrefsCanon`.
4. **Missing `.catch()` on the pre-mount hydrate.** The bottom-of-file
   `FilterPrefsStore.hydrate().then(() => { ...mount... })` had no failure path. `hydrate()` can't
   actually reject today (a synchronous `localStorage` read in a `try`/`catch`), but its own comments
   describe it as scaffolding for a future async backend, where an unhandled rejection would mean the
   app never mounts at all. Fixed by extracting a `mountApp` function and changing to
   `FilterPrefsStore.hydrate().then(mountApp, mountApp)`, so a hydrate failure still mounts with
   defaults instead of leaving a blank page.
5. **Pre-existing gap, not a regression: stale multi-select filter values were never pruned.** None
   of the 7 multi-select filter fields (`selectedSubTrades`, `selectedAnalysts`,
   `selectedMktgAnalysts`, `selectedCoasts`, `selectedLanes`, `selectedSaleWeeks`, `selectedYards`)
   were ever pruned when a previously-selected value fell out of the current dataset (an analyst who
   left, a lane no longer serviced). Before persistence existed this was cosmetic — everything reset
   to `[]` on reload anyway — but now that selections survive reloads, a stale value can silently
   filter the whole table to zero rows on every future visit, indefinitely, with nothing on screen to
   explain why. Fixed with a new reusable hook, `usePruneStaleSelection(selected, setSelected,
   available)`, called once per field right after each field's own `available*` memo, gated on
   `available.length > 0` so it never clobbers a restored value before real data has loaded (same
   reasoning as the yard mount-guard effect above). `selectedApStatuses` is deliberately NOT pruned —
   it's a hardcoded 2-value whitelist, not data-driven.

Also fixed the same day, unrelated to `FilterPrefsStore` itself: **`.github/workflows/ci.yml` was
running the full check suite twice per push.** `push` used to trigger on `branches: ['**']`, so every
push to a branch with an open PR ran the full suite once for `push` and once for `pull_request`
synchronize on the same commit. Per Kevin's explicit choice, `push` is now scoped to `branches:
[main]` only; `pull_request` still covers ordinary branch work.

**Testing.** `Filter_Persistence` (Suite 12) grew four new/extended checks to cover items 1, 2, 3 and
5 above directly (item 4 is infra with no observable client-side behavior to assert on, and the CI
double-run fix isn't a runtime check): a new scenario seeding an all-default-shaped-but-validly-
versioned blob asserts the banner does NOT appear (item 1); the existing live-toggle scenario now
boots with a real filter already active so its "does topPanelCollapsed:true actually get written"
check is a genuine regression test for item 2, and reuses that same instance for two quick clicks
that land back on already-stored content, asserting the stored blob's own `savedAt` does not change
(item 3); the existing corrupted-blob scenario now seeds one real value plus one stale one
(`'ZZZFAKE-LANE'`) into `selectedLanes` and asserts only the stale one gets pruned once real data
loads (item 5, and see that scenario's own comment for why one field's coverage reasonably stands in
for all 7 — `usePruneStaleSelection` is one shared hook, not seven separate implementations). Every
new/changed check was read against its own live output, not just trusted green — in particular item
3's check confirms `savedAt` is byte-for-byte identical before and after the bounce (not merely that
the prefs content looks unchanged), which is what actually distinguishes "the write was skipped" from
"a redundant write happened to settle on the same values." As with the entry above, read this suite's
own header comment and hardcoded tripwire (`EXPECTED_RECORD_COUNT`, right below the suite's opening
comment block) for its current executed-check count rather than trusting a number written down here —
it was 36 before this pass, and this file has been burned before by a stale count (see AGENTS.md's
"Check the executed-check count, not the pass rate"). `tests/ci_regression_runner.js`'s own
`EXPECTED_TOTAL_CHECKS` was updated in the same commit, and two full runs both confirmed exit code 0
with every executed check passing (169/169): one against the source file, and one against the
rebuilt `dist/index.html` artifact (`BF_APP_HTML=dist/index.html BF_VENDOR_CDN=1 node
tests/ci_regression_runner.js`) — this pass touched tests and docs only, not the app file itself, so
the artifact was simply rebuilt fresh from the unchanged source and behaved identically, as expected.

## Masthead layout pass (2026-09-24): Clear Filters relocated, macro-grid "Hide X" height bug fixed, "white lines" re-confirmed already fixed

From a team status meeting (Adam Cosner, Kevin Lee, 4 others), working from a live screenshot Kevin
marked up with red circles/arrows over the tab-bar and masthead rows. Four asks, three of them
concrete UI fixes and one a status check on a previously-reported bug:

1. **"Relocate the clear filters inside the box in the top right corner."** The tab-bar row (Compare/
   tab buttons, Hide Filters, AP Frozen/AP Only, Coast, Fields) had accumulated enough controls over
   several prior passes (see this file's own history of that row) that Adam called it "too compacted,
   making navigation difficult." Kevin's markup drew an arrow from Clear Filters up to the masthead's
   Historical Data/Analyze/Settings cluster, landing specifically between Analyze and Settings — Clear
   Filters now renders there (see that button's own comment in the app, near the Analyze button), using
   that row's existing `gap-3` for spacing instead of the `ml-1` it needed in its old spot. Pure
   relocation: same `onClick={clearSlicers}`, same styling, still unconditionally visible.

2. **"Align the two interface buttons side by side on the right" / "Ensure buttons maintain uniform
   vertical dimensions during selection."** Zooming into the actual screenshot (not just reading the
   transcript) showed exactly what "layout inconsistencies caused by selected buttons expanding to
   display 'hide' text" meant: the on-page macro-button grid (Detail/POL Booking Flash, `grid grid-
   cols-2`) had its "Operational Issues" cell showing "Hide Operational Issues" wrapped across 3 lines
   while every sibling cell stayed at 1-2 lines. A CSS grid row sizes to its tallest cell, so that one
   button — the only label long enough for "Hide " to push it to a 3rd line at this grid's 9px font —
   stretched its whole row, including its unrelated row-mate ("Sector Allocation"), taller the instant
   it was toggled on. Every other label in both grids was short enough that this was invisible, which
   is exactly why it read as "inconsistencies" rather than one obviously broken button. Per Adam's own
   sign-off ("dropping the 'hide' text in favor of keeping buttons green is acceptable if spacing
   requires it"), `MacroToggleBtn` (app file, ~line 2951) no longer prepends "Hide " — it always shows
   the bare label and relies on its existing green/grey background as the state signal, with a new
   `title` attribute carrying the on/off meaning that used to be in the text.

3. **"Debug and resolve white line display issues occurring during tab isolation on the Booking Flash
   tab."** This is very likely the SAME bug as the "Booking Flash/Detail: stray 'VMS' row rendering
   above a real vessel row" entry a few sections up this file (2026-09-21, three days before this
   meeting) — Kevin's own words there, "these white lines that are appearing randomly," match closely,
   "tab isolation" is this app's own term for using a slicer to isolate/filter down to one value (see
   every `SlicerBtn`'s `title="Click to isolate..."`), and the original repro was found by filtering to
   one specific lane. Rather than assume the transcript was simply relaying a stale report, this was
   re-verified live from scratch, per this file's own repeated lesson about not trusting a fix without
   re-running it: uploaded the real 9-day historical archive
   (`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`), switched to the Booking Flash
   (Detail) tab, and filtered to Sub Trade TA / Lane AL5 (the exact lane the original screenshots'
   circled VVDs belonged to). Result: 18 sale weeks (2026/W29 through W46), each rendering exactly one
   row — zero duplicated sale weeks — with 2026/W45 correctly showing the single real `CGBT0016E` /
   `CMA CGM BLUE WHALE` row (not a stray `VMS`/`VMS` ghost row above it) and every week with no real
   nomination yet correctly keeping its lone VMS placeholder. The 2026-09-21 fix (dropping a VMS row
   once a non-VMS row exists for the same trade/subTrade/lane/saleWeek, ~line 9204) is confirmed still
   present and still working after this pass's other two edits — no code change was needed here, only
   verification. This closes the "worth running suite 4 for real... before calling this fully closed"
   caveat left on the original fix entry, using a live targeted repro rather than the standing
   regression suite (which only exercises the single-day sample export, not the multi-day archive this
   bug needs).

4. Kevin's own explanation that "field and macro buttons operate identically" (the Fields picker and
   the on-page macro-button grid both drive the same `useFieldVisibilityPref` state) was context, not a
   new ask — that toggle (`macroButtonsInFieldsOnly`) already shipped 2026-09-21.

**Verified**: syntax check clean; full live regression suite 169/169 against both the source file and
the rebuilt `dist/index.html` artifact (`BF_VENDOR_CDN=1`, historical + sector fixtures pinned) — the
suite's own setup step finds and clicks Clear Filters by its exact text on every run, so item 1's
relocation is exercised by existing coverage, not just a targeted check. Items 2 and 3 were verified
with a live, targeted Playwright script (real historical-CSV upload, real slicer clicks, measured
pixel heights and DOM row counts) rather than reasoned about — screenshots taken before/after are
attached to the PR description. `node scripts/build_deployable.js --check` confirms `dist/index.html`
matches the final source.

## Masthead layout pass, round 2 (2026-09-24, same day): Clear Filters wasn't done moving, Coast comes back out of the tab-bar row, macro grid reordered

Kevin's markup on a fresh screenshot of the round-1 result (the masthead having Clear Filters between
Analyze and Settings) drew a new arrow — not confirming that placement, but pointing further down,
from Clear Filters past Analyze/Settings, landing in the upper-right corner of the main slicer box
below (the panel holding SPC PIC/MKG PIC/Sub Trade/Lane/Sales Week). Round 1's masthead placement
was an intermediate stop, not the final destination. Three asks this round, all sourced from that
same screenshot:

1. **"Relocate the 'Clear Filters' button to the upper right-hand corner of the slicer box."** Moved
   again, out of the masthead entirely, into the main slicer panel itself, as an `absolute`-positioned
   corner badge (the panel gained `relative` for this). **First attempt shipped with no live check and
   was wrong**: it assumed there'd be enough slack for the badge to float over empty space, with no
   reserved room. Live-checked before committing anything (per this file's own repeated lesson about
   verifying UI changes against real data before calling them done) at 1366x768/1600x900/1920x1080 with
   `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` loaded — it collided with Sub Trade's own buttons at
   every single width. That row was already documented, a few lines below in the same file, as running
   with as little as ~15px of slack at 1600x900 — nowhere near enough for a ~110px button. Fixed by
   reserving space instead of hoping content stays clear: the first slicer row gets `mt-7`, pushing every
   row down below the badge's own height (flex items don't margin-collapse against a flex-column parent's
   padding, so this holds at any viewport width) rather than trying to keep the badge out of the row's
   way. Re-verified after the fix: zero overlap against any button/label in the panel, at all three
   widths, on both Detail and POL Booking Flash.

2. **"Move the 'Coast' slicers back into the main slicer box."** Coast had its own second copy in the
   tab-bar row (added 2026-09-20, next to Clear Filters/AP Frozen/AP Only — see that day's entries).
   That copy is now gone; the main panel already had its own Coast implementation, previously gated to
   "not Detail/POL" because those two tabs had the tab-bar copy instead — un-gating it to cover every tab
   means there is exactly one Coast implementation left in the file, not two that could silently drift
   apart the way `MACRO_GRID_ORDER`'s hand-written arrays were already flagged as a risk for elsewhere in
   this file. AP Frozen/AP Only stay in the tab-bar row — Kevin's ask was Coast specifically, not the
   whole group.

3. **"Reposition the 'AC' and 'AP' macro buttons so that they are placed above the other macro
   buttons."** No button in the macro grid is literally labeled "AC" or "AP" — read as shorthand for
   Activity and AP Status, the only two labels that plausibly match (AP Status is the only button
   starting with "AP"; no button starts with "AC" at all, and Activity is the closest visual/phonetic
   match among the remaining eight: Rotation, Trade Breakdown, Voyage Remarks, DG Volume, Sector
   Allocation, Operational Issues, BSA, Reefer). This reading is flagged rather than asserted — if wrong,
   it's a one-line fix to `MACRO_GRID_ORDER.detail` (see its own comment). AP Status was already first;
   moving `activity` from position 4 to position 2 puts both in the grid's top row. Scoped to the Detail
   tab only — that's the tab the screenshot showed, and POL Booking Flash's own `MACRO_GRID_ORDER` entry
   doesn't even list `apStatus` (it gets appended at the end there instead of a chosen position), so
   reordering it too would have been a guess nobody asked for.

The user's message also said "do this with 4 agents if needed." Not used — these three changes touch
adjacent/overlapping regions of the same file (the masthead, the tab-bar row, and the main slicer panel
all sit within ~700 lines of each other), and this file's own history already has a documented case of
exactly this failure mode: splitting genuinely related work across parallel agents in separate worktrees
risked real merge conflicts on the same lines with no clean automatic reconciliation (see the
2026-09-14 "Booking Flash table" entry's own caveat, and the Sector-fixture entry's near-identical
warning). Implemented directly in one pass instead, each of the three changes verified independently
before being folded together — the discovery of item 1's real overlap bug (bullet 1 above) is a direct
product of that verify-before-shipping discipline, not something a parallel multi-agent split would have
caught any faster.

**Verified**: syntax check clean on every intermediate state; full regression suite 169/169 against both
the source file and the rebuilt `dist/index.html` artifact (`BF_VENDOR_CDN=1`) on the final combined
state, matching the expected count exactly; live screenshots at three viewport widths and two tabs
(Detail, POL Booking Flash) confirm no visual regressions from round 1's work. Committed as two changes
(Clear Filters + Coast relocation together, since their edits share the same lines in the main panel's
opening rows and aren't cleanly separable; the macro-grid reorder separately, since it touches an
unrelated, independent array) rather than one, so either can be reverted on its own if Kevin wants one
part but not the other.

## Masthead layout pass, round 3 (2026-09-24, same day): Clear Filters shrunk to match the slicer chips; AP Frozen/AP Only moved into the macro grid itself

Two more, smaller follow-ups on the same day's thread.

**Clear Filters, per Kevin: "make the clear filters slicer button smaller and match the style of the
other slicers."** It was still sized/styled like the masthead buttons it used to live among (px-2.5/
py-1/text-xs/font-bold/rounded-sm, a custom drop shadow, a solid hover color) even after round 2 moved
it into the slicer panel's corner. Restyled to mirror `SlicerBtn`'s own classes as closely as a plain
button reasonably can (text-[11px]/font-semibold/px-1.5 py-0.5/no rounding/`shadow-md shadow-black/20`/
`hover:brightness-110`) rather than rebuilding it as an actual `<SlicerBtn>` -- that component's
isSelected/isFilterActive/isValid props model a toggleable filter chip, which Clear Filters isn't (a
one-shot action, never "selected"). Background/text color kept as-is -- the ask was size/style, not
color, and the dark color is what marks it as the one non-filter action in the panel. Verified live: an
identical 22.5px height and 11px font-size to a real SlicerBtn (checked against the Lane "AN2" chip).

**AP Frozen / AP Only, per Kevin: "move the AP buttons right on top of the macro box above AP Status
and Rotation and match the size and style of the other macro buttons."** These moved out of their tab-
bar-row group (where Coast used to sit alongside them, until round 2 moved Coast out) and became the
literal first row of each macro-button grid -- POL's and Detail's -- placed as two grid items rendered
before `macroGridToggles.map(...)`, not folded into that derived array. They're still SLICERS (filtering
`selectedApStatuses` via `toggleFilter`'s isolate/multi-select convention), not field-visibility toggles
like every other cell in that grid, so `FIELD_TOGGLES`/`macroGridToggles` stay untouched -- correctly
keeping "what's in the grid" separate from "what's derived from field-visibility state," per that
array's own comment about being the one place a grid button doesn't come from FIELD_TOGGLES.

A new presentational component, `ApStatusMacroBtn` (defined right after `MacroToggleBtn`), carries this:
same box treatment as a real macro button (border, p-0.5, text-[9px], h-full, no shadow) with the
underlying click/select/fade logic passed in as props from the main component, same division of
responsibility `MacroToggleBtn`/`macroGridToggles` already use. Not built on `SlicerBtn` for the same
reason as Clear Filters above -- its hardcoded sizing/shadow classes would need fighting via
`extraClass` rather than actually matching the macro grid's flat, bordered-cell look. AP Frozen/AP
Only's own established colors (`bg-[#DA9694]`/`bg-[#ffc000]`, used elsewhere in this file for row
highlighting) were kept rather than switched to a MacroToggleBtn-style green/grey on/off pair -- "match
style" was read as box/border/font treatment, not color semantics that carry meaning elsewhere in the
app.

**A real scare that turned out to be nothing, worth recording as its own lesson.** A first live check
measured AP Frozen's row at 17.25px against a `Rotation` row it picked for comparison at 28.5px --
looked like exactly the same row-height-inconsistency bug fixed earlier this same day (see "round 1"
above), and briefly read as a second instance of it. A `getComputedStyle`/`gridTemplateRows` dump before
touching any code showed the real picture: `AP Status` (a fair, same-length comparison) ALSO measures
17.25px, identical to `AP Frozen` -- the 28.5px `Rotation` row is only taller because its row-mate,
`Trade Breakdown`, wraps to 2 lines, exactly the same pre-existing, correct, content-driven row auto-
sizing every other row in this grid already has (Voyage Remarks/DG Volume and Sector Allocation/
Operational Issues rows are 28.5px for the identical reason). A zoomed screenshot using LANCZOS resizing
had independently made the AP Status row LOOK taller than the AP Frozen row to the eye, which is what
prompted checking in the first place -- a second screenshot cropped with nearest-neighbor scaling
(no interpolation blur) confirmed the two rows render pixel-identical in height. The lesson isn't "don't
trust a zoomed screenshot" in general -- every other verification in this file's history has relied on
exactly that technique successfully -- it's that a LANCZOS (interpolated) resize can introduce enough
blur at small text sizes to distort a height judgment call specifically, where nearest-neighbor
(uninterpolated) scaling or raw `getBoundingClientRect` numbers don't. Caught before it became a wasted
fix only because the raw pixel data was checked before writing any code, not after.

**Verified**: syntax check clean; full regression suite 169/169 against both the source file and the
rebuilt `dist/index.html` artifact (`BF_VENDOR_CDN=1`); live checks confirm AP Frozen/AP Only render
directly above AP Status/Rotation on both Detail and POL Booking Flash, render exactly once each (no
leftover duplicate from the old tab-bar-row location), and the isolate/multi-select filter behavior
(aria-pressed, sibling opacity-40 fade) is unchanged from before the move.

## Masthead layout pass, round 4 (2026-09-24, same day): Clear Filters back in the row, then pinned to the true right edge

Two requests in immediate succession, the second arriving as a correction to the first before it was
even committed.

**First: "make it so Coast, SPC & MKG PIC and Clear Filters fit all on 1 line."** Round 2's corner-badge
placement (absolute-positioned, with `mt-7` reserved space on the row below) technically didn't put
Clear Filters ON the same line as Coast/SPC PIC/MKG PIC -- it floated above them, in its own reserved
strip. Moved back into the row's normal flex flow, initially placed right after MKG PIC's div and before
Sub Trade's, on the theory that Sub Trade (not one of the four things Kevin named) should be the one to
wrap away first if the row got tight.

**A real, two-step "chase the last few pixels" story, both steps caught live before either shipped.**
First live check at 1366x768 (the narrowest width this row has ever been verified at) found Coast/SPC
PIC/MKG PIC on line 1 but Clear Filters alone wrapped to line 2 with Sub Trade -- not what was asked.
Measuring precisely (not eyeballing) found the button was 89.73px against exactly 89.86px of space left
after MKG PIC -- missing by 0.125px, a rounding-level gap. Also found along the way: the button's own
padding (`px-1.5`) was never actually a precise match for `SlicerBtn`'s real padding (`px-1`) despite
round 3's own comment claiming it mirrored SlicerBtn's classes -- fixing the padding (px-1.5 -> px-1)
both closed part of the gap AND made it a truer match to "the style of the other slicers," Kevin's
earlier ask. Re-measuring after that fix found the button now fit within the row's raw remaining width,
but the row's own `gap-x-1.5` (6px) between MKG PIC and Clear Filters pushed the actual requirement back
over budget -- a second, smaller shortfall the first fix's math hadn't accounted for. The row's shared
`gap-x-1.5` dropped to `gap-x-1` instead of shrinking the button past SlicerBtn's real padding -- affects
all four gaps in the row uniformly, netting more saved space before Clear Filters than the ~2px still
needed. Both fixes were verified against a live, real-data page after being applied, not assumed correct
from the arithmetic alone -- the second shortfall existed precisely because the first fix's arithmetic
(raw available width vs. button width) had missed the gap's own contribution.

**Second, immediately after: "Clear filters should be in the right hand corner."** The "fit on 1 line"
placement (right after MKG PIC, before Sub Trade) put Clear Filters in the corner only in the narrow
case where Sub Trade ALSO didn't fit on the line. Checked at a wider viewport (1920x1080, POL Booking
Flash) where Sub Trade DID share the line too, and Clear Filters ended up sandwiched between MKG PIC and
Sub Trade instead of at the row's true right edge -- caught live, which is what the "right hand corner"
follow-up was responding to. Fixed by moving Clear Filters to the actual END of the row (after Sub
Trade, not before it) with `ml-auto`: auto margins resolve AFTER the browser decides line breaks, so an
item's own content size (not its margin) determines which line it lands on -- putting Clear Filters last
means `ml-auto` always pushes it to this row's right edge, on whichever line it ends up on, rather than
only when Sub Trade happens to not fit. Trade-off, accepted deliberately: at the very narrowest widths
this can now mean Clear Filters is what wraps to its own line (right-aligned there too) instead of Sub
Trade -- the reverse of the first attempt's priority -- but "right hand corner" unconditionally was
Kevin's clearer, more recent ask, and the outcome still reads as clean: at 1366x768/1600x900 on Detail,
Coast/SPC PIC/MKG PIC/Sub Trade share line 1 exactly as they did before Clear Filters ever joined this
row, and Clear Filters sits alone on line 2, flush against the right edge.

**Verified**: `distanceFromRightEdge` (row's right edge minus the button's own right edge) measured
exactly 0px at 1366x768, 1600x900 (Detail) and 1920x1080 (POL Booking Flash) -- Clear Filters is flush
against the corner at every checked width, unconditionally, not just when other content happens to leave
room. Zero overlap against any button/label at any checked width. Full regression suite 169/169 against
both the source file and the rebuilt dist/index.html artifact (BF_VENDOR_CDN=1).

## Masthead layout pass, round 5 (2026-09-24, same day): a code-review pass catches Clear Filters going unreachable when the panel collapses; plus two smaller findings

Ran `/code-review` against PR #116 (the whole masthead/filter-panel layout pass, rounds 1-4 above) before
any further layout work, on the theory that four rounds of the same button being moved through five or
six different DOM locations in one day is exactly the shape of change most likely to have silently broken
an earlier, unrelated invariant along the way. It had.

**Confirmed finding: Clear Filters had become unreachable whenever "Hide Filters" was clicked.** Round
4's "pinned to the true right edge" version (see directly above) put Clear Filters inside the main
slicer panel's own row, after Sub Trade -- and that whole panel, Clear Filters included, is gated by
`{!topPanelCollapsed && (...)}`. Round 2 (see that section above) had *removed* Clear Filters from the
masthead specifically because Kevin asked for it "in the upper right-hand corner of the slicer box," and
every version since has lived inside that box -- so nothing in rounds 2-4 re-checked whether the box
itself could disappear out from under it. It can: that is exactly what "Hide Filters" does. The bug was
real, not just theoretical -- reproduced live: select any filter, click "Hide Filters," and Clear Filters
vanishes along with the rest of the panel, so the only way to clear a filter is to first reopen the panel
you were trying to collapse. This is HANDOFF's own documented bug class 6 ("topPanelCollapsed: true +
active filters hides the very chips needed to clear them"), reintroduced via live UI interaction this
time instead of a restored preferences blob, and it directly contradicted a comment that has sat in this
file's masthead section since 2026-09-14 asserting Settings "stays reachable exactly like Clear Filters
already did, regardless of collapse state" -- a comment every round since round 2 left in place, unaware
it had gone false. Not caught by `tests/booking_flash_regression_tests.js`: its one Clear Filters lookup
runs once at suite setup, before `topPanelCollapsed` is ever toggled true, and does `if (clearBtn) {...}`
with no assertion that it was found -- a null match fails silently.

Fixed by rendering a second copy of the button in the tab-bar row (never gated by `topPanelCollapsed` --
same reason Settings and the "Hide Filters" toggle itself both live there), shown only while
`topPanelCollapsed` is true; the in-panel copy from round 4 is unchanged and keeps rendering only while
the panel is expanded. The two conditions are exact opposites, so exactly one copy is ever mounted --
Clear Filters is reachable in both states without ever appearing twice. Not merged into one shared
component: the two copies' styling legitimately differs (the panel copy uses `self-start ml-auto` to
reach that row's own right edge; the tab-bar copy is a plain row item with a small left margin, closer to
where Clear Filters lived before round 1 ever moved it), so a shared component would need a style prop
for barely less code than writing the button twice -- see the tab-bar copy's own comment for the fuller
reasoning.

**Separately, per Kevin: "buttons maintain uniform vertical dimensions during selection."** Rather than
assume round 1's `MacroToggleBtn` height fix (dropping the "Hide " prefix) was the only place this bug
class could hide, live-checked every selectable button group on the Detail tab -- `ApStatusMacroBtn`
(AP Frozen/AP Only), every `MacroToggleBtn` grid cell including the two known to wrap to 2 lines
(Operational Issues, Voyage Remarks, Sector Allocation, Trade Breakdown), and every `SlicerBtn` group
(Coast, SPC PIC, MKG PIC, Sub Trade) -- by reading each button's real `getBoundingClientRect().height`
before and after clicking it to select, then again after deselecting. A first pass of this check produced
confusing, seemingly-contradictory results (Coast and Sub Trade resolving to the exact same three
buttons; a "Voyage Remarks" lookup reporting "not found"); triaged the same way this file's own flakiness
section prescribes for the regression suite -- ruled out a harness-side bug before concluding anything
about the app -- and found two real bugs in the *verification script*, not the app: the heading-to-
container lookup walked up to a shared ancestor spanning multiple slicer groups instead of stopping at
the specific group's own wrapper div, and the click step used Playwright's substring-matching `hasText`
locator while the height read used an exact-text match, so for short labels the two could target
different buttons. Fixed the script (exact-text lookup end to end; container resolved from the heading
span's own `parentElement`, matching the actual JSX structure) and re-ran: every group, on both its
before-selection and after-selection height, matched exactly (down to the sub-pixel) across all ~30
buttons checked. **No app code change was needed here** -- round 1's fix already covers this class of bug
correctly, and nothing in rounds 2-4's moves (relocating buttons, not restyling them) reintroduced it.
Recorded here rather than silently doing nothing, per this file's "verify against real data before
reporting" rule -- a suspicion investigated and not confirmed is still worth writing down.

**Verified**: syntax check clean. Full regression suite 169/169 against both the source file and the
rebuilt `dist/index.html` artifact (`BF_VENDOR_CDN=1`). Live-verified the Clear Filters fix directly:
exactly one Clear Filters button exists at all times (never zero, never two) across expanded and
collapsed panel states; clicking it while collapsed still clears the active filter (confirmed by
re-expanding afterward and reading the cleared button's own `aria-pressed`, not just that the click
didn't throw).

### Addendum, same review pass: dedupe the AP Frozen/AP Only pair

The same code review flagged a second, smaller finding, fixed separately (its own commit, since it's an
unrelated code-quality cleanup, not a behavioral bug -- see this file's "one commit per confirmed bug"
rule): the two-button AP Frozen/AP Only pair (`ApStatusMacroBtn` x2, added round 4) was copy-pasted
byte-identical between the POL grid and the Detail grid. Extracted into a new `ApStatusMacroPair`
component (defined right after `ApStatusMacroBtn`, takes `selectedApStatuses`/`toggleFilter`/
`setSelectedApStatuses` as props rather than closing over them, matching every other top-level component
in this file) and both call sites now render that instead -- exactly the hand-synced-copy drift this
file's own comments elsewhere (e.g. `MACRO_GRID_ORDER`'s header) warn about, closed before a future AP
Frozen/AP Only edit (already changed four times in one day per round 4's own entry above) had the chance
to update one copy and forget the other. No behavior change -- verified by diffing the two grids' rendered
output (bg colors, labels, aria-pressed, isFaded/opacity, click targets) before and after the extraction,
identical in both. Syntax check clean; full regression suite 169/169 against both the source file and the
rebuilt `dist/index.html` artifact (`BF_VENDOR_CDN=1`).

## Masthead layout pass, round 6 (2026-09-25): Clear Filters back to a corner badge, per a marked-up screenshot

Round 5's "fit on 1 line" work (see that entry above) had moved Clear Filters into the flow of the main
slicer panel's first row, pinned to that row's own right edge via `ml-auto`. Kevin sent a follow-up
screenshot of the live app with an arrow pointing at the button: "the clear filter buttons needs to be in
the upper right corner of the slicer box."

**Why the round-5 placement didn't satisfy this, even though it also used the word "corner."** `ml-auto`
inside the row only pushes Clear Filters to the right edge of THAT row, inside THAT box (the left-hand
filters panel, `flex-1 min-w-0 bg-[#e7e6e6]...`). It does not reach the true top-right corner of the box
as a whole, and it never reads as "the corner" the way an actual corner badge does -- in the screenshot it
sits sandwiched between Sub Trade and the AP-status/macro-grid box (a sibling box further right in the
same outer flex row), which is exactly what the arrow was pointing at. This is a different, more literal
reading of "corner" than round 5's -- not a regression, a correction.

**Fix:** reverted to the absolute-positioned corner badge this box used between round 2 and round 4 --
`absolute top-1.5 right-1.5 z-10` on the panel box itself (with `relative` restored on that box's own
className so the positioning resolves against it), keeping round 3's sizing (`px-1 py-0.5 text-[11px]
font-semibold`, matching `SlicerBtn`'s real padding). `mt-7` restored on the first slicer row to reserve
the vertical space the badge needs -- the same fix round 2's own first attempt needed after shipping
without it and colliding live with Sub Trade's buttons. The row's `gap-x-1` (tightened in round 5
specifically to make room for Clear Filters sharing that line) reverted to `gap-x-1.5`, the 2026-09-18
value tuned for Sub Trade alone -- the button that needed the extra 2px is gone from this row again. Per
Kevin's own follow-up ("It's okay if Sub Trade is on a line by itself"), no further gap-squeezing was
chased to keep Sub Trade on the shared line at narrow widths.

The tab-bar row's second copy (added in round 5's own code-review addendum, so Clear Filters stays
reachable while `topPanelCollapsed`) is unrelated to this correction and unchanged -- it still renders only
while the panel is collapsed, the in-panel corner badge only while expanded, exactly one ever mounted.

**A live-verification bug caught along the way, same class as before:** the first check script used
Playwright's `hasText: 'Booking Flash'` to click the Detail tab, which also substring-matches the "POL
Booking Flash" tab button -- `.first()` silently clicked the wrong tab (POL Booking Flash renders first in
DOM order), so the first pass's "Detail tab" checks were actually re-testing POL Booking Flash. Caught by
inspecting the screenshot the check itself produced (wrong tab highlighted), not assumed correct from the
numbers alone. Fixed by switching to exact-text button matching for every tab click, plus an added
assertion that the active tab's own text matches what was asked for before trusting anything measured
after it -- the same fix already applied to the round-5 button-height verification script for the same
underlying `hasText` substring-collision class.

**Verified**: `distanceFromTop` and `distanceFromRight` (panel box edge minus badge edge) both measured
exactly 7px at 1366x768, 1600x900 (Detail, confirmed via the corrected tab-click assertion) and 1920x1080
(POL Booking Flash) -- identical at every width, confirming the badge's position doesn't depend on how the
row below it wraps. Zero overlap against Coast/SPC PIC/MKG PIC/Sub Trade at any checked width. Clicking
Clear Filters still clears an active filter (AP Frozen's `aria-pressed` confirmed `false` afterward) at
every width. The panel/tab-bar dual-copy collapse-gate fix from round 5 re-verified unaffected: exactly one
Clear Filters button exists in both the expanded and collapsed panel states. Syntax check clean. Full
regression suite 169/169 against both the source file and the rebuilt `dist/index.html` artifact
(`BF_VENDOR_CDN=1`).

### Masthead layout pass, round 7 (2026-09-25): Coast/SPC PIC up a row, macro buttons widened

**Alternating row shading tried and explicitly rejected first.** Before this round, Kevin asked to see
alternating zebra shading on the Booking Flash/POL Booking Flash tables (neither had ever had any --
`getBg`'s "plain column" branch and POL's per-row `bg` were both a flat `bg-white`/empty string for every
non-VMS/non-AP-status row, confirmed by grep, no `nth-child` CSS anywhere in the file either). Implemented
over two rounds (bg-gray-100, then bg-gray-200 for more contrast, verified via `getComputedStyle` alternating
`rgb(255,255,255)`/`rgb(229,231,235)` in lockstep with each row's array index), screenshotted, and Kevin
said "lets undo the row shading" before it was ever committed -- reverted via `git restore` (nothing had
touched origin). Documented here only so a future agent doesn't re-propose the same thing without knowing
it was already tried and declined.

**Two real changes, from a marked-up screenshot: "move the coast, the SPC PIC slicers up one line... widen
the macro buttons more so all the words... fit on one line... its only if lane doesn't fit on one row."**
Read literally, "up one line" and the macro-button width tradeoff both had multiple plausible readings that
would have produced substantially different diffs -- asked via `AskUserQuestion` rather than guessing,
given this exact panel's history (rounds 1-6, all in this file) is a record of guessed-wrong layout changes
needing a follow-up correction. Kevin confirmed both:

1. **Coast+SPC PIC split into their own row, MKG PIC+Sub Trade a second row right below.** The four-item
   row (Coast/SPC PIC/MKG PIC/Sub Trade) carried `mt-7` (~28px) solely to reserve clearance under the
   absolutely-positioned Clear Filters corner badge (round 6, above) -- round 2's first corner-badge attempt
   collided with this exact row before that margin existed. Splitting removes the need for the margin a
   different way instead of just deleting it: Coast+SPC PIC alone never reaches far enough right to pass
   under the badge (which sits flush against the panel's own top-right corner), and MKG PIC+Sub Trade
   inherits clearance for free by being in normal flow below row 1. Verified live via
   `getBoundingClientRect`, zero overlap, at 1366/1600/1920px on both tabs. Net effect: Coast/SPC PIC render
   right under the tab bar instead of ~28px below it (the "move up one line" Kevin asked for); total panel
   height is unchanged, since the reserved gap didn't disappear, it became a real row.

2. **Macro-button grid column widened 140px -> 240px, explicitly accepting the tradeoff this steals from
   Lane.** This exact column has its own extensively-documented history (see the "Narrowed 400px -> 300px ->
   240px -> 140px" comment a few hundred lines up) of being narrowed specifically to free width for Lane's
   ~28 buttons to fit on one row without horizontal scroll -- even at the narrowest 140px setting, Lane still
   scrolled at 1366-1536px, a measured "hard floor." Widening it now directly reverses part of that. Flagged
   the conflict to Kevin explicitly before touching anything (`AskUserQuestion`, three options: widen only
   where Lane had spare slack / widen fully and accept more scrolling / don't widen at all) rather than
   picking a compromise unasked -- Kevin picked "widen it fully, accept more Lane scrolling." Measured the
   real minimum width rather than guessing: an isolated Playwright harness rendered this exact grid (real
   labels, real classes, the app's own vendored Tailwind build, loaded via a real `<script src>` tag --
   `addScriptTag`'s inline-content injection was tried first and silently compiled nothing, apparently
   because the Play CDN script reads `document.currentScript.src` to configure itself and that's empty for
   an inline-injected script) at a sweep of widths; every label (`Operational Issues` is the tallest pole)
   stopped wrapping at 215px, wrapped at 210px and below. Landed on 240px -- ~25px of headroom above that
   threshold, and not a new number: it's a value this exact column already used successfully earlier in its
   own history. Font/padding/gap all unchanged; width was the only lever. Lane's own scrollWidth-vs-
   clientWidth was deliberately NOT re-measured after this -- the regression was the explicit, informed ask,
   not a side effect to chase down.

Both changes are in the single shared filter-panel JSX that renders on every tab (per round 2's "no more
second copy to keep in sync" note), so there was only one place to edit for each, not two -- the "2 agents"
Kevin offered wasn't used; this repo's own history (three adjacent-region parallel-agent edits on this same
panel causing real merge conflicts, referenced in round 2 above) already argues against parallelizing
edits this close together in one file, and there was no genuine parallelism to gain here regardless, since
neither change decomposes into independent per-tab work.

**A regression-suite infrastructure issue found along the way, worth recording for future sessions in this
sandbox specifically**: `node tests/ci_regression_runner.js` (unlike this repo's own `perf_benchmark.js`
and every scratch Playwright script used throughout this session) does not default `executablePath` to this
sandbox's real installed Chromium (`/opt/pw-browsers/chromium`) -- unset, it tries Playwright's own default
resolution, which in this container resolves to a `chromium_headless_shell` build that isn't installed,
and the launch failure surfaces as a silent multi-minute hang with 0% CPU and no child Chromium process
(not a clean, fast error) when its own stdout is piped through `tail`/`head` in a background shell, because
Node fully block-buffers non-TTY stdout and nothing flushes until exit. Running it un-piped (redirected
straight to a file) surfaced the real, fast, well-labeled Playwright error in under 5 seconds:
`Executable doesn't exist at .../chromium_headless_shell-1243/...`. The script already supports exactly the
right fix, undocumented until now: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` (same override
`perf_benchmark.js`'s own `CHROMIUM_PATH` constant reads). A run with it set completed normally in ~50-175s
with real 169/169 results, both on an unmodified baseline and against this round's own diff -- confirming
this was a launch-configuration issue, not app flakiness, before it could be mistaken for either.

**Verified**: syntax check clean. Live regression suite 169/169 against both the source file and the
rebuilt `dist/index.html` artifact (`BF_VENDOR_CDN=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`) -- also
cross-checked once against an unmodified baseline (`git stash`) to confirm an earlier same-session 112/169
result (both failing suites hitting `fetch(location.href)` Setup errors in isolated iframe boots) was
run-to-run environmental noise and not caused by this round's diff, per AGENTS.md's own flakiness-triage
guidance -- the baseline run, and a clean re-run of this round's actual diff afterward, both came back a
clean 169/169. Layout verified live (Playwright, real upload, both tabs, 1366/1600/1920px): Coast/SPC PIC
row clear of the Clear Filters badge and every one of the 12 (Detail)/14 (POL) macro-button labels on one
line, at every width checked.

### Code-review pass on round 7 (2026-09-25): 6 confirmed findings, fixed with 6 parallel agents

Prompted by Kevin noticing the round-7 tradeoff materialize live ("I don't see the WIN service in the Lane
slicer") plus a `/code-review` pass on the round-7 diff (13 commits, 10 parallel finder angles). The review
surfaced 14 findings; Kevin asked to fix "all those issues with 6 agents." Six agents worked in parallel,
each on its own private scratch copy of the app file (never the live file directly) -- this repo's own
history (round 7's own note above, and earlier rounds referenced there) documents real merge conflicts from
multiple agents editing adjacent regions of this same monolithic file concurrently, so letting 6 agents
write to the shared file at once was avoided on purpose. Each agent designed and live-verified its fix on
its scratch copy, then handed back an exact patch (old_string/new_string); all 6 patches were applied
serially in the main thread, the full required-check suite was run ONCE against the fully combined result,
then the verified combined diff was split back into 6 separate commits (one per confirmed finding, matching
this file's "one commit per confirmed bug" convention) by reverting to a clean checkout and re-applying the
same patches in dependency order, verifying the reconstruction was byte-identical to the already-verified
combined state before committing.

1. **AP Frozen/AP Only became completely and permanently unreachable whenever Settings' "Grid: In Fields"
   toggle was on** (`b066734`/`f07f8f9`) -- the most severe finding. The macro-button grid column's gate,
   `!macroButtonsInFieldsOnly`, wrapped `ApStatusMacroPair` too, even though AP Frozen/AP Only are real row
   filters (not field-visibility toggles) deliberately excluded from `FIELD_TOGGLES`, so the "⚙ Fields"
   picker has no equivalent checkbox for them. Since the toggle persists to `localStorage`, anyone who ever
   enabled it lost the ability to filter by AP status at all, silently and permanently, with no UI path
   back. Fixed by splitting the gate: the column (and `ApStatusMacroPair`) now always renders on
   Detail/POL Booking Flash; only `macroGridToggles.map(...)` -- the part with an actual Fields-picker
   equivalent -- stays conditional. Verified live across all 4 combinations (2 tabs x 2 toggle states), with
   a byte-identical screenshot diff confirming zero visual change to the previously-working state.

2. **Lane row scroll affordance for WIN and other late-alphabet lanes** (`35fe72b`) -- the direct fix for
   what Kevin reported. `availableLanes` sorts plain alphabetically and "WIN" is 28th of 28 real lane codes;
   round 7's macro-button widening took ~100px from the Lane row's available width, and the row's existing
   `thin-scrollbar` gave no visible cue it was scrollable at all. Offered Kevin three options
   (`AskUserQuestion`: revert the widening / add a scroll cue / split the difference) rather than guessing;
   Kevin picked the scroll cue, keeping the wider macro buttons. Added a CSS edge-fade gradient driven by
   real DOM measurement (`scrollLeft`/`scrollWidth`/`clientWidth` via a `ResizeObserver` + scroll listener),
   shown only on whichever side(s) still have unscrolled content -- never shown when a viewport already fits
   all 28 lanes. Verified live at a scrolling width (1366px: fade appears, WIN unreachable before scrolling,
   reachable+clickable after) and a fitting width (2400px: no fade, all 28 lanes including WIN visible
   directly), plus dark mode.

3. **`ApStatusMacroBtn` had no `isSelected`-driven visual cue** (`b066734`) -- clicking AP Frozen changed
   nothing about AP Frozen's own chip, only its sibling's opacity faded, unlike every `SlicerBtn`-based chip
   in the app. Added the same `shadow-inner`/`shadow-md` convention `SlicerBtn` already uses. Same commit
   also deduped a 13-token box-styling string shared with `MacroToggleBtn` (`MACRO_BTN_BOX_CLASS`), deduped a
   second hardcoded copy of `SlicerBtn`'s tooltip text (`SLICER_TITLE`), fixed `ApStatusMacroPair` computing
   each `includes()`/`isFaded` lookup twice instead of once, added `AP_STATUS_CONFIG` so the pair derives
   from one array instead of two hand-written JSX calls, and corrected a stale `MACRO_GRID_ORDER` comment
   that still claimed AP Status/Activity render as the grid's top row (they haven't, since AP Frozen/AP Only
   became an unconditional first row on 2026-09-24).

4. **14px gap between the round-7 split filter rows, not the ~6-8px the introducing comment claimed**
   (`0bb0140`) -- a flex child's own `mt-1.5` (6px) and its flex-col parent's `gap-2` (8px) are additive, not
   merged. Confirmed live (14.00px measured, matching the math exactly) and fixed by dropping the redundant
   `mt-1.5` (8.00px after, from `gap-2` alone), verified visually as consistent with the panel's other 6px
   gaps. Same commit fixed a dangling comment on the Clear Filters corner badge that pointed at an `mt-7`
   margin removed the same day the row split in two.

5. **Tailwind JIT-priming never covered `opacity-40`/`opacity-100`/`opacity-70`** (`a2e9091`) -- these are
   written only as single-quoted strings nested inside a backtick template literal
   (`` `${isFaded ? 'opacity-40' : 'opacity-100'}` ``, used by `SlicerBtn` and `ApStatusMacroBtn`), and the
   priming mechanism's regex matches an entire backtick template as one token, so the nested substrings are
   never independently re-scanned. Confirmed two ways: statically (replaying the priming regex found all
   three classes absent from its token set) and live against the real Tailwind Play CDN JIT (no compiled CSS
   rule existed for any of the three before the fix; 533 -> 536 rules after). This is exactly the
   multi-second full-document-restyle bug class check 5 above exists to prevent -- without the fix, the
   FIRST filter/status chip fade anywhere in the app would have paid that cost live. Fixed with a minimal,
   non-regex addition: a plain string literal listing the three classes, placed where the priming script's
   existing literal scan already picks it up. Re-verified `tests/perf_highlight_benchmark.js` passes
   comfortably within budget afterward.

6. **Two hand-written "Clear Filters" buttons, duplicated apart from positioning** (`e08be43`) -- the
   tab-bar copy and the filter-panel corner-badge copy shared `onClick={clearSlicers}` and identical styling,
   with a comment explicitly declining to extract a shared component. Extracted `ClearFiltersButton`, taking
   `positionClass` as the one prop that legitimately differs; verified both call sites render byte-identical
   class strings to before. Also investigated (but found no fix needed for) whether the corner badge's lack
   of reserved layout space could let it overlap Row 1's content at a narrow viewport with Coast filters
   active -- measured 197px of clearance at 1366px with the row at its realistic maximum width (both
   available Coast values selected), on both tabs. Documented as confirmed-safe rather than speculatively
   changed.

**Not fixed, deliberately** -- flagged in code comments as real follow-ups rather than attempted here, since
each touches consumers well outside its own finding's scope: unifying `AP_STATUS_CONFIG` with the other
three places this file separately hardcodes the AP FROZEN/AP ONLY label/color triple (row-highlight logic,
the legend, the filter-restore whitelist); converting `ApStatusMacroPair`/the tab-bar Clear Filters copy to
always-mounted-plus-CSS-hidden (they're still genuinely mounted/unmounted on tab switches, just no longer on
the `macroButtonsInFieldsOnly` toggle after fix 1 above) -- the same pattern this file already uses for
Clear Highlights/Report Card, but auditing every `activeTab === 'detail' || 'pol_booking'` consumer in this
region to convert it safely was judged more surface than this pass's findings warranted.

**Verified**: syntax check clean on every intermediate commit. Live regression suite 169/169 against both
the source file and the rebuilt `dist/index.html` artifact, and `tests/perf_highlight_benchmark.js` within
budget on both (run once against the fully combined diff before splitting into commits, since that's the
state that actually ships -- the 6-way commit split was reconstructed byte-identical to that already-verified
state and confirmed via `diff` before committing, not re-verified 6 times independently).

## `SlicerClearBtn`: crisp SVG X-mark, plus a seasonal pumpkin hover easter egg (2026-09-25)

Two of Kevin's requests turned out to target the same component. One image showed the small gray-circle
"clear this filter group" button and asked for its `×` to render crisper; a separate image asked for a
seasonal icon on hover. Both landed on `SlicerClearBtn` -- the single shared component already used
identically in all 7 filter groups (Coast, SPC PIC, MKG PIC, Sub Trade, Lane, Sales Week, Yard) -- rather
than two separate changes.

**1. Icon replacement.** The plain unicode `×` glyph inside the circle was replaced with a hand-rolled
inline SVG X-mark (two crossed `<line>` elements, `stroke="currentColor"`), the same convention `OneLogo`
already uses elsewhere in this file -- this repo has no icon library and wasn't about to add one for a
single glyph. A unicode `×` rendered inconsistently crisp across browsers/zoom levels depending on the
system font; an SVG path doesn't have that problem.

**2. Seasonal pumpkin hover.** Hovering the same circle during a recurring window, September 25 -- October
31, swaps the X-mark for an 8x8 pixel-art jack-o'-lantern (`PumpkinIcon`, built from a
`PUMPKIN_PIXEL_GRID` string array of `<rect>` elements) and reverts to the X-mark on mouse-out. Two design
decisions worth recording for whoever finds this a year from now and wonders why it's here:

- **The window is computed from month/day via a helper, `isPumpkinSeasonToday()`, deliberately not a
  hardcoded 2026 date range.** A hardcoded range needs a code change every year and silently stops working
  the day someone forgets -- exactly the class of bug this repo's own version-detection heuristics (see
  AGENTS.md's check 1) have already been bitten by more than once. Computing it from today's month/day
  means it just works again next September with zero maintenance.
- **`IS_PUMPKIN_SEASON` is a module-level constant computed once, and the mouse handlers are literally
  `undefined` (not no-ops) when out of season** -- so outside the window there is no added cost on the
  common hover path, just the pre-existing gray background-darken. Click-to-clear (the existing 180ms
  "bubble pop" animation via `POP_MS`/`popping`) is unchanged regardless of which icon is showing.
- **`title`/`aria-label` (`Clear {label} filter`) are unchanged in both hovered states, on purpose.** No
  pumpkin-themed accessibility text -- an assistive-tech user should get the accurate, unchanged label
  whether or not a sighted user happens to be looking at a pumpkin that week.

**Verified**: syntax check clean against the auto-detected live file. Live-browser DOM verification
(Playwright, real `.xlsx` upload) on 3 of the 7 groups (MKG PIC, Coast, Sub Trade): exactly 1 `<svg>` child
and 0 literal `×` glyphs unhovered. On hover (MKG PIC, real date 2026-09-25, in-season): the pumpkin SVG
renders with exactly 46 `<rect>` elements, matching `PUMPKIN_PIXEL_GRID`'s own non-transparent character
count (2+4+6+8+8+8+6+4=46) -- proof the real pixel grid rendered, not a stand-in. Reverts to the X-mark on
mouse-out; clicking while the pumpkin is showing still clears the filter correctly (button unmounts,
chip's `aria-pressed` flips false); `title`/`aria-label` confirmed unchanged (`"Clear MKG PIC filter"`) in
both states. **Date-gate proof** via `page.clock.setFixedTime` (set before navigation, so the app's own
`Date` calls see it): forced to December 15, 2026 (outside the window) -- 0 pumpkin / 1 X-mark on hover,
gate correctly off. Forced to October 20, 2026 (inside the window, not the real "today") -- 1 pumpkin / 0
X-mark, gate correctly on. This is what actually proves the month/day logic gates behavior, rather than it
just happening to work on today's real date. Deploy artifact rebuilt (`scripts/build_deployable.js`,
source 1013 KB -> artifact 1437 KB) and `--check` passed; a smoke check against `BF_APP_HTML=dist/index.html`
reproduced identical behavior to the source. Full regression suite (both fixtures pinned): 169/169,
exactly matching AGENTS.md's current documented baseline (77 from Suites 1-9, 42 from Suite 10
`Preferences_Persistence`, 8 from Suite 11 `Field_Visibility`, 42 from Suite 12 `Filter_Persistence`) --
`Filter_Persistence` is the suite most directly relevant here, since it exercises the same filter-chip
selection/clearing UI `SlicerClearBtn` belongs to, and it passed in full including its own hardcoded
41-assertion tripwire. One full uninterrupted suite run took 3 attempts in this sandbox to land clean (a
resource-contention crash from an unrelated concurrent script, then a harness poll-timeout on the
iframe-heavy Suites 10-12, then a clean pass with the poll timeout widened in a scratch-only copy of the
runner) -- every check across all three attempts was 100% clean throughout, zero `❌ FAIL` at any point, so
this reads as the environment-timing flakiness AGENTS.md's own triage section already documents, not a
defect in this change.

## `SlicerClearBtn`'s icon, round 2: funnel+X replacing the SVG X-mark (2026-09-25, same day)

Kevin sent a reference image the same day as the entry above: a funnel/filter silhouette with a red X
overlapping it -- the conventional "no filter"/"clear filter" glyph -- asking for it in place of the plain
X-mark this button had shipped with a few hours earlier. `SlicerClearBtn`'s non-hover icon changed again;
the pumpkin hover behavior from the entry above is untouched.

**Vector attempt tried and rejected, live, before picking the shipped design.** The natural first build was
a smooth vector SVG -- a `<polygon>` funnel plus two crossed `<line>` elements for the X, scaled to fit this
button's existing 16px circle (the same `viewBox="0 0 24 24"` approach the X-mark itself used). Rendered at
real size in a real headless-Chromium screenshot before shipping, it anti-aliased into an illegible blob --
recognizably neither a funnel nor an X. `PUMPKIN_PIXEL_GRID` (the entry above) had already proven that crisp,
hard-edged pixel art holds up at this exact size where smooth vector detail doesn't, so the funnel+X was
rebuilt the same way: a 10x10 pixel grid (`FUNNEL_CLEAR_PIXEL_GRID`), rendered as an SVG of `<rect>`
elements with `shapeRendering="crispEdges"`, matching `PumpkinIcon`'s own pattern above. Iterated visually
(render at true 16px size, inspect, adjust) through several grid layouts before landing on one that reads
clearly as "funnel with something crossing it out" at actual size -- confirmed both via a zoomed screenshot
and, more rigorously, by counting `<rect>` elements and their fill colors in the live DOM (64 total: 48
`currentColor` funnel pixels, 16 `#ef4444` red pixels), not just eyeballing an image.

The button's own size (`w-4 h-4`, 16px) was deliberately left unchanged rather than grown to make room for
the more detailed icon -- growing it would touch all 7 call sites' surrounding layout in a filter panel
with an extensively documented history of pixel-tight fits at 1366px (see this file's own dated entries on
Clear Filters/Coast/MKG PIC row placement), and the pixel-art approach already reads clearly without that
risk. The icon element itself grew slightly within the existing circle (`w-3 h-3` -> `w-3.5 h-3.5`) to use
more of the available space.

**Verified**: syntax check clean. Live-browser DOM verification (Playwright, real `.xlsx` upload, real date
2026-09-25): unhovered state shows exactly 1 `<svg>` (`viewBox="0 0 10 10"`) with 64 `<rect>` children (48
`currentColor`, 16 `#ef4444`) -- matches `FUNNEL_CLEAR_PIXEL_GRID` exactly. Hovering still swaps to the
46-rect pumpkin (`viewBox="0 0 8 8"`) exactly as before, unaffected by this change; mouse-out reverts to the
64-rect funnel; `title`/`aria-label` unchanged throughout; clicking still clears the filter (button
unmounts). Full regression suite (`BF_VENDOR_CDN=1`, both fixtures pinned, launched with
`PW_CHROMIUM_PATH` pointed at this sandbox's actual vendored Chromium build -- the repo's own default
lookup targeted a newer Playwright browser version than what's installed here): **169/169**, matching
AGENTS.md's documented baseline exactly. As with the entry above, one full uninterrupted run needed the
same scratch-only widened poll timeout (180s -> 480s, repo file untouched) after an unmodified run hit the
harness's own timeout at 136/169 with zero failures -- same known sandbox-timing shape, not a defect.
Deploy artifact rebuilt (`scripts/build_deployable.js`, source 1015 KB -> artifact 1440 KB) and `--check`
passed; a smoke check against `BF_APP_HTML=dist/index.html` reproduced the exact same 64/46-rect behavior
as the source.

## POL Booking Flash: "Loadable Quant" header fully spelled out to "Loadable Quantity" (2026-09-25)

Per Kevin, from a screenshot of the POL Booking Flash tab: the column header abbreviated "Loadable
Quantity" down to "Loadable Quant". Cosmetic only -- the underlying field (`loadableQuant`, its `getVal()`
alias list, and every place raw data is read) is untouched; only display-facing text changed:

- The two-line header split map (`formatHeader2Lines`'s `manualSplits`) -- key and value both, since the
  key must match what's passed to `thLabel()` (`'Loadable Quant'` -> `'Loadable Quantity'`,
  `'Loadable<br/>Quant'` -> `'Loadable<br/>Quantity'`).
- The `thLabel('Loadable Quant')` call itself, and the matching `data-autofit-col="Loadable Quant"` on the
  column's `<td>` -- these two must stay byte-identical to each other (the autofit-sizing logic links a
  header and its cells by this exact string), so both were renamed together.
- `filterCell('loadableQuant', 'Loadable Quant')`'s label argument, which only ever surfaces as the filter
  input's `aria-label` ("Filter by Loadable Quant") -- invisible text, but the same rename applies for
  consistency.
- Two comments mentioning the column by its old display name in prose.

Deliberately NOT touched, and deliberately not a precedent for renaming any other abbreviated header in
this table (per Kevin: "let's not change the wording of the headers unless asked") -- this is a single,
explicitly-requested rename, not a cue to go spell out "RFR BKG TEU", "Max Ldn Vs POL Bkg", or any of this
table's other intentionally-abbreviated column names:

`loadableQuant: ['Measures Loadable TEU', 'Loadable Quant', 'Loadable TEU']`, the `getVal()` alias list
matching this field against the real spreadsheet's own column names, is also untouched -- it has nothing to
do with what this app displays, is Class E alias-landmine territory (see DATA_ARCHITECTURE.md), and editing
it without re-running `tests/check_alias_landmines.py` against a real export is exactly the mistake that
check exists to catch. This change never touched a `getVal()` call, so per AGENTS.md check 2 that script
did not need to run here.

**Verified**: syntax check clean. Live-browser check (Playwright, real `.xlsx` upload, POL Booking Flash
tab): the header's `data-autofit-col="Loadable Quantity"` div renders `Loadable<br>Quantity` (confirmed via
`innerHTML`, not just a screenshot); zero elements anywhere on the page still carry the old
`data-autofit-col="Loadable Quant"` key; the filter row's `aria-label="Filter by Loadable Quantity"` input
is present; all 964 data rows' `<td data-autofit-col="Loadable Quantity">` cells still render their real
values unaffected by the rename. Full regression suite 169/169 (same sandbox run also covering the
funnel-icon change above, kept as two separate commits since they're unrelated). Deploy artifact rebuilt and
`--check` passed; a dist smoke check confirmed the same `Loadable<br>Quantity` header renders identically
from the precompiled artifact.

## `SlicerClearBtn`'s icon, round 3: reverted funnel+X back to the SVG X-mark (2026-09-25, same day)

Per Kevin, after seeing round 2 (the funnel+X pixel-art icon) live: back to the SVG X-mark from round 1.
`FunnelClearIcon` and `FUNNEL_CLEAR_PIXEL_GRID` are removed entirely (not left in as dead code) rather than
kept-but-unused, since nothing else in the file referenced them. The pumpkin hover behavior is untouched --
this only changes which icon shows when the button is NOT hovered (or hovered outside the seasonal window).

This is the third icon this button has had in one day (unicode `×` -> SVG X-mark -> pixel-art funnel+X ->
back to the SVG X-mark) -- worth noting plainly rather than treating any one of them as obviously final, in
case there's a fourth round.

**Verified**: syntax check clean, confirmed no `FunnelClearIcon`/`FUNNEL_CLEAR_PIXEL_GRID` references remain
anywhere in the file. Live-browser check (Playwright, real `.xlsx` upload, real date 2026-09-25): unhovered
state renders the 2-line/`viewBox="0 0 24 24"` X-mark exactly as round 1 did; hovering still swaps to the
unaffected 46-rect pumpkin; mouse-out reverts to the X-mark; clicking still clears the filter (button
unmounts); `title` unchanged. Full regression suite 169/169, same known sandbox poll-timeout workaround as
the prior two entries (scratch-only widened timeout, repo file untouched) needed for one clean uninterrupted
run. Deploy artifact rebuilt and `--check` passed.

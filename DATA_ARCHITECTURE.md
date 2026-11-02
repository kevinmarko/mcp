# Data Architecture: Booking Flash Report NA

The authoritative reference for **where every number on screen comes from** — the raw column
it's read from, how it's matched, which tab(s) show it, and its validation status as of the last
full audit. Read this before adding a new field, touching `getVal()`, or investigating "this
number looks wrong." For the broader project history/architecture, see [HANDOFF.md](HANDOFF.md);
for the required after-every-change checklist, see [AGENTS.md](AGENTS.md).

**Last full validation pass:** 2026-08-25, against a fresh `Data_download` CSV export and the
real reference workbook `Booking_Flash_Report_08252026b.xlsm` (Kevin's actual Excel system, not
just a re-derivation from raw data — see [Reference workbook](#reference-workbook-the-real-ground-truth)
below). Findings and fixes from that pass are folded into this document; see
[Validation status](#validation-status-by-tab) for exactly what was and wasn't covered.

**Full re-validation, 2026-09-01:** against `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` and
`Booking_Flash_Report_REFERENCE_08-12-2026.xlsm`, run via 3 parallel agents each executing the
app's real code against a real SheetJS parse (not a re-implementation). 6 real bugs found and
fixed (POL/RFR-BKG-TEU column mis-wiring, Broken Routes/RFR Utiliz % aggregation gaps, Trade
Summary row order, Status column casing) plus 1 display-only fix (ETA time zero-pad); see
[Re-validation — 2026-09-01](#re-validation--2026-09-01) for the full writeup.

**2nd pass, same day:** re-run against a real historical archive
(`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`, 9 real days) to confirm the above
fixes hold on different days' data, not just the one day/rows the first pass checked. 1 more real
bug found (Short_Fall aggregation, same class as Broken Routes) plus the first genuine two-real-day
test of the Compare tab; see
[Re-validation — 2026-09-01, 2nd pass](#re-validation--2026-09-01-2nd-pass-historical-dataset).

**Supplementary structural check, 2026-08-26** (Kevin: "do our tests match up and check that all
the data mapping is correct?") — deliberately *not* a full re-audit: every change made this
session (per-tab text size, slicer/button font sizes, sticky-header `border-collapse`→`separate`
fix, toggle-panel column defaults, row height/auto-fit column width) is presentational/CSS or a
display-default, none of it touches `getVal()`, any alias, or any computed field — so there was no
reason to expect a value-level regression, and this check was scoped accordingly rather than
re-running the full multi-hour exhaustive pass for no reason:
1. Ran [`tests/check_alias_landmines.py`](tests/check_alias_landmines.py) against the current
   sample export (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`, 97 columns) — **zero landmines**
   (33 aliases match nothing in this particular file, all confirmed harmless/inert per the script's
   own classification).
2. Programmatically diffed this document's field-mapping table against every `getVal()` call
   actually present in the app source (73 unique fields either side, by field name) — **fully in
   sync**, then independently resolved each field's real matched source column against the sample
   file's actual 97 headers and diffed that against this table's claimed source column — 2 real
   gaps found and fixed (see below), everything else confirmed accurate.
   - **Fixed**: `status` and `loadingStatus` were genuinely undocumented — `loadingStatus` in
     particular is a real, directly-rendered field (POL Booking Flash's "Status" column, and drives
     that tab's own AP Frozen/AP Only row coloring) sourced from a *different* raw column
     (`Measures Loading Status`) than `status`/`statusDisplay` (`Measures Overall Status`) — a real
     documentation gap, not a code bug (the app itself had this correct and tested); now added as
     its own rows above.
   - Row count in the "Data flow" diagram corrected `~68` → `~75` fields to match the current count.
3. Audited whether `tests/booking_flash_regression_tests.js`'s own checks still exercise what they
   claim to, given today's toggle-default change (many Booking Flash/Detail columns now default to
   **hidden**, where they used to default to visible) — found a real gap: the Class F "no 4+ digit
   field renders without comma formatting" check locates each of its 12 target columns (RFR/TPT
   family, DG TEU, Broken Routes) by header text with a graceful `idx < 0` skip-if-absent guard, so
   it never *failed*, but measuring it directly showed only **1 of 12** target columns (`Broken
   Routes`) was actually visible-and-checked by default post-toggle-change — the other 11 were
   silently skipped every run, an unnoticed ~92% coverage loss on that one check (it still
   nominally "passed," just against far less real data than before). **Fixed** by adding a
   `clickShowToggle()` helper and calling it for Reefer/Trade Breakdown/DG Volume at the top of the
   Booking Flash suite, before any header-position-dependent check reads the DOM — confirmed live
   this restores all 12/12 target columns to visible, re-verified the fixed suite still passes with
   the same 47/47 total (no new checks added, existing ones just regained their real coverage).
   POL Booking Flash's own suite has no equivalent gap (its own toggle-gated columns — Reefer/
   Activity/Operational Issues/ETA/VCO Analyst — aren't targeted by any header-text-located check).

## Data flow

```
Raw export (Data_download.csv or .xlsx, 97 columns, one row per VVD+POL-leg)
    ↓ SheetJS parses to an array of {header: value} objects
    ↓ each row's keys are "cleaned" (lowercased, non-alphanumeric stripped) into cleanRow
    ↓ getVal([aliases]) resolves each app field from cleanRow — see below
    ↓ produces rawRows: one flat object per raw row, ~75 fields (rowObj)
    ↓ filteredRawRows: rawRows narrowed by the slicer selections (Sub Trade/Coast/Analyst/
      Sale Week/Lane/Yard/AP Status/header filters — Sub Trade/Coast/Analyst/Lane's own button
      lists are themselves derived live from rawRows, see Dynamic slicers below)
    ↓ per-tab: either rendered near-directly (POL Booking Flash, Booking Flash/Detail — flat,
      rowSpan-merged tables) or aggregated into a tree by PivotTableViewer (Trade Summary,
      Sector Summary's left pivot)
```

Two tabs (**POL Booking Flash**, **Booking Flash/Detail**) render close to one `<td>` per raw
field per row — the most direct path from raw column to screen, and the one most exposed to a
bad `getVal()` alias. Two tabs (**Trade Summary**, **Sector Summary**'s left pivot) go through
`PivotTableViewer`'s tree aggregation (sum/max/rollup) — a bad alias there is masked less often
because the aggregated field list is short and every one is already an exact-match (see the
table below), but a rollup-math bug (see HANDOFF.md's Class A) is a distinct risk on that path
instead.

### `getVal()`: the two-pass alias resolver

```js
const getVal = (aliases) => {
    // Pass 1: exact match only, first alias in the array that resolves to a
    // real, NON-BLANK column wins. A blank cell is skipped, not returned —
    // the loop keeps trying later aliases in the array, even ones meant as
    // "alternate name" fallbacks rather than "this row's data is elsewhere."
    for (let alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanRow[cleanAlias] !== undefined && cleanRow[cleanAlias] !== '') {
            return cleanRow[cleanAlias];
        }
    }
    // Pass 2 (only reached if EVERY alias missed pass 1): substring match —
    // the first real column whose cleaned name CONTAINS the cleaned alias,
    // in the array's order, in the raw file's own column order for ties.
    for (let alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanAlias.length < 3) continue; // guards against 1-2 char aliases matching everything
        const matchingKey = cleanRowKeys.find(k => k.includes(cleanAlias));
        if (matchingKey && cleanRow[matchingKey] !== '') return cleanRow[matchingKey];
    }
    return '';
};
```

This is genuinely useful — it's why the app tolerates minor header renames between exports
without code changes. But pass 2 is where every bug in this document's history came from.

### Class E — the fuzzy-alias landmine (read this before adding any `getVal()` call)

**The trap:** a short, generic trailing alias (`'Cutoff'`, `'ETD'`, `'Remarks'`, bare `'Vessel'`,
`'TAT'`) is usually added "just in case a future export spells the header differently." It sits
harmlessly unused for as long as the primary, exact-match alias is populated on every row. The
moment a **single row** has that primary column blank (a real, common occurrence — VMS
placeholder rows, an unset rotation, a not-yet-written remark), pass 1 exhausts all aliases
without a hit, falls into pass 2, and the generic alias substring-matches **whatever real column
happens to contain that word anywhere in its name** — not necessarily the one you meant. This is
silent: no error, no console warning, just a wrong value (or someone else's text) rendered as if
it were correct.

This bit the app **six separate times** across two audits (2026-08-18: `TAT`/`LET`; 2026-08-25:
`cutoff`/`etd`/`proformaRot`/`remarks`), always the same shape: a generic 3-8 letter alias,
matched against an unrelated column that happens to contain that substring, triggered only on
whichever rows had a blank primary source cell in that particular export.

**The fix, and the standing rule for any new `getVal()` call:**
1. Put the real column's exact name as the first alias. Confirm it's an *exact* match (see the
   check below), not something that only resolves via pass 2 fuzzy matching.
2. Before adding any further "just in case" alias, run it through the landmine check:
   ```bash
   python3 tests/check_alias_landmines.py Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx
   ```
   (or point it at any current real export — see [tests/check_alias_landmines.py](tests/check_alias_landmines.py)).
   It simulates both passes of `getVal()` against every real header in the file and flags any
   alias whose fuzzy match lands on a DIFFERENT column than its field's own primary alias. Run
   it after adding a field, and periodically against any new export format Kevin sends — a
   landmine can be dormant against one file and live against another purely because of which
   rows happen to be blank.
3. If a fallback alias is flagged, either drop it (if it never exact-matches anything, it's
   dead weight — see the many `'Current Laden'`/`'Cur Laden'`/`'RFR Max LDN'`-style aliases below
   that are exact-match-only-elsewhere and safely inert) or make it specific enough that it can't
   substring-collide with a real header (spell it closer to the real column, not a generic
   short word).

### Class F — inconsistent/lossy formatting from the live source (found 2026-08-25)

**The trap:** `getVal()` returns whatever raw text a column contains — it never formats
anything. That's fine as long as every source (a clean `.xlsx` upload, the live CSV) renders a
given field's raw text *consistently*. It doesn't. Two separate variants of this hit the app the
same day:

1. **Date fields.** The live CSV source (a Google Sheet's "Publish to the web" export) writes
   out each cell's *displayed* text, respecting that cell's own individual number format — not a
   canonical value. Different rows of the same column can carry different formats if the sheet's
   own cells were ever formatted inconsistently row-to-row. Confirmed live on "Route Date POL
   Cut/off Date": ~77% of rows were a year-less `"Mon D"`/`"Month D"` (e.g. `"Jul 10"`, `"July
   13"`), the rest ISO `"YYYY-MM-DD"` — the underlying data has a real year on every row (the
   `.xlsm` upload path confirms this: a clean `datetime` on 100% of rows, `number_format` uniform
   per column), it's genuinely lost by the time it reaches this app as CSV text. **Compounding
   trap:** SheetJS's own CSV parser (`sheet_to_json({raw:false})`) independently reformats any
   ISO-shaped cell to `"M/D/YY"` *before this app's own code ever runs* — for every column, not
   just the ones being fixed. A year-hint parser that only recognizes raw ISO will silently never
   fire, because the hint field it's borrowing a year from has *already* been reformatted to
   `"M/D/YY"` by the time it's passed in. `formatDate()` (defined near the other formatters, ~line
   700) handles both shapes via a shared `parseKnownDate()` helper, plus the year-less case (given
   a same-row date to borrow a year from, rolling back one year if that would place the date after
   the hint — Port Cut always precedes Coastal ETD in a real shipping schedule).
   Applied to: `coastalEtd`/`portCut` (POL Booking Flash), `lastCoastalEta`/`proformaEta` (POL
   Booking Flash, carries a time), `cutoff`/`etd` (Booking Flash/Detail — a *different* pair of
   source columns than POL Booking Flash's, not the same fields aliased twice).
   **Deliberately diverges from the reference `.xlsm`'s own native format for some of these** —
   its Port Cut is `"mm-dd-yy"` (`"07-13-26"`), and Booking Flash/Detail's Cutoff/ETD Last Port
   are `"mmm-yy"`/`"m/d"` (`"Jul-26"`/`"7/23"`, each missing either the day or the year entirely).
   A deliberate choice for one consistent, complete `"M/D/YY"` format across the app (per Kevin's
   direct ask) rather than mirroring Excel's own per-column inconsistency.
2. **Cross-tab number formatting.** Several TEU/plug-count fields (`rfrMaxLdn`, `rfrBkgTtl`,
   `inlandAct`/`inlandNoAct`/`inlandTotal`, `portAct`/`portNoAct`/`portTotal`, `tpt`/`tat`/`lwt`/
   `lnt`/`imt`/`let`, `dgTeu`, `broken`) render comma-formatted (`formatNumberWithCommas`) on POL
   Booking Flash, but the *exact same fields* rendered as bare JS numbers (`"4200"`, not
   `"4,200"`) on Booking Flash/Detail — they'd already been through `toNum()` for the tab's own
   aggregation math (see `tableData`'s `numerics`/`maxes` lists), but the final render pass never
   ran them back through a display formatter. `broken` ("Broken Routes") wasn't even in those
   lists, so it skipped `toNum()` entirely too. Fixed by wrapping each render site in
   `formatNumberWithCommas()` (works fine on an already-numeric input, not just a raw string).

**A related but distinct finding, not a Class F bug itself:** while adding regression tests for
the above, the *test suite's own* pre-existing column-lookup math (`fromEnd = headerLabels.length
- idx`) turned out to have been silently checking the wrong `<td>` on both POL Booking Flash and
Booking Flash/Detail whenever the target field sat before a `colSpan`-grouped header later in the
same row (Inland/Port Total's 3-way sub-column split) — it counted array *index* positions, not
real column positions, so a `colSpan={3}` header inflates the true column count without adding
extra header-array entries. This silently affected the pre-existing "Max Laden Vs POL Booking"/
"Short_Fall" negative-parens checks too (confirmed live: they were reading `"Loadable Quant"`/an
RFR field instead, and only ever "passed" because that wrong column never happened to contain the
broken shape either). Fixed for every affected check in `tests/booking_flash_regression_tests.js`
by computing `fromEnd` from each header cell's actual `colspan` attribute instead of its array
index. Worth remembering next time a new column-indexed DOM check is added to either tab.

### Class G — Temporal-scope mismatch in a derived ratio (found 2026-08-26)

**The trap:** a ratio built from two aggregates that were each summed over a *different* time
window looks like a normal percentage but is arithmetically meaningless — nothing about the code
signals the mismatch, and the result can still fall in a plausible-looking range on some data,
which is what let this slip past casual review. Found on the **Compare tab's "Overall
Utilization"** KPI (`overallSnapshot()`): the numerator (`ladenSum`) summed booked Laden TEU
across *every* Sale Week present in the uploaded file, while the denominator (`maxLdnSum`) summed
each lane's single *peak* Max Laden value pooled across all those same weeks — a multi-week
cumulative total divided by a single-week capacity snapshot. On real data this produced 394%/396%
(caught via live Playwright verification plus an independent Python recomputation from the same
source file, not just eyeballing the UI). Fixed by adding a second, separately-scoped computation
for this ratio only — group rows by lane **and** week, average each lane's ratio across its own
weeks (mirroring `serviceLaneAnalysis`'s already-correct methodology, used by the Analyze modal),
then sum those weekly averages across lanes. The pre-existing `maxLdn`/`laden` values (the "Total
Max Laden"/"Total Booked TEU" KPI cards) were independently verified correct against source and
left untouched — only the ratio's own computation was scope-mismatched, not those two totals.
Live-verified post-fix: Old 31%, New 32% (sane), Total Max Laden/Total Booked TEU unchanged. A
regression check (`tests/booking_flash_regression_tests.js`'s Compare suite) now asserts Overall
Utilization stays under a 150% sane ceiling whenever a second ("old") file is loaded — it's a
ceiling check, not a hardcoded-value snapshot, because the real percentage depends on whichever
two files are loaded. **Worth remembering for any future derived ratio**: check that every
aggregate feeding into it was summed over the *same* rows/scope before trusting the ratio, even
if each aggregate is independently correct on its own.

## Field mapping (current, post-2026-08-25-audit)

Every `getVal()` field as of this document's date, its exact matched source column (confirmed
programmatically against the real 97-header CSV, not by eye), and which tab(s) render it. `n/a`
under Source column means no raw column matches at all — the field is either always overwritten
by a computed value downstream (noted) or genuinely absent from the standard export.

| Field | Source column (exact match) | Rendered on |
|---|---|---|
| `trade` | Vessel 1st Trade | All tabs (row grouping) |
| `subTrade` | Vessel 1st Sub Trade | All tabs (row grouping) |
| `lane` | Vessel 1st Lane | All tabs (row grouping; POL tab labels it "Service") |
| `saleWeek` | Route Date 1st Sale Week | POL Booking Flash, Booking Flash, Sale Week slicer |
| `pic` | MCT PIC | Booking Flash ("PIC (spc/mkg)"), also feeds the SPC Analyst slicer (see Dynamic slicers below) |
| `coast` | MCT Spc Team | Coast slicer only (WC/EC, see Dynamic slicers below) |
| `cutoff` | Route Date Cut/off Date | Booking Flash ("1st POL Cutoff") — rendered via `formatDate()`, see Class F |
| `etd` | Route Date Last Port ETD Date | Booking Flash ("ETD Last Port") — rendered via `formatDate()`, see Class F |
| `statusDisplay` | Measures Overall Status | Booking Flash ("Status") |
| `status` | Measures Overall Status | Not directly rendered — `normalizeApStatus()`-normalized copy of the same source column as `statusDisplay` above, used for AP Status slicer matching (`row.status`) and Booking Flash's own row-coloring, not display text |
| `loadingStatusDisplay` | Measures Loading Status | POL Booking Flash ("Status") — added 2026-09-01; same `status`/`statusDisplay` split as above, kept the source's original title case for display |
| `loadingStatus` | Measures Loading Status | Not directly rendered (2026-09-01 fix; previously rendered directly, always ALL CAPS) — **a different raw column from `status`/`statusDisplay` above, not the same field aliased twice** (POL's report grain is per-POL-leg, so its own loading status can differ from the vessel's overall status). Also `normalizeApStatus()`-normalized; drives POL Booking Flash's own AP Frozen/AP Only row coloring and AP Status slicer matching, deliberately kept separate from Booking Flash/Detail's `status`-driven coloring (see the app's own comment at its row-coloring site) |
| `vvd` | Vessel 1st VVD | POL Booking Flash, Booking Flash |
| `vessel` | Vessel Vessel Name | POL Booking Flash, Booking Flash |
| `maxLdn` | MCT Max Laden Update | Booking Flash ("Max LDN"), Trade Summary (via `laneAwareMaxLdn`) |
| `standbyRaw` | Trunk Threshold | Booking Flash ("Standby Threshold") |
| `curLaden` | Measures POL Laden TEU | POL Booking Flash ("Current Laden (TEU)"), Booking Flash ("Current Laden (TEU)") — **not the same raw column as `ladenTeu`, see HANDOFF.md** |
| `ladenTeu` | Measures Laden TEU | Trade Summary ("Total TEU"), feeds Trunk Utilization/Shortfall |
| `peakUtilRaw` | Measures Peak Overall Utilz | Booking Flash ("Peak Utiliz %") — 2026-09-01: now MAX-aggregated across a VVD's POL legs in `tableData` (was first-leg-wins; dormant in the audited sample but the same bug class as `broken` below) |
| `curUtilRaw` | Measures Overall Booking Utilz | Booking Flash ("Current Laden Utiliz %") |
| `shortfall` | Max Laden vs POL  Booking (double-space, real) | Booking Flash ("Max LDN vs BKG (Short_Fall)") — computed DAX-equivalent overrides this at render time whenever the VVD's aggregated Max Laden is non-blank; see `laneAwareMaxLdn`-adjacent calc. 2026-09-01 (2nd pass): now also SUM-aggregated across a VVD's POL legs in `tableData` (was missing from that list, same bug class as `broken`) — only actually matters on the rarer maxLdn-blank branch, where the raw summed value is what renders |
| `quote` | Measures ONE Quote volume | Booking Flash ("ONE Quote (TEU)") |
| `broken` | Measures Broken Routes TEU | Booking Flash ("Broken Routes") — 2026-09-01 fix: was missing from `tableData`'s SUM-across-legs list (the only TEU-quantity field that was), so a multi-leg VVD silently dropped all but its first leg's volume; 16 real VVDs undercounted, some down to 0 |
| `bsaTeu` | Measures BSA TEU | POL Booking Flash ("BSA TEU", added 2026-08-25), Booking Flash ("BSA TEU") |
| `bsaWgt` | Measures Last NA Port BSA Wgt | Booking Flash ("BSA Wgt Last NA Port") |
| `rfrBsaPlugs` | Measures BSA UNIT RF | Booking Flash ("RFR BSA Plugs") |
| `rfrBkgPlugs` | Measures Booking Reefer UNIT | Booking Flash ("RFR BKG Plugs") |
| `rfrMaxLdn` | RFR Max Laden TEU | POL Booking Flash, Booking Flash ("RFR Max LDN") |
| `rfrBkgTtl` | Measures Reefer TEU | Booking Flash ("RFR BKG TTL") only (2026-09-01: no longer POL Booking Flash — see `rfrBkgPol` below, they diverge on 6 real PAROD-transship VVDs) |
| `rfrBkgPol` | Measures POL Reefer TEU | POL Booking Flash ("RFR BKG TEU") — added 2026-09-01; a genuinely different, POL-scoped column from `rfrBkgTtl` above (same POL-vs-overall split as `curLaden`/`ladenTeu`), previously miswired to `rfrBkgTtl` |
| `rfrBsaTeuRfMax` | Measures BSA TEU RF | Feeds computed `rfrUtilizRaw` (Booking Flash's "RFR Utiliz %") — not rendered directly. 2026-09-01: now MAX-aggregated across a VVD's POL legs in `tableData` (was first-leg-wins) |
| `rfrUtilizPolRaw` | RFR Utilz% | POL Booking Flash ("RFR Utilz%") |
| `actVsBkgUtilzRaw` | n/a — always overwritten by a computed ratio (`ladenTeu/activeTotalTeu`) before render | — |
| `actVsMaxLdnRaw` | n/a — always overwritten by a computed value (`activeTotalTeu - maxLdn`) before render | — |
| `inlandAct` / `inlandNoAct` / `inlandTotal` | Measures Active Ipi TEU / Measures Non Active Ipi TEU / Measures Ipi Total TEU | POL Booking Flash, Booking Flash |
| `portAct` / `portNoAct` / `portTotal` | Measures Active Local TEU / Measures Non Active Loc TEU / Measures Local Total TEU | POL Booking Flash, Booking Flash |
| `activeTotalTeu` | Measures Active total TEU | Feeds `actVsBkgUtilzRaw`/`actVsMaxLdnRaw` above |
| `past4WeekFlag` | Route Date Past 4 Week Flag | Filters Sector Summary's left pivot |
| `opIssues` | Vessel Operation Notice | POL Booking Flash, Booking Flash ("Operational Issues") |
| `secAlloc` | MCT Sector Allocation | Not directly rendered — the visible "Sector Allocation" column on Booking Flash actually renders `sectorRemarks` (below), a DAX text-concat quirk, see HANDOFF.md |
| `sgsinDryVsRfr` | Measures SGSIN Sector Remarks | Booking Flash ("SGSIN Dry vs Reefer") |
| `proformaRot` | Route Location Rotation Port | Booking Flash ("Proforma Rotation") |
| `actualRot` | Route Location Actual Rotation Port | Booking Flash ("Actual Rotation") |
| `apStatus` | MCT AP Status | Booking Flash ("AP Status") |
| `tpt`/`tat`/`lwt`/`lnt`/`imt`/`let`/`dgTeu` | Measures TPT/TAT/LWT/LNT/IMT/LET/DG TEU | Booking Flash |
| `remarks` | Vessel Voyage Remark | Booking Flash ("Voyage Remarks", optional toggle) |
| `vco` | VCO Analyst | POL Booking Flash, Booking Flash |
| `lastCoastalEta` / `proformaEta` / `coastalEtaVsProforma` | Route Date Last Coastal ETA Time / Route Date Proforma ETA Time / Route Date Coastal ETA vs Proforma | POL Booking Flash (optional ETA group toggle) — first two rendered via `formatDate()` (see Class F), `coastalEtaVsProforma` is a pre-built duration string ("+7 days 16 hrs"), not a date, left unformatted |
| `pol` | Route Location 1st Yard | POL Booking Flash, POL slicer — 2026-09-01 fix: was `Route Location 1st Pol`, a coarser real column that collapsed distinct terminals (e.g. USLAX01/06/08) into one bare port code; now reads the same source as `yard` below |
| `yard` | Route Location 1st Yard | Yard slicer, filters |
| `plannedMty` / `actualMty` | Measures Planned Mty TEU / Measures Actual Mty TEU | POL Booking Flash |
| `polMaxLdn` | POL Max Laden TEU | POL Booking Flash ("POL Max Laden (TEU)") — distinct from `maxLdn`/MCT Max Laden Update, don't merge |
| `polLdnThresh` | POL Laden Threshold | POL Booking Flash |
| `discharge` | Measures Discharge TEU | POL Booking Flash |
| `peakPolUtilzRaw` | Measures Peak Pol Utilz | POL Booking Flash ("Peak Laden Utilz %") |
| `polBkgUtilzRaw` | Measures POL Booking Utilz | POL Booking Flash ("Current Laden Utilz %") — NOT the same field as `curUtilRaw` |
| `maxLdnVsPolBkg` | Max Laden vs POL  Booking | POL Booking Flash ("Max Laden Vs POL Booking") |
| `loadableQuant` / `loadableWgt` | Measures Loadable TEU / Measures Loadable WGT update | POL Booking Flash |
| `coastalEtd` | Route Date Coastal ETD Date | POL Booking Flash — rendered via `formatDate()`, see Class F |
| `portCut` | Route Date POL Cut/off Date | POL Booking Flash — rendered via `formatDate(val, row.coastalEtd)` (year-hint), see Class F |
| `sectorRemarks` | Sector Remarks | Booking Flash's "Sector Allocation" column (see `secAlloc` note above) |
| `tsAvgBooking` / `tsAvgMaxLdn` | Trade Summary Avg Booking / Trade Summary Avg Max Laden | Sector Summary's LEFT pivot only |

## Dynamic slicers (Sub Trade / Coast / SPC Analyst / Lane, live as of 2026-08-26)

The Sub Trade, Coast, SPC Analyst, and Lane slicer button lists used to be hardcoded literal
arrays (e.g. `['AW', 'LN', 'PN', 'PS', 'TA']` for Sub Trade) — correct against the data on hand
when written, but silently stale the moment a new lane, a new analyst naming convention, or a new
sub-trade code showed up in a later export: it would filter fine (the underlying rows are still
there), it just wouldn't get a slicer button, making it invisible to a user trying to narrow down
to it. Fixed per direct request ("on the backend there should be data for new lanes... they
should be auto added to the report / tables / slicers") by deriving each list from `rawRows` via
a `useMemo`, matching the pre-existing pattern already used for the Sale Week and Yard slicers:

- `availableSubTrades` — every distinct `row.subTrade`, alphabetical.
- `availableCoasts` — every distinct `row.coast`, with `COAST_PREFERRED_ORDER = ['WC', 'EC']`
  applied first (preserving the existing non-alphabetical display order) and any unknown value
  appended alphabetically after — so a coast value outside `WC`/`EC` still gets a button instead
  of being silently dropped.
- `availableAnalysts` — extracted from `row.pic`'s compound `"Name / MKG"` shape via
  `.split('/')[0].trim()`; a standalone value with no `/` (e.g. `"n/a"`, an MKG-only entry) is
  skipped as ambiguous, exactly matching what the old hardcoded list already excluded — this
  isn't a behavior change for those rows, only an addition for new analysts.
- `availableLanes` — every distinct `row.lane`, alphabetical.

All four re-derive automatically on every new file upload/live refresh — no code change is needed
when the underlying data gains a new value. Live-verified via synthetic injection (a fabricated
new Sub Trade/Coast/Analyst/Lane value each rendered as a button after upload) which also
surfaced two real pre-existing lanes, `EXE` and `INE`, that had been silently missing from the old
hardcoded Lane array the whole time — not introduced by this change, just newly visible because of
it.

## Frozen/static datasets (not derived from the uploaded file — know these before debugging "wrong" numbers)

| Constant | Feeds | Status |
|---|---|---|
| `SECTOR_DATA_SEED` | Sector Summary's RIGHT-hand pivot ("Sector Summary": Sector Alloc/Average Booking/Open Space, by Trade→SubTrade→Lane→POD Sector) | **Live as of 2026-08-25 — no longer the active source.** Kevin provided the real Google Sheet "Publish to the web" CSV export this data comes from: `SECTOR_DATA_CSV_URL` = `https://docs.google.com/spreadsheets/d/e/2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS-mr0DP12xhXXcsCvPDJiTolxYOA013WwHZAg5mFC4xN9cPwSNr3-O_/pub?output=csv`, fetched the same way `CSV_SOURCE_URL` is (`fetchAndApplySectorData`, on initial load, its own independent `POLL_INTERVAL_MS` poll, and manual refresh — all separate from the main source's, gated only by `isSectorCsvSourceConfigured()`). `sectorDataMapped` now reads from `sectorSourceRows` state (fetched rows) instead of the hardcoded seed. **`SECTOR_DATA_SEED` itself is kept only as `sectorSourceRows`'s initial `useState` value** — the fallback shown for the brief window before the first fetch resolves, or if every fetch ever fails (never blanks the pivot over a transient network hiccup). The header has a redundant duplicate `MCT Sector Allocation` column at the end (same values, safely deduped by SheetJS to `MCT Sector Allocation_1` and ignored) — confirmed live-verified via Playwright: TAT/AL5/BEANR's Average Booking reads the live-fetched 158 (not the old frozen 296), and manual refresh re-fetches. Trade/Sub Trade/Lane/POD Sector row order (`childOrder` config, updated 2026-08-25 — see Class F) still holds against the live data. Same trade scope as before (TAT/TPT only, no LAT — that's inherent to this source, not a technical gap). **Slicer scoping fixed 2026-08-26**: `sectorDataMapped` previously ignored every slicer selection entirely — only the LEFT pivot (`past4WeekRows` → `filteredRawRows`) responded to the Sub Trade/Coast/SPC Analyst/Lane/Sale Week/Yard/AP Status buttons. This source's raw rows only ever carried `Vessel 1st Trade`/`Vessel 1st Sub Trade`/`Vessel 1st Lane`/`POD Sec`/`MCT Sector Allocation`/`Measures Laden TEU`/`MCT Voyage Count`/`Average Booking`/`Sector Open Space` — no Coast, PIC/SPC Analyst, Sale Week, Yard, or AP Status column exists here at all — so `sectorDataMapped` now filters by **Sub Trade and Lane only** (matching `selectedSubTrades`/`selectedLanes` against `Vessel 1st Sub Trade`/`Vessel 1st Lane`, same pattern as `filteredRawRows`'s own `matchSubTrade`/`matchLane`), and deliberately does NOT attempt to filter by the other five slicers since there's no matching field to filter on. Live-verified via Playwright: Sub Trade=AW narrowed the right pivot from 56 rows to 10; Lane=AL5 narrowed it from 56 to 7; Coast/Analyst/Sale Week/Yard/AP Status selections correctly leave the right pivot's 56 rows unchanged (only the left pivot responds to those) with no console errors. |
| ~~`DRY_REEFER_SECTOR_SEED`~~ | ~~Sector Summary's supplementary "Dry Sec/Reefer Sec" table~~ | **Removed 2026-08-26**, per direct confirmation it isn't part of the original reference workbook at all (confirmed by audit: not present in any sheet of `Booking_Flash_Report_08252026b.xlsm`). Was a frozen 8-row sample from a third source distinct from both the main CSV and `SECTOR_DATA_CSV_URL`; the audit that preceded removal also found it was ~7% covering the real lane population (93% of lanes silently rendered as 0) and one lane (FP2) was ~10.5x overstated from 5 stale ghost VVD rows summed on top of its own aggregate row. No live per-lane source for this table exists, so it was fully removed (seed constant, its `sectorDataMapped` join logic, and its render block) rather than repointed. |
| `PORT_EXCLUDE_SEED` | Sector Summary's Port-Excluded row flag | Static exclusion list, not meant to be data-driven (it's a business rule, not a measurement) — this one being static is correct by design, not a gap. |
| ~~`PEAK_DATA_POL_SEED`~~ | ~~POL Booking Flash's "Peak Dry Utilz (POL)"/"Peak Reefer Utilz (POL)"~~ | **Removed 2026-08-25.** Was a frozen 2026-08-13 snapshot from a "Peak Data POL" source sheet outside the standard export. Proved disconnected live (rendered an identical frozen number across VVDs whose real values varied 0-53%) and confirmed absent from the reference workbook entirely. Columns removed rather than repointed — no real per-row substitute exists. If this ever needs restoring as a real feature, it needs a live per-row Dry/Reefer utilization source, not a revert of this removal. |

## Reference workbook: the real ground truth

Kevin's actual Excel system (`Booking_Flash_Report_08252026b.xlsm` as of the 2026-08-25 audit,
version number will change over time — always ask for the current one rather than assuming a
filename) is more authoritative than re-deriving expected values from the raw CSV by hand,
because it captures the real business logic (rounding, edge cases) rather than our own guess at
it. Structure:

| Sheet | Contents |
|---|---|
| `Data_download` | The same raw export the app ingests (97 cols, header row 2) |
| `Ref` | **The canonical field-mapping table** — col A = `Data_download` column letter, col B = "Data Model Field" (the real raw header text), col C = "Bkg Flash Fields" (the display caption used in the report tabs, when different from the raw name). This is the single most useful sheet for resolving "what should this column be called/read from" — check it before guessing an alias. A blank col C means that field isn't renamed for display (or isn't rendered directly at all). |
| `POL_Booking_Flash` | The real POL Booking Flash report, header row 11, one row per VVD+POL-leg (matches the app's own row grain) |
| `Booking_Flash` | The real Booking Flash/Detail report, header row 12, one row per VVD |
| `Trade_Summary` | The real Trade Summary pivot |
| `Sector_Summary` | The real Sector Summary pivot(s) |
| `Sector_Data` | Small supplementary sheet, source for the app's `SECTOR_DATA_SEED`-adjacent data historically |
| `NOTES` | Freeform notes, occasionally has SQL/lineage breadcrumbs (e.g. `BKG_FLSH_PK_POL_DAT`) |

**Reading it:** use `openpyxl` with `keep_vba=True` (it's a macro-enabled `.xlsm`), and load it
**twice** — once `data_only=False` for any formulas, once `data_only=True` for the cached
computed values (a fresh `openpyxl`-written file has no cached values until recalculated; this
workbook already has them since it's Kevin's real, Excel-saved file). Merged/continuation rows
(Trade/Sub Trade/Lane blank on all but the first row of a group) need forward-filling to match
how the app's own `rowSpan` rendering groups them.

**A real reference snapshot goes stale fast** — this app is live/auto-refreshing, so a diff
between the app's current numbers and an xlsm snapshot from even a day earlier is *expected* on
any volatile field (bookings, current laden, discharge). Don't treat every diff as a bug: cross-
check the app's value against the SAME raw CSV row it read from first. A real bug is the app
disagreeing with its own raw source row, not disagreeing with a slightly older snapshot.

## Validation status by tab

| Tab | Coverage as of 2026-08-25 | Result |
|---|---|---|
| POL Booking Flash | Exhaustive — every rendered column, up to 906 rows cross-checked against the real xlsm's cached values | 3 bugs found & fixed (Peak Dry/Reefer Utilz fake data, Max Laden Vs POL Booking formatting), plus Class F (2026-08-25): Coastal ETD/Port Cut date formatting, `formatAccountingNumber`'s own regression check was silently reading the wrong column (test-infra bug, fixed) |
| Booking Flash (Detail) | Thorough — 20-28 columns × 371 VVDs, cross-checked against both raw CSV and the real xlsm | 4 bugs found & fixed (cutoff/etd/proformaRot/remarks fuzzy-alias landmines), plus Class F (2026-08-25): Cutoff/ETD Last Port date formatting, RFR/Inland/Port/TPT-family TEU fields now comma-formatted (were inconsistent with POL Booking Flash's own copy of the same fields) |
| Trade Summary | Full — all 3 dataFields × every populated row/week cross-checked against the real xlsm | 0 bugs (fields were already clean exact-matches). 2026-08-25: Grand Total ROW already removed (2026-08-24); Grand Total COLUMN (rightmost, per-row total across all Sale Weeks) removed too, per direct request — see `showGrandTotalColumn` on `PivotTableViewer` |
| Sector Summary (left pivot, live) | Full — cross-checked against the real xlsm | 0 bugs. 2026-08-25: Trade/Sub Trade/Lane row order now matches the real reference workbook exactly (`childOrder` config, replacing the old alphabetically-computed `topLevelOrder`) — see Class F |
| Sector Summary (right pivot, live) | Wired to its real live source (2026-08-25, `SECTOR_DATA_CSV_URL`, see Frozen/static datasets table above) and live-verified structurally (correct fetch/parse/render, manual refresh works) | No longer frozen. Underlying business-logic correctness (are the source sheet's own numbers right) not independently re-derived — same "the app matches its own live source" standard as every other tab, not a gap specific to this one. 2026-08-25: Trade/Sub Trade/Lane/POD Sector row order now matches the real reference workbook (`childOrder` config) — see Class F |
| ~~Sector Summary (Dry/Reefer supplementary table)~~ | ~~Not covered 2026-08-25 pass~~ | **Removed 2026-08-26** — confirmed not part of the reference workbook; see Frozen/static datasets table above |
| **Compare tab** | **Audited 2026-08-26** — matching-key uniqueness, added/removed/changed counts, and every KPI independently recomputed against real source files | 1 bug found & fixed: "Overall Utilization" was a temporal-scope-mismatched ratio (Class G, see above) — showed 394%/396% before the fix, 31%/32% after. Total Max Laden/Total Booked TEU were already correct and left unchanged. |

Both gaps named in the 2026-08-25 pass are now closed: the Compare tab is audited (see row above),
and the Dry/Reefer supplementary table no longer exists.

## Re-validation — 2026-09-01

Full re-audit against the same two ground-truth files (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`,
`Booking_Flash_Report_REFERENCE_08-12-2026.xlsm`), run per the AGENTS.md workflow with 3 parallel
agents (POL Booking Flash; Booking Flash Detail; Trade Summary + Sector Summary + Compare), each
running the app's **real** `getVal`/aggregation/formatting code (not a re-implementation) against
a real SheetJS parse of the raw export — not a fresh sample of rows, all ~900+ raw rows / ~440
aggregated VVDs. Everything committed between the 2026-08-26 pass and this one was UI/presentational
(text size, dark mode, sticky headers, panel layout, header/slicer minimize) — confirmed via `git log`
before starting, not assumed — so this was a genuine from-scratch re-derivation, not a rubber stamp.

6 real bugs found and fixed, all committed together with this update:

- **POL Booking Flash "POL" column** (~99.6% of rows) — was reading `Route Location 1st Pol`, a
  coarser real column that collapses distinct terminals (USLAX01/06/08 → "USLAX") into one bare
  port code, losing real terminal-level granularity everywhere this field is used (display + POL
  slicer). Fixed to read `Route Location 1st Yard` instead, the same source `yard` already used
  correctly. The old alias was dropped entirely rather than kept as a fallback, since keeping it
  would let `getVal()`'s substring-fallback pass silently reintroduce the bug on any row where the
  correct column is blank (a Class E landmine, caught by `check_alias_landmines.py` on the first
  attempted fix — see `pol`'s field-mapping row above).
- **POL Booking Flash "RFR BKG TEU"** (6/899 rows, all PAROD-related transship legs) — was reading
  `rfrBkgTtl` (`Measures Reefer TEU`, the OVERALL total, correctly used by Booking Flash/Detail's
  own "RFR BKG TTL") instead of a POL-scoped column. Added `rfrBkgPol` (`Measures POL Reefer TEU`)
  as its own field, same POL-vs-overall split already made correctly elsewhere (`curLaden`/
  `ladenTeu`, `peakPolUtilzRaw`/`peakUtilRaw`).
- **Booking Flash "Broken Routes"** (16 VVDs undercounted, several down to 0) — the only TEU-
  quantity field missing from `tableData`'s SUM-across-POL-legs list; a multi-leg VVD silently kept
  only its first leg's value.
- **Booking Flash "RFR Utiliz %"** (125 VVDs, understated 2-10x) — `rfrUtilizRaw` was computed once
  per raw POL leg and never recomputed after aggregation (the numerator, `rfrBkgTtl`, was correctly
  summed; the ratio itself wasn't refreshed from the aggregated total, unlike `actVsBkgUtilzRaw`'s
  existing recompute-after-aggregation pattern, which this now matches). `rfrBsaTeuRfMax` (the
  denominator) is now also MAX-aggregated across legs for the same reason.
- **Trade Summary row order** — Trade-level rows (TPT/TAT/LAT) had no `childOrder`, so
  `PivotTableViewer`'s fallback (plain alphabetical sort) rendered LAT/TAT/TPT instead of the
  reference workbook's real TPT/TAT/LAT order (the same order Sector Summary's own `childOrder`
  already used). Sub Trade order within each Trade was already alphabetical in the reference, so
  only the Trade level needed a fix.
- **POL Booking Flash "Status" column** — always rendered ALL CAPS (`normalizeApStatus()` output
  used directly) instead of the source's real title case ("AP Only" vs "AP ONLY"). Semantically
  correct (row coloring/slicer matching were unaffected), display-only. Added `loadingStatusDisplay`
  for the raw text, same split as `status`/`statusDisplay`.

One more display-only fix bundled in: **Last Coastal ETA Time / Proforma ETA Time** were losing
their intended zero-padded hour (e.g. "7/3/26 1:00" instead of "7/3/26 01:00") on ~46-48% of
populated rows — `formatDate`'s plain `M/D/YY` parsing branch had no trailing-time capture group
at all, unlike its ISO sibling, so a real `"7/3/26 1:00"`-shaped cell (SheetJS's actual CSV output
for these two "m/d/yy h:mm"-formatted columns) fell through to raw passthrough instead of being
recognized and zero-padded.

Everything else audited came back clean against the app's own real source (a few diffs against
the `.xlsm`'s cached values were traced to the *reference file* being stale relative to its own
embedded raw data, or to genuine upstream data drift on the live-fed Sector Summary right pivot —
not app defects; see the governing rule above this table).

## Re-validation — 2026-09-01, 2nd pass (historical dataset)

Kevin provided a real historical archive (`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`
— a colleague, Hoa, appends a day's `Data_download` export to this one published Sheet daily, dated
via a `Record Date` column; confirmed byte-identical 97-column schema to every other raw export used
in this doc). Re-ran the same 3-parallel-agent process against it (same split as the first
2026-09-01 pass) specifically to (a) confirm this new ground truth is schema-compatible and (b)
re-test the first pass's fixes against genuinely different days' data, not just the one day/rows
the first pass happened to check.

**1 more real bug found and fixed:**

- **Booking Flash "Max LDN vs BKG (Short_Fall)"** — same bug class as `broken` (fixed in the first
  2026-09-01 pass): `'shortfall'` was present in `tableData`'s init-branch numerics list but missing
  from the accumulate branch, so a multi-leg VVD's later legs' raw shortfall was silently dropped.
  Mostly masked because `row.shortfall` is normally overwritten by a fresh `ladenTeu − maxLdn` calc
  whenever the VVD's aggregated Max Laden is non-blank (the common case) — it only actually renders
  the raw summed value on the rarer maxLdn-blank branch, which is exactly why no VVD in the first
  pass's specific date happened to trigger it. Confirmed on 2 of 4 dates spot-checked (e.g.
  2026-08-28 SCNT1010W: legs [103, 0, 14, 20] should sum to 137, was rendering only 103).

**Everything else re-confirmed clean**, and specifically re-tested against multiple different real
days (not just 09-01): Broken Routes/RFR Utiliz %/RFR BKG TEU/POL-column fixes all hold up
genuinely (not dormant-by-coincidence) across every date spot-checked; Trade Summary and Sector
Summary row order (`childOrder`) confirmed on 4 different dates; and — new this pass — the first
genuine two-real-different-day test of the Compare tab's cross-date logic (previously only ever
checkable against one synthetic/hand-crafted comparison file): 2026-08-24 vs 2026-09-01,
independently recomputed added/removed/changed counts and every `overallSnapshot()` KPI (no
recurrence of the Class G temporal-scope-mismatch pattern) — all exact matches.

One data-quality observation surfaced (not an app bug, flagged for Kevin): lane `TPT/PS/EXW`'s raw
`Trade Summary Avg Max Laden` source column is literally `"0"` on its past-4-week rows despite real
non-zero `MCT Max Laden Update` and real bookings on the same rows — the app is faithfully rendering
its own raw source, not mis-wired.

## How this audit was actually run (repeatable process)

See [AGENTS.md](AGENTS.md#full-data-linkage-validation-workflow) for the step-by-step version —
in short: get a fresh raw export AND (if available) the current reference `.xlsm`, run the
static [`check_alias_landmines.py`](tests/check_alias_landmines.py) sweep first (fast, catches
the whole Class E bug class in seconds), then live-cross-check a real sample of rows/columns per
tab against the raw file and, where available, the reference workbook's own cached values —
ideally via several parallel focused agents (one per tab or per column group) rather than one
agent trying to cover everything serially.

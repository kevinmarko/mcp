# Master Prompt — Add Pivot Table Replication to the Booking Flash Report Web App

> **Status: ARCHIVED 2026-10-30. Early pivot-replication-phase plan / prompt, kept for history only.** Moved from ``files/``. Nothing in code, tests or docs cited it; the app has since moved on (current build: see README "Current version"). Doc map: [`DOCS_INDEX.md`](../../../DOCS_INDEX.md).


Use this as the top-level prompt for the coding agent (Claude Code or similar) working on this project. Paste it in as-is, and attach `booking_flash_report_REFERENCE_vba_source.txt` alongside it — the full, clean VBA macro source extracted directly from `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm`. §10's tables summarize it, but the agent must read the actual `Sub` for each button/filter before implementing or testing it — see the new requirement at the top of §10.

---

## 1. Context (as-is)

You are extending `booking_flash_report_na_Kevin_1.03_FILTERS_WORKING.html` (now in progress as `booking_flash_report_na_Kevin_1.04_PIVOTS.html`), a **single-file** web app:

- **Stack**: React 18 (UMD) + Babel Standalone (in-browser JSX, no build step) + Tailwind via CDN + SheetJS (`xlsx.full.min.js`) for client-side Excel parsing. No backend, no bundler.
- **Data flow today**: user uploads an `.xlsx` → SheetJS reads the first sheet → each row's headers are normalized (lowercased, non-alphanumeric stripped) → a `getVal(aliases)` helper fuzzy-matches many possible Excel header spellings to a fixed internal field name (e.g. `curUtilRaw`, `maxLdn`, `rfrBkgTtl`) → rows are aggregated into a Map keyed by `lane-saleWeek-vvd-vessel`, summing some numeric fields and taking `Math.max` of capacity fields → percentages and thousands-separators are formatted for display → the result renders as one big "detail" table with Trade/Sub-Trade/Lane rowspan grouping, colored status bands (VMS / AP ONLY / AP FROZEN), a remarks toggle, dimension slicers (Sub-Trade, Analyst, Coast, Lane), and free-text per-column header filters.
- This detail table is essentially a **flat replica of one Excel tab**. The workbook also contains **pivot table sheets** built on top of that same raw data, and those are not represented in the app at all yet.

## 2. Objective (to-be)

Add one or more **pivot views** to the same app, computed **client-side in JavaScript from the same uploaded raw data** (no Excel pivot engine involved at runtime) — so the web app becomes a full front end for both the raw detail data *and* the pivot summaries the team currently gets from Excel.

## 3. Inputs for Phase 0 (attach these before implementation starts)

1. **Raw data workbook** — `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026` — the flat transactional source (same shape as what's uploaded into the app today). **Received.**
2. **Pivot workbook** — `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm` — the Excel file containing the actual PivotTables and VBA macros to replicate. **Received and inspected directly** (pivot cache/table XML + VBA source extracted, not transcribed from screenshots) — see §9 and §10 for the verified findings, which supersede the earlier screenshot-based guesses.

From file 2, for **every pivot sheet**, extract:
- Sheet/pivot name and what it's meant to answer (e.g. "utilization by trade & week").
- **Row fields**, **Column fields**, **Filter/Page fields**, **Value fields** — in order.
- Aggregation per value field (Sum, Average, Count, % of Row/Column/Grand Total, custom calc).
- Any **calculated fields/items** — reproduce the exact Excel formula.
- Subtotal/grand total behavior, sort order, and any grouping (e.g. weeks grouped into months).
- Conditional formatting / color rules (compare against the existing VMS/AP ONLY/AP FROZEN pattern already in the detail view — new pivots may need the same treatment).
- Number formats (%, decimals, thousands separators) to match `formatPercent`/`formatNumberWithCommas` already in the code.

Do not guess these values — read them directly out of the pivot cache/pivot table definitions in the workbook, or manually transcribe each pivot's field list from the Excel UI.

## 4. Deliverables

1. A **field map document** (one entry per pivot sheet) per the extraction list in §3.
2. A **shared aggregation utility** — refactor the current one-off `aggregatedMap` logic in `handleFileUpload` into a reusable `groupBy(rows, { rowFields, colFields, valueFields })` function, so each pivot becomes a small config object instead of bespoke code. The existing detail-table aggregation should be re-expressed as one call to this utility so there's a single source of truth for grouping logic.
3. A **tab/view switcher** in the UI (Detail / Pivot: <name> / Pivot: <name> ...) that reuses the existing slicer and header-filter components wherever a pivot's filter fields overlap with the current ones (Sub-Trade, Analyst, Coast, Lane).
4. One **React component per pivot**, styled to match the existing table's conventions (borders, header colors `#002060`/white text, banded backgrounds, `truncate` + `max-w` on long text cells, rowspan-based grouping where the pivot has nested row fields).
5. A **validation pass**: for a sample raw-data upload, the numbers your JS pivot produces must match the numbers in the source Excel pivot exactly (spot-check totals, %, and subtotal rows).

## 5. Phased Plan

- **Phase 0 — Discovery**: ✅ Done — field maps extracted directly from the reference workbook's pivot XML and VBA, see §9/§10. One item is **blocked**, not just undiscovered: the `Sector_Data`-sourced pivot in §9 needs its data-source question resolved before it can move to Phase 1.
- **Phase 1 — Data layer refactor**: Extract raw parsed+aliased rows into one normalized array (`rawRows`) held in state, independent of any single view's aggregation. The detail view's current aggregation becomes one consumer of `rawRows`, not the only shape of the data. Note `Booking_Flash`/Detail View needs no new aggregation work per §9 — this phase is about making the *existing* logic reusable, not rebuilding it.
- **Phase 2 — Pivot engine**: Build the generic `groupBy` utility from §4.2, covering Sum/Avg/Count/%-of-total, multi-level row grouping with subtotal rows, and column pivoting (cross-tab) for `Trade_Summary`.
- **Phase 3 — UI**: Add the tab switcher, one component per pivot, and the button bars from §10 (Detail View's 11 toggles, `POL_Booking_Flash`'s separate 6, the 4 quick-filter buttons, the 2 reset buttons).
- **Phase 4 — Validation**: Cross-check computed output against the real Excel pivot on a real data snapshot; fix any aggregation/rounding mismatches.
- **Phase 5 — Polish**: number-format parity, expand/collapse of grouped rows if the source pivots use them, print/export parity if needed.

## 6. Constraints

- Keep it a **single HTML file**, same CDN stack (React 18 UMD, Babel Standalone, Tailwind CDN, SheetJS) — no build step, no new dependencies unless a pivot genuinely requires a charting/pivot library, in which case flag it and get sign-off before adding a new CDN script.
- Do not break the existing detail view, slicers, header filters, remarks/reefer toggles, or VMS/AP status coloring while refactoring the data layer.
- All code changes must be delivered as **complete, fully executable** blocks (every import, state declaration, and function body included) — no partial snippets or "rest stays the same" omissions.
- **Decided:** each pivot is a **fixed layout** matching today's Excel pivots exactly — not a dynamic drag-and-drop pivot builder. No pivot-builder library (e.g. `react-pivottable`) is needed; each pivot ships as its own config object plus React component per §4.2–§4.4.
- **Decided:** always a single fresh raw-data upload per session (as today) — no multi-file upload/merge support needed.
- **Resolved:** the pivot workbook normally refreshes on the same cadence as the raw data. However, the raw data's column headers are sometimes renamed between exports (compare the raw Excel file's headers against what the app's alias map currently expects to spot drift) — Phase 1's `getVal`/alias-map refactor must stay easy to extend with a new alias, and Phase 0 discovery should note any header already renamed relative to the current app so it can be added up front.
- **Decided:** the pivot engine (`PivotTableViewer`) must support **cross-tabbing** — a `colFields` option (e.g. `saleWeek`) that dynamically generates one column per unique value in that field, since `Trade_Summary` pivots columns by Sale Week (see correction in §9 — this was originally misattributed to `Booking_Flash`).
- **Decided:** the pivot engine must support **conditional row styling** inside pivots — an optional `rowClass` callback evaluating an aggregated row's `status`/`vvd` and applying the same Tailwind classes as the detail view (AP Only → orange `bg-[#ffc000]`, AP Frozen → red/pink `bg-[#DA9694]`, VMS → gray `bg-[#d9d9d9]`).
- **Decided:** `Trade_Summary`'s layout is **exact-match to the source pivot** — data fields (Max Laden, Total TEU, Trunk Utilization) render as row sub-labels under Sub Trade, not horizontally under each Sale Week column. Consistent with the fixed-layout decision above. (`Booking_Flash` needs no such layout decision — see §9, it's the existing Detail View.)

## 7. Known Issues (carried over from current status, predate the pivot work)

These sit in the same data layer Phase 1 touches, so fix them alongside that refactor rather than as a separate pass:

- **Calculated fields display incorrectly** in the current web app's data model — needs investigation and a fix.
- **East Coast / West Coast backend table is broken** — a connectivity issue between that table and the rest of the app needs troubleshooting.
- **Manual pivot-field renaming has caused data mismatches** requiring validation. This is the same header-drift risk noted in §6 — when a renamed field turns up, add it to the `getVal` alias map rather than patching around it one-off.
- **Missing values** are dropping out somewhere in import/aggregation — root cause not yet identified.

## 8. Project Provenance & Working Practices

- The original project files came from Adam Cosner. Work now proceeds on an independent copy so in-progress changes don't conflict with the source.
- HTML/single-file was chosen specifically to keep development complexity low.
- Frequent file versioning (separate dated/numbered copies) is the standing practice for avoiding data loss while iterating — keep following it through the pivot work.

## 9. Pivot Tab Specifications (verified directly from the reference workbook's pivot XML — supersedes earlier screenshot-based guesses)

**Correction to the tab list.** Screenshot-based planning assumed `Booking_Flash` was its own compact Sub Trade × Sale Week cross-tab. Direct inspection of the pivot cache/table definitions shows this is wrong in an important way:

- **`Booking_Flash` is not a new tab to build.** Its embedded PivotTable (`PivotTable1`, on the `Booking_Flash` sheet) has row fields Trade → Sub Trade → Lane → PIC → Sale Week → VVD → Vessel → Cutoff → ETD → Status and ~35 data fields (Max LDN, Standby Threshold, Current Laden, Peak Utiliz %, Current Laden Utiliz %, ONE Quote, Broken Routes, BSA TEU/Wgt, RFR BSA/BKG/Max/Utiliz fields, Inland/Port Activity fields, Operational Issues, Sector Allocation, Rotation/Actual Rotation, AP Status, TPT/TAT/LWT/LNT/IMT/LET, DG TEU). That's field-for-field the same set our **existing Detail View already implements**. `Booking_Flash` and `Detail View` are the same report — no separate tab or new aggregation logic needed for it. Treat any remaining "Booking_Flash tab" work as validating/fixing the existing Detail View against this pivot's numbers, not building something new.
- **The real Sub Trade × Sale Week cross-tab is `Trade_Summary`**, not `Booking_Flash`. Row fields: `Trade`, `Sub Trade`. Column field (cross-tab): `Sale Week`. Data fields: `Max Laden`, `Total TEU` (= Sum of `Measures Laden TEU`), `Trunk Utilization`. Move the layout decision from §6 (data fields as row sub-labels under Sub Trade, exact-match to source) to this tab.

**Revised tab list**: `Detail View` (= `Booking_Flash`, already built), `Trade_Summary` (the cross-tab above), `Sector_Summary` (two pivots, see below), `POL_Booking_Flash`.

**`Sector_Summary` tab — two pivots confirmed, one has a data-source gap:**

1. **"Sector Summary"** — rows: `Trade`, `Sub Trade`, `Lane`. Values: `Avg Booking` (Sum of `Trade Summary Avg Booking`), `Avg Max Laden vs Bkg`, `Avg Utilization`. Filtered to `Route Date Past 4 Week Flag = Y`. **Sourced from `Data_download`** — the underlying raw columns (`Trade Summary Avg Booking`, `Trade Summary Avg Max Laden`, `Trade Summary Avg Utiliz`, etc.) are already present in `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` (these are the "Trade Summary…" columns flagged as unmapped back in the raw-data review) — buildable now.
2. **"Sector Alloc / Average Booking / Open Space"** (the pivot next to Sector Summary — this is what §6/§10 previously called "Average Max Laden vs Booking") — rows: `Trade`, `Sub Trade`, `Lane`, `POD Sec`. Values: `Sector Alloc`, `Average Booking`, `Open Space`.
   - **⚠️ Blocking gap**: every field in this pivot is sourced from a hidden **`Sector_Data`** sheet (`POD Sec`, `MCT Sector Allocation`, `Sector Open Space`), which is a **different sheet than `Data_download`** and is **not present** in `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` (that file has only the one `Data_download` sheet). This pivot cannot be built from the current raw upload. Resolve before starting it: either (a) the raw upload needs to be expanded to also include a `Sector_Data`-equivalent export, or (b) confirm with the team where this data should come from client-side. Don't guess a substitute source.
   - The earlier "`POD Sector` has no verbatim match" gotcha under `POL_Booking_Flash` (previous §9) was misattributed — `POD Sec` isn't a `POL_Booking_Flash` field at all; it belongs here, sourced from `Sector_Data`. That gotcha is removed from the POL section below.

**`POL_Booking_Flash` tab** (unchanged from before, now confirmed as row-fields-only — no aggregation, just a large filterable/sliceable list, consistent with §9's original description):
- Row fields, in order: `Trade`, `Sub Trade`, `Lane`, `Sale Week`, `Coastal ETD`, `Port Cut`, `Status`, `VVD`, `Vessel`, `POL`.
- Conditional row styling per §6 (AP Only / AP Frozen / VMS).
- Value fields and their exact raw-data headers in `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`:

  | Screenshot field | Exact raw header |
  |---|---|
  | Planned Mty (TEU) | `Measures Planned Mty TEU` |
  | Actual Mty (TEU) | `Measures Actual Mty TEU` |
  | POL Max Laden (TEU) | `POL Max Laden TEU` |
  | Discharge (TEU) | `Measures Discharge TEU` |
  | Loadable Quant | `Measures Loadable TEU` |
  | Loadable WGT | `Measures Loadable WGT update` (keep the trailing "update" in the alias) |
  | POL | `Route Location 1st Pol` |

  One remaining mapper gotcha:
  - `POL Max Laden TEU` and `Measures POL Laden TEU` are **two different raw columns** (max capacity vs. current laden at POL) — the fuzzy alias matcher must not cross-map them.

## 10. Interactive Macros / Buttons (verified directly from the VBA source, extracted with `oletools`)

**Mandatory: do not implement or sign off on any button or filter from the tables below without reading its actual `Sub` in `booking_flash_report_REFERENCE_vba_source.txt`.** The tables in this section are a summary of that source — summaries can transcribe a range or a field name wrong. For every item, before writing the React code: open the named `Sub`, confirm the exact column range / pivot field name / item label(s) it uses, implement to match that, then manually test the built button/filter in the running app and confirm the result matches what the `Sub` does (which columns hide/show, which pivot items stay visible). Do this for all 11 Detail View toggles, all 6 `POL_Booking_Flash` toggles, all 4 quick-filter buttons, and both reset buttons — 23 items total, each checked individually, not spot-checked.

**Approved as proposed:**
- A dynamic Button Bar above the Detail View and above the Pivot Tables, replicating the original workbook's VBA macro buttons.
- Quick Filter buttons (`Filter AP Only`, `Filter AP Frozen`) and Reset buttons (`Clear Slicers`) update `selectedFilters` state directly, forcing recalculation across views.

**Decided:** implement all 11 Detail View column-visibility toggles — full parity with the Excel tool is this project's stated goal, so no reason to cut scope here.

**Decided:** two of the 11 — `Hide Reefer` and `Hide Voyage Remarks` — already exist and work today as `reeferHidden`/`remarksHidden` state. Follow that exact established pattern for the other 9 rather than introducing a new consolidated `visibleColumns` object:
- One `useState(false)` boolean per toggle, named `xHidden`/`setXHidden`.
- Label flips `Hide X` ↔ `Show X` based on the boolean.
- Background `bg-[#a9d08e]` (green) when shown, `bg-[#d9d9d9]` (grey) when hidden — use these exact hex values (the VBA source itself uses `RGB(146,208,80)`/`RGB(225,225,225)`, i.e. `#92D050`/`#E1E1E1`, but match the app's existing shades instead for visual consistency across all 11).
- Do not refactor the two existing toggles into a new state shape while adding the other 9.

**Detail View (`Booking_Flash` sheet) toggle macros — exact column ranges from `Module4`, all 11 confirmed:**

| Toggle macro | Excel column range | Shown label | Hidden label | Maps to (existing/new `getVal` field) |
|---|---|---|---|---|
| `ToggleBsa_Macro` | `S:T` | Hide BSA | BSA | `bsaTeu`, `bsaWgt` |
| `ToggleRfr_Macro` | `U:Y` | Hide Reefer | Reefer | Already implemented (`reeferHidden`) |
| `ToggleActive_Macro` | `Z:AG` | Hide Activity | Activity | `inlandAct`, `inlandNoAct`, `inlandTotal`, `portAct`, `portNoAct`, `portTotal` |
| `ToggleOps_Macro` | `AH:AH` | Hide Operational Issues | Operational Issues | `opIssues` |
| `ToggleSector_Macro` | `AI:AJ` | Hide Sector Allocation | Sector Allocation | `secAlloc` (AI), `sgsinDryVsRfr` (AJ) — see the text-formatting note below, this pair gets special rendering |
| `ToggleRotation_Macro` | `AK:AL` | Hide Rotation | Rotation | `proformaRot` (AK), `actualRot` (AL) — **see AK overlap note below** |
| `ToggleVco_Macro` | `AK:AK` | Hide VCO | VCO Analyst | Raw header `VCO Analyst`, no `getVal` alias yet — **shares column AK with Rotation, see note below** |
| `ToggleStatus_Macro` | `AM:AM` | Hide AP Status | AP Status | `apStatus` |
| `ToggleVoy_Macro` | `AN:AN` | Hide Voyage Remarks | Voyage Remarks | Already implemented (`remarksHidden`) |
| `ToggleTrade_Macro` | `AO:AT` | Hide Trade Breakdown | Trade Breakdown | `imt`, `let`, `lnt`, `lwt`, `tat`, `tpt` (all 6 fields, confirmed by field count matching the 6-column range) |
| `ToggleDG_Macro` | `AU:AU` | Hide DG | DG Volume | `dgTeu` |

⚠️ **Genuine source quirk, not a mapping error**: `ToggleRotation_Macro` covers `AK:AL` while `ToggleVco_Macro` covers `AK:AK` — column `AK` is shared between the "Rotation" and "VCO Analyst" toggle groups in the original workbook. Replicate this as-is (clicking either button should hide/show column AK; don't "fix" it by giving VCO its own column unless the team says otherwise) — flag it to the user rather than silently resolving it.

**New discovery — `POL_Booking_Flash` has its own, separate 6-button toggle bar (`Module5`), not the same 11 as the Detail View. This wasn't previously known and adds new build scope:**

| Toggle macro | Excel column range | Shown label | Hidden label |
|---|---|---|---|
| `Toggle_POL_Reefer_Macro` | `M:O` | Hide Reefer | Reefer |
| `Toggle_POL_Act_Macro` | `AA:AF` | Hide Activity | Activity |
| `Toggle_POL_ETA_Macro` | `AG:AI` | Hide ETA | ETA vs Proforma |
| `Toggle_POL_Operation_Macro` | `AJ:AJ` | Hide Operational Issues | Operational Issues |
| `Toggle_Trade` | `AO:AT` | Hide Trade Breakdown | Trade Breakdown |
| `Toggle_DG_Macro` | `AU:AU` | Hide DG | DG Volume |

Note these ranges are **not identical** to the Detail View's equivalent groups (e.g. Reefer is `M:O` here vs `U:Y` on the Detail View) — build this as its own independent toggle-bar config, not a re-use of the Detail View's column indices. `POL_Booking_Flash` does **not** have BSA, AP Status, Rotation, Voyage Remarks, Sector Allocation, or VCO toggles — only these 6.

**Separate anomaly — `See_BSA` (`Module3`)**: a differently-coded toggle (not using the shared `ToggleColumns` helper) that flips a title textbox between "Booking Flash Report NA" and "Hide BSA & BKG Weight" and shows/hides columns `Q:R`. Its column range (`Q:R`) falls inside `Trade_Summary`'s pivot output area (`B5:U30`), so this almost certainly belongs to the `Trade_Summary` tab, not the Detail View — and it's a **second, distinct BSA-related toggle** from the Detail View's own `Hide BSA` (`S:T`). Keep them separate; don't merge into one control.

**Text-formatting behavior on the Sector Allocation columns (`AI:AJ`), from `Apply_Formatting`/`Worksheet_Change`** — not just plain cell values:
- A fixed list of port/route codes (e.g. `SGSIN:`, `CNSHA:`, `KRPUS:`, `Laden:`, `MTY:`, and ~30 others — see the macro source for the full list) get **bolded** wherever they appear as substrings inside the cell text.
- Numeric deltas wrapped in asterisks — `+123*` or `(-123*)` — get their **digits colored red**.
- A cell whose content is literally just `*` is **hidden** (rendered blank) rather than showing the asterisk.
- Replicate this as real text-parsing/styling logic in the Sector Allocation cell renderer, not just a plain string — this is the actual source of that column's appearance, not a simplification.

**Quick Filter & Reset macros — exact pivot fields and values (`Module10`, `Module2`):**

| Macro | Sheet / Pivot | Field | Filters to |
|---|---|---|---|
| `Fitler_AP_Only` [sic, keep the typo out of user-facing labels] | `Booking_Flash` / `PivotTable1` | `Measures Overall Status` | Items `AP Only(GD6)` and `AP ONLY` (both label variants must be included) |
| `FilterAPStatus` | `Booking_Flash` / `PivotTable1` | `Measures Overall Status` | Item `AP Frozen(GD6)` |
| `Filter_POL_AP_Only` | `POL_Booking_Flash` / `PivotTable2` | `Status ` (note trailing space in the field name) | Item `AP Only` |
| `Filter_POL_AP_Frozen` | `POL_Booking_Flash` / `PivotTable2` | `Status ` (trailing space) | Item `AP Frozen` |
| `Clear_Booking` | `Booking_Flash` sheet | — | Clears that sheet's slicers + the `Measures Overall Status` filter |
| `Clear_POL_Slicer` | `POL_Booking_Flash` sheet | — | Clears that sheet's slicers + the `Status ` field filter |

Build these as four filter buttons (two per relevant tab — Detail View and POL Booking Flash) plus the two matching reset buttons, not one generic pair of buttons shared across all views as originally assumed.

## 11. Button/Filter Verification Checklist

Check each `Sub` off individually against `booking_flash_report_REFERENCE_vba_source.txt` per the requirement at the top of §10. Don't mark this done until all 23 boxes are actually checked against the source, not just against this table.

**Detail View toggles (`Module4`) — 11:**
`ToggleBsa_Macro` · `ToggleRfr_Macro` · `ToggleActive_Macro` · `ToggleOps_Macro` · `ToggleSector_Macro` · `ToggleRotation_Macro` · `ToggleVco_Macro` · `ToggleStatus_Macro` · `ToggleVoy_Macro` · `ToggleTrade_Macro` · `ToggleDG_Macro`

**`POL_Booking_Flash` toggles (`Module5`) — 6:**
`Toggle_POL_Reefer_Macro` · `Toggle_POL_Act_Macro` · `Toggle_POL_ETA_Macro` · `Toggle_POL_Operation_Macro` · `Toggle_Trade` · `Toggle_DG_Macro`

**Quick filters (`Module10`) — 4:**
`Fitler_AP_Only` · `FilterAPStatus` · `Filter_POL_AP_Only` · `Filter_POL_AP_Frozen`

**Reset buttons (`Module2`) — 2:**
`Clear_Booking` · `Clear_POL_Slicer`

Two items outside this list of 23, still worth a pass since they affect what these buttons interact with:
- `See_BSA` (`Module3`) — the separate `Trade_Summary`-area BSA/BKG-weight toggle noted in §10, distinct from `ToggleBsa_Macro`.
- `Apply_Formatting` / `Worksheet_Change` (`Module8`/`Sheet5`) — the Sector Allocation text-styling logic noted in §10; verify the bold-keyword list and red-delta regex are copied faithfully, not paraphrased.

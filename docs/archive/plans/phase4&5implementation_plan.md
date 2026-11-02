# Implementation Plan - Phase 4 & 5 (Validation & Polish)

> **Status: ARCHIVED 2026-10-30. Early pivot-replication-phase plan / prompt, kept for history only.** Moved from `the repo root`. Nothing in code, tests or docs cited it; the app has since moved on (current build: see README "Current version"). Doc map: [`DOCS_INDEX.md`](../../../DOCS_INDEX.md).


Since Phases 1-3 (Data Layer, Pivot Engine, UI & Tabs, Button Macros, and QoL features) are fully built and functioning, we are now entering the final phases of the project outline: **Validation & Polish**.

## User Review Required

> [!IMPORTANT]
> To successfully complete **Phase 4 (Validation)**, I need you to perform a real-world test.
> Please upload your actual `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` file into the new app and compare the numerical totals, subtotals, and percentages in our web Pivot Tables against the actual Pivot Tables in the original Excel file.
> - Look for any rounding mismatches (e.g., a percentage off by 1% due to floor/ceiling differences).
> - Look for any missing rows or dropped values.
> If anything doesn't match perfectly, reply with a screenshot or the specific cell discrepancy, and I will patch the aggregation engine to fix it!

## Proposed Changes for Phase 5 (Polish)

While you are running the validation checks on your end, I propose we build the following Phase 5 Polish features:

### 1. Expand / Collapse Grouped Rows (Pivot Polish)
Right now, the nested rows in the Pivot Tables (e.g., Trade > Sub Trade) are fully expanded by default. Excel pivot tables allow you to click the `[-]` / `[+]` icons to collapse and expand these groups.
- **Action**: I will update the `PivotTableViewer` engine to include an `expandedStates` object, rendering clickable `[+]` / `[-]` toggles next to row labels to hide/show their children.

### 2. Export to Excel / CSV (Export Parity)
Currently, the app is great for viewing, but you can't export the pivots or the filtered Detail View.
- **Action**: I will add an `Export View to CSV` button to the UI that grabs the currently visible table (Pivot or Detail View) and downloads it instantly.

### 3. "Known Issues" Sweep
- You mentioned in the project outline that some calculated fields display incorrectly and values drop out. I've already patched the `Activity vs Booking Utilz` calculation. Let me know if you spot any other specific fields that are misbehaving during your Phase 4 validation!

## Verification Plan
1. You will run the Phase 4 Validation by cross-checking the real data against the Excel pivot values.
2. I will implement the Expand/Collapse toggles and the Export button.
3. We will iterate on any final bugs you discover.

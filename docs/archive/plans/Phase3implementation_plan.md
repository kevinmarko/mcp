# Implementation Plan - Phase 3 (Interactive Macros/Buttons)

> **Status: ARCHIVED 2026-10-30. Early pivot-replication-phase plan / prompt, kept for history only.** Moved from `the repo root`. Nothing in code, tests or docs cited it; the app has since moved on (current build: see README "Current version"). Doc map: [`DOCS_INDEX.md`](../../../DOCS_INDEX.md).


After analyzing the VBA Macros in the reference Excel file, I've mapped out exactly what all the interactive buttons do. They fall into three main categories:
1. **Column Visibility Toggles**: Buttons that show/hide groups of columns in the Detail View (e.g., BSA, Activity, Reefer, Trade Breakdown, Voyage Remarks) to save horizontal space.
2. **Quick Filters**: Buttons that instantly apply specific filters (e.g., `Filter AP Only`, `Filter AP Frozen`).
3. **Reset Buttons**: Buttons that clear all slicers and filters (`Clear_POL_Slicer`, `Clear_Booking`).

## User Review Required

> [!IMPORTANT]
> **Implementation Scope**: I will build a dynamic "Button Bar" above the Detail View and Pivot Tables to replicate this functionality.
> - For the **Detail View**, the toggle buttons will dynamically show/hide specific React table columns. They will mimic the Excel design: Green when columns are shown (e.g., "Hide BSA"), and Grey when columns are hidden (e.g., "BSA").
> - For the **Pivots**, the Quick Filter buttons ("AP Only", "AP Frozen") and Reset buttons ("Clear Slicers") will directly update the `selectedFilters` state used by our Slicer components, forcing an instant recalculation of all views.

## Open Questions

> [!WARNING]
> The screenshots show 11 toggle buttons for the Detail View (`Hide AP Status`, `Hide Rotation`, `Hide Voyage Remarks`, `Hide Trade Breakdown`, `Hide DG Volume`, `Hide VCO Analyst`, `Hide BSA`, `Hide Reefer`, `Hide Activity`, `Hide Sector Allocation`, `Hide Operational Issues`). Do you want all 11 of these implemented above the Detail View, or only a specific subset? 

## Proposed Changes

### 1. Build Column Visibility Engine
- Add a new state variable in `FlashReportDashboard`: `const [visibleColumns, setVisibleColumns] = useState({ bsa: true, reefer: true, activity: true, ... })`.
- Update the Detail View `<table>` rendering logic to conditionally render `<th>` and `<td>` elements based on these state flags.
- Map each VBA toggle group to our `getVal` properties (e.g., `ToggleBsa_Macro` controls `bsaTeu` and `bsaWgt`).

### 2. Implement the "Master Shape Engine" (Toggle Buttons)
- Create a new `ToggleButtonsBar` component that renders a flex container of buttons.
- Style the buttons to turn `bg-[#92D050]` (Green) when active, and `bg-[#E1E1E1]` (Grey) when inactive.

### 3. Implement Quick Filters & Reset
- Add "Filter AP Only" and "Filter AP Frozen" buttons above the Pivot Tables.
- When clicked, these buttons will update the `selectedFilters` state for the `status` slicer: `setSelectedFilters(prev => ({ ...prev, status: new Set(['AP Only']) }))`.
- Add a "Clear Filters" button that resets `selectedFilters` to `{}`.

## Verification Plan
1. **Column Toggles**: Navigate to Detail View. Click "Hide BSA". Verify that the button turns Grey, its text changes to "BSA", and the BSA columns disappear from the table.
2. **Quick Filters**: Navigate to `POL_Booking_Flash`. Click "Filter AP Only". Verify that the pivot table recalculates immediately and the Status Slicer highlights "AP Only".
3. **Reset**: Click "Clear Filters" and ensure all data returns to the unfiltered state.

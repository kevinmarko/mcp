import re

with open('implementation_plan.md', 'r', encoding='utf-8') as f:
    plan = f.read()

# Replace the previous plan with the updated one
new_plan = """# Pivot Table Replication - Phase 2 (All Pivots & Cross-tabbing)

This plan expands on the initial pivot infrastructure to replicate all requested pivot tables from the Excel reference file, based on the provided UI screenshots.

## User Review Required

> [!IMPORTANT]
> - **Cross-Tabbing Support**: The `Booking_Flash` pivot table groups columns by `Sale Week` dynamically. The current Pivot Engine must be upgraded to support column fields (cross-tabbing) where columns expand dynamically based on data.
> - **Conditional Formatting in Pivots**: The `POL_Booking_Flash` screenshot shows that conditional row coloring (e.g., AP Only = Orange, AP Frozen = Red/Pink, VMS = Gray) is applied inside the pivot table. This means the pivot grouping logic needs to preserve or evaluate `status` and `vvd` to color the rows accordingly.
> - **Tab Structure**: We will add the following tabs: `Detail View`, `Trade Summary`, `Sector Summary`, `POL Booking Flash`, and `Booking Flash`. 
> - **Additional Pivot**: The screenshots also show an `Average Max Laden vs Booking` pivot next to the `Sector Summary`. We will add this as an independent pivot or alongside the Sector Summary.

## Open Questions

> [!WARNING]
> 1. **Data Source for POL Fields**: The `POL_Booking_Flash` pivot includes fields like `Planned Mty (TEU)`, `Actual Mty (TEU)`, `POL Max Laden (TEU)`, `Discharge (TEU)`, `Loadable Quant`, and `Loadable WGT`. Are these fields present in the raw upload (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`) and what are their exact header names in the raw data? If they are not mapped yet, I will map them.
> 2. **Cross-Tab Layout**: For `Booking_Flash`, the values (Max Laden, Total TEU, Trunk Utilization) are listed vertically as sub-rows under the Sub Trade. Do you want this exact layout (where data fields become row labels), or is it acceptable to list them horizontally under each Sale Week column?

## Proposed Changes

### 1. Upgrade Pivot Engine (`PivotTableViewer`)

#### [MODIFY] `booking_flash_report_na_Kevin_1.04_PIVOTS.html`
- **Cross-Tabbing**: Update the `groupBy` logic in `PivotTableViewer` to accept `colFields` (e.g., `saleWeek`). The component will dynamically generate columns for each unique value of the `colField`, and render the data fields within those columns.
- **Conditional Styling**: Add an optional `rowClass` callback function to the pivot configuration. This will evaluate the aggregated row's properties (like `status` or `vvd`) and apply the appropriate Tailwind background colors (e.g., `bg-[#ffc000]` for AP Only).

### 2. Implement Missing Pivot Configurations

#### [MODIFY] `booking_flash_report_na_Kevin_1.04_PIVOTS.html`
- **`Booking_Flash` Tab**: Configure with row field `Sub Trade`, column field `Sale Week`, and data fields `Max Laden`, `Current Laden` (Total TEU), and `Utilization %`.
- **`POL_Booking_Flash` Tab**: Configure with row fields: `Trade`, `Sub Trade`, `Lane`, `Sale Week`, `Coastal ETD`, `Port Cut`, `Status`, `VVD`, `Vessel`, `POL`. Apply the conditional row styling.
- **`Sector_Summary` Tab**: Add the `Average Max Laden vs Booking` pivot configuration alongside the existing `Sector Summary` pivot.
- **Data Mapper Updates**: Ensure fields like `POD Sector`, `POL`, `Planned Mty`, `Discharge`, etc. are properly extracted in the `getVal` mapping loop.

## Verification Plan

### Manual Verification
- Upload the raw data file into the browser.
- Navigate to the `Booking_Flash` tab and verify that columns are grouped by Sale Week.
- Navigate to the `POL_Booking_Flash` tab and verify that VMS rows are grayed out, and AP Only rows are highlighted orange.
- Cross-reference the grand totals with the provided screenshots.
"""

with open('implementation_plan.md', 'w', encoding='utf-8') as f:
    f.write(new_plan)

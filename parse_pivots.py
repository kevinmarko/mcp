import openpyxl

print("Loading workbook...")
wb = openpyxl.load_workbook('Booking_Flash_Report_REFERENCE_08-12-2026.xlsm', data_only=False)
for ws in wb.worksheets:
    print(f"Sheet: {ws.title}")
    if hasattr(ws, '_pivots') and ws._pivots:
        for pivot in ws._pivots:
            print(f"  Pivot: {pivot.name}")
    else:
        print("  No pivot tables found.")
print("Done.")

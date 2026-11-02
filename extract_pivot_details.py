import openpyxl

print("Loading workbook...")
wb = openpyxl.load_workbook('Booking_Flash_Report_REFERENCE_08-12-2026.xlsm', data_only=False)

for ws in wb.worksheets:
    if hasattr(ws, '_pivots') and ws._pivots:
        for pivot in ws._pivots:
            print(f"\n--- Sheet: {ws.title} | Pivot: {pivot.name} ---")
            
            # The cache contains the base fields
            try:
                cache = pivot.cache
                # We can access cache fields by index
                field_names = []
                if cache and hasattr(cache, 'cacheFields'):
                    field_names = [f.name for f in cache.cacheFields]
            except Exception as e:
                field_names = []
                print("Could not get cache fields:", e)

            # Look at pivotFields to get their names if cache fails
            pivot_fields = []
            if hasattr(pivot, 'pivotFields'):
                # Some fields might not have names in pivotFields, they refer to cache
                pass

            def get_field_name(idx):
                if field_names and idx < len(field_names):
                    return field_names[idx]
                return f"Field_{idx}"

            row_fields = []
            if pivot.rowFields:
                for field in pivot.rowFields.field:
                    row_fields.append(get_field_name(field.x))
            print("Row Fields:", row_fields)
            
            col_fields = []
            if pivot.colFields:
                for field in pivot.colFields.field:
                    col_fields.append(get_field_name(field.x))
            print("Column Fields:", col_fields)
            
            page_fields = []
            if pivot.pageFields:
                for field in pivot.pageFields.pageField:
                    page_fields.append(get_field_name(field.fld))
            print("Page/Filter Fields:", page_fields)
            
            data_fields = []
            if pivot.dataFields:
                for field in pivot.dataFields.dataField:
                    f_name = field.name
                    f_base = get_field_name(field.fld)
                    f_subtotal = field.subtotal
                    data_fields.append(f"{f_name} (Base: {f_base}, Agg: {f_subtotal})")
            print("Data Fields:", data_fields)
            

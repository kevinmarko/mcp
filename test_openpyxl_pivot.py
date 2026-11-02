import openpyxl

wb = openpyxl.load_workbook('Booking_Flash_Report_REFERENCE_08-12-2026.xlsm', data_only=False)

for ws in wb.worksheets:
    if hasattr(ws, '_pivots') and ws._pivots:
        for pivot in ws._pivots:
            print(f"\n--- Sheet: {ws.title} | Pivot: {pivot.name} ---")
            cache = pivot.cache
            field_names = []
            if cache and hasattr(cache, 'cacheFields'):
                field_names = [f.name for f in cache.cacheFields]
            
            def get_name(idx):
                if idx == -2: return "Values"
                if idx < len(field_names): return field_names[idx]
                return f"Field_{idx}"
            
            if pivot.rowFields:
                # rowFields.field might be a list
                try:
                    rfs = pivot.rowFields.field
                    print("Row Fields:", [get_name(f.x) for f in rfs])
                except AttributeError:
                    print("dir(rowFields):", dir(pivot.rowFields))
            
            if pivot.dataFields:
                dfs = []
                for df in pivot.dataFields.dataField:
                    dfs.append(f"{df.name} (Base: {get_name(df.fld)}, Agg: {df.subtotal})")
                print("Data Fields:", dfs)

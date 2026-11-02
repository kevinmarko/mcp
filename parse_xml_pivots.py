import xml.etree.ElementTree as ET
import glob
import os

ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def parse_cache(cache_id):
    cache_file = f"pivot_xmls/xl/pivotCache/pivotCacheDefinition{cache_id}.xml"
    if not os.path.exists(cache_file):
        return []
    tree = ET.parse(cache_file)
    root = tree.getroot()
    cache_fields = []
    for field in root.findall('.//ns:cacheField', ns):
        cache_fields.append(field.get('name'))
    return cache_fields

for pt_file in glob.glob('pivot_xmls/xl/pivotTables/pivotTable*.xml'):
    tree = ET.parse(pt_file)
    root = tree.getroot()
    name = root.get('name')
    cache_id = root.get('cacheId')
    
    # Try to map pivot table file to sheet name
    # We can check workbook/worksheets but let's just print the table name for now
    print(f"\n--- Pivot Table: {name} (File: {os.path.basename(pt_file)}) ---")
    
    cache_fields = parse_cache(cache_id)
    
    def get_field_name(idx):
        try:
            idx = int(idx)
            if idx == -2:
                return "Values"
            if idx >= 0 and idx < len(cache_fields):
                return cache_fields[idx]
        except (ValueError, TypeError):
            pass
        return f"Field_{idx}"
        
    row_fields = []
    for rf in root.findall('.//ns:rowFields/ns:field', ns):
        row_fields.append(get_field_name(rf.get('x')))
    print("Row Fields:", row_fields)
    
    col_fields = []
    for cf in root.findall('.//ns:colFields/ns:field', ns):
        col_fields.append(get_field_name(cf.get('x')))
    print("Column Fields:", col_fields)
    
    page_fields = []
    for pf in root.findall('.//ns:pageFields/ns:pageField', ns):
        page_fields.append(get_field_name(pf.get('fld')))
    print("Page/Filter Fields:", page_fields)
    
    data_fields = []
    for df in root.findall('.//ns:dataFields/ns:dataField', ns):
        f_name = df.get('name')
        f_base = get_field_name(df.get('fld'))
        f_subtotal = df.get('subtotal', 'sum')
        data_fields.append(f"{f_name} (Base: {f_base}, Agg: {f_subtotal})")
    print("Data Fields:", data_fields)
    
    # Look for calculated items/fields if any (might not need it right away but good to know)


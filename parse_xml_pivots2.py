import re
import glob
import os

def parse_cache(cache_id):
    cache_file = f"pivot_xmls/xl/pivotCache/pivotCacheDefinition{cache_id}.xml"
    if not os.path.exists(cache_file):
        # find the actual file name if it differs in case
        c = glob.glob(f"pivot_xmls/xl/pivotCache/pivotCacheDefinition{cache_id}.xml", recursive=True)
        if c: cache_file = c[0]
        else: return []
    with open(cache_file, 'r', encoding='utf-8') as f:
        content = f.read()
    # Simple regex to find <cacheField name="..."
    fields = re.findall(r'<[^>]*cacheField[^>]*name="([^"]+)"', content)
    return fields

for pt_file in glob.glob('pivot_xmls/xl/pivotTables/pivotTable*.xml'):
    with open(pt_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    name_match = re.search(r'name="([^"]+)"', content)
    name = name_match.group(1) if name_match else "Unknown"
    cache_match = re.search(r'cacheId="([^"]+)"', content)
    cache_id = cache_match.group(1) if cache_match else "1"
    
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
        
    row_fields_block = re.search(r'<[^>]*rowFields[^>]*>(.*?)</[^>]*rowFields>', content, re.IGNORECASE | re.DOTALL)
    row_fields = []
    if row_fields_block:
        fields = re.findall(r'<[^>]*field[^>]*x="([^"]+)"', row_fields_block.group(1))
        row_fields = [get_field_name(x) for x in fields]
    print("Row Fields:", row_fields)
    
    col_fields_block = re.search(r'<[^>]*colFields[^>]*>(.*?)</[^>]*colFields>', content, re.IGNORECASE | re.DOTALL)
    col_fields = []
    if col_fields_block:
        fields = re.findall(r'<[^>]*field[^>]*x="([^"]+)"', col_fields_block.group(1))
        col_fields = [get_field_name(x) for x in fields]
    print("Column Fields:", col_fields)
    
    page_fields_block = re.search(r'<[^>]*pageFields[^>]*>(.*?)</[^>]*pageFields>', content, re.IGNORECASE | re.DOTALL)
    page_fields = []
    if page_fields_block:
        fields = re.findall(r'<[^>]*pageField[^>]*fld="([^"]+)"', page_fields_block.group(1))
        page_fields = [get_field_name(x) for x in fields]
    print("Page/Filter Fields:", page_fields)
    
    data_fields_block = re.search(r'<[^>]*dataFields[^>]*>(.*?)</[^>]*dataFields>', content, re.IGNORECASE | re.DOTALL)
    data_fields = []
    if data_fields_block:
        dfs = re.findall(r'<[^>]*dataField(.*?)>', data_fields_block.group(1), re.IGNORECASE)
        for df in dfs:
            nm = re.search(r'name="([^"]+)"', df)
            fld = re.search(r'fld="([^"]+)"', df)
            sub = re.search(r'subtotal="([^"]+)"', df)
            f_name = nm.group(1) if nm else "Unknown"
            f_base = get_field_name(fld.group(1)) if fld else "Unknown"
            f_subtotal = sub.group(1) if sub else "sum"
            data_fields.append(f"{f_name} (Base: {f_base}, Agg: {f_subtotal})")
    print("Data Fields:", data_fields)
    

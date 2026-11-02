import re
import glob
import os

cache_fields = {}
for cache_file in glob.glob('pivot_xmls/xl/pivotCache/pivotCacheDefinition*.xml'):
    match = re.search(r'pivotCacheDefinition(\d+)\.xml', cache_file)
    cid = match.group(1) if match else "1"
    with open(cache_file, 'r', encoding='utf-8') as f:
        content = f.read()
    fields = re.findall(r'name="([^"]+)"', content)
    # The first few might be other names, but usually cacheField is the only thing with name="..."
    # Let's be more precise
    fields = re.findall(r'<[^>]*cacheField[^>]*name="([^"]+)"', content)
    if not fields:
        # try simple search
        parts = content.split('<cacheField ')
        if len(parts) == 1:
            parts = content.split('cacheField ')
        fields = []
        for p in parts[1:]:
            m = re.search(r'name="([^"]+)"', p)
            if m: fields.append(m.group(1))
    cache_fields[cid] = fields

for pt_file in glob.glob('pivot_xmls/xl/pivotTables/pivotTable*.xml'):
    with open(pt_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    name_match = re.search(r'name="([^"]+)"', content)
    name = name_match.group(1) if name_match else "Unknown"
    cache_match = re.search(r'cacheId="([^"]+)"', content)
    cache_id = cache_match.group(1) if cache_match else "1"
    
    print(f"\n--- Pivot Table: {name} (File: {os.path.basename(pt_file)}, CacheId: {cache_id}) ---")
    
    cf = cache_fields.get(cache_id, [])
    
    def get_field_name(idx):
        try:
            idx = int(idx)
            if idx == -2:
                return "Values"
            if idx >= 0 and idx < len(cf):
                return cf[idx]
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
        for df_xml in dfs:
            nm = re.search(r'name="([^"]+)"', df_xml)
            fld = re.search(r'fld="([^"]+)"', df_xml)
            sub = re.search(r'subtotal="([^"]+)"', df_xml)
            f_name = nm.group(1) if nm else "Unknown"
            f_base = get_field_name(fld.group(1)) if fld else "Unknown"
            f_subtotal = sub.group(1) if sub else "sum"
            data_fields.append(f"{f_name} (Base: {f_base}, Agg: {f_subtotal})")
    print("Data Fields:", data_fields)
    

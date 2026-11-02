import pandas as pd
import numpy as np
import openpyxl

print("Loading raw data...")
raw_df = pd.read_excel('Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx', header=1)

print("Mapping column aliases...")
def get_col(aliases):
    for c in raw_df.columns:
        for a in aliases:
            if a.lower() == str(c).lower().strip():
                return c
    for c in raw_df.columns:
        for a in aliases:
            if "".join(filter(str.isalnum, a.lower())) == "".join(filter(str.isalnum, str(c).lower())):
                return c
    return None

max_ldn_col = get_col(['MCT Max Laden', 'Max LDN', 'MaxLdn', 'Max Laden'])
cur_ldn_col = get_col(['Measures POL Laden TEU', 'Current Laden', 'Laden TEU', 'Cur Laden'])
shortfall_col = get_col(['Max LDN vs BKG', 'Short_Fall', 'Short Fall', 'Shortfall'])
quote_col = get_col(['ONE Quote', 'ONE Quote Volume', 'Quote'])

inland_act_col = get_col(['Inland Activity', 'Active Ipi TEU', 'Measures Active Ipi TEU'])
port_act_col = get_col(['Port Activity', 'Active Local TEU', 'Measures Active Local TEU'])
inland_tot_col = get_col(['Inland Total', 'Ipi Total TEU', 'Measures Ipi Total TEU'])
port_tot_col = get_col(['Port Total', 'Local Total TEU', 'Measures Local Total TEU'])

print("\n--- TEST 1: Base Totals ---")
calc_max_ldn = raw_df[max_ldn_col].sum() if max_ldn_col else 0
calc_cur_ldn = raw_df[cur_ldn_col].sum() if cur_ldn_col else 0
calc_shortfall = raw_df[shortfall_col].sum() if shortfall_col else 0
calc_quote = raw_df[quote_col].sum() if quote_col else 0
print(f"Calculated Max Laden: {calc_max_ldn}")
print(f"Calculated Cur Laden: {calc_cur_ldn}")
print(f"Calculated Shortfall: {calc_shortfall}")
print(f"Calculated Quote: {calc_quote}")

# Calculate Activity vs Booking Utilz
total_act = (raw_df[inland_act_col].sum() if inland_act_col else 0) + (raw_df[port_act_col].sum() if port_act_col else 0)
total_tot = (raw_df[inland_tot_col].sum() if inland_tot_col else 0) + (raw_df[port_tot_col].sum() if port_tot_col else 0)
calc_act_vs_bkg = total_act / total_tot if total_tot > 0 else 0
print(f"Calculated Global Activity vs Booking Utilz: {calc_act_vs_bkg:.2%}")

print("\nLoading Reference Workbook (this may take a moment)...")
try:
    wb = openpyxl.load_workbook('Booking_Flash_Report_REFERENCE_08-12-2026.xlsm', data_only=True)
    
    if 'Trade_Summary' in wb.sheetnames:
        print("\n--- TEST 2: Trade Summary Pivot ---")
        ws = wb['Trade_Summary']
        for row in range(5, ws.max_row + 1):
            val = ws.cell(row=row, column=1).value
            if val and str(val).strip() == "Grand Total":
                print(f"Found Grand Total row in Reference Pivot at row {row}")
                row_vals = [ws.cell(row=row, column=c).value for c in range(1, 15)]
                print(f"Reference Totals: {row_vals}")
                break

except Exception as e:
    print(f"Error loading reference workbook: {e}")


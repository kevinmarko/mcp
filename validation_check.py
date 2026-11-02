import pandas as pd

# Load raw data
df = pd.read_excel('Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx')

print(f"Total Rows: {len(df)}")

# Let's check Trade Summary pivot values
# Fields: Max_Laden, Standby, Cur_Laden, Shortfall, Quote, BSA_TEU, BSA_WGT, RFR_BKG_TTL
# Aliases in Excel:
max_ldn_col = [c for c in df.columns if 'Max Laden' in c or 'Max Ldn' in c or 'MaxLdn' in c]
cur_ldn_col = [c for c in df.columns if 'Current Laden' in c or 'Laden TEU' in c or 'Cur Laden' in c or 'POL Laden TEU' in c]
if not cur_ldn_col:
    cur_ldn_col = [c for c in df.columns if 'Laden' in c and 'TEU' in c]

print(f"Max Laden Col: {max_ldn_col}")
print(f"Cur Laden Col: {cur_ldn_col}")


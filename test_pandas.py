import pandas as pd
df = pd.read_excel('Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx')
cols = list(df.columns)
print("Columns:", cols[:20])

import re

def fuzzy_match(alias, col):
    return re.sub(r'[^a-zA-Z0-9]', '', str(alias).lower()) == re.sub(r'[^a-zA-Z0-9]', '', str(col).lower())

def find_col(aliases):
    for c in cols:
        for a in aliases:
            if fuzzy_match(a, c): return c
    return None

c1 = find_col(['MCT Max Laden', 'Max LDN'])
c2 = find_col(['Current Laden', 'Measures POL Laden TEU'])
print(f"Max Ldn Col: {c1}")
print(f"Cur Ldn Col: {c2}")
if c1: print("Sum Max Ldn:", df[c1].sum())
if c2: print("Sum Cur Ldn:", df[c2].sum())

import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Reset all botched replaces in the table by just pulling the original 1.03 file again and re-running everything.

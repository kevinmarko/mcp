import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the old `const handleFileUpload = (e) => { ... e.target.files[0];` with `const processFile = (file) => {`
correct_old = """            const handleFileUpload = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (!window.XLSX) {"""

correct_new = """            const processFile = (file) => {
                if (!file) return;

                if (!window.XLSX) {"""

content = content.replace(correct_old, correct_new)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed handleFileUpload redeclaration.")

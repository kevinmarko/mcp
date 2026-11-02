import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

with open('pivot_engine.js', 'r', encoding='utf-8') as f:
    engine = f.read()

start_idx = content.find('const PivotTableViewer = ({ data, config }) => {')
end_idx = content.find('function FlashReportDashboard() {')

if start_idx != -1 and end_idx != -1:
    # end_idx points to function FlashReportDashboard
    new_content = content[:start_idx] + engine + '\n        ' + content[end_idx:]
    with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Engine Replaced")
else:
    print("Could not find boundaries")

import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r') as f:
    content = f.read()

# Edit 1: Re-calculate the values for actVsBkgUtilzRaw and actVsMaxLdnRaw in the tableData memo
edit1_target = """                    row.rfrUtiliz = formatPercent(row.rfrUtilizRaw);
                    row.actVsBkgUtilz = formatPercent(row.actVsBkgUtilzRaw);
                    row.actVsMaxLdn = formatPercent(row.actVsMaxLdnRaw);"""

edit1_replacement = """                    row.rfrUtiliz = formatPercent(row.rfrUtilizRaw);
                    
                    const totalAct = (parseFloat(row.inlandAct) || 0) + (parseFloat(row.portAct) || 0);
                    const totalTot = (parseFloat(row.inlandTotal) || 0) + (parseFloat(row.portTotal) || 0);
                    row.actVsBkgUtilzRaw = totalTot > 0 ? (totalAct / totalTot) : 0;
                    row.actVsBkgUtilz = formatPercent(row.actVsBkgUtilzRaw);
                    
                    row.actVsMaxLdnRaw = totalAct - (parseFloat(row.maxLdn) || 0);
                    const formattedMaxLdnRaw = formatNumberWithCommas(row.actVsMaxLdnRaw);
                    row.actVsMaxLdn = (row.actVsMaxLdnRaw > 0 ? '+' : '') + formattedMaxLdnRaw;
                    row.actVsMaxLdnStyle = row.actVsMaxLdnRaw > 0 ? { color: 'red' } : {};"""

if edit1_target in content:
    content = content.replace(edit1_target, edit1_replacement)
    print("Edit 1 successful.")
else:
    print("Edit 1 target not found.")

# Edit 2: Modify the render line for actVsMaxLdn to support the red color and plus sign
edit2_target = """                                                    <td className={`border border-gray-400 ${getBg('bg-white', true)}`}>{row.actVsMaxLdn}</td>"""

edit2_replacement = """                                                    <td className={`border border-gray-400 ${getBg('bg-white', true)}`} style={row.actVsMaxLdnStyle}>{row.actVsMaxLdn}</td>"""

if edit2_target in content:
    content = content.replace(edit2_target, edit2_replacement)
    print("Edit 2 successful.")
else:
    print("Edit 2 target not found.")


with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w') as f:
    f.write(content)

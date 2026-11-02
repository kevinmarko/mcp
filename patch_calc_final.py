import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace `return {` with `const rowObj = {`
content = content.replace("                                return {\n                                    id: index + 1,", "                                const rowObj = {\n                                    id: index + 1,")

# Add the logic before returning
old_end = """                                    portCut: getVal(['Route Date POL Cut/off Date', 'POL Cut/off Date', 'Port Cut']),
                                    sectorRemarks: getVal(['Sector Remarks'])
                                };
                            });"""

new_end = """                                    portCut: getVal(['Route Date POL Cut/off Date', 'POL Cut/off Date', 'Port Cut']),
                                    sectorRemarks: getVal(['Sector Remarks'])
                                };
                                
                                const totalAct = (rowObj.inlandAct || 0) + (rowObj.portAct || 0);
                                const totalTot = (rowObj.inlandTotal || 0) + (rowObj.portTotal || 0);
                                rowObj.actVsBkgUtilzRaw = totalTot > 0 ? (totalAct / totalTot) : 0;
                                
                                return rowObj;
                            });"""

content = content.replace(old_end, new_end)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Calc patched.")

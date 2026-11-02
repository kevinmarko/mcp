import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

old_render = """                                if (valuesInRows) {
                                    if (row.level === 0) return null; // Don't render grand total identically if values in rows, or render it differently.
                                    
                                    return (
                                        <React.Fragment key={i}>
                                            <tr className={`${trClassBase} ${customClass}`}>
                                                <td rowSpan={dataFields.length + 1} className="border border-gray-400 p-1 text-left align-top">
                                                    <span style={{ paddingLeft: `${Math.max(0, row.level - 1) * 1.5}rem` }}>
                                                        {row.level > 0 && (row.hasChildren ? '▼ ' : '• ')}
                                                        {row.label}
                                                    </span>
                                                </td>
                                            </tr>
                                            {dataFields.map((df, dfIdx) => ("""

new_render = """                                if (valuesInRows) {
                                    return (
                                        <React.Fragment key={i}>
                                            <tr className={`${trClassBase} ${customClass} ${row.level === 0 ? 'bg-[#d9e1f2] font-bold' : ''}`}>
                                                <td rowSpan={dataFields.length + 1} className="border border-gray-400 p-1 text-left align-top">
                                                    <span style={{ paddingLeft: `${Math.max(0, row.level - 1) * 1.5}rem` }}>
                                                        {row.level > 0 && (row.hasChildren ? '▼ ' : '• ')}
                                                        {row.label}
                                                    </span>
                                                </td>
                                                {/* Fill the empty cells for the parent header row so borders connect */}
                                                <td className="border border-gray-400 p-1 bg-gray-100"></td>
                                                {[...colKeysToRender, 'Total'].map((cKey, cIdx) => (
                                                    <td key={`empty-${cIdx}`} className="border border-gray-400 p-1 bg-gray-100"></td>
                                                ))}
                                            </tr>
                                            {dataFields.map((df, dfIdx) => ("""

content = content.replace(old_render, new_render)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("PivotTableViewer patched.")

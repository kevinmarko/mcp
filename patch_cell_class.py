import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# For valuesInRows = true
old_values_td = """                                                        let displayVal = val;
                                                        if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                                        else if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                                        else if (df.format === 'accounting') displayVal = formatAccountingNumber(val);
                                                        
                                                        return <td key={cIdx} className={`border border-gray-400 p-1 ${cKey === 'Total' ? 'font-bold bg-[#eef2fa]' : ''}`}>{displayVal}</td>;
                                                    })}"""

new_values_td = """                                                        let displayVal = val;
                                                        if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                                        else if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                                        else if (df.format === 'accounting') displayVal = formatAccountingNumber(val);
                                                        
                                                        const cClass = df.cellClass ? df.cellClass(val) : '';
                                                        return <td key={cIdx} className={`border border-gray-400 p-1 ${cKey === 'Total' ? 'font-bold bg-[#eef2fa]' : ''} ${cClass}`}>{displayVal}</td>;
                                                    })}"""
content = content.replace(old_values_td, new_values_td)

# For valuesInRows = false
old_standard_td = """                                                let displayVal = val;
                                                if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                                else if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                                else if (df.format === 'accounting') displayVal = formatAccountingNumber(val);
                                                
                                                return <td key={`${cKey}-${colIdx}`} className={`border border-gray-400 p-1 ${cKey === 'Total' ? 'font-bold bg-[#eef2fa]' : ''}`}>{displayVal}</td>;
                                            })"""

new_standard_td = """                                                let displayVal = val;
                                                if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                                else if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                                else if (df.format === 'accounting') displayVal = formatAccountingNumber(val);
                                                
                                                const cClass = df.cellClass ? df.cellClass(val) : '';
                                                return <td key={`${cKey}-${colIdx}`} className={`border border-gray-400 p-1 ${cKey === 'Total' ? 'font-bold bg-[#eef2fa]' : ''} ${cClass}`}>{displayVal}</td>;
                                            })"""
content = content.replace(old_standard_td, new_standard_td)

# Now add the cellClass to Trunk Utilization in Booking_Flash config
old_util_config = "{ name: 'utilization', label: 'Trunk Utilization', agg: 'calc', calc: (t) => t.maxLdn && t.maxLdn.max > 0 ? (t.curLaden.sum / t.maxLdn.max) * 100 : 0, format: 'percent' }"
new_util_config = "{ name: 'utilization', label: 'Trunk Utilization', agg: 'calc', calc: (t) => t.maxLdn && t.maxLdn.max > 0 ? (t.curLaden.sum / t.maxLdn.max) * 100 : 0, format: 'percent', cellClass: (val) => val > 100 ? 'text-red-600 font-bold' : '' }"
content = content.replace(old_util_config, new_util_config)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Cell class patched.")

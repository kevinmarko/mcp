import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the inner td map in PivotTableViewer
old_td_map = """                                    {dataFields.map((df, colIdx) => {
                                        const t = row.totals[df.name] || { sum: 0, max: 0, count: 0 };
                                        let val = 0;
                                        if (df.agg === 'sum') val = t.sum;
                                        if (df.agg === 'max') val = t.max;
                                        if (df.agg === 'count') val = t.count;
                                        if (df.agg === 'avg') val = t.count > 0 ? t.sum / t.count : 0;
                                        
                                        let displayVal = val;
                                        if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                        if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                        
                                        return <td key={colIdx} className="border border-gray-400 p-1">{displayVal}</td>;
                                    })}"""

new_td_map = """                                    {dataFields.map((df, colIdx) => {
                                        let val = 0;
                                        if (df.agg === 'calc' && df.calc) {
                                            val = df.calc(row.totals);
                                        } else {
                                            const t = row.totals[df.name] || { sum: 0, max: 0, count: 0 };
                                            if (df.agg === 'sum') val = t.sum;
                                            if (df.agg === 'max') val = t.max;
                                            if (df.agg === 'count') val = t.count;
                                            if (df.agg === 'avg') val = t.count > 0 ? t.sum / t.count : 0;
                                        }
                                        
                                        let displayVal = val;
                                        if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                        else if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                        else if (df.format === 'accounting') displayVal = formatAccountingNumber(val);
                                        
                                        return <td key={colIdx} className="border border-gray-400 p-1">{displayVal}</td>;
                                    })}"""

content = content.replace(old_td_map, new_td_map)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("PivotTableViewer updated.")

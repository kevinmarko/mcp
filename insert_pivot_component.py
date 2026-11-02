import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

pivot_code = """
        const PivotTableViewer = ({ data, config }) => {
            const { rowFields = [], dataFields = [], title = "Pivot" } = config;
            
            const aggregated = useMemo(() => {
                const root = { _totals: {}, _children: {}, label: 'Grand Total' };
                dataFields.forEach(df => {
                    root._totals[df.name] = { sum: 0, count: 0, max: -Infinity };
                });
                
                data.forEach(row => {
                    let current = root;
                    
                    // Aggregate root
                    dataFields.forEach(df => {
                        const val = parseFloat(String(row[df.base] || '0').replace(/[,%()]/g, '')) || 0;
                        current._totals[df.name].sum += val;
                        current._totals[df.name].count += 1;
                        if (val > current._totals[df.name].max) current._totals[df.name].max = val;
                    });
                    
                    rowFields.forEach((rf, idx) => {
                        const val = row[rf.key] || '(blank)';
                        if (!current._children[val]) {
                            current._children[val] = { _totals: {}, _children: {}, label: val };
                            dataFields.forEach(df => {
                                current._children[val]._totals[df.name] = { sum: 0, count: 0, max: -Infinity };
                            });
                        }
                        
                        current = current._children[val];
                        
                        dataFields.forEach(df => {
                            const num = parseFloat(String(row[df.base] || '0').replace(/[,%()]/g, '')) || 0;
                            current._totals[df.name].sum += num;
                            current._totals[df.name].count += 1;
                            if (num > current._totals[df.name].max) current._totals[df.name].max = num;
                        });
                    });
                });
                return root;
            }, [data, config]);
            
            // Flatten tree for rendering
            const flatten = (node, level = 0, isLastChild = true, prefix = '') => {
                let rows = [];
                rows.push({
                    level,
                    label: node.label,
                    totals: node._totals,
                    isLastChild,
                    prefix,
                    hasChildren: Object.keys(node._children).length > 0
                });
                
                const childrenKeys = Object.keys(node._children).sort();
                childrenKeys.forEach((key, index) => {
                    const isLast = index === childrenKeys.length - 1;
                    const newPrefix = prefix + (isLastChild ? '    ' : '│   ');
                    rows = rows.concat(flatten(node._children[key], level + 1, isLast, newPrefix));
                });
                return rows;
            };
            
            const renderRows = useMemo(() => {
                if (!aggregated || Object.keys(aggregated._totals).length === 0) return [];
                return flatten(aggregated, 0, true, '');
            }, [aggregated]);
            
            return (
                <div className="border-2 border-black overflow-x-auto bg-white shadow-md">
                    <h2 className="text-xl font-bold bg-[#002060] text-white p-2">{title}</h2>
                    <table className="w-full text-xs text-center border-collapse border border-gray-400 whitespace-nowrap">
                        <thead className="bg-[#203764] text-white sticky top-0 z-10 shadow-sm border-black">
                            <tr>
                                <th className="border border-black p-1 min-w-[200px] text-left">Row Labels</th>
                                {dataFields.map((df, i) => (
                                    <th key={i} className="border border-black p-1 min-w-[80px]">{df.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {renderRows.map((row, i) => (
                                <tr key={i} className={`hover:bg-gray-100 ${row.level === 0 ? 'bg-[#d9e1f2] font-bold' : ''} ${row.level === 1 ? 'font-bold' : ''}`}>
                                    <td className="border border-gray-400 p-1 text-left">
                                        <span style={{ paddingLeft: `${Math.max(0, row.level - 1) * 1.5}rem` }}>
                                            {row.level > 0 && (row.hasChildren ? '▼ ' : '• ')}
                                            {row.label}
                                        </span>
                                    </td>
                                    {dataFields.map((df, colIdx) => {
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
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        };
"""

# Inject PivotTableViewer before FlashReportDashboard
content = content.replace('function FlashReportDashboard() {', pivot_code + '\n        function FlashReportDashboard() {')

# Add Tab Switcher UI
tab_switcher = """
                            <div className="flex gap-2 mb-2">
                                <button onClick={() => setActiveTab('detail')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'detail' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Detail View</button>
                                <button onClick={() => setActiveTab('trade_summary')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'trade_summary' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Trade Summary</button>
                                <button onClick={() => setActiveTab('sector_summary')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'sector_summary' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Sector Summary</button>
                            </div>
                            
"""

content = content.replace('{/* TABLE DATA */}', tab_switcher + '                            {/* TABLE DATA */}')

# Conditional rendering of tabs
# Currently: <div className="border-2 border-black overflow-x-auto bg-white shadow-md">
# I'll replace it with a conditional check.
# Wait, replacing that large block is risky if regex doesn't match perfectly.
# Let's use split.
parts = content.split('                            {/* TABLE DATA */}')
if len(parts) == 2:
    top = parts[0] + '                            {/* TABLE DATA */}\n'
    bottom = parts[1]
    
    # Bottom starts with:
    # <div className="border-2 border-black overflow-x-auto bg-white shadow-md">
    
    pivot_configs = """
                            {activeTab === 'trade_summary' && (
                                <PivotTableViewer 
                                    data={filteredRawRows}
                                    config={{
                                        title: "Trade Summary",
                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Lane' },
                                            { key: 'vvd', label: 'VVD' }
                                        ],
                                        dataFields: [
                                            { name: 'maxLdn', base: 'maxLdn', label: 'Max LDN', agg: 'sum', format: 'number' },
                                            { name: 'curLaden', base: 'curLaden', label: 'Current Laden', agg: 'sum', format: 'number' },
                                            { name: 'quote', base: 'quote', label: 'ONE Quote', agg: 'sum', format: 'number' },
                                            { name: 'bsaTeu', base: 'bsaTeu', label: 'BSA TEU', agg: 'sum', format: 'number' }
                                        ]
                                    }} 
                                />
                            )}
                            {activeTab === 'sector_summary' && (
                                <PivotTableViewer 
                                    data={filteredRawRows}
                                    config={{
                                        title: "Sector Summary",
                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Lane' }
                                        ],
                                        dataFields: [
                                            { name: 'curLaden', base: 'curLaden', label: 'Current Laden', agg: 'sum', format: 'number' },
                                            { name: 'quote', base: 'quote', label: 'ONE Quote', agg: 'sum', format: 'number' }
                                        ]
                                    }} 
                                />
                            )}
                            {activeTab === 'detail' && (
    """
    
    # I need to wrap the Detail View table inside `{activeTab === 'detail' && ( ... )}`
    # The detail view table ends at `</>`.
    
    # Find the end of the detail table
    end_idx = bottom.rfind('</>')
    if end_idx != -1:
        new_bottom = pivot_configs + bottom[:end_idx] + '                            )}\n                        </>' + bottom[end_idx+3:]
        content = top + new_bottom

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Pivot component injected.")

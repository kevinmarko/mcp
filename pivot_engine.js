        const PivotTableViewer = ({ data, config }) => {
            const { rowFields = [], dataFields = [], title = "Pivot", colField = null, valuesInRows = false, rowClass = null } = config;
            
            const aggregated = useMemo(() => {
                const root = { _totals: {}, _children: {}, label: 'Grand Total', context: {} };
                const colKeysSet = new Set();
                
                data.forEach(row => {
                    if (colField) {
                        const colVal = row[colField] || '(blank)';
                        colKeysSet.add(colVal);
                    }
                    
                    let current = root;
                    
                    const aggregateData = (node, r, colVal = 'Total') => {
                        if (!node._totals[colVal]) {
                            node._totals[colVal] = {};
                            dataFields.forEach(df => {
                                node._totals[colVal][df.name] = { sum: 0, count: 0, max: -Infinity };
                            });
                        }
                        dataFields.forEach(df => {
                            const val = parseFloat(String(r[df.base] || '0').replace(/[,%()]/g, '')) || 0;
                            node._totals[colVal][df.name].sum += val;
                            node._totals[colVal][df.name].count += 1;
                            if (val > node._totals[colVal][df.name].max) node._totals[colVal][df.name].max = val;
                        });
                    };
                    
                    const cVal = colField ? (row[colField] || '(blank)') : 'Total';
                    
                    // Aggregate root
                    aggregateData(root, row, 'Total');
                    if (colField) aggregateData(root, row, cVal);
                    
                    rowFields.forEach((rf, idx) => {
                        const val = row[rf.key] || '(blank)';
                        if (!current._children[val]) {
                            current._children[val] = { _totals: {}, _children: {}, label: val, context: { ...current.context, [rf.key]: row[rf.key] } };
                        }
                        
                        current = current._children[val];
                        aggregateData(current, row, 'Total');
                        if (colField) aggregateData(current, row, cVal);
                    });
                });
                
                const colKeys = Array.from(colKeysSet).sort();
                return { root, colKeys };
            }, [data, config]);
            
            const flatten = (node, level = 0, isLastChild = true, prefix = '') => {
                let rows = [];
                rows.push({
                    level,
                    label: node.label,
                    totals: node._totals,
                    context: node.context,
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
                if (!aggregated.root || Object.keys(aggregated.root._totals).length === 0) return [];
                return flatten(aggregated.root, 0, true, '');
            }, [aggregated]);
            
            const colKeysToRender = colField ? aggregated.colKeys : ['Total'];
            
            return (
                <div className="border-2 border-black overflow-x-auto bg-white shadow-md mb-4">
                    <h2 className="text-xl font-bold bg-[#002060] text-white p-2 flex justify-between">
                        <span>{title}</span>
                        {colField && <span className="text-sm font-normal self-end">Columns: {colField}</span>}
                    </h2>
                    <table className="w-full text-xs text-center border-collapse border border-gray-400 whitespace-nowrap">
                        <thead className="bg-[#203764] text-white sticky top-0 z-10 shadow-sm border-black">
                            {colField && !valuesInRows && (
                                <tr>
                                    <th className="border border-black p-1 min-w-[200px] text-left">Row Labels</th>
                                    {colKeysToRender.map((c, i) => (
                                        <th key={i} colSpan={dataFields.length} className="border border-black p-1 bg-[#1e2f50]">{c}</th>
                                    ))}
                                    <th colSpan={dataFields.length} className="border border-black p-1 font-bold">Grand Total</th>
                                </tr>
                            )}
                            <tr>
                                <th className="border border-black p-1 min-w-[200px] text-left">Row Labels</th>
                                {colField && valuesInRows && (
                                    <>
                                        <th className="border border-black p-1 bg-[#1e2f50]">Values</th>
                                        {colKeysToRender.map((c, i) => (
                                            <th key={i} className="border border-black p-1 bg-[#1e2f50]">{c}</th>
                                        ))}
                                        <th className="border border-black p-1 font-bold">Grand Total</th>
                                    </>
                                )}
                                {(!colField || !valuesInRows) && (colField ? [...colKeysToRender, 'Total'] : ['Total']).map((cKey) => (
                                    dataFields.map((df, dfIdx) => (
                                        <th key={`${cKey}-${dfIdx}`} className={`border border-black p-1 min-w-[80px] ${cKey === 'Total' && colField ? 'font-bold bg-[#203764]' : ''}`}>{df.label}</th>
                                    ))
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {renderRows.map((row, i) => {
                                const trClassBase = `hover:bg-gray-100 ${row.level === 0 ? 'bg-[#d9e1f2] font-bold' : ''} ${row.level === 1 ? 'font-bold' : ''}`;
                                const customClass = rowClass && row.level === rowFields.length ? rowClass(row.totals, row.context) : '';
                                
                                if (valuesInRows) {
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
                                            {dataFields.map((df, dfIdx) => (
                                                <tr key={`${i}-${dfIdx}`} className={`${customClass || 'bg-white hover:bg-gray-50'}`}>
                                                    <td className="border border-gray-400 p-1 text-left bg-gray-100 font-semibold">{df.label}</td>
                                                    {[...colKeysToRender, 'Total'].map((cKey, cIdx) => {
                                                        let val = 0;
                                                        const tGrp = row.totals[cKey] || {};
                                                        if (df.agg === 'calc' && df.calc) {
                                                            val = df.calc(tGrp);
                                                        } else {
                                                            const t = tGrp[df.name] || { sum: 0, max: 0, count: 0 };
                                                            if (df.agg === 'sum') val = t.sum;
                                                            if (df.agg === 'max') val = t.max;
                                                            if (df.agg === 'count') val = t.count;
                                                            if (df.agg === 'avg') val = t.count > 0 ? t.sum / t.count : 0;
                                                        }
                                                        
                                                        let displayVal = val;
                                                        if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                                        else if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                                        else if (df.format === 'accounting') displayVal = formatAccountingNumber(val);
                                                        
                                                        return <td key={cIdx} className={`border border-gray-400 p-1 ${cKey === 'Total' ? 'font-bold bg-[#eef2fa]' : ''}`}>{displayVal}</td>;
                                                    })}
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    );
                                }
                                
                                return (
                                    <tr key={i} className={`${trClassBase} ${customClass}`}>
                                        <td className="border border-gray-400 p-1 text-left">
                                            <span style={{ paddingLeft: `${Math.max(0, row.level - 1) * 1.5}rem` }}>
                                                {row.level > 0 && (row.hasChildren ? '▼ ' : '• ')}
                                                {row.label}
                                            </span>
                                        </td>
                                        {(colField ? [...colKeysToRender, 'Total'] : ['Total']).map((cKey) => (
                                            dataFields.map((df, colIdx) => {
                                                let val = 0;
                                                const tGrp = row.totals[cKey] || {};
                                                if (df.agg === 'calc' && df.calc) {
                                                    val = df.calc(tGrp);
                                                } else {
                                                    const t = tGrp[df.name] || { sum: 0, max: 0, count: 0 };
                                                    if (df.agg === 'sum') val = t.sum;
                                                    if (df.agg === 'max') val = t.max;
                                                    if (df.agg === 'count') val = t.count;
                                                    if (df.agg === 'avg') val = t.count > 0 ? t.sum / t.count : 0;
                                                }
                                                
                                                let displayVal = val;
                                                if (df.format === 'number') displayVal = formatNumberWithCommas(val);
                                                else if (df.format === 'percent') displayVal = `${Math.round(val)}%`;
                                                else if (df.format === 'accounting') displayVal = formatAccountingNumber(val);
                                                
                                                return <td key={`${cKey}-${colIdx}`} className={`border border-gray-400 p-1 ${cKey === 'Total' ? 'font-bold bg-[#eef2fa]' : ''}`}>{displayVal}</td>;
                                            })
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            );
        };

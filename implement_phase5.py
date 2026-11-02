import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Export to Excel Button
export_func = """            const exportToExcel = () => {
                const table = document.querySelector('table');
                if (!table || !window.XLSX) return;
                const wb = XLSX.utils.table_to_book(table);
                XLSX.writeFile(wb, `${activeTab}_export.xlsx`);
            };

            const toggleFilter = (setState, value) => {"""
content = content.replace("            const toggleFilter = (setState, value) => {", export_func)

export_btn = """                                        <button onClick={() => fileInputRef.current?.click()} className="bg-[#ddebf7] border-2 border-[#2f5597] text-[#2f5597] py-1 px-2 shadow-sm cursor-pointer hover:brightness-95 rounded-sm">Refresh Data</button>
                                        <button onClick={exportToExcel} className="bg-[#e2efda] border-2 border-[#548235] text-[#548235] py-1 px-2 shadow-sm cursor-pointer hover:brightness-95 rounded-sm">Export to Excel</button>
                                        <button onClick={clearSlicers} className="bg-[#ddebf7] border-2 border-[#2f5597] text-[#2f5597] py-1 px-2 shadow-sm cursor-pointer hover:brightness-95 rounded-sm">Clear Slicers</button>"""
content = content.replace(
    '<button onClick={() => fileInputRef.current?.click()} className="bg-[#ddebf7] border-2 border-[#2f5597] text-[#2f5597] py-1 px-2 shadow-sm cursor-pointer hover:brightness-95 rounded-sm">Refresh Data</button>\n                                        <button onClick={clearSlicers} className="bg-[#ddebf7] border-2 border-[#2f5597] text-[#2f5597] py-1 px-2 shadow-sm cursor-pointer hover:brightness-95 rounded-sm">Clear Slicers</button>',
    export_btn
)


# 2. Pivot Expand/Collapse Logic
# Update PivotTableViewer function signature to include collapsedNodes state
pivot_state_old = "        const PivotTableViewer = ({ data, config }) => {"
pivot_state_new = """        const PivotTableViewer = ({ data, config }) => {
            const [collapsedNodes, setCollapsedNodes] = useState(new Set());
            const toggleCollapse = (nodeId) => {
                const next = new Set(collapsedNodes);
                if (next.has(nodeId)) next.delete(nodeId);
                else next.add(nodeId);
                setCollapsedNodes(next);
            };"""
content = content.replace(pivot_state_old, pivot_state_new)


# Update flatten function
flatten_old = """            const flatten = (node, level = 0, isLastChild = true, prefix = '') => {
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
            };"""

flatten_new = """            const flatten = (node, level = 0, isLastChild = true, prefix = '', parentId = 'root') => {
                let rows = [];
                const nodeId = `${parentId}-${node.label}`;
                const hasChildren = Object.keys(node._children).length > 0;
                rows.push({
                    id: nodeId,
                    level,
                    label: node.label,
                    totals: node._totals,
                    context: node.context,
                    isLastChild,
                    prefix,
                    hasChildren
                });
                
                if (collapsedNodes.has(nodeId)) return rows;
                
                const childrenKeys = Object.keys(node._children).sort();
                childrenKeys.forEach((key, index) => {
                    const isLast = index === childrenKeys.length - 1;
                    const newPrefix = prefix + (isLastChild ? '    ' : '│   ');
                    rows = rows.concat(flatten(node._children[key], level + 1, isLast, newPrefix, nodeId));
                });
                return rows;
            };"""
content = content.replace(flatten_old, flatten_new)

# Update render logic to add the button
# For valuesInRows = false
row_label_standard_old = """                                                    <span style={{ paddingLeft: `${Math.max(0, row.level - 1) * 1.5}rem` }}>
                                                        {row.level > 0 && (row.hasChildren ? '▼ ' : '• ')}
                                                        {row.label}
                                                    </span>"""
row_label_standard_new = """                                                    <span style={{ paddingLeft: `${Math.max(0, row.level - 1) * 1.5}rem` }} className="flex items-center">
                                                        {row.level > 0 && (row.hasChildren 
                                                            ? <button onClick={() => toggleCollapse(row.id)} className="mr-1 w-4 text-center border border-gray-400 bg-white shadow-sm font-bold text-[10px] leading-tight hover:bg-gray-200">{collapsedNodes.has(row.id) ? '+' : '−'}</button>
                                                            : <span className="mr-1 w-4 text-center inline-block">•</span>
                                                        )}
                                                        {row.label}
                                                    </span>"""
content = content.replace(row_label_standard_old, row_label_standard_new)

# For valuesInRows = true
row_label_values_old = """                                                    <span style={{ paddingLeft: `${Math.max(0, row.level - 1) * 1.5}rem` }}>
                                                        {row.level > 0 && (row.hasChildren ? '▼ ' : '• ')}
                                                        {row.label}
                                                    </span>"""
# We can just replace both at once if they are identical. Let's see if the first replace hit both.
# If not, it means the replace only replaced the first or we need to replace all.
# Actually python string.replace replaces ALL occurrences!

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Phase 5 Polish Applied.")

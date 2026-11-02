import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add `visibleColumns` state
state_code = """
        function FlashReportDashboard() {
            const [rawData, setRawData] = useState([]);
            const [activeTab, setActiveTab] = useState('detail');
            const [selectedFilters, setSelectedFilters] = useState({});
            
            const [visibleColumns, setVisibleColumns] = useState({
                apStatus: true,
                rotation: true,
                voyageRemarks: true,
                tradeBreakdown: true,
                dgVolume: true,
                bsa: true,
                reefer: true,
                activity: true,
                sectorAlloc: true,
                opIssues: true
            });
            
            const toggleCol = (group) => {
                setVisibleColumns(prev => ({ ...prev, [group]: !prev[group] }));
            };
"""
content = content.replace("        function FlashReportDashboard() {", state_code, 1)
content = content.replace("const [rawData, setRawData] = useState([]);\n            const [activeTab, setActiveTab] = useState('detail');\n            const [selectedFilters, setSelectedFilters] = useState({});\n", "", 1)

# 2. Add Quick Filters and Reset buttons component
buttons_component = """
                            {/* Phase 3: Toggle Buttons Bar */}
                            <div className="flex flex-wrap gap-2 mb-4 p-2 bg-gray-100 rounded-md shadow-sm border border-gray-300">
                                <div className="font-bold flex items-center mr-2">Quick Actions:</div>
                                <button onClick={() => setSelectedFilters(prev => ({ ...prev, status: new Set(['AP Only']) }))} className="px-3 py-1 bg-[#ffc000] text-black font-bold text-sm rounded shadow hover:bg-yellow-500">Filter AP Only</button>
                                <button onClick={() => setSelectedFilters(prev => ({ ...prev, status: new Set(['AP Frozen']) }))} className="px-3 py-1 bg-[#DA9694] text-black font-bold text-sm rounded shadow hover:bg-red-400">Filter AP Frozen</button>
                                <button onClick={() => setSelectedFilters({})} className="px-3 py-1 bg-red-600 text-white font-bold text-sm rounded shadow hover:bg-red-700">Clear Slicers</button>
                            </div>
                            
                            {activeTab === 'detail' && (
                                <div className="flex flex-wrap gap-2 mb-4 p-2 bg-gray-100 rounded-md shadow-sm border border-gray-300">
                                    <div className="font-bold flex items-center mr-2 w-full sm:w-auto mb-2 sm:mb-0">Detail Columns:</div>
                                    {[
                                        { key: 'apStatus', labelOn: 'Hide AP Status', labelOff: 'AP Status' },
                                        { key: 'rotation', labelOn: 'Hide Rotation', labelOff: 'Rotation' },
                                        { key: 'voyageRemarks', labelOn: 'Hide Voyage Remarks', labelOff: 'Voyage Remarks' },
                                        { key: 'tradeBreakdown', labelOn: 'Hide Trade Breakdown', labelOff: 'Trade Breakdown' },
                                        { key: 'dgVolume', labelOn: 'Hide DG Volume', labelOff: 'DG Volume' },
                                        { key: 'bsa', labelOn: 'Hide BSA', labelOff: 'BSA' },
                                        { key: 'reefer', labelOn: 'Hide Reefer', labelOff: 'Reefer' },
                                        { key: 'activity', labelOn: 'Hide Activity', labelOff: 'Activity' },
                                        { key: 'sectorAlloc', labelOn: 'Hide Sector Allocation', labelOff: 'Sector Allocation' },
                                        { key: 'opIssues', labelOn: 'Hide Operational Issues', labelOff: 'Operational Issues' }
                                    ].map(btn => (
                                        <button 
                                            key={btn.key} 
                                            onClick={() => toggleCol(btn.key)}
                                            className={`px-3 py-1 font-bold text-sm rounded shadow border transition-colors ${visibleColumns[btn.key] ? 'bg-[#92D050] text-black border-green-700' : 'bg-[#e1e1e1] text-gray-700 border-gray-400'}`}
                                        >
                                            {visibleColumns[btn.key] ? btn.labelOn : btn.labelOff}
                                        </button>
                                    ))}
                                </div>
                            )}
"""

content = content.replace("                            {activeTab === 'sector_summary' && (", buttons_component + "\n                            {activeTab === 'sector_summary' && (")


# 3. Apply conditional rendering to Detail View <th> and <td> tags
# We will do this by replacing specific columns with `{visibleColumns.xxx && (<th>...</th>)}`
# First, the TH tags
th_replacements = {
    '<th className="border border-black p-1">BSA TEU</th>': '{visibleColumns.bsa && <><th className="border border-black p-1">BSA TEU</th>',
    '<th className="border border-black p-1">BSA Wgt</th>': '<th className="border border-black p-1">BSA Wgt</th></>}',
    
    '<th className="border border-black p-1">RFR BSA Plugs</th>': '{visibleColumns.reefer && <><th className="border border-black p-1">RFR BSA Plugs</th>',
    '<th className="border border-black p-1">RFR Utiliz</th>': '<th className="border border-black p-1">RFR Utiliz</th></>}',
    
    '<th className="border border-black p-1">Activity vs Booking Utilz</th>': '{visibleColumns.activity && <><th className="border border-black p-1">Activity vs Booking Utilz</th>',
    '<th className="border border-black p-1">Port Total</th>': '<th className="border border-black p-1">Port Total</th></>}',
    
    '<th className="border border-black p-1">Operational Issues</th>': '{visibleColumns.opIssues && <th className="border border-black p-1">Operational Issues</th>}',
    
    '<th className="border border-black p-1">Sector Allocation</th>': '{visibleColumns.sectorAlloc && <><th className="border border-black p-1">Sector Allocation</th>',
    '<th className="border border-black p-1">SGSIN Dry vs Reefer</th>': '<th className="border border-black p-1">SGSIN Dry vs Reefer</th></>}',
    
    '<th className="border border-black p-1">Proforma Rotation</th>': '{visibleColumns.rotation && <><th className="border border-black p-1">Proforma Rotation</th>',
    '<th className="border border-black p-1">Actual Rotation</th>': '<th className="border border-black p-1">Actual Rotation</th></>}',
    
    '<th className="border border-black p-1">AP Status</th>': '{visibleColumns.apStatus && <th className="border border-black p-1">AP Status</th>}',
    
    '<th className="border border-black p-1">TPT</th>': '{visibleColumns.tradeBreakdown && <><th className="border border-black p-1">TPT</th>',
    '<th className="border border-black p-1">LET</th>': '<th className="border border-black p-1">LET</th></>}',
    
    '<th className="border border-black p-1">DG TEU</th>': '{visibleColumns.dgVolume && <th className="border border-black p-1">DG TEU</th>}',
    
    '<th className="border border-black p-1">Remarks</th>': '{visibleColumns.voyageRemarks && <th className="border border-black p-1">Remarks</th>}'
}

for old, new in th_replacements.items():
    content = content.replace(old, new)


# Now the TD tags. They don't have unique strings inside (just {row.bsaTeu} etc.), 
# but they are very specific in the code. Let's do string replacement for the TD tags.

td_replacements = {
    '<td className="border border-gray-400 p-1">{row.bsaTeu}</td>': '{visibleColumns.bsa && <><td className="border border-gray-400 p-1">{row.bsaTeu}</td>',
    '<td className="border border-gray-400 p-1">{row.bsaWgt}</td>': '<td className="border border-gray-400 p-1">{row.bsaWgt}</td></>}',
    
    '<td className="border border-gray-400 p-1">{row.rfrBsaPlugs}</td>': '{visibleColumns.reefer && <><td className="border border-gray-400 p-1">{row.rfrBsaPlugs}</td>',
    '<td className="border border-gray-400 p-1">{formatPercent(row.rfrUtilizRaw)}</td>': '<td className="border border-gray-400 p-1">{formatPercent(row.rfrUtilizRaw)}</td></>}',
    
    '<td className="border border-gray-400 p-1">{formatPercent(row.actVsBkgUtilzRaw)}</td>': '{visibleColumns.activity && <><td className="border border-gray-400 p-1">{formatPercent(row.actVsBkgUtilzRaw)}</td>',
    '<td className="border border-gray-400 p-1">{row.portTotal}</td>': '<td className="border border-gray-400 p-1">{row.portTotal}</td></>}',
    
    '<td className="border border-gray-400 p-1 text-left max-w-xs truncate" title={row.opIssues}>{row.opIssues}</td>': '{visibleColumns.opIssues && <td className="border border-gray-400 p-1 text-left max-w-xs truncate" title={row.opIssues}>{row.opIssues}</td>}',
    
    '<td className="border border-gray-400 p-1">{row.secAlloc}</td>': '{visibleColumns.sectorAlloc && <><td className="border border-gray-400 p-1">{row.secAlloc}</td>',
    '<td className="border border-gray-400 p-1">{row.sgsinDryVsRfr}</td>': '<td className="border border-gray-400 p-1">{row.sgsinDryVsRfr}</td></>}',
    
    '<td className="border border-gray-400 p-1">{row.proformaRot}</td>': '{visibleColumns.rotation && <><td className="border border-gray-400 p-1">{row.proformaRot}</td>',
    '<td className="border border-gray-400 p-1">{row.actualRot}</td>': '<td className="border border-gray-400 p-1">{row.actualRot}</td></>}',
    
    '<td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td>': '{visibleColumns.apStatus && <td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td>}',
    '<td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td>': '{visibleColumns.apStatus && <td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td>}',
    
    '<td className="border border-gray-400 p-1">{row.tpt}</td>': '{visibleColumns.tradeBreakdown && <><td className="border border-gray-400 p-1">{row.tpt}</td>',
    '<td className="border border-gray-400 p-1">{row.let}</td>': '<td className="border border-gray-400 p-1">{row.let}</td></>}',
    
    '<td className="border border-gray-400 p-1">{row.dgTeu}</td>': '{visibleColumns.dgVolume && <td className="border border-gray-400 p-1">{row.dgTeu}</td>}',
    
    '<td className="border border-gray-400 p-1 text-left max-w-xs truncate" title={row.remarks}>{row.remarks}</td>': '{visibleColumns.voyageRemarks && <td className="border border-gray-400 p-1 text-left max-w-xs truncate" title={row.remarks}>{row.remarks}</td>}'
}

for old, new in td_replacements.items():
    content = content.replace(old, new)

# apStatus has conditional styling in the td, so we must replace the whole conditional block!
# Let's fix apStatus td manually because it has a ternary operator in the original code.
apStatus_old = """                                            {row.apStatus === 'AP Frozen' ? <td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td> : 
                                             row.apStatus === 'AP Only' ? <td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td> :
                                             <td className="border border-gray-400 p-1">{row.apStatus}</td>}"""
apStatus_new = """                                            {visibleColumns.apStatus && (
                                                row.apStatus === 'AP Frozen' ? <td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td> : 
                                                row.apStatus === 'AP Only' ? <td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td> :
                                                <td className="border border-gray-400 p-1">{row.apStatus}</td>
                                            )}"""
content = content.replace(apStatus_old, apStatus_new)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Buttons implemented.")

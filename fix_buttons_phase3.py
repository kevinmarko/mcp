import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add vco to getVal mapping (search for remarks: getVal)
content = content.replace("remarks: getVal(['Voyage Remarks', 'Remarks']),", 
                          "remarks: getVal(['Voyage Remarks', 'Remarks']),\n                                    vco: getVal(['VCO Analyst', 'VCO']),\n")

# 2. Add the state booleans for the buttons
states_old = """const [remarksHidden, setRemarksHidden] = useState(true);
            const [reeferHidden, setReeferHidden] = useState(false);"""
states_new = """const [remarksHidden, setRemarksHidden] = useState(true);
            const [reeferHidden, setReeferHidden] = useState(false);
            const [bsaHidden, setBsaHidden] = useState(false);
            const [activityHidden, setActivityHidden] = useState(false);
            const [sectorAllocHidden, setSectorAllocHidden] = useState(false);
            const [dgVolumeHidden, setDgVolumeHidden] = useState(false);
            const [opIssuesHidden, setOpIssuesHidden] = useState(false);
            const [apStatusHidden, setApStatusHidden] = useState(false);
            const [rotationHidden, setRotationHidden] = useState(false);
            const [tradeBreakdownHidden, setTradeBreakdownHidden] = useState(false);
            const [vcoHidden, setVcoHidden] = useState(false);
            const [zoomLevel, setZoomLevel] = useState(1.0);"""
content = content.replace(states_old, states_new)

# 3. Replace the UI container with the new 11 buttons + Quick actions + zoom
ui_old = """                                <div className="flex bg-[#e7e6e6] border-2 border-black p-2 shadow-sm rounded-sm text-sm font-bold text-center gap-2 w-[480px]">
                                    <div className="flex flex-col gap-1 w-1/3">
                                        <button 
                                            onClick={() => setReeferHidden(!reeferHidden)} 
                                            className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${reeferHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}
                                        >
                                            {reeferHidden ? 'Show Reefer' : 'Hide Reefer'}
                                        </button>
                                        <div className="bg-[#d9d9d9] border border-black p-1 h-full flex items-center justify-center">BSA</div>
                                        <div className="bg-[#d9d9d9] border border-black p-1 h-full flex items-center justify-center">Activity</div>
                                        <div className="bg-[#d9d9d9] border border-black p-1 h-full flex items-center justify-center text-xs leading-tight">Sector Allocation</div>
                                        <div className="bg-[#d9d9d9] border border-black p-1 h-full flex items-center justify-center">DG Volume</div>
                                    </div>
                                    <div className="flex flex-col gap-1 w-1/3">
                                        <div className="bg-[#d9d9d9] border border-black p-1 h-full flex items-center justify-center text-xs leading-tight">Operational Issues</div>
                                        <button 
                                            onClick={() => setRemarksHidden(!remarksHidden)} 
                                            className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${remarksHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}
                                        >
                                            {remarksHidden ? 'Show Voyage Remarks' : 'Hide Voyage Remarks'}
                                        </button>
                                    </div>
                                </div>"""

ui_new = """                                <div className="flex flex-col gap-2">
                                    <div className="flex bg-[#e7e6e6] border-2 border-black p-2 shadow-sm rounded-sm text-sm font-bold text-center gap-2 max-w-4xl">
                                        <div className="flex flex-col gap-1 w-1/4">
                                            <button onClick={() => setApStatusHidden(!apStatusHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${apStatusHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{apStatusHidden ? 'Show AP Status' : 'Hide AP Status'}</button>
                                            <button onClick={() => setRotationHidden(!rotationHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${rotationHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{rotationHidden ? 'Show Rotation' : 'Hide Rotation'}</button>
                                            <button onClick={() => setRemarksHidden(!remarksHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${remarksHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{remarksHidden ? 'Show Voyage Remarks' : 'Hide Voyage Remarks'}</button>
                                        </div>
                                        <div className="flex flex-col gap-1 w-1/4">
                                            <button onClick={() => setTradeBreakdownHidden(!tradeBreakdownHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${tradeBreakdownHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{tradeBreakdownHidden ? 'Show Trade Breakdown' : 'Hide Trade Breakdown'}</button>
                                            <button onClick={() => setDgVolumeHidden(!dgVolumeHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${dgVolumeHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{dgVolumeHidden ? 'Show DG Volume' : 'Hide DG Volume'}</button>
                                            <button onClick={() => setVcoHidden(!vcoHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${vcoHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{vcoHidden ? 'Show VCO Analyst' : 'Hide VCO Analyst'}</button>
                                        </div>
                                        <div className="flex flex-col gap-1 w-1/4">
                                            <button onClick={() => setBsaHidden(!bsaHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${bsaHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{bsaHidden ? 'Show BSA' : 'Hide BSA'}</button>
                                            <button onClick={() => setReeferHidden(!reeferHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${reeferHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{reeferHidden ? 'Show Reefer' : 'Hide Reefer'}</button>
                                            <button onClick={() => setActivityHidden(!activityHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${activityHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{activityHidden ? 'Show Activity' : 'Hide Activity'}</button>
                                        </div>
                                        <div className="flex flex-col gap-1 w-1/4">
                                            <button onClick={() => setSectorAllocHidden(!sectorAllocHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${sectorAllocHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{sectorAllocHidden ? 'Show Sector Allocation' : 'Hide Sector Allocation'}</button>
                                            <button onClick={() => setOpIssuesHidden(!opIssuesHidden)} className={`border border-black p-1 h-full flex items-center justify-center cursor-pointer hover:brightness-105 text-xs leading-tight transition-all ${opIssuesHidden ? 'bg-[#d9d9d9]' : 'bg-[#a9d08e]'}`}>{opIssuesHidden ? 'Show Operational Issues' : 'Hide Operational Issues'}</button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex gap-2 items-center">
                                        <button onClick={() => setSelectedFilters(prev => ({ ...prev, status: new Set(['AP Only']) }))} className="px-3 py-1 bg-[#ffc000] text-black font-bold text-sm border-2 border-black shadow hover:brightness-110">Filter AP Only</button>
                                        <button onClick={() => setSelectedFilters(prev => ({ ...prev, status: new Set(['AP Frozen']) }))} className="px-3 py-1 bg-[#DA9694] text-black font-bold text-sm border-2 border-black shadow hover:brightness-110">Filter AP Frozen</button>
                                        <button onClick={() => setSelectedFilters({})} className="px-3 py-1 bg-[#a9d08e] text-black font-bold text-sm border-2 border-black shadow hover:brightness-110">Clear Slicers</button>
                                        <div className="ml-4 flex items-center gap-2 font-bold text-sm">
                                            Zoom:
                                            <button onClick={() => setZoomLevel(prev => Math.max(0.5, prev - 0.1))} className="px-2 py-1 bg-gray-200 border-2 border-black hover:bg-gray-300">-</button>
                                            <span>{Math.round(zoomLevel * 100)}%</span>
                                            <button onClick={() => setZoomLevel(prev => Math.min(2.0, prev + 0.1))} className="px-2 py-1 bg-gray-200 border-2 border-black hover:bg-gray-300">+</button>
                                        </div>
                                    </div>
                                </div>"""
content = content.replace(ui_old, ui_new)

# 4. Hide <th> and <td> tags based on booleans

# TH standard (bottom row)
th_replacements = {
    '<th className="border border-black p-1 min-w-[50px] bg-[#DAEEF3]">{renderFilter(\'bsaTeu\')}</th>': '{!bsaHidden && <><th className="border border-black p-1 min-w-[50px] bg-[#DAEEF3]">{renderFilter(\'bsaTeu\')}</th>',
    '<th className="border border-black p-1 min-w-[60px] bg-[#DAEEF3]">{renderFilter(\'bsaWgt\')}</th>': '<th className="border border-black p-1 min-w-[60px] bg-[#DAEEF3]">{renderFilter(\'bsaWgt\')}</th></>}',
    
    '<th className="border border-black p-1 min-w-[60px]">{renderFilter(\'actVsBkgUtilzRaw\')}</th>': '{!activityHidden && <><th className="border border-black p-1 min-w-[60px]">{renderFilter(\'actVsBkgUtilzRaw\')}</th>',
    '<th className="border border-black p-1 min-w-[50px]">{renderFilter(\'portTotal\')}</th>': '<th className="border border-black p-1 min-w-[50px]">{renderFilter(\'portTotal\')}</th></>}',
    
    '<th className="border border-black p-1 min-w-[120px]">{renderFilter(\'opIssues\')}</th>': '{!opIssuesHidden && <th className="border border-black p-1 min-w-[120px]">{renderFilter(\'opIssues\')}</th>}',
    
    '<th className="border border-black p-1 min-w-[50px] bg-[#E2EFDA]">{renderFilter(\'secAlloc\')}</th>': '{!sectorAllocHidden && <><th className="border border-black p-1 min-w-[50px] bg-[#E2EFDA]">{renderFilter(\'secAlloc\')}</th>',
    '<th className="border border-black p-1 min-w-[50px] bg-[#E2EFDA]">{renderFilter(\'sgsinDryVsRfr\')}</th>': '<th className="border border-black p-1 min-w-[50px] bg-[#E2EFDA]">{renderFilter(\'sgsinDryVsRfr\')}</th></>}',
    
    '<th className="border border-black p-1 min-w-[70px]">{renderFilter(\'proformaRot\')}</th>': '{!rotationHidden && <><th className="border border-black p-1 min-w-[70px]">{renderFilter(\'proformaRot\')}</th>',
    '<th className="border border-black p-1 min-w-[70px]">{renderFilter(\'actualRot\')}</th>': '<th className="border border-black p-1 min-w-[70px]">{renderFilter(\'actualRot\')}</th></>}',
    
    '<th className="border border-black p-1 min-w-[80px]">{renderFilter(\'apStatus\')}</th>': '{!apStatusHidden && <th className="border border-black p-1 min-w-[80px]">{renderFilter(\'apStatus\')}</th>}',
    
    '<th className="border border-black p-1 min-w-[40px] bg-[#FCE4D6]">{renderFilter(\'tpt\')}</th>': '{!tradeBreakdownHidden && <><th className="border border-black p-1 min-w-[40px] bg-[#FCE4D6]">{renderFilter(\'tpt\')}</th>',
    '<th className="border border-black p-1 min-w-[40px] bg-[#FCE4D6]">{renderFilter(\'let\')}</th>': '<th className="border border-black p-1 min-w-[40px] bg-[#FCE4D6]">{renderFilter(\'let\')}</th></>}',
    
    '<th className="border border-black p-1 min-w-[40px]">{renderFilter(\'dgTeu\')}</th>': '{!dgVolumeHidden && <th className="border border-black p-1 min-w-[40px]">{renderFilter(\'dgTeu\')}</th>}',
    
    '<th className="border border-black p-1 min-w-[80px]">{renderFilter(\'vessel\')}</th>': '{!vcoHidden && <th className="border border-black p-1 min-w-[80px]">{renderFilter(\'vco\')}</th>}\n                                            <th className="border border-black p-1 min-w-[80px]">{renderFilter(\'vessel\')}</th>',
}

for old, new in th_replacements.items():
    content = content.replace(old, new)


# TH spanning (top row)
th_span_replacements = {
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA TEU</th>': '{!bsaHidden && <><th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA TEU</th>',
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA Wgt<br/>(Last NA Port )</th>': '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA Wgt<br/>(Last NA Port )</th></>}',

    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">Activity vs<br/>Booking Utilz</th>': '{!activityHidden && <><th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">Activity vs<br/>Booking Utilz</th>',
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight">Port Total</th>': '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight">Port Total</th></>}',

    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[120px] text-[11px] leading-tight text-white">Operational<br/>Issues</th>': '{!opIssuesHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[120px] text-[11px] leading-tight text-white">Operational<br/>Issues</th>}',
    
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#E2EFDA] text-black">Sector<br/>Allocation</th>': '{!sectorAllocHidden && <><th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#E2EFDA] text-black">Sector<br/>Allocation</th>',
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#E2EFDA] text-black">SGSIN Dry<br/>vs Rfr</th>': '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#E2EFDA] text-black">SGSIN Dry<br/>vs Rfr</th></>}',
    
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[70px] text-[11px] leading-tight">Proforma<br/>Rotation</th>': '{!rotationHidden && <><th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[70px] text-[11px] leading-tight">Proforma<br/>Rotation</th>',
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[70px] text-[11px] leading-tight">Actual<br/>Rotation</th>': '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[70px] text-[11px] leading-tight">Actual<br/>Rotation</th></>}',
    
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">AP<br/>Status</th>': '{!apStatusHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">AP<br/>Status</th>}',
    
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight bg-[#FCE4D6] text-black">TPT</th>': '{!tradeBreakdownHidden && <><th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight bg-[#FCE4D6] text-black">TPT</th>',
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight bg-[#FCE4D6] text-black">LET</th>': '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight bg-[#FCE4D6] text-black">LET</th></>}',
    
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight text-white">DG<br/>TEU</th>': '{!dgVolumeHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight text-white">DG<br/>TEU</th>}',

    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight text-white">Vessel<br/>Name</th>': '{!vcoHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight text-white">VCO<br/>Analyst</th>}\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight text-white">Vessel<br/>Name</th>',
}

for old, new in th_span_replacements.items():
    content = content.replace(old, new)


# TD replacements
td_replacements = {
    '<td className="border border-gray-400 p-1">{formatNumber(row.bsaTeu)}</td>': '{!bsaHidden && <><td className="border border-gray-400 p-1">{formatNumber(row.bsaTeu)}</td>',
    '<td className="border border-gray-400 p-1">{formatNumber(row.bsaWgt)}</td>': '<td className="border border-gray-400 p-1">{formatNumber(row.bsaWgt)}</td></>}',
    
    '<td className="border border-gray-400 p-1">{formatPercent(row.actVsBkgUtilzRaw)}</td>': '{!activityHidden && <><td className="border border-gray-400 p-1">{formatPercent(row.actVsBkgUtilzRaw)}</td>',
    '<td className="border border-gray-400 p-1">{formatNumber(row.portTotal)}</td>': '<td className="border border-gray-400 p-1">{formatNumber(row.portTotal)}</td></>}',
    
    '<td className="border border-gray-400 p-1 text-left max-w-[200px] truncate" title={row.opIssues}>{row.opIssues}</td>': '{!opIssuesHidden && <td className="border border-gray-400 p-1 text-left max-w-[200px] truncate" title={row.opIssues}>{row.opIssues}</td>}',
    
    '<td className="border border-gray-400 p-1">{formatNumber(row.secAlloc)}</td>': '{!sectorAllocHidden && <><td className="border border-gray-400 p-1">{formatNumber(row.secAlloc)}</td>',
    '<td className="border border-gray-400 p-1">{row.sgsinDryVsRfr}</td>': '<td className="border border-gray-400 p-1">{row.sgsinDryVsRfr}</td></>}',
    
    '<td className="border border-gray-400 p-1">{row.proformaRot}</td>': '{!rotationHidden && <><td className="border border-gray-400 p-1">{row.proformaRot}</td>',
    '<td className="border border-gray-400 p-1">{row.actualRot}</td>': '<td className="border border-gray-400 p-1">{row.actualRot}</td></>}',
    
    '<td className="border border-gray-400 p-1">{formatNumber(row.tpt)}</td>': '{!tradeBreakdownHidden && <><td className="border border-gray-400 p-1">{formatNumber(row.tpt)}</td>',
    '<td className="border border-gray-400 p-1">{formatNumber(row.let)}</td>': '<td className="border border-gray-400 p-1">{formatNumber(row.let)}</td></>}',
    
    '<td className="border border-gray-400 p-1">{formatNumber(row.dgTeu)}</td>': '{!dgVolumeHidden && <td className="border border-gray-400 p-1">{formatNumber(row.dgTeu)}</td>}',

    '<td className="border border-gray-400 p-1">{row.vessel}</td>': '{!vcoHidden && <td className="border border-gray-400 p-1">{row.vco}</td>}\n                                                <td className="border border-gray-400 p-1">{row.vessel}</td>',
}

for old, new in td_replacements.items():
    content = content.replace(old, new)


# apStatus conditional logic fix
apStatus_old = """                                                {row.apStatus === 'AP Frozen' ? <td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td> : 
                                                 row.apStatus === 'AP Only' ? <td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td> :
                                                 <td className="border border-gray-400 p-1">{row.apStatus}</td>}"""
apStatus_new = """                                                {!apStatusHidden && (
                                                    row.apStatus === 'AP Frozen' ? <td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td> : 
                                                    row.apStatus === 'AP Only' ? <td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td> :
                                                    <td className="border border-gray-400 p-1">{row.apStatus}</td>
                                                )}"""
content = content.replace(apStatus_old, apStatus_new)


# Zoom transformation wrapper for the table. 
# Search for <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border-2 border-black bg-white shadow-md">
# Replace inner content to have a style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}
table_div_old = """<div className="overflow-x-auto overflow-y-auto max-h-[70vh] border-2 border-black bg-white shadow-md">
                                <table className="w-full text-xs text-center border-collapse border border-gray-400 whitespace-nowrap">"""
table_div_new = """<div className="overflow-x-auto overflow-y-auto max-h-[70vh] border-2 border-black bg-white shadow-md">
                                <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }} className="transition-transform duration-200">
                                <table className="w-full text-xs text-center border-collapse border border-gray-400 whitespace-nowrap">"""
content = content.replace(table_div_old, table_div_new)

# Make sure to close the new div. 
table_close_old = "</table>\n                            </div>\n                        </div>"
table_close_new = "</table>\n                                </div>\n                            </div>\n                        </div>"
content = content.replace(table_close_old, table_close_new)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Buttons fixed.")

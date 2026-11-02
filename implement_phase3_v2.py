import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. State Variables
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

# 2. Add VCO to getVal mapping
content = content.replace("remarks: getVal(['Voyage Remarks', 'Remarks']),", 
                          "remarks: getVal(['Voyage Remarks', 'Remarks']),\n                                    vco: getVal(['VCO Analyst', 'VCO Analyst ', 'VCO']),\n")

# 3. Replace the old flex container with the new one
ui_old_regex = r'<div className="flex bg-\[\#e7e6e6\] border-2 border-black p-2 shadow-sm rounded-sm text-sm font-bold text-center gap-2 w-\[480px\]">.*?</div>\n                                </div>'
ui_new = """<div className="flex flex-col gap-2">
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
                                        <div className="ml-2 flex items-center gap-2 font-bold text-sm">
                                            Zoom:
                                            <button onClick={() => setZoomLevel(prev => Math.max(0.5, prev - 0.1))} className="px-2 py-1 bg-gray-200 border-2 border-black hover:bg-gray-300">-</button>
                                            <span>{Math.round(zoomLevel * 100)}%</span>
                                            <button onClick={() => setZoomLevel(prev => Math.min(2.0, prev + 0.1))} className="px-2 py-1 bg-gray-200 border-2 border-black hover:bg-gray-300">+</button>
                                        </div>
                                    </div>
                                </div>"""
content = re.sub(ui_old_regex, ui_new, content, flags=re.DOTALL)

# 4. Zoom wrapper for Detail View table
table_div_old = """<div className="overflow-x-auto overflow-y-auto max-h-[70vh] border-2 border-black bg-white shadow-md">
                                <table className="w-full text-xs text-center border-collapse border border-gray-400 whitespace-nowrap">"""
table_div_new = """<div className="overflow-x-auto overflow-y-auto max-h-[70vh] border-2 border-black bg-white shadow-md">
                                <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }} className="transition-transform duration-200">
                                <table className="w-full text-xs text-center border-collapse border border-gray-400 whitespace-nowrap">"""
content = content.replace(table_div_old, table_div_new)

table_close_old = "</table>\n                            </div>\n                        </div>"
table_close_new = "</table>\n                                </div>\n                            </div>\n                        </div>"
content = content.replace(table_close_old, table_close_new)


with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("First pass done.")

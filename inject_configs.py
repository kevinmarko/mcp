import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Update tabs
old_tabs = """                            <div className="flex gap-2 mb-2">
                                <button onClick={() => setActiveTab('detail')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'detail' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Detail View</button>
                                <button onClick={() => setActiveTab('trade_summary')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'trade_summary' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Trade Summary</button>
                                <button onClick={() => setActiveTab('sector_summary')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'sector_summary' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Sector Summary</button>
                            </div>"""
                            
new_tabs = """                            <div className="flex gap-2 mb-2">
                                <button onClick={() => setActiveTab('trade_summary')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'trade_summary' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Trade_Summary</button>
                                <button onClick={() => setActiveTab('sector_summary')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'sector_summary' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Sector_Summary</button>
                                <button onClick={() => setActiveTab('pol_booking')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'pol_booking' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>POL_Booking_Flash</button>
                                <button onClick={() => setActiveTab('booking_flash')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'booking_flash' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Booking_Flash</button>
                                <button onClick={() => setActiveTab('detail')} className={`px-4 py-2 font-bold rounded-t-md ${activeTab === 'detail' ? 'bg-[#002060] text-white' : 'bg-gray-300 text-black hover:bg-gray-400'}`}>Detail View</button>
                            </div>"""

content = content.replace(old_tabs, new_tabs)

# Inject the new configs under Sector Summary
old_sector = """                                            { name: 'utilization', label: 'Current Laden Utiliz %', agg: 'calc', calc: (t) => t.secAlloc && t.secAlloc.sum > 0 ? (t.curLaden.sum / t.secAlloc.sum) * 100 : 0, format: 'percent' },
                                        ]
                                    }} 
                                />
                            )}
                            {activeTab === 'detail' && ("""
                            
new_sector = """                                            { name: 'utilization', label: 'Current Laden Utiliz %', agg: 'calc', calc: (t) => t.secAlloc && t.secAlloc.sum > 0 ? (t.curLaden.sum / t.secAlloc.sum) * 100 : 0, format: 'percent' },
                                        ]
                                    }} 
                                />
                                <PivotTableViewer 
                                    data={filteredRawRows}
                                    config={{
                                        title: "Average Max Laden vs Booking",
                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Lane' }
                                        ],
                                        dataFields: [
                                            { name: 'avgMaxLdn', base: 'maxLdn', label: 'Avg Max Laden', agg: 'avg', format: 'number' },
                                            { name: 'avgBkg', base: 'curLaden', label: 'Avg Booking', agg: 'avg', format: 'number' },
                                            { name: 'avgMaxVsBkg', label: 'Avg Max Laden vs Bkg', agg: 'calc', calc: (t) => {
                                                const avgBkg = t.avgBkg.count > 0 ? t.avgBkg.sum/t.avgBkg.count : 0;
                                                const avgMax = t.avgMaxLdn.count > 0 ? t.avgMaxLdn.sum/t.avgMaxLdn.count : 0;
                                                return avgBkg - avgMax;
                                            }, format: 'accounting' },
                                            { name: 'avgUtilz', label: 'Avg Utilization', agg: 'calc', calc: (t) => {
                                                const avgBkg = t.avgBkg.count > 0 ? t.avgBkg.sum/t.avgBkg.count : 0;
                                                const avgMax = t.avgMaxLdn.count > 0 ? t.avgMaxLdn.sum/t.avgMaxLdn.count : 0;
                                                return avgMax > 0 ? (avgBkg / avgMax) * 100 : 0;
                                            }, format: 'percent' }
                                        ]
                                    }} 
                                />
                            </>
                            )}
                            {activeTab === 'pol_booking' && (
                                <PivotTableViewer 
                                    data={filteredRawRows}
                                    config={{
                                        title: "POL_Booking_Flash",
                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Service' },
                                            { key: 'saleWeek', label: 'Sale Week' },
                                            { key: 'coastalEtd', label: 'Coastal ETD' },
                                            { key: 'portCut', label: 'Port Cut' },
                                            { key: 'status', label: 'Status' },
                                            { key: 'vvd', label: 'VVD' },
                                            { key: 'vessel', label: 'Vessel Name' },
                                            { key: 'pol', label: 'POL' }
                                        ],
                                        rowClass: (totals, ctx) => {
                                            const vvd = String(ctx.vvd || '').trim().toUpperCase();
                                            const status = String(ctx.status || '').trim();
                                            if (vvd === 'VMS') return 'bg-[#d9d9d9] text-black font-semibold border-b border-gray-400';
                                            if (status === 'AP Frozen') return 'bg-[#DA9694] font-bold';
                                            if (status === 'AP Only') return 'bg-[#ffc000] font-bold';
                                            return '';
                                        },
                                        dataFields: [
                                            { name: 'plannedMty', base: 'plannedMty', label: 'Planned Mty (TEU)', agg: 'sum', format: 'number' },
                                            { name: 'actualMty', base: 'actualMty', label: 'Actual Mty (TEU)', agg: 'sum', format: 'number' },
                                            { name: 'polMaxLdn', base: 'polMaxLdn', label: 'POL Max Laden (TEU)', agg: 'max', format: 'number' },
                                            { name: 'polLdnThresh', base: 'polLdnThresh', label: 'POL Laden Threshold', agg: 'max', format: 'percent' },
                                            { name: 'discharge', base: 'discharge', label: 'Discharge (TEU)', agg: 'sum', format: 'number' },
                                            { name: 'curLaden', base: 'curLaden', label: 'Current Laden (TEU)', agg: 'sum', format: 'number' },
                                            { name: 'peakPolUtilz', base: 'peakPolUtilzRaw', label: 'Peak Laden Utilz', agg: 'max', format: 'percent' },
                                            { name: 'polBkgUtilz', base: 'polBkgUtilzRaw', label: 'Current Laden Utilz', agg: 'max', format: 'percent' },
                                            { name: 'maxLdnVsPolBkg', base: 'maxLdnVsPolBkg', label: 'Max Laden Vs POL Booking', agg: 'sum', format: 'accounting' },
                                            { name: 'loadableQuant', base: 'loadableQuant', label: 'Loadable Quant', agg: 'sum', format: 'number' },
                                            { name: 'loadableWgt', base: 'loadableWgt', label: 'Loadable WGT', agg: 'sum', format: 'number' }
                                        ]
                                    }} 
                                />
                            )}
                            {activeTab === 'booking_flash' && (
                                <PivotTableViewer 
                                    data={filteredRawRows}
                                    config={{
                                        title: "Booking_Flash",
                                        rowFields: [{ key: 'subTrade', label: 'Sub Trade' }],
                                        colField: 'saleWeek',
                                        valuesInRows: true,
                                        dataFields: [
                                            { name: 'maxLdn', base: 'maxLdn', label: 'Max Laden', agg: 'max', format: 'number' },
                                            { name: 'curLaden', base: 'curLaden', label: 'Total TEU', agg: 'sum', format: 'number' },
                                            { name: 'utilization', label: 'Trunk Utilization', agg: 'calc', calc: (t) => t.maxLdn && t.maxLdn.max > 0 ? (t.curLaden.sum / t.maxLdn.max) * 100 : 0, format: 'percent' }
                                        ]
                                    }} 
                                />
                            )}
                            {activeTab === 'detail' && ("""

# Need to wrap sector summary in a fragment if rendering two components side by side
# Wait, Sector Summary already has `{activeTab === 'sector_summary' && (` at the top.
# Let's adjust my replace logic to match exactly.
content = content.replace(
    "{activeTab === 'sector_summary' && (\n                                <PivotTableViewer", 
    "{activeTab === 'sector_summary' && (\n                                <>\n                                <PivotTableViewer"
)
content = content.replace(old_sector, new_sector)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Configs injected.")

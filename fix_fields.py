import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update getVal mappings
# We will replace the whole mapping block to be safe.
# Find `return {\n                                    id: index + 1,` and replace down to `portCut: getVal`

start_idx = content.find("return {\n                                    id: index + 1,")
end_idx = content.find("};\n                            });")

if start_idx != -1 and end_idx != -1:
    old_mapper = content[start_idx:end_idx]
    new_mapper = """return {
                                    id: index + 1,
                                    trade: getVal(['Trade']) || 'TPT',
                                    subTrade: getVal(['Sub Trade', 'SubTrade', 'Sub_Trade']),
                                    lane: getVal(['Lane', 'Service']),
                                    saleWeek: getVal(['Sale Week', 'SaleWeek', 'Week']),
                                    pic: getVal(['MCT Spc Analyst', 'PIC (spc/mkg)', 'PIC', 'SPC Analyst', 'Mktg Analyst']),
                                    coast: getVal(['MCT Spc Team', 'Spc Team', 'Coast']),
                                    cutoff: getVal(['1st POL Cutoff', '1stPOLCutoff', 'Cutoff', '1st POL']),
                                    etd: getVal(['ETD Last Port', 'ETDLastPort', 'Last Port ETD', 'ETD']),
                                    status: getVal(['Measures Overall Status', 'BKG FLASH STATUS', 'MeasuresOverallStatus']),
                                    vvd: getVal(['Vessel 1st VVD', 'VVD', 'Voyage']),
                                    vessel: getVal(['Vessel Name', 'Vessel']),
                                    maxLdn: getVal(['MCT Max Laden', 'Max LDN', 'MaxLdn', 'Max Laden']),
                                    standbyRaw: getVal(['Standby Threshold', 'Overall Threshold', 'Threshold', 'Standby']),
                                    curLaden: getVal(['Measures POL Laden TEU', 'Current Laden', 'Laden TEU', 'Cur Laden']),
                                    peakUtilRaw: getVal(['Peak Utiliz', 'Peak Overall', 'Peak Util']),
                                    curUtilRaw: getVal(['Measures Overall Booking Utilz', 'Current Laden Utiliz', 'Booking Utilz', 'Booking Utiliz']),
                                    shortfall: getVal(['Max LDN vs BKG', 'Short_Fall', 'Short Fall', 'Shortfall']),
                                    quote: getVal(['ONE Quote', 'ONE Quote Volume', 'Quote']),
                                    broken: getVal(['Broken Routes', 'Broken']),
                                    bsaTeu: getVal(['BSA TEU']),
                                    bsaWgt: getVal(['BSA Wgt', 'BSA QTY', 'Wgt']),
                                    rfrBsaPlugs: getVal(['RFR BSA Plugs', 'BSA UNIT RF']),
                                    rfrBkgPlugs: getVal(['RFR BKG Plugs', 'Booking Reefer UNIT']),
                                    rfrMaxLdn: getVal(['RFR Max LDN', 'RFR Max Laden']),
                                    rfrBkgTtl: getVal(['RFR BKG TTL', 'Reefer TEU', 'RFR BKG Total']),
                                    rfrUtilizRaw: getVal(['RFR Utiliz', 'Reefer Utilz', 'Reefer Utiliz']),
                                    actVsBkgUtilzRaw: getVal(['Activity vs Booking Utilz', 'ActVsBkg']),
                                    actVsMaxLdnRaw: getVal(['Activity vs Max Laden', 'ActVsMax']),
                                    inlandAct: getVal(['Inland Activity', 'Active Ipi']),
                                    inlandNoAct: getVal(['Inland No Activity', 'Non Active Ipi']),
                                    inlandTotal: getVal(['Inland Total', 'Ipi Total']),
                                    portAct: getVal(['Port Activity', 'Active Local']),
                                    portNoAct: getVal(['Port No Activity', 'Non Active Local']),
                                    portTotal: getVal(['Port Total', 'Local Total']),
                                    opIssues: getVal(['Operational Issues', 'Operation Notice']),
                                    secAlloc: getVal(['Sector Allocation', 'Sec Alloc']),
                                    sgsinDryVsRfr: getVal(['SGSIN Dry vs Reefer', 'SGSIN Dry vs Rfr']),
                                    proformaRot: getVal(['Proforma Rotation', 'Proforma ETA']),
                                    actualRot: getVal(['Actual Rotation', 'Actual Ro']),
                                    apStatus: getVal(['AP Status']),
                                    tpt: getVal(['TPT']),
                                    tat: getVal(['TAT']),
                                    lwt: getVal(['LWT']),
                                    lnt: getVal(['LNT']),
                                    imt: getVal(['IMT']),
                                    let: getVal(['LET']),
                                    dgTeu: getVal(['DG TEU']),
                                    remarks: getVal(['Voyage Remarks', 'Remarks']),
                                    pol: getVal(['Route Location 1st Pol', '1st Pol', 'POL']),
                                    plannedMty: getVal(['Measures Planned Mty TEU', 'Planned Mty']),
                                    actualMty: getVal(['Measures Actual Mty TEU', 'Actual Mty']),
                                    polMaxLdn: getVal(['POL Max Laden TEU', 'POL Max Laden']),
                                    polLdnThresh: getVal(['POL Laden Threshold', 'POL Laden Thresh']),
                                    discharge: getVal(['Measures Discharge TEU', 'Discharge']),
                                    peakPolUtilzRaw: getVal(['Measures Peak Pol Utilz', 'Peak Pol Utilz']),
                                    polBkgUtilzRaw: getVal(['Measures POL Booking Utilz', 'POL Booking Utilz']),
                                    maxLdnVsPolBkg: getVal(['Max Laden vs POL  Booking', 'Max Laden vs POL Booking']),
                                    loadableQuant: getVal(['Measures Loadable TEU', 'Loadable Quant', 'Loadable TEU']),
                                    loadableWgt: getVal(['Measures Loadable WGT update', 'Loadable WGT']),
                                    coastalEtd: getVal(['Route Date Coastal ETD Date', 'Coastal ETD Date', 'Coastal ETD']),
                                    portCut: getVal(['Route Date POL Cut/off Date', 'POL Cut/off Date', 'Port Cut']),
                                    sectorRemarks: getVal(['Sector Remarks'])
                                """
    content = content.replace(old_mapper, new_mapper)

# 2. Add sectorRows useMemo
sector_rows_code = """
            const sectorRows = useMemo(() => {
                const parsed = [];
                filteredRawRows.forEach(row => {
                    if (row.sectorRemarks) {
                        const parts = String(row.sectorRemarks).split('/');
                        parts.forEach(p => {
                            const match = p.match(/([A-Z]+):\s*([\d,]+)\s*-\s*([\d,]+)/);
                            if (match) {
                                parsed.push({
                                    ...row,
                                    podSector: match[1],
                                    sectorAlloc: parseFloat(match[2].replace(/,/g, '')),
                                    avgBooking: parseFloat(match[3].replace(/,/g, ''))
                                });
                            }
                        });
                    }
                });
                return parsed;
            }, [filteredRawRows]);
"""
# Insert before const tableData = useMemo
content = content.replace("const tableData = useMemo(() => {", sector_rows_code + "\n            const tableData = useMemo(() => {")

# 3. Fix Sector Summary config
old_sector_config = """<PivotTableViewer 
                                    data={filteredRawRows}
                                    config={{
                                        title: "Sector_Summary",
                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Lane' },
                                            { key: 'saleWeek', label: 'Sale Week' }
                                        ],
                                        dataFields: [
                                            { name: 'secAlloc', base: 'secAlloc', label: 'Sector Alloc', agg: 'sum', format: 'number' },
                                            { name: 'avgBooking', base: 'curLaden', label: 'Average Booking', agg: 'avg', format: 'number' },
                                            { name: 'curLaden', base: 'curLaden', label: 'Current Laden', agg: 'sum', format: 'number' },
                                            { name: 'utilization', label: 'Current Laden Utiliz %', agg: 'calc', calc: (t) => t.secAlloc && t.secAlloc.sum > 0 ? (t.curLaden.sum / t.secAlloc.sum) * 100 : 0, format: 'percent' },
                                        ]
                                    }} 
                                />"""
                                
new_sector_config = """<PivotTableViewer 
                                    data={sectorRows}
                                    config={{
                                        title: "Sector Summary",
                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Lane' },
                                            { key: 'podSector', label: 'POD Sector' }
                                        ],
                                        dataFields: [
                                            { name: 'secAlloc', base: 'sectorAlloc', label: 'Sector Alloc', agg: 'avg', format: 'number' },
                                            { name: 'avgBooking', base: 'avgBooking', label: 'Average Booking', agg: 'avg', format: 'number' },
                                            { name: 'openSpace', label: 'Open Space', agg: 'calc', calc: (t) => {
                                                const alloc = t.secAlloc.count > 0 ? t.secAlloc.sum/t.secAlloc.count : 0;
                                                const bkg = t.avgBooking.count > 0 ? t.avgBooking.sum/t.avgBooking.count : 0;
                                                return Math.max(0, alloc - bkg);
                                            }, format: 'number' }
                                        ]
                                    }} 
                                />"""

content = content.replace(old_sector_config, new_sector_config)

# 4. Fix Average Max Laden vs Booking calc layout (same tab, next to it)
old_avg_config = """<PivotTableViewer 
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
                                />"""

# We want them side-by-side if they are in the same tab. Let's wrap them in a flex container.
# Wait, they are currently wrapped in <> ... </>. We can just change <> to <div className="flex gap-4 items-start">
content = content.replace("{activeTab === 'sector_summary' && (\n                                <>\n", "{activeTab === 'sector_summary' && (\n                                <div className=\"flex flex-col lg:flex-row gap-8 items-start\">\n")
content = content.replace("\n                            </>\n                            )}", "\n                            </div>\n                            )}")

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fields and configs fixed.")

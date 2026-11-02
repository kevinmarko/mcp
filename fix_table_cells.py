import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. BSA (rowSpan 2)
c = content.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA TEU</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA Wgt<br/>(Last NA Port )</th>',
    '{!bsaHidden && (\n                                                <>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA TEU</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#DAEEF3] text-black">BSA Wgt<br/>(Last NA Port )</th>\n                                                </>\n                                            )}'
)

# 2. Activity (mixed rows)
# Row 1 headers for Activity
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">Activity vs<br/>Booking Utilz</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">Activity vs<br/>Max Laden</th>\n                                            \n                                            <th colSpan={3} className="border border-black font-bold p-1 min-w-[160px] text-[12px] leading-tight bg-[#C4BD97] text-black">Inland Activity</th>\n                                            <th colSpan={3} className="border border-black font-bold p-1 min-w-[160px] text-[12px] leading-tight bg-[#C4BD97] text-black">Port Activity</th>',
    '{!activityHidden && (\n                                                <>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">Activity vs<br/>Booking Utilz</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">Activity vs<br/>Max Laden</th>\n                                                    <th colSpan={3} className="border border-black font-bold p-1 min-w-[160px] text-[12px] leading-tight bg-[#C4BD97] text-black">Inland Activity</th>\n                                                    <th colSpan={3} className="border border-black font-bold p-1 min-w-[160px] text-[12px] leading-tight bg-[#C4BD97] text-black">Port Activity</th>\n                                                </>\n                                            )}'
)
# Row 2 headers for Activity
c = c.replace(
    '<th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Inland<br/>Activity</th>\n                                            <th className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#002060] text-white">Inland No<br/>Activity</th>\n                                            <th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Inland<br/>Total</th>\n                                            <th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Port<br/>Activity</th>\n                                            <th className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#002060] text-white">Port No<br/>Activity</th>\n                                            <th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Port<br/>Total</th>',
    '{!activityHidden && (\n                                                <>\n                                                    <th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Inland<br/>Activity</th>\n                                                    <th className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#002060] text-white">Inland No<br/>Activity</th>\n                                                    <th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Inland<br/>Total</th>\n                                                    <th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Port<br/>Activity</th>\n                                                    <th className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight bg-[#002060] text-white">Port No<br/>Activity</th>\n                                                    <th className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight bg-[#002060] text-white">Port<br/>Total</th>\n                                                </>\n                                            )}'
)

# 3. Operational Issues
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">Operational<br/>Issues</th>',
    '{!opIssuesHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">Operational<br/>Issues</th>}'
)

# 4. Sector Allocation
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">Sector<br/>Allocation</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">SGSIN Dry<br/>vs Reefer</th>',
    '{!sectorAllocHidden && (\n                                                <>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">Sector<br/>Allocation</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">SGSIN Dry<br/>vs Reefer</th>\n                                                </>\n                                            )}'
)

# 5. Rotation
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[100px] text-[11px] leading-tight">Proforma<br/>Rotation</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[100px] text-[11px] leading-tight">Actual<br/>Rotation</th>',
    '{!rotationHidden && (\n                                                <>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[100px] text-[11px] leading-tight">Proforma<br/>Rotation</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[100px] text-[11px] leading-tight">Actual<br/>Rotation</th>\n                                                </>\n                                            )}'
)

# 6. AP Status
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">AP<br/>Status</th>',
    '{!apStatusHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[60px] text-[11px] leading-tight">AP<br/>Status</th>}'
)

# 7. Trade Breakdown
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">TPT</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">TAT</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">LWT</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">LNT</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">IMT</th>\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">LET</th>',
    '{!tradeBreakdownHidden && (\n                                                <>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">TPT</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">TAT</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">LWT</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">LNT</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">IMT</th>\n                                                    <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[40px] text-[11px] leading-tight">LET</th>\n                                                </>\n                                            )}'
)

# 8. DG Volume
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight">DG<br/>TEU</th>',
    '{!dgVolumeHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[50px] text-[11px] leading-tight">DG<br/>TEU</th>}'
)

# 9. VCO Analyst
c = c.replace(
    '<th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">Vessel<br/>Name</th>',
    '{!vcoHidden && <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">VCO<br/>Analyst</th>}\n                                            <th rowSpan={2} className="border border-black font-semibold p-1.5 min-w-[80px] text-[11px] leading-tight">Vessel<br/>Name</th>'
)


# === NOW REPLACE THE DATA CELLS ===

# 1. BSA Data Cells
c = c.replace(
    '<td className="border border-gray-400 p-1">{formatNumber(row.bsaTeu)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.bsaWgt)}</td>',
    '{!bsaHidden && (\n                                                            <>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.bsaTeu)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.bsaWgt)}</td>\n                                                            </>\n                                                        )}'
)

# 2. Activity Data Cells
c = c.replace(
    '<td className="border border-gray-400 p-1">{formatPercent(row.actVsBkgUtilzRaw)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatPercent(row.actVsMaxLdnRaw)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.inlandAct)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.inlandNoAct)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.inlandTotal)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.portAct)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.portNoAct)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.portTotal)}</td>',
    '{!activityHidden && (\n                                                            <>\n                                                                <td className="border border-gray-400 p-1">{formatPercent(row.actVsBkgUtilzRaw)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatPercent(row.actVsMaxLdnRaw)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.inlandAct)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.inlandNoAct)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.inlandTotal)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.portAct)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.portNoAct)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.portTotal)}</td>\n                                                            </>\n                                                        )}'
)

# 3. Operational Issues
c = c.replace(
    '<td className="border border-gray-400 p-1 text-left max-w-[200px] truncate" title={row.opIssues}>{row.opIssues}</td>',
    '{!opIssuesHidden && <td className="border border-gray-400 p-1 text-left max-w-[200px] truncate" title={row.opIssues}>{row.opIssues}</td>}'
)

# 4. Sector Allocation Data Cells
c = c.replace(
    '<td className="border border-gray-400 p-1">{formatNumber(row.secAlloc)}</td>\n                                                        <td className="border border-gray-400 p-1">{row.sgsinDryVsRfr}</td>',
    '{!sectorAllocHidden && (\n                                                            <>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.secAlloc)}</td>\n                                                                <td className="border border-gray-400 p-1">{row.sgsinDryVsRfr}</td>\n                                                            </>\n                                                        )}'
)

# 5. Rotation Data Cells
c = c.replace(
    '<td className="border border-gray-400 p-1">{row.proformaRot}</td>\n                                                        <td className="border border-gray-400 p-1">{row.actualRot}</td>',
    '{!rotationHidden && (\n                                                            <>\n                                                                <td className="border border-gray-400 p-1">{row.proformaRot}</td>\n                                                                <td className="border border-gray-400 p-1">{row.actualRot}</td>\n                                                            </>\n                                                        )}'
)

# 6. AP Status Conditional Formatting cell
c = c.replace(
    """{row.apStatus === 'AP Frozen' ? <td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td> : 
                                                         row.apStatus === 'AP Only' ? <td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td> :
                                                         <td className="border border-gray-400 p-1">{row.apStatus}</td>}""",
    """{!apStatusHidden && (
                                                            row.apStatus === 'AP Frozen' ? <td className="border border-gray-400 p-1 font-bold bg-[#DA9694]">{row.apStatus}</td> : 
                                                            row.apStatus === 'AP Only' ? <td className="border border-gray-400 p-1 font-bold bg-[#ffc000]">{row.apStatus}</td> :
                                                            <td className="border border-gray-400 p-1">{row.apStatus}</td>
                                                        )}"""
)

# 7. Trade Breakdown Data Cells
c = c.replace(
    '<td className="border border-gray-400 p-1">{formatNumber(row.tpt)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.tat)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.lwt)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.lnt)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.imt)}</td>\n                                                        <td className="border border-gray-400 p-1">{formatNumber(row.let)}</td>',
    '{!tradeBreakdownHidden && (\n                                                            <>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.tpt)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.tat)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.lwt)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.lnt)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.imt)}</td>\n                                                                <td className="border border-gray-400 p-1">{formatNumber(row.let)}</td>\n                                                            </>\n                                                        )}'
)

# 8. DG Volume
c = c.replace(
    '<td className="border border-gray-400 p-1">{formatNumber(row.dgTeu)}</td>',
    '{!dgVolumeHidden && <td className="border border-gray-400 p-1">{formatNumber(row.dgTeu)}</td>}'
)

# 9. VCO Analyst
c = c.replace(
    '<td className="border border-gray-400 p-1">{row.vessel}</td>',
    '{!vcoHidden && <td className="border border-gray-400 p-1">{row.vco}</td>}\n                                                        <td className="border border-gray-400 p-1">{row.vessel}</td>'
)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(c)

print("Headers and cells patched safely.")

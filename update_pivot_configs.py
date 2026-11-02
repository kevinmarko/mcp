import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the configs
old_trade = """                                        rowFields: [
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
                                        ]"""

new_trade = """                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Lane' },
                                            { key: 'saleWeek', label: 'Sale Week' },
                                            { key: 'vvd', label: 'VVD' },
                                            { key: 'vessel', label: 'Vessel' }
                                        ],
                                        dataFields: [
                                            { name: 'maxLdn', base: 'maxLdn', label: 'Max LDN', agg: 'max', format: 'number' },
                                            { name: 'standby', base: 'standbyRaw', label: 'Standby Threshold', agg: 'max', format: 'percent' },
                                            { name: 'curLaden', base: 'curLaden', label: 'Current Laden', agg: 'sum', format: 'number' },
                                            { name: 'utilization', label: 'Current Laden Utiliz %', agg: 'calc', calc: (t) => t.maxLdn && t.maxLdn.max > 0 ? (t.curLaden.sum / t.maxLdn.max) * 100 : 0, format: 'percent' },
                                            { name: 'shortfall', label: 'Shortfall', agg: 'calc', calc: (t) => t.maxLdn && t.maxLdn.max > 0 ? t.curLaden.sum - t.maxLdn.max : 0, format: 'accounting' },
                                            { name: 'quote', base: 'quote', label: 'ONE Quote', agg: 'sum', format: 'number' },
                                            { name: 'bsaTeu', base: 'bsaTeu', label: 'BSA TEU', agg: 'max', format: 'number' },
                                            { name: 'rfrBkgTtl', base: 'rfrBkgTtl', label: 'RFR BKG TTL', agg: 'sum', format: 'number' },
                                            { name: 'portTotal', base: 'portTotal', label: 'Port Total', agg: 'sum', format: 'number' }
                                        ]"""

content = content.replace(old_trade, new_trade)

old_sector = """                                        rowFields: [
                                            { key: 'trade', label: 'Trade' },
                                            { key: 'subTrade', label: 'Sub Trade' },
                                            { key: 'lane', label: 'Lane' }
                                        ],
                                        dataFields: [
                                            { name: 'curLaden', base: 'curLaden', label: 'Current Laden', agg: 'sum', format: 'number' },
                                            { name: 'quote', base: 'quote', label: 'ONE Quote', agg: 'sum', format: 'number' }
                                        ]"""
                                        
new_sector = """                                        rowFields: [
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
                                        ]"""

content = content.replace(old_sector, new_sector)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Configs updated.")

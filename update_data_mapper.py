import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

old_mapper = """                                    remarks: getVal(['Voyage Remarks', 'Remarks'])
                                };
                            });"""
                            
new_mapper = """                                    remarks: getVal(['Voyage Remarks', 'Remarks']),
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
                                    portCut: getVal(['Route Date POL Cut/off Date', 'POL Cut/off Date', 'Port Cut'])
                                };
                            });"""

content = content.replace(old_mapper, new_mapper)

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Data mapper updated.")

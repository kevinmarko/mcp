import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r') as f:
    content = f.read()

# I will update the getVal alias arrays to include the exact headers.
content = content.replace("quote: getVal(['ONE Quote', 'ONE Quote Volume', 'Quote'])", "quote: getVal(['Measures ONE Quote volume', 'ONE Quote', 'ONE Quote Volume', 'Quote'])")
content = content.replace("broken: getVal(['Broken Routes', 'Broken'])", "broken: getVal(['Measures Broken Routes TEU', 'Broken Routes', 'Broken'])")
content = content.replace("peakUtilRaw: getVal(['Peak Utiliz', 'Peak Overall', 'Peak Util'])", "peakUtilRaw: getVal(['Measures Peak Overall Utilz', 'Peak Utiliz', 'Peak Overall', 'Peak Util'])")
content = content.replace("curUtilRaw: getVal(['Measures Overall Booking Utilz', 'Current Laden Utiliz', 'Booking Utiliz', 'Booking Utiliz'])", "curUtilRaw: getVal(['Measures Overall Booking Utilz', 'Current Laden Utiliz', 'Booking Utiliz'])")
content = content.replace("shortfall: getVal(['Max LDN vs BKG', 'Short_Fall', 'Short Fall', 'Shortfall'])", "shortfall: getVal(['Max LDN vs BKG', 'Short_Fall', 'Short Fall', 'Shortfall', 'Max Laden vs POL  Booking', 'Max Laden vs POL Booking'])")
content = content.replace("standbyRaw: getVal(['Standby Threshold', 'Overall Threshold', 'Threshold', 'Standby'])", "standbyRaw: getVal(['Trunk Threshold', 'Standby Threshold', 'Overall Threshold', 'Threshold', 'Standby'])")
content = content.replace("peakPolUtilRaw: getVal(['Peak Pol Utilz', 'Peak POL'])", "peakPolUtilRaw: getVal(['Measures Peak Pol Utilz', 'Peak Pol Utilz', 'Peak POL'])")

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w') as f:
    f.write(content)

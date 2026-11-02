import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# The data mapper returns an object:
#                 portTotal: getVal(['Port Total'], 'number'),
#                 opIssues: getVal(['Operational Issues']),
#                 ...
# We will intercept it at the end of the `return` statement block inside `processExcelData`.

old_return = """                vessel: getVal(['Vessel Name']),
                remarks: getVal(['Voyage Remarks', 'Remarks']),
                
                // Add default properties for pivots
                val: 1 
            };
        });"""

new_return = """                vessel: getVal(['Vessel Name']),
                remarks: getVal(['Voyage Remarks', 'Remarks']),
                
                // Add default properties for pivots
                val: 1 
            };
            
            // Phase 3 Follow-up: Calculate Activity vs Booking Utilz dynamically
            const totalActivity = (rowObj.inlandAct || 0) + (rowObj.portAct || 0);
            const totalPossible = (rowObj.inlandTotal || 0) + (rowObj.portTotal || 0);
            rowObj.actVsBkgUtilzRaw = totalPossible > 0 ? (totalActivity / totalPossible) : 0;
            
            return rowObj;
        });"""

# But wait, in the current code, `return { trade: ..., subTrade: ... }` is anonymous. 
# We need to change it to `const rowObj = { ... };` and then return it.
# Let's see how it looks currently.

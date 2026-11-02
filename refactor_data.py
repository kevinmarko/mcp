import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. State changes
content = content.replace(
    'const [tableData, setTableData] = useState([]);\n            const fileInputRef = useRef(null);',
    'const [rawRows, setRawRows] = useState([]);\n            const [activeTab, setActiveTab] = useState(\'detail\');\n            const fileInputRef = useRef(null);'
)

# 2. Add coast to formattedData mapping
content = content.replace(
    "pic: getVal(['PIC (spc/mkg)', 'PIC', 'SPC Analyst', 'Spc Team', 'Mktg Analyst']),",
    "pic: getVal(['MCT Spc Analyst', 'PIC (spc/mkg)', 'PIC', 'SPC Analyst', 'Mktg Analyst']),\n                                    coast: getVal(['MCT Spc Team', 'Spc Team', 'Coast']),"
)

# 3. Extract formatting functions outside FlashReportDashboard
formatters = """
        const getPercentNum = (val) => {
            if (!val) return 0;
            let s = String(val).trim();
            if (s.includes('%')) return parseFloat(s) || 0;
            let n = parseFloat(s);
            if (isNaN(n)) return 0;
            if (n > 0 && n <= 5) return n * 100;
            return n;
        };

        const formatPercent = (val) => {
            if (val === '' || val === null || val === undefined) return '';
            let strVal = String(val).trim();
            if (strVal.includes('%')) {
                const parsed = parseFloat(strVal);
                return isNaN(parsed) ? strVal : `${Math.round(parsed)}%`;
            }
            let num = parseFloat(strVal);
            if (!isNaN(num)) {
                if (num > 0 && num <= 5) return `${Math.round(num * 100)}%`;
                else if (num === 0) return `0%`;
                else return `${Math.round(num)}%`;
            }
            return strVal;
        };

        const formatNumberWithCommas = (val) => {
            if (val === '' || val === null || val === undefined || isNaN(val)) return val;
            return Math.round(parseFloat(val)).toLocaleString('en-US');
        };

        const formatAccountingNumber = (val) => {
            if (val === '' || val === null || val === undefined || isNaN(val)) return val;
            const num = Math.round(parseFloat(val));
            if (num < 0) {
                return `(-${Math.abs(num).toLocaleString('en-US')})`;
            }
            return num.toLocaleString('en-US');
        };
        
        function FlashReportDashboard() {
"""
content = content.replace('function FlashReportDashboard() {\n', formatters)

# 4. Remove formatters from inside handleFileUpload, and move the aggregation logic to a useMemo
# We will use regex to find the block from `const aggregatedMap = {};` up to `setTableData(finalData);`

# The block to replace
start_idx = content.find('const aggregatedMap = {};')
end_idx = content.find("setTableData(finalData);\n                            if (fileInputRef.current) fileInputRef.current.value = '';")
if start_idx != -1 and end_idx != -1:
    end_idx += len("setTableData(finalData);\n                            if (fileInputRef.current) fileInputRef.current.value = '';")
    
    # We will replace it with just:
    new_block = "setRawRows(formattedData);\n                            if (fileInputRef.current) fileInputRef.current.value = '';"
    content = content[:start_idx] + new_block + content[end_idx:]

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Initial refactor applied.")

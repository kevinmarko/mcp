import re

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the processedData block and insert tableData useMemo
# Find from `const processedData = useMemo(() => {` to `return spanned;\n            }, [selectedSubTrades, selectedAnalysts, selectedLanes, tableData, headerFilters]);`

start_idx = content.find('const processedData = useMemo(() => {')
end_idx = content.find('            }, [selectedSubTrades, selectedAnalysts, selectedLanes, tableData, headerFilters]);')
if start_idx != -1 and end_idx != -1:
    end_idx += len('            }, [selectedSubTrades, selectedAnalysts, selectedLanes, tableData, headerFilters]);')
    
    new_block = """
            const filteredRawRows = useMemo(() => {
                return rawRows.filter(row => {
                    const matchSubTrade = selectedSubTrades.length === 0 || selectedSubTrades.includes(row.subTrade);
                    const matchAnalyst = selectedAnalysts.length === 0 || selectedAnalysts.some(analyst =>
                        row.pic && row.pic.toLowerCase().includes(analyst.toLowerCase())
                    );
                    const matchLane = selectedLanes.length === 0 || selectedLanes.includes(row.lane);
                    const matchCoast = selectedCoasts.length === 0 || selectedCoasts.includes(row.coast);
                    
                    let matchHeaderFilters = true;
                    for (const key in headerFilters) {
                        const filterValue = headerFilters[key];
                        if (filterValue && filterValue.trim() !== '') {
                            const rawRowVal = String(row[key] || '').toLowerCase();
                            const searchVal = filterValue.toLowerCase().trim();
                            
                            const cleanedRowVal = rawRowVal.replace(/[,%()]/g, '');
                            const cleanedSearchVal = searchVal.replace(/[,%()]/g, '');
                            
                            if (!rawRowVal.includes(searchVal) && !cleanedRowVal.includes(cleanedSearchVal)) {
                                matchHeaderFilters = false;
                                break;
                            }
                        }
                    }
                    return matchSubTrade && matchAnalyst && matchLane && matchCoast && matchHeaderFilters;
                });
            }, [rawRows, selectedSubTrades, selectedAnalysts, selectedLanes, selectedCoasts, headerFilters]);

            const tableData = useMemo(() => {
                const aggregatedMap = {};
                filteredRawRows.forEach(row => {
                    const key = `${row.lane}-${row.saleWeek}-${row.vvd}-${row.vessel}`;
                    if (!row.vvd && !row.vessel) {
                        aggregatedMap[`uid-${row.id}`] = row;
                        return;
                    }

                    if (!aggregatedMap[key]) {
                        aggregatedMap[key] = { ...row };
                        const numerics = ['curLaden', 'quote', 'shortfall', 'rfrBkgPlugs', 'rfrBkgTtl', 'inlandAct', 'inlandNoAct', 'inlandTotal', 'portAct', 'portNoAct', 'portTotal', 'dgTeu', 'tpt', 'tat', 'lwt', 'lnt', 'imt', 'let'];
                        numerics.forEach(n => aggregatedMap[key][n] = parseFloat(aggregatedMap[key][n]) || 0);

                        const maxes = ['maxLdn', 'bsaTeu', 'bsaWgt', 'rfrBsaPlugs', 'rfrMaxLdn'];
                        maxes.forEach(n => aggregatedMap[key][n] = parseFloat(aggregatedMap[key][n]) || 0);
                        
                        aggregatedMap[key].curUtilRaw = getPercentNum(row.curUtilRaw);
                    } else {
                        const numerics = ['curLaden', 'quote', 'rfrBkgPlugs', 'rfrBkgTtl', 'inlandAct', 'inlandNoAct', 'inlandTotal', 'portAct', 'portNoAct', 'portTotal', 'dgTeu', 'tpt', 'tat', 'lwt', 'lnt', 'imt', 'let'];
                        numerics.forEach(n => {
                            aggregatedMap[key][n] += (parseFloat(row[n]) || 0);
                        });

                        const maxes = ['maxLdn', 'bsaTeu', 'bsaWgt', 'rfrBsaPlugs', 'rfrMaxLdn'];
                        maxes.forEach(n => {
                            aggregatedMap[key][n] = Math.max(aggregatedMap[key][n], parseFloat(row[n]) || 0);
                        });
                        
                        aggregatedMap[key].curUtilRaw += getPercentNum(row.curUtilRaw);
                    }
                });

                return Object.values(aggregatedMap).map(row => {
                    row.standby = formatPercent(row.standbyRaw);
                    row.peakUtil = formatPercent(row.peakUtilRaw);
                    row.rfrUtiliz = formatPercent(row.rfrUtilizRaw);
                    row.actVsBkgUtilz = formatPercent(row.actVsBkgUtilzRaw);
                    row.actVsMaxLdn = formatPercent(row.actVsMaxLdnRaw);

                    const parsedMax = parseFloat(row.maxLdn);
                    row.maxLdn = (parsedMax === 0 || isNaN(parsedMax)) ? '' : formatNumberWithCommas(row.maxLdn);

                    row.curUtil = `${Math.round(row.curUtilRaw || 0)}%`;

                    if (row.maxLdn !== '' && row.curLaden !== undefined) {
                        const rawMaxLdn = parseFloat(String(row.maxLdn).replace(/,/g, ''));
                        const calculatedShortfall = row.curLaden - rawMaxLdn;
                        row.shortfall = formatAccountingNumber(calculatedShortfall);
                    } else {
                        row.shortfall = formatAccountingNumber(row.shortfall);
                    }
                    
                    row.curLaden = formatNumberWithCommas(row.curLaden);
                    row.quote = formatNumberWithCommas(row.quote);
                    row.bsaTeu = formatNumberWithCommas(row.bsaTeu);
                    row.bsaWgt = formatNumberWithCommas(row.bsaWgt);
                    
                    if (String(row.vvd).trim().toUpperCase() === 'VMS') {
                        const fieldsToKeep = ['id', 'trade', 'subTrade', 'lane', 'saleWeek', 'pic', 'vvd'];
                        Object.keys(row).forEach(key => {
                            if (!fieldsToKeep.includes(key)) {
                                row[key] = '';
                            }
                        });
                    }

                    return row;
                });
            }, [filteredRawRows]);

            const processedData = useMemo(() => {
                let filtered = [...tableData]; // Already filtered!
                
                filtered.sort((a, b) => {
                    if (a.trade !== b.trade) return String(a.trade || '').localeCompare(String(b.trade || ''));
                    if (a.subTrade !== b.subTrade) return String(a.subTrade || '').localeCompare(String(b.subTrade || ''));
                    if (a.lane !== b.lane) return String(a.lane || '').localeCompare(String(b.lane || ''));
                    if (a.saleWeek !== b.saleWeek) return String(a.saleWeek || '').localeCompare(String(b.saleWeek || ''));
                    return String(a.vessel || '').localeCompare(String(b.vessel || ''));
                });

                const withBlanks = [];
                for (let i = 0; i < filtered.length; i++) {
                    withBlanks.push(filtered[i]);
                    const isLastInLane = i === filtered.length - 1 || filtered[i].lane !== filtered[i+1].lane;
                    if (isLastInLane) {
                        withBlanks.push({
                            id: `blank-${filtered[i].id || i}`,
                            isBlankRow: true,
                            trade: filtered[i].trade,
                            subTrade: filtered[i].subTrade,
                            lane: filtered[i].lane
                        });
                    }
                }

                const spanned = withBlanks.map(row => ({
                    ...row,
                    showTrade: true, tradeSpan: 1,
                    showSub: true, subSpan: 1,
                    showLane: true, laneSpan: 1
                }));

                for (let i = 0; i < spanned.length; i++) {
                    if (spanned[i].showTrade) {
                        let spanCount = 1;
                        for (let j = i + 1; j < spanned.length; j++) {
                            if (spanned[j].trade === spanned[i].trade) {
                                spanCount++;
                                spanned[j].showTrade = false;
                            } else break;
                        }
                        spanned[i].tradeSpan = spanCount;
                    }

                    if (spanned[i].showSub) {
                        let spanCount = 1;
                        for (let j = i + 1; j < spanned.length; j++) {
                            if (spanned[j].trade === spanned[i].trade && spanned[j].subTrade === spanned[i].subTrade) {
                                spanCount++;
                                spanned[j].showSub = false;
                            } else break;
                        }
                        spanned[i].subSpan = spanCount;
                    }

                    if (spanned[i].showLane) {
                        let spanCount = 1;
                        for (let j = i + 1; j < spanned.length; j++) {
                            if (spanned[j].trade === spanned[i].trade &&
                                spanned[j].subTrade === spanned[i].subTrade &&
                                spanned[j].lane === spanned[i].lane) {
                                spanCount++;
                                spanned[j].showLane = false;
                            } else break;
                        }
                        spanned[i].laneSpan = spanCount;
                    }
                }
                return spanned;
            }, [tableData]);"""
    content = content[:start_idx] + new_block + content[end_idx:]

with open('booking_flash_report_na_Kevin_1.04_PIVOTS.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Second refactor applied.")

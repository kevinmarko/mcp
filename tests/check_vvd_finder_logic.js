#!/usr/bin/env node
/**
 * Headless check of the pure half of Settings > "Find a vessel" (D63, 2026-10-21): the functions between the marker lines
 *     // >>> BEGIN VVD FINDER     and     // <<< END VVD FINDER
 * in the app file. An analyst types a VVD; the finder says which place holds it: the rows this report loaded, the live Sheet
 * downloaded fresh, the Max Laden columns, the sector Sheet, the slicers. The component that downloads and draws is covered end to
 * end by the Vvd_Finder suite in tests/booking_flash_regression_tests.js; this script covers what is too fiddly to boot an app for:
 * the matching rules, the Max Laden verdicts on every voyage of the real fixture, the headline matrix and the hidden-by list.
 *
 * HOW. The block is a pure function of the rows it is handed. This script cuts that text out of the app file, evaluates it (with
 * readSectorSheet, which the sector line is checked against), and feeds it rows read by the real xlsx package from the committed
 * fixtures the way the app reads them: XLSX.read(text, {type:'string', raw:true}) then sheet_to_json({raw:false, defval:''}). Nothing is
 * copied: change the block in the app and this runs the new code. The expected numbers (374 real voyages, 8 with no Max Laden, 3 of those on
 * EXE / EXW, ...) were counted with an independent Python pass over the CSV, not read back from this code.
 *
 *   node tests/check_vvd_finder_logic.js                 the main app file (resolved like every other check)
 *   node tests/check_vvd_finder_logic.js <app file>      that file
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

const REPO_ROOT = path.dirname(__dirname);
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures');
const LIVE = path.join(FIXTURES, 'live_csv_2026-08-12.csv');
const SECTOR_ONE_BLOCK = path.join(FIXTURES, 'sector_data_2026-09-16.csv');
const SECTOR_TWO_BLOCK = path.join(FIXTURES, 'sector_data_two_header_2026-10-09.csv');
const HISTORY = path.join(FIXTURES, 'historical_data_2026-08-24_to_2026-08-26.csv');

function resolveAppHtml(arg) {
    if (arg) return path.resolve(arg);
    try {
        const resolved = findCurrentAppHtml();
        console.log(`(auto-detected current app version: ${path.basename(resolved)})`);
        return resolved;
    } catch (err) {
        console.error(`${err.message} (in ${REPO_ROOT}); pass the app path explicitly as an argument.`);
        process.exit(1);
    }
}
const appPath = resolveAppHtml(process.argv[2]);
console.log(`Checking: ${appPath}\n`);

let failures = 0, checks = 0;
const check = (name, ok, detail) => {
    checks++;
    if (ok) { console.log(`  ✅ ${name}`); return; }
    failures++;
    console.log(`  ❌ ${name}`);
    if (detail !== undefined) console.log(`     ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- cut the blocks out of the app file and evaluate them ----
const html = fs.readFileSync(appPath, 'utf8');
const cut = (label) => {
    const open = `// >>> BEGIN ${label}\n`, close = `// <<< END ${label}`;
    const n = (html.split(open).length - 1), m = (html.split(close).length - 1);
    if (n !== 1 || m !== 1) return { error: { begin: n, end: m } };
    return { body: html.slice(html.indexOf(open) + open.length, html.indexOf(close)) };
};
const finderCut = cut('VVD FINDER'), sectorCut = cut('SECTOR SHEET READER');
check('the app file has exactly one VVD FINDER block and one SECTOR SHEET READER block, each between its BEGIN and END marker lines', !finderCut.error && !sectorCut.error, { finder: finderCut.error, sector: sectorCut.error });
if (finderCut.error || sectorCut.error) { console.log('\n❌ FAIL -- cannot find the blocks'); process.exit(1); }
const NAMES = ['vvdFindKey', 'vvdHeaderKey', 'vvdFindNum', 'vvdFindQuery', 'vvdFindIndexes', 'vvdFindNear', 'vvdRawCell', 'vvdReadFirst', 'vvdLegs', 'vvdDistinct', 'vvdMaxLadenState',
    'vvdSheetNewer', 'vvdVerdictCode', 'vvdVerdictText', 'vvdSectorLines', 'vvdHiddenBy', 'vvdCsvRecords', 'vvdFirstCell', 'vvdHistoryScan', 'vvdHistorySummary', 'vvdWithTimeout'];
const CONSTS = ['VVD_MAX_LADEN_HEADERS', 'VVD_POL_MAX_HEADERS'];
let F, readSectorSheet;
try { F = new Function(`${finderCut.body}\nreturn { ${NAMES.concat(CONSTS).join(', ')} };`)(); } catch (err) { console.log(`  ❌ the VVD FINDER block does not evaluate on its own: ${err.message}`); process.exit(1); }
try { readSectorSheet = new Function(`${sectorCut.body}\nreturn readSectorSheet;`)(); } catch (err) { console.log(`  ❌ the sector reader does not evaluate: ${err.message}`); process.exit(1); }
check('the block evaluates on its own (it depends on nothing outside the marked lines) and exports all 21 functions and both header lists', NAMES.every(n => typeof F[n] === 'function') && CONSTS.every(n => Array.isArray(F[n])) && typeof readSectorSheet === 'function', NAMES.filter(n => typeof F[n] !== 'function'));

// ---- the real live export, mapped the way the app maps the few fields the finder reads ----
const sheetRows = (file) => {
    const wb = XLSX.read(fs.readFileSync(file, 'utf8'), { type: 'string', raw: true });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
};
const raws = sheetRows(LIVE);
// What the app maps for a row: the first NON-BLANK cell of the field's aliases (getVal's fall-through), written out here from the alias lists in
// FIELD_ALIASES rather than taken from the block under test, so a mistake in the block cannot hide in both places.
const firstNonBlank = (r, headers) => { for (const h of headers) { if (r[h] !== undefined && r[h] !== '') return r[h]; } return ''; };
const mapped = raws.map(r => ({
    vvd: r['Vessel 1st VVD'], vessel: r['Vessel Vessel Name'], lane: r['Vessel 1st Lane'], subTrade: r['Vessel 1st Sub Trade'], saleWeek: r['Route Date 1st Sale Week'],
    pic: r['MCT PIC'], etd: r['Route Date Last Port ETD Date'], pol: r['Route Location 1st Yard'],
    maxLdn: firstNonBlank(r, ['MCT Max Laden Update', 'MCT Max Laden', 'Max LDN', 'MaxLdn']), polMaxLdn: firstNonBlank(r, ['POL Max Laden TEU', 'POL Max Laden']),
    curLaden: r['Measures POL Laden TEU'],
}));
const ADHOC = new Set(['EXE', 'EXW']);
const legsOf = (vvd) => { const idx = F.vvdFindIndexes(mapped, vvd); return F.vvdLegs(idx.map(i => mapped[i]), idx.map(i => raws[i])); };

console.log('--- keys and the question typed ---');
{
    check('vvdFindKey trims, upper-cases and removes every space: " srot 0045s " is SROT0045S; null and undefined are empty', F.vvdFindKey(' srot 0045s ') === 'SROT0045S' && F.vvdFindKey(null) === '' && F.vvdFindKey(undefined) === '');
    check('an empty box and a box of spaces are "empty"; VMS in any case or spacing is "vms" (the placeholder, not a voyage); a real VVD has no problem',
        F.vvdFindQuery('').problem === 'empty' && F.vvdFindQuery('   ').problem === 'empty' && F.vvdFindQuery(' v ms').problem === 'vms' && F.vvdFindQuery('VMS').problem === 'vms'
        && same(F.vvdFindQuery(' srot0045s '), { q: 'SROT0045S', problem: null }), [F.vvdFindQuery(''), F.vvdFindQuery(' v ms'), F.vvdFindQuery(' srot0045s ')]);
    check('why VMS is refused: the fixture has 65 VMS rows spread over many lanes, so a search for it would list unrelated rows', F.vvdFindIndexes(mapped, 'VMS').length === 65 && new Set(F.vvdFindIndexes(mapped, 'VMS').map(i => mapped[i].lane)).size > 5,
        { rows: F.vvdFindIndexes(mapped, 'VMS').length });
    check('vvdFindNum reads commas, % and parentheses, and treats blank, text and null as 0', F.vvdFindNum('1,234') === 1234 && F.vvdFindNum('12%') === 12 && F.vvdFindNum('') === 0 && F.vvdFindNum('n/a') === 0 && F.vvdFindNum(null) === 0);
}

console.log('--- matching on the real fixture (964 rows, 374 real voyages) ---');
{
    check('SROT0045S is exactly 2 port rows (USHOU01 and USMIA01), found by its key whatever the case or spacing in the rows', same(F.vvdFindIndexes(mapped, 'SROT0045S').map(i => mapped[i].pol), ['USHOU01', 'USMIA01']));
    const spaced = mapped.map(r => (r.vvd === 'SROT0045S' ? { ...r, vvd: ' srot0045s ' } : r));
    check('the rows are keyed the same way as the box: rows holding " srot0045s " are still found by SROT0045S', F.vvdFindIndexes(spaced, 'SROT0045S').length === 2);
    check('a VVD that is not there finds nothing (control: the search is not matching everything)', F.vvdFindIndexes(mapped, 'ZZZZ9999Z').length === 0 && F.vvdFindIndexes(mapped, 'SROT0045').length === 0);
    check('only whole-key matches count: SROT0045 (no direction letter) is NOT a match for SROT0045S', F.vvdFindIndexes(mapped, 'SROT0045').length === 0);
    const near = F.vvdFindNear([mapped], 'SROT0045');
    check('near: SROT0045 offers SROT0045S, with its vessel (SPYROS V) and lane (AN2)', near.length === 1 && near[0].vvd === 'SROT0045S' && near[0].vessel === 'SPYROS V' && near[0].lane === 'AN2', near);
    check('near: a vessel name finds its voyages (SPYROS: SROT0044S and SROT0045S), closest first and alphabetical', same(F.vvdFindNear([mapped], 'SPYROS').map(n => n.vvd), ['SROT0044S', 'SROT0045S']), F.vvdFindNear([mapped], 'SPYROS'));
    check('near: a pasted "SROT0045S W30" (the VVD plus text) still offers SROT0045S; the exact VVD is never offered to itself', same(F.vvdFindNear([mapped], 'SROT0045SW30').map(n => n.vvd), ['SROT0045S']) && !F.vvdFindNear([mapped], 'SROT0045S').some(n => n.vvd === 'SROT0045S'));
    check('near: under 3 characters offers nothing (it would match half the feed); VMS is never offered', same(F.vvdFindNear([mapped], 'SR'), []) && !F.vvdFindNear([mapped], 'VMS'.slice(0, 3)).some(n => n.vvd === 'VMS'));
    const many = [...new Set(mapped.map(r => F.vvdFindKey(r.vvd)).filter(v => v !== 'VMS' && v.includes('T00')))];
    check('near: T00 is inside many voyages (>5 in the fixture, so the cap is really exercised) and only 5 are offered, the first alphabetically', many.length > 5 && same(F.vvdFindNear([mapped], 'T00').map(n => n.vvd), many.sort().slice(0, 5)), { inFixture: many.length, offered: F.vvdFindNear([mapped], 'T00').map(n => n.vvd) });
    check('near: it reads every row set it is given (the report has none of them, the Sheet rows do: SPYROS is still found)', same(F.vvdFindNear([[], mapped], 'SPYROS').map(n => n.vvd), ['SROT0044S', 'SROT0045S']) && same(F.vvdFindNear([[], []], 'SPYROS'), []));
}

console.log('--- the three Max Laden columns, read by their real headers ---');
{
    const l = legsOf('SROT0045S');
    check('SROT0045S from the Sheet\'s own cells: Max Laden Update 140 and MCT Max Laden 140 on both rows; POL Max Laden 110 and 30; laden 113 and 17',
        same(l.map(x => [x.pol, x.maxUpdate, x.maxOld, x.polMax, x.laden]), [['USHOU01', 140, 140, 110, 113], ['USMIA01', 140, 140, 30, 17]]), l);
    const idx = F.vvdFindIndexes(mapped, 'SROT0045S'), fromMapped = F.vvdLegs(idx.map(i => mapped[i]), null);
    check('from the mapped rows alone (what this report holds): the same Update and POL figures, and MCT Max Laden is null = unknown, not 0', same(fromMapped.map(x => [x.maxUpdate, x.maxOld, x.polMax]), [[140, null, 110], [140, null, 30]]), fromMapped);
    // The landmine: "MCT Max Laden" is a substring of "MCT Max Laden Update". A fuzzy lookup would take the Update value for the older column.
    const trap = F.vvdLegs([{ vvd: 'X', pol: 'P' }], [{ 'MCT Max Laden Update': '', 'MCT Max Laden': '5', 'POL Max Laden TEU': '' }])[0];
    check('headers are compared for equality, not as substrings: with Update blank and the older column 5, Update reads 0 and the older column 5 (not the other way round)', trap.maxUpdate === 0 && trap.maxOld === 5, trap);
    const odd = F.vvdLegs([{ vvd: 'X', pol: 'P' }], [{ ' mct max-laden UPDATE ': '77', 'pol max laden teu': '9' }])[0];
    check('a header differing only in case, spacing or punctuation is still found', odd.maxUpdate === 77 && odd.polMax === 9, odd);
    const missing = F.vvdLegs([{ vvd: 'X', pol: 'P' }], [{ 'Something Else': '1' }])[0];
    check('a Sheet with none of the columns reads 0, 0, 0 and never throws', missing.maxUpdate === 0 && missing.maxOld === 0 && missing.polMax === 0, missing);
    const five = ['SBFT0076W', 'DDMT0366W', 'PNAT2638S', 'TQST0012W', 'LHTT2641S'];
    check('the older MCT Max Laden column really differs from Update on 5 voyages of the fixture (the reason all three are shown); on each the two figures are read apart',
        five.every(v => legsOf(v).some(x => x.maxOld !== x.maxUpdate)), five.map(v => legsOf(v).map(x => [x.maxUpdate, x.maxOld])));
}

console.log('--- Max Laden is read the way the report reads it (blank falls through, 0 does not) ---');
{
    const one = (raw) => F.vvdLegs([{ vvd: 'X', pol: 'P' }], [raw])[0];
    // Why this section exists (review finding, 2026-10-21): the report's maxLdn is the first NON-BLANK of four aliases and polMaxLdn the first of two. A Sheet
    // with "MCT Max Laden Update" blank and the older "MCT Max Laden" filled shows capacity on screen; reading only the Update cell called that "blank" and
    // raised a "figures differ" alarm that no Refresh could clear. The real fixture has no such row (Python: 0 rows), so these are hand-made.
    const fallRaw = { 'MCT Max Laden Update': '', 'MCT Max Laden': '3000', 'POL Max Laden TEU': '', 'POL Max Laden': '800' };
    const fall = one(fallRaw);
    check('Update blank and the older column 3000: the report reads 3000 (maxRead), while the Update cell alone is still 0 and the older column 3000; POL Max Laden TEU blank falls through to POL Max Laden 800',
        fall.maxRead === 3000 && fall.maxUpdate === 0 && fall.maxOld === 3000 && fall.polMax === 800, fall);
    check('a 0 is a figure and stops the fall-through (getVal only skips blanks): Update "0" with the older column 5 reads 0, and POL Max Laden TEU "0" with POL Max Laden 9 reads 0',
        one({ 'MCT Max Laden Update': '0', 'MCT Max Laden': '5' }).maxRead === 0 && one({ 'POL Max Laden TEU': '0', 'POL Max Laden': '9' }).polMax === 0);
    check('the later aliases are read in order: "Max LDN" when the first two are blank, then "MaxLdn"; the first non-blank wins even when a later one is larger',
        one({ 'MCT Max Laden Update': '', 'MCT Max Laden': '', 'Max LDN': '42', MaxLdn: '99' }).maxRead === 42 && one({ 'MCT Max Laden Update': '', 'MCT Max Laden': '', MaxLdn: '99' }).maxRead === 99
        && one({ 'MCT Max Laden Update': '10', 'MCT Max Laden': '500' }).maxRead === 10);
    check('headers are still matched whole, never as a substring: a column called "MCT Max Laden Update Old" is not the Update column, so a Sheet with only that reads 0',
        one({ 'MCT Max Laden Update Old': '99', 'Something MCT Max Laden': '88' }).maxRead === 0);
    check('a column that is not there reads 0 and never throws, for both fields', (() => { const l = one({}); return l.maxRead === 0 && l.polMax === 0; })());
    const trapLeg = F.vvdLegs([{ vvd: 'X', pol: 'P' }], [{ 'MCT Max Laden Update': '', 'MCT Max Laden': '5', 'POL Max Laden TEU': '' }])[0];
    check('the substring landmine is unchanged: with Update blank and the older column 5, the Update cell reads 0 and the older column 5 (the figure the report reads is 5 because of the fall-through, not because of a fuzzy match)',
        trapLeg.maxUpdate === 0 && trapLeg.maxOld === 5 && trapLeg.maxRead === 5, trapLeg);
    const loadedLeg = F.vvdLegs([{ pol: 'P', maxLdn: '3000', polMaxLdn: '800' }], null);
    const sheetLeg = F.vvdLegs([{ vvd: 'X', pol: 'P' }], [fallRaw]);
    check('the reviewer\'s scenario: the report holds 3000 (mapped) and the Sheet has Update blank with the older column 3000: the two agree, so the Sheet is NOT newer (the alarm could never clear before)',
        same(F.vvdSheetNewer(loadedLeg, sheetLeg), { newer: false, reasons: [] }), [loadedLeg, sheetLeg]);
    check('and the voyage is "filled", not "blank": the tables show capacity for it', F.vvdMaxLadenState(sheetLeg, ADHOC).state === 'filled', F.vvdMaxLadenState(sheetLeg, ADHOC));
    // Drift guard: these lists are copies of FIELD_ALIASES in the app. If someone adds an alias there, the finder would silently stop agreeing with the report.
    const aliasList = (field) => { const m = html.match(new RegExp(`\\b${field}: \\[((?:'[^']*',? ?)+)\\]`, 'g')); return m && m.length === 1 ? m[0].replace(/^[^[]*\[|\]$/g, '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : { matches: m && m.length }; };
    check('drift guard: the finder\'s header lists are exactly FIELD_ALIASES.maxLdn and FIELD_ALIASES.polMaxLdn in the app, in the same order',
        same(aliasList('maxLdn'), F.VVD_MAX_LADEN_HEADERS) && same(aliasList('polMaxLdn'), F.VVD_POL_MAX_HEADERS), { maxLdn: aliasList('maxLdn'), polMaxLdn: aliasList('polMaxLdn') });
}

console.log('--- the Max Laden verdict on every real voyage of the fixture ---');
{
    const voyages = [...new Set(mapped.map(r => F.vvdFindKey(r.vvd)).filter(v => v && v !== 'VMS'))];
    const verdicts = {}; voyages.forEach(v => { verdicts[v] = F.vvdMaxLadenState(legsOf(v), ADHOC); });
    const by = (s) => voyages.filter(v => verdicts[v].state === s);
    check('374 real voyages: 360 filled, 6 partial, 8 blank (counted separately in Python from the CSV)', voyages.length === 374 && by('filled').length === 360 && by('partial').length === 6 && by('blank').length === 8, { voyages: voyages.length, filled: by('filled').length, partial: by('partial').length, blank: by('blank').length });
    check('the 8 blank ones are exactly R2JT0018W, YUNT0080W, GJMT0003W, ZYXT0176W, OOHT0078W, AEIT0634W, HBDT0021W, SCNT1010W', same(by('blank').sort(), ['AEIT0634W', 'GJMT0003W', 'HBDT0021W', 'OOHT0078W', 'R2JT0018W', 'SCNT1010W', 'YUNT0080W', 'ZYXT0176W']), by('blank'));
    check('only 3 of those 8 are on the ad-hoc lanes where it is normal (R2JT0018W on EXW, GJMT0003W and ZYXT0176W on EXE); the other 5 are real services with no Max Laden',
        same(by('blank').filter(v => verdicts[v].adhoc).sort(), ['GJMT0003W', 'R2JT0018W', 'ZYXT0176W']), by('blank').filter(v => verdicts[v].adhoc));
    check('without the ad-hoc list none of the 8 is excused (control: the exemption comes from the list, not from the data)', by('blank').every(v => F.vvdMaxLadenState(legsOf(v), null).adhoc === false && F.vvdMaxLadenState(legsOf(v), new Set()).adhoc === false));
    const o = verdicts.OSUT0120E, c = verdicts.CGIT0023S;
    check('OSUT0120E (5 port rows, POL Max Laden 0 on CAHAL02) is partial: Max Laden missing on 0 of 5, POL missing on 1; CGIT0023S (1 row, POL 0) is partial 0 of 1 / 1', o.state === 'partial' && o.total === 5 && o.maxMissing === 0 && o.polMissing === 1 && c.state === 'partial' && c.total === 1 && c.polMissing === 1, { o, c });
    check('SROT0045S is filled on both rows', same(verdicts.SROT0045S, { state: 'filled', total: 2, maxMissing: 0, polMissing: 0, adhoc: false }), verdicts.SROT0045S);
    check('no rows is "none" (a VVD that is not there has nothing to check)', F.vvdMaxLadenState([], ADHOC).state === 'none');
    const mix = F.vvdLegs([{ pol: 'A', maxLdn: '100', polMaxLdn: '50' }, { pol: 'B', maxLdn: '0', polMaxLdn: '50' }], null);
    check('a hand-made voyage with Max Laden on one row and 0 on the other is partial (1 of 2 missing), not blank', F.vvdMaxLadenState(mix, ADHOC).state === 'partial' && F.vvdMaxLadenState(mix, ADHOC).maxMissing === 1);
}

console.log('--- is the Sheet ahead of this report? ---');
{
    const a = F.vvdLegs([{ pol: 'USHOU01', maxLdn: '140', polMaxLdn: '110', curLaden: '10' }, { pol: 'USMIA01', maxLdn: '140', polMaxLdn: '30', curLaden: '10' }], null);
    const same2 = F.vvdLegs([{ pol: 'USMIA01', maxLdn: '140', polMaxLdn: '30', curLaden: '99' }, { pol: 'USHOU01', maxLdn: '140', polMaxLdn: '110', curLaden: '77' }], null);
    check('the same port rows in another order with different laden are NOT newer (laden moves with every booking and is deliberately not compared)', same(F.vvdSheetNewer(a, same2), { newer: false, reasons: [] }));
    const more = a.concat(F.vvdLegs([{ pol: 'USSAV01', maxLdn: '140', polMaxLdn: '20' }], null));
    check('a port row the Sheet has and the report does not is newer, reason "legs"', same(F.vvdSheetNewer(a, more), { newer: true, reasons: ['legs'] }) && same(F.vvdSheetNewer(more, a), { newer: true, reasons: ['legs'] }));
    const filled = F.vvdLegs([{ pol: 'USHOU01', maxLdn: '0', polMaxLdn: '110' }, { pol: 'USMIA01', maxLdn: '140', polMaxLdn: '30' }], null);
    check('the same port rows with a Max Laden the Sheet has since filled in are newer, reason "maxladen"', same(F.vvdSheetNewer(filled, a), { newer: true, reasons: ['maxladen'] }));
    const swapped = F.vvdLegs([{ pol: 'USHOU01', maxLdn: '140', polMaxLdn: '110' }, { pol: 'USSAV01', maxLdn: '140', polMaxLdn: '30' }], null);
    check('two port rows against two, but a different port (USSAV01 for USMIA01): reason "ports", not "maxladen" (the Max Laden figures did not change)', same(F.vvdSheetNewer(a, swapped), { newer: true, reasons: ['ports'] }), F.vvdSheetNewer(a, swapped));
    check('one of each: a different number of rows is "legs" even when the ports also differ (one reason, the plainest)', same(F.vvdSheetNewer(a, swapped.slice(0, 1)), { newer: true, reasons: ['legs'] }));
}

console.log('--- the headline: seven outcomes, each with its words ---');
{
    const ctx = { vvd: 'SROT0045S', sheetError: 'network error', loadedLabel: 'the live feed', loadedIsLive: true, reasons: ['legs', 'maxladen'], loadedLegs: 2, sheetLegs: 3 };
    const matrix = [[2, 2, null, false, 'in-both'], [2, 3, null, true, 'sheet-newer'], [0, 3, null, false, 'sheet-only'], [2, 0, null, false, 'report-only'], [0, 0, null, false, 'neither'],
        [2, 0, 'network error', false, 'sheet-unreachable-loaded'], [0, 0, 'network error', false, 'sheet-unreachable-none'], [2, 5, 'network error', true, 'sheet-unreachable-loaded']];
    matrix.forEach(([l, s, err, newer, want]) => check(`loaded ${l}, Sheet ${s}${err ? ', Sheet unreachable' : ''}${newer ? ', newer' : ''} -> ${want}`, F.vvdVerdictCode(l, s, err, newer) === want, F.vvdVerdictCode(l, s, err, newer)));
    const text = (code, over) => F.vvdVerdictText(code, { ...ctx, ...over });
    check('every sentence names the VVD', ['in-both', 'sheet-newer', 'sheet-only', 'report-only', 'neither', 'sheet-unreachable-loaded', 'sheet-unreachable-none'].every(c => text(c).startsWith('SROT0045S') || text(c).includes('SROT0045S')));
    check('in the Sheet but not in the report, on live data: the cure is Refresh Now', /not in this report yet\. Refresh Now brings it in\./.test(text('sheet-only')), text('sheet-only'));
    check('the same, while viewing a historical day: no Refresh Now advice (it would be wrong); it says what you are looking at instead', !/Refresh Now/.test(text('sheet-only', { loadedIsLive: false, loadedLabel: 'the historical day 2026-08-25' })) && /historical day 2026-08-25, not the live data/.test(text('sheet-only', { loadedIsLive: false, loadedLabel: 'the historical day 2026-08-25' })));
    check('in neither: says the feed has not published it and that nothing in the report is wrong', /neither the live Sheet nor this report\. The feed has not published it, so nothing in the report is wrong/.test(text('neither')), text('neither'));
    check('newer values: says what differs (3 against 2 port rows, and the Max Laden figures)', /report has 2 port rows, the Sheet has 3; the Max Laden figures differ/.test(text('sheet-newer')), text('sheet-newer'));
    check('removed upstream, and an unreachable Sheet (with the reason), each say so', /no longer in the live Sheet/.test(text('report-only')) && /could not be reached \(network error\)/.test(text('sheet-unreachable-loaded')) && /could not be reached \(network error\), and SROT0045S is not in this report/.test(text('sheet-unreachable-none')));
    // Review findings F1 and F5 (2026-10-21).
    const day = { loadedIsLive: false, loadedLabel: 'the historical day 2026-08-25' };
    check('in the report but not in the Sheet, while viewing a historical day or a file: it does NOT say "removed upstream" (false there); it says that is expected and names what is loaded',
        !/removed upstream/.test(text('report-only', day)) && /in the historical day 2026-08-25 but not in the live Sheet now\. That is expected/.test(text('report-only', day)), text('report-only', day));
    check('on live data the removed-upstream sentence is unchanged', /was removed upstream after this report last loaded/.test(text('report-only', { loadedIsLive: true })));
    const shared = { viaSharedCopy: true };
    check('inside Apps Script (viaSharedCopy) Refresh Now is NOT promised: it brings the VVD in once the shared copy has caught up (every 30 to 60 minutes), so it may not show yet; on sheet-only and sheet-newer both',
        ['sheet-only', 'sheet-newer'].every(c => /Refresh Now brings it in once the shared copy has caught up \(it refreshes every 30 to 60 minutes\), so it may not show yet\./.test(text(c, shared))), text('sheet-only', shared));
    check('outside Apps Script the plain "Refresh Now brings it in." is kept, and a historical day still gets no Refresh Now advice at all, shared copy or not',
        /Refresh Now brings it in\.$/.test(text('sheet-only', { viaSharedCopy: false })) && !/Refresh Now/.test(text('sheet-only', { ...shared, ...day })) && !/Refresh Now/.test(text('sheet-newer', { ...shared, ...day })));
    check('newer values by port: "the ports of call differ" is said for reason "ports"', /the ports of call differ/.test(text('sheet-newer', { reasons: ['ports'] })) && !/Max Laden figures differ/.test(text('sheet-newer', { reasons: ['ports'] })), text('sheet-newer', { reasons: ['ports'] }));
}

console.log('--- the sector Sheet has no VVD column: lines for the voyage\'s lane ---');
{
    const gridOf = (file) => { const wb = XLSX.read(fs.readFileSync(file, 'utf8'), { type: 'string', raw: true }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }); };
    const one = readSectorSheet(gridOf(SECTOR_ONE_BLOCK)), two = readSectorSheet(gridOf(SECTOR_TWO_BLOCK));
    check('both real Sheets are read (42 and 41 lines) before they are searched', one.problem === null && two.problem === null && one.rows.length === 42 && two.rows.length === 41, { one: one.rows.length, two: two.rows.length });
    check('AL5 (Sub Trade TA) has 5 lines in the 2026-09-16 Sheet and 4 in the 2026-10-09 Sheet; asking without a Sub Trade gives the same', F.vvdSectorLines(one.rows, 'TA', 'AL5') === 5 && F.vvdSectorLines(two.rows, 'TA', 'AL5') === 4 && F.vvdSectorLines(one.rows, '', 'AL5') === 5, [F.vvdSectorLines(one.rows, 'TA', 'AL5'), F.vvdSectorLines(two.rows, 'TA', 'AL5')]);
    check('AN2 (SROT0045S\'s lane) has NO line in either Sheet: 0, not null (the Sheet covers allocation lanes only)', F.vvdSectorLines(one.rows, 'LN', 'AN2') === 0 && F.vvdSectorLines(two.rows, 'LN', 'AN2') === 0);
    check('case and spaces do not matter, a wrong Sub Trade finds nothing, and a voyage with no lane is null (there is nothing to look up)', F.vvdSectorLines(one.rows, ' ta ', ' al5 ') === 5 && F.vvdSectorLines(one.rows, 'LN', 'AL5') === 0 && F.vvdSectorLines(one.rows, 'TA', '') === null && F.vvdSectorLines(one.rows, 'TA', null) === null);
}

console.log('--- which filter hides it ---');
{
    const rows = [{ lane: 'AN2', saleWeek: '2026/W39', subTrade: 'LN' }, { lane: 'AN2', saleWeek: '2026/W39', subTrade: 'LN' }];
    const T = (name, pass) => ({ name, pass });
    const lane = T('Lane slicer', r => r.lane === 'AT1'), week = T('Sale Week slicer', r => r.saleWeek === '2026/W30'), sub = T('Sub Trade slicer', r => r.subTrade === 'LN');
    check('nothing failing: nothing named', same(F.vvdHiddenBy(rows, [sub]), []) && same(F.vvdHiddenBy(rows, []), []));
    check('one slicer hides every row: it alone is named, with how many rows it hides', same(F.vvdHiddenBy(rows, [sub, lane]), [{ name: 'Lane slicer', rows: 2 }]), F.vvdHiddenBy(rows, [sub, lane]));
    check('two slicers hide every row: both are named, in the order given', same(F.vvdHiddenBy(rows, [lane, sub, week]).map(x => x.name), ['Lane slicer', 'Sale Week slicer']));
    const three = [{ lane: 'AN2', saleWeek: '2026/W39' }, { lane: 'AN2', saleWeek: '2026/W39' }, { lane: 'AN2', saleWeek: '2026/W30' }];
    check('one slicer hides all 3 rows and another hides only 1: only the one that hides them all is named (the cause), not the one that hides a single row', same(F.vvdHiddenBy(three, [lane, week]), [{ name: 'Lane slicer', rows: 3 }]), F.vvdHiddenBy(three, [lane, week]));
    const split = [{ lane: 'AT1', saleWeek: '2026/W39' }, { lane: 'AN2', saleWeek: '2026/W30' }];
    check('each row hidden by a different slicer: none hides them all, so every slicer that hides any row is named with its own count (1 and 1)', same(F.vvdHiddenBy(split, [lane, week]), [{ name: 'Lane slicer', rows: 1 }, { name: 'Sale Week slicer', rows: 1 }]), F.vvdHiddenBy(split, [lane, week]));
}

console.log('--- the Historical archive: records, the prefilter, the summary line ---');
{
    const R = F.vvdCsvRecords;
    check('records split at line breaks outside quotes only: a quoted cell holding a line break stays in its record; CRLF, a missing final newline and blank lines are handled',
        same(R('a,b\nc,"x\ny"\nd,e'), ['a,b', 'c,"x\ny"', 'd,e']) && same(R('a,b\r\nc,d\r\n'), ['a,b', 'c,d']) && same(R('\n\na\n\n'), ['a']) && same(R(''), []) && same(R('a,"he said ""hi""\nthere"\nb'), ['a,"he said ""hi""\nthere"', 'b']), R('a,b\nc,"x\ny"\nd,e'));
    check('first cell: up to the first comma, quotes and spaces trimmed; a record with no comma is its own first cell', F.vvdFirstCell('2026-08-24,x,y') === '2026-08-24' && F.vvdFirstCell('"2026-08-24" ,x') === '2026-08-24' && F.vvdFirstCell('solo') === 'solo');
    const text = fs.readFileSync(HISTORY, 'utf8');
    const all = sheetRows(HISTORY);
    check('the real archive fixture reads as 16 records (Python: 16 rows in 3 days, 7 / 5 / 4) behind a header, and the scan finds the three days, dated, in order of appearance',
        F.vvdCsvRecords(text).length === 17 && same(F.vvdHistoryScan(text, 'ZZZ').dates, ['2026-08-24', '2026-08-25', '2026-08-26']) && F.vvdHistoryScan(text, 'ZZZ').dated === true && all.length === 16, { records: F.vvdCsvRecords(text).length, rows: all.length });
    const scanOf = (q) => F.vvdHistoryScan(text, q);
    check('BYBT0216W (one row, 2026-08-24) is one hit; OEHT0100W (2026-08-24 and 2026-08-25) is two; a VVD that is nowhere is none; the header is kept for the parse that follows', scanOf('BYBT0216W').hits.length === 1 && scanOf('OEHT0100W').hits.length === 2 && scanOf('ZZZZ9999Z').hits.length === 0 && /^Record Date,/.test(scanOf('BYBT0216W').header));
    check('TTLT0028W, whose remark is a quoted cell with line breaks, is found as one record per day (24th and 25th), each starting at its Record Date and none cut in two',
        scanOf('TTLT0028W').hits.length === 2 && scanOf('TTLT0028W').hits.every(h => /^2026-08-2[45],/.test(h)) && scanOf('TTLT0028W').hits.some(h => h.indexOf('\n') >= 0), scanOf('TTLT0028W').hits.map(h => h.slice(0, 40)));
    check('the prefilter ignores case and spaces, so a VVD typed or stored with a space still reaches the parse', F.vvdHistoryScan('Record Date,VVD\n2026-08-24,srot 0045s\n2026-08-24,OTHER', 'SROT0045S').hits.length === 1);
    check('a per-day file has no Record Date column: not dated, no dates, hits still found', (() => { const t = 'Vessel 1st VVD,x\nSROT0045S,1\nOTHER,2'; const sc = F.vvdHistoryScan(t, 'SROT0045S'); return sc.dated === false && sc.dates.length === 0 && sc.hits.length === 1; })());
    check('an empty text is an empty scan, never a throw', same(F.vvdHistoryScan('', 'X'), { header: '', hits: [], dates: [], dated: false }) && same(F.vvdHistoryScan(null, 'X'), { header: '', hits: [], dates: [], dated: false }));
    // The reason for the prefilter: the real archive is about 16 MB. A synthetic one of that size, 27,000 records of about 600 bytes, must scan in well under a second
    // or the "no freeze" claim is false (the full parse of it takes about 14 s). The budget is generous (5 s) for a loaded CI machine.
    const line = 'x'.repeat(560);
    const big = ['Record Date,Vessel 1st VVD,pad'].concat(Array.from({ length: 27000 }, (_, i) => `2026-08-${String(10 + (i % 20)).padStart(2, '0')},V${i}T000${i % 10}W,${line}`)).concat(['2026-08-30,NEEDLE0001S,' + line]).join('\n');
    const t0 = Date.now(), bigScan = F.vvdHistoryScan(big, 'NEEDLE0001S'), ms = Date.now() - t0;
    check(`a synthetic ${Math.round(big.length / 1e6)} MB archive of 27,001 records is scanned in ${ms} ms (limit 5,000): one hit, 21 days found`, ms < 5000 && bigScan.hits.length === 1 && bigScan.dates.length === 21 && big.length > 15e6, { ms, bytes: big.length, hits: bigScan.hits.length, dates: bigScan.dates.length });
    const D = (date, legs, maxFilled) => ({ date, legs, maxFilled });
    const S = F.vvdHistorySummary;
    check('there and still there: "in 2 of 3 archived days, 2026-08-24 to 2026-08-25" is ok, with how many of those days Max Laden was filled', same(S([D('2026-08-26', 0, false), D('2026-08-25', 2, true), D('2026-08-24', 1, false)], true), { status: 'ok', text: 'in 2 of 3 archived days, 2026-08-24 to 2026-08-25. Max Laden was filled on 1 of 2 of those days.' }), S([D('2026-08-26', 0, false), D('2026-08-25', 2, true), D('2026-08-24', 1, false)], true));
    check('dropped out: there on the archive\'s latest day, missing now = a warning that says it dropped out after that day', (() => { const r = S([D('2026-08-26', 1, true), D('2026-08-25', 1, true)], false); return r.status === 'warn' && /still there on the archive's latest day \(2026-08-26\) and is missing now: it dropped out after that/.test(r.text); })());
    check('missing since: last there on 2026-08-24, the archive runs to 2026-08-26 = a warning with the last day seen', (() => { const r = S([D('2026-08-26', 0, false), D('2026-08-25', 0, false), D('2026-08-24', 1, true)], false); return r.status === 'warn' && /last there on 2026-08-24 and has been missing since/.test(r.text) && /^in 1 of 3 archived days, 2026-08-24\./.test(r.text) && /filled on 1 of 1 of that day/.test(r.text); })());
    check('gaps are said: there on the 24th and 26th but not the 25th reads "(with gaps)"; a run with no hole does not', /\(with gaps\)/.test(S([D('2026-08-26', 1, true), D('2026-08-25', 0, false), D('2026-08-24', 1, true)], true).text) && !/with gaps/.test(S([D('2026-08-26', 1, true), D('2026-08-25', 1, true), D('2026-08-24', 0, false)], true).text));
    check('never in the archive: neutral either way; with the VVD live it says it is new since the latest day, without it just says so; one day is "1 archived day"', (() => { const a = S([D('2026-08-26', 0, false), D('2026-08-25', 0, false)], true), b = S([D('2026-08-26', 0, false)], false); return a.status === 'na' && /not in any of the 2 archived days \(2026-08-25 to 2026-08-26\): it is new in the feed/.test(a.text) && b.status === 'na' && b.text === 'not in any of the 1 archived day (2026-08-26 to 2026-08-26).'; })());
    check('an empty archive is neutral and says so', same(S([], true), { status: 'na', text: 'the archive holds no days to search.' }) && S(null, false).status === 'na');
    // Ad-hoc lanes (EXE / EXW) carry no real Max Laden: 0 there is normal, so those days are not counted as "missing" (review, minor).
    const A = (date, legs, maxFilled) => ({ date, legs, maxFilled, adhoc: true });
    check('a VVD on an ad-hoc lane every day: says Max Laden is 0 there and that is normal, not "filled on 0 of 2 days"', (() => { const r = S([A('2026-08-26', 1, false), A('2026-08-25', 1, false)], true); return r.status === 'ok' && / Max Laden is 0 on the ad-hoc lanes, which is normal\.$/.test(r.text) && !/filled on/.test(r.text); })(), S([A('2026-08-26', 1, false), A('2026-08-25', 1, false)], true));
    check('mixed: only the days on real lanes are counted (1 ad-hoc + 2 real, one real filled: "filled on 1 of 2")', /Max Laden was filled on 1 of 2 of those days\./.test(S([A('2026-08-26', 1, false), D('2026-08-25', 1, true), D('2026-08-24', 1, false)], true).text), S([A('2026-08-26', 1, false), D('2026-08-25', 1, true), D('2026-08-24', 1, false)], true).text);
}

console.log('--- an archive call that never answers ---');
(async () => {
    const T = F.vvdWithTimeout;
    const raced = await Promise.all([
        T(new Promise(() => {}), 30).then(() => 'resolved', (e) => ({ name: e.name, message: e.message })),
        T(Promise.resolve('csv text'), 30).then((v) => v, () => 'rejected'),
        T(Promise.reject(new Error('boom')), 30).then(() => 'resolved', (e) => e.message),
        T(new Promise((r) => setTimeout(() => r('slow but in time'), 10)), 200).then((v) => v, () => 'rejected'),
    ]);
    check('a call that never answers is given up on: it rejects as an AbortError "no answer in time" (the name the finder turns into those words)', same(raced[0], { name: 'AbortError', message: 'no answer in time' }), raced[0]);
    check('an answer that comes in time passes through, and so does the call\'s own failure (not turned into a timeout)', raced[1] === 'csv text' && raced[2] === 'boom' && raced[3] === 'slow but in time', raced);
    // The timer must be cleared by a prompt answer (or a failure), or every finished day would leave a timer pending that fires a rejection nobody waits for.
    // A promise that already settled cannot reject twice, so the only honest check is to count the timers still pending: setTimeout and clearTimeout are
    // wrapped for this one measurement (the block calls them as globals) and anything left over is cleared by hand so a bug cannot hold the process open.
    const realSet = global.setTimeout, realClear = global.clearTimeout, pending = new Set();
    global.setTimeout = (fn, ms, ...a) => { const t = realSet(() => { pending.delete(t); fn(...a); }, ms); pending.add(t); return t; };
    global.clearTimeout = (t) => { pending.delete(t); realClear(t); };
    let afterOk, afterFail;
    try {
        await T(Promise.resolve(1), 5000); afterOk = pending.size;
        await T(Promise.reject(new Error('x')), 5000).catch(() => {}); afterFail = pending.size;
    } finally {
        pending.forEach((t) => realClear(t)); global.setTimeout = realSet; global.clearTimeout = realClear;
    }
    check('no timer is left pending after a prompt answer or after a failure (it is cleared both ways)', afterOk === 0 && afterFail === 0, { afterOk, afterFail });
    finish();
})();

function finish() {
console.log(`\n${checks} checks, ${failures} failed.`);
if (failures > 0) { console.log('❌ FAIL -- the VVD finder logic does not do what D63 says'); process.exit(1); }
console.log('✅ PASS -- the VVD finder matches, judges Max Laden, compares and explains as D63 requires');
}

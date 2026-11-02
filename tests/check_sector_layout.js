#!/usr/bin/env node
/**
 * Headless check of readSectorSheet, the function that turns the published sector Google Sheet
 * (SECTOR_DATA_CSV_URL) into the rows Sector Summary's right-hand table is built from. D37, 2026-10-09.
 *
 * WHY THIS EXISTS. The Sheet used to be one header row over ten columns. On 2026-10-09 it became two header rows
 * (row 1 labels two blocks of six columns, DRY and RFR; row 2 names the columns). The app took the first row as the
 * header, found no "Vessel 1st Sub Trade" and silently showed an EMPTY table. A browser suite (Sector_Layout in
 * tests/booking_flash_regression_tests.js) covers the page end to end on the real new Sheet; this script covers what is
 * too fiddly to boot an app for: the reader's edge cases (merged or repeated labels, a title row, reordered columns, blank
 * lines, a renamed heading, exact halves) and its equivalence with the OLD reader on the old Sheet.
 *
 * HOW. The reader sits in the app file between the lines
 *     // >>> BEGIN SECTOR SHEET READER     and     // <<< END SECTOR SHEET READER
 * It is a pure function of the cells it is handed. This script cuts that text out of the app file, evaluates it, and feeds
 * it grids built by the real xlsx package from the committed fixtures (and small hand-made grids). Nothing is copied:
 * change the reader in the app and this runs the new code.
 *
 *   node tests/check_sector_layout.js                    the main app file (resolved like every other check)
 *   node tests/check_sector_layout.js <app file>         that file
 *
 * The reader also gives each two-block row a `blocks` property (the Dry / Reefer chips read it); the two checks that look at it
 * always run (until 2026-10-11 they ran only `if` the property was there, for the build that had it, so a reader that stopped
 * producing it would have skipped them silently: 40 checks, 0 failed).
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

const REPO_ROOT = path.dirname(__dirname);
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures');
const TWO_BLOCK = path.join(FIXTURES, 'sector_data_two_header_2026-10-09.csv');
const ONE_BLOCK = path.join(FIXTURES, 'sector_data_2026-09-16.csv');

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

// ---- cut the reader out of the app file and evaluate it ----
const html = fs.readFileSync(appPath, 'utf8');
const begin = html.match(/\/\/ >>> BEGIN SECTOR SHEET READER\n/g) || [];
const end = html.match(/\/\/ <<< END SECTOR SHEET READER/g) || [];
check('the app file has exactly one reader, between the BEGIN and END marker lines', begin.length === 1 && end.length === 1, { begin: begin.length, end: end.length });
if (begin.length !== 1 || end.length !== 1) { console.log('\n❌ FAIL -- cannot find the reader'); process.exit(1); }
const body = html.slice(html.indexOf('// >>> BEGIN SECTOR SHEET READER\n') + '// >>> BEGIN SECTOR SHEET READER\n'.length, html.indexOf('// <<< END SECTOR SHEET READER'));
let readSectorSheet;
try { readSectorSheet = new Function(`${body}\nreturn readSectorSheet;`)(); } catch (err) { console.log(`  ❌ the reader does not evaluate: ${err.message}`); process.exit(1); }
check('the reader evaluates on its own (it depends on nothing outside the marked lines)', typeof readSectorSheet === 'function');

// ---- grids ----
const gridOf = (file) => {
    const wb = XLSX.read(fs.readFileSync(file, 'utf8'), { type: 'string', raw: true });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
};
const MEASURES = ['MCT Sector Allocation', 'Measures Laden TEU', 'MCT Voyage Count', 'Average Booking', 'Sector Open Space', 'Sector Allocation'];
const IDS = ['Vessel 1st Trade', 'Vessel 1st Sub Trade', 'Vessel 1st Lane', 'POD Sec'];
// A two-block grid: label row, heading row, then `pods` (each [trade, sub, lane, pod, dry[6], rfr[6]]).
const twoBlock = (pods, { merged = false, labels = ['DRY', 'RFR'], title = false } = {}) => {
    const lab = ['', '', '', 'Booking Cargo Nature'];
    labels.forEach(l => MEASURES.forEach((_, i) => lab.push(merged && i > 0 ? '' : l)));
    const rows = [lab, IDS.concat(...labels.map(() => MEASURES)), ...pods.map(p => p.slice(0, 4).concat(...p.slice(4)))];
    return title ? [['Sector data, refreshed daily'], ...rows] : rows;
};
const POD1 = ['TAT', 'TA', 'AL5', 'BEANR', ['50', '717', '3', '239', '0', '50'], ['50', '6', '3', '2', '48', '50']];
const POD2 = ['TAT', 'TA', 'AT1', 'NLRTM', ['1,166', '1,101', '4', '275', '891', '1,166'], ['820', '22', '4', '6', '815', '820']];
const firstAlloc = (grid) => { const r = readSectorSheet(grid).rows[0]; return r ? r['Sector Allocation'] : undefined; };   // undefined when nothing was read: a failed check, not a crash
const figures = (r) => (r ? [r['Sector Allocation'], r['Average Booking'], r['Sector Open Space']] : null);   // null for a row that is missing: a failed check, not a crash

// ---- 1. the real two-block Sheet (2026-10-09) ----
console.log('--- the real two-block Sheet (tests/fixtures/sector_data_two_header_2026-10-09.csv) ---');
{
    const g = gridOf(TWO_BLOCK), r = readSectorSheet(g);
    check('it is read: no problem, 41 PODs (the Sheet has 2 heading rows and 41 lines)', r.problem === null && r.rows.length === 41 && g.length === 43, { problem: r.problem, rows: r.rows.length, gridRows: g.length });
    const at = (lane, pod) => r.rows.find(x => x['Vessel 1st Lane'] === lane && x['POD Sec'] === pod);
    check('AT1 NLRTM is the whole POD: allocation 1,166 (the DRY block), booking 281 (DRY 1,101 / 4 + RFR 22 / 4 = 280.75), open space 885 (1,166 - 280.75)',
        !!at('AT1', 'NLRTM') && same(figures(at('AT1', 'NLRTM')), ['1,166', '281', '885']), at('AT1', 'NLRTM') && figures(at('AT1', 'NLRTM')));
    check('EMA GRPIR takes the "Sector Allocation" column (99), not the "MCT Sector Allocation" one (115) that the DRY block also has',
        !!at('EMA', 'GRPIR') && at('EMA', 'GRPIR')['Sector Allocation'] === '99', at('EMA', 'GRPIR') && figures(at('EMA', 'GRPIR')));
    check('AL5 BEANR, already over its allocation, has open space 0 (never negative)', !!at('AL5', 'BEANR') && same(figures(at('AL5', 'BEANR')), ['50', '241', '0']), at('AL5', 'BEANR') && figures(at('AL5', 'BEANR')));
    const sum = (i) => r.rows.reduce((s, x) => s + (parseFloat(String(figures(x)[i]).replace(/,/g, '')) || 0), 0);
    check('the three columns add up to 9,015 / 5,604 / 4,782 (the independent Python figures in tests/booking_flash_regression_tests.js, SECTOR_TWO_BLOCK_GT)', same([sum(0), sum(1), sum(2)], [9015, 5604, 4782]), [sum(0), sum(1), sum(2)]);
    const withBlocks = r.rows.filter(x => x.blocks !== undefined);
    {
        const nl = (at('AT1', 'NLRTM') || {}).blocks || { dry: {}, rfr: {} };
        check('every row carries its two blocks as the Sheet shows them: AT1 NLRTM DRY 1,166 / 275 / 891 and RFR 820 / 6 / 815',
            withBlocks.length === 41 && same([nl.dry.alloc, nl.dry.avgBooking, nl.dry.openSpace], ['1,166', '275', '891']) && same([nl.rfr.alloc, nl.rfr.avgBooking, nl.rfr.openSpace], ['820', '6', '815']), nl);
        const rfrOf = (x) => (x && x.blocks && x.blocks.rfr) || {};
        const empty = r.rows.filter(x => x.blocks && ['laden', 'voyages', 'avgBooking', 'openSpace', 'sectorAlloc', 'mctAlloc'].every(k => rfrOf(x)[k] === ''));
        check('14 PODs have an entirely empty RFR block, and EMA GRPIR has an RFR allocation (99) with nothing else', empty.length === 14 && rfrOf(at('EMA', 'GRPIR')).alloc === '99' && rfrOf(at('EMA', 'GRPIR')).avgBooking === '', { empty: empty.length });
    }
}

// ---- 2. the old one-block Sheet: the same rows the old reader gave ----
console.log('\n--- the old one-block Sheet (tests/fixtures/sector_data_2026-09-16.csv) ---');
{
    const r = readSectorSheet(gridOf(ONE_BLOCK));
    const wb = XLSX.read(fs.readFileSync(ONE_BLOCK, 'utf8'), { type: 'string', raw: true });
    const old = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });   // what the app did before 2026-10-09
    const oldAlloc = (o) => (o['Sector Allocation'] !== undefined ? o['Sector Allocation'] : (o['MCT Sector Allocation_1'] !== undefined ? o['MCT Sector Allocation_1'] : o['MCT Sector Allocation']));
    const diffs = [];
    old.forEach((o, i) => {
        const n = r.rows[i];
        [['Vessel 1st Trade', o['Vessel 1st Trade']], ['Vessel 1st Sub Trade', o['Vessel 1st Sub Trade']], ['Vessel 1st Lane', o['Vessel 1st Lane']], ['POD Sec', o['POD Sec']],
            ['Average Booking', o['Average Booking']], ['Sector Open Space', o['Sector Open Space']], ['Sector Allocation', oldAlloc(o)]]
            .forEach(([k, v]) => { if (!n || n[k] !== String(v).trim()) diffs.push({ row: i, key: k, old: v, now: n && n[k] }); });
    });
    check('no problem, and the same 42 rows with the same seven values as the old reader (sheet_to_json keyed by the first row)', r.problem === null && r.rows.length === old.length && old.length === 42 && diffs.length === 0, { problem: r.problem, rows: r.rows.length, oldRows: old.length, diffs: diffs.slice(0, 3) });
    check('a one-block row has no cargo blocks (the Dry / Reefer chips then leave the table alone)', r.rows.every(x => x.blocks === undefined || x.blocks === null));
}

// ---- 3. layouts that are not the two real ones ----
console.log('\n--- other layouts ---');
{
    const base = readSectorSheet(twoBlock([POD1, POD2]));
    check('a hand-built two-block grid reads like the real one (AL5 BEANR 50 / 241 / 0, AT1 NLRTM 1,166 / 281 / 885)', base.problem === null && base.rows.length === 2 && same(figures(base.rows[0]), ['50', '241', '0']) && same(figures(base.rows[1]), ['1,166', '281', '885']), base.rows.map(figures));
    check('labels written once over a merged block (blank cells to its right) read the same as labels repeated on every column', same(readSectorSheet(twoBlock([POD1, POD2], { merged: true })).rows.map(figures), base.rows.map(figures)));
    check('labels in lower case (dry / rfr) are recognised', same(readSectorSheet(twoBlock([POD1, POD2], { labels: ['dry', 'rfr'] })).rows.map(figures), base.rows.map(figures)));
    // 2026-10-11 review: "Reefer" (or "RFR TEU") used to read as no label, so with "Dry" beside it the Sheet was refused, and with two
    // such labels both blocks fell into one unlabelled block where the DRY figures silently stood for the whole POD.
    check('labels written as words (Dry / Reefer) are recognised', same(readSectorSheet(twoBlock([POD1, POD2], { labels: ['Dry', 'Reefer'] })).rows.map(figures), base.rows.map(figures)));
    check('labels with a unit (DRY TEU / RFR TEU) are recognised', same(readSectorSheet(twoBlock([POD1, POD2], { labels: ['DRY TEU', 'RFR TEU'] })).rows.map(figures), base.rows.map(figures)));
    check('a title row above the label row changes nothing', same(readSectorSheet(twoBlock([POD1, POD2], { title: true })).rows.map(figures), base.rows.map(figures)));
    // Columns are found by name, not by position: swap two columns inside each block and move POD Sec before Sub Trade.
    {
        const g = twoBlock([POD1, POD2]);
        const swap = (row) => { const r = row.slice(); [r[5], r[7]] = [r[7], r[5]]; [r[11], r[13]] = [r[13], r[11]]; return r; };
        const shuffled = g.map((row, i) => (i === 0 ? row : swap(row)));
        check('columns are found by their heading, not their position (Measures Laden TEU and Average Booking swapped in both blocks)', same(readSectorSheet(shuffled).rows.map(figures), base.rows.map(figures)));
    }
    check('blank lines, and lines with no Sub Trade, Lane or POD, are skipped', readSectorSheet(twoBlock([POD1, ['', '', '', '', [], []], POD2])).rows.length === 2);
    check('headings are matched ignoring case and surrounding spaces', same(readSectorSheet(twoBlock([POD1, POD2]).map((row, i) => (i === 1 ? row.map(c => ` ${String(c).toUpperCase()} `) : row))).rows.map(figures), base.rows.map(figures)));
    // Only a DRY block: the missing RFR block counts as nothing.
    {
        const g = twoBlock([POD1, POD2], { labels: ['DRY'] }).map(row => row.slice(0, 10));
        const r = readSectorSheet(g);
        check('a Sheet with only a DRY block is read, the booking being the DRY block alone (AL5 BEANR 50 / 239 / 0)', r.problem === null && r.rows.length === 2 && same(figures(r.rows[0]), ['50', '239', '0']), r.problem || r.rows.map(figures));
    }
    // Rounding: the blocks are added unrounded and rounded once, and an exact half rounds up (the Sheet's own rule).
    {
        const half = readSectorSheet(twoBlock([['TAT', 'TA', 'AT4', 'ITSPE', ['262', '33', '2', '17', '245', '262'], ['0', '', '', '', '', '']]]));
        check('an exact half rounds up: laden 33 over 2 voyages is 16.5, booked 17, open space 262 - 16.5 = 245.5, shown 246', half.problem === null && same(figures(half.rows[0]), ['262', '17', '246']), half.rows.map(figures));
        const unrounded = readSectorSheet(twoBlock([['TAT', 'TA', 'AT1', 'X', ['100', '1', '3', '0', '100', '100'], ['100', '1', '3', '0', '100', '100']]]));
        check('two bookings that each round to 0 still add up before rounding (1/3 + 1/3 = 0.67 books 1; open space 100 - 0.67 = 99.33 shows 99)', same(figures(unrounded.rows[0]), ['100', '1', '99']), unrounded.rows.map(figures));
        const noVoyages = readSectorSheet(twoBlock([['TAT', 'TA', 'EMA', 'GRPIR', ['99', '', '', '110', '0', '99'], ['', '', '', '', '', '99']]]));
        check('a block with no voyage count falls back to its shown Average Booking (EMA GRPIR: 110), and its allocation comes from the "Sector Allocation" column', same(figures(noVoyages.rows[0]), ['99', '110', '0']), noVoyages.rows.map(figures));
    }
    // The allocation columns.
    {
        const g = twoBlock([['TAT', 'TA', 'EMA', 'GRPIR', ['115', '220', '2', '110', '0', '99'], ['', '', '', '', '', '']]]);
        check('"Sector Allocation" wins over "MCT Sector Allocation" in the same block (99, not 115)', firstAlloc(g) === '99');
        const blankAlloc = twoBlock([['TAT', 'TA', 'EMA', 'GRPIR', ['115', '220', '2', '110', '0', ''], ['', '', '', '', '', '']]]);
        check('a "Sector Allocation" column whose cell is blank stays blank, as it did (the MCT value is not borrowed)', firstAlloc(blankAlloc) === '');
        const noSectorAlloc = [IDS.concat(MEASURES.slice(0, 5)), ['TAT', 'TA', 'EMA', 'GRPIR', '115', '220', '2', '110', '0']];
        check('with no "Sector Allocation" column at all, "MCT Sector Allocation" is used', firstAlloc(noSectorAlloc) === '115');
        const dup = [IDS.concat('MCT Sector Allocation', 'Measures Laden TEU', 'MCT Voyage Count', 'Average Booking', 'Sector Open Space', 'MCT Sector Allocation'), ['TAT', 'TA', 'EMA', 'GRPIR', '115', '220', '2', '110', '0', '99']];
        check('the old Sheet\'s duplicated "MCT Sector Allocation" heading: the later column is the allocation (99)', firstAlloc(dup) === '99');
    }
    // 2026-10-11 review: an accounting negative and blank POD lines.
    {
        // DRY books 400 / 4 = 100; the RFR block holds a negative adjustment of "(8)" laden TEU over 4 voyages, -2: 98 booked, 2 left.
        // Read as +8 (the old reading) it books 102 and shows 0 space left.
        const neg = readSectorSheet(twoBlock([['TAT', 'TA', 'AL5', 'BEANR', ['100', '400', '4', '100', '0', '100'], ['', '(8)', '4', '', '', '']]]));
        check('a parenthesised figure is a negative: "(8)" laden TEU over 4 voyages takes 2 off the booking (98 booked, open space 2)', same(figures(neg.rows[0]), ['100', '98', '2']), neg.rows.map(figures));
        const blank = readSectorSheet(twoBlock([['TAT', 'TA', 'AL5', 'BEANR', ['', '', '', '', '', ''], ['', '', '', '', '', '']]]));
        check('a POD line with every figure blank in both blocks shows blank figures, not "0 booked, 0 space left"', blank.problem === null && blank.rows.length === 1 && same(figures(blank.rows[0]), ['', '', '']), blank.rows.map(figures));
        const noAlloc = readSectorSheet(twoBlock([['TAT', 'TA', 'AL5', 'BEANR', ['', '400', '4', '100', '', ''], ['', '', '', '', '', '']]]));
        check('a POD with bookings but no allocation shows its booking and a blank open space (not 0)', same(figures(noAlloc.rows[0]), ['', '100', '']), noAlloc.rows.map(figures));
    }
    // A title row above a one-block Sheet.
    {
        const g = [['Sector data'], IDS.concat(MEASURES), ['TAT', 'TA', 'AL5', 'BEANR', '50', '717', '3', '239', '0', '50']];
        const r = readSectorSheet(g);
        check('a title row above a one-block Sheet is not mistaken for block labels', r.problem === null && r.rows.length === 1 && same(figures(r.rows[0]), ['50', '239', '0']), r.problem || r.rows.map(figures));
    }
    // Numbers in cells (not text) are read as text.
    {
        const g = twoBlock([POD1, POD2]).map((row, i) => (i < 2 ? row : row.map(c => (typeof c === 'string' && /^\d+$/.test(c) ? Number(c) : c))));
        check('cells that hold numbers instead of text read the same', same(readSectorSheet(g).rows.map(figures), base.rows.map(figures)));
    }
}

// ---- 4. layouts the app must refuse, loudly ----
console.log('\n--- layouts it cannot read: a sentence saying why, no rows ---');
{
    const refused = (name, grid, expect) => {
        const r = readSectorSheet(grid);
        check(name, r.rows.length === 0 && typeof r.problem === 'string' && expect.test(r.problem), r);
    };
    refused('an empty Sheet', [], /Sub Trade/);
    refused('a Sheet that is only a sign-in page (no heading row)', [['<!DOCTYPE html>'], ['<html>'], ['Sign in']], /Sub Trade/);
    refused('the Sub Trade heading renamed', twoBlock([POD1, POD2]).map((row, i) => (i === 1 ? row.map(c => (c === 'Vessel 1st Sub Trade' ? 'Vessel 1st Sub Trade RENAMED' : c)) : row)), /Sub Trade/);
    refused('the POD Sec heading renamed', twoBlock([POD1, POD2]).map((row, i) => (i === 1 ? row.map(c => (c === 'POD Sec' ? 'POD Sector' : c)) : row)), /POD Sec/);
    refused('every measure heading renamed', twoBlock([POD1, POD2]).map((row, i) => (i === 1 ? row.map(c => (MEASURES.includes(c) ? `${c} (new)` : c)) : row)), /Average Booking|Sector Allocation/);
    refused('a block under a label the app does not know (HC) next to a DRY one: some columns labelled, some not', twoBlock([POD1, POD2], { labels: ['DRY', 'HC'] }), /some of the columns sit under a DRY or RFR label and some under none/);
    refused('two blocks under labels the app does not know (Box A / Box B): the same headings under two unknown labels', twoBlock([POD1, POD2], { labels: ['Box A', 'Box B'] }), /appears under two labels the app does not know/);
    refused('the RFR label deleted: its cells inherit DRY from the left, so the DRY block would have two of each column', (() => { const g = twoBlock([POD1, POD2]); g[0] = g[0].map((c, i) => (i >= 10 ? '' : c)); return g; })(), /DRY block has two "Measures Laden TEU" columns/);
    check('readSectorSheet never throws on odd input (null cells, short rows, a non-array row)', (() => { try { readSectorSheet([[null, undefined], 'x', [IDS[1], IDS[2], IDS[3]], null]); readSectorSheet([IDS, null, [], ['a']]); return true; } catch (err) { console.log(err); return false; } })());
}

console.log(`\n${checks} checks, ${failures} failed.`);
if (failures > 0) { console.log('❌ FAIL -- readSectorSheet does not read the sector Sheet as D37 requires'); process.exit(1); }
console.log('✅ PASS -- readSectorSheet reads both Sheet layouts and refuses an unknown one with a reason');

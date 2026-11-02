#!/usr/bin/env node
/**
 * csvTextToSheetRows (the app's fast CSV reader, 2026-10-27 perf) against the real SheetJS.
 *
 * The app reads CSV text with csvTextToSheetRows and falls back to SheetJS (XLSX.read with raw: true, then
 * sheet_to_json with raw: false, defval: '') when it returns null. The reader is only correct if, whenever it does
 * return rows, they are exactly what SheetJS would have returned: same rows, same keys in the same order, same strings.
 * This check lifts the real function out of the app file (brace matching from `function csvTextToSheetRows(`; the
 * function keeps braces out of its strings and regexes for this) and compares it with the `xlsx` dev dependency, the
 * same 0.20.3 build the app loads from cdn.sheetjs.com:
 *   1. every CSV in the repo (the 9-day historical CSV and tests/fixtures/*.csv). The real exports must take the fast
 *      path (a reader that always declined would pass the equality checks and make nothing faster); the two-header
 *      sector Sheet must decline (its first header cells are blank).
 *   2. hand-written edge cases: quoting, embedded newlines and commas, CRLF, blank lines, short rows, and each shape the
 *      reader must decline (BOM, "sep=", a tab / ";" / "|" in the first 1,024 characters, which SheetJS uses to pick its
 *      delimiter, one column, blank / padded / repeated headers, a long row, a lone CR, stray quotes).
 *   3. 20,000 generated files (fixed seed): wherever the reader answers, it must equal SheetJS.
 * Only enumerable content is compared: SheetJS also gives each row a hidden __rowNum__, which the app never reads.
 *
 * Usage: node tests/check_csv_fast_path.js [path-to-app-html]
 * Exit code 0 when every assertion passes, 1 otherwise.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

const REPO_ROOT = path.dirname(__dirname);
// Tripwire on the executed-assertion count, so a section that silently stops running is noticed.
// 44 since 2026-10-30 (+2: the synthetic tests/fixtures/ep_export_sample.csv, D84 slice 2a-4); 42 before.
const EXPECTED_ASSERTIONS = 44;

function loadReader(htmlPath) {
    const src = fs.readFileSync(htmlPath, 'utf8');
    const start = src.indexOf('function csvTextToSheetRows(');
    if (start < 0) throw new Error(`function csvTextToSheetRows( not found in ${htmlPath}`);
    let depth = 0;
    let end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) throw new Error('csvTextToSheetRows: unbalanced braces');
    // eslint-disable-next-line no-new-func
    return new Function(`${src.slice(start, end)}\nreturn csvTextToSheetRows;`)();
}

let XLSX;
try {
    XLSX = require(require.resolve('xlsx', { paths: [REPO_ROOT] }));
} catch (e) {
    console.error('❌ the xlsx package is not installed. Run: npm ci');
    process.exit(1);
}
const viaSheetJs = (text) => {
    const wb = XLSX.read(text, { type: 'string', raw: true });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
};

let passed = 0;
let failed = 0;
const check = (ok, label, detail) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); } else { failed++; console.log(`  ❌ ${label}${detail ? `\n       ${detail}` : ''}`); }
};
// Equal = same JSON (rows, key order, values). SheetJS throwing while the reader answers is a mismatch too.
const sameAsSheetJs = (text, rows) => {
    let expected;
    try { expected = viaSheetJs(text); } catch (e) { return { ok: false, why: `SheetJS threw: ${e.message}` }; }
    const a = JSON.stringify(expected);
    const b = JSON.stringify(rows);
    if (a === b) return { ok: true };
    for (let i = 0; i < Math.max(expected.length, rows.length); i++) {
        if (JSON.stringify(expected[i]) !== JSON.stringify(rows[i])) {
            return { ok: false, why: `first difference at row ${i}: SheetJS ${JSON.stringify(expected[i])} vs reader ${JSON.stringify(rows[i])}` };
        }
    }
    return { ok: false, why: 'differs' };
};

function main() {
    let htmlPath = process.argv[2];
    if (!htmlPath) {
        htmlPath = findCurrentAppHtml();
        console.log(`(auto-detected current app version: ${path.basename(htmlPath)})`);
    }
    const read = loadReader(htmlPath);

    console.log('\n1. Every CSV in the repo');
    const realFiles = [
        ['Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv', true],
        ['tests/fixtures/historical_data_2026-08-24_to_2026-08-26.csv', true],
        ['tests/fixtures/live_csv_2026-08-12.csv', true],
        ['tests/fixtures/sector_data_2026-09-16.csv', true],
        ['tests/fixtures/sector_data_two_header_2026-10-09.csv', false],
        // SYNTHETIC (D84 slice 2a-4): read by tests/check_ep_export_logic.js, not by the app; listed so every CSV stays covered.
        ['tests/fixtures/ep_export_sample.csv', true],
    ];
    const listed = new Set(realFiles.map(([f]) => f));
    const unlisted = fs.readdirSync(path.join(REPO_ROOT, 'tests/fixtures')).filter((f) => f.endsWith('.csv') && !listed.has(`tests/fixtures/${f}`));
    check(unlisted.length === 0, 'every CSV fixture is listed here', unlisted.length ? `add: ${unlisted.join(', ')}` : '');
    for (const [rel, mustBeFast] of realFiles) {
        const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        const t0 = process.hrtime.bigint();
        const rows = read(text);
        const fastMs = Number(process.hrtime.bigint() - t0) / 1e6;
        if (!mustBeFast) { check(rows === null, `${rel}: declines (SheetJS reads it)`); continue; }
        check(Array.isArray(rows), `${rel}: takes the fast path`);
        const t1 = process.hrtime.bigint();
        const r = rows ? sameAsSheetJs(text, rows) : { ok: false, why: 'declined' };
        const sheetMs = Number(process.hrtime.bigint() - t1) / 1e6;
        check(r.ok, `${rel}: ${rows ? rows.length : 0} rows identical to SheetJS (reader ${fastMs.toFixed(0)} ms, SheetJS ${sheetMs.toFixed(0)} ms)`, r.why);
    }

    console.log('\n2. Edge cases');
    const answers = [
        ['plain', 'a,b\n1,2\n3,4'],
        ['trailing newline', 'a,b\n1,2\n'],
        ['CRLF', 'a,b\r\n1,2\r\n3,4\r\n'],
        ['quoted comma, quote and newline', 'a,b\n"x,y","say ""hi"""\n"line1\nline2",z'],
        ['quoted CRLF inside a field', 'a,b\n"p\r\nq",r'],
        ['blank lines and an all-empty row are skipped', 'a,b\n1,2\n\n,\n3,4\n\n'],
        ['short rows get "" for missing cells', 'a,b,c\n1\n1,2'],
        ['empty quoted field', 'a,b\n"",x'],
        ['values SheetJS would type without raw', 'a,b,c,d,e\nTRUE,0012,2026-08-12,1e5,=1+1'],
        ['ISO, US and year-less dates stay text', 'IsoDate,MonDDate,UsDate\n2026-08-16,Aug 05,8/12/2026'],
        ['padded values keep their spaces', 'a,b\n  x  , y'],
        ['quoted header', '"a b",c\n1,2'],
        ['tab, ";" and "|" after the first 1,024 characters', `a,b\n${'x,y\n'.repeat(300)}p\tq,r;s|t`],
        ['unicode', 'a,b\né漢,🙂'],
        ['header only', 'a,b\n'],
    ];
    for (const [label, text] of answers) {
        const rows = read(text);
        const r = rows ? sameAsSheetJs(text, rows) : { ok: false, why: 'declined' };
        check(r.ok, `${label}: answers, same as SheetJS`, r.why);
    }
    const declines = [
        ['BOM', '\uFEFFa,b\n1,2'],
        ['"sep=" line', 'sep=,\na,b\n1,2'],
        ['tab in the first 1,024 characters', 'a,b\n1\t2,3'],
        ['";" in the first 1,024 characters', 'a,b\n1;2,3'],
        ['"|" in the first 1,024 characters', 'a,b\n1|2,3'],
        ['one column', 'a\n1\n2'],
        ['blank header', 'a,,c\n1,2,3'],
        ['repeated header', 'a,a\n1,2'],
        ['padded header', 'a, b\n1,2'],
        ['row longer than the header', 'a,b\n1,2,3'],
        ['lone CR', 'a,b\r1,2'],
        ['quote inside an unquoted field', 'a,b\nx"y,z'],
        ['text after a closing quote', 'a,b\n"x"y,z'],
        ['unclosed quote', 'a,b\n"x,y'],
        ['text SheetJS reads as SYLK (starts with ID)', 'ID,b\n1,2'],
    ];
    for (const [label, text] of declines) check(read(text) === null, `${label}: declines`);

    console.log('\n3. 20,000 generated files (fixed seed)');
    let seed = 20261027;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const atoms = ['', 'a', 'abc', ' x ', '  ', 'TRUE', 'false', '0012', '1.50', '1e5', '-3', '=1+1', '2026-08-12', '8/12/2026', '12:30',
        '50%', '$5', '#N/A', 'é漢', 'a b', "it's", '\t', 'ID', '1,234', 'x"y', 'line1\nline2', 'a\r\nb', '"q"', ' ', '0', 'Jan 5', '.5', 'a;b', 'p|q'];
    const headers = ['A', 'B', 'Col C', 'D', 'E', 'Record Date', 'n1', 'ID', 'id', '<a>', 'PK', '0', '12', 'TRUE', ' a', 'Ä', '#', '-', 'a;b', 'x|y', ''];
    const enc = (v) => (/[",\r\n]/.test(v) || rnd() < 0.15 ? `"${v.replace(/"/g, '""')}"` : v);
    let answered = 0;
    let mismatches = 0;
    let firstMismatch = '';
    for (let t = 0; t < 20000; t++) {
        const cols = 1 + Math.floor(rnd() * 5);
        const hdr = [];
        while (hdr.length < cols) { const h = pick(headers); if (!hdr.includes(h) || rnd() < 0.05) hdr.push(h); }
        const nl = rnd() < 0.3 ? '\r\n' : '\n';
        const lines = [hdr.map(enc).join(',')];
        const nRows = Math.floor(rnd() * 6);
        for (let r = 0; r < nRows; r++) {
            if (rnd() < 0.08) { lines.push(''); continue; }
            let k = cols;
            if (rnd() < 0.15) k = Math.max(1, cols - 1 - Math.floor(rnd() * cols));
            if (rnd() < 0.05) k = cols + 1;
            const vals = [];
            for (let c = 0; c < k; c++) vals.push(enc(pick(atoms)));
            lines.push(vals.join(','));
        }
        let text = lines.join(nl);
        if (rnd() < 0.5) text += nl;
        const rows = read(text);
        if (rows === null) continue;
        answered++;
        const r = sameAsSheetJs(text, rows);
        if (!r.ok) { mismatches++; if (!firstMismatch) firstMismatch = `${JSON.stringify(text)}: ${r.why}`; }
    }
    check(mismatches === 0, `every answered file equals SheetJS (${answered} of 20,000 answered)`, firstMismatch);
    // Without this, a reader that declined everything would pass the line above. 3,744 answer today; most of the rest
    // carry a shape it must decline on purpose (a tab, ";" or "|" near the top, a blank or repeated header).
    check(answered >= 3000, `the reader answers at least 3,000 of them (answered ${answered})`);

    const executed = passed + failed;
    check(executed === EXPECTED_ASSERTIONS, `executed ${executed} assertions (expected ${EXPECTED_ASSERTIONS})`);
    console.log(`\n${failed === 0 ? 'CSV_FAST_PATH_PASSED' : 'CSV_FAST_PATH_FAILED'} (${passed} passed, ${failed} failed)`);
    process.exit(failed === 0 ? 0 : 1);
}

main();

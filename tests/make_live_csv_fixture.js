#!/usr/bin/env node
/**
 * Regenerates tests/fixtures/live_csv_2026-08-12.csv -- the fixture
 * tests/ci_regression_runner.js pins CSV_SOURCE_URL to (see that pin's own comment for why the
 * app's primary data source must not be left live during the suite).
 *
 * The fixture is derived FROM the committed sample .xlsx rather than downloaded, so that the
 * app's two ingest paths deliver identical rows and the upload-vs-live-fetch ordering stops
 * mattering. NEVER capture what the app rendered instead -- that freezes a bug in as "expected",
 * the same trap tests/booking_flash_regression_tests.js warns about for the Sector fixture.
 *
 * It does not just write the file, it PROVES the round trip is lossless, because "the CSV looks
 * about right" is not good enough when 125 assertions depend on it. parseWorkbookToRows makes
 * exactly one sheet_to_json({raw:false, defval:''}) pass, so this compares that pass's output
 * from both sides:
 *   upload path : XLSX.read(buffer, { type: 'binary' })            -- date cells are Excel serials
 *   live path   : XLSX.read(text, { type: 'string', raw: true })   -- applyCsvText's exact call
 * and refuses to write anything if a single cell differs.
 *
 * Uses the VENDORED SheetJS (tests/vendor/, 0.20.3 -- the build the browser actually loads), not
 * the older npm devDependency, so the formatting rules match what the app will see. This repo has
 * been bitten by SheetJS version-specific parsing differences before; see DATA_ARCHITECTURE.md's
 * Class F.
 *
 *   node tests/make_live_csv_fixture.js
 *
 * Exits non-zero, writing nothing, if the round trip is not byte-identical.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.dirname(__dirname);
const SAMPLE_XLSX = path.join(REPO_ROOT, 'Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx');
const VENDORED_SHEETJS = path.join(REPO_ROOT, 'tests', 'vendor', 'cdn.sheetjs.com_xlsx-0.20.3_package_dist_xlsx.full.min.js');
const OUT = path.join(REPO_ROOT, 'tests', 'fixtures', 'live_csv_2026-08-12.csv');

if (!fs.existsSync(VENDORED_SHEETJS)) {
    console.error(`❌ vendored SheetJS not found at ${VENDORED_SHEETJS}`);
    console.error('   It is fetched on demand by tests/perf_benchmark.js\'s ensureVendorFiles(); run any perf harness once first.');
    process.exit(1);
}
const required = require(VENDORED_SHEETJS);
const XLSX = required && required.read ? required : (global.XLSX || globalThis.XLSX);
if (!XLSX || !XLSX.read) { console.error('❌ vendored SheetJS did not expose read()'); process.exit(1); }
console.log(`(SheetJS ${XLSX.version}, vendored -- same build the browser loads)`);

// 1. The .xlsx upload path, exactly as processFile reads it for a non-.csv file.
const wbUpload = XLSX.read(fs.readFileSync(SAMPLE_XLSX), { type: 'buffer' });
const wsUpload = wbUpload.Sheets[wbUpload.SheetNames[0]];
const rowsUpload = XLSX.utils.sheet_to_json(wsUpload, { raw: false, defval: '' });

// 2. Emit formatted text, so a raw:true string read gives back the .xlsx path's own strings.
const csv = XLSX.utils.sheet_to_csv(wsUpload);

// 3. The live path, exactly as applyCsvText reads it.
const wbLive = XLSX.read(csv, { type: 'string', raw: true });
const wsLive = wbLive.Sheets[wbLive.SheetNames[0]];
const rowsLive = XLSX.utils.sheet_to_json(wsLive, { raw: false, defval: '' });

const colsUpload = Object.keys(rowsUpload[0] || {});
const colsLive = Object.keys(rowsLive[0] || {});
const missing = colsUpload.filter((c) => !colsLive.includes(c));
const extra = colsLive.filter((c) => !colsUpload.includes(c));

let diffs = 0;
const samples = [];
const n = Math.min(rowsUpload.length, rowsLive.length);
for (let i = 0; i < n; i++) {
    for (const c of colsUpload) {
        const a = String(rowsUpload[i][c] ?? '');
        const b = String(rowsLive[i][c] ?? '');
        if (a !== b) {
            diffs++;
            if (samples.length < 10) samples.push(`   row ${i} "${c}": upload=${JSON.stringify(a)} live=${JSON.stringify(b)}`);
        }
    }
}

console.log(`rows: ${rowsUpload.length} upload / ${rowsLive.length} live    columns: ${colsUpload.length} / ${colsLive.length}`);
if (missing.length) console.log(`   columns only on the upload side: ${missing.join(', ')}`);
if (extra.length) console.log(`   columns only on the live side:   ${extra.join(', ')}`);
console.log(`cell differences: ${diffs} of ${n * colsUpload.length}`);
samples.forEach((s) => console.log(s));

if (rowsUpload.length !== rowsLive.length || missing.length || extra.length || diffs > 0) {
    console.error('\n❌ round trip is NOT lossless -- nothing written.');
    console.error('   Pinning CSV_SOURCE_URL to a fixture that parses differently from the .xlsx would');
    console.error('   reintroduce exactly the nondeterminism the pin exists to remove.');
    process.exit(1);
}
fs.writeFileSync(OUT, csv);
console.log(`\n✅ lossless -- every cell of every row identical through both parse paths`);
// Byte length, not csv.length -- the file holds multi-byte UTF-8, so the character count is
// smaller than what `ls` reports and printing it as "bytes" invites a phantom discrepancy.
console.log(`wrote ${path.relative(REPO_ROOT, OUT)} (${Buffer.byteLength(csv, 'utf8')} bytes, ${csv.length} characters)`);

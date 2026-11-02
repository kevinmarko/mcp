/**
 * Headless check for the "POL-only call" rule of Booking Flash (D68).
 *
 * AL5 is an eastbound lane ('E' voyages). Its data now also carries the westbound voyage's USMIA call as rows of lane AL5.
 * POL Booking Flash shows those rows; Booking Flash (one row per voyage) must not list that voyage. The rule is pure logic
 * with no DOM, written in the lines between `>>> BEGIN POL-ONLY CALL LOGIC` and `<<< END POL-ONLY CALL LOGIC` in the app
 * file. Like tests/check_column_order_logic.js, this file cuts that region out of the app and runs it under Node: it runs
 * the shipped code, never a copy of it. It also checks that buildTableData applies the rule before it combines legs.
 *
 * Run:  node tests/check_pol_only_call_logic.js
 *
 * It does NOT prove the table renders without the voyage in a browser; that is checked by hand against real data.
 * The final count is a TRIPWIRE: change EXPECTED_ASSERTIONS in the same commit as a deliberate change to the number of checks.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

const EXPECTED_ASSERTIONS = 22;

let appPath;
try { appPath = findCurrentAppHtml(); } catch (err) { console.error(err.message); process.exit(1); }
console.log(`(main app file: ${path.basename(appPath)})`);
const src = fs.readFileSync(appPath, 'utf8');

let passed = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}`); }
};

const BEGIN = '// >>> BEGIN POL-ONLY CALL LOGIC';
const END = '// <<< END POL-ONLY CALL LOGIC';
const b = src.indexOf(BEGIN);
const e = src.indexOf(END);
if (b === -1 || e === -1 || e < b) {
  console.error('FAILED: could not find the POL-ONLY CALL LOGIC region markers in the app file.');
  console.error('If they were renamed or moved, update the markers here -- do NOT delete this check.');
  process.exit(1);
}
let api;
try {
  api = new Function(`${src.slice(b, e)}\nreturn { POL_ONLY_FOREIGN_DIRECTION, isPolOnlyForeignCall };`)();
} catch (err) {
  console.error('FAILED: the region does not run as plain JS:', err.message);
  process.exit(1);
}
const { POL_ONLY_FOREIGN_DIRECTION, isPolOnlyForeignCall } = api;
const row = (lane, vvd) => ({ lane, vvd });

// The table: AL5 only, and only the westbound letter.
ok('table lists AL5', Object.prototype.hasOwnProperty.call(POL_ONLY_FOREIGN_DIRECTION, 'AL5'));
ok('AL5 hides W', POL_ONLY_FOREIGN_DIRECTION.AL5 === 'W');
ok('table is just AL5 today', Object.keys(POL_ONLY_FOREIGN_DIRECTION).length === 1);

// Hidden: the AL5 westbound voyage.
ok('AL5 NMTT0090W is hidden', isPolOnlyForeignCall(row('AL5', 'NMTT0090W')) === true);
ok('lane and vvd are trimmed and case-folded', isPolOnlyForeignCall(row(' al5 ', ' nmtt0090w ')) === true);

// Kept: AL5's own eastbound voyages, the VMS placeholder, blanks.
ok('AL5 NMTT0090E is kept', isPolOnlyForeignCall(row('AL5', 'NMTT0090E')) === false);
ok('AL5 VMS placeholder is kept', isPolOnlyForeignCall(row('AL5', 'VMS')) === false);
ok('AL5 blank vvd is kept', isPolOnlyForeignCall(row('AL5', '')) === false);
ok('AL5 missing vvd is kept', isPolOnlyForeignCall({ lane: 'AL5' }) === false);
ok('single-letter vvd W is not a voyage code', isPolOnlyForeignCall(row('AL5', 'W')) === false);

// Kept: every other lane, including lanes whose own voyages end in W and lanes that sail both ways.
ok('EC1 W voyage is kept', isPolOnlyForeignCall(row('EC1', 'YMTT0022W')) === false);
ok('PS4 W voyage is kept', isPolOnlyForeignCall(row('PS4', 'YUOT0084W')) === false);
ok('AT1 E voyage is kept', isPolOnlyForeignCall(row('AT1', 'POHT0076E')) === false);
ok('FLX S voyage is kept', isPolOnlyForeignCall(row('FLX', 'CGIT0021S')) === false);
ok('FLX N voyage is kept', isPolOnlyForeignCall(row('FLX', 'CGIT0022N')) === false);
ok('blank lane is kept', isPolOnlyForeignCall(row('', 'NMTT0090W')) === false);
ok('null row is kept', isPolOnlyForeignCall(null) === false);

// buildTableData applies it before combining legs.
const bt = src.indexOf('const buildTableData = (allLegRows) => {');
ok('buildTableData takes allLegRows', bt !== -1);
const fnEnd = src.indexOf('const tableData = useMemo(', bt);
const body = bt === -1 || fnEnd === -1 ? '' : src.slice(bt, fnEnd);
const filterAt = body.indexOf('allLegRows.filter(row => !isPolOnlyForeignCall(row))');
ok('buildTableData filters with isPolOnlyForeignCall', filterAt !== -1);
ok('the filter runs before the first aggregation step', filterAt !== -1 && filterAt < body.indexOf('aggregatedMap[key] = {'));
ok('the filter runs before the VMS placeholder rule', filterAt !== -1 && filterAt < body.indexOf('weeksWithRealVessel'));
ok('the POL tab does not use the rule (POL rows are never passed through it)', !/isPolOnlyForeignCall/.test(src.replace(src.slice(b, e), '').replace(body, '')));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(`FAILED: ${failures.join('; ')}`); process.exit(1); }
if (passed !== EXPECTED_ASSERTIONS) {
  console.log(`FAILED: ran ${passed} assertions, expected ${EXPECTED_ASSERTIONS} (a loop may have run zero times, or the count changed on purpose and EXPECTED_ASSERTIONS was not updated).`);
  process.exit(1);
}
console.log(`POL_ONLY_CALL_LOGIC_PASSED (${passed} assertions)`);

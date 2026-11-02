/**
 * Headless check for D56, the "No sector allocation" placeholder in the Sector Allocation column
 * (Booking Flash) / Sector Remarks column (POL Booking Flash).
 *
 * The rule (docs/DECISIONS.md, D56): a voyage (VVD, not VMS) gets row.sectorAllocMissing on every leg when
 *   1. its lane is an allocation lane (some row of the lane in the data has MCT Sector Allocation > 0),
 *   2. its legs' Laden TEU add up to more than 0,
 *   3. no leg has Sector Remarks text, and
 *   4. no leg has a sector allocation (> 0).
 *
 * WHY THIS EXISTS BESIDE THE BROWSER SUITE (Sector_Alloc_Placeholder)
 *
 * The pinned 8-12 fixture holds six flagged voyages but none of the awkward shapes the live feed has: a voyage that HAS an allocation and
 * still has no remarks (AL5 NROT0080E / CAGT0002E and AT3 MMOT0311E / MIET0111E / BVNT0019E / GLMT1009E on 2026-10-14; "No sector
 * allocation" would be false for them), a lane with allocation evidence on one voyage only, bookings on one leg only, VMS rows. Those are
 * here, fast, with no browser. The browser suite proves the cells render and the filters find them.
 *
 * It runs the REAL functions: toNum, cfPlain, markMissingSectorAllocation, secAllocShownText and the placeholder constant are cut out of
 * the app's script by parsing it (not by brace-counting, which breaks on regex literals), the way tests/check_compare_kpis.js does. The
 * expected values for the fixture and for the 2026-10-14 case come from a small independent implementation written below from the raw
 * column names, never from the app's own field names, so the code under test does not grade itself.
 *
 * Run:  node tests/check_sector_alloc_placeholder.js      (needs `npm ci` for xlsx and @babel/core)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const XLSX = require('xlsx');
// The "which file is the live app" rule is imported, not pasted -- see AGENTS.md check 1.
const { resolveAppHtml } = require('./perf_benchmark.js');

const REPO = path.resolve(__dirname, '..');
const appPath = resolveAppHtml();
console.log(`(main app file: ${path.relative(REPO, appPath)})`);
const html = fs.readFileSync(appPath, 'utf8');
const script = (/<script type="text\/babel">([\s\S]*?)<\/script>/.exec(html) || [])[1];
if (!script) { console.error('FAILED: no <script type="text/babel"> block in the app file.'); process.exit(1); }

const NAMES = ['toNum', 'cfPlain', 'SEC_ALLOC_MISSING_TEXT', 'SEC_ALLOC_MISSING_TITLE', 'markMissingSectorAllocation', 'secAllocShownText'];
const ast = babel.parseSync(script, { presets: ['@babel/preset-react'], sourceType: 'script', configFile: false, babelrc: false });
const src = NAMES.map((name) => {
  const node = ast.program.body.find((n) =>
    (n.type === 'FunctionDeclaration' && n.id && n.id.name === name) ||
    (n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id && d.id.name === name)));
  if (!node) {
    console.error(`FAILED: top-level declaration "${name}" not found in the app file.`);
    console.error('If it was renamed or moved, update NAMES here -- do NOT delete this check, and do not let it pass by finding nothing.');
    process.exit(1);
  }
  return script.slice(node.start, node.end);
});
const app = new Function(`${src.join('\n')}\nreturn { markMissingSectorAllocation, secAllocShownText, SEC_ALLOC_MISSING_TEXT, SEC_ALLOC_MISSING_TITLE };`)();
const { markMissingSectorAllocation: mark, secAllocShownText: shownText, SEC_ALLOC_MISSING_TEXT: PLACEHOLDER } = app;

let pass = 0;
const failures = [];
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); console.log(`  FAIL ${name}`); }
}
const flaggedVvds = (rows) => Array.from(new Set(rows.filter((r) => r.sectorAllocMissing).map((r) => r.vvd))).sort();
const leg = (vvd, lane, o = {}) => ({ vvd, vessel: `${vvd} NAME`, lane, secAlloc: '', ladenTeu: '0', sectorRemarks: '', ...o });

console.log('The placeholder text');
t('the placeholder reads "No sector allocation"', PLACEHOLDER, 'No sector allocation');
t('its hover title says bookings exist and the feed has no allocation', /bookings exist/i.test(app.SEC_ALLOC_MISSING_TITLE) && /no sector allocation/i.test(app.SEC_ALLOC_MISSING_TITLE), true);

console.log('The rule, one condition at a time (an allocation lane is made by a second voyage that has an allocation and remarks)');
const ALLOC_LANE_ANCHOR = [leg('ANCHOR1E', 'EMA', { secAlloc: '347', ladenTeu: '100', sectorRemarks: 'TRIST: 347 - 100 = (-247)' })];
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('GAP1E', 'EMA', { ladenTeu: '384' }), leg('GAP1E', 'EMA', { ladenTeu: '220' }), leg('GAP1E', 'EMA', { ladenTeu: '224' })];
  mark(rows);
  t('bookings, no remarks, no allocation, in an allocation lane: that voyage is flagged on all three legs', [flaggedVvds(rows), rows.filter((r) => r.sectorAllocMissing).length], [['GAP1E'], 3]);
  t('  ...the anchor voyage (has remarks and an allocation) is not', rows[0].sectorAllocMissing, false);
}
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('W50E', 'EMA'), leg('W50E', 'EMA'), leg('W50E', 'EMA')];
  mark(rows);
  t('no bookings yet (laden 0 on every leg): not flagged, the blank is the normal state', flaggedVvds(rows), []);
}
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('NOLANE1W', 'PS1', { ladenTeu: '500' }), leg('NOLANE1W', 'PS1', { ladenTeu: '40' })];
  mark(rows);
  t('a lane that never carries an allocation (PS1 here): not flagged however many bookings', flaggedVvds(rows), []);
}
{
  const rows = [leg('ONLY1E', 'EMA', { ladenTeu: '300' })];
  mark(rows);
  t('allocation evidence comes from the data: a lane with no allocation anywhere is not an allocation lane', flaggedVvds(rows), []);
}
{
  const rows = [...ALLOC_LANE_ANCHOR,
    leg('HASALLOC1E', 'EMA', { ladenTeu: '1,072', secAlloc: '700' }), leg('HASALLOC1E', 'EMA', { ladenTeu: '0', secAlloc: '700' })];
  mark(rows);
  t('AL5 / AT3 shape: an allocation on a leg but no remarks is NOT flagged ("No sector allocation" would be false)', flaggedVvds(rows), []);
}
{
  const rows = [...ALLOC_LANE_ANCHOR,
    leg('HALF1E', 'EMA', { ladenTeu: '18', secAlloc: '200' }), leg('HALF1E', 'EMA', { ladenTeu: '0', secAlloc: '' })];
  mark(rows);
  t('an allocation on only one of the voyage\'s legs still clears every leg of it', flaggedVvds(rows), []);
}
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('TXT1E', 'EMA', { ladenTeu: '50', sectorRemarks: 'GRPIR: 115 - 50 = (-65)' }), leg('TXT1E', 'EMA', { ladenTeu: '5', sectorRemarks: '' })];
  mark(rows);
  t('remarks text on any one leg clears the voyage (the feed repeats it per voyage; one leg is enough)', flaggedVvds(rows), []);
}
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('WS1E', 'EMA', { ladenTeu: '50', sectorRemarks: '   ' })];
  mark(rows);
  t('whitespace-only remarks count as no remarks', flaggedVvds(rows), ['WS1E']);
}
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('ONELEG1E', 'EMA', { ladenTeu: '0' }), leg('ONELEG1E', 'EMA', { ladenTeu: '2' }), leg('ONELEG1E', 'EMA', { ladenTeu: '0' })];
  mark(rows);
  t('bookings on one leg only: the voyage is judged as a whole, all three legs are flagged', rows.filter((r) => r.sectorAllocMissing).length, 3);
}
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('COMMA1E', 'EMA', { ladenTeu: '1,113' }), leg('ZERO1E', 'EMA', { ladenTeu: '0' }), leg('BLANK1E', 'EMA', { ladenTeu: '' })];
  mark(rows);
  t('a laden figure with a thousands comma counts as bookings; "0" and blank do not', flaggedVvds(rows), ['COMMA1E']);
}
{
  const rows = [...ALLOC_LANE_ANCHOR,
    { vvd: 'VMS', vessel: 'VMS', lane: 'EMA', secAlloc: '', ladenTeu: '', sectorRemarks: '' },
    { vvd: 'XYZ1E', vessel: 'VMS', lane: 'EMA', secAlloc: '', ladenTeu: '400', sectorRemarks: '' }];
  mark(rows);
  t('VMS rows (by VVD or by vessel name) are never flagged', [flaggedVvds(rows), rows[1].sectorAllocMissing, rows[2].sectorAllocMissing], [[], false, false]);
}
{
  const rows = [{ vvd: 'VMS', vessel: 'VMS', lane: 'EMA', secAlloc: '500', ladenTeu: '', sectorRemarks: '' }, leg('LONE1E', 'EMA', { ladenTeu: '9' })];
  mark(rows);
  t('a VMS row does not make its lane an allocation lane', flaggedVvds(rows), []);
}

console.log('What the rows carry afterwards');
{
  const rows = [...ALLOC_LANE_ANCHOR, leg('KEEP1E', 'EMA', { ladenTeu: '9' })];
  const out = mark(rows);
  t('the same array comes back, edited in place', out === rows, true);
  t('the feed\'s own sectorRemarks is untouched: still blank on a flagged leg', rows[1].sectorRemarks, '');
  t('every row got an explicit true or false', rows.every((r) => r.sectorAllocMissing === true || r.sectorAllocMissing === false), true);
  const again = JSON.stringify(rows);
  mark(rows);
  t('running it twice gives the same result', JSON.stringify(rows), again);
  t('shown text of a flagged leg is the placeholder (what the column filters test)', shownText(rows[1]), PLACEHOLDER);
  t('shown text of an ordinary leg is its remarks', shownText(rows[0]), 'TRIST: 347 - 100 = (-247)');
  t('shown text of a blank, unflagged leg is empty', shownText({ sectorRemarks: '', sectorAllocMissing: false }), '');
  t('a lone "*" stays hidden as before', shownText({ sectorRemarks: '*', sectorAllocMissing: false }), '');
}

console.log('The 2026-10-14 live feed, EMA, in miniature (values copied from the published CSV)');
{
  const rows = [
    ...['USNYC02', 'USORF01', 'USSAV01'].map((y) => leg('CMDT0001E', 'EMA', { secAlloc: '347', ladenTeu: '145', sectorRemarks: 'GRPIR: 115 - 138 = +23* / ITSAL: 20 - 3 = (-17) / TRIST: 347 - 203 = (-144)', yard: y })),
    ...[['USNYC02', '384'], ['USORF01', '220'], ['USSAV01', '224']].map(([y, l]) => leg('CMDT0002E', 'EMA', { secAlloc: '0', ladenTeu: l, yard: y })),
    ...['USNYC02', 'USORF01', 'USSAV01'].map((y) => leg('CMDT0003E', 'EMA', { secAlloc: '0', ladenTeu: '0', yard: y })),
    ...['USNYC02', 'USORF01', 'USSAV01'].map((y) => leg('ZHOT0180E', 'EMA', { secAlloc: '0', ladenTeu: '0', yard: y })),
    { vvd: 'VMS', vessel: 'VMS', lane: 'EMA', secAlloc: '', ladenTeu: '', sectorRemarks: '' },
  ];
  mark(rows);
  t('W43 CMDT0002E (826 TEU, no allocation) is flagged on its three legs; W50 CMDT0003E and W52 ZHOT0180E (no bookings yet) and W36 CMDT0001E are not',
    [flaggedVvds(rows), rows.filter((r) => r.sectorAllocMissing).length], [['CMDT0002E'], 3]);
}

console.log('The committed 8-12 fixture, against an independent reading of its raw columns');
{
  const csv = fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'live_csv_2026-08-12.csv'), 'utf8');
  const wb = XLSX.read(csv, { type: 'string', raw: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
  const num = (v) => parseFloat(String(v || '0').replace(/[,%()]/g, '')) || 0;
  // The app's reading of the same columns (field mapping per DATA_ARCHITECTURE.md; the mapping itself is covered by check_alias_landmines.py).
  const rows = raw.map((r) => ({ vvd: r['Vessel 1st VVD'], vessel: r['Vessel Vessel Name'], lane: r['Vessel 1st Lane'], secAlloc: r['MCT Sector Allocation'], ladenTeu: r['Measures Laden TEU'], sectorRemarks: r['Sector Remarks'] }));
  mark(rows);
  // Independent reference: written from the rule's own words, keyed by raw column names.
  const isVms = (r) => String(r['Vessel 1st VVD']).trim().toUpperCase() === 'VMS' || String(r['Vessel Vessel Name']).trim().toUpperCase() === 'VMS';
  const real = raw.filter((r) => !isVms(r));
  const lanes = new Set(real.filter((r) => num(r['MCT Sector Allocation']) > 0).map((r) => r['Vessel 1st Lane']));
  const byVvd = {};
  real.forEach((r) => {
    const v = (byVvd[String(r['Vessel 1st VVD']).trim()] ||= { lane: r['Vessel 1st Lane'], laden: 0, remarks: false, alloc: false, legs: 0 });
    v.legs++; v.laden += num(r['Measures Laden TEU']);
    if (String(r['Sector Remarks']).trim() !== '') v.remarks = true;
    if (num(r['MCT Sector Allocation']) > 0) v.alloc = true;
  });
  const want = Object.entries(byVvd).filter(([, v]) => lanes.has(v.lane) && v.laden > 0 && !v.remarks && !v.alloc).map(([k]) => k).sort();
  const wantLegs = Object.entries(byVvd).filter(([k]) => want.includes(k)).reduce((n, [, v]) => n + v.legs, 0);
  t('964 rows read', raw.length, 964);
  t('allocation lanes in the fixture are the ten the sector Sheet lists', Array.from(lanes).sort(), ['AL5', 'AT1', 'AT3', 'AT4', 'EC3', 'EMA', 'FP2', 'PN3', 'PS3', 'VSE']);
  t('the six voyages the browser suite pins', want, ['NCFT0033W', 'ONGT0031W', 'HRVT0060W', 'MIYT0021W', 'ONNT0067W', 'OOHT0077W'].sort());
  t('the app flags exactly those voyages', flaggedVvds(rows), want);
  t('...on exactly their 15 legs', [rows.filter((r) => r.sectorAllocMissing).length, wantLegs], [15, 15]);
  t('no VMS row is flagged', rows.filter((r) => r.sectorAllocMissing && String(r.vvd).toUpperCase() === 'VMS').length, 0);
  t('no flagged leg has remarks text or a sector allocation', rows.filter((r) => r.sectorAllocMissing && (String(r.sectorRemarks).trim() !== '' || num(r.secAlloc) > 0)).length, 0);
  t('every row of a never-allocation lane with bookings stays unflagged (PS1, PS4, PS6, PS7, PS8, PN1, WIN ... )', rows.filter((r) => !lanes.has(r.lane) && r.sectorAllocMissing).length, 0);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }

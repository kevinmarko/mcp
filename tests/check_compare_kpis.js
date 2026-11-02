/**
 * Headless check for the Compare tab's KPI tiles and the helpers they share with Analyze.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BROWSER SUITE
 *
 * The browser suite's Compare fixtures (tests/fixtures/compare_{old,new}.xlsx) cover exactly the
 * same sale weeks, which is what their "exactly 3 changes" design needs -- and which makes them
 * blind to the bug this file was written for. Each real export is a ROLLING window: the
 * 2026-08-24 archive date covers W29-W45 and 2026-09-01 covers W30-W46. Compare used to average
 * each side over its own window, which swapped a nearly-full past week for a nearly-empty forward
 * one and hid two-thirds of the real change (Avg Wkly Laden +789 vs +2,252 over the shared weeks;
 * utilization +1.1 vs +3.4 pts). The real 9-day archive in the repo root has exactly that shape,
 * so this runs the app's own code against it.
 *
 * It extracts the REAL source rather than re-implementing it (same approach as
 * check_server_prefs_logic.js): everything between the app's
 * "BEGIN shared capacity helpers" / "END shared capacity helpers" markers, plus the six
 * top-level helpers that block calls, found by parsing the script (not by brace-counting, which
 * breaks on regex literals like /[,%()]/). The expected values come from an INDEPENDENT
 * implementation written below from the definitions the tab states on screen -- a test that
 * reused the code under test for its expectations would pass while both were wrong.
 *
 * Run:  node tests/check_compare_kpis.js      (needs `npm ci` for xlsx and @babel/core)
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

const BEGIN = '// ===== BEGIN shared capacity helpers (Analyze + Compare) =====';
const END = '// ===== END shared capacity helpers (Analyze + Compare) =====';
const b = script.indexOf(BEGIN), e = script.indexOf(END);
if (b === -1 || e === -1 || e < b) {
  console.error('FAILED: could not find the shared-helper markers in the app file.');
  console.error('If they were renamed or moved, update them here -- do NOT delete this check,');
  console.error('and do not let it pass by finding nothing.');
  process.exit(1);
}
const block = script.slice(b, e);

// Top-level declarations the block depends on, located by name in the parsed script.
// parseKnownDate/isOnOrBeforeDayMs: the Analyze-only `today` path (Departed), exercised in step 9.
const DEPS = ['collator', 'compareSaleWeek', 'getPeakUtilPercentNum', 'isNoNaCallVal', 'parseKnownDate', 'isOnOrBeforeDayMs'];
const ast = babel.parseSync(script, { presets: ['@babel/preset-react'], sourceType: 'script', configFile: false, babelrc: false });
const depSrc = DEPS.map((name) => {
  const node = ast.program.body.find((n) =>
    (n.type === 'FunctionDeclaration' && n.id && n.id.name === name) ||
    (n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id && d.id.name === name)));
  if (!node) { console.error(`FAILED: top-level declaration "${name}" not found in the app file.`); process.exit(1); }
  return script.slice(node.start, node.end);
});
const EXPORTS = ['buildSailingBuckets', 'averageGroupWeeks', 'summarizeSailingGroups', 'buildSlicerMatchers',
  'weeksPresentIn', 'countRealVessels', 'pickLadenField', 'compareKpiSnapshots', 'isParodLeg', 'isRealVvd', 'sailingNumVal'];
const code = babel.transformSync(`${depSrc.join('\n')}\n${block}\nreturn { ${EXPORTS.join(', ')} };`, {
  sourceType: 'script', configFile: false, babelrc: false, parserOpts: { allowReturnOutsideFunction: true },
}).code;
const app = new Function(code)();

// ---- Data: the real archive, mapped to the app's field names (source columns per
// DATA_ARCHITECTURE.md's field table; mapping itself is covered by check_alias_landmines.py).
const csv = fs.readFileSync(path.join(REPO, 'Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv'), 'utf8');
const raw = XLSX.utils.sheet_to_json(XLSX.read(csv, { type: 'string', raw: true }).Sheets.Sheet1, { raw: false, defval: '' });
const toRow = (r, i) => ({
  id: i, recordDate: r['Record Date'], subTrade: r['Vessel 1st Sub Trade'], lane: r['Vessel 1st Lane'],
  saleWeek: r['Route Date 1st Sale Week'], vvd: r['Vessel 1st VVD'], vessel: r['Vessel Vessel Name'],
  pol: r['Route Location 1st Yard'], yard: r['Route Location 1st Yard'], pic: r['MCT PIC'], status: r['MCT AP Status'],
  maxLdn: r['MCT Max Laden Update'], curLaden: r['Measures POL Laden TEU'], ladenTeu: r['Measures Laden TEU'],
  peakUtilRaw: r['Measures Peak Overall Utilz'], peakPolUtilzRaw: r['Measures Peak Pol Utilz'],
  etd: r['Route Date Last Port ETD Date'],
});
const all = raw.map(toRow);
const OLD = all.filter((r) => r.recordDate === '2026-08-24');
const NEW = all.filter((r) => r.recordDate === '2026-09-01');

// ---- Independent reference, from the definitions on the Compare tab ("How these numbers are
// calculated"): sailing = (lane, week, VVD); capacity MAX over its legs, laden SUM (PAROD out);
// week = SUM over sailings; weeks with no real vessel dropped; per-lane weekly means summed.
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[,%()]/g, '')); return isFinite(n) ? n : 0; };
const real = (v) => v !== '' && v.toUpperCase() !== 'VMS';
function reference(rows, weeks, ladenKey = 'curLaden') {
  const lanes = new Map();
  for (const r of rows) {
    if (!weeks.has(r.saleWeek)) continue;
    const lane = r.lane || '(blank)', vvd = String(r.vvd || '').trim();
    if (!lanes.has(lane)) lanes.set(lane, new Map());
    const wk = lanes.get(lane);
    if (!wk.has(r.saleWeek)) wk.set(r.saleWeek, new Map());
    const sail = wk.get(r.saleWeek), key = vvd || `uid-${r.id}`;
    if (!sail.has(key)) sail.set(key, { cap: 0, lad: 0, real: real(vvd) });
    const s = sail.get(key);
    s.cap = Math.max(s.cap, num(r.maxLdn));
    if (!String(r.pol || '').trim().toUpperCase().startsWith('PAROD')) s.lad += num(r[ladenKey]);
  }
  let cap = 0, lad = 0;
  for (const wk of lanes.values()) {
    const counted = [...wk.values()].filter((sail) => [...sail.values()].some((s) => s.real));
    if (!counted.length) continue;
    cap += counted.reduce((t, sail) => t + [...sail.values()].reduce((u, s) => u + s.cap, 0), 0) / counted.length;
    lad += counted.reduce((t, sail) => t + [...sail.values()].reduce((u, s) => u + s.lad, 0), 0) / counted.length;
  }
  return { cap, lad, util: cap > 0 ? (lad / cap) * 100 : 0 };
}

let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ''}`); }
};
const close = (a, b2) => Math.abs(a - b2) < 1e-6;

console.log(`\nArchive: 2026-08-24 (${OLD.length} rows) vs 2026-09-01 (${NEW.length} rows)`);
const res = app.compareKpiSnapshots(OLD, NEW);

// 1. The window: both sides over the weeks both files cover -- the code-review finding.
check('Shared window is the 16 weeks both dates cover (W30..W45)',
  res.sharedWeeks.length === 16 && res.sharedWeeks[0] === '2026/W30' && res.sharedWeeks[15] === '2026/W45',
  { n: res.sharedWeeks.length, first: res.sharedWeeks[0], last: res.sharedWeeks[res.sharedWeeks.length - 1] });
check('Weeks left out are reported per side (old only W29, new only W46)',
  JSON.stringify(res.weeksOnlyOld) === '["2026/W29"]' && JSON.stringify(res.weeksOnlyNew) === '["2026/W46"]',
  { weeksOnlyOld: res.weeksOnlyOld, weeksOnlyNew: res.weeksOnlyNew });

// 2. Each side equals the independent reference over those weeks.
const shared = new Set(res.sharedWeeks);
const refOld = reference(OLD, shared), refNew = reference(NEW, shared);
check('Old side equals the independent recompute over the shared weeks (capacity, laden, utilization)',
  close(res.oldSnapshot.capacity, refOld.cap) && close(res.oldSnapshot.laden, refOld.lad) && res.oldSnapshot.utilz === Math.round(refOld.util),
  { app: res.oldSnapshot, ref: refOld });
check('New side equals the independent recompute over the shared weeks (capacity, laden, utilization)',
  close(res.newSnapshot.capacity, refNew.cap) && close(res.newSnapshot.laden, refNew.lad) && res.newSnapshot.utilz === Math.round(refNew.util),
  { app: res.newSnapshot, ref: refNew });
check('Shortfall = Laden - Max Laden on both sides',
  close(res.oldSnapshot.shortfall, res.oldSnapshot.laden - res.oldSnapshot.capacity) &&
  close(res.newSnapshot.shortfall, res.newSnapshot.laden - res.newSnapshot.capacity));

// 3. The window matters on this data: over each file's OWN weeks the laden delta is a third of
// the shared-window delta. Guards against the fix being quietly reverted to own-window averages.
const own = (rows) => reference(rows, app.weeksPresentIn(rows));
const ownDelta = own(NEW).lad - own(OLD).lad, sharedDelta = res.newSnapshot.laden - res.oldSnapshot.laden;
check('Shared-window laden delta differs materially from the own-window delta on this archive (+2,252 vs +789)',
  Math.round(sharedDelta) === 2252 && Math.round(ownDelta) === 789, { sharedDelta: Math.round(sharedDelta), ownDelta: Math.round(ownDelta) });

// 4. Vessels tile: distinct real VVDs in the shared weeks.
const vesselsIn = (rows) => new Set(rows.filter((r) => shared.has(r.saleWeek)).map((r) => String(r.vvd || '').trim()).filter(real)).size;
check('Vessels counts distinct real VVDs in the shared weeks (VMS/blank excluded), both sides',
  res.oldSnapshot.bookingCount === vesselsIn(OLD) && res.newSnapshot.bookingCount === vesselsIn(NEW),
  { app: [res.oldSnapshot.bookingCount, res.newSnapshot.bookingCount], ref: [vesselsIn(OLD), vesselsIn(NEW)] });

// 5. Blank sale weeks never become a week of their own (code review): add rows with a real VVD,
// big numbers and a blank/undefined week to both sides -- nothing may move.
const junk = (base) => [
  { id: 1e6, lane: 'EC3', saleWeek: '', vvd: 'ZZZT0001W', pol: 'USSAV01', maxLdn: '99999', curLaden: '99999' },
  { id: 1e6 + 1, lane: 'EC3', saleWeek: undefined, vvd: 'ZZZT0002W', pol: 'USSAV01', maxLdn: '88888', curLaden: '1' },
  { id: 1e6 + 2, lane: 'EC3', saleWeek: '   ', vvd: 'ZZZT0003W', pol: 'USSAV01', maxLdn: '77777', curLaden: '2' },
].concat(base);
const withBlank = app.compareKpiSnapshots(junk(OLD), junk(NEW));
check('Rows with a blank sale week change nothing (not a week bucket, not in the window)',
  JSON.stringify(withBlank) === JSON.stringify(res));

// 6. Laden column fallback: a file with no POL Laden column reads Measures Laden TEU instead.
const oldNoPol = OLD.map((r) => ({ ...r, curLaden: '' }));
check('pickLadenField: curLaden when present, ladenTeu when the file has no POL Laden column',
  app.pickLadenField(OLD) === 'curLaden' && app.pickLadenField(oldNoPol) === 'ladenTeu');
const fb = app.compareKpiSnapshots(oldNoPol, NEW, { oldLadenField: app.pickLadenField(oldNoPol) });
check('Fallback gives the same old-side numbers (the two columns agree per vessel-week on this archive)',
  close(fb.oldSnapshot.laden, res.oldSnapshot.laden) && fb.oldSnapshot.ladenField === 'ladenTeu',
  { fallback: fb.oldSnapshot.laden, primary: res.oldSnapshot.laden });

// 7. withPeaks:false only skips peak work -- capacity, laden, vessels and buckets are identical.
const inWin = NEW.filter((r) => shared.has(r.saleWeek));
const withP = app.buildSailingBuckets(inWin, { groupKey: 'lane' });
const noP = app.buildSailingBuckets(inWin, { groupKey: 'lane', withPeaks: false });
check('withPeaks:false leaves every bucket identical',
  JSON.stringify(withP.bucketsByKey) === JSON.stringify(noP.bucketsByKey));
check('withPeaks:false skips the peak work (no sailing gets a peak or port peaks)',
  Object.values(noP.sailingsByKey).every((s) => s.peak === null && s.portPeaks.length === 0) &&
  Object.values(withP.sailingsByKey).some((s) => s.peak !== null));

// 8. buildSlicerMatchers vs an independent predicate, over several selections and both policies.
const lower = (s) => String(s || '').toLowerCase();
const indep = (sel, ignoreYard) => (r) =>
  (!sel.subTrades.length || sel.subTrades.includes(r.subTrade)) &&
  (!sel.analysts.length || (!!r.pic && sel.analysts.some((a) => lower(r.pic).includes(lower(a))))) &&
  (!sel.lanes.length || sel.lanes.includes(r.lane)) &&
  (!sel.saleWeeks.length || sel.saleWeeks.includes(r.saleWeek)) &&
  (ignoreYard || !sel.yards.length || sel.yards.includes(r.yard));
const picOf = NEW.find((r) => String(r.pic || '').includes('/'));
const analyst = picOf ? picOf.pic.split('/')[0].trim() : 'x';
const sels = [
  { subTrades: [], analysts: [], lanes: [], saleWeeks: [], yards: [] },
  { subTrades: ['AW'], analysts: [], lanes: ['EC3', 'FLX'], saleWeeks: [], yards: [] },
  { subTrades: [], analysts: [analyst.toUpperCase()], lanes: [], saleWeeks: ['2026/W35'], yards: [] },
  { subTrades: [], analysts: [], lanes: [], saleWeeks: [], yards: ['USSAV01', 'USHOU05'] },
];
let slicerOk = true; const slicerDetail = [];
sels.forEach((sel) => [false, true].forEach((ignoreYard) => {
  const got = NEW.filter(app.buildSlicerMatchers(sel, { ignoreYard }).all).length;
  const want = NEW.filter(indep(sel, ignoreYard)).length;
  if (got !== want) { slicerOk = false; slicerDetail.push({ sel, ignoreYard, got, want }); }
}));
check('buildSlicerMatchers selects exactly the rows an independent predicate does (4 selections x Yard on/off)', slicerOk, slicerDetail);
check('The Yard selection actually narrows when applied and is ignored when ignoreYard (sanity)',
  NEW.filter(app.buildSlicerMatchers(sels[3]).all).length < NEW.length &&
  NEW.filter(app.buildSlicerMatchers(sels[3], { ignoreYard: true }).all).length === NEW.length);

// 9. Analyze's own inputs to the shared block -- `today` (Departed) and the per-port lists --
// which Compare never passes, so without this they would run only in the browser suite.
const today = new Date(2026, 7, 1); // 2026-08-01: this archive holds ETDs on both sides of it
const ana = app.buildSailingBuckets(inWin, { groupKey: 'lane', today, chartEtdField: 'etd' });
const etdMs = (v) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim()); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : null; };
const departedWant = {};
inWin.forEach((r) => {
  const key = `${r.lane || '(blank)'}|${r.saleWeek}|${String(r.vvd || '').trim() || `uid-${r.id}`}`;
  const t = etdMs(r.etd);
  departedWant[key] = departedWant[key] || (t !== null && t <= today.getTime());
});
const departedGot = Object.fromEntries(Object.entries(ana.sailingsByKey).map(([k, s]) => [k, s.departed]));
const departedCount = Object.values(departedGot).filter(Boolean).length;
check('Departed (today path) matches an independent ETD <= today recompute on every sailing, and splits them',
  JSON.stringify(departedGot) === JSON.stringify(departedWant) && departedCount > 0 && departedCount < Object.keys(departedGot).length,
  { departedCount, sailings: Object.keys(departedGot).length });
const portsOk = Object.values(ana.sailingsByKey).every((s) =>
  close(s.ports.reduce((t, p) => t + app.sailingNumVal(p.row, 'curLaden'), 0), s.laden) &&
  s.portPeaks.length === s.ports.filter((p) => p.peak !== null).length);
check('Each sailing\'s port list adds up to its laden, and its non-null port peaks are its portPeaks',
  portsOk && Object.values(ana.sailingsByKey).some((s) => s.ports.length > 1));

console.log(`\n${failed === 0 ? 'COMPARE_KPIS_PASSED' : 'COMPARE_KPIS_FAILED'} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);

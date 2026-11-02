/**
 * Headless check for the five #266 review follow-ups fixed on 2026-10-30 (Kevin: "Yes, fix them"):
 *
 *   1. Peak utilization scale: normalizePeakUtilScale decides fraction vs percent once per file, so a
 *      fraction above 5 (6.0 = 600%) and a percent-scale value at or under 5 (3 = 3%) both read right.
 *   2. Historical slicers: usePruneStaleSelection does nothing while `paused` (a historical date is on
 *      screen), so Back to Live finds the selections still there.
 *   3. Field-visibility preferences: useFieldVisibilityPref writes nothing until its setter is called, so a
 *      later change to a default still reaches people who never touched that setting.
 *   4. Blank Trade: the row builder no longer files a blank Trade under "TPT".
 *   5. Hover tooltip: its state lives in HoverTooltipLayer, not in FlashReportDashboard.
 *
 * Like check_compare_kpis.js it runs the REAL source, found by name in the parsed app script, against
 * expectations written independently here. The hooks run under a tiny fake React (one component, effects
 * run after each render) that is just enough to drive them; it is not a general renderer.
 *
 * Run:  node tests/check_review_followups.js      (needs `npm ci` for xlsx and @babel/core)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const XLSX = require('xlsx');
const { resolveAppHtml } = require('./perf_benchmark.js');

const REPO = path.resolve(__dirname, '..');
const appPath = resolveAppHtml();
console.log(`(main app file: ${path.relative(REPO, appPath)})`);
const html = fs.readFileSync(appPath, 'utf8');
const script = (/<script type="text\/babel">([\s\S]*?)<\/script>/.exec(html) || [])[1];
if (!script) { console.error('FAILED: no <script type="text/babel"> block in the app file.'); process.exit(1); }

const ast = babel.parseSync(script, { presets: ['@babel/preset-react'], sourceType: 'script', configFile: false, babelrc: false });
const NAMES = ['getPeakUtilPercentNum', 'PEAK_UTIL_KEYS', 'normalizePeakUtilScale', 'resolveUserPref',
  'useFieldVisibilityPref', 'usePruneStaleSelection', 'HoverTooltipLayer'];
const src = NAMES.map((name) => {
  const node = ast.program.body.find((n) =>
    (n.type === 'FunctionDeclaration' && n.id && n.id.name === name) ||
    (n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id && d.id.name === name)));
  if (!node) { console.error(`FAILED: top-level declaration "${name}" not found in the app file.`); process.exit(1); }
  return script.slice(node.start, node.end);
});

// ---- A fake React for one component at a time ----
function makeReact() {
  let slots = [];
  let i = 0;
  let pending = [];
  const R = {
    useState(init) {
      const k = i++;
      if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init;
      return [slots[k], (v) => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; }];
    },
    useRef(init) { const k = i++; if (!(k in slots)) slots[k] = { current: init }; return slots[k]; },
    useCallback(fn) { const k = i++; if (!(k in slots)) slots[k] = fn; return slots[k]; },
    useEffect(fn, deps) {
      const k = i++;
      const prev = slots[k];
      if (!prev || !deps || deps.some((d, j) => d !== prev[j])) { slots[k] = deps; pending.push(fn); }
    },
    useImperativeHandle(ref, fn) { i++; ref.current = fn(); },
    forwardRef(fn) { return fn; },
    createElement(type, props, ...children) { return { type, props, children }; },
    // Runs one render of `body`, then the effects it queued; returns body's result.
    render(body) { i = 0; pending = []; const out = body(); pending.forEach((f) => f()); return out; },
    reset() { slots = []; },
  };
  return R;
}

const storage = new Map();
const fakeWindow = { localStorage: {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
} };
const React = makeReact();
const code = babel.transformSync(`const SERVER_PREFS = null;\n${src.join('\n')}\nreturn { ${NAMES.join(', ')} };`, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]], sourceType: 'script', configFile: false, babelrc: false,
  parserOpts: { allowReturnOutsideFunction: true },
}).code;
const app = new Function('React', 'window', 'useState', 'useEffect', 'useRef', 'useCallback', code)(
  React, fakeWindow, React.useState, React.useEffect, React.useRef, React.useCallback);

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`✅ ${name}`); } else { failed++; console.log(`❌ ${name}`); if (detail !== undefined) console.log('   ', JSON.stringify(detail)); }
};
const close = (a, b) => Math.abs(a - b) < 1e-6;

// ---- 1. Peak utilization scale ----
{
  const norm = (vals) => {
    const rows = vals.map((v) => ({ peakUtilRaw: v, peakPolUtilzRaw: v }));
    app.normalizePeakUtilScale(rows);
    return rows.map((r) => app.getPeakUtilPercentNum(r.peakPolUtilzRaw));
  };
  // A fraction file: most values under 1, one above 5. Expected = value x 100 for every one.
  const frac = [0.12, 0.5, 0.93, 1.4, 6.0, 5.0];
  const gotFrac = norm(frac);
  check('A fraction file reads 6.0 as 600% (the per-value <= 5 rule read it as 6%)',
    gotFrac.every((g, k) => close(g, frac[k] * 100)), { frac, gotFrac });
  // A percent-scale file: values already in percent, two of them at or under 5, one double-scaled.
  const pct = [214, 88, 3, 4.5, 61, 21400];
  const wantPct = [214, 88, 3, 4.5, 61, 214];
  const gotPct = norm(pct);
  check('A percent-scale file keeps 3 and 4.5 as 3% and 4.5% (the per-value rule read 300% and 450%) and 21400 as 214%',
    gotPct.every((g, k) => close(g, wantPct[k])), { pct, gotPct, wantPct });
  // Zero, blank and explicit-percent cells are left exactly as they were.
  const rows = [{ peakUtilRaw: 0 }, { peakUtilRaw: '' }, { peakUtilRaw: null }, { peakUtilRaw: '75%' }, { peakUtilRaw: 0.4 }];
  app.normalizePeakUtilScale(rows);
  check('Zero, blank and "75%" cells are untouched; 0.4 becomes "40%"',
    rows[0].peakUtilRaw === 0 && rows[1].peakUtilRaw === '' && rows[2].peakUtilRaw === null && rows[3].peakUtilRaw === '75%' && rows[4].peakUtilRaw === '40%',
    rows.map((r) => r.peakUtilRaw));
  // The real 9-day archive, one file per Record Date: every value is a fraction (max 5.0), so the result
  // must be value x 100 for every row, which is also what the old per-value rule gave (no change on real data).
  const csv = fs.readFileSync(path.join(REPO, 'Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv'), 'utf8');
  const raw = XLSX.utils.sheet_to_json(XLSX.read(csv, { type: 'string', raw: true }).Sheets.Sheet1, { raw: false, defval: '' });
  const byDate = new Map();
  raw.forEach((r) => { const d = r['Record Date']; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(r); });
  let rowsChecked = 0;
  const bad = [];
  byDate.forEach((dayRows, d) => {
    const rowsN = dayRows.map((r) => ({ peakUtilRaw: r['Measures Peak Overall Utilz'], peakPolUtilzRaw: r['Measures Peak Pol Utilz'] }));
    const before = rowsN.map((r) => [app.getPeakUtilPercentNum(r.peakUtilRaw), app.getPeakUtilPercentNum(r.peakPolUtilzRaw)]);
    app.normalizePeakUtilScale(rowsN);
    rowsN.forEach((r, k) => {
      ['peakUtilRaw', 'peakPolUtilzRaw'].forEach((key, j) => {
        const rawVal = key === 'peakUtilRaw' ? dayRows[k]['Measures Peak Overall Utilz'] : dayRows[k]['Measures Peak Pol Utilz'];
        if (String(rawVal).trim() === '') return;
        rowsChecked++;
        const want = parseFloat(rawVal) * 100;
        const got = app.getPeakUtilPercentNum(r[key]);
        if (!close(got, want) || !close(got, before[k][j])) bad.push({ d, key, rawVal, got, want, before: before[k][j] });
      });
    });
  });
  check(`Real archive (${byDate.size} days): every non-blank peak value reads as value x 100, the same as before`,
    rowsChecked > 15000 && bad.length === 0, { rowsChecked, bad: bad.slice(0, 5) });
}

// ---- 2. Historical slicers: pruning pauses ----
{
  React.reset();
  let selected = ['AEX', 'PNW'];
  const setSelected = (fn) => { selected = typeof fn === 'function' ? fn(selected) : fn; };
  const run = (available, paused) => React.render(() => app.usePruneStaleSelection(selected, setSelected, available, paused));
  run(['AEX', 'PNW', 'TP9'], false);
  check('Live rows with both lanes: nothing pruned', selected.join() === 'AEX,PNW', selected);
  run(['AEX', 'TP9'], true); // a historical day without PNW
  check('A historical day without PNW, paused: PNW is kept', selected.join() === 'AEX,PNW', selected);
  run(['AEX', 'PNW', 'TP9'], false); // Back to Live
  check('Back to Live: both lanes still selected', selected.join() === 'AEX,PNW', selected);
  run(['AEX', 'TP9'], false); // a live load that really dropped PNW
  check('Not paused, a live load without PNW still prunes it (the 2026-09-24 behaviour)', selected.join() === 'AEX', selected);
}

// ---- 3. Field-visibility preferences: no write until the user changes it ----
{
  React.reset();
  storage.clear();
  let pair = React.render(() => app.useFieldVisibilityPref('bfTestHidden', true));
  check('First load with nothing stored: the default is used and nothing is written',
    pair[0] === true && !storage.has('bfTestHidden'), { value: pair[0], stored: storage.get('bfTestHidden') });
  pair = React.render(() => app.useFieldVisibilityPref('bfTestHidden', true));
  check('A second render still writes nothing', !storage.has('bfTestHidden'));
  pair[1](false);
  pair = React.render(() => app.useFieldVisibilityPref('bfTestHidden', true));
  check('After the user turns it off: "0" is stored and the value is false',
    pair[0] === false && storage.get('bfTestHidden') === '0', { value: pair[0], stored: storage.get('bfTestHidden') });
  React.reset();
  pair = React.render(() => app.useFieldVisibilityPref('bfTestHidden', true));
  check('Next visit: the stored choice wins over the default', pair[0] === false, { value: pair[0] });
  React.reset();
  storage.clear();
  pair = React.render(() => app.useFieldVisibilityPref('bfTestHidden', false));
  check('Someone who never touched it follows a changed default (now false)', pair[0] === false && !storage.has('bfTestHidden'));
}

// ---- 4. Blank Trade is not filed under TPT ----
{
  const m = /\n\s*trade: getVal\('trade'\)([^,\n]*),/.exec(script);
  check('The row builder reads Trade as getVal(\'trade\') with no fallback',
    !!m && m[1].trim() === '', { found: m ? m[0].trim() : null });
  check('No "|| \'TPT\'" fallback remains anywhere in the app script', !/\|\|\s*'TPT'/.test(script));
}

// ---- 5. Hover tooltip state lives in HoverTooltipLayer ----
{
  React.reset();
  const ref = { current: null };
  let out = React.render(() => app.HoverTooltipLayer({}, ref));
  check('Nothing is drawn until show() is called', out === null && ref.current && typeof ref.current.show === 'function');
  ref.current.show({ text: 'VVD: SROT0045S\nlong remark', rect: { left: 10, right: 110, top: 20, bottom: 40 } });
  out = React.render(() => app.HoverTooltipLayer({}, ref));
  const text = out && out.children && out.children.join('');
  check('show() draws the text', text === 'VVD: SROT0045S\nlong remark', { text });
  ref.current.hide();
  out = React.render(() => app.HoverTooltipLayer({}, ref));
  check('hide() removes it', out === null);
  const dash = ast.program.body.find((n) => n.type === 'FunctionDeclaration' && n.id && n.id.name === 'FlashReportDashboard');
  const dashSrc = dash ? script.slice(dash.start, dash.end) : '';
  check('FlashReportDashboard holds no tooltip state and renders <HoverTooltipLayer ref={hoverTooltipRef} />',
    !!dash && !/setHoverTooltip|\[hoverTooltip,/.test(dashSrc) && dashSrc.includes('<HoverTooltipLayer ref={hoverTooltipRef} />'));
}

console.log(`\nPassed: ${passed} / ${passed + failed}`);
if (failed > 0) { console.error('FAILED'); process.exit(1); }

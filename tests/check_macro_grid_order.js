#!/usr/bin/env node
/**
 * Headless check for D58: every Booking Flash tab shows the macro buttons in the same order.
 *
 * Kevin, 2026-10-14: "I want all the macro buttons to look like proposed... or well in the same order on each of the booking flash tabs"
 * (his screenshot's PROPOSED grid). The grid for a tab is FIELD_TOGGLES filtered to the tab and to the keys the grid shows (not
 * MACRO_GRID_EXCLUDED_KEYS), sorted by MACRO_GRID_ORDER[tab]; any key the order does not name lands at the END of that tab's grid only,
 * which is exactly how POL Booking Flash drifted away from Booking Flash before D58.
 *
 * What this pins, from the app's own source (parsed, not brace-counted, so comments and regex literals cannot fool it):
 *   1. Booking Flash and POL Booking Flash both start with the same ten buttons, in Kevin's PROPOSED order; POL then adds its two
 *      POL-only buttons (VCO Analyst, ETA) as the last row. The expected labels below are typed from the screenshot, not read from the app.
 *   2. Every FIELD_TOGGLES key a tab shows in its grid is named in that tab's order (nothing is left to fall to the end), and the order
 *      names nothing the tab does not have (a stale entry would silently do nothing).
 *   3. The AP Frozen / AP Only pair stays out of the order (it renders as its own literal first row, see ApStatusMacroPair).
 *
 * The browser itself was looked at once with Playwright when D58 was built (both tabs rendered the PROPOSED grid); the rendering code
 * (macroGridToggles in the main component) did not change, only the order data it reads.
 *
 * Run:  node tests/check_macro_grid_order.js      (needs `npm ci` for @babel/core)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
// The "which file is the live app" rule is imported, not pasted -- see AGENTS.md check 1.
const { resolveAppHtml } = require('./perf_benchmark.js');

const REPO = path.resolve(__dirname, '..');
const appPath = resolveAppHtml();
console.log(`(main app file: ${path.relative(REPO, appPath)})`);
const html = fs.readFileSync(appPath, 'utf8');
const script = (/<script type="text\/babel">([\s\S]*?)<\/script>/.exec(html) || [])[1];
if (!script) { console.error('FAILED: no <script type="text/babel"> block in the app file.'); process.exit(1); }

const ast = babel.parseSync(script, { presets: ['@babel/preset-react'], sourceType: 'script', configFile: false, babelrc: false });
const fail = (msg) => { console.error(`FAILED: ${msg}`); process.exit(1); };

// ---- Pull the real data out of the app -------------------------------------------------------------------------------------------------
// A top-level `const NAME = <expr>` evaluated on its own (they only reference each other), so a renamed or moved declaration fails loudly
// here instead of this check passing by finding nothing.
const topLevelConst = (name) => {
  const node = ast.program.body.find((n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id && d.id.name === name));
  if (!node) fail(`top-level declaration "${name}" not found in the app file. If it was renamed or moved, update this check -- do NOT delete it.`);
  return script.slice(node.start, node.end);
};
const { MACRO_GRID_ORDER, MACRO_GRID_EXCLUDED_KEYS } = new Function(
  `${topLevelConst('MACRO_GRID_COMMON_ORDER')}\n${topLevelConst('MACRO_GRID_ORDER')}\n${topLevelConst('MACRO_GRID_EXCLUDED_KEYS')}\n` +
  'return { MACRO_GRID_ORDER, MACRO_GRID_EXCLUDED_KEYS };')();

// FIELD_TOGGLES lives inside the main component, so find it anywhere in the tree; read only the three literal fields we need
// (key, label, tabs) from each descriptor.
const toggles = [];
babel.traverse(ast, {
  VariableDeclarator(p) {
    if (!p.node.id || p.node.id.name !== 'FIELD_TOGGLES' || !p.node.init || p.node.init.type !== 'ArrayExpression') return;
    p.node.init.elements.forEach((el) => {
      const prop = (name) => el.properties.find((x) => x.key && x.key.name === name);
      const key = prop('key'), label = prop('label'), tabs = prop('tabs');
      if (!key || !label || !tabs || key.value.type !== 'StringLiteral' || label.value.type !== 'StringLiteral' || tabs.value.type !== 'ArrayExpression') {
        fail(`a FIELD_TOGGLES descriptor no longer has literal key/label/tabs (line ${el.loc.start.line} of the script); update this check to read it.`);
      }
      toggles.push({ key: key.value.value, label: label.value.value, tabs: tabs.value.elements.map((e) => e.value) });
    });
  },
});
if (toggles.length < 10) fail(`found only ${toggles.length} FIELD_TOGGLES descriptors; the declaration moved or changed shape.`);

// What the app puts in a tab's grid, in order: the descriptors on the tab minus the excluded keys, sorted by the tab's order, unplaced last.
// (A copy of the few lines of macroGridToggles -- the shape this check is about; check 2 below is what makes the sort's tie-break moot.)
const gridFor = (tab) => {
  const order = MACRO_GRID_ORDER[tab] || [];
  const rank = (k) => { const i = order.indexOf(k); return i === -1 ? order.length : i; };
  return toggles
    .filter((f) => f.tabs.includes(tab) && !MACRO_GRID_EXCLUDED_KEYS.includes(f.key))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (rank(a.f.key) - rank(b.f.key)) || (a.i - b.i))
    .map(({ f }) => f);
};

// ---- Assertions ------------------------------------------------------------------------------------------------------------------------
let pass = 0;
const failures = [];
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
}

// Typed from Kevin's screenshot (PROPOSED), left to right, top to bottom, AFTER the AP Frozen | AP Only row.
const COMMON_LABELS = [
  'AP Status', 'Activity',
  'Rotation', 'Trade Breakdown',
  'Voyage Remarks', 'DG Volume',
  'Sector Allocation', 'Operational Issues',
  'BSA', 'Reefer',
];
const POL_ONLY_LABELS = ['VCO Analyst', 'ETA'];

const labels = (tab) => gridFor(tab).map((f) => f.label);
t('Booking Flash grid is the PROPOSED order (after the AP Frozen | AP Only row)', labels('detail'), COMMON_LABELS);
t('POL Booking Flash grid is the PROPOSED order, then VCO Analyst | ETA as the last row', labels('pol_booking'), COMMON_LABELS.concat(POL_ONLY_LABELS));
t('POL Booking Flash starts with exactly the Booking Flash buttons, in the same cells', labels('pol_booking').slice(0, COMMON_LABELS.length), labels('detail'));

for (const tab of ['detail', 'pol_booking']) {
  const shown = toggles.filter((f) => f.tabs.includes(tab) && !MACRO_GRID_EXCLUDED_KEYS.includes(f.key)).map((f) => f.key).sort();
  const placed = (MACRO_GRID_ORDER[tab] || []).slice().sort();
  t(`${tab}: every key its grid shows is named in its order (none left to fall to the end), and the order names nothing the tab lacks`, placed, shown);
  t(`${tab}: no key is named twice in its order`, new Set(MACRO_GRID_ORDER[tab]).size, MACRO_GRID_ORDER[tab].length);
}
t('AP Frozen / AP Only are not in either order (they render as their own first row)',
  ['detail', 'pol_booking'].map((tab) => MACRO_GRID_ORDER[tab].filter((k) => k === 'apFrozen' || k === 'apOnly')), [[], []]);
t('Only these two tabs have a macro grid order', Object.keys(MACRO_GRID_ORDER).sort(), ['detail', 'pol_booking']);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error('MACRO_GRID_ORDER_CHECK_FAILED'); process.exit(1); }
console.log(`MACRO_GRID_ORDER_CHECK_PASSED (${pass} assertions)`);

/**
 * Headless check for the Fields picker's per-column logic (D60).
 *
 * The picker lists every column of both Booking Flash tables, and each column can be hidden one by one.
 * Everything that decides WHAT is shown is pure logic with no DOM, so this file cuts the real source out
 * of the app (the region between the `>>> BEGIN COLUMN PICKER LOGIC` and `<<< END COLUMN PICKER LOGIC`
 * marker lines) and runs it under Node. It runs the shipped code, never a copy of it.
 *
 * Two halves:
 *   1. DRIFT GUARDS against the app text. The table cells are hand-written JSX, and the registry
 *      (COLUMN_REGISTRY_ROWS) is a second list of the same columns. If they disagree, a column is counted but
 *      not drawn (or drawn but not hideable) and the colSpan of every spacer row is silently wrong. So: the
 *      registry's keys must equal, in order, the literal filter-cell call sites of each tab, each key must
 *      carry its `!hiddenCols.<key>` gate at the header, filter and body cell, every group named by the
 *      registry must be a FIELD_TOGGLES entry that is on that tab, and every key a toggle's `filters` list
 *      clears must be a registry column of that group.
 *   2. BEHAVIOUR: visibility rule, column counts (22/48 and 26/51 columns, default and all shown), the picker
 *      rows, what each click does, saved-blob sanitising, the freeze layout and the frozen spacer pieces.
 *
 * Run:  node tests/check_column_picker_logic.js
 *
 * It does NOT prove anything renders: the live regression suite (Column_Picker suite) hides every column of
 * each tab in a real browser and compares the DOM with this registry.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

let appPath;
try { appPath = findCurrentAppHtml(); } catch (err) { console.error(err.message); process.exit(1); }
console.log(`(main app file: ${path.basename(appPath)})`);
const src = fs.readFileSync(appPath, 'utf8');

let passed = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
};
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

// ---------- cut out the region ----------
const BEGIN = '// >>> BEGIN COLUMN PICKER LOGIC';
const END = '// <<< END COLUMN PICKER LOGIC';
const b = src.indexOf(BEGIN);
const e = src.indexOf(END);
if (b === -1 || e === -1 || e < b) {
  console.error('FAILED: could not find the COLUMN PICKER LOGIC region markers in the app file.');
  console.error('If they were renamed or moved, update the markers here -- do NOT delete this check.');
  process.exit(1);
}
const region = src.slice(b, e);
const names = ['COLUMN_REGISTRY_ROWS', 'COLUMN_TABS', 'COLUMN_LIST', 'COLUMN_LEAD_KEYS', 'COLUMN_PIN_KEY', 'NO_HIDDEN_COLS',
  'COLUMN_PICKER_SECTIONS', 'COLUMN_STORAGE_KEY', 'COLUMN_BY_KEY', 'columnsOfGroup', 'columnShownByKey', 'NO_HIDDEN_BY_TAB', 'hiddenByTabIsEmpty', 'columnVisible', 'visibleColumns',
  'countVisibleColumns', 'countVisibleLeadColumns', 'columnsWouldBeEmpty', 'sanitizeHiddenColumns', 'serializeHiddenColumns',
  'hiddenColumnsSignature', 'buildPickerSections', 'applyPickerClick', 'countHiddenPickerRows', 'hiddenColumnFilterKeys',
  'FREEZE_COLUMNS', 'FREEZE_EDGE_CLASS', 'buildFreezeLayout', 'getFreezeLayout', 'buildSpacerPieces'];
let api;
try {
  api = new Function(`${region}\nreturn { ${names.join(', ')} };`)();
} catch (err) {
  console.error('FAILED: the region does not run as plain JS (no JSX, no outside names allowed in it):', err.message);
  process.exit(1);
}
const {
  COLUMN_LIST, COLUMN_LEAD_KEYS, COLUMN_PIN_KEY, NO_HIDDEN_COLS, COLUMN_BY_KEY, columnsOfGroup, columnShownByKey, NO_HIDDEN_BY_TAB, hiddenByTabIsEmpty, columnVisible, countVisibleColumns,
  countVisibleLeadColumns, columnsWouldBeEmpty, sanitizeHiddenColumns, serializeHiddenColumns, hiddenColumnsSignature, buildPickerSections,
  applyPickerClick, countHiddenPickerRows, hiddenColumnFilterKeys, FREEZE_COLUMNS, getFreezeLayout, buildSpacerPieces,
} = api;

// ---------- FIELD_TOGGLES and FIELD_HIDDEN_DEFAULTS, read from the same file ----------
const toggles = [];
src.split('\n').forEach(line => {
  const m = line.match(/^\s*\{ key: '(\w+)', label: '([^']+)', group: '(\w+)', hidden: \w+, set: \w+, tabs: \[([^\]]*)\], filters: \[([^\]]*)\] \},?\s*$/);
  if (m) toggles.push({
    key: m[1], label: m[2], group: m[3],
    tabs: [...m[4].matchAll(/'(\w+)'/g)].map(x => x[1]),
    filters: [...m[5].matchAll(/'(\w+)'/g)].map(x => x[1]),
  });
});
const defStart = src.indexOf('const FIELD_HIDDEN_DEFAULTS = {');
const defEnd = src.indexOf('};', defStart);
const defaults = new Function(`return ${src.slice(defStart + 'const FIELD_HIDDEN_DEFAULTS = '.length, defEnd + 1).replace(/\/\/.*$/gm, '')};`)();

console.log('\nRegistry vs the app text (drift guards)');
ok('read the FIELD_TOGGLES descriptors', toggles.length === 17, `found ${toggles.length}`);
same('Detail has 48 columns', COLUMN_LIST.detail.length, 48);
same('POL has 51 columns', COLUMN_LIST.pol_booking.length, 51);
['detail', 'pol_booking'].forEach(tab => {
  const keys = COLUMN_LIST[tab].map(c => c.key);
  ok(`${tab}: keys are unique`, new Set(keys).size === keys.length);
});
// Only real JSX call sites: a line that starts with `{`, `<th` or the `!hiddenCols` gate of a one-element group wrapper. A block comment can quote a call (the bsa
// descriptor's does), and that is not a column.
const jsxLines = src.split('\n').filter(l => /^\s*(\{|<th|!hiddenCols)/.test(l));
const detailSites = jsxLines.flatMap(l => [...l.matchAll(/renderFilter\('(\w+)'/g)].map(m => m[1]));
const polSites = jsxLines.flatMap(l => [...l.matchAll(/filterCell\('(\w+)'/g)].map(m => m[1]));
same('Detail: registry order = the renderFilter call sites in the table header', COLUMN_LIST.detail.map(c => c.key), detailSites);
same('POL: registry order = the filterCell call sites in the table header', COLUMN_LIST.pol_booking.map(c => c.key), polSites);
const gateCount = (key) => (src.match(new RegExp(`!hiddenCols\\.${key} &&`, 'g')) || []).length;
const missingGates = [];
const allKeys = [...new Set(['detail', 'pol_booking'].flatMap(t => COLUMN_LIST[t].map(c => c.key)))];
allKeys.forEach(k => {
  const tabs = ['detail', 'pol_booking'].filter(t => COLUMN_LIST[t].some(c => c.key === k)).length;
  // filter cell, label cell and body cell, on each tab that renders the key
  if (gateCount(k) < 3 * tabs) missingGates.push(`${k}: ${gateCount(k)} < ${3 * tabs}`);
});
ok('every column key is gated (`!hiddenCols.<key> &&`) at its filter cell, label cell and body cell on each tab', missingGates.length === 0, missingGates.join('; '));
ok('the gate is never written as an object literal inside parentheses (a single-element group wrapper)',
  !/&& \(\s*\n\s*\{!hiddenCols\./.test(src));

console.log('\nRegistry vs FIELD_TOGGLES');
const toggleKeys = new Set(toggles.map(t => t.key));
const badGroups = [];
['detail', 'pol_booking'].forEach(tab => COLUMN_LIST[tab].forEach(c => {
  if (!c.group) return;
  const t = toggles.find(x => x.key === c.group);
  if (!t) badGroups.push(`${tab}.${c.key}: no FIELD_TOGGLES entry '${c.group}'`);
  else if (!t.tabs.includes(tab)) badGroups.push(`${tab}.${c.key}: toggle '${c.group}' is not on ${tab}`);
}));
ok('every column group is a FIELD_TOGGLES entry that lists that tab', badGroups.length === 0, badGroups.join('; '));
const badFilters = [];
toggles.forEach(t => t.filters.forEach(k => {
  const cols = ['detail', 'pol_booking'].flatMap(tab => COLUMN_LIST[tab].filter(c => c.key === k));
  if (!cols.length) badFilters.push(`${t.key}: filters names '${k}', which is not a column`);
  else if (!cols.some(c => c.group === t.key)) badFilters.push(`${t.key}: filters names '${k}', which no tab groups under ${t.key}`);
}));
ok('every key a toggle clears (its `filters` list) is a column of that group', badFilters.length === 0, badFilters.join('; '));
const noColumns = toggles.filter(t => !['detail', 'pol_booking'].some(tab => COLUMN_LIST[tab].some(c => c.group === t.key))).map(t => t.key).sort();
same('only the two AP chip toggles have no column', noColumns, ['apFrozen', 'apOnly']);
ok('POL BSA TEU stays ungated (a documented, deliberate rule: see the bsa descriptor)', COLUMN_LIST.pol_booking.find(c => c.key === 'bsaTeu').group === null);
ok('every ungrouped column has a picker section', ['detail', 'pol_booking'].every(tab => COLUMN_LIST[tab].every(c => c.group || c.section)));
ok('every pinned freeze key maps to a column on its tab', ['detail', 'pol_booking'].every(tab =>
  Object.keys(COLUMN_PIN_KEY[tab]).every(k => COLUMN_LIST[tab].some(c => c.key === k)) && Object.keys(COLUMN_PIN_KEY[tab]).length === FREEZE_COLUMNS.length));
ok('the three lead columns are the first three of both tabs', ['detail', 'pol_booking'].every(tab => COLUMN_LIST[tab].slice(0, 3).map(c => c.key).join() === COLUMN_LEAD_KEYS.join()));

console.log('\nVisibility and counts');
const defGroups = { ...defaults };
same('Detail shows 22 columns by default', countVisibleColumns('detail', defGroups, NO_HIDDEN_COLS), 22);
same('POL shows 26 columns by default', countVisibleColumns('pol_booking', defGroups, NO_HIDDEN_COLS), 26);
const noneHidden = Object.fromEntries(Object.keys(defaults).map(k => [k, false]));
same('Detail shows 48 columns with every group on', countVisibleColumns('detail', noneHidden, NO_HIDDEN_COLS), 48);
same('POL shows 51 columns with every group on', countVisibleColumns('pol_booking', noneHidden, NO_HIDDEN_COLS), 51);
same('hiding Trade removes one column and one lead column', [countVisibleColumns('detail', defGroups, { trade: true }), countVisibleLeadColumns({ trade: true })], [21, 2]);
same('Detail blank-row span = shown columns minus shown lead columns (19 by default)', countVisibleColumns('detail', defGroups, NO_HIDDEN_COLS) - countVisibleLeadColumns(NO_HIDDEN_COLS), 19);
same('"N hidden" is the old count by default: Detail 8, POL 10', [countHiddenPickerRows('detail', toggles, defGroups, NO_HIDDEN_COLS), countHiddenPickerRows('pol_booking', toggles, defGroups, NO_HIDDEN_COLS)], [8, 10]);
same('"N hidden" counts a column hidden inside a shown group once each', countHiddenPickerRows('detail', toggles, { ...defGroups, reefer: false }, { rfrBsaPlugs: true, rfrUtiliz: true }), 9);
same('a tab with no columns (Trade Summary, Compare, ...) counts none hidden and has no picker rows, and does not throw',
  [countHiddenPickerRows('trade_summary', toggles, defGroups, NO_HIDDEN_COLS), countHiddenPickerRows('compare', toggles, noneHidden, { trade: true }), buildPickerSections('sector_summary', toggles, defGroups, NO_HIDDEN_COLS).flatMap(s => s.rows).filter(r => r.children.length || r.kind === 'col').length], [0, 0, 0]);
same('hiding every group and base column of ONE table is detected as empty', columnsWouldBeEmpty(defGroups, { detail: Object.fromEntries(COLUMN_LIST.detail.map(c => [c.key, true])), pol_booking: NO_HIDDEN_COLS }), true);
same('...and the other tab\'s set does not count for it (the same keys hidden on POL alone leave Booking Flash alone)', columnsWouldBeEmpty(defGroups, { detail: NO_HIDDEN_COLS, pol_booking: Object.fromEntries(COLUMN_LIST.detail.map(c => [c.key, true])) }), false);
same('the default state is not empty', columnsWouldBeEmpty(defGroups, NO_HIDDEN_BY_TAB), false);

console.log('\nSaved blob');
const keysOfBlob = (b) => ({ detail: Object.keys(b.detail).sort(), pol_booking: Object.keys(b.pol_booking).sort() });
same('v1 blob ({ keys }) is read as the same keys on BOTH tabs, unknown ones dropped', keysOfBlob(sanitizeHiddenColumns({ v: 1, keys: ['trade', 'nope', 7, 'vvd'] })), { detail: ['trade', 'vvd'], pol_booking: ['trade', 'vvd'] });
same('v1 blob: a key only one tab has is kept on that tab only', keysOfBlob(sanitizeHiddenColumns({ v: 1, keys: ['pic', 'pol'] })), { detail: ['pic'], pol_booking: ['pol'] });
same('v2 blob is per tab, and a key the tab does not have is dropped', keysOfBlob(sanitizeHiddenColumns({ v: 2, detail: ['pic', 'trade', 'pol'], pol_booking: ['pol', 'trade', 'pic'] })), { detail: ['pic', 'trade'], pol_booking: ['pol', 'trade'] });
same('sanitize: a bad blob is nothing hidden', [sanitizeHiddenColumns(null), sanitizeHiddenColumns('x'), sanitizeHiddenColumns({ keys: 'trade' }), sanitizeHiddenColumns({ detail: 'trade' })].map(o => Object.keys(o.detail).length + Object.keys(o.pol_booking).length), [0, 0, 0, 0]);
same('serialize writes v2 and round-trips', [JSON.parse(serializeHiddenColumns({ detail: { vvd: true, trade: true }, pol_booking: { pol: true } })), keysOfBlob(sanitizeHiddenColumns(JSON.parse(serializeHiddenColumns({ detail: { vvd: true, trade: true }, pol_booking: { pol: true } }))))],
  [{ v: 2, detail: ['trade', 'vvd'], pol_booking: ['pol'] }, { detail: ['trade', 'vvd'], pol_booking: ['pol'] }]);
ok('the empty state is one frozen object per tab (one identity for "nothing hidden")', hiddenByTabIsEmpty(NO_HIDDEN_BY_TAB) && NO_HIDDEN_BY_TAB.detail === NO_HIDDEN_COLS && NO_HIDDEN_BY_TAB.pol_booking === NO_HIDDEN_COLS && Object.isFrozen(NO_HIDDEN_COLS));
same('the signature is order-independent', hiddenColumnsSignature({ b: true, a: true }), hiddenColumnsSignature({ a: true, b: true }));
same('hidden columns clear their filter keys, on the tab that hides them', [hiddenColumnFilterKeys('detail', { trade: true, bogus: true, pol: true }), hiddenColumnFilterKeys('pol_booking', { trade: true, bogus: true, pol: true })], [['trade'], ['trade', 'pol']]);
same('the Report Card asks the same registry: a hidden column, a hidden group, and a key the registry does not list',
  [columnShownByKey('pol_booking', 'trade', defGroups, { trade: true }), columnShownByKey('detail', 'trade', defGroups, { trade: true }), columnShownByKey('detail', 'status', { ...defGroups, status: true }, NO_HIDDEN_COLS), columnShownByKey('detail', 'status', { ...defGroups, status: false }, NO_HIDDEN_COLS), columnShownByKey('detail', 'not_a_column', defGroups, NO_HIDDEN_COLS)],
  [false, false, false, true, true]);

console.log('\nPicker rows');
const rowsOf = (tab, g, h) => Object.fromEntries(buildPickerSections(tab, toggles, g, h).map(s => [s.section, s.rows]));
const dSecs = buildPickerSections('detail', toggles, defGroups, NO_HIDDEN_COLS);
same('sections come in a fixed order, empty ones dropped', dSecs.map(s => s.section), ['Identity', 'Capacity', 'Commercial', 'Cargo', 'Operational']);
const flat = (secs) => secs.flatMap(s => s.rows.flatMap(r => [r, ...r.children]));
const detailRows = flat(dSecs);
const reachable = (tab, rows) => rows.flatMap(r => r.kind === 'col' ? [r.key] : (r.applies ? COLUMN_LIST[tab].filter(c => c.group === r.group).map(c => c.key) : [])).sort();
const detailReach = reachable('detail', detailRows.filter(r => r.depth === 0));
same('Detail: every one of its 48 columns is reachable from exactly one top-level row (a column, or the group it belongs to)', detailReach, COLUMN_LIST.detail.map(c => c.key).sort());
ok('Detail: a group with one column is one row with no children (PIC, Status, Operational Issues, AP Status, DG TEU, Voyage Remarks)',
  ['pic', 'status', 'opIssues', 'apStatus', 'dgVolume', 'remarks'].every(g => { const r = detailRows.find(x => x.kind === 'group' && x.group === g); return r && r.children.length === 0; }));
const polRows = flat(buildPickerSections('pol_booking', toggles, defGroups, NO_HIDDEN_COLS));
same('POL: every one of its 51 columns is reachable (a row, a child row or a one-column group row)',
  [...new Set(polRows.flatMap(r => r.kind === 'col' ? [r.key] : (COLUMN_LIST.pol_booking.filter(c => c.group === r.group).map(c => c.key))))].sort(),
  COLUMN_LIST.pol_booking.map(c => c.key).sort());
const reefer = detailRows.find(r => r.kind === 'group' && r.group === 'reefer');
same('Detail Reefer is a parent with its 5 columns', [reefer.children.length, reefer.state], [5, 'off']);
const polBsa = flat(buildPickerSections('pol_booking', toggles, defGroups, NO_HIDDEN_COLS)).find(r => r.kind === 'group' && r.group === 'bsa');
same('POL BSA is one row (the group is its one column)', [polBsa.children.length, polBsa.state], [0, 'off']);
const detailVco = detailRows.find(r => r.group === 'vco');
ok('a toggle this tab does not use stays listed, disabled', detailVco && detailVco.applies === false);
same('a group with some columns shown reads partial', rowsOf('detail', { ...defGroups, reefer: false }, { rfrUtiliz: true }).Cargo.find(r => r.group === 'reefer').state, 'partial');
ok('the AP chip toggles keep their rows', ['apFrozen', 'apOnly'].every(g => detailRows.some(r => r.group === g)));

console.log('\nClicks');
// helpers: hidden state is { detail, pol_booking }; shown columns are read through the same visibility rule the tables use
const B = (d, p) => ({ detail: d || NO_HIDDEN_COLS, pol_booking: p || NO_HIDDEN_COLS });
const hidKeys = (res, tab) => Object.keys(res.hiddenByTab[tab]).sort();
const shownOf = (tab, groups, byTab, group) => COLUMN_LIST[tab].filter(c => (group ? c.group === group : true) && columnVisible(c, groups, byTab[tab])).map(c => c.key);
const applied = (groups, res) => ({ ...groups, ...res.groups });
// ticking one column of a hidden group shows only that column, on this tab
let r1 = applyPickerClick('detail', { kind: 'col', key: 'rfrUtiliz' }, defGroups, NO_HIDDEN_BY_TAB);
const g1 = applied(defGroups, r1);
same('ticking one Reefer column on Booking Flash turns the shared group on', [r1.blocked, r1.groups], [false, { reefer: false }]);
same('...exactly that one column is shown on Booking Flash', shownOf('detail', g1, r1.hiddenByTab, 'reefer'), ['rfrUtiliz']);
same('...and POL still shows no Reefer column (its three are recorded hidden: nothing new appears there)', [shownOf('pol_booking', g1, r1.hiddenByTab, 'reefer'), hidKeys(r1, 'pol_booking')], [[], ['rfrBkgPol', 'rfrMaxLdn', 'rfrUtilizPolRaw']]);
// unticking the last shown column of the group everywhere turns the group off and forgets the inner hides
let r2 = applyPickerClick('detail', { kind: 'col', key: 'rfrUtiliz' }, g1, r1.hiddenByTab);
same('unticking that one again turns the group off (nothing of it shown on either tab) and clears every recorded hide', [r2.groups, hidKeys(r2, 'detail'), hidKeys(r2, 'pol_booking')], [{ reefer: true }, [], []]);
// a group row: show all on this tab only, then hide all on this tab only
let r3 = applyPickerClick('detail', { kind: 'group', group: 'reefer' }, defGroups, NO_HIDDEN_BY_TAB);
const g3 = applied(defGroups, r3);
same('ticking the Reefer row on Booking Flash shows its 5 columns there and none appear on POL', [r3.groups, shownOf('detail', g3, r3.hiddenByTab, 'reefer').length, shownOf('pol_booking', g3, r3.hiddenByTab, 'reefer').length], [{ reefer: false }, 5, 0]);
let r4 = applyPickerClick('detail', { kind: 'group', group: 'reefer' }, { ...defGroups, reefer: false }, B({ rfrUtiliz: true }));
same('a half-filled group row shows all of it on this tab (and forgets the inner hide)', [r4.groups, hidKeys(r4, 'detail'), shownOf('detail', { ...defGroups, reefer: false }, r4.hiddenByTab, 'reefer').length], [{}, [], 5]);
let r5 = applyPickerClick('detail', { kind: 'group', group: 'reefer' }, { ...defGroups, reefer: false }, NO_HIDDEN_BY_TAB);
same('unticking a fully shown group hides it on THIS tab; the shared group stays on because POL still shows its Reefer columns',
  [r5.groups, shownOf('detail', { ...defGroups, reefer: false }, r5.hiddenByTab, 'reefer').length, shownOf('pol_booking', { ...defGroups, reefer: false }, r5.hiddenByTab, 'reefer').length], [{}, 0, 3]);
// a base column hides on this tab only
let r6 = applyPickerClick('detail', { kind: 'col', key: 'trade' }, defGroups, NO_HIDDEN_BY_TAB);
same('unticking Trade on Booking Flash hides only Trade, only there', [r6.groups, hidKeys(r6, 'detail'), hidKeys(r6, 'pol_booking'), r6.hiddenByTab.pol_booking === NO_HIDDEN_COLS], [{}, ['trade'], [], true]);
let r7 = applyPickerClick('detail', { kind: 'col', key: 'trade' }, defGroups, r6.hiddenByTab);
same('ticking Trade again clears it (and the set is the shared empty object again)', [hidKeys(r7, 'detail'), r7.hiddenByTab.detail === NO_HIDDEN_COLS], [[], true]);
let r6p = applyPickerClick('pol_booking', { kind: 'col', key: 'trade' }, defGroups, r6.hiddenByTab);
same('...and hiding it on POL too is a second, separate entry', [hidKeys(r6p, 'detail'), hidKeys(r6p, 'pol_booking')], [['trade'], ['trade']]);
// single-column groups behave as the toggle always did when no other tab has the column
let r8 = applyPickerClick('detail', { kind: 'group', group: 'pic' }, defGroups, NO_HIDDEN_BY_TAB);
same('unticking PIC (a Booking Flash-only group) flips the PIC group toggle (what the old test and the macro button read)', [r8.groups, hidKeys(r8, 'detail')], [{ pic: true }, []]);
// the last column of a table
let hideAllButOne = {};
COLUMN_LIST.detail.forEach(c => { if (c.key !== 'vvd') hideAllButOne[c.key] = true; });
let r9 = applyPickerClick('detail', { kind: 'col', key: 'vvd' }, defGroups, B(hideAllButOne));
ok('hiding the last shown column of a table is blocked', r9.blocked === true);
ok('...on POL as well, and the other tab\'s hides do not count toward it', (() => {
  const h = {}; COLUMN_LIST.pol_booking.forEach(c => { if (c.key !== 'trade') h[c.key] = true; });
  return applyPickerClick('pol_booking', { kind: 'col', key: 'trade' }, defGroups, B(null, h)).blocked === true
    && applyPickerClick('detail', { kind: 'col', key: 'trade' }, defGroups, B(null, h)).blocked === false;
})());
// BSA TEU: grouped on Booking Flash, a plain column on POL; with per-tab sets the two never interfere
let r10 = applyPickerClick('pol_booking', { kind: 'col', key: 'bsaTeu' }, defGroups, NO_HIDDEN_BY_TAB);
same('hiding POL\'s ungated BSA TEU is just a hidden column on POL (no group flips, Booking Flash untouched)', [r10.groups, hidKeys(r10, 'pol_booking'), hidKeys(r10, 'detail')], [{}, ['bsaTeu'], []]);
let r11 = applyPickerClick('detail', { kind: 'col', key: 'bsaWgt' }, { ...defGroups, bsa: false }, B({ bsaTeu: true }));
same('hiding Booking Flash\'s second BSA column leaves the shared BSA group on while POL still shows its BSA Wgt', [r11.groups, hidKeys(r11, 'detail')], [{}, ['bsaTeu', 'bsaWgt']]);
let r12 = applyPickerClick('detail', { kind: 'group', group: 'bsa' }, { ...defGroups, bsa: false }, B({ bsaTeu: true }));
same('a partly hidden BSA group row on Booking Flash shows all of its BSA columns (BSA TEU included: it is that tab\'s own hide)', [r12.groups, hidKeys(r12, 'detail')], [{}, []]);

// The group switches off only when every column of it on EVERY tab is hidden (the macro button then reads "hidden").
(() => {
  const both = (group) => [['detail', columnsOfGroup('detail', group).map(c => c.key)], ['pol_booking', columnsOfGroup('pol_booking', group).map(c => c.key)]];
  const walk = (group) => {
    let g = {}, h = NO_HIDDEN_BY_TAB, offAfter = null, n = 0, stillOnBetween = null;
    both(group).forEach(([tab, keys], ti) => {
      keys.forEach(k => {
        const r = applyPickerClick(tab, { kind: 'col', key: k }, Object.assign({}, noneHidden, g), h);
        g = Object.assign({}, g, r.groups); h = r.hiddenByTab; n++;
        if (g[group] === true && offAfter === null) offAfter = n;
      });
      if (ti === 0 && both(group)[1][1].length) stillOnBetween = g[group] !== true;
    });
    return { total: n, offAfter, stillOnBetween, left: Object.keys(h.detail).length + Object.keys(h.pol_booking).length };
  };
  const reefer = walk('reefer'), activity = walk('activity');
  same('Reefer (5 on Booking Flash, 3 on POL): the group stays on after Booking Flash\'s five are hidden, and switches off at the last POL one, clearing every recorded hide', [reefer.total, reefer.offAfter, reefer.stillOnBetween, reefer.left], [8, 8, true, 0]);
  same('Activity: off exactly at the last column of the second tab', [activity.offAfter === activity.total, activity.stillOnBetween, activity.left], [true, true, 0]);
  const eta = both('eta');
  same('a group only one tab has (ETA, POL only) switches off when that tab\'s last column is hidden', (() => {
    let g = {}, h = NO_HIDDEN_BY_TAB, off = null;
    eta[1][1].forEach((k, i) => { const r = applyPickerClick('pol_booking', { kind: 'col', key: k }, Object.assign({}, noneHidden, g), h); g = Object.assign({}, g, r.groups); h = r.hiddenByTab; if (g.eta === true && off === null) off = i + 1; });
    return [eta[0][1].length, off === eta[1][1].length];
  })(), [0, true]);
})();

// THE rule of D62: a click on one tab's picker never changes what the other tab shows. Every column row and every group row,
// on both tabs, from the default groups and from every group on, with and without something already hidden.
(() => {
  const bad = [];
  const shownKeys = (tab, groups, byTab) => visibleKeysJoined(tab, groups, byTab);
  const visibleKeysJoined = (tab, groups, byTab) => COLUMN_LIST[tab].filter(c => columnVisible(c, groups, byTab[tab])).map(c => c.key).join();
  const starts = [
    ['defaults', defGroups, NO_HIDDEN_BY_TAB],
    ['all groups on', noneHidden, NO_HIDDEN_BY_TAB],
    ['some hidden', noneHidden, { detail: { trade: true, rfrUtiliz: true, inlandAct: true }, pol_booking: { vessel: true, rfrMaxLdn: true, plannedMty: true } }],
    ['reefer on, partly', { ...noneHidden }, { detail: { rfrBsaPlugs: true, rfrBkgPlugs: true, rfrMaxLdn: true, rfrBkgTtl: true }, pol_booking: { rfrBkgPol: true, rfrUtilizPolRaw: true } }],
  ];
  let clicks = 0;
  starts.forEach(([name, groups, byTab]) => ['detail', 'pol_booking'].forEach(tab => {
    const other = tab === 'detail' ? 'pol_booking' : 'detail';
    const actions = [
      ...COLUMN_LIST[tab].map(c => ({ kind: 'col', key: c.key })),
      ...[...new Set(COLUMN_LIST[tab].filter(c => c.group).map(c => c.group))].map(g => ({ kind: 'group', group: g })),
    ];
    actions.forEach(a => {
      const res = applyPickerClick(tab, a, groups, byTab);
      if (res.blocked) return;
      clicks++;
      const after = { ...groups, ...res.groups };
      if (visibleKeysJoined(other, groups, byTab) !== visibleKeysJoined(other, after, res.hiddenByTab)) bad.push(`${name}: ${tab} ${a.kind} ${a.key || a.group} changed ${other}`);
      const badge = (g, h) => countHiddenPickerRows(other, toggles, g, h[other]);
      if (badge(groups, byTab) !== badge(after, res.hiddenByTab)) bad.push(`${name}: ${tab} ${a.kind} ${a.key || a.group} changed ${other}'s "N hidden" badge`);
      if (res.hiddenByTab[other] !== byTab[other] && Object.keys(res.groups).length === 0) bad.push(`${name}: ${tab} ${a.key || a.group} rewrote ${other}'s set without a group change`);
    });
  }));
  ok(`no picker click on one tab changes the columns the other tab shows, or its "N hidden" badge (${clicks} clicks over 4 starting states, both tabs, every column and group row)`, bad.length === 0 && clicks > 400, bad.slice(0, 6).join('; ') + ' clicks=' + clicks);
})();

console.log('\nFreeze layout');
const full = getFreezeLayout('detail', NO_HIDDEN_COLS);
same('all pinned columns shown (D61: Lane, Sales Week, the two dates, VVD, Vessel Name): offsets 0/75/155/235/315/410', FREEZE_COLUMNS.map(([k]) => full.left[k]), [0, 75, 155, 235, 315, 410]);
same('...in that order, and Trade / Sub Trade are not pinned (no style, no offset)', [FREEZE_COLUMNS.map(([k]) => k).join(), full.has.trade, full.has.subTrade, full.style.trade, full.style.subTrade, full.th25.trade, full.th30.subTrade], ['lane,saleWeek,date1,date2,vvd,vessel', undefined, undefined, undefined, undefined, undefined, undefined]);
same('...on both tabs: neither pin map carries trade or subTrade', ['detail', 'pol_booking'].map(t => Object.keys(COLUMN_PIN_KEY[t]).join()), ['lane,saleWeek,cutoff,etd,vvd,vessel', 'lane,saleWeek,coastalEtd,portCut,vvd,vessel']);
ok('...Vessel Name is the last pinned column, natural width, no inline shadow', full.edge === 'vessel' && full.style.vessel.width === undefined && full.style.vessel.boxShadow === undefined);
ok('...fixed widths on the others', full.style.lane.width === 75 && full.style.vvd.width === 95);
ok('...header styles carry the z-index and the POL header background', full.th30.lane.zIndex === 30 && full.th25.lane.zIndex === 25 && full.th25.lane.backgroundColor === '#333333');
const noLane = getFreezeLayout('detail', { lane: true });
same('Lane hidden: the rest slide left (0/80/160/240/335)', ['saleWeek', 'date1', 'date2', 'vvd', 'vessel'].map(k => noLane.left[k]), [0, 80, 160, 240, 335]);
ok('...and there is no style for the hidden column', noLane.style.lane === undefined && !noLane.has.lane);
same('Trade or Sub Trade hidden: the pinned layout does not move (they were never pinned)', [getFreezeLayout('detail', { trade: true, subTrade: true }).left, getFreezeLayout('pol_booking', { trade: true }).left], [full.left, full.left]);
const noVessel = getFreezeLayout('detail', { vessel: true });
ok('Vessel Name hidden: VVD becomes the last pinned column, natural width, with the shadow inline',
  noVessel.edge === 'vvd' && noVessel.style.vvd.width === undefined && noVessel.style.vvd.boxShadow === '2px 0 4px rgba(0,0,0,0.25)' && noVessel.left.vvd === 315);
const noDates = getFreezeLayout('pol_booking', { coastalEtd: true, portCut: true });
ok('POL: the date keys are coastalEtd / portCut (not cutoff / etd)', !noDates.has.date1 && !noDates.has.date2 && noDates.has.saleWeek);
const detailCutoffHidden = getFreezeLayout('detail', { cutoff: true });
ok('Detail: hiding cutoff drops date1', !detailCutoffHidden.has.date1 && detailCutoffHidden.has.date2);
ok('the layout is cached per (tab, hiddenCols object), so a memoized row sees a stable value', getFreezeLayout('detail', NO_HIDDEN_COLS) === full);
ok('nothing pinned shown: no edge, no styles', (() => {
  const all = {}; Object.keys(COLUMN_PIN_KEY.detail).forEach(k => { all[k] = true; });
  const l = getFreezeLayout('detail', all);
  return l.edge === null && Object.keys(l.style).length === 0;
})());

console.log('\nFrozen spacer row');
const spanSum = (pieces) => pieces.reduce((n, p) => n + p.span, 0);
const piecesDefault = buildSpacerPieces(full, { pic: true, status: true });
same('Detail default (PIC and Status shown): Sales Week 1, PIC 1, dates 2, Status 1, VVD + Vessel 2', piecesDefault.map(p => p.span), [1, 1, 2, 1, 2]);
same('...so the rest cell is 19 - 7 = 12 (live default: 1,1,2,1,2,12)', 19 - spanSum(piecesDefault), 12);
ok('...the two-column pinned cells stick at the first column\'s offset (155 and 315), the single ones carry their own style',
  piecesDefault[2].style.left === 155 && piecesDefault[4].style.left === 315 && piecesDefault[0].style === full.style.saleWeek && piecesDefault[1].style === undefined);
same('POL (no PIC, Status shown): 1,2,1,2', buildSpacerPieces(getFreezeLayout('pol_booking', NO_HIDDEN_COLS), { pic: false, status: true }).map(p => p.span), [1, 2, 1, 2]);
same('one date hidden: that pinned run is one cell with its own sticky style',
  (() => { const l = getFreezeLayout('detail', { etd: true }); const p = buildSpacerPieces(l, { pic: false, status: false }); return [p.map(x => x.span), p[1].style === l.style.date1]; })(), [[1, 1, 2], true]);
same('both dates hidden: no dates cell', buildSpacerPieces(getFreezeLayout('detail', { cutoff: true, etd: true }), { pic: true, status: false }).map(p => p.span), [1, 1, 2]);
same('Sales Week and Vessel hidden: a single VVD cell', buildSpacerPieces(getFreezeLayout('detail', { saleWeek: true, vessel: true }), { pic: false, status: false }).map(p => p.span), [2, 1]);
// the invariant that matters: for every single hidden pinned or lead column, the spacer cells fit the row's columns
const invariantBad = [];
['detail', 'pol_booking'].forEach(tab => {
  const pins = Object.keys(COLUMN_PIN_KEY[tab]);
  const states = [{}, ...pins.map(k => ({ [k]: true })), ...COLUMN_LEAD_KEYS.map(k => ({ [k]: true }))];
  [noneHidden, defGroups].forEach(g => states.forEach(h => {
    const hc = Object.keys(h).length ? h : NO_HIDDEN_COLS;
    const lay = getFreezeLayout(tab, hc);
    const blank = countVisibleColumns(tab, g, hc) - countVisibleLeadColumns(hc);
    const midPic = tab === 'detail' && !g.pic && !hc.pic;
    const midStatus = !(tab === 'detail' ? g.status || hc.status : g.polStatus || hc.loadingStatus);
    const pieces = buildSpacerPieces(lay, { pic: midPic, status: midStatus });
    const shownNonLead = COLUMN_LIST[tab].filter(c => !COLUMN_LEAD_KEYS.includes(c.key) && columnVisible(c, g, hc)).length;
    if (spanSum(pieces) > blank || blank !== shownNonLead) invariantBad.push(`${tab} ${JSON.stringify(h)}: pieces ${spanSum(pieces)} blank ${blank}`);
  }));
});
ok('for every single hidden lead or pinned column, on both tabs: the spacer pieces fit the blank row\'s span', invariantBad.length === 0, invariantBad.join('; '));

console.log('');
if (failures.length) {
  console.log(`COLUMN_PICKER_LOGIC_FAILED -- ${failures.length} of ${passed + failures.length} assertions failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log(`COLUMN_PICKER_LOGIC_PASSED (${passed} assertions)`);

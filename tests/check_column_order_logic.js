/**
 * Headless check for the drag-to-reorder column logic of Booking Flash and POL Booking Flash (D67).
 *
 * Users drag a column header to a new place; the order is kept per tab in localStorage. Everything that decides
 * WHAT order is shown is pure logic with no DOM, written in the same region of the app file as the Fields picker
 * (the lines between `>>> BEGIN COLUMN PICKER LOGIC` and `<<< END COLUMN PICKER LOGIC`). Like
 * tests/check_column_picker_logic.js, this file cuts that region out of the app and runs it under Node: it runs the
 * shipped code, never a copy of it.
 *
 * What is pinned:
 *   1. THE UNIT TABLES. A "unit" is what a drag moves: one column, or one of the two three-column blocks (`inland` =
 *      inlandAct / inlandNoAct / inlandTotal, `port` = portAct / portNoAct / portTotal, which have a two-row group
 *      header). Trade, Sub Trade and Lane (COLUMN_LEAD_KEYS) are never movable. COLUMN_UNITS must cover exactly the
 *      non-lead columns of COLUMN_LIST, once each, in the default left-to-right order. This is the drift guard: a
 *      column added to the registry and not to the unit tables fails here.
 *   2. sanitizeColumnOrder: whatever is in storage (garbage, duplicates, unknown keys, a column added later) comes
 *      out as a complete permutation of the tab's unit keys, and the default comes out as the frozen default array
 *      itself (so the app can test `=== DEFAULT_COLUMN_ORDER[tab]` and skip all reordering work).
 *   3. serializeColumnOrder, columnOrderIsDefault, unitKeyOfColumn.
 *   4. moveColumnUnit: the drop. Before / after, to the ends, the no-op cases (which return the SAME array, so React
 *      state does not change), blocks stay contiguous, never mutates.
 *   5. effectiveColumnOrder (Freeze Panes shows the default order) and columnRank (the rank map every row sorts by).
 *
 * Run:  node tests/check_column_order_logic.js
 *
 * It does NOT prove anything renders or that a drag works: the live regression suite (Column_Order suite) drags
 * headers in a real browser and compares the DOM with this logic.
 *
 * The final count is a TRIPWIRE: if a refactor makes a loop silently run zero times, the executed-assertion count
 * drops and this fails even though nothing "failed". Change EXPECTED_ASSERTIONS in the same commit as a deliberate
 * change to the number of checks.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

const EXPECTED_ASSERTIONS = 129;

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
const names = ['COLUMN_LIST', 'COLUMN_LEAD_KEYS', 'COLUMN_UNITS', 'DEFAULT_COLUMN_ORDER', 'COLUMN_ORDER_STORAGE_KEY', 'sanitizeColumnOrder',
  'serializeColumnOrder', 'columnOrderIsDefault', 'unitKeyOfColumn', 'moveColumnUnit', 'effectiveColumnOrder', 'columnRank'];
let api;
try {
  // `typeof` keeps a name that the region does not define yet from throwing a ReferenceError, so the failure below can list every missing one at once.
  api = new Function(`${region}\nreturn { ${names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`)();
} catch (err) {
  console.error('FAILED: the region does not run as plain JS (no JSX, no outside names allowed in it):', err.message);
  process.exit(1);
}
const missing = names.filter(n => api[n] === undefined);
if (missing.length) {
  console.error(`FAILED: the COLUMN PICKER LOGIC region does not define: ${missing.join(', ')}`);
  console.error('These are the D67 column-order contract names (docs/DECISIONS.md, D67). If one was renamed on purpose, rename it here too -- do NOT delete this check.');
  process.exit(1);
}
const {
  COLUMN_LIST, COLUMN_LEAD_KEYS, COLUMN_UNITS, DEFAULT_COLUMN_ORDER, COLUMN_ORDER_STORAGE_KEY, sanitizeColumnOrder,
  serializeColumnOrder, columnOrderIsDefault, unitKeyOfColumn, moveColumnUnit, effectiveColumnOrder, columnRank,
} = api;

const TABS = ['detail', 'pol_booking'];
const BLOCKS = { inland: ['inlandAct', 'inlandNoAct', 'inlandTotal'], port: ['portAct', 'portNoAct', 'portTotal'] };
const D = (tab) => DEFAULT_COLUMN_ORDER[tab];
const reversed = (a) => a.slice().reverse();
// The columns of a tab in the order an order list puts them, worked out from the unit table (not from the code under test).
const expand = (tab, order) => COLUMN_LEAD_KEYS.concat(order.flatMap(u => COLUMN_UNITS[tab].find(x => x.key === u).cols));
const sortedCopy = (a) => a.slice().sort();
const isPermutation = (tab, order) => Array.isArray(order) && order.length === D(tab).length && JSON.stringify(sortedCopy(order)) === JSON.stringify(sortedCopy(D(tab)));
const blob = (detail, pol) => ({ v: 1, detail, pol_booking: pol });
const moved = (a, from, to, after) => { // reference move on a plain array
  const rest = a.filter(x => x !== from);
  rest.splice(rest.indexOf(to) + (after ? 1 : 0), 0, from);
  return rest;
};

console.log('\nUnit tables vs the column registry (drift guards)');
TABS.forEach(tab => {
  const nonLead = COLUMN_LIST[tab].map(c => c.key).filter(k => !COLUMN_LEAD_KEYS.includes(k));
  same(`${tab}: the units cover every non-lead column exactly once, in the registry's order`, COLUMN_UNITS[tab].flatMap(u => u.cols), nonLead);
  const keys = COLUMN_UNITS[tab].map(u => u.key);
  ok(`${tab}: unit keys are unique and none is a lead column`, new Set(keys).size === keys.length && keys.every(k => !COLUMN_LEAD_KEYS.includes(k)));
  ok(`${tab}: every unit other than the two blocks is one column named by its own key`,
    COLUMN_UNITS[tab].filter(u => !BLOCKS[u.key]).every(u => u.cols.length === 1 && u.cols[0] === u.key));
  Object.keys(BLOCKS).forEach(k => {
    const u = COLUMN_UNITS[tab].find(x => x.key === k);
    same(`${tab}: the '${k}' block is its three columns, in their own order`, u && u.cols, BLOCKS[k]);
  });
  ok(`${tab}: exactly the two blocks have more than one column`, COLUMN_UNITS[tab].filter(u => u.cols.length > 1).map(u => u.key).sort().join() === 'inland,port');
  same(`${tab}: DEFAULT_COLUMN_ORDER is the unit keys in table order`, D(tab), keys);
  ok(`${tab}: DEFAULT_COLUMN_ORDER is a frozen array`, Array.isArray(D(tab)) && Object.isFrozen(D(tab)));
});
same('unit counts: Booking Flash 41 (48 columns - 3 lead - 4 folded into the blocks), POL 44 (51 - 3 - 4)', TABS.map(t => COLUMN_UNITS[t].length), [41, 44]);
ok('the lead columns are Trade, Sub Trade and Lane, in that order', COLUMN_LEAD_KEYS.join() === 'trade,subTrade,lane');
ok('the storage key is bookingFlashColumnOrder', COLUMN_ORDER_STORAGE_KEY === 'bookingFlashColumnOrder');

console.log('\nsanitizeColumnOrder: garbage in, defaults out');
[null, undefined, 'detail', 42, true, [], ['vvd'], {}, { v: 1 }, blob('vvd', 7), blob({ a: 1 }, null), blob([1, 2, {}, null], [false, 3])].forEach((raw, i) => {
  const r = sanitizeColumnOrder(raw);
  ok(`garbage #${i} (${JSON.stringify(raw) === undefined ? 'undefined' : JSON.stringify(raw)}) gives the default array itself on both tabs`,
    r && r.detail === D('detail') && r.pol_booking === D('pol_booking'));
});
ok('a saved list that is the default plus a non-string entry is still the default (identity)',
  (() => { const l = D('detail').slice(); l.splice(5, 0, 99); return sanitizeColumnOrder(blob(l, null)).detail === D('detail'); })());

console.log('\nsanitizeColumnOrder: repairs');
{
  const d = D('detail');
  const dup = [d[2], d[0], d[2], d[1], d[0]].concat(d.slice(3));
  same('duplicates are dropped, the first occurrence wins', sanitizeColumnOrder(blob(dup, null)).detail, [d[2], d[0], d[1]].concat(d.slice(3)));
  const unk = ['nope', d[1], '', d[0], 'constructor', 'trade', 'lane'].concat(d.slice(2));
  same('unknown keys are dropped (and so are the lead columns: they are not units)', sanitizeColumnOrder(blob(unk, null)).detail, [d[1], d[0]].concat(d.slice(2)));
  TABS.forEach(tab => {
    const rep = D(tab).flatMap(u => BLOCKS[u] || [u]);
    ok(`${tab}: column keys inside a block ('inlandAct' ...) are not unit keys; with 'inland' and 'port' replaced by their columns both blocks come back at their default places (identity)`,
      sanitizeColumnOrder(tab === 'detail' ? blob(rep, null) : blob(null, rep))[tab] === D(tab));
  });
  const rev = reversed(d);
  const mid = d[10];
  const midSaved = rev.filter(k => k !== mid);
  const midWant = midSaved.slice(); midWant.splice(midWant.indexOf(d[9]) + 1, 0, mid);
  same('a unit missing from the saved list is inserted right after its default predecessor', sanitizeColumnOrder(blob(midSaved, null)).detail, midWant);
  const swapped = d.slice(1); [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  same('a missing FIRST unit goes first', sanitizeColumnOrder(blob(swapped, null)).detail, [d[0]].concat(swapped));
  const two = rev.filter(k => k !== d[5] && k !== d[6]);
  const twoWant = two.slice(); twoWant.splice(twoWant.indexOf(d[4]) + 1, 0, d[5], d[6]);
  same('two neighbouring missing units go back together after the default predecessor of the first', sanitizeColumnOrder(blob(two, null)).detail, twoWant);
  same('an empty saved list on a tab comes out as the default (every unit is "missing")', sanitizeColumnOrder(blob([], null)).detail, d);
  ok('a saved list that is only missing one unit, at its default place, is the default array itself', sanitizeColumnOrder(blob(d.filter(k => k !== d[20]), null)).detail === d);
  const full = reversed(d);
  const r = sanitizeColumnOrder(blob(full, null));
  ok('a full valid reorder round-trips unchanged and is not the default array', JSON.stringify(r.detail) === JSON.stringify(full) && r.detail !== d);
  const input = blob(dup, unk);
  const before = JSON.stringify(input);
  sanitizeColumnOrder(input);
  ok('sanitize never mutates the blob it reads', JSON.stringify(input) === before);
}
// property: whatever junk goes in, a complete permutation comes out, and sanitizing again changes nothing
{
  let seed = 20261026;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const bad = [];
  let runs = 0;
  for (let i = 0; i < 300; i++) {
    const make = (tab) => {
      const pool = D('detail').concat(D('pol_booking'), ['nope', 'trade', 'lane', 'inlandAct', 'portTotal', 7, null, {}, '']);
      const n = Math.floor(rnd() * (D(tab).length + 12));
      return Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)]);
    };
    const raw = blob(make('detail'), make('pol_booking'));
    const once = sanitizeColumnOrder(raw);
    TABS.forEach(tab => {
      runs++;
      if (!isPermutation(tab, once[tab])) bad.push(`#${i} ${tab} not a permutation`);
    });
    const twice = sanitizeColumnOrder(blob(once.detail, once.pol_booking));
    if (JSON.stringify(once) !== JSON.stringify(twice)) bad.push(`#${i} not idempotent`);
  }
  ok(`300 random junk blobs: every result is a complete permutation of the tab's unit keys, and sanitizing twice changes nothing (${runs} tab results)`, bad.length === 0 && runs === 600, bad.slice(0, 4).join('; '));
}

console.log('\nsanitizeColumnOrder: the two tabs are independent');
{
  const dd = D('detail'), pp = D('pol_booking');
  const rd = sanitizeColumnOrder(blob(reversed(dd), null));
  ok('reordering Booking Flash leaves POL at the default array itself', rd.pol_booking === pp && rd.detail !== dd);
  const rp = sanitizeColumnOrder(blob(null, reversed(pp)));
  ok('reordering POL leaves Booking Flash at the default array itself', rp.detail === dd && rp.pol_booking !== pp);
  const both = sanitizeColumnOrder(blob(moved(dd, dd[7], dd[1], false), moved(pp, pp[9], pp[2], true)));
  same('both tabs reordered: each keeps its own list', [both.detail, both.pol_booking], [moved(dd, dd[7], dd[1], false), moved(pp, pp[9], pp[2], true)]);
  ok("a unit only Booking Flash has ('pic') in POL's list is dropped; POL stays the default array itself",
    (() => { const l = pp.slice(); l.splice(4, 0, 'pic'); return sanitizeColumnOrder(blob(null, l)).pol_booking === pp; })());
  ok("a unit only POL has ('pol') in Booking Flash's list is dropped; Booking Flash stays the default array itself",
    (() => { const l = dd.slice(); l.splice(4, 0, 'pol'); return sanitizeColumnOrder(blob(l, null)).detail === dd; })());
  ok('a tab-only unit that is in the other tab\'s default list does not leak into the result',
    !sanitizeColumnOrder(blob(reversed(dd).concat('pol'), reversed(pp).concat('pic'))).detail.includes('pol')
    && !sanitizeColumnOrder(blob(reversed(dd).concat('pol'), reversed(pp).concat('pic'))).pol_booking.includes('pic'));
}

console.log('\nserializeColumnOrder');
{
  const dd = D('detail'), pp = D('pol_booking');
  ok('both tabs default: null (nothing is stored)', serializeColumnOrder({ detail: dd, pol_booking: pp }) === null);
  ok('both tabs default by content (copies, not the frozen arrays): still null', serializeColumnOrder({ detail: dd.slice(), pol_booking: pp.slice() }) === null);
  const san = sanitizeColumnOrder(null);
  ok('the sanitized empty state serializes to null', serializeColumnOrder(san) === null);
  const od = moved(dd, dd[6], dd[0], false);
  const s1 = serializeColumnOrder({ detail: od, pol_booking: pp });
  ok('one tab reordered: a string', typeof s1 === 'string');
  same('...exactly {"v":1,"detail":[...],"pol_booking":[...]} with the other tab written out in default order', s1, JSON.stringify({ v: 1, detail: od, pol_booking: pp }));
  const s2 = serializeColumnOrder({ detail: dd, pol_booking: reversed(pp) });
  same('...and the same when only POL is reordered', JSON.parse(s2), { v: 1, detail: dd, pol_booking: reversed(pp) });
  const orders = [{ detail: od, pol_booking: pp }, { detail: dd, pol_booking: reversed(pp) }, { detail: reversed(dd), pol_booking: moved(pp, pp[3], pp[40], true) }];
  const rt = orders.map(o => sanitizeColumnOrder(JSON.parse(serializeColumnOrder(o))));
  same('serialize -> JSON.parse -> sanitize gives the same lists back (3 orders, both tabs)', rt, orders);
  ok('...and the default tab comes back as the default array itself', rt[0].pol_booking === pp && rt[1].detail === dd);
}

console.log('\ncolumnOrderIsDefault');
{
  const dd = D('detail'), pp = D('pol_booking');
  ok('the default array is default', columnOrderIsDefault('detail', dd) && columnOrderIsDefault('pol_booking', pp));
  ok('a copy with the same content is default', columnOrderIsDefault('detail', dd.slice()) && columnOrderIsDefault('pol_booking', pp.slice()));
  ok('a reversed list is not default', !columnOrderIsDefault('detail', reversed(dd)) && !columnOrderIsDefault('pol_booking', reversed(pp)));
  ok('two neighbouring units swapped is not default', !columnOrderIsDefault('detail', moved(dd, dd[3], dd[4], true)));
  ok("the other tab's default list is not this tab's default", !columnOrderIsDefault('detail', pp) && !columnOrderIsDefault('pol_booking', dd));
}

console.log('\nunitKeyOfColumn');
{
  same('the three Inland columns belong to unit inland', BLOCKS.inland.map(k => unitKeyOfColumn('detail', k)), ['inland', 'inland', 'inland']);
  same('the three Port columns belong to unit port, on POL too', BLOCKS.port.map(k => unitKeyOfColumn('pol_booking', k)), ['port', 'port', 'port']);
  same('a plain column is its own unit, on both tabs', [unitKeyOfColumn('detail', 'vvd'), unitKeyOfColumn('pol_booking', 'vvd')], ['vvd', 'vvd']);
  same('lead columns have no unit', COLUMN_LEAD_KEYS.map(k => unitKeyOfColumn('detail', k)).concat(COLUMN_LEAD_KEYS.map(k => unitKeyOfColumn('pol_booking', k))), [null, null, null, null, null, null]);
  same('an unknown key, a unit key that is not a column, and a non-string have no unit', [unitKeyOfColumn('detail', 'nope'), unitKeyOfColumn('detail', 'inland'), unitKeyOfColumn('detail', undefined)], [null, null, null]);
  same("a column only one tab has is null on the other ('pic' is Booking Flash only, 'pol' is POL only)", [unitKeyOfColumn('detail', 'pic'), unitKeyOfColumn('pol_booking', 'pic'), unitKeyOfColumn('pol_booking', 'pol'), unitKeyOfColumn('detail', 'pol')], ['pic', null, 'pol', null]);
  TABS.forEach(tab => {
    const bad = COLUMN_LIST[tab].filter(c => !COLUMN_LEAD_KEYS.includes(c.key)).filter(c => {
      const u = COLUMN_UNITS[tab].find(x => x.cols.includes(c.key));
      return unitKeyOfColumn(tab, c.key) !== u.key;
    });
    ok(`${tab}: every non-lead column maps to the unit whose cols contain it`, bad.length === 0, bad.map(c => c.key).join());
  });
}

console.log('\nmoveColumnUnit');
{
  const d = D('detail');
  const N = d.length;
  same('drop on the left half (before) of an earlier unit', moveColumnUnit('detail', d, d[5], d[2], false), moved(d, d[5], d[2], false));
  same('drop on the right half (after) of an earlier unit', moveColumnUnit('detail', d, d[5], d[2], true), moved(d, d[5], d[2], true));
  same('drop before a later unit', moveColumnUnit('detail', d, d[2], d[8], false), moved(d, d[2], d[8], false));
  same('drop after a later unit', moveColumnUnit('detail', d, d[2], d[8], true), moved(d, d[2], d[8], true));
  same('to the very front (before the first unit)', moveColumnUnit('detail', d, d[9], d[0], false), [d[9]].concat(d.filter(k => k !== d[9])));
  same('to the very end (after the last unit)', moveColumnUnit('detail', d, d[9], d[N - 1], true), d.filter(k => k !== d[9]).concat(d[9]));
  same('the first unit to the end', moveColumnUnit('detail', d, d[0], d[N - 1], true), d.slice(1).concat(d[0]));
  same('the last unit to the front', moveColumnUnit('detail', d, d[N - 1], d[0], false), [d[N - 1]].concat(d.slice(0, N - 1)));
  same('works on POL with its own units', moveColumnUnit('pol_booking', D('pol_booking'), 'pol', 'vvd', false), moved(D('pol_booking'), 'pol', 'vvd', false));
  // no-ops return the very same array
  ok('unknown from-key: the same array', moveColumnUnit('detail', d, 'nope', d[2], false) === d);
  ok('unknown to-key: the same array', moveColumnUnit('detail', d, d[2], 'nope', true) === d);
  ok('a column key inside a block is not a unit key: the same array', moveColumnUnit('detail', d, 'inlandAct', d[2], false) === d && moveColumnUnit('detail', d, d[2], 'portTotal', true) === d);
  ok('a lead column is not movable and not a drop target: the same array', moveColumnUnit('detail', d, 'trade', d[2], false) === d && moveColumnUnit('detail', d, d[2], 'lane', false) === d);
  ok("a unit the other tab has ('pol' on Booking Flash) is unknown: the same array", moveColumnUnit('detail', d, 'pol', d[2], false) === d);
  ok('from === to, either side: the same array', moveColumnUnit('detail', d, d[4], d[4], false) === d && moveColumnUnit('detail', d, d[4], d[4], true) === d);
  ok("dropping a unit just before the neighbour it already sits before: the same array", moveColumnUnit('detail', d, d[3], d[4], false) === d);
  ok("dropping a unit just after the neighbour it already sits after: the same array", moveColumnUnit('detail', d, d[4], d[3], true) === d);
  ok('the first unit before the second, and the last after the one before it: the same array', moveColumnUnit('detail', d, d[0], d[1], false) === d && moveColumnUnit('detail', d, d[N - 1], d[N - 2], true) === d);
  // same no-op rule on a non-default order, and the result is never a copy of an unchanged list
  const o = moveColumnUnit('detail', d, d[5], d[1], false);
  ok('on a non-default order a no-op drop returns that same array (not a copy, not the default)', moveColumnUnit('detail', o, d[5], d[1], false) === o && moveColumnUnit('detail', o, d[1], d[5], true) === o);
  // a real move is a new array and does not touch the old one
  const snap = JSON.stringify(o);
  const o2 = moveColumnUnit('detail', o, d[0], d[20], true);
  ok('a real move returns a new array and leaves its input as it was', o2 !== o && JSON.stringify(o) === snap && isPermutation('detail', o2));
  ok('the input may be a frozen array (the default): a move does not throw and does not change it', (() => { const before = JSON.stringify(d); moveColumnUnit('detail', d, d[8], d[0], false); return JSON.stringify(d) === before && Object.isFrozen(d); })());
  // coming back to the default order returns the default array itself
  ok('moving a unit away and back lands on the default array itself', moveColumnUnit('detail', o, d[5], d[4], true) === d);
  ok('the same on POL', (() => { const p = D('pol_booking'); const m = moveColumnUnit('pol_booking', p, p[7], p[0], false); return m !== p && moveColumnUnit('pol_booking', m, p[7], p[6], true) === p; })());
  // property: any sequence of drops stays a permutation, and the result survives a save and a load unchanged
  let seed = 1067;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const bad = [];
  TABS.forEach(tab => {
    let cur = D(tab);
    for (let i = 0; i < 400; i++) {
      const keys = D(tab);
      const next = moveColumnUnit(tab, cur, keys[Math.floor(rnd() * keys.length)], keys[Math.floor(rnd() * keys.length)], rnd() < 0.5);
      if (!isPermutation(tab, next)) bad.push(`${tab} step ${i}: not a permutation`);
      const rt = sanitizeColumnOrder(JSON.parse(serializeColumnOrder({ detail: tab === 'detail' ? next : D('detail'), pol_booking: tab === 'pol_booking' ? next : D('pol_booking') }) || 'null'))[tab];
      if (JSON.stringify(rt) !== JSON.stringify(next)) bad.push(`${tab} step ${i}: changed by save + load`);
      if (columnOrderIsDefault(tab, next) && next !== D(tab)) bad.push(`${tab} step ${i}: default content but not the default array`);
      cur = next;
    }
  });
  ok('800 random drops over both tabs: always a permutation, survives save + load, and the default content is always the default array itself', bad.length === 0, bad.slice(0, 4).join('; '));
}

console.log('\nmoveColumnUnit: the Inland and Port blocks move whole');
TABS.forEach(tab => {
  const d = D(tab);
  const n = COLUMN_LEAD_KEYS.length + COLUMN_LIST[tab].length - COLUMN_LEAD_KEYS.length;
  const front = moveColumnUnit(tab, d, 'inland', d[0], false);
  same(`${tab}: Inland to the front: its three columns take ranks 3, 4, 5 in their own order`, BLOCKS.inland.map(k => columnRank(tab, front)[k]), [3, 4, 5]);
  const back = moveColumnUnit(tab, d, 'port', d[d.length - 1], true);
  same(`${tab}: Port to the end: its three columns take the last three ranks`, BLOCKS.port.map(k => columnRank(tab, back)[k]), [n - 3, n - 2, n - 1]);
  const after = moveColumnUnit(tab, d, 'vvd', 'inland', true);
  const r = columnRank(tab, after);
  ok(`${tab}: dropping a plain column after the Inland block puts it right behind Inland Total, never inside the block`,
    r.vvd === r.inlandTotal + 1 && r.inlandNoAct === r.inlandAct + 1 && r.inlandTotal === r.inlandNoAct + 1);
  const into = moveColumnUnit(tab, d, 'inland', 'port', false);
  const ri = columnRank(tab, into);
  ok(`${tab}: Inland dropped before Port: Inland's three, then Port's three, nothing between`, ri.portAct === ri.inlandTotal + 1 && ri.portTotal === ri.portAct + 2);
});

console.log('\neffectiveColumnOrder (Freeze Panes shows the default order)');
{
  const dd = D('detail'), pp = D('pol_booking');
  const o = moveColumnUnit('detail', dd, dd[9], dd[0], false);
  ok('freeze on: the default array itself, whatever the saved order', effectiveColumnOrder('detail', o, true) === dd && effectiveColumnOrder('pol_booking', reversed(pp), true) === pp);
  ok('any truthy freeze value counts', effectiveColumnOrder('detail', o, 1) === dd && effectiveColumnOrder('detail', o, 'on') === dd);
  ok('freeze off: the saved order itself (same identity)', effectiveColumnOrder('detail', o, false) === o);
  ok('a falsy freeze value (undefined, null, 0) leaves the saved order', effectiveColumnOrder('detail', o, undefined) === o && effectiveColumnOrder('detail', o, null) === o && effectiveColumnOrder('detail', o, 0) === o);
  ok('with the default saved, freeze on or off gives the default array', effectiveColumnOrder('detail', dd, false) === dd && effectiveColumnOrder('detail', dd, true) === dd);
  const r = columnRank('detail', effectiveColumnOrder('detail', o, true));
  ok('...so a frozen table ranks every column by its registry position', r.isDefault === true && COLUMN_LIST.detail.every((c, i) => r[c.key] === i));
}

console.log('\ncolumnRank');
TABS.forEach(tab => {
  const dflt = columnRank(tab, D(tab));
  const keys = COLUMN_LIST[tab].map(c => c.key);
  ok(`${tab}: the default rank map is isDefault, and every column's rank is its index in COLUMN_LIST`, dflt.isDefault === true && keys.every((k, i) => dflt[k] === i));
  ok(`${tab}: the default rank map is one stable object`, columnRank(tab, D(tab)) === dflt && columnRank(tab, sanitizeColumnOrder(null)[tab]) === dflt);
  ok(`${tab}: the map covers every column and carries nothing else but isDefault`, Object.keys(dflt).filter(k => k !== 'isDefault').sort().join() === keys.slice().sort().join() && !keys.includes('isDefault'));
  const rev = reversed(D(tab));
  const r = columnRank(tab, rev);
  ok(`${tab}: a reordered map is not isDefault`, r.isDefault === false);
  same(`${tab}: Trade, Sub Trade and Lane keep ranks 0, 1, 2 however the rest is ordered`, COLUMN_LEAD_KEYS.map(k => r[k]), [0, 1, 2]);
  same(`${tab}: the columns sorted by rank are the lead columns, then the units in the saved order with a block's columns in their own order`,
    keys.slice().sort((x, y) => r[x] - r[y]), expand(tab, rev));
  ok(`${tab}: ranks are the integers 0..N-1, each used once`, JSON.stringify(Object.keys(r).filter(k => k !== 'isDefault').map(k => r[k]).sort((x, y) => x - y)) === JSON.stringify(keys.map((_, i) => i)));
  ok(`${tab}: the same order array gives the same rank object (cached), a different one does not`, columnRank(tab, rev) === r && columnRank(tab, reversed(rev)) !== r);
  const other = TABS.find(t => t !== tab);
  const onlyOther = COLUMN_LIST[other].map(c => c.key).filter(k => !keys.includes(k));
  ok(`${tab}: the map has no entry for the other tab's own columns (${onlyOther.slice(0, 3).join(', ')}...)`, onlyOther.length > 0 && onlyOther.every(k => !(k in r)));
});
{
  const reefer = columnRank('detail', D('detail'));
  ok('columns hidden by default (a Reefer column) still have a rank: hiding is not the rank map\'s business', typeof reefer.rfrUtiliz === 'number' && reefer.rfrUtiliz === COLUMN_LIST.detail.findIndex(c => c.key === 'rfrUtiliz'));
  const o = moveColumnUnit('detail', D('detail'), 'rfrUtiliz', 'vvd', false);
  const r = columnRank('detail', o);
  ok('...and a hidden-by-default column can be moved like any other: it sits right before VVD', r.rfrUtiliz === r.vvd - 1);
}

console.log('');
if (failures.length) {
  console.log(`COLUMN_ORDER_LOGIC_FAILED -- ${failures.length} of ${passed + failures.length} assertions failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
if (passed !== EXPECTED_ASSERTIONS) {
  console.log(`COLUMN_ORDER_LOGIC_FAILED -- ${passed} assertions ran, expected ${EXPECTED_ASSERTIONS}. A loop that runs zero times, or a check added or removed without updating EXPECTED_ASSERTIONS, looks like this.`);
  process.exit(1);
}
console.log(`COLUMN_ORDER_LOGIC_PASSED (${passed} assertions)`);

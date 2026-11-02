#!/usr/bin/env node
/**
 * Behaviour checks for the functions in shared/ (the pure logic the app and Apps Script both run).
 *
 * tests/check_shared_sync.js proves the PIPELINE (the generated copies match shared/ and every copy
 * behaves alike); this file proves the BEHAVIOUR of each shared function, one module per function or
 * topic in tests/shared_logic/. The functions come from loadShared() (scripts/lib/shared.js), the exact
 * text that ships, evaluated in a bare vm with no window, document or require.
 *
 * MODULE CONTRACT (tests/shared_logic/NN_topic.js, a two-digit prefix, loaded in filename order):
 *   exports.TESTS = ['diffSailings'];     // the BFShared function names this module tests
 *   exports.COUNT = 12;                   // how many ctx.t() assertions run() makes
 *   exports.run = function (ctx) { ... }; // ctx = { BFShared, history, t, plain }
 * - ctx.t(name, got, want) compares with a canonical JSON form (sorted keys), so objects that come out
 *   of the vm (a different realm) compare correctly; never use assert.deepStrictEqual on them.
 * - ctx.plain(x) turns a vm-realm value into a plain local one (JSON round trip).
 * - ctx.history is tests/lib/history_days.js (the committed 9-day CSV, sliced by Record Date).
 * The runner fails if a module's executed count differs from its COUNT (an assertion was added or
 * silently dropped), if a function exported by BFShared is tested by no module (except the ones
 * check_shared_sync.js already covers), or if a module names a function BFShared does not export.
 *
 * Run:  node tests/check_shared_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadShared } = require('../scripts/lib/shared.js');
const history = require('./lib/history_days.js');

const MODULE_DIR = path.join(__dirname, 'shared_logic');
// Exports whose behaviour tests/check_shared_sync.js already pins (it compares four environments).
const COVERED_ELSEWHERE = new Set(['API_VERSION', 'normalizeVvd', 'isRealVvd']);

// Canonical JSON: object keys sorted, so two structurally equal values compare equal whatever their
// construction order or realm. Negative zero prints as -0 (JSON.stringify and String both print it as
// 0), so a test that promises "+0, never -0" really is checked. ctx.plain loses -0 the same way (a JSON
// round trip), so compare a value whose sign of zero matters without passing it through plain.
function canon(x) {
    if (x === undefined) return 'undefined';
    if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
    if (x && typeof x === 'object') {
        return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`;
    }
    if (Object.is(x, -0)) return '-0';
    if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
    return JSON.stringify(x);
}
// The runner's own guard: canon must tell the two zeros apart, or every -0 assertion is vacuous.
if (canon(-0) === canon(0) || canon([-0]) === canon([0]) || canon({ a: -0 }) === canon({ a: 0 })) {
    console.error('FAILED: canon() does not distinguish -0 from 0');
    process.exit(1);
}
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

const failures = [];
let pass = 0;
let total = 0;

let BFShared;
try {
    BFShared = loadShared();
} catch (e) {
    console.error(`FAILED to load shared logic: ${e.message}`);
    process.exit(1);
}

const files = fs.existsSync(MODULE_DIR)
    ? fs.readdirSync(MODULE_DIR).filter((f) => /^\d{2}_[A-Za-z0-9_.-]+\.js$/.test(f)).sort()
    : [];
if (files.length === 0) failures.push(`no test modules found in tests/shared_logic/ (expected at least 00_meta.js)`);

const tested = new Set();
for (const file of files) {
    let mod;
    try {
        mod = require(path.join(MODULE_DIR, file));
    } catch (e) {
        failures.push(`[${file}] could not be loaded: ${e.message}`);
        continue;
    }
    if (!Array.isArray(mod.TESTS) || !Number.isInteger(mod.COUNT) || typeof mod.run !== 'function') {
        failures.push(`[${file}] must export TESTS (array of names), COUNT (integer) and run(ctx)`);
        continue;
    }
    let executed = 0;
    const t = (name, got, want) => {
        executed++;
        total++;
        const a = canon(got);
        const b = canon(want);
        if (a === b) pass++;
        else failures.push(`[${file}] ${name}\n      got:  ${a}\n      want: ${b}`);
    };
    try {
        mod.run({ BFShared, history, t, plain });
    } catch (e) {
        failures.push(`[${file}] threw: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    }
    if (executed !== mod.COUNT) {
        failures.push(`[${file}] executed ${executed} assertions but declares COUNT = ${mod.COUNT} (an assertion was added or silently dropped; update COUNT deliberately)`);
    }
    for (const name of mod.TESTS) {
        if (typeof BFShared[name] !== 'function') failures.push(`[${file}] TESTS names "${name}", which BFShared does not export as a function`);
        tested.add(name);
    }
}

const exported = Object.keys(BFShared).filter((k) => typeof BFShared[k] === 'function');
const untested = exported.filter((k) => !tested.has(k) && !COVERED_ELSEWHERE.has(k));
if (untested.length) failures.push(`BFShared exports with no behaviour test module (add one under tests/shared_logic/): ${untested.join(', ')}`);

if (failures.length) {
    console.error(`\n${failures.length} FAILED:\n`);
    failures.forEach((f) => console.error(`  - ${f}\n`));
    process.exit(1);
}
console.log(`SHARED_LOGIC_CHECK_PASSED (${pass} assertions in ${files.length} module${files.length === 1 ? '' : 's'})`);

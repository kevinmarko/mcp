#!/usr/bin/env node
/**
 * Headless check for the shared-logic pipeline (decision D1, option a, made 2026-10-05): the files in
 * shared/ are the SOURCE, scripts/sync_shared.js writes them into the app HTML (a marked, generated
 * region) and into apps-script/Shared.gs, and `--check` fails when either is stale -- the same
 * pattern as dist/index.html and scripts/build_deployable.js --check.
 *
 * WHAT IT PROVES
 *   A. The real repo is in sync (`node scripts/sync_shared.js --check`).
 *   B. The same logic behaves identically however it is executed: the region read out of the app
 *      HTML in a bare vm context, that region compiled by @babel/core with preset-env (the build's
 *      path), apps-script/Shared.gs in a bare vm context, and loadShared(). "Bare" means no window,
 *      document, require, module or process, which is what Apps Script and a plain script give it.
 *   C. isRealVvd agrees with the app's former inline expression on every real VVD in the committed
 *      9-day historical CSV (parsed with tests/lib/history_days.js's RFC 4180 parser, never counted
 *      by lines).
 *   D. Lint of shared/: ES5 only, no environment globals, no `slash-star` outside a real block
 *      comment, no backtick in code, LF and a final newline, NN_name.js file names, export names and
 *      private top-level names unique across files, nothing re-declaring BFShared. The lint is itself
 *      tested against deliberately bad snippets (every rule has a self-test), so a lint that silently
 *      stopped catching something fails here. The same slash-star rule is checked on the whole app
 *      script with @babel/parser, because AGENTS.md says it covers the app file too.
 *   E. Copy guard: nothing defined in shared/ is also defined as `function NAME(`, `NAME = function`
 *      or `(const|let|var) NAME = ...` in the app HTML outside the generated region, in
 *      apps-script/*.gs other than Shared.gs, in scripts/ or in tests/ (the hand-copied-logic drift
 *      this pipeline exists to end). The one allowed form is a delegating alias whose line calls
 *      BFShared.NAME(, and the app's aliases are required to be exactly that (ALIASES below).
 *   F. The sync CLI on throwaway repo-shaped copies: passes after a sync, fails (naming the stale
 *      output, writing nothing) after a shared source edit, a hand edit of either output, a deleted
 *      Shared.gs, a missing/duplicated/misplaced marker, or unsafe shared text; is idempotent; leaves
 *      the app HTML outside the region alone; honours --root; refuses a symlinked output; leaves
 *      nothing changed (and no temporary file) when a write fails; aborts rather than overwrite an
 *      app HTML edited while the sync was running.
 *
 * WHY THE COMMENT HAZARD IS TESTED. tests/check_team_features_logic.js strips comments from the app
 * source with /\/\*[\s\S]*?\*\//g BEFORE inspecting code. A slash-star inside a `//` comment (e.g. the
 * words "shared/" followed by an asterisk) opens a fake block comment that swallows real code up to the
 * next close-comment and silently breaks unrelated checks. Section B runs the region through exactly
 * that stripping; section D rejects the sequence at the source.
 *
 * The assertion count is a tripwire (EXPECTED below), like tests/check_resolve_app_html.js.
 *
 * Run:  node tests/check_shared_sync.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const babel = require('@babel/core');
const { pickCurrentAppHtml } = require('../scripts/lib/app_file.js');
const shared = require('../scripts/lib/shared.js');
// The repo's one RFC 4180 reader (tests/check_history_days.js pins it); this check does not carry its own.
const { parseCsv, DEFAULT_CSV } = require('./lib/history_days.js');

const REPO_ROOT = shared.REPO_ROOT;

let pass = 0;
const failures = [];
function t(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) {
        pass++;
    } else {
        failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
    }
}

// The tripwire, like tests/check_resolve_app_html.js: a run that executes a different number of
// assertions than this fails, so an assertion that is silently dropped (or a section that never ran)
// cannot hide behind an all-green result. Every assertion here is aggregate or table-driven, so the
// number does not move when shared/ gains files; it moves only when someone edits this file.
const EXPECTED = 122;

function finish(aborted) {
    if (!aborted && pass + failures.length !== EXPECTED) {
        failures.push(`expected ${EXPECTED} assertions, ran ${pass + failures.length} -- ` +
            'an assertion was added or silently dropped; update EXPECTED deliberately');
    }
    if (failures.length) {
        console.error(`\n${failures.length} FAILED:\n`);
        failures.forEach((f) => console.error(`  - ${f}\n`));
        process.exit(1);
    }
    console.log(`SHARED_SYNC_CHECK_PASSED (${pass} assertions)`);
}
// Everything below runs top to bottom, synchronously. If shared/ is unsafe to ship, loadShared() and
// buildSharedSource() throw by design; report that as the failure instead of dying with a bare stack.
process.on('uncaughtException', (e) => {
    failures.push(`aborted before all assertions ran: ${(e && e.message) || e}`);
    finish(true);
});

// The two marker substrings, written out here on purpose: they are the contract with the app HTML,
// and this file must not depend on scripts/lib/shared.js for them or it could not catch a wrong one.
const BEGIN = '>>> BEGIN GENERATED SHARED LOGIC';
const END = '<<< END GENERATED SHARED LOGIC';

const APP_NAME = pickCurrentAppHtml(fs.readdirSync(REPO_ROOT)).file;
const APP_PATH = path.join(REPO_ROOT, APP_NAME);
const GS_PATH = path.join(REPO_ROOT, 'apps-script', 'Shared.gs');

function runSync(root, args, scriptRoot = root) {
    const r = spawnSync(process.execPath, [path.join(scriptRoot, 'scripts', 'sync_shared.js'), ...args], { encoding: 'utf8', cwd: root });
    return { code: r.status, out: r.stdout, err: r.stderr };
}

// The region between the marker lines, taken straight from the HTML by line (not through the lib).
function regionOf(html) {
    const lines = html.split('\n');
    const b = lines.findIndex((l) => l.includes(BEGIN));
    const e = lines.findIndex((l) => l.includes(END));
    return { region: lines.slice(b + 1, e).join('\n') + '\n', outside: lines.slice(0, b + 1).concat(lines.slice(e)).join('\n'), b, e };
}

function countOf(text, needle) {
    return text.split(needle).length - 1;
}

// ================================================================================================
// A. The real repo is in sync.
// ================================================================================================
const html = fs.readFileSync(APP_PATH, 'utf8');
const realRepoCheck = runSync(REPO_ROOT, ['--check']);
{
    const r = realRepoCheck;
    t('A: `node scripts/sync_shared.js --check` passes on the real repo (run: node scripts/sync_shared.js if not)',
        { code: r.code, out: r.out.trim(), err: r.err.trim() }, { code: 0, out: 'shared logic is in sync', err: '' });
    t('A: the app HTML has exactly one BEGIN and one END marker, and the BEGIN line is first',
        { begin: countOf(html, BEGIN), end: countOf(html, END), ordered: html.indexOf(BEGIN) < html.indexOf(END) },
        { begin: 1, end: 1, ordered: true });
}

// ================================================================================================
// B. The same logic however it is executed.
// ================================================================================================
// Inputs include every shape the roadmap's later slices will feed these (blank cell, placeholder,
// padded, lower case, null/undefined from a missing column, numbers and objects from a bad parse).
const INPUTS = [
    '', ' vms ', 'VMS', 'Vms', 'abc0001w', ' ABC0001W ', '   ', '\u00a0vms\u00a0', 'VMS1',
    null, undefined, 0, 42, true, NaN, {}, [], { toString() { return 'vms'; } },
];
// [normalizeVvd(x), isRealVvd(x)] for each input above, written out by hand.
const EXPECTED_TABLE = [
    ['', false], ['VMS', false], ['VMS', false], ['VMS', false], ['ABC0001W', true], ['ABC0001W', true], ['', false], ['VMS', false], ['VMS1', true],
    ['', false], ['', false], ['0', false], ['42', false], ['TRUE', false], ['NAN', false], ['[OBJECT OBJECT]', false], ['', false], ['VMS', false],
];
// A broken shared file can leave BFShared without these functions; report that as a failed table, not a crash,
// so the lint in section D still runs and names the real cause.
const tableFor = (BF) => {
    try { return JSON.parse(JSON.stringify(INPUTS.map((x) => [BF.normalizeVvd(x), BF.isRealVvd(x)]))); } catch (e) { return `threw: ${e.message}`; }
};
const runBare = (code) => { const ctx = vm.createContext({}); vm.runInContext(code, ctx); return ctx; };

const regionText = regionOf(html).region;
const gsText = fs.readFileSync(GS_PATH, 'utf8');
// The build's path (scripts/build_deployable.js compiles the app script to ES5 with these options).
const compiledRegion = babel.transformSync(regionText, {
    presets: [['@babel/preset-env', { forceAllTransforms: true, modules: false }]],
    sourceType: 'module', compact: false, comments: false, babelrc: false, configFile: false,
    filename: 'shared_region.js', cwd: REPO_ROOT,
}).code;
// The way tests/check_team_features_logic.js reads the app: both comment regexes, in that order.
const strippedRegion = regionText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const loaded = shared.loadShared({ root: REPO_ROOT });
const reference = { keys: Object.keys(loaded).sort(), api: loaded.API_VERSION };
t('B: loadShared() answers the hand-written table for normalizeVvd and isRealVvd', tableFor(loaded), EXPECTED_TABLE);
t('B: loadShared() exports an API_VERSION', typeof reference.api, 'number');

for (const [label, code] of [
    ['the region read from the app HTML', regionText],
    ['that region compiled by @babel/core preset-env (the build\'s path)', compiledRegion],
    ['that region after the comment stripping tests/check_team_features_logic.js applies', strippedRegion],
    ['apps-script/Shared.gs', gsText],
]) {
    let ctx = null;
    let error = null;
    try { ctx = runBare(code); } catch (e) { error = e && e.message; }
    t(`B: ${label} runs in a bare vm context (no window/require/module/process) and defines BFShared`,
        { error, type: ctx && typeof ctx.BFShared }, { error: null, type: 'object' });
    if (!ctx) continue; // already reported by the assertion above
    t(`B: ${label} adds exactly one top-level name`, Object.keys(ctx), ['BFShared']);
    t(`B: ${label} answers the hand-written table`, tableFor(ctx.BFShared), EXPECTED_TABLE);
    t(`B: ${label} exports the same names and API_VERSION as loadShared()`,
        { keys: Object.keys(ctx.BFShared).sort(), api: ctx.BFShared.API_VERSION }, reference);
}
{
    // The whole app script, stripped the way check_team_features_logic.js strips it, must still hold
    // the region's code: a slash-star earlier in the file would swallow it, and one inside it would
    // swallow the app. (Dropping the comments of the entire script is the real hazard.)
    const script = /<script type="text\/babel">([\s\S]*?)<\/script>/.exec(html)[1];
    const stripped = script.replace(/\/\*[\s\S]*?\*\//g, '');
    t('B: the real app script, with block comments stripped the way the team-features check does, still contains the region\'s code',
        { api: stripped.includes('BFShared.API_VERSION = '), wrapper: stripped.includes('return BFShared;') }, { api: true, wrapper: true });
}

// ================================================================================================
// C. isRealVvd vs the app's former inline expression, on the real historical CSV.
// ================================================================================================
// The CSV has 27,312 lines but 8,769 rows (quoted cells hold newlines), so it is parsed, never line-counted.
// The app's former inline test, kept here as the oracle. Only defined for strings that are trimmed.
const appExpression = (vvd) => vvd !== '' && vvd.toUpperCase() !== 'VMS';
{
    const csv = parseCsv(fs.readFileSync(DEFAULT_CSV, 'utf8'));
    const header = csv[0];
    const col = header.indexOf('Vessel 1st VVD');
    const body = csv.slice(1);
    t('C: the historical CSV parses to 8,769 rows, every row as wide as the header, with a "Vessel 1st VVD" column',
        { rows: body.length, ragged: body.filter((r) => r.length !== header.length).length, hasColumn: col >= 0 },
        { rows: 8769, ragged: 0, hasColumn: true });
    const vvds = body.map((r) => String(r[col]).trim());
    const realOf = (v) => { try { return loaded.isRealVvd(v); } catch (e) { return `threw: ${e.message}`; } }; // see tableFor
    const disagree = Array.from(new Set(vvds)).filter((v) => realOf(v) !== appExpression(v));
    t('C: isRealVvd equals the app expression for every distinct trimmed Vessel 1st VVD in the CSV', disagree, []);
    const vms = vvds.filter((v) => v.toUpperCase() === 'VMS').length;
    const real = vvds.filter((v) => realOf(v) === true).length;
    t('C: the comparison is not vacuous: the CSV holds both VMS placeholder rows and real-VVD rows, and the two counts add up',
        { hasVms: vms > 0, hasReal: real > 0, sums: vms + real + vvds.filter((v) => v === '').length === vvds.length }, { hasVms: true, hasReal: true, sums: true });
    const edge = ['', 'VMS', 'vms', 'ABC0001W', 'VMS1', '0'];
    t('C: and on hand-picked trimmed edge cases', edge.filter((v) => realOf(v) !== appExpression(v)), []);
}

// ================================================================================================
// D. Lint of shared/.
// ================================================================================================
const ES5_GLOBALS = new Set([
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'Date', 'JSON', 'RegExp', 'Error', 'EvalError', 'RangeError',
    'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity',
    'undefined', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'arguments',
]);
const BANNER_RE = /^ {2}\/\/ ---- shared\/(.+) ----$/;
// The wrapper's own lines (assembleSharedSource): 1 `var BFShared = (function () {`, 2 'use strict', 3 `var BFShared = {};`.
const WRAPPER_LINES = 3;

/**
 * AST lint of shared source files. Parses the SHIPPED text (so the wrapper's strict mode applies) and
 * returns { problems, exported: [{name, file}], decls, comments }. Locations are file:line of the
 * shared file, found through the banner comment the wrapper puts before each file.
 */
function lintFiles(files) {
    const code = shared.assembleSharedSource(files);
    const lines = code.split('\n');
    const banners = [];
    lines.forEach((l, i) => { const m = BANNER_RE.exec(l); if (m) banners.push({ file: m[1], line: i + 1 }); });
    const where = (line) => {
        let b = null;
        for (const x of banners) if (x.line <= line) b = x;
        return b ? `${b.file}:${line - b.line}` : `(wrapper):${line}`;
    };
    const out = { problems: [], exported: [], decls: [], code, where };
    const add = (node, msg) => out.problems.push(`${where(node.loc.start.line)}: ${msg}`);
    let ast;
    try {
        ast = babel.parseSync(code, { sourceType: 'script', configFile: false, babelrc: false, filename: 'shared.js' });
    } catch (e) {
        out.problems.push(`syntax error: ${String(e.message).split('\n')[0]}`);
        return out;
    }
    out.comments = ast.comments;
    babel.traverse(ast, {
        enter(p) {
            const n = p.node;
            switch (n.type) {
                case 'ArrowFunctionExpression': add(n, 'arrow function'); break;
                case 'TemplateLiteral': case 'TaggedTemplateExpression': add(n, 'template literal'); break;
                case 'ClassDeclaration': case 'ClassExpression': add(n, 'class'); break;
                case 'SpreadElement': add(n, 'spread'); break;
                case 'RestElement': add(n, 'rest element'); break;
                case 'AssignmentPattern': add(n, 'default value (parameter or destructuring)'); break;
                case 'ObjectPattern': case 'ArrayPattern': add(n, 'destructuring'); break;
                case 'ForOfStatement': add(n, 'for-of'); break;
                case 'AwaitExpression': case 'YieldExpression': add(n, 'await/yield'); break;
                case 'OptionalMemberExpression': case 'OptionalCallExpression': case 'ChainExpression': add(n, 'optional chaining'); break;
                case 'MetaProperty': add(n, 'meta property (new.target / import.meta)'); break;
                case 'BigIntLiteral': add(n, 'BigInt literal'); break;
                case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration': case 'ExportAllDeclaration':
                case 'ImportExpression': case 'Import': add(n, 'import/export'); break;
                case 'VariableDeclaration':
                    if (n.kind !== 'var') add(n, `${n.kind} (only var is allowed)`);
                    break;
                case 'FunctionDeclaration': case 'FunctionExpression': case 'ObjectMethod':
                    if (n.generator || n.async) add(n, 'generator/async function');
                    if (n.type === 'ObjectMethod' && n.kind === 'method') add(n, 'method shorthand');
                    break;
                case 'ObjectProperty':
                    if (n.shorthand) add(n, 'shorthand property');
                    if (n.computed) add(n, 'computed property name');
                    break;
                case 'LogicalExpression': if (n.operator === '??') add(n, '?? operator'); break;
                case 'BinaryExpression': if (n.operator === '**') add(n, '** operator'); break;
                case 'NumericLiteral': if (/^0[bBoO]|_/.test(n.extra && n.extra.raw)) add(n, 'ES6 numeric literal'); break;
                case 'StringLiteral': if (/\\u\{/.test(n.extra && n.extra.raw)) add(n, 'code point escape'); break;
                case 'RegExpLiteral': if (/[^gim]/.test(n.flags)) add(n, `regular expression flag(s) beyond g/i/m: ${n.flags}`); break;
                case 'AssignmentExpression':
                    if (['**=', '??=', '||=', '&&='].includes(n.operator)) add(n, `${n.operator} operator`);
                    if (n.left.type === 'Identifier') {
                        if (n.left.name === 'BFShared') add(n, 'BFShared must not be reassigned');
                        else if (!p.scope.getBinding(n.left.name)) add(n, `assignment to undeclared variable "${n.left.name}"`);
                    }
                    if (n.left.type === 'MemberExpression' && n.left.object.type === 'Identifier' && n.left.object.name === 'BFShared') {
                        if (n.left.computed || n.left.property.type !== 'Identifier') add(n, 'assign exports in dot form (BFShared.name = ...) so uniqueness can be checked');
                        else out.exported.push({ name: n.left.property.name, where: where(n.loc.start.line) });
                    }
                    break;
                case 'Identifier':
                    // Any later declaration of the name (var, function, parameter, catch) would shadow or wipe
                    // the wrapper's own BFShared, and with it every export an earlier file made.
                    if (n.name === 'BFShared' && p.isBindingIdentifier() && n.loc.start.line > WRAPPER_LINES) {
                        add(n, 'BFShared is declared again (var, function or parameter); only the wrapper may declare it');
                    }
                    if (p.isReferencedIdentifier() && !p.scope.getBinding(n.name) && !ES5_GLOBALS.has(n.name)) {
                        add(n, `free identifier "${n.name}" (only ES5 built-ins are allowed; no window, document, process, module, require or other host global)`);
                    }
                    break;
                default: break;
            }
        },
    });
    // Private top-level names live in ONE scope shared by every file, so two files declaring the same
    // helper silently overwrite each other just as two files assigning the same export would.
    const wrapperFn = ast.program.body[0].declarations[0].init.callee;
    const seen = new Map();
    wrapperFn.body.body.forEach((stmt) => {
        const ids = stmt.type === 'FunctionDeclaration' ? [stmt.id]
            : stmt.type === 'VariableDeclaration' ? stmt.declarations.map((d) => d.id) : [];
        ids.filter((id) => id && id.type === 'Identifier' && id.loc.start.line > WRAPPER_LINES).forEach((id) => {
            out.decls.push({ name: id.name, where: where(id.loc.start.line) });
            if (seen.has(id.name)) add(id, `"${id.name}" is declared more than once in the shared scope (also at ${seen.get(id.name)})`);
            else seen.set(id.name, where(id.loc.start.line));
        });
    });
    const byName = {};
    out.exported.forEach((e) => { (byName[e.name] = byName[e.name] || []).push(e.where); });
    Object.keys(byName).filter((k) => byName[k].length > 1).forEach((k) => {
        out.problems.push(`export "${k}" is assigned more than once (${byName[k].join(', ')}); a later file would silently overwrite an earlier one`);
    });
    return out;
}

const realFiles = shared.readSharedFiles(REPO_ROOT);
const realLint = lintFiles(realFiles);
{
    t('D: shared/ passes the text-level hazard lint (no slash-star outside a block comment that begins its line, no close-script tag, no CR, final newline)',
        shared.findHazards(realFiles), []);
    t('D: shared/ passes the AST lint: ES5 only (no arrow, template literal, let/const, class, spread, destructuring, import/export), ' +
      'no free identifier other than an ES5 built-in (so no window/document/process/module/require), exports assigned in dot form, ' +
      'export names and private top-level names unique across files', realLint.problems, []);
    t('D: every slash-star in the shipped text is the start of a real block comment (AST cross-check of the text-level rule)',
        (() => {
            const starts = new Set((realLint.comments || []).filter((c) => c.type === 'CommentBlock').map((c) => c.start));
            const bad = [];
            for (let i = realLint.code.indexOf('/*'); i !== -1; i = realLint.code.indexOf('/*', i + 1)) {
                if (!starts.has(i)) bad.push(realLint.where(realLint.code.slice(0, i).split('\n').length));
            }
            return bad;
        })(), []);
    t('D: every shared file is LF only and ends with a newline',
        realFiles.filter((f) => f.text.includes('\r') || !f.text.endsWith('\n')).map((f) => f.name), []);

    // Run the wrapper in an EMPTY context and call every export with no arguments; only a
    // ReferenceError matters (a TypeError from a missing argument is fine). Catches a host global that
    // reached the code through a path the AST lint cannot see (eval, indirect access).
    const ctx = vm.createContext({});
    vm.runInContext(shared.buildSharedSource({ root: REPO_ROOT }), ctx);
    const refErrors = [];
    Object.keys(ctx.BFShared).filter((k) => typeof ctx.BFShared[k] === 'function').forEach((k) => {
        try { ctx.BFShared[k](); } catch (e) { if (e && e.name === 'ReferenceError') refErrors.push(`${k}: ${e.message}`); }
    });
    t('D: calling every exported function with no arguments in an empty vm context raises no ReferenceError', refErrors, []);
    t('D: the exports found by reading the source equal the keys of the evaluated BFShared (nothing is exported by a route the lint cannot see)',
        { static: realLint.exported.map((e) => e.name).sort(), runtime: Object.keys(ctx.BFShared).sort() },
        { static: Object.keys(ctx.BFShared).sort(), runtime: Object.keys(ctx.BFShared).sort() });
    t('D: the empty context really is bare (guards the test itself)',
        vm.runInContext('[typeof window, typeof document, typeof require, typeof module, typeof process].join()', vm.createContext({})),
        'undefined,undefined,undefined,undefined,undefined');
}

// --- The lint is tested against deliberately bad snippets: each must be flagged for the stated reason.
const F = (text, name = 'x.js') => [{ name, text: `${text}\n` }];
const BAD_AST = [
    ['arrow function', F('BFShared.f = function () { return (() => 1)(); };'), /arrow function/],
    ['template literal', F('BFShared.f = function (a) { return `x${a}`; };'), /template literal/],
    ['let', F('BFShared.f = function () { let a = 1; return a; };'), /let \(only var/],
    ['const', F('BFShared.f = function () { const a = 1; return a; };'), /const \(only var/],
    ['class', F('class A {}\nBFShared.f = function () { return A; };'), /class/],
    ['spread', F('BFShared.f = function (a) { return [].concat([...a]); };'), /spread/],
    ['export', F('export var x = 1;'), /syntax error/],
    ['import', F("import x from 'y';"), /syntax error/],
    ['require', F("var fs = require('fs');"), /free identifier "require"/],
    ['window', F('BFShared.f = function () { return window.location; };'), /free identifier "window"/],
    ['document', F('BFShared.f = function () { return document.title; };'), /free identifier "document"/],
    ['process', F('BFShared.f = function () { return process.env; };'), /free identifier "process"/],
    ['module', F('module.exports = BFShared;'), /free identifier "module"/],
    ['Apps Script global', F('BFShared.f = function () { return Logger.log(1); };'), /free identifier "Logger"/],
    ['destructuring', F('var o = {};\nvar { b } = o;'), /destructuring/],
    ['for-of', F('BFShared.f = function (a) { for (var x of a) {} };'), /for-of/],
    ['default parameter', F('BFShared.f = function (a = 1) {};'), /default value/],
    ['method shorthand', F('BFShared.o = { a() {} };'), /method shorthand/],
    ['implicit global assignment', F('BFShared.f = function () { leaked = 1; };'), /undeclared variable "leaked"/],
    ['export in bracket form', F("BFShared['f'] = function () {};"), /dot form/],
    ['the same export from two files', [{ name: 'a.js', text: 'BFShared.dup = 1;\n' }, { name: 'b.js', text: 'BFShared.dup = 2;\n' }], /export "dup" is assigned more than once \(a\.js:1, b\.js:1\)/],
    ['the same private helper from two files', [{ name: 'a.js', text: 'function helper() {}\n' }, { name: 'b.js', text: 'function helper() {}\n' }], /"helper" is declared more than once/],
    ['a later file re-declaring BFShared (var), which would wipe earlier exports', [{ name: 'a.js', text: 'BFShared.kept = 1;\n' }, { name: 'b.js', text: 'var BFShared = {};\n' }], /BFShared is declared again/],
    ['a parameter named BFShared', F('BFShared.f = function (BFShared) { return BFShared; };'), /BFShared is declared again/],
    ['a function declaration named BFShared', F('function BFShared() {}'), /BFShared is declared again/],
];
for (const [label, files, re] of BAD_AST) {
    t(`D: lint self-test, flags ${label}`, lintFiles(files).problems.some((p) => re.test(p)), true);
}
// One table-driven assertion for the remaining rules (each row must be flagged for its stated reason).
const BS = String.fromCharCode(92); // a backslash, spelled out so no escape sequence is needed in this file
const MORE_BAD_AST = [
    ['optional chaining', 'var a = {};\nvar b = a?.b;', /optional chaining/],
    ['?? operator', 'var a = null ?? 1;', /\?\? operator/],
    ['** operator', 'var a = 2 ** 3;', /\*\* operator/],
    ['BigInt literal', 'var a = 1n;', /BigInt/],
    ['async function', 'BFShared.f = async function () {};', /generator\/async/],
    ['generator function', 'function* g() {}', /generator\/async/],
    ['binary literal', 'var a = 0b1;', /ES6 numeric/],
    ['octal literal', 'var a = 0o7;', /ES6 numeric/],
    ['numeric separator', 'var a = 1_000;', /ES6 numeric/],
    ['code point escape', `var a = '${BS}u{1F600}';`, /code point escape/],
    ['regular expression flag y', 'var r = /a/y;', /flag/],
    ['regular expression flag u', 'var r = /a/u;', /flag/],
    ['regular expression flag s', 'var r = /a/s;', /flag/],
    ['new.target', 'BFShared.f = function () { return new.target; };', /meta property/],
    ['rest element', 'BFShared.f = function (...a) { return a; };', /rest element/],
    ['computed property name', "var k = 'a';\nvar o = { [k]: 1 };", /computed property/],
    ['shorthand property', 'var a = 1;\nvar o = { a };', /shorthand property/],
    ['||= operator', 'var a = 0;\na ||= 1;', /\|\|= operator/],
    ['tagged template', 'var t = String.raw`x`;', /template literal/],
    ['dynamic import()', "var p = import('x');", /import\/export/],
];
t('D: lint self-test, every remaining rule (optional chaining, ??, **, BigInt, async/generator, 0b/0o/underscore numerics, code point escape, regex flags y/u/s, new.target, rest, computed/shorthand property, ||=, tagged template, import()) flags its snippet',
    MORE_BAD_AST.filter(([, text, re]) => !lintFiles(F(text)).problems.some((p) => re.test(p))).map(([label]) => label), []);
t('D: lint self-test, a representative ES5 file (block comment, regex with flags, typeof, helper, getter) is clean',
    lintFiles([{ name: 'ok.js', text: [
        '/* a block comment that begins its line */',
        'function helper(a) { return a + 1; }',
        'BFShared.f = function (x) {',
        "    var r = /ab+c/gi; // trailing line comment",
        "    var o = { get v() { return 1; } };",
        "    return typeof x === 'string' ? helper(x.length) + o.v : (x || []).length + (r.test('abbc') ? 1 : 0);",
        '};',
        '',
    ].join('\n') }]).problems, []);

const HAZARDS = [
    ['a slash-star inside a // comment', '// see shared/*.js for details\nvar a = 1;\n', /inside a \/\/ comment/],
    ['a slash-star after code', 'var a = 1; /* trailing */\n', /begins its own line/],
    ['a slash-star inside a string', "var s = '/*';\n", /inside a string literal/],
    ['a slash-star inside a double-quoted string', 'var s = "/*";\n', /inside a string literal/],
    ['a slash-star inside a regular expression literal', `var r = /a${BS}/*/;\n`, /inside a regular expression literal/],
    ['a slash-star after a regular expression holding a quote (the quote must not be read as a string)', `var r = /"/, s = '/*';\n`, /inside a string literal/],
    ['an unterminated block comment', '/* never closed\nvar a = 1;\n', /unterminated/],
    ['a backtick template that hides a newline and a slash-star from line-based rules (R8\'s repro)',
        'BFShared.a = function(){ return `\n/* x\n`; };\n/* y */\nBFShared.b = function(){return 2;};\n', /backtick in code/],
    ['a backtick in plain code', 'var a = `x`;\n', /backtick in code/],
    ['a CR character', 'var a = 1;\r\n', /CR character/],
    ['a missing final newline', 'var a = 1;', /end with a newline/],
    ['a close-script tag', "var s = '</script>';\n", /close-script/],
    ['an HTML comment opener', "var s = '<!--';\n", /HTML comment opener/],
    ['a string line continuation', "var s = 'a\\\nb';\n", /ends with a backslash/],
    ['the BEGIN marker text inside a comment (it would make the HTML marker count 2)', `// quoting ${BEGIN} here\nvar a = 1;\n`, /generated-region marker/],
    ['the END marker text inside a string', `var s = '${END}';\n`, /generated-region marker/],
    ['a BOM at the start of the file', `${String.fromCharCode(0xFEFF)}var a = 1;\n`, /BOM/],
    ['U+2028 (line separator)', `var a = 1; // x${String.fromCharCode(0x2028)}y\n`, /U\+2028/],
    ['U+2029 (paragraph separator)', `var a = 1; // x${String.fromCharCode(0x2029)}y\n`, /U\+2028 or U\+2029/],
];
for (const [label, text, re] of HAZARDS) {
    t(`D: hazard lint self-test, flags ${label}`, shared.findHazards([{ name: 'h.js', text }]).some((p) => re.test(p)), true);
}
t('D: hazard lint self-test, accepts block comments that begin their line, a // comment with no slash-star, divisions, a regular expression with a quote, and backticks inside comments and strings',
    shared.findHazards([{ name: 'ok.js', text: [
        '/* one */',
        '  /*',
        '   * two, with a backtick ` and a quote \' inside',
        '   */',
        '// plain comment about shared/ and a star: * and a backtick `',
        'var a = 2 * 3 / 4;',
        'var b = a / 2 / 1;',
        "var r = /'/.test(\"x\") ? 1 : 0;",
        "var t = 'a backtick ` inside a string';",
        'var u = "another ` one";',
        '',
    ].join('\n') }]), []);

// --- Concatenation: a file that ends without a semicolon must not fuse with the next file's first statement.
{
    const pair = [
        { name: '10_a.js', text: 'BFShared.a = function () { return 1; }\n' },
        { name: '20_b.js', text: '(function () { BFShared.b = 2; })();\n' },
    ];
    const run = (code) => { try { const c = runBare(code); return [typeof c.BFShared.a, c.BFShared.b]; } catch (e) { return ['threw', null]; } };
    t('D: assembleSharedSource separates files with a semicolon line: a file with no final semicolon followed by one that starts with "(" still parses as two statements',
        { assembled: run(shared.assembleSharedSource(pair)), fusedWithoutIt: run(`var BFShared = {};\n${pair[0].text}${pair[1].text}`) },
        { assembled: ['function', 2], fusedWithoutIt: ['threw', null] });
}

// --- shared/ file names and directory contents (readSharedFiles), on throwaway directories.
{
    const dirs = [];
    const makeShared = (entries) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-shared-names-'));
        dirs.push(dir);
        fs.mkdirSync(path.join(dir, 'shared'));
        entries.forEach(([name, kind]) => {
            const full = path.join(dir, 'shared', name);
            if (kind === 'dir') fs.mkdirSync(full);
            else if (kind === 'symlink') fs.symlinkSync(path.join(dir, 'shared', '00_core.js'), full);
            else fs.writeFileSync(full, 'BFShared.x = 1;\n');
        });
        return dir;
    };
    const rejects = (entries) => { try { shared.readSharedFiles(makeShared([['00_core.js'], ...entries])); return null; } catch (e) { return e.message; } };
    let canSymlink = true;
    try { const probe = makeShared([['00_core.js']]); fs.symlinkSync(path.join(probe, 'shared', '00_core.js'), path.join(probe, 'probe_link')); } catch (e) { canSymlink = false; }
    const cases = [
        ['9_x.js', 'file'], ['100_x.js', 'file'], ['x.js', 'file'], ['10_x.test.js', 'file'], ['10_x.spec.js', 'file'],
        ['notes.md', 'file'], ['10_dir', 'dir'], ...(canSymlink ? [['10_link.js', 'symlink']] : []),
    ];
    t('D: readSharedFiles refuses names without a two-digit prefix (9_x, 100_x, x), *.test.js, *.spec.js, a non-.js file, a subdirectory and a symlink, naming each',
        cases.filter(([name, kind]) => { const msg = rejects([[name, kind]]); return !(msg && msg.includes(name) && /entries not allowed/.test(msg)); }).map(([name]) => name), []);
    const ok = makeShared([['00_core.js'], ['10_Mixed-Name.v2.js'], ['.DS_Store'], ['99_last.js']]);
    t('D: readSharedFiles accepts NN_name.js names (letters, digits, _ . -), ignores dotfiles, and orders by name',
        shared.readSharedFiles(ok).map((f) => f.name), ['00_core.js', '10_Mixed-Name.v2.js', '99_last.js']);
    dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
}

// --- The slash-star rule on the app's whole script, with a real parser (AGENTS.md: the rule covers the app file too).
const SLASH_STAR = '/' + '*'; // built from pieces so this file does not contain the sequence literally
function openersReport(code) {
    const ast = require('@babel/parser').parse(code, { sourceType: 'script', plugins: ['jsx'] });
    const starts = new Set(ast.comments.filter((c) => c.type === 'CommentBlock').map((c) => c.start));
    const stray = [];
    let openers = 0;
    for (let i = code.indexOf(SLASH_STAR); i !== -1; i = code.indexOf(SLASH_STAR, i + 1)) {
        openers++;
        if (!starts.has(i)) stray.push(code.slice(0, i).split('\n').length);
    }
    return { openers, blocks: starts.size, stray };
}
{
    const appScript = /<script type="text\/babel">([\s\S]*?)<\/script>/.exec(html)[1];
    const r = openersReport(appScript);
    t('D: every slash-star in the app\'s whole text/babel script (parsed with @babel/parser, jsx) is the start of a real block comment, so the comment-stripping regexes cannot be fooled anywhere in the app',
        { stray: r.stray, nonVacuous: r.openers > 0 && r.openers === r.blocks }, { stray: [], nonVacuous: true });
    const synthetic = `var a = 1; // note ${SLASH_STAR}x\n${SLASH_STAR} a real block */\nvar s = "${SLASH_STAR}";\nvar jsx = <b>{1}</b>;\n`;
    t('D: the app-script rule\'s own logic flags a slash-star inside a // comment and inside a string, and not a real block comment',
        openersReport(synthetic), { openers: 3, blocks: 1, stray: [1, 3] });
}

// ================================================================================================
// E. Copy guard: nothing defined in shared/ is also defined elsewhere.
// ================================================================================================
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Three ways to define NAME again: `function NAME(`, `NAME = function`, and a declaration
// `(const|let|var) NAME = ...` on a line that does not call BFShared.NAME( -- so an inline arrow with the
// old body is caught, while the delegating alias (`const NAME = (v) => BFShared.NAME(v);`, kept on one
// line) is the one allowed form.
const definesName = (text, name) => new RegExp(`\\bfunction\\s+${escapeRe(name)}\\s*\\(`).test(text)
    || new RegExp(`(?<![\\w$])${escapeRe(name)}\\s*=\\s*function\\b`).test(text)
    || text.split('\n').some((line) => new RegExp(`\\b(?:const|let|var)\\s+${escapeRe(name)}\\s*=`).test(line) && !line.includes(`BFShared.${name}(`));
// The app's own names for shared functions: { alias in the app, function in BFShared }. Each definition of
// the alias in the app (outside the generated region) must call straight through to BFShared.<function>(.
// Slices that move another helper into shared/ add a row here when the app keeps a local alias for it.
const ALIASES = [{ alias: 'isRealVvd', shared: 'isRealVvd' }];
function aliasProblems(appText, aliases) {
    const problems = [];
    for (const { alias, shared: fn } of aliases) {
        const re = new RegExp(`\\b(?:const|let|var)\\s+${escapeRe(alias)}\\s*=`);
        const defs = appText.split('\n').filter((line) => re.test(line));
        if (defs.length === 0) problems.push(`${alias}: no definition found in the app`);
        defs.filter((line) => !line.includes(`BFShared.${fn}(`)).forEach((line) => problems.push(`${alias}: definition does not call BFShared.${fn}( -- ${line.trim()}`));
    }
    return problems;
}
// Code files only. (The harnesses write throwaway copies of the whole app, html, under tests/ while a
// browser suite runs, and a crashed run can leave one behind; the app itself is scanned separately,
// minus its generated region, above.)
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'fixtures', '.git']);
const SCAN_EXT = /\.(js|mjs|cjs|ts|py|sh|gs)$/;
function collect(dirRel) {
    const abs = path.join(REPO_ROOT, dirRel);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((ent) => {
        const rel = `${dirRel}/${ent.name}`;
        if (ent.isDirectory()) return SKIP_DIRS.has(ent.name) ? [] : collect(rel);
        return SCAN_EXT.test(ent.name) ? [rel] : [];
    });
}
{
    const exportedFunctions = Object.keys(loaded).filter((k) => typeof loaded[k] === 'function');
    const appOutside = regionOf(html).outside;
    const candidates = [
        { rel: `${APP_NAME} (outside the generated region)`, text: appOutside },
        ...['apps-script', 'scripts', 'tests'].flatMap(collect)
            .filter((rel) => rel !== 'apps-script/Shared.gs')
            .map((rel) => ({ rel, text: fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8') })),
    ];
    const copies = [];
    for (const name of exportedFunctions) {
        for (const c of candidates) if (definesName(c.text, name)) copies.push(`${name} is also defined in ${c.rel}`);
    }
    t('E: no function exported by shared/ is also defined as `function NAME(`, `NAME = function` or `(const|let|var) NAME = ...` (other than a delegating alias that calls BFShared.NAME( on the same line) ' +
      'in the app HTML outside the generated region, apps-script/*.gs other than Shared.gs, scripts/ or tests/', copies, []);
    t('E: every app-side alias of a shared function (ALIASES) is defined and calls straight through to BFShared.<function>(',
        aliasProblems(appOutside, ALIASES), []);
    t('E: the guard looks at something: at least one exported function, every aliased function really is exported, and the scan covers the app, Code.gs, a script and a test',
        { functions: exportedFunctions.length > 0, aliased: ALIASES.filter((a) => !exportedFunctions.includes(a.shared)).map((a) => a.shared),
          covers: [`${APP_NAME} (outside the generated region)`, 'apps-script/Code.gs', 'scripts/sync_shared.js', 'tests/check_shared_sync.js'].filter((r) => !candidates.some((c) => c.rel === r)) },
        { functions: true, aliased: [], covers: [] });
    // Names are built from pieces so this file does not itself define what it searches for.
    const nm = 'isReal' + 'Vvd';
    const inlineArrow = `const ${nm} = (vvd) => vvd !== '' && vvd.toUpperCase() !== 'VMS';`;
    const alias = `const ${nm} = (vvd) => BFShared.${nm}(vvd);`;
    t('E: guard self-test, flags `function NAME(`', definesName(`function ${nm}(v) { return 1; }`, nm), true);
    t('E: guard self-test, flags `var NAME = function` and `obj.NAME = function`',
        [definesName(`var ${nm} = function (v) {};`, nm), definesName(`x.${nm}=function(){}`, nm)], [true, true]);
    t('E: guard self-test, flags the old inline arrow re-inlined as const, let or var (R8\'s repro), and an alias that spills onto the next line',
        [inlineArrow, inlineArrow.replace('const', 'let'), inlineArrow.replace('const', 'var'), `const ${nm} = (vvd) =>\n    BFShared.${nm}(vvd);`].map((s) => definesName(s, nm)), [true, true, true, true]);
    t('E: guard self-test, ignores the delegating alias on one line, calls, comparisons and lookalike names',
        [alias, `BFShared.${nm}(x)`, `if (${nm} === function () {}) {}`, `var ${nm}2 = function () {};`, `var not${nm} = function () {};`, `const other = ${nm}(x);`]
            .map((s) => definesName(s, nm)), [false, false, false, false, false, false]);
    t('E: alias self-test, the delegating alias passes; the inline arrow, a non-delegating wrapper and a missing definition are each reported',
        [aliasProblems(alias, [{ alias: nm, shared: nm }]).length,
         aliasProblems(inlineArrow, [{ alias: nm, shared: nm }]).length,
         aliasProblems(`const ${nm} = (vvd) => BFShared.otherFn(vvd);`, [{ alias: nm, shared: nm }]).length,
         aliasProblems('var unrelated = 1;', [{ alias: nm, shared: nm }]).length,
         aliasProblems(`${alias}\n${inlineArrow}`, [{ alias: nm, shared: nm }]).length],
        [0, 1, 1, 1, 1]);
}

// ================================================================================================
// F. The sync CLI on throwaway repo-shaped copies.
// ================================================================================================
function makeRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-shared-sync-'));
    const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(root, rel)); };
    shared.readSharedFiles(REPO_ROOT).forEach((f) => copy(`shared/${f.name}`));
    copy('scripts/sync_shared.js');
    fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'lib')).filter((f) => f.endsWith('.js')).forEach((f) => copy(`scripts/lib/${f}`));
    // The HTML goes in with its generated region EMPTIED and apps-script/Shared.gs is deliberately not
    // copied, so the first sync always has real work to do whatever state the real repo is in.
    fs.writeFileSync(path.join(root, APP_NAME), regionOf(html).outside);
    return root;
}
const read = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);
const write = (root, rel, text) => fs.writeFileSync(path.join(root, rel), text);
const GS_REL = 'apps-script/Shared.gs';
const snapshot = (root) => ({ html: read(root, APP_NAME), gs: read(root, GS_REL) });
function mustChange(before, after, what) {
    if (before === after) throw new Error(`test setup: ${what} did not change anything`);
    return after;
}

const root = makeRoot();
try {
    const base = {};

    // --- first sync, then --check, then idempotence
    const first = runSync(root, []);
    t('F: first sync exits 0 and reports the app HTML updated and Shared.gs created',
        { code: first.code, out: first.out.trim().split('\n').map((l) => l.replace(/^.*?: /, '')) }, { code: 0, out: ['updated', 'created'] });
    Object.assign(base, snapshot(root));
    t('F: after the first sync both outputs exist and the HTML region equals the shipped text indented 8 spaces',
        { gsHeader: base.gs.startsWith('// GENERATED FILE -- DO NOT EDIT.\n'), gsHasWrapper: base.gs.includes('\nvar BFShared = (function () {\n'), region: regionOf(base.html).region === shared.indent(shared.buildSharedSource({ root }), 8) },
        { gsHeader: true, gsHasWrapper: true, region: true });
    const check1 = runSync(root, ['--check']);
    t('F: --check passes after a sync and says so', { code: check1.code, out: check1.out.trim() }, { code: 0, out: 'shared logic is in sync' });

    const again = runSync(root, []);
    const afterAgain = snapshot(root);
    t('F: a second sync is idempotent: exit 0, both outputs reported unchanged and byte-identical',
        { code: again.code, out: again.out.trim().split('\n').map((l) => l.replace(/^.*?: /, '')), same: afterAgain.html === base.html && afterAgain.gs === base.gs },
        { code: 0, out: ['unchanged', 'unchanged'], same: true });
    t('F: the marker lines survive byte for byte',
        { begin: base.html.split('\n').filter((l) => l.includes(BEGIN)), end: base.html.split('\n').filter((l) => l.includes(END)) },
        { begin: html.split('\n').filter((l) => l.includes(BEGIN)), end: html.split('\n').filter((l) => l.includes(END)) });

    // --- an edit to a shared source: --check fails naming BOTH outputs, writes nothing; sync updates both
    const core = read(root, 'shared/00_core.js');
    write(root, 'shared/00_core.js', `${core}\nBFShared.probeExport = function () { return 'probe'; };\n`);
    write(root, 'shared/10_extra.js', "BFShared.extraExport = function () { return 'extra'; };\n");
    const stale = runSync(root, ['--check']);
    t('F: after editing shared/ --check exits 1, names both stale outputs, prints the fix, and writes nothing',
        { code: stale.code, html: stale.err.includes(`${APP_NAME} is STALE`), gs: stale.err.includes(`${GS_REL} is STALE`), fix: stale.err.includes('run: node scripts/sync_shared.js'), out: stale.out, unchanged: JSON.stringify(snapshot(root)) === JSON.stringify(base) },
        { code: 1, html: true, gs: true, fix: true, out: '', unchanged: true });
    t('F: sync after the edit exits 0',
        runSync(root, []).code, 0);
    const edited = snapshot(root);
    t('F: both copies now carry the new exports, in filename order',
        { html: ['probeExport', 'extraExport'].map((n) => edited.html.includes(`BFShared.${n} = function`)), gs: ['probeExport', 'extraExport'].map((n) => edited.gs.includes(`BFShared.${n} = function`)),
          order: edited.gs.indexOf('shared/00_core.js ----') < edited.gs.indexOf('shared/10_extra.js ----') && edited.html.indexOf('shared/00_core.js ----') < edited.html.indexOf('shared/10_extra.js ----') },
        { html: [true, true], gs: [true, true], order: true });
    t('F: the new text is the same whether read from the HTML region, Shared.gs, or loadShared({root}) (one source, three consumers)',
        (() => {
            const want = Object.keys(loaded).concat(['probeExport', 'extraExport']).sort().join();
            return [runBare(regionOf(edited.html).region).BFShared, runBare(edited.gs).BFShared, shared.loadShared({ root })]
                .map((b) => `${b.probeExport()}/${b.extraExport()}/${Object.keys(b).sort().join() === want}`);
        })(), ['probe/extra/true', 'probe/extra/true', 'probe/extra/true']);
    t('F: --check passes again after re-running the sync', runSync(root, ['--check']).code, 0);
    // restore the shared sources and outputs to the baseline
    write(root, 'shared/00_core.js', core);
    fs.rmSync(path.join(root, 'shared', '10_extra.js'));
    t('F: reverting the shared edit makes --check fail again (the outputs now carry text the sources no longer produce), then a sync restores the baseline',
        { staleCode: runSync(root, ['--check']).code, syncCode: runSync(root, []).code, restored: JSON.stringify(snapshot(root)) === JSON.stringify(base) },
        { staleCode: 1, syncCode: 0, restored: true });

    // --- hand-edited HTML region
    write(root, APP_NAME, mustChange(base.html, base.html.replace('BFShared.API_VERSION = 1;', 'BFShared.API_VERSION = 2;'), 'hand-editing the HTML region'));
    const htmlEdit = runSync(root, ['--check']);
    t('F: a hand-edited HTML region fails --check, naming the app HTML and not Shared.gs',
        { code: htmlEdit.code, html: htmlEdit.err.includes(`${APP_NAME} is STALE`), gs: htmlEdit.err.includes(`${GS_REL} is`), fix: htmlEdit.err.includes('run: node scripts/sync_shared.js') },
        { code: 1, html: true, gs: false, fix: true });
    runSync(root, []);
    t('F: a sync repairs the hand-edited HTML region byte for byte', JSON.stringify(snapshot(root)) === JSON.stringify(base), true);

    // --- hand-edited Shared.gs, then deleted Shared.gs
    write(root, GS_REL, mustChange(base.gs, `${base.gs}// hand edit\n`, 'hand-editing Shared.gs'));
    const gsEdit = runSync(root, ['--check']);
    t('F: a hand-edited Shared.gs fails --check, naming Shared.gs and not the app HTML',
        { code: gsEdit.code, gs: gsEdit.err.includes(`${GS_REL} is STALE`), html: gsEdit.err.includes(`${APP_NAME} is`) }, { code: 1, gs: true, html: false });
    fs.rmSync(path.join(root, GS_REL));
    const gsGone = runSync(root, ['--check']);
    t('F: a missing Shared.gs fails --check as MISSING', { code: gsGone.code, msg: gsGone.err.includes(`${GS_REL} is MISSING`) }, { code: 1, msg: true });
    runSync(root, []);
    t('F: a sync recreates Shared.gs byte for byte', JSON.stringify(snapshot(root)) === JSON.stringify(base), true);

    // --- the sync owns only the region: an edit anywhere else in the HTML is neither flagged nor lost
    const outsideEdit = base.html.replace('<div id="root"></div>', '<div id="root"></div><!-- outside edit -->');
    write(root, APP_NAME, mustChange(base.html, outsideEdit, 'editing the HTML outside the region'));
    const outsideCheck = runSync(root, ['--check']);
    const outsideSync = runSync(root, []);
    t('F: an edit outside the region passes --check and survives a sync untouched',
        { check: outsideCheck.code, sync: outsideSync.code, kept: read(root, APP_NAME) === outsideEdit }, { check: 0, sync: 0, kept: true });
    write(root, APP_NAME, base.html);

    // --- marker problems: exit 1, clear message, NOTHING written (not even Shared.gs)
    const lines = base.html.split('\n');
    const bIdx = lines.findIndex((l) => l.includes(BEGIN));
    const eIdx = lines.findIndex((l) => l.includes(END));
    const swapped = lines.slice();
    swapped[bIdx] = lines[eIdx];
    swapped[eIdx] = lines[bIdx];
    const markerCases = [
        ['BEGIN marker missing', lines.filter((l, i) => i !== bIdx).join('\n'), /BEGIN marker .* was not found/],
        ['END marker missing', lines.filter((l, i) => i !== eIdx).join('\n'), /END marker .* was not found/],
        ['END marker duplicated', lines.slice(0, eIdx + 1).concat([lines[eIdx]], lines.slice(eIdx + 1)).join('\n'), /END marker .* appears 2 times/],
        ['markers out of order', swapped.join('\n'), /END marker comes before the BEGIN marker/],
        ['BEGIN marker not alone on a // comment line', lines.map((l, i) => (i === bIdx ? `        const x = "// ${BEGIN}";` : l)).join('\n'), /must sit on its own line/],
    ];
    for (const [label, badHtml, re] of markerCases) {
        write(root, APP_NAME, mustChange(base.html, badHtml, label));
        write(root, GS_REL, `${base.gs}// stale on purpose\n`);
        const staleGs = read(root, GS_REL);
        const sync = runSync(root, []);
        const check = runSync(root, ['--check']);
        t(`F: ${label}: sync and --check both exit 1 with a clear message, and the sync writes nothing`,
            { sync: sync.code, check: check.code, msg: re.test(sync.err) && re.test(check.err), written: read(root, APP_NAME) !== badHtml || read(root, GS_REL) !== staleGs },
            { sync: 1, check: 1, msg: true, written: false });
    }
    write(root, APP_NAME, base.html);
    write(root, GS_REL, base.gs);

    // --- CRLF in the app HTML is refused rather than silently rewritten
    write(root, APP_NAME, base.html.replace(/\n/g, '\r\n'));
    const crlf = runSync(root, []);
    t('F: an app HTML with CRLF line endings is refused (exit 1, says why)', { code: crlf.code, msg: /CR line endings/.test(crlf.err) }, { code: 1, msg: true });
    write(root, APP_NAME, base.html);

    // --- unsafe shared text: refused before anything is written
    write(root, 'shared/20_bad.js', '// see shared/*.js\nBFShared.bad = 1;\n');
    const bad = runSync(root, []);
    const badCheck = runSync(root, ['--check']);
    t('F: shared text with a slash-star inside a // comment is refused by sync and --check (exit 1, names file:line), and nothing is written',
        { sync: bad.code, check: badCheck.code, msg: bad.err.includes('shared/20_bad.js:1') && badCheck.err.includes('shared/20_bad.js:1'), unchanged: JSON.stringify(snapshot(root)) === JSON.stringify(base) },
        { sync: 1, check: 1, msg: true, unchanged: true });
    fs.rmSync(path.join(root, 'shared', '20_bad.js'));

    // --- write safety (scripts/sync_shared.js writeOutputs): symlinks, failing writes, concurrent edits
    const probeText = `${core}\nBFShared.writeProbe = function () { return 1; };\n`;
    const strayTemps = () => fs.readdirSync(root).concat(fs.readdirSync(path.join(root, 'apps-script'))).filter((f) => f.includes('.sync-'));
    const sync = require(path.join(root, 'scripts', 'sync_shared.js'));
    const htmlPath = path.join(root, APP_NAME);
    const gsPath = path.join(root, GS_REL);

    // a symlinked output is refused up front, cleanly, with nothing written (here: a dangling one)
    write(root, 'shared/00_core.js', probeText);
    fs.rmSync(gsPath);
    let linked = true;
    try { fs.symlinkSync(path.join(root, 'no', 'such', 'target.gs'), gsPath); } catch (e) { linked = false; } // e.g. Windows without the privilege
    if (linked) {
        const viaLink = runSync(root, []);
        t('F: a symlinked Shared.gs is refused (exit 1, one clean message, no stack trace), and the stale app HTML is NOT written either',
            { code: viaLink.code, msg: /Shared\.gs is a symbolic link/.test(viaLink.err) && !/\n\s+at /.test(viaLink.err), html: read(root, APP_NAME) === base.html, temps: strayTemps() },
            { code: 1, msg: true, html: true, temps: [] });
        fs.rmSync(gsPath);
    } else {
        t('F: a symlinked Shared.gs is refused (skipped: this platform cannot create the symlink)', 'skipped', 'skipped');
    }
    fs.writeFileSync(gsPath, base.gs);

    // a file-system error is one clean line, never a stack: here apps-script is a regular file
    fs.renameSync(path.join(root, 'apps-script'), path.join(root, 'apps-script.real'));
    fs.writeFileSync(path.join(root, 'apps-script'), 'not a directory');
    const notDir = runSync(root, []);
    fs.rmSync(path.join(root, 'apps-script'));
    fs.renameSync(path.join(root, 'apps-script.real'), path.join(root, 'apps-script'));
    t('F: a file-system error (apps-script is a regular file) exits 1 with one "sync_shared: ..." line and no stack trace, and writes nothing',
        { code: notDir.code, oneLine: /^sync_shared: [^\n]+\n$/.test(notDir.err), html: read(root, APP_NAME) === base.html }, { code: 1, oneLine: true, html: true });

    // a write that fails part-way leaves nothing changed and no temporary file behind: the Shared.gs
    // temporary path is occupied by a directory, so its write fails AFTER the app HTML's temporary file exists
    const occupied = path.join(root, 'apps-script', `.Shared.gs.sync-${process.pid}.tmp`);
    fs.mkdirSync(occupied);
    let failure = null;
    try { sync.writeOutputs(sync.planOutputs(root)); } catch (e) { failure = e.message; }
    fs.rmdirSync(occupied);
    t('F: a failing temporary-file write throws one clean message, leaves BOTH outputs untouched, and removes the app HTML temporary file it had already written',
        { failed: /EEXIST/.test(failure || ''), html: read(root, APP_NAME) === base.html, gs: read(root, GS_REL) === base.gs, temps: strayTemps() },
        { failed: true, html: true, gs: true, temps: [] });

    // an app HTML edited while the sync was running is never overwritten: the re-read before the rename notices
    const concurrentEdit = '<!-- edited while the sync was running -->\n';
    let conflict = null;
    try { sync.writeOutputs(sync.planOutputs(root), { beforeRename: () => fs.appendFileSync(htmlPath, concurrentEdit) }); } catch (e) { conflict = e.message; }
    t('F: an app HTML edited between the sync\'s first read and its rename aborts the sync with a clear message: the concurrent edit survives, Shared.gs is not written, no temporary file remains',
        { msg: /changed while the sync was running; nothing was written/.test(conflict || ''), html: read(root, APP_NAME) === base.html + concurrentEdit, gs: read(root, GS_REL) === base.gs, temps: strayTemps() },
        { msg: true, html: true, gs: true, temps: [] });
    write(root, 'shared/00_core.js', core);
    write(root, APP_NAME, base.html);

    // --- command line
    const usage = runSync(root, ['--bogus']);
    const noRoot = runSync(root, [`--root=${path.join(root, 'no', 'such', 'dir')}`]);
    t('F: an unknown argument exits 2 with a usage line; a --root that is not a directory exits 1 saying so',
        { usage: usage.code, usageMsg: /usage: node scripts\/sync_shared\.js/.test(usage.err), noRoot: noRoot.code, noRootMsg: /root directory not found/.test(noRoot.err) },
        { usage: 2, usageMsg: true, noRoot: 1, noRootMsg: true });

    // --- --root: the REAL repo's script operating on the throwaway copy
    const viaRoot = runSync(REPO_ROOT, [`--root=${root}`, '--check'], REPO_ROOT);
    write(root, 'shared/00_core.js', `${core}\nBFShared.rootProbe = function () { return 1; };\n`);
    const viaRootStale = runSync(REPO_ROOT, [`--root=${root}`, '--check'], REPO_ROOT);
    t('F: --root=DIR checks that directory and not the repo the script lives in (the real repo\'s own answer is unchanged)',
        { inSync: viaRoot.code, staleCopy: viaRootStale.code, names: viaRootStale.err.includes(APP_NAME), realRepo: runSync(REPO_ROOT, ['--check']).code },
        { inSync: 0, staleCopy: 1, names: true, realRepo: realRepoCheck.code });
    write(root, 'shared/00_core.js', core);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

// ================================================================================================
finish(false);

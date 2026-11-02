#!/usr/bin/env node
/**
 * Headless check for the app-file resolver: scripts/lib/app_file.js (pickCurrentAppHtml /
 * findCurrentAppHtml, the ONE implementation of "which file is the current app"), its CLI
 * scripts/print_app_file.js (what Python and CI parse), and tests/perf_benchmark.js's
 * resolveAppHtml() -- the shared "which app HTML file to test" resolver that
 * tests/ci_regression_runner.js and tests/perf_highlight_benchmark.js both call instead of
 * hand-rolling their own override logic (see perf_benchmark.js's own comment above the function
 * for the full history). It also fails if a new hand-copied version of the rule appears.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BROWSER SUITES
 *
 * Both callers only ever exercise resolveAppHtml()'s two SUCCESS paths (unset -> auto-detect,
 * a valid override) as a side effect of a browser run -- nothing exercises its two FAILURE paths
 * (an absolute override, a nonexistent one), because a CI run never sets BF_APP_HTML to a broken
 * value on purpose. A regression in either error path -- or in the exact bug class this function
 * was built to prevent, an override like "dist/index.html" getting flattened to "index.html" by
 * a stray path.basename() -- would ship silently behind a fully green live suite. This is pure
 * logic with no DOM/browser/network in it, so it does not need one to check.
 *
 * Run:  node tests/check_resolve_app_html.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { resolveAppHtml } = require('./perf_benchmark.js');
const { findCurrentAppHtml, pickCurrentAppHtml, REPO_ROOT } = require('../scripts/lib/app_file.js');

let pass = 0;
const failures = [];
function t(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) {
        pass++;
    } else {
        failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
    }
}

// Every test below sets/clears its own env var and restores it afterward, so one test's
// override can never leak into the next -- this file runs all of them in one process.
function withEnv(name, value, fn) {
    const had = Object.prototype.hasOwnProperty.call(process.env, name);
    const prev = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try {
        return fn();
    } finally {
        if (had) process.env[name] = prev;
        else delete process.env[name];
    }
}

function throws(fn) {
    try {
        fn();
        return null;
    } catch (e) {
        return e;
    }
}

// --- unset -> falls back to auto-detection, unchanged from calling findCurrentAppHtml() directly ---
withEnv('BF_APP_HTML', undefined, () => {
    // throws() first, so a tie (or no app file) in the repo root is REPORTED as a failed assertion
    // with the resolver's own message; calling resolveAppHtml() bare at top level used to die with
    // an uncaught stack trace before any assertion ran.
    const viaResolve = throws(() => resolveAppHtml());
    const viaFind = throws(() => findCurrentAppHtml());
    t('auto-detect resolves to exactly one app file (a tie or no candidate in the repo root throws)',
        { resolve: viaResolve && viaResolve.message, find: viaFind && viaFind.message }, { resolve: null, find: null });
    t('unset BF_APP_HTML falls back to findCurrentAppHtml()',
        viaResolve ? null : resolveAppHtml(), viaFind ? null : findCurrentAppHtml());
});

// --- a valid, real, repo-relative override resolves under REPO_ROOT ---
// dist/index.html is a permanent, always-committed file (the precompiled deploy artifact), not
// a throwaway fixture -- safe to depend on its existence here the same way real callers do.
withEnv('BF_APP_HTML', 'dist/index.html', () => {
    const resolved = resolveAppHtml();
    t('BF_APP_HTML=dist/index.html resolves under REPO_ROOT', resolved, path.join(REPO_ROOT, 'dist/index.html'));
    // This is the exact regression class the whole effort exists to prevent: a caller deriving
    // the relative/URL piece with path.basename() instead of path.relative() silently flattens
    // a subdirectory override to its bare filename. See perf_benchmark.js's own comment above
    // resolveAppHtml() and tests/ci_regression_runner.js's migration for the full story.
    t('resolved path round-trips via path.relative (NOT path.basename)',
        path.relative(REPO_ROOT, resolved), 'dist/index.html');
});

// --- an absolute override is rejected before ever touching the filesystem ---
withEnv('BF_APP_HTML', '/tmp/some-absolute-path.html', () => {
    const err = throws(() => resolveAppHtml());
    t('absolute BF_APP_HTML throws', err !== null, true);
    t('absolute BF_APP_HTML error names the reason', !!(err && /must be relative to the repo root/.test(err.message)), true);
});

// --- a nonexistent relative override is rejected with a distinct, specific message ---
withEnv('BF_APP_HTML', 'this/path/does/not/exist.html', () => {
    const err = throws(() => resolveAppHtml());
    t('nonexistent BF_APP_HTML throws', err !== null, true);
    t('nonexistent BF_APP_HTML error names the reason', !!(err && /does not exist/.test(err.message)), true);
});

// --- a custom env-var name is honored, not just the BF_APP_HTML default ---
// (tests/perf_highlight_benchmark.js and tests/ci_regression_runner.js both call resolveAppHtml()
// with no argument today, but the parameter is part of the function's public contract.)
withEnv('BF_APP_HTML', undefined, () => {
    withEnv('CHECK_RESOLVE_APP_HTML_CUSTOM_VAR', 'dist/index.html', () => {
        t('a custom env-var name is honored over the BF_APP_HTML default',
            resolveAppHtml('CHECK_RESOLVE_APP_HTML_CUSTOM_VAR'), path.join(REPO_ROOT, 'dist/index.html'));
    });
});

// --- pickCurrentAppHtml: the pure rule every caller shares (JS requires it, Python and CI call
// scripts/print_app_file.js). These cases are the ones the old hand-pasted copies disagreed on:
// ties (JS took the LAST in listing order, Python the FIRST) and "2.0" vs "2.0.0".
const N = (v, tag) => `Booking_flash_report_na_${v}_${tag}.html`;
{
    const pick = (names) => pickCurrentAppHtml(names);
    const today = [N('1.67', 'TESTING'), N('2.5', 'WORKING_PRO_ONLY')];
    t('today\'s layout: main file wins, testing build reported as excluded',
        pick(today), { file: N('2.5', 'WORKING_PRO_ONLY'), excluded: [N('1.67', 'TESTING')] });
    t('a testing build numbered ABOVE the main file is still excluded',
        pick([N('3.0', 'TESTING'), N('2.0', 'WORKING_PRO_ONLY')]).file, N('2.0', 'WORKING_PRO_ONLY'));
    t('versions compare numerically, not as strings (2.10 beats 2.9)',
        pick([N('2.9', 'A'), N('2.10', 'B')]).file, N('2.10', 'B'));
    t('old naming era is matched and loses to a higher new-era version',
        pick(['booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html', N('2.0', 'X')]).file, N('2.0', 'X'));
    t('files that do not match the naming pattern are ignored',
        pick(['README.md', 'index.html', N('2.0', 'X')]).file, N('2.0', 'X'));
    t('the answer does not depend on listing order',
        pick([N('2.0', 'B'), N('1.5', 'A'), N('2.1', 'C')]).file === pick([N('2.1', 'C'), N('1.5', 'A'), N('2.0', 'B')]).file, true);

    const tie = throws(() => pick([N('2.0', 'WORKING_PRO_ONLY'), N('2.0', 'BACKUP')]));
    t('two non-testing files at the same version THROW instead of guessing, naming both',
        !!(tie && /Ambiguous/.test(tie.message) && tie.message.includes(N('2.0', 'BACKUP')) && tie.message.includes(N('2.0', 'WORKING_PRO_ONLY'))), true);
    t('"2.0" and "2.0.0" count as the same version (a tie), as the JS copies always treated them',
        !!throws(() => pick([N('2.0', 'Y'), N('2.0.0', 'X')])), true);
    t('no candidate at all (only a testing build) throws',
        !!throws(() => pick([N('1.67', 'TESTING')])), true);
}

// --- scripts/print_app_file.js is what Python and CI parse, so its CLI contract is pinned here:
// stdout is EXACTLY the file name and a newline, the "excluded testing builds" note goes to stderr,
// and a tie or no candidate exits 1 with nothing on stdout. Each case runs the real script against
// a throwaway directory laid out like the repo (scripts/, scripts/lib/, fake app files), so a tie
// can be tested without touching the real repo root. If print_app_file.js ever switched to
// findCurrentAppHtml() (which console.logs the excluded note to stdout), case 2 would fail.
function runCli(appFiles) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-app-file-'));
    try {
        fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
        fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'print_app_file.js'), path.join(root, 'scripts', 'print_app_file.js'));
        fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'app_file.js'), path.join(root, 'scripts', 'lib', 'app_file.js'));
        appFiles.forEach((f) => fs.writeFileSync(path.join(root, f), '<html></html>'));
        const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'print_app_file.js')], { encoding: 'utf8' });
        return { code: r.status, out: r.stdout, err: r.stderr };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
{
    const ok = runCli([N('1.67', 'TESTING'), N('2.5', 'MAIN')]);
    t('CLI: stdout is exactly the current file name and a newline, exit 0',
        { out: ok.out, code: ok.code }, { out: `${N('2.5', 'MAIN')}\n`, code: 0 });
    t('CLI: the skipped testing build is reported on stderr, never on stdout',
        { stderr: ok.err.includes(`excluded as testing builds: ${N('1.67', 'TESTING')}`), stdoutClean: !ok.out.includes('excluded') },
        { stderr: true, stdoutClean: true });
    const tie = runCli([N('2.0', 'MAIN'), N('2.0', 'BACKUP')]);
    t('CLI: a tie exits 1 with an empty stdout and an "Ambiguous" message on stderr',
        { code: tie.code, out: tie.out, ambiguous: /Ambiguous/.test(tie.err) }, { code: 1, out: '', ambiguous: true });
    const none = runCli([N('1.67', 'TESTING')]);
    t('CLI: no candidate exits 1 with an empty stdout',
        { code: none.code, out: none.out, msg: /No main/.test(none.err) }, { code: 1, out: '', msg: true });
    const real = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'print_app_file.js')], { encoding: 'utf8' });
    const inProcess = throws(() => findCurrentAppHtml());
    t('CLI on the real repo names the same file as the in-process resolver',
        real.stdout.trim(), inProcess ? '' : path.basename(findCurrentAppHtml()));
}

// --- no new hand-copied detection rule. The rule used to be pasted into ~10 files; three more
// were added after the docs said "seven", which is how the copies drifted apart. Any file under
// tests/, scripts/ or .github/ (recursively) that contains the filename pattern, other than the
// two files that own it, fails here with the instruction for what to do instead.
//
// This is a tripwire for the realistic way a copy appears (someone pastes the pattern), not a
// proof: a rule rewritten in a different shape would pass. The shapes it knows are the two regex
// fragments the old copies used plus the pattern's literal opening. The scanner is a function so the
// tests below can prove it flags a nested or differently-named file instead of assuming it does.
const RULE_OWNERS = new Set(['scripts/lib/app_file.js', 'tests/check_resolve_app_html.js']);
// Built from pieces so this file does not contain the literals it searches for.
const RULE_NEEDLES = ['na(_Kev' + 'in)?_', 'na_(?:Kev' + 'in_)?', '[Bb]ooking_flash_report_' + 'na'];
const SCAN_SKIP_DIRS = new Set(['node_modules', 'vendor', 'fixtures', '.git']);
const SCAN_EXT = /\.(js|mjs|cjs|ts|py|ya?ml|sh)$/;
function findRuleCopies(files) {
    return files.filter((f) => !RULE_OWNERS.has(f.rel) && SCAN_EXT.test(f.rel) && RULE_NEEDLES.some((n) => f.text.includes(n)))
        .map((f) => f.rel).sort();
}
function collectRepoFiles(dirRel) {
    const abs = path.join(REPO_ROOT, dirRel);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((ent) => {
        const rel = `${dirRel}/${ent.name}`;
        if (ent.isDirectory()) return SCAN_SKIP_DIRS.has(ent.name) ? [] : collectRepoFiles(rel);
        return SCAN_EXT.test(ent.name) ? [{ rel, text: fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8') }] : [];
    });
}
{
    const repoFiles = ['tests', 'scripts', '.github'].flatMap(collectRepoFiles);
    t('no file under tests/, scripts/ or .github/ (recursively) outside scripts/lib/app_file.js carries its own copy of the ' +
      'app-file rule (use require("../scripts/lib/app_file.js"), or `node scripts/print_app_file.js` from Python/CI)',
        findRuleCopies(repoFiles), []);
    const copy = `const re = /^${RULE_NEEDLES[0]}[\\d.]+/;`;
    t('guard self-test: a copy in a nested directory and a .mjs file is flagged, the two owner files are not',
        findRuleCopies([
            { rel: 'scripts/sub/dir/x.mjs', text: copy },
            { rel: 'scripts/lib/app_file.js', text: copy },
            { rel: 'tests/check_resolve_app_html.js', text: copy },
            { rel: 'tests/other.js', text: 'no rule here' },
        ]), ['scripts/sub/dir/x.mjs']);
    t('guard self-test: the Python-style fragment and the pattern\'s literal opening are flagged too',
        findRuleCopies([
            { rel: 'tests/a.py', text: `re.search(r'${RULE_NEEDLES[1]}([\\d.]+)_', f)` },
            { rel: 'tests/b.js', text: `new RegExp('^${RULE_NEEDLES[2]}')` },
        ]), ['tests/a.py', 'tests/b.js']);
}

const EXPECTED = 26;
if (pass + failures.length !== EXPECTED) {
    failures.push(`expected ${EXPECTED} assertions, ran ${pass + failures.length} -- ` +
        'an assertion was added or silently dropped; update EXPECTED deliberately');
}

if (failures.length) {
    console.error(`\n${failures.length} FAILED:\n`);
    failures.forEach((f) => console.error(`  - ${f}\n`));
    process.exit(1);
}
console.log(`RESOLVE_APP_HTML_CHECK_PASSED (${pass} assertions)`);

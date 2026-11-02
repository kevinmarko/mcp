#!/usr/bin/env node
/**
 * Headless check for tests/perf_benchmark.js's resolveAppHtml() -- the shared "which app HTML
 * file to test" resolver that tests/ci_regression_runner.js and tests/perf_highlight_benchmark.js
 * both now call instead of hand-rolling their own override logic (see perf_benchmark.js's own
 * comment above the function for the full history).
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
const { resolveAppHtml, findCurrentAppHtml, REPO_ROOT } = require('./perf_benchmark.js');

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
    t('unset BF_APP_HTML falls back to findCurrentAppHtml()', resolveAppHtml(), findCurrentAppHtml());
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

const EXPECTED = 8;
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

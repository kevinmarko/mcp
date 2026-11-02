#!/usr/bin/env node
/**
 * Build the DEPLOYABLE copy of the app: same file, with the JSX already compiled.
 *
 * WHY THIS EXISTS. The app ships its whole ~10,800-line source as a
 * `<script type="text/babel">` block and lets babel-standalone compile it in the browser on
 * every single load. Measured on 2026-09-19 against the deployed 2.0 file (5 trials, medians,
 * live CSV pinned to its fixture):
 *
 *                        as shipped   precompiled
 *   first React commit      5,755 ms       437 ms
 *   longest single task     5,152 ms       245 ms
 *   blocking total          6,175 ms       784 ms
 *
 * ~5.2 seconds of every load is one unbroken main-thread task compiling the app, before a
 * pixel of data appears. It is paid by every user, on every load, on every tab, regardless of
 * dataset size, filters or saved preferences. Compiling the same file here takes ~0.6s, once.
 *
 * THE SOURCE OF TRUTH DOES NOT MOVE. The versioned app file in the repo root stays the file
 * you edit, in JSX, with no build step in the way of local development -- open it over the
 * static server exactly as before and babel-standalone still compiles it in the browser. This
 * script only produces `dist/index.html`, the artifact to paste into Apps Script.
 *
 * WHY THE OUTPUT IS ES5 AND STRICT, rather than the modern JS the source is written in.
 * babel-standalone's script-tag path applies preset-env with no targets, so what runs in
 * production TODAY is ES5 under "use strict" -- verified by capturing its real output in a
 * browser rather than assuming: `const`->`var`, arrow->`function`, template literal->`.concat`.
 * Matching that exactly is deliberate. Shipping native `const`/`let` instead would reintroduce
 * TDZ errors that the current down-level silently turns into `undefined` reads -- a property
 * this file's hook ordering is known to lean on (see the `tableData isn't reachable from this
 * effect` comment in the app, and AGENTS.md's note that "Babel Standalone throws no TDZ
 * error"). A perf change is the wrong place to also change language semantics, so it doesn't.
 *
 * WHY THE INERT text/babel BLOCK IS KEPT. The Tailwind JIT primer at the bottom of the app does
 * `querySelector('script[type="text/babel"]')` and scans that source text for class tokens; it
 * is what prevents a first-use utility from costing a whole-document style recalc (AGENTS.md
 * check 5). The block is therefore left in place but never executes, because babel-standalone
 * is gone -- the browser does not run an unknown script type. That costs file size and buys
 * ONE implementation of token extraction. A second, build-time copy of those regexes is exactly
 * the hand-synced duplication this repo has been bitten by before (see the seven-copies warning
 * in AGENTS.md check 1), so it is not done.
 *
 * ORDER MATTERS. The compiled script goes at the very END of body, AFTER the primer's own
 * plain <script>. That reproduces the original sequence: the primer runs during parse, while
 * babel-standalone compiled and ran the app later, at DOMContentLoaded. Put the compiled code
 * first and the app renders before the JIT is primed, which is the stall the primer exists to
 * prevent.
 *
 * USAGE
 *   node scripts/build_deployable.js           # write dist/index.html
 *   node scripts/build_deployable.js --check   # verify the committed artifact is up to date
 *
 * --check is what keeps the committed artifact honest: it rebuilds in memory and diffs, so a
 * change to the app file that was never rebuilt fails CI instead of silently deploying stale
 * code. Every transformation below asserts it actually applied, for the same reason.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const babel = require('@babel/core');

// Imported, never pasted: AGENTS.md check 1 documents the app-file detection rule already
// living in seven hand-synced copies, and that two JS files in this repo CAN share one module.
const { findCurrentAppHtml } = require('../tests/perf_benchmark.js');

const REPO_ROOT = path.dirname(__dirname);
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const DIST_FILE = path.join(DIST_DIR, 'index.html');

const BABEL_OPTIONS = {
    presets: [
        // forceAllTransforms reproduces babel-standalone's no-targets behaviour. Babel 8's
        // preset-env otherwise defaults to modern targets and down-levels nothing, which would
        // silently change the language semantics described in this file's header.
        ['@babel/preset-env', { forceAllTransforms: true, modules: false }],
        ['@babel/preset-react', { runtime: 'classic' }],
    ],
    sourceType: 'module',
    filename: 'booking_flash_app.jsx',
    compact: false,
    sourceMaps: false,
    // Comments are dropped from the COMPILED copy only (the inert source block above keeps
    // every one of them). They cannot affect behaviour, they are a large share of this file,
    // and a comment containing a literal </script> would otherwise end the tag early.
    comments: false,
    babelrc: false,
    configFile: false,
};

function build() {
    const appPath = findCurrentAppHtml();
    const appName = path.basename(appPath);
    const source = fs.readFileSync(appPath, 'utf8');

    const blocks = source.match(/<script type="text\/babel">[\s\S]*?<\/script>/g) || [];
    if (blocks.length !== 1) {
        throw new Error(`expected exactly one <script type="text/babel"> block in ${appName}, found ${blocks.length}`);
    }
    const jsx = /<script type="text\/babel">([\s\S]*?)<\/script>/.exec(source)[1];

    let compiled = babel.transformSync(jsx, BABEL_OPTIONS).code;
    // "use strict" is what babel-standalone's output carries today. Babel 8 only emits it via
    // the modules transform, which is off here, so it is added explicitly rather than left to
    // chance -- the app already runs strict in production, so this matches rather than changes.
    compiled = `"use strict";\n\n${compiled}`;
    // Belt and braces alongside comments:false -- a </script> inside any surviving string
    // literal would end the tag and truncate the app.
    compiled = compiled.split('</script').join('<\\/script');

    let out = source;

    // 1. Remove babel-standalone: nothing should compile anything at runtime any more.
    const babelTag = /\s*<script src="https:\/\/[^"]*babel[^"]*"><\/script>/i;
    if (!babelTag.test(out)) throw new Error('babel-standalone <script src> tag not found -- did the app\'s <head> change?');
    out = out.replace(babelTag, '\n    <!-- babel-standalone intentionally omitted: the JSX below is precompiled (scripts/build_deployable.js) -->');

    // 2. Append the compiled app after the primer, at the end of body.
    if (!out.includes('</body>')) throw new Error('no </body> found in the app file');
    out = out.replace('</body>', `<script data-bf-compiled="1">\n${compiled}\n</script>\n</body>`);

    // 3. Provenance, so a downloaded artifact can always be traced to its source.
    const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
    const banner = `<!-- GENERATED FILE -- DO NOT EDIT.\n`
        + `     Built by scripts/build_deployable.js from ${appName}\n`
        + `     source-sha256: ${sourceHash}\n`
        + `     Edit the source file in the repo root, then re-run the build. -->\n`;
    out = banner + out;

    // The inert source block is load-bearing for the Tailwind primer (see header).
    if (!/<script type="text\/babel">/.test(out)) throw new Error('the inert text/babel block was lost -- the Tailwind JIT primer would silently stop priming');

    return { out, appName, sourceHash };
}

function main() {
    const check = process.argv.includes('--check');
    const { out, appName, sourceHash } = build();

    if (check) {
        if (!fs.existsSync(DIST_FILE)) {
            console.error(`dist/index.html is missing. Run: node scripts/build_deployable.js`);
            process.exit(1);
        }
        const committed = fs.readFileSync(DIST_FILE, 'utf8');
        if (committed !== out) {
            console.error('dist/index.html is STALE -- it does not match a fresh build of ' + appName + '.');
            console.error('Run: node scripts/build_deployable.js   and commit the result.');
            process.exit(1);
        }
        console.log(`dist/index.html is up to date with ${appName} (source-sha256 ${sourceHash.slice(0, 12)}).`);
        return;
    }

    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(DIST_FILE, out);
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    console.log(`built dist/index.html from ${appName}`);
    console.log(`  source ${kb(fs.statSync(findCurrentAppHtml()).size)} -> artifact ${kb(fs.statSync(DIST_FILE).size)}`);
    console.log(`  source-sha256 ${sourceHash.slice(0, 12)}`);
}

main();

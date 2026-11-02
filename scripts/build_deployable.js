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
 * the hand-synced duplication this repo has been bitten by before (the app-file detection rule
 * was copied into ~10 files and drifted; see docs/CHECK_HISTORY.md), so it is not done.
 *
 * ORDER MATTERS. The compiled script goes at the very END of body, AFTER the primer's own
 * plain <script>. That reproduces the original sequence: the primer runs during parse, while
 * babel-standalone compiled and ran the app later, at DOMContentLoaded. Put the compiled code
 * first and the app renders before the JIT is primed, which is the stall the primer exists to
 * prevent.
 *
 * TWO ARTIFACTS, ONE SOURCE (2026-10-01, per Kevin: a basic build without Google API services
 * while those are still in testing). Besides dist/index.html this also writes
 * dist/basic/index.html: byte-for-byte the same output, plus one plain
 * `<script>window.__BF_GOOGLE_SERVICES_OFF__=true;</script>` as the FIRST child of <head>, so it
 * runs before the blank-screen guard and the app. The app reads that flag (GOOGLE_SERVICES_OFF)
 * and makes no google.script.run call and honors no server-injected state. Paste that file into
 * its own Apps Script project with apps-script/basic/Code.gs. There is no forked app file: every
 * fix to the source lands in both artifacts on the next build.
 *
 * USAGE
 *   node scripts/build_deployable.js           # write dist/index.html and dist/basic/index.html
 *   node scripts/build_deployable.js --check   # verify BOTH committed artifacts are up to date
 *
 * --check is what keeps the committed artifacts honest: it rebuilds in memory and diffs, so a
 * change to the app file that was never rebuilt fails CI instead of silently deploying stale
 * code. It fails if either artifact is missing or stale. Every transformation below asserts it
 * actually applied, for the same reason.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const babel = require('@babel/core');

// Imported, never pasted: the app-file detection rule lives only in scripts/lib/app_file.js
// (it used to be hand-copied into ~10 files, and the copies drifted -- docs/CHECK_HISTORY.md).
const { findCurrentAppHtml } = require('./lib/app_file.js');

const REPO_ROOT = path.dirname(__dirname);
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const DIST_FILE = path.join(DIST_DIR, 'index.html');
const DIST_BASIC_DIR = path.join(DIST_DIR, 'basic');
const DIST_BASIC_FILE = path.join(DIST_BASIC_DIR, 'index.html');

// The only difference between the two artifacts. Plain ES5-safe statement, no dependencies.
const BASIC_FLAG_SCRIPT = '<script>window.__BF_GOOGLE_SERVICES_OFF__=true;</script>';

// The single source of truth for the compiled-payload marker, so the gate's syntax check of the
// compiled payload (scripts/run_ci_locally.js, "Deployable build is up to date") can require()
// extractCompiledPayload below instead of re-deriving this regex independently.
const COMPILED_SCRIPT_OPEN = '<script data-bf-compiled="1">';
const COMPILED_SCRIPT_REGEX = /<script data-bf-compiled="1">([\s\S]*?)<\/script>/;

function extractCompiledPayload(html) {
    const m = COMPILED_SCRIPT_REGEX.exec(html);
    return m ? m[1] : null;
}

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

    const blocks = [...source.matchAll(/<script type="text\/babel">([\s\S]*?)<\/script>/g)];
    if (blocks.length !== 1) {
        throw new Error(`expected exactly one <script type="text/babel"> block in ${appName}, found ${blocks.length}`);
    }
    const jsx = blocks[0][1];

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
    // Counted, not just tested, same as the JSX-block check above -- a second incidental match
    // (e.g. a commented-out fallback tag) would otherwise leave one silently un-stripped.
    const babelTag = /\s*<script src="https:\/\/[^"]*babel[^"]*"><\/script>/i;
    const babelTagCount = (out.match(new RegExp(babelTag.source, 'gi')) || []).length;
    if (babelTagCount !== 1) throw new Error(`expected exactly one babel-standalone <script src> tag, found ${babelTagCount} -- did the app's <head> change?`);
    out = out.replace(babelTag, '\n    <!-- babel-standalone intentionally omitted: the JSX below is precompiled (scripts/build_deployable.js) -->');

    // 2. Append the compiled app after the primer, at the end of body.
    // Counted, not just tested -- an earlier incidental "</body>" (e.g. inside a string literal
    // building an HTML export) would otherwise silently receive the compiled script instead of
    // the real closing tag.
    const bodyCloseCount = out.split('</body>').length - 1;
    if (bodyCloseCount !== 1) throw new Error(`expected exactly one </body> in the app file, found ${bodyCloseCount}`);
    // A FUNCTION replacer, never a replacement string: String.prototype.replace treats `$&` (the matched text,
    // here the closing body tag), `$'`, the backtick form and `$$` in a replacement STRING as special patterns, so a
    // compiled app that contains one of them was silently rewritten. The app's escapeRegex helper
    // (`s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) shipped in dist/ as `'\\</body>'` for months, which
    // broke every regex built from a keyword containing a parenthesis.
    out = out.replace('</body>', () => `${COMPILED_SCRIPT_OPEN}\n${compiled}\n</script>\n</body>`);
    // Belt and braces: the compiled script must appear in the output byte for byte. Any future change that alters
    // it on the way in (another replace, an escape) fails the build here instead of shipping.
    if (!out.includes(compiled)) throw new Error('the compiled script was altered while being inserted into the page');

    // 3. Provenance, so a downloaded artifact can always be traced to its source.
    const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
    const banner = `<!-- GENERATED FILE -- DO NOT EDIT.\n`
        + `     Built by scripts/build_deployable.js from ${appName}\n`
        + `     source-sha256: ${sourceHash}\n`
        + `     Edit the source file in the repo root, then re-run the build. -->\n`;
    out = banner + out;

    // The inert source block is load-bearing for the Tailwind primer (see header).
    if (!/<script type="text\/babel">/.test(out)) throw new Error('the inert text/babel block was lost -- the Tailwind JIT primer would silently stop priming');

    // 4. The basic artifact: the same output with the Google-services-off flag as the FIRST child
    // of <head>. Asserted, not assumed: the flag must precede every other script in the document,
    // and exactly one must exist, or the basic build would silently still call Google.
    // The app's own source also contains "<head>" inside string literals (HTML export), so only
    // the document's real, first <head> -- immediately after <html ...> -- is touched.
    const headOpenRe = /(<html[^>]*>\s*)<head>/;
    if (!headOpenRe.test(out)) throw new Error('could not find the document <html><head> opening -- did the app\'s <head> change?');
    const basicOut = out.replace(headOpenRe, (_m, htmlOpen) => `${htmlOpen}<head>\n    ${BASIC_FLAG_SCRIPT}`);
    const flagAt = basicOut.indexOf(BASIC_FLAG_SCRIPT);
    const firstOtherScriptAt = basicOut.indexOf('<script');
    if (flagAt === -1 || flagAt !== firstOtherScriptAt) throw new Error('the basic build flag script is not the first <script> in the document');
    if (basicOut.split('__BF_GOOGLE_SERVICES_OFF__=true').length - 1 !== 1) throw new Error('the basic build flag must be set exactly once');
    if (out.includes('__BF_GOOGLE_SERVICES_OFF__=true')) throw new Error('the full build must never set the Google-services-off flag');
    if (basicOut.replace(`\n    ${BASIC_FLAG_SCRIPT}`, '') !== out) throw new Error('the basic build differs from the full build by more than the flag script');

    return { out, basicOut, appPath, appName, sourceHash };
}

// The two committed artifacts, as [label, path, expected content] triples.
function artifactsOf(built) {
    return [
        ['dist/index.html', DIST_FILE, built.out],
        ['dist/basic/index.html', DIST_BASIC_FILE, built.basicOut],
    ];
}

function main() {
    const check = process.argv.includes('--check');
    const built = build();
    const { appPath, appName, sourceHash } = built;
    const artifacts = artifactsOf(built);

    if (check) {
        // Check every artifact before exiting so one run reports all the stale/missing files.
        let failed = false;
        for (const [label, file, expected] of artifacts) {
            if (!fs.existsSync(file)) {
                console.error(`${label} is missing. Run: node scripts/build_deployable.js`);
                failed = true;
            } else if (fs.readFileSync(file, 'utf8') !== expected) {
                console.error(`${label} is STALE -- it does not match a fresh build of ${appName}.`);
                console.error('Run: node scripts/build_deployable.js   and commit the result.');
                failed = true;
            } else {
                console.log(`${label} is up to date with ${appName} (source-sha256 ${sourceHash.slice(0, 12)}).`);
            }
        }
        if (failed) process.exit(1);
        return;
    }

    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    for (const [label, file, content] of artifacts) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        console.log(`built ${label} from ${appName}`);
        console.log(`  source ${kb(fs.statSync(appPath).size)} -> artifact ${kb(fs.statSync(file).size)}`);
    }
    console.log(`  source-sha256 ${sourceHash.slice(0, 12)}`);
}

// Guarded like tests/perf_benchmark.js's own require.main check, for the same reason: this
// file is import-safe (build() is required by nothing today, but should stay side-effect-free
// to require()) rather than running a build as a side effect of being loaded.
if (require.main === module) {
    main();
}

module.exports = { extractCompiledPayload };

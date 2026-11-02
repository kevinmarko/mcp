/**
 * THE one implementation of "which file is the current app".
 *
 * Every other script that needs the answer gets it from here: JS requires this module (directly, or
 * through tests/perf_benchmark.js, which re-exports it), and Python and CI call
 * `node scripts/print_app_file.js`. tests/check_resolve_app_html.js fails if a new hand-copied
 * version of the rule appears anywhere under tests/, scripts/ or .github/.
 *
 * It lives here, not in a test harness, because the build (scripts/build_deployable.js), the CLI
 * (scripts/print_app_file.js) and a dozen checks depend on it: a rule that the deploy build relies on
 * should not sit inside a Playwright benchmark file whose edits are about something else. This
 * module needs nothing but Node's fs and path, so it runs anywhere Node does with no `npm install`.
 *
 * Why it exists: the rule used to be pasted into ~10 places, and the copies had drifted. With two
 * non-testing files at the same version the JS copies took the LAST in listing order and the Python
 * copies the FIRST, and "2.0" vs "2.0.0" resolved differently too -- so two checks could silently
 * validate two different files.
 *
 * The rule: match both naming eras, exclude testing builds, take the highest dotted version
 * (compared numerically, a missing part counting as 0). If two files tie for highest it THROWS
 * instead of guessing -- an ambiguous "current app" must be fixed by a human, not resolved
 * differently by each caller.
 *
 * pickCurrentAppHtml is the pure part (names in, answer out) so the rule can be tested without a
 * filesystem. findCurrentAppHtml reads the repo root and logs which testing builds it skipped
 * (to stdout, via console.log -- scripts/print_app_file.js deliberately does NOT use it, because
 * that CLI keeps stdout to a single file name).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const APP_HTML_NAME_RE = /^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$/;

function pickCurrentAppHtml(fileNames) {
    const all = fileNames.filter((f) => APP_HTML_NAME_RE.test(f));
    // Exclude testing builds BEFORE comparing versions -- benchmarking the testing build against a
    // baseline recorded on the main file would compare two different apps.
    const excluded = all.filter((f) => /testing/i.test(f)).sort();
    const candidates = all.filter((f) => !/testing/i.test(f));
    if (candidates.length === 0) {
        throw new Error('No main Booking_flash_report_na*.html file found');
    }
    const versionKey = (fname) => {
        const m = /na_(?:Kevin_)?([\d.]+)_/.exec(fname);
        return m ? m[1].split('.').map(Number) : [0];
    };
    const cmp = (a, b) => {
        const va = versionKey(a), vb = versionKey(b);
        for (let i = 0; i < Math.max(va.length, vb.length); i++) {
            const d = (va[i] || 0) - (vb[i] || 0);
            if (d !== 0) return d;
        }
        return 0;
    };
    const sorted = candidates.slice().sort(cmp);
    const file = sorted[sorted.length - 1];
    const tied = sorted.filter((f) => cmp(f, file) === 0).sort();
    if (tied.length > 1) {
        throw new Error(`Ambiguous current app file: ${tied.join(' and ')} have the same highest version. Rename or move one so exactly one non-testing file has the highest version.`);
    }
    return { file, excluded };
}

function findCurrentAppHtml() {
    const { file, excluded } = pickCurrentAppHtml(fs.readdirSync(REPO_ROOT));
    if (excluded.length > 0) {
        console.log(`(excluded as testing builds: ${excluded.join(', ')})`);
    }
    return path.join(REPO_ROOT, file);
}

module.exports = { APP_HTML_NAME_RE, pickCurrentAppHtml, findCurrentAppHtml, REPO_ROOT };

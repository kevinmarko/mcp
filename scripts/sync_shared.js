#!/usr/bin/env node
/**
 * Writes the shared logic (the files in shared/) into the two places that run it, and checks that
 * they are current. Same pattern as dist/index.html and scripts/build_deployable.js --check.
 *
 *   node scripts/sync_shared.js            # write both outputs
 *   node scripts/sync_shared.js --check    # write nothing; exit 1 if either output is stale
 *   node scripts/sync_shared.js --root=DIR # operate on another repo-shaped directory (tests use
 *                                          # throwaway copies); default is this repo's root
 *
 * The two outputs:
 *   1. The current app HTML (found with pickCurrentAppHtml, never by file name): everything between
 *      its two marker lines, `>>> BEGIN GENERATED SHARED LOGIC` and `<<< END GENERATED SHARED LOGIC`,
 *      is replaced by the shipped text indented 8 spaces. Both marker lines are kept byte for byte.
 *      A missing, duplicated or misplaced marker is an error (exit 1); the script never guesses a
 *      position.
 *   2. apps-script/Shared.gs: a "generated, do not edit" header, then the same text unindented.
 *      Apps Script has no `require`, so this one file defines the global BFShared.
 *
 * Exit codes: 0 = written / in sync; 1 = stale (--check), unsafe shared source, bad markers, no app
 * file, or any file-system error (a clean message, never a stack trace); 2 = bad command line.
 * Output is deterministic and the script is idempotent: a second run changes nothing. The text itself,
 * and why it refuses unsafe text, is in scripts/lib/shared.js. Local development still has no build
 * step: the app is opened over a static server as before; the only new step is running this after
 * editing shared/.
 *
 * HOW A WRITE IS MADE SAFE (writeOutputs). Both outputs are rendered in memory first. Then:
 *   1. Pre-flight: refuse an output that is a symbolic link (renaming over it would silently replace
 *      the link, and writing through a dangling one half-fails).
 *   2. Write EACH changed output to a temporary file in its own directory. If any of those writes
 *      fails, the temporary files are removed and nothing real has changed.
 *   3. Re-read every output immediately before the renames and abort, with a clear message, if one no
 *      longer matches what step one read. The app file has a single writer by rule, but this keeps a
 *      slow sync from overwriting an edit that landed meanwhile. It narrows the lost-update window to
 *      the gap between that re-read and the renames; it is not a lock.
 *   4. Rename the temporary files over the real ones. Each rename is atomic on its own; the pair is
 *      not, so if the second rename fails the message says which output was already replaced, and
 *      re-running the sync finishes the job.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pickCurrentAppHtml } = require('./lib/app_file.js');
const { REPO_ROOT, buildSharedSource, renderHtml, renderGs } = require('./lib/shared.js');

const GS_RELATIVE = 'apps-script/Shared.gs';
const RERUN = 'run: node scripts/sync_shared.js';

/** The file's text, or null when it does not exist (a dangling symlink counts as not existing). */
function readIfExists(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

/**
 * The message for the user, never a stack trace. A system error (it has a .code such as ENOENT) is cut
 * to its first line and prefixed with the code; our own errors are already worded for people and may
 * deliberately span lines (the list of unsafe-source problems), so they are printed whole.
 */
function describe(err) {
    const msg = String((err && err.message) || err);
    if (!(err && err.code)) return msg;
    const first = msg.split('\n')[0];
    return first.includes(err.code) ? first : `${err.code}: ${first}`;
}

/**
 * Computes both outputs under `root` without writing anything.
 * Returns [{ label, file, expected, actual }]; `actual` is null when the file does not exist.
 * Throws with a human-readable message on any unsafe input.
 */
function planOutputs(root) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`root directory not found: ${root}`);
    const { file: appName } = pickCurrentAppHtml(fs.readdirSync(root));
    const appFile = path.join(root, appName);
    const gsFile = path.join(root, ...GS_RELATIVE.split('/'));
    const shared = buildSharedSource({ root });
    const html = readIfExists(appFile);
    return [
        { label: appName, file: appFile, expected: renderHtml(html, shared), actual: html },
        { label: GS_RELATIVE, file: gsFile, expected: renderGs(shared), actual: readIfExists(gsFile) },
    ];
}

/**
 * Writes the outputs whose text differs from what is on disk, as described in the header. Returns the
 * list of labels written. Throws an Error with a one-line message when nothing could be (or, after a
 * partial rename, not everything could be) written. `hooks.beforeRename` is a test seam: it runs after
 * the temporary files exist and before the re-read, which is where a concurrent edit would land.
 */
function writeOutputs(outputs, hooks = {}) {
    const changed = outputs.filter((o) => o.actual !== o.expected);
    for (const o of changed) {
        const st = fs.lstatSync(o.file, { throwIfNoEntry: false });
        if (st && st.isSymbolicLink()) throw new Error(`${o.label} is a symbolic link; the sync will not replace it. Replace it with a regular file or remove it, then re-run.`);
    }
    const temps = [];
    // Cleanup must never mask the error that caused it, so it swallows its own failures.
    const dropTemps = () => temps.forEach((tmp) => { try { fs.rmSync(tmp, { force: true }); } catch (_) { /* best effort */ } });
    try {
        for (const o of changed) {
            const tmp = path.join(path.dirname(o.file), `.${path.basename(o.file)}.sync-${process.pid}.tmp`);
            fs.mkdirSync(path.dirname(o.file), { recursive: true });
            try {
                fs.writeFileSync(tmp, o.expected, { flag: 'wx' }); // wx: never overwrite something that is not ours
            } catch (err) {
                if (err.code !== 'EEXIST') temps.push(tmp); // a half-written file of ours; an EEXIST one is not ours
                throw err;
            }
            temps.push(tmp);
            const st = fs.statSync(o.file, { throwIfNoEntry: false });
            if (st) fs.chmodSync(tmp, st.mode & 0o777);
        }
        if (hooks.beforeRename) hooks.beforeRename();
        for (const o of changed) {
            if (readIfExists(o.file) !== o.actual) {
                throw new Error(`${o.label} changed while the sync was running; nothing was written. Re-run: node scripts/sync_shared.js`);
            }
        }
    } catch (err) {
        dropTemps();
        throw err;
    }
    const written = [];
    try {
        changed.forEach((o, i) => {
            fs.renameSync(temps[i], o.file);
            written.push(o.label);
        });
    } catch (err) {
        dropTemps();
        throw new Error(`${describe(err)}${written.length ? ` (${written.join(', ')} was already replaced; fix the cause and re-run the sync to finish)` : ''}`);
    }
    return written;
}

function parseArgs(argv) {
    const opts = { check: false, root: REPO_ROOT };
    for (const a of argv) {
        if (a === '--check') opts.check = true;
        else if (a.startsWith('--root=') && a.length > '--root='.length) opts.root = path.resolve(a.slice('--root='.length));
        else return { error: `unknown argument: ${a}\nusage: node scripts/sync_shared.js [--check] [--root=DIR]` };
    }
    return opts;
}

function main(argv) {
    const opts = parseArgs(argv);
    if (opts.error) { console.error(opts.error); return 2; }

    let outputs;
    try {
        outputs = planOutputs(opts.root);
    } catch (err) {
        console.error(`sync_shared: ${describe(err)}`);
        return 1;
    }

    if (opts.check) {
        // Report every stale output in one run, as build_deployable.js --check does.
        const stale = outputs.filter((o) => o.actual !== o.expected);
        for (const o of outputs) {
            if (o.actual === null) console.error(`${o.label} is MISSING.`);
            else if (o.actual !== o.expected) console.error(`${o.label} is STALE -- it does not match what shared/ produces.`);
        }
        if (stale.length) { console.error(RERUN); return 1; }
        console.log('shared logic is in sync');
        return 0;
    }

    let written;
    try {
        written = writeOutputs(outputs);
    } catch (err) {
        console.error(`sync_shared: ${describe(err)}`);
        return 1;
    }
    for (const o of outputs) {
        console.log(`${o.label}: ${!written.includes(o.label) ? 'unchanged' : o.actual === null ? 'created' : 'updated'}`);
    }
    return 0;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { planOutputs, writeOutputs, GS_RELATIVE };

#!/usr/bin/env node
/**
 * Writes the shared logic (the files in shared/) into the places that run it, and checks that they are
 * current. Same pattern as dist/index.html and scripts/build_deployable.js --check.
 *
 *   node scripts/sync_shared.js            # write every output
 *   node scripts/sync_shared.js --check    # write nothing; exit 1 if any output is stale
 *   node scripts/sync_shared.js --root=DIR # operate on another repo-shaped directory (tests use
 *                                          # throwaway copies); default is this repo's root
 *
 * The outputs, in this order:
 *   1. The current app HTML (found with pickCurrentAppHtml, never by file name): everything between
 *      its two marker lines, `>>> BEGIN GENERATED SHARED LOGIC` and `<<< END GENERATED SHARED LOGIC`,
 *      is replaced by one note line (generated, do not edit) and the shipped text indented 8 spaces.
 *      The shipped text is shared/'s code with every comment stripped by @babel/core (see
 *      scripts/lib/shared.js), so the browser never transforms the comments. Both marker lines are kept
 *      byte for byte.
 *      A missing, duplicated or misplaced marker is an error (exit 1); the script never guesses a
 *      position. So is an app file that is not a regular file (a directory, a FIFO, a device, a dangling
 *      link): it is checked before it is read, and the message names it.
 *   2. apps-script/Shared.gs: a "generated, do not edit" header, then the same comment-free text unindented.
 *      Apps Script has no `require`, so this one file defines the global BFShared.
 *   3. Every OTHER app build in the repo root that carries a marker line: a file whose name the
 *      app-file pattern matches (APP_HTML_NAME_RE in scripts/lib/app_file.js, the one definition of
 *      it) and that contains the BEGIN or the END marker text. In practice these are the testing
 *      builds (Booking_flash_report_na_2.5_TESTING.html was one until its promotion on 2026-10-11), which the current-app resolver
 *      deliberately skips, so without this rule their region would go stale the moment shared/
 *      changed. They are rendered by the same code as output 1 and listed under their own file name,
 *      in name order. A marker is the opt-in: a build with NEITHER marker (an older testing build, a
 *      frozen 1.x file) is ignored without a word and is never touched. A build with a marker that is
 *      malformed (one missing, duplicated, out of order, or not alone on its comment line; a build
 *      that kept only its END line counts) fails the whole run with the same message output 1 would
 *      give, prefixed with that file's name. A file that is not a regular file (a directory, a FIFO,
 *      a device, a dangling link) is skipped before it is read, so a stray entry can neither hang nor
 *      crash the sync; a symbolic link to a regular file is read, and refused for writing exactly
 *      like output 1 (see below).
 *
 * Exit codes: 0 = written / in sync; 1 = stale (--check), unsafe shared source, bad markers, no app
 * file, or any file-system error (a clean message, never a stack trace); 2 = bad command line.
 * Output is deterministic and the script is idempotent: a second run changes nothing. The text itself,
 * and why it refuses unsafe text, is in scripts/lib/shared.js. Local development still has no build
 * step: the app is opened over a static server as before; the only new step is running this after
 * editing shared/.
 *
 * HOW A WRITE IS MADE SAFE (writeOutputs). Every output (the testing builds included) is rendered in
 * memory first. Then:
 *   1. Pre-flight: refuse an output that is a symbolic link (renaming over it would silently replace
 *      the link, and writing through a dangling one half-fails) or anything else that is not a regular
 *      file. This looks at the outputs that would change, so a current symlinked output is not an error.
 *   2. Write EACH changed output to a temporary file in its own directory. The temporary name carries the
 *      process id AND a random suffix, and is created with the `wx` flag (never overwrite what is not
 *      ours), so a run that was killed and left its temporary file behind can never make a later run
 *      fail with EEXIST. If any of those writes fails, the temporary files are removed and nothing real
 *      has changed.
 *   3. Re-read every output immediately before the renames and abort, with a clear message, if one no
 *      longer matches what step one read. The app file has a single writer by rule, but this keeps a
 *      slow sync from overwriting an edit that landed meanwhile (a testing build is edited by hand far
 *      more often than the main file, so this matters most for them). It narrows the lost-update window
 *      to the gap between that re-read and the renames; it is not a lock.
 *   4. Rename the temporary files over the real ones. Each rename is atomic on its own; the set is
 *      not, so if a later rename fails the message says which outputs were already replaced, and
 *      re-running the sync finishes the job.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { APP_HTML_NAME_RE, pickCurrentAppHtml } = require('./lib/app_file.js');
const { REPO_ROOT, BEGIN_MARKER, END_MARKER, buildShippedSource, renderHtml, renderGs } = require('./lib/shared.js');

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
 * The other app builds under `root` that opted in to the generated region, as outputs. `names` is the
 * root's directory listing and `mainName` the current app file (output 1, never listed twice). A build
 * is any file the app-file pattern matches; it opts in by containing a marker. Either marker counts, so
 * a build that lost its BEGIN line but kept its END line fails loudly instead of being skipped as "has
 * no marker". Returned in name order, each labelled with its file name.
 */
function planOtherBuilds(root, names, mainName, sharedSource) {
    return names
        .filter((name) => name !== mainName && APP_HTML_NAME_RE.test(name))
        .sort()
        .flatMap((name) => {
            const file = path.join(root, name);
            // statSync follows a symbolic link, so a link to a regular file is read (and refused later, in
            // writeOutputs, like the main file) while a directory, a FIFO, a device or a dangling link is
            // skipped here. The FIFO matters most: reading one blocks forever.
            const st = fs.statSync(file, { throwIfNoEntry: false });
            if (!st || !st.isFile()) return [];
            const text = fs.readFileSync(file, 'utf8');
            if (!text.includes(BEGIN_MARKER) && !text.includes(END_MARKER)) return [];
            let expected;
            try {
                expected = renderHtml(text, sharedSource);
            } catch (err) {
                throw new Error(`${name}: ${err.message}`); // several builds can fail: say which one
            }
            return [{ label: name, file, expected, actual: text }];
        });
}

/**
 * The current app file's text. It is checked like the other builds before it is read (statSync follows a
 * symbolic link, so a link to a regular file is read, and refused for writing later in writeOutputs): a
 * directory, a FIFO, a device or a dangling link is an error that names the file, never a crash on a null
 * text and never a read that blocks forever (a FIFO).
 */
function readAppFile(file, name) {
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st) throw new Error(`the current app file ${name} cannot be read: it is a dangling symbolic link, or it no longer exists`);
    if (!st.isFile()) throw new Error(`the current app file ${name} is not a regular file (a directory, a FIFO or a device); the sync reads and writes only regular files. Replace it with a regular file, then re-run.`);
    const text = readIfExists(file);
    if (text === null) throw new Error(`the current app file ${name} cannot be read: it no longer exists`);
    return text;
}

/**
 * Computes every output under `root` without writing anything: the current app HTML, apps-script/Shared.gs,
 * then the other app builds that carry a marker (see the header).
 * Returns [{ label, file, expected, actual }]; `actual` is null when the file does not exist.
 * Throws with a human-readable message on any unsafe input.
 */
function planOutputs(root) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`root directory not found: ${root}`);
    const names = fs.readdirSync(root);
    const { file: appName } = pickCurrentAppHtml(names);
    const appFile = path.join(root, appName);
    const gsFile = path.join(root, ...GS_RELATIVE.split('/'));
    const html = readAppFile(appFile, appName);
    const shared = buildShippedSource({ root });
    return [
        { label: appName, file: appFile, expected: renderHtml(html, shared), actual: html },
        { label: GS_RELATIVE, file: gsFile, expected: renderGs(shared), actual: readIfExists(gsFile) },
        ...planOtherBuilds(root, names, appName, shared),
    ];
}

/**
 * Writes the outputs whose text differs from what is on disk, as described in the header. Returns the
 * list of labels written. Throws an Error with a one-line message when nothing could be (or, after a
 * partial rename, not everything could be) written. `hooks.beforeRename` is a test seam: it runs after
 * the temporary files exist and before the re-read, which is where a concurrent edit would land;
 * `hooks.tempSuffix` (a function returning the unique part of the temporary file name) is the seam that
 * lets a test occupy a temporary path, which a random name would otherwise make impossible.
 */
function writeOutputs(outputs, hooks = {}) {
    const changed = outputs.filter((o) => o.actual !== o.expected);
    for (const o of changed) {
        const st = fs.lstatSync(o.file, { throwIfNoEntry: false });
        if (st && st.isSymbolicLink()) throw new Error(`${o.label} is a symbolic link; the sync will not replace it. Replace it with a regular file or remove it, then re-run.`);
        if (st && !st.isFile()) throw new Error(`${o.label} is not a regular file; the sync will not replace it. Replace it with a regular file or remove it, then re-run.`);
    }
    const temps = [];
    // Cleanup must never mask the error that caused it, so it swallows its own failures.
    const dropTemps = () => temps.forEach((tmp) => { try { fs.rmSync(tmp, { force: true }); } catch (_) { /* best effort */ } });
    try {
        for (const o of changed) {
            const suffix = hooks.tempSuffix ? hooks.tempSuffix() : `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
            const tmp = path.join(path.dirname(o.file), `.${path.basename(o.file)}.sync-${suffix}.tmp`);
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

/**
 * The whole command: parses `argv` (the arguments after the script name), prints through `io` (console by
 * default; tests/check_shared_sync.js passes collectors so it can run most of its cases in one process,
 * with one @babel/core load, instead of spawning this script dozens of times) and returns the exit code.
 * Never throws for a bad input; every message goes to io.error, every report line to io.log.
 */
function main(argv, io = console) {
    const opts = parseArgs(argv);
    if (opts.error) { io.error(opts.error); return 2; }

    let outputs;
    try {
        outputs = planOutputs(opts.root);
    } catch (err) {
        io.error(`sync_shared: ${describe(err)}`);
        return 1;
    }

    if (opts.check) {
        // Report every stale output in one run, as build_deployable.js --check does.
        const stale = outputs.filter((o) => o.actual !== o.expected);
        for (const o of outputs) {
            if (o.actual === null) io.error(`${o.label} is MISSING.`);
            else if (o.actual !== o.expected) io.error(`${o.label} is STALE -- it does not match what shared/ produces.`);
        }
        if (stale.length) { io.error(RERUN); return 1; }
        io.log('shared logic is in sync');
        return 0;
    }

    let written;
    try {
        written = writeOutputs(outputs);
    } catch (err) {
        io.error(`sync_shared: ${describe(err)}`);
        return 1;
    }
    for (const o of outputs) {
        io.log(`${o.label}: ${!written.includes(o.label) ? 'unchanged' : o.actual === null ? 'created' : 'updated'}`);
    }
    return 0;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, parseArgs, planOutputs, writeOutputs, GS_RELATIVE };

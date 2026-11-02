#!/usr/bin/env node
/**
 * Headless check for scripts/land.js (the local merge queue) and its stamp helpers in scripts/lib/landing.js.
 *
 * Why this exists: PR #186 and PR #185 were each green alone and each tested against an older main; merged
 * together they were wrong with no textual conflict. land.js builds the merge onto the CURRENT main in a scratch
 * worktree, runs the gate on that exact tree, and pushes only if main has not moved (else it starts over). This
 * check proves those promises against real git, in throwaway repositories:
 *
 *   - a bare "origin", a "user" clone with a dirty checkout (never to be touched), and an "other session" clone
 *     that pushes to main while a gate is running (the race the whole tool exists for);
 *   - pull-request refs made with `git update-ref refs/pull/<n>/head <sha>` in the bare repo;
 *   - a stub gate that records what it saw (env, cwd, files), can move main under land.js, fail, or dirty the tree.
 *
 * It asserts GIT STATE (remote refs, parents, trees, worktree list, the user's checkout) before output wording.
 * The stamp tests write the expected commit-message layout by hand from the spec (docs and the plan section 3.3),
 * so a drift in landing.js cannot hide behind its own formatter. Needs only Node and git: no network, no browser.
 *
 * LAND_SCRIPT_DIR (optional) points the check at another copy of the scripts directory (it must contain land.js
 * and lib/landing.js). That is how the mutation check runs this file against a deliberately broken copy.
 *
 * EXPECTED below is an executed-count tripwire like tests/check_resolve_app_html.js: an assertion that is silently
 * dropped fails the check instead of leaving a green run with a hole in it. Assertions are unconditional (they do
 * not depend on an earlier result), so the count is the same whether the code under test is right or wrong.
 *
 * Run:  node tests/check_land_script.js        (about 1-2 minutes; Node builtins and git only)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { inspect } = require('util');
const { spawnSync } = require('child_process');

const SCRIPT_DIR = process.env.LAND_SCRIPT_DIR
    ? path.resolve(process.env.LAND_SCRIPT_DIR)
    : path.resolve(__dirname, '..', 'scripts');
const LAND = path.join(SCRIPT_DIR, 'land.js');
const LANDING = path.join(SCRIPT_DIR, 'lib', 'landing.js');

let pass = 0;
const failures = [];
function same(got, want) {
    try { assert.deepStrictEqual(got, want); return true; } catch (e) { return false; }
}
function t(name, got, want, extra) {
    if (same(got, want)) {
        pass++;
    } else {
        failures.push(`${name}\n      got:  ${inspect(got, { depth: 6 })}\n      want: ${inspect(want, { depth: 6 })}` +
            (extra ? `\n      ${String(extra).split('\n').join('\n      ')}` : ''));
    }
}
function ok(name, cond, detail) {
    if (cond) pass++;
    else failures.push(`${name}${detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
}
function tail(s, n) {
    s = String(s || '');
    n = n || 1800;
    return s.length > n ? '...' + s.slice(-n) : s;
}
// Run a function and return its value, or a marker object if it threw (so one broken helper is one failure, not a crash).
function attempt(fn) {
    try { return fn(); } catch (e) { return { THREW: String(e && e.message || e).split('\n')[0] }; }
}

// ============================================================================================
// Isolated git environment. Nothing from the developer's own git configuration may leak in, and no variable of the
// outer process (GIT_DIR, LAND_*, an outer worktree) may redirect a command at the real repository.
// ============================================================================================
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'land-check-'));
const HOME = path.join(ROOT, 'home');
fs.mkdirSync(HOME);
fs.writeFileSync(path.join(HOME, '.gitconfig'), '[init]\n\tdefaultBranch = main\n[gc]\n\tauto = 0\n[advice]\n\tdetachedHead = false\n');

const IDENTITY = {
    GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'author@example.test',
    GIT_COMMITTER_NAME: 'Test Committer', GIT_COMMITTER_EMAIL: 'committer@example.test',
};
function cleanEnv() {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (/^(GIT_|LAND_|GATE_|FAKE_CI_|OTHER_CLONE|EMAIL$)/.test(k)) continue;
        env[k] = v;
    }
    env.HOME = HOME;
    env.XDG_CONFIG_HOME = path.join(HOME, 'xdg');
    env.GIT_CONFIG_NOSYSTEM = '1';
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_CEILING_DIRECTORIES = ROOT;
    env.LC_ALL = 'C';
    return env;
}
const GIT_ENV = Object.assign(cleanEnv(), IDENTITY);
// No identity anywhere, and git forbidden from guessing one: land.js must supply its own (or use the repo's config).
const NOID_ENV = Object.assign(cleanEnv(), { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true' });

function gitRaw(cwd, args, env) {
    return spawnSync('git', args, { cwd, env: env || GIT_ENV, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
}
function git(cwd, args, env) {
    const r = gitRaw(cwd, args, env);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} (in ${cwd}) failed: ${r.stderr || r.error}`);
    return r.stdout.trim();
}

// ============================================================================================
// The stub gate. It runs with cwd = whatever land.js chose, records what it saw, and obeys GATE_* variables.
// ============================================================================================
const GATE = path.join(ROOT, 'gate.js');
fs.writeFileSync(GATE, `'use strict';
const fs = require('fs');
const cp = require('child_process');
const env = process.env;
const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return null; } };
const entry = {
    attempt: env.LAND_ATTEMPT || null, base: env.LAND_BASE_SHA || null, head: env.LAND_HEAD_SHA || null,
    worktreeEnv: env.LAND_WORKTREE ? real(env.LAND_WORKTREE) : null, cwd: real(process.cwd()),
    files: fs.readdirSync('.').sort(), hasNodeModules: fs.existsSync('node_modules/marker.txt'), missing: [], moved: null,
};
for (const f of (env.GATE_REQUIRE || '').split(',').filter(Boolean)) if (!fs.existsSync(f)) entry.missing.push(f);
const moveOn = (env.GATE_MOVE_ON || '').split(',').filter(Boolean);
if (moveOn.indexOf('all') >= 0 || moveOn.indexOf(String(env.LAND_ATTEMPT)) >= 0) {
    const o = env.OTHER_CLONE;
    const g = function () { return cp.execFileSync('git', Array.prototype.slice.call(arguments), { cwd: o, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); };
    g('fetch', '-q', 'origin');
    g('checkout', '-q', '-B', 'main', 'origin/main');
    fs.writeFileSync(o + '/moved-' + env.LAND_ATTEMPT + '.txt', 'moved by another session\\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'another session moves main (attempt ' + env.LAND_ATTEMPT + ')');
    g('push', '-q', 'origin', 'main:refs/heads/main');
    entry.moved = g('rev-parse', 'HEAD');
}
if (env.GATE_DIRTY === '1') fs.appendFileSync('shared.txt', 'the gate modified a tracked file\\n');
fs.appendFileSync(env.GATE_LOG, JSON.stringify(entry) + '\\n');
if (env.GATE_SUMMARY === '1') {
    console.log('==================== Live regression suite -- dist/index.html ====================');
    console.log('Executed checks: 12 (expect 12), per suite:');
    console.log('Passed: 12 / 12');
    console.log('==================== Summary ====================');
    console.log('\\u2705 Job one: PASS (1s)');
    console.log('\\u2705 Job two: PASS (2s)');
    console.log('\\u23ED\\uFE0F  Job three: skipped (--fast)');
    console.log('\\nLOCAL CI PASSED (every blocking job)');
}
process.exit(entry.missing.length ? 9 : Number(env.GATE_EXIT || 0));
`);
const STUB = `node "${GATE}"`;

// ============================================================================================
// A throwaway world: bare origin, the user's clone (dirty on purpose), and another session's clone.
// ============================================================================================
const SHARED_BASE = Array.from({ length: 30 }, (_, i) => `line ${String(i + 1).padStart(2, '0')}`);
function sharedWith(edits) {
    const lines = SHARED_BASE.slice();
    for (const [n, v] of Object.entries(edits)) lines[Number(n) - 1] = v;
    return lines.join('\n') + '\n';
}
const FAKE_CI = `'use strict';
const fs = require('fs');
fs.appendFileSync(process.env.FAKE_CI_LOG, JSON.stringify({ args: process.argv.slice(2), attempt: process.env.LAND_ATTEMPT || null }) + '\\n');
process.exit(0);
`;
function writeFiles(dir, files) {
    for (const [f, c] of Object.entries(files)) {
        const p = path.join(dir, f);
        if (c === null) { fs.rmSync(p, { force: true }); continue; }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, c);
    }
}
function makeWorld() {
    const dir = fs.mkdtempSync(path.join(ROOT, 'w-'));
    const w = {
        dir, origin: path.join(dir, 'origin.git'), other: path.join(dir, 'other'), work: path.join(dir, 'work'),
        tmp: path.join(dir, 'tmp'), gateLog: path.join(dir, 'gate.log'), ciLog: path.join(dir, 'ci.log'),
    };
    fs.mkdirSync(w.tmp);
    git(dir, ['init', '-q', '--bare', '-b', 'main', w.origin]);
    git(dir, ['init', '-q', '-b', 'main', w.other]);
    git(w.other, ['remote', 'add', 'origin', w.origin]);
    writeFiles(w.other, {
        '.gitignore': 'node_modules/\n',
        'shared.txt': sharedWith({}),
        'base-only.txt': 'base only\n',
        'docs/guide.md': 'guide\n',
        'NOTES.md': 'notes\n',
        '.github/pull_request_template.md': 'template\n',
        'README.md': 'readme\n',
        'scripts/run_ci_locally.js': FAKE_CI,
    });
    git(w.other, ['add', '-A']);
    git(w.other, ['commit', '-q', '-m', 'base']);
    git(w.other, ['push', '-q', 'origin', 'main:refs/heads/main']);
    w.baseSha = git(w.other, ['rev-parse', 'HEAD']);
    git(dir, ['clone', '-q', w.origin, w.work]);
    // The user's checkout: on a work-in-progress branch with a modified tracked file, an untracked file and an ignored
    // node_modules. None of it may change, whatever land.js does.
    git(w.work, ['checkout', '-q', '-b', 'wip']);
    fs.appendFileSync(path.join(w.work, 'README.md'), 'uncommitted edit by the user\n');
    fs.writeFileSync(path.join(w.work, 'scratch.txt'), 'untracked scratch\n');
    fs.mkdirSync(path.join(w.work, 'node_modules'));
    fs.writeFileSync(path.join(w.work, 'node_modules', 'marker.txt'), 'dependency\n');
    return w;
}
// Commit on `branch` (created from o.from, default origin/main) in the other session's clone and push it.
function commit(w, branch, files, o) {
    o = o || {};
    const g = (...a) => git(w.other, a);
    g('fetch', '-q', 'origin');
    g('checkout', '-q', '-B', branch, o.from || 'origin/main');
    writeFiles(w.other, files);
    g('add', '-A');
    g('commit', '-q', '-m', o.msg || `change on ${branch}`);
    if (!o.noPush) g('push', '-q', 'origin', `${branch}:refs/heads/${branch}`);
    return g('rev-parse', 'HEAD');
}
function makePr(w, n, branch, files, o) {
    const sha = commit(w, branch, files, o);
    git(w.origin, ['update-ref', `refs/pull/${n}/head`, sha]);
    return sha;
}
const originMain = (w) => git(w.origin, ['rev-parse', 'refs/heads/main']);
const originRefs = (w) => git(w.origin, ['for-each-ref', '--format=%(refname) %(objectname)']);
const parentsOf = (w, sha) => git(w.origin, ['rev-list', '--parents', '-n1', sha]).split(' ').slice(1);
const msgOf = (w, sha) => git(w.origin, ['log', '-1', '--format=%B', sha]);
const treeOf = (w, sha) => git(w.origin, ['rev-parse', `${sha}^{tree}`]);
const isAncestor = (w, a, b) => gitRaw(w.origin, ['merge-base', '--is-ancestor', a, b]).status === 0;
const filesAt = (w, sha) => git(w.origin, ['ls-tree', '-r', '--name-only', sha]).split('\n');
function readLog(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function snap(w) {
    return {
        head: git(w.work, ['rev-parse', 'HEAD']),
        branch: git(w.work, ['symbolic-ref', '-q', 'HEAD']),
        status: git(w.work, ['status', '--porcelain']),
        refs: git(w.work, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags', 'refs/stash']),
        readme: fs.readFileSync(path.join(w.work, 'README.md'), 'utf8'),
        scratch: fs.readFileSync(path.join(w.work, 'scratch.txt'), 'utf8'),
        nodeModules: fs.existsSync(path.join(w.work, 'node_modules', 'marker.txt')),
    };
}
const worktreeCount = (w) => git(w.work, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length;
const sync = (w) => git(w.work, ['fetch', '-q', 'origin']);

// An independent reader for a landed commit message: the last run of Landed-* lines, and what follows it.
function readStamp(msg) {
    const lines = msg.split('\n');
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith('Landed-Base: ')) { start = i; break; }
    if (start < 0) return null;
    const fields = {};
    let i = start;
    for (; i < lines.length && /^Landed-[A-Za-z-]+: /.test(lines[i]); i++) {
        const m = /^(Landed-[A-Za-z-]+): (.*)$/.exec(lines[i]);
        fields[m[1]] = m[2];
    }
    return { fields, after: lines.slice(i).filter((l) => l !== ''), lines: lines.slice(start, i) };
}
// The stamp as the spec lays it out (plan section 3.3), written independently of landing.js.
function stampText(o) {
    return [
        o.subject || 'Land hand-made', '',
        'Landed through scripts/land.js: this exact tree passed the gate before it was pushed.', '',
        `Landed-Base: ${o.base}`, `Landed-Head: ${o.head}`, `Landed-Tree: ${o.tree}`,
        `Landed-Gate: ${o.gate || 'node scripts/run_ci_locally.js'}`, `Landed-Gate-Result: ${o.result || 'PASS'}`,
        'Landed-At: 2026-10-06T12:34:56Z', 'Landed-Attempt: 1',
    ].concat(o.extra || []).join('\n') + '\n';
}

// ============================================================================================
// Running land.js, and the checks that apply to EVERY run (so no scenario can forget them).
// ============================================================================================
function runLand(w, args, o) {
    o = o || {};
    const env = Object.assign({}, o.noIdentity ? NOID_ENV : GIT_ENV,
        // os.tmpdir() reads TEMP / TMP on Windows and TMPDIR elsewhere: set all three so land.js's scratch worktree lands in w.tmp on every platform.
        { TMPDIR: w.tmp, TEMP: w.tmp, TMP: w.tmp, GATE_LOG: w.gateLog, FAKE_CI_LOG: w.ciLog, OTHER_CLONE: w.other }, o.env || {});
    const r = spawnSync(process.execPath, [LAND].concat(args), {
        cwd: o.cwd || w.work, env, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
    });
    let json = null;
    let jsonOk = false;
    if (args.indexOf('--json') >= 0) {
        try { json = JSON.parse(r.stdout); jsonOk = !!json && typeof json === 'object' && !Array.isArray(json); } catch (e) { json = null; }
    }
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json, jsonOk, signal: r.signal, error: r.error };
}
// run + the universal assertions: user's checkout untouched, stdout hygiene, no scratch worktree left behind.
function land(label, w, args, o) {
    o = o || {};
    const before = snap(w);
    const r = runLand(w, args, o);
    t(`${label}: the user's checkout (HEAD, branch, status, local refs, dirty files) is untouched`, snap(w), before);
    if (args.indexOf('--json') >= 0) {
        ok(`${label}: with --json stdout is exactly one JSON object`, r.jsonOk, `stdout=${inspect(r.stdout.slice(0, 300))}\nstderr=${tail(r.stderr, 600)}`);
    } else {
        t(`${label}: without --json stdout is empty`, r.stdout, '');
    }
    const leftover = fs.readdirSync(w.tmp).filter((n) => n.startsWith('land-'));
    t(`${label}: scratch worktree ${o.keep ? 'kept (--keep)' : 'removed'}: git worktree list and the temp dir agree`,
        { worktrees: worktreeCount(w), leftover: leftover.length > 0 }, { worktrees: o.keep ? 2 : 1, leftover: !!o.keep });
    return r;
}
function code(label, r, want) {
    t(`${label}: exit code`, r.status, want, `stderr tail:\n${tail(r.stderr)}`);
}
function assertLanded(label, w, r, baseSha, headSha) {
    code(label, r, 0);
    const tip = originMain(w);
    t(`${label}: origin main is a merge commit with exactly 2 parents [base, head]`, parentsOf(w, tip), [baseSha, headSha]);
    ok(`${label}: the PR head is an ancestor of origin main (this is what makes the PR show as merged)`, isAncestor(w, headSha, tip));
    return tip;
}

// ============================================================================================
// 1. Unit: scripts/lib/landing.js
// ============================================================================================
const L = attempt(() => require(LANDING));
const A40 = 'a'.repeat(40), B40 = 'b'.repeat(40), C40 = 'c'.repeat(40), D40 = 'd'.repeat(40), E40 = 'e'.repeat(40);
const F = {
    subject: 'Land #7', base: A40, head: B40, tree: C40, gate: 'node scripts/run_ci_locally.js', gateResult: 'PASS',
    jobs: { passed: 2, failed: 0, skipped: 1 },
    counts: [{ name: 'Regression', executed: 473, total: 473 }, { name: 'Other', executed: 5, total: 6 }],
    at: '2026-10-06T12:34:56Z', attempt: 2, trailers: ['Co-Authored-By: A Person <a@example.test>'],
};
const fmt = (f) => attempt(() => L.formatStamp(f));
const parse = (m) => attempt(() => L.parseStamp(m));
const stampFields = (f) => ({ base: f.base, head: f.head, tree: f.tree, gate: f.gate, gateResult: f.gateResult, jobs: f.jobs, counts: f.counts, at: f.at, attempt: f.attempt });
t('landing.js loads and exports formatStamp, parseStamp, parseGateSummary',
    attempt(() => ['formatStamp', 'parseStamp', 'parseGateSummary'].map((k) => typeof L[k])), ['function', 'function', 'function']);

const EXPECT_MESSAGE = [
    'Land #7', '',
    'Landed through scripts/land.js: this exact tree passed the gate before it was pushed.', '',
    `Landed-Base: ${A40}`, `Landed-Head: ${B40}`, `Landed-Tree: ${C40}`,
    'Landed-Gate: node scripts/run_ci_locally.js', 'Landed-Gate-Result: PASS',
    'Landed-Gate-Jobs: 2 passed, 0 failed, 1 skipped', 'Landed-Counts: Regression=473/473; Other=5/6',
    'Landed-At: 2026-10-06T12:34:56Z', 'Landed-Attempt: 2', 'Co-Authored-By: A Person <a@example.test>',
].join('\n');
t('formatStamp: the full message has exactly the spec layout (subject, sentence, Landed-* block, then --trailer lines)',
    String(fmt(F)).replace(/\s+$/, ''), EXPECT_MESSAGE);
t('parseStamp(formatStamp(f)) round-trips every stamp field (jobs and counts populated)', parse(fmt(F)), stampFields(F));

const FN = Object.assign({}, F, { jobs: null, counts: [], trailers: [] });
const msgN = String(fmt(FN));
ok('formatStamp: the optional Landed-Gate-Jobs and Landed-Counts lines are omitted when jobs is null and counts is empty',
    !/^Landed-Gate-Jobs:/m.test(msgN) && !/^Landed-Counts:/m.test(msgN), msgN);
t('parseStamp(formatStamp(f)) round-trips with jobs null and counts []', parse(msgN), stampFields(FN));

t('parseStamp: null for a message that has no stamp', parse('Fix a bug\n\nJust a normal commit message.\n'), null);
t('parseStamp: null for the empty string', parse(''), null);
t('parseStamp: null when Landed-Head is 39 hex characters',
    parse(msgN.replace(`Landed-Head: ${B40}`, `Landed-Head: ${B40.slice(1)}`)), null);
t('parseStamp: null when Landed-Head is 40 characters but not hex',
    parse(msgN.replace(`Landed-Head: ${B40}`, `Landed-Head: ${'g'.repeat(40)}`)), null);
t('parseStamp: null when Landed-Tree is missing',
    parse(msgN.split('\n').filter((l) => !l.startsWith('Landed-Tree:')).join('\n')), null);
t('parseStamp: null when Landed-Base is missing',
    parse(msgN.split('\n').filter((l) => !l.startsWith('Landed-Base:')).join('\n')), null);
t('parseStamp: null when Landed-Gate-Result is missing',
    parse(msgN.split('\n').filter((l) => !l.startsWith('Landed-Gate-Result:')).join('\n')), null);

const quoted = `Title\n\nQuoted from the PR description:\nLanded-Base: ${D40}\nLanded-Head: ${D40}\nLanded-Tree: ${D40}\nLanded-Gate-Result: PASS\n\n`;
t('parseStamp: a Landed-* block quoted in the body ABOVE the real stamp does not leak (injection)',
    parse(quoted + fmt(FN)), stampFields(FN));
t('parseStamp: with two full stamp blocks only the LAST one counts',
    parse(String(fmt(Object.assign({}, FN, { tree: E40, attempt: 1 }))) + '\n' + fmt(FN)), stampFields(FN));
const inj = String(fmt(Object.assign({}, FN, { subject: `Land #9\nLanded-Tree: ${D40}\r\nLanded-Base: ${D40}` })));
t('formatStamp: newlines in the subject are stripped (the subject stays one line, the blank line follows it)',
    { oneSubject: inj.split('\n')[1] === '', treeLines: (inj.match(/^Landed-Tree:/mg) || []).length, baseLines: (inj.match(/^Landed-Base:/mg) || []).length, cr: inj.indexOf('\r') >= 0 },
    { oneSubject: true, treeLines: 1, baseLines: 1, cr: false }, inj);
t('parseStamp: a subject that tried to inject Landed-* lines cannot change the parsed tree or base', parse(inj), stampFields(FN));
t('parseStamp: --trailer lines after the Landed-* block do not disturb parsing', parse(fmt(F)).attempt, 2);

const SUMMARY = [
    '==================== App-file resolver check ====================',
    'Setup took 12s, retried 4 times',
    '',
    '==================== Summary ====================',
    '✅ App-file resolver check: PASS (1s)',
    '✅ Date timezone-safety check: PASS (2s)',
    '❌ Historical-days helper check: FAIL (3s)',
    '⏭️  Live regression suite -- dist/index.html: skipped (--fast)',
    '⏭️  Basic build (no Google services) check: skipped (--fast)',
    '⏭️  Row-highlight budget -- source: skipped (--fast)',
    '',
    'LOCAL CI FAILED -- 1 blocking job(s)',
    '',
].join('\n');
const gs = attempt(() => L.parseGateSummary(SUMMARY));
t('parseGateSummary: counts PASS, FAIL and skipped rows of run_ci_locally.js\'s real summary format',
    { passed: gs.passed, failed: gs.failed, skipped: gs.skipped }, { passed: 2, failed: 1, skipped: 3 });
t('parseGateSummary: never invents counts from a summary that prints none', gs.counts, []);
const gs2 = attempt(() => L.parseGateSummary('Setup took 12s, 4 retries on 2026-10-06 in a/b/c\nbuild 7 files\n'));
t('parseGateSummary: numbers that are not N/M check totals produce no counts and no job rows',
    { passed: gs2.passed, failed: gs2.failed, skipped: gs2.skipped, counts: gs2.counts }, { passed: 0, failed: 0, skipped: 0, counts: [] });
t('parseGateSummary: the empty string is all zeros', attempt(() => L.parseGateSummary('')), { passed: 0, failed: 0, skipped: 0, counts: [] });
const RUNNER = [
    '==================== Live regression suite -- dist/index.html ====================',
    'Target: main (suite ran as main); expected executed checks for it: 473',
    'Executed checks: 473 (expect 473), per suite:',
    'Passed: 473 / 473',
    '',
].join('\n');
const gs3 = attempt(() => L.parseGateSummary(RUNNER + SUMMARY));
ok('parseGateSummary: the regression runner\'s real "Executed checks: N (expect M)" / "Passed: N / M" output yields an executed/total count',
    Array.isArray(gs3.counts) && gs3.counts.some((c) => c.executed === 473 && c.total === 473 && typeof c.name === 'string' && c.name.length > 0),
    inspect(gs3));
ok('parseGateSummary: every reported count is made of integers that appear literally in the text (nothing invented)',
    Array.isArray(gs3.counts) && gs3.counts.every((c) => Number.isInteger(c.executed) && Number.isInteger(c.total) &&
        (RUNNER + SUMMARY).indexOf(String(c.executed)) >= 0 && (RUNNER + SUMMARY).indexOf(String(c.total)) >= 0),
    inspect(gs3));
t('parseGateSummary: the job rows are still counted correctly when runner output precedes the summary',
    { passed: gs3.passed, failed: gs3.failed, skipped: gs3.skipped }, { passed: 2, failed: 1, skipped: 3 });

// ============================================================================================
// 2. Happy path by PR number (+ 9 already landed, 10 the gate sees the merged tree elsewhere, 12 checkout untouched,
//    node_modules symlink, stdout hygiene)
// ============================================================================================
function scenarioHappy() {
    const w = makeWorld();
    const head = makePr(w, 7, 'topic/happy', { 'head-only.txt': 'from the head\n' });
    const base = originMain(w);
    const r = land('happy by PR number', w, ['7', '--gate', STUB, '--json'], { env: { GATE_REQUIRE: 'base-only.txt,head-only.txt', GATE_SUMMARY: '1' } });
    const tip = assertLanded('happy by PR number', w, r, base, head);
    t('happy: origin main moved off the base', tip !== base, true);
    t('happy: JSON result, mergeCommit, tree, base, head and attempts',
        r.json && { result: r.json.result, mergeCommit: r.json.mergeCommit, tree: r.json.tree, base: r.json.base, head: r.json.head, attempts: r.json.attempts },
        { result: 'landed', mergeCommit: tip, tree: treeOf(w, tip), base, head, attempts: 1 });
    t('happy: a branch that is not behind main and not stacked raises no warnings', r.json && r.json.warnings, []);
    const msg = msgOf(w, tip);
    const st = readStamp(msg);
    t('happy: first line of the merge commit is the default subject "Land #7"', msg.split('\n')[0], 'Land #7');
    t('happy: the main tree equals the stamp\'s Landed-Tree (the tested tree is the shipped tree)',
        { main: treeOf(w, tip), stamp: st && st.fields['Landed-Tree'] }, { main: treeOf(w, tip), stamp: treeOf(w, tip) });
    t('happy: the stamp records base, head, PASS, attempt 1 and the exact gate command',
        st && { b: st.fields['Landed-Base'], h: st.fields['Landed-Head'], r: st.fields['Landed-Gate-Result'], a: st.fields['Landed-Attempt'], g: st.fields['Landed-Gate'] },
        { b: base, h: head, r: 'PASS', a: '1', g: STUB });
    ok('happy: Landed-At is an ISO-8601 UTC time', !!st && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(st.fields['Landed-At'] || ''), inspect(st && st.fields));
    const ps = parse(msg);
    t('happy: landing.js parseStamp reads its own landed commit (tree, base, head, PASS)',
        ps && { tree: ps.tree, base: ps.base, head: ps.head, r: ps.gateResult }, { tree: treeOf(w, tip), base, head, r: 'PASS' });
    t('happy: the job summary the gate printed is stamped (2 passed, 0 failed, 1 skipped)', ps && ps.jobs, { passed: 2, failed: 0, skipped: 1 });
    ok('happy: the regression runner\'s executed-check totals (12 of 12) the gate printed are stamped as a count',
        !!ps && Array.isArray(ps.counts) && ps.counts.some((c) => c.executed === 12 && c.total === 12), inspect(ps));
    t('happy: JSON counts equal the stamped counts', r.json && r.json.counts, ps && ps.counts);
    ok('happy: the gate\'s own output is teed to land.js\'s stderr', r.stderr.indexOf('Job one: PASS') >= 0, tail(r.stderr, 800));
    ok('happy: human log lines go to stderr prefixed "land: "', /^land: /m.test(r.stderr), tail(r.stderr, 800));

    const log = readLog(w.gateLog);
    const real = (p) => fs.realpathSync(p);
    t('happy: the gate ran exactly once', log.length, 1);
    const g0 = log[0] || {};
    t('happy: the gate was given LAND_ATTEMPT=1, LAND_BASE_SHA and LAND_HEAD_SHA', { a: g0.attempt, b: g0.base, h: g0.head }, { a: '1', b: base, h: head });
    t('happy: the gate saw the MERGED tree (a base-only file and a head-only file both exist)', { missing: g0.missing, hasBoth: ['base-only.txt', 'head-only.txt'].every((f) => (g0.files || []).includes(f)) }, { missing: [], hasBoth: true });
    ok('happy: the gate\'s cwd is NOT the user\'s checkout (realpaths compared)',
        !!g0.cwd && g0.cwd !== real(w.work) && !g0.cwd.startsWith(real(w.work) + path.sep), `gate cwd=${g0.cwd} user checkout=${real(w.work)}`);
    t('happy: LAND_WORKTREE is the gate\'s cwd', g0.worktreeEnv, g0.cwd);
    t('happy: the user\'s node_modules is visible in the scratch worktree (symlinked) and survives cleanup',
        { inGate: g0.hasNodeModules, afterwards: fs.existsSync(path.join(w.work, 'node_modules', 'marker.txt')) }, { inGate: true, afterwards: true });

    const v = land('verify after landing', w, ['--verify', '--json']);
    code('verify after landing', v, 0);
    t('verify after landing: JSON result is "verified"', v.json && v.json.result, 'verified');

    // 9. Already landed: a re-run pushes nothing.
    const refsBefore = originRefs(w);
    const r2 = land('re-run of an already landed PR', w, ['7', '--gate', STUB, '--json']);
    code('re-run of an already landed PR', r2, 0);
    t('re-run of an already landed PR: no new commit, no ref moved', originRefs(w), refsBefore);
    t('re-run of an already landed PR: JSON result is "already-landed"', r2.json && r2.json.result, 'already-landed');
    t('re-run of an already landed PR: the gate did not run again', readLog(w.gateLog).length, 1);
}

// ============================================================================================
// 3. Other ways to name the thing to land; unknown refs; usage errors
// ============================================================================================
function scenarioRefs() {
    // by branch name: the user's clone has never fetched it, so land.js must fetch it itself
    let w = makeWorld();
    let head = commit(w, 'topic/foo', { 'foo.txt': 'foo\n' });
    let base = originMain(w);
    let r = land('by branch name', w, ['topic/foo', '--gate', STUB, '--json']);
    assertLanded('by branch name', w, r, base, head);
    t('by branch name: JSON head', r.json && r.json.head, head);
    t('by branch name: default subject is "Land <ref>"', msgOf(w, originMain(w)).split('\n')[0], 'Land topic/foo');

    // by origin/<branch>
    w = makeWorld();
    head = commit(w, 'topic/foo', { 'foo.txt': 'foo\n' });
    base = originMain(w);
    r = land('by origin/<branch>', w, ['origin/topic/foo', '--gate', STUB, '--json']);
    assertLanded('by origin/<branch>', w, r, base, head);

    // by abbreviated sha that exists only locally in the user's clone (never pushed): the push must carry its objects
    w = makeWorld();
    head = commit(w, 'topic/local', { 'local.txt': 'local\n' }, { noPush: true });
    git(w.work, ['fetch', '-q', w.other, 'topic/local:refs/heads/local-only']);
    base = originMain(w);
    r = land('by abbreviated sha', w, [head.slice(0, 10), '--gate', STUB, '--json']);
    assertLanded('by abbreviated sha', w, r, base, head);

    // by full sha
    w = makeWorld();
    head = commit(w, 'topic/local', { 'local.txt': 'local\n' }, { noPush: true });
    git(w.work, ['fetch', '-q', w.other, 'topic/local:refs/heads/local-only']);
    base = originMain(w);
    r = land('by full sha', w, [head, '--gate', STUB, '--json']);
    assertLanded('by full sha', w, r, base, head);

    // unknown branch, unknown PR number
    w = makeWorld();
    commit(w, 'topic/foo', { 'foo.txt': 'foo\n' });
    let refs = originRefs(w);
    r = land('unknown ref', w, ['no/such-branch', '--gate', STUB, '--json']);
    code('unknown ref', r, 1);
    t('unknown ref: nothing pushed', originRefs(w), refs);
    t('unknown ref: the gate never ran', readLog(w.gateLog).length, 0);
    t('unknown ref: JSON result is "error"', r.json && r.json.result, 'error');
    r = land('unknown PR number', w, ['999', '--gate', STUB]);
    code('unknown PR number', r, 1);
    t('unknown PR number: nothing pushed', originRefs(w), refs);

    // usage and environment errors
    r = land('no arguments', w, []);
    code('no arguments', r, 1);
    r = land('unknown option', w, ['--no-such-option', '--gate', STUB]);
    code('unknown option', r, 1);
    t('unknown option: nothing pushed', originRefs(w), refs);
    r = land('nonexistent remote', w, ['topic/foo', '--remote', 'nowhere', '--gate', STUB]);
    code('nonexistent remote', r, 1);
    const notRepo = path.join(w.dir, 'not-a-repo');
    fs.mkdirSync(notRepo);
    r = runLand(w, ['topic/foo', '--gate', STUB], { cwd: notRepo });
    code('run outside any git repository', r, 1);
    t('run outside any git repository: stdout empty', r.stdout, '');
}

// ============================================================================================
// 4. --dry-run and --fast never push. Default gate and --docs-only-fast, observed through a fake run_ci_locally.js.
// ============================================================================================
function scenarioDryRun() {
    const w = makeWorld();
    const head = makePr(w, 7, 'topic/dry', { 'head-only.txt': 'x\n' });
    const refs = originRefs(w);
    let r = land('dry-run by #<n>', w, ['#7', '--dry-run', '--gate', STUB, '--json']);
    code('dry-run by #<n>', r, 0);
    t('dry-run: origin refs entirely unchanged', originRefs(w), refs);
    t('dry-run: JSON result is "dry-run" and head is the PR head', r.json && { result: r.json.result, head: r.json.head }, { result: 'dry-run', head });
    t('dry-run: the gate still ran once (everything but the push happens)', readLog(w.gateLog).length, 1);

    r = land('--fast with a passing custom gate', w, ['7', '--fast', '--gate', STUB, '--json']);
    code('--fast with a passing custom gate', r, 0);
    t('--fast with a passing custom gate: never pushes (forced dry-run)', originRefs(w), refs);
    t('--fast with a passing custom gate: JSON result is "dry-run"', r.json && r.json.result, 'dry-run');

    // default gate = node scripts/run_ci_locally.js, resolved inside the scratch worktree (the fake one in this repo)
    r = land('--fast with the default gate', w, ['7', '--fast', '--json']);
    code('--fast with the default gate', r, 0);
    t('--fast with the default gate: the default gate ran with --fast', readLog(w.ciLog).map((e) => e.args), [['--fast']]);
    t('--fast with the default gate: never pushes', originRefs(w), refs);

    // --keep leaves the scratch worktree for debugging
    r = land('--keep', w, ['7', '--dry-run', '--gate', STUB, '--keep'], { keep: true });
    code('--keep', r, 0);
    for (const line of git(w.work, ['worktree', 'list', '--porcelain']).split('\n')) {
        if (line.startsWith('worktree ') && fs.realpathSync(line.slice(9)) !== fs.realpathSync(w.work)) {
            gitRaw(w.work, ['worktree', 'remove', '--force', line.slice(9)]);
        }
    }
}
function scenarioDocsOnly() {
    const w = makeWorld();
    const docs = makePr(w, 20, 'topic/docs', { 'docs/guide.md': 'guide, edited\n', 'NOTES.md': 'notes, edited\n', '.github/pull_request_template.md': 'template, edited\n' });
    let base = originMain(w);
    let r = land('docs-only with --docs-only-fast', w, ['20', '--docs-only-fast', '--json']);
    assertLanded('docs-only with --docs-only-fast', w, r, base, docs);
    t('docs-only with --docs-only-fast: the default gate ran with --fast', readLog(w.ciLog).map((e) => e.args), [['--fast']]);
    let st = readStamp(msgOf(w, originMain(w)));
    ok('docs-only with --docs-only-fast: the stamp records "--fast (docs-only)" in Landed-Gate',
        !!st && st.fields['Landed-Gate'].includes('--fast') && st.fields['Landed-Gate'].includes('(docs-only)'), inspect(st && st.fields));

    // a markdown file anywhere counts as docs; mixed with code it does not
    const md = makePr(w, 21, 'topic/md', { 'sub/dir/extra.md': 'extra\n', 'docs/other.txt': 'plain text under docs\n' }, { from: 'origin/main' });
    fs.rmSync(w.ciLog, { force: true });
    base = originMain(w);
    r = land('markdown-only with --docs-only-fast', w, ['21', '--docs-only-fast', '--json']);
    assertLanded('markdown-only with --docs-only-fast', w, r, base, md);
    t('markdown-only with --docs-only-fast: fast gate', readLog(w.ciLog).map((e) => e.args), [['--fast']]);

    const code1 = makePr(w, 22, 'topic/code', { 'src/app.txt': 'code\n', 'NOTES.md': 'notes, edited again\n' }, { from: 'origin/main' });
    fs.rmSync(w.ciLog, { force: true });
    base = originMain(w);
    r = land('code change with --docs-only-fast is a no-op', w, ['22', '--docs-only-fast', '--json']);
    assertLanded('code change with --docs-only-fast is a no-op', w, r, base, code1);
    t('code change with --docs-only-fast: the full gate ran (no --fast)', readLog(w.ciLog).map((e) => e.args), [[]]);
    st = readStamp(msgOf(w, originMain(w)));
    t('code change with --docs-only-fast: Landed-Gate is the plain default command', st && st.fields['Landed-Gate'], 'node scripts/run_ci_locally.js');

    // default gate without any flag
    const plain = makePr(w, 23, 'topic/plain', { 'src/more.txt': 'more\n' }, { from: 'origin/main' });
    fs.rmSync(w.ciLog, { force: true });
    base = originMain(w);
    r = land('default gate', w, ['23', '--json']);
    assertLanded('default gate', w, r, base, plain);
    t('default gate: ran "node scripts/run_ci_locally.js" with no arguments, with LAND_ATTEMPT=1', readLog(w.ciLog), [{ args: [], attempt: '1' }]);

    // A rename out of a non-docs path into docs/ is NOT docs-only: the merge deletes base-only.txt. With git's default
    // rename detection the changed-path list would show only the new docs/ name and the fast gate would run; land.js
    // diffs with --no-renames so both paths show. (Found in review: the fast gate and the push were allowed.)
    const g = (...a) => git(w.other, a);
    g('fetch', '-q', 'origin');
    g('checkout', '-q', '-B', 'topic/rename', 'origin/main');
    fs.mkdirSync(path.join(w.other, 'docs'), { recursive: true });
    g('mv', 'base-only.txt', 'docs/moved-from-code.md');
    g('commit', '-q', '-m', 'move a non-docs file into docs/');
    g('push', '-q', 'origin', 'topic/rename:refs/heads/topic/rename');
    const renamed = g('rev-parse', 'HEAD');
    git(w.origin, ['update-ref', 'refs/pull/24/head', renamed]);
    fs.rmSync(w.ciLog, { force: true });
    base = originMain(w);
    r = land('rename out of a non-docs path with --docs-only-fast', w, ['24', '--docs-only-fast', '--json']);
    assertLanded('rename out of a non-docs path with --docs-only-fast', w, r, base, renamed);
    t('rename out of a non-docs path: the full gate ran (the deleted path is not docs)', readLog(w.ciLog).map((e) => e.args), [[]]);
    st = readStamp(msgOf(w, originMain(w)));
    t('rename out of a non-docs path: Landed-Gate is the plain default command', st && st.fields['Landed-Gate'], 'node scripts/run_ci_locally.js');
}

// ============================================================================================
// 5. Conflict, 6. failing gate, 11. gate dirties the tree, non-race push failure
// ============================================================================================
function scenarioConflict() {
    const w = makeWorld();
    makePr(w, 5, 'topic/conflict', { 'shared.txt': sharedWith({ 10: 'line 10 edited by the PR' }) });
    commit(w, 'main', { 'shared.txt': sharedWith({ 10: 'line 10 edited on main' }) });
    const refs = originRefs(w);
    const r = land('conflict', w, ['5', '--gate', STUB, '--json']);
    code('conflict', r, 2);
    t('conflict: origin unchanged', originRefs(w), refs);
    t('conflict: the gate never ran (a conflicted merge is not tested)', readLog(w.gateLog).length, 0);
    ok('conflict: the conflicting path is named on stderr', r.stderr.includes('shared.txt'), tail(r.stderr, 800));
    t('conflict: JSON result is "conflict"', r.json && r.json.result, 'conflict');
}
function scenarioGateFails() {
    const w = makeWorld();
    makePr(w, 6, 'topic/red', { 'head-only.txt': 'x\n' });
    const refs = originRefs(w);
    const r = land('failing gate', w, ['6', '--gate', STUB, '--json'], { env: { GATE_EXIT: '1' } });
    code('failing gate', r, 3);
    t('failing gate: origin unchanged', originRefs(w), refs);
    t('failing gate: JSON result is "gate-failed"', r.json && r.json.result, 'gate-failed');
    t('failing gate: the gate ran once (no retry for a red gate)', readLog(w.gateLog).length, 1);
}
function scenarioGateDirties() {
    const w = makeWorld();
    makePr(w, 6, 'topic/dirty', { 'head-only.txt': 'x\n' });
    const refs = originRefs(w);
    const r = land('gate that modifies a tracked file', w, ['6', '--gate', STUB, '--json'], { env: { GATE_DIRTY: '1' } });
    code('gate that modifies a tracked file', r, 3);
    t('gate that modifies a tracked file: nothing pushed (what was tested is not what would ship)', originRefs(w), refs);
}
function scenarioPushNotRace() {
    const w = makeWorld();
    makePr(w, 6, 'topic/denied', { 'head-only.txt': 'x\n' });
    const hook = path.join(w.origin, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\necho "denied by the test hook" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const refs = originRefs(w);
    const r = land('push rejected for a reason that is not a race', w, ['6', '--gate', STUB, '--json']);
    code('push rejected for a reason that is not a race', r, 1);
    t('push rejected for a reason that is not a race: origin unchanged', originRefs(w), refs);
    t('push rejected for a reason that is not a race: no retry loop (the gate ran once)', readLog(w.gateLog).length, 1);
    t('push rejected for a reason that is not a race: JSON result is "error"', r.json && r.json.result, 'error');
}

// ============================================================================================
// 7. main moves during the gate; 8. the push is refused on every attempt
// ============================================================================================
function scenarioMainMoves() {
    const w = makeWorld();
    const head = makePr(w, 7, 'topic/race', { 'head-only.txt': 'from the head\n' });
    const base = originMain(w);
    const r = land('main moves during the gate', w, ['7', '--gate', STUB, '--json'], { env: { GATE_MOVE_ON: '1', GATE_REQUIRE: 'base-only.txt,head-only.txt' } });
    code('main moves during the gate', r, 0);
    const log = readLog(w.gateLog);
    const moved = (log[0] || {}).moved;
    const tip = originMain(w);
    t('main moves: the gate ran twice (attempt 2 re-tested on the new base)', log.map((e) => e.attempt), ['1', '2']);
    t('main moves: LAND_BASE_SHA differs between the attempts and the second is the new main tip',
        { first: (log[0] || {}).base, second: (log[1] || {}).base }, { first: base, second: moved });
    t('main moves: the merge commit\'s first parent is the NEW main tip and its second parent is the PR head',
        parentsOf(w, tip), [moved, head]);
    t('main moves: the final tree contains BOTH sides\' files (the other session\'s and the PR\'s) and the base file',
        ['moved-1.txt', 'head-only.txt', 'base-only.txt'].map((f) => filesAt(w, tip).includes(f)), [true, true, true]);
    t('main moves: attempt 2\'s gate saw the other session\'s file; attempt 1\'s could not have',
        [(log[0] || { files: [] }).files.includes('moved-1.txt'), (log[1] || { files: [] }).files.includes('moved-1.txt'), (log[1] || { files: [] }).files.includes('head-only.txt')],
        [false, true, true]);
    const st = readStamp(msgOf(w, tip));
    t('main moves: the stamp says Landed-Attempt 2 and names the new base', st && { a: st.fields['Landed-Attempt'], b: st.fields['Landed-Base'], t: st.fields['Landed-Tree'] }, { a: '2', b: moved, t: treeOf(w, tip) });
    ok('main moves: the other session\'s commit is still in main\'s history (nothing was overwritten)', isAncestor(w, moved, tip));
    t('main moves: JSON attempts is 2', r.json && r.json.attempts, 2);
    t('main moves: verify accepts the result', land('verify after retry', w, ['--verify']).status, 0);
}
function scenarioPushRefused() {
    let w = makeWorld();
    const head = makePr(w, 7, 'topic/never', { 'head-only.txt': 'x\n' });
    let r = land('push refused on every attempt', w, ['7', '--gate', STUB, '--json', '--max-attempts', '2'], { env: { GATE_MOVE_ON: 'all' } });
    code('push refused on every attempt', r, 4);
    let log = readLog(w.gateLog);
    t('push refused: the gate ran once per attempt (--max-attempts 2), each on a different base', { n: log.length, distinct: new Set(log.map((e) => e.base)).size }, { n: 2, distinct: 2 });
    ok('push refused: origin main never contains the PR head', !isAncestor(w, head, originMain(w)));
    t('push refused: origin main is the other session\'s last commit (nothing was force-pushed over it)', originMain(w), (log[1] || {}).moved);
    t('push refused: JSON result is "push-refused" after 2 attempts', r.json && { result: r.json.result, attempts: r.json.attempts }, { result: 'push-refused', attempts: 2 });

    w = makeWorld();
    const head2 = makePr(w, 7, 'topic/never', { 'head-only.txt': 'x\n' });
    r = land('push refused with the default --max-attempts', w, ['7', '--gate', STUB, '--json'], { env: { GATE_MOVE_ON: 'all' } });
    code('push refused with the default --max-attempts', r, 4);
    t('push refused with the default --max-attempts: 3 attempts', readLog(w.gateLog).length, 3);
    ok('push refused with the default --max-attempts: the PR head never reached main', !isAncestor(w, head2, originMain(w)));
}

// ============================================================================================
// 13. --verify
// ============================================================================================
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
// A merge commit made by hand in the other session's clone, with a stamp of the caller's choosing.
function handMerge(w, name, o) {
    o = o || {};
    const g = (...a) => git(w.other, a);
    const side = commit(w, `side/${name}`, { [`${name}.txt`]: `${name}\n` });
    g('checkout', '-q', '-B', 'main', 'origin/main');
    const tipBefore = g('rev-parse', 'HEAD');
    g('merge', '--no-ff', '--no-commit', '-q', side);
    const realTree = g('write-tree');
    const msgFile = path.join(w.dir, `msg-${name}.txt`);
    fs.writeFileSync(msgFile, stampText({
        subject: `Land ${name}`, base: o.base || tipBefore, head: o.head || side, tree: o.tree || realTree, result: o.result, extra: o.extra,
    }));
    g('commit', '-q', '-F', msgFile);
    g('push', '-q', 'origin', 'main:refs/heads/main');
    return { sha: g('rev-parse', 'HEAD'), side, tipBefore, realTree };
}
function scenarioVerify() {
    const w = makeWorld();
    const lineRe = /\b(VERIFIED|UNSTAMPED|MISMATCH) ([0-9a-f]{4,40}) (.*)$/;
    const verdicts = (r) => (r.stderr + '\n' + r.stdout).split('\n').map((l) => lineRe.exec(l)).filter(Boolean).map((m) => ({ v: m[1], sha: m[2], subject: m[3] }));

    const A = handMerge(w, 'a-valid', { extra: ['Co-Authored-By: B Person <b@example.test>', 'Session: https://example.test/s/1'] });
    let r = land('verify: valid stamped merge at the tip (default rev, after land.js fetches)', w, ['--verify', '--json']);
    code('verify: valid stamped merge at the tip', r, 0);
    t('verify: valid stamp is reported as "verified"', r.json && r.json.result, 'verified');
    sync(w);
    r = land('verify: explicit rev', w, ['--verify', A.sha, '--json']);
    code('verify: explicit rev', r, 0);
    t('verify: --trailer style lines after the stamp do not break verification', readStamp(msgOf(w, A.sha)).after, ['Co-Authored-By: B Person <b@example.test>', 'Session: https://example.test/s/1']);

    const B = commit(w, 'main', { 'b-plain.txt': 'b\n' }, { msg: 'plain commit with no stamp' });
    r = land('verify: unstamped commit', w, ['--verify', '--json']);
    code('verify: unstamped commit', r, 5);
    t('verify: unstamped commit is reported as "unstamped"', r.json && r.json.result, 'unstamped');

    const C = handMerge(w, 'c-valid');
    r = land('verify --last 3 over valid, unstamped, valid', w, ['--verify', '--last', '3']);
    code('verify --last 3 (UNSTAMPED alone does not fail the audit)', r, 0);
    const v3 = verdicts(r);
    t('verify --last 3: one line per first-parent commit, tip first, VERIFIED / UNSTAMPED / VERIFIED, short sha prefixes real commits',
        v3.map((x, i) => ({ v: x.v, ok: [C.sha, B, A.sha][i] !== undefined && [C.sha, B, A.sha][i].startsWith(x.sha) })),
        [{ v: 'VERIFIED', ok: true }, { v: 'UNSTAMPED', ok: true }, { v: 'VERIFIED', ok: true }], tail(r.stderr, 800));
    t('verify --last 3: the subject follows the short sha', verdicts(r).map((x) => x.subject), ['Land c-valid', 'plain commit with no stamp', 'Land a-valid']);

    const D = handMerge(w, 'd-wrong-tree', { tree: EMPTY_TREE });
    r = land('verify: stamp whose Landed-Tree differs from the real tree', w, ['--verify', '--json']);
    code('verify: stamp whose Landed-Tree differs from the real tree', r, 6);
    t('verify: tree mismatch is reported as "mismatch"', r.json && r.json.result, 'mismatch');
    r = land('verify --last 4 with a mismatch at the tip', w, ['--verify', '--last', '4']);
    code('verify --last 4 with a mismatch (exit 6 only because a MISMATCH is present)', r, 6);
    t('verify --last 4: MISMATCH, VERIFIED, UNSTAMPED, VERIFIED', verdicts(r).map((x) => x.v), ['MISMATCH', 'VERIFIED', 'UNSTAMPED', 'VERIFIED'], tail(r.stderr, 800));
    r = land('verify --last 3 that still includes the mismatch', w, ['--verify', '--last', '3']);
    code('verify --last 3 that still includes the mismatch', r, 6);
    t('verify --last 3: MISMATCH, VERIFIED, UNSTAMPED', verdicts(r).map((x) => x.v), ['MISMATCH', 'VERIFIED', 'UNSTAMPED']);
    r = land('verify: an older valid commit by explicit rev', w, ['--verify', C.sha]);
    code('verify: an older valid commit by explicit rev still verifies after a bad commit landed on top', r, 0);
    r = land('verify: the bad commit by explicit rev', w, ['--verify', D.sha]);
    code('verify: the bad commit by explicit rev', r, 6);

    const E = handMerge(w, 'e-wrong-head', { head: A.sha });
    sync(w);
    r = land('verify: Landed-Head is not the second parent', w, ['--verify', E.sha]);
    code('verify: Landed-Head is not the second parent', r, 6);
    ok('verify: the disagreeing field is named', /head/i.test(r.stderr), tail(r.stderr, 600));
    const F2 = handMerge(w, 'f-wrong-base', { base: A.sha });
    sync(w);
    r = land('verify: Landed-Base is not the first parent', w, ['--verify', F2.sha]);
    code('verify: Landed-Base is not the first parent', r, 6);
    ok('verify: the disagreeing field is named (base)', /base/i.test(r.stderr), tail(r.stderr, 600));
    const G = handMerge(w, 'g-gate-failed', { result: 'FAIL' });
    sync(w);
    r = land('verify: Landed-Gate-Result is not PASS', w, ['--verify', G.sha]);
    code('verify: Landed-Gate-Result is not PASS', r, 6);

    // a single-parent commit that copies a stamp (with a self-consistent tree) is still not a landed merge
    const g = (...a) => git(w.other, a);
    g('fetch', '-q', 'origin');
    g('checkout', '-q', '-B', 'main', 'origin/main');
    const tip = g('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(w.other, 'h-single.txt'), 'h\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'placeholder');
    const tree = g('rev-parse', 'HEAD^{tree}');
    const msgFile = path.join(w.dir, 'msg-single.txt');
    fs.writeFileSync(msgFile, stampText({ subject: 'Land single-parent', base: tip, head: tip, tree }));
    g('commit', '-q', '--amend', '-F', msgFile);
    g('push', '-q', 'origin', 'main:refs/heads/main');
    const H = g('rev-parse', 'HEAD');
    sync(w);
    r = land('verify: a stamped commit with only one parent', w, ['--verify', H]);
    code('verify: a stamped commit with only one parent', r, 6);
}

// ============================================================================================
// 14. Warnings (stale, stacked, large) and --strict
// ============================================================================================
function scenarioStale() {
    const w = makeWorld();
    makePr(w, 8, 'topic/stale', { 'shared.txt': sharedWith({ 3: 'line 03 edited by the branch' }) });
    commit(w, 'main', { 'shared.txt': sharedWith({ 20: 'line 20 edited on main' }), 'main-only.txt': 'only main\n' });
    commit(w, 'main', { 'shared.txt': sharedWith({ 20: 'line 20 edited on main', 25: 'line 25 edited on main' }) });
    // note: the user's clone has not fetched main since; land.js must fetch the base itself
    let r = land('stale branch', w, ['8', '--dry-run', '--gate', STUB, '--json']);
    code('stale branch (different lines on both sides: no textual conflict)', r, 0);
    const warns = (r.json && r.json.warnings) || [];
    ok('stale branch: a warning says the branch is 2 commits behind', warns.some((x) => /2 commits behind/.test(x)), inspect(warns));
    ok('stale branch: the warning lists the file both sides changed', warns.join('\n').includes('shared.txt'), inspect(warns));
    ok('stale branch: a file only main changed is not listed', !warns.join('\n').includes('main-only.txt'), inspect(warns));
    ok('stale branch: the warning is also on stderr as a WARN line', /^(land: )?WARN: .*behind/m.test(r.stderr), tail(r.stderr, 800));

    // --strict: a warning is an error before the gate runs
    fs.rmSync(w.gateLog, { force: true });
    const refs = originRefs(w);
    r = land('--strict with a warning', w, ['8', '--strict', '--gate', STUB, '--json']);
    code('--strict with a warning', r, 1);
    t('--strict with a warning: the gate stub was never invoked', fs.existsSync(w.gateLog), false);
    t('--strict with a warning: nothing pushed', originRefs(w), refs);
}
function scenarioStrictClean() {
    const w = makeWorld();
    const head = makePr(w, 8, 'topic/clean', { 'head-only.txt': 'x\n' });
    const base = originMain(w);
    const r = land('--strict with nothing to warn about', w, ['8', '--strict', '--gate', STUB, '--json']);
    assertLanded('--strict with nothing to warn about', w, r, base, head);
}
function scenarioStacked() {
    const w = makeWorld();
    commit(w, 'topic/old', { 'old.txt': 'old\n' });
    git(w.other, ['checkout', '-q', '-B', 'main', 'origin/topic/old']);
    git(w.other, ['push', '-q', 'origin', 'main:refs/heads/main']);            // topic/old is now merged into main
    commit(w, 'topic/slice-1', { 'slice1.txt': 'one\n' });
    const stacked = commit(w, 'topic/slice-2', { 'slice2.txt': 'two\n' }, { from: 'origin/topic/slice-1' });
    sync(w);
    let r = land('stacked branch', w, ['topic/slice-2', '--dry-run', '--gate', STUB, '--json']);
    code('stacked branch', r, 0);
    const warns = ((r.json && r.json.warnings) || []).join('\n');
    ok('stacked branch: warns "stacked" and names the unmerged branch it sits on', /stacked/.test(warns) && warns.includes('topic/slice-1'), inspect(warns));
    ok('stacked branch: a branch already merged into main (topic/old) is not named', !warns.includes('topic/old'), inspect(warns));
    ok('stacked branch: the branch is not reported as stacked on itself', !/unmerged\s+(origin\/)?topic\/slice-2\b/.test(warns), inspect(warns));
    ok('stacked branch: the warning is on stderr as a WARN line', /^(land: )?WARN: .*stacked/m.test(r.stderr), tail(r.stderr, 800));

    r = land('the bottom of the stack', w, ['topic/slice-1', '--dry-run', '--gate', STUB, '--json']);
    code('the bottom of the stack', r, 0);
    t('the bottom of the stack: no stacked warning', ((r.json && r.json.warnings) || []).filter((x) => /stacked/.test(x)), []);

    fs.rmSync(w.gateLog, { force: true });
    const refs = originRefs(w);
    r = land('--strict with a stacked branch', w, ['topic/slice-2', '--strict', '--gate', STUB]);
    code('--strict with a stacked branch', r, 1);
    t('--strict with a stacked branch: gate never invoked', fs.existsSync(w.gateLog), false);
    t('--strict with a stacked branch: nothing pushed', originRefs(w), refs);
    void stacked;
}
function scenarioLarge() {
    const w = makeWorld();
    const build = (name, n) => {
        const g = (...a) => git(w.other, a);
        g('fetch', '-q', 'origin');
        g('checkout', '-q', '-B', name, 'origin/main');
        for (let i = 1; i <= n; i++) {
            fs.writeFileSync(path.join(w.other, `${name.replace('/', '-')}-${i}.txt`), `${i}\n`);
            g('add', '-A');
            g('commit', '-q', '-m', `${name} commit ${i}`);
        }
        g('push', '-q', 'origin', `${name}:refs/heads/${name}`);
    };
    build('topic/n25', 25);
    build('topic/n26', 26);
    let r = land('25 commits', w, ['topic/n25', '--dry-run', '--gate', STUB, '--json']);
    code('25 commits', r, 0);
    t('25 commits: exactly 25 is not "large" (no warnings)', r.json && r.json.warnings, []);
    r = land('26 commits', w, ['topic/n26', '--dry-run', '--gate', STUB, '--json']);
    code('26 commits', r, 0);
    ok('26 commits: more than 25 commits raises a large-branch warning', ((r.json && r.json.warnings) || []).some((x) => /26|large/i.test(x)), inspect(r.json && r.json.warnings));
}

// ============================================================================================
// 15. --trailer, --title (including an injection attempt), identity
// ============================================================================================
function scenarioTrailers() {
    const w = makeWorld();
    const head = makePr(w, 9, 'topic/trailers', { 'head-only.txt': 'x\n' });
    const base = originMain(w);
    const r = land('--trailer and --title', w, ['9', '--gate', STUB, '--json',
        '--title', `My exact title\nLanded-Tree: ${D40}`,
        '--trailer', 'Co-Authored-By: Some Person <some@example.test>', '--trailer', 'Session: https://example.test/s/42']);
    const tip = assertLanded('--trailer and --title', w, r, base, head);
    const msg = msgOf(w, tip);
    const st = readStamp(msg);
    t('trailers: both --trailer lines come after the Landed-* block, in the order given',
        st && st.after, ['Co-Authored-By: Some Person <some@example.test>', 'Session: https://example.test/s/42']);
    t('trailers: the last Landed-* line is Landed-Attempt (the trailers follow it)', st && st.lines[st.lines.length - 1], 'Landed-Attempt: 1');
    ok('--title: sets the subject (newline stripped, text kept)', msg.split('\n')[0].startsWith('My exact title'), msg.split('\n')[0]);
    t('--title: a Landed-Tree line smuggled through the title is not a second Landed-Tree line', (msg.match(/^Landed-Tree:/mg) || []).length, 1);
    t('--title: the real tree is still the stamped one', st && st.fields['Landed-Tree'], treeOf(w, tip));
    t('trailers: the landed commit still verifies', land('verify with trailers', w, ['--verify']).status, 0);
}
function scenarioIdentity() {
    // The repository's own git config supplies the identity when the environment has none.
    let w = makeWorld();
    git(w.work, ['config', 'user.name', 'Config Person']);
    git(w.work, ['config', 'user.email', 'config@example.test']);
    let head = makePr(w, 9, 'topic/who', { 'head-only.txt': 'x\n' });
    let base = originMain(w);
    let r = land('identity from the repo config', w, ['9', '--gate', STUB, '--json'], { noIdentity: true });
    let tip = assertLanded('identity from the repo config', w, r, base, head);
    t('identity from the repo config: author and committer', git(w.origin, ['log', '-1', '--format=%an <%ae> | %cn <%ce>', tip]),
        'Config Person <config@example.test> | Config Person <config@example.test>');

    // With no identity anywhere, land.js falls back to its own noreply identity instead of failing.
    w = makeWorld();
    head = makePr(w, 9, 'topic/who', { 'head-only.txt': 'x\n' });
    base = originMain(w);
    r = land('no identity configured anywhere', w, ['9', '--gate', STUB, '--json'], { noIdentity: true });
    tip = assertLanded('no identity configured anywhere', w, r, base, head);
    t('no identity configured anywhere: the fallback identity is land.js <noreply@land.invalid>', git(w.origin, ['log', '-1', '--format=%an <%ae>', tip]), 'land.js <noreply@land.invalid>');
}

function scenarioTrailerInjection() {
    // A --trailer value with a newline must not be able to forge a second Landed-Tree that a reader would believe.
    const w = makeWorld();
    const head = makePr(w, 9, 'topic/inject', { 'head-only.txt': 'x\n' });
    const base = originMain(w);
    const r = land('trailer injection', w, ['9', '--gate', STUB, '--json', '--trailer', `Note: harmless\nLanded-Tree: ${D40}`]);
    const tip = assertLanded('trailer injection', w, r, base, head);
    const ps = parse(msgOf(w, tip));
    t('trailer injection: parseStamp still reports the real tree', ps && ps.tree, treeOf(w, tip));
    t('trailer injection: the landed commit still verifies', land('verify after trailer injection', w, ['--verify']).status, 0);
}

// ============================================================================================
// Drive everything. A scenario that throws is one failure, not a crash that hides the others.
// ============================================================================================
const SCENARIOS = [
    scenarioHappy, scenarioRefs, scenarioDryRun, scenarioDocsOnly, scenarioConflict, scenarioGateFails, scenarioGateDirties,
    scenarioPushNotRace, scenarioMainMoves, scenarioPushRefused, scenarioVerify, scenarioStale, scenarioStrictClean,
    scenarioStacked, scenarioLarge, scenarioTrailers, scenarioTrailerInjection, scenarioIdentity,
];
const EXPECTED = 383;
try {
    for (const s of SCENARIOS) {
        try { s(); } catch (e) { failures.push(`${s.name} threw: ${e && e.stack || e}`); }
    }
} finally {
    try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { void e; }
}

if (pass + failures.length !== EXPECTED) {
    failures.push(`expected ${EXPECTED} assertions, ran ${pass + failures.length} -- ` +
        'an assertion was added or silently dropped; update EXPECTED deliberately');
}
if (failures.length) {
    console.error(`\n${failures.length} FAILED (${pass} passed):\n`);
    failures.forEach((f) => console.error(`  - ${f}\n`));
    process.exit(1);
}
console.log(`LAND_SCRIPT_CHECK_PASSED (${pass} assertions)`);

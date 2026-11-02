#!/usr/bin/env node
/**
 * Land a PR / branch / commit onto main through a local merge queue: build the merge, test THAT
 * merge, push it only if main has not moved. Run it from inside the git repo you want to land into.
 *
 * THE RULE THIS ENFORCES ("the Not Rocket Science Rule of Software Engineering", Graydon Hoare):
 *   "Automatically maintain a repository of code that always passes all the tests."
 * Put as a promise about main: main only ever receives a tree that was tested AS MERGED.
 *
 * WHY: a pull request's green check says "this branch, on top of the main it was cut from, passes".
 * It says nothing about what main will contain after the merge, because main moves while a branch
 * waits. Two PRs that are each green alone can be wrong together with no textual conflict at all (a
 * "semantic conflict": git merges text, not meaning). That happened with PR 185 and PR 186 (see
 * docs/CHECK_HISTORY.md, 2026-10-06). Testing the branch is testing a tree that never ships; this
 * script tests the tree that WILL ship, and ships that exact tree.
 *
 * HOW, and why each step is shaped the way it is:
 *   1. Fetch main and the branch tip into private refs, so the decision is made on what the remote
 *      holds right now, not on whatever the local clone remembers.
 *   2. Build the merge in a THROWAWAY WORKTREE (a second checkout, in the system temp directory,
 *      sharing this repo's object store). The gate takes minutes and writes files; running it in your
 *      checkout would fight you for the working tree and could test your uncommitted edits instead of
 *      the merge. A scratch worktree means the gate sees exactly the merge commit and nothing else, and
 *      your branch, HEAD, index and working tree are never touched. It is always removed afterwards.
 *   3. Run the gate there (default: node scripts/run_ci_locally.js, the same jobs CI runs).
 *   4. Push the tested merge with a PLAIN push (never --force). If main moved while the gate ran, git
 *      refuses the push ("fetch first"). That refusal is the whole queue: it is how we find out the
 *      tree we tested is no longer the tree that would ship.
 *   5. A refused push means RE-TEST, not just re-push. Rebuilding the merge on the new main and pushing
 *      it without running the gate again would publish a tree nobody tested, which is exactly the hole
 *      this script exists to close. So the loop starts over from step 1, merge AND gate, up to
 *      --max-attempts times.
 *   6. The commit message carries a stamp (Landed-Base / Landed-Head / Landed-Tree / ...), built by
 *      scripts/lib/landing.js. The stamp records the TREE hash, not the commit hash: a tree hash names
 *      the exact file contents, independent of history and commit metadata, and it is the one value
 *      that is the same before and after the message is amended with the gate's results (a commit
 *      hash changes with every amend, so it could not be known before the gate ran). `--verify` later
 *      recomputes the tree of any main commit and compares it with the stamp, so "main's tree is the
 *      tree that was tested" can be audited, not just believed.
 *
 * Usage (from inside the repo):
 *   node scripts/land.js <ref> [options]        land a PR / branch / sha
 *   node scripts/land.js --verify [<rev>]       check one commit's stamp (default: tip of <remote>/<base>)
 *   node scripts/land.js --verify --last <N>    audit the last N first-parent commits of <remote>/<base>
 *
 *   <ref>   123 or #123 (a PR: fetches refs/pull/123/head from the remote), a branch name on the remote
 *           (claude/foo or origin/claude/foo), or a full or abbreviated commit hash that exists locally.
 *
 *   --remote <name>        remote to land into (default origin)       --base <branch>   (default main)
 *   --gate "<command>"     the gate, run with the worktree as its cwd (default: node scripts/run_ci_locally.js)
 *   --fast                 default gate becomes "... --fast" AND the run is forced to --dry-run
 *   --docs-only-fast       if the merge only touches docs/, .md files or the PR template, run the default
 *                          gate with --fast and ALLOW the push (stamped "(docs-only)"); otherwise a no-op
 *   --dry-run              merge, gate and stamp, but do not push
 *   --max-attempts <n>     fresh attempts when the push is refused because main moved (default 3)
 *   --trailer "Key: value" extra trailer line after the stamp (repeatable)
 *   --title "<text>"       merge commit subject (default: Land #123 for a PR, else Land <ref>)
 *   --keep                 keep the scratch worktree (debugging)     --strict   any WARN becomes exit 1
 *   --json                 print one JSON result object on stdout (otherwise stdout stays empty)
 *
 * Output: human log lines go to stderr prefixed "land: " (the gate's own output is passed through
 * as it comes; WARN lines and --verify --last audit lines are printed bare, starting with WARN: or
 * VERIFIED / UNSTAMPED / MISMATCH). stdout carries one JSON object only with --json.
 *
 * Exit codes: 0 landed / dry-run passed / already landed / verified
 *             1 usage or environment error (bad ref, no remote, push failed for a non-race reason)
 *             2 merge conflict (never auto-resolved: merge main into your branch yourself, push, re-run)
 *             3 gate failed, or the gate modified tracked files (what was tested is not what would ship)
 *             4 push refused on every attempt (main kept moving)
 *             5 --verify: the commit carries no stamp
 *             6 --verify: the stamp does not match the commit
 *
 * Limits, honestly: this is a convention backed by a tool, not a lock. It cannot stop someone pushing
 * to main by hand, and it does not replace branch protection. Push hooks (pre-push) are skipped, since
 * the gate is the check and a hook would run against the wrong checkout.
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatStamp, parseStamp, parseGateSummary } = require('./lib/landing.js');

const DEFAULT_GATE = 'node scripts/run_ci_locally.js';
const GATE_OUTPUT_CAP = 5 * 1024 * 1024; // keep the tail: the summary is at the end
const LARGE_COMMITS = 25;
const MAX_SHOWN_FILES = 20;

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

// Everything land.js "decides" is thrown as one of these and turned into an exit code in main().
class LandError extends Error {
  constructor(code, result, message) { super(message); this.code = code; this.result = result; }
}

const log = (msg) => process.stderr.write('land: ' + msg + '\n');
const bare = (line) => process.stderr.write(line + '\n');

// A caller's own GIT_DIR / GIT_INDEX_FILE (set when we are started from inside a git hook, for
// example) would silently redirect every git command below to the wrong repository.
const SCRUB = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];
const cleanEnv = () => { const e = Object.assign({}, process.env); for (const k of SCRUB) delete e[k]; return e; };
// LC_ALL=C so the push-refusal text we match on is English whatever the user's locale is.
const gitEnv = () => Object.assign(cleanEnv(), { LC_ALL: 'C', GIT_MERGE_AUTOEDIT: 'no' });

let REPO = null; // the user's repo (toplevel of the current working directory)

function git(args, opts) {
  const o = opts || {};
  const r = spawnSync('git', o.config ? o.config.concat(args) : args, {
    cwd: o.cwd || REPO, encoding: 'utf8', input: o.input, env: gitEnv(), maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw new LandError(1, 'error', 'cannot run git: ' + r.error.message);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
// Same, but a non-zero exit is an environment error and the trimmed stdout is returned.
function gitOut(args, opts) {
  const r = git(args, opts);
  if (r.status !== 0) throw new LandError(1, 'error', 'git ' + args.join(' ') + ' failed: ' + (r.stderr.trim() || 'exit ' + r.status));
  return r.stdout.trim();
}
const gitOk = (args, opts) => git(args, opts).status === 0;

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
const short = (sha) => String(sha).slice(0, 8);

function usage() {
  const text = fs.readFileSync(__filename, 'utf8');
  const m = /Usage \(from inside the repo\):([\s\S]*?)\n \* Output:/.exec(text);
  return 'Usage (from inside the repo):' + (m ? m[1].replace(/^ \* ?/gm, '') : '\n  node scripts/land.js <ref> [options]\n');
}

function parseArgs(argv) {
  const o = {
    remote: 'origin', base: 'main', gate: null, fast: false, docsOnlyFast: false, dryRun: false, maxAttempts: 3,
    trailers: [], title: null, keep: false, json: false, strict: false, verify: false, last: null, ref: null, help: false,
  };
  const valued = { '--remote': 'remote', '--base': 'base', '--gate': 'gate', '--max-attempts': 'maxAttempts', '--trailer': 'trailer', '--title': 'title', '--last': 'last' };
  const flags = { '--fast': 'fast', '--docs-only-fast': 'docsOnlyFast', '--dry-run': 'dryRun', '--keep': 'keep', '--json': 'json', '--strict': 'strict', '--verify': 'verify', '--help': 'help', '-h': 'help' };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    if (Object.prototype.hasOwnProperty.call(flags, a)) {
      if (inline !== null) throw new LandError(1, 'error', a + ' does not take a value');
      o[flags[a]] = true;
    } else if (Object.prototype.hasOwnProperty.call(valued, a)) {
      let v = inline;
      if (v === null) { if (i + 1 >= argv.length) throw new LandError(1, 'error', a + ' needs a value'); v = argv[++i]; }
      const key = valued[a];
      if (key === 'trailer') o.trailers.push(v);
      else if (key === 'maxAttempts' || key === 'last') {
        if (!/^\d+$/.test(v) || Number(v) < 1) throw new LandError(1, 'error', a + ' needs a positive integer, got "' + v + '"');
        o[key] = Number(v);
      } else o[key] = v;
    } else if (a.startsWith('-') && a !== '-') {
      throw new LandError(1, 'error', 'unknown option ' + a + '\n' + usage());
    } else {
      if (o.ref !== null) throw new LandError(1, 'error', 'unexpected extra argument "' + a + '"');
      o.ref = a;
    }
  }
  if (o.help) return o;
  if (o.last !== null && !o.verify) throw new LandError(1, 'error', '--last only makes sense with --verify');
  if (!o.verify && o.ref === null) throw new LandError(1, 'error', 'nothing to land: give a PR number, branch or commit\n' + usage());
  if (o.verify && o.ref !== null && o.last !== null) throw new LandError(1, 'error', '--verify takes either a <rev> or --last <N>, not both');
  for (const t of o.trailers) {
    if (!/^[A-Za-z][A-Za-z0-9-]*: ?\S/.test(oneLine(t))) throw new LandError(1, 'error', '--trailer must look like "Key: value", got "' + t + '"');
    // The Landed-* keys are the stamp itself; letting a caller add one would let it contradict the stamp.
    if (/^landed-/i.test(oneLine(t))) throw new LandError(1, 'error', '--trailer may not use the reserved Landed-* keys: "' + t + '"');
  }
  return o;
}

// What the JSON result reports; filled in as the run progresses.
const S = { mergeCommit: null, tree: null, base: null, head: null, attempts: 0, warnings: [], counts: [], extra: {} };

let interrupted = false;
let activeGate = null;

// ---------------------------------------------------------------------------------------------
// resolving what to land
// ---------------------------------------------------------------------------------------------

// Private refs let us hold the fetched tips without touching any of the user's branches, and are
// deleted again in main()'s finally. The pid keeps two simultaneous runs from sharing a ref.
const ns = () => 'refs/land/' + process.pid;

function fetchBase(o) {
  const r = git(['fetch', '--quiet', '--no-tags', o.remote, '+refs/heads/' + o.base + ':' + ns() + '/base']);
  if (r.status !== 0) throw new LandError(1, 'error', 'cannot fetch ' + o.remote + '/' + o.base + ': ' + r.stderr.trim());
  return gitOut(['rev-parse', '--verify', ns() + '/base^{commit}']);
}

function resolveHead(o) {
  const ref = o.ref;
  const pr = /^#?(\d+)$/.exec(ref);
  // "#123" is always a PR. Bare digits are a PR only while short enough that they cannot be an
  // abbreviated commit hash that happens to be all digits.
  if (pr && (ref.startsWith('#') || pr[1].length <= 6)) {
    const r = git(['fetch', '--quiet', '--no-tags', o.remote, '+refs/pull/' + pr[1] + '/head:' + ns() + '/head']);
    if (r.status !== 0) throw new LandError(1, 'error', 'cannot fetch refs/pull/' + pr[1] + '/head from ' + o.remote + ' (is ' + pr[1] + ' a PR number on this remote?): ' + r.stderr.trim());
    return { sha: gitOut(['rev-parse', '--verify', ns() + '/head^{commit}']), kind: 'pr', title: 'Land #' + pr[1] };
  }
  const candidates = [];
  for (const c of [ref, ref.replace(/^refs\/heads\//, ''), ref.replace(new RegExp('^' + o.remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'), '')]) {
    if (c && !candidates.includes(c)) candidates.push(c);
  }
  for (const c of candidates) {
    const r = git(['fetch', '--quiet', '--no-tags', o.remote, '+refs/heads/' + c + ':' + ns() + '/head']);
    if (r.status === 0) return { sha: gitOut(['rev-parse', '--verify', ns() + '/head^{commit}']), kind: 'branch', title: 'Land ' + ref };
  }
  if (/^[0-9a-f]{4,40}$/i.test(ref)) {
    const r = git(['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
    if (r.status === 0) return { sha: r.stdout.trim(), kind: 'sha', title: 'Land ' + ref };
  }
  throw new LandError(1, 'error', 'cannot resolve "' + ref + '": not a PR number, not a branch on ' + o.remote + ', not a commit that exists locally');
}

// ---------------------------------------------------------------------------------------------
// WARN-only checks: they never stop a landing (unless --strict), they tell a human what to look at
// ---------------------------------------------------------------------------------------------

function collectWarnings(o, baseSha, headSha) {
  const warnings = [];
  const mb = gitOut(['merge-base', baseSha, headSha]);
  const behind = Number(gitOut(['rev-list', '--count', mb + '..' + baseSha]));
  if (behind > 0) {
    // Files changed on BOTH sides since the fork point are where a textual or semantic conflict lives.
    const side = (to) => new Set(gitOut(['diff', '--name-only', '-z', mb, to]).split('\0').filter(Boolean));
    const theirs = side(headSha);
    const both = Array.from(side(baseSha)).filter((f) => theirs.has(f)).sort();
    let msg = 'branch is ' + behind + ' commit' + (behind === 1 ? '' : 's') + ' behind ' + o.base;
    if (both.length) {
      msg += '; changed on both sides since the merge-base: ' + both.slice(0, MAX_SHOWN_FILES).join(', ') +
        (both.length > MAX_SHOWN_FILES ? ' (and ' + (both.length - MAX_SHOWN_FILES) + ' more)' : '');
    }
    warnings.push(msg);
  }
  // Stacked: some other remote branch's tip is inside our history but not yet on main. Landing this
  // one would drag that branch's commits onto main without that branch having been landed itself.
  const refs = git(['for-each-ref', '--merged=' + headSha, '--no-merged=' + baseSha, '--format=%(refname) %(objectname)', 'refs/remotes/' + o.remote]);
  if (refs.status === 0) {
    for (const line of refs.stdout.split('\n').filter(Boolean)) {
      const [refname, sha] = line.split(' ');
      const name = refname.slice(('refs/remotes/' + o.remote + '/').length);
      if (name === 'HEAD' || name === o.base || sha === headSha) continue;
      warnings.push('stacked on unmerged ' + name + '; land that one first or the history will contain its commits');
    }
  }
  const commits = Number(gitOut(['rev-list', '--count', baseSha + '..' + headSha]));
  if (commits > LARGE_COMMITS) warnings.push('large change: ' + commits + ' commits in ' + o.base + '..head (more than ' + LARGE_COMMITS + '); consider landing it in slices');
  return warnings;
}

// ---------------------------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------------------------

function runGate(command, cwd, env) {
  return new Promise((resolve) => {
    const chunks = []; let size = 0;
    const child = spawn(command, { shell: true, cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    activeGate = child;
    const take = (chunk) => {
      process.stderr.write(chunk); // tee: you watch the gate live ...
      chunks.push(chunk); size += chunk.length; // ... and we keep it to read the counts afterwards
      while (size > GATE_OUTPUT_CAP && chunks.length > 1) size -= chunks.shift().length;
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (err) => { activeGate = null; resolve({ code: 127, signal: null, output: 'could not start the gate: ' + err.message }); });
    child.on('close', (code, signal) => { activeGate = null; resolve({ code: signal ? null : code, signal, output: Buffer.concat(chunks).toString('utf8') }); });
  });
}

function stopGateOnSignal(signal) {
  interrupted = true;
  log('received ' + signal + ': stopping' + (activeGate ? ' the gate' : '') + ', nothing will be pushed');
  if (activeGate) {
    try { process.kill(process.platform === 'win32' ? activeGate.pid : -activeGate.pid, 'SIGTERM'); } catch (e) { try { activeGate.kill('SIGTERM'); } catch (e2) { /* already gone */ } }
  }
}

// ---------------------------------------------------------------------------------------------
// one landing attempt
// ---------------------------------------------------------------------------------------------

function removeWorktree(wt) {
  git(['worktree', 'remove', '--force', wt]);
  git(['worktree', 'prune']);
  try { fs.rmSync(wt, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

const isDocsPath = (p) => p.startsWith('docs/') || /\.md$/.test(p) || p === '.github/pull_request_template.md';

async function attempt(o, k) {
  const baseSha = fetchBase(o);
  const head = resolveHead(o);
  S.base = baseSha; S.head = head.sha; S.attempts = k;
  log('attempt ' + k + '/' + o.maxAttempts + ': ' + o.remote + '/' + o.base + ' is ' + short(baseSha) + ', head is ' + short(head.sha));

  if (git(['merge-base', '--is-ancestor', head.sha, baseSha]).status === 0) {
    log('already landed: ' + short(head.sha) + ' is already part of ' + o.remote + '/' + o.base + '; nothing to do');
    return { result: 'already-landed', code: 0 };
  }
  if (!gitOk(['merge-base', baseSha, head.sha])) throw new LandError(1, 'error', 'the branch shares no history with ' + o.base + '; refusing to merge unrelated histories');

  if (k === 1) {
    S.warnings = collectWarnings(o, baseSha, head.sha);
    for (const w of S.warnings) bare('WARN: ' + w);
    if (o.strict && S.warnings.length) throw new LandError(1, 'error', '--strict: ' + S.warnings.length + ' warning(s), refusing to continue');
  }

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'land-'));
  let linkedModules = false;
  try {
    const add = git(['worktree', 'add', '--detach', wt, baseSha]);
    if (add.status !== 0) throw new LandError(1, 'error', 'cannot create the scratch worktree: ' + add.stderr.trim());
    log('scratch worktree: ' + wt);
    // The gate needs the dependencies; installing them per attempt would cost minutes, so share the repo's.
    const nm = path.join(REPO, 'node_modules');
    if (fs.existsSync(nm) && !fs.existsSync(path.join(wt, 'node_modules'))) {
      fs.symlinkSync(nm, path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      linkedModules = true;
    }

    // Identity: the repo's own git identity if there is one, else a labelled fallback, so a machine
    // without user.name/user.email can still land. Needed by the merge itself, not only the commit.
    const ident = git(['var', 'GIT_COMMITTER_IDENT'], { cwd: wt }).status === 0 ? [] : ['-c', 'user.name=land.js', '-c', 'user.email=noreply@land.invalid'];

    // --- merge (never auto-resolved) ---
    const merge = git(ident.concat(['merge', '--no-ff', '--no-commit', head.sha]), { cwd: wt });
    if (merge.status !== 0) {
      const conflicts = git(['diff', '--name-only', '--diff-filter=U'], { cwd: wt }).stdout.split('\n').filter(Boolean);
      git(['merge', '--abort'], { cwd: wt });
      if (!conflicts.length) throw new LandError(1, 'error', 'the merge failed without conflicts: ' + (merge.stderr.trim() || merge.stdout.trim()));
      log('MERGE CONFLICT merging ' + short(head.sha) + ' into ' + o.base + ' (' + short(baseSha) + '). Conflicting paths:');
      for (const c of conflicts) bare('  ' + c);
      log('merge ' + o.base + ' into your branch, resolve the conflicts, push, then re-run this command (land.js never resolves conflicts or rebases a branch for you)');
      S.extra.conflicts = conflicts;
      return { result: 'conflict', code: 2 };
    }
    // --no-renames: with rename detection on, moving scripts/x.js to docs/x.md lists only the NEW path, which
    // looks docs-only to --docs-only-fast while the merge actually deletes a script. Without it, both paths show.
    const changed = git(['diff', '--cached', '--no-renames', '--name-only', '-z'], { cwd: wt }).stdout.split('\0').filter(Boolean);

    // --- which gate? ---
    let gate = o.gate || DEFAULT_GATE;
    let gateLabel = gate;
    if (!o.gate && o.fast) { gate = gateLabel = DEFAULT_GATE + ' --fast'; }
    else if (!o.gate && o.docsOnlyFast && changed.length > 0 && changed.every(isDocsPath)) {
      gate = DEFAULT_GATE + ' --fast';
      gateLabel = gate + ' (docs-only)';
      log('--docs-only-fast: all ' + changed.length + ' changed path(s) are docs, running the fast gate and allowing the push');
    }
    const dryRun = o.dryRun || o.fast;
    if (o.fast && !o.dryRun) log('--fast never pushes: this run is a dry run');

    // --- commit the merge with a provisional stamp (the result is filled in after the gate) ---
    const stampFields = (extra) => Object.assign({
      subject: o.title || head.title, base: baseSha, head: head.sha, tree: null, gate: gateLabel, gateResult: 'PENDING',
      jobs: null, counts: [], at: isoNow(), attempt: k, trailers: o.trailers,
    }, extra);
    const commit = (message, extraArgs) => {
      // --no-verify: the gate is the verification; a commit hook would test the wrong thing.
      const r = git(ident.concat(['commit', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-F', '-']).concat(extraArgs || []), { cwd: wt, input: message });
      if (r.status !== 0) throw new LandError(1, 'error', 'git commit failed in the scratch worktree: ' + (r.stderr.trim() || r.stdout.trim()));
    };
    const treeNow = gitOut(['write-tree'], { cwd: wt });
    commit(formatStamp(stampFields({ tree: treeNow })));
    const preGateSha = gitOut(['rev-parse', 'HEAD'], { cwd: wt });
    const preGateTree = gitOut(['rev-parse', 'HEAD^{tree}'], { cwd: wt });
    if (preGateTree !== treeNow) throw new LandError(1, 'error', 'internal error: the merge commit tree differs from the merged index');
    log('merge built: tree ' + short(preGateTree) + ' (' + changed.length + ' path(s) changed vs ' + o.base + '); running the gate: ' + gate);

    // --- gate ---
    const env = Object.assign(cleanEnv(), { LAND_ATTEMPT: String(k), LAND_BASE_SHA: baseSha, LAND_HEAD_SHA: head.sha, LAND_WORKTREE: wt });
    const g = await runGate(gate, wt, env);
    if (interrupted) throw new LandError(1, 'error', 'interrupted; nothing was pushed');
    if (g.code !== 0) {
      throw new LandError(3, 'gate-failed', 'the gate failed (' + (g.signal ? 'signal ' + g.signal : 'exit ' + g.code) + '): ' + gate + '; nothing was pushed');
    }

    // --- what was tested must be what would ship ---
    const dirty = git(['status', '--porcelain', '--untracked-files=all'], { cwd: wt }).stdout.split('\n')
      .filter((l) => l && !(linkedModules && /^\?\? node_modules\/?$/.test(l)));
    if (dirty.length) {
      throw new LandError(3, 'gate-failed', 'the gate modified tracked files: what was tested is not what would be pushed. Changed:\n  ' + dirty.slice(0, MAX_SHOWN_FILES).join('\n  '));
    }
    if (gitOut(['rev-parse', 'HEAD'], { cwd: wt }) !== preGateSha || gitOut(['rev-parse', 'HEAD^{tree}'], { cwd: wt }) !== preGateTree) {
      throw new LandError(3, 'gate-failed', 'the gate moved HEAD in the scratch worktree: what was tested is not what would be pushed');
    }

    // --- re-stamp: same tree, message now carries the gate's results ---
    const summary = parseGateSummary(g.output);
    const hasJobs = summary.passed + summary.failed + summary.skipped > 0;
    S.counts = summary.counts;
    commit(formatStamp(stampFields({
      tree: preGateTree, gateResult: 'PASS', at: isoNow(),
      jobs: hasJobs ? { passed: summary.passed, failed: summary.failed, skipped: summary.skipped } : null, counts: summary.counts,
    })), ['--amend']);
    const mergeSha = gitOut(['rev-parse', 'HEAD'], { cwd: wt });
    const tree = gitOut(['rev-parse', 'HEAD^{tree}'], { cwd: wt });
    if (tree !== preGateTree) throw new LandError(1, 'error', 'internal error: amending the message changed the tree');
    S.mergeCommit = mergeSha; S.tree = tree;
    log('gate passed; stamped merge commit ' + short(mergeSha) + ' (tree ' + short(tree) + ')');

    if (dryRun) {
      log('dry run: would push ' + short(mergeSha) + ' to ' + o.remote + ' refs/heads/' + o.base + ' (plain push, parents ' + short(baseSha) + ' + ' + short(head.sha) + '); nothing was pushed');
      return { result: 'dry-run', code: 0 };
    }

    // --- push: plain, never forced. A refusal because main moved means: start over, merge and gate included ---
    if (interrupted) throw new LandError(1, 'error', 'interrupted; nothing was pushed');
    const push = git(['push', '--no-verify', o.remote, mergeSha + ':refs/heads/' + o.base]);
    if (push.status !== 0) {
      const rejected = /\[rejected\]/.test(push.stderr) && /(non-fast-forward|fetch first|stale info)/.test(push.stderr);
      const ls = git(['ls-remote', o.remote, 'refs/heads/' + o.base]);
      const tipNow = ls.status === 0 ? ls.stdout.split(/\s+/)[0] : null;
      if (rejected && tipNow && tipNow !== baseSha) {
        log(o.base + ' moved while the gate ran (' + short(baseSha) + ' -> ' + short(tipNow) + '): the tree just tested is no longer the tree that would ship; starting over');
        S.mergeCommit = null; S.tree = null; // the merge we built is abandoned, not landed
        return { retry: true };
      }
      throw new LandError(1, 'error', 'push failed (not a race with a newer ' + o.base + '): ' + push.stderr.trim());
    }
    const check = git(['ls-remote', o.remote, 'refs/heads/' + o.base]);
    const remoteTip = check.status === 0 ? check.stdout.split(/\s+/)[0] : '';
    if (remoteTip !== mergeSha) {
      throw new LandError(1, 'error', 'push reported success but ' + o.remote + '/' + o.base + ' is ' + (remoteTip || 'unreadable') + ', not ' + mergeSha);
    }
    log('LANDED ' + short(mergeSha) + ' on ' + o.remote + '/' + o.base + ' (attempt ' + k + '). The pull request, if any, shows as merged by itself because the pushed commit contains its head.');
    return { result: 'landed', code: 0 };
  } finally {
    if (o.keep) log('--keep: scratch worktree left at ' + wt + ' (remove with: git worktree remove --force ' + wt + ')');
    else removeWorktree(wt);
  }
}

async function landMode(o) {
  git(['worktree', 'prune']); // forget scratch worktrees whose directories a killed earlier run left behind
  for (let k = 1; k <= o.maxAttempts; k++) {
    const r = await attempt(o, k);
    if (!r.retry) return r;
  }
  throw new LandError(4, 'push-refused', o.base + ' moved during every one of ' + o.maxAttempts + ' attempts; nothing was pushed. Re-run when main is quieter, or raise --max-attempts');
}

// ---------------------------------------------------------------------------------------------
// --verify
// ---------------------------------------------------------------------------------------------

// Judge one commit: { state: 'verified'|'unstamped'|'mismatch', problems: [..], stamp }.
function judge(sha) {
  const message = gitOut(['log', '-1', '--format=%B', sha]);
  const stamp = parseStamp(message);
  if (!stamp) return { state: 'unstamped', problems: ['not landed through land.js; no tested-tree claim'], stamp: null };
  const parents = gitOut(['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
  const tree = gitOut(['rev-parse', sha + '^{tree}']);
  const problems = [];
  if (parents.length !== 2) problems.push('expected a merge commit with exactly 2 parents, found ' + parents.length);
  else {
    if (parents[0] !== stamp.base) problems.push('first parent ' + parents[0] + ' != Landed-Base ' + stamp.base);
    if (parents[1] !== stamp.head) problems.push('second parent ' + parents[1] + ' != Landed-Head ' + stamp.head);
  }
  if (tree !== stamp.tree) problems.push('commit tree ' + tree + ' != Landed-Tree ' + stamp.tree);
  if (stamp.gateResult !== 'PASS') problems.push('Landed-Gate-Result is "' + stamp.gateResult + '", not PASS');
  return { state: problems.length ? 'mismatch' : 'verified', problems, stamp, tree };
}

function verifyMode(o) {
  let sha;
  if (o.ref !== null) {
    const r = git(['rev-parse', '--verify', '--quiet', o.ref + '^{commit}']);
    if (r.status !== 0) throw new LandError(1, 'error', 'cannot resolve "' + o.ref + '" to a commit');
    sha = r.stdout.trim();
  } else sha = fetchBase(o);

  if (o.last !== null) {
    const list = gitOut(['rev-list', '--first-parent', '-n', String(o.last), sha]).split('\n').filter(Boolean);
    const rows = []; let bad = 0; let ok = 0; let unstamped = 0;
    for (const c of list) {
      const j = judge(c);
      const subject = gitOut(['log', '-1', '--format=%s', c]);
      bare(j.state.toUpperCase() + ' ' + short(c) + ' ' + subject);
      if (j.state === 'mismatch') { bad++; for (const p of j.problems) bare('  ' + p); } else if (j.state === 'verified') ok++; else unstamped++;
      rows.push({ commit: c, result: j.state, subject });
    }
    log('audited ' + list.length + ' first-parent commit(s) of ' + o.remote + '/' + o.base + ': ' + ok + ' verified, ' + unstamped + ' unstamped, ' + bad + ' mismatch');
    S.mergeCommit = sha; S.attempts = 0; S.extra.commits = rows;
    return bad ? { result: 'mismatch', code: 6 } : { result: 'verified', code: 0 };
  }

  const j = judge(sha);
  S.mergeCommit = sha; S.tree = j.tree || gitOut(['rev-parse', sha + '^{tree}']);
  if (j.stamp) { S.base = j.stamp.base; S.head = j.stamp.head; S.attempts = j.stamp.attempt || 0; S.counts = j.stamp.counts; }
  if (j.state === 'unstamped') { log(short(sha) + ': ' + j.problems[0]); return { result: 'unstamped', code: 5 }; }
  if (j.state === 'mismatch') {
    log(short(sha) + ': the stamp does not match the commit:');
    for (const p of j.problems) bare('  ' + p);
    return { result: 'mismatch', code: 6 };
  }
  log('verified: ' + o.base + "'s tree equals the tree that was tested (" + short(sha) + ', tree ' + short(j.tree) + ', gate "' + j.stamp.gate + '"' +
    (j.stamp.jobs ? ', ' + j.stamp.jobs.passed + ' passed / ' + j.stamp.jobs.failed + ' failed / ' + j.stamp.jobs.skipped + ' skipped jobs' : '') + ')');
  return { result: 'verified', code: 0 };
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

function deletePrivateRefs() {
  if (!REPO) return;
  const list = git(['for-each-ref', '--format=%(refname)', ns() + '/']);
  for (const r of list.stdout.split('\n').filter(Boolean)) git(['update-ref', '-d', r]);
}

async function run(o) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8', env: gitEnv() });
  if (top.status !== 0) throw new LandError(1, 'error', 'not inside a git repository (run land.js from the repo you want to land into)');
  REPO = top.stdout.trim();
  if (!gitOk(['remote', 'get-url', o.remote])) throw new LandError(1, 'error', 'no remote named "' + o.remote + '" (see: git remote -v; or pass --remote)');
  try {
    return o.verify ? verifyMode(o) : await landMode(o);
  } finally {
    deletePrivateRefs();
  }
}

async function main() {
  const wantsJson = process.argv.includes('--json');
  let outcome;
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) { process.stderr.write(usage()); return; }
    process.on('SIGINT', () => stopGateOnSignal('SIGINT'));
    process.on('SIGTERM', () => stopGateOnSignal('SIGTERM'));
    outcome = await run(o);
  } catch (e) {
    if (e instanceof LandError) { log(e.message); outcome = { result: e.result, code: e.code }; }
    else { log('unexpected error: ' + (e && e.stack ? e.stack : e)); outcome = { result: 'error', code: 1 }; }
  }
  if (wantsJson) {
    process.stdout.write(JSON.stringify(Object.assign({
      result: outcome.result, mergeCommit: S.mergeCommit, tree: S.tree, base: S.base, head: S.head,
      attempts: S.attempts, warnings: S.warnings, counts: S.counts,
    }, S.extra)) + '\n');
  }
  process.exitCode = outcome.code;
}

main();

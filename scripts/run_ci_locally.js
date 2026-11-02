#!/usr/bin/env node
/**
 * THE GATE. This repo does not use GitHub Actions (decision D59, Kevin, 2026-10-14: "no more Github
 * actions"; it costs money and he is not paying for it), so this script is the only place the checks
 * run. It runs every job below, in order, and prints one pass/fail table at the end.
 *
 * THIS LIST IS THE SOURCE OF TRUTH. There is no second copy to keep in step: a check that is not in
 * the `jobs` array below is a check nobody runs. (Until D59 the same list was mirrored in
 * .github/workflows/ci.yml; `git show fa865ff:.github/workflows/ci.yml` still has it.)
 *
 * Usage (from the repo root):
 *   npm ci                                 # first time, and after package.json changes
 *   npx playwright install chromium        # first time only (browser for the live suites)
 *   node scripts/run_ci_locally.js         # everything (about 6 min on an M4 laptop; 27.7 min with --serial)
 *   node scripts/run_ci_locally.js --fast  # skip the 7 browser jobs (about 1 min)
 *   node scripts/run_ci_locally.js --post-status
 *                                          # as the first form, then leave a `local-gate` receipt on the
 *                                          # pushed HEAD (a free GitHub commit status; see below)
 *   node scripts/run_ci_locally.js --with-source
 *                                          # also the "source" jobs skipped by default (D81): the source regression run and the
 *                                          # source halves of the two timing budgets (about 745 s + 11 s + 30 s of extra time)
 *   node scripts/run_ci_locally.js --serial
 *                                          # the order before D80: every job one after another and the
 *                                          # regression suite in one page per run (triage only, ~28 min)
 *
 * Needs Node 22 and Python 3 on PATH (python3, or `python` on Windows). The alias check also
 * needs `pip install openpyxl`; the script says so if it is missing. `--post-status` also needs
 * the GitHub CLI (`gh`), logged in, and a HEAD that has been pushed.
 *
 * THE RECEIPT (--post-status). Run it on the tree that will land: your branch with main merged in,
 * committed and pushed. If every blocking job passed, the tree is clean and HEAD contains
 * origin/main, it posts the commit status `local-gate` = success on HEAD, which shows on the pull
 * request as the green check Actions used to give. A failing run posts `failure`. Anything that
 * would make a success untrue (uncommitted changes, behind main, --fast on code) posts nothing and
 * says why. The rules are in scripts/lib/gate_status.js and pinned by tests/check_gate_status.js.
 * It never changes the exit code: that is the gate's own result.
 *
 * SPEED (D80, 2026-10-30). Jobs marked `background` (both regression runs, the basic-build check) start
 * first and run while the headless jobs run here; each writes its own log, printed whole when it
 * finishes. Jobs marked `alone` (the two timing budgets) run last, with nothing else running. The
 * regression runner itself splits the suites into three shards (tests/ci_regression_runner.js,
 * SHARD_TABLE). What is checked does not change, only when. docs/TESTING.md "Speed" has the numbers.
 *
 * Choices made on purpose:
 * - The main file's source regression run is informational (it was continue-on-error in the old CI;
 *   see AGENTS.md "Known flakiness") -- a red run gets the same triage, not a shrug. Since D81 it, and the
 *   source halves of the two budgets, run only with --with-source (jobs marked `source: true`).
 * - The highlight-perf budgets use the old CI's 1.5x scale only when you pass --ci-budgets; on a
 *   laptop the unscaled budgets are the real ones.
 * - Set PW_CHROMIUM_PATH / BF_VENDOR_CDN=1 as the runner documents if your machine needs them.
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
process.chdir(REPO);
// A BF_APP_HTML left in the shell would silently point every "source" job at that file instead
// (resolveAppHtml honours it, and sh() passes the environment on). The dist jobs set it themselves.
if (process.env.BF_APP_HTML) {
  console.log(`(ignoring BF_APP_HTML=${process.env.BF_APP_HTML} from the environment -- source jobs test the source file)`);
  delete process.env.BF_APP_HTML;
}
const args = new Set(process.argv.slice(2));
const FAST = args.has('--fast');
const POST_STATUS = args.has('--post-status');
// --serial: every job one after another and the regression suite in one page per run, as before 2026-10-29 (for triage; see "Speed" above).
const SERIAL = args.has('--serial');
// --with-source: also run the duplicate "source" jobs (the regression run on the babel-in-browser build and the source halves of the two
// timing budgets). Off by default since D81 items 1 and 2 (Kevin, 2026-10-30: "Only run the duplicate source code tests only when it's asked for").
const WITH_SOURCE = args.has('--with-source');
if (SERIAL) process.env.BF_REGRESSION_SHARDS = '1';
const PY = spawnSync('python3', ['--version']).status === 0 ? 'python3' : 'python';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-ci-'));

// Resolves to whether the command exited 0. `out` is a file descriptor for a job running in the background (its output is
// printed in one piece when it finishes); without it the command writes straight to this terminal.
const sh = (cmd, cmdArgs, env = {}, out = null) => new Promise((resolve) => {
  const child = spawn(cmd, cmdArgs, {
    stdio: out === null ? 'inherit' : ['ignore', out, out], shell: process.platform === 'win32', env: { ...process.env, ...env },
  });
  child.on('error', (e) => { console.error(e); resolve(false); });
  child.on('exit', (code) => resolve(code === 0));
});

// The one "which file is the current app" rule (AGENTS.md check 1) -- imported, not pasted.
const { findCurrentAppHtml } = require('./lib/app_file.js');

// The alias-landmine check for a given app file (AGENTS.md check 2); with no file it resolves the main one itself.
const checkAliasLandmines = (...appFile) => {
  if (spawnSync(PY, ['-c', 'import openpyxl']).status !== 0) {
    console.error(`openpyxl missing -- run: ${PY} -m pip install openpyxl`); return false;
  }
  return sh(PY, ['tests/check_alias_landmines.py', 'Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx', ...appFile]);
};

// Babel-transform the app's inline script, then `node --check` the result (AGENTS.md check 1).
const checkAppSyntax = (app, outName) => {
  const src = /<script type="text\/babel">([\s\S]*?)<\/script>/.exec(fs.readFileSync(app, 'utf8'));
  if (!src) { console.error('no <script type="text/babel"> block found'); return false; }
  const out = path.join(TMP, outName);
  fs.writeFileSync(out, require('@babel/core').transformSync(src[1], { presets: ['@babel/preset-react'] }).code);
  return sh('node', ['--check', out]);
};

const jobs = [
  ['Syntax check (Babel + node --check)', () => {
    let app;
    try { app = findCurrentAppHtml(); } catch (err) { console.error(err.message); return false; }
    console.log(`(main app file: ${path.relative(REPO, app)})`);
    return checkAppSyntax(app, 'out.js');
  }],
  ['Deployable build is up to date', async () => {
    if (!(await sh('node', ['scripts/build_deployable.js', '--check']))) return false;
    const payload = require('./build_deployable.js').extractCompiledPayload(fs.readFileSync('dist/index.html', 'utf8'));
    if (!payload) { console.error('no compiled payload found in dist/index.html'); return false; }
    const out = path.join(TMP, 'dist_payload.js');
    fs.writeFileSync(out, payload);
    return sh('node', ['--check', out]);
  }],
  ['Alias-landmine static check', () => checkAliasLandmines()],
  ['Field-picker filter-gating check', () => sh(PY, ['tests/check_field_filter_gating.py'])],
  ['Server preference-resolution check', () => sh('node', ['tests/check_server_prefs_logic.js'])],
  ['Server-extras logic check', () => sh('node', ['tests/check_server_extras_logic.js'])],
  ['Historical archive (Code.gs) check', () => sh('node', ['tests/check_archive_logic.js'])],
  ['Team features (DataFeeds.gs / TeamSheet.gs) check', () => sh('node', ['tests/check_team_features_logic.js'])],
  ['Shared feed snapshot (DataFeeds.gs) check', () => sh('node', ['tests/check_feed_snapshot_logic.js'])],
  ['Empty Planning EP_EXPORT read (DataFeeds.gs, D84 2a-4) check', () => sh('node', ['tests/check_ep_export_logic.js'])],
  ['Decision store (TeamSheet.gs, 2a-3) check', () => sh('node', ['tests/check_decisions_logic.js'])],
  ['Threshold approvers (TeamSheet.gs, 2b-3) check', () => sh('node', ['tests/check_threshold_approvals.js'])],
  ['Text contrast check', () => sh('node', ['tests/check_color_contrast.js'])],
  ['Compare KPI / shared-helper check', () => sh('node', ['tests/check_compare_kpis.js'])],
  ['Review follow-ups check (D79: peak scale, historical slicers, field defaults, blank Trade, tooltip)', () => sh('node', ['tests/check_review_followups.js'])],
  ['Sector Allocation placeholder check', () => sh('node', ['tests/check_sector_alloc_placeholder.js'])],
  ['Macro grid order check', () => sh('node', ['tests/check_macro_grid_order.js'])],
  ['Column picker logic check (D60)', () => sh('node', ['tests/check_column_picker_logic.js'])],
  ['Column order logic check (D67)', () => sh('node', ['tests/check_column_order_logic.js'])],
  ['POL-only call logic check (D68)', () => sh('node', ['tests/check_pol_only_call_logic.js'])],
  ['App-file resolver check', () => sh('node', ['tests/check_resolve_app_html.js'])],
  ['Shared-logic sync check', () => sh('node', ['tests/check_shared_sync.js'])],
  ['Shared-logic behaviour check', () => sh('node', ['tests/check_shared_logic.js'])],
  ['Historical-days helper check', () => sh('node', ['tests/check_history_days.js'])],
  ['Landing script (land.js) check', () => sh('node', ['tests/check_land_script.js'])],
  ['PR function-overlap check', () => sh('node', ['tests/check_pr_overlap.js'])],
  ['Docs-only skip rule check', () => sh('node', ['tests/check_docs_only.js'])],
  ['Gate receipt (local-gate status) logic check', () => sh('node', ['tests/check_gate_status.js'])],
  ['Shared-view injection (Code.gs doGet) check', () => sh('node', ['tests/check_shared_view_injection.js'])],
  ['Date timezone-safety check', () => sh('node', ['tests/check_date_timezone_safety.js'])],
  ['CSV fast-path reader vs SheetJS check', () => sh('node', ['tests/check_csv_fast_path.js'])],
  ['Sector Sheet layout check', () => sh('node', ['tests/check_sector_layout.js'])],
  ['VVD finder logic check (D63)', () => sh('node', ['tests/check_vvd_finder_logic.js'])],
  ['Masthead doodle scenes check (D69 seasonal scenes)', () => sh('node', ['tests/check_masthead_doodle.js'])],
  ['Live regression suite -- source (informational)', (out) => sh('node', ['tests/ci_regression_runner.js'], {}, out), { browser: true, informational: true, background: true, source: true }],
  ['Live regression suite -- dist/index.html', (out) => sh('node', ['tests/ci_regression_runner.js'], { BF_APP_HTML: 'dist/index.html' }, out), { browser: true, background: true }],
  ['Basic build (no Google services) check', (out) => sh('node', ['tests/check_basic_build.js'], {}, out), { browser: true, background: true }],
  ['Row-highlight budget -- source', () => sh('node', ['tests/perf_highlight_benchmark.js'], args.has('--ci-budgets') ? { BF_HIGHLIGHT_BUDGET_SCALE: '1.5' } : {}), { browser: true, alone: true , source: true }],
  ['Row-highlight budget -- dist/index.html', () => sh('node', ['tests/perf_highlight_benchmark.js'], { BF_APP_HTML: 'dist/index.html', ...(args.has('--ci-budgets') ? { BF_HIGHLIGHT_BUDGET_SCALE: '1.5' } : {}) }), { browser: true, alone: true }],
  ['Column-reorder remount + budget (D67) -- source', () => sh('node', ['tests/perf_column_reorder_benchmark.js'], args.has('--ci-budgets') ? { BF_COLREORDER_BUDGET_SCALE: '1.5' } : {}), { browser: true, alone: true , source: true }],
  ['Column-reorder remount + budget (D67) -- dist/index.html', () => sh('node', ['tests/perf_column_reorder_benchmark.js'], { BF_APP_HTML: 'dist/index.html', ...(args.has('--ci-budgets') ? { BF_COLREORDER_BUDGET_SCALE: '1.5' } : {}) }), { browser: true, alone: true }],
];

// ORDER (2026-10-29, gate speed; `--serial` restores the old one-after-another order). The jobs marked `background` start first, each
// writing to its own log, and run while the headless jobs run here one after another; their logs are printed whole when they finish.
// The jobs marked `alone` (the two timing budgets) run last, after everything else has finished, so nothing competes with them for
// the CPU. The regression runs are timing-tolerant (condition waits, not budgets), which D51 relied on when the old CI ran the source
// and dist/ runs side by side; the budgets are not, which is why they still run alone.
const results = new Map();
const banner = (name) => console.log(`\n==================== ${name} ====================`);
const statusOf = (ok, secs, opts) => (ok ? `PASS (${secs}s)` : (opts.informational ? `FAIL -- informational (${secs}s)` : `FAIL (${secs}s)`));
const runForeground = async ([name, run, opts = {}]) => {
  banner(name);
  const start = Date.now();
  let ok;
  try { ok = await run(); } catch (e) { console.error(e); ok = false; }
  results.set(name, [statusOf(ok, ((Date.now() - start) / 1000).toFixed(0), opts), !ok && !opts.informational]);
};

(async () => {
const active = jobs.filter(([name, , opts = {}]) => {
  if (FAST && opts.browser) { results.set(name, ['skipped (--fast)', false]); return false; }
  if (opts.source && !WITH_SOURCE) { results.set(name, ['skipped (source job; pass --with-source)', false]); return false; }
  return true;
});
const background = SERIAL ? [] : active.filter(([, , opts = {}]) => opts.background).map(([name, run, opts = {}]) => {
  const log = path.join(TMP, `job_${name.replace(/[^A-Za-z0-9]+/g, '_')}.log`);
  const fd = fs.openSync(log, 'w');
  const start = Date.now();
  console.log(`(started in the background: ${name})`);
  let promise;
  try { promise = Promise.resolve(run(fd)); } catch (e) { promise = Promise.reject(e); }
  const done = promise.then((ok) => ok, (e) => { fs.writeSync(fd, `${(e && e.stack) || e}\n`); return false; })
    .then((ok) => ({ ok, secs: ((Date.now() - start) / 1000).toFixed(0) }));
  return { name, opts, log, fd, done };
});
for (const job of active) {
  const opts = job[2] || {};
  if (!SERIAL && (opts.background || opts.alone)) continue;
  await runForeground(job);
}
for (const b of background) {
  const { ok, secs } = await b.done;
  fs.closeSync(b.fd);
  banner(b.name); // exactly the job name: scripts/lib/landing.js's parseGateSummary names the counts after it
  console.log(`(ran in the background: ${secs}s; its output follows in one piece)`);
  process.stdout.write(fs.readFileSync(b.log, 'utf8'));
  results.set(b.name, [statusOf(ok, secs, b.opts), !ok && !b.opts.informational]);
}
if (!SERIAL) for (const job of active) if ((job[2] || {}).alone) await runForeground(job);

console.log('\n==================== Summary ====================');
for (const [name, [status]] of jobs.map(([name]) => [name, results.get(name)])) console.log(`${status.startsWith('PASS') ? '✅' : status.startsWith('skipped') ? '⏭️ ' : '❌'} ${name}: ${status}`);
const blocking = [...results.values()].filter(r => r[1]).length;
console.log(blocking === 0 ? '\nLOCAL CI PASSED (every blocking job)' : `\nLOCAL CI FAILED -- ${blocking} blocking job(s)`);

// The receipt (--post-status). Every step here only reads git, except the one `gh api` POST at the
// end; nothing in this block can change the gate's exit code, which is the line above.
function postReceipt() {
  const gate = require('./lib/gate_status.js');
  const git = (a) => spawnSync('git', a, { encoding: 'utf8' });
  const sha = git(['rev-parse', 'HEAD']).stdout.trim();
  const tree = git(['rev-parse', 'HEAD^{tree}']).stdout.trim();
  const dirty = git(['status', '--porcelain']).stdout.trim() !== '';
  // "Up to date" means HEAD contains origin/main. null = could not tell (offline, no remote), which gate_status treats as no.
  let behindMain = null;
  if (git(['fetch', '--quiet', 'origin', 'main']).status === 0) {
    behindMain = git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']).status !== 0;
  }
  // A --fast run counts only for a Markdown-only change (D22, D51): the browser jobs cannot be affected by it.
  let docsOnly = false;
  if (FAST && behindMain === false) {
    const diff = git(['diff', '-z', '--no-renames', '--name-only', 'origin/main', 'HEAD']);
    const { decide, pathsFromNul } = require('./lib/docs_only.js');
    docsOnly = diff.status === 0 && decide({ paths: pathsFromNul(diff.stdout) }).docsOnly;
  }
  const verdict = gate.decide({ fast: FAST, docsOnly, blockingFailures: blocking, dirty, behindMain, tree });
  if (!verdict.post) { console.log(`\nRECEIPT NOT POSTED: ${verdict.reason}`); return; }
  const repo = gate.repoFromRemote(git(['remote', 'get-url', 'origin']).stdout);
  if (!repo) { console.log('\nRECEIPT NOT POSTED: could not read owner/repo from the origin remote'); return; }
  const r = spawnSync('gh', gate.ghArgs(repo, sha, verdict), { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    const why = ((r.error && r.error.message) || r.stderr || r.stdout || '').toString().trim().split('\n')[0];
    console.log(`\nRECEIPT NOT POSTED: gh failed (${why}). Is HEAD ${sha.slice(0, 9)} pushed, and is gh logged in? The gate result above stands either way.`);
    return;
  }
  console.log(`\nRECEIPT POSTED: ${gate.CONTEXT} = ${verdict.state} on ${sha.slice(0, 9)} (${repo}): ${verdict.description}`);
}
if (POST_STATUS) {
  try { postReceipt(); } catch (e) { console.log(`\nRECEIPT NOT POSTED: ${e.message}`); }
}

fs.rmSync(TMP, { recursive: true, force: true });
process.exit(blocking === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

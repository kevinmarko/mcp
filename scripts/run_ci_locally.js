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
 *   node scripts/run_ci_locally.js         # everything (about 11 min; the two live regression suites dominate)
 *   node scripts/run_ci_locally.js --fast  # skip the 5 browser jobs (about 1 min)
 *   node scripts/run_ci_locally.js --post-status
 *                                          # as the first form, then leave a `local-gate` receipt on the
 *                                          # pushed HEAD (a free GitHub commit status; see below)
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
 * Choices made on purpose:
 * - The main file's source regression run is informational (it was continue-on-error in the old CI;
 *   see AGENTS.md "Known flakiness") -- a red run gets the same triage, not a shrug.
 * - The highlight-perf budgets use the old CI's 1.5x scale only when you pass --ci-budgets; on a
 *   laptop the unscaled budgets are the real ones.
 * - Set PW_CHROMIUM_PATH / BF_VENDOR_CDN=1 as the runner documents if your machine needs them.
 */
'use strict';
const { spawnSync } = require('child_process');
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
const PY = spawnSync('python3', ['--version']).status === 0 ? 'python3' : 'python';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-ci-'));

const sh = (cmd, cmdArgs, env = {}) => spawnSync(cmd, cmdArgs, {
  stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env },
}).status === 0;

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
  ['Deployable build is up to date', () => {
    if (!sh('node', ['scripts/build_deployable.js', '--check'])) return false;
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
  ['Text contrast check', () => sh('node', ['tests/check_color_contrast.js'])],
  ['Compare KPI / shared-helper check', () => sh('node', ['tests/check_compare_kpis.js'])],
  ['Sector Allocation placeholder check', () => sh('node', ['tests/check_sector_alloc_placeholder.js'])],
  ['Macro grid order check', () => sh('node', ['tests/check_macro_grid_order.js'])],
  ['Column picker logic check (D60)', () => sh('node', ['tests/check_column_picker_logic.js'])],
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
  ['Sector Sheet layout check', () => sh('node', ['tests/check_sector_layout.js'])],
  ['Live regression suite -- source (informational)', () => sh('node', ['tests/ci_regression_runner.js']), { browser: true, informational: true }],
  ['Live regression suite -- dist/index.html', () => sh('node', ['tests/ci_regression_runner.js'], { BF_APP_HTML: 'dist/index.html' }), { browser: true }],
  ['Basic build (no Google services) check', () => sh('node', ['tests/check_basic_build.js']), { browser: true }],
  ['Row-highlight budget -- source', () => sh('node', ['tests/perf_highlight_benchmark.js'], args.has('--ci-budgets') ? { BF_HIGHLIGHT_BUDGET_SCALE: '1.5' } : {}), { browser: true }],
  ['Row-highlight budget -- dist/index.html', () => sh('node', ['tests/perf_highlight_benchmark.js'], { BF_APP_HTML: 'dist/index.html', ...(args.has('--ci-budgets') ? { BF_HIGHLIGHT_BUDGET_SCALE: '1.5' } : {}) }), { browser: true }],
];

const results = [];
for (const [name, run, opts = {}] of jobs) {
  if (FAST && opts.browser) { results.push([name, 'skipped (--fast)']); continue; }
  console.log(`\n==================== ${name} ====================`);
  const start = Date.now();
  let ok;
  try { ok = run(); } catch (e) { console.error(e); ok = false; }
  const secs = ((Date.now() - start) / 1000).toFixed(0);
  results.push([name, ok ? `PASS (${secs}s)` : (opts.informational ? `FAIL -- informational (${secs}s)` : `FAIL (${secs}s)`), !ok && !opts.informational]);
}

console.log('\n==================== Summary ====================');
for (const [name, status] of results) console.log(`${status.startsWith('PASS') ? '✅' : status.startsWith('skipped') ? '⏭️ ' : '❌'} ${name}: ${status}`);
const blocking = results.filter(r => r[2]).length;
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

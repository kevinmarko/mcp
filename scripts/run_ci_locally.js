#!/usr/bin/env node
/**
 * Run this repo's CI on your own machine -- every job in .github/workflows/ci.yml, in order,
 * with the same commands -- and print one pass/fail table at the end.
 *
 * WHY: CI is the check that runs whether or not anyone remembers to. When GitHub Actions can't
 * run (2026-09-26: no job got a runner for a day, `main` included -- an account-level block,
 * not the code), this is the same set of checks, run by hand.
 *
 * Usage (from the repo root):
 *   npm ci                                 # first time, and after package.json changes
 *   npx playwright install chromium        # first time only (browser for the live suites)
 *   node scripts/run_ci_locally.js         # everything (~10-15 min; the perf jobs dominate)
 *   node scripts/run_ci_locally.js --fast  # skip the 4 browser jobs (~10 s)
 *
 * Needs Node 22 and Python 3 on PATH (python3, or `python` on Windows). The alias check also
 * needs `pip install openpyxl`; the script says so if it is missing.
 *
 * Differences from GitHub, on purpose:
 * - The regression suite is informational here too (CI marks it continue-on-error; see
 *   AGENTS.md "Known flakiness") -- a red run gets the same triage, not a shrug.
 * - The highlight-perf budgets use CI's 1.5x scale only when you pass --ci-budgets; on a laptop
 *   the unscaled budgets are the real ones.
 * - Set PW_CHROMIUM_PATH / BF_VENDOR_CDN=1 as the runner documents if your machine needs them.
 * Keep this list in step with ci.yml: a job added there and not here is a check nobody runs
 * when Actions is down.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
process.chdir(REPO);
const args = new Set(process.argv.slice(2));
const FAST = args.has('--fast');
const PY = spawnSync('python3', ['--version']).status === 0 ? 'python3' : 'python';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-ci-'));

const sh = (cmd, cmdArgs, env = {}) => spawnSync(cmd, cmdArgs, {
  stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env },
}).status === 0;

// Same auto-detect as ci.yml's syntax-check job (and AGENTS.md check 1) -- imported, not pasted.
const { resolveAppHtml } = require('../tests/perf_benchmark.js');

const jobs = [
  ['Syntax check (Babel + node --check)', () => {
    const app = resolveAppHtml();
    console.log(`(main app file: ${path.relative(REPO, app)})`);
    const src = /<script type="text\/babel">([\s\S]*?)<\/script>/.exec(fs.readFileSync(app, 'utf8'));
    if (!src) { console.error('no <script type="text/babel"> block found'); return false; }
    const out = path.join(TMP, 'out.js');
    fs.writeFileSync(out, require('@babel/core').transformSync(src[1], { presets: ['@babel/preset-react'] }).code);
    return sh('node', ['--check', out]);
  }],
  ['Deployable build is up to date', () => {
    if (!sh('node', ['scripts/build_deployable.js', '--check'])) return false;
    const payload = require('./build_deployable.js').extractCompiledPayload(fs.readFileSync('dist/index.html', 'utf8'));
    if (!payload) { console.error('no compiled payload found in dist/index.html'); return false; }
    const out = path.join(TMP, 'dist_payload.js');
    fs.writeFileSync(out, payload);
    return sh('node', ['--check', out]);
  }],
  ['Alias-landmine static check', () => {
    if (spawnSync(PY, ['-c', 'import openpyxl']).status !== 0) {
      console.error(`openpyxl missing -- run: ${PY} -m pip install openpyxl`); return false;
    }
    return sh(PY, ['tests/check_alias_landmines.py', 'Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx']);
  }],
  ['Field-picker filter-gating check', () => sh(PY, ['tests/check_field_filter_gating.py'])],
  ['Server preference-resolution check', () => sh('node', ['tests/check_server_prefs_logic.js'])],
  ['Compare KPI / shared-helper check', () => sh('node', ['tests/check_compare_kpis.js'])],
  ['App-file resolver check', () => sh('node', ['tests/check_resolve_app_html.js'])],
  ['Date timezone-safety check', () => sh('node', ['tests/check_date_timezone_safety.js'])],
  ['Live regression suite -- source (informational, as in CI)', () => sh('node', ['tests/ci_regression_runner.js']), { browser: true, informational: true }],
  ['Live regression suite -- dist/index.html', () => sh('node', ['tests/ci_regression_runner.js'], { BF_APP_HTML: 'dist/index.html' }), { browser: true }],
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
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(blocking === 0 ? 0 : 1);

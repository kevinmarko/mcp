#!/usr/bin/env node
/**
 * Headless check for the receipt the local gate leaves on a commit (scripts/lib/gate_status.js,
 * decision D59): when `run_ci_locally.js --post-status` may say "local-gate: success", and the exact
 * `gh` arguments it posts with.
 *
 * WHY THIS EXISTS
 *
 * With GitHub Actions gone, this status is the only green check a pull request can show, so a wrong
 * "success" is the one failure that would hide an untested change behind a tick. Every way the gate
 * could be fooled is pinned here: a dirty tree, a branch behind main, a main that could not be
 * fetched, a --fast run on code, a real failure. It needs only Node: no git, no browser, no network.
 *
 * Run:  node tests/check_gate_status.js
 */
'use strict';
const { CONTEXT, decide, repoFromRemote, ghArgs } = require('../scripts/lib/gate_status.js');

let pass = 0;
const failures = [];
function t(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else failures.push(name + '\n      got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));
}
const TREE = '0123456789abcdef0123456789abcdef01234567';
const clean = { fast: false, docsOnly: false, blockingFailures: 0, dirty: false, behindMain: false, tree: TREE };
const with_ = (o) => Object.assign({}, clean, o);

// ---- the green path ----
t('a full clean pass up to date posts success', [decide(clean).post, decide(clean).state], [true, 'success']);
t('the success text names the run kind and the short tree', decide(clean).description, 'Local gate passed (full run); branch contains main; tree 0123456789ab');
t('a docs-only --fast pass posts success, and says so', decide(with_({ fast: true, docsOnly: true })).description, 'Local gate passed (docs-only, --fast); branch contains main; tree 0123456789ab');

// ---- every way the gate must NOT vouch for a commit ----
t('a dirty tree posts nothing', decide(with_({ dirty: true })).post, false);
t('a dirty tree wins over a failure (nothing to attribute it to)', decide(with_({ dirty: true, blockingFailures: 2 })).post, false);
t('a branch behind main posts nothing', decide(with_({ behindMain: true })).post, false);
t('"could not tell" (null) is treated as not up to date', decide(with_({ behindMain: null })).post, false);
t('"could not tell" (undefined) is treated as not up to date', decide(with_({ behindMain: undefined })).post, false);
t('--fast on code posts nothing', decide(with_({ fast: true })).post, false);
t('--fast on code says why', /full gate/.test(decide(with_({ fast: true })).reason), true);
t('no options at all posts nothing', decide().post, false);

// ---- a real failure is shown, not hidden ----
const bad = decide(with_({ blockingFailures: 3 }));
t('blocking failures post failure', [bad.post, bad.state], [true, 'failure']);
t('the failure text counts the jobs', bad.description, 'Local gate FAILED (full run): 3 blocking job(s); tree 0123456789ab');
t('a --fast docs-only run with a failure is a failure too', decide(with_({ fast: true, docsOnly: true, blockingFailures: 1 })).state, 'failure');
t('a failure is still withheld when behind main', decide(with_({ blockingFailures: 1, behindMain: true })).post, false);

// ---- limits GitHub enforces ----
t('descriptions never exceed 140 characters', decide(with_({ blockingFailures: 99999999, tree: 'x'.repeat(500) })).description.length <= 140, true);

// ---- repo name from the remotes git prints ----
t('https remote', repoFromRemote('https://github.com/kevinmarko/booking-flash-report'), 'kevinmarko/booking-flash-report');
t('https remote with .git and a newline', repoFromRemote('https://github.com/kevinmarko/booking-flash-report.git\n'), 'kevinmarko/booking-flash-report');
t('ssh remote', repoFromRemote('git@github.com:kevinmarko/booking-flash-report.git'), 'kevinmarko/booking-flash-report');
t('sandbox proxy remote with credentials', repoFromRemote('http://local_proxy@127.0.0.1:43211/git/kevinmarko/booking-flash-report'), 'kevinmarko/booking-flash-report');
t('trailing slash', repoFromRemote('https://github.com/kevinmarko/booking-flash-report/'), 'kevinmarko/booking-flash-report');
t('garbage gives null', repoFromRemote('nonsense'), null);
t('empty gives null', repoFromRemote(''), null);

// ---- the exact gh call ----
t('gh arguments: endpoint, state, context and description, no shell string', ghArgs('o/r', 'abc123', { state: 'success', description: 'ok; "quoted" $(not run)' }),
    ['api', '-X', 'POST', 'repos/o/r/statuses/abc123', '-f', 'state=success', '-f', 'context=local-gate', '-f', 'description=ok; "quoted" $(not run)']);
t('the context is the one the branch rule would require', CONTEXT, 'local-gate');

if (failures.length > 0) {
    console.error('GATE_STATUS_CHECK_FAILED: ' + failures.length + ' failure(s), ' + pass + ' passed');
    failures.forEach(function (f) { console.error('  x ' + f); });
    process.exit(1);
}
console.log('GATE_STATUS_CHECK_PASSED (' + pass + ' assertions)');

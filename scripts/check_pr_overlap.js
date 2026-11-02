#!/usr/bin/env node
// Which open branches change the same FUNCTIONS as this one?
//
// WHY: two pull requests can each pass CI on their own and still break each other once both are merged
// (#185 and #186 did: no text conflict, wrong combined behaviour). The app is a single 17,000-line HTML file,
// so "both changed the same file" is always true and useless; "both changed the same function" is the
// signal. This script says so BEFORE you open a PR, so you can ask whether to sequence the two.
//
// It reads git only (the network is touched only by --fetch and by a pull request number; no GitHub API, no gh). The mapping from changed lines to
// functions lives in scripts/lib/pr_overlap.js, with the reasons for each design choice.
//
// Usage (from anywhere inside the repo):
//   node scripts/check_pr_overlap.js                         HEAD against every remote branch
//   node scripts/check_pr_overlap.js --ref 186               a pull request (fetched through refs/pull/186/head)
//   node scripts/check_pr_overlap.js --ref my-branch --against 'feature-*'
//
// Options:
//   --ref <branch|sha|123>   what to test (default HEAD). A number or #number is a pull request.
//   --base <rev>             what "already merged" means (default <remote>/main). Each branch is diffed from its
//                            merge-base with this.
//   --against <glob>         limit the branches compared (default all). A glob over the name after "<remote>/";
//                            two stars cross slashes. A glob starting with refs/ matches full ref names.
//   --remote <name>          default origin
//   --fetch                  git fetch <remote> --prune first (with a pull request number, the only network use)
//   --json                   one JSON object on stdout; progress and logs go to stderr
//   --fail-on-overlap        exit 1 when any HIGH overlap exists (default: always exit 0 once it ran)
//   --verbose                show every branch, LOW matches, and why branches were skipped
//   --max-branches <n>       branches printed in the default view (default 10)
//
// Severity: HIGH = both changed the same function (or one changed a function nested in the other's).
//           LOW  = both changed something in the same top-level symbol (for example the same huge component)
//                  but in different functions. Printed only with --verbose.
// Exit codes: 0 ran (and, with --fail-on-overlap, found no HIGH), 1 HIGH overlap with --fail-on-overlap,
//             2 usage or git error.
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('./lib/pr_overlap.js');

function usage(code) {
    const text = require('fs').readFileSync(__filename, 'utf8').split('\n')
        .filter((l) => l.startsWith('//')).slice(1, 33).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
    (code === 0 ? process.stdout : process.stderr).write(text + '\n');
    process.exit(code);
}

function parseArgs(argv) {
    const o = { ref: 'HEAD', base: null, against: null, remote: 'origin', fetch: false, json: false, failOnOverlap: false, verbose: false, maxBranches: 10 };
    const takes = { '--ref': 'ref', '--base': 'base', '--against': 'against', '--remote': 'remote', '--max-branches': 'maxBranches' };
    for (let i = 0; i < argv.length; i++) {
        let a = argv[i];
        let inline = null;
        const eq = a.indexOf('=');
        if (a.startsWith('--') && eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
        if (a === '--help' || a === '-h') usage(0);
        else if (a === '--fetch') o.fetch = true;
        else if (a === '--json') o.json = true;
        else if (a === '--fail-on-overlap') o.failOnOverlap = true;
        else if (a === '--verbose') o.verbose = true;
        else if (takes[a]) {
            const v = inline !== null ? inline : argv[++i];
            if (v === undefined || v.startsWith('--')) { process.stderr.write('check_pr_overlap: ' + a + ' needs a value\n'); usage(2); }
            o[takes[a]] = takes[a] === 'maxBranches' ? Number(v) : v;
        } else { process.stderr.write('check_pr_overlap: unknown argument ' + argv[i] + '\n'); usage(2); }
    }
    if (!Number.isFinite(o.maxBranches) || o.maxBranches < 1) { process.stderr.write('check_pr_overlap: --max-branches must be a positive number\n'); usage(2); }
    return o;
}

const sizeText = (c) => '+' + c.added + '/-' + c.removed;
const shortFile = (f) => f;

function printHuman(r, o, seconds) {
    const out = [];
    const w = (s) => out.push(s);
    w('check_pr_overlap: ' + r.ref.name + ' (' + r.ref.sha.slice(0, 7) + ') against ' + (o.against ? '"' + o.against + '"' : 'all ' + o.remote + ' branches') +
        ', base ' + (r.base.name === r.base.sha ? r.base.sha.slice(0, 7) : r.base.name + ' (' + r.base.sha.slice(0, 7) + ')'));
    if (r.note) { w('  ' + r.note); process.stdout.write(out.join('\n') + '\n'); return; }
    const reasons = {};
    for (const s of r.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    const why = Object.keys(reasons).sort().map((k) => reasons[k] + ' ' + k).join(', ');
    w('  this ref changes ' + r.ref.changedSymbols + ' symbols (' + r.ref.changedLines + ' lines) in ' + r.ref.files.length + ' code file' + (r.ref.files.length === 1 ? '' : 's'));
    w('  compared ' + r.compared + ' branches with code changes in ' + seconds.toFixed(1) + ' s');
    if (r.skipped.length) w('  skipped ' + r.skipped.length + ': ' + why);
    w('');
    const shown = o.verbose ? r.overlaps : r.overlaps.filter((x) => x.high.length).slice(0, o.maxBranches);
    for (const b of shown) {
        w('OVERLAP ' + b.branch + '  (last commit ' + b.date + ' ' + b.shortSha + ')  HIGH ' + b.high.length + (b.low.length ? ', LOW ' + b.low.length : ''));
        const cap = o.verbose ? Infinity : 8;
        b.high.slice(0, cap).forEach((h) => {
            w('    HIGH ' + shortFile(h.file) + ' :: ' + h.symbol + (h.relation === 'nested' ? '  (one side changed a function nested inside the other)' : '') +
                (h.span > 400 ? '  [a ' + h.span + '-line symbol: edits made directly in its body]' : '') +
                '   you ' + sizeText(h.ref) + ', they ' + sizeText(h.other));
        });
        if (b.high.length > cap) w('    ... and ' + (b.high.length - cap) + ' more HIGH (use --verbose)');
        if (o.verbose) b.low.forEach((l) => w('    LOW  ' + shortFile(l.file) + ' :: ' + l.symbol + '   you ' + sizeText(l.ref) + ', they ' + sizeText(l.other)));
        else if (b.low.length) w('    (+ ' + b.low.length + ' LOW: same top-level symbol, different functions; --verbose lists them)');
    }
    const withHigh = r.overlaps.filter((x) => x.high.length);
    if (!o.verbose && withHigh.length > shown.length) w('... and ' + (withHigh.length - shown.length) + ' more branches with HIGH overlap (use --verbose or --max-branches)');
    if (!o.verbose && r.totals.branchesWithLow) w('(' + r.totals.branchesWithLow + ' more branches share only a top-level symbol with this ref: LOW, shown with --verbose)');
    if (o.verbose && r.skipped.length) {
        w('');
        w('skipped:');
        r.skipped.forEach((s) => w('    ' + s.name + '  -- ' + s.reason));
    }
    r.warnings.forEach((m) => w('WARN: ' + m));
    w('');
    if (r.totals.high) w('RESULT: ' + r.totals.branchesWithHigh + ' branch' + (r.totals.branchesWithHigh === 1 ? '' : 'es') + ' changed the same function(s) as this ref (' + r.totals.high + ' HIGH). Say so in the PR and ask whether to sequence them.');
    else w('RESULT: no other open branch changed the same function as this ref.');
    process.stdout.write(out.join('\n') + '\n');
}

function main() {
    const o = parseArgs(process.argv.slice(2));
    const log = (m) => process.stderr.write('check_pr_overlap: ' + m + '\n');
    let top;
    try {
        top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
        process.stderr.write('check_pr_overlap: not inside a git repository\n');
        process.exit(2);
    }
    const git = lib.makeGit(path.resolve(top));
    const t0 = Date.now();
    if (o.fetch) {
        log('git fetch ' + o.remote + ' --prune');
        const f = git.run(['fetch', '--quiet', '--prune', o.remote]);
        if (f.status !== 0) { process.stderr.write('check_pr_overlap: fetch failed: ' + f.stderr.trim() + '\n'); process.exit(2); }
    }
    let r;
    try {
        r = lib.analyze({ git, ref: o.ref, base: o.base, against: o.against, remote: o.remote });
    } catch (e) {
        process.stderr.write('check_pr_overlap: ' + e.message + '\n');
        process.exit(2);
    }
    const seconds = (Date.now() - t0) / 1000;
    if (o.json) {
        process.stdout.write(JSON.stringify(Object.assign({ seconds: Math.round(seconds * 100) / 100 }, r), null, 2) + '\n');
    } else {
        printHuman(r, o, seconds);
    }
    process.exit(o.failOnOverlap && r.totals.high > 0 ? 1 : 0);
}

main();

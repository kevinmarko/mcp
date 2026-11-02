#!/usr/bin/env node
/**
 * Prints `docs_only=true` or `docs_only=false` to stdout (the format $GITHUB_OUTPUT takes) and the
 * reason on stderr. CI's `changes` job runs it so the browser jobs can skip a Markdown-only pull
 * request. The rule lives in scripts/lib/docs_only.js; see decision D51 for why.
 *
 * It compares the checked-out merge commit with its first parent (the base branch tip), which is
 * exactly what the pull request would change. Any failure prints `docs_only=false` and exits 0:
 * a script that cannot decide must never be the reason a suite is skipped, or the reason the job
 * fails.
 *
 * Run:  node scripts/ci_docs_only.js [base] [head]      (default HEAD^1 HEAD)
 */
'use strict';
const { spawnSync } = require('child_process');
const { decide, pathsFromNul } = require('./lib/docs_only.js');

function main() {
    const base = process.argv[2] || 'HEAD^1';
    const head = process.argv[3] || 'HEAD';
    const r = spawnSync('git', ['diff', '-z', '--no-renames', '--name-only', base, head], { encoding: 'utf8' });
    if (r.error || r.status !== 0) {
        console.error('ci_docs_only: git diff failed (' + ((r.error && r.error.message) || r.stderr || r.status).toString().trim() + '); running everything');
        return { docsOnly: false };
    }
    const verdict = decide({ event: process.env.GITHUB_EVENT_NAME || '', paths: pathsFromNul(r.stdout) });
    console.error('ci_docs_only: ' + verdict.reason);
    return verdict;
}

let verdict = { docsOnly: false };
try {
    verdict = main();
} catch (err) {
    console.error('ci_docs_only: ' + err.message + '; running everything');
}
console.log('docs_only=' + (verdict.docsOnly ? 'true' : 'false'));

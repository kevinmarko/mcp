#!/usr/bin/env node
/**
 * Headless check for the docs-only decision CI uses to skip the browser jobs:
 * scripts/lib/docs_only.js (the rule) and scripts/ci_docs_only.js (the CLI the `changes` job runs).
 *
 * WHY THIS EXISTS
 *
 * A wrong "yes" here lets an untested code change reach main behind a green check, and nothing
 * else would notice: the skipped jobs report Success. So the rule is pinned both as pure logic and
 * end to end, against throwaway git repositories: a Markdown-only commit is docs-only; adding any
 * other file is not; renaming a code file to .md is not (the old path counts); an empty commit is
 * not; and a push event is never docs-only. It needs only Node and git: no browser, no network.
 *
 * Run:  node tests/check_docs_only.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isDocsPath, pathsFromNul, decide } = require('../scripts/lib/docs_only.js');

const CLI = path.join(__dirname, '..', 'scripts', 'ci_docs_only.js');
let pass = 0;
const failures = [];
function t(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else failures.push(name + '\n      got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));
}

// ---- the rule, as pure logic ----
t('README.md is docs', isDocsPath('README.md'), true);
t('a nested .md is docs', isDocsPath('docs/DECISIONS.md'), true);
t('.MD in capitals is docs', isDocsPath('NOTES.MD'), true);
t('the app file is not docs', isDocsPath('Booking_flash_report_na_2.5_WORKING_PRO_ONLY.html'), false);
t('a script is not docs', isDocsPath('scripts/land.js'), false);
t('a non-Markdown file under docs/ is not docs', isDocsPath('docs/diagram.png'), false);
t('the workflow file is not docs', isDocsPath('.github/workflows/ci.yml'), false);
t('.md as a directory name is not docs', isDocsPath('notes.md/run.sh'), false);
t('a name merely containing md is not docs', isDocsPath('amd'), false);
t('an absolute path is refused', isDocsPath('/etc/notes.md'), false);
t('a parent-directory path is refused', isDocsPath('docs/../app.html.md'), false);
t('the empty string is refused', isDocsPath(''), false);
t('a non-string is refused', isDocsPath(null), false);

t('NUL-separated output is split and the trailing NUL ignored', pathsFromNul('a.md\0b.js\0'), ['a.md', 'b.js']);
t('empty output is no paths', pathsFromNul(''), []);
t('undefined output is no paths', pathsFromNul(undefined), []);

t('all Markdown on a pull request is docs-only', decide({ event: 'pull_request', paths: ['README.md', 'docs/TESTING.md'] }).docsOnly, true);
t('run by hand (no event) with Markdown is docs-only', decide({ event: '', paths: ['README.md'] }).docsOnly, true);
t('one code file among Markdown is not docs-only', decide({ event: 'pull_request', paths: ['README.md', 'scripts/land.js'] }).docsOnly, false);
t('the reason names the first non-Markdown file', /scripts\/land\.js/.test(decide({ event: 'pull_request', paths: ['a.md', 'scripts/land.js'] }).reason), true);
t('an empty list is not docs-only', decide({ event: 'pull_request', paths: [] }).docsOnly, false);
t('a missing list is not docs-only', decide({ event: 'pull_request' }).docsOnly, false);
t('no options at all is not docs-only', decide().docsOnly, false);
t('a push is never docs-only', decide({ event: 'push', paths: ['README.md'] }).docsOnly, false);
t('a schedule or dispatch run is never docs-only', decide({ event: 'workflow_dispatch', paths: ['README.md'] }).docsOnly, false);

// ---- the CLI, end to end, against a throwaway repository ----
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-only-check-'));
function git() {
    const r = spawnSync('git', Array.prototype.slice.call(arguments), { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + Array.prototype.slice.call(arguments).join(' ') + ' failed: ' + r.stderr);
    return r.stdout;
}
function write(rel, text) {
    const full = path.join(repo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
}
function commit(msg, extra) {
    git.apply(null, ['add', '-A']);
    git.apply(null, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', msg].concat(extra || []));
}
// Runs the CLI over the last commit (HEAD~1..HEAD, the same shape as a merge commit against its
// first parent) with the given GITHUB_EVENT_NAME, and returns its stdout line.
function cli(event, args) {
    const env = Object.assign({}, process.env);
    delete env.GITHUB_EVENT_NAME;
    if (event) env.GITHUB_EVENT_NAME = event;
    const r = spawnSync('node', [CLI].concat(args || ['HEAD~1', 'HEAD']), { cwd: repo, env: env, encoding: 'utf8' });
    return { out: r.stdout.trim(), status: r.status };
}

try {
    git('init', '-q');
    write('app.js', 'console.log(1);\n');
    write('README.md', '# one\n');
    commit('base');

    write('README.md', '# two\n');
    write('docs/NOTES.md', 'notes\n');
    commit('markdown only');
    t('CLI: a Markdown-only commit on a pull_request is docs-only', cli('pull_request'), { out: 'docs_only=true', status: 0 });
    t('CLI: run by hand with no event is docs-only too', cli(''), { out: 'docs_only=true', status: 0 });
    t('CLI: the same commit on a push is not docs-only', cli('push'), { out: 'docs_only=false', status: 0 });

    write('README.md', '# three\n');
    write('app.js', 'console.log(2);\n');
    commit('markdown and code');
    t('CLI: Markdown plus code is not docs-only', cli('pull_request'), { out: 'docs_only=false', status: 0 });

    write('README.md', '# four\n');
    write('data.csv', 'a,b\n');
    commit('markdown and a csv');
    t('CLI: Markdown plus a data file is not docs-only', cli('pull_request'), { out: 'docs_only=false', status: 0 });

    git('mv', 'app.js', 'app.md');
    commit('rename code to .md');
    t('CLI: renaming a code file to .md is not docs-only (the old path counts)', cli('pull_request'), { out: 'docs_only=false', status: 0 });

    commit('empty', ['--allow-empty']);
    t('CLI: a commit that changes nothing is not docs-only', cli('pull_request'), { out: 'docs_only=false', status: 0 });

    // A double quote cannot be part of a file name on Windows, so the awkward-name case only runs elsewhere.
    if (process.platform !== 'win32') {
        write('quote"d name.md', 'x\n');
        commit('awkward file name');
        t('CLI: a Markdown file with a quote and a space in its name is still docs-only (NUL-separated output)', cli('pull_request'), { out: 'docs_only=true', status: 0 });
    } else {
        t('CLI: a Markdown file with a quote and a space in its name is still docs-only (skipped: Windows cannot create this name)', 'skipped', 'skipped');
    }

    t('CLI: an unknown ref fails safe (docs_only=false, exit 0)', cli('pull_request', ['no-such-ref', 'HEAD']), { out: 'docs_only=false', status: 0 });
} finally {
    fs.rmSync(repo, { recursive: true, force: true });
}

if (failures.length > 0) {
    console.error('DOCS_ONLY_CHECK_FAILED: ' + failures.length + ' failure(s), ' + pass + ' passed');
    failures.forEach(function (f) { console.error('  x ' + f); });
    process.exit(1);
}
console.log('DOCS_ONLY_CHECK_PASSED (' + pass + ' assertions)');

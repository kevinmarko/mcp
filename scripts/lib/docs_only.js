/**
 * Decides whether a pull request changes documentation only, so CI can skip the three browser jobs
 * (the live regression suite, the basic-build check and the row-highlight budget) that take 10 to 19
 * minutes and cannot be affected by a Markdown file. Used by scripts/ci_docs_only.js and tested by
 * tests/check_docs_only.js. Decision D51 in docs/DECISIONS.md has the history.
 *
 * The rule is deliberately narrow: a change is docs-only only if it touched at least one file and
 * EVERY file it touched is a Markdown (.md) file. Anything else, an empty list included, runs the
 * full suite, because the cost of a wrong "yes" (an untested change reaches main) is far higher than
 * the cost of a wrong "no" (a few extra minutes).
 */
'use strict';

function isDocsPath(p) {
    if (typeof p !== 'string' || p === '') return false;
    // git never emits these; refuse them anyway so a malformed list cannot read as docs.
    if (p.charAt(0) === '/' || p.split('/').indexOf('..') !== -1) return false;
    return /\.md$/i.test(p);
}

// `git diff -z --name-only` output: paths separated by NUL, with a trailing NUL.
function pathsFromNul(out) {
    return String(out || '').split('\0').filter(function (s) { return s !== ''; });
}

// event is GITHUB_EVENT_NAME, or '' when run by hand. Only a pull_request can be docs-only: a push
// to main is the one run that must always test the real tree.
function decide(opts) {
    var event = (opts && opts.event) || '';
    var paths = (opts && opts.paths) || [];
    if (event !== '' && event !== 'pull_request') {
        return { docsOnly: false, reason: 'event is ' + event + ', not pull_request' };
    }
    if (paths.length === 0) return { docsOnly: false, reason: 'no changed files found' };
    var other = paths.filter(function (p) { return !isDocsPath(p); });
    if (other.length > 0) {
        return { docsOnly: false, reason: other.length + ' of ' + paths.length + ' changed files are not Markdown, e.g. ' + other[0] };
    }
    return { docsOnly: true, reason: 'all ' + paths.length + ' changed files are Markdown' };
}

module.exports = { isDocsPath: isDocsPath, pathsFromNul: pathsFromNul, decide: decide };

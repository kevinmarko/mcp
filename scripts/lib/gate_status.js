/**
 * The receipt the local gate leaves on a commit, now that GitHub Actions is not used (decision D59 in
 * docs/DECISIONS.md). `node scripts/run_ci_locally.js --post-status` calls this to decide whether it
 * may post a GitHub commit status named `local-gate`, and with what words. A commit status costs
 * nothing (it is not an Actions run), shows as a green check on the pull request, and can be made
 * a required check in the branch rule if Kevin wants GitHub to enforce it.
 *
 * WHY THE RULES ARE THIS STRICT
 *
 * The status stands in for the green check Actions used to give, so a "success" must mean what that
 * check meant: every blocking job passed, on a tree that is the commit (nothing uncommitted), that
 * already contains main (D45's "up to date" rule). Anything weaker is not posted at all. A missing
 * status is honest ("no one ran the gate on this head"); a wrong green one is not.
 *
 *   dirty tree          -> no post: the result describes files that are not in the commit.
 *   behind / unknown    -> no post: HEAD does not contain origin/main, or main could not be fetched.
 *   --fast, not docs    -> no post: the browser jobs were skipped and this change can reach them.
 *   --fast, docs-only   -> may post success: the browser jobs cannot be affected by Markdown (D22, D51).
 *   a blocking failure  -> posts `failure`, so the pull request shows the red run instead of silence.
 *
 * Pure logic, no git and no network: tests/check_gate_status.js pins every branch.
 */
'use strict';

var CONTEXT = 'local-gate';

// GitHub rejects descriptions over 140 characters.
function clip(s) {
    s = String(s);
    return s.length <= 140 ? s : s.slice(0, 137) + '...';
}

// opts: { fast, docsOnly, blockingFailures, dirty, behindMain (true | false | null = could not tell), tree }
// Returns { post: false, reason } or { post: true, state, description }.
function decide(opts) {
    var o = opts || {};
    if (o.dirty) {
        return { post: false, reason: 'the working tree has uncommitted changes, so the result would describe files that are not in the commit; commit or stash them and run the gate again' };
    }
    if (o.behindMain === null || o.behindMain === undefined) {
        return { post: false, reason: 'could not tell whether HEAD contains origin/main (is the remote reachable?); a receipt must prove the branch is up to date' };
    }
    if (o.behindMain) {
        return { post: false, reason: 'HEAD does not contain origin/main; merge main into the branch and run the gate again, because a pass on a stale tree says nothing about the merged one' };
    }
    if (o.fast && !o.docsOnly) {
        return { post: false, reason: '--fast skips the browser jobs and this change is not Markdown-only; run the full gate (without --fast) to get a receipt' };
    }
    var tree = String(o.tree || '').slice(0, 12);
    var kind = o.fast ? 'docs-only, --fast' : 'full run';
    if (o.blockingFailures > 0) {
        return { post: true, state: 'failure', description: clip('Local gate FAILED (' + kind + '): ' + o.blockingFailures + ' blocking job(s); tree ' + tree) };
    }
    return { post: true, state: 'success', description: clip('Local gate passed (' + kind + '); branch contains main; tree ' + tree) };
}

// "owner/repo" from any remote URL git prints: https, ssh (git@github.com:o/r.git) or the cloud
// sandbox's local proxy form (http://x@127.0.0.1:1234/git/o/r). Null when it cannot find two segments.
function repoFromRemote(url) {
    var m = /([^\/:@\s]+)\/([^\/\s]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
    return m ? m[1] + '/' + m[2] : null;
}

// The argument list for `gh`, as an array so no shell ever sees the description.
function ghArgs(repo, sha, verdict) {
    return ['api', '-X', 'POST', 'repos/' + repo + '/statuses/' + sha,
        '-f', 'state=' + verdict.state,
        '-f', 'context=' + CONTEXT,
        '-f', 'description=' + verdict.description];
}

module.exports = { CONTEXT: CONTEXT, decide: decide, repoFromRemote: repoFromRemote, ghArgs: ghArgs };

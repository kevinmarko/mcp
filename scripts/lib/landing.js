'use strict';
/**
 * The pure half of scripts/land.js: how a landed merge commit is stamped, how that stamp is read
 * back, and how the gate's own output is turned into the counts the stamp records.
 *
 * WHY this is a separate file with no git and no fs in it: the stamp is a contract between the code
 * that writes it (land.js, at landing time) and the code that checks it (land.js --verify, months
 * later, plus the tests). A contract that both sides compute through one pair of functions cannot
 * drift, and pure functions can be tested with strings alone, no throwaway repositories needed.
 *
 * The stamp is the LAST block of the merge commit message, in git-trailer style (Key: value lines):
 *
 *   Land #123
 *
 *   Landed through scripts/land.js: this exact tree passed the gate before it was pushed.
 *
 *   Landed-Base: <40 hex>      first parent: main's tip when the merge was built
 *   Landed-Head: <40 hex>      second parent: the branch tip that was merged
 *   Landed-Tree: <40 hex>      the TREE hash of the merge: the thing that was tested
 *   Landed-Gate: <command>
 *   Landed-Gate-Result: PASS
 *   Landed-Gate-Jobs: 24 passed, 0 failed, 6 skipped
 *   Landed-Counts: SHARED_SYNC_CHECK=153/153; Live regression suite -- dist/index.html=434/434
 *   Landed-At: 2026-10-06T12:34:56Z
 *   Landed-Attempt: 1
 *
 * Only plain ES5-style string handling is used on purpose: nothing here may depend on the machine.
 */

// A full git object name. Lower-case only: git prints lower-case, so anything else is not a hash
// we produced and must not be trusted as one.
const SHA40 = /^[0-9a-f]{40}$/;

// One physical line: a commit subject, a gate command or a trailer value must never be able to start
// a new line, because a new line is how text gets to pose as a trailer (see parseStamp).
const oneLine = (s) => String(s === undefined || s === null ? '' : s).replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

// Counts are stored as "name=executed/total" joined by "; ", so a name may contain neither character.
const countName = (s) => oneLine(s).replace(/[;=]/g, ' ').replace(/\s+/g, ' ').trim();

const INTRO = 'Landed through scripts/land.js: this exact tree passed the gate before it was pushed.';

/**
 * Build the full commit message for a landed merge.
 * fields: { subject, base, head, tree, gate, gateResult, jobs: {passed,failed,skipped}|null,
 *           counts: [{name, executed, total}], at, attempt, trailers: [string] }
 * The extra trailers (Co-Authored-By and similar) come AFTER the Landed-* lines, so the stamp stays
 * the one block parseStamp looks at and the extra lines can never shadow it.
 */
function formatStamp(fields) {
  const f = fields || {};
  const lines = [];
  lines.push('Landed-Base: ' + oneLine(f.base));
  lines.push('Landed-Head: ' + oneLine(f.head));
  lines.push('Landed-Tree: ' + oneLine(f.tree));
  if (oneLine(f.gate)) lines.push('Landed-Gate: ' + oneLine(f.gate));
  lines.push('Landed-Gate-Result: ' + oneLine(f.gateResult));
  if (f.jobs) lines.push('Landed-Gate-Jobs: ' + f.jobs.passed + ' passed, ' + f.jobs.failed + ' failed, ' + f.jobs.skipped + ' skipped');
  const counts = (f.counts || []).filter((c) => c && countName(c.name));
  if (counts.length) lines.push('Landed-Counts: ' + counts.map((c) => countName(c.name) + '=' + c.executed + '/' + c.total).join('; '));
  if (oneLine(f.at)) lines.push('Landed-At: ' + oneLine(f.at));
  if (f.attempt !== undefined && f.attempt !== null) lines.push('Landed-Attempt: ' + oneLine(f.attempt));
  for (const t of (f.trailers || [])) { const line = oneLine(t); if (line) lines.push(line); }
  return (oneLine(f.subject) || 'Land') + '\n\n' + INTRO + '\n\n' + lines.join('\n') + '\n';
}

/**
 * Read the stamp back out of a commit message. Returns null unless Landed-Base, Landed-Head,
 * Landed-Tree (each a 40-hex hash) and Landed-Gate-Result are all present.
 *
 * Injection defence: the subject (and anything else a person typed) is only ever one line, and the
 * real stamp is the LAST paragraph that holds Landed-* lines, never the first, so a quoted
 * "Landed-Tree: ..." earlier in the message cannot win. The subject paragraph is never eligible, and
 * inside the chosen block the first occurrence of a key wins (extra trailers come after it).
 */
function parseStamp(message) {
  const paragraphs = String(message === undefined || message === null ? '' : message).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  let block = null;
  for (let i = paragraphs.length - 1; i >= 1 && block === null; i--) {
    if (/^Landed-Base:/m.test(paragraphs[i])) block = paragraphs[i];
  }
  if (block === null) return null;
  const kv = {};
  for (const line of block.split('\n')) {
    const m = /^Landed-([A-Za-z-]+):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (m && !Object.prototype.hasOwnProperty.call(kv, m[1])) kv[m[1]] = m[2];
  }
  if (!SHA40.test(kv.Base || '') || !SHA40.test(kv.Head || '') || !SHA40.test(kv.Tree || '') || !kv['Gate-Result']) return null;
  let jobs = null;
  const jm = /^(\d+) passed, (\d+) failed, (\d+) skipped$/.exec(kv['Gate-Jobs'] || '');
  if (jm) jobs = { passed: Number(jm[1]), failed: Number(jm[2]), skipped: Number(jm[3]) };
  const counts = [];
  if (kv.Counts) {
    for (const item of kv.Counts.split('; ')) {
      const cm = /^(.+)=(\d+)\/(\d+)$/.exec(item);
      if (cm) counts.push({ name: cm[1], executed: Number(cm[2]), total: Number(cm[3]) });
    }
  }
  const attempt = kv.Attempt !== undefined && /^\d+$/.test(kv.Attempt) ? Number(kv.Attempt) : null;
  return {
    base: kv.Base, head: kv.Head, tree: kv.Tree,
    gate: kv.Gate !== undefined ? kv.Gate : null,
    gateResult: kv['Gate-Result'],
    jobs, counts,
    at: kv.At !== undefined ? kv.At : null,
    attempt,
  };
}

/**
 * Turn the captured output of the gate (by default scripts/run_ci_locally.js) into the numbers the
 * stamp records. ONLY lines this repo's tools really print are recognised (seen in a real
 * `node scripts/run_ci_locally.js --fast` run and in tests/ci_regression_runner.js); anything else
 * is ignored, and a count is never guessed:
 *
 *   job table (after the "==== Summary ====" banner, last one wins):
 *     "<tick> <job>: PASS (12s)" / "<cross> <job>: FAIL (3s)" / "<skip> <job>: skipped (--fast)"
 *   headless checks (one line, name comes from the line itself):
 *     "SERVER_PREFS_LOGIC_PASSED (22 assertions)"            -> executed 22 of 22
 *     "SHARED_LOGIC_CHECK_PASSED (511 assertions in 5 modules)"
 *     "COMPARE_KPIS_PASSED (16 passed, 0 failed)"            -> executed 16 + 0 of 16 + 0
 *   checks whose line carries no name (the name is the job banner printed just before it):
 *     "<tick> PASS (13/13)"                                   -> executed 13 of 13
 *     "Executed checks: 434 (expect 434), per suite:"        -> executed 434 of 434 (the pinned count)
 *
 * Returns { passed, failed, skipped, counts }: the three job tallies (all 0 when the output has no
 * job table, e.g. a custom --gate) and counts [{ name, executed, total }].
 */
function parseGateSummary(outputText) {
  const lines = String(outputText === undefined || outputText === null ? '' : outputText).split(/\r?\n/);
  let passed = 0; let failed = 0; let skipped = 0;
  let inSummary = false;
  let job = null;
  const byName = new Map(); // a re-run of the same job (the retried 2.5 build) replaces the earlier line
  const addCount = (name, executed, total) => {
    const n = countName(name);
    if (!n) return;
    byName.set(n, { name: n, executed, total });
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const banner = /^={5,} (.+?) ={5,}$/.exec(line);
    if (banner) {
      if (banner[1] === 'Summary') { inSummary = true; passed = 0; failed = 0; skipped = 0; job = null; } else { inSummary = false; job = banner[1]; }
      continue;
    }
    if (inSummary) {
      const sm = /^[\u2705\u274C\u23ED]\uFE0F?\s+.+: (PASS|FAIL|skipped)\b/.exec(line);
      if (sm) { if (sm[1] === 'PASS') passed++; else if (sm[1] === 'FAIL') failed++; else skipped++; }
      continue;
    }
    let m = /^([A-Z][A-Z0-9_]*?)_(?:PASSED|FAILED) \((\d+) assertions?\b/.exec(line);
    if (m) { addCount(m[1], Number(m[2]), Number(m[2])); continue; }
    m = /^([A-Z][A-Z0-9_]*?)_(?:PASSED|FAILED) \((\d+) passed, (\d+) failed\)/.exec(line);
    if (m) { const n = Number(m[2]) + Number(m[3]); addCount(m[1], n, n); continue; }
    m = /^[\u2705\u274C]\uFE0F?\s+(?:PASS|FAIL) \((\d+)\/(\d+)\)/.exec(line);
    if (m && job) { addCount(job, Number(m[1]), Number(m[2])); continue; }
    m = /^Executed checks: (\d+) \(expect (\d+)\)/.exec(line);
    if (m && job) { addCount(job, Number(m[1]), Number(m[2])); continue; }
  }
  return { passed, failed, skipped, counts: Array.from(byName.values()) };
}

module.exports = { formatStamp, parseStamp, parseGateSummary };

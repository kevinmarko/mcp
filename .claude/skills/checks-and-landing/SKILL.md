---
name: checks-and-landing
description: Run the right checks after a change to the Booking Flash Report app, shared/ logic, Apps Script or tests, then get the change landed on main. Use whenever you are about to push, open a PR, land a PR, or say a change is done in this repo; also when a check fails and you must decide whether it is real or flaky.
---

# Checks and landing for Booking Flash Report NA

This skill is the short operational path. It points at the docs that own the detail and never replaces them:
`AGENTS.md` (rules), `docs/TESTING.md` (how to run every check), `docs/DECISIONS.md` (what Kevin decided),
`docs/CHECK_HISTORY.md` (why each rule exists). If this skill and those files disagree, the files win; fix the skill.

## 0. Before you start (once per session)

```bash
npm ci                              # first time, and after package.json changes
python3 -m pip install openpyxl     # the alias-landmine check needs it
```

In a cloud sandbox, Chromium is already installed and the CDNs are not reachable, so prefix every browser-backed run with:

```bash
BF_VENDOR_CDN=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium
```

Never run `playwright install`. Confirm `node_modules/` exists before blaming a check (a fresh checkout has none).

## 1. Decide which file your change goes in

| Change | Goes in | Also |
|---|---|---|
| App change of any kind (feature, bug fix, speed-up) | the one production app file | `dist/` is rebuilt from it (check 6), never edited by hand |
| `shared/` files | edit `shared/`, run `node scripts/sync_shared.js`, commit the regenerated outputs | never hand-edit the generated region or `apps-script/Shared.gs` |
| Tests, docs, `apps-script/`, scripts | the file itself | |

Only one agent writes the app file at a time. Since the 2.5 testing build was promoted to production on 2026-10-11 (per
Kevin) there is one app file again; the old "features go in the testing build, fixes go in production" split is retired.

**Never hardcode the app filename.** Get it with `node scripts/print_app_file.js`. The resolver deliberately skips any
name containing "testing" (today only the old `1.67_TESTING` build, kept for reference), so every "source" check targets production.

**Hazard:** never write a `/*` that is not the start of a real, closed block comment, anywhere in the app file or `shared/`
(including inside a `//` comment, e.g. the text "shared/*.js"). The comment-stripping regex in a headless check reads it as
a block-comment opener and silently breaks unrelated checks.

## 2. Pick the checks

The default is to run everything. Use the table only to choose the quick loop while iterating.

| Your change touched | Minimum |
|---|---|
| Anything in the app file | checks 1 (syntax), 4 (regression suite on source **and** `dist/`), 6 (rebuild `dist/`) |
| A `getVal([...])` call | + check 2: `python3 tests/check_alias_landmines.py Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` |
| An `XLSX.read(...)` call or CSV/xlsx parsing | + check 3: `node tests/check_date_timezone_safety.js` |
| Row highlighting, row-component props, big-table row rendering | + check 5: `node tests/perf_highlight_benchmark.js` (source and `dist/`) |
| `shared/`, generated region, `Shared.gs` | `node tests/check_shared_sync.js`, `check_shared_logic.js`, `check_history_days.js` |
| `scripts/land.js`, `scripts/lib/landing.js`, overlap tool | `node tests/check_land_script.js`, `node tests/check_pr_overlap.js` |

**Quick loop (about 1 minute, skips the five browser jobs):** `node scripts/run_ci_locally.js --fast`.

**Full gate (about 11 minutes on a laptop, about 25-30 in the cloud sandbox, so run it in the background there). There is no GitHub Actions (D59): this is the only gate.
Commit and push first (the receipt needs a pushed HEAD), with `main` merged in, then:**

```bash
BF_VENDOR_CDN=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/run_ci_locally.js --post-status > /tmp/gate.txt 2>&1; echo exit=$?
grep -E '^Passed|❌|FAIL|RECEIPT' /tmp/gate.txt | head -40
```

Write the output to a file and grep it. A regression run prints a line per check and reading all of it wastes context.
Report the gate result and the `RECEIPT` line. `RECEIPT POSTED` puts a green `local-gate` check on the pushed head; `RECEIPT NOT POSTED: <why>` says what to fix first
(uncommitted changes, branch behind `main`, `--fast` on code, `gh` not logged in, HEAD not pushed). A red job with real log output is a real failure to fix. Never say
"CI will run it" and never mention billing: GitHub Actions is not used (D59), so there are no hosted checks. A Markdown-only change needs only `--fast --post-status`.

A change that intentionally alters what a check asserts updates that check in the same commit. A failing check that
still makes sense means the app has a bug. Never silence, skip or disable a check to get green.

## 3. Read the result correctly

**Check the executed-check count, not the pass rate.** A suite that aborts at setup or skips by design records nothing,
so a run can be all green with whole suites missing. Compare the per-suite counts with the table in
`docs/TESTING.md` ("Current counts"). The runner also pins the total executed count (one pin, for the main file and `dist/`).
A count that surprises you gets re-derived from a different setup (another browser or machine, runner vs. hand-driven),
not re-run in the same one: two runs through the same broken harness agree with each other.

**Flaky or real?** Resolve every failure to one of these before calling the change done:

1. Re-run once. The **same check failing identically** twice is real. First rule out a harness race (two copies of the
   suite running at once reproduce identically too).
2. A **different check each time**, or a "Setup: ... found" miss that a single deliberate step (click the tab, wait about
   2 s, inspect) shows is present, is the known timing noise.
3. A check that **only sometimes** fails usually means a live data source is unpinned. Look for one before looking for a bug.

Never conclude "flaky, skip it". The source regression run is informational in CI and the `dist/` run blocks; locally
treat both as required.

## 4. Verify against real data before you report

Never report a bug, row count, performance number or field mapping you only reasoned about. Real inputs in the repo:
`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` (964 raw rows), the 9-day historical CSV (8,769 rows) and the reference
`.xlsm` (cached computed values, the best ground truth). Count CSV rows with an RFC 4180 parser, never `wc -l` (quoted
cells hold newlines: 27,312 lines but 8,769 rows). Report identifier, input, expected vs. actual, and root cause with a
line number; label anything you could not confirm as unconfirmed.

Production-only questions (`google.script.run`, Sheets sharing, triggers, per-user isolation) stay open until someone runs
them on `/exec`. Do not call a server feature working in production until its checklist in `apps-script/README.md` has run there.

## 5. Commit and open the PR

- Commit only when the change is ready to become a PR. No checkpoint commits. Related fixes may share a commit.
- Develop on the branch the session names, push with `git push -u origin <branch>`, then open a **draft** PR if none exists.
- Before **feature** work: read `docs/DECISIONS.md`, write the decision down first (`PROPOSED` unless Kevin confirmed it in
  writing, with the quote), and run `node scripts/check_pr_overlap.js`. If another open branch changes the same function, say so
  in the PR and ask Kevin whether to sequence the two. If your work conflicts with a `DECIDED` entry, stop and ask.
- Adding a check: add it to the `jobs` array in `scripts/run_ci_locally.js` (the single source of truth, D59) and the table in `docs/TESTING.md` in the
  same commit.

## 6. Landing (only when asked to land or merge)

**Default (D45 as amended by D59, 2026-10-14): merge on GitHub** when the green `local-gate` check is on the PR's current head (it is only posted for a branch that already contains
`main`; if `main` moved, merge it into the branch and run the gate with `--post-status` again). Use the script below for risky merges: `check_pr_overlap.js` flags the
branch, the PR combines two sessions' logic, or Kevin asks. Docs-only PRs may use `--docs-only-fast`. Ordinary
GitHub merges show as `UNSTAMPED` in `--verify`; that is expected.

To land through the script, never by hand-merging:

```bash
node scripts/land.js 123 --dry-run     # merge onto current main in a scratch worktree, run the gate, do not push
node scripts/land.js 123               # same, then push that exact tested tree if main has not moved
node scripts/land.js --verify --last 20
```

How it works: it merges the PR onto the current `main` in a throwaway worktree, runs `node scripts/run_ci_locally.js` on
that exact tree, and pushes with a plain push (never `--force`) only if `main` has not moved. If `main` moved it starts
over from the merge, re-testing. So `main` only receives a tree that was tested as merged. Each retry costs a full gate run.

| Exit | Meaning | What to do |
|---|---|---|
| 0 | landed, dry run passed, or already landed | done |
| 1 | usage/environment error, or a failed post-push check | read the `land:` stderr lines |
| 2 | merge conflict | merge `main` into the branch, resolve, push, run again. For generated files take neither side: resolve `shared/`, then re-run `node scripts/sync_shared.js` |
| 3 | gate failed, or the gate modified tracked files | fix like any red run; a gate that dirties tracked files means what was tested is not what would ship |
| 4 | push refused on every attempt (main kept moving) | try again when other landings settle |

Rules around landing:

- Land slices one at a time; do not stack a branch on an unmerged branch. One merger at a time.
- When one session lands, every other open branch merges `main` promptly and re-runs its checks before it is landed.
- `--fast` never pushes. `--docs-only-fast` (approved, D22) allows a fast gate only when every changed path is under `docs/`,
  ends in `.md`, or is the PR template; otherwise it does nothing.
- When a merge combines logic written by two different sessions, do a **fix-removed (red) run** on the merged tree: revert one
  side's fix, confirm the other side's new check fails, restore it. A merge where nothing goes red proves nothing about the interaction.
- `land.js` cannot stop a direct push to `main`; a direct push skips the guarantee. No rule forbids pushing to `main` directly; do not read one in.

## 7. Keep the session cheap

Start fresh when switching tasks. The app file is over 16,000 lines: grep for the symbol, then read a range, never the whole
file. Use subagents only to isolate a big search. This is about cost; never skip a required check to save tokens.

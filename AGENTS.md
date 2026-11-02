# Agent instructions: Booking Flash Report NA

Read this first. It is the short, operational entry point for any AI coding agent (or human) working
in this repo: which file to edit, which checks to run after a change, and the working rules. Everything
longer lives in the docs below.

| Doc | Read it for |
|---|---|
| [DOCS_INDEX.md](DOCS_INDEX.md) | Which doc to open for which task, doc status (active / archived), and how to search the big files |
| [docs/TESTING.md](docs/TESTING.md) | How to run every check, fixture pinning, current check counts, flaky-vs-real triage, the highlight benchmark, the deployable build, landing with `scripts/land.js` and the branch-overlap check |
| [docs/DECISIONS.md](docs/DECISIONS.md) | The decision log (what Kevin decided, what is only proposed, what is open) and the table of who is working on what. Read before feature work |
| [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md) | Why each check and rule exists: the bugs, incidents and dated counts that used to fill this file |
| [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) | Every `getVal()` field and its real source column, per-tab validation status, and the [full data-linkage validation workflow](DATA_ARCHITECTURE.md#full-data-linkage-validation-workflow). Read before adding a field or chasing "this number looks wrong" |
| [HANDOFF.md](HANDOFF.md) | Project history, architecture and the known bug classes. Read before touching numeric/color logic or the pivot engine |
| [CODE_NOTES.md](CODE_NOTES.md) | The long "why is this code written this way" notes behind short pointer comments in the app |
| [apps-script/README.md](apps-script/README.md) | Deploying, the Apps Script features and their setup, server-backed preferences and the production checklists |
| [README.md](README.md) | Running the app locally, tech stack, repo layout |

## No GitHub Actions: the local gate is the only gate (per Kevin, 2026-10-14, D59)

Kevin, 2026-10-14: "new rule no more Github actions let's build around it", and on paying for it: "I'm not paying money for it" (D59 in
[docs/DECISIONS.md](docs/DECISIONS.md), which supersedes D45 items 1 and 4, D53 and the workflow half of D51). `.github/workflows/ci.yml` is gone. There are no hosted
runs, so there are no hosted checks to read, fix, re-run or ignore.

- **The gate is `node scripts/run_ci_locally.js`, in full, on the tree that will land:** your branch with `main` merged in, committed and pushed.
  Its `jobs` array is the single source of truth for what is checked; there is no second copy to keep in step.
- **Finish with `node scripts/run_ci_locally.js --post-status`.** On a full pass, with a clean tree and a HEAD that contains `origin/main`, it posts the free
  commit status `local-gate` = success on the pushed head: the green check on the PR. A failing run posts `failure`. If it cannot honestly say success
  (uncommitted changes, behind `main`, `--fast` on code) it posts nothing and prints why; fix that, do not work around it. A Markdown-only change needs only
  `--fast --post-status`. A pushed commit with no `local-gate` status has not been gated.
- **Never add a workflow, a hosted runner or any paid service** to run checks, and never write "CI will run it" in a PR or a commit. If a check matters, it is in
  the `jobs` array. Do not mention billing to Kevin; it is not a topic any more.
- **Rolling back** (only if Kevin says Actions is back): the last workflow is `git show fa865ff:.github/workflows/ci.yml`.
- **Conflicts and a moving `main` (Kevin, 2026-11-02):** before a merge, `git fetch origin main`. If the PR conflicts or `main` moved, merge `origin/main` into the
  branch (never rebase, never force-push), resolve keeping the intent of both sides, commit and push. On generated files take neither side: resolve `shared/`,
  then `node scripts/sync_shared.js`. The merge is a NEW head, so a `local-gate` status on the old head says nothing about it: run
  `node scripts/run_ci_locally.js --post-status` again (a Markdown-only merge needs only `--fast`, as above) and merge only when `local-gate` = success on the exact head being merged.

## The app file

The app is one file, React 18 + Babel Standalone with no build step, whose name carries its
version: currently `Booking_flash_report_na_2.5_WORKING_PRO_ONLY.html`. Check README's
"Current version" note before trusting a filename stated anywhere, and **never hardcode the filename
in this repo's docs or scripts**; derive it the way check 1 does. `dist/index.html` is generated from
it (check 6); never edit `dist/` by hand.

Only one agent at a time should write the app file; parallel work should split by artifact
(tests, docs, `apps-script/`) or verify rather than edit.

### The 2.5 build was promoted (2026-10-11, per Kevin)

Kevin, 2026-10-11: "Lets promote 2.5 testing to production". The 2.5 testing build was `git mv`'d to
`Booking_flash_report_na_2.5_WORKING_PRO_ONLY.html`, which replaced 2.0 as the one production app file (2.0 was
deleted; git history keeps it for rollback). There is one app file again: **features and fixes both go in it**, as
before 2026-10-05, and the temporary rule "features go in the testing build, fixes go in production" (PR #172) is
retired. `Booking_flash_report_na_1.67_TESTING.html` is an old testing build kept for reference; the resolver still
excludes it by name. A future testing build would need its own named jobs in `scripts/run_ci_locally.js` and a runner target again; the git history
of the promotion PR shows how the 2.5 build was wired and unwired.

### Shared logic (`shared/`)

Pure logic that the app and Apps Script both need is written once in `shared/*.js` and generated into two
places: a region of the app file between the `>>> BEGIN GENERATED SHARED LOGIC` and
`<<< END GENERATED SHARED LOGIC` comment lines, and `apps-script/Shared.gs` (decision D1, 2026-10-05, option a). The same region is also
kept current in any other app build in the repo root that carries those marker lines (today there is none besides the main
file); a build without them is ignored. The dev flow is in [docs/TESTING.md](docs/TESTING.md).

- **Edit `shared/`, run `node scripts/sync_shared.js`, commit the regenerated outputs with it.** Never
  hand-edit the generated region or `Shared.gs`. `node scripts/sync_shared.js --check` (run by
  `tests/check_shared_sync.js` and the gate) fails if any output is stale, any other marked build included. `shared/` code is plain ES5,
  dependency-free, with no DOM and no `window`.
- **The generated copies carry no comments.** The sync strips them with `@babel/core` (the sync needs `npm ci`);
  `shared/` stays the readable source, so read and edit comments there, never in the region or `Shared.gs`.
- **That region is the only app-file edit allowed outside the single writer.** It still changes the app
  file, so checks 1, 4 and 6 apply to it.
- **Shared-logic PRs merge one at a time.** On a conflict in generated files take neither side: resolve
  `shared/`, then re-run the sync.
- **Hazard: never write a `/*` outside a real, closed block comment**, anywhere in the app file or
  `shared/`. `tests/check_team_features_logic.js` strips comments from the app source with
  `/\/\*[\s\S]*?\*\//g`, so a `/*` inside a `//` comment (for example the text "shared/*.js") reads as the
  start of a block comment and silently breaks unrelated checks. Enforced for `shared/` by the sync (it refuses
  such text) and for the app file by an assertion in `tests/check_shared_sync.js` (every slash-star in the app
  script starts a real block comment). Evidence:
  [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md#2026-10-05-slash-star-inside-a-line-comment-breaks-the-comment-stripper).

## Required: run the checks after every change

This repo has no test framework by design. The checks are standalone scripts, and a change that looks
right in the diff has shipped broken more than once. Numbers 1-6 are the historical check numbers that
comments across the repo refer to.

| # | Check | Required when | Command |
|---|---|---|---|
| 1 | Syntax check | any app change | snippet below |
| 2 | Alias-landmine check | a `getVal([...])` call changed | `python3 tests/check_alias_landmines.py Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` |
| 3 | Date timezone-safety, fast CSV reader | an `XLSX.read(...)` call or CSV/xlsx parsing changed | `node tests/check_date_timezone_safety.js`; `node tests/check_csv_fast_path.js` |
| 4 | Live regression suite | any app change | `node tests/ci_regression_runner.js` and again with `BF_APP_HTML=dist/index.html` |
| 5 | Row-highlight budget | row highlighting, row-component props, or how the big tables render rows | `node tests/perf_highlight_benchmark.js` (source and `dist/`) |
| -- | Column-reorder remount + budget | `reorderColumnCells`, the column-order state or drag hook, or the keys/shape of the table cells | `node tests/perf_column_reorder_benchmark.js` (source and `dist/`) |
| 6 | Rebuild the deploy artifact | any app change | `node scripts/build_deployable.js` (the gate runs `--check`) |
| -- | Headless logic checks | their area changed (list in [docs/TESTING.md](docs/TESTING.md#headless-checks)) | e.g. `node tests/check_team_features_logic.js` |
| -- | Shared-logic sync and behaviour, historical-days helper | `shared/`, `tests/shared_logic/`, the generated region or `apps-script/Shared.gs`; `tests/lib/history_days.js` or the 9-day historical CSV | `node tests/check_shared_sync.js`; `node tests/check_shared_logic.js`; `node tests/check_history_days.js` |
| -- | Landing script, branch-overlap tool | `scripts/land.js`, `scripts/lib/landing.js`, `scripts/check_pr_overlap.js` or `scripts/lib/pr_overlap.js` | `node tests/check_land_script.js`; `node tests/check_pr_overlap.js` |

**Simplest correct path: run `node scripts/run_ci_locally.js` before every push, and `--post-status` once the branch is pushed.** It runs all of
the above. `--fast` skips every browser job (under a minute) for a quick loop. The default gate skips the duplicate "source" jobs (the source regression run and the
source halves of the two timing budgets; D81, Kevin, 2026-10-30); `--with-source` adds them back, for example to triage a `dist/`-only failure.

Check 1, the syntax check, run from the repo root. Confirm the printed
"(auto-detected current app version: ...)" line names the file you edited:

```bash
python3 - <<'EOF'
import re, os, subprocess
# The "which file is the current app" rule lives ONLY in scripts/lib/app_file.js
# (pickCurrentAppHtml); this calls it through scripts/print_app_file.js instead of copying it.
# Two non-testing files tied for the highest version is an error (it exits 1), never a guess,
# and a check in tests/check_resolve_app_html.js fails if a new hand-copied version appears.
r = subprocess.run(['node', 'scripts/print_app_file.js'], capture_output=True, text=True)
if r.stderr: print(r.stderr.strip())
assert r.returncode == 0, "print_app_file.js failed (see message above)"
html_path = r.stdout.strip()
print(f"(auto-detected current app version: {html_path})")
content = open(html_path).read()
open('/tmp/extracted.jsx', 'w').write(re.search(r'<script type="text/babel">(.*?)</script>', content, re.DOTALL).group(1))
EOF
node -e "
const babel = require('@babel/core');
const fs = require('fs');
const result = babel.transformFileSync('/tmp/extracted.jsx', { presets: ['@babel/preset-react'] });
fs.writeFileSync('/tmp/out.js', result.code);
" && node --check /tmp/out.js
```

It only proves the JSX parses; it does not catch a runtime `ReferenceError` or a wrong number.

**A change is not done until the regression suite runs clean against it**, on the source and on
`dist/index.html`. If a change intentionally alters what a check asserts, update the test in the same
commit. A failing check that still makes sense means the app has a bug; one that no longer matches the
intended behavior is stale and gets updated, never silenced.

**Adding a check:** add it to the `jobs` array in `scripts/run_ci_locally.js` in the same
commit, and to the table in [docs/TESTING.md](docs/TESTING.md). A required check that runs only when
someone remembers is not a required check.

### Known flakiness: don't let it excuse skipping the suite

A long unattended run occasionally fails a "Setup: ... found" check after a quick tab switch or modal
open, which is why the gate's source run is informational and the `dist/` run blocks. Re-run once: the
**same check failing identically** is real (after ruling out a harness-side race); a **different
check each time** is timing noise, confirmed with a single deliberate step. A check that only
*sometimes* fails usually means an unpinned live data source. Resolve every failure to one of these
before calling a change done. Full procedure: [docs/TESTING.md](docs/TESTING.md#flaky-or-real).

## Landing changes (merge safety)

Two PRs that each pass the gate alone can still be wrong together. #185 and #186 were: the repairs were found by reading the merged
code and by a red run, not by the gates each had passed ([docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md#2026-10-06-semantic-merge-conflicts-185-vs-186-and-the-merge-safety-systems)).
Kevin asked for the tools and these rules ("yes build 1-4 as one PR in order", 2026-10-06; [docs/DECISIONS.md](docs/DECISIONS.md), D20 and D23).
On 2026-10-11 Kevin changed *how* they are applied: "land.js.. is very slow... do we need do it since we can use github again", then
"lets do 1 and 2" (D45, which supersedes D21). On 2026-10-14 GitHub Actions went away for good (D59), so the "green CI" half of that
became "green `local-gate`". Nothing here is a lock; the rules are agreed practice.

- **Default: merge on GitHub, when `local-gate` is green on the PR's current head.** That status is only ever posted by
  `node scripts/run_ci_locally.js --post-status` after a full pass on a clean tree whose HEAD already contains `origin/main`, so "gated" and "up to date with
  `main`" are one condition, checked in one place. If `main` moves after that, merge it into the branch and run the gate and `--post-status` again: the old tick
  is on the old head. The point is the same as `land.js`'s: `main` should only receive a tree that was tested as merged.
  **Read the PR's check list yourself before merging**; a missing `local-gate` means no one has gated that head. `main`'s branch rule has no required checks and
  `enforce_admins` on (read back 2026-10-14); making `local-gate` a required check is a free setting and Kevin's call (D59, "Open"), so until then GitHub will not stop a merge for you.
- **Use `node scripts/land.js <PR>` for the risky merges:** `node scripts/check_pr_overlap.js` flags the branch, or the PR combines logic
  written by two sessions (the #185/#186 case); or Kevin asks. It merges the PR onto the current `main` in a
  scratch worktree, runs `node scripts/run_ci_locally.js` on that exact tree (about 6 minutes since D80; each retry costs another), and pushes
  only if `main` has not moved. It **cannot stop a direct push to `main`**. Usage, flags, exit codes and a worked example:
  [docs/TESTING.md](docs/TESTING.md#landing-changes-with-scriptslandjs).
- **Docs-only PRs** may use `node scripts/run_ci_locally.js --fast --post-status` (about a minute; the receipt is allowed for a Markdown-only change, D59), or land
  with `node scripts/land.js <PR> --docs-only-fast` (D22).
- **`--verify` will list ordinary GitHub merges as `UNSTAMPED`.** That is expected (D45), not evidence of a bypass.
- **Before opening a PR for feature work,** read [docs/DECISIONS.md](docs/DECISIONS.md) and run
  `node scripts/check_pr_overlap.js`. If another open branch changes the same function, say so in the PR and ask Kevin whether to
  sequence the two. The tool matches function names, not meaning, and sees only branches that are already pushed.
- **Write the decision down before you build it.** A product decision gets a DECISIONS entry first (`PROPOSED` unless Kevin confirmed
  it in writing, with the quote); claim the area in its claims table. If your work conflicts with a `DECIDED` entry, stop and ask
  Kevin. A claim is only visible to others once it is on `main`.
- **Land slices one at a time; do not stack a branch on an unmerged branch.**
- **When one session lands, every other open branch merges `main` promptly,** and re-runs its checks, before it is landed.
- **One merger at a time.** (`land.js` retries from the new `main` if two land at once, but a human merging past it does not.)
- **When a merge combines logic written by two different sessions, do a fix-removed (red) run on the merged tree:** revert one side's
  fix, confirm the other side's new check fails, restore it. A merge where nothing goes red proves nothing about the interaction.
- **What is not new:** no rule in this file forbids pushing to `main` directly; do not read one into this section.

## Working practices

These rules were each learned the hard way; the stories are in
[docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md).

**Verify against real data before reporting.** Never report a bug, a row count, a performance number
or a field mapping you have only reasoned about. The repo ships three real files:
`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` (964 raw rows), the 9-day
`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` (8,769 rows) and the reference workbook
`Booking_Flash_Report_REFERENCE_08-12-2026.xlsm` (cached computed values: the best ground truth).
**Count CSV rows with an RFC 4180 parser, never `wc -l`**: quoted cells hold newlines, and that CSV has
27,312 lines but 8,769 rows. Report concrete evidence (identifier, input, expected vs. actual, root
cause with a line number), and label anything you could not confirm as unconfirmed.

**Check the executed-check count, not the pass rate.** A suite that aborts at setup or skips by design
records nothing, so a run can be all green with whole suites missing. Compare per-suite counts with
[docs/TESTING.md](docs/TESTING.md#current-counts-2026-10-14-726-checks); a count that surprises you
gets re-derived from a different setup, not re-run in the same one.

**Commit only when the change is ready to become a PR** (per Kevin, 2026-09-24). No checkpoint
commits: do the edit, run the checks, then commit and push. Related fixes may share a commit.

**Serve your own checkout.** In a worktree, confirm the local server is serving your files before
trusting any live measurement ([docs/TESTING.md](docs/TESTING.md#serving-the-app-confirm-youre-serving-your-checkout)).

**Production-only questions stay open until someone runs them on `/exec`.** `google.script.run`,
Sheets sharing, triggers and per-user isolation cannot be tested on a laptop. Local runs test the
client against fakes. Don't describe a server feature as working in production until its checklist in
[apps-script/README.md](apps-script/README.md) has been run there. The testing deployment's `/exec` URL and its Team Data and
Config Sheets are listed in [apps-script/README.md](apps-script/README.md#the-testing-deployment-addresses-per-kevin-2026-10-06).

## Keeping agent sessions cheap (per Kevin, 2026-10-07)

An agent session re-reads its whole context on every turn, so cost grows with context size times
number of turns. These are cost rules, not correctness rules; never skip a required check to save tokens.

- **Start fresh when switching tasks** (`/clear` in Claude Code). Summarize a long session before
  continuing it (`/compact`).
- **Read only the lines you need.** Everything read stays in the history. The app file is over 16,000
  lines: grep for the symbol, then read a range around it, never the whole file. The same goes for
  output: a regression run prints a line for every check, so write it to a file and grep it for
  `^Passed`, the `❌` lines and the check you are working on instead of printing it all.
- **Be deliberate with subagents.** They are good for isolating a big search, but each one is a separate
  context that has to load the repo on its own.
- **Use a cheaper model for routine work** (searches, mechanical edits, running and reading checks) and
  keep the most capable model for hard reasoning.

## Where the rest of this file went (2026-09-29)

This file was about 1,200 lines. It was split so every session reads only what it needs; no rule was
dropped. Many code comments still say "see AGENTS.md check N" or name a section below. This table
shows where each one lives now:

| Old section | Now |
|---|---|
| Required checks 1-6: full text, dated counts and incidents | [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md) (same headings and numbers); current how-to in [docs/TESTING.md](docs/TESTING.md) |
| Running the gate (was "Running CI locally") | [docs/TESTING.md](docs/TESTING.md#one-command-scriptsrun_ci_locallyjs) |
| Known flakiness (full text) | [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md#known-flakiness--dont-let-this-excuse-skipping-the-suite); summary above |
| Verify against real data / Commit only when ready / Check the executed-check count (full text) | [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md#working-practices-verifying-reporting-and-committing); summaries above |
| Open question for production: do saved settings persist? | [apps-script/README.md](apps-script/README.md#open-question-for-production-do-saved-settings-actually-persist) |
| Server-backed preferences, and the deployed-URL checklist | [apps-script/README.md](apps-script/README.md#server-backed-preferences-2026-09-16-what-was-built-and-why-it-took-this-shape) |
| Serving the app: confirm you're serving YOUR checkout | [docs/TESTING.md](docs/TESTING.md#serving-the-app-confirm-youre-serving-your-checkout) |
| Full data-linkage validation workflow | [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md#full-data-linkage-validation-workflow) |

Git workflow, the DAX reference and the full bug-class catalog are in HANDOFF.md, as before.

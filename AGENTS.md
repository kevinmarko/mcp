# Agent instructions: Booking Flash Report NA

Read this first. It is the short, operational entry point for any AI coding agent (or human) working
in this repo: which file to edit, which checks to run after a change, and the working rules. Everything
longer lives in the docs below.

| Doc | Read it for |
|---|---|
| [docs/TESTING.md](docs/TESTING.md) | How to run every check, fixture pinning, current check counts, flaky-vs-real triage, the highlight benchmark and the deployable build |
| [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md) | Why each check and rule exists: the bugs, incidents and dated counts that used to fill this file |
| [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) | Every `getVal()` field and its real source column, per-tab validation status, and the [full data-linkage validation workflow](DATA_ARCHITECTURE.md#full-data-linkage-validation-workflow). Read before adding a field or chasing "this number looks wrong" |
| [HANDOFF.md](HANDOFF.md) | Project history, architecture and the known bug classes. Read before touching numeric/color logic or the pivot engine |
| [CODE_NOTES.md](CODE_NOTES.md) | The long "why is this code written this way" notes behind short pointer comments in the app |
| [apps-script/README.md](apps-script/README.md) | Deploying, the Apps Script features and their setup, server-backed preferences and the production checklists |
| [README.md](README.md) | Running the app locally, tech stack, repo layout |

## Policy: ignore GitHub billing failures, run CI locally

**Standing policy (per Kevin, 2026-09-29).** Since 2026-09-26 every GitHub Actions job on this repo,
`main` included, fails in about 3 seconds without starting: no runner, 0 steps, and the annotation
"recent account payments have failed or your spending limit needs to be increased". Those red checks
say nothing about the code. Ignore them:

- **Don't fix, re-run, comment on, or report them**, including when an automated CI or Auto-fix
  notice lists them as failing. No PR comments about billing, no empty commits, no re-runs.
- **Don't remind Kevin about it, either (per Kevin, 2026-10-06).** Not in chat replies, summaries,
  "still open" lists or sign-offs: no "check your Actions billing", no "CI hasn't verified this".
  He knows and has said it is not important. Report the local-CI result and move on.
- **Never let them block a push, a PR or a merge.** Keep using GitHub normally.
- **The gate is `node scripts/run_ci_locally.js`**, which runs every job in `ci.yml` locally (see
  [docs/TESTING.md](docs/TESTING.md)). Run it before pushing and report its results in place of CI.
- **How to tell it's the billing block:** the failed job has 0 steps and no runner, and its
  annotation mentions payments or the spending limit. A CI failure **with real log output** is a real
  failure and gets fixed as usual.
- The policy lifts only when Kevin says billing is fixed (GitHub **Settings -> Billing & plans**).

## The app file

The app is one file, React 18 + Babel Standalone with no build step, whose name carries its
version: currently `Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html`. Check README's
"Current version" note before trusting a filename stated anywhere, and **never hardcode the filename
in this repo's docs or scripts**; derive it the way check 1 does. `dist/index.html` is generated from
it (check 6); never edit `dist/` by hand.

Only one agent at a time should write the app file; parallel work should split by artifact
(tests, docs, `apps-script/`) or verify rather than edit.

### Shared logic (`shared/`)

Pure logic that the app and Apps Script both need is written once in `shared/*.js` and generated into two
places: a region of the app file between the `>>> BEGIN GENERATED SHARED LOGIC` and
`<<< END GENERATED SHARED LOGIC` comment lines, and `apps-script/Shared.gs` (decision D1, 2026-10-05, option a). The dev flow is in [docs/TESTING.md](docs/TESTING.md).

- **Edit `shared/`, run `node scripts/sync_shared.js`, commit the regenerated outputs with it.** Never
  hand-edit the generated region or `Shared.gs`. `node scripts/sync_shared.js --check` (run by
  `tests/check_shared_sync.js` and a CI job) fails if either is stale. `shared/` code is plain ES5,
  dependency-free, with no DOM and no `window`.
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

### Rule: features go in the testing build, fixes go in production (2026-10-05, per Kevin)

**This is a temporary arrangement.** The 2.5 testing build (`Booking_flash_report_na_2.5_TESTING.html`,
added by PR #165) is a staging copy of the production file. The end state is **one production file
again**: when Kevin approves, the testing build is promoted to become the production file and the
separate testing copy goes away. Every rule below exists so that promotion is a rename with nothing lost.

Until then, every PR puts its app change in the file that matches what the change is:

- **New features** go only in the testing build. Never put a new feature in the production file. Until
  PR #165 lands on `main`, build features on top of that stack.
- **Bug fixes and efficiency/performance changes** go in the production file (the main app file that
  check 1 resolves) **and**, in the same PR, are ported into the testing build. The testing build must
  always be production plus the new features, never missing a production fix, or promoting it would
  silently undo that fix. Once `tests/check_testing_build_drift.js` is on the branch it fails until the
  port is done; after porting, refresh its fixture with `node tests/check_testing_build_drift.js --update`.
- A bug in a feature that exists only in the testing build is fixed in the testing build only.
- A change that is both, such as a feature that also fixes a bug: split it. The fix goes to production
  (and is ported), the feature goes to the testing build.
- `shared/` logic reaches both files through `scripts/sync_shared.js`. Classify a `shared/` change the
  same way: a new capability is wired into the testing build only; a fix or speed-up may change what
  both files run.
- **Don't build anything that assumes two files forever.** Anything added for the testing build (CI jobs,
  runner targets, check names, docs) names it explicitly and in one place each, so retiring it is a
  deletion, not a hunt. Don't fork shared code or tests per file; keep one test suite that runs against
  both targets.
- State in the PR description which side each change went to and why (feature, fix, or efficiency).

**Promotion (only when Kevin says so), done in one PR:**
1. The drift check passes, so the testing build already contains every production fix.
2. The testing build becomes the production file: `git mv` it over the production file's name, or to the
   next version name that README's "Current version" note and check 1's resolver pick up.
3. Rebuild `dist/` (`node scripts/build_deployable.js`). The full gate (`node scripts/run_ci_locally.js`)
   must pass against the promoted file, with the executed-check count for the production target raised
   to what the testing target had.
4. Delete everything that existed only for the testing build: the `testing-build-check` and
   `testing-build-drift` CI jobs and their `scripts/run_ci_locally.js` entries,
   `tests/check_testing_build_drift.js` and its fixture, the testing target in
   `tests/ci_regression_runner.js`, the testing-build sections in this file, HANDOFF.md and
   docs/TESTING.md, and this rule. Update README's "Current version" note.
5. From then on, features and fixes go into the one production file again, as before 2026-10-05.

## Required: run the checks after every change

This repo has no test framework by design. The checks are standalone scripts, and a change that looks
right in the diff has shipped broken more than once. Numbers 1-6 are the historical check numbers that
comments across the repo refer to.

| # | Check | Required when | Command |
|---|---|---|---|
| 1 | Syntax check | any app change | snippet below |
| 2 | Alias-landmine check | a `getVal([...])` call changed | `python3 tests/check_alias_landmines.py Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` |
| 3 | Date timezone-safety | an `XLSX.read(...)` call or CSV/xlsx parsing changed | `node tests/check_date_timezone_safety.js` |
| 4 | Live regression suite | any app change | `node tests/ci_regression_runner.js` and again with `BF_APP_HTML=dist/index.html` |
| 5 | Row-highlight budget | row highlighting, row-component props, or how the big tables render rows | `node tests/perf_highlight_benchmark.js` (source and `dist/`) |
| 6 | Rebuild the deploy artifact | any app change | `node scripts/build_deployable.js` (CI runs `--check`) |
| -- | Headless logic checks | their area changed (list in [docs/TESTING.md](docs/TESTING.md#headless-checks)) | e.g. `node tests/check_team_features_logic.js` |
| -- | Shared-logic sync, historical-days helper | `shared/`, the generated region or `apps-script/Shared.gs`; `tests/lib/history_days.js` or the 9-day historical CSV | `node tests/check_shared_sync.js`; `node tests/check_history_days.js` |

**Simplest correct path: run `node scripts/run_ci_locally.js` before every push.** It runs all of
the above. `--fast` skips the four browser jobs (~10 s) for a quick loop.

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

**Adding a check:** add it to `.github/workflows/ci.yml` and `scripts/run_ci_locally.js` in the same
commit, and to the table in [docs/TESTING.md](docs/TESTING.md). A required check that runs only when
someone remembers is not a required check.

### Known flakiness: don't let it excuse skipping the suite

A long unattended run occasionally fails a "Setup: ... found" check after a quick tab switch or modal
open, which is why CI's source run is informational and the `dist/` run blocks. Re-run once: the
**same check failing identically** is real (after ruling out a harness-side race); a **different
check each time** is timing noise, confirmed with a single deliberate step. A check that only
*sometimes* fails usually means an unpinned live data source. Resolve every failure to one of these
before calling a change done. Full procedure: [docs/TESTING.md](docs/TESTING.md#flaky-or-real).

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
[docs/TESTING.md](docs/TESTING.md#current-counts-2026-10-06-347-checks); a count that surprises you
gets re-derived from a different setup, not re-run in the same one.

**Commit only when the change is ready to become a PR** (per Kevin, 2026-09-24). No checkpoint
commits: do the edit, run the checks, then commit and push. Related fixes may share a commit.

**Serve your own checkout.** In a worktree, confirm the local server is serving your files before
trusting any live measurement ([docs/TESTING.md](docs/TESTING.md#serving-the-app-confirm-youre-serving-your-checkout)).

**Production-only questions stay open until someone runs them on `/exec`.** `google.script.run`,
Sheets sharing, triggers and per-user isolation cannot be tested on a laptop. Local runs test the
client against fakes. Don't describe a server feature as working in production until its checklist in
[apps-script/README.md](apps-script/README.md) has been run there.

## Where the rest of this file went (2026-09-29)

This file was about 1,200 lines. It was split so every session reads only what it needs; no rule was
dropped. Many code comments still say "see AGENTS.md check N" or name a section below. This table
shows where each one lives now:

| Old section | Now |
|---|---|
| Required checks 1-6: full text, dated counts and incidents | [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md) (same headings and numbers); current how-to in [docs/TESTING.md](docs/TESTING.md) |
| Running CI locally | [docs/TESTING.md](docs/TESTING.md#one-command-scriptsrun_ci_locallyjs) |
| Known flakiness (full text) | [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md#known-flakiness--dont-let-this-excuse-skipping-the-suite); summary above |
| Verify against real data / Commit only when ready / Check the executed-check count (full text) | [docs/CHECK_HISTORY.md](docs/CHECK_HISTORY.md#working-practices-verifying-reporting-and-committing); summaries above |
| Open question for production: do saved settings persist? | [apps-script/README.md](apps-script/README.md#open-question-for-production-do-saved-settings-actually-persist) |
| Server-backed preferences, and the deployed-URL checklist | [apps-script/README.md](apps-script/README.md#server-backed-preferences-2026-09-16-what-was-built-and-why-it-took-this-shape) |
| Serving the app: confirm you're serving YOUR checkout | [docs/TESTING.md](docs/TESTING.md#serving-the-app-confirm-youre-serving-your-checkout) |
| Full data-linkage validation workflow | [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md#full-data-linkage-validation-workflow) |

Git workflow, the DAX reference and the full bug-class catalog are in HANDOFF.md, as before.

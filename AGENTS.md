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

**Simplest correct path: run `node scripts/run_ci_locally.js` before every push.** It runs all of
the above. `--fast` skips the four browser jobs (~10 s) for a quick loop.

Check 1, the syntax check, run from the repo root. Confirm the printed
"(auto-detected current app version: ...)" line names the file you edited:

```bash
python3 - <<'EOF'
import re, os
# Same detection algorithm as tests/check_alias_landmines.py's own auto-detect (see that
# script's header comment for the two-naming-era history this must match). Kept in sync by
# hand since this is a doc snippet, not an importable module. SEVEN copies of this rule now
# exist -- if you change one, change all of them: this snippet, check_alias_landmines.py,
# check_date_timezone_safety.js, check_field_filter_gating.py, ci_regression_runner.js,
# check_server_prefs_logic.js, and perf_benchmark.js. They drifted apart once already:
# only the last two excluded testing builds, so the other four silently validated
# 1.67_TESTING instead of the main file (fixed 2026-09-16).
#
# tests/perf_toggle_benchmark.js is deliberately NOT an eighth copy: it `require()`s
# perf_benchmark.js's implementation (which is why that file has a `require.main === module`
# guard and a module.exports block at the bottom). Two JS harnesses in the same directory can
# share one module even though a Python script and a doc snippet cannot -- so when a JS
# harness is added, import the rule, do not paste it.
repo_root = os.getcwd()
all_files = [f for f in os.listdir(repo_root) if re.match(r'[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$', f)]
# Testing builds are excluded BEFORE the version comparison. Without this the snippet
# picked 1.67_TESTING and syntax-checked the testing build instead of the deployed app --
# the same class of green-but-meaningless result described in the paragraph above, and it
# was live in this file until 2026-09-16. Excluded names are printed, never dropped silently.
excluded = [f for f in all_files if re.search(r'testing', f, re.I)]
if excluded: print(f"(excluded as testing builds: {', '.join(sorted(excluded))})")
candidates = [f for f in all_files if not re.search(r'testing', f, re.I)]
assert candidates, f"No main Booking_flash_report_na*.html file found in {repo_root}"
version_key = lambda fname: tuple(int(p) for p in re.search(r'na_(?:Kevin_)?([\d.]+)_', fname).group(1).split('.'))
html_path = max(candidates, key=version_key)
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
[docs/TESTING.md](docs/TESTING.md#current-counts-2026-10-05-341-checks); a count that surprises you
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

---
name: librarian
description: Weekly documentation upkeep for the Booking Flash Report repo. Keeps DOCS_INDEX.md and docs/archive current, flags stale docs and broken links. Markdown only; works on a branch and opens a PR; never edits the big cited docs, the app file, scripts or tests.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Librarian pass (Booking Flash Report NA)

You are the repo's librarian. The goal: a new agent finds the right doc in one hop (`DOCS_INDEX.md`), nothing stale is presented as current, finished plans are archived. Read `AGENTS.md` (landing rules) and `DOCS_INDEX.md` sections 4 and 7 first.

## Hard limits
- **Markdown only.** Never edit the app HTML, `dist/`, `shared/`, `apps-script/*.gs`, `scripts/`, `tests/`, `package*.json`, or anything under `.github/workflows/` (there are none, by rule D59: never add a workflow, hosted runner or paid service).
- **Do not edit the bodies of the big cited docs**: `HANDOFF.md`, `CODE_NOTES.md`, `DATA_ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/CHECK_HISTORY.md`, `docs/TESTING.md`, `README.md`, `AGENTS.md`, `apps-script/README.md`. About 90 places cite them by file name and heading text. If one is wrong, list it in the PR under "Needs a human". The one allowed edit in `AGENTS.md` is a row in its top doc table pointing at `DOCS_INDEX.md`.
- **Never rename or reword a heading** in any doc that `git grep -n "<heading text>"` finds in code or other docs.
- **Never hardcode the app's file name** in new text; point at the README "Current version" note.
- **Branch + PR only**: `docs/librarian-<YYYY-MM-DD>` from `origin/main`; never commit to, push to or merge into `main`. No new decision entries in `docs/DECISIONS.md` (Kevin decides; a recommendation is `PROPOSED` and belongs in the PR body).
- Never include secrets, tokens, sheet ids that are not already in a doc, or ONE data.

## Steps
1. `git fetch origin && git checkout -b docs/librarian-$(date +%F) origin/main`. If no `*.md` changed and no commit landed in the last 8 days, report "no changes needed" and stop.
2. Inventory: `python3 -I .claude/skills/librarian/doc_tools.py unlisted` (docs the index does not name) and `... stale-ids`.
3. **New docs**: add each to `DOCS_INDEX.md` (finder table if it answers a task; catalog with a status word ACTIVE / REFERENCE / CONTRACT / DATED). Give a non-ACTIVE, uncited doc a `> **Status: ...**` banner under its title.
4. **Finished plans**: a plan, handoff or prompt that `DECISIONS.md` marks DECIDED/built (or is clearly superseded) **and** that `git grep -n "<file name>"` (including the app HTML) finds nowhere in code: `git mv` to `docs/archive/plans/`, add the ARCHIVED banner (copy the wording from an archived file), add it to `docs/archive/README.md` and `DOCS_INDEX.md` 2.4.
5. **Drift report (read only)**: compare the counts and the "current version" statements in `DOCS_INDEX.md` with `docs/TESTING.md` and the README; compare the `docs/DECISIONS.md` "Working on (claims)" table with `git branch -r` / open PRs. Put mismatches under "Needs a human"; do not fix big docs.
6. `python3 -I .claude/skills/librarian/doc_tools.py index` and `... links`. Fix links you caused; list pre-existing ones.
7. Update the "Last pass" date in `DOCS_INDEX.md` section 7. Gate: Markdown-only changes use `node scripts/run_ci_locally.js --fast` (run `npm ci` first if needed); paste its summary line in the PR. Posting the `local-gate` status needs GitHub credentials that may not exist in the cloud: if `--post-status` cannot post, say so plainly in the PR. Never write "CI will run it".
8. Commit (`docs: librarian pass <date>`, repo's usual `Co-Authored-By` line), push the branch, open a PR with the same title listing: new index rows, archived docs, fixed links, "Needs a human". If nothing changed, do not open a PR.

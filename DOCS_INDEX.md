# Documentation Index — Booking Flash Report NA

> **Maintained by the librarian pass; last full review 2026-10-30.** The map of every document in this repo: what it is, how current it is, and which one to open for which job. `AGENTS.md` stays the operational entry point (rules, checks, landing); this file answers "which doc do I open?". If you add, move or retire a doc, update this file in the same change.

## 0. Start here (60 seconds)

1. [`AGENTS.md`](AGENTS.md): the rules (which checks to run, the local gate, landing, working practices). Read first.
2. [`README.md`](README.md): what the app is, **which HTML file is current** (never trust a version number or a filename written anywhere else; the README's "Current version" note and `scripts/print_app_file.js` decide), how to run and deploy.
3. This file: find the one doc the task needs, open only that.

**These are huge; search them, never read them whole:** `HANDOFF.md` (356 KB), `CODE_NOTES.md` (360 KB), `docs/CHECK_HISTORY.md` (351 KB), `docs/DECISIONS.md` (263 KB), `DATA_ARCHITECTURE.md` (151 KB), `apps-script/README.md` (123 KB), `docs/TESTING.md` (115 KB), `docs/ROADMAP_PLAN.md` (96 KB). Recipes in section 5. The app file itself is over 16,000 lines: grep, then read a range (AGENTS.md "Keeping agent sessions cheap").

**Do not move, rename or split any of the big docs without Kevin's go-ahead.** About 90 places in the app file, scripts and tests cite them by file name and section heading ("see AGENTS.md check 2", "HANDOFF Class E", `docs/DECISIONS.md` D59). Headings are the addresses.

## 1. I need to...

| I need to... | Open | Notes |
|---|---|---|
| Know what checks to run after a change and how to land it | [`AGENTS.md`](AGENTS.md); short path in [`.claude/skills/checks-and-landing/SKILL.md`](.claude/skills/checks-and-landing/SKILL.md) | `node scripts/run_ci_locally.js` is the only gate (no GitHub Actions, D59). Markdown-only: `--fast --post-status`. |
| Run one check, read counts, tell flaky from real, serve my own checkout | [`docs/TESTING.md`](docs/TESTING.md) | Counts here are the baseline to compare executed-check counts against. |
| Know *why* a rule or check exists | [`docs/CHECK_HISTORY.md`](docs/CHECK_HISTORY.md) | The incidents behind each rule; same headings as the old AGENTS.md. |
| See what Kevin decided / what is open / who is working on what | [`docs/DECISIONS.md`](docs/DECISIONS.md) | Answer sheet, Open, Decided, Decision log (D-numbers), and "Working on (claims)" at the bottom. Read before feature work. |
| Find which source column a `getVal()` field reads, or chase "this number looks wrong" | [`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md) | Includes the full data-linkage validation workflow and per-tab validation status. |
| Understand the architecture, data model, pivots and the known bug classes | [`HANDOFF.md`](HANDOFF.md) | Read before touching numeric/colour logic or the pivot engine. Topic sections, newest at the end. |
| Understand why a piece of code is written the way it is | [`CODE_NOTES.md`](CODE_NOTES.md) | Long notes behind short pointer comments in the app file. |
| Deploy to Apps Script, set up server features, run the production checklists | [`apps-script/README.md`](apps-script/README.md) | Production-only questions stay open until run on `/exec`. |
| Share private VVD notes with the Vessel Planning Tool | [`apps-script/PRIVATE_NOTES_FILE.md`](apps-script/PRIVATE_NOTES_FILE.md) | The contract shared with VPT (see section 6). |
| Know the server-saved preferences interface | [`docs/SERVER_PREFS_CONTRACT.md`](docs/SERVER_PREFS_CONTRACT.md) | Frozen contract (2026-09-16). |
| Edit shared logic used by both the app and Apps Script | [`AGENTS.md`](AGENTS.md) "Shared logic"; `shared/` | Edit `shared/`, run `node scripts/sync_shared.js`; never hand-edit the generated region or `apps-script/Shared.gs`. |
| Check a feature's design / spec | [`docs/specs/`](docs/specs) (section 2.3) | |
| See the roadmap and wave results | [`docs/ROADMAP_PLAN.md`](docs/ROADMAP_PLAN.md) (with the D-decisions in `DECISIONS.md`) | Draft plan with running wave logs; the DECIDED entries win. |
| Know the real data files and expected values | [`tests/fixtures/HISTORICAL_EXPECTED_VALUES.md`](tests/fixtures/HISTORICAL_EXPECTED_VALUES.md); AGENTS.md "Verify against real data" | Count CSV rows with an RFC 4180 parser, never `wc -l`. |
| Understand the performance work | [`PERFORMANCE_REVIEW.md`](PERFORMANCE_REVIEW.md) (v1.66 review, 2026-09-10, DATED); benchmarks in `docs/TESTING.md` | |
| Find the original Excel logic (VBA, pivots) | `macros.txt`, `files/booking_flash_report_REFERENCE_vba_source.txt`, `pivot_details.txt`, `pivot_xmls/`; `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm` | Reference material, not docs. |
| Open a pull request | [`.github/pull_request_template.md`](.github/pull_request_template.md) | |
| Pick up a previous session's handoff | [`docs/handoffs/`](docs/handoffs) | One dated file per handoff. |

## 2. Catalog

Status words: **ACTIVE** (maintain), **REFERENCE** (accurate, rarely changes), **CONTRACT** (frozen interface), **DATED** (a plan, review or handoff tied to a day), **ARCHIVED** (retired to `docs/archive/`).

### 2.1 Core (ACTIVE)

| Doc | Size | Purpose |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | 21 KB | Operational entry point: checks, gate, landing, practices. Code comments cite its sections. |
| [`README.md`](README.md) | 19 KB | Current-version rule, run/test/deploy overview, basic build. |
| [`docs/TESTING.md`](docs/TESTING.md) | 115 KB | How to run every check; counts; flaky-vs-real; landing with `scripts/land.js`. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 263 KB | Decision record (D-numbers) and the claims table. |
| [`docs/CHECK_HISTORY.md`](docs/CHECK_HISTORY.md) | 351 KB | Why each check and rule exists. |
| [`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md) | 151 KB | Field map, validation status, frozen datasets. |
| [`HANDOFF.md`](HANDOFF.md) | 356 KB | Project history, architecture, bug classes. |
| [`CODE_NOTES.md`](CODE_NOTES.md) | 360 KB | Long-form notes extracted from the app file. |
| [`apps-script/README.md`](apps-script/README.md) | 123 KB | Apps Script deploy, features, production checklists. |
| [`.claude/skills/checks-and-landing/SKILL.md`](.claude/skills/checks-and-landing/SKILL.md) | 11 KB | The short operational path; the docs above win if they disagree. |
| [`.claude/skills/librarian/SKILL.md`](.claude/skills/librarian/SKILL.md) | | The weekly documentation pass (section 7). |

### 2.2 Contracts and reference

| Doc | Status | Purpose |
|---|---|---|
| [`docs/SERVER_PREFS_CONTRACT.md`](docs/SERVER_PREFS_CONTRACT.md) | CONTRACT | Server-backed preferences interface. |
| [`apps-script/PRIVATE_NOTES_FILE.md`](apps-script/PRIVATE_NOTES_FILE.md) | CONTRACT | Private VVD notes file shared with VPT. |
| [`tests/fixtures/HISTORICAL_EXPECTED_VALUES.md`](tests/fixtures/HISTORICAL_EXPECTED_VALUES.md) | REFERENCE | Expected values of the 9-day historical data (pinned by `tests/check_history_days.js`). |
| `macros.txt`, `pivot_details.txt`, `files/booking_flash_report_REFERENCE_vba_source.txt`, `conditional_formatting_rules.json`, `pivot_xmls/` | REFERENCE | Extracts of the original workbook. |
| [`.design-sync/NOTES.md`](.design-sync/NOTES.md), [`.design-sync/conventions.md`](.design-sync/conventions.md), `design-system/` | REFERENCE | A component-library package built for a design-sync; **not** the app. NOTES.md still describes the old 1.10 file as the app. |

### 2.3 Specs and plans

| Doc | Status | Purpose |
|---|---|---|
| [`docs/specs/2.3-what-changed-banner.md`](docs/specs/2.3-what-changed-banner.md) | REFERENCE | "What changed" summary spec (cited by the app). |
| [`docs/specs/2.5-history-index-design.md`](docs/specs/2.5-history-index-design.md) | REFERENCE | History index design note. |
| [`docs/specs/3.3-worklist-panel.md`](docs/specs/3.3-worklist-panel.md) | REFERENCE | Worklist panel spec. |
| [`docs/ROADMAP_PLAN.md`](docs/ROADMAP_PLAN.md) | DATED (2026-10-04..06 draft, wave logs) | Build-out plan, 6 sections, 8 agents. |
| [`docs/RESEARCH_BUILDOUT_PLAN.md`](docs/RESEARCH_BUILDOUT_PLAN.md) | ACTIVE (2026-10-30, PROPOSED, D84) | Phased build-out of the 2026-10-30 user research for Booking Flash, with agent teams and ADR-R1. |
| [`FIELD_VISIBILITY_AND_SLICER_POPUP_PLAN.md`](FIELD_VISIBILITY_AND_SLICER_POPUP_PLAN.md) | DATED (2026-09-16) | Plan for the field-visibility picker and slicer hover-popup; still cited by `DECISIONS.md` as the starting plan. |
| [`PERFORMANCE_REVIEW.md`](PERFORMANCE_REVIEW.md) | DATED (2026-09-10, v1.66) | Performance and correctness review; cited by app comments. |
| [`docs/handoffs/2026-10-12-ci-merges.md`](docs/handoffs/2026-10-12-ci-merges.md) | DATED (2026-10-12) | Handoff after merging PRs 223/226/227 and the CI speed-up. |

### 2.4 Archive (ARCHIVED 2026-10-30)

[`docs/archive/`](docs/archive/README.md): the early pivot-replication phase plans (`Phase3implementation_plan`, `phase 2_implementation_plan`, `phase4&5implementation_plan`) and `pivot_master_prompt`. Nothing in code or tests cited them; the app has since moved to 2.5.

### 2.5 Repo clutter that is not documentation

The repo root holds old app snapshots (`booking_flash_report_na_Kevin_1.0X_*.html` and `.orig` files, the `1.67_TESTING` build), one-off patch scripts from the pivot-replication phase (`fix_*.py`, `patch_*.py`, `parse_xml_pivots*.py`, `implement_*.py`, `Untitled*.bas`) and `files.zip`. README calls the old HTML files "point-in-time snapshots, not maintained". They are listed here so nobody mistakes them for current; moving them needs a code check first (see the gaps list).

## 3. Folder map (docs only)

```
/
  AGENTS.md  README.md  DOCS_INDEX.md                   <- read these first
  HANDOFF.md  CODE_NOTES.md  DATA_ARCHITECTURE.md       <- big, search don't read
  PERFORMANCE_REVIEW.md  FIELD_VISIBILITY_AND_SLICER_POPUP_PLAN.md   <- dated plans/reviews
  docs/   TESTING.md  DECISIONS.md  CHECK_HISTORY.md  ROADMAP_PLAN.md  SERVER_PREFS_CONTRACT.md
          specs/  handoffs/  archive/ (retired early plans)
  apps-script/  README.md  PRIVATE_NOTES_FILE.md  *.gs   <- server side
  shared/  tests/  scripts/  dist/  design-system/       <- code (dist/ is generated)
  .claude/skills/  checks-and-landing, librarian
  .design-sync/    design-sync notes
```

## 4. Rules for keeping the docs findable

1. **One fact, one home.** Rules: `AGENTS.md`. How to run a check: `docs/TESTING.md`. Why: `docs/CHECK_HISTORY.md`. Product decisions: `docs/DECISIONS.md` (write the entry before building; a recommendation is `PROPOSED` until Kevin confirms in writing). Field mapping: `DATA_ARCHITECTURE.md`. Link, do not copy.
2. **Never hardcode the app's file name in a doc or script**; point at the README note or `scripts/print_app_file.js`.
3. **Headings are addresses.** Code and docs cite sections by heading text. Do not rename a heading in a cited doc without `git grep -n "<heading text>"` across `*.md *.js *.html *.py`.
4. **Do not auto-load the big docs** (no `@` imports of them).
5. **Markdown-only changes** gate with `node scripts/run_ci_locally.js --fast --post-status` (AGENTS.md; D59). Never write "CI will run it".
6. **New doc:** give it a title that says what it is, add a row here, and say whether it is ACTIVE, REFERENCE, CONTRACT or DATED.
7. **Archive a doc** only when nothing cites it (`git grep -n "<file name>"` over everything including the app HTML); `git mv` it into `docs/archive/`, add the banner, add a row to `docs/archive/README.md` and section 2.4.

## 5. Searching the big files

```bash
grep -n "^## " HANDOFF.md | head -80                   # topics of the handoff, in order
grep -n "Class E" HANDOFF.md DATA_ARCHITECTURE.md      # a bug class
grep -n "^### D59\|D59" docs/DECISIONS.md | head       # one decision
grep -n "Working on (claims)" docs/DECISIONS.md         # who is working on what (bottom of file)
grep -n "^## " docs/CHECK_HISTORY.md | head -60
grep -n "getVal(\[.*'Peak Utiliz" Booking_flash_report_na_2.5_WORKING_PRO_ONLY.html | head   # read a range after, not the file
```

## 6. Sibling projects

| Project | Relationship | Where documented |
|---|---|---|
| **Vessel Planning Tool (VPT)** | Reads Booking Flash's live export through a shared snapshot (`booking_flash_live.csv.gz`, VPT ADR-057), shares the private notes file, and matches its lane list to Booking Flash (VPT ADR-049). The Booking Flash Apps Script library was detached from VPT (VPT ADR-040). | [`apps-script/PRIVATE_NOTES_FILE.md`](apps-script/PRIVATE_NOTES_FILE.md); VPT repo `DOCS_INDEX.md` and `new Build/docs/reviews/DATA_FEED_OVERLAP_2026-10-29.md` |
| **Max Laden Generator** | Reads the Booking Flash `Space_Analyst` tab for PIC and Coast. | Max Laden repo `DOCS_INDEX.md` |

## 7. Weekly librarian pass and known gaps

Procedure and guard-rails: [`.claude/skills/librarian/SKILL.md`](.claude/skills/librarian/SKILL.md) (helper `doc_tools.py`). A scheduled routine runs it every Monday on a branch and opens a PR (markdown only). **Last pass: 2026-10-30.**

Open gaps:
- The big docs are too large to read and cannot be split without breaking citations. If searching stops being enough, the next step is a generated table of contents per big doc (a new `docs/TOC_*.md`), which needs no change to the originals.
- `.design-sync/NOTES.md` still names `booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html` as the app.
- Root clutter (old HTML snapshots, `.orig` files, one-off `fix_*.py`/`patch_*.py` scripts, `Untitled*.bas`, `files.zip`) could move to an `archive/` folder, but scripts or tests may name them; check before moving.
- `docs/ROADMAP_PLAN.md` and `FIELD_VISIBILITY_AND_SLICER_POPUP_PLAN.md` have no explicit "done / not done" line; `DECISIONS.md` is the authority on what shipped.
- `docs/TESTING.md` carries the dated check counts ("726 checks, 2026-10-14" at the last read); refresh them whenever the gate changes (that is a code-adjacent change: the weekly pass only flags it).

# Booking Flash Report NA — build-out plan (6 sections, 8 agents)

Status: draft for Kevin's review, 2026-10-04; updated 2026-10-05: D1 decided, review findings applied;
updated 2026-10-05: wave-1 findings applied (first wave of the agent team; see "Wave 1 results" at the top of section 4).
updated 2026-10-05: wave 2 built (slices 1.4, 2.1, 4.1 and the logic of 1.5, plus the behaviour check; see "Wave 2 results" in section 4).
updated 2026-10-06: Kevin answered the open questions on the wave-3 stack (all recommendations accepted; see "Decisions of 2026-10-06" in section 4); the open PRs are being integrated into one branch (in progress).
Step A (single app-file resolver) is draft PR #155 (`claude/single-app-file-resolver`; full local gate passed,
325/325 browser checks on source and `dist/`). Wave 1 has since finished slices 0.2, 0.3, 0.5 and 1.3, the design note for
2.5 and the specs for 2.3 and 3.3; the slices are done and in review, as PRs #156 (this plan, 0.5 and the specs), #157 (0.2 and 0.3) and #159 (1.3). Wave 2 added #158, #160 and #161 (see "Wave 2 results"). Everything else
below is unbuilt. This document does not change any code, check or app file. `scripts/print_app_file.js`, referenced
below, arrives with the PR for Step A; `shared/`, `scripts/sync_shared.js` and `tests/lib/history_days.js` arrive with the
PR for 0.2 and 0.3.

Every number in this plan comes from a measurement made in the brainstorm session (9-day historical
CSV, repo greps, a headless-Chromium probe). Anything unconfirmed is labelled **UNCONFIRMED** and has an
owner for confirming it. A review on 2026-10-05 re-measured the numbers against the real files (CSV rows
counted with an RFC 4180 parser) and found several wrong or undefined in the first draft; each correction
below says what the first draft claimed ("an earlier draft said ...") rather than being rewritten silently.
The first wave of the agent team (2026-10-05) then re-derived the numbers once more with its own parser: every earlier
number matched except the ones this document marks as corrected (the row-level "+10,846 TEU" figure in 2.1, the 0-2 day
laden bucket in section 0, and the history index's raw byte size, which depends on how the rows are serialised).

---------------------------------------------------------------------------------------------------

## 0. What changed since the first idea list (read this first)

The first list was written before reading the code. Reading it corrected six assumptions:

| First-list idea | Reality | Consequence for the plan |
|---|---|---|
| "Persist daily snapshots" | Already built: `apps-script/Code.gs` archives one file per day; the app has a Historical Data picker and Compare. | Not a new build. The real gap is a **compact derived history index** (the archive is ~0.7 MB/day; sparklines, persistence rules and retention curves need about 57.5-60 KB/day raw (depending on the serialisation), about 10.8 KB/day gzipped, measured: slice 2.5 and its design note, [`docs/specs/2.5-history-index-design.md`](specs/2.5-history-index-design.md). An earlier draft said "a few KB"). |
| "Attention panel / alerts" | Banners exist for feed errors and large schedule changes (`scheduleChangeWarning`). Nothing inspects row *content*. | Build content-level exceptions only. |
| "Data-quality checks" | On the 9-day CSV the structural checks (duplicate keys, blank POL, cut-off after ETD, voyage-field disagreement) found **0** problems. | Ship only a silent schema/row-count **canary**. Do not build UI for checks that never fire. |
| "Compare mode" | Compare (two dates / two files) exists. | Only "compare two slices of one dataset" is new, and `compareKpiSnapshots(oldRows, newRows)` already accepts it. |
| "Export what you see" | Excel (DOM scrape), screenshot, and Export to Drive (data-driven) all exist. | Add a data-driven "Export (data)" *beside* the old one; never change the old one (downstream workbooks key on column position). |
| "Forecast / pace line" | Laden TEU *falls* near and after cut-off, then freezes (median −6.94%/day at 0–2 days to cut-off, n = 165; 2,263 of 2,433 post-cut-off day-pairs flat; an earlier draft said −7.2%, n = 160, from a method it did not state, and the method is now pinned, see 5.2). | A pace extrapolation would project up when sailings land ~20% lower. Build a **retention curve** instead, and only when enough history exists. |

---------------------------------------------------------------------------------------------------

## 1. Ground rules for every agent (from AGENTS.md, restated because they shape the schedule)

1. **One writer for the app HTML.** Only the Integrator (R1) edits `Booking_flash_report_na_*_WORKING_PRO_ONLY.html`
   (never hardcode that name; use `node scripts/print_app_file.js`). Everyone else works on other artifacts
   (shared logic, `apps-script/`, tests, docs) or verifies. **One mechanical exception:** a PR that changes `shared/` must
   include the region of the app HTML (and the Apps Script copy) regenerated by `node scripts/sync_shared.js` (D1; see
   **Decisions recorded**). That script-generated region is the only app-HTML edit permitted outside R1, and it is never
   hand-edited. **This single file is the plan's bottleneck**, so the
   schedule is built around it: logic and server work run in parallel *around* a serial queue of small UI slices.
2. `dist/index.html` is generated (`node scripts/build_deployable.js`); never hand-edit.
3. **No checkpoint commits.** A slice = edit → run checks → one commit → push → draft PR. Related fixes may share a commit.
4. **Gate = `node scripts/run_ci_locally.js`, in full, on the merged tree; `--post-status` leaves the green `local-gate` check on the pushed head** (D59: there is no GitHub Actions).
   Report per-suite executed-check counts against `docs/TESTING.md`, not just pass/fail.
5. **A new check goes in two places in the same commit:** the `jobs` array in `scripts/run_ci_locally.js`, and the table in `docs/TESTING.md`.
   The slice's author makes these wiring edits in the same commit; the file owners in §2 approve them.
6. **Verify against real data** before reporting any number. Count CSV rows with an RFC 4180 parser (never `wc -l`). Label what you could not confirm.
7. **Production-only claims stay open** until someone runs the checklist on `/exec` (`google.script.run`, sharing, triggers, per-user isolation, storage in the sandboxed iframe). Local runs test the client against fakes.
8. Row-highlight budget (check 5, `tests/perf_highlight_benchmark.js`) is **required** whenever row-component props or table row rendering change — which the Δ column and sparklines do.
9. No silent state. Anything restored, cached or applied from outside (saved filters, shared view, cached data) gets a **visible banner** (lesson from the filter-restore incident).
10. In this sandbox the browser suites need `BF_VENDOR_CDN=1` and `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
    (a repo-local Playwright install otherwise looks for a Chromium build that is not present). The source regression run takes
    about 7 minutes, and when several agents share the sandbox the runner's default 240 s result wait stops it early, so also set
    `BF_RESULT_POLL_TIMEOUT_MS=1200000` (a hang detector, not a speed budget; `docs/TESTING.md`). Wave-1 agents needed it.

---------------------------------------------------------------------------------------------------

## 2. The team (8 agents) and who may touch what

| # | Role | Owns (only this role edits) | Does not touch |
|---|---|---|---|
| R1 | **Integrator / App writer** | the app HTML (serial slice queue; the generated shared region is written only by `scripts/sync_shared.js`, see below), merges (shared-logic PRs one at a time), runs the full gate, owns the draft PR for each slice | — |
| R2 | **Logic engineer** | `shared/` pure modules + `scripts/sync_shared.js` (see D1), headless checks for them; every R2 PR includes the regenerated outputs (app HTML region + Apps Script copy) produced by running the sync script, and nothing else in the app HTML or `apps-script/` | hand edits to the app HTML or apps-script |
| R3 | **Apps Script engineer** | `apps-script/**` (Code.gs, DataFeeds.gs, TeamSheet.gs, basic/, `apps-script/README.md`) except the generated copy of `shared/`, which only the sync script writes | app HTML, tests/ci files |
| R4 | **Data verifier** | `tests/fixtures/**`, the slicing helper and reference oracles (`tests/lib/history_days.js`, with its pinning check `tests/check_history_days.js`; an earlier draft put the helper under `tests/fixtures/`), `scripts/*_report.js` research scripts, calibration reports | product code |
| R5 | **Test / CI engineer** | `tests/booking_flash_regression_tests.js`, `tests/ci_regression_runner.js`, `tests/check_resolve_app_html.js`, `scripts/run_ci_locally.js`, perf benches | app HTML |
| R6 | **UX / design** | specs in `docs/specs/**`, Playwright screenshots (390 px phone, ~700 px, 1366 px), copy for banners | code |
| R7 | **Repo hygiene + docs** | `README.md`, `AGENTS.md`, `DATA_ARCHITECTURE.md`, `docs/**` (except `docs/specs`), `HANDOFF.md`, `CODE_NOTES.md`, `archive/**`; supplies the production-checklist text that lands in `apps-script/README.md` | code |
| R8 | **Reviewer / security** | nothing (read-only); files findings; runs `/code-review` and `/security-review` per slice | everything |

Collision rules: each file has one **owner** who must approve edits to it. Wiring edits listed here may be made by the
slice's author in the same commit (the owner approves in the PR). Cross-role needs go through a short written request in the
slice's PR description. R1 batches UI slices so the app HTML has **at most one open branch carrying hand edits at a time**;
shared-logic PRs are the only other writers of that file, and only of the generated region (see **Decisions recorded**).

An earlier draft said "each file has exactly one owner" but left several files with two owners or none. Files the table
above does not cover, and the rule for each:

| File(s) | Owner (approves) | Who supplies or edits |
|---|---|---|
| `apps-script/README.md` | R3 | R7 supplies the production-checklist text, landed through the slice's PR |
| `AGENTS.md`, `DATA_ARCHITECTURE.md` | R7 | R4 supplies the D2 answer text (slice 0.5); R7 lands it |
| new `tests/check_*.js` | R5 | the role that writes the logic it checks |
| `tests/check_resolve_app_html.js`, `scripts/run_ci_locally.js` | R5 | the slice's author makes the wiring edit (0.2 extends the guard check; every new check adds its entry to the runner's `jobs` array) |
| `docs/TESTING.md` check-table row | R7 | the slice's author edits it in the same commit as the new check |

---------------------------------------------------------------------------------------------------

## 3. Decision gates for Kevin (nothing in the dependent phase starts until answered)

The answer sheet for D1-D8, with the evidence for each and a recommended default, is [`docs/DECISIONS.md`](DECISIONS.md)
(slice 0.5); answer there. Rows below keep the plan's own wording and the wave-1 corrections.

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | **DECIDED 2026-10-05: option (a).** Shared pure logic lives in `shared/*.js` as the source; `scripts/sync_shared.js` writes a marked region into the app HTML and a generated copy for Apps Script; CI `--check` fails if either is stale. (Rejected: (b), a block edited inside the HTML.) | Decided by Kevin; consequences and the settings 0.2 must pin down are under **Decisions recorded** below. | Unblocks Phase 0.2 and everything after it |
| D2 | What do `MCT Loading Threshold` / `MCT Overall Threshold` mean — which measure does each apply to (laden, bookings, POL utilisation, overall utilisation)? Policy or placeholder? **They vary per row.** An earlier draft said "value 1.2 in sampled rows"; measured on 2026-09-01 (898 non-VMS rows): Overall Threshold is 1.5 on 267 rows, 1.2 on 164, 1 on 143, 1.25 on 69, 1.35 on 64, 1.6 on 51, 0.75 on 42, 1.15 on 30, 1.65 on 28, 1.8 on 28, 0 on 12; Loading Threshold is similarly spread (1.5 on 283, 1 on 187, 1.2 on 108, 0.75 on 57, 2 on 52, 0 on 52, …). | Kevin or the MCT sheet owner answers **per column**: which measure each threshold is compared with, and whether 0 means "no threshold". R4 supplies the answer text; R7 lands it in `DATA_ARCHITECTURE.md`. Until answered, the baseline for the over-threshold rule (3.1b) is **unconfirmed**. **Wave-1 evidence (R4, 9-day CSV; evidence, not an answer):** `MCT Overall Threshold` equals `Trunk Threshold` on all 8,769 rows, and `MCT Loading Threshold` equals `POL Laden Threshold` on 8,644 (the other 125 are 0 against 1.2, on 15 sailings, so 0 may mean "unset"). `DATA_ARCHITECTURE.md` only maps those columns to app fields (`standbyRaw`, `polLdnThresh`) and records no meaning. `Measures Loading Status` is AP Only on 688 rows and AP Frozen on 105. POL utilisation above the row's own `MCT Loading Threshold` holds on 1,002 rows (612 of the 688 AP Only rows are among them), more than the 613 that a flat 1.0 flags. Where to look for the answer: the existing conditional-formatting rules (`conditional_formatting_rules.json`) and the app's use of `standbyRaw` / `polLdnThresh`, which R4 should read in slice 0.5; they have not been read for this purpose yet. | Exceptions (Phase 3) |
| D3 | Persistence N: how many consecutive days before "unowned" / "over threshold" is an exception? | Start at 3, configurable via the config Sheet; recalibrate after 2 weeks. **The 9 days cannot choose N** (measured, wave 1): the sailings that reach an unowned streak of N are 22 (N=1), 4 (N=2), 3 (N=3 to 8) and 2 (N=9); see the table under 3.1. | Phase 3 |
| D4 | Can a PIC name (`Lani / Alex`) be mapped to an email? Is blank PIC legitimate on some lanes? An earlier draft guessed EXW/EXE; measured by lane, the blank-PIC rows are FLX 51, EXW 27, EXE 8, INE 8, ANG 2 (96 rows), so **FLX is the largest**, yet the three sailings that stay unowned for days (see 3.1) are all on EXE/EXW, the lanes the earlier draft asked about. **Does a half-TBA PIC count as unowned?** PIC is a `SPC / MKG` pair, and 239 non-VMS rows across 28 sailings contain `TBA` in either half (`Peter / TBA` 96 rows, `TBA / Alex` 67, `TBA / Marissa` 40, `TBA / Bob` 36; an earlier draft listed three pairs and an ellipsis; with the VMS placeholder rows included it is 384 rows across 29 sailings). | A name→email tab in the config Sheet; Kevin lists lanes where blank PIC is normal. **Default for the half-TBA question: unowned means blank on both halves only** (3.1 proceeds on this default until answered). | Notes owner field, brief |
| D5 | Is an emailed morning brief wanted, who receives it, and who owns the installing account? | Defer; decide after Phase 3 proves the worklist is used. | Phase 4 brief |
| D6 | Archive scope: which root files stay? | Move the 51 unreferenced files to `archive/`; keep `validation_ground_truth.json` (live) and the three referenced snapshots. Confirm nobody runs the old scripts by hand. | Hygiene slice |
| D7 | Is a second, data-driven Excel export acceptable beside the existing one? Who consumes today's export? | Yes, additive. | Export slice |
| D8 | Who runs the production (`/exec`) checklists, and on what cadence? | Name one person; R7 prepares copy-paste checklists per slice. | Every server-touching slice |

**UI and design questions** (not in `docs/DECISIONS.md`, which covers D1-D8 only; each spec states the answer it assumes and is open until Kevin replies):
[`docs/specs/2.3-what-changed-banner.md`](specs/2.3-what-changed-banner.md) has seven (K1-K7) and
[`docs/specs/3.3-worklist-panel.md`](specs/3.3-worklist-panel.md) has nine (K1-K9). The history-index design note,
[`docs/specs/2.5-history-index-design.md`](specs/2.5-history-index-design.md), ranks ten open questions in its section 9; D8 is its first, and
the other nine (columns and `lane`, the History Sheet's location and owner, retention, backfill depth, how the 5.2 report gets its data,
the as-of date for 2.2, org-wide VIEW sharing, `changedAt`, one trigger or two) are specific to 2.5 and also open.

---------------------------------------------------------------------------------------------------

### Decisions recorded

**D1 = (a), 2026-10-05 (Kevin).** What follows from it. Items marked *proposed* are defaults for slice 0.2 to confirm, not
decisions.

- **What changes for people and agents.** The app HTML is still opened over the static server with no build step. The one new
  step: after editing anything in `shared/`, run `node scripts/sync_shared.js` before opening or testing the app. Everything outside
  the generated region is edited in the HTML exactly as today. AGENTS.md and `docs/TESTING.md` get this rule (and the one-writer
  exception below) when 0.2 lands, not before.
- **The generated region is never hand-edited.** It sits between begin/end markers in the app HTML that say "generated by
  scripts/sync_shared.js from shared/, do not edit". `node scripts/sync_shared.js --check` fails when the region (or the Apps Script
  copy) differs from what the sources would produce. This is the same pattern as `dist/index.html` and `build_deployable.js --check`.
- **Who writes the app HTML, and the regeneration rule.** Only R1 (integrator) edits the app HTML, with one mechanical exception.
  **A PR that changes `shared/` MUST include the regenerated outputs (the HTML region and the Apps Script copy) produced by running
  `node scripts/sync_shared.js`**, because CI `--check` fails otherwise. That script-generated region is the ONLY app-HTML edit
  permitted outside R1. R2 owns `shared/` and the sync script. R1 inserts the markers once (0.2) and thereafter only re-runs the sync,
  as the first step of every R1 slice. An earlier draft said R2 "does not touch the HTML" and that shared-logic work therefore runs in
  parallel with the app-file queue. That was wrong: the region lives inside the single-writer file and `--check` requires it to be
  regenerated, so every shared-logic PR rewrites the same lines of the same file.
- **Merge discipline for shared-logic PRs.** Shared-logic PRs **merge one at a time through R1's queue**. On any conflict in a generated
  file (the HTML region or the Apps Script copy), take neither side and re-run `node scripts/sync_shared.js` on the merged `shared/`;
  never hand-merge. Consequence for the schedule: the three R2 slices in wave 2 (2.1, 1.5, 4.1) are **developed in parallel but merge
  sequentially**, in the order R1 sets.
- **Where it lands in the gate** (all in the same commit as 0.2, per AGENTS.md "Adding a check"): a new entry in the `jobs` array of `scripts/run_ci_locally.js` (the old `ci.yml` copy is gone, D59),
  a row in `docs/TESTING.md`, and the existing app-file guard check extended so a
  shared function cannot also be pasted into another file. `node scripts/build_deployable.js` is unchanged: it compiles the app HTML,
  which now contains the region.
- **Language constraint** *(proposed)*: `shared/` files are plain ES5-compatible, dependency-free functions with no DOM, no `window`,
  no `require` of repo files, so one source runs unchanged in the browser (inside the app's script), in Node tests, and in Apps Script.
  Tests `require` the files in `shared/` directly instead of regex-extracting functions out of the HTML. **Comment rule (wave-1
  finding, enforced by the pipeline):** the slash-star block-comment opener appears only where a real block comment begins its own line,
  never inside a marker or a line comment (for example the text "shared/" followed by "*.js"); see the risk register.
- **Apps Script copy** *(proposed)*: one generated file under `apps-script/` (for example `Shared.gs`), covered by the same `--check`.
  Apps Script has no `require`, so the generator concatenates the `shared/` files in a fixed order. The basic build
  (`apps-script/basic/`) must keep working with the region present: `tests/check_basic_build.js` covers it.
- **Order and names** *(proposed)*: `shared/` files are concatenated in filename order and each exports only through a single
  namespace object (for example `BFShared.diffSailings`), so the region adds one top-level name to the app's script, which has 224
  top-level declarations today, and cannot collide with them.
- **Open until 0.2 runs:** how the region interacts with the in-browser Babel path versus the precompiled `dist/` path (both must see
  the same code; to be proved by the regression suite on source and `dist/`), and whether the Apps Script copy needs any
  transformation (to be proved by running `shared/` tests against the generated `.gs` file in Node). If either fails, 0.2 stops and
  reports instead of falling back to option (b) silently. 0.2 is now in review (PR #157): take the outcome of these two
  checks from that PR and update this paragraph when it merges (the wave-1 report does not state it).

## 4. Phased work breakdown

Sizes: **S** ≈ under half a day of agent time, **M** ≈ about a day, **L** ≈ 2–3 days; for totals below, **S = 0.5, M = 1, L = 2.5 agent-days**. "PROD" = needs a production check on `/exec`.
Every slice's acceptance includes: full local gate green with executed-check counts compared to `docs/TESTING.md`, new checks wired in three places, an evidence note from R4, an R8 review with no open blocker.

### Wave 1 results (2026-10-05)

The first wave of the agent team (R2 to R7) has reported. Nothing is merged yet, so each slice below is "in review"; the PR numbers were filled in on 2026-10-05. The measured corrections are applied where they belong: the slice rows 1.1, 1.3, 2.1, 2.2, 2.3, 2.5, 3.1, 3.3, 5.2 and 5.4, rows D2, D3
and D4 in section 3, and sections 0, 1 and 5 to 8; each says "an earlier draft said ..." where a statement changed. Sizes and effort totals were not re-estimated.

**Done**

| Slice | Status | Where it lives | Note |
|---|---|---|---|
| 0.2 shared-logic pipeline | Done / in review, PR #157 (with 0.3) | the pipeline's files per D1a (`shared/`, `scripts/sync_shared.js`, generated copies) | One PR with 0.3 |
| 0.3 fixtures helper | Done / in review, PR #157 (same PR as 0.2) | `tests/lib/history_days.js`, `tests/check_history_days.js`, `tests/fixtures/HISTORICAL_EXPECTED_VALUES.md` | Reference oracles that 2.1, 3.1 and 5.2 must reproduce (see 2.1 and 5.2) |
| 0.5 decision pack | Done / in review, PR #156 (this PR) | [`docs/DECISIONS.md`](DECISIONS.md) | Answer sheet D1-D8 with evidence and defaults. D2 has evidence but no answer; D2-D8 are all still open |
| 1.3 phone overlap fix | Built twice: in the main file as PR #159 (stacked on #157, still open) and in the 2.5 testing build as PR #171 (see Wave 3 results) | one class on one element of the app HTML (both files) | See the 1.3 row |
| 2.5 design note | Design done; build not started | [`docs/specs/2.5-history-index-design.md`](specs/2.5-history-index-design.md) | Written by R3 and filed under `docs/specs/` (which §2 gives to R6); design only, no code; every Google-side behaviour UNCONFIRMED until its checklist runs on `/exec` |
| 2.3 spec | Spec done; slice not started | [`docs/specs/2.3-what-changed-banner.md`](specs/2.3-what-changed-banner.md) | Seven open questions for Kevin (K1-K7) |
| 3.3 spec | Spec done; slice not started | [`docs/specs/3.3-worklist-panel.md`](specs/3.3-worklist-panel.md) | Nine open questions for Kevin (K1-K9) |

**Blocked by an open decision**

| Slice | Open decision | What is missing |
|---|---|---|
| 0.4 archive cleanup | D6 | which root files may move |
| 2.5 history index (build) | D8, and questions 2-5 in the design note | a named person for the `/exec` checklist; the row's columns, the Sheet's location and owner, retention, backfill depth (questions 2-5 of the note; its questions 6-10 are open too) |
| 2.2 server part (`fetchedDate`) and the optional `changedAt` in 1.1 | D8 | production check of a server edit; 2.2's client loader is not blocked once 2.1 exists |
| 2.3 and 3.3 (build) | their UI questions, K1-K7 and K1-K9 | each spec assumes its recommended answers; Kevin confirms or changes them |
| 3.1 exceptions logic | D2 (rule b), D3, and 2.5 (which waits on D8) | the meaning of the threshold columns; N |
| 3.2 config keys | D3, D4 | N; the name-to-email tab; the blank-PIC-OK lanes |
| 3.3 worklist | 3.1 and 3.2, so D2, D3, D4, D8 | as above |
| 4.5, 4.6 notes work | D4 | name-to-email mapping |
| 4.8 morning brief | D5 (and 3.3) | whether the brief is wanted and who installs it |
| 5.3 Export (data) | D7 | whether a second export is acceptable |
| 5.4 "typically lands at" tile | D2 (and the 5.2 gate) | the meaning of the measure |

Not blocked: 2.1, 1.5 and 4.1 (R2) can start once the pipeline PR merges, and so can 1.1, 1.2 and 1.4 (R1). Slices marked PROD
can be built; their production sign-off waits on D8, and until then the PR says "client verified against fakes; production unverified".

### Wave 2 results (2026-10-05)

The second wave (R2 on three slices, R5, R6, R1 integrating) has reported. Every slice below passed its own full local gate (`node scripts/run_ci_locally.js`, all jobs), with the executed-check count read against `docs/TESTING.md`. Nothing is merged. Effort totals were not re-estimated.

**Done / in review**

| Slice | Status | Where it lives | Note |
|---|---|---|---|
| 2.1 `diffSailings` | Done / in review, PR #161 (stacked on #157) | `shared/10_diff_sailings.js`, `tests/shared_logic/10_diff_sailings.js` (47 assertions) | Reproduces the R4 oracles on all eight real day-pairs. Rollover 2026-08-30 to 08-31: 24 sailings out (W29), 23 in (W46); laden OUT 26,065, IN 136, continuing +1,248, net -24,681; booking OUT 25,287, IN 100, continuing +1,260, net -23,927. The lead recomputed these through `Shared.gs` independently of the agent's tests |
| 1.5 `checkFeed` (logic only) | Logic done, PR #161; the banner is not built | `shared/20_feed_canary.js`, `tests/shared_logic/20_feed_canary.js` (62) | Silent on all nine real days and on a same-day live export (955 rows, 99 headers; not committed); each seeded breakage gives its own code |
| 4.1 `encodeView` / `decodeView` | Done / in review, PR #161 | `shared/30_view_codec.js`, `tests/shared_logic/30_view_codec.js` (330) | Treats URL text as untrusted. The lead forged 14 hostile links with a valid checksum, tampered every character of a link (1,928 variants, none accepted) and found `Object.prototype` untouched |
| Behaviour check for `shared/` | Done / in review, PR #161 | `tests/check_shared_logic.js`, CI job `shared-logic-check` | 442 assertions in 4 modules; fails when an exported function has no test module |
| 1.4 "Show in table" | Superseded: rebuilt in the 2.5 testing build as PR #173 (see Wave 3 results); PR #160, which edited the main file, is closed | the Analyze vessel list in the 2.5 testing build, +5 live checks | Total 325 to 330; the PR carries three design questions for Kevin |
| Build fix (`$'` in `replace()`) | In review, PR #158; the same two-line hunk is also in #161 | `scripts/build_deployable.js` | See finding 1 |

**What wave 2 found** (things this plan did not know)

1. **The #158 build bug is not latent.** The codec's `map['$' + x]` contains the characters `$'`, which `String.prototype.replace` treats as a pattern, so the build truncated the compiled script in `dist/`. `build_deployable.js --check` still said "up to date" (the corruption is deterministic); only the CI job's payload syntax check caught it. #161 carries #158's fix verbatim, so the two merge cleanly in either order. #155 and #157 still carry a `dist/` built with the old script (see the merge-order note in section 8).
2. **Two rules for `shared/`**, now in its header and `docs/TESTING.md`: never compare `typeof` with `'object'` or `'symbol'` (Babel adds a top-level `_typeof` helper), and a test module must not define a name `shared/` exports. Probed against the build's own Babel configuration.
3. **The 99-column claim holds but was misdescribed.** The live export has the archive's 97 columns plus two (`Vessel Vessel Owner`, `Vessel Vessel Operator`) at 0-based indexes 33-34, which moves 64 columns, not 66 as an earlier draft said. Nothing in the repo reproduces it (the workbook has 97 headers, the 9-day CSV 98 with `Record Date`). Keeping a trimmed live export as a fixture would make it checkable; that is a small proposal, not a decision.
4. **Choices the agents made where the brief was silent** (confirm or change): `diffSailings` reports `noBaseline` / `noCurrent` instead of calling every sailing new or gone; a sailing with a blank sale week is `removed` / `arrived`, never `rolledOut` / `rolledIn`; utilisation is the maximum over a sailing's port rows, so a change at a non-peak port does not show in the utilisation delta; a lane-only change is not `changed`. `checkFeed` matches column names exactly after cleaning (no substring pass, so a field that only resolves through `getVal()`'s fallback is reported) and reports a missing key or voyage column instead of skipping its check. The codec adds a CRC-24 suffix, so the link is `v1.<payload>.<check>` (this plan said only an encoded string); rejects a structurally bad key whole and drops only stale values; limits are 4,000 characters, 200 items, 40 header-filter keys, `weeksAhead` 1 to 52; `topPanelCollapsed` is deliberately not in the whitelist; absent means default, so the app must reset every whitelisted field before applying a decoded view. The app's `activeTab` is the codec's `tab`; header-filter keys must be identifier-like (all 48 literal `renderFilter` keys in the app fit).
5. **Nothing is wired.** The app calls none of the new functions, so no user-visible behaviour changed except 1.3 and 1.4. A guard the codec's wiring will need: nothing fails today if a future `renderFilter` key breaks the column-key rule, in which case `encodeView` returns `null` for any view with a header filter.

**Unverified.** `Shared.gs` has only run in Node's `vm`, never in a real Apps Script project. Mutation testing (22 of 22, 24 of 25 and 136 of 142 mutants killed, survivors equivalent or redundant) is the agents' report, not re-run by the lead.

**Newly unblocked** (by the dependencies in section 4): 2.2's client loader (needs 2.1), 4.2's server part (needs 4.1; its production check waits on D8), and 1.1 and 1.2. Still blocked as in wave 1: 0.4 (D6), 2.5 build (D8), 3.1 (D2, D3), 3.2 (D3, D4), 4.8 (D5), 5.3 (D7).

### Wave 3 results (2026-10-05)

> **2026-10-11: the 2.5 testing build was promoted to production** (per Kevin: "Lets promote 2.5 testing to production"). It is now
> `Booking_flash_report_na_2.5_WORKING_PRO_ONLY.html`, the one app file; 2.0 was deleted and every wave-3 slice below is in production.
> The per-target pins, the testing-build CI jobs and the drift check described in this section were removed with it. Read the rest of
> this section as the record of how the slices were built.

Wave 3 built the first user-visible slices: 1.1, 1.2, 1.5, 1.3 and 1.4. **All five are built in `Booking_flash_report_na_2.5_TESTING.html`** (1.3 also exists in the main file, see below), a copy of the 2.0 file that is never auto-detected as "the app" (its name contains "TESTING"), so the stack below does not touch production by hand-written app code. This follows Kevin's instruction of 2026-10-05 ("all the PRs ... built out in a new file for testing, separate from the production file"). Slices 1.3 and 1.4 had first been built in the main file (PRs #159 and #160). 1.4 is a feature, so it was rebuilt in the testing build (#173) and #160 is closed. 1.3 is a layout bug fix: #171 is its testing-build port and #159 stays open as the production copy, which Kevin confirmed on 2026-10-05. That matches the rule in #172 (another session; **merged**, Kevin's decision of 2026-10-06): new features go only in the testing build, while bug fixes go in production *and* are ported to the testing build. As of the original wave-3 write-up nothing from the stack was merged; the merge is now in progress through one integration branch (see "Integration and merge plan (2026-10-06, in progress)" below).

**Stack, in merge order** (each PR is stacked on the one before; retarget to `main` as the one below it merges): #165 (the 2.5 testing build and its per-target check pin) then #166 (feed-age helpers in `shared/`) then #168 (1.1) then #169 (1.2) then #170 (1.5) then #171 (1.3) then #173 (1.4). #159 (1.3 in the main file) is not part of this stack; it is stacked on #157. #174 (extra poll-path checks for 1.2, from the follow-up session) was folded into #169 on 2026-10-06 (GitHub shows it as merged, because its commit is now in #169's branch). **The stack landed on `main` in one PR, #184 (2026-10-06); see "How it landed" below.** The per-slice rows and pins in the table below are the state of each PR as first built; after PR #178, the landing and the follow-up round the real counts differ (the current pins are **516** on the 2.5 target and **356** on `main`).

| Slice | PR | New checks on the 2.5 target | Pin after it | What the build shows |
|---|---|---|---|---|
| 1.1 data stamp | #168 | `Feed_Stamp` 23 | 348 | **Moved into the Settings panel 2026-10-08 (D34, per Kevin).** A masthead row (until then) naming where the data came from and when it was *fetched* (never "updated": the export carries no `Last-Modified`). Measured by a separate visual review: +16 px of masthead at 640 px and wider, +32 px below; a stale stamp never moves the table. Stale means older than twice the refresh interval, and **the factor 2 is unconfirmed** |
| 1.2 last-good cache | #169 (with #174 folded in) | `Offline_Cache` 48 (36 as built, 4 poll-path checks from #174, 8 from the code review) | 396 | When the first load fails on both paths, the last good export (stored as CSV text in IndexedDB) is shown under a banner. A cached copy only ever fills an empty screen and is never written back |
| 1.5 data check | #170 | `Feed_Canary` 24, plus 2 silence checks in `Apps_Script_Team_Features` | 422 | An amber banner when `BFShared.checkFeed` finds a renamed or dropped column, a repeated row or a halved row count. Silent on every real data set; a flagged load is never saved as the last-good copy |
| 1.3 phone overlap | #171 | `Phone_Layout` 5 | 427 | The slicer box is 358 px wide at 390 px (94 px without the fix); 984 px at 1280 px, unchanged |
| 1.4 "Show in table" | #173 | 5 inside the two Analyze suites | 432 | A button on the expanded vessel list that clears every slicer, applies the group's own and closes the modal. Three design questions for Kevin are in the PR |

Every slice passed a full local gate (`node scripts/run_ci_locally.js`, 21 jobs) with the executed-check counts read, not just the pass rate (the follow-up commit on #168 re-ran the full 2.5 target and the fast gate, not all 21 jobs): `main` stays at 325 on both the source and `dist/`, and the 2.5 target matches the pin in the last column.

**What wave 3 found** (things this plan did not know)

1. **One hand-written line has to stay in the production file.** `tests/check_shared_sync.js` (check E) requires every definition of `isRealVvd` outside the generated region to delegate to `BFShared.isRealVvd`; the line from #157 does exactly that. I proved it by reverting it in a scratch copy: two checks failed. Taking it out means taking the shared region out of production, which is decision D1, not a clean-up.
2. **A suite written from a contract before the code is not yet proof; mutate it.** For 1.2 I made ten deliberate breakages of the implementation: six were caught as delivered, two survivors got new checks (an upload that lands while the cached copy is still being read; Refresh Now with the cached text), and two were left unpinned on purpose (a background poll replacing cached data; an extra "couldn't load" bar under the banner), because the harness clock could not tell the 10-minute data poll from the 5-minute app-update poll. A follow-up session has since pinned both in #174 (a new harness option aligns the fake clock so only the data poll's timer is reachable; its mutation runs fail exactly the new check for each), taking `Offline_Cache` to 40 (that PR is folded into #169 now). For 1.5 all nine breakages were caught. For 1.3, each of its two real checks has a build it fails (94 px without the fix; 1248 px when only the `sm:` half is dropped).
3. **Visual review finds what headless checks cannot.** A separate visual pass over 1.1 found that a 300-character uploaded file name pushed "modified ..." out of view; fixed in #168 with a truncating span and a check that fails without the fix. It also measured that a banner arriving after load pushed the table 38 px past a 768 px window, which #169 fixes by making the table-height observer watch the whole banner stack.
4. **A label that changes while `aria-expanded` changes is announced twice.** The first 1.5 build turned "Details" into "Hide details"; the contract kept the label constant and let `aria-expanded` carry the state, which is also the better screen-reader pattern. The app was changed, not the check.
5. **The regression runner now pins a count per target.** `main` is 325; `testing-2.5` grows by each slice. A testing build with no row in the runner's `TARGETS` table is an error, never a quiet fall back to `main`. Promoting 2.5 to production means moving its pin into the `main` row and dropping the target gate; `HANDOFF.md` has the steps.
6. **A review that runs nothing has to have its findings checked, and the checking found a false alarm.** A code review of the whole stack (2026-10-06) returned ten findings. The lead read the code behind each: nine were real and one was not (a "(blank)" Analyze card cannot exist, because blank groups are filtered out of the cards), and two claims of the form "this check can pass vacuously" were settled by running the mutant, not by reading. Five were fixed with a check each, every check proven against a build with its fix removed: a poll no longer replaces the cached copy under an open historical or Compare view (1.2); a failed Refresh Now says so inside the cached banner (1.2); a test now pins that setting "Offline copy" off means the cache is never opened to read (1.2); a clean load re-arms a dismissed data-check banner (1.5); and the Dismiss check now proves the problems were raised (1.5). Two were documented as known gaps (the cache is only requested by the initial-load effect; the stamp is set when a fetch succeeds) and two went to Kevin as design questions. Both design questions are now answered (Q1 and Q2 below). The stamp gap was closed by PR #178 (Q2); the cache-request gap and a second gap found since (the whole-dashboard render per direct poll) are being fixed (see "Known gaps" below). Full table: `docs/CHECK_HISTORY.md`, "code review of the 2.5 stack".

**Not verified.** Everything here is client-side and checked in headless Chromium against fakes. Not confirmed: IndexedDB inside the real Apps Script iframe; the real feed staying silent under the data check over several production days (rows 11 and 12 of the new checklist in `apps-script/README.md`); the stamp on Apple and Windows fonts and emoji and in Firefox and WebKit (a follow-up session measured Selawik, Roboto, Liberation and DejaVu in Chromium on Linux: the masthead gains exactly one row in every font and state, +32 px at 360 and 390 px and +16 px at 700 and 1366 px, with no clipping; the "⚠" is drawn as a flat amber glyph or as an untinted colour emoji depending on the installed fonts, the amber text carries the stale signal either way, and no change is recommended; details in #168's description); browsers other than Chromium.

**Open for Kevin** (none blocks work). **Every item below was answered on 2026-10-06; Kevin accepted every recommendation.** Answered items are kept, with the answer, so the history of the question stays readable. The only things still open are the ones the earlier sections list for Kevin and that this round did not touch (D2-D8, the 2.3 and 3.3 spec questions, the 2.5 design-note questions).

| # | Question (as asked) | Answer, 2026-10-06 |
|---|---|---|
| Q1 | Should the 1.5 row-count baseline keep moving after a flagged load (as built), or should a separate "last healthy row count" guard only the cache? | **Answered by Kevin (#185): a separate saved-copy baseline.** The banner keeps the rolling baseline and warns once; the offline copy is judged against the last saved load's row count, and a real change of size is accepted after 3 steady loads (`docs/CHECK_HISTORY.md`, "Kevin's decisions on Show in table and the offline-copy baseline"). The follow-up round adds the real row count to the banner's baseline. |
| Q2 | Should the 1.1 stamp mean "fetched" (as built) or "on screen since"? | **Answered: kept as PR #178 made it.** PR #178 (another session) already changed the stamp so that it moves only when fetched data is applied to the screen (or when the fetched text equals what is already on screen). A fetch that is discarded no longer moves it. |
| Q3 | #173 (1.4 "Show in table"): (a) what the button clears; (b) whether it closes the Analyze window; (c) focus afterwards. | **Answered by Kevin (#185):** (a) the button keeps every other slicer and header filter, sets the group's slicer and sets Sale Week to the window's weeks (**changed by Kevin later on 2026-10-06: Sale Week is left alone**, the table keeps the reader's own Sale Week selection); one Undo restores the state before the first press. (b) The window stays open on desktop and closes below 640 px. (c) On a phone focus goes to Undo; on desktop it stays on the button. Separately, focus now returns to the opener whenever a dialog closes, in production and 2.5 (follow-up round). |
| Q4 | Is the stale-stamp factor of 2 right? | **Answered: keep 2.** PR #163/#176's `refreshIntervalMs` and `refreshIntervalMsAtFetch` now give the real interval the app was using when it fetched, so the factor multiplies the real interval instead of a constant. |
| Q5 | Put a compiled `dist/`-style copy of the 2.5 build in front of users? | **Answered: not now.** The existing build (`scripts/build_deployable.js`) covers it once 2.5 is promoted. Until then it needs a local static server. |
| Q6 | Should #162 and #167 (production-file fixes from another session) also go to the 2.5 build? | **Answered: yes. Done in #178.** Two more production fixes, #180 (Historical popover) and #181 (Settings popover cap), are being ported to 2.5 or confirmed as already covered there now. |
| Q7 | PR #172 (features only in the testing build, fixes in production and ported)? | **Answered: merged.** |

### Since the stack was built (2026-10-06)

**PR #178 and what it changed.** Another session ported #162 and #167 into the 2.5 build and changed the 1.1 stamp (Q2). It also added the Undo bar after "Show in table" clears slicers (Q3a) and the `ROW_COUNT_JUMP` data-check problem (Q1).

**How it landed.** The whole stack (#165 to #173, with #178 on top, main's #180 and #181 ported into 2.5 verbatim) landed on `main` in one PR, #184, after a full local gate on the landing tree. A follow-up PR (the 2026-10-06 follow-up round) then carried the fixes below. Pins after it and #185, both from real runs: `main` **356**, `testing-2.5` **516** (see `docs/TESTING.md`, "Current counts").

**Known gaps from the 2.5 review (numbered as in its gap list; the table is in `docs/CHECK_HISTORY.md`, "code review of the 2.5 stack"):**

- **Gap 3, the 1.2 cache was only requested by the initial-load effect. Fixed.** Every live load that fails with nothing on screen asks for the copy, at most once per page load; `Offline_Cache` +6, every new check proven against a build without the fix. One narrower case stays open and documented in CODE_NOTES (a fast-failing poll during a slow but successful first fetch keeps the cached banner up to the next poll).
- **Gap 7, the 1.1 stamp re-rendering the dashboard on every direct poll. Measured, no change needed:** 2 renders per unchanged poll with the stamp and 2 without it (and 2 in production); the stamp's update lands in the same React batch.
- **Side point, the "NO N.A. CALL" filter. Tested and fixed.** The POL column cannot be hidden, but the filter that card sets followed the reader to tabs with no POL column (Booking Flash: 6 of 467 rows, nothing on screen naming the filter). Leaving the tab now puts the POL filter back to what it was before the button, when the button changed it and it still holds the button's value. The same reach exists for a POL value typed by hand, in production too; that is a separate product question, not fixed here.
- **Q3c, focus after a close. Done** in production and 2.5 (`Focus_Return`, 8 checks on both targets). "Show in table" follows Kevin's #185: on a phone focus goes to Undo, on desktop it stays on the button.

**A second code review, of `shared/` (2026-10-06).** A review of `BFShared.diffSailings`, `BFShared.checkFeed` and the view codec found nine issues; all nine are fixed in `shared/`, each with a check that fails without its fix (an independent reviewer reverted 12 fixes one at a time and every one was caught):

1. All-null totals were reported as 0: now `null`.
2. `decodeView` accepted unknown header-filter keys: now dropped, against the app's 68 real keys.
3. `bookingConflict` compared floats with strict equality: now the change test's noise floor.
4. `movedTeu = 0` counted zero laden deltas as moves: no longer.
5. An empty `keyColumns` / `voyageFields` list silently disabled a check: now `BAD_INPUT`, default list used.
6. `ROW_COUNT_DROP` compared raw rows only: a real-row comparison (`REAL_ROW_COUNT_DROP` / `_JUMP`) now runs too, and the 2.5 app stores and passes the real count.
7. Whitespace-only header filters were encoded: now dropped on both sides.
8. `bookingConflicts` was lost when one of the two days was missing: now collected.
9. `checkFeed_scanRows` allocated per row: now lazily, heap growth per 10,000-row check down 81-84%, output unchanged.

The headless behaviour check now runs **511** assertions (it was 490), recounted by the check itself.

Full local gate on the follow-up branch: @@GATE_RESULT@@

### Phase 0 — Foundations (nothing user-visible)

| ID | Slice | Owner(s) | Size | Depends | Acceptance |
|---|---|---|---|---|---|
| 0.1 | **Step A: single app-file resolver** — `pickCurrentAppHtml` fails on ties; `scripts/print_app_file.js`; guard check blocks new copies; docs updated. **Done, in review as PR #155.** | R1 (merge), R5 | S | — | Full gate green incl. browser suites; PR merged |
| 0.2 | **Done / in review (PR #157, one PR with 0.3).** Shared-logic pipeline (per D1a): `shared/` directory, `scripts/sync_shared.js` (+`--check`), generated region in the app HTML, generated copy for Apps Script, CI job, guard-check extension (as built, the copy guard lives in `tests/check_shared_sync.js` section E, not in `tests/check_resolve_app_html.js`), README note (as built, `apps-script/README.md`'s deploy steps did not list `Shared.gs`; added by the review-fix PR on top of #169) | R2 script, R5 CI and guard check, R1 inserts markers once | M | D1 (decided: a), 0.1 | Editing a shared function and re-running sync changes both copies; CI fails when a copy is stale (same pattern as `dist/` staleness). Built in wave 1; the comment rule it had to enforce is in section 7 |
| 0.3 | **Done / in review (PR #157, same PR as 0.2).** Fixtures, **without new committed copies**: headless checks read the already-committed 9-day CSV directly and slice it by `Record Date` in code. R4 delivers a small slicing helper plus a README of expected values (source file, RFC 4180 row counts, how to regenerate) for: a **Monday-rollover pair** (2026-08-30→08-31; at sailing level 24 VVDs out, all sale week W29, and 23 in, sale week W46; row counts 61 and 58), a weekday pair (08-27→08-28) and a 5-day persistence set. The existing committed fixture covers only 3 days and has no rollover. Commit ONE trimmed 5-day window (2026-08-27→08-31, 3,682,565 bytes, about 3.7 MB, containing all three) **only if** a browser regression test needs real files. An earlier draft planned separate 2-day, 2-day and 5-day copies: 6,627,083 bytes, as large as the whole committed 9-day CSV (6,577,860 bytes) | R4 | S | — | Helper and README committed; the README's expected values reproduced by a headless check (wired per ground rule 5) reading the 9-day CSV. If the 5-day window is committed, its README states provenance and regeneration. **Delivered:** the helper and reference oracles in `tests/lib/history_days.js` (`diffVvds`, `classifyDisappearances`, `classifyArrivals`, `unownedStreaks`, `ladenOverMax`, `ladenChangeByDaysToCutoff`, `compactIndexRows`), the expected values pinned in `tests/check_history_days.js`, and the README `tests/fixtures/HISTORICAL_EXPECTED_VALUES.md`. R4 re-derived every number of this plan with its own parser; all matched except where this document says otherwise |
| 0.4 | Archive cleanup (per D6): `git mv` unreferenced root files to `archive/` with an index README; fix stale "~10,800 lines" statements (script is 14,183 lines) | R7 | S | 0.1 merged, D6 | `node scripts/run_ci_locally.js --fast` unchanged; no file referenced by tests/docs was moved |
| 0.5 | **Done / in review (PR #156, this PR): `docs/DECISIONS.md`.** Decision pack: R4 confirms D2 candidates by reading `DATA_ARCHITECTURE.md` and the reference workbook and writes the D2 answer text; R7 lands it in `DATA_ARCHITECTURE.md` and sends the open decisions D2–D8 to Kevin (D1 is done) | R4, R7 | S | — | Written answers recorded in `docs/DECISIONS.md` (D1 entry copied from **Decisions recorded**). Delivered as the answer sheet with evidence and defaults; the pack records no D2 answer text because the repo holds no answer, only evidence (see D2 in section 3). Answers to D2-D8 are still Kevin's |

### Phase 1 — Trust and quick wins (§5 and small §4/§6 items)

| ID | Slice | Owner(s) | Size | Depends | Notes / acceptance |
|---|---|---|---|---|---|
| 1.1 | **Built (wave 3) in the 2.5 testing build: PR #168. MOVED 2026-10-08 from the masthead into the Settings panel (D34, per Kevin: "just move it into settings"); read "masthead row" below as "line in Settings".** **"Data as of" stamp: finish what already exists.** An earlier draft said the server must be changed to return `fetchedAt` from `getDataFeed`. It already does: `apps-script/DataFeeds.gs` puts `fetchedAt` and `ageMs` in every reply (`feedReply_`, and the data-free reply built from the cached meta), the app stores it (`setDataFeedInfo({via: 'server', fetchedAt: …})`), and the settings panel already shows "Data: shared server copy (downloaded <time>)" (a time of day with no date, and only in Settings). The real gaps: **(a)** the direct-download fallback sets `fetchedAt: null`, so that path has no timestamp: `noteDirectFeedText` already records `directAt = Date.now()` when the download finishes and nothing ever shows it, so stamping the client's own download time needs no server change; **(b)** manual uploads should show `File.lastModified`; **(c)** `fetchedAt` is when the *server* downloaded the export, not when the source Sheet last changed, so the label must say "fetched"/"downloaded", never "updated". Measured on 2026-10-05 (R3, headers of the published live CSV): it sends **no `Last-Modified` and no `ETag`**, so "data as of" is unknowable on both the server path and the direct path; only "downloaded at" is available. `fetchedAt` also advances at every refresh even when the content is identical. A server-side `changedAt`, carried over while the content hash is unchanged, would be a cheap and more honest improvement ("last changed as we saw it"); it is a server edit, so it waits for D8 (question 9 of the 2.5 design note); **(d)** there is no age warning yet. Label examples: `Live feed · fetched 10:30 AM (16 min ago)` / `Uploaded file · modified <File.lastModified>` / `Historical · <date>`. Amber when age > 2× the feed interval (30 min business hours, 60 off-hours, the values of `DATA_FEED_BUSY_INTERVAL_MS_` / `DATA_FEED_QUIET_INTERVAL_MS_` in `DataFeeds.gs`; the 2× multiplier is a starting guess, **UNCONFIRMED**, tune later). Prefer the reply's `ageMs` over comparing the server's timestamp with the browser clock; the app stores `fetchedAt` but today discards `ageMs`, so keeping it is a client change. Both clocks shown: when fetched, and existing "Last Refresh" (when applied). | R1, R6 copy; R3 only for the optional `changedAt` | S | 0.2 | Mostly client-side. No separate PROD item for `fetchedAt` itself (it is already in `DataFeeds.gs`); item (a) no longer needs a server change, so only the optional `changedAt` would need a production check. Headless: formatter pure function in `shared/`, tested across timezones |
| 1.2 | **Built (wave 3) in the 2.5 testing build: PR #169.** **Last-good CSV cache.** IndexedDB stores raw CSV *text* (0.73 MB; parsed JSON would be 3.42 MB), replayed through the same parser; visible banner "Showing cached data from …"; cache never replaces data fresher than it (reuse the `directAt` / `notOlderThanMs` idea); every storage call try/catch (sandboxed iframes can block it; the app already probes `unwritable`) | R1, R5 test | M | 0.2 | Browser test: abort the feed route, reload, expect cached rows + banner; second test: fresh data wins over cache. **PROD**: IndexedDB availability inside the Apps Script iframe |
| 1.3 | **Phone overlap fix.** **Done / in review in the 2.5 testing build: PR #171** (wave 3). The same change was first made in the main file as PR #159, which has no automated check and stays open as the production copy (Kevin's decision, 2026-10-05); #171 is its testing-build port. Gate: 427 of 427 on the 2.5 target, 325 of 325 on the main source file and `dist/`. The new `Phone_Layout` suite measures the box: 358 px wide at 390 px (94 px with the fix reverted) and 984 px at 1280 px. At 390 px the "Clear Filters" button overlaps slicer chips (VC, EC) and the Fields panel overlaps slicers. CSS only, no layout redesign. **Root cause (measured, wave 1):** the slicer box is `flex-1` with `min-w-0` next to a 256 px, content-sized Fields column, so at 390 px the box is squeezed to 94 px and its content overflows under that column. **Fix:** one class change on the slicer box, adding `basis-full sm:basis-[0%]` to its `className`. **Side effect:** between 600 and 639 px the layout now stacks where it used to sit side by side. **Follow-up, not a slice yet and not investigated:** in dark mode the unselected macro buttons are light grey on light grey (pre-existing) | R1, R6 screenshots | S | — | Before/after screenshots at 390, 700, 1366 px; table width unchanged (3,652 px). **Result:** desktop is pixel-identical (0 differing pixels at 700 and 1366 px; all 11,381 element rects equal); source regression 325/325. The evidence (screenshots, rect comparison) is in the wave-1 session's scratchpad, not in the repo; the PR will carry it |
| 1.4 | **"Show in table"** on an expanded Analyze group: calls existing slicer setters (`setSelectedLanes`, …) and closes the modal | R1, R5 | S | — | Regression check per tab; works from Booking Flash and POL tabs **Built in the main file in wave 2 (PR #160, now closed) and rebuilt in the 2.5 testing build in wave 3: PR #173.** Lane slicer on the lane tabs, the **Yard** slicer on POL Booking Flash, the POL header filter for the "NO N.A. CALL" card; +5 live checks, gated to the 2.5 target (427 to 432; `main` stays 325). Three design questions for Kevin were in the PR; answered 2026-10-06: keep clearing every slicer then setting lane/POL (the Undo bar from #178 lowers the risk), keep closing the Analyze window, and restore focus after any Close button closes a modal (implemented across all Close buttons, a production fix ported to 2.5). |
| 1.5 | **Banner built (wave 3) in the 2.5 testing build: PR #170** (the logic is `BFShared.checkFeed`, PR #161). **Schema + row-count canary.** `checkFeed(headers, rows, prevRowCount)`: expected columns present (alias landmine guard), key unique, voyage-level fields consistent, row count within ±10% of previous load. Silent when fine; one banner when it fails | R2 logic, R1 banner | M | 0.2, 0.3 | Headless tests with deliberately broken fixtures (renamed column, duplicated key, halved rows); on real fixtures it stays silent **Logic built (wave 2): `BFShared.checkFeed`, PR #161.** Silent on all nine real days and on a same-day live export; the banner (R1) is not built. **Decision 2026-10-06:** the banner's row-count baseline stays rolling (Q1); known trade-off, and PR #178's `ROW_COUNT_JUMP` means the good load after a truncated one is flagged and not cached until the data changes again. |

### Phase 2 — "What changed since yesterday" (§1)

| ID | Slice | Owner(s) | Size | Depends | Notes / acceptance |
|---|---|---|---|---|---|
| 2.1 | `diffSailings(prevRows, curRows)` in `shared/`: sailing-level (never row-level) join on VVD, classify **new / rolled-in / rolled-out / removed / changed**, per-sailing laden and utilisation delta; VMS placeholders excluded. **Class rule (PROPOSED, to be confirmed against the fixtures by R4):** *rolled-out* = the sailing's sale week no longer appears anywhere in today's data; *removed* = the sailing disappeared while its sale week is still present (a mid-window disappearance; an earlier draft had no class for it); *rolled-in* = the sailing's sale week did not appear anywhere in yesterday's data; *new* = a sailing absent yesterday whose sale week was already present. **Two wave-1 refinements (R4):** the Past-4-Week flag alone must not decide *rolled-out* (on 08-24→08-25, 4 of the 21 vanished sailings are flagged Y but no sale week left the window, so they are removals), and "the sailing's sale week" is the sale week **from the day the sailing was last seen**, because a VVD's sale week can change while the VVD stays (9 such sailing-day changes in the 9 days). A quick check of this rule on the 9-day CSV (to be re-derived by R4 in the 0.3 README): on 2026-08-30→08-31 it gives 24 rolled-out and 23 rolled-in; on every other day pair it gives 0 of each. Removals: 21 VVDs / 60 rows on 08-24→08-25 (a Tuesday; sale weeks W29–W45, 48 of those rows flagged Past-4-Week N and 12 Y, mostly lane FLX; 17 of the 20 sailings that were blank-PIC on 08-24 are among them), 5 VVDs / 10 rows on 08-27→08-28 (all flagged N), 1 on each of three other pairs, 0 on the remaining three. New VVDs per consecutive pair (08-24→08-25 through 08-31→09-01) are 2, 1, 0, 2, 1, 0, 23, 2: the 23 are the rollover, and two of the eight mid-window arrivals (`PNAT2639S` on 08-29, `YWMT0002W` on 09-01) look like VMS-to-real nominations (inferred from lane and sale week, **UNCONFIRMED**), which matters for the "newly nominated" wording in 2.3. **"Removed" is the signal most worth surfacing in the daily summary (2.3)**: unlike a Monday roll it is unexpected. A sailing can also leave and return: `CGBT0016E` was W45 on 08-24 to 08-27, absent 08-28 to 08-30, and came back as W46 with its cut-off moved from 10/21 to 10/27. **Only history sees this; a one-day diff cannot**, so 2.1 does not claim to (it belongs to 2.5 and 3.1). Reference values and the oracles: see "Wave-1 detail for 2.1" below the table. | R2 | M | 0.2, 0.3 | Tests at **sailing level** on the rollover pair (2026-08-30→08-31): 24 VVDs classify as rolled-out (61 rows, all sale week W29, all flagged Past-4-Week = Y) and 23 as rolled-in (58 rows, sale week W46), and no rolled-in sailing is counted as new demand by the roll itself. **The rolled-in sailings are not empty:** on 08-31 the 23 carry 100 TEU of booking and 136 TEU of laden, so the acceptance is "classified rolled-in, excluded from the new-demand figures", not "0 new bookings" (an earlier draft said 0 sailings are counted as new or as changed-because-of-new-bookings by the roll itself, which reads as empty sailings). An earlier draft stated this as row counts (61 out, 58 in) while requiring a sailing-level join; the row counts are kept only as reference. Mid-window tests: 08-24→08-25 gives 21 removed and 0 rolled-out; 08-27→08-28 gives 5 removed. **Double-count guard:** a test where two port rows of one VVD carry the same `Total Booking TEU by Service` must count the sailing once (a naive row sum of that column gives -66,089 TEU on the rollover where the sailing-level net is -23,927). An earlier draft cited a row-level "+10,846 TEU" total; R4 could not reproduce that exact figure (nearest: a row-level delta of +10,842 on 08-31→09-01, against +3,968 at sailing level), but the double-count mechanism is confirmed. **R2's implementation must reproduce the reference oracles** in `tests/lib/history_days.js` (`diffVvds`, `classifyDisappearances`, `classifyArrivals`) and the values pinned in `tests/check_history_days.js` (README: `tests/fixtures/HISTORICAL_EXPECTED_VALUES.md`) **Built (wave 2): `BFShared.diffSailings`, PR #161.** It reproduces the oracles on all eight day-pairs (rollover 24 out / 23 in; laden net -24,681; booking net -23,927). |
| 2.2 | Previous-archive-date loader in the app: use the existing per-day archive index; fetch only the previous *available* date (not "yesterday" — Mondays); hide the feature when the archive is unavailable (basic build) | R1, R3 verify (R3 builds `fetchedDate`) | M | 2.1 | **PROD**: archive path via `google.script.run`. Basic build must show nothing and break nothing (`tests/check_basic_build.js`). **Wave-1 finding (design note section 5): the server side already suffices** (`getArchiveIndex` and `getArchiveDayCsv`; "previous available date" = the greatest index date below the as-of date, with no calendar logic). **The client gaps:** (1) there is **no as-of date** for the live data: the live export has no `Record Date` and `getDataFeed` returns only an ISO instant, so add `fetchedDate` (a date in the script's time zone) to its reply, a small additive server change that needs D8 and a production check. **Review finding (2026-10-05):** `fetchedDate` is the date the copy was *downloaded*, and the download repeats even when the content is unchanged, so on a weekend or early morning it names a later day than the data; 2.2 must use `changedDate` (the date the content last changed, added to the same replies by the review-fix PR on top of #163) as the as-of date; (2) the per-day path is reachable only after `fetchHistoricalData`, which falls back to the 15.9 MB single Sheet and must never run at startup, so 2.2 needs **its own small loader** (index, day fetch, parse, own cache) that never falls back; (3) a day arrives as plain text (about 0.73 MB, no gzip, no have/unchanged reply), and the parse cache is cleared on every index refresh, so each page load pays again (optional server improvement: let `getArchiveDayCsv` take `gzip`/`have` like `getDataFeed`). Size stays M; not re-estimated |
| 2.3 | **What-changed summary** in the "New data available" banner and a Settings-togglable header line: "12 sailings moved >100 TEU · 2 newly nominated · 3 removed · 1 lane down". **Removed sailings are always listed** (see 2.1: the signal most worth surfacing, and never folded into "No material change"); a day with nothing in any class, typically a weekend, → "No material change" | R1, R6 | M | 2.1, 2.2 | Threshold values in the config Sheet (R3 adds keys, defaults in code). **Spec written in wave 1: [`docs/specs/2.3-what-changed-banner.md`](specs/2.3-what-changed-banner.md); its seven questions for Kevin (K1-K7) are open.** Where the spec departs from this row: **K1** recommends a *separate* dismissible banner rather than a summary inside "New data available" (with Auto-Refresh on, the default, the blue banner is on screen only briefly and describes data not yet loaded). Others: K2 day one with no earlier archive day, K3 a Monday rollover is a muted clause and never "removed", K4 thresholds (100 TEU "moved"; "lane down" is undefined, suggested at a laden drop of 5% or more; config Sheet keys with in-code defaults), K5 default mode Banner/Line/Off, K6 wording of "newly nominated", K7 local-only setting. **Correction needed in the spec:** its example copy and K3 use the row counts "61 out, 58 in" as if they were sailings; at sailing level the rollover is 24 out and 23 in (see 2.1) |
| 2.4 | **Δ column** (off by default) on Booking Flash and POL tabs; opens Compare pre-filled with the two dates on click | R1 | L | 2.3 | **Check 5 required** (`perf_highlight_benchmark.js`, source and `dist/`); budget must not regress beyond the documented tolerance |
| 2.5 | **History index** (enabler for sparklines, persistence, retention): Apps Script daily job (same time-trigger pattern as `installDataFeedTrigger`) reads the archive and appends one compact JSON row per (VVD, POL, day): `[vvd, pol, day, laden, booking, POL utilisation, cut-off, pic-blank flag]`. **Design note written in wave 1: [`docs/specs/2.5-history-index-design.md`](specs/2.5-history-index-design.md) (R3; design only, nothing built).** What it adds to or corrects in this row: **(1) No lane.** The row has none, but 3.3 (blank-PIC-OK lanes) and 5.2 (per lane) need one; adding it costs +12.5% cells and +9.4% gzipped, and the note recommends 9 columns. **(2) Size, measured** on the 9-day CSV (8,136 non-VMS rows): **542,761 bytes raw, 97,145 gzipped, i.e. about 900 rows and about 57.5-60 KB/day raw, about 10.8 KB/day gzipped.** The raw figure depends on the serialisation: 542,761 reproduces exactly only with string values, an ISO day, the raw `M/D/YYYY` cut-off and a 0/1 flag; the note's other serialisations give 435,944 to 574,515 B raw (517,256 for flat JSON with numbers as numbers), while gzipped it is about 97 KB either way (97,145 here, 96,878 in the note). An earlier draft said "few KB/day"; that understated the raw size by roughly 10-20 times. **(3) Read columns by header name.** Today's live export has 99 columns and the archive's 97: two were inserted at 0-based indexes 33-34 (columns 34-35 counting from 1), moving the 64 columns after them (measured on a live export fetched 2026-10-05 that is not committed; the committed workbook has 97 headers and the 9-day CSV 98 with `Record Date`), so a positional reader would read the wrong measures without an error. **(4) Cut-off formats differ:** the CSV's is `M/D/YYYY`; in today's live export the POL cut-off is a year-less `Mon D` on 734 of 890 rows while the sailing-level cut-off is ISO. Year-hint parsing therefore belongs in `shared/` (R2), not hand-copied into Apps Script. **(5) `booking`** is `Measures Total Booking TEU by Service`: sailing-level (identical on every port row, never summed across them, see the 2.1 double-count guard) and not read by the app today; Kevin confirms the column (note question 2). **(6) Store: recommended, not decided.** A dedicated History Sheet (one data tab per month plus a one-row-per-day ledger tab), written by a separate hourly job and read through one cached `google.script.run` call that replies "unchanged" (about 141 B) when the browser already has the version; the script cache is the read path only, never the store. **Google's documented caps** (fetched 2026-10-05 with a summarising tool; the note lists the URLs to re-check): Sheets 20 million cells or 100 MB per spreadsheet (budget against this repo's 10 million, `Code.gs:325`, until the account's real cap is known: **UNCONFIRMED**); script cache 100 KB per value, 1,000 items, at most 6 h TTL; `PropertiesService` 500 KB per store and 9 KB per value, so **script properties are unsuitable** (raw rows would fill them in about 8 days), and the script cache limits that an earlier draft marked UNCONFIRMED are now documented. The note recommends keeping 365 days and serving 30 (5.2 needs at least 8 weeks); its ten ranked open questions are in its section 9, D8 first | R3 | L | D8 | **PROD**: trigger runs as installer. **Size/quota acceptance, part one (the design note) is met by the wave-1 note:** it names the store, its documented quota and the footprint at 90 and 365 days (8-column row: about 5.2 MB and 21.0 MB raw, 0.97 MB and 3.9 MB gzipped; this plan's earlier 5.4 MB, 22 MB, 1.0 MB and 3.9 MB are the same figures at 60 KB/day). **Part two waits for the build:** the backfill lands inside that quota and its row count is reported. An earlier draft had the backfill read the 9-day CSV; the server cannot read the repo, so production backfill reads the archive folder (its depth is recorded by step 1 of the note's checklist) and the CSV is the local test fixture, whose count of 8,136 rows is the figure to report there. The note's production checklist (section 8) needs the person named under D8 |
| 2.6 | **Sparklines** in rows from the history index (lazy-loaded, toggle) | R1, R6 | M | 2.5, 2.4 | Check 5 again; no extra per-day archive fetches |

**Wave-1 detail for 2.1 (measured by R4 with its own RFC 4180 parser; every number the plan already had matched except where 2.1 says otherwise).**
Reference values for the rollover pair 2026-08-30→08-31, **at sailing level** (net = rolled in − rolled out + continuing):

| Measure | Rolled out (24 VVDs) | Rolled in (23 VVDs) | Continuing sailings | Net change |
|---|---|---|---|---|
| Booking TEU (`Measures Total Booking TEU by Service`) | 25,287 | 100 | +1,260 | −23,927 (a naive row sum gives −66,089: the double-count) |
| Laden TEU | 26,065 | 136 | +1,248 | −24,681 |

`Measures Total Booking TEU by Service` is sailing-level: identical on every port row of a sailing, so day totals summed over rows are about
2.6 times too high (766,070 against 298,813 on 08-30). The oracles that pin all of the above are `diffVvds`, `classifyDisappearances`
and `classifyArrivals` in `tests/lib/history_days.js`, with expected values in `tests/check_history_days.js` (README:
`tests/fixtures/HISTORICAL_EXPECTED_VALUES.md`); 2.1 must reproduce them. History-only cases (a sailing that leaves and returns, such as
`CGBT0016E`) are not 2.1's to detect; the unowned-streak and index oracles (`unownedStreaks`, `compactIndexRows`) serve 3.1 and 2.5.

### Phase 3 — Exception-first (§2)

| ID | Slice | Owner(s) | Size | Depends | Notes / acceptance |
|---|---|---|---|---|---|
| 3.1 | `findExceptions(sailingsToday, history, config)` in `shared/`: (a) **unowned ≥ N days**: a sailing counts for a day when ALL its port rows have a blank `MCT PIC` (default: blank on both halves of the `SPC / MKG` pair; whether a half-TBA PIC counts is an open question under D4), and it is an exception after N consecutive such days. On the 9-day data this is 3 sailings as of 2026-08-31 (2 as of 2026-09-01), not the 96 blank-PIC rows (non-VMS rows over the 9 days), because 17 of the 20 sailings that were blank on 8/24 left the window (see "removed" in 2.1; the 17 are all on lane FLX); (b) **over threshold ≥ N days, lead-time aware** (an over-threshold sailing 1 day from cut-off will probably self-correct; 14 days out will not). The baseline for this rule is **unconfirmed until D2 is answered**: the thresholds vary per row (see D2). (c) nominated sailing with no cut-off | R2 | M | 0.2, 0.3, 2.5, D2, D3 | **Fixture test, with the as-of date and N stated** (an earlier draft named three sailings with neither, and the answer depends on both). Reading the committed 9-day CSV with N = 3 consecutive days: **as of 2026-08-31, exactly `GJMT0003W`, `HTET1002W`, `WAHT0613W` (8 days each); as of 2026-09-01, `HTET1002W` and `WAHT0613W` (9 days each)**, because `GJMT0003W` gets PIC `TBA / Bob` on 09-01 (`WKPT6240E` reaches only 2 days, below N). 239 rows across 28 sailings contain `TBA` in either half (D4; 384 rows across 29 sailings if the VMS placeholder rows are counted). The oracle is `unownedStreaks` in `tests/lib/history_days.js` (pinned in `tests/check_history_days.js`). **Wave-1 caveats (tables below the slice table):** N cannot be chosen from 9 days, and all three persistent sailings sit on the lanes D4 asks about, so if D4 says blank PIC is normal on EXE/EXW, rule (a) has almost nothing to show on this data. Rule (b): a flat rule on `Measures POL Booking Utilz` > 1.0 would flag 613 of the 8,136 non-VMS rows over the 9 days (about 68 a day; an earlier summary wrongly said "613 rows a day") and is explicitly **not** implemented; utilisation above the row's own `MCT Loading Threshold` holds on 1,002 rows, more than the flat rule's 613 (see D2), which is one reason D2 gates this rule. Depends on 2.5 (L, PROD, gated on D8), D2 and D3, **not** on 2.1–2.4 |
| 3.2 | Config keys (N days, thresholds, blank-PIC-OK lanes) read from the config Sheet via `readAppConfig_` | R3 | S | D4 | Code falls back to defaults when the Sheet is unreachable |
| 3.3 | **Worklist panel**: collapsed by default, count badge, each row a click-through filter; excludes lanes marked blank-PIC-OK | R1, R6 | M | 3.1, 3.2 | Panel renders nothing when empty. Regression tests incl. filter click-through. **Spec written in wave 1: [`docs/specs/3.3-worklist-panel.md`](specs/3.3-worklist-panel.md); its nine questions for Kevin (K1-K9) are open** (default on or off, what "N days" counts, what "threshold" means, whether "no cut-off" carries a day count, scope all or mine, click-through replaces or adds filters, sort and grouping, snooze, and what to show when history is unavailable). The spec's K3 repeats the earlier draft's "1.2 in sampled rows" for the thresholds; they vary per row (see D2). 3.3 (and 5.2) need a lane, which the history row lacks; see 2.5, item 1 |
| 3.4 | Calibration review after two weeks of use: R4 reports how many items per day the panel showed and how many were acted on (notes written / PIC set) | R4 | S | 3.3 live | Target: a handful of items/day. If more than ~10/day, raise N or tighten rules before adding anything |

**Wave-1 detail for 3.1, D3 and D4 (measured by R4 on the 9-day CSV, helper `unownedStreaks`).** Sailings that reach an unowned streak of N days at any point:

| N (consecutive unowned days) | 1 | 2 | 3 to 8 | 9 |
|---|---|---|---|---|
| Sailings that reach it | 22 | 4 | 3 | 2 |

The 9 days therefore cannot choose between N = 3 and N = 8; only the two-week recalibration (3.4) can. Where the unowned sailings are:

| Group | Lane breakdown |
|---|---|
| Blank-PIC rows (96, non-VMS) | FLX 51, EXW 27, EXE 8, INE 8, ANG 2 (an earlier draft guessed EXW/EXE; FLX is the largest) |
| The 17 blank-PIC sailings that vanished from the window | all on lane FLX |
| The 3 persistent unowned sailings | `GJMT0003W` on EXE, `HTET1002W` and `WAHT0613W` on EXW |

"Laden > Max Laden" (126 rows, 32 pairs, 30 of them persisting) holds only with a guard that was not stated: `Max Laden` > 0. Without it the
figures are 228 rows, 58 pairs and 48 persisting; the extra 102 rows all have `Max Laden` = 0. The definitions of "pair" and "persisting" are
pinned by `ladenOverMax` in `tests/lib/history_days.js`. The count of such rows jumps at weekends: 6 to 7 a day on weekdays, then 30, 30 and 28 on
08-29 to 08-31, and back to 6 on 09-01. Any rule built on it must state the guard.

### Phase 4 — Sharing and workflow (§3)

| ID | Slice | Owner(s) | Size | Depends | Notes / acceptance |
|---|---|---|---|---|---|
| 4.1 | `encodeView(state)` / `decodeView(str, validSets)` in `shared/`: all `FilterPrefsStore` keys (`selectedSubTrades`, `Analysts`, `MktgAnalysts`, `Coasts`, `Lanes`, `SaleWeeks`, `Yards`, `ApStatuses`, `yardSearchText`, `headerFilters`) + tab + optional `date=`; stale values dropped **and reported**; relative sale-week form ("next 8 weeks") | R2 | M | 0.2 | Tests: round-trip every key; stale W29 dropped with a message; hostile input (script tags, huge arrays, wrong types) rejected by a key whitelist **Built (wave 2): `BFShared.encodeView` / `decodeView`, PR #161.** 330 assertions; the link format is `v1.<payload>.<check>` (see Wave 2 results). |
| 4.2 | Server: `injectSharedView_(html, e.parameter.view)` in `doGet`, mirroring `injectServerPrefs_`; JSON-encode and escape `</script>` | R3, R8 review | M | 4.1 | **PROD:** does `?view=` survive Google's sign-in redirect? **UNCONFIRMED.** Security review mandatory |
| 4.3 | Client: **Copy link** button; shared view applies for the session only and **never writes** `FilterPrefsStore`; banner with Use once / Save as mine / Dismiss; honours `date=` through the existing historical viewing path | R1, R6 | M | 4.2 | Test: recipient's saved filters are unchanged after opening a shared link |
| 4.4 | Notes step 1 (no schema change): `#followup` / `#done` convention → badge in table + filter chip (hashtag search already exists, commit `ed2006d`) | R1, R2 | S | — | Headless tests extend `tests/check_team_features_logic.js` |
| 4.5 | Notes step 2: per-user `lastSeen` in the private store; "3 new notes on your VVDs" badge (VVDs filtered by PIC) | R3, R1 | M | D4 | **PROD** (user properties) |
| 4.6 | Notes step 3 (optional, gated on D4): `Status / Owner / Due` columns after `Updated At`; mapping reads by position so older pages should ignore them (**UNCONFIRMED — test with an old page against the new Sheet**); invalidate the 1-hour notes cache on deploy | R3, R1 | L | D4 | One note per (VVD, author) limits this to one status per author per VVD; document it |
| 4.7 | Named saved views: `FilterPrefsStore` blob → dictionary (name → blob); team-view flag. A saved view is a link you keep | R1, R3 | M | 4.3 | Quota check before sizing; localStorage and server paths both tested |
| 4.8 | Morning brief email (last): time trigger, plain-text/HTML computed server-side from the **generated copy** of `diffSailings` + `findExceptions`, plus a link | R3, R8 | L | D5, 3.3 | A drift test already exists by construction (generated, `--check` in CI). **PROD** and recipient-privacy review |

### Phase 5 — Analysis (§4)

| ID | Slice | Owner(s) | Size | Depends | Notes |
|---|---|---|---|---|---|
| 5.1 | Compare two slices of one dataset (lane A vs B, week X vs Y): feed two row arrays to `compareKpiSnapshots`; label sides correctly (a past bug mislabeled sides) | R1, R6 | M | — | Extends `tests/check_compare_kpis.js` |
| 5.2 | **Retention-curve report**: `scripts/retention_curve.js` over the history index → per lane × lead-time median ratio of final laden to laden at that lead; prints, no UI. Run weekly. Needs a lane in the history row (2.5, item 1) | R4 | S | 2.5 | Gate for 5.4: stable across ≥ 8 weeks and **beats the naive "no change" baseline** in a held-out backtest (a straight-line pace lost to "no change" on 9 days: 45% vs 36% error, n=9, a warning not a result). **The accumulate / trim / freeze conclusion stands, but the exact bucket numbers depend on the method,** which is now documented and pinned (`ladenChangeByDaysToCutoff` in `tests/lib/history_days.js`, values in `tests/check_history_days.js`): key (VVD, POL); earlier-day laden > 0; cut-off taken from the earlier day's row; days to cut-off counted from the earlier day's Record Date; "falling" is below −0.5% and "flat" is within ±0.5%. With it the 0-2 day bucket is n = 165, median −6.94% (an earlier draft said n = 160, −7.2%); the other buckets reproduce. 5.2 should reuse this method so its numbers stay comparable |
| 5.3 | Data-driven **Export (data)** beside existing Export: stable column order, real numbers and dates, from `buildSnapshotRows` | R1, R5 | M | D7 | Old export untouched and a test pins its current output |
| 5.4 | "Typically lands at ~X% of today's figure" tile on sailings | R1, R6 | M | 5.2 passes, D2 | Not started until 5.2's gate is met and someone who owns the measure confirms why laden drops after cut-off (**hypothesis: bookings trimmed, UNCONFIRMED, and not testable on the 9-day data**: it shows that laden falls, not why) |

### Phase 6 — Usability and structure (opportunistic)

| ID | Slice | Owner(s) | Size | Notes |
|---|---|---|---|---|
| 6.1 | Small keyboard-shortcut set (tab switch, `?` help, `/` jump to filter); guard against typing in inputs and against the existing capture-phase Enter/Space handlers | R1 | S | Command palette only if users ask |
| 6.2 | Phone **Brief** view: what changed + worklist + KPI tiles only | R1, R6 | M | After 2.3 and 3.3 |
| 6.3 | Move other pure helpers into `shared/` so tests stop regex-extracting functions from HTML | R2, R1 | M | Do only helpers a test already extracts |
| 6.4 | **Spike (timeboxed, not committed):** can a multi-file source work with in-browser Babel and the Apps Script paste flow? `FlashReportDashboard` is 8,016 of 14,183 script lines, so a split moves ~6,100 lines and leaves the core intact | R8 research | S | Output is a written recommendation only |

---------------------------------------------------------------------------------------------------

## 5. Schedule and critical path

```
Wave 1 (parallel):   0.1 merge ─┬─ 0.2 pipeline (D1 decided 2026-10-05; starts now) ──┐
                     0.3 fixture helper + expected-values README ───────────────────┤
                     0.4 archive cleanup, 0.5 decision pack (D2–D8), 1.3 phone fix (R1 slot 1)
Wave 2 (parallel):   2.1 diffSailings · 1.5 canary · 4.1 encode/decode   (all R2: developed in
                     parallel, but each PR carries the regenerated shared region, so they
                     MERGE ONE AT A TIME through R1's queue)
                     2.5 history index (R3: storage-target design note first, then build; D8)
Wave 3 (R1 serial):  1.1 stamp → 1.2 cache → 1.4 drill-down → 1.5 banner → 2.2 → 2.3
Wave 4:              2.4 Δ column (R1, check 5)  ‖  3.1 exceptions logic (R2; needs 2.5, D2, D3)
                     and 3.2 config keys (R3; needs D4)  →  3.3 worklist (R1; needs 3.1, 3.2)
Wave 5:              4.2 server inject → 4.3 links → 4.4/4.5 notes → 4.7 saved views
Wave 6:              2.6 sparklines · 5.1 compare slices · 5.3 export-data · 6.x
Later / gated:       3.4 calibration · 4.6 notes schema · 4.8 brief · 5.2→5.4 forecast
```

**Status after wave 1 (2026-10-05).** Of the chart's Wave 1, 0.2, 0.3, 0.5 and 1.3 are done and in review (PRs pending), 0.1 still awaits its merge,
and 0.4 is blocked on D6. In Wave 2, the design note for 2.5 is written (build waits on D8); 2.1, 1.5 and 4.1 can start once the pipeline PR merges.
The chart itself is unchanged. See "Wave 1 results" in section 4.

**Status after wave 2 (2026-10-05).** Wave 2 is built and in review: 2.1, 4.1 and 1.4 are done, the logic of 1.5 is done (its banner is not), and the behaviour check for `shared/` is in place (PRs #158 to #161). Nothing is merged, so Phase 0 is still waiting on Kevin to merge #155 to #157. See "Wave 2 results" in section 4.

**Status after wave 3 (2026-10-06).** Wave 3 is built (1.1 to 1.5 in the 2.5 testing build), Kevin has answered the open questions on it, and the open PRs are being integrated into one branch (`claude/integrate-all`) for a single gated merge to `main`; nothing from wave 3 is on `main` yet. 2.2 (which must use `changedDate`) and 2.3 are next in R1's queue. See "Wave 3 results" and "Integration and merge plan" in section 4.

**Critical path: two chains, joining at 3.3.** The **long pole is D8 → 2.5 → 3.1 → 3.3** (with D2 and D3 answered along
the way, and 3.2 / D4 also feeding 3.3). It is 4.5 agent-days of work (2.5 + 1 + 1), but it is the chain that waits on
people: D8 (who runs the `/exec` checks), the storage-target decision in 2.5's design note, a production check, and
Kevin's answers on D2 and D3. 3.1 depends on 2.5 (L-sized, PROD, gated on D8) plus D2 and D3, **not** on 2.1–2.4; an
earlier draft showed `D1 → 0.2 → 2.1 → (2.2 → 2.3 → 2.4) → 3.x`, which was wrong. The **UI-side chain is
0.2 → 2.1 → 2.2 → 2.3 → 2.4**, 6.5 agent-days (1 + 1 + 1 + 1 + 2.5); D1 is decided, so it can start now, and from 2.2
on it runs through R1's queue.

**R1's queue, counted from the §4 tables** (every slice whose Owner(s) cell names R1): **23 slices**: 0.1 (done, PR #155),
0.2, 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4, 2.6, 3.3, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.3, 5.4, 6.1, 6.2, 6.3, so **22 still
to do**. By size that is 6 S + 15 M + 2 L = 6 × 0.5 + 15 × 1 + 2 × 2.5 = **23.0 agent-days** (22.5 without the finished 0.1). After wave 1,
R1's part of 0.2 (the markers) and 1.3 are also done and in review (#157 and #159), which leaves 20 slices and 21.0 agent-days (4 S + 14 M + 2 L).
An earlier draft said "about 17 UI slices"; it left out 0.2 (markers), 4.4, 4.5, 4.6 and 6.3, which also edit the app HTML.
The figure counts each slice in full, including ones where R1 only inserts markers or adds a banner, so it is an upper
bound on R1's own time. It remains the real pacing item, which is why logic and server work are done first, tested
headlessly, and arrive in the app as small wiring changes.

Rough effort (agent-days, S = 0.5, M = 1, L = 2.5, summed from the §4 slice sizes; not calendar):
Phase 0 = 3.0 (0.1 is already done), Phase 1 = 3.5, Phase 2 = 9.0, Phase 3 = 3.0, Phase 4 = 10.5, Phase 5 = 3.5
(plus waiting for data), Phase 6 = 3.0; **35.5 in total over 36 slices**. For example Phase 2 = 1 + 1 + 1 + 2.5 + 2.5 + 1 and
Phase 4 = 1 + 1 + 1 + 0.5 + 1 + 2.5 + 1 + 2.5. An earlier draft gave 2, 3, 6, 4, 7, 3, 3 (= 28), which did not follow from
the S/M/L definitions. These are sums across roles, not elapsed time: roles run in parallel with each other, but one role
holding several M slices in a wave serialises them (R2's three M slices in wave 2 are 3 agent-days, and merge
one at a time anyway; R2 holds 7 slices, 6.5 agent-days, over the whole plan).
Waiting on Kevin (decision gates) and on production verification is likely to dominate the calendar.

---------------------------------------------------------------------------------------------------

## 6. Quality protocol (applies to every slice)

1. **R4 evidence first.** Before a slice is built, R4 states the expected result on the fixtures, at the grain the slice works at (e.g. "rollover pair 2026-08-30→08-31, sailing level: 24 VVDs out, 23 in, the 23 rolled-in carrying 100 TEU of booking and 136 TEU of laden and reported as not new demand"; an earlier draft said "0 changed-because-of-new-bookings from the roll itself", which implied empty sailings; the 61 / 58 row counts are reference only). The slice passes only if the implementation reproduces it. For the 9-day history, R4's evidence is pinned in `tests/check_history_days.js` (reference oracles in `tests/lib/history_days.js`).
2. **Headless-first.** Pure logic is proven with `node tests/check_<name>.js` against real fixtures before any UI exists.
3. **R1 gate:** `node scripts/run_ci_locally.js` (with the sandbox env in §1.10). Compare per-suite counts to `docs/TESTING.md` (325 checks as of 2026-10-03, `EXPECTED_TOTAL_CHECKS` in `tests/ci_regression_runner.js` is the source of truth) and update both in the same commit when a suite changes.
4. **R8 review** (`/code-review` high, plus `/security-review` for 4.2, 4.3, 4.8). Findings are fixed in the same PR, not deferred.
5. **R6 visual check** at 390 / 700 / 1366 px for any visible change, light and dark mode.
6. **Feature flags:** every user-visible feature ships behind a Settings toggle, default off for Δ column and sparklines, default on for the stamp, banner and cache. Basic build (no Google services) must stay intact: `tests/check_basic_build.js`.
7. **PROD checklist** for each server-touching slice is written by R7 and lands in `apps-script/README.md` through the slice's PR (R3 owns that file and approves it), and is run by the person named in D8. Until then the PR says "client verified against fakes; production unverified".
8. Performance budget: dist first-React-commit stays near the README baseline (416 ms median) and the row-highlight benchmark stays within its documented budget. R5 records before/after in the PR.
9. **One worktree per agent (worked in wave 1).** Each agent branches from one base commit in its own git worktree, edits only the files it owns (§2), leaves its changes uncommitted, and the integrator copies them into the PR branch and commits. Agents do not commit, push or check out in each other's trees. In this sandbox, running agents side by side also needs the poll-timeout setting in §1.10.

---------------------------------------------------------------------------------------------------

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| App HTML becomes a merge bottleneck | High | Schedule slips | D1a moves logic out of the hand-edited part; R1 batches; one open app-file branch carrying hand edits |
| Parallel shared-logic PRs conflict in the generated region (it lives in the single-writer HTML, and `--check` requires it be regenerated) | High | Wasted cycles; a hand-merged region fails `--check` | Shared-logic PRs merge one at a time through R1's queue; on conflict take neither side and re-run `node scripts/sync_shared.js`; R1 re-runs it first in every slice |
| Row-render changes (Δ, sparklines) blow the highlight budget | Medium | Perf regression on 9,232-row POL table | Check 5 on every such slice; toggles default off; sparklines lazy |
| Persistence/threshold rules are noisy | Medium | Panel ignored | D2/D3, base-rate check on real data before UI, calibration slice 3.4 |
| `?view=` lost in sign-in redirect, or IndexedDB blocked in the iframe | Medium | Feature silently absent | Both are PROD-verified; client degrades silently; documented as unverified until run |
| Stale shared links (sale weeks roll every Monday) | High | Wrong view opened | Relative week form; stale values reported in the banner |
| Export change breaks someone's downstream workbook | Medium | Silent breakage | Additive export only; old export pinned by a test |
| Forecast ships and misleads | Medium | Wrong planning decisions | Gate: backtest must beat the naive baseline; definition confirmed by the measure's owner |
| Shared-logic copies drift (the original 10-copies problem) | Low if D1a | Green-but-meaningless checks | Generated copies + CI `--check`; guard check already blocks hand-copied rules |
| Email exposes data to the wrong people | Low | High | D5 decision, recipients in config Sheet, R8 privacy review |
| Sandbox-only failures mistaken for code failures (e.g. missing Chromium build, or the runner's default 240 s result wait stopping the 7-minute source run when several agents share the sandbox) | Medium | Wasted cycles | Environment notes in §1.10 (including `BF_RESULT_POLL_TIMEOUT_MS=1200000`); failing-launch ≠ failing-test |
| **A comment containing the slash-star block-comment opener** (for example the text "shared/" followed by "*.js" in a marker or line comment) is read as a block comment by the comment-stripping regex in `tests/check_team_features_logic.js`, which then deletes everything up to the next close-comment: in wave 1 it removed about 67,000 characters of real code and made 5 assertions fail | Medium (it happened once, in wave 1) | Misleading failures in a headless check; real code silently excluded from what the check sees | Rule: slash-star appears only as the opener of a real block comment that begins its own line, and nowhere else (not in markers, line comments or strings); the shared-logic pipeline enforces it; write such paths in words ("shared/ then star-dot-js") |

---------------------------------------------------------------------------------------------------

## 8. First actions (this week)

**Status after wave 1 (2026-10-05):** actions 3 and 4 are done and the design-note half of 5 is done (all in review or filed as PRs #155 to #159; see section 4,
"Wave 1 results"); 2 is drafted as `docs/DECISIONS.md` and still needs Kevin's answers; 1 is outstanding. The list below is kept as originally written.

**Update (2026-10-06): the merge order below is superseded.** Kevin approved one integration branch (`claude/integrate-all`, on top of #178), gated with the full local CI and then merged to `main`, instead of merging the stacks in the order below; see "Integration and merge plan (2026-10-06, in progress)" in section 4. The order is kept as it was written, because it is still the right order if the integration branch is abandoned.

**Merge order for the open PRs (2026-10-05).** Several are stacked, and each one that changes the app file also regenerates `dist/`, so the order matters:

1. **#158** (build fix) first. It is based on `main` and independent of the rest. #155 and #157 carry a `dist/` built with the old script, so after #158 lands, merge `main` into each and re-run `node scripts/build_deployable.js` (never hand-merge `dist/`).
2. **#155** (single app-file resolver), then **#157** (shared-logic pipeline and history helper), retargeted to `main` once #155 is in.
3. Then **#159** (1.3 in the main file, stacked on #157; kept open as the production copy of the fix, with #171 as its testing-build port) and **#161** (wave-2 logic, stacked on #157). #161 already contains #158's script fix, so it does not depend on #158 landing first. **#160 is closed**: 1.4 is a feature and lives in the 2.5 testing build as #173. Shared-logic PRs merge one at a time (AGENTS.md); #161 changes `shared/`, the app file and `dist/`, and #159 changes the app file and `dist/`, so after each merge regenerate (`node scripts/sync_shared.js`, then the build) instead of resolving conflicts by hand.
4. Then the testing-build stack, in order: **#165**, **#166**, **#168**, **#169**, **#170**, **#171**, **#173**. Each is stacked on the one before; retarget to `main` as the one below it merges. **#166 is the only one that changes `shared/`**, so it also regenerates the shared region of both app files, `Shared.gs` and `dist/` and merges on its own; #168 onward change only the 2.5 file, the tests and the docs, so they never conflict with `dist/`. #174 (extra poll-path checks for 1.2) was folded into #169 on 2026-10-06; the pins above it were recounted from real runs when the review fixes were merged up the stack (396, 422, 427, 432), never edited to match.
5. **#156** (this plan, the decision pack and the specs) is docs only and can merge at any point.

1. Get PR #155 (Step A) reviewed and merged (R1/R5).
2. R7 sends the open decisions to Kevin: D2, D3, D4, and D8 (D8 heads the long pole: 2.5 cannot start without it). D1 is decided (2026-10-05).
3. Start 0.2, the shared-logic pipeline (R2 script, R5 CI and guard check, R1 markers), and 0.3, the fixture helper and expected-values README (R4), in parallel.
4. In parallel, R1 takes the phone-overlap fix (1.3) as the first low-risk slice through the serial queue.
5. R2 starts `diffSailings` (2.1) as soon as 0.2 and 0.3 land, reading the committed 9-day CSV through R4's slicing helper. R3 starts the history-index design note (2.5): **storage target first**, then size and quota. No `fetchedAt` server work is needed; it already exists (see 1.1; a `changedAt` is optional, and the 2.2 `fetchedDate` is a separate small server change, both gated on D8).

## 9. Out of scope (until asked)

Row-level comments (notes are per sailing, which is the correct grain: voyage-level fields agree across a sailing's port rows on all 368 sailings checked), flat threshold alerts, impossible-date checks, a command palette, true offline use, inlining CDN libraries (would roughly double the 1.72 MB `dist/index.html`), and a committed `app.json` pointer (optional follow-up now that detection refuses to guess).

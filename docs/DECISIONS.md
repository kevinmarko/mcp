# Decisions record

The decisions the roadmap (`docs/ROADMAP_PLAN.md`, section 3) needs from Kevin, with the evidence for each, the
recommended default, what each one unblocks and its status. This is the roadmap's slice 0.5 (the decision pack);
the written answers are recorded here. Prepared 2026-10-05.

**How to answer.** The table below is the whole ask: one answer per row, in the order that unblocks the most work.
When a decision is made, change its status line to `DECIDED <date>, <answer>` and leave the evidence in place.

**How to read the evidence.** *Measured* means counted on 2026-10-05 from the files in this repo: the 9-day
historical CSV with a RFC 4180 parser (8,769 rows, never `wc -l`) and the 8/12 export with `openpyxl` (964 rows).
*Plan* means a figure from the roadmap plan that this pack did not re-derive. Anything not confirmed is labelled
UNCONFIRMED.

## How this file works (read before feature work)

This file is the project's memory of product decisions, so that two sessions do not decide the same question twice, or
build the same question two different ways (the 2026-10-06 merge of #185 and #186 is the case that prompted the rules
below: [docs/CHECK_HISTORY.md](CHECK_HISTORY.md#2026-10-06-semantic-merge-conflicts-185-vs-186-and-the-merge-safety-systems)).
The rules are agreed working practice for agents; nothing checks them automatically, so they hold only if sessions follow them.

- **Read it before starting feature work**, and read "Working on (claims)" at the bottom for what someone else is already doing.
- **Add an entry before you implement a product decision**, not after. A code change that settles a question nobody wrote
  down is a decision made by accident.
- **A recommendation is not a decision.** An agent's proposal stays `PROPOSED` until Kevin confirms it in writing; chat counts,
  and the entry quotes it. If you cannot quote it, it is not `DECIDED`.
- **Status values:** `OPEN` (a question, no recommendation adopted), `PROPOSED` (an agent's recommendation awaiting Kevin),
  `DECIDED <date>` (Kevin confirmed it), `SUPERSEDED by D<n>`.
- **A conflict with a `DECIDED` entry means stop and ask Kevin.** Never quietly build the other way.
- **A later decision supersedes an earlier one explicitly.** Both entries stay; each links to the other, and the old status
  becomes `SUPERSEDED by D<n>`.
- **Every entry names** who decided, when, what, and the PR that built it.
- **Cite the source.** Each seeded entry below names where its facts come from (file and heading, PR number or commit). Where a
  fact could not be found in the repo it is labelled `source: chat, unrecorded; Kevin to confirm` rather than filled in.

The tables above (D1 to D8) are the roadmap's decision pack and keep their own format. New entries go in "Decision log" below,
numbered on from D9.

## Answer sheet (open decisions, most work unblocked first)

| ID | Question | Recommended default | Answer |
|---|---|---|---|
| D8 | Who runs the production (`/exec`) checklists, and when? | One named person, once per server-touching slice right after its deploy | **DECIDED 2026-10-30:** Kevin, once per server PR, before merge |
| D4 | Which PIC names map to which emails, and on which lanes is a blank PIC normal? | Name-to-email tab in the config Sheet; Kevin lists the blank-OK lanes | **DECIDED 2026-10-30:** Config Sheet map; blank PIC is normal on FLX |
| D2 | What does each threshold column limit, and is it policy or a placeholder? | Kevin or the MCT sheet owner answers in a sentence per column | **DECIDED 2026-10-30:** a ceiling over Max Laden; 0 and 0.01 mean not set |
| D3 | How many consecutive days (N) make an unowned or over-threshold sailing an exception? | N = 3, set in the config Sheet, recalibrated after two weeks | **DECIDED 2026-10-30:** N = 3, configurable |
| D6 | May the 51 unreferenced root files move to `archive/`? | Yes, keeping `validation_ground_truth.json` and the referenced snapshots | |
| D7 | Is a second, data-driven Excel export acceptable beside the existing one? | Yes, additive; the old export stays untouched | |
| D5 | Is an emailed morning brief wanted, for whom, and which account installs it? | Defer until the worklist has proven useful | |
| D1 | Where does shared pure logic live? | **DECIDED 2026-10-05: option (a), `shared/` with generated copies** | |

**On hold (per Kevin, 2026-10-07):** "For the older roadmap items, they should remain on hold for now." D2 to D7 stay `OPEN` and
nothing is built for them until Kevin reopens them; D8 and D1 are not part of that hold (D8 was not answered; D1 is decided).
**Reopened 2026-10-30 (D84):** Kevin answered D2, D3, D4 and D8, which lifts the hold for them; D5, D6 and D7 stay on hold.

**Why this order.** D8 heads the long pole: it gates every slice that touches the server and, through the history
index (2.5), the sparklines, the exceptions and the retention report. D4, D2 and D3 together gate the exceptions
worklist (3.1 to 3.3, plus the notes work behind D4). D6, D7 and D5 each gate a single slice (0.4, 5.3, 4.8).

## Open decisions

### D8. Who runs the production (`/exec`) checklists, and when? (DECIDED 2026-10-30)

- **Decided:** Kevin, 2026-10-30, answering the D84 plan's Phase 0 questions in chat (he picked the recommended option each time): "Accept defaults (Recommended)". Kevin runs the `/exec` checklist once per server-touching PR, after its deploy to the testing `/exec` and before merge. Until it is run, the PR says "client verified against fakes".

- **Question:** Which one person runs each server-touching slice's `/exec` checklist, and after every deploy or on a fixed day?
- **Evidence:** Three checklists that already exist have never been run (`apps-script/README.md`, lines as of 2026-10-05):
  server-backed preferences (`:137-138`, `:667`), Export to Drive (`:218-219`) and the `activeUserEmail` /
  `getUserProperties()` observations (`:610-611`, "not yet run"); they need a second Google account (`:134-137`, `:216`).
  Plan: seven slices are marked PROD (1.1, 1.2, 2.2, 2.5, 4.2, 4.5, 4.8), and 2.5 (history index) names D8 as a
  dependency and feeds 2.6, 3.1 and 5.2, so this is the long pole: it needs a person, not an agent. Until someone is
  named, each PR says "client verified against fakes; production unverified".
- **Default:** One named person (Kevin or a delegate with the deployed app and a second Google account) runs a slice's
  checklist once, right after it deploys; R7 writes each as copy-paste steps in `apps-script/README.md`. The cadence is
  R7's suggestion; the plan only says "name one person".
- **Unblocks:** every PROD slice; 2.5 explicitly, and through it 2.6, 3.1 and 5.2.
- **Partly answered (2026-10-07).** Kevin pointed to AGENTS.md for D8 ("read the agents.md file for D8"). What the repo already settles
  is **where**: on the testing deployment (per Kevin, 2026-10-06; its `/exec` URL and Sheets are in apps-script/README.md, "The testing
  deployment: addresses"), with the 2.5 build pasted in as `index.html`, never over the main project. AGENTS.md ("Production-only questions
  stay open until someone runs them on `/exec`") sets the rule but names no person and no cadence, so **who** and **when** stay open.
  Until a run is recorded next to a checklist, every server feature stays UNCONFIRMED on `/exec`.
- **Deployment mode kept (2026-10-07).** Asked whether to open the testing deployment (Execute as: Me, access: Anyone) so a cloud
  agent could reach it, Kevin answered "Let's keep it": it stays **Execute as: User accessing the web app**. Opening it would make
  the Team Data public and give every visitor one shared settings store, so checklist A would prove nothing. Consequence for **who**:
  a cloud agent session cannot run the `/exec` checklists (it has no Google account, and Claude in Chrome reaches only sessions
  running on the person's own computer). The checklists are run by a person, or by an agent session started locally on that
  person's computer with Claude in Chrome connected and already signed in.
- **New testing `/exec` URL (2026-10-08).** Kevin: "Please verify that this deployment is ready for testing and that the
  system-wide knowledge base has been updated accordingly." The URL is now the current row in apps-script/README.md, "The testing
  deployment: addresses", restricted to the `one-line.com` Workspace. Checked from outside: it is live (sign-in redirect, where a
  fake ID gives 404). "Ready for testing" is UNCONFIRMED: the build inside, the Sheets and the Execute-as setting need a signed-in
  `one-line.com` account to see. Checklists B and C were never run on the previous URL (the 2026-10-07 attempt was stopped before the
  page loaded), so nothing carries over.
- **Corrected (2026-10-09).** Kevin: "this is the project url", giving the original `AKfycbz0158…` `/exec` URL. The checklists run
  there; the `one-line.com` deployment's role is UNCONFIRMED (README table updated). Kevin confirmed the project has `bfrTeamSheetId` set.
- **Who, narrowed (2026-10-09).** An agent in Kevin's own Chrome (Claude in Chrome, signed in) ran the checklists: it confirmed
  the project (both Sheet IDs match) and read `?check=version`, but its JavaScript cannot enter the app's cross-origin frame, so the
  in-frame steps were not run. The `/exec` checklists therefore need a **person with DevTools**; an agent can do only the page-level
  reads. Results are in apps-script/README.md, "The testing deployment: addresses".
- **First results by a person (2026-10-09, Kevin).** Server-backed preferences round-trip on `/exec`: Dark Mode set in a
  normal window was dark on first paint in Incognito on the same account ("it was dark straight away in incognito"). C2 and C3
  passed and the deployment runs the 2.5 build. Later the same day B1, C1 and C6 passed (Chrome, normal window). Open: the
  second-account check, Execute as / Who has access, B3, the remaining client-side steps and other browsers.

### D4. Which PIC names map to emails, and where is a blank PIC normal? (DECIDED 2026-10-30)

- **Decided:** Kevin, 2026-10-30, answering the D84 plan's Phase 0 questions in chat (he picked the recommended option each time): "Config Sheet map (Recommended)": PIC names map to emails in a Config Sheet tab, and a blank PIC is normal on FLX (the other blank-PIC lanes, EXW, EXE, INE and ANG, count as unowned). Still to fill in: the emails themselves, and whether `Resid` is a person and `TBA` counts as an owner (read as: `TBA` = unowned until Kevin says otherwise).
- **Evidence (2026-10-30, VPT repo, `new Build/src/BfFeed.js:210-221`):** "Kevin 2026-10-27: Resid left", so Resid's voyages are unowned; `TBA` is unassigned; `EC SPC` / `WC SPC` are team accounts, not a person. VPT keeps the name-to-email map in `myWork.picEmails` (`Name=email;...`); this app's map uses the same format. The PIC column shown here does not change (D84, additive only).

- **Question:** Can each PIC name below be mapped to an email, and on which lanes is a blank PIC normal?
- **Evidence (measured, 9-day CSV):** `MCT PIC` holds 22 distinct non-blank "SPC / MKG" strings built from 12 names:
  Alex, Bob, Evan, Joe, Kysa, Lani, Marissa, Peter, Resid, Ryan H, Ryan T, TBA (is `Resid` a person; is `TBA` an owner?
  `TBA` is in 384 rows, 29 sailings). 96 rows (22 sailings) have a blank PIC, none a VMS placeholder; by lane: FLX 51,
  EXW 27, EXE 8, INE 8, ANG 2. The plan guesses EXW/EXE (35 of the 96); FLX is the largest.
- **Default:** A name-to-email tab in the config Sheet (plan); Kevin lists the blank-OK lanes, starting from the five above.
- **Unblocks:** 3.2 (config keys) and so the 3.3 worklist, 4.5 (new-notes badge by PIC), 4.6 (Status / Owner / Due).

### D2. What do the threshold columns mean? (DECIDED 2026-10-30)

- **Decided:** Kevin, 2026-10-30, answering the D84 plan's Phase 0 questions in chat (he picked the recommended option each time): "Ceiling over Max Laden (Recommended)": `MCT Overall Threshold` (the app's "Standby Threshold") is how far bookings may go over Max Laden (1.5 = 150%); `MCT Loading Threshold` (= POL Laden Threshold) is the same per POL; 0 and 0.01 mean "not set". R4 records this in `DATA_ARCHITECTURE.md` with the first slice that uses it.
- **Evidence (2026-10-30, Max Laden generator repo):** `%THRESHOLD` sits on the Max Laden upload row (`app/CONTRACT.md:68`), stored there as percent (150) where this feed shows a ratio (1.5); the Loading side excludes thresholds below 2 % as not set (`docs/specs/04_loading.md:103`). That 0 and 0.01 mean "not set" on the Overall side is INFERRED. See [RESEARCH_BUILDOUT_PLAN.md section 4a](RESEARCH_BUILDOUT_PLAN.md).

- **Question:** Which measure does each threshold column limit (laden, bookings or POL utilisation), and is it policy
  or a placeholder?
- **Already documented?** No. `DATA_ARCHITECTURE.md:420` is `` | `standbyRaw` | Trunk Threshold | Booking Flash ("Standby
  Threshold") | `` and `:457` is `` | `polLdnThresh` | POL Laden Threshold | POL Booking Flash | ``: column, field and tab,
  no meaning (`:64-86` is the app's unrelated schedule-change constant). `MCT Overall Threshold` and `MCT Loading
  Threshold` appear in no doc, test, `.gs` file or the current app; the reference workbook's table lists all four as
  names only (`pivot_xmls/xl/tables/table1.xml`).
- **Evidence (measured; the 8/12 export agrees):** `MCT Overall Threshold` equals `Trunk Threshold` on all 8,769 rows,
  so the app's "Standby Threshold" is that number; `MCT Loading Threshold` equals `POL Laden Threshold` on 8,644 (the
  other 125 are 0 vs 1.2). Not a constant: 13 values from 0 to 2, Overall being 1.5 on 2,459 rows, 1.2 on 1,449, 1 on
  1,021; 0 (250 rows) and 0.01 (148) look like placeholders (UNCONFIRMED); blank only on the 633 VMS rows. Shown as a
  percent (`HANDOFF.md:2666`: 115%), which hints at an over-booking ceiling over Max Laden (UNCONFIRMED, a reading of the label).
- **Default:** Kevin or the MCT sheet owner answers in a sentence per column; R4 then records it in `DATA_ARCHITECTURE.md`
  (this pack does not edit that file).
- **Unblocks:** 3.1 (the over-threshold rule) and 5.4, so the exceptions phase.

### D3. How many days make an exception? (DECIDED 2026-10-30)

- **Decided:** Kevin, 2026-10-30, answering the D84 plan's Phase 0 questions in chat (he picked the recommended option each time): "3 days, configurable (Recommended)": N = 3 consecutive archive days, a Config Sheet key, recalibrated after two weeks of use (slice 3.4).

- **Question:** For how many consecutive days (N) must a sailing be unowned, or over threshold, before it is an exception?
- **Evidence:** Plan: on the 9 days, "unowned for N days" is 3 sailings (`WAHT0613W`, `HTET1002W`, `GJMT0003W`), not
  the 96 blank-PIC rows, because 17 of the 20 sailings unowned on 8/24 left the window; a flat threshold would flag
  613 POL-utilisation rows. Re-run with R4's `unownedStreaks` helper (`tests/lib/history_days.js`): sailings reaching a
  streak of N at any point are 22 (N=1), 4 (2), 3 (every N from 3 to 8) and 2 (9). The 9 days therefore cannot choose
  between 3 and 8; only the two-week recalibration (slice 3.4) can. "Over threshold for N days" was not measured: it
  needs D2.
- **Default:** N = 3, a key in the config Sheet, recalibrated after two weeks (plan).
- **Unblocks:** 3.1 and 3.2 (Phase 3; 3.4 recalibrates it).

### D6. May the unreferenced root files move to `archive/`? (OPEN)

- **Question:** Does anyone still run the old root scripts (`fix_*.py`, `patch_*.py`, `*.bas`, ...) by hand, or may they move?
- **Evidence:** 77 tracked files sit in the repo root (measured, `git ls-files`); the plan counts 51 of them as
  unreferenced by any test, script or doc (not re-derived here; slice 0.4 produces the exact list before anything
  moves). `README.md:135` already calls them "leftover working scaffolding ... safe to ignore".
- **Default:** Yes: `git mv` them to `archive/` with an index README; keep `validation_ground_truth.json` (live) and
  the referenced snapshots (plan).
- **Unblocks:** slice 0.4 (hygiene) only.

### D7. May a second, data-driven Excel export sit beside the existing one? (OPEN)

- **Question:** Is an additional data-driven export acceptable, and who consumes today's export?
- **Evidence:** Today's Excel export, `exportToExcel`, builds from the rendered table (`XLSX.utils.table_to_sheet`) and
  sits in Settings (`HANDOFF.md:1418`). Plan: downstream workbooks key on column position, so it must not change.
  Export to Drive is already data-driven (`apps-script/README.md:175`). Who consumes the Excel export is unknown
  (UNCONFIRMED).
- **Default:** Yes, additive, with a test pinning the old export's output (plan).
- **Unblocks:** 5.3 (Export (data)).

### D5. Is an emailed morning brief wanted? (OPEN)

- **Question:** Is a morning brief email wanted, who receives it, and which account installs the trigger?
- **Evidence:** A time trigger "runs as whoever installs it" (`apps-script/DataFeeds.gs:324`), so the installing
  account is also the sender; recipients would sit in the config Sheet and R8 reviews recipient privacy (plan risk:
  data to the wrong people, low likelihood, high impact). The brief needs the worklist (3.3) to exist first.
- **Default:** Defer; decide after the worklist has been used for two weeks (plan).
- **Unblocks:** 4.8 only (the last slice).

## Decided

### D1. Where does shared pure logic live? (DECIDED 2026-10-05, option (a))

- **Question:** `shared/*.js` as source with generated copies (a), or a marked block edited inside the app file (b)?
- **Decision:** Kevin, 2026-10-05: **(a)**. `shared/*.js` is the source; `node scripts/sync_shared.js` writes a marked
  region into the app file and a generated `apps-script/Shared.gs`; `--check` (run by `tests/check_shared_sync.js` and
  a CI job) fails if either is stale.
- **Evidence:** The app file is the plan's bottleneck: about 17 UI slices queue through its single writer, and the
  script is 14,183 lines (plan). Option (b) would have made every logic change a serial edit of it. Hand-synced copies
  already failed once: the app-file rule reached ten copies that disagreed (`docs/CHECK_HISTORY.md`, 2026-10-04).
- **Cost:** One `node scripts/sync_shared.js` after editing `shared/`; opening the app locally is unchanged.
- **Unblocked:** slice 0.2 and, through it, Phase 1 onward. The rules are in `AGENTS.md` ("Shared logic"), the dev flow
  in `docs/TESTING.md`, the history in `HANDOFF.md` and `docs/CHECK_HISTORY.md` (2026-10-05).

## Decision log

Entries from D9 on. Seeded on 2026-10-06 from what the repo already records; each names its source. Entries are grouped by
status, not by number: D9 to D17 are standing practice and the 2026-10-06 answers, D18 and D19 are open, D20 to D23 are the
merge-safety work (D45 later relaxed it).

### D9. Ignore GitHub billing failures and gate locally (DECIDED 2026-09-29; SUPERSEDED by D45 on 2026-10-11, GitHub Actions works again)

- **Decided by:** Kevin.
- **Date:** 2026-09-29.
- **Decision:** Every GitHub Actions job has failed in about 3 seconds without a runner since 2026-09-26 (payments / spending
  limit). Those red checks are ignored, never block a push, PR or merge, and are not reported. The gate is
  `node scripts/run_ci_locally.js`. The policy lifts only when Kevin says billing is fixed.
- **Why:** The failures say nothing about the code (0 steps, no runner); a failure with real log output is still a real failure.
- **Built in:** Not a code change. Written into AGENTS.md; the local gate is `scripts/run_ci_locally.js`.
- **Supersedes:** none.
- **Source:** AGENTS.md, "Policy: ignore GitHub billing failures, run CI locally" ("Standing policy (per Kevin, 2026-09-29)"); that section was replaced on 2026-10-11 (D45).
  The PR that added it: unconfirmed (not looked up).

### D10. Commit only when the change is ready to become a PR (DECIDED 2026-09-24)

- **Decided by:** Kevin.
- **Date:** 2026-09-24.
- **Decision:** No checkpoint commits. Do the edit, run the checks for what was touched, then commit and push. Related fixes may
  share a commit (the earlier "one commit per concern" wording was removed 2026-09-26, per Kevin).
- **Why:** A commit is the unit a reviewer (human or CI) judges, not a save point.
- **Built in:** Not a code change; AGENTS.md "Working practices".
- **Supersedes:** none.
- **Source:** docs/CHECK_HISTORY.md, "Only commit once the change is ready to become a PR" ("2026-09-24, per Kevin"; the 2026-09-26
  note is in the same paragraph); AGENTS.md, "Working practices" ("per Kevin, 2026-09-24").

### D11. New features go in the 2.5 testing build; fixes go in production and are ported (DECIDED 2026-10-05; SUPERSEDED by D42 on 2026-10-11, the build was promoted)

- **Decided by:** Kevin.
- **Date:** 2026-10-05 for the testing build; the feature/fix rule (PR #172) was confirmed 2026-10-06 (roadmap question Q7, "Answered: merged").
- **Decision:** New features are built only in the 2.5 testing build, a copy of the main app file that is not deployed. Bug
  fixes and efficiency changes go in the production file and are ported into the testing build in the same PR, so promoting the
  testing build later undoes nothing. The arrangement is temporary: one production file again when Kevin approves the promotion.
- **Why:** The main file stays exactly as deployed while the wave-3 features are built and reviewed.
- **Built in:** PR #165 (the testing build and its per-target check pin); PR #172 (the feature/fix rule).
- **Supersedes:** none.
- **Source:** AGENTS.md, "The 2.5 testing build (2026-10-05, per Kevin)" and "Rule: features go in the testing build, fixes go in
  production (2026-10-05, per Kevin)"; docs/ROADMAP_PLAN.md, "Wave 3 results" (Kevin's instruction of 2026-10-05, and #172 "Kevin's
  decision of 2026-10-06") and the Q7 row of "Open for Kevin".

### D12. Shared-logic PRs merge one at a time (DECIDED 2026-10-05, a consequence of D1)

- **Decided by:** Kevin, through D1 (option a). The rule itself is written down by the roadmap plan as a consequence of D1; the repo
  does not quote Kevin on this sentence separately.
- **Date:** 2026-10-05.
- **Decision:** Two PRs that touch `shared/` regenerate the same files, so they merge sequentially. On a conflict in generated
  files neither side is taken: resolve `shared/`, re-run `node scripts/sync_shared.js`, commit what it writes.
- **Why:** A hand-merged generated region can look right and still not match what the script emits.
- **Built in:** The sync check (`tests/check_shared_sync.js`) catches a stale result; the ordering itself is a working rule.
- **Supersedes:** none.
- **Source:** docs/ROADMAP_PLAN.md, "Decisions recorded" ("Merge discipline for shared-logic PRs"); AGENTS.md, "Shared logic";
  docs/CHECK_HISTORY.md, "2026-10-05: shared-logic sync check".

### D13. "Show in table" matches the Analyze card (DECIDED 2026-10-06; the Sale Week clause SUPERSEDED by D24)

- **Decided by:** Kevin.
- **Date:** 2026-10-06.
- **Decision:** The button keeps every other slicer and header filter, sets the group's slicer (Lane; Yard on POL; the POL
  header filter for "NO N.A. CALL") and sets Sale Week to the Analyze window's weeks. One Undo restores the state before the
  first press. The Analyze window stays open on desktop and closes below 640 px. Focus: on a phone it goes to the Undo button;
  on desktop it stays on the pressed button (an always-mounted live region announces the Undo bar).
- **Why:** Kevin's answers to roadmap questions Q3 (a), (b) and (c); the table then shows the card's own sailings, and "click card
  after card" works with the window open.
- **Built in:** PR #185 (merged 2026-10-06; 2.5 testing build only).
- **Supersedes:** the earlier answer still written in docs/ROADMAP_PLAN.md row 1.4 ("keep clearing every slicer then setting
  lane/POL ... keep closing the Analyze window"). That row disagrees with the Q3 row, which records #185 as Kevin's answer; treat #185 as current.
- **Superseded in part by D24 (2026-10-06, later the same day):** the button no longer sets Sale Week; everything else in this
  entry stands.
- **Note on a common misreading:** a redirect that moved focus to the narrowed table was built and then **dropped** when #185 landed
  (commit f812a79, docs/CHECK_HISTORY.md "follow-up round"); "Show in table" does not hand focus to the table.
- **Source:** docs/CHECK_HISTORY.md, "2026-10-06: Kevin's decisions on Show in table and the offline-copy baseline" (Q1, Q2, Q3);
  docs/ROADMAP_PLAN.md, "Open for Kevin" row Q3.

### D14. The offline copy has its own healthy-load baseline (DECIDED 2026-10-06)

- **Decided by:** Kevin.
- **Date:** 2026-10-06.
- **Decision:** The data-check banner keeps the rolling row-count baseline and warns once. The offline cached copy is judged
  against the last saved load's row count (a separate baseline). The way out for a real permanent change of size: when the only
  objection is the row count, the third consecutive applied load within 10% of the first of the run is saved and becomes the baseline.
- **Why:** Fixes a stuck-truncated feed after a page reload and the recovery after a truncation (roadmap question Q1).
- **Built in:** PR #185 (2.5 testing build only).
- **Supersedes:** the line in docs/ROADMAP_PLAN.md row 1.5 ("Decision 2026-10-06: the banner's row-count baseline stays rolling (Q1)").
  The banner's baseline does stay rolling; the Q1 row records #185's separate saved-copy baseline for the offline copy as the answer.
- **Source:** docs/CHECK_HISTORY.md, "2026-10-06: Kevin's decisions on Show in table and the offline-copy baseline" (Q4 there);
  docs/ROADMAP_PLAN.md, "Open for Kevin" row Q1. The spec deviation ("with no saved count yet the rolling count stands in") is
  stated in that CHECK_HISTORY entry.

### D15. The remaining 2026-10-06 answers on the wave-3 stack (DECIDED 2026-10-06)

- **Decided by:** Kevin ("accepted every recommendation", per the roadmap plan).
- **Date:** 2026-10-06.
- **Decision:** (Q2) The "Data as of" stamp keeps its "fetched" meaning, moving only when fetched data is applied to the screen (as PR #178
  made it). (Q3c) Focus returns to the opener when any dialog closes, in production and 2.5. (Q4) The stale-stamp factor of 2 stays.
  (Q5) No compiled copy of the 2.5 build for users yet. (Q6) Production fixes #162 and #167 (and later #180, #181) are ported into
  the 2.5 build. (Q7) PR #172's feature/fix rule is merged (see D11). Q1 and Q3 (a), (b) are D14 and D13.
- **Why:** Recorded answers to the questions raised by the review of the 2.5 stack.
- **Built in:** #178 (Q2, Q6), #184 (the landing), the follow-up round #186, merged as part of #189 (focus return, `Focus_Return` suite).
- **Supersedes:** none.
- **Source:** docs/ROADMAP_PLAN.md, "Open for Kevin" table (Q1 to Q7, "Every item below was answered on 2026-10-06; Kevin accepted
  every recommendation"); docs/CHECK_HISTORY.md, "2026-10-06: follow-up round".

### D16. The cached copy appears on any failed first load, at most once per page load (DECIDED 2026-10-07)

- **Decided by:** Kevin, confirming the behaviour as built. An agent fixed a review finding (2.5 gap 3) and the fix merged with the
  follow-up round (#189, merged by Kevin).
- **Kevin's words (chat, 2026-10-07):** "D16 yes".
- **Date:** built 2026-10-06; confirmed 2026-10-07.
- **Decision (as built):** Every live load that fails with nothing on screen asks for the stored copy, at most once per page load;
  it fills only an empty screen. The narrower case once left open here (a poll failing fast during a slow first fetch that then
  succeeds left the cached banner up until the next poll) is closed by D19 (2026-10-07).
- **Why:** Before, a poll tick or Refresh Now during the first fetch left an offline start empty although a copy was stored.
- **Built in:** #186 (commit 5ac2120), merged as part of #189 (2.5 testing build only).
- **Supersedes:** none.
- **Source:** docs/CHECK_HISTORY.md, "2026-10-06: follow-up round" (2.5 gap 3) and the review table row 3 in "code review of the 2.5
  stack"; docs/ROADMAP_PLAN.md, "Since the stack was built" (Gap 3); CODE_NOTES.md, "Every failed live load asks for the copy".

### D17. The "NO N.A. CALL" card's POL filter is dropped when leaving the tab, if untouched (DECIDED 2026-10-07)

- **Decided by:** Kevin, confirming the behaviour as built (an agent fix of the 2.5 review's side point, merged with #189).
- **Kevin's words (chat, 2026-10-07):** "D17 yes".
- **Date:** built 2026-10-06; confirmed 2026-10-07. Since D18 (the same day) the filter no longer narrows other tabs anyway; the restore
  stays because the Undo bar goes with the tab change.
- **Decision (as built):** Leaving the POL tab puts the POL header filter back to its value before the "Show in table" press, when
  the button changed it and it still holds the button's value. A value the reader edited by hand is left alone. After #185 the
  button acts only when it changed `pol` and restores the earlier value instead of deleting it.
- **Why:** The filter followed the reader to tabs with no POL column (Booking Flash showed 6 of 467 rows with nothing on screen naming the filter).
- **Built in:** #186 (commit 05a9e20), fitted to #185 by merge commit f812a79; merged as part of #189 (2.5 testing build only).
- **Supersedes:** none.
- **Source:** docs/CHECK_HISTORY.md, "2026-10-06: follow-up round" (the "NO N.A. CALL" paragraph and "Merging over #185"); commit
  f812a79's message; docs/ROADMAP_PLAN.md, "Since the stack was built" (Side point).

### D18. A hand-typed POL header filter does not follow the reader across tabs (DECIDED 2026-10-07)

- **Decided by:** Kevin.
- **Date:** 2026-10-07.
- **Question (as asked):** The POL tab's header-filter box writes the one shared `headerFilters` map, which every tab applies, including tabs
  with no POL column. Should a hand-typed value reach other tabs, or be scoped to the POL tab?
- **Kevin's words (chat, 2026-10-07):** "D18: [Stateno] - A manually typed POL filter should/should not follow the user to other tabs."
  Read as **no, it should not follow**; the reply named the answer slot without deleting either verb, so this reading is the agent's.
  Kevin to correct it if he meant the opposite.
- **Decision (as built):** a header filter on a column only the POL table has (20 columns: POL, Discharge, VCO, Port Cut, Loading Status,
  ...; `POL_ONLY_HEADER_FILTER_KEYS`) applies only while the POL tab is open. It stays in its box and applies again on the way back. A column
  both tables show (POL's "Service" is Booking Flash's "Lane"; also VVD, Vessel, Trade, ...) keeps one shared filter, visible in both boxes:
  that case was not part of the question and is unchanged. Analyze's "Show in table" before/after cards (2.5) follow the same rule.
- **Why:** measured on the 8-12 fixture, typing USNYC took Booking Flash from 467 rows to 122 with nothing on that tab showing why.
- **Evidence:** the new `POL_Booking_Flash` D18 checks (all three targets) fail on `main`'s file with exactly that 467 -> 122 and pass after;
  `tests/check_field_filter_gating.py` now fails if the key list and the render sites disagree.
- **Kind (D11):** a fix to existing behaviour, so it went into production and the 2.5 build alike.
- **Built in:** the PR from `claude/open-prs-merge-strategy-v81r77` after #192.
- **Supersedes:** none. D17's tab-leave restore (2.5) stays as built; its comment now gives the remaining reason (the Undo bar goes with the tab).

### D19. A successful first live load replaces the cached copy at once (DECIDED 2026-10-07)

- **Decided by:** Kevin.
- **Date:** 2026-10-07.
- **Question (as asked):** When the stored copy is on screen and a live load later succeeds, the banner cleared only when the next poll or
  Refresh Now applied. In the one documented gap (a fast-failing poll during a slow first fetch that then succeeds) it could stay up to
  `POLL_INTERVAL_MS`, 10 minutes. Is that acceptable, or should the initial load apply over a cached copy?
- **Kevin's words (chat, 2026-10-07):** "D19: [State No] - It is/is not OK for the "cached copy" banner to stay up for up to 10 minutes after
  a live load succeeds." Read as **not OK**.
- **Decision (as built):** the first live load applies over a cached copy under the poll's own rule (the copy is on screen and no historical
  or Compare view is open), and also when the copy is still being read at that moment (the read, finishing later, then finds data loaded
  and does nothing). Under an open historical view it is still dropped and the next poll stages the live text, as before.
- **Evidence:** two new `Offline_Cache` scenarios ("late first reply", copy shown and copy being read), red on the build before the fix.
- **Kind (D11):** a fix to a feature that exists only in the 2.5 build (the offline copy), so the 2.5 build only.
- **Built in:** the PR from `claude/open-prs-merge-strategy-v81r77` after #192.
- **Supersedes:** none. Closes the "known gap" recorded under D16 and in CODE_NOTES.md.

### D20. Build the four merge-safety items as one PR, in order (DECIDED 2026-10-06)

- **Decided by:** Kevin.
- **Date:** 2026-10-06.
- **Decision:** Kevin's confirmed instruction, quoted exactly: "yes build 1-4 as one PR in order". The four items are: (1) the local
  merge queue `scripts/land.js`; (2) this decisions file with claims; (3) `scripts/check_pr_overlap.js`; (4) habit rules, as docs only.
- **Why:** #185 and #186 were each gated alone and conflicted in meaning when combined; the history is in docs/CHECK_HISTORY.md,
  "2026-10-06: semantic merge conflicts: #185 vs #186 and the merge-safety systems".
- **Built in:** the merge-safety PR (PR number not known when this was written).
- **Supersedes:** none.
- **Source:** chat, 2026-10-06 (quote above). The design of each item is the agent's; only the instruction is Kevin's.

### D21. Land through `node scripts/land.js` only (DECIDED 2026-10-06, under D20; SUPERSEDED by D45 on 2026-10-11, `land.js` is now for risky merges)

- **Decided by:** Kevin, as part of D20: item 1 of the list he said yes to included "the AGENTS.md rule: land only through this script".
- **Date:** 2026-10-06.
- **Decision:** Merge to `main` through `node scripts/land.js <PR>`, which merges onto the current `main` in a scratch
  worktree, runs the local gate on that exact tree and pushes only if `main` has not moved. No rule in AGENTS.md forbids a direct
  push to `main`, and the script cannot stop one; a direct push simply skips the tested-tree guarantee.
- **Why:** The "Not Rocket Science Rule": `main` should only receive a tree that was tested as merged.
- **Built in:** the merge-safety PR (script and docs).
- **Supersedes:** none. Does not change D9: the local gate stays the gate.
- **Limit:** a rule, not a lock. Nothing stops a direct push to `main`; `node scripts/land.js --verify --last N` shows it as `UNSTAMPED`.

### D22. `--docs-only-fast`: a docs-only landing may use the fast gate (DECIDED 2026-10-06)

- **Decided by:** Kevin, 2026-10-06, in reply to the question "may a docs-only change skip the browser jobs when landing?": "D22 yes". The agent that built D20 proposed it; it was not in the list Kevin approved with D20.
- **Date:** 2026-10-06.
- **Decision:** An opt-in flag: when every changed path is under `docs/`, ends in `.md`, or is
  `.github/pull_request_template.md`, the default gate runs with `--fast` (about a minute instead of about 25) and the push is
  allowed, with the stamp recording that. Off by default; otherwise a no-op.
- **Why:** A full gate on a docs-only change is slow and tests nothing the change touched.
- **Built in:** the merge-safety PR.
- **Supersedes:** none.
- **Limit:** opt-in per landing (`node scripts/land.js <PR> --docs-only-fast`); without the flag the full gate runs. Paths are compared with `--no-renames`, so moving a code file into `docs/` is not docs-only (docs/CHECK_HISTORY.md, 2026-10-06).

### D23. Working habits against stacked and stale branches (DECIDED 2026-10-06, under D20)

- **Decided by:** Kevin, as part of D20: item 4 ("habit, no code, encoded as rules and docs") was in the list he said yes to. The wording below is the list he was shown.
- **Date:** 2026-10-06.
- **Decision:** Land slices one at a time rather than stacking branches on unmerged branches. When one session lands,
  every other open branch merges `main` promptly. One merger at a time. When a merge combines logic written by two different
  sessions, do a fix-removed (red) run on the merged tree. Before feature work, read this file and run
  `node scripts/check_pr_overlap.js`.
- **Why:** The 2026-10-06 merge of #185 and #186 needed repairs that were found by reading the merged code and by a red run, not by the
  gates each branch had passed alone (docs/CHECK_HISTORY.md, "Merging over #185").
- **Built in:** AGENTS.md, "Landing changes (merge safety)" (the merge-safety PR). These are habits; none is enforced by a check.
- **Supersedes:** none. It adds no ban on pushing to `main` directly; none existed.
- **Limit:** habits; none is enforced by a check.

### D24. "Show in table" leaves the Sale Week slicer alone (DECIDED 2026-10-06; supersedes the Sale Week clause of D13)

- **Decided by:** Kevin.
- **Date:** 2026-10-06, after #185 landed.
- **Decision:** The button keeps every slicer and header filter exactly as the reader set it, Sale Week included, and adds only the
  card's own group (Lane; Yard on POL; the POL header filter for "NO N.A. CALL"). The Undo bar, the phone behaviour (the window
  closes, focus to Undo) and the desktop behaviour (the window stays open) are unchanged from D13. Consequence he was told: the table
  can hold the lane's sailings from weeks outside the Analyze window, and only those in the window's weeks are the card's own.
- **Kevin's words (chat, 2026-10-06):** "We don't want to change any of the behaviors of of the slicers that we have right now. So
  keep keep it the same. As it's always been." and, when asked to confirm that this meant Sale Week, "Yes leave Sale Week alone,
  and take over all three".
- **Why:** he does not want any feature to change a slicer he set.
- **Built in:** #190 (2.5 testing build only; a feature, so not in production). The Sale Week regression checks were rewritten in
  place (count unchanged); a review the same day corrected the Lane check so it fails the old behaviour
  (docs/CHECK_HISTORY.md, "Show in table leaves Sale Week alone").
- **Supersedes:** the Sale Week clause of D13 ("sets Sale Week to the Analyze window's weeks"). D13 stays for the rest.
- **Source:** chat, 2026-10-06 (quotes above); docs/CHECK_HISTORY.md; docs/ROADMAP_PLAN.md row Q3.

### D25. Six server and speed follow-ups from the 2026-10-06 code review (DECIDED 2026-10-06)

- **Decided by:** Kevin.
- **Date:** 2026-10-06.
- **Decision:** Do all six items that the review round had listed as left for Kevin: (1) each visitor's saved preferences and filter
  preferences live in their own `getUserProperties()` store instead of the shared 500 KB script store, migrating lazily and only when
  the script runs as the visitor; (2) only the owner of the script file can become the archive/team admin, an unknown owner refuses the
  claim; (3) the temporary `?check=identity` probe is removed; (4) the "new version" banner asks `getAppVersionHash()` through
  `google.script.run` instead of a plain `fetch` of `/exec`; (5) the Booking Flash table stays mounted and hidden across tab
  switches; (6) POL column widths are cached per dataset.
- **Kevin's words (chat, 2026-10-06):** "ok merged, do the follow ups too". Note: that message said "merged" while #190 was still
  open on GitHub, so the approval is for the six items as listed in the message that preceded it, which named exactly these.
- **Why:** each was a real finding of the review round (docs/CHECK_HISTORY.md, "code-review follow-ups").
- **Built in:** #190. Items 4 to 6 went into production and the 2.5 build alike (fix and efficiency); 1 to 3 are `apps-script/` only
  and are tested against fakes: **UNCONFIRMED on `/exec`** until the checklist in apps-script/README.md has been run there.
- **Supersedes:** none.
- **Source:** chat, 2026-10-06; apps-script/README.md, "Where per-user values are stored".

### D26. Fix every finding of the two code reviews of #190 (DECIDED 2026-10-07)

- **Decided by:** Kevin.
- **Date:** 2026-10-07.
- **Decision:** Fix the findings the two reviews of #190 listed (docs/CHECK_HISTORY.md, "2026-10-07: code review of #190"). All are
  fixes or efficiency changes, so each app change went into production and the 2.5 build alike (D11). One was deliberately not built:
  caching `getAppVersionHash` in CacheService (the cache is shared across deployed versions; see that function's comment).
- **Kevin's words (chat, 2026-10-07):** "Fix all the issues and bugs and gaps".
- **Why:** each is a real gap found by reading #190's merged code; two were confirmed by a run on real files (the hidden table's
  element count, the `(blank)` Sale Week's Max Laden).
- **Built in:** the PR from `claude/open-prs-merge-strategy-v81r77`. The `Code.gs` changes are tested against fakes only:
  **UNCONFIRMED on `/exec`**, as is the version banner after a redeploy (apps-script/README.md has the steps; D8).
- **Supersedes:** none. Refines D25 items 1, 3, 4 and 5 without changing what they decided.

### D27. The 2.5 testing build becomes production only when Kevin says so (DECIDED 2026-10-07)

- **Decided by:** Kevin.
- **Date:** 2026-10-07.
- **Decision:** No session promotes `Booking_flash_report_na_2.5_TESTING.html` to the production file on its own judgement, however green the
  drift check and the gate are. When Kevin says to, it is done in one PR by the steps in AGENTS.md ("Promotion (only when Kevin says so)").
- **Kevin's words (chat, 2026-10-07):** "The 2.5 testing build should become the production file when i say so".
- **Why:** restates the D11 rule as a standing answer to "when do we promote".
- **Built in:** nothing to build. **Supersedes:** none. **Done:** Kevin said so on 2026-10-11; see D42.

### D28. Fix the slicer-contrast review findings at the cause (DECIDED 2026-10-08)

- **Decided by:** Kevin.
- **Date:** 2026-10-08.
- **Decision:** Build out every finding of the two code reviews of Land #197 (the orange slicer chips' text colour). All are fixes, so
  each app change went into production and the 2.5 build alike (D11):
  1. SlicerBtn takes a `tone` from one `SLICER_TONES` map that pairs each fill with its text colour; the optional `textClass` that
     defaulted to white is gone. Every call site names its slicer (`data-slicer`).
  2. A faded chip (a sibling selected) fades its fill only (`bg-…/40`) with full-strength black (light) or white (dark) text, instead
     of `opacity-40` on the whole button, which left every faded chip in every slicer near 2:1. Same for AP Frozen / AP Only.
     **This is a visible change:** faded chips now read as a pale tint of their colour with dark text, not a washed-out chip.
  3. White on `orange-600` (schedule-change dismiss ×, Schedule Change Details header) and on `yellow-600` (Auto-Refresh "Turn On")
     moved to the `-700` shade; the new-version dismiss × in dark mode moved from `emerald-600` to `emerald-700`.
  4. The grey chip for a selection the other filters leave no row for (`SLICER_INVALID`) was `#a1a1aa` text at `opacity-70`,
     1.63:1 though still clickable; it is now zinc-600 / zinc-300 text at full opacity (6.24:1 / 6.97:1). Added with Kevin's
     "land it and fix all issues and gaps" (chat, 2026-10-08).
  5. `tests/check_color_contrast.js` (headless) and the `Slicer_Contrast` regression suite hold all of it to 4.5:1. The tests
     select chips by `data-slicer`, not by colour, so SPC PIC and Yard (both orange) can no longer be mistaken for each other.
- **Kevin's words (chat, 2026-10-08):** "okay build yjosre out" (read as "build those out", after the two review result lists).
- **Not done:** an orange `dark:` variant. Black on `#ed7d31` is 7.6:1 in either theme, so contrast does not need one.
- **Built in:** the PR from `claude/code-review-6xty7w`. **Supersedes:** none.

### D29. Keep the three pre-existing colour pairs under 4.5:1 (DECIDED 2026-10-08)

- **Decided by:** Kevin.
- **Date:** 2026-10-08.
- **Decision:** keep all three as they are. They stay listed in `KNOWN_EXCEPTIONS` in `tests/check_color_contrast.js`, so every
  other pair is still held to 4.5:1 and the check fails if one of these three disappears or moves.
- **Kevin's words (chat, 2026-10-08):** "keep them the same".
- **The question he was asked:** the first run of `tests/check_color_contrast.js` found three pairs that look like deliberate colour choices
  rather than mistakes, so they were left as they are and listed in its `KNOWN_EXCEPTIONS`:
  1. POL "Coastal ETA vs Proforma" cell: blue `#3172C4` on tan `#DDD9C3`, 3.41:1 (Excel reference colours).
  2. Sector Summary "Utilization" over 100%: `text-red-600` on `#DA9694`, 2.02:1 (Excel conditional-format colours).
  3. A macro toggle button in its "shown" state, dark mode only: `gray-400` on `#3d5a34`, 3.05:1.
- **Options:** keep them (the check keeps them listed, and fails if one disappears so the list cannot go stale), or darken the text
  (measured: `#1f4e8c` on the tan is 5.85:1; on `#DA9694` even `red-800` is only 3.47:1 and `red-900` 4.18:1, so a passing red is
  as dark as `red-950` (`#450a0a`, 6.74:1), which barely reads as red; `gray-200` on the dark green is 6.26:1).
- **Built in:** nothing to change; the PR from `claude/code-review-6xty7w` already lists them. **Supersedes:** none.

### D30. Analyze's Breakdown by POL has no "NO N.A. CALL" card (DECIDED 2026-10-08; supersedes the "NO N.A. CALL" clauses of D13, D17 and D24)

- **Decided by:** Kevin.
- **Date:** 2026-10-08.
- **Decision:** On the POL Booking Flash tab, Analyze (POL Performance Summary) no longer shows a card for the POL value
  "NO N.A. CALL" (a sailing that skips North America; not a port). The card and its row in the Excel export are gone; the
  "(blank)" card was already left out the same way (2026-09-10). Left as they were: the Overall Snapshot and the weekly trend
  (the all-zero group adds nothing to them), the "By port" averages (which already excluded it), and the POL table itself and
  every other tab, which still list the NO N.A. CALL legs.
- **Kevin's words (chat, 2026-10-08):** "Please remove no NA call. Out of the analyze buttons we don't need to see it. as its not
  useful infomation out of the analyze buttons. We don't need to see. See it in this tab." (read as: drop it from Analyze; the
  data stays in the table tab). Asked which file(s), he picked "Both files".
- **Consequences he was told:** in the 2.5 build the card had a "Show in table" button that filtered the POL column (D13, D17, D24).
  With no card there is nothing to press, so that branch of `showAnalysisGroupInTable`, the tab-leave restore of the POL header
  filter (D17) and their three regression checks went. Yard and Lane cards are unchanged. The button's Undo no longer has a header
  filter to put back; no remaining check exercises Undo's header-filter half, because the button no longer sets one.
- **File placement:** both files. It is a removal of a display item rather than a bug fix, but it was made in both so the testing
  build stays production plus its features (D11) and the drift check stays green; the 2.5-only parts above went in 2.5 only.
- **Built in:** the PR from `claude/dreamy-allen-osp4i2`. **Supersedes:** the "NO N.A. CALL" parts of D13, D17 and D24 (their
  Yard/Lane and Sale Week parts stand).

### D31. SPC PIC slicer chips go back to their original white text on orange (DECIDED 2026-10-08; supersedes D28 for SPC PIC only)

- **Decided by:** Kevin.
- **Date:** 2026-10-08.
- **Decision:** At rest and selected, the SPC PIC chips are white text on `#ed7d31` again, as they were before D28 (commit `c2427cc` had made
  them black). Yard keeps D28's black text on the same orange. SPC PIC gets its own tone, `orangeLegacy`, in `SLICER_TONES`, so the two
  slicers no longer share one. White on that orange is 2.77:1, below the 4.5:1 floor D28 set; Kevin chose the original look anyway, so it
  is a **named exception**, like D29's: `TONE_EXCEPTIONS` in `tests/check_color_contrast.js` (solid state only, SPC PIC only; it fails if
  the exception goes stale or another slicer uses the tone) and `isLegacyException` in the `Slicer_Contrast` regression suite (SPC PIC's
  solid chip, exactly white on `#ed7d31`; each at-rest check also requires such a chip to exist).
- **Kevin's words (chat, 2026-10-08):** "Make the slicers. For space PIC back to. The original colors." (voice-typed; read as: SPC PIC
  slicers back to their original colours). The screenshot he attached showed the SPC PIC chips orange with black text.
- **Read as, and not done:** the faded state (a sibling selected) is unchanged: D28's pale-orange fill with dark text, not the old
  whole-button `opacity-40` wash. If he wants that back too, it is a separate change (it would need a second exception, 2:1).
  Only SPC PIC changed; no other slicer's colours moved.
- **File placement:** both app files. It reverts part of a fix (D28), so it went into production and the 2.5 build alike (D11).
- **Built in:** the PR from `claude/dreamy-allen-osp4i2`. **Supersedes:** D28's SPC PIC text colour (its Yard, faded, AP and invalid-chip
  parts stand).

### D32. A Dry / Reefer cargo slicer on the summary tabs, instead of a cargo-nature row split (the slicer, its two formulas and reefer-against-reefer-capacity Utilization DECIDED 2026-10-08; Sector Summary DECIDED 2026-10-08 as not built, no reefer column in its sources, SUPERSEDED by D35 on 2026-10-09; the "Still proposed" items below PROPOSED)

- **Decided by:** Kevin, through the meeting notes he pasted with the instruction "DO this task" (chat, 2026-10-08). The notes record Adam
  Cosner proposing it and Kevin Lee agreeing to build it; whether those are the same person as the repo's "Kevin" is not stated in the
  notes, so the entry rests on the instruction to build it, not on that identification.
- **Date:** 2026-10-08.
- **What the notes say (quoted):**
  - "The summary tabs will use a dry and reefer slicer to dynamically aggregate vessel data instead of splitting rows by cargo nature."
  - Why: adding cargo nature to the dataset "broke the structure from one line per vessel into multiple lines because every vessel has
    multiple cargo natures", and the slicer avoids "expanding the data from 10,000 lines to 50,000 lines".
  - "selecting 'reefer' should aggregate the reefer booking TEU numbers for the vessel. Selecting 'dry' must aggregate the current laden TEU
    minus the reefer. Selecting both options will allow it to function as it currently does by combining the two."
  - Next steps: "Add Cargo Slicer: Create a toggle button on the summary tabs to filter between dry and reefer cargo types." and "Configure
    Aggregation Logic: ... Configure the dry total to represent laden TEU minus reefer data."
- **Decision:** one row per vessel stays as it is (no new rows, no new data source). A two-chip Dry / Reefer slicer changes which TEU
  measure the table sums: **Reefer** = `Measures Reefer TEU` (`rfrBkgTtl`); **Dry** = `Measures Laden TEU` (`ladenTeu`) minus
  `Measures Reefer TEU`; **both, or neither** = `ladenTeu` exactly as today.
- **Measured on 2026-10-08 (8/12 export, 964 rows, `openpyxl`):** reefer TEU is above zero on 456 rows and above laden TEU on none, so Dry is
  never negative there; the totals reconcile: laden 282,414 = dry 255,376 + reefer 27,038.
- **Column mapping confirmed (chat, 2026-10-08):** "Measures Laden TEU = Current Laden TEU". So the notes' "current laden TEU" is the
  `Measures Laden TEU` column (`ladenTeu`), the one Trade Summary's Total TEU already sums, and Dry = that minus `Measures Reefer TEU`
  (both overall-scoped, so the two sides of the subtraction cover the same sailings). Not to be confused with the app's "Current Laden"
  column label, which is `curLaden` = `Measures POL Laden TEU`, a POL-scoped column the Trade Summary does not use.
- **Same ask again, from the Reefer MKG notes (chat, 2026-10-08):** "Add a Reefer/Dry filter to the summary tabs. I can explain in more
  detail later, I have a couple ideas." Nothing in it changes what was built.
- **Kevin's answers to the three open points (chat, 2026-10-08), quoted:** "1. We would like to see see our filter, the cargo by refers.
  2. Then I think we should do refers against refers total capacity. Or just have it be able to toggle that versus the total amount. 3yes".
  How each was read (tell me if a reading is wrong):
  1. **Sector Summary:** read as "put the cargo filter on Sector Summary too". **Not built:** it cannot be done correctly from today's
     feed (evidence in "Sector Summary" below); settled by Kevin's follow-up below (no reefer column in the source, so no reefer there).
  2. **Utilization:** **DECIDED.** With Reefer alone, Utilization is reefer TEU over the **reefer** capacity, and the Max Laden row becomes
     the reefer capacity it is divided by; a toggle switches it back to the vessel's total Max Laden. The reefer capacity is the vessel-wide
     `Measures BSA TEU RF` (`rfrBsaTeuRfMax`), the same denominator the Detail tab's "RFR Utiliz %" already uses, **not** `RFR Max Laden TEU`
     (`rfrMaxLdn`): an earlier version of this entry offered that column, but it is a per-port figure (0, 20 or blank on different legs of one
     voyage; see the comments at its `getVal` and at the `tableData` override), so a lane-level maximum of it is not a capacity.
     **Dry has no capacity of its own:** the obvious one, Max Laden minus reefer capacity, goes negative on 45 of the 885 rows that have a Max
     Laden (FLX: Max Laden 300, reefer allocation 400), so Dry is always measured against the total Max Laden and the toggle is offered
     only with Reefer alone. Default basis: reefer capacity ("I think we should do refers against refers total capacity"); the toggle is
     the "or".
  3. **"yes":** read as agreeing that the chips are session-only (they reset on reload) and are not cleared by Clear Filters. Built that way.
- **Kevin's follow-up after the merge (chat, 2026-10-08), quoted:** "Don't change any of the calculations for anything with what we just
  added today. The, the toggles are just so meant so we can focus on reefers we are not changing the calculations for any of the dry... We
  are not changing the calculations for any of the drive. If, if there's no refer columns in the source data, then there is no refer in it.
  So we don't need it. You can add reefer columns to those sources." How it was read (tell me if a reading is wrong):
  1. **Calculations: nothing changed, Dry stays as built.** The chips and the capacity toggle exist to focus on reefers. With neither or both
     on, every number is the one the tab showed before; Dry is Laden TEU minus Reefer TEU over the total Max Laden, with no capacity of its
     own (the "Dry has no capacity" finding above), so the reefer-capacity change never touches Dry. No further change was made for this.
     If "not changing the calculations for any of the dry" meant Dry should show the plain total, that is a one-line change; say so.
  2. **Sector Summary: closed as not built.** "If there's no reefer column in the source data, then there is no reefer in it, so we don't need
     it": there is no reefer on that tab until its sources carry one. No reefer figure is derived from other columns.
  3. **"You can add reefer columns to those sources":** not possible from this repository. The left table's two measures arrive inside the
     export, built upstream, and the right table is a Google Sheet published to the web (`SECTOR_DATA_CSV_URL`, read-only here); no file in
     the repo holds reefer figures by sector or by lane-week average, so they could not be filled in even if the columns were added. What is
     needed upstream, by whoever owns each feed (names are a suggestion; the app maps whatever is chosen):
     - **Export, for the left table:** a reefer twin of `Trade Summary Avg Booking` and of `Trade Summary Avg Max Laden` (the reefer capacity,
       to match the Trade Summary basis), computed the same way over reefer cargo only.
     - **Sector sheet, for the right table:** reefer versions of `Measures Laden TEU`, `Average Booking`, `MCT Sector Allocation` (or
       `Sector Allocation`) and `Sector Open Space`, by Trade, Sub Trade, Lane and POD Sec.
     Once a feed carries them, wiring the tab is a column swap like the Trade Summary's, built and checked against that real sample.
- **Measured for the capacity decision (2026-10-08, 8/12 export, 964 rows, parsed with the app's own CSV reader):** `Measures Reefer TEU`
  never exceeds `Measures BSA TEU RF` (0 of 885 rows with a Max Laden); BSA TEU RF is constant within every one of the 334 multi-row VVDs
  (so a per-lane maximum picks the vessel's value, as Max Laden's does); across the 85 Trade Summary cells, reefer over total Max Laden
  never passes 100%, and reefer over reefer capacity passes it in 1 cell (TPT / PN / 2026/W29: 348 reefer TEU over 346 capacity), which the
  table shows in the usual red.
- **Sector Summary (DECIDED 2026-10-08: not built, see the follow-up above), what was checked:** its left table (`past4WeekRows`) sums `Trade Summary Avg Booking` and `Trade Summary Avg Max
  Laden`, precomputed measures; they do not rebuild from the rows. Per lane, the sum of Avg Booking over the Past-4-Week rows equals Laden
  TEU divided by 4 only for some lanes (FLX 278 vs 278.25, PN1 1,034 vs 1,034.75), and not for others (AN2 158 vs 118.5, FP2 1,468 vs 1,101,
  PS4 1,337 vs 1,670), so a reefer average derived the same way would sit beside a measure it does not agree with. Its right table reads the
  sector Google Sheet, whose columns are Trade, Sub Trade, Lane, POD Sec, MCT Sector Allocation, Measures Laden TEU, MCT Voyage Count,
  Average Booking, Sector Open Space and Sector Allocation (`tests/fixtures/sector_data_2026-09-16.csv`): no reefer column.
- **Still proposed (built that way; Kevin to confirm or correct):**
  1. **Trade Summary only** (see Sector Summary above for why).
  2. **The Total TEU row is renamed while one chip is on** ("Reefer TEU" / "Dry TEU"), and the Max Laden row is renamed "Reefer Max Laden"
     while Reefer is measured against reefer capacity, so a reader cannot take reefer-only numbers for the total.
  3. **Chip behaviour is the app's usual slicer contract:** click isolates, Alt/Ctrl/Cmd/Shift-click adds the other, nothing selected means no
     restriction. Independent of every other slicer (D24: a feature does not change a slicer the reader set). The capacity toggle is
     session-only as well.
  4. **Dry is not clamped.** If a row ever had more reefer than laden TEU, Dry would show the negative difference rather than a made-up zero.
- **File placement:** the 2.5 testing build only. It is a feature, so it is not in the production file (D11).
- **Built in:** the PR from `claude/compassionate-maxwell-irz3vm`. **Supersedes:** none.

### D33. Excel-style filters on each column of the Booking Flash and POL Booking Flash tables (the ask DECIDED 2026-10-08; the design below PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-08), first relaying the Reefer MKG notes: "A way to filter > or < a numerical value ... I can explain in
  more detail later, I have a couple ideas." Then, explaining the idea: "can we make the filters on top of um, each column on the tables
  more Excel like with the type of filtering you can do in in a column there?" So the "above or below a value" note is delivered here, as two
  of the number conditions.
- **Reading (tell me if wrong):** "the tables" = Booking Flash and POL Booking Flash, the only two that have a filter box over each column
  (Trade Summary, Sector Summary and Compare have none). "Excel like" = the AutoFilter menu on a column: conditions (equals, begins with,
  greater than, between, top 10 ...), a searchable list of the column's values with Select All and Blanks, and Clear Filter.
- **Constraint from the same message:** "Don't change any of the calculations for anything with what we just added today." Nothing here changes
  a number: the new filters only choose which rows a table shows (design 3).
- **Measured before designing (2026-10-08, 8/12 export, each box given a value its own cells display):** the existing box is a "contains"
  match on the raw per-leg row, before a vessel's legs are combined, so it cannot find a value the table computes afterwards. On Booking Flash
  9 of the 47 boxes that have a displayed value return **no rows**: Standby Threshold, Current Laden (TEU), Peak Utiliz %, Current Laden Utiliz %,
  RFR Max LDN, RFR Utiliz %, Activity vs Booking Utilz, Activity vs Max Laden and LNT. On POL 5 of 49: RFR Utilz%, POL Laden Thresh, Peak
  Utilz, Last ETA and Voyage Remarks (there the cell shows a re-formatted value, e.g. "60%" over a raw 0.6). These are exactly the number
  columns "above or below a value" is wanted on. The new menu reads what the cell shows, so it works on every column.
- **Design (PROPOSED; built that way, nothing irreversible):**
  1. **The quick box stays exactly as it is** (a contains match on the raw row, shared across tabs per D18, narrowing the summaries as it
     does today). The new menu is a funnel button on each filter cell, so no existing behaviour changes. When both are used on a column, a row
     must pass both.
  2. **The menu** (Excel's AutoFilter, per column type): *text* equals / does not equal / begins with / does not begin with / ends with / does
     not end with / contains / does not contain, with `*` and `?` wildcards and no case sensitivity; *number* (plain, percent, accounting
     such as `(-19)` and `+105`) equals / does not equal / greater than / greater than or equal / less than / less than or equal / between /
     top N / bottom N / above average / below average, where the typed value is what the column shows (type 80 for 80%); *date* equals /
     does not equal / after / on or after / before / on or before / between. "Between" is inclusive and takes its bounds in either order (Excel
     returns nothing for reversed bounds, which would read as a bug). Up to two conditions joined by And / Or. Instead of
     conditions, a searchable checklist of the column's distinct shown values with Select All and (Blanks). OK applies, Esc or a click
     outside closes without applying, Clear filter removes the column's filter.
  3. **Conditions are evaluated on what the cell shows** (after a vessel's legs are combined on Booking Flash) and only choose **which rows the
     table shows**. They never change a number, a total, a summary tab, Analyze or the notes list, and they do not follow the reader to the
     other table. The Booking Flash Excel export, a scrape of the table, follows what is shown; POL's export is built from the same rows.
  4. **Top N, bottom N, above and below average rank against every row the table would show without column conditions** (after the slicers
     and the quick boxes), so one column's ranking does not move when another column's condition changes. Ties at the cut-off are all kept.
     The checklist lists the values left after the *other* columns' conditions, as Excel's does.
  5. **Session-only, one set per table.** Not saved with the filter preferences, not in shared-view links. Clear Filters clears them;
     hiding a column drops its condition (as it does for the quick box). A line above the table lists the active conditions, each with a
     remove button, so a narrowed table never has an unexplained cause.
  6. **Not built** (say if wanted): sorting from the menu, filter by colour, date shortcuts such as "next week", and saving a condition.
- **Follow-up (asked for by Kevin 2026-10-09, see D40):** fixing the quick box on the dead columns. The measured count there is 32 columns
  (the "14" above was one sample value per column), and the design chosen is the first of the two options this entry offered.
- **File placement:** the 2.5 testing build only (a feature, D11).
- **Built in:** the PR from `claude/compassionate-maxwell-irz3vm`. **Supersedes:** none.

### D34. The "Data as of" stamp moves from under the title into the Settings panel (DECIDED 2026-10-08; supersedes the placement and the toggle of the stamp in D15)

- **Decided by:** Kevin.
- **Date:** 2026-10-08.
- **Kevin's words (chat, 2026-10-08), in order.** First, with a screenshot of the Trade Summary tab showing the line: "remove Live feed · fetched
  2:56 PM (18 min ago) that banner its npt needed". Then, while that removal was being built: "just move it into settings".
- **Decision:** the one-line stamp (roadmap slice 1.1: "Live feed · fetched ...", "Uploaded file · ...", "Cached copy · ...", "Historical · ...")
  is no longer in the masthead. It is a status line inside the Settings panel, with the same wording, the same amber "older than
  expected" warning and the same 30 s age clock (which now runs only while the panel is open). It sits just above the existing
  "Data: shared server copy (downloaded ...)" line, which is unchanged (shared tests assert it on both builds).
- **The "Data stamp" toggle is removed.** Its tooltip said "next to Last Refresh"; with the line in Settings, which is not on screen until
  opened, there is nothing to switch off. The app no longer reads or writes `bookingFlashFeedStamp`.
- **Why the toggle's old value is a trap, and why it is ignored rather than honoured:** the preference hook wrote its value to localStorage
  on every page load, so every browser that ran the testing build holds `'1'`, and anyone who had switched the line off holds `'0'`. A
  default flipped to off would never have reached the people who had seen the line (the stored `'1'` wins), and honouring a stored
  `'0'` would hide the line in Settings from exactly the people who did not want it in the masthead. So the stored value is ignored and
  left alone; a test boots with `'0'` stored to keep it that way.
- **Not asked, so not built:** a stale-feed warning anywhere else. The amber "older than expected" text is now visible only when someone
  opens Settings, so it is no longer a thing a person notices without looking. If that matters, it is a new decision.
- **File placement:** the 2.5 testing build only. The production file never had the stamp, so nothing was ported.
- **Tests:** counts unchanged (`Feed_Stamp` 28, testing-2.5 569, main 391). The stamp is in the page only while Settings is open, so
  the suites that read it open the panel first (`w3.showStamp`, which leaves it open: the panel closes on a mousedown outside it, never on
  the programmatic click the checks use). `Feed_Stamp` gained "not under the title" (nothing in the page with Settings closed) and lost the
  two toggle checks for one "no such setting" check; its reload boot became the old-preference boot. The `Offline_Cache` checks that read the
  stamp are otherwise unchanged.
- **Built in:** the PR from `claude/inspiring-cerf-3nu64s` (2.5 testing build only). **Supersedes:** where the stamp sits and its Settings toggle
  (slice 1.1 as built in #168 and described in D15); D15's wording and stale-factor answers (Q2, Q4) stand.

### D35. The Dry / Reefer cargo slicer reaches Sector Summary (the ask DECIDED 2026-10-09; the left-table formulas below PROPOSED; its right-table layout and formulas SUPERSEDED by D37 the same day; supersedes the Sector Summary clause of D32)

- **Decided by:** Kevin.
- **Date:** 2026-10-09.
- **Kevin's words (chat, 2026-10-09, with a screenshot of the Booking Flash table with its "RFR Max LDN" column circled), quoted:** "So, when Reefer
  is selected in isolation on the Sector Summary tab, the AVG Max Laden should revert to the avg of the overall RFR Max LDN for that lane. AVG
  Booking = the AVG Reefer TEU for that lane and so on. The sector allocations are technically inclusive of Dry & Reefer so that number can remain
  the same, but the AVG Booking should be Reefer specific. So, I thinking we need to break it out in two lines per POD, one Reefer and one Dry,
  then have the report aggregate for the combined total when both Dry & reefer are selected together. That make sense? The open space field is not
  really going to make sense if Reefer is selected, but I'll let them know about that nuance. not much we can do there without a designated RFR
  sector sub-allocation.... you can build this out with 3 agents if needed".
- **Why this supersedes D32's "not built":** D32 closed Sector Summary on Kevin's 2026-10-08 line "if there's no refer columns in the source data,
  then there is no refer in it". That held for the right-hand table (the sector Sheet had no reefer or cargo column when fetched earlier on 2026-10-09, still the
  same ten headers as `tests/fixtures/sector_data_2026-09-16.csv`; it changed later that day, D37) and Kevin's answer here was the way to get one: two lines per POD in that Sheet.
  It did not hold for the left-hand table, whose rows are the Booking Flash export rows that already carry the reefer columns he points at. The
  rest of D32 (Trade Summary, its capacity toggle, "Dry stays as built") is untouched.
- **"RFR Max LDN" is `Measures BSA TEU RF`, not the per-port column.** The circled column on the vessel-level Booking Flash row is
  `rfrMaxLdn` overridden with `rfrBsaTeuRfMax` after the legs are aggregated (cross-checked against the reference workbook, 26 of 26 multi-leg
  vessels; the `tableData` comment above `row.rfrMaxLdn = rfrBsaTeuRfMaxNum`). The raw per-leg `RFR Max Laden TEU` is a per-port figure (100 at one
  port, 400 at the next, on one PN1 voyage), so averaging it per row would pit a per-port capacity against a vessel-total booking. Measured on
  the 8/12 export (964 rows, `openpyxl`), PN1: reefer average booking 367 against the per-row mean of the raw column (211) is 174%, against the
  vessel-level figure (472) it is 78%. So "the avg of the overall RFR Max LDN" is read as the vessel-level figure, the same one D32 already chose
  as the reefer capacity.
- **How the existing measures are built (measured 2026-10-09, same export: 223 Past-4-Week rows, 222 after the EXE/EXW drop, 25 lanes):** `Trade
  Summary Avg Max Laden` is one value per lane repeated on its rows (0 on some placeholder rows), and the tab takes the lane's maximum. `Trade
  Summary Avg Booking` is per row and sums per lane; in 12 lanes it is the row's Laden TEU / 4 (PN1: 420 -> 105), and in the other 13 the lane's
  Laden TEU over its Avg Booking is not 4: 2 for AT4, EMA and WIN; 3 for AL5, AN2, AT3, EC4, FP2, PN3, PS7, PS8 and VSE; 5 for PS4 (AT4: 355
  against 706 / 4 = 176). It is a precomputed upstream measure and cannot be rebuilt from the rows, so a reefer version must be a share of it,
  not a second division. In the same rows: no row has more reefer than laden TEU, no row has zero laden and some reefer, none has laden above
  zero and an Avg Booking of 0, and the 15 VMS placeholder rows carry no reefer capacity or booking, so they cannot move a reefer figure. One
  vessel (PS4 YUNT0080W, 2026/W27) has a reefer capacity of 572 and a Max Laden of 0; it counts in PS4's reefer average because the rule is
  "reefer capacity above 0".
- **Decision, left table ("Average Max Laden vs Booking", one row per vessel leg, so no new rows and no new data):**
  - **Neither chip, or both:** exactly today. No new row objects, same labels, same numbers.
  - **Reefer alone:** Avg Booking = for each row, `Trade Summary Avg Booking` x (`Measures Reefer TEU` / `Measures Laden TEU`), 0 when the row's
    Laden TEU is 0, then summed per lane. Where the upstream divisor is 4 this is the lane's reefer TEU / 4, "the AVG Reefer TEU for that lane";
    where it is not, the reefer figure stays on the same basis as the total beside it. Avg Max Laden = the mean, over the lane's distinct vessels
    (VVD, or vessel name when the VVD is blank) that have an `rfrBsaTeuRfMax` above 0, of that vessel's `rfrBsaTeuRfMax`. A lane with no such
    vessel shows 0, as a lane with no Max Laden does today. "Avg Max Laden vs Bkg" and "Avg Utilization" are the same two formulas on that pair.
  - **Dry alone:** Avg Booking = `Trade Summary Avg Booking` x (1 - reefer / laden) per row, summed; Avg Max Laden stays the lane's total, because
    Dry has no capacity of its own (D32: Max Laden less reefer capacity is negative on 45 of 885 rows). Not clamped, like D32.
  - **Invariant (tested):** per lane, Reefer Avg Booking + Dry Avg Booking = today's Avg Booking.
  - The labels follow the mode ("Reefer Avg Max Laden", "Reefer Avg Booking", "Dry Avg Booking") so reefer numbers cannot be read as the total.
  - No capacity toggle here: Kevin asked for the reefer figure only. Offering "against total capacity" is a one-line addition if he wants it.
- **Decision, right table ("Sector Summary", the sector Sheet): SUPERSEDED by D37 (2026-10-09).** This entry proposed that the Sheet's owner add two
  lines per POD, one Reefer and one Dry, in a `Cargo Nature` column, with Sector Alloc the same in every mode, Average Booking summed over the selected
  lines and Open Space computed in the app. The owner built something else the same day: one line per POD with a DRY block and an RFR block side by side,
  each with its own Average Booking, Open Space and Sector Allocation. D37 records that layout, what the app does with it, and Kevin's three readings.
  The `Cargo Nature` reader, its invented test Sheet and the formulas above are gone. What survives from this clause: the app never invents reefer
  numbers per POD (it reads them from the Sheet), and a one-block Sheet still reads and the chips then leave the right table alone.
- **Chips:** the same Dry / Reefer chips as Trade Summary, sharing its state (one cargo choice for the summary tabs, session-only, not cleared by
  Clear Filters, same chip contract). Inside the screenshot export's capture. No capacity toggle on this tab.
- **Answer to "That make sense?":** yes, with the split of work above: the left table needs no second line, the right table does and only the Sheet
  owner can add it (the owner then built the DRY / RFR blocks, D37).
- **File placement:** the 2.5 testing build only. It is a feature, so it is not in the production file (D11).
- **Built in:** the PR from `claude/charming-heisenberg-jkmeho`. **Supersedes:** the Sector Summary clause of D32 (its "not built"); D32 stands for
  everything else.

### D36. The Selection Report Card gets a Total row (the ask DECIDED 2026-10-09, and Planned / Actual Mty summed per POL CONFIRMED the same day; the other per-column rules below PROPOSED)

- **Decided by:** Kevin.
- **Date:** 2026-10-09.
- **Kevin's words (chat, 2026-10-09, with a screenshot of the POL Booking Flash Report Card showing three selected rows), quoted:** "Can we add a total
  row to the report card aggregating just the numerical values of all the selections made? Steve had mentioned, he missed having the ability to
  highlight a column of values and see the total can be done in Excel. This would give the same thing, basically."
- **What it is:** a last row, "Total", in the Selection Report Card on both Booking Flash and POL Booking Flash, shown when two or more rows are
  selected (one row has nothing to add up). It is part of the card's `<table>`, so the CSV and Excel exports, which scrape that table, carry it too.
  Text columns are blank except the first cell ("Total"). Every total is the sum of the cells AS DISPLAYED (each cell is already rounded), so the
  column visibly adds up, and a row the card blanks (a VMS placeholder) adds nothing.
- **Why "just sum every column" would be wrong on one tab (measured 2026-10-09 on the 8/12 export, 964 rows, `Data_download`):**
  - *Booking Flash (Detail):* one row per vessel. Of the 375 VVDs only the `VMS` placeholder maps to more than one Detail row, and its cells are
    blank, so a plain sum of Max LDN, Current Laden, Short_Fall, ONE Quote and Broken Routes is exact.
  - *POL Booking Flash:* one row per VVD and POL leg, and BSA TEU is a VESSEL-level value repeated on every leg: 332 of the 334 multi-leg VVDs carry
    one identical value on all their legs. Highlighting the four POLs of POHT0076E and summing would show 4 x 2,686 = 10,744 instead of the
    vessel's 2,686. So BSA TEU counts once per vessel (the largest displayed value, if a vessel's rows differ: 2 of the 334 do).
  - *The other POL columns add across legs.* POL Max Laden is a partition of the vessel's Max Laden: YMKT0113W 900 + 1,200 = 2,100 = its Booking Flash
    Max LDN, POHT0076E 650 + 700 + 400 + 650 = 2,400 = its Max LDN (it does not hold for every vessel: the leg sum exceeds the vessel's Max Laden on
    12 of 333, so it is not a rule to build on, only to cross-check). Discharge and POL Laden are per leg like the Booking Flash rows that sum them.
- **The rules (PROPOSED):**

  | Tab | Summed | Once per vessel | Left blank |
  |---|---|---|---|
  | Booking Flash | Max LDN, Current Laden (TEU), Max LDN vs BKG (Short_Fall), ONE Quote (TEU), Broken Routes | none | Standby Threshold, Peak Utiliz %, Current Laden Utiliz % |
  | POL Booking Flash | POL Max Laden, Discharge, Current Laden, Planned Mty, Actual Mty | BSA TEU | POL Laden Threshold |

  Percent columns are blank because percentages do not add: 3 x 80% is not 240% utilization, and a utilization for the whole selection is a ratio of
  two totals that the card does not carry (Current Laden Utiliz % is built from a different raw column than the Current Laden shown). A column with no
  number in any selected row also totals blank, not 0. Short_Fall keeps the app's accounting format ("(-105)").
- **CONFIRMED (Kevin, chat, 2026-10-09, answering the question this entry left open), quoted:** "Planned and Actual Mty are per-POL". They are 0 on
  every row of the 8/12 export, so the data alone could not say whether they repeat per vessel like BSA TEU or differ per leg like Laden and Discharge;
  per-POL means the latter, so they are summed, as built. `REPORT_CARD_VESSEL_LEVEL_KEYS` stays `['bsaTeu']`. Their totals can only be checked as 0
  against the export (no non-zero row exists); a non-zero case would need a synthetic feed.
- **Not done:** no Average / Count / Min / Max next to the Sum (Excel's status bar shows them; Kevin asked for the total), no total for the percent
  columns, and no change to what the card selects or how it exports.
- **File placement:** the 2.5 testing build only. It is a feature, so it is not in the production file (D11).
- **Built in:** the PR from `claude/charming-heisenberg-jkmeho`, as its own commit.

### D37. The sector Google Sheet now has two header rows and DRY / RFR blocks: the app reads it again, and the Dry / Reefer chips follow the blocks (the Sheet's layout and Kevin's three readings DECIDED 2026-10-09; the whole-POD rule below PROPOSED; supersedes the right-table clauses of D35)

- **Decided by:** Kevin.
- **Date:** 2026-10-09.
- **Kevin's words (chat, 2026-10-09, with a screenshot of the updated Google Sheet "Booking Flash Report Data - Sector"), quoted:** "it has two rows of
  labels like this". Then, to the three questions below: "yes to all of your questions".
- **What the Sheet is (fetched from the published URL, 2026-10-09; saved as `tests/fixtures/sector_data_two_header_2026-10-09.csv`):** 16 columns, two
  heading rows, 41 PODs, still one line per POD. Row 1 labels: `Booking Cargo Nature` over POD Sec, `DRY` over the six columns E-J, `RFR` over K-P. Row 2
  names: Vessel 1st Trade, Vessel 1st Sub Trade, Vessel 1st Lane, POD Sec, then in each block MCT Sector Allocation, Measures Laden TEU, MCT Voyage Count,
  Average Booking, Sector Open Space, Sector Allocation. D35 had asked for two lines per POD in a `Cargo Nature` column (PROPOSED, unconfirmed); this is what
  the owner built instead, and it is better for the app: the reefer figures are in the Sheet, nothing is derived.
- **The break (measured 2026-10-09, reproduced in a browser on the unfixed production file):** the app read the Sheet with `sheet_to_json`, which takes the
  first row as the header. On the new Sheet that row is the labels, so every line had no `Vessel 1st Sub Trade`, the gate against the export's Sub Trade | Lane
  pairs dropped all of them, and Sector Summary's right-hand table was EMPTY, with no banner and no error (the fetch itself had succeeded). It hit production,
  not only the 2.5 build. Nothing server-side is involved: `DataFeeds.gs` caches the text and rejects only an empty or HTML response.
- **What the Sheet's numbers are (measured on those 41 PODs; the app relies on these):**
  - In each block Average Booking = round(Laden TEU / Voyage Count) and Sector Open Space = round(max(0, Sector Allocation - Laden TEU / Voyage Count)), the
    booking UNROUNDED (on every block that has a voyage count, in both blocks). So two bookings are added unrounded and rounded once: AT1 NLRTM is DRY 1,101 / 4 = 275.25 plus RFR 22 / 4 =
    5.5, 280.75, shown 281.
  - The DRY block's Sector Allocation is the whole POD's allocation (it is the figure the old one-block Sheet carried): equal to the whole-POD allocation on 41 of 41.
    The RFR block's is the reefer share: the same on the 27 PODs that have one except two (AT1 FRLEH 176 -> 170, AT1 NLRTM 1,166 -> 820).
  - 14 of 41 PODs have no RFR figures at all (AT4 x5, EMA x4, EC3 x4, VSE x1). EMA GRPIR has an RFR allocation (99) but no voyage count, no booking and a blank Open Space.
  - Both blocks also carry `MCT Sector Allocation`; it differs from `Sector Allocation` in one place (EMA GRPIR, DRY: 115 against 99). The app keeps reading
    `Sector Allocation`, as it has since 2026-09-04.
- **Decision, the fix (a bug: the production file, `dist/`, and ported to the 2.5 build, D11):** the app reads the Sheet's cells instead of objects keyed by the first
  row. `readSectorSheet` (between two marker lines in the app file, so `tests/check_sector_layout.js` can run it) finds the heading row (the first of the top ten that
  names both Sub Trade and Lane), reads a `DRY` / `RFR` label row above it when there is one (a label covers the cells to its right until the next label, so
  merged and repeated labels read the same), finds every column by its heading, and returns the rows the table has always been built from. For the two-block
  Sheet the three numbers are the WHOLE POD, which is what the table showed before the Sheet changed: **Sector Alloc** = the DRY block's Sector Allocation (the
  total, Kevin's reading 3), **Average Booking** = the two blocks' bookings added and rounded once, **Open Space** = max(0, Sector Alloc - that unrounded sum),
  rounded. A one-block Sheet reads exactly as before (the same rows as the old reader on the 2026-09-16 fixture, tested).
  - **A layout it cannot read is a failed load, and says so:** no heading row, no POD Sec column, no Average Booking / Sector Allocation column, some columns under
    a label and some under none, or a labelled block with the same heading twice (a deleted RFR label would otherwise read as more DRY). The existing yellow
    "Couldn't load live Sector Allocation data" banner shows the reason and the last good rows stay on screen. Before this, the same situation was silence.
- **Decision, the chips (the 2.5 build only, a feature): CONFIRMED by Kevin ("yes to all of your questions"), the three questions being:**
  1. *Under Reefer, which Sector Alloc and Open Space?* The RFR block's own (AT1 NLRTM: 820 and 815), not the total (1,166) that D35 said to keep.
  2. *PODs with an empty RFR block (14 of 41)?* Shown, with 0 booking and 0 allocation (and 0 Open Space), not hidden.
  3. *Is the DRY allocation the total and the RFR allocation a reefer share of it?* Yes.

  So with exactly one chip on, the right-hand table shows that block's own Sector Alloc, Average Booking and Open Space exactly as the Sheet publishes them (a blank
  cell is 0); with neither or both, the whole POD above. The three headers say so only where the number's meaning changes: Reefer shows "Reefer Sector Alloc /
  Reefer Average Booking / Reefer Open Space", Dry shows "Sector Alloc" (its allocation is the total, the same as the whole POD's) with "Dry Average Booking /
  Dry Open Space" (Open Space under Dry is the total allocation less dry booking only). A note under the chips names the block being read. The chips themselves,
  the left table and Trade Summary are unchanged.
- **Shown as published, not tidied (EMA GRPIR, Reefer):** 99 / 0 / 0. The Sheet gives that block an allocation and nothing else, so Open Space is blank there and
  the app shows 0; it does not work out 99. Whether the blank is intended is a question for the Sheet's owner; changing it is a one-line decision here.
  **Superseded by D41 (2026-10-11):** Kevin chose to fix it in the app, not the Sheet; Reefer now shows 99 / 0 / 99.
- **Superseded:** the right-table clauses of D35 (the `Cargo Nature` column, "Sector Alloc is the same in every mode", Open Space computed in the app,
  the Cargo / Cargo Type aliases). Their reader and the invented test Sheet (`tests/fixtures/sector_data_split_cargo_SYNTHETIC.csv`,
  `tests/make_sector_split_cargo_fixture.js`) are deleted. D35's left table, chips and caption stand.
- **Tests:** `Sector_Layout` (both targets; fails 6 of 7 on the unfixed production file), the reworked right-hand half of `Sector_Cargo` (2.5), and
  `tests/check_sector_layout.js` (CI job `sector-layout`). All three read the committed copy of the real Sheet; the expected numbers come from a Python derivation, not the app.
- **File placement:** the reader, the loud banner, `dist/` and the production fix: the production file, ported to the 2.5 build in the same PR (D11, a bug fix).
  The `blocks` on each row, the chip wiring, the labels and the note: the 2.5 build only (a feature).
- **Built in:** the PR from `claude/charming-heisenberg-jkmeho`, in the same PR as the Planned / Actual Mty documentation correction (D36).

### D39. POL Booking Flash keeps a vessel's legs together inside a lane's sailing week, the vessels in order of their first sailing (DECIDED 2026-10-09)

- **Asked by:** Kevin (chat, 2026-10-09, with a screenshot of the POL Booking Flash table): "Can we have the report group the vessels together when we
  have multiple VVD's in the same sailing week? Rather than by individual ETD. So, first sort by Sales Week then VVD then ETD?"
- **Then, asked how the vessel groups should be ordered (A to Z by VVD, or by when each vessel sails; same chat, 2026-10-09):** "ordered by each vessel's earliest ETD". And, on the
  finished change: "you can merge when ready".
- **Reading (tell me if wrong):** "the report" = POL Booking Flash, the tab in the screenshot (Service, Sales Week, Coastal ETD, Port Cut, Status, VVD, Vessel Name, POL).
  It is the only table that can split a vessel: it has one row per port call, while Booking Flash has one row per VVD (measured below), so there is nothing to group there.
- **Before (the 2026-09-08 rule, a code comment from Kevin, not an entry here):** Trade, Sub Trade, Service, Sale Week, **Coastal ETD**, VVD, POL. A week's rows were in date
  order, so two vessels whose port calls interleave in time were shown interleaved.
- **Decision:** Trade, Sub Trade, Service, Sale Week, then **the vessel's group**, then Coastal ETD, then POL. Groups run in order of each vessel's earliest Coastal ETD in that
  lane's week; two vessels that first sail on the same day are ordered by VVD A to Z (not asked; the tie-break needed some rule, and VVD is the key Kevin named). Inside one
  vessel nothing changes: legs stay in ETD order, so the 2026-09-08 case (a PAROD leg sails last but sorts before USLAX alphabetically) still ends its vessel's block. A row with no
  vessel yet (VVD blank or "VMS") stays last in its lane's week, as its blank ETD put it before; not asked, built so the new order does not drop a grey placeholder row between two
  real vessels. Spacer rows, row spans, the Excel export and every number are unchanged (the export is built from the same sorted rows).
- **What was built first, and why it changed:** the first version of this PR read "VVD then ETD" literally and ordered the groups A to Z by VVD. Measured on the 8/12 export that moved
  10 row positions, of which 8 were `EC3 2026/W36`: ONE MONACO (`NCMT0031W`, sails 9/7) sat above ONE GRUS (`ONGT0031W`, sails 8/25) only because N sorts before O, though the two were
  never interleaved. That was put to Kevin as an open question with the alternative measured; he chose "ordered by each vessel's earliest ETD". Both versions group a vessel the
  same way; they differ only in which vessel's group comes first.
- **Measured (2026-10-09, 8/12 export, through the rendered POL table, 964 rows):** 434 lane-weeks (369 hold a real vessel, 65 are VMS alone, none shares a week with a
  real vessel); 5 hold two real vessels and the old order split 1 of them: `PS4 2026/W27` read YM UNIFORMITY (USLAX08, 7/12), YM UNICORN (USLAX08, 7/15), YM UNIFORMITY
  (USOAK08, 7/15). New order: 0 split; the same 964 rows; 2 positions change against the old order (both in `PS4 2026/W27`: UNIFORMITY's USOAK08 leg moves up to join its USLAX08 leg, and UNICORN's
  USLAX08 leg moves below it), `EC3 2026/W36` and the other three weeks read as they did. The A to Z version of this change differed from this one in 11 positions. In none of the 5 weeks do two vessels first sail on the same day, so the tie-break is proved on a copy of the fixture built to tie, not on
  the real data. Booking Flash: 0 positions change.
- **Booking Flash (the other table) is deliberately not changed:** one row per VVD there, so VVD-then-ETD would only turn its ETD order alphabetical. Asserted by a check, so a
  later edit that applies the new order to both tables fails it. If Kevin wants the same order there, say so.
- **File placement:** the 2.5 testing build only. It is a new ordering Kevin asked for, so a feature (D11); the production file keeps its order and nothing was ported.
- **Tests:** `POL_Vvd_Order`, 10 checks + tripwire, testing-2.5 only (589 -> 600 on its own base, 618 -> 629 once merged with D35 and D36; main stays 391). Expected values come from the rendered
  cells and the rule written in the suite, never from the app's comparator. Red runs (a throwaway worktree each, 2026-10-09): the A to Z comparator against the final suite fails exactly the 3 checks that encode the new rule (first-sailing order,
  the `PS4` known answer, the tie-break), 626 / 629, and nothing outside the suite; the final comparator with only the VVD tie-break reversed fails exactly the tie-break check, 628 / 629,
  because the real data holds no tie and only the built one reaches that line.
- **Why D39:** this entry was first numbered D35 and then D37, each time because the number below was already taken somewhere. `main` has since taken D35 and D36 (#213) and D37 (#216, the
  sector Sheet's two header rows), and the unmerged `claude/compassionate-maxwell-irz3vm` holds D37 and D38 (quick filter boxes), so this entry takes the next number free in all three places.
  That branch's own D37 now collides with the one on `main` and renumbers when it merges, whatever happens here.
- **Built in:** the PR from `claude/trusting-newton-naiytn` (2.5 testing build only). **Supersedes:** the within-week order of POL Booking Flash from 2026-09-08 (Coastal ETD
  before VVD); the Booking Flash order and the rule that legs run in ETD order inside a vessel stand.

### D40. The quick filter boxes find what a column SHOWS, on the 32 columns whose cell is built after the per-leg row (the ask DECIDED 2026-10-09; the design below PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-09): "Fix the quick filter boxes on the 14 dead columns -- why are they dead?"
- **Why they are dead (measured 2026-10-09, 8/12 export, current `main`):** the box under a column header (`headerFilters`) tests
  `String(rawRow[key])` on the raw per-leg rows, before a vessel's legs are combined and before the cell is formatted. A column whose
  cell is built later cannot be found by typing what it shows. Three flavours of the same cause:
  1. **The field does not exist on the raw row** (Booking Flash, 6 columns, 0 of 374 rows found): Standby Threshold, Peak Utiliz %,
     Current Laden Utiliz %, RFR Utiliz %, Activity vs Booking Utilz, Activity vs Max Laden. The raw row carries `standbyRaw`,
     `peakUtilRaw` and so on; the displayed string (`row.standby`...) is made in `tableData`. The box reads `undefined`, so no text matches,
     and because the box narrows `filteredRawRows` every tab goes empty.
  2. **The cell is summed or replaced across a vessel's legs** (Booking Flash, 20 columns, found 3% to 96% of rows): Current Laden (99 of
     374), RFR Max LDN (11 of 374; the cell shows the vessel-wide BSA TEU RF, the legs store the per-port figure), Port Total (109),
     Inland Total (177), Max LDN vs BKG, ONE Quote, Broken Routes, RFR BSA/BKG, Inland/Port Act and No Act, TPT..LET, DG TEU. A
     vessel with two legs of 46 and 9 shows 55, which neither leg contains; only single-leg vessels were found.
  3. **The cell is formatted differently from the stored text** (POL Booking Flash, 6 columns, found 15% to 91%): the export stores
     `0.76`, `1.15`, `2.71` and the cell shows `76%`, `115%`, `271%` (RFR Utilz%, POL Laden Thresh, Peak Utilz, Current Utilz); it stores
     `6/30/26 5:00` and the cell shows `6/30/26 05:00` (Last ETA, Proforma ETA). The box's "ignore , % ( )" step rescues a percent only when the
     digits happen to survive (87% finds `0.87`; 60%, 100%, 150%, 271% do not).
- **The count was 14 and is 32.** The earlier 14 came from typing one sample value per column; a column could pass by coincidence
  (Current Utilz on POL did: 87% finds 0.87). Measured properly (every row's own shown text typed into the box, tested against the
  stored per-leg text, `Column_Filters`-style fixture, 374 Booking Flash and 899 POL rows), 26 Booking Flash columns and 6 POL columns
  fail on at least one row. The earlier list also counted POL Voyage Remarks, which was never dead: the probe typed a multi-line
  remark into a one-line box (a newline cannot be typed); a fragment of one line finds its row. Fixed in the count here.
- **Proposed design (a bug fix: production file and testing build, same text in both):**
  1. For those 32 columns the box is tested against the **shown text of the table row** (`row[key]` where the table already built a
     string, the same formatter the cell uses otherwise; a VMS row shows blank, as its cell does), after the table has built its
     rows and before the blank spacer rows and row spans. Same contains-match as every other box (case-insensitive, `, % ( )` ignored).
  2. Every other column keeps today's box exactly: matched against the stored per-leg text, upstream, narrowing every tab.
  3. **Consequence, stated plainly:** a box on one of these 32 columns now narrows the table it sits above and nothing else. It does not
     narrow Trade Summary, Sector Summary, Compare, Analyze or the notes lists, which read the per-leg rows. Today such a box either
     finds nothing (and empties every tab) or finds only single-leg vessels, so no working behaviour is taken away. A box on a
     Booking Flash-only column is ignored on the POL tab (as POL-only boxes are on every other tab, D18), because POL has no box to clear it.
  4. **No calculation changes.** No `tableData` value, sort, spacer or span is touched; only which rows a table shows.
  5. Proof: a check types each cell's shown text into its own box for every row of every column of both tables and requires the row
     to come back, so a new computed column that is not on the list fails it.
- **Not decided here (Kevin's call):** making these boxes narrow the summary tabs too would need a vessel-level pass before
  `filteredRawRows` is built (a second `tableData` build per keystroke); the cost is not justified by a request to make them work.
- **Follow-up at promotion:** the shown-text accessors written here and `CF_DETAIL_SHOWN` / `CF_POL_SHOWN` (D33, testing build only)
  describe the same cells; when the testing build is promoted they should be one table.

### D41. A Sheet block with an allocation and nothing booked shows Open Space = its allocation, not 0 (DECIDED 2026-10-11; supersedes D37's "shown as published, not tidied" clause)

- **Decided by:** Kevin (chat, 2026-10-11).
- **The case:** EMA GRPIR's RFR block in the sector Sheet has a Sector Allocation of 99 and nothing else: no Measures Laden TEU, no MCT Voyage Count, no
  Average Booking, and a **blank** Sector Open Space. D37 showed it as published, so with the Reefer chip on the row read 99 / 0 / 0, which says the reefer
  allocation is used up when nothing is booked against it. The Sheet's own rule on every other block is Open Space = max(0, round(Sector Allocation - Laden
  TEU / Voyage Count)); with no voyages that division has no answer, which is almost certainly why the cell is blank (unconfirmed: the Sheet's formulas are
  not visible from the repo, and its column names suggest it is exported from a reporting tool).
- **Options put to Kevin:** fix it where the number is made (the Sheet or the tool that produces it), so the app keeps showing exactly what the Sheet says;
  or have the app fill it in. **Kevin's words:** "yes we would want this" (99, not 0), then "I would rather not touch the source".
- **Decision (made in the 2.5 testing build, a change to D37's chips; in the production file since D42 promoted that build, 2026-10-11):** in `sectorFigures`, a block whose Sector Open Space cell is
  blank, that has an allocation above 0, and whose Laden TEU, Voyage Count and Average Booking are all blank or 0, shows **Open Space = its allocation**.
  Every other cell is still shown exactly as the Sheet publishes it, a blank Open Space next to a booking included (still 0). On the 2026-10-09 Sheet this
  changes one cell: EMA GRPIR under Reefer, 99 / 0 / 0 -> **99 / 0 / 99**. The whole-POD row (neither chip, or both) is unchanged, and so was the then-production 2.0 file;
  EMA GRPIR's whole-POD row is 99 / 110 / 0 and its Dry row 99 / 110 / 0, as before.
- **What it costs:** the Reefer table now shows one number the Sheet does not. If the Sheet is ever fixed at the source to publish 99, nothing here changes
  (the cell is no longer blank, so it is shown as published).
- **Tests:** `Sector_Cargo` (the 2.5 build, now the main file and `dist/`): the independent derivation and the 41-POD literal apply the same rule, the Reefer check pins EMA GRPIR at 99 / 0 / 99, and
  the across-modes check now finds no POD whose Open Space differs from allocation less booking (it listed EMA GRPIR's reefer before).

### D42. The 2.5 testing build is promoted to production (DECIDED 2026-10-11; supersedes D11)

- **Decided by:** Kevin (chat, 2026-10-11): "Lets promote 2.5 testing to production and lets fix those 8 findings" (the findings are D43).
- **Decision:** `Booking_flash_report_na_2.5_TESTING.html` is renamed (`git mv`) to `Booking_flash_report_na_2.5_WORKING_PRO_ONLY.html`, the one
  production app file; `Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html` is deleted (git history keeps it for a rollback). The name takes the next
  version rather than reusing 2.0, so the version number says which features the file has; AGENTS.md allowed either. `dist/` is built from it.
- **What went with it:** the CI jobs `testing-build-check` and `testing-build-drift` and their `scripts/run_ci_locally.js` entries,
  `tests/check_testing_build_drift.js` and its fixture, the regression runner's `testing-2.5` target and the suite's `WAVE3` gating (every suite now
  runs on the main file and `dist/`, one pin: 642 at the promotion, 648 with D43's checks), and the testing-build sections of AGENTS.md, HANDOFF.md and
  docs/TESTING.md. The runner's suite wait went from 240 s to 1,200 s by default, the value the 2.5 job always ran with.
- **Found by promoting it:** `tests/check_compare_kpis.js` had never run against the 2.5 file and failed on it: D33's column-filter code (three JSX
  components) had been put inside the "shared capacity helpers" marker block, which that check runs without a JSX transform. The section was moved
  below the END marker; nothing in it changed.
- **From now on:** features and fixes both go in the one production file, as before 2026-10-05 (D11 is superseded).
- **Sequenced with D41:** `claude/compassionate-maxwell-irz3vm` (#218, D41) edited the old `..._2.5_TESTING.html` name. Kevin (chat, 2026-10-11):
  "merge claude/compassionate-maxwell-irz3vm (pushed today) and then this PR". #218 landed first; this PR merged it, git followed the rename, so D41's
  `sectorFigures` change is in the promoted file, and D41's "2.5 testing build only" wording was updated.

### D43. Fix the eight findings of the 2026-10-11 code review of #198-#217 (the ask DECIDED 2026-10-11; finding 7's reading DECIDED the same day; the other readings below PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-11): "lets fix those 8 findings". All eight are fixed in the promoted file (D42) in the same PR.
- **What each fix does:**
  1. **POL auto-fit** is keyed on `polShownRows` (the rows after the D40 quick boxes and the D33 column filters), not `filteredRawRows`, so a column
     revealed while a box narrows the table is re-measured when the box is cleared. `polQuickRows` / `polShownRows` moved up, next to `filteredRawRows`.
     **How bad it was (measured on a fix-removed copy):** smaller than the review said. The table's automatic layout still widens a column to its unwrapped
     content, so nothing clipped; the column came back a few pixels short of its fitted width (Voyage Remarks 14,463 px against 14,468 px, its padding).
  2. **Column filter menu:** on a column with a Condition, Values starts with only the values that pass it ticked, and OK in Values with nothing changed
     keeps the Condition (it used to remove it).
  3. **Quick boxes do not rebuild `filteredRawRows`:** its memo now follows the list of boxes the per-leg match applies, kept as the same array while
     their keys and text are unchanged. Measured with a counted copy of each file on the 8/12 fixture: typing "1,2" in Booking Flash's Current Laden
     (TEU) box re-filtered every raw row 3 times (and once more on clearing) before, 0 times after; "85" in POL Laden Thresh 2 (+1) before, 0 after.
  4. **Sector Sheet labels:** DRY, RFR, REEFER and RF are recognised in any case, with or without " TEU" or " CARGO"; the same heading repeated under two
     labels the app does not know is refused with a banner instead of showing one cargo's figures as the whole POD.
  5. **"(12)" is -12** in the sector reader (`sectorLineNum`), in the pivot engine and in the Trade / Sector Dry and Reefer figures (all three now read
     with `toNum`, so Dry + Reefer still equals the total). No cell in the shipped exports is parenthesised (0 in the 8/12 xlsx, the 9-day CSV, the
     pinned live CSV and both sector fixtures), so no number on screen moved.
  6. **Blank POD lines** in the DRY / RFR layout: no booking cell in either block gives a blank Average Booking, no allocation a blank Open Space, as
     the one-block layout always gave. **On screen this changes nothing today:** the right-hand table is a pivot that sums these cells, and it sums a
     blank as 0 for both layouts. It makes the reader's output say what the Sheet holds.
  7. **POL vessel order (D39):** each vessel's first Coastal ETD is taken from all of its legs in the data (`rawRows`), not the legs on screen, so a
     filter that hides a vessel's first leg no longer moves it. **DECIDED reading of D39's "ordered by each vessel's earliest ETD":** asked whether that means the
     vessel's real first sailing or the earliest leg on screen, Kevin (chat, 2026-10-11): "list by the earliest ETD date", without the on-screen
     qualifier, so the earliest ETD of all the vessel's legs, and the order does not change with filters. (Should the on-screen reading ever be wanted,
     it is a one-word change: `rawRows` to `polShownRows` in `polVesselFirstEtd`.)
  8. **POL sort speed:** each row's dates and block key are worked out once before the sort (`etdSortKey` / `compareEtdKeys`, `compareEtd` split
     in two with the same order), instead of up to four regex date parses and two key builds per comparison.
- **Tests:** `tests/check_sector_layout.js` +6 (findings 4, 5, 6; all six fail on the pre-fix file), regression suite +6: `POL_Vvd_Order` +1
  (finding 7), `Column_Filters` +1 (finding 2), new `POL_Autofit_Filters` 3 + tripwire (finding 1). Finding 8 is covered by `POL_Vvd_Order`'s existing
  order checks; finding 3 by the measurement above and `Quick_Filter_Shown` (results unchanged).

### D44. Selecting a card in Analyze scopes the trend chart and the Overall Snapshot tiles to that POL / Lane (the ask DECIDED 2026-10-11; the details below PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-11), with a screenshot of the POL Performance Summary: "this graph doesn't seem to change when you select
  different POL or Lanes".
- **What was measured first (8/12 export, source file, headless Chromium):** the chart already followed the **main-page** slicers while the window
  was open (POL tab, Yard chip: 57,213 / 50,878 / 55,115 / 48,164 Max Laden over W27-W30 became 1,975 / 3,900 / 1,030 / 3,595; Booking Flash, Lane chip:
  likewise). What did not follow anything was a click on a **card inside the window**: it only opened that card's vessel list
  (`analysisExpandedGroup`), and the chart and the four tiles stayed on the whole filtered set on both tabs (identical text before and after clicking
  cards 2 and 3). The window opens over the slicer panel, so a card is the only POL / Lane control in view, which is the reading taken here.
- **Options put to Kevin:** (1) the chart alone follows the card; (2) the chart **and** the Overall Snapshot tiles follow it; (3) no behaviour change,
  only a label saying what the chart covers. **Kevin chose (2)** ("Chart and Snapshot tiles follow the card").
- **Decision:** with a card's vessel list open, the trend chart (Max Laden bars, Laden fill, vessel counts, Departed star, trend line) and the four
  Overall Snapshot tiles are computed from that card's POL / Lane alone, by the same shared functions (`buildSailingBuckets` output run through
  `summarizeSailingGroups`), so a tile equals that card's own figures. Pressing the card again (or the vessel list's ×) returns to the whole view.
- **Details, PROPOSED (not asked):**
  - the chart title and the Overall Snapshot heading name the selected group, so it is never unclear what a figure covers;
  - the cards themselves, the week chips and the vessel list do not change, and neither does the Export to Excel file, which still holds the whole
    view (every card plus the Overall row), because a spreadsheet of one card would drop the comparison it exists for;
  - while a card is selected the tiles no longer add up to the cards (they are one card's); the heading says so.
- **What it costs:** one more small memo (`analysisView`) that re-aggregates one group's already-built sailings when the selection changes; the
  full aggregation does not run again.
- **Built in:** this branch.

### D45. GitHub Actions is the gate again; merge on GitHub, keep `land.js` for risky merges (DECIDED 2026-10-11; supersedes D9 and D21; items 1 and 4 SUPERSEDED by D59 on 2026-10-14: Actions is no longer used; the rest stands)

- **Decided by:** Kevin (chat, 2026-10-11). He asked: "land.js.. is very slow... do we need do it since we can use github again". Offered three options
  (1: merge on GitHub with "require branches to be up to date"; 2: keep `land.js` only for risky merges and use `--docs-only-fast` for docs;
  3: merge on a green PR check, one at a time), he answered: "lets do 1 and 2".
- **What was measured first:** the Actions run list for this repo on 2026-10-11 showed the `CI` workflow completing `success` on PR branches
  (`claude/admiring-hawking-hgnhly`, `claude/hopeful-cray-hv5hi0`) and a run on `main` in progress, so the billing block of D9 is gone. Kevin's
  "we can use github again" is the statement D9 said it waited for ("the policy lifts only when Kevin says billing is fixed").
- **Verified on a hosted run (2026-10-11):** every run before the fix (the last, run 481 on `Land #219`, 16:54 UTC) failed in about 7 seconds
  without a runner. The first PR run after it, run 484 on PR #221 (19:30-19:47 UTC), got a hosted runner for each of its 22 jobs and passed
  all 22, the live regression suite included (666 / 666 on the source and on `dist/`, that branch's pinned count). (PR #221 had written its own
  D45 for the billing fix alone; this entry, from #222, landed first and covers it, so #221 folded its evidence in here.)
- **Decision:**
  1. **D9 is lifted.** A red GitHub check is a real signal again and is fixed, re-run once if it is a flake, and reported like any CI failure.
     `node scripts/run_ci_locally.js` remains the way to run the same jobs before pushing (`--fast` for a quick loop), and the fallback if Actions is
     down again; it is no longer the gate in place of CI.
  2. **Default landing is the GitHub merge button**, once `CI` is green on the PR's current head **and the branch is up to date with `main`**. A merge
     of `main` into the branch is followed by a new CI run on the new head before merging. One merger at a time (D23) still applies.
  3. **`land.js` stays, for the cases where "green on its own" is not enough:** a PR that `node scripts/check_pr_overlap.js` flags, or that combines
     logic written by two sessions (the #185/#186 case); a landing while Actions is unavailable; and when Kevin asks for it. Docs-only PRs may
     use `--docs-only-fast` (D22, unchanged) instead of the full ~11-minute gate.
  4. **Enforcement is a GitHub setting, not code:** Settings -> Branches -> a rule on `main` with "Require status checks to pass" (the `CI` jobs) and
     "Require branches to be up to date before merging". That is what makes (2) a guarantee instead of a habit. **Switched on by Kevin on 2026-10-12**
     ("lets turn that on", then "it worked"), following the steps given in chat: a rule on `main` with "Require status checks to pass before merging",
     "Require branches to be up to date before merging", the CI jobs as required checks (at least the live regression suite, the syntax check and
     "Deployable build is up to date"; all 22 suggested), and bypassing left allowed so Kevin can still merge if Actions is blocked again. Which
     checks were finally marked required was not read back: the API returns 403 for the protection settings from an agent session. (Before this, the
     repo was private and user-owned and the 2026-10-06 research said the rule needs a paid plan; that it now works settles the question.)
- **What changes in the repo (docs only):** AGENTS.md (the billing policy section and "Landing changes"), docs/TESTING.md (the Actions note and the
  `land.js` section), `.claude/skills/checks-and-landing/SKILL.md` and docs/ROADMAP_PLAN.md (the "Actions is billing-blocked" wording). No script, workflow
  or app change. `docs/CHECK_HISTORY.md` is a dated record and keeps the billing-era text as written.
- **Cost:** a GitHub-merged PR is a merge commit without a `land.js` stamp, so `node scripts/land.js --verify --last N` lists it as `UNSTAMPED`.
  That is now expected for ordinary merges, not a sign of a bypass; only a stamp on a risky merge is meaningful.
- **Open:** none. The branch rule was the open item; it is on (2026-10-12, see 4).
- **Supersedes:** D9 (the billing policy) and D21 (the "only through `land.js`" rule). D22 and D23 stand; D20's tools stay built.
- **Built in:** this branch (docs).
- **Update 2026-10-12, the block came back, and what the branch rule turned out to be.** Read back with
  `gh api repos/kevinmarko/booking-flash-report/branches/main/protection` (it works for the owner now; the 403 above is gone). Before 17:58 UTC it was: `strict: true` ("up to date"),
  required checks `Deployable build is up to date`, `Live regression suite (source best-effort; dist/index.html blocking)` and `Syntax check (Babel + node --check)`,
  `enforce_admins: true`, no force pushes, no deletions, no rulesets. That settles "Open (Kevin)" above: the rule is on and available. Then billing failed again: the last run
  that started normally began at 17:41 UTC, the first dead one (PR #228, run 38286655679) at 17:48:24 UTC, 25 of 25 jobs, 0 steps, about 3 seconds each. In-flight jobs finished
  normally. At 17:58 UTC the same call returned `null` for the required checks (removed in the settings, not by an agent), and #226 and #228 were merged within a minute
  of each other: #226 with the regression suite of its final head still pending (it had passed on the head before `main` was merged into it), #228 (the `ci.yml` change of D51)
  with no CI result at all. A fresh run of D51's new workflow on `main` is therefore the first real test of it; until one passes, treat it as unverified.
  Retries after Kevin said billing was fixed kept failing until at least 18:23 UTC.
- **What was learned, PROPOSED (Kevin decides):** (1) when the required checks are taken off to get past a block, put them back (and "up to date") as soon as Actions runs again,
  and say so in chat the same hour; (2) while they are off, no auto-merge on a PR that has not passed `node scripts/run_ci_locally.js` in full on its merged tree, because
  auto-merge then merges the moment the PR is mergeable; PR #227 (2,300 lines) had it on, so it was held, resolved and gated locally before it was pushed; (3) a
  docs-only PR is the cheapest way to prove Actions works again, now that D51 makes it a one-minute run.

### D46. Fix the 2026-10-11 UI code review's findings, and the table scrollbar that disappears on short windows (DECIDED 2026-10-11, the readings included; finding 4 DECIDED not to change)

- **Asked by:** Kevin (chat, 2026-10-11), after a `/code-review` of the UI listed nine findings: "lets build out this plan". Then, the same day:
  "when you add columns [...] the scroll bar has a tendency to disappear and [...] there's no option to scroll over anymore" ("when you add
  columns using the macro buttons"), and on finding 4: "keep the totals in the export". The readings below were proposed in the PR and confirmed: "lets go with your choices"
  (Kevin, chat, 2026-10-11). Everything below is in the production file, one PR.
- **What each fix does (numbers are the review's; 10 is Kevin's report):**
  1. **The table height follows every banner above it.** The table-height effect's wrapper (`bannerStackRef`, `data-bf-banner-stack`) now spans
     every banner above the masthead (parse error to the historical banner, the Analyze "Show in table" Undo bar included), not only the cached-copy
     and feed-check banners. Measured with the window faked taller: the Undo bar left the table 43.5 px too tall, and dismissing it left a 62 px gap;
     both now match the table's position. The wrapper has no box of its own, so the page does not move (table top identical before and after).
  2. **Feed-check Dismiss is keyed on each problem, not its code** (`feedProblemId`): a missing field is its name, a duplicate header its cleaned
     name, bad input what was malformed. *DECIDED:* the row-count codes, DUPLICATE_KEY and VOYAGE_DISAGREEMENT stay code-only, because their
     details are counts and examples that move on every poll and would bring a dismissed banner back each time.
  3. **"Show in table" shows the card's sailings.** *DECIDED:* a column filter or quick box that would hide any of the card's rows (the group's
     sailings in Analyze's selected weeks) is cleared by the same press, using the table's own matching (`applyQuickShownFilters`,
     `compileColumnFilter`); the Undo bar names what it cleared ("Cleared the column filter on POL."), and Undo restores it. Filters that hide none
     of the card's rows are kept. Column filters are now part of the Undo snapshot, so changing one by hand drops the bar like a slicer change does.
  4. **Not changed: the Report Card exports keep their Total row** (Kevin: "keep the totals in the export"). The review's point stands as a known
     property: the exported Total row's BSA TEU is de-duplicated per vessel, so it is not the sum of the column above it.
  5. **The column-filter menu closes when focus leaves it.** *DECIDED:* a non-modal popover: focus moving outside it, or Tab / Shift+Tab off its
     last / first control, closes it the way a click outside does (unapplied edits dropped); its Esc handler takes only an Esc meant for the menu,
     so an Esc pressed elsewhere (closing Analyze) is no longer swallowed by a menu the reader has left.
  6. **A historical snapshot over the cached copy says so.** *DECIDED:* one compact yellow line (`data-cache-behind-snapshot`) under the
     historical banner while a snapshot is open and the live view behind it is the cached copy.
  7. **One definition of what a cell shows.** The quick boxes read `columnShownText`, the text the column filters use; `quickShownText` and its
     maps are gone. Compared old against new on the 8/12 fixture: 0 differences in 45,046 (tab, column, row) cases, edge values and VMS rows included.
  8. **One per-row quick-box match.** `rowPassesHeaderFilters(row, active)`, used by `filteredRawRows` and `rowsUnderSlicerState`.
  9. **`polVesselFirstEtd` is not worked out until the POL tab is opened** (then kept, so the hidden POL panel stays ordered). A refresh on
     Booking Flash with POL never opened: 4,286 date parses before, 3,323 after.
  10. **The table's horizontal scrollbar stays on screen on a short window.** The table's max-height was at least 300 px whatever space was left
      under it, so on a laptop window the box (and its scrollbar, which is its bottom edge) ended below the window: measured at 1366x657 (a
      1366x768 laptop's browser window), 232 px left under a 409 px top area, scrollbar 52 px off-screen; at 1280x600, 151 px. It showed up when
      columns were added because a narrow table needs no scrollbar. *DECIDED:* the box gets exactly the space left whenever that is at least
      120 px (header 72, scrollbar 15, a couple of rows); below that the page scrolls as before, but the box is never taller than the window, so
      scrolling the page down always brings the scrollbar into view. After: 232.6 px at 1366x657 and 133.5 px at 1280x600, scrollbar on screen
      on both tabs with every macro column added. The regression runner's own 1280x720 window was inside the old floor, which is why no check
      caught it.
- **Tests:** regression suite +18 (648 -> 666 on the branch; 657 -> 675 once #220's D44 checks were merged in): +2 Booking_Flash (10), +2 Analyze_BookingFlash (1), +1 Offline_Cache (6), +2 Feed_Canary (2),
  +5 Column_Filters (5), +6 Show_In_Table_Filters (3, new). 7, 8 and 9 change no result and are covered by the existing suites.
- **Numbering:** D46, not D44: PR #220 (Analyze card scoping) claimed D44 first, while this was being built.
- **Order of work:** findings 1-9 were fixed in parallel by five sessions in separate worktrees and merged by one, per AGENTS.md's single-writer
  rule; 10 was fixed by the merging session after 1, because both change the same effect.
- **Follow-up (2026-10-12):** after #224 (D47, Noto Sans) landed, the Undo-bar fit check (1) failed on `main`'s CI with the same numbers
  every run: a row between the masthead and the table got ~18 px shorter when "Show in table" changed the Lane slicer, and neither the
  masthead nor the tab content changed size, so the table kept a max-height ~18 px short of the space under it (a gap, not an overflow).
  The table-height effect now also observes every earlier sibling of the tab content and of each of its ancestors, so a resize of anything
  laid out above the table re-measures it. No check changed; the failing one passes again.

### D47. The report takes the one-line.com look: Noto Sans, one brand-colour token, the official logo (the ask DECIDED 2026-10-12; the colour and scope readings below PROPOSED)

- **Decided by:** Kevin (chat, 2026-10-12). He asked: "how can we add the branding and feel from our website into the report? https://www.one-line.com/en".
  Shown the options (type, brand tokens, logo, then a chrome pass over tabs, buttons and panels), he answered: "Start with type, tokens and logo".
  The chrome pass is NOT decided and not built; the data colours (Excel-matched fills, status colours) are out of scope on purpose, because they carry meaning.
- **What was measured on one-line.com (2026-10-12):** body font Noto Sans; headings weight 600, upright; logo fill `#BD0E72`; text slate `#374151`; a deep green `#125735` with mint `#B6E4CD`.
- **Built:**
  1. **Type.** Noto Sans from Google Fonts, set as Tailwind's `sans` family with the old system stack behind it, so the page still renders if the font cannot load.
     The two page titles lose their hard-coded Arial and their italics. The boot-failure box keeps `system-ui` on purpose: it must work with nothing loaded.
  2. **Token.** The brand colour lives once, in `window.ONE_BRAND` in the `<head>`. Tailwind reads it as `one` (`bg-one`, `text-one`, `border-one`, `/40` opacity),
     CSS reads `var(--one-magenta)`, script reads `ONE_MAGENTA`. 51 hex-spelled classes became the token. *PROPOSED:* the value moved from `#E5007D` to `#BD0E72`
     (the website's own), and the second pink `#c2185b` was folded into the same token (the two were near-identical and accidental). White text on it is 6.3:1, up from 4.9:1.
  3. **Logo.** `OneLogo` is the official `logo.svg` (mark plus "OCEAN NETWORK EXPRESS" wordmark as paths) instead of a hand-drawn copy. Its box is 90 x 40, so it is a touch wider at the same height.
- **Test change:** `tests/perf_benchmark.js` found the active tab by the class `bg-[#E5007D]`; it now looks for `bg-one`.
- **Still open:** the deep green and mint are not used yet (they would suit "good" status, after Kevin picks); a brand guide with official hex values would override the measured ones.
- **Follow-up 2026-10-12, the slicer row and the Clear Filters badge (the ask DECIDED; the chip widths PROPOSED).** Kevin, from a screenshot after the font change:
  "Shrink this space right there in coast and make sure there's no overlap between the subtrade and the clear filters button. Looks a little weird. Maybe we can
  shrink some of the spacing there so we can fit everything ... the way it was before the font change."
  - **What was wrong (measured, real Noto Sans, a chip set like Kevin's: 11 SPC PIC, 4 MKG PIC, 5 Sub Trade chips, with "Macro buttons in Fields" on):** the first
    slicer row (Coast, SPC PIC, MKG PIC, Sub Trade) and the Clear Filters badge shared the box's top-right corner with nothing keeping the row off it. Noto Sans made the
    labels wider than the old system stack's (not measured: the old fonts are not available in the sandbox), and the row then ended under the badge at every width from 1538px
    to about 1600px: two Sub Trade chips (`PS`, `TA`) 68px under it at 1539px, `TA` 7.4px under it at 1600px. Below 1538px the row wrapped instead. The `Coast` label was a fixed 48px box (text 39px) with an 8px margin and a 4px-padded chip wrapper: ~24px of air before `WC`.
  - **What changed (the first slicer row only; Lane, Sales Week and Yard keep the full box width):** (1) the badge is now the second column of a grid around the four
    groups, in the same top-right corner but in the flow, so the groups wrap inside the first column and cannot run under it at any width or in any font, with no width
    hardcoded; (2) Coast's label and padding match the other three groups (content-sized, `mr-1`, `p-0.5`), ~17px; (3) the SPC PIC chips 58px to a 54px minimum and the MKG PIC
    chips 48px to a 44px minimum (the widest names, `WC SPC` and `Tony`, need 50.1px and 35.3px; `min-w` so a longer name grows its own chip instead of spilling out of it);
    (4) the gap between the groups 6px to 4px.
  - **Result, same measurement:** at 1600px the badge is 75px clear of `TA` (was 7.4px under); one line from 1531px up, checked at 1529px (wraps) and 1531px (fits)
    (was one line only from 1538px, with chips under the badge until about 1600px); at 1440px Sub Trade wraps to its own line with the badge still in the corner, as before; the default "Macro buttons on page" mode is no worse (1920px: 157px
    clear, was 75px).
  - **PROPOSED:** the 54px and 44px chip widths are my reading of "shrink some of the spacing"; Kevin can ask for them wider (each 2px costs ~22px and ~8px of row width).

### D48. POL Booking Flash's "Current Laden Utilz %" is computed as Current Laden / POL Max Laden, like Booking Flash's (DECIDED 2026-10-12)

- **Asked by:** Kevin (chat, 2026-10-12): "compute it in the app like Booking Flash does", after a data-mapping review against the
  reference workbook found the column disagreeing with Excel.
- **What was wrong:** the column read the feed's `Measures POL Booking Utilz`. The reference workbook's POL sheet shows the leg's Current
  Laden / POL Max Laden (the feed's `Laden Utiliz%`): 32 of 32 reference rows, against 31 of 32 for the column the app read (BVNT0017E
  USHOU05: Excel 158% = 632 / 400, app 159%). Across the sample xlsx the two feed columns differ at whole-percent precision on 82 of 899 rows,
  some by far more than rounding (CRNT0102W: 34% vs 1,074 / 1,800 = 60%).
- **What the app does now:** `parseWorkbookToRows` sets `polBkgUtilzRaw` to `curLaden / polMaxLdn` for every row with a POL Max Laden above
  0, as a fraction like the feed's own value, so every reader (the cell, its filters, the gap colouring, Analyze's port column) follows. The
  feed's value stays only where POL Max Laden is blank or 0. Same rule as Booking Flash's `curUtilRaw` (2026-09-26), whose feed percentages
  also arrive pre-rounded.
- **Considered and not chosen:** reading `Laden Utiliz%` instead (a one-line alias change, also 32 of 32). Not chosen because it trusts a
  second pre-rounded feed column where the app already holds both numbers; Booking Flash's 2026-09-03 remap to that same column was reverted.
- **Tests:** the new Reference_Workbook suite's POL number check compares this column with the workbook on all 32 reference rows; it failed
  before the change.
- **Numbering:** D48, not D47: PR #224 (the one-line.com look) claimed D47 first, while this was in review.

### D49. The "did not load" box tells the reader to run Reset Network from the NA IT Ops toolbox (the ask DECIDED 2026-10-12; the wording below PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-12). He pasted the box's second occurrence ("We got this error again": Tailwind, React and ReactDOM
  failed to load) and then a screenshot of the NA IT Ops toolbox with the tray icon and **Network > Reset Network** highlighted: "We should add
  this to our error message".
- **What it does:** the network-failure box (the one for a missing React or ReactDOM, with "Reload the report") gets a paragraph after the two
  sign-in steps: run the network reset from the NA IT Ops toolbox (pink toolbox icon in the system tray, under the ^ if hidden), choose Network,
  then Reset Network, run it, then restart the computer. The tool's own description says it fixes IPv6 and DNS settings, resets the TCP/IP stack and
  the hosts file, clears the DNS and ARP caches, and that "a reboot is required after running this tool for all changes to take effect".
- **PROPOSED (wording and order):** the reset comes after the sign-in steps (cheap, no restart), and before "ask IT". The old line "If the test link
  shows a block page, or no login appears and it still fails, ask IT to allow ..." became "If the test link shows a block page, or the report still
  fails after the restart, ask IT to allow ...", so the two instructions do not both claim the same situation. The render-crash box (React loaded)
  is unchanged: a network reset means nothing there.
- **Not verified:** that Reset Network fixes this particular failure (the tool is not available outside the company's machines, so it was not
  run); the tool's name was read from a partly hidden title bar in the screenshot, so "NA IT Ops" needs Kevin's confirmation.
- **Not done, offered:** the same tool's list also has "Temporary Menlo Bypass" and "Run Network Diagnostics". If web isolation (Menlo) is what
  blocks the CDN hosts, the bypass may be the better step; nothing in the repo shows which, so it is not in the box.
- **Tests:** `tests/check_basic_build.js` +2 (29 -> 31): in its React-blocked scenario the box text, on the full and the basic build, names "NA IT
  Ops", "Network", "Reset Network" and "restart your computer". Red run: against the unrebuilt `dist/` both fail ("missing: all four"), against the
  rebuilt one both pass.
- **Built in:** this branch (`claude/eloquent-ride-pbw25v`); see CODE_NOTES.md, "Blank-Screen Guard", for what the second occurrence showed.

### D50. Sector Summary shows a note that allocations are shared by Dry and Reefer while the Reefer chip is the one on (the ask DECIDED 2026-10-12; the wording DECIDED twice the same day, first as Kevin typed it, then swapped for the clearer wording; where it shows PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-12), with a screenshot of the Sector Summary's cargo chips, their note and the two tables: "To be safe let's include this
  note here when Reefer is selected." The text, quoted exactly, leading asterisk included: "*Note: Sector allocations are inclusive of both Dry and Reefer
  cargo. For true available space, please include both Dry and Reefer when evaluating open space."
- **Decided:** that it shows when Reefer is selected, and the wording. First as typed above (built in #223). Then the misreading below was put to Kevin
  (same day, chat: "swap in the clearer Reefer wording", the wording this entry proposed), and the built text became, in full: "*Note: Sector allocations are
  shared by Dry and Reefer cargo: the Dry figure is the whole sector’s total and the Reefer figure is its reefer share of it. For true available space, include
  both Dry and Reefer when evaluating open space." The "*Note:" lead-in is Kevin's own, kept; "please" went with the rewording. Both are one-line changes.
- **PROPOSED (the reading of "here" and "selected"):** "here" is the note under the cargo chips (`data-sector-cargo-note`), so the caution is its own line
  directly beneath that note (`data-sector-reefer-note`), in the same block as the chips and so in the same part of the page as the note around it.
  "When Reefer is selected" is exactly one chip on and it is Reefer (`cargoMode === 'reefer'`): never under Dry, never with both chips or neither.
  **Revised with the new wording:** it shows only on a sector Sheet that has the DRY / RFR blocks (`sectorHasCargoBlocks`). The first reading, "whatever the
  Sheet's layout", held while the text said "inclusive of both"; the new text describes the Dry figure and the Reefer figure, and on a one-block Sheet the table
  shows both cargo types together (its note says so), so there is no such pair to describe. The real Sheet has had the blocks since 2026-10-09.
  Trade Summary shares the chips but shows no sector allocation, so it is unchanged.
- **Not changed:** every figure and header label, D37's readings, D41's rule and the existing note's text.
- **The misreading this wording fixed (put to Kevin, resolved):** under Reefer the table's "Reefer Sector Alloc" is the RFR block's own allocation (AT1 NLRTM 820,
  of the POD's 1,166 total; D37, "yes to all of your questions"), and the existing sentence above the note says "its own allocation". The first wording said
  allocations are "inclusive of both Dry and Reefer", which is true of the sector's total but could be read as saying the 820 includes Dry. The clearer wording
  says which figure is which: the Dry figure is the whole sector's total, the Reefer figure is its reefer share of it (D37 reading 3, confirmed). D37's own measurement
  on the 2026-10-09 Sheet: the DRY allocation equals the whole POD's on all 41 PODs; the RFR allocation is the same on 25 of the 27 PODs that have one and smaller on two.
- **Tests:** no new check, so the pinned count is unchanged: four existing `Sector_Cargo` checks assert it (present and verbatim under Reefer on the Sheet with
  the blocks; absent under Reefer on the one-block Sheet, and under Dry, neither and both on both). Their expected text was swapped with the wording.
- **Built in:** the original wording in #223 (with D49, same conversation); the wording swap and the one-block rule in the follow-up PR from the same branch name,
  after #223 merged (a merged PR is not reused).

### D51. CI: docs-only PRs skip the three browser jobs, and the source and `dist/` regression runs go in parallel (DECIDED 2026-10-12; the `ci.yml` half RETIRED by D59 on 2026-10-14, the docs-only rule itself lives on in `scripts/lib/docs_only.js`, `land.js --docs-only-fast` and the gate receipt)

- **Asked by:** Kevin (chat, 2026-10-12), while merging #223, #226 and #227. He asked what kept blocking the merges; the answer was `main`'s branch protection
  (`strict` "up to date" plus three required checks) combined with a regression job that takes about 19 minutes, so every merge made every other open PR stale and
  cost it another 19 minutes. He chose "option C" (docs-only PRs skip the long suite) and then said "18 mins is way too long", which is the ask for the parallel split.
- **Measured (PR #226, run 38281817731, 2026-10-12):** setup 30 s, then the source run 9 min 30 s, then the `dist/index.html` run 9 min 10 s, one after the other in one job.
- **Built:**
  1. **Docs-only skip.** A `changes` job asks `scripts/ci_docs_only.js` whether every file the PR changed is a Markdown (`.md`) file (nothing else counts, not even a non-Markdown file under `docs/`). If so, `regression-suite`,
     `basic-build-check` and `highlight-perf` are skipped; a job skipped by its own `if` reports **Success**, so the required check still goes green. Any other change, a
     `push` to `main`, an empty file list or any error in the `changes` job runs them in full. The headless checks (about 10 to 30 s each) always run, so a docs PR that
     breaks a check that reads docs (`check_shared_sync`, `check_land_script`, the app-file resolver) is still caught.
  2. **Parallel runs.** The source run moves into its own job, `Live regression suite, source run (informational)`, and the original job keeps only the `dist/index.html` run.
     Behaviour is unchanged: the source run was already `continue-on-error`, and the `dist/` run was already the blocking one. The wall clock drops from about 19 to about 10 minutes.
- **Why the required job's name did not change:** it is a required status check in branch protection by exact name, and changing a setting like that is Kevin's, not ours.
  The name still says "source best-effort; dist/index.html blocking", which is now slightly off (the source run is a sibling job). Renaming it needs the protection rule edited in
  the same moment; **not done, PROPOSED**.
- **Not done, PROPOSED:** shard the `dist/` run across several jobs (about 3 to 4 minutes). The 683 checks run in one page from one 15.5k-line script with no filter, so it needs
  harness work and a re-count of every suite; worth doing only if 10 minutes is still too slow.
- **Tests:** `tests/check_docs_only.js` (new, headless), added to `ci.yml`, `scripts/run_ci_locally.js` and `docs/TESTING.md`.
- **Built in:** `claude/ci-docs-only-skip-and-parallel-runs`.

### D52. The Settings panel is rebuilt as "Option D": quick controls up front, the rest folded away (the choice DECIDED 2026-10-12; the details below PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-12): "Can we reorganize the settings menu to a more space-saving and organizing manner? It just seems very
  sloppily laid out. Give me a few options and send like uh, wireframe screenshots of them." Four wireframes were sent (A tidy list, B two
  columns, C tabs, D quick strip + folded sections, with a to-scale footprint comparison); Kevin picked one: "Let's go with Option D".
- **Why the panel felt sloppy (measured on a replica of the live markup, 440 x 538 px):** 16 items in an interleaved order (display, data, display,
  status, display, export); five gray status lines wedged between the switches and the buttons, so the warnings that matter were the least visible
  thing in the panel; the "Dark" button named the mode you would switch *to* while every other row showed the *current* state; four control shapes
  for similar jobs; and a 440 px width that only the seven Text Size buttons needed.
- **What D is (DECIDED, as drawn in the wireframe):**
  - A **quick strip** that is always visible: Zoom, Text size and Theme on one line, with Freeze panes and Macro buttons (Detail / POL tabs only)
    as toggle chips under it. Text size is an A- / A+ stepper over the same seven sizes (12 to 24); Theme shows both choices (Light | Dark) with the
    active one highlighted.
  - Two **folded sections**, each with a live one-line summary on its header: **Data & safety** (Auto-refresh when a Sheet source is configured,
    Offline copy, Feed check, as switches) and **Export** (Excel, Drive on server deployments, Screenshot on Trade / Sector Summary).
  - A **footer** with the "Data as of" line (D34 stands: the stamp stays in Settings) and a health dot, plus a Details toggle for the other four
    status lines (storage probe, Cloud sync, Data source, Config Sheet).
  - Every row that is conditional today stays conditional on the same condition. Measured on the wireframes: 420 x 239 px folded (height -56%,
    footprint -58% against today), 420 x 424 px with both sections and Details open.
- **Details (PROPOSED; mine, not in the wireframe):**
  1. **Folded or open is remembered per section** (`bookingFlashSettingsDataOpen`, `bookingFlashSettingsExportOpen`, local to the browser; not added
     to the Apps Script preference allowlist, because a panel layout is not a report preference). Default: both folded.
  2. **Details opens by itself while any of its lines is a warning** (settings not saving, a failed Cloud sync write, a Config Sheet value the app
     ignored), so a red warning is never behind a click. The reader's own toggle wins for the rest of the session.
  3. **The health dot:** red while any of those warnings is showing, amber while the data stamp is stale or is a cached copy, green otherwise.
     It is decoration; the lines it summarises already say the same thing in words (their text starts with a warning sign).
  4. **Stable test hooks instead of visible text:** `data-settings-section` (+ `aria-expanded`), `data-settings-action` (`export-excel`,
     `export-drive`, `export-screenshot`), `data-settings-theme` (`light`, `dark`), `data-settings-status-toggle`; `data-setting="offline-cache"`
     and `"feed-check"` stay, with `aria-pressed`. The suite used to find Export by its exact text and Dark by its title; renaming those buttons
     would have made "no Export to Drive button" checks pass for the wrong reason, so they move to the hooks in the same commit.
  5. **Width 420 px** (was 440). On a window narrower than that the strip wraps.
- **Not done (offered, not asked for):** a warning dot on the masthead's Settings button itself.
- **Measured in the real app (1600 x 900):** 420 x 263 px folded, 515 px with both sections and Details open; today's panel was 440 x 538. The wireframes predicted 239 / 424;
  real fonts run a little taller.
- **Tests:** 675 -> 698 on its own, 683 -> 706 on top of #225's Reference_Workbook (+8). +21 `Settings_Folded_Layout` (new: 20 checks + its tripwire) and +2 `Apps_Script_Team_Features` (with six real config warnings the dot is red and Details are
  open on arrival; with none they are not). The checks that found Export, Dark or the switches by their visible text use the `data-settings-*` hooks, each with a positive control.
  A run against a copy of the app with five deliberate bugs failed 10 checks, each bug caught by the check built for it, with all 698 still executed
  ([docs/CHECK_HISTORY.md](CHECK_HISTORY.md), 2026-10-12). Local gate: source 698 / 698, `dist/` 698 / 698.
- **Numbering:** D52. It was D47 until #224 (the one-line.com branding, D47) landed, then D48 until #225 (POL Booking Flash's Current Laden Utilz %, D48) landed, then D49 until #223 (the Reset Network box, D49, and the Sector Summary Reefer note, D50) landed, then D51 until #228 (CI: docs-only PRs skip the browser jobs, D51) landed; each time the later PR renumbers. The Settings
  panel meets D47 in one place: the Theme buttons' active state uses D47's brand token (`bg-one`), not a hard-coded pink, so the panel follows the brand colour like the rest of the app.
- **Built in:** the PR from `claude/confident-allen-s5wtv4` (production file, one PR).

### D53. Ignore GitHub billing failures again; the local gate decides (DECIDED 2026-10-12; partly supersedes D45; SUPERSEDED by D59 on 2026-10-14, which makes its item 2 permanent and removes the workflow that failed)

- **Decided by:** Kevin (chat, 2026-10-12, while PR #232 waited on its local gate): "ignore any billing issues update the docs".
- **Why it came up:** the billing block of D45's "Update 2026-10-12" was still on. Every job of every run, including re-runs at 19:05 and 19:40 UTC, failed in about
  3 seconds with 0 steps, no runner and the annotation "The job was not started because recent account payments have failed or your spending limit needs to be increased".
  `main`'s branch rule had no required checks (read back at 19:12 UTC; `enforce_admins` on), so GitHub would not have refused a merge either way.
- **Decision (D9's rule, back in force for as long as the block lasts):**
  1. A failed job with **0 steps, no runner and the payments / spending-limit annotation** is ignored. Do not fix it, re-run it, comment on it, report it or remind
     Kevin about it, and do not let it block a push, a PR or a merge.
  2. **The gate is `node scripts/run_ci_locally.js`, in full, on the tree that will land** (the branch with `main` merged in). A PR that passes it and is up to date
     with `main` may be merged on GitHub. D45's other rules stand: `land.js` for the risky merges, one merger at a time, the red run when two sessions' logic meets.
  3. **A failure with real log output is still a real failure**, whoever ran it, and is fixed like any CI failure.
- **What it does not change:** turning the required checks back on, and "require branches to be up to date", stays Kevin's call in the settings (D45 item 4 and its
  PROPOSED lesson 1). Agents do not need to raise it.
- **Lifts:** when Kevin says the billing is fixed and a hosted run passes; D45 item 1 then applies again unchanged.
- **Supersedes:** D45 item 1 and the AGENTS.md "If a failed job has 0 steps ... say so once and tell Kevin" rule, while the block lasts. The rest of D45 stands.
- **Built in:** docs only (AGENTS.md, docs/TESTING.md, docs/ROADMAP_PLAN.md, `.claude/skills/checks-and-landing/SKILL.md`), in the PR from `claude/hopeful-cray-hv5hi0` (#232).

### D54. Settings > Zoom changes the page's layout size, not just its paint (the ask DECIDED 2026-10-13; the method below PROPOSED)

- **Decided by:** Kevin (chat, 2026-10-13), answering the offer to fix the blank space left under the page when Zoom is below 100%: "yeah lets fix that bug".
- **How it came up:** Kevin reported that Compare and Sector Summary would not scroll to the bottom. That could not be reproduced (CODE_NOTES.md, "Zoom Is A Layout Zoom", last
  paragraph but one), and he then said it no longer happened. The same investigation measured the opposite fault: below 100% Zoom the page keeps its full unscaled height, so
  there is a blank run under the last row (Sector Summary 1,001 px at 50%, Compare 11,161 px at 50%, on the live 10/13 feed).
- **Decision:** Zoom becomes part of the tab wrapper's one CSS `zoom` (Text size times Zoom) instead of `transform: scale()`, so the layout box changes with it.
  `isolation: isolate` keeps the wrapper a stacking context (the transform gave that for free; without it a sticky table header covered the Settings popover's Zoom buttons).
- **Changes on purpose:** above 100% the content reflows into the window instead of overflowing to the right (as Text size already did); below 100% it fills the window width.
- **Not changed:** the Detail and POL table-height rule, the Screenshot export, anything outside the wrapper.
- **Guard:** `Zoom_Layout` (+2 checks, 706 -> 708).
- **Built in:** the PR from `claude/upbeat-babbage-uynv2h`.

### D55. Sales Week joins the frozen columns, POL Booking Flash's "Loadable Quantity" header gets "(TEU)", and the table box accounts for the page's scroll (the asks DECIDED 2026-10-13; the method below PROPOSED)

- **Decided by:** Kevin (meeting notes, pasted into chat 2026-10-13), "Quick System Updates & Bug Fixes":
  - "Freeze Frames / Scrolling: Include the 'Sales Week' with the freeze frames when scrolling."
  - "Field Labels: Add '(TEU)' in parentheses next to 'Loadable Quantity' on the P Booking Flash (similar to discharge and P max laden)."
  - Later the same day, after the zoom investigation below: "apply the scroll offset fix too".
- **Reading (tell me if wrong):** "P Booking Flash" = the POL Booking Flash tab (its Discharge (TEU) and POL Max Laden (TEU) headers already carry the suffix). "Freeze
  frames" = the existing Settings > Freeze panes option (D52's quick strip). Before this it pinned Trade, Sub Trade, Lane, VVD and Vessel Name, and Sales Week scrolled away
  under them (CODE_NOTES.md, "Detail Freeze Panes And Storage Probe Timing Fix", 2026-10-01).
- **Method (PROPOSED), freeze:** Sales Week is pinned directly after Lane on both tables that share `FREEZE_LAYOUT` (Booking Flash and POL Booking Flash), 80 px wide, so
  the pinned offsets are 0/75/150/225/305/400 (VVD moved from 225 to 305, Vessel Name from 320 to 400). With Freeze panes off nothing changes.
  - **Width cost:** the frozen block is now 538 px on POL and 570 px on Booking Flash in a 1366 px window (about 40% and 43% of the container), 80 px more than before.
  - **The "[NO N.A. CALL]" tag (Kevin, 2026-10-13: "just shink the size on NO NA CALL in just that one case to fit it"):** on POL the tag normally prefixes the Sales Week value. An
    80 px pinned cell cannot hold it beside the week, and a wrapped line would break POL's fixed 19 px row heights (the windowing depends on them). So in that one case (frozen +
    tag) the tag and the week stack as two 8 px lines inside the cell; measured on the 8-12 fixture, 31 rows, every row stays 19 px, nothing overflows. First built as a hover tooltip,
    changed to this the same day. Unfrozen: unchanged.
  - **Known cosmetic limit:** the tables use `border-collapse: collapse`, so at some scroll offsets a 1 px sliver of scrolling content shows at a boundary between two pinned cells.
    The VVD/Vessel boundary always did this; Sales Week adds one more such boundary. Not fixed (the fix would change every cell border).
- **Method (PROPOSED), label:** the header reads `Loadable Quantity (TEU)`, split `Loadable<br/>Quantity (TEU)` rather than the siblings' `Loadable Quantity<br/>(TEU)`, because that
  split makes the column about 128 px, the widest header on the table (107 px with the chosen split, against 106 for Current Laden (TEU) and 113 for POL Max Laden (TEU)).
  The header, the body cells' `data-autofit-col` and the split key change together (HANDOFF.md, 2026-09-25: `thLabel` keys auto-fit by the label string). The filter row's
  `aria-label` still says "Loadable Quantity", like Discharge's and POL Max Laden's. Saved column widths are not orphaned: `polColWidths` is plain React state, persisted nowhere.
  The regression test's `POL_NUM` `'Loadable Quantity'` is the reference workbook's own column header, not this app's label, and is unchanged.
- **Zoom / scroll lock (investigated 2026-10-13, read-only, then fixed in part):** the literal "scrolling locks up" did NOT reproduce in about 470 tab and Hide Filters transitions over 20 browser-zoom
  and in-app-zoom configurations (no difference between 100% and 80%). A different, real defect did: the table-height rule
  `window.innerHeight - rect.top - 16` measured `rect.top` from the window, so when the page was scrolled at the moment of measurement the Booking Flash / POL box came out taller
  than the window by the scroll distance (84 px at 100%, 57 px at browser 80%), and a wheel over the table then scrolled the table instead of the page. The measurement skips tabs
  with no table, so the wrong size stayed until the next trigger or a refresh. Fix: add `window.pageYOffset` back. **Unconfirmed that this is Kevin's bug**: it also happens at 100%,
  and he named Compare and Sector Summary, which have no table. Questions for Kevin if it persists: Chrome or Edge and which version, which tab, what he did just before
  (Ctrl+minus while scrolled? Show Filters on a summary tab and back?), whether the wheel was over the table, and whether toggling Hide/Show Filters once frees it.
- **Tests:** 708 -> 715. +2 `POL_Booking_Flash` / +1 label and +2 `Booking_Flash` (a Freeze-ON and a Freeze-OFF Sales Week check per table), +2 new `Table_Box_Scrolled_Switch`
  (scroll the page, switch to the table tab, the box must end inside the window). A copy with the scroll fix reverted failed exactly those two (713/715); a copy with three deliberate
  freeze/label bugs failed exactly the four expected checks.
- **Not done yet, on purpose:** "Hide Fields" for every field (so a user can hide Trade, Sub Trade and the rest). Kevin: the notes say "Agreed to prioritize the first two system
  updates first before working on adding all fields." Status: `OPEN`, not started. `FIELD_VISIBILITY_AND_SLICER_POPUP_PLAN.md` is the existing plan to start from.
  **Picked up 2026-10-15: see D60.**
- **Built in:** the PR from `claude/gracious-gates-hrizyz` (kevinmarko/booking-flash-report#236).

### D56. A voyage with bookings but no sector allocation shows "No sector allocation" in the Sector Allocation column, in allocation lanes only (the ask DECIDED 2026-10-14; the rule below PROPOSED)

- **Decided by:** Kevin, 2026-10-14, after the investigation below. Option 1 was a data fix he takes himself; of the app-side option 2 (a visible placeholder where the cell is blank) he wrote:
  "I will do 1 and you still do 2 but it should be for only VSLs that have sector allocation".
- **Reading (tell me if wrong):** "VSLs that have sector allocation" = voyages on a lane that carries a sector allocation at all, so lanes that never have one (PS1, PS4, PS6-PS8, PN1, WIN,
  INE, EXE, EXW) stay blank as they always were. It is not "vessels that have an allocation": a voyage that has one already shows its remarks.
- **Why it was blank (investigated 2026-10-14, live published CSV and the 51-day historical Sheet, not a code bug):** the app copies `Sector Remarks` straight from the feed. The feed's text
  lists one `POD: allocation - booked = open` entry per destination port that has bookings, so a voyage with no bookings yet is blank by design (every EMA voyage in the archive got its text on the
  day of its first booking, never before: W50 `CMDT0003E` and W52 `ZHOT0180E` are in that state and need nothing). The real gap was EMA W43 `CMDT0002E`: 826 TEU booked, `MCT Sector Allocation` 0 on
  every leg in 153 of 153 rows since 2026-08-24, no remarks in any of 51 daily snapshots, while the same vessel's W36 voyage `CMDT0001E` had both on every day. That gap is upstream (MCT / the
  Power BI model), which is Kevin's option 1.
- **Method (PROPOSED):** `markMissingSectorAllocation(rows)`, a post-pass at the end of `parseWorkbookToRows` (so the live feed, an upload and every historical day get it), sets `row.sectorAllocMissing = true` on
  every leg of a voyage (VVD) when ALL of these hold, each judged on the whole loaded dataset and never on the filtered rows, so a POL or lane filter cannot change the answer:
  1. the voyage is not VMS;
  2. its lane is an allocation lane: at least one row of that lane in the data has `MCT Sector Allocation` > 0 (today AL5 AT1 AT3 AT4 EC3 EMA FP2 PN3 PS3 VSE, which is the same set as the live sector Sheet's ten lanes);
  3. the voyage has bookings: its legs' `Measures Laden TEU` sum to more than 0 (without bookings, a blank is the normal state);
  4. no leg of it has remarks text;
  5. no leg of it has a sector allocation > 0. A voyage that has an allocation but still no remarks (live today: AL5 `NROT0080E`, `CAGT0002E`; AT3 `MMOT0311E`, `MIET0111E`, `BVNT0019E`, `GLMT1009E`) is NOT
     flagged, because "No sector allocation" would be false for it. Those six stay blank and are an open question for whoever owns the feed (likely bookings only to ports outside the allocation list; unconfirmed).
  On 2026-10-14's live data the rule flags 9 voyages: AT1 `HSMT0092E` `EVFT0036E` `HSMT0093E` `EVFT0037E`, EMA `CMDT0002E`, FP2 `TTLT0029W`, PN3 `CMJT0069W`, PS3 `OHNT0102W` `NVET0088W`.
- **Shown as:** muted grey italic "No sector allocation" in the Sector Allocation column (Booking Flash) and the Sector Remarks column (POL Booking Flash), with a hover title saying bookings exist but the feed has no allocation for the voyage.
  The placeholder is in what the column filters test: the Excel-style filters read the shown text, and `sectorRemarks` joins the quick-box keys of D40 (`QUICK_SHOWN_DETAIL_KEYS`, `QUICK_SHOWN_POL_KEYS`), so typing "No sector" in either tab's box finds the flagged legs, as the Quick_Filter_Shown check (it types every cell's shown text into its box) requires. The Excel export is built from the same cells, so the placeholder is in the file too.
  The raw `row.sectorRemarks` is unchanged, so the Analyze window, the notes list and the Compare tab, which read it, still see the feed's own (blank) value.
- **Built in:** the PR from `claude/elegant-goldberg-7vhx8g` (kevinmarko/booking-flash-report#237).

### D57. The two date columns join the frozen columns on both Booking Flash tabs (the ask DECIDED 2026-10-14; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-14: "Can we also include both dates (Cutoff/etd) in the frozen panels when scrolling right? in both booking flash tabs ?"
- **Reading (tell me if wrong):** "both dates (Cutoff/etd)" = the two date columns that sit between Sales Week and VVD on each tab: **1st POL Cutoff** and **ETD Last Port** on Booking Flash, **Coastal ETD** and **Port Cut**
  on POL Booking Flash (POL's own order, Coastal ETD first, is kept). "Frozen panels" = Settings > Freeze panes, as in D55. PIC and Status stay unpinned.
- **Method (PROPOSED):** `FREEZE_COLUMNS` gains `date1` and `date2` right after Sales Week, 80 px each, so the pinned offsets are 0/75/150/225/305/385/465/560
  (VVD moved from 305 to 465, Vessel Name from 400 to 560). One shared layout, so both tabs freeze at identical offsets. With Freeze panes off nothing changes. No column is reordered:
  PIC (when shown) still sits between Sales Week and the first date and scrolls away under the pinned block, and Status (when shown) scrolls away under the dates and VVD.
  - **Why 80 px:** the widest real value, "10/24/26" plus the OPUS link icon, is 67 px of content (about 72 px as a cell) on both tabs; 80 px (Sales Week's width) leaves about 8 px for a wider emoji font.
    None of the four columns carries a time of day in the 8-12 fixture or the 9-day historical CSV (9,733 rows), so POL's `formatDate` time suffix does not show up. The pinned cells are no-wrap
    while frozen, so a value that does not fit is clipped behind its neighbour instead of wrapping (POL's windowing needs fixed 19 px rows).
  - **Width cost, stated plainly:** the frozen block grows by 160 px, from 538 to 698 px on POL and from 570 to 730 px on Booking Flash. In a 1366 px window that is about 52% and 55% of the table container
    (it was about 40% and 43%), leaving roughly 600 px for the columns that scroll. On a narrower laptop screen the frozen part is most of the width; Freeze panes is still a switch.
  - **Spacer rows** (the grey lane separators) split into pinned and unpinned cells the same way as the data rows, so the full width is still covered.
- **Guard:** `checkFreezePins` and `checkSalesWeekFreeze` take the new offsets; `checkDateColumnsFreeze` (new, one Freeze-ON and one Freeze-OFF check per tab) asserts the two dates, header, body and spacer row.
- **Built in:** the PR from `claude/confident-ptolemy-eaw4dl`.

### D58. The macro buttons are in the same order on both Booking Flash tabs (the ask DECIDED 2026-10-14; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-14, with a screenshot of three grids (PROPOSED, POL, Overall): "I want all the macro buttons to look like proposed... or well in the same order on each of the booking flash tabs".
- **Reading (tell me if wrong):** "Overall" = the Booking Flash tab (`detail`), "POL" = POL Booking Flash. PROPOSED is Booking Flash's existing grid plus a last row, **VCO Analyst | ETA**, so the target for both tabs is
  AP Frozen | AP Only, AP Status | Activity, Rotation | Trade Breakdown, Voyage Remarks | DG Volume, Sector Allocation | Operational Issues, BSA | Reefer, and on POL only, VCO Analyst | ETA.
  Booking Flash is unchanged (it has no VCO Analyst or ETA button, and must not gain one: their columns are per-POL-leg, see their `FIELD_TOGGLES` comment). Only POL Booking Flash moves. Other tabs have no macro grid.
- **Why they differed:** POL had its own hand-written order (`reefer, activity, opIssues, eta, vco`), and every toggle that array did not name was appended in `FIELD_TOGGLES` order, which gave
  Reefer | Activity, Operational Issues | ETA, VCO Analyst | AP Status, BSA | Trade Breakdown, Sector Allocation | DG Volume, Rotation | Voyage Remarks. A toggle that no order names lands at the end of that one tab's grid, so the two tabs could only agree by luck.
- **Method (PROPOSED):** one list, `MACRO_GRID_COMMON_ORDER`, that both tabs read; `MACRO_GRID_ORDER.pol_booking` is that list plus `vco, eta`. No render code changed (`macroGridToggles`, `ApStatusMacroPair`), and the
  Fields picker keeps its own grouped order. Hiding a field (Fields picker) behaves as before: its button stays in its cell, shown grey, and only AP Frozen / AP Only drop out of the grid when hidden, so the order never shifts.
- **Guard:** `tests/check_macro_grid_order.js` (headless, 9 assertions, wired into CI and `run_ci_locally.js`): both tabs show the PROPOSED labels typed from the screenshot, every key a tab's grid shows is placed in that
  tab's order (a new toggle fails the check until someone places it, instead of silently landing at the end of one tab), AP Frozen / AP Only stay out of the order. Proven red against POL's old order and against an unplaced `eta`.
- **Built in:** the PR from `claude/serene-dijkstra-kqzwft` (kevinmarko/booking-flash-report#240).

### D59. No more GitHub Actions: the local gate is the only gate, and it leaves a receipt (DECIDED 2026-10-14; supersedes D45 items 1 and 4, D53 and the `ci.yml` half of D51)

- **Decided by:** Kevin (chat, 2026-10-14): "new rule no more Github actions let's build around it", and, when the billing came up in the same message thread, "I'm not paying money for it".
- **Why it came up:** Actions has been unusable for most of three weeks for one reason, unpaid billing (D9, D45's "Update 2026-10-12", D53): every job of every run failed in about 3 seconds with 0 steps and no runner,
  and each push produced 26 red checks and a pile of failure notifications that all had to be ignored by rule. Kevin will not pay to fix it, so the rule that says "ignore the red checks until billing is fixed" has nothing to wait for.
- **Decision:**
  1. **GitHub Actions is not used.** `.github/workflows/ci.yml` is removed (`git show fa865ff:.github/workflows/ci.yml` has the last version, if this is ever reversed). Nothing in the repo may depend on a hosted runner or on any paid CI or
     hosted service. With no workflow there are no failing jobs, so D53's "ignore the billing failure" rule has no case left.
  2. **The gate is `node scripts/run_ci_locally.js`, in full, on the tree that will land** (the branch with `main` merged in, committed and pushed). It was already the gate under D53; now it is the gate for good. **Its job list is the
     single source of truth**: it used to mirror `ci.yml`, and there is no second copy to keep in step any more. Adding a check now means: the `jobs` array in `scripts/run_ci_locally.js` and the table in `docs/TESTING.md`.
  3. **The gate leaves a receipt.** `node scripts/run_ci_locally.js --post-status` posts a GitHub commit status named `local-gate` on the pushed HEAD (a commit status is free; it is not an Actions run). It posts `success` only when
     **every blocking job passed, the working tree is clean, and HEAD contains `origin/main`**; a blocking failure posts `failure`; an uncommitted tree, a branch behind `main`, a `main` that could not be fetched, or a `--fast` run on
     anything but a Markdown-only change posts nothing and says why. A `--fast` run counts for a Markdown-only change (D22, D51), because the skipped browser jobs cannot be affected by it. The rules are in `scripts/lib/gate_status.js`,
     pinned by `tests/check_gate_status.js`. It never changes the script's exit code. This is the green check on the pull request that Actions used to give, and "up to date with main" (D45 item 2) is now a condition of the tick itself.
  4. **Landing:** merge on GitHub when `local-gate` is green on the PR's current head (which already means "up to date"). `node scripts/land.js <PR>` stays for the risky merges (an overlap flag, two sessions' logic in one PR, or Kevin asks)
     and for Docs-only PRs `--docs-only-fast`; D20, D22 and D23 are unchanged. `land.js`'s own stamp (the tree hash) is still the strongest proof, since it gates the merge result and not the branch.
- **Not changed:** what the checks are, the "run it on both the source and `dist/`" rule, the flakiness triage, or how long the gate takes (about 11 minutes on a laptop). The two regression runs are sequential here; CI used to run them in parallel (D51).
- **The limit, stated plainly:** a status is posted by the same machine that ran the gate. It is a receipt, not a second opinion, and `main`'s branch rule does not require it (read back 2026-10-14: no required checks; `enforce_admins` on).
  **Open (Kevin's, in GitHub settings, free):** Settings -> Branches -> the rule on `main` -> "Require status checks to pass" with `local-gate` as the one required check, and "Require branches to be up to date". That would make GitHub refuse
  the merge button until the receipt is on the head. It needs one `--post-status` run to have happened first, so the check name exists. Agents do not change branch protection.
- **UNCONFIRMED (2026-10-14): the real POST.** The full gate passed on `c075279` (every blocking job; 726 / 726 on the source and on `dist/`), but the cloud sandbox's proxy answers 403 to any write to GitHub's statuses path
  ("Write access to this GitHub API path is not permitted through this proxy"), so `--post-status` printed `RECEIPT NOT POSTED: gh failed (...)` there, as designed, and the receipt was never seen on a PR. What is pinned: the decision rules,
  the repo-name parsing, and the exact `gh api` arguments (`tests/check_gate_status.js`), and the not-posted path (it ran). What is not: that GitHub accepts the call and shows `local-gate` on the PR. **Open (first run on a machine with a logged-in `gh`):**
  on a pushed branch run `node scripts/run_ci_locally.js --fast --post-status` on a Markdown-only change and look for `local-gate` on the PR; the token needs permission to write commit statuses (classic `repo:status`, or "Commit statuses: write" on a fine-grained token).
  Until that is seen, treat a missing `local-gate` as "unknown", not "failed", and read the gate's own output.
- **PROPOSED (Kevin decides), to make the gate faster now that it is the only one:** the source regression run is informational (never blocks) and takes about half of the 25 minutes the gate needs in the cloud sandbox. Options: skip it by
  default and keep it behind a flag, or run the source and `dist/` runs in parallel as CI did. Neither is built.
- **Built in:** the PR from `claude/local-gate-only` (docs, `scripts/run_ci_locally.js`, `scripts/lib/gate_status.js`, `tests/check_gate_status.js`, `.github/pull_request_template.md`, the removal of `ci.yml`).
- **Numbering:** D59. It was D58 until #240 (the macro-button order, D58) landed on `main` first; the later PR renumbers, as in D52. Commit messages and the PR description of this change still say D58, and mean this entry.

### D60. The Fields picker lists every column of both Booking Flash tables, one checkbox each (the ask DECIDED 2026-10-15; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-15, with a screenshot of the open Fields picker on POL Booking Flash: "I want all the columns in the field menu here. So people can, select which columns they want to
  see in and hide. All the columns that are in the tables for both booking flash tabs."
- **What it closes:** the "Not done yet, on purpose: Hide Fields for every field" item in D55, and question 3 of `FIELD_VISIBILITY_AND_SLICER_POPUP_PLAN.md` ("only the fields named plus the existing groups, or
  genuinely every column?"): **genuinely every column**, including the identity columns (Trade, Sub Trade, Service, Sales Week, the two dates, VVD, Vessel Name).
- **Reading (tell me if wrong):** (1) "the field menu" = the existing Fields picker; (2) "both booking flash tabs" = Booking Flash (`detail`) and POL Booking Flash (`pol_booking`), and the picker lists the
  columns of the tab you are on; (3) hiding is the same as today: the column leaves the screen **and** the Excel/CSV download; (4) nothing changes until someone unticks something.
- **Method (PROPOSED):**
  - One column list per tab (the registry, `COLUMN_REGISTRY_ROWS`) feeds the picker rows, each tab's visible-column count (the hand-counted colSpan formulas are gone) and the clear-on-hide filter keys.
    The table cells stay hand-written JSX, each with one added `!hiddenCols.<key> &&`, because `tests/check_field_filter_gating.py` and check H of `tests/check_shared_sync.js` read the literal call sites;
    `tests/check_column_picker_logic.js` fails if the registry and those cells drift apart.
  - A column is shown when its group toggle (Reefer, Activity, ...) is not hidden **and** the column is not in `hiddenCols`. The existing group toggles and the macro buttons work as before. In the picker a group with
    two or more columns on the tab is a parent row (ticked = all shown, half-filled = some) with its columns indented under it; ticking a half-filled or empty parent shows all of the group, unticking a full one hides the
    group. A group with one column on the tab, and every ungrouped column, is one row. Ticking one column of a hidden group turns the group on and keeps its other columns hidden. Unticking the last shown column of a
    group turns the group off, so a macro button never reads "on" over nothing. The last shown column of a table cannot be unticked.
  - **`hiddenCols` is one set of column keys shared by both tabs, like the group toggles** (hiding Trade hides it on both tables). It first read "per tab" in this entry; the read-only inventory of both tables showed
    that cannot work here: the group states are already shared by both tabs, and `headerFilters` is one flat map shared by both tabs, so a per-tab set would need tab-aware filter clearing and could contradict the
    macro buttons (a group toggled on one tab changes the other). Saved as one localStorage blob, **this browser only**. Server sync is not built: `USER_PREF_KEYS_` in `apps-script/Code.gs` holds `'1'`/`'0'` values
    only, so a blob would need a server change and a production checklist that cannot be run from a laptop.
  - Default view unchanged: nothing is in `hiddenCols` until a user unticks a column, so column order, count (22 on Booking Flash, 26 on POL) and the Excel export are byte-identical for everyone today.
  - Pinned (Freeze panes) columns can be hidden; the pinned offsets and the spacer-row splits are computed from the visible pinned columns instead of the fixed 0/75/150/225/305/385/465/560 (the last shown pinned
    column keeps its natural width and the edge shadow).
  - Hiding a column clears its header filter and its Excel-style condition: safe because the key is hidden on both tabs (the shared-set choice above is what makes the existing clear-on-hide rule hold unchanged).
  - **Not covered:** the Report Card modal keeps its own fixed column list (it honours only the existing PIC and Status toggles), and the Drive snapshot export (`SNAPSHOT_ROW_COLUMNS`, only with the server extras on)
    ignores the picker, as before.
- **Guard:** `tests/check_column_picker_logic.js` (headless, in the gate): the registry equals each tab's filter-cell call sites in order, every key is gated at its filter, label and body cell, group and `filters` lists agree
  with `FIELD_TOGGLES`, plus the visibility rule, the click logic, the saved blob, the freeze layout and the frozen spacer pieces. The live suite hides every column of both tables in a browser.
- **Open for Kevin:** (a) server sync, so a person's choices follow them across browsers (needs an Apps Script change and a run on `/exec`); (b) hiding a column on one tab only (a per-tab set needs the filter and group
  coupling above resolved first); (c) whether a spreadsheet downstream is keyed on column **position** (hiding a middle column shifts the columns to its right in the download, as the plan's risk 4 says);
  (d) whether any column should be un-hideable (the method above hides none of them); (e) whether the Report Card modal should follow the picker.
  **Two group/column edge cases, found by the live sweeps:** (1) a group switches off when you hide its last column **on the tab you are in**: hiding all six Activity columns, or all three Reefer columns, on POL
  turns the shared Activity / Reefer group off (the macro button reads hidden), which also hides Booking Flash's Detail-only columns of that group (`actVsBkgUtilz`, `actVsMaxLdn`, the Reefer plugs), because the group
  toggle is one shared state, as it always was. It first counted both tabs' columns, so the group never switched off from POL and the macro button read "on" over nothing (found by the POL sweep, fixed).
  (2) `bsaTeu` is a BSA-group column on Booking Flash but an ungrouped one on POL, so a hide of it is kept when Booking Flash's BSA group switches off (POL still needs it hidden); switching BSA back **on with the
  macro button** therefore brings back every BSA column except BSA TEU, which stays hidden because you hid it. Ticking it in the picker, or the group row, shows it. Left as is: the alternative would un-hide a column on
  POL that you hid there.
- **Built in:** kevinmarko/booking-flash-report#242 (merged 2026-10-15).
- **Answered 2026-10-15, see D62:** (a) no server sync needed, (b) hide per tab, (d) no column is un-hideable (nothing changes), (e) the Report Card follows the picker. (c) was answered the same day, see the D62 "Confirmed" line: nothing downstream depends on column position.

### D61. Freeze panes stop pinning Trade and Sub Trade, and the pinned cells keep their vertical grid lines (the ask DECIDED 2026-10-15; the method below PROPOSED; the pinned cells' overlay half is SUPERSEDED by D73)

- **Decided by:** Kevin, 2026-10-15, with a screenshot of POL Booking Flash scrolled right with Freeze panes on: "Can you exclude the Trade and Sub Trade in the frozen fields when scrolling right?  Trying to
  free up some more space with the addition of the dates and those aren't really necessary. Also, the vertical borders have lost visibility after the changes on the POL BF tab."
- **Changes:** D55 and D57 (the pinned set Trade, Sub Trade, Lane, Sales Week, the two dates, VVD, Vessel Name).
- **Reading (tell me if wrong):** (1) the frozen set becomes **Service (Lane), Sales Week, the two dates, VVD, Vessel Name** (six columns); Trade and Sub Trade still show and still scroll, they just scroll away like
  any other column when you scroll right. (2) The screenshot is POL Booking Flash, but both tabs share one freeze layout (D55, D57: "one shared layout, so both tabs freeze at identical offsets"), so Booking Flash
  gets the same change; if you want it on POL only, say so and the layout is split per tab. (3) "Vertical borders" = the thin grey lines between the pinned body cells (Sales Week | Coastal ETD | Port Cut | VVD |
  Vessel Name): with Freeze panes on they are not drawn at all today, with it off they are.
- **Method (PROPOSED):**
  - `FREEZE_COLUMNS` loses `trade` and `subTrade`: the pinned offsets are Service 0, Sales Week 75, date 1 155, date 2 235, VVD 315, Vessel Name 410 (they were 150/225/305/385/465/560), so the frozen block shrinks by
    150 px (from 698 px to 548 px on POL). With Freeze panes off nothing changes. Trade and Sub Trade keep their place in the table, their header, filter and Excel columns and their picker rows.
  - **Why the lines vanished (found by a pixel check, not assumed):** the tables use `border-collapse`, and Chromium paints collapsed borders in the table layer, underneath a `position: sticky` cell's opaque
    background. So a pinned cell shows its top and bottom lines but not its left and right ones; the unpinned cells next to it keep theirs. It was already true before the date columns were pinned (D57), but with
    only Sales Week and VVD adjacent it hid in plain sight; with five neighbours pinned in a row it reads as a missing grid. The fix is a rule in the head stylesheet that draws the same 1 px #9ca3af left and right
    lines on every sticky body cell as a `::before` overlay, so it needs no change to any cell and applies to both tables and to the frozen spacer pieces.
- **Guard:** the live Freeze checks (`checkFreezePins`, `checkSalesWeekFreeze`, `checkDateColumnsFreeze`) take the new offsets and assert Trade and Sub Trade are NOT sticky; a new check reads the pixels of the
  pinned cells' left and right edges with Freeze panes on; `tests/check_column_picker_logic.js` takes the new layout.
- **Built in:** kevinmarko/booking-flash-report#242 (merged 2026-10-15, with D60: it edits the same freeze layout).
- **Confirmed 2026-10-16:** reading (2) is right. Asked whether the change should be POL only, Kevin: "POL- only; It should be both tabs". Trade and Sub Trade are unpinned on both tabs, which is what #242 built;
  the layout stays shared and nothing is split per tab.

### D62. Columns are hidden per tab, and the Report Card follows the picker (the asks DECIDED 2026-10-15; the method below PROPOSED; amends D60)

- **Decided by:** Kevin, 2026-10-15, answering the "Open for Kevin" list of D60: "2. they don't have to follow people.... hiding columns per tab, any column should be un-hideable and the Report Card should follow the picker."
- **Reading (tell me if wrong):** (a) "they don't have to follow people" = no server sync; a person's hidden columns stay in their browser (drops D60's open item a). (b) "hiding columns per tab" = hiding a column on Booking Flash
  does not hide it on POL Booking Flash, and the other way round (reverses D60's shared-by-key choice). (d) "any column should be un-hideable" is ambiguous in print: I read it as the answer to D60's question "should any
  column be un-hideable?": **no column is un-hideable**, every column of both tables can be hidden (the original ask, and what D60 built), so nothing changes for it. If you meant the opposite (some columns must always show),
  name them. (e) "the Report Card should follow the picker" = each column of the Selection Report Card is shown or hidden exactly as the same column is in the Fields picker of the tab the card was opened from; the card keeps its
  own fixed set and order of columns (it is a summary, not a copy of the table) and gains no new ones.
- **Method (PROPOSED):**
  - `hiddenCols` becomes one set of column keys **per tab** (Booking Flash and POL Booking Flash each have their own). Each table gets only its own set, so ticking a column on one tab does not re-render the other tab's rows.
    Saved as `{"v":2,"detail":[...],"pol_booking":[...]}` in localStorage `bookingFlashHiddenColumns`; the first version's `{"v":1,"keys":[...]}` (D60, merged today) is read once and applied to both tabs, so nobody sees a change.
    Still this browser only. A saved set that would leave one table with no column is ignored for that tab only.
  - **The group toggles (Reefer, Activity, the macro buttons) stay shared by both tabs**, exactly as before: the Settings > macro buttons flip a whole group on both tables. Per-tab hiding is layered on top:
    a column is shown on a tab when its group is not hidden **and** the column is not in that tab's set. Consequences, chosen so that **a click in one tab's picker never changes what the other tab shows**:
    - Ticking a column of a hidden group turns the group on and records every other column of the group, **on both tabs**, as hidden (plus the ticked column's twin on the other tab), so only the ticked column appears, on this tab.
    - A group row (or a column) hidden in the picker is hidden on **this tab** only; the shared group switches off only when every column of it on both tabs is hidden (then the recorded hides are cleared, so the macro button
      reads "hidden" and turning it on shows the group). So the Activity macro button can read "on" while one tab shows none of the Activity columns: the other tab still shows some.
    - Unticking the last shown column of a table stays blocked.
  - Hiding a column still clears its header filter box, now for the tab you are on: the text filter map is one flat map shared by both tabs, so clearing it also drops that text filter on the other tab (a hidden box
    must not keep filtering). Excel-style conditions are already per tab and are cleared for this tab only.
  - **Report Card:** its 17 (POL) or 18 (Booking Flash) columns are each gated by the same registry visibility as the table's column, so the PIC and Status toggles it already honoured, the group toggles and the
    one-by-one hides all apply. The Total row follows: its "Total" label sits in the first column that is shown, and its sums are unchanged. If every column of the card is hidden, the card says so instead of showing
    an empty table. Default view unchanged. The card's Excel download is read from the card's table, so it follows too.
- **Guard:** `tests/check_column_picker_logic.js` (per-tab click logic, v1 and v2 blob, independence of the two tabs); the live `Column_Picker` suite (hiding on one tab leaves the other untouched, in both directions) and a
  Report Card check on each tab.
- **Confirmed 2026-10-16 (nothing is open any more):** (d) Kevin: "\"Un-hideable\": correct", so the reading above stands: no column is un-hideable and every column of both tables can be hidden. (c) Kevin: "download
  positions- aren't effected by it", so no spreadsheet downstream depends on column position and a hidden middle column shifting the ones to its right in the download is acceptable.
- **Built in:** kevinmarko/booking-flash-report#243 (merged 2026-10-16).

### D63. Settings gets a "Find a vessel" section: type a VVD and see which data feed holds it (the ask DECIDED 2026-10-21; reading (a), the Historical archive search and the panel's extra height CONFIRMED the same day; the rest of the method below PROPOSED)

- **Asked by:** Kevin (chat, 2026-10-21): "Let's create like a system, another button in the settings button that's like find my vessel in the data. Sometimes the data doesn't update quickly enough and analysts are like, it's missing.
  So if we could quickly add a section in the settings button where you could search the VVD number, and it would search the back end data and see if it's actually there. So we know if, you know, if it's in the max laden
  data or if it's in the other data feeds. It's just so we can understand."
- **Why it is needed (measured in the code, not guessed):** a VVD an analyst cannot see can be absent at four different places, and each has a different owner and a different cure. (1) The published Sheet does not hold it yet
  (upstream: the booking export or the MCT Max Laden sheet has not caught up). (2) The Sheet holds it but this report does not: the report is a 10-minute poll behind the Sheet, and on a server deployment it reads Apps Script's shared
  copy, which refreshes every 30 minutes 08:00-17:00 and hourly otherwise (`apps-script/DataFeeds.gs`), so "Refresh Now" may be all that is needed. (3) The report holds it but a slicer or a column filter hides it (`filteredRawRows`).
  (4) The row is there but its Max Laden cells are blank or 0, which the tables show as a vessel with no capacity. Today an analyst cannot tell these apart without downloading the Sheet by hand.
- **Readings (tell me if wrong):**
  - (a) "the max laden data" = the Max Laden columns of the live export: `MCT Max Laden Update` (the first of the aliases the app reads for Max Laden), the older `MCT Max Laden` (differs on 8 to 22 real rows a day, see `HANDOFF.md`) and `POL Max Laden TEU`. I found no
    separate Max Laden feed in the code; if there is one outside this repo, name it and it becomes a fourth line.
  - (b) "the other data feeds" = the two other published Sheets the app reads: the sector Sheet (`SECTOR_DATA_CSV_URL`) and the Historical archive. v1 covers the sector Sheet and **not** the Historical archive (see "Not in v1").
  - (c) "the back end data" = the published Sheet itself, downloaded **fresh** at the moment of the search and compared with what this report has loaded. That comparison is the whole point; looking only at the loaded rows would
    repeat what the table already shows.
- **Method (PROPOSED):**
  - A third folded section in the Settings panel, **Find a vessel**, beside Data & safety and Export (D52's pattern: a header with a one-line summary, folded by default, open or folded remembered in `bookingFlashSettingsFindOpen`,
    local to the browser, not a report preference). Inside: a VVD box (case, spaces and a pasted trailing space ignored), a Search button, Enter submits.
  - One search does three things at once, none of which changes what is on screen or touches the app's own feed state (no "Data as of" change, no staged "New data available", no offline copy write):
    1. reads the rows this report holds (`rawRows`) and the rows left after the slicers and column filters (`filteredRawRows`);
    2. downloads the live Sheet directly (`cache: 'no-store'`, 12 s limit), parses it with the app's own `parseWorkbookToRows` so the columns mean exactly what they mean on screen, and finds the VVD there;
    3. downloads the sector Sheet and reads it with `readSectorSheet`.
  - **The answer is a headline plus a short checklist**, every line a word and a symbol (never colour alone):
    - *Headline* (one of): in the report and the Sheet / in the Sheet but **not in this report yet** (cure: Refresh Now, or wait for the shared copy) / in this report but **no longer in the Sheet** / **in neither** (the feed has not
      published it; nothing in the report is wrong) / the Sheet could not be reached (the loaded rows are shown, said plainly).
    - *Loaded in this report*: port rows, lane, sale week(s), vessel, PIC; and which source it is when that is not the live feed (an uploaded file, a historical day, the offline copy), because "press Refresh Now" is wrong advice there.
    - *Live Sheet right now*: port rows and the time of the download.
    - *Max Laden*: for each port row the three columns above, and a verdict: filled on every row / blank or 0 on k of n rows (the app shows no capacity there until MCT fills it) / not in the Sheet at all.
      A change in leg count or in the Max Laden figures between the report and the Sheet is reported as "the Sheet has newer values"; **current laden is not compared** (it moves with every booking, so it would always differ).
    - *Sector Sheet*: **the sector Sheet has no VVD column** (it is one line per Sub Trade, Lane and POD Sec), so the check is "the Sheet has n lines for this VVD's lane, the report has m", plus the D56 "No sector allocation" flag.
      Said that way on screen, so nobody reads it as a VVD search.
    - *Not hidden by the slicers*: yes, or which slicer or column filter hides every port row of it (Lane, Sale Week, Sub Trade, Coast, SPC / MKG analyst, Yard, AP Status, a column filter box), using the same tests the tables use.
  - A voyage found in neither place shows only the two location lines (this report, the live Sheet) and the suggestions; Max Laden, Sector and On screen have nothing to say and are not drawn.
  - **No exact match:** up to five close VVDs and vessel names, each a button that searches it (a missing direction letter, `SROT0045` for `SROT0045S`, is the usual slip). `VMS` is explained as the placeholder for a week with no vessel nominated.
  - Test hooks, never visible text: `data-vvd-finder`, `-input`, `-search`, `-verdict` (with `data-code`), `-line="loaded|live|maxladen|sector|screen"` (with `data-status`).
- **Cost, measured:** a third folded header is one more row, +28 px: the folded Settings panel goes from about 275 to 303 px tall in the test harness (D52 measured 263 in the real app at 1600 x 900; the
  width stays 420). `Settings_Folded_Layout`'s footprint check capped the folded panel at 300 px, a test budget and not something Kevin decided, so its caps move by one header (300 -> 335, 540 -> 575) in the same commit.
- **Confirmed by Kevin, 2026-10-21 (chat, answering the three open points of the first PR):** "yes, add the Historical archive search too, but yes we only have 1 data source so that is what we are looking at. 3. that's okay 4. lets have this really for deployment".
  Read as: (1) **reading (a) stands**: Max Laden is the columns of the one live export, there is no separate Max Laden feed to add; (2) **the Historical archive search is wanted** (built, below); (3) **the 28 px of extra panel height is accepted**;
  (4) the PR is to be made **ready for deployment** (the gate green and the PR taken out of draft; merging stays Kevin's, per AGENTS.md). "We only have 1 data source" could also mean the sector Sheet is not wanted in the answer; I kept its line, which is neutral
  when there is nothing to say and costs one line, and it is a one-line removal if that was the meaning (tell me).
- **The Historical archive search (built on the same day, opt-in):** a button under the checklist, "Also search the Historical archive", never run by a plain search (a normal search downloads no archive; a test pins that). It uses the archive the way the app's own
  archive does, per-day files from the Apps Script server (`fetchPerDayArchiveIndex` / `fetchPerDayArchiveDay`, three at a time) when there is a server, otherwise the one published Sheet (`HISTORICAL_DATA_CSV_URL`, 60 s limit), and touches none of the app's historical
  state (the Historical Data popover, `historicalRowsByDate`, the parsed-day cache). **It never parses the archive**: the text is cut into records (quote-aware, so a remark with line breaks stays in one record), only the records that mention the VVD are
  parsed (with `parseWorkbookToRows`, so Max Laden means what it means on screen) and the VVD cell is then compared exactly. A synthetic 16 MB archive scans in well under a second; parsing all of it takes about 14 s. The answer is one checklist line, from every
  archived day and whether the live Sheet has the VVD now: *ok* "in 2 of 3 archived days, 2026-08-24 to 2026-08-25" with "(with gaps)" when a day in between lacks it and "Max Laden was filled on k of n of those days"; *a warning* when it was archived and the live
  Sheet no longer has it, saying whether it "dropped out after the archive's latest day" or "was last there on DATE and has been missing since"; *neutral* when the archive never held it ("new in the feed since the archive's latest day" if the Sheet has it now). A
  list of the days (newest first, with "Max Laden missing" on the days it was blank) sits under it. A failing day (a server error) is a warning with its reason and a retry button, never "not in the archive". A new search clears it.
- **Review fixes (2026-10-21, before the PR left draft).** Two read-only subagents were used (one investigating a `dist/` test failure, one reading the whole diff cold). The reviewer reported six problems; each was checked against the code before anything was changed, and all six held:
  1. *Refresh Now was promised too strongly.* Inside Apps Script, Refresh Now asks the server's shared copy first (`fetchCsvText` -> `fetchDataFeedFromServer('live')`), which refreshes every 30 to 60 minutes, while the finder downloads the Sheet itself. In that gap the Sheet has the VVD and Refresh Now cannot bring it in: the exact situation this feature exists for. The headline now says "Refresh Now brings it in once the shared copy has caught up (it refreshes every 30 to 60 minutes), so it may not show yet" when the page runs inside Apps Script and the server copy has not been found missing; the plain sentence stays everywhere else.
  2. *A stale archive line could appear under a different VVD.* The old answer stays on screen while a newer search waits for the Sheet, and its archive button was still live. The button is now disabled while a search runs.
  3. *A short query handed the whole archive to the parser.* The prefilter is a substring match, so "S" matched every record (about 14 s of parsing on the real 16 MB archive). The archive is offered only for a query of 5 characters or more (a real VVD is 9: 420 of the 421 distinct values in the real archive, the other being the `VMS` placeholder), and one search may parse at most 2,500 rows in all, else it stops and says so.
  4. *Max Laden was read differently for the report and for the Sheet.* The report's figure is the first **non-blank** of `MCT Max Laden Update`, `MCT Max Laden`, `Max LDN`, `MaxLdn` (`getVal`'s fall-through; a 0 stops it, a blank does not), and `POL Max Laden TEU` then `POL Max Laden` for the POL figure. The finder read only the exact `Update` and `TEU` cells, so a Sheet with Update blank and the older column filled (which the report shows as capacity) read as "blank" with a "figures differ" alarm no Refresh could clear. Now both sides use the same rule (`vvdReadFirst`; exact header equality, not `getVal`'s substring pass); the table still shows each column's own cell. **Real data:** zero rows of the real fixture have Update blank and the older column filled, so the published numbers (360 / 6 / 8, recounted in Python under the new rule: unchanged) do not move; this was a latent flaw, found by reading, and is tested with hand-made rows.
  5. *"Removed upstream" was said about a historical day or an uploaded file*, where it is false. Now neutral: "in the uploaded file X but not in the live Sheet now. That is expected."
  6. *Archive search robustness.* One failing day now ends the search for all three workers (they used to keep downloading and parsing the rest), the day is named in the error, a per-day call that never answers gives up after 60 s, and a day file that is a sign-in page or empty is an error rather than "searched, not there" (a file with no hit used to go unchecked).
  Smaller: ad-hoc EXE / EXW days are not counted as "Max Laden missing" in the archive line; the "newer values" reason says "the ports of call differ" when the same number of port rows has different ports; a search for an empty or `VMS` box now also clears the busy state; and the comparison uses the report's rows as they are when the Sheet answers, not as they were at the click. **Not changed (said, not fixed):** the record splitter would desync on a stray quote inside an unquoted cell; Google's CSV export quotes such cells, so it is unlikely.
  The `dist/` failure investigated alongside (`Apps_Script_Team_Features`, Notes: "(control) a click on a plain cell ... highlights it") is a fixed 450 ms sleep racing a 300 ms deferred click handler, a signature `docs/CHECK_HISTORY.md` records several times; see the PR.
- **Not built:** searching by vessel name as the main key, a copy-the-result button, a Settings-button warning dot.
- **Guard:** `tests/check_vvd_finder_logic.js` (the pure block, found by its marker lines: matching, near matches, the Max Laden verdicts and the report's own fall-through, a drift guard that fails if `FIELD_ALIASES.maxLdn` or `.polMaxLdn` change, the headline matrix, the sector line count, the hidden-by list, the archive's record splitter, prefilter and summary, and the per-day timeout; every fix above was also checked by injecting its bug and watching the check go red) and a live `Vvd_Finder` suite
  (the archive search through the single Sheet and through the per-day server, a failing day, a sign-in-page day, one bad day ending a 12-day search after 3 downloads, a crowded archive stopped by the budget, an archive blank in one column but not the other, an ad-hoc lane; a real VVD found in both places; one the Sheet gained after load, with and without the shared copy; one the Sheet lost; one in neither; a Sheet that cannot be reached; blank Max Laden; hidden by a slicer; the section folded by default and remembered; the archive button off during a slow search).
- **Built in:** the PR from `smartydog/festive-johnson-v2vzso` (production file, one PR).

### D64. A few vertical borders are heavier than the grid, and POL's blank rows lose their vertical lines (the asks and both answers DECIDED 2026-10-22; the method below PROPOSED; the heavy-border half is SUPERSEDED by D73, the blank-row half stands)

- **Decided by:** Kevin, 2026-10-22, with a screenshot of each tab and red lines drawn on the vertical borders: "So, the different weight on these vertical borders on the Overall tab.  And similar deal on the POL with the
  weight in some of the vertical borders, but also want to remove any vertical borders in the blank rows." Asked which borders and how heavy, Kevin picked "Those plus the right edge of the pinned block" and
  "2px dark grey; spacer rows only".
- **Reading (tell me if wrong):** "Overall" is the Booking Flash tab (Lane, PIC, 1st POL Cutoff ...). The drawing was read by where each red line starts: on Booking Flash the Lane | Sales Week, PIC | 1st POL Cutoff, 1st POL Cutoff | ETD Last Port and
  VVD | Vessel Name lines; on POL Booking Flash the Service | Sales Week, Sales Week | Coastal ETD, Coastal ETD | Port Cut and Port Cut | Status lines (the last drifted, so it is the least sure). "The right edge of the pinned block" adds the ETD Last Port | Status line on
  Booking Flash and the Vessel Name | VSL OPR line on both. "Blank rows" = the white spacer rows between two sales weeks on POL; the gray VMS rows are data rows and keep their lines.
- **Method (PROPOSED):**
  - **Heavy = 2px `#4b5563`** (`#d1d5db` in dark mode, one CSS variable `--bf-vsep`) on the right edge of: Booking Flash: Lane, PIC, 1st POL Cutoff, ETD Last Port, VVD, Vessel Name; POL: Service, Sales Week, Coastal ETD, Port Cut, Vessel Name. Sales Week also
    gets a heavy left (it is the line after Lane, and Lane's own cell is not there on every row). Every other vertical line stays the 1px `#9ca3af` it was. Header cells are not touched, so the lines start at the first body row, as drawn.
  - **Mechanism:** a cell marked `bf-vr` (heavy right) or `bf-vl` (heavy left) in `DetailTableRow` and `polDataRowElement`; with border-collapse the wider border wins over a neighbour's 1px. D61's sticky `::before` overlay would paint a thin grey line over a heavy one while frozen, so on a
    sticky cell the overlay takes the heavy weight too, at a 2px offset so it lands exactly on the 2px border (the 1px offset made a 3 to 4px smear, found by measuring pixels), and the sticky cell right after a `bf-vr` cell repeats it on its left edge.
  - **Blank rows:** the vertical lines in POL's spacer rows were not borders (those cells are `border-0`); they were D61's overlay on the frozen spacer's pinned pieces. The pieces carry `bf-spacer` and the overlay is switched off there. Pixel check on a spacer row, frozen: 4 non-white pixels before, 0 after.
    The Service cell spans the rows, so its heavy right line still runs through the blank rows (it is the Lane | Sales Week line).
  - **Known limit:** the line belongs to the column's cell, so hiding a column in the Fields picker takes its heavy line with it (hide PIC and the PIC | 1st POL Cutoff line goes).
- **Guard:** `checkPinnedBorders` now expects each pinned cell's overlay weight per header label (2px `rgb(75, 85, 99)` on a heavy edge, 1px `rgb(156, 163, 175)` otherwise); new `checkHeavyBorders` (one record per tab: the right edge of exactly the columns above is 2px and every other column's is 1px, from the cells' own computed border) and `checkSpacerNoOverlay`
  (POL: every pinned piece of every spacer row has no `::before`, while a data row's pinned cells and the Service cell keep theirs). Three more checks, 808 to 811.
- **Built in:** kevinmarko/booking-flash-report#246 (merged 2026-10-23).
- **Follow-up, DECIDED 2026-10-23:** Kevin, after the merge: "your changes to POL tab should be applied to Booking Flash tab; and it should match the lines in the other columns like in the BSA TEU column". Reading (tell me if wrong): the
  blank-row half of D64 applies to Booking Flash too (the heavy lines were already there). With Freeze Panes on, Booking Flash's blank rows still had vertical lines in the pinned columns (the pinned pieces had their own 1px borders plus the D61
  overlay) while the columns to the right, such as BSA TEU, are one spanning cell with none; now the pinned part has none either, so the row is one continuous grey band. The top and bottom lines stay (the row is still a grey band between two
  white-and-lined groups), and the Lane cell's heavy line still runs through. Pixel check on a frozen blank row: 4 non-white pixels before, 0 after; unfrozen was already 0. `checkSpacerNoOverlay` now runs on both tabs (811 to 812).

### D65. Settings gets a "Tools" button linking the Feeder Flash and Bottleneck Historical reports, and "Upload File" moves into Settings (the asks DECIDED 2026-10-26; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-26: "Can you add a button to the Booking Flash and call it "Tools" and link the new Feeder Flash [Apps Script URL] and also link the "Bottleneck Historical" report? [Apps Script URL] in the Settings put the button next to macro buton in
  fields button lets move upload file button to settings.."
- **Reading (tell me if wrong):** "the button" is the one new "Tools" button, and it goes in the Settings panel's chip row beside "Macro buttons in Fields", not in the top bar; "Booking Flash" is this report. Tools is one button that opens a short list with the two reports, not two
  buttons. "Upload File" leaves the top bar and sits in the same chip row.
- **Method (PROPOSED):**
  - **Tools** is a disclosure button (`data-setting="tools"`, `aria-expanded`). Pressing it unfolds a list under the chip row with one link per report (`TOOL_LINKS`, a module-level array: label, URL and the `data-tools-link` hook), each `target="_blank"` with `rel="noopener noreferrer"`,
    the same way the app's other outside link ("View in Drive") opens. The list folds again whenever Settings closes. Nothing is fetched from these URLs by this page; they are ordinary links to two Apps Script web apps on the one-line.com Workspace domain, so a reader signs in
    there (not tested from here: it needs a one-line.com account). A third report is one more `TOOL_LINKS` entry.
  - **Upload File** is the same hidden file input (`fileInputRef`) and handler as before, now behind `data-setting="upload-file"` in the chip row, right after "Macro buttons in Fields" and before Tools. It is a plain grey action button (no `aria-pressed`) and the panel stays open after it.
    Unlike the Macro chip it is on every tab. The big "Upload Underlying Data" button on the empty first screen is unchanged: with no data loaded there is no top bar and no Settings.
  - **Layout:** at the panel's 420 px width the chips no longer fit on one line, so Upload File and Tools wrap to a second line under Freeze panes and Macro buttons in Fields. The popover was not widened for it. The folded panel is about one chip row taller.
- **Guard:** two records in `Settings_Folded_Layout` (812 to 814): Upload File is gone from the top bar, sits right after the Macro chip with Tools after it, and one press reaches the page's file input once; Tools starts folded, lists exactly the two reports with their own URLs, new tab and
  `noopener noreferrer`, folds on a second press and starts folded again after Settings is closed and reopened. Two existing steps are stricter without a new record: Upload File and Tools stay on both tabs, and both stay inside the panel at 390 px.
- **Built in:** the PR from `smartydog/keen-franklin-xyvqef` (production file, one PR).

### D66. The notes library gets a `source` label and `getVvdNotesFor`, so VPT can share VVD notes (the ask DECIDED 2026-10-26; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-26, attaching the note "Booking Flash: library changes for VPT" (library version 75 already exposes `getVvdNotes` and `saveVvdNote`; its "Required" section needs no code, its two "Optional
  additions" do): "with a team of 4 agents if needed lets build out these updates".
- **Reading (tell me if wrong):** "these updates" = both optional additions, A (a `source` label) and B (`getVvdNotesFor`); the Required list is VPT-side and Apps Script settings, so nothing is built for it and it is written down in
  `apps-script/README.md`. Not built, as the note says: an email or user parameter, VPT data in the preference stores, new advanced services. The Booking Flash app file is not touched (it ignores the extra field), so no new app version.
- **Method (PROPOSED), all in `apps-script/TeamSheet.gs`:**
  - **A.** `saveVvdNote(vvd, note, visibility, source)`: `source` is exactly `'BFR'` or `'VPT'`, default `'BFR'` when omitted or `null`; anything else is `invalid-source` and nothing is written. Public notes store it in a fifth column,
    `Source`; private notes store it in the same JSON value. `notesFromRows_`, `readPrivateNotes_` and `notesReply_` return `source` on every note, and a blank, missing or unknown stored value reads as `BFR`
    (this covers every existing note and a list cached by version 75). Reading asks only for the columns the tab has, and a save to a tab with fewer than five adds the missing column first.
  - **B.** `getVvdNotesFor(vvds, opts)`: same reply as `getVvdNotes`, filtered to the asked VVDs; cache first, so no extra Sheet read. Cap 200 (a longer list is refused, not truncated).
  - **Choices the note left open, all easy to flip:** (1) an edit sets `source` to the editing app (last writer, like `Updated At`), rather than keeping the creating app; (2) an entry in `vvds` that fails the VVD rule is
    skipped and listed in an extra `invalid` field, rather than failing the whole call; (3) `source` is case-sensitive; (4) `setupTeamSheets` writes the `Source` header into E1 of an existing notes tab when it is blank (it never
    overwrites anything).
- **Guard:** `tests/check_team_features_logic.js` 457 to 511 (+54; `saveVvdNote.length` 3 to 4 and the team-data header are the two expectations changed on purpose). Nine one-line breakages of the new code (source not read, no filter in
  `getVvdNotesFor`, no column grow, cap off by one, source not validated, update not relabelling, private value dropping `source`, header overwrite, VVD rule off) each make a check fail.
- **Open (needs someone with the Apps Script project):** publish a library version and update Booking Flash's own deployment to it, then raise `Booking_flash_report` from 75 in VPT's `appsscript.json`; run the production checklist in `apps-script/README.md`. VPT's own prerequisites
  (run as each user, edit access to the Team Data Sheet for its users) are in the same section and are not in this repo.
- **Built in:** the PR from `smartydog/compassionate-volta-f8llqm`.

### D67. People can drag the column headers of Booking Flash and POL Booking Flash into any order (the ask DECIDED 2026-10-26; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-26: "with a team of 3 agents make it so people can rearrange the columns in the booking flash tabs as they like."
- **Reading (tell me if wrong):** (a) "the booking flash tabs" = Booking Flash and POL Booking Flash, the two tables that already have the Fields picker (D60, D62). (b) "rearrange" = drag a column's header to a new place; the table, its Excel download
  and the Report Card's *source columns* are untouched apart from order. (c) "as they like" = per person, kept in their browser like the hidden columns ("they don't have to follow people", D62), per tab.
  (d) Not asked, decided here so the build is safe, and easy to change: **Trade, Sub Trade and Lane stay first** (their cells are rowSpan'd down a group and the blank spacer rows between groups assume them), and **while Freeze Panes is on the
  default order shows** (the pinned columns' sticky offsets assume the default order); the saved order is kept and returns when Freeze Panes goes off. The Inland (3) and Port (3) Activity columns move as one block each, because their
  header is a two-row group. The Selection Report Card keeps its own fixed column order (it is a summary, D62).
- **Method (PROPOSED):**
  - **State:** one order per tab, a list of *unit keys* (a column key, or `inland` / `port` for the two blocks), saved as `{"v":1,"detail":[...],"pol_booking":[...]}` in localStorage `bookingFlashColumnOrder`; nothing is stored while both tabs
    are in default order. Unknown keys are dropped, duplicates dropped, and a column missing from a saved list (a column added later) is inserted after its default predecessor, so a bad or old blob never breaks a table.
  - **Rendering:** the cells stay hand-written JSX in default order, each now carrying `key={columnKey}`; the group of movable cells goes through `reorderColumnCells(rank, cells)` which flattens the fragments and sorts by the saved rank.
    In default order (and while frozen) the helper returns its input untouched, so the default view costs nothing and renders exactly as before. The row components get one new stable prop (`colRank`), so `React.memo` keeps working.
  - **Gesture:** header label cells are `draggable`; dropping on the left half of another header puts the column before it, the right half after it; a blue edge marks the drop side. The filter boxes and the resize handle are not drag handles.
    Settings > Fields gets a "Reset column order" button on each tab (disabled when already default).
- **Guard:** `tests/check_column_order_logic.js` (headless: sanitize, move, expand, freeze override, serialise) and a live `Column_Order` suite in the regression run (drag a header on each tab, cells follow in every row, persistence across reload,
  freeze override, reset, hidden-column and filter interaction, Excel download order).
- **Built in:** the PR from `smartydog/booking-flash-column-rearrange-aecb88`.

### D68. Booking Flash no longer lists AL5's westbound voyage; POL Booking Flash keeps its USMIA call (the ask DECIDED 2026-10-27; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-27, relaying the AL5 team: "We added the WB USMIA call to the EB data on the POL Flash tab which works great, but we do not want the WB voyage showing on the Overall tab ... Without changing the current layout on the POL tab, can we have the app auto hide (or not populate) the WB voyage on the Flash tab? Hoa looked at the data model and just having the app do it, may be the easiest way."
- **Reading (tell me if wrong):** (a) "the Overall tab" / "the Flash tab" = Booking Flash (one row per voyage), the tab in the screenshot; (b) "the WB voyage" = the lane's westbound voyage, whose only reason to be in AL5's data is the USMIA call; (c) POL Booking Flash, the Fields picker, Excel download and every other tab are untouched.
  Not asked, decided here: Trade Summary, Sector Summary, Compare and Analyze still read the raw rows, so they still count that call's volume. Say so if those should drop it too.
- **Method (PROPOSED):** `POL_ONLY_FOREIGN_DIRECTION = { AL5: 'W' }` in the `POL-ONLY CALL LOGIC` block of the app file: a row of a listed lane whose VVD ends in that direction letter is a "POL-only call".
  `buildTableData` drops those rows first, before it combines legs and before its VMS-placeholder rule, so a week whose only real row was that call falls back to AL5's VMS placeholder. Keyed on lane plus the voyage's direction letter, not on the USMIA port, so it needs no change if the call moves port.
  Another lane that gets the same treatment is one more entry in the table; never list a lane that really sails both ways (FLX has `S` and `N`).
- **Guard:** `tests/check_pol_only_call_logic.js` (headless). Checked live against the sample workbook plus one added AL5 `W` row at USMIA: on the unfixed app the voyage showed on both tabs, with the fix only on POL Booking Flash. Not yet run on the real feed: no AL5 `W` rows exist in the repo's sample data or 9-day history.
- **Built in:** the PR from `callingallships/jovial-moore-9029c8`.

### D69. The masthead gets the Halloween doodle as a full-width sky-and-sea band, and "Last Refresh" moves into Settings (the asks and the layout choice DECIDED 2026-10-28; the method below PROPOSED; the Last Refresh half is SUPERSEDED by D73)

- **Decided by:** Kevin, 2026-10-28, from his header doodle sheet: "use the #13 as the new header and move last refresh into settings menu and the doodle should fit fine between NA and refresh now.. give me a few options on how to arrange it", then, shown four layouts (A inline slot, B full-bleed band, C striped plaque, D faded slot): "Let's go with B".
- **Reading (tell me if wrong):** (a) "#13" = option 13 on his sheet, the Halloween scene (witch on a broomstick, bats, ghost ship, jack-o'-lantern lighthouse, ONE flagship in a witch's hat); (b) "Last Refresh" is the masthead text, not the "Data as of" stamp already in Settings; (c) the scene is a seasonal option, so it stays only as long as Kevin wants it: swapping it for another option from his sheet is a change to the `bfd*` helpers, not to the masthead.
- **Method (PROPOSED):** the scene is built once per theme (`bfdImageUrl`, the `bfd*` helpers) as an SVG data URI and set on `[data-bf-masthead]` through two custom properties, `--bfd-img` and `--bfd-sky`; the `.bfd-masthead` rule inside a `min-width: 1500px` media query turns them into the masthead's two background layers (scene at the bottom 48px, sky gradient behind it). The scene needs 1500px to clear the buttons, so below that the masthead is exactly as before (it also gets 12px side padding and a 64px minimum height from 1500px up). A background, not an element, on purpose: a first version drew it as an absolutely positioned child and lifted the real children with `z-[1]`, which made the button cluster a stacking context and put its popovers (Historical Data, Settings) under the sticky table headers (the code review of 2026-10-28 caught it). The fade under the title and the buttons is an SVG mask inside the image; the animation is CSS inside the SVG and honours `prefers-reduced-motion`. The ship's magenta is `ONE_MAGENTA`. Light and dark skies follow the app's dark mode. "Last Refresh" is a `[data-settings-last-refresh]` line under the "Data as of" stamp in the Settings footer (same value and format), not a button, so the Settings button-order checks are unaffected.
- **Guard:** the existing masthead-wrap check in the live regression suite (it measures `masthead.children[0]`, which stays the title block) and one new `Settings_Folded_Layout` step: Last Refresh is in the Settings footer and not the masthead, the media-query rule and both custom properties are wired, and neither the title block nor the button cluster is a stacking context. The suite's window is under 1500px, so the doodle on screen was checked by hand with real screenshots at 1900px (light and dark) and 1280px.
- **Built in:** the PR from `callingallships/header-doodle-layout-options-261121`.

### D70. The "voyage carries different values across its port rows" data check says which port rows disagree, and what it does to the report (the ask DECIDED 2026-10-28; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-28, pasting the banner text: "Data check: 1 voyage carries different values across its port rows in a voyage-level column; for example VVD SPDT0440W, Route Date 1st Sale Week: "2026/W40" vs "2026/W43" -- can you give more detail about this error; like we do with the other error banners"
- **Reading (tell me if wrong):** (a) "this error" = the feed-check banner's `VOYAGE_DISAGREEMENT` problem; (b) "more detail like the other banners" = the banner's own **Details** button (the orange schedule-change banner's "Full Details" is the model), which today lists only the other problems' one-line messages and so shows nothing more for a lone voyage disagreement; (c) the other problems (`DUPLICATE_KEY`, the row-count codes) are untouched.
  What was missing, from the code: the message names one voyage, one column and the distinct values, but not **which port rows** carry which value, which columns, or which other voyages. Those are what a person needs to fix it in the source.
- **Method (PROPOSED):**
  1. `checkFeed`'s `VOYAGE_DISAGREEMENT` detail gains, on top of the fields it already had (nothing removed, the message text unchanged): per example `rowCount` (port rows of the voyage) and `breakdown` (for each distinct value, how many port rows carry it and which: the non-VVD key columns of those rows, seq and yard in the app); plus `columns` (per column, how many voyages disagree), `vvds` (every affected voyage, capped) and `atColumns` (the names behind the `at` values).
  2. `FeedCheckBanner` shows its **Details** button when a problem has itemised detail even if it is the only problem, and the panel lists each example voyage with its values and the port rows holding them, the per-column counts, and the affected VVDs.
  3. The panel also says what the disagreement does to Booking Flash, per column, read from `buildTableData`: Trade, Sub Trade, Lane, Sale Week and Vessel Name are part of the group key, so the voyage is listed as **one line per value**, each totalling only its own port rows; Max Laden Update takes the **highest** port row's value; PIC and Cut/off Date take the **first** port row's value, so the other is invisible there. POL Booking Flash shows raw port rows and is not affected.
  4. **Not changed:** Dismiss stays keyed on the code alone (D46 item 2), so the new detail (counts, examples) cannot bring a dismissed banner back; the codes, their order and `data-feed-check-codes` are as before.
- **Guard:** `tests/shared_logic/20_feed_canary.js` (the breakdown, built from real rows of the 9-day CSV with one port row of a real sailing edited, because the committed data has no disagreement: every sailing agrees on all 9 days) and a step in the `Feed_Canary` browser suite (a live load with one port row's Sale Week changed shows the Details panel naming that row).
- **Not verifiable from the repo:** the live feed that produced `SPDT0440W: "2026/W40" vs "2026/W43"`. In the committed data that voyage has three port rows (USNYC, USSAV, USCHS) and all say `2026/W40` on every one of the 9 days, so which port row now says W43 is exactly what the new panel will show, on the live feed.
- **Built in:** the PR from `callingallships/tender-archimedes-i1tjno` (kevinmarko/booking-flash-report#256). Follow-up the same day: the plural message reads "N voyages carry ... across **their** port rows" (it said "its"); the singular, the text Kevin pasted, is unchanged.

### D71. Private VVD notes move from Apps Script user properties to one Google Sheet per person, so Booking Flash and VPT show the same ones (DECIDED 2026-10-27; the method below PROPOSED)

- **Decided by:** Kevin, 2026-10-27 (VPT's ADR-040): private VVD notes must show in both Booking Flash and VPT and stay private. User properties belong to one Apps Script project, so VPT could not read them.
- **Method (PROPOSED), all in `apps-script/TeamSheet.gs`, following the contract in [apps-script/PRIVATE_NOTES_FILE.md](../apps-script/PRIVATE_NOTES_FILE.md) (VPT has an identical copy and its own implementation in `new Build/src/SharedNotes.js`; a change to either needs the other):**
  - **Where:** one Sheet in the person's own Drive, shared with no one, tagged with the Drive file property `bfrPrivateNotes`=`1` (`properties`, not `appProperties`, so both apps' projects see it), found with the Drive v3 advanced service as the visitor,
    oldest file wins. Tab `Private Notes`: `VVD | Note | Updated At | Source`. Created on the first private save only. Cached per person in the user cache (`bfr:priv:1`, 30 minutes); an explicit read checks the file's `modifiedTime`.
  - **Guard kept:** the file is used only when `visitorUserStore_` says the script runs as the visitor ("Execute as: Me" still turns private notes off). The old-page rule is unchanged: a caller without `privateNotes: true` never gets private notes and causes no Drive call.
  - **Moving the old notes:** the first time a person's private notes are read or saved, their `bfrPrivVvdNote:*` user properties are copied into the file (the newer note wins when the file has the VVD), the file is flushed and read back, and only then are the properties deleted; the user
    property `bfrPrivMigrated`=`1` stops later calls scanning. Under a user lock so two tabs do not both append.
  - **Contract revision (same day, VPT ADR-040), all in `TeamSheet.gs`:** (1) after EVERY private write (a save, a delete, the old-notes move) the file is searched once more; if the oldest tagged file is not the one written to, the same VVD row (or its deletion) is
    written there too, and the file written first is trashed ONLY if that save created it (`writePrivFile_`); (2) the whole private save (find, create, write, search again) runs under `LockService.getUserLock()` with `tryLock(5000)`, and a lock that is not free replies
    `{ok:false, reason:'busy'}` like a public save. The user lock is not re-entrant, so the save takes it once and tells the old-notes move it is held (`migratePrivateNotes_(store, locked)`); a read that moves old notes takes it for the move alone; (3) an update writes the first row
    of the VVD and deletes its other rows bottom-up; (4) the execute-as guard is unchanged (`visitorUserStore_`: effective user e-mail, lower-cased, equals the active user's); (5) a failing `Drive.Files.get` on the cached id, whatever the error, means search again. A Drive v2
    service (answers `items`) is refused with an error that names v3 (taken from the independent draft in `bf-private-notes-patch`).
  - **Needs:** the Drive advanced service (Drive API v3) enabled in the Apps Script project. The repo has no `appsscript.json`; the deployed project already has it (library version 75).
- **Guard:** `tests/check_team_features_logic.js` 511 to 565, then 565 to 586 for the contract revision, then 586 to 594 for the review fixes (a row is re-checked before it is written, a leading apostrophe survives, a move that cannot finish is remembered for 5 minutes and the old notes keep showing, a failed tagging call trashes the new file, the fallback tab needs the header) (14 of the 21 new checks fail against the code before it; the fake user lock is now not re-entrant).
- **Open:** run the production checklist in `apps-script/README.md` ("Private notes in a file") on `/exec`.

### D72. The masthead buttons become two compact, translucent stacks over the doodle, and the doodle's sea is one continuous piece (the asks DECIDED 2026-10-28; the method below PROPOSED; the button layout is SUPERSEDED by D74, the sea stands)

- **Decided by:** Kevin, 2026-10-28, marking his screenshot: "Let's make these buttons under the red highlight translucent so we can see the background, and maybe we can stack historical data and the analyze button"; shown a draft: "also stack refresh notes and settings on one stack. You can shrink the buttons, and you can shrink the buttons for historical data and analyze as well."; shown the second draft: "Okay, that looks good. Let's do it. Clean up the rough edges and such and make it crisp and clean. And let's go. And you notice how like the water changes between the scene and then over by the buttons? Can we smooth that out as well?"
- **Reading (tell me if wrong):** (a) "the buttons under the red highlight" = Notes, Historical Data, Analyze and Settings (the red line was drawn under them), plus Refresh Now, which he then named for the stack; Refresh Now was already unfilled, so "translucent" changes the other four; (b) the stacks are Historical Data over Analyze, and Refresh Now over Notes over Settings, the first stack to the left of the second so Settings stays in the corner; (c) the layout is the doodle's, so it applies from 1500px up only, and below that the masthead is exactly as D69 left it (18px buttons are too small a target on a phone); (d) "the water changes" = the colour jump and the thin white vertical line in the sea under the buttons, which came from the sea being two pieces stitched at x = 1560.
- **Method (PROPOSED):** from 1500px up, `MH_STACK_WRAP` makes each group a column (`gap-0.5`), `MH_MINI_BTN` makes Refresh Now / Notes / Settings 18px high and `MH_STACK2_BTN` makes Historical Data / Analyze 28px high, so both stacks are 58px and the 64px masthead does not grow; a fixed height with centred content keeps an emoji from making one button taller than its neighbours. The fills are the old colours at 35% (Analyze 70%, because its text is white), so the sea shows through; a Historical Data snapshot being viewed keeps its solid blue, and a disabled Analyze stays solid grey. Below 1500px the wrappers are `display: contents` and `max-[1499px]:order-N` puts the buttons back in their old order, so nothing moves (measured at 1280px: every button at the same position and size as before). The sea is one path per wave, drawn from -1000 to 3000 in the scene's units with its gradients in user space, and the fade mask is as wide, so there is no seam and a masthead wider than the scene (a 2560px monitor) still has water to both edges; the waves keep the phase they had.
- **Guard:** the D69 step in `Settings_Folded_Layout` now also asserts the stack wrappers (`display: contents` in the suite's narrow window, a column from 1500px up), that the buttons keep their old left-to-right order below 1500px, and that the scene has exactly one path per wave and no stitched copy. No new record, so the counts are unchanged. The on-screen result was checked with real screenshots at 1900px (light and dark), 2560px and 1280px.
- **Built in:** the PR from `callingallships/epic-faraday-jvsrnq`.

### D73. Last Refresh returns to the masthead, one 1px border colour on both Booking Flash tabs, no dotted underline on VVD and Vessel Name, and a collapsed filter panel is not restored (the asks DECIDED 2026-10-28; the readings and method below PROPOSED; supersedes D61 and D64 and the Last Refresh half of D69)

- **Decided by:** Kevin, 2026-10-28, with two screenshots: "The refresh timestamp (I see it is under the settings so not sure if that was by design, but would like it visible on the main page. People were asking about it on the SPC/MKG call) is missing and the accordion buttons are also gone (I definitely need these). Also (not as urgent) but the borders on both the Flash and POL flash are still glitchy when you start filtering. Some lines are different weight, colors or missing. See if you can make all of the borders just 1px and the same color. Also, we can still hyperlink the VVD and vessel name but let remove the dotted line under each. ... And by default to hide the macro buttons, it shouldn't be." Then: "It is definitely the freeze panes that is causing the border issues. Look pretty normal when I turned that off other than some borders being a different color. ... Some of the vertical borders are black while some are the greyish blue, but the weight is consistent."
- **Reading (tell me if wrong):** (a) "the refresh timestamp" is the "Last Refresh" line D69 moved into the Settings footer; it goes back in the masthead and is removed from Settings (one place, not two). (b) "The accordion buttons" and "the macro buttons" are the same thing: the grey and green column-group buttons (AP Frozen, AP Status, Rotation ... Reefer) that hide and show groups of columns. The word "accordion" appears nowhere in the app, and no commit removed a control (checked against five older revisions, production 2.0 included). His screenshot is the app in its "Show Filters" state: the macro grid lives inside the collapsible filter panel, so it is gone whenever the panel is collapsed, and one click on "Hide Filters" was saved and restored on every later load, so the app opened without the grid "by default". (c) "All of the borders" means every line in the Booking Flash and POL Booking Flash tables, header and body, frozen or not: 1px, one colour. That drops D64's 2px dark group lines on purpose. (d) The VVD and Vessel Name cells stay clickable (they open a Gmail search); only the dotted underline goes. The same class is used by the Analyze drilldown, the Report Card, the schedule-change popup and Compare's Notable Vessel Changes, so those lose it too; Trade Summary and Sector Summary have no such links.
- **Method (PROPOSED):**
  - **Last Refresh:** a `data-masthead-last-refresh` span, first child of the masthead's button cluster (so below 1500px it leads the row as before D69); from 1500px up a two-line block left of the stacks on a pale pill so it reads over the doodle's sea (the pill is gone in D74: a text halo instead, and a short date). Removed from the Settings footer.
  - **Borders:** root cause (measured on both tabs): both tables were `border-collapse: collapse`, where a border belongs to the table grid and a `position: sticky` cell does not carry it, so D61 redrew each pinned cell's lines as a `::before` overlay. Two painters drew the same edge, and when filtering moved a column by a fraction of a pixel the overlay line doubled to 2px (measured: the Status | VVD line on Booking Flash filtered to Lane AN2) or sat on top of a heavy line (ETD Last Port | next, POL Port Cut | VVD). Now the two tables are `border-collapse: separate; border-spacing: 0` and every cell owns a 1px #9ca3af right and bottom line; the scroll box's own 1px #9ca3af border is the frame, so the last column and last row drop theirs; spacer cells (`border-x-0` or `border-0`) have no right line, so blank rows stay free of vertical lines (D64 follow-up kept). The overlay, `bf-vr`, `bf-vl`, `bf-spacer` and `--bf-vsep` are deleted. Header cells draw the same grey line (they drew a black inset shadow, a 2px black line between headers). The frozen edge's soft shadow on Vessel Name is narrowed (`6px 0 4px -4px`) so it no longer tints the line beside it. Dark mode uses the same grey (body cells always did).
  - **Underline:** `GMAIL_SEARCH_CELL_CLASS` loses `underline decoration-dotted underline-offset-2`; pointer cursor, blue hover and the "Search Gmail for ..." tooltip stay.
  - **Collapsed panel:** `filterPrefsApplyRestoreHazards` always restores `topPanelCollapsed` as false (it used to force it open only when a filter had restored). Hide Filters still works within a visit and is still saved; a new visit always opens with the panel and the macro grid showing. Not done, and offered: keeping the macro grid on screen while the slicers are hidden (about 20 changed lines; the grid would then no longer hide with Hide Filters), which is what to ask for if "I definitely need these" means he wants them visible even after pressing Hide Filters.
- **Tools list (a fifth ask, same day):** Kevin: "can you add this to the tool list on the Flash? Pretty much done with it, just some minor details left but its usable. Label it: "Booking Weight Audit Tool"" with its Apps Script URL. It is a third entry in `TOOL_LINKS` (D65), after Feeder Flash and Bottleneck Historical, opening in a new tab like them. The tool itself is Kevin's and is unfinished by his account ("some minor details left"); nothing here fetches from it.
- **Guard:** `Settings_Folded_Layout`'s D69 step now asserts Last Refresh in the masthead cluster and not in Settings; `checkPinnedBorders`, `checkHeavyBorders` and `checkSpacerNoOverlay` (rewritten in place, so the counts are unchanged) assert one 1px solid rgb(156, 163, 175) line owned by each pinned and unpinned body cell, the header cells and the scroll box on both tabs, no `::before` overlay, `border-collapse: separate`, and blank rows with no vertical line; `check_column_picker_logic.js` pins the narrower edge shadow. Measured by pixel scan, not only computed style: on both tabs, frozen and not, scrolled and not, filtered by Lane, Sales Week, Vessel Name and PIC, at 1x and 2x, every vertical and horizontal line is 1px #9ca3af. Not measured: fractional display scaling, Windows/Edge rendering.
- **Built in:** the PR from `callingallships/optimistic-fermi-14majq`.

### D74. Refresh Now and Settings are bigger and alone in the masthead corner; Notes, Historical Data and Analyze move down to the tab-bar row; Last Refresh loses its pill and gets a short date (the asks DECIDED 2026-10-28; the readings and method below PROPOSED; supersedes the stack layout of D72; the Historical Data / Analyze stack is superseded by D75)

- **Decided by:** Kevin, 2026-10-28: "make the last refresh background clear so it fits in better and Lets stack Notes and Settings on each other and increase their siz their size to the same size as the historical and analyze buttons. And you can use like a short date for the last refresh. Or you can put it down next to where hidden fields goes when you hide the macro fields button. And then also plop notes down there. Historical, and then put historical and analyze, stack them down there too. And keep the, increase the size of refresh and settings and keep them stacked in the corner. Let me know if you understand." I read it back; he answered with a screenshot with red arrows from the Historical Data / Analyze / Notes / Settings buttons down to the empty space in the tab-bar row, to the right of the "Fields" pill: "here if this helps".
- **Reading (tell me if wrong):** (a) The sentence that stacks "Notes and Settings" is superseded by his last one: Refresh Now and Settings stay stacked in the corner, bigger, so Notes leaves the corner. (b) "Down there" is the tab-bar row (Compare ... Booking Flash, Hide Filters, Fields), at its right end, always shown (not only while the filters are hidden), because a control that appears only after a click moves the page (CODE_NOTES.md, "Highlighting Must Not Move The Page"). (c) "Same size as the Historical and Analyze buttons" means the 28px, 12px-text size D72 gave those two; two of them stack to 58px, the same as the old stacks, so the 64px masthead still does not grow. (d) Last Refresh stays in the masthead (his first choice), with no pill, and reads over the doodle through a soft halo (a `text-shadow` in the page colour) instead of a box; the other choice he offered, down in the tab-bar row, is a one-line move if he prefers it. (e) The short date drops the year ("10/28 2:04 PM"); the full date and time are in the tooltip.
- **Method (PROPOSED):** `MH_STACK_BTN` (28px, 12px text, from 1500px up) replaces `MH_MINI_BTN` and `MH_STACK2_BTN`; Refresh Now over Settings is the only stack left in the masthead, and below 1500px the wrapper is still `display: contents`, so the buttons keep their old order (Last Refresh, Refresh Now, Settings). The tab-bar row gets a right-aligned group (`data-tabbar-tools`): Notes, then Historical Data over Analyze. It sits on the plain page, so these buttons are solid (the 35% fills were for the doodle) and the same size at every width; the row wraps as before on a narrow window. Notes is a full-screen fixed modal and Settings is `position: fixed`, so neither cares where its button sits. The Historical popover used to hang off its button, which would have covered Analyze (found in the first screenshots), so it now hangs off the stack (`relative`) and opens below both buttons; `placeHistoricalPopover` measures from the popover's own `offsetParent` instead of the button's wrapper, so it does not depend on the two sharing edges. The table-height effect already watches every element above the table, so the taller row (58px, was about 32px) shortens the table box by the difference and nothing else.
- **Guard:** the D69 step in `Settings_Folded_Layout` now asserts that the masthead holds Refresh Now and Settings (a column from 1500px up) and not Notes, Historical Data or Analyze; that the tab-bar group holds them; that Last Refresh has no background and no year. `Historical_Popover_Placement` shifts the button's nearest `position: relative` ancestor (the stack now, not its wrapper) to simulate a narrow window; the gate caught that the old test shifted a wrapper that is no longer positioned. No new record, so the counts are unchanged.
- **Built in:** the PR from `callingallships/optimistic-fermi-14majq`.

### D75. Notes, Historical Data and Analyze sit side by side in one row on the tab bar (the ask DECIDED 2026-10-29; the reading and method below PROPOSED; supersedes the Historical-over-Analyze stack of D74)

- **Decided by:** Kevin, 2026-10-29, with a screenshot of the tab-bar row (Notes (5) with Historical Data stacked over Analyze at the right end, red arrow pointing at them): "Move Notes, Histrocal data, and Analyze buttons Horizontally next to each other."; then, seeing the first version with a gap between them: "they don't need gaps in between the buttons", and, seeing the no-gap version (Notes included): "you can have a small space between them"
- **Reading (tell me if wrong):** one row, left to right Notes, Historical Data, Analyze, with a small space between them, at the same 28px size and in the same spot (right end of the tab-bar row, beside Fields); nothing else about them changes. The masthead, Refresh Now and Settings are untouched.
- **Method (PROPOSED):** the inner column wrapper in `data-tabbar-tools` becomes a flex row, and the `gap-2` is gone from the group: a small `gap-1` (4px) separates the three buttons (a first version had none: the buttons touched with their borders overlapping; Kevin then said a small space is fine). The Historical Data popover was anchored to that column so it would open under Analyze rather than over it; in a row that anchor would put its right edge under Analyze, so it is anchored to its own button's wrapper again (`relative` on `historicalWrapRef`), right-aligned under Historical Data and opening below the row. `placeHistoricalPopover` already measures the popover's `offsetParent`, so it needed no change beyond its comment.
- **Guard:** the D74 tab-bar assertion in `Settings_Folded_Layout` also requires the buttons of the group to share a vertical centre (2px) and sit close together (left edges increasing, 0 to 8px between one button's right edge and the next one's left edge). `Historical_Popover_Placement` is unchanged and still asserts the popover is right-aligned under its button. No new record, so the counts are unchanged.
- **Built in:** the PR from `callingallships/admiring-lovelace-sxf7ot`.

### D76. VVD and Vessel Name: one click selects the text, a double-click opens Gmail; a fourth Tools entry, "Falldown Dashboard" (the asks DECIDED 2026-10-29; the reading and method below PROPOSED; reverses the click model of the Gmail-search cells, D73 only touched their underline)

- **Decided by:** Kevin, 2026-10-29: "Booking Flash - reverse the logic on the VVD and Vessel Name function. 1 click highlights the text (for copying) and double click opens the Gmail search. People are often clicking on the VVD to highlight the row and getting sent to Gmail unexpectedly." In the same message, a second ask: a "Falldown Dashboard" entry for the Tools list, with a Looker dashboard URL.
- **Reading (tell me if wrong):** (a) "Highlights the text" is selecting it, the way a text selection looks, so it can be copied; it is not the row highlight. (b) The row highlight is the thing people wanted from their click ("clicking on the VVD to highlight the row"), so a single click on the cell still highlights the row after its usual short wait, and now also selects the text; only the Gmail trip moves to the double-click. (c) The keyboard path is unchanged: Enter or Space on the focused cell opens Gmail at once, because a double-click is not a keyboard gesture. (d) The note badges (the scissors and lock next to a VVD) are untouched. (e) The Falldown Dashboard is a Looker dashboard, not an Apps Script page, but it is listed and behaves exactly like the other three Tools entries: a link that opens in a new tab.
- **Method (PROPOSED):**
  - **Single click:** the delegated click listener on `[data-gmail-search]` cells selects the cell's whole text and opens nothing. It no longer stops the click, so the row's own click-to-highlight runs; the row's selection guard (which exists so a drag-select does not toggle the row) now ignores a selection that lies entirely inside one Gmail-search cell, while a selection anywhere else, such as a drag across cells, still suppresses the toggle. Detail and POL Booking Flash.
  - **Double click:** a second delegated capture-phase listener, on `dblclick`, calls the same `openGmailSearch` (same URL, new tab, `noopener,noreferrer`, same 800ms same-value debounce) and does not toggle the row.
  - **The 300ms click timer** that deferred the old single-click open, so a double-click or a selection could cancel it, is gone from the Gmail listener; the row's own 300ms defer stays.
  - **Tooltip:** `Double-click to search Gmail for <value>` (was `Search Gmail for <value>`), for VVD and Vessel Name.
  - **Tools list:** a fourth `TOOL_LINKS` entry, key `falldown-dashboard`, label "Falldown Dashboard", opening the Looker dashboard in a new tab with `rel="noopener noreferrer"`, after Booking Weight Audit Tool (D65 made the list, D73 added the third entry).
- **Guard:** `Gmail_Search_Debounce` is rewritten for the new model (9 checks to 21; the executed-check pin 847 to 859, see [docs/TESTING.md](TESTING.md)): the tooltip text on both fields; a single click selects the whole value and opens no tab; it highlights the row and a second click clears it; a selection spanning several cells still suppresses the toggle; a real click, click, dblclick sequence opens exactly one tab with the right URL and arguments and does not toggle the row; a second double-click inside 800ms opens nothing; one after 800ms opens again; a vessel name opened right after a VVD still opens; Enter and Space open at once; and the Detail table gets the same single-click and double-click pass. The Tools step in `Settings_Folded_Layout` lists the fourth entry (rewritten in place, no new record). The Notes suites already assert a badge click opens no Gmail tab and highlights no row; unchanged. Not verified: a real mouse double-click in a real browser (the checks dispatch the events, they do not drive a pointer), and how the fourth Tools entry looks at the narrowest Settings width.
- **Built in:** the branch `callingallships/falldown-dashboard-booking-flash-1cdff9` (PR number not yet assigned).

### D77. The refresh trigger also writes the live feed to one Drive file that VPT reads (the ask DECIDED 2026-10-29; the method below PROPOSED; off until `bfrSnapshotFolderId` is set)

- **Decided by:** Kevin, 2026-10-29, after the three-app feed review (VPT `new Build/docs/reviews/DATA_FEED_OVERLAP_2026-10-29.md`, option 4: VPT downloaded the same live CSV itself about 48 times a day, up to 30 minutes apart from this app): "let's do the shared BF snapshot."
- **Method (PROPOSED):** after its feed loop, `refreshDataFeeds` calls `publishFeedSnapshot_`, which writes the cached live copy (the same gzip bytes) to `booking_flash_live.csv.gz` in the folder named by the Script Property `bfrSnapshotFolderId`, with Drive `properties` `bfFormat`, `bfFeed`, `bfHash` (md5 of the CSV text), `bfFetchedAt`, `bfChangedAt`, in one `Drive.Files.update`. Only the trigger and the editor-run `publishFeedSnapshotNow` write; visitor paths (`getDataFeed`, `downloadFeed_`) never do. No library (VPT ADR-040: a library call cost VPT +343 ms ping, +493 ms open). VPT's side is its ADR-055.
- **Same content, stable file (review fixes):** when the hash has not moved only the file's properties are refreshed (new `bfFetchedAt`, `bfChangedAt` keeps the earlier time), with no content read or upload and no new Drive revision. The file id stays stable: a trashed file is restored, a moved file is kept, a lost file is found again by name in the folder before a new one is made. A script lock guards the get-or-create step, the Drive service is checked for v3 before any work, and Script Property `bfrSnapshotStatus` records every run. VPT refuses a copy older than 100 minutes (quiet hours: a visitor-downloaded copy plus the 45-minute skip can reach about 75 minutes). VPT runs as its owner (its ADR-047), so the folder needs Viewer for the account that deploys VPT and Editor for the trigger owner.
- **Guard:** `tests/check_feed_snapshot_logic.js` (35 checks; step "Shared feed snapshot (DataFeeds.gs) check" in `scripts/run_ci_locally.js`).
- **Built in:** the PR from `callingallships/data-feed-overlap-efficiency-796bf7`.

### D78. The masthead doodle changes by date: Día de los Muertos on Nov 1-3, then the autumn scene; the header code is made lighter (the ask DECIDED 2026-10-29; the readings and method below PROPOSED; builds on D69)

- **Decided by:** Kevin, 2026-10-29: "So I want the header to change for Day of the Dead for November 1st to 3rd, and then again change it to the autumn header. Please optimize these headers and make them more efficient. And you can do this with a team of 3 agents." (with his doodle sheet, `header_wave_doodle_options.html`, attached).
- **Reading (tell me if wrong):** (a) "Day of the Dead" is option 19 on his sheet (Día de los Muertos: papel picado, marigold ofrenda, sugar skull, trajinera, butterflies); "the autumn header" is option 14 (Autumn Harvest & Thanksgiving: fall trees, barn, geese, falling leaves). (b) The windows are by the viewer's local calendar date, any year: Muertos Nov 1-3, autumn **Nov 4-30**, and every other date keeps Halloween (D69's scene) as the default. **The Nov 30 end is my guess; he gave no end date, and on Dec 1 the header goes back to Halloween until he picks a winter one.** One line in `BFD_SCHEDULE` moves it. (c) "Optimize" means smaller and cheaper to build, with the picture unchanged; it does not mean fewer animations (measured below: that buys nothing).
- **Method (PROPOSED):**
  - **Schedule and registry:** `BFD_SCHEDULE` (month/day windows), `bfdSceneKeyFor(date)`, `BFD_SCENES` (`{ scene, sky, css }` per scene) and `bfdMastheadScene()`, all inside the `BEGIN`/`END MASTHEAD DOODLE` comment lines. The masthead's two custom properties now come from `bfdMastheadStyle(darkMode)`; the `.bfd-masthead` CSS is unchanged. The scene is chosen on every render (a few microseconds), so a tab left open over midnight changes scene on its next render. **Preview link:** `?headerScene=muertos` (or `autumn`, `halloween`) forces a scene before its date; unknown values are ignored.
  - **Only today's scene is loaded (per Kevin, 2026-10-29: "we don't load all the headers. We should just be loading the one header that is there today"):** each scene's drawing code is its own inert block in the page (`<script type="text/x-bfd-scene" id="bfd-scene-halloween|muertos|autumn">`, placed before the app's script), which the browser neither compiles nor runs. `bfdSceneFn(key)` reads the one block for the scene showing, runs it once as a script (no `eval`, no `new Function`: an inline script element appended to `head` and removed), and the block registers its drawing function in `window.__bfdScenes`; the shared pieces (`bfdSea`, `bfdFrontSea`, `bfdFlagship`, `ONE_MAGENTA`) stay in the app and are handed in as `h`. A block that is missing or throws gives no image (`--bfd-img: none`, the sky gradient only) and is not retried. The other two blocks stay text. `bfdImageUrl(dark, key)` then builds one image per scene and theme, the first time it is asked for, and keeps it (about 0.1 ms each).
  - **What this does and does not save (measured, Chromium, 1900px, 5 runs, Halloween showing):** in `dist/index.html` the scene source handed to the JS engine went from 19,592 B (11,609 B of it in scenes that never draw) to 1,638 B of registry text plus the 5,914 B block for the scene showing; the other 10,645 B of blocks never reach the engine. The file went from 2,651,543 B to 2,636,020 B (-15.5 KB: the scenes no longer ship twice, as source in the inert copy and again compiled). Load time did not change beyond noise: the masthead picture appears at 844 ms (before) and 871 ms (after) in `dist/` with a 150-375 ms spread, and in the source build the scenes were about 1-2 ms of a 3.2 s Babel compile. **The other two scenes' bytes are still downloaded** (the app is one pasted file, so there is nowhere else to fetch them from); what is gone is compiling, parsing and running them.
  - **Language level:** the app's compiled build is ES5 on purpose (build_deployable.js); the scene blocks are small self-contained functions with no hoisting or TDZ dependence, so they ship as written (template literals, `const`, arrow functions), which every current browser runs.
  - **Smaller image (measured):** the `--bfd-img` value for Halloween went from 33,087 (light) / 33,328 (dark) bytes to 15,835 / 16,442, about half. Almost all of that is the encoding: `encodeURIComponent` turned a 19 KB SVG into 33 KB, and only `% # < > "` need escaping in a CSS `url("data:...")`. Also: whitespace between tags collapsed, gradients nothing refers to dropped (the light theme carried an unused beam), and each animation's keyframes are included only when the scene draws that class (`BFD_CSS`, one entry per class). Frozen-frame screenshots of old and new Halloween were byte-identical PNGs, light and dark, at 1500, 1920, 2560 and 3440px wide.
  - **Lighter new scenes:** Muertos has 68 drawable nodes against Halloween's 93 (light), Autumn 46 against 79, by merging same-colour shapes into compound paths, one animated group for the geese and two shared keyframes for all the leaves. No `<text>`, filter, `<use>` or per-theme bookkeeping. Every scene reuses `bfdSea`, `bfdFrontSea` and `bfdFlagship`.
  - **Left alone on purpose:** the long sea paths. The waves move by `translateX(±2%)`, and Chrome takes the percentage from the path's own width, so shortening them changed the wave line at every width from 1500 to 3840px (the saving was 445 bytes).
  - **Not built (your call):** the animation costs about 5% of one core while it runs (0.30-0.35 s of CPU per 6 s, against 0.014 s with it off; a synthetic page, software raster, about ±10% noise). That cost is per frame, not per element: removing the steam, radar and blink moved it inside the noise. The only large saving is not animating, for example a still image after some idle time or a Settings switch; I did not build it because it changes how the header looks.
- **Guard:** the new headless check `tests/check_masthead_doodle.js` (134 checks): the date table (every day of 2026 and of the leap year 2028 against an independent rule, edge times, any year), the `?headerScene=` override and `__proto__`/`constructor` rejection, and for each scene and theme: a CSS-safe data URI, well-formed XML, the right `viewBox`, no `<text`/`<image`/`<script`/`<foreignObject`/`<use`, unique and used ids, no dead or missing keyframes, the reduced-motion opt-out, a size budget (Halloween dark plus 25%, 20,550 bytes), a stable cached string, and three scenes that really differ. And for the lazy loading: a fresh page asking for one scene runs only that block (the other blocks' text is never handed to the script runner), `bfdMastheadStyle` loads only the date's scene (or the `?headerScene=` one), a missing, throwing or empty block gives `none` without an error and is not retried, the three blocks exist, come before the app script, contain no `</script` or `<!--`, parse, and each alone registers exactly its own key and no other global, and the app's own script holds none of the scene drawing code (four deliberate breakages each turned it red). The live `Settings_Folded_Layout` doodle step no longer assumes one Halloween image or the old encoding, so it passes on any date. No new regression record, so that suite's count is unchanged.
- **Checked in other browsers:** Chromium, Firefox and WebKit (Playwright) each paint all six scene and theme images in the real masthead at 1900px (the masthead's pixels change when the image is removed); Chrome and Safari's engine were also looked at as screenshots.
- **Not measured:** the dynamic script injection inside Apps Script's own page sandbox (it is an ordinary inline script, the same kind the app already ships, but only a run on the deployed `/exec` URL proves it; if it ever failed the masthead would show its sky gradient only); the animations in motion (static frames only); a dark-mode screenshot looked at by eye in the app itself (the pixel test covers it); fractional display scaling; Windows/Edge.
- **Built in:** the branch `callingallships/day-dead-header-optimize-94fce2` (PR number not yet assigned).

### D79. The five "found, not changed" items from the #266 review are fixed (the ask DECIDED 2026-10-30; the readings and method below PROPOSED)

- **Decided by:** Kevin, 2026-10-30, asked whether every issue was fixed and shown the five items #266 had left alone: "Yes, fix them".
- **Reading (tell me if wrong):** each fix keeps today's numbers on real data and changes only the case the review flagged.
  - **Peak utilization scale:** one file is one scale, so the fraction-or-percent guess is made once per file (the median of its non-zero plain values: about 0.5 in every real file) instead of once per value with a `<= 5` cut that real data already touches (5.0 = 500%). Values become explicit percent strings at load. On the 9-day archive every value reads exactly as before.
  - **Historical slicers:** slicer selections are not pruned while a historical date is on screen; they grey out for that day, and pruning resumes against live data after Back to Live.
  - **Field-visibility defaults:** a setting is stored only once the person changes it, so a later change to a default reaches everyone who never touched it. Anyone who already opened the app has the old default stored (written on every load until now), so a future default change still will not reach them; that is not undone here.
  - **Blank Trade:** stays blank instead of being filed under TPT (real trades: TPT 614, TAT 227, LAT 123 rows in the 8-12 workbook, no blanks). A blank row now groups on its own, like a blank Sub Trade or Lane.
  - **Hover tooltip:** its state moves into its own small component, so hovering a long-text cell re-renders only the tooltip, not the dashboard. Same look and behaviour.
- **Guard:** `tests/check_review_followups.js` (19 checks, in the gate), proven red with each fix's key line removed.
- **Built in:** [#268](https://github.com/kevinmarko/booking-flash-report/pull/268), merged 2026-10-30.

### D80. The gate runs its long jobs in the background and the regression suite in three shards (the ask DECIDED 2026-10-29; the method below PROPOSED; builds on D51 and the open D59 option)

- **Asked by:** Kevin, 2026-10-29, relayed by the orchestrating session ("Code review and app optimization"): make the tests faster, with an eye to some being less needed. The gate took about 25 minutes, ran on every PR and again whenever `main` moved, and had to run twice for one PR that day. (Source: chat via that session, his exact words not recorded here; Kevin to confirm.)
- **Measured first (M4 MacBook, 10 cores, 16 GB; per-suite times now printed by the runner):** a full `--serial` gate 27:39 on the tree of this PR (2026-10-30). The two regression runs were 745 s and 742 s of that, run one after the other, each on about one core. Inside a run, Column_Picker took 227 s and Column_Order 128 s; the rest were under 55 s each. The time is spread over thousands of real re-renders (each column hidden and shown on 467- and 964-row tables), not fixed sleeps: the suite already uses condition waits (`waitFor`, `settleDom`), and its fixed sleeps add up to about a minute.
- **Built (coverage unchanged: 861 / 861 on both runs, same pin, no check edited):**
  1. **Background jobs** in `scripts/run_ci_locally.js`: the two regression runs and the basic-build check start first and run alongside the headless jobs; their logs print whole under their usual banners (`land.js`'s parser reads the banners, so they are unchanged). The two timing budgets (row highlight, column reorder) run last and alone, so their numbers are not taken under load. Running the source and `dist/` runs side by side is what D51 (DECIDED 2026-10-12) chose for the old CI; D59 left "run them in parallel as CI did" as a PROPOSED option, and this builds it.
  2. **Shards** in `tests/ci_regression_runner.js`: three browsers per run, each with clean storage and its own upload; `SHARD_TABLE` splits the suites (Column_Picker; Column_Order + Quick_Filter_Shown + Offline_Cache + Column_Filters; everything else), and the results are merged and held to the same `EXPECTED_EXECUTED_CHECKS`. The suite file is untouched: the runner adds an early return to each suite's opening line for the suites outside the shard. This is the "shard the `dist/` run" option D51 left PROPOSED, without the re-count it expected (the count is the same 861).
  3. **`--serial`** reproduces the old order exactly (and `BF_REGRESSION_SHARDS=1` one page per run), for triage.
- **Result:** default gate 5:59 against 27:39 with `--serial`, same tree, same machine, run one after the other (both 861 / 861 on source and `dist/`, every blocking job green). The critical path is now one sharded regression run (280-289 s; its slowest shard is the catch-all one, about 280 s) plus the four budgets (71 s), which measured the same as in the serial run (11, 7, 30, 23 s).
- **What could go wrong, and the answer:** (a) A check that relied on state an earlier suite left in the shared page now runs in a fresh page. Every suite passed sharded on both runs; if one ever fails only when sharded, `BF_REGRESSION_SHARDS=1` shows it, and the fix belongs in that check. (b) CPU contention: up to six browsers at once. The timing-tolerant regression checks passed under it (including with a second gate running on the machine); the two budgets that are not tolerant run alone. (c) Column_Picker is now the floor of one run (about 4 minutes); splitting it needs the suite file edited, which is not done.
- **Built in:** [#270](https://github.com/kevinmarko/booking-flash-report/pull/270), merged 2026-10-30.

### D81. Checks that may not be worth their cost (items 1 and 2 DECIDED, Kevin, 2026-10-30; items 3 to 6 PROPOSED; no check removed or weakened)

- **Asked by:** the same ask as D80 ("some being less needed"). Each item says what it asserts, what else covers it, the time it costs and its history. None is built; removing a check needs Kevin's yes, then the suite's tripwire, `EXPECTED_EXECUTED_CHECKS` and the TESTING.md counts move with it. Times are the 2026-10-29/30 measurements on an M4 unless marked as an estimate. Full evidence list: the PR description of D80.
- **DECIDED (Kevin, 2026-10-30), items 1 and 2:** "Only run the duplicate source code tests only when it's asked for." Built: `scripts/run_ci_locally.js --with-source`. Without it the
  gate skips the source regression run and the source halves of both budgets; with it they run as before. The `dist/` halves are unchanged and blocking, no suite file is
  edited and the 861-check pin stands. Items 3 to 6 stay PROPOSED, untouched.
- **Since D80 most of these save CPU, not wall clock:** the regression runs are now sharded and in the background, so only the slowest shard (Column_Picker, about 4 minutes) and the two budgets at the end are on the critical path.
  1. **The source regression run (informational)**, about 745 s of browser time per gate. It runs the same 861 checks as the blocking `dist/` run, on the same source compiled in the browser instead of ahead of time. No entry in CHECK_HISTORY records it catching a bug the `dist/` run missed; the two recorded disagreements (Land #204's merge, and the #224-era Analyze check) were timing noise or a `dist/` failure on `main` itself. It is the only run that exercises babel-standalone, so a flag (`--with-source`) would keep it available. This is D59's open "skip it by default and keep it behind a flag". **Recommendation: yes, behind a flag. DECIDED, built as `--with-source`.**
  2. **The source halves of the two timing budgets**, 11 s + 30 s, at the end of the gate where they add straight to wall clock. Production loads `dist/`; the reorder benchmark itself records source and `dist/` within about 25% of each other, and its node-survival measure is a React keying property identical in both builds. **Recommendation: drop the source halves (saves about 40 s of wall clock). DECIDED, as the same `--with-source` flag rather than a deletion.**
  3. **Column_Picker's full per-column sweeps** (about 39 s per tab, plus the no-data sweeps). Today they are the only check that each column's `!hiddenCols.<key> &&` gate wraps that column's own cells (`tests/check_column_picker_logic.js` only counts the gates). A stronger static check pairing each cell with its gate would let the live sweep narrow to the lead, pinned, Inland/Port and one-per-group columns (about 25 of 48). **Recommendation: only after that static check exists.**
  4. **Column_Picker "Booking Flash to POL" and "POL to Booking Flash"** (12.5 s each): per-tab independence, which `tests/check_column_picker_logic.js` also asserts over 400 picker clicks on the shipped code. The live step adds the click-to-table wiring, which one direction shows. **Recommendation: keep one direction.**
  5. **`tests/check_land_script.js`** (39-67 s) only matters when `scripts/land.js`, `scripts/lib/landing.js` or the stamp format change (TESTING.md). It runs in the foreground while the browsers run, so skipping it saves CPU, not wall clock. **Recommendation: leave it.**
  6. **Smaller overlaps, a few seconds each:** the extra app boots that re-test blob sanitising in Column_Picker `persistence` and Column_Order `damagedBlob` (both pinned headless); Column_Order `bothHalves` (covered by `forwardBackward`'s graded drops and the headless before/after rules); the PIC header and export checks in Field_Visibility (a subset of Column_Picker's); Column_Filters "Scope" against Column_Picker `conditionChips`. **Recommendation: not worth the churn unless a suite is being rewritten anyway.**
- **Looked at and worth keeping:** Quick_Filter_Shown (the guard for D40's real bug, red in a fix-removed run, `22d175a`); Offline_Cache (about 30 booted scenarios, no headless twin); Column_Filters "Shown-text fidelity"; Column_Picker's Freeze Panes sample, POL windowing, memo and Report Card steps; Column_Order's live drags; both budgets on `dist/`; the basic-build check; Vvd_Finder; Reference_Workbook. No check in the expensive suites was found that cannot fail or that tests something since removed (the 2026-10-11 cleanup took those out).

### D82. The roadmap build-out resumes with the slices no open decision blocks; first, the "what changed since the last day on file" banner (the ask DECIDED 2026-10-30; the reading, the order and the banner's method below PROPOSED)

- **Decided by:** Kevin, 2026-10-30, after the D79 merge: "lets continue building out all the rest of the functiuons".
- **Reading (tell me if wrong):** "the rest of the functions" = the unbuilt slices of [docs/ROADMAP_PLAN.md](ROADMAP_PLAN.md). That lifts the
  2026-10-07 hold ("the older roadmap items ... should remain on hold") for the slices that need no answer from Kevin. The slices gated on D2 to D8
  stay unbuilt until those are answered: the exception worklist (3.1 to 3.4: D2, D3, D4), notes by PIC and Status/Owner/Due (4.5, 4.6: D4), the morning
  brief (4.8: D5), the data export (5.3: D7), the archive move (0.4: D6), the history index and what hangs on it (2.5, 2.6, 5.2, 5.4: D8 and a server job).
- **Order (PROPOSED), one PR each, the app file has one writer:** (1) 2.2 + 2.3, the what-changed banner (this PR); (2) 4.3, the client half of
  shared view links (4.2's server half is built: `injectSharedView_`); (3) 4.4, `#followup` / `#done` notes badges; (4) 5.1, compare two slices of one
  day; (5) 6.1, keyboard shortcuts; (6) 4.7, named saved views; (7) 2.4, the Δ column.
- **The banner, as built (spec [docs/specs/2.3-what-changed-banner.md](specs/2.3-what-changed-banner.md); its K1-K7 answered with the spec's own
  recommendations, PROPOSED):**
  - **What it compares:** the live data on screen against the latest per-day archive date strictly before the data's as-of date
    (`BFShared.previousAvailableDate`: Monday compares with Friday, never "yesterday"). The as-of date is the server's `changedDate` (the day the
    content last changed, already in every `getDataFeed` reply), or this browser's today on the direct path. Its own loader: the archive index once
    per as-of date and the one baseline day, never the 15.9 MB single Sheet.
  - **What it says** (`BFShared.summarizeChanges`, shared so the morning brief can reuse it): removed sailings, always named (three, then "+N more")
    and first, in bold red; sailings whose laden moved 100+ TEU; newly nominated (a sailing that appeared while its sale week was already in the
    window); lanes down; and the sale-week rollover as a muted clause, never as removals (K3). Nothing else: "No material change since Sat 8/29."
  - **Lane down (K4, PROPOSED, no definition existed):** a lane whose sailings present on both days lost at least 5% AND at least 100 TEU of laden.
    The TEU floor keeps a small lane's 40 -> 30 out of the headline. Thresholds are in code (`movedTeu`, `laneDownPct`, `laneDownTeu`); the config
    Sheet keys the plan mentions are not added (that is a server change).
  - **Where:** a teal `role="status"` banner below the schedule-change warning, above the historical banner (K1: not inside "New data available").
    Details opens tables of each class; Escape closes them. Dismiss hides it for that (baseline day, as-of day, removed VVDs) combination, so it comes
    back the next day and at once when another sailing is removed; focus moves to the masthead.
  - **Setting (K5, K7):** Settings > Data & safety > "What changed", On/Off, default On, this browser only (`bookingFlashWhatChanged`). The spec's
    third mode, a one-line strip under the masthead, is not built: the panel's other rows are On/Off switches since D52. Say if the strip is wanted.
  - **Shows nothing** in the basic build, on a historical day, an upload or the offline copy, or when the archive cannot be read. "No earlier day on
    file to compare with yet." when the archive has no earlier date (K2).
  - **Booking is not compared:** the parsed rows carry no sailing-level booking column, so "changed" and "moved" use laden (and utilisation).
- **Real data** (the 9-day archive, every consecutive pair): e.g. Mon 8/31 -> Tue 9/1 "1 sailing removed (YMDT0080W) · 72 sailings moved 100+ TEU ·
  2 newly nominated · 4 lanes down"; Sun 8/30 -> Mon 8/31 "No material change (sale week rolled over: 24 out, 23 in)".
- **Unconfirmed until run on `/exec`:** that `getArchiveIndex` / `getArchiveDayCsv` answer inside the deployed page as they do in the fakes.
- **Guard:** `tests/shared_logic/50_what_changed.js` (28 assertions, real data against an oracle written in the test) and the `What_Changed` browser
  suite (16 checks).
- **Built in:** [#271](https://github.com/kevinmarko/booking-flash-report/pull/271), merged 2026-10-30. The rest of the order above is not started; no claim is held for it.

### D83. The masthead doodle shows a still image while idle, off screen or hidden; the header library is upgraded with smoother, more detailed scenes (the asks DECIDED 2026-10-29; the readings and method below PROPOSED; builds on D69 and D78)

- **Decided by:** Kevin, 2026-10-29, after D78: "let's also optimize everything by showing a still image. After some idle time would help. And let's, yes, see what kind of details and smoother animation can you come with updating the library of all the headers. I would like to see them all in the same format as the library. And do this with like four agents." (and, in the same message, "How do I change between the two different ones?").
- **Reading (tell me if wrong):** (a) "A still image after some idle time" is the same scene with its animation removed, shown after 60 s with no input; it also applies while the masthead is scrolled out of view and while the tab is hidden, where nobody can see the motion; any input brings the animation back. (b) "The library" is his doodle sheet (`header_wave_doodle_options.html`, 20 scenes); he wants an upgraded copy in the same format, to look at before anything goes into the app, so the upgraded scenes are NOT in the app yet. (c) "The two different ones" is read as Halloween/Muertos/autumn: they change by date (D78) and `?headerScene=` previews one; a Settings control to pick one is not built (one question for him, below).
- **Method (PROPOSED), idle still:** `bfdImageUrl(dark, key, still)` builds the still variant (the same drawing with no `<style>` and no `class` attributes; about 13 KB against 15.8 KB), cached under its own key and built only the first time the masthead goes idle. `bfdWatchIdle(el, dark, idleMs)` (inside the doodle region) toggles the class `bfd-still` on the masthead and sets `--bfd-img-still`; the CSS rule `.bfd-masthead.bfd-still` (inside the 1500px media query) switches the background to it. The class toggle is plain DOM, not React state, so going idle or waking never re-renders the dashboard. Listeners are on `window` (capture, passive): pointermove, pointerdown, keydown, wheel, touchstart, scroll, with the countdown refreshed at most once a second; an `IntersectionObserver` and `visibilitychange` cover off screen and hidden. One `useEffect` in the dashboard wires it, keyed on `darkMode`. With `prefers-reduced-motion: reduce` nothing is watched (that image has no motion already). The guidance used: animate only `transform` and `opacity`, give people a pause, pause work that is not being seen (modern-web-guidance `motion`, `efficient-background-processing`).
- **Why 60 s:** the animation costs about 5% of one core while it runs (measured in D78). A shorter time would flip the picture while someone reads the table; one line, `BFD_IDLE_MS`, changes it.
- **Not measured:** the CPU saved (the D78 number says what the animation costs; the idle state was checked for correctness, not re-measured); behaviour in Apps Script's page on `/exec`.
- **Library upgrade (review copy, not in the app yet):** `docs/header_library/header_wave_doodle_options_v2.html` is his sheet, same format and 20 scenes, upgraded by four agents (A: the shared sea, ship, dolphin, glint and motion code plus 3 scenes; B: 6; C: 6; D: 5), with a "Still view (idle)" button and an animation counter added. Rules every scene had to meet and was linted against: animate only `transform` and `opacity`; seamless loops (first and last keyframe equal, fades start and end invisible, drifting layers move exactly one period); no two animations on the same period, started mid-cycle; the poster frame (all animation removed) must look finished; at most 140 nodes and 16 KB per scene. Result over 40 renders: lint clean, at most 132 nodes and 15.8 KB, 13-22 animations per strip (the originals ran 12-36 and some looped with a pop). Poster frames of all 20 are in `poster_frames_light.png`; the README lists what changed. Agents B and C were cut off when the previous session ended, after writing their scene files but before their notes; I assembled their files as they stood and reviewed every render, and fixed the one shared tug transform that the animation overrode. Not verified: motion watched live, CPU cost of the new waves and glints, browsers other than Chromium.
- **Open for Kevin:** (1) which upgraded scenes to port into the app (Halloween, Muertos and Autumn are the three it shows); (2) whether he wants a Settings control to pick the header by hand instead of `?headerScene=`; (3) the winter header and the end of autumn (D78).
- **Built in:** the branch `callingallships/day-dead-header-optimize-94fce2` (PR #275).

### D84. Build out the 2026-10-30 user-research recommendations for Booking Flash in four phases with agent teams (the ask DECIDED 2026-10-30; the plan, ADR-R1 and the phase order PROPOSED)

- **Decided by:** Kevin, 2026-10-30: "build out a detailed plan to build out the recommendations for the booking flash report. To build out in phases and with teams of agents." (the source is his desk study "User Research: Ideas & Suggestions for Empty Planning, Booking Flash and Vessel Planning", 2026-10-30).
- **The plan:** [docs/RESEARCH_BUILDOUT_PLAN.md](RESEARCH_BUILDOUT_PLAN.md). Phase 0 answers (D2, D3, D4, D8 and new Q1-Q7), Phase 1 trust quick wins (data-as-of chip, threshold health, row link menu), Phase 2 decision layer (needs-attention worklist with decision card, threshold proposals and decision log, action drafts, call mode, phase-out flag, PIC editor), Phase 3 shared services (expected landing, weight, cut-off trust). Each phase names its agent team, file ownership and merge order; the app file keeps one writer.
- **ADR-R1 (DECIDED 2026-10-30):** Kevin, in chat, picked "Team Data Sheet tabs (Recommended)". Decisions, threshold proposals and PIC overrides are append-only tabs in the Team Data Sheet through `TeamSheet.gs` (the public-notes pattern, identity from `Session.getActiveUser()`); Drive files only for what this app publishes to VPT (the D77 pattern). An external database is rejected (paid, second sign-in). The threshold log never writes to the MCT.
- **Phase 0 answered (DECIDED 2026-10-30):** Kevin, 2026-10-30, answering the D84 plan's Phase 0 questions in chat (he picked the recommended option each time): D2, D3, D4, D8 as above, and Q1-Q7 and ADR-R1's dependants at the plan's defaults ("Accept defaults (Recommended)" for Q1, Q2, Q4, Q5, Q6, Q7; "Config Sheet map (Recommended)" for Q3: the lane SPC lead plus Kevin approve threshold changes). ADR-R1 itself and the worklist sort order (cut-off first) were not asked and stay PROPOSED.
- **Additive only (DECIDED 2026-10-30):** Kevin, the same day: "make sure we don't change any of the highlighting or math issues or anything like that. So no changes, only enhancements and features". No slice of this plan changes an existing calculation, highlight or colour rule, existing UI element, or existing check's assertions; new features add their own markers and functions beside them (plan section 2, rule 8). A slice that cannot avoid such a change stops and comes back to Kevin as its own decision.
- **Q6 and Q7 changed to match VPT (DECIDED 2026-10-30):** after the sister-repo search (plan section 4a), Kevin, 2026-10-30: "Yes, match VPT". Q6: booked weight comes from the Opus Container Activity feed's per-booking Gross Weight MT (what VPT reads), not the Weight Audit Tool. Q7: a phased-out vessel lists VPT's Shift-options candidates (same POL, within +/-2 sale weeks, sharing discharge ports, frozen ones marked) and the analyst picks, instead of one "most open space" suggestion.
- **Phase 1 started 2026-10-30** (Kevin, in chat, after the plan PR: "and go with phase 1"). Slices 1-A (freshness chip), 1-B
  (threshold health) and 1-C (VVD link menu and `?vvd=`) are claimed below; 1-D (snapshot on) waits for Kevin's folder wiring. The
  first PR is the shared logic (`freshnessLabel` in `shared/40_feed_age.js`, new `shared/60_threshold_diff.js`); the app slices follow
  one PR at a time.
- **Phase 1 built in** #279 (shared logic), #280 (1-A freshness chip), #281 (1-B threshold health) and #282 (1-C VVD link menu
  and `?vvd=`), all merged 2026-10-30. Kevin ran #282's `/exec` checklist before merge ("Checklist done, merge", 2026-10-30).
  Still open: 1-D (snapshot on) waits for `bfrSnapshotFolderId`; the `vptWebAppUrl` Config Sheet row enables Open in Vessel Planning.
- **Phase 2 started 2026-10-30** (Kevin, in chat: "Start Phase 2"). Wave 2a first: 2a-1 identifiers and 2a-2 `findExceptions`
  (one shared PR), 2a-4 the `EP_EXPORT` reader, and the UX specs for the decision card, action drafts and call mode. 2a-3 (the
  decision records, ADR-R1) followed once Kevin accepted ADR-R1 the same day.
- **Worklist sort (DECIDED 2026-10-30):** Kevin, in chat, picked "By days in exception": the Needs-attention worklist (2b-1)
  sorts longest-running exception first by default, as spec 3.3 K7 proposed (not the research's cut-off order).
- **Worklist build choices (PROPOSED 2026-10-31, slice 2b-1, agent B5; Kevin to confirm or change):** where spec 3.3 is silent or
  predates D2, the panel does this. (1) One flat list in `sortExceptions(list, 'days')` order, not spec K7's groups: the sort decision
  above puts the longest-running item first whatever its kind, and each row's reason names its kind in words, so nothing is colour-only.
  (2) D2 split spec K3's "over threshold" into two kinds with their own copy: "Bookings over threshold for N days" (`over_booking`) and
  "Laden over threshold at a port for N days" (`over_laden`), each followed by `findExceptions`' detail ("booking 2182 > cap 2162
  (1880 x 1.15)"). (3) Over-threshold sailings already past their cut-off are left out (spec section 5's assumption; on the 9-day data
  that is 11 of 23 items on 2026-09-01); unowned and no-cut-off items are kept whatever the cut-off. (4) N = 3 and the free lane FLX are
  constants in the app (D3, D4): a Config Sheet key needs a `TeamSheet.gs` change and an `/exec` check, left for a later slice. (5) It reads
  only the archive days threshold health already downloads (its 7-day window), so it downloads nothing of its own, needs What changed on,
  and a streak that reaches the first day read shows as "8+ days". (6) Fields are the app's own (`getVal`): Max Laden is the table's
  `maxLdn` ("MCT Max Laden Update" first), which differs from the shared test's "MCT Max Laden" on 154 of 8,769 rows of the 9-day CSV;
  the 2026-09-01 counts are the same either way, but FSLT0003S (FLX, past cut-off, so not shown) starts its over_booking streak two days
  earlier. (7) The Settings switch ("Worklist", hidden only in the basic build) sits in Settings > Find a vessel, not Data & safety: one
  more row there breaks the Settings footprint check's 615 px cap. (8) A row click focuses the table container (tabindex="-1" set at that
  moment); a sailing with a blank lane or sale week is filtered by its VVD column filter instead. (9) OPEN, for Kevin (raised by the
  coordinator): spec K2 counts consecutive ARCHIVE days, `findExceptions` counts consecutive CALENDAR days (a day with no archive file
  ends the streak); left as built in `shared/70_exceptions.js` until Kevin decides.
- **Decision card build choices (PROPOSED 2026-10-31, slice 2b-2, agent B5; Kevin to confirm or change):** the brief's open
  questions OQ1-OQ8, each answered with its recommendation. (OQ1, OQ7) The decision record gains two optional fields, additive in
  `shared/65_decisions.js` and `saveDecision`: `rollTo` (a real VVD, the Roll target; `invalid-roll-to` otherwise) and `seen` (what the
  person was looking at: `curLaden`, `ceiling`, `threshold`, `declaredFinal`, `fallDownPct`, `epAsOf`, `dataAsOf`; `invalid-seen`
  otherwise). A record without them is unchanged, and no existing test assertion changed. (OQ2) A save on a key someone decided since
  the card opened is refused by the server (`stale-supersedes`); the card re-reads, shows the newer decision in amber ("... Nothing of
  yours was saved yet. Review, then Save again."), keeps the typed reason and action, and the next save supersedes the newer one; spec
  C6 is amended to say so. (OQ3) The POL Booking Flash port is read at click time from the row's Port cell; no attribute or prop is
  added to a table row, so the row-highlight budget is untouched. (OQ4) K1-K8 as the spec recommends: per sailing and port (the
  `polKey` is the app's POL, the feed's yard code, e.g. `USTIW02`, since the app's rows carry no calling sequence), a reason of 3-500
  characters for every action, anyone signed in may save, "Cut bookings"; no `FallDown` Config tab exists yet, so the card shows F0
  "No fall-down assumption configured." (OQ5) An author is shown as the local part of the email (`ryan.t`). (OQ6) `EP_EXPORT` landed
  (#285), so E0-E3 are built from the `epExport` of the `getDataFeed` reply: off, none, ok, stale (K4: over 24 h, or past cut-off minus
  2 days) and unmatched (two rows at the port, which cannot be told apart without the sequence), matched by VVD and the yard's port
  (`BFShared.matchDeskDeclaration`, a terminal equal to the yard wins); tested on fixtures only (EP is not connected in production,
  Q-EP1). (OQ8) The R-4 spec header now says DECIDED per D84. Also: the ceilings use `findExceptions`' own rule (new
  `BFShared.decisionCeiling`: Max Laden x threshold, strictly above), so the card and the worklist agree; the sailing line's
  "Booked" is the sailing booking total (as `findExceptions` reads it) and the port line's ceiling is Max Laden x the POL Laden
  Threshold (the worklist's detail), with POL Max Laden shown beside it; the table's own Current Laden, Max LDN, Short_Fall and
  Standby Threshold are shown as the Booking Flash table prints them (`buildTableData` on the VVD's unfiltered rows, unchanged). The
  card is offered only for live data. Decisions are notes: nothing in a table, a highlight, a threshold or a filter reads them.
  Review fixes (Kevin, 2026-10-31: "okay lets fix those"): `rollTo` is kept only for a Roll (ignored for other actions); `seen` records the
  PORT's laden, ceiling and loading threshold, plus the sailing's `bookingSailing` under its own key; `decisionCeiling` reads numbers
  exactly as `findExceptions` does (parity-tested; '1,640' is not a number to either); a yard-code POL whose single Empty Planning row
  names another terminal is "unmatched", not that row; a re-read keeps the decisions on screen; a double click saves once; Decide is
  shown only where the card can open (live data), and a VVD with no rows says so. A `Decisions` row whose `rollTo` or `seen` breaks
  the rules (a hand edit) is now an invalid record, so it is skipped on read and counted in `skipped` (apps-script/README.md).
  OPEN, for Kevin (rule 8): the row menu's fourth item, "Decision card" (spec section 3), is built but switched off
  (`DECISION_CARD_IN_ROW_MENU = false`), because the Vvd_Link_Menu regression check pins that menu at exactly three items and an
  existing check's assertion may not change without Kevin. Until he says yes, the card opens from the worklist's Decide button only;
  saying yes is that one constant plus the three-item list in Vvd_Link_Menu.
  DECIDED (Kevin, 2026-10-31, verbatim): "keep it off until all parts of it is. tested". The row-menu item stays off until every part
  of the decision card is tested: the apps-script/README.md "Decision store" /exec checklist run in full (save and read with `rollTo`
  and `seen`, sign-in identity, the lock, the stale-supersedes race) and the desk-declaration states (E0-E3) checked against the
  real Empty Planning export, not only fixtures. Only then is the constant switched on with the Vvd_Link_Menu three-item list.
- **Threshold proposal build choices (PROPOSED 2026-10-31, slice 2b-3, server and shared half, Apps Script agent; Kevin to confirm or
  change):** how Q3 ("Config Sheet map (Recommended)": the lane's SPC lead plus Kevin approve) is enforced. (1) The map is a new
  Config Sheet tab, **Threshold Approvers** (`Lane | Approver Email | Notes`, one row per lane and person), not a `Settings` key: so
  `APP_CONFIG_KEYS_`, `APP_CONFIG_LINK_KEYS_`, `loadAppConfigFromSheet_` and `window.__SERVER_CONFIG__` are unchanged and no
  approver address is injected into every page. Created by the admin-only `setupThresholdApprovers`; read uncached on every call.
  (2) "Kevin" is the project admin by the existing check (`assertArchiveAdmin_(false)`, Script Property `bfrArchiveAdmin`); he may
  decide on any lane. (3) The sailing's lane is read by the server from the live feed it already caches (`Vessel 1st Lane` of the
  VVD's rows), never from the page; no feed, no row or two lanes is `lane-unknown` (on the 9-day CSV every real VVD of 2026-09-01,
  368, has exactly one lane). (4) Fail closed: no approver tab is `approvers-not-configured` for everyone, Kevin included; an empty
  tab lets only Kevin decide. (5) Whoever proposed the value being decided (the latest `proposed` record walking back) cannot
  approve it (`own-proposal`), Kevin included (four eyes); a rejection of one's own proposal is a withdrawal and is allowed to
  someone who may decide. The same rule applies to `rejected` as to `approved`. (6) Additive: the checked path is a NEW endpoint,
  `decideThresholdProposal`, which stores a server-set `check: { as: lead|admin, lane }` in the threshold payload (optional, new in
  `shared/65_decisions.js`; a record without it reads as before; `invalid-check` for a bad one). The 2a-3 `saveThresholdChange`
  is unchanged and still accepts `approved` / `rejected` from anyone, because `tests/check_decisions_logic.js` pins that and an
  existing assertion may not change without Kevin; it cannot forge a `check` (its payload is built from named fields), so the new
  `BFShared.thresholdProposals` shows such a decision as `unchecked`, never approved. OPEN, for Kevin: may that unchecked path be
  closed (`saveThresholdChange` refusing `approved` / `rejected`), which changes what several threshold assertions of the 2a-3 check pin? (7) New read
  endpoints `getThresholdApproverRights` (the caller's own lanes, admin flag, configured flag; never anyone else's address) and
  `getThresholdProposals`; new shared helpers `parseThresholdApprovers`, `thresholdApproverLanes`, `thresholdProposerOf`,
  `thresholdApprovalCheck`, `thresholdProposals`, `thresholdProposalChip` (`shared/67_threshold_proposals.js`); the chip text is
  "Threshold proposed 150% by ryan.t" / "Threshold approved 150% by kevin, not yet in feed" and hides once the feed shows the value.
  Records only: nothing feeds a value into a table, highlight, ceiling or live threshold (rule 8). Verified against fakes only;
  the `/exec` checklist is apps-script/README.md "Threshold proposals: who may approve".
  Security review fixes (coordinator's independent review of 44dea19, 2026-10-31): (8) each `check` carries an HMAC-SHA256 `sig`
  under a Script Property secret (`bfrThresholdCheckKey`, made by the first decision, never returned); the server verifies it on
  read and before deciding, and a forged, edited or keyless check reads as `unchecked`. A hand edit can still delete or reorder rows
  but cannot fake an approval. (9) Anyone who authored a `proposed` record of the decided value in its chain cannot approve it
  (re-proposing someone's value does not launder it). (10) Approving a verified checked rejection is `proposal-rejected`; a new
  proposal is needed. (11) `getThresholdLog` / `BFShared.thresholdLog` say their `approved` is unchecked and point to
  `getThresholdProposals`.

### D85. The worklist moves into the Settings menu and the masthead "Flash data" chip is removed (DECIDED 2026-10-31)

- **Decided by:** Kevin, 2026-10-31 (relayed verbatim by the Phase 2 coordinator): "Lets move the worklist into settings menu and remove the
  Flash data chip from the header".
- **Supersedes:** the worklist's placement in D84 slice 2b-1 (spec [3.3](specs/3.3-worklist-panel.md) section 3, "under the masthead") and
  D84 slice 1-A's masthead freshness chip ("Flash data: 14 min ago (hourly)", #280). Nothing else of D84 changes.
- **What was built (the reading, agent B5):** (1) The "Needs attention" bar and its `[data-worklist-slot]` under the masthead are gone. The same
  worklist is a folded section of the Settings menu, "Needs attention (N)", first among the folded sections, its header summary the per-kind
  preview; folded by default and remembered per browser (`bookingFlashSettingsWorklistOpen`), like the other three. Same rows, same
  `sortExceptions(list, 'days')` order, same copy and footer, and the list is worked out exactly as before. A row's click closes Settings, then
  does the same click-through (lane and sale week replaced, table focused, polite status). Spec K9 holds: no section when there is nothing to
  list (no history, What changed off, a historical day, an upload, the basic build). The on/off switch stays in Settings > Find a vessel.
  (2) The masthead chip is removed (its component and helper with it); Last Refresh in the masthead and the Settings "Data as of" stamp are
  unchanged. `BFShared.freshnessLabel` (shared/40_feed_age.js) stays, with its tests, for a later reader.
- **Tests:** the Worklist suite is rewritten for the new home (count unchanged, 20, its "tables unchanged with it on and off" checks kept);
  Freshness_Chip now pins the chip's absence (14 -> 6). Total 948 -> 940. The Settings footprint check is unchanged: its boots have no archive
  history, so the new section does not appear there. Rule 8 holds: no number, highlight, threshold or filter behaviour changed.
- **Review fixes (2026-10-31, the same branch):** the section header's summary is a short fixed line, "Longest-running first", so the
  header is one line like the others (the per-kind preview wrapped beside the title and made the folded panel 389 px; it is now the
  first line inside the section). With the section the folded panel measures 379 px, so the Worklist suite checks it against
  Settings_Folded_Layout's caps moved by exactly one folded header (375 -> 410, 615 -> 650), as D63 did; that suite's own caps are
  unchanged. A row click now moves focus once, straight to the table (Settings no longer restores focus to its button first); a refresh
  that removes the focused row moves focus to the section header; the list's group label starts "Needs attention, N items".

### D86. More space in the Settings menu (DECIDED 2026-10-31)

- **Decided by:** Kevin, 2026-10-31 (relayed verbatim by the Phase 2 coordinator): "lets add more space in the settings menu".
- **The reading (agent B5, the coordinator's interpretation):** give the Settings popover more room. It is 480 px wide on a desktop (was
  420); the viewport clamp is unchanged, so on a 390 px phone it is the window minus the margins exactly as before. Its maximum height
  was already the whole window below the Settings button, so it is unchanged. The footprint checks get at least 100 px of headroom
  over the measured heights: Settings_Folded_Layout folded 339 px (cap 375 -> 440), all open 608 px (cap 615 -> 710); the Worklist
  suite's boot with the "Needs attention" section folded 379 px (cap 410 -> 480), all open 648 px (cap 650 -> 750); width caps
  420 -> 480. Kevin's request authorises those cap changes only; no other assertion changed.
- **Not restored:** the worklist header's per-kind preview. At 480 px the header leaves about 280 px beside its title (448 px inside,
  title 153 px, padding), and the preview measures 326 px at its 11 px size, so it would wrap again; the header keeps "Longest-running first" and the preview stays inside the section.
- Rule 8 holds: no number, highlight, filter or default changed.

### D87. The notifications move into the Analyze button's menu (DECIDED 2026-10-31)

- **Decided by:** Kevin, 2026-10-31 (relayed verbatim by the Phase 2 coordinator): "Let's move the threshold bar and all those notifications
  and just put that in the analyze menu button. Just put it under there."
- **The reading (the coordinator's interpretation, built by agent B5):** the What changed banner, the Threshold health bar and the "Large
  schedule change detected" warning leave the banner stack above the masthead. Real failures stay there (the parse error, the live-fetch
  error, the Sector fetch error; the feed check, which says the data may be wrong, also stays), and so do the bars that say what is
  filtered right now (the threshold-missing filter bar, the `?vvd=` bar). The 🚢 Analyze button becomes a menu button: its menu has
  "Open analysis" (the analysis modal as before; disabled with its reason when there is nothing to analyze) and under it
  "Notifications", holding the moved banners with the same text, links, actions and dismiss keys. Each notification shows exactly
  when it was shown before; nothing about how they are worked out changed. The button is enabled when analysis is available or there
  is a notification, carries a count badge of the notifications not dismissed, keeps its D74 look and place, and is also shown on
  the tabs without analysis while there is a notification (otherwise those would be unreachable there). The menu is placed and closed
  like the Settings popover (under the button, clamped into the window, scrolling at the window's bottom, Escape and a click outside
  close it, focus back on the button). One small change of behaviour: the "N sailing-ports have no threshold" link also closes the menu
  when it applies the filter and opens POL Booking Flash, so the table it filtered is in view.
- **Tests:** only the locators changed (where a check finds a moved banner, it opens the menu first; "the Analyze button is enabled"
  became "analysis is available", and opening the analysis goes through "Open analysis"); every content and behaviour assertion is
  kept. A new Analyze_Menu suite pins the placement, the badge, the menu, Escape, the other-tab case, 390 px, dismissing in the menu
  and the tables unchanged. Rule 8 holds: no number, highlight, filter or default changed.
- **Review fixes (2026-10-31, the same branch):** the button names its menu (`aria-controls`, `id="bf-analyze-menu"`); a polite status
  announces when the notification count goes up; Escape closes only the topmost popover (not the menu while Settings, Full Details or
  the analysis window is up); Settings and the Analyze menu close each other; the button is always in the row (hidden, out of the tab
  order, on a tab with nothing to show) and its badge slot is a fixed 16 px, so the row does not move when a notification comes or
  goes; the checks that say a moved banner is gone now require the menu to be open.

### D88. Threshold proposals get approve / reject screens in the Analyze menu (the go-ahead DECIDED; the screens PROPOSED, 2026-10-31)

- **Asked by:** Kevin, for slice 2b-3 (relayed by the Phase 2 coordinator): "and then go". The server and shared half landed as #293
  (`decideThresholdProposal`, `getThresholdApproverRights`, `getThresholdProposals`, `BFShared.thresholdApprovalCheck`); this is the
  app half.
- **Proposed (agent B5; Kevin to confirm or change):** a folded "Threshold proposals" block in the Analyze menu's Notifications, under
  Threshold health (the threshold UI already lives there since D87), listed only while there is a pending proposal (state proposed or
  unchecked) and only when the server answers (no `google.script.run`, or an older Code.gs without these functions: nothing is shown and
  nothing is asked). It counts as one notification on the Analyze badge while it has pending proposals. Proposals are grouped by lane
  (the lane the app's rows give the VVD; the server reads its own), each with the `BFShared.thresholdProposalChip` text, the old and new
  value, the proposer's reason, and "unchecked" on a decision saved through the older path. Approve and Reject take a required reason
  and call `decideThresholdProposal({ id: latestId, status, reason })`; each button is enabled only when
  `BFShared.thresholdApprovalCheck` (with `proposers: thresholdProposersOf(records, latestId)` and `targetRejected: state === 'rejected'`)
  allows it, else disabled with the reason in words. The server stays the judge: every refusal code gets a plain message, and
  `stale-supersedes` offers a refresh. Records only (rule 8): nothing feeds a number, a highlight, a threshold or a filter, and the
  older `saveThresholdChange` path is untouched.
- **Review fixes (2026-10-31, the same branch):** the block shows on the live feed only (not for a historical day, an upload or the
  cached copy, whose lanes must not drive the buttons), as Threshold health's change list; a failed refresh keeps the last good list
  and the typed reasons and says "Couldn't refresh. Try again." (only a failed first read hides the block); the own-proposal line offers
  "reject it to withdraw it" only when Reject is allowed, and Reject's own reason is shown when it differs; after a decision focus moves
  to the next row's reason box (else the block's toggle, else the Analyze button) and "Approved: ..." / "Rejected: ..." is announced and
  kept at block level, so a late result is not lost; the why-line is the buttons' `aria-describedby`; the reason box's label names the
  port and accepts the server's 1000 characters.

## Working on (claims)

Claim an area (a function or feature) before you start, so a second session sees it. A claim is a row in this table, committed on
its branch.

- **Claim before starting; claims expire after 7 days** (renew by editing the date); **delete your row when your PR lands**.
- **The honest limit:** a claim is only visible to other sessions once it is on `main`. So claims cover intent before any code is
  pushed; `node scripts/check_pr_overlap.js` covers branches that are already pushed. Neither is a lock, and neither stops anyone.

| Area (function / feature) | Who (session or person) | Branch / PR | Claimed | Expires |
|---|---|---|---|---|
| `shared/05_identifiers.js`, `findExceptions` (D84 2a-1, 2a-2) | Phase 2 orchestrator session (agent B1) | callingallships/phase2-shared-2a | 2026-10-30 | 2026-11-06 |
| `EP_EXPORT` reader in `DataFeeds.gs` (D84 2a-4) | Phase 2 orchestrator session (agent B2) | callingallships/phase2-ep-export | 2026-10-30 | 2026-11-06 |
| Specs R-4 decision card, R-6 action drafts, R-7 call mode (D84 wave 2a) | Phase 2 orchestrator session (agent B4) | callingallships/phase2-wave2a | 2026-10-30 | 2026-11-06 |
| Worklist panel ("Needs attention", D84 2b-1): `WorklistPanel`, `buildWorklist`, `worklistRecords`, the `bookingSailing` field | Phase 2 orchestrator session (agent B5) | callingallships/phase2-worklist | 2026-10-31 | 2026-11-07 |
| Decision card (D84 2b-2): `DecisionCard`, the row menu's fourth item, the worklist's Decide button, `shared/75_decision_card.js`, `rollTo` / `seen` in `shared/65_decisions.js` and `saveDecision` | Phase 2 orchestrator session (agent B5) | callingallships/phase2-decision-card | 2026-10-31 | 2026-11-07 |
| Threshold proposals, server and shared half (D84 2b-3): `decideThresholdProposal`, `getThresholdApproverRights`, `getThresholdProposals`, `setupThresholdApprovers` in `TeamSheet.gs`, `shared/67_threshold_proposals.js`, `check` in `shared/65_decisions.js` | Phase 2 orchestrator session (Apps Script / shared agent) | callingallships/phase2-threshold-proposals | 2026-10-31 | 2026-11-07 |

<!-- Example row (delete this comment's content, not the table header, when you add a real one):
| `handleShowInTable` (2.5 Analyze) | session on the follow-up round | example-branch / #000 | 2026-10-06 | 2026-10-13 |
-->

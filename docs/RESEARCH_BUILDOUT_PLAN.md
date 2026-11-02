# Booking Flash: build-out plan for the 2026-10-30 user research (phases and agent teams)

Status: **PROPOSED**, 2026-10-30, for Kevin's review (D84 in [DECISIONS.md](DECISIONS.md)). **Phase 0 answered the same day:** Kevin took the
recommended answer to D2, D3, D4, D8 and Q1-Q7 (section 5); ADR-R1 and the worklist sort order are still PROPOSED. Nothing here is built and no code
changes with this document. Source: Kevin's desk study "User Research: Ideas & Suggestions for Empty Planning, Booking Flash and
Vessel Planning" (2026-10-30), Booking Flash section ideas 1-13 and the parts of "How the three apps should connect" that need
work in this repo. Empty Planning and Vessel Planning work is out of scope except where Booking Flash reads from or publishes to
them.

This plan sits **on top of** [ROADMAP_PLAN.md](ROADMAP_PLAN.md), not beside it. Several research ideas are roadmap slices that are
already specified and only waiting on answers (D2-D4); this plan says so per idea instead of re-specifying them, and reuses the
roadmap's eight roles (R1-R8).

---------------------------------------------------------------------------------------------------

## 1. Summary

The research's one-line finding for Booking Flash: the weekly calls repeat the same loop by voice (spot an overage, weigh fall-down
and empties, choose freeze or monitor, tell someone) and none of it is captured in the app. The build-out turns Booking Flash from a
number-reading tool into a decision tool in four phases:

| Phase | Theme | Length (estimate) | Gate to start |
|---|---|---|---|
| 0 | Answers and wiring | this week | none |
| 1 | Trust quick wins: data-as-of chip, threshold health, row link menu | 1-2 weeks | none left (Q1, Q2 answered); ready to start |
| 2 | Decision layer: needs-attention worklist with decision card, threshold decision log, action drafts, call mode, phase-out flag, PIC editor | 4-6 weeks | ADR-R1 accepted (D2, D3, D4 DECIDED 2026-10-30) |
| 3 | Shared services and big bets: expected landing, weight beside TEU, cut-off trust, shared shell hooks, Max Laden editing | later | 4-6 weeks of history index data; three-app agreement |

Each phase runs as **one agent team** of 4-7 agents. Logic, server and test work runs in parallel; the app file stays a serial queue
with one writer (AGENTS.md). The orchestrator is this kind of session: it keeps a ledger, starts the agents, and verifies every
agent report against the diff and the gate before anything is called done.

---------------------------------------------------------------------------------------------------

## 2. Constraints every design below respects

These are not choices; they come from AGENTS.md and the decision log, and they shape every option.

1. **One app file, one writer** (`node scripts/print_app_file.js` names it; currently 21,633 lines). Parallel agents split by
   artifact: `shared/`, `apps-script/`, `tests/`, `docs/specs/`. The generated shared region is the only other write, and
   shared-logic PRs merge one at a time (D1).
2. **No build step, React 18 + Babel Standalone.** New UI is components in the same file; `dist/index.html` is generated.
3. **Server is Apps Script** (`Code.gs`, `DataFeeds.gs`, `TeamSheet.gs`). Writes go to the Team Data and Config Sheets or Drive.
   No Apps Script libraries between apps (VPT ADR-040: +343 ms ping, +493 ms open); cross-app data moves as Drive files (D77).
4. **No paid service, no GitHub Actions** (D59). The gate is `node scripts/run_ci_locally.js`; `--post-status` is the receipt.
5. **Identity exists here.** Booking Flash already reads the visitor's email (`Session.getActiveUser()`, `apps-script/Code.gs:478`,
   and per-person private notes, D71). Unlike VPT (ADR-047), "who changed it" is possible in this app today. Confirm on `/exec`
   that the deployment still returns a non-empty email for domain users (D8 names who runs that).
6. **Verify against real data**, label the rest UNCONFIRMED; server features are not "working" until their `/exec` checklist is run.
7. **No silent state** (roadmap ground rule 9): anything restored, cached or read from another app shows its source and age.
8. **Additive only: no changes to what exists, only enhancements and features** (Kevin, 2026-10-30: "make sure we don't change any
   of the highlighting or math issues or anything like that. So no changes, only enhancements and features"). Concretely:
   - No change to any existing calculation, aggregation, `getVal()` mapping, utilisation or shortfall formula, threshold
     comparison, or the numbers any existing cell, tab, export or Analyze view shows.
   - No change to existing row or cell highlighting, colour rules, status colours or the row-highlight code path; new features
     add their own markers (chips, badges, panels) beside the table, never by recolouring a row.
   - No existing column, button, banner or masthead item is removed, renamed, moved or restyled; new items sit beside them.
   - No existing check's assertions are edited or loosened to make a slice pass. A slice that needs an existing assertion
     changed is not additive: it stops and goes to Kevin as its own decision.
   - New calculations (expected landing, threshold diffs, exceptions) live in new `shared/` functions with their own tests and
     never feed back into an existing figure.

### What the feed already carries (checked against DATA_ARCHITECTURE.md, 2026-10-30)

This decides how much of the decision card needs a new data source. Most of it does not.

| Decision-card input (research idea 4) | Field already parsed | Gap |
|---|---|---|
| Overage | `curLaden`, `maxLdn`, `shortfall` (DAX-equivalent override) | none |
| Threshold | `standbyRaw` (= `MCT Overall Threshold` on 8,769/8,769 rows), `polLdnThresh` | none: D2 DECIDED 2026-10-30, a ceiling over Max Laden; 0 and 0.01 = not set |
| No-activity and inland volume | `inlandAct`/`inlandNoAct`, `portAct`/`portNoAct`, `activeTotalTeu` | none |
| Empties | `plannedMty`, `actualMty` (POL tab) | the desk's *declared* number lives in Empty Planning's `EP_EXPORT` (not connected, Q-EP1) |
| Expected fall-down | none | no curve exists; Phase 2 uses a per-lane assumption from the Config Sheet, Phase 3 the retention curve (roadmap 5.2) |
| Owner's merit, phase-out | `opIssues`, `remarks`, `diffSailings` removals | no structured field; typed into the decision log |
| Weight (idea 8) | `bsaWgt`, `loadableWgt` (allocation side) | **no booked-weight column**: needs Opus Container Activity's gross weight, as VPT reads it (Q6, Phase 3) |

---------------------------------------------------------------------------------------------------

## 3. Architecture decision

### ADR-R1: Where decisions, threshold changes and action records live

**Status:** Proposed. **Date:** 2026-10-30. **Deciders:** Kevin (product), Adam (for anything VPT reads).

#### Context

Phase 2 creates the first records in this app that are neither feed data nor notes: a decision per vessel per call ("monitor, not
freeze Savannah, because ~70 TEU empties and expected fall-down"), a threshold change with reason and approver, and the action a
person drafted from it. They must be shared across the team, attributed to a person, kept as history (never overwritten), visible on
the row, and readable by VPT later (the research's "decision card" also belongs on the Voyage Hub). About 10-15 concurrent users;
volume is tens of records a day.

#### Options considered

**Option A: append-only tabs in the Team Data Sheet, through `TeamSheet.gs`** (the pattern public notes already use).

| Dimension | Assessment |
|---|---|
| Complexity | Low: `saveVvdNote` / `getVvdNotesFor` / Sheet locking already exist; two new tabs (`Decisions`, `ThresholdLog`) |
| Cost | Free |
| Scalability | Fine at tens of rows a day; a Sheet read is ~1 s, so the client loads once per refresh and caches |
| Team familiarity | High: same code path as notes (D66, D71) |

Pros: identity comes from `Session.getActiveUser()`; history for free (append-only, newest wins per key); admins can read and fix
rows in Sheets; VPT can read it the same way it reads public notes. Cons: Sheet write latency (~1-2 s); concurrency needs the
existing `LockService` guard; schema lives in code, not in the Sheet.

**Option B: one JSON file per record (or per day) in a Drive folder**, the D77 data-bus pattern.

| Dimension | Assessment |
|---|---|
| Complexity | Medium: listing, merging and ordering many files; no row-level editing for admins |
| Cost | Free |
| Scalability | Good for publish-once data, poor for many small writes (Drive API quotas per user) |
| Team familiarity | Medium (D77 exists, but writes only from the trigger) |

Pros: the same mechanism VPT already reads. Cons: visitor writes to Drive need each user to have Editor on the folder; audit and
correction are harder; many small files.

**Option C: an external database (Firebase, Cloud SQL, Supabase).**

Rejected up front: a paid or new hosted service conflicts with D59's spirit ("I'm not paying money for it"), adds a second sign-in,
and nothing in the volume needs it.

#### Decision (DECIDED 2026-10-30: Kevin picked "Team Data Sheet tabs")

**Option A for records written by people; Option B only for what this app publishes for other apps.** Concretely:

- `TeamSheet.gs` gains `saveDecision(vvd, polKey, payload)`, `getDecisionsFor(vvds)`, `saveThresholdChange(...)`,
  `getThresholdLog(sinceIso)`; each row stores `id, vvd, polKey, kind, payload JSON, author email, createdAt, supersedes`.
  Never update in place; a correction is a new row with `supersedes`.
- The record shapes and "latest per key" logic are pure functions in `shared/60_decisions.js`, so the browser, Apps Script and
  any future VPT reader share one definition (D1).
- When VPT wants decisions, the refresh trigger adds them to the Drive snapshot next to `booking_flash_live.csv.gz` (one more
  file under `bfrSnapshotFolderId`), not a live call.
- The threshold log records **proposals and approvals made in this app**. It does not write to the master constraint table (MCT);
  someone still applies the change at the source until Phase 3 idea 13 is decided. The row shows "proposed / approved / live in
  feed", and "live in feed" is detected by the next refresh seeing the new value.

#### Trade-off analysis

A is chosen because the hard parts (identity, locking, shared/private split, VPT readability) are already solved for notes, and the
volume is two orders of magnitude below where a Sheet becomes a problem. B's strength is fan-out to other apps, which is why it is
kept for publishing. The main cost of A is that the Sheet is also the audit store, so an admin can edit history by hand; the
`supersedes` chain and the author column make that visible, and the research did not ask for tamper-proof audit.

#### Consequences

- Easier: decisions show on the row and in VPT without a new service; "thresholds changed in the last 7 days" is a query.
- Harder: Phase 2 slices that touch `TeamSheet.gs` each need an `/exec` checklist run (D8 must be answered).
- Revisit: if decisions exceed ~5,000 rows a year, archive by year into a second tab; if Adam wants VPT to write decisions, add a
  `source` column like notes (D66).

### ADR-R2 (smaller, recorded in the plan only): cross-app reads go through the server, not the browser

Empty Planning's `EP_EXPORT` (empties declared per vessel and port) is read by `DataFeeds.gs` on the refresh trigger, cached like
the live feed, and handed to the client in the `getDataFeed` reply with its own `fetchedAt`. The browser never fetches a second
app's CSV (one sign-in, one cache, one age chip). Off until a Script Property names the source, like `bfrSnapshotFolderId`.

---------------------------------------------------------------------------------------------------

## 4. Every research idea, mapped

"Roadmap" means a slice in [ROADMAP_PLAN.md](ROADMAP_PLAN.md) that already covers most of it. IDs `R-n` are used in the phases below.

| ID | Research idea (Booking Flash #) | Status today | Builds on | Blocked by | Phase |
|---|---|---|---|---|---|
| R-1 | "Data as of" chip, two sources labelled (1) | Partly built: Last Refresh in masthead (D73/D74), `BFShared.feedFreshness` (roadmap 1.1) | `shared/40_feed_age.js` | none | 1 |
| R-2 | Threshold health: missing-threshold banner + changed in last 7 days (2) | Not built. Missing = blank, 0 or 0.01 (D2); changes = archive diff | archive index (D82 loader), `diffSailings` pattern | none | 1 |
| R-3 | Per-row link menu: VPT deep link, Opus, Gmail (3) | Gmail search on double-click (D76) | D76 cell handlers | Q2: no Opus item until someone supplies a per-VVD Opus URL | 1 |
| R-4 | Needs-attention worklist + decision card (4) | Roadmap 3.1-3.4, spec [3.3](specs/3.3-worklist-panel.md) | `findExceptions` (3.1, unbuilt), history index (2.5, unbuilt) | ADR-R1 for the card's decision; the D4 email list filled in | 2 |
| R-5 | Threshold proposals and decision log (5) | Not built | ADR-R1, R-2 | ADR-R1 | 2 |
| R-6 | Action buttons that draft email or ticket (6) | Not built; weight tool has the pattern | R-4 card, R-5 log | the `ActionRecipients` tab filled in (Q4) | 2 |
| R-7 | Call mode: lane readout of what changed since last call (7) | What-changed banner built (D82, `BFShared.summarizeChanges`) | D82, R-5 | none (Q5 answered) | 2 |
| R-8 | Weight beside TEU (8) | Allocation weight shown; booked weight not in feed | Opus Container Activity gross weight (Q6, as VPT reads it) | access to that feed from the trigger | 3 |
| R-9 | PIC / ownership editor with history (9) | Not built; PIC comes from MCT | ADR-R1 pattern | Adam (one PIC rule across apps) | 2 |
| R-10 | Phase-out flag with suggested roll target (10) | Schedule-change warning lists removed sailings | `diffSailings` | none (Q7 answered) | 2 |
| R-11 | Expected landing from a shared fall-down curve (11) | Roadmap 5.2 (retention curve) | history index 2.5 | 4-6 weeks of index data; agreement with VPT's rolling fall-down | 3 |
| R-12 | One shell for all tools (12) | Tools list (D65, D76) | design tokens (cross-app move 4) | three-app decision; mostly outside this repo | 3 (BF hooks only) |
| R-13 | Max Laden and BSA editing with approval (13) | Not built; generator file upload | R-5 log | who owns MCT writes; likely outside the app | 3 (decision first) |
| X-1 | Publish shared snapshot for VPT (connect move 4) | Built, off (D77) | | `bfrSnapshotFolderId` set (Phase 0) | 0 |
| X-2 | Shared identifiers contract: VVD, port key, service-to-revenue lane map, one PIC rule (move 1) | Not built | `shared/` | Adam's sign-off on the PIC rule | 2 |
| X-3 | Accept a vessel in the URL; link to VPT and back (move 3) | View links (roadmap 4.2 server half built) | roadmap 4.3 | none (Q1 answered; confirm VPT's parameters) | 1-2 |
| X-4 | Read EP_EXPORT for the decision card (move to Empty Planning) | Not built | ADR-R2 | Q-EP1 workbook link | 2 |
| X-5 | Consume a cut-off trust feed (move 6) | Not built | | the feed must exist (three-app work) | 3 |

---------------------------------------------------------------------------------------------------

## 4a. What the sister repos answered (searched 2026-10-30)

At Kevin's request ("search for ... answers ... in the Max Laden file and the vessel planning file"), three read-only Sonnet agents
searched `Max-Laden-genn-main` (MLG) and `vessel-planning-tool` (VPT). The orchestrator re-read every citation below before
recording it. Paths are in those repos; VPT paths are under `new Build/`. No sister-repo file was changed.

| Question | What the repos say (evidence) | Effect on this plan |
|---|---|---|
| D2 threshold meaning | MLG writes `%THRESHOLD` on the same upload row as Max Laden, scoped Trunk Overall and Trunk Loading (`app/CONTRACT.md:68`, B4: "most frequent value among MCT records" over 8 sales weeks). MLG stores **percent** (150 on 478 Overall rows, fixtures); our feed shows the same as a **ratio** (1.5). Loading excludes "threshold < 2 (blank threshold counts as <2)" (`docs/specs/04_loading.md:103`); Overall filters on allocation, not threshold (`03_overall.md:92`) | D2 stands. Code compares in ratio and labels the unit; 0 and 0.01 = not set rests on the Loading rule and is INFERRED for Overall |
| Lane map (X-2) | Booking Flash's own Sheet has a **Space_Analyst** tab (gid 1828622870): `Lane,Dir,Trade,Sub_Trade,Region,Analyst,Revenue_Lane,IB_DIR,Notes`, 48 lanes (`app/tests/fixtures/golden_full/space_analyst.csv`, counted). Revenue lane = service lane + trade suffix (AL2 to AL2TA). 19 VVDs sell under two revenue lanes (`CONTRACT.md:73`) | 2a-1 reads that tab instead of inventing a map; the map is many-to-one, not a function |
| D4 `Resid`, `TBA` | VPT: "Kevin 2026-10-27: Resid left", so his voyages count as unassigned; `TBA` = unassigned; `EC SPC` / `WC SPC` are team accounts, never a person (`src/BfFeed.js:210-221`) | Worklist: Resid and TBA = unowned; EC SPC / WC SPC = owned by the team, not unowned |
| D4 PIC emails | VPT keeps them in its settings key `myWork.picEmails`, format `Name=email;Name=email`, empty by default, filled by admins in the live Sheet (`src/Config.js:489`). No addresses are in either repo | Use the same key name and format in our Config Sheet so one list serves both apps |
| One PIC rule (X-2) | Three rules today (`docs/reviews/DATA_FEED_OVERLAP_2026-10-29.md:51`): VPT latest week per revenue lane; BF `MCT PIC` per VVD; MLG B52 newest week per 3-letter service. The review recommends B52 for all three, "decide the rule for all three" (`:70`) | **Additive rule:** the PIC column this app shows does not change. The worklist uses the row's `MCT PIC` so it never contradicts the table. Adopting B52 here would be a change: Kevin's call, not part of this plan |
| Q1 VPT link | Params `lane`, `vvd`, `view` (`src/Api.js:1480-1491`); lane optional when vvd is given; `view` = daily, full, lane, shift, ... (`src/Config.js:151`); VVD must match `^[A-Z0-9]{4,16}$`. The `/exec` URL is in VPT `HANDOFF.md:16` | 1-C builds `<VPT exec>?vvd=<VVD>&view=full`, URL in the Config Sheet |
| Q2 Opus link | No per-VVD Opus URL in either repo | Confirmed: no Opus item |
| Q3 approvers | No approver list or approval workflow anywhere. VPT: lane owners edit their lanes, admins (Kevin, Hoa, Adam) edit all, cover analysts until a date (`src/Config.js:42`, `:396`) | Approver = the lane's PIC (from the email map) or an admin. Same people as Kevin's answer, named from the same data |
| Q4 recipients | No terminal, planner or desk lists exist. VPT alerts go to Google Chat webhooks per lane, set in Script Properties; its cut-offs email (R9) is unbuilt, recipients "not defined" | `ActionRecipients` must be filled by Kevin; default To = the lane PIC's email |
| Q5 calls | No call schedule in either repo | Default stands |
| Q6 booked weight | MLG has BSA and Loadable weight only. VPT's only booked weight is per-booking Gross Weight MT from the Opus Container Activity feed (`python_etl/parsers/opus_activity.py:531`) | DECIDED: use VPT's source (Q6 above) |
| Q7 roll target | No rule anywhere. VPT's Shift options lists same-POL sailings within +/-2 sale weeks that share discharge ports, and "the analyst will roll" | DECIDED: list VPT's candidates (Q7 above) |
| Snapshot (X-1) | VPT reads Script Property `VPT_BF_SNAPSHOT_FILE_ID` (a file id, not a folder), refuses copies older than 100 min (`src/BfFeed.js:85-87`); not deployed on VPT's side | Wiring: set `bfrSnapshotFolderId`, run `publishFeedSnapshotNow`, copy the file id into VPT |
| Notes Sheet | VPT reads `bfrTeamSheetId`, else a constant (`src/SharedNotes.js:49-50`); its docs warn the two apps must match | Kevin reads back this app's `bfrTeamSheetId` and confirms it equals VPT's constant |
| EP_EXPORT (X-4) | Columns: `as_of,vvd,lane,group,port,port_key,terminal,terminal_name,empties,export_laden,prelim_dec,prelim_teu,final_dec,final_teu,cutoff,etd,note,remark` (`docs/waves/WAVE_EP_2026-10-29.md:64-69`); the workbook link (Q-EP1) is open; VPT flag `features.emptyPlan` off | 2a-4 parses exactly these columns; the card shows `final_teu` as declared, `prelim_teu` as requested |
| Fall-down | VPT rolling fall-down parked and off (`features.fallDownRolling`); default flat 15 % (`fallDownPctDefault`); per-lane `fall_down_pct` in its lane settings; the planned shape is lane x POL x days-to-cut-off buckets 14+, 7-13, 3-6, 0-2 | The card's assumption uses the same 15 % default and per-lane override, so both apps show one number; R-11 uses VPT's buckets |
| Identity | VPT runs as owner, anonymous access (ADR-047, `appsscript.json`); it cannot name the user | Decisions are attributed here; VPT can show them read-only with our author field |

---------------------------------------------------------------------------------------------------

## 5. Phases

Each phase lists its slices (one PR each unless noted), then its agent team. A slice is done only when section 7 says so.

### Phase 0: answers and wiring (answered 2026-10-30)

Kevin answered every question in chat on 2026-10-30 by picking the recommended option ("Ceiling over Max Laden", "3 days,
configurable", "Config Sheet map", "Accept defaults"). The DECISIONS entries D2, D3, D4, D8 and D84 quote them.

| # | Question | Answer (DECIDED 2026-10-30) | Unblocks |
|---|---|---|---|
| D2 | What do the threshold columns mean? | A ceiling over Max Laden (Overall per sailing, Loading per POL; 1.5 = 150%); 0 and 0.01 mean "not set" | R-2, R-4, R-5 |
| D3 | Days before something is an exception | 3 consecutive archive days, a Config Sheet key, recalibrated after two weeks | R-4 |
| D4 | PIC name to email; where blank PIC is normal | A name-to-email map in the Config Sheet (VPT's `myWork.picEmails` format); blank PIC is normal on FLX only. `TBA` and `Resid` (left the team) count as unowned; `EC SPC` / `WC SPC` count as the team (section 4a) | R-4, R-9 |
| D8 | Who runs `/exec` checklists, when | Kevin, once per server PR, before merge | every server slice |
| Q1 | VPT deep-link format | VPT's `?vvd=&lane=&view=` (confirmed in VPT's code, section 4a) | R-3, X-3 |
| Q2 | A per-VVD Opus URL? | None known, so no Opus item until someone supplies one | R-3 |
| Q3 | Who approves a threshold change | The lane's SPC lead plus Kevin; list in the Config Sheet | R-5 |
| Q4 | Recipients per action | Config Sheet tab `ActionRecipients`; the app only drafts, never sends | R-6 |
| Q5 | Call-mode baseline | SPC/MKTG EC/TA/LAT and PN/PS calls; "since last call" = the same weekday last week | R-7 |
| Q6 | Booked-weight source | **Changed to match VPT** (Kevin, 2026-10-30: "Yes, match VPT"): per-booking Gross Weight MT from the Opus Container Activity feed, the source VPT's ETL already reads, summed per VVD and port | R-8 |
| Q7 | Roll target for a phased-out vessel | **Changed to match VPT** (Kevin, 2026-10-30: "Yes, match VPT"): list VPT's Shift-options candidates (same POL, within +/-2 sale weeks, sharing discharge ports; frozen sailings marked); the analyst picks | R-10 |

**Still PROPOSED (not asked):** ADR-R1 (section 3) and the worklist sort order (section 10, item 2).

**Data Kevin still has to supply** (not decisions, but Phase 2 cannot finish without them): the PIC emails (and whether `Resid` is
a person), the threshold approvers per lane, and the `ActionRecipients` list. Phase 2's B2 agent creates the empty Config Sheet tabs
so they can be filled in.

Wiring (Kevin, no code): set `bfrSnapshotFolderId` and share the folder (D77), confirm both apps read the same public-notes
Sheet ID (research "decide first" item), and record the EP workbook link if it exists (Q-EP1).

**Team for Phase 0:** none. The answers went into DECISIONS in the same docs-only PR as this plan.

### Phase 1: trust quick wins (1-2 weeks)

| Slice | What gets built | Files | Tests |
|---|---|---|---|
| 1-A (R-1; the masthead chip was removed 2026-10-31, superseded by D85) | One chip in the masthead: "Flash data: 14 min ago (hourly)", amber past 75 min, red past 3 h; tooltip names the source and says the container drill-down is near-live from BigQuery and separate. Sits beside the existing Last Refresh text, which stays exactly as it is (rule 8) | app file; `shared/40_feed_age.js` gets `freshnessLabel(source, ageMs, cadenceMs)` | shared logic assertions; regression checks on chip text and colour at three ages; real-data note |
| 1-B (R-2) | Threshold health: a banner "N sailing-ports have no threshold" (click filters to them), and "Thresholds changed in the last 7 days: N" opening a table (VVD, port, old, new, first day seen). Change detection compares archive days (the D82 loader), so no server work | `shared/60_threshold_diff.js` (`findMissingThresholds`, `diffThresholds(dayA, dayB)`); app file | assertions on the 9-day CSV with an oracle; browser suite `Threshold_Health` |
| 1-C (R-3, X-3) | A small "..." menu on VVD and Vessel Name cells: Open in Vessel Planning, Search Gmail (same as double-click), Copy VVD, Opus if Q2 says so. Also: the app accepts `?vvd=` and filters to it with a visible banner | app file | regression checks for each menu item's URL; `?vvd=` restore banner |
| 1-D | Snapshot on (X-1): run D77's checklist on `/exec` once the folder is set | none (checklist) | `/exec` checklist result recorded in apps-script/README.md |

**Who "who changed it" is for 1-B:** archive diffs cannot see a person, only the day. The banner says "first seen" and points to the
decision log once R-5 exists. That is honest and needs no server change.

#### Team for Phase 1 (5 agents, 1 week of work, ~2 weeks wall clock with review)

| Agent | Role | Owns | Runs in | Model |
|---|---|---|---|---|
| Orchestrator | lead | ledger (`TASKS.md` in scratch), DECISIONS claims rows, merge order, final report | this session | Opus |
| A1 Logic | R2 | `shared/40_feed_age.js` additions, `shared/60_threshold_diff.js`, their `tests/shared_logic/` files, sync | worktree `bf-r1-logic` | Sonnet |
| A2 Data verifier | R4 | real-data oracles: missing-threshold counts per day, threshold changes across the 9 days, written before A1's code is read | worktree `bf-r1-data` | Sonnet |
| A3 App writer | R1 | the app file only: 1-A, then 1-B, then 1-C, serially, after A1's PR merges | worktree `bf-r1-app` | Opus |
| A4 Test engineer | R5 | browser suites `Threshold_Health`, chip and link-menu checks; `jobs` entries in `scripts/run_ci_locally.js`; TESTING.md rows | worktree `bf-r1-tests` | Sonnet |
| A5 Reviewer | R8 | read-only `/code-review high` per PR, red run for 1-B (remove the fix, see the check fail) | shares the PR's worktree, read-only | Opus |

Order: A1 and A2 start together (A2 must not see A1's code: independent oracle). A4 writes checks against the spec in parallel. A1's
PR merges first (shared logic, one at a time). A3 then builds 1-A, 1-B, 1-C as three PRs, each merged before the next starts. A5
reviews each PR before merge.

### Phase 2: the decision layer (4-6 weeks)

Starts once ADR-R1 is accepted (D2, D3 and D4 were DECIDED on 2026-10-30). Four sub-waves; the app file's queue is the critical path.

**Wave 2a: foundations (parallel, no app-file hand edits)**

| Slice | What | Files |
|---|---|---|
| 2a-1 (X-2) | `shared/05_identifiers.js`: VVD normalise, port key `PORT#SEQ`, service-to-revenue lane map (EC4 to EC4TP) from a fixture, one PIC parser. Shared test fixtures that VPT can copy | `shared/`, `tests/fixtures/identifiers/` |
| 2a-2 (roadmap 3.1) | `findExceptions(days, config)` as specified in the roadmap, using D2's threshold meaning and D3's N | `shared/` |
| 2a-3 (ADR-R1) | `shared/60_decisions.js` (record shapes, latest-per-key, supersedes chain) and `TeamSheet.gs` tabs and functions; `setupTeamSheets` creates the tabs | `shared/`, `apps-script/TeamSheet.gs` |
| 2a-4 (ADR-R2, X-4) | `DataFeeds.gs` reads `EP_EXPORT` when `bfrEpExportUrl` is set, caches it, returns `{rows, fetchedAt}` in `getDataFeed` | `apps-script/DataFeeds.gs` |
| 2a-5 (roadmap 2.5) | History index (if not built by then): needed by R-4's persistence and by Phase 3 | `apps-script/`, `shared/` per spec 2.5 |

**Wave 2b: the worklist and decision card (app queue, serial)**

| Slice | What |
|---|---|
| 2b-1 (R-4, roadmap 3.3) | The "Needs attention" panel per spec 3.3, sorted by days in exception (spec K7; DECIDED 2026-10-30, Kevin picked it over the research's cut-off order) |
| 2b-2 (R-4) | Decision card: opens from a worklist row or the row menu. Shows overage vs threshold, inland and port active / no-activity, planned and actual empties, the desk's declared empties (from 2a-4, with its age), an expected fall-down line using the lane's Config assumption labelled "assumption", owner's merit / ops notes, the latest decision. Buttons: Freeze, Monitor, Cut, Roll, each saving a decision with a reason (2a-3) |
| 2b-3 (R-5) | Threshold proposals: from the card or Threshold Health, propose a new value with reason; an approver (Q3) approves; the row shows a chip "Threshold proposed 150% by X" until the feed shows the new value |

**Wave 2c: telling someone (app queue, serial)**

| Slice | What |
|---|---|
| 2c-1 (R-6) | Action drafts: each decision offers "Draft email" which opens a Gmail compose URL (or `mailto:`) with recipients from `ActionRecipients` and a body built by `shared/` (`draftActionText(decision, row)`). No mail scope, nothing sent by the app |
| 2c-2 (R-7) | Call mode: a full-screen lane-by-lane readout. For each lane, what changed since the call baseline (`summarizeChanges`), open worklist items, decisions taken since last call; "Record decision" inline; at the end, "Copy minutes" (decisions and action items as text) |
| 2c-3 (R-10) | Phase-out flag: a sailing removed from the schedule (`diffSailings`) that still holds bookings on its last day on file is flagged in the worklist with Q7's candidate list (same POL, +/-2 sale weeks, shared discharge ports, frozen ones marked); the analyst picks |
| 2c-4 (R-9) | PIC editor: an admin page writing `PicOverrides` (ADR-R1 pattern) with history; the app shows the override with "edited by" and falls back to MCT. Only after Adam agrees on one PIC rule (X-2) |

**Wave 2d: verify in production.** `/exec` checklists for 2a-3, 2a-4, 2b-2, 2b-3, 2c-4 (D8's owner), then two weeks of use, then
roadmap 3.4's recalibration of N and the worklist rules on the new data.

#### Team for Phase 2 (7 agents; at most 4 running at once)

| Agent | Role | Owns | Active in | Model |
|---|---|---|---|---|
| Orchestrator | lead | ledger, claims, merge order, the red runs across sessions, weekly status to Kevin | all | Opus |
| B1 Logic | R2 | 2a-1, 2a-2, 60_decisions, `draftActionText`; one shared PR at a time | 2a, 2c | Sonnet |
| B2 Apps Script | R3 | `TeamSheet.gs`, `DataFeeds.gs` (2a-3, 2a-4, 2a-5), apps-script/README.md checklists | 2a | Opus (locking, quotas) |
| B3 Data verifier | R4 | oracles for `findExceptions` on the 9 days, EP_EXPORT fixture from a real export, recalibration report (3.4) | 2a, 2d | Sonnet |
| B4 UX | R6 | specs before code: `docs/specs/R-4-decision-card.md`, `R-7-call-mode.md`, `R-6-action-drafts.md`, each with its K-questions for Kevin; phone and 1366 px screenshots | 2a (specs), 2b-2c (screenshots) | Opus |
| B5 App writer | R1 | the app file: 2b-1, 2b-2, 2b-3, 2c-1, 2c-2, 2c-3, 2c-4 in that order | 2b, 2c | Opus |
| B6 Test engineer | R5 | browser suites `Worklist`, `Decision_Card`, `Threshold_Log`, `Call_Mode`; fakes for the new server functions in the regression harness; perf budget runs (row component props change) | 2a-2c | Sonnet |
| B7 Reviewer | R8 | `/code-review high` and `/security-review` on every server PR (recipient privacy, who may approve, injection into Sheet cells and email bodies) | all | Opus |

Parallelism: wave 2a runs B1, B2, B3 and B4 at once (no shared files). Wave 2b/2c is B5 alone on the app file, with B6 writing checks
against B4's specs one slice ahead and B7 reviewing behind. The orchestrator holds B5 until the slice's shared and server PRs have
merged, so B5 never builds against an unmerged branch (AGENTS.md: no stacking).

### Phase 3: shared services and big bets (later)

Each item is a decision first, then a mini-team like Phase 1's. None starts before Phase 2 has two weeks of real use and the
interview round in the research has run.

| Item | Prerequisite | Team shape |
|---|---|---|
| R-11 Expected landing | history index with 4-6 weeks; roadmap 5.2 retention-curve report (B3) shows a stable curve per lane and days-to-cut-off; agreement with VPT on one curve | logic + data verifier + app writer + reviewer; curve in `shared/70_falldown.js`, published in the Drive snapshot for VPT and EP |
| R-8 Weight beside TEU | Opus Container Activity weight (Q6) read by the trigger (ADR-R2 pattern), or VPT's bundle if it publishes a per-VVD total; shown in a new column beside TEU, never changing an existing one | Apps Script + app writer + tests |
| X-5 Cut-off trust | a reconciled cut-off feed exists (three-app work, owner TBD) | Apps Script reader + app chip "cut-off confirmed / from Opus / moved from 10/18" |
| R-12 One shell | three-app decision; BF's part is design tokens and a nav contract | docs + app writer |
| R-13 Max Laden editing | who may write MCT; likely stays outside the app and R-5's log is enough | decision only until answered |
| Unified notifications | D5; agreement with cargo ops | after the D5 answer |

---------------------------------------------------------------------------------------------------

## 6. How the agent teams run

### The orchestrator's loop (one session per phase)

1. **Claim.** Add rows to the DECISIONS claims table for each slice (area, agent, branch, today, +7 days) in the phase's first PR.
2. **Brief.** Start each agent in its own worktree with a self-contained brief: the slice row from this plan, the spec, the files it
   owns and must not touch, the checks it must run, and "report the executed-check counts, not the pass rate".
3. **Ledger.** Keep `TASKS.md` (scratch) with slice, agent, branch, PR, gate status, `/exec` status. Update it from the PRs and
   the gate receipts, not from agent reports.
4. **Verify every report** against the diff and a gate run on the PR's head before telling Kevin it is done (an agent's "all
   green" is a claim, not a result).
5. **Merge one at a time** on GitHub when `local-gate` is green on the current head. Use `node scripts/land.js <PR>` when
   `node scripts/check_pr_overlap.js` flags the branch or two sessions' logic meet (e.g. 2a-2 `findExceptions` with 2b-1's
   panel). After each merge, every open branch merges `main` and re-runs its gate.
6. **Red run** on any merge combining two agents' logic: revert one side's fix, confirm the other's new check fails, restore.
7. **Close.** Delete claims, add the "Built in" line to each DECISIONS entry, update `docs/TESTING.md` counts.

### Brief template (what every agent gets)

```
Goal: <slice ID and one sentence>.
Read first: AGENTS.md; docs/RESEARCH_BUILDOUT_PLAN.md section <n>; <spec>; DECISIONS <D-ids>.
You own: <files>. Do not edit: the app file (unless you are R1), dist/, any file another agent owns this wave.
Data: verify every number against the 9-day CSV (RFC 4180 parser) or the 8-12 xlsx; label anything else UNCONFIRMED.
Done means: <checks> pass; node scripts/run_ci_locally.js (or --fast if no browser change) on your branch merged with main;
one commit; pushed; draft PR naming the DECISIONS entry. Report executed-check counts per suite.
Stop and report (do not work around) if: a DECIDED entry conflicts, a check you did not touch fails twice identically,
or you need a file you do not own.
```

### Cost rules (AGENTS.md "Keeping agent sessions cheap")

Sonnet for logic, tests, data checks and mechanical edits; Opus for the app writer, Apps Script concurrency, UX specs and review.
Agents grep the app file and read ranges; regression output goes to a file and is grepped for `^Passed` and `❌`.

---------------------------------------------------------------------------------------------------

## 7. Definition of done (every slice)

1. DECISIONS entry exists before the code (PROPOSED unless Kevin confirmed it in writing, with the quote).
1a. Additive only (section 2, rule 8): the PR's diff touches no existing calculation or highlighting code, edits no existing
   check's assertions, and every existing suite's executed-check count is the same or higher. The reviewer (R8) checks this first.
2. Checks 1, 4 and 6 for any app change; check 5 (highlight budget) when row props or row rendering change (2b-1, 2b-2, 1-C);
   shared sync and logic checks for `shared/`; a new check is in `scripts/run_ci_locally.js` `jobs` and `docs/TESTING.md` in the
   same commit.
3. Real-data evidence in the PR: identifiers, expected vs actual, counts from a parser.
4. Full gate on the branch with `main` merged, then `--post-status`.
5. Server slices: the `/exec` checklist written in `apps-script/README.md` and run by D8's owner before the feature is called
   working. Until then the PR says "client verified against fakes".
6. Anything restored or read from another app shows source and age (no silent state).

---------------------------------------------------------------------------------------------------

## 8. Schedule and critical path

```
Week 0   Phase 0 answered 2026-10-30 ──┐
Week 1   1-A logic+data ║ 1-A app ─ 1-B app ─ 1-C app         (app queue: 3 PRs)
Week 2   review, /exec 1-D             │
Week 3   2a-1 ║ 2a-2 ║ 2a-3 ║ 2a-4 ║ specs (B4)              (parallel, 4 agents)
Week 4   2a merges one at a time ─ 2b-1 worklist
Week 5   2b-2 decision card ─ 2b-3 threshold proposals
Week 6   2c-1 drafts ─ 2c-2 call mode
Week 7   2c-3 phase-out ─ 2c-4 PIC editor (if X-2 agreed)
Week 8-9 2d: /exec checklists, two weeks of use, recalibration (3.4), interviews
Later    Phase 3 items, each on its own decision
```

**Critical path:** ADR-R1 and the PIC emails, then `findExceptions` (2a-2) and the decision store (2a-3), then the app queue 2b-1 to 2c-2.
The app file's single writer means Phase 2 UI cannot go faster than one slice at a time; everything else is arranged to keep that
queue fed. If ADR-R1 changes, only 2a-3 and the slices that save records (2b-2, 2b-3, 2c-2, 2c-4) move; the rest of Phase 2 is unaffected.

---------------------------------------------------------------------------------------------------

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The Config Sheet data (PIC emails, approvers, recipients) is not filled in and Phase 2 stalls | Medium | High | B2 creates the tabs in wave 2a; the worklist treats an unmapped name as unowned and says so |
| D2's reading is wrong for some lanes (a threshold that is not a ceiling over Max Laden) | Low | Medium | 2a-2's oracle (B3) lists every sailing it flags on the 9 days for Kevin to spot-check before 2b-1 ships |
| The worklist is noisy and gets ignored | Medium | High | Collapsed by default (spec 3.3 K1), recalibration after two weeks (3.4), measure use before the morning brief (D5) |
| Decision log becomes a second source of truth for thresholds | Medium | Medium | Log shows "proposed / approved / live in feed"; MCT stays the source; the chip clears when the feed agrees |
| Email drafts reach the wrong people | Low | High | Recipients only from the Config Sheet, drafts never sent by the app, B7 reviews each recipient rule |
| Sheet concurrency loses a write | Low | Medium | Append-only rows under `LockService`; the client re-reads after save and shows the saved row |
| EP_EXPORT is stale or shaped differently than expected | Medium | Medium | Age shown on the card; parser tested on a real export (B3); off until the Script Property is set |
| A feature quietly changes an existing number or highlight | Medium | High | Rule 8; the reviewer diffs every touched function against `main`; existing checks are never edited by a feature PR; regression and highlight-budget counts must not drop |
| Two agents edit the app file | Low | High | Only B5 / A3 holds it; claims table; `check_pr_overlap.js` before each PR |
| Gate time (about 6 minutes per run) times many PRs | High | Low | `--fast` while iterating, full gate once per push; docs-only PRs use `--fast --post-status` |
| Research hypotheses are wrong (desk study, no interviews) | Medium | Medium | Phase 2d runs the interview guide's space and marketing group before Phase 3; measure minutes from open to decision |

---------------------------------------------------------------------------------------------------

## 10. Open items for Kevin (the short list)

Phase 0's questions are answered (section 5) and section 4a filled several gaps from the sister repos. What is left:

1. ~~Accept or amend ADR-R1~~: DECIDED 2026-10-30, Team Data Sheet tabs.
2. ~~Worklist sort order~~: DECIDED 2026-10-30, by days in exception (spec 3.3 K7).
3. Supply the data: the PIC email map (VPT's `myWork.picEmails` format, one list for both apps) and `ActionRecipients`.
4. Wiring: set `bfrSnapshotFolderId`, then VPT's `VPT_BF_SNAPSHOT_FILE_ID`; read back `bfrTeamSheetId` and confirm it equals
   VPT's notes Sheet; the EP workbook link (Q-EP1), if it exists.
5. ~~Whether Phase 1 starts~~: Phase 1 built 2026-10-30 (#279 to #282); Phase 2 started the same day.

# Spec R-7: Call mode

Status: draft for Kevin, 2026-10-30. Author: B4 (UX, R6). Builder: B5 (app HTML); B1 (`callMinutesText` in `shared/`).
Plan reference: [RESEARCH_BUILDOUT_PLAN.md](../RESEARCH_BUILDOUT_PLAN.md) slice 2c-2 (research idea 7, Q5, D84). Depends on
`BFShared.summarizeChanges` (built, D82, `shared/50_what_changed.js`), the archive loaders `fetchPerDayArchiveIndex` /
`fetchPerDayArchiveDay` and `BFShared.previousAvailableDate` (built), 2a-2 `findExceptions`, 2a-3 decision records, the worklist
([spec 3.3](3.3-worklist-panel.md)) and the decision card ([R-4](R-4-decision-card.md)). Drafts are [R-6](R-6-action-drafts.md).

## 1. What it is

A full-screen, lane-by-lane readout to screen-share on the weekly SPC/MKTG calls (research pains 1 and 2: the loop "spot an
overage, weigh fall-down and empties, choose freeze or monitor" happens by voice and is not captured). For the chosen call it walks
the lanes; each lane shows **what changed since the last call**, its **open worklist items** and the **decisions taken since the
last call**, with **Record decision** inline. At the end, **Copy minutes** puts the decisions and action items on the clipboard as
plain text. It reads existing data and writes only decision records (2a-3); nothing in the tables changes (rule 8).

## 2. Decisions needed from Kevin

| # | Question | Recommendation (what this spec assumes) |
|---|---|---|
| K1 | Which lanes belong to which call? | By `subTrade` (Vessel 1st Sub Trade): **EC/TA/LAT call = AW, TA, LN; PN/PS call = PN, PS**. That covers every row of the 9-day CSV (AW 2,454, PS 2,213, TA 2,085, LN 1,149, PN 868 rows). Reading AW as "EC" and LN as "LAT" is UNCONFIRMED. A Config Sheet tab `CallLanes` (`Call, SubTrade, Lane`) can override it. |
| K2 | "Since last call" when the same weekday last week has no archive file | Use the **latest archive day on or before** that date and name it: `Baseline: Wed 10/22 (no file for Thu 10/23)`. Never silently "yesterday". |
| K3 | Lane order | **Lanes with open items first** (soonest cut-off among their items), then the rest alphabetically. Lanes with nothing changed, no items and no decisions are collapsed into one line `Nothing to discuss: AL2, AL5, …`. |
| K4 | Where does Call mode start from? | A `Call mode` button **appended at the end** of the tab-bar tools row (`data-tabbar-tools`, after Analyze); nothing existing moves. Not in the masthead cluster (spec 2.3 section 3: late items there reflow it). |
| K5 | Do action items in the minutes include decisions with no draft opened yet? | **Yes**: every Freeze, Cut and Roll since the baseline is an action item, marked `(draft opened)` when R-6's draft record exists. Monitor is listed as a decision, not an action. |
| K6 | Do the minutes name people? | Decision authors yes (they are attributed already); no email addresses, no recipients. |
| K7 | Remember the chosen call? | Locally (`bookingFlashCallModeCall`, try/catch), and preselect by weekday once Kevin tells us the call days (no call schedule exists in any repo, plan 4a). |

## 3. Placement and shell

- Trigger: `Call mode` button in the tab-bar tools row, same classes as its neighbours. Disabled with a title while
  `viewingHistoricalDate` is set or the data is an upload (`Call mode reads live data.`); not rendered in the basic build (no
  archive, no decisions).
- Shell: `fixed inset-0 z-50`, `role="dialog" aria-modal="true" aria-label="Call mode"`, page background, no backdrop click-to-close
  (a stray click on a shared screen must not end the call). Exit: `Exit call mode` button top right, or Escape when focus is not in
  a text field.
- Top bar (sticky): call picker (`EC/TA/LAT` / `PN/PS`, a two-option radio group), `Baseline: Thu 10/23 · Data as of Thu 10/30 09:00`
  (the existing freshness wording), lane position `Lane 3 of 11`, `Previous lane` / `Next lane`, `Copy minutes`, `Exit`.
- Body: on 1366 px and up, a lane index on the left (buttons, one per lane, with item and decision counts) and the current lane on
  the right; on a phone, the index is a `<select>` in the top bar. Text one step larger than the app (`text-base`, lane title
  `text-xl`) for screen sharing.
- Data refreshes while open: the content updates in place, focus is never moved, and the top bar shows `Updated 10:05`.

## 4. Baseline

`asOf` = the server's `changedDate`, else this browser's local today (as `WhatChangedBanner`). Target = `asOf` minus 7 days, built
from `YYYY-MM-DD` parts (never `new Date('YYYY-MM-DD')`, check 3). Baseline = `previousAvailableDate(dates, target + 1 day)`, i.e.
the latest archive day on or before the target. Download and parse it once per baseline with the What-changed loader (the per-day
file, never the 15.9 MB single Sheet), and keep it in a ref like `whatChangedCacheRef`.

## 5. One lane

Header: `{Lane} · {subTrade} · PIC {distinct SPC names}` and counts `3 items · 2 decisions`.

1. **Since {baseline}:** `BFShared.summarizeChanges(prevLaneRows, curLaneRows)` with both days filtered to the lane before the call
   (no change to the shared function). Its `clauses` render exactly as the banner's (removed first and bold, `+N more` rule), plus a
   `Details` disclosure listing moved and removed VVDs. `No material change since Thu 10/23.` when `state === 'none'`.
2. **Open items:** this lane's `findExceptions` items, same copy as the worklist rows (spec 3.3 section 5). Each item has
   `Record decision`, which expands the R-4 decision block **inline under the item** (port switcher, action radio group, reason,
   Save; the figures in a compact two-line form), not a dialog over the dialog. A saved decision shows its R-4 C4 line and R-6's
   `Draft email`.
3. **Decisions since last call:** latest decision per `vvd|polKey` with `createdAt` on or after the baseline day (local midnight),
   for this lane's VVDs (`getDecisionsFor(vvds)`, one call per call-mode open, then re-read after each save). Each line:
   `Monitor · ONE HAMMERSMITH 0613W · USSAV01 · Ryan T, Thu 10/30 09:42 · "~70 TEU empties"`; a changed one adds `(was Freeze)`.

## 6. States

| ID | Condition | Renders (exact copy) |
|---|---|---|
| M0 | Archive index null or the baseline day failed to parse | Lanes render without part 1; top bar `Baseline: not available (archive unreadable). Showing items and decisions only.` |
| M1 | No archive day on or before the target | `Baseline: none on file before Thu 10/23.` Part 1 omitted. |
| M2 | Decisions loading / failed | Part 3 `Loading decisions…` / `Could not load decisions.` + `Try again`; `Record decision` Save disabled until loaded (needs `supersedes`). |
| M3 | Worklist unavailable (history index down, spec 3.3 L0 reasons) | Part 2 `Open items: not available today (no history).` Never an empty list that reads as "nothing open". |
| M4 | Lane with nothing | Folded into the `Nothing to discuss:` line (K3). |
| M5 | Call has no lanes in today's data | `No sailings for the PN/PS call in today's data.` |

## 7. Copy minutes: `BFShared.callMinutesText(model)`

Pure, in `shared/` (B1, own tests). Plain text, `\n` line ends, no HTML, no addresses, control characters stripped from reasons:

```
SPC/MKTG EC/TA/LAT call, Thu 10/30. Baseline Thu 10/23; data as of Thu 10/30 09:00.

EC4
  Changes: 1 sailing removed (WAHT0613W) · 2 sailings moved 100+ TEU
  Decisions:
  - Freeze, ONE HAMMERSMITH 0613W at USSAV01 (Ryan T): ~70 TEU empties ... [action, draft opened]
  - Monitor, HTET1002W at USNYC01 (Alex): expect fall-down
  Open, no decision: GJMT0003W (unowned for 4 days)

Nothing to discuss: AL2, AL5.
Action items: 1 (Freeze ONE HAMMERSMITH 0613W at USSAV01, Ryan T).
```

Copied with the existing `copyTextToClipboard`; a polite status `Minutes copied (14 lines).` If the clipboard call fails, a read-only
`<textarea>` with the text opens under the button, selected, with `Press Ctrl+C to copy.`

## 8. Keyboard, screen reader, themes, widths

- On open, focus goes to the call-mode heading; Tab cycles inside the dialog. `Next lane` / `Previous lane` move focus to the new
  lane's heading (`tabindex="-1"`). No single-letter shortcuts (WCAG 2.1.4); Alt+Right / Alt+Left are not used either (browser back).
- Lane index buttons carry `aria-current="true"` for the shown lane. Counts are in the accessible name (`EC4, 3 items, 2 decisions`).
- Removed-sailing clauses are words, colour reinforces (as spec 2.3). Inline decision blocks follow R-4 section 7.
- Light/dark: page `bg-white dark:bg-gray-900`, text `text-gray-900 dark:text-gray-100`; change clauses reuse the teal pair of
  `WhatChangedBanner`; items reuse the worklist's neutral card; decisions `text-blue-900 dark:text-blue-100` on
  `bg-blue-50 dark:bg-blue-950`.
- 1366 px: index 240 px wide, lane pane the rest, no horizontal scroll. 390 px: index becomes the `<select>`, top bar wraps to two
  rows, buttons at least 44 px tall, every part stacks; `scrollWidth == innerWidth`.
- Verify at 390, 1366 and 1920 px (screen share), light and dark, with M0, M3 and a lane holding a removed sailing.

## 9. Acceptance tests (for B6 and B1)

Hooks: `data-call-mode-trigger`, `data-call-mode` (dialog), `data-call-mode-call="ec-ta-lat|pn-ps"`, `data-call-baseline`
(text; `data-call-baseline-date="YYYY-MM-DD"`), `data-call-lane-index`, `data-call-lane="<LANE>"`, `data-call-lane-changes`,
`data-call-lane-items`, `data-call-lane-decisions`, `data-call-record-decision`, `data-call-nothing`, `data-call-next`,
`data-call-prev`, `data-call-copy-minutes`, `data-call-minutes-text`, `data-call-state="ok|no-baseline|no-archive"`.

1. Fake archive index with days 2026-08-24 to 09-01 and `asOf` 2026-08-31 (Mon): `data-call-baseline-date` is `2026-08-24`. With 08-24 removed it is the latest earlier day, and the copy names the missing date.
2. The lane-filtered `summarizeChanges` clauses for each lane equal those of a direct call on the same filtered fixture rows.
3. EC/TA/LAT call on the 9-day data lists only lanes whose `subTrade` is AW, TA or LN; PN/PS only PN and PS; their union is every lane.
4. `Record decision` on an item saves through the fake `saveDecision` once; the decision appears in `data-call-lane-decisions` without closing call mode.
5. A decision dated before the baseline is not listed; a later one superseding it is listed with `(was …)`.
6. `callMinutesText` fixture: exact string match for a two-lane model; no `@` and no control characters in the output, a reason with newlines becomes one line.
7. Clipboard fake rejects → the fallback textarea appears holding the same text.
8. `__BF_GOOGLE_SERVICES_OFF__`: no `[data-call-mode-trigger]`; historical date: the trigger is disabled.
9. Escape inside a reason textarea does not exit; Escape on a lane heading does, and focus returns to `data-call-mode-trigger`.
10. Rule 8: tab-bar tools' existing buttons keep their order and classes; no existing check's count drops.

## 10. Out of scope

A call schedule or reminders, recording audio, sending the minutes (Copy only; R-6 drafts per decision), threshold proposals inside
call mode (R-5 may add them), per-lane charts, editing the lane-to-call map in the app.

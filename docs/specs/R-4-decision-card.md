# Spec R-4: Decision card

Status: DECIDED per D84 (ADR-R1 DECIDED 2026-10-30; the spec's recommendations K1-K8 built as written except where noted in
docs/DECISIONS.md, "Decision card build choices", PROPOSED 2026-10-31). Author: B4 (UX, R6). Builder: B5 (only writer of the app HTML).
Plan reference: [RESEARCH_BUILDOUT_PLAN.md](../RESEARCH_BUILDOUT_PLAN.md) slice 2b-2 (research idea 4, D84). Depends on 2a-1
(identifiers, `PORT#SEQ` port key), 2a-2 (`findExceptions`), 2a-3 (decision records, ADR-R1, DECIDED 2026-10-30), 2a-4 (`EP_EXPORT`
reader) and 2b-1 (the worklist, [spec 3.3](3.3-worklist-panel.md)). Written against the existing `RowLinkMenu`, the
`VvdNotesPanel` dialog (`data-vvd-notes-panel`), `WhatChangedBanner`, `ThresholdHealthBanner` and `GOOGLE_SERVICES_OFF`.

## 1. What it is

One dialog per sailing and port that puts on one screen what the SPC/MKTG call weighs by voice before choosing (research pain 1:
"One Hammersmith 431 TEU over ... chose to monitor instead of freezing Savannah"): the overage against the threshold, the active and
no-activity volume, the empties planned, loaded and declared by the desk, an expected fall-down line clearly marked as an assumption,
the ops notes, and the latest decision. Four buttons, **Freeze, Monitor, Cut, Roll**, save a decision with a reason as an append-only
ADR-R1 record. The card **reads** existing figures; it never changes a table value, a highlight or a column (rule 8).

## 2. Decisions needed from Kevin

| # | Question | Recommendation (what this spec assumes) |
|---|---|---|
| K1 | Is a decision per sailing or per sailing **and port**? | **Per port** (`vvd` + `polKey`, as ADR-R1 keys it): the research example froze or monitored one port (Savannah). The card opens on one port and has a port switcher. |
| K2 | Fall-down assumption: which volume does the percent apply to? | **The same base VPT applies its flat `fallDownPctDefault` to**, so both apps show one number (plan 4a). Which base that is (all booked laden, or only no-activity) is UNCONFIRMED: B3 reads VPT's code before 2b-2 starts. Until then the line uses booked laden and says so. |
| K3 | Where does the per-lane percent live? | A new Config Sheet tab `FallDown` (`Lane, Pct, Note`), default 15 % when a lane has no row, both named on the line. Same numbers as VPT's lane settings, copied by hand until R-11. |
| K4 | When is the desk's declaration "stale"? | **Older than 24 h** by its `as_of`, or older than the sailing's cut-off minus 2 days if that is sooner. Shown amber with its age; never hidden. |
| K5 | Is a reason required for every action, Monitor included? | **Yes**, 3-500 characters. The log is only useful if it says why ("~70 TEU empties, expected fall-down"). |
| K6 | Roll: does it need a target? | **Optional** free-text target VVD in 2b-2; 2c-3 adds VPT's candidate list (Q7). The roll target is checked with `BFShared.normalizeVvd` / `isRealVvd`. |
| K7 | Who may save a decision? | **Anyone signed in** (identity from `Session.getActiveUser()`). Approval exists only for thresholds (R-5). If the email comes back empty, the buttons are disabled with the reason shown. |
| K8 | Cut: of what? | Copy says **"Cut bookings"** (reduce booked volume at that port). Say if Cut means something narrower on the calls. |

## 3. Opening, placement, closing

- **From the worklist (2b-1):** each worklist row gets a second button `Decide` at its right edge, a sibling of the row's
  click-through button (no nested buttons). This amends spec 3.3 section 6, which is not built yet. Opens on the row's port with the
  largest overage.
- **From the row menu (built, OFF by default: `DECISION_CARD_IN_ROW_MENU = false`, so the shipped build does not offer it; see
  "As built" below):** a fourth item `Decision card` after `Copy VVD` (`data-row-link-item="decision"`); the existing three items
  are unchanged. On the POL Booking tab it opens on that row's port: the per-row button needs one more data attribute,
  `data-row-menu-pol`, which changes the row's DOM (run the row-highlight budget, check 5). On the Booking Flash tab it opens on the
  largest-overage port.
- **Dialog**, same shell as `VvdNotesPanel`: `fixed inset-0 z-50` backdrop, `role="dialog" aria-modal="true"`, `max-w-2xl`.
  Closing: `×` button, Escape, or a click on the backdrop. An unsaved reason is kept in memory for that `vvd|polKey` until reload, so
  an accidental Escape loses nothing. Focus returns to the opener (worklist `Decide` button or the row's `...` button).
- Not offered while `viewingHistoricalDate` is set or the data is an upload (the card describes live data; decisions are about now).
- **As built (2b-2, 2026-10-31):** two differences from the bullets above.
  1. The row-menu item is built but OFF. Kevin, 2026-10-31: "keep it off until all parts of it is. tested". Switching it on also
     changes the Vvd_Link_Menu check, which pins the menu at three items and changes only with Kevin's sign-off (rule 8). How to
     test it while it is off is OPEN (D89).
  2. The POL tab's port is read from the row's Port cell at click time; no `data-row-menu-pol` attribute is added (OQ3).
  See docs/DECISIONS.md, D84 "Decision card build choices", and D89.

## 4. Content and the exact app fields

Header: `{VVD} · {Vessel} · {Lane} · {Sale week}` and `Cut-off {cutoff} ({lead} days)`, then the port switcher (one pill per POL
leg, `pol` code; the open one `aria-current="true"`). Figures are read from the **same objects the tables render** (the Booking Flash
tab's per-VVD `tableData` record over the unfiltered rows, and the raw POL leg rows), so the card can never disagree with the table.
If B5 cannot reach that aggregation without changing it, B5 stops and asks (rule 8). Sources checked in
[DATA_ARCHITECTURE.md, "Field mapping"](../../DATA_ARCHITECTURE.md#field-mapping-current-post-2026-08-25-audit).

| Block | Line (example) | Fields | Source column |
|---|---|---|---|
| Overage (sailing) | `Booked 1,640 TEU vs Max Laden 1,209: 431 over · Threshold 120% (ceiling 1,451): 189 over` | `curLaden` (SUM over legs, PAROD excluded), `maxLdn`, `shortfall` as rendered, `standbyRaw` | Measures POL Laden TEU, MCT Max Laden Update, Max Laden vs POL  Booking, Trunk Threshold (= MCT Overall Threshold on 8,769/8,769 rows) |
| Overage (this port) | `USSAV01: 612 vs POL Max Laden 540 · Threshold 150% (ceiling 810): 198 under` | `curLaden` (leg), `polMaxLdn`, `polLdnThresh` | Measures POL Laden TEU, POL Max Laden TEU, POL Laden Threshold |
| Activity | `Port: 410 active · 120 no activity · Inland: 50 active · 32 no activity` | `portAct`, `portNoAct`, `inlandAct`, `inlandNoAct` (leg) | Measures Active/Non Active Local TEU, Active/Non Active Ipi TEU |
| Empties | `Empties planned 90 · loaded 20` | `plannedMty`, `actualMty` (leg; POL tab fields) | Measures Planned/Actual Mty TEU (non-zero on 2,249 of 8,769 rows of the 9-day CSV) |
| Declared by the desk | `Desk declared 70 TEU final (85 requested prelim) · Empty Planning as of Wed 10/29 14:00, 20 h ago` | `final_teu`, `prelim_teu`, `as_of` from 2a-4's `epExport.rows`, joined on `vvd` + `port_key` | `EP_EXPORT` (not connected; Q-EP1) |
| Expected fall-down | `Assumption: 15% fall-down (EC4 lane, Config) → about 1,394 TEU at cut-off, 57 under the ceiling` | the K2 base, the K3 percent | new: Config `FallDown` tab |
| Notes | `Ops: {opIssues}` / `Remarks: {remarks}` / `PIC: {pic}` | `opIssues`, `remarks`, `pic` | Vessel Operation Notice, Vessel Voyage Remark, MCT PIC |
| Decision | latest decision, then the history list (section 5) | 2a-3 records | Team Data Sheet `Decisions` tab |

Rules for the new figures (ceiling, over/under, expected landing): computed by **new** `shared/` functions with their own tests
(B1: the same helper `findExceptions` uses, so the worklist and the card agree), never written back into a row. A threshold of blank,
0 or 0.01 shows `Threshold not set` and no ceiling (D2). Numbers use the table's own formatter. "Owner's merit" has no field: it is
typed into the decision reason (plan section 2 table).

The fall-down line is always prefixed `Assumption:`, in italics, with the percent and where it came from; it is never coloured as a
status and never feeds the overage line.

## 5. States

| ID | Condition | Renders (exact copy) |
|---|---|---|
| C0 | Basic build (`GOOGLE_SERVICES_OFF`) | Figures only; decision block reads `Decisions need the web app.`; no buttons. When the row-menu item is switched on, it is offered here too (it is off by default). |
| C1 | Decisions loading (`getDecisionsFor([vvd])` in flight) | Figures at once; decision block `Loading decisions…` (`aria-busy="true"`); action buttons usable, Save disabled until loaded (it needs the latest id for `supersedes`). |
| C2 | Decisions failed to load | `Could not load decisions.` + `Try again`. Save stays disabled. |
| C3 | No decision yet for this port | `No decision recorded for USSAV01 yet.` |
| C4 | A saved decision (latest) | `Monitor · Ryan T · Thu 10/30 09:42 · "~70 TEU empties, expect fall-down"` |
| C5 | Superseded decisions | History list under C4, newest first: `Freeze · Alex · Wed 10/29 · superseded by Ryan T's Monitor, Thu 10/30`. Words, not strike-through. |
| C6 | A newer decision appeared after the card opened. Amended 2026-10-31 (2b-2, OQ2): the server's supersedes is a compare-and-swap (#287), so a save on a key someone else decided since the card loaded is REFUSED (`stale-supersedes`) | Nothing is saved; the card re-reads and shows the amber line `Alex saved Freeze at 09:44, after this card opened. Nothing of yours was saved yet. Review, then Save again.`, keeping the typed reason and action; the next Save supersedes Alex's. Only two FIRST decisions on one key can both be saved (no supersedes to compare); then the newer is the latest and the card says `Alex saved Freeze at 09:44, after this card opened. Yours is saved; theirs is newer and is now the latest.` |
| E0 | `EP_EXPORT` off (no `bfrEpExportUrl`) | `Desk declaration: not connected.` |
| E1 | EP loaded, no row for this VVD and port | `No declaration from the desk for this port (Empty Planning as of …).` |
| E2 | EP row older than K4 | The E-line in amber with `stale:` and the age. |
| E3 | Port key cannot be matched (2a-1 has no mapping for this `pol`) | `Desk declaration: port USSAV01 not matched to Empty Planning.` (never a silent zero) |
| F0 | No fall-down percent and no default | Line omitted, replaced by `No fall-down assumption configured.` |
| H0 | History index unavailable | The `over threshold for N days` fragment is omitted; nothing else changes. |

## 6. Saving a decision

Four buttons in a `role="radiogroup"` (`role="radio"`, `aria-checked`; not `aria-pressed`, which the regression baseline step
watches): `Freeze`, `Monitor`, `Cut bookings`, `Roll`. Then `Reason` (`<textarea>`, required, counter `0/500`), `Roll to` (Roll
only, optional), `Save decision`. Payload to `saveDecision(vvd, polKey, payload)` (2a-3):
`{ kind: 'decision', action, reason, rollTo, seen: { curLaden, ceiling, threshold, declaredFinal, epAsOf, fallDownPct, dataAsOf } }`
plus `supersedes` = the latest id seen. `seen` records what the person was looking at, so the history explains itself later.
Reason text is trimmed, control characters other than newline removed, and length-capped on the client and again on the server;
the server stores it as text, never as a formula (B7 reviews). After save the client re-reads and shows the saved row (C4/C6) and a
polite status `Decision saved: Monitor for USSAV01.` A failed save keeps the text and shows `Not saved: {error}. Try again.`
"Draft email" after a save is spec [R-6](R-6-action-drafts.md).

## 7. Keyboard and screen reader

- On open, focus goes to the dialog heading (`tabindex="-1"`). Tab cycles within the dialog (focus trap; the notes panel's pattern).
- Port switcher: buttons, Left/Right arrows move between ports, Enter selects. Action group: arrow keys move the selection (radio
  pattern); Tab leaves the group.
- Escape closes (section 3). Ctrl/Cmd+Enter in the reason box saves.
- Every figure line is text in reading order; the stale and C6 notices are words, colour only reinforces.
- `aria-describedby` on Save points to the validation message (`Reason is required.`).

## 8. Light, dark, 390 px and 1366 px

- Shell: `bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-400 dark:border-gray-500`. Stale/C6 notices:
  `bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200` (the threshold-filter bar's pair). Assumption line:
  `italic text-gray-600 dark:text-gray-300`. Selected action: `bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100`
  plus a `✓` glyph, so it is not colour alone.
- 390 px: the dialog is full width (`p-2` backdrop), `max-h-[92vh]`, the figures region scrolls, the action row and Save stay
  pinned at the bottom (two rows of two buttons, each at least 44 px tall). Port pills wrap. No horizontal page scroll.
- 1366 px: `max-w-2xl` centred, `sm:mt-16`, figures in a two-column grid (sailing left, port right).
- Verify at 390 and 1366 px, light and dark, in C3, C4 + C5, E2 and C0.

## 9. Acceptance tests (for B6)

Hooks: `data-decision-card` (dialog), `data-decision-card-vvd`, `data-decision-card-pol`, `data-dc-port="<pol>"` (switcher),
`data-dc-line="overage-sailing|overage-port|activity|empties|declared|falldown|notes"`, `data-dc-ep-state="ok|stale|none|off|unmatched"`,
`data-dc-decisions-state="loading|error|empty|ready|basic"`, `data-dc-action="freeze|monitor|cut|roll"`, `data-dc-reason`,
`data-dc-roll-to`, `data-dc-save`, `data-dc-latest`, `data-dc-history` (each item `data-dc-superseded="1"` when superseded),
`data-dc-conflict`, `data-worklist-decide`, `data-row-link-item="decision"`.

1. (Off by default: runs only once `DECISION_CARD_IN_ROW_MENU` is on; how to run it while off is OPEN, D89.) Row menu on a POL Booking row opens the card with `data-decision-card-pol` equal to that row's `pol`; Escape returns focus to the `...` button.
2. Every number in `overage-sailing` equals the Booking Flash table's cells for that VVD (Current Laden, Max LDN, Short_Fall, Standby Threshold), with and without slicers applied.
3. A threshold of 0, 0.01 and blank each render `Threshold not set` and no ceiling.
4. Fake server: no decisions → `empty`; one → `ready` with `data-dc-latest` text; two for one key → the older has `data-dc-superseded="1"`.
5. Save with an empty reason is blocked (message shown, no server call); with a reason it calls `saveDecision` once with `supersedes` = latest id and the `seen` object; the re-read shows it as latest.
6. Fake a newer row by another author returned on the re-read → `data-dc-conflict` visible.
7. EP fixtures: off, no row, stale (as_of 30 h old), fresh, unmatched port → the five `data-dc-ep-state` values with the copy above.
8. `__BF_GOOGLE_SERVICES_OFF__`: `data-dc-decisions-state="basic"`, no `data-dc-action`, zero `google.script.run` calls.
9. A reason containing `=HYPERLINK(...)`, `<img onerror>` and three newlines is sent as text and rendered as text (no element created).
10. Rule 8: the regression suite's existing counts do not drop; the row-highlight budget (check 5) passes (as built, no `data-row-menu-pol` is added, OQ3).
11. 390 px: `document.documentElement.scrollWidth === innerWidth` with the card open; the Save button is inside the viewport.

## 10. Out of scope

Threshold proposals (R-5, 2b-3), drafting the email (R-6), VPT's roll candidates (2c-3), a decision chip inside the table rows
(would change row props; R-5 decides), editing or deleting a decision (a correction is a new record), weight.

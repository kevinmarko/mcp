# Implementation plan: field-visibility picker + slicer hover-popup

Source: Kevin Lee / Adam Cosner meeting, 2026-09-15 14:32 EDT.
Planned 2026-09-16 against `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` (8,805 lines),
researched by five parallel read-only agents (columns, persistence, slicers, export, tests).

Every line number below was verified by direct read in this worktree, not inferred.

---

## 0. What the meeting actually asked for

Two decisions were recorded as "Aligned":

- **A — Report field visibility customization.** A button on the report page opens an itemized
  list; users untick fields they don't want (person in charge, status, individual names).
  Optional bonus: remember each user's choice, keyed by their email.
- **B — Hover-activated button interface.** Remove the standalone page element in the slicer
  area and replace it with a hover-activated pop-up button.

The stated *business* driver for A is in the transcript detail, and it is not a cosmetic one:
a user wants to **download** reports with those fields removed, "to prevent unnecessary
questions." That makes the export path — not the screen — the acceptance criterion.

---

## 1. The three findings that shape this plan

### 1.1 Feature A is ~70% already built, under a different name

The app already has twelve field-hide booleans
(`Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html:2735-2746`):

```
const [remarksHidden, setRemarksHidden]   = useState(true);
const [reeferHidden, setReeferHidden]     = useState(true);
const [bsaHidden, setBsaHidden]           = useState(true);
const [activityHidden, setActivityHidden] = useState(true);
const [sectorAllocHidden, setSectorAllocHidden] = useState(false);
... (dgVolume, opIssues, apStatus, rotation, tradeBreakdown, vco, eta)
```

They are driven by the "macro button" grids at `:7280-7333` via the shared `MacroToggleBtn`
component (`:626`). So Adam's "itemized list where you untick fields" is, functionally, the
macro-button grid that already exists. Three real gaps remain:

1. **PIC and Status — the two fields actually named in the meeting — have no toggle at all.**
   They are unconditional base columns: `{row.pic}` at `:2546` and `{row.statusDisplay}` at
   `:2549`, headers `renderFilter('pic', 'PIC (spc/mkg)')` at `:8342` and
   `renderFilter('status', 'Status')` at `:8345`. ("Individual names" is the VCO Analyst column
   on the POL tab, which *does* already have a toggle, `vcoHidden`.)
2. **Nothing persists.** All twelve reset to their hardcoded defaults on every refresh.
3. **Discoverability.** The grid is a wall of small green buttons in a `max-w-[240px]` column,
   not an itemized checklist. This is the part of Adam's request that is genuinely new UI.

**Consequence: this is an extension of a working mechanism, not a new subsystem.** That is a
much cheaper and much safer change than the meeting assumed.

### 1.2 Hiding a column already removes it from the download — *if* done the existing way

The four export paths are all DOM scrapes:

| Export | Defined | Mechanism |
|---|---|---|
| `exportToExcel` (Display Settings popover) | `:4774` | `XLSX.utils.table_to_sheet(table)` at `:4799` over every `<table>` under `activeTabContentRef` |
| `exportReportCardToExcel` | `:4871` | `table_to_sheet(reportCardTableRef.current, {raw:true})` at `:4874` |
| `exportReportCardToCsv` | `:4893` | same ref, `bookType:'csv'`, at `:4896` |
| `exportAnalysisToExcel` | `:4813` | `json_to_sheet` from in-memory state; emits no identity fields — **needs no change** |

None of them contain any column allow/deny logic. The existing `*Hidden` flags use true
conditional rendering — `{!bsaHidden && (<th .../>)}` at `:8364` — which removes the cell from
the DOM entirely. A scraped DOM without the cell produces a sheet without the column.

**This is the single most important design constraint in the plan:**

> The new toggles MUST use conditional rendering (`{!hidden && <th/td>}`), never CSS
> (`display:none`, `hidden`, `w-0`). `table_to_sheet` is called with **no options object**, and
> SheetJS does not skip CSS-hidden cells without `{display:true}`. A CSS implementation would
> look correct on screen and still leak PIC/Status into the downloaded file — silently failing
> the one requirement that motivated the request.

### 1.3 Kevin's "we can identify users by their email" is not true of this deployment

Stated in the meeting as settled technical fact. It is not:

- `Session.getActiveUser()` / `getEmail()` appear **nowhere** in the repo. `apps-script/Code.gs`
  `doGet` (`:61-71`) only serves the HTML and answers a version-hash ping.
- More decisively, `HANDOFF.md:2043-2047` records that the **Apps Script Web App deployment has
  never been done** — and only Kevin can do it. Without it there is no identity channel at all.
- The data fetch can't supply identity either: `CSV_SOURCE_URL` is an unauthenticated
  "publish to web" CSV (`HANDOFF.md:149-155`).
- Even after deploying, `Session.getActiveUser().getEmail()` under the documented
  "Execute as: Me" setting (`apps-script/README.md:24`) is unreliable for non-owner viewers.
  That needs a live test before anyone designs against it.

**Recommendation: build per-browser persistence now, treat per-user-by-email as a separate
later decision.** Say so to Adam plainly rather than letting the stakeholder update promise
automatic per-person presets.

There is also a cautionary precedent worth heeding: `HANDOFF.md:1542-1547` records that the
*existing* silent persistence of `autoRefreshEnabled` already caused real team confusion —
people drifted out of sync, unaware their toggle had been remembered. Persisted visibility
should therefore ship with a visible indicator and a one-click **Reset to defaults**.

---

## 2. Scope decision: what "the standalone page element" means

The meeting phrase is ambiguous and the plan should not pretend otherwise. Two defensible
readings, both evidenced:

- **The whole filter panel** (`:7008-7337`, gated by `topPanelCollapsed` at `:7007`). Supports
  "removing a specific interface element entirely" — the app already treats it as one
  collapsible region via the "Hide Filters" button at `:6968`.
- **The macro-button grid** (`:7280-7333`). Matches Kevin's own words in the notes ("hide
  macro… macro buttons"), and it is the single most-churned layout element of the last week.

**Strongest evidence for the narrow reading:** on the same day as the meeting, commit `2b9e0af`
removed the static "Alt+Click" hint row in favour of a hover tooltip, with Kevin quoted in the
code comment at `:7106-7116`: *"Eliminate and shrink this space… make that like a hover popup."*
That is a small-scale precedent for exactly this conversion, already in flight.

**Plan: scope B to the macro-button grid.** It is the element Kevin named, it is self-contained,
and converting it to a hover popup composes perfectly with feature A — the macro grid *becomes*
the field picker, moved off the page into a popup. One confirmation question for Kevin before
build (§7).

---

## 3. Design

### 3.1 Feature A — Field visibility picker

**Trigger.** One button, in the tab bar next to "Hide Filters" (`:6968`) — outside the
collapsible panel, so it stays reachable when filters are collapsed. Label: `⚙ Fields`.

**Panel.** A checklist, not a button wall: one row per field group, checkbox + label, grouped by
section (Identity / Activity / Commercial / Operational), plus **Reset to defaults**. Rendered
using the existing fixed-position overlay technique from `hoverTooltip` (`:2781-2803`, rendered
at `:8767-8797`), which is deliberately mounted **outside any scrolling ancestor** because
`overflow-auto` table containers clip absolutely-positioned children regardless of `z-index`
(documented at `:2769-2776`). `z-40`, matching the floating Clear Highlights pill, so it sits
above the sticky header (`z-20/z-30`) and below modals (`z-50`).

**New toggles.** Add `picHidden` and `statusHidden` (Detail), and `polStatusHidden` (POL),
following the exact `MacroToggleBtn`/`*Hidden` convention. Wrap:

- Detail header `<th>` at `:8342` (PIC) and `:8345` (Status)
- Detail body `<td>` at `:2546` (PIC) and `:2549` (Status), inside `DetailTableRow`
- POL header/body for `loadingStatus` (`:2699` body)
- **Report Card modal, Detail variant:** `<th>` `:7761` / `<td>` `:7786` (PIC), `<th>` `:7764` /
  `<td>` `:7789` (Status)
- **Report Card modal, POL variant:** `<th>` `:7716` / `<td>` `:7738` (Status)

The Report Card modal is a **third and fourth independently hardcoded column list** (`:7679-7809`)
wired to none of the existing toggles. Miss it and a downloaded Report Card still leaks PIC and
Status even after the main table is fixed.

**⚠ The highest-risk mechanical detail.** `colSpan` for spacer and "no data" rows is a
hand-counted formula, not derived from what is rendered (`:3091-3104`, verified):

```
const DETAIL_BASE_COLUMN_COUNT = 18;
const detailVisibleColumnCount = DETAIL_BASE_COLUMN_COUNT
    + (bsaHidden ? 0 : 2) + (reeferHidden ? 0 : 5) + (activityHidden ? 0 : 8) + ...
const detailBlankRowColSpan = detailVisibleColumnCount - 3;
```

PIC and Status are inside the constant `18`, not in any conditional term. Each new base-column
toggle must **subtract**: `- (picHidden ? 1 : 0) - (statusHidden ? 1 : 0)`. POL has the twin
formula at `:8101-8106`. Forget either and blank rows misalign by one column per hidden field.

*Suggested hardening:* derive the count from the same array that drives the picker, so the
formula can never drift from the toggles again. This removes the bug class rather than
re-paying attention to it every time a field is added.

**Out of scope:** Trade Summary / Sector Summary (declarative `PivotTableViewer` configs at
`:8309-8322`, `:8027-8045` — nearly free to add later, but they carry no PIC/Status/name
columns, so they don't serve this request).

### 3.2 Feature A′ — Persistence

Follow the established pattern exactly (`:2824-2834`, verified):

```
const [x, setX] = useState(() => {
    try { const s = localStorage.getItem('bookingFlashX'); return s === null ? DEFAULT : s === '1'; }
    catch { return DEFAULT; }
});
useEffect(() => { try { localStorage.setItem('bookingFlashX', x ? '1' : '0'); } catch {} }, [x]);
```

Note the `stored === null ? DEFAULT : stored === '1'` idiom — it distinguishes "never set" from
"explicitly off", which a naive `=== '1'` collapses.

Use **one key per field**, `bookingFlash<Field>Hidden`, matching the three existing keys
(`bookingFlashAutoRefresh`, `bookingFlashFreezePanes`, `bookingFlashDarkMode`). No JSON blob:
there is no `JSON.stringify` precedent in this file, and a per-key scheme degrades gracefully
when fields are added or renamed, where a versioned blob needs migration logic.

Scope of the guarantee, to state plainly to Adam: **per browser profile, per machine.** Survives
refresh; shared across two windows on two monitors in the same profile (but only re-read on
mount, so an already-open second window won't update until its own reload); does **not** follow
a person to another laptop or browser.

### 3.3 Feature B — Macro grid → hover popup

Remove the inline grids at `:7287-7304` (POL) and `:7311-7333` (Detail); their contents become
the picker panel from §3.1. This reclaims the `max-w-[240px]` right column (`:7235`) and hands
that width back to the Lane row — directly attacking the multi-monitor complaint, since the
recent 400px → 300px → 240px narrowing (`5b46ead`) was chasing exactly this.

**Hover must not be the only way to open it.** A synthetic `.click()` does not fire `:hover` or
`onMouseEnter`, so a hover-only popup is untestable by the regression suite, and it is also a
poor fit for touch and for accessibility. Implement **hover-to-open plus click-to-pin**, the
same click-open pattern the Settings and Historical Data popovers already use.

**Known trap to avoid** (`:3413-3423`): the Historical Data popover once had its Escape-to-close
`useEffect` declared *before* its own `useState`. Babel Standalone's loose in-browser transform
throws no TDZ error, so the listener silently armed once at mount and Escape never worked again.
Declare state before any effect referencing it, and verify Escape live — `node --check` cannot
see this class of bug.

While in this code: the sibling-resizing bug that `d4849d6` tried to fix and `788a974` reverted
(with no recorded rationale) is **still present** — `grid grid-cols-2` + `h-full` forces every
button in a column to share the width of the longest current label, so toggling one stretches
its neighbours. A checklist layout dissolves this problem rather than fighting it again.

---

## 4. Sequencing

The repo's own hard-won rule (`HANDOFF.md:2325-2342`): a worktree isolates the *checkout*, not
the *line ranges*. On 2026-09-14, splitting three features that touched the same
`DetailTableRow`/`PolTableRow` lines across three parallel agents risked real conflicts with no
clean reconciliation. **A and B touch the same lines. Build them sequentially in one worktree;
use parallel agents only to verify.**

| Step | Change | Commit |
|---|---|---|
| 1 | `picHidden`/`statusHidden`/`polStatusHidden` + all 4 hardcoded column lists + both colSpan formulas | one |
| 2 | Persistence for all toggles (existing 12 + new 3) + Reset to defaults | one |
| 3 | Field picker panel UI (checklist, grouped, `⚙ Fields` trigger) | one |
| 4 | Remove macro grids; picker becomes the hover/click popup; reclaim right-column width | one |
| 5 | Regression-suite updates (§5) | folded into the step that changes the behaviour |

One commit per behavioural change, per `AGENTS.md` — no CI here, so independent commits are the
only cheap way to revert one bad step without losing four good ones. Test updates ride in the
same commit as the change that invalidates them.

---

## 5. Verification

Required after every change (`AGENTS.md`), in order. **Precondition: `npm install` has not been
run in this worktree** (`node_modules/` absent, `@babel/core` unmet) — do it first.

1. **Syntax check** — use the auto-detecting snippet in `AGENTS.md`, and confirm the printed
   "(auto-detected…)" line names v1.66. Do **not** use the repo-root `check_syntax.js`: it
   hardcodes the frozen `..._Kevin_1.04_PIVOTS.html` snapshot and is itself an instance of the
   stale-filename landmine `AGENTS.md` warns about.
2. **Alias-landmine check** — only if a `getVal([...])` call is added or edited. Neither feature
   should need one; confirm before skipping.
3. **Date timezone check** — only if an `XLSX.read(...)` call changes. Not expected.
4. **Live regression suite** — required; both features change rendered UI. Serve over local HTTP
   (never `file://` — see §6), simulate the upload, inject
   `tests/booking_flash_regression_tests.js`, and **do not also call
   `runBookingFlashRegressionTests()`** (that is the 2026-09-15 double-invocation race). Read
   `window.__bfrtLastResult`, and read the **executed-check count** before the pass rate. No
   vendored copies of React/Babel/SheetJS exist in this repo, so the CDN-swap workaround into a
   throwaway copy may be needed.

### Existing checks that must be updated in the same commit

- `tests/booking_flash_regression_tests.js:1058-1060` — `clickShowToggle('Reefer' | 'Trade
  Breakdown' | 'DG Volume')` matches button text `` `Show ${label}` `` (`:305-311`). Step 4
  moves those buttons into the popup; this helper must learn to open the picker first, or these
  checks silently degrade to "not found → skip" rather than failing loudly.
- `:823-827` — POL column-presence assertions (BSA TEU present) must run against a known
  visibility state now that state is persisted, or they flap on whatever a prior run left in
  `localStorage`.
- `:474-478` — "Grand Total column removed" changes meaning if that header becomes user-hideable.
- `:318-321` — the global Clear Filters baseline polls `button[aria-pressed]` page-wide. If the
  popup only mounts its buttons while open, the poll trivially passes because none are rendered.
  Assert cleared *state*, not merely absent pressed buttons.
- The colspan-aware `fromEnd` header math (`:841-847`, `:1102-1108`, `:1425-1430`, `:1560-1566`)
  reads target cells as `tds[tds.length - fromEnd]`. Hiding a column inside or before a colspan
  group shifts every subsequent offset — a silent wrong-cell read, the exact bug class already
  hit once for Short_Fall. Re-verify these, don't just confirm the header text still exists.

### New checks to add

1. Unticking a field removes its `<th>` and every matching `<td>` from the live DOM.
2. **Unticking a field removes it from the export** — the business requirement. Monkey-patch
   `window.XLSX.writeFile` in the injected test to capture the workbook instead of writing a
   file, then assert the header string is absent from
   `XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1})[0]`. Prefer this over Playwright
   download interception: it matches the suite's existing "poll internal JS state" philosophy.
3. A persisted preference survives `location.reload()` — the only check needing a mid-suite
   reload; none of the nine existing suites do this today.
4. Reset to defaults restores every field.
5. Popup opens by click (and by `mouseenter` if hover-only ever ships), closes on Escape and
   click-outside without leaking state.
6. Slicer chips inside the popup still filter data, and Clear Filters still clears them.

### Pre-existing failures — do not attribute these to this work

- **Sector Summary reference-workbook check is serving-method-dependent** (`HANDOFF.md:2344-2377`).
  Under `file://` the browser sends `Origin: null`, Google's CORS endpoint refuses, the live
  sector fetch silently falls back to the August `SECTOR_DATA_SEED`, and the check passes *by
  accident*. Served over real HTTP the live fetch succeeds and genuine week-to-week drift makes
  it "fail" (e.g. TAT/TA/AL5/BEANR Average Booking 235 live vs 296 in the reference). Flag it;
  don't chase it.
- Departed-star checks (`:1493`, `:1636`) can report `weeksChecked: 0`.
- Suite 9 (Historical Data) records **zero** checks when the archive is unreachable — lowers the
  total count through no fault of the change.
- An exact **9-failure** signature means the double-invocation race, not an app bug.

`AGENTS.md` says the suite has "roughly 75" checks; the current file has **86** static
`record(SUITE, …)` call sites, and the true executed count is higher because `checkAnalysisMath()`
(`:1330`, 6 records) runs from both Suite 5 and Suite 6. Don't quote 75 as exact.

---

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | CSS-hiding instead of conditional render → fields still in the download | §1.2. Covered by new check 2, which tests the workbook, not the DOM |
| 2 | colSpan formulas not updated → misaligned spacer rows | §3.1. Derive the count from the picker's own array |
| 3 | Report Card modal missed → downloaded Report Card still leaks PIC/Status | Step 1 explicitly lists all four column lists |
| 4 | **Hiding a middle column shifts every column right of it** in the exported sheet. Any downstream pivot/VLOOKUP/macro keyed on column *position* breaks | Ask Kevin (§7). The whole point is sending these files to people outside the tool, who may well have existing pivots |
| 5 | Hover-only popup is untestable and inaccessible | Ship click-to-pin alongside hover |
| 6 | Escape-to-close silently dead via the Babel TDZ trap (`:3413-3423`) | Declare state before effects; verify Escape live |
| 7 | Persisted state makes later test runs non-deterministic | Clear the `bookingFlash*` keys in suite setup |
| 8 | Stakeholder told presets are automatic per-person | §1.3. Correct this with Adam before he updates the requester |

---

## 7. Questions for Kevin before building

1. **"The standalone page element"** — the macro-button grid (this plan's assumption), or the
   entire filter panel?
2. **Column-position dependence** — does anyone downstream have pivots, VLOOKUPs, or macros
   keyed on the export's current column *order*? Hiding PIC (which sits mid-table between Sales
   Week and 1st POL Cutoff) shifts everything to its right. If so, the safer first release hides
   only trailing columns, or blanks values while keeping the column.
3. **Scope of the field list** — only the fields named (PIC, Status, VCO Analyst) plus the
   existing twelve groups, or genuinely every column?
4. **Per-user presets** — accept per-browser persistence now (ships this week), or block on the
   Apps Script deployment that `HANDOFF.md:2043-2047` says has never been done?

# Data Architecture: Booking Flash Report NA

The authoritative reference for **where every number on screen comes from** — the raw column
it's read from, how it's matched, which tab(s) show it, and its validation status as of the last
full audit. Read this before adding a new field, touching `getVal()`, or investigating "this
number looks wrong." For the broader project history/architecture, see [HANDOFF.md](HANDOFF.md);
for the required after-every-change checklist, see [AGENTS.md](AGENTS.md).

**Latest finding, 2026-09-09 (later the same day):** two real bugs found and fixed, both the same
underlying shape — a field has two legitimately different real-world scopes (Lane/vessel-wide vs.
POL-specific, or per-leg vs. per-vessel), both already correctly parsed, and a specific call site
read the wrong one for the context it was operating in. (1) The Analyze modal's per-POL breakdown
cards (`serviceLaneAnalysis`'s `groupBy`) always read the vessel-wide `maxLdn`/`peakUtilRaw` even
when grouping by POL, where `polMaxLdn`/`peakPolUtilzRaw` were needed — confirmed live: 17 of 27
multi-POL lanes showed every POL card under that lane with a byte-identical Avg Max Laden,
impossible for genuinely different ports (Lane EC4: both `USHOU05`/`USMOB01` showed 2,359.64
pre-fix; correctly 1,738.21/621.43 post-fix). (2) Compare tab's "Vessel Utilz" diff read
`curUtilRaw` straight off one raw per-POL-leg row and labeled it vessel-wide, when `tableData`
already SUMs this exact field across a VVD's legs (the 2026-09-03 fix) to mean what its label
says — confirmed live against two real production pulls ~5 hours apart: 54 VVDs got 2+ separate
"Vessel Utilz changed" rows in one comparison, and for `TSTT0053W`/`QUIT0020W` specifically, the
TRUE vessel-level utilization never moved at all (21%→21%, 28%→28%) while Compare still flagged
both as "changed." Found via a 4-agent investigation (2 confirming/fixing the reported bug, 2
sweeping the rest of the app for the same shape — the sweep found no further live instances). See
[Validation — 2026-09-09 (2): POL Analyze modal Max Laden scope bug + Compare tab Vessel Utilz aggregation gap](#validation--2026-09-09-2-pol-analyze-modal-max-laden-scope-bug--compare-tab-vessel-utilz-aggregation-gap)
for the full writeup, and [HANDOFF.md's Class I](HANDOFF.md#known-bug-classes-read-before-touching-numericcolor-logic)
for the general bug-class writeup.

**Latest finding, 2026-09-09:** a real bug found and fixed — Booking Flash/Detail's "Peak Utiliz
%" column was showing some vessels' peak utilization inflated by exactly 100x (a true 3% rendering
as 300%, 4% as 400%, etc.), but only for low-peak-utilization vessels — anything genuinely above
5% was unaffected. Root cause: `tableData`'s per-VVD aggregation MAXes `peakUtilRaw` across a
vessel's raw POL legs using the generic `toNum()` helper (shared with several plain-TEU/weight
fields in the same list), which strips the raw value's `"%"` suffix (e.g. `"3%"` -> `3`) — but
`getPeakUtilPercentNum()`, the ONLY thing standing between a raw value and the screen that can
tell "already percent-scale" apart from "a raw fraction needing ×100", relies entirely on that
`"%"` being present. Losing it during aggregation fed a bare small number back into that function a
second time, which then (correctly, by its own rules) treated a small BARE number as a fraction
and multiplied it by 100 — the exact same failure mode `getPeakUtilPercentNum` was itself built to
prevent on 2026-09-04, just re-introduced one step earlier in the pipeline. Found via Kevin's
screenshot (Lane AN2, Sale Week 2026/W46, VVD `FOWT0531S`: displayed 300%, real legs both read
`"3%"`) and confirmed, live, against the actual pre-fix vs. post-fix rendering of today's full live
feed: 37 VVDs across 20 different lanes were affected in today's pull alone — explaining Kevin's
own observation that it "doesn't look like it might apply to all lanes, but just that week" (the
bug fires purely on VALUE MAGNITUDE — any vessel whose aggregated peak utilization happens to land
in the 0–5% band — which is simply common across many unrelated lanes at a given far-future,
still-mostly-unbooked Sale Week, not tied to any one lane). Fixed by keeping `peakUtilRaw` a
percent-suffixed string all the way through the aggregation (comparing legs with
`getPeakUtilPercentNum` instead of `toNum`, storing the max back as `` `${n}%` ``) so the
downstream call sees its `"%"` and never re-guesses. See the fix's own comment block in
`tableData` (right after the `maxes` list, in both the init and accumulate branches) for the full
derivation, and [`Peak Utiliz %` 100x inflation on low-peak vessels](#validation--2026-09-09-peak-utiliz--100x-inflation-on-low-peak-vessels) below for the write-up.

**Latest finding, 2026-09-08:** a real bug found and fixed — Booking Flash/Detail's ("Overall"
tab) "Current Laden (TEU)" was overstating every AL5 vessel that calls PAROD01 (Panama Rodman, a
relay/transship leg) by exactly that leg's TEU, including on already-departed weeks where the
number should be stable. Confirmed against a fresh `Booking_Flash_Report_09082026.xlsm` snapshot,
the live production CSV feed, and Kevin directly ("PAROD... was pulled in only because MKG wanted
to see the PAROD loading on the POL tab, so it is a one off situation. It should continue to show
there but not aggregate in the total on the overall tab."). See
[Validation — 2026-09-08: AL5 "Current Laden (TEU)" overstated by the PAROD leg](#validation--2026-09-08-al5-current-laden-teu-overstated-by-the-parod-leg)
for the full writeup.

**New feature, 2026-09-08:** a "schedule change warning" banner, with thresholds empirically
calibrated (not placeholder). Motivating case: Kevin got confused when a vessel's sailing (Lane
MAR, VVD NLAT0668E) had its Cutoff/ETD go from populated to blank, and a Sale Week (2026/W38) that
had data at one point later had none at all, between two times he looked at the report. That
turned out to be the live Google Sheet data source itself changing between refreshes (a sailing's
status flipping to `"NO N.A. CALL"`, a Sale Week's assigned vessel changing) — normal upstream
churn, not an app bug — but from inside the app it's indistinguishable from a real regression, and
a human had to re-investigate from scratch to tell the two apart. The fix: every live-data swap
now diffs the OLD dataset against the NEW one (`diffScheduleChange(oldRows, newRows)`, defined
next to the other pure helpers, near `compareEtd`) and, if the diff crosses a threshold, shows an
amber/orange banner (`scheduleChangeWarning` state) with a plain-English summary instead of a
silent, confusing swap. See HANDOFF.md's own entry for this feature for the full writeup (hook
point, diff shape, threshold rules, live-verification results) — not duplicated here since this
is a diff-of-two-snapshots feature, not a `getVal()`/field-mapping change, so it doesn't fit this
document's normal per-field table. **The one thing worth flagging in THIS document**:
`SCHEDULE_CHANGE_THRESHOLDS` (near `POLL_INTERVAL_MS`) is calibrated against a real 9-day
historical churn archive (`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`, 223
(lane, day-pair) observations) — a universal net-loss rule (a lane losing 2+ VVDs net, no
same-day replacement) plus a supplementary gross-rate rule for large lanes (>=8 VVDs losing
40%+ at once even if backfilled), and a direction-aware Cutoff/ETD/POL flip count that only
counts bad-news directions (populated→blank, flipping TO `"NO N.A. CALL"`) so a benign
schedule-being-filled-in flip doesn't also trigger it. Full derivation and the raw archive numbers
are in the threshold constant's own comment block in the app file.

**Defensive fix, 2026-09-08:** `tableData`'s VVD aggregation (Booking Flash/Detail's "Overall"
rows) was missing `pol`/`yard` from both the `numerics` (SUM) and `maxes` (MAX) rollup lists —
same "left out of both lists, so it defaults to plain first-leg-wins" bug class as the earlier
`broken`/`curLaden` fixes this session, found while investigating a Kevin-reported MAR/
`NLAT0668E` "NO N.A. CALL" discrepancy (that discrepancy itself turned out to be a genuine,
same-day upstream feed change — see the schedule-change-warning entry above and its motivating
case — not this bug; this gap was **currently dormant**, no live VVD has legs that disagree this
way as of the fix). The failure mode: a multi-leg VVD whose FIRST raw row is blank/`"NO N.A.
CALL"` but a LATER leg carries a real port would silently keep showing `"NO N.A. CALL"` on the
aggregated row — the real port on the later leg gets dropped, not because of anything wrong with
the raw data, purely because first-leg-wins is the wrong rule for this specific field. Fixed by
adding an explicit "first REAL (non-blank, non-`"NO N.A. CALL"`) value wins" rule for `pol`/`yard`
in the aggregation's accumulate branch (`tableData`, near the other per-field rollup lists) —
verified against the real extracted aggregation code (not a re-implementation) with a synthetic
2-leg VVD in both leg orders: the real port wins either way, and a genuinely all-`"NO N.A. CALL"`
vessel correctly stays flagged as one. Full regression suite re-run clean (55/55) after this
change.

**Last full validation pass:** 2026-08-25, against a fresh `Data_download` CSV export and the
real reference workbook `Booking_Flash_Report_08252026b.xlsm` (Kevin's actual Excel system, not
just a re-derivation from raw data — see [Reference workbook](#reference-workbook-the-real-ground-truth)
below). Findings and fixes from that pass are folded into this document; see
[Validation status](#validation-status-by-tab) for exactly what was and wasn't covered.

**Full re-validation, 2026-09-01:** against `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` and
`Booking_Flash_Report_REFERENCE_08-12-2026.xlsm`, run via 3 parallel agents each executing the
app's real code against a real SheetJS parse (not a re-implementation). 6 real bugs found and
fixed (POL/RFR-BKG-TEU column mis-wiring, Broken Routes/RFR Utiliz % aggregation gaps, Trade
Summary row order, Status column casing) plus 1 display-only fix (ETA time zero-pad); see
[Re-validation — 2026-09-01](#re-validation--2026-09-01) for the full writeup.

**2nd pass, same day:** re-run against a real historical archive
(`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`, 9 real days) to confirm the above
fixes hold on different days' data, not just the one day/rows the first pass checked. 1 more real
bug found (Short_Fall aggregation, same class as Broken Routes) plus the first genuine two-real-day
test of the Compare tab; see
[Re-validation — 2026-09-01, 2nd pass](#re-validation--2026-09-01-2nd-pass-historical-dataset).

**Supplementary structural check, 2026-08-26** (Kevin: "do our tests match up and check that all
the data mapping is correct?") — deliberately *not* a full re-audit: every change made this
session (per-tab text size, slicer/button font sizes, sticky-header `border-collapse`→`separate`
fix, toggle-panel column defaults, row height/auto-fit column width) is presentational/CSS or a
display-default, none of it touches `getVal()`, any alias, or any computed field — so there was no
reason to expect a value-level regression, and this check was scoped accordingly rather than
re-running the full multi-hour exhaustive pass for no reason:
1. Ran [`tests/check_alias_landmines.py`](tests/check_alias_landmines.py) against the current
   sample export (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`, 97 columns) — **zero landmines**
   (33 aliases match nothing in this particular file, all confirmed harmless/inert per the script's
   own classification).
2. Programmatically diffed this document's field-mapping table against every `getVal()` call
   actually present in the app source (73 unique fields either side, by field name) — **fully in
   sync**, then independently resolved each field's real matched source column against the sample
   file's actual 97 headers and diffed that against this table's claimed source column — 2 real
   gaps found and fixed (see below), everything else confirmed accurate.
   - **Fixed**: `status` and `loadingStatus` were genuinely undocumented — `loadingStatus` in
     particular is a real, directly-rendered field (POL Booking Flash's "Status" column, and drives
     that tab's own AP Frozen/AP Only row coloring) sourced from a *different* raw column
     (`Measures Loading Status`) than `status`/`statusDisplay` (`Measures Overall Status`) — a real
     documentation gap, not a code bug (the app itself had this correct and tested); now added as
     its own rows above.
   - Row count in the "Data flow" diagram corrected `~68` → `~75` fields to match the current count.
3. Audited whether `tests/booking_flash_regression_tests.js`'s own checks still exercise what they
   claim to, given today's toggle-default change (many Booking Flash/Detail columns now default to
   **hidden**, where they used to default to visible) — found a real gap: the Class F "no 4+ digit
   field renders without comma formatting" check locates each of its 12 target columns (RFR/TPT
   family, DG TEU, Broken Routes) by header text with a graceful `idx < 0` skip-if-absent guard, so
   it never *failed*, but measuring it directly showed only **1 of 12** target columns (`Broken
   Routes`) was actually visible-and-checked by default post-toggle-change — the other 11 were
   silently skipped every run, an unnoticed ~92% coverage loss on that one check (it still
   nominally "passed," just against far less real data than before). **Fixed** by adding a
   `clickShowToggle()` helper and calling it for Reefer/Trade Breakdown/DG Volume at the top of the
   Booking Flash suite, before any header-position-dependent check reads the DOM — confirmed live
   this restores all 12/12 target columns to visible, re-verified the fixed suite still passes with
   the same 47/47 total (no new checks added, existing ones just regained their real coverage).
   POL Booking Flash's own suite has no equivalent gap (its own toggle-gated columns — Reefer/
   Activity/Operational Issues/ETA/VCO Analyst — aren't targeted by any header-text-located check).

## Data flow

```
Raw export (Data_download.csv or .xlsx, 97 columns, one row per VVD+POL-leg)
    ↓ SheetJS parses to an array of {header: value} objects
    ↓ each row's keys are "cleaned" (lowercased, non-alphanumeric stripped) into cleanRow
    ↓ getVal([aliases]) resolves each app field from cleanRow — see below
    ↓ produces rawRows: one flat object per raw row, ~75 fields (rowObj)
    ↓ filteredRawRows: rawRows narrowed by the slicer selections (Sub Trade/Coast/Analyst/
      Sale Week/Lane/Yard/AP Status/header filters — Sub Trade/Coast/Analyst/Lane's own button
      lists are themselves derived live from rawRows, see Dynamic slicers below)
    ↓ per-tab: either rendered near-directly (POL Booking Flash, Booking Flash/Detail — flat,
      rowSpan-merged tables) or aggregated into a tree by PivotTableViewer (Trade Summary,
      Sector Summary's left pivot)
```

Two tabs (**POL Booking Flash**, **Booking Flash/Detail**) render close to one `<td>` per raw
field per row — the most direct path from raw column to screen, and the one most exposed to a
bad `getVal()` alias. Two tabs (**Trade Summary**, **Sector Summary**'s left pivot) go through
`PivotTableViewer`'s tree aggregation (sum/max/rollup) — a bad alias there is masked less often
because the aggregated field list is short and every one is already an exact-match (see the
table below), but a rollup-math bug (see HANDOFF.md's Class A) is a distinct risk on that path
instead.

### `getVal()`: the two-pass alias resolver

```js
const getVal = (aliases) => {
    // Pass 1: exact match only, first alias in the array that resolves to a
    // real, NON-BLANK column wins. A blank cell is skipped, not returned —
    // the loop keeps trying later aliases in the array, even ones meant as
    // "alternate name" fallbacks rather than "this row's data is elsewhere."
    for (let alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanRow[cleanAlias] !== undefined && cleanRow[cleanAlias] !== '') {
            return cleanRow[cleanAlias];
        }
    }
    // Pass 2 (only reached if EVERY alias missed pass 1): substring match —
    // the first real column whose cleaned name CONTAINS the cleaned alias,
    // in the array's order, in the raw file's own column order for ties.
    for (let alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanAlias.length < 3) continue; // guards against 1-2 char aliases matching everything
        const matchingKey = cleanRowKeys.find(k => k.includes(cleanAlias));
        if (matchingKey && cleanRow[matchingKey] !== '') return cleanRow[matchingKey];
    }
    return '';
};
```

This is genuinely useful — it's why the app tolerates minor header renames between exports
without code changes. But pass 2 is where every bug in this document's history came from.

### Class E — the fuzzy-alias landmine (read this before adding any `getVal()` call)

**The trap:** a short, generic trailing alias (`'Cutoff'`, `'ETD'`, `'Remarks'`, bare `'Vessel'`,
`'TAT'`) is usually added "just in case a future export spells the header differently." It sits
harmlessly unused for as long as the primary, exact-match alias is populated on every row. The
moment a **single row** has that primary column blank (a real, common occurrence — VMS
placeholder rows, an unset rotation, a not-yet-written remark), pass 1 exhausts all aliases
without a hit, falls into pass 2, and the generic alias substring-matches **whatever real column
happens to contain that word anywhere in its name** — not necessarily the one you meant. This is
silent: no error, no console warning, just a wrong value (or someone else's text) rendered as if
it were correct.

This bit the app **six separate times** across two audits (2026-08-18: `TAT`/`LET`; 2026-08-25:
`cutoff`/`etd`/`proformaRot`/`remarks`), always the same shape: a generic 3-8 letter alias,
matched against an unrelated column that happens to contain that substring, triggered only on
whichever rows had a blank primary source cell in that particular export.

**The fix, and the standing rule for any new `getVal()` call:**
1. Put the real column's exact name as the first alias. Confirm it's an *exact* match (see the
   check below), not something that only resolves via pass 2 fuzzy matching.
2. Before adding any further "just in case" alias, run it through the landmine check:
   ```bash
   python3 tests/check_alias_landmines.py Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx
   ```
   (or point it at any current real export — see [tests/check_alias_landmines.py](tests/check_alias_landmines.py)).
   It simulates both passes of `getVal()` against every real header in the file and flags any
   alias whose fuzzy match lands on a DIFFERENT column than its field's own primary alias. Run
   it after adding a field, and periodically against any new export format Kevin sends — a
   landmine can be dormant against one file and live against another purely because of which
   rows happen to be blank.
3. If a fallback alias is flagged, either drop it (if it never exact-matches anything, it's
   dead weight — see the many `'Current Laden'`/`'Cur Laden'`/`'RFR Max LDN'`-style aliases below
   that are exact-match-only-elsewhere and safely inert) or make it specific enough that it can't
   substring-collide with a real header (spell it closer to the real column, not a generic
   short word).

### Class F — inconsistent/lossy formatting from the live source (found 2026-08-25)

**The trap:** `getVal()` returns whatever raw text a column contains — it never formats
anything. That's fine as long as every source (a clean `.xlsx` upload, the live CSV) renders a
given field's raw text *consistently*. It doesn't. Two separate variants of this hit the app the
same day:

1. **Date fields.** The live CSV source (a Google Sheet's "Publish to the web" export) writes
   out each cell's *displayed* text, respecting that cell's own individual number format — not a
   canonical value. Different rows of the same column can carry different formats if the sheet's
   own cells were ever formatted inconsistently row-to-row. Confirmed live on "Route Date POL
   Cut/off Date": ~77% of rows were a year-less `"Mon D"`/`"Month D"` (e.g. `"Jul 10"`, `"July
   13"`), the rest ISO `"YYYY-MM-DD"` — the underlying data has a real year on every row (the
   `.xlsm` upload path confirms this: a clean `datetime` on 100% of rows, `number_format` uniform
   per column), it's genuinely lost by the time it reaches this app as CSV text. **Compounding
   trap:** SheetJS's own CSV parser (`sheet_to_json({raw:false})`) independently reformats any
   ISO-shaped cell to `"M/D/YY"` *before this app's own code ever runs* — for every column, not
   just the ones being fixed. A year-hint parser that only recognizes raw ISO will silently never
   fire, because the hint field it's borrowing a year from has *already* been reformatted to
   `"M/D/YY"` by the time it's passed in. `formatDate()` (defined near the other formatters, ~line
   700) handles both shapes via a shared `parseKnownDate()` helper, plus the year-less case (given
   a same-row date to borrow a year from, rolling back one year if that would place the date after
   the hint — Port Cut always precedes Coastal ETD in a real shipping schedule).
   Applied to: `coastalEtd`/`portCut` (POL Booking Flash), `lastCoastalEta`/`proformaEta` (POL
   Booking Flash, carries a time), `cutoff`/`etd` (Booking Flash/Detail — a *different* pair of
   source columns than POL Booking Flash's, not the same fields aliased twice).
   **Deliberately diverges from the reference `.xlsm`'s own native format for some of these** —
   its Port Cut is `"mm-dd-yy"` (`"07-13-26"`), and Booking Flash/Detail's Cutoff/ETD Last Port
   are `"mmm-yy"`/`"m/d"` (`"Jul-26"`/`"7/23"`, each missing either the day or the year entirely).
   A deliberate choice for one consistent, complete `"M/D/YY"` format across the app (per Kevin's
   direct ask) rather than mirroring Excel's own per-column inconsistency.
2. **Cross-tab number formatting.** Several TEU/plug-count fields (`rfrMaxLdn`, `rfrBkgTtl`,
   `inlandAct`/`inlandNoAct`/`inlandTotal`, `portAct`/`portNoAct`/`portTotal`, `tpt`/`tat`/`lwt`/
   `lnt`/`imt`/`let`, `dgTeu`, `broken`) render comma-formatted (`formatNumberWithCommas`) on POL
   Booking Flash, but the *exact same fields* rendered as bare JS numbers (`"4200"`, not
   `"4,200"`) on Booking Flash/Detail — they'd already been through `toNum()` for the tab's own
   aggregation math (see `tableData`'s `numerics`/`maxes` lists), but the final render pass never
   ran them back through a display formatter. `broken` ("Broken Routes") wasn't even in those
   lists, so it skipped `toNum()` entirely too. Fixed by wrapping each render site in
   `formatNumberWithCommas()` (works fine on an already-numeric input, not just a raw string).
3. **Timezone-shifted dates (found 2026-09-08).** Kevin reported "1st POL Cutoff"/"ETD Last Port"
   rendering exactly one day *earlier* than the real date, on every lane, every row he checked.
   Root cause: SheetJS's default CSV parser auto-detects an ISO-shaped cell (e.g. `"2026-08-16"`,
   which `cutoff`/`etd`'s raw source columns come through as on most live rows) as a date, converts
   it via an internal `Date` object anchored to **UTC midnight**, then formats that `Date`'s
   **local** calendar day for the text this app's `getVal()` actually receives — in any timezone
   *behind* UTC (every North American one included), that local day is the previous day. This
   happens entirely inside SheetJS's own CSV parsing, before `formatDate`/`parseKnownDate` (both
   already timezone-safe — pure regex/arithmetic, no `Date` object) ever see the value, and it's
   invisible in a UTC sandbox (0 offset), which is exactly why it went uncaught until Kevin,
   working in a real NA timezone, reported it. Confirmed empirically: reproduced under
   `America/New_York`/`America/Los_Angeles`, absent under UTC; isolated to ISO-shaped cells only —
   plain numbers, comma-formatted numbers, percentages, blanks, and the year-less `"Mon D"` date
   shape all came through byte-for-byte identical either way. **Fixed** by passing `raw: true` to
   `XLSX.read()` itself (not just `sheet_to_json`) for every CSV-text parse path
   (`applyCsvText`/the live `CSV_SOURCE_URL` fetch, `fetchAndApplySectorData`, `fetchHistoricalData`)
   — this makes SheetJS keep every cell as its literal original text, never auto-promoting an
   ISO-shaped one to a date type at all, so the buggy `Date`-object round-trip simply never
   happens; `getVal()`/`formatDate()`/`parseKnownDate()` already parse a raw ISO string correctly
   (the first branch `parseKnownDate` tries) once they receive the real text. Also fixed the
   manual `.csv` upload path (`processFile`/`processOldFile`, previously both always read every
   upload as a binary string with no `raw` flag at all) by branching on file extension: a `.csv`
   now reads as text through the same `raw: true` shape, while `.xlsx`/`.xls` keeps the
   pre-existing binary-string read completely untouched — a real Excel upload's date cells are
   already properly-typed serials, not text SheetJS has to guess at, and forcing `raw: true` there
   would instead return those cells as bare serial numbers instead of formatted text, breaking
   every date column on a real workbook upload. Live-verified in a real browser under
   `America/New_York`/`America/Los_Angeles`, via both the file-upload path (a real `.csv`) and a
   simulated fetch (the actual live production CSV) — every date now matches its raw source
   exactly, and a genuine `.xlsx` upload's dates are unaffected (still rendering formatted text,
   not serials). **Regression coverage** (added the same day, after initially concluding — wrongly
   — that this couldn't be tested): the DOM-based `tests/booking_flash_regression_tests.js` suite
   genuinely can't catch this, since the bug is defined by which timezone the browser running it
   happens to be in and is silently absent under UTC, whatever sandbox that suite runs in. But a
   *standalone Node script* isn't bound to the ambient environment's timezone the way a live
   browser session is — Node honors an explicit `TZ` env var set before the process starts.
   [`tests/check_date_timezone_safety.js`](tests/check_date_timezone_safety.js) exploits exactly
   that: it forces `America/New_York`/`America/Los_Angeles`/`UTC` each in their own subprocess
   and, using the real `xlsx` npm package pinned to the exact 0.18.5 this app's own CDN URL loads
   (added to `package.json`, dev-time only, same convention as the existing Babel packages — see
   README's package.json note), proves a synthetic ISO date survives every one of them unchanged.
   Paired with a static check that every CSV-text `XLSX.read()` call site in the app's own source
   actually passes `raw: true` (the real fix), so a future edit that drops the flag fails loudly
   rather than silently regressing. Verified the static half has real teeth by temporarily
   reverting one `raw: true` and confirming the check fails on that exact line, then restoring it.

**A related but distinct finding, not a Class F bug itself:** while adding regression tests for
the above, the *test suite's own* pre-existing column-lookup math (`fromEnd = headerLabels.length
- idx`) turned out to have been silently checking the wrong `<td>` on both POL Booking Flash and
Booking Flash/Detail whenever the target field sat before a `colSpan`-grouped header later in the
same row (Inland/Port Total's 3-way sub-column split) — it counted array *index* positions, not
real column positions, so a `colSpan={3}` header inflates the true column count without adding
extra header-array entries. This silently affected the pre-existing "Max Laden Vs POL Booking"/
"Short_Fall" negative-parens checks too (confirmed live: they were reading `"Loadable Quant"`/an
RFR field instead, and only ever "passed" because that wrong column never happened to contain the
broken shape either). Fixed for every affected check in `tests/booking_flash_regression_tests.js`
by computing `fromEnd` from each header cell's actual `colspan` attribute instead of its array
index. Worth remembering next time a new column-indexed DOM check is added to either tab.

### Class G — Temporal-scope mismatch in a derived ratio (found 2026-08-26)

**The trap:** a ratio built from two aggregates that were each summed over a *different* time
window looks like a normal percentage but is arithmetically meaningless — nothing about the code
signals the mismatch, and the result can still fall in a plausible-looking range on some data,
which is what let this slip past casual review. Found on the **Compare tab's "Overall
Utilization"** KPI (`overallSnapshot()`): the numerator (`ladenSum`) summed booked Laden TEU
across *every* Sale Week present in the uploaded file, while the denominator (`maxLdnSum`) summed
each lane's single *peak* Max Laden value pooled across all those same weeks — a multi-week
cumulative total divided by a single-week capacity snapshot. On real data this produced 394%/396%
(caught via live Playwright verification plus an independent Python recomputation from the same
source file, not just eyeballing the UI). Fixed by adding a second, separately-scoped computation
for this ratio only — group rows by lane **and** week, average each lane's ratio across its own
weeks (mirroring `serviceLaneAnalysis`'s already-correct methodology, used by the Analyze modal),
then sum those weekly averages across lanes. The pre-existing `maxLdn`/`laden` values (the "Total
Max Laden"/"Total Booked TEU" KPI cards) were independently verified correct against source and
left untouched — only the ratio's own computation was scope-mismatched, not those two totals.
Live-verified post-fix: Old 31%, New 32% (sane), Total Max Laden/Total Booked TEU unchanged. A
regression check (`tests/booking_flash_regression_tests.js`'s Compare suite) now asserts Overall
Utilization stays under a 150% sane ceiling whenever a second ("old") file is loaded — it's a
ceiling check, not a hardcoded-value snapshot, because the real percentage depends on whichever
two files are loaded. **Worth remembering for any future derived ratio**: check that every
aggregate feeding into it was summed over the *same* rows/scope before trusting the ratio, even
if each aggregate is independently correct on its own.

**2026-09-04 addendum — the exact same pattern was found dormant in `laneAwareMaxLdn`** (Trade
Summary's own Max Laden/Utilization dataFields), during a math/logic audit of the Compare tab and
Historical Data feature. `laneAwareMaxLdn(ctx, cKey)`'s `cKey==='Total'` branch pooled matching
rows across every Sale Week and took one week-blind MAX-per-lane over all of them — verified via
Python against the real sample data to reproduce the identical 396% figure this section's fix
already eliminated from Compare. Unlike Compare, this was **not** live/user-visible: Trade
Summary sets `showGrandTotalColumn: false` (removed 2026-08-25 per direct request, for display
reasons unrelated to correctness — see the audit history table below), so no column ever actually
requests `cKey==='Total'`, and this branch predates Class G's 2026-08-26 discovery — it was simply
hidden by the time this pattern was found and fixed elsewhere, never re-checked against it.
Fixed anyway (not deleted) using the same week-aware convention as `overallSnapshot()`'s fix
above, so a future re-enable of that Grand Total column doesn't silently reintroduce Class G in a
second place. Per-week columns (`cKey !== 'Total'`) were never affected — always correctly
single-week scoped in both numerator and denominator.

## Field mapping (current, post-2026-08-25-audit)

Every `getVal()` field as of this document's date, its exact matched source column (confirmed
programmatically against the real 97-header CSV, not by eye), and which tab(s) render it. `n/a`
under Source column means no raw column matches at all — the field is either always overwritten
by a computed value downstream (noted) or genuinely absent from the standard export.

| Field | Source column (exact match) | Rendered on |
|---|---|---|
| `trade` | Vessel 1st Trade | All tabs (row grouping) |
| `subTrade` | Vessel 1st Sub Trade | All tabs (row grouping) |
| `lane` | Vessel 1st Lane | All tabs (row grouping; POL tab labels it "Service") |
| `saleWeek` | Route Date 1st Sale Week | POL Booking Flash, Booking Flash, Sale Week slicer |
| `pic` | MCT PIC | Booking Flash ("PIC (spc/mkg)"), also feeds the SPC Analyst slicer AND (2026-09-09) the MKG PIC slicer -- same combined "SPC / Mktg" string (e.g. "Ryan T / Alex"), SPC Analyst reads split index 0, MKG PIC reads split index 1 (see Dynamic slicers below) |
| `coast` | MCT Spc Team | Coast slicer only (WC/EC, see Dynamic slicers below) |
| `cutoff` | Route Date Cut/off Date | Booking Flash ("1st POL Cutoff") — rendered via `formatDate()`, see Class F |
| `etd` | Route Date Last Port ETD Date | Booking Flash ("ETD Last Port") — rendered via `formatDate()`, see Class F |
| `statusDisplay` | Measures Overall Status | Booking Flash ("Status") |
| `status` | Measures Overall Status | Not directly rendered — `normalizeApStatus()`-normalized copy of the same source column as `statusDisplay` above, used for AP Status slicer matching (`row.status`) and Booking Flash's own row-coloring, not display text |
| `loadingStatusDisplay` | Measures Loading Status | POL Booking Flash ("Status") — added 2026-09-01; same `status`/`statusDisplay` split as above, kept the source's original title case for display |
| `loadingStatus` | Measures Loading Status | Not directly rendered (2026-09-01 fix; previously rendered directly, always ALL CAPS) — **a different raw column from `status`/`statusDisplay` above, not the same field aliased twice** (POL's report grain is per-POL-leg, so its own loading status can differ from the vessel's overall status). Also `normalizeApStatus()`-normalized; drives POL Booking Flash's own AP Frozen/AP Only row coloring and AP Status slicer matching, deliberately kept separate from Booking Flash/Detail's `status`-driven coloring (see the app's own comment at its row-coloring site) |
| `vvd` | Vessel 1st VVD | POL Booking Flash, Booking Flash |
| `vessel` | Vessel Vessel Name | POL Booking Flash, Booking Flash |
| `maxLdn` | MCT Max Laden Update | Booking Flash ("Max LDN"), Trade Summary (via `laneAwareMaxLdn`) |
| `standbyRaw` | Trunk Threshold | Booking Flash ("Standby Threshold") |
| `curLaden` | Measures POL Laden TEU | POL Booking Flash ("Current Laden (TEU)"), Booking Flash ("Current Laden (TEU)") — **not the same raw column as `ladenTeu`, see HANDOFF.md**. Booking Flash's own vessel-level value is `tableData`'s SUM of this field across a VVD's POL legs, **except a PAROD leg (pol/yard code starting `PAROD`), which is deliberately excluded from that sum** (2026-09-08 fix — see [Validation — 2026-09-08](#validation--2026-09-08-al5-current-laden-teu-overstated-by-the-parod-leg)). POL Booking Flash is unaffected — it renders the raw per-leg value straight from `filteredRawRows`, so a PAROD leg's own row (currently only ever seen on Lane AL5) still shows there unchanged. |
| `ladenTeu` | Measures Laden TEU | Trade Summary ("Total TEU"), feeds Utilization (renamed from "Trunk Utilization" 2026-09-03)/Shortfall |
| `peakUtilRaw` | Measures Peak Overall Utilz | Booking Flash ("Peak Utiliz %") — 2026-09-01: now MAX-aggregated across a VVD's POL legs in `tableData` (was first-leg-wins; dormant in the audited sample but the same bug class as `broken` below). 2026-09-04: fixed a scale bug in how this MAX-aggregated value gets displayed/compared. Unlike every other percent field in this app, real pulls of this specific raw column have been observed BOTH as a true fraction (0.06 meaning 6%, the checked-in sample xlsx's convention) AND already percent-scaled (214 meaning 214%, no fraction) — confirmed via Kevin's live screenshot showing "Peak Utiliz %" values inflated by an extra 100x (21400% instead of 214%, etc.) because the naive fraction-assuming `formatPercent`/`getPercentNum` multiplied an already-percent-scale value by 100 again. Fixed by extracting the self-correcting scale heuristic that had, pre-dating this session, only ever lived inline in the Analyze modal's own peak-util trend calc (raw ≤5 → fraction, ×100; raw ≥1000 → double-scaled, ÷100; otherwise already percent-scale, left as-is) into a shared `getPeakUtilPercentNum` helper, and applied it to both the Detail tab's displayed column (`row.peakUtil`) and the utilization-gap alert (`row.utilGapFlagged`), which previously used the raw value/`getPercentNum` directly. 2026-09-09: the "known residual limitation" noted here turned out to have a real, fixable cause rather than being an unavoidable tradeoff — `tableData`'s MAX-aggregation (added 2026-09-01, described above) was comparing legs via `toNum()`, which strips this field's `"%"` suffix, so a real percent-scale value like `"3%"` silently became the bare number `3` *before* `getPeakUtilPercentNum` ever saw it downstream — and a bare `3` is exactly the "ambiguous raw value" case this same heuristic has to guess on. It wasn't the raw feed handing over a genuinely ambiguous bare number; the aggregation step was manufacturing one out of an unambiguous, `"%"`-suffixed value. Fixed by having the aggregation compare legs with `getPeakUtilPercentNum` itself and keep the result as a percent-suffixed string, so the `"%"` survives all the way to the downstream call. See [`Peak Utiliz %` 100x inflation on low-peak vessels](#validation--2026-09-09-peak-utiliz--100x-inflation-on-low-peak-vessels) for the full writeup — confirmed via 37 real VVDs across 20 lanes in that day's live pull, all off by exactly 100x, all corrected. The underlying ambiguity for a value that arrives with genuinely no `"%"` at all (e.g. some other future data source truly sending a bare `0.06`-style fraction) is unchanged and still relies on this same heuristic — that part was never the bug. |
| `curUtilRaw` | Measures Overall Booking Utilz | Booking Flash ("Current Laden Utiliz %") — briefly remapped to `Laden Utiliz%` on 2026-09-03, reverted the same day (explicit correction): the remap was based on comparing single raw-row values, which missed the real bug -- `tableData` was aggregating this field across a VVD's POL legs with `Math.max(...)` instead of summing, silently understating every multi-leg VVD to its single highest-utilized leg (see the `curUtilRaw` SUM-aggregation entry below). Confirmed against VVD SROT0044S (lane AN2, week 2026/W30, legs USHOU01 + USMIA01): `Measures Overall Booking Utilz` reads 56% and 21% on those two legs and the correct total is their sum, 77% -- MAX would show only 56%. `Laden Utiliz%` is a different, unrelated finished column, not this field's source. Now 2026-09-03 (2nd pass): SUM-aggregated across a VVD's POL legs in `tableData` (was MAX-aggregated, same bug class as `broken`/`peakUtilRaw` below but summed instead of maxed since this is a percentage of combined activity, not a per-leg ceiling) |
| `shortfall` | Max Laden vs POL  Booking (double-space, real) | Booking Flash ("Max LDN vs BKG (Short_Fall)") — computed DAX-equivalent overrides this at render time whenever the VVD's aggregated Max Laden is non-blank; see `laneAwareMaxLdn`-adjacent calc. 2026-09-01 (2nd pass): now also SUM-aggregated across a VVD's POL legs in `tableData` (was missing from that list, same bug class as `broken`) — only actually matters on the rarer maxLdn-blank branch, where the raw summed value is what renders |
| `quote` | Measures ONE Quote volume | Booking Flash ("ONE Quote (TEU)") |
| `broken` | Measures Broken Routes TEU | Booking Flash ("Broken Routes") — 2026-09-01 fix: was missing from `tableData`'s SUM-across-legs list (the only TEU-quantity field that was), so a multi-leg VVD silently dropped all but its first leg's volume; 16 real VVDs undercounted, some down to 0 |
| `bsaTeu` | Measures BSA TEU | POL Booking Flash ("BSA TEU", added 2026-08-25), Booking Flash ("BSA TEU") |
| `bsaWgt` | Measures Last NA Port BSA Wgt | Booking Flash ("BSA Wgt Last NA Port") |
| `rfrBsaPlugs` | Measures BSA UNIT RF | Booking Flash ("RFR BSA Plugs") |
| `rfrBkgPlugs` | Measures Booking Reefer UNIT | Booking Flash ("RFR BKG Plugs") |
| `rfrMaxLdn` | `RFR Max Laden TEU` / `RFR Max LDN` (raw column at parse time); Detail tab's aggregated value is overridden to `rfrBsaTeuRfMax` post-aggregation | **This field has TWO genuinely different correct values depending on which tab renders it — see the 3-part history below, resolved 2026-09-04 during a full 10-agent field-mapping audit.** POL Booking Flash renders straight from `filteredRawRows` (never aggregated), so it correctly shows the raw per-leg column, which legitimately VARIES per port (e.g. SROT0044S reads 20 at USHOU01, 0 at USMIA01 — a port having 0 reefer allocation is valid business data, not broken). Booking Flash Detail renders from `tableData`'s one-row-per-vessel aggregation, where NEITHER summing nor maxing the per-leg raw values reproduces the real report's vessel-level number — cross-checked directly against the reference workbook's own cached `Booking_Flash` pivot tab (ground truth): the real vessel-level "RFR Max LDN" exactly equals `rfrBsaTeuRfMax` (`Measures BSA TEU RF`, a genuine vessel-wide reefer capacity constant), 26/26 real multi-leg vessels checked, zero exceptions. SUM was independently proven wrong too, not just unconfirmed: VVD YMKT0113W's legs [100, 400] sum to 500, which *exceeds* the vessel's own total reefer capacity of 460 — physically impossible for a "max capacity" figure. Fixed by removing `rfrMaxLdn` from `tableData`'s MAX-aggregation list entirely and overriding it post-aggregation with the already-correctly-aggregated `rfrBsaTeuRfMax`, mirroring the existing `rfrUtilizRaw` post-aggregation-recompute pattern — POL Booking Flash is unaffected since it never touches `tableData` for this field. History: (1) originally `getVal(['RFR Max Laden TEU', 'RFR Max LDN'])`, correct for the POL tab but MAX-aggregated for the Detail tab (silently wrong there too, just never caught); (2) 2026-09-03, WRONGLY remapped to `Measures BSA TEU RF` outright, reasoning the per-leg variation was a data-quality problem — this broke the POL tab (Kevin's screenshot caught this: flat 58 on every leg); (3) 2026-09-04 morning, reverted the column back to `RFR Max Laden TEU`/`RFR Max LDN` for parse time, fixing the POL tab but leaving the Detail-tab aggregation unexamined (still MAX-aggregating the now-port-varying raw column); (4) 2026-09-04 afternoon, the 10-agent audit's Group 4 caught the Detail-tab regression via the reference-workbook cross-check above, and it was fixed with the post-aggregation override described here — both tabs now independently correct. |
| `rfrBkgTtl` | Measures Reefer TEU | Booking Flash ("RFR BKG TTL") only (2026-09-01: no longer POL Booking Flash — see `rfrBkgPol` below, they diverge on 6 real PAROD-transship VVDs) |
| `rfrBkgPol` | Measures POL Reefer TEU | POL Booking Flash ("RFR BKG TEU") — added 2026-09-01; a genuinely different, POL-scoped column from `rfrBkgTtl` above (same POL-vs-overall split as `curLaden`/`ladenTeu`), previously miswired to `rfrBkgTtl` |
| `rfrBsaTeuRfMax` | Measures BSA TEU RF | Feeds computed `rfrUtilizRaw` (Booking Flash's "RFR Utiliz %") — not rendered directly. 2026-09-01: now MAX-aggregated across a VVD's POL legs in `tableData` (was first-leg-wins) |
| `rfrUtilizPolRaw` | RFR Utilz% | POL Booking Flash ("RFR Utilz%") |
| `actVsBkgUtilzRaw` | n/a — always overwritten by a computed ratio (`activeTotalTeu/ladenTeu` — corrected 2026-09-04, this entry previously had the ratio inverted) before render | — |
| `actVsMaxLdnRaw` | n/a — always overwritten by a computed value (`activeTotalTeu - maxLdn`) before render | — |
| `inlandAct` / `inlandNoAct` / `inlandTotal` | Measures Active Ipi TEU / Measures Non Active Ipi TEU / Measures Ipi Total TEU | POL Booking Flash, Booking Flash |
| `portAct` / `portNoAct` / `portTotal` | Measures Active Local TEU / Measures Non Active Loc TEU / Measures Local Total TEU | POL Booking Flash, Booking Flash |
| `activeTotalTeu` | Measures Active total TEU | Feeds `actVsBkgUtilzRaw`/`actVsMaxLdnRaw` above |
| `past4WeekFlag` | Route Date Past 4 Week Flag | Filters Sector Summary's left pivot |
| `opIssues` | Vessel Operation Notice | POL Booking Flash, Booking Flash ("Operational Issues") |
| `secAlloc` | MCT Sector Allocation | Not directly rendered — the visible "Sector Allocation" column on Booking Flash actually renders `sectorRemarks` (below), a DAX text-concat quirk, see HANDOFF.md |
| `sgsinDryVsRfr` | Measures SGSIN Sector Remarks | Booking Flash ("SGSIN Dry vs Reefer") |
| `proformaRot` | Route Location Rotation Port | Booking Flash ("Proforma Rotation") |
| `actualRot` | Route Location Actual Rotation Port | Booking Flash ("Actual Rotation") |
| `apStatus` | MCT AP Status | Booking Flash ("AP Status") |
| `tpt`/`tat`/`lwt`/`lnt`/`imt`/`let`/`dgTeu` | Measures TPT/TAT/LWT/LNT/IMT/LET/DG TEU | Booking Flash |
| `remarks` | Vessel Voyage Remark | Booking Flash ("Voyage Remarks", optional toggle) |
| `vco` | VCO Analyst | POL Booking Flash, Booking Flash |
| `lastCoastalEta` / `proformaEta` / `coastalEtaVsProforma` | Route Date Last Coastal ETA Time / Route Date Proforma ETA Time / Route Date Coastal ETA vs Proforma | POL Booking Flash (optional ETA group toggle) — first two rendered via `formatDate()` (see Class F), `coastalEtaVsProforma` is a pre-built duration string ("+7 days 16 hrs"), not a date, left unformatted |
| `pol` | Route Location 1st Yard | POL Booking Flash, POL slicer — 2026-09-01 fix: was `Route Location 1st Pol`, a coarser real column that collapsed distinct terminals (e.g. USLAX01/06/08) into one bare port code; now reads the same source as `yard` below. On `tableData`'s aggregated (Booking Flash/Detail) rows specifically, not plain first-leg-wins — see 2026-09-08 fix below |
| `yard` | Route Location 1st Yard | Yard slicer, filters — same 2026-09-08 aggregation fix as `pol` above applies here too |
| `plannedMty` / `actualMty` | Measures Planned Mty TEU / Measures Actual Mty TEU | POL Booking Flash |
| `polMaxLdn` | POL Max Laden TEU | POL Booking Flash ("POL Max Laden (TEU)") — distinct from `maxLdn`/MCT Max Laden Update, don't merge. 2026-09-09: also now the correct field for the Analyze modal's POL breakdown cards, which had been reading `maxLdn` instead — see [Validation — 2026-09-09 (2)](#validation--2026-09-09-2-pol-analyze-modal-max-laden-scope-bug--compare-tab-vessel-utilz-aggregation-gap) |
| `polLdnThresh` | POL Laden Threshold | POL Booking Flash |
| `discharge` | Measures Discharge TEU | POL Booking Flash |
| `peakPolUtilzRaw` | Measures Peak Pol Utilz | POL Booking Flash ("Peak Laden Utilz %"). 2026-09-09: also now the correct field for the Analyze modal's POL breakdown cards' "Avg Peak POL Utilization," which had been reading the Lane-wide `peakUtilRaw` instead — see [Validation — 2026-09-09 (2)](#validation--2026-09-09-2-pol-analyze-modal-max-laden-scope-bug--compare-tab-vessel-utilz-aggregation-gap) |
| `polBkgUtilzRaw` | Measures POL Booking Utilz | POL Booking Flash ("Current Laden Utilz %") — NOT the same field as `curUtilRaw` |
| `maxLdnVsPolBkg` | Max Laden vs POL  Booking | POL Booking Flash ("Max Laden Vs POL Booking") |
| `loadableQuant` / `loadableWgt` | Measures Loadable TEU / Measures Loadable WGT update | POL Booking Flash |
| `coastalEtd` | Route Date Coastal ETD Date | POL Booking Flash — rendered via `formatDate()`, see Class F |
| `portCut` | Route Date POL Cut/off Date | POL Booking Flash — rendered via `formatDate(val, row.coastalEtd)` (year-hint), see Class F |
| `sectorRemarks` | Sector Remarks | Booking Flash's "Sector Allocation" column (see `secAlloc` note above). Rendered via `renderSecAlloc()`, which bolds any known port/label prefix (`SEC_ALLOC_BOLD_KEYWORDS`, e.g. `"MX Laden:"`, `"MTY:"`, `"CR/GT/NI Discharge:"`) it finds in the free-text remark, plus a red highlight for `+N**`/`(-N**)`-style flagged deltas. **2026-09-09**: added `"COOPL Discharge:"`, then (same day, follow-up report) `"COSPC Discharge(Unit):"`, to that list per Kevin — both legitimate remark labels that simply hadn't appeared in the data yet when the list was first built, so each rendered as plain, unbolded text like every other not-yet-recognized label would. Not a bug in the matching logic itself (it's a maintained whitelist, expected to need new entries as new remark labels show up in the live feed) — just add the exact verbatim label (colon/parens and spacing as it appears in the source — `"COSPC Discharge(Unit):"` has no space before its trailing colon, unlike some other entries) to `SEC_ALLOC_BOLD_KEYWORDS`, defined right before `renderSecAlloc()` itself. |
| `tsAvgBooking` / `tsAvgMaxLdn` | Trade Summary Avg Booking / Trade Summary Avg Max Laden | Sector Summary's LEFT pivot only |

## Dynamic slicers (Sub Trade / Coast / SPC Analyst / MKG PIC / Lane, live as of 2026-08-26)

The Sub Trade, Coast, SPC Analyst, and Lane slicer button lists used to be hardcoded literal
arrays (e.g. `['AW', 'LN', 'PN', 'PS', 'TA']` for Sub Trade) — correct against the data on hand
when written, but silently stale the moment a new lane, a new analyst naming convention, or a new
sub-trade code showed up in a later export: it would filter fine (the underlying rows are still
there), it just wouldn't get a slicer button, making it invisible to a user trying to narrow down
to it. Fixed per direct request ("on the backend there should be data for new lanes... they
should be auto added to the report / tables / slicers") by deriving each list from `rawRows` via
a `useMemo`, matching the pre-existing pattern already used for the Sale Week and Yard slicers:

- `availableSubTrades` — every distinct `row.subTrade`, alphabetical.
- `availableCoasts` — every distinct `row.coast`, with `COAST_PREFERRED_ORDER = ['WC', 'EC']`
  applied first (preserving the existing non-alphabetical display order) and any unknown value
  appended alphabetically after — so a coast value outside `WC`/`EC` still gets a button instead
  of being silently dropped.
- `availableAnalysts` — extracted from `row.pic`'s compound `"Name / MKG"` shape via
  `.split('/')[0].trim()`; a standalone value with no `/` (e.g. `"n/a"`, an MKG-only entry) is
  skipped as ambiguous, exactly matching what the old hardcoded list already excluded — this
  isn't a behavior change for those rows, only an addition for new analysts.
- `availableMktgAnalysts` (2026-09-09, new slicer, "MKG PIC") — same `row.pic` compound string
  as `availableAnalysts` above, just `.split('/')[1].trim()` instead of index 0. Its own
  `matchMktgAnalyst`/`validMktgAnalysts` follow the exact same shape as SPC Analyst's
  `matchAnalyst`/`validAnalysts` throughout `filteredRawRows`'s `useMemo` and the Compare tab's
  `matchesSlicers` — including the same loose "substring anywhere in the whole `row.pic` string"
  matching convention `matchAnalyst` already used (not isolated to the split Mktg half
  specifically), for identical filtering precision between the two PIC-half slicers.
- `availableLanes` — every distinct `row.lane`, alphabetical.

All four re-derive automatically on every new file upload/live refresh — no code change is needed
when the underlying data gains a new value. Live-verified via synthetic injection (a fabricated
new Sub Trade/Coast/Analyst/Lane value each rendered as a button after upload) which also
surfaced two real pre-existing lanes, `EXE` and `INE`, that had been silently missing from the old
hardcoded Lane array the whole time — not introduced by this change, just newly visible because of
it.

## Frozen/static datasets (not derived from the uploaded file — know these before debugging "wrong" numbers)

| Constant | Feeds | Status |
|---|---|---|
| `SECTOR_DATA_SEED` | Sector Summary's RIGHT-hand pivot ("Sector Summary": Sector Alloc/Average Booking/Open Space, by Trade→SubTrade→Lane→POD Sector) | **Live as of 2026-08-25 — no longer the active source.** Kevin provided the real Google Sheet "Publish to the web" CSV export this data comes from: `SECTOR_DATA_CSV_URL` = `https://docs.google.com/spreadsheets/d/e/2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS-mr0DP12xhXXcsCvPDJiTolxYOA013WwHZAg5mFC4xN9cPwSNr3-O_/pub?output=csv`, fetched the same way `CSV_SOURCE_URL` is (`fetchAndApplySectorData`, on initial load, its own independent `POLL_INTERVAL_MS` poll, and manual refresh — all separate from the main source's, gated only by `isSectorCsvSourceConfigured()`). `sectorDataMapped` now reads from `sectorSourceRows` state (fetched rows) instead of the hardcoded seed. **`SECTOR_DATA_SEED` itself is kept only as `sectorSourceRows`'s initial `useState` value** — the fallback shown for the brief window before the first fetch resolves, or if every fetch ever fails (never blanks the pivot over a transient network hiccup). **CORRECTED 2026-09-04 (2nd pass)**: the header originally had `MCT Sector Allocation` as a column TWICE (once after POD Sec, once as the row's last column), deduped by SheetJS to `MCT Sector Allocation_1` for the second occurrence. That was first wrongly assumed to be a harmless redundant duplicate (`sectorDataMapped` read only the plain `MCT Sector Allocation` key, ignoring `_1`); Kevin reported TAT/TA/EMA/GRPIR's Sector Alloc showing 115 when it should read 99 — checked directly against the live CSV, the two duplicate columns disagreed on this one row (115 vs 99) while agreeing on all other 39 — fixed by preferring `MCT Sector Allocation_1` when present. **Kevin then renamed the Sheet's last column to the distinct, unambiguous `Sector Allocation`** (no longer a text duplicate of the first column at all) — this silently broke the `_1`-preferring fix, since SheetJS no longer produces any `_1` key once the header text isn't a true duplicate, so `sectorDataMapped` would have quietly fallen through to the stale `MCT Sector Allocation` column again. Fixed by reading the new `Sector Allocation` column directly, with the old `_1` pattern and the original plain key kept as successive fallbacks (never fully blank, tolerant of the Sheet's column-naming changing again in either direction). The frozen `SECTOR_DATA_SEED` fallback (used only for the brief pre-fetch window or a total fetch failure) still carries its own old snapshot value (115) for this row and was deliberately left as-is rather than patched — every other field in that same seed row (Measures Laden TEU, MCT Voyage Count, Average Booking, Sector Open Space) is also from that same older capture, so hand-editing just the one field would make the row internally inconsistent rather than more correct; the seed going stale over time is expected/by-design, same as any frozen fallback elsewhere in this app. Confirmed live-verified via Playwright: TAT/AL5/BEANR's Average Booking reads the live-fetched 158 (not the old frozen 296), and manual refresh re-fetches. Trade/Sub Trade/Lane/POD Sector row order (`childOrder` config, updated 2026-08-25 — see Class F) still holds against the live data. Same trade scope as before (TAT/TPT only, no LAT — that's inherent to this source, not a technical gap). **Slicer scoping fixed 2026-08-26**: `sectorDataMapped` previously ignored every slicer selection entirely — only the LEFT pivot (`past4WeekRows` → `filteredRawRows`) responded to the Sub Trade/Coast/SPC Analyst/Lane/Sale Week/Yard/AP Status buttons. This source's raw rows only ever carried `Vessel 1st Trade`/`Vessel 1st Sub Trade`/`Vessel 1st Lane`/`POD Sec`/`MCT Sector Allocation`/`Measures Laden TEU`/`MCT Voyage Count`/`Average Booking`/`Sector Open Space` — no Coast, PIC/SPC Analyst, Sale Week, Yard, or AP Status column exists here at all — so `sectorDataMapped` now filters by **Sub Trade and Lane only** (matching `selectedSubTrades`/`selectedLanes` against `Vessel 1st Sub Trade`/`Vessel 1st Lane`, same pattern as `filteredRawRows`'s own `matchSubTrade`/`matchLane`), and deliberately does NOT attempt to filter by the other five slicers since there's no matching field to filter on. Live-verified via Playwright: Sub Trade=AW narrowed the right pivot from 56 rows to 10; Lane=AL5 narrowed it from 56 to 7; Coast/Analyst/Sale Week/Yard/AP Status selections correctly leave the right pivot's 56 rows unchanged (only the left pivot responds to those) with no console errors. |
| ~~`DRY_REEFER_SECTOR_SEED`~~ | ~~Sector Summary's supplementary "Dry Sec/Reefer Sec" table~~ | **Removed 2026-08-26**, per direct confirmation it isn't part of the original reference workbook at all (confirmed by audit: not present in any sheet of `Booking_Flash_Report_08252026b.xlsm`). Was a frozen 8-row sample from a third source distinct from both the main CSV and `SECTOR_DATA_CSV_URL`; the audit that preceded removal also found it was ~7% covering the real lane population (93% of lanes silently rendered as 0) and one lane (FP2) was ~10.5x overstated from 5 stale ghost VVD rows summed on top of its own aggregate row. No live per-lane source for this table exists, so it was fully removed (seed constant, its `sectorDataMapped` join logic, and its render block) rather than repointed. |
| `PORT_EXCLUDE_SEED` | Sector Summary's Port-Excluded row flag | Static exclusion list, not meant to be data-driven (it's a business rule, not a measurement) — this one being static is correct by design, not a gap. |
| `SECTOR_SUMMARY_LANE_EXCLUDE` | Sector Summary's LEFT pivot ("Average Max Laden vs Booking") — filters `past4WeekRows`, the only thing that pivot's `data` prop reads from | **Added 2026-09-08.** Kevin: EXE/EXW are ad-hoc loader lanes, not normal weekly services, and typically carry no real Max Laden/Utilization — they were rendering as a lone $0-Max-Laden row each (e.g. `TPT / PN / EXE`, `TPT / PS / EXW`), circled in a screenshot as unwanted. Same shape as `PORT_EXCLUDE_SEED` above — a static, named list (a business rule, not a measurement) rather than a data-driven "hide any Lane whose Avg Max Laden is 0" rule, since a real service lane can legitimately show 0 for a single off week without being ad-hoc, and a blanket zero-value filter would silently hide that too. Live-verified: `EXW` (present in the checked-in sample export) confirmed showing pre-fix and gone post-fix on the left pivot; the right-hand "Sector Summary" pivot (`sectorDataMapped`, sourced from `SECTOR_DATA_CSV_URL`, a completely separate feed) never had either lane in the same sample, so it wasn't touched — if EXE/EXW ever do show up there too, extend this same exclusion to `sectorDataMapped`'s own filter rather than assuming this list already covers it. |
| ~~`PEAK_DATA_POL_SEED`~~ | ~~POL Booking Flash's "Peak Dry Utilz (POL)"/"Peak Reefer Utilz (POL)"~~ | **Removed 2026-08-25.** Was a frozen 2026-08-13 snapshot from a "Peak Data POL" source sheet outside the standard export. Proved disconnected live (rendered an identical frozen number across VVDs whose real values varied 0-53%) and confirmed absent from the reference workbook entirely. Columns removed rather than repointed — no real per-row substitute exists. If this ever needs restoring as a real feature, it needs a live per-row Dry/Reefer utilization source, not a revert of this removal. |

## Reference workbook: the real ground truth

Kevin's actual Excel system (`Booking_Flash_Report_08252026b.xlsm` as of the 2026-08-25 audit,
version number will change over time — always ask for the current one rather than assuming a
filename) is more authoritative than re-deriving expected values from the raw CSV by hand,
because it captures the real business logic (rounding, edge cases) rather than our own guess at
it. Structure:

| Sheet | Contents |
|---|---|
| `Data_download` | The same raw export the app ingests (97 cols, header row 2) |
| `Ref` | **The canonical field-mapping table** — col A = `Data_download` column letter, col B = "Data Model Field" (the real raw header text), col C = "Bkg Flash Fields" (the display caption used in the report tabs, when different from the raw name). This is the single most useful sheet for resolving "what should this column be called/read from" — check it before guessing an alias. A blank col C means that field isn't renamed for display (or isn't rendered directly at all). |
| `POL_Booking_Flash` | The real POL Booking Flash report, header row 11, one row per VVD+POL-leg (matches the app's own row grain) |
| `Booking_Flash` | The real Booking Flash/Detail report, header row 12, one row per VVD |
| `Trade_Summary` | The real Trade Summary pivot |
| `Sector_Summary` | The real Sector Summary pivot(s) |
| `Sector_Data` | Small supplementary sheet, source for the app's `SECTOR_DATA_SEED`-adjacent data historically |
| `NOTES` | Freeform notes, occasionally has SQL/lineage breadcrumbs (e.g. `BKG_FLSH_PK_POL_DAT`) |

**Reading it:** use `openpyxl` with `keep_vba=True` (it's a macro-enabled `.xlsm`), and load it
**twice** — once `data_only=False` for any formulas, once `data_only=True` for the cached
computed values (a fresh `openpyxl`-written file has no cached values until recalculated; this
workbook already has them since it's Kevin's real, Excel-saved file). Merged/continuation rows
(Trade/Sub Trade/Lane blank on all but the first row of a group) need forward-filling to match
how the app's own `rowSpan` rendering groups them.

**A real reference snapshot goes stale fast** — this app is live/auto-refreshing, so a diff
between the app's current numbers and an xlsm snapshot from even a day earlier is *expected* on
any volatile field (bookings, current laden, discharge). Don't treat every diff as a bug: cross-
check the app's value against the SAME raw CSV row it read from first. A real bug is the app
disagreeing with its own raw source row, not disagreeing with a slightly older snapshot.

## Validation status by tab

| Tab | Coverage as of 2026-08-25 | Result |
|---|---|---|
| POL Booking Flash | Exhaustive — every rendered column, up to 906 rows cross-checked against the real xlsm's cached values | 3 bugs found & fixed (Peak Dry/Reefer Utilz fake data, Max Laden Vs POL Booking formatting), plus Class F (2026-08-25): Coastal ETD/Port Cut date formatting, `formatAccountingNumber`'s own regression check was silently reading the wrong column (test-infra bug, fixed) |
| Booking Flash (Detail) | Thorough — 20-28 columns × 371 VVDs, cross-checked against both raw CSV and the real xlsm | 4 bugs found & fixed (cutoff/etd/proformaRot/remarks fuzzy-alias landmines), plus Class F (2026-08-25): Cutoff/ETD Last Port date formatting, RFR/Inland/Port/TPT-family TEU fields now comma-formatted (were inconsistent with POL Booking Flash's own copy of the same fields) |
| Trade Summary | Full — all 3 dataFields × every populated row/week cross-checked against the real xlsm | 0 bugs (fields were already clean exact-matches). 2026-08-25: Grand Total ROW already removed (2026-08-24); Grand Total COLUMN (rightmost, per-row total across all Sale Weeks) removed too, per direct request — see `showGrandTotalColumn` on `PivotTableViewer` |
| Sector Summary (left pivot, live) | Full — cross-checked against the real xlsm | 0 bugs. 2026-08-25: Trade/Sub Trade/Lane row order now matches the real reference workbook exactly (`childOrder` config, replacing the old alphabetically-computed `topLevelOrder`) — see Class F |
| Sector Summary (right pivot, live) | Wired to its real live source (2026-08-25, `SECTOR_DATA_CSV_URL`, see Frozen/static datasets table above) and live-verified structurally (correct fetch/parse/render, manual refresh works) | No longer frozen. Underlying business-logic correctness (are the source sheet's own numbers right) not independently re-derived — same "the app matches its own live source" standard as every other tab, not a gap specific to this one. 2026-08-25: Trade/Sub Trade/Lane/POD Sector row order now matches the real reference workbook (`childOrder` config) — see Class F |
| ~~Sector Summary (Dry/Reefer supplementary table)~~ | ~~Not covered 2026-08-25 pass~~ | **Removed 2026-08-26** — confirmed not part of the reference workbook; see Frozen/static datasets table above |
| **Compare tab** | **Audited 2026-08-26** — matching-key uniqueness, added/removed/changed counts, and every KPI independently recomputed against real source files | 1 bug found & fixed: "Overall Utilization" was a temporal-scope-mismatched ratio (Class G, see above) — showed 394%/396% before the fix, 31%/32% after. Total Max Laden/Total Booked TEU were already correct and left unchanged. |

Both gaps named in the 2026-08-25 pass are now closed: the Compare tab is audited (see row above),
and the Dry/Reefer supplementary table no longer exists.

## Re-validation — 2026-09-01

Full re-audit against the same two ground-truth files (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`,
`Booking_Flash_Report_REFERENCE_08-12-2026.xlsm`), run per the AGENTS.md workflow with 3 parallel
agents (POL Booking Flash; Booking Flash Detail; Trade Summary + Sector Summary + Compare), each
running the app's **real** `getVal`/aggregation/formatting code (not a re-implementation) against
a real SheetJS parse of the raw export — not a fresh sample of rows, all ~900+ raw rows / ~440
aggregated VVDs. Everything committed between the 2026-08-26 pass and this one was UI/presentational
(text size, dark mode, sticky headers, panel layout, header/slicer minimize) — confirmed via `git log`
before starting, not assumed — so this was a genuine from-scratch re-derivation, not a rubber stamp.

6 real bugs found and fixed, all committed together with this update:

- **POL Booking Flash "POL" column** (~99.6% of rows) — was reading `Route Location 1st Pol`, a
  coarser real column that collapses distinct terminals (USLAX01/06/08 → "USLAX") into one bare
  port code, losing real terminal-level granularity everywhere this field is used (display + POL
  slicer). Fixed to read `Route Location 1st Yard` instead, the same source `yard` already used
  correctly. The old alias was dropped entirely rather than kept as a fallback, since keeping it
  would let `getVal()`'s substring-fallback pass silently reintroduce the bug on any row where the
  correct column is blank (a Class E landmine, caught by `check_alias_landmines.py` on the first
  attempted fix — see `pol`'s field-mapping row above).
- **POL Booking Flash "RFR BKG TEU"** (6/899 rows, all PAROD-related transship legs) — was reading
  `rfrBkgTtl` (`Measures Reefer TEU`, the OVERALL total, correctly used by Booking Flash/Detail's
  own "RFR BKG TTL") instead of a POL-scoped column. Added `rfrBkgPol` (`Measures POL Reefer TEU`)
  as its own field, same POL-vs-overall split already made correctly elsewhere (`curLaden`/
  `ladenTeu`, `peakPolUtilzRaw`/`peakUtilRaw`).
- **Booking Flash "Broken Routes"** (16 VVDs undercounted, several down to 0) — the only TEU-
  quantity field missing from `tableData`'s SUM-across-POL-legs list; a multi-leg VVD silently kept
  only its first leg's value.
- **Booking Flash "RFR Utiliz %"** (125 VVDs, understated 2-10x) — `rfrUtilizRaw` was computed once
  per raw POL leg and never recomputed after aggregation (the numerator, `rfrBkgTtl`, was correctly
  summed; the ratio itself wasn't refreshed from the aggregated total, unlike `actVsBkgUtilzRaw`'s
  existing recompute-after-aggregation pattern, which this now matches). `rfrBsaTeuRfMax` (the
  denominator) is now also MAX-aggregated across legs for the same reason.
- **Trade Summary row order** — Trade-level rows (TPT/TAT/LAT) had no `childOrder`, so
  `PivotTableViewer`'s fallback (plain alphabetical sort) rendered LAT/TAT/TPT instead of the
  reference workbook's real TPT/TAT/LAT order (the same order Sector Summary's own `childOrder`
  already used). Sub Trade order within each Trade was already alphabetical in the reference, so
  only the Trade level needed a fix.
- **POL Booking Flash "Status" column** — always rendered ALL CAPS (`normalizeApStatus()` output
  used directly) instead of the source's real title case ("AP Only" vs "AP ONLY"). Semantically
  correct (row coloring/slicer matching were unaffected), display-only. Added `loadingStatusDisplay`
  for the raw text, same split as `status`/`statusDisplay`.

One more display-only fix bundled in: **Last Coastal ETA Time / Proforma ETA Time** were losing
their intended zero-padded hour (e.g. "7/3/26 1:00" instead of "7/3/26 01:00") on ~46-48% of
populated rows — `formatDate`'s plain `M/D/YY` parsing branch had no trailing-time capture group
at all, unlike its ISO sibling, so a real `"7/3/26 1:00"`-shaped cell (SheetJS's actual CSV output
for these two "m/d/yy h:mm"-formatted columns) fell through to raw passthrough instead of being
recognized and zero-padded.

Everything else audited came back clean against the app's own real source (a few diffs against
the `.xlsm`'s cached values were traced to the *reference file* being stale relative to its own
embedded raw data, or to genuine upstream data drift on the live-fed Sector Summary right pivot —
not app defects; see the governing rule above this table).

## Re-validation — 2026-09-01, 2nd pass (historical dataset)

Kevin provided a real historical archive (`Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`
— a colleague, Hoa, appends a day's `Data_download` export to this one published Sheet daily, dated
via a `Record Date` column; confirmed byte-identical 97-column schema to every other raw export used
in this doc). Re-ran the same 3-parallel-agent process against it (same split as the first
2026-09-01 pass) specifically to (a) confirm this new ground truth is schema-compatible and (b)
re-test the first pass's fixes against genuinely different days' data, not just the one day/rows
the first pass happened to check.

**1 more real bug found and fixed:**

- **Booking Flash "Max LDN vs BKG (Short_Fall)"** — same bug class as `broken` (fixed in the first
  2026-09-01 pass): `'shortfall'` was present in `tableData`'s init-branch numerics list but missing
  from the accumulate branch, so a multi-leg VVD's later legs' raw shortfall was silently dropped.
  Mostly masked because `row.shortfall` is normally overwritten by a fresh `ladenTeu − maxLdn` calc
  whenever the VVD's aggregated Max Laden is non-blank (the common case) — it only actually renders
  the raw summed value on the rarer maxLdn-blank branch, which is exactly why no VVD in the first
  pass's specific date happened to trigger it. Confirmed on 2 of 4 dates spot-checked (e.g.
  2026-08-28 SCNT1010W: legs [103, 0, 14, 20] should sum to 137, was rendering only 103).

**Everything else re-confirmed clean**, and specifically re-tested against multiple different real
days (not just 09-01): Broken Routes/RFR Utiliz %/RFR BKG TEU/POL-column fixes all hold up
genuinely (not dormant-by-coincidence) across every date spot-checked; Trade Summary and Sector
Summary row order (`childOrder`) confirmed on 4 different dates; and — new this pass — the first
genuine two-real-different-day test of the Compare tab's cross-date logic (previously only ever
checkable against one synthetic/hand-crafted comparison file): 2026-08-24 vs 2026-09-01,
independently recomputed added/removed/changed counts and every `overallSnapshot()` KPI (no
recurrence of the Class G temporal-scope-mismatch pattern) — all exact matches.

One data-quality observation surfaced (not an app bug, flagged for Kevin): lane `TPT/PS/EXW`'s raw
`Trade Summary Avg Max Laden` source column is literally `"0"` on its past-4-week rows despite real
non-zero `MCT Max Laden Update` and real bookings on the same rows — the app is faithfully rendering
its own raw source, not mis-wired.

## 2026-09-02: `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` is now the file to update

Per Kevin's explicit instruction, all future work targets `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html`
(the file actually deployed to the Apps Script Web App) — `booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html`
is no longer used or updated, though it remains in the repo as history/reference.

Ported into 1.66 this pass (all independently re-verified — syntax check, alias-landmine check,
and live-browser tests with the real sample export and the real historical archive; screenshots
in the PR description):

- The 5 deferred fixes from the 1.10 lineage that hadn't yet reached 1.66: POL column granularity
  (`pol` no longer falls back past `Route Location 1st Yard`), RFR BKG TEU POL-scoping (new
  `rfrBkgPol` field, POL tab no longer double-counts the trade total), Status casing
  (`loadingStatusDisplay`), Trade Summary/Sector Summary row order (`childOrder` /
  `TRADE_SUMMARY_ORDER`), and ETA hour zero-padding.
- The Historical Data feature (🗓️ button, `HISTORICAL_DATA_CSV_URL` archive, view-a-date and
  compare-two-dates modes) — see this doc's Historical Data section above and the feature's own
  in-code comments for the full design.
- **The Compare tab itself** — 1.66 turned out to have `compareData`'s computation logic already
  present (old-file diffing: added/removed/changed bookings, KPI deltas) but no tab to render it;
  the 1.10 lineage's Compare tab UI never made it across. Ported the whole tab (button + render
  block) unchanged from 1.10 alongside the Historical Data feature, since the Historical Data
  feature's "Compare Two Dates" mode depends on it — without it, that mode would jump to a
  `activeTab === 'compare'` state with nothing to render.
- `'shortfall'` in the accumulate-branch `numerics` list (Booking Flash Detail's per-VVD multi-leg
  aggregation) — already present in 1.66 independently of this port; confirmed, not re-applied.

## Validation — 2026-09-09 (2): POL Analyze modal Max Laden scope bug + Compare tab Vessel Utilz aggregation gap

Kevin: "The Analyze button for the Booking Flash tab is relative to the overall max laden. The
Analyze button for the POL Booking Flash tab is also relative to the overall max laden. It should
be relative to the POL Max Laden." Then: "Can [we] look for more of these kind of errors?" —
answered with 4 parallel investigation agents before any code changed: 2 confirming the reported
bug and checking whether it needed a layout fix beyond the data, 2 sweeping the rest of the app
(Compare tab, Trade Summary, Sector Summary, and every other known Lane-vs-POL field pair) for the
same shape. See [HANDOFF.md's Class I](HANDOFF.md#known-bug-classes-read-before-touching-numericcolor-logic)
for the general pattern this turned out to be, and [HANDOFF.md's own dated section](HANDOFF.md#pol-analyze-modal-max-ladenpeak-utilization-scope-fix-plus-compare-tabs-vessel-utilz-aggregation-fix-2026-09-09-class-i)
for the fuller narrative (agent methodology, screenshots, exact code diffs). This section is the
data-architecture-focused summary.

**Bug 1 — `serviceLaneAnalysis`'s `groupBy` (the Analyze modal shared by both Booking Flash's
"Service Lane Performance Summary" and POL Booking Flash's "POL Performance Summary"):** always
read `maxLdn` (`MCT Max Laden Update` — genuinely Lane/vessel-wide, identical across every POL leg
of a VVD) and `peakUtilRaw` (`Measures Peak Overall Utilz`, same scope) for its per-group
breakdown cards, even when grouping by POL (`fieldKey === 'pol'`), where `polMaxLdn` (`POL Max
Laden TEU`) and `peakPolUtilzRaw` (`Measures Peak Pol Utilz`) were the fields that row means when
used for POL-scoped math. **Live proof** (fresh 974-row pull, 27 multi-POL lanes, 81 POL buckets):
17 of 27 multi-POL lanes showed byte-identical Avg Max Laden across every POL card under that
lane — physically impossible for different ports. Lane EC4 (`USHOU05`/`USMOB01`): 2,359.64/2,359.64
pre-fix → 1,738.21/621.43 post-fix. Cross-checked against the independent `polBkgUtilzRaw`
("Current Laden Utilz %"): fixed utilization lands within ~1 point of it on average across all 81
buckets, vs. ~23 points off pre-fix. **Fix**: `groupBy` picks its Max Laden/Peak field by its own
`fieldKey` parameter (`'pol'` → `polMaxLdn`/`peakPolUtilzRaw`, else → `maxLdn`/`peakUtilRaw`), not
by `activeTab` — `groupBy` is also called a second time, always as `groupBy('lane')`, to build
"Overall Snapshot"/the trend chart, which is intentionally Lane-wide on both tabs (per the modal's
own existing caption) and stays untouched by branching on the parameter instead. Also relabeled
the two affected card fields ("Avg Wkly **POL** Max Laden"/"Avg Peak **POL** Utilization" when
`groupLabel === 'POL'`) since "Overall Snapshot" a few inches above uses the identical unqualified
label for the Lane-wide number — confirmed via side-by-side screenshots this was the only layout
change actually needed, not a broader redesign.

**Bug 2 — Compare tab's `compareData` "Vessel Utilz" diff:** Compare's rows are deliberately
per-`(VVD, POL-leg)` (see its own comment near `keyOf`), and it read `curUtilRaw` (`Measures
Overall Booking Utilz`) straight off one leg's raw row under the label "Vessel Utilz" — a genuine
per-leg fragment, not a repeated whole-vessel value, unlike `maxLdn`. `tableData` already knows
`curUtilRaw` needs a per-VVD SUM across legs (the 2026-09-03 fix, documented on this field's own
row above) to mean what "Vessel Utilz" claims; Compare bypasses `tableData` entirely and never
picked up that aggregation. **Live proof** (two real production pulls ~5 hours apart the same
day): replaying Compare's exact diff logic found 54 distinct VVDs with 2+ separate "Vessel Utilz
changed" rows in one comparison. `TSTT0053W` and `QUIT0020W`: legs shifted in opposite directions
(e.g. one leg 16%→15%, another 4%→5%) that Compare flagged as "changed" twice each, while the TRUE
vessel-level Current Laden Utiliz % never moved (21%→21%, 28%→28%) — the one correct number never
appeared anywhere in Compare for either vessel. **Fix**: a per-VVD aggregate map for both
`curUtilRaw` (SUM via `getPercentNum`, mirroring `tableData`'s own logic) and `peakUtilRaw` (MAX
via `getPeakUtilPercentNum`, defense-in-depth — confirmed genuinely vessel-wide-constant on live
data today, so not currently producing wrong numbers, but would if that ever stops holding),
computed once per dataset (old/new), consulted instead of the raw per-leg value for just these two
fields. `curLaden` was checked and left untouched — it's deliberately POL-scoped here, matching
POL Booking Flash's own per-leg render, with Compare's own POL column making that scope explicit
next to VVD. **Known, accepted trade-off**: a VVD's leg rows still diff independently, so a real
vessel-level change now shows the identical correct diff line once per leg rather than deduplicated
to one row (confirmed live: `HMNT0055W`'s real 21%→18% change shows correctly and identically on
all 3 of its leg rows) — better than the pre-fix state of two different WRONG numbers shown once
each.

**Follow-up (2026-09-10), resolved as a non-issue**: the regression suite's `Analyze_POLBookingFlash`
"Overall Snapshot matches Booking Flash tab's Overall exactly" check had been seen to fail with a
real-looking numeric mismatch — bisected at the time to confirm neither fix above caused it, then
flagged here rather than silently dropped. Kevin asked to look into it; root-caused the same day
per [AGENTS.md's documented "Known flakiness"](AGENTS.md#known-flakiness--dont-let-this-excuse-skipping-the-suite)
protocol: two more full-suite runs against the same fixture each failed **differently** (a
numeric mismatch once, an unrelated "no breakdown card found" setup failure another time, plus
other suites' own "No data uploaded?" failures appearing/disappearing between runs) — the exact
"different check each time" signature the protocol identifies as automation timing noise, not a
real bug. Confirmed with the protocol's prescribed deliberate check instead: fresh load → Booking
Flash tab → Analyze → read Overall Snapshot → close → POL Booking Flash tab → Analyze → read
Overall Snapshot, nothing else running, repeated 3 times on the same fixture — **all 3 runs
produced byte-identical, matching values between the two tabs** (40% / 54,188 / 21,584 / -32,604
every time). The AP-status-ternary theory raised at the time was checked and ruled out directly:
`selectedApStatuses`/`selectedYards` (the only two `activeTab`-conditional filters in
`filteredRawRows`) both default to `[]` and no suite ever selects either before this check runs,
so their tab-conditional branches are provably no-ops here. No fix was needed.

**Verified**: syntax check (Babel + `node --check`) clean on both the app file and the updated
`tests/booking_flash_regression_tests.js` (its `readAnalysisModal()` helper needed a small,
matching update — its `'Avg Wkly Max Laden'` substring lookup broke against the new conditional
"POL" label text, fixed to match on `'Max Laden:'` instead). Live Playwright verification against
real production data for both fixes (see above). Full regression suite: every failure observed
across repeated runs reproduces identically on the unmodified pre-fix code (confirmed via the same
bisection method) — the sandbox's known inability to reach `SECTOR_DATA_CSV_URL`, one
timing-sensitive Departed-star check, and the Overall Snapshot cross-tab mismatch just described;
no failure was ever observed on the post-fix code alone. No `getVal()` alias or `XLSX.read()` call
was touched, so the alias-landmine and date-timezone-safety checks weren't required.

## Validation — 2026-09-09: "Peak Utiliz %" 100x inflation on low-peak vessels

Kevin flagged, via screenshot, Booking Flash/Detail's "Peak Utiliz %" showing **300%** for VVD
`FOWT0531S` (Lane AN2, Sale Week 2026/W46) where he expected something much smaller. A first pass
checking whether this was the same AL5/PAROD `curLaden` bug class on a different field (a PAROD
leg's own utilization getting summed in) ruled that out directly against the live feed — every
PAROD leg's own `Measures Overall Booking Utilz` reads 0% across all 7 live AL5/PAROD VVDs, so
summing it in can't inflate anything. Kevin then sent a wider screenshot and narrowed it further:
"it seems other lanes are having the same issue on the same week" — the real signal that broke the
case open, since it ruled out anything Lane- or field-mapping-specific.

**Root cause, fully confirmed:** `peakUtilRaw` (`getVal(['Measures Peak Overall Utilz'])`) is a
per-POL-leg figure that `tableData`'s aggregation MAXes across a VVD's legs, in the same shared
`maxes` list as several plain TEU/weight fields (`maxLdn`, `bsaTeu`, `bsaWgt`, `rfrBsaPlugs`,
`rfrBsaTeuRfMax`). Every field in that list is converted with `toNum()`
(`parseFloat(String(val).replace(/[,%()]/g, '')) || 0`), which strips any `"%"` suffix — harmless
for the TEU/weight fields (they never had one), but for `peakUtilRaw` this quietly turns `"3%"`
into the bare number `3`. Two paragraphs later in the same file, `getPeakUtilPercentNum()` (added
2026-09-04 for a related but distinct bug — see its own extensive comment) is the ONLY thing that
decides whether a value is already percent-scale or a raw fraction needing `×100`, and it makes
that call almost entirely on whether the string contains `"%"` — a bare number with no `"%"` in
the range `(0, 5]` is assumed to be a fraction and gets multiplied by 100. `toNum()` stripping the
`"%"` during aggregation silently manufactured exactly that "bare small number" input on every
VVD whose aggregated peak utilization happened to land at or below 5% — `"3%"` became `3`, then
`getPeakUtilPercentNum(3)` (correctly, by its own rules, given what it was handed) returned `300`.
Vessels above 5% were never affected, because that same heuristic's "else, already percent-scale"
branch already returns a bare number unchanged — the bug is invisible above 5% and total,
consistent 100x inflation at or below it (confirmed against every one of today's affected VVDs:
`"1%"→100%`, `"2%"→200%`, `"3%"→300%`, `"4%"→400%`, `"5%"→500%`, no exceptions).

This also fully explains Kevin's "other lanes, same week" observation: the bug fires purely on
value magnitude, not on Lane or leg count, and a given Sale Week far out on the booking horizon
(here, 2026/W46 — bookings still low across the board) will simply have many otherwise-unrelated
vessels sitting at or under 5% peak utilization at once, so the same failure surfaces broadly for
that week without being tied to any one lane.

**Fix** (`Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html`, `tableData`'s init and accumulate
branches): `peakUtilRaw` was pulled out of the shared `maxes` list (which stays fine for the
purely-numeric TEU/weight fields) and given its own line in both branches that compares legs using
`getPeakUtilPercentNum()` instead of `toNum()`, storing the running max back as a percent-suffixed
string (`` `${n}%` ``) rather than a bare number — so the existing downstream
`getPeakUtilPercentNum(row.peakUtilRaw)` call (the one added 2026-09-04) always sees a `"%"` and
takes its "already percent-scale, trust it as-is" branch, instead of re-running the fraction-vs-
percent guess on a value that had already been resolved once.

**Verified three ways:** (1) the real aggregation loop extracted verbatim out of the file (not a
re-implementation) and run in Node against a matrix of synthetic cases — a single low-value leg,
two legs at different magnitudes in both orders, a blank leg mixed with a real one, both legs
blank, a genuine bare-fraction raw input (`"0.06"` -> 6%, confirming the *first*, correctness-
critical parse of a truly ambiguous raw value is untouched by this fix), and mixed low/high legs
(confirming MAX picks the real high value, not a misread low one) — all passed. (2) The exact live
case: real `FOWT0531S` legs (`"3%"`/`"3%"`) through the same extracted code now aggregate to `3%`,
not 300%. (3) **Live, end-to-end, before-vs-after**: served the pre-fix and post-fix versions of
the real app side by side, loaded the SAME live CSV pull into both via a real file input (not a
re-derivation), and scraped Booking Flash/Detail's entire rendered table from each. **37 VVDs
across 20 different lanes** (AL5, AN2, ANG, AT1, AT3, AT4, EC1, EC2, EC3, EC4, FLX, FP2, MS2, PN3,
PS1, PS3, PS6, PS7, PS8, VSE) were inflated in today's live pull, every single one by exactly 100x
(`FOWT0531S` 300%→3%, `CGBT0016E` 400%→4%, `PIXT1005E` 500%→5%, etc.) — Lane MAR was not among
them today (data changes daily; the specific vessel/value combination that triggers this depends
on whatever happens to sit at or under 5% at the moment of the pull). 261 other, unaffected
(non-zero, >5%) rows were spot-checked and confirmed byte-for-byte identical old vs. new — no
regression on normal values. Full regression suite re-run clean (55/55) against the fixed app.

## Validation — 2026-09-08: AL5 "Current Laden (TEU)" overstated by the PAROD leg

Kevin asked for the "Current Laden TEU" numbers on the Overall (Booking Flash/Detail) and POL
(POL Booking Flash) tabs to be cross-checked between a fresh `Booking_Flash_Report_09082026.xlsm`
snapshot and the live deployed app, flagging that Lane **AL5** looked off on the Overall tab for
some weeks, including already-departed ones that should be stable. Run as 4 parallel agents (2
against the xlsm — Overall sheet + raw `Data_download` cross-check, POL sheet + departed/future
date classification; 1 auditing the app's own aggregation code; 1 fetching the actual live CSV
feeding the deployed app and recomputing its numbers), then reconciled and fixed in the same pass
per this doc's own standing workflow (see [AGENTS.md](AGENTS.md#full-data-linkage-validation-workflow)).

**Root cause, fully confirmed:** AL5 is the only lane in the workbook where a vessel calls
**PAROD01** (Panama Rodman) as a third leg, in addition to its two normal NA port calls
(typically USLAX0x + USOAK08). This is a deliberate one-off: per Kevin, "PAROD... was pulled in
only because MKG wanted to see the PAROD loading on the POL tab, so it is a one off situation. It
should continue to show there but not aggregate in the total on the overall tab." The reference
workbook already implements this correctly and consistently — every one of the 7 AL5 vessels with
a PAROD01 leg has its `Booking_Flash` sheet's "Current Laden (TEU)" equal to (USLAX + USOAK) only,
*excluding* PAROD01, while `POL_Booking_Flash` correctly lists PAROD01 as its own per-leg row.
This matches the workbook's own `NOTES` tab ("AL5 ETD Last port of NA ports not PAROD" / "PAROD
POL load volume from Space bottleneck") and the `Ref` sheet, which separately names a distinct
`MCT Loading TEU incl Parod` measure — implying the system's default measures exclude it. The 3
AL5 vessels with no PAROD01 leg matched the naive per-VVD sum exactly; all 7 with one were off by
precisely that leg's TEU, on every date/version compared (the fresh xlsm, an independently
re-summed raw `Data_download`, and the live production CSV all agreed on this).

The app's `tableData` aggregation (Booking Flash/Detail's one-row-per-vessel rollup) summed
`curLaden` across **every** raw POL-leg row for a VVD with no PAROD exception — code-correct by
its own prior design (verified: `curLaden` was never missing from the SUM lists the way
`broken`/`shortfall` once were, see Class A below), just missing this one business rule. This
showed up as a **live, current, reproducible overstatement**, not just stale-snapshot noise: e.g.
VVD `NDMT0124E` (AL5, week 2026/W34, fully departed 2026-08-16) rendered **1,626** pre-fix
(571+853+202) against the xlsm's correct **1,424** (571+853) — a real 202 TEU overstatement on a
voyage that had already sailed with no bookings left to change.

**Fix** (`Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html`, `tableData`'s init and accumulate
branches): `curLaden` was pulled out of the shared `numerics` SUM list and given its own line in
both branches that adds 0 instead of the leg's value whenever `row.pol` starts with `PAROD`
(case-insensitive, matched by yard/POL code rather than by Lane so it stays correct if PAROD is
ever added to a lane other than AL5). POL Booking Flash needed no change — it already renders
straight from `filteredRawRows`, never through `tableData`, so PAROD's own row is unaffected.

**Live-verified post-fix** (real browser, real app code, the actual live production CSV pulled the
same day — not a re-implementation): every already-departed AL5 vessel now matches the xlsm
snapshot exactly (`NNBT0093E` 734, `NDMT0124E` 1,424, `CGBT0015E` 786, `NMTT0091E` 1,064 — the
same VVDs that were off by 202/267 TEU pre-fix). Future AL5 weeks either match exactly or differ
by single-digit-to-low-double-digit TEU explainable by normal live booking movement since the
snapshot was taken (e.g. `NDMT0125E` 226 live vs. 212 in the snapshot — legs had genuinely grown
14 TEU in the interim), never by the PAROD amount anymore. POL Booking Flash's own AL5 rows were
confirmed unchanged, PAROD01 still showing its own value on every affected VVD. Full regression
suite: 54/55 (the one failure, Sector Summary's Class A check, is unrelated — this sandbox's
network can't reach the live `SECTOR_DATA_CSV_URL`, so the app fell back to the frozen
`SECTOR_DATA_SEED`, which this doc's own Frozen/static datasets table already documents as
expected to go stale over time; confirmed via the console log showing the fetch failure directly,
not a side effect of this fix).

## How this audit was actually run (repeatable process)

See [AGENTS.md](AGENTS.md#full-data-linkage-validation-workflow) for the step-by-step version —
in short: get a fresh raw export AND (if available) the current reference `.xlsm`, run the
static [`check_alias_landmines.py`](tests/check_alias_landmines.py) sweep first (fast, catches
the whole Class E bug class in seconds), then live-cross-check a real sample of rows/columns per
tab against the raw file and, where available, the reference workbook's own cached values —
ideally via several parallel focused agents (one per tab or per column group) rather than one
agent trying to cover everything serially.

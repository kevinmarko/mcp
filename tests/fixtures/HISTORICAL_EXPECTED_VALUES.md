# Historical 9-day data: expected values

**Glossary.** This file and `tests/check_history_days.js` use the vocabulary of the roadmap plan
(docs/ROADMAP_PLAN.md), which is in review on a separate pull request and is not in this branch yet. *The plan*
is the roadmap; *the brief* is the measurement request this file answers (its numbers are in the "Plan / brief
said" column below). A *slice* is a numbered unit of that roadmap, `phase.number`: **0.3** derives test data from
this CSV (revised: nothing is derived, the helper reads the CSV directly); **1.5** is the schema and row-count
*canary*, a silent check of each loaded feed (expected columns, unique key, consistent voyage-level fields, row
count near the previous load); **2.1** is `diffSailings`, the day-over-day diff at sailing (VVD) level, sorting each
sailing into new / rolled-in / rolled-out / changed; **2.5** is the *history index*, a compact record per
(VVD, POL, day) that an Apps Script job would append daily, for sparklines and persistence rules; **3.1** is
`findExceptions`, the rules that flag a sailing (a: unowned for N days, b: over threshold for N days, c: nominated
with no cut-off), whose list is the *worklist*; **3.4** is the calibration review two weeks after the worklist goes
live; **5.2** is the retention-curve report. *N* is the persistence length in days (decision D3, default 3).
*Decisions* **D2** (what the `MCT Overall Threshold` / `MCT Loading Threshold` columns mean: which measure they
limit, and whether they are policy or a placeholder) and **D4** (whether a PIC name can be mapped to an email, and
whether a blank PIC is normal on some lanes, here EXE / EXW) are open questions for Kevin, the repository owner who
answers them. *PIC* is the person in charge, shown as an "SPC / MKG" pair of names. *R3* is the Apps Script
engineer role and *R4* the data-verifier role (it measured the numbers below). *(a)* and *(b)* in "measurement a /
b" are the brief's labels for two of its measurements: the new-nomination count (slice 2.1) and the history-index
size (slice 2.5).

Ground truth for the roadmap slices that read history: `diffSailings` (2.1), the history index (2.5),
`findExceptions` (3.1), and the evidence behind "no pace-extrapolation forecast" (5.2). **Nothing in this
folder is derived data.** There is no trimmed copy of the CSV to drift: the checks read the committed
file directly and slice it by `Record Date` in code.

- Source file: `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` (repo root, 6.6 MB, 98 columns).
- Reader: `tests/lib/history_days.js` (Node builtins only, parses the whole file in about 0.25 s).
- Check that pins the values below: `node tests/check_history_days.js` (73 assertions, about 1 s). It is an
  executed-count tripwire (`EXPECTED`), so a dropped assertion fails it. **Not every value in this file is
  asserted.** A value marked *documented, not asserted* is stated here but no assertion fails if it stops being
  true; the file size and load time above are descriptions of the same kind.
- Cross-check: every value was also derived independently with Python's `csv` module (a different parser and
  separately written logic) and agreed.

## How rows are counted

The CSV has **8,769 data rows but 27,312 physical lines**, because quoted cells (Sector Remarks, Vessel
Operation Notice, ...) contain newlines. `wc -l` and `split('\n')` are wrong by 3x. Always count with
`H.parseCsv` / `H.loadHistory` (an RFC 4180 state machine: quoted fields, `""`, newlines inside quotes, optional
BOM, CRLF or LF; tested in the check).

Vocabulary used below:

| Term | Meaning in code |
|---|---|
| **VMS row** | `Vessel 1st VVD` = `VMS`: a placeholder slot for a lane and sale week. Blank POL, blank port seq, blank thresholds (the thresholds are asserted blank on the 73 VMS rows of 09-01; on all 633, documented, not asserted). Never a sailing. `H.vmsRows(date)` |
| **real row / port row** | any non-VMS row: one (VVD, POL) of a real sailing. `H.realRows(date)` |
| **sailing** | one VVD on one Record Date; its port rows are its real rows. `H.sailings(date)` |
| **window** | the 17 consecutive sale weeks present on a date (W29..W45 until 08-30, W30..W46 from 08-31). Asserted: 17 weeks on every day, W29 first on 08-30, W30 first and W46 last on 08-31. That W29..W45 holds on every day until 08-30 (W45 last, no gap) is documented, not asserted |

## Where this file corrects or qualifies the roadmap plan (read first)

The data won in every case. Everything else in the plan's numbers reproduced.

| Plan / brief said | The data says | Consequence |
|---|---|---|
| Laden > Max Laden: 126 rows, 32 pairs, 30 persisting | **Matches only with an unstated guard `Max Laden > 0`.** Without it: 228 rows, 58 pairs, 48 persisting. The extra 102 rows all have `MCT Max Laden` = 0 ("no cap recorded"; 316 such rows, 214 of them with laden 0 too) | 3.1 must state the guard. Both readings are pinned |
| Laden by days to cut-off, 0-2 d bucket: median -7.2 %, 115 of 160 falling | **n = 165, median -6.94 %, 115 falling.** The 115, the post-cut-off 2,433 / 2,263 flat and the four other medians (0.0, +1.1, +0.2, 0.0) all reproduce; 160 and -7.2 do not. They reproduce only if day-pairs whose cut-off was pushed LATER are dropped from that one bucket (then n = 160, median -7.17, but falling = 113 and the post bucket 2,432: documented, not asserted), so no single method gives all of the brief's numbers | Conclusion unchanged (accumulate, trim, freeze). The method is now written down and pinned |
| TBA rows: 239 rows, 28 sailings, `Peter / TBA` 96, `TBA / Alex` 67, `TBA / Marissa` 40 | 239 and 28 are right, but those three pairs sum to only 203. The fourth pair is **`TBA / Bob` 36** (it is GJMT0003W's PIC on 09-01) | None, but a rule that matches only the first three names would miss 36 rows |
| Plan 2.1: all 58 W46 entries rolled-in, "so new bookings = 0 that day" | Classification is right (23 VVDs, 58 rows, all W46, 0 mid-window arrivals). But the 23 are **not empty**: they enter with 100 TEU of bookings (sailing-level; 282 on the naive row sum) and 136 TEU laden. And one of the 23, **CGBT0016E, is not new**: it was W45 on 08-24..08-27, absent 08-28..08-30, back as W46 with its cut-off moved from 10/21 to 10/27 | 2.1 should say "not new demand", exclude rolled-in/out sailings from deltas, and not claim zero TEU. A one-day diff cannot see CGBT0016E returning; history can |
| Plan 2.1: the row-level "+10,846 TEU" was a double count | The double count is real (see below) but **I could not reproduce 10,846**. The row-level delta of the booking column is +10,842 on 08-31 -> 09-01 (sailing-level +3,968); no pair gives 10,846 (documented, not asserted: only the 08-31 -> 09-01 delta is) | Unconfirmed figure; the mechanism is confirmed |
| Plan 2.5: history index "few KB/day" | **About 60 KB/day raw (542,761 bytes / 9 days), about 10.8 KB/day gzipped**, about 22 MB a year raw (arithmetic on the asserted sizes) | R3's quota note (`Code.gs:171`) must be sized against this, or the index must be made smaller (booking is sailing-level, so it is stored once per port row here) |
| Plan 3.1: the three unowned sailings are WAHT0613W, HTET1002W, GJMT0003W | Reproduced, **and all three are on lanes EXE / EXW** (GJMT0003W EXE, HTET1002W and WAHT0613W EXW), the lanes D4 asks whether blank PIC is normal on. The only other blank-PIC sailing still open is WKPT6240E on INE (its lane, INE, is documented, not asserted). If D4 answers "blank PIC is normal on EXE/EXW", the 9-day worklist is empty or one item | Answer D4 before building 3.1(a); pinned as D4 evidence |
| (D2) loading / overall thresholds | The feed already carries a status that looks like the over-threshold flag: `Measures Loading Status` is `AP Only` on 688 rows and `AP Frozen` on 105. Utilisation above the row's own Loading Threshold holds on 1,002 rows (more than the 613 a flat 1.0 flags), including 612 of the 688 `AP Only` rows | Evidence for D2, not an answer. `MCT Loading Threshold` = 0 shows as 1.2 in the derived `POL Laden Threshold` on 125 rows (15 sailings), so 0 may mean "unset, default 1.2". **Unconfirmed**: needs the measure's owner |

## Regenerating a value

```bash
node tests/check_history_days.js        # a mismatch prints got / want for the failing assertion
node -e "
const H = require('./tests/lib/history_days.js'); const h = H.loadHistory();
console.log(H.diffVvds(h, '2026-08-30', '2026-08-31'));            // who leaves / arrives
console.log(H.classifyDisappearances(h, '2026-08-24', '2026-08-25'));
console.log(H.classifyArrivals(h, '2026-08-30', '2026-08-31'));
console.log(H.unownedStreaks(h, '2026-09-01'));
console.log(H.ladenChangeByDaysToCutoff(h));
console.log(H.ladenOverMax(h).rows.length, H.ladenOverMax(h, { requirePositiveMax: false }).rows.length);
console.log(Buffer.byteLength(JSON.stringify(H.compactIndexRows(h))));
"
```

The helper API is documented in the header of `tests/lib/history_days.js`. Its "reference oracles"
(`diffVvds`, `classifyDisappearances`, `classifyArrivals`, `unownedStreaks`, `ladenOverMax`,
`ladenChangeByDaysToCutoff`, `compactIndexRows`) are deliberately naive and independent of `shared/`: the
real implementations are tested against them (and against the numbers below), never the other way round.

## Expected values

Rows are real (non-VMS) unless stated. Dates are 2026. "Pinned" = asserted in `check_history_days.js`; "documented, not asserted"
= stated in this file with no assertion behind it.

### A. The file (slice 1.5 canary)

| Question | Value |
|---|---|
| How many rows, columns, dates? | 8,769 rows, 98 columns, 9 Record Dates 08-24 .. 09-01, every pair one calendar day apart |
| Real vs placeholder rows? | 8,136 real + 633 VMS |
| Rows per date (all / real / VMS / sailings)? | all 994 974 974 973 971 971 971 970 971; real 928 906 906 905 899 899 899 896 898; VMS 66 68 68 68 72 72 72 74 73; sailings 390 371 371 371 368 368 368 367 368 |
| Is `wc -l` usable? | No: 27,312 LF bytes vs 8,769 records |
| Which rows have blank POL / seq / cut-off? | VMS rows: blank POL and seq. Real rows: never a blank POL; 18 real rows have blank seq and blank POL cut-off, all with POL `NO N.A. CALL` (17 on 08-24, 1 on 08-27: documented, not asserted, and so is that the same 18 rows carry both blanks) |
| Is the key unique? | Real rows: VVD+Seq+POL and VVD+POL have **0 duplicates on every day**. Trap: VMS rows share one key, so forgetting to drop them reports 65 67 67 67 71 71 71 73 72 false duplicates |
| Do voyage-level fields agree across a sailing's port rows? | **0 disagreements on all 9 days** (PIC, lane, Max Laden, Cut/off Date, 1st Sale Week; 368 sailings on 09-01) |
| Past-4-Week flag? | A property of the sale week: the 4 oldest weeks of the window are Y (asserted on every day; naming them W29-W32 until 08-30 and W30-W33 from 08-31 rests on the window note above, documented, not asserted); no week is mixed |
| Window size / thinnest week? | 17 weeks every day; fewest sailings in any week on any day: 16 |
| Distinct VVDs; any that leave and return? | 420 over the 9 days; exactly one leaves and returns (CGBT0016E) |
| Is a sale week stable per VVD? | No: 9 sailing-day changes while present (4, 0, 1, 0, 3, 0, 0, 1 per pair); lane never changes |

### B. Rollover and per-pair changes (slice 2.1)

Rollover pair 08-30 -> 08-31:

| Question | Value |
|---|---|
| VVDs and rows out | 24 VVDs / 61 rows, all W29, all Past-4-Week Y |
| VVDs and rows in | 23 VVDs / 58 rows, all W46, all Past-4-Week N |
| Classification | 24 rolled-out, 0 removed; 23 rolled-in, 0 mid-window arrivals; 1 of the 23 is a returning VVD (CGBT0016E) |
| Sailing-level booking TEU | OUT 25,287; IN 100; 344 continuing sailings +1,260; day total 298,813 -> 274,886 = -23,927 |
| Laden TEU (sum of port rows) | OUT 26,065; IN 136; continuing +1,248; day total 312,009 -> 287,328 = -24,681 |
| **Double-count guard**: what does summing the booking column over port rows give? | `Measures Total Booking TEU by Service` is **sailing-level**: identical on every port row of a sailing (0 differing sailings on all 9 days, 333 multi-row sailings on 09-01). Row sums: OUT 69,625, IN 282, continuing +3,254; day totals 766,070 -> 699,981 (about 2.6x the true 298,813 -> 274,886); net -66,089 instead of -23,927 |

Every pair (prev -> cur):

| Pair | 24->25 | 25->26 | 26->27 | 27->28 | 28->29 | 29->30 | 30->31 | 31->09-01 |
|---|---|---|---|---|---|---|---|---|
| VVDs leaving | 21 | 1 | 0 | 5 | 1 | 0 | 24 | 1 |
| rows leaving | 60 | 2 | 0 | 10 | 2 | 0 | 61 | 1 |
| VVDs arriving (NEW VVDs) | 2 | 1 | 0 | 2 | 1 | 0 | 23 | 2 |
| rows arriving | 6 | 2 | 0 | 4 | 2 | 0 | 58 | 3 |
| rolled-out (rule below) | 0 | 0 | 0 | 0 | 0 | 0 | **24** | 0 |
| removed (rule below) | 21 | 1 | 0 | 5 | 1 | 0 | 0 | 1 |
| arrivals: rolled-in | 0 | 0 | 0 | 0 | 0 | 0 | 23 | 0 |
| arrivals: mid-window | 2 | 1 | 0 | 2 | 1 | 0 | 0 | 2 |
| arrivals: inferred VMS -> real nomination | 0 | 0 | 0 | 0 | 1 (PNAT2639S) | 0 | 0 | 1 (YWMT0002W) |
| sailings on both days | 369 | 370 | 371 | 366 | 367 | 368 | 344 | 366 |
| of those, sale week changed | 4 | 0 | 1 | 0 | 3 | 0 | 0 | 1 |
| of those, PIC changed | 7 | 6 | 1 | 7 | 3 | 0 | 0 | 9 |
| of those, cut-off date changed | 32 | 20 | 25 | 21 | 22 | 3 | 16 | 27 |

**The classification rule (proposed for 2.1), VERIFIED**: a sailing that is gone today is *rolled-out* when
its sale week (read from the day it was last seen) no longer appears anywhere in today's real rows, and
*removed* when that week is still present. The plan's note (removals 21, 1, 0, 5, 1, 0, 0, 1; rolled-out 0
except 24 on 08-30 -> 08-31) reproduces exactly. Two cautions, both pinned:

- **Do not use the Past-4-Week flag alone.** On 08-24 -> 08-25, 4 of the 21 vanished sailings are flagged Y
  (W29..W32) but no week left the window, so they are removals; a flag-only rule would call them rolled-out.
- A VVD's sale week can change while it stays, so the rule must use the week it had when last seen, not a
  later value.

Mid-window disappearances:

| Pair | Value |
|---|---|
| 08-24 -> 08-25 | 21 VVDs / 60 rows; sale weeks W29..W45 (one each except W41 x2, W44 x2, W45 x3); rows Past-4-Week N 48 / Y 12 (sailings N 17 / Y 4); lanes FLX 18, AT1 1, EC4 1, PN3 1 |
| 08-27 -> 08-28 | 5 VVDs / 10 rows (7E3T0001W, CGBT0016E, CPRT2636S, SNVT2637S, YCOT0192W); all flag N; weeks W38, W39, W42, W45 x2 |
| blank-PIC link | 20 sailings (55 rows) are blank-PIC on all rows on 08-24; 17 of them (all FLX) are among the 21 that leave; the 3 that stay are GJMT0003W, HTET1002W, WAHT0613W |

New nominations (measurement a): 31 NEW VVDs over the 8 pairs: 23 are rolled-in (all on 08-31) and 8 are
mid-window arrivals; of those 8, **2 look like real VMS -> real nominations** (a placeholder for the same lane
and sale week disappeared the same day: PNAT2639S on 08-29, YWMT0002W on 09-01). **Inferred, unconfirmed**:
VMS rows carry no VVD, so the link is by lane + sale week only.

### C. Unowned sailings and TBA (slice 3.1 (a))

| Question | Value |
|---|---|
| Blank-PIC rows | 96 in all; per day 55 4 4 4 6 4 4 8 7; no VMS row is blank; no sailing is ever partly blank; on all 96 both analyst columns are blank too |
| Unowned >= 3 days, per as-of date 08-24..09-01 | none, none, then GJMT0003W + HTET1002W + WAHT0613W on 08-26 .. 08-31, then HTET1002W + WAHT0613W on 09-01 |
| As of 08-31 (N=3) | GJMT0003W, HTET1002W, WAHT0613W, 8 days each |
| As of 09-01 (N=3) | HTET1002W, WAHT0613W, 9 days each |
| GJMT0003W on 09-01 | PIC `TBA / Bob`: "half assigned" is not blank (D4 decides whether it counts) |
| WKPT6240E | new on 08-31, 2 days as of 09-01 (so it appears at N=2): asserted. Its lane INE, week W46, 4 port rows and "1 day as of 08-31" are documented, not asserted |
| Base rate | N=3: 0, 0, 3, 3, 3, 3, 3, 3, 2 sailings a day; N=1: 20, 3, 3, 3, 4, 3, 3, 4, 3 |
| Which lanes? (D4) | The 22 sailings ever blank on all rows: FLX 17 (these vanish), EXW 2, ANG 1, EXE 1, INE 1. The persistent three are on EXE / EXW |
| TBA in either PIC half | 239 real rows, 28 sailings: `Peter / TBA` 96, `TBA / Alex` 67, `TBA / Marissa` 40, `TBA / Bob` 36; the 633 VMS rows add 145 more TBA rows |

"Unowned streak" = consecutive days up to the as-of date on which the sailing has no PIC text on any of its
port rows; a day on which the sailing is absent breaks the streak.

### D. Thresholds, utilisation, laden over max (slice 3.1 (b); D2)

| Question | Value |
|---|---|
| `MCT Overall Threshold` on 09-01, 898 rows | 1.5 x267, 1.2 x164, 1 x143, 1.25 x69, 1.35 x64, 1.6 x51, 0.75 x42, 1.15 x30, 1.65 x28, 1.8 x28, 0 x12 |
| `MCT Loading Threshold` on 09-01, 898 rows | 1.5 x283, 1 x187, 1.2 x108, 0.75 x57, 2 x52, 0 x52, 1.6 x48, 1.15 x30, 1.65 x20, 1.4 x18, 1.25 x16, 0.01 x14, 0.5 x13 |
| Blank thresholds? | Never on a real row (0 is a real value); always blank on the 73 VMS rows of 09-01 (the other days: documented, not asserted). Overall Threshold changes across the 9 days for 23 of the 368 sailings on 09-01 |
| `POL Booking Utilz` > 1.0 | 613 of 8,136 rows over 9 days: 55 65 69 76 69 72 72 67 68 per day |
| Laden > Max Laden (Max Laden > 0) | 126 rows, 32 (VVD, POL) pairs = 32 sailings, 30 pairs on >= 3 days (all 30 on 3 consecutive days); per day 7 6 6 6 7 30 30 28 6 (jumps over the 08-29..08-31 weekend) |
| Same without the Max Laden > 0 guard | 228 rows, 58 pairs, 48 persisting |
| D2 evidence | see the plan-correction table above: `Measures Loading Status` 7,343 blank / 688 `AP Only` / 105 `AP Frozen`; over-own-Loading-Threshold 1,002 rows (612 / 49 / 341 by status); `Trunk Threshold` = Overall Threshold on all 8,136 rows; `POL Laden Threshold` = Loading Threshold on 8,011 rows, 0 -> 1.2 on the other 125 |

### E. Laden around the POL cut-off (evidence for slice 5.2; why there is no pace line)

Method (pinned in `ladenChangeByDaysToCutoff`): a (VVD, POL) real row on two consecutive dates; the earlier
laden must be > 0; days to cut-off = `Route Date POL Cut/off Date` (M/D/YYYY) of the EARLIER row minus the
EARLIER Record Date; change % = (later - earlier) / earlier; falling < -0.5 %, rising > +0.5 %, flat otherwise.

| Days to POL cut-off | day-pairs | median change | falling | flat | rising |
|---|---|---|---|---|---|
| >= 28 | 1,947 | 0.00 % | 142 | 952 | 853 |
| 14-27 | 868 | +1.08 % | 103 | 300 | 465 |
| 7-13 | 348 | +0.21 % | 71 | 116 | 161 |
| 3-6 | 212 | 0.00 % | 87 | 89 | 36 |
| 0-2 | 165 | **-6.94 %** | **115** | 35 | 15 |
| after cut-off (< 0) | 2,433 | 0.00 % | 107 | **2,263** | 63 |

5,973 usable day-pairs = 7,084 (VVD, POL) day-pairs minus 1,111 whose earlier laden is 0. Laden accumulates
while the sale is open, is trimmed in the last 0-2 days, and is frozen afterwards; a straight-line pace
extrapolation would project upward into a figure that then falls.

### F. Compact history index (slice 2.5; measurement b)

One JSON array per real row: `[VVD, POL, day, laden, booking, POL utilisation, POL cut-off, picBlank]`, numbers
and the M/D/YYYY cut-off kept as the CSV's own text (strings), picBlank 1 when the row has no PIC text. First
row: `["IAIT0006S","NO N.A. CALL","2026-08-24","0","39","0","",0]`.

| Question | Value |
|---|---|
| Rows | 8,136 (96 with picBlank = 1) |
| Raw size | **542,761 bytes** (about 60 KB a day, about 22 MB a year) |
| Gzipped | about 97 KB: Python `gzip` 97,145, Node zlib level 9 97,070 (those two exact lengths are documented, not asserted; the check asserts the band 93,000..101,000, because the exact length depends on the zlib build) |

## Not confirmed

- The meaning of the thresholds and of `AP Only` / `AP Frozen` (D2) and whether blank PIC is normal on EXE / EXW (D4).
- VMS -> real nominations are inferred by lane + sale week; no identifier links a placeholder to a VVD.
- Why laden falls in the last 0-2 days (the plan's hypothesis: bookings trimmed) is not tested by this data.
- The plan's "+10,846 TEU" figure (see the table at the top).
- Nine days, one Monday rollover, one weekend: base rates (exceptions a day, the 30 over-max rows on the weekend) are
  indicative only; slice 3.4 recalibrates on real use.

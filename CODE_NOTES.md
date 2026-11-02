# Code Notes: long-form inline documentation, extracted from the app file

This doc holds the full-length "why is this code written this way" explanations that used to
live as very long inline comments in
[Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html](Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html)
(see README's "Current version" note for how to tell which file is live -- the name in this
sentence can go stale). Each section below corresponds to a short pointer comment left in the
code near the line noted in its heading; search the app file for the doc heading text in
quotes to find the current code location, since line numbers drift as the file changes.

Nothing here is new content -- it's the same explanations that used to sit inline, moved out so
the code reads faster, with a one-to-four-line pointer left in their place. If you're touching
code near one of these pointers, read the matching section below before changing behavior --
these often record a specific bug that was fixed, a measurement that ruled out an
easier-looking approach, or a constraint (a CI marker, a test dependency, a load-bearing
ordering) that isn't obvious from the code alone.

For project history organized by date, see HANDOFF.md. For field-mapping reference, see
DATA_ARCHITECTURE.md. This doc is neither -- it's per-code-location mechanism notes, ordered by
where they appear in the app file.

---

### Tailwind Config: Dark Mode Class Strategy And optimizeUniversalDefaults (was ~line 10 in the app file)

- Class-based dark mode (2026-08-21): the CDN build defaults to 'media' strategy (follows OS prefers-color-scheme only, no manual override). 'class' lets the app toggle dark mode itself via a `dark` class on its own root wrapper div, independent of the OS setting — required for the in-app Light/Dark toggle button. This config script must load AFTER cdn.tailwindcss.com, since it attaches to the `tailwind` global that script creates.
- optimizeUniversalDefaults (2026-09-25, "the macro buttons are slow"): by default Tailwind v3 emits one universal rule, `*, ::before, ::after { --tw-border-spacing-x: 0; ... }`, declaring 51 `--tw-*` custom properties on EVERY element and both of its pseudo-elements, just so the handful of utilities that read them (shadow-*, ring-*, transform, filter/brightness-*, ...) have defaults. On this page that's ~25k elements on POL Booking Flash, ~35k on Booking Flash, and every macro-button toggle, AP chip click and tab switch restyles tens of thousands of them. This flag is Tailwind's own supported option to scope those defaults to only the elements that use such a utility.
- Measured, not assumed (964-row sample export, headless Chromium):
  - full restyle+layout of the POL table: ~490ms -> ~305ms with the universal rule absent (same page, rule deleted in place)
  - click->painted, median of 3, two interleaved A/B rounds: POL macro toggles -21..-27%, Detail macro toggles -21..-24%, switching between the two table tabs -30%
- Rendering verified identical: computed style of every element (plus ::before/::after) snapshotted on both table tabs, light and dark, in both builds — 0 differing real properties; hovered macro buttons still compute `filter: brightness(1.05)`. Only the --tw-* variables themselves disappear from elements that never read them.

---

### Row Highlight Dimming: From Per-Row Opacity To CSS Veil To Data-Attribute Toggling (was ~line 83 in the app file)

**Stage 1 — the original bug (2026-09-15, reimplemented as CSS on 2026-09-18).** "Row Highlighting & Focus" dimming was originally implemented by passing `anyRowHighlighted={highlightedRowIds.size > 0}` as a prop to EVERY row and deriving a per-row `opacity-40` class from it. That one boolean flips false->true for all rows at once on the very first highlight (and back on the last un-highlight), so React.memo's shallow compare failed for every row instance simultaneously and React re-rendered/reconciled the entire un-virtualized table synchronously inside the click handler. Measured on the real 8,769-row historical CSV, POL Booking Flash renders 9,232 `<tr>` / 193,417 `<td>`: the page froze for 38+ seconds and the commit landed at ~41,081ms.

Fix: do the dim in CSS instead, so the 0<->1 transition changes exactly one class, on the `<table>` element, and the browser's own selector matching fades the rest — no row component re-renders at all, and the browser only paints the ~40 rows actually in the viewport rather than all 9,232. Same "don't thread a table-wide value through per-row props" lesson as the F5 (unthrottled mousemove) and F9 (POL field-toggle) freezes — see HANDOFF.md's "Known bug classes". Scoped to `tbody` so the sticky `<thead>` never fades with the body.

**Stage 2 — veil instead of per-row dim.** Even the per-row CSS form of this rule (`tbody tr:not(.bf-row-hl) { opacity: .4 }`) was correct but still cost seconds, because the cost is driven by the NUMBER OF ELEMENTS whose style changes, not which property changes. Measured on the 9,232-row POL table with a forced style+layout flush: applying opacity to those rows cost 31,704ms, removing it 2,864ms — and even the cheapest property tried (outline-color) still cost 2,615ms across the same rows. Profiling a real click confirmed where the time went: on Clear Highlights, React's own commit was 289ms and the browser then spent 3,772ms. React was never the problem after the memo fix — the element count was.

So instead: veil the whole table with one absolutely-positioned `::after` and lift the single selected row above it with z-index. Two elements change instead of 9,231, and the cost stops scaling with row count — measured ~220-360ms, symmetric in both directions, versus 31,704/2,864ms.

Visually this is the same effect, not an approximation: over a white backdrop, `opacity: .4` yields `0.4*colour + 0.6*white`, and a 60%-white veil yields exactly the same blend. Verified by screenshot rather than argument — a dimmed row measures 240.5 mean luminance under the veil vs 237.6 under the old opacity rule (3/255, imperceptible), with the residual pixel difference confined to text antialiasing. Do NOT "simplify" this back to a per-row rule.

Ordering notes, all verified in a real browser:
- `<thead>` is sticky at z-20/z-30, above the veil's z-1, so the header stays crisp exactly as when the dim was scoped to tbody.
- Freeze Panes' sticky `<td>`s carry an inline z-index:1, equal to the veil's. The `::after` is the table's last child, so it paints over them in unhighlighted rows (correct — they should dim), while the selected row's own z-index:2 stacking context keeps ITS frozen cells crisp. Scrolled 600px right with Freeze Panes on, the highlighted row's sticky cells land at the same x as every other row's.
- `position: relative` on the `<table>` makes it a containing block. The only absolutely-positioned descendant is the visually-hidden `<caption>`, which sets no offsets and is clipped to 1x1, so it does not move. The hover tooltip is deliberately rendered outside the table (see hoverTooltip's own comment).

**Stage 3 — the 2026-09-21 correction.** Even after Stage 2 shipped, Kevin reported the app still paused noticeably on "Clear Highlights". Real CPU profiling (CDP Profiler + Tracing, real historical CSV, POL's 9,232-row/193k-cell table) found the remaining cost wasn't React — it was `.bf-has-highlight { position: relative; }` ITSELF, toggled on/off the `<table>` element on every 0<->1 transition. Toggling `position` forces a layout pass over that element's entire subtree: measured in isolation, no React/click-handler involved at all, 717-1274ms to add / 432-616ms to remove — reproducing essentially the whole real-click cost on its own.

First attempted fix (recorded because it did NOT work, not deleted): make `position: relative` an unconditional, never-toggled utility on both tables and every row, only ever toggling the veil's `::after` existence and the row's z-index/outline via the `.bf-has-highlight`/`.bf-row-hl` CLASSES. Shipped, then re-measured with `tests/perf_highlight_benchmark.js` — same numbers, no improvement.

Isolating further (direct classList.add/remove timing via page.evaluate, no app code involved) found the real, page-wide cause: toggling a CSS class on ANY element anywhere on this page — not just the big table, not just `position` — costs hundreds to several thousand ms, highly variably; toggling a plain HTML attribute with an equivalent visual effect on the exact same element costs tens of ms. The prime suspect (consistent with every measurement, though not confirmed by reading its minified source): `cdn.tailwindcss.com`'s own MutationObserver, which watches `class` attribute mutations document-wide to catch newly-used utility classes needing a JIT compile — see AGENTS.md's "New bug class: a first-use Tailwind utility costs a whole-document style recalc" for the first time this same script caused this kind of damage. `bf-has-highlight`/`bf-row-hl` were never Tailwind utilities (always plain hand-written CSS), so no compile should ever have been needed for them — but the observer's reaction to ANY qualifying class mutation costs real time regardless of whether anything actually needed compiling.

Real fix: stop mutating `class` attributes for highlighting, full stop. `bf-highlight-host` is a permanent, never-toggled class — it fixes `position: relative` and the veil's `::after` EXISTENCE once at mount and never touches them again. What toggles per click now is a plain data attribute instead of a class — `data-bf-any-highlighted` on the `<table>`, `data-bf-highlighted` on a `<tr>` — matched by attribute selectors. Do NOT go back to toggling a class here; if you think you have a reason to, measure with `tests/perf_highlight_benchmark.js` first — the first fix above looked correct by the same reasoning and measured as a no-op.

---

### Clear-Selection Button: Memo Skip And Seasonal Icon (was ~line 827 in the app file)

Not wrapped in React.memo (2026-09-10 perf pass, F6 — deliberate non-change, same reasoning as SlicerBtn elsewhere in the file): all 7 call sites pass a fresh `onClick` arrow (e.g. `onClick={() => setSelectedSubTrades([])}`), so a memo wrap would never see equal props and would just add a comparison for nothing. `label` is a stable string literal at every call site, but React.memo's default shallow compare requires ALL props to match, so the one unstable prop (`onClick`) sinks it. This button also already unmounts on its own once the real clear fires (its parent's own `selectedX.length > 0 &&` guard), so most of its renders are a fresh mount anyway — memoizing it would only ever help on an unrelated re-render while the selection is still non-empty, which `onClick`'s instability rules out regardless.

Icon: the plain unicode `×` glyph was replaced with an inline SVG X-mark (crisp, consistent across browsers/zoom, unlike font rendering) — same hand-rolled inline-SVG convention as OneLogo elsewhere in the file (no icon library in this repo). A funnel+X pixel-art icon was tried in its place for one PR (2026-09-25, per a reference image) and then reverted back to this X-mark the same day, per Kevin. `IS_PUMPKIN_SEASON` is computed once per module load (not per render/hover) since the seasonal window can't change mid-session, so hover outside the window costs nothing beyond the existing background-darken transition — no `isPumpkinSeasonToday()` call, no icon swap, no extra state read on the common (out-of-season) path.

---

### Gmail-Search Clickable Cells: URL, Debounce, And Delegated Listener (was ~line 892 in the app file)

`openGmailSearch` / `vvdCell` / `vesselCell`: click-a-VVD-or-Vessel-Name-to-search-Gmail (VVD: 2026-09-26; Vessel Name: 2026-09-28, both per Kevin). Opens Gmail's own search UI in a new tab, quoted for an exact-phrase match — Gmail tokenizes on hyphens/slashes/spaces, so an unquoted code like "ABC-123" would loosely match "ABC" and "123" independently, and an unquoted vessel name like "Ever Given" would match either word anywhere in a message. Doesn't touch the account/session, just navigates to Gmail's search URL. The account-agnostic `mail/#search/` form (no `u/0`) is deliberate: `u/0` opens whichever Google account happens to be first in that browser profile, not necessarily the one signed in for this tab. `noopener/noreferrer` blocks the new tab from reaching back via `window.opener` (reverse-tabnabbing) — but also means `window.open`'s return value is ALWAYS null by spec whenever noopener is set, success or failure, so it can't be used to detect a blocked popup or fall back. Whether the deployed Apps Script sandbox even grants `allow-popups` for this to work at all in production is unconfirmed and can only be checked against the live /exec URL (see this file's other sandbox-only-risk entries, e.g. the storage-origin probe, for the established pattern). A literal `"` inside the value itself is stripped before it goes into the quoted phrase — otherwise it would close the phrase early and search Gmail for something other than the intended exact match.

`lastGmailSearchOpen`: a plain module-level debounce, not React state — a double-click on the same cell fires two ordinary `click` events, and without this both would call `window.open` and land two duplicate tabs. Debounced on (value, time) rather than a per-tab window name: `noopener`/`noreferrer` (needed for the reverse-tabnabbing protection above) puts the new tab in its own unrelated browsing-context group, which breaks same-name-window reuse for a cross-origin target like mail.google.com — relying on `window.open`'s name-reuse behavior here would silently not have worked in most browsers. 800ms comfortably covers a real double-click's inter-click gap without blocking two deliberate, separate searches. One debounce shared by both fields (not one per field) is deliberate too: the only cost of sharing is the astronomically unlikely case of a VVD and a vessel name that are byte-identical strings clicked within 800ms of each other, in which case the second click is a no-op until the window elapses — the same outcome a same-field double-click already produces on purpose.

One delegated listener, not a handler per cell (code review, 2026-09-27, generalized to a second field 2026-09-28): `vvdCell` used to build an `onClick` and an `onKeyDown` closure for every real VVD on every row render, and a module-level flag switched them off around POL's two bulk callers (auto-fit, Excel export) — a flag every future bulk caller had to know about. Now a cell is a plain `<span data-gmail-search>` and two document-level listeners act on it — the SAME attribute name and SAME listener pair for both `vvdCell` and `vesselCell`, so adding Vessel Name did not mean pasting a second copy of this block (which would have needed a second module-level debounce/timer pair, a second delegated-listener pair, and every future bulk caller learning about a second flag). Adding a third field later means giving its cell renderer the same `data-gmail-search` attribute — nothing else changes. CAPTURE phase on `document`, which runs before React's own listeners on the root container, so `stopPropagation` here keeps a click from also reaching a parent row's `onClick` (row highlighting), exactly as the per-cell `stopPropagation` did.

---

### gmailCell: Plain-Function Cell Renderer, Not A Component (was ~line 957 in the app file)

`vvdCell` / `vesselCell`: shared wrappers for every VVD and Vessel Name table cell in the file, respectively — same shape, same rules, different field. Blank/placeholder values ('—', 'VMS') render as plain text, unclickable — those aren't real vessels. A raw `0` or boolean `true`/`false` (never a real VVD or vessel name, but defensively guarded) is returned as-is instead of being stringified into a bogus clickable "0"/"true"/"false" link — React renders a boolean child as nothing, so without this guard a `true`/`false` value would render an invisible but still-clickable hot-zone.

Deliberately plain functions returning a `<span>` element, NOT JSX components (never called as `<VvdCell/>`/`<VesselCell/>`): POL's row renderer (`polDataRowElement`) feeds its `<td>` tree into `polNodeText`/`polElementToDom` (see their own comments, a few hundred lines down) for column auto-fit width measurement and Excel export, and those generic walkers only understand host elements (strings, `<span>`, `<b>`) — a real component's element has `type` set to the function itself instead of `'span'` and no `.props.children` (these take a `vvd`/`vessel` prop, not `children`), which would silently blank the column in both the auto-fit pass and the exported file. Calling either directly and embedding its returned element keeps `type: 'span'` and real text children, so those walkers see it exactly like the plain string it replaces. Click/Enter/Space are handled by the delegated listeners described in "Gmail-Search Clickable Cells: URL, Debounce, And Delegated Listener", via the shared `data-gmail-search` attribute. role/tabIndex (matching the Analyze drilldown card's own convention, search `role="button"`) make it reachable from the keyboard.

---

### toNum: Accounting-Negative Parens And Comma Stripping (was ~line 994 in the app file)

`toNum`: shared raw-string -> number helper for real arithmetic (Class D, 2026-08-18 — strips thousands-separator commas so "42,079" doesn't truncate to 42 at the first non-numeric char the way a bare `parseFloat` would). Also strips "%" (some raw percent columns arrive with a literal "%" suffix — see `getPercentNum`/`getPeakUtilPercentNum` for the fuller percent-scale story) and "(", ")".

2026-09-10 fix: that last part used to strip "(" and ")" WITHOUT checking whether they were wrapping the whole value — i.e. the accounting convention where "(1,234)" means NEGATIVE 1,234, parentheses standing in for the minus sign instead of accompanying one. Stripping the parens and nothing else silently discarded that sign: `toNum("(1,234)")` returned +1234, turning a real negative into a positive with no error, no NaN, nothing visibly wrong — exactly the "silently 100x/sign-flipped" failure mode this file's own helpers have twice shipped at percent-scale (ff07afb, 22af1d4).

Neither real export audited on 2026-09-10 (964-row xlsx, 8,769-row live CSV) currently produces a parenthesized *numeric* cell for any field this function touches — real negatives in both arrive with a plain leading "-" (e.g. "Max Laden vs POL Booking" going as low as -4830) — so this fix changes no currently-displayed value; it closes the hole before a future export (or a manually-entered accounting-formatted cell) hits it the way the live comma-formatted CSV eventually hit the pre-Class-D parseFloat.

Must NOT fire on this app's OWN "(-N)" accounting-negative display convention (`formatAccountingNumber`/`formatAccountingSigned`, e.g. "(-1,234)") being re-parsed — that string already carries an explicit minus once the parens are stripped, so it must pass through unchanged rather than being negated a second time.

---

### Schedule-Change Warning: Distinguishing Upstream Edits From Regressions (was ~line 1455 in the app file)

Schedule-change warning (2026-09-08, placeholder thresholds — see `SCHEDULE_CHANGE_THRESHOLDS` and DATA_ARCHITECTURE.md/HANDOFF.md for the full writeup). Motivating case: the live CSV source is itself a Google Sheet that gets edited between refreshes — a sailing's status can flip to "NO N.A. CALL", a whole Sale Week's assigned vessel can change, etc. That's normal upstream data churn, not an app bug, but from inside the app it looks identical to a real regression (a vessel's Cutoff/ETD go from populated to blank; a Sale Week that had data now has none) — Kevin had to re-investigate from scratch once already to tell the two apart (Lane MAR, VVD NLAT0668E).

`diffScheduleChange()` compares the dataset about to replace the live one against the one it's replacing (see `applyCsvText`'s own call site) so a big-enough change can be flagged with a plain-English "this is probably the data source, not the app" explanation instead of a silent, confusing swap.

Keyed by VVD (`String(row.vvd || '').trim().toUpperCase()`). Blank VVDs are skipped — nothing meaningful to track. "VMS" is also skipped: it's a real placeholder VVD used for a not-yet-nominated sailing week, not an actual vessel, so a "VMS" appearing/disappearing between refreshes is meaningless (every real lane has one at any time a week isn't yet nominated — flagging that would be permanent noise, not a signal).

---

### Shared Capacity Helpers Header: Test Dependency And PAROD Exclusion (was ~line 1694 in the app file)

Everything from this marker to the matching END marker is plain, pure JS (no React, no DOM) and is loaded verbatim by `tests/check_compare_kpis.js`, which runs it headlessly against the real archive. Keep it that way: a dependency on component state here would break that check (loudly), and a helper Compare or Analyze needs belongs inside the markers.

2026-09-08, per Kevin: PAROD (Panama Rodman) is a one-off relay/transship leg that was deliberately pulled into POL Booking Flash so MKG can see PAROD's own loading number on that tab — it's NOT a normal NA port call and must NOT be added into a vessel's Overall/Detail-tab "Current Laden (TEU)" total. Confirmed against the reference workbook: AL5's Booking_Flash sheet's own cached "Current Laden (TEU)" already excludes the PAROD leg (matches its own NOTES tab: "AL5 ETD Last port of NA ports not PAROD" / "PAROD POL load volume from Space bottleneck"), while a naive sum-every-leg-per-VVD includes it and overstates the vessel's total by exactly the PAROD leg's TEU — reproduced live, including on already-departed AL5 weeks where the number should otherwise be stable.

Matched by yard/POL code (not by Lane) so this stays correct if PAROD is ever added to a lane other than AL5. POL Booking Flash itself is unaffected — that tab renders straight from `filteredRawRows`, never from `tableData`, so PAROD's own row keeps showing there exactly as before.

Module-level (moved 2026-09-26) because `buildSailingBuckets` below uses it, as do `tableData` and `serviceLaneAnalysis`.

---

### Sailing-Level Capacity Aggregation: Aligning Compare With Analyze (was ~line 1719 in the app file)

Sailing-level capacity/laden aggregation, shared by the Analyze modal (`serviceLaneAnalysis`) and the Compare tab's KPI tiles (`compareKpiSnapshots`) — 2026-09-26, per Kevin: "align [Compare] with the Analyze button". Compare's utilization tile was written on 2026-08-26 to mirror Analyze's method, as a second hand-copied loop; Analyze then got three fixes on 2026-09-26 (per-sailing capacity, PAROD, VMS-only weeks — see the comments in `serviceLaneAnalysis`) and the copy got none, so on the same rows Compare read 32% where Analyze read 34% (8-12 sample, all weeks). One function now, so the two cannot drift apart again: change it here and both move.

- `rows` -> one SAILING per (group, sale week, VVD): capacity = MAX of the Max Laden field across that sailing's legs (a vessel-wide constant on the lane basis; each port's own allocation on the POL basis), laden = SUM of Current Laden across its legs (PAROD legs left out on the lane basis, exactly as Booking Flash's own Current Laden (TEU) leaves them out).
- `sailings` -> one BUCKET per (group, sale week): every sailing's capacity and laden SUMMED, because a week can hold more than one vessel.
- `groupKey`: 'lane' (Booking Flash, Sector Summary, Compare) or 'pol' (POL Booking Flash).
- `today`/`chartEtdField`: only Analyze's "Departed" star uses them; omit `today` to skip it.
- `withPeaks`: Analyze's Avg Peak Utilization inputs (per-sailing peak, per-port peaks). Compare's tiles never read them, so it passes false and skips two percent parses and an array push per row — over two whole files, on every slicer click (code review).
- `ladenField`: 'curLaden' (Measures POL Laden TEU). Compare falls back to 'ladenTeu' for a file that has no POL Laden column at all — see `pickLadenField`.
- Callers drop rows with a blank sale week BEFORE calling this (Analyze via `weeksPresent`, Compare via `weeksPresentIn`): a blank week would otherwise become a week bucket of its own and change each lane's divisor.

2026-09-21, code-review finding: `parseFloat(...) || 0` doesn't exclude Infinity (Infinity is truthy) — the same gap fixed in `getPeakUtilPercentNum`'s own push-filter, left unpatched on this maxLdn/laden aggregation until then.

Module-level (2026-09-26) so the Analyze vessel list's port rows parse Current Laden exactly as `sailing.laden` does, and so add up to the vessel's total.

---

### Auto-Fit Column Width: Representative-Cell Measurement (was ~line 2116 in the app file)

Widest rendered cell per auto-fit column, WITHOUT measuring every cell.

Measuring every cell is what made the first switch to POL Booking Flash cost ~7s of its ~14.5s. That tab has 192,979 `[data-autofit-col]` cells for the real 8,769-row export, and the old loop gave each one an inline white-space write, a Range measurement, and a second write to restore it. Timed in-page, on the live table:

- set white-space:nowrap on 192,979 cells + flush: 3,408ms
- 192,979 x Range.getBoundingClientRect(): 585ms
- restore white-space + flush: 2,958ms

So ~6.4 of those 7 seconds were two full style recalcs of a 410,000-object document, performed to produce 25 numbers. The measuring itself was never the problem.

Cells that render identically cannot produce different widths, so measure one of each. Two cells here render identically when they carry the same class attribute AND the same text: the class fixes font, weight, size and letter-spacing, and the only text-dependent markup this file generates inside such a cell (`renderSecAlloc`'s `<b>`/`<span>` runs) is a pure function of that text. Keying on text alone is NOT enough and was measured failing — flagged rows (VMS / AP ONLY / AP FROZEN) render the same string in bold, and three columns came out 5.0-21.7px narrow.

On the real export this collapses 192,979 cells to 18,292 (10.5x) and takes 1,174ms instead of 6,849ms, with the resulting widths IDENTICAL for all 25 columns — 0.00px delta, checked against the measure-everything version on live data rather than argued. Re-verify that way if you change the signature.

The white-space:nowrap guard is kept, just applied to the representatives. It happens to change nothing on this dataset (the table is `width:max-content`, so no cell wraps — measured: dropping it entirely moves 0 of 25 columns), but it is what makes a measurement independent of the column's CURRENT width, and a manually-narrowed column can wrap. It costs ~1.1s at 18,292 cells and is not worth removing on a dataset-specific observation.

---

### flattenTabular nodeId: JSON-Path Collision Fix (was ~line 2399 in the app file)

Latent-bug fix (correctness audit, 2026-09-10): `nodeId` used to be built by plain string concatenation with an implicit, unescaped "-" separator (`${parentId}-${node.label}`). A label containing its own "-" is never escaped, so two different tree paths can produce the same id — e.g. a Trade "A-B" + SubTrade "C" collides with Trade "A" + SubTrade "B-C" (both used to stringify to "root-A-B-C"). `nodeId` keys the `collapsedNodes` Set, so a collision meant collapsing one row silently collapsed an unrelated one too.

Fixed by keying off `JSON.stringify(myPath)` instead: `myPath` is already the full array of this node's ancestor labels (built above, one real string per tree level, never concatenated into one), and JSON's own array/string encoding unambiguously escapes quotes/backslashes inside each element and delimits elements with structural `,`/`[`/`]`/`"` characters that a raw label cannot forge — so path `["A-B","C"]` and `["A","B-C"]` now serialize to genuinely different strings (`["A-B","C"]` vs `["A","B-C"]`) instead of colliding. This is stable across re-renders (same node visited twice in the same render always has the same `myPath`, so `collapsedNodes` entries survive a re-render, e.g. a filter change, without being silently dropped — see the verification notes in HANDOFF.md/this commit's message) and safe as a React `key`/DOM attribute value (any string is; JSON's bracket-and-quote-heavy shape was still chosen over a plain escaped-hyphen scheme because readability under devtools inspection was judged less important than not hand-rolling a second custom escaping scheme alongside this file's existing one for `path.join('|')` used by `childOrder` lookups just below).

**Currently latent, but closer to reachable than it looks**: no trade/sub-trade/lane/sale-week/VVD code in either real export (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`, `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`) contains a hyphen, but the VESSEL NAME field does: "X-PRESS ANTLIA" appears in both real exports. When this was written, `vessel` was a rowField on the one PivotTableViewer instance that actually exercised `flatten()`/`collapsedNodes` — the hidden "Booking Summary" tab (`activeTab === 'booking_flash'`). That tab was REMOVED 2026-09-15 at Kevin's explicit request, and it was the only non-`tabular` config in the app, so `flatten()` now has no caller (see the note above `renderRows`). This fix therefore guards a path nothing currently reaches — keep it anyway: it costs nothing, and the next non-tabular config added would otherwise reintroduce a live collision bug that took a full audit to find.

`flattenTabular` itself never reads `collapsedNodes` (see the comment above `renderRows`), so this fix only changes the `id` field's *value*, never its presence/absence or any rendered output — confirmed via the tabular-mode pixel diff in this commit's verification.

---

### renderRows nodeId: Same JSON-Path Collision Fix, Live Path (was ~line 2489 in the app file)

Latent-bug fix (correctness audit, 2026-09-10) — see "flattenTabular nodeId: JSON-Path Collision Fix" for the full explanation; this is the exact same defect and the exact same fix, applied to the render path that actually reads `collapsedNodes` (`flattenTabular` never does — see the comment above `renderRows`).

`nodeId` used to be `${parentId}-${node.label}`, an unescaped "-"-joined string where a label containing its own "-" (e.g. the real vessel name "X-PRESS ANTLIA", confirmed present in both `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` and `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv`, and reachable here because `vessel` was a rowField on the one PivotTableViewer instance that actually exercised this function — the hidden "Booking Summary" tab, `activeTab === 'booking_flash'`, removed 2026-09-15; see the note above `renderRows`) could make two different tree paths hash to the same id, which would silently collapse an unrelated row alongside the one the user actually clicked (`collapsedNodes` is keyed by this id).

`idPath` is the array of this node's ancestor labels, one real array element per tree level (built the same way `flattenTabular`'s `myPath` is); `JSON.stringify(idPath)` turns it into an id whose structural `[`/`]`/`"`/`,` characters and built-in escaping of quotes/backslashes cannot be forged by a label's own "-", so distinct paths can no longer collide no matter what a label contains. Stable across re-renders (same node -> same `idPath` -> same id every time, so a `collapsedNodes` entry survives a re-render — e.g. a filter change — instead of silently dropping), and a JSON-array string is valid as both a React `key` and a plain string Set member / DOM attribute value.

This is a no-op on the live app today (no two real tree paths currently reconstruct the same concatenated string even with "X-PRESS ANTLIA" in the data), but latent bugs in this exact shape are how the recent `collapsedNodes` dependency-array fix (see "useMemo Missing collapsedNodes Dependency: Dormant Collapse Bug") made collapse start actually doing something again — worth closing before that happens here too.

---

### useMemo Missing collapsedNodes Dependency: Dormant Collapse Bug (was ~line 2551 in the app file)

2026-09-10 (W7 correctness audit): `collapsedNodes` was missing from this useMemo's dependency array. The `!tabular` branch's `flatten()` reads `collapsedNodes` directly to decide whether to skip a node's children (`if (collapsedNodes.has(nodeId)) return rows;`), but useMemo only recomputes when something in the dep array itself changes identity — it has no way to know the memoized callback's own closure reads component state that isn't listed. So a collapse/expand click (`toggleCollapse` -> `setCollapsedNodes`) re-rendered the component — the clicked toggle button's own arrow/aria-label flipped correctly, since that JSX reads `collapsedNodes` live, outside this memo — but `renderRows` kept serving its stale flattened list, so the row stayed expanded/collapsed on screen regardless of the click. Confirmed live: a synthetic PivotTableViewer instance with `hideRowToggles`/`tabular` both left at their default `false` (the shape needed for a toggle button to even render) had its collapse button correctly flip its own arrow/aria-label on click, while the child rows it should have hidden stayed on screen with an unchanged row count, reproducing this exact bug.

**Currently dormant in the live app**: every PivotTableViewer instance actually reachable from a tab (Trade Summary, both Sector Summary pivots) sets `tabular: true`, and `tabular` mode's own render path (`flattenTabular`) never reads `collapsedNodes` at all — collapse toggles only exist in the `!tabular` branch, and those 3 pivots also set `hideRowToggles: true` on top of that, so none of today's wired-up pivots even render a toggle button to click. Fixed here anyway, in the shared engine rather than at a call site, since the very next pivot config that leaves both flags at their default would hit this dead on arrival with no warning — the fix costs nothing today (`collapsedNodes` only ever changes via a button this dependency has no other effect on) and prevents a silent regression the moment collapse becomes reachable again.

2026-09-15: the `else` branch below (`flatten()`, the collapsible TREE renderer) now has NO caller. All three remaining PivotTableViewer configs — Trade Summary and both Sector Summary pivots — set `tabular: true`; the only non-tabular config was the hidden "Booking Summary" tab (`activeTab === 'booking_flash'`), removed this day at Kevin's explicit request after it had sat unlinked from the tab bar since well before the 2026-09-10 audit.

So `flatten()`, `collapsedNodes`, `toggleCollapse` and the two collapse toggle buttons further down are all genuinely unreachable NOW — unlike the hidden tab itself, which only LOOKED unreachable and wasn't. Left in place deliberately rather than deleted in the same pass: removing the tab was the request, and stripping tree mode out of the shared engine is a separate, larger refactor (it would make PivotTableViewer tabular-only and change its config surface) that should be its own reviewed change, not a silent rider. If a future sweep flags this as dead code: it IS dead, that is not news, and removing it is a real option — just do it as its own diff.

---

### Pivot Table Box Width: w-max Vs w-full, Reverted (was ~line 2652 in the app file)

2026-09-11, per Kevin: was `w-max max-w-full` (the box shrink-wraps to the table's own column widths, same pattern POL Booking Flash's own table box uses deliberately — see that tab's own comment for why: box/border tracks the real columns exactly, accepting that a monitor wider than the table shows plain page background past the box's edge). On Trade Summary/Sector Summary (both rendered by this shared PivotTableViewer), that same tradeoff read as an "odd gap" instead — reported via screenshot showing the box (and the tab-bar row above it, which IS full-width via its own flex layout) visibly stopping short of the browser's right edge on a wide window, with plain background beyond both. Kevin's call that day: `w-full` instead, so the box always fills the panel's available width — the tradeoff flips to the OPPOSITE one (empty space shows INSIDE the box/border, to the right of the last real column, rather than outside it).

2026-09-14, per Kevin, reverted: a follow-up screenshot of Sector Summary showed exactly that flipped tradeoff in practice — both pivots' boxes stretching to the full panel width with a wide blank strip to the right of their real columns — and Kevin asked for the tables to "auto-size" instead, i.e. back to shrink-wrap. Restored `w-max max-w-full`, which also brings Trade Summary/Sector Summary back in line with POL Booking Flash's box (still a separate `w-max` block, not this component, but now the same shrink-wrap behavior again on all three).

---

### Historical Data Freshness Window: Why 15 Seconds (was ~line 3099 in the app file)

How long an already-fetched Historical Data archive stays "fresh enough" to reuse without re-fetching (see `fetchHistoricalData`). A THIRD independent interval, deliberately not folded into either constant elsewhere in the file — same reasoning as their own comments: these are three separate concerns, and tuning one must not silently move the others.

Why this exists at all: `HISTORICAL_DATA_CSV_URL` is an append-only archive, and it only grows — the 9-day sample committed to this repo is 6.5MB/8,769 rows, but measured against the live URL on 2026-09-15 it was already 15.9MB/22,366 rows. Every fetch of it costs that download PLUS a full XLSX.read + sheet_to_json parse of every row: timed in-page against that live archive, 1,957ms to fetch. The parse half was originally quoted here as "8,935ms" — that number was wrong as a description of the FULL parse; it only ever timed ONE of the two sheet_to_json passes the code actually performs (raw:false for values, raw:true for the untouched "Record Date" — see `fetchHistoricalData`). The correctly measured figure for the whole inline parse, both passes included, is ~14,199ms of main-thread blocking (measured 2026-09-15 by sampling main-thread responsiveness during a real archive load, same 15.9MB/22,366 rows), for ~16.2s total with the fetch. Corrected 2026-09-16 after a docs pass traced the wrong figure back to this comment; see `parseHistoricalArchiveInWorker`'s own comment (which already used the correct number) for where it's used to size the worker's fallback behavior. The parse is synchronous on the main thread. The popover-open effect (see its own comment for the 2026-09-08 staleness bug that put it there) fires on EVERY open, so opening, closing and re-opening the popover three times used to pay all of that three times over. Re-measure before quoting these numbers — they grow with the archive.

Why 15 SECONDS and not something longer: this window exists ONLY to collapse a burst of opens into one fetch. It must stay far shorter than the interval at which the archive can meaningfully change, because the popover-open re-fetch it suppresses is itself the 2026-09-08 bug fix (see that effect's comment).

An earlier draft of this used 5 minutes, mirroring the `max-age=300` Google's published-CSV endpoint advertises on this URL, and claimed that "fully preserves" the 2026-09-08 intent. That was wrong, and the reasoning was tidy but aimed at the wrong requirement — HTTP cache freshness, not user-visible staleness. Concretely: Hoa's daily append lands at 09:00:30; the user opens the popover at 09:00:10 and the fetch completes just before the append, so today is missing; they close it and reopen at 09:03; a 5-minute window skips the re-fetch, today is STILL missing, and nothing on screen says the list is stale. Recovering needs the "Refresh Historical List" button — exactly the button 2026-09-08 exists because users don't think to click. 15s reproduces none of that (any real "did Hoa post today yet?" re-open is far more than 15s after the last one) while still collapsing the open/close/open burst this guard was added for.

The "Refresh Historical List" button always bypasses this window entirely (`{ force: true }`), no matter how recent the last fetch was.

---

### Poll Scheduling: Wall-Clock Alignment Across Users (was ~line 3169 in the app file)

2026-09-14, per Kevin's "not everyone gets the schedule-change banner at the same time" report: every poll below used to run on a plain `setInterval(fn, POLL_INTERVAL_MS)`, which starts counting from whenever THAT PARTICULAR BROWSER TAB happened to mount — not from any shared clock. Two people who opened the app minutes apart would poll (and so notice the exact same server-side change) up to a full `POLL_INTERVAL_MS` apart, purely from that load-time offset. Proved live with two Playwright sessions loaded 15s apart against a shared mock data source: they saw the identical change 10.5s apart despite identical settings (see HANDOFF.md's "Schedule-change notification: not simultaneous across users" entry for the full writeup and numbers).

Fix: align every poll to the next WALL-CLOCK multiple of its own interval (e.g. every 10 minutes means :00/:10/:20/:30/:40/:50 past the hour, UTC) instead of "N minutes after this tab loaded". Since `Date.now()` is the same real-world millisecond count for every user regardless of timezone, and every interval used here divides evenly into an hour, this makes every tab's poll land within the same handful of seconds of each other (fetch latency + a tick of JS scheduling jitter), not up to a whole interval apart. `msUntilNextAlignedTick`'s `intervalMs - (now % intervalMs)` is exactly "time until the next multiple of intervalMs since the Unix epoch" — the epoch itself starts on a whole-minute boundary, so this lines up with human-readable clock marks with no timezone math needed. Each poll site below reschedules itself via `setTimeout` (recomputing the delay fresh each time) rather than a single `setInterval`, so it self-corrects for the poll's own variable run time and for browser throttling of backgrounded tabs instead of silently drifting off-alignment over a long-running session.

---

### Schedule Change Threshold Calibration (was ~line 3218 in the app file)

SCHEDULE_CHANGE_THRESHOLDS feeds `diffScheduleChange()` (see `compareEtd` above) and the "Large schedule change" warning banner (see the render block near the other `applyCsvText`-driven banners).

Calibrated 2026-09-08 against `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` — 9 real consecutive days, 8 day-over-day diffs, 28 lanes, 368-391 VVDs/day, 223 (lane, day-pair) observations. Full derivation/raw numbers are in DATA_ARCHITECTURE.md's entry for this feature; this is the summary.

Two complementary rules decide whether a lane's VVD losses are significant (see `diffScheduleChange`'s own use of these numbers for exactly how they combine):

- A UNIVERSAL net-loss rule (applies at every lane size). Net loss (removed minus added, i.e. VVDs actually lost with no same-day replacement) is the one that matters most: across all 223 observations it NEVER exceeded 1 in a single lane in a single refresh — including the archive's single busiest day (2026-08-30 -> 31, a routine weekly voyage-number rollover that swapped 24 VVDs for 23 new ones across ~24 different lanes simultaneously, net ~0 everywhere but one). A flat percentage threshold alone would have false-positived on that routine day for any small lane (MAR-sized lanes: losing 1 of 3 near-term sailings reads as 33%) and would have MISSED a real "lost 2 of 5, no replacement" event on a small lane if judged by raw count alone without the net-loss framing.
- A SUPPLEMENTARY gross-rate rule (large lanes only), for a different case the net-loss rule can't see: a LARGE lane where many VVDs get swapped out and immediately back-filled (net ~0) but the sheer gross proportion changing at once is still worth a heads-up. The archive's worst *normal* case there (excluding one known data-format artifact) was 13.3% (ANG, 15->15, fully backfilled same day).

---

### Historical Archive Worker Parsing And Storage Probe (was ~line 3310 in the app file)

#### Historical archive parsing, off the main thread where possible (2026-09-15)

WHY: parsing this archive is the single largest block of synchronous work the app does. It runs `XLSX.read` plus TWO `sheet_to_json` passes (`raw:false` for values, `raw:true` for the untouched "Record Date" — see `fetchHistoricalData` for why both are needed) over 15.9MB / 22,366 rows. One pass alone measured 8,935ms on 2026-09-15; nothing repaints for any of it. Since the archive now loads on demand, that block lands on the user's click rather than during page load, where a multi-second freeze reads as the app hanging.

WHAT CROSSES THE BOUNDARY: the worker returns `rows` plus `recordDatesRaw` — just the "Record Date" cell per row, not the whole second `raw:true` parse. That keeps a full duplicate copy of 22k x 98 cells from being structured-cloned back, and it keeps date NORMALISATION on the main thread using the app's own `normalizeRecordDate`, so there is no second copy of that logic to drift. Structured-clone of `rows` still costs main-thread time on receipt — this makes the freeze much smaller, it does not make it zero.

SEMANTICS ARE UNCHANGED ON PURPOSE: the worker calls the same SheetJS build with the same options as the inline path below, so output is identical. The CDN URL is read off the page's own `<script>` tag rather than retyped, so it cannot drift from the pinned version the app loads (deliberate security state — see the tag's own comment). Chunking `sheet_to_json` was the other option and was NOT taken: it would change how a CSV is parsed and so require AGENTS.md check 3 (date timezone safety) to be re-run, for a worse result than getting off the thread entirely.

FALLS BACK SILENTLY: Workers can be unavailable or blocked — notably the app is served inside an Apps Script HtmlService sandbox iframe whose CSP is not under our control and may refuse `blob:` workers. Every failure path (no Worker constructor, construction throw, worker onerror, importScripts failure inside the worker, or a timeout) resolves to null so the caller runs the original inline parse. A blocked worker must never turn a working feature into a broken one.

#### localStorage durability probe (2026-09-15)

THE QUESTION THIS ANSWERS: the app persists three user preferences in localStorage (`bookingFlashDarkMode` / `bookingFlashAutoRefresh` / `bookingFlashFreezePanes`). In production the app is served inside an Apps Script HtmlService sandbox iframe whose own `window.location` is a TRANSIENT `*.googleusercontent.com` URL — the code already knows this and works around it for navigation and update-detection (see `checkForAppUpdate`). localStorage is keyed by ORIGIN. If that sandbox origin is not stable between page loads, those three preferences silently reset every time and nobody would ever file a bug for it — they would just re-toggle dark mode and shrug.

Nothing in this repo had ever tested that, and it can't be tested from a dev machine: it only reproduces on the deployed `/exec` URL behind the org's Google sign-in. So instead of guessing, the app measures it on itself and reports the answer in Settings, where Kevin can read it in one look in real production.

HOW: write a marker containing the origin that wrote it. On the next load, compare:
- marker missing entirely -> storage is being cleared or is unavailable
- marker present, origin differs -> the origin rotated; prefs DO silently reset
- marker present, origin matches -> prefs persist correctly

Every access is wrapped: localStorage can THROW (not just return null) in a private window or with site data blocked, and an uncaught throw here would take the whole app down on load, which is far worse than not knowing the answer.

---

### Macro-Button Grid Restoration And Label Fix (was ~line 3536 in the app file)

Restored (2026-09-17, per Kevin): the on-page macro-button grid, alongside the Fields picker rather than instead of it — both drive the same `useFieldVisibilityPref` state, so toggling from either stays in sync with the other.

Label no longer gets a "Hide " prefix when shown/green (2026-09-24, per Adam Cosner, confirmed live on a real screenshot of the POL grid): this is a 2-column CSS grid, so a row's height is set by its TALLEST cell — "Operational Issues" already wraps to 2 lines at this grid's 9px font, and prefixing "Hide " onto it wrapped that one button to 3 lines while its row-mate ("Sector Allocation", 2 lines) stayed put, stretching via `h-full` to match and visibly warping that one row taller than every other row in the grid the moment the button was toggled on. Every other label in both grids (POL: Reefer/Activity/Op Issues/ETA/VCO Analyst; Detail: AP Status/Rotation/Trade Breakdown/Activity/Remarks/DG Volume/Sector Alloc/Op Issues/BSA/Reefer) is short enough that "Hide " never pushed it to an extra line, so this bug was invisible everywhere except this one button — exactly why it read as "layout inconsistencies" rather than a single obviously-broken button. Per Adam: dropping the "Hide " text is fine as long as the button stays green while shown — the background color (`bg-[#a9d08e]` green / `bg-[#d9d9d9]` grey) was already the primary state signal, this was always redundant with it. `title` was added so the on/off meaning isn't lost with the text gone; `aria-pressed` (already present) keeps it announced correctly to screen readers regardless.

Shared between `MacroToggleBtn` and `ApStatusMacroBtn` — both boxes are, by design, the same size/border/font treatment (see `ApStatusMacroBtn`'s own comment on "match the size and style of the other macro buttons"). Factored out so a future tweak to one can't silently diverge from the other the way two hand-typed copies of the same 13 classes could. Does NOT include either button's own state-dependent classes (background, opacity, shadow) — those still vary per component and are appended at each call site.

---

### AP Status Macro Button Styling (was ~line 3577 in the app file)

AP Frozen / AP Only, restyled to sit as the macro-button grid's own top row (2026-09-24, per Kevin: "move the AP buttons right on top of the macro box above AP Status and Rotation and match the size and style of the other macro buttons"). Presentational only, like `MacroToggleBtn` — the actual filter state (`selectedApStatuses`), isolate/multi-select click handling (`toggleFilter`) and the `isFaded` computation (`isFilterActive && !isSelected`, the same convention every `SlicerBtn` in this app uses) all still live in the main component and get passed in as props; `isFaded` itself is derived inside `ApStatusMacroBtn`, from `isSelected` + `isFilterActive`, the same way `SlicerBtn` derives its own `isFaded` internally — callers no longer compute it themselves (code review, 2026-09-25: `ApStatusMacroPair` used to recompute both the `includes()` lookup and the faded condition a second time inline for this prop).

Deliberately NOT built on `SlicerBtn`, even though the underlying click/select/fade logic is identical to it: `SlicerBtn` hardcodes its own `text-[11px]`/`m-0.5`/`px-1 py-0.5` sizing inline with no prop to override it, so reusing it here would mean fighting its classes via `extraClass` rather than actually matching `MacroToggleBtn`'s box (`p-0.5`, `text-[11px]` since 2026-09-25 — coincidentally the same size as `SlicerBtn`'s own `text-[11px]` now, per Kevin's ask to match it, but the two still don't share padding/margin/border treatment, so this still isn't a candidate for reuse — `h-full`, plain border). Own colors (`bg-[#DA9694]`/`bg-[#ffc000]`) kept as-is — unlike a real `MacroToggleBtn`'s green/grey on/off pair, these encode WHICH filter this is (the same colors this file uses elsewhere for AP Frozen/AP Only row highlighting), so switching to green/grey would lose that meaning; "match style" was read as box/border/font treatment, not color semantics that carry meaning elsewhere in the app.

The `isSelected`-driven shadow (`shadow-inner` when pressed, `shadow-md shadow-black/20` otherwise) was added 2026-09-25, code review: without it, clicking AP Frozen changed nothing about AP Frozen's own chip — only its sibling faded via `opacity-40`, which reads as "something else got selected" rather than "this one is the active filter". Every other filter chip in this app (`SlicerBtn`) already shows this exact cue for `isSelected`; this brings `ApStatusMacroBtn` in line with that convention, which is the one deliberate divergence from `MacroToggleBtn`'s plain, shadowless box — `MacroToggleBtn` doesn't need a pressed-state cue because its own on/off state is already fully encoded in its background color (green vs grey), unlike this filter chip whose color encodes WHICH status it is, not whether it's currently selected.

---

### Server Preference Availability Check And Write-Back Seeding (was ~line 3742 in the app file)

Structural-only availability check (contract section "Client write rule"). Deliberately does NOT look at `location.hostname` or any other environment sniff — a hostname check would make the test seam unreachable and silently turn the whole regression suite into a false positive (see the contract). `google.script.run` only exists inside the real Apps Script HtmlService sandbox, so this is already false on localhost/static hosting without needing to ask where the page is running.

Which preferences should be pushed UP to the server on this page's first render, and which must not be:

The three write-back effects are keyed on their preference's value, so React runs each of them once on mount as well as on every later change. Left alone that means three `google.script.run` calls on EVERY page load, each one writing a value that the server itself just supplied — three Apps Script executions per load per user to achieve nothing, and a transient failure in any of them would flip the Settings status line to 'error' when nothing is actually wrong.

But there is exactly one case where a mount write IS the point: a user who has been using this app since before server sync existed has their real choice sitting in localStorage while the server has never heard of them. If every mount write were suppressed, that choice would never migrate up, and the first time they opened the app in another browser it would silently revert to defaults — the very bug this feature exists to fix.

So: seed a key only when the server is reachable, has NO value for it, and localStorage does. This is computed once, at module scope, because it must observe localStorage BEFORE the write-back effects run — by the time an effect asks, it has already written the value itself and every key would look like it needs seeding.

---

### Historical Worker Timeout And Cancellation (was ~line 3847 in the app file)

CPU-bound phase, once we already know the worker is alive. The measured inline cost is ~14,199ms on a normal machine; this leaves multiple times that much headroom for a slow one before giving up, while still guaranteeing the promise eventually settles instead of leaving the caller (and the "Loading historical data..." UI) waiting forever on a truly hung worker. Every failure path here still resolves to null, never throws, so the inline parse stays the guaranteed fallback either way.

CANCELLATION (2026-09-16, adversarial-review fix — unbounded concurrent fetches/workers): the caller can now pass an optional `AbortSignal` as the second argument. This is how `fetchHistoricalData` actively tears down a SUPERSEDED attempt (a forced "Refresh Historical List" click, or any newly-started fetch, while a previous one is still running) instead of leaving it to run all the way to completion, or up to `HISTORICAL_WORKER_PARSE_TIMEOUT_MS`, doing wasted work while holding its own structured-clone of the CSV plus the parsed result. An `AbortSignal` was chosen over a separately-returned "cancel handle" object because the caller already creates one `AbortController` per attempt to cancel the `fetch()` itself (see `fetchHistoricalData`) — reusing its `.signal` here means ONE controller cancels both the network request and the worker for a given attempt, instead of two independent cancellation mechanisms that could drift out of sync. Aborting resolves to null, the same as every other failure path — it never rejects/throws — so this function's contract ("never throws, caller's own seq guard is what actually prevents a stale result from being committed or from falling through to the inline parse") is unchanged.

---

### Detail And POL Table Memoization (F7 Correction) (was ~line 3983 in the app file)

PERFORMANCE_REVIEW.md's original F7 assumed the Detail table renders "every row" at "well over 100k DOM nodes" and prescribed virtualization/windowing. That premise was checked against this repo's real exports and found wrong: the Detail ("Booking Flash") table renders `processedData`, which is `tableData` (defined in `FlashReportDashboard`, ~line 4600) — an aggregation of `filteredRawRows` by trade-subTrade-lane-saleWeek-vvd-vessel — with sort + rowSpan/blank-row bookkeeping layered on top, NOT the raw per-POL-leg rows. Measured against the repo's own sample exports: `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` (964 raw rows) aggregates to 434 Detail rows (~17k `<td>` at ~40 cols/row); the 9-day historical CSV (8,769 raw rows) aggregates to 463. Windowing pays off in the 5k-100k+ row range; at ~450 rows its own overhead (scroll listener, position math, a re-render per scroll frame) is net-negative, and — more importantly — it would break three things this table depends on:

1. rowSpan grouping: Trade/Sub-Trade/Lane cells span many rows (spanned/withBlanks logic above `processedData`'s return, ~line 4770 area). A window of only the visible rows makes a span incoherent unless spans are recomputed per-window, which changes what's actually rendered.
2. The auto-fit `useLayoutEffect` (measures every `[data-autofit-col]` cell to size columns) — with only a window's worth of rows in the DOM, column widths would shift as the user scrolls past rows that were never measured.
3. `tests/booking_flash_regression_tests.js`, which asserts structural invariants by reading the live DOM (e.g. a parent row's value equals the sum of its children's). Rows that were never mounted silently turn those assertions into no-ops instead of failures.

The REAL, measured symptom (W3's perf pass, PERFORMANCE_REVIEW.md's F5/F6) was re-render COST, not DOM node count: a column-resize drag on this table re-rendered every one of those ~450 rows on every animation frame, because there was no memo boundary between the table header (the only part a column-width change actually affects — widths live on `<th style>`, `<td>` cells never set their own width) and the body. `tests/perf_benchmark.js`'s DRAG scenario (targets this exact table by default — `FlashReportDashboard`'s `activeTab` initial state is 'detail') is the reproducible proxy for this; see that file's own recorded before/after numbers in its header comment.

The fix applied here is memoization, not windowing: `DetailTableRow`/`PolTableRow` are each wrapped in `React.memo` so an unrelated state change (column-resize drag, header-filter keystroke, tab switch, zoom, any of this file's other ~65 `useState` hooks) skips re-rendering rows whose own data hasn't changed, while preserving every row in the DOM — rowSpan, the auto-fit pass, and the regression suite's structural reads all keep working exactly as before because nothing is unmounted. This ONLY pays off because `row` is a genuinely stable object reference across such renders — `processedData`/`tableData` (Detail) and `polSpannedRows` (POL) are each a `useMemo` keyed on upstream data only, so a row's identity is unchanged by a render that doesn't touch that data. A `React.memo` fed a fresh object/array/inline-arrow prop every render is pure overhead (an extra shallow-compare, zero skipped renders) — see this file's own F6 comments on `SlicerBtn`/`SlicerClearBtn`/`PivotTableViewer` (~line 575 onward) for the exact anti-pattern this must not repeat. Every prop below is either a primitive (the `*Hidden` display-toggle booleans, `detailBlankRowColSpan`) or a `useCallback`'d stable function reference (`showHoverTooltip`/`hideHoverTooltip`) — do not add a prop without confirming the same holds, or the memo wrap silently becomes overhead instead of a fix.

POL Booking Flash's table shares the same "no memo boundary" defect (confirmed by W3's numbers, which found the identical unthrottled-mousemove-to-full-rerender shape on its column resizer, backed by the same `makeColResizer` factory as Detail's), so it gets the same treatment (`PolTableRow`) — with one added wrinkle: unlike Detail, this tab renders straight from `filteredRawRows` (see `tableData`'s own comment on `rfrMaxLdn` for why aggregation doesn't apply to this tab), and its sort/blank-row/rowSpan computation used to run inline in the render body on EVERY render (not even wrapped in a `useMemo`) — so a column-resize drag or filter keystroke while on this tab re-sorted and re-spanned the entire raw row set on every frame, independent of any row-level memoization. `polSpannedRows` fixes that half of the problem the same way `tableData`/`processedData` already did for Detail.

---

### Row Highlight Outline And Freeze Panes Styling (was ~line 4121 in the app file)

Outline rather than a background: nearly every `<td>` already sets its own explicit background (VMS grey, AP Frozen/AP Only colors, utilization-gap flags, etc.), which would paint straight over a `<tr>`-level background and hide it. An outline draws around the row's full bounding box in its own paint step, on top of every cell's background, so it stays visible regardless of a row's other color-coding — and doesn't compete with what those colors mean. `data-bf-highlighted` (a plain ATTRIBUTE, not a class — see the 2026-09-21 correction on `.bf-has-highlight` in `<head>` for why) is what the stylesheet's `tr[data-bf-highlighted="true"]` rule matches on to draw the outline/z-index. `relative` on className is a permanent, never-toggled utility, same reasoning as the table's own `bf-highlight-host`.

"Row Highlighting & Focus" (2026-09-15, per Kevin: "implement a visual state where all unselected rows are slightly grayed out... ensure that the user's focus remains sharply on the active data points"). The BEHAVIOUR is unchanged and still opacity-based for the same reason it always was — nearly every `<td>` here sets its own explicit background/text color (VMS grey, AP Frozen/AP Only, utilization-gap flags), and opacity composites the whole row in one step, so it fades on top of all that status coloring with no per-cell overrides. What changed on 2026-09-18 is WHERE it is expressed: the dim of every OTHER row is now a CSS rule keyed off the `<table>`'s `bf-has-highlight` class, never a per-row `anyRowHighlighted` prop. Deriving it from a prop meant the 0<->1 transition invalidated React.memo for every row at once and re-rendered the whole un-virtualized table synchronously — a measured ~41s freeze. See the stylesheet rule in `<head>` for the full post-mortem; do not reintroduce a table-wide value as a per-row prop here.

Freeze Panes (2026-09-14, per Kevin): when on, VVD is pinned to the left edge at a fixed width (so Vessel Name's own sticky offset has a known, constant value to pin against — this table's columns are otherwise fluid/auto-width, not fixed), and Vessel Name is pinned right after it. Both already carry an opaque background via `getBg('bg-[#d9e1f2]', true)`, so scrolled-under columns don't show through — no separate background needed just for freezing.

---

### POL Auto-Fit Representative Rows (was ~line 4450 in the app file)

POL auto-fit, 2026-09-25: the representative body cells are built from DATA for every row rather than read from the DOM. The table is windowed now (see `POL_VT_OVERSCAN` in `PolBookingTablePanel`), so the DOM only ever holds the ~150 rows around the scroll position; fitting a column to those would make its width depend on where you happen to be scrolled, and the table would re-fit (and jump sideways) as you scrolled.

Instead: run `polDataRowElement` — the exact function `PolTableRow` renders with — over every row (once per row set, see `polAutoFitRepsFor`), dedupe its `<td>` elements on the same (column, className, text) signature `measureAutoFitMaxWidths` uses (see that function for why that signature is exact), and only then create real DOM, for the representatives alone, in a hidden throwaway table inside the same scroll container so it inherits the same font, zoom and text-size context as the real rows. The caller measures them with `measureAutoFitMaxWidths` unchanged and removes the table in the same layout effect, before anything paints.

`polElementToDom` only has to understand what a POL row can contain: strings, numbers, fragments, and `renderSecAlloc`'s `<b>`/`<span className>` runs. It copies `className` and `data-autofit-col`, because nothing else changes how text is laid out (colours, titles and rowSpan don't). If a POL cell ever gains an inline `style` that changes its font, that needs to be copied too, or that column will be fitted too narrow. With `spans` it also copies `rowSpan`/`colSpan` — Excel export builds its POL rows with this too (see `buildExportTbody` in `PolBookingTablePanel`) and `table_to_sheet` reads those two.

---

### POL Table Mount Persistence And Windowing (was ~line 4552 in the app file)

#### Kept mounted across tab switches (2026-09-21 perf)

Extracted from an inline IIFE inside `FlashReportDashboard`'s render body so this table can stay MOUNTED (visibility toggled via CSS at the call site) instead of being fully unmounted and rebuilt every time the user switches away from and back to this tab. Measured cost this fixes (`tests/perf_highlight_benchmark.js`-style harness, real 8,769-row historical CSV, 9,232 POL rows): every switch back to this tab cost ~1.5-1.6s, EVERY time, not just the first — a full React mount + browser layout of 193,467 cells, because `{activeTab === 'pol_booking' && (...)}` destroyed and rebuilt the whole subtree on every tab-away. Confirmed NOT the already-optimized auto-fit pass (`measureAutoFitMaxWidths`/`polMeasuredWidthsRef`, see its own comment): instrumented `document.createRange` (its measuring mechanism) during a repeat switch and got zero calls.

Defined outside `FlashReportDashboard`, next to `PolTableRow`/`MemoPolTableRow`, so it gets the same "no closures — explicit props only" treatment they already have. The body is UNCHANGED from the IIFE it replaces; every name that used to be read from `FlashReportDashboard`'s closure is now a same-named prop instead, so nothing inside this function needed to change. See the call site (search `hasMountedPolTabRef`) for how this is kept mounted once visited and hidden via CSS otherwise, and why memo effectiveness does not depend on every prop being perfectly stable — staying mounted means even an "unnecessary" re-render is a cheap in-place diff, not a remount.

#### POL table windowing / "virtualization" (2026-09-25, per Kevin: "go ahead with the virtualization for the POL table")

WHY. POL Booking Flash does not aggregate (see the note above `DetailTableRow`): every raw leg is a `<tr>`, 1,398 body rows for the 964-row daily sample and 9,232 for the 9-day historical CSV (193,467 `<td>`). Every column toggle remounts the whole `<tbody>` (see `polColumnSignature` — that key is still the right call, it turns ~5,800 live-table `removeChild` calls into one), so each toggle paid a full React mount plus a style recalc and layout of the entire table. Measured before this change with a CDP trace, click -> painted: Reefer reveal 2,550ms / hide 700ms on the sample, 12,253ms / 8,416ms on the historical CSV. Nothing in React was the problem; the document was simply that big.

WHAT. Only the rows around the scroll position are mounted — the visible ones plus `POL_VT_OVERSCAN` either side — and two spacer rows stand in for everything above and below, so the scrollbar and every row's position are exactly what they would be with the full table. The `thead` stays complete (it is ~120 cells, and it carries the column widths).

Row heights are uniform, which is what makes this simple: measured on both datasets, every data row is exactly 19px and every blank group-separator row exactly 22px (sum of rows == tbody height, to the pixel). Positions are therefore prefix sums of two numbers. Those two numbers are still MEASURED at runtime (see the layout effect in the panel) rather than trusted, so a future padding or font change cannot silently skew the scroll mapping. Errors could not accumulate anyway: the spacers are sized from the same model the scroll position is mapped through, so a slightly wrong height only moves rows within the ~120-row window, never across the 9,000-row table.

rowSpan. Trade / Sub Trade / Service are rowSpan cells on the FIRST row of their group. When that first row is scrolled out of the window its spanning cell would vanish and every row below it would shift three columns left. So the first mounted row gets those cells back, spanning only the rows that are actually mounted, and a group that runs past the bottom of the window has its span clamped to it (see `vtWindowRows`).

WHAT IT COSTS, deliberately accepted:
- Browser Ctrl+F only finds rows that are mounted. The column filters are the way to search this table; Export to Excel still exports every row (see `exportToExcel`).
- A text selection can only cover mounted rows. Mitigated for the two common shapes: while the mouse is held down in the body (drag-select, with auto-scroll) or a non-empty selection touches the body, the window only GROWS as you scroll and never drops a row, so the selection's ends stay in the document. A shift+click from a plain click far above, after wheel-scrolling, still starts from the window's top.

Nothing that must see every row reads it from the DOM any more: Excel export builds the body from data (`buildExportTbody`), and so does the auto-fit pass (`collectPolAutoFitCells`). The regression suite, which does assert over rendered rows, renders every row on request via the panel's `renderAllRows` prop (the `bookingflash:pol-render-all` window event).

---

### Filter Persistence Design (was ~line 5318 in the app file)

Filter persistence (2026-09-24, per Kevin: port the filter-saving feature from the 1.67_TESTING branch's `ViewPrefsStore`). Deliberately scoped down from that branch's version: 1.67 persisted a much larger blob — 12 column-visibility booleans, zoom, text size, active tab, and column widths, alongside the filters themselves — but this app's own column-visibility system has since moved to `FIELD_TOGGLES`/`useFieldVisibilityPref`, a different, incompatible shape from 1.67's twelve individual booleans. Porting that half verbatim would either fight the current system for the same on-screen state or silently duplicate it. So this only persists what "filter-saving" literally names: the slicers/filters themselves, plus `topPanelCollapsed`, which has to travel with them — a restored filter set with the slicer panel collapsed would be invisible, with nothing on screen to explain why the table looks filtered.

Same single-blob-behind-an-adapter design as this file's other persistence layers (see `resolveUserPref`/`SERVER_PREFS`) for the same reason: today's backend is localStorage, but a later per-Google-account backend (PropertiesService via `google.script.run`, as `SERVER_PREFS` already does for the three simple booleans) is an async network round trip, and one blob is one round trip each way instead of eleven.

`hydrate()`/`readSync()` are split the same way too: `hydrate()` is awaited exactly once, at the `root.render` call at the bottom of this file, before the app ever mounts. Every in-component call site (`restoredFilterValue('x')` inside a `useState` initializer) is then a synchronous read of an already-resolved in-memory object.

---

### Click-To-Highlight Row Design (was ~line 5768 in the app file)

Click-to-highlight rows (2026-09-14, per Kevin: "add the ability to click>highlight a row (without losing the ability to copy individual values directly from the report)"). Stores the Set of highlighted row `id`s rather than a per-row boolean on the row objects themselves, so it stays outside `processedData`/`tableData`'s own memoization and never invalidates it.

Deliberately NOT trying to survive a background data refresh: `row.id` (see where it's assigned, `id: index + 1`) is this CSV snapshot's row position, not a stable identity for "the same real sailing leg" across refreshes — a poll that adds/removes/reorders rows (which schedule-change refreshes routinely do, see this file's `diffScheduleChange`) can leave a stored id pointing at a different row than the one the user actually clicked, or at nothing. Scoping this to "mark a row while I'm reading across it right now" avoids that: on `FlashReportDashboard`'s own refresh paths (`checkForUpdates`/`applyDataUpdate`) nothing here needs to be, or is, reconciled — a highlight just silently stops matching after a refresh the same way it would if you'd drawn on a printout that got replaced. If this needs to survive refreshes later, that's a real design task (a content-based leg key, e.g. vvd+pol), not a quick add here.

Passed into `DetailTableRow`/`PolTableRow` as a per-row PRIMITIVE boolean (`isRowHighlighted={highlightedRowIds.has(row.id)}` at each row's own `map()` call, not the Set itself) — see the big comment above `DetailTableRow` on why these rows are React.memo'd: handing every row a shared prop whose *reference* changes on every toggle (the Set) would fail every row's memo shallow-compare on every single click and reintroduce the exact full-table-rerender regression that comment describes. A primitive only differs, and so only forces a re-render, for the one row whose own highlight actually flipped.

---

### Highlighting Must Not Move The Page (2026-10-02; pointers in the masthead, the highlight pill and the table-height effect)

Reported by Kevin with two screenshots, one before and one after highlighting rows: "Why is it moving everything around when highlighting?". Two defects, one trigger, both reproduced with measurements before anything was changed.

**1. The masthead wrapped.** Clear Highlights and Report Card were buttons in the masthead's right-hand cluster, hidden (`display: none`) until the first highlight. Showing them added ~260px to a `flex-wrap` row. At ordinary window widths there was no longer room beside the logo and title, so the whole cluster dropped to a second line of its own and everything below (slicers, table) moved down by that line's height: 49px to 91px measured at 1500px and 1400px wide, ~46px in Kevin's screenshots, where the Settings button was already clipped at the right edge, i.e. the row had no slack at all. It happens at any width where the row is within ~260px of full, and more than once at narrow widths (91px to 137px at 1200px and below).

**2. The table kept a stale max-height.** The table's `maxHeight` is `window.innerHeight - tableTop - 16`, recomputed by the `tableAreaMaxHeight` effect when the tab, zoom, text size, data or Hide Filters changes, or when its `ResizeObserver` fires. That observer watched `activeTabContentRef`, a box that sits *below* the masthead: when the masthead grew, that box moved down but kept its size, so nothing fired. Measured: `maxHeight` stayed `544.576px` while the table's top moved 433 to 475, so its bottom ran 26px past the window, taking the horizontal scrollbar with it, and the page grew its own vertical scrollbar. (The same class of bug had been fixed once before for the Hide Filters toggle, see that effect's `topPanelCollapsed` comment, but the masthead was never covered.)

**What it was not.** The highlight itself moves nothing: the pink ring is a CSS `outline` on the `<tr>` (outlines take no layout space, unlike borders), the dimming is an `::after` overlay (`position: absolute; inset: 0`), and row height measured 19px before and after.

**The fix.**
- **A: the two buttons moved into the floating highlight pill** (`data-bf-highlight-pill`, `position: fixed`, bottom right), which cannot take space in the page flow. It is now a container with an "N highlighted" label, a Report Card button (`data-bf-report-card`, still only on Detail and POL Booking Flash) and a Clear button (`data-bf-clear-highlights`). Only Clear clears now; the whole pill used to be one button. The pill keeps the mounted-from-first-render-and-hidden-via-`style` pattern from 2026-09-21 (a conditional mount cost 150-235ms at the first highlight in Tailwind's MutationObserver), and its comment now carries that full write-up, which used to live on the masthead button. Do not put anything back in the masthead that appears only after a user action.
- **C: the table-height effect also observes the masthead** (`mastheadRef`), the element whose size actually changes, so a wrap from any cause (the Notes button appearing after its async check, a long Last Refresh, a narrower window) re-fits the table. Banners *above* the masthead are not observed; they were not before either.

**Tests** (Booking_Flash suite, 4 checks) pass at any window size: they pin the masthead to the exact width of its contents so anything that appears in it must wrap, and fake a taller `window.innerHeight` so the table is out of the 300px floor of its max-height formula (in the headless runner's 1280x720 window the table is *inside* that floor, where "follows the masthead" and "is clamped" cannot be told apart). They were run against the pre-fix app and fail there. `tests/perf_highlight_benchmark.js` finds the Clear button by `data-bf-clear-highlights` instead of by its old "Clear Highlights" label.

---

### Detail Freeze Panes And Storage Probe Timing Fix (was ~line 5833 in the app file)

**2026-10-01 final update:** per Kevin ("we want VSL OPR and not VSL Owner"), the column after Vessel Name is **VSL OPR** (`vslOpr`, aliases `VSL OPR` / `VSL Operator` / `Vessel Operator`), not VSL Owner. Same position, same not-pinned behavior; read every "VSL Owner" below as VSL OPR.

**2026-10-01 later update (supersedes the next paragraph's column order):** per Kevin, the order is now Trade, Sub Trade, Lane, Sales Week, PIC, 1st POL Cutoff, ETD Last Port, Status, VVD, Vessel Name, VSL Owner (POL: Trade, Sub Trade, Service, Sales Week, Coastal ETD, Port Cut, Status, VVD, Vessel Name, VSL Owner, POL), i.e. the original pre-2026-09-30 layout plus VSL Owner after Vessel Name; VSL OPR was dropped ("we don't need Operator"). Freeze Panes still pins Trade, Sub Trade, Lane, VVD and Vessel Name at 0/75/150/225/320px: the unpinned Sales Week..Status scroll away under the pinned trade columns, then VVD + Vessel Name stick beside Lane, and VSL Owner scrolls. While frozen, spacer rows split their blank into the unpinned lead columns (count varies with the PIC/Status toggles), one `colSpan={2}` cell over VVD + Vessel Name pinned at 225px, and the rest. **POL header fix:** POL's `<th>`s have no background of their own (the `<thead>` paints `#333333`), so its pinned header cells were transparent and scrolled header labels showed through them ("Status" over "Trade"), present since POL got Freeze on 2026-09-30; `POL_FREEZE_TH_STYLE` now carries `backgroundColor: '#333333'`. Detail's thead gives every `<th>` a background, so it never had this. The position-only `checkFreezePins` could not see it; it was caught from a screenshot.

**2026-10-01 update (supersedes the 2026-09-30 one below):** per Kevin, Trade / Sub Trade / Lane (POL: Service) are back at the FRONT of both Booking Flash and POL Booking Flash, followed by VVD, the new VSL Owner and VSL OPR columns, then Vessel Name. Freeze Panes pins Trade, Sub Trade, Lane, VVD and Vessel Name. **VSL Owner/OPR are deliberately NOT pinned** (Kevin: "We don't want Owner/OPR to be part of the frozen panels"): they scroll away under the pinned VVD, and Vessel Name, which sits after them, then sticks at `left: 320px` right beside VVD; that is plain `position: sticky` behaviour, no extra code. While frozen, each spacer row splits its blank over VVD..Vessel Name into three cells (pinned VVD part, unpinned `colSpan={2}` Owner/OPR part, pinned Vessel part, `FREEZE_SPACER_SPAN` = 4 columns), so the pinned area never carries a grey block wider than the pinned columns. Adding the two columns also bumped both hand-counted column totals (`DETAIL_BASE_COLUMN_COUNT` 18 -> 20, POL `visibleColCount` base 8+11 -> 10+11); without that, every spacer row would come up two cells short. The rest of this paragraph describes the five pinned columns: everything left of the split, as Excel's freeze does. Pinning only VVD/Vessel behind the trade columns would bring back the exact "doesn't seem to work" symptom of 2026-09-30 (they only lock after the leading columns scroll away). The widths and offsets live in one place, `FREEZE_LAYOUT` (just above `DetailTableRow`), shared by both tables' body cells, header cells and spacer rows: Trade/Sub Trade/Lane fixed at 75px each and VVD at 95px while frozen, so the offsets are 0/75/150/225/320px; Vessel Name keeps its natural width and carries the edge shadow. The trade values in the real data are 2-3 characters (LAT, LN, AN2), so 75px loses nothing. The rowSpan'd trade cells are sticky too; Chrome pins a rowSpan'd `<td>` horizontally like any other. Spacer rows split their blank (as above) ONLY while frozen; unfrozen they render the original single blank cell, and Excel export always builds them unfrozen. `checkFreezePins` in the regression suite asserts all five offsets on the header, on a group's first row (with the trade cells) and on a later row (without them), and that VSL Owner/OPR have scrolled away.

**2026-09-30 update:** VVD + Vessel Name are now the FIRST two columns on both Booking Flash and POL Booking Flash, and POL has Freeze Panes too (`POL_FREEZE_*` constants beside `polDataRowElement`). Before this they sat behind eight columns, so Freeze only locked them after ~660px of scrolling while Trade/Lane scrolled away, which read as broken. The rowSpan'd Trade/Sub/Lane cells now come after them: the browser skips a merged cell's occupied slots on a group's later rows, so the columns still line up, and both spacer-row components lead with one `colSpan={2}` cell (pinned too) so they stay aligned. Checked by `checkFreezePins` in the regression suite.

Freeze Panes (2026-09-14, per Kevin: "can we add something like 'freeze pane' option like excel") — pins the VVD and Vessel Name columns to the left edge of the Detail tab's table while it's scrolled horizontally, the same way the header row is already pinned while scrolling vertically (see `sticky top-0` on that table's `<thead>`). Scoped to Detail only for now (the tab the report came in on) — POL Booking Flash's table could get the same treatment later if wanted. Persisted like `autoRefreshEnabled`/`darkMode` so the choice survives a reload; defaults to OFF (Excel's own freeze panes are opt-in too, and this changes the table's layout, unlike Auto-Refresh which changes no visuals).

Run the localStorage durability probe once per page load. This USED to be a lazy `useState` initialiser (`useState(() => readStorageProbe())`), which looks idiomatic but is a real bug: `readStorageProbe` WRITES to localStorage (it's how the probe works — see its own comment), and a lazy initialiser runs during React's render phase. Render is supposed to be side-effect-free — React may invoke it more than once for the same commit (Strict Mode's intentional double-invoke in dev, or a future concurrent-rendering scenario), and every one of those extra invocations would bump the probe's own `loads` counter and overwrite `bookingFlashStorageProbe` an extra time even though the component only actually mounted once. That corrupts the exact number (`describeStorageProbe`'s "(${p.loads} loads on this browser)") this probe exists to report accurately in production.

Fixed by moving the write into a `useEffect` with an empty dependency array — effects are guaranteed to run exactly once per real mount (Strict Mode's dev-only double-invoke of effects fires cleanup in between, which this has none of, so it's still a net no-op here) — and reading the probe with plain `useState(null)` so the render itself stays pure. The Settings UI already guards on `storageProbe &&`, so the one frame before the effect runs (`storageProbe === null`) renders nothing extra, identical to what a user would see today (the real read/write still happens before the user can open Settings and look). The origin-comparison logic inside `readStorageProbe` is untouched — only when it's called moved.

---

### Draggable Popup Header Drag Implementation (was ~line 5887 in the app file)

Generic drag-by-header helper (2026-09-09, per Kevin: "make all the pop up windows draggable ... same behavior as the analyze tab") — same window-mousemove/mouseup pattern as the column-resize handles elsewhere in this file (see `startColResize`/`makeColResizer`), factored out here so every draggable popup/modal (Analyze, Historical Data, Settings) shares one implementation instead of three near-identical copies. Closures over the drag's start point and the panel's position at drag-start, rather than a separate `isDragging` state, since nothing else needs to know mid-drag. Returns a ready-to-use `onMouseDown` handler for the caller's draggable header bar.

Direct-DOM drag (2026-09-10 perf pass, F5): this used to call `setPos` on every 'mousemove' event, and `setPos` lives on `FlashReportDashboard` — the ROOT component, with 70 `useState` hooks and the entire un-virtualized detail table below it — so every pixel of dragging any of these three popups re-rendered the whole app. Per the perf review's own suggestion for this exact site: write the CSS transform straight onto the dragged box's DOM node during the drag, and only commit to React state once, on mouseup. All three call sites share one DOM shape (a `style={{transform:...}}` box whose direct first child is the `onMouseDown={startXDrag}` header bar — see `analysisModalPos`/`historicalDataPos`/`displaySettingsPos`), so `e.currentTarget.parentElement` reliably finds that box without threading an extra ref through each of the three usages. No rAF batching needed here (unlike the column-resize handlers elsewhere in this file): `transform` is a compositor-only property, so writing it on every raw mousemove doesn't force layout/reflow the way a width or React re-render would — the browser already coalesces the paint. The final on-screen position and the eventual `setPos` value are identical either way; this only removes React from the drag loop itself.

---

### Fields Picker Trigger Placement (was ~line 6559 in the app file)

The "⚙ Fields" trigger, rendered from ONE place but mounted in one of three (2026-09-25, per Kevin: "can we move this button menu to above the macro buttons?"): at the top of the macro-button column whenever that column is on screen, in the tab-bar row when "Grid: In Fields" has removed that column, or in the tab-bar row when the filter panel itself is collapsed. The three call sites' conditions partition the same space and so are mutually exclusive by construction: `topPanelCollapsed` is the outer split, and within `!topPanelCollapsed`, `macroButtonsInFieldsOnly` true/false is the inner split — search `showFieldsTriggerCollapsed` for the three sites' shared definitions, computed together above `fieldPickerPinned`'s own `useState` — so exactly one copy is ever mounted and `fieldPickerBtnRef` always points at the visible one — `anchorFieldPicker` reads the popover's position off it, and the regression suite finds it by `[data-field-picker-trigger]`.

Why a fallback at all: "Grid: In Fields" (`macroButtonsInFieldsOnly`) removes the whole macro column, and the Fields picker is then the ONLY way to reach those toggles — a Fields button that lived solely in that column would vanish exactly when it is needed most, stranding every hidden field.

A function, not a JSX const, so it reads the state it closes over at render time wherever it is called; `extraClass` carries the only per-site difference (full-width inside the 240px column).

---

### App Update Banner Detection Design (was ~line 6601 in the app file)

New-app-version banner (2026-09-10, per Kevin: "is there an alert we can send out when the app has been updated ... for people to refresh their page or force a refresh?"). This app has no build step and no service worker, so there's no framework-level "new version" signal to hook into — the only way to know the deployed HTML itself changed underneath an already-open tab is to periodically re-check for a change and compare it against what was last observed (see the poll effect, right alongside the CSV/sector polls).

Deliberately NOT a hand-maintained version number/build id: no discipline required on every future edit ("don't forget to bump the version const" is exactly the class of thing that's already gone stale once in this repo — see AGENTS.md's file-pointer note), and it catches literally any shipped change, not just ones someone remembered to tag.

The check itself is computed fresh (a content hash, either server- or client-side depending on deploy path — see `checkForAppUpdate`'s own comment) rather than diffing full raw HTML, for two independent reasons:

1. 2026-09-10 bug report from Kevin — on the Google Apps Script Web App deploy path (`apps-script/`), this page runs inside Apps Script's sandboxed iframe, whose own `window.location` is a transient `*.googleusercontent.com` URL that is NEITHER the real page the user opened NOR guaranteed byte-stable across requests, so a raw full-HTML diff against it fired a false "new version" on almost every single poll (this was symptom 2 of that report — see `checkForAppUpdate`/`forceAppReload`'s comments for the full root-cause chain and symptom 1, the accompanying blank-page-on-refresh bug).
2. Even outside that specific sandbox, an unknown host could inject its own per-request noise into the response (an analytics snippet, a proxy timestamp) that would cause the same false positive.

`appHtmlBaselineRef` stores a short fingerprint (a server-computed hex hash on the Apps Script path, or a cheap client-computed hash of just the app's own payload elsewhere), not the ~500KB page text.

---

### Schedule Change Warning: Full Details Popup (was ~line 6642 in the app file)

Added 2026-09-09, per Kevin. The schedule-change warning banner's own `summaryLines` are deliberately just counts plus a truncated VVD/lane list (see `diffScheduleChange`'s own comment). This popup is the itemized "what it actually was, what it actually became" view for every VVD the diff touched, shown on demand rather than always rendered inline.

It uses the same draggable / click-through-backdrop / explicit-close-only popup pattern as Analyze, Historical Data, and Settings elsewhere in the app (see `makeDragHandler`'s own comment) -- for the same reason: it can be moved aside while cross-checking against the live table underneath.

It deliberately does NOT carry its own `open && data` guard on `scheduleChangeWarning`. Instead it's rendered as `scheduleChangeDetailOpen && scheduleChangeWarning &&` at the render site itself, so if the warning is dismissed (or superseded by a new, non-significant refresh) while this popup is open, it disappears for free with no extra effect needed.

**Ordering hazard:** this block MUST live after `scheduleChangeWarning`'s own `useState` declaration just above it -- the same class of bug as the `historicalDataOpen` Escape-handler note elsewhere in this file. Placing this block (or just the `useMemo`'s dependency array) BEFORE that declaration would read it while still in Babel Standalone's var-hoisted pre-assignment state (`undefined`, not a TDZ crash), so `scheduleChangeFlipsByVvd` would silently compute `[]` forever regardless of the real data. This was confirmed live: the exact mistake was made and caught before shipping -- the "Flipped sailings" section silently never rendered while "Removed sailings" (which doesn't go through this `useMemo`) rendered fine, with zero console/page errors either way.

---

### CSV Apply Sequencing (csvApplySeqRef) (was ~line 6705 in the app file)

Added 2026-09-1x (W11 follow-up -- a general request-sequencing guard, per Kevin's approval of the architectural proposal deferred in the original W11 audit).

**Why this was needed.** Three narrow fixes elsewhere in the file each closed one concrete, reproduced interleaving bug: `hasLoadedDataRef` in the initial-mount effect, the `viewingHistoricalDate` staging branch in `handleManualRefresh`, and `applyPendingUpdate`'s try/catch. But they don't compose with each other: a manual "Refresh Now" click (`handleManualRefresh`, with `viewingHistoricalDate` NOT set) still calls `applyCsvText()` with no ordering check at all, so its own slow, still-in-flight fetch can resolve AFTER an independent background poll has already staged-and-auto-applied a FRESHER result (via `applyPendingUpdate`), silently overwriting that fresher data. None of the three narrow guards are aware of each other's in-flight state, so this interleaving slips through all of them.

**The mechanism.** `csvApplySeqRef` is a single monotonically-increasing ticket counter shared by every function that can eventually commit fetched CSV text into `rawRows`: the initial-mount effect, the background poll (`checkForUpdates`), `handleManualRefresh`, and `applyPendingUpdate` (plus `processFile`'s manual-upload commit -- see its own comment). Each claims a ticket via `const mySeq = ++csvApplySeqRef.current;` at the moment it STARTS its own attempt (before its own `await fetchCsvText()` -- or, for `applyPendingUpdate`, which fetches nothing itself, inherited from whichever earlier fetch staged the pending text, via `pendingCsvTextSeqRef`).

Immediately before actually calling `applyCsvText()` to commit, each site re-checks `mySeq === csvApplySeqRef.current`: if some OTHER attempt has since claimed a LATER ticket -- whether or not that later attempt has even finished yet -- this one's result is stale by definition and it backs off without committing, silently and harmlessly. This is "last INITIATED wins, as long as nothing even newer has started since," deliberately NOT "last RESOLVED wins" -- the exact bug being fixed is a slow, EARLIER-started fetch resolving LATER and beating a faster, LATER-started one that already committed.

`pendingCsvTextSeqRef` remembers which ticket the currently-staged "New data available" payload belongs to. This matters because staged text can sit for minutes (the user has to notice the banner, or return from Historical View before it can apply) -- if an EVEN NEWER ticket commits directly in the meantime, the staged payload is stale relative to what's already on screen, and `applyPendingUpdate` must recognize that and quietly clear the stale banner instead of clobbering data that already landed.

**What this deliberately does NOT replace** (each answers a different question the ticket counter cannot; kept exactly as before, verified live):
- `hasLoadedDataRef` ("has ANY commit landed yet, from ANY path") stays unchanged in the initial-mount effect and `checkForUpdates`. A manual file upload (`processFile`) doesn't fetch a URL at all, so on its own it wouldn't claim a `csvApplySeqRef` ticket the normal way -- without `hasLoadedDataRef`, a still-in-flight initial/poll CSV fetch could still pass ITS OWN seq check trivially and overwrite a freshly manually-uploaded file. Extended (not duplicated): `processFile`'s own successful commit now ALSO bumps `csvApplySeqRef`, so a manual upload retroactively invalidates any CSV-pipeline ticket that hasn't committed yet -- closing the same gap for `handleManualRefresh` too, which doesn't consult `hasLoadedDataRef` at all.
- The `!viewingHistoricalDate` guards (on the auto-apply effect, and `handleManualRefresh`'s staging branch) stay unchanged. They answer "is the user deliberately looking at a frozen snapshot right now," a UI-mode question the ticket counter says nothing about -- the counter only decides which fetch's DATA wins once a commit is about to happen; it never decides whether a commit should happen at all while historical/compare mode is active.
- The `cancelled` flag in the initial-mount effect stays unchanged. It guards a different failure mode (writing to state after this component has UNMOUNTED) that a ticket number says nothing about -- a stale ticket can still belong to a component that is very much still mounted.
- `applyPendingUpdate`'s try/catch (the blank-page-crash fix) stays unchanged and simply runs after the seq check -- no point parsing a payload about to be discarded anyway, no functional change to the crash fix itself either way.

**Separate counters, deliberately not folded in.** `sectorApplySeqRef` and `historicalApplySeqRef` are separate, independent counters for `fetchAndApplySectorData` (commits `setSectorSourceRows`) and `fetchHistoricalData` (commits `setHistoricalRowsByDate`/`setHistoricalDates`) -- each writes to its OWN distinct state slot, so folding either into `csvApplySeqRef` would incorrectly invalidate in-flight CSV-pipeline tickets on an unrelated sector/historical fetch, and vice versa. `fetchAndApplySectorData` is called from three independent sites with no ordering today (the initial-mount effect, its own poll interval, and `handleManualRefresh`'s fire-and-forget call) -- the same shape as the CSV race, flagged but not yet reproduced with a concrete stale-overwrite (no cheap ordering-sensitive field to observe). `fetchHistoricalData` has the same shape across ITS three call sites (mount, every `historicalDataOpen` toggle-to-true, and the "Refresh Historical List" button) -- rapidly opening/closing the popover can fire overlapping fetches with no guard today.

---

### getVal() Alias Resolution Precomputation (was ~line 7104 in the app file)

Perf fix, 2026-09-10 (F1). `getVal()`'s alias-to-column resolution used to be redone from scratch on EVERY row -- rebuilding a lower-cased/stripped "cleanRow" copy of the whole row (~98 regex replaces) and re-running the two-pass alias scan (~84 fields x 2-4 aliases each, each re-cleaned with its own regex, plus an O(header count) substring scan on the fallback pass) even though the header names are identical on every row. Against the real ~27k-row export that's on the order of 8 million regex allocations per load.

The header schema IS constant across the whole sheet (`sheet_to_json` is called with `defval:''`, so every row object carries the exact same set of keys as `rawData[0]` -- the same assumption the `CRITICAL_COLUMNS` check already makes by reading only `rawData[0]`'s keys). That means the alias-to-column resolution can be computed ONCE per parse instead of once per row -- but NOT collapsed further into "one real column per field," because `getVal()`'s row-level behavior is blank-cell-dependent: pass 1 skips an exact-match column when THIS ROW's value is `''` and falls through to the next alias, and pass 2 (substring fallback) can resolve to yet another column.

So what gets precomputed per field is an ORDERED CANDIDATE LIST of real column keys: exact-match candidates first (in alias order), then substring-fallback candidates (in alias order, honoring the same `length < 3` guard and "first cleanRowKeys entry that CONTAINS the alias" semantics -- INCLUDING the Class E landmine behavior `tests/check_alias_landmines.py` guards against; this is a faithful replay of the existing two-pass algorithm, not a new one). Then, per row, the code walks that short list and returns the first non-blank value. Zero regex and zero O(header count) scans inside the row loop.

---

### Historical Archive Parse: Yield Before Freeze (was ~line 7686 in the app file)

`XLSX.read` + `sheet_to_json` over the historical archive is ~14,199ms of SYNCHRONOUS main-thread work (15.9MB / 22,366 rows, both `sheet_to_json` passes included -- measured 2026-09-15 by sampling main-thread responsiveness during a real archive load). An earlier "~8,935ms"/"~9s" figure quoted in this comment only ever timed ONE of the two passes and was corrected 2026-09-16 -- see `HISTORICAL_REFETCH_WINDOW_MS`'s own comment for the same correction. Nothing can repaint while it runs.

Until 2026-09-15 that block happened during page load; now that the archive loads on demand it happens when the user clicks "Historical Data," where an unannounced ~14s freeze reads as the app hanging (the popover's own close button stops responding, tabs can't be switched, and the browser can raise "page unresponsive").

Without the yield, React has batched the popover-open state change but the browser may not have painted it yet, so the user can be left staring at a frozen pre-open frame with no "Loading..." text at all. A double `requestAnimationFrame` (paint scheduled -> paint committed) guarantees the loading message is actually on screen before the thread locks up. `setTimeout` is the fallback for a backgrounded tab, where rAF never fires.

**Be clear about what this does and doesn't fix:** the ~14s block is still there and the UI is still unresponsive for its duration (this is also why the Worker path is tried first -- see `parseHistoricalArchiveInWorker` -- this yield only helps the INLINE fallback path actually taken). This only guarantees the user sees an explanation first. Actually REMOVING the freeze means getting the parse off the main thread (a Web Worker -- SheetJS runs in one, loaded from the same pinned CDN URL) or chunking `sheet_to_json` by row range. Both are real changes that need their own verification -- chunking in particular alters how a CSV gets parsed and so would require AGENTS.md check 3 (date timezone safety) to be re-run.

---

### Historical Data Popover Refetch On Open (was ~line 7869 in the app file)

2026-09-08, per Kevin: he opened the Historical Data popover wanting to compare "yesterday to today" and today wasn't offered as a date -- confirmed live that today's row DID exist in `HISTORICAL_DATA_CSV_URL`'s archive (Hoa's daily append had already run), so this wasn't a missing-data problem.

Root cause: `fetchHistoricalData` only ever ran once, on page mount -- if the page had been open since before that day's append ran (or was just open a while), the date list goes stale and nothing re-fetches it except the manual "Refresh Historical List" button, which is easy to not think to click. (That mount effect is gone as of 2026-09-15, so this open-popover effect is now the ONLY thing that populates the date list, first open included, not just the thing that keeps it fresh.)

Both "View a Date" and "Compare Two Dates" already read from the exact same `historicalDates` array (they share a render block further down), so this wasn't a Compare-specific gap either -- View a Date would have shown the same stale list, it just wasn't the mode being tested that day.

Fix: re-fetch every time the popover is opened (not just on mount), so the common case -- open the popover, want today -- works without an extra manual click; the button stays for a mid-session refresh while the popover is already open.

Note this comment used to describe the fetch as "cheap (one CSV fetch)" -- it isn't. That fetch is the whole 6.5MB+ archive plus a full parse of it, on EVERY open. Hence `HISTORICAL_REFETCH_WINDOW_MS`, which keeps this effect's freshness intent while collapsing a burst of opens into one fetch.

---

### CSV Date Timezone Off-By-One Fix (was ~line 7980 in the app file)

2026-09-08, per Kevin: "1st POL Cutoff"/"ETD Last Port" (and any other ISO-shaped date column pulled from the live CSV) were rendering exactly one day EARLIER than the real date, on every lane, every row.

Root cause: SheetJS's default CSV parser auto-detects an ISO-shaped cell (e.g. "2026-08-16") as a date, converts it via an internal `Date` object anchored to UTC midnight, then formats that Date's LOCAL calendar day for its `w` (displayed text) property. In any timezone behind UTC -- every North American one included -- that local day is the PREVIOUS day, so the app's `getVal()` receives an already-wrong "8/15/26" for a real "2026-08-16" cell before `formatDate`/`parseKnownDate` (which are themselves timezone-safe -- pure regex/arithmetic, no `Date` object) ever see it.

Confirmed empirically: reproduced the exact off-by-one under America/New_York and America/Los_Angeles (0 under UTC, which is why this was never caught testing in a UTC sandbox), and confirmed it's isolated to ISO-shaped cells specifically -- plain numbers, comma-formatted numbers, percentages, blanks, and the year-less "Mon D" date shape all came through byte-for-byte identical either way.

Fix: pass `raw: true` to `XLSX.read` ITSELF (not just `sheet_to_json`) -- this makes SheetJS's CSV parser keep every cell as its literal original text, never auto-promoting an ISO-shaped one to a date type at all, so the buggy Date-object round-trip simply never happens. This app's own `getVal()`/`formatDate()`/`parseKnownDate()` already parse a raw ISO string correctly (that's the FIRST branch `parseKnownDate` tries), so nothing else needed to change -- this was purely a SheetJS-internal conversion this app never asked for and had no way to see happening.

See AGENTS.md's required check 3 (date timezone-safety check) and DATA_ARCHITECTURE.md's Class F for the regression test that guards this.

---

### Initial Load vs Background Poll Race Guard (was ~line 8100 in the app file)

2026-09-10 (W11 data-ingestion audit). A slow/stalled connection on the very first load can cause the initial CSV fetch to resolve well after the 10-minute background poll's own first tick already completed the bootstrap load instead -- `checkForUpdates` below has its own `if (!hasLoadedDataRef.current) applyCsvText(csvText)` branch for exactly that "poll wins the race to load first" scenario, but until this fix, this side of the same race had no equivalent check: it always called `applyCsvText` unconditionally once its own fetch resolved, no matter how late.

Confirmed live (Playwright: this fetch mocked to resolve slower than the poll's first tick, both serving different content) that the late-resolving initial fetch silently overwrote the ALREADY-DISPLAYED, ALREADY-NEWER data the poll had just applied -- with `setLastRefresh(new Date())` inside `applyCsvText` even stamping "Last Refresh" to "just now" despite the content going backward in time. The stale data then sat on screen, with zero on-screen indication anything was wrong, until the NEXT poll tick happened to notice its own fetch differed from what got clobbered in -- up to a full `POLL_INTERVAL_MS` (10 minutes in production) of silently-wrong data.

Fix: reuse `hasLoadedDataRef` the exact same way `checkForUpdates` already does -- if a load already completed from ANY path by the time this one resolves, this slower/older result has nothing to contribute, so back off instead of clobbering something newer. Kept alongside (not replaced by) the seq check documented under "CSV Apply Sequencing (csvApplySeqRef)" -- see that entry for why a manual file upload specifically needs this `hasLoadedDataRef` check too, not just the seq one.

---

### App Update Deploy-Path Detection (was ~line 8215 in the app file)

`window.__EXEC_URL__` / `isFramedForAppUpdate`: deploy-path detection shared by the app-update poll effect below and the banner's render block (near `appUpdateAvailable`'s other comment).

`window.__EXEC_URL__` is injected by `apps-script/Code.gs` (see its own comment) ONLY when this file is served through the Apps Script Web App path AND that deployment has been updated to include the injection. It holds the real, stable "/exec" URL the user actually opened -- something this script cannot otherwise discover, because on that deploy path `window.location` here is a transient `*.googleusercontent.com` sandbox URL, not the real page (Kevin's 2026-09-10 report, both symptoms: the phantom "new version" nag came from diffing that unstable URL's content, and the blank-page-on-refresh hang came from navigating it). It's undefined on every other deploy path (local dev, plain static hosting) and on an Apps Script deployment that hasn't picked up the `Code.gs` update yet.

`isFramedForAppUpdate` catches "running inside some iframe" generically (true for the Apps Script sandbox, but this also protects against any other unknown embed) -- computed once since neither framing nor the injected global can change over the life of a loaded page. The `window.top` read is wrapped in try/catch: reading it can throw cross-origin in a heavily sandboxed context, and "throws" is exactly the signal that we're framed and cannot trust our own URL, so it's treated the same as "yes, framed."

---

### App Update Poll: Branches And Instability Guard (was ~line 8244 in the app file)

App-update poll (see `appUpdateAvailable`'s own comment above). Runs unconditionally -- unlike the CSV/sector polls this doesn't depend on any `isXCsvSourceConfigured()` gate, since it only needs a check endpoint to be reachable, true regardless of whether a live data source is set up. Uses its own `APP_UPDATE_POLL_INTERVAL_MS` rather than `POLL_INTERVAL_MS` (see that constant's own comment for why the two are kept independent).

Three deploy-path branches (see `execUrlForAppUpdate`/`isFramedForAppUpdate` above), all funneling into the same baseline-ref/threshold bookkeeping:
- **A. `execUrlForAppUpdate` present** (Apps Script, redeployed Code.gs) -- poll `${execUrl}?check=version`, a tiny server-computed content hash of `index.html`'s real bytes. Cheapest and most reliable: it never touches the sandbox's own unstable URL at all.
- **B. `isFramedForAppUpdate` true but no execUrl** (an OLD Apps Script deployment that hasn't picked up the Code.gs fix yet, or some other unknown iframe embed) -- there is no reliable signal available, so this warns once and does nothing further, rather than repeating the original bug of fetching/diffing our own (sandboxed/unrepresentative) URL.
- **C. Not framed** (local dev server, plain static hosting) -- our own `window.location` genuinely is the real page, so fetch it and diff, but only the app's own `<script type="text/babel">` payload rather than the full response, so per-request scaffolding an unknown host might inject (an analytics tag, a proxy-stamped timestamp) doesn't register as a false "update." Hashed rather than kept as a ~500KB string (also sidesteps `crypto.subtle`'s secure-context requirement, so this still works on a plain-http internal host, not just https/localhost).

**Self-disabling instability guard (all branches):** this is the single most important defense here, because it makes the feature fail safe on ANY deploy path we haven't specifically diagnosed, not just the confirmed Apps Script one. If the signal changes (or fails) on `UNSTABLE_THRESHOLD`-many CONSECUTIVE polls, that's far more consistent with an untrustworthy source (per-request variance, a persistent CORS/network block) than with real deploys landing minutes apart, so the check disables itself for the rest of this page's lifetime, logs why via `console.warn`, and clears any currently-shown banner. A false "new version" nag every few minutes forever is worse than no banner at all; this bounds the worst case to at most one shown-then-retracted banner, and only for this one open tab -- a fresh page load starts the whole thing over with a clean baseline, so a real deploy that happens to look unstable isn't lost forever, just for the current session.

`appHtmlBaselineRef` always holds "the newest fingerprint we've actually observed," not just whatever loaded at mount: the first successful check seeds it, and every later check that finds a DIFFERENT fingerprint both flags `appUpdateAvailable` (unless that trips the instability guard above) and re-seeds the baseline to the new one. That re-seed is what makes dismissing the banner safe -- once dismissed, the next poll only re-fires if the fingerprint changes AGAIN since the version that was just dismissed, not because it's still comparing against the original version from mount.

---

### App Update Check: Long Vs Short Non-Hash Response (was ~line 8358 in the app file)

Two very different situations produce a non-hash response from the `?check=version` endpoint, and they need opposite handling:

- **A LONG body** means the endpoint served something substantial that isn't a hash -- almost always an OLD Code.gs deployment without the `?check=version` branch, which ignores the unrecognized query string and returns the whole ~500KB app (a login/interstitial page lands here too). That's a permanent condition for this session: retrying cannot fix it, so disable and point at the redeploy instructions.
- **A SHORT/EMPTY body** is a transient blip -- a truncated or dropped response from a proxy or flaky network. Observed live against the real deployment on 2026-09-10: roughly 1 poll in 15 came back HTTP 200 with 0 bytes while every other poll returned the identical correct hash. Treating that as "old deployment" and disabling permanently would silently kill update checking for the rest of the session on a single hiccup -- exactly the "banner never fires again and nobody notices" failure the instability guard is supposed to avoid, just arrived at from the other direction. So it's routed through `recordFailure()`, which retries and only gives up after `MAX_CONSECUTIVE_FAILURES` back-to-back.

64 is a deliberately generous cutoff: comfortably above any hash shape we'd accept (32 hex chars) yet far below any real HTML page.

---

### Refresh Button: Non-Framed Reload Path (was ~line 8456 in the app file)

Refresh button target for the NOT-framed case only (see the banner's render block for the Apps Script / framed cases, which use a real `<a target="_top">` link or a "refresh manually" message instead -- never this function).

This used to append a cache-busting `?_refresh=<timestamp>` query param before navigating, reasoning that a plain `reload()` could be served from an intermediate cache "on some hosts (e.g. the Apps Script Web App route in apps-script/)." That reasoning was backwards for its own stated example: on the Apps Script path this function's old body navigated `window.location` -- the sandboxed iframe's own transient URL, not the real page -- to that URL plus an unrecognized query param, which is exactly symptom 1 of Kevin's 2026-09-10 report (the button blanked the page and hung). That path now uses the real `<a target="_top">` link instead and never calls this function at all.

For the genuinely-not-framed case this function actually runs in, there's no known caching problem to work around, so it takes the simpler, lower-risk option the investigation recommended: a plain reload. Appending an unrecognized query param has its own failure mode on a host we don't control (a 404, a redirect loop, or the param just being stripped) for no proven benefit here.

---

### Auto-Apply Effect Crash Fix (was ~line 8490 in the app file)

2026-09-10 (W11 data-ingestion audit). This used to call `applyCsvText()` with NO try/catch and no `result.ok` check at all -- the only one of `applyCsvText`'s three callers that didn't. `applyCsvText`'s own `XLSX.read()`/`parseWorkbookToRows()` calls are deliberately NOT self-wrapped (so each caller can decide how to surface a failure), and `handleManualRefresh` / the initial-mount effect both DO wrap their own call in try/catch -- this one didn't, and it's reached by the ONE path that needs it most: the fully-automatic auto-apply effect right below, which runs with ZERO user action whenever Auto-Refresh is on (the default) and a poll found the CSV text had changed at all, even to something that isn't valid CSV.

`checkForUpdates` only does a raw string-inequality check before staging a poll result as "pending" -- it never validates parseability. A transient upstream hiccup (a Google auth interstitial, a truncated download, a "spreadsheet too large" error page -- all real, expected failure modes for a "Publish to the web" CSV link, see README's Data pipeline section) is textually different from the last good load, so it gets staged, and the auto-apply effect immediately calls this function on it.

`window.XLSX.read()` throws synchronously on genuinely non-tabular text (confirmed: "Invalid HTML: could not find <table>" for an HTML interstitial body) -- with no catch here, that exception propagated straight out of the `useEffect` callback. This app has no ErrorBoundary anywhere, so React's own top-level handling for an uncaught error thrown during a passive effect unmounts the ENTIRE tree: confirmed live via Playwright (`page.route` serving an HTML interstitial in place of the CSV, then letting the poll pick it up) that `#root`'s `innerHTML` goes to length 0 -- a fully blank white page, the previously-good live report gone completely, with no on-screen error and no recovery short of a manual browser reload.

Fixed the same way `handleManualRefresh` already guards its own `applyCsvText` call: wrap in try/catch and surface both a thrown exception AND an `{ok:false}` parse result via the existing `autoFetchError` banner (self-clears on the next successful load, same as every other `autoFetchError` case) instead of either crashing or silently doing nothing.

Deliberately does NOT clear `pendingCsvTextRef`/`newDataAvailable` on failure -- leaving them set means a manual click on the "New data available" banner's Refresh button (the other caller of this function) can retry the exact same payload and get the same clear error again rather than the banner just vanishing with nothing having happened, and the next genuinely-different good poll result still overwrites `pendingCsvTextRef` normally once the upstream issue clears.

---

### Auto-Apply Effect: Historical View Guard (was ~line 8561 in the app file)

When Auto-Refresh is on, this applies a detected change the moment it's found instead of waiting for a manual click on the "New data available" banner.

2026-09-04 (math/logic audit): added the `!viewingHistoricalDate` guard -- this effect used to fire regardless of historical-viewing state, so a background poll landing while someone was reviewing a past date (or a Compare-These-Two-Dates session built from two past dates) would silently swap `rawRows` back to live data and reset `viewingHistoricalDate` to null via `applyCsvText`, with zero warning. On the Compare tab this was worse than a plain historical view: the user never leaves the tab, `oldRawRows`/`oldFileName` (the "old" snapshot) stay put, so only the "current" side quietly changes out from under them mid-review -- confirmed live (Playwright + a virtual clock driving the real 5-minute poll) to swap the displayed vessel count and every delta on screen with no visible signal anything happened.

Adding `viewingHistoricalDate` to the dependency array (not just checking it) means this doesn't just skip once -- it re-evaluates the moment the user exits historical mode (clicking "Back to Live" sets `viewingHistoricalDate` to null), so a poll result that arrived while they were away still applies automatically as soon as they're looking at live data again. No new state needed: `newDataAvailable`/`pendingCsvTextRef` already hold whatever was found.

---

### Refresh Now Button: Historical View Deferred Apply (was ~line 8603 in the app file)

2026-09-10 (W11 data-ingestion audit). The "Refresh Now" header button is rendered and enabled unconditionally whenever `rawRows.length > 0` -- including while `viewingHistoricalDate` is set (a single "View a Date" snapshot, OR a Compare-These-Two-Dates session built from two historical snapshots, which also leaves `viewingHistoricalDate` set to Snapshot B's date). Before this fix, clicking it there called `applyCsvText()` unconditionally, which silently overwrites `rawRows` with live data AND resets `viewingHistoricalDate` to null -- exactly the same silent-yank bug the AUTOMATIC auto-apply effect (see "Auto-Apply Effect: Historical View Guard") was already fixed for on 2026-09-04, just reachable here via a manual click instead of a background poll.

On a Compare-These-Two-Dates session specifically this is worse than a plain historical view: the user never leaves the Compare tab, `oldRawRows`/`oldFileName` (Snapshot A, the "old" side) stay put, so only the "current"/`rawRows` side silently swaps from Snapshot B to live data mid-review -- reproduced live via Playwright (clicked "Refresh Now" while viewing a historical date; the "Viewing historical data for ..." banner vanished and live data appeared with no confirmation of any kind). "Refresh Now"'s own tooltip ("Re-fetch the latest data from the Sheet now") gives no hint this can happen either.

Fix: reuse the SAME deferred-apply mechanism `checkForUpdates` already uses once initial data has loaded -- stage the freshly-fetched text as a pending update (only if it's actually different from what's currently the live dataset) instead of applying it straight through. The historical/compare view on screen is left completely undisturbed; the fetched update surfaces normally via the "New data available" banner (or the auto-apply effect, if Auto-Refresh is on) the moment the user clicks "Back to Live" -- this is the exact mechanism the 2026-09-04 fix's own comment describes ("the pending update isn't lost... picks back up the moment the user returns to live data"), just also reachable from this manual path now. `lastChecked` (set inside `fetchCsvText` above) still updates normally either way, so "last checked" stays accurate even on a run where nothing visibly changes.

2026-09-1x (W11 sequence-guard follow-up): re-check before committing OR staging -- something newer (another manual click, a poll tick, a manual upload) may have already claimed a ticket while this fetch was in flight, in which case this result is stale regardless of which branch below it would otherwise take. See "CSV Apply Sequencing (csvApplySeqRef)" for the ticket mechanism.

---

### Screenshot Capture: Detached Clone Rewrite (was ~line 8752 in the app file)

Captures a frozen, off-screen CLONE rather than the live element or live React state (2026-09-20, rewritten after a `/code-review` pass surfaced a cluster of related bugs in an earlier version that reset `zoomLevel`/`textSizePx` via `setState` before capturing and restored them in a `finally` block -- kept only long enough to get real review feedback, not worth reproducing here). That version's problems, all rooted in "mutate live state, capture, restore":

- `activeTabContentRef` carries `transform: scale(zoomLevel)` + non-standard `zoom: textSizeZoomPct%` (see that div's own style, a few hundred lines down) whenever Kevin has used Zoom/Text Size -- html2canvas has weak/no support for either, so capturing the live element directly could come out the wrong size.
- Resetting `zoomLevel`/`textSizePx` via `setState` to work around that re-renders the WHOLE dashboard (not just the captured element), which on trade_summary/sector_summary re-runs `PivotTableViewer`'s own uncached pivot-aggregation pass (its `aggregated` `useMemo` is keyed on a `config` object these call sites recreate every render, so identity always changes) -- twice, for zero reason, on every single screenshot.
- The reset needed an async wait for React to commit before capturing, and `zoomLevel !== 1` is a strict float comparison against a value that drifts by repeated +/-0.1 button clicks (e.g. lands on 0.9999999999999999, which reads as "100%" but fails the check) -- so the "only reset when needed" early-out could silently stop early-outing.
- Worse, that async gap was a real race window: a zoom/text-size click, or a tab switch, during the wait or the html2canvas call itself would either get clobbered by the finally-block restore (the user's own change silently discarded) or produce a screenshot whose filename (closed over at click time) didn't match its actual pixels (read live from `activeTabContentRef.current` at capture time).

Cloning the node synchronously, at the top of this function, before any await, sidesteps every one of those at once: the clone is a fully independent, detached copy of exactly what was on screen the instant the button was clicked, so nothing that happens afterward -- a zoom click, a tab switch, a re-render -- can affect it. transform/zoom are cleared directly on the clone's own inline style (never the live element's), so there's nothing to restore and nothing to wait for. No React state is touched, so there's no extra render and no wasted pivot recompute.

---

### Screenshot Capture: Second Review Pass Fixes (was ~line 8786 in the app file)

Four more fixes from a second `/code-review` pass (2026-09-20, several agents converging independently on the same findings), all consequences of the clone becoming a detached subtree with a new parent (`document.body`) instead of its real page position:

- **Dark mode was silently lost.** The app's only `dark` class lives on the ROOT wrapper div (a distant ancestor of `activeTabContentRef`, not on `activeTabContentRef` itself), and Tailwind's `darkMode: 'class'` config makes every `dark:` utility depend on an ANCESTOR carrying that class. Cloning `activeTabContentRef` and reparenting it under `document.body` left it with no `.dark` ancestor at all, so every `dark:` cell/border/text color in the captured table silently fell back to its light-mode value while `backgroundColor` still forced a near-black canvas -- a light table on a dark background. Fixed by adding the `dark` class directly onto the clone's own root when dark mode is active: it becomes an ancestor of its own descendants, which is all Tailwind's selector actually requires.
- **Horizontal/vertical scroll position wasn't preserved.** `cloneNode` copies markup, not live scroll offsets, so a pivot table's own `overflow-x-auto` wrapper (`PivotTableViewer` renders one around every table) always cloned at `scrollLeft` 0 -- if Kevin had scrolled right to check later sale weeks before exporting, the capture silently jumped back to the leftmost columns. Fixed by copying `scrollLeft`/`scrollTop` from each live scrollable container to its corresponding clone after cloning.
- **The clone could render wider than the live element actually was.** `activeTabContentRef` is `w-full` (100%), which live resolves against its real (narrower, padded) parent; the clone is `position: fixed` with no ancestor of its own, so `w-full` instead resolved against the full viewport -- potentially wider than what was actually on screen, which could change table/flex-wrap layout in the capture. Fixed by measuring the live element's actual rendered width before cloning and setting that exact pixel width on the clone, overriding `w-full`'s now-wrong percentage basis.
- **Clone creation itself (`cloneNode`/`appendChild`) was OUTSIDE the try/finally**, so if either ever threw, `isExportingScreenshot` would stay stuck `true` forever (button permanently disabled until reload) with no error shown. Moved the whole sequence inside try/finally; `finally` only removes the clone if it was actually appended (`clone.parentNode` check), since a throw from `appendChild` itself would mean it never made it into the document.

---

### Yard Selection Effect: Two Clearing Bugs (was ~line 9229 in the app file)

This effect derives `selectedYards` from the Yard search box. Two separate problems lived here, both fixed 2026-09-24 (ported from the `1.67_TESTING` branch's own 2026-09-15 fix for the same effect):

1. **Pre-existing bug, predates filter persistence**: this effect re-ran on every data refresh — `availableYards` is a `useMemo` over `rawRows` returning a new array identity each time — and with an empty search box unconditionally cleared the selection, silently discarding a Yard the user had picked by clicking a chip (chips set `selectedYards` directly, bypassing the search box entirely).
2. **Surfaced by filter persistence (2026-09-24)**: this effect also ran on mount, before `FilterPrefsStore`'s restored `selectedYards` was ever visible, and unconditionally wiped it back to `[]`. Confirmed live by this repo's own regression-suite work while adding coverage for the new persistence feature — a Yard selected purely by clicking its own chip (never typed into the search box) silently failed to survive a reload, unlike every other persisted filter.

Both are handled by the same two guards: an `availableYards`-empty early return, and clearing only when the search text itself changed — so no separate restore-specific one-shot ref is needed. The effect tracks the search text it last acted on, so it can tell "the user edited the search box" apart from "a data refresh (or first mount) handed us a new `availableYards` identity". It's initialised from the current (possibly restored) value, so the first real run after mount is correctly seen as "no text change".

---

### Filter Memo Performance Pass (F3/F3b) (was ~line 9330 in the app file)

F3 (PERFORMANCE_REVIEW.md): this memo re-scans every one of the ~8.8k `rawRows` on every filter/tab change. Everything hoisted above the `rawRows.forEach` loop is loop-invariant — it doesn't depend on `row` — and used to be recomputed once per row for no reason: lowercasing each selected SPC/MKG analyst name, O(k) `Array#includes` scans for every categorical slicer (Sub Trade/Lane/Coast/Sale Week/Yard/AP Status), and re-lowercasing + re-cleaning each header filter's search text. `Set#has` and `Array#includes` both use SameValueZero equality (so `NaN` matches either way), so swapping the categorical arrays for `Set`s here is a behaviour-preserving O(k)->O(1) win, not just a style change.

F3b: `activeTab` used to sit directly in this memo's dependency array even though it only steers two narrow per-row branches: `matchYard`'s "the Detail tab ignores the Yard slicer" rule, and which status field AP-status matching reads (`loadingStatus` on POL Booking Flash, `status` everywhere else). That meant every tab switch re-scanned all `rawRows` and rebuilt every valid-value Set — even switching between Trade Summary / Sector Summary / Compare, whose filtering behaviour here is byte-for-byte identical (neither branch treats those tabs differently). Depending on the two booleans `activeTab` actually projects onto, instead of `activeTab` itself, means the memo only recomputes when a tab switch actually changes behaviour (entering/leaving `'detail'` or `'pol_booking'`), while switching among the other tabs is free.

---

### Filter Memo Tab-Dependency Narrowing (was ~line 9354 in the app file)

These two derived booleans narrow the filter memo below to the tab changes that can actually alter its output, instead of every tab change (2026-09-15 perf pass).

The memo's body uses each boolean in exactly one place (verified by grep over the whole memo, not assumed):
- `isDetailTab` -> `matchYard = isDetailTab || yardSet.size === 0 || ...`
- `isPolBookingTab` -> `currentStatusField`, read only by `matchApStatus = apStatusSet.size === 0 || ...`

In both, the boolean is short-circuited into irrelevance when its own filter is empty: with no Yard selected, `matchYard` is true for every row whatever `isDetailTab` is; with no AP Status selected, `matchApStatus` likewise. So when those filters are inactive the memo's result is genuinely tab-independent, and recomputing it on a tab switch would produce a byte-identical answer.

Listing these in the dependency array instead of the raw booleans is exact, not an approximation — it can only skip a recompute whose output would have been identical. `selectedYards`/`selectedApStatuses` are themselves already deps, so toggling a filter on or off still recomputes, and does so at the moment these values also flip.

The memo body reads ONLY these two derived values, never `isDetailTab`/`isPolBookingTab` directly. That is what makes the narrowing safe as the file changes, rather than safe only as of today: a dependency array that lists different names than the body reads is the classic way a memo starts serving stale results, and the previous version of this code relied on a comment to prevent that. Substituting here is behaviour-identical because each use short-circuits when its own filter is empty — `matchYard` via `yardSet.size === 0`, `matchApStatus` via `apStatusSet.size === 0` — so the raw boolean's value cannot reach the output in exactly the cases where these derived values stop tracking it. **If you add a use of the tab identity here that isn't gated by an empty-filter check, do not reach for the raw booleans — add whatever you need to the dependency array too.**

Why it matters beyond the filtering itself: the memo returns a fresh array, so recomputing it changed `filteredRawRows`' identity on every tab switch — which in turn re-triggered POL's auto-fit `useLayoutEffect` (19,559 cells, ~473ms of forced layout, see its own comment) and every other memo keyed on it. The identity churn was the expensive part, not the filtering. These gates are derived from the DEFERRED arrays, not the raw ones, so they cannot disagree with what the memo body actually filters on for a render.

---

### POL Auto-Fit Dependency Object (was ~line 9521 in the app file)

The inputs that can actually change a measured POL column width are declared ONCE as a single object. This object is the single source of truth for BOTH the effect's dependency array (spread via `polAutoFitDepValues`) and the skip guard's comparison — deliberately, so the two cannot drift apart.

The previous version listed these fields three times: in the dep array, in the guard's comparison, and in the object written to the ref. Adding a POL column-visibility toggle to the dep array while missing the other two spots would have silently DISABLED re-measurement for it: the effect re-runs, the guard sees its tracked fields unchanged, returns early, and the new column keeps a stale width. No error, visual-only, so it would ship. A new entry here updates the dep array and the guard at once.

2026-09-18: this list used to hold only five of the toggles that gate POL columns. The other seven were left out ON PURPOSE, because every entry here was another trigger for a pass that re-measured all ~19.5k cells, and leaving them out was the only thing keeping those seven toggles fast — at the cost of a newly revealed column starting at its CSS min-width instead of a fitted one. That trade is gone: the pass below now measures only the columns that do not already have a width, so a toggle that reveals ONE column measures that column's cells and nothing else, and a toggle that only HIDES columns measures nothing at all and returns immediately. All twelve are listed now, so every POL column auto-fits on the click that reveals it.

---

### POL Auto-Fit Skip Guard And Zoom Font Gap (was ~line 9596 in the app file)

2026-09-15 perf: skip the whole measurement pass when nothing that can change a width has changed since the last one that ran.

`activeTab` HAS to stay in the dependency array — it's what makes this run when the user first arrives on POL, since before that the table isn't mounted and `polTableContainerRef.current` is null, so an earlier run bailed at the check above without measuring anything. But that also means React re-runs this on EVERY switch back to POL, even when the rows and column-visibility flags are identical and `polColWidths` (state, which survives the tab switch) already holds the exact widths this pass would recompute.

That was not cheap: measured on the live data 2026-09-15, this table has ~19.5k `[data-autofit-col]` cells and the pass builds a Range + `getBoundingClientRect` for every one of them — 307-473ms of forced layout — to produce **23** column widths. Paid again on every return to the tab.

The booleans are booleans and `filteredRawRows` is a memoized array whose identity is stable unless the filters actually changed, so an identity/`===` comparison here is exact — this can only skip a pass whose inputs are genuinely unchanged, never one that would have produced a different width. It's set AFTER the container check so a run that bailed early (table not mounted yet) doesn't poison the cache.

NOTE this deliberately does not add `zoomLevel`/`textSizePx`, which do affect rendered text width: POL's auto-fit never depended on them (the Detail table's equivalent effect does). That's a pre-existing gap, not something this guard introduces or should silently change.

**IF YOU EVER CLOSE THAT GAP, three places need changing, not one.** Adding `zoomLevel`/`textSizePx` to `polAutoFitDeps` re-runs this effect, but the incremental path below would then find no NEW column keys and return having measured nothing — every width would stay at its old font size, silently. They must also invalidate `polMeasuredWidthsRef` the way a row-set change does, i.e. be folded into the `rowsChanged` condition just below (rename it, it stops being about rows), AND be part of the row-set cache key (see `polAutoFitCacheRef`) — otherwise returning to a row set replays widths measured at the old font size, just as silently. The same applies to anything else that can change a cell's rendered text WITHOUT changing `filteredRawRows`: today nothing does — `renderAsteriskHide`/`renderSecAlloc`/`formatDate` and the rest are pure functions of the row — and that is what makes the memo below exact rather than merely usually-right.

---

### Compare Vessel Utilz Per-Leg Aggregation Fix (was ~line 9824 in the app file)

2026-09-09 (found while investigating Kevin's POL Analyze-modal Max Laden report — same bug shape, a different spot): "Vessel Utilz" (`curUtilRaw`, "Measures Overall Booking Utilz") and "Peak Utilz" (`peakUtilRaw`, "Measures Peak Overall Utilz") are both per-(VVD, POL-leg) raw fragments at this row's own grain — Compare's rows are deliberately per-leg (see `keyOf`), so reading `row.curUtilRaw`/`row.peakUtilRaw` directly gives one leg's own slice, not the true vessel-wide figure Booking Flash/Detail renders under these same labels.

`tableData` (Detail's own aggregation) already knows this: it SUMs `curUtilRaw` across a VVD's legs (the 2026-09-03 fix, see DATA_ARCHITECTURE.md) and MAXes `peakUtilRaw` (the 2026-09-09 percent-scale fix elsewhere in this file) — Compare's own diff never adopted either aggregation, since it bypasses `tableData` entirely.

Confirmed live via two real production pulls ~5 hours apart: 54 distinct VVDs got 2+ separate "Vessel Utilz changed" rows in the same comparison, and for at least 2 of them (TSTT0053W, QUIT0020W) the TRUE vessel-level Current Laden Utiliz % never moved at all (21%->21%, 28%->28%) — their legs simply shifted in opposite directions and canceled out — while Compare still flagged the vessel as "changed" twice, and the one correct number never appeared anywhere.

Fixed by aggregating both fields per VVD, across BOTH datasets, mirroring `tableData`'s own logic exactly (for `curUtilRaw` see `vesselUtilByVvd` below — revised 2026-09-26; MAX via `getPeakUtilPercentNum` for `peakUtilRaw`), and reading that aggregate here instead of the raw per-leg value. `maxLdn` stays untouched (confirmed live: byte-identical across every leg of every real multi-leg VVD today, a genuine vessel-wide constant, not a fragment), and `curLaden` stays untouched too (it's supposed to be POL-scoped here, same as POL Booking Flash's own per-leg render — Compare's row already carries its own POL column right next to VVD, so a per-leg Current Laden reads correctly in a context that's explicit about being POL-scoped).

2026-09-26: Vessel Utilz now mirrors `tableData`'s corrected `curUtilRaw` — SUM(Laden TEU) / MAX(Max Laden) across a VVD's legs, falling back to the summed per-leg percentage only when Max Laden is blank. Summing the pre-rounded per-leg percentages (what this did before) drifted 1 point on ~25% of multi-leg VVDs; see `tableData`'s own `curUtilRaw` comment for the evidence.

---

### Analyze POL Card Max Laden Scoping Fix (was ~line 10141 in the app file)

2026-09-09, per Kevin: "The Analyze button for the POL Booking Flash tab is also relative to the overall max laden. It should be relative to the POL Max Laden." Confirmed live: `groupBy('pol')`'s buckets were reading the vessel/Lane-wide `maxLdn` ("MCT Max Laden Update") — identical across every POL leg of the same VVD — instead of the genuinely POL-specific `polMaxLdn` ("POL Max Laden TEU"). On real data, 17 of 27 multi-POL lanes showed every POL card under that lane with a byte-identical Avg Max Laden, an impossible result for physically different ports — e.g. Lane EC4's USHOU05/USMOB01 both showed 2,359.64 pre-fix; correctly 1,738.21/621.43 post-fix.

Peak Utilization has the identical bug shape (`peakUtilRaw` is vessel-wide "Measures Peak Overall Utilz"; `peakPolUtilzRaw` is the POL-specific "Measures Peak Pol Utilz") — caught by checking every field this card renders, not just the one Kevin named. Branching on `fieldKey` (not `activeTab`) is deliberate: `groupBy` is also called a second time (see `laneSummaries`) to build Overall Snapshot/the trend chart's own aggregate.

2026-09-09 -> 2026-09-10 update: that second call used to be hardcoded to `groupBy('lane')` regardless of tab, on the theory that Overall Snapshot was intentionally Lane-wide everywhere (see the retired "these per-POL capacity figures don't sum to the Overall Snapshot above" caption, removed 2026-09-10 alongside this). Kevin: "I'm thinking they should all be POL level as well, for this tab specifically[, so] when you filter down to just one port of call, you are not still seeing averages relative to the overall" — true as reported: filtering the Yard slicer to one POL narrowed the breakdown card but NOT Overall Snapshot, which kept summing every OTHER port on the same lane(s) via the vessel-wide `maxLdn` field, so Overall could look nothing like the one visible card.

Fixed by calling `groupBy(groupKey)` for this second pass too (see `laneSummaries`) — POL-scoped on the POL tab, still Lane-scoped on Booking Flash/Detail, since `groupKey` already tracks that per `activeTab`.

Verified this doesn't reintroduce the 2026-08-18 over-counting bug this same `fieldKey` branch exists to prevent: unlike the pre-fix POL cards (which read the vessel-wide `maxLdn`, identical across every POL leg of a VVD — summing those really would multiply-count one vessel's capacity), `polMaxLdn` is each port's own allocated share. Checked against the real sample export across every multi-POL VVD (333 of them): summing `polMaxLdn` across a VVD's distinct POLs reconstructs its single vessel-wide `maxLdn` exactly (or within striking rounding distance) for ~95% of them — e.g. the EC4/USHOU05+USMOB01 case above, 1,738.21 + 621.43 = 2,359.64, its exact vessel-wide value — so summing POL-level numbers doesn't inflate the total, it just re-partitions the same total by port instead of by lane.

The remaining ~5% (18 of 333 VVDs, all under an open AP appeal or AP-Frozen status at capture time) don't sum exactly, off by up to ~1,400 TEU on a few — an accepted, unengineered-around edge case tied to that operational state, not a scope bug worth chasing here.

Verified against POL Booking Flash's own displayed "Current Laden Utilz %" (`polBkgUtilzRaw`, an independent, already-computed field): the fixed ratio-of-averages here now lands within ~1 point of it on average, vs. ~23 points off pre-fix.

---

### Trend Chart Departed-Star And CoastalEtd Fix (was ~line 10272 in the app file)

"Departed" (2026-09-02): a week's bar carries the star once every group/VVD contributing to it has already sailed (`row.etd` on or before today). Within a single group's own bucket for that week, this is still an OR across its rows (any VVD in that group departing marks the GROUP departed for that week, same as `maxLdn`/laden are folded in by max/sum below). But across GROUPS — when multiple are present in the analysis window — 2026-09-04 (Kevin, Item 22): switched from OR to AND. Was: any ONE group departing that week was enough to star it, so a week could show departed while other groups hadn't sailed yet — now every group present for that week must be departed. Computed once per render rather than per row so every row in this pass compares against the exact same moment.

"group" here means Lane on Booking Flash/Detail, POL on POL Booking Flash — was hardcoded to `row.lane`/`maxLdn` regardless of tab until 2026-09-10, when Overall Snapshot's own aggregate (`laneSummaries`) switched the same way for the same reason (see `groupBy`'s 2026-09-10 comment for the full writeup): this trend chart sits directly under Overall Snapshot and was still drawing Lane-wide bars even when Overall itself had just become POL-scoped, which would have reintroduced the identical "filtered to one port, chart still shows the whole lane" mismatch. `chartMaxLdnField` mirrors `groupBy`'s own `fieldKey` branch exactly (`polMaxLdn` on the POL tab, else the vessel-wide `maxLdn`) so this second, independent aggregation pass stays consistent with the first.

2026-09-11: the departed check itself (`row.etd`) had the same bug `chartMaxLdnField` was fixed for above, one step behind — it was still reading `row.etd` ("Route Date Last Port ETD Date") unconditionally on BOTH tabs. That field is the vessel's voyage-wide Last Port ETD and is identical across every POL leg of the same VVD, so on the POL-scoped tab it doesn't tell you when THIS POL's leg actually sailed.

Confirmed via real data in `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`: VVD NOCT0082W, sale week 2026/W32, has POL USHOU with Coastal ETD 2026-09-03 and POL USMOB with Coastal ETD 2026-09-05, but both legs share the same Last Port ETD = 2026-09-05 — so on any "today" between 2026-09-03 and 2026-09-05, USHOU's leg has already sailed but this check (reading the shared Last Port ETD) wrongly reported it as not departed. 11 real VVDs in that file reproduce this: NOCT0082W, HFWT0171W, HI3T0017W, HOVT0060W, HRVT0060W, HSMT0091E, NCMT0031W, NOBT0043E, RBTT0005W, SROT0045S, TSTT0053W, YPMT0196W.

Fix: on the POL tab, check `row.coastalEtd` ("Route Date Coastal ETD Date") instead — the POL-specific departure date for that leg — mirroring `chartMaxLdnField`'s own `groupKey` branch. Falls back to `row.etd` when `coastalEtd` is blank (17 of 8,769 rows in the historical CSV have `coastalEtd` blank with `etd` populated) so a sparse row doesn't silently stop counting as departed.

The chart reads the same per-sailing buckets as the cards (see the per-sailing aggregation comment above) — it used to re-aggregate raw rows with its own copy of the Math.max-per-bucket capacity bug.

---

### Sector Summary Slicer Gating Fix (was ~line 10398 in the app file)

2026-09-14, per Kevin's bug report: every slicer except Lane had stopped narrowing this table (Coast, SPC Analyst, MKG PIC, Sales Week, Yard).

Root cause: `sectorSourceRows` comes from a completely separate data source (`SECTOR_DATA_CSV_URL`, seeded by `SECTOR_DATA_SEED`) that only ever carries Trade/Sub Trade/Lane/POD Sector/allocation numbers — no Coast, PIC, Sales Week, or Yard columns exist on it to check directly, so those slicers had nothing to match against here even though they correctly narrowed `filteredRawRows` (and so the "Average Max Laden vs Booking" pivot right next to this one, via `past4WeekRows`) the whole time. Only Sub Trade and Lane were ever checked directly against this table's own rows — everything else silently no-op'd.

Fix: derive which Sub Trade+Lane combinations remain valid under EVERY active slicer by reading them off `filteredRawRows` instead (it already combines all of them — Sub Trade, Lane, Coast, SPC Analyst, MKG PIC, Sales Week, Yard, AP Status, header filters), and gate this table by that derived set instead of re-checking `selectedSubTrades`/`selectedLanes` in isolation.

Confirmed safe against real data before shipping: at zero filters selected, every one of this table's Sub Trade+Lane combinations already has at least one matching row in `filteredRawRows`, so this introduces no "combo disappears even with nothing filtered" regression.

---

### POL Row Pipeline Memoization (F7 Follow-Up) (was ~line 10830 in the app file)

POL Booking Flash's own sort/blank-row/rowSpan pipeline (2026-09-10 perf pass, F7 follow-up — see the shared writeup above `DetailTableRow`/`PolTableRow` for the full context). This used to run inline in the render body, inside the `activeTab === 'pol_booking' && (() => { ... })()` block, which meant it re-executed on every single render of the whole component while that tab was active — a full re-sort (with a `compareEtd`/`compareSaleWeek`/collator comparator chain) and re-span of every row in `filteredRawRows` (up to the full 8,769-row historical scale, since this tab — unlike Detail — renders straight from the raw rows, never from the aggregated `tableData`; see `tableData`'s own `rfrMaxLdn` comment for why aggregation doesn't apply here) on every column-resize drag frame, every header-filter keystroke, even a render triggered by something on a completely unrelated tab's state.

Wrapping it in its own `useMemo` keyed on `filteredRawRows` — the exact same two-step shape `tableData`/`processedData` already use for Detail — fixes that half of the problem; `PolTableRow`'s `React.memo` wrap (used at this data's render site) fixes the other half (per-row re-render cost). Computed unconditionally (not gated on `activeTab === 'pol_booking'`) for the same reason `tableData`/`processedData` are: React hooks can't be called conditionally.

NOTE (2026-09-21 correction): the old claim here — that gating a surrounding IIFE on `activeTab` meant this simply wasn't read unless that tab was showing — is no longer true. That inline IIFE was removed; its logic now lives in `PolBookingTablePanel`, which stays mounted (and reads this prop) on every `FlashReportDashboard` render once POL has been visited once, regardless of which tab is active. It's only *visually* hidden via the `hidden` attribute on its wrapper div, not conditionally evaluated.

---

### Selection Summary Report Card Data Memoization (was ~line 10899 in the app file)

Selection Summary Report Card's selected-rows data (2026-09-15, per Kevin) — both `processedData` (derived from `tableData`, `useMemo`'d above near line 5964) and `polSpannedRows` (derived from `filteredRawRows`) are computed UNCONDITIONALLY — neither `useMemo`'s dependency array is keyed on `activeTab` — so both stay current regardless of which tab is actually showing; it's safe to read either one here without an `activeTab` guard on the computation itself.

Deliberately NOT reusing `row.showTrade`/`showSub`/`showLane`/`tradeSpan`/`subSpan`/`laneSpan` for this modal's table: those drive rowSpan grouping computed across the FULL, ordered `processedData`/`polSpannedRows` array, and are meaningless (or wrong — e.g. two selected rows of the same Trade that are far apart in the real table incorrectly merging or vanishing) for this arbitrary filtered subset. The report card renders Trade/Sub Trade/Lane as plain ungrouped cells on every row instead, using `row.trade`/`row.subTrade`/`row.lane` directly with no rowSpan (see the modal's own JSX further down).

Memoized 2026-09-18: these were plain statements in the render body, so both scans re-ran on EVERY render of this component — every keystroke in a header filter, every rAF frame of a column-resize drag, every hover tooltip — even though only the Report Card reads them and `polSpannedRows` runs to the full ~9,232-row POL set. Now they recompute only when the rows or the selection actually change.

---

### Macro Button Grid Width Pass 4 (240px to 140px) (was ~line 12464 in the app file)

Verified LIVE (Playwright + Chromium, real upload of `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`, both tabs, no Lane filter) at 1366/1440/1536/1600/1920px: Lane's scrollWidth vs clientWidth went from scrolling at all 4 widths below 1920px (240px baseline) to scrolling only below 1600px (140px). 1600px and 1920px now need zero scroll on both tabs (previously only 1920px did); 1366/1440/1536 still scroll, with the deficit reduced by exactly the 100px this column gave up at every width.

This is a hard floor, not an unfinished narrowing: at 1366px the Lane row's own content requires 1352px (28 lanes x (44px button + 4px SlicerBtn margin) + 8px row padding, confirmed by direct measurement) but even collapsing this ENTIRE column to 0px only frees the row up to 1278px at that viewport — 74px still short — because the page's own outer gutters and this row's own label/padding already consume the rest. 1440px is only 8px short at a hypothetical 0px column. No max-w/padding/gap/font value in this column can close that gap; verified separately that even a severely-narrowed, already text-overflowing 90px column still leaves 1366px short. Closing it requires touching something outside this column (e.g. the Lane row's own 44px SlicerBtn width/margin, or the shared filter panel's own padding) — out of scope for this pass; flagged rather than silently left unmentioned. See the commit message for the full per-width before/after numbers.

---

### Macro Button Grid Width Pass 5 (140px to 240px) (was ~line 12487 in the app file)

Widened 140px -> 240px (2026-09-25, per Kevin: "widen the macro buttons more so all the words on the macro buttons fit on one line"), reversing course on Pass 4 — asked and confirmed explicitly knowing it claws back width from Lane, which needs it (this file's own history is exactly why that tradeoff was flagged before making it, not assumed harmless).

Measured the real minimum first rather than guessing: an isolated Playwright measurement of this exact grid (real labels, real classes, real vendored Tailwind build) found every label wrap-free at 215px and wrapping at 210px and below — Operational Issues is the tallest pole, the last one to stop wrapping as width grows. 240px gives ~25px of headroom above that hard threshold (this file's own "not a hairline fit" convention — see Sub Trade/MKG PIC's row comment for another example) and happens to be a value this exact column already used successfully earlier in its own history (400->300->240->140), not a new untested number.

Font/padding/gap (`text-[9px]`, `p-0.5`, `p-1`, `gap-0.5`) all UNCHANGED — width alone was the lever, since the `min-w-0` hardening already guarantees a grid item wraps instead of forcing this column wider, and 9px was already established as a floor not worth shrinking further.

This does make Lane's fit worse, as expected: re-verify Lane's own scrollWidth vs clientWidth at 1366/1600/1920px if that ever needs revisiting; it is not re-measured here because the tradeoff was the explicit ask, not a side effect to chase away.

---

### Macro Button Grid 280px Threshold Re-Measurement (was ~line 12524 in the app file)

Follows the 240px -> 280px width change with font 9px -> 11px (2026-09-25, later the same day, per Kevin's marked-up screenshot: making the macro-button font match SlicerBtn's `text-[11px]`, widening the box to fit words on one line).

Did NOT assume the old threshold scales with font size — re-measured from scratch, same methodology as the 240px pass (isolated Playwright harness, real vendored Tailwind build, the exact real label set read live from `AP_STATUS_CONFIG` + `FIELD_TOGGLES` filtered by `MACRO_GRID_EXCLUDED_KEYS`, so a future toggle added/renamed there is automatically covered next time this is re-measured) AND the exact real DOM hierarchy (this max-w wrapper > the grid box's own `border p-1` > `grid grid-cols-2 gap-0.5` > buttons) rather than just the grid in isolation.

A first pass that measured only the inner grid div (skipping the box's own ~10px of border+padding and its `font-bold`, which every button inherits since `MACRO_BTN_BOX_CLASS` sets no font-weight of its own) understated the true minimum by 37px (219px vs the real 256px), which is exactly the kind of gap a shortcut harness can hide.

Found every label wrap-free at 256px and wrapping at 255px and below (re-verified twice at the boundary in both directions), with the same two labels as the tallest pole as at 9px — "Sector Allocation" and "Operational Issues" are the last to stop wrapping, "Trade Breakdown"/"Rotation"/"Voyage Remarks"/"DG Volume" are the next tier down and "VCO Analyst" clears well before that (all verified live, not assumed from the 9px ordering).

280px gives 24px of headroom above the 256px hard threshold, in line with this box's own ~25px "not a hairline fit" convention from the 240px pass. This claws back more of Lane's width (240px -> 280px, on top of the earlier 140px -> 240px pass) — flagged, not chased away, same as that pass: re-verify Lane's own scrollWidth vs clientWidth at 1366/1600/1920px if that ever needs revisiting.

### Blank-Screen Guard

Added 2026-09-28 after two users reported a pure-white page on the deployed `/exec` URL while everyone else loaded normally. Before this, the app had no error boundary and no fallback content, so two very different failures looked identical — an empty `#root`:

1. **A CDN script never arrived.** React, ReactDOM, Tailwind, SheetJS and html2canvas all load from public CDNs (unpkg.com, cdn.tailwindcss.com, cdn.sheetjs.com). A VPN, corporate web filter or firewall that blocks one of them leaves `React` undefined, the app script throws a `ReferenceError`, and nothing ever renders. This is the likeliest "only some users" cause, because it depends on the user's network, not on the app.
2. **A render crash.** React 18 unmounts the whole tree on an uncaught render error, so a crash that only one user's saved view or data triggers also left a white page.

The fix has two parts:

- **Plain-JS boot guard, first thing in `<head>`.** A capture-phase `error` listener records script-load failures and uncaught errors. After `load` it polls `#root`. If React/ReactDOM are missing, or `#root` is still empty 8s after an error (or 20s with none), it appends a `#bf-boot-failure` box (inline styles, because Tailwind may be the thing that failed). The box names the likely cause, lists the captured errors, the browser and whether React loaded, and offers "Reset saved settings and reload". That button clears every `bookingFlash*` localStorage key, then follows a real `target="_top"` link to `window.__EXEC_URL__`. This is the same escape from the HtmlService sandbox that the update banner uses, since a scripted reload isn't reliable there. It must stay ES5 and must not contain the literal `<script type="text/babel">` string: `Code.gs`'s `injectExecUrl_`/`injectServerPrefs_` insert their globals before the FIRST occurrence of that string.
- **`AppErrorBoundary` around `FlashReportDashboard`.** On a render error it renders `null` and calls `window.__bfShowBootFailure(error.stack)`, so there's one failure UI, not a second React-styled one that could itself fail. It does not catch event-handler or async errors (React boundaries never do), but those don't unmount the tree either.

**What the network case turned out to be (2026-09-28, same day).** The first real box a user sent showed Tailwind, React, ReactDOM and SheetJS all failing. The cause was a lapsed company-network sign-in: opening an unpkg.com URL directly showed the login page, and after signing in the report loaded. An embedded-library build (inlining all five libraries into `dist/index.html`, +1.7 MB) was built and then discarded, since re-authenticating fixes it. So the network-case box now leads with those steps: a "test link" to `react@18.3.1` on unpkg (opens in a new tab), sign in if prompted, then **Reload the report**. That button is a plain reload that does NOT clear saved settings, which have nothing to do with a network failure. Only the render-crash case keeps "Reset saved settings and reload". The `<ol>` sets `list-style:decimal` inline because Tailwind's preflight strips list markers whenever Tailwind itself did load.

Verified live against `dist/index.html` copies: the React URL pointed at an unreachable host shows the box with "React loaded: false". A component that throws on render shows the box with the stack. A normal load never shows it. The reset clears `bookingFlash*` keys and leaves other keys alone.

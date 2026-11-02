# Check history and lessons (moved from AGENTS.md, 2026-09-29)

This is the long-form text that used to make up most of `AGENTS.md`: every required check with the
full story of how it came to be, the dated executed-check counts as the suite grew, the flakiness
investigations, and the working-practice incidents. It moved here, unchanged, so `AGENTS.md` can be a
short operational entry point that every session reads in full.

**Read this when** a check surprises you, when you want to know *why* a rule exists before changing it,
or when an older doc or code comment says "see AGENTS.md check N" or "AGENTS.md's Known flakiness
section" and you want the full original text. **For current commands and counts, use
[AGENTS.md](../AGENTS.md) and [TESTING.md](TESTING.md)** -- the numbers below are dated snapshots and
many have since moved.

Section titles and check numbers are kept exactly as they were, so references elsewhere still find
their text here.

---

## Required: run the checks after every change to the app

This repo has no test framework by design (see README) — these are standalone scripts, not
Jest/Mocha/etc. — which makes it easy to ship a change that *looks* right in the diff but is
broken at runtime — this has actually happened more than once in this project's history (see
[HANDOFF.md's "Known bug classes"](../HANDOFF.md#known-bug-classes-read-before-touching-numericcolor-logic)
and the regression suite's own header comment for real examples, including a `ReferenceError`
that a syntax check alone did not catch because the deleted function was still called
~15 lines away). **Every check below now also runs automatically in CI** (GitHub Actions,
`.github/workflows/ci.yml`) on every push/PR. Checks 1–3 plus `check_field_filter_gating.py`,
`check_server_prefs_logic.js`, `check_resolve_app_html.js`, `check_team_features_logic.js` (2026-09-29 --
the Apps Script data cache, VVD notes, startup-error log and config Sheet, plus the app's own config
validator; run it after any change to `apps-script/DataFeeds.gs`, `TeamSheet.gs`, `doGet`, or the app's
`SERVER CONFIG RESOLUTION` block) and `check_compare_kpis.js` (2026-09-26 -- Compare's
KPI tiles and the helpers they share with Analyze, run headlessly on the 9-day archive; run it
after any change to the app's "shared capacity helpers" block or the Compare tab) are required/blocking there; check 4 runs too
(`tests/ci_regression_runner.js`) but is deliberately non-blocking — see the "Known
flakiness" section below for why an unattended full-suite run isn't trustworthy as a hard gate.
**2026-09-18:** `check_server_prefs_logic.js` was the last required check CI did not run, and
that gap had already bitten: PR #88 merged while this check was hard-failing with a
`SyntaxError`, because nothing ran it. If you add a check to this list, add it to `ci.yml` in the same commit — a
required check that runs only when someone remembers is not a required check.
None of this changes what's required of you locally: CI verifies what you already pushed, it
doesn't replace verifying the change yourself first.
**To run all of CI yourself, see [Running CI locally](#running-ci-locally-scriptsrun_ci_locallyjs)
below** -- one command, every `ci.yml` job, on a laptop or in a cloud agent session. Checks 1, 4 and 6 below are required after any change to the app file, in order —
don't stop at the first one and call the change done; check 2 is required only when the change
touches a `getVal()` call, check 3 only when it touches an `XLSX.read(...)` call or how a CSV/xlsx
file gets parsed:

1. **Syntax check** (fast, catches JSX/JS syntax errors only). **This line hardcoded
   `booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html` — a frozen point-in-time snapshot,
   not the live app — for a long time, which meant anyone who ran this exact command was
   syntax-checking the wrong file and got a green result that said nothing about their change.
   README.md's "Current version" note already flagged that this project's naming SCHEME itself
   changed once (2026-09-04) and that `tests/check_alias_landmines.py`'s own auto-detect went
   stale the same way at the same time — this command had the identical bug, just not caught
   until a 2026-09-10 doc-drift pass. Fixed here by deriving the filename the same way that
   script does (highest dotted-version number among `Booking_flash_report_na(_Kevin)?_<ver>_*.html`
   in the repo root, matching both naming eras) instead of a literal name, so the next version
   bump can't make this go stale a third time. If you ever find yourself typing a literal
   `..._1.NN_...html` filename into this repo's docs or scripts, stop — that is exactly the
   mistake this paragraph exists to prevent.**
   ```bash
   python3 - <<'EOF'
   import re, os, subprocess
   # The "which file is the current app" rule lives ONLY in scripts/lib/app_file.js
   # (pickCurrentAppHtml); this calls it through scripts/print_app_file.js instead of copying it.
   # Two non-testing files tied for the highest version is an error (it exits 1), never a guess,
   # and a check in tests/check_resolve_app_html.js fails if a new hand-copied version appears.
   r = subprocess.run(['node', 'scripts/print_app_file.js'], capture_output=True, text=True)
   if r.stderr: print(r.stderr.strip())
   assert r.returncode == 0, "print_app_file.js failed (see message above)"
   html_path = r.stdout.strip()
   print(f"(auto-detected current app version: {html_path})")
   content = open(html_path).read()
   open('/tmp/extracted.jsx', 'w').write(re.search(r'<script type="text/babel">(.*?)</script>', content, re.DOTALL).group(1))
   EOF
   node -e "
   const babel = require('@babel/core');
   const fs = require('fs');
   const result = babel.transformFileSync('/tmp/extracted.jsx', { presets: ['@babel/preset-react'] });
   fs.writeFileSync('/tmp/out.js', result.code);
   " && node --check /tmp/out.js
   ```
   Run this from the repo root (so `os.getcwd()` and `require('@babel/core')` both resolve
   correctly) and confirm the printed "(auto-detected current app version: ...)" line names the
   file you actually meant to check — don't just trust a green `node --check`.

   **That confirmation stopped being optional on 2026-09-16.** The auto-detect picks the HIGHEST
   dotted version in the repo root, and that is no longer the same thing as the main file.
   Testing versions now live alongside it under higher numbers — `1.67_TESTING` is a testing
   version (per-user filter/view persistence, developed on its own branch), `1.70_Testing` was an
   earlier one. Per Kevin the main deployed file was **1.66** until 2026-09-17, when it was
   renamed to **2.0** for production — so the main file is now the highest dotted version again
   (`2.0` > `1.67`) and the `/testing/i` exclusion is a second, independent guard rather than the
   only thing standing between you and a green check on the wrong file.

   This bug was real and shipped: this snippet, `tests/check_alias_landmines.py`,
   `tests/check_date_timezone_safety.js` and `tests/perf_benchmark.js` all silently validated
   `1.67_TESTING` instead of the file you edited, handing back a green result that proved nothing
   about your change. `38ee3dc` fixed only the regression runner; the other four were found still
   broken on 2026-09-16 and now exclude testing builds too, printing what they skipped. So the
   snippet above should name **2.0**.

   That is a patched symptom, not a cure. The rule still lives in seven hand-synced copies (see
   the comment in the snippet), and it still infers "which file is live" from a version number
   rather than being told. Read the auto-detected filename every single time: if it names a file
   you did not touch, the check did not check your work — see README.md's "Current version" note.
   Replacing the heuristic with an explicit pointer (a committed file naming the live app) is the
   real fix and is still not done.

   **Update 2026-10-04:** the seven hand-synced copies (really ten by then) are gone. The rule now has one
   implementation, `pickCurrentAppHtml()` in `scripts/lib/app_file.js`, and the snippet above calls it through
   `scripts/print_app_file.js`. It still infers the live file from a version number; see
   [2026-10-04: one app-file resolver](#2026-10-04-one-app-file-resolver-ties-are-an-error).

   Use `require('@babel/core')` directly, **not** `npx babel ...`. This repo only has
   `@babel/core`/`@babel/preset-react` installed as libraries (no `@babel/cli`), so in a fresh
   container `npx babel` silently auto-installs and runs an unrelated ancient `babel@5.x` package
   from the registry instead — one that can't parse modern syntax (e.g. `??`) and falsely reports
   working code as broken. Confirmed 2026-08-25.

   This does **not** catch a runtime `ReferenceError`, a broken data computation, or a UI
   regression — it only proves the JSX parses. Do not treat a clean syntax check as "the change
   works."

2. **Alias-landmine check** (required whenever you add or edit a `getVal([...])` call —
   otherwise skip this step): `getVal()`'s substring-fallback pass can match an unrelated real
   column instead of the one you meant, silently, only on rows where the intended column happens
   to be blank — this exact bug class has broken six different fields across two audits (see
   DATA_ARCHITECTURE.md's Class E). Run:
   ```bash
   python3 tests/check_alias_landmines.py <any-current-real-export.xlsx-or-.csv>
   ```
   against whatever real data file you have on hand. It auto-detects the current app version by
   filename. A clean run prints `✅ No landmines found`; any `❌ LANDMINE(S) FOUND` line names the
   exact field/alias to fix before moving on — see DATA_ARCHITECTURE.md's Class E section for the
   fix pattern (drop the alias, or make it specific enough not to substring-collide).

3. **Date timezone-safety check** (required whenever you add or edit an `XLSX.read(...)` call,
   or change how a CSV/xlsx file gets read — otherwise skip this step): SheetJS's CSV parser
   auto-detects an ISO-shaped date cell and round-trips it through a UTC-anchored `Date` object,
   silently shifting it a day in any timezone west of UTC — invisible in a UTC sandbox, which is
   exactly why this went uncaught until Kevin reported it (2026-09-08 — see
   DATA_ARCHITECTURE.md's Class F). Run:
   ```bash
   npm install   # first time only, pulls in the pinned xlsx test dependency
   node tests/check_date_timezone_safety.js
   ```
   Needs no live browser and isn't sensitive to the sandbox's own ambient timezone — it forces
   the timezones itself via subprocess. A clean run prints `✅ PASS`; a `❌ FAIL` names the exact
   `XLSX.read()` call site missing `raw: true` (the fix — see DATA_ARCHITECTURE.md's Class F for
   why that specific flag, and why it must NOT be added to a `type: 'binary'` file-upload call).

4. **Live regression suite** (required, catches actual runtime/data bugs):
   [`tests/booking_flash_regression_tests.js`](../tests/booking_flash_regression_tests.js) —
   structural/invariant checks (not hardcoded-number snapshots) covering Trade Summary, Sector
   Summary, POL Booking Flash, and Booking Flash. Run it against a **live browser** with real
   data loaded, per [HANDOFF.md's Live-testing method](../HANDOFF.md#live-testing-method):
   - Serve the directory over local HTTP (never `file://`).
   - **Pin the app's PRIMARY data source, `CSV_SOURCE_URL`, to its committed fixture
     (`tests/fixtures/live_csv_2026-08-12.csv`). `tests/ci_regression_runner.js` now does
     this unconditionally, and a hand-driven run should too.** The suite uploads
     `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` and asserts against ground truth derived
     from the August reference workbook — but the app also fetches `CSV_SOURCE_URL`, a LIVE
     published Google Sheet, on mount, and `applyCsvText` commits it with an unconditional
     `setRawRows()`. Whether that response lands before or after the upload decides which
     dataset you are measuring. Upload wins → the August data → `Sector_Summary` "Class A:
     Average Max Laden vs Booking" passes. Live wins → today's drifted numbers → the same
     check fails with nothing wrong in the app.

     **This is why that check looked like a "known open failure" for days and was not one.**
     It was caught 2026-09-19 the only way a race like this can be caught honestly: one commit
     ran the suite twice — a `push` run and a `pull_request` run of the *same* code,
     concurrently, finishing three seconds apart — and they disagreed, one green and one red on
     exactly that check. Re-running would never have settled it, and the entry in this file
     recording it as still-open was itself wrong: the job passes on `main`. The drift is
     visible in the record too — the same lane was reported as `avgBkg` 576 on 2026-09-16 and
     561 on 2026-09-19, against a fixed expected 923. **If you find a check here that only
     sometimes fails, look for a live data source before you look for a bug, and before you
     write it down as known.**

     The fixture is generated FROM the sample `.xlsx`, so both orderings deliver the same rows
     and the race stops mattering rather than merely becoming less likely. Verified lossless
     rather than assumed: `parseWorkbookToRows` makes exactly one
     `sheet_to_json({raw:false, defval:''})` pass, and running the `.xlsx` through the upload
     path (binary read) against the fixture through the live path (string read + `raw: true`,
     per `applyCsvText`) gives byte-identical values for all 964 rows × 97 columns — 0
     differences in 93,508 cells. To regenerate it — if the sample `.xlsx` ever changes — run
     `node tests/make_live_csv_fixture.js`, which re-derives it and re-runs that same
     comparison, refusing to write anything if a single cell differs. Never capture what the
     app rendered instead: that freezes a bug in as "expected", the same trap the Sector
     fixture's own note warns about.

     **What it does to the counts below.** Suites 1–9 are unchanged at 75 — it adds no
     assertions, it only makes the existing ones deterministic. Suite 10
     (`Preferences_Persistence`) is a different story: its isolated app instances each made
     their own live `CSV_SOURCE_URL` fetch, so in a network-restricted sandbox most of its
     assertions never executed and it recorded the documented 15 (1 passed, 14 failed). The
     pinned route serves those iframes too, so it now runs in full — **42** — and the whole
     suite comes to **125/125 in this project's own sandbox, matching CI exactly**. That was
     previously impossible here: before the pin the sandbox could not get past Suite 10 at all
     and the 180s result poll expired. Re-derive these from a real run rather than trusting
     them as they age, same as every other count in this section. In Playwright:
     ```js
     await page.route(u => u.href.includes('2PACX-1vQNykGT8bYqwDC4k9loE5L8'),
         r => r.fulfill({ status: 200, contentType: 'text/csv', body: liveCsvFixtureText }));
     ```
   - **Optionally pin the sector data source to its committed fixture.** The Sector
     Summary's right-hand pivot is fed by a LIVE published Google Sheet
     (`SECTOR_DATA_CSV_URL`), so its numbers drift week to week. Route that request to
     `tests/fixtures/sector_data_2026-09-16.csv` and set
     `window.__BFRT_SECTOR_FIXTURE__ = true` before first paint, and the suite adds an
     exact column-mapping check against that fixture. In Playwright:
     ```js
     await page.route(u => u.href.includes('2PACX-1vTHQ6pKVIaNKU3DiTaLFrqKJS'),
         r => r.fulfill({ status: 200, contentType: 'text/csv', body: fixtureCsvText }));
     await page.addInitScript(() => { window.__BFRT_SECTOR_FIXTURE__ = true; });
     ```
     Adds exactly 1 check over the unpinned baseline (the exact column-mapping
     comparison), which is skipped (not failed) on an unpinned run because today's live
     Sheet cannot be meaningfully compared against a committed snapshot. See the test
     file's own note above `SECTOR_RIGHT_FIXTURE_GROUND_TRUTH` for why this check is
     pinned rather than loosened, and how to refresh the fixture.
   - **Optionally pin the historical-archive data source to its committed fixture,
     eliminating this suite's own 8-second network race (2026-09-16).** SUITE 9
     (`Historical_Data`) opens the "🗓️ Historical Data" popover and depends on
     `HISTORICAL_DATA_CSV_URL` (a LIVE published Google Sheet, a rolling multi-date
     archive -- see that constant's own comment in the app for the shape) actually
     responding. It used to poll up to 8 seconds for EITHER real date buttons (fetch
     succeeded) OR an error banner (fetch failed), and if the wait simply timed out --
     neither appeared -- it silently skipped the whole suite with **zero** `record()`
     calls, identical in shape to the archive being cleanly unreachable. That silently
     swallowed all 4 potential checks in this suite whenever the archive was merely
     *slow* to respond (reachable, just not within 8s), not only when it was genuinely
     down -- a run could report "68/68, all green" while this entire suite never ran,
     indistinguishable from a run where it ran and passed. See HANDOFF.md's own writeup
     of this fix for the full defect analysis and why the unpinned/genuinely-unreachable
     path (a real error banner, e.g. this sandbox's own inability to reach
     `docs.google.com`) still gets a **legitimate silent skip** -- only the
     reachable-but-slow/ambiguous timeout case was closed, and it now records an
     explicit, loud, failing check instead of vanishing.
     Route the request to `tests/fixtures/historical_data_2026-08-24_to_2026-08-26.csv`
     and set `window.__BFRT_HISTORICAL_FIXTURE__ = true` before first paint, and the
     suite adds 2 exact fixture checks (the popover's own date list, and each fixture
     date's Booking Flash row count) on top of the 4 checks that already run once the
     archive is confirmed reachable. In Playwright:
     ```js
     await page.route(u => u.href.includes('2PACX-1vR1YNb3SKa8jS53bK'),
         r => r.fulfill({ status: 200, contentType: 'text/csv', body: historicalFixtureCsvText }));
     await page.addInitScript(() => { window.__BFRT_HISTORICAL_FIXTURE__ = true; });
     ```
     A local fixture response is effectively instant, so the pinned path never comes
     anywhere close to racing the 8-second timeout -- that value is otherwise unchanged,
     still a reasonable safety net for a genuinely unreachable/ambiguous unpinned run.
   - **Expected executed-check counts, measured live against this repo's real sample
     export** (`Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx`) **with neither, either, or
     both fixtures pinned** -- re-verified 2026-09-24 in a network-restricted sandbox
     (`BF_VENDOR_CDN=1`, so the CDN scripts load from a local vendored copy instead of
     failing the TLS-interception check; see the `BF_VENDOR_CDN` note earlier in this file)
     against `Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html`, all 4 combinations still
     fully green -- these numbers move as suites elsewhere in the file gain or lose checks
     over time; re-derive them from a real run rather than trusting a stale copy here, per
     "Check the executed-check count, not the pass rate" below:
     | Sector fixture | Historical fixture | Suites 1-9 executed checks |
     |---|---|---|
     | unpinned | unpinned (or genuinely unreachable) | 89 |
     | **pinned** | unpinned | 94 |
     | unpinned | **pinned** | 95 |
     | **pinned** | **pinned** (what `tests/ci_regression_runner.js` does) | 101 |

     **2026-09-25: every row +5** (was 66/71/72/77). POL Booking Flash is now windowed -- it
     mounts only the rows near its scroll position -- and `POL_Booking_Flash` (Suite 3) gained
     5 checks of the windowing itself. Only the pinned/pinned row was re-measured (82, in a full
     **174/174** run, source and `dist/index.html`); the other three are that run's +5 applied,
     which is safe only because those 5 checks read neither fixture. Re-measure them before
     relying on them.

     **2026-09-26: every row +2** (was 71/76/77/82). `Booking_Flash` (Suite 4) gained a check
     that "Current Laden Utiliz %" equals (Short_Fall + Max LDN) / Max LDN on every row, and
     `Compare` gained one that its "Vessels" tile excludes the `VMS` placeholder VVD -- both from
     that day's data-mapping audit (see DATA_ARCHITECTURE.md). Neither reads the Sector or
     Historical fixture, so both apply to every row; only pinned/pinned was re-measured (84, in a
     full **176/176** run, source and `dist/index.html`).

     **Same day, every row +10 more** (was 73/78/79/84). `Analyze_BookingFlash` and
     `Analyze_POLBookingFlash` (Suites 5 and 6) each gained 5 checks that rebuild every Analyze card
     from the tab's own visible table -- capacity, laden, peak, the "N in W wks" count, and the
     click-to-expand vessel list. The pre-existing Analyze checks only proved the modal agreed
     with itself, which is how a port reading 117% against a real 35% passed them all. Neither
     fixture is read, so all four rows move; only pinned/pinned was re-measured (94, in a full
     **186/186** run, source and `dist/index.html`). Against the pre-fix app, 8 of the 10 fail.
     Then +1 more (every row): `Analyze_BookingFlash` checks that the default week window ends at
     the current sale week from the data's Past 4 Week Flag -- **187/187**, source and artifact.
     Then +2 (every row): the By week / By port peak toggle, rebuilt from the POL table and
     switched back -- **189/189**, source and artifact.
     Then +3 (every row): `Compare`'s KPI tiles were aligned with the Analyze modal's Overall
     Snapshot (one shared calculation -- see DATA_ARCHITECTURE.md's "Compare aligned with
     Analyze"), with checks that the tiles reconcile, match an independent recompute from the
     compare fixtures, and equal the live Analyze modal on the same rows -- **192/192**, source and
     artifact. None reads the Sector or Historical fixture; only pinned/pinned was re-measured.
     Against a copy with Compare's divisor deliberately drifted from Analyze's, 2 of the 3 fail.
     Then **2026-09-27**, re-measured with `scripts/run_ci_locally.js`: pinned/pinned is **101**
     (#129 added 1 `Analyze_BookingFlash` check), and two suites outside 1-9 arrived with #128/#129
     -- `Fields_Picker_ReAnchor` (6) and `VVD_Gmail_Debounce` (4) -- for a total of **203/203**,
     source and artifact. The other three rows are the 100-row values +1 by the same reasoning as
     above; re-measure before relying on them. Current per-suite numbers: see "Running CI locally".
     Then Suites 13-14 (VVD Gmail link, Fields picker; #128) took the full run to **202**, and
     +1 (every row): `Analyze_BookingFlash` checks the vessel list's per-port sub-rows against
     the POL table (same legs, same Current Laden) and their Vessel total -- **203/203**, source
     and artifact. Reads neither fixture; only pinned/pinned was re-measured.
     Then **2026-09-30**, +1 (every row): `Analyze_BookingFlash` checks that the vessel list has
     one header for every row. Kevin's report: columns added from "Add Columns" were named only
     in the port calls' own nested header, whose columns lined up with nothing in the list's
     header above. The port calls became rows of the list's own table; the check adds Port Cut
     through the real menu and requires every checked column in the header, every row
     (vessel, port call, Weekly average) spanning exactly the header's columns, and a date
     under "Port Cut" on a port row -- **271/271** on the full local run. Same day, per Kevin
     ("more uniform and in clear line of sight"), the vessel row became the summary row: its
     totals sit in the same columns as its port rows, replacing a separate "Vessel total" line
     that put the vessel's figures on two staggered rows; the port-row check now reads the
     vessel row's Current Laden as the total its port rows must add up to.
     All 4 combinations were verified fully green (every executed check passing) except
     the deliberately-broken negative-test case described in HANDOFF.md. Compare counts
     within the same pinning combination, not across them -- pinning either fixture only
     ever *adds* checks over the unpinned baseline, never removes any.

     **Why these moved from the 68/69/74/75 last recorded here (2026-09-16), and what did
     NOT move.** Two independent things changed between that verification and this one, and
     it matters which row each one shows up in. Isolating `Sector_Summary`'s and
     `Historical_Data`'s own contributions from everything else in Suites 1-9 (`Trade_Summary`
     + `POL_Booking_Flash` + `Booking_Flash` + `Analyze_BookingFlash` +
     `Analyze_POLBookingFlash` + `Trade_Summary_CommaGuard` + `Compare`, none of which touch
     either fixture) makes both changes exact rather than approximate:
     1. **That fixed group gained +2 checks** (54→56 checks) from ordinary, unrelated suite
        growth elsewhere in the file since 2026-09-16 -- nothing to do with Sector Summary.
        This shows up as +2 in EVERY cell of the table, pinned or not, since it's independent
        of both fixtures. `Historical_Data` itself is completely unchanged (6 checks pinned, 0
        -- a clean, by-design silent skip -- when unreachable, same as 2026-09-16).
     2. **`Sector_Summary`'s own unpinned count dropped from 14 to 10** (its pinned count is
        unchanged at 15, both before and after) because of a real behavior change, not drift:
        `Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html`'s `sectorSourceRows` state
        (~line 5078) no longer seeds itself from the hardcoded `SECTOR_DATA_SEED` snapshot
        before `SECTOR_DATA_CSV_URL`'s live fetch first succeeds (Kevin: "We can only show
        real numbers and not hard coded numbers" -- the old seed fallback meant a transient
        fetch blip rendered 6+-week-stale hardcoded numbers indistinguishably from live data).
        So on an unpinned run the right-hand "Sector Summary" pivot can now be genuinely,
        correctly empty, which this sandbox's real inability to reach `docs.google.com`
        confirms on every unpinned run. Of the 5-check gap between pinned (15) and unpinned
        (14) that already existed before this change, only 1 was the always-skipped
        pinned-fixture exact-match check (gated purely on `window.__BFRT_SECTOR_FIXTURE__`,
        unaffected by any of this); `tests/booking_flash_regression_tests.js`'s
        `Sector_Summary` suite (~line 790) was updated the same day so the other 4
        (leaf parse, rollup identity, non-negative values, open-space-vs-alloc) ALSO skip
        cleanly -- zero `record()` calls -- whenever the app's own `sectorFetchError` banner
        confirms the fetch failed, the exact same confirmed-unreachable convention
        `Historical_Data` (Suite 9) already used, rather than hard-failing against a now
        legitimately-empty pivot. That is the new 15→10 (not 15→11) unpinned count. Verified
        live in this same sandbox: the `sectorFetchError` banner reliably appeared before the
        `Sector_Summary` suite ran on every unpinned run this session, so each one hit the
        clean skip path, never the loud "ambiguous-empty" failure that same code records if
        the banner is absent and the pivot is still empty (that branch was not exercised this
        session; re-verify it with a real run if this sandbox's unreachability characteristics
        ever change).

     **Suites 10 and 11 (`Preferences_Persistence`, `Field_Visibility`) are layered on top of
     every row above, unaffected by Sector/Historical fixture pinning** -- each has its own,
     independent fakes/skip conditions (see their own header comments) -- add their own executed
     counts to whichever row above applies. Re-verified after merging PR #85 (server-backed
     preferences + the historical-archive Web Worker) and PR #82 (field-visibility picker) into
     this Historical Data fixture-pinning fix, and after fixing a real race condition the merge
     surfaced in this suite's own popover-scoping logic (2026-09-16, see HANDOFF.md's dated
     writeup for the full story): **91 executed / 77 passed unpinned, 98 executed / 84 passed
     pinned** (Sector+Historical). Suites 1-9 came back byte-for-byte identical to the table
     above (all 68, resp. all 75, passing); `Field_Visibility` contributed a clean 8/8 in both
     runs (it depends on none of this doc's fixtures); `Preferences_Persistence` contributed its
     own 15 (1 passed, 14 failed) in both runs. Those 14 failures are **environment-driven, not a
     regression**: `Preferences_Persistence` boots FRESH, isolated app instances per scenario (see
     its own header comment), and each of those instances makes its own independent live fetch
     attempt (`CSV_SOURCE_URL`) that this verification sandbox's headless Chromium cannot
     complete -- the exact same `docs.google.com`-unreachable category already documented above
     for Sector/Historical, just now also affecting a suite that (correctly, by design) never
     skips silently: each blocked scenario still records its own loud Setup failure instead of
     vanishing, and the suite's own hardcoded tripwire (`Exactly 41 assertions...`) correctly
     reports the shortfall (`recordedCount: 14` vs `expected: 41`) rather than passing falsely.
     This exact 14-failure signature was independently reproduced by a different session merging
     PR #82 (see its own commit `8f41d0f`), confirming it as a real, environment-specific,
     reproducible characteristic of a network-restricted sandbox rather than session-specific
     flakiness. In an environment with real network access (e.g. GitHub Actions), Suite 10's own
     41 checks should mostly execute and pass instead. Re-derive both totals from a real run
     rather than trusting these numbers as they age, same as the table above.

     **Superseded 2026-09-19, and worth reading as a lesson rather than just a correction.**
     Everything above is an accurate description of what was observed, and the conclusion drawn
     from it — "environment-specific, reproducible, not a bug" — was still the wrong place to
     stop. The 14 failures were never really about network access being absent; they were about
     the suite leaving a live data source unpinned, which the sandbox merely exposed sooner and
     more loudly than CI did. Pinning `CSV_SOURCE_URL` (see the first bullet of this check)
     serves those isolated iframe instances too, and Suite 10 now runs in full at **42/42 in
     this very sandbox**, total **125/125** — identical to CI at the time. Two independent
     sessions had reproduced the 14-failure signature and agreed it was environmental, which
     is exactly what made it feel settled. Reproducibility told us the *cause was stable*; it
     never told us the cause was external, and no amount of re-running would have
     distinguished the two. (The 125 total itself has since moved to **127**, then **164** --
     see the 2026-09-24 note above the table (+2 from unrelated suite growth) and the
     2026-09-24 Suite 12 note just below this paragraph (+37, `Filter_Persistence`), both
     unconnected to this paragraph's own subject. The lesson above is unaffected by that drift.)

     **Suite 12 (`Filter_Persistence`) added 2026-09-24**, alongside the filter-saving feature
     it covers (`FilterPrefsStore`, ported from `Booking_flash_report_na_1.67_TESTING.html`'s
     `ViewPrefsStore`, scoped down to filters only -- see HANDOFF.md's dated entry for the full
     scope decision). Like Suite 10/11, it's layered on top of every row in the table above,
     unaffected by Sector/Historical fixture pinning -- it depends on nothing but this page's
     own HTML and `localStorage`, no live data source at all, so it has no legitimate reason to
     ever skip. Originally contributed **37** (36 assertions + its own hardcoded tripwire) to
     every row, for a first total of **164/164**, verified against both the source file and the
     rebuilt `dist/index.html` artifact. Building this suite surfaced a real, confirmed bug in
     the port it was written to cover -- a pre-existing, unrelated effect (search "yard
     mount-guard effect" in the app) silently discarded a restored Yard selection whenever
     `yardSearchText` restored empty -- fixed the same day (ported from `1.67_TESTING`'s own
     identical 2026-09-15 fix for the same effect). The suite's Scenario 1 and Scenario 2 assert
     the fixed behavior directly.

     **Grew again the same day (37 → 42, total 164 → 169) after a code-review pass found and
     fixed 4 more confirmed bugs in `FilterPrefsStore` itself** -- see HANDOFF.md's own dated
     addendum ("Filter persistence code-review pass...") for the bug-by-bug writeup; summarized
     here only as the count change. A new Scenario 1b (a valid, version-matching, but
     all-default-shaped seeded blob) covers the `wasRestored()` banner false-positive fix. The
     existing live-toggle scenario (Scenario 5) now boots with a real filter already active,
     turning its existing "does topPanelCollapsed:true actually get written" check into a
     genuine regression test for the write-path hazard-rule fix, and reuses that same instance
     for two more quick clicks that land back on already-written content, asserting the stored
     blob's own `savedAt` does not change -- the direct check for the byte-identical-write-guard
     fix. The existing corrupted-blob scenario (Scenario 2) now seeds one real value plus one
     stale one into `selectedLanes` and asserts only the stale one is pruned once real data
     loads -- coverage for the pre-existing stale-multi-select-value gap
     (`usePruneStaleSelection`). Only 1 of these 4 additions needed a new iframe boot (Scenario
     1b); the other 3 extended existing scenarios/boots, per this suite's own iframe-count
     budget (see its header comment). Verified live 2026-09-24: **169/169** against the source
     file (`BF_VENDOR_CDN=1 node tests/ci_regression_runner.js`, exit code 0) -- re-derive this
     from a real run rather than trusting it as it ages, same as every other count in this
     section, and read this suite's own header comment + hardcoded `EXPECTED_RECORD_COUNT` for
     its current per-suite count rather than this paragraph once it's had time to go stale.
   - **The POL table is windowed, and the suite renders it in full (2026-09-25).** POL Booking
     Flash mounts only the rows near its scroll position (see `POL_VT_OVERSCAN` in the app).
     Every POL check here asserts something over every rendered row, so against a windowed
     table they would quietly check ~100 of 1,398 rows and still pass. The suite therefore
     dispatches `window` event `bookingflash:pol-render-all` (`detail: true`) when it starts and
     `false` in a `finally` when it ends; `POL_Booking_Flash` switches it off just long enough
     to test the windowing itself (5 checks: rows mounted < total, spacer height exact, rowSpan
     column grid intact at top/middle/bottom, same first visible row as the full render at the
     same scroll position, column widths identical everywhere). **If you add a POL check that
     reads rows from the DOM, it must run while render-all is on** -- i.e. anywhere except
     inside that windowing block -- or it silently loses coverage.
   - **Start from clean browser storage** — a fresh browser context, or clear the app's
     `localStorage` keys (the `bookingFlash*` ones) before loading. The app persists view state
     per browser, so a profile carrying saved preferences can start the suite with non-default
     filters or hidden columns. Filters are the real risk, not columns: the suite clears filters
     itself at setup but never resets column visibility, and a leaked slicer selection filters the
     table so whole suites abort at setup — producing exactly the low-executed-check-count
     signature described below, which reproduces identically on re-run and so reads convincingly
     like a real bug.
   - If the sandbox can't reach the CDN scripts directly (common in an isolated agent
     environment), fetch React/ReactDOM/Babel-standalone/Tailwind/SheetJS once via whatever
     proxy is available, save them locally, and swap the `<script src="https://...">` tags in a
     throwaway copy of the HTML to point at the local files — never edit the CDN URLs in the
     real file.
   - Simulate a file upload (`fetch()` the sample `.xlsx`, build a `File`/`DataTransfer`, assign
     to the hidden `<input type=file>`, dispatch `change`) — a real OS file picker isn't
     automatable.
   - Inject `tests/booking_flash_regression_tests.js` (e.g. Playwright's `page.addScriptTag`,
     or `page.evaluate` on its source text) — the file **self-invokes once** the moment it's
     injected/pasted (its own trailing call at the bottom). **Do NOT also call
     `runBookingFlashRegressionTests()` yourself afterward** — the file now guards against a
     second concurrent call (returns the in-flight run's own result instead of starting a
     second copy), but a script written before that guard existed, or a fresh eval context
     without it, would run TWO unsynchronized copies of the suite at once, each independently
     clicking tabs and opening/closing the Analyze modal — a race that produced a stable,
     IDENTICAL-every-time 9-failure signature in this sandbox (root-caused 2026-09-15; see the
     test file's own "DOUBLE-INVOCATION GUARD" comment). Read the result via
     `window.__bfrtLastResult` (poll it after injecting — `null` until the self-triggered run
     finishes) or by scraping console output for the `✅ ALL TESTS PASSED` / `❌ SOME TESTS
     FAILED` line, not by calling the function and awaiting its return value directly.
   - Read the returned report / console output for `❌ FAIL` lines.
   - **Read the executed-check COUNT, not just the pass rate** — see "Check the executed-check
     count, not the pass rate" below. A run reporting `28/32` is not a mostly-passing run when
     the suite contains ~75 checks; it's a run where whole suites aborted before they started.

   **A change is not done until this suite runs clean against it** (see the exception below for
   known flakiness). If a change intentionally alters what a check asserts (e.g. removing a UI
   element the check depended on, as happened when the Grand Total rows and Sector Summary's
   KPI cards were removed on 2026-08-24), **update the test alongside the app change in the same
   commit** — don't leave the suite asserting stale behavior. A failing check that still makes
   sense for the new behavior means the app has a bug; a failing check that no longer makes
   sense for the new *intended* behavior means the test is stale and needs updating, not
   silencing.

5. **Row-highlight interaction budget** (`tests/perf_highlight_benchmark.js`) — required only
   when a change touches row highlighting, the row components' props, or how the two big tables
   render their rows. It is a **blocking** CI job (`highlight-perf` in `ci.yml`), unlike the
   regression suite above, because it is a deterministic script with a numeric threshold rather
   than a long assertion sweep, so it doesn't have that job's false-failure shape.

   ```bash
   node tests/perf_highlight_benchmark.js          # ~6 min; needs the historical CSV
   ```

   It exists because clicking one row to highlight it once froze the page for ~41 seconds and
   **nothing in `tests/` would have caught it** — there was zero coverage of that interaction.
   The bug: a table-wide boolean (`anyRowHighlighted`) passed as a prop to every row, which
   defeats `React.memo` for all ~9,232 POL rows simultaneously on the 0->1 transition. That
   shape — a value that is the same for every row, threaded through per-row props — is the
   thing to watch for; it costs SECONDS, so a failure here is a design regression, not drift.
   CI scales the budgets via `BF_HIGHLIGHT_BUDGET_SCALE` (shared runners are slower); read the
   printed per-transition numbers before ever touching that value. Budgets are per-tab (POL
   8000ms, Detail 1500ms) because the two tables differ by ~20x in size and a single bar would
   leave the smaller one effectively ungated.

   **It measures click→PAINTED, not click→DOM — and that distinction hid a 2.7-second cost for
   a full day (2026-09-19).** A `requestAnimationFrame` callback runs at the *start* of a frame,
   *before* style, layout and paint. So the first rAF that observes the new DOM fires before the
   browser has done any of the work to show it, and a clock stopped there scores roughly a
   quarter of the interaction. On the pre-fix build the first highlight reported 533.6ms of
   React work with 3,521.6ms of rendering after it, and only the first number was gated. If you
   add a timing harness to this repo, wait the extra frame.

   **New bug class: a first-use Tailwind utility costs a whole-document style recalc.**
   `cdn.tailwindcss.com` is the Play CDN — it compiles a utility class the first time that class
   appears in the DOM and *inserts the rule into its stylesheet*, and Blink answers any
   stylesheet rule change with a full-document style invalidation. The cost therefore scales
   with the document, not with the change. Measured on the POL tab (~221,000 elements), adding
   one class to a single hidden `<div>`:

   | | time | rules added |
   |---|---|---|
   | an already-compiled utility | 316.0ms | 0 |
   | a never-seen utility | 3,215.8ms | 1 |
   | another never-seen utility | 3,246.1ms | 1 |
   | re-adding the first, now compiled | 316.7ms | 0 |

   Conditionally-rendered UI is what trips it, since its classes are absent until it first
   appears — the floating "N highlighted / Clear" button alone cost the first row highlight a
   2.6–5.1s restyle of 221,512 elements. The app now primes the JIT at load from its own source
   (see the block at the bottom of the app file); **do not delete that div**, and be aware that
   priming normalises Tailwind's rule order, which is what exposed the two HANDOFF Class B
   colour collisions fixed the same day. If you introduce UI that only ever renders
   conditionally, its classes are already covered as long as they appear literally in a
   `className` attribute or as a utility-shaped token in a string literal.

   **Two things the old header asserted that turned out to be wrong**, both recorded here
   because each cost a day. (a) "0→1 is bimodal, not noisy" — it was sustained machine load;
   running the same transition 8x in one session shows every round moving together by ~5x
   between a busy and an idle box, which a second code path cannot do to rounds 2–8.
   (b) "The remaining cost is React rebuilding ~9,232 element descriptors, fix it with a
   memoized row array" — built and measured at ~7% on 0→1 and nothing on Clear, inside the
   run-to-run spread, and reverted. **Trace before theorising**: both of these survived
   plausible-sounding reasoning and died on the first real Chrome timeline trace.

   **Do not reason about this table's size from the Detail-tab row counts** quoted above
   `DetailTableRow` in the app file. Detail aggregates 8,769 raw rows down to 463; **POL Booking
   Flash does not aggregate at all** and renders 9,232 `<tr>` / 193,467 `<td>` for the same
   file. Reusing the Detail figure is what left POL un-virtualized and made this bug possible.
   **Update 2026-09-25: POL is now windowed** -- ~60-130 of those rows are mounted at a time
   (see `POL_VT_OVERSCAN` in the app and PERFORMANCE_REVIEW.md's Pass 4). The figures above are
   still what the table *would* be, and still what Excel export (built from data, not the DOM)
   and the regression suite (which switches it to render-all) see. This benchmark switches POL to
   render-all too (2026-09-26): against the ~120 mounted rows, the memo-defeat bug it exists to
   catch would cost milliseconds and sail under the budget.

   **It can also test `dist/index.html`, not just the source.** Like `perf_benchmark.js` and
   `ci_regression_runner.js`, this script now resolves which app file to load via
   `resolveAppHtml()`, so `BF_APP_HTML=dist/index.html node tests/perf_highlight_benchmark.js`
   runs the exact same budgets against the deployed artifact -- the file whose script
   structure/order the Tailwind-priming guard above actually depends on. CI now exercises this:
   `highlight-perf` runs the benchmark twice, once against the source and once against
   `dist/index.html`, both blocking. Measured 2026-09-20 on a quiet machine, the artifact's
   per-transition numbers matched the source's to within ordinary noise and both sat well under
   ~25-28x below budget -- see `.github/workflows/ci.yml`'s `highlight-perf` job for the full
   numbers.

6. **Rebuild the deploy artifact** (required after ANY change to the app file):

   ```bash
   node scripts/build_deployable.js          # writes dist/index.html
   node scripts/build_deployable.js --check  # what CI runs: fails if the committed copy is stale
   ```

   `dist/index.html` is the file Apps Script actually serves (see `apps-script/README.md`). It is
   the same app with its JSX compiled ahead of time instead of by Babel Standalone in the
   browser on every load. That in-browser compile measured at **5,261 ms of one unbroken
   main-thread task per load** on 2026-09-19 — before any data appears, paid by every user on
   every tab regardless of filters, saved preferences or dataset size. Precompiled, the first
   React commit drops 5,858 ms → **416 ms** and the longest task 5,261 ms → **258 ms**.

   **Edit the source, never the artifact.** The versioned file in the repo root is still the
   file you change, still JSX, and still loads fine over the local static server with no build
   step — local development is unchanged. The artifact is generated and carries a
   `DO NOT EDIT` banner naming its source file and SHA-256.

   **It is committed, which is the whole reason `--check` exists.** Committing it keeps the
   manual deploy a copy/paste with no tooling on Kevin's machine — and makes it possible to
   change the app, pass every other check, and quietly deploy stale code. The blocking
   `deployable-build` CI job rebuilds in memory and diffs, so that fails loudly instead. If you
   change the app file and don't re-run the build, CI will tell you.

   Three things about the build are load-bearing and easy to undo by accident — each explained
   at length, with the full reasoning, in `scripts/build_deployable.js`'s own header. Read that
   before changing any of them; summarized here only so you know what to watch for:
   - The output is ES5 and `"use strict"`, matching what babel-standalone produces today —
     required by this file's hook ordering.
   - The inert `<script type="text/babel">` block stays in the artifact — check 5's Tailwind JIT
     primer reads the app's source through it.
   - The compiled script goes last, after the primer — preserves the original parse-time-primer,
     DOMContentLoaded-app order.

   Verified against the artifact, not just the source: `BF_APP_HTML=dist/index.html
   BF_VENDOR_CDN=1 node tests/ci_regression_runner.js` → **169/169** (**174/174** since the
   2026-09-25 POL windowing checks, **176/176**, then **186/186**, then **187/187**, then **189/189**, then **192/192**, since the 2026-09-26 audit, Analyze and Compare checks, and **203/203** on 2026-09-27 -- see check 4 and "Running CI locally"), matching check 4's
   expected count exactly (re-verified 2026-09-24, same day as the Suite 12 code-review pass
   that grew the suite from 164 to 169 -- see check 4's own Suite 12 note above; this line had
   already drifted once before, from a stale 125 left for a few commits after an earlier
   growth -- re-derive it from a real run rather than trusting it as it ages, same as check 4's
   own numbers). `BF_APP_HTML` exists for this; the artifact lives outside the repo root and so
   is invisible to every auto-detect in this repo.

   CI does this too — the `regression-suite` job runs the suite **twice**, once against the
   source and once against `dist/index.html`. Without the second run the chain is one link
   short: `deployable-build` proves the artifact matches a fresh build, and the first run proves
   the source behaves, but nothing exercises the artifact itself, whose script structure
   genuinely differs. A change to the build script could otherwise break what users load with
   every check still green. (Check 5's Tailwind-priming guard has the same second run now, in its
   own `highlight-perf` job — `tests/perf_highlight_benchmark.js` gained a `BF_APP_HTML`
   equivalent alongside this one, and CI runs it against `dist/index.html` too, blocking.)

   `BF_APP_HTML`'s resolution logic itself — `resolveAppHtml()` in `tests/perf_benchmark.js`, which delegates auto-detection to `scripts/lib/app_file.js` — is
   checked headlessly by `node tests/check_resolve_app_html.js` (blocking in CI). A live browser
   run only ever exercises its two success paths; that check covers the two failure paths (an
   absolute override, a nonexistent one) and the exact override-flattening bug class the function
   exists to prevent, none of which a green regression-suite run would ever catch on its own.

### Running CI locally (`scripts/run_ci_locally.js`)

**Added 2026-09-27, because GitHub Actions stopped running.** From at least 2026-09-26 18:00 UTC
every CI run on this repo -- `main` included -- failed in ~3 seconds with no runner assigned and
**0 ms billable**: an account-level block (Actions minutes / spending limit), not the code. PRs
#125, #127 and #128 all merged with no CI having executed. The first local run of this script on
`main` then found a real failure CI would have caught: `Fields_Picker_ReAnchor` (added in #128)
asserted the popover's left edge equals its trigger's, ignoring the app's own keep-on-screen
clamp, so it failed at a 1280px viewport on both source and `dist/index.html` (fixed in #130).
**If CI shows every job failing in seconds with 0 ms billable, it did not run -- check the account's
billing, and run this script before merging anything.**

What it does: runs every job in `.github/workflows/ci.yml`, in order, with the same commands, and
prints one pass/fail table. Exit code 0 means every blocking job passed.

| Job | Blocking? |
|---|---|
| Syntax check (source) | yes |
| Deployable build up to date + syntax-check of the compiled payload | yes |
| Alias-landmine check (needs `openpyxl`) | yes |
| Field-picker filter-gating, server-prefs logic, Compare KPIs, app-file resolver, timezone safety | yes |
| Live regression suite -- source | no (informational, as in CI -- see "Known flakiness") |
| Live regression suite -- `dist/index.html` | yes |
| Row-highlight budget -- source and `dist/index.html` | yes |

**On your own computer** (Node 22, Python 3), from the repo root:

```bash
npm ci                              # first time, and after package.json changes
npx playwright install chromium     # first time only
pip install openpyxl                # first time only (python3 -m pip ... if pip isn't on PATH)
node scripts/run_ci_locally.js           # everything, ~5 min
node scripts/run_ci_locally.js --fast    # skip the 4 browser jobs, ~10 s
node scripts/run_ci_locally.js --ci-budgets   # highlight budgets scaled 1.5x like CI's runners
```

Works on macOS, Windows and Linux (it's Node, not bash; it finds `python3` or `python`).

**In a cloud agent session** (Claude Code on the web and similar sandboxes), two env vars are
usually needed, both already documented for the runner:

```bash
BF_VENDOR_CDN=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/run_ci_locally.js
```

`BF_VENDOR_CDN=1` loads the app's CDN scripts from `tests/vendor/` (the sandbox's TLS
interception blocks the real CDNs); `PW_CHROMIUM_PATH` points Playwright at the pre-installed
Chromium when the pinned `playwright` version expects a different browser build (the symptom is
`Executable doesn't exist at .../chromium_headless_shell-NNNN`).

**Last full run: 2026-09-27, on `main` at `5288e1b` merged with #130 -- every job passed,
regression suite 203/203 on both source and `dist/index.html`.** Per-suite: Trade_Summary 6,
Sector_Summary 15, POL_Booking_Flash 16, Booking_Flash 10, Analyze_BookingFlash 18,
Analyze_POLBookingFlash 14, Trade_Summary_CommaGuard 3, Compare 13, Historical_Data 6 (Suites 1-9 =
101), Preferences_Persistence 42, Field_Visibility 8, Filter_Persistence 42,
Fields_Picker_ReAnchor 6, VVD_Gmail_Debounce 5 (204 total since 2026-09-28). Compare your own run's per-suite counts against
these, not just the total (see "Check the executed-check count" below).

**Update 2026-09-29 (regression suite only; not a full `run_ci_locally.js` run): 267 checks** --
Trade_Summary 6, Sector_Summary 15, POL_Booking_Flash 16, Booking_Flash 10, Analyze_BookingFlash 18,
Analyze_POLBookingFlash 14, Trade_Summary_CommaGuard 3, Compare 13, Historical_Data 6,
Preferences_Persistence 42, Field_Visibility 8, Filter_Persistence 42, Gmail_Search_Debounce 9,
Fields_Picker_ReAnchor 6, Calendar_Event_Link 6, Server_Extras_UI_Gating 3, Historical_PerDay_Archive 12,
**Apps_Script_Team_Features 38** (new: the Apps Script data feed, VVD notes, startup-error log and
config Sheet, in two isolated iframe boots against a fake `google.script.run`; 37 checks plus its own
tripwire). Measured with `BF_VENDOR_CDN=1 node tests/ci_regression_runner.js`, source (~111s) and
`BF_APP_HTML=dist/index.html` (~51s): **267/267 on both, every pre-existing suite unchanged**, plus
every `--fast` job green. The suite's first run was 266/267: its "Excel export (Detail)" check caught
Detail's export scraping the live table, so a noted VVD exported as `FOWT0529S📝`. Fixed in the app
(exportToExcel strips `[data-vvd-notes]` from a detached copy), not by loosening the check. The
runner's poll timeout went 180s -> 240s.
Then the speed review's fixes (same day) added 3 Suite 18 checks -- the notes load waits for the data,
an unchanged Refresh Now parses nothing, and a direct fallback is never undone by an older server copy --
for **270/270 on both**, `Apps_Script_Team_Features` **41**. Each of the 3 fails against a copy of the app
with its fix reverted, and only that one. `check_team_features_logic.js` is **168** (the data feed's
30-minute/hourly schedule, meta-before-chunks reads, `notOlderThanMs`).

**2026-09-28: click-to-search-Gmail generalized from VVD-only to also cover Vessel Name** (per
Kevin) -- same shared debounce and delegated listener as the VVD feature (see CODE_NOTES.md's
"Gmail-Search Clickable Cells: URL, Debounce, And Delegated Listener"), driven off a common
`data-gmail-search` attribute so the two fields don't duplicate the listener/debounce block.
`Suite 13` was renamed `VVD_Gmail_Debounce` -> `Gmail_Search_Debounce` and gained 4 checks for
Vessel Name (5 -> 9); `EXPECTED_TOTAL_CHECKS` in `tests/ci_regression_runner.js` moved 204 -> 208
accordingly. Re-verified the same day against both `Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html`
and the rebuilt `dist/index.html`: **208/208 on both**, zero count mismatch (no suite aborted at
setup), `Gmail_Search_Debounce`'s own 9 checks all passing on both runs -- including the check that
clicking a Vessel Name cell right after the VVD debounce tests above (different string, same 800ms
window) still opens Gmail, proving the shared debounce is keyed on value rather than "any prior
Gmail-search click." No other suite's count moved. `checks 2/3` (alias-landmine, date-timezone) are
out of scope for this change (no `getVal(`/`XLSX.read(` touched).

**Keep it in step with `ci.yml`.** A job added to `ci.yml` and not to this script is a check nobody
runs while Actions is down -- the same "a required check that runs only when someone remembers is
not a required check" rule as above. The script's header lists what it deliberately does
differently (the regression-suite-on-source job is informational, and highlight budgets are
unscaled unless `--ci-budgets`).

**2026-09-28: Apps Script Services integrations added** (per Kevin, using the same "click a VVD to
search Gmail" client-only pattern as a jumping-off point): server-backed `FilterPrefsStore` sync
(extends the existing three-boolean server-prefs pattern to the filter blob), an on-demand "Export to
Drive" button (`DriveApp`/`SpreadsheetApp`, an auto-created "Booking Flash Snapshots" folder), and an
"Add to Calendar" deep link. Full design reasoning, the exact new `Code.gs` functions, and the
`window.__SERVER_EXTRAS__` shape are in `docs/SERVER_PREFS_CONTRACT.md`'s "Addendum (2026-09-28)"
(deliberately NOT part of the frozen contract above it) and `apps-script/README.md`'s own new section.

**A schedule-change digest email (plus an automatic Drive snapshot) was built in the same PR and
archived 2026-09-29, per Kevin, before ever being deployed.** It was browser-triggered (only ran if
someone had the report open) and went to one shared, editable recipient list. The last version is
commit `ee8e5d3`; what it did, why it was dropped, and the server-side-trigger design to use if it's
revived are in the contract doc's "Archived: schedule-change digest" section.

**Deployment switched to "Execute as: User accessing the web app" (2026-09-28, per Kevin: "everything
added in this PR should be as the user and not me").** Under "Execute as: Me" every Drive call ran as
Kevin whoever clicked: "Export to Drive" put the Sheet in Kevin's Drive and handed the visitor a link they
couldn't open. Now each visitor's own Drive is used, and each visitor grants the Drive scope once on
first open. Script properties stay script-global in this mode, so the email-namespaced prefs still work.
Also fixed in the same review:
- `FilterPrefsStore.hydrate()` restores whichever of the server copy and localStorage has the newer
  `savedAt`, instead of the server always winning (the server rejects blobs >= 8000 bytes while the
  client keeps up to 200 KB, so "server wins" restored stale filters). "Reset to defaults" now also
  deletes the server copy (`saveUserFilterPrefs('')`).
- Port Cut's calendar icon now resolves the "Mon D" no-year shape with the same Coastal ETD year hint the
  cell renders with.

**Calendar is still a client-only deep link, not a `CalendarApp.createEvent()` server call** -- it opens
`calendar.google.com` in the visitor's own browser tab, so it already acts as the user with no server
round trip and no Calendar OAuth scope. See the app's `calendarEventDates`/`openCalendarEvent` comment.

Two new regression suites were added: `Calendar_Event_Link` (Suite 15 -- the deep-link click/
debounce/URL-shape behavior, same delegated-listener style as `Gmail_Search_Debounce`) and
`Server_Extras_UI_Gating` (Suite 16 -- proves the "Export to Drive" button renders NOTHING when
`window.__SERVER_EXTRAS__` is absent, i.e. on this local/static-hosting path with no Apps Script
backend). A new headless check, `tests/check_server_extras_logic.js` (mirrors
`check_server_prefs_logic.js`'s real-source-extraction technique), covers the pure-logic pieces
(`isServerExtrasSyncAvailable`, `buildSnapshotRows`) and runs `Code.gs` itself under fake Apps Script
services for `saveUserFilterPrefs`. Added to `ci.yml` as `server-extras-logic` and to
`scripts/run_ci_locally.js` in the same pass, per this file's own "add it to `ci.yml` in the same
commit" rule.

`EXPECTED_TOTAL_CHECKS` moved 208 -> 218 when the two suites landed, then **217** when the digest was
archived (Suite 16 dropped its digest-recipients-input check): `Calendar_Event_Link` = **6** (its one
data-dependent check -- a blank Coastal ETD cell rendering no icon -- DOES fire against the committed
sample export) and `Server_Extras_UI_Gating` = **3** (its "Setup: ...Settings button found" check only
records on the FAILURE branch, same convention as this file's other Setup checks). Re-verify against a
real run rather than trusting this as it ages. None of the server-side `Code.gs` functions
(`saveUserFilterPrefs`, `exportCurrentViewToDrive`, `getOrCreateSnapshotFolder_`,
`buildSnapshotSheet_`) can be exercised for real by any local test -- `google.script.run` only exists
inside the Apps Script sandbox, same limitation the three-boolean server prefs feature has always
had. See `apps-script/README.md`'s new section for the deployed-URL checklist nobody has run yet.

**2026-09-29: scheduled per-day historical archive.** `apps-script/Code.gs` now archives the live
export once a day as one CSV file per date in a Drive folder (a timer installed with
`installArchiveTrigger`), backfills the old single archive Sheet into per-day files
(`backfillArchiveFromLegacySheet`), and serves `?archive=index` / `?archive=day&date=` from `doGet`.
The Historical Data popover uses that when it has dates and falls back to `HISTORICAL_DATA_CSV_URL`
otherwise (always, on local dev). Inside Apps Script the app reads it through `google.script.run`
(`getArchiveIndex` / `getArchiveDayCsv`), not those URLs: the web app runs as the visitor, and a
plain `fetch()` of `/exec` carries no sign-in and gets a login page. So each visitor reads the
archive as themselves, and the archive folder must be shared with them (a README setup step). Why: the single Sheet hits Google Sheets' 10M-cell cap after ~105
days, and the app downloaded all of it on every open. Setup steps: `apps-script/README.md`'s
"Scheduled historical archive" section. Two new checks, both blocking in CI:
`tests/check_archive_logic.js` (31 assertions; runs the real `Code.gs` under fake Apps Script
services -- every per-day file must parse the app's way to exactly that date's rows from the old
archive, including a quoted multi-line cell) and regression Suite 17 `Historical_PerDay_Archive`
(**12**; per-day path against a fake archive over `/exec` and over `google.script.run`, the
fallback, and the paths rendering identical rows). `EXPECTED_TOTAL_CHECKS` 217 -> **229**, verified on source and `dist/index.html`.

**2026-09-30: the archive reads the team's folder instead.** Kevin ran `installArchiveTrigger` and it
never asked where to put the folder (`DriveApp.createFolder` lands at the top of the running account's
My Drive, an editor run has no dialog, and the log didn't mention the folder). He then pointed at the
folder the team already fills by hand: one Google Sheet per day, date in the file name, only the
export's columns inside. So the timer, the backfill and the script-created folder are gone.
`Code.gs` now lists that folder (`ARCHIVE_FOLDER_ID_`), reads each date from the name, and serves a
day as Google's CSV export of the Sheet's first tab with `Record Date` prepended. The app is
unchanged: `getArchiveIndex` / `getArchiveDayCsv` keep their names and results. `checkArchiveFolder`
is the editor-run report on the real folder, and `snapshotLiveDataToArchive` survives only to delete
its own leftover trigger. `check_archive_logic.js` was rewritten, 31 -> **32**: file-name dates (including the folder's real `Booking Flash Report Data-09302026` MMDDYYYY names, which the first draft of this redesign would have skipped -- caught from Kevin's screenshot of the folder),
fidelity of every simulated day Sheet to the old archive's rows, duplicate/undated/non-Sheet
handling, the export's token, error paths, the cache, `checkArchiveFolder` (including the subfolders it lists but doesn't read), the trigger cleanup and
that nothing writes to Drive. Three deliberate mutations (duplicate picks the oldest, no Record Date
prefix, date ranges accepted) each fail it. `check_team_features_logic.js` 168 -> **167**: the
removed `ARCHIVE_LIVE_CSV_URL_` constant's equality check went with it (the app-URL check remains).

**2026-09-30: Freeze Panes pins the leftmost columns; added to POL.** Kevin: "Freeze panels doesn't
seem to work anymore". Reproduced live, it had not regressed: it always pinned VVD + Vessel Name, but
both sat behind 8 other columns (Trade ... Status), so they only locked after ~660px of scrolling
(HANDOFF.md's own 2026-09-14 measurement: 662px) while Trade/Lane scrolled away -- not what Excel's
freeze does. Per Kevin, VVD + Vessel Name now lead both Booking Flash and POL Booking Flash, and POL
got Freeze Panes too. `EXPECTED_TOTAL_CHECKS` 271 -> **275**: each of those two suites gained a
column-order check and `checkFreezePins`, which drives the real Settings toggle, scrolls the table
1500px and asserts VVD/Vessel stay at 0/95px (a mutation that un-sticks POL's cells fails it, at
-1498px). Item 21's VMS-blanking check was re-aimed, not loosened: it read VVD/Vessel by counting
from the row's end, which breaks once they precede the rowSpan'd trade cells, and "every field after
Vessel Name" would now include Trade/Lane, which VMS rows do fill; it reads the first two cells and
checks from the first data field (Max LDN / POL, the columns that followed Vessel Name before), and
now also fails if it finds no VMS rows at all -- it checks 65 on each tab against the fixture.
Verified 275/275 on `dist/index.html`.

**2026-09-30: archive served to visitors the folder isn't shared with.** Kevin didn't want to share
the daily-Sheets folder with everyone. The web app runs as the visitor, so Drive refuses them; now
the admin's `refreshDataFeeds` trigger (runs as the admin) calls `refreshArchiveCache_`, which copies
the 45 most recent days into the script cache (gzip, 90,000-char chunks), and the index/day reads
try that cache before Drive. `check_archive_logic.js` 32 -> **46**: the visitor-without-access path
end to end (fidelity of a cached day to the old archive, a multi-chunk 964-row day, no Drive call),
edited Sheets re-copied, days re-put before the 6 h expiry, a failed export not stopping the rest,
the admin guard, and that DataFeeds.gs calls it. Three mutations (reads skip the cache, edits never
re-copied, stale days never re-put) each fail it.

**2026-10-01: Trade/Sub Trade/Lane lead again; Freeze Panes pins five columns.** Kevin (screenshot,
Trade/Sub Trade/Lane circled with an arrow to the left edge): "move these columns back to where they
were in both booking flash tabs in the front". Both tables now lead with Trade, Sub Trade, Lane/Service,
then VVD, the new VSL Owner / VSL OPR columns (blank until the export carries them), then Vessel
Name. Freeze pins Trade, Sub Trade, Lane, VVD and Vessel Name (`FREEZE_LAYOUT`: 0/75/150/225/320px)
but not Owner/OPR, per Kevin. Count unchanged at **275**: each suite's column-order check now asserts
the seven-column lead, and `checkFreezePins` asserts the five offsets on the header, a group's first
row and a group's later row (where VVD is the first `<td>`), and that Owner/OPR scrolled away. Item 21's VMS check reads VVD/Vessel by counting from the row's end
again (they follow the rowSpan'd cells, as before 2026-09-30) and still checks from POL / Max LDN.

**2026-10-01 (later): original order restored with VSL Owner after Vessel Name; VSL OPR dropped.**
Kevin: "It should be sales week, PIC, 1st POL Cutoff, ETD VVD, Vessel name, VSL Owner, VSL OPR", then
"we don't need Operator". Count unchanged at **275**: each suite's column-order check now asserts the
full lead (Detail through Max LDN, POL through POL); `checkFreezePins` reads VVD's column index from its
header cell instead of assuming it (first row: that index; later row: index - 3) and asserts VSL Owner
scrolled away. A POL screenshot showed scrolled header labels bleeding through the pinned header cells
(transparent `<th>`, since 2026-09-30); fixed with an explicit background. `checkFreezePins` measures
positions only, so it could not have caught that; verify Freeze Panes visually when its styling changes.

### Known flakiness — don't let this excuse skipping the suite

Running the **entire suite in one long automated script** has intermittently produced spurious
failures in this sandbox, specifically right after a tab switch or modal close/open in quick
succession (documented in the test file's own comments and HANDOFF's Live-testing method point
6). This is **automation timing noise, not a real bug**, characterized in HANDOFF and the test
file across multiple sessions. The failure signature: a "Setup: table/modal found" check fails,
and re-running the exact same suite produces a different failure (or none) each time, while a
**deliberate, single-step check** (click the one tab, wait ~1.5–2s, then inspect — no chained
suite) reliably succeeds. When the full suite reports a failure:

1. Re-run once. If the *same* check fails identically both times with the *same* numbers, treat
   it as real — go fix it. **But first rule out a test-harness-side cause** (e.g. a script that
   injects this file and ALSO calls `runBookingFlashRegressionTests()` itself, running two
   unsynchronized copies that race each other — see the caveat below): a fully deterministic
   race reproduces identically every time in a fixed sandbox too, which otherwise satisfies this
   exact bucket without the app actually having a bug.
2. If it's a different check each time, or a "not found" failure on something you can verify
   exists with a direct, deliberate, single-step check, it's the known flakiness. Confirm with
   the deliberate check, not by re-running the automated suite over and over.

Never conclude "the suite is just flaky, skip it" — always resolve every failure to one of the
two buckets above before calling a change done.

**This is exactly why the source run in CI's `regression-suite` job (`tests/ci_regression_runner.js`)
is a `continue-on-error: true` step** (the `dist/index.html` run after it is blocking; until
2026-09-28 a job-level `continue-on-error` made it non-blocking too): it runs the entire suite unattended in one script, the precise shape
this section describes as an intermittent false-failure source. A red run there still needs the
same triage as above (re-run once, check whether the same assertion fails identically or a
different one fails each time) before you conclude anything about the actual change — it is not
itself the deliberate, single-step check this section calls for.

**Caveat added 2026-09-15**: "identical failure set on re-run" does NOT always mean "real bug" —
it can also mean a fully deterministic race, which reproduces identically every time in a fixed
sandbox (same machine, same browser, same data) despite being a race, not a bug in the app under
test. This is exactly what happened here: automation that injected the test file and ALSO called
`runBookingFlashRegressionTests()` itself (the old instruction above) ran two unsynchronized
copies of the suite concurrently, racing on shared page state (tab clicks, Analyze modal open/
close). That produced the *same* 9-failure set on every re-run — satisfying bucket 1's "identical
both times, treat as real" test — even though a correct single-invocation run had 0 failures. The
test file now guards against this specific race (see its own comment), but the general lesson
generalizes: before spending real effort "fixing" an identically-reproducing failure, also rule
out a test-harness-side race (double invocation, shared global/module state two runs both mutate,
etc.), not just app-side logic — determinism proves the *timing* is stable, not that the *thing
being measured* is a real defect in the app.

## Working practices: verifying, reporting, and committing

These rules exist because each one was learned the hard way in this repo. They apply to
any agent or human doing investigative work here (audits, bug hunts, perf passes), on top of
the required checks above.

### Verify against real data before reporting

Never report a finding — a bug, a row count, a performance number, a field mapping — that you
have only reasoned about. Run it against a real file first. The repo ships three:

- `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` — a real single-day export (964 raw rows,
  which aggregate to ~434 rows in the Booking Flash detail table).
- `Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv` — 9 days, **8,769 rows**.
- `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm` — the original workbook, with **cached
  computed values**. Cross-checking against those beats re-deriving expected values by hand: it
  captures the real system's actual rounding and edge-case behavior rather than your model of
  it. (But see the validation workflow below: a diff against a stale `.xlsm` is not by itself a
  bug on a live/auto-refreshing app.)

**Count rows with an RFC4180 parser, never `wc -l`.** That historical CSV reports 27,312 lines
but holds 8,769 rows — quoted cells contain embedded newlines, so a line is not a row. On
2026-09-10 a performance review was written around the inflated figure and had to be corrected
throughout after measurement; the same review separately claimed the detail table rendered "well
over 100k DOM nodes" when the real figure is ~17k, which would have justified a risky and
unnecessary virtualization rewrite. Both errors came from reasoning instead of measuring.

Report concrete evidence: the exact identifier (lane / VVD / sale week / column), the input
value, expected vs. actual, and the root cause with a line number. Not "this looks wrong," and
not a pass/fail summary on its own. And **separate confirmed findings from suspected ones** — a
suspicion you could not confirm is still worth reporting, clearly labelled as unconfirmed.
Overstating it as confirmed is what wastes the next person's time.

### Only commit once the change is ready to become a PR

**2026-09-24, per Kevin.** Don't commit partial or in-progress work as a checkpoint. A git commit
in this repo is not a save point for work still being verified — it's the unit a reviewer (human
or CI) judges. Do the edit, run the required checks for what you touched (see the numbered list
above), and only create the commit(s) once you're actually about to push and open the PR. When
several agents or workstreams contribute to one change (e.g. an app fix, its test update, and a
doc update), land all of it and verify it together first, then commit at the end, not as each
piece lands. Related fixes may share one commit (rule removed 2026-09-26, per Kevin).

### Check the executed-check count, not the pass rate

When you run the regression suite, look at **how many checks actually ran** before you look at
how many passed. The suite contains roughly 130 `record()` call sites (re-counted
2026-09-16 after merging the Historical Data fixture-pinning rewrite, the server-backed
preferences Suite 10, and the field-visibility Suite 11; it grows as suites are added, so treat
this as approximate too, and note a single call site inside a loop -- e.g. Suite 10's per-scenario
assertions -- can record more than once per run); a setup failure aborts its whole suite, so the
remaining checks in it never execute and never report.

On 2026-09-10 an agent reported `28/32` and concluded the suite "does not pass on v1.66" — a
claim that was relayed onward as fact. Two other agents running the same suite against the same
file got `55/55` and `58/58`, twice each. The tell was the count, not the failures: 32 executed
checks meant roughly 23 checks' worth of suites had aborted at setup in that agent's browser
automation. Its environment was broken, not the app.

A second, different instance of the same lesson (2026-09-15): a run reported `70/72` and a
later one `66/68` — both "2 failures", both the same 2 known Sector Summary ones, and the pass
rate looked *better*. What had actually happened is that an entire suite (Suite 9,
`Historical_Data`, 4 checks) **silently skipped**. It skips by design when the archive looks
unreachable, and the app change in flight had made the historical archive load lazily on
popover-open instead of eagerly on mount — so the fetch now started when the suite clicked the
button and took ~11s, past the suite's own 8s `waitFor` timeout. No failure, no warning, 4
checks of coverage simply gone.

The technique that caught it, which is worth making routine: don't just compare totals, compare
**per-suite counts** against a baseline run. One line in the console after a run:

```js
const by = {}; window.__bfrtLastResult.results.forEach(x => by[x.suite] = (by[x.suite]||0)+1); by
```

A suite that drops to zero disappears from that object entirely, which is much easier to spot
than a total that moved by 4. (The timeout has since been raised to 30s with the measurement
written down at the call site — if the archive keeps growing, raise it again rather than
letting the skip come back.)

Note this is a failure mode that comparing against a baseline run **cannot** catch — that agent
did compare against unmodified v1.66, exactly as the flakiness rules above prescribe, and
reproduced its own failures there, because both of its runs shared the same broken harness. Only
cross-checking against an independently-driven run exposed it. So when a suite result surprises
you, re-derive it from a different setup rather than re-running your own.


### Serving the app: confirm you're serving YOUR checkout

`.claude/launch.json`'s static server uses `--directory ${workspaceFolder}`. That substitution
is what makes it correct **inside a git worktree** — this repo's convention is one worktree per
branch (see HANDOFF.md), and the plain `--directory .` it used before resolved against the
server process's own cwd, which is the MAIN checkout even when your session is in a worktree.

That failure is silent and expensive: on 2026-09-15 an agent spent a full round of "verifying"
a change against the main checkout's copy of the app, measured the unmodified file, and drew
confident before/after conclusions from it. It only surfaced when a file that had just been
written 404'd. **Before trusting any live measurement, confirm the served bytes are yours:**

```js
// in the page console / javascript_tool, against the file you just edited
(await (await fetch(location.pathname)).text()).includes('<a string you just added>')
```

Two related traps:

- **Port collisions between concurrent worktree sessions.** Several agents on different
  worktrees all try to bind 8791. If `preview_start` reports the port is held by a Python
  process, check what it is serving (`ps -p <pid> -o command`) before doing anything — it is
  very likely *another session's* server on another worktree, not a stale orphan of yours, and
  killing it breaks that session. Use a different port for your own run instead, and put 8791
  back before committing.
- **Don't commit a machine-specific `--directory`.** An absolute path works but only on one
  machine and one worktree; `${workspaceFolder}` is the portable form and is what belongs in
  the committed file.


## 2026-10-01 — Calendar features removed; date-cell icon opens OPUS

Per Kevin: the small icon next to 1st POL Cutoff / ETD Last Port (Booking Flash) and Coastal ETD /
Port Cut (POL Booking Flash) no longer opens a Google Calendar "add event" page. It is now a 🔗 that
opens ONE's internal OPUS Container vessel schedule screen (`OPUS_VESSEL_SCHEDULE_URL` in the app).
That URL takes no vessel/VVD parameter, so it lands on the schedule screen itself; the icon's tooltip
names the VVD to look up. Still client-only (no server call, no OAuth scope), still rendered only next
to a real date. Per Kevin, every Google Calendar feature is gone (the 📅 icon was the only one).
Suite 15 was renamed `Calendar_Event_Link` → `OPUS_Schedule_Link` and keeps its **6** checks: the payload check
became a tooltip check and the URL check now asserts the exact OPUS URL. Total stays **275**.

## 2026-10-01 — VSL OPR instead of VSL Owner

Per Kevin: "we want VSL OPR and not VSL Owner". The column right after Vessel Name on both Booking Flash
and POL Booking Flash is now **VSL OPR** (`vslOpr`; aliases `VSL OPR`, `VSL Operator`, `Vessel Operator`).
Same position, still not pinned by Freeze Panes, still blank until the export carries it. The two
column-order checks and the Freeze Panes check now name `VSLOPR`; total stays **275**.

## 2026-10-01 — OPUS icon copies the VVD

Per Kevin: a click on the 🔗 OPUS icon now also copies that row's VVD to the clipboard (OPUS's URL can't
carry it) and shows a 2-second "Copied <VVD> — paste it into OPUS" note. The copy uses a hidden textarea +
`execCommand('copy')` first, then the async Clipboard API as a fallback, because the deployed app runs in
Apps Script's sandboxed iframe where `navigator.clipboard` is often blocked. `OPUS_Schedule_Link` gains 1
check (the copied text is the icon's own row VVD and the note appears): **6 → 7**, total **275 → 276**.

## 2026-10-01 — Basic build without Google services

Per Kevin: a deployable version with every fix and change but none of the Google Apps Script services
still in testing. `scripts/build_deployable.js` now writes `dist/basic/index.html` alongside
`dist/index.html`: identical except a first-in-`<head>` script setting `window.__BF_GOOGLE_SERVICES_OFF__`.
With it the app makes zero `google.script.run` calls and ignores `__SERVER_PREFS__`/`__SERVER_EXTRAS__`/
`__SERVER_CONFIG__`; data and history come from the published CSVs, prefs stay in localStorage.
Served by the new `apps-script/basic/Code.gs` (doGet + `?check=version` only). New blocking job
`tests/check_basic_build.js` (static scan of basic Code.gs, flag placement, and a browser run with a fake
`google.script.run` that must record zero calls — with a control run on `dist/index.html` that must record
calls). Regression suite unchanged at **276** (it runs against `dist/index.html`; against the basic build
27 checks fail by design — every one expects Google services).

## 2026-10-01 — Code review fixes (#144–#147)

A two-reviewer pass over the day's changes, each finding reproduced in a browser before fixing:
- **Excel export carried the date icon as text** (`6/19/26🔗`, and `📅` before it) on every Cutoff/ETD/
  Coastal ETD/Port Cut cell. `exportToExcel` now strips `[data-schedule-link]` as well as
  `[data-vvd-notes]`, and `polElementToDom` (the POL export's data-built tbody) now keeps those two
  markers so the strip can find them.
- **VSL OPR unreadable in dark mode on POL** (bare `bg-white`); now `${bg}` like its neighbours.
- **Detail VSL OPR dropped a later leg's value** when the first leg was blank; first non-blank leg wins.
- **A saved `vslOwner` header filter blanked both tables** with no input to clear it;
  `RETIRED_HEADER_FILTER_KEYS` drops it on restore.
- **OPUS icon:** focus returns to the icon after the copy (the hidden textarea dropped it to `<body>`),
  held-key repeats are ignored, and VMS rows copy nothing.
- apps-script/README: the basic build's update-banner claim is marked unverified on org-only deploys.
- `tests/check_basic_build.js` now drives the Historical Data popover (the control must call
  `getArchiveIndex`/`getArchiveDayCsv`; the basic build must call nothing and still list dates).
`OPUS_Schedule_Link` +2 checks (keyboard path; no 🔗 in the export — failed before the fix): 276 → **278**.

## 2026-10-01: public (cut cargo) and private VVD notes

Per Kevin: notes get a public/private choice, and public is used only for VVDs where cargo has been cut,
so the whole team can see them.

- **Public** notes are the existing ones: the team Sheet's `VVD Notes` tab, everyone sees them. They now
  carry `visibility: 'public'` and show a red ✂️ badge (with a count when more than one).
- **Private** notes live in each visitor's own Apps Script user properties (`bfrPrivVvdNote:<VVD>`), never
  in the Sheet (everyone can edit it, so a hidden tab would not be private) and never in the shared script
  cache. `getVvdNotes`/`saveVvdNote` add the caller's own private notes to each reply. 🔒 badge.
- If the script is not running as the visitor (an "Execute as: Me" deployment would share the owner's
  store), private notes are refused (`private-unavailable`) and reported off (`privateAvailable: false`).
- `saveVvdNote(vvd, note, visibility)`; a missing visibility saves public, so pages loaded before the
  deploy keep working.
- The dialog starts on 🔒 Private; switching kinds keeps unsaved text when the other kind has no note.
  (Changed 2026-10-02: the dialog now starts on Public; see the entry at the end of this file.)

`check_team_features_logic.js` 167 -> **191** (private notes: storage location, isolation between visitors,
both kinds on one VVD, legacy calls, invalid visibility, the Execute-as-Me refusal, malformed/full/broken
user properties). `Apps_Script_Team_Features` +3 checks (starts on Private; public save after switching;
deleting each kind separately): 278 -> **281**. (Changed 2026-10-02: the starts-on-Private check now asserts
Public; see the entry at the end of this file.)

## 2026-10-02 — Analyze trend chart: vessel count and VMS-week alignment

Per Kevin, on the Analyze modal's Weekly Capacity vs. Laden chart:
- **"N vsl" on the POL tab counted port calls, not vessels.** The week total summed each (POL, week)
  bucket's own count, so a VVD calling USHOU01 and USMIA01 counted twice; on the 8-12 fixture W27 read
  56 against 24 distinct VVDs. The week now counts distinct real VVDs across every group. The lane tab
  was already right on that fixture; the bucket's own per-group count (cards, Compare) is unchanged.
- **VMS-only weeks sat lower.** The "N vsl" line was left out when a week had no vessel, so that
  column was one line shorter and its week label dropped (AN2: labels at 749px vs 740px). It now
  always renders, "0 vsl" in a lighter grey.

+1 check in each Analyze suite (every week's "N vsl" against the table's distinct VVDs) and +1
Analyze_BookingFlash check that selects one lane with a VMS-only week through the real Lane slicer
(picked from the table, not hardcoded; AN2 on the fixture). Both failed against the pre-fix app.
The unfiltered chart can't catch the layout bug: some lane always sails, so it has no VMS-only week.
281 → **284** (after #148's +3).

## 2026-10-02: review fixes for public/private VVD notes

A review of the merged change (booking-flash-report#148) found four real issues; all fixed:

- **Private text could be published from a tab opened before the deploy.** The old page treats any note by
  its viewer as "my note" and saves without a visibility (= public). The server now returns private notes
  only to callers that ask (`getVvdNotes({ privateNotes: true })`, or a save that names a visibility).
- **A saved private note pre-filled the Public editor** when switching kinds, one click from publishing it.
  Only unsaved typed text carries into Public now (a saved public note still carries into Private).
- **A poll could wipe text being typed**: a change to the other kind's note, or a poll that failed to read
  private notes, re-seeded the editor. Now only a change to the shown kind's saved note does.
- **A private save was reported "Not saved"** when it succeeded but the public list couldn't be re-read.
  It now replies ok with `notes: null` and the page re-reads.

`check_team_features_logic.js` 191 -> **196**. `Apps_Script_Team_Features` count unchanged (44): the
switch-to-Public check now asserts the saved private text does NOT carry over, and the starts-on-Private
check also asserts every `getVvdNotes` call opts in. (Changed 2026-10-02: that check was later rewritten to
assert the dialog starts on Public; see the entry below.)

## 2026-10-02: Notes dialog starts on Public

Per Kevin: the 📝 Notes dialog now **starts on Public** instead of Private (it started on Private from
2026-10-01, see the public/private entry above).

- **Why:** most notes are cut-cargo notes for the team, and will be until people adopt private ones.
  Starting on Private meant a note meant for the team could be saved private by accident, where nobody else
  sees it.
- **Rule now:** the dialog opens on Public. It opens on Private only when private notes are available and the
  viewer already has a private note on that VVD and no public one, so their own note is what they see.
- **Regression suite:** the check "Notes: with no note of mine on the VVD, the editor starts on ..." was
  rewritten in place to assert Public, and the private-save flow now picks Private explicitly instead of
  relying on the default. Check count unchanged at that point. The viewer-with-only-a-private-note check
  (POL, V3) is unchanged: it still opens on Private.

## 2026-10-02: `testStartupLog()` editor helper

`apps-script/TeamSheet.gs` gained `testStartupLog()`, a function to run from the Apps Script editor. The
editor's Run button calls a function with **no argument**, so running `logClientStartupError` directly
logged an all-blank report and could not show whether the log works end to end. `testStartupLog()` sends a
realistic report, clearly labelled as a test, through `logClientStartupError`.

`check_team_features_logic.js` 196 -> **202** (+6 assertions): the no-argument case (an all-blank report,
what the Run button produces) is now pinned, plus `testStartupLog` with a team Sheet configured and without
one.

## 2026-10-02: review of the Public default and `testStartupLog` (booking-flash-report#151)

A code review of the two changes above found seven items. Each was checked against the code (and, for the
VVD case question, against the real files) before anything was changed. Five led to changes, two did not.

**Fixed**

- **Edited private text could reach the Public editor.** `pickVisibility` carried the draft into Public
  whenever it differed from the saved text, so editing a saved private note and then clicking Public put the
  private text one click from the shared Sheet. A draft now carries into Public only when it was typed from
  scratch (no saved private note), and not at all while private notes are unavailable, because then a saved
  private note reads as empty and cannot be told apart from typed text. The switch-to-Public check was
  extended in place to edit the private text first (count unchanged by this fix).
- **A poll could wipe a half-typed note.** The editor's re-seed effect listed `privateAvailable` as a
  dependency, and its only guard covered the Private editor, so a poll that failed (or recovered) the private
  read while the Public editor was showing overwrote the draft. The effect now remembers the saved text it last
  seeded and re-seeds only when the shown kind's saved text changed. +1 `Apps_Script_Team_Features` check
  (a poll reporting private notes unavailable, and the one restoring them, leave the typed text alone):
  284 -> **285** (suite 44 -> 45, tripwire 43 -> 44).
- **Chart vs. cards identity.** The Analyze weekly "N vsl" count uppercased VVDs while the sailing keys and
  buckets behind the cards and Compare did not, so a case-variant pair would count once in the chart and twice
  there. It now uses the VVD as-is, like they do. Real data has no case-variant VVDs (964-row xlsx: 375
  distinct as-is and uppercased; 8,769-row CSV: 421 and 421), so no number changed.
- **`testStartupLog` is admin-only once setup has run.** Every public Apps Script function is callable by any
  visitor, so a visitor could write fake "manual test" rows and use their own report budget. It now calls
  `assertArchiveAdmin_(false)` when an admin is recorded (never claiming admin), and still works before setup,
  when it only writes a console line. A visitor could always do the same through `logClientStartupError`
  itself, so this hardens a helper rather than closing a new hole.
- **One redundant read removed.** On a cache miss, `getVvdNotes` and a private save read the
  `bfrTeamSheetId` script property twice in one request; it is now read once and passed down. A small saving
  (one cheap read, cache misses only), pinned by call-count assertions.
  `check_team_features_logic.js` 202 -> **210** (+5 admin-guard assertions, +3 call-count pins).
- **Stale wording and counts** in `tests/ci_regression_runner.js` and this file.

**Looked at and deliberately not changed**

- **`getProperties()` on every notes poll.** The review suggested an index key so private notes could be
  found without loading the whole user-property store. One `getProperties()` call is cheaper than an index key
  plus one `getProperty` per note, the index adds a way for the two to disagree, and Google's real latency
  cannot be measured from a dev machine, so this stays unmeasured and unchanged.
- **Stale badge after a private save when the Sheet read fails.** The reply is `notes: null` and the page
  already re-reads the list; the badge is late only if that re-read also fails (two Sheet failures in a row),
  and then appears at the next poll. Returning the private notes alone would have meant showing a partial list.
- **Merging the distinct-VVD loop into the others.** The saving is negligible and it would couple unrelated
  code.

Not verified: any of this on a deployed `/exec` URL (the tests use simulated Google services).

## 2026-10-02: the slicers filter the notes

Per Kevin: the notes now follow the slicers. Before, the dialog's "All notes" list and the 📝 Notes (N) button
showed every note however the tables were filtered (only the badges on rows followed the filters, because they
sit on rows).

- **Rule:** the list and the button count show notes on VVDs that are in `filteredRawRows`, the one list every
  table tab is built from, so the notes and the tables cannot disagree. That includes the column filters, not
  only the slicer buttons. When nothing is narrowed (as many filtered rows as rows) every note shows, including
  notes on VVDs that are no longer in the data; those drop out only once a filter is applied.
- **Never silent:** when the filters hide some notes the heading says "Notes matching the current filters
  (X of Y)", the button reads `📝 Notes (X of Y)`, and **Show all Y** lists everything. The editor for the VVD
  typed in the box is deliberately not filtered, so a note saved on an excluded VVD does not vanish.
- **Tests:** the logic is a pure block in the app (`NOTES SLICER FILTER START/END`) that
  `check_team_features_logic.js` extracts and runs: 210 -> **217** (+7). +1 `Apps_Script_Team_Features` check
  that drives the real Lane slicer (the lane of the private-note VVD, whose notes are worked out from the
  fixture): 285 -> **286** (suite 45 -> 46, tripwire 44 -> 45).
- **Not verified:** the browser check was written without being able to run a browser locally (the authoring
  container's HTTPS proxy breaks Chromium's CDN loads); GitHub CI is its first run.

## 2026-10-02: the Notes dialog is grouped, filterable and restyled

Per Kevin: drop the seconds from note times, organize the notes better, give the dialog a more refined look and
make its font match the rest of the app. Built on top of #151 (Public default, slicers filter the notes).

- **Times:** minutes, never seconds (`10/2/2026, 10:49 AM`), and `Today, 10:49 AM` / `Yesterday, 3:18 PM` for the
  last two days. The full timestamp is in each time's tooltip. `formatNoteTime(iso, now)` takes `now` so "today" is
  testable; "yesterday" is built from the calendar date, not 24 hours back, so it is DST-safe.
- **Organization:** one card per VVD (newest activity first; inside a card the cut-cargo notes come before the
  private one, the same order as the table badge's tooltip), kind chips with counts (All / Cut cargo / Private /
  Mine), a search box over VVD, text and author, and an age filter (any time / 7 / 30 days). These narrow only the
  list, after the slicers, and never the editor above it. A note whose date cannot be read is kept by the age
  filter, because a filter must not silently hide what it cannot judge. The separate "Cut cargo / My private notes"
  sections that were considered are not built: with chips and the per-note kind bar they would say the same thing
  twice.
- **Font:** the family was already the app's (`ui-sans-serif, system-ui, sans-serif`, measured in the running app on
  the dialog, the table and the buttons). What looked off was the WEIGHT: the dialog is mounted inside the
  masthead's bold button row, so every label, note and input inherited weight 700 and nothing stood out. The dialog
  root now sets `font-sans font-normal` itself, so it no longer depends on where it is mounted.
- **Layout:** the dialog is two regions (editor on top, capped at 40% of the window; list below) so the editor stays
  put while the list scrolls; the heading, chips and search stick to the top of the list; on windows shorter than
  600px the intro text hides, the sticky header releases and the editor gets more room.
- **Review fixes:** a Private/Mine filter whose chip has disappeared (a poll whose private read failed) falls back to
  All instead of leaving an invisible empty list; an empty search says when the slicers are also hiding notes; a
  note with no date no longer renders a dangling " · ".
- **Service lane:** each VVD heading shows its lane after the name, `FOWT0529S (AN2)`, in its own span beside the
  heading button (the button still holds only the VVD, which the slicer check reads). The lane comes from the data
  rows on screen (`laneByVvd`), so a VVD no longer in the data shows none. Checked on the 964-row fixture: the 374
  real VVDs each sail on exactly one lane, none blank; only the `VMS` placeholder spans many (and is skipped).
  If a real VVD ever had two lanes both are shown, joined by `/`.
- **Lane drop-down and the VVD drop-down:** a Lane `<select>` ("All Lanes" plus the lanes of the real VVDs) sits
  beside the VVD box and narrows the box's suggestions to that lane; each suggestion's label is its lane. It does
  not filter the notes list, change the box or touch the draft, and falls back to "All Lanes" if the chosen lane
  leaves the data. The VVD box is still a type-ahead (a note can target a VVD not in the data). Kevin saw no
  drop-down because Chromium draws a datalist's arrow only on hover or focus; a plain-CSS rule
  (`.vvd-combo::-webkit-calendar-picker-indicator`) keeps it visible. It is plain CSS, not a Tailwind
  arbitrary variant, because the file's class pre-compiler cannot handle a class starting with `[&`.
- **Title Case labels (per Kevin):** the dialog title (`VVD Notes`, matching the Sheet tab), the kind tags and
  chip (`Cut Cargo`, `Private`), the toggle (`Public — Cut Cargo` / `Private — Only Me`), `Your Note on`,
  `All Notes (n)` / `Notes Matching the Current Filters`, `All Lanes` and the age options. Sentences (statuses,
  the legend, tooltips) and the action buttons (`Save private note`, `Delete public note`) are deliberately
  unchanged.
- **Tests:** the pure logic is the `NOTES ORGANIZE` block, extracted and run by `check_team_features_logic.js`.
  Counts, all from real runs: headless 217 -> **255** (+38: 30 for times / filter / grouping, 8 for the lane
  helpers); `Apps_Script_Team_Features` 46 -> **60** (+14: the no-seconds check, 11 for grouping / chips / search /
  age / times / layout / filters-never-touch-the-editor / the Private-chip gate and fallback, 2 for the lane in the
  headings and the Lane drop-down), tripwire 45 -> **59**; total 286 -> **300**. Final runs on the final app: source
  300/300 and `dist/index.html` 300/300, `check_basic_build.js` and `run_ci_locally.js --fast` green.
  The new checks were red-run against deliberately broken copies of the app: 16 mutations of the pure block were all
  caught, the browser-side mutations failed exactly where planted, and 4 mutations of the lane helpers were each
  caught by the intended check. #151's slicer check, which its author could not run in a browser, passes.
- **Intentional change to an existing check:** #151's slicer check read `ul > li > button` as one button per NOTE;
  it is now one per VVD, so it compares against the unique VVDs.
- **Not done:** structured cut-cargo fields (TEU, port, date) would need new Sheet columns and `TeamSheet.gs` changes;
  "new since you last looked" markers need a decision on where the last-seen time lives (`localStorage` is
  per browser).
- **Not verified:** real Windows fonts and scrollbars (the screenshots were taken with a Linux stand-in font and
  Chromium 141 only), the native datalist popup itself (headless screenshots cannot capture it, so only its DOM was
  checked; the lane label inside the popup is unseen), Firefox (it ignores the `::-webkit-` arrow rule), the Apps
  Script iframe, and any of this on a deployed `/exec` URL.

## 2026-10-02: hashtag search in the Notes dialog

Per Kevin: a `#tag` typed in a note (public Cut Cargo or private) is searchable. Client-only: the tag is part of the
note text, so there is no `TeamSheet.gs` change, no Sheet column, no migration and no redeploy, and every existing note
that already holds a `#word` has the tag. The reasons behind each rule are in CODE_NOTES.md ("Notes Hashtags: A Tag Is
Just Text, Matched Whole").

- **Rule:** `#` + a letter (A-Z a-z, Latin accented) + letters / digits / `_` / `-`, case-insensitive; the `#` must start
  the text or follow whitespace, an opening bracket or quote, or `, ; : ! ?`. Not tags: `#12`, `bay #3`, `##x`,
  `http://x/y#frag`, `AB#cd`. In the search box a token that is exactly a tag (`#rolled`) must match a WHOLE tag of the
  note (`#cut` does not find `#cutcargo`), several tags are AND, and the other words keep the old meaning (a substring of
  VVD, note or author). With no tag in the box the search is exactly what it was before.
- **Where:** the pure core (`splitNoteText`, `extractNoteTags`, `collectNoteTags`, `parseNoteQuery`,
  `toggleNoteQueryTag`, and `filterNotesForList` extended in place) is inside the `NOTES ORGANIZE` block, because the
  unit tests extract that block and nothing else. In the dialog: every `#tag` in a note is a button that toggles itself
  in the search box (so the box stays the one source of truth), a tag bar (`data-notes-tagbar`) of chips with counts
  sits under the filter row, the editor shows the tags in the draft (or a tip), and an empty tag search says "No notes
  are tagged #a #b".
- **Privacy:** the tag bar is built from `listedNotes` only (the notes the viewer was already sent), narrowed by kind and
  age but not by the search box, so it never offers a tag from a note the viewer cannot see and does not move while
  typing.
- **Tests:** the pure core (grammar, lossless split, whole-tag AND matching, the tag-bar pool, the search box with no
  tag unchanged, a seeded fuzz) in the headless `check_team_features_logic.js` 255 -> **311** (52 written with the
  feature, plus 4 added after the review for the cases it found: `×` / `÷`, the linear hyphen trim, non-string queries,
  an invalid toggle key); the dialog in the browser suite, `Apps_Script_Team_Features` 60 -> **76** (16 new: the tag
  buttons, the bar and its counts, AND, the combinations with kind / age / the Lane slicer, private-only tags, the
  editor hint, Clear filters, the editor left untouched, "Show all N tags"), its tripwire 59 -> **75**; total 304 ->
  **320**. The new checks were mutation-tested: 14 mutations of the pure block and 8 of the dialog were each caught by
  the check meant to catch them. Final runs on the final app: source **320/320** and `dist/index.html` **320/320**
  (executed count 320, expected 320, both), the Basic-build check, both row-highlight budgets, and every blocking job
  of `run_ci_locally.js` green. Two sandbox notes: the stock 240 s limit in `ci_regression_runner.js` trips on the
  source run here (it takes about 7 min, and the dist run 2.5 min), so the source result above came from a run with the
  limit raised to 1500 s (CI marks the source run informational); and the alias-landmine job needs `openpyxl`, which
  this sandbox lacked, so the gate showed it red without running it -- after `pip install openpyxl` it passes.
- **Independent review of the core against real data** (a separate pass, before the tests were final; the scripts were
  throwaway):
  - **False-positive scan: nothing to find, because the shipped data has no `#` at all.** Every non-empty text cell of
    `Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx` (20,005 string cells of 83,800) and of the historical CSV (8,769
    rows by an RFC 4180 parser, 27,312 lines by `wc -l`; 237,520 non-empty non-numeric cells): 0 cells contain a `#`, 0
    yield a tag, and `splitNoteText` was lossless on all of them. A raw-byte check agrees (0 `#` in the CSV, in the
    xlsx's shared strings and sheet XML, and in the reference `.xlsm`; no error-typed cells). So these files say nothing
    about how people will really use `#`; the grammar was judged on constructed cases. As a what-if, with `#` put in
    front of each distinct identifier: all 3 trades, 5 sub-trades and 28 lanes are whole tags, 415 of 421 VVDs are
    (the other 6 start with a digit, e.g. `1CLT0017E`), and 243 of 244 vessel names once spaces are removed.
  - **Regex hazards:** no catastrophic backtracking in the scan itself: `'#a' + '-'*900 + '!'` 0.006 ms, `'a#'*500`
    0.002 ms, 999 characters of `'#a '` 0.09 ms, and the other shapes tried at 100,000 characters stay under 25 ms. One real
    quadratic spot: the trailing-hyphen trim (`.replace(/-+$/, '')`) on a tag with a long hyphen run in the middle,
    `'#a' + '-'*900 + 'b'` 0.65 ms, 5,000 hyphens 20 ms, 40,000 hyphens 1.4 s. At the 1,000-character note limit it
    costs about 1 ms, so only a hand-edited Sheet cell or a huge paste into the search box could notice. **Fixed the
    same day:** the trim is now a loop (`trimTagHyphens`), and a unit check holds 50,000 hyphens under 500 ms (the regex
    took 2.2 s on that input here).
  - **Also fixed the same day:** `×` / `÷` (U+00D7 / U+00F7) were inside the accented range, so `#×1` was a tag; the
    range now skips them. `parseNoteQuery(0)` / `(false)` / `(NaN)` read as the text `'0'` / `'false'` / `'nan'` instead
    of the old empty query (`String(query || '')`); the old rule is back. `toggleNoteQueryTag` no longer appends a key
    that is not a valid tag (`##a`, `a b`). The dialog never passed any of these; each has a unit check.
  - **Corners left as they are** (none affects an ordinary note; listed in CODE_NOTES.md): decomposed (NFD) accents split the tag (`#cafe` + U+0301 is `cafe`, not `café`); U+200B / U+200C
    / U+200E before a `#` are not separators; pasted `#N/A` / `#REF!` make the tags `n` / `ref`; a tag glued to an emoji
    (`✂️#cut`) is not one; a query token such as `#rolled.` is free text, not a tag.
  - **Sheets round trip:** 22 notes that start with or contain `#` (`#rolled`, `Cut 40 TEU #rolled #usnyc`, `#N/A`,
    `#REF!`, `#VALUE!`, `#DIV/0!`, `#NAME?`, `#NULL!`, `#NUM!`, `#ERROR!`, `#n/a`, `#12`, `#FF0000`, `##x`, `# heading`,
    a 1,000-character one, ...) were saved and read back through the real `TeamSheet.gs` under the test's fake Sheets,
    on the create, update and private paths: all identical to what was typed (trimmed). `sheetText_` only guards a
    leading `= + - @ tab CR`, a number / date / time / TRUE-like string, so a `#` start is written as plain text. This
    proves the code, not Google Sheets: the fake has no rule for a leading `#`. **Left as it is:** a guard in `sheetText_`
    for a note that is exactly an error literal would be a server change (and a redeploy) for an unconfirmed problem;
    the two-note check to run on `/exec` (`#rolled` and an exact `#N/A`) is in the production checklist in
    apps-script/README.md, and the guard goes in only if that check fails.
- **Not verified:** any of this on a deployed `/exec` URL. In particular, whether real Google Sheets stores a note that is
  exactly an error literal (`#N/A`, `#REF!`, ...) as text or as an error value (the app reads `getDisplayValues`; an
  error cell would be expected to display the same literal, but that is unconfirmed), how a very long tag wraps inside a note in a browser, and the pointer
  and keyboard behaviour of the new buttons in real browsers beyond what the browser suite drives.
- **Superseded 2026-10-03** (history above left as written; the review fixes are in the next section): (1) the **Rule**
  line is out of date, tags are now `\p{L}`-based and any script is a tag (`#Привет`, `#日本語`), not "A-Z a-z, Latin
  accented"; (2) the "Corners left as they are" entry on decomposed (NFD) accents no longer holds, `#cafe` + U+0301 is now
  the same tag as `#café`; (3) the `×` / `÷` fix above (a range with two holes) is gone because the range is gone, they
  are simply not letters; (4) a chip's number is no longer the count of notes carrying the tag under kind and age, it is
  the number of notes the list shows after clicking the chip (CODE_NOTES.md had said a click "has to show that many",
  which was false while the box held anything); (5) the sandbox note about raising the 240 s limit in
  `ci_regression_runner.js` is replaced by the `BF_RESULT_POLL_TIMEOUT_MS` environment variable (docs/TESTING.md). The
  counts quoted in this section (311, 76, 320) are the 2026-10-02 counts; current ones are below and in docs/TESTING.md.

## 2026-10-03: review fixes to hashtag search (PR #154)

A code review of the hashtag search (PR #154, the section above) found eight problems. Each one was fixed, and each fix is
pinned by a check or a documented measurement. The "why" for the grammar, the chips and the layout is in CODE_NOTES.md
("Notes Hashtags: A Tag Is Just Text, Matched Whole"). Everything is client-side, as before: no `apps-script/` change.

1. **The tag bar could cover the notes list.** The bar sits in the sticky header at the top of the list region, and the
   header had no height cap. On a stand-in page built from the dialog's own classes (1280 px wide, 700 px high window,
   a 279 px scroll region) the header measured 128 px with no tags, 182 px with 12 chips and 312 px with 40 chips
   ("Show all"), so the list left visible below it went 151, 97, then -33 px: with about 40 tags the header covered the
   list completely, and a sticky element cannot be scrolled out of the way. **Changed:** the chips live in
   `div[data-notes-tag-list]`, capped at 96 px (`max-h-24`, about three rows) and scrolling inside the cap; the
   "Show all / Show fewer" button is a sibling of that list inside the bar, so it can never be scrolled out of reach.
   **Pinned by:** a live check (`Notes (hashtags): the tag bar is bounded ...`) that opens the real dialog in a 700 px
   high window with 45 tags and "Show all", and asserts the bar stays within 120 px, the chips scroll inside
   `div[data-notes-tag-list]` (`overflow-y: auto`), "Show fewer" stays inside the bar and visible, and note rows are
   still visible below it; and two structural unit checks in `check_team_features_logic.js` (the list has a `max-h-*`
   cap and `overflow-y-auto` and sits inside the bar; `data-notes-tag-more` comes after the list element has closed, so
   it is a sibling, and has `flex-none`). **After the fix:** the live check allows the bar 120 px, while the cap itself is 96 px;
   measured in Chromium at 700 px high (24 notes, 45 distinct tags): the sticky header is 128 px with no tags and 182 px with
   12 chips; with 45 tags and "Show all" it went from 338 px (list area 36 px, so no row visible) to 226 px (list area
   148 px, one row fully and a second partly visible), and the bar itself from 204 px to 92 px. **Cost of the sibling
   button:** with more than 12 distinct tags the "Show all N tags" button now sits beside the chip list and takes about
   125 px of width, so the 12 default chips wrap to a third row and the bar is 26 px taller (48 -> 74 px) even before
   "Show all". It is still capped and nothing is covered; the alternative (the button inside the scrolling part) would
   scroll it out of reach.
2. **A chip's number was not what clicking it shows.** The count came from the pool under kind and age and ignored the
   search box, so with another tag already in the box a chip could say more than its click listed (CODE_NOTES.md had even
   claimed it "has to show that many"). **Changed:** the number is now "the notes the list shows after clicking this
   chip", computed by the pure `buildNoteTagChips(notes, { kind, query, ageDays, me, nowMs })`
   (`[{ tag, total, count, pressed }]`). Which chips exist and their order still come from kind and age only, so the bar
   does not jump while you type; only the numbers follow the box. A chip that is not pressed and would list nothing is
   dimmed (`opacity-50`, `data-notes-tag-empty="true"`) but stays clickable; a pressed chip is never dimmed and its
   number is what removing it lists. **Pinned by:** unit checks in `check_team_features_logic.js` that every chip's count
   equals `filterNotesForList(notes, { kind, query: toggleNoteQueryTag(query, tag) }).length` (an independent
   script ran the same equality for 92 chips over 4 kinds x 9 queries, all equal), that membership and order do not
   move while typing, that a pressed tag nobody carries is a `total: 0` chip that can be removed, that the input is not
   mutated and that the private-only pool stays in its kind; and two live checks, `a chip's number and title are what
   clicking it lists ...` (the rows really listed after the click are exactly that many) and `a chip that would list
   nothing is dimmed ...` (`data-notes-tag-empty`, still enabled; a pressed chip never dimmed). Existing live checks whose
   expected chip numbers encoded the old meaning were rewritten, not silenced (e.g. the typed-tag-nobody-carries check
   now expects the number of notes left once the chip is taken out).
3. **The new live stage made the run longer than the runner's fixed limit.** The 304 -> 320 checks took the dist run
   from 102 s to 142 s of wall time (the review's figures), and `RESULT_POLL_TIMEOUT_MS` was a hard-coded 240 s that the
   source run already passed in this sandbox (about 7 minutes, so it failed with "Suite did not finish" unless the file
   was edited by hand). **Changed:** `tests/ci_regression_runner.js` reads `BF_RESULT_POLL_TIMEOUT_MS` (a positive integer
   of milliseconds; anything else falls back to 240000 with one warning line) and `scripts/run_ci_locally.js` passes it on
   to its children unchanged; and the hashtag stage was made faster without weakening any assertion. **Numbers:** the
   first version of the stage was measured at about 29 s of a 150 s run (the review said about 40 s), and
   the time was located with counters wrapped around the helpers: 96 fixed 120 ms sleeps after actions (11.6 s), 15
   fresh dialogs at 300 ms each plus the 50 ms margin every `waitFor` adds (7.7 s), and 163 `waitFor` calls carrying that
   margin (11.3 s in all); the DOM work itself was a small remainder. The stage now waits for the concrete condition
   (`until` polls every 10 ms and returns the moment it holds; `quiet` waits for 40 ms without a DOM change) instead of a
   duration, awaits the dialog's own `getVvdNotes` reply instead of guessing 300 ms, and shares one dialog between
   steps that only drive the filter controls (putting it back to its just-opened state through those same controls, and
   opening a fresh one if that fails). No assertion was removed or loosened for speed (the lead compared the `const pass = a && b && ...` expression of every older
   check against the committed version: none has fewer terms; the bar check went 13 -> 15, the combo check 29 -> 30 and
   the "Show all" check 13 -> 46). Stage time before -> after: 29.1 s -> 10.6 s (the committed stage against the committed
   `dist/` vs the new stage against the new `dist/`, same machine, same harness, while now running 5 more checks);
   whole-suite wall time, source 6m52s -> 5m22s and `dist/index.html` 2m30s -> 1m52s. The variable is documented in
   docs/TESTING.md.
4. **Tag work ran on every render, and the regex was rebuilt per call.** `tagPool` and `draftTags` were recomputed on
   each render, which includes every keystroke in the draft editor; the review measured the pool recomputation at 0.38 ms
   a render with 100 notes and 5.2 ms with 5,000. Separately the grammar RegExp was built on each call and
   `extractNoteTags` built the plain/tag segments and discarded the text. **Changed:** the regexes are module-level and
   used only through `matchAll` (so the shared `lastIndex` stays 0), `extractNoteTags` reads the matches directly, and in
   the dialog `tagChips` and `draftTags` are `useMemo`s, with `allNotes` and `notesInSlicers` memoized so `listedNotes`
   keeps its identity between renders (a memo on an array that is rebuilt every render never hits). **Numbers** (Node 22,
   warm, 5,000 notes): the pool 3.9 -> 4.1 ms and a tag filter 4.3 -> 3.6 ms, old core against new (cost-neutral);
   `buildNoteTagChips` 1.1 ms at 500 notes and 11 ms at 5,000, run only when its inputs change. **Pinned by:** unit
   checks that the hoisted regex keeps `lastIndex` 0 across repeated and interleaved calls and that `extractNoteTags` equals
   the tags of `splitNoteText` on fuzzed input; the memo is pinned structurally, by source-structure unit checks (comments stripped): the chips come from
   `buildNoteTagChips(listedNotes, {...})` inside a `useMemo` whose dependency list holds `listedNotes`, `noteQuery`
   and every other input the options read, and that is the only chip call (never `collectNoteTags(filterNotesForList(...))`
   again) and is handed `listedNotes`, never `allNotes`; `draftTags` is `useMemo(() => extractNoteTags(draft), [draft])`;
   `allNotes` is a `useMemo` over `notesState.notes`, `notesInSlicers` a `useMemo` over `allNotes` and `visibleVvds`, and
   `listedNotes` only picks one of the two. **There is no check that a real render hits the memo** (no render counter),
   so a change that keeps this shape but makes an input unstable would pass.
5. **Tags with a letter that lower-cases out of the Latin range were dead.** The key is lower-cased and
   `toggleNoteQueryTag` re-checks `#` + key against the letter class, so `#İstanbul` (`İ` -> `i` + U+0307) and `#Ɛwe`
   (`Ɛ` -> U+025B) gave a key that was no longer a valid tag: the chip, or the tag button in the note, silently did nothing.
   **Changed:** the grammar uses `\p{L}` / `\p{M}` / `\p{N}` property escapes, which are closed under lower-casing, and
   still sit in strings passed to `new RegExp` (a regex literal would be expanded by the build into about 17,750 bytes
   of Babel's own tables). **Pinned by:** a unit check that walks every code point matching `\p{L}` (141,028 in Node 22)
   and requires key -> `toggleNoteQueryTag` -> `parseNoteQuery` to round-trip (a second walk covers every letter, mark and
   number allowed inside a tag), plus named checks for `#İstanbul`, `#Ɛwe`,
   Cyrillic and CJK, and a live check (`a tag in note text works whatever its letters ...`) that the real buttons for
   `#İstanbul` and a decomposed `#cafe` + U+0301 fill the box with a valid token and list their note, and that `#café`
   and its decomposed twin are ONE chip counting both notes. The 2026-10-02 unit checks that asserted "other scripts are not tags" were stale by design and were
   rewritten to the new rule, not silenced. A throwaway script (not committed) also saved `#İstanbul`, `#Привет`,
   `#日本語`, `#हिन्दी`, `#Ɛwe #ΣΑΣ` and a decomposed `see #café now` through the real `TeamSheet.gs` under the test's fake
   Sheets: every one read back byte-identical and gave the expected tag. That proves the code, not Google Sheets (the
   `/exec` line for it is in apps-script/README.md step 6). **Left as it is:** lower-casing is not case folding, so `#ΣΑΣ` (`σας`) is not
   `#σασ` and `#İstanbul` is not `#Istanbul`; each is a valid, working tag (CODE_NOTES.md, section 2).
6. **The in-note tag button did not wrap like the comment said.** The class was `inline`, but a `<button>` computes
   `display: inline` to `inline-block`, so the code comment "wraps with the words around it" was false. Checked in
   Chromium: the old class let a 36-character tag overflow a 200 px box (225 px wide); the new one wraps it to two lines
   inside the box. **Changed (a decision, not a bug fix):** the native `<button>` is kept for keyboard and screen-reader
   behaviour; the class is now `inline-block max-w-full align-baseline text-left [overflow-wrap:anywhere]`; a tag that does
   not fit the rest of a line moves whole to the next line, and one longer than a line wraps inside its own box. The
   comment was corrected. **Pinned by:** a live check (`the in-note tag button is a native button laid out inline-block ...`) that its
   class says so, not `inline`, and that a tag longer than the line wraps inside its own box instead of overflowing the
   note, plus a structural unit check that the tag is a native `<button>` whose class has `inline-block`, `max-w-full` and
   `align-baseline` and not the bare `inline`, and that the old claim "wraps with the words" is gone from the source. **Not verified:** how a very long tag wraps in Firefox and on Windows, and the ragged line end in a
   dense note was judged by eye only.
7. **Decomposed accents split the tag.** `#cafe` + U+0301 (text pasted from macOS) gave the key `cafe` and left the
   combining mark outside the button, a different tag from `#café`. **Changed:** `\p{M}` is allowed inside a tag and the
   key is NFC + lower-case (+ NFC), so a precomposed and a decomposed accent are one tag and one chip, and the mark sits
   inside the button. The same rule keeps `#हिन्दी` and `#สวัสดี` whole (their vowel signs are marks). **Pinned by:** unit
   checks that NFD and NFC give one key, that the split stays lossless with the mark inside the tag text, and that an
   NFD query finds an NFC note. The 2026-10-02 "corner left as it is" for NFD is retired.
8. **The runner printed its own copy of the count history.** The `Executed checks` console line carried the whole
   dated history of totals (the review said about 5 KB; the line measures 6,976 characters at the 2026-10-02 commit)
   next to the one in the comment above `EXPECTED_TOTAL_CHECKS`, and it had not been extended for the hashtag work (it
   stops at "300 to 304", the comment goes on to 320), so the two disagreed. **Changed:** the line prints only the per-suite breakdown and the
   total against `EXPECTED_TOTAL_CHECKS`; the dated history lives only in the comment above that constant, which now has a
   2026-10-03 entry. **Pinned by:** nothing automatic; it is a code-comment convention (one copy of the history).

**Counts, all from real runs** (the lead fills these in at the end): headless `check_team_features_logic.js` 311 ->
**337/337** (the checks rewritten to the new grammar are counted in the totals, not added on top; the file takes about 2.1 s
now instead of 0.8 s because two checks walk every Unicode letter, 141,028 code points, about 1.2 s);
`Apps_Script_Team_Features` 76 -> **81**, its tripwire 75 -> **80**; live total 320 -> **325** (executed 325, expected 325,
on source and on `dist/index.html`; the hashtag stage is 21 live checks, 1 Setup + 20, and no other suite moved). New checks
were red-run against deliberately broken copies of the app: the unit checks against 39 mutants (24 of the core, 15 of the
dialog's wiring), every one caught except a single equivalent mutant (dropping the FIRST of the two NFC passes changes
nothing observable: 0 differences over 3,000,000 random strings, so it is redundant; the second pass is the one that
matters, `H` + U+0331 only becomes U+1E96 after lower-casing); the live checks against 20 mutants, 18 caught and 2
survivors that are redundant guards (the long-tag wrap rule is on both the button and its holder, each alone is enough;
removing both is caught). Final gate (the lead's own run on the integrated tree, with `BF_RESULT_POLL_TIMEOUT_MS=1500000`): `node scripts/run_ci_locally.js` passed every job, 16 of 16, in 8m32s; the live suite executed 325 of the expected 325 checks on the source (313 s) and on `dist/index.html` (112 s), with the same per-suite counts both times, equal to the `docs/TESTING.md` table except `Apps_Script_Team_Features`, which is 81 as documented; the headless team-features file passed 337/337.

**Not verified:** anything on a deployed `/exec` URL (the production checklist in apps-script/README.md now has a line for
`#İstanbul` and `#Привет` surviving a save and reload); how a very long tag wraps in Firefox and on Windows; whether
real Google Sheets stores an exact `#N/A` note as text; and every performance number above is from Node, none timed in a
browser. Unicode property escapes need a browser that supports them natively (Chrome and Edge 64, Firefox 78, Safari 11.1,
from memory); nothing here tested an older one.

## 2026-10-04: one app-file resolver, ties are an error

**What drifted.** The rule "which `Booking_flash_report_na*.html` is the current app" was documented as living in seven
hand-synced copies; by 2026-10-04 it had grown to ten (JS checks, Python checks, an inline `ci.yml` step, the AGENTS.md
snippet). The copies disagreed on cases nobody had tested. With two non-testing files at the same highest version, the JS
copies took the last tied file in listing order and the Python copies the first. `2.0` and `2.0.0` were also resolved
differently between them (a missing version part did not count as 0 in every copy). Two checks in one run could therefore
validate two different files and both report green, the same class of failure as the `1.67_TESTING` incident above.

**What changed.** `pickCurrentAppHtml(fileNames)` in `scripts/lib/app_file.js` is now the only implementation (pure: names
in, `{file, excluded}` out; `findCurrentAppHtml()` reads the repo root). JS checks `require()` it; Python checks, the
AGENTS.md snippet and the `ci.yml` step run `node scripts/print_app_file.js`, which prints only the file name to stdout
(skipped testing builds go to stderr) and exits 1 with a reason when there is no candidate or a tie. Versions compare
numerically with a missing part counting as 0, so `2.0` and `2.0.0` tie.

**Why ties throw.** A tie means "current app" is ambiguous, and any tie-break (first, last, longest name) is a guess that
two callers can make differently. Throwing makes a human rename or move one file; the cost is one loud failure instead of
a green check on a file nobody meant. **Pinned by:** `tests/check_resolve_app_html.js`, which tests the resolver (ties,
`2.0` vs `2.0.0`, testing builds) and fails if a new hand-copied version of the regex appears in `tests/`, `scripts/` or
`.github/` (recursively) outside `scripts/lib/app_file.js`. The rule is still inferred from filenames; an explicit committed pointer remains an
optional further step.

**Follow-up (code review of this change, 2026-10-05).** The rule was moved out of the Playwright benchmark harness into a
neutral `scripts/lib/app_file.js` (the build, the CLI and a dozen checks depend on it; `tests/perf_benchmark.js` re-exports
it so existing callers are unchanged). `tests/check_resolve_app_html.js` went from 18 to 26 assertions: a tie in the repo
root is now reported as a failed assertion naming both files instead of an uncaught stack trace before any assertion ran;
the `print_app_file.js` contract that Python and CI parse (stdout is exactly one file name, the skipped-testing-build note
goes to stderr, exit 1 on a tie or no candidate) is pinned against a throwaway directory; and the guard now scans
recursively, covers `.mjs`/`.cjs`/`.ts`/`.sh`, also looks for the pattern's literal opening, and has self-tests proving it
flags a nested copy and spares the two owner files. It remains a tripwire for the realistic way a copy appears, not a proof.
The two Python CI jobs now pin Node like every other job, since they call `node scripts/print_app_file.js`.

## 2026-10-05: shared-logic sync check (`tests/check_shared_sync.js`)

**Why it exists.** The roadmap's new logic (the "data as of" formatter, the feed canary, `diffSailings`,
`findExceptions`, view encode/decode) has to run in the browser app and in Apps Script, and the app is one file with
one writer at a time. (The roadmap plan, docs/ROADMAP_PLAN.md, is in review on a separate pull request and is not
in this branch yet; the glossary at the top of `tests/fixtures/HISTORICAL_EXPECTED_VALUES.md` says what its slice
numbers, decisions and roles mean.) Decision D1 (Kevin, 2026-10-05) put that logic in `shared/*.js`, copied by
`scripts/sync_shared.js` into two generated places: a marked region of the app file and `apps-script/Shared.gs`. A
generated copy cannot drift by itself; it drifts when someone forgets to run the sync or
edits the output by hand. The repo has already paid for hand-synced copies: by 2026-10-04 the app-file rule existed in
ten of them and they disagreed on cases nobody had tested (the 2026-10-04 entry above). This check is what turns "the
sync was forgotten" into a red check instead of a browser and a server quietly running different code, the same
shape as the `dist/` staleness check (check 6).

**What it guards.** First and foremost staleness: it runs `node scripts/sync_shared.js --check` and fails when the
generated region in the app file or `apps-script/Shared.gs` differs from what a fresh sync of `shared/` would write (a
`shared/` edit committed without re-running the sync, or a hand edit of either output). Around that it runs the same
shared code through every route it ships by (the app's region, the build's Babel path, `Shared.gs`, `loadShared()`),
checks `isRealVvd` against every real VVD of the 9-day CSV, lints `shared/` (ES5 only, no environment globals, the
slash-star rule, LF), guards against hand-copied definitions of shared functions elsewhere, and exercises the sync
command on throwaway copies; the header comment of `tests/check_shared_sync.js` (sections A to F) is the authoritative
list, since this summary can fall behind it. It is a headless check (no browser) wired in the three places
the "Adding a check" rule requires: `.github/workflows/ci.yml`, `scripts/run_ci_locally.js` and the table in
[TESTING.md](TESTING.md). **Merge rule that follows from it:** two PRs that touch `shared/` regenerate the same files,
so shared-logic PRs merge one at a time, and on a conflict in generated files neither side is taken: resolve `shared/`,
re-run the sync, commit what it writes (a hand-merged region can look right and still not match what the script emits).

**What it does not prove.**

- That the shared logic is right beyond what it pins. The staleness check compares copies, so a wrong function copied
  faithfully passes it; what is pinned of the logic itself is a hand-written table for `normalizeVvd` and `isRealVvd`
  and the CSV cross-check, and each new module needs its own behaviour tests against real data (see `docs/TESTING.md`).
- That `Shared.gs` works in Apps Script. Nothing here runs it on `/exec`; that stays a production-only question
  (AGENTS.md).
- That the app still runs or that `dist/index.html` is current. The generated region is part of the app file, so a sync
  is an app change: checks 1, 4 and 6 still apply.

## 2026-10-05: historical-days helper check (`tests/check_history_days.js`)

**Why it exists.** The next slices (the feed canary, `diffSailings`, `findExceptions`) all need ground truth from the
committed 9-day CSV: which rows belong to which `Record Date`, which are VMS placeholders, what a sailing is, which
sailings carry no PIC. Without one shared reader each check would parse the file its own way, and this file punishes
that: 8,769 data rows but 27,312 physical lines (quoted cells hold newlines), so `wc -l` is wrong by a factor of three
(AGENTS.md, "Verify against real data"). `tests/lib/history_days.js` reads the CSV directly with an RFC 4180 parser and
slices it by `Record Date` in code. It commits no derived data files, so there is nothing to drift (the roadmap's slice
0.3 as revised; the first plan was trimmed fixture files). It also holds deliberately naive reference oracles
(`diffVvds`, `classifyDisappearances`, `classifyArrivals`, `unownedStreaks`, `ladenOverMax` and others), written
independently of `shared/`, so the real implementations are tested against something other than themselves.

**What it guards.** The parser's behavior on the cases the helper's header lists (quoted newlines, escaped quotes, a
BOM, the three line endings, a missing final newline), the helper's per-date slices, and the expected values asserted
from `tests/fixtures/HISTORICAL_EXPECTED_VALUES.md`, which are written down before the logic that must reproduce them
(the roadmap's "R4 evidence first" rule). Not every value in that file is asserted: the ones marked *documented, not
asserted* there are stated but untested. A failure prints got/want; to regenerate a pinned number deliberately, run
`node tests/check_history_days.js` (or require the helper in a REPL) and read it from there.

**What it does not prove.**

- That any product logic is right. The oracles are naive stand-ins, not product code; a later check compares the real
  implementation to them.
- That the live feed or the daily archive looks like this file. It pins one static window (2026-08-24 to 2026-09-01);
  other weeks, holidays, a changed export schema and the `.xlsx` path are not represented.
- Anything about a replaced CSV. By design the pinned values then fail loudly and must be re-derived from the new file
  and re-recorded, not edited to match.

## 2026-10-05: the phone-width slicer box gets a test (review fix X12, +1 check)

**The gap:** PR #159 (roadmap slice 1.3) fixed the slicer box being squeezed to ~94 px beside the 256 px Fields column at phone
widths, by giving it `basis-full sm:basis-[0%]` (the old `flex-1` 0% basis made its hypothetical width ~0, so its wrapping row
never wrapped). It added no test, so removing the class passed every check.

**Pinned by** one new `Booking_Flash` check (16 to 17, 325 to 326 live; no app change, so `dist/` is untouched). A media query
cannot be exercised from a desktop-width window, so the check clones the filter panel's row into a hidden 390 px iframe that
carries this page's generated stylesheet (so Tailwind's `sm:` breakpoint is evaluated against 390 px) and asserts the slicer
box is the full width of its row and that none of its siblings sits beside it. Not vacuous: it fails if the box, the row or a
sibling is not found or the frame did not load. With `basis-full sm:basis-[0%]` removed from a copy of the app the box measures
about 149 px (the full 390 px-wide row with it).

**Not verified:** a real phone (the 390 px check is an iframe replica of the row, not the whole page at 390).

## 2026-10-05: slash-star inside a line comment breaks the comment stripper

**What happened.** While inserting the generated-region markers for the shared-logic pipeline (slice 0.2), the first
wording of the marker comment named the sources as `shared/*.js`. With that comment in the app file,
`tests/check_team_features_logic.js` went from 337/337 to **5 failed**, all in the notes dialog's wiring checks and none
about shared logic: the tag bar's chips coming from `buildNoteTagChips` inside a `useMemo`, the privacy invariant on the
chip helper's argument, `draftTags` being memoized, `listedNotes` being a stable reference, and the in-note tag button's
classes. Each failure printed `got: [false,...]` where `[true,...]` was wanted, i.e. it said the dialog's code was
missing, not that anything was wrong with a comment, so nothing pointed at the cause. The marker text was reworded to
say "the files in shared/".

**Root cause, reproduced on a scratch copy of the app file (2026-10-05).** Line 2042 of that check strips comments from
the app source with `panelSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')`: block comments first,
line comments second. The first pass knows nothing about `//`, so a `/*` inside a `//` comment opens a "block comment"
that runs to the next `*/` anywhere later in the file. Here that was the end of a JSX comment at app-file line 1550,
against the marker at line 226; the pass deleted 67,253 characters (1,117 lines) of real code in between, including the
dialog's `tagChips` `useMemo` (line 1493), before the checks searched it. Line numbers are for the file on that day.

**The rule.** Never write `/*` outside a real, closed block comment, in the app file or in `shared/` (which is copied
into it): name a directory as `shared/`, not as a glob. Babel and the browser are unaffected (they parse real syntax),
and `stripJsComments` in `tests/check_basic_build.js` is not exposed (it is a scanner that reads `//` first); the
hazard is specific to source-grep checks that strip with that regex.

**Left as it is.** The stripper in `check_team_features_logic.js` was not changed here. Making it comment-aware, like
`stripJsComments`, would remove the hazard; until that is done the rule above stands, and it is in AGENTS.md ("Shared
logic", which also says how it is enforced) because the next person to write a comment containing a glob will not get
a useful error.

## 2026-10-05: shared-logic behaviour check (`tests/check_shared_logic.js`)

**Why it exists.** The sync check (the entry above) proves the generated copies match `shared/`; it cannot tell
whether a function does the right thing, only that the browser and the server run the same wrong one. This check is the
other half: one test module per `shared/` file, in `tests/shared_logic/`, each pinned to the real 9-day CSV through
`tests/lib/history_days.js`. Wired in the three places the "Adding a check" rule requires (`ci.yml` job
`shared-logic-check`, `scripts/run_ci_locally.js`, the table in [TESTING.md](TESTING.md)); it needs no npm packages.

**What it holds today: 442 assertions in 4 modules** (3 meta, 47 for `diffSailings`, 62 for `checkFeed`, 330 for the
view codec), from a real run, and the same count under `TZ=UTC`, `Pacific/Kiritimati` and `America/Los_Angeles`.

- **`diffSailings`** reproduces the history oracle on all eight day-pairs: on the Monday rollover (2026-08-30 to
  08-31) 24 sailings roll out (W29) and 23 roll in (W46); laden OUT 26,065, IN 136, continuing +1,248, net -24,681;
  booking OUT 25,287, IN 100, continuing +1,260, net -23,927. The naive row-sum would say OUT 69,625: booking is
  sailing-level (identical on every port row), so summing port rows double counts about 2.6 times, which the test
  asserts as a trap.
- **`checkFeed`** is silent on all nine real days (rows 994 down to 970, real rows 928 down to 896, 98 headers) and on
  a live export fetched the same day (99 headers, not committed). Without the VMS exclusion it would report 65 to 73
  false duplicate keys a day, which is also asserted as a trap. Each seeded breakage gives its own code.
- **`encodeView` / `decodeView`** treat the link as hostile input: a CRC-24 suffix, whole-key rejection for structural
  problems, per-value dropping only for stale values, a whitelist that deliberately leaves out `topPanelCollapsed`,
  limits on length, items and nesting, and `__proto__` / `constructor` refused at every level.

**What the lead re-checked** (independent of the agents' own tests, through the generated `Shared.gs` in a bare `vm`):
the eight `diffSailings` pairs above; `checkFeed` on the nine days, on the live export and on seven seeded breakages;
and the codec with 14 forged hostile links carrying a valid checksum (computed by a second CRC-24 that reproduces the
codec's golden link `v1.e30.uoPo`), 1,928 single-character tampers (none accepted) and a full round trip. None
touched `Object.prototype`. **Mutation testing** was run by the agents in scratch copies and is their report, not
re-run by the lead: 22 of 22 `diffSailings` mutants killed; 24 of 25 `checkFeed` mutants killed (the survivor is
equivalent: a null previous count and a zero one mean the same); 136 of 142 codec mutants killed (the six survivors are
redundant guards).

**Two traps the authors hit, now in the `shared/` rules.** A `typeof x === 'object'` (or `'symbol'`) comparison makes
the build's Babel pass add a top-level `_typeof` helper, a second top-level name, which fails check B of the sync check
(probed: `'string'`, `'number'`, `'boolean'`, `'function'` and `'undefined'` are clean). And check E scans `tests/` for
re-definitions of exported names, so a test module calls the function through a local alias.

**What it does not prove.**

- That any of this works in Apps Script. `Shared.gs` was run only in Node's `vm`; the first load in a real project is a
  production-only question (AGENTS.md).
- That the app uses these functions correctly: it does not call them yet. The wiring slices bring their own checks. One
  guard the codec will need then: every key written as a literal in a `renderFilter('...')` call today (48 distinct, all
  camelCase identifiers; keys built any other way are not covered) passes the codec's column-key rule, but nothing yet fails if a future key breaks it, in which case
  `encodeView` would return `null` for any view with a header filter.
- Time zones beyond the three tried: the runner uses the zone the process has.

## 2026-10-05: the 2.5 testing build, and an executed-check count pinned per target

**Why it exists.** Kevin asked for the wave-3 features to be built in "a new version 2.5_testing" and not in the main file.
`Booking_flash_report_na_2.5_TESTING.html` began as a byte-for-byte copy of the main file. Its name contains "testing", and
`scripts/lib/app_file.js` excludes such names from "which file is the current app" on purpose, because in September 2026 testing
builds sitting above the main version silently captured every check (README, "Read this before trusting a version number").
So the one thing that was safe by design would also have left the new file completely unchecked: not by the syntax check, the
regression suite, the build or the sync.

**What was added so it is not unchecked.**
- `scripts/sync_shared.js` now also writes, and `--check` also verifies, the generated shared-logic region of any other app
  build in the repo root that carries a marker line. The marker is the opt-in, so older testing builds (`1.67_TESTING`) are
  ignored without a word, and a build with a damaged marker fails by name. `tests/check_shared_sync.js` 122 to 142 assertions.
- `tests/ci_regression_runner.js` has a `TARGETS` table: `main` (the auto-detected main file and `dist/index.html`, 325 checks)
  and `testing-2.5` (the 2.5 file, reached only through `BF_APP_HTML`). The runner tells the page which target it is
  (`window.__BFRT_TARGET__`) before the suite runs, pins the executed-check count per target, and fails if the page reports a
  different target. A testing build with no row in `TARGETS` is an error, never a quiet fall back to `main`.
- `.github/workflows/ci.yml` job `testing-build-check` (blocking syntax check; the regression run is informational, like the main
  file's source run) and the two matching entries in `scripts/run_ci_locally.js`. The file name is written out in those places on
  purpose, so promoting or removing the build fails loudly.

**Why the suite is TOLD its target and does not probe for the feature.** A wave-3 suite that asked the page "is there a stamp?"
would skip on a build that lost the stamp, which is precisely the silent skip "Check the executed-check count, not the pass
rate" exists for. Told its target, a missing feature makes a check FAIL, and a skipped suite changes the pinned total.

**Evidence.** Against the exact copy, both targets execute 325 of 325 and pass: `main` reports "suite ran as main", `testing-2.5`
reports "suite ran as testing-2.5". `scripts/run_ci_locally.js --fast` passes with the new jobs.

**What it does not do.** The 2.5 file is not deployed and has no `dist/` copy; the regression run against it is informational in
CI (the harness has the same known flakiness as the main file's source run).

## 2026-10-05: feed-age helpers added to `shared/` (wave 3), and what the behaviour check holds now

`shared/40_feed_age.js` adds `formatAge`, `feedFreshness` and `previousAvailableDate` (roadmap 1.1 and 2.2), with
`tests/shared_logic/40_feed_age.js` (33 assertions). `tests/check_shared_logic.js` now reports **475 assertions in 5 modules**
(3 meta, 47, 62, 330, 33), up from 442 in 4. The new module's tests include every threshold of every branch with the value one
millisecond or one ulp either side, a 230,404-point minute sweep against integer arithmetic, hostile inputs (NaN, Infinity,
boxed numbers, symbols, BigInt, an object that throws if coerced), calendar sweeps against the host calendar for every day
1899 to 2101 and every year 0000 to 9999 for February, and a purity test that makes `Date`, `Date.now` and `Math.random` throw
while the three functions run. The agent that wrote the module reports a hand mutation test that killed 116 of 116
non-equivalent mutants after it found and closed one real gap (a loosened date regex survived because no junk string was ten
characters long with the digits grouped wrongly); that figure is its report and was not re-run. Run under five time zones
(UTC, Kiritimati, Los Angeles, Pago Pago, Kolkata) the check gives the same 475; that was re-run independently.
Adding the module regenerates the region in the main app file and the 2.5 testing build, and `apps-script/Shared.gs`; both app
files grew by the same 1,511-line region, byte for byte.

## 2026-10-05: the Feed_Stamp suite (slice 1.1, 2.5 testing build) and the bug it found before the code was committed

`Feed_Stamp` (23 checks, the `testing-2.5` target only, pin 325 to 348) pins the "Data as of" stamp: kind and level attributes, the three text
formats, the stale threshold at 59/61 minutes with a 30-minute interval and 119/121 with none, the fallback when a reply has no `ageMs`, the Settings
toggle and its persistence across a reload, and that the 30-second tick re-renders only the stamp (it counts the React elements created for 10 minutes of
ticking against one whole-app re-render). It was written by a separate agent from the contract, **before** the feature existed, and run against a
throwaway prototype (all 22 pass) and against the pristine copy (17 fail, each for a missing hook, not a typo).

**What it found.** On first contact with the real implementation, 19 of 22 passed and 3 failed with one signature: after the first case in a check,
the stamp kept showing the first reply's text. The tests change a reply's `ageMs` while leaving `fetchedAt` fixed, and the implementation's state setter
treated "same `fetchedAt`" as "nothing changed", so it silently discarded the newer reply's age. A real deviation from the contract ("the age is each
reply's `ageMs` at receipt plus the time elapsed since"), mostly harmless in production (a re-reported copy's age grows with the clock) but wrong in
principle. The setter now keeps the old state only when the new reply describes the same copy and implies the same fetch instant to within 5 s
(`feedInfoSame`), so an idle poll still does not re-render the dashboard and the server's latest statement wins when it disagrees. The suite then passed
22 of 22 (347 of 347 on the target at that point). A comment written first had claimed the old behaviour was "equally correct"; it was only correct when the replies were
consistent, which is what the tests showed.

**A follow-up from the visual review (also 2026-10-05).** Measuring the real build in a browser (390, 700, 1100 and 1366 px, light and dark, with the
stamp on and off) found that the stamp costs the page exactly one row (+16 px, +32 px under 640 px) and that fresh versus stale never moves the table, but
that a very long uploaded file name pushed the part the stamp exists to show, "modified {date} {clock}", out of view: a 150-character name was clipped to
two lines at 390 px and cut by the ellipsis at 700 px. The name now sits in its own `[data-feed-stamp-name]` box that is shortened with an ellipsis
(12 rem under 640 px, 20 rem above), so the tail always shows; `textContent` and the tooltip are unchanged. One check pins it (a 300-character name: the
name box is clipped, the stamp as a whole is not, the text still ends with the modified part, the tooltip has the whole string). Feed_Stamp is now 23
(22 checks and the tripwire), the target 348; the pristine copy fails 18 of the 23, the new check among them, and the previous build (without the name box) fails it with `nameClipped: false, stampClipped: true`, the defect itself. Two things the review measured but this repository cannot settle: the stamp's "⚠" is drawn as a plain
glyph in this sandbox and may be an emoji on other platforms, and real fonts (Segoe UI, SF, Roboto) were not available, so the widths are those of
DejaVu Sans and of Arial-metric text.

## 2026-10-05: the Offline_Cache suite (slice 1.2, 2.5 testing build) and what mutation testing showed it was missing

`Offline_Cache` (48 checks: 47 and the tripwire; the `testing-2.5` target is 396 with it) pins the last-good CSV cache: a good live load is written to
IndexedDB byte for byte (through the server's gzip) and a later different one replaces it; when the first load fails on **both** paths, or the reply
arrives but is not a Booking Flash export (a sign-in page is never written), the cached rows and a banner say what is on screen and how old it is; the
stamp reads "Cached copy"; showing the cache writes nothing; a later good load replaces it directly; an upload or a historical snapshot ends or hides the
banner; fresh data beats an old entry; the Settings toggle defaults on, off stops writes and deletes the entry; and the app copes, with no banner and no
uncaught error, with `window.indexedDB` undefined, throwing a SecurityError, or holding an entry of the wrong shape. It was written by a separate agent
from the contract before the code (the harness cannot be fooled by a feature that merely exists: it reads the real IndexedDB store).

**Mutation run, by the lead.** Ten deliberate breakages of the implementation were each run against the wave-3 suites (one at a time, in a copy of the
build). Six were caught by the suite as delivered: writing the cache while the setting is off, an upload that no longer clears the banner, rewriting
identical text on every load, the banner shown over a historical snapshot, switching the setting off without deleting the entry, and writing the cached
replay back (which would refresh its "saved" time and make old data look new). **Four survived**, which is the finding:

- *The cache replacing data already on screen* (the guard `hasLoadedDataRef || ticket` in `showCachedFeed`). A manual upload that lands while the cached
  copy is still being read must stay on screen. Now pinned by `Race`: the harness holds the app's `indexedDB.open()` until the test releases it
  (`holdIdbOpen`), uploads 500 rows meanwhile, releases the read, and asserts no banner, the same rows, stamp kind `upload`, the stored entry untouched. The
  app gives up on a read after 4 s, so the check records how long the read was held and fails if that was 3.5 s or more (the race was not exercised)
  instead of passing quietly. Without the guard it fails; with it it passes.
- *Refresh Now's "the Sheet still holds the export already showing" shortcut ignoring that the export on screen is the cache.* If the server comes back
  carrying exactly the cached text, the banner would stay up for good and the entry would never be re-saved as a live load. Now pinned by `Same text`.
  Without the `!showingCachedRef.current` test it fails; with it it passes.
- *A background poll replacing cached data directly* (M2), and *the red "couldn't load" bar being hidden under the cache banner after a later poll failure*
  (M8). These survived the first run because both need the background poll to fire while the cached copy is up, and the harness clock captured only the
  30 s stamp tick. **Now pinned** (see the next section): `Poll replaces cache` fails without `|| showingCachedRef.current` in the poll's apply gate, and
  `Poll fails` fails without `&& !cachedInfo` on the red bar. M2 puts up a "New data is available" prompt instead of switching, and M8 shows
  "Lost connection ... Still showing the last data successfully loaded" over data that is the cached copy. (M8's guard is redundant on the first-load
  path, because applying the cached copy already clears `autoFetchError`; only a poll failure after the cache is up reaches it, which is why this check
  needs the poll.)

Adding the first two checks took the suite from 32 to 36 (each scenario is a setup record and a check). Each is checked in both directions: failing on the
broken build, passing on the real one.

### Follow-up: the poll path (M2 and M8), 35 to 39 checks

The data poll is armed with `scheduleAlignedInterval`: a `setTimeout` of `intervalMs - (Date.now() % intervalMs)`, `POLL_INTERVAL_MS` = 10 min, and the
5 min app-update poll is armed the same way, which is why the 30 s clock could not tell them apart. They are separable by delay: boot option `clockPoll`
installs the clock with an offset that makes `Date.now() % 600000` 30 s, so the data poll's delay is about 570 s (inside 300 s to 600 s) while the
app-update poll's can never exceed 300 s. `installClock` captures only timeouts in that window and `clock.firePoll()` runs them now (the poll re-arms
itself, and the new timer is captured again). Two new scenarios, each a setup record and a check, on cached rows with a failing feed:
`Poll replaces cache` (Auto-Refresh switched off for the scenario, because with it on the app auto-applies a staged poll result within moments and
the mutant would look the same; feed fixed, poll fired: live rows, no banner, no "New data is available" prompt, entry re-saved as the live export) and
`Poll fails` (poll fired with the feed still down: banner and cached rows stay, no "Lost connection to the Sheet" text). Both assert that at least one
poll timer was fired (two are: the Sector Summary poll has the same 10 min interval and fires with it, harmlessly) and that a new live request reached the fake server, so a poll that never fires cannot pass by doing nothing. Each is checked in both
directions against a scratch copy of the repo with one mutant applied: see the PR for the output.

### Follow-up: the code review of 2026-10-06 (three scenarios, 39 to 47 checks)

A review of the whole 2.5 stack (the lead then checked every finding against the code; one was a false alarm) found three problems in this slice and one check that could
not fail. Each is fixed or pinned below, and each new check was run against a build with its fix removed.

- **A poll replaced the cached copy even under an open historical snapshot or Compare view.** The poll's direct-apply gate was `!hasLoadedDataRef || showingCachedRef`, which
  skipped the "do not yank the reader out of a snapshot" rule that every other load path follows. Fixed with `&& !viewingHistoricalDateRef.current` on the cached half (a ref,
  because the poll effect is created once). Pinned by `poll-during-snapshot` (a setup and two checks): with a snapshot open, a good poll leaves the snapshot and its rows alone, and
  Back to Live then brings in the live export and saves it. With the guard removed the first check fails (`stillViewing: false`, the snapshot replaced by 439 live rows) and so
  does the second, as a consequence.
- **A failed Refresh Now left no trace under the cached banner**, because the generic red bar is hidden there. Fixed with one line inside the banner,
  `[data-cache-refresh-error]`: "Refresh Now did not work (Failed to fetch). Still showing the cached copy." Background polls stay quiet (pinned by `Poll fails`). Pinned by
  `refresh-fails` (a setup and two checks): the line appears, the rows stay, no second red bar; once the feed is back Refresh Now removes the banner and the line. With the line's
  `setCacheRefreshError` removed the first check fails (`shown: false`).
- **The "setting off" check could not detect the read gate going missing.** With the setting off the app deletes the stored copy at mount, so a boot finds nothing to read whether or not
  the gate exists; removing both guards in `showCachedFeed` left all 82 wave-3 checks green (run by the lead). The new `off-and-put-back` scenario holds the database open, lets the
  delete through alone, puts the same entry back as if another tab had written it, then releases everything: a build with the gate opens the database once in total (the delete)
  and shows nothing; without the gate it opens it a second time and shows the entry. It uses a second harness control, `ctl.releaseIdbNext()`, and `holdIdbOpen` now queues every
  waiting open instead of keeping only the latest. Removing both guards fails it (two opens, banner and rows on screen); removing only the first guard fails it on the open
  count alone, because the second guard still keeps the entry off the screen. **Removing only the second guard is an equivalent mutant** (the first already returns before any read)
  and passes, so the second guard is defence in depth, not separately pinned. A first design that toggled the setting from Settings while the read was in flight could not
  work: there is no Settings button on the failed-load screen.
- **Not fixed, documented** (CODE_NOTES.md, "Known gap"): the cached copy is only ever requested by the initial-load effect, so a poll tick or Refresh Now that claims a ticket during the
  first fetch leaves the screen empty for the rest of an offline stretch. **Fixed 2026-10-06** (follow-up round, below): every failed live load asks for the copy; CODE_NOTES.md,
  "Every failed live load asks for the copy".

Counts: `Offline_Cache` 40 to 48 (three scenarios of 3, 3 and 2 records), the `testing-2.5` pin 388 to 396; `main` stays 325. Mutation runs (lead): three of the breakages together in one
run (the poll guard, the failure line, both read-gate guards): exactly four checks failed (the poll check and its Back to Live consequence, the Refresh Now check and the read-gate check),
each showing its own symptom; the first guard alone failed the read-gate check on its open count.

## 2026-10-05: the Feed_Canary suite (slice 1.5, 2.5 testing build), a contract the first implementation broke, and a mutation run that found no gaps

`Feed_Canary` (24 checks: 23 and the tripwire) plus two **silence** checks added to `Apps_Script_Team_Features` on the `testing-2.5` target only (its tripwire
is per target: 80 on `main`, 82 here) pin the feed-check banner; the target is 422 with them and the slice-1.2 suites below it (409 when this suite was first written). They were written by a separate agent from the contract before the
code. The suite pins: no banner element at all on a healthy load and on the two fixtures every other suite loads (the silence checks); a row-count drop
(half the rows: one banner, `ROW_COUNT_DROP`, naming both counts, and the data still loads); a repeated row (`DUPLICATE_KEY`); a renamed column
(`MISSING_FIELD`, naming it); the rolling baseline (the next similarly small load is silent, the baseline now holds the new count); the baseline surviving
from the previous session (the FIRST load of a fresh page against a seeded baseline twice its size is flagged); a flagged load never overwriting the
last-good copy; Details and Dismiss, and that a dismissal is per code list; an upload clearing the banner and not itself being checked (the baseline key and
the cache entry untouched); the Settings toggle (off: nothing shown, baseline not written, the load cached as before); the banner hidden over a historical
snapshot and back; and a cached replay running no check at all (a renamed-column text that would also be a 96% drop shows nothing).

**A contract the first implementation broke.** On first contact with the real build 22 of the 23 passed; the failing check was Details. The suite's contract
is a button labelled "Details" whose `aria-expanded` flips; my implementation also changed the label to "Hide details". The suite is right: a label that
changes while `aria-expanded` also changes is announced twice by a screen reader, so the app was changed (the label stays "Details"), not the check.

**Mutation run, by the lead.** Nine deliberate breakages of the wiring (not of `checkFeed` itself, which has its own 62 assertions and module-level
mutation testing from the shared-logic wave), each run against the wave-3 suites in a copy of the build: **9 of 9 killed, each by the check written for it.**
A flagged load still being saved as the last-good copy; the baseline never updated (5 checks fail); the check running with the setting off; an upload not
clearing the banner; a dismissal hiding every later code list (2); the banner over a historical snapshot; the previous row count not passed to the check (2);
a clean load not clearing an earlier banner; the stored baseline off by one row (5). That is the contrast with slice 1.2, where the same exercise found four
survivors, two of which needed new checks. What this run cannot show: the two silence checks in `Apps_Script_Team_Features` are outside the wave-3-only driver
and are covered by the full gate's run of the whole target.

### Follow-up: the code review of 2026-10-06 (22 to 23 checks)

A review of the 2.5 stack (every finding then checked by the lead against the code) found two problems in this slice and raised one design question.

- **A dismissal was never cleared by a clean load.** The banner is dismissed per code list; after the feed recovered, the very same problems coming back stayed hidden. A clean
  load now clears the dismissal (`setFeedCheckDismissed('')` next to `setFeedCheck(null)`). Pinned by `Recovery re-arms the banner`: dismiss a list, load a clean export, load the
  same broken one again, and the banner is back with the same codes (it counts new parses as well, because the suite's `load()` reports "applied" if the text was ever parsed and
  that text was parsed in the step before). With the reset removed, only that check fails.
- **The Dismiss check could pass vacuously.** It asserted that no banner was shown after a second load with the same codes, which is equally true if that load raised nothing at all.
  It now also asserts that the cache saw no new write: a load the check flags is never saved as the last-good copy and one it does not flag is, so an unchanged put count proves the
  problems were raised and the dismissal is what hides them. Run by the lead against a build where a dismissal silently makes the check raise nothing: the **old** check passed
  (23 of 23, a survivor), the new one fails, and nothing else fails.
- **Open design question, not changed (for Kevin). Decided 2026-10-06: see the entry "Kevin's decisions on Show in table and the offline-copy baseline" below.** The row-count baseline moves after every applied load, flagged or not, so a feed that stays truncated warns once and is then the
  new normal; after a page reload, that truncated text is no longer flagged and is saved as the last-good copy. A separate "last healthy row count" used only to guard the cache would
  keep the cache from following the truncation without making the banner nag. The current behaviour was chosen deliberately (a drop is reported once) but its effect on the cache was
  not spelled out until this review.

Counts: `Feed_Canary` 23 to 24 (one new check); with the slice-1.2 suites under it the `testing-2.5` pin is 422 (325 + 23 + 48 + 24 + 2); `main` stays 325.

## 2026-10-05: the Phone_Layout suite (slice 1.3, 2.5 testing build), and the fix that first shipped with no check

**The bug.** The grey slicer box (Coast, Sub Trade, Lane, ... and the Clear Filters badge) shares a wrapping row with the fixed-width (256 px) Fields/macro
column. The box's `flex-1` gives it a 0% flex basis, so its hypothetical width is about zero, the row never decides it needs to wrap, and the 256 px column takes
its share first. At 390 px the box was squeezed to **94 px**, with its contents spilling out under that column. The fix is one class pair on that one element,
`basis-full sm:basis-[0%]`: below 640 px the box takes the full line and the column wraps beneath it; from 640 px up the basis is the original 0%.

**How the fix first shipped.** PR #159 made the change in the main file with no automated check, only a before/after screenshot comparison (pixel-identical at
desktop width, full width at 390 px). This change in the 2.5 testing build is the same class pair, and adds this suite. A layout fix that nothing measures comes back the next time someone edits those classes.

**What the suite pins** (`Phone_Layout`, 5 checks: 4 and the tripwire; two boots that differ only in the iframe's width, via a new `width` option of the wave-3
harness's `boot`): at **390 px** the box is at least 300 px wide and ends inside the viewport; at **1280 px** the box is at least 600 px wide and leaves the 256 px
column's room on its row (width at most viewport minus 256). The box is found through the Coast slicer's "WC" button (it has no id of its own), as that button's
nearest ancestor carrying the box's grey.

**Measured, in a copy of the suite that records the widths** (not guesses; the first thresholds in the suite were guesses until this run):

| Build | 390 px | 1280 px |
|---|---|---|
| With the fix | 358 px (ends at 374) | 984 px (ends at 1000) |
| The fix reverted (the previous slice's file) | **94 px** (ends at 110) | 984 px |
| Mutant: `basis-full` with no `sm:` half | 358 px | **1248 px** |

So each real check has a build it fails: the **phone** check fails the original bug (94 is far under the 300 bar), and the **desktop** check fails the plausible
wrong fix of a bare `basis-full` (1248 is over the 1024 ceiling). The desktop check passes on both the fixed and the broken build, which is the point of it: it
guards the part of the layout the fix must not change, and cannot by itself show the bug. The phone bar is 300, not the 340 first written, because 340 left only 18
px of room under the measured 358 and a harmless padding change would have tripped it, while 300 is still 200 px above the broken value.

**Not covered.** Widths between the two (640 px is where the `sm:` breakpoint flips; neither boot is near it), dark mode (the class pair is mode-independent),
and any browser other than Chromium. The box's contents spilling out was seen in the before screenshot; the suite checks the box's width and right edge, not that
every chip is visible inside it.

## 2026-10-05: "Show in table" drill-down checks (slice 1.4, 2.5 testing build)

**What changed.** Analyze's expanded vessel list gets a "Show in table" button, **only in `Booking_flash_report_na_2.5_TESTING.html`**. It clears every slicer, applies
the one that narrows the active tab's table to that card's group, and closes the modal. Booking Flash and Sector Summary group by lane, so it sets the Lane
slicer. POL Booking Flash groups by `row.pol`, which is the same "Route Location 1st Yard" cell as `row.yard`, so it sets the Yard slicer, which that tab applies.
The "NO N.A. CALL" card is a real POL card but `availableYards` leaves it out (the slicer prune would drop it), so that one card uses the POL column's own header
filter. This replaces PR #160, which made the same change in the main file.

**The trap it found.** `clearSlicers()` empties the Yard search box, and the Yard effect reads an emptied box as the user clearing it and clears `selectedYards`,
so a user who had typed a prefix would have seen the new selection wiped. The handler tells the effect's ref (`lastActedYardSearchRef`) that this empty is its own
before it sets the Yard slicer. The agent that wrote the change removed that line and watched the selection get wiped; the lead's own mutation run (below) did the
same and the check failed.

**Pinned by 5 checks that run on the `testing-2.5` target only (414 to 419; `main` stays 325).** They sit inside the two Analyze suites, gated on the target like
every wave-3 check, and those suites have no tripwire of their own, so the runner's pin is what notices one going missing: `Analyze_BookingFlash` 21 to 24 and
`Analyze_POLBookingFlash` 15 to 17 on this target.

- *Lane tab, from a WC Coast selection:* a collapsed card has no "Show in table" button and the expanded list has exactly one; after the click the modal is closed,
  the Lane slicer holds exactly that lane, the Coast selection is cleared and the table narrows; and the click never reaches `document` (the list renders below
  the card grid, so it could not reach a card's toggle anyway; `stopPropagation` keeps that true if the list is ever moved inside one; the mutation run below confirms the
  check fails without it).
- *POL tab:* from a typed Yard prefix, the Yard slicer ends up holding exactly that POL, the search box is empty and the table narrows; the "NO N.A. CALL" card
  narrows the table through the POL filter.
- *Row counts, read by the lead from this PR's gate log* (every check logs its `detail`): Lane tab, card PS1 from a WC Coast selection, **238 rows to 18**; POL tab,
  card USHOU01 from a typed Yard prefix, **115 rows to 54**; the "NO N.A. CALL" card, **8 of 1,398 rows**. These match what the agent reported for #160, so they are now
  measured on this build, not carried over.

**Mutation run, by the lead.** Three deliberate breakages of the new code, applied together in a copy of the build and run through the real runner (419 executed, 416
passed): **exactly three checks failed, one per breakage, and each failure reports the symptom of its own breakage.** (1) The `lastActedYardSearchRef` reset removed:
the POL "typed Yard search" check failed with `yardChips: []`, the selection wiped, which is the trap above. (2) `stopPropagation` removed: the Lane "click stops at
the button" check failed with `clickReachedDocument: true`. (3) The "NO N.A. CALL" branch removed: its check failed with `polFilter: ""`. The breakages were applied
together to save a 9-minute run each, so one caveat: removing `stopPropagation` affects every click, which is why `clickReachedDocument: true` also shows in the other
two failures' details; it is not why they failed (the `yardChips` and `polFilter` values are). Not mutated: not closing the modal and not clearing the slicers, which
the same checks assert directly (`modalClosed`, and the Coast button no longer pressed).

**Not verified, and open for Kevin. (The three design questions below were decided on 2026-10-06; see the entry "Kevin's decisions on Show in table and the offline-copy baseline". Kept here as written.)**

- *Scope.* The button clears every slicer and sets only the lane or POL. The table that results is the whole lane (all sale weeks), while the list shows the
  Analyze window (default 4 weeks) and may have been computed under Coast or Sub Trade slicers that are now cleared. The alternatives are to keep the other
  slicers, or to also set the Sale Week slicer to the Analyze window so the table matches the list.
- *Closing the modal.* The Analyze window was deliberately made a non-modal reference window, so closing it on click is a change of habit; leaving it open is the
  alternative.
- *Focus.* After the modal closes, focus is lost, the same as the existing Close buttons; no focus restoration was added, for consistency.
- *Left alone, pre-existing:* in dark mode the modal's "Close Analysis" button is `bg-gray-800` on a `bg-gray-800` footer, so it shows as white text with no button
  shape (seen in the 1366-wide dark screenshots of the original PR).
- Production behaviour on a phone beyond the two widths screenshotted for #160 (390 and 1366, light and dark).

## 2026-10-05: wave-3 review fixes in the 2.5 build (F2 stamp follows the rows, F3 feed-check gate, X9, X10) and 12 more checks

A review of the wave-3 pull requests found two real defects in the 2.5 build and two smaller ones; each is fixed with its checks written alongside, and each
check was run in both directions (reverted fix: the check fails; fix restored: it passes). `Feed_Stamp` goes from 23 to 28 and `Offline_Cache` from 36 to 43. On
this branch alone that made the `testing-2.5` target 396 (325 + 28 + 43). Merged with the rest of the stack (slices 1.5, 1.3 and 1.4, and the poll-path follow-up that
takes `Offline_Cache` to 47) and with the two Show-in-table fixes below (+7 checks) it is **442**; `main` stays 325.

- **F2, a stale "fetched" time on old rows.** `fetchCsvText` published the new fetch time as soon as a feed reply arrived, before the rows were applied. With
  Auto-Refresh off a poll that only staged the new text ("New data available") already moved the masthead to the new time while the old rows stayed on screen;
  Refresh Now during a historical view did the same. The info now waits in `fetchedFeedInfoRef` and is committed when that text is applied, or at once when the
  fetched text is the one already on screen. New `Feed_Stamp` "STAGED boot" (4 records): Auto-Refresh off, a different export fetched during a historical view
  and staged, the stamp after Back to Live still names the FIRST fetch; applying the staged update moves it; a later fetch of the unchanged text moves it. The
  poll itself cannot be fired by the harness clock (see the `Offline_Cache` mutation notes below), so Refresh Now during a historical view is the stand-in: it
  stages exactly as the poll does. **Revert check:** with `fetchCsvText` calling `setDataFeedInfo` directly again, the "Staged text keeps the old stamp" check fails.
- **F3, a damaged feed overwrote the last good copy.** `applyCsvText` saved to the offline cache after every parse that worked, so a truncated export or one with a
  renamed column replaced the one copy that exists to survive a bad feed. The save is now gated on the feed check. **One check per load:** this fix first carried its own
  `BFShared.checkFeed` call (with a `keepRaw` option on the parser and an in-memory row-count baseline); when slice 1.5 (the "Data check" banner, two sections above) joined the
  stack that mechanism was removed in favour of slice 1.5's, which does the same job (`runFeedCheck`, the rolling baseline in localStorage, `feedProblems.length === 0`
  before `FeedCache.save`). The feed is still shown, as before. `Offline_Cache` "GATE boot" was kept as written: a healthy feed is saved; the same rows with a required column
  renamed and half the rows are each shown (observed through the stamp moving) and not saved; a sane feed after them is saved again. Setup detail changed in the merge:
  the renamed column is now "Measures Overall Booking Utilz" (a column the app reads) instead of "Measures Total Booking TEU by Service", which slice 1.5's required list
  does not include because the app does not read it (it is read only by `BFShared.diffSailings`, not yet used by the app). **Revert check:** with the gate removed, the
  renamed-column and truncated checks fail. The known limit (the load after a flagged one is compared with the flagged count) is in CODE_NOTES.md; it makes the cache one change older, never wrong.
- **X9, the cached copy lost the original fetch time.** The "Cached copy" stamp said when this browser saved the text, so a copy the server fetched at 6 AM and the
  browser saved at 2 PM read 2 PM. `fetchedAt` is now stored with the text and shown ("Cached copy · fetched ..."; "saved" only for entries written before the field
  existed). The banner no longer says it "switches to live data as soon as it loads", which was untrue (the retry is the next poll or Refresh Now); it says so with
  the interval computed from `POLL_INTERVAL_MS`. The existing banner checks changed text, and 3 records were added (the saved entry's `fetchedAt` equals the
  server's, and the fetched-at scenario's setup and stamp-and-banner check).
- **X10 (client half).** The stale threshold prefers `refreshIntervalMsAtFetch`, then `refreshIntervalMs`, then 60 minutes. One `Feed_Stamp` check runs four cases (at 61
  minutes: AtFetch 120 min with interval 30 min is ok, AtFetch 20 min with interval 120 min is stale, and an invalid AtFetch of 0 or -5 is ignored).
- **Merge note: a `Feed_Canary` setup detail.** Its "Setting on" check seeds a baseline of 111 rows and then loads 940; since the shared-logic review fixes made `checkFeed` flag a row-count
  jump as well as a drop, that load also raised ROW_COUNT_JUMP and the check (codes exactly MISSING_FIELD) failed. The baseline is moved to 900 just before that load; what is asserted is unchanged.
- **Show in table: Undo bar and one rule for Sector Summary (2.5 only, +7 checks).** Slice 1.4's button is a feature that exists only in the 2.5 build, so these two
  review findings are fixed there and not in the main file. (a) The button wipes every slicer, header filter and the Yard search box, which a user may have spent a while
  building. It now keeps a snapshot and shows a dismissible bar, "Showing Lane X in the table. [Undo] [x]", next to the restored-filters banner; Undo restores every
  slicer, the header filters, the Yard search text and the restored-filters flag exactly, and the bar goes on Undo, on its x, on a tab change, or the moment anything
  the button set is changed by hand. This answers "is anything lost" without changing what the button clears (the three open design questions for Kevin in the 1.4
  section are untouched). The Yard search box needed a one-shot (`yardRestoreRef`) so the box's own effect keeps the restored selection instead of re-deriving one from
  the text; it is taken and cleared at the very top of that effect (before any early return), and set only when the restored text differs from the current one, so it
  can never sit there stale. (b) On Sector Summary the button is shown only for a lane that has a row in that tab's own table (`sectorSummaryLanes`, a `useMemo` Set
  built from `past4WeekRows`: Past 4 Week Flag = Y, minus `SECTOR_SUMMARY_LANE_EXCLUDE`), so neither EXE/EXW nor a lane with no flagged row (INE in the fixture) offers
  a button that would close the window onto an empty table. Booking Flash and POL keep it for every card. Checks: `Analyze_BookingFlash` +3 (the bar names the lane and
  Undo restores a Coast selection, a VVD header filter and the exact row count; the stored filter preferences hold the restored state; the bar is gone after Undo, after
  its x and after a hand change), `Analyze_POLBookingFlash` +1 (Undo brings back the Yard search text and the exact chip-picked selection), and `Sector_Summary` +3 on
  this target (no button for EXE/EXW, none for INE, the button kept for EC1). The same checks and fixes were first written against the 2.0 file and are reference
  implementations only; none of them is in the main file. **Revert-checks (2.5 file), one combined run of six deliberate breakages (442 executed, 433 passed, exactly the nine expected red):** Undo no longer restoring the
  header filters (the Undo check and the persistence check fail); the bar no longer clearing on a hand change (the "bar is gone" check fails with `afterUndo` and `dismissed`
  fine and only the by-hand half red); `yardRestoreRef` never set (the POL Undo check fails); the old EXE/EXW-only Sector Summary rule (only the INE check fails; EXE/EXW
  stays hidden); and, from the earlier review fixes, F2 (the "Staged text keeps the old stamp" check fails) and X9 (the three fetched-at checks fail). Not mutation-tested:
  the Sector Summary "ordinary lane keeps the button" check (it fails by construction if the button never appears) and the exact-row-count half of the Undo check.
- **F1a/X13, ported and added.** Main's #162 (Settings status lines wrap) and #167 (Analyze weekly-bar hover cards in a portal) were applied to the 2.5 file as the same
  patch; their regression checks were not ported (this branch's suite does not have them and the 2.5 run stays green without them). The Settings popover also got
  `overflow-y: auto` and a `max-height` from `window.innerHeight` (the visible height, recomputed on resize; not `100vh`, which on a phone includes the area behind the URL bar; 160 px floor), so wrapped status lines scroll instead of running off a short phone.

## 2026-10-05: Settings popover status lines wrap (`Settings_Popover_Layout`, Suite 19)

**The bug:** long status text in the Settings popover ran past the popover's right edge instead of wrapping. The popover
container carries `whitespace-nowrap` so its button rows stay on one line, and the four status lines at its bottom (the
storage-probe line, Cloud sync, Data, Config Sheet; each a `<div class="w-full text-[11px] leading-snug ...">`) inherited it.
On a fresh browser the storage line is the first-run message (87 characters), which measured 123 px wider than its box and
ended at x=1030 against a popover right edge of x=921 (1280 px viewport). The origin-rotated storage warning embeds two full
origins and a Config Sheet warning embeds arbitrary Sheet text, so the message a given run shows is the lucky one.

**Pinned by** a new live suite, `Settings_Popover_Layout` (6 checks), in `tests/booking_flash_regression_tests.js`. It asserts
on the elements rather than on one message: the popover is found from its own "Close settings" button (nothing found means
`null`, never a document-wide fallback, the lesson of Suite 9's `popoverScope` race), the three always-rendered lines must all
be found (so it cannot pass by finding nothing; Data is measured too when present, and the count stays 6 either way), and
then (a) none has computed `white-space` `nowrap`/`pre`, (b) none has `scrollWidth > clientWidth + 1`, (c) neither its box nor its
text (a `Range` over its contents: a `w-full` div's own box never leaves the popover, only its text does) passes the popover's
right edge, and (d) a clone of each line, inserted next to it and removed in the same synchronous block so React's nodes are never
touched, holding a 339-character string that ends in a 120-character unbroken token, still fits and wraps onto 2+ lines.
No tripwire: unlike Suites 10/12/18 it has no multi-scenario setup that can drop checks halfway, and every early return
records a failing check.

**Red-run against the unfixed artifact** (`git show origin/main:dist/index.html`, run via a repo-relative `BF_APP_HTML`, the
recipe is in [TESTING.md](TESTING.md#current-counts-2026-10-08-390-checks)): 331 executed, 327 passed, and exactly the four layout
checks red: "not nowrap" and the 339-character probe on all four lines (`whiteSpace: "nowrap"`; the probe 1975 px past its box,
1 line, text ending at x=2882), "no overflow" and "within the popover's right edge" on the storage-probe line alone (123 px
past its box, text ending at x=1030); the two Setup checks and the other 325 checks green with the same per-suite counts as
before. The same four, with the same numbers, on the unfixed source file. Live total 325 -> **331**.

**Pass run against the fixed app** (2026-10-05, the full `node scripts/run_ci_locally.js` gate, on the source and on `dist/index.html`): 331 executed, 331 passed, `Settings_Popover_Layout` 6/6 with the Data line present (4 lines measured). An independent re-run of the unfixed `dist/index.html` reproduced the same overflow amounts (123 px, 1975 px) with absolute x values about 10 px different, so treat the x coordinates above as environment-dependent and the overflow amounts as the stable evidence. One known gap: the "Drive export failed" line is also a direct child of the popover and would be classified as the storage-probe line if it were ever rendered during this suite. It is a fixed 25-character string so it cannot overflow, and the suite never triggers it, but a future Drive-export-error scenario in the suite will need `roleOf` to learn about it.

## 2026-10-05: Settings popover height cap on short windows (review fix X13, +2 checks)

**The bug:** #162 made the Settings popover's status lines wrap, which made the popover taller (a long storage or Config Sheet
warning is several lines). It is `position: fixed` with no height limit, so on a short phone screen its bottom ran off the window
and the rows under it, including the lower controls, could not be reached.

**The fix (production file, a bug fix, so it is not 2.5-only):** the popover gets `maxHeight = max(160, window.innerHeight -
(top) - 8)` and `overflow-y: auto`. The number comes from the live `window.innerHeight` on every render, and a `resize` listener,
added and removed with the popover's open flag (so it does not outlive a close or an unmount), bumps a counter so a rotation or
the address bar sliding away re-reads it. The header row with Close is the first child, so Close is on screen whenever the box
is scrolled to the top.

**Pinned by** two new `Settings_Popover_Layout` checks, 6 to 8 (341 to 343 live): (1) with `window.innerHeight` faked to 220 px
below the popover's top and the popover reopened (it sizes itself on open), its bottom is inside the window, `max-height` is
not `none`, `overflow-y` is auto/scroll, its content is taller than its box, setting `scrollTop` really scrolls it, and the
Close button is inside the window and is the element `elementFromPoint` returns at its centre; (2) while open, shrinking the
faked height again and firing `resize` pulls the bottom (and Close) back inside and shrinks the cap, and restoring the real
height lifts the cap. The popover is read after microtasks only, not after a wait: the app's other resize handlers (the table's
max-height refit and others) run in a frame and re-render the whole component, which hid a missing resize listener (a first
version of the check that waited for the new fit passed with the listener stubbed out). React flushes a `setState` made inside
the discrete `resize` event in a microtask, so only the popover's own listener can have re-fitted it by then. The height is faked because the headless window is tall enough for the popover to fit unaided; the check
always records exactly two results, even if the popover fails to reopen.

**Not verified:** a real phone (the window height is faked in a desktop-size page); a popover dragged lower after opening is
capped from where it opened, not from where it was dragged to.

## 2026-10-05: Analyze trend-chart hover cards stay inside the modal (`checkWeeklyBarTooltips`, +10 checks)

**The bug:** each weekly bar's hover card was an absolutely-positioned child of the bar, centred on it. A bar is ~43 px wide and a
card 146-171 px, so with every week shown (17 weeks, W27-W43, on the pinned 8-12 fixture, 1920x1000) the cards for the bars near
either end stuck out past the modal. The modal panel is `overflow-y-auto`, so `overflow-x` is `auto` too: W27's card was clipped
31.9 px past the left edge, and the invisible (`opacity-0`) boxes past the right edge widened the scroll area, so the modal had a
permanent horizontal scrollbar at rest, no hover needed (`scrollWidth` 807 against `clientWidth` 768; 820 on the POL tab, where
W27, W42 and W43 were outside by up to 35.1 px left and 51.6 px right).

**The near miss:** `position: fixed` in place does not fix it. The modal panel carries an inline `transform: translate(x, y)` (it is
draggable), and any non-`none` transform, even the identity `matrix(1,0,0,1,0,0)` it computes to before a drag, makes it the
containing block for `fixed` descendants, so the card would still be positioned inside and clipped by the modal. Found by dumping the
ancestors' computed `transform`/`filter`/`contain` before writing the fix. The card is portaled to `document.body` instead
(`WeeklyBarColumn` / `WeeklyBarHoverTip`, with the reasoning in CODE_NOTES.md, "Analyze Weekly-Bar Tooltips: Why A Portal").

**Two defects in the first version, found only by an independent real-mouse pass, not by the in-page suite.** (1) It clamped the card
to the chart's own box, but the 17 columns cannot shrink below their content (~42.7 px each, 726 px) and overflow that box, so at 600,
390 and 768 px wide, and with some lane filters (ANG, MAR), a bar could sit outside the box and the card ended up 24-199 px from it.
(2) It measured the card's position once, on mount, so a wheel scroll while hovering (card 21-108 px off its bar), or switching All
to Reset or to a single week under a parked pointer (gap 24.5 px instead of 8), left it behind. Fixed by clamping to the nearest
scrolling ancestor's visible box and re-measuring after every render and on `scroll`/`resize`. The first version of the in-page checks
(4 per suite, bounded by the chart's own edges) passed 339/339 with defect (1) present, because the CI window (1280x720) never puts a
bar outside the chart's box. Lesson: a green in-page run does not prove placement across window sizes. The checks now bound the card
by the modal's visible box and add "the card is over its bar whenever that bar is visible", and the by-hand pass below stays the
source of truth for other window sizes.

**Pinned by** `checkWeeklyBarTooltips`, one helper called from both Analyze suites (5 checks each, Analyze_BookingFlash 21 -> 26,
Analyze_POLBookingFlash 15 -> 20, live total 331 -> **341**): a Setup check; no horizontal overflow at rest and no card in the page
until a bar is hovered; every bar's card named for its week, inside the modal's visible box and the window, and over its bar; exactly
one card per hover and none after the pointer leaves; and the card following its bar when the modal scrolls 24 px under a stationary
hover. Hovering is a dispatched `mouseover`/`mouseout` with no `relatedTarget`, the way React derives `onMouseEnter`/`onMouseLeave`.

**Red-run against the old design:** the old tooltip markup (`git show 0fe6ce7:...`) with only `data-week-bar` and
`data-week-bar-tooltip` added so the checks can find their elements, run through a repo-relative `BF_APP_HTML` (recipe in
[TESTING.md](TESTING.md#current-counts-2026-10-08-390-checks)): 341 executed, 333 passed, and exactly the four hover-card checks red on
each tab. The rest-state check reports `scrollWidth` 807 vs 768 with 17 cards sitting in the page (820 vs 768 on POL), the hover
checks report 17 cards where there must be 1, and the scroll-follow check reports no card. The two Setup checks and the other 331
checks green, with the same per-suite counts.

**Pass run against the fixed app** (2026-10-05, the full `node scripts/run_ci_locally.js` gate, 16 of 16 blocking jobs, `LOCAL CI PASSED`):
the live suite executed 341 (expect 341) and passed 341 on the source and again on `dist/index.html`, with Analyze_BookingFlash 26,
Analyze_POLBookingFlash 20 and every other suite at its previous count. The rest-state check read `scrollWidth` 768 = `clientWidth` 768
with no card in the page on both tabs (it was 807 and 820 against 768), and the scroll-follow check read a card/bar gap of 8.5 px before
and after a 24 px scroll. The row-highlight budget passed on the source and on `dist/index.html`. The Alias-landmine job needs
`openpyxl`, which system Python here lacks: install it outside the repo (`pip install --target <scratch dir> openpyxl`, then
`PYTHONPATH=<scratch dir>`), and read the gate's log rather than its exit status, since a failed pre-check ahead of it in a shell chain
can leave a trailing command's exit code of 0 with no gate output at all.

**Verified by hand with a real mouse (Playwright + Chromium, fixed source file, 868 week cards across 28 lanes x 2 tabs):**
geometry at 1920x1000, 1366x768, 1024x768, 768x900, 600x800 and 390x844 on both tabs (after the fix: every card inside the window and
over its own bar at all six); 84 hover checks (42 per tab, 12 more skipped because the bar's centre was off-screen or covered) with the modal dragged to the far left/right and partly off the top/bottom of the window
and resized (one card each, inside the window, none displaced by the modal's transform); a short window (1280x500 fits above or
below; at 1280x320 and 1280x260 there is no room and the card sits on the bar, inside the window); close-while-hovering through the
header X and the footer button (no card left in the DOM or on screen); 20 sweeps over 17 bars plus edge jitter (never more than one
card, none after); dark mode; touch tap; the default 4-week, 2-week and 1-week windows; device scale factor 1.5 and 2; the app's own
Zoom and Text Size (the modal sits outside that wrapper). Content parity with the old cards: identical text and HTML for every
week on the unfiltered chart (42 cards, both tabs), and for 862 of the 868 per-lane cards, including 558 "★ Departed" and 148 "N/A"
cards; the other 6 had no card to compare because the last column's centre is clipped outside the modal on that lane, 3 re-hovered
on the visible sliver were identical, and 3 (MAR on both tabs, FLX on POL) remain unconfirmed.

**Still open (found by the same pass, not caused by the card):** the 17 bar columns cannot shrink below their content (~42.7 px each),
so at 768 px wide and below, and with some lane filters (22 of 56 lane x tab combinations at 1920x1000; e.g. ANG 786 vs 768), the
modal still has a horizontal scrollbar; at 390 px the legend row also overflows. The old build had the same. The "no horizontal
overflow at rest" check asserts the unfiltered 17-week chart at the CI window; it does not claim this is solved.

**Not verified:** Firefox and Safari; anything on a deployed `/exec` URL; mouse-then-touch on one device (in an emulated mixed
session the card was dismissed ~230 ms after a tap by Chrome's synthesised mouse move, probably an emulation artifact);
CSS `zoom` forced on `<html>` (nothing in the app does it, the card misplaces); keyboard access (the old card was hover-only too).
Behaviour changes: the card no longer fades in, and Escape still does not close the Analyze modal (it never did).

## 2026-10-06: code review of the 2.5 stack (#168 to #173), what it found and what was done

A review of the five wave-3 slices (1.1 stamp, 1.2 cache, 1.5 feed check, 1.3 phone layout, 1.4 "Show in table") returned ten findings. It had run nothing, so the lead checked
each against the code, and two by experiment, before acting. **Nine were real, one was a false alarm.** Slice 1.3 had no findings.

| # | Slice | Finding | Verdict | Outcome |
|---|---|---|---|---|
| 1 | 1.2 | A poll replaced the cached copy under an open historical or Compare view | confirmed (code) | **fixed**, `poll-during-snapshot` |
| 2 | 1.2 | A failed Refresh Now was invisible under the cached banner | confirmed (code) | **fixed**, `refresh-fails` |
| 3 | 1.2 | The cached copy is only requested by the initial-load effect, so a poll tick or Refresh Now during the first fetch leaves the screen empty | confirmed (code), needs that coincidence | documented, then **fixed** 2026-10-06 (`showCachedFeed` on every failed load, Offline_Cache +6; see "follow-up round" below) |
| 4 | 1.5 | The row-count baseline advances after a flagged load, so a truncated feed warns once and a reload can then cache the truncated text | confirmed (code) | **decided 2026-10-06** (separate saved-copy baseline, see the entry below); the follow-up round adds the real row count to the banner's baseline |
| 5 | 1.5 | A dismissal was never cleared by a clean load | confirmed (code) | **fixed**, `Recovery re-arms the banner` |
| 6 | 1.1 | The stamp is set when a fetch succeeds, before the text is applied | confirmed (code) | documented; a decision, not a fix (CODE_NOTES) |
| 7 | 1.1 | A direct poll re-renders the whole dashboard (`feedInfoSame` compares `downloadedAt`) | confirmed (code); **measured 2026-10-06: no extra render** (2 dashboard renders per unchanged poll with or without the stamp, and 2 in production) | no change; CODE_NOTES records the numbers |
| 8 | 1.2 | The "setting off" check could not detect the read gate going missing | confirmed **by experiment** (both guards removed: 82 of 82 still green) | **fixed**, `off-and-put-back` |
| 9 | 1.5 | The Dismiss check could pass vacuously | confirmed **by experiment** (the old check passed against a build that silences the check after a dismissal) | **fixed**, put count asserted |
| 10 | 1.4 | "Show in table" on a "(blank)" card would apply a filter that gets pruned away | **false alarm**: blank groups are filtered out of the rendered Analyze cards (`groupSummaries`), so no such button exists | none. The reviewer's side point (a hidden POL column under the "NO N.A. CALL" header filter) was tested 2026-10-06: the column cannot be hidden, but the filter followed the reader to other tabs; **fixed** (follow-up round below) |

Each fix is described, with its mutation proof, in its own slice's entry (1.2: the Offline_Cache follow-up; 1.5: the Feed_Canary follow-up). Folded in with it: PR #174 (the poll-path checks
for 1.2). **Counts after the round:** `Offline_Cache` 48, `Feed_Canary` 24; the `testing-2.5` pin is 432 (325 + 23 + 48 + 24 + 5 + 5 + 2); `main` stays 325.

What a review that runs nothing can and cannot do is the lesson of the false alarm and of the two findings that needed an experiment: a finding that says a check "can pass vacuously" is a claim
about a mutant, and it is settled by running that mutant, not by reading the check.

**Merged with the 2026-10-05 review fixes above (PR #178), 2026-10-06.** Finding 6 here (the stamp set when a fetch succeeds) is the same defect as F2 above, and F2 fixes it on #178: the fetch time is held in `fetchedFeedInfoRef` and committed when that text is applied, or at once when the fetched text is already on screen, so a staged export or a sign-in page no longer moves the stamp while the stamp still advances on every successful fetch of the data on screen. CODE_NOTES gap (1) is updated to match. The two rounds' checks do not overlap: `Offline_Cache` 40 + 7 (F3, X9) + 8 (this round) = 55, `Feed_Canary` 24, `Feed_Stamp` 28; the `testing-2.5` pin is **451** (325 + 28 + 55 + 24 + 5 + 12 + 2); `main` stays 325.

## 2026-10-06: Historical Data popover stays inside the window (`Historical_Popover_Placement`, Suite 20)

**The bug:** the popover is `absolute right-0` under its 🗓️ Historical Data button, so its right edge sits on the button's right edge.
In a narrow window the masthead's flex-wrap row wraps that button to the left side and the popover's left edge goes negative. Measured on
the pinned fixtures (popover left edge): 600 px wide -238.6, 500 px -132.5, 390 px -176.6 (358 px wide box), 320 px -106.6 (288 px wide
box). A real-browser sweep found the exact threshold: the old build is broken at every width up to 698 px and correct from 699 px up
(262.7 at 699 and above). Off-screen were the title, the View-a-Date / Compare Two Dates toggle and most date buttons; only the "×" stayed
visible.

**The fix:** `placeHistoricalPopover` clamps the popover's left edge into [16 px, window - width - 16 px] from the wrapper's live rect,
only when the default would differ (so wide windows are byte-identical to before: same left and right to 0.01 px at every width from 699
up). It re-measures after every render while the popover is open and on `resize` and `scroll`, not once at open, because picking a date
lengthens the button's label and can re-wrap it. Why not `position: fixed` like the Settings popover: a fixed popover stops scrolling with
the page and can run off the bottom of a short window; clamping only the horizontal offset keeps the vertical behaviour as it was (reasoning
in CODE_NOTES.md, "Historical Data Popover: Clamped Into The Window").

**One defect found by the independent pass and fixed before shipping:** the first version re-measured on render and `resize` only. At app
Zoom 200% the page scrolls sideways, and a clamp made while scrolled stayed where it was after scrolling back: reproduced by widening the
body to 2500 px, scrolling to 600, opening the popover and scrolling back, where the popover sat at [844, 1264] while scrolled and at
[1444, 1864] after scrolling back in a 1280 px window (partly off-screen). With the `scroll` listener it stays at [844, 1264] in both.

**Pinned by** a new live suite, `Historical_Popover_Placement` (4 checks, live total 341 -> **345**). The suite runs in one window size, so
it recreates the geometry: it shifts the button's `position: relative` wrapper left (button and popover move together, layout untouched)
and fires `resize` (and, for the way back, `scroll`). Checks: Setup (the popover opens); in the real window it is on-screen and right-aligned
under its button; with the button pushed to the left edge it is clamped (left edge >= 16 px, close button and View-a-Date toggle on-screen),
after asserting the shift really put the default position off the edge, so it cannot pass without exercising the clamp; and with the button
back it returns to the right-aligned position (the clamp is not sticky, and the scroll listener is covered).

**Red-run against the old build** (`git show origin/main:...`, run through a repo-relative `BF_APP_HTML`, recipe in
[TESTING.md](TESTING.md#current-counts-2026-10-08-390-checks)): 345 executed, 344 passed, and exactly the clamp check red
(`popLeft` -120.3, `popRight` 299.7, button right 299.7); the Setup check, the real-window check and the "button back" check green on both builds.

**Pass run against the fixed app** (2026-10-06, the full `node scripts/run_ci_locally.js` gate on the final code, 16 of 16 blocking jobs,
`LOCAL CI PASSED`): the live suite executed 345 (expect 345) and passed 345 on the source and again on `dist/index.html`, with
`Historical_Popover_Placement` 4 and every other suite at its previous count (Analyze_BookingFlash 26, Analyze_POLBookingFlash 20,
Settings_Popover_Layout 6). The row-highlight budget passed on both. As before, the Alias-landmine job needs `openpyxl` outside the repo
(`pip install --target <scratch dir> openpyxl`, then `PYTHONPATH=<scratch dir>`), and the gate's log, not its exit status, is what to read.

**Verified by hand with a real browser** (Playwright + Chromium, fixed source file, old build on a second port for comparison): 15 window
widths from 1920 to 320 in View and Compare mode and every integer width from 760 down to 300 via resize, always inside the window with a
16 px margin; short windows (heights 500 and 400, widths 1280 and 390: top, bottom and height identical to the old build); resizing while
open through ten widths; picking a date and Back to Live at 390, 500 and 600 (the longer label re-wraps the button and the popover stays
inside); dragging at 1280 and 390 (follows the mouse, resets on reopen); ten open/close/reopen cycles through the X, Escape and the toggle;
keyboard Tab order; tab switching with the popover open (60 measurements); touch tap on mobile emulation; dark mode; app Zoom 200% and
Text Size 24 (they do not reach the masthead). No defect was introduced by the fix beyond the scroll case above.

**Cost:** re-measuring on every render adds about 4 ms to each dashboard re-render while the popover is open (hover-driven re-render,
median of 5 runs of 120 events: 39.2 and 41.3 ms against 34.7 and 36.9 ms on the old build in two rounds); no consistent difference with the
popover closed.

**Still open, not caused by this change:** the width `min(420px, 100vw - 2rem)` uses `100vw`, which includes a classic scrollbar, so at
390 px with a 15 px scrollbar the popover's right edge is 1 px from it (fully visible); the drag has no clamp; at 320 px the page is 323 px
wide in old and new alike (the Sales Week slicer panel's `min-w-[300px]`); with the popover open, at 390 px it covers the Settings button in
both builds (close Historical first). **Not verified:** Firefox and Safari; real Windows classic scrollbars or a physical device; anything on a
deployed `/exec` URL.

## 2026-10-06: landing the 2.5 stack on `main`: main's #180 and #181 ported verbatim, X13 replaced

**What.** `origin/main` (6939c22, which already had the production line #155/#157/#161/#163/#164/#156) was merged into the stack head
(`origin/claude/review-fixes-wave3`, ca2b740). Six files conflicted (docs/TESTING.md, docs/CHECK_HISTORY.md, tests/booking_flash_regression_tests.js,
tests/ci_regression_runner.js and the two generated `dist/` files); AGENTS.md merged on its own. Rules used: docs keep both sides (history in date order),
tests keep main's suites first and the stack's wave-3 suites after them (renumbered 21 to 24: main already had 19 and 20), generated files regenerated
with `node scripts/sync_shared.js` and `node scripts/build_deployable.js`, never hand-merged.

**Ports into the 2.5 file.** The rule in AGENTS.md is that the testing build is production plus the features. At the head, three of main's four fixes were
in 2.5 as the same text (#162 status-line wrap, #167 hover cards) or a different implementation (#181), and one was missing (#180, the Historical Data
popover clamp). Both were applied as production wrote them (`git show 79fe98a` and `git show 71dc70a`, file name rewritten to the 2.5 file, applied with
`git apply`). #181 meant taking the 2.5-only height cap out first (a `viewportH` state with its own resize listener, `overflow-y-auto` in the popover's
`className`, and a `maxHeight` of `viewportH - round(rect.bottom) - 12`), then applying production's version (a resize tick, `maxHeight` from
`window.innerHeight - (rect.bottom + 4) - margin` and `overflowY: 'auto'` in the style). Before the swap the Settings_Popover_Layout cap checks passed on 2.5
with the old code; they pass with production's (see the counts below). The drift fixture was refreshed with `--update` only after checking that every
change to the 2.0 file since the fixture is in 2.5.

**Pins.** `main` stays 347. `testing-2.5` is 473 (it was 451 while main's pin was 325; main's three new suites account for the 22): read from a real run,
with the per-suite counts printed by the runner. The first 2.5 run on the merged tree before the #180 port executed 473 and failed exactly one check
(Historical_Popover_Placement, "clamped into the window": popLeft -120.2), which is the #180 gap above and nothing else.

**Stale statements found while doing it** (fixed in docs/TESTING.md, HANDOFF.md and scripts/run_ci_locally.js unless noted): the full gate takes about 25 minutes,
not "~5 min" or "~10-15 min" (24 m 39 s on 2026-10-06: source suite 394 s, `dist/` 136 s, the 2.5 build 815 s); `--fast` is about a minute, not 10 s;
`Feed_Stamp` is 28 checks, not 23; the per-target table still said 325/451 and "18 suites"; HANDOFF.md still gave the old 442. Not edited (other people's text):
AGENTS.md "Until PR #165 lands on `main`, build features on top of that stack" in the feature/fix rule, and docs/ROADMAP_PLAN.md's pins in its wave-3 table.

## 2026-10-06: Kevin's decisions on Show in table and the offline-copy baseline (2.5 testing build, +16 checks)

Kevin decided four open design questions on 2026-10-06. All four are built in `Booking_flash_report_na_2.5_TESTING.html` only (they are 2.5-only features); the
`testing-2.5` pin goes 474 to **490** on `main` after the 2.5 stack landed (#184) and `main` stays 348. The work and the revert-checks below ran on the pre-landing stack, where the same +16 took it from 451 to 467; it was then applied to `main` and the counts re-run there.

**Q1, "Show in table" matches the Analyze card.** It no longer clears the other slicers and header filters. It sets the group slicer as before (Lane; Yard on POL with the
search box emptied; the POL header filter for "NO N.A. CALL") and sets the **Sale Week slicer to the Analyze window's weeks** (`serviceLaneAnalysis.activeWeeks`; left alone in
All-weeks mode). Findings that bear on the spec: (1) `filteredRawRows` applies `selectedSaleWeeks` on every tab, so it carries over everywhere; Sector Summary's table
(`past4WeekRows`) is further limited to Past-4-Week-Flag = Y rows, so its default window (the flagged weeks) matches the table and a manual non-flagged week shows fewer rows than the
card there. (2) **A consequence the spec did not mention:** the cards are built from `filteredRawRows`, so with the window left open (Q2) and the table narrowed to one lane and its weeks,
the other lanes' cards, the Overall Snapshot and the window's week chips would all collapse to that lane, and the Sector Summary button would vanish for every other lane, which defeats
"click card after card". While the Undo bar is up the cards therefore keep reading the state the window was opened under (`analysisSourceRows`, from the bar's `before` snapshot through
`rowsUnderSlicerState`, a copy of the header-filter loop of `filteredRawRows`); a hand change removes the bar and the window is back on the live filters. (3) Pressing a second card
builds the new state from the same snapshot, so one Undo returns to before the first press. (4) The lane tabs leave the Yard search text alone: Booking Flash ignores the Yard slicer, and on
Sector Summary the card was already built under it. (5) The restored-filters flag is no longer cleared by the button (it never clears slicers now); Undo still restores it.

**Q2, the window stays open on desktop and closes on a phone.** There was no script-side phone breakpoint; the only one is Tailwind `sm` (640 px), the line slice 1.3's slicer box wraps
at, so `isPhoneWidth()` is `window.innerWidth < 640` rather than the `md` 768 px the spec named as the fallback. **Q3, focus:** on a phone the button sets a one-shot ref and an effect
on `showInTableUndo` focuses the Undo button once the bar has rendered; the button has `aria-describedby` on the bar's text. On desktop focus stays on the pressed button, and an
always-mounted `sr-only` live region (`data-show-in-table-announce`) announces the bar, because a freshly inserted `role="status"` element is not reliably announced (the live region
stays empty on a phone, where the focus move is read instead).

**Q4, the offline copy has its own baseline.** `bookingFlashLastHealthyFeedRows` ({rows, at}) is written only when a load is saved as last-good, and the cache decision runs the check
against it (`feedCacheVerdict`; the banner keeps the rolling baseline and warns once). A stuck-truncated feed after a page reload and the recovery after a truncation, the two defects of
the slice 1.5 follow-up's open question, are both fixed. The way out for a real permanent change: when the only objection is ROW_COUNT_DROP/JUMP, the 3rd consecutive applied load within
10% of the first of the run (`bookingFlashFeedRowStreak`, {rows, count}) is saved and becomes the baseline. Feed check off: saved as before, neither key touched; offline copy off: both keys
removed with the copy. **Deviation from the spec, stated:** with no saved count yet the rolling count stands in (the spec said no comparison), which keeps the copy judged exactly as
before for a user upgrading with a rolling baseline and no healthy count, and keeps the existing "seeded baseline, truncated first load is not cached" checks meaningful; the only gap is a
feed that was already truncated before any save under the new scheme.

**Checks.** `Analyze_BookingFlash` +4 (5 button checks and 5 Undo-bar checks now; "apply" and the Undo checks changed to the new intent, never deleted: the Coast slicer is still set after the
press, 238 to 5 rows for PS1; new: the table's sailings equal the card's "Sailings: N in W wks", read from the page's own table and not the window's vessel list; the window stays open, announces
and keeps focus; cards unchanged under a Coast slicer plus a VVD header filter; card after card with one Undo), `Analyze_POLBookingFlash` (3, changed: Sale Week, window open; the NO N.A. CALL one also presses Undo and expects the POL header filter gone, the only place Undo's header-filter half is exercised now that the Lane tab no longer clears one),
`Sector_Summary` +1 (pressing it; the other lanes keep their button), new suite `Show_In_Table_Phone` (6: 390 px closes the window and focuses Undo, 700 px does not),
`Offline_Cache` 55 to 60 (banner unchanged and warns once, recovery after a truncation with the old "healthy feed still saves" check rewritten to it, a reload of a stuck truncated feed, the way
out, and the setting-off check now also asserts the two keys are removed), `Feed_Canary` (two changed: the 480-row load after 482 is no longer saved, and the OFF boot leaves a seeded saved-copy
baseline alone). The boot helper resets the two new keys like the rolling baseline. **One test bug caught on the way:** the first run failed the "NO N.A. CALL" check because it found Sale Week chips
by colour, and a selected week the filters leave no row for is drawn grey (`SlicerBtn` `isValid`); chips are now found by their text.

**Revert-checks (2.5 file; breakages batched into four 467-check runs so each run's failures are attributable by their detail).** Run A: the Sale Week line removed, cards following the table
(`analysisSourceRows` = `filteredRawRows`), the way-out disabled (accept at 99), the baselines not cleared when the copy is turned off, the focus effect removed: **12 red, exactly the
expected** (apply, Undo, POL yard, POL NO N.A. CALL, Sector press, phone closes: Sale Week; cards, stays, chain, Sector press: cards; way-out; setting-off; phone focus). That run showed the
"table equals the card" check passing with the Sale Week line removed: it was reading the Analyze window's own vessel list (the first visible table), which is built from the card's sailings; it
now reads the page's table through header text from the end of each row, and in Run B fails with the line removed (17 sailings against the card's 4). Run B: Sale Week removed again, the
phone test always false, the copy judged against the rolling count again, the live region silenced, the new state built from live state instead of the snapshot: **16 red, all attributable**
(Sale Week set: 7; phone close and focus: 2; rolling count: recovery, reload, way-out, Feed_Canary rolling and cache guard: 5; live region: stays and the 700 px check; snapshot: chain). Run C:
the banner comparing with the saved count, the OFF path writing the healthy count, the window always closing: 12 red (the closing breakage fails its eight checks; the OFF path fails only the
Feed_Canary off check; the banner breakage failed recovery, reload and the Feed_Canary rolling-baseline check but **not** the first "banner unchanged" check, which compared both baselines at 960 where they cannot differ).
That check now loads a second similar truncated load (475) and asserts it is silent while still a drop against the saved count. Run D, the banner against the saved count alone: **5 red** (the strengthened banner check, recovery, the reload check, and two Feed_Canary checks that see the extra ROW_COUNT_JUMP).
Run E (Undo keeps the live Sale Week slicer and header filters instead of restoring them): **7 red, as expected** (Lane Undo, persistence, card-after-card, POL NO N.A. CALL Undo, POL Yard Undo, Sector press, phone Undo). Its first attempt cascaded into 25 unrelated failures because a failed Sector Summary check left a Lane and Sale Week slicer in the persisted filter preferences, which every later isolated instance restored; that guard now clears the filters in its `finally`. Final runs: 2.5 467/467, main 325/325.
Not mutation-tested: the exact-row-count half of the Undo check, the Sector Summary hide rules (unchanged).

## 2026-10-06: follow-up round: the `shared/` review, the 2.5 gaps, the "NO N.A. CALL" filter, focus return

One PR after the 2.5 stack landed (#184) and after Kevin's own decisions on Show in table and the offline-copy baseline (#185, the entry
above), carrying the rest of the answers to the open questions (the stamp moves when data is applied, as #178 did; focus restored after a
close; the factor of 2 kept; no compiled 2.5; production fixes ported into 2.5) and the fixes below. Each code change was re-run against the old code first and lands with
a check that fails with the fix undone.

**`shared/` (a `/code-review` of the three modules, nine findings, all real).** `diffSailings`: a total over values blank on every sailing
is `null`, not 0 ("a blank is never a zero"); `bookingConflict` uses the change test's noise floor (0.1 + 0.2 against 0.3 is no conflict);
`movedTeu: 0` no longer counts a zero laden delta as a move; conflicts are collected on the day that exists when the other is missing.
`checkFeed`: an explicitly empty `keyColumns` or `voyageFields` is `BAD_INPUT` and the default list is used (it used to switch the check off
while `ok` stayed true; no caller passed `[]`); a new optional `prevRealRowCount` gives `REAL_ROW_COUNT_DROP` / `REAL_ROW_COUNT_JUMP`, so
placeholder rows can no longer hold up the total of a feed whose real rows collapsed (skipped when there are no real rows at all, where
`NO_ROWS` / `NO_REAL_ROWS` already say it, and not repeated when the raw count already reported the same direction); the key scan builds its parts lazily (heap growth per 10,000-row check down 81-84%, about 1.9 MB,
wall time unchanged, output identical on 300 random feeds). View codec: the decoder drops header-filter keys that are not real columns (the
68 keys of the app's `renderFilter`/`filterCell` calls, identical in 2.0 and 2.5; `tests/check_shared_sync.js` section H fails if they drift
apart), and whitespace-only filters are dropped by both encoder and decoder. `check_shared_logic` 490 -> 511 assertions; an independent
reviewer reverted 12 of the fixes one at a time and every one was caught.

**2.5 gap 3, the cached copy on any failed first load.** `showCachedFeed` was only called by the initial-load effect and gave up when a newer
fetch ticket existed, so a poll tick or a Retry during the first fetch left an offline start empty although a copy was stored. It is now a
component-level function, called by every load that fails with nothing on screen, at most once per page load. `Offline_Cache` 55 -> 61 (a
poll claims the ticket; Retry during the cache read): all four fallback checks fail with the fix undone, and the two exactly-once checks fail
with only the once-flag removed. **Still open, documented, no check:** if a poll fails fast during the first fetch and the first fetch then
succeeds, that good reply is dropped and the cached banner stays until the next poll (CODE_NOTES, the same paragraph).

**2.5 gap 7, the stamp's re-render: measured, no change.** An unchanged poll renders the dashboard twice with or without the stamp (the
Refresh Now label on and off), and twice in production; the stamp's update lands in the same React 18 batch.

**The "NO N.A. CALL" POL filter (the 2.5 review's side point).** The POL column cannot be hidden (no Fields toggle owns it; pinned). But that
card narrows the table through the POL header filter, `headerFilters` is one map applied on every tab, and only the POL tab has a box for it:
after the button, Booking Flash showed 6 of 467 rows with no box, no Undo bar and nothing naming the filter. Fixed in 2.5 (the button's own
feature): leaving the tab puts the POL filter back to its value before the button, when the button changed it and it still holds the button's value; a value the reader edited by hand is left alone.
`Analyze_POLBookingFlash` +3 on the 2.5 target (the leak, red before the fix; the column cannot be hidden; a hand-edited filter is kept).
**Not fixed, a separate issue:** typing a POL value by hand in the POL tab's box has the same reach (USNYC took Booking Flash from 467 rows to
122) in production and 2.5; it predates "Show in table" and is a product decision, not part of this round.

**Focus returns to the opener when a dialog closes (production and 2.5).** Closing Settings, Historical Data, the Analysis modal, its vessel
list, the port-column menu, VVD notes, the report card or the schedule-change detail removed the focused control and left focus on `<body>`.
One hook, `useRestoreFocusOnClose`, fixes all of them (CODE_NOTES, "Focus returns to the opener when a dialog closes"). New suite
`Focus_Return` (7 checks + tripwire, both targets). On a phone, 2.5's "Show in table" (#185) closes the window and its own effect then
focuses Undo; that effect runs after this hook in the same commit, so Undo wins (`Show_In_Table_Phone` passes with the hook in).
**Built, then dropped when #185 landed:** a 2.5 redirect that sent focus to the narrowed table after "Show in table" closed the window, with
its own check. Kevin's #185 keeps the window open on desktop, so the redirect had nothing to do and was removed. Its check is still worth
recording for what it found: the target finder picked the biggest table, which was the POL tab's, kept mounted while hidden and made `inert`;
`focus()` on an inert element silently does nothing, so focus fell to `<body>`. Lesson: `focus()` never throws, so check
`document.activeElement` after it.

**Merging over #185 (2026-10-06).** Two of this round's changes had to change to fit Kevin's decisions, both found by reading the merged
code, not by a failing check. (1) The POL filter: #185 keeps the reader's other header filters, so a lane or yard card carries the reader's
own POL filter in `expected` too; dropping `pol` on a tab change would have deleted it. It now acts only when the button changed `pol`, and
puts back the earlier value instead of deleting (the button's own case stays pinned by the existing checks; no check pins the lane-card case). (2) The offline copy's way out (3 steady loads when the only objection is the row count)
recognised only `ROW_COUNT_DROP`/`JUMP`; a real resize also raises the new `REAL_ROW_COUNT_*` codes, which would have read as "another
problem" and frozen the copy. They now count as row-count objections. (3) The two "NO N.A. CALL" checks still assumed the window
closes and the button clears every slicer: on the merged tree both failed identically twice and the next check crashed (it re-opened a window
that was still open). They now expect the window open on desktop and close it themselves, and the "other tab" check reads the POL filter
box back on the POL tab before any Clear Filters, instead of comparing row counts (the Sale Week slicer the button now sets rightly narrows
every tab). Red run with the app's POL fix disabled (2.5 target, 516 executed): the updated "other tab" check fails, so it is not vacuous. (4) The same red run also failed two of #185's own `Offline_Cache` checks, which expect a truncated feed's
banner to say exactly `ROW_COUNT_DROP` (and a recovery exactly `ROW_COUNT_JUMP`): the real-row check added its twin, because halving a feed
halves its real rows too. Kevin's checks were right; the second line said the same fact twice. A real-row problem is now not added when the
raw count already reported the same direction (opposite directions are still both reported); `check_shared_logic` +1, red with it undone.

**Counts.** `main` 348 -> 356 (`Focus_Return` 8). `testing-2.5` 490 -> 516 (+8 the same, `Offline_Cache` +6, `Feed_Canary` +9 for the
real-row baseline, "Show in table" +3), taken from real runs. Before #185 landed, the same round measured 502 on its own branch (474 base,
with the since-dropped focus redirect check, 2), and passed the full local gate there (25 of 25 jobs).

**The offline copy's verdict compares real rows with the saved copy too (2026-10-06, on top of the merge over #185).** `feedCacheVerdict` judged the copy
against the saved raw count but left the real-row comparison to `runFeedCheck`'s default, the rolling baseline's `realRows`. Reading the code showed that
default was a no-op there: `applyCsvText` overwrites the rolling entry (`writeLastFeedRows`) BEFORE the verdict runs, so the re-run compared the load's real rows
with its own. So (a) the recovery after a truncation that also dropped real rows WAS saved at once (no regression of #185's decision, and the existing
recovery check passes with or without this change), but (b) a load whose raw count held while real rows collapsed behind placeholder rows was flagged by the
banner and still SAVED over the good copy whenever a saved entry existed (the same load with no saved entry was not saved, which is all the old check pinned).
The healthy entry is now `{rows, realRows, at}` and the verdict passes both of its numbers to `runFeedCheck` explicitly (an old entry without `realRows`
makes no real-row comparison). Checks (`Offline_Cache` 66 -> 70): a recovery after a truncation that dropped real rows is saved with the healthy entry
carrying that load's realRows; real rows collapsing alone against the saved copy is not saved; an old healthy entry makes no real-row comparison (setup +
check). Revert-checks (2.5 target, full suite each): (1) the verdict compares with the rolling real count as it was before this load (the regression the change was meant to prevent): the old "Recovery after a truncation" check and the new recovery, real-collapse and old-entry checks fail (4 of 520); (2) the old-entry case falls back to that rolling count: only the old-entry check fails; (3) the verdict makes no real-row comparison (what the code effectively did): only the real-collapse check fails. Each restored and confirmed with `git diff`/`cmp`; the fixed file passes 520 of 520.

@@GATE_RESULT@@

## 2026-10-06: three narrow-window fits (Analyze chart, highlight pill, Fields picker / slicers / Sector Summary; Suite 25 `Narrow_Window_Fit`, +13 checks on both targets)

Found by the deployed-app check and the Historical popover's verifiers, listed as still open there, and fixed together.
Three independent bugs with one shape: a box whose minimum width was set by its content or by a hardcoded `min-w-[Npx]` was
wider than a phone, so it stuck out of its container instead of wrapping or scrolling. Bug fixes, so per the features/fixes
rule they are in the production file and ported into the 2.5 testing build in the same change.

**The bugs** (measured on `main` 02395b6, headless Chromium, the 8-12 fixture):
- **Analyze trend chart.** The 17 `WeeklyBarColumn`s could not shrink below their widest unbreakable line (~42.7 px, 726 px
  in all) and the title and legend rows never wrapped, so the modal scrolled sideways: `scrollWidth` 755 vs 736 at a 768 px
  window, 755 vs 288 at 320; with a lane filter 22 of 56 lane x tab combinations scrolled even at 1920x1000 (MAR 801 vs 768).
  With classic 15 px scrollbars (which headless Chromium hides) even the unfiltered chart scrolled at every width.
- **Highlight pill.** `fixed right-4` and all `whitespace-nowrap`, so it could not shrink below its text and grew leftward:
  left edge -15.9 px at 320 (start of "N highlighted" clipped), -55.9 px at 280, -9.3 px at 360 with a 3-digit count.
- **Fields picker, slicer panels, Sector Summary.** The picker panel is a fixed 320 px with a 4 px left floor, so it ended at
  324 px in a 320 px window. The Sales Week and Yard panels' `min-w-[300px]` made the page 323 px wide at 320 (43 px over at
  280). Sector Summary's pivot wrappers (`min-w-[520px]` / `[560px]`) made that page 576 px wide at 320. (The main slicer box
  squeezed beside the macro column was a fourth case; see "Merged onto 14d8d35" below.)

**The fixes** (CSS plus one line of JS; reasoning in CODE_NOTES.md "Analyze Chart Columns: No Sideways Overflow", "Highlight
Pill: Fits Narrow Windows" and "Fields Picker And Slicer Panel: Fit 320px"): the chart scrolls inside its own
`[data-week-chart-scroll]` box (`w-max min-w-full`, `mt-4` on the scroller), columns `px-1` -> `px-0.5`, title and legend
`flex-wrap`; the pill gets `flex-wrap` and `max-w-[calc(100%-1.5rem)]` with Report Card / dot / Clear in one inner group;
the picker panel's width is `min(320, innerWidth - 16)`; the Sales Week / Yard panels use `min-w-[min(300px,100%)]` and the
Sector Summary wrappers `min-w-[min(520px,100%)] max-w-full` / `min-w-[min(560px,100%)]`, identical wherever the row is
wide enough.

**Merged onto 14d8d35 (the 2.5 stack landing) before shipping.** The batch was written on 02395b6; `main` then took #159 and
the #184 stack. One duplicate: #159 had fixed the main slicer box (`basis-full sm:basis-[0%]`, guarded by Booking_Flash's X12
iframe check) on the same line this batch changed to `min-w-[min(300px,100%)]`. #159's version was kept (it also keeps
`min-w-0`, which the Lane row's own scroller needs) and this batch's dropped, with the Suite 25 case that asserted it (a
400 px row inside a 1280 px window cannot exercise a media query), so Suite 25 has 5 checks, not the 6 it had on the old
base. No other open PR or unmerged branch touched these lines. Re-measured on the merged build against current `main`
(page `scrollWidth - clientWidth` on Trade Summary / Sector Summary / POL / Booking Flash / Compare, and the opened picker
panel): `main` still overflows 3/256/3/3/3 px at 320 and 43/296/43/43/43 at 280 (Sector 76 at 500, 186 at 390, 216 at 360)
and its picker is [4, 324] at 320 and 280; with the batch every tab is 0 at every width from 1920 to 280 and the picker is
[8, 312] / [8, 272]. From 600 px up the two builds are identical (picker rects to the pixel, 0 overflow on both).

**Pinned by** +13 live checks on both targets (`main` 348 -> **361**; `testing-2.5` 474 -> 487 on 14d8d35, then 490 -> 503 once #185's
+16 for Kevin's Show-in-table decisions had landed first, and finally `main` 356 -> **369** and `testing-2.5` 520 -> **533** on top of
#189's follow-up round, read from a real run): Booking_Flash +4 (pill,
measured in a throwaway transformed box that becomes its containing block, with a Setup check proving that);
Analyze_BookingFlash and Analyze_POLBookingFlash +2 each (`checkChartColumnsFitModal`: the chart section fits its box with the
modal narrowed to 753 / 560 / 360 px, and MAR through the Lane slicer does not scroll the modal); new Suite 25
`Narrow_Window_Fit`, 5 (Setup; the picker with `window.innerWidth` stubbed to 320 and 280; the Sales Week / Yard panels in a
250 px filter row; both Sector Summary pivot panels in a 300 px row). Each simulated case asserts first that the old rule
really could not fit, so it cannot pass without exercising the fix.

**Red-run against the old build** (`git show origin/main:dist/index.html`, i.e. 14d8d35 with #159, through a repo-relative
`BF_APP_HTML`): 361 executed, 352 passed, and exactly the 9 new checks red: the pill fit check (left -15.92 / -66.03 at
320, 1- and 4-digit counts); both chart checks on both tabs (section 738 vs 719 / 526 / 326 at 753 / 560 / 360, MAR 801 vs
768); and four Suite 25 checks (panel [4, 324] at 320 and 280; Sales Week [23, 323] in a 250 px row; Sector panels to 536 /
576 in a 300 px row). The pill's Setup, Clear and desktop checks and Suite 25's Setup are green on both builds, as designed
(controls, not evidence). Every other suite green with unchanged counts.

**Pass runs against the fixed tree:** `dist/index.html` 361 of 361 (Booking_Flash 21, Analyze_BookingFlash 28,
Analyze_POLBookingFlash 22, Narrow_Window_Fit 5) and the 2.5 testing build 487 of 487 (503 of 503 after merging #185, and 369 / 369 / 533 on
source / `dist/` / 2.5 after merging #189, with #189's Focus_Return 8 and Show_In_Table_Phone 6 at its 390 px boot green; full gate passed each time) (Analyze_BookingFlash 34,
Analyze_POLBookingFlash 25 with its "Show in table" checks, Phone_Layout 5, Narrow_Window_Fit 5). `check_testing_build_drift.js`
failed before the port ("DRIFT: the main file changed since the 2.5 testing build was last synced") and passes after it and
`--update`; the 2.0 and 2.5 files received identical added and removed lines.

**Mutation test** (on the 02395b6 base, 359 checks, the full suite against the patched app with one fix reverted at a time):
reverting the chart fix failed exactly its 4 checks, the pill fix exactly 1, the Fields-picker/slicer fix exactly its 5; the
sub-mutants failed exactly their own records (picker clamp 2, Sales Week floor 1, slicer box 1, Sector 1; chart scroller
only or title/legend wrap only: the narrowed-modal check). One sub-change no check notices: reverting only the column
padding (`px-0.5` back to `px-1`), because with the scroller in place the wider columns just scroll inside the chart, which
is not the bug these checks guard.

**Verified by hand** (independent agents, real Chromium, old and new builds side by side, source and `dist/`): a cross-fix
code review (nothing blocking; found the 12 px chart gap and the Sector `w-max` reliance, both fixed, and the Suite 25 Sector
vacuity, fixed); a desktop rect diff of 160 state comparisons at 1920/1366/1280/1024 (0 unexpected differences; also found
the 12 px gap); the pill at 13 widths x 4 counts x 2 heights by real clicks and touch (0 cases off-window, was 72 of 208;
pixel-identical from 640 px up); the picker / slicers / Sector at 14 widths x 5 tabs, three picker mounts, real clicks, Text
Size 16/24 (0 overflow everywhere; found the "Grid: In Fields" variant of Suite 25's row case, since removed with that case);
the chart's lane sweeps in 9 setups (1366x768, 700, 390, real native scrollbars, two historical snapshots: 0 of 58 lane x tab
combinations overflow the modal, old up to 58 of 58; nothing clipped above or below the new scroller).

**Found by the cross-fix review and fixed before shipping.** (1) The chart's new scroller is an overflow box, which
starts a new block formatting context, so the chart's `mt-4` inside it stopped collapsing with the title row's `mb-3`: the
chart sat 12 px lower at every width, desktop included (gap 16 -> 28 px). `mt-4` moved onto the scroller; gap 16 px again at
1920, 1280, 1024, 600, 390 and 320. (2) Sector Summary's left pivot wrapper is `w-max`, which on its own keeps it at its ~735
px content width; Chromium's flex sizing holds it to the row anyway, and `max-w-full` now makes that engine-independent.
(3) Suite 25's Sector check now measures the panel's unconstrained width first (wider than the 300 px row), and every inline
width is restored in `finally`.

**Still open (verified, not changed here).** The wrapped pill is 20 px taller (58 vs 38), so where it wraps it covers more of
three things it already overlapped: the Settings popover's Export button at 320x800 (61%, a centre click hits the pill),
two Fields-picker checkboxes instead of one at 360x800, and the table's last row plus most of the one above when scrolled to
the bottom at 320x800 (CODE_NOTES.md, "Highlight Pill: Fits Narrow Windows"). The trend line places its points at equal
fractions of the chart width, but with a lane filter the columns differ (starred "W##★" labels are wider), so the line drifts
from the bar centres: 4-14 px at 1366 on the new build (0.02 px unfiltered), 16-63 px on the old one. Pre-existing and
identical in both builds: the Fields panel does not re-clamp when the window is resized while it is open; with classic
scrollbars its right 7 px sit under the page scrollbar (19 px before); below 286 px the Clear Filters badge overlaps the EC
button.

**Process lessons from this batch.** (1) `BF_VENDOR_CDN=1` writes the rewritten app to one fixed path whatever
`BF_APP_HTML` names, so a new-build run and a control run started in parallel both tested the old build (their numbers
agreed to the hundredth of a pixel, which is what gave it away); runs are sequential now, and TESTING.md says so. (2) A
check written in a harness that defines its own helpers can call one the suite file does not have: the chart check's
`sleep()` crashed the whole run until it got its own local definition. (3) `main` moved under the batch (eleven PRs landed
the same day), and one of them fixed the same line: check open PRs and `main` for the lines you are about to change before
starting, and merge `main` in again before the gate. (4) Resolving merge conflicts with a regex: a `=======` separator
inside a `// =====` comment line matched as the conflict marker; resolve on whole marker lines only, then compare the merged
file line-for-line with both sides.

## 2026-10-06: Show in table leaves Sale Week alone (2.5 testing build, count unchanged at 533)

**Why:** Kevin, asked whether the button should set the Sale Week slicer to the Analyze window's weeks (the #185 answer), said
"leave Sale Week alone": the button must not change any slicer the reader set. `showAnalysisGroupInTable` no longer writes
`selectedSaleWeeks`; the Lane (or Yard, or the POL header filter for "NO N.A. CALL") is the only thing it adds. The button's tooltip
no longer says "for this window's weeks".

**Checks rewritten in place, not removed** (no count change): seven assertions said the Sale Week slicer must equal the window's
weeks. Each now says it must equal what it was just before the press (Analyze_BookingFlash apply and Undo, Analyze_POLBookingFlash
yard and NO N.A. CALL, Sector_Summary press, Show_In_Table_Phone). A review pointed out that those all start from an EMPTY Sale Week,
so a button that cleared the slicer would pass them; the Analyze_BookingFlash check now first presses Sale Week chips itself and
requires exactly those to survive the press. **Corrected by the code review the same day:** the first version pressed ONE week the window
showed, and since the window's default weeks are the weeks present (which follow the Sale Week slicer) that are also flagged, the window
collapsed to that one week, so the old "sets the window's weeks" button would have written the same single week and passed. The reader
now presses the window's last week and Ctrl+clicks one week the window does not flag (a plain second click replaces the first:
`toggleFilter` only adds with a modifier key), chosen with the lane so the lane has real sailings in both. The window then shows only the
first week, the old button would write that week alone and fails `apply`, and `rows` requires at least one table sailing outside the
window's weeks, so its "restricted to the window's weeks" half really filters (passing run: lane PS1, W30 + W31, window [W30]). The Lane "rows" check got stronger, not weaker: it records the
lane's sailings from the table under the Coast slicer BEFORE the press and requires the table to hold exactly those afterwards, every
week included, and the subset of them in the window's weeks to be exactly the card's "Sailings: N in W wks".

**Same PR, a #187 review follow-up (count unchanged):** the Analyze chart-fit check's "one lane (MAR) selected through the Lane
slicer" step never confirmed the slicer applied. If the click ever stopped toggling it, the step measured the unfiltered modal, which
fit even before #187's fix, and passed (and the "slicer cleared" half passed trivially too). It now waits for the MAR button to read
`aria-pressed="true"` and the table to shrink before measuring, requires that for a pass, and only clicks again to clear if it is pressed.

**Same PR, the 2026-10-06 code-review round (counts unchanged: 369, 369, 533; headless counts in docs/TESTING.md):**
- **Gate speed.** Isolated iframe boots reuse the page's babel-standalone output instead of recompiling the 1.2 MB app each time
  (docs/TESTING.md, "Isolated iframe boots reuse the compiled app"); a few render-settle sleeps became DOM-quiet waits capped at the old
  sleep (the "nothing happened" sleeps, such as the 300 ms click-defer windows, were left alone on purpose: a quiet DOM proves nothing
  about a timer); `w3.boot`'s flat 4 s after a failed first load ends once every IndexedDB request in the frame has finished and the
  failure has shown for 500 ms; the runner's post-upload 2 s sleep became a DOM-quiet wait; throwaway file names carry the pid.
  `check_shared_sync.js` runs the sync in-process (one Babel load) except for seven real CLI runs, 20 s to 4 s.
- **Fixes with new headless checks:** Apps Script notes-cache race (a generation stamp), flush before the lock is released, no silent
  re-creation of a team Sheet whose stored id fails to open, the archive refresh always copies at least one day; `checkFeed`'s
  DUPLICATE_HEADER message names the column the app really reads (SheetJS renames an exact repeat to "X_1", so that is the FIRST one);
  `canon()` tells -0 from 0; the sync names an unreadable main app file instead of crashing on null.
- **App:** production got the 2.5 build's "download time follows the rows" fix and its failed-first-load message (fixes, so ported);
  Trade Summary's Max Laden is indexed once per filter change instead of scanning every row for every cell (both files; 18,000 random
  cases equal to the old scan with `Object.is`, except a lane literally named "constructor", which the old plain-object scan dropped); in 2.5,
  Analyze's source rows are keyed on the Undo bar's `before` (no re-filter when the narrowed table settles or a second card is pressed)
  and the Sector Summary lane set is only built where it is read.


## 2026-10-06: code-review follow-ups (main 369 -> 381, testing-2.5 533 -> 545)

**Why:** the follow-ups Kevin approved after the code-review round ("do the follow ups too").
- **`App_Update_Check` (new, 9 on both targets).** The "new version" banner fetched `?check=version` from `/exec`, which under "User
  accessing the web app" returns the sign-in page, so the check switched itself off. It now asks `getAppVersionHash()` through
  `google.script.run`. The suite boots iframes on a shifted clock to fire the 5-minute poll on demand. Negative control: the old `dist/`
  fails 4 of the 9 (the `google.script.run` path), the other 374 checks pass.
- **`Booking_Flash` +3.** The Detail table now stays mounted (hidden) across tab switches: the same element after a round trip and
  hidden while away; nothing inside the hidden table can take focus (it has no `inert`, see CODE_NOTES.md "Booking Flash Table Stays
  Mounted"); a slicer changed on another tab is applied row for row on return.
- **POL auto-fit cache.** No new check: the existing POL width checks still pass, and a one-off verification compared 5,600 applied
  column widths against the old approach over random walks on both datasets, 0 different (CODE_NOTES.md "Per-dataset width cache").
- **Headless:** `check_server_extras_logic` 13 -> 35 (per-visitor prefs store and migration, owner-only admin claim,
  `getAppVersionHash`), `check_archive_logic` 47 -> 49, `check_team_features_logic` 444 -> 457. With the old `.gs` files put back,
  20 of the new checks fail.
- **Seen once in the gate, not reproduced:** the first full run failed three `Compare` checks on the source target (rows not found) and
  the source highlight budget (POL 0->1 at 5.4 s against 3 s). Both passed on a deliberate re-run (381/381; 1,289 ms), and an interleaved
  A/B of the highlight benchmark, old build vs new, three runs each, showed the same spread (old 267-571 ms, new 236-733 ms).


## 2026-10-06: semantic merge conflicts: #185 vs #186 and the merge-safety systems

**The incident.** Two PRs were each gated on their own and then combined, and the combination was wrong in ways neither gate could see.
This is what Martin Fowler calls a *semantic conflict*: git has nothing to flag in the text, yet the merged code means something
neither author intended.

- **#185** ("2.5 testing build: Show in table matches the card, and the offline copy gets its own healthy baseline (Kevin's 2026-10-06
  decisions)") was created and merged on 2026-10-06 at 12:42 UTC (merge commit 6b980ee). It is
  the entry "Kevin's decisions on Show in table and the offline-copy baseline" above.
- **#186** ("Follow-up round: shared/ review fixes, 2.5 gaps, NO N.A. CALL filter, focus return (pins 356/502)") was created at 13:13 UTC, after #185 was already on `main`, and its description says it sits
  on top of #184. Its own branch passed the full local gate (25 of 25 jobs; the 502 count, in the "follow-up round" entry above) before
  #185 landed, so against a `main` that did not have #185. The agent then merged `main` into it (commit f812a79, 14:02 UTC) and the combined
  work reached `main` as **#189**, "Follow-up round, consolidated onto #185" (merge commit 77ef5e3, 14:47 UTC). GitHub lists #186 as merged
  two seconds after #189's merge commit; why (its commits being contained in #189) is unconfirmed here.
- **What the merge got wrong,** from "Merging over #185" in the follow-up round entry above and the message of f812a79: (1) #186's POL
  filter cleanup on leaving a tab would have deleted the reader's own POL filter, because #185's lane and yard cards keep it inside
  the Undo bar's `expected` state; (2) the offline copy's "3 steady loads" way out recognised only `ROW_COUNT_DROP` and
  `ROW_COUNT_JUMP`, so a real resize (which also raises the new `REAL_ROW_COUNT_*` codes) would have frozen the copy; (3) two "NO N.A.
  CALL" checks still assumed the window closes and the button clears every slicer, so on the merged tree they failed identically twice
  and the next check crashed; (4) a red run with the POL fix disabled also failed two of #185's own `Offline_Cache` checks, because
  the new real-row check reported the same fact a second time. Also dropped: the 2.5 redirect that sent focus to the narrowed table,
  which #185's "window stays open on desktop" made pointless.
- **What caught it.** The record says (1) and (2) were "found by reading the merged code, not by a failing check". (3) was a failing
  check, found after the merge was assembled; (4) was found by a deliberate red run. None of this was caught by the gate each branch had
  passed alone. It was caught before reaching `main` because the agent assembling the merge read the code and ran the checks again; that
  is a habit, not a mechanism. Whether git reported any textual conflicts in the same files is unconfirmed here.
- **A related, earlier lesson in this file:** "Process lessons from this batch" (3) in the narrow-window entry above ("`main` moved under the
  batch (eleven PRs landed the same day) ... check open PRs and `main` for the lines you are about to change before starting").

**Why per-PR gates cannot see it.** A gate tests the tree a branch would produce *at the moment it ran*. When another PR lands afterwards,
the tree that actually ships is a different one, and it was never tested. The app being one file makes this worse: every PR touches it,
so "the same file changed" is always true and says nothing; what matters is whether two branches changed the same *function*.

**The defences considered.** Items 1 to 4 are the four Kevin asked to have built, in his numbering (D20 in [DECISIONS.md](DECISIONS.md));
the rows after them are recommendations from the research that nobody has accepted and nothing here builds.

| Item | Defence | Closes | Status |
|---|---|---|---|
| 1 | A merge queue: test the PR *as merged onto the current main*, push only if main has not moved (the "Not Rocket Science Rule": main only ever receives a tree that was tested as it ships) | green alone, broken together | **Built locally:** `scripts/land.js` |
| 2 | A written record of decisions and claims | two sessions deciding or building the same question differently | **Built:** [DECISIONS.md](DECISIONS.md) |
| 3 | Function-level overlap detection across open branches | two branches changing the same function, unaware of each other | **Built:** `scripts/check_pr_overlap.js` |
| 4 | Habits: small slices landed one at a time, merge `main` into open branches the moment one lands, one merger at a time, a fix-removed run on any merge of two authors' logic | stacking, stale branches, untested interactions | **Written down** (AGENTS.md, "Landing changes (merge safety)"); not mechanically enforced |
| -- | A hosted merge queue such as Mergify | the same hole as item 1, hosted | recommended only, not built |
| -- | GitHub branch protection with "require branches to be up to date" and required checks | stops a stale branch merging, and a direct push to `main` | recommended only, not built. Per the research it needs GitHub Pro on a private repo. The repository is private and user-owned (read through the API on 2026-10-06); whether protection exists today could not be read (the API returned 403), and the Pro requirement was not tested here |
| -- | Restoring GitHub Actions (billing; see D9 and AGENTS.md) so a hosted queue could run | a hosted gate | **Done 2026-10-11** (Kevin fixed billing; D45). The hosted queue itself (Mergify, branch protection) is still recommended only |
| -- | Short-lived branches (merge within hours, not days) | the window in which `main` can move | recommended only; a working style, not a tool |

Kevin's confirmed instruction, quoted exactly: "yes build 1-4 as one PR in order" (2026-10-06).

**What was built, and what each one cannot do.**

- **`scripts/land.js`** (the usage and the output are in [TESTING.md](TESTING.md#landing-changes-with-scriptslandjs)). It merges the PR onto the
  current `main` in a scratch worktree, runs the gate (`node scripts/run_ci_locally.js`) on that exact tree, stamps the merge commit
  with the tree hash and gate result, and pushes only if `main` has not moved; if it has moved it starts again, so the re-test is the
  point. It **cannot stop a person pushing to `main` by hand**, it does not replace branch protection, and it checks nothing a gate does
  not check. It does not call the GitHub API.
- **`docs/DECISIONS.md`** gained a log and a claims table. A claim is only visible to others once it is on `main`, so it covers intent
  before code exists, and nothing enforces reading it.
- **`scripts/check_pr_overlap.js`** reports branches that changed the same function. It **matches names, not meaning**: two branches
  that change different functions which interact (the POL filter and the Undo bar's state here) are not flagged. It reads JS, Apps
  Script and app-HTML files only, and the symbol mapping is indentation-based.
- **The habit rules** are only habits. Nothing checks them.

**How to tell each defence is working** (what to run, and what a good answer is):

| Defence | Check | A good answer | A bad answer |
|---|---|---|---|
| `land.js` | `node scripts/land.js --verify --last 20` | `VERIFIED` rows for landings made with the script; `UNSTAMPED` only for history older than the script (expected) | `MISMATCH` (exit 6): the commit's tree is not the tree that was tested. An `UNSTAMPED` row **after** the script was adopted means someone pushed past it |
| `land.js` | `node scripts/land.js --verify` on the tip of `main` | "verified: main's tree equals the tree that was tested" | exit 5 (unstamped) or 6 (mismatch) |
| overlap | `node scripts/check_pr_overlap.js` from a feature branch | no `OVERLAP` lines, or lines you can explain in the PR | a `HIGH` overlap you did not mention (`--fail-on-overlap` exits 1) |
| overlap | the acceptance test: compare #185 and #186 (`git fetch origin refs/pull/185/head refs/pull/186/head`, then `--base` the merge-base of the two) | the shared symbols are flagged. A tool that does not flag the incident it was built for is not done. **First real run, 2026-10-06 (1.0 s):** six HIGH symbols, among them `FlashReportDashboard > runFeedCheck` (#185 changed its parameters and its new `feedCacheVerdict` expects an array back; #186 changed the return to `{problems, realRows}`: the collision itself), `showAnalysisGroupInTable` and `applyCsvText`. The Undo-bar tab-leave cleanup effect was **not** flagged (#186 rewrote it, #185 only sat next to it); the flow shows up through `showAnalysisGroupInTable`. A name-level check points at the neighbourhood, not at every interaction | no overlap reported for that pair |
| decisions | each feature PR's description names the D-numbers it relied on, or says "none" (the PR template asks) | entries exist before the code that implements them | a feature merged that settles a question with no entry |
| claims | the table in DECISIONS.md | rows for work in progress; none past their Expires date | stale rows, or two rows for the same area |
| habits | the PR description says whether the branch was merged with `main` before landing and whether a fix-removed run was done | yes, with the check that went red named | nothing said |

**Found in review of the builders' work (2026-10-06).** `--docs-only-fast` decided "docs only" from `git diff --name-only`, which with git's default rename detection lists only the new name: a PR that moved `scripts/x.js` to `docs/x.md` would have got the fast gate, a `(docs-only)` stamp and a push while deleting a script. It now diffs with `--no-renames`; `tests/check_land_script.js` has a case for it, red with the flag removed. The independent test author also found that the merge itself (not just the commit) needs the fallback git identity on a machine with none configured.

**What has been proven since (checked 2026-10-08).** When this was written, `land.js` and the overlap tool had been exercised only against
throwaway repositories (`tests/check_land_script.js`, `tests/check_pr_overlap.js`). Since then `land.js` has landed real PRs on `main`:
`node scripts/land.js --verify --last 12` shows #191, #190, #192, #193, #194, #195, #197 and #198 as `VERIFIED` (stamp matches the tree), and
#196, #187, #188 and #189 as `UNSTAMPED`, meaning they were merged without the script (#189 and earlier predate it). The unstamped #196
is the live example of the limit the tool states: it is a path, not a lock, and it reports a bypass afterwards instead of preventing it.
Still unproven: the overlap tool has had one real run (above) and no run that caught a conflict before it landed. Nothing here touches
`/exec`, so the production-only questions in AGENTS.md are unaffected.

## 2026-10-07: code review of #190: the follow-up fixes (regression counts unchanged: main 381, testing-2.5 545)

Two code reviews of #190 (after it landed) listed eleven findings between them. Kevin: "Fix all the issues and bugs and gaps"
(chat, 2026-10-07; [DECISIONS.md](DECISIONS.md), D26). Every app fix is a fix or an efficiency change, so each went into the
production file **and** the 2.5 testing build, identically (drift fixture refreshed).

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 | `FreezeWhileHidden` skipped the hidden Booking Flash table's re-render, but the parent still built every row element as `children` | the table is a `render` function, called only when the wrapper renders | one keystroke in a POL header filter on the 9-day CSV, with Booking Flash visited first: 7,183 `React.createElement` calls before, 4,539 after (`dist/`, measured 2026-10-07) |
| 2 | The frozen hidden table kept the previous dataset's rows alive after an upload or refresh | `dataset={rawRows}` breaks the freeze once per new dataset | upload the 8/12 export while on POL: the hidden table went 523 -> 467 rows (before: stayed at 523 until the next visit) |
| 3 | `laneMaxIndex` was rebuilt on every filter change on every tab | built only while Trade Summary shows (`null` elsewhere; the old scan is the fallback) | code; only Trade Summary reads it |
| 4 | Trade Summary's `(blank)` Sale Week column showed Max Laden 0, Utilization 0% (pre-existing; the pivot keys a blank as `(blank)`, the index used `''`); a blank trade or sub-trade group was read as "any" | index and lookups keyed the pivot's way | the 8/12 export with FLX and EXW sale weeks blanked: `(blank)` Max Laden 0 and 0 before; 1,700 (TPT/PS) and 400 (LAT/LN) after, equal to the per-lane maxima computed from the file with openpyxl. No shipped file has a blank trade, sub trade or sale week (0 in both, counted), so no number on them changes |
| 5 | The POL row-set width cache ignored zoom and text size while the per-dataset store did not | the row-set key starts with the zoom level and text size | code; same rule as the store |
| 6 | The screenshot's live scrollables skipped only `[data-bf-tab-hidden]`, the clone dropped `[hidden]` too | the same selector on both sides | code |
| 7 | `fetchedFeedInfoRef` kept a fetched export alive after the screen moved on | `releaseFetchedFeedInfo()` wherever the staged text is dropped or applied; a text staged as "New data available" is kept | code; the stamp suites (`Feed_Stamp`, review fix F2) still pass |
| 8 | Each page load made up to 8 PropertiesService reads and 6 Session lookups for 4 values | `doGet` reads the visitor once: one `getProperties()`, then a `bfrPref:legacyChecked` marker stops the old-key lookups | `tests/check_server_extras_logic.js` 35 -> 40: a later visit is 1 store call, 0 script-store reads, 1 `getActiveUser`, 1 `getEffectiveUser`. The 5 new checks fail on the old `Code.gs` (4 of them; the fifth, "a failed copy writes no marker", is true of the old code by construction) |
| 9 | The removed `?check=identity` probe left an email-bearing user property nobody could delete | the page-load read deletes `bookingFlashIdentityProbeStamp` from the visitor's own store | one rewritten check in `tests/check_team_features_logic.js` (count unchanged, 457), red on the old `Code.gs` |
| 10 | The runner's 300 ms DOM-idle settle could end with a pinned fetch in flight | settle needs no DOM mutation **and** no request in flight for 300 ms, still capped at 2,000 ms; the log says which ended it | the gate's runs |
| 11 | `getAppVersionHash` could be cached in CacheService | **not done, on purpose**: the script cache is shared by every deployed version, so the old and new versions could hand each other's hash back and trip the banner's instability guard; the cost is mostly the round trip, which a cache keeps | comment on `getAppVersionHash` |

**Still open (production only).** Whether `google.script.run` from an already-open page reaches a newly deployed version, which
the "new version" banner depends on, cannot be tested off `/exec`. apps-script/README.md now has the exact steps ("The banner itself
after a redeploy"); until they are run it is UNCONFIRMED, like the rest of #190's server changes.

## 2026-10-07: Kevin's answers to D18 and D19 (main 381 -> 385, testing-2.5 545 -> 555)

Kevin answered the open questions on 2026-10-07 (docs/DECISIONS.md, D18, D19, D27 and the D2 to D7 hold). Two answers changed behaviour.

**D18: a hand-typed POL filter no longer follows the reader to other tabs (a fix, so production and the 2.5 build alike).**
`headerFilters` is one map, and `filteredRawRows` applied every key on every tab. Twenty columns have a filter box only in the POL table
(its `filterCell` keys that no Booking Flash `renderFilter` shares), so a value typed there narrowed Booking Flash, the summaries and Analyze
with nothing on screen to show it. Now `activeHeaderFilterList(filters, { skipPolOnly })` leaves those keys out off the POL tab; the memo
reads that through one narrowed boolean, `polOnlyHeaderFiltersOff` (true only off POL while such a filter holds text), so a tab switch
re-filters only when it must, in keeping with the 2026-09-15 tab-dependency narrowing. The 2.5 build's `rowsUnderSlicerState` (Analyze's
"before" cards) uses the same helper instead of its own copy of the list-building loop. Columns both tables show (POL's "Service" is
Booking Flash's "Lane") keep one shared filter, visible in both boxes.
- *Evidence:* four new checks in `POL_Booking_Flash`, on all three targets. On `main`'s production file the "does not follow" check fails
  with `{"rows":122,"bfRows":467}` (USNYC; the figure the follow-up round measured) and the other three pass; after the change all four pass
  (POL 1,398 -> 221 rows with the filter, Booking Flash 467 unchanged, 221 again on the way back; FLX in "Service" still takes Booking
  Flash to 18 with "FLX" in its Lane box).
- *The key list is checked, not trusted:* `tests/check_field_filter_gating.py` now derives the POL-only keys from the render sites and fails
  when `POL_ONLY_HEADER_FILTER_KEYS` differs. Red run: `vco` dropped from the list in a copy -> "Missing (POL-only, not listed): ['vco']".

**D19: a successful first live load replaces the cached copy at once (2.5 build only: the offline copy exists only there).**
The gap recorded on 2026-10-06 (CODE_NOTES.md): a poll that failed fast during a slow first fetch put the copy up, and the first fetch's own
guards (`hasLoadedDataRef`, the ticket) then dropped its good reply, so the cached banner stayed until the next poll, up to 10 minutes.
The initial load now skips both guards when it would replace the copy, on screen or still being read (`cacheFallbackStartedRef`, nothing
loaded), unless a historical or Compare view is open (the poll's rule). The guards exist to keep a stale reply off NEWER live data; a copy
is older than any live reply, and a newer load that succeeds clears `showingCachedRef` first.
- *Evidence:* two new `Offline_Cache` boots ("late first reply": copy shown, copy being read), 3 records each. Red on the build before the
  fix: 551/555, exactly the four non-setup checks failing (`"live":false`, the banner still up; in the "reading" variant the screen stayed
  empty and the old copy went up afterwards). Green after (see the gate below).
- *Harness note:* a hand-run of the testing target must pass `BF_RESULT_POLL_TIMEOUT_MS=1200000`, as `scripts/run_ci_locally.js` and
  `ci.yml` do: the first red run here used the runner's 240 s default and stopped inside Offline_Cache, before the new boots.

**Also:** D17's tab-leave restore of the "NO N.A. CALL" filter stays as built; its comment now gives the reason that is left (the Undo bar
goes with the tab change). docs/TESTING.md's "Suites 1-9 total" line said 132 although the column summed to 135 before today; now 139.

## 2026-10-07: `Feed_Stamp` "Direct stamp goes stale" flake: the fake clock fired the background polls (counts unchanged: main 385, testing-2.5 555)

**The flake.** In a full local gate on `main` 1eaee3b (2026-10-06) the 2.5 run failed one check, `[Feed_Stamp] Direct stamp goes
stale: 3 h later ...`, and passed on the retry. Detail: before `"Live feed · fetched 3:09 PM (just now)"`, after the tick
`"Live feed · fetched 6:09 PM (just now)"`, level `ok`, `tickTimersFired: 4` (one expected).

**The mechanism.** `installClock` (the Feed_Stamp/Offline_Cache fake clock) captured every timer with a 25-35 s delay as "the
stamp's 30 s tick", and `fireTick()` ran them all. The app arms its background polls with `scheduleAlignedInterval`, a `setTimeout`
of `interval - (Date.now() % interval)`: the data poll and the Sector Summary poll (10 min) and the app-update poll (5 min). That
first delay is anything from 0 to the interval, so a boot that mounts 25-35 s before a 5 min wall-clock boundary (3:09 PM, before
3:10) arms all three inside the tick window. The test then advanced the clock 3 h and fired them with the tick: the data poll
re-downloaded the feed (a direct download in this boot), so `fetchedAt` became the advanced clock and the stamp read "just now".
The odds were about 10 s in every 300 s per boot, so roughly 1 run in 30 for this check.

**Reproduced on purpose, before the fix.** A temporary wait held the DIRECT boot until 266-268.5 s into a 5 min window. The check failed
exactly as in the gate (`"fetched 10:09 AM (just now)"`, 4 timers: three `Timeout`s of 33,571 ms and the stamp's `Interval` of
30,000 ms). The SERVER boot's `Tick: 10 min later ...` check also failed in the same run (4 timers, the age stuck at "16 min ago"): the same flake
had a second victim.

**The fix (test harness only, no app change).** A `setTimeout` whose end (`now + delay` on the fake clock) is within 50 ms of a 5 min
boundary is an aligned poll and is never captured as a tick (5 and 10 min both divide 5 min). The stamp's tick is a `setInterval`, which
is never excluded, so the check still needs the real tick (`tickTimersFired >= 1`) and still asserts the same text and level. The
stale check's detail now also lists what `fireTick` ran (`ticksFired`: kind and delay), so the next look at a failure shows it directly.

**Evidence.** The same forced timing after the fix: 545/545, both checks fired exactly 1 timer, and the tick check's `tickElements`
fell from 1,654 (the polls had re-rendered the app) to 1. Revert check: with the 2.5 build's stamp forced to `stale = false`
(temporarily), the target check and four other stale checks fail (540/545). Three unforced 2.5 runs: 545/545 each, every `fireTick` ran exactly 1 timer. Full gate
(`node scripts/run_ci_locally.js`, 2026-10-07): every job passed (main 381 on source and `dist/`, testing-2.5 545). After merging `main` 959b223 (#195,
+4/+10 checks) the gate passed again on the merged tree: main 385, testing-2.5 555 on the first try, 1 timer per `fireTick`.

## 2026-10-08: slicer text contrast, fixed at the cause (D28; main 385 -> 390, testing-2.5 555 -> 560)

**The bug.** Land #197 gave the two orange (`#ed7d31`) slicers `textClass="text-black"`, because white on that orange is 2.77:1.
The two code reviews of that commit found the cause was still there: `SlicerBtn` defaulted any chip's text to white, so the next light
fill would ship the same way. They also found that nothing tested it: `findUnreadableCells` only looks for exactly white text on a white
or transparent `<td>`. Measuring every chip (WCAG 2.x relative luminance, alpha-composited onto the slicer panel `#e7e6e6` /
`gray-800`) showed a wider problem. The old fade, `opacity-40` on the whole button, put **every faded chip in every slicer** between
1.77:1 and 3.14:1, AP Frozen / AP Only included.

**The fix (production and the 2.5 build).** One `SLICER_TONES` map pairs each fill with its text colour, and `<SlicerBtn tone=… slicer=…>`
replaces `bgClass`/`textClass`. A faded chip fades its fill only (`bg-…/40`) and draws full-strength `text-black dark:text-white`
(5.67:1 or better on every tone). `data-slicer` lets tests tell SPC PIC and Yard apart; the old `YARD_CHIP = 'bg-[#ed7d31]'` selector also
matched pressed SPC PIC chips. White on `orange-600` (3.56:1, schedule-change × and details header) and `yellow-600` (2.94:1, Auto-Refresh
"Turn On") moved to `-700`; the new-version × in dark mode moved from `emerald-600` (3.77:1) to `emerald-700`.

**The checks.** `tests/check_color_contrast.js` (headless) holds every slicer tone and every fill/text pair in the source to 4.5:1. Its
first run found the yellow and emerald buttons and three pairs that mirror Excel colours (D29: Kevin chose to keep them; listed in `KNOWN_EXCEPTIONS`).
Before the port it failed the 2.5 build with 34 findings, the slicer and button bugs included. The live suite `Slicer_Contrast`
(4 checks + tripwire, both targets) measures the rendered chips.

**What the live suite caught on its first run.** "AP Only", faded, in dark mode, at 3.05:1: fill alpha 0.498 and text `rgb(213,213,213)`.
That chip was mid-way through its 150 ms `transition-all` from solid to faded. It is not an app bug (the settled colour is 6.88:1), but
a measurement taken during an animation reads a colour nobody is left looking at. The suite now waits for each chip's
`getAnimations()` to finish before measuring.

**Red run.** A copy of the app with the orange tone's text set back to `text-white` and the faded text to `text-white` failed all 4
`Slicer_Contrast` checks and nothing else (390 executed). The light-mode record named SPC PIC "Evan", white on `rgb(237,125,49)`, 2.77:1.

**Two test bugs found by the first full gate, both fixed before landing.** (1) `Show_In_Table_Phone` (2.5 only) has its own chip helper
that matched `className.includes(LANE_CHIP)`. Once `LANE_CHIP` became the slicer name `'lane'`, it found no chip, and it failed the same
way on both runs. It now matches `data-slicer`. (2) `Slicer_Contrast` dark faded failed once in two 2.5 runs: MKG PIC had 0 of its 3
siblings faded, and the "first chip" of SPC PIC and Sub Trade differed between runs. Slicer validity is derived from a deferred copy of the
filter state, so right after Clear Filters a slicer could still be hiding chips the previous filter had made invalid. The suite now takes
each slicer's chip count once it has held still at rest, and waits for that count to return before every measurement.

**Evidence.** Full gate (`node scripts/run_ci_locally.js`, 2026-10-08) after both fixes: every job passed; main 390/390 on source and
`dist/`, testing-2.5 560/560 on the first try (no retry), both row-highlight budgets within limits.

**Pre-landing gap sweep (Kevin: "land it and fix all issues and gaps", 2026-10-08).** Two suspects, both measured.
(1) The grey chip for a selection the other filters leave no row for: `#a1a1aa` on `#e5e7eb` at `opacity-70` measured 1.63:1
(dark: 1.71:1), worse than the orange bug, and it stays clickable (a click deselects it). Neither check saw it: the source lint
cannot pair two separate variables, and `Slicer_Contrast` skipped grey chips by design. Now `SLICER_INVALID` (zinc-600 / zinc-300
text at full opacity, 6.24:1 / 6.97:1), read and enforced by `tests/check_color_contrast.js` (340/340 main, 357/357 2.5). With the old
colours put back, the check fails with 2.07:1 and 2.13:1. `opacity-100` / `opacity-70` had no other user, so they left the priming
literal. (2) Whether the new faded fills are JIT-primed: a Playwright load of the main file, read after the priming host was removed
and before any click, found compiled rules for all nine `bg-…/40` classes, `text-black`, `dark:text-white` and the three `-700`
shades. No change needed. Also repointed three links in this file to a TESTING.md heading that no longer existed.

## 2026-10-08: no "NO N.A. CALL" card in Analyze (D30; main 390 -> 391, testing-2.5 560 -> 557)

Kevin asked for the "NO N.A. CALL" card to go from the POL Performance Summary ("not useful information", chat, 2026-10-08). The card is
a group like any other (the group key is the POL value), so the change is one more term in the filter that already drops `(blank)`
where `groupSummaries` is built, in both app files. The card list and the Excel export both read that array, so both lose it.

- **New check (both targets, `Analyze_POLBookingFlash`):** the Breakdown by POL has no card whose name contains "NO N.A. CALL". It is
  not vacuous: it also requires the visible table to still hold a row with "NO N.A. CALL" and at least one real POL card, so a
  filter that dropped every card, or a table that lost the rows, fails it. (Fix-removed run, 2026-10-08: the production file with the
  filter term deleted failed exactly this check and passed the other 390; its card list was CAHAL02, CAVAN01, NO N.A. CALL, PAROD01, ...)
- **Removed (testing-2.5 only, 4 checks):** the "NO N.A. CALL" half of the Show in table guard, the two POL-filter visibility checks
  (column cannot be hidden; filter dropped off its tab) and the hand-edit check. They tested a button that no longer exists.
  The branch of `showAnalysisGroupInTable` that set `headerFilters.pol` and the D17 tab-leave restore went with them.
- **What is no longer exercised:** Undo's header-filter half. The button now sets only slicers, so there is no header filter for
  Undo to put back.
- Counts are from real runs: main 391 / 391 passed; testing-2.5 557 / 557 passed (a first run, with both targets in parallel, hit
  the 240 s suite timeout on this small machine; rerun alone with `BF_RESULT_POLL_TIMEOUT_MS=720000`).

## 2026-10-08: SPC PIC slicer chips back to white text (D31; regression counts unchanged: main 391, testing-2.5 557)

Kevin asked for the SPC PIC chips back to their original colours (white on `#ed7d31`; D28 had made them black for contrast). SPC PIC and
Yard shared the `orange` tone, so SPC PIC now has `orangeLegacy` and Yard is untouched. Because that pair is 2.77:1, both contrast checks
gained one narrow, named exception instead of being loosened:

- `tests/check_color_contrast.js`: `TONE_EXCEPTIONS.orangeLegacy` (solid state only). It fails if the exception no longer matches
  anything, if no `<SlicerBtn>` uses the tone, or if any slicer other than SPC PIC uses it. Checked by two throwaway mutations:
  SPC PIC back on `orange` -> "TONE_EXCEPTIONS.orangeLegacy is stale"; Yard on `orangeLegacy` -> "only allowed on spc-pic".
- `Slicer_Contrast` (both targets, count unchanged): `isLegacyException` skips only SPC PIC's solid chip painted exactly white on
  `rgb(237, 125, 49)` at full opacity, so faded SPC PIC chips and every other slicer are still held to 4.5:1, and each at-rest check
  now also needs at least one such chip, so the exception cannot sit there unused.

## 2026-10-08: Trade Summary Dry / Reefer cargo slicer (D32; main 391 unchanged, testing-2.5 557 -> 567)

The meeting notes Kevin pasted ("DO this task", 2026-10-08) asked for a Dry / Reefer slicer on the summary tabs instead of splitting each vessel into one
row per cargo nature (that would have grown 10,000 lines to 50,000). Built as Trade Summary chips that change which TEU column the middle row sums:
Reefer = `Measures Reefer TEU`, Dry = `Measures Laden TEU` minus it, neither or both = `Measures Laden TEU` as before. Kevin confirmed the column
mapping afterwards ("Measures Laden TEU = Current Laden TEU"). It is a feature, so it is in the 2.5 testing build only; the production file and `dist/`
are untouched (the drift check and "Deployable build is up to date" both pass without a refresh).

- **Measured before building (8/12 export, 964 rows):** reefer TEU is above zero on 456 rows and above laden TEU on none, so Dry is never negative there;
  laden 282,414 = dry 255,376 + reefer 27,038. The pinned fixture `tests/fixtures/live_csv_2026-08-12.csv` gives the same totals and 85
  (Trade, Sub Trade, Sale Week) groups, with no blank trade, sub trade or week.
- **Looked at by hand first (headless Chromium, the 2.5 file, pinned fixtures):** Trade Summary TPT / AW, weeks W27 to W30: Total 7,713 / 5,741 / 8,240 / 4,625,
  Reefer 406 / 404 / 200 / 356, Dry 7,307 / 5,337 / 8,040 / 4,269. Each Dry + Reefer = Total, and each matches a sum taken straight from the CSV with `csv.DictReader`.
  The table keeps its 15 body rows in every mode; Alt-click on both chips returns the original table.
- **New suite `Cargo_Slicer` (testing-2.5 only, 9 checks + tripwire = 10):** expected values are parsed out of the fixture by the test's own reading of the two
  columns and compared with all 85 cells of the table, and with the table sum, in each mode, so a missing group cannot hide. Also: Dry + Reefer = Total in every cell;
  Max Laden unchanged; Utilization = shown TEU over total Max Laden; one row count in every mode; the chip contract; independence from the Lane slicer and from
  Clear Filters. Setup pins the fixture totals (964 rows, 282,414, 27,038) so a changed fixture fails there, not silently everywhere.
- **Results:** testing-2.5, 567 / 567 passed on the first run, 0 failures, `Cargo_Slicer` 10 recorded. The fast local gate (23 non-browser jobs) passed, including the
  contrast check (testing build 359/359, two more pairs for the two new chip call sites; main 340/340) and the testing-build drift check.
- **What is not covered, on purpose:** Sector Summary (its two tables have no reefer column: `tests/fixtures/sector_data_2026-09-16.csv`); a reefer-specific
  Max Laden (the notes only say how to sum TEU; the next entry below built it after Kevin's answer, and corrects this bullet's first guess: the column offered here,
  `RFR Max Laden TEU`, is per port, and the reefer capacity is `Measures BSA TEU RF`). Client-side only, so there is no `/exec` checklist for this change.
- **Red run (2026-10-08):** the same suite and runner against a detached checkout of `HEAD`, the 2.5 file without the slicer (`data-cargo-slicer` appears 0 times in it): 558 / 567 passed.
  Exactly the 9 `Cargo_Slicer` checks failed, the tripwire passed, and nothing outside that suite failed. The executed count was still 567, so a build that loses the
  feature fails the checks instead of dropping them from the count.
- **Full local gate (`node scripts/run_ci_locally.js`, 2026-10-08):** every job passed. Main 391 / 391 on the source and on `dist/index.html` (so the new suite stays off the main
  target, as it must after the shared test file changed); testing-2.5 567 / 567 on the first attempt, no retry used; both row-highlight budgets within limits.

### 2026-10-08, later the same day: reefer measured against reefer capacity, and the Sector Summary question (D32; main 391 unchanged, testing-2.5 567 -> 569)

Kevin answered the three open points of the entry above ("We would like to see see our filter, the cargo by refers. 2. Then I think we should do refers against refers total
capacity. Or just have it be able to toggle that versus the total amount. 3yes"). Written into D32 before building. Built: Reefer alone now divides by the reefer capacity by
default (the Max Laden row becomes "Reefer Max Laden"), with a two-button toggle to the vessel's total Max Laden, offered only with Reefer alone. Point 3 changed nothing (chips and
toggle are session-only and not cleared by Clear Filters). Point 1, the cargo filter on Sector Summary, was investigated and **not built**; it is still open in D32.

- **Correction to the entry above.** It offered `RFR Max Laden TEU` (`rfrMaxLdn`) as the reefer capacity. That column is per port: the code comments at its `getVal` and at the
  `tableData` override record 20 on one leg and 0 on the next of the same voyage, so a per-lane maximum of it is not a capacity. The vessel-wide reefer capacity is
  `Measures BSA TEU RF` (`rfrBsaTeuRfMax`), the denominator Detail's "RFR Utiliz %" already uses; it is constant within each of the 334 multi-row VVDs of the 8/12 export.
- **Measured before building (8/12 export, the app's own CSV reader):** Reefer TEU never exceeds BSA TEU RF (0 of 885 rows with a Max Laden). Max Laden minus BSA TEU RF is
  negative on 45 of those 885 rows (FLX: Max Laden 300, reefer allocation 400), so Dry has no usable capacity of its own and keeps the total Max Laden. Over the 85 Trade Summary
  cells, reefer over total Max Laden never passes 100%; reefer over reefer capacity passes it in 1 (TPT / PN / 2026/W29: 348 over 346), shown in the usual red.
- **Sector Summary, why not built.** Its left table sums `Trade Summary Avg Booking` / `Avg Max Laden`, precomputed measures. Per lane, the Past-4-Week sum of Avg Booking equals Laden
  TEU / 4 for some lanes (FLX 278 vs 278.25, PN1 1,034 vs 1,034.75) and not for others (AN2 158 vs 118.5, FP2 1,468 vs 1,101, PS4 1,337 vs 1,670), so a reefer average derived
  from rows would sit beside a measure it does not agree with. The right table reads the sector Google Sheet, with no reefer column. It needs reefer columns in those two sources.
- **Looked at by hand (headless Chromium, the 2.5 file, pinned fixtures):** TPT / AW W27 to W30, Reefer TEU 406 / 404 / 200 / 356 over Reefer Max Laden 4,752 / 3,666 / 3,730 /
  2,952 = 9% / 11% / 5% / 12%; on the total basis the same TEU over 18,800 / 15,900 / 18,600 / 13,500 = 2% / 3% / 1% / 3%. The toggle shows only with Reefer alone, and the choice
  survives pressing Dry and then Reefer again.
- **Suite changes (`Cargo_Slicer`, 10 -> 12 records):** +2 checks. "Reefer alone is measured against reefer capacity by default" compares all 85 Max Laden cells with the fixture's
  largest `Measures BSA TEU RF` per lane summed per group; "The capacity toggle" covers the total basis, Utilization, the toggle being absent with Dry / both chips / neither, and the
  choice being remembered. The old "Reefer chip alone" check no longer asserts that Max Laden is unchanged (it is not any more); the Utilization check now divides by the Max Laden
  row shown. The runner pin is 569.
- **Bug caught while writing it, before any run:** the first draft of the two new steps read the toggle and caption from the live page while the previous step had left both chips
  pressed, where neither exists. Each step now puts the page into its own known state first.
- **Results:** testing-2.5, 569 / 569 on the first run, 0 failures.
- **Red run:** the new suite and runner against a detached checkout of the previous commit (`c4d5a6a`, the app without the capacity basis; `data-cargo-capacity` appears 0 times in it):
  567 / 569. Exactly the 2 new checks fail, the tripwire passes, the executed count is still 569, and nothing else fails.
- **Full local gate (`node scripts/run_ci_locally.js`, 2026-10-08):** every job passed. Main 391 / 391 on the source and on `dist/index.html`; testing-2.5 569 / 569 on the first attempt,
  no retry used; contrast 365/365 (testing build) and 346/346 (main); both row-highlight budgets within limits.
- **A one-off failure on the merge commit's gate, resolved.** The gate of the merge of `main` (Land #204) failed once on `dist/index.html`: `[Apps_Script_Team_Features] Notes: (control)
  a click on a plain cell of the same row does highlight it, and a second click clears it` (`highlightedNow` 1 where 0 was expected). The same check passed in the source run (391 / 391),
  in the testing run, and on a single re-run of the `dist/` target (391 / 391, `highlightedNow` 0). It is timing-based (two clicks 450 ms apart, past a 300 ms click defer) in an area
  this change does not touch, and it did not fail identically, so it was treated as timing noise per the flakiness rules above, not as a regression. It did not recur in the gate above.

## 2026-10-08: Excel-style column filters on Booking Flash and POL Booking Flash (D33; main 391 unchanged, testing-2.5 569 -> 589)

Kevin, after PR #205 landed: "can we make the filters on top of um, each column on the tables more Excel like with the type of filtering you can do in in a column there?" (the
Reefer MKG note "a way to filter > or < a numerical value" is two of the number conditions). In the same message: "Don't change any of the calculations for anything with what we just
added today" and, for Sector Summary, "if there's no refer columns in the source data, then there is no refer in it". Written into D32 and D33 before building. Built in the 2.5 testing
build only: a funnel in every filter cell opens an AutoFilter-style menu (text, number and date conditions, And / Or, top / bottom N and average, a searchable checklist), and a bar above the
table lists what is on. Sector Summary: closed as not built (D32); the reefer columns have to be added upstream, which no file in this repo can do.

- **Measured before designing (8/12 export, each quick box given a value its own cells display):** the existing box matches the raw per-leg row, so it cannot find a value computed after a
  vessel's legs are combined. 9 of the 47 Booking Flash boxes with a displayed value return no rows (Standby Threshold, Current Laden (TEU), Peak Utiliz %, Current Laden Utiliz %, RFR Max LDN,
  RFR Utiliz %, Activity vs Booking Utilz, Activity vs Max Laden, LNT) and 5 of 49 on POL (RFR Utilz%, POL Laden Thresh, Peak Utilz, Last ETA, Voyage Remarks) [corrected 2026-10-09, see the D40 entry
  below: that was one sample value per column; measured per row it is 26 Booking Flash and 6 POL columns, and POL Voyage Remarks is not one of them, the probe typed a multi-line remark into a one-line box]. These are exactly the columns
  "above or below a value" is wanted on, which is why the menu tests what the cell shows and the quick box was left alone (changing it changes what the summaries see; D33 follow-up).
- **Why a spec filters the table and nothing upstream.** Booking Flash: after `tableData` combines the legs, before `processedData` adds spacer rows. POL: before `polSpannedRows`. A numeric
  filter applied to raw legs would have changed the SUMMED columns of a vessel (Current Laden is a sum over legs), which is a calculation change; this placement cannot.
- **Review before the tests were final (an independent reviewer with the code and a browser):** 7 findings, all fixed. (1) The menu never took keyboard focus: it was `visibility: hidden` until
  positioned and a hidden element cannot be focused, so a keyboard user could not reach it; my own browser check had looked at the table, not at `document.activeElement`. (2) The wildcard
  matcher was a RegExp: `a*a*a*a*d` against 200 characters took 25 s and `*a*a*a*a*a*a*a*b` against 60 took 42 s, enough to freeze the tab on OK with long Voyage Remarks; it is now a two-pointer
  matcher (1 ms on the same input). (3) The menu is portaled outside the app's `.dark` root, so its `dark:` classes were dead. (4) OK on an untouched Values menu narrowed the filter to the values the
  other columns left visible. (5) `cfParseNumber` accepted `1,2,3` as 123 and `(5` as -5 and rejected `5.`. (6) "Between" showed an error after the first bound. (7) `inputMode="decimal"` hides the
  minus key on a phone. The accessor-versus-renderer table was also checked by the reviewer for every key: no mismatch, on the 8/12 export and on the 9-day CSV (8,769 POL rows).
- **Suite (`Column_Filters`, testing-2.5 only, 19 checks + tripwire):** expected values are read off the rendered cells and parsed by the suite's own readers, never by the app's accessors. Two checks
  compare the menu's checklist (every distinct value and its count) with the rendered cells for all 48 Booking Flash and all 51 POL filter columns. The review added 3: focus in and back, a wildcard
  built to backtrack, a Values filter that keeps values another filter hides. The suite drives the menu inside `flushSync`: awaited menu actions took 6 minutes because Tailwind's Play CDN re-reads
  every element's classes on each DOM mutation (about 150 ms per commit with both big tables mounted), and the real handlers and React commits are the ones a click makes.
- **Red runs:** a copy of the app with `gt` behaving as `ge` and `cfCommas` returning unformatted text failed exactly 9 `Column_Filters` checks and passed the other 580; a second copy with no focus
  handling, a Values filter storing only visible values, a slow matcher and an early error failed exactly the 4 matching checks.
- **Results:** testing-2.5 589 / 589 (two runs by the suite's author, one in the gate); main 391 / 391 and `dist/index.html` 391 / 391, neither runs the new suite.
- **Full local gate (`node scripts/run_ci_locally.js`, 2026-10-08):** every blocking job passed; testing-2.5 on its first attempt (562 s, no retry), contrast 380/380 (testing build) and 346/346
  (main), both row-highlight budgets within limits, drift check and "Deployable build is up to date" green without a refresh (the production file and `dist/` are untouched).

## 2026-10-08: the "Data as of" stamp moves from the masthead into the Settings panel (D34; counts unchanged by this change: main 391, testing-2.5 569 on its base and 589 once merged with D33)

Kevin asked for the "Live feed · fetched ..." line under the title to go ("that banner its npt needed"), then, while a removal was being
built, said "just move it into settings". It is now a status line in the Settings panel (2.5 testing build only; the production file never had
it), with its "Data stamp" toggle gone. Decision: [DECISIONS.md D34](DECISIONS.md). What the work found:

- **The obvious fix would not have worked.** Turning the stamp off by default does nothing for anyone who already ran the build:
  `useFieldVisibilityPref` writes its value to localStorage on every page load, so those browsers hold `'1'` and the stored value beats
  the default. The toggle's key is therefore no longer read at all, and a new boot (`Feed_Stamp`, "OLD-PREFERENCE") stores `'0'` (the
  value of someone who had switched the masthead line off) and checks the line is still in Settings and the key is left alone.
- **The stamp is only in the page while Settings is open,** so every check that reads it has to open the panel first. `w3.showStamp(b)` does
  that and leaves the panel open, which is safe because the panel closes on a `mousedown` outside it and never on the programmatic
  `.click()` the checks use. `readStamp` reports `inSettings` (inside `[data-settings-panel]`, a marker added to the popover) instead of
  `inMasthead`; the popover is rendered inside the masthead element, so "is it under the title" has to be asked as "is there any
  `[data-feed-stamp]` with Settings closed", which is the new `Feed_Stamp` check "Not under the title".
- **`Feed_Stamp` stays at 28 records (27 checks + tripwire).** +1 "Not under the title"; the two toggle checks became one "No setting";
  the reload boot became the old-preference boot (still two records). The `Offline_Cache` checks that read the stamp open the panel and are
  otherwise unchanged; no check was weakened to get here.
- **A shared check caught a real conflict.** `Settings_Popover_Layout` "No status line is white-space: nowrap" failed on the first full run
  (568 / 569): the stamp's uploaded-file name sat in a `truncate` span (nowrap), which was right for a fixed-height masthead row and is
  forbidden for a status line in the popover. The fix was not to loosen the check: the name box is gone and a long name wraps
  (`break-words` splits even an unbroken 300-character name), so the whole file name is visible. The "300-character file name" check
  now asserts the line wraps, nothing in it is nowrap or clipped, its right edge is inside the panel, "modified ..." is still the end of
  its text and the tooltip holds all of it. The same check also files any line it does not recognise under the role "storage-probe", so
  the stamp would have stood in for a missing real storage line; it now has its own role, `feed-stamp`.
- **Contrast** of the stamp's colours on the white (dark: gray-800) panel, computed from Tailwind's default palette: gray-600 7.56:1 and
  gray-400 5.78:1; amber-800 7.09:1 and amber-300 10.18:1. `tests/check_color_contrast.js` on the testing build: 364 / 364 (one pair
  fewer than before: the toggle's button).
- **A harness trap, not a code fault.** A first full run of the testing target with the runner's default 240 s result wait ended in
  "Suite did not finish within 240000ms". The 2.5 build needs the raised wait that `scripts/run_ci_locally.js` sets
  (`BF_RESULT_POLL_TIMEOUT_MS=1200000`); a hand-run of the runner on that target must set it too (docs/TESTING.md, "Slow machines").
- **Results:** `BF_APP_HTML=Booking_flash_report_na_2.5_TESTING.html node tests/ci_regression_runner.js` (with the raised wait):
  569 / 569 executed (pin 569), 0 failures, tripwires `Feed_Stamp` 27, `Offline_Cache` 75, `Feed_Canary` 32 passing.
- **Full local gate (`node scripts/run_ci_locally.js`, 2026-10-08):** exit 0, all 29 jobs passed. Executed checks: main 391 / 391 on the source
  and on `dist/index.html` (neither file changed; the shared test file did), testing-2.5 569 / 569 on the first attempt (no retry used).
  Both row-highlight budgets within limits; `dist/` still up to date (the main file was not touched).
- **Deliberate-break run (a throwaway git worktree, never committed):** with `<FeedStamp>` rendered under the title again as well as in
  Settings, the testing target executed 569 and passed 546, exactly 23 failures: 21 in `Feed_Stamp` (including "Not under the title" and the
  old-preference check; every stamp read reports `count: 2`, one under the title and one in the panel) and 2 in `Offline_Cache` (the two
  checks that assert exactly one stamp). No other suite failed. So the new checks do go red on the placement they exist to forbid.

## 2026-10-09: Sector Summary Dry / Reefer cargo slicer (D35; main 391 unchanged, testing-2.5 589 -> 606; its right-table half was replaced by D37 the same day)

Kevin, with a screenshot of the Booking Flash table with its "RFR Max LDN" column circled: "when Reefer is selected in isolation on the Sector Summary tab, the AVG Max Laden should revert to the
avg of the overall RFR Max LDN for that lane. AVG Booking = the AVG Reefer TEU for that lane and so on. The sector allocations are technically inclusive of Dry & Reefer so that number can remain the same, but
the AVG Booking should be Reefer specific. So, I thinking we need to break it out in two lines per POD, one Reefer and one Dry, then have the report aggregate for the combined total when both Dry & reefer
are selected together." and "The open space field is not really going to make sense if Reefer is selected, but I'll let them know about that nuance." Written into [DECISIONS.md D35](DECISIONS.md) before building.
It supersedes the Sector Summary clause of D32 ("not built", closed on Kevin's "if there's no refer columns in the source data, then there is no refer in it"): that held for the right-hand table, whose Sheet
has no cargo column, and Kevin's answer is the way to get one; it did not hold for the left-hand table, whose rows are the export rows that already carry the reefer columns. Built in the 2.5 testing build only
(a feature, D11); the production file and `dist/` are untouched.

- **Measured before building (8/12 export, `openpyxl`; the D35 figures, re-measured on 2026-10-09 and all reproduced):** 223 Past-4-Week rows, 222 after the EXE/EXW drop, 25 lanes. A lane's Laden TEU over
  its summed `Trade Summary Avg Booking` is 4 in 12 lanes, 3 in 9 (AL5, AN2, AT3, EC4, FP2, PN3, PS7, PS8, VSE), 2 in 3 (AT4, EMA, WIN) and 5 in 1 (PS4; AT4: Laden 706, Avg Booking 355). So the upstream measure
  cannot be rebuilt from the rows and the reefer figure must be a share of it. No row has more reefer than Laden TEU, none has zero Laden and some reefer, none has Laden above zero and an Avg Booking of 0, and
  the 15 VMS placeholder rows carry no reefer capacity or booking. With reefer = Avg Booking x (reefer TEU / Laden TEU): all 25 lanes reconcile, Reefer + Dry = Total with no gap (3,118.46 + 21,351.54 = 24,470).
- **The near-miss worth remembering: the obvious "RFR Max LDN" would have been wrong.** The raw column `RFR Max Laden TEU` is per port (PN1 YMKT0113W reads 100 at one leg and 400 at the next), while the Booking
  Flash "RFR Max LDN" Kevin circled is `rfrBsaTeuRfMax` (`Measures BSA TEU RF`) after aggregation (the comment above `row.rfrMaxLdn = rfrBsaTeuRfMaxNum`; D32 had already made the same correction once). PN1,
  reefer average booking 366.79: against the per-row mean of the raw column (211.25) that is 174% utilization, which the table paints red as over capacity; against the mean of the four vessels' `rfrBsaTeuRfMax`
  (460, 402, 346 and 680, mean 472) it is 78%. Both figures come straight from the export, so a check that only compared the table with "the data" could not have told them apart: what separates them is
  knowing which column the circled cell is.
- **The sector Sheet, fetched 2026-10-09 (earlier that day):** 41 rows, the same ten headers as `tests/fixtures/sector_data_2026-09-16.csv`, no cargo column. So the right table's new branch had never run on a real Sheet
  and was verified only against a synthetic one. **Superseded the same day: the Sheet then changed to DRY / RFR blocks, the right-table code and the synthetic Sheet were replaced; see "the sector Sheet's two header rows" below (D37).**
- **A statement in D35 corrected while documenting it.** D35 says the app's Open Space can differ by 1 from the Sheet's "where the Sheet rounds Average Booking before subtracting". It is the other way round:
  the Sheet subtracts the unrounded average and rounds the result (FRFOS: Laden 135 over 2 voyages = 67.5; Average Booking 68; Open Space 70 - 67.5 = 2.5 -> 3), and the app subtracts the displayed, rounded
  one (70 - 68 = 2). Measured: 5 of 42 rows of the 2026-09-16 sample (AT3 GBSOU, AT4 ESVLC, FRFOS and ITSPE, EC3 LKCMB) and 2 of 41 of the 2026-10-09 Sheet, every one a half-TEU average with the Sheet 1
  higher. The figures D35 quotes are right; only the stated cause was not. The CODE_NOTES and DATA_ARCHITECTURE entries carry the corrected cause.
- **What was built.** Chips shared with Trade Summary (one `selectedCargo`). Left table: with one chip, `sectorLeftRows` hands the pivot copies of the Past-4-Week rows with `scAvgBkg` and `scAvgMax`
  (Reefer: Avg Booking x reefer share and the lane's mean vessel-level reefer capacity; Dry: Avg Booking x dry share and the lane's own Avg Max Laden); with neither or both it hands over `past4WeekRows` itself.
  Right table (as first built, replaced by D37 the same day): `groupSectorByCargo` read two lines per POD when the Sheet had a recognised `Cargo Nature` (or `Cargo`, `Cargo Type`) value; without such a column nothing
  changed in any chip state, and a one-chip note said so. Why: CODE_NOTES.md, "Sector Summary Dry / Reefer cargo slicer";
  the Sheet layout: DATA_ARCHITECTURE.md, "Sector Sheet: the two layouts the app reads" (rewritten by D37).
- **Tests (new suite `Sector_Cargo`, testing-2.5 only; main stays 391).** The left table is compared cell by cell (25 lanes x 4 numbers) in neither / both, Reefer and Dry against a ground truth made OUTSIDE the
  app (Python and `openpyxl` on the sample xlsx, exact arithmetic; PN1 reads 472 / 367 / -105 / 78% in Reefer), plus Reefer + Dry = the total per lane, the labels, and the note. Today's real Sheet: the right table is
  identical to the Sheet's own numbers in every chip state. The right table's new branch ran on one isolated instance booted on a SYNTHETIC two-lines-per-POD Sheet (as first built; D37 replaced it the same day with the real
  Sheet's DRY / RFR blocks, `tests/fixtures/sector_data_two_header_2026-10-09.csv`). Trade Summary untouched and the choice shared between the tabs. A first full run, with the runner pinned one short of the suite's real size, executed one more check than pinned and
  passed every one (the tripwire is a record too); the pin was corrected, which is the executed-check-count rule doing its job. Two fix-removed (red) runs on the testing build, each reverted afterwards:
  (A) the Reefer "Avg Max Laden" taken as the lane's largest vessel instead of the mean over its vessels, and (B) the right table's Sector Alloc summed over a POD's two lines instead of the largest; each failed
  exactly four `Sector_Cargo` checks and nothing else, and the restored build ran 606/606 again.
  A later full gate (the Report Card Total's, same day) failed this suite's chip-contract check once, on the first attempt (617/618), and passed it on the runner's retry (618/618): after Clear Filters the check
  slept 250 ms and then read one lane where 25 are expected, because the Lane chip unpresses a render before the left table is rebuilt. The same check had passed in the two earlier full gates and in an isolated
  run, which is the signature of a race, not a defect in the app. It now waits for the 25 lanes to be back (8 s) before it reads; if they never return the wait times out and the assertion still fails.
- **What stays open.** (1) The header name and layout are the app's proposal and nobody has confirmed them with the Sheet's owner (UNCONFIRMED); until the Sheet has the lines Kevin sees reefer on the left table only.
  (2) Production behaviour of the right table with real lines is unverified, and its behaviour if the owner splits the allocation between the lines (the app takes the larger half) is a guess. (3) Open Space under
  Reefer alone is the whole allocation less reefer booking: Kevin knows it is not meaningful without a reefer sub-allocation. (4) "Against total capacity" for Sector Summary, which Kevin did not ask for, is a
  one-line addition (CODE_NOTES). (5) Both = the sum of two rounded lines can sit 1 off a single combined line: expected, not measurable until a real two-line Sheet exists. Client-side only, so there is no
  `/exec` checklist for this change.

## 2026-10-09: the sector Sheet's two header rows silently emptied Sector Summary's right-hand table (D37; main 391 -> 398, testing-2.5 618 -> 624)

- **The incident.** Kevin sent a screenshot of the updated sector Google Sheet ("it has two rows of labels like this"): a `DRY` block and an `RFR` block side by side, two heading rows. The app reads that Sheet with
  `sheet_to_json`, which takes the first row as the header. The first row is now the block labels, so every line had no `Vessel 1st Sub Trade`, the gate against the export's Sub Trade | Lane pairs dropped all of
  them, and the right-hand table of Sector Summary came up EMPTY. No banner, no console error, because the fetch had succeeded and the parse had produced rows; the left table (built from the export) looked normal, so
  the tab looked alive. It was found by fetching the published CSV and reading the code, then reproduced in a browser on the UNFIXED production file (the new suite: 0 rows, no banner, no error), so it hit production and
  not only the 2.5 build.
- **Why no existing check could see it.** The runner pins the Sheet to `sector_data_2026-09-16.csv` (one header row), so every suite kept reading the shape the app already handled. A pinned fixture can only fail when
  the fixture changes; the live Sheet changing underneath a green gate is exactly what pinning hides. What was missing was (1) a committed copy of the new shape and a suite that reads it, and (2) the app saying so when it
  cannot read the Sheet. Both are added: `tests/fixtures/sector_data_two_header_2026-10-09.csv` (the real Sheet), `Sector_Layout` (both targets) and `tests/check_sector_layout.js`, and `readSectorSheet` refuses an
  unrecognised layout with a sentence that reaches the existing banner. The one-header fixture stays pinned for everything else on purpose: the app must still read that layout too.
- **Measured before building:** the Sheet has 16 columns, 2 heading rows and 41 PODs; in each block Average Booking = round(Laden TEU / Voyage Count) and Open Space = round(max(0, allocation - Laden TEU / Voyage Count)); the DRY
  allocation is the whole POD's (41 of 41); the RFR allocation differs on two PODs (AT1 FRLEH 170 against 176, AT1 NLRTM 820 against 1,166); 14 PODs have no RFR figures; EMA GRPIR has an RFR allocation and nothing else. The new
  reader reproduces the old reader's rows on the old fixture exactly (42 rows x 7 values, 0 differences).
- **Two things the new checks found in the first version of the reader (fixed before it was committed):** (1) a deleted `RFR` label made the RFR columns inherit `DRY` from the left and read as a second, ignored set of
  DRY columns: no error, DRY numbers only. A labelled block with the same heading twice is now refused. (2) A row that was not an array threw a `TypeError` out of the reader; rows are now read defensively.
- **Fix-removed runs (all recorded failing, then restored):** the browser suite on the unfixed production file failed 6 of its 7 records (the passing one is the "usual look" guard); `Sector_Layout` on a copy whose reader prefers
  the `MCT Sector Allocation` column failed the whole-POD numbers and the anchors (EMA GRPIR 115 instead of 99); `Sector_Cargo` with the chips ignoring the blocks failed exactly the Reefer, Dry and across-modes checks; the
  headless check failed 5, 3, 1 and 20 of its 34 checks on four mutations (MCT preferred; bookings rounded before adding; the duplicate-heading guard removed; the first row taken as the header again).
- **A wrong assumption in my own first suite.** It asserted the right table lists PODs "in the Sheet's order". The pivot orders them by its own lane order (`SECTOR_RIGHT_ORDER`); the check now asserts all 41, each once.
- **The tall layout is gone.** D35's reader for two lines per POD in a `Cargo Nature` column, its synthetic Sheet (every number invented) and the generator were deleted with the checks that depended on them; 6 checks on the
  invented Sheet became 5 on the real one, and the "other names for the cargo column" check went with its layout. Lesson recorded: D35 built a reader for a layout nobody had agreed, tested it on an invented Sheet, and
  the Sheet's owner built a different one. The honest label on that work ("UNCONFIRMED, synthetic") was right; the cost was a rewrite, and a real sample first would have avoided it.
- **Counts.** Main 391 -> 398: `Sector_Layout` 7 (6 checks + its tripwire). Testing-2.5 618 -> 624: the same 7, and `Sector_Cargo` 17 -> 16. Re-derived from real runs of both targets.

## 2026-10-09: Selection Report Card Total row (D36; main 391 unchanged, testing-2.5 606 -> 618)

Kevin, with a screenshot of the POL Booking Flash Report Card (three rows selected): "Can we add a total row to the report card aggregating just the numerical values of all the selections made? Steve had
mentioned, he missed having the ability to highlight a column of values and see the total can be done in Excel. This would give the same thing, basically." Written into [DECISIONS.md D36](DECISIONS.md)
before building. A feature, so the 2.5 testing build only (D11); the production file and `dist/` are untouched. Both exports scrape the card's `<table>`, so the Total row reaches the CSV and Excel files
with no export change.

- **Measured before building (8/12 export, node and the `xlsx` package):** on Booking Flash a plain column sum is exact (of 375 VVDs only `VMS` maps to more than one Detail row, and its cells are blank). On
  POL it is not: BSA TEU repeats the vessel's value on every leg (332 of 334 multi-leg VVDs), so highlighting the four POLs of POHT0076E and summing would show 4 x 2,686 = 10,744. The decision follows: BSA
  TEU counts once per vessel, the percent columns stay blank, everything else adds. POL Max Laden is a partition of the vessel's Max Laden on the vessels checked (YMKT0113W 900 + 1,200 = 2,100 = its Booking
  Flash Max LDN) but not on every vessel (12 of 333 exceed), so it is a cross-check, not a rule.
- **Planned Mty and Actual Mty:** 0 on every row of the export, so whether they repeat per vessel or differ per leg was not known when this shipped; they were summed. Settled the same day: Kevin, "Planned and Actual Mty are per-POL", so summing is right and nothing changed in the code.
- **Tests (new suite `Report_Card_Total`, testing-2.5 only; main stays 391).** Two oracles that are not the app's own total: every column against the sum of the cells shown above it, and literal anchors made
  outside the app from the workbook (YMKT0113W + POHT0076E: Booking Flash 4,500 / 2,602 / (-1,898) / 23 / 0; POL BSA 5,967, POL Max Laden 4,500, Discharge 5,882, Current Laden 2,602; after three legs are
  un-highlighted 5,967 / 2,750 / 4,134 / 1,355). Two fix-removed (red) runs on the testing build, each restored byte for byte afterwards: (A) the once-per-vessel rule dropped failed exactly the 3 POL checks
  that read BSA TEU; (B) the Short_Fall total formatted as a plain number instead of the accounting format failed exactly the 2 Booking Flash checks that read it.
- **Two bugs in my own first draft of the suite, both found by running it against the real page:** the POL cell holds the terminal-suffixed code (`USTIW02`), not the port code, so rows are matched by prefix;
  and a VMS row keeps its lane and sales week, which hold digits, so "its cells are blank" has to look at the measure columns only.
- **Process note.** A single suite takes about 8.5 minutes inside the full testing run. The suite was written against a scratch copy of the runner that injects only the prelude, the shared harness and the
  new suite (about 1.5 minutes per iteration), then wired into the real file. Separately: a full-gate log that stops growing is not "still running". `pgrep -f run_ci_locally` also matches the shell that
  runs it, so check `ps -eo etime,cmd | grep '[n]ode scripts/run_ci_locally'` and the log's modification time; the first gate of this session had died silently an hour before it was noticed.
- **What stays open.** (1) Planned / Actual Mty: settled, above; their totals are still only ever checked as 0, because the export holds no non-zero row. (2) Hidden-column states (`picHidden`, `statusHidden`, `polStatusHidden`) are covered only in their default state: the tests assert one Total cell per
  header cell, not for each combination of hidden columns. (3) No Average / Count / Min / Max beside the Sum. Client-side only, so there is no `/exec` checklist for this change.

## 2026-10-09: POL Booking Flash groups a vessel's legs together within a sailing week (D39; main 391 unchanged, testing-2.5 589 -> 600 on its own base, 618 -> 629 once merged with D35 and D36)

Kevin, with a screenshot of the POL Booking Flash table: "Can we have the report group the vessels together when we have multiple VVD's in the same sailing week? Rather than by individual
ETD. So, first sort by Sales Week then VVD then ETD?" The D39 entry was written during the build, after the comparator and the suite existed and before anything was pushed; AGENTS.md asks for it before building, so this one did not follow that rule. Built in the 2.5 testing build only (a feature, D11): the POL comparator went from Sale Week, Coastal
ETD, VVD, POL to Sale Week, VVD, Coastal ETD, POL, with a "no vessel yet" row kept last in its week.

- **Which table:** the screenshot's columns (Service, Sales Week, Coastal ETD, Port Cut, Status, VVD, Vessel Name, POL) are POL Booking Flash. Booking Flash has one row per VVD, so it has nothing
  to split; it was measured (0 of 439 positions move) and left alone, and a check pins that.
- **Measured first, through the rendered tables (8/12 export, a throwaway reader, rowSpan cells carried down):** my first reading of the tables was wrong twice. Trade, Sub Trade and Service are
  `rowSpan` cells, so reading from the row's end left them blank and merged every lane's week into one block; and counting the scattered `VMS` placeholder rows as "a vessel split apart" gave 15 splits
  where the true figure is 1. With lanes carried down and VMS excluded: 434 lane-weeks, 5 with two real vessels, 1 split by the old order (`PS4 2026/W27`), all 65 VMS rows alone in their week.
- **What the order as asked costs, found by comparing the before and after dumps:** 10 row positions move: 2 are the `PS4` fix, and 8 are `EC3 2026/W36`, where ONE MONACO (VVD `NCMT0031W`, sails
  9/7) now sits above ONE GRUS (`ONGT0031W`, sails 8/25) because N sorts before O. They were never interleaved. Ordering the blocks by each vessel's earliest ETD instead moves 2 positions (measured
  on the same dump). Built as asked, with the alternative put to Kevin in D39.
- **Suite (`POL_Vvd_Order`, testing-2.5 only, 9 checks + tripwire):** graded against the rule written in the suite, never by calling the app's comparator. Setup recomputes the old order from the
  same rows to prove the fixture holds a vessel it splits. Two of the nine failed on their first run, and both were the suite's reading, not the app: the `[NO N.A. CALL] ` tag the app puts in front of
  4 Sales Week cells (the same tag `Column_Filters` strips) made 4 weeks parse as "no week" and read as out of order; and a VMS placeholder keeps its Coastal ETD cell filled (the suite's older
  comment says so), so its expected text was wrong although its position, last, was right. Fixed in the suite; the order the app produced did not change.
- **Red runs (a throwaway worktree each, the real file name so the target is testing-2.5):** (1) The original sort (HEAD's file) failed exactly 4 of the 9: "never split", "vessels follow VVD order", the `PS4 2026/W27` known answer and the VMS check; the 5 that guard what must not move (legs in ETD order inside a vessel, the PAROD leg last, weeks and spacer rows, Booking Flash, the tripwire) stayed green, 595 / 599, nothing failed outside the suite. (2) The new sort with only the no-vessel line removed failed exactly 1: the VMS check, 598 / 599. Both ran at once (about 20 minutes each), which is fine for red runs and not for a verdict.
- **Not tested:** the Excel export of the POL table. It is built from the same sorted rows the table renders (`polExportBuilderRef` / `buildExportTbody`), so it follows the new order by construction;
  no check opens the exported workbook. The comparator is not slower: sorting 9,232 synthetic rows took 23 ms against 45 ms (median of 7, noisy while other runs shared the CPU).
- **Results, before D35 and D36 landed:** testing-2.5 599 / 599 in the full local gate (`node scripts/run_ci_locally.js`, 2026-10-09, on the tree merged with `origin/main` of that moment, first attempt, 445 s), with the executed count equal to the pin and all 10 `POL_Vvd_Order` records passing; main 391 / 391 and `dist/index.html` 391 / 391, neither runs the new suite. Every blocking job passed, both row-highlight budgets included, and the drift check and "Deployable build is up to date" are green without a refresh (the production file and `dist/` are untouched). After the renumber to D39 (a comment and a number) the fast gate and the testing-build suite were run again on the final tree: the first run read 598 / 599, one failure outside the new suite, `Apps_Script_Team_Features` "Notes: (control) a click on a plain cell of the same row does highlight it, and a second click clears it" (0 rows highlighted after the click; it passed in the gate's run before and all 10 new records passed); the single re-run read 599 / 599. A different outcome on identical code is the timing-noise class (a click read before its state landed), not a change of behaviour; it is recorded here, not dropped.
- **After #213 landed D35 and D36 on `main` (the branch went merge-conflicted; resolved 2026-10-09):** the conflicts were only the shared bookkeeping (the runner's pin and its comments, TESTING.md's counts and suite rows, the DECISIONS and CHECK_HISTORY entries, where both sides appended); the app file and the regression suite merged without one. The pin became 628 (589 + 17 + 12 + 10), taken from a real run of the merged tree: testing-2.5 628 / 628 on the gate's retry, `dist/index.html` 391 / 391, the informational source run 390 / 391, every blocking job passed. **Interaction between the two sessions' logic, read rather than assumed:** #213's Total row on POL Booking Flash (`reportCardTotals`) sums the selected rows and counts BSA TEU once per VVD through a `Map` keyed by VVD with `Math.max`, all of it commutative, so it cannot depend on the row order this change alters; the order only decides which row of the card is listed first. Its `Report_Card_Total` suite (12 records) and `Sector_Cargo` (17) ran on the merged tree with this sort and had no failures in any attempt, as did `POL_Vvd_Order` (10). A fix-removed run was not made: there is no shared state to revert, and reverting the sort cannot make an order-independent sum fail. **Misses, none in a suite either change added:** the source run, `Apps_Script_Team_Features` "Notes: (control) a click on a plain cell of the same row does highlight it, and a second click clears it" (1 row still highlighted after the second click; the earlier solo run missed the same check the other way, 0 after the first click: it clicks, sleeps a fixed 450 ms and reads, while the app defers a row click by 300 ms, so a loaded machine reads before the deferral lands); and the testing build's first attempt, a different check in the same suite, "Fallback: getDataFeed answered {ok:false,\"busy\"} for both feeds ..." (two getDataFeed calls per feed where it expects one: a refresh timer fired during a slow boot). Different checks and different values each time, passes on the retry: the timing-noise class, recorded, not dropped. Not fixed here (not this change's code); a patch if wanted: the Notes control waits on the highlight count with `waitFor` instead of a fixed sleep.
- **Block order changed to the vessel's earliest ETD (Kevin, same day: "ordered by each vessel's earliest ETD"; then "you can merge when ready").** Everything above describes the first build, which ordered the vessel groups A to Z by VVD and
  was measured to move 10 positions. The final order moves 2 (both in `PS4 2026/W27`), measured the same way (a before / after dump of the rendered table on the pinned 8/12 data: the same 964 rows, 0 split vessels,
  `EC3 2026/W36` unchanged); it differs from the A to Z build in 11 positions. **How it is built:** a sort comparator only sees two rows, so it cannot know "the earliest ETD of a's vessel" by itself; the
  earliest Coastal ETD of each vessel in each lane's week is worked out once, before the sort, into a `Map` keyed by Trade, Sub Trade, Service, Sale Week and VVD, and the comparator looks it up (VVD A to Z breaks a tie).
  **Suite (`POL_Vvd_Order`, 9 -> 10 checks + tripwire, 599 -> 600 on its own base, 628 -> 629 merged):** the "vessels follow VVD order" check asserted the old rule and was rewritten to the new one
  (it now grades every one of the 5 two-vessel weeks against "first sailing, then VVD" and pins `EC3 2026/W36` as `ONGT0031W`, `NCMT0031W`); the `PS4 2026/W27` known answer was reordered; and one check was added, because the
  real data cannot test the tie-break: none of the 5 two-vessel weeks has two vessels that first sail on the same day, so the VVD tie-break would have shipped as untested code. The new check boots a copy of the fixture
  in which YM UNIFORMITY's 7/15 USOAK08 leg is re-labelled `AAAT0001W`, so it ties YM UNICORN's 7/15 USLAX08, and expects `YUOT0084W 7/12`, `AAAT0001W 7/15`, `YUNT0080W 7/15`. USLAX08 sorts ahead of USOAK08, so a tie broken by
  port instead of VVD would read the other way, and the check tells the two apart. The copy-the-fixture code the VMS check already had became a shared helper (`fixtureCopy`) for the two.
  **Red runs, on the final suite (a throwaway worktree each, the real file name so the target is testing-2.5; run one at a time):** (1) The A to Z comparator (this branch's HEAD file) with the final suite failed exactly 3 of the 10:
  the first-sailing order check (it printed `EC3 2026/W36` as `NCMT0031W, ONGT0031W` and `PS4 2026/W27` as `YUNT0080W, YUOT0084W`), the `PS4` known answer, and the tie-break check (`moved` 1, so the fixture edit took,
  and it read `AAAT0001W, YUNT0080W, YUOT0084W`); the 7 other checks, among them "never split", the PAROD leg and the VMS check, and the tripwire stayed green, 626 / 629, nothing failed outside the suite.
  (2) The final comparator with only the VVD tie-break reversed (Z to A) failed exactly 1: the tie-break check (it read `YUOT0084W, YUNT0080W, AAAT0001W`), 628 / 629. Every check on the real data stayed green there, which
  is the point of building the tie: without it that line was reachable by no check. **Environment:** the first attempt at the first red run never started the browser: this repo's Playwright asks for a newer Chromium revision
  than the one preinstalled in the sandbox, which `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` (the runner's documented override) fixes; the crashed runner process was still alive afterwards and had to be killed.
- **Results of the earliest-ETD build (2026-10-09), before #216:** the full local gate (`node scripts/run_ci_locally.js`, run alone) passed every blocking job: main 391 / 391, `dist/index.html` 391 / 391, testing-2.5
  629 / 629 on the first attempt with the executed count equal to the pin and all 11 `POL_Vvd_Order` records passing, both row-highlight budgets, and the drift check and "Deployable build is up to date" green without a
  refresh (the production file and `dist/` are untouched by this change). No miss in any suite in that run; the timing-noise checks recorded above did not recur.
- **After #216 landed (the sector Sheet's two header rows, D37) and this decision became D39:** `main` moved while this was being tested, and #216 had taken the number D37, so this entry was renumbered to D39 (the unmerged
  `claude/compassionate-maxwell-irz3vm` also holds D37 and D38, so D39 is free in all three places). The conflicts were again only shared bookkeeping (the runner's pins and notes, TESTING.md's counts and suite rows, DECISIONS.md);
  the app file and the regression suite merged without one. The pins became main 398 (unchanged by this change) and testing-2.5 635 = 624 + 11, taken from a real run of the merged tree: main 398 / 398, `dist/index.html`
  398 / 398, testing-2.5 635 / 635 on the first attempt, every blocking job passed, no failed check anywhere in the log. **Interaction with #216, read rather than assumed:** #216's 333 lines in the testing build are all the sector
  Sheet reader and the Dry / Reefer chips on Sector Summary; none of them mentions `polSpannedRows`, `polShownRows`, `processedData`, `filteredRawRows` or `compareEtd`, and it shares no fixture with `POL_Vvd_Order` (that suite
  reads the 8/12 export, #216's suites the two-header sector Sheet). A fix-removed run on the merged tree was not made: there is no shared state to revert, and reverting the sort cannot make a sector-Sheet check fail.

## 2026-10-09: the quick filter boxes find what a column shows (D40; main 398 -> 405, testing-2.5 635 -> 642)

Kevin: "Fix the quick filter boxes on the 14 dead columns -- why are they dead?" Written into D40 before building. A bug in existing behaviour, so the fix is in the production file
and the same text is in the 2.5 testing build (the shared block is byte-identical in both; the drift fixture was refreshed after checking that).

- **The count was wrong, in both directions.** The "14" came from typing one sample value per column. Measured per row (every cell's own shown text typed into the box and tested against the
  stored per-leg text, 374 Booking Flash vessels and 899 POL rows), 26 Booking Flash and 6 POL columns fail on at least one row: 6 Booking Flash columns find nothing (the key does not
  exist on the raw row), 20 find 3% to 96% of vessels (summed or replaced across legs; Current Laden 99 of 374, RFR Max LDN 11), and 6 POL columns find 15% to 91% (stored `0.76` shows `76%`;
  stored `5:00` shows `05:00`). The one-sample probe also called POL Voyage Remarks dead, which it never was: it typed a multi-line remark into a one-line box. Corrected in D33's entry above.
- **Why a column passed the sample and failed the rows.** The box ignores `, % ( )`, so typing `87%` finds a stored `0.87`; `60%`, `100%`, `271%` do not match `0.6`, `1`, `2.71`. A
  sample that happened to be an 87% looked healthy.
- **Fix-removed (red) runs.** *On the original branch (PR #211, base 589, a throwaway git worktree, never committed):* the new suite against the unfixed testing build executed 596,
  passed 592, exactly 4 failures, all in `Quick_Filter_Shown` (the 6, the 20 and the POL 6 columns, and the "narrows its own table and nothing else" check, which finds the table empty);
  its Setup, the stored-text-column check (Lane) and its tripwire passed on the unfixed app, as they should: they pin what must not change. *On this tree (the fix carried onto main
  `b458309`, scratch worktree, never committed, the two app files put back to main's):* the production source executed 405 (the pin) and passed 400. The 5 failures are the same 4
  `Quick_Filter_Shown` checks plus one `Apps_Script_Team_Features` check, "Notes: (control) a click on a plain cell of the same row does highlight it, and a second click clears it"
  (`highlightedAfterPlain: 0`). That one is the fixed-sleep timing miss already recorded in the 2026-10-09 POL vessel-order entry above (the check sleeps 450 ms, the app defers a row
  click by 300 ms); it passed in the other three runs of that suite on the fixed tree (source, dist and testing build), and it clicks a row highlight, which the fix does not touch.
  Reading it as noise is a judgement from those four runs, not a proof; the 4 `Quick_Filter_Shown` failures are the evidence that the new checks see the bug.
  The testing build, same way (the two app files put back to main's, run before #215 was merged in): executed 631 (the pin), passed 627, exactly 4 failures, the same 4
  `Quick_Filter_Shown` checks and no other suite.
- **Green, this tree:** production source 405/405 (278 s) and `dist/index.html` 405/405 (272 s), each run with `BF_RESULT_POLL_TIMEOUT_MS=1200000`; the testing build 631/631 in the full
  local gate (before #215 landed, 624 + 7). After #215 the pins are 405 and 642, derived as main's verified 398 and 635 plus these 7 and confirmed by the landing gate's stamp.
- **The 240 s window is a harness limit, not a bug (found on the first full gate).** `scripts/run_ci_locally.js` failed only the two production regression jobs, "Suite did not finish
  within 240000ms", stopped at the same check (396 of 405, after three `Quick_Filter_Shown` checks) in both. They are not hung: with the window CI uses they finish in about 275 s here. The
  runner's own comment says the limit is a hang detector, not a performance budget; `ci.yml` sets 1200000 for these jobs and the local gate widens it only for the testing-build job. Export
  `BF_RESULT_POLL_TIMEOUT_MS=1200000` for a whole gate or `land.js` run (both pass the environment down) when the machine is slow. Not changed here.
- **What the fix does not do (D40, stated plainly):** a box on one of the 32 columns narrows the table it sits above and nothing else; Trade Summary, Sector Summary, Compare, Analyze and
  the notes lists read the per-leg rows. The check compares Trade Summary and Sector Summary before and after, and that a stored-text column (Lane) still narrows the summaries.

## 2026-10-11: the 2.5 build is promoted to production, and the eight review findings on #198-#217 are fixed (D42, D43; one target, 642 -> 648)

- **One target.** Kevin: "Lets promote 2.5 testing to production and lets fix those 8 findings". The 2.5 testing build became
  `Booking_flash_report_na_2.5_WORKING_PRO_ONLY.html`; the `testing-2.5` runner target, the suite's `WAVE3` gating, the drift check and the two
  testing-build CI jobs went with it. Every suite runs on the main file and `dist/`. The pin is 642 at the promotion (the testing target's last
  number) and 648 with this PR's new checks.
- **Baseline before any change (full local gate on `main` at Land #217):** the 2.5 build 642/642; the main file's source and `dist/` runs both
  stopped at the runner's 240 s ceiling ("Suite did not finish within 240000ms"), not on a check. So the default ceiling is now 1,200 s, what the
  2.5 job always used: the main runs now carry its ~240 extra checks. The baseline source run also logged the known `Apps_Script_Team_Features`
  "Notes: (control) a click on a plain cell..." timing miss (see the 2026-10-09 D40 entry) before it timed out.
- **A check that had never seen the 2.5 file.** `tests/check_compare_kpis.js` ran only against the main file. On the promoted file it failed:
  D33's column-filter code, three JSX components, had been put inside the "shared capacity helpers" marker block, which the check runs without a
  JSX transform. The section was moved below the END marker unchanged. It is the cost of a check that runs on one target only: whatever was
  added to the other target was never put in front of it.
- **Fix-removed (red) run.** A throwaway copy of the fixed file with fixes 1, 2 and 7 put back the way they were, run through the whole suite:
  executed 648 (the pin), passed 645, the 3 failures are exactly the three new browser checks (`Column_Filters` Condition vs Values,
  `POL_Vvd_Order` filter hides the first leg, `POL_Autofit_Filters` width after clearing). `tests/check_sector_layout.js` against the pre-fix file:
  42 run, the 6 new checks fail and nothing else. Finding 8 is guarded by `POL_Vvd_Order`'s existing order checks; finding 3 by a measurement
  (a counted copy of each file: typing "1,2" in a computed-column box re-filtered every raw row 3 times before, 0 after).
- **What the red run taught.** Finding 1's stale width does not clip: the table's automatic layout still widens a column to its unwrapped content,
  so the column came back 5 px short of its fitted width (Voyage Remarks 14,463 against 14,468 px), the auto-fit padding lost. The width check
  sees that (1 px tolerance); the overflow check passes on both files and is kept as a guard on the visible symptom. The first version of the
  `Column_Filters` check failed on the red copy by throwing (the suite's `clickOk` waits for the filter bar, which the bug removes); it now
  presses OK directly and records the state.
- **The first full gate on this tree failed one job, correctly.** `tests/check_date_timezone_safety.js` cuts `parseKnownDate` through `compareEtd` out
  of the app by brace-walking and runs them under four timezones; fix 8 made `compareEtd` call two new helpers defined right after it, so the cut
  ended too early ("compareEtdKeys is not defined"). The block now ends at `compareEtdKeys`, so the new fast path runs under the same timezones.
- **Green, this tree:** full local gate, regression suite source 648/648 (575 s) and `dist/index.html` 648/648 (571 s), the basic build and both
  highlight budgets; after the timezone-check fix, every non-browser job again (`--fast`, all pass).

## 2026-10-11: selecting a card in Analyze scopes the trend chart and the Overall Snapshot tiles (D44; 648 -> 660)

- **Report:** Kevin, with a screenshot of POL Performance Summary: "this graph doesn't seem to change when you select different POL or Lanes".
- **Measured before building (8-12 fixture, source file, headless Chromium):** the chart already followed the main-page Yard and Lane slicers while the window
  was open (POL tab: W27-W30 Max Laden 57,213 / 50,878 / 55,115 / 48,164 became 1,975 / 3,900 / 1,030 / 3,595 under one Yard chip). A click on a card inside the
  window changed nothing: chart and tiles were identical before and after cards 2 and 3, on both tabs. So the bug was a card selecting nothing, not a broken slicer path.
- **Built:** what Kevin chose out of three options (chart alone / chart and tiles / no change, label only) is in D44. `analysisView` re-aggregates the selected group's sailings through
  the same `summarizeSailingGroups` and `buildWeeklySeries` the whole view uses.
- **Checks (`checkCardScopesChart`, 6 per Analyze suite, 12 in all):** nothing selected = whole view; tiles equal the card; title / badge / note name the card; chart differs from the whole
  view; the cards' per-week Max Laden adds up to the whole chart; pressing the open card restores the whole view exactly. Each runs over every card (28 Lane, 30 POL on the fixture).
  Measured by hand before the suite existed: the sum rebuilds the whole chart exactly on every week of both tabs (W27 57,213 / 57,213, W28 52,128 / 52,128 ...).
- **Fix-removed (red) run, on a copy of HEAD's app file:** 656 / 660 on the first suite version (the naming and sum checks failed on both tabs), then 652 / 660 after one fix to the
  helper. That fix: a card that never became the selection skipped the tile and chart checks (`continue`), so they passed on the old file with no feature at all; it now fails all of them. The
  4 that still pass without the fix are the two "nothing selected" and the two "restores exactly" checks, which only guard the off state.
- **A check went stale, correctly:** `Analyze_BookingFlash` "Show in table ... the window stays open, its lane cards and Overall Snapshot are unchanged by the narrowing" failed on the first full run
  (overall 0 / 0 / 0 after, 42% / 25,147 before). "Show in table" is pressed from the lane's open list, and an open list now means the tiles are that card's (the lane was EXW, which has no capacity).
  The intent is that the narrowing does not change what the window reads, so the check now presses the open card again and compares the whole view read before with the whole view read after.
- **Review by a separate agent (adversarial, read-only):** the move of the weekly-series code is line-identical, and old (HEAD) and new apps produce byte-identical whole views (bars, tiles, cards, trend line, text) on
  POL Booking Flash, Booking Flash and Sector Summary in default, All and one-week modes; stale selections (card hidden by a Yard chip, week window changed, tab switch, Show in table + Undo) fall back to the whole
  view without a throw; the Excel file is identical with a card open and with none. Visual pass at 1400 and 390 px, light and dark: no overflow, clipping or contrast problem; the trend line crosses a bar label
  or the red "VMS" text in a couple of scoped views (not compared against the unscoped chart).
- **Weak spots, left as they are:** the sum check allows a difference of the card count (each bar shows a rounded value) and assumes the hidden `(blank)` and "NO N.A. CALL" groups add 0 capacity, true on the
  fixture; `summarizeSailingGroups` says `(blank)` can hold real capacity on other data, where that check could fail without an app bug. The title check is a prefix match (the exact-match badge check covers it). No
  suite check covers the fallback when the selected card disappears, the export staying whole, or Show in table + Undo while a card is open: those were verified by hand only.
- **Green, this tree:** `node scripts/run_ci_locally.js` (every job): regression suite source 660 / 660 (683 s) and `dist/index.html` 660 / 660 (626 s), per suite 44 and 31 for the Analyze suites, 24 of 24
  results for the new checks across the two runs; both highlight budgets, the basic build and every non-browser job pass.

## 2026-10-11: one production file -- leftovers of the testing build removed, checks that could not fail removed (660 -> 657)

- **Ask (Kevin, chat):** "make sure some of the tests are not duplicated and you know are only using the correct ones. Now that we don't have a test file, and we're just have one production file" (read as: the testing build).
- **How:** three read-only audits (leftovers of the two-build setup in executable files; duplicated or vacuous checks in the live suite and the headless scripts; stale wording in the current-state docs), then each
  finding was confirmed by reading or running it before anything was changed. Nothing was removed on an audit's say-so alone.
- **A check that silently skipped (fixed):** `tests/check_sector_layout.js` ran its two `blocks` checks only `if` the reader produced `blocks` (written for the build that had it). A copy of the app with the
  `blocks` line changed to `undefined` ran **40 checks, 0 failed, exit 0**. They now always run: the same copy gives 42 checks, 2 failed, exit 1; the real file 42 checks, 0 failed.
- **Dead branch removed:** "Hiding a field persists" also accepted a `bookingFlashViewPrefs` blob, written only by `Booking_flash_report_na_1.67_TESTING.html` (0 occurrences in the production file and `dist/`), under comments that
  contradicted each other. It now reads the one per-field key the app writes.
- **Checks removed because they could not fail (Sector_Summary 19 -> 16):**
  - The roll-up identity check, on both pivots (2): a Trade's total vs its Sub Trade totals rolled up, both summed from the same leaf array, so a dropped, doubled or mis-filed leaf was wrong on both sides. The suite's own
    comments called it "trivial by construction" and said the reference-workbook comparison right after it is the check that catches a wrong roll-up. The part that was not trivial, a non-empty table, is the
    'Setup: parsed at least one leaf' record beside each call.
  - 'Class B fix is not overbroad' (1): asserted that flagged cells lack the `#eef2fa` class, which the 'not stale' check above it already requires of every cell; despite its name it never asserted the flag.
- **A check that could not fail, rewritten (count unchanged):** OPUS_Schedule_Link 'A blank Coastal ETD cell renders no OPUS link icon' looked for a blank cell without an icon and then recorded `true`, so a blank cell that
  did get an icon was just not found and logged a SKIP. It now collects every Coastal ETD cell with no digit and fails if any holds an icon. On a copy of the app with that guard removed it fails on 69 of 69 cells
  (the old form could only have skipped); the run executed exactly the new pin, 657, with 655 passing (the other failure is the click-to-copy check, a side effect of the same patch).
- **Stale, fixed:** `check_resolve_app_html.js` named a deleted 2.0 file as "today's layout"; `perf_toggle_benchmark.js`'s usage line ran `git show` on that deleted file; `scripts/lib/shared.js` named a check that does not exist
  (`tests/check_testing_build_drift.js`); the runner's TARGETS block described a target system that is gone in the present tense (now marked retired history), and its header called the whole job non-blocking when only the source
  run is; docs/TESTING.md still labelled ten suites "(2.5 build)" and "both targets", gave the left-column total as 156 (it is 168, then 165 after this; 165 + 492 = 657, summed from the table) and Column_Filters / POL_Vvd_Order as
  20 / 11 (21 / 12), and had no row for `tests/check_basic_build.js`.
- **Looked like duplicates, kept on purpose:** Analyze_BookingFlash vs Analyze_POLBookingFlash (the same helper once per tab, 99 look-alike name pairs, all across tabs). The Preferences_Persistence Auto-Refresh asymmetry scenarios, which repeat
  another scenario's input but are each declared "its own isolated, independently-diagnosable scenario". Trade_Summary's Sub Trade and Trade "parsed to real values" checks (different groups). Sector_Layout's hand-read anchors (an oracle
  independent of the Python ground truth beside it). The headless scripts against their browser counterparts (different layers). The 'Compare' "Class F Peak Utilz" check never records (gated on a diff the fixtures do not have);
  left as a dead branch, no count depends on it.
- **Not a skipped-check risk after all:** several suites return early or skip when a column is missing, which looks silent, but a skipped check lowers the executed total and the pin (`EXPECTED_EXECUTED_CHECKS`) fails the run. Verified by the
  fix-removed run above: removing a feature changes which checks fail, never how many execute.
- **Left alone (not about the testing build):** README.md and `.github/pull_request_template.md` still describe the CI of an earlier date ("until this PR no CI", checks 1-3 blocking); dated narrative in CHECK_HISTORY, DECISIONS and the
  runner's history comments; the long history paragraph under TESTING.md's 'Current counts'; `booking_flash_report_na_Kevin_1.03` to `1.10_AUTO_REFRESH` and `Booking_flash_report_na_1.67_TESTING.html` in the repo root
  (nothing depends on them; the resolver ignores the testing one by name and the Kevin_* ones only lose to the higher version).
- **Green, this tree:** `node scripts/run_ci_locally.js` (every job): regression suite source 657 / 657 (648 s) and `dist/index.html` 657 / 657 (657 s); both highlight budgets, the basic build and every non-browser job pass.

## 2026-10-12: the Settings panel rebuilt as a quick strip and folded sections (D52; 675 -> 698 on its own, 706 on top of #225)

Kevin asked for a tidier, more space-saving Settings menu and picked "Option D" from four wireframes. The panel went from one 440 x 538 px column of sixteen items to a 420 px panel that is about 263 px tall folded and 515 px with everything open (measured in the real app at 1600 x 900). The checks that read it needed more care than the panel did; this is what was learned.

- **Counts:** 675 -> 698. +21 `Settings_Folded_Layout` (new: 20 checks + its tripwire; folded by default, the strip, the folded headers' summaries, the conditional rows per tab, a switch, the text-size stepper, the theme, the healthy and the stale footer, Details, remembered across a reload, Excel, the footprint, a 390 px window) and +2 `Apps_Script_Team_Features` (the instance that boots six real config warnings now also asserts the dot is red and Details are open on arrival; the valid-config instance asserts neither). No check was dropped.
- **Renaming a button, or folding a section, turns "absent" checks into passes for the wrong reason.** The suite found Export by its exact text (9 lines), "Export to Drive" by its text, and the dark-mode button by its title. After the rename ("Excel", "Drive") and the fold, `Server_Extras_UI_Gating`'s "no Export to Drive button" would have passed with the button present or not, and `check_basic_build.js`'s basic-build assertion the same. Every such check now finds its control by a `data-settings-*` hook, opens the section first, and requires a control that must be present in the same state (the Excel button; the offline-copy switch beside the absent "Data stamp" toggle; the control run of `check_basic_build.js` that must show Drive). The suite helpers (`openSettingsSection`, `openSettingsDetails`) only ever open, because a warning opens Details by itself and a bare click would shut it.
- **A bug in my own first test edit, caught by the run:** the replacement for "the dark-mode toggle" was the theme button that is not pressed, and after a click that is the other button, so reading its `aria-pressed` gave the wrong mode. `Preferences_Persistence` failed 2 checks ("local state is NOT reverted after the server write fails", "the local write still succeeds"); the state is now read from the Dark button (`findDarkToggle.isDark()`).
- **Run history.** First run, new app against the old tests: it failed exactly the places that find a control by its old text (the dark toggle x3 and its tripwire, the four Excel-export readers, the two Settings-lines readers in Apps_Script_Team_Features) and one unrelated check, Analyze_BookingFlash "Undo bar ... the table ends inside the window". That run overlapped a second Chromium (a screenshot script), and the check did not fail again in the next two runs; the cause is not proven, but timing noise from CPU contention fits the "Known flakiness" pattern, and the lesson is not to run a second browser beside the suite. Second run (updated tests): 698 executed, 696 passed, the 2 above.
- **Fix-removed run (the new checks can fail).** A copy of the app with five deliberate bugs, run through the same runner: (1) Data & safety defaulting open, (2) the healthy dot amber, (3) Details not opening on a warning, (4) the stepper skipping 18 px, (5) the Drive button rendered without a server. 698 executed (nothing skipped), 688 passed, 10 failed: (1) took out the folded-by-default, open-Data, switch, footprint and remembered-across-a-reload checks; (2) the healthy-footer and stale-dot checks; (3) the Suite 18 red-dot / Details-open check; (4) the stepper check; (5) the Suite 16 "Drive does NOT render" check, with its positive control (the Excel button) still passing, so that failure is about Drive and nothing else.
- **Merging main while the PR was open (#224, the one-line.com branding, D47).** Two things collided. (1) *The number:* #224 took D47 while this was being built, so this became D48 (the later PR renumbers, as D46 did over D44); then #225 landed with D48 and it became D49, and the pin was recomputed on top of #225's (683 + 23 = 706). Then #223 landed with D49 and D50 (see the next bullet), so it became D51, and then #228 landed with D51, so it became D52. (2) *The brand colour:* #224 turned every hard-coded `bg-[#E5007D]` into the token `bg-one` ("never type the hex"), and this PR's new Theme buttons would have kept the old pink, with nothing noticing (white text on it still passes the contrast check). They now use `bg-one`, and the Theme step asserts that the pressed button's computed background equals `window.ONE_BRAND.magenta` (no new record: 698 stays 698). *Fix-removed run on the merged tree:* a copy with the Theme buttons' active state back to the hex failed exactly that one check, 697 / 698, all 698 executed.
- **My own new brand-token assertion was flaky on the hosted runner, and the hosted run caught it (same day).** The Theme step read the pressed Dark button's computed background 80 ms after the click. The buttons carry `transition-colors`, so the read can land mid-fade: on GitHub's runner it returned the unpressed gray (`rgb(229, 231, 235)`) instead of the brand colour (`rgb(189, 14, 114)`) and failed the `dist/` run (696 / 698, the other failure being the Analyze check above), while it passed in five local runs. A read that depends on how fast a transition runs is a flaw in the check, not noise to re-run. It now polls (up to 2.5 s) until the colour equals the brand colour, then asserts. A wrong colour never settles to the brand colour, so it still fails: the hard-coded-pink copy again failed exactly this one check, 697 / 698, all 698 executed; the `dist/` run with the fix passed 698 / 698.
- **A check that is red on `main` itself, not caused by this PR.** On the merged tree the local gate passed the source run 698 / 698 and failed the `dist/` run 697 / 698 on one check, `Analyze_BookingFlash` "Undo bar appearing above the masthead ... the table ends inside the window". GitHub's CI on `main` at `fa7a3af` (the #224 merge, no change from this PR) fails the same check in its blocking `dist/` run, with identical numbers (base top 366.5, with the bar `max` 1775.1 against `want` 1793.8, after top 348.2), and so did this PR's first local run before the merge. The reading is byte-identical across three environments, so it is one discrete state (an extra ~18.7 px above the table when the table-height effect last measured, gone without the effect re-running), not jitter; it occurs on some runs and not others (the same check passed in four of this PR's runs). Not caused by this PR: the Settings popover is `position: fixed` and not mounted at that point. *Probable cause, unproven:* the table-height effect observes the tab content, the masthead and the banner stack but not the slicer panel between the masthead and the table, and "Show in table" changes the Lane slicer while the test pins the tab content's height; a one-line change in that panel moves the table with no observed element resizing. *Proposed fix, untested:* also observe that panel (the same reasoning as `mastheadRef`), then re-run this check in a loop.
- **Merging main again, for #223 (the Reset Network box, D49, and the Sector Summary Reefer note, D50), while CI was running on the previous head.** Kevin had marked the PR ready and turned on GitHub auto-merge; `main` then moved by five commits and the PR went `dirty`. Three files conflicted: the two `dist/` files (regenerated with `node scripts/build_deployable.js`, then `--check` to confirm, never merged by hand) and `docs/DECISIONS.md` (#223's D49 and D50 kept in place because they landed first, this entry moved after them as D51, later D52). The app file, the regression tests, `check_basic_build.js`, `TESTING.md` and `CODE_NOTES.md` merged without a conflict. A clean textual merge is not proof, so the three places the two sides could meet were read: #223 edited the head script's boot-failure box and the Sector Summary cargo note (neither is in the Settings popover); it edited four existing `Sector_Cargo` steps (no step added, so the regression pin does not move) and added two checks to `check_basic_build.js`, which the pin does not count. *A renumbering trap worth knowing:* renumbering with a whole-file replace of "D49" would have rewritten #223's own D49 references (`CODE_NOTES.md`, the `check_basic_build.js` row in `TESTING.md`) and, in this very entry, a sentence that records the history; each file was edited by line, and the leftover `D49` mentions were listed afterwards and all belong to #223 or to the numbering history. The pin stays 706 (683 on `main` + 23) because #223 added no regression-runner check.
- **Merging main a third time, for #228 (CI: docs-only PRs skip the three browser jobs; the source and `dist/` regression runs become parallel jobs; D51), while the full local gate for the previous merge was still running.** `main` moved while the 25-minute gate ran, so the guard before the push ("commits on `main` not in this branch must be 0") refused it. #228 changes the workflow, two scripts, a new headless check and one line of `run_ci_locally.js`; none of the app, `dist/` or regression-test files. It took D51, so this entry became D52; only `docs/DECISIONS.md` conflicted, and `D51` was again renumbered by line because #228 added `D51` references of its own (`ci.yml`, the new scripts, two `TESTING.md` lines). *What was and was not re-run:* the executable code is unchanged from the tree the full gate passed (706 / 706, source and `dist/`), which was checked by comparing the app script and the test file with their comments stripped before and after the renumbering (identical), and `dist/` was regenerated; the non-browser jobs, including #228's new docs-only check, were re-run on the merged tree, and the browser jobs are left to the pull request's own run, which after #228 runs the source and `dist/` suites in parallel (about 10 minutes, not 19).
- **Green, this tree (before the merge with main):** `node scripts/run_ci_locally.js` (every job): regression suite source 698 / 698 (588 s) and `dist/index.html` 698 / 698 (563 s); the basic build and its control (Drive present in the control, absent in the basic build); both highlight budgets; every non-browser job.

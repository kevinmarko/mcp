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
recipe is in [TESTING.md](TESTING.md#current-counts-2026-10-06-347-checks)): 331 executed, 327 passed, and exactly the four layout
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
[TESTING.md](TESTING.md#current-counts-2026-10-06-347-checks)): 341 executed, 333 passed, and exactly the four hover-card checks red on
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
[TESTING.md](TESTING.md#current-counts-2026-10-06-345-checks)): 345 executed, 344 passed, and exactly the clamp check red
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

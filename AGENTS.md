# Agent instructions: Booking Flash Report NA

Read this first. It's the short, operational entry point for any AI coding agent (or human)
working in this repo — **what to do before/after making a change**, not the full project
history. Two things to read here before you start: the
[required checks](#required-run-the-checks-after-every-change-to-the-app) you must run after any
change to the app, and the
[working practices](#working-practices-verifying-reporting-and-committing) for how to verify,
report, and commit what you find. For everything else, go to:

- [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) — the authoritative field-mapping reference:
  every `getVal()` field, its real source column, which tab renders it, the frozen/static
  datasets, the reference `.xlsm` workbook's structure, and per-tab validation status. Read
  this — not just HANDOFF.md — before adding a new field or investigating "this number looks
  wrong."
- [HANDOFF.md](HANDOFF.md) — full project history, architecture, every non-obvious gotcha and
  bug class found so far. Read this before touching numeric/color logic or the pivot engine.
- [README.md](README.md) — how to run the app locally, tech stack, repo structure.

The app itself is one file whose name changes with every version bump — currently
`Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html` (React 18 + Babel Standalone, no build
step — see README's "Current version" note for why the filename has a version number baked in
and how to tell which file is live; **always check that note before trusting a filename stated
anywhere else, including this file** — this exact line went stale once already, pointing at a
frozen `..._1.10_...` snapshot instead of the live file). **Do not hardcode that filename
anywhere in this repo, including below** — see the note on check 1, which went stale the exact
same way and was fixed the same day this paragraph was reworded.

## Required: run the checks after every change to the app

This repo has no test framework by design (see README) — these are standalone scripts, not
Jest/Mocha/etc. — which makes it easy to ship a change that *looks* right in the diff but is
broken at runtime — this has actually happened more than once in this project's history (see
[HANDOFF.md's "Known bug classes"](HANDOFF.md#known-bug-classes-read-before-touching-numericcolor-logic)
and the regression suite's own header comment for real examples, including a `ReferenceError`
that a syntax check alone did not catch because the deleted function was still called
~15 lines away). **Every check below now also runs automatically in CI** (GitHub Actions,
`.github/workflows/ci.yml`) on every push/PR. Checks 1–3 plus `check_field_filter_gating.py`,
`check_server_prefs_logic.js`, `check_resolve_app_html.js` and `check_compare_kpis.js` (2026-09-26 -- Compare's
KPI tiles and the helpers they share with Analyze, run headlessly on the 9-day archive; run it
after any change to the app's "shared capacity helpers" block or the Compare tab) are required/blocking there; check 4 runs too
(`tests/ci_regression_runner.js`) but is deliberately non-blocking — see the "Known
flakiness" section below for why an unattended full-suite run isn't trustworthy as a hard gate.
**2026-09-18:** `check_server_prefs_logic.js` was the last required check CI did not run, and
that gap had already bitten: PR #88 merged while this check was hard-failing with a
`SyntaxError`, because nothing ran it. If you add a check to this list, add it to `ci.yml` in the same commit — a
required check that runs only when someone remembers is not a required check.
None of this changes what's required of you locally: CI verifies what you already pushed, it
doesn't replace verifying the change yourself first. Checks 1, 4 and 6 below are required after any change to the app file, in order —
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
   import re, os
   # Same detection algorithm as tests/check_alias_landmines.py's own auto-detect (see that
   # script's header comment for the two-naming-era history this must match). Kept in sync by
   # hand since this is a doc snippet, not an importable module. SEVEN copies of this rule now
   # exist -- if you change one, change all of them: this snippet, check_alias_landmines.py,
   # check_date_timezone_safety.js, check_field_filter_gating.py, ci_regression_runner.js,
   # check_server_prefs_logic.js, and perf_benchmark.js. They drifted apart once already:
   # only the last two excluded testing builds, so the other four silently validated
   # 1.67_TESTING instead of the main file (fixed 2026-09-16).
   #
   # tests/perf_toggle_benchmark.js is deliberately NOT an eighth copy: it `require()`s
   # perf_benchmark.js's implementation (which is why that file has a `require.main === module`
   # guard and a module.exports block at the bottom). Two JS harnesses in the same directory can
   # share one module even though a Python script and a doc snippet cannot -- so when a JS
   # harness is added, import the rule, do not paste it.
   repo_root = os.getcwd()
   all_files = [f for f in os.listdir(repo_root) if re.match(r'[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$', f)]
   # Testing builds are excluded BEFORE the version comparison. Without this the snippet
   # picked 1.67_TESTING and syntax-checked the testing build instead of the deployed app --
   # the same class of green-but-meaningless result described in the paragraph above, and it
   # was live in this file until 2026-09-16. Excluded names are printed, never dropped silently.
   excluded = [f for f in all_files if re.search(r'testing', f, re.I)]
   if excluded: print(f"(excluded as testing builds: {', '.join(sorted(excluded))})")
   candidates = [f for f in all_files if not re.search(r'testing', f, re.I)]
   assert candidates, f"No main Booking_flash_report_na*.html file found in {repo_root}"
   version_key = lambda fname: tuple(int(p) for p in re.search(r'na_(?:Kevin_)?([\d.]+)_', fname).group(1).split('.'))
   html_path = max(candidates, key=version_key)
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
   [`tests/booking_flash_regression_tests.js`](tests/booking_flash_regression_tests.js) —
   structural/invariant checks (not hardcoded-number snapshots) covering Trade Summary, Sector
   Summary, POL Booking Flash, and Booking Flash. Run it against a **live browser** with real
   data loaded, per [HANDOFF.md's Live-testing method](HANDOFF.md#live-testing-method):
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
     | **pinned** | **pinned** (what `tests/ci_regression_runner.js` does) | 100 |

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
   2026-09-25 POL windowing checks, **176/176**, then **186/186**, then **187/187**, then **189/189**, then **192/192**, since the 2026-09-26 audit, Analyze and Compare checks -- see check 4), matching check 4's
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

   `BF_APP_HTML`'s resolution logic itself — `resolveAppHtml()` in `tests/perf_benchmark.js` — is
   checked headlessly by `node tests/check_resolve_app_html.js` (blocking in CI). A live browser
   run only ever exercises its two success paths; that check covers the two failure paths (an
   absolute override, a nonexistent one) and the exact override-flattening bug class the function
   exists to prevent, none of which a green regression-suite run would ever catch on its own.

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

**This is exactly why CI's `regression-suite` job (`tests/ci_regression_runner.js`) is
`continue-on-error: true`**: it runs the entire suite unattended in one script, the precise shape
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

### Open question for production: do saved settings actually persist?

The app persists three preferences in `localStorage` (`bookingFlashDarkMode`,
`bookingFlashAutoRefresh`, `bookingFlashFreezePanes`). In production it runs inside an Apps
Script HtmlService sandbox iframe whose own `window.location` is a **transient**
`*.googleusercontent.com` URL — the code already works around that for navigation and
update-detection. `localStorage` is keyed by origin, so **if that origin is not stable between
loads, all three preferences silently reset every visit** and no one would file a bug; they'd
just re-toggle dark mode.

This was never tested, and it cannot be tested from a dev machine — it only reproduces on the
deployed `/exec` URL behind the org's Google sign-in. So as of 2026-09-15 the app measures it on
itself: `readStorageProbe()` writes a marker containing the origin that wrote it and compares on
the next load, and Settings shows one line reporting the result (`persisting` / `first-run` /
`origin-rotated` / `unwritable` / `unavailable`).

**Someone needs to open the deployed `/exec` URL twice and read that line.** The answer matters
beyond the three preferences: any future client-side cache keyed to this origin — an IndexedDB
cache of the Babel transform output was the specific idea on the table — would never hit in
production if the origin rotates, so the probe result gates that work. Note the `/exec` URL has
never been recorded anywhere in this repo; `apps-script/README.md` asks for it to be saved and it
wasn't.

**Reading it properly (revised 2026-09-16):** a second load in the *same* browser is a weak
signal — it cannot distinguish "the origin was stable" from "localStorage happened to still be
there." Do the second load in an independent context (an incognito window, or a different
browser) signed into the same account, where `localStorage` starts empty. That is the only
version of the check whose result means what it appears to mean.

**Result recorded 2026-09-26 (Kevin, deployed `/exec` URL, his normal browser):** Settings read
"Saved settings are persisting normally (56 loads on this browser)" and "Cloud sync: active."
`persisting` means the probe found its marker AND the origin that wrote it matched the current
one, so across 56 real production loads the storage origin did not rotate and `localStorage`
persists. That unblocks origin-keyed client caches. "Cloud sync: active" means `doGet` injected
`window.__SERVER_PREFS__` and the server-backed preferences path is live. Still NOT done: the
independent-context (incognito) and cross-account steps of the checklist below, which are what
prove the server round trip and per-user isolation.

### Server-backed preferences (2026-09-16): what was built, and why it took this shape

A four-agent design pass first looked at moving the three preferences (`bookingFlashDarkMode`,
`bookingFlashAutoRefresh`, `bookingFlashFreezePanes`) server-side so they survive an origin
rotation, without writing any client code. That pass is now superseded — a follow-up
implementation actually built it, against a frozen interface contract
(`docs/SERVER_PREFS_CONTRACT.md`) that four agents worked from in parallel: one on `Code.gs`, one
on the app file, one on the regression tests, and this doc. The reasoning below is what still
holds and why the implementation looks the way it does; read the contract itself for the exact
shapes and rules.

- **`getScriptProperties()`, not `getUserProperties()`, namespaced by the visitor's email.**
  Google documents `getUserProperties()` as readable by "the current or effective user" —
  precisely ambiguous under "Execute as: Me", where those differ, and secondary sources
  contradict each other. If it turned out to be owner-keyed, every visitor would share one set
  of booleans, so one person's dark-mode toggle would flip it for the whole org — worse than the
  bug being fixed, and **invisible to every client-side test**, because from the browser's point
  of view the server stored a value and gave it back correctly. `getScriptProperties()` is
  documented unambiguously as script-global, so per-user isolation instead comes from the key
  (`<pref-name>:<email>`), not from an ambiguous API. `Session.getActiveUser().getEmail()` is
  documented to be blank for execute-as-me web apps *but exempted* when the visitor shares a
  Workspace domain with the developer — which is this deployment. If the email doesn't resolve,
  there is no per-user key available, and the feature fails closed to exactly today's
  localStorage-only behaviour rather than falling back to any shared/global key.
- **No async read path, because there is currently no first-paint flash and that is
  load-bearing.** All three prefs use lazy `useState` initializers that read `localStorage`
  *synchronously* during the mounting render; there is no "unknown" state anywhere in the file,
  and every render site assumes there never will be. So reads don't go through
  `google.script.run` at all — `doGet` reads the prefs and injects `window.__SERVER_PREFS__`
  inline *before* the app's own script runs, exactly as `injectExecUrl_` already does for
  `__EXEC_URL__`. The lazy initializers just prefer the injected global over `localStorage` when
  it's available. Writes are the only thing that go over `google.script.run`
  (`saveUserPref`), fire-and-forget; a failed write is never surfaced to the user beyond the
  existing Settings diagnostic line, and is simply overwritten by the next good one.
- **`bookingFlashAutoRefresh` is not normalized with the other two.** It is
  `stored === null ? true : stored === '1'` — it distinguishes "never set" (on) from
  "explicitly off". Dark mode and freeze panes both collapse null/`'0'`/garbage to `false`. The
  contract calls this out explicitly so a backend that treated all three uniformly wouldn't
  silently flip auto-refresh for anyone who had turned it off.
- **The storage probe stays.** It is the only instrument that can show whether either fix —
  this one or a plain client-side one — actually worked in production, and it predates and is
  independent of this feature. Do not remove it as part of this change.

**`?check=identity` still answers a question worth recording, and that answer is still not
recorded.** It measures the `getUserProperties()` ambiguity above — see
`apps-script/README.md`'s `?check=identity` section for how to run it. Whoever runs it should
still write the result here:

- `activeUserEmail` behaviour observed: _not yet run — record here once it is._
- `getUserProperties()` shared-vs-per-user result: _not yet run — record here once it is._

Even though the implementation went with `getScriptProperties()` rather than betting on
`getUserProperties()`, the probe's answer is still worth having on record — it tells you whether
the road not taken would even have worked, which matters if `getScriptProperties()` ever turns
out to have its own problems (quota, contention) and a fallback needs evaluating.

#### This cannot be verified on a dev machine

`google.script.run` exists only inside the Apps Script `HtmlService` sandbox. Nothing that runs
on a laptop — `python3 -m http.server`, `file://`, any local harness — has it, so any local test
run of this feature is testing a strict subset of the real path.

**What a local run DOES prove:** the app still works when `window.__SERVER_PREFS__` is absent
(the `undefined` case, which is every local environment) — i.e. that the degrade-to-localStorage
path is intact and first paint is still synchronous with no new "unknown" render state. It also
proves the JS is syntactically valid and that the write path doesn't throw when `google.script`
is undefined.

**What a local run CANNOT prove:** that `doGet` actually injects `window.__SERVER_PREFS__`
correctly, that `saveUserPref` actually persists anything via `PropertiesService`, that the
visitor's email actually resolves the way the contract assumes, that the resolution rule (server
value when available and non-null, else localStorage, else null) picks the right value against
real server data, or — the whole point of the feature — that a preference set in one browser
context actually reappears in a different one. None of that has been exercised yet; nothing has
been deployed.

#### Deployed-URL checklist (do this after redeploying, not before)

Both `index.html` and `Code.gs` need redeploying for any of this to take effect (see
`apps-script/README.md`'s "Redeploying `Code.gs` itself" section — same posture applies here:
until redeployed, the app just keeps doing exactly what it does today, degrading safely to
localStorage-only rather than breaking). Once redeployed:

1. Open the `/exec` URL signed into your own account and change one of the three preferences
   (e.g. toggle dark mode).
2. Reload in the **same** browser. This is a weak signal — it cannot distinguish a working
   server round trip from `localStorage` simply still being there — but it's a cheap first
   check that nothing broke outright.
3. **The discriminating step:** open the same `/exec` URL in an **independent** browser context
   — an incognito/private window, or a different browser entirely — signed into the **same**
   account, where `localStorage` starts empty. If the preference you set in step 1 is already
   correct on first paint (no flash, no flip after load), the server round trip is real. If it
   comes back at the default instead, the write, the read injection, or the identity resolution
   is broken somewhere — the same-browser reload in step 2 would not have caught this.
4. **Cross-account check:** open the `/exec` URL signed into a **different** account (one that
   hasn't touched this preference) and confirm the preference set in step 1 does **not** appear
   there — it should show that account's own default/unset state. This is the check that would
   catch a namespacing bug (e.g. the email not actually making it into the property key), which
   would silently leak one person's settings to everyone.
5. Check the existing storage-probe line in Settings still reports sensibly on both the
   same-browser and independent-context loads — this feature and the probe are answering related
   but different questions (probe: is the origin stable at all; this feature: does the
   server-backed value round-trip correctly), and a regression in one is easy to misread as the
   other.

No one has run this checklist yet. Do not describe this feature as working in production until
someone has.

**What HAS been run, locally, 2026-09-16.** Be precise about the boundary here, because the
green numbers below are easy to over-read:

- Full browser regression suite against the local static server: **113 passed, 1 failed, 114
  total**. `f2c4e7a` (cherry-picked here, with `tests/fixtures/sector_data_2026-09-16.csv`)
  fixed one of the two pre-existing `Sector_Summary` failures. The remaining one --
  `Class A: "Average Max Laden vs Booking"` -- is NOT the same bug and is still open: it
  compares leaf-row Avg Max Laden / Avg Booking against the same August 2026 reference
  workbook, and `f2c4e7a` only pinned the Sector Summary check, not this one. It is unrelated
  to preferences. Do not "fix" it by editing the expected numbers until someone has decided
  which side is right -- the observed gaps are large and directional (e.g. TPT/AW/EC1 got
  avgBkg 576 vs expected 923), which is the shape of either real data drift OR a genuine
  aggregation bug, and flattening the expectation would hide the second case permanently.
- Excluding Suite 10, the suite recorded **exactly 72 results — the same count as before this
  change**. That equality is the point: it is what proves no existing suite silently stopped
  asserting, which is the failure this repo has hit twice and which a pass *rate* hides.
- Suite 10 `Preferences_Persistence`: **42/42**, including its own hardcoded tripwire (41
  assertions plus the tripwire itself). Its first assertion verifies the app actually touched
  the fake `window.__SERVER_PREFS__` (a Proxy access log), so the suite cannot pass by quietly
  exercising the old localStorage-only path.
- `node tests/check_server_prefs_logic.js`: **22/22**, headless, no browser.

None of that touches the server. Every scenario above feeds the client a *fake*
`__SERVER_PREFS__` and a *fake* `google.script.run`. It proves the client reacts correctly to
outcomes the fake produces; it says nothing about whether `Code.gs` stores anything, whether the
email-namespaced key really isolates users, or whether the round trip works at all. A bug where
`saveUserPref` wrote to a shared key would leave every number above unchanged.

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

## Full data-linkage validation workflow

Use this when asked to do a full data-correctness audit (not just verify one change) — e.g.
"check every tab/column against a new export," or after Kevin sends a new raw file and/or the
reference `.xlsm` workbook. This is what actually found and fixed the 7 bugs documented in
DATA_ARCHITECTURE.md's [Validation status](DATA_ARCHITECTURE.md#validation-status-by-tab) table
on 2026-08-25 — it's a repeatable process, not a one-off.

1. **Static sweep first** (seconds, catches the whole Class E bug class before touching a
   browser): `python3 tests/check_alias_landmines.py <the new export>`. Fix anything it finds
   before moving on to live checks — no point live-verifying a field you already know is
   mis-wired.
2. **Get the strongest ground truth available.** A fresh raw export is the minimum. If Kevin has
   also provided the current reference `.xlsm` workbook, prefer cross-checking against its own
   cached computed values over re-deriving expected values from the raw file by hand — it
   captures the real system's actual rounding/edge-case behavior, not your guess at it (see
   DATA_ARCHITECTURE.md's [Reference workbook](DATA_ARCHITECTURE.md#reference-workbook-the-real-ground-truth)
   section for how to read it).
3. **Fan out per tab/column-group, not one pass covering everything serially.** The 2026-08-25
   audit used 5 parallel agents (3 against the raw CSV, 2 against the `.xlsm`'s cached values),
   each scoped to a specific tab or column group, explicitly told what the *other* agents already
   covered so nothing was duplicated or silently skipped. Each agent: extract real values for a
   real sample of rows (aim for exhaustive — hundreds of rows, not a handful — the bugs found this
   way were often narrow, triggered on a small fraction of rows), independently recompute the
   expected value from source, and report concrete mismatches (exact identifier, expected vs.
   actual, root cause + line number if found) rather than a pass/fail summary alone.
4. **A diff against a `.xlsm` snapshot is not automatically a bug** — this app is live/auto-
   refreshing, so a stale reference file will disagree with the app on any volatile field just
   from time passing. Before calling something broken, check whether the app's value matches its
   OWN raw source row for that same field — that's the real bug signal, not disagreement with an
   older snapshot.
5. **Update [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md)** with whatever the audit found — new
   validation-status coverage, any newly-discovered frozen/static dataset, any fixed field's
   corrected source column — in the same pass, not as a follow-up someone else has to remember.

## Housekeeping this file doesn't cover

Git workflow (branch/PR conventions), the DAX formula reference, and the full bug-class catalog
live in HANDOFF.md. Field-mapping aliases, per-tab column inventory, and validation status live
in DATA_ARCHITECTURE.md. This file intentionally doesn't duplicate either.

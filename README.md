# Booking Flash Report NA

A single-file React web app that rebuilds the `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm`
Excel workbook (Power Pivot/DAX pivots + VBA macros) as a standalone, no-build-step browser app.

**Current version**: [`Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html`](Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html) — this is the MAIN file, the one that gets deployed, and it is what you should be changing unless told otherwise.

> **Read this before trusting a version number.** Between 2026-09-04 and 2026-09-17 the "highest version number is the live one" rule was FALSE, because testing builds sat above the main file: `Booking_flash_report_na_1.67_TESTING.html` is a testing build (per-user filter/view persistence, developed on its own branch) and `1.70_Testing` was an earlier name for that same work, while the main file was the lower-numbered 1.66. That is fixed as of 2026-09-17: per Kevin, **1.66 was renamed to 2.0 for production**, so the main file is once again the highest dotted version in the repo root (`2.0` > `1.67`), and the two signals agree instead of contradicting each other.
>
> Belt and braces, because this cost real time twice: the checks also exclude any filename matching `/testing/i` before comparing versions, so a future testing build numbered *above* 2.0 still will not capture them. Both mechanisms have to be wrong before a check silently examines the wrong file.
>
> 1.67 was added *alongside* the then-unmodified main file rather than renamed from it, deliberately, so the two can be compared and rolled back to at any time. A consequence worth knowing when reviewing: because it is a new file rather than a rename, git cannot pair them, so a PR renders 1.67 as ~9,500 added lines. To see the real change, diff the paths directly:
> `git diff --no-index Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html Booking_flash_report_na_1.67_TESTING.html`
>
> **This used to break every automated check in the repo, silently, and the fix is recent.** AGENTS.md's required syntax check, `tests/check_alias_landmines.py`, `tests/check_date_timezone_safety.js`, `tests/check_field_filter_gating.py`, `tests/check_server_prefs_logic.js`, `perf_benchmark.js` and the regression suite all auto-detect "the current app file" as the highest dotted version in the repo root. While a testing build sat *above* the main file, all of them silently switched to the testing build and reported green results that said nothing about the file you had changed. That really happened: on 2026-09-16 two CI jobs were green against `1.67_TESTING` while the branch under review only touched 1.66.
>
> Both halves are now closed — the `/testing/i` exclusion (PR #87) and the 2.0 rename — but the habit is still worth keeping, because the rule is still *inferred* rather than declared: **always read the "(auto-detected current app version: ...)" line those tools print and confirm it names the file you meant.** An explicit committed pointer to the live app, rather than inferring it from filenames, remains the real fix and is still not done.
>
> Genuinely old files (`booking_flash_report_na_Kevin_1.0X_*.html`, `..._1.10_AUTO_REFRESH.html`) are point-in-time snapshots from an earlier naming scheme, kept for history, not maintained. (2026-09-04: this pointer had gone stale after the file's naming convention changed — `tests/check_alias_landmines.py`'s auto-detect had the same bug, found and fixed the same day during a full field-mapping audit.)

> **New to this project?** Read [HANDOFF.md](HANDOFF.md) next — it has the full project history, the data model, every non-obvious gotcha found along the way, and what's still open. This README only covers "how do I run/test/deploy it."

## What it does

- Renders 4 tabs (Trade Summary, Sector Summary, POL Booking Flash, Booking Flash) reproducing the reference workbook's real pivots and flat detail sheets. (2026-09-15: there used to be a 5th, hidden "Booking Summary" tab, kept in the code on purpose but unlinked from the tab bar, which automated sweeps repeatedly flagged as dead code — three did during the 2026-09-10 audit, each correctly told it was deliberate. Kevin asked for it to be removed on 2026-09-15, so it is gone; it is in git history if ever wanted back. See HANDOFF.md's tab table.)
- Data comes in one of two ways:
  1. **Automatic** — fetches a Google Sheet published as CSV (`CSV_SOURCE_URL` in the file), polls it every 10 minutes, and shows a "New data available" banner when it changes.
  2. **Manual** — drag-and-drop or click-to-upload an `.xlsx`/`.csv` export (always available as a fallback).
- Has a "New data available" banner (background poll never overwrites the view without a click), a "Refresh Now" button, and a "Zoom"/"Text Size" control.
- Dark mode, auto-refresh, and freeze-panes preferences are saved locally, and — once `apps-script/Code.gs` is redeployed with the 2026-09-16 changes (see [apps-script/README.md](apps-script/README.md)) — also server-side per visitor, so they follow you between browsers/devices on the deployed org app instead of resetting; unreachable or not-yet-deployed, it falls back to today's per-browser-only behavior. Not yet verified against a real deployment — see [AGENTS.md](AGENTS.md).
- Has an "Analyze" modal (Booking Flash / POL Booking Flash tabs only) summarizing lane/POL performance over the last 4 weeks of currently-filtered data.

## Tech stack

No build step, no package manager runtime dependency, no backend. Everything is one `.html` file:

- **React 18** (UMD build via CDN `<script>` tags) + **Babel Standalone** (in-browser JSX transform)
- **Tailwind CSS** (CDN, `cdn.tailwindcss.com` — the console warning about this is expected and harmless for this project's scale)
- **SheetJS (XLSX)** for both `.xlsx`/`.csv` file parsing and CSV-text parsing (the auto-refresh path feeds fetched CSV text through the same `XLSX.read(text, {type:'string'})` → `sheet_to_json` pipeline as a file upload)

`package.json` only declares `@babel/core`/`@babel/preset-react` (sanity-checking JSX syntax) and `xlsx` (pinned to the exact version the app's own CDN URL loads, used by `tests/check_date_timezone_safety.js` to test the real library's date-parsing behavior under real timezones) — dev-time tools only, see **Verifying changes** below, not a runtime dependency of the app itself (the app loads its own copy of each via CDN `<script>` tags, same as always). Both this dependency and the app's own CDN reference were bumped 2026-09-10 off a version with known security advisories (see DATA_ARCHITECTURE.md's "Follow-up — 2026-09-10: xlsx security bump" entry) — installed from SheetJS's own CDN rather than the npm registry/cdnjs/unpkg, none of which host a fixed version.

## Running it locally

```bash
python3 -m http.server 8791 --directory /path/to/this/repo
```

Then open `http://localhost:8791/` and pick whichever `Booking_flash_report_na_*.html` has the
highest version number in the directory listing — see the "Current version" note above.
(`http://localhost:8791/Booking_flash_report_na_1.67_TESTING.html` as of this writing,
but don't hardcode that: it changes on every version bump, which is exactly the mistake this
README and AGENTS.md both made before — see AGENTS.md's syntax-check section for the full story.)

A `.claude/launch.json` config named `booking-flash-static-server` already does this — if your tooling supports that file, use it directly.

**Why not just open the file directly (`file://...`)?** Browsers block `fetch()` (used for the auto-refresh CSV pull) and impose other restrictions on `file://` pages. Always serve it over local HTTP.

## Verifying changes (no test framework — this project deliberately has none, matching its no-build-step app)

**Required after every app change** — see [AGENTS.md](AGENTS.md) for the full checklist and
why step 1 alone isn't sufficient (it's missed real bugs before).

**2026-09-16: checks 1–3 below now also run automatically** via GitHub Actions
(`.github/workflows/ci.yml`) on every push and pull request, and are required/blocking. Check 4
(the live regression suite) runs there too, via `tests/ci_regression_runner.js`, but is
intentionally **non-blocking** — AGENTS.md's "Known flakiness" section documents this exact
shape of run (one long unattended automated script) as a source of intermittent false failures
in this project's own history, so a red CI run on that job is a signal to investigate by hand,
not proof of a real regression on its own. This doesn't replace running the checks yourself
before pushing — CI tells you what already landed was broken, not what you're about to write.

1. **Syntax check** — extract the inline `<script type="text/babel">` block and run it through Babel + `node --check` to catch JSX/JS syntax errors before ever opening a browser. **Do not use `npx babel ...`** — this repo only has `@babel/core`/`@babel/preset-react` installed as libraries (no `@babel/cli`), so in a fresh container `npx babel` silently auto-installs and runs an unrelated ancient `babel@5.x` from the registry instead, which can't parse modern syntax (e.g. `??`) and falsely reports working code as broken (confirmed 2026-08-25 — see AGENTS.md). Use the exact command in [AGENTS.md's check 1](AGENTS.md#required-run-the-checks-after-every-change-to-the-app) instead, which also auto-detects the current app filename rather than requiring you to name it:
   ```bash
   node -e "
   const babel = require('@babel/core');
   const fs = require('fs');
   const result = babel.transformFileSync('your-extracted-script.jsx', { presets: ['@babel/preset-react'] });
   fs.writeFileSync('out.js', result.code);
   " && node --check out.js
   ```
2. **Live functional check** — serve the file (above), open it in a real browser, and either drag in a real data export or let auto-refresh load it. See [HANDOFF.md § Live-testing method](HANDOFF.md#live-testing-method) for how to simulate a file upload via automation (`fetch` + `File` + `DataTransfer`, since real OS file pickers aren't automatable).
3. **Regression suite (required, not optional)** — [`tests/booking_flash_regression_tests.js`](tests/booking_flash_regression_tests.js) is a standalone script (no framework) meant to be pasted into the browser console (or injected via automation) *after* real data is loaded. It asserts structural invariants (e.g. "a row's value == sum of its children," "no white text on a light background") rather than hardcoded numbers, so it keeps working as the underlying data changes. Full run instructions are in the file's own header comment. A change isn't done until this runs clean — see AGENTS.md for how to tell a real failure apart from this sandbox's known automated-multi-suite flakiness.

## Repo structure

```
Booking_flash_report_na_2.0_WORKING_PRO_ONLY.html         the app (single file — the MAIN, deployed file; this exact name changes on every version bump)
Booking_flash_report_na_1.67_TESTING.html                 a TESTING build, not deployed; excluded from every automated check by name
tests/booking_flash_regression_tests.js                 regression suite (see above)
tests/check_alias_landmines.py                           static alias/field-mapping check (see AGENTS.md)
tests/check_date_timezone_safety.js                      static + dynamic CSV-date timezone check (see AGENTS.md)
tests/ci_regression_runner.js                             headless driver that runs the regression suite in CI (see below)
apps-script/                                             Google Apps Script Web App deployment
  Code.gs                                                 doGet() that serves the app's HTML
  README.md                                                step-by-step manual deploy guide
Booking_Flash_Report_REFERENCE_08-12-2026.xlsm            the original Excel workbook being rebuilt
Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx              a real sample data export, for local testing
conditional_formatting_rules.json                          extracted native Excel CF rules (reference only)
HANDOFF.md                                                 full project history / data model / gotchas
.github/workflows/ci.yml                                  CI — runs checks 1-3 (blocking) and check 4 (best-effort) on every push/PR
```

Everything else in the repo root (`Untitled*.bas`, `fix_*.py`, `patch_*.py`, older `.orig` files, etc.) is leftover working scaffolding from earlier build phases — safe to ignore, not part of the live app's dependency graph. A future cleanup pass could remove these; not done yet since nothing currently depends on their removal.

## Deploying

The app is a static file — host it anywhere that can serve HTML with the right headers, or use the included Google Apps Script Web App path. See [apps-script/README.md](apps-script/README.md) for the full walkthrough (org-restricted access via a Google account gate).

## Data pipeline

```
Looker (scheduled delivery, Overwrite: Yes)
   → Google Sheet (shared Drive)
   → Sheet's "Publish to the web" CSV link  ← CSV_SOURCE_URL points here
   → this app (fetches + polls it client-side)
```

See [HANDOFF.md § Data pipeline](HANDOFF.md#data-pipeline) for the full architecture, security tradeoffs that were explicitly chosen, and how to change the source Sheet.

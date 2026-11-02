# Booking Flash Report NA

A single-file React web app that rebuilds the `Booking_Flash_Report_REFERENCE_08-12-2026.xlsm`
Excel workbook (Power Pivot/DAX pivots + VBA macros) as a standalone, no-build-step browser app.

**Current version**: [`Booking_flash_report_na_1.67_TESTING.html`](Booking_flash_report_na_1.67_TESTING.html) — always the highest version number present in the repo root is the live one. Older versions are kept for history and are not maintained — both the current-scheme `Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html` and the earlier-naming-scheme `booking_flash_report_na_Kevin_1.0X_*.html`/`booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html` files. **1.67 is a TESTING version** — per-user filter/view persistence plus two pre-existing bug fixes, added alongside an unmodified 1.66 so the two can be compared and 1.66 rolled back to at any time. It is what every auto-detecting check in this repo targets (they take the highest dotted version), which is exactly what you want while testing it; 1.66 remains the last name-designated "WORKING" build. (2026-09-16: added alongside 1.66, not renamed from it. 2026-09-04: this pointer had gone stale after the file's naming convention changed — `tests/check_alias_landmines.py`'s auto-detect had the same bug, found and fixed the same day during a full field-mapping audit.)

> **New to this project?** Read [HANDOFF.md](HANDOFF.md) next — it has the full project history, the data model, every non-obvious gotcha found along the way, and what's still open. This README only covers "how do I run/test/deploy it."

## What it does

- Renders 5 tabs (4 visible: Trade Summary, Sector Summary, POL Booking Flash, Booking Flash; 1 hidden: Booking Summary) reproducing the reference workbook's real pivots and flat detail sheets. The hidden tab is **kept in the code on purpose, unlinked from the tab bar** — no button sets `activeTab` to `'booking_flash'`, so automated sweeps reliably flag it as dead code (three did during the 2026-09-10 audit). It carries a `HIDDEN ON PURPOSE` note at its own definition site; don't remove it as cleanup.
- Data comes in one of two ways:
  1. **Automatic** — fetches a Google Sheet published as CSV (`CSV_SOURCE_URL` in the file), polls it every 10 minutes, and shows a "New data available" banner when it changes.
  2. **Manual** — drag-and-drop or click-to-upload an `.xlsx`/`.csv` export (always available as a fallback).
- Has a "New data available" banner (background poll never overwrites the view without a click), a "Refresh Now" button, and a "Zoom"/"Text Size" control.
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
Booking_flash_report_na_1.67_TESTING.html              the app (single file — see "Current version" above; this exact name changes on every version bump)
Booking_flash_report_na_1.66_WORKING_PRO_ONLY.html        the previous version, kept unmodified for history/rollback
tests/booking_flash_regression_tests.js                 regression suite (see above)
tests/check_alias_landmines.py                           static alias/field-mapping check (see AGENTS.md)
tests/check_date_timezone_safety.js                      static + dynamic CSV-date timezone check (see AGENTS.md)
apps-script/                                             Google Apps Script Web App deployment
  Code.gs                                                 doGet() that serves the app's HTML
  README.md                                                step-by-step manual deploy guide
Booking_Flash_Report_REFERENCE_08-12-2026.xlsm            the original Excel workbook being rebuilt
Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx              a real sample data export, for local testing
conditional_formatting_rules.json                          extracted native Excel CF rules (reference only)
HANDOFF.md                                                 full project history / data model / gotchas
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

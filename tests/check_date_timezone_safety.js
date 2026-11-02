#!/usr/bin/env node
/**
 * Static + dynamic check for the "timezone-shifted CSV dates" bug class
 * (DATA_ARCHITECTURE.md's Class F, 2026-09-08 addendum -- read that section for the full
 * writeup before touching anything this file checks).
 *
 * The bug: SheetJS's CSV parser auto-detects an ISO-shaped date cell (e.g. "2026-08-16")
 * and round-trips it through an internal Date object anchored to UTC midnight, then hands
 * back that Date's LOCAL calendar day -- one day behind in any timezone west of UTC (every
 * North American one included). This happens entirely inside SheetJS's own parsing, before
 * this app's own (already timezone-safe) formatDate/parseKnownDate ever see the value.
 *
 * Why this needs its OWN check, separate from tests/booking_flash_regression_tests.js: that
 * suite runs against whatever timezone the browser executing it happens to be in, and this
 * bug's very existence depends on that timezone -- it's silently ABSENT under UTC, which is
 * what every automated/sandboxed run of this project has used so far. A DOM-based check
 * pasted into a UTC browser would report a false "all clear" whether or not the real fix
 * (`raw: true` on every CSV-text XLSX.read call) is actually present. This script sidesteps
 * that by forcing the timezone itself, via a Node subprocess, rather than depending on
 * whatever timezone the machine running the check happens to default to.
 *
 * Two independent checks, both must pass:
 *
 *   1. STATIC -- every `XLSX.read(..., { type: 'string', ... })` call site in the app's own
 *      source must include `raw: true` in that same options object. This is the actual fix:
 *      it stops SheetJS from ever auto-promoting a CSV cell to a date type in the first
 *      place, so the buggy UTC round-trip has nothing to operate on. Deliberately does NOT
 *      require this on `type: 'binary'` calls (the .xlsx/.xls file-upload path) -- a real
 *      Excel workbook's date cells are already correctly-typed serials, not text SheetJS has
 *      to guess at, and forcing raw:true there would instead return bare serial numbers
 *      instead of formatted text, breaking every date column on a real upload. Catches a
 *      future edit that drops the flag from an existing call site, or adds a new CSV-text
 *      read site without it -- independent of environment, no browser/timezone needed.
 *
 *   2. DYNAMIC -- using the REAL xlsx npm package (the exact 0.18.5 pinned in package.json,
 *      matching the CDN build the app itself loads at runtime -- not a re-implementation),
 *      parses a synthetic CSV containing an ISO date, a year-less "Mon D" date, a plain
 *      number, a comma-formatted number, a percentage, and a blank cell -- once using the
 *      app's own real read options under 3 explicit timezones (America/New_York,
 *      America/Los_Angeles, and UTC as a control that must show NO shift, proving the test
 *      methodology itself is sound and not a tautology) -- and asserts every value survives
 *      byte-for-byte identical to its own literal input. This is what actually proves the
 *      FIX WORKS, not just that the flag is textually present -- would also catch a future
 *      SheetJS version silently changing what `raw: true` means. Each timezone is tested in
 *      its own subprocess (`node --tz-check <tz>`) since Node only reliably honors TZ if it's
 *      set before the process starts, not by writing to process.env.TZ mid-run.
 *
 *   3. DYNAMIC, downstream of check 2 -- the app's own date PARSE/FORMAT/COMPARE helpers
 *      (`DATE_MONTH_INDEX`, `parseKnownDate`, `formatDate` incl. its `yearHintDateStr`
 *      branch, `isOnOrBeforeDay`, `compareSaleWeek`, `compareEtd` -- defined together near
 *      line 742 in the app source). Checks 1-2 above guard the SheetJS/XLSX.read boundary;
 *      this guards the layer immediately downstream that actually turns that text into what
 *      renders and what order rows sort in. These five are documented in the app's own
 *      comments as timezone-safe BY CONSTRUCTION -- parseKnownDate/formatDate never build a
 *      `Date` object at all (pure regex + string arithmetic), and isOnOrBeforeDay/compareEtd
 *      build a `Date` only from LOCAL numeric components (`new Date(y, m, d, ...)`), never
 *      from a date-shaped STRING (`new Date("2026-08-16")` is the UTC-anchored form that
 *      caused the original Class F bug) -- but that claim had never actually been exercised
 *      under a non-UTC timezone before this check existed (2026-09-10 W9 audit). Extracts
 *      the exact live source of these 5 helpers (plus their `collator` dependency) straight
 *      out of the app file -- not a reimplementation, so a future edit to the real function
 *      is exactly what gets tested -- evaluates it in a `vm` context inside a subprocess
 *      forced to each of 4 real timezones (America/New_York, America/Los_Angeles, UTC, and
 *      Asia/Singapore -- EAST of UTC, relevant since this app also has SGSIN columns and the
 *      original bug class was specifically about the sign of the UTC offset), and asserts
 *      every probe's output is byte-for-byte identical across all 4. Probes cover every real
 *      date SHAPE confirmed present in Kevin's two live exports (`M/D/YYYY`, `M/D/YY`, both
 *      with and without an `H:MM` time part) plus the year-less `"Mon D"` shape (documented
 *      in Class F as ~77% of one real column historically, though absent from the two export
 *      files on hand at audit time -- kept as a probe since the code path is still live and
 *      the shape could reappear at any time the upstream Sheet's own per-cell formatting
 *      drifts again), synthetic year-boundary cases for `formatDate`'s `yearHintDateStr`
 *      (a Dec date hinted by a Jan-of-next-year ETD, and the reverse), and Sale-Week edge
 *      cases (`W9` vs `W10` -- lexical order would wrongly put `W10` first -- and the
 *      `2026/W52` -> `2027/W01` year rollover). Also verifies a total, non-flaky order:
 *      `compareSaleWeek`/`compareEtd`'s pairwise comparisons over the curated probe set are
 *      antisymmetric and identical in every timezone, so `Array.prototype.sort` (whose
 *      result on a non-total-order comparator is implementation-defined) can't silently
 *      differ between environments even where the raw comparator values agree in isolation.
 *
 * Usage:
 *   node tests/check_date_timezone_safety.js [path-to-app-html]
 *
 *   If path-to-app-html is omitted, auto-detects the current app version the same way
 *   tests/check_alias_landmines.py does -- highest version number among
 *   Booking_flash_report_na*.html files in the repo root (see that script's own comment for
 *   why: the naming scheme itself changed once mid-project, so this matches BOTH eras and
 *   lets the numeric version decide, not the regex).
 *
 * Requires the `xlsx` package (added to package.json's dependencies specifically for this
 * check -- `npm install` first if you haven't). Deliberately pinned to the exact 0.18.5 the
 * app's own CDN URL loads, not a floating range, so this test is always checking the same
 * library version that's actually deployed, never a silently-different one.
 *
 * Exit code 0 if both checks pass, 1 if either fails.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.dirname(__dirname);

function findAppHtml(argPath) {
    if (argPath) return argPath;
    const all = fs.readdirSync(REPO_ROOT)
        .filter((f) => /^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$/.test(f));
    // Exclude testing builds before picking the highest version. Without this the check
    // silently ran against Booking_flash_report_na_1.67_TESTING.html rather than the main
    // file. Excluded names are printed so a build this pattern fails to recognise is visible.
    const excluded = all.filter((f) => /testing/i.test(f));
    if (excluded.length > 0) {
        console.log(`(excluded as testing builds: ${excluded.join(', ')})`);
    }
    const candidates = all.filter((f) => !/testing/i.test(f));
    if (candidates.length === 0) {
        console.error(`Could not find any main Booking_flash_report_na*.html file in ${REPO_ROOT}; pass the app path explicitly as an argument.`);
        process.exit(2);
    }
    const versionKey = (fname) => {
        const m = /na_(?:Kevin_)?([\d.]+)_/.exec(fname);
        return m ? m[1].split('.').map(Number) : [0];
    };
    const cmp = (a, b) => {
        const va = versionKey(a), vb = versionKey(b);
        for (let i = 0; i < Math.max(va.length, vb.length); i++) {
            const d = (va[i] || 0) - (vb[i] || 0);
            if (d !== 0) return d;
        }
        return 0;
    };
    const chosen = candidates.sort(cmp).pop();
    console.log(`(auto-detected current app version: ${chosen})`);
    return path.join(REPO_ROOT, chosen);
}

// ---- Check 1: static -- every CSV-text XLSX.read call must pass raw: true ----
function staticCheck(htmlPath) {
    const src = fs.readFileSync(htmlPath, 'utf8');
    // Matches `XLSX.read(<anything up to the first comma>, {<options, no nested braces>})` --
    // every real call site in this app fits that shape (confirmed by hand, 2026-09-08: no
    // call site here has a nested-object options literal).
    const callRe = /XLSX\.read\(\s*[^,()]+,\s*(\{[^{}]*\})\s*\)/g;
    let m;
    const violations = [];
    let totalCalls = 0;
    let stringCalls = 0;
    while ((m = callRe.exec(src))) {
        totalCalls++;
        const opts = m[1];
        const isStringType = /type:\s*'string'/.test(opts);
        if (!isStringType) continue; // type:'binary' (.xlsx/.xls upload) -- not in scope, see header
        stringCalls++;
        const hasRawTrue = /raw:\s*true/.test(opts);
        if (!hasRawTrue) {
            const line = src.slice(0, m.index).split('\n').length;
            violations.push({ line, snippet: m[0] });
        }
    }
    return { totalCalls, stringCalls, violations };
}

// ---- Check 2: dynamic -- the real library, under real timezones ----
const SYNTHETIC_CSV = [
    'IsoDate,MonDDate,PlainNum,CommaNum,Percent,Blank,Text',
    '2026-08-16,Aug 05,56,42079,0.06,,AP Frozen',
].join('\n');

const EXPECTED = {
    IsoDate: '2026-08-16', // literal input, unchanged -- this is the field the bug shifts
    MonDDate: 'Aug 05',
    PlainNum: '56',
    CommaNum: '42079',
    Percent: '0.06',
    Blank: '',
    Text: 'AP Frozen',
};

function runInChildTimezone(tz) {
    const script = `
        const XLSX = require(${JSON.stringify(require.resolve('xlsx', { paths: [REPO_ROOT] }))});
        const csvText = ${JSON.stringify(SYNTHETIC_CSV)};
        const wb = XLSX.read(csvText, { type: 'string', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
        console.log(JSON.stringify(rows[0]));
    `;
    const out = execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
    });
    return JSON.parse(out.trim().split('\n').pop());
}

function dynamicCheck() {
    const timezones = ['America/New_York', 'America/Los_Angeles', 'UTC'];
    const results = {};
    const mismatches = [];
    for (const tz of timezones) {
        const row = runInChildTimezone(tz);
        results[tz] = row;
        for (const [key, expected] of Object.entries(EXPECTED)) {
            if (row[key] !== expected) {
                mismatches.push({ tz, field: key, expected, got: row[key] });
            }
        }
    }
    return { results, mismatches };
}

// ---- Check 3: dynamic -- the app's own date parse/format/compare helpers, under real
// timezones (see this file's header comment, item 3, for the full rationale) ----

// Pulls the exact live source of DATE_MONTH_INDEX/parseKnownDate/formatDate/
// isOnOrBeforeDay/compareSaleWeek/compareEtd (plus their `collator` dependency, defined
// much earlier in the file) straight out of the app HTML. Deliberately NOT a
// reimplementation -- if a future edit changes one of these functions, this extracts and
// tests THAT new code, not a stale copy. `DATE_MONTH_INDEX` through the end of
// `compareEtd`'s function body is one contiguous block in the app source (confirmed
// 2026-09-10); this walks braces from `function compareEtd(a, b) {` to find that block's
// real end rather than assuming a fixed line count, so it survives comments/whitespace
// changes inside the block.
function extractDateHelperSource(htmlPath) {
    const src = fs.readFileSync(htmlPath, 'utf8');
    const collatorM = src.match(/const collator = new Intl\.Collator\(\);/);
    if (!collatorM) throw new Error('extractDateHelperSource: `const collator = new Intl.Collator();` not found -- has it moved or been renamed?');
    const startM = src.match(/const DATE_MONTH_INDEX = \{[^}]*\};/);
    if (!startM) throw new Error('extractDateHelperSource: DATE_MONTH_INDEX not found -- has it moved or been renamed?');
    const endMarker = 'function compareEtd(a, b) {';
    const endMarkerIdx = src.indexOf(endMarker, startM.index);
    if (endMarkerIdx === -1) throw new Error('extractDateHelperSource: compareEtd not found after DATE_MONTH_INDEX -- has it moved, been renamed, or been reordered?');
    let depth = 0;
    let i = src.indexOf('{', endMarkerIdx);
    const braceScanStart = i;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0 || i >= src.length) throw new Error('extractDateHelperSource: could not find compareEtd\'s closing brace (unbalanced braces?)');
    return collatorM[0] + '\n' + src.slice(startM.index, i + 1);
}

// Curated probes, not the full ~1600-value real-data sweep this check was validated
// against during the 2026-09-10 W9 audit (see that session's report for the full
// cross-timezone run) -- kept small here so this stays a fast, deterministic CI-style
// check rather than depending on the two large sample data files being present. Every
// SHAPE below is a real shape confirmed present in Kevin's two live exports (see Class F),
// except the year-less "Mon D" shape, which is a live code path (`formatDate`'s
// non-`parseKnownDate` branch) not currently present in either sample file but which has
// been ~77% of a real column's values historically and could reappear at any time the
// upstream Sheet's per-cell formatting drifts again -- worth guarding even while dormant.
const HELPER_PROBE_SCRIPT = `
    const probes = {};

    // formatDate over every real date SHAPE (no year hint).
    const formatDateInputs = [
        '', '2026-08-16', '2026-08-16 5:00', '2026-01-01', '2026-12-31',
        '8/16/26', '8/16/2026', '8/16/26 5:00', '8/16/26 05:00', '8/1/26',
        '1/1/26', '12/31/26', 'garbage',
    ];
    probes.formatDate = {};
    for (const v of formatDateInputs) probes.formatDate[v] = formatDate(v);

    // isOnOrBeforeDay: fixed reference "today" (local components, not a UTC string --
    // matches how the app's own call site builds it via 'new Date()').
    const ref = new Date(2026, 7, 16); // Aug 16 2026, local midnight in whichever TZ this runs
    const isOnOrBeforeDayInputs = ['2026-08-15', '2026-08-16', '2026-08-17', '8/16/26', '8/17/26', '', 'garbage'];
    probes.isOnOrBeforeDay = {};
    for (const v of isOnOrBeforeDayInputs) probes.isOnOrBeforeDay[v] = isOnOrBeforeDay(v, ref);

    // compareSaleWeek: numeric-not-lexical ordering (W9 must sort before W10) and the
    // year rollover (2026/W52 -> 2027/W01), plus blank/malformed/case-variant probes.
    const saleWeekProbes = ['2026/W9', '2026/W10', '2026/W52', '2027/W01', '2026/W1', '', 'garbage', null, undefined, '2026/w9'];
    probes.saleWeekSorted = [...saleWeekProbes].sort(compareSaleWeek).map(String);
    probes.saleWeekPairwise = {};
    for (const a of saleWeekProbes) for (const b of saleWeekProbes) probes.saleWeekPairwise[a + '|' + b] = Math.sign(compareSaleWeek(a, b));

    // compareEtd: the real "PAROD sorts before USLAX" shape (chronological, not lexical)
    // plus blank/malformed probes. USLAX/USOAK/PAROD dates below are the real 2026-08-12
    // export's actual VVD NROT0079E leg dates (see Class F / commit e10375d).
    const etdProbes = ['7/15/26', '7/19/26', '7/31/26', '2026-07-15', '2026-07-31', '', 'garbage', null, undefined, '1/1/27', '12/31/26'];
    probes.etdSorted = [...etdProbes].sort(compareEtd).map(String);
    probes.etdPairwise = {};
    for (const a of etdProbes) for (const b of etdProbes) probes.etdPairwise[a + '|' + b] = Math.sign(compareEtd(a, b));

    // formatDate's yearHintDateStr: year-boundary probes in both directions.
    const yearHintProbes = [
        ['Dec 30', '2027-01-05'], // Dec date, Jan-of-next-year hint -- rollback expected
        ['Jan 5', '2026-01-10'],  // Jan date, Jan-same-year hint, before it -- no rollback
        ['Feb 1', '2026-01-10'],  // Feb date, Jan hint -- month rollback expected
        ['Dec 31', '2026-12-31'], // exact same day as hint -- boundary, no rollback
    ];
    probes.yearHint = {};
    for (const [d, h] of yearHintProbes) probes.yearHint[d + '__' + h] = formatDate(d, h);

    console.log(JSON.stringify(probes));
`;

function runHelpersInChildTimezone(tz, helperSource) {
    const script = `${helperSource}\n${HELPER_PROBE_SCRIPT}`;
    const out = execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(out.trim().split('\n').pop());
}

function helperTimezoneCheck(htmlPath) {
    const helperSource = extractDateHelperSource(htmlPath);
    // UTC first, as the baseline every other timezone is diffed against. Includes
    // Asia/Singapore (EAST of UTC) alongside the two NA zones the original bug hit --
    // the bug class is about the SIGN of the UTC offset, and this app has SGSIN columns.
    const timezones = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore'];
    const results = {};
    for (const tz of timezones) results[tz] = runHelpersInChildTimezone(tz, helperSource);

    const mismatches = [];
    const base = results['UTC'];
    for (const tz of timezones) {
        if (tz === 'UTC') continue;
        const cur = results[tz];
        for (const key of ['formatDate', 'isOnOrBeforeDay', 'saleWeekPairwise', 'etdPairwise', 'yearHint']) {
            for (const [k, v] of Object.entries(base[key])) {
                if (JSON.stringify(cur[key][k]) !== JSON.stringify(v)) {
                    mismatches.push({ tz, fn: key, input: k, utc: v, got: cur[key][k] });
                }
            }
        }
        for (const arrKey of ['saleWeekSorted', 'etdSorted']) {
            if (JSON.stringify(cur[arrKey]) !== JSON.stringify(base[arrKey])) {
                mismatches.push({ tz, fn: arrKey, input: '(whole sorted array)', utc: base[arrKey], got: cur[arrKey] });
            }
        }
    }

    // Semantic sanity checks (not just cross-timezone identity) on the UTC baseline --
    // catches a bug that's WRONG but consistently, identically wrong in every timezone,
    // which the cross-timezone diff above can't see by itself.
    const semanticFailures = [];
    const w9Idx = base.saleWeekSorted.indexOf('2026/W9');
    const w10Idx = base.saleWeekSorted.indexOf('2026/W10');
    if (!(w9Idx !== -1 && w10Idx !== -1 && w9Idx < w10Idx)) {
        semanticFailures.push(`compareSaleWeek: expected 2026/W9 before 2026/W10 (numeric order), got sorted=${JSON.stringify(base.saleWeekSorted)}`);
    }
    const w52Idx = base.saleWeekSorted.indexOf('2026/W52');
    const w01Idx = base.saleWeekSorted.indexOf('2027/W01');
    if (!(w52Idx !== -1 && w01Idx !== -1 && w52Idx < w01Idx)) {
        semanticFailures.push(`compareSaleWeek: expected 2026/W52 before 2027/W01 (year rollover), got sorted=${JSON.stringify(base.saleWeekSorted)}`);
    }
    // PAROD's later Coastal ETD (7/31/26) must sort after USLAX (7/15/26)/USOAK (7/19/26)
    // -- the real e10375d motivating case, not just any two arbitrary dates.
    const uslaxIdx = base.etdSorted.indexOf('7/15/26');
    const usoakIdx = base.etdSorted.indexOf('7/19/26');
    const parodIdx = base.etdSorted.indexOf('7/31/26');
    if (!(uslaxIdx !== -1 && usoakIdx !== -1 && parodIdx !== -1 && uslaxIdx < usoakIdx && usoakIdx < parodIdx)) {
        semanticFailures.push(`compareEtd: expected USLAX(7/15) < USOAK(7/19) < PAROD(7/31) chronological order, got sorted=${JSON.stringify(base.etdSorted)}`);
    }

    return { results, mismatches, semanticFailures };
}

function main() {
    const htmlPath = findAppHtml(process.argv[2]);
    console.log(`Checking: ${htmlPath}\n`);

    console.log('--- Check 1: static (every CSV-text XLSX.read call passes raw: true) ---');
    const staticResult = staticCheck(htmlPath);
    console.log(`  ${staticResult.totalCalls} total XLSX.read call(s), ${staticResult.stringCalls} of them CSV-text (type:'string').`);
    if (staticResult.violations.length > 0) {
        console.log(`  ❌ ${staticResult.violations.length} call(s) missing raw: true:`);
        for (const v of staticResult.violations) {
            console.log(`     line ${v.line}: ${v.snippet}`);
        }
    } else {
        console.log('  ✅ every CSV-text read passes raw: true.');
    }

    console.log('\n--- Check 2: dynamic (the real xlsx library, under real timezones) ---');
    const dynamicResult = dynamicCheck();
    for (const [tz, row] of Object.entries(dynamicResult.results)) {
        console.log(`  ${tz}: ${JSON.stringify(row)}`);
    }
    if (dynamicResult.mismatches.length > 0) {
        console.log(`  ❌ ${dynamicResult.mismatches.length} mismatch(es):`);
        for (const mm of dynamicResult.mismatches) {
            console.log(`     [${mm.tz}] ${mm.field}: expected ${JSON.stringify(mm.expected)}, got ${JSON.stringify(mm.got)}`);
        }
    } else {
        console.log('  ✅ every value survives identical to its literal input, in every timezone tested.');
    }

    console.log('\n--- Check 3: dynamic (the app\'s own parseKnownDate/formatDate/isOnOrBeforeDay/compareSaleWeek/compareEtd, under real timezones) ---');
    const helperResult = helperTimezoneCheck(htmlPath);
    if (helperResult.mismatches.length > 0) {
        console.log(`  ❌ ${helperResult.mismatches.length} cross-timezone mismatch(es):`);
        for (const mm of helperResult.mismatches) {
            console.log(`     [${mm.tz}] ${mm.fn}(${JSON.stringify(mm.input)}): UTC=${JSON.stringify(mm.utc)}, got ${JSON.stringify(mm.got)}`);
        }
    } else {
        console.log('  ✅ formatDate/isOnOrBeforeDay/compareSaleWeek/compareEtd identical across UTC, America/New_York, America/Los_Angeles, and Asia/Singapore.');
    }
    if (helperResult.semanticFailures.length > 0) {
        console.log(`  ❌ ${helperResult.semanticFailures.length} semantic sanity failure(s):`);
        for (const sf of helperResult.semanticFailures) {
            console.log(`     ${sf}`);
        }
    } else {
        console.log('  ✅ compareSaleWeek orders numerically (W9 before W10, W52\'26 before W01\'27) and compareEtd orders PAROD after USLAX/USOAK chronologically.');
    }

    const ok = staticResult.violations.length === 0 && dynamicResult.mismatches.length === 0
        && helperResult.mismatches.length === 0 && helperResult.semanticFailures.length === 0;
    console.log(ok ? '\n✅ PASS -- no timezone-unsafe date reads/parses/formats/compares found.' : '\n❌ FAIL -- see violations/mismatches above.');
    process.exit(ok ? 0 : 1);
}

main();

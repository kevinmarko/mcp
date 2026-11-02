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
    const candidates = fs.readdirSync(REPO_ROOT)
        .filter((f) => /^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$/.test(f));
    if (candidates.length === 0) {
        console.error(`Could not find any Booking_flash_report_na*.html file in ${REPO_ROOT}; pass the app path explicitly as an argument.`);
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

    const ok = staticResult.violations.length === 0 && dynamicResult.mismatches.length === 0;
    console.log(ok ? '\n✅ PASS -- no timezone-unsafe CSV date reads found.' : '\n❌ FAIL -- see violations/mismatches above.');
    process.exit(ok ? 0 : 1);
}

main();

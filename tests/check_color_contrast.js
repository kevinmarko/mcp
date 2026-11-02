#!/usr/bin/env node
/**
 * Text-contrast check for the app's Tailwind colour pairs (2026-10-08).
 *
 * WHY. The SPC PIC and Yard slicer chips shipped white text on #ed7d31, 2.8:1, and every faded chip
 * (a slicer with a sibling selected) was dimmed to about 2:1 by a whole-button opacity-40. Two
 * buttons drew white on orange-600 (3.6:1) and one white on yellow-600 (2.9:1). Nothing failed:
 * the only readability check (findUnreadableCells in the regression suite) looks for exactly white
 * text on a white or transparent <td>. WCAG AA asks 4.5:1 for normal-size text; this holds the
 * app to it.
 *
 * WHAT IT CHECKS.
 *   A. Slicer chips. Every tone in SLICER_TONES and every AP_STATUS_CONFIG chip, solid and faded,
 *      the grey SLICER_INVALID chip (selected, but the other filters leave it no row),
 *      in light and dark mode, on the slicer panel's own background (PANEL below). Every
 *      <SlicerBtn> names a tone that exists and uses no bgClass/textClass prop (the optional
 *      text-colour prop is how the orange bug happened).
 *   B. Every class string in the app that sets both a fill (bg-*) and a text colour (text-*):
 *      the pair must reach 4.5:1, in light mode and, where dark: classes are given, in dark mode.
 *      A template literal's static text is also combined with each string branch inside it, so
 *      `text-white ${on ? 'bg-x' : 'bg-y'}` is checked as both pairs. A fill with an alpha
 *      (bg-x/40) is skipped here (its colour depends on what is behind it); part A covers the
 *      slicer ones, and the regression suite's Slicer_Contrast measures the real rendered page.
 *      A Tailwind palette colour this file does not know fails the check: add its hex to PALETTE.
 *   C. A self-test that the checker flags the original bugs, so it cannot pass vacuously.
 *
 * LIMITS. Static only: a fill and a text colour set in different strings or variables are not
 * paired (SlicerBtn's are, through part A). Hover/focus colours are not checked.
 *
 * Run:  node tests/check_color_contrast.js [app.html]   (default: the current app file)
 * Needs npm ci (@babel/parser, @babel/traverse). Exit code 0 = all pairs pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { findCurrentAppHtml, REPO_ROOT } = require('../scripts/lib/app_file.js');

const MIN_RATIO = 4.5;
// A disabled control is exempt (WCAG 1.4.3 excludes inactive user-interface components); the app marks
// every disabled styling with cursor-not-allowed.
const DISABLED_MARK = /(^|\s)cursor-not-allowed(\s|$)/;
// Pre-existing pairs below 4.5:1 that Kevin chose to keep (docs/DECISIONS.md D29, 2026-10-08): each one
// mirrors a colour from the Excel reference workbook or a deliberate palette. Matched by a fragment of the
// class string plus the exact pair. An entry that no longer matches anything fails the check, so a fixed
// one cannot linger here. Found 2026-10-08 by the first run of this check.
const KNOWN_EXCEPTIONS = [
    { fragment: "bg-[#a9d08e] dark:bg-[#3d5a34] dark:text-gray-400", text: 'dark:text-gray-400', bg: 'dark:bg-[#3d5a34]',
        why: 'MacroToggleBtn "shown" state in dark mode (3.05:1); dimmed label looks deliberate' },
    { fragment: 'font-bold text-[#3172C4]', text: 'text-[#3172C4]', bg: 'bg-[#DDD9C3]',
        why: 'POL "Coastal ETA vs Proforma" cell, Excel reference colours (3.41:1)' },
    { fragment: 'font-bold bg-[#DA9694]', text: 'text-red-600', bg: 'bg-[#DA9694]',
        why: 'Sector Summary Utilization over 100%, Excel reference colours (2.02:1)' },
];
// Slicer tones whose SOLID (at rest / selected) pair Kevin chose to keep below 4.5:1 (docs/DECISIONS.md D31, 2026-10-08): SPC PIC's
// original white text on #ed7d31. Matched by tone name AND the exact pair, only for the solid state (its faded chip is still held to
// 4.5:1), and only the listed slicers may use the tone (checked at the call sites). An entry that no longer matches fails the check.
const TONE_EXCEPTIONS = {
    orangeLegacy: { bg: 'bg-[#ed7d31]', text: 'text-white', slicers: ['spc-pic'],
        why: 'SPC PIC chips keep their original white text on #ed7d31 (2.77:1), per Kevin (D31)' },
};
const toneExceptionUsed = new Set();
// The slicer panel the chips sit on: `bg-[#e7e6e6] dark:bg-gray-800`.
const PANEL = { light: '#e7e6e6', dark: '#1f2937' };
// Text colour ApStatusMacroBtn gives a solid (unfaded) chip, hardcoded in its className.
const AP_SOLID_TEXT = 'text-black';

// The brand colour `one` (bg-one, text-one, ...): read from the app's own `window.ONE_BRAND` in the
// <head> once the app file is loaded below, so this check never holds a second copy of the hex.
let ONE_HEX = null;

// Tailwind v3 default palette, the families the app uses. Unknown colours fail rather than pass.
const PALETTE = {
    white: '#ffffff', black: '#000000',
    gray: { 50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827', 950: '#030712' },
    slate: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617' },
    red: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a' },
    orange: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12', 950: '#431407' },
    amber: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03' },
    yellow: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207', 800: '#854d0e', 900: '#713f12', 950: '#422006' },
    green: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d', 950: '#052e16' },
    emerald: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22' },
    blue: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a', 950: '#172554' },
    indigo: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b' },
    purple: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 500: '#a855f7', 600: '#9333ea', 700: '#7e22ce', 800: '#6b21a8', 900: '#581c87', 950: '#3b0764' },
    pink: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843', 950: '#500724' },
};

// ---- colour maths (WCAG 2.x) ----
const hexToRgb = (h) => { const x = h.replace('#', ''); const f = x.length === 3 ? x.split('').map(c => c + c).join('') : x; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)); };
const channel = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

/**
 * One Tailwind colour utility (`bg-…` or `text-…`, no variant prefix) -> { rgb, alpha } or
 * { unknown } for a palette colour this file lacks, or null when it is not a colour at all
 * (bg-clip-text, text-xs, text-center, …).
 */
function resolveColor(cls, kind) {
    const m = cls.match(new RegExp(`^${kind}-(.+?)(?:/(\\d+))?$`));
    if (!m) return null;
    const [, name, pct] = m;
    const alpha = pct === undefined ? 1 : Number(pct) / 100;
    const arb = name.match(/^\[(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\]$/);
    if (arb) return { rgb: hexToRgb(arb[1]), alpha };
    if (name === 'white' || name === 'black') return { rgb: hexToRgb(PALETTE[name]), alpha };
    if (name === 'one') return ONE_HEX ? { rgb: hexToRgb(ONE_HEX), alpha } : { unknown: `${kind}-one (no window.ONE_BRAND.magenta found in the app)` };
    const fam = name.match(/^([a-z]+)-(\d{2,3})$/);
    if (!fam) return null;
    const family = PALETTE[fam[1]];
    if (family && family[fam[2]]) return { rgb: hexToRgb(family[fam[2]]), alpha };
    // Looks like a palette colour but is not in PALETTE. Text sizes etc. never match family-NNN.
    return { unknown: `${kind}-${name}` };
}

/** The light- and dark-mode fill and text colour a class string sets (last one wins, as in CSS order of a list). */
function colorsOf(classString) {
    const out = { bg: {}, text: {} };
    for (const tok of classString.split(/\s+/)) {
        const dark = tok.startsWith('dark:');
        const bare = dark ? tok.slice(5) : tok;
        if (bare.includes(':')) continue; // hover:, focus:, sm:, dark:hover: … not checked
        for (const kind of ['bg', 'text']) {
            const c = resolveColor(bare, kind);
            if (c) out[kind][dark ? 'dark' : 'light'] = { ...c, cls: tok };
        }
    }
    return out;
}

/** Contrast of one class string's pair(s): [{ mode, ratio, bg, text }] or [{ unknown }]. Empty when it sets no pair. */
function pairsOf(classString) {
    const { bg, text } = colorsOf(classString);
    const res = [];
    for (const mode of ['light', 'dark']) {
        const b = mode === 'dark' ? (bg.dark || bg.light) : bg.light;
        const t = mode === 'dark' ? (text.dark || text.light) : text.light;
        if (!b || !t) continue;
        if (mode === 'dark' && !bg.dark && !text.dark) continue; // same pair as light
        if (b.unknown || t.unknown) { res.push({ mode, unknown: b.unknown || t.unknown }); continue; }
        if (b.alpha < 1 || t.alpha < 1) continue; // depends on the backdrop; see header
        res.push({ mode, ratio: contrast(b.rgb, t.rgb), bg: b.cls, text: t.cls });
    }
    return res;
}

/** A chip's ratio on the slicer panel: fill (maybe translucent) over the panel, text over that. */
function chipRatio(bgClasses, textClasses, mode) {
    const { bg, text } = colorsOf(`${bgClasses} ${textClasses}`);
    const b = mode === 'dark' ? (bg.dark || bg.light) : bg.light;
    const t = mode === 'dark' ? (text.dark || text.light) : text.light;
    if (!b || !t || b.unknown || t.unknown) return { error: `cannot resolve ${bgClasses} / ${textClasses} (${mode})` };
    const panel = hexToRgb(PANEL[mode]);
    const fill = over(b.rgb, b.alpha, panel);
    return { ratio: contrast(over(t.rgb, t.alpha, fill), fill) };
}

const failures = [];
let checked = 0;
const fail = (msg) => failures.push(msg);

// ---- C. self-test first: the checker must catch the bugs it exists for ----
{
    const r = (s) => pairsOf(s).map(p => p.ratio);
    const cases = [
        ['bg-[#ed7d31] text-white', (x) => x[0] < MIN_RATIO, 'white on #ed7d31 (the original slicer bug) is flagged'],
        ['bg-orange-600 text-white', (x) => x[0] < MIN_RATIO, 'white on orange-600 is flagged'],
        ['bg-yellow-600 text-white', (x) => x[0] < MIN_RATIO, 'white on yellow-600 is flagged'],
        ['bg-[#ed7d31] text-black', (x) => x[0] >= MIN_RATIO, 'black on #ed7d31 passes'],
        ['bg-white dark:bg-gray-800 text-gray-900 dark:text-[#ed7d31]', (x) => x.length === 2, 'a string with dark: variants yields a light and a dark pair'],
        ['px-1 text-xs bg-clip-text text-center', (x) => x.length === 0, 'non-colour bg-/text- utilities are not pairs'],
    ];
    for (const [s, ok, what] of cases) { checked++; if (!ok(r(s))) fail(`self-test: ${what} -- got ${JSON.stringify(pairsOf(s))}`); }
    checked++;
    const old = hexToRgb('#ed7d31'), white = hexToRgb('#ffffff'), panel = hexToRgb(PANEL.light);
    const fadedOld = contrast(over(white, 0.4, over(old, 0.4, panel)), over(old, 0.4, panel));
    if (!(fadedOld < MIN_RATIO)) fail(`self-test: the old opacity-40 fade should measure under ${MIN_RATIO}, got ${fadedOld.toFixed(2)}`);
}

// ---- load and parse the app ----
const appArg = process.argv[2];
const appPath = appArg ? path.resolve(appArg) : findCurrentAppHtml();
const html = fs.readFileSync(appPath, 'utf8');
{ const brand = html.match(/window\.ONE_BRAND\s*=\s*\{\s*magenta:\s*'(#[0-9a-fA-F]{6})'/); ONE_HEX = brand ? brand[1] : null; }
const scriptMatch = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error(`${appPath}: no <script type="text/babel"> block`); process.exit(1); }
const scriptStartLine = html.slice(0, scriptMatch.index).split('\n').length - 1;
const ast = parse(scriptMatch[1], { sourceType: 'script', plugins: ['jsx'], errorRecovery: false });
const lineOf = (node) => node.loc.start.line + scriptStartLine;
console.log(`(checking ${path.relative(REPO_ROOT, appPath)})`);

// ---- A. slicer tones, AP chips, SlicerBtn call sites ----
const literal = (node) => node && (node.type === 'StringLiteral' ? node.value : null);
const objectOf = (node) => {
    const o = {};
    for (const p of node.properties) { const k = p.key.name || p.key.value; o[k] = p.value.type === 'ObjectExpression' ? objectOf(p.value) : literal(p.value); }
    return o;
};
let tones = null, fadedText = null, apConfig = null, invalid = null;
const slicerCalls = [];
traverse(ast, {
    VariableDeclarator(p) {
        const id = p.node.id.name, init = p.node.init;
        if (id === 'SLICER_TONES' && init && init.type === 'ObjectExpression') tones = objectOf(init);
        if (id === 'SLICER_FADED_TEXT') fadedText = literal(init);
        if (id === 'SLICER_INVALID' && init && init.type === 'ObjectExpression') invalid = objectOf(init);
        if (id === 'AP_STATUS_CONFIG' && init && init.type === 'ArrayExpression') apConfig = init.elements.map(objectOf);
    },
    JSXOpeningElement(p) {
        if (p.node.name.name !== 'SlicerBtn') return;
        const attrs = Object.fromEntries(p.node.attributes.filter(a => a.type === 'JSXAttribute').map(a => [a.name.name, a.value]));
        slicerCalls.push({ line: lineOf(p.node), attrs });
    },
});
checked++;
if (!tones || !Object.keys(tones).length) fail('SLICER_TONES not found as an object literal (SlicerBtn colours must come from it)');
checked++;
if (!fadedText) fail('SLICER_FADED_TEXT not found as a string literal');
checked++;
if (!apConfig || !apConfig.length) fail('AP_STATUS_CONFIG not found as an array literal');
checked++;
if (!invalid || !invalid.bg || !invalid.text) fail('SLICER_INVALID not found as an object literal with bg and text (the grey "selected but no rows" chip)');
else {
    for (const mode of ['light', 'dark']) {
        checked++;
        const r = chipRatio(invalid.bg, invalid.text, mode);
        if (r.error) fail(`SLICER_INVALID ${mode}: ${r.error}`);
        else if (r.ratio < MIN_RATIO) fail(`SLICER_INVALID ${mode}: ${invalid.text} on ${invalid.bg} is ${r.ratio.toFixed(2)}:1, below ${MIN_RATIO}:1`);
    }
}
if (tones && fadedText) {
    for (const [name, t] of Object.entries(tones)) {
        for (const mode of ['light', 'dark']) {
            for (const [state, bgc, txt] of [['solid', t.bg, t.text], ['faded', t.faded, fadedText]]) {
                checked++;
                if (!bgc || !txt) { fail(`SLICER_TONES.${name}: missing ${state === 'solid' ? 'bg/text' : 'faded'}`); continue; }
                const r = chipRatio(bgc, txt, mode);
                if (r.error) fail(`SLICER_TONES.${name} ${state} ${mode}: ${r.error}`);
                else if (r.ratio < MIN_RATIO) {
                    const ex = TONE_EXCEPTIONS[name];
                    if (state === 'solid' && ex && ex.bg === bgc && ex.text === txt) toneExceptionUsed.add(name);
                    else fail(`SLICER_TONES.${name} ${state} ${mode}: ${txt} on ${bgc} is ${r.ratio.toFixed(2)}:1, below ${MIN_RATIO}:1`);
                }
            }
        }
    }
}
if (apConfig && fadedText) {
    for (const ap of apConfig) {
        for (const mode of ['light', 'dark']) {
            for (const [state, bgc, txt] of [['solid', ap.bgClass, AP_SOLID_TEXT], ['faded', ap.fadedBgClass, fadedText]]) {
                checked++;
                if (!bgc) { fail(`AP_STATUS_CONFIG ${ap.key}: no ${state === 'solid' ? 'bgClass' : 'fadedBgClass'}`); continue; }
                const r = chipRatio(bgc, txt, mode);
                if (r.error) fail(`AP_STATUS_CONFIG ${ap.key} ${state} ${mode}: ${r.error}`);
                else if (r.ratio < MIN_RATIO) fail(`AP_STATUS_CONFIG ${ap.key} ${state} ${mode}: ${txt} on ${bgc} is ${r.ratio.toFixed(2)}:1, below ${MIN_RATIO}:1`);
            }
        }
    }
}
checked++;
if (!html.includes('`${bgClass} text-black`')) fail(`ApStatusMacroBtn no longer draws a solid chip as \`\${bgClass} text-black\`; update AP_SOLID_TEXT in this check to what it does now`);
checked++;
if (slicerCalls.length === 0) fail('no <SlicerBtn> call sites found');
for (const { line, attrs } of slicerCalls) {
    checked++;
    if (attrs.bgClass || attrs.textClass) fail(`line ${line}: <SlicerBtn> takes a tone, not bgClass/textClass (the fill and its text colour are paired in SLICER_TONES)`);
    const tone = literal(attrs.tone);
    if (!tone) fail(`line ${line}: <SlicerBtn> needs a literal tone="..." prop`);
    else if (tones && !(tone in tones)) fail(`line ${line}: <SlicerBtn tone="${tone}"> is not in SLICER_TONES (${Object.keys(tones).join(', ')})`);
    if (!literal(attrs.slicer)) fail(`line ${line}: <SlicerBtn> needs a literal slicer="..." prop (data-slicer, used by the tests)`);
}

for (const [name, ex] of Object.entries(TONE_EXCEPTIONS)) {
    checked++;
    if (!toneExceptionUsed.has(name)) fail(`TONE_EXCEPTIONS.${name} no longer matches a tone below ${MIN_RATIO}:1 (fixed or moved? remove it): ${ex.why}`);
    for (const { line, attrs } of slicerCalls) {
        if (literal(attrs.tone) === name && !ex.slicers.includes(literal(attrs.slicer))) {
            fail(`line ${line}: <SlicerBtn tone="${name}"> is only allowed on ${ex.slicers.join(', ')} (D31), not slicer="${literal(attrs.slicer)}"`);
        }
    }
    checked++;
    if (!slicerCalls.some(c => literal(c.attrs.tone) === name)) fail(`no <SlicerBtn> uses tone="${name}" any more, so TONE_EXCEPTIONS.${name} is stale: ${ex.why}`);
}

// ---- B. every class string that sets a fill and a text colour ----
const candidates = []; // { line, classes }
const leafStrings = (node, acc = []) => {
    if (!node) return acc;
    if (node.type === 'StringLiteral') acc.push(node.value);
    else if (node.type === 'ConditionalExpression') { leafStrings(node.consequent, acc); leafStrings(node.alternate, acc); }
    else if (node.type === 'LogicalExpression') leafStrings(node.right, acc);
    else if (node.type === 'TemplateLiteral') acc.push(node.quasis.map(q => q.value.cooked).join(' '));
    return acc;
};
traverse(ast, {
    StringLiteral(p) { candidates.push({ line: lineOf(p.node), classes: p.node.value }); },
    TemplateLiteral(p) {
        const base = p.node.quasis.map(q => q.value.cooked).join(' ');
        candidates.push({ line: lineOf(p.node), classes: base });
        for (const e of p.node.expressions) for (const s of leafStrings(e)) candidates.push({ line: lineOf(e), classes: `${base} ${s}` });
    },
});
const seen = new Set();
const exceptionUsed = new Set();
let pairs = 0, exempted = 0;
for (const { line, classes } of candidates) {
    for (const pr of pairsOf(classes)) {
        const key = `${line}|${pr.mode}|${pr.bg}|${pr.text}|${pr.unknown}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checked++; pairs++;
        if (pr.unknown) { fail(`line ${line}: ${pr.unknown} is not in this check's PALETTE; add its Tailwind hex (in "${classes.trim().slice(0, 100)}")`); continue; }
        if (pr.ratio >= MIN_RATIO) continue;
        if (DISABLED_MARK.test(classes)) { exempted++; continue; }
        const known = KNOWN_EXCEPTIONS.find(x => classes.includes(x.fragment) && x.text === pr.text && x.bg === pr.bg);
        if (known) { exceptionUsed.add(known); exempted++; continue; }
        fail(`line ${line} (${pr.mode}): ${pr.text} on ${pr.bg} is ${pr.ratio.toFixed(2)}:1, below ${MIN_RATIO}:1 (in "${classes.trim().replace(/\s+/g, ' ').slice(0, 120)}")`);
    }
}
for (const x of KNOWN_EXCEPTIONS) {
    checked++;
    if (!exceptionUsed.has(x)) fail(`KNOWN_EXCEPTIONS entry no longer matches anything (fixed or moved? remove it): ${x.why}`);
}
checked++;
if (pairs < 20) fail(`only ${pairs} fill/text pairs found in the app; the scan has probably stopped seeing class strings`);

console.log(`Slicer tones: ${tones ? Object.keys(tones).length : 0}, AP chips: ${apConfig ? apConfig.length : 0}, <SlicerBtn> call sites: ${slicerCalls.length}, class-string fill/text pairs: ${pairs} (${exempted} below ${MIN_RATIO}:1 exempted: disabled, or a KNOWN_EXCEPTIONS entry)`);
if (failures.length) {
    console.error(`\n❌ ${failures.length} contrast failure(s) out of ${checked} checks (minimum ${MIN_RATIO}:1, WCAG AA normal text):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`✅ ${checked}/${checked} contrast checks passed (minimum ${MIN_RATIO}:1)`);

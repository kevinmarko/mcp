#!/usr/bin/env node
/**
 * Headless check of the masthead doodle's pure half (D69 and the seasonal scenes after it): which scene shows on a given date, the scenes
 * themselves, and the CSS data URI each one becomes. The doodle is the masthead's CSS background, so nothing in the live regression suite can
 * see more than the wiring (and that suite's window is narrower than the 1500px the doodle needs); this is where the scene content is checked.
 *
 * WHAT IT RUNS. The code between the marker lines
 *     // >>> BEGIN MASTHEAD DOODLE     and     // <<< END MASTHEAD DOODLE
 * in the app file: BFD_SCHEDULE, bfdSceneKeyFor, BFD_SCENES, bfdImageUrl, bfdMastheadScene and the helpers they use. It is cut out and evaluated in a
 * `vm` sandbox with ONE_MAGENTA stubbed (the app takes it from window.ONE_BRAND, which is set in the page head), a stub `window.location` for the
 * `?headerScene=<key>` override and a pinned `Date` for "today". Nothing is copied: change the scenes in the app and this runs the new code.
 * If the app has no marker lines, the cut falls back to the span from `function bfdDefs(` to the end of `function bfdMastheadScene()`; put the
 * markers in so a helper added above or below that span cannot be missed.
 *
 *   node tests/check_masthead_doodle.js                 the main app file (resolved like every other check)
 *   node tests/check_masthead_doodle.js <app file>      that file
 *
 * WHAT IT ASSERTS (all in pure JS, no browser, no binary such as xmllint):
 *   - the date table: Oct 31 -> halloween (the default), Nov 1-3 -> muertos, Nov 4-30 -> autumn, Dec 1 and Jan 1 and Oct 1 -> halloween, in every
 *     year (so a leap day and a year boundary are covered), reading only getMonth() and getDate();
 *   - bfdMastheadScene(): today's key, a `?headerScene=<key>` override for a known key, an unknown key ignored;
 *   - for each scene x light/dark: the data URI is safe inside a CSS url("...") (no raw double quote, #, backslash or newline), decodes, is
 *     well-formed XML by a tag-balance parse, has the root the CSS relies on (viewBox "-70 0 1900 48", xMidYMax meet), contains no <text,
 *     <image, <script, <foreignObject, event attributes or external references, has unique ids with every url(#id) resolving, has no dead
 *     keyframes or rules, stays under a byte budget, and a second call returns the identical string;
 *   - the three scenes are different from each other, and light differs from dark.
 *   - D83, the idle still image (sections 8-10): bfdImageUrl(dark, key, true) is the same scene with every animation taken out (no <style>, no class
 *     attributes, no animation, same shapes, smaller, cached under its own key, 'none' when a block fails); bfdWatchIdle(el, dark, idleMs) is driven
 *     with a fake clock, fake window / document / IntersectionObserver / matchMedia and an element stub (idle timer, the six input events, the
 *     once-a-second throttle, hidden tab, off-screen masthead, cleanup, reduced motion, null element, no IntersectionObserver, built once); and the page
 *     wiring is read from the HTML (the 1500px CSS rule, the useEffect with [darkMode], BFD_IDLE_MS in range).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { findCurrentAppHtml } = require('../scripts/lib/app_file.js');

const REPO_ROOT = path.dirname(__dirname);

// The byte budget for one data URI (the whole `url("data:...")` string, which is all ASCII, so bytes = characters). The measured size of the
// Halloween scene, dark (the larger theme), with whitespace collapsed and only the characters a CSS url("...") needs escaped (% # < > and " -> '), is
// 16,442 bytes (light is 15,835), with the animation CSS written compact and the gradients a theme does not draw dropped (2026-10-29); +25% is 20,552, rounded to
// 20,550. The old encodeURIComponent of the same scene is 33,328 bytes, so the budget also pins the lighter encoding. A scene that cannot fit raises this number on purpose.
const BUDGET_BYTES = 20550;
const SCENE_KEYS = ['halloween', 'muertos', 'autumn'];

function resolveAppHtml(arg) {
    if (arg) return path.resolve(arg);
    try {
        const resolved = findCurrentAppHtml();
        console.log(`(auto-detected current app version: ${path.basename(resolved)})`);
        return resolved;
    } catch (err) {
        console.error(`${err.message} (in ${REPO_ROOT}); pass the app path explicitly as an argument.`);
        process.exit(1);
    }
}
const appPath = resolveAppHtml(process.argv[2]);
console.log(`Checking: ${appPath}\n`);

let failures = 0, checks = 0;
const check = (name, ok, detail) => {
    checks++;
    if (ok) { console.log(`  ✅ ${name}`); return; }
    failures++;
    console.log(`  ❌ ${name}`);
    if (detail !== undefined) console.log(`     ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600)}`);
};
const section = (t) => console.log(`\n${t}`);
const fail = (msg) => { console.log(`\n❌ FAIL -- ${msg}`); process.exit(1); };

// ---- cut the doodle code out of the app file ----
const html = fs.readFileSync(appPath, 'utf8');
const scriptMatch = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!scriptMatch) fail('no <script type="text/babel"> in the app file');
const appScript = scriptMatch[1];

// Matching close brace for the first `{` at or after `from`, skipping strings, template literals (with ${} nesting), comments and regex-free code well enough for the doodle code.
function endOfBlock(src, from) {
    let i = src.indexOf('{', from), depth = 0;
    const stack = [];   // 'b' for a brace, 't' for a template literal
    for (; i < src.length; i++) {
        const c = src[i], top = stack[stack.length - 1];
        if (top === 't') {
            if (c === '\\') { i++; continue; }
            if (c === '`') { stack.pop(); continue; }
            if (c === '$' && src[i + 1] === '{') { stack.push('b'); i++; depth++; continue; }
            continue;
        }
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (c === '"' || c === "'") { const q = c; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; continue; }
        if (c === '`') { stack.push('t'); continue; }
        if (c === '{') { stack.push('b'); depth++; continue; }
        if (c === '}') { stack.pop(); depth--; if (depth === 0) return i + 1; }
    }
    return -1;
}
let region, how;
{
    const open = '// >>> BEGIN MASTHEAD DOODLE', close = '// <<< END MASTHEAD DOODLE';
    const n = appScript.split(open).length - 1, m = appScript.split(close).length - 1;
    if (n === 1 && m === 1) {
        const a = appScript.indexOf('\n', appScript.indexOf(open)) + 1;
        region = appScript.slice(a, appScript.indexOf(close));
        how = 'marker lines';
    } else if (n === 0 && m === 0) {
        const a = appScript.indexOf('function bfdDefs(');
        const b = appScript.indexOf('function bfdMastheadScene(');
        if (a >= 0 && b >= 0) {
            const e = endOfBlock(appScript, b);
            if (e > 0) { region = appScript.slice(a, e); how = 'fallback span (no marker lines)'; }
        }
    } else {
        fail(`the marker lines are not exactly one BEGIN and one END (found ${n} and ${m})`);
    }
}
check('the doodle code can be found in the app file (between the MASTHEAD DOODLE marker lines, or from bfdDefs to the end of bfdMastheadScene)', !!region,
    'neither the marker lines nor function bfdDefs( ... function bfdMastheadScene( exist yet: the seasonal-scene change has not been integrated');
if (!region) { console.log(`\n${failures} of ${checks} checks failed`); process.exit(1); }
console.log(`  (cut by ${how}: ${region.length} characters)`);

// ---- the inert scene blocks (type text/x-bfd-scene), read out of the page ----
// Each scene's drawing code is NOT in the app script: it is a block the browser neither compiles nor runs, which the app turns into a running script
// (bfdSceneFn) only for the scene showing. Read their text here, the way the browser would hand it to `block.text`.
const SCENE_BLOCK_RE = /<script type="text\/x-bfd-scene" id="([^"]*)">([\s\S]*?)<\/script>/g;
const SCENE_TEXT = {};     // id -> text of the block, exactly as in the page
const SCENE_ORDER = [];    // ids in page order
for (const m of html.matchAll(SCENE_BLOCK_RE)) { SCENE_TEXT[m[1]] = m[2]; SCENE_ORDER.push(m[1]); }
const sceneId = (k) => 'bfd-scene-' + k;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- evaluate it in a sandbox ----
const NAMES = ['BFD_SCHEDULE', 'bfdSceneKeyFor', 'BFD_SCENES', 'bfdSceneFn', 'bfdImageUrl', 'bfdMastheadScene', 'bfdMastheadStyle'];
const EXTRA_NAMES = ['BFD_IDLE_MS', 'bfdWatchIdle'];     // D83, exported too but checked on their own below, so the check above keeps its meaning
let NOW = new Date(2026, 9, 29, 12, 0, 0);    // "today" for bfdMastheadScene, moved by the tests below
class PinnedDate extends Date {
    constructor(...a) { if (a.length === 0) super(NOW.getTime()); else super(...a); }
    static now() { return NOW.getTime(); }
}
// A fresh page for the doodle code: its own global (window is the sandbox itself, which is where the scene blocks write window.__bfdScenes), a stub
// `document` that spies on the lookups, and a script runner that does what a browser does with `head.appendChild(<script>)`: run `.text` in this
// same global, synchronously; an exception thrown by that code is reported (spy.errors) and NOT thrown out of appendChild, as in a browser.
// opts.blocks: id -> text, or null for a block the page does not have (default: the real ones); opts.search: the query string;
// opts.setup(ctx): called after the stub document is built and before the doodle code is evaluated, to add or replace globals (the D83 idle tests give it a fake
// clock, setTimeout, window / document listeners, IntersectionObserver and matchMedia this way).
function makeEnv(opts = {}) {
    const blocks = opts.blocks || SCENE_TEXT;
    const spy = { gets: [], created: [], runs: [], runTexts: [], removed: 0, errors: [] };
    const loc = { search: opts.search || '', href: 'http://localhost/app.html', pathname: '/app.html', hash: '' };
    const ctx = { console, Date: PinnedDate, URLSearchParams, encodeURIComponent, decodeURIComponent, location: loc, ONE_BRAND: { magenta: '#bc0f70' } };
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    const idOfText = (t) => Object.keys(blocks).find(id => blocks[id] === t) || '(not one of the blocks)';
    ctx.document = {
        getElementById(id) { spy.gets.push(id); const t = Object.prototype.hasOwnProperty.call(blocks, id) ? blocks[id] : null; return t == null ? null : { id, text: t }; },
        createElement(tag) { spy.created.push(tag); return { tagName: tag, text: '' }; },
        head: {
            appendChild(el) {
                spy.runs.push(idOfText(el.text)); spy.runTexts.push(el.text);
                try { vm.runInContext(el.text, ctx, { filename: idOfText(el.text) }); } catch (e) { spy.errors.push(e && e.message); }
                return el;
            },
            removeChild(el) { spy.removed++; return el; },
        },
    };
    if (opts.setup) opts.setup(ctx);
    vm.createContext(ctx);
    const D = vm.runInContext(`const ONE_MAGENTA = '#bc0f70';\n${region}\n;({ ${NAMES.concat(EXTRA_NAMES).map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} })`, ctx, { filename: 'masthead-doodle-region.js' });
    return { D, loc, spy, ctx };
}
let ENV, D, loc;
try {
    ENV = makeEnv(); D = ENV.D; loc = ENV.loc;
} catch (err) {
    check('the doodle code evaluates on its own (with only ONE_MAGENTA, window.location, Date and a stub document around it)', false, err.message);
    console.log(`\n${failures} of ${checks} checks failed`); process.exit(1);
}
check('the doodle code evaluates on its own (with only ONE_MAGENTA, window.location, Date and a stub document around it)', true);
const missing = NAMES.filter(n => D[n] === undefined);
check('it defines BFD_SCHEDULE, bfdSceneKeyFor, BFD_SCENES, bfdSceneFn, bfdImageUrl, bfdMastheadScene and bfdMastheadStyle', missing.length === 0, { missing });
if (missing.length) { console.log(`\n${failures} of ${checks} checks failed`); process.exit(1); }
const missingIdle = EXTRA_NAMES.filter(n => D[n] === undefined);
check('D83: it also defines BFD_IDLE_MS and bfdWatchIdle (the idle still image)', missingIdle.length === 0, { missingIdle });
if (missingIdle.length) { console.log(`\n${failures} of ${checks} checks failed`); process.exit(1); }
const { BFD_SCHEDULE, bfdSceneKeyFor, BFD_SCENES, bfdImageUrl, bfdMastheadScene } = D;

// ---- 1. the schedule and the date table ----
section('The schedule and which scene each date gets');
const scheduleOk = Array.isArray(BFD_SCHEDULE) && BFD_SCHEDULE.length >= 1 && BFD_SCHEDULE.every(w => w && typeof w.key === 'string'
    && Array.isArray(w.from) && Array.isArray(w.to) && w.from.length === 2 && w.to.length === 2
    && [...w.from, ...w.to].every(Number.isInteger) && w.from[0] >= 1 && w.from[0] <= 12 && w.to[0] >= 1 && w.to[0] <= 12 && w.from[1] >= 1 && w.from[1] <= 31 && w.to[1] >= 1 && w.to[1] <= 31
    && (w.from[0] * 100 + w.from[1]) <= (w.to[0] * 100 + w.to[1]));
check('BFD_SCHEDULE is a list of { key, from: [month, day], to: [month, day] }, each window inside one calendar year (from is not after to)', scheduleOk, BFD_SCHEDULE);
check('the scene registry has exactly halloween, muertos and autumn, and every schedule key is in it',
    JSON.stringify(Object.keys(BFD_SCENES).sort()) === JSON.stringify(SCENE_KEYS.slice().sort()) && scheduleOk && BFD_SCHEDULE.every(w => w.key in BFD_SCENES), { scenes: Object.keys(BFD_SCENES) });
check('every scene is { sky: { light, dark }, css: string } and nothing else (the drawing function lives in its own block, not in the registry)',
    SCENE_KEYS.every(k => { const s = BFD_SCENES[k]; return s && eq(Object.keys(s).sort(), ['css', 'sky']) && s.sky && typeof s.sky.light === 'string' && typeof s.sky.dark === 'string' && s.sky.light && s.sky.dark && typeof s.css === 'string'; }),
    SCENE_KEYS.map(k => Object.keys(BFD_SCENES[k] || {})));

const key = (y, m, d, h = 12, mi = 0, s = 0) => bfdSceneKeyFor(new Date(y, m - 1, d, h, mi, s));
// Independent oracle: written out from the decision (Nov 1-3 Muertos, Nov 4-30 Autumn, the rest of the year Halloween), not read back from BFD_SCHEDULE.
const oracle = (m, d) => (m === 11 && d <= 3) ? 'muertos' : (m === 11) ? 'autumn' : 'halloween';
const TABLE = [[10, 1, 'halloween'], [10, 29, 'halloween'], [10, 30, 'halloween'], [10, 31, 'halloween'], [11, 1, 'muertos'], [11, 2, 'muertos'], [11, 3, 'muertos'],
    [11, 4, 'autumn'], [11, 15, 'autumn'], [11, 29, 'autumn'], [11, 30, 'autumn'], [12, 1, 'halloween'], [12, 31, 'halloween'], [1, 1, 'halloween'], [2, 28, 'halloween'], [7, 4, 'halloween']];
const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2100];
const tableBad = [];
for (const y of YEARS) for (const [m, d, want] of TABLE) { const got = key(y, m, d); if (got !== want) tableBad.push(`${y}-${m}-${d}: ${got} (want ${want})`); }
check(`the date table (${TABLE.length} dates x ${YEARS.length} years, so it does not depend on the year)`, tableBad.length === 0, tableBad.slice(0, 5));
const dayBad = [];
for (const y of [2026, 2028]) {   // 2026 an ordinary year, 2028 a leap year: every day of each, against the oracle
    for (let t = new Date(y, 0, 1); t.getFullYear() === y; t = new Date(y, t.getMonth(), t.getDate() + 1)) {
        const got = bfdSceneKeyFor(t), want = oracle(t.getMonth() + 1, t.getDate());
        if (got !== want) dayBad.push(`${y}-${t.getMonth() + 1}-${t.getDate()}: ${got} (want ${want})`);
    }
}
check('every day of 2026 and of the leap year 2028 gets the key the independent oracle gives it', dayBad.length === 0, dayBad.slice(0, 5));
check('the leap day (Feb 29, 2028) and the year boundary (Dec 31 2026 -> Jan 1 2027) are Halloween', key(2028, 2, 29) === 'halloween' && key(2026, 12, 31) === 'halloween' && key(2027, 1, 1) === 'halloween');
check('the edges are on the calendar date, not the clock: Oct 31 23:59:59 is halloween, Nov 1 00:00:00 and Nov 3 23:59:59 are muertos, Nov 4 00:00:00 is autumn, Nov 30 23:59:59 is autumn, Dec 1 00:00:00 is halloween',
    key(2026, 10, 31, 23, 59, 59) === 'halloween' && key(2026, 11, 1, 0, 0, 0) === 'muertos' && key(2026, 11, 3, 23, 59, 59) === 'muertos'
    && key(2026, 11, 4, 0, 0, 0) === 'autumn' && key(2026, 11, 30, 23, 59, 59) === 'autumn' && key(2026, 12, 1, 0, 0, 0) === 'halloween');
{
    // Reads only getMonth()/getDate(): an object with just those two methods works, and the year / time / UTC getters are never touched.
    const stub = (m0, d) => ({ getMonth: () => m0, getDate: () => d });
    let threw = null, got = null;
    try { got = [bfdSceneKeyFor(stub(10, 2)), bfdSceneKeyFor(stub(10, 20)), bfdSceneKeyFor(stub(9, 31))]; } catch (e) { threw = e.message; }
    check('bfdSceneKeyFor reads only date.getMonth() and date.getDate() (a stub with just those two methods gets muertos, autumn, halloween)',
        !threw && JSON.stringify(got) === JSON.stringify(['muertos', 'autumn', 'halloween']), threw || got);
}

// ---- 2. bfdMastheadScene() and the ?headerScene= override ----
section('bfdMastheadScene(): today, and the ?headerScene= override');
const scene = (isoDate, search) => { const [y, m, d] = isoDate.split('-').map(Number); NOW = new Date(y, m - 1, d, 12, 0, 0); loc.search = search; return bfdMastheadScene(); };
const sceneOnce = (isoDate, search) => { try { return scene(isoDate, search); } catch (e) { return 'threw: ' + e.message; } };
check('with no query it is today\'s key: Oct 29 halloween, Nov 1 and Nov 2 muertos, Nov 4 and Nov 20 autumn, Dec 2 halloween',
    ['2026-10-29', '2026-11-01', '2026-11-02', '2026-11-04', '2026-11-20', '2026-12-02'].map(d => sceneOnce(d, '')).join() === 'halloween,muertos,muertos,autumn,autumn,halloween',
    ['2026-10-29', '2026-11-01', '2026-11-02', '2026-11-04', '2026-11-20', '2026-12-02'].map(d => sceneOnce(d, '')));
check('?headerScene=muertos and ?headerScene=autumn show that scene on Oct 29, and ?headerScene=halloween shows Halloween on Nov 2',
    sceneOnce('2026-10-29', '?headerScene=muertos') === 'muertos' && sceneOnce('2026-10-29', '?headerScene=autumn') === 'autumn' && sceneOnce('2026-11-02', '?headerScene=halloween') === 'halloween',
    [sceneOnce('2026-10-29', '?headerScene=muertos'), sceneOnce('2026-10-29', '?headerScene=autumn'), sceneOnce('2026-11-02', '?headerScene=halloween')]);
check('the override is found among other query parameters (?x=1&headerScene=autumn&y=2)', sceneOnce('2026-10-29', '?x=1&headerScene=autumn&y=2') === 'autumn', sceneOnce('2026-10-29', '?x=1&headerScene=autumn&y=2'));
check('an unknown key is ignored (today\'s scene shows): ?headerScene=bogus, ?headerScene=, ?headerScene=__proto__, ?headerScene=constructor, and an unrelated query',
    ['?headerScene=bogus', '?headerScene=', '?headerScene=__proto__', '?headerScene=constructor', '?headerScene=toString', '?other=autumn'].every(q => sceneOnce('2026-10-29', q) === 'halloween' && sceneOnce('2026-11-02', q) === 'muertos'),
    ['?headerScene=bogus', '?headerScene=', '?headerScene=__proto__', '?headerScene=constructor', '?headerScene=toString', '?other=autumn'].map(q => [q, sceneOnce('2026-10-29', q), sceneOnce('2026-11-02', q)]));
loc.search = ''; NOW = new Date(2026, 9, 29, 12, 0, 0);

// ---- 3. the scenes ----
section('Each scene, light and dark');

// A tag-balance well-formedness check for the small XML subset an SVG here uses (no DOCTYPE, no CDATA). Returns an error string or null.
function xmlProblem(xml) {
    const stack = []; let i = 0, roots = 0;
    const NAME = '[A-Za-z_][\\w.:-]*';
    const attrRe = new RegExp(`\\s+(${NAME})\\s*=\\s*("[^"<]*"|'[^'<]*')`, 'y');
    while (i < xml.length) {
        if (xml[i] !== '<') {
            const j = xml.indexOf('<', i), text = xml.slice(i, j < 0 ? xml.length : j);
            if (/<|>/.test(text.replace(/>/g, '')) ) return 'stray < in text';
            const bad = text.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
            if (bad) return `bare & in text near "${text.slice(Math.max(0, bad.index - 10), bad.index + 12)}"`;
            if (stack.length === 0 && text.trim()) return 'text outside the root element';
            i = j < 0 ? xml.length : j; continue;
        }
        if (xml.startsWith('<!--', i)) { const e = xml.indexOf('-->', i + 4); if (e < 0) return 'unterminated comment'; i = e + 3; continue; }
        if (xml.startsWith('<?', i)) { const e = xml.indexOf('?>', i + 2); if (e < 0) return 'unterminated processing instruction'; i = e + 2; continue; }
        if (xml.startsWith('<![CDATA[', i)) { const e = xml.indexOf(']]>', i); if (e < 0) return 'unterminated CDATA'; i = e + 3; continue; }
        if (xml.startsWith('<!', i)) return 'DOCTYPE or declaration not expected';
        if (xml[i + 1] === '/') {
            const m = new RegExp(`^</(${NAME})\\s*>`).exec(xml.slice(i, i + 200));
            if (!m) return `malformed closing tag at ${i}`;
            const open = stack.pop();
            if (open !== m[1]) return `closing </${m[1]}> does not match open <${open}>`;
            i += m[0].length; continue;
        }
        const nm = new RegExp(`^<(${NAME})`).exec(xml.slice(i, i + 200));
        if (!nm) return `malformed tag at ${i}: ${xml.slice(i, i + 30)}`;
        let p = i + nm[0].length;
        const seen = new Set();
        for (;;) {
            attrRe.lastIndex = p;
            const am = attrRe.exec(xml);
            if (!am) break;
            if (seen.has(am[1])) return `duplicate attribute ${am[1]} on <${nm[1]}>`;
            if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(am[2])) return `bare & in attribute ${am[1]}`;
            seen.add(am[1]); p = attrRe.lastIndex;
        }
        const ws = /\s*/y; ws.lastIndex = p; ws.exec(xml); p = ws.lastIndex;
        if (xml.startsWith('/>', p)) { if (stack.length === 0) roots++; i = p + 2; if (stack.length === 0 && roots > 1) return 'more than one root element'; continue; }
        if (xml[p] !== '>') return `bad tag end at ${p} in <${nm[1]}: ${xml.slice(p, p + 20)}`;
        if (stack.length === 0) { roots++; if (roots > 1) return 'more than one root element'; }
        stack.push(nm[1]); i = p + 1;
    }
    if (stack.length) return `unclosed <${stack[stack.length - 1]}>`;
    if (roots !== 1) return `${roots} root elements`;
    return null;
}
// Self-test of the parser so a pass means something: it must accept a good document and reject each kind of breakage.
{
    const good = '<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox="0 0 1 1"><g><circle r="1"/><path d="M0,0"></path></g></svg>';
    const bads = ['<svg><g></svg>', '<svg></g></svg>', '<svg><g></g>', '<svg a="1" a="2"/>', '<svg a="1></svg>', '<svg/><svg/>', '<svg>a & b</svg>', '<svg><circle r=1/></svg>', 'x<svg/>', '<svg><g></g></svg></svg>'];
    check('the well-formedness parser accepts a good document and rejects each of 10 broken ones',
        xmlProblem(good) === null && bads.every(b => xmlProblem(b) !== null), { good: xmlProblem(good), notRejected: bads.filter(b => xmlProblem(b) === null) });
}

const PREFIX_RE = /^url\("data:image\/svg\+xml(?:;charset=utf-8)?,/i;
const decoded = {};   // `${key}/${theme}` -> { uri, svg }
for (const k of SCENE_KEYS) {
    for (const dark of [false, true]) {
        const label = `${k} ${dark ? 'dark' : 'light'}`;
        let uri, err = null;
        try { uri = bfdImageUrl(dark, k); } catch (e) { err = e.message; }
        if (err || typeof uri !== 'string') { check(`${label}: bfdImageUrl(${dark}, '${k}') returns a string`, false, err || typeof uri); continue; }
        const m = PREFIX_RE.exec(uri);
        const okShape = !!m && uri.endsWith('")');
        const payload = okShape ? uri.slice(m[0].length, -2) : '';
        const cssSafe = okShape && !/["\\\n\r]/.test(payload) && !/#/.test(payload) && !/%(?![0-9A-Fa-f]{2})/.test(payload);
        check(`${label}: is url("data:image/svg+xml,...") with nothing in the payload that would end the CSS string or start a URL fragment (no raw ", \\, newline or #, every % an escape)`, okShape && cssSafe,
            okShape ? { prefix: m[0], badChars: (payload.match(/["\\\n\r#]/g) || []).slice(0, 5) } : uri.slice(0, 80));
        let svg = '';
        try { svg = decodeURIComponent(payload); } catch (e) { check(`${label}: the payload decodes`, false, e.message); continue; }
        decoded[`${k}/${dark ? 'dark' : 'light'}`] = { uri, svg };

        const problem = xmlProblem(svg);
        check(`${label}: the decoded SVG is well-formed XML (tags balance, one root, attributes unique and quoted)`, problem === null, problem);
        const root = /^<svg\b[^>]*>/.exec(svg.trim());
        const rootTag = root ? root[0] : '';
        check(`${label}: the root is <svg> with xmlns, viewBox "-70 0 1900 48" and preserveAspectRatio "xMidYMax meet" (the masthead CSS sizes it as 100% x 48px)`,
            /\bxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(rootTag) && /\bviewBox=["']-70 0 1900 48["']/.test(rootTag) && /\bpreserveAspectRatio=["']xMidYMax meet["']/.test(rootTag), rootTag);
        const banned = ['<text', '<image', '<script', '<foreignObject', '<iframe', '<use'].filter(t => svg.toLowerCase().includes(t.toLowerCase()));
        const events = svg.match(/\son[a-z]+\s*=/gi) || [];
        const external = (svg.match(/url\(\s*(?!["']?#)[^)]*\)/g) || []).concat(svg.match(/(?:xlink:)?href\s*=\s*["'](?!#)[^"']*["']/g) || [], svg.match(/@import/g) || [], svg.match(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/g) || []);
        check(`${label}: no <text, <image, <script, <foreignObject, <iframe or <use, no on...= event attributes, no external reference`, banned.length === 0 && events.length === 0 && external.length === 0, { banned, events, external });

        const ids = [...svg.matchAll(/\sid=["']([^"']+)["']/g)].map(x => x[1]);
        const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
        const refs = [...svg.matchAll(/url\(\s*["']?#([^)"'\s]+)["']?\s*\)/g)].map(x => x[1]).concat([...svg.matchAll(/href=["']#([^"']+)["']/g)].map(x => x[1]));
        const dangling = refs.filter(r => !ids.includes(r));
        const unusedIds = ids.filter(id => !refs.includes(id));
        check(`${label}: ids are unique (${ids.length}) and every url(#id) reference (${refs.length}) resolves`, dupIds.length === 0 && dangling.length === 0, { dupIds, dangling });
        check(`${label}: every id that is defined is referenced (nothing left over from another theme or scene)`, unusedIds.length === 0, { unusedIds });

        // CSS inside the SVG: every animation name has keyframes, and nothing is left over (keyframes nothing uses, a rule for a class the scene does not carry).
        const css = (svg.match(/<style\b[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];
        const classesInBody = new Set([...svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/, '').matchAll(/\sclass=["']([^"']+)["']/g)].flatMap(x => x[1].split(/\s+/)));
        const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(x => x[1]);
        const withoutMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
        const ruleAnims = [...withoutMedia.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(x => ({ sel: x[1].trim(), anim: (x[2].match(/animation(?:-name)?\s*:\s*([\w-]+)/) || [])[1] })).filter(r => r.anim);
        const animNames = new Set(ruleAnims.map(r => r.anim));
        const missingKf = [...animNames].filter(n => !keyframes.includes(n));
        const deadKf = keyframes.filter(n => !animNames.has(n));
        const classOf = (sel) => [...sel.matchAll(/\.([\w-]+)/g)].map(x => x[1]);
        const deadRules = ruleAnims.filter(r => !classOf(r.sel).some(c => classesInBody.has(c))).map(r => r.sel);
        const unstyledBfd = [...classesInBody].filter(c => /^bfd-/.test(c) && !ruleAnims.some(r => classOf(r.sel).includes(c)));
        check(`${label}: every animation named in the CSS has @keyframes, and none is dead (no keyframes or rule for something this scene and theme does not draw; every bfd- class drawn has its rule)`,
            missingKf.length === 0 && deadKf.length === 0 && deadRules.length === 0 && unstyledBfd.length === 0, { missingKf, deadKf, deadRules, unstyledBfd });
        const reduced = /prefers-reduced-motion\s*:\s*reduce/.test(css) && /animation\s*:\s*none/.test(css);
        check(`${label}: keeps the prefers-reduced-motion opt-out (animation: none)`, reduced);

        const bytes = Buffer.byteLength(uri, 'utf8');
        check(`${label}: ${bytes} bytes is under the ${BUDGET_BYTES}-byte budget`, bytes <= BUDGET_BYTES, `${bytes} > ${BUDGET_BYTES}`);
        let again; try { again = bfdImageUrl(dark, k); } catch (e) { again = null; }
        check(`${label}: a second call returns the identical (cached) string`, again === uri);
    }
}

// ---- 4. the scenes differ ----
section('The scenes differ');
const have = (k, t) => decoded[`${k}/${t}`];
for (const t of ['light', 'dark']) {
    const [h, mu, au] = SCENE_KEYS.map(k => have(k, t));
    check(`${t}: halloween, muertos and autumn are three different images`, !!(h && mu && au) && h.uri !== mu.uri && h.uri !== au.uri && mu.uri !== au.uri);
    // Different, not merely a different <style> or id: the drawn shapes (everything after the shared defs/style) must differ too.
    const shapes = (x) => x ? x.svg.replace(/<style\b[\s\S]*?<\/style>/, '').replace(/<defs>[\s\S]*?<\/defs>/g, '') : '';
    check(`${t}: and the drawn shapes differ, not just the colours or the animation CSS`, !!(h && mu && au) && shapes(h) !== shapes(mu) && shapes(h) !== shapes(au) && shapes(mu) !== shapes(au));
}
for (const k of SCENE_KEYS) {
    check(`${k}: light and dark are different images, and the sky gradients are different strings`, !!(have(k, 'light') && have(k, 'dark')) && have(k, 'light').uri !== have(k, 'dark').uri && BFD_SCENES[k].sky.light !== BFD_SCENES[k].sky.dark);
}
check('the sky gradients are CSS gradients and differ between scenes (light and dark)',
    ['light', 'dark'].every(t => SCENE_KEYS.every(k => /^(?:linear|radial)-gradient\(/.test(BFD_SCENES[k].sky[t])) && new Set(SCENE_KEYS.map(k => BFD_SCENES[k].sky[t])).size === SCENE_KEYS.length));
{
    let leak = null;
    try { const before = bfdImageUrl(true, 'halloween'); bfdImageUrl(false, 'muertos'); bfdImageUrl(true, 'autumn'); leak = bfdImageUrl(true, 'halloween') !== before; } catch (e) { leak = e.message; }
    check('the cache is per scene and theme: asking for other scenes does not change Halloween dark', leak === false, leak);
}

// ---- 5. lazy loading: only the scene showing is ever turned into running code ----
section('Lazy loading: only the scene showing is compiled and run');
const FIRST_NOW = NOW;
const at = (y, m, d) => { NOW = new Date(y, m - 1, d, 12, 0, 0); };
const attempt = (fn) => { try { return { v: fn() }; } catch (e) { return { err: e && e.message }; } };
check('the three scene blocks are found in the page (so the sandbox can serve them)', eq(SCENE_ORDER.slice().sort(), SCENE_KEYS.map(sceneId).sort()), SCENE_ORDER);
{
    const f = makeEnv();
    check('evaluating the doodle code runs no scene block and looks none up (nothing is loaded until a scene is asked for)',
        f.spy.gets.length === 0 && f.spy.runs.length === 0 && Object.keys(f.ctx.__bfdScenes || {}).length === 0, { gets: f.spy.gets, runs: f.spy.runs });
}
for (const k of SCENE_KEYS) {
    const e = makeEnv(), id = sceneId(k);
    const light = attempt(() => e.D.bfdImageUrl(false, k));
    const regKeys = Object.keys(e.ctx.__bfdScenes || {});
    check(`${k}: bfdImageUrl(false, '${k}') on a fresh page runs only that block (window.__bfdScenes has exactly ['${k}'], the runner got one script)`,
        !light.err && typeof light.v === 'string' && light.v.startsWith('url("data:') && eq(regKeys, [k]) && eq(e.spy.runs, [id]), light.err || { regKeys, runs: e.spy.runs });
    check(`${k}: it looked up only '${id}', and only that block's text was handed to the script runner (not the other two blocks')`,
        eq(e.spy.gets, [id]) && e.spy.runTexts.length === 1 && e.spy.runTexts[0] === SCENE_TEXT[id]
        && SCENE_KEYS.filter(o => o !== k).every(o => !e.spy.runTexts.includes(SCENE_TEXT[sceneId(o)])), { gets: e.spy.gets, runs: e.spy.runs });
    check(`${k}: the injected <script> element is created once and removed again (no element left in the head)`, eq(e.spy.created, ['script']) && e.spy.removed === 1, { created: e.spy.created, removed: e.spy.removed });
    const dark = attempt(() => e.D.bfdImageUrl(true, k));
    const lightAgain = attempt(() => e.D.bfdImageUrl(false, k)), darkAgain = attempt(() => e.D.bfdImageUrl(true, k));
    check(`${k}: the other theme does not run the block again (runner called once per scene), and both themes come back identical from the cache`,
        typeof dark.v === 'string' && dark.v !== light.v && e.spy.runs.length === 1 && lightAgain.v === light.v && darkAgain.v === dark.v && eq(Object.keys(e.ctx.__bfdScenes), [k]),
        { runs: e.spy.runs, err: dark.err });
}
// bfdMastheadStyle is what the masthead calls on every render: it must load only the scene of the day (or of the ?headerScene= override).
for (const [label, y, m, d, search, want] of [
    ['a Halloween date (Oct 29)', 2026, 10, 29, '', 'halloween'], ['Oct 31', 2026, 10, 31, '', 'halloween'], ['a Muertos date (Nov 2)', 2026, 11, 2, '', 'muertos'],
    ['an Autumn date (Nov 10)', 2026, 11, 10, '', 'autumn'], ['Oct 29 with ?headerScene=autumn', 2026, 10, 29, '?headerScene=autumn', 'autumn'],
    ['Nov 2 with ?headerScene=halloween', 2026, 11, 2, '?headerScene=halloween', 'halloween'],
]) {
    at(y, m, d);
    const e = makeEnv({ search });
    const r = [attempt(() => e.D.bfdMastheadStyle(false)), attempt(() => e.D.bfdMastheadStyle(true))];
    NOW = FIRST_NOW;
    const [lt, dk] = [r[0].v || {}, r[1].v || {}];
    check(`bfdMastheadStyle on ${label} loads only ${want} (light and dark), with an image and that scene's sky`,
        !r[0].err && !r[1].err && eq(Object.keys(e.ctx.__bfdScenes || {}), [want]) && eq(e.spy.gets, [sceneId(want)]) && eq(e.spy.runs, [sceneId(want)])
        && /^url\("data:image\/svg\+xml,/.test(lt['--bfd-img']) && /^url\("data:image\/svg\+xml,/.test(dk['--bfd-img'])
        && lt['--bfd-sky'] === e.D.BFD_SCENES[want].sky.light && dk['--bfd-sky'] === e.D.BFD_SCENES[want].sky.dark,
        r[0].err || r[1].err || { keys: Object.keys(e.ctx.__bfdScenes || {}), gets: e.spy.gets, runs: e.spy.runs });
}

// ---- 6. graceful failure: no block, a block that throws, a block that registers nothing ----
section('A scene that cannot be loaded leaves the masthead with its sky gradient');
const without = (id, text) => Object.assign({}, SCENE_TEXT, { [id]: text });
for (const [label, blocks, wantErrors] of [
    ['the block is missing from the page', without('bfd-scene-muertos', null), 0],
    ['the block\'s code throws when it runs', without('bfd-scene-muertos', "throw new Error('boom');"), 1],
    ['the block runs but registers no drawing function', without('bfd-scene-muertos', ';'), 0],
]) {
    const e = makeEnv({ blocks });
    const first = attempt(() => e.D.bfdImageUrl(false, 'muertos'));
    const runsAfterFirst = e.spy.runs.length, getsAfterFirst = e.spy.gets.length;
    const second = attempt(() => e.D.bfdImageUrl(false, 'muertos'));
    check(`${label}: bfdImageUrl returns exactly 'none' and does not throw`, !first.err && first.v === 'none' && e.spy.errors.length === wantErrors, first.err || { v: first.v, errors: e.spy.errors });
    check(`${label}: the failure is cached (a second ask for the same scene and theme returns 'none' without another lookup or another run)`,
        !second.err && second.v === 'none' && e.spy.runs.length === runsAfterFirst && e.spy.gets.length === getsAfterFirst, { runs: e.spy.runs, gets: e.spy.gets });
    at(2026, 11, 2);
    const e2 = makeEnv({ blocks });
    const st = attempt(() => e2.D.bfdMastheadStyle(false)), stDark = attempt(() => e2.D.bfdMastheadStyle(true));
    NOW = FIRST_NOW;
    check(`${label}: bfdMastheadStyle still returns the scene's --bfd-sky gradient (and --bfd-img 'none') for light and dark`,
        !st.err && !stDark.err && st.v['--bfd-img'] === 'none' && stDark.v['--bfd-img'] === 'none'
        && /^(?:linear|radial)-gradient\(/.test(st.v['--bfd-sky']) && st.v['--bfd-sky'] === e2.D.BFD_SCENES.muertos.sky.light && stDark.v['--bfd-sky'] === e2.D.BFD_SCENES.muertos.sky.dark,
        st.err || stDark.err || st.v);
    const other = attempt(() => e.D.bfdImageUrl(false, 'halloween'));
    check(`${label}: it does not take the other scenes down (Halloween still draws, and only Halloween's block is added)`,
        !other.err && /^url\("data:image\/svg\+xml,/.test(other.v) && eq(Object.keys(e.ctx.__bfdScenes || {}), ['halloween']), other.err || Object.keys(e.ctx.__bfdScenes || {}));
}

// ---- 7. the page itself: three inert blocks, ahead of the app script, each self-contained ----
section('The scene blocks in the page, and the app script without scenes');
const OPEN_ANY = /<script\b[^>]*\btype\s*=\s*["']?text\/x-bfd-scene/gi;
const babelAt = html.indexOf('<script type="text/babel">');
const firstOpenAt = html.search(OPEN_ANY);
const openers = html.match(OPEN_ANY) || [];
check('exactly three <script type="text/x-bfd-scene"> blocks, with the ids bfd-scene-halloween, bfd-scene-muertos and bfd-scene-autumn',
    openers.length === 3 && eq(SCENE_ORDER.slice().sort(), SCENE_KEYS.map(sceneId).sort()), { openers: openers.length, ids: SCENE_ORDER });
check('every block sits before the app\'s <script type="text/babel"> block', babelAt > 0 && firstOpenAt >= 0 && html.lastIndexOf('</script>', babelAt) > firstOpenAt && [...html.matchAll(SCENE_BLOCK_RE)].every(m => m.index < babelAt), { babelAt, firstOpenAt });
{
    const segment = babelAt > 0 && firstOpenAt >= 0 ? html.slice(firstOpenAt, babelAt) : '';
    const closers = (segment.match(/<\/script/gi) || []).length;
    const leftover = segment.replace(SCENE_BLOCK_RE, '').trim();
    check('no block ends early: from the first block to the app script there are exactly three </script closers and nothing but the three blocks', closers === 3 && leftover === '', { closers, leftover: leftover.slice(0, 120) });
}
for (const id of SCENE_ORDER) {
    const t = SCENE_TEXT[id];
    check(`${id}: contains no "</script" (it would end the block), no "<script" and no "<!--" (it would start an HTML comment state)`, !/<\/script/i.test(t) && !/<script/i.test(t) && !/<!--/.test(t),
        { closer: /<\/script/i.test(t), opener: /<script/i.test(t), comment: /<!--/.test(t) });
}
const STUB_H = { sea: () => '<g/>', front: () => '<g/>', flagship: () => '<g/>', magenta: '#bc0f70' };
for (const k of SCENE_KEYS) {
    const id = sceneId(k), t = SCENE_TEXT[id];
    if (typeof t !== 'string') { check(`${id}: exists`, false); continue; }
    const parsed = attempt(() => new vm.Script(t, { filename: id }));
    check(`${id}: parses as JavaScript (syntax only)`, !parsed.err, parsed.err);
    const c = { }; c.window = c; vm.createContext(c);
    const before = Object.keys(c);
    const ran = attempt(() => vm.runInContext(t, c, { filename: id }));
    const added = Object.keys(c).filter(x => !before.includes(x));
    check(`${id}: run alone in a fresh context it adds exactly one key (${k}) to window.__bfdScenes and defines no other global (only __bfdScenes is new on the window)`,
        !ran.err && eq(added, ['__bfdScenes']) && eq(Object.keys(c.__bfdScenes || {}), [k]) && typeof (c.__bfdScenes || {})[k] === 'function', ran.err || { added, keys: Object.keys(c.__bfdScenes || {}) });
    const fn = c.__bfdScenes && c.__bfdScenes[k];
    const outs = [false, true].map(dark => attempt(() => fn(dark, STUB_H)));
    check(`${id}: the registered function returns a string starting with "<" for light and dark when given only the four helper pieces (no app global needed)`,
        typeof fn === 'function' && outs.every(o => !o.err && typeof o.v === 'string' && o.v.trim().startsWith('<')), outs.map(o => o.err || (typeof o.v === 'string' ? o.v.slice(0, 20) : typeof o.v)));
}
{
    const GONE = ['function bfdSceneMuertos', 'function bfdSceneAutumn', 'function bfdBat', 'function bfdMButterfly', 'function bfdALeaf'];
    const found = GONE.filter(x => appScript.includes(x)).concat(/function\s+bfdScene\s*\(/.test(appScript) ? ['function bfdScene('] : []);
    check('the app\'s own <script type="text/babel"> carries no scene drawing code (' + GONE.join(', ') + ', function bfdScene()', found.length === 0, found);
    check('and its registry does not point at a scene function (no "scene: bfdScene"), so a scene cannot creep back in and load on every page view', !/scene\s*:\s*bfdScene/.test(appScript), (appScript.match(/scene\s*:\s*bfdScene\w*/) || [])[0]);
}

// ---- 8. D83: the still variant, bfdImageUrl(dark, key, true) ----
section('D83 still variant: bfdImageUrl(dark, key, true) is the same scene with every animation taken out');
const SHAPE_TAGS = ['path', 'circle', 'rect', 'g', 'polygon', 'ellipse', 'line'];
// <tag followed by whitespace, / or >, so '<line' does not count <linearGradient and '<g' does not count a longer name.
const countTag = (svg, tag) => (svg.match(new RegExp('<' + tag + '(?=[\\s/>])', 'g')) || []).length;
const STYLE_EL_RE = /<style\b[^>]*>[\s\S]*?<\/style>/;
const CLASS_ATTR_RE = /\sclass=("[^"]*"|'[^']*')/g;     // the decoded payload has single-quoted attributes (the CSS encoding turns " into '), so both quotes
for (const k of SCENE_KEYS) {
    for (const dark of [false, true]) {
        const theme = dark ? 'dark' : 'light', label = `D83 still ${k} ${theme}`, anim = decoded[`${k}/${theme}`];
        const r = attempt(() => bfdImageUrl(dark, k, true));
        if (r.err || typeof r.v !== 'string') { check(`${label}: bfdImageUrl(${dark}, '${k}', true) returns a string`, false, r.err || typeof r.v); continue; }
        const uri = r.v, m = PREFIX_RE.exec(uri);
        const okShape = !!m && uri.endsWith('")');
        const payload = okShape ? uri.slice(m[0].length, -2) : '';
        const cssSafe = okShape && !/["\\\n\r]/.test(payload) && !/#/.test(payload) && !/%(?![0-9A-Fa-f]{2})/.test(payload);
        check(`${label}: is url("data:image/svg+xml,...") with nothing in the payload that would end the CSS string or start a URL fragment (no raw ", \\, newline or #, every % an escape)`, okShape && cssSafe,
            okShape ? { prefix: m[0], badChars: (payload.match(/["\\\n\r#]/g) || []).slice(0, 5) } : uri.slice(0, 80));
        let svg = '';
        try { svg = decodeURIComponent(payload); } catch (e) { check(`${label}: the payload decodes`, false, e.message); continue; }

        check(`${label}: the decoded SVG is well-formed XML (tags balance, one root, attributes unique and quoted)`, xmlProblem(svg) === null, xmlProblem(svg));
        const rootTag = (/^<svg\b[^>]*>/.exec(svg.trim()) || [''])[0], animRoot = anim ? (/^<svg\b[^>]*>/.exec(anim.svg.trim()) || [''])[0] : null;
        check(`${label}: keeps the root <svg> of the animated image: xmlns, viewBox "-70 0 1900 48" and preserveAspectRatio "xMidYMax meet"`,
            /\bxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(rootTag) && /\bviewBox=["']-70 0 1900 48["']/.test(rootTag) && /\bpreserveAspectRatio=["']xMidYMax meet["']/.test(rootTag) && rootTag === animRoot,
            { rootTag, animRoot });

        // "Nothing can move": no <style> (so no rule and no @keyframes), no class (so no rule could match), no animation / animation-name declaration, no SMIL element.
        // An inline animation-delay or animation-duration with no animation-name starts nothing; it is only dead bytes, so it is reported below but does not fail the check.
        const leftovers = [];
        if (/<style\b/i.test(svg)) leftovers.push('<style element');
        if (/\sclass\s*=/i.test(svg)) leftovers.push('class attribute');
        if (/@keyframes/i.test(svg)) leftovers.push('@keyframes');
        if (/animation(?:-name)?\s*:/i.test(svg)) leftovers.push('animation / animation-name declaration');
        if (/<animate|<set\b/i.test(svg)) leftovers.push('SMIL <animate / <set');
        check(`${label}: has no <style element, no class attribute, no @keyframes, no animation / animation-name declaration and no SMIL element (nothing left that could move)`, leftovers.length === 0, leftovers);
        const inert = svg.match(/\sstyle=("[^"]*"|'[^']*')/g) || [];
        if (inert.some(x => /animation/i.test(x))) console.log(`     note: ${label} keeps ${inert.filter(x => /animation/i.test(x)).length} inline ${inert.filter(x => /animation/i.test(x))[0].trim()} (inert without an animation-name; ${inert.filter(x => /animation/i.test(x)).join('').length} dead bytes)`);

        const ids = [...svg.matchAll(/\sid=["']([^"']+)["']/g)].map(x => x[1]);
        const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
        const refs = [...svg.matchAll(/url\(\s*["']?#([^)"'\s]+)["']?\s*\)/g)].map(x => x[1]).concat([...svg.matchAll(/href=["']#([^"']+)["']/g)].map(x => x[1]));
        const dangling = refs.filter(x => !ids.includes(x)), unusedIds = ids.filter(id => !refs.includes(id));
        check(`${label}: ids are unique (${ids.length}), every url(#id) reference (${refs.length}) resolves, and every id defined is used`, ids.length > 0 && dupIds.length === 0 && dangling.length === 0 && unusedIds.length === 0, { dupIds, dangling, unusedIds });

        const stillBytes = Buffer.byteLength(uri, 'utf8'), animBytes = anim ? Buffer.byteLength(anim.uri, 'utf8') : NaN;
        check(`${label}: ${stillBytes} bytes is smaller than the animated image of the same scene and theme (${animBytes} bytes)`, stillBytes < animBytes, `${stillBytes} !< ${animBytes}`);

        const again = attempt(() => bfdImageUrl(dark, k, true));
        check(`${label}: a second call returns the identical (cached) string`, again.v === uri, again.err);
        const sameEnv = attempt(() => { const before = bfdImageUrl(dark, k), s = bfdImageUrl(dark, k, true), after = bfdImageUrl(dark, k); return { before, s, after }; });
        check(`${label}: cached apart from the animated image: asking for the still one leaves the animated string unchanged (and the other way round), and the two strings differ`,
            !sameEnv.err && !!anim && sameEnv.v.before === anim.uri && sameEnv.v.after === anim.uri && sameEnv.v.s === uri && uri !== anim.uri, sameEnv.err || 'a variant changed the other or they are equal');
        const f = makeEnv();
        const rev = attempt(() => { const s1 = f.D.bfdImageUrl(dark, k, true), a1 = f.D.bfdImageUrl(dark, k), s2 = f.D.bfdImageUrl(dark, k, true), a2 = f.D.bfdImageUrl(dark, k); return { s1, a1, s2, a2 }; });
        check(`${label}: asked in the other order on a fresh page (still first, then animated) both come out the same, and the scene's block is run once for both`,
            !rev.err && !!anim && rev.v.s1 === uri && rev.v.a1 === anim.uri && rev.v.s2 === uri && rev.v.a2 === anim.uri && eq(f.spy.runs, [sceneId(k)]), rev.err || { runs: f.spy.runs });

        const counts = anim ? SHAPE_TAGS.map(t => [t, countTag(anim.svg, t), countTag(svg, t)]) : [];
        const total = counts.reduce((n, c) => n + c[2], 0);
        check(`${label}: draws the same shapes as the animated image: equal number of ${SHAPE_TAGS.map(t => '<' + t).join(', ')} (${total} elements), so nothing is dropped from the poster frame`,
            !!anim && total > 0 && counts.every(c => c[1] === c[2]) && counts.find(c => c[0] === 'path')[2] > 0, counts.filter(c => c[1] !== c[2]));
        const derived = anim ? anim.svg.replace(STYLE_EL_RE, '').replace(CLASS_ATTR_RE, '').replace(/ style='animation-delay:[^']*'/g, '').replace(/ style="animation-delay:[^"]*"/g, '') : null;
        check(`${label}: is exactly the animated SVG with its <style> element, class attributes and animation-delay styles taken out (the same drawing frozen, nothing else added or lost)`, derived === svg,
            derived === null ? 'no animated image to compare' : { animatedMinusStyleAndClasses: derived.length, still: svg.length });
    }
}
// A scene that cannot be loaded: the still variant gives 'none' too (and the masthead falls back to its sky gradient, as for the animated one).
for (const [label, blocks] of [
    ['the block is missing from the page', without('bfd-scene-muertos', null)],
    ['the block\'s code throws when it runs', without('bfd-scene-muertos', "throw new Error('boom');")],
    ['the block runs but registers no drawing function', without('bfd-scene-muertos', ';')],
]) {
    const e = makeEnv({ blocks });
    const first = [attempt(() => e.D.bfdImageUrl(false, 'muertos', true)), attempt(() => e.D.bfdImageUrl(true, 'muertos', true))];
    const runs1 = e.spy.runs.length, gets1 = e.spy.gets.length;
    const second = [attempt(() => e.D.bfdImageUrl(false, 'muertos', true)), attempt(() => e.D.bfdImageUrl(true, 'muertos', true))];
    check(`D83 still, ${label}: bfdImageUrl(dark, 'muertos', true) returns exactly 'none' for light and dark and does not throw`, first.every(x => !x.err && x.v === 'none'), first.map(x => x.err || x.v));
    check(`D83 still, ${label}: the failure is cached (asking again looks nothing up and runs nothing)`, second.every(x => !x.err && x.v === 'none') && e.spy.runs.length === runs1 && e.spy.gets.length === gets1, { runs: e.spy.runs, gets: e.spy.gets });
}

// ---- 9. D83: bfdWatchIdle(el, dark, idleMs) against a fake clock ----
section('D83 bfdWatchIdle: idle timer, input, hidden tab, off-screen masthead, cleanup (fake clock, nothing real is waited for)');
const IDLE = 5000;    // the idleMs the tests pass; not BFD_IDLE_MS, so a pass also shows that the argument is what sets the time
const EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
const capOf = (o) => typeof o === 'boolean' ? o : !!(o && o.capture);
// A fresh page with a fake clock and stubs around bfdWatchIdle, and an element stub. Returns the handles the tests need.
//   setTimeout / clearTimeout / Date.now: a manual clock that only moves when advance(ms) is called, running any timer that falls due on the way;
//   window and document: addEventListener / removeEventListener that record every call and keep the live list (a listener goes only when event, handler and capture flag all match, as in a browser);
//   document.hidden: a flag; IntersectionObserver: a stub the test drives with report(isIntersecting); matchMedia: { matches: opts.reduced };
//   the element: classList.toggle / contains / remove / add and style.setProperty / getPropertyValue / removeProperty, every mutation counted in el.calls.
// new Date() inside the page stays the pinned "today" (the scene of the day); only Date.now() reads the fake clock.
function makeIdle(opts = {}) {
    const clock = { now: 1700000000000, timers: [], nextId: 1, scheduled: 0, cleared: [] };
    const win = { added: [], removed: [], active: [] }, doc = { added: [], removed: [], active: [] };
    const media = [], ios = [];
    const target = (rec) => ({
        addEventListener(name, fn, o) {
            rec.added.push({ name, fn, o, capture: capOf(o) });
            if (!rec.active.some(l => l.name === name && l.fn === fn && l.capture === capOf(o))) rec.active.push({ name, fn, capture: capOf(o) });
        },
        removeEventListener(name, fn, o) {
            rec.removed.push({ name, fn, o, capture: capOf(o) });
            const i = rec.active.findIndex(l => l.name === name && l.fn === fn && l.capture === capOf(o));
            if (i >= 0) rec.active.splice(i, 1);
        },
    });
    class FakeObserver {
        constructor(cb) { this.cb = cb; this.observed = []; this.disconnected = 0; ios.push(this); }
        observe(t) { this.observed.push(t); }
        unobserve() {}
        disconnect() { this.disconnected++; }
        report(isIntersecting) { this.cb([{ isIntersecting, target: this.observed[0] }], this); }
    }
    class ClockDate extends Date {
        constructor(...a) { if (a.length === 0) super(NOW.getTime()); else super(...a); }
        static now() { return clock.now; }
    }
    const el = { classes: new Set(), props: {}, calls: [] };
    el.classList = {
        toggle(c, force) { el.calls.push('toggle'); const on = force === undefined ? !el.classes.has(c) : !!force; if (on) el.classes.add(c); else el.classes.delete(c); return on; },
        contains(c) { return el.classes.has(c); },
        remove(c) { el.calls.push('remove'); el.classes.delete(c); },
        add(c) { el.calls.push('add'); el.classes.add(c); },
    };
    el.style = {
        setProperty(k, v) { el.calls.push('setProperty'); el.props[k] = String(v); },
        getPropertyValue(k) { return Object.prototype.hasOwnProperty.call(el.props, k) ? el.props[k] : ''; },
        removeProperty(k) { el.calls.push('removeProperty'); const old = el.style.getPropertyValue(k); delete el.props[k]; return old; },
    };
    const E = makeEnv({ search: opts.search || '', setup(ctx) {
        ctx.setTimeout = (fn, ms) => { const t = { id: clock.nextId++, at: clock.now + ms, fn }; clock.timers.push(t); clock.scheduled++; return t.id; };
        ctx.clearTimeout = (id) => { clock.cleared.push(id); clock.timers = clock.timers.filter(t => t.id !== id); };
        ctx.Date = ClockDate;
        Object.assign(ctx, target(win));
        ctx.document.hidden = false;
        Object.assign(ctx.document, target(doc));
        if (!opts.noObserver) ctx.IntersectionObserver = FakeObserver;
        if (!opts.noMatchMedia) ctx.matchMedia = (q) => { media.push(q); return { matches: !!opts.reduced }; };
    } });
    const advance = (ms) => {
        const stop = clock.now + ms;
        for (;;) {
            const due = clock.timers.filter(t => t.at <= stop).sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!due) break;
            clock.timers = clock.timers.filter(t => t !== due);
            clock.now = due.at;
            due.fn();
        }
        clock.now = stop;
    };
    const emit = (rec, name) => { const hit = rec.active.filter(l => l.name === name); hit.forEach(l => l.fn({ type: name })); return hit.length; };
    const t = {
        E, D: E.D, el, win, doc, clock, ios, media, advance,
        fire: (name) => emit(win, name), fireDoc: (name) => emit(doc, name),
        setHidden: (v) => { E.ctx.document.hidden = v; },
        still: () => el.classList.contains('bfd-still'), prop: () => el.style.getPropertyValue('--bfd-img-still'),
        pending: () => clock.timers.map(x => x.at - clock.now).sort((a, b) => a - b),      // ms from now until each pending timer
        watch(dark, ...rest) { t.cleanup = E.D.bfdWatchIdle(rest.length ? rest[0] : el, !!dark, IDLE); return t.cleanup; },
    };
    return t;
}
const scn = (name, fn) => { const r = attempt(fn); check(name, !r.err && r.v === null, r.err ? 'threw: ' + r.err : r.v); };
const stillOf = (dark, key, search) => makeEnv({ search: search || '' }).D.bfdImageUrl(dark, key, true);
const EXP_LIGHT = stillOf(false, 'halloween'), EXP_DARK = stillOf(true, 'halloween'), EXP_DARK_MUERTOS = stillOf(true, 'muertos', '?headerScene=muertos');
const isImage = (x) => /^url\("data:image\/svg\+xml,/.test(x);
const verdict = (p) => (p.length ? p : null);

scn('D83 idle (a): light, today\'s scene (Halloween): nothing is still at once or 1 ms before idleMs; at exactly idleMs the class is set, --bfd-img-still is bfdImageUrl(false, "halloween", true) and no timer is left pending', () => {
    const t = makeIdle(), p = [];
    if (!isImage(EXP_LIGHT)) p.push('setup: the expected still image is ' + EXP_LIGHT);
    t.watch(false);
    if (t.still() || t.prop() !== '') p.push('still, or the property is set, before any time has passed');
    t.advance(IDLE - 1);
    if (t.still()) p.push('class set 1 ms early');
    if (t.prop() !== '') p.push('property set 1 ms early');
    if (t.pending().length !== 1) p.push('while counting down there should be exactly one pending timer, found ' + t.pending().length);
    t.advance(1);
    if (!t.still()) p.push('class not set at exactly idleMs');
    if (t.prop() !== EXP_LIGHT) p.push('--bfd-img-still is not the light Halloween still image: ' + t.prop().slice(0, 50));
    if (t.pending().length !== 0) p.push('a timer is still pending once it is still (' + t.pending() + ')');
    return verdict(p);
});
scn('D83 idle (a): dark, with ?headerScene=muertos: at exactly idleMs --bfd-img-still is bfdImageUrl(true, "muertos", true) (the theme and the scene of the day are used)', () => {
    const t = makeIdle({ search: '?headerScene=muertos' }), p = [];
    t.watch(true);
    t.advance(IDLE - 1);
    if (t.still() || t.prop() !== '') p.push('still 1 ms early');
    t.advance(1);
    if (!t.still()) p.push('class not set at idleMs');
    if (!isImage(EXP_DARK_MUERTOS) || t.prop() !== EXP_DARK_MUERTOS) p.push('--bfd-img-still is not the dark Muertos still image: ' + t.prop().slice(0, 50));
    if (t.prop() === EXP_DARK) p.push('it is the Halloween image');
    return verdict(p);
});

scn('D83 idle (b): all six input events (pointermove, pointerdown, keydown, wheel, touchstart, scroll) are registered once on window with { capture: true, passive: true }, and visibilitychange once on document', () => {
    const t = makeIdle(), p = [];
    t.watch(false);
    for (const n of EVENTS) {
        const hits = t.win.added.filter(a => a.name === n);
        if (hits.length !== 1) p.push(`${n}: registered ${hits.length} times`);
        else if (!(hits[0].o && hits[0].o.capture === true && hits[0].o.passive === true)) p.push(`${n}: options are ${JSON.stringify(hits[0].o)}`);
    }
    const vis = t.doc.added.filter(a => a.name === 'visibilitychange');
    if (vis.length !== 1) p.push(`document visibilitychange: registered ${vis.length} times`);
    return verdict(p);
});
for (const n of EVENTS) {
    scn(`D83 idle (b) ${n}: while still, firing it takes the class off at once and re-arms (still again only after another idleMs, not before)`, () => {
        const t = makeIdle(), p = [];
        t.watch(false);
        t.advance(IDLE);
        if (!t.still()) p.push('setup: not still after idleMs');
        if (t.fire(n) === 0) p.push('no listener is registered for it');
        if (t.still()) p.push('still the class after the event');
        if (t.pending().length !== 1) p.push('re-armed timers: ' + t.pending().length);
        t.advance(IDLE - 1);
        if (t.still()) p.push('still again after only idleMs - 1');
        t.advance(1);
        if (!t.still()) p.push('not still idleMs after the event');
        return verdict(p);
    });
}

scn('D83 idle (c): activity while NOT still pushes the deadline back, but at most once per second: two pointermoves 100 ms apart re-arm once, and a keydown 900 ms after the first adds nothing', () => {
    const t = makeIdle(), p = [];
    t.watch(false);
    const base = t.clock.scheduled;
    t.advance(2000); t.fire('pointermove');
    if (t.clock.scheduled !== base + 1) p.push('the first pointermove should re-arm once, timers scheduled: ' + (t.clock.scheduled - base));
    const deadline = t.pending();
    if (deadline.length !== 1 || deadline[0] !== IDLE) p.push('after the first pointermove the deadline should be idleMs away, got ' + deadline);
    t.advance(100); t.fire('pointermove');
    if (t.clock.scheduled !== base + 1) p.push('the second pointermove 100 ms later re-armed again (timers scheduled: ' + (t.clock.scheduled - base) + ')');
    if (eq(t.pending(), [IDLE - 100]) === false) p.push('the deadline moved: ' + t.pending());
    t.advance(800); t.fire('keydown');
    if (t.clock.scheduled !== base + 1) p.push('a keydown 900 ms after the re-arm re-armed again (timers scheduled: ' + (t.clock.scheduled - base) + ')');
    if (eq(t.pending(), [IDLE - 900]) === false) p.push('the deadline moved again: ' + t.pending());
    if (t.pending().length !== 1) p.push('pending timers: ' + t.pending().length);
    return verdict(p);
});
scn('D83 idle (c): an event 2.5 s after the last re-arm pushes the deadline back again; it goes still idleMs after that event, and the superseded timer never fires', () => {
    const t = makeIdle(), p = [];
    t.watch(false);
    t.advance(2000); t.fire('pointermove');         // re-armed at +2000, so the first deadline would be +2000 + idleMs
    t.advance(2500); t.fire('wheel');               // 2.5 s later: re-armed again, deadline +4500 + idleMs
    if (t.pending().length !== 1) p.push('pending timers: ' + t.pending().length);
    t.advance(IDLE - 1);                            // now +9499: past the first deadline (+7000), before the second (+9500)
    if (t.still()) p.push('still before the pushed-back deadline (the superseded timer fired, or the deadline was not pushed back)');
    t.advance(1);
    if (!t.still()) p.push('not still at the pushed-back deadline');
    return verdict(p);
});

scn('D83 idle (d): a hidden tab makes it still at once (class and property, timer stopped); visible again wakes it and restarts the countdown', () => {
    const t = makeIdle(), p = [];
    t.watch(false);
    t.advance(1000);
    t.setHidden(true); t.fireDoc('visibilitychange');
    if (!t.still()) p.push('not still at once when the tab is hidden');
    if (t.prop() !== EXP_LIGHT) p.push('property is not the still image');
    if (t.pending().length !== 0) p.push('a timer is pending while hidden');
    t.advance(IDLE * 3);
    if (!t.still()) p.push('it woke by itself while hidden');
    t.setHidden(false); t.fireDoc('visibilitychange');
    if (t.still()) p.push('still after the tab became visible');
    if (t.pending().length !== 1) p.push('pending timers after the tab became visible: ' + t.pending().length);
    t.advance(IDLE - 1);
    if (t.still()) p.push('still again too early after becoming visible');
    t.advance(1);
    if (!t.still()) p.push('not still idleMs after becoming visible');
    return verdict(p);
});
scn('D83 idle (d): while the tab is hidden none of the six input events wakes it; they wake it again once the tab is visible', () => {
    const t = makeIdle(), p = [];
    t.watch(false);
    t.setHidden(true); t.fireDoc('visibilitychange');
    for (const n of EVENTS) { t.fire(n); if (!t.still()) p.push(`${n} woke it while hidden`); }
    if (t.pending().length !== 0) p.push('a timer was armed while hidden');
    t.setHidden(false); t.fireDoc('visibilitychange');
    if (t.still()) p.push('still after becoming visible');
    t.advance(IDLE); t.fire('pointerdown');
    if (t.still()) p.push('an event after becoming visible did not keep it awake');
    return verdict(p);
});

scn('D83 idle (e): the observer watches the masthead element; an initial on-screen report keeps the countdown; off screen makes it still at once, input and time do not wake it, on screen again wakes it and restarts the countdown', () => {
    const t = makeIdle(), p = [];
    t.watch(false);
    if (t.ios.length !== 1) return ['observers created: ' + t.ios.length];
    const io = t.ios[0];
    if (io.observed.length !== 1 || io.observed[0] !== t.el) p.push('the observer does not observe the masthead element');
    t.advance(1000); io.report(true);
    if (t.still()) p.push('still after an initial on-screen report');
    if (t.pending().length !== 1) p.push('pending timers after the initial report: ' + t.pending().length);
    t.advance(1000); io.report(false);
    if (!t.still()) p.push('not still at once when the masthead leaves the screen');
    if (t.prop() !== EXP_LIGHT) p.push('property is not the still image');
    if (t.pending().length !== 0) p.push('a timer is pending while off screen');
    for (const n of EVENTS) { t.fire(n); if (!t.still()) p.push(`${n} woke it while off screen`); }
    t.advance(IDLE * 2);
    if (!t.still()) p.push('time woke it while off screen');
    io.report(true);
    if (t.still()) p.push('still after the masthead came back on screen');
    t.advance(IDLE - 1);
    if (t.still()) p.push('still again too early after coming back on screen');
    t.advance(1);
    if (!t.still()) p.push('not still idleMs after coming back on screen');
    return verdict(p);
});
scn('D83 idle (e): off screen and hidden together: becoming visible while still off screen stays still, and coming back on screen while the tab is hidden stays still; it wakes only when both are clear', () => {
    const p = [];
    {   // off screen first, then hidden, then visible (still off screen), then on screen
        const t = makeIdle(); t.watch(false); const io = t.ios[0];
        io.report(false);
        t.setHidden(true); t.fireDoc('visibilitychange'); t.setHidden(false); t.fireDoc('visibilitychange');
        if (!t.still()) p.push('A: woke when the tab became visible although the masthead is still off screen');
        t.fire('keydown');
        if (!t.still()) p.push('A: an input event woke it while off screen');
        io.report(true);
        if (t.still()) p.push('A: still after both are clear');
    }
    {   // hidden first, then off screen, then on screen (still hidden), then visible
        const t = makeIdle(); t.watch(false); const io = t.ios[0];
        t.setHidden(true); t.fireDoc('visibilitychange');
        io.report(false); io.report(true);
        if (!t.still()) p.push('B: woke when the masthead came back on screen although the tab is hidden');
        t.setHidden(false); t.fireDoc('visibilitychange');
        if (t.still()) p.push('B: still after both are clear');
        if (t.pending().length !== 1) p.push('B: pending timers once both are clear: ' + t.pending().length);
    }
    return verdict(p);
});

scn('D83 idle (f): the cleanup removes every listener it added (same event, handler and capture flag) from window and document, clears the pending timer and disconnects the observer; later events and time change nothing', () => {
    const t = makeIdle(), p = [];
    const cleanup = t.watch(false);
    if (typeof cleanup !== 'function') return ['bfdWatchIdle did not return a function'];
    t.advance(1000);
    if (t.win.added.length < EVENTS.length || t.doc.added.length < 1 || t.pending().length !== 1) p.push('setup: listeners or the timer were not set up');
    cleanup();
    const names = (rec) => rec.active.map(l => l.name + (l.capture ? ' (capture)' : ''));
    if (t.win.active.length) p.push('window listeners left: ' + names(t.win));
    if (t.doc.active.length) p.push('document listeners left: ' + names(t.doc));
    const unmatched = (rec) => rec.added.filter(a => !rec.removed.some(r => r.name === a.name && r.fn === a.fn && r.capture === a.capture)).map(a => a.name);
    if (unmatched(t.win).length) p.push('window adds with no matching remove (event, handler, capture): ' + unmatched(t.win));
    if (unmatched(t.doc).length) p.push('document adds with no matching remove: ' + unmatched(t.doc));
    if (t.pending().length !== 0) p.push('a timer is still pending after the cleanup');
    if (t.ios[0].disconnected !== 1) p.push('the observer was disconnected ' + t.ios[0].disconnected + ' times');
    if (t.still() || t.prop() !== '') p.push('class or property left behind');
    const callsAfter = t.el.calls.length;
    EVENTS.forEach(n => t.fire(n)); t.setHidden(true); t.fireDoc('visibilitychange'); t.advance(IDLE * 3);
    if (t.el.calls.length !== callsAfter || t.still() || t.prop() !== '') p.push('an event or the clock changed the element after the cleanup');
    if (t.pending().length !== 0) p.push('a timer was armed after the cleanup');
    return verdict(p);
});
scn('D83 idle (f): the cleanup while still removes the class and the --bfd-img-still property; nothing comes back with time or events', () => {
    const t = makeIdle(), p = [];
    const cleanup = t.watch(false);
    t.advance(IDLE);
    if (!t.still() || t.prop() !== EXP_LIGHT) p.push('setup: not still with the image set');
    cleanup();
    if (t.still()) p.push('class left on the element');
    if (t.prop() !== '' || '--bfd-img-still' in t.el.props) p.push('custom property left on the element');
    if (t.win.active.length || t.doc.active.length || t.pending().length) p.push('listeners or a timer left: ' + [t.win.active.length, t.doc.active.length, t.pending().length]);
    EVENTS.forEach(n => t.fire(n)); t.advance(IDLE * 3);
    if (t.still() || t.prop() !== '') p.push('it came back after the cleanup');
    return verdict(p);
});
scn('D83 idle (f): a new watcher after a cleanup on the same element (the dark-mode toggle re-runs the effect) starts clean, and its still image is the new theme\'s', () => {
    const t = makeIdle(), p = [];
    const c1 = t.watch(false);
    t.advance(IDLE);
    if (t.prop() !== EXP_LIGHT) p.push('setup: the light still image was not set');
    c1();
    const c2 = t.watch(true);
    if (t.still()) p.push('the new watcher starts still');
    t.advance(IDLE - 1);
    if (t.still()) p.push('the new watcher is still after idleMs - 1');
    t.advance(1);
    if (!t.still() || t.prop() !== EXP_DARK) p.push('the new watcher\'s image is not the dark still image');
    if (EXP_DARK === EXP_LIGHT) p.push('setup: light and dark stills are the same string');
    c2();
    if (t.win.active.length || t.doc.active.length) p.push('listeners left after the second cleanup');
    return verdict(p);
});

scn('D83 idle (g): with prefers-reduced-motion: reduce it watches nothing: returns a function, registers no listener, observer or timer, sets nothing, and the function does nothing', () => {
    const t = makeIdle({ reduced: true }), p = [];
    const r = t.watch(false);
    if (typeof r !== 'function') return ['returned ' + typeof r];
    if (!t.media.some(q => /prefers-reduced-motion\s*:\s*reduce/.test(q))) p.push('it never asked matchMedia about prefers-reduced-motion: reduce (' + t.media + ')');
    if (t.win.added.length || t.doc.added.length) p.push('listeners were registered: ' + [t.win.added.length, t.doc.added.length]);
    if (t.ios.length) p.push('an observer was created');
    if (t.clock.scheduled) p.push('a timer was scheduled');
    t.advance(IDLE * 10); EVENTS.forEach(n => t.fire(n));
    r();
    if (t.el.calls.length || t.still() || t.prop() !== '') p.push('the element was touched: ' + t.el.calls);
    if (t.win.removed.length || t.doc.removed.length) p.push('the no-op removed listeners');
    return verdict(p);
});
for (const [label, el] of [['null', null], ['undefined', undefined]]) {
    scn(`D83 idle (h): a ${label} element returns a no-op function and registers nothing`, () => {
        const t = makeIdle(), p = [];
        const r = t.watch(false, el);
        if (typeof r !== 'function') return ['returned ' + typeof r];
        if (t.win.added.length || t.doc.added.length || t.ios.length || t.clock.scheduled) p.push('it registered or scheduled something');
        r();
        if (t.win.removed.length || t.doc.removed.length) p.push('the no-op removed listeners');
        return verdict(p);
    });
}
scn('D83 idle (i): with no IntersectionObserver in the browser it still works: the idle timer, the input events, a hidden tab and the cleanup', () => {
    const t = makeIdle({ noObserver: true }), p = [];
    if (typeof t.E.ctx.IntersectionObserver !== 'undefined') return ['setup: the sandbox has an IntersectionObserver'];
    const cleanup = t.watch(false);
    if (typeof cleanup !== 'function') return ['returned ' + typeof cleanup];
    t.advance(IDLE);
    if (!t.still() || t.prop() !== EXP_LIGHT) p.push('not still after idleMs');
    t.fire('pointerdown');
    if (t.still()) p.push('an input event did not wake it');
    t.advance(IDLE);
    if (!t.still()) p.push('not still again after another idleMs');
    t.setHidden(true); t.fireDoc('visibilitychange'); t.setHidden(false); t.fireDoc('visibilitychange');
    if (t.still()) p.push('hidden then visible did not leave it awake');
    cleanup();
    if (t.win.active.length || t.doc.active.length || t.pending().length || t.still() || t.prop() !== '') p.push('the cleanup left something behind');
    return verdict(p);
});
scn('D83 idle (i): with no window.matchMedia (an old browser) it is treated as not reduced motion and works', () => {
    const t = makeIdle({ noMatchMedia: true }), p = [];
    if (typeof t.E.ctx.matchMedia !== 'undefined') return ['setup: the sandbox has matchMedia'];
    t.watch(false);
    t.advance(IDLE);
    if (!t.still() || t.prop() !== EXP_LIGHT) p.push('not still after idleMs');
    return verdict(p);
});

scn('D83 idle (j): the still image is built only when first needed and then once: nothing is built while counting down, and a second idle period re-runs no drawing code and looks up no block', () => {
    const t = makeIdle(), p = [];
    t.watch(false);
    t.advance(IDLE - 1);
    if (t.E.spy.gets.length || t.E.spy.runs.length) p.push('something was looked up or run before the first idle: ' + [t.E.spy.gets, t.E.spy.runs]);
    t.advance(1);
    if (!t.still()) return ['setup: not still after idleMs'];
    const first = t.prop(), runs1 = t.E.spy.runs.length, gets1 = t.E.spy.gets.length;
    if (runs1 !== 1) p.push('the first still image ran ' + runs1 + ' scene blocks, expected 1');
    const reg = t.E.ctx.__bfdScenes, orig = reg.halloween;
    let draws = 0;
    reg.halloween = function () { draws++; return orig.apply(this, arguments); };      // counts any rebuild: a cache miss would call this
    t.fire('keydown');
    t.advance(IDLE);
    if (!t.still()) p.push('not still the second time');
    t.fire('wheel'); t.advance(IDLE);
    if (draws !== 0) p.push('the scene was drawn again ' + draws + ' times');
    if (t.E.spy.runs.length !== runs1 || t.E.spy.gets.length !== gets1) p.push('a block was looked up or run again');
    if (t.prop() !== first) p.push('the second image differs from the first');
    return verdict(p);
});

// ---- 10. D83: the page wiring (read from the HTML, nothing is run) ----
section('D83 page wiring: the 1500px CSS rule, the component effect, the idle time');
const cssText = [...html.replace(/<script\b[\s\S]*?<\/script>/g, '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
// The page's top-level @media blocks: { prelude, body, start, end }, braces counted (comments are already gone).
function mediaBlocks(css) {
    const out = [];
    for (let from = 0; ;) {
        const at = css.indexOf('@media', from);
        if (at < 0) break;
        const open = css.indexOf('{', at);
        if (open < 0) break;
        let depth = 0, i = open;
        for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
        out.push({ prelude: css.slice(at + 6, open).replace(/\s+/g, ' ').trim(), body: css.slice(open + 1, i), start: at, end: i + 1 });
        from = i + 1;
    }
    return out;
}
{
    const blocks = mediaBlocks(cssText);
    const m1500 = blocks.filter(b => /^\(\s*min-width\s*:\s*1500px\s*\)$/.test(b.prelude));
    const withStill = m1500.filter(b => /\.bfd-masthead\.bfd-still\s*\{/.test(b.body));
    const outside = blocks.slice().reverse().reduce((s, b) => s.slice(0, b.start) + s.slice(b.end), cssText);
    check('D83 CSS: the rule ".bfd-masthead.bfd-still" is inside the @media (min-width: 1500px) block, beside the base ".bfd-masthead" background rule',
        withStill.length === 1 && /\.bfd-masthead\s*\{[^}]*background-image\s*:\s*var\(--bfd-img\)/.test(withStill[0].body), { media1500Blocks: m1500.length, withStill: withStill.length });
    check('D83 CSS: it appears nowhere outside a media block (a rule outside would paint the doodle on narrow windows, where the base rule does not)', !/\.bfd-masthead\.bfd-still/.test(outside), (outside.match(/.{0,40}\.bfd-masthead\.bfd-still.{0,60}/) || [])[0]);
    const rule = withStill.length ? /\.bfd-masthead\.bfd-still\s*\{([^}]*)\}/.exec(withStill[0].body) : null, decl = rule ? rule[1].replace(/\s+/g, ' ') : '';
    check('D83 CSS: the rule sets background-image to var(--bfd-img-still, var(--bfd-img)) (the animated image is the fallback until a still one is set)', /background-image\s*:\s*var\(\s*--bfd-img-still\s*,\s*var\(\s*--bfd-img\s*\)\s*\)/.test(decl), decl);
    check('D83 CSS: and it keeps the second layer, var(--bfd-sky), so the sky gradient does not disappear while still', /background-image\s*:[^;]*,\s*var\(\s*--bfd-sky\s*\)\s*(?:;|$)/.test(decl), decl);
}
check('D83 component: a useEffect with the dependency array [darkMode] returns bfdWatchIdle(mastheadRef.current, darkMode, BFD_IDLE_MS) (so the cleanup runs on unmount and on a theme change)',
    /useEffect\(\s*\(\)\s*=>\s*(?:\{\s*return\s+)?bfdWatchIdle\(\s*mastheadRef\.current\s*,\s*darkMode\s*,\s*BFD_IDLE_MS\s*\)\s*;?\s*(?:\}\s*)?,\s*\[\s*darkMode\s*\]\s*\)/.test(appScript),
    (appScript.match(/.{0,50}bfdWatchIdle\([^)]*\).{0,40}/g) || []).slice(0, 3));
check('D83 component: bfdWatchIdle is called from exactly one place outside its own definition', (appScript.replace(/function bfdWatchIdle\(/, '').match(/bfdWatchIdle\(/g) || []).length === 1, (appScript.match(/bfdWatchIdle\(/g) || []).length);
check('D83 component: mastheadRef is on the element whose class is bfd-masthead (the one the CSS rule styles)', /<div\s+ref=\{mastheadRef\}[^>]*className="[^"]*\bbfd-masthead\b/.test(appScript));
check('D83: BFD_IDLE_MS is a number between 15000 and 300000 (15 s to 5 min)', typeof D.BFD_IDLE_MS === 'number' && Number.isFinite(D.BFD_IDLE_MS) && D.BFD_IDLE_MS >= 15000 && D.BFD_IDLE_MS <= 300000, D.BFD_IDLE_MS);

console.log(`\n${checks - failures} of ${checks} checks passed`);
if (failures) { console.log(`\n❌ FAIL -- ${failures} check(s) failed`); process.exit(1); }
console.log('\n✅ PASS');

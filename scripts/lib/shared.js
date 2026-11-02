/**
 * The shared-logic pipeline's one implementation. Decision D1, option a, made 2026-10-05: pure logic
 * that both the app and Apps Script need lives in shared/ and is GENERATED into the app and into Apps
 * Script, with a CI --check that fails when either copy is stale (the pattern dist/index.html and
 * scripts/build_deployable.js --check already use).
 *
 * Pure logic that both the app and Apps Script need lives in shared/ (plain ES5 files, see the
 * header of shared/00_core.js for the convention). This module turns those files into the exact text
 * that ships, and scripts/sync_shared.js writes that text into the app HTML (between two marker
 * lines) and into apps-script/Shared.gs. tests/check_shared_sync.js and any other consumer get the
 * text, or the evaluated BFShared object, from here instead of re-deriving it: a second copy of the
 * wrapper or of the marker rules is exactly the drift this pipeline exists to prevent.
 *
 * THE SHIPPED TEXT. Files are concatenated in filename order inside ONE wrapper, so the whole thing
 * adds exactly one top-level name (BFShared) to whatever script it lands in:
 *
 *   var BFShared = (function () {
 *     'use strict';
 *     var BFShared = {};
 *     <for each file in filename order: a banner comment line, the file's text, then a line holding
 *      only a semicolon>
 *     return BFShared;
 *   })();
 *
 * The semicolon line stops a file that ends without one from fusing with the next file's first
 * statement (ASI does not insert one before an opening parenthesis). The files' text is indented 2
 * spaces inside the wrapper (and the whole thing 8 more inside the app HTML), which is why findHazards
 * rejects a line ending in a backslash: a string line continuation would silently gain leading
 * spaces. Output is deterministic: no timestamps, no hashes, no locale-dependent sorting.
 *
 * WHY buildSharedSource REFUSES SOME TEXT (findHazards). The shipped text lands inside an HTML script
 * element, between marker lines the sync searches for, and inside a file whose comments other tests
 * strip with a regex, so it refuses:
 *   - a close-script tag or an HTML comment opener (they would end or confuse the script element);
 *   - the two marker substrings (a shared header that quoted them would make every later sync fail
 *     with "marker appears 2 times");
 *   - U+2028 / U+2029 and a leading BOM (invisible; line terminators in older JavaScript);
 *   - a backtick in code (shared files are ES5, and a template literal can hold a newline followed by
 *     a slash-star that no line-based rule would see);
 *   - a slash-star anywhere except as the opener of a real block comment that begins its own line.
 *     tests/check_team_features_logic.js removes comments from the app source with
 *     /\/\*[\s\S]*?\*\//g BEFORE inspecting code, so a slash-star inside a line comment, a string or a
 *     regular expression opens a fake block comment that swallows real code up to the next close-comment
 *     and silently breaks unrelated checks.
 * Refusing to build is better than shipping text that breaks something far away. The slash-star and
 * backtick rules come from a small lexical scanner (comments, quoted strings, regular expression
 * literals) written here because scripts/ may use only Node builtins; it is a heuristic, not a parser,
 * and tests/check_shared_sync.js cross-checks it against a real parser on the real files.
 *
 * Only Node builtins here (scripts/ must run with no `npm install`). Importing this file has no side
 * effects.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHARED_DIR = 'shared';

// The two marker lines inside the app HTML's text/babel block. Located by these substrings only.
const BEGIN_MARKER = '>>> BEGIN GENERATED SHARED LOGIC';
const END_MARKER = '<<< END GENERATED SHARED LOGIC';

// Prepended to apps-script/Shared.gs. Line comments only, so nothing here can trip the comment rule.
const GS_HEADER = [
    '// GENERATED FILE -- DO NOT EDIT.',
    '// Written by scripts/sync_shared.js from the files in shared/. Edit those, then run:',
    '//     node scripts/sync_shared.js',
    '// `node scripts/sync_shared.js --check` (part of CI) fails while this file is stale.',
    '// Defines the single global BFShared. Apps Script loads this file at startup, so another .gs',
    '// file must use BFShared only inside functions that run later, never in its own top-level code.',
    '',
].join('\n');

// shared/ file names: a fixed-width two-digit order prefix (so 09_ sorts before 10_, which "9_" would
// not), an underscore, then a name. *.test.js and *.spec.js are refused because they would ship.
const SHARED_FILE_RE = /^[0-9]{2}_[A-Za-z0-9_.-]+\.js$/;
const SHARED_FILE_RULE = 'use NN_name.js: two digits, an underscore, then letters, digits, _ . or -; ' +
    'the .js file must not end in .test.js or .spec.js (it would ship)';

/**
 * The shared source files under `root`, as [{ name, text }] in plain code-unit filename order.
 * Everything in shared/ must be a regular NN_name.js file (dotfiles such as .DS_Store are ignored): a
 * subdirectory, a symlink, or a file of another type would otherwise be skipped without a word, and
 * its logic would silently never ship.
 */
function readSharedFiles(root) {
    const dir = path.join(root, SHARED_DIR);
    if (!fs.existsSync(dir)) throw new Error(`${SHARED_DIR}/ directory not found under ${root}`);
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
    const bad = [];
    const names = [];
    for (const e of entries) {
        if (e.isSymbolicLink()) bad.push(`${e.name} (a symlink; it would be skipped)`);
        else if (e.isDirectory()) bad.push(`${e.name} (a subdirectory; it would be skipped)`);
        else if (!e.isFile() || !e.name.endsWith('.js')) bad.push(`${e.name} (not a .js file; it would be skipped)`);
        else if (!SHARED_FILE_RE.test(e.name) || /\.(test|spec)\.js$/.test(e.name)) bad.push(e.name);
        else names.push(e.name);
    }
    if (bad.length) throw new Error(`${SHARED_DIR}/ entries not allowed: ${bad.join(', ')} (${SHARED_FILE_RULE})`);
    if (names.length === 0) throw new Error(`no .js files in ${SHARED_DIR}/ under ${root}`);
    names.sort(); // default sort compares UTF-16 code units: the same answer on every machine and locale
    return names.map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

// After these a slash starts a regular expression literal, not a division. Words in REGEX_KEYWORDS count
// too (`return /x/`). A closing paren, bracket or brace, a name, a number or a string means division.
const REGEX_PRECEDERS = '(,=:[!&|?{;+-*%<>~^/';
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof']);

/**
 * Walks `text` once as JavaScript source (code, // comments, block comments, 'x' and "x" strings, regular
 * expression literals) and calls report(index, message) for the two lexical hazards: a backtick in code,
 * and a slash-star anywhere but the opener of a block comment that begins its own line. A slash-star
 * inside a block comment is harmless (the stripping regex's span ends at the first close-comment either
 * way) and is not reported.
 */
function scanLexical(text, report) {
    const n = text.length;
    const word = /[A-Za-z0-9_$]/;
    let i = 0;
    let prev = '';     // last significant character in code ('w' after a name, number or keyword)
    let prevWord = ''; // that name, when prev === 'w'
    while (i < n) {
        const c = text[i];
        const d = text[i + 1];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
        if (c === '/' && d === '/') {
            const nl = text.indexOf('\n', i);
            const stop = nl === -1 ? n : nl;
            const at = text.indexOf('/*', i);
            if (at !== -1 && at < stop) {
                report(at, 'slash-star inside a // comment (tests strip comments with a regex that would treat it as a block-comment opener)');
            }
            i = stop;
            continue;
        }
        if (c === '/' && d === '*') {
            if (text.slice(text.lastIndexOf('\n', i - 1) + 1, i).trim() !== '') {
                report(i, 'slash-star must open a block comment that begins its own line, never follow code');
            }
            const close = text.indexOf('*/', i + 2);
            if (close === -1) { report(i, 'unterminated block comment'); return; }
            i = close + 2;
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
            const at = text.indexOf('/*', i);
            if (at !== -1 && at < j) report(at, 'slash-star inside a string literal (the comment-stripping regex would treat it as a block-comment opener)');
            i = j < n && text[j] === c ? j + 1 : j;
            prev = c;
            continue;
        }
        if (c === '`') {
            report(i, 'backtick in code: template literals are not ES5, and one can hide a newline plus a slash-star from every line-based rule');
            i++;
            prev = c;
            continue;
        }
        if (c === '/') {
            if (prev === '' || REGEX_PRECEDERS.includes(prev) || (prev === 'w' && REGEX_KEYWORDS.has(prevWord))) {
                let j = i + 1;
                let inClass = false;
                while (j < n && text[j] !== '\n') {
                    const ch = text[j];
                    if (ch === '\\') { j += 2; continue; }
                    if (ch === '[') inClass = true;
                    else if (ch === ']') inClass = false;
                    else if (ch === '/' && !inClass) break;
                    j++;
                }
                const at = text.indexOf('/*', i + 1);
                if (at !== -1 && at < j) report(at, 'slash-star inside a regular expression literal (the comment-stripping regex would treat it as a block-comment opener)');
                i = Math.min(j + 1, n);
                prev = ')'; // a regular expression is a value: a following slash is a division
            } else {
                i++;
                prev = '/';
            }
            continue;
        }
        if (word.test(c)) {
            let j = i;
            while (j < n && word.test(text[j])) j++;
            prev = 'w';
            prevWord = text.slice(i, j);
            i = j;
            continue;
        }
        prev = c;
        i++;
    }
}

/** Problems that make a file unsafe to ship, as human-readable strings. [] means none. */
function findHazards(files) {
    const problems = [];
    for (const { name, text } of files) {
        const lineAt = (index) => text.slice(0, index).split('\n').length;
        const at = (line, msg) => problems.push(`${SHARED_DIR}/${name}:${line}: ${msg}`);
        if (text.length === 0) { at(1, 'file is empty'); continue; }
        if (text.charCodeAt(0) === 0xFEFF) at(1, 'starts with a BOM (U+FEFF); shared files are plain UTF-8 without one');
        if (text.includes('\r')) at(1, 'contains a CR character; shared files are LF only (see .gitattributes)');
        if (!text.endsWith('\n')) at(text.split('\n').length, 'file must end with a newline');
        text.split('\n').forEach((line, i) => {
            const n = i + 1;
            if (/[\u2028\u2029]/.test(line)) at(n, 'contains U+2028 or U+2029, invisible line terminators');
            if (/<\/script/i.test(line)) at(n, 'contains a close-script tag, which would end the HTML script element');
            if (line.includes('<!--')) at(n, 'contains an HTML comment opener, which can confuse the HTML script element');
            for (const marker of [BEGIN_MARKER, END_MARKER]) {
                if (line.includes(marker)) at(n, `contains the generated-region marker "${marker}", which would make the app HTML's marker count wrong on the next sync`);
            }
            if (/(^|[^\\])(\\\\)*\\$/.test(line)) at(n, 'line ends with a backslash (a string line continuation); the text is indented when it ships, which would change the string');
        });
        scanLexical(text, (index, msg) => at(lineAt(index), msg));
    }
    return problems;
}

/** Pure: the shipped text for these files. Does not check hazards (buildSharedSource does). */
function assembleSharedSource(files) {
    const parts = [
        'var BFShared = (function () {\n',
        "  'use strict';\n",
        '  var BFShared = {};\n',
    ];
    for (const { name, text } of files) {
        parts.push(indent(`// ---- ${SHARED_DIR}/${name} ----\n${text}`, 2), '  ;\n');
    }
    parts.push('  return BFShared;\n', '})();\n');
    return parts.join('');
}

/** The exact text that ships, built from the shared/ directory under `root`. Throws on a hazard. */
function buildSharedSource({ root = REPO_ROOT } = {}) {
    const files = readSharedFiles(root);
    const problems = findHazards(files);
    if (problems.length) throw new Error(`shared source is not safe to ship:\n  ${problems.join('\n  ')}`);
    return assembleSharedSource(files);
}

/**
 * Evaluates the shipped text in a FRESH vm context that has only the JavaScript built-ins -- no
 * window, document, require, module or process -- and returns the BFShared it defines. A shared
 * function that touches any of those fails here with a ReferenceError, which is the point.
 *
 * REALM WARNING: everything it returns belongs to that other vm realm. An array or object a shared
 * function returns has a different Array.prototype / Object.prototype from the caller's own, so
 * assert.deepStrictEqual(shared.f(x), [1, 2]) fails even when the contents match. Compare primitives,
 * or JSON.stringify both sides (tests/check_shared_sync.js does), never prototypes.
 */
function loadShared({ root = REPO_ROOT } = {}) {
    const context = vm.createContext({});
    return new vm.Script(`${buildSharedSource({ root })}\nBFShared;\n`, { filename: 'shared (generated)' })
        .runInContext(context);
}

/** Indent every non-empty line by `spaces` spaces; empty lines stay empty (no trailing whitespace). */
function indent(text, spaces) {
    const pad = ' '.repeat(spaces);
    return text.split('\n').map((l) => (l === '' ? l : pad + l)).join('\n');
}

function countOf(haystack, needle) {
    return haystack.split(needle).length - 1;
}

/**
 * Finds the region between the two marker lines in the app HTML. Throws, never guesses, when a
 * marker is missing, duplicated, out of order, or not alone on a `//` comment line.
 * Returns { start, end }: the text strictly between the marker lines is html.slice(start, end), and
 * both marker lines lie outside it (so they are kept byte for byte).
 */
function locateRegion(html) {
    for (const [label, marker] of [['BEGIN', BEGIN_MARKER], ['END', END_MARKER]]) {
        const n = countOf(html, marker);
        if (n === 0) throw new Error(`the ${label} marker "${marker}" was not found in the app HTML`);
        if (n > 1) throw new Error(`the ${label} marker "${marker}" appears ${n} times in the app HTML; expected exactly one`);
    }
    const lineOf = (marker) => {
        const at = html.indexOf(marker);
        const lineStart = html.lastIndexOf('\n', at) + 1;
        const nl = html.indexOf('\n', at);
        const lineEnd = nl === -1 ? html.length : nl + 1;
        if (!/^[ \t]*\/\/[ \t]*$/.test(html.slice(lineStart, at))) {
            throw new Error(`the marker "${marker}" must sit on its own line, after a // comment opener`);
        }
        return { lineStart, lineEnd };
    };
    const begin = lineOf(BEGIN_MARKER);
    const end = lineOf(END_MARKER);
    if (end.lineStart < begin.lineEnd) throw new Error('the END marker comes before the BEGIN marker in the app HTML');
    return { start: begin.lineEnd, end: end.lineStart };
}

/** The app HTML with its generated region replaced by `sharedSource`, indented 8 spaces. */
function renderHtml(html, sharedSource) {
    if (html.includes('\r')) throw new Error('the app HTML has CR line endings; the sync writes LF only');
    const { start, end } = locateRegion(html);
    return html.slice(0, start) + indent(sharedSource, 8) + html.slice(end);
}

/** The full text of apps-script/Shared.gs. */
function renderGs(sharedSource) {
    return GS_HEADER + sharedSource;
}

module.exports = {
    REPO_ROOT, SHARED_DIR, BEGIN_MARKER, END_MARKER, GS_HEADER,
    readSharedFiles, findHazards, assembleSharedSource, buildSharedSource, loadShared,
    indent, locateRegion, renderHtml, renderGs,
};

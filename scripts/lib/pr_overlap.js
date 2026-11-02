// Function-level overlap between two branches: the logic behind scripts/check_pr_overlap.js.
//
// WHY THIS EXISTS. Every change to this app lands in ONE 17,000-line HTML file, so "both branches changed
// the same file" is always true and says nothing. Two branches that were each green on their own can still
// break each other when merged (a semantic conflict): git merges the text cleanly because the edits are far
// apart, but both edits are to the SAME FUNCTION, and the combined function is wrong. #185 and #186 were
// exactly that. The useful question is therefore "did both branches touch the same function?", and the
// answer needs a map from "changed line number" to "enclosing function".
//
// WHY FUNCTION-LEVEL, NOT LINE-LEVEL OR FILE-LEVEL. Line-level is what git already does, and it is blind
// to meaning. File-level is useless here (above). A function is the smallest unit whose body a reader
// holds in their head, so two edits inside one function are the ones that interact.
//
// WHY INDENTATION-BASED INSTEAD OF A TOKENIZER / PARSER. The script block mixes JSX, regex literals,
// multi-line template strings and 70 useState hooks in one 8,700-line component. A hand-rolled parser for
// all of that is fragile, and a real parser (Babel) would be a dependency this script must not have (it runs
// with plain Node). The code is formatted consistently enough that "a declaration line owns the lines that
// are indented deeper, up to its closing bracket line" is right almost everywhere. A small lexer is still
// used, but ONLY for two things indentation cannot tell us: which lines are inside a block comment or a
// template literal (their indentation means nothing), and the brace depth at each line (used as a veto, see
// scanSource). Where this guess is wrong it is wrong locally: one mislabelled line, never a crash.
//
// WHY MAP THROUGH THE MERGE-BASE (the "old side"). A deleted or modified line only exists in the OLD file, so
// its enclosing function is looked up in the merge-base version. If it were looked up in the branch version,
// every line number after an earlier insertion would be shifted and the line would land in the wrong
// function. A pure addition has no old line, so it is looked up in the NEW (branch) version. Branches are
// then compared by symbol NAME PATH ("App > handleShowInTable"), never by line number, because two branches
// number the same function differently.
//
// This file never writes the two-character sequence that opens a block comment outside a real comment
// (AGENTS.md hazard): it is assembled from pieces where the lexer needs it.
'use strict';

const cp = require('child_process');

// Pieces of the comment delimiters, assembled so this source never contains the sequences literally.
const BLOCK_OPEN = '/' + '*';
const BLOCK_CLOSE = '*' + '/';

// The generated shared-logic region of the app file (see AGENTS.md "Shared logic"): written by
// scripts/sync_shared.js from the files in shared/. Its source (shared/) is checked instead, so reporting the copy
// would double count and flag every sync as an overlap.
const GEN_BEGIN = '>>> BEGIN GENERATED SHARED LOGIC';
const GEN_END = '<<< END GENERATED SHARED LOGIC';
const BABEL_TAG_RE = /<script[^>]*type\s*=\s*["']text\/babel["'][^>]*>/i;
const SCRIPT_CLOSE_RE = /<\/script>/i;

const OUTSIDE_SCRIPT = '<html: outside the script>';
const TOP_LEVEL = '<top-level>';

// ---------------------------------------------------------------------------------------------
// 1. Which files are considered at all
// ---------------------------------------------------------------------------------------------

// Derived or vendored content, never reported: dist/ is generated from the app, Shared.gs is generated from
// shared/, vendored libraries are not ours. Matched on the path, before any git object is read.
function isSkippedPath(p) {
    return p.startsWith('dist/') || p === 'apps-script/Shared.gs' || p.startsWith('node_modules/') ||
        p.startsWith('tests/vendor/') || /\.min\.js$/.test(p);
}

// 'js' for .js/.gs, 'html' for .html (confirmed by content later), null for everything else. Non-code files
// (markdown, csv, json, xlsx) are ignored on purpose: git reports textual conflicts there itself, and there
// is no "function" to compare.
function fileKindFor(p) {
    if (/\.(js|gs|mjs|cjs)$/.test(p)) return 'js';
    if (/\.html?$/.test(p)) return 'html';
    return null;
}

// An app build is recognised by CONTENT (it carries the Babel script tag), never by file name: the name
// carries a version that changes with every release.
function isAppHtmlText(text) {
    return BABEL_TAG_RE.test(text);
}

// ---------------------------------------------------------------------------------------------
// 2. The lexer: per-line facts that indentation cannot give us
// ---------------------------------------------------------------------------------------------

// After one of these words a quote or a slash starts a value (a string or a regex), not an operator.
const VALUE_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void',
    'throw', 'new', 'await', 'yield', 'else', 'do', 'default']);
// After one of these characters a string or regex may begin. '<' and '>' are deliberately absent for regex:
// '</div>' is a closing JSX tag, not a regex that starts at the slash.
const OPERAND_STARTERS = '(,=:[!&|?{;+-*%~^';

function stringAllowed(prev, prevWord) {
    // A quote right after a plain word is JSX text ("Don't"), not a string. That one rule is what keeps an
    // apostrophe in a label from swallowing the rest of the line and unbalancing the brace count.
    if (prev === '') return true;
    if (prev === 'w') return VALUE_KEYWORDS.has(prevWord);
    if (prev === '=>') return true;
    return OPERAND_STARTERS.indexOf(prev) !== -1 || prev === '<' || prev === '>';
}

function regexAllowed(prev, prevWord) {
    if (prev === '') return true;
    if (prev === 'w') return VALUE_KEYWORDS.has(prevWord);
    if (prev === '=>') return true;
    return prev.length === 1 && OPERAND_STARTERS.indexOf(prev) !== -1;
}

function scanString(s, j) {
    const q = s[j];
    let k = j + 1;
    while (k < s.length) {
        if (s[k] === '\\') k += 2;
        else if (s[k] === q) return k + 1;
        else k++;
    }
    return s.length; // unterminated: strings end at the end of the line (JSX text can contain a lone quote)
}

function scanRegex(s, j) {
    let k = j + 1;
    let inClass = false;
    while (k < s.length) {
        const c = s[k];
        if (c === '\\') { k += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
            k++;
            while (k < s.length && /[a-z]/.test(s[k])) k++; // flags
            return k;
        }
        k++;
    }
    return -1; // no closing slash on this line: it was a division, not a regex
}

// One record per line:
//   verbatim   the line STARTS inside a block comment or a template literal: its indentation and content
//              are not structure and must never open or close a symbol
//   trivial    blank or comment-only: changes to it are not behaviour changes
//   depthStart / depthEnd   curly-brace depth before and after the line (template ${} not counted)
function lexSource(lines) {
    const out = new Array(lines.length);
    const frames = []; // template literal frames: {t:'tpl'} or {t:'expr', braces}
    let inBlock = false;
    let depth = 0;
    let prev = '';
    let prevWord = '';
    let drift = 0;
    for (let li = 0; li < lines.length; li++) {
        const s = lines[li];
        const rec = { depthStart: depth, depthEnd: depth, verbatim: inBlock || frames.length > 0, trivial: frames.length === 0 };
        let j = 0;
        const n = s.length;
        while (j < n) {
            if (inBlock) {
                const e = s.indexOf(BLOCK_CLOSE, j);
                if (e < 0) { j = n; break; }
                inBlock = false;
                j = e + 2;
                continue;
            }
            const top = frames.length ? frames[frames.length - 1] : null;
            if (top && top.t === 'tpl') {
                const tc = s[j];
                if (tc === '\\') { j += 2; continue; }
                if (tc === '`') { frames.pop(); prev = ')'; prevWord = ''; j++; continue; }
                if (tc === '$' && s[j + 1] === '{') { frames.push({ t: 'expr', braces: 0 }); prev = '{'; prevWord = ''; j += 2; continue; }
                j++;
                continue;
            }
            const c = s[j];
            if (c === ' ' || c === '\t') { j++; continue; }
            if (c === '/') {
                const d = s[j + 1];
                if (d === '/') break;                                  // line comment: the rest is not code
                if (d === '*') { inBlock = true; j += 2; continue; }
                rec.trivial = false;
                if (regexAllowed(prev, prevWord) && d !== '>') {       // '/>' ends a JSX tag
                    const end = scanRegex(s, j);
                    if (end > 0) { j = end; prev = ')'; prevWord = ''; continue; }
                }
                prev = '/'; prevWord = ''; j++;
                continue;
            }
            rec.trivial = false;
            if (c === '"' || c === "'") {
                if (stringAllowed(prev, prevWord)) { j = scanString(s, j); prev = ')'; prevWord = ''; continue; }
                prev = 'x'; prevWord = ''; j++;
                continue;
            }
            if (c === '`') { frames.push({ t: 'tpl' }); j++; continue; }
            if (c === '{') {
                if (top) top.braces++; else depth++;
                prev = '{'; prevWord = ''; j++;
                continue;
            }
            if (c === '}') {
                if (top) { if (top.braces === 0) frames.pop(); else top.braces--; }
                else { depth--; if (depth < 0) { depth = 0; drift++; } }
                prev = '}'; prevWord = ''; j++;
                continue;
            }
            if (/[A-Za-z_$]/.test(c)) {
                let k = j + 1;
                while (k < n && /[\w$]/.test(s[k])) k++;
                prev = 'w'; prevWord = s.slice(j, k); j = k;
                continue;
            }
            if (/[0-9]/.test(c)) {
                let k = j + 1;
                while (k < n && /[\w.]/.test(s[k])) k++;
                prev = 'n'; prevWord = ''; j = k;
                continue;
            }
            if (c === '=' && s[j + 1] === '>') { prev = '=>'; prevWord = ''; j += 2; continue; }
            prev = c; prevWord = ''; j++;
        }
        rec.depthEnd = depth;
        out[li] = rec;
    }
    out.drift = drift;
    return out;
}

// ---------------------------------------------------------------------------------------------
// 3. The symbol scanner
// ---------------------------------------------------------------------------------------------

const CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'else', 'do',
    'try', 'finally', 'typeof', 'new', 'await', 'yield', 'throw', 'delete', 'void']);
const IDENT = '[A-Za-z_$][\\w$]*';

function indentOf(raw) {
    let n = 0;
    for (let i = 0; i < raw.length; i++) {
        if (raw[i] === ' ') n++;
        else if (raw[i] === '\t') n += 4;
        else break;
    }
    return n;
}

// Does the right-hand side of a declaration start like a function (so the declared name IS a function)?
// This is deliberately about the START of the right-hand side: "const ids = rows.map(r => r.id)" contains an
// arrow but is a value, not a function, and making every local like that a symbol would split one function's
// changes across dozens of fake symbols.
const RHS_FUNCTION_PATTERNS = [
    /^(?:async\s+)?function\b/,
    /^class\b/,
    /^(?:React\.)?(?:memo|forwardRef|useCallback|useMemo)\s*\(/,
    new RegExp('^(?:async\\s+)?' + IDENT + '\\s*=>'),
    /^(?:async\s*)?\((?:[^()]|\([^()]*\))*\)\s*=>/,                    // (a, b) => ...
    new RegExp('^\\(\\s*(?:async\\s+)?(?:function\\b|\\([^()]*\\)\\s*=>|' + IDENT + '\\s*=>)'), // IIFE
    new RegExp('^(?:React\\.)?use[A-Z]\\w*\\(\\s*(?:async\\s+)?(?:\\([^()]*\\)|' + IDENT + ')\\s*=>'), // useState(() => ...)
];
function parenBalance(s) {
    let b = 0;
    for (let i = 0; i < s.length; i++) { if (s[i] === '(') b++; else if (s[i] === ')') b--; }
    return b;
}
function rhsIsFunction(rhs) {
    if (RHS_FUNCTION_PATTERNS.some((re) => re.test(rhs))) return true;
    // Arrow whose parameter list opens here and closes on a later line:  const Foo = ({
    return /^(?:async\s*)?\(\s*[{[]/.test(rhs) && parenBalance(rhs) > 0;
}

const FUNCTION_DECL_RE = new RegExp('^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s*(' + IDENT + ')\\s*\\(');
const CLASS_DECL_RE = new RegExp('^(?:export\\s+(?:default\\s+)?)?class\\s+(' + IDENT + ')');
const VAR_DECL_RE = new RegExp('^(?:export\\s+)?(?:const|let|var)\\s+(' + IDENT + ')\\s*(=\\s*(.*)|;.*)?$');
const ARRAY_DECL_RE = new RegExp('^(?:const|let|var)\\s+\\[\\s*(' + IDENT + ')\\s*[,\\]][^=]*=\\s*(.*)$');
const ASSIGN_FN_RE = new RegExp('^(' + IDENT + '(?:\\.' + IDENT + ')+)\\s*=\\s*(?:async\\s+)?' +
    '(?:function\\b|\\([^()]*\\)\\s*=>|' + IDENT + '\\s*=>)');
const METHOD_RE = new RegExp('^(?:(?:async|static|get|set)\\s+)*\\*?(' + IDENT + ')\\s*\\([^()]*\\)\\s*\\{\\s*(?://.*)?$');
const PROP_FN_RE = new RegExp('^(?:async\\s+)?(?:[\'"]([^\'"]+)[\'"]|(' + IDENT + '))\\s*:\\s*(?:async\\s+)?' +
    '(?:function\\b|\\([^()]*\\)\\s*=>|' + IDENT + '\\s*=>|(?:React\\.)?(?:useCallback|memo)\\()');
const EFFECT_RE = /^(?:React\.)?(useEffect|useLayoutEffect|useInsertionEffect)\s*\(/;
const LISTENER_RE = new RegExp('^(' + IDENT + '(?:\\.' + IDENT + ')*)\\.addEventListener\\(\\s*([\'"`])([^\'"`]+)\\2');

// Returns {name, kind, anon} when this (trimmed) line starts a symbol, else null.
// atTop: no symbol is open, so every named declaration (constants and data tables included) counts: two
// branches editing the same top-level constant is a real overlap. Inside a symbol only function-like
// declarations count, so a function's local variables do not become symbols of their own.
function matchDeclaration(first, atTop) {
    let m;
    if ((m = FUNCTION_DECL_RE.exec(first))) return { name: m[1], kind: 'function' };
    if ((m = CLASS_DECL_RE.exec(first))) return { name: m[1], kind: 'class' };
    if ((m = EFFECT_RE.exec(first))) return { name: m[1], kind: 'effect', anon: m[1] };
    // A listener registration is a symbol only at the top level (a block of its own); inside an effect it is one
    // statement of that effect.
    if (atTop && (m = LISTENER_RE.exec(first))) return { name: m[1] + '.addEventListener(' + m[3] + ')', kind: 'listener' };
    if ((m = VAR_DECL_RE.exec(first))) {
        const rhs = m[3] !== undefined ? m[3] : '';
        if (atTop || rhsIsFunction(rhs)) return { name: m[1], kind: rhsIsFunction(rhs) ? 'function' : 'value' };
        return null;
    }
    if ((m = ARRAY_DECL_RE.exec(first))) {
        // const [value, setValue] = useState(() => { ... }): named after the state variable, only when the
        // initialiser is itself a function (otherwise it is a one-line statement of its parent).
        if (rhsIsFunction(m[2])) return { name: m[1], kind: 'state' };
        return null;
    }
    if ((m = ASSIGN_FN_RE.exec(first))) return { name: m[1], kind: 'function' };
    if ((m = METHOD_RE.exec(first)) && !CONTROL_WORDS.has(m[1])) return { name: m[1], kind: 'method' };
    if ((m = PROP_FN_RE.exec(first))) return { name: m[1] || m[2], kind: 'property' };
    return null;
}

// Section banners: the fallback label for lines that are in no symbol.
const BANNER_RES = [
    { re: /^\/\/\s*={3,}\s*BEGIN\s+(.+?)\s*={3,}\s*$/, set: true },
    { re: /^\/\/\s*={3,}\s*END\b/, set: false },
    { re: /^\/\/\s*={3,}\s*(.+?)\s*={3,}\s*$/, set: true },
    { re: /^\/\/\s*-{2,}\s*(.+?)\s+START\s*-{2,}\s*$/, set: true },
    { re: /^\/\/\s*-{2,}\s*(.+?)\s+END\s*-{2,}\s*$/, set: false },
];
function bannerOf(first) {
    for (let i = 0; i < BANNER_RES.length; i++) {
        const m = BANNER_RES[i].re.exec(first);
        if (m) return BANNER_RES[i].set ? m[1] : null;
    }
    return undefined; // not a banner
}

// A line that continues the previous expression even though it sits at a symbol's own indentation
// (a chained call, a ternary arm, a boolean operand), so it must not end the symbol.
function isContinuationStart(first) {
    return /^(?:[.?:,|&+]|=>)/.test(first);
}

// A top-level declaration, used only for resynchronising after the lexer lost track (see below).
const TOP_DECL_RE = /^(?:export\s+)?(?:const|let|var|function|async\s+function|class)\s/;

// An anonymous effect has no name, so it is named after its dependency list: "useEffect[tab, rows]". The list
// is on the closing line, and may continue onto the next lines (the real app has an 11-item list wrapped over
// two). Only the first three dependencies are kept so that adding a dependency later does not rename the
// effect; a longer list ends in "...". "always" is an effect with no list (runs after every render).
function effectDeps(lines, end) {
    const text = lines.slice(end, end + 6).join(' ');
    const m = /,\s*\[([^\]]*)\]\s*\)/.exec(text);
    if (!m) return /^\s*[}\])]*\s*\)\s*;?/.test(lines[end] || '') ? 'always' : '?';
    const deps = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    return deps.slice(0, 3).join(', ') + (deps.length > 3 ? ', ...' : '');
}

// Scan one file's text. Returns an object with lookup(lineNumber) (1-based) giving
//   {path: [outermost ... innermost symbol names], region, trivial, skip}
// path is empty for a line in no symbol, and then region names the section banner (or "<top-level>").
// skip is true for the generated shared-logic region. opts.kind is 'js' or 'html'.
function scanSource(text, opts) {
    const kind = (opts && opts.kind) || 'js';
    const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
    let from = 0;
    let to = lines.length;
    if (kind === 'html') {
        // Only the Babel script block is code. Lines outside it (CSS, markup) are labelled as such.
        const tag = lines.findIndex((l) => BABEL_TAG_RE.test(l));
        if (tag < 0) { from = to = 0; } else {
            from = tag + 1;
            let end = from;
            while (end < lines.length && !SCRIPT_CLOSE_RE.test(lines[end])) end++;
            to = end;
        }
    }
    const slice = lines.slice(from, to);
    const lex = lexSource(slice);

    const frameAt = new Array(lines.length).fill(null);
    const genAt = new Array(lines.length).fill(false);
    const trivialAt = new Array(lines.length).fill(false);
    const regionAt = new Array(lines.length).fill(TOP_LEVEL);
    const frames = [];
    const stack = [];
    let region = null;
    let inGen = false;
    let baseIndent = -1;
    let lastStructural = from;
    let resyncs = 0;

    function popTop(endLine) {
        const f = stack.pop();
        f.end = endLine;
        f.endText = lines[endLine];
        return f;
    }

    for (let i = 0; i < slice.length; i++) {
        const abs = from + i;
        const raw = slice[i];
        const rec = lex[i];
        const first = raw.trim();
        trivialAt[abs] = rec.trivial;
        if (raw.indexOf(GEN_BEGIN) !== -1) inGen = true;
        if (inGen) {
            // The generated region is self-contained and never opens or closes a frame of ours.
            genAt[abs] = true;
            if (raw.indexOf(GEN_END) !== -1) inGen = false;
            continue;
        }
        let top = stack.length ? stack[stack.length - 1] : null;
        if (rec.verbatim || rec.trivial) {
            if (!rec.verbatim) {
                const b = bannerOf(first);
                if (b !== undefined) {
                    // A section banner sits BETWEEN symbols. A one-line symbol just before it is still on the stack
                    // (it only ends when the next code line arrives), so end whatever the banner's own indentation
                    // and the brace depth say is finished before reading the banner as top level.
                    const bi = indentOf(raw);
                    while (stack.length && rec.depthStart <= stack[stack.length - 1].d0 && bi <= stack[stack.length - 1].indent) popTop(lastStructural);
                    if (!stack.length) region = b;
                }
            }
            frameAt[abs] = stack.length ? stack[stack.length - 1] : null;
            regionAt[abs] = region || TOP_LEVEL;
            continue;
        }
        const indent = indentOf(raw);
        if (baseIndent < 0) baseIndent = indent;
        if (indent < baseIndent) {
            // Sloppily dedented code (the real app has a block whose body sits at 4 spaces inside a function
            // at 18). Indentation below the script's own base cannot end anything.
            frameAt[abs] = top;
            regionAt[abs] = region || TOP_LEVEL;
            continue;
        }
        const closer = /^[}\])]/.test(first);

        // Resynchronise if the lexer lost count: a top-level declaration at the base indent while a base-indent
        // symbol is still open by brace count means a brace was miscounted earlier (a lone brace in JSX text, a
        // regex taken for division). Close everything and carry on, so one bad line cannot swallow the file.
        if (stack.length && indent === baseIndent && stack[0].indent === baseIndent && TOP_DECL_RE.test(first) &&
            rec.depthStart > stack[0].d0) {
            while (stack.length) popTop(lastStructural);
            resyncs++;
        }

        let owner = null;
        while (stack.length) {
            const t = stack[stack.length - 1];
            const closes = closer && rec.depthEnd <= t.d0;
            // Brace veto: a symbol cannot end on a line that is still inside a brace opened after it started,
            // whatever the indentation says. This is what survives the sloppily indented block above.
            if (!(rec.depthStart <= t.d0 || closes)) break;
            if (indent > t.indent) break;                                  // deeper: still inside
            if (indent === t.indent && !closer && isContinuationStart(first)) break;
            if (closes && (indent === t.indent || rec.depthStart > t.d0)) { owner = popTop(abs); break; }
            popTop(lastStructural);                                        // ended on the previous line
        }

        let cur = owner || (stack.length ? stack[stack.length - 1] : null);
        if (!owner && !closer) {
            const decl = matchDeclaration(first, stack.length === 0);
            if (decl) {
                const f = {
                    rawName: decl.name, name: decl.name, kind: decl.kind, anon: decl.anon || null, indent,
                    d0: rec.depthStart, start: abs, end: abs, endText: raw, parent: stack.length ? stack[stack.length - 1] : null,
                    hint: undefined, path: null,
                };
                frames.push(f);
                stack.push(f);
                cur = f;
            }
        }
        if (cur && cur.hint === undefined && abs !== cur.start) cur.hint = first.slice(0, 32);
        frameAt[abs] = cur;
        regionAt[abs] = region || TOP_LEVEL;
        lastStructural = abs;
    }
    while (stack.length) popTop(lastStructural);

    // Final names. Anonymous effects are named after their dependency list, which is on the closing line.
    // Siblings that still collide get a hint (first body line) and then a counter, so every path is unique.
    for (const f of frames) {
        if (f.anon) f.rawName = f.anon + '[' + effectDeps(lines, f.end) + ']';
    }
    const byParent = new Map();
    for (const f of frames) {
        if (!byParent.has(f.parent)) byParent.set(f.parent, new Map());
        const m = byParent.get(f.parent);
        if (!m.has(f.rawName)) m.set(f.rawName, []);
        m.get(f.rawName).push(f);
    }
    for (const m of byParent.values()) {
        for (const group of m.values()) {
            if (group.length === 1) { group[0].name = group[0].rawName; continue; }
            const seen = new Map();
            for (const f of group) {
                let nm = f.anon && f.hint ? f.rawName + ' "' + f.hint + '"' : f.rawName;
                const k = (seen.get(nm) || 0) + 1;
                seen.set(nm, k);
                if (k > 1) nm += ' #' + k;
                f.name = nm;
            }
        }
    }
    const pathOf = (f) => {
        if (!f) return [];
        if (!f.path) f.path = pathOf(f.parent).concat(f.name);
        return f.path;
    };

    return {
        kind,
        lineCount: lines.length,
        symbolCount: frames.length,
        distinctSymbolNames: new Set(frames.map((f) => f.name)).size,
        resyncs,
        lexDrift: lex.drift || 0,
        frames,
        pathOf,
        lookup(lineNo) {
            const idx = lineNo - 1;
            if (idx < 0 || idx >= lines.length) return { path: [], region: TOP_LEVEL, trivial: false, skip: false };
            if (genAt[idx]) return { path: [], region: null, trivial: true, skip: true };
            if (idx < from || idx >= to) {
                return { path: [], region: OUTSIDE_SCRIPT, trivial: /^\s*$/.test(lines[idx]), skip: false };
            }
            const f = frameAt[idx];
            return { path: pathOf(f), region: f ? null : regionAt[idx], trivial: trivialAt[idx], skip: false, span: f ? f.end - f.start + 1 : 0 };
        },
    };
}

// ---------------------------------------------------------------------------------------------
// 4. Reading `git diff -U0`
// ---------------------------------------------------------------------------------------------

function headerPath(s) {
    s = s.replace(/\t.*$/, '');
    if (s === '/dev/null') return null;
    if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1);
    return s.replace(/^[ab]\//, '');
}

// Returns [{file, oldStart, oldCount, newStart, newCount}]. With -U0 a hunk body is exactly oldCount lines
// starting with "-" then newCount lines starting with "+" (plus "\ No newline" markers). The body is consumed
// by COUNT, not by looking at its first characters: a deleted line whose text begins with "-- " is printed
// as "--- ..." and would otherwise be taken for the next file header.
function parseDiffHunks(diffText) {
    const hunks = [];
    const lines = diffText.split('\n');
    let oldFile = null;
    let file = null;
    let remaining = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (remaining > 0) {
            if (line.startsWith('\\')) continue;
            remaining--;
            continue;
        }
        if (line.startsWith('diff --git ')) { oldFile = null; file = null; continue; }
        if (line.startsWith('--- ')) { oldFile = headerPath(line.slice(4)); continue; }
        if (line.startsWith('+++ ')) { file = headerPath(line.slice(4)); continue; }
        const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (m) {
            const h = {
                file: file || oldFile,
                oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]),
                newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]),
            };
            hunks.push(h);
            remaining = h.oldCount + h.newCount;
        }
    }
    return hunks;
}

// ---------------------------------------------------------------------------------------------
// 5. From hunks to "which symbols did this branch change"
// ---------------------------------------------------------------------------------------------

function entryKey(file, path, region) {
    return file + '\u0000' + (path.length ? path.join(' > ') : '<' + region + '>');
}

// hunks: the hunks of ONE file. baseScan()/headScan(): lazily build the scan of the merge-base / branch
// version (null when that version does not exist). Returns a Map key -> {file, path, region, removed, added}.
function changeSetForFile(file, hunks, baseScan, headScan) {
    const out = new Map();
    function add(info, field, count) {
        const k = entryKey(file, info.path, info.region);
        let e = out.get(k);
        if (!e) { e = { file, path: info.path, region: info.path.length ? null : info.region, span: info.span || 0, removed: 0, added: 0 }; out.set(k, e); }
        e[field] += count;
    }
    for (const h of hunks) {
        let used = false;
        if (h.oldCount > 0) {
            // Deleted or modified lines exist only in the OLD file: look them up in the merge-base version.
            const sc = baseScan();
            if (sc) {
                let firstInfo = null;
                for (let l = h.oldStart; l < h.oldStart + h.oldCount; l++) {
                    const info = sc.lookup(l);
                    if (info.skip || info.trivial) continue;
                    add(info, 'removed', 1);
                    if (!firstInfo) firstInfo = info;
                }
                if (firstInfo) {
                    used = true;
                    if (h.newCount > 0) add(firstInfo, 'added', h.newCount);
                }
            }
        }
        if (!used && h.newCount > 0) {
            // A pure addition has no old line (or only comments were replaced): look the NEW lines up in the
            // branch version.
            const sc = headScan();
            if (sc) {
                for (let l = h.newStart; l < h.newStart + h.newCount; l++) {
                    const info = sc.lookup(l);
                    if (info.skip || info.trivial) continue;
                    add(info, 'added', 1);
                }
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// 6. Comparing two change sets
// ---------------------------------------------------------------------------------------------

function isPrefix(a, b) { // a is a strict ancestor path of b
    if (a.length >= b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
function sameDeepPath(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
function topOf(e) { return e.path.length ? e.path[0] : '<' + e.region + '>'; }

// HIGH: both branches changed the same innermost symbol, or one changed a symbol and the other changed a
// function nested inside it (relation "nested"; only below the top level, because "someone edited a line of
// the 8,700-line App body" says nothing about someone editing one of its handlers).
// LOW: both changed something under the same top-level symbol (or the same banner region) but no pair above
// matched: the same big component, different functions.
// a and b are Maps key -> entry from changeSetForFile, merged over all files of a branch.
function compareChangeSets(a, b) {
    const high = [];
    const highTops = new Set();
    const byFileB = new Map();
    for (const e of b.values()) {
        if (!byFileB.has(e.file)) byFileB.set(e.file, []);
        byFileB.get(e.file).push(e);
    }
    for (const ea of a.values()) {
        for (const eb of byFileB.get(ea.file) || []) {
            let relation = null;
            if (ea.path.length && sameDeepPath(ea.path, eb.path)) relation = 'same';
            else if (isPrefix(ea.path, eb.path) && ea.path.length >= 2) relation = 'nested';
            else if (isPrefix(eb.path, ea.path) && eb.path.length >= 2) relation = 'nested';
            if (relation) {
                high.push({
                    file: ea.file, symbol: (ea.path.length >= eb.path.length ? ea.path : eb.path).join(' > '), relation,
                    span: ea.path.length >= eb.path.length ? ea.span : eb.span,
                    ref: { removed: ea.removed, added: ea.added }, other: { removed: eb.removed, added: eb.added },
                });
                highTops.add(ea.file + '\u0000' + topOf(ea));
            }
        }
    }
    // Merge HIGH rows that name the same symbol and relation (an entry can pair with several nested ones).
    const merged = new Map();
    for (const h of high) {
        const k = h.file + '\u0000' + h.symbol + '\u0000' + h.relation;
        if (!merged.has(k)) merged.set(k, h);
    }
    const lowAgg = new Map();
    for (const ea of a.values()) {
        for (const eb of byFileB.get(ea.file) || []) {
            if (topOf(ea) !== topOf(eb)) continue;
            const key = ea.file + '\u0000' + topOf(ea);
            if (highTops.has(key)) continue;
            if (!lowAgg.has(key)) lowAgg.set(key, { file: ea.file, symbol: topOf(ea), ref: { removed: 0, added: 0 }, other: { removed: 0, added: 0 }, _a: new Set(), _b: new Set() });
            const l = lowAgg.get(key);
            if (!l._a.has(ea)) { l._a.add(ea); l.ref.removed += ea.removed; l.ref.added += ea.added; }
            if (!l._b.has(eb)) { l._b.add(eb); l.other.removed += eb.removed; l.other.added += eb.added; }
        }
    }
    const low = [...lowAgg.values()].map((l) => ({ file: l.file, symbol: l.symbol, ref: l.ref, other: l.other }));
    return { high: [...merged.values()], low };
}

// ---------------------------------------------------------------------------------------------
// 7. Git
// ---------------------------------------------------------------------------------------------

function makeGit(cwd, env) {
    function run(args, opts) {
        const r = cp.spawnSync('git', args, {
            cwd, encoding: 'utf8', maxBuffer: 1 << 29, input: opts && opts.input,
            env: Object.assign({}, process.env, env || {}, { GIT_TERMINAL_PROMPT: '0' }),
        });
        if (r.error) throw r.error;
        return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
    }
    return {
        run,
        // stdout, trimmed; null when git exits non-zero
        tryOut(args) { const r = run(args); return r.status === 0 ? r.stdout.trim() : null; },
        out(args) {
            const r = run(args);
            if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr.trim() || 'exit ' + r.status));
            return r.stdout.trim();
        },
    };
}

// Glob over a ref's short name. Two stars cross slashes, one star does not, a question mark is one character.
function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*';
        } else if (c === '?') re += '[^/]';
        else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$');
}

function shortName(refname, remote) {
    const p = 'refs/remotes/' + remote + '/';
    if (refname.startsWith(p)) return remote + '/' + refname.slice(p.length);
    return refname.replace(/^refs\/heads\//, '');
}

// Branches to compare against. Default: every remote-tracking branch of `remote`. `against` is a glob over
// the name after "<remote>/", or, when it starts with "refs/", over the full ref name (used by tests and for
// comparing refs fetched under another namespace).
function listCandidates(git, remote, against) {
    const full = against && against.startsWith('refs/');
    const prefix = full ? against.replace(/[*?].*$/, '').replace(/[^/]*$/, '') || 'refs/' : 'refs/remotes/' + remote + '/';
    const raw = git.out(['for-each-ref', '--format=%(refname)%09%(objectname)', prefix]);
    const re = against ? globToRegExp(against) : null;
    const out = [];
    for (const line of raw.split('\n')) {
        if (!line) continue;
        const [refname, sha] = line.split('\t');
        if (refname === 'refs/remotes/' + remote + '/HEAD') continue;
        const cmp = full ? refname : refname.slice(('refs/remotes/' + remote + '/').length);
        if (re && !re.test(cmp)) continue;
        out.push({ refname, sha, name: shortName(refname, remote) });
    }
    return out;
}

const DIFF_PATHSPEC = ['*.js', '*.gs', '*.mjs', '*.cjs', '*.html', '*.htm',
    ':(exclude)dist', ':(exclude)apps-script/Shared.gs', ':(exclude)tests/vendor', ':(exclude)node_modules'];

// The set of symbols `tip` changed relative to its merge-base with `base`. `cache` memoises file contents
// and scans (many branches share a merge-base, so the merge-base file is read and scanned once).
function branchChanges(git, baseSha, tipSha, cache) {
    const mb = git.tryOut(['merge-base', baseSha, tipSha]);
    if (!mb) return { mergeBase: null, changes: new Map(), files: [] };
    const diff = git.run(['-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames',
        mb, tipSha, '--'].concat(DIFF_PATHSPEC));
    if (diff.status !== 0) throw new Error('git diff failed: ' + diff.stderr.trim());
    const byFile = new Map();
    for (const h of parseDiffHunks(diff.stdout)) {
        if (!h.file || isSkippedPath(h.file)) continue;
        if (!byFile.has(h.file)) byFile.set(h.file, []);
        byFile.get(h.file).push(h);
    }
    const content = (rev, file) => {
        const k = rev + ':' + file;
        if (!cache.text.has(k)) {
            const r = git.run(['show', k]);
            cache.text.set(k, r.status === 0 ? r.stdout : null);
        }
        return cache.text.get(k);
    };
    const scanOf = (rev, file, kind) => {
        const k = rev + ':' + file;
        if (!cache.scan.has(k)) {
            const t = content(rev, file);
            cache.scan.set(k, t === null ? null : scanSource(t, { kind }));
        }
        return cache.scan.get(k);
    };
    const changes = new Map();
    const files = [];
    for (const [file, hunks] of byFile) {
        let kind = fileKindFor(file);
        if (!kind) continue;
        if (kind === 'html') {
            const a = content(mb, file);
            const b = content(tipSha, file);
            if (!((a !== null && isAppHtmlText(a)) || (b !== null && isAppHtmlText(b)))) continue; // not an app build
        }
        files.push(file);
        const set = changeSetForFile(file, hunks, () => scanOf(mb, file, kind), () => scanOf(tipSha, file, kind));
        for (const [k, v] of set) changes.set(k, v);
    }
    return { mergeBase: mb, changes, files };
}

function sumLines(changes) {
    let n = 0;
    for (const e of changes.values()) n += e.removed + e.added;
    return n;
}

// The whole analysis. Returns a plain object (the --json shape); the CLI only formats it.
function analyze(opts) {
    const { git, log } = opts;
    const remote = opts.remote || 'origin';
    const say = log || (() => {});
    const baseName = opts.base || remote + '/main';
    const baseSha = git.tryOut(['rev-parse', '--verify', '--quiet', baseName + '^{commit}']);
    if (!baseSha) throw new Error('cannot resolve the base "' + baseName + '" (pass --base <rev>, or --fetch to get ' + remote + ')');

    // The branch under test. A PR number is fetched through refs/pull/N/head and read from FETCH_HEAD, so no
    // local ref is created or moved.
    let refName;
    let refSha;
    const spec = opts.ref || 'HEAD';
    const pr = /^#?(\d+)$/.exec(spec);
    if (pr) {
        const f = git.run(['fetch', '--quiet', remote, 'refs/pull/' + pr[1] + '/head']);
        if (f.status !== 0) throw new Error('cannot fetch refs/pull/' + pr[1] + '/head from ' + remote + ': ' + f.stderr.trim());
        refSha = git.out(['rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
        refName = '#' + pr[1];
    } else {
        refSha = git.tryOut(['rev-parse', '--verify', '--quiet', spec + '^{commit}']);
        if (!refSha) throw new Error('cannot resolve --ref "' + spec + '"');
        refName = spec === 'HEAD' ? (git.tryOut(['symbolic-ref', '--short', '-q', 'HEAD']) || 'HEAD') : spec;
    }

    const cache = { text: new Map(), scan: new Map() };
    const mine = branchChanges(git, baseSha, refSha, cache);
    const result = {
        ref: { name: refName, sha: refSha, mergeBase: mine.mergeBase, files: mine.files, changedSymbols: mine.changes.size, changedLines: sumLines(mine.changes) },
        base: { name: baseName, sha: baseSha },
        compared: 0,
        skipped: [],
        overlaps: [],
        warnings: [],
        totals: { high: 0, low: 0, branchesWithHigh: 0, branchesWithLow: 0 },
    };
    const shallowHint = git.tryOut(['rev-parse', '--is-shallow-repository']) === 'true' ? ' (shallow clone: git fetch --unshallow)' : '';
    if (!mine.mergeBase) throw new Error('"' + refName + '" has no merge-base with ' + baseName + shallowHint);
    if (mine.changes.size === 0) {
        result.note = 'the ref has no changes to code files relative to the base; nothing to compare';
        return result;
    }

    const baseRefname = git.tryOut(['rev-parse', '--symbolic-full-name', baseName]);
    const refFullname = pr ? null : git.tryOut(['rev-parse', '--symbolic-full-name', spec]);
    const candidates = listCandidates(git, remote, opts.against).filter((c) => c.refname !== baseRefname && c.refname !== refFullname);
    // One call each for the three "no point comparing" sets, instead of an ancestry test per branch.
    const refset = (flag, rev) => new Set((git.tryOut(['for-each-ref', flag, rev, '--format=%(refname)']) || '').split('\n').filter(Boolean));
    const mergedIntoBase = refset('--merged', baseSha);
    const inRef = refset('--merged', refSha);
    const hasRef = refset('--contains', refSha);

    for (const c of candidates) {
        if (c.sha === refSha) { result.skipped.push({ name: c.name, reason: 'same tip as the ref' }); continue; }
        if (mergedIntoBase.has(c.refname)) { result.skipped.push({ name: c.name, reason: 'merged into the base' }); continue; }
        if (inRef.has(c.refname)) { result.skipped.push({ name: c.name, reason: 'already contained in the ref' }); continue; }
        if (hasRef.has(c.refname)) { result.skipped.push({ name: c.name, reason: 'built on top of the ref (stacked)' }); continue; }
        const theirs = branchChanges(git, baseSha, c.sha, cache);
        if (!theirs.mergeBase) { result.skipped.push({ name: c.name, reason: 'no merge-base with the base' + shallowHint }); continue; }
        if (theirs.changes.size === 0) { result.skipped.push({ name: c.name, reason: 'no changes to code files' }); continue; }
        result.compared++;
        const cmp = compareChangeSets(mine.changes, theirs.changes);
        if (!cmp.high.length && !cmp.low.length) continue;
        const info = (git.tryOut(['log', '-1', '--format=%h%x09%cs%x09%s', c.sha]) || '').split('\t');
        result.overlaps.push({
            branch: c.name, sha: c.sha, shortSha: info[0] || c.sha.slice(0, 7), date: info[1] || '', subject: info.slice(2).join('\t'),
            high: cmp.high, low: cmp.low,
        });
        say('compared ' + c.name);
    }
    // The scanner has two safety nets (a brace-count resync and a drift counter). Using one is not an error, but
    // symbol names near that spot may be off, so say so instead of staying silent.
    for (const [k, sc] of cache.scan) {
        if (sc && (sc.resyncs || sc.lexDrift)) {
            result.warnings.push(k.slice(k.indexOf(':') + 1) + ': the scanner lost count of braces (' + sc.resyncs + ' resync, ' + sc.lexDrift + ' drift); symbol names near there may be off');
        }
    }
    result.warnings = [...new Set(result.warnings)];
    result.overlaps.sort((x, y) => (y.high.length - x.high.length) || (y.low.length - x.low.length) || x.branch.localeCompare(y.branch));
    for (const o of result.overlaps) {
        result.totals.high += o.high.length;
        result.totals.low += o.low.length;
        if (o.high.length) result.totals.branchesWithHigh++;
        else if (o.low.length) result.totals.branchesWithLow++;
    }
    return result;
}

module.exports = {
    isSkippedPath, fileKindFor, isAppHtmlText, lexSource, scanSource, parseDiffHunks, changeSetForFile,
    compareChangeSets, makeGit, globToRegExp, listCandidates, branchChanges, analyze, entryKey,
    OUTSIDE_SCRIPT, TOP_LEVEL,
};

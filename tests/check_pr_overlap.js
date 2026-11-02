#!/usr/bin/env node
// Headless check for scripts/check_pr_overlap.js and scripts/lib/pr_overlap.js (function-level overlap
// between branches). Needs only Node and git: every repository here is a throwaway one under os.tmpdir()
// with an isolated git environment (no system or user git config, a fake HOME, fixed author), a bare
// repository playing the part of the remote, and nothing in the real repository is read or written.
//
// What it pins, in the order of the file:
//   1. the scanner (text in, symbol path out): nested functions, hooks, object methods, banners, template
//      literals, regex literals, JSX text, sloppy indentation, the generated region, the HTML shell
//   2. the diff reader (including the "deleted line that looks like a file header" trap) and the glob
//   3. the compare rules (same / nested / LOW) on hand-built change sets
//   4. the CLI against real repositories: same function flagged HIGH, different functions in one file not
//      flagged, two methods of one class not flagged, line-number independence, deletion-only changes,
//      generated/derived/non-code files ignored, comment-only changes ignored, merged branches skipped,
//      pull-request refs through refs/pull/N/head, --json shape, --fail-on-overlap, --max-branches
//   5. the real app builds in this checkout (found by CONTENT, never by file name): the scanner must
//      stay in sync with them (no resync, no lexer drift, sane extents)
//
// Like tests/check_history_days.js it counts executed assertions and prints that count, so a block that was
// silently skipped shows up as a changed number.
//
// PR_OVERLAP_SCRIPT_DIR points the whole test at another copy of the scripts directory (a copy with a
// deliberately broken behaviour: that is how each assertion here was shown to be able to fail).
//
// Run:  node tests/check_pr_overlap.js        (a few seconds; Node builtins and git only)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const { inspect } = require('util');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_DIR = process.env.PR_OVERLAP_SCRIPT_DIR ? path.resolve(process.env.PR_OVERLAP_SCRIPT_DIR) : path.join(REPO_ROOT, 'scripts');
const CLI = path.join(SCRIPT_DIR, 'check_pr_overlap.js');
const lib = require(path.join(SCRIPT_DIR, 'lib', 'pr_overlap.js'));

let pass = 0;
const failures = [];
function t(name, got, want) {
    try { assert.deepStrictEqual(got, want); pass++; } catch (e) {
        failures.push(name + '\n      got:  ' + inspect(got, { depth: 6 }) + '\n      want: ' + inspect(want, { depth: 6 }));
    }
}

// A scenario that throws (for example because a result it indexes into is missing) is a FAILURE with its message,
// not a crash of the whole check: the assertions after the throw in that scenario are then not counted.
function scenario(name, fn) {
    try { fn(); } catch (e) { failures.push('scenario ' + name + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}

// The comment delimiters are assembled so that THIS file never contains the sequence that opens a block
// comment outside a real comment (see AGENTS.md: the comment-stripping checks would be fooled).
const OPEN = '/' + '*';
const CLOSE = '*' + '/';

// ============================================================================================
// 1. The scanner
// ============================================================================================
const lineOf = (text, needle, nth) => {
    const lines = text.split('\n');
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(needle) !== -1 && ++seen === (nth || 1)) return i + 1;
    }
    throw new Error('fixture has no line containing: ' + needle);
};
const pathAt = (scan, text, needle, nth) => scan.lookup(lineOf(text, needle, nth)).path.join(' > ');

const JS_FIXTURE = [
    "'use strict';",
    "const util = require('util');",
    '// ===== BEGIN helpers =====',
    'const PLAIN = 1;',
    'function alpha(x) {',
    '    const local = x + 1;',
    '    return local;',
    '}',
    'if (PLAIN) console.log("banner statement");',
    '// ===== END helpers =====',
    'if (PLAIN) console.log("top statement");',
    'class Widget {',
    '    constructor(n) {',
    '        this.n = n;',
    '    }',
    '    render() {',
    '        function helper() {',
    '            return 1;',
    '        }',
    '        return helper();',
    '    }',
    '    update(v) {',
    '        this.n = v;',
    '    }',
    '}',
    'const Store = {',
    '    load() {',
    '        return 1;',
    '    },',
    '    save: function (x) {',
    '        return x;',
    '    },',
    '    flush: async (x) => {',
    '        await x;',
    '    },',
    '};',
    'BFShared.thing = function (a) {',
    '    return a;',
    '};',
    OPEN,
    ' * function notReal() {',
    ' * }',
    ' ' + CLOSE,
    'const after = (q) => q * 2;',
    '',
].join('\n');
{
    const sc = lib.scanSource(JS_FIXTURE, { kind: 'js' });
    const P = (needle, nth) => pathAt(sc, JS_FIXTURE, needle, nth);
    t('scanner js: a statement inside a plain function is that function', P('const local = x + 1;'), 'alpha');
    t('scanner js: a top-level constant is a symbol of its own', P('const PLAIN = 1;'), 'PLAIN');
    t('scanner js: a class method is Class > method', P('this.n = v;'), 'Widget > update');
    t('scanner js: the constructor is a method too', P('this.n = n;'), 'Widget > constructor');
    t('scanner js: a function nested in a method is the innermost symbol', P('return 1;', 1), 'Widget > render > helper');
    t('scanner js: a line of the method after the nested function is back in the method', P('return helper();'), 'Widget > render');
    t('scanner js: object method shorthand', P('return 1;', 2), 'Store > load');
    t('scanner js: "name: function" property', P('return x;'), 'Store > save');
    t('scanner js: "name: async arrow" property', P('await x;'), 'Store > flush');
    t('scanner js: "Name.prop = function" assignment is named by the dotted name', P('return a;'), 'BFShared.thing');
    t('scanner js: code after a block comment that looks like code is still scanned', P('const after = (q) => q * 2;'), 'after');
    t('scanner js: a function declared inside a block comment is not a symbol', sc.lookup(lineOf(JS_FIXTURE, 'function notReal')).path, []);
    t('scanner js: a statement inside a section banner is labelled by the banner', sc.lookup(lineOf(JS_FIXTURE, 'banner statement')).region, 'helpers');
    t('scanner js: after the END banner the fallback is "<top-level>"', sc.lookup(lineOf(JS_FIXTURE, 'top statement')).region, '<top-level>');
    t('scanner js: a comment-only line is trivial, a code line is not',
        [sc.lookup(lineOf(JS_FIXTURE, '// ===== BEGIN')).trivial, sc.lookup(lineOf(JS_FIXTURE, 'return local;')).trivial], [true, false]);
    t('scanner js: no resync and no lexer drift on well-formed code', [sc.resyncs, sc.lexDrift], [0, 0]);
    t('scanner js: a line number past the end of the file does not throw', lib.scanSource(JS_FIXTURE, { kind: 'js' }).lookup(9999).path, []);
}

// An app-shaped fixture: 8-space base indent, the generated region, a banner, JSX, a template literal that
// contains braces and a line that looks like a declaration, a regex literal containing a backtick, an
// apostrophe in JSX text, hooks, and the real app's sloppily indented block (body at 4 spaces inside code at 18).
const APP_FIXTURE = [
    '<!doctype html>',
    '<html><head><style>',
    '.alpha-color { color: red; }',
    '</style></head><body>',
    '<script src="https://example.invalid/react.js"></script>',
    '<script type="text/babel">',
    '        const { useState, useMemo, useCallback, useEffect } = React;',
    '',
    '        // >>> BEGIN GENERATED SHARED LOGIC -- written by scripts/sync_shared.js. Do not edit by hand.',
    '        var BFShared = function () {',
    '          function inGenerated() {',
    '            return 1;',
    '          }',
    '          return { inGenerated: inGenerated };',
    '        }();',
    '        // <<< END GENERATED SHARED LOGIC',
    '',
    '        // ===== BEGIN section one =====',
    '        const TABLE_SEED = [',
    '            { a: 1 },',
    '            { a: 2 },',
    '        ];',
    "        if (window.flagA) console.log('a');",
    '        // ===== END section one =====',
    "        if (window.flagB) console.log('b');",
    '',
    '        const formatThing = (v) => String(v).trim();',
    '',
    "        const OneLogo = React.memo(({ className = '' }) => (",
    '            <svg className={className}>',
    '                <path d="M0 0" />',
    '            </svg>',
    '        ));',
    '',
    '        function FlashReportDashboard() {',
    "            const [tab, setTab] = useState('a');",
    '            const [draft, setDraft] = useState(() => {',
    "                return 'x';",
    '            });',
    '            const handleShowInTable = useCallback((group) => {',
    "                setTab('b');",
    '                const msg = `Showing ${group} {not a block}',
    '            const fake = () => {',
    '              nothing();',
    '            }`;',
    '                return msg;',
    '            }, []);',
    '            const handleOther = useCallback(() => {',
    '                return 2;',
    '            }, []);',
    '            useEffect(() => {',
    '                if (tab) return;',
    '            }, [tab]);',
    '            useEffect(() => {',
    '                window.touched = 1;',
    '            }, []);',
    '            const re = /[`\'"]{2}/g;',
    '            const tableData = useMemo(() => {',
    '                return rows.map(row => {',
    '                    row.a = 1;',
    '                    ',
    '                  if (String(row.vvd) === \'VMS\') {',
    "    const fieldsToKeep = ['id'];",
    '    Object.keys(row).forEach(key => {',
    '        if (!fieldsToKeep.includes(key)) {',
    "            row[key] = '';",
    '        }',
    '    });',
    '}',
    '',
    '                    return row;',
    '                });',
    '            }, [rows]);',
    '            const handleAfter = useCallback(() => {',
    '                return 3;',
    '            }, []);',
    '            return (',
    '                <div>',
    "                    <p>Don't panic {tab}</p>",
    '                    {items.map((i) => (',
    '                        <Row key={i} />',
    '                    ))}',
    '                </div>',
    '            );',
    '        }',
    '',
    '        const mountApp = () => {',
    '            return 4;',
    '        };',
    '</script>',
    '</body></html>',
    '',
].join('\n');
{
    const sc = lib.scanSource(APP_FIXTURE, { kind: 'html' });
    const P = (needle, nth) => pathAt(sc, APP_FIXTURE, needle, nth);
    const D = 'FlashReportDashboard';
    t('scanner app: a line of CSS outside the script is labelled as outside the script',
        sc.lookup(lineOf(APP_FIXTURE, '.alpha-color')).region, lib.OUTSIDE_SCRIPT);
    t('scanner app: lines inside the generated region are skipped', sc.lookup(lineOf(APP_FIXTURE, 'return 1;')).skip, true);
    t('scanner app: the generated region markers themselves are skipped',
        [sc.lookup(lineOf(APP_FIXTURE, '>>> BEGIN')).skip, sc.lookup(lineOf(APP_FIXTURE, '<<< END')).skip], [true, true]);
    t('scanner app: the line after the region is not skipped', sc.lookup(lineOf(APP_FIXTURE, 'const formatThing')).skip, false);
    t('scanner app: a data table is a symbol and its rows belong to it', P('{ a: 2 },'), 'TABLE_SEED');
    t('scanner app: a top-level statement inside a banner takes the banner as its label',
        sc.lookup(lineOf(APP_FIXTURE, 'flagA')).region, 'section one');
    t('scanner app: and one after the END banner falls back to "<top-level>"', sc.lookup(lineOf(APP_FIXTURE, 'flagB')).region, '<top-level>');
    t('scanner app: a one-line arrow constant is a symbol', P('const formatThing'), 'formatThing');
    t('scanner app: JSX lines of a React.memo component belong to it', P('<path d="M0 0" />'), 'OneLogo');
    t('scanner app: a statement in the component body (outside any nested function) is the component', P("const [tab, setTab]"), D);
    t('scanner app: a multi-line useState initialiser is a symbol named after the state variable', P("return 'x';"), D + ' > draft');
    t('scanner app: a useCallback is a symbol named after the constant', P("setTab('b');"), D + ' > handleShowInTable');
    t('scanner app: a template literal line that looks like a declaration is NOT a symbol',
        P('const fake = () => {'), D + ' > handleShowInTable');
    t('scanner app: the template literal closing line stays in the function', P('}`;'), D + ' > handleShowInTable');
    t('scanner app: the statement after the template literal is still in the function', P('return msg;'), D + ' > handleShowInTable');
    t('scanner app: an anonymous effect is named after its dependency list', P('if (tab) return;'), D + ' > useEffect[tab]');
    t('scanner app: an effect with an empty list is "useEffect[]"', P('window.touched = 1;'), D + ' > useEffect[]');
    t('scanner app: after a regex literal containing a backtick the next symbol is still found', P('return 2;'), D + ' > handleOther');
    t('scanner app: a memo whose body has a sloppily dedented block is still one symbol', P('row.a = 1;'), D + ' > tableData');
    t('scanner app: a line INSIDE the sloppily dedented block belongs to the same symbol', P("row[key] = '';"), D + ' > tableData');
    t('scanner app: the statement after the sloppy block is still in the memo', P('return row;'), D + ' > tableData');
    t('scanner app: the component was NOT closed early by the sloppy block: the next hook is still inside it', P('return 3;'), D + ' > handleAfter');
    t('scanner app: JSX text with an apostrophe does not swallow the line', P("Don't panic"), D);
    t('scanner app: the JSX map callback is part of the component body', P('<Row key={i} />'), D);
    t('scanner app: the symbol after the component is top level again', P('return 4;'), 'mountApp');
    t('scanner app: no resync and no lexer drift (the braces in the template literal and JSX text balanced)', [sc.resyncs, sc.lexDrift], [0, 0]);
    t('scanner app: a file with no Babel script block has no code lines at all',
        lib.scanSource('<html><body>plain</body></html>', { kind: 'html' }).lookup(1).region, lib.OUTSIDE_SCRIPT);
}
{
    // Duplicate names under one parent stay distinct, so a path always names exactly one symbol.
    const src = ['function f() {', '    const g = () => {', '        return 1;', '    };', '    const g2 = () => {', '        return 2;', '    };', '}',
        'function dup() {', '    return 1;', '}', 'function dup() {', '    return 2;', '}', ''].join('\n');
    const sc = lib.scanSource(src, { kind: 'js' });
    t('scanner: two siblings with the same name get distinct paths', [pathAt(sc, src, 'return 1;', 2), pathAt(sc, src, 'return 2;', 2)], ['dup', 'dup #2']);
}
{
    // The block-comment and template state must survive a "/" that is not a comment (division, regex, JSX close).
    const src = ['const a = (x) => {', '    const r = x / 2 / 3;', '    const re = /a\\/b/g;', '    return <b>{r}</b>;', '};',
        'const b = () => {', '    return 1;', '};', ''].join('\n');
    const sc = lib.scanSource(src, { kind: 'js' });
    t('scanner: division, a regex with an escaped slash and a JSX close tag leave the next symbol intact',
        [pathAt(sc, src, 'return <b>'), pathAt(sc, src, 'return 1;')], ['a', 'b']);
    t('scanner: those slashes do not unbalance the brace count', sc.lexDrift, 0);
}

// ============================================================================================
// 2. The diff reader and the glob
// ============================================================================================
{
    const diff = [
        'diff --git a/f.js b/f.js', 'index 1..2 100644', '--- a/f.js', '+++ b/f.js',
        '@@ -3 +3 @@', '--- a deleted line that starts with dashes', '+++ an added line that starts with pluses',
        '@@ -10,0 +11,2 @@', '+x', '+y',
        '@@ -20,2 +21,0 @@', '-p', '-q', '\\ No newline at end of file',
        'diff --git a/g.gs b/g.gs', 'deleted file mode 100644', '--- a/g.gs', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-one', '-two', '',
    ].join('\n');
    t('diff: a deleted line that starts with "--" is a hunk body line, not a new file header, and counts default to 1',
        lib.parseDiffHunks(diff), [
            { file: 'f.js', oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 },
            { file: 'f.js', oldStart: 10, oldCount: 0, newStart: 11, newCount: 2 },
            { file: 'f.js', oldStart: 20, oldCount: 2, newStart: 21, newCount: 0 },
            { file: 'g.gs', oldStart: 1, oldCount: 2, newStart: 0, newCount: 0 },
        ]);
    t('glob: one star stays inside a path segment, two stars cross slashes, ? is one character',
        [['claude/' + '*', 'claude/x'], ['claude/' + '*', 'claude/x/y'], ['claude/' + '**', 'claude/x/y'], ['a?c', 'abc'], ['a.c', 'abc']]
            .map(([g, s]) => lib.globToRegExp(g).test(s)), [true, false, true, true, false]);
    t('paths: dist, the generated Shared.gs, vendored and minified files are skipped; ordinary code is not',
        ['dist/index.html', 'apps-script/Shared.gs', 'tests/vendor/x.js', 'a/b.min.js', 'apps-script/Code.gs', 'shared/10_x.js'].map(lib.isSkippedPath),
        [true, true, true, true, false, false]);
    t('file kinds: js and gs are code, html needs a look at its content, the rest is ignored',
        ['a.js', 'a.gs', 'a.html', 'a.md', 'a.csv', 'a.xlsx'].map(lib.fileKindFor), ['js', 'js', 'html', null, null, null]);
    t('app detection is by content (the Babel script tag), not by name',
        [lib.isAppHtmlText(APP_FIXTURE), lib.isAppHtmlText('<html><script>var x;</script></html>')], [true, false]);
}

// ============================================================================================
// 3. The compare rules on hand-built change sets
// ============================================================================================
{
    const mk = (entries) => new Map(entries.map(([file, p, removed, added]) => {
        const path_ = Array.isArray(p) ? p : [];
        return [lib.entryKey(file, path_, 'r'), { file, path: path_, region: path_.length ? null : (typeof p === 'string' ? p : 'r'), span: 100, removed, added }];
    }));
    const high = (a, b) => lib.compareChangeSets(a, b).high.map((h) => h.relation + ':' + h.symbol);
    const low = (a, b) => lib.compareChangeSets(a, b).low.map((l) => l.symbol);
    t('compare: the same innermost path is HIGH "same"',
        high(mk([['f.js', ['App', 'go'], 1, 1]]), mk([['f.js', ['App', 'go'], 2, 0]])), ['same:App > go']);
    t('compare: siblings under one top-level symbol are not HIGH; they are LOW on the top-level symbol',
        [high(mk([['f.js', ['App', 'a'], 1, 1]]), mk([['f.js', ['App', 'b'], 1, 1]])), low(mk([['f.js', ['App', 'a'], 1, 1]]), mk([['f.js', ['App', 'b'], 1, 1]]))],
        [[], ['App']]);
    t('compare: a function nested inside a function the other branch changed is HIGH "nested"',
        high(mk([['f.js', ['W', 'render'], 1, 1]]), mk([['f.js', ['W', 'render', 'helper'], 1, 1]])), ['nested:W > render > helper']);
    t('compare: a top-level symbol against its own member is only LOW (a line of the body says nothing about a handler)',
        [high(mk([['f.js', ['App'], 1, 1]]), mk([['f.js', ['App', 'h'], 1, 1]])).length, low(mk([['f.js', ['App'], 1, 1]]), mk([['f.js', ['App', 'h'], 1, 1]]))], [0, ['App']]);
    t('compare: the same path in different files is not an overlap',
        lib.compareChangeSets(mk([['a.js', ['f'], 1, 1]]), mk([['b.js', ['f'], 1, 1]])), { high: [], low: [] });
    t('compare: the same banner region in one file is LOW, never HIGH',
        [high(mk([['f.js', 'sec', 1, 1]]), mk([['f.js', 'sec', 1, 1]])), low(mk([['f.js', 'sec', 1, 1]]), mk([['f.js', 'sec', 1, 1]]))], [[], ['<sec>']]);
    t('compare: both sides\' line counts are carried through',
        lib.compareChangeSets(mk([['f.js', ['g'], 3, 4]]), mk([['f.js', ['g'], 5, 6]])).high[0].ref, { removed: 3, added: 4 });
}

// ============================================================================================
// 4. The CLI against real repositories
// ============================================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-overlap-check-'));
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME);
// Isolated git: nothing from the machine's git configuration, and none of the GIT_* variables that a hook or a
// worktree could have exported (GIT_DIR would silently redirect every command to the wrong repository).
const ENV = {};
for (const k of Object.keys(process.env)) if (!k.startsWith('GIT_')) ENV[k] = process.env[k];
Object.assign(ENV, {
    HOME, XDG_CONFIG_HOME: HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C',
    GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'author@example.invalid',
    GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'author@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z',
});
function git(cwd, ...args) {
    const r = cp.spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false'].concat(args), { cwd, env: ENV, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' (in ' + cwd + ') failed: ' + r.stderr);
    return r.stdout.trim();
}
function runCli(cwd, args) {
    const r = cp.spawnSync(process.execPath, [CLI].concat(args), { cwd, env: ENV, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
}
const runJson = (cwd, args) => {
    const r = runCli(cwd, args.concat('--json'));
    let json = null;
    try { json = JSON.parse(r.out); } catch (e) { json = { parseError: String(e), out: r.out, err: r.err }; }
    return { code: r.code, json, err: r.err };
};
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
function edit(dir, rel, from, to) {
    const text = read(dir, rel);
    if (text.indexOf(from) === -1) throw new Error('fixture edit: "' + from + '" not found in ' + rel);
    write(dir, rel, text.replace(from, to));
}

// One repository: a bare "remote" and a working clone with main pushed. branch() creates a branch from the
// current origin/main, applies `change`, commits and pushes it, then returns to main.
function makeRepo(name, files) {
    const root = path.join(TMP, name);
    const remote = path.join(root, 'remote.git');
    const work = path.join(root, 'work');
    fs.mkdirSync(root);
    git(root, 'init', '--bare', '-q', remote);
    git(root, 'clone', '-q', remote, work);
    for (const f of Object.keys(files)) write(work, f, files[f]);
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'base');
    git(work, 'branch', '-M', 'main');
    git(work, 'push', '-q', 'origin', 'main');
    return {
        root, remote, work,
        branch(bname, change, msg) {
            git(work, 'checkout', '-q', '-b', bname, 'origin/main');
            change(work);
            git(work, 'add', '-A');
            git(work, 'commit', '-q', '-m', msg || ('change on ' + bname));
            git(work, 'push', '-q', 'origin', bname);
            git(work, 'checkout', '-q', 'main');
        },
    };
}

const LIB_JS = [
    "'use strict';",
    'function alpha(x) {',
    '    const a1 = x + 1;',
    '    const a2 = a1 * 2;',
    '    const a3 = a2 - 3;',
    '    return a3;',
    '}',
    'function beta(x) {',
    '    const b1 = x + 10;',
    '    return b1;',
    '}',
    'function gamma(x) {',
    '    return x * 100;',
    '}',
    'class Widget {',
    '    render() {',
    '        return "r";',
    '    }',
    '    update(v) {',
    '        return v;',
    '    }',
    '}',
    'module.exports = { alpha, beta, gamma, Widget };',
    '',
].join('\n');
const SHARED_GS = 'function generated() {\n    return 1;\n}\n';
const DIST_HTML = '<script>function alpha() { return 1; }</script>\n';

// ---- S1: the core rules, branch by branch ------------------------------------------------------------
scenario('s1', () => {
    const R = makeRepo('s1', { 'lib.js': LIB_JS, 'notes.md': 'line one\nline two\n', 'data.csv': 'a,b\n1,2\n', 'apps-script/Shared.gs': SHARED_GS, 'dist/index.html': DIST_HTML });
    R.branch('a-alpha', (w) => edit(w, 'lib.js', 'const a1 = x + 1;', 'const a1 = x + 2;'));
    R.branch('b-alpha', (w) => edit(w, 'lib.js', 'const a3 = a2 - 3;', 'const a3 = a2 - 4;'));
    R.branch('c-beta', (w) => edit(w, 'lib.js', 'const b1 = x + 10;', 'const b1 = x + 11;'));
    R.branch('d-render', (w) => edit(w, 'lib.js', 'return "r";', 'return "rr";'));
    R.branch('e-update', (w) => edit(w, 'lib.js', 'return v;', 'return v + 1;'));
    for (const b of ['f-derived', 'g-derived']) {
        R.branch(b, (w) => {
            edit(w, 'notes.md', 'line two', 'line two changed by ' + b);
            edit(w, 'data.csv', '1,2', '1,3 ' + b);
            edit(w, 'apps-script/Shared.gs', 'return 1;', 'return 2; // ' + b);
            edit(w, 'dist/index.html', 'return 1;', 'return 2; // ' + b);
        });
    }
    // comment-only: adds comment lines inside alpha, changes no behaviour
    R.branch('h-comment', (w) => edit(w, 'lib.js', 'const a2 = a1 * 2;', '    // a note about a2, nothing more\n    // and a second note\n    const a2 = a1 * 2;'));
    git(R.work, 'checkout', '-q', 'a-alpha');
    const W = R.work;

    const a = runJson(W, ['--base', 'origin/main']);
    t('s1: the default ref is HEAD, shown by branch name', a.json.ref.name, 'a-alpha');
    const names = (j) => j.overlaps.map((o) => o.branch).sort();
    t('s1: two branches editing different lines of the SAME function are flagged: only b-alpha (and the comment-only branch is not)',
        names(a.json), ['origin/b-alpha']);
    const ba = a.json.overlaps[0];
    t('s1: the overlap is HIGH, names the file and the function, and carries both sides\' line counts',
        ba.high.map((h) => [h.file, h.symbol, h.relation, h.ref, h.other]),
        [['lib.js', 'alpha', 'same', { removed: 1, added: 1 }, { removed: 1, added: 1 }]]);
    t('s1: a different function in the same file (c-beta) is NOT flagged', names(a.json).includes('origin/c-beta'), false);
    t('s1: a comment-only change in the same function is not flagged', names(a.json).includes('origin/h-comment'), false);
    t('s1: the ref\'s own remote-tracking branch (same tip) is skipped, not compared with itself',
        a.json.skipped.some((s) => s.name === 'origin/a-alpha' && /same tip/.test(s.reason)), true);
    t('s1: branches that changed only non-code or derived files are skipped as "no changes to code files"',
        ['origin/f-derived', 'origin/g-derived'].map((n) => (a.json.skipped.find((s) => s.name === n) || {}).reason), ['no changes to code files', 'no changes to code files']);
    t('s1: the base branch itself is never a candidate', a.json.skipped.concat(a.json.overlaps).some((x) => (x.name || x.branch) === 'origin/main'), false);

    const c = runJson(W, ['--base', 'origin/main', '--ref', 'c-beta']);
    t('s1: --ref picks another branch; beta against alpha edits: no overlap at all', [c.json.overlaps, c.json.totals.high], [[], 0]);

    const d = runJson(W, ['--base', 'origin/main', '--ref', 'd-render']);
    t('s1: two methods of one class: not HIGH (nested-function precision)', d.json.overlaps.map((o) => [o.branch, o.high.length]), [['origin/e-update', 0]]);
    t('s1: ...but LOW, on the class they share', d.json.overlaps[0].low.map((l) => [l.file, l.symbol, l.ref, l.other]), [['lib.js', 'Widget', { removed: 1, added: 1 }, { removed: 1, added: 1 }]]);
    const dv = runCli(W, ['--base', 'origin/main', '--ref', 'd-render']);
    t('s1: the default (human) view hides LOW branches but says how many there are', [/OVERLAP/.test(dv.out), /1 more branches share only a top-level symbol/.test(dv.out)], [false, true]);
    const dvv = runCli(W, ['--base', 'origin/main', '--ref', 'd-render', '--verbose']);
    t('s1: --verbose shows the LOW match and why branches were skipped', [/LOW  lib\.js :: Widget/.test(dvv.out), /skipped:/.test(dvv.out)], [true, true]);

    const f = runJson(W, ['--base', 'origin/main', '--ref', 'f-derived']);
    t('s1: a branch that changed only markdown, csv, Shared.gs and dist has nothing to compare (all ignored)',
        [f.json.ref.changedSymbols, f.json.overlaps, typeof f.json.note], [0, [], 'string']);

    const h = runCli(W, ['--base', 'origin/main']);
    t('s1: the human output groups by branch, names the file and symbol, and ends with a RESULT line',
        [/OVERLAP origin\/b-alpha .*HIGH 1/.test(h.out), /HIGH lib\.js :: alpha/.test(h.out), /RESULT: 1 branch changed the same function/.test(h.out)], [true, true, true]);

    // --against narrows the candidates
    const ag = runJson(W, ['--base', 'origin/main', '--against', 'c-*']);
    t('s1: --against limits the branches compared to the glob', [ag.json.compared, ag.json.overlaps], [1, []]);
    const ag2 = runJson(W, ['--base', 'origin/main', '--against', 'b-' + '**']);
    t('s1: --against with a two-star glob matches the nested names too', ag2.json.overlaps.map((o) => o.branch), ['origin/b-alpha']);

    // --fail-on-overlap
    const fo = runCli(W, ['--base', 'origin/main', '--fail-on-overlap']);
    t('s1: --fail-on-overlap exits 1 when there is a HIGH overlap', fo.code, 1);
    t('s1: without the flag the same run exits 0', runCli(W, ['--base', 'origin/main']).code, 0);
    const lowOnly = runCli(W, ['--base', 'origin/main', '--ref', 'd-render', '--fail-on-overlap']);
    t('s1: --fail-on-overlap does not fail on a LOW-only overlap', lowOnly.code, 0);
    t('s1: --fail-on-overlap exits 0 when nothing overlaps', runCli(W, ['--base', 'origin/main', '--ref', 'c-beta', '--fail-on-overlap']).code, 0);
    t('s1: an unknown option is a usage error (exit 2) with a message', [runCli(W, ['--bogus']).code, /unknown argument/.test(runCli(W, ['--bogus']).err)], [2, true]);
    t('s1: an unknown ref is exit 2, not a stack trace', [runCli(W, ['--ref', 'no-such-branch']).code, /cannot resolve/.test(runCli(W, ['--ref', 'no-such-branch']).err)], [2, true]);

    // --json contract
    const j = runCli(W, ['--base', 'origin/main', '--json']);
    const jo = JSON.parse(j.out);
    t('json: stdout is exactly one JSON object and the logs are not on it', [Array.isArray(jo), typeof jo, j.out.trim().startsWith('{'), j.out.trim().endsWith('}')], [false, 'object', true, true]);
    t('json: the top-level keys are the documented ones',
        Object.keys(jo).sort(), ['base', 'compared', 'overlaps', 'ref', 'seconds', 'skipped', 'totals', 'warnings']);
    t('json: ref, base and totals have the documented shape',
        [Object.keys(jo.ref).sort(), Object.keys(jo.base).sort(), Object.keys(jo.totals).sort()],
        [['changedLines', 'changedSymbols', 'files', 'mergeBase', 'name', 'sha'], ['name', 'sha'], ['branchesWithHigh', 'branchesWithLow', 'high', 'low']]);
    t('json: an overlap has branch, sha, shortSha, date, subject, high and low',
        Object.keys(jo.overlaps[0]).sort(), ['branch', 'date', 'high', 'low', 'sha', 'shortSha', 'subject']);
    t('json: a HIGH row has file, symbol, relation, span and both sides\' counts',
        Object.keys(jo.overlaps[0].high[0]).sort(), ['file', 'other', 'ref', 'relation', 'span', 'symbol']);
    t('json: the overlap carries the last commit\'s date and subject', [jo.overlaps[0].date, jo.overlaps[0].subject], ['2026-01-02', 'change on b-alpha']);
    t('json: no warnings on well-formed code', jo.warnings, []);
    t('json: --json keeps the human report off stdout (it is on stderr only if at all)', /OVERLAP /.test(j.out), false);

    // --max-branches caps the default view
    const R2 = makeRepo('s1b', { 'lib.js': LIB_JS });
    for (const n of ['x1', 'x2', 'x3']) R2.branch(n, (w) => edit(w, 'lib.js', 'const a2 = a1 * 2;', 'const a2 = a1 * 2 + ' + n.slice(1) + ';'));
    git(R2.work, 'checkout', '-q', 'x1');
    const cap = runCli(R2.work, ['--base', 'origin/main', '--max-branches', '1']);
    t('cap: --max-branches 1 prints one branch and a "... and N more" line',
        [(cap.out.match(/^OVERLAP /gm) || []).length, /\.\.\. and 1 more branches with HIGH overlap/.test(cap.out)], [1, true]);
    const capAll = runCli(R2.work, ['--base', 'origin/main', '--max-branches', '1', '--verbose']);
    t('cap: --verbose shows every branch regardless of the cap', (capAll.out.match(/^OVERLAP /gm) || []).length, 2);
});

// ---- S2: line-number independence ---------------------------------------------------------------------
scenario('s2', () => {
    const R = makeRepo('s2', { 'lib.js': LIB_JS });
    const filler = Array.from({ length: 200 }, (_, i) => '    var filler' + i + ' = ' + i + ';').join('\n');
    R.branch('shift', (w) => {
        // 200 new lines ABOVE alpha, plus a pure addition inside beta: its line numbers in this branch are 200 off
        edit(w, 'lib.js', "'use strict';", "'use strict';\nfunction filler() {\n" + filler + '\n}');
        edit(w, 'lib.js', 'return b1;', 'const b2 = b1 + 1;\n    return b1 + b2;');
    });
    R.branch('edit-beta', (w) => edit(w, 'lib.js', 'const b1 = x + 10;', 'const b1 = x + 12;'));
    R.branch('edit-gamma', (w) => edit(w, 'lib.js', 'return x * 100;', 'return x * 101;'));
    const s = runJson(R.work, ['--base', 'origin/main', '--ref', 'shift']);
    t('s2: 200 inserted lines above do not matter: the other branch\'s edit of beta is matched to beta',
        s.json.overlaps.map((o) => [o.branch, o.high.map((h) => h.symbol)]), [['origin/edit-beta', ['beta']]]);
    t('s2: the inserted function and the pure addition inside beta are mapped through the BRANCH version',
        s.json.ref.changedSymbols, 2);
    t('s2: and the unrelated edit of gamma is not flagged', s.json.overlaps.some((o) => o.branch === 'origin/edit-gamma'), false);
    const back = runJson(R.work, ['--base', 'origin/main', '--ref', 'edit-beta']);
    t('s2: symmetric: from the other side the same overlap is found', back.json.overlaps.map((o) => [o.branch, o.high.map((h) => h.symbol)]), [['origin/shift', ['beta']]]);
});

// ---- S3: deletion-only changes --------------------------------------------------------------------------
scenario('s3', () => {
    const R = makeRepo('s3', { 'lib.js': LIB_JS });
    R.branch('del-line', (w) => edit(w, 'lib.js', '    const a2 = a1 * 2;\n', ''));
    R.branch('edit-alpha', (w) => edit(w, 'lib.js', 'return a3;', 'return a3 + 1;'));
    R.branch('del-gamma', (w) => edit(w, 'lib.js', 'function gamma(x) {\n    return x * 100;\n}\n', ''));
    R.branch('edit-gamma', (w) => edit(w, 'lib.js', 'return x * 100;', 'return x * 7;'));
    const a = runJson(R.work, ['--base', 'origin/main', '--ref', 'del-line']);
    t('s3: a pure deletion (no added line at all) is mapped through the merge-base and meets the other edit of alpha',
        a.json.overlaps.map((o) => [o.branch, o.high.map((h) => [h.symbol, h.ref, h.other])]), [['origin/edit-alpha', [['alpha', { removed: 1, added: 0 }, { removed: 1, added: 1 }]]]]);
    const g = runJson(R.work, ['--base', 'origin/main', '--ref', 'del-gamma']);
    t('s3: deleting a whole function overlaps with an edit of that function (the function no longer exists on this side)',
        g.json.overlaps.map((o) => [o.branch, o.high.map((h) => h.symbol)]), [['origin/edit-gamma', ['gamma']]]);
});

// ---- S4: the app-shaped file: generated region, nested symbols, template literal, sloppy block -----------
scenario('s4', () => {
    const APP = 'app-build.html'; // deliberately not an app file name: app builds are recognised by content
    const R = makeRepo('s4', { [APP]: APP_FIXTURE, 'README.md': 'x\n' });
    const e = (from, to) => (w) => edit(w, APP, from, to);
    R.branch('gen-a', e('            return 1;\n          }\n          return { inGenerated', '            return 11;\n          }\n          return { inGenerated'));
    R.branch('gen-b', e('            return 1;\n          }\n          return { inGenerated', '            return 12;\n          }\n          return { inGenerated'));
    R.branch('gen-c', (w) => {
        edit(w, APP, '            return 1;\n          }\n          return { inGenerated', '            return 13;\n          }\n          return { inGenerated');
        edit(w, APP, "setTab('b');", "setTab('c');");
    });
    R.branch('gen-d', (w) => {
        edit(w, APP, '            return 1;\n          }\n          return { inGenerated', '            return 14;\n          }\n          return { inGenerated');
        edit(w, APP, 'return msg;', 'return msg + "!";');
    });
    R.branch('app-fake', e('const fake = () => {', 'const fake = () => { // edited'));       // a line inside the template literal
    R.branch('app-other', e('                return 2;', '                return 22;'));          // handleOther
    R.branch('app-effect', e('if (tab) return;', 'if (!tab) return;'));                          // the effect on [tab]
    R.branch('app-effect-add', e('if (tab) return;', 'if (tab) return;\n                window.added = 1;')); // a pure addition inside it
    R.branch('app-sloppy', e("row[key] = '';", "row[key] = null;"));                            // inside the dedented block
    R.branch('app-sloppy-2', e('return row;', 'return Object.freeze(row);'));                    // after it
    R.branch('app-css', e('color: red;', 'color: blue;'));                                       // outside the script
    R.branch('app-css-2', e('color: red;', 'color: green;'));
    R.branch('app-body', e("const [tab, setTab] = useState('a');", "const [tab, setTab] = useState('z');"));
    R.branch('app-after', e('return 3;', 'return 33;'));                                         // handleAfter, after the sloppy block
    R.branch('app-after-2', e('return 3;', 'return 34;'));
    const W = R.work;
    const hs = (ref) => runJson(W, ['--base', 'origin/main', '--ref', ref]).json;
    const sym = (j, b) => (j.overlaps.find((o) => o.branch === b) || { high: [] }).high.map((h) => h.symbol);

    const ga = hs('gen-a');
    t('s4: a branch that only edits the generated shared-logic region has no symbols at all', [ga.ref.changedSymbols, ga.overlaps, typeof ga.note], [0, [], 'string']);
    const gc = hs('gen-c');
    t('s4: two branches that both edit the generated region AND one real function overlap only on the real function (never on the region)',
        gc.overlaps.filter((o) => o.high.length).map((o) => [o.branch, o.high.map((h) => h.symbol), o.low.length]),
        [['origin/app-fake', ['FlashReportDashboard > handleShowInTable'], 0], ['origin/gen-d', ['FlashReportDashboard > handleShowInTable'], 0]]);
    t('s4: the region edit itself never shows up as a changed symbol', gc.ref.changedSymbols, 1);

    t('s4: a line edited inside a template literal belongs to the enclosing function and meets an edit of that function',
        sym(hs('app-fake'), 'origin/gen-c'), ['FlashReportDashboard > handleShowInTable']);
    const ao = hs('app-other');
    t('s4: two handlers of the same huge component are not HIGH; the component is the LOW match',
        ao.overlaps.map((o) => [o.branch, o.high.length, o.low.map((l) => l.symbol)]).filter((x) => x[0] === 'origin/app-effect'), [['origin/app-effect', 0, ['FlashReportDashboard']]]);
    t('s4: an edit and a pure addition inside the same anonymous effect meet on the effect\'s dependency-list name',
        sym(hs('app-effect'), 'origin/app-effect-add'), ['FlashReportDashboard > useEffect[tab]']);
    t('s4: an edit inside the sloppily dedented block and one after it are the same function (the component was not closed early)',
        sym(hs('app-sloppy'), 'origin/app-sloppy-2'), ['FlashReportDashboard > tableData']);
    t('s4: edits to the same handler declared after the sloppy block still match by name',
        sym(hs('app-after'), 'origin/app-after-2'), ['FlashReportDashboard > handleAfter']);
    const css = hs('app-css');
    t('s4: markup outside the script is labelled as such and is LOW, never HIGH',
        css.overlaps.filter((o) => o.branch === 'origin/app-css-2').map((o) => [o.high.length, o.low.map((l) => l.symbol)]), [[0, ['<' + lib.OUTSIDE_SCRIPT + '>']]]);
    const ab = hs('app-body');
    t('s4: an edit made directly in the component body (no nested function) is the component itself: only LOW against branches that edited its handlers',
        [ab.overlaps.length > 0, ab.totals.high, [...new Set(ab.overlaps.flatMap((o) => o.low.map((l) => l.symbol)))]], [true, 0, ['FlashReportDashboard']]);
    t('s4: a README or other non-code file next to the app is ignored', hs('app-fake').ref.files, [APP]);
});

// ---- S5: a branch already merged into the base is skipped ---------------------------------------------------
scenario('s5', () => {
    const R = makeRepo('s5', { 'lib.js': LIB_JS });
    R.branch('mine', (w) => edit(w, 'lib.js', 'const a1 = x + 1;', 'const a1 = x + 5;'));
    R.branch('landed', (w) => edit(w, 'lib.js', 'const a3 = a2 - 3;', 'const a3 = a2 - 9;'));
    R.branch('open', (w) => edit(w, 'lib.js', 'const a2 = a1 * 2;', 'const a2 = a1 * 3;'));
    git(R.work, 'merge', '-q', '--no-ff', '-m', 'merge landed', 'origin/landed');
    git(R.work, 'push', '-q', 'origin', 'main');
    git(R.work, 'fetch', '-q', 'origin');
    git(R.work, 'checkout', '-q', 'mine');
    const j = runJson(R.work, ['--base', 'origin/main']);
    t('s5: a branch already merged into the base is skipped and says why', (j.json.skipped.find((s) => s.name === 'origin/landed') || {}).reason, 'merged into the base');
    t('s5: it is not reported as an overlap even though it edited the same function', j.json.overlaps.map((o) => o.branch), ['origin/open']);
});

// ---- S6: pull-request numbers through refs/pull/N/head -------------------------------------------------------
scenario('s6', () => {
    const R = makeRepo('s6', { 'lib.js': LIB_JS });
    R.branch('pr-seven', (w) => edit(w, 'lib.js', 'const a1 = x + 1;', 'const a1 = x + 7;'));
    R.branch('rival', (w) => edit(w, 'lib.js', 'const a3 = a2 - 3;', 'const a3 = a2 - 8;'));
    const sha = git(R.work, 'rev-parse', 'pr-seven');
    git(R.work, 'push', '-q', 'origin', 'pr-seven:refs/pull/7/head');
    git(R.work, 'push', '-q', 'origin', ':pr-seven');
    // a second clone that has never heard of the pull request ref: it must be fetched on demand
    const other = path.join(R.root, 'other');
    git(R.root, 'clone', '-q', R.remote, other);
    const before = git(other, 'for-each-ref', '--format=%(refname)').split('\n').sort();
    const j = runJson(other, ['--base', 'origin/main', '--ref', '7']);
    t('s6: --ref 7 resolves through refs/pull/7/head to the pull request\'s commit', [j.json.ref.name, j.json.ref.sha], ['#7', sha]);
    t('s6: and finds the overlap with the other open branch', j.json.overlaps.map((o) => [o.branch, o.high.map((h) => h.symbol)]), [['origin/rival', ['alpha']]]);
    t('s6: the "#7" spelling works too', runJson(other, ['--base', 'origin/main', '--ref', '#7']).json.ref.sha, sha);
    t('s6: fetching the pull request creates no local or tracking ref', git(other, 'for-each-ref', '--format=%(refname)').split('\n').sort(), before);
    const bad = runCli(other, ['--base', 'origin/main', '--ref', '999']);
    t('s6: a pull request that does not exist is exit 2 with the reason', [bad.code, /cannot fetch refs\/pull\/999\/head/.test(bad.err)], [2, true]);
});

// ============================================================================================
// 5. The real app builds in this checkout (found by content, never by name)
// ============================================================================================
{
    const builds = fs.readdirSync(REPO_ROOT).filter((f) => /\.html$/.test(f))
        .map((f) => ({ f, text: fs.readFileSync(path.join(REPO_ROOT, f), 'utf8') }))
        .filter((b) => lib.isAppHtmlText(b.text));
    t('real: at least one app build is found by its Babel script tag', builds.length >= 1, true);
    let checked = 0;
    for (const b of builds) {
        const sc = lib.scanSource(b.text, { kind: 'html' });
        const topFns = sc.frames.filter((f) => !f.parent && (f.kind === 'function' || f.kind === 'class'));
        const badEnds = topFns.filter((f) => f.end > f.start && !/^[}\])]|;\s*$/.test(b.text.split('\n')[f.end].trim()));
        // every multi-line top-level function or class must end on a closing bracket line or at a statement end: if
        // the scanner lost its place (a lexer drift, a mis-read dedent) the extent ends somewhere arbitrary
        t('real: a build: no top-level function or class ends anywhere but a closing bracket or a statement end', badEnds.map((f) => f.name + '@' + (f.start + 1)), []);
        t('real: a build: no lexer drift and no resync', [sc.lexDrift, sc.resyncs], [0, 0]);
        t('real: a build: the scan finds symbols in proportion to its size (at least one per 100 lines)', sc.symbolCount * 100 >= sc.lineCount, true);
        t('real: a build: every symbol extent is ordered', sc.frames.filter((f) => f.end < f.start).length, 0);
        if (/function FlashReportDashboard\s*\(/.test(b.text) && sc.lineCount > 8000) { // the large builds only: older small ones have a small component
            const big = sc.frames.find((f) => f.name === 'FlashReportDashboard');
            t('real: a build: the big component is one top-level symbol of well over a thousand lines', !!big && !big.parent && big.end - big.start > 1000, true);
            const kids = sc.frames.filter((f) => f.parent === big).length;
            t('real: a build: the component\'s hooks and handlers are found as its children (over 100)', kids > 100, true);
            if (b.text.indexOf('>>> BEGIN GENERATED SHARED LOGIC') !== -1) {
                t('real: a build: the scanner does not report lines of the generated region',
                    sc.lookup(lineOf(b.text, '>>> BEGIN GENERATED SHARED LOGIC') + 3).skip, true);
            }
        }
        checked++;
    }
    t('real: every app build was scanned', checked, builds.length);
}

// ============================================================================================
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { process.stderr.write('(could not remove ' + TMP + ')\n'); }
if (failures.length) {
    console.error('PR_OVERLAP_CHECK_FAILED (' + failures.length + ' failed, ' + pass + ' passed)');
    for (const f of failures) console.error('  FAIL: ' + f);
    process.exit(1);
}
console.log('PR_OVERLAP_CHECK_PASSED (' + pass + ' assertions)');

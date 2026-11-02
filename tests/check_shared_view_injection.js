/**
 * Headless check for doGet's shared-view injection in apps-script/Code.gs (roadmap slice 4.2):
 * injectSharedView_(html, view) and sharedViewParam_(e), and doGet's call to them.
 *
 * WHAT IT PROVES. When ?view= is a link BFShared.decodeView accepts, the served page gets
 * `<script>window.__SHARED_VIEW__="<the original link text>";</script>` before the babel block, and
 * evaluating that script gives back EXACTLY the original string. In every other case (no parameter,
 * a malformed, damaged, tampered, over-long or wrongly typed one, a repeated parameter, a page without
 * the babel marker, a missing Shared.gs, a decoder that throws) the page is returned BYTE FOR BYTE
 * unchanged and nothing throws. It does NOT prove that Google serves ?view= to doGet, that it survives
 * the sign-in redirect, or that the page receives the global: that is the production checklist in
 * apps-script/README.md. Nothing in the app reads __SHARED_VIEW__ yet (slice 4.3).
 *
 * HOW IT STAYS HONEST.
 *  - It runs the REAL Code.gs and the REAL Shared.gs in one vm context (Code.gs FIRST, because Apps
 *    Script's file order is not guaranteed and a top-level use of BFShared in Code.gs would break then;
 *    the reverse order is run too).
 *  - The expected page for "nothing injected" is a hand-written literal, not computed by the code.
 *  - Links are forged by this file's own CRC-24 and base64url (self-tested against the published
 *    check value), not taken from the code under test.
 *  - A well-formed link holds only [A-Za-z0-9._-], so the gate alone makes every hostile string
 *    harmless. To prove the ESCAPING on its own, the escaper is also run with the decoder swapped for
 *    one that accepts anything, against strings full of </script>, <!--, quotes, backslashes, U+2028
 *    and the rest. Those pages are read back with a small HTML tokenizer written here from the HTML
 *    standard's script-data states (see scriptBodies), then each script body is evaluated in a fresh
 *    vm sandbox. The tokenizer was also compared once, by hand, with a real Chromium (it agreed on 19 of 19
 *    tricky unescaped texts, and Chromium read all 21 real injected pages back exactly); CI does not rerun that.
 *
 * Run:  node tests/check_shared_view_injection.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const CODE_GS = read('apps-script', 'Code.gs');
const SHARED_GS = read('apps-script', 'Shared.gs');

let pass = 0;
const failures = [];
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else failures.push(`${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

// ---------------------------------------------------------------------------
// The page and the fakes. doGet only needs these services to reach the HTML branch.
// ---------------------------------------------------------------------------
const MARKER = '<script type="text/babel">';
const TEMPLATE = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div>\n    ' + MARKER + 'const app = 1;</script></body></html>';
const EXEC_URL = 'https://script.google.com/exec';
// What doGet served before this change, for the fakes below (no visitor identity). Written by hand:
// the three tags in order, each followed by a newline and four spaces, then the babel block.
const BASELINE_PAGE = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div>\n    ' +
  '<script>window.__EXEC_URL__="' + EXEC_URL + '";</script>\n    ' +
  '<script>window.__SERVER_PREFS__={"available":false,"reason":"no-user-identity"};</script>\n    ' +
  '<script>window.__SERVER_EXTRAS__={"filterPrefs":{"available":false,"reason":"no-user-identity","value":null}};</script>\n    ' +
  MARKER + 'const app = 1;</script></body></html>';

// order: 'code-first' loads Code.gs then Shared.gs, 'shared-first' the reverse; 'no-shared' omits Shared.gs.
function load({ order = 'code-first', template = TEMPLATE } = {}) {
  const ctx = vm.createContext({
    ScriptApp: { getService: () => ({ getUrl: () => EXEC_URL }) },
    HtmlService: {
      createHtmlOutputFromFile: () => ({ getContent: () => template }),
      createHtmlOutput: (html) => { const o = { html, setTitle() { return o; }, addMetaTag() { return o; } }; return o; },
    },
    ContentService: { createTextOutput: (text) => ({ text, setMimeType() { return this; } }), MimeType: { JSON: 'JSON', TEXT: 'TEXT', CSV: 'CSV' } },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  });
  if (order === 'shared-first') { vm.runInContext(SHARED_GS, ctx); vm.runInContext(CODE_GS, ctx); }
  else if (order === 'code-first') { vm.runInContext(CODE_GS, ctx); vm.runInContext(SHARED_GS, ctx); }
  else vm.runInContext(CODE_GS, ctx);
  return {
    ctx,
    inject: (html, view) => vm.runInContext('injectSharedView_', ctx)(html, view),
    param: (e) => vm.runInContext('sharedViewParam_', ctx)(e),
    doGet: (e) => vm.runInContext('doGet', ctx)(e).html,
    maxChars: vm.runInContext('SHARED_VIEW_MAX_CHARS_', ctx),
    // Swap the decoder on the BFShared object. Returns a call counter. (Assigned from the host side: the
    // shared-sync check E refuses the text "NAME = function" for any name shared/ exports, even in a string.)
    setDecoder: (fn) => { const calls = { n: 0 }; vm.runInContext('BFShared', ctx).decodeView = (text) => { calls.n++; return fn(text); }; return calls; },
  };
}
const OK_DECODE = () => ({ state: {}, applied: [], dropped: [], errors: [] });

// ---------------------------------------------------------------------------
// Independent tools: CRC-24 (OpenPGP) and base64url, to forge links without the code under test.
// ---------------------------------------------------------------------------
function crc24(text) {
  let crc = 0xB704CE;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 16;
    for (let j = 0; j < 8; j++) { crc <<= 1; if (crc & 0x1000000) crc ^= 0x1864CFB; }
  }
  return crc & 0xFFFFFF;
}
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function forge(json) {
  const payload = b64url(Buffer.from(json, 'utf8'));
  const c = crc24(payload);
  return 'v1.' + payload + '.' + b64url([(c >> 16) & 255, (c >> 8) & 255, c & 255]);
}
// A forged link of exactly `len` characters: 'v1.' + payload + '.' + 4-character check, so the payload is
// len - 8 characters of unpadded base64url, which is 4n/3 rounded up for n bytes of JSON. Only some lengths
// exist (3992, 3994, 3995 ... for 4,000-ish); the helper refuses a length no payload can make.
function forgeLength(len) {
  for (let n = 1; n < 20000; n++) {
    if (Math.ceil(n * 4 / 3) !== len - 8) continue;
    const fill = n - '{"yardSearchText":""}'.length;
    if (fill < 0) continue;
    const link = forge('{"yardSearchText":"' + 'x'.repeat(fill) + '"}');
    if (link.length === len) return link;
  }
  throw new Error('no link of length ' + len + ' can be forged');
}
t('self-test: the forger\'s CRC-24 gives the published check value for "123456789" (0x21CF02)', crc24('123456789'), 0x21CF02);

// ---------------------------------------------------------------------------
// An independent reader for script elements, written from the HTML standard's tokenizer states
// (13.2.5.4 and the script data escaped / double-escaped families). Returns what a browser would take
// as the body of each <script> element in `html`, plus the text after the last one.
// ---------------------------------------------------------------------------
function scriptEnd(html, start) {
  // Returns {bodyEnd, afterEnd} for the script data that begins at `start`, or null when it never ends.
  const WS = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
  const ALPHA = (c) => /^[A-Za-z]$/.test(c);
  let st = 'data', i = start, buf = '', tag = '', tagStart = -1;
  while (i <= html.length) {
    const c = i < html.length ? html[i] : '';
    switch (st) {
      case 'data':
        if (c === '<') { st = 'data-lt'; tagStart = i; } i++; break;
      case 'data-lt':
        if (c === '/') { st = 'data-end-open'; i++; } else if (c === '!') { st = 'esc-start'; i++; } else { st = 'data'; } break;
      case 'data-end-open':
        if (ALPHA(c)) { st = 'data-end-name'; tag = ''; } else { st = 'data'; } break;
      case 'data-end-name':
        if ((WS(c) || c === '/' || c === '>') && tag.toLowerCase() === 'script') {
          const gt = html.indexOf('>', i);
          return { bodyEnd: tagStart, afterEnd: gt < 0 ? html.length : gt + 1 };
        }
        if (ALPHA(c)) { tag += c; i++; } else { st = 'data'; } break;
      case 'esc-start':
        if (c === '-') { st = 'esc-start-dash'; i++; } else { st = 'data'; } break;
      case 'esc-start-dash':
        if (c === '-') { st = 'esc-dash-dash'; i++; } else { st = 'data'; } break;
      case 'esc':
        if (c === '-') { st = 'esc-dash'; } else if (c === '<') { st = 'esc-lt'; tagStart = i; } i++; break;
      case 'esc-dash':
        if (c === '-') { st = 'esc-dash-dash'; i++; } else if (c === '<') { st = 'esc-lt'; tagStart = i; i++; } else { st = 'esc'; i++; } break;
      case 'esc-dash-dash':
        if (c === '-') { i++; } else if (c === '<') { st = 'esc-lt'; tagStart = i; i++; } else if (c === '>') { st = 'data'; i++; } else { st = 'esc'; i++; } break;
      case 'esc-lt':
        if (c === '/') { st = 'esc-end-open'; buf = ''; i++; } else if (ALPHA(c)) { st = 'dbl-start'; buf = ''; } else { st = 'esc'; } break;
      case 'esc-end-open':
        if (ALPHA(c)) { st = 'esc-end-name'; tag = ''; } else { st = 'esc'; } break;
      case 'esc-end-name':
        if ((WS(c) || c === '/' || c === '>') && tag.toLowerCase() === 'script') {
          const gt = html.indexOf('>', i);
          return { bodyEnd: tagStart, afterEnd: gt < 0 ? html.length : gt + 1 };
        }
        if (ALPHA(c)) { tag += c; i++; } else { st = 'esc'; } break;
      case 'dbl-start':
        if (WS(c) || c === '/' || c === '>') { st = buf === 'script' ? 'dbl' : 'esc'; i++; }
        else if (ALPHA(c)) { buf += c.toLowerCase(); i++; } else { st = 'esc'; } break;
      case 'dbl':
        if (c === '-') { st = 'dbl-dash'; } else if (c === '<') { st = 'dbl-lt'; } i++; break;
      case 'dbl-dash':
        if (c === '-') { st = 'dbl-dash-dash'; i++; } else if (c === '<') { st = 'dbl-lt'; i++; } else { st = 'dbl'; i++; } break;
      case 'dbl-dash-dash':
        if (c === '-') { i++; } else if (c === '<') { st = 'dbl-lt'; i++; } else if (c === '>') { st = 'data'; i++; } else { st = 'dbl'; i++; } break;
      case 'dbl-lt':
        if (c === '/') { st = 'dbl-end'; buf = ''; i++; } else { st = 'dbl'; } break;
      case 'dbl-end':
        if (WS(c) || c === '/' || c === '>') { st = buf === 'script' ? 'esc' : 'dbl'; i++; }
        else if (ALPHA(c)) { buf += c.toLowerCase(); i++; } else { st = 'dbl'; } break;
      default: throw new Error('tokenizer state ' + st);
    }
  }
  return null;
}
function scriptBodies(html) {
  const bodies = [];
  let pos = 0;
  for (;;) {
    const m = /<script(?=[\s/>])/i.exec(html.slice(pos));
    if (!m) break;
    const open = pos + m.index;
    const gt = html.indexOf('>', open);
    if (gt < 0) break;
    const end = scriptEnd(html, gt + 1);
    if (!end) { bodies.push({ body: html.slice(gt + 1), unterminated: true }); pos = html.length; break; }
    bodies.push({ body: html.slice(gt + 1, end.bodyEnd) });
    pos = end.afterEnd;
  }
  return { bodies, rest: html.slice(pos) };
}
// Sanity of the tokenizer itself, on cases whose answer the standard states plainly.
{
  const bodyOf = (h) => scriptBodies(h).bodies.map((b) => b.body);
  t('tokenizer: a plain script ends at its close tag', bodyOf('<script>a</script>b'), ['a']);
  t('tokenizer: a close tag in capitals ends it too', bodyOf('<script>a</SCRIPT>b'), ['a']);
  t('tokenizer: "</script" followed by a space or slash ends it', [bodyOf('<script>a</script >b'), bodyOf('<script>a</script/>b')], [['a'], ['a']]);
  t('tokenizer: "</scriptx" does not end it', bodyOf('<script>a</scriptx>b</script>'), ['a</scriptx>b']);
  t('tokenizer: "<!--<script>" makes the next close tag part of the body (double escaped state)', bodyOf('<script><!--<script>x</script>y</script>z'), ['<!--<script>x</script>y']);
  t('tokenizer: "-->" leaves the double escaped state', bodyOf('<script><!--<script>x--></script>z'), ['<!--<script>x-->']);
  t('tokenizer: "<!--" alone leaves the next close tag effective', bodyOf('<script><!-- x</script>z'), ['<!-- x']);
}

// ---------------------------------------------------------------------------
// Valid links and the page that should come back for them.
// ---------------------------------------------------------------------------
const env = load();
const cleanTag = (link) => '<script>window.__SHARED_VIEW__="' + link + '";</script>\n    '; // a link has no character JSON would escape
const withTag = (link) => TEMPLATE.slice(0, TEMPLATE.indexOf(MARKER)) + cleanTag(link) + TEMPLATE.slice(TEMPLATE.indexOf(MARKER));
const BF = (src) => vm.runInContext(src, env.ctx);
const encode = (state) => { env.ctx.__state = state; return BF('BFShared.encodeView(__state)'); };

const LINK_A = encode({ selectedLanes: ['EC1', 'AN2'], tab: 'detail' });
const LINK_B = encode({ yardSearchText: 'Zürich <b>"x"</b> \\ \u2028 \u2029 </script><!--', headerFilters: { vvd: "O'Brien", saleWeek: '</script>' } });
const LINK_C = encode({ selectedYards: Array.from({ length: 105 }, (_, i) => 'YARD-' + i + '-' + 'x'.repeat(14)) }); // a long one, still under the codec's 4,000
t('fixtures: the three valid links exist (the real encoder wrote them)', [typeof LINK_A, typeof LINK_B, typeof LINK_C], ['string', 'string', 'string']);
t('fixtures: LINK_A matches an independent forge of the same view (so the forger agrees with the encoder)', forge('{"selectedLanes":["EC1","AN2"],"tab":"detail"}'), LINK_A);
t('fixtures: LINK_C is long but under the codec limit, so it tests a big accepted link', [LINK_C.length > 3000, LINK_C.length <= 4000], [true, true]);
t('fixtures: every valid link holds only letters, digits, dot, dash and underscore', [LINK_A, LINK_B, LINK_C].map((l) => /^[A-Za-z0-9._-]+$/.test(l)), [true, true, true]);

// ---------------------------------------------------------------------------
// 1. Nothing to inject: the page is the baseline, byte for byte.
// ---------------------------------------------------------------------------
t('the fixture\'s no-view page is the hand-written baseline (what doGet served before this change)', env.doGet({ parameter: {} }), BASELINE_PAGE);
for (const [name, e] of [
  ['no event object at all', undefined],
  ['an event with no parameter', {}],
  ['an empty parameter object', { parameter: {} }],
  ['view undefined', { parameter: { view: undefined } }],
  ['view null', { parameter: { view: null } }],
  ['view empty string', { parameter: { view: '' } }],
]) t('doGet, ' + name + ': the baseline page, byte for byte', env.doGet(e), BASELINE_PAGE);

// ---------------------------------------------------------------------------
// 2. A valid link: injected as the original text, in the right place, and it evaluates back exactly.
// ---------------------------------------------------------------------------
// Evaluates one script body in a fresh sandbox. A body that does not run (broken by a bad escape) answers
// 'threw: ...' instead of throwing, so the failure is reported as an ordinary assertion.
function evalBody(body) {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(String(body), sandbox, { timeout: 1000 });
    return sandbox.window.__SHARED_VIEW__;
  } catch (err) {
    return 'threw: ' + String(err && err.message || err);
  }
}
// The body of the i-th script a browser reads, or null when the page has fewer scripts than that.
const bodyAt = (read, i) => (read.bodies[i] ? read.bodies[i].body : null);
for (const [name, link] of [['A', LINK_A], ['B (hostile text inside the view)', LINK_B], ['C (long)', LINK_C]]) {
  const page = env.doGet({ parameter: { view: link } });
  const expected = BASELINE_PAGE.slice(0, BASELINE_PAGE.indexOf(MARKER)) + cleanTag(link) + BASELINE_PAGE.slice(BASELINE_PAGE.indexOf(MARKER));
  t('doGet, valid link ' + name + ': the baseline page with exactly one tag added, last before the babel block', page, expected);
  const read = scriptBodies(page);
  t('valid link ' + name + ': the page has the four scripts (exec url, prefs, extras, shared view) then the app, as a browser would read it',
    read.bodies.map((b) => b.body.split('=')[0]), ['window.__EXEC_URL__', 'window.__SERVER_PREFS__', 'window.__SERVER_EXTRAS__', 'window.__SHARED_VIEW__', 'const app ']);
  t('valid link ' + name + ': evaluating the injected script in a fresh sandbox gives back the original string, strictly equal', evalBody(bodyAt(read, 3)) === link, true);
  t('valid link ' + name + ': the app script and the text after it are untouched', [bodyAt(read, 4), read.rest], ['const app = 1;', '</body></html>']);
}
t('injectSharedView_ on its own: the tag goes immediately before the babel marker',
  env.inject(TEMPLATE, LINK_A), withTag(LINK_A));
t('a link sent by the real encoder from a view with markup in it is accepted (the link itself is plain text)', env.inject(TEMPLATE, LINK_B) === withTag(LINK_B), true);

// ---------------------------------------------------------------------------
// 3. Links the real decoder refuses: unchanged.
// ---------------------------------------------------------------------------
const payloadOf = (l) => l.split('.')[1];
const checkOf = (l) => l.split('.')[2];
const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
const refused = [
  ['wrong version v2', 'v2.' + payloadOf(LINK_A) + '.' + checkOf(LINK_A)],
  ['version in capitals', 'V1.' + payloadOf(LINK_A) + '.' + checkOf(LINK_A)],
  ['no version', payloadOf(LINK_A) + '.' + checkOf(LINK_A)],
  ['bad checksum (the last character changed)', LINK_A.slice(0, -1) + (LINK_A.slice(-1) === 'A' ? 'B' : 'A')],
  ['one payload character changed', flip(LINK_A, 8)],
  ['a trailing dot', LINK_A + '.'],
  ['a trailing space', LINK_A + ' '],
  ['a leading space', ' ' + LINK_A],
  ['a trailing newline', LINK_A + '\n'],
  ['the check missing', 'v1.' + payloadOf(LINK_A)],
  ['an empty payload', 'v1..AAAA'],
  ['a link cut in half (a mail client wrapped it)', LINK_A.slice(0, Math.floor(LINK_A.length / 2))],
  ['two links joined', LINK_A + LINK_A],
  ['percent-encoded text that was never decoded', encodeURIComponent(LINK_A).replace(/\./g, '%2E')],
  ['base64 with a plus (the non-url alphabet)', 'v1.ab+c.AAAA'],
  ['a script tag', '<script>alert(1)</script>'],
  ['a close-script tag in a link-shaped text', 'v1.</script>.AAAA'],
  ['an HTML comment opener', 'v1.<!--.AAAA'],
  ['a quote and a semicolon', 'v1.";alert(1);//.AAAA'],
  ['a backslash', 'v1.a\\b.AAAA'],
  ['U+2028 and U+2029', 'v1.a\u2028b\u2029c.AAAA'],
  ['a NUL character', 'v1.a\u0000b.AAAA'],
  ['a lone surrogate', 'v1.\ud800.AAAA'],
  ['non-ASCII letters that look like ASCII (a Cyrillic a)', 'v1.аbcd.AAAA'],
  ['just the word view', 'view'],
  ['a 4,002-character link with a valid checksum (the shortest well-formed link over the codec limit of 4,000)', forgeLength(4002)],
  ['a 100,000-character link', 'v1.' + 'A'.repeat(100000) + '.AAAA'],
  ['a 4,001-character string of link characters (one over the codec and server limit)', 'v1.' + 'A'.repeat(3993) + '.AAAA'],
  ['an 8,001-character string of link characters (the old server limit, now far over)', 'v1.' + 'A'.repeat(7990) + '.AAAA'],
];
t('fixtures: the 4,002-character refused link really is that long, and the 100,000 one', [refused.find((r) => r[0].startsWith('a 4,002'))[1].length, refused.find((r) => r[0].startsWith('a 100,000'))[1].length], [4002, 100008]);
for (const [name, bad] of refused) {
  t('refused: ' + name + ' -> unchanged page', [env.inject(TEMPLATE, bad) === TEMPLATE, env.doGet({ parameter: { view: bad } }) === BASELINE_PAGE], [true, true]);
}

// The other side of the codec's 4,000-character limit: a well-formed link of exactly 4,000 characters is
// handed on (its view would be rejected by the client's own checks, but as a text it is fine).
{
  const at = forgeLength(4000);
  t('a 4,000-character well-formed link (the codec limit) is handed on', [at.length, env.inject(TEMPLATE, at) === withTag(at)], [4000, true]);
}

// The decoder must judge exactly the text that is injected (found by an adversarial review that replaced the
// decoder's input with its first 4,000 characters: every other check still passed). A valid 4,000-character
// link followed by a hostile tail is 4,035 characters and must be refused as a whole. The decoder's own 4,000
// limit makes this safe today; the assertion keeps it safe if that limit is ever raised past the cap here.
{
  const hostileTail = '"</script><script>alert(1)</script>';
  const long = forgeLength(4000) + hostileTail;
  t('a valid 4,000-character link plus a hostile tail (the decoder must judge exactly what is injected) -> unchanged page', [long.length, env.inject(TEMPLATE, long) === TEMPLATE], [4035, true]);
}

// The marker text can occur more than once in a real page: dist/index.html has it as the real tag AND inside a
// comment in the app's own script, far later. The tag must go before the FIRST one (a version that used the last
// would put it inside the inert babel block and break the page for every valid link; found by the same review).
{
  const TWO = TEMPLATE.replace('const app = 1;', 'const app = 1; // this comment mentions ' + MARKER + ' again');
  const outTwo = env.inject(TWO, LINK_A);
  t('a page whose script mentions the marker text again: the tag goes before the first marker, and only there',
    [outTwo === TWO.slice(0, TWO.indexOf(MARKER)) + cleanTag(LINK_A) + TWO.slice(TWO.indexOf(MARKER)), TWO.split(MARKER).length - 1], [true, 2]);
  const real = read('dist', 'index.html');
  const outReal = env.inject(real, LINK_A);
  const firstAt = real.indexOf(MARKER);
  t('on the real dist/index.html the tag sits immediately before the first marker',
    [outReal.indexOf('<script>window.__SHARED_VIEW__=') === firstAt, outReal.indexOf(MARKER) === firstAt + cleanTag(LINK_A).length], [true, true]);
}

// Tamper with every character of a valid link, two ways each: none may be accepted.
{
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (const [name, link] of [['A', LINK_A], ['B', LINK_B]]) {
    let variants = 0, accepted = 0;
    for (let i = 0; i < link.length; i++) {
      for (const k of [1, 17]) {
        const pos = ALPHABET.indexOf(link[i]);
        const repl = pos < 0 ? ALPHABET[k] : ALPHABET[(pos + k) % 64];
        const bad = link.slice(0, i) + repl + link.slice(i + 1);
        if (bad === link) continue;
        variants++;
        if (env.inject(TEMPLATE, bad) !== TEMPLATE) accepted++;
      }
    }
    console.log(`  (tampered ${variants} variants of link ${name}, ${link.length} characters; accepted: ${accepted})`);
    t('every single-character change of valid link ' + name + ' is refused (none accepted)', [variants >= 2 * (link.length - 2), accepted], [true, 0]);
  }
}

// Forged links: a VALID checksum around hostile or broken content.
{
  const forgedBad = [
    ['valid check, payload is not JSON', forge('not json')],
    ['valid check, JSON that is an array', forge('["a"]')],
    ['valid check, JSON null', forge('null')],
    ['valid check, JSON number', forge('5')],
    ['valid check, invalid UTF-8 inside', 'v1.' + b64url(Buffer.from([0x7b, 0xff, 0x7d])) + '.' + (() => { const p = b64url(Buffer.from([0x7b, 0xff, 0x7d])); const c = crc24(p); return b64url([(c >> 16) & 255, (c >> 8) & 255, c & 255]); })()],
  ];
  for (const [name, bad] of forgedBad) t('refused: ' + name, [env.inject(TEMPLATE, bad) === TEMPLATE, /^[A-Za-z0-9._-]+$/.test(bad)], [true, true]);
  // These are well-formed as a TEXT, so the server hands them on; the client decodes them with its own
  // valid sets and drops what it must. The server's promise is only that the text it injects is inert.
  const forgedPass = [
    forge('{}'),
    forge('{"__proto__":{"polluted":1}}'),
    forge('{"constructor":{"prototype":{"polluted":1}}}'),
    forge('{"selectedLanes":"</script><img src=x onerror=alert(1)>"}'),
    forge('{"tab":"\\u003cscript\\u003e","unknownKey":{"a":[1,2,3]}}'),
    forge('{"headerFilters":{"vvd":"\\"; alert(1); //"}}'),
  ];
  for (const link of forgedPass) {
    const page = env.doGet({ parameter: { view: link } });
    const read = scriptBodies(page);
    t('forged link with a valid checksum (' + link.slice(0, 18) + '...): well-formed text is handed on, and inert (evaluates back to itself)',
      [read.bodies.length, evalBody(bodyAt(read, 3)) === link, bodyAt(read, 4), Object.prototype.polluted], [5, true, 'const app = 1;', undefined]);
  }
}

// ---------------------------------------------------------------------------
// 4. Wrong types and repeated parameters.
// ---------------------------------------------------------------------------
for (const [name, v] of [
  ['an array holding a valid link', [LINK_A]],
  ['a number', 5],
  ['a boolean', true],
  ['an object', { toString: () => LINK_A }],
  ['a String object wrapping a valid link', new String(LINK_A)], // eslint-disable-line no-new-wrappers
  ['a function', () => LINK_A],
  ['an object whose toString throws', { toString() { throw new Error('boom'); } }],
]) t('doGet, view is ' + name + ': unchanged, no throw', (() => { try { return env.doGet({ parameter: { view: v } }) === BASELINE_PAGE; } catch (err) { return 'threw ' + err; } })(), true);
t('a repeated parameter (e.parameters.view has two values) is ignored even when the first is valid',
  env.doGet({ parameter: { view: LINK_A }, parameters: { view: [LINK_A, LINK_A] } }), BASELINE_PAGE);
t('a repeated parameter whose second value is hostile is ignored too', env.doGet({ parameter: { view: LINK_A }, parameters: { view: [LINK_A, '</script>'] } }), BASELINE_PAGE);
t('one value in e.parameters.view is the normal case and is injected', env.doGet({ parameter: { view: LINK_A }, parameters: { view: [LINK_A] } }), BASELINE_PAGE.replace(MARKER, cleanTag(LINK_A) + MARKER));
t('sharedViewParam_: normal, repeated, absent, no event, and a parameters getter that throws',
  [env.param({ parameter: { view: 'x' }, parameters: { view: ['x'] } }), env.param({ parameter: { view: 'x' }, parameters: { view: ['x', 'y'] } }), env.param({ parameter: {} }), env.param(undefined),
    (() => { const e = { parameter: { view: 'x' } }; Object.defineProperty(e, 'parameters', { get() { throw new Error('boom'); } }); return env.param(e); })()],
  ['x', undefined, undefined, undefined, undefined]);

// ---------------------------------------------------------------------------
// 5. The page itself and the environment.
// ---------------------------------------------------------------------------
const NO_MARKER = '<html><body><script>const app = 1;</script></body></html>';
t('a page without the babel marker is returned unchanged for a valid link (nothing to anchor to)', env.inject(NO_MARKER, LINK_A), NO_MARKER);
t('...and through doGet', load({ template: NO_MARKER }).doGet({ parameter: { view: LINK_A } }).includes('__SHARED_VIEW__'), false);
t('a page with the marker spelled differently is also left alone', env.inject('<script type="text/babel" data-x="1">x</script>', LINK_A), '<script type="text/babel" data-x="1">x</script>');
t('html that is not a string does not make it throw (undefined, null, a number come back as given)', [env.inject(undefined, LINK_A), env.inject(null, LINK_A), env.inject(7, LINK_A)], [undefined, null, 7]);
{
  const noShared = load({ order: 'no-shared' });
  t('Code.gs pasted WITHOUT Shared.gs still serves the page, unchanged, for a valid link', noShared.doGet({ parameter: { view: LINK_A } }), BASELINE_PAGE);
  const later = load({ order: 'shared-first' });
  t('load order does not matter: Shared.gs first accepts a valid link', later.doGet({ parameter: { view: LINK_A } }), BASELINE_PAGE.replace(MARKER, cleanTag(LINK_A) + MARKER));
  t('load order does not matter: Code.gs first (the default above) gave the same page', env.doGet({ parameter: { view: LINK_A } }), BASELINE_PAGE.replace(MARKER, cleanTag(LINK_A) + MARKER));
}
t('the server limit is 4,000 characters, the codec\'s own limit (viewCodec_MAX_ENCODED_CHARS in Shared.gs)', env.maxChars, 4000);

// ---------------------------------------------------------------------------
// 6. Defence in depth: the real escaper and the length gate, with the decoder swapped for one that
//    accepts ANYTHING. Each string below would break a naive injection.
// ---------------------------------------------------------------------------
const HOSTILE = [
  ['</script><img src=x onerror=alert(1)>', 'close-script tag'],
  ['</SCRIPT >', 'close-script tag in capitals with a space'],
  ['<!--<script>', 'comment opener plus script (double escaped state)'],
  ['<!--<script></script>', 'the same with its own close tag'],
  ['--><script>alert(1)</script>', 'comment closer'],
  ['"; alert(1); //', 'quote and statement'],
  ['\\"; alert(1); //', 'backslash before the quote'],
  ['a\\b\\\\c\\', 'backslashes, one trailing'],
  ["'; alert(1); //", 'single quote'],
  ['`${alert(1)}`', 'template literal'],
  ['\u2028alert(1)\u2029', 'U+2028 and U+2029'],
  ['line1\nline2\r\nline3\ttab', 'control characters'],
  ['nul\u0000nul', 'NUL'],
  ['\ud800 alone and \udc00 alone', 'lone surrogates'],
  ['emoji 😀 and café', 'non-ASCII text'],
  ['&lt;script&gt; &#x3c;script&#62; &amp;', 'HTML entities'],
  [']]><![CDATA[x]]>', 'CDATA'],
  ['<<<<>>>>&&&&', 'only metacharacters, several of each (a non-global replace would miss the second)'],
  ['</script></script></script>', 'three close tags'],
  ['\u2028\u2028\u2029\u2029', 'repeated separators'],
];
{
  const e2 = load();
  const calls = e2.setDecoder(OK_DECODE);
  for (const [s, what] of HOSTILE) {
    const page = e2.inject(TEMPLATE, s);
    const read = scriptBodies(page);
    t('permissive decoder, ' + what + ': a browser reads the page as injected script + the untouched app + the rest',
      [read.bodies.length, bodyAt(read, 1), read.rest, !!(read.bodies[0] && read.bodies[0].unterminated)], [2, 'const app = 1;', '</body></html>', false]);
    t('permissive decoder, ' + what + ': the injected script evaluates back to the exact original string', evalBody(bodyAt(read, 0)) === s, true);
    const from = page.indexOf('<script>window.__SHARED_VIEW__=');
    const injected = from < 0 ? '(no injected tag)' : page.slice(from, page.indexOf(MARKER));
    t('permissive decoder, ' + what + ': the injected tag holds no raw <, > or & inside, and no U+2028 / U+2029',
      [from >= 0, /[<>&\u2028\u2029]/.test(injected.slice('<script>'.length, injected.length - '</script>\n    '.length))], [true, false]);
  }
  // Length gate: the boundary, and that a huge string is not even handed to the decoder.
  calls.n = 0;
  const exactly4000 = 'a'.repeat(4000), over = 'a'.repeat(4001);
  t('permissive decoder: exactly 4,000 characters is injected, and the decoder was asked once', [e2.inject(TEMPLATE, exactly4000) !== TEMPLATE, calls.n], [true, 1]);
  calls.n = 0;
  t('permissive decoder: 4,001 characters is refused WITHOUT asking the decoder (the cheap test comes first)', [e2.inject(TEMPLATE, over) === TEMPLATE, calls.n], [true, 0]);
  t('permissive decoder: 8,000 and 8,001 characters (the old server limit) are refused without asking the decoder either', [e2.inject(TEMPLATE, 'a'.repeat(8000)) === TEMPLATE, e2.inject(TEMPLATE, 'a'.repeat(8001)) === TEMPLATE, calls.n], [true, true, 0]);
  t('permissive decoder: a 100,000-character string is refused without asking the decoder', [e2.inject(TEMPLATE, 'a'.repeat(100000)) === TEMPLATE, calls.n], [true, 0]);
  t('permissive decoder: the empty string is refused', [e2.inject(TEMPLATE, '') === TEMPLATE, calls.n], [true, 0]);
  // Types: with a decoder that accepts anything, only the string test stands between a non-string and the page.
  for (const [name, v] of [['an array', ['a']], ['a number', 5], ['null', null], ['undefined', undefined], ['an object', { a: 1 }], ['a boolean', true]]) {
    t('permissive decoder: ' + name + ' is not a string, so unchanged and the decoder is not asked', [e2.inject(TEMPLATE, v) === TEMPLATE, calls.n], [true, 0]);
  }
  // What the decoder answers decides: refuse on any error, on a missing or odd answer.
  const verdicts = [
    ['errors lists one code', () => ({ state: {}, errors: ['bad-checksum'] })],
    ['errors holds two codes', () => ({ state: {}, errors: ['a', 'b'] })],
    ['no errors field', () => ({ state: {} })],
    ['null result', () => null],
    ['undefined result', () => undefined],
    ['errors is not a list (a string with length)', () => ({ errors: 'x' })],
    ['the decoder throws', () => { throw new Error('decoder blew up'); }],
  ];
  for (const [name, fn] of verdicts) {
    e2.setDecoder(fn);
    t('decoder answer: ' + name + ' -> unchanged, no throw', (() => { try { return e2.inject(TEMPLATE, 'abc') === TEMPLATE; } catch (err) { return 'threw'; } })(), true);
  }
  e2.setDecoder(OK_DECODE);
  t('decoder answer: an empty errors list is the one thing that is accepted', e2.inject(TEMPLATE, 'abc') === TEMPLATE, false);
  // BFShared without a decodeView (an older Shared.gs): refuse, do not throw.
  vm.runInContext('BFShared.decodeView = undefined;', e2.ctx);
  t('an older Shared.gs without decodeView: unchanged, no throw', e2.inject(TEMPLATE, LINK_A) === TEMPLATE, true);
}

// ---------------------------------------------------------------------------
// 7. The wiring in doGet, and the rule that Code.gs never touches BFShared at load time.
// ---------------------------------------------------------------------------
{
  const code = CODE_GS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const doGetBody = code.slice(code.indexOf('function doGet('), code.indexOf('function getIndexVersionHash_'));
  t('doGet calls injectSharedView_ once, after the prefs and extras injections and before the config one',
    [(doGetBody.match(/injectSharedView_\(/g) || []).length,
      doGetBody.indexOf('injectServerExtras_(') < doGetBody.indexOf('injectSharedView_(') && doGetBody.indexOf('injectSharedView_(') < doGetBody.indexOf('injectAppConfig_(')],
    [1, true]);
  // Every use of BFShared must sit inside a function body (Shared.gs may load after Code.gs).
  const lines = code.split('\n');
  let depth = 0, topLevelUse = [];
  for (const line of lines) {
    if (depth === 0 && /\bBFShared\b/.test(line)) topLevelUse.push(line.trim());
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  }
  t('Code.gs uses BFShared only inside function bodies (never in top-level code, which runs before Shared.gs may have loaded)', topLevelUse, []);
}

const EXPECTED = 181;
if (pass + failures.length !== EXPECTED) {
  failures.push(`expected ${EXPECTED} assertions, ran ${pass + failures.length} -- an assertion was added or silently dropped; update EXPECTED deliberately`);
}

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  failures.forEach((f) => console.error(`  - ${f}\n`));
  process.exit(1);
}
console.log(`SHARED_VIEW_INJECTION_PASSED (${pass} assertions)`);

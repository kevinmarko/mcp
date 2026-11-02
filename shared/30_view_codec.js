// View codec for shareable view links (roadmap slice 4.1).
//
// WHAT. BFShared.encodeView(state) turns a report VIEW (the slicer selections, the per-column header
// filters, the active tab, optionally an archive date or a relative sale-week span) into short
// URL-safe text. BFShared.decodeView(text, validSets) turns such text back into a view, to be applied
// for ONE session. The server (doGet) hands the URL parameter to the page as data, so decodeView
// treats the text as HOSTILE: it never throws, never returns a key outside the whitelist below,
// never returns a value of the wrong type, and bounds everything it reads and everything it reports.
//
// THE WHITELIST (the state keys, with the value each one holds). Anything else is ignored and reported.
//   selectedSubTrades, selectedAnalysts, selectedMktgAnalysts, selectedCoasts, selectedLanes,
//   selectedSaleWeeks, selectedYards, selectedApStatuses   arrays of strings (the app's slicer state)
//   yardSearchText                                        a string
//   headerFilters                                         an object, column key -> filter text; a column key is a
//                                                         letter then letters, digits or underscores (64 at most)
//   tab                                                   one of the app's tab ids (viewCodec_TABS)
//   date                                                  'YYYY-MM-DD', a real calendar date, to view an archive day
//   weeksAhead                                            an integer 1..52, "the next N sale weeks"
// What decodeView returns is still untrusted TEXT: a filter string can hold markup or script, so the page
// must render it as text (React does) and never write it into innerHTML or an unescaped server template.
// weeksAhead exists because absolute sale weeks go stale every Monday when the 18-week window rolls:
// a link that says "the next 4 weeks" is still right next week, a link that lists four absolute weeks
// is not. The codec does not resolve it and does not choose between it and selectedSaleWeeks if a view
// carries both; it returns both and the app decides.
//
// THE TEXT.   v1.<payload>.<check>      (only letters, digits, '-', '_' and '.')
//   payload  base64url (RFC 4648 section 5 alphabet, no padding) of the UTF-8 bytes of ONE JSON object.
//            Keys are in sorted order, array order is kept as given, so the same view always gives the
//            same text. A key that holds nothing (an empty array, empty text, no header filters) is
//            left out: absent means "the default", so the app should reset every whitelisted field to
//            its default before applying a decoded view. A header filter whose text is empty is a no-op
//            in the app, so it is left out too.
//   check    4 characters: base64url of the CRC-24 (the OpenPGP parameters) of the payload text. A link
//            damaged on its way (cut by a mail client, one character mistyped) must be refused, not
//            decoded into a different view that looks plausible. CRC-24 detects every single-character
//            error. It is not a signature: anyone can write a link with a valid check, which is why the
//            decoder stays hostile-input safe regardless of it.
//   The text is never trimmed or repaired: a link is exact or it is rejected.
//
// WHY BY HAND. btoa, atob, Buffer and TextEncoder are not ES5 built-ins and do not exist in Apps Script's
// server context, and this code must run there and in the browser unchanged. Base64url, UTF-8 and the
// checksum are therefore written out below. Strings are measured in UTF-16 code units (their .length).
//
// STALE VALUES. validSets = { selectedLanes: [...], selectedSaleWeeks: [...], tabs: [...], date: [...],
// headerFilters: [column keys], ... }. When validSets has an array for a name, values outside it are
// STALE (a sale week that rolled out of the window, a lane that was retired, an archive day that was
// purged): each is dropped, reported in dropped with reason 'not-in-current-data', and the rest of the
// view still applies. A name with no array (absent, null, or not an array) is not value-checked. The
// set for the tab key is called tabs; every other set is named after its key.
//
// REJECTED, NOT REPAIRED. A structural problem rejects the whole key with a reason and the rest of the
// view still applies: a wrong type (a number where an array is expected, null, an element that is not a
// string such as a nested array), a limit exceeded, a header filter key that is a prototype-pollution
// name or not a plain column key, a tab that is not a real tab, an impossible date, a weeksAhead outside
// 1..52. Only staleness is judged per value.
//
// encodeView is the strict half. It ignores keys that are not in the whitelist (the app may pass its
// whole filter snapshot) and treats null and undefined as absent, but a whitelisted value that fails
// any rule above, or a result longer than the limit, returns null instead of a link that would quietly
// show a different view. It never throws. decodeView(encodeView(s)) gives back exactly s, minus the
// empty values left out above.

// Limits. tests/shared_logic/30_view_codec.js pins each one at the limit and one over it.
var viewCodec_MAX_ENCODED_CHARS = 4000;
var viewCodec_MAX_ARRAY_ITEMS = 200;
var viewCodec_MAX_STRING_CHARS = 200;
var viewCodec_MAX_HEADER_FILTER_KEYS = 40;
var viewCodec_MAX_COLUMN_KEY_CHARS = 64;
var viewCodec_WEEKS_AHEAD_MAX = 52;
// The archive only holds recent days; a four-digit year outside this range is a typo or an attack.
var viewCodec_YEAR_MIN = 2000;
var viewCodec_YEAR_MAX = 2099;

var viewCodec_VERSION = 'v1';
var viewCodec_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// The app's tab ids (activeTab in the app: the five setActiveTab call sites). A new tab has to be added
// here before a link to it can be decoded.
var viewCodec_TABS = ['compare', 'detail', 'pol_booking', 'sector_summary', 'trade_summary'];

// The whitelist, in sorted key order (that order is the order of keys in the text). kind picks the
// validator; set is the name to look up in validSets (null: no set for this key).
var viewCodec_FIELDS = [
    { key: 'date', kind: 'date', set: 'date' },
    { key: 'headerFilters', kind: 'map', set: 'headerFilters' },
    { key: 'selectedAnalysts', kind: 'list', set: 'selectedAnalysts' },
    { key: 'selectedApStatuses', kind: 'list', set: 'selectedApStatuses' },
    { key: 'selectedCoasts', kind: 'list', set: 'selectedCoasts' },
    { key: 'selectedLanes', kind: 'list', set: 'selectedLanes' },
    { key: 'selectedMktgAnalysts', kind: 'list', set: 'selectedMktgAnalysts' },
    { key: 'selectedSaleWeeks', kind: 'list', set: 'selectedSaleWeeks' },
    { key: 'selectedSubTrades', kind: 'list', set: 'selectedSubTrades' },
    { key: 'selectedYards', kind: 'list', set: 'selectedYards' },
    { key: 'tab', kind: 'tab', set: 'tabs' },
    { key: 'weeksAhead', kind: 'weeks', set: null },
    { key: 'yardSearchText', kind: 'text', set: null }
];

// ---- small helpers -------------------------------------------------------------------------------

function viewCodec_hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

// A JSON-style object, not an array, null or a built-in such as Date. The toString tag also works for
// an object that came from another realm (a vm context, an iframe), where instanceof would not.
// (No typeof-object test here or anywhere in this file: Babel's preset-env rewrites that into a helper
// function declared at the top level, which would add a second global name to the generated region.)
function viewCodec_isPlainObject(v) {
    return Object.prototype.toString.call(v) === '[object Object]';
}

// The three names that can reach Object.prototype when a hostile key is assigned onto a plain object.
function viewCodec_isForbiddenKey(k) {
    return k === '__proto__' || k === 'constructor' || k === 'prototype';
}

function viewCodec_fieldFor(key) {
    var i;
    for (i = 0; i < viewCodec_FIELDS.length; i++) {
        if (viewCodec_FIELDS[i].key === key) return viewCodec_FIELDS[i];
    }
    return null;
}

// Cuts text to max code units, never leaving half of a surrogate pair at the end.
function viewCodec_clip(s, max) {
    var c;
    if (s.length <= max) return s;
    s = s.slice(0, max);
    c = s.charCodeAt(s.length - 1);
    return c >= 0xD800 && c <= 0xDBFF ? s.slice(0, s.length - 1) : s;
}

// A report entry. Everything in it is a short string: a rejected value can be 3000 characters long or
// nested a thousand levels deep, and the caller may log it or put it on screen.
function viewCodec_note(key, value, reason) {
    return {
        key: viewCodec_clip(key, viewCodec_MAX_COLUMN_KEY_CHARS),
        value: viewCodec_clip(value, viewCodec_MAX_STRING_CHARS),
        reason: reason
    };
}

// A bounded description of a rejected value (its type, not its content, unless it is a string).
function viewCodec_preview(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || v === undefined) return String(v);
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array(' + v.length + ')';
    return 'object';
}

// validSets[setName] as a lookup, or null when there is nothing to check against. The '$' prefix keeps
// a value such as '__proto__' an ordinary property name.
function viewCodec_allowed(validSets, setName) {
    var list, map, i;
    if (setName === null || !viewCodec_isPlainObject(validSets) || !viewCodec_hasOwn(validSets, setName)) return null;
    list = validSets[setName];
    if (!Array.isArray(list)) return null;
    map = {};
    for (i = 0; i < list.length; i++) {
        if (typeof list[i] === 'string') map['$' + list[i]] = true;
    }
    return map;
}

function viewCodec_allows(map, value) {
    return map === null || viewCodec_hasOwn(map, '$' + value);
}

// ---- dates ---------------------------------------------------------------------------------------

// The number written by the digits s[from..to), or -1 if any of them is not an ASCII digit.
function viewCodec_digits(s, from, to) {
    var n = 0, i, c;
    for (i = from; i < to; i++) {
        c = s.charCodeAt(i);
        if (c < 48 || c > 57) return -1;
        n = n * 10 + (c - 48);
    }
    return n;
}

// 'YYYY-MM-DD' naming a real day, by arithmetic only. The Date object is not used on purpose: its local
// time methods would answer differently on a machine in another time zone (and this runs on the server
// as well as in the browser), and its parser accepts '2026-02-30' in some engines.
function viewCodec_isRealDate(s) {
    var y, m, d, leap, days;
    if (typeof s !== 'string' || s.length !== 10 || s.charAt(4) !== '-' || s.charAt(7) !== '-') return false;
    y = viewCodec_digits(s, 0, 4);
    m = viewCodec_digits(s, 5, 7);
    d = viewCodec_digits(s, 8, 10);
    if (y < viewCodec_YEAR_MIN || y > viewCodec_YEAR_MAX || m < 1 || m > 12 || d < 1) return false;
    leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[m - 1];
}

// ---- per-field validation ------------------------------------------------------------------------
// Each checker returns the value to keep, or undefined for "nothing to apply" (rejected, or empty), and
// pushes a note onto dropped for everything it rejects or drops. None of them throws.

function viewCodec_checkList(key, v, allowed, dropped) {
    var kept = [], i;
    if (!Array.isArray(v)) { dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type')); return undefined; }
    if (v.length > viewCodec_MAX_ARRAY_ITEMS) { dropped.push(viewCodec_note(key, String(v.length), 'too-many-items')); return undefined; }
    for (i = 0; i < v.length; i++) {
        if (typeof v[i] !== 'string') { dropped.push(viewCodec_note(key, viewCodec_preview(v[i]), 'wrong-type')); return undefined; }
        if (v[i].length > viewCodec_MAX_STRING_CHARS) { dropped.push(viewCodec_note(key, v[i], 'too-long')); return undefined; }
    }
    for (i = 0; i < v.length; i++) {
        if (viewCodec_allows(allowed, v[i])) kept.push(v[i]);
        else dropped.push(viewCodec_note(key, v[i], 'not-in-current-data'));
    }
    return kept.length > 0 ? kept : undefined;
}

function viewCodec_checkText(key, v, dropped) {
    if (typeof v !== 'string') { dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type')); return undefined; }
    if (v.length > viewCodec_MAX_STRING_CHARS) { dropped.push(viewCodec_note(key, v, 'too-long')); return undefined; }
    return v === '' ? undefined : v;
}

function viewCodec_checkTab(key, v, allowed, dropped) {
    if (typeof v !== 'string') { dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type')); return undefined; }
    if (viewCodec_TABS.indexOf(v) < 0) { dropped.push(viewCodec_note(key, v, 'invalid-value')); return undefined; }
    if (!viewCodec_allows(allowed, v)) { dropped.push(viewCodec_note(key, v, 'not-in-current-data')); return undefined; }
    return v;
}

function viewCodec_checkDate(key, v, allowed, dropped) {
    if (typeof v !== 'string') { dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type')); return undefined; }
    if (!viewCodec_isRealDate(v)) { dropped.push(viewCodec_note(key, v, 'invalid-value')); return undefined; }
    if (!viewCodec_allows(allowed, v)) { dropped.push(viewCodec_note(key, v, 'not-in-current-data')); return undefined; }
    return v;
}

// !(v >= 1 && v <= 52) is also true for NaN, so it needs no separate test.
function viewCodec_checkWeeks(key, v, dropped) {
    if (typeof v !== 'number') { dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type')); return undefined; }
    if (!(v >= 1 && v <= viewCodec_WEEKS_AHEAD_MAX) || v !== Math.floor(v)) { dropped.push(viewCodec_note(key, String(v), 'invalid-value')); return undefined; }
    return v;
}

// A column key as the app writes them (vvd, saleWeek, vslOpr): a letter, then letters, digits and
// underscores. That alone excludes __proto__; the other two pollution names are matched by name.
function viewCodec_isColumnKey(k) {
    var i, c;
    if (k.length === 0 || k.length > viewCodec_MAX_COLUMN_KEY_CHARS) return false;
    for (i = 0; i < k.length; i++) {
        c = k.charCodeAt(i);
        if (c >= 65 && c <= 90) continue;
        if (c >= 97 && c <= 122) continue;
        if (i > 0 && ((c >= 48 && c <= 57) || c === 95)) continue;
        return false;
    }
    return true;
}

// headerFilters: column key -> filter text. strict is the encoder: it first drops the empty-text
// entries, which the app treats as no filter, so that they neither count toward the key limit nor
// reach the text. The decoder counts every key it was given, then leaves empty ones out of the result.
function viewCodec_checkMap(key, v, allowed, dropped, strict) {
    var names, nonEmpty, out, count, i, name;
    if (!viewCodec_isPlainObject(v)) { dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type')); return undefined; }
    names = Object.keys(v).sort();
    if (strict) {
        nonEmpty = [];
        for (i = 0; i < names.length; i++) if (v[names[i]] !== '') nonEmpty.push(names[i]);
        names = nonEmpty;
    }
    if (names.length > viewCodec_MAX_HEADER_FILTER_KEYS) { dropped.push(viewCodec_note(key, String(names.length), 'too-many-keys')); return undefined; }
    for (i = 0; i < names.length; i++) {
        name = names[i];
        if (viewCodec_isForbiddenKey(name)) { dropped.push(viewCodec_note(key, name, 'forbidden-key')); return undefined; }
        if (!viewCodec_isColumnKey(name)) { dropped.push(viewCodec_note(key, name, 'invalid-key')); return undefined; }
        if (typeof v[name] !== 'string') { dropped.push(viewCodec_note(key, name, 'wrong-type')); return undefined; }
        if (v[name].length > viewCodec_MAX_STRING_CHARS) { dropped.push(viewCodec_note(key, name, 'too-long')); return undefined; }
    }
    out = {};
    count = 0;
    for (i = 0; i < names.length; i++) {
        name = names[i];
        if (v[name] === '') continue;
        if (!viewCodec_allows(allowed, name)) { dropped.push(viewCodec_note(key, name, 'not-in-current-data')); continue; }
        out[name] = v[name];
        count++;
    }
    return count > 0 ? out : undefined;
}

function viewCodec_checkField(field, v, validSets, dropped, strict) {
    var allowed = viewCodec_allowed(validSets, field.set);
    if (field.kind === 'list') return viewCodec_checkList(field.key, v, allowed, dropped);
    if (field.kind === 'text') return viewCodec_checkText(field.key, v, dropped);
    if (field.kind === 'tab') return viewCodec_checkTab(field.key, v, allowed, dropped);
    if (field.kind === 'date') return viewCodec_checkDate(field.key, v, allowed, dropped);
    if (field.kind === 'weeks') return viewCodec_checkWeeks(field.key, v, dropped);
    return viewCodec_checkMap(field.key, v, allowed, dropped, strict);
}

// Validates a whole input object. Returns { state, dropped }: state holds only whitelisted keys with
// validated, non-empty values (a fresh plain object); dropped says what was not applied and why.
// Keys are visited in sorted order, so the report is the same whatever order the sender wrote them in.
// strict (the encoder) ignores unknown keys and treats null and undefined as absent; the decoder
// reports unknown keys, and a null is a wrong type.
function viewCodec_normalize(input, validSets, strict) {
    var state = {}, dropped = [], keys = Object.keys(input).sort(), i, k, v, field, kept;
    for (i = 0; i < keys.length; i++) {
        k = keys[i];
        v = input[k];
        if (viewCodec_isForbiddenKey(k)) { dropped.push(viewCodec_note(k, viewCodec_preview(v), 'forbidden-key')); continue; }
        field = viewCodec_fieldFor(k);
        if (field === null) {
            if (!strict) dropped.push(viewCodec_note(k, viewCodec_preview(v), 'unknown-key'));
            continue;
        }
        if (strict && (v === undefined || v === null)) continue;
        kept = viewCodec_checkField(field, v, validSets, dropped, strict);
        if (kept !== undefined) state[k] = kept;
    }
    return { state: state, dropped: dropped };
}

// ---- JSON text -----------------------------------------------------------------------------------

// A JSON string literal. Written by hand (not JSON.stringify) so the text is identical on every
// engine: a lone surrogate, which engines before ES2019 write raw, is always written as an escape, and
// the result then holds only well-formed UTF-16 for the UTF-8 step.
function viewCodec_jsonString(s) {
    var out = '"', i, c, d;
    for (i = 0; i < s.length; i++) {
        c = s.charCodeAt(i);
        if (c === 34) out += '\\"';
        else if (c === 92) out += '\\\\';
        else if (c < 32) out += '\\u' + ('0000' + c.toString(16)).slice(-4);
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (d = s.charCodeAt(i + 1)) >= 0xDC00 && d <= 0xDFFF) {
            out += s.charAt(i) + s.charAt(i + 1);
            i++;
        } else if (c >= 0xD800 && c <= 0xDFFF) out += '\\u' + c.toString(16);
        else out += s.charAt(i);
    }
    return out + '"';
}

function viewCodec_valueJson(kind, v) {
    var parts = [], names, i;
    if (kind === 'weeks') return String(v);
    if (kind === 'list') {
        for (i = 0; i < v.length; i++) parts.push(viewCodec_jsonString(v[i]));
        return '[' + parts.join(',') + ']';
    }
    if (kind === 'map') {
        names = Object.keys(v).sort();
        for (i = 0; i < names.length; i++) parts.push(viewCodec_jsonString(names[i]) + ':' + viewCodec_jsonString(v[names[i]]));
        return '{' + parts.join(',') + '}';
    }
    return viewCodec_jsonString(v);
}

// The JSON object for a normalized state, keys in whitelist (sorted) order.
function viewCodec_stateJson(state) {
    var parts = [], i, f;
    for (i = 0; i < viewCodec_FIELDS.length; i++) {
        f = viewCodec_FIELDS[i];
        if (viewCodec_hasOwn(state, f.key)) parts.push('"' + f.key + '":' + viewCodec_valueJson(f.kind, state[f.key]));
    }
    return '{' + parts.join(',') + '}';
}

// ---- UTF-8 ---------------------------------------------------------------------------------------

function viewCodec_utf8Encode(str) {
    var out = [], i, c, d;
    for (i = 0; i < str.length; i++) {
        c = str.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
            d = str.charCodeAt(i + 1);
            if (d >= 0xDC00 && d <= 0xDFFF) {
                c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00);
                i++;
            }
        }
        if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD; // unreachable from the JSON writer above, which escapes lone surrogates
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
}

// Strict decoder: null for anything that is not well-formed UTF-8 (a stray continuation byte, a
// truncated sequence, an overlong form, a surrogate, a code point above U+10FFFF). A lenient decoder
// would turn damaged bytes into replacement characters and carry on with a view nobody wrote.
function viewCodec_utf8Decode(bytes) {
    var out = [], i = 0, n = bytes.length, b, c, need, min, j, x;
    while (i < n) {
        b = bytes[i++];
        if (b < 0x80) { out.push(String.fromCharCode(b)); continue; }
        if (b >= 0xC2 && b <= 0xDF) { need = 1; c = b & 0x1F; min = 0x80; }
        else if (b >= 0xE0 && b <= 0xEF) { need = 2; c = b & 0x0F; min = 0x800; }
        else if (b >= 0xF0 && b <= 0xF4) { need = 3; c = b & 0x07; min = 0x10000; }
        else return null;
        if (i + need > n) return null;
        for (j = 0; j < need; j++) {
            x = bytes[i++];
            if ((x & 0xC0) !== 0x80) return null;
            c = (c << 6) | (x & 0x3F);
        }
        if (c < min || c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF)) return null;
        if (c >= 0x10000) {
            c -= 0x10000;
            out.push(String.fromCharCode(0xD800 + (c >> 10), 0xDC00 + (c & 0x3FF)));
        } else {
            out.push(String.fromCharCode(c));
        }
    }
    return out.join('');
}

// ---- base64url and the check ---------------------------------------------------------------------

function viewCodec_b64Encode(bytes) {
    var out = '', n = bytes.length, i, a, b, c;
    for (i = 0; i + 2 < n; i += 3) {
        a = bytes[i]; b = bytes[i + 1]; c = bytes[i + 2];
        out += viewCodec_ALPHABET.charAt(a >> 2) + viewCodec_ALPHABET.charAt(((a & 3) << 4) | (b >> 4)) +
            viewCodec_ALPHABET.charAt(((b & 15) << 2) | (c >> 6)) + viewCodec_ALPHABET.charAt(c & 63);
    }
    if (n - i === 1) {
        a = bytes[i];
        out += viewCodec_ALPHABET.charAt(a >> 2) + viewCodec_ALPHABET.charAt((a & 3) << 4);
    } else if (n - i === 2) {
        a = bytes[i]; b = bytes[i + 1];
        out += viewCodec_ALPHABET.charAt(a >> 2) + viewCodec_ALPHABET.charAt(((a & 3) << 4) | (b >> 4)) +
            viewCodec_ALPHABET.charAt((b & 15) << 2);
    }
    return out;
}

// Bytes, or null when the text is not exactly what viewCodec_b64Encode writes: a character outside the
// alphabet, a length no byte count produces, or leftover bits that are not zero (two spellings of the
// same bytes would mean a link can be altered without changing what it says).
function viewCodec_b64Decode(text) {
    var out = [], acc = 0, bits = 0, i, v;
    if (text.length % 4 === 1) return null;
    for (i = 0; i < text.length; i++) {
        v = viewCodec_ALPHABET.indexOf(text.charAt(i));
        if (v < 0) return null;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((acc >> bits) & 255);
            acc &= (1 << bits) - 1;
        }
    }
    return acc === 0 ? out : null;
}

// CRC-24, OpenPGP parameters (polynomial 0x864CFB, initial value 0xB704CE), over the characters of
// the payload text (all ASCII by then). Standard check value: the text 123456789 gives 0x21CF02.
function viewCodec_crc24(text) {
    var crc = 0xB704CE, i, j;
    for (i = 0; i < text.length; i++) {
        crc ^= text.charCodeAt(i) << 16;
        for (j = 0; j < 8; j++) {
            crc <<= 1;
            if (crc & 0x1000000) crc ^= 0x1864CFB;
        }
    }
    return crc & 0xFFFFFF;
}

function viewCodec_check(payload) {
    var crc = viewCodec_crc24(payload);
    return viewCodec_b64Encode([(crc >> 16) & 255, (crc >> 8) & 255, crc & 255]);
}

// ---- reading a text ------------------------------------------------------------------------------

// 'v' and one to three digits: some version of this format, just not one this code reads.
function viewCodec_looksLikeVersion(prefix) {
    return prefix.length >= 2 && prefix.length <= 4 && prefix.charAt(0) === 'v' && viewCodec_digits(prefix, 1, prefix.length) >= 0;
}

// Text -> { obj } (the decoded JSON object) or { error } (a short code). The cheap tests come first, so
// 100 KB of garbage costs one length comparison and a page of base64 costs no JSON parsing.
function viewCodec_parse(text) {
    var i, c, first, second, prefix, payload, bytes, json, obj;
    if (typeof text !== 'string') return { error: 'not-a-string' };
    if (text.length === 0) return { error: 'empty' };
    if (text.length > viewCodec_MAX_ENCODED_CHARS) return { error: 'too-long' };
    for (i = 0; i < text.length; i++) {
        c = text.charCodeAt(i);
        if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c === 46)) {
            return { error: 'bad-characters' };
        }
    }
    first = text.indexOf('.');
    if (first < 0) return { error: 'bad-format' };
    prefix = text.slice(0, first);
    if (prefix !== viewCodec_VERSION) return { error: viewCodec_looksLikeVersion(prefix) ? 'unsupported-version' : 'bad-format' };
    second = text.indexOf('.', first + 1);
    if (second < 0 || text.indexOf('.', second + 1) >= 0) return { error: 'bad-format' };
    payload = text.slice(first + 1, second);
    if (payload.length === 0 || text.length - second - 1 !== 4) return { error: 'bad-format' };
    if (viewCodec_check(payload) !== text.slice(second + 1)) return { error: 'bad-checksum' };
    bytes = viewCodec_b64Decode(payload);
    if (bytes === null) return { error: 'bad-base64' };
    json = viewCodec_utf8Decode(bytes);
    if (json === null) return { error: 'bad-utf8' };
    try {
        obj = JSON.parse(json);
    } catch (e) {
        return { error: 'bad-json' };
    }
    if (!viewCodec_isPlainObject(obj)) return { error: 'not-an-object' };
    return { obj: obj };
}

// ---- public API ----------------------------------------------------------------------------------

// state -> 'v1.<payload>.<check>', or null when the view cannot be written faithfully (see the header).
BFShared.encodeView = function (state) {
    var n, payload, text;
    try {
        if (!viewCodec_isPlainObject(state)) return null;
        n = viewCodec_normalize(state, null, true);
        if (n.dropped.length > 0) return null;
        payload = viewCodec_b64Encode(viewCodec_utf8Encode(viewCodec_stateJson(n.state)));
        text = viewCodec_VERSION + '.' + payload + '.' + viewCodec_check(payload);
        return text.length > viewCodec_MAX_ENCODED_CHARS ? null : text;
    } catch (e) {
        return null;
    }
};

// text -> { state, applied, dropped, errors }.
//   state    a plain object holding only whitelisted keys, each validated (see the header)
//   applied  the keys of state, sorted
//   dropped  [{ key, value, reason }], everything that was not applied, never silently. value is a
//            string of at most 200 characters: the stale value, the offending column key, or a
//            description of a rejected value. reason is one of not-in-current-data, unknown-key,
//            forbidden-key, invalid-key, wrong-type, too-long, too-many-items, too-many-keys,
//            invalid-value
//   errors   [code]: the text as a whole was refused and state is {}. Codes: not-a-string, empty,
//            too-long, bad-characters, bad-format, unsupported-version, bad-checksum, bad-base64,
//            bad-utf8, bad-json, not-an-object
// Never throws. internal-error is a safety net that a test pins as never happening.
BFShared.decodeView = function (text, validSets) {
    var parsed, n;
    try {
        parsed = viewCodec_parse(text);
        if (parsed.error) return { state: {}, applied: [], dropped: [], errors: [parsed.error] };
        n = viewCodec_normalize(parsed.obj, validSets, false);
        return { state: n.state, applied: Object.keys(n.state).sort(), dropped: n.dropped, errors: [] };
    } catch (e) {
        return { state: {}, applied: [], dropped: [], errors: ['internal-error'] };
    }
};

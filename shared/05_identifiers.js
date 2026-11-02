// Identifiers shared by the app, Apps Script and (by copy) VPT (Phase 2, slice 2a-1; D4). Pure functions:
//   BFShared.makePortKey(pol, seq)                 -> 'USNYC#2', or '' when either part is unusable
//   BFShared.parsePortKey(key)                 -> { pol, seq } or null
//   BFShared.buildLaneMap(rows)                -> { entries: [...] }  (the lane map, from parsed Space_Analyst rows)
//   BFShared.laneRevenueLanes(laneMap, lane)   -> sorted revenue lanes a service lane sells under ([] when unknown)
//   BFShared.revenueLaneServices(laneMap, rl)  -> sorted service lanes that sell under a revenue lane ([] when unknown)
//   BFShared.parsePic(text)                    -> { blank, halves, kinds, owned, team, unownedReasons }
// A VVD is normalised with BFShared.normalizeVvd (shared/00_core.js); it is not redefined here.
//
// PORT KEY. 'PORT#SEQ': the port (POL) code trimmed and upper-cased, a hash, and the calling-port sequence as plain digits
// (a number 2, the text ' 2 ' and the text '02' are all '2'). A sailing-port is a VVD plus this key. A port that is
// blank or contains a hash, or a sequence that is not a whole number from 0 up, gives '' so a caller can test for a bad key.
// parsePortKey is the inverse: it splits at the hash and answers null for anything makePortKey would not have made.
//
// LANE MAP. The map is DATA, never a formula: the revenue lane is the service lane plus a trade suffix (AL2 sells as
// AL2TA, EC4 as EC4TP) only because the Space_Analyst tab says so, and some lanes appear twice (EXE, once per direction). The
// input rows are the parsed tab, keys exactly Lane, Dir, Trade, Sub_Trade, Region, Analyst, Revenue_Lane, IB_DIR, Notes
// (cell values are strings or numbers; anything else reads as blank). A row with a blank Lane or a blank Revenue_Lane is
// skipped (the tab ends with an analyst-only line). Lane and Revenue_Lane are trimmed and upper-cased; the other fields are
// trimmed. Entries keep the tab's order. The relation is many-to-many in principle (one service can sell under two revenue
// lanes, and several services can share one revenue lane), so both lookups answer with a sorted list of distinct names. A
// non-array input, or a non-object row, gives an empty map. Lookups of a bad map or a non-string lane give [].
//
// PIC. 'MCT PIC' is two names joined by a slash, 'SPC / MKG'. parsePic splits the text at every slash, trims each half and
// collapses inner white space. Per half (case-insensitive) the kind is: 'blank' (nothing), 'tba' (TBA), 'resid' (Resid, who
// left the team), 'team' (EC SPC or WC SPC, the team accounts) or 'person' (anything else). D4: blank, TBA and Resid mean
// unowned; EC SPC and WC SPC mean the team. A text that is blank altogether has halves [] and kinds [].
//   owned           true when at least one half is a person or the team. 'TBA / Bob' is owned (Bob has it); 'TBA / TBA' and ''
//                   are not. (This is the roadmap 3.1 reading: sailing GJMT0003W leaves its unowned streak the day its PIC
//                   becomes 'TBA / Bob'.)
//   team            true when at least one half is a team account.
//   blank           true when the whole text is blank (no PIC text at all).
//   unownedReasons  one entry per half that is not a person or the team, in order: 'blank', 'tba' or 'resid'; ['blank'] for
//                   a PIC that is blank altogether. It is filled even when owned is true, so a caller can show 'TBA / Bob'
//                   as half-assigned.
// Only a string or a finite number is text; anything else (null, an object that String() would throw on) is blank.
// None of them reads a clock or any global but the ES5 built-ins; none throws.

function identifiers_text(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return '';
}

function identifiers_trim(s) {
    return s.replace(/^\s+|\s+$/g, '');
}

function identifiers_isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
}

function identifiers_stripZeros(s) {
    return s.replace(/^0+(?=\d)/, '');
}

BFShared.makePortKey = function (pol, seq) {
    var p = BFShared.normalizeVvd(identifiers_text(pol));
    var s;
    if (typeof seq === 'number') s = (isFinite(seq) && seq >= 0 && Math.floor(seq) === seq) ? String(seq) : '';
    else s = identifiers_trim(identifiers_text(seq));
    if (p === '' || p.indexOf('#') !== -1) return '';
    if (!/^\d+$/.test(s)) return '';
    return p + '#' + identifiers_stripZeros(s);
};

BFShared.parsePortKey = function (key) {
    var m;
    if (typeof key !== 'string') return null;
    m = /^([^#]+)#(\d+)$/.exec(key);
    if (!m || m[1] !== BFShared.normalizeVvd(m[1]) || m[2] !== identifiers_stripZeros(m[2])) return null;
    return { pol: m[1], seq: m[2] };
};

BFShared.buildLaneMap = function (rows) {
    var entries = [];
    var i, r, lane, rev;
    function field(k) { return identifiers_trim(identifiers_text(r[k])); }
    if (!Array.isArray(rows)) return { entries: entries };
    for (i = 0; i < rows.length; i++) {
        r = rows[i];
        if (!identifiers_isObject(r)) continue;
        lane = field('Lane').toUpperCase();
        rev = field('Revenue_Lane').toUpperCase();
        if (lane === '' || rev === '') continue;
        entries.push({
            lane: lane, dir: field('Dir'), trade: field('Trade'), subTrade: field('Sub_Trade'), region: field('Region'),
            analyst: field('Analyst'), revenueLane: rev, ibDir: field('IB_DIR'), notes: field('Notes')
        });
    }
    return { entries: entries };
};

// The distinct values of the `out` field for the entries whose `by` field equals the wanted name, sorted.
function identifiers_lookup(laneMap, name, by, out) {
    var seen = {};
    var list = [];
    var want, i, e, v;
    if (!identifiers_isObject(laneMap) || !Array.isArray(laneMap.entries) || typeof name !== 'string') return list;
    want = identifiers_trim(name).toUpperCase();
    if (want === '') return list;
    for (i = 0; i < laneMap.entries.length; i++) {
        e = laneMap.entries[i];
        if (!identifiers_isObject(e) || e[by] !== want) continue;
        v = e[out];
        if (typeof v !== 'string' || v === '' || Object.prototype.hasOwnProperty.call(seen, 'k' + v)) continue;
        seen['k' + v] = true;
        list.push(v);
    }
    list.sort();
    return list;
}

BFShared.laneRevenueLanes = function (laneMap, lane) {
    return identifiers_lookup(laneMap, lane, 'lane', 'revenueLane');
};

BFShared.revenueLaneServices = function (laneMap, revenueLane) {
    return identifiers_lookup(laneMap, revenueLane, 'revenueLane', 'lane');
};

function identifiers_kind(half) {
    var key = half.toUpperCase();
    if (key === '') return 'blank';
    if (key === 'TBA') return 'tba';
    if (key === 'RESID') return 'resid';
    if (key === 'EC SPC' || key === 'WC SPC') return 'team';
    return 'person';
}

BFShared.parsePic = function (text) {
    var raw = identifiers_trim(identifiers_text(text));
    var halves = [];
    var kinds = [];
    var reasons = [];
    var owned = false;
    var team = false;
    var parts, i, k;
    if (raw === '') return { blank: true, halves: halves, kinds: kinds, owned: false, team: false, unownedReasons: ['blank'] };
    parts = raw.split('/');
    for (i = 0; i < parts.length; i++) {
        halves.push(identifiers_trim(parts[i]).replace(/\s+/g, ' '));
        k = identifiers_kind(halves[i]);
        kinds.push(k);
        if (k === 'person' || k === 'team') owned = true; else reasons.push(k);
        if (k === 'team') team = true;
    }
    return { blank: false, halves: halves, kinds: kinds, owned: owned, team: team, unownedReasons: reasons };
};

// GENERATED FILE -- DO NOT EDIT.
// Written by scripts/sync_shared.js from the files in shared/. Edit those, then run:
//     node scripts/sync_shared.js
// `node scripts/sync_shared.js --check` (part of CI) fails while this file is stale.
// Comments are stripped from the code below (the commented source is shared/); see the files there.
// Defines the single global BFShared. Apps Script loads this file at startup, so another .gs
// file must use BFShared only inside functions that run later, never in its own top-level code.
var BFShared = function () {
  'use strict';

  var BFShared = {};
  BFShared.API_VERSION = 1;
  BFShared.normalizeVvd = function (v) {
    return String(v == null ? '' : v).trim().toUpperCase();
  };
  BFShared.isRealVvd = function (v) {
    if (typeof v !== 'string') return false;
    var n = BFShared.normalizeVvd(v);
    return n !== '' && n !== 'VMS';
  };
  ;
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
    if (typeof seq === 'number') s = isFinite(seq) && seq >= 0 && Math.floor(seq) === seq ? String(seq) : '';else s = identifiers_trim(identifiers_text(seq));
    if (p === '' || p.indexOf('#') !== -1) return '';
    if (!/^\d+$/.test(s)) return '';
    return p + '#' + identifiers_stripZeros(s);
  };
  BFShared.parsePortKey = function (key) {
    var m;
    if (typeof key !== 'string') return null;
    m = /^([^#]+)#(\d+)$/.exec(key);
    if (!m || m[1] !== BFShared.normalizeVvd(m[1]) || m[2] !== identifiers_stripZeros(m[2])) return null;
    return {
      pol: m[1],
      seq: m[2]
    };
  };
  BFShared.buildLaneMap = function (rows) {
    var entries = [];
    var i, r, lane, rev;
    function field(k) {
      return identifiers_trim(identifiers_text(r[k]));
    }
    if (!Array.isArray(rows)) return {
      entries: entries
    };
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!identifiers_isObject(r)) continue;
      lane = field('Lane').toUpperCase();
      rev = field('Revenue_Lane').toUpperCase();
      if (lane === '' || rev === '') continue;
      entries.push({
        lane: lane,
        dir: field('Dir'),
        trade: field('Trade'),
        subTrade: field('Sub_Trade'),
        region: field('Region'),
        analyst: field('Analyst'),
        revenueLane: rev,
        ibDir: field('IB_DIR'),
        notes: field('Notes')
      });
    }
    return {
      entries: entries
    };
  };
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
    if (raw === '') return {
      blank: true,
      halves: halves,
      kinds: kinds,
      owned: false,
      team: false,
      unownedReasons: ['blank']
    };
    parts = raw.split('/');
    for (i = 0; i < parts.length; i++) {
      halves.push(identifiers_trim(parts[i]).replace(/\s+/g, ' '));
      k = identifiers_kind(halves[i]);
      kinds.push(k);
      if (k === 'person' || k === 'team') owned = true;else reasons.push(k);
      if (k === 'team') team = true;
    }
    return {
      blank: false,
      halves: halves,
      kinds: kinds,
      owned: owned,
      team: team,
      unownedReasons: reasons
    };
  };
  ;
  function diffSailings_num(v) {
    var s, negative, percent, n;
    if (typeof v === 'number') return isFinite(v) ? v + 0 : null;
    if (typeof v !== 'string') return null;
    s = v.trim();
    if (s === '') return null;
    negative = false;
    if (/^\(.*\)$/.test(s)) {
      negative = true;
      s = s.slice(1, -1).trim();
    }
    percent = false;
    if (s.charAt(s.length - 1) === '%') {
      percent = true;
      s = s.slice(0, -1).trim();
    }
    if (s.indexOf(',') !== -1) {
      if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
      s = s.replace(/,/g, '');
    }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    n = Number(s);
    if (!isFinite(n)) return null;
    if (percent) n = n / 100;
    if (negative && n > 0) n = -n;
    return n + 0;
  }
  function diffSailings_text(v) {
    return String(v == null ? '' : v).trim();
  }
  function diffSailings_clean(x) {
    if (x === null) return null;
    if (Math.abs(x) < 1e6) x = Math.round(x * 1e9) / 1e9;
    return x + 0;
  }
  function diffSailings_cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function diffSailings_day(rows) {
    var map = Object.create(null);
    var order = [];
    var weeks = Object.create(null);
    var i, r, vvd, g, lane, week, laden, booking, util;
    if (!Array.isArray(rows)) rows = [];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (r == null) continue;
      vvd = BFShared.normalizeVvd(r.vvd);
      if (!BFShared.isRealVvd(vvd)) continue;
      lane = diffSailings_text(r.lane);
      week = diffSailings_text(r.saleWeek);
      laden = diffSailings_num(r.laden);
      booking = diffSailings_num(r.booking);
      util = diffSailings_num(r.util);
      if (week !== '') weeks[week] = true;
      g = map[vvd];
      if (!g) {
        g = {
          vvd: vvd,
          lane: '',
          saleWeek: '',
          laden: null,
          booking: null,
          util: null,
          bookingConflict: false,
          firstBooking: booking
        };
        map[vvd] = g;
        order.push(vvd);
      }
      if (g.lane === '') g.lane = lane;
      if (g.saleWeek === '') g.saleWeek = week;
      if (laden !== null) g.laden = g.laden === null ? laden : g.laden + laden;
      if (booking !== null && g.booking === null) g.booking = booking;
      if (!diffSailings_same(booking, g.firstBooking)) g.bookingConflict = true;
      if (util !== null && (g.util === null || util > g.util)) g.util = util;
    }
    order.sort(diffSailings_cmp);
    for (i = 0; i < order.length; i++) {
      g = map[order[i]];
      g.laden = diffSailings_clean(g.laden);
    }
    return {
      map: map,
      order: order,
      weeks: weeks
    };
  }
  function diffSailings_view(g) {
    var o = {
      vvd: g.vvd,
      lane: g.lane,
      saleWeek: g.saleWeek,
      laden: g.laden,
      booking: g.booking
    };
    if (g.bookingConflict) o.bookingConflict = true;
    return o;
  }
  function diffSailings_delta(prev, cur) {
    if (prev === null || cur === null) return null;
    return diffSailings_clean(cur - prev);
  }
  function diffSailings_same(a, b) {
    if (a === null || b === null) return a === b;
    return diffSailings_clean(b - a) === 0;
  }
  function diffSailings_acc() {
    return {
      sum: 0,
      seen: 0,
      known: 0
    };
  }
  function diffSailings_take(acc, v) {
    acc.seen++;
    if (v !== null) {
      acc.sum += v;
      acc.known++;
    }
  }
  function diffSailings_total(acc) {
    if (acc.seen > 0 && acc.known === 0) return null;
    return diffSailings_clean(acc.sum);
  }
  function diffSailings_emptyTotals() {
    return {
      laden: {
        out: null,
        'in': null,
        arrived: null,
        continuing: null,
        net: null
      },
      booking: {
        out: null,
        'in': null,
        arrived: null,
        continuing: null,
        net: null
      }
    };
  }
  BFShared.diffSailings = function (prevRows, curRows, opts) {
    var movedTeu = 100;
    var prev = diffSailings_day(prevRows);
    var cur = diffSailings_day(curRows);
    var result = {
      noBaseline: prev.order.length === 0,
      noCurrent: cur.order.length === 0,
      prevSailings: prev.order.length,
      curSailings: cur.order.length,
      rolledOut: [],
      removed: [],
      rolledIn: [],
      arrived: [],
      changed: [],
      unchanged: 0,
      movedCount: 0,
      bookingConflicts: [],
      totals: diffSailings_emptyTotals()
    };
    var threshold = opts == null ? null : diffSailings_num(opts.movedTeu);
    var conflicts = Object.create(null);
    var fields = ['laden', 'booking'];
    var sums = {
      laden: {
        out: diffSailings_acc(),
        inn: diffSailings_acc(),
        arr: diffSailings_acc(),
        cont: diffSailings_acc()
      },
      booking: {
        out: diffSailings_acc(),
        inn: diffSailings_acc(),
        arr: diffSailings_acc(),
        cont: diffSailings_acc()
      }
    };
    var anyKnown = {
      laden: false,
      booking: false
    };
    var i, f, a, b, dl, db, du, moved, entry;
    if (threshold !== null && threshold >= 0) movedTeu = threshold;
    for (i = 0; i < prev.order.length; i++) {
      a = prev.map[prev.order[i]];
      if (a.bookingConflict) conflicts[a.vvd] = true;
      for (f = 0; f < 2; f++) if (a[fields[f]] !== null) anyKnown[fields[f]] = true;
    }
    for (i = 0; i < cur.order.length; i++) {
      b = cur.map[cur.order[i]];
      if (b.bookingConflict) conflicts[b.vvd] = true;
      for (f = 0; f < 2; f++) if (b[fields[f]] !== null) anyKnown[fields[f]] = true;
    }
    result.bookingConflicts = Object.keys(conflicts).sort(diffSailings_cmp);
    if (result.noBaseline || result.noCurrent) return result;
    for (i = 0; i < prev.order.length; i++) {
      a = prev.map[prev.order[i]];
      if (cur.map[a.vvd]) continue;
      if (a.saleWeek !== '' && !cur.weeks[a.saleWeek]) result.rolledOut.push(diffSailings_view(a));else result.removed.push(diffSailings_view(a));
      for (f = 0; f < 2; f++) diffSailings_take(sums[fields[f]].out, a[fields[f]]);
    }
    for (i = 0; i < cur.order.length; i++) {
      b = cur.map[cur.order[i]];
      a = prev.map[b.vvd];
      if (!a) {
        if (b.saleWeek !== '' && !prev.weeks[b.saleWeek]) result.rolledIn.push(diffSailings_view(b));else {
          result.arrived.push(diffSailings_view(b));
          for (f = 0; f < 2; f++) diffSailings_take(sums[fields[f]].arr, b[fields[f]]);
        }
        for (f = 0; f < 2; f++) diffSailings_take(sums[fields[f]].inn, b[fields[f]]);
        continue;
      }
      for (f = 0; f < 2; f++) {
        diffSailings_take(sums[fields[f]].cont, a[fields[f]] !== null && b[fields[f]] !== null ? b[fields[f]] - a[fields[f]] : null);
      }
      if (diffSailings_same(a.laden, b.laden) && diffSailings_same(a.booking, b.booking) && diffSailings_same(a.util, b.util)) {
        result.unchanged++;
        continue;
      }
      dl = diffSailings_delta(a.laden, b.laden);
      db = diffSailings_delta(a.booking, b.booking);
      du = diffSailings_delta(a.util, b.util);
      moved = dl !== null && dl !== 0 && Math.abs(dl) >= movedTeu;
      if (moved) result.movedCount++;
      entry = {
        vvd: b.vvd,
        lane: b.lane,
        saleWeek: b.saleWeek,
        ladenPrev: a.laden,
        ladenCur: b.laden,
        ladenDelta: dl,
        bookingPrev: a.booking,
        bookingCur: b.booking,
        bookingDelta: db,
        utilPrev: a.util,
        utilCur: b.util,
        utilDelta: du,
        moved: moved
      };
      if (a.bookingConflict || b.bookingConflict) entry.bookingConflict = true;
      result.changed.push(entry);
    }
    for (f = 0; f < 2; f++) {
      a = sums[fields[f]];
      if (!anyKnown[fields[f]]) continue;
      result.totals[fields[f]] = {
        out: diffSailings_total(a.out),
        'in': diffSailings_total(a.inn),
        arrived: diffSailings_total(a.arr),
        continuing: diffSailings_total(a.cont),
        net: a.out.known + a.inn.known + a.cont.known === 0 ? null : diffSailings_clean(a.inn.sum - a.out.sum + a.cont.sum)
      };
    }
    return result;
  };
  ;
  var checkFeed_DEFAULT_KEYS = ['Vessel 1st VVD', 'Route Location Calling Port Seq', 'Route Location 1st Pol'];
  var checkFeed_DEFAULT_VOYAGE_FIELDS = ['MCT PIC', 'Vessel 1st Lane', 'MCT Max Laden', 'Route Date Cut/off Date', 'Route Date 1st Sale Week'];
  var checkFeed_DEFAULT_VVD_COLUMN = 'Vessel 1st VVD';
  var checkFeed_DEFAULT_MAX_DROP_PCT = 10;
  var checkFeed_DEFAULT_REQUIRED = [{
    key: 'Measures Laden TEU',
    aliases: ['Measures Laden TEU']
  }, {
    key: 'Measures Total Booking TEU by Service',
    aliases: ['Measures Total Booking TEU by Service']
  }, {
    key: 'Measures POL Booking Utilz',
    aliases: ['Measures POL Booking Utilz', 'POL Booking Utilz']
  }];
  var checkFeed_MAX_EXAMPLES = 5;
  var checkFeed_MAX_VALUES = 10;
  var checkFeed_MAX_VVDS = 25;
  function checkFeed_clean(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function checkFeed_text(v) {
    if (typeof v === 'string') return v.trim();
    return v === null || v === undefined ? '' : String(v).trim();
  }
  function checkFeed_isObject(x) {
    return Object(x) === x && typeof x !== 'function';
  }
  function checkFeed_problem(code, message, detail) {
    return {
      code: code,
      message: message,
      detail: detail
    };
  }
  function checkFeed_badInput(what, message, extra) {
    var detail = {
      what: what
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) detail[k] = extra[k];
      }
    }
    return checkFeed_problem('BAD_INPUT', message, detail);
  }
  function checkFeed_errorText(e) {
    try {
      return String(e && e.message);
    } catch (e2) {
      return 'unreadable error';
    }
  }
  function checkFeed_plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }
  function checkFeed_show(v) {
    return v === '' ? '(blank)' : '"' + v + '"';
  }
  function checkFeed_nameList(value, fallback, what, bad) {
    if (value === undefined || value === null) return fallback;
    if (Array.isArray(value) && value.length > 0) {
      var usable = true;
      for (var i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string' || checkFeed_clean(value[i]) === '') usable = false;
      }
      if (usable) return value;
    }
    bad.push(checkFeed_badInput(what, what + ' must be a non-empty list of non-blank column names; the default list was used instead'));
    return fallback;
  }
  function checkFeed_readRequired(value, bad) {
    var out = [];
    if (value === undefined || value === null) {
      for (var d = 0; d < checkFeed_DEFAULT_REQUIRED.length; d++) out.push({
        key: checkFeed_DEFAULT_REQUIRED[d].key,
        aliases: checkFeed_DEFAULT_REQUIRED[d].aliases.slice()
      });
      return out;
    }
    if (!Array.isArray(value)) {
      bad.push(checkFeed_badInput('requiredFields', 'requiredFields must be a list of { key, aliases } entries'));
      return out;
    }
    var badAt = [];
    for (var i = 0; i < value.length; i++) {
      var f = value[i];
      var usable = checkFeed_isObject(f) && Array.isArray(f.aliases) && f.aliases.length > 0;
      for (var j = 0; usable && j < f.aliases.length; j++) {
        if (typeof f.aliases[j] !== 'string' || checkFeed_clean(f.aliases[j]) === '') usable = false;
      }
      if (!usable) {
        badAt.push(i);
        continue;
      }
      var key = f.key === undefined || f.key === null || f.key === '' ? f.aliases[0] : String(f.key);
      out.push({
        key: key,
        aliases: f.aliases.slice()
      });
    }
    if (badAt.length) {
      bad.push(checkFeed_badInput('requiredFields', 'requiredFields entries at position(s) ' + badAt.join(', ') + ' need a non-empty list of non-blank text aliases; they were skipped', {
        positions: badAt
      }));
    }
    return out;
  }
  function checkFeed_readerKeys(headers) {
    var taken = {};
    var keys = [];
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      var v = h === null || h === undefined || h === '' ? '__EMPTY' : String(h);
      var key = v;
      var count = taken['k' + v] || 0;
      if (!count) {
        taken['k' + v] = 1;
      } else {
        do {
          key = v + '_' + count++;
        } while (taken['k' + key]);
        taken['k' + v] = count;
        taken['k' + key] = 1;
      }
      keys.push(key);
    }
    return keys;
  }
  function checkFeed_indexHeaders(headers) {
    var keys = checkFeed_readerKeys(headers);
    var read = {};
    var groups = {};
    var order = [];
    for (var i = 0; i < headers.length; i++) {
      var rc = checkFeed_clean(keys[i]);
      if (rc !== '') read['k' + rc] = i;
      var c = checkFeed_clean(headers[i]);
      if (c === '') continue;
      var k = 'k' + c;
      if (groups[k] === undefined) {
        groups[k] = [i];
        order.push(c);
      } else groups[k].push(i);
    }
    return {
      read: read,
      keys: keys,
      groups: groups,
      order: order
    };
  }
  function checkFeed_duplicateHeader(index, headers, cleaned, members) {
    var names = [];
    for (var m = 0; m < members.length; m++) names.push(String(headers[members[m]]));
    var at = index.read['k' + cleaned];
    var which = at === members[0] ? 'the first one' : at === members[members.length - 1] ? 'the last one' : 'column ' + at;
    var shown = members.indexOf(at) === -1 ? members.concat([at]).sort(function (a, b) {
      return a - b;
    }) : members;
    var renamed = [];
    for (m = 0; m < shown.length; m++) {
      var text = String(headers[shown[m]]);
      if (index.keys[shown[m]] !== text) renamed.push(checkFeed_show(text) + ' in column ' + shown[m] + ' is read as "' + index.keys[shown[m]] + '"');
    }
    return checkFeed_problem('DUPLICATE_HEADER', 'Columns ' + members.join(', ') + ' (' + names.map(checkFeed_show).join(', ') + ') are the same name once case, spaces and punctuation are ignored; the app reads ' + which + (renamed.length ? ' (the spreadsheet reader renames an exact repeat of a header: ' + renamed.join(', ') + ')' : ''), {
      cleaned: cleaned,
      headers: names,
      indexes: members,
      readIndex: at
    });
  }
  function checkFeed_findColumn(index, wanted) {
    var c = checkFeed_clean(wanted);
    if (c === '') return null;
    var at = index.read['k' + c];
    if (at === undefined) return null;
    var name = index.keys[at];
    return {
      idx: at,
      name: name,
      wanted: wanted,
      inherited: name in Object.prototype
    };
  }
  function checkFeed_cell(row, isArray, col) {
    if (isArray) return row[col.idx];
    if (col.inherited) return Object.prototype.hasOwnProperty.call(row, col.name) ? row[col.name] : undefined;
    return row[col.name];
  }
  function checkFeed_keyPart(row, isArray, col, vvdCol) {
    var part = checkFeed_text(checkFeed_cell(row, isArray, col));
    return col.idx === vvdCol.idx ? BFShared.normalizeVvd(part) : part;
  }
  function checkFeed_breakdown(rows, rec, col, atCols) {
    var out = [];
    var byValue = {};
    for (var i = 0; i < rec.rows.length; i++) {
      var row = rows[rec.rows[i]];
      var isArray = Array.isArray(row);
      var v = checkFeed_text(checkFeed_cell(row, isArray, col));
      var b = byValue['k' + v];
      if (b === undefined) {
        if (out.length >= checkFeed_MAX_VALUES) continue;
        b = {
          value: v,
          rowCount: 0,
          at: []
        };
        byValue['k' + v] = b;
        out.push(b);
      }
      b.rowCount++;
      if (atCols.length > 0 && b.at.length < checkFeed_MAX_VALUES) {
        var parts = [];
        for (var j = 0; j < atCols.length; j++) parts.push(checkFeed_text(checkFeed_cell(row, isArray, atCols[j])));
        b.at.push(parts);
      }
    }
    return out;
  }
  function checkFeed_scanRows(rows, vvdCol, keyCols, voyageCols) {
    var real = 0;
    var badRows = 0;
    var firstBadRow = -1;
    var firstSeen = {};
    var dupAt = {};
    var dups = [];
    var extraRows = 0;
    var voyageAt = {};
    var voyages = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!checkFeed_isObject(row)) {
        if (badRows === 0) firstBadRow = i;
        badRows++;
        continue;
      }
      var isArray = Array.isArray(row);
      var vvd = checkFeed_text(checkFeed_cell(row, isArray, vvdCol));
      if (!BFShared.isRealVvd(vvd)) continue;
      real++;
      var vvdKey = BFShared.normalizeVvd(vvd);
      var j;
      if (keyCols.length > 0) {
        var fk = 'k';
        for (j = 0; j < keyCols.length; j++) {
          var part = checkFeed_keyPart(row, isArray, keyCols[j], vvdCol);
          fk += part.length + ':' + part + '|';
        }
        if (firstSeen[fk] === undefined) {
          firstSeen[fk] = i;
        } else {
          extraRows++;
          var di = dupAt[fk];
          if (di === undefined) {
            var parts = [];
            for (j = 0; j < keyCols.length; j++) parts.push(checkFeed_keyPart(row, isArray, keyCols[j], vvdCol));
            dupAt[fk] = dups.length;
            dups.push({
              key: parts,
              count: 2,
              rowIndexes: [firstSeen[fk], i]
            });
          } else {
            dups[di].count++;
            if (dups[di].rowIndexes.length < checkFeed_MAX_EXAMPLES) dups[di].rowIndexes.push(i);
          }
        }
      }
      if (voyageCols.length > 0) {
        var vk = 'k' + vvdKey;
        var rec = voyageAt[vk];
        if (rec === undefined) {
          rec = {
            vvd: vvdKey,
            first: [],
            extra: [],
            rows: []
          };
          for (j = 0; j < voyageCols.length; j++) {
            rec.first.push(checkFeed_text(checkFeed_cell(row, isArray, voyageCols[j])));
            rec.extra.push(null);
          }
          voyageAt[vk] = rec;
          voyages.push(rec);
        } else {
          for (j = 0; j < voyageCols.length; j++) {
            var v = checkFeed_text(checkFeed_cell(row, isArray, voyageCols[j]));
            if (v === rec.first[j]) continue;
            var ex = rec.extra[j];
            if (ex === null) {
              ex = {
                list: [rec.first[j]],
                seen: {}
              };
              ex.seen['k' + rec.first[j]] = true;
              rec.extra[j] = ex;
            }
            if (ex.seen['k' + v] === undefined) {
              ex.seen['k' + v] = true;
              ex.list.push(v);
            }
          }
        }
        rec.rows.push(i);
      }
    }
    return {
      real: real,
      badRows: badRows,
      firstBadRow: firstBadRow,
      dups: dups,
      extraRows: extraRows,
      voyages: voyages
    };
  }
  function checkFeed_run(input) {
    var lists = {
      bad: [],
      headers: [],
      missing: [],
      rows: [],
      drop: [],
      jump: [],
      realDrop: [],
      realJump: [],
      dup: [],
      voyage: []
    };
    var stats = {
      rowCount: 0,
      realRowCount: null,
      headerCount: 0
    };
    var finish = function () {
      var problems = [].concat(lists.bad, lists.headers, lists.missing, lists.rows, lists.drop, lists.jump, lists.realDrop, lists.realJump, lists.dup, lists.voyage);
      return {
        ok: problems.length === 0,
        problems: problems,
        stats: stats
      };
    };
    if (!checkFeed_isObject(input)) {
      lists.bad.push(checkFeed_badInput('input', 'checkFeed needs an object like { headers, rows, requiredFields }'));
      return finish();
    }
    var headers = input.headers;
    var rows = input.rows;
    var headersOk = Array.isArray(headers);
    var rowsOk = Array.isArray(rows);
    if (headersOk) stats.headerCount = headers.length;else lists.bad.push(checkFeed_badInput('headers', 'headers must be a list of column names'));
    if (rowsOk) stats.rowCount = rows.length;else lists.bad.push(checkFeed_badInput('rows', 'rows must be a list of row objects (or row arrays)'));
    var keyNames = checkFeed_nameList(input.keyColumns, checkFeed_DEFAULT_KEYS, 'keyColumns', lists.bad);
    var voyageNames = checkFeed_nameList(input.voyageFields, checkFeed_DEFAULT_VOYAGE_FIELDS, 'voyageFields', lists.bad);
    var vvdName = input.vvdColumn;
    if (vvdName === undefined || vvdName === null) vvdName = checkFeed_DEFAULT_VVD_COLUMN;else if (typeof vvdName !== 'string' || checkFeed_clean(vvdName) === '') {
      lists.bad.push(checkFeed_badInput('vvdColumn', 'vvdColumn must be a non-blank column name; the default was used instead'));
      vvdName = checkFeed_DEFAULT_VVD_COLUMN;
    }
    var required = checkFeed_readRequired(input.requiredFields, lists.bad);
    var prev = input.prevRowCount;
    if (prev === undefined || prev === null) prev = null;else if (typeof prev !== 'number' || !isFinite(prev) || prev < 0) {
      lists.bad.push(checkFeed_badInput('prevRowCount', 'prevRowCount must be a number of rows (0 or more) or null; no row-count comparison was made'));
      prev = null;
    }
    var prevReal = input.prevRealRowCount;
    if (prevReal === undefined || prevReal === null) prevReal = null;else if (typeof prevReal !== 'number' || !isFinite(prevReal) || prevReal < 0) {
      lists.bad.push(checkFeed_badInput('prevRealRowCount', 'prevRealRowCount must be a number of real rows (0 or more) or null; no real-row-count comparison was made'));
      prevReal = null;
    }
    var maxDrop = input.maxRowDropPct;
    if (maxDrop === undefined || maxDrop === null) maxDrop = checkFeed_DEFAULT_MAX_DROP_PCT;else if (typeof maxDrop !== 'number' || !isFinite(maxDrop) || maxDrop < 0) {
      lists.bad.push(checkFeed_badInput('maxRowDropPct', 'maxRowDropPct must be a percentage (0 or more); the default of ' + checkFeed_DEFAULT_MAX_DROP_PCT + ' was used instead'));
      maxDrop = checkFeed_DEFAULT_MAX_DROP_PCT;
    }
    var vvdCol = null;
    var keyCols = [];
    var keyUsable = false;
    var voyageCols = [];
    if (headersOk) {
      var index = checkFeed_indexHeaders(headers);
      for (var g = 0; g < index.order.length; g++) {
        var members = index.groups['k' + index.order[g]];
        if (members.length >= 2) lists.headers.push(checkFeed_duplicateHeader(index, headers, index.order[g], members));
      }
      var reported = {};
      var reportMissing = function (key, aliases, role) {
        lists.missing.push(checkFeed_problem('MISSING_FIELD', (role === 'required' ? 'Required field "' + key + '"' : 'The ' + role + ' column "' + key + '"') + ' matches no column in the feed (looked for: ' + aliases.join(', ') + ')', {
          key: key,
          aliases: aliases,
          role: role
        }));
      };
      for (var r = 0; r < required.length; r++) {
        var found = false;
        for (var a = 0; a < required[r].aliases.length; a++) {
          var ca = checkFeed_clean(required[r].aliases[a]);
          if (ca !== '' && index.read['k' + ca] !== undefined) found = true;
        }
        if (found) continue;
        for (a = 0; a < required[r].aliases.length; a++) reported['k' + checkFeed_clean(required[r].aliases[a])] = true;
        reportMissing(required[r].key, required[r].aliases.slice(), 'required');
      }
      var need = function (name, role) {
        var col = checkFeed_findColumn(index, name);
        if (col === null && reported['k' + checkFeed_clean(name)] === undefined) {
          reported['k' + checkFeed_clean(name)] = true;
          reportMissing(name, [name], role);
        }
        return col;
      };
      vvdCol = need(vvdName, 'vvd');
      keyUsable = true;
      for (var q = 0; q < keyNames.length; q++) {
        var kc = need(keyNames[q], 'key');
        if (kc === null) keyUsable = false;else keyCols.push(kc);
      }
      if (!keyUsable) keyCols = [];
      for (q = 0; q < voyageNames.length; q++) {
        var vc = need(voyageNames[q], 'voyage');
        if (vc !== null) voyageCols.push(vc);
      }
    }
    var scan = null;
    if (headersOk && rowsOk && vvdCol !== null) {
      scan = checkFeed_scanRows(rows, vvdCol, keyCols, voyageCols);
      stats.realRowCount = scan.real;
      if (scan.badRows > 0) {
        lists.bad.push(checkFeed_badInput('rows', checkFeed_plural(scan.badRows, 'row is', 'rows are') + ' not an object or array (first at position ' + scan.firstBadRow + '); skipped', {
          badRowCount: scan.badRows,
          firstBadRowIndex: scan.firstBadRow
        }));
      }
    }
    if (rowsOk) {
      if (rows.length === 0) {
        lists.rows.push(checkFeed_problem('NO_ROWS', 'The feed has no data rows', {
          rowCount: 0
        }));
      } else if (scan !== null && scan.real === 0) {
        lists.rows.push(checkFeed_problem('NO_REAL_ROWS', 'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ' but every one is a placeholder (blank or VMS vessel/voyage), so it holds no real sailing', {
          rowCount: rows.length,
          vvdColumn: vvdName
        }));
      }
      if (prev !== null && prev > 0 && (prev - rows.length) * 100 > maxDrop * prev) {
        var dropPct = Math.round((prev - rows.length) / prev * 10000) / 100;
        lists.drop.push(checkFeed_problem('ROW_COUNT_DROP', 'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ', down from ' + prev + ' (a ' + dropPct + '% drop; the limit is ' + maxDrop + '%)', {
          rowCount: rows.length,
          prevRowCount: prev,
          dropPct: dropPct,
          maxRowDropPct: maxDrop
        }));
      }
      if (prev !== null && prev > 0 && (rows.length - prev) * 100 > maxDrop * prev) {
        var risePct = Math.round((rows.length - prev) / prev * 10000) / 100;
        lists.jump.push(checkFeed_problem('ROW_COUNT_JUMP', 'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ', up from ' + prev + ' (a ' + risePct + '% rise; the limit is ' + maxDrop + '%)', {
          rowCount: rows.length,
          prevRowCount: prev,
          risePct: risePct,
          maxRowDropPct: maxDrop
        }));
      }
    }
    if (rowsOk && scan !== null && prevReal !== null && prevReal > 0 && scan.real > 0) {
      var realNow = scan.real;
      var realWord = checkFeed_plural(realNow, 'real row', 'real rows');
      if (lists.drop.length === 0 && (prevReal - realNow) * 100 > maxDrop * prevReal) {
        var realDropPct = Math.round((prevReal - realNow) / prevReal * 10000) / 100;
        lists.realDrop.push(checkFeed_problem('REAL_ROW_COUNT_DROP', 'The feed has ' + realWord + ' (placeholder rows left out), down from ' + prevReal + ' (a ' + realDropPct + '% drop; the limit is ' + maxDrop + '%)', {
          realRowCount: realNow,
          prevRealRowCount: prevReal,
          dropPct: realDropPct,
          maxRowDropPct: maxDrop
        }));
      }
      if (lists.jump.length === 0 && (realNow - prevReal) * 100 > maxDrop * prevReal) {
        var realRisePct = Math.round((realNow - prevReal) / prevReal * 10000) / 100;
        lists.realJump.push(checkFeed_problem('REAL_ROW_COUNT_JUMP', 'The feed has ' + realWord + ' (placeholder rows left out), up from ' + prevReal + ' (a ' + realRisePct + '% rise; the limit is ' + maxDrop + '%)', {
          realRowCount: realNow,
          prevRealRowCount: prevReal,
          risePct: realRisePct,
          maxRowDropPct: maxDrop
        }));
      }
    }
    if (scan !== null && scan.dups.length > 0) {
      var keyLabels = [];
      for (var n = 0; n < keyCols.length; n++) keyLabels.push(keyCols[n].wanted);
      var dupExamples = scan.dups.slice(0, checkFeed_MAX_EXAMPLES);
      lists.dup.push(checkFeed_problem('DUPLICATE_KEY', checkFeed_plural(scan.extraRows, 'real row repeats', 'real rows repeat') + ' an earlier row\'s key (' + keyLabels.join(' + ') + '), across ' + checkFeed_plural(scan.dups.length, 'key', 'keys') + '; for example ' + dupExamples[0].key.map(checkFeed_show).join(' + ') + ' appears ' + dupExamples[0].count + ' times', {
        keyColumns: keyLabels,
        duplicateKeyCount: scan.dups.length,
        extraRows: scan.extraRows,
        examples: dupExamples
      }));
    }
    if (scan !== null && voyageCols.length > 0) {
      var voyageCount = 0;
      var pairCount = 0;
      var examples = [];
      var affected = [];
      var perColumn = [];
      var atCols = [];
      var atNames = [];
      for (var w = 0; w < keyCols.length; w++) {
        if (keyCols[w].idx === vvdCol.idx) continue;
        atCols.push(keyCols[w]);
        atNames.push(keyCols[w].wanted);
      }
      for (var z = 0; z < voyageCols.length; z++) perColumn.push(0);
      for (var x = 0; x < scan.voyages.length; x++) {
        var rec = scan.voyages[x];
        var any = false;
        for (var y = 0; y < voyageCols.length; y++) {
          if (rec.extra[y] === null) continue;
          any = true;
          pairCount++;
          perColumn[y]++;
          if (examples.length < checkFeed_MAX_EXAMPLES) {
            examples.push({
              vvd: rec.vvd,
              field: voyageCols[y].wanted,
              values: rec.extra[y].list.slice(0, checkFeed_MAX_VALUES),
              valueCount: rec.extra[y].list.length,
              rowCount: rec.rows.length,
              breakdown: checkFeed_breakdown(rows, rec, voyageCols[y], atCols)
            });
          }
        }
        if (any) {
          voyageCount++;
          if (affected.length < checkFeed_MAX_VVDS) affected.push(rec.vvd);
        }
      }
      if (voyageCount > 0) {
        var columns = [];
        for (var c = 0; c < voyageCols.length; c++) {
          if (perColumn[c] > 0) columns.push({
            field: voyageCols[c].wanted,
            voyageCount: perColumn[c]
          });
        }
        lists.voyage.push(checkFeed_problem('VOYAGE_DISAGREEMENT', checkFeed_plural(voyageCount, 'voyage carries', 'voyages carry') + ' different values across ' + (voyageCount === 1 ? 'its' : 'their') + ' port rows in a voyage-level column; for example VVD ' + examples[0].vvd + ', ' + examples[0].field + ': ' + examples[0].values.map(checkFeed_show).join(' vs '), {
          voyageCount: voyageCount,
          pairCount: pairCount,
          examples: examples,
          columns: columns,
          vvds: affected,
          atColumns: atNames
        }));
      }
    }
    return finish();
  }
  BFShared.checkFeed = function (input) {
    try {
      return checkFeed_run(input);
    } catch (e) {
      return {
        ok: false,
        problems: [checkFeed_badInput('exception', 'checkFeed could not read its input without an error', {
          error: checkFeed_errorText(e)
        })],
        stats: {
          rowCount: 0,
          realRowCount: null,
          headerCount: 0
        }
      };
    }
  };
  ;
  var viewCodec_MAX_ENCODED_CHARS = 4000;
  var viewCodec_MAX_ARRAY_ITEMS = 200;
  var viewCodec_MAX_STRING_CHARS = 200;
  var viewCodec_MAX_HEADER_FILTER_KEYS = 40;
  var viewCodec_MAX_COLUMN_KEY_CHARS = 64;
  var viewCodec_WEEKS_AHEAD_MAX = 52;
  var viewCodec_YEAR_MIN = 2000;
  var viewCodec_YEAR_MAX = 2099;
  var viewCodec_VERSION = 'v1';
  var viewCodec_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var viewCodec_TABS = ['compare', 'detail', 'pol_booking', 'sector_summary', 'trade_summary'];
  var viewCodec_HEADER_FILTER_KEYS = ['actVsBkgUtilz', 'actVsMaxLdn', 'actualMty', 'actualRot', 'apStatus', 'broken', 'bsaTeu', 'bsaWgt', 'coastalEtaVsProforma', 'coastalEtd', 'curLaden', 'curUtil', 'cutoff', 'dgTeu', 'discharge', 'etd', 'imt', 'inlandAct', 'inlandNoAct', 'inlandTotal', 'lane', 'lastCoastalEta', 'let', 'lnt', 'loadableQuant', 'loadableWgt', 'loadingStatus', 'lwt', 'maxLdn', 'maxLdnVsPolBkg', 'opIssues', 'peakPolUtilzRaw', 'peakUtil', 'pic', 'plannedMty', 'pol', 'polBkgUtilzRaw', 'polLdnThresh', 'polMaxLdn', 'portAct', 'portCut', 'portNoAct', 'portTotal', 'proformaEta', 'proformaRot', 'quote', 'remarks', 'rfrBkgPlugs', 'rfrBkgPol', 'rfrBkgTtl', 'rfrBsaPlugs', 'rfrMaxLdn', 'rfrUtiliz', 'rfrUtilizPolRaw', 'saleWeek', 'sectorRemarks', 'sgsinDryVsRfr', 'shortfall', 'standby', 'status', 'subTrade', 'tat', 'tpt', 'trade', 'vco', 'vessel', 'vslOpr', 'vvd'];
  var viewCodec_headerKeyMap = null;
  var viewCodec_FIELDS = [{
    key: 'date',
    kind: 'date',
    set: 'date'
  }, {
    key: 'headerFilters',
    kind: 'map',
    set: 'headerFilters'
  }, {
    key: 'selectedAnalysts',
    kind: 'list',
    set: 'selectedAnalysts'
  }, {
    key: 'selectedApStatuses',
    kind: 'list',
    set: 'selectedApStatuses'
  }, {
    key: 'selectedCoasts',
    kind: 'list',
    set: 'selectedCoasts'
  }, {
    key: 'selectedLanes',
    kind: 'list',
    set: 'selectedLanes'
  }, {
    key: 'selectedMktgAnalysts',
    kind: 'list',
    set: 'selectedMktgAnalysts'
  }, {
    key: 'selectedSaleWeeks',
    kind: 'list',
    set: 'selectedSaleWeeks'
  }, {
    key: 'selectedSubTrades',
    kind: 'list',
    set: 'selectedSubTrades'
  }, {
    key: 'selectedYards',
    kind: 'list',
    set: 'selectedYards'
  }, {
    key: 'tab',
    kind: 'tab',
    set: 'tabs'
  }, {
    key: 'weeksAhead',
    kind: 'weeks',
    set: null
  }, {
    key: 'yardSearchText',
    kind: 'text',
    set: null
  }];
  function viewCodec_hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }
  function viewCodec_isPlainObject(v) {
    return Object.prototype.toString.call(v) === '[object Object]';
  }
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
  function viewCodec_clip(s, max) {
    var c;
    if (s.length <= max) return s;
    s = s.slice(0, max);
    c = s.charCodeAt(s.length - 1);
    return c >= 0xD800 && c <= 0xDBFF ? s.slice(0, s.length - 1) : s;
  }
  function viewCodec_note(key, value, reason) {
    return {
      key: viewCodec_clip(key, viewCodec_MAX_COLUMN_KEY_CHARS),
      value: viewCodec_clip(value, viewCodec_MAX_STRING_CHARS),
      reason: reason
    };
  }
  function viewCodec_preview(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || v === undefined) return String(v);
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array(' + v.length + ')';
    return 'object';
  }
  function viewCodec_allowed(validSets, setName) {
    var list, map, i;
    if (setName === null || !viewCodec_isPlainObject(validSets) || !viewCodec_hasOwn(validSets, setName)) return null;
    list = validSets[setName];
    if (!Array.isArray(list) || list.length === 0) return null;
    map = {};
    for (i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string') map['$' + list[i]] = true;
    }
    return map;
  }
  function viewCodec_allows(map, value) {
    return map === null || viewCodec_hasOwn(map, '$' + value);
  }
  function viewCodec_builtinHeaderKeys() {
    var i;
    if (viewCodec_headerKeyMap === null) {
      viewCodec_headerKeyMap = {};
      for (i = 0; i < viewCodec_HEADER_FILTER_KEYS.length; i++) viewCodec_headerKeyMap['$' + viewCodec_HEADER_FILTER_KEYS[i]] = true;
    }
    return viewCodec_headerKeyMap;
  }
  function viewCodec_isBlank(v) {
    return typeof v === 'string' && v.trim() === '';
  }
  function viewCodec_digits(s, from, to) {
    var n = 0,
      i,
      c;
    for (i = from; i < to; i++) {
      c = s.charCodeAt(i);
      if (c < 48 || c > 57) return -1;
      n = n * 10 + (c - 48);
    }
    return n;
  }
  function viewCodec_isRealDate(s) {
    var y;
    if (!feedAge_isCalendarDate(s)) return false;
    y = viewCodec_digits(s, 0, 4);
    return y >= viewCodec_YEAR_MIN && y <= viewCodec_YEAR_MAX;
  }
  function viewCodec_checkList(key, v, allowed, dropped) {
    var kept = [],
      i;
    if (!Array.isArray(v)) {
      dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type'));
      return undefined;
    }
    if (v.length > viewCodec_MAX_ARRAY_ITEMS) {
      dropped.push(viewCodec_note(key, String(v.length), 'too-many-items'));
      return undefined;
    }
    for (i = 0; i < v.length; i++) {
      if (typeof v[i] !== 'string') {
        dropped.push(viewCodec_note(key, viewCodec_preview(v[i]), 'wrong-type'));
        return undefined;
      }
      if (v[i].length > viewCodec_MAX_STRING_CHARS) {
        dropped.push(viewCodec_note(key, v[i], 'too-long'));
        return undefined;
      }
    }
    for (i = 0; i < v.length; i++) {
      if (viewCodec_allows(allowed, v[i])) kept.push(v[i]);else dropped.push(viewCodec_note(key, v[i], 'not-in-current-data'));
    }
    return kept.length > 0 ? kept : undefined;
  }
  function viewCodec_checkText(key, v, dropped) {
    if (typeof v !== 'string') {
      dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type'));
      return undefined;
    }
    if (v.length > viewCodec_MAX_STRING_CHARS) {
      dropped.push(viewCodec_note(key, v, 'too-long'));
      return undefined;
    }
    return v === '' ? undefined : v;
  }
  function viewCodec_checkTab(key, v, allowed, dropped) {
    if (typeof v !== 'string') {
      dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type'));
      return undefined;
    }
    if (viewCodec_TABS.indexOf(v) < 0) {
      dropped.push(viewCodec_note(key, v, 'invalid-value'));
      return undefined;
    }
    if (!viewCodec_allows(allowed, v)) {
      dropped.push(viewCodec_note(key, v, 'not-in-current-data'));
      return undefined;
    }
    return v;
  }
  function viewCodec_checkDate(key, v, allowed, dropped) {
    if (typeof v !== 'string') {
      dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type'));
      return undefined;
    }
    if (!viewCodec_isRealDate(v)) {
      dropped.push(viewCodec_note(key, v, 'invalid-value'));
      return undefined;
    }
    if (!viewCodec_allows(allowed, v)) {
      dropped.push(viewCodec_note(key, v, 'not-in-current-data'));
      return undefined;
    }
    return v;
  }
  function viewCodec_checkWeeks(key, v, dropped) {
    if (typeof v !== 'number') {
      dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type'));
      return undefined;
    }
    if (!(v >= 1 && v <= viewCodec_WEEKS_AHEAD_MAX) || v !== Math.floor(v)) {
      dropped.push(viewCodec_note(key, String(v), 'invalid-value'));
      return undefined;
    }
    return v;
  }
  function viewCodec_isColumnKey(k) {
    var i, c;
    if (k.length === 0 || k.length > viewCodec_MAX_COLUMN_KEY_CHARS) return false;
    for (i = 0; i < k.length; i++) {
      c = k.charCodeAt(i);
      if (c >= 65 && c <= 90) continue;
      if (c >= 97 && c <= 122) continue;
      if (i > 0 && (c >= 48 && c <= 57 || c === 95)) continue;
      return false;
    }
    return true;
  }
  function viewCodec_checkMap(key, v, allowed, dropped, strict) {
    var names, nonEmpty, out, count, i, name, builtin;
    if (!viewCodec_isPlainObject(v)) {
      dropped.push(viewCodec_note(key, viewCodec_preview(v), 'wrong-type'));
      return undefined;
    }
    names = Object.keys(v).sort();
    if (strict) {
      nonEmpty = [];
      for (i = 0; i < names.length; i++) if (!viewCodec_isBlank(v[names[i]])) nonEmpty.push(names[i]);
      names = nonEmpty;
    }
    if (names.length > viewCodec_MAX_HEADER_FILTER_KEYS) {
      dropped.push(viewCodec_note(key, String(names.length), 'too-many-keys'));
      return undefined;
    }
    for (i = 0; i < names.length; i++) {
      name = names[i];
      if (viewCodec_isForbiddenKey(name) || name in Object.prototype) {
        dropped.push(viewCodec_note(key, name, 'forbidden-key'));
        return undefined;
      }
      if (!viewCodec_isColumnKey(name)) {
        dropped.push(viewCodec_note(key, name, 'invalid-key'));
        return undefined;
      }
      if (typeof v[name] !== 'string') {
        dropped.push(viewCodec_note(key, name, 'wrong-type'));
        return undefined;
      }
      if (v[name].length > viewCodec_MAX_STRING_CHARS) {
        dropped.push(viewCodec_note(key, name, 'too-long'));
        return undefined;
      }
    }
    builtin = allowed === null && !strict ? viewCodec_builtinHeaderKeys() : null;
    out = {};
    count = 0;
    for (i = 0; i < names.length; i++) {
      name = names[i];
      if (viewCodec_isBlank(v[name])) continue;
      if (builtin !== null && !viewCodec_allows(builtin, name)) {
        dropped.push(viewCodec_note(key, name, 'unknown-key'));
        continue;
      }
      if (!viewCodec_allows(allowed, name)) {
        dropped.push(viewCodec_note(key, name, 'not-in-current-data'));
        continue;
      }
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
  var viewCodec_NO_MATCH = '__NO_MATCH__';
  function viewCodec_withoutSentinel(list) {
    var out = [],
      i;
    for (i = 0; i < list.length; i++) if (list[i] !== viewCodec_NO_MATCH) out.push(list[i]);
    return out;
  }
  function viewCodec_normalize(input, validSets, strict) {
    var state = {},
      dropped = [],
      keys = Object.keys(input).sort(),
      i,
      k,
      v,
      field,
      kept;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      v = input[k];
      if (viewCodec_isForbiddenKey(k)) {
        dropped.push(viewCodec_note(k, viewCodec_preview(v), 'forbidden-key'));
        continue;
      }
      field = viewCodec_fieldFor(k);
      if (field === null) {
        if (!strict) dropped.push(viewCodec_note(k, viewCodec_preview(v), 'unknown-key'));
        continue;
      }
      if (strict && (v === undefined || v === null)) continue;
      if (strict && k === 'selectedYards' && Array.isArray(v)) v = viewCodec_withoutSentinel(v);
      kept = viewCodec_checkField(field, v, validSets, dropped, strict);
      if (kept !== undefined) state[k] = kept;
    }
    return {
      state: state,
      dropped: dropped
    };
  }
  function viewCodec_jsonString(s) {
    var out = '"',
      i,
      c,
      d;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c === 34) out += '\\"';else if (c === 92) out += '\\\\';else if (c < 32) out += '\\u' + ('0000' + c.toString(16)).slice(-4);else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (d = s.charCodeAt(i + 1)) >= 0xDC00 && d <= 0xDFFF) {
        out += s.charAt(i) + s.charAt(i + 1);
        i++;
      } else if (c >= 0xD800 && c <= 0xDFFF) out += '\\u' + c.toString(16);else out += s.charAt(i);
    }
    return out + '"';
  }
  function viewCodec_valueJson(kind, v) {
    var parts = [],
      names,
      i;
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
  function viewCodec_stateJson(state) {
    var parts = [],
      i,
      f;
    for (i = 0; i < viewCodec_FIELDS.length; i++) {
      f = viewCodec_FIELDS[i];
      if (viewCodec_hasOwn(state, f.key)) parts.push('"' + f.key + '":' + viewCodec_valueJson(f.kind, state[f.key]));
    }
    return '{' + parts.join(',') + '}';
  }
  function viewCodec_utf8Encode(str) {
    var out = [],
      i,
      c,
      d;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        d = str.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) {
          c = 0x10000 + (c - 0xD800 << 10) + (d - 0xDC00);
          i++;
        }
      }
      if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;
      if (c < 0x80) out.push(c);else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }
  function viewCodec_utf8Decode(bytes) {
    var out = [],
      i = 0,
      n = bytes.length,
      b,
      c,
      need,
      min,
      j,
      x;
    while (i < n) {
      b = bytes[i++];
      if (b < 0x80) {
        out.push(String.fromCharCode(b));
        continue;
      }
      if (b >= 0xC2 && b <= 0xDF) {
        need = 1;
        c = b & 0x1F;
        min = 0x80;
      } else if (b >= 0xE0 && b <= 0xEF) {
        need = 2;
        c = b & 0x0F;
        min = 0x800;
      } else if (b >= 0xF0 && b <= 0xF4) {
        need = 3;
        c = b & 0x07;
        min = 0x10000;
      } else return null;
      if (i + need > n) return null;
      for (j = 0; j < need; j++) {
        x = bytes[i++];
        if ((x & 0xC0) !== 0x80) return null;
        c = c << 6 | x & 0x3F;
      }
      if (c < min || c > 0x10FFFF || c >= 0xD800 && c <= 0xDFFF) return null;
      if (c >= 0x10000) {
        c -= 0x10000;
        out.push(String.fromCharCode(0xD800 + (c >> 10), 0xDC00 + (c & 0x3FF)));
      } else {
        out.push(String.fromCharCode(c));
      }
    }
    return out.join('');
  }
  function viewCodec_b64Encode(bytes) {
    var out = '',
      n = bytes.length,
      i,
      a,
      b,
      c;
    for (i = 0; i + 2 < n; i += 3) {
      a = bytes[i];
      b = bytes[i + 1];
      c = bytes[i + 2];
      out += viewCodec_ALPHABET.charAt(a >> 2) + viewCodec_ALPHABET.charAt((a & 3) << 4 | b >> 4) + viewCodec_ALPHABET.charAt((b & 15) << 2 | c >> 6) + viewCodec_ALPHABET.charAt(c & 63);
    }
    if (n - i === 1) {
      a = bytes[i];
      out += viewCodec_ALPHABET.charAt(a >> 2) + viewCodec_ALPHABET.charAt((a & 3) << 4);
    } else if (n - i === 2) {
      a = bytes[i];
      b = bytes[i + 1];
      out += viewCodec_ALPHABET.charAt(a >> 2) + viewCodec_ALPHABET.charAt((a & 3) << 4 | b >> 4) + viewCodec_ALPHABET.charAt((b & 15) << 2);
    }
    return out;
  }
  function viewCodec_b64Decode(text) {
    var out = [],
      acc = 0,
      bits = 0,
      i,
      v;
    if (text.length % 4 === 1) return null;
    for (i = 0; i < text.length; i++) {
      v = viewCodec_ALPHABET.indexOf(text.charAt(i));
      if (v < 0) return null;
      acc = acc << 6 | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push(acc >> bits & 255);
        acc &= (1 << bits) - 1;
      }
    }
    return acc === 0 ? out : null;
  }
  function viewCodec_crc24(text) {
    var crc = 0xB704CE,
      i,
      j;
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
    return viewCodec_b64Encode([crc >> 16 & 255, crc >> 8 & 255, crc & 255]);
  }
  function viewCodec_looksLikeVersion(prefix) {
    return prefix.length >= 2 && prefix.length <= 4 && prefix.charAt(0) === 'v' && viewCodec_digits(prefix, 1, prefix.length) >= 0;
  }
  function viewCodec_parse(text) {
    var i, c, first, second, prefix, payload, bytes, json, obj;
    if (typeof text !== 'string') return {
      error: 'not-a-string'
    };
    if (text.length === 0) return {
      error: 'empty'
    };
    if (text.length > viewCodec_MAX_ENCODED_CHARS) return {
      error: 'too-long'
    };
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (!(c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 45 || c === 95 || c === 46)) {
        return {
          error: 'bad-characters'
        };
      }
    }
    first = text.indexOf('.');
    if (first < 0) return {
      error: 'bad-format'
    };
    prefix = text.slice(0, first);
    if (prefix !== viewCodec_VERSION) return {
      error: viewCodec_looksLikeVersion(prefix) ? 'unsupported-version' : 'bad-format'
    };
    second = text.indexOf('.', first + 1);
    if (second < 0 || text.indexOf('.', second + 1) >= 0) return {
      error: 'bad-format'
    };
    payload = text.slice(first + 1, second);
    if (payload.length === 0 || text.length - second - 1 !== 4) return {
      error: 'bad-format'
    };
    if (viewCodec_check(payload) !== text.slice(second + 1)) return {
      error: 'bad-checksum'
    };
    bytes = viewCodec_b64Decode(payload);
    if (bytes === null) return {
      error: 'bad-base64'
    };
    json = viewCodec_utf8Decode(bytes);
    if (json === null) return {
      error: 'bad-utf8'
    };
    try {
      obj = JSON.parse(json);
    } catch (e) {
      return {
        error: 'bad-json'
      };
    }
    if (!viewCodec_isPlainObject(obj)) return {
      error: 'not-an-object'
    };
    return {
      obj: obj
    };
  }
  function viewCodec_encode(state) {
    var n, payload, text;
    try {
      if (!viewCodec_isPlainObject(state)) return {
        text: null,
        reason: 'invalid-state'
      };
      n = viewCodec_normalize(state, null, true);
      if (n.dropped.length > 0) return {
        text: null,
        reason: 'invalid-state'
      };
      payload = viewCodec_b64Encode(viewCodec_utf8Encode(viewCodec_stateJson(n.state)));
      text = viewCodec_VERSION + '.' + payload + '.' + viewCodec_check(payload);
      if (text.length > viewCodec_MAX_ENCODED_CHARS) return {
        text: null,
        reason: 'too-long'
      };
      return {
        text: text,
        reason: null
      };
    } catch (e) {
      return {
        text: null,
        reason: 'invalid-state'
      };
    }
  }
  BFShared.encodeView = function (state) {
    return viewCodec_encode(state).text;
  };
  BFShared.encodeViewReason = function (state) {
    return viewCodec_encode(state).reason;
  };
  BFShared.decodeView = function (text, validSets) {
    var parsed, n;
    try {
      parsed = viewCodec_parse(text);
      if (parsed.error) return {
        state: {},
        applied: [],
        dropped: [],
        errors: [parsed.error]
      };
      n = viewCodec_normalize(parsed.obj, validSets, false);
      return {
        state: n.state,
        applied: Object.keys(n.state).sort(),
        dropped: n.dropped,
        errors: []
      };
    } catch (e) {
      return {
        state: {},
        applied: [],
        dropped: [],
        errors: ['internal-error']
      };
    }
  };
  ;
  var feedAge_MINUTE_MS = 60000;
  var feedAge_HOUR_MS = 3600000;
  var feedAge_DAY_MS = 86400000;
  var feedAge_DEFAULT_INTERVAL_MS = 3600000;
  var feedAge_STALE_FACTOR = 2;
  function feedAge_isAge(x) {
    return typeof x === 'number' && isFinite(x) && x >= 0;
  }
  BFShared.formatAge = function (ageMs) {
    var h, m, d;
    if (!feedAge_isAge(ageMs)) return '';
    if (ageMs < feedAge_MINUTE_MS) return 'just now';
    if (ageMs < feedAge_HOUR_MS) return Math.floor(ageMs / feedAge_MINUTE_MS) + ' min ago';
    if (ageMs < feedAge_DAY_MS) {
      h = Math.floor(ageMs / feedAge_HOUR_MS);
      m = Math.floor(ageMs % feedAge_HOUR_MS / feedAge_MINUTE_MS);
      return m === 0 ? h + ' h ago' : h + ' h ' + m + ' min ago';
    }
    d = Math.floor(ageMs / feedAge_DAY_MS);
    return d === 1 ? '1 day ago' : d + ' days ago';
  };
  BFShared.feedFreshness = function (ageMs, refreshIntervalMs) {
    var interval = typeof refreshIntervalMs === 'number' && isFinite(refreshIntervalMs) && refreshIntervalMs > 0 ? refreshIntervalMs : feedAge_DEFAULT_INTERVAL_MS;
    var staleAfterMs = feedAge_STALE_FACTOR * interval;
    var level = 'fresh';
    if (!feedAge_isAge(ageMs)) level = 'unknown';else if (ageMs > staleAfterMs) level = 'stale';
    return {
      level: level,
      staleAfterMs: staleAfterMs
    };
  };
  function feedAge_isCalendarDate(s) {
    var parts, year, month, day, february;
    if (typeof s !== 'string' || s.length !== 10) return false;
    parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!parts) return false;
    year = parseInt(parts[1], 10);
    month = parseInt(parts[2], 10);
    day = parseInt(parts[3], 10);
    if (month < 1 || month > 12 || day < 1) return false;
    february = year % 4 === 0 && year % 100 !== 0 || year % 400 === 0 ? 29 : 28;
    return day <= [31, february, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  BFShared.previousAvailableDate = function (dates, asOf) {
    var best = null;
    var i, entry;
    if (!Array.isArray(dates) || !feedAge_isCalendarDate(asOf)) return null;
    for (i = 0; i < dates.length; i++) {
      entry = dates[i];
      if (feedAge_isCalendarDate(entry) && entry < asOf && (best === null || entry > best)) best = entry;
    }
    return best;
  };
  var feedAge_AMBER_FACTOR = 1.25;
  var feedAge_RED_FACTOR = 3;
  function feedAge_cadenceText(cadenceMs) {
    var minutes;
    if (cadenceMs === feedAge_HOUR_MS) return 'hourly';
    if (cadenceMs > feedAge_HOUR_MS && cadenceMs % feedAge_HOUR_MS === 0) return 'every ' + cadenceMs / feedAge_HOUR_MS + ' h';
    minutes = Math.floor(cadenceMs / feedAge_MINUTE_MS);
    if (minutes < 1) minutes = 1;
    return 'every ' + minutes + ' min';
  }
  BFShared.freshnessLabel = function (source, ageMs, cadenceMs) {
    var name = typeof source === 'string' && source.replace(/^\s+|\s+$/g, '') !== '' ? source.replace(/^\s+|\s+$/g, '') : 'Data';
    var cadence = typeof cadenceMs === 'number' && isFinite(cadenceMs) && cadenceMs > 0 ? cadenceMs : feedAge_DEFAULT_INTERVAL_MS;
    var cadenceText = feedAge_cadenceText(cadence);
    var level = 'fresh';
    var ageText = '';
    if (!feedAge_isAge(ageMs)) level = 'unknown';else if (ageMs > feedAge_RED_FACTOR * cadence) level = 'red';else if (ageMs > feedAge_AMBER_FACTOR * cadence) level = 'amber';
    if (level !== 'unknown') ageText = BFShared.formatAge(ageMs);
    return {
      text: name + ': ' + (level === 'unknown' ? 'age unknown' : ageText) + ' (' + cadenceText + ')',
      level: level,
      cadenceText: cadenceText,
      ageText: ageText
    };
  };
  ;
  var whatChanged_DEFAULTS = {
    movedTeu: 100,
    laneDownPct: 5,
    laneDownTeu: 100,
    maxNamed: 3
  };
  function whatChanged_opt(opts, name) {
    var v = opts == null ? null : diffSailings_num(opts[name]);
    return v !== null && v >= 0 ? v : whatChanged_DEFAULTS[name];
  }
  function whatChanged_plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }
  function whatChanged_round1(x) {
    return Math.round(x * 10) / 10 + 0;
  }
  function whatChanged_byAbsDelta(a, b) {
    var d = Math.abs(b.ladenDelta) - Math.abs(a.ladenDelta);
    if (d !== 0) return d;
    return diffSailings_cmp(a.vvd, b.vvd);
  }
  function whatChanged_byPct(a, b) {
    if (a.pct !== b.pct) return a.pct - b.pct;
    return diffSailings_cmp(a.lane, b.lane);
  }
  function whatChanged_lanesDown(prev, cur, pctMin, teuMin) {
    var totals = Object.create(null);
    var lanes = [];
    var out = [];
    var i, b, a, t, drop, pct;
    for (i = 0; i < cur.order.length; i++) {
      b = cur.map[cur.order[i]];
      a = prev.map[b.vvd];
      if (!a || a.laden === null || b.laden === null || b.lane === '') continue;
      t = totals[b.lane];
      if (!t) {
        t = {
          prev: 0,
          cur: 0
        };
        totals[b.lane] = t;
        lanes.push(b.lane);
      }
      t.prev += a.laden;
      t.cur += b.laden;
    }
    for (i = 0; i < lanes.length; i++) {
      t = totals[lanes[i]];
      t.prev = diffSailings_clean(t.prev);
      t.cur = diffSailings_clean(t.cur);
      if (!(t.prev > 0)) continue;
      drop = t.prev - t.cur;
      pct = whatChanged_round1((t.cur - t.prev) / t.prev * 100);
      if (drop >= teuMin && drop / t.prev * 100 >= pctMin) {
        out.push({
          lane: lanes[i],
          ladenPrev: t.prev,
          ladenCur: t.cur,
          pct: pct
        });
      }
    }
    out.sort(whatChanged_byPct);
    return out;
  }
  BFShared.summarizeChanges = function (prevRows, curRows, opts) {
    var movedTeu = whatChanged_opt(opts, 'movedTeu');
    var maxNamed = Math.floor(whatChanged_opt(opts, 'maxNamed'));
    var diff = BFShared.diffSailings(prevRows, curRows, {
      movedTeu: movedTeu
    });
    var result = {
      comparable: !(diff.noBaseline || diff.noCurrent),
      state: 'unavailable',
      removed: [],
      moved: [],
      arrived: [],
      lanesDown: [],
      rolledOut: 0,
      rolledIn: 0,
      signature: '',
      clauses: []
    };
    var i, c, names, vvds;
    if (!result.comparable) return result;
    result.removed = diff.removed;
    result.arrived = diff.arrived;
    result.rolledOut = diff.rolledOut.length;
    result.rolledIn = diff.rolledIn.length;
    for (i = 0; i < diff.changed.length; i++) {
      c = diff.changed[i];
      if (!c.moved) continue;
      result.moved.push({
        vvd: c.vvd,
        lane: c.lane,
        saleWeek: c.saleWeek,
        ladenPrev: c.ladenPrev,
        ladenCur: c.ladenCur,
        ladenDelta: c.ladenDelta,
        utilPrev: c.utilPrev,
        utilCur: c.utilCur
      });
    }
    result.moved.sort(whatChanged_byAbsDelta);
    result.lanesDown = whatChanged_lanesDown(diffSailings_day(prevRows), diffSailings_day(curRows), whatChanged_opt(opts, 'laneDownPct'), whatChanged_opt(opts, 'laneDownTeu'));
    vvds = [];
    for (i = 0; i < result.removed.length; i++) vvds.push(result.removed[i].vvd);
    result.signature = vvds.join(',');
    if (vvds.length > 0) {
      names = vvds.slice(0, maxNamed);
      if (vvds.length > maxNamed) names.push('+' + (vvds.length - maxNamed) + ' more');
      result.clauses.push({
        kind: 'removed',
        text: whatChanged_plural(vvds.length, 'sailing', 'sailings') + ' removed (' + names.join(', ') + ')'
      });
    }
    if (result.moved.length > 0) {
      result.clauses.push({
        kind: 'moved',
        text: whatChanged_plural(result.moved.length, 'sailing', 'sailings') + ' moved ' + movedTeu + '+ TEU'
      });
    }
    if (result.arrived.length > 0) {
      result.clauses.push({
        kind: 'arrived',
        text: result.arrived.length + ' newly nominated'
      });
    }
    if (result.lanesDown.length > 0) {
      result.clauses.push({
        kind: 'laneDown',
        text: whatChanged_plural(result.lanesDown.length, 'lane', 'lanes') + ' down'
      });
    }
    result.state = result.clauses.length > 0 ? 'changes' : 'none';
    if (result.rolledOut > 0 || result.rolledIn > 0) {
      result.clauses.push({
        kind: 'rollover',
        text: 'sale week rolled over: ' + result.rolledOut + ' out, ' + result.rolledIn + ' in'
      });
    }
    return result;
  };
  function whatChanged_dayNumber(s) {
    var m, y, mo, d, era, yoe, doy, doe;
    if (typeof s !== 'string') return null;
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    y = parseInt(m[1], 10);
    mo = parseInt(m[2], 10);
    d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > whatChanged_monthDays(y, mo)) return null;
    y -= mo <= 2 ? 1 : 0;
    era = Math.floor(y / 400);
    yoe = y - era * 400;
    doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function whatChanged_monthDays(y, mo) {
    if (mo === 2) return y % 4 === 0 && y % 100 !== 0 || y % 400 === 0 ? 29 : 28;
    return mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31;
  }
  var whatChanged_WEEKDAYS = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
  BFShared.formatChangeDate = function (prevDate, curDate) {
    var p = whatChanged_dayNumber(prevDate);
    var c = whatChanged_dayNumber(curDate);
    var wd, text;
    if (p === null) return '';
    wd = whatChanged_WEEKDAYS[(p % 7 + 7) % 7];
    text = wd + ' ' + parseInt(prevDate.slice(5, 7), 10) + '/' + parseInt(prevDate.slice(8, 10), 10);
    if (c !== null && c - p > 3) text += ' (' + (c - p) + ' days earlier)';
    return text;
  };
  ;
  var thresholdDiff_EPSILON = 1e-9;
  var thresholdDiff_NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  function thresholdDiff_trim(s) {
    return s.replace(/^\s+|\s+$/g, '');
  }
  function thresholdDiff_isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
  }
  function thresholdDiff_cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  BFShared.thresholdValue = function (v) {
    var n, s, percent;
    if (typeof v === 'number') {
      n = v;
    } else if (typeof v === 'string') {
      s = thresholdDiff_trim(v);
      percent = s.length > 0 && s.charAt(s.length - 1) === '%';
      if (percent) s = thresholdDiff_trim(s.slice(0, s.length - 1));
      if (!thresholdDiff_NUMBER_PATTERN.test(s)) return null;
      n = parseFloat(s);
      if (percent) n = n / 100;
    } else {
      return null;
    }
    if (!isFinite(n)) return null;
    if (Math.abs(n) < thresholdDiff_EPSILON || Math.abs(n - 0.01) < thresholdDiff_EPSILON) return null;
    return n;
  };
  function thresholdDiff_text(v) {
    return typeof v === 'string' || typeof v === 'number' ? BFShared.normalizeVvd(v) : '';
  }
  function thresholdDiff_clean(rows) {
    var out = [];
    var i, r, vvd;
    if (!Array.isArray(rows)) return out;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!thresholdDiff_isObject(r)) continue;
      vvd = thresholdDiff_text(r.vvd);
      if (!BFShared.isRealVvd(vvd)) continue;
      out.push({
        vvd: vvd,
        pol: thresholdDiff_text(r.pol),
        lane: typeof r.lane === 'string' ? thresholdDiff_trim(r.lane) : '',
        overall: BFShared.thresholdValue(r.overall),
        loading: BFShared.thresholdValue(r.loading)
      });
    }
    return out;
  }
  function thresholdDiff_index(rows) {
    var sailings = {};
    var ports = {};
    var list = thresholdDiff_clean(rows);
    var i, r, s, p, sk, pk;
    for (i = 0; i < list.length; i++) {
      r = list[i];
      sk = 'v' + r.vvd;
      pk = 'p' + r.vvd + '\n' + r.pol;
      s = sailings[sk];
      if (!s) {
        s = sailings[sk] = {
          vvd: r.vvd,
          lane: r.lane,
          overall: null
        };
      }
      if (s.lane === '' && r.lane !== '') s.lane = r.lane;
      if (s.overall === null) s.overall = r.overall;
      p = ports[pk];
      if (!p) {
        p = ports[pk] = {
          vvd: r.vvd,
          pol: r.pol,
          loading: null
        };
      }
      if (p.loading === null) p.loading = r.loading;
    }
    return {
      sailings: sailings,
      ports: ports
    };
  }
  function thresholdDiff_values(map) {
    var out = [];
    var k;
    for (k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
    }
    return out;
  }
  BFShared.findMissingThresholds = function (rows) {
    var idx = thresholdDiff_index(rows);
    var sailings = [];
    var ports = [];
    var count = 0;
    var all = thresholdDiff_values(idx.ports);
    var i, p, s;
    thresholdDiff_values(idx.sailings).forEach(function (x) {
      if (x.overall === null) sailings.push({
        vvd: x.vvd,
        lane: x.lane
      });
    });
    for (i = 0; i < all.length; i++) {
      p = all[i];
      s = idx.sailings['v' + p.vvd];
      if (p.loading === null) ports.push({
        vvd: p.vvd,
        pol: p.pol,
        lane: s.lane
      });
      if (s.overall === null || p.loading === null) count++;
    }
    sailings.sort(function (a, b) {
      return thresholdDiff_cmp(a.vvd, b.vvd);
    });
    ports.sort(function (a, b) {
      return thresholdDiff_cmp(a.vvd, b.vvd) || thresholdDiff_cmp(a.pol, b.pol);
    });
    return {
      sailings: sailings,
      ports: ports,
      count: count
    };
  };
  function thresholdDiff_differs(a, b) {
    if (a === null || b === null) return a !== b;
    return Math.abs(a - b) > thresholdDiff_EPSILON;
  }
  BFShared.diffThresholds = function (prevRows, curRows) {
    var prev = thresholdDiff_index(prevRows);
    var cur = thresholdDiff_index(curRows);
    var out = [];
    var k, a, b;
    for (k in cur.sailings) {
      if (!Object.prototype.hasOwnProperty.call(cur.sailings, k) || !Object.prototype.hasOwnProperty.call(prev.sailings, k)) continue;
      a = prev.sailings[k];
      b = cur.sailings[k];
      if (thresholdDiff_differs(a.overall, b.overall)) out.push({
        vvd: b.vvd,
        pol: '',
        lane: b.lane,
        kind: 'overall',
        prev: a.overall,
        cur: b.overall
      });
    }
    for (k in cur.ports) {
      if (!Object.prototype.hasOwnProperty.call(cur.ports, k) || !Object.prototype.hasOwnProperty.call(prev.ports, k)) continue;
      a = prev.ports[k];
      b = cur.ports[k];
      if (thresholdDiff_differs(a.loading, b.loading)) out.push({
        vvd: b.vvd,
        pol: b.pol,
        lane: cur.sailings['v' + b.vvd].lane,
        kind: 'loading',
        prev: a.loading,
        cur: b.loading
      });
    }
    out.sort(function (x, y) {
      return thresholdDiff_cmp(x.vvd, y.vvd) || thresholdDiff_cmp(x.kind === 'overall' ? 0 : 1, y.kind === 'overall' ? 0 : 1) || thresholdDiff_cmp(x.pol, y.pol);
    });
    return out;
  };
  BFShared.thresholdChangesOverDays = function (days) {
    var byDate = {};
    var dates = [];
    var out = [];
    var i, d, j, pair, changes, e, key;
    if (!Array.isArray(days)) return out;
    for (i = 0; i < days.length; i++) {
      d = days[i];
      if (!thresholdDiff_isObject(d) || !feedAge_isCalendarDate(d.date) || !Array.isArray(d.rows)) continue;
      key = 'd' + d.date;
      if (!Object.prototype.hasOwnProperty.call(byDate, key)) {
        byDate[key] = [];
        dates.push(d.date);
      }
      byDate[key] = byDate[key].concat(d.rows);
    }
    dates.sort();
    for (j = dates.length - 1; j >= 1; j--) {
      pair = BFShared.diffThresholds(byDate['d' + dates[j - 1]], byDate['d' + dates[j]]);
      for (e = 0; e < pair.length; e++) {
        changes = pair[e];
        out.push({
          vvd: changes.vvd,
          pol: changes.pol,
          lane: changes.lane,
          kind: changes.kind,
          prev: changes.prev,
          cur: changes.cur,
          firstSeen: dates[j]
        });
      }
    }
    return out;
  };
  ;
  var decisions_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
  var decisions_VVD_PATTERN = /^[A-Z0-9][A-Z0-9 ._\/-]{1,39}$/;
  var decisions_POLKEY_PATTERN = /^[A-Z0-9][A-Z0-9 ._\/-]{0,39}(#\d{1,4})?$/;
  var decisions_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
  var decisions_ISO_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/;
  var decisions_KINDS = ['decision', 'threshold'];
  var decisions_ACTIONS = ['freeze', 'monitor', 'cut', 'roll'];
  var decisions_FIELDS = ['overall', 'loading'];
  var decisions_STATUSES = ['proposed', 'approved', 'rejected'];
  var decisions_REASON_MAX = 1000;
  var decisions_PAYLOAD_MAX = 4000;
  var decisions_EMAIL_MAX = 254;
  var decisions_VALUE_MAX = 1000;
  var decisions_SEEN_KEYS = ['curLaden', 'ceiling', 'threshold', 'bookingSailing', 'declaredFinal', 'fallDownPct', 'epAsOf', 'dataAsOf'];
  var decisions_SEEN_TEXT = ['epAsOf', 'dataAsOf'];
  var decisions_SEEN_TEXT_MAX = 40;
  var decisions_CHECK_AS = ['lead', 'admin'];
  var decisions_LANE_PATTERN = /^[A-Z0-9][A-Z0-9 ._-]{0,19}$/;
  BFShared.decisionLimits = function () {
    return {
      reasonMaxChars: decisions_REASON_MAX,
      payloadMaxChars: decisions_PAYLOAD_MAX,
      idMaxChars: 64,
      emailMaxChars: decisions_EMAIL_MAX,
      kinds: decisions_KINDS.slice(),
      actions: decisions_ACTIONS.slice(),
      fields: decisions_FIELDS.slice(),
      statuses: decisions_STATUSES.slice()
    };
  };
  function decisions_isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
  }
  function decisions_own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  }
  function decisions_key(s) {
    return '#' + s;
  }
  function decisions_has(map, k) {
    return Object.prototype.hasOwnProperty.call(map, k);
  }
  function decisions_get(map, k) {
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined;
  }
  function decisions_trim(s) {
    return s.replace(/^\s+|\s+$/g, '');
  }
  function decisions_cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function decisions_fail(code) {
    return {
      ok: false,
      error: code
    };
  }
  function decisions_isoTime(v) {
    var m;
    if (typeof v !== 'string') return null;
    m = decisions_ISO_PATTERN.exec(decisions_trim(v));
    if (!m || !feedAge_isCalendarDate(m[1])) return null;
    if (parseInt(m[2], 10) > 23 || parseInt(m[3], 10) > 59 || parseInt(m[4], 10) > 59) return null;
    return m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + (m[5] || '.000') + 'Z';
  }
  BFShared.decisionTime = function (v) {
    try {
      return decisions_isoTime(v);
    } catch (e) {
      return null;
    }
  };
  function decisions_polKey(v) {
    var p, parts;
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return null;
    p = BFShared.normalizeVvd(v);
    if (p === '') return '';
    if (p.indexOf('#') !== -1) {
      parts = p.split('#');
      if (parts.length !== 2 || !/^\d{1,20}$/.test(parts[1])) return null;
      p = BFShared.makePortKey(parts[0], parts[1]);
      if (p === '') return null;
    }
    return decisions_POLKEY_PATTERN.test(p) ? p : null;
  }
  function decisions_thresholdNumber(v) {
    var n = BFShared.thresholdValue(v);
    if (n === null) return null;
    return n > 0 && n <= decisions_VALUE_MAX ? n : undefined;
  }
  function decisions_payload(kind, p, polKey) {
    var reason, action, field, from, to, status, out, extra;
    if (!decisions_isObject(p)) return 'invalid-payload';
    if (kind === 'decision') {
      action = decisions_own(p, 'action');
      action = typeof action === 'string' ? decisions_trim(action).toLowerCase() : '';
      if (decisions_ACTIONS.indexOf(action) === -1) return 'invalid-action';
      out = {
        action: action,
        reason: ''
      };
    } else {
      field = decisions_own(p, 'field');
      field = typeof field === 'string' ? decisions_trim(field).toLowerCase() : '';
      if (decisions_FIELDS.indexOf(field) === -1) return 'invalid-field';
      if (field === 'overall' !== (polKey === '')) return 'invalid-polkey';
      from = decisions_own(p, 'from');
      if (from === undefined || from === null) from = null;else if (typeof from === 'number' && isFinite(from)) from = decisions_thresholdNumber(from);else return 'invalid-from';
      if (from === undefined) return 'invalid-from';
      to = decisions_own(p, 'to');
      to = typeof to === 'number' ? decisions_thresholdNumber(to) : null;
      if (to === null || to === undefined) return 'invalid-to';
      status = decisions_own(p, 'status');
      status = typeof status === 'string' ? decisions_trim(status).toLowerCase() : '';
      if (decisions_STATUSES.indexOf(status) === -1) return 'invalid-status';
      out = {
        field: field,
        from: from,
        to: to,
        reason: '',
        status: status
      };
    }
    reason = decisions_own(p, 'reason');
    reason = typeof reason === 'string' ? decisions_trim(reason) : '';
    if (reason === '') return 'invalid-reason';
    if (reason.length > decisions_REASON_MAX) return 'reason-too-long';
    out.reason = reason;
    if (kind === 'decision') {
      extra = action === 'roll' ? decisions_rollTo(decisions_own(p, 'rollTo')) : '';
      if (extra === undefined) return 'invalid-roll-to';
      if (extra !== '') out.rollTo = extra;
      extra = decisions_seen(decisions_own(p, 'seen'));
      if (extra === undefined) return 'invalid-seen';
      if (extra !== null) out.seen = extra;
    } else if (status !== 'proposed') {
      extra = decisions_check(decisions_own(p, 'check'));
      if (extra === undefined) return 'invalid-check';
      if (extra !== null) out.check = extra;
    }
    if (JSON.stringify(out).length > decisions_PAYLOAD_MAX) return 'payload-too-large';
    return out;
  }
  function decisions_rollTo(v) {
    var n;
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return undefined;
    n = BFShared.normalizeVvd(v);
    if (n === '') return '';
    return BFShared.isRealVvd(n) && decisions_VVD_PATTERN.test(n) ? n : undefined;
  }
  function decisions_seen(v) {
    var out = {},
      any = false,
      i,
      k,
      x;
    if (v === undefined || v === null) return null;
    if (!decisions_isObject(v)) return undefined;
    for (i = 0; i < decisions_SEEN_KEYS.length; i++) {
      k = decisions_SEEN_KEYS[i];
      x = decisions_own(v, k);
      if (x === undefined) continue;
      if (x !== null) {
        if (decisions_SEEN_TEXT.indexOf(k) !== -1) {
          if (typeof x !== 'string') return undefined;
          x = decisions_trim(x);
          if (x.length > decisions_SEEN_TEXT_MAX) return undefined;
        } else if (typeof x !== 'number' || !isFinite(x)) {
          return undefined;
        }
      }
      out[k] = x;
      any = true;
    }
    return any ? out : null;
  }
  function decisions_check(v) {
    var as, lane, sig;
    if (v === undefined || v === null) return null;
    if (!decisions_isObject(v)) return undefined;
    as = decisions_own(v, 'as');
    as = typeof as === 'string' ? decisions_trim(as).toLowerCase() : '';
    if (decisions_CHECK_AS.indexOf(as) === -1) return undefined;
    lane = decisions_own(v, 'lane');
    if (lane === undefined || lane === null) lane = '';
    if (typeof lane !== 'string') return undefined;
    lane = decisions_trim(lane).toUpperCase();
    if (lane === '' ? as !== 'admin' : !decisions_LANE_PATTERN.test(lane)) return undefined;
    sig = decisions_own(v, 'sig');
    if (sig === undefined || sig === null) return {
      as: as,
      lane: lane
    };
    if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return undefined;
    return {
      as: as,
      lane: lane,
      sig: sig
    };
  }
  function decisions_normalize(r) {
    var id, vvd, polKey, kind, payload, author, createdAt, supersedes;
    if (!decisions_isObject(r)) return decisions_fail('not-object');
    id = decisions_own(r, 'id');
    id = typeof id === 'string' ? decisions_trim(id) : '';
    if (!decisions_ID_PATTERN.test(id)) return decisions_fail('invalid-id');
    vvd = decisions_own(r, 'vvd');
    vvd = typeof vvd === 'string' ? BFShared.normalizeVvd(vvd) : '';
    if (!BFShared.isRealVvd(vvd) || !decisions_VVD_PATTERN.test(vvd)) return decisions_fail('invalid-vvd');
    polKey = decisions_polKey(decisions_own(r, 'polKey'));
    if (polKey === null) return decisions_fail('invalid-polkey');
    kind = decisions_own(r, 'kind');
    kind = typeof kind === 'string' ? decisions_trim(kind).toLowerCase() : '';
    if (decisions_KINDS.indexOf(kind) === -1) return decisions_fail('invalid-kind');
    payload = decisions_payload(kind, decisions_own(r, 'payload'), polKey);
    if (typeof payload === 'string') return decisions_fail(payload);
    author = decisions_own(r, 'author');
    author = typeof author === 'string' ? decisions_trim(author).toLowerCase() : '';
    if (author.length > decisions_EMAIL_MAX || !decisions_EMAIL_PATTERN.test(author)) return decisions_fail('invalid-author');
    createdAt = decisions_isoTime(decisions_own(r, 'createdAt'));
    if (createdAt === null) return decisions_fail('invalid-created-at');
    supersedes = decisions_own(r, 'supersedes');
    if (supersedes === undefined || supersedes === null) supersedes = '';else if (typeof supersedes === 'string') supersedes = decisions_trim(supersedes);else return decisions_fail('invalid-supersedes');
    if (supersedes !== '' && (!decisions_ID_PATTERN.test(supersedes) || supersedes === id)) return decisions_fail('invalid-supersedes');
    return {
      ok: true,
      record: {
        id: id,
        vvd: vvd,
        polKey: polKey,
        kind: kind,
        payload: payload,
        author: author,
        createdAt: createdAt,
        supersedes: supersedes
      }
    };
  }
  BFShared.normalizeDecisionRecord = function (r) {
    try {
      return decisions_normalize(r);
    } catch (e) {
      return decisions_fail('invalid-record');
    }
  };
  function decisions_cell(row, i) {
    var v = row.length > i ? row[i] : '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && isFinite(v) || typeof v === 'boolean') return String(v);
    return '';
  }
  BFShared.decisionRecordFromRow = function (row) {
    var payload;
    try {
      if (!Array.isArray(row)) return decisions_fail('not-row');
      try {
        payload = JSON.parse(decisions_cell(row, 4));
      } catch (e) {
        return decisions_fail('invalid-payload-json');
      }
      return decisions_normalize({
        id: decisions_cell(row, 0),
        vvd: decisions_cell(row, 1),
        polKey: decisions_cell(row, 2),
        kind: decisions_cell(row, 3),
        payload: payload,
        author: decisions_cell(row, 5),
        createdAt: decisions_cell(row, 6),
        supersedes: decisions_cell(row, 7)
      });
    } catch (e2) {
      return decisions_fail('invalid-record');
    }
  };
  BFShared.decisionRecordToRow = function (r) {
    var n = BFShared.normalizeDecisionRecord(r);
    var x;
    if (!n.ok) return n;
    x = n.record;
    return {
      ok: true,
      row: [x.id, x.vvd, x.polKey, x.kind, JSON.stringify(x.payload), x.author, x.createdAt, x.supersedes]
    };
  };
  function decisions_newer(a, b) {
    return decisions_cmp(a.createdAt, b.createdAt) > 0 || a.createdAt === b.createdAt && decisions_cmp(a.id, b.id) > 0;
  }
  function decisions_newestFirst(a, b) {
    return decisions_newer(a, b) ? -1 : decisions_newer(b, a) ? 1 : 0;
  }
  function decisions_keyOf(r) {
    return r.vvd + '\n' + r.polKey + '\n' + r.kind;
  }
  function decisions_clean(records) {
    var byId = {};
    var list = [];
    var i, n, k, old;
    if (!Array.isArray(records)) return {
      list: list,
      byId: byId
    };
    for (i = 0; i < records.length; i++) {
      n = BFShared.normalizeDecisionRecord(records[i]);
      if (!n.ok) continue;
      k = decisions_key(n.record.id);
      old = decisions_get(byId, k);
      if (!old || decisions_newer(n.record, old) || old.createdAt === n.record.createdAt && decisions_cmp(JSON.stringify(n.record), JSON.stringify(old)) > 0) {
        byId[k] = n.record;
      }
    }
    for (k in byId) {
      if (decisions_has(byId, k)) list.push(byId[k]);
    }
    list.sort(function (a, b) {
      return decisions_cmp(a.id, b.id);
    });
    return {
      list: list,
      byId: byId
    };
  }
  function decisions_supersededBy(clean) {
    var by = {};
    var i, r, k, cur;
    for (i = 0; i < clean.list.length; i++) {
      r = clean.list[i];
      if (r.supersedes === '') continue;
      k = decisions_key(r.supersedes);
      if (!decisions_has(clean.byId, k)) continue;
      cur = decisions_get(by, k);
      if (!cur || decisions_newer(r, cur)) by[k] = r;
    }
    return by;
  }
  function decisions_copy(r, supersededBy) {
    var out = {
      id: r.id,
      vvd: r.vvd,
      polKey: r.polKey,
      kind: r.kind,
      payload: JSON.parse(JSON.stringify(r.payload)),
      author: r.author,
      createdAt: r.createdAt,
      supersedes: r.supersedes
    };
    if (supersededBy !== undefined) out.supersededBy = supersededBy;
    return out;
  }
  BFShared.latestDecisionPerKey = function (records) {
    var clean, by, best, out, i, r, k, cur;
    try {
      clean = decisions_clean(records);
      by = decisions_supersededBy(clean);
      best = {};
      for (i = 0; i < clean.list.length; i++) {
        r = clean.list[i];
        if (decisions_has(by, decisions_key(r.id))) continue;
        k = decisions_key(decisions_keyOf(r));
        cur = decisions_get(best, k);
        if (!cur || decisions_newer(r, cur)) best[k] = r;
      }
      out = [];
      for (k in best) {
        if (decisions_has(best, k)) out.push(decisions_copy(best[k]));
      }
      out.sort(function (a, b) {
        return decisions_cmp(a.vvd, b.vvd) || decisions_cmp(a.polKey, b.polKey) || decisions_cmp(a.kind, b.kind);
      });
      return out;
    } catch (e) {
      return [];
    }
  };
  function decisions_component(clean, seeds) {
    var seen = {};
    var queue = seeds.slice();
    var children = {};
    var i, r, k, next;
    for (i = 0; i < clean.list.length; i++) {
      r = clean.list[i];
      if (r.supersedes === '') continue;
      k = decisions_key(r.supersedes);
      if (!decisions_has(children, k)) children[k] = [];
      children[k].push(r.id);
    }
    while (queue.length) {
      k = decisions_key(queue.pop());
      if (decisions_has(seen, k) || !decisions_has(clean.byId, k)) continue;
      seen[k] = true;
      r = clean.byId[k];
      if (r.supersedes !== '') queue.push(r.supersedes);
      next = decisions_get(children, k) || [];
      for (i = 0; i < next.length; i++) queue.push(next[i]);
    }
    return seen;
  }
  BFShared.decisionHistoryFor = function (records, key) {
    var clean, by, seeds, seen, out, i, r, vvd, polKey, kind, sb;
    try {
      if (!decisions_isObject(key)) return [];
      vvd = decisions_own(key, 'vvd');
      vvd = typeof vvd === 'string' ? BFShared.normalizeVvd(vvd) : '';
      polKey = decisions_polKey(decisions_own(key, 'polKey'));
      kind = decisions_own(key, 'kind');
      kind = typeof kind === 'string' ? decisions_trim(kind).toLowerCase() : '';
      if (!BFShared.isRealVvd(vvd) || polKey === null || decisions_KINDS.indexOf(kind) === -1) return [];
      clean = decisions_clean(records);
      by = decisions_supersededBy(clean);
      seeds = [];
      for (i = 0; i < clean.list.length; i++) {
        r = clean.list[i];
        if (r.vvd === vvd && r.polKey === polKey && r.kind === kind) seeds.push(r.id);
      }
      seen = decisions_component(clean, seeds);
      out = [];
      for (i = 0; i < clean.list.length; i++) {
        r = clean.list[i];
        if (!decisions_has(seen, decisions_key(r.id))) continue;
        sb = decisions_get(by, decisions_key(r.id));
        out.push(decisions_copy(r, sb ? sb.id : ''));
      }
      out.sort(decisions_newestFirst);
      return out;
    } catch (e) {
      return [];
    }
  };
  BFShared.thresholdLiveInFeed = function (to, current) {
    var a, b;
    try {
      a = BFShared.thresholdValue(to);
      b = BFShared.thresholdValue(current);
      return a !== null && b !== null && Math.abs(a - b) <= thresholdDiff_EPSILON;
    } catch (e) {
      return false;
    }
  };
  function decisions_callLoading(rows, vvd, polKey) {
    var found = false;
    var i, r, v;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!decisions_isObject(r)) continue;
      if (thresholdDiff_text(r.vvd) !== vvd) continue;
      if (BFShared.makePortKey(r.pol, r.seq) !== polKey) continue;
      found = true;
      v = BFShared.thresholdValue(r.loading);
      if (v !== null) return v;
    }
    return found ? null : undefined;
  }
  function decisions_currentFor(idx, rows, vvd, polKey, field) {
    var map = field === 'overall' ? idx.sailings : idx.ports;
    var k, call;
    if (field === 'loading' && polKey.indexOf('#') !== -1) {
      call = decisions_callLoading(rows, vvd, polKey);
      if (call !== undefined) return call;
    }
    k = field === 'overall' ? 'v' + vvd : 'p' + vvd + '\n' + polKey.split('#')[0];
    if (!decisions_has(map, k)) return null;
    return field === 'overall' ? map[k].overall : map[k].loading;
  }
  function decisions_valueRecord(clean, latest) {
    var seen = {};
    var r = latest;
    var k;
    for (;;) {
      if (r.payload.status === 'proposed') return r;
      seen[decisions_key(r.id)] = true;
      if (r.supersedes === '') return r;
      k = decisions_key(r.supersedes);
      if (decisions_has(seen, k) || !decisions_has(clean.byId, k)) return r;
      r = clean.byId[k];
    }
  }
  BFShared.thresholdLog = function (records, currentRows, since) {
    var all, clean, by, done, out, idx, sinceIso, i, j, r, group, seen, first, latest, valueFrom, p, v, current, live;
    try {
      all = decisions_clean(records);
      clean = {
        list: [],
        byId: {}
      };
      for (i = 0; i < all.list.length; i++) {
        r = all.list[i];
        if (r.kind !== 'threshold') continue;
        clean.list.push(r);
        clean.byId[decisions_key(r.id)] = r;
      }
      by = decisions_supersededBy(clean);
      idx = Array.isArray(currentRows) ? thresholdDiff_index(currentRows) : null;
      sinceIso = decisions_isoTime(since);
      done = {};
      out = [];
      for (i = 0; i < clean.list.length; i++) {
        r = clean.list[i];
        if (decisions_has(done, decisions_key(r.id))) continue;
        seen = decisions_component(clean, [r.id]);
        group = [];
        for (j = 0; j < clean.list.length; j++) {
          if (decisions_has(seen, decisions_key(clean.list[j].id))) {
            group.push(clean.list[j]);
            done[decisions_key(clean.list[j].id)] = true;
          }
        }
        group.sort(decisions_newestFirst);
        first = group[group.length - 1];
        latest = null;
        for (j = 0; j < group.length && latest === null; j++) {
          if (!decisions_has(by, decisions_key(group[j].id))) latest = group[j];
        }
        if (latest === null) latest = group[0];
        valueFrom = decisions_valueRecord(clean, latest);
        if (sinceIso !== null && latest.createdAt < sinceIso) continue;
        p = latest.payload;
        v = valueFrom.payload;
        current = idx ? decisions_currentFor(idx, currentRows, latest.vvd, latest.polKey, v.field) : null;
        live = idx ? BFShared.thresholdLiveInFeed(v.to, current) : null;
        out.push({
          id: first.id,
          latestId: latest.id,
          vvd: latest.vvd,
          polKey: latest.polKey,
          field: v.field,
          from: v.from,
          to: v.to,
          reason: p.reason,
          status: p.status,
          proposedBy: first.author,
          proposedAt: first.createdAt,
          updatedBy: latest.author,
          updatedAt: latest.createdAt,
          records: group.length,
          current: current,
          liveInFeed: live,
          stage: p.status === 'rejected' ? 'rejected' : p.status === 'approved' && live === true ? 'live' : p.status
        });
      }
      out.sort(function (a, b) {
        return decisions_cmp(b.updatedAt, a.updatedAt) || decisions_cmp(a.id, b.id);
      });
      return out;
    } catch (e) {
      return [];
    }
  };
  ;
  var thresholdProposals_STATUSES = ['approved', 'rejected'];
  function thresholdProposals_text(v, lower) {
    var s;
    if (typeof v !== 'string') return '';
    s = decisions_trim(v);
    return lower ? s.toLowerCase() : s.toUpperCase();
  }
  function thresholdProposals_email(v) {
    var e = thresholdProposals_text(v, true);
    return e.length <= decisions_EMAIL_MAX && decisions_EMAIL_PATTERN.test(e) ? e : '';
  }
  function thresholdProposals_lane(v) {
    var l = thresholdProposals_text(v, false);
    return decisions_LANE_PATTERN.test(l) ? l : '';
  }
  function thresholdProposals_cell(row, i) {
    var v = row.length > i ? row[i] : '';
    return v === null || v === undefined ? '' : v;
  }
  BFShared.parseThresholdApprovers = function (rows) {
    var seen = {},
      out = [],
      skipped = 0,
      i,
      row,
      lane,
      email,
      rawLane,
      rawEmail,
      k;
    try {
      if (!Array.isArray(rows)) return {
        approvers: [],
        skipped: 0
      };
      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        if (!Array.isArray(row)) {
          skipped++;
          continue;
        }
        rawLane = thresholdProposals_cell(row, 0);
        rawEmail = thresholdProposals_cell(row, 1);
        if (typeof rawLane === 'string' && typeof rawEmail === 'string' && decisions_trim(rawLane) === '' && decisions_trim(rawEmail) === '') continue;
        lane = thresholdProposals_lane(rawLane);
        email = thresholdProposals_email(rawEmail);
        if (lane === '' || email === '') {
          skipped++;
          continue;
        }
        k = decisions_key(lane + '\n' + email);
        if (decisions_has(seen, k)) continue;
        seen[k] = true;
        out.push({
          lane: lane,
          email: email
        });
      }
      out.sort(function (a, b) {
        return decisions_cmp(a.lane, b.lane) || decisions_cmp(a.email, b.email);
      });
      return {
        approvers: out,
        skipped: skipped
      };
    } catch (e) {
      return {
        approvers: [],
        skipped: 0
      };
    }
  };
  BFShared.thresholdApproverLanes = function (approvers, email) {
    var me,
      seen = {},
      out = [],
      i,
      a,
      lane;
    try {
      me = thresholdProposals_email(email);
      if (!Array.isArray(approvers) || me === '') return [];
      for (i = 0; i < approvers.length; i++) {
        a = approvers[i];
        if (!decisions_isObject(a) || thresholdProposals_email(decisions_own(a, 'email')) !== me) continue;
        lane = thresholdProposals_lane(decisions_own(a, 'lane'));
        if (lane === '' || decisions_has(seen, decisions_key(lane))) continue;
        seen[decisions_key(lane)] = true;
        out.push(lane);
      }
      out.sort(decisions_cmp);
      return out;
    } catch (e) {
      return [];
    }
  };
  function thresholdProposals_clean(records) {
    var all = decisions_clean(records);
    var clean = {
      list: [],
      byId: {}
    };
    var i, r;
    for (i = 0; i < all.list.length; i++) {
      r = all.list[i];
      if (r.kind !== 'threshold') continue;
      clean.list.push(r);
      clean.byId[decisions_key(r.id)] = r;
    }
    return clean;
  }
  function thresholdProposals_proposer(clean, id) {
    var r;
    if (typeof id !== 'string') return '';
    r = decisions_get(clean.byId, decisions_key(decisions_trim(id)));
    return r ? decisions_valueRecord(clean, r).author : '';
  }
  function thresholdProposals_proposers(clean, id) {
    var seen = {},
      out = [],
      r,
      v,
      k,
      e;
    if (typeof id !== 'string') return [];
    r = decisions_get(clean.byId, decisions_key(decisions_trim(id)));
    if (!r) return [];
    v = decisions_valueRecord(clean, r).payload;
    for (;;) {
      seen[decisions_key(r.id)] = true;
      if (r.payload.status === 'proposed' && r.payload.field === v.field && Math.abs(r.payload.to - v.to) <= 1e-9) {
        e = r.author;
        if (out.indexOf(e) === -1) out.push(e);
      }
      if (r.supersedes === '') break;
      k = decisions_key(r.supersedes);
      if (decisions_has(seen, k) || !decisions_has(clean.byId, k)) break;
      r = clean.byId[k];
    }
    out.sort(decisions_cmp);
    return out;
  }
  BFShared.thresholdProposersOf = function (records, id) {
    try {
      return thresholdProposals_proposers(thresholdProposals_clean(records), id);
    } catch (e) {
      return [];
    }
  };
  BFShared.thresholdProposerOf = function (records, id) {
    try {
      return thresholdProposals_proposer(thresholdProposals_clean(records), id);
    } catch (e) {
      return '';
    }
  };
  function thresholdProposals_check(c) {
    var status, me, lanes, lane, i, proposers;
    if (!decisions_isObject(c)) return decisions_fail('invalid-status');
    status = thresholdProposals_text(decisions_own(c, 'status'), true);
    if (thresholdProposals_STATUSES.indexOf(status) === -1) return decisions_fail('invalid-status');
    me = thresholdProposals_email(decisions_own(c, 'me'));
    if (me === '') return decisions_fail('no-user-identity');
    if (decisions_own(c, 'configured') !== true) return decisions_fail('approvers-not-configured');
    if (status === 'approved' && decisions_own(c, 'targetRejected') === true) return decisions_fail('proposal-rejected');
    if (status === 'approved' && me === thresholdProposals_email(decisions_own(c, 'proposer'))) return decisions_fail('own-proposal');
    proposers = decisions_own(c, 'proposers');
    if (status === 'approved' && Array.isArray(proposers)) {
      for (i = 0; i < proposers.length; i++) {
        if (thresholdProposals_email(proposers[i]) === me) return decisions_fail('own-proposal');
      }
    }
    if (decisions_own(c, 'admin') === true) return {
      ok: true,
      as: 'admin'
    };
    lane = thresholdProposals_lane(decisions_own(c, 'lane'));
    if (lane === '') return decisions_fail('lane-unknown');
    lanes = decisions_own(c, 'approverLanes');
    if (Array.isArray(lanes)) {
      for (i = 0; i < lanes.length; i++) {
        if (thresholdProposals_lane(lanes[i]) === lane) return {
          ok: true,
          as: 'lead'
        };
      }
    }
    return decisions_fail('not-approver');
  }
  BFShared.thresholdApprovalCheck = function (c) {
    try {
      return thresholdProposals_check(c);
    } catch (e) {
      return decisions_fail('invalid-status');
    }
  };
  BFShared.thresholdProposals = function (records, currentRows, since) {
    var log, clean, out, i, e, latest, check, copy, k, state;
    try {
      log = BFShared.thresholdLog(records, currentRows, since);
      clean = thresholdProposals_clean(records);
      out = [];
      for (i = 0; i < log.length; i++) {
        e = log[i];
        latest = decisions_get(clean.byId, decisions_key(e.latestId));
        check = latest && decisions_isObject(latest.payload.check) ? {
          as: latest.payload.check.as,
          lane: latest.payload.check.lane
        } : null;
        copy = {};
        for (k in e) {
          if (decisions_has(e, k)) copy[k] = e[k];
        }
        if (e.status === 'proposed') state = 'proposed';else if (check === null) state = 'unchecked';else if (e.status === 'rejected') state = 'rejected';else state = e.liveInFeed === true ? 'live' : 'approved';
        copy.check = check;
        copy.valueBy = latest ? thresholdProposals_proposer(clean, latest.id) : '';
        copy.state = state;
        out.push(copy);
      }
      return out;
    } catch (err) {
      return [];
    }
  };
  function thresholdProposals_pct(v) {
    var n = BFShared.thresholdValue(v);
    var x;
    if (n === null) return '';
    x = Math.round(n * 1000) / 10;
    return String(x) + '%';
  }
  function thresholdProposals_who(email) {
    var e = thresholdProposals_email(email);
    var at = e.indexOf('@');
    return at > 0 ? e.slice(0, at) : 'someone';
  }
  BFShared.thresholdProposalChip = function (p) {
    var state, pct;
    try {
      if (!decisions_isObject(p) || decisions_own(p, 'liveInFeed') === true) return {
        show: false
      };
      state = decisions_own(p, 'state');
      pct = thresholdProposals_pct(decisions_own(p, 'to'));
      if (pct === '') return {
        show: false
      };
      if (state === 'proposed' || state === 'unchecked') {
        return {
          show: true,
          tone: 'proposed',
          text: 'Threshold proposed ' + pct + ' by ' + thresholdProposals_who(decisions_own(p, 'valueBy'))
        };
      }
      if (state === 'approved') {
        return {
          show: true,
          tone: 'approved',
          text: 'Threshold approved ' + pct + ' by ' + thresholdProposals_who(decisions_own(p, 'updatedBy')) + ', not yet in feed'
        };
      }
      return {
        show: false
      };
    } catch (e) {
      return {
        show: false
      };
    }
  };
  ;
  var exceptions_RULES = ['unowned', 'over_booking', 'over_laden', 'no_cutoff'];
  function exceptions_dayNumber(iso) {
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10);
    var d = parseInt(iso.slice(8, 10), 10);
    var era, yoe, doy;
    if (m <= 2) y = y - 1;
    era = Math.floor(y / 400);
    yoe = y - era * 400;
    doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  }
  function exceptions_number(v) {
    var s;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    s = thresholdDiff_trim(v);
    return thresholdDiff_NUMBER_PATTERN.test(s) && isFinite(parseFloat(s)) ? parseFloat(s) : null;
  }
  function exceptions_cutoff(v) {
    var s;
    if (typeof v !== 'string') return '';
    s = thresholdDiff_trim(v);
    if (!/^\d{4}-\d{2}-\d{2}($|[ T])/.test(s)) return '';
    s = s.slice(0, 10);
    return feedAge_isCalendarDate(s) ? s : '';
  }
  function exceptions_wholeFrom(v, min, fallback) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min ? v : fallback;
  }
  function exceptions_config(config) {
    var c = thresholdDiff_isObject(config) ? config : {};
    var free = ['FLX'];
    var i, lane;
    if (Array.isArray(c.freeLanes)) {
      free = [];
      for (i = 0; i < c.freeLanes.length; i++) {
        lane = c.freeLanes[i];
        if (typeof lane === 'string' && thresholdDiff_trim(lane) !== '') free.push(thresholdDiff_trim(lane).toUpperCase());
      }
    }
    return {
      n: exceptions_wholeFrom(c.n, 1, 3),
      noCutoffDays: exceptions_wholeFrom(c.noCutoffDays, 1, 1),
      leadDaysMin: typeof c.leadDaysMin === 'number' && isFinite(c.leadDaysMin) && c.leadDaysMin >= 0 ? c.leadDaysMin : 0,
      freeLanes: free,
      asOf: feedAge_isCalendarDate(c.asOf) ? c.asOf : null
    };
  }
  function exceptions_fmt(x) {
    return String(Math.round(x * 100) / 100);
  }
  function exceptions_dayFacts(rows) {
    var out = {};
    var order = [];
    var i, r, vvd, key, s, pic, maxLaden, thr, cap, laden, pol, cut, k, cuts;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!thresholdDiff_isObject(r)) continue;
      vvd = thresholdDiff_text(r.vvd);
      if (!BFShared.isRealVvd(vvd)) continue;
      key = 'v' + vvd;
      s = out[key];
      if (!s) {
        s = out[key] = {
          vvd: vvd,
          lane: '',
          unowned: true,
          pics: [],
          overPorts: [],
          noCutoff: true,
          portRows: 0,
          cutoff: '',
          maxLaden: null,
          overall: null,
          booking: null
        };
        order.push(key);
      }
      s.portRows++;
      if (s.lane === '' && typeof r.lane === 'string') s.lane = thresholdDiff_trim(r.lane).toUpperCase();
      pic = BFShared.parsePic(r.pic);
      if (pic.owned) s.unowned = false;
      pic = pic.blank ? '(blank)' : pic.halves.join(' / ');
      if (s.pics.indexOf(pic) === -1) s.pics.push(pic);
      maxLaden = exceptions_number(r.maxLaden);
      if (s.maxLaden === null && maxLaden !== null && maxLaden > 0) s.maxLaden = maxLaden;
      if (s.overall === null) s.overall = BFShared.thresholdValue(r.overall);
      if (s.booking === null) s.booking = exceptions_number(r.bookingSailing);
      thr = BFShared.thresholdValue(r.loading);
      laden = exceptions_number(r.ladenPol);
      if (maxLaden !== null && maxLaden > 0 && thr !== null && laden !== null) {
        cap = maxLaden * thr;
        pol = thresholdDiff_text(r.pol);
        if (laden > cap) s.overPorts.push((pol === '' ? '(no port)' : pol) + ' laden ' + exceptions_fmt(laden) + ' > cap ' + exceptions_fmt(cap) + ' (' + exceptions_fmt(maxLaden) + ' x ' + exceptions_fmt(thr) + ')');
      }
      cuts = [exceptions_cutoff(r.cutoff), exceptions_cutoff(r.polCutoff)];
      for (k = 0; k < 2; k++) {
        cut = cuts[k];
        if (cut === '') continue;
        s.noCutoff = false;
        if (s.cutoff === '' || cut < s.cutoff) s.cutoff = cut;
      }
    }
    for (k = 0; k < order.length; k++) {
      s = out[order[k]];
      s.overBooking = '';
      if (s.maxLaden !== null && s.overall !== null && s.booking !== null && s.booking > s.maxLaden * s.overall) {
        s.overBooking = 'booking ' + exceptions_fmt(s.booking) + ' > cap ' + exceptions_fmt(s.maxLaden * s.overall) + ' (' + exceptions_fmt(s.maxLaden) + ' x ' + exceptions_fmt(s.overall) + ')';
      }
    }
    return {
      sailings: out,
      order: order
    };
  }
  function exceptions_ruleIndex(rule) {
    return rule === 'unowned' ? 0 : rule === 'over_booking' ? 1 : rule === 'over_laden' ? 2 : 3;
  }
  function exceptions_compare(a, b, by) {
    var ac = a.cutoff === '' ? '~' : a.cutoff;
    var bc = b.cutoff === '' ? '~' : b.cutoff;
    var byRule = thresholdDiff_cmp(exceptions_ruleIndex(a.rule), exceptions_ruleIndex(b.rule));
    var byDays = thresholdDiff_cmp(b.days, a.days);
    var byCut = thresholdDiff_cmp(ac, bc);
    var byVvd = thresholdDiff_cmp(a.vvd, b.vvd);
    if (by === 'days') return byDays || byCut || byVvd || byRule;
    if (by === 'cutoff') return byCut || byDays || byVvd || byRule;
    return byRule || byDays || byVvd;
  }
  BFShared.sortExceptions = function (list, by) {
    var out = [];
    var i, e;
    if (!Array.isArray(list)) return out;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (thresholdDiff_isObject(e) && typeof e.vvd === 'string' && typeof e.rule === 'string' && typeof e.days === 'number' && isFinite(e.days) && typeof e.cutoff === 'string') out.push(e);
    }
    out.sort(function (a, b) {
      return exceptions_compare(a, b, by);
    });
    return out;
  };
  BFShared.findExceptions = function (days, config) {
    var cfg = exceptions_config(config);
    var byDate = {};
    var dates = [];
    var out = [];
    var i, d, key, asOf, asOfIdx, facts, today, k, s, ruleNo, need, streak, j, f, prevNum, dayNum, e, lead;
    if (!Array.isArray(days)) return out;
    for (i = 0; i < days.length; i++) {
      d = days[i];
      if (!thresholdDiff_isObject(d) || !feedAge_isCalendarDate(d.date) || !Array.isArray(d.rows)) continue;
      key = 'd' + d.date;
      if (!Object.prototype.hasOwnProperty.call(byDate, key)) {
        byDate[key] = [];
        dates.push(d.date);
      }
      byDate[key] = byDate[key].concat(d.rows);
    }
    dates.sort();
    asOf = cfg.asOf === null ? dates.length ? dates[dates.length - 1] : null : cfg.asOf;
    asOfIdx = asOf === null ? -1 : dates.indexOf(asOf);
    if (asOfIdx === -1) return out;
    facts = [];
    for (i = 0; i <= asOfIdx; i++) facts.push(exceptions_dayFacts(byDate['d' + dates[i]]));
    today = facts[asOfIdx];
    for (k = 0; k < today.order.length; k++) {
      s = today.sailings[today.order[k]];
      for (ruleNo = 0; ruleNo < 4; ruleNo++) {
        need = ruleNo === 3 ? cfg.noCutoffDays : cfg.n;
        if (ruleNo === 0 && cfg.freeLanes.indexOf(s.lane) !== -1) continue;
        streak = 0;
        dayNum = exceptions_dayNumber(dates[asOfIdx]);
        for (j = asOfIdx; j >= 0; j--) {
          if (j < asOfIdx && exceptions_dayNumber(dates[j]) !== prevNum - 1) break;
          f = facts[j].sailings[today.order[k]];
          if (!f) break;
          if (ruleNo === 0 ? !f.unowned : ruleNo === 1 ? f.overBooking === '' : ruleNo === 2 ? f.overPorts.length === 0 : !f.noCutoff) break;
          streak++;
          prevNum = exceptions_dayNumber(dates[j]);
        }
        if (streak < need) continue;
        if ((ruleNo === 1 || ruleNo === 2) && cfg.leadDaysMin > 0 && s.cutoff !== '') {
          lead = exceptions_dayNumber(s.cutoff) - dayNum;
          if (lead < cfg.leadDaysMin) continue;
        }
        e = {
          vvd: s.vvd,
          lane: s.lane,
          rule: exceptions_RULES[ruleNo],
          days: streak,
          since: dates[asOfIdx - streak + 1],
          cutoff: s.cutoff,
          detail: ruleNo === 0 ? 'No owner: PIC ' + s.pics.sort().join(' | ') : ruleNo === 1 ? s.overBooking : ruleNo === 2 ? s.overPorts.sort().join('; ') : 'No cut-off on ' + s.portRows + (s.portRows === 1 ? ' port row' : ' port rows')
        };
        out.push(e);
      }
    }
    return BFShared.sortExceptions(out, 'rule');
  };
  ;
  var decisionCard_DAY_MS = 86400000;
  var decisionCard_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var decisionCard_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  var decisionCard_YARD_PATTERN = /^[A-Z]{5}\d{2}$/;
  function decisionCard_isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
  }
  function decisionCard_text(v) {
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  }
  function decisionCard_dayMs(s) {
    var m = decisionCard_DATE_PATTERN.exec(s),
      t,
      d;
    if (!m) return null;
    t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    d = new Date(t);
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return t;
  }
  function decisionCard_timeMs(v) {
    var s, t;
    if (typeof v !== 'string') return null;
    s = v.replace(/^\s+|\s+$/g, '');
    t = decisionCard_dayMs(s);
    if (t !== null) return t;
    if (!decisionCard_ISO_PATTERN.test(s)) return null;
    t = Date.parse(s);
    return isFinite(t) ? t : null;
  }
  BFShared.decisionCeiling = function (base, maxLaden, threshold) {
    var cap, thr, b, ceiling, diff;
    try {
      cap = exceptions_number(maxLaden);
      thr = BFShared.thresholdValue(threshold);
      if (cap === null || !(cap > 0) || thr === null) return {
        set: false
      };
      ceiling = cap * thr;
      b = exceptions_number(base);
      diff = b === null ? null : b - ceiling;
      return {
        set: true,
        ceiling: ceiling,
        diff: diff,
        over: diff !== null && diff > 0
      };
    } catch (e) {
      return {
        set: false
      };
    }
  };
  BFShared.matchDeskDeclaration = function (rows, vvd, pol) {
    var v,
      p,
      port,
      found = [],
      exact = [],
      i,
      r,
      key,
      parsed,
      rowPort;
    try {
      v = BFShared.normalizeVvd(decisionCard_text(vvd));
      p = BFShared.normalizeVvd(decisionCard_text(pol));
      if (Object.prototype.toString.call(rows) !== '[object Array]' || v === '' || p === '') return {
        state: 'none',
        row: null
      };
      port = decisionCard_YARD_PATTERN.test(p) ? p.slice(0, 5) : p;
      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        if (!decisionCard_isObject(r)) continue;
        if (BFShared.normalizeVvd(decisionCard_text(r.vvd)) !== v) continue;
        key = BFShared.normalizeVvd(decisionCard_text(r.port_key));
        parsed = key ? BFShared.parsePortKey(key) : null;
        rowPort = BFShared.normalizeVvd(decisionCard_text(r.port));
        if (rowPort !== p && rowPort !== port && !(parsed && (parsed.pol === p || parsed.pol === port))) continue;
        found.push(r);
        if (BFShared.normalizeVvd(decisionCard_text(r.terminal)) === p) exact.push(r);
      }
      if (exact.length === 1) return {
        state: 'ok',
        row: exact[0]
      };
      if (found.length === 0) return {
        state: 'none',
        row: null
      };
      if (found.length === 1 && !(port !== p && BFShared.normalizeVvd(decisionCard_text(found[0].terminal)) !== '')) return {
        state: 'ok',
        row: found[0]
      };
      return {
        state: 'unmatched',
        row: null
      };
    } catch (e) {
      return {
        state: 'none',
        row: null
      };
    }
  };
  BFShared.declarationAge = function (asOf, nowMs, cutoff) {
    var t, ageMs, stale, c;
    try {
      t = decisionCard_timeMs(asOf);
      if (t === null || typeof nowMs !== 'number' || !isFinite(nowMs)) return null;
      ageMs = nowMs - t;
      stale = ageMs > decisionCard_DAY_MS;
      c = typeof cutoff === 'string' ? decisionCard_dayMs(cutoff.replace(/^\s+|\s+$/g, '')) : null;
      if (c !== null && nowMs > c - 2 * decisionCard_DAY_MS) stale = true;
      return {
        ageMs: ageMs,
        stale: stale
      };
    } catch (e) {
      return null;
    }
  };
  ;
  return BFShared;
}();

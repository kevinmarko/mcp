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
            extra: []
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
      for (var x = 0; x < scan.voyages.length; x++) {
        var rec = scan.voyages[x];
        var any = false;
        for (var y = 0; y < voyageCols.length; y++) {
          if (rec.extra[y] === null) continue;
          any = true;
          pairCount++;
          if (examples.length < checkFeed_MAX_EXAMPLES) {
            examples.push({
              vvd: rec.vvd,
              field: voyageCols[y].wanted,
              values: rec.extra[y].list.slice(0, checkFeed_MAX_VALUES),
              valueCount: rec.extra[y].list.length
            });
          }
        }
        if (any) voyageCount++;
      }
      if (voyageCount > 0) {
        lists.voyage.push(checkFeed_problem('VOYAGE_DISAGREEMENT', checkFeed_plural(voyageCount, 'voyage carries', 'voyages carry') + ' different values across its port rows in a voyage-level column; for example VVD ' + examples[0].vvd + ', ' + examples[0].field + ': ' + examples[0].values.map(checkFeed_show).join(' vs '), {
          voyageCount: voyageCount,
          pairCount: pairCount,
          examples: examples
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
  ;
  return BFShared;
}();

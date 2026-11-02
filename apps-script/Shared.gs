// GENERATED FILE -- DO NOT EDIT.
// Written by scripts/sync_shared.js from the files in shared/. Edit those, then run:
//     node scripts/sync_shared.js
// `node scripts/sync_shared.js --check` (part of CI) fails while this file is stale.
// Defines the single global BFShared. Apps Script loads this file at startup, so another .gs
// file must use BFShared only inside functions that run later, never in its own top-level code.
var BFShared = (function () {
  'use strict';
  var BFShared = {};
  // ---- shared/00_core.js ----
  // shared/ holds the pure logic that the app and Apps Script both run. The files in this directory
  // are the SOURCE; scripts/sync_shared.js writes them into the app HTML (between its GENERATED
  // SHARED LOGIC marker lines) and into apps-script/Shared.gs. Never edit those two outputs: edit
  // here, then run `node scripts/sync_shared.js`. `node scripts/sync_shared.js --check` (CI) fails
  // while either output is stale, the same pattern as dist/ and scripts/build_deployable.js --check.
  //
  // CONVENTION for every file in this directory (tests/check_shared_sync.js enforces it):
  //   - Plain ES5: var and function only. No let/const/class/arrow/template literal/spread/
  //     destructuring/default parameter, and no import/export/require/module.
  //   - Dependency-free and environment-free: no window, document, process, console or any Node,
  //     browser or Apps Script global. Only the standard ES5 built-ins (Object, String, Math, ...).
  //   - Never compare typeof with the string 'object'. The build's Babel pass answers that comparison
  //     by adding a top-level helper function named _typeof to the app's script, which makes a second
  //     top-level name and fails check B in tests/check_shared_sync.js. Test for a missing value with
  //     x == null, and compare typeof only with 'string', 'number', 'boolean' or 'function'.
  //   - Public API: assign each function onto the free variable BFShared, once, in dot form
  //     (BFShared.name = function ...). The names must be unique across all files here.
  //   - Name each file NN_name.js: two digits, an underscore, then letters, digits, _ . or -. The
  //     fixed-width prefix is the concatenation order (a one-digit 9_x would sort after 10_x). Do not
  //     name a file .test.js or .spec.js (it would ship), and put no subdirectory, symlink or
  //     non-.js file in this directory: the sync refuses them rather than silently skip them.
  //   - Files are concatenated in filename order inside ONE function wrapper, with a line holding
  //     only a semicolon after each file, so the generated text adds exactly one top-level name,
  //     BFShared, to the app's script and to the Apps Script project. Private helpers (plain var and
  //     function declarations) share that one scope across all files, so their names must be unique
  //     too, and nothing may declare a name BFShared of its own.
  //   - Comment hazard: tests/check_team_features_logic.js strips comments from the app source with
  //     a regex that opens at every slash-star pair, so a slash-star inside a line comment, a string
  //     or a regular expression silently swallows real code up to the next close-comment. Never write
  //     that pair anywhere except as the start of a real block comment that begins its own line.
  //     The sync refuses a backtick in code, the two generated-region marker lines' exact text, a
  //     close-script tag, an HTML comment opener, a BOM and U+2028 or U+2029, anywhere in these files.
  //   - LF line endings, and the file ends with a newline.
  // Apps Script note: Shared.gs defines the global at load time, so another .gs file must use
  // BFShared only inside functions that run later, never in its own top-level statements.

  // Bumped when the meaning of an existing export changes, so a caller can refuse a mismatch.
  BFShared.API_VERSION = 1;

  // A VVD as a trimmed, upper-case string. null and undefined become '' (a blank cell); anything
  // else is converted with String().
  BFShared.normalizeVvd = function (v) {
      return String(v == null ? '' : v).trim().toUpperCase();
  };

  // True for a VVD that names a real voyage. False for blank and for 'VMS', the placeholder VVD a
  // lane carries for a week no vessel has been nominated to. For a string that is already trimmed
  // this equals the app's former inline test (vvd !== '' && vvd.toUpperCase() !== 'VMS'); unlike
  // that test it never throws, and it answers false for anything that is not a string (null,
  // undefined, numbers, objects) because those are not VVDs.
  BFShared.isRealVvd = function (v) {
      if (typeof v !== 'string') return false;
      var n = BFShared.normalizeVvd(v);
      return n !== '' && n !== 'VMS';
  };
  ;
  // ---- shared/10_diff_sailings.js ----
  // BFShared.diffSailings(prevRows, curRows, opts): the pure engine behind the "what changed since the
  // previous day" summary (roadmap slice 2.1). It compares two days of rows at the SAILING (VVD) level.
  //
  // WHY SAILING LEVEL, NEVER ROW LEVEL. A sailing has one row per port (POL), and the column
  // 'Measures Total Booking TEU by Service' repeats the SAME sailing-level number on every one of those
  // rows (0 disagreements on all 9 days of the committed history). Summing that column over rows
  // therefore counts a sailing once per port: the row-summed day totals come out about 2.6 times too
  // high (766,070 against the true 298,813 on 2026-08-30), and the rollover day-over-day net comes out
  // -66,089 where the sailing-level answer is -23,927. This function collapses each day to one value
  // per VVD first and only then compares, so the double count cannot happen.
  //
  // INPUT. Two arrays of neutral records, one per port row, mapped by the caller from the app's rows or
  // from CSV rows:
  //   { vvd, lane, saleWeek, pol, laden, booking, util }
  // vvd is normalised with BFShared.normalizeVvd; a record whose VVD is blank, 'VMS' (the placeholder a
  // lane carries for a week with no vessel nominated) or not a real VVD is ignored, and so is a record
  // that is not an object. laden, booking and util may be numbers, numeric strings or null/blank:
  //   '1,234' (thousands groups only) -> 1234, '(1,234)' -> -1234, '12%' -> 0.12 (a percent sign divides
  //   by 100, so util is always a ratio, 1.0 = 100 percent, the unit of the 'POL Booking Utilz' column),
  //   blank, null, undefined and anything that is not a plain decimal number -> null. A blank is never a
  //   zero, and a null is never turned into one: a delta is null when either side is null.
  // A numeric input is used as given, so pass util as a ratio. pol is not read (a port row is just a
  // row); it is in the shape so the caller can map a whole row without leaving the column out.
  //
  // SAILING-LEVEL VALUES (the same derivation as the reference oracles in tests/lib/history_days.js):
  //   laden    the SUM of the port rows' laden (laden is per POL row, so a sailing's laden is the sum of
  //            its ports); null only when every row's laden is null. The oracle adds a null as 0; the
  //            data has no blank laden, so the two agree on the committed history.
  //   booking  one value per sailing: the first non-null booking in input order (the oracle reads the
  //            first row). bookingConflict: true is reported when the rows disagree (a null next to a
  //            number counts as disagreeing); the committed history never does. In a conflict the value
  //            depends on row order, which is exactly why the flag exists: do not trust that sailing.
  //   util     the MAX over the port rows (the tightest port). Util is per POL row and differs across a
  //            sailing's rows (273 of 332 multi-row sailings on 2026-08-31), so there is no single
  //            sailing figure; max is exact (no averaging noise) and is the number an overbooking
  //            question is about. A change confined to a port that is not the maximum is invisible to
  //            utilDelta (laden still moves with it).
  //   lane, saleWeek  from the first row that has one, taken from the day the sailing was LAST SEEN. The
  //            sale week CAN move while a VVD stays (9 sailing-days in the 9-day history), so a sailing
  //            that is gone today is judged by the week it had yesterday, and a sailing present on both
  //            days reports today's lane and week.
  //
  // CLASSES (the PROPOSED slice 2.1 rule; it is implemented independently as classifyDisappearances and
  // classifyArrivals in tests/lib/history_days.js, and tests/shared_logic/10_diff_sailings.js checks the
  // two agree on all 8 consecutive pairs of the history so they cannot drift apart):
  //   rolledOut  gone today, and its sale week (from the day last seen) appears nowhere in today's real
  //              rows: the whole week fell out of the window.
  //   removed    gone today while its sale week still appears today: a mid-window disappearance, the
  //              signal most worth surfacing. The Past-4-Week flag is deliberately NOT used (on
  //              2026-08-24 -> 08-25, 4 of the 21 vanished sailings carry flag Y yet no week left).
  //   rolledIn   present today, absent yesterday, and its sale week did not appear in yesterday's real
  //              rows: a new week entered the window.
  //   arrived    present today, absent yesterday, its sale week already existed: a mid-window arrival
  //              (for example a vessel newly nominated).
  //   changed    present on both days and any of laden, booking or util differs (a lane change alone
  //              does not count; lane never changes in the data).
  // A sailing with a blank sale week cannot be shown to have rolled out or in, and rolledOut and
  // rolledIn are the explained, benign classes that need positive evidence, so it falls into removed
  // (gone) or arrived (new): the classes that surface it.
  //
  // BLIND SPOT, ON PURPOSE. A one-day diff cannot see history. CGBT0016E was in the file as W45 until
  // 2026-08-27, absent 08-28 to 08-30, then back as W46 on 08-31 with its cut-off moved; diffSailings
  // sees it only as rolledIn on 08-31, and a diff of 08-27 -> 08-28 sees it only as removed. Telling a
  // returning sailing from a new one needs the history index (slice 2.5), not this function.
  //
  // OUTPUT. A plain object (no Date, undefined or NaN; compare it without relying on key order):
  //   { noBaseline, noCurrent, prevSailings, curSailings,
  //     rolledOut:[sailing], removed:[sailing], rolledIn:[sailing], arrived:[sailing],
  //     changed:[{vvd, lane, saleWeek, ladenPrev, ladenCur, ladenDelta, bookingPrev, bookingCur,
  //               bookingDelta, utilPrev, utilCur, utilDelta, moved}],
  //     unchanged, movedCount, bookingConflicts:[vvd],
  //     totals: { laden: {out, in, continuing, net}, booking: {out, in, continuing, net} } }
  // where a sailing is { vvd, lane, saleWeek, laden, booking } plus bookingConflict: true when it is
  // true (the key is absent otherwise, as it is on a changed entry). Every list is sorted by VVD in
  // code-unit order, so the same days always give the same output whatever order the rows came in.
  // moved is |ladenDelta| >= opts.movedTeu (default 100; a delta of null is never moved), and movedCount
  // counts them. unchanged counts the sailings present on both days with nothing different.
  // bookingConflicts lists every VVD, on either day, whose rows disagreed on booking.
  // Totals: out is the sum of the previous-day value over rolledOut and removed, in is the sum of the
  // current-day value over rolledIn and arrived, continuing is the current-day sum minus the
  // previous-day sum over the sailings present on both days, and net is the current day's total minus
  // the previous day's, so net = in - out + continuing always. A sum skips null values (a day total
  // counts only what is known), so a continuing sailing with a null on one side adds its known side
  // to continuing although its own delta is null: that is what keeps the identity exact.
  //
  // NO COMPARISON POSSIBLE. With no real sailing on the previous day nothing can be classified (every
  // sailing would be "new" and the totals would just be today's), so noBaseline is true; with none on
  // the current day (an empty or wrong file) every sailing would be "rolled out", so noCurrent is true.
  // In both cases the object keeps its full shape (empty lists, unchanged 0, movedCount 0, so a caller
  // that reads result.rolledIn.length never crashes) with prevSailings and curSailings filled in and
  // every total null (unknown, not zero); the caller checks the two flags first. A day that is not an
  // array counts as empty.

  // A cell as a number, or null. See the INPUT notes above for the accepted forms.
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
          // Commas only as thousands separators: a stray "1,5" is more likely a decimal comma than 15.
          if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
          s = s.replace(/,/g, '');
      }
      // Plain decimals only: Number() alone would also accept '0x10', 'Infinity' and an empty string.
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
      n = Number(s);
      if (!isFinite(n)) return null;
      if (percent) n = n / 100;
      // "(-1,234)" is already negative: do not flip it back to positive.
      if (negative && n > 0) n = -n;
      return n + 0;
  }

  // Trimmed text for a lane or sale week; null and undefined are ''.
  function diffSailings_text(v) {
      return String(v == null ? '' : v).trim();
  }

  // Removes binary floating-point noise (0.84 - 0.8 is 0.03999999999999993) by rounding to 1e-9, and turns
  // -0 into 0 so the output has one zero. Magnitudes of 1e6 or more are returned as they are: the
  // multiplication would leave the exactly representable range and TEU counts there are whole numbers.
  function diffSailings_clean(x) {
      if (x === null) return null;
      if (Math.abs(x) < 1e6) x = Math.round(x * 1e9) / 1e9;
      return x + 0;
  }

  function diffSailings_cmp(a, b) {
      return a < b ? -1 : (a > b ? 1 : 0);
  }

  // One day's rows folded to one record per real VVD. Returns
  //   { map: vvd -> sailing, order: [vvd] (sorted), weeks: sale week -> true }
  // where weeks holds every sale week on any real ROW of the day, the thing the roll-out and roll-in
  // tests ask about ("appears anywhere in today's real rows"). The maps have no prototype so a VVD or
  // sale week text such as 'constructor' cannot collide with an inherited name.
  function diffSailings_day(rows) {
      var map = Object.create(null);
      var order = [];
      var weeks = Object.create(null);
      var i, r, vvd, g, lane, week, laden, booking, util;
      if (!Array.isArray(rows)) rows = [];
      for (i = 0; i < rows.length; i++) {
          r = rows[i];
          // A record that is not an object has no vvd to read and falls out at the isRealVvd test below. (No
          // typeof-object test here: the build's Babel pass answers one with a helper function, which would
          // add a second top-level name to the generated region.)
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
              g = { vvd: vvd, lane: '', saleWeek: '', laden: null, booking: null, util: null, bookingConflict: false, firstBooking: booking };
              map[vvd] = g;
              order.push(vvd);
          }
          if (g.lane === '') g.lane = lane;
          if (g.saleWeek === '') g.saleWeek = week;
          if (laden !== null) g.laden = g.laden === null ? laden : g.laden + laden;
          if (booking !== null && g.booking === null) g.booking = booking;
          // Compare every row's booking with the first row's, null included: any difference is a conflict.
          if (booking !== g.firstBooking) g.bookingConflict = true;
          if (util !== null && (g.util === null || util > g.util)) g.util = util;
      }
      order.sort(diffSailings_cmp);
      for (i = 0; i < order.length; i++) {
          g = map[order[i]];
          g.laden = diffSailings_clean(g.laden);
      }
      return { map: map, order: order, weeks: weeks };
  }

  // The sailing as it is reported in rolledOut, removed, rolledIn and arrived.
  function diffSailings_view(g) {
      var o = { vvd: g.vvd, lane: g.lane, saleWeek: g.saleWeek, laden: g.laden, booking: g.booking };
      if (g.bookingConflict) o.bookingConflict = true;
      return o;
  }

  // cur - prev, null when either side is null.
  function diffSailings_delta(prev, cur) {
      if (prev === null || cur === null) return null;
      return diffSailings_clean(cur - prev);
  }

  // True when two values are the same: both null, or both numbers that differ by less than the noise floor.
  function diffSailings_same(a, b) {
      if (a === null || b === null) return a === b;
      return diffSailings_clean(b - a) === 0;
  }

  // acc plus v, where a null v contributes nothing (a day total counts only what is known).
  function diffSailings_add(acc, v) {
      return v === null ? acc : acc + v;
  }

  function diffSailings_emptyTotals() {
      return {
          laden: { out: null, 'in': null, continuing: null, net: null },
          booking: { out: null, 'in': null, continuing: null, net: null }
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
      var sums = {
          laden: { out: 0, inn: 0, contPrev: 0, contCur: 0, prevAll: 0, curAll: 0 },
          booking: { out: 0, inn: 0, contPrev: 0, contCur: 0, prevAll: 0, curAll: 0 }
      };
      var fields = ['laden', 'booking'];
      var i, f, a, b, dl, db, du, moved, entry;

      if (threshold !== null && threshold >= 0) movedTeu = threshold;
      if (result.noBaseline || result.noCurrent) return result;

      for (i = 0; i < prev.order.length; i++) {
          a = prev.map[prev.order[i]];
          if (a.bookingConflict) conflicts[a.vvd] = true;
          for (f = 0; f < 2; f++) sums[fields[f]].prevAll = diffSailings_add(sums[fields[f]].prevAll, a[fields[f]]);
          if (cur.map[a.vvd]) continue;
          // Gone today. Judged by the sale week it had when it was last seen (yesterday).
          if (a.saleWeek !== '' && !cur.weeks[a.saleWeek]) result.rolledOut.push(diffSailings_view(a));
          else result.removed.push(diffSailings_view(a));
          for (f = 0; f < 2; f++) sums[fields[f]].out = diffSailings_add(sums[fields[f]].out, a[fields[f]]);
      }

      for (i = 0; i < cur.order.length; i++) {
          b = cur.map[cur.order[i]];
          a = prev.map[b.vvd];
          if (b.bookingConflict) conflicts[b.vvd] = true;
          for (f = 0; f < 2; f++) sums[fields[f]].curAll = diffSailings_add(sums[fields[f]].curAll, b[fields[f]]);
          if (!a) {
              if (b.saleWeek !== '' && !prev.weeks[b.saleWeek]) result.rolledIn.push(diffSailings_view(b));
              else result.arrived.push(diffSailings_view(b));
              for (f = 0; f < 2; f++) sums[fields[f]].inn = diffSailings_add(sums[fields[f]].inn, b[fields[f]]);
              continue;
          }
          for (f = 0; f < 2; f++) {
              sums[fields[f]].contPrev = diffSailings_add(sums[fields[f]].contPrev, a[fields[f]]);
              sums[fields[f]].contCur = diffSailings_add(sums[fields[f]].contCur, b[fields[f]]);
          }
          if (diffSailings_same(a.laden, b.laden) && diffSailings_same(a.booking, b.booking) && diffSailings_same(a.util, b.util)) {
              result.unchanged++;
              continue;
          }
          dl = diffSailings_delta(a.laden, b.laden);
          db = diffSailings_delta(a.booking, b.booking);
          du = diffSailings_delta(a.util, b.util);
          moved = dl !== null && Math.abs(dl) >= movedTeu;
          if (moved) result.movedCount++;
          entry = {
              vvd: b.vvd, lane: b.lane, saleWeek: b.saleWeek,
              ladenPrev: a.laden, ladenCur: b.laden, ladenDelta: dl,
              bookingPrev: a.booking, bookingCur: b.booking, bookingDelta: db,
              utilPrev: a.util, utilCur: b.util, utilDelta: du,
              moved: moved
          };
          if (a.bookingConflict || b.bookingConflict) entry.bookingConflict = true;
          result.changed.push(entry);
      }

      result.bookingConflicts = Object.keys(conflicts).sort(diffSailings_cmp);
      for (f = 0; f < 2; f++) {
          a = sums[fields[f]];
          result.totals[fields[f]] = {
              out: diffSailings_clean(a.out),
              'in': diffSailings_clean(a.inn),
              continuing: diffSailings_clean(a.contCur - a.contPrev),
              net: diffSailings_clean(a.curAll - a.prevAll)
          };
      }
      return result;
  };
  ;
  // ---- shared/20_feed_canary.js ----
  // BFShared.checkFeed: the "silent canary" (roadmap slice 1.5). A pure check meant to run on every data
  // load: it says nothing while the feed is healthy and returns a precise problem list when the feed
  // breaks an assumption the app's numbers rest on.
  //
  // WHY IT EXISTS. A renamed or inserted column has silently broken numbers before (the "alias landmine"
  // class, DATA_ARCHITECTURE.md), and the export's width has already changed under the app, shifting dozens
  // of columns. So columns are found BY NAME, never by position, and a missing name is reported instead of
  // being papered over by getVal()'s substring fallback.
  //
  // WHAT IT CHECKS, and the code each problem carries:
  //   BAD_INPUT            the call itself was malformed (it never throws; it says so here instead)
  //   DUPLICATE_HEADER     two headers read as the same name once case, spaces and punctuation are ignored
  //   MISSING_FIELD        a required field has no alias that matches any header (or a column this check
  //                        itself needs, such as the VVD or a key column, is absent)
  //   NO_ROWS              the feed has no rows at all
  //   NO_REAL_ROWS         it has rows, but every one is a placeholder (blank or VMS vessel/voyage)
  //   ROW_COUNT_DROP       far fewer rows than the previous load
  //   DUPLICATE_KEY        the key columns repeat among the real rows
  //   VOYAGE_DISAGREEMENT  a voyage-level column differs across the port rows of one VVD
  //
  // Problems are listed in that order (BAD_INPUT first), so the same feed always gives the same list.
  //
  // NAME MATCHING mirrors the app: a name is "cleaned" (lower case, only letters and digits kept) before
  // it is compared, so a header that gained a space or changed case still matches, and a header renamed to
  // anything else does not. Only the exact cleaned match counts. getVal() has a second, substring pass;
  // it is deliberately NOT used here, because a field that only resolves through it is exactly the
  // silent-corruption case this canary exists to catch. When two headers clean to the same name the LAST
  // one supplies the values, as it does in the app's own value lookup (and DUPLICATE_HEADER reports it).
  //
  // REAL ROWS. VMS rows are placeholders for a week no vessel has been nominated to. They all share the
  // key (VMS, blank, blank), so counting them would report dozens of false duplicates every day (65 to 73
  // on the committed 9-day data). Everything row-level ignores them; BFShared.isRealVvd decides.
  //
  // Never mutates its input. Reads only the handful of columns it needs, so 10,000 rows by 100 columns
  // take well under a tenth of a second.

  var checkFeed_DEFAULT_KEYS = ['Vessel 1st VVD', 'Route Location Calling Port Seq', 'Route Location 1st Pol'];
  var checkFeed_DEFAULT_VOYAGE_FIELDS = ['MCT PIC', 'Vessel 1st Lane', 'MCT Max Laden', 'Route Date Cut/off Date', 'Route Date 1st Sale Week'];
  var checkFeed_DEFAULT_VVD_COLUMN = 'Vessel 1st VVD';
  var checkFeed_DEFAULT_MAX_DROP_PCT = 10;
  // Output stays small however broken the feed is: a feed with thousands of repeats still yields a
  // problem list a person can read, with the totals in the detail.
  var checkFeed_MAX_EXAMPLES = 5;
  var checkFeed_MAX_VALUES = 10;

  // The app's own cleaning rule (see getVal in the app file), so a name matches here exactly when it
  // would match there.
  function checkFeed_clean(s) {
      return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // A cell as comparable text: blank for null and undefined, otherwise trimmed. A number cell and a text
  // cell that print alike must compare alike, and stray spaces are not a data difference.
  function checkFeed_text(v) {
      if (typeof v === 'string') return v.trim();
      return v === null || v === undefined ? '' : String(v).trim();
  }

  // True for objects and arrays, false for null, undefined, numbers, text and functions. Written without
  // typeof compared to the word object on purpose: the build compiles the shared region with Babel, which
  // would turn that comparison into a helper function (_typeof) and add a second top-level name to the
  // app script (tests/check_shared_sync.js fails on it).
  function checkFeed_isObject(x) {
      return Object(x) === x && typeof x !== 'function';
  }

  function checkFeed_problem(code, message, detail) {
      return { code: code, message: message, detail: detail };
  }

  function checkFeed_badInput(what, message, extra) {
      var detail = { what: what };
      if (extra) {
          for (var k in extra) {
              if (Object.prototype.hasOwnProperty.call(extra, k)) detail[k] = extra[k];
          }
      }
      return checkFeed_problem('BAD_INPUT', message, detail);
  }

  // The text of a caught error. A hostile input can make even reading the message throw.
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

  // A value for a message: blank is spelled out so an empty cell is visible.
  function checkFeed_show(v) {
      return v === '' ? '(blank)' : '"' + v + '"';
  }

  // An optional list of column names. Missing means "use the default"; a list with anything that is not a
  // usable name is reported and replaced by the default, so a typo cannot quietly switch a check off.
  function checkFeed_nameList(value, fallback, what, bad) {
      if (value === undefined || value === null) return fallback;
      if (Array.isArray(value)) {
          var usable = true;
          for (var i = 0; i < value.length; i++) {
              if (typeof value[i] !== 'string' || checkFeed_clean(value[i]) === '') usable = false;
          }
          if (usable) return value;
      }
      bad.push(checkFeed_badInput(what, what + ' must be a list of non-blank column names; the default list was used instead'));
      return fallback;
  }

  // requiredFields: [{ key, aliases: [names] }]. A malformed entry is reported (with its position) and
  // skipped, because it cannot be checked and must not look like a pass.
  function checkFeed_readRequired(value, bad) {
      var out = [];
      if (value === undefined || value === null) return out;
      if (!Array.isArray(value)) {
          bad.push(checkFeed_badInput('requiredFields', 'requiredFields must be a list of { key, aliases } entries'));
          return out;
      }
      var badAt = [];
      for (var i = 0; i < value.length; i++) {
          var f = value[i];
          var usable = checkFeed_isObject(f) && Array.isArray(f.aliases) && f.aliases.length > 0;
          for (var j = 0; usable && j < f.aliases.length; j++) {
              if (typeof f.aliases[j] !== 'string') usable = false;
          }
          if (!usable) { badAt.push(i); continue; }
          var key = f.key === undefined || f.key === null || f.key === '' ? f.aliases[0] : String(f.key);
          out.push({ key: key, aliases: f.aliases.slice() });
      }
      if (badAt.length) {
          bad.push(checkFeed_badInput('requiredFields', 'requiredFields entries at position(s) ' + badAt.join(', ') + ' need a non-empty list of text aliases; they were skipped', { positions: badAt }));
      }
      return out;
  }

  // Maps each cleaned header to the position of its LAST occurrence (the one the app reads) and records
  // every group of headers that clean alike. Keys are prefixed with a letter so data such as
  // "constructor" or "__proto__" can never collide with a property every object inherits. Headers that
  // clean to nothing (a blank column) are skipped: no alias can match them, and several blank columns
  // are not a duplicate.
  function checkFeed_indexHeaders(headers) {
      var last = {};
      var groups = {};
      var order = [];
      for (var i = 0; i < headers.length; i++) {
          var c = checkFeed_clean(headers[i]);
          if (c === '') continue;
          var k = 'k' + c;
          last[k] = i;
          if (groups[k] === undefined) { groups[k] = [i]; order.push(c); } else groups[k].push(i);
      }
      return { last: last, groups: groups, order: order };
  }

  // The column a wanted name resolves to, or null. name is the header text, which is what object rows are
  // keyed by. inherited marks a header spelled like a property every object has ("constructor"): only
  // those need the slower own-property read in checkFeed_cell.
  function checkFeed_findColumn(index, headers, wanted) {
      var c = checkFeed_clean(wanted);
      if (c === '') return null;
      var at = index.last['k' + c];
      if (at === undefined) return null;
      var name = String(headers[at]);
      return { idx: at, name: name, wanted: wanted, inherited: name in Object.prototype };
  }

  // One cell of a row, whether the row is an object keyed by header or an array in header order. A header
  // named like an inherited property reads its own value only, so it cannot return a function.
  function checkFeed_cell(row, isArray, col) {
      if (isArray) return row[col.idx];
      if (col.inherited) return Object.prototype.hasOwnProperty.call(row, col.name) ? row[col.name] : undefined;
      return row[col.name];
  }

  // One pass over the rows. Returns the real-row count, the unreadable rows, the repeated keys and the
  // voyage-level disagreements. keyCols and voyageCols are lists of resolved columns (either may be empty).
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
              var parts = [];
              var key = '';
              for (j = 0; j < keyCols.length; j++) {
                  var part = checkFeed_text(checkFeed_cell(row, isArray, keyCols[j]));
                  if (keyCols[j].idx === vvdCol.idx) part = BFShared.normalizeVvd(part);
                  parts.push(part);
                  // length-prefixed, so no choice of cell text can make two different keys join alike
                  key += part.length + ':' + part + '|';
              }
              var fk = 'k' + key;
              if (firstSeen[fk] === undefined) {
                  firstSeen[fk] = i;
              } else {
                  extraRows++;
                  var di = dupAt[fk];
                  if (di === undefined) {
                      dupAt[fk] = dups.length;
                      dups.push({ key: parts, count: 2, rowIndexes: [firstSeen[fk], i] });
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
                  rec = { vvd: vvdKey, first: [], extra: [] };
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
                          ex = { list: [rec.first[j]], seen: {} };
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
      return { real: real, badRows: badRows, firstBadRow: firstBadRow, dups: dups, extraRows: extraRows, voyages: voyages };
  }

  // The body of checkFeed. Collects problems into one list per code so the final order is fixed.
  function checkFeed_run(input) {
      var lists = { bad: [], headers: [], missing: [], rows: [], drop: [], dup: [], voyage: [] };
      var stats = { rowCount: 0, realRowCount: null, headerCount: 0 };
      var finish = function () {
          var problems = [].concat(lists.bad, lists.headers, lists.missing, lists.rows, lists.drop, lists.dup, lists.voyage);
          return { ok: problems.length === 0, problems: problems, stats: stats };
      };

      if (!checkFeed_isObject(input)) {
          lists.bad.push(checkFeed_badInput('input', 'checkFeed needs an object like { headers, rows, requiredFields }'));
          return finish();
      }
      var headers = input.headers;
      var rows = input.rows;
      var headersOk = Array.isArray(headers);
      var rowsOk = Array.isArray(rows);
      if (headersOk) stats.headerCount = headers.length;
      else lists.bad.push(checkFeed_badInput('headers', 'headers must be a list of column names'));
      if (rowsOk) stats.rowCount = rows.length;
      else lists.bad.push(checkFeed_badInput('rows', 'rows must be a list of row objects (or row arrays)'));

      var keyNames = checkFeed_nameList(input.keyColumns, checkFeed_DEFAULT_KEYS, 'keyColumns', lists.bad);
      var voyageNames = checkFeed_nameList(input.voyageFields, checkFeed_DEFAULT_VOYAGE_FIELDS, 'voyageFields', lists.bad);
      var vvdName = input.vvdColumn;
      if (vvdName === undefined || vvdName === null) vvdName = checkFeed_DEFAULT_VVD_COLUMN;
      else if (typeof vvdName !== 'string' || checkFeed_clean(vvdName) === '') {
          lists.bad.push(checkFeed_badInput('vvdColumn', 'vvdColumn must be a non-blank column name; the default was used instead'));
          vvdName = checkFeed_DEFAULT_VVD_COLUMN;
      }
      var required = checkFeed_readRequired(input.requiredFields, lists.bad);
      var prev = input.prevRowCount;
      if (prev === undefined || prev === null) prev = null;
      else if (typeof prev !== 'number' || !isFinite(prev) || prev < 0) {
          lists.bad.push(checkFeed_badInput('prevRowCount', 'prevRowCount must be a number of rows (0 or more) or null; no row-count comparison was made'));
          prev = null;
      }
      var maxDrop = input.maxRowDropPct;
      if (maxDrop === undefined || maxDrop === null) maxDrop = checkFeed_DEFAULT_MAX_DROP_PCT;
      else if (typeof maxDrop !== 'number' || !isFinite(maxDrop) || maxDrop < 0) {
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
              if (members.length < 2) continue;
              var names = [];
              for (var m = 0; m < members.length; m++) names.push(String(headers[members[m]]));
              lists.headers.push(checkFeed_problem('DUPLICATE_HEADER',
                  'Columns ' + members.join(', ') + ' (' + names.map(checkFeed_show).join(', ') + ') are the same name once case, spaces and punctuation are ignored; the app reads the last one',
                  { cleaned: index.order[g], headers: names, indexes: members }));
          }

          // A name is reported missing once, however many ways it was asked for.
          var reported = {};
          var reportMissing = function (key, aliases, role) {
              lists.missing.push(checkFeed_problem('MISSING_FIELD',
                  (role === 'required' ? 'Required field "' + key + '"' : 'The ' + role + ' column "' + key + '"') + ' matches no column in the feed (looked for: ' + aliases.join(', ') + ')',
                  { key: key, aliases: aliases, role: role }));
          };
          for (var r = 0; r < required.length; r++) {
              var found = false;
              for (var a = 0; a < required[r].aliases.length; a++) {
                  var ca = checkFeed_clean(required[r].aliases[a]);
                  if (ca !== '' && index.last['k' + ca] !== undefined) found = true;
              }
              if (found) continue;
              for (a = 0; a < required[r].aliases.length; a++) reported['k' + checkFeed_clean(required[r].aliases[a])] = true;
              reportMissing(required[r].key, required[r].aliases.slice(), 'required');
          }
          // The columns this check itself reads. A missing one would otherwise either switch its check off
          // without a word or (a blank key) invent duplicates.
          var need = function (name, role) {
              var col = checkFeed_findColumn(index, headers, name);
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
              if (kc === null) keyUsable = false;
              else keyCols.push(kc);
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
              lists.bad.push(checkFeed_badInput('rows',
                  checkFeed_plural(scan.badRows, 'row is', 'rows are') + ' not an object or array (first at position ' + scan.firstBadRow + '); skipped',
                  { badRowCount: scan.badRows, firstBadRowIndex: scan.firstBadRow }));
          }
      }

      if (rowsOk) {
          if (rows.length === 0) {
              lists.rows.push(checkFeed_problem('NO_ROWS', 'The feed has no data rows', { rowCount: 0 }));
          } else if (scan !== null && scan.real === 0) {
              lists.rows.push(checkFeed_problem('NO_REAL_ROWS',
                  'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ' but every one is a placeholder (blank or VMS vessel/voyage), so it holds no real sailing',
                  { rowCount: rows.length, vvdColumn: vvdName }));
          }
          // Cross-multiplied, not divided: an exact 10% drop must not be pushed over the limit by rounding.
          if (prev !== null && prev > 0 && (prev - rows.length) * 100 > maxDrop * prev) {
              var dropPct = Math.round((prev - rows.length) / prev * 10000) / 100;
              lists.drop.push(checkFeed_problem('ROW_COUNT_DROP',
                  'The feed has ' + checkFeed_plural(rows.length, 'row', 'rows') + ', down from ' + prev + ' (a ' + dropPct + '% drop; the limit is ' + maxDrop + '%)',
                  { rowCount: rows.length, prevRowCount: prev, dropPct: dropPct, maxRowDropPct: maxDrop }));
          }
      }

      if (scan !== null && scan.dups.length > 0) {
          var keyLabels = [];
          for (var n = 0; n < keyCols.length; n++) keyLabels.push(keyCols[n].wanted);
          var dupExamples = scan.dups.slice(0, checkFeed_MAX_EXAMPLES);
          lists.dup.push(checkFeed_problem('DUPLICATE_KEY',
              checkFeed_plural(scan.extraRows, 'real row repeats', 'real rows repeat') + ' an earlier row\'s key (' + keyLabels.join(' + ') + '), across ' + checkFeed_plural(scan.dups.length, 'key', 'keys') + '; for example ' + dupExamples[0].key.map(checkFeed_show).join(' + ') + ' appears ' + dupExamples[0].count + ' times',
              { keyColumns: keyLabels, duplicateKeyCount: scan.dups.length, extraRows: scan.extraRows, examples: dupExamples }));
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
                      examples.push({ vvd: rec.vvd, field: voyageCols[y].wanted, values: rec.extra[y].list.slice(0, checkFeed_MAX_VALUES), valueCount: rec.extra[y].list.length });
                  }
              }
              if (any) voyageCount++;
          }
          if (voyageCount > 0) {
              lists.voyage.push(checkFeed_problem('VOYAGE_DISAGREEMENT',
                  checkFeed_plural(voyageCount, 'voyage carries', 'voyages carry') + ' different values across its port rows in a voyage-level column; for example VVD ' + examples[0].vvd + ', ' + examples[0].field + ': ' + examples[0].values.map(checkFeed_show).join(' vs '),
                  { voyageCount: voyageCount, pairCount: pairCount, examples: examples }));
          }
      }
      return finish();
  }

  // checkFeed({ headers, rows, requiredFields, keyColumns, voyageFields, prevRowCount, maxRowDropPct,
  //             vvdColumn }) -> { ok, problems: [{ code, message, detail }], stats }
  //   headers         list of the column names, in file order
  //   rows            list of row objects keyed by those names (a row may also be an array in header order)
  //   requiredFields  [{ key, aliases: [names] }]: each needs at least one alias that matches a header
  //   keyColumns      the columns that identify one port row of one voyage
  //   voyageFields    columns that must hold one value across all port rows of a VVD
  //   prevRowCount    the previous load's row count, or null when there is none (no comparison is made)
  //   maxRowDropPct   how far below prevRowCount the row count may fall before it is a problem
  //   vvdColumn       the column holding the VVD, which decides which rows are placeholders
  // stats is { rowCount, realRowCount, headerCount }; realRowCount is null when the VVD column is absent
  // (nothing row-level can be judged then). ok is true only when problems is empty. Every check that
  // cannot run reports why, so ok === true also means every check ran.
  // It never throws: input it cannot read comes back as a BAD_INPUT problem, and a last-resort handler
  // turns anything unforeseen into one, because a canary that crashes the data load is worse than none.
  BFShared.checkFeed = function (input) {
      try {
          return checkFeed_run(input);
      } catch (e) {
          return {
              ok: false,
              problems: [checkFeed_badInput('exception', 'checkFeed could not read its input without an error', { error: checkFeed_errorText(e) })],
              stats: { rowCount: 0, realRowCount: null, headerCount: 0 }
          };
      }
  };
  ;
  // ---- shared/30_view_codec.js ----
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
  ;
  return BFShared;
})();

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
//            number counts as disagreeing; two numbers disagree when their difference rounds to non-zero at 1e-9 (from about 5e-10), the same
//            noise floor as the change test, so 0.1 + 0.2 against 0.3 is no conflict); the committed history never does. In a conflict the value
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
//     totals: { laden: {out, in, arrived, continuing, net}, booking: {out, in, arrived, continuing, net} } }
// where a sailing is { vvd, lane, saleWeek, laden, booking } plus bookingConflict: true when it is
// true (the key is absent otherwise, as it is on a changed entry). Every list is sorted by VVD in
// code-unit order, so the same days always give the same output whatever order the rows came in.
// moved is |ladenDelta| >= opts.movedTeu (default 100) with a real change: a delta of null or of 0 is never
// moved, so at movedTeu 0 a sailing that changed only in booking or util is still not moved. movedCount
// counts them. unchanged counts the sailings present on both days with nothing different.
// bookingConflicts lists every VVD, on either day, whose rows disagreed on booking, also when noBaseline or
// noCurrent is true (then it covers the one day that exists).
// Totals: out is the sum of the previous-day value over rolledOut and removed, in is the sum of the
// current-day value over rolledIn and arrived, arrived is the same sum over arrived alone (new demand
// that is not a week entering the window), continuing is the current-day sum minus the previous-day
// sum over the sailings present on both days, and net is in - out + continuing, which for complete
// data is the current day's total minus the previous day's. A sum skips null values (a day total
// counts only what is known), but a blank is never a zero: a total is null when its group holds
// sailings and every one of them is null (for continuing, null on either day), and when a field is
// null on every sailing of both days all five of its totals are null. A group with no sailings at all
// (nothing rolled out) is a real 0. net is null when no known value fed out, in or continuing at all.
// A sailing present on both days counts toward continuing, and toward net, only when its own delta is
// known: if the value is null on either side (laden 100 yesterday, blank or not a number today) the
// sailing contributes nothing to continuing and its known side is left out of net as well, so
// net = in - out + continuing holds exactly (a null total counted as nothing) and a sailing that merely
// lost its reading never shows up as a drop of its old value.
// NO COMPARISON POSSIBLE. With no real sailing on the previous day nothing can be classified (every
// sailing would be "new" and the totals would just be today's), so noBaseline is true; with none on
// the current day (an empty or wrong file) every sailing would be "rolled out", so noCurrent is true.
// In both cases the object keeps its full shape (empty lists, unchanged 0, movedCount 0, so a caller
// that reads result.rolledIn.length never crashes) with prevSailings and curSailings filled in and
// every total null (unknown, not zero); the caller checks the two flags first. bookingConflicts is the
// one list that is still filled in: it names the conflicts on whichever day exists. A day that is not an
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
        // Compare every row's booking with the first row's, null included: any difference is a conflict. The
        // same noise floor as the change test (diffSailings_same), so 0.1 + 0.2 against 0.3 is no conflict.
        if (!diffSailings_same(booking, g.firstBooking)) g.bookingConflict = true;
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

// A running total for one group of sailings: { sum, seen, known }. A null value contributes nothing to
// sum, but it is counted in seen, so the group can tell "no sailing in it" (a true zero) from "sailings
// whose value is blank" (unknown).
function diffSailings_acc() {
    return { sum: 0, seen: 0, known: 0 };
}

// Adds one sailing's value to a group (for a continuing sailing, v is its delta, null when either side is null).
function diffSailings_take(acc, v) {
    acc.seen++;
    if (v !== null) {
        acc.sum += v;
        acc.known++;
    }
}

// The group's total, or null when the group has sailings and none of them has a known value (a blank is
// never a zero). A group with no sailings at all is a real zero: nothing rolled out, nothing arrived.
function diffSailings_total(acc) {
    if (acc.seen > 0 && acc.known === 0) return null;
    return diffSailings_clean(acc.sum);
}

function diffSailings_emptyTotals() {
    return {
        laden: { out: null, 'in': null, arrived: null, continuing: null, net: null },
        booking: { out: null, 'in': null, arrived: null, continuing: null, net: null }
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
        laden: { out: diffSailings_acc(), inn: diffSailings_acc(), arr: diffSailings_acc(), cont: diffSailings_acc() },
        booking: { out: diffSailings_acc(), inn: diffSailings_acc(), arr: diffSailings_acc(), cont: diffSailings_acc() }
    };
    var anyKnown = { laden: false, booking: false };
    var i, f, a, b, dl, db, du, moved, entry;

    if (threshold !== null && threshold >= 0) movedTeu = threshold;

    // Booking conflicts are collected first, for every VVD on either day, so they are still reported when
    // there is no baseline or no current day to compare against (the day that exists is still one the
    // caller must not trust blindly).
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
        // Gone today. Judged by the sale week it had when it was last seen (yesterday).
        if (a.saleWeek !== '' && !cur.weeks[a.saleWeek]) result.rolledOut.push(diffSailings_view(a));
        else result.removed.push(diffSailings_view(a));
        for (f = 0; f < 2; f++) diffSailings_take(sums[fields[f]].out, a[fields[f]]);
    }

    for (i = 0; i < cur.order.length; i++) {
        b = cur.map[cur.order[i]];
        a = prev.map[b.vvd];
        if (!a) {
            if (b.saleWeek !== '' && !prev.weeks[b.saleWeek]) result.rolledIn.push(diffSailings_view(b));
            else {
                result.arrived.push(diffSailings_view(b));
                for (f = 0; f < 2; f++) diffSailings_take(sums[fields[f]].arr, b[fields[f]]);
            }
            for (f = 0; f < 2; f++) diffSailings_take(sums[fields[f]].inn, b[fields[f]]);
            continue;
        }
        for (f = 0; f < 2; f++) {
            // Only a sailing whose delta is known counts: a null on either side adds nothing here.
            diffSailings_take(sums[fields[f]].cont, a[fields[f]] !== null && b[fields[f]] !== null ? b[fields[f]] - a[fields[f]] : null);
        }
        if (diffSailings_same(a.laden, b.laden) && diffSailings_same(a.booking, b.booking) && diffSailings_same(a.util, b.util)) {
            result.unchanged++;
            continue;
        }
        dl = diffSailings_delta(a.laden, b.laden);
        db = diffSailings_delta(a.booking, b.booking);
        du = diffSailings_delta(a.util, b.util);
        // dl is already cleaned of float noise, so dl !== 0 means a real change: with movedTeu 0 a sailing whose
        // laden did not move (only booking or util changed) is still not "moved".
        moved = dl !== null && dl !== 0 && Math.abs(dl) >= movedTeu;
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

    for (f = 0; f < 2; f++) {
        a = sums[fields[f]];
        // A field that is blank on every sailing of both days is unknown in every total, even the groups
        // that happen to be empty. Otherwise each group is null only when it has sailings and none is known.
        // net is null when nothing at all fed it (out, in and continuing all unknown or empty of known values).
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

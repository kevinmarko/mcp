// Exceptions over several archive days (Phase 2 slice 2a-2; roadmap 3.1; decisions D2, D3, D4). Two pure functions:
//   BFShared.findExceptions(days, config)  -> [{ vvd, lane, rule, days, since, detail, cutoff }]
//   BFShared.sortExceptions(list, by)      -> a new sorted array; by is 'days', 'cutoff' or 'rule' (the default)
//
// INPUT. days = [{ date: 'YYYY-MM-DD', rows }] in any order, one entry per archive day. Entries that are not objects, whose date
// is not a real calendar day (feedAge_isCalendarDate) or whose rows are not an array are ignored; two entries with one date are
// one day (their rows are joined). A row is a neutral record, one per sailing-port:
//   { vvd, pol, lane, pic, maxLaden, overall, loading, ladenPol, bookingSailing, cutoff, polCutoff }
//   vvd      normalised with BFShared.normalizeVvd; blank and the VMS placeholder (BFShared.isRealVvd) are skipped.
//   pol      the port, trimmed and upper-cased (used in the details).
//   lane     the service lane, trimmed and upper-cased. A sailing's lane is the first non-blank lane of its rows on the as-of day.
//   pic      the 'MCT PIC' text, read with BFShared.parsePic.
//   maxLaden        'MCT Max Laden'. It is the same on every row of a sailing in the 9-day data (checked on all 3,342 sailing-days).
//   overall         'MCT Overall Threshold' (the app's trunk / standby threshold), the sailing's ceiling over Max Laden (D2).
//   loading         'MCT Loading Threshold', the same ceiling per POL (D2).
//   ladenPol        the laden TEU at this POL: 'Measures POL Laden TEU' (the app's own first choice); the caller falls back to
//                   'Measures Laden TEU' only when the POL column is absent from its data.
//   bookingSailing  'Measures Total Booking TEU by Service': the sailing-level booking total, repeated on every port row.
//   cutoff, polCutoff  the sailing's cut-off ('Route Date Cut/off Date') and this port's cut-off ('Route Date POL Cut/off Date')
//                   as 'YYYY-MM-DD' (a trailing time after a space or T is ignored). Blank when none; a value in any other form
//                   counts as none.
// maxLaden, overall, loading, ladenPol and bookingSailing are numbers or plain numeric strings; anything else reads as missing.
// overall and loading are read with BFShared.thresholdValue, so 0, 0.01, blank and non-numeric are "not set".
//
// THE AS-OF DAY AND STREAKS. The as-of day is config.asOf, else the latest usable date. A sailing is only an exception if it is
// present on the as-of day, and its streak is the number of CONSECUTIVE CALENDAR days ending on the as-of day on which the
// rule's test held for it. A day on which the sailing is absent, and a missing calendar day between two archive days, both
// end the streak (a sailing that was not in the file cannot have been unowned that day; the same reading as the
// unownedStreaks oracle in tests/lib/history_days.js). Days after the as-of day are never read. If no usable day has the
// as-of date the answer is []. since is the first date of the streak.
//
// RULES. rule is one of four words, in this order.
//   'unowned'         (a) every port row of the sailing is unowned (BFShared.parsePic: owned is false; D4: blank, TBA and Resid
//                     are unowned, EC SPC and WC SPC are the team) for at least config.n consecutive days. Sailings on a free
//                     lane (config.freeLanes, default FLX: a blank PIC is normal there) are never reported by this rule.
//   'over_booking'    (b1, D2) per SAILING: the booking total (bookingSailing, the first usable value among the sailing's rows) is
//                     strictly above the sailing's Max Laden times its overall threshold, for at least config.n consecutive days.
//                     The sailing's Max Laden is the first row's maxLaden that is above zero (it does not vary within a sailing in
//                     the data; the first-row choice is only a tie-break), and its overall threshold is the first row's that is set.
//                     Max Laden not above zero (no cap), or the overall threshold not set, means no rule.
//   'over_laden'      (b2, D2) per POL row: ladenPol is strictly above that row's maxLaden times that row's loading threshold. A
//                     sailing is flagged when ANY of its port rows is over, for at least config.n consecutive days. A row whose
//                     maxLaden is not above zero or whose loading threshold is not set is never over.
//   Lead time (both over_ rules). When config.leadDaysMin is above zero, a sailing whose earliest cut-off on the as-of day (either
//                     cut-off column, any row) is fewer than that many days after the as-of day (including one already past) is
//                     left out, because it will probably correct itself. A sailing with no usable cut-off is kept (lead time
//                     unknown). Zero (the default) turns the lead-time test off.
//   'no_cutoff'       (c) a real (nominated) sailing none of whose port rows has a usable date in EITHER cut-off column, for at
//                     least config.noCutoffDays consecutive days (default 1: whether this rule should carry a day count is an
//                     open question, slice 3.3 K4). It is NOT exempt on free lanes; each result carries the lane, so a caller can
//                     filter.
//
// KNOWN DATA ARTIFACT. In the 9-day CSV the laden figure at USHOU (and some other ports) doubles over a weekend (for example
// LHTT2631S: 232, 232, 464, 464, 464, 232 from 08-28 to 09-01; roadmap 3.1 notes the same jump in the "laden over Max Laden"
// count), so over_laden rises on those days without any real change. Nothing here corrects for it.
//
// CONFIG. Every key is optional, and a bad value falls back to its default: n (a whole number from 1; default 3, decision D3),
// freeLanes (an array of lane names, compared trimmed and upper-case; default ['FLX']; [] means no exemption; not an array means
// the default), leadDaysMin (a finite number from 0; default 0), noCutoffDays (a whole number from 1; default 1), asOf (a
// real 'YYYY-MM-DD'; default the latest usable date; a bad value means the default). A config that is not an object is {}.
//
// OUTPUT. days is the streak length and since its first date. detail is a short sentence a person can read: the PICs for 'unowned',
// the figure and the cap for 'over_booking', the ports over (with the figure and the cap) for 'over_laden', the number of port
// rows for 'no_cutoff'. cutoff is the earliest usable cut-off of the sailing on the as-of day (either column), or '' (an addition
// to the roadmap's output list, there so a caller can sort by it). Sorted by sortExceptions(list, 'rule') order: rule (unowned,
// over_booking, over_laden, no_cutoff), then more days first, then vvd. At most one result per sailing per rule, so (vvd, rule)
// is unique and the order is total.
//
// sortExceptions(list, by) returns a new array (the input is not changed; entries that are not exception-shaped objects are
// dropped): 'days' = most days first, then earliest cut-off first (a blank cut-off last), then vvd, then rule; 'cutoff' = earliest cut-off
// first (blank last), then most days first, then vvd, then rule; anything else, or no argument, = 'rule' order.
//
// None of them reads a clock (the calendar arithmetic is done by hand) or any global but the ES5 built-ins; none throws.

var exceptions_RULES = ['unowned', 'over_booking', 'over_laden', 'no_cutoff'];

// Days since 0000-03-01 for a valid 'YYYY-MM-DD' (the civil-from-days algorithm); only differences are used.
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

// A cut-off as 'YYYY-MM-DD', or '' when it is blank or not a date in that form.
function exceptions_cutoff(v) {
    var s;
    if (typeof v !== 'string') return '';
    s = thresholdDiff_trim(v);
    if (!/^\d{4}-\d{2}-\d{2}($|[ T])/.test(s)) return '';
    s = s.slice(0, 10);
    return feedAge_isCalendarDate(s) ? s : '';
}

function exceptions_wholeFrom(v, min, fallback) {
    return (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min) ? v : fallback;
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
        leadDaysMin: (typeof c.leadDaysMin === 'number' && isFinite(c.leadDaysMin) && c.leadDaysMin >= 0) ? c.leadDaysMin : 0,
        freeLanes: free,
        asOf: feedAge_isCalendarDate(c.asOf) ? c.asOf : null
    };
}

function exceptions_fmt(x) {
    return String(Math.round(x * 100) / 100);
}

// One day's facts per sailing, keyed 'v' + vvd: { vvd, lane, unowned, pics, overBooking, overPorts, noCutoff, portRows, cutoff }.
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
            s = out[key] = { vvd: vvd, lane: '', unowned: true, pics: [], overPorts: [], noCutoff: true, portRows: 0, cutoff: '', maxLaden: null, overall: null, booking: null };
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
    return { sailings: out, order: order };
}

function exceptions_ruleIndex(rule) {
    return rule === 'unowned' ? 0 : (rule === 'over_booking' ? 1 : (rule === 'over_laden' ? 2 : 3));
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
    out.sort(function (a, b) { return exceptions_compare(a, b, by); });
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
        if (!Object.prototype.hasOwnProperty.call(byDate, key)) { byDate[key] = []; dates.push(d.date); }
        byDate[key] = byDate[key].concat(d.rows);
    }
    dates.sort();
    asOf = cfg.asOf === null ? (dates.length ? dates[dates.length - 1] : null) : cfg.asOf;
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
                if (ruleNo === 0 ? !f.unowned : (ruleNo === 1 ? f.overBooking === '' : (ruleNo === 2 ? f.overPorts.length === 0 : !f.noCutoff))) break;
                streak++;
                prevNum = exceptions_dayNumber(dates[j]);
            }
            if (streak < need) continue;
            if ((ruleNo === 1 || ruleNo === 2) && cfg.leadDaysMin > 0 && s.cutoff !== '') {
                lead = exceptions_dayNumber(s.cutoff) - dayNum;
                if (lead < cfg.leadDaysMin) continue;
            }
            e = {
                vvd: s.vvd, lane: s.lane, rule: exceptions_RULES[ruleNo], days: streak, since: dates[asOfIdx - streak + 1], cutoff: s.cutoff,
                detail: ruleNo === 0 ? 'No owner: PIC ' + s.pics.sort().join(' | ')
                    : (ruleNo === 1 ? s.overBooking : (ruleNo === 2 ? s.overPorts.sort().join('; ') : 'No cut-off on ' + s.portRows + (s.portRows === 1 ? ' port row' : ' port rows')))
            };
            out.push(e);
        }
    }
    return BFShared.sortExceptions(out, 'rule');
};

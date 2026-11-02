// Three small pure helpers for the data-age label and for the "compare with the previous day" loader
// (roadmap slices 1.1 and 2.2):
//
//   BFShared.formatAge(ageMs)                          -> 'just now', '16 min ago', '2 h 5 min ago', '3 days ago', or ''
//   BFShared.feedFreshness(ageMs, refreshIntervalMs)   -> { level: 'fresh' | 'stale' | 'unknown', staleAfterMs }
//   BFShared.previousAvailableDate(dates, asOf)        -> 'YYYY-MM-DD' or null
//
// None of them reads a clock, the host environment or any global but the ES5 built-ins Array, Math, isFinite
// and parseInt. The caller owns "now": it passes an age it measured (the reply of getDataFeed carries ageMs,
// which is better than subtracting the server's timestamp from the browser's clock) and, for the date
// function, the as-of date it knows. Because no date object is involved, none of them depends on the
// machine's time zone, and the same text comes out in the browser and in Apps Script.
//
// None of them throws. A value of the wrong type is "no answer" ('' or 'unknown' or null), never a
// coercion: the string '5' is not an age, and an object with a valueOf is never asked for its value.

var feedAge_MINUTE_MS = 60000;
var feedAge_HOUR_MS = 3600000;
var feedAge_DAY_MS = 86400000;

// The refresh interval assumed when the caller does not give a usable one: 60 minutes, the longest the
// server normally waits between refreshes (DATA_FEED_QUIET_INTERVAL_MS_ in apps-script/DataFeeds.gs; the
// business-hours interval, DATA_FEED_BUSY_INTERVAL_MS_, is 30 minutes).
var feedAge_DEFAULT_INTERVAL_MS = 3600000;

// A feed counts as stale when it is older than this many refresh intervals. The factor 2 is a starting
// guess: UNCONFIRMED, to be tuned once there is real data on how late a refresh normally runs.
var feedAge_STALE_FACTOR = 2;

// A finite, non-negative number (negative zero counts as zero). Not a numeric string, not a Number object,
// not NaN or an infinity: there is no age to show for any of those.
function feedAge_isAge(x) {
    return typeof x === 'number' && isFinite(x) && x >= 0;
}

// formatAge: a short English phrase for an age in milliseconds, each unit floored to a whole number.
//   under 1 minute        'just now'
//   under 1 hour          '1 min ago' .. '59 min ago'
//   under 1 day           '1 h ago' when the minutes are 0, else '2 h 5 min ago'
//   1 day or more         '1 day ago', '2 days ago', ... (days only; a long age needs no hours)
// Not a finite number, or below zero, gives '' so the caller shows nothing rather than a wrong phrase. An age
// so large that its day count has 21 or more digits comes out in JavaScript's exponent notation
// ('1.2e+30 days ago'); no real age gets near that, and the result is still a string that never throws.
BFShared.formatAge = function (ageMs) {
    var h, m, d;
    if (!feedAge_isAge(ageMs)) return '';
    if (ageMs < feedAge_MINUTE_MS) return 'just now';
    if (ageMs < feedAge_HOUR_MS) return Math.floor(ageMs / feedAge_MINUTE_MS) + ' min ago';
    if (ageMs < feedAge_DAY_MS) {
        h = Math.floor(ageMs / feedAge_HOUR_MS);
        m = Math.floor((ageMs % feedAge_HOUR_MS) / feedAge_MINUTE_MS);
        return m === 0 ? h + ' h ago' : h + ' h ' + m + ' min ago';
    }
    d = Math.floor(ageMs / feedAge_DAY_MS);
    return d === 1 ? '1 day ago' : d + ' days ago';
};

// feedFreshness: how to colour the age. Returns a fresh object { level, staleAfterMs } on every call.
//   staleAfterMs  2 * the refresh interval. The interval is refreshIntervalMs when that is a finite number
//                 above zero, else 60 minutes (feedAge_DEFAULT_INTERVAL_MS). An interval so large that
//                 doubling it overflows gives Infinity, which is true to the rule: it can never be stale.
//   level         'unknown' when ageMs is not a finite number or is below zero (nothing to judge);
//                 'stale' when ageMs is strictly greater than staleAfterMs; otherwise 'fresh'.
// An age exactly at staleAfterMs is still 'fresh'. staleAfterMs is returned even when the level is
// 'unknown', so a caller can show the threshold in a tooltip.
BFShared.feedFreshness = function (ageMs, refreshIntervalMs) {
    var interval = (typeof refreshIntervalMs === 'number' && isFinite(refreshIntervalMs) && refreshIntervalMs > 0)
        ? refreshIntervalMs : feedAge_DEFAULT_INTERVAL_MS;
    var staleAfterMs = feedAge_STALE_FACTOR * interval;
    var level = 'fresh';
    if (!feedAge_isAge(ageMs)) level = 'unknown';
    else if (ageMs > staleAfterMs) level = 'stale';
    return { level: level, staleAfterMs: staleAfterMs };
};

// True only for a string that is exactly 'YYYY-MM-DD' (ten characters, ASCII digits, zero padded) AND names a
// real day of the proleptic Gregorian calendar, worked out by arithmetic: months 01 to 12, a day from 01 to
// the month's length, February 29 only in a leap year (divisible by 4, except a century that is not divisible
// by 400, so 2024 and 2000 are leap years and 2026 and 2100 are not). Years 0000 to 9999 are all accepted.
// This is the one calendar-date validator in shared/: the view codec's viewCodec_isRealDate calls it and adds
// only its own year bound (2000 to 2099).
// No date object is used: its parser accepts '2026-02-30' in some engines, and its local-time methods answer
// differently in another time zone.
function feedAge_isCalendarDate(s) {
    var parts, year, month, day, february;
    if (typeof s !== 'string' || s.length !== 10) return false;
    parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!parts) return false;
    year = parseInt(parts[1], 10);
    month = parseInt(parts[2], 10);
    day = parseInt(parts[3], 10);
    if (month < 1 || month > 12 || day < 1) return false;
    february = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 29 : 28;
    return day <= [31, february, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// previousAvailableDate: the greatest date in `dates` that is strictly before `asOf`, as a 'YYYY-MM-DD'
// string, or null when there is none. "Available" means "listed": over a weekend, or any gap in the archive,
// it answers with the last day that has data (the weekend gap: from Monday 2026-08-31 with the dates
// 2026-08-27, 2026-08-28 and 2026-08-31 listed, the answer is 2026-08-28), and it never counts back one
// calendar day.
//   dates  an array of 'YYYY-MM-DD' strings in any order, with duplicates allowed (the archive index the
//          server returns is newest first). Entries that are not strings in exactly that form, or are not
//          real calendar days ('2026-02-30', '2026-13-01', '2026-1-5', ' 2026-09-01', a number, an object)
//          are ignored. Anything that is not an array gives null. The array is never modified.
//   asOf   the date to be previous to. Not a valid date in that form gives null. A date equal to asOf is
//          not "previous": the answer is strictly earlier.
// Entries are compared as plain strings, which is valid ONLY because they are validated first: a valid date
// is fixed width and zero padded, so alphabetical order is calendar order.
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

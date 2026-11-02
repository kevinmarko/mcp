'use strict';
/**
 * tests/lib/history_days.js -- read the committed 9-day historical CSV directly and slice it by
 * `Record Date` IN CODE. No derived data files are committed: the CSV in the repo root is the only
 * source, so there is nothing to drift (roadmap slice 0.3, revised).
 *
 * Dependency-free (Node builtins only), loads in well under a second. Used by
 * tests/check_history_days.js and meant to be reused by the later headless checks for diffSailings
 * (slice 2.1) and findExceptions (slice 3.1) as the ground-truth reader.
 *
 * WHY ITS OWN CSV PARSER
 *   The file has 8,769 data rows but 27,312 physical lines: quoted cells (Sector Remarks, Vessel
 *   Operation Notice, ...) contain newlines. `wc -l` and split('\n') are therefore wrong by 3x.
 *   parseCsv() below is a small RFC 4180 state machine: quoted fields, "" as an escaped quote,
 *   CR LF / LF / CR inside quotes preserved verbatim, an optional UTF-8 BOM, a final record with
 *   or without a terminating newline. tests/check_history_days.js pins its behavior.
 *
 * API (everything is exported at the bottom)
 *
 *   COL                             frozen map of the column names the helpers use (date, vvd, seq, pol,
 *                                   saleWeek, lane, pic, past4, overallThreshold, loadingThreshold,
 *                                   maxLaden, laden, booking, polUtil, polCutoff, cutoff)
 *   parseCsv(text)                  -> string[][]        raw RFC 4180 records (header included)
 *   loadHistory(csvPath?)           -> History           cached per absolute path; default = the
 *                                                         9-day CSV shipped in the repo root
 *
 *   History
 *     .path, .headers (string[]), .rows (row objects keyed by header; every value a STRING, exactly
 *     the CSV's own text), .dates (sorted ISO 'YYYY-MM-DD' Record Dates), .rowsByDate (Map),
 *     .rowsOn(date)    all rows of a Record Date (VMS placeholders included)
 *     .realRows(date)  non-VMS rows: the real port rows of real sailings
 *     .vmsRows(date)   VMS placeholder rows (Vessel 1st VVD === 'VMS': a nominated-but-unassigned
 *                      slot for a lane/sale week, blank POL and port seq)
 *     .vvdSet(date)    Set of real VVDs present on that date
 *     .sailings(date)  Map VVD -> { vvd, lane, saleWeek, rows:[...] } over realRows(date); a sailing
 *                      is one VVD, its rows are the port (POL) rows; lane/saleWeek come from the
 *                      first row (voyage-level fields agree across a sailing's rows: pinned)
 *     .pairs()         [{ prev, cur }] consecutive calendar days present in the data (prev < cur; a gap makes no pair)
 *
 *   Row helpers: isVms(row), toNumber(text), pastFourWeekFlag(row) ('Y' | 'N' | ''),
 *     picParts(row) -> { spc, mkg } (the "SPC / MKG" pair, trimmed), isPicBlank(row)
 *     (no PIC text at all), hasTbaPic(row) ('TBA' in either half), parseMdy('7/17/2026') ->
 *     '2026-07-17' | null, daysBetween(isoFrom, isoTo) (UTC, whole days).
 *
 *   Small utilities: tally(items, keyFn) -> [[value, count], ...] sorted by count desc then value;
 *     median(numbers); sum(numbers); voyageDisagreements(history, date, columns) -> number of
 *     sailings whose port rows do not all carry the same text in a column.
 *
 *   Reference oracles (deliberately naive, written independently of shared/ so the real
 *   implementations can be tested against them; NOT product code):
 *     diffVvds(history, prev, cur)               -> { gone:[vvd], arrived:[vvd] }       (sorted)
 *     classifyDisappearances(history, prev, cur) -> { rolledOut:[vvd], removed:[vvd] }  (proposed slice 2.1 rule)
 *     classifyArrivals(history, prev, cur)       -> { rolledIn, midWindow, returning, nominated } (VVD lists)
 *     unownedStreaks(history, asOf)              -> Map VVD -> consecutive Record Dates (adjacent in the
 *                                                   file) up to asOf with NO PIC text on ANY port row of
 *                                                   the sailing; a day the sailing is absent breaks it
 *     ladenOverMax(history, {requirePositiveMax}) -> { rows, pairs: Map 'VVD|POL' -> Set(dates) }
 *     ladenChangeByDaysToCutoff(history)         -> [{ bucket, n, falling, flat, rising, medianPct }]
 *     compactIndexRows(history)                  -> the slice 2.5 history-index rows, one per non-VMS row
 *
 * Regenerating the numbers pinned in tests/fixtures/HISTORICAL_EXPECTED_VALUES.md: run
 * `node tests/check_history_days.js` (a failure prints got/want), or require this file in a REPL.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CSV = path.join(__dirname, '..', '..', 'Booking_Flash_Historical_Data_2026-08-24_to_2026-09-01.csv');

// The columns the helpers rely on. loadHistory() throws if one is missing, so a renamed column in a
// future CSV is a loud failure here and not a silently empty result downstream.
const COL = Object.freeze({
    date: 'Record Date',
    vvd: 'Vessel 1st VVD',
    seq: 'Route Location Calling Port Seq',
    pol: 'Route Location 1st Pol',
    saleWeek: 'Route Date 1st Sale Week',
    lane: 'Vessel 1st Lane',
    pic: 'MCT PIC',
    past4: 'Route Date Past 4 Week Flag',
    overallThreshold: 'MCT Overall Threshold',
    loadingThreshold: 'MCT Loading Threshold',
    maxLaden: 'MCT Max Laden',
    laden: 'Measures Laden TEU',
    booking: 'Measures Total Booking TEU by Service',
    polUtil: 'Measures POL Booking Utilz',
    polCutoff: 'Route Date POL Cut/off Date',
    cutoff: 'Route Date Cut/off Date',
});

const VMS = 'VMS';

// --------------------------------------------------------------------------------------------
// RFC 4180 parser
// --------------------------------------------------------------------------------------------
function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const n = text.length;
    const records = [];
    let record = [];
    let i = 0;
    while (i < n) {
        let value;
        if (text.charCodeAt(i) === 34) {                 // quoted field
            i++;
            let out = '';
            for (;;) {
                const q = text.indexOf('"', i);
                if (q === -1) throw new Error('CSV: unterminated quoted field (opened before offset ' + i + ')');
                out += text.slice(i, q);
                if (text.charCodeAt(q + 1) === 34) { out += '"'; i = q + 2; continue; }   // "" -> "
                i = q + 1;
                break;
            }
            value = out;
        } else {                                         // unquoted field: runs to , CR or LF
            let j = i;
            while (j < n) {
                const c = text.charCodeAt(j);
                if (c === 44 || c === 10 || c === 13) break;
                j++;
            }
            value = text.slice(i, j);
            i = j;
        }
        record.push(value);
        const c = text.charCodeAt(i);                    // NaN at end of input
        if (c === 44) {                                  // field separator
            i++;
            if (i >= n) { record.push(''); records.push(record); record = []; }   // "a,b," at EOF
            continue;
        }
        if (c === 13) { i++; if (text.charCodeAt(i) === 10) i++; }
        else if (c === 10) i++;
        else if (i < n) throw new Error('CSV: unexpected character after a quoted field at offset ' + i);
        records.push(record);
        record = [];
    }
    return records;
}

// --------------------------------------------------------------------------------------------
// Row helpers
// --------------------------------------------------------------------------------------------
// The VVD as BFShared.isRealVvd reads it (trimmed, upper case; a blank cell is ''), written out here on
// purpose rather than imported: this file is the independent oracle. A row is a placeholder (isVms) when
// that VVD is blank or 'VMS', so " vms " and a blank VVD are placeholders, never a sailing called "VMS".
const vvdOf = (row) => String(row[COL.vvd] == null ? '' : row[COL.vvd]).trim().toUpperCase();
const isVms = (row) => { const v = vvdOf(row); return v === '' || v === VMS; };

/** The CSV's own text -> number. Blank / non-numeric -> null (never 0: a blank is not a zero). */
function toNumber(text) {
    if (text === undefined || text === null) return null;
    const s = String(text).trim();
    if (s === '') return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
}

/** 'Route Date Past 4 Week Flag': 'Y' | 'N' | '' (anything else is returned upper-cased and trimmed). */
const pastFourWeekFlag = (row) => String(row[COL.past4] || '').trim().toUpperCase();

/** 'Lani / Alex' -> { spc:'Lani', mkg:'Alex' }. 'Peter / TBA' -> { spc:'Peter', mkg:'TBA' }. Blank -> both ''. */
function picParts(row) {
    const parts = String(row[COL.pic] || '').split('/');
    return { spc: (parts[0] || '').trim(), mkg: parts.slice(1).join('/').trim() };
}
/** True when there is no PIC text at all (empty or whitespace). 'TBA / Bob' is NOT blank. */
const isPicBlank = (row) => String(row[COL.pic] || '').trim() === '';
/** True when either half of the SPC / MKG pair is the literal 'TBA'. */
function hasTbaPic(row) {
    const p = picParts(row);
    return p.spc.toUpperCase() === 'TBA' || p.mkg.toUpperCase() === 'TBA';
}

/** '7/17/2026' (M/D/YYYY, as the cut-off columns are written) -> '2026-07-17'. Anything else -> null. */
function parseMdy(text) {
    const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(text || ''));
    if (!m) return null;
    const mo = +m[1], d = +m[2], y = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;   // 2/31 etc.
    return dt.toISOString().slice(0, 10);
}

/** Whole days from isoFrom to isoTo ('YYYY-MM-DD' both). UTC arithmetic: immune to the machine's timezone / DST. */
function daysBetween(isoFrom, isoTo) {
    const a = Date.parse(isoFrom + 'T00:00:00Z');
    const b = Date.parse(isoTo + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
}

// --------------------------------------------------------------------------------------------
// loadHistory
// --------------------------------------------------------------------------------------------
const cache = new Map();

function loadHistory(csvPath) {
    const abs = path.resolve(csvPath || DEFAULT_CSV);
    if (cache.has(abs)) return cache.get(abs);

    const table = parseCsv(fs.readFileSync(abs, 'utf8'));
    if (!table.length) throw new Error('CSV is empty: ' + abs);
    const headers = table[0];
    Object.values(COL).forEach((name) => {
        if (!headers.includes(name)) throw new Error('CSV ' + abs + ' has no "' + name + '" column');
    });

    const rows = [];
    let blankLines = 0;
    for (let r = 1; r < table.length; r++) {
        const rec = table[r];
        if (rec.length === 1 && rec[0] === '') { blankLines++; continue; }     // stray empty line, e.g. at EOF
        if (rec.length !== headers.length) {
            throw new Error('CSV record ' + r + ' has ' + rec.length + ' fields, header has ' + headers.length);
        }
        const row = {};
        for (let c = 0; c < headers.length; c++) row[headers[c]] = rec[c];
        rows.push(row);
    }

    const rowsByDate = new Map();
    rows.forEach((row) => {
        const d = row[COL.date];
        if (!rowsByDate.has(d)) rowsByDate.set(d, []);
        rowsByDate.get(d).push(row);
    });
    const dates = [...rowsByDate.keys()].sort();

    const requireDate = (date) => {
        if (!rowsByDate.has(date)) throw new Error('No Record Date "' + date + '" in ' + abs + ' (have ' + dates.join(', ') + ')');
    };
    const sailingCache = new Map();
    const history = {
        path: abs,
        headers,
        rows,
        blankLines,
        dates,
        rowsByDate,
        rowsOn(date) { requireDate(date); return rowsByDate.get(date); },
        realRows(date) { return this.rowsOn(date).filter((row) => !isVms(row)); },
        vmsRows(date) { return this.rowsOn(date).filter(isVms); },
        vvdSet(date) { return new Set(this.realRows(date).map(vvdOf)); },
        sailings(date) {
            if (sailingCache.has(date)) return sailingCache.get(date);
            const map = new Map();
            this.realRows(date).forEach((row) => {
                const vvd = vvdOf(row);
                let s = map.get(vvd);
                if (!s) { s = { vvd, lane: row[COL.lane], saleWeek: row[COL.saleWeek], rows: [] }; map.set(vvd, s); }
                s.rows.push(row);
            });
            sailingCache.set(date, map);
            return map;
        },
        pairs() {
            const out = [];
            // Consecutive CALENDAR days only: a gap in the archive is not a day-over-day pair.
            for (let i = 1; i < dates.length; i++) {
                if (daysBetween(dates[i - 1], dates[i]) === 1) out.push({ prev: dates[i - 1], cur: dates[i] });
            }
            return out;
        },
    };
    cache.set(abs, history);
    return history;
}

// --------------------------------------------------------------------------------------------
// Small utilities
// --------------------------------------------------------------------------------------------

/** [[value, count], ...] sorted by count descending, ties by String(value) ascending. */
function tally(items, keyFn) {
    const m = new Map();
    items.forEach((x) => { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); });
    return [...m].sort((a, b) => b[1] - a[1] || (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
}

const sum = (nums) => nums.reduce((a, b) => a + b, 0);

/** Median of a number array (mean of the two middle values for an even count); NaN when empty. */
function median(nums) {
    const s = [...nums].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * How many sailings on `date` have port rows that do NOT all carry the same text in at least one of
 * `columns` (the voyage-level-field-agreement check, per column when one column is passed).
 */
function voyageDisagreements(history, date, columns) {
    const cols = Array.isArray(columns) ? columns : [columns];
    let n = 0;
    for (const s of history.sailings(date).values()) {
        if (cols.some((c) => new Set(s.rows.map((r) => r[c])).size > 1)) n++;
    }
    return n;
}

// --------------------------------------------------------------------------------------------
// Reference oracles (naive on purpose; see the header)
// --------------------------------------------------------------------------------------------

/** Sailing-level set difference between two Record Dates. VMS placeholders never count. Sorted. */
function diffVvds(history, prevDate, curDate) {
    const prev = history.vvdSet(prevDate);
    const cur = history.vvdSet(curDate);
    return {
        gone: [...prev].filter((v) => !cur.has(v)).sort(),
        arrived: [...cur].filter((v) => !prev.has(v)).sort(),
    };
}

/**
 * PROPOSED rule for slice 2.1: a sailing that is gone today is ROLLED OUT when its sale week no
 * longer appears anywhere in today's non-VMS rows (the whole week fell out of the window), and
 * REMOVED when its sale week is still present today (the sailing vanished while its week stayed).
 */
function classifyDisappearances(history, prevDate, curDate) {
    const { gone } = diffVvds(history, prevDate, curDate);
    const weeksToday = new Set(history.realRows(curDate).map((row) => row[COL.saleWeek]));
    const prevSailings = history.sailings(prevDate);
    const rolledOut = [];
    const removed = [];
    gone.forEach((vvd) => {
        (weeksToday.has(prevSailings.get(vvd).saleWeek) ? removed : rolledOut).push(vvd);
    });
    return { rolledOut, removed };
}

/**
 * Consecutive days, ending on asOfDate, on which a sailing had no PIC text on ANY of its port rows.
 * The streak is broken by a day with any PIC text on any row, by a gap between two archive dates (the
 * days must be consecutive calendar days), and also by a day on which the sailing
 * is absent (a sailing that was not in the file that day cannot have been "unowned" that day).
 * Only sailings with a streak >= 1 are returned.
 */
function unownedStreaks(history, asOfDate) {
    const idx = history.dates.indexOf(asOfDate);
    if (idx === -1) throw new Error('No Record Date "' + asOfDate + '"');
    const out = new Map();
    for (const vvd of history.sailings(asOfDate).keys()) {
        let n = 0;
        for (let d = idx; d >= 0; d--) {
            // a missing calendar day breaks the streak, like an absent sailing
            if (d < idx && daysBetween(history.dates[d], history.dates[d + 1]) !== 1) break;
            const s = history.sailings(history.dates[d]).get(vvd);
            if (!s || !s.rows.every(isPicBlank)) break;
            n++;
        }
        if (n >= 1) out.set(vvd, n);
    }
    return out;
}

/**
 * Classify the VVDs that ARRIVED between two consecutive Record Dates (present on curDate, absent on
 * prevDate), at sailing level:
 *   rolledIn   sale week was NOT present anywhere in prevDate's non-VMS rows (a new sale week entered the window)
 *   midWindow  everything else (a sailing appeared inside a sale week that already existed)
 *   returning  (a flag, not a partition) the VVD was present on some EARLIER Record Date than prevDate, i.e. it left
 *              and came back; a one-day diff cannot know this, only history can
 *   nominated  (INFERRED, a subset of midWindow) yesterday's VMS placeholder rows for the arrival's (lane, sale
 *              week) outnumber today's: a placeholder slot was filled. VMS rows carry no VVD, so the link is
 *              by (lane, sale week) only and is NOT confirmed by any identifier.
 */
function classifyArrivals(history, prevDate, curDate) {
    const { arrived } = diffVvds(history, prevDate, curDate);
    const weeksPrev = new Set(history.realRows(prevDate).map((row) => row[COL.saleWeek]));
    const vmsCount = (date) => {
        const m = new Map();
        history.vmsRows(date).forEach((row) => {
            const k = row[COL.lane] + '|' + row[COL.saleWeek];
            m.set(k, (m.get(k) || 0) + 1);
        });
        return m;
    };
    const vmsPrev = vmsCount(prevDate);
    const vmsCur = vmsCount(curDate);
    const earlier = history.dates.slice(0, history.dates.indexOf(prevDate));
    const sailingsCur = history.sailings(curDate);
    const out = { rolledIn: [], midWindow: [], returning: [], nominated: [] };
    arrived.forEach((vvd) => {
        const s = sailingsCur.get(vvd);
        const k = s.lane + '|' + s.saleWeek;
        if (!weeksPrev.has(s.saleWeek)) out.rolledIn.push(vvd);
        else {
            out.midWindow.push(vvd);
            if ((vmsPrev.get(k) || 0) > (vmsCur.get(k) || 0)) out.nominated.push(vvd);
        }
        if (earlier.some((d) => history.sailings(d).has(vvd))) out.returning.push(vvd);
    });
    return out;
}

/**
 * Port rows whose 'Measures Laden TEU' exceeds 'MCT Max Laden'. A Max Laden of 0 means "no cap
 * recorded" for 316 rows (214 of them also carry laden 0), so the meaningful reading requires Max Laden > 0
 * (default). Pass { requirePositiveMax: false } for the raw comparison. `pairs` maps 'VVD|POL' to the set
 * of Record Dates on which that (VVD, POL) was over.
 */
function ladenOverMax(history, opts) {
    const requirePositiveMax = !opts || opts.requirePositiveMax !== false;
    const rows = history.rows.filter((row) => {
        if (isVms(row)) return false;
        const laden = toNumber(row[COL.laden]);
        const max = toNumber(row[COL.maxLaden]);
        if (laden === null || max === null) return false;
        return laden > max && (!requirePositiveMax || max > 0);
    });
    const pairs = new Map();
    rows.forEach((row) => {
        const k = vvdOf(row) + '|' + row[COL.pol];
        if (!pairs.has(k)) pairs.set(k, new Set());
        pairs.get(k).add(row[COL.date]);
    });
    return { rows, pairs };
}

/**
 * How 'Measures Laden TEU' moves day over day, bucketed by days to the POL cut-off. Method (pinned, so a
 * different method is a different number):
 *   - unit = a (VVD, POL) port row present on BOTH of two consecutive Record Dates, non-VMS
 *   - earlier laden must be > 0 (a percentage change is undefined from 0)
 *   - days to cut-off = 'Route Date POL Cut/off Date' (M/D/YYYY) read from the EARLIER day's row, minus the
 *     EARLIER Record Date, in whole days; rows with no parseable cut-off are skipped
 *   - change % = (later laden - earlier laden) / earlier laden * 100
 *   - falling = change < -0.5 %, rising = change > +0.5 %, flat = anything within +-0.5 %
 *   - buckets: '>=28', '14-27', '7-13', '3-6', '0-2', 'after' (days to cut-off < 0)
 */
function ladenChangeByDaysToCutoff(history) {
    const BUCKETS = ['>=28', '14-27', '7-13', '3-6', '0-2', 'after'];
    const bucketOf = (d) => (d >= 28 ? '>=28' : d >= 14 ? '14-27' : d >= 7 ? '7-13' : d >= 3 ? '3-6' : d >= 0 ? '0-2' : 'after');
    const acc = new Map(BUCKETS.map((b) => [b, { bucket: b, n: 0, falling: 0, flat: 0, rising: 0, pcts: [] }]));
    history.pairs().forEach(({ prev, cur }) => {
        const curByKey = new Map();
        history.realRows(cur).forEach((row) => curByKey.set(vvdOf(row) + '|' + row[COL.pol], row));
        history.realRows(prev).forEach((r0) => {
            const r1 = curByKey.get(vvdOf(r0) + '|' + r0[COL.pol]);
            if (!r1) return;
            const l0 = toNumber(r0[COL.laden]);
            const l1 = toNumber(r1[COL.laden]);
            if (l0 === null || l1 === null || !(l0 > 0)) return;
            const cut = parseMdy(r0[COL.polCutoff]);
            if (!cut) return;
            const a = acc.get(bucketOf(daysBetween(prev, cut)));
            a.n++;
            // compare against +-0.5 % without floating-point division: 200 * delta vs l0
            if ((l1 - l0) * 200 < -l0) a.falling++;
            else if ((l1 - l0) * 200 > l0) a.rising++;
            else a.flat++;
            a.pcts.push((l1 - l0) / l0 * 100);
        });
    });
    return BUCKETS.map((b) => {
        const a = acc.get(b);
        return { bucket: b, n: a.n, falling: a.falling, flat: a.flat, rising: a.rising, medianPct: median(a.pcts) };
    });
}

/**
 * The compact history-index row for slice 2.5: one array per NON-VMS row,
 *   [VVD, POL, Record Date, laden, total booking, POL booking utilisation, POL cut-off, picBlank]
 * where the numeric fields keep the CSV's own TEXT (strings, so no float noise and no blank-to-0), the
 * cut-off keeps its M/D/YYYY text, and picBlank is 1 when the row has no PIC text, else 0.
 */
function compactIndexRows(history) {
    return history.rows.filter((row) => !isVms(row)).map((row) => [
        vvdOf(row), row[COL.pol], row[COL.date],
        row[COL.laden], row[COL.booking], row[COL.polUtil],
        row[COL.polCutoff], isPicBlank(row) ? 1 : 0,
    ]);
}

module.exports = {
    DEFAULT_CSV, COL, VMS,
    parseCsv, loadHistory,
    isVms, toNumber, pastFourWeekFlag, picParts, isPicBlank, hasTbaPic, parseMdy, daysBetween,
    tally, median, sum, voyageDisagreements,
    diffVvds, classifyDisappearances, classifyArrivals, unownedStreaks,
    ladenOverMax, ladenChangeByDaysToCutoff, compactIndexRows,
};

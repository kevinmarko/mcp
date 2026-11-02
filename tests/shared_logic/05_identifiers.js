'use strict';
/**
 * Behaviour tests for BFShared.makePortKey, parsePortKey, buildLaneMap, laneRevenueLanes, revenueLaneServices and parsePic
 * (shared/05_identifiers.js, Phase 2 slice 2a-1; decision D4).
 *
 * Evidence:
 *   1. Hand-written tables: every branch of the port key, the lane map and the PIC parser is worked out in the comments.
 *   2. Real data: tests/fixtures/identifiers/space_analyst.csv (a read-only copy of the Max Laden generator repo's
 *      app/tests/fixtures/golden_full/space_analyst.csv, Booking Flash's Space_Analyst tab) and the committed 9-day CSV
 *      (ctx.history): every lane in the 9-day data maps to a revenue lane; the 22 distinct PIC strings of the CSV parse as D4 says.
 *   3. Hostile inputs and purity (the realm's Date and Math.random made to throw; the source names no clock or environment).
 *
 * Calls go through local names: tests/check_shared_sync.js check E forbids a second definition of a shared name anywhere in tests/.
 */
const fs = require('fs');
const path = require('path');

exports.TESTS = ['makePortKey', 'parsePortKey', 'buildLaneMap', 'laneRevenueLanes', 'revenueLaneServices', 'parsePic'];
exports.COUNT = 15;
exports.run = function (ctx) {
    const { BFShared, t, plain, history } = ctx;
    const hist = history.loadHistory();
    const key = (p, s) => BFShared.makePortKey(p, s);
    const unkey = (k) => plain(BFShared.parsePortKey(k));
    const build = (r) => BFShared.buildLaneMap(r);
    const toRev = (m, l) => plain(BFShared.laneRevenueLanes(m, l));
    const toSvc = (m, l) => plain(BFShared.revenueLaneServices(m, l));
    const pic = (x) => plain(BFShared.parsePic(x));

    const boom = { valueOf() { throw new Error('valueOf was called'); }, toString() { throw new Error('toString was called'); } };
    const safe = (fn) => { try { return fn(); } catch (e) { return `THREW: ${e && e.message}`; } };

    // ================================================================================================
    // makePortKey and parsePortKey
    // ================================================================================================
    const KEY_TABLE = [
        ['USNYC', 2, 'USNYC#2'], [' usnyc ', ' 2 ', 'USNYC#2'], ['USNYC', '02', 'USNYC#2'], ['USNYC', '0', 'USNYC#0'], ['USNYC', '000', 'USNYC#0'], ['USNYC', 0, 'USNYC#0'],
        ['USNYC', '10', 'USNYC#10'], [12345, 1, '12345#1'],
        ['', 2, ''], ['  ', 2, ''], [null, 2, ''], [undefined, 2, ''], ['US#NYC', 2, ''], [boom, 2, ''], [{}, 2, ''],
        ['USNYC', '', ''], ['USNYC', null, ''], ['USNYC', undefined, ''], ['USNYC', 'x', ''], ['USNYC', '2.0', ''], ['USNYC', -1, ''], ['USNYC', '-1', ''], ['USNYC', 1.5, ''],
        ['USNYC', NaN, ''], ['USNYC', Infinity, ''], ['USNYC', boom, ''], ['USNYC', [2], ''], ['USNYC', '1e2', ''], ['USNYC', '2 3', ''],
    ];
    t('makePortKey: port trimmed and upper-cased, a hash, then the sequence as plain digits (number, text, padded); a blank or hash-bearing port, or a sequence that is not a whole number from 0 up, gives \'\' without throwing',
        KEY_TABLE.map(([p, s]) => safe(() => key(p, s))), KEY_TABLE.map(([, , want]) => want));
    t('makePortKey: no arguments gives \'\'',
        safe(() => BFShared.makePortKey()), '');
    t('parsePortKey: splits what makePortKey made and nothing else (lower case, padded, empty parts, two hashes, non-strings are null)',
        ['USNYC#2', 'USNYC#10', 'USNYC#0', 'USNYC#02', 'usnyc#2', ' USNYC#2', 'USNYC#', '#2', 'USNYC', 'US#NYC#2', 'USNYC#2x', '', null, undefined, 2, {}, boom, ['USNYC#2']].map((k) => safe(() => unkey(k))),
        [{ pol: 'USNYC', seq: '2' }, { pol: 'USNYC', seq: '10' }, { pol: 'USNYC', seq: '0' }, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]);
    t('parsePortKey and makePortKey are inverse on every (POL, port sequence) pair of the 9-day CSV; the only rows with no key are the 18 \'NO N.A. CALL\' rows, which have no port sequence',
        (() => {
            const C = history.COL;
            const bad = [];
            const noKey = [];
            let n = 0;
            hist.rows.forEach((r) => {
                if (r[C.vvd] === 'VMS') return;
                const k = key(r[C.pol], r[C.seq]);
                n++;
                if (k === '') { noKey.push(`${r[C.pol]}|${r[C.seq]}`); return; }
                const back = unkey(k);
                if (!back || key(back.pol, back.seq) !== k) bad.push(`${r[C.pol]}/${r[C.seq]}`);
            });
            return { n, bad: bad.slice(0, 5), badCount: bad.length, noKey: Array.from(new Set(noKey)), noKeyCount: noKey.length };
        })(),
        { n: 8136, bad: [], badCount: 0, noKey: ['NO N.A. CALL|'], noKeyCount: 18 });

    // ================================================================================================
    // buildLaneMap, laneRevenueLanes, revenueLaneServices
    // ================================================================================================
    // Hand-written rows: S1 sells as R1 (and S2 does too: many services, one revenue lane); S3 sells under two revenue lanes
    // (R3 and R4: one service, many revenue lanes); ' s5 ' / ' r5 ' are trimmed and upper-cased; rows with a blank Lane, a blank
    // Revenue_Lane, a non-object, or numbers in the cells are handled as described in the file comment.
    const ROWS = [
        { Lane: 'S1', Dir: 'E', Trade: 'TAT', Sub_Trade: 'TA', Region: 'EC', Analyst: 'Joe', Revenue_Lane: 'R1', IB_DIR: 'W', Notes: '' },
        { Lane: 'S2', Dir: ' W ', Trade: 'TPT', Sub_Trade: 'PS', Region: 'WC', Analyst: ' Kysa ', Revenue_Lane: 'R1', IB_DIR: 'E', Notes: 'note' },
        { Lane: 'S3', Revenue_Lane: 'R4' }, { Lane: 'S3', Revenue_Lane: 'R3' }, { Lane: 'S3', Revenue_Lane: 'R3' },
        { Lane: ' s5 ', Revenue_Lane: ' r5 ' },
        { Lane: '', Revenue_Lane: 'R6', Analyst: 'x' }, { Lane: 'S7', Revenue_Lane: '' }, { Lane: 'S8' }, { Lane: null, Revenue_Lane: null },
        { Lane: 9, Revenue_Lane: 10, Analyst: 7 },
        null, undefined, 'S1', 5, [], boom, { Lane: boom, Revenue_Lane: 'R1' }, { Lane: 'S1', Revenue_Lane: boom },
    ];
    const MAP = build(ROWS);
    t('buildLaneMap: keeps the rows with both a Lane and a Revenue_Lane in order, trims every field, upper-cases the two lane names, reads numbers as text and everything else as blank; skips blank-lane rows and non-objects',
        plain(MAP).entries,
        [
            { lane: 'S1', dir: 'E', trade: 'TAT', subTrade: 'TA', region: 'EC', analyst: 'Joe', revenueLane: 'R1', ibDir: 'W', notes: '' },
            { lane: 'S2', dir: 'W', trade: 'TPT', subTrade: 'PS', region: 'WC', analyst: 'Kysa', revenueLane: 'R1', ibDir: 'E', notes: 'note' },
            { lane: 'S3', dir: '', trade: '', subTrade: '', region: '', analyst: '', revenueLane: 'R4', ibDir: '', notes: '' },
            { lane: 'S3', dir: '', trade: '', subTrade: '', region: '', analyst: '', revenueLane: 'R3', ibDir: '', notes: '' },
            { lane: 'S3', dir: '', trade: '', subTrade: '', region: '', analyst: '', revenueLane: 'R3', ibDir: '', notes: '' },
            { lane: 'S5', dir: '', trade: '', subTrade: '', region: '', analyst: '', revenueLane: 'R5', ibDir: '', notes: '' },
            { lane: '9', dir: '', trade: '', subTrade: '', region: '', analyst: '7', revenueLane: '10', ibDir: '', notes: '' },
        ]);
    t('laneRevenueLanes and revenueLaneServices: the relation is data, not a formula, and goes both ways (one service under two revenue lanes, two services under one), answers are sorted and distinct, case and spaces in the question are ignored, unknown or blank names give []',
        {
            s1: toRev(MAP, 'S1'), s3: toRev(MAP, ' s3 '), s5: toRev(MAP, 's5'), unknown: toRev(MAP, 'ZZ'), blank: toRev(MAP, ''),
            r1: toSvc(MAP, 'R1'), r3: toSvc(MAP, 'r3'), r4: toSvc(MAP, 'R4'), r9: toSvc(MAP, 'R9'), num: toSvc(MAP, '10'),
        },
        { s1: ['R1'], s3: ['R3', 'R4'], s5: ['R5'], unknown: [], blank: [], r1: ['S1', 'S2'], r3: ['S3'], r4: ['S3'], r9: [], num: ['9'] });
    t('buildLaneMap, laneRevenueLanes and revenueLaneServices: a first argument that is not an array (or not a lane map) gives an empty map or [], never a throw',
        {
            maps: [null, undefined, 0, 'abc', true, {}, { length: 1, 0: ROWS[0] }, new Set(ROWS), () => ROWS, Symbol('x'), BigInt(1), boom].map((r) => safe(() => build(r))).map((m) => JSON.stringify(m)),
            lookups: [null, undefined, 0, 'abc', {}, { entries: null }, { entries: 'x' }, { entries: [null, 5, 'a', {}] }, boom].map((m) => safe(() => [toRev(m, 'S1'), toSvc(m, 'R1')])).map((x) => JSON.stringify(x)),
            badName: [null, undefined, 0, 5, {}, [], ['S1'], boom, true].map((n) => safe(() => [toRev(MAP, n), toSvc(MAP, n)])).map((x) => JSON.stringify(x)),
            noArgs: safe(() => [BFShared.buildLaneMap(), BFShared.laneRevenueLanes(), BFShared.revenueLaneServices()]),
        },
        {
            maps: Array(12).fill('{"entries":[]}'),
            lookups: Array(9).fill('[[],[]]'),
            badName: Array(9).fill('[[],[]]'),
            noArgs: [{ entries: [] }, [], []],
        });

    // The real tab.
    const REAL_ROWS = (() => {
        const recs = history.parseCsv(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'identifiers', 'space_analyst.csv'), 'utf8'));
        const head = recs[0];
        return recs.slice(1).map((r) => { const o = {}; head.forEach((k, i) => { o[k] = r[i]; }); return o; });
    })();
    const REAL = build(REAL_ROWS);
    t('the Space_Analyst fixture: 48 lane rows (the 49th data line has no lane and is skipped), 47 distinct lanes (EXE is listed once per direction), 47 distinct revenue lanes, and the header is exactly the documented nine columns',
        {
            header: Object.keys(REAL_ROWS[0]), entries: REAL.entries.length,
            lanes: new Set(REAL.entries.map((e) => e.lane)).size, revenueLanes: new Set(REAL.entries.map((e) => e.revenueLane)).size,
        },
        { header: ['Lane', 'Dir', 'Trade', 'Sub_Trade', 'Region', 'Analyst', 'Revenue_Lane', 'IB_DIR', 'Notes'], entries: 48, lanes: 47, revenueLanes: 47 });
    t('the Space_Analyst fixture: service lane to revenue lane as the plan states (AL2 to AL2TA, EC4 to EC4TP), EXE sells under one revenue lane though it has two rows, and the reverse lookup finds the service',
        { al2: toRev(REAL, 'AL2'), ec4: toRev(REAL, 'EC4'), exe: toRev(REAL, 'EXE'), flx: toRev(REAL, 'FLX'), back: toSvc(REAL, 'EC4TP'), backExe: toSvc(REAL, 'EXETP'), none: toRev(REAL, 'XYZ') },
        { al2: ['AL2TA'], ec4: ['EC4TP'], exe: ['EXETP'], flx: ['FLXLW'], back: ['EC4'], backExe: ['EXE'], none: [] });
    t('the Space_Analyst fixture covers the 9-day CSV: all 28 lanes on its non-VMS rows map to exactly one revenue lane',
        (() => {
            const C = history.COL;
            const lanes = Array.from(new Set(hist.rows.filter((r) => r[C.vvd] !== 'VMS').map((r) => r[C.lane]))).sort();
            return { n: lanes.length, unmapped: lanes.filter((l) => toRev(REAL, l).length !== 1) };
        })(),
        { n: 28, unmapped: [] });

    // ================================================================================================
    // parsePic
    // ================================================================================================
    const P = (blank, halves, kinds, owned, team, unownedReasons) => ({ blank, halves, kinds, owned, team, unownedReasons });
    // [input, expected]. D4: blank, TBA and Resid are unowned; EC SPC and WC SPC are the team; a person in either half owns it.
    const PIC_TABLE = [
        ['Joe / Bob', P(false, ['Joe', 'Bob'], ['person', 'person'], true, false, [])],
        ['  Ryan T   /   Marissa ', P(false, ['Ryan T', 'Marissa'], ['person', 'person'], true, false, [])],
        ['Ryan  H / Alex', P(false, ['Ryan H', 'Alex'], ['person', 'person'], true, false, [])],
        ['TBA / Bob', P(false, ['TBA', 'Bob'], ['tba', 'person'], true, false, ['tba'])],
        ['Peter / tba', P(false, ['Peter', 'tba'], ['person', 'tba'], true, false, ['tba'])],
        ['Resid / Marissa', P(false, ['Resid', 'Marissa'], ['resid', 'person'], true, false, ['resid'])],
        ['TBA / TBA', P(false, ['TBA', 'TBA'], ['tba', 'tba'], false, false, ['tba', 'tba'])],
        ['RESID / TBA', P(false, ['RESID', 'TBA'], ['resid', 'tba'], false, false, ['resid', 'tba'])],
        ['TBA', P(false, ['TBA'], ['tba'], false, false, ['tba'])],
        ['EC SPC / Bob', P(false, ['EC SPC', 'Bob'], ['team', 'person'], true, true, [])],
        ['wc  spc / TBA', P(false, ['wc spc', 'TBA'], ['team', 'tba'], true, true, ['tba'])],
        ['WC SPC', P(false, ['WC SPC'], ['team'], true, true, [])],
        ['EC SPC / WC SPC', P(false, ['EC SPC', 'WC SPC'], ['team', 'team'], true, true, [])],
        ['ECSPC / Bob', P(false, ['ECSPC', 'Bob'], ['person', 'person'], true, false, [])],
        ['Joe /', P(false, ['Joe', ''], ['person', 'blank'], true, false, ['blank'])],
        ['/ Bob', P(false, ['', 'Bob'], ['blank', 'person'], true, false, ['blank'])],
        ['/', P(false, ['', ''], ['blank', 'blank'], false, false, ['blank', 'blank'])],
        ['Joe / Bob / Alex', P(false, ['Joe', 'Bob', 'Alex'], ['person', 'person', 'person'], true, false, [])],
        ['', P(true, [], [], false, false, ['blank'])],
        ['   ', P(true, [], [], false, false, ['blank'])],
        ['\t\n', P(true, [], [], false, false, ['blank'])],
        [null, P(true, [], [], false, false, ['blank'])],
        [undefined, P(true, [], [], false, false, ['blank'])],
        [{}, P(true, [], [], false, false, ['blank'])],
        [boom, P(true, [], [], false, false, ['blank'])],
        [['Joe / Bob'], P(true, [], [], false, false, ['blank'])],
        [NaN, P(true, [], [], false, false, ['blank'])],
        [7, P(false, ['7'], ['person'], true, false, [])],
    ];
    t('parsePic: halves are trimmed and white-space collapsed; blank, TBA and Resid are unowned (any case); EC SPC and WC SPC are the team; one person or team half makes it owned; a blank text is blank=true with halves []; non-text is blank',
        PIC_TABLE.map(([x]) => safe(() => pic(x))), PIC_TABLE.map(([, want]) => want));
    t('parsePic: every one of the 22 distinct non-blank MCT PIC strings of the 9-day CSV is owned (each pairs a person with the other half), the 6 strings with a TBA or Resid half list it as a reason, and the blank PIC is the only unowned text',
        (() => {
            const C = history.COL;
            const texts = Array.from(new Set(hist.rows.map((r) => r[C.pic]))).sort();
            const parsed = texts.map((x) => ({ x, p: pic(x) }));
            return {
                distinct: texts.length,
                unowned: parsed.filter((q) => !q.p.owned).map((q) => q.x),
                withReason: parsed.filter((q) => q.p.owned && q.p.unownedReasons.length).map((q) => `${q.x}:${q.p.unownedReasons.join(',')}`),
                team: parsed.filter((q) => q.p.team).length,
            };
        })(),
        {
            distinct: 23, unowned: [''],
            withReason: ['Peter / TBA:tba', 'Resid / Bob:resid', 'Resid / Marissa:resid', 'TBA / Alex:tba', 'TBA / Bob:tba', 'TBA / Marissa:tba'],
            team: 0,
        });
    t('parsePic: row counts on the 9-day CSV (all 8,769 rows): 96 blank, 384 with a TBA half, 850 with a Resid half, none unowned except the blank rows; the old blank-only test (history.isPicBlank) and parsePic.blank agree on every row',
        (() => {
            const rows = hist.rows;
            const C = history.COL;
            const ps = rows.map((r) => pic(r[C.pic]));
            return {
                rows: rows.length, blank: ps.filter((p) => p.blank).length, unowned: ps.filter((p) => !p.owned).length,
                tba: ps.filter((p) => p.kinds.indexOf('tba') !== -1).length, resid: ps.filter((p) => p.kinds.indexOf('resid') !== -1).length,
                disagree: rows.filter((r, i) => history.isPicBlank(r) !== ps[i].blank).length,
            };
        })(),
        { rows: 8769, blank: 96, unowned: 96, tba: 384, resid: 850, disagree: 0 });

    // ================================================================================================
    // Purity
    // ================================================================================================
    {
        const Fn = BFShared.makePortKey.constructor;
        const realm = new Fn('return this')();
        const battery = () => JSON.stringify([
            KEY_TABLE.map(([p, s]) => safe(() => key(p, s))), unkey('USNYC#2'), plain(MAP), toRev(MAP, 'S3'), toSvc(MAP, 'R1'), PIC_TABLE.map(([x]) => safe(() => pic(x))),
        ]);
        const normal = battery();
        const realDate = realm.Date;
        const realRandom = realm.Math.random;
        const stop = () => { throw new Error('the shared code read the clock or the random source'); };
        let sabotaged = null;
        let live = null;
        try {
            realm.Date = function () { stop(); };
            realm.Date.now = stop;
            realm.Math.random = stop;
            live = ['new Date()', 'Date.now()', 'Math.random()'].map((src) => { try { new Fn(`return ${src}`)(); return 'did not throw'; } catch (e) { return 'threw'; } });
            sabotaged = safe(battery);
        } finally {
            realm.Date = realDate;
            realm.Math.random = realRandom;
        }
        t('purity: with the clock and the random source throwing (and shown to throw), the functions give exactly the answers they gave normally',
            { live, same: sabotaged === normal }, { live: ['threw', 'threw', 'threw'], same: true });
    }
    {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', '05_identifiers.js'), 'utf8');
        const code = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
        const found = ['Date', 'Math\\.random', 'performance', 'process', 'window', 'document', 'setTimeout', 'setInterval', 'eval', 'Function', 'require', 'Intl', 'toLocale[A-Za-z]*']
            .filter((w) => new RegExp(`(^|[^A-Za-z0-9_$])${w}([^A-Za-z0-9_$]|$)`).test(code));
        t('purity: the code of shared/05_identifiers.js (comment lines removed) names no Date, Math.random, performance, process, window, document, timer, eval, Function, require, Intl or locale method',
            found, []);
    }
};

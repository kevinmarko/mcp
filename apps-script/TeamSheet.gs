/**
 * --- Team features backed by two Google Sheets (2026-09-29) ---
 *
 *  - VVD notes, two kinds (2026-10-01):
 *      public  -- one per (VVD, author), in the team Sheet, shown to everyone. Used for VVDs
 *                 where cargo has been cut, so the whole team can see it.
 *      private -- one per (VVD, visitor), in the VISITOR's own user properties, shown only to
 *                 them. Never written to the team Sheet or the shared cache.
 *  - Startup-error log: what a visitor's browser reports when the app fails to start.
 *  - App config: thresholds and lane/port exclusions the admin edits in a Sheet
 *    instead of the app's source.
 *
 * DEPLOYMENT: the web app runs as the VISITOR ("User accessing the web app"),
 * so every Sheet call below runs as whoever is using the app. Visitors must be
 * able to EDIT the team-data Sheet (notes and error rows are written as them)
 * and VIEW the config Sheet; setupTeamSheets shares them that way. Script
 * properties and the script cache are script-global, which is why the notes
 * cache below holds no per-user data. Full setup: apps-script/README.md.
 *
 * Public functions (no trailing underscore) are callable from any page via
 * google.script.run, so each validates its arguments and resolves the caller
 * with activeUserEmail_() -- there is no email parameter anywhere.
 *
 * "Author-only" for notes is enforced by THIS code (a save only ever touches
 * the caller's own row), not by Sheets: anyone with edit access to the Sheet
 * can still change or delete any row directly in it.
 *
 * Nothing here references Code.gs variables at load time (file order), only
 * Code.gs functions (activeUserEmail_, assertArchiveAdmin_) at call time.
 */

var TEAM_SHEET_ID_KEY_ = 'bfrTeamSheetId';
var CONFIG_SHEET_ID_KEY_ = 'bfrConfigSheetId';
var TEAM_SHEET_NAME_ = 'Booking Flash Team Data';
var CONFIG_SHEET_NAME_ = 'Booking Flash Config';

var VVD_NOTES_TAB_ = 'VVD Notes';
var VVD_NOTES_HEADER_ = ['VVD', 'Note', 'Author', 'Updated At'];
var STARTUP_ERRORS_TAB_ = 'Startup Errors';
var STARTUP_ERRORS_HEADER_ = ['Time', 'User', 'Reason', 'Errors', 'React Loaded', 'Browser', 'Page'];
var CONFIG_SETTINGS_TAB_ = 'Settings';
var CONFIG_SETTINGS_HEADER_ = ['Key', 'Value', 'Notes'];
var CONFIG_PORTS_TAB_ = 'Port Exclusions';
var CONFIG_PORTS_HEADER_ = ['Lane', 'Port'];

var VVD_NOTES_CACHE_KEY_ = 'bfrVvdNotes';
/**
 * 1 hour (per Kevin). saveVvdNote writes the new list through to the cache, so notes saved in the
 * app show at once; this only bounds how long an edit made directly in the Sheet takes to appear.
 * A short TTL made nearly every 5-minute poll (tabs poll out of step) reopen the Sheet.
 */
var VVD_NOTES_CACHE_SECONDS_ = 3600;
var VVD_NOTE_MAX_CHARS_ = 1000;
var VVD_RE_ = /^[A-Z0-9][A-Z0-9 ._\/-]{1,39}$/;

var APP_CONFIG_CACHE_KEY_ = 'bfrAppConfig';
/** 6 h (the cache's maximum): edits are written through by onConfigSheetEdit, and refreshDataFeeds refills an evicted copy. */
var APP_CONFIG_CACHE_SECONDS_ = 21600;
/** Per-visitor memory of a failed config read (see readAppConfig_). */
var APP_CONFIG_ERROR_KEY_PREFIX_ = 'bfrAppConfigErr:';
var APP_CONFIG_ERROR_CACHE_SECONDS_ = 300;

var STARTUP_ERR_RATE_MAX_ = 5;
var STARTUP_ERR_RATE_WINDOW_SECONDS_ = 600;

/**
 * The only settings the app reads from the config Sheet, with the defaults
 * the app itself uses when a key is blank (tests/check_team_features_logic.js
 * asserts they match the app's source, so the Sheet setupTeamSheets fills in
 * shows what is really in effect).
 */
var APP_CONFIG_KEYS_ = [
  'scheduleChange.perLaneRemovedRatePct',
  'scheduleChange.laneSizeForRatePct',
  'scheduleChange.laneNetLossThreshold',
  'sectorSummary.laneExclude'
];

var APP_CONFIG_DEFAULTS_ = {
  'scheduleChange.perLaneRemovedRatePct': 40,
  'scheduleChange.laneSizeForRatePct': 8,
  'scheduleChange.laneNetLossThreshold': 2,
  'sectorSummary.laneExclude': 'EXE, EXW'
};

var APP_CONFIG_NOTES_ = {
  'scheduleChange.perLaneRemovedRatePct': 'Large-schedule-change banner: flag a lane that loses at least this % of its VVDs in one refresh (only lanes with at least laneSizeForRatePct VVDs).',
  'scheduleChange.laneSizeForRatePct': 'Lanes with fewer VVDs than this use the net-loss rule instead of the percentage rule.',
  'scheduleChange.laneNetLossThreshold': 'Flag a lane that loses at least this many VVDs (removed minus added) in one refresh.',
  'sectorSummary.laneExclude': 'Comma-separated lanes hidden from the Sector Summary pivot.'
};

/** Same as the app's PORT_EXCLUDE_SEED (including its repeated MS2/MATNG); the test compares them. */
var DEFAULT_PORT_EXCLUSIONS_ = [
  { lane: 'MS2', port: 'MATNG' }, { lane: 'MS2', port: 'SGSIN' },
  { lane: 'CP2', port: 'CNYPG' }, { lane: 'CP2', port: 'CNYTN' }, { lane: 'CP2', port: 'TWKHH' },
  { lane: 'CP4', port: 'CNYTN' },
  { lane: 'FP1', port: 'DEHAM' }, { lane: 'FP1', port: 'NLRTM' }, { lane: 'FP1', port: 'FRLEH' },
  { lane: 'FP2', port: 'GBSOU' }, { lane: 'FP2', port: 'BEANR' }, { lane: 'FP2', port: 'NLRTM' },
  { lane: 'MS2', port: 'ESVLC' }, { lane: 'MS2', port: 'ESBCN' }, { lane: 'MS2', port: 'ITGOA' },
  { lane: 'MS2', port: 'ITSPE' }, { lane: 'MS2', port: 'FRFOS' }, { lane: 'MS2', port: 'MATNG' }
];

/**
 * Makes a user-supplied string safe to write into a cell. Sheets treats a
 * string starting with = + - @ as a formula, so a note like =HYPERLINK(...)
 * would run for everyone who opens the Sheet; a leading apostrophe stores it
 * as literal text (getValues/getDisplayValues return it WITHOUT the
 * apostrophe). The same prefix stops Sheets converting text that merely looks
 * like a number, date, time or TRUE/FALSE (a VVD such as 1E5, a note of
 * "1/2") into a different value, which would silently change what is read
 * back. Every string this file writes to a Sheet goes through here.
 */
function sheetText_(s) {
  var str = String(s === undefined || s === null ? '' : s);
  if (/^[=+\-@\t\r]/.test(str) ||
      /^\d[\d,]*\.?\d*(e[+-]?\d+)?%?$/i.test(str) || /^\.\d+$/.test(str) ||
      /^\d{1,4}[\/.-]\d{1,2}([\/.-]\d{1,4})?/.test(str) ||
      /^\d{1,2}:\d{2}/.test(str) ||
      /^(true|false)$/i.test(str)) {
    return "'" + str;
  }
  return str;
}

/** The team-data spreadsheet, or null when setupTeamSheets has not been run. Throws if the id no longer opens. */
function openTeamSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(TEAM_SHEET_ID_KEY_);
  if (!id) return null;
  return SpreadsheetApp.openById(id);
}

function errorText_(err) {
  return String(err && err.message ? err.message : err);
}

/* ---------- VVD notes ---------- */

function readNotesFromSheet_(ss) {
  var sheet = ss.getSheetByName(VVD_NOTES_TAB_);
  if (!sheet) throw new Error('The "' + VVD_NOTES_TAB_ + '" tab is missing from the team-data Sheet.');
  var last = sheet.getLastRow();
  return notesFromRows_(last >= 2 ? sheet.getRange(2, 1, last - 1, 4).getDisplayValues() : []);
}

/** [[VVD, Note, Author, Updated At], ...] (display strings) -> the notes list the app receives. */
function notesFromRows_(rows) {
  var notes = [];
  for (var i = 0; i < rows.length; i++) {
    var vvd = String(rows[i][0]).trim().toUpperCase();
    if (!vvd) continue;
    notes.push({
      vvd: vvd,
      note: String(rows[i][1]),
      author: String(rows[i][2]).trim().toLowerCase(),
      updatedAt: String(rows[i][3])
    });
  }
  return notes;
}

function cachedNotes_() {
  try {
    var cached = CacheService.getScriptCache().get(VVD_NOTES_CACHE_KEY_);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    return null; // unusable cache or bad JSON -- reload from the Sheet
  }
}

function cacheNotes_(notes) {
  try {
    CacheService.getScriptCache().put(VVD_NOTES_CACHE_KEY_, JSON.stringify(notes), VVD_NOTES_CACHE_SECONDS_);
  } catch (err) {
    // Over the value limit or cache down: drop any older copy so nobody is served stale notes.
    try { CacheService.getScriptCache().remove(VVD_NOTES_CACHE_KEY_); } catch (e) { /* expires within the TTL */ }
  }
}

function normalizedEmail_() {
  var email = activeUserEmail_();
  return email ? email.toLowerCase() : null;
}

/* ---------- private VVD notes ----------
 *
 * Stored with PropertiesService.getUserProperties(), one property per VVD:
 *   'bfrPrivVvdNote:<VVD>' -> '{"note":"...","updatedAt":"<ISO>"}'
 * User properties belong to the user the script RUNS AS. This app is deployed "Execute as: User
 * accessing the web app", so that is the visitor and each person gets their own store, which no
 * other visitor, the script owner, or anyone with the team Sheet can read.
 *
 * Under "Execute as: Me" every visitor would share the OWNER's store (see runIdentityProbe_ in
 * Code.gs), and one person's private notes would show for everyone. privateNotesStore_ refuses
 * that case: it only hands out the store when the effective user (who the script runs as) is the
 * visitor. Otherwise private notes are reported unavailable and nothing is read or written.
 *
 * Quota: 500 KB per user and 9 KB per value (documented). A note is capped at 1000 characters
 * (at most ~4 KB as UTF-8), so a value always fits; a full store makes the save fail with an
 * error instead of dropping anything.
 */
var PRIVATE_NOTE_PREFIX_ = 'bfrPrivVvdNote:';

/** The visitor's own user-properties store, or null when the script is not running as the visitor. */
function privateNotesStore_() {
  var me = normalizedEmail_();
  if (!me) return null;
  var effective = null;
  try {
    effective = Session.getEffectiveUser().getEmail();
  } catch (err) {
    return null;
  }
  if (!effective || String(effective).toLowerCase() !== me) return null;
  return PropertiesService.getUserProperties();
}

/** The visitor's private notes as [{vvd, note, author, updatedAt, visibility:'private'}]. Skips malformed entries. */
function readPrivateNotes_(store, me) {
  var all = store.getProperties() || {};
  var notes = [];
  for (var k in all) {
    if (!Object.prototype.hasOwnProperty.call(all, k) || k.indexOf(PRIVATE_NOTE_PREFIX_) !== 0) continue;
    var vvd = k.slice(PRIVATE_NOTE_PREFIX_.length);
    if (!VVD_RE_.test(vvd)) continue;
    var v = null;
    try { v = JSON.parse(all[k]); } catch (err) { continue; }
    if (!v || typeof v.note !== 'string' || !v.note) continue;
    notes.push({ vvd: vvd, note: v.note, author: me, updatedAt: String(v.updatedAt || ''), visibility: 'private' });
  }
  return notes;
}

/** Public notes (cache first, then the Sheet). Null when the team Sheet is not set up. Throws on a Sheet error. */
function publicNotes_() {
  var notes = cachedNotes_();
  if (!notes) {
    var ss = openTeamSheet_();
    if (!ss) return null;
    notes = readNotesFromSheet_(ss);
    cacheNotes_(notes);
  }
  return notes;
}

/**
 * The reply getVvdNotes and saveVvdNote send: the public list (tagged visibility:'public') plus,
 * when available, the caller's own private notes. Private notes are added here, per call, and
 * never go into the script cache, which every visitor shares.
 */
function notesReply_(me, publicList) {
  var notes = [];
  for (var i = 0; i < publicList.length; i++) {
    var n = publicList[i];
    notes.push({ vvd: n.vvd, note: n.note, author: n.author, updatedAt: n.updatedAt, visibility: 'public' });
  }
  var privateAvailable = false;
  try {
    var store = privateNotesStore_();
    if (store) {
      notes = notes.concat(readPrivateNotes_(store, me));
      privateAvailable = true;
    }
  } catch (err) {
    privateAvailable = false; // user properties unavailable: public notes still load
  }
  return { ok: true, me: me, notes: notes, privateAvailable: privateAvailable };
}

/**
 * Public. { ok, me, privateAvailable, notes:[{vvd, note, author, updatedAt, visibility}] } or
 * { ok:false, reason:'not-configured'|'error', error? }. visibility is 'public' or 'private'.
 */
function getVvdNotes() {
  try {
    // Cache before the Sheet: opening a spreadsheet costs far more than the read, and this is
    // called on every page load, every notes poll and every panel open.
    if (!PropertiesService.getScriptProperties().getProperty(TEAM_SHEET_ID_KEY_)) return { ok: false, reason: 'not-configured' };
    var notes = publicNotes_();
    if (!notes) return { ok: false, reason: 'not-configured' };
    return notesReply_(normalizedEmail_(), notes);
  } catch (err) {
    return { ok: false, reason: 'error', error: errorText_(err) };
  }
}

/** Saves, updates or (empty text) deletes the caller's PRIVATE note on one VVD. */
function savePrivateVvdNote_(key, text, me) {
  try {
    if (!PropertiesService.getScriptProperties().getProperty(TEAM_SHEET_ID_KEY_)) return { ok: false, reason: 'not-configured' };
    var store = privateNotesStore_();
    if (!store) return { ok: false, reason: 'private-unavailable' };
    if (text === '') {
      store.deleteProperty(PRIVATE_NOTE_PREFIX_ + key);
    } else {
      store.setProperty(PRIVATE_NOTE_PREFIX_ + key, JSON.stringify({ note: text, updatedAt: new Date().toISOString() }));
    }
    var pub = publicNotes_();
    if (!pub) return { ok: false, reason: 'not-configured' };
    return notesReply_(me, pub);
  } catch (err) {
    return { ok: false, reason: 'error', error: errorText_(err) };
  }
}

/**
 * Public. Saves, updates or (empty note) deletes the CALLER's note for one
 * VVD. Only the caller's own note is ever touched: a public save only edits a
 * row whose VVD and author both match, and a private save only the caller's
 * own user properties, so this cannot change or delete anyone else's note.
 *
 * `visibility` is 'public' (the team Sheet) or 'private' (the caller's user
 * properties). Omitted means 'public', which is what pages loaded before
 * 2026-10-01 send (they call saveVvdNote(vvd, note)). A visitor can have one
 * public AND one private note on the same VVD; each is saved separately.
 */
function saveVvdNote(vvd, note, visibility) {
  if (typeof vvd !== 'string' && typeof vvd !== 'number') return { ok: false, reason: 'invalid-vvd' };
  var key = String(vvd).trim().toUpperCase();
  if (!VVD_RE_.test(key)) return { ok: false, reason: 'invalid-vvd' };
  if (typeof note !== 'string') return { ok: false, reason: 'invalid-note' };
  var text = note.trim();
  if (text.length > VVD_NOTE_MAX_CHARS_) return { ok: false, reason: 'invalid-note' };
  if (visibility === undefined || visibility === null) visibility = 'public';
  if (visibility !== 'public' && visibility !== 'private') return { ok: false, reason: 'invalid-visibility' };

  var me = normalizedEmail_();
  if (!me) return { ok: false, reason: 'no-user-identity' };
  if (visibility === 'private') return savePrivateVvdNote_(key, text, me);

  try {
    var ss = openTeamSheet_();
    if (!ss) return { ok: false, reason: 'not-configured' };
    var sheet = ss.getSheetByName(VVD_NOTES_TAB_);
    if (!sheet) return { ok: false, reason: 'error', error: 'The "' + VVD_NOTES_TAB_ + '" tab is missing from the team-data Sheet.' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { ok: false, reason: 'busy' };
    try {
      var last = sheet.getLastRow();
      var rows = last >= 2 ? sheet.getRange(2, 1, last - 1, 4).getDisplayValues() : [];
      var mine = [];
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim().toUpperCase() === key &&
            String(rows[i][2]).trim().toLowerCase() === me) mine.push(i + 2);
      }
      var stamp = new Date().toISOString();
      // `rows` is kept in step with each write, so the reply and the cache come from the one
      // read above instead of reading the whole tab again while holding the lock.
      if (text === '') {
        for (var d = mine.length - 1; d >= 0; d--) {
          sheet.deleteRow(mine[d]);
          rows.splice(mine[d] - 2, 1);
        }
      } else if (mine.length) {
        sheet.getRange(mine[0], 2, 1, 1).setValues([[sheetText_(text)]]);
        sheet.getRange(mine[0], 4, 1, 1).setValues([[sheetText_(stamp)]]);
        rows[mine[0] - 2] = [rows[mine[0] - 2][0], text, rows[mine[0] - 2][2], stamp];
      } else {
        sheet.appendRow([sheetText_(key), sheetText_(text), sheetText_(me), sheetText_(stamp)]);
        rows.push([key, text, me, stamp]);
      }
      var notes = notesFromRows_(rows);
      cacheNotes_(notes);
      return notesReply_(me, notes);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, reason: 'error', error: errorText_(err) };
  }
}

/* ---------- startup-error log ---------- */

function clip_(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeStartupReport_(report) {
  var r = (report && typeof report === 'object') ? report : {};
  var errors = [];
  if (Array.isArray(r.errors)) {
    for (var i = 0; i < r.errors.length && errors.length < 8; i++) {
      if (typeof r.errors[i] === 'string') errors.push(r.errors[i].slice(0, 500));
    }
  }
  return {
    reason: clip_(r.reason, 2000),
    errors: errors,
    reactLoaded: typeof r.reactLoaded === 'boolean' ? r.reactLoaded : null,
    userAgent: clip_(r.userAgent, 300),
    page: clip_(r.page, 300),
    at: clip_(r.at, 64)
  };
}

/** True (and counts this report) while the user is under STARTUP_ERR_RATE_MAX_ per window; a broken cache never blocks logging. */
function startupErrorAllowed_(email) {
  try {
    var cache = CacheService.getScriptCache();
    var key = ('bfrStartupErr:' + (email || 'anon')).slice(0, 240);
    var now = Date.now();
    var state = null;
    try { state = JSON.parse(cache.get(key)); } catch (err) { state = null; }
    if (!state || typeof state.n !== 'number' || typeof state.t0 !== 'number') state = { n: 0, t0: now };
    if (state.n >= STARTUP_ERR_RATE_MAX_) return false;
    var remaining = Math.max(1, Math.ceil(STARTUP_ERR_RATE_WINDOW_SECONDS_ - (now - state.t0) / 1000));
    cache.put(key, JSON.stringify({ n: state.n + 1, t0: state.t0 }), remaining);
    return true;
  } catch (err) {
    return true;
  }
}

function ensureTab_(ss, name, header) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name);
  sheet.appendRow(header);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Public. The app calls this when it fails to start, so failures on other
 * people's machines become visible. Always writes the Apps Script execution
 * log line first, then (unless rate-limited) a row in the Startup Errors tab.
 * Never throws.
 */
function logClientStartupError(report) {
  try {
    var clean = sanitizeStartupReport_(report);
    var email = activeUserEmail_();
    var withUser = {};
    Object.keys(clean).forEach(function (k) { withUser[k] = clean[k]; });
    withUser.user = email;
    console.error('[startup-error] ' + JSON.stringify(withUser));

    if (!startupErrorAllowed_(email)) return { ok: true, logged: 'rate-limited' };

    var ss;
    try {
      ss = openTeamSheet_();
    } catch (err) {
      return { ok: true, logged: 'console', error: errorText_(err) };
    }
    if (!ss) return { ok: true, logged: 'console' };
    try {
      var sheet = ensureTab_(ss, STARTUP_ERRORS_TAB_, STARTUP_ERRORS_HEADER_);
      sheet.appendRow([
        sheetText_(new Date().toISOString()),
        sheetText_(email || ''),
        sheetText_(clean.reason),
        sheetText_(clean.errors.join('\n')),
        clean.reactLoaded === null ? '' : (clean.reactLoaded ? 'yes' : 'no'),
        sheetText_(clean.userAgent),
        sheetText_(clean.page)
      ]);
      return { ok: true, logged: 'sheet' };
    } catch (err) {
      return { ok: true, logged: 'console', error: errorText_(err) };
    }
  } catch (err) {
    return { ok: true, logged: 'console', error: errorText_(err) };
  }
}

/* ---------- config Sheet ---------- */

/**
 * Reads the config Sheet for injection as window.__SERVER_CONFIG__. Never
 * throws. Values are the raw cell text: the APP validates types and ranges
 * and falls back per key, so a typo in the Sheet cannot break the app. A
 * repeated key takes its last non-blank row. Cached for 6 hours
 * (script-global; the config Sheet's onEdit trigger rewrites it), successes only.
 */
function readAppConfig_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = null;
    try { cached = cache.get(APP_CONFIG_CACHE_KEY_); } catch (err) { cached = null; }
    if (cached) {
      try { return JSON.parse(cached); } catch (err) { /* reload */ }
    }
    var configId = PropertiesService.getScriptProperties().getProperty(CONFIG_SHEET_ID_KEY_);
    if (!configId) return { available: false, reason: 'not-configured' };

    // A read that failed for this visitor (no view access, a missing tab) is remembered briefly,
    // per visitor and per config Sheet, so every page load doesn't wait for the same failure again.
    var errKey = APP_CONFIG_ERROR_KEY_PREFIX_ + configId + ':' + (activeUserEmail_() || 'anon');
    var cachedErr = null;
    try { cachedErr = cache.get(errKey); } catch (err) { cachedErr = null; }
    if (cachedErr) return { available: false, reason: 'error', error: cachedErr };
    try {
      var result = loadAppConfigFromSheet_();
      try { cache.put(APP_CONFIG_CACHE_KEY_, JSON.stringify(result), APP_CONFIG_CACHE_SECONDS_); } catch (err) { /* served uncached */ }
      return result;
    } catch (err) {
      try { cache.put(errKey, errorText_(err).slice(0, 500), APP_CONFIG_ERROR_CACHE_SECONDS_); } catch (e) { /* retried next load */ }
      throw err;
    }
  } catch (err) {
    return { available: false, reason: 'error', error: errorText_(err) };
  }
}

/** Reads the config Sheet (throws on any failure). Callers cache the result. */
function loadAppConfigFromSheet_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(CONFIG_SHEET_ID_KEY_));

  var settingsSheet = ss.getSheetByName(CONFIG_SETTINGS_TAB_);
  if (!settingsSheet) throw new Error('The "' + CONFIG_SETTINGS_TAB_ + '" tab is missing from the config Sheet.');
  var settings = {};
  var unknownKeys = [];
  var last = settingsSheet.getLastRow();
  var rows = last >= 2 ? settingsSheet.getRange(2, 1, last - 1, 2).getDisplayValues() : [];
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][0]).trim();
    var value = String(rows[i][1]).trim();
    if (!key) continue;
    if (APP_CONFIG_KEYS_.indexOf(key) === -1) {
      if (unknownKeys.indexOf(key) === -1) unknownKeys.push(key);
    } else if (value) {
      settings[key] = value;
    }
  }

  var portExclusions = null;
  var portsSheet = ss.getSheetByName(CONFIG_PORTS_TAB_);
  if (portsSheet) {
    portExclusions = [];
    var pLast = portsSheet.getLastRow();
    var pRows = pLast >= 2 ? portsSheet.getRange(2, 1, pLast - 1, 2).getDisplayValues() : [];
    for (var j = 0; j < pRows.length; j++) {
      var lane = String(pRows[j][0]).trim().toUpperCase();
      var port = String(pRows[j][1]).trim().toUpperCase();
      if (lane && port) portExclusions.push({ lane: lane, port: port });
    }
  }

  return {
    available: true,
    settings: settings,
    unknownKeys: unknownKeys,
    portExclusions: portExclusions,
    loadedAt: new Date().toISOString()
  };
}

/**
 * Re-reads the config Sheet into the cache (write-through), so doGet reads only the cache.
 * `force` re-reads even when a copy is cached (an edit); otherwise it only refills an evicted
 * cache (refreshDataFeeds, every 30 minutes). A failed read clears the cache so the next page load
 * reads the Sheet itself rather than serving a copy that no longer matches it.
 */
function warmAppConfigCache_(force) {
  var cache = CacheService.getScriptCache();
  if (!PropertiesService.getScriptProperties().getProperty(CONFIG_SHEET_ID_KEY_)) return;
  if (!force && cache.get(APP_CONFIG_CACHE_KEY_)) return;
  try {
    cache.put(APP_CONFIG_CACHE_KEY_, JSON.stringify(loadAppConfigFromSheet_()), APP_CONFIG_CACHE_SECONDS_);
  } catch (err) {
    try { cache.remove(APP_CONFIG_CACHE_KEY_); } catch (e) { /* nothing cached */ }
    throw err;
  }
}

/** Inserts window.__SERVER_CONFIG__ before the babel tag -- same mechanism and marker as injectServerExtras_. */
function injectAppConfig_(html, config) {
  var marker = '<script type="text/babel">';
  var idx = html.indexOf(marker);
  if (idx === -1) return html;
  var json = JSON.stringify(config).replace(/</g, '\\u003c');
  var tag = '<script>window.__SERVER_CONFIG__=' + json + ';</script>\n    ';
  return html.slice(0, idx) + tag + html.slice(idx);
}

/**
 * Public, and the handler for the config Sheet's onEdit trigger (which runs
 * as the admin). Only clears a cache, so it is harmless if anyone calls it.
 */
function onConfigSheetEdit(e) {
  try { warmAppConfigCache_(true); } catch (err) { /* cache cleared; the next page load reads the Sheet */ }
}

/** Public: run from the editor (or a button) to make config edits show up without waiting out the cache. */
function refreshAppConfig() {
  try {
    warmAppConfigCache_(true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText_(err) };
  }
}

/* ---------- admin setup ---------- */

/** The spreadsheet stored under `propKey` if it still opens, else a new one (id stored). */
function getOrCreateSpreadsheet_(propKey, title) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propKey);
  if (id) {
    try { return { ss: SpreadsheetApp.openById(id), created: false }; } catch (err) { /* deleted or unreachable -- make a new one */ }
  }
  var ss = SpreadsheetApp.create(title);
  props.setProperty(propKey, ss.getId());
  return { ss: ss, created: true };
}

/**
 * Makes sure `name` exists with a bold, frozen header row. A brand-new tab
 * (or a completely empty one) is filled with `rows`; a tab that already has
 * anything in it is left alone so re-running never overwrites edits.
 * `spare` is a fresh spreadsheet's default first tab, renamed instead of left behind.
 */
function ensureSetupTab_(ss, name, header, rows, spare) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    if (spare && ss.getSheetByName(spare)) {
      sheet = ss.getSheetByName(spare);
      sheet.setName(name);
    } else {
      sheet = ss.insertSheet(name);
    }
  }
  if (sheet.getLastRow() === 0) {
    var data = [header].concat(rows || []);
    sheet.getRange(1, 1, data.length, header.length).setValues(data);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function shareWithOrg_(ss, permission) {
  try {
    DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.DOMAIN, permission);
    return 'ok';
  } catch (err) {
    return errorText_(err);
  }
}

/**
 * Admin only (same admin as the archive). Run once from the editor; safe to
 * re-run -- it creates only what is missing and never overwrites existing
 * rows. Returns the two Sheet URLs, whether each share succeeded, and whether
 * the config Sheet's onEdit trigger is in place.
 */
function setupTeamSheets() {
  assertArchiveAdmin_();

  var team = getOrCreateSpreadsheet_(TEAM_SHEET_ID_KEY_, TEAM_SHEET_NAME_);
  // Only a spreadsheet created in this run has a default "Sheet1" that is safe to rename.
  ensureSetupTab_(team.ss, VVD_NOTES_TAB_, VVD_NOTES_HEADER_, [], team.created ? 'Sheet1' : null);
  ensureSetupTab_(team.ss, STARTUP_ERRORS_TAB_, STARTUP_ERRORS_HEADER_, [], null);

  var config = getOrCreateSpreadsheet_(CONFIG_SHEET_ID_KEY_, CONFIG_SHEET_NAME_);
  var settingRows = APP_CONFIG_KEYS_.map(function (k) {
    return [k, APP_CONFIG_DEFAULTS_[k], APP_CONFIG_NOTES_[k]];
  });
  var portRows = DEFAULT_PORT_EXCLUSIONS_.map(function (p) { return [p.lane, p.port]; });
  ensureSetupTab_(config.ss, CONFIG_SETTINGS_TAB_, CONFIG_SETTINGS_HEADER_, settingRows, config.created ? 'Sheet1' : null);
  ensureSetupTab_(config.ss, CONFIG_PORTS_TAB_, CONFIG_PORTS_HEADER_, portRows, null);

  var sharing = {
    team: shareWithOrg_(team.ss, DriveApp.Permission.EDIT),
    config: shareWithOrg_(config.ss, DriveApp.Permission.VIEW)
  };

  var out = { ok: true, teamSheetUrl: team.ss.getUrl(), configSheetUrl: config.ss.getUrl(), sharing: sharing, triggerInstalled: false };
  try {
    var configId = config.ss.getId();
    var present = false;
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() !== 'onConfigSheetEdit') return;
      // A trigger left over from a config Sheet that no longer exists would never fire.
      if (t.getTriggerSourceId && t.getTriggerSourceId() !== configId) ScriptApp.deleteTrigger(t);
      else present = true;
    });
    if (!present) ScriptApp.newTrigger('onConfigSheetEdit').forSpreadsheet(configId).onEdit().create();
    out.triggerInstalled = true;
  } catch (err) {
    out.triggerError = errorText_(err);
  }

  try { CacheService.getScriptCache().remove(APP_CONFIG_CACHE_KEY_); } catch (err) { /* nothing cached to clear */ }
  console.log('Team sheets ready: ' + out.teamSheetUrl + ' | ' + out.configSheetUrl + ' | sharing ' + JSON.stringify(sharing));
  return out;
}

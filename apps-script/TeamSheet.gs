/**
 * --- Team features backed by two Google Sheets (2026-09-29) ---
 *
 *  - VVD notes, two kinds (2026-10-01):
 *      public  -- one per (VVD, author), in the team Sheet, shown to everyone. Used for VVDs
 *                 where cargo has been cut, so the whole team can see it.
 *      private -- one per (VVD, visitor), in a Google Sheet in the VISITOR's own Drive that is shared
 *                 with no one (Vessel Planning reads and writes the same file, 2026-10-27), shown only to them. Never
 *                 written to the team Sheet or the shared cache. See the private VVD notes block below.
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
 * Code.gs functions (activeUserEmail_, visitorUserStore_, assertArchiveAdmin_) at call time.
 *
 * Private notes also need the Drive advanced service (Drive API v3) enabled in the Apps Script
 * project (Services > Drive, identifier `Drive`); see apps-script/PRIVATE_NOTES_FILE.md.
 */

var TEAM_SHEET_ID_KEY_ = 'bfrTeamSheetId';
var CONFIG_SHEET_ID_KEY_ = 'bfrConfigSheetId';
var TEAM_SHEET_NAME_ = 'Booking Flash Team Data';
var CONFIG_SHEET_NAME_ = 'Booking Flash Config';

var VVD_NOTES_TAB_ = 'VVD Notes';
var VVD_NOTES_HEADER_ = ['VVD', 'Note', 'Author', 'Updated At', 'Source'];
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
/**
 * Generation stamp for the notes cache (2026-10-06). Every write to the public notes bumps it
 * (publishNotes_ / invalidateNotesCache_). A reader that missed the cache records it before reading
 * the Sheet and fills the cache only if it is unchanged afterwards, so a save that lands while a
 * reader is between its Sheet read and its cache put can no longer be overwritten by that reader's
 * older list (which used to stick for the whole hour). Its TTL is the cache's maximum so it outlives
 * every notes entry it guards; if it is evicted anyway, a reader sees it change and skips the put.
 */
var VVD_NOTES_GEN_KEY_ = 'bfrVvdNotesGen';
var VVD_NOTES_GEN_SECONDS_ = 21600;
var VVD_NOTE_MAX_CHARS_ = 1000;
var VVD_RE_ = /^[A-Z0-9][A-Z0-9 ._\/-]{1,39}$/;
/**
 * Which app a note was written from (the "Source" column and the `source` on every note in a reply).
 * saveVvdNote accepts only these; a blank or unknown stored value reads as the default, so every note
 * written before the column existed is a Booking Flash note.
 */
var NOTE_SOURCES_ = ['BFR', 'VPT'];
var DEFAULT_NOTE_SOURCE_ = 'BFR';
/** getVvdNotesFor refuses a longer list rather than silently dropping VVDs from the end. */
var VVD_NOTES_FOR_MAX_ = 200;

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

/**
 * Config Sheet keys that carry a LINK the app builds, not a number or list (D84 slice 1-C, 2026-10-30):
 * vptWebAppUrl is the Vessel Planning web app's /exec URL for the row link menu's "Open in Vessel
 * Planning". Passed through as raw text like the keys above (the app accepts only an
 * https://script.google.com/ URL). Kept out of APP_CONFIG_KEYS_ on purpose: those keys are seeded into
 * the Settings tab by setupTeamSheets and must equal the app's SERVER_CONFIG_RULES; this one has no
 * default, so an admin adds the row by hand (apps-script/README.md, the 1-C checklist).
 */
var APP_CONFIG_LINK_KEYS_ = ['vptWebAppUrl'];

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
  if (/^[=+\-@\t\r']/.test(str) || // a leading ' is Sheets' own text marker: unprefixed it is swallowed, so "'tis" would read back as "tis"
      /^\d[\d,]*\.?\d*(e[+-]?\d+)?%?$/i.test(str) || /^\.\d+$/.test(str) ||
      /^\d{1,4}[\/.-]\d{1,2}([\/.-]\d{1,4})?/.test(str) ||
      /^\d{1,2}:\d{2}/.test(str) ||
      /^(true|false)$/i.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * The team-data spreadsheet, or null when setupTeamSheets has not been run. Throws if the id no longer opens.
 * `knownId` is for a caller that has ALREADY read the TEAM_SHEET_ID_KEY_ property in this same call
 * (the notes paths do, to answer 'not-configured' before touching the cache), so it is not read twice.
 */
function openTeamSheet_(knownId) {
  var id = knownId || PropertiesService.getScriptProperties().getProperty(TEAM_SHEET_ID_KEY_);
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
  return notesFromRows_(readNotesRows_(sheet));
}

/**
 * The tab's data rows as display strings, up to VVD_NOTES_HEADER_.length columns. A Sheet created before the
 * Source column existed has the default 26 columns, so column 5 reads as blank; one whose spare columns were
 * deleted is read as far as it goes (a row then has fewer cells, and notesFromRows_ treats a missing Source as blank).
 */
function readNotesRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var width = Math.min(VVD_NOTES_HEADER_.length, sheet.getMaxColumns());
  return sheet.getRange(2, 1, last - 1, width).getDisplayValues();
}

/** A stored or cached source -> 'BFR' or 'VPT'; anything else (blank, hand-edited, absent in an older cached list) is the default. */
function noteSource_(raw) {
  var v = String(raw === undefined || raw === null ? '' : raw).trim().toUpperCase();
  return NOTE_SOURCES_.indexOf(v) === -1 ? DEFAULT_NOTE_SOURCE_ : v;
}

/** [[VVD, Note, Author, Updated At, Source], ...] (display strings; Source may be missing) -> the notes list the app receives. */
function notesFromRows_(rows) {
  var notes = [];
  for (var i = 0; i < rows.length; i++) {
    var vvd = String(rows[i][0]).trim().toUpperCase();
    if (!vvd) continue;
    notes.push({
      vvd: vvd,
      note: String(rows[i][1]),
      author: String(rows[i][2]).trim().toLowerCase(),
      updatedAt: String(rows[i][3]),
      source: noteSource_(rows[i][4])
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

/** The notes cache's generation stamp: '' when none is stored, null when the cache can't be read. */
function notesGeneration_() {
  try {
    return CacheService.getScriptCache().get(VVD_NOTES_GEN_KEY_) || '';
  } catch (err) {
    return null;
  }
}

/** Marks every list read before now as outdated (see VVD_NOTES_GEN_KEY_). */
function bumpNotesGeneration_() {
  try {
    CacheService.getScriptCache().put(VVD_NOTES_GEN_KEY_, Date.now() + ':' + Math.random().toString(36).slice(2), VVD_NOTES_GEN_SECONDS_);
  } catch (err) { /* cache down: nothing to protect */ }
}

/** A writer's write-through, after the Sheet write is flushed: bump the generation, then cache the new list. */
function publishNotes_(notes) {
  bumpNotesGeneration_();
  cacheNotes_(notes);
}

/** A writer whose write may have half-landed: outdate in-flight reads and drop the cached list. */
function invalidateNotesCache_() {
  bumpNotesGeneration_();
  try { CacheService.getScriptCache().remove(VVD_NOTES_CACHE_KEY_); } catch (err) { /* expires within the TTL */ }
}

/**
 * A reader's cache fill: `genBefore` is notesGeneration_() from BEFORE it read the Sheet. Skips the
 * put when a save has bumped the generation since (that save already cached a newer list). The check
 * and the put are two cache calls, so a save can still land between them; the re-check after the put
 * catches that and removes what this reader wrote, which costs the next caller one Sheet read and
 * never serves the older list.
 */
function cacheNotesIfCurrent_(notes, genBefore) {
  if (genBefore === null || notesGeneration_() !== genBefore) return;
  cacheNotes_(notes);
  if (notesGeneration_() !== genBefore) {
    try { CacheService.getScriptCache().remove(VVD_NOTES_CACHE_KEY_); } catch (err) { /* expires within the TTL */ }
  }
}

function normalizedEmail_() {
  var email = activeUserEmail_();
  return email ? email.toLowerCase() : null;
}

/* ---------- private VVD notes ----------
 *
 * Stored in ONE Google Sheet per person, in THEIR OWN Drive, shared with no one (Kevin, 2026-10-27, so that
 * Booking Flash and Vessel Planning (VPT) show the same private notes). The contract both apps follow is in
 * apps-script/PRIVATE_NOTES_FILE.md; any change here must be made in VPT too
 * (kevinmarko/vessel-planning-tool, new Build/src/SharedNotes.js). In short:
 *   - found with Drive API v3 (the advanced service `Drive`): 'me' in owners, not trashed, a spreadsheet,
 *     property bfrPrivateNotes = '1' (`properties`, NOT `appProperties`: the two apps are different Google Cloud
 *     projects, so only `properties` is visible to both); several matches -> the oldest (createdTime);
 *   - tab "Private Notes": VVD | Note | Updated At | Source, one row per VVD, created on the first private SAVE
 *     (a read, or a delete with no file, never creates one);
 *   - a private save holds the person's user lock (tryLock(5000), 'busy' when not free) around find, create, write and search
 *     again (writePrivFile_): after EVERY write the oldest tagged file is looked for once more, and if it is not the file written
 *     to, the same VVD row (or its deletion) is written there too and a file THIS save created is trashed. One row per VVD;
 *   - a failing Drive.Files.get on the cached id, for any reason, means search again;
 *   - cached as {id, modifiedTime, notes} in the USER cache (per person) under bfr:priv:1 for 30 minutes. An explicit
 *     read (getVvdNotes / getVvdNotesFor with privateNotes:true) makes one Drive call to compare the file's
 *     modifiedTime and re-reads the rows only when it moved, which is how a note written in VPT shows up here.
 *
 * The script runs as the visitor ("Execute as: User accessing the web app"), so 'me' is the visitor. Under
 * "Execute as: Me" 'me' would be the OWNER for every visitor and everyone would share one file, so the file is used only
 * when privateNotesStore_ allows it, exactly as the user-properties store was before: it hands out the visitor's
 * own user-properties store only when the effective user is the visitor (visitorUserStore_ in Code.gs) and null
 * otherwise, and then private notes are reported unavailable and nothing is read or written. The store itself is now
 * used only to move the old notes (below).
 *
 * Moving the old notes (migratePrivateNotes_): before 2026-10-27 each private note was a user property,
 *   'bfrPrivVvdNote:<VVD>' -> '{"note":"...","updatedAt":"<ISO>","source":"BFR"|"VPT"}'
 * The first time a person's private notes are read or saved, those are copied into the file (the newer note wins when
 * the file already has that VVD), the file is flushed and re-read to confirm every note is there, and only then are the
 * properties deleted. A user property 'bfrPrivMigrated' = '1' records that this has been done, so every later call
 * costs one property read.
 */
var PRIVATE_NOTE_PREFIX_ = 'bfrPrivVvdNote:';
var PRIV_MIGRATED_KEY_ = 'bfrPrivMigrated';
var PRIV_FILE_PROP_KEY_ = 'bfrPrivateNotes';
var PRIV_FILE_PROP_VAL_ = '1';
var PRIV_FILE_TITLE_ = 'Booking Flash private notes (only you)';
var PRIV_FILE_DESCRIPTION_ = 'Your private VVD notes from Booking Flash and Vessel Planning. Only you can see this file; do not share it.';
var PRIV_TAB_ = 'Private Notes';
var PRIV_HEADER_ = ['VVD', 'Note', 'Updated At', 'Source'];
var PRIV_CACHE_KEY_ = 'bfr:priv:1';
var PRIV_CACHE_SECONDS_ = 1800;
var PRIV_MIG_BACKOFF_KEY_ = 'bfr:privmig:retry';
var PRIV_MIG_BACKOFF_SECONDS_ = 300;
var PRIV_LOCK_MS_ = 5000; // the user lock only queues one person's own requests (two tabs): a short wait, then 'busy'

/** The visitor's own user-properties store, or null when the script is not running as the visitor. This is the "execute as me" guard. */
function privateNotesStore_() {
  return visitorUserStore_();
}

function privTime_(iso) {
  var n = Date.parse(iso);
  return isNaN(n) ? 0 : n;
}

function privCached_() {
  try {
    var raw = CacheService.getUserCache().get(PRIV_CACHE_KEY_);
    var st = raw ? JSON.parse(raw) : null;
    return st && typeof st === 'object' && Array.isArray(st.notes) ? st : null;
  } catch (err) {
    return null;
  }
}

function privPut_(st) {
  try {
    CacheService.getUserCache().put(PRIV_CACHE_KEY_, JSON.stringify(st), PRIV_CACHE_SECONDS_);
  } catch (err) {
    // Most likely over the 100 KB CacheService value limit (about 100 full-length notes): every read then goes to Drive and the Sheet.
    console.log('Private notes cache not stored (' + errorText_(err) + '); each read will go to the file.');
    try { CacheService.getUserCache().remove(PRIV_CACHE_KEY_); } catch (e) { /* expires within the TTL */ }
  }
}

function privForget_() {
  try { CacheService.getUserCache().remove(PRIV_CACHE_KEY_); } catch (err) { /* expires within the TTL */ }
}

/** The caller's private-notes file {id, modifiedTime} (the oldest when there are several), or null when they have none. Throws on a Drive error. */
function findPrivFile_() {
  if (typeof Drive === 'undefined') throw new Error('The Drive advanced service (Drive API v3) is not enabled for this project.');
  var q = "'me' in owners and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and " +
    "properties has { key='" + PRIV_FILE_PROP_KEY_ + "' and value='" + PRIV_FILE_PROP_VAL_ + "' }";
  var r = Drive.Files.list({ q: q, fields: 'files(id,modifiedTime,createdTime)', orderBy: 'createdTime', pageSize: 10 });
  // A v2 Drive service answers `items` and reads the query differently: refuse it rather than quietly creating a
  // second file that VPT never finds.
  if (r && !r.files && r.items) throw new Error('The Drive advanced service must be v3 (Drive API v3) for private notes.');
  var f = r && r.files && r.files.length ? r.files[0] : null;
  return f ? { id: f.id, modifiedTime: String(f.modifiedTime || '') } : null;
}

/**
 * The file's modifiedTime, or null when it is trashed or when the lookup fails for ANY reason (404, no access, a Drive
 * hiccup): the contract says a failing get on the cached id means "search again", and the search then settles which file is real.
 */
function privModifiedTime_(id) {
  try {
    var f = Drive.Files.get(id, { fields: 'modifiedTime,trashed' });
    return f && !f.trashed ? String(f.modifiedTime || '') : null;
  } catch (err) {
    return null;
  }
}

function privSheet_(id) {
  var ss = SpreadsheetApp.openById(id);
  var named = ss.getSheetByName(PRIV_TAB_);
  if (named) return named;
  // The contract falls back to the first tab, but only one that still has the notes header: never write rows into an unrelated tab.
  var first = ss.getSheets()[0];
  var head = first.getRange(1, 1, 1, PRIV_HEADER_.length).getDisplayValues()[0];
  for (var i = 0; i < PRIV_HEADER_.length; i++) {
    if (String(head[i]).trim().toLowerCase() !== PRIV_HEADER_[i].toLowerCase()) {
      throw new Error('The private notes file has no "' + PRIV_TAB_ + '" tab and its first tab does not have the ' + PRIV_HEADER_.join(' | ') + ' header.');
    }
  }
  return first;
}

function privRows_(sh) {
  var last = sh.getLastRow();
  return last >= 2 ? sh.getRange(2, 1, last - 1, PRIV_HEADER_.length).getDisplayValues() : [];
}

/** The rows as [{vvd, note, updatedAt, source}], skipping a row with an invalid VVD or an empty note. */
function privNotesFrom_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var vvd = String(rows[i][0]).trim().toUpperCase();
    var note = String(rows[i][1]);
    if (!VVD_RE_.test(vvd) || !note) continue;
    out.push({ vvd: vvd, note: note, updatedAt: String(rows[i][2]), source: noteSource_(rows[i][3]) });
  }
  return out;
}

/**
 * {id, modifiedTime, notes} of the caller's private file ({id:null, notes:[]} when they have none).
 * check = make sure it is current: one Drive call when the cache holds a file (the rows are re-read only when its
 * modifiedTime moved), a Drive search when the cache holds none or the file is trashed. Without `check` a cached
 * state is returned as it is. Throws on a Drive or Sheet error.
 */
function privState_(check) {
  var c = privCached_();
  if (c && !check) return c;
  if (c && c.id) {
    var m = privModifiedTime_(c.id);
    if (m !== null && m === c.modifiedTime) return c;
  }
  var f = findPrivFile_();
  var st = f ? { id: f.id, modifiedTime: f.modifiedTime, notes: privNotesFrom_(privRows_(privSheet_(f.id))) } : { id: null, modifiedTime: '', notes: [] };
  privPut_(st);
  return st;
}

/**
 * Creates the caller's private file (tagged, shared with no one). If the other app created one at the same moment, the
 * oldest wins: its id is returned and ours goes to the trash.
 * @return {{id:string, created:boolean}} created = `id` is the file made here (writePrivFile_ may still trash it, never another one)
 */
function createPrivFile_() {
  var ss = SpreadsheetApp.create(PRIV_FILE_TITLE_);
  var sh = ss.getSheets()[0];
  sh.setName(PRIV_TAB_);
  sh.getRange(1, 1, 1, PRIV_HEADER_.length).setValues([PRIV_HEADER_]);
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();
  var props = {};
  props[PRIV_FILE_PROP_KEY_] = PRIV_FILE_PROP_VAL_;
  try {
    Drive.Files.update({ properties: props, description: PRIV_FILE_DESCRIPTION_ }, ss.getId());
  } catch (err) {
    // Untagged, no search would ever find it: trash it now so a retry does not leave a second spare behind.
    try { Drive.Files.update({ trashed: true }, ss.getId()); } catch (err2) { /* best effort */ }
    throw err;
  }
  var oldest = findPrivFile_();
  if (oldest && oldest.id !== ss.getId()) {
    try { Drive.Files.update({ trashed: true }, ss.getId()); } catch (err) { /* an empty spare file: harmless */ }
    return { id: oldest.id, created: false };
  }
  return { id: ss.getId(), created: true };
}

/**
 * Runs `apply(sh, rows)` (it writes to the Sheet and returns the rows as they are after) on private file `id`, creating the
 * file first when `id` is empty, then searches ONCE MORE (the other app's tag may land after our own search). If the oldest
 * tagged file is not the one written to, `apply` runs on the oldest too (both apps read the oldest), and the file written
 * first goes to the trash ONLY if this call created it (a file we did not create is never trashed). `apply` must therefore
 * give the same result when run twice on different files (a fixed stamp, "write this VVD's row").
 * The caller holds the user lock. Returns {id, rows} of the file that is now read: the oldest. Throws on a Drive or Sheet error.
 */
function writePrivFile_(id, apply) {
  var created = false;
  if (!id) {
    var c = createPrivFile_();
    id = c.id;
    created = c.created;
  }
  var sh = privSheet_(id);
  var rows = apply(sh, privRows_(sh));
  SpreadsheetApp.flush();
  var oldest = findPrivFile_();
  if (oldest && oldest.id !== id) {
    var osh = privSheet_(oldest.id);
    rows = apply(osh, privRows_(osh));
    SpreadsheetApp.flush();
    if (created) {
      try { Drive.Files.update({ trashed: true }, id); } catch (err) { /* never read again: harmless */ }
    }
    id = oldest.id;
  }
  return { id: id, rows: rows };
}

/** The person's user lock (LockService.getUserLock, tryLock(PRIV_LOCK_MS_)), or null when it is not free. Release it in a finally. */
function privLock_() {
  try {
    var lock = LockService.getUserLock();
    return lock.tryLock(PRIV_LOCK_MS_) ? lock : null;
  } catch (err) {
    return null;
  }
}

/**
 * The old user-property private notes: { items:[{prop, vvd, note, updatedAt, source}], empties:[prop] }.
 * `empties` are properties that parse but hold no note text (nothing to lose, so they are deleted too). A property
 * that does not parse, or whose VVD is invalid, is neither: nothing ever read it, and it is left alone.
 */
function legacyPrivateNotes_(store) {
  var all = store.getProperties() || {};
  var out = { items: [], empties: [] };
  for (var k in all) {
    if (!Object.prototype.hasOwnProperty.call(all, k) || k.indexOf(PRIVATE_NOTE_PREFIX_) !== 0) continue;
    var vvd = k.slice(PRIVATE_NOTE_PREFIX_.length);
    if (!VVD_RE_.test(vvd)) continue;
    var v = null;
    try { v = JSON.parse(all[k]); } catch (err) { continue; }
    if (!v || typeof v !== 'object') continue;
    if (typeof v.note !== 'string' || !v.note) { out.empties.push(k); continue; }
    out.items.push({ prop: k, vvd: vvd, note: v.note.slice(0, VVD_NOTE_MAX_CHARS_), updatedAt: String(v.updatedAt || ''), source: noteSource_(v.source) });
  }
  return out;
}

/**
 * Moves the person's old user-property private notes into their file (see the block comment above), once.
 * Never loses a note: a property is deleted only after the file was flushed and re-read with the note in it.
 * Idempotent: a repeat finds the file already holding every note (an equal timestamp keeps the file's row) and
 * just deletes the properties. Never throws on a Drive or Sheet error: the properties stay untouched, the failure is
 * remembered in the user cache for PRIV_MIG_BACKOFF_SECONDS_ (so a move that cannot finish is not retried, with its lock and
 * Drive calls, on every read), and the result is false.
 *
 * `locked` = the caller already holds the person's user lock (a private save does, for its whole find/create/write/search).
 * LockService's user lock is not re-entrant, so the move must NOT take it again then. Without it (a read), the move takes
 * the lock itself for its own duration; if another request of the same person holds it, this call skips the move.
 *
 * @return {boolean} true = nothing is left to move; false = old notes are still in the user properties (readPrivateNotes_ shows them)
 */
function migratePrivateNotes_(store, locked) {
  if (store.getProperty(PRIV_MIGRATED_KEY_) === '1') return true;
  var found = legacyPrivateNotes_(store);
  if (found.items.length || found.empties.length) {
    if (privMigrationBackedOff_()) return false;
    var lock = null;
    if (!locked) {
      lock = privLock_();
      if (!lock) return false;
    }
    try {
      // Another request may have finished the move while this one waited for the lock.
      found = legacyPrivateNotes_(store);
      if (!moveLegacyPrivateNotes_(store, found)) {
        privMigrationBackOff_();
        return false;
      }
    } catch (err) {
      privMigrationBackOff_();
      return false;
    } finally {
      if (lock) { try { lock.releaseLock(); } catch (err2) { /* released when the execution ends */ } }
    }
  }
  try { store.setProperty(PRIV_MIGRATED_KEY_, '1'); } catch (err) { /* the next call scans again: a full user store must not block a save */ }
  return true;
}

function privMigrationBackedOff_() {
  try { return !!CacheService.getUserCache().get(PRIV_MIG_BACKOFF_KEY_); } catch (err) { return false; }
}

function privMigrationBackOff_() {
  try { CacheService.getUserCache().put(PRIV_MIG_BACKOFF_KEY_, '1', PRIV_MIG_BACKOFF_SECONDS_); } catch (err) { /* the next call tries again */ }
}

/** The copy-verify-delete step of migratePrivateNotes_. True when every note is in the file and every property is deleted. */
function moveLegacyPrivateNotes_(store, found) {
  var done = [];
  if (found.items.length) {
    var st = privState_(true);
    var wrote = {};
    // writePrivFile_ also repeats the merge in the oldest file when its search after the write finds an older one;
    // `wrote` is reset on each run, so it always describes the file that is read in the end.
    var res = writePrivFile_(st.id, function (sh, rows) {
      wrote = {};
      var at = {};
      for (var i = 0; i < rows.length; i++) {
        var rv = String(rows[i][0]).trim().toUpperCase();
        if (!Object.prototype.hasOwnProperty.call(at, rv)) at[rv] = i;
      }
      for (var n = 0; n < found.items.length; n++) {
        var it = found.items[n];
        var row = Object.prototype.hasOwnProperty.call(at, it.vvd) ? at[it.vvd] : -1;
        if (row === -1) {
          sh.appendRow([sheetText_(it.vvd), sheetText_(it.note), sheetText_(it.updatedAt), sheetText_(it.source)]);
          rows.push([it.vvd, it.note, it.updatedAt, it.source]);
          at[it.vvd] = rows.length - 1;
          wrote[it.vvd] = it.note;
        } else if (!String(rows[row][1]) || privTime_(it.updatedAt) > privTime_(rows[row][2])) {
          sh.getRange(row + 2, 2, 1, 3).setValues([[sheetText_(it.note), sheetText_(it.updatedAt), sheetText_(it.source)]]);
          rows[row] = [it.vvd, it.note, it.updatedAt, it.source];
          wrote[it.vvd] = it.note;
        }
        // else: the file's note is as new or newer, so it stays and the old property is dropped.
      }
      return rows;
    });
    var id = res.id;
    // Read the file back: a property is deleted only if its note is really there.
    var after = privRows_(privSheet_(id));
    var have = {};
    for (var a = 0; a < after.length; a++) {
      var av = String(after[a][0]).trim().toUpperCase();
      if (String(after[a][1]) && !Object.prototype.hasOwnProperty.call(have, av)) have[av] = String(after[a][1]);
    }
    for (var m = 0; m < found.items.length; m++) {
      var f = found.items[m];
      var present = Object.prototype.hasOwnProperty.call(have, f.vvd);
      var expected = Object.prototype.hasOwnProperty.call(wrote, f.vvd) ? wrote[f.vvd] : have[f.vvd];
      if (present && have[f.vvd] === expected) done.push(f.prop);
    }
    var mt = '';
    try { mt = privModifiedTime_(id) || ''; } catch (err) { mt = ''; }
    privPut_({ id: id, modifiedTime: mt, notes: privNotesFrom_(after) });
  }
  var all = done.concat(found.empties);
  for (var d = 0; d < all.length; d++) store.deleteProperty(all[d]);
  return done.length === found.items.length;
}

/** `notes` (from the file) plus the old user-property notes that are not in it or are newer than its row, in the same shape. */
function withLegacyNotes_(notes, store) {
  var out = notes.slice();
  var items = legacyPrivateNotes_(store).items;
  for (var n = 0; n < items.length; n++) {
    var it = items[n];
    var at = -1;
    for (var i = 0; i < out.length; i++) {
      if (out[i].vvd === it.vvd) { at = i; break; }
    }
    var legacy = { vvd: it.vvd, note: it.note, updatedAt: it.updatedAt, source: it.source };
    if (at === -1) out.push(legacy);
    else if (privTime_(it.updatedAt) > privTime_(out[at].updatedAt)) out[at] = legacy;
  }
  return out;
}

/**
 * The visitor's private notes as [{vvd, note, author, updatedAt, source, visibility:'private'}], from the file (through
 * the user cache; `check` = make sure it is current, see privState_). Moves the old user-property notes first; while that has
 * not finished, the old notes still in the properties are shown too (the file's row wins unless the old note is newer), and
 * a file that cannot be read does not hide them.
 * Throws on an error with nothing old to show; the caller then reports private notes unavailable.
 */
function readPrivateNotes_(store, me, check) {
  var pending = !migratePrivateNotes_(store, false);
  var notes = [];
  try {
    notes = privState_(check).notes;
  } catch (err) {
    if (!pending) throw err;
  }
  if (pending) notes = withLegacyNotes_(notes, store);
  var out = [];
  for (var i = 0; i < notes.length; i++) {
    out.push({ vvd: notes[i].vvd, note: notes[i].note, author: me, updatedAt: String(notes[i].updatedAt || ''), source: noteSource_(notes[i].source), visibility: 'private' });
  }
  return out;
}

/**
 * Writes v's row in `sh` (empty text: deletes it) and returns the rows as they are after. One row per VVD: an update writes the
 * first row of the VVD and deletes any other rows of it bottom-up (left by an older race or a hand edit; privNotesFrom_ would
 * read each back as a note). Repeating it on another file with the same arguments gives the same result (writePrivFile_ does).
 */
function writePrivRow_(sh, rows, key, text, stamp, source) {
  var hit = [];
  var i;
  // The other app can add or delete rows in this file at any moment (its lock is not ours), which moves the row numbers read a
  // moment ago. Check the VVD in each row about to be written or deleted; if one moved, read the rows again (a few tries).
  var fresh = false;
  for (var tries = 0; tries < 3 && !fresh; tries++) {
    hit = [];
    for (i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toUpperCase() === key) hit.push(i + 2);
    }
    fresh = true;
    for (i = 0; i < hit.length; i++) {
      if (String(sh.getRange(hit[i], 1).getValue()).trim().toUpperCase() !== key) fresh = false;
    }
    if (!fresh) rows = privRows_(sh);
  }
  if (!fresh) throw new Error('The private notes file changed while saving; try again.');
  if (text === '') {
    for (i = hit.length - 1; i >= 0; i--) {
      sh.deleteRow(hit[i]);
      rows.splice(hit[i] - 2, 1);
    }
  } else if (hit.length) {
    for (i = hit.length - 1; i >= 1; i--) { // all below hit[0], so its row number still holds
      sh.deleteRow(hit[i]);
      rows.splice(hit[i] - 2, 1);
    }
    sh.getRange(hit[0], 2, 1, 3).setValues([[sheetText_(text), sheetText_(stamp), sheetText_(source)]]);
    rows[hit[0] - 2] = [key, text, stamp, source];
  } else {
    sh.appendRow([sheetText_(key), sheetText_(text), sheetText_(stamp), sheetText_(source)]);
    rows.push([key, text, stamp, source]);
  }
  return rows;
}

/**
 * Writes (or, with empty text, deletes) the caller's private note on one VVD in their file, creating the file on
 * the first save that has text, then (writePrivFile_) searches once more and repeats the write in the oldest tagged
 * file if that is not the one written to. The caller holds the user lock. Updates the user cache from what was
 * written. Throws on an error.
 */
function writePrivateNote_(key, text, source) {
  try {
    var st = privState_(true);
    if (!st.id && text === '') return; // nothing to delete: no file is made for it
    var stamp = new Date().toISOString(); // one stamp, so a row repeated in the oldest file is identical
    var res = writePrivFile_(st.id, function (sh, rows) {
      return writePrivRow_(sh, rows, key, text, stamp, source);
    });
    // The writes were flushed before the modifiedTime is read, so it is the one a later check will see.
    var mt = privModifiedTime_(res.id) || ''; // '' = re-read on the next check
    privPut_({ id: res.id, modifiedTime: mt, notes: privNotesFrom_(res.rows) });
  } catch (err) {
    privForget_();
    throw err;
  }
}

/**
 * Public notes (cache first, then the Sheet). Null when the team Sheet is not set up. Throws on a Sheet error.
 * `teamSheetId` is the already-read TEAM_SHEET_ID_KEY_ value (see openTeamSheet_).
 */
function publicNotes_(teamSheetId) {
  var notes = cachedNotes_();
  if (notes) return notes;
  // Recorded BEFORE the Sheet read: see cacheNotesIfCurrent_.
  var genBefore = notesGeneration_();
  var ss = openTeamSheet_(teamSheetId);
  if (!ss) return null;
  notes = readNotesFromSheet_(ss);
  cacheNotesIfCurrent_(notes, genBefore);
  return notes;
}

/**
 * The reply getVvdNotes and saveVvdNote send: the public list (tagged visibility:'public') plus,
 * when available AND `includePrivate`, the caller's own private notes. Private notes are added
 * here, per call, and never go into the script cache, which every visitor shares (they use the
 * per-person user cache). `checkPrivate` makes the private part compare the file's modifiedTime
 * first (an explicit read); a save's reply passes false and uses the state the save just cached.
 *
 * `includePrivate` is true only for callers that understand visibility (pages built 2026-10-01 or
 * later). A tab opened before the deploy keeps running the OLD page against this server; that page
 * treats any note by its viewer as "my note", so a private note handed to it could be edited there
 * and saved back -- as public, since it sends no visibility. So it never receives one.
 */
function notesReply_(me, publicList, includePrivate, checkPrivate) {
  var notes = [];
  for (var i = 0; i < publicList.length; i++) {
    var n = publicList[i];
    notes.push({ vvd: n.vvd, note: n.note, author: n.author, updatedAt: n.updatedAt, source: noteSource_(n.source), visibility: 'public' });
  }
  var privateAvailable = false;
  if (!includePrivate) return { ok: true, me: me, notes: notes, privateAvailable: false };
  try {
    var store = privateNotesStore_();
    if (store) {
      notes = notes.concat(readPrivateNotes_(store, me, checkPrivate === true));
      privateAvailable = true;
    }
  } catch (err) {
    privateAvailable = false; // the private store (user properties, Drive or the file) is unavailable: public notes still load
  }
  return { ok: true, me: me, notes: notes, privateAvailable: privateAvailable };
}

/**
 * Public. { ok, me, privateAvailable, notes:[{vvd, note, author, updatedAt, source, visibility}] } or
 * { ok:false, reason:'not-configured'|'error', error? }. visibility is 'public' or 'private'; source is
 * 'BFR' or 'VPT' (the app the note was last written from). A page built before `source` existed ignores it.
 * The caller's private notes are included only when it passes { privateNotes: true } -- see
 * notesReply_ for why a page that doesn't ask must never get them.
 */
function getVvdNotes(opts) {
  return notesForCaller_(opts, null);
}

/**
 * Public. getVvdNotes for only the VVDs in `vvds` (an array of at most VVD_NOTES_FOR_MAX_), so an app that
 * shows a few vessels does not pull every note. Same reply, same `opts`, and the same cached list: this saves
 * reply size, not Sheet reads. VVDs are trimmed and uppercased like saveVvdNote's; an entry that is not a valid
 * VVD (VVD_RE_) cannot have a note, so it is skipped and named in `invalid` (present only when something was
 * skipped) instead of failing the whole view. A non-array is 'invalid-vvds'; a longer list is 'too-many-vvds'.
 * Takes no email or user: the caller is always the account the script identifies, as in getVvdNotes.
 */
function getVvdNotesFor(vvds, opts) {
  if (!Array.isArray(vvds)) return { ok: false, reason: 'invalid-vvds' };
  if (vvds.length > VVD_NOTES_FOR_MAX_) return { ok: false, reason: 'too-many-vvds' };
  var wanted = {};
  var invalid = [];
  for (var i = 0; i < vvds.length; i++) {
    var v = vvds[i];
    var key = (typeof v === 'string' || typeof v === 'number') ? String(v).trim().toUpperCase() : '';
    if (VVD_RE_.test(key)) wanted[key] = true;
    else invalid.push(describeInvalidVvd_(v));
  }
  var reply = notesForCaller_(opts, wanted);
  if (reply.ok && invalid.length) reply.invalid = invalid;
  return reply;
}

/**
 * How a rejected getVvdNotesFor entry is named in `invalid`: the text itself for a string or number, else its type.
 * Never converts an object to text (a caller's own toString could throw), so it cannot make the call throw.
 */
function describeInvalidVvd_(v) {
  if (typeof v === 'string' || typeof v === 'number') return String(v).slice(0, 40);
  return v === null ? 'null' : typeof v === 'object' ? (Array.isArray(v) ? 'array' : 'object') : typeof v;
}

/** getVvdNotes' body. `wanted` (an object keyed by VVD) limits the reply to those VVDs; null means all of them. */
function notesForCaller_(opts, wanted) {
  var includePrivate = !!(opts && typeof opts === 'object' && opts.privateNotes === true);
  try {
    // Cache before the Sheet: opening a spreadsheet costs far more than the read, and this is
    // called on every page load, every notes poll and every panel open.
    var teamSheetId = PropertiesService.getScriptProperties().getProperty(TEAM_SHEET_ID_KEY_);
    if (!teamSheetId) return { ok: false, reason: 'not-configured' };
    var notes = publicNotes_(teamSheetId);
    if (!notes) return { ok: false, reason: 'not-configured' };
    var reply = notesReply_(normalizedEmail_(), notes, includePrivate, true);
    if (wanted) {
      reply.notes = reply.notes.filter(function (n) { return Object.prototype.hasOwnProperty.call(wanted, n.vvd); });
    }
    return reply;
  } catch (err) {
    return { ok: false, reason: 'error', error: errorText_(err) };
  }
}

/**
 * Saves, updates or (empty text) deletes the caller's PRIVATE note on one VVD, in their own private-notes file.
 * Holds the person's user lock (tryLock(PRIV_LOCK_MS_); 'busy' when not free, like a public save) around the whole of
 * find, create, write and search-again, and takes it ONCE: the old-notes move inside it is told the lock is held.
 */
function savePrivateVvdNote_(key, text, me, source) {
  var teamSheetId;
  var lock = null;
  try {
    teamSheetId = PropertiesService.getScriptProperties().getProperty(TEAM_SHEET_ID_KEY_);
    if (!teamSheetId) return { ok: false, reason: 'not-configured' };
    var store = privateNotesStore_();
    if (!store) return { ok: false, reason: 'private-unavailable' };
    lock = privLock_();
    if (!lock) return { ok: false, reason: 'busy' };
    migratePrivateNotes_(store, true);
    writePrivateNote_(key, text, source);
  } catch (err) {
    return { ok: false, reason: 'error', error: errorText_(err) };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (err2) { /* released when the execution ends */ } }
  }
  // The note is saved. If the public list can't be read now, still report the save as done (with
  // no list, so the page keeps what it shows and re-reads) rather than "not saved".
  try {
    var pub = publicNotes_(teamSheetId);
    if (pub) return notesReply_(me, pub, true, false);
  } catch (err) { /* fall through */ }
  return { ok: true, me: me, notes: null, privateAvailable: true };
}

/**
 * Public. Saves, updates or (empty note) deletes the CALLER's note for one
 * VVD. Only the caller's own note is ever touched: a public save only edits a
 * row whose VVD and author both match, and a private save only the caller's
 * own private-notes file, so this cannot change or delete anyone else's note.
 *
 * `visibility` is 'public' (the team Sheet) or 'private' (the caller's own
 * private-notes file, see the block above). Omitted means 'public', which is what pages loaded before
 * 2026-10-01 send (they call saveVvdNote(vvd, note)). A visitor can have one
 * public AND one private note on the same VVD; each is saved separately.
 *
 * `source` is the app writing the note, 'BFR' or 'VPT' (anything else is 'invalid-source'); omitted means
 * 'BFR', which is what every page built before it existed sends. It labels the note ("from VPT") and
 * nothing else: it changes no permission, and an edit sets it to the app that made the edit, like Updated At.
 */
function saveVvdNote(vvd, note, visibility, source) {
  if (typeof vvd !== 'string' && typeof vvd !== 'number') return { ok: false, reason: 'invalid-vvd' };
  var key = String(vvd).trim().toUpperCase();
  if (!VVD_RE_.test(key)) return { ok: false, reason: 'invalid-vvd' };
  if (typeof note !== 'string') return { ok: false, reason: 'invalid-note' };
  var text = note.trim();
  if (text.length > VVD_NOTE_MAX_CHARS_) return { ok: false, reason: 'invalid-note' };
  // A caller that names a visibility understands private notes and gets its own back in the reply.
  var includePrivate = visibility !== undefined && visibility !== null;
  if (!includePrivate) visibility = 'public';
  if (visibility !== 'public' && visibility !== 'private') return { ok: false, reason: 'invalid-visibility' };
  if (source === undefined || source === null) source = DEFAULT_NOTE_SOURCE_;
  if (NOTE_SOURCES_.indexOf(source) === -1) return { ok: false, reason: 'invalid-source' };

  var me = normalizedEmail_();
  if (!me) return { ok: false, reason: 'no-user-identity' };
  if (visibility === 'private') return savePrivateVvdNote_(key, text, me, source);

  try {
    var ss = openTeamSheet_();
    if (!ss) return { ok: false, reason: 'not-configured' };
    var sheet = ss.getSheetByName(VVD_NOTES_TAB_);
    if (!sheet) return { ok: false, reason: 'error', error: 'The "' + VVD_NOTES_TAB_ + '" tab is missing from the team-data Sheet.' };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { ok: false, reason: 'busy' };
    try {
      // A tab whose spare columns were deleted has no room for Source: add them before writing it.
      var spare = VVD_NOTES_HEADER_.length - sheet.getMaxColumns();
      if (spare > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), spare);
      var rows = readNotesRows_(sheet);
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
        sheet.getRange(mine[0], 4, 1, 2).setValues([[sheetText_(stamp), sheetText_(source)]]);
        rows[mine[0] - 2] = [rows[mine[0] - 2][0], text, rows[mine[0] - 2][2], stamp, source];
      } else {
        sheet.appendRow([sheetText_(key), sheetText_(text), sheetText_(me), sheetText_(stamp), sheetText_(source)]);
        rows.push([key, text, me, stamp, source]);
      }
      // Apply the writes before the generation bump and before the lock is released: Sheets buffers
      // writes until the script ends or flushes, so without this the next lock holder (or a reader
      // told by the bump that a newer list exists) could still read the Sheet without this change.
      SpreadsheetApp.flush();
      var notes = notesFromRows_(rows);
      publishNotes_(notes);
      return notesReply_(me, notes, includePrivate, false);
    } catch (err) {
      // Part of the change may already be written: apply it, and drop the cached list so nobody is
      // served one that disagrees with the Sheet.
      try { SpreadsheetApp.flush(); } catch (e) { /* reported through err below */ }
      invalidateNotesCache_();
      throw err;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, reason: 'error', error: errorText_(err) };
  }
}

/* ---------- decision store (D84 slice 2a-3, ADR-R1, 2026-10-31) ----------
 *
 * Decisions ("monitor, not freeze, because ...") and threshold proposals, in two APPEND-ONLY tabs of the team Sheet:
 * `Decisions` and `ThresholdLog`, columns id | vvd | polKey | kind | payload | author | createdAt | supersedes (the payload
 * is JSON text). This code only ever appends a row: it never updates or deletes one. A correction is a new row whose
 * supersedes names the row it replaces. The record shape, its validation, "latest per key" and the threshold log are
 * BFShared functions (shared/65_decisions.js, generated into Shared.gs), so the app and any VPT reader use the same rules.
 *
 *   saveDecision(vvd, polKey, payload)  payload { action: freeze|monitor|cut|roll, reason, rollTo?, seen?, supersedes? }
 *   getDecisionsFor(vvds)               at most DECISIONS_FOR_MAX_ VVDs
 *   saveThresholdChange(change)         change { vvd, polKey, field: overall|loading, from, to, reason, status, supersedes? }
 *   getThresholdLog(sinceIso)           sinceIso optional
 *   setupDecisionTabs()                 admin, from the editor: creates the two tabs up front
 *
 * The server sets id (a UUID), author (the session's email, never a client value) and createdAt (the server clock). A save
 * holds the script lock (tryLock 10 s, else 'busy') around the supersedes check and the append. The tabs are created by
 * the first save if they are missing (as the Startup Errors tab is), or up front by setupDecisionTabs; setupTeamSheets is
 * unchanged. A read with no tab yet answers an empty list.
 *
 * A supersedes is a compare-and-swap (B7 review, 2026-10-31): it must name a row of the same key that nothing supersedes
 * yet. When another save got there first the reply is { ok: false, reason: 'stale-supersedes', latestId } (latestId: the
 * key's current latest, BFShared.latestDecisionPerKey), so the client can re-read and decide again; two corrections of one
 * row never fork the chain through this code. A threshold approval or rejection must carry the field, from and to of the
 * record it supersedes ('changed-value' otherwise): an approver decides a value, never changes it (a new value is a new
 * 'proposed' record).
 *
 * Replies are { ok: true, ... } or { ok: false, reason: CODE } where CODE is a fixed string: the shared normaliser's codes
 * (invalid-vvd, invalid-action, reason-too-long, ...) or one of not-configured, no-user-identity, busy, invalid-payload,
 * payload-too-large, unknown-supersedes, supersedes-other-key, stale-supersedes (with latestId), changed-value,
 * needs-supersedes, invalid-vvds, too-many-vvds, invalid-since, error. Exception text never reaches the client (it can name
 * a Sheet); it goes to the execution log. getDecisionsFor reads only 'decision' records and getThresholdLog only
 * 'threshold' records, whatever a hand edit put in their tab.
 */
var DECISIONS_TAB_ = 'Decisions';
var THRESHOLD_LOG_TAB_ = 'ThresholdLog';
var DECISION_HEADER_ = ['id', 'vvd', 'polKey', 'kind', 'payload', 'author', 'createdAt', 'supersedes'];
/** getDecisionsFor refuses a longer list (the same cap as getVvdNotesFor). */
var DECISIONS_FOR_MAX_ = 200;
/** The JSON size of a client's payload / change argument before it is validated (the stored payload has its own, smaller cap). */
var DECISION_ARG_MAX_CHARS_ = 8000;
var DECISION_LOCK_MS_ = 10000;

/** A plain object argument, not null, an array or a primitive. */
function isPlainArg_(x) {
  return Object.prototype.toString.call(x) === '[object Object]';
}

/** The argument's JSON length, or -1 when it cannot be serialised. */
function argJsonLength_(x) {
  try { return JSON.stringify(x).length; } catch (err) { return -1; }
}

/** The tab's data rows as display strings (8 columns), [] when there are none. */
function readDecisionRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var width = Math.min(DECISION_HEADER_.length, sheet.getMaxColumns());
  return sheet.getRange(2, 1, last - 1, width).getDisplayValues();
}

/** { records, skipped }: the rows that are valid records (BFShared.decisionRecordFromRow); the rest are counted, not thrown on. */
function decisionRecordsFrom_(rows) {
  var records = [];
  var skipped = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = BFShared.decisionRecordFromRow(rows[i]);
    if (r.ok) records.push(r.record);
    else skipped++;
  }
  return { records: records, skipped: skipped };
}

/** The tab's records, or { records: [], skipped: 0 } when the tab does not exist yet. Throws on a Sheet error. */
function readDecisionTab_(ss, tab) {
  var sheet = ss.getSheetByName(tab);
  if (!sheet) return { records: [], skipped: 0 };
  return decisionRecordsFrom_(readDecisionRows_(sheet));
}

/** True when a threshold status change does not carry the field, from and to of the record it supersedes. */
function changedValue_(record, target) {
  if (record.kind !== 'threshold' || record.payload.status === 'proposed') return false;
  var a = record.payload;
  var b = target.payload;
  var same = function (x, y) { return (x === null || y === null) ? x === y : Math.abs(x - y) <= 1e-9; };
  return a.field !== b.field || !same(a.from, b.from) || !same(a.to, b.to);
}

/** The id of the current latest record of `record`'s key among `existing`, or '' when the key has none. */
function latestIdFor_(existing, record) {
  var latest = BFShared.latestDecisionPerKey(existing);
  for (var i = 0; i < latest.length; i++) {
    var r = latest[i];
    if (r.vvd === record.vvd && r.polKey === record.polKey && r.kind === record.kind) return r.id;
  }
  return '';
}

function decisionFailure_(where, err) {
  console.error('[decisions] ' + where + ': ' + errorText_(err));
  return { ok: false, reason: 'error' };
}

/**
 * The shared save path. `raw` is the record without id, author and createdAt. Validates through the shared normaliser,
 * then, under the script lock: checks that a supersedes names an existing record of the same key in the same tab, and
 * appends one row. `needsSupersedes` (a status change of a threshold) refuses a record with no supersedes.
 */
function appendDecisionRecord_(tab, raw, needsSupersedes) {
  var me = normalizedEmail_();
  if (!me) return { ok: false, reason: 'no-user-identity' };
  var n = BFShared.normalizeDecisionRecord({
    id: raw.id || Utilities.getUuid(), vvd: raw.vvd, polKey: raw.polKey, kind: raw.kind, payload: raw.payload,
    author: me, createdAt: new Date().toISOString(), supersedes: raw.supersedes
  });
  if (!n.ok) return { ok: false, reason: n.error };
  var record = n.record;
  if (needsSupersedes && record.supersedes === '') return { ok: false, reason: 'needs-supersedes' };
  var ss;
  try {
    ss = openTeamSheet_();
  } catch (err) {
    return decisionFailure_('open', err);
  }
  if (!ss) return { ok: false, reason: 'not-configured' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(DECISION_LOCK_MS_)) return { ok: false, reason: 'busy' };
  try {
    var sheet = ensureTab_(ss, tab, DECISION_HEADER_);
    if (record.supersedes !== '') {
      var existing = decisionRecordsFrom_(readDecisionRows_(sheet)).records;
      var target = null;
      var successor = false;
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].id === record.supersedes && !target) target = existing[i];
        if (existing[i].supersedes === record.supersedes) successor = true;
      }
      if (!target) return { ok: false, reason: 'unknown-supersedes' };
      if (target.vvd !== record.vvd || target.polKey !== record.polKey || target.kind !== record.kind) {
        return { ok: false, reason: 'supersedes-other-key' };
      }
      if (successor) return { ok: false, reason: 'stale-supersedes', latestId: latestIdFor_(existing, record) };
      if (changedValue_(record, target)) return { ok: false, reason: 'changed-value' };
    }
    var row = BFShared.decisionRecordToRow(record).row;
    sheet.appendRow(row.map(sheetText_));
    SpreadsheetApp.flush();
    return { ok: true, record: record };
  } catch (err) {
    return decisionFailure_('append to ' + tab, err);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Public. Appends the caller's decision on one sailing ('' polKey) or sailing-port. `payload` is
 * { action, reason, rollTo?, seen?, supersedes? }: supersedes is the id of the decision this one corrects (same vvd, polKey);
 * rollTo (a real VVD) and seen (the figures the person was looking at) are optional, added by slice 2b-2 (the decision card),
 * and kept by BFShared.normalizeDecisionRecord's rules (shared/65_decisions.js); an invalid one is invalid-roll-to /
 * invalid-seen. Replies
 * { ok: true, record } (the stored record) or { ok: false, reason }.
 */
function saveDecision(vvd, polKey, payload) {
  if (!isPlainArg_(payload)) return { ok: false, reason: 'invalid-payload' };
  var size = argJsonLength_(payload);
  if (size < 0) return { ok: false, reason: 'invalid-payload' };
  if (size > DECISION_ARG_MAX_CHARS_) return { ok: false, reason: 'payload-too-large' };
  try {
    return appendDecisionRecord_(DECISIONS_TAB_, {
      vvd: vvd, polKey: polKey, kind: 'decision',
      payload: { action: payload.action, reason: payload.reason, rollTo: payload.rollTo, seen: payload.seen }, supersedes: payload.supersedes
    }, false);
  } catch (err) {
    return decisionFailure_('saveDecision', err);
  }
}

/**
 * Public. The decisions of up to DECISIONS_FOR_MAX_ VVDs: { ok, records, latest, skipped, invalid? }. records are every valid
 * row of those VVDs plus any row (of another VVD) that supersedes one of them; latest is BFShared.latestDecisionPerKey of
 * those, limited to the asked VVDs; skipped counts the rows of the whole tab that are not valid records. VVDs are checked
 * like getVvdNotesFor's (an invalid entry is skipped and named in `invalid`).
 */
function getDecisionsFor(vvds) {
  if (!Array.isArray(vvds)) return { ok: false, reason: 'invalid-vvds' };
  if (vvds.length > DECISIONS_FOR_MAX_) return { ok: false, reason: 'too-many-vvds' };
  var wanted = {};
  var invalid = [];
  for (var i = 0; i < vvds.length; i++) {
    var v = vvds[i];
    var key = (typeof v === 'string' || typeof v === 'number') ? String(v).trim().toUpperCase() : '';
    if (VVD_RE_.test(key)) wanted[key] = true;
    else invalid.push(describeInvalidVvd_(v));
  }
  try {
    var ss = openTeamSheet_();
    if (!ss) return { ok: false, reason: 'not-configured' };
    var all = readDecisionTab_(ss, DECISIONS_TAB_);
    var ids = {};
    var records = [];
    var own = function (map, k) { return Object.prototype.hasOwnProperty.call(map, k); };
    var mine = all.records.filter(function (r) { return r.kind === 'decision'; });
    mine.forEach(function (r) {
      if (own(wanted, r.vvd)) { ids['#' + r.id] = true; records.push(r); }
    });
    mine.forEach(function (r) {
      if (!own(wanted, r.vvd) && r.supersedes !== '' && own(ids, '#' + r.supersedes)) records.push(r);
    });
    var latest = BFShared.latestDecisionPerKey(records).filter(function (r) { return Object.prototype.hasOwnProperty.call(wanted, r.vvd); });
    var reply = { ok: true, records: records, latest: latest, skipped: all.skipped };
    if (invalid.length) reply.invalid = invalid;
    return reply;
  } catch (err) {
    return decisionFailure_('getDecisionsFor', err);
  }
}

/**
 * Public. Appends a threshold proposal or a status change. `change` is { vvd, polKey, field, from, to, reason, status,
 * supersedes? }. 'proposed' starts a proposal; 'approved' and 'rejected' must name (supersedes) an earlier record of the
 * same proposal's key ('needs-supersedes' otherwise). The log records what was agreed in this app; it never writes to the
 * MCT. WHO may approve is not checked HERE (unchanged since slice 2a-3): an approval or rejection saved through this function
 * carries no `check`, so BFShared.thresholdProposals shows it as 'unchecked', never as approved. The app decides through
 * decideThresholdProposal (slice 2b-3, below), which enforces Q3 and records the check.
 */
function saveThresholdChange(change) {
  if (!isPlainArg_(change)) return { ok: false, reason: 'invalid-payload' };
  var size = argJsonLength_(change);
  if (size < 0) return { ok: false, reason: 'invalid-payload' };
  if (size > DECISION_ARG_MAX_CHARS_) return { ok: false, reason: 'payload-too-large' };
  try {
    var status = typeof change.status === 'string' ? change.status.trim().toLowerCase() : '';
    return appendDecisionRecord_(THRESHOLD_LOG_TAB_, {
      vvd: change.vvd, polKey: change.polKey, kind: 'threshold',
      payload: { field: change.field, from: change.from, to: change.to, reason: change.reason, status: change.status },
      supersedes: change.supersedes
    }, status === 'approved' || status === 'rejected');
  } catch (err) {
    return decisionFailure_('saveThresholdChange', err);
  }
}

/**
 * Public. The threshold log: { ok, log, skipped }, log = BFShared.thresholdLog(records, null, sinceIso) (one entry per
 * proposal with its latest status; liveInFeed is null here because the server has no feed rows: the app computes it with
 * BFShared.thresholdLiveInFeed(entry.to, the feed's current value)). sinceIso, when given, must be an ISO time
 * ('invalid-since' otherwise) and keeps the proposals updated at or after it.
 * Its status is the RAW latest status: an 'approved' here is UNCHECKED (saveThresholdChange lets anyone save one, and the Sheet
 * can be edited by hand). To show who decided, call getThresholdProposals (slice 2b-3) instead: it verifies each check's
 * signature and its state says 'unchecked' for anything not verified.
 */
function getThresholdLog(sinceIso) {
  var since = null;
  if (sinceIso !== undefined && sinceIso !== null && sinceIso !== '') {
    since = BFShared.decisionTime(sinceIso);
    if (since === null) return { ok: false, reason: 'invalid-since' };
  }
  try {
    var ss = openTeamSheet_();
    if (!ss) return { ok: false, reason: 'not-configured' };
    var all = readDecisionTab_(ss, THRESHOLD_LOG_TAB_);
    var mine = all.records.filter(function (r) { return r.kind === 'threshold'; });
    return { ok: true, log: BFShared.thresholdLog(mine, null, since), skipped: all.skipped };
  } catch (err) {
    return decisionFailure_('getThresholdLog', err);
  }
}

/* ---------- threshold proposals: who may decide (D84 slice 2b-3, R-5, Q3; 2026-10-31) ----------
 *
 * Q3 (DECIDED 2026-10-30, "Config Sheet map (Recommended)"): the lane's SPC lead plus Kevin approve threshold changes. The
 * approver map is the Config Sheet's "Threshold Approvers" tab: Lane | Approver Email | Notes, one row per lane and person (a
 * lane may have several). Kevin is the project's admin, recognised by the existing admin check (Code.gs assertArchiveAdmin_,
 * called with allowClaim false, so it never makes anyone admin). The rule itself is BFShared.thresholdApprovalCheck
 * (shared/67_threshold_proposals.js), so the app can show the same answer before it asks.
 *
 *   decideThresholdProposal(decision)   decision { id, status: approved|rejected, reason }: appends the decision on record id
 *   getThresholdApproverRights()        { ok, email, admin, configured, lanes }: may the caller decide, and for which lanes
 *   getThresholdProposals(sinceIso)     { ok, proposals, records, skipped }: BFShared.thresholdProposals with check and state
 *   setupThresholdApprovers()           admin, from the editor: creates the empty approver tab in the Config Sheet
 *
 * The sailing's lane comes from the live feed this server already caches (DataFeeds.gs: 'Vessel 1st Lane' of the rows whose
 * 'Vessel 1st VVD' is the proposal's VVD), never from the client. A VVD with no row, or rows naming two lanes, has no lane
 * ('lane-unknown'); only the admin can then decide. The map is read on every call, uncached, so removing a row takes effect
 * at once. No approver tab (or no Config Sheet) is 'approvers-not-configured' for everyone, the admin included: approvals fail
 * closed until the tab exists. An empty tab lets the admin decide and no one else.
 *
 * Records only (rule 8): a decision is one more append-only ThresholdLog row (appendDecisionRecord_, the lock and the
 * compare-and-swap of slice 2a-3). It copies field, from and to from the record it decides, so an approver never changes a
 * value, and it carries check { as: 'lead'|'admin', lane } (server-set). Nothing writes to the MCT, a table or a live threshold.
 *
 * Fixed codes, never exception text: invalid-payload, payload-too-large, no-user-identity, invalid-status, invalid-supersedes,
 * not-configured, unknown-supersedes, approvers-not-configured, proposal-rejected, own-proposal, lane-unknown, not-approver,
 * invalid-since, error,
 * plus what appendDecisionRecord_ answers (busy, stale-supersedes with latestId, the normaliser's codes such as invalid-reason).
 */
var THRESHOLD_APPROVERS_TAB_ = 'Threshold Approvers';
var THRESHOLD_APPROVERS_HEADER_ = ['Lane', 'Approver Email', 'Notes'];
var FEED_VVD_COLUMN_ = 'Vessel 1st VVD';
var FEED_LANE_COLUMN_ = 'Vessel 1st Lane';

/**
 * The approver map: { configured: false } when no Config Sheet is set up or it has no approver tab, else { configured: true,
 * approvers } (BFShared.parseThresholdApprovers of the rows below the header). Throws on a Sheet error.
 */
function readThresholdApprovers_() {
  var configId = PropertiesService.getScriptProperties().getProperty(CONFIG_SHEET_ID_KEY_);
  if (!configId) return { configured: false };
  var sheet = SpreadsheetApp.openById(configId).getSheetByName(THRESHOLD_APPROVERS_TAB_);
  if (!sheet) return { configured: false };
  var last = sheet.getLastRow();
  var rows = last >= 2 ? sheet.getRange(2, 1, last - 1, 2).getDisplayValues() : [];
  return { configured: true, approvers: BFShared.parseThresholdApprovers(rows).approvers };
}

/** True when `me` (lower-cased) is the project's admin by the existing check (assertArchiveAdmin_(false); never claims). */
function isThresholdAdmin_(me) {
  try {
    return String(assertArchiveAdmin_(false)).toLowerCase() === me;
  } catch (err) {
    return false;
  }
}

/** The live feed's CSV text from this server's cache (any age: a sailing's lane does not change), else a download; null. */
function liveFeedText_() {
  try {
    var meta = readFeedMeta_('live');
    var b64 = meta ? readFeedChunks_('live', meta) : null;
    if (b64 !== null) return gunzipBase64_(b64);
    var got = downloadFeedOrWait_('live');
    if (!got || !got.ok) return null;
    return typeof got.text === 'string' ? got.text : gunzipBase64_(got.b64);
  } catch (err) {
    console.error('[decisions] live feed for the lane: ' + errorText_(err));
    return null;
  }
}

/** Pure: the distinct non-blank lanes of `vvd` in parsed CSV records (header first), sorted. [] when a column is missing. */
function vvdLanesFromCsv_(records, vvd) {
  if (!records || !records.length) return [];
  var header = records[0].map(function (h) { return String(h).replace(/^﻿/, '').trim(); });
  var vi = header.indexOf(FEED_VVD_COLUMN_);
  var li = header.indexOf(FEED_LANE_COLUMN_);
  if (vi === -1 || li === -1) return [];
  var seen = {};
  var lanes = [];
  for (var i = 1; i < records.length; i++) {
    var rec = records[i];
    if (BFShared.normalizeVvd(String(rec[vi] === undefined ? '' : rec[vi])) !== vvd) continue;
    var lane = String(rec[li] === undefined ? '' : rec[li]).trim().toUpperCase();
    if (lane && !Object.prototype.hasOwnProperty.call(seen, '#' + lane)) { seen['#' + lane] = true; lanes.push(lane); }
  }
  return lanes.sort();
}

/** The sailing's one lane from the live feed, or '' when it is not known (no feed, no row, or two lanes). */
function thresholdLaneOf_(vvd) {
  var text = liveFeedText_();
  if (text === null) return '';
  var lanes = vvdLanesFromCsv_(parseCsvRecords_(text), vvd);
  return lanes.length === 1 ? lanes[0] : '';
}

/*
 * Signed checks (security review of 2b-3, 2026-10-31). Org members can edit the ThresholdLog tab by hand, so a `check` typed into
 * a row must not count. decideThresholdProposal signs each check with HMAC-SHA256 under a secret kept in the Script Property
 * THRESHOLD_CHECK_KEY_PROP_ (created on first use, under the script lock; never returned to a client, never logged), over
 * id, vvd, polKey, author, supersedes, field, from, to, status and the check's as and lane. getThresholdProposals (and
 * decideThresholdProposal, before it reads a target) keeps a check only when its sig matches; anything else, and every check
 * while no key exists, reads as unchecked (fail closed). A hand edit can still delete or reorder rows; it cannot fake an approval.
 */
var THRESHOLD_CHECK_KEY_PROP_ = 'bfrThresholdCheckKey';

/** The signing key, or null. `create`: make one (under the script lock) when there is none; null when the lock is busy. */
function thresholdCheckKey_(create) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(THRESHOLD_CHECK_KEY_PROP_);
  if (key || !create) return key || null;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(DECISION_LOCK_MS_)) return null;
  try {
    key = props.getProperty(THRESHOLD_CHECK_KEY_PROP_);
    if (!key) {
      key = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty(THRESHOLD_CHECK_KEY_PROP_, key);
    }
    return key;
  } finally {
    lock.releaseLock();
  }
}

/** Lower-case hex HMAC-SHA256 of a record's signed fields (r: { id, vvd, polKey, author, supersedes, payload }). */
function thresholdCheckSig_(key, r) {
  var p = r.payload;
  var msg = JSON.stringify(['bfr-threshold-check-v1', r.id, r.vvd, r.polKey, r.author, r.supersedes,
    p.field, p.from, p.to, p.status, p.check.as, p.check.lane]);
  return Utilities.computeHmacSha256Signature(msg, key).map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

/**
 * { records, unverified }: copies of `records` in which a check is kept (without its sig) only when its sig is this server's
 * signature of the record; every other check is removed and counted. A null key verifies nothing.
 */
function verifiedThresholdRecords_(records, key) {
  var unverified = 0;
  var out = records.map(function (r) {
    var c = JSON.parse(JSON.stringify(r));
    var check = c.payload.check;
    if (!check) return c;
    var good = false;
    if (key && typeof check.sig === 'string') {
      try { good = thresholdCheckSig_(key, c) === check.sig; } catch (err) { good = false; }
    }
    if (good) delete check.sig;
    else { delete c.payload.check; unverified++; }
    return c;
  });
  return { records: out, unverified: unverified };
}

/**
 * Public. Approves or rejects the threshold record `decision.id` (normally a proposal's latestId from getThresholdProposals)
 * as the caller, if Q3 allows it (BFShared.thresholdApprovalCheck). `decision` is { id, status: 'approved'|'rejected',
 * reason }. Replies { ok: true, record } (the stored record, payload.check set) or { ok: false, reason: CODE } (above).
 */
function decideThresholdProposal(decision) {
  if (!isPlainArg_(decision)) return { ok: false, reason: 'invalid-payload' };
  var size = argJsonLength_(decision);
  if (size < 0) return { ok: false, reason: 'invalid-payload' };
  if (size > DECISION_ARG_MAX_CHARS_) return { ok: false, reason: 'payload-too-large' };
  var me = normalizedEmail_();
  if (!me) return { ok: false, reason: 'no-user-identity' };
  var status = typeof decision.status === 'string' ? decision.status.trim().toLowerCase() : '';
  if (status !== 'approved' && status !== 'rejected') return { ok: false, reason: 'invalid-status' };
  var id = typeof decision.id === 'string' ? decision.id.trim() : '';
  if (!id) return { ok: false, reason: 'invalid-supersedes' };
  try {
    var ss = openTeamSheet_();
    if (!ss) return { ok: false, reason: 'not-configured' };
    var raw = readDecisionTab_(ss, THRESHOLD_LOG_TAB_).records.filter(function (r) { return r.kind === 'threshold'; });
    // Only checks this server signed count (a forged or tampered row reads as unchecked; no key yet means none is verified).
    var records = verifiedThresholdRecords_(raw, thresholdCheckKey_(false)).records;
    var target = null;
    for (var i = 0; i < records.length && !target; i++) if (records[i].id === id) target = records[i];
    if (!target) return { ok: false, reason: 'unknown-supersedes' };
    var map = readThresholdApprovers_();
    var admin = isThresholdAdmin_(me);
    var lane = (map.configured && !admin) ? thresholdLaneOf_(target.vvd) : '';
    var check = BFShared.thresholdApprovalCheck({
      status: status, me: me, proposer: BFShared.thresholdProposerOf(records, id), proposers: BFShared.thresholdProposersOf(records, id),
      targetRejected: target.payload.status === 'rejected' && !!target.payload.check,
      admin: admin, configured: map.configured,
      approverLanes: map.configured ? BFShared.thresholdApproverLanes(map.approvers, me) : [], lane: lane
    });
    if (!check.ok) return { ok: false, reason: check.error };
    var key = thresholdCheckKey_(true);
    if (!key) return { ok: false, reason: 'busy' };
    var p = target.payload;
    var newId = Utilities.getUuid();
    var signed = { as: check.as, lane: lane };
    signed.sig = thresholdCheckSig_(key, {
      id: newId, vvd: target.vvd, polKey: target.polKey, author: me, supersedes: target.id,
      payload: { field: p.field, from: p.from, to: p.to, status: status, check: signed }
    });
    // Under the lock, appendDecisionRecord_ re-reads the tab: the target must still be the key's latest (stale-supersedes).
    var reply = appendDecisionRecord_(THRESHOLD_LOG_TAB_, {
      id: newId, vvd: target.vvd, polKey: target.polKey, kind: 'threshold',
      payload: { field: p.field, from: p.from, to: p.to, reason: decision.reason, status: status, check: signed },
      supersedes: target.id
    }, true);
    if (reply.ok && reply.record.payload.check) delete reply.record.payload.check.sig;
    return reply;
  } catch (err) {
    return decisionFailure_('decideThresholdProposal', err);
  }
}

/**
 * Public. What the caller may decide: { ok: true, email, admin, configured, lanes } (lanes: the caller's own rows of the
 * approver tab, sorted; [] when not configured). Pass a row's lane and a proposal to BFShared.thresholdApprovalCheck to know
 * whether the app should offer Approve / Reject. Never lists anyone else's address. { ok: false, reason } is
 * no-user-identity or error.
 */
function getThresholdApproverRights() {
  var me = normalizedEmail_();
  if (!me) return { ok: false, reason: 'no-user-identity' };
  try {
    var map = readThresholdApprovers_();
    return {
      ok: true, email: me, admin: isThresholdAdmin_(me), configured: map.configured,
      lanes: map.configured ? BFShared.thresholdApproverLanes(map.approvers, me) : []
    };
  } catch (err) {
    return decisionFailure_('getThresholdApproverRights', err);
  }
}

/**
 * Public. The threshold proposals: { ok, proposals, records, skipped }. proposals = BFShared.thresholdProposals(records, null,
 * sinceIso) (thresholdLog's entries plus check, valueBy and state; current and liveInFeed null, as getThresholdLog's);
 * records are the tab's valid threshold records, so the app can call BFShared.thresholdProposals(records, its current rows)
 * to get liveInFeed and the 'live' state. sinceIso as getThresholdLog's ('invalid-since').
 * Every check is VERIFIED here first (security review, 2026-10-31): a record whose check's signature does not match (a row
 * forged or edited by hand in the Sheet, or any check while no key exists yet) is returned without its check, so it reads as
 * 'unchecked'. No sig is ever returned. checksVerified: true says the checks left in this reply were verified by the server;
 * unverified counts the checks removed.
 */
function getThresholdProposals(sinceIso) {
  var since = null;
  if (sinceIso !== undefined && sinceIso !== null && sinceIso !== '') {
    since = BFShared.decisionTime(sinceIso);
    if (since === null) return { ok: false, reason: 'invalid-since' };
  }
  try {
    var ss = openTeamSheet_();
    if (!ss) return { ok: false, reason: 'not-configured' };
    var all = readDecisionTab_(ss, THRESHOLD_LOG_TAB_);
    var mine = all.records.filter(function (r) { return r.kind === 'threshold'; });
    var v = verifiedThresholdRecords_(mine, thresholdCheckKey_(false));
    return {
      ok: true, proposals: BFShared.thresholdProposals(v.records, null, since), records: v.records, skipped: all.skipped,
      checksVerified: true, unverified: v.unverified
    };
  } catch (err) {
    return decisionFailure_('getThresholdProposals', err);
  }
}

/**
 * Admin only (assertArchiveAdmin_, never claims the role). Run once from the editor: creates the Config Sheet's empty
 * "Threshold Approvers" tab with its header if it is missing; never touches an existing tab. Until it exists every approval
 * fails closed; once it exists (even empty) the admin may decide, and each lead once their row is added.
 */
function setupThresholdApprovers() {
  assertArchiveAdmin_(false);
  var configId = PropertiesService.getScriptProperties().getProperty(CONFIG_SHEET_ID_KEY_);
  if (!configId) throw new Error('Run setupTeamSheets first: the config Sheet is not set up.');
  var ss = SpreadsheetApp.openById(configId);
  ensureTab_(ss, THRESHOLD_APPROVERS_TAB_, THRESHOLD_APPROVERS_HEADER_);
  return { ok: true, tab: THRESHOLD_APPROVERS_TAB_, configSheetUrl: ss.getUrl() };
}

/**
 * Admin only (assertArchiveAdmin_, never claims the role). Run once from the editor: creates the Decisions and ThresholdLog
 * tabs with their header if they are missing; never touches an existing tab. The first save would create them anyway; this
 * makes them visible (and lets an admin protect them) before anyone saves. It takes the same script lock as a save, so a
 * save that is creating a tab at the same moment cannot make a second one ({ ok: false, reason: 'busy' } when it is held).
 */
function setupDecisionTabs() {
  assertArchiveAdmin_(false);
  var ss = openTeamSheet_();
  if (!ss) throw new Error('Run setupTeamSheets first: the team-data Sheet is not set up.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(DECISION_LOCK_MS_)) return { ok: false, reason: 'busy' };
  try {
    ensureTab_(ss, DECISIONS_TAB_, DECISION_HEADER_);
    ensureTab_(ss, THRESHOLD_LOG_TAB_, DECISION_HEADER_);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, tabs: [DECISIONS_TAB_, THRESHOLD_LOG_TAB_], teamSheetUrl: ss.getUrl() };
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

/**
 * Run from the editor to try the startup-error log end to end. The editor's Run button calls a
 * function with NO arguments, so running logClientStartupError itself sends it an empty report
 * and logs a line with every field blank (only `user` filled in). This sends a realistic one
 * through the real function instead. Look for it in the Executions log as `[startup-error]`
 * with reason "manual test ...", and in the Startup Errors tab if the team Sheet is set up.
 * The returned `logged` says where it went: 'sheet', 'console' (no team Sheet, or it would not
 * open) or 'rate-limited' (more than 5 reports in 10 minutes; this counts toward that limit).
 * It writes a real row, so delete it from the tab afterwards if you do not want it kept.
 *
 * Admin-only once setup has run. This function has to be public (the editor's Run menu hides
 * underscore functions), which also makes it callable by any visitor through google.script.run;
 * without a guard a visitor could write fake 'manual test' rows and use up their own report budget.
 * So: if an admin is recorded (Script Property ARCHIVE_ADMIN_KEY_, recorded when the project owner
 * first runs a setup function), assertArchiveAdmin_(false) lets only that account through and throws the usual 'Only the
 * archive admin (...) can run this.' for anyone else, before any row or rate-limit use. The false
 * never makes the caller admin. If NO admin is recorded yet (setup not run) it is allowed: there
 * is no team Sheet before setup, so the only effect is one console line, and the owner can try the
 * startup log before running setupTeamSheets. A visitor can still call logClientStartupError
 * directly (the app itself does), so this hardens a helper; it does not close a new hole.
 */
function testStartupLog() {
  if (PropertiesService.getScriptProperties().getProperty(ARCHIVE_ADMIN_KEY_)) assertArchiveAdmin_(false);
  var result = logClientStartupError({
    reason: 'manual test from the Apps Script editor (testStartupLog); not a real failure',
    errors: ['fake error 1', 'fake error 2'],
    reactLoaded: false,
    userAgent: 'Apps Script editor',
    page: 'testStartupLog',
    at: new Date().toISOString()
  });
  console.log('testStartupLog result: ' + JSON.stringify(result));
  return result;
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
    if (APP_CONFIG_KEYS_.indexOf(key) === -1 && APP_CONFIG_LINK_KEYS_.indexOf(key) === -1) {
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

/**
 * The spreadsheet stored under `propKey`, or a new one (id stored) when NO id is stored yet.
 * A stored id that fails to open throws instead of being replaced (2026-10-06): openById also
 * fails on a transient error, and silently creating a new Sheet and repointing the property would
 * hide every public note in the old one. Replacing a Sheet is a deliberate step: delete the
 * Script Property and run setupTeamSheets again (apps-script/README.md, "Replacing a team Sheet").
 */
function getOrCreateSpreadsheet_(propKey, title) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propKey);
  if (id) {
    try {
      return { ss: SpreadsheetApp.openById(id), created: false };
    } catch (err) {
      throw new Error('The "' + title + '" spreadsheet stored in Script Property ' + propKey + ' (' + id + ') could not be opened: ' +
        errorText_(err) + '. No new spreadsheet was created and the property was not changed. If this is a temporary error, ' +
        'run setupTeamSheets again later. To replace that spreadsheet on purpose (it was deleted, or should be started over), ' +
        'delete the ' + propKey + ' Script Property (Project Settings -> Script Properties) and run setupTeamSheets again: ' +
        'it creates a new, empty one and nothing is copied from the old one.');
    }
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

/**
 * A notes tab created before the Source column has a four-column header. Adds the fifth header cell when
 * it is blank, and only then, so a re-run never overwrites anything. Notes work without it (a blank Source
 * reads as 'BFR'); this just labels the column for anyone reading the Sheet.
 */
function ensureNotesSourceHeader_(sheet) {
  var col = VVD_NOTES_HEADER_.length;
  if (sheet.getLastRow() < 1) return;
  if (sheet.getMaxColumns() < col) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
  var cell = sheet.getRange(1, col);
  if (String(cell.getDisplayValue()).trim() !== '') return;
  cell.setValue(VVD_NOTES_HEADER_[col - 1]);
  cell.setFontWeight('bold');
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
 * Admin only (same admin as the archive; with none recorded yet, only the
 * project owner may run it and become admin). Run once from the editor; safe to
 * re-run -- it creates only what is missing and never overwrites existing
 * rows. Returns the two Sheet URLs, whether each share succeeded, and whether
 * the config Sheet's onEdit trigger is in place.
 */
function setupTeamSheets() {
  assertArchiveAdmin_();

  var team = getOrCreateSpreadsheet_(TEAM_SHEET_ID_KEY_, TEAM_SHEET_NAME_);
  // Only a spreadsheet created in this run has a default "Sheet1" that is safe to rename.
  ensureNotesSourceHeader_(ensureSetupTab_(team.ss, VVD_NOTES_TAB_, VVD_NOTES_HEADER_, [], team.created ? 'Sheet1' : null));
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

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

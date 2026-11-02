#!/usr/bin/env node
/**
 * Prints the file name of the current app HTML (the repo-root file the checks validate and the
 * build compiles) to stdout, and nothing else. Python checks and CI steps call this instead of
 * carrying their own copy of the detection rule -- the rule lives only in
 * scripts/lib/app_file.js (pickCurrentAppHtml), see the comment there for why.
 *
 * Testing builds that were skipped are reported on stderr so stdout stays a single file name.
 * Exits 1, with the reason on stderr, if there is no candidate or two files tie for highest.
 *
 * Run:  node scripts/print_app_file.js
 */
'use strict';
const fs = require('fs');
const { pickCurrentAppHtml, REPO_ROOT } = require('./lib/app_file.js');

try {
    const { file, excluded } = pickCurrentAppHtml(fs.readdirSync(REPO_ROOT));
    if (excluded.length > 0) console.error(`(excluded as testing builds: ${excluded.join(', ')})`);
    console.log(file);
} catch (err) {
    console.error(err.message);
    process.exit(1);
}

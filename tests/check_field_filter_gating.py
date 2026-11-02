#!/usr/bin/env python3
"""Enforce the FIELD_TOGGLES `filters` invariant.

WHY THIS EXISTS
---------------
The Fields picker lets a user hide report columns. Hiding a column must also drop any
per-column header filter typed into it, otherwise the table stays silently filtered with
no visible control explaining why -- and because the Excel/CSV export is a
`XLSX.utils.table_to_sheet` scrape of that filtered DOM, the download quietly carries the
partial row set too. That cleanup is driven by the `filters:` array on each FIELD_TOGGLES
descriptor in the app HTML.

The trap: `headerFilters` is ONE flat map shared by the Detail and POL Booking Flash tabs.
A filter key can render behind a toggle on one tab and render UNGATED on the other. Listing
such a key for auto-clearing means any toggle flip wipes a filter the user can still see and
use on the other tab -- the exact harm the cleanup exists to prevent, inflicted on an
unrelated column.

That is not hypothetical. The list was written by scanning render sites, and still shipped
with `bsaTeu` wrongly included: Detail renders it behind `{!bsaHidden && ...}`, but POL
renders `{filterCell('bsaTeu', 'BSA TEU')}` with no guard at all, and `bsaHidden` defaults
to true -- so from first render, flipping ANY of the fifteen toggles silently cleared a POL
user's BSA TEU filter. Reading the code carefully was not enough to prevent it, which is why
it is now a check rather than a comment.

INVARIANT ENFORCED
------------------
For every key K listed in toggle T's `filters` array, EVERY `renderFilter('K', ...)` and
`filterCell('K', ...)` site in the file must be gated by T's own visibility state -- either
inline on the same line, or inside an enclosing `{!THidden && (` / `{showT && (` block.

Run: python3 tests/check_field_filter_gating.py [path/to/app.html]
Exit 0 = invariant holds. Exit 1 = a violation. Exit 2 = could not run the check at all.
"""
import os
import re
import subprocess
import sys

# Auto-detect the main app file via scripts/print_app_file.js, the single implementation of the
# rule (scripts/lib/app_file.js pickCurrentAppHtml). It exits non-zero rather than guess when
# there is no candidate or two files tie for the highest version.


def find_app_html():
    if len(sys.argv) > 1:
        return sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        res = subprocess.run(['node', os.path.join(root, 'scripts', 'print_app_file.js')],
                             capture_output=True, text=True, cwd=root)
    except FileNotFoundError:
        print('node is required to auto-detect the app file (scripts/print_app_file.js); '
              'install Node or pass the app path explicitly as the 1st argument.')
        sys.exit(2)
    if res.returncode != 0:
        print(res.stderr.strip() or 'scripts/print_app_file.js failed')
        print('Pass the app path explicitly as the 1st argument to override.')
        sys.exit(2)
    for line in res.stderr.splitlines():
        if 'excluded as testing builds' in line:
            print(line)
    chosen = res.stdout.strip()
    print('(main app file: %s)' % chosen)
    return os.path.join(root, chosen)


# A descriptor line looks like:
#   { key: 'bsa', ..., filters: ['bsaWgt'] },
DESCRIPTOR_RE = re.compile(
    r"\{\s*key:\s*'(?P<key>\w+)'.*?filters:\s*\[(?P<filters>[^\]]*)\]\s*\}")
STRING_RE = re.compile(r"'([^']+)'")

# A line that OPENS a guarded JSX block, e.g. `{!bsaHidden && (` or `{showReefer && (`
GUARD_OPEN_RE = re.compile(r'^\s*\{\s*(?P<tok>!?\w+)\s*&&\s*\(\s*$')
# A line that CLOSES one, e.g. `)}`
GUARD_CLOSE_RE = re.compile(r'^\s*\)\}\s*,?\s*$')
# Any inline guard on the render line itself, e.g. `{showReefer && filterCell('rfrMaxLdn'...`
INLINE_GUARD_RE = re.compile(r'\{\s*(!?\w+)\s*&&')


def accepted_guard_tokens(key):
    """Guard tokens that count as 'gated by this toggle'.

    The file expresses the same state two ways: `!<key>Hidden` directly, and a derived
    `show<Key>` alias on the POL tab (e.g. `showReefer`, `showPolStatus`). Both are the
    same boolean, so both satisfy the invariant.
    """
    cap = key[0].upper() + key[1:]
    return {'!%sHidden' % key, 'show%s' % cap}


def main():
    path = find_app_html()
    try:
        lines = open(path, encoding='utf-8').read().split('\n')
    except OSError as e:
        print('Could not read %s: %s' % (path, e))
        sys.exit(2)

    # --- collect the descriptors ---
    toggles = {}
    for line in lines:
        m = DESCRIPTOR_RE.search(line)
        if m:
            toggles[m.group('key')] = STRING_RE.findall(m.group('filters'))
    if not toggles:
        print('FAIL: found no FIELD_TOGGLES descriptors in %s. Either the picker was '
              'removed or its shape changed; this check cannot silently pass.'
              % os.path.basename(path))
        sys.exit(2)

    # --- walk the file once, tracking the stack of enclosing guard tokens ---
    # Line-based rather than a real JSX parse, which is sound here because this file
    # formats every guarded block as `{cond && (` ... `)}` on their own lines. If that
    # ever stops being true the stack will desync and this check will report phantom
    # violations -- loudly wrong, which is the failure mode we want.
    stack = []
    sites = {}   # filter key -> list of (line_no, gated_by_tokens, text)
    for i, line in enumerate(lines, 1):
        opened = GUARD_OPEN_RE.match(line)
        if GUARD_CLOSE_RE.match(line) and stack:
            stack.pop()
        for m in re.finditer(r"(?:renderFilter|filterCell)\('([^']+)'", line):
            key = m.group(1)
            guards = set(stack) | set(INLINE_GUARD_RE.findall(line))
            sites.setdefault(key, []).append((i, guards, line.strip()[:90]))
        if opened:
            stack.append(opened.group('tok'))

    # --- check the invariant ---
    violations = []
    checked = 0
    for toggle, keys in sorted(toggles.items()):
        ok_tokens = accepted_guard_tokens(toggle)
        for key in keys:
            found = sites.get(key, [])
            if not found:
                violations.append(
                    "toggle '%s' lists filter key '%s', but no renderFilter('%s')/"
                    "filterCell('%s') site exists. Dead entry: either the column was "
                    "removed (drop it from `filters`) or the key was misspelled."
                    % (toggle, key, key, key))
                continue
            for (line_no, guards, text) in found:
                checked += 1
                if not (guards & ok_tokens):
                    violations.append(
                        "toggle '%s' lists filter key '%s', but line %d renders it "
                        "UNGATED by %s.\n      %s\n      -> Either gate that site with "
                        "the toggle, or remove '%s' from the toggle's `filters` array. "
                        "Auto-clearing a filter the user can still see is a bug."
                        % (toggle, key, line_no,
                           ' or '.join(sorted(ok_tokens)), text, key))

    # --- D18 (2026-10-07): POL_ONLY_HEADER_FILTER_KEYS names exactly the POL-only columns ---
    # The app applies a header filter on one of those keys only while the POL tab is open. POL's
    # boxes are filterCell(...) sites and Booking Flash's are renderFilter(...) sites, so the POL-only
    # columns are the filterCell keys with no renderFilter site. A key missing from the list would
    # follow the reader to tabs with no box for it; a key listed wrongly would stop a filter the
    # reader can see on Booking Flash from applying there. Sites inside comments are ignored.
    code_lines = [l for l in lines if not l.lstrip().startswith(('//', '*', '/*'))]
    def keys_of(fn):
        return {m.group(1) for l in code_lines for m in re.finditer(r"%s\('([^']+)'" % fn, l)}
    pol_only = keys_of('filterCell') - keys_of('renderFilter')
    m = re.search(r"POL_ONLY_HEADER_FILTER_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)", '\n'.join(lines))
    if not m:
        violations.append('POL_ONLY_HEADER_FILTER_KEYS (D18) not found in the app file; '
                          'the POL-only header filters would follow the reader to other tabs.')
    else:
        listed = set(STRING_RE.findall(m.group(1)))
        if not pol_only:
            violations.append('found no POL-only filterCell keys at all: the POL table\'s filter '
                              'helper was renamed, so this check can no longer read it.')
        if listed != pol_only:
            violations.append('POL_ONLY_HEADER_FILTER_KEYS disagrees with the render sites. '
                              'Missing (POL-only, not listed): %s. Listed but not POL-only: %s.'
                              % (sorted(pol_only - listed) or 'none', sorted(listed - pol_only) or 'none'))
        else:
            print('POL_ONLY_HEADER_FILTER_KEYS matches the %d POL-only filter columns (D18).' % len(pol_only))

    print('Checked %d filter render site(s) across %d toggle(s).'
          % (checked, len(toggles)))
    if violations:
        print('\nFIELD_FILTER_GATING_FAILED -- %d violation(s):\n' % len(violations))
        for v in violations:
            print('  - %s\n' % v)
        sys.exit(1)
    print('FIELD_FILTER_GATING_PASSED -- every auto-cleared filter key is gated at '
          'every render site.')


if __name__ == '__main__':
    main()

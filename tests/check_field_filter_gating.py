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
import sys

# Auto-detect the main app file with the SAME algorithm the other checks use: match both
# naming eras, exclude testing builds, and let the numeric version comparison -- not the
# regex -- decide which is current. A silently skipped or misidentified file is how this
# repo has been burned before, so both the exclusions and the choice are printed.
NAME_RE = re.compile(r'^[Bb]ooking_flash_report_na(_Kevin)?_[\d.]+_.*\.html$')
TESTING_BUILD = re.compile(r'testing', re.I)


def find_app_html():
    if len(sys.argv) > 1:
        return sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    all_files = [f for f in os.listdir(root) if NAME_RE.match(f)]
    excluded = [f for f in all_files if TESTING_BUILD.search(f)]
    if excluded:
        print('(excluded as testing builds: %s)' % ', '.join(sorted(excluded)))
    candidates = [f for f in all_files if not TESTING_BUILD.search(f)]
    if not candidates:
        print('Could not find any main Booking_flash_report_na*.html file in %s; '
              'pass the app path explicitly as the 1st argument.' % root)
        sys.exit(2)

    def version_key(fname):
        m = re.search(r'na_(?:Kevin_)?([\d.]+)_', fname)
        return tuple(int(p) for p in m.group(1).split('.')) if m else (0,)

    chosen = max(candidates, key=version_key)
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

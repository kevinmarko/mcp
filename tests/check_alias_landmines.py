#!/usr/bin/env python3
"""
Static check for the "fuzzy-alias landmine" bug class (DATA_ARCHITECTURE.md's Class E).

Extracts every `field: getVal(['alias1', 'alias2', ...])` call from the app's source file,
simulates getVal()'s exact two-pass resolution algorithm (see DATA_ARCHITECTURE.md for the
real implementation this mirrors) against a real raw export's actual header row, and flags any
alias whose pass-2 SUBSTRING fallback would resolve to a DIFFERENT column than the field's own
established primary (first-listed) alias.

This is the bug class that broke tat/let (2026-08-18) and cutoff/etd/proformaRot/remarks
(2026-08-25) -- always the same shape: a short, generic trailing alias that's harmless as long
as its field's primary source column is populated on every row, then silently corrupts the
value on any row where that primary column happens to be blank. A landmine can be DORMANT
against one export and LIVE against another purely because of which rows happen to be blank --
run this against any new real export you're given, not just once.

Usage:
    python3 tests/check_alias_landmines.py <path-to-real-export.xlsx-or-.csv> [path-to-app-html]

    # against the checked-in sample:
    python3 tests/check_alias_landmines.py Booking_Flash_Data_MAIN_UPLOAD_8-12-2026.xlsx

Exit code 0 if no landmines found, 1 if any are found (so this can gate a commit/CI step later
if this repo ever adds one).
"""
import sys
import re
import os

def clean(s):
    return re.sub(r'[^a-z0-9]', '', str(s).lower())


def load_headers(data_path):
    """Load the real header row from a raw export -- .csv (row 1) or .xlsx (row 2, matching
    this project's Data_download sheet convention -- see DATA_ARCHITECTURE.md)."""
    ext = os.path.splitext(data_path)[1].lower()
    if ext == '.csv':
        import csv
        with open(data_path, newline='', encoding='utf-8-sig') as f:
            return next(csv.reader(f))
    else:
        import openpyxl
        wb = openpyxl.load_workbook(data_path, data_only=True)
        ws = wb['Data_download'] if 'Data_download' in wb.sheetnames else wb.active
        # header row is row 2 in this project's raw xlsx exports (row 1 is blank/title) --
        # detect by picking whichever of rows 1-2 has more non-empty text cells.
        row1 = [c.value for c in ws[1]]
        row2 = [c.value for c in ws[2]]
        header_row = row2 if sum(1 for v in row2 if v) > sum(1 for v in row1 if v) else row1
        return [h for h in header_row if h is not None]


def extract_getval_fields(html_path):
    """Extract every `field: getVal([...])` call from the app source. Returns
    {field_name: [alias1, alias2, ...]} in source order."""
    with open(html_path, encoding='utf-8') as f:
        content = f.read()
    fields = {}
    for m in re.finditer(r"(\w+):\s*getVal\(\[([^\]]+)\]\)", content):
        field, alias_str = m.groups()
        aliases = re.findall(r"'((?:[^'\\]|\\.)*)'", alias_str)
        aliases = [a.replace("\\'", "'") for a in aliases]
        if aliases:
            fields[field] = aliases  # last definition in the file wins, matching JS behavior
    return fields


def simulate_getval(aliases, clean_headers, real_headers):
    """Mirror the app's own two-pass getVal() resolution given a header set, assuming every
    column is non-blank (the best case -- pass 1 alone). Returns (resolved_header, pass_used)
    or (None, None) if nothing matches."""
    for alias in aliases:
        ca = clean(alias)
        if ca in clean_headers:
            return real_headers[clean_headers.index(ca)], 1
    for alias in aliases:
        ca = clean(alias)
        if len(ca) < 3:
            continue
        for i, h in enumerate(clean_headers):
            if ca in h:
                return real_headers[i], 2
    return None, None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    data_path = sys.argv[1]
    html_path = sys.argv[2] if len(sys.argv) > 2 else None
    if html_path is None:
        # README.md: "always the highest version number present in the repo root is the live
        # one" -- older booking_flash_report_na_Kevin_1.0X_*.html files are kept for history,
        # not maintained, and must never be silently picked over the current one.
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates = [f for f in os.listdir(repo_root) if re.match(r'booking_flash_report_na_Kevin_[\d.]+_.*\.html$', f)]
        if not candidates:
            print(f"Could not find any booking_flash_report_na_Kevin_*.html file in {repo_root}; pass the app path explicitly as the 2nd argument.")
            sys.exit(2)
        def version_key(fname):
            m = re.search(r'Kevin_([\d.]+)_', fname)
            return tuple(int(p) for p in m.group(1).split('.')) if m else (0,)
        html_path = os.path.join(repo_root, max(candidates, key=version_key))
        print(f"(auto-detected current app version: {os.path.basename(html_path)})")

    real_headers = load_headers(data_path)
    clean_headers = [clean(h) for h in real_headers]
    fields = extract_getval_fields(html_path)

    landmines = []
    dead_aliases = []
    for field, aliases in fields.items():
        # The set of real columns ANY of this field's own aliases would exact-match -- if a
        # fuzzy hit lands on one of these, it's a column already tried (and, on whatever row
        # triggered pass 2, already confirmed blank) via pass 1's own exact-match loop, so
        # reaching it again via fuzzy match in pass 2 is a no-op (same blank cell), not a wrong
        # value. Only a fuzzy hit OUTSIDE this set can actually corrupt the field with a
        # genuinely different column's data.
        own_exact_matches = {clean(real_headers[clean_headers.index(clean(a))])
                              for a in aliases if clean(a) in clean_headers}
        primary_match, _ = simulate_getval(aliases[:1], clean_headers, real_headers)
        for alias in aliases[1:]:
            ca = clean(alias)
            if ca in clean_headers:
                continue  # a further exact match is a legitimate, intentional distinct alias -- fine
            if len(ca) < 3:
                continue  # getVal itself ignores these in pass 2
            # Mirror getVal's pass-2 exactly: first real header (in the file's own column
            # order, which clean_headers already preserves) containing this alias as a
            # substring -- not "any" match, the SAME first-found-wins semantics as the app.
            fuzzy_match = next((real_headers[i] for i, h in enumerate(clean_headers) if ca in h), None)
            if fuzzy_match is None:
                dead_aliases.append((field, alias))
                continue
            if clean(fuzzy_match) not in own_exact_matches:
                landmines.append({
                    'field': field, 'alias': alias, 'fuzzy_match': fuzzy_match,
                    'primary_alias': aliases[0], 'primary_match': primary_match,
                })

    print(f"Checked {len(fields)} getVal() fields against {len(real_headers)} real headers from {data_path}\n")

    if landmines:
        print(f"❌ {len(landmines)} LANDMINE(S) FOUND -- these aliases would fuzzy-match a column NOT already covered by this field's own alias list:\n")
        for lm in landmines:
            print(f"  field '{lm['field']}': alias {lm['alias']!r} would fuzzy-match {lm['fuzzy_match']!r}")
            print(f"    (primary alias {lm['primary_alias']!r} resolves to {lm['primary_match']!r} -- a different, unrelated column)")
        print()
    else:
        print("✅ No landmines found -- every non-exact-match alias either matches nothing or only self-matches its own field's correct column.\n")

    if dead_aliases:
        print(f"ℹ️  {len(dead_aliases)} alias(es) match nothing at all in this file (harmless -- likely there for a different export format):")
        for field, alias in dead_aliases:
            print(f"  field '{field}': alias {alias!r}")

    sys.exit(1 if landmines else 0)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Librarian helpers (markdown only). Run from the repo root with:  python3 -I <this file> <command>

  links            check every relative markdown link in tracked + untracked-not-ignored .md files; exit 1 if any is broken
  index [folder]   refresh the generated table (the rows under the '| File | What it is | KB |' header) of every
                   README.md that has one (or only the given folder's). Text above the table is never touched.
  unlisted         list .md files that DOCS_INDEX.md or a folder README does not mention by file name
  stale-ids        print the highest ADR / B / Q ids found, to compare with what the docs say

Standard library only. Never edits anything except the generated tables of folder READMEs (command `index`).
"""
import os, re, subprocess, sys, urllib.parse

BS = chr(92)
HEADER = '| File | What it is | KB |'


def md_files():
    out = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '*.md'], text=True, encoding='utf-8').splitlines()
    return [f for f in out if os.path.exists(f) and 'node_modules' not in f]


def links():
    pat = re.compile(r'\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
    broken, total = [], 0
    for f in md_files():
        txt = re.sub(r'```.*?```', '', open(f, encoding='utf-8', errors='ignore').read(), flags=re.S)
        for m in pat.finditer(txt):
            t = m.group(1)
            if re.match(r'^(https?:|mailto:|#|app:|file:)', t):
                continue
            total += 1
            p = urllib.parse.unquote(t.split('#')[0])
            if p and not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), p))):
                broken.append((f, t))
    print('%d md files, %d relative links, %d broken' % (len(md_files()), total, len(broken)))
    for f, t in broken:
        print('  BROKEN %s -> %s' % (f, t))
    return 1 if broken else 0


def title_of(path):
    try:
        for line in open(path, encoding='utf-8', errors='ignore'):
            s = line.strip()
            if s.startswith('#'):
                return s.lstrip('#').strip()
            if s and not s.startswith('---'):
                return s[:100]
    except Exception:
        pass
    return ''


def index(only=None):
    n = 0
    for readme in md_files():
        if os.path.basename(readme) != 'README.md':
            continue
        folder = os.path.dirname(readme) or '.'
        if only and os.path.normpath(folder) != os.path.normpath(only):
            continue
        txt = open(readme, encoding='utf-8', newline='').read()
        if HEADER not in txt:
            continue
        nl = '\r\n' if '\r\n' in txt else '\n'
        head = txt[:txt.index(HEADER)]
        rows = []
        for root, dirs, files in os.walk(folder):
            dirs.sort()
            for fn in sorted(files):
                if fn.endswith('.md') and fn != 'README.md':
                    p = os.path.join(root, fn)
                    rel = os.path.relpath(p, folder).replace(BS, '/')
                    t = title_of(p).replace('|', '/')
                    t = t if len(t) <= 110 else t[:107] + '...'
                    rows.append('| [%s](%s) | %s | %d |' % (fn, urllib.parse.quote(rel, safe='/'), t, max(1, round(os.path.getsize(p) / 1024))))
        new = head + nl.join([HEADER, '|---|---|---|'] + rows) + nl
        if new != txt:
            open(readme, 'w', encoding='utf-8', newline='').write(new)
            print('refreshed', readme, len(rows), 'rows')
            n += 1
    print('%d README tables refreshed' % n)
    return 0


def unlisted():
    mentioned = ''
    for f in md_files():
        if f == 'DOCS_INDEX.md' or os.path.basename(f) == 'README.md':
            mentioned += open(f, encoding='utf-8', errors='ignore').read()
    miss = [f for f in md_files() if os.path.basename(f) not in mentioned and f != 'DOCS_INDEX.md'
            and not f.startswith(('app/reports/', 'node_modules'))]
    print('%d .md files not named in DOCS_INDEX.md or a folder README' % len(miss))
    for f in miss:
        print('  ' + f)
    return 0


def stale_ids():
    corpus = {f: open(f, encoding='utf-8', errors='ignore').read() for f in md_files()}
    for name, rx in (('ADR', r'ADR-(\d+)'), ('B decision', r'(?<![A-Za-z0-9])B(\d{1,3})(?![0-9A-Za-z])'), ('Q-id', r'Q-[A-Z]+(\d+)')):
        best, where = 0, ''
        for f, t in corpus.items():
            for m in re.finditer(rx, t):
                v = int(m.group(1))
                if v > best:
                    best, where = v, f
        print('%-10s highest number %s (in %s)' % (name, best, where))
    return 0


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'links'
    if cmd == 'links':
        sys.exit(links())
    elif cmd == 'index':
        sys.exit(index(sys.argv[2] if len(sys.argv) > 2 else None))
    elif cmd == 'unlisted':
        sys.exit(unlisted())
    elif cmd == 'stale-ids':
        sys.exit(stale_ids())
    else:
        print(__doc__)
        sys.exit(2)

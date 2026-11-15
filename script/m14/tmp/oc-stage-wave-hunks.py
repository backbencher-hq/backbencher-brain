#!/usr/bin/env python3
"""Stage ONLY the objc grammar-wave hunks of a file another lane is editing.

M60 objc grammar wave, 2026-09-25. `script/m14/differential.ts` carries, in the
same working tree, the clean lane's work (`deriveCleanEdges`,
`operator_definition`) beside this wave's two changes:

  * the router import + `ROUTER_LANGUAGE`/`extOf`/`LANGS` type widening, and
  * the `objc` entry's `ext: "m,h"` + `routeByContent: ["h"]`.

Selection is by MARKER, and it is fail-closed: a hunk must be recognisably this
wave's or recognisably another lane's. Anything neither aborts the run rather
than being guessed at — the whole point is that a whole-file `git add` would
publish someone else's unfinished work under this lane's message.

Usage:
  python3 script/m14/tmp/oc-stage-wave-hunks.py --dry-run
  python3 script/m14/tmp/oc-stage-wave-hunks.py
"""
import re
import subprocess
import sys

FILE = "script/m14/differential.ts"

MINE = (
    "language-detection",
    "ROUTER_LANGUAGE",
    "extOf",
    "routeByContent",
    'ext: "m,h"',
    "M60 objc headers",
    "router's sniff",
    "The ROUTER's spelling",
    "a second opinion kept here",
)
KNOWN_FOREIGN = ("deriveCleanEdges", "operator_definition", "clean")

dry = "--dry-run" in sys.argv

diff = subprocess.run(
    ["git", "diff", "--unified=3", "--", FILE], capture_output=True, text=True, check=True
).stdout
lines = diff.split("\n")

# Split into header + hunks.
header, hunks, cur = [], [], None
for ln in lines:
    if ln.startswith("@@"):
        if cur is not None:
            hunks.append(cur)
        cur = [ln]
    elif cur is None:
        header.append(ln)
    else:
        cur.append(ln)
if cur is not None:
    hunks.append(cur)

keep, foreign, unknown = [], [], []
for h in hunks:
    body = "\n".join(h)
    changed = [l for l in h if (l.startswith("+") or l.startswith("-")) and not l.startswith(("+++", "---"))]
    is_mine = any(m in body for m in MINE)
    is_foreign = any(f in body for f in KNOWN_FOREIGN)
    verdict = "MINE" if is_mine else ("FOREIGN" if is_foreign else "UNKNOWN")
    print(f"  {verdict:8s} {h[0][:70]}  (+{sum(1 for l in changed if l[0]=='5' or l.startswith('+'))} changed)")
    if is_mine:
        keep.append(h)
    elif is_foreign:
        foreign.append(h)
    else:
        unknown.append(h)

if unknown:
    print(f"\nABORT: {len(unknown)} hunk(s) matched neither rule — refusing to guess:")
    for h in unknown:
        print("   ", h[0])
    print("\n".join("\n".join(h) for h in unknown[:1]))
    sys.exit(2)

print(f"\nkept {len(keep)} hunk(s), left {len(foreign)} foreign hunk(s) unstaged")
if dry:
    print("(dry run — index untouched)")
    sys.exit(0)

patch = "\n".join(header + [l for h in keep for l in h])
subprocess.run(["git", "apply", "--cached", "--unidiff-zero" if False else "--whitespace=nowarn", "-"], input=patch, text=True, check=True)

# Invariant: the foreign hunks must STILL be unstaged.
still = subprocess.run(["git", "diff", "--", FILE], capture_output=True, text=True, check=True).stdout
ok = all(f in still for f in KNOWN_FOREIGN)
print("foreign work still unstaged:", ok)
if not ok:
    sys.exit(3)
staged = subprocess.run(["git", "diff", "--cached", "--stat", "--", FILE], capture_output=True, text=True).stdout
print(staged.strip())

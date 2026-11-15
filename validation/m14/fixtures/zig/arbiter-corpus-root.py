#!/usr/bin/env python3
"""Build a BOUNDED corpus root for the shared ontology arbiter.

## Why this exists

`script/m14/ontology-coverage-gate.ts` scans the whole corpus in ONE process,
through production `parseFile`, BEFORE it consults `RULED_BY_LANG`. On this lane
that scan does not finish: `parseFile` carries cumulative WASM state, and the
gate trips the engine's own 120 s self-destruct guard
(`[BB-HANG] parser stuck 120s on zig/lib/std/testing.zig — exiting`), which is
`process.exit(1)` in `src/ast/engine.ts` — so the process dies before the verdict
table is printed. The gate is shared machinery (§8), so the lane cannot shard it.

`BB_CORPUS_ROOT` is the gate's own documented knob, and it is the only one that
changes the size of the population it scans. This script builds a corpus root of
the first N files of the SAME hashed draw the lane census uses, so the arbiter can
be run for real — same admission, same ordering, same files, fewer of them — and
the ruling table can be exercised by the arbiter itself rather than by a replica
of it.

The full-population measurements stay with the lane's own instruments, which load
the pinned wasm directly and never go through `parseFile`:
`construct-probe.ts` and `zig-ruled-probe.ts`. Both report their draw hash, and
this script prints the hash of the draw it copied, so the two can be compared.

Usage: arbiter-corpus-root.py <destdir> <N> [seed]
"""
import hashlib
import os
import shutil
import subprocess
import sys

CR = os.environ.get("BB_CORPUS_ROOT", "/home/ishaq2321/bb_tests/repositories")
dest = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opencode/zig-arbiter-root"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 1200
seed = sys.argv[3] if len(sys.argv) > 3 else "ontology-census-v1"
LIMIT = 512 * 1024

rows = []
for repo in sorted(os.listdir(CR)):
    d = os.path.join(CR, repo)
    if not os.path.isdir(d):
        continue
    try:
        subprocess.run(["git", "-C", d, "rev-parse", "--git-dir"], check=True, capture_output=True)
    except Exception:
        continue
    try:
        out = subprocess.run(["git", "-C", d, "ls-files", "-z", "--", "*.zig"], check=True, capture_output=True).stdout
    except Exception:
        continue
    for rel in [x.decode() for x in out.split(b"\0") if x]:
        p = os.path.join(d, rel)
        try:
            if os.path.getsize(p) > LIMIT:
                continue
        except OSError:
            continue
        rows.append(f"{repo}/{rel}")

rows.sort(key=lambda k: hashlib.sha256(f"{seed}|{k}".encode()).hexdigest())
picked = rows[:N]

if os.path.exists(dest):
    shutil.rmtree(dest)
os.makedirs(dest)
for key in picked:
    repo, rel = key.split("/", 1)
    src = os.path.join(CR, repo, rel)
    # `<repo>/<rel>` verbatim: the gate labels its findings with this string, so
    # the paths in its output have to be the corpus paths, not copies of them.
    out = os.path.join(dest, repo, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shutil.copy2(src, out)

subprocess.run(["git", "init", "-q", dest], check=True)
subprocess.run(["git", "-C", dest, "add", "-A"], check=True)
tracked = subprocess.run(["git", "-C", dest, "ls-files", "-z"], check=True, capture_output=True).stdout
tracked = [x.decode() for x in tracked.split(b"\0") if x]

h = hashlib.sha256("\n".join(sorted(picked)).encode()).hexdigest()
per_repo = {}
for k in picked:
    per_repo[k.split("/", 1)[0]] = per_repo.get(k.split("/", 1)[0], 0) + 1
print(f"corpus root {dest}")
print(f"  copied {len(picked)} of {len(rows)} admitted files; git ls-files sees {len(tracked)}")
print(f"  draw (first {N} of sha256({seed}|repo/rel)): sha256:{h}")
print("  per repo: " + " ".join(f"{k}={v}" for k, v in sorted(per_repo.items())))
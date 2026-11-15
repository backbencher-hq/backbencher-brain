#!/usr/bin/env python3
"""Reproduce the ontology census's draw, independently of the census process.

The census sorts admitted files by sha256("<seed>|<repo>/<rel>") and takes the
first N. This script performs the identical admission (git ls-files -- '*.zig'
per corpus repo, size <= 512 KiB) and the identical ordering, then writes N
shard files. It exists because the census has to be run in shards: `parseFile`
carries cumulative WASM state, and one process over the whole draw trips the
engine's 120 s self-destruct guard on a file that parses in 2.98 s alone.

It prints the draw hash so the merge can ASSERT that the union of the shards is
the same file set a single-process run would have drawn. If the hash differs,
the sharded numbers are not comparable and the merge refuses.

Usage: shard-draw.py <outdir> <shards> [seed]
"""
import hashlib
import os
import subprocess
import sys

CR = os.environ.get("BB_CORPUS_ROOT", "/home/ishaq2321/bb_tests/repositories")
outdir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opencode/zig-shards"
shards = int(sys.argv[2]) if len(sys.argv) > 2 else 8
seed = sys.argv[3] if len(sys.argv) > 3 else "ontology-census-v1"
LIMIT = 512 * 1024

rows = []
counts = {}
for repo in sorted(os.listdir(CR)):
    d = os.path.join(CR, repo)
    if not os.path.isdir(d):
        continue
    try:
        subprocess.run(["git", "-C", d, "rev-parse", "--git-dir"],
                       check=True, capture_output=True)
    except Exception:
        continue
    try:
        out = subprocess.run(["git", "-C", d, "ls-files", "-z", "--", "*.zig"],
                             check=True, capture_output=True).stdout
    except Exception:
        continue
    tracked = [x.decode() for x in out.split(b"\0") if x]
    counts[repo] = len(tracked)
    for rel in tracked:
        p = os.path.join(d, rel)
        try:
            if os.path.getsize(p) > LIMIT:
                continue
        except OSError:
            continue
        rows.append(f"{repo}/{rel}")

rows.sort(key=lambda k: hashlib.sha256(f"{seed}|{k}".encode()).hexdigest())
h = hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest()
os.makedirs(outdir, exist_ok=True)
buckets = [[] for _ in range(shards)]
for i, k in enumerate(rows):
    buckets[i % shards].append(k)
for i, b in enumerate(buckets):
    with open(os.path.join(outdir, f"shard-{i}.txt"), "w") as fh:
        fh.write("\n".join(b) + ("\n" if b else ""))
print(f"admitted {len(rows)}  shards {shards}  drawHash sha256:{h}")
print("per-repo tracked: " + " ".join(f"{k}={v}" for k, v in counts.items() if v))
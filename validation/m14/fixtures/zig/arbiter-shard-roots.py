#!/usr/bin/env python3
"""Build one BOUNDED corpus root per shard, so the shared arbiter can be run over
the WHOLE draw instead of a prefix of it.

## Why this exists

The base branch's `script/m14/ontology-coverage-gate.ts` walks the corpus with
`resumableWalk`, added in `fc799b7db` precisely because "one poison file can no
longer delete a whole measurement". That file is NOT on this lane's branch — it
is shared machinery (workstream §8) and this lane does not edit it — so on this
branch the arbiter keeps the single-process walk and keeps dying:

    [BB-HANG] parser stuck 120s on <file> — exiting

and no verdict table is printed. The offending file ROTATES per run (measured:
`zig/lib/std/testing.zig`, `zig/lib/std/buf_set.zig`, `ghostty/src/lib/tinyio/
windows.zig`, `ghostty/src/lib/tinyio/test.zig` across four runs), because the
trigger is accumulated WASM state rather than the file, so narrowing the corpus
is the only lever that works from here.

Running the arbiter on a PREFIX of the draw (what `arbiter-corpus-root.py` does)
narrows the population. Sharding does not: the shards PARTITION the same hashed
draw, and both instruments the arbiter's verdicts rest on compose exactly under
sharding:

  instrument A (grammar inventory)  a Map of node type -> count over all files;
                                    the union of the shards' maps is the whole
                                    draw's map. No verdict reads a MINIMUM or a
                                    per-file threshold, so union is exact.
  instrument B (parse-tree count)   occurrences summed, file sets unioned.
  EMITTED rows                       edge counts summed; the "e.g." example list
                                    is per-shard-first-4, so the EXAMPLES depend
                                    on the shard boundaries and only the COUNTS
                                    and the FILES-with-edges total are portable.

So: same admission (`git ls-files -- '*.zig'`, <= 512 KiB), same ordering
(`sha256("<seed>|<repo>/<rel>")`), same files, partitioned. `arbiter-arbiter-merge`
asserts the union of the shards' file sets is the draw `shard-draw.py` published,
and refuses to write if it is not — a truncated union is a correct number about
the wrong population.

Usage: arbiter-shard-roots.py <sharddir> [outroot] [seed]
"""
import hashlib
import os
import shutil
import subprocess
import sys

CR = os.environ.get("BB_CORPUS_ROOT", "/home/ishaq2321/bb_tests/repositories")
sharddir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opencode/zig-shards"
outroot = sys.argv[2] if len(sys.argv) > 2 else "/tmp/opencode/zig-arbiter-shards"
seed = sys.argv[3] if len(sys.argv) > 3 else "ontology-census-v1"

shards = sorted(x for x in os.listdir(sharddir) if x.startswith("shard-") and x.endswith(".txt"))
if not shards:
    sys.exit(f"no shard-*.txt in {sharddir}; run shard-draw.py first")

if os.path.exists(outroot):
    shutil.rmtree(outroot)

union = []
for s in shards:
    with open(os.path.join(sharddir, s)) as fh:
        keys = [x.strip() for x in fh if x.strip()]
    dest = os.path.join(outroot, s[:-4])
    os.makedirs(dest)
    for key in keys:
        repo, rel = key.split("/", 1)
        src = os.path.join(CR, repo, rel)
        # `<repo>/<rel>` verbatim: the gate labels its findings with this string,
        # so its output paths have to be corpus paths, not copy paths.
        out = os.path.join(dest, repo, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        shutil.copy2(src, out)
    subprocess.run(["git", "init", "-q", dest], check=True)
    subprocess.run(["git", "-C", dest, "add", "-A"], check=True)
    tracked = subprocess.run(["git", "-C", dest, "ls-files", "-z"], check=True,
                             capture_output=True).stdout
    n_tracked = len([x for x in tracked.split(b"\0") if x])
    if n_tracked != len(keys):
        sys.exit(f"REFUSING {s}: copied {len(keys)} files, git ls-files sees {n_tracked}. "
                 f"The arbiter's admission would differ from the census's and the "
                 f"verdict would be about a different population.")
    union.extend(keys)
    print(f"  {s}: {len(keys)} files -> {dest}")

h = hashlib.sha256("\n".join(sorted(union)).encode()).hexdigest()
print(f"union of {len(shards)} shards: {len(union)} files  sha256:{h}")
print("EXPECTED (the draw shard-draw.py published): sha256:2f3545f9"
      "2c470090d61c9a745bb427d8d7dec1630d93d0fbc01cb2acdc5ce1ac")
print("The two MUST be equal. The merge re-checks it and writes nothing if they are not.")

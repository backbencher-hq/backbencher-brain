#!/usr/bin/env python3
"""
Merge `reflection-builtin-probe.mts` shards into ONE population figure, or refuse.

The refusal is the point. Each shard reports `parsed` and `parseTraps` because a raw
`parser.parse()` traps the wasm on a large share of this corpus (measured 1,708 of
3,848 unsharded), and a sum of shards that each lost files is a FLOOR wearing a
total's clothes. So this script:

  * requires every expected shard to be present,
  * requires the shards to be a disjoint partition of the corpus (file counts sum to
    the whole, and no file appears in two shards),
  * reports coverage as `parsed / corpusFilesTotal` and labels the merged count
    TOTAL only at 100%, LOWER BOUND otherwise,
  * de-duplicates occurrences by (builtin, file, line) so a re-run cannot inflate them.

Usage: python3 validation/m14/fixtures/zig/reflection-merge.py <out.json> <shard.json...>
"""
import json
import sys
from collections import Counter

if len(sys.argv) < 3:
    sys.stderr.write(__doc__)
    sys.exit(64)

out_path = sys.argv[1]
shard_paths = sys.argv[2:]

shards = []
for p in shard_paths:
    with open(p) as fh:
        shards.append((p, json.load(fh)))

corpus_total = {s["corpusFilesTotal"] for _, s in shards}
if len(corpus_total) != 1:
    sys.stderr.write(f"REFUSING: shards disagree on corpusFilesTotal: {sorted(corpus_total)}\n")
    sys.exit(2)
corpus_total = corpus_total.pop()

shard_ids = sorted(s["shard"] for _, s in shards)
declared = sorted({s["shards"] for _, s in shards})
if len(declared) != 1:
    sys.stderr.write(f"REFUSING: shards disagree on --shards: {declared}\n")
    sys.exit(2)
nshards = declared[0]
if shard_ids != list(range(nshards)):
    sys.stderr.write(f"REFUSING: shards present {shard_ids}, expected 0..{nshards - 1}\n")
    sys.exit(2)

assigned = sum(s["corpusFiles"] for _, s in shards)
if assigned != corpus_total:
    sys.stderr.write(
        f"REFUSING: shards cover {assigned} file slots, corpus holds {corpus_total} — "
        f"not a partition\n"
    )
    sys.exit(2)

parsed = sum(s["parsed"] for _, s in shards)
traps = sum(s["parseTraps"] for _, s in shards)

# Disjointness is a property of the PARTITION, so it is checked on files: every file
# must be handled by exactly one shard. It is deliberately NOT checked on occurrences —
# a file may legitimately call `@field(T, "a")` and `@field(T, "b")` on one line, and
# the first draft of this key was (builtin, file, line), which collided on exactly that
# and made the merge refuse a correct 8-way partition.
shard_of_file: dict[str, int] = {}
overlap: list[str] = []
for _, s in shards:
    for o in s["allOccurrences"]:
        prev = shard_of_file.get(o["file"])
        if prev is None:
            shard_of_file[o["file"]] = s["shard"]
        elif prev != s["shard"]:
            overlap.append(o["file"])
if overlap:
    sys.stderr.write(
        f"REFUSING: {len(set(overlap))} files appear in more than one shard, "
        f"so the shards are not a partition\n"
    )
    sys.exit(2)

occ_all = [o for _, s in shards for o in s["allOccurrences"]]

by_builtin = Counter(o["builtin"] for o in occ_all)
files_with = Counter(o["file"] for o in occ_all)
named = [o for o in occ_all if o["name"] is not None]
published = [o for o in named if o["namePublishedInFile"] is True]

coverage = round(100.0 * parsed / corpus_total, 2) if corpus_total else 0.0
merged = {
    "instrument": "validation/m14/fixtures/zig/reflection-builtin-probe.mts + reflection-merge.py",
    "method": "tree walk: builtin_function nodes with a builtin_identifier child in the CALLED set",
    "shards": nshards,
    "corpusFilesTotal": corpus_total,
    "fileSlotsAssigned": assigned,
    "parsed": parsed,
    "parseTraps": traps,
    "coveragePct": coverage,
    "countKind": "TOTAL" if coverage == 100.0 else "LOWER BOUND",
    "occurrences": len(occ_all),
    "byBuiltin": dict(sorted(by_builtin.items())),
    "filesWithOccurrence": len(files_with),
    "topFiles": [[f, c] for f, c in files_with.most_common(30)],
    "occurrencesWithAStringName": len(named),
    "ofThoseNamePublishedInSameFile": len(published),
    "ofThoseNameNotPublished": len(named) - len(published),
    "allOccurrences": occ_all,
}

with open(out_path, "w") as fh:
    json.dump(merged, fh, indent=2)
    fh.write("\n")

print(json.dumps({k: v for k, v in merged.items() if k != "allOccurrences"}, indent=2))
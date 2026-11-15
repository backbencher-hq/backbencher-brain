#!/usr/bin/env python3
"""Merge the pass-4 adversarial shards, and ASSERT the union is the population.

Every figure this lane publishes about zig names its draw, because three separate
runs of the census disagreed with each other until they were sharded (the parser's
cumulative WASM state; see the doc's ontology section). A merge that does not
assert the union is measuring a different population than the single-process draw
would, and every number downstream of it is then a number about the wrong set.

So this script does three things the arithmetic alone would not:

  1. asserts the eight `popHash` values are EQUAL and equal to the hash
     `shard-draw.py` prints for the whole admitted set;
  2. asserts the union of `perFile[].file` is the admitted population, with no
     duplicate and no omission, against the file list itself;
  3. REFUSES to publish if any shard reported `fallback > 0` or a failing
     precondition — a degraded shard has not measured the analyzer, and summing it
     into the total publishes a mixture that reads as a measurement.

Ratios are recomputed from the summed primitives. Summing eight per-shard
percentages is how pass 2's first merge printed "3606% sites per edge".
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHARDDIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opencode/zig-p4-shards"
N = 8
CR = os.environ.get("BB_CORPUS_ROOT", "/home/ishaq2321/bb_tests/repositories")
LIMIT = 512 * 1024
OUT = os.path.join(HERE, "measurements", "pass4-adversarial-full-2026-10-03.json")

# ── 1. the shards
shards = []
for i in range(N):
    p = os.path.join(HERE, "measurements", f"pass4-shard-{i}.json")
    with open(p) as fh:
        shards.append(json.load(fh))

pops = {s["popHash"] for s in shards}
if len(pops) != 1:
    sys.exit(f"REFUSING: shards disagree on the admitted population: {sorted(pops)}")
POP = pops.pop()

# the same admission walk shard-draw.py performs, recomputed here so the assertion
# does not rest on a file that script wrote
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
        out = subprocess.run(["git", "-C", d, "ls-files", "-z", "--", "*.zig"],
                             check=True, capture_output=True).stdout
    except Exception:
        continue
    for rel in [x.decode() for x in out.split(b"\0") if x]:
        try:
            if os.path.getsize(os.path.join(d, rel)) > LIMIT:
                continue
        except OSError:
            continue
        rows.append(f"{repo}/{rel}")
POPHASH = hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest()
if POP != POPHASH:
    sys.exit(f"REFUSING: shard popHash {POP} != independently walked {POPHASH}")

# ── 2. the union
seen = []
for s in shards:
    for r in s["perFile"]:
        seen.append(r["file"])
if len(seen) != len(set(seen)):
    dupes = [f for f in set(seen) if seen.count(f) > 1]
    sys.exit(f"REFUSING: {len(dupes)} file(s) measured twice, e.g. {dupes[:3]}")
want, got = sorted(set(rows)), sorted(set(seen))
if want != got:
    miss = sorted(set(want) - set(got))[:5]
    extra = sorted(set(got) - set(want))[:5]
    sys.exit(f"REFUSING: union != population. missing {len(set(want)-set(got))} e.g. {miss}; extra {len(set(got)-set(want))} e.g. {extra}")

# ── 3. no degraded shard
bad = [i for i, s in enumerate(shards) if s["tally"]["fallbackFiles"] > 0]
if bad:
    sys.exit(f"REFUSING: shard(s) {bad} reported parseFile fallback — they measured extractFallback, not the analyzer")
for i, s in enumerate(shards):
    failing = [c["name"] for c in s.get("preconditions", []) if not c["ok"]]
    if failing:
        sys.exit(f"REFUSING: shard {i} precondition(s) failed: {failing}")


def total(field):
    return sum(s["tally"][field] for s in shards)


def bd(field):
    return {k: sum(s["tally"][field][k] for s in shards) for k in shards[0]["tally"][field]}


files = total("files")
T = {
    "files": files,
    "p10Sites": total("p10Sites"), "p10Files": total("p10Files"), "p10": bd("p10"),
    "p11GenericFnFiles": total("p11GenericFnFiles"), "p11Sites": total("p11Sites"), "p11": bd("p11"),
    "p12FnFiles": total("p12FnFiles"), "p12Sites": total("p12Sites"), "p12": bd("p12"),
    "p13SelfSites": total("p13SelfSites"), "p13SelfFiles": total("p13SelfFiles"), "p13SelfEdges": total("p13SelfEdges"),
    "p13ParamSites": total("p13ParamSites"), "p13ParamPairs": total("p13ParamPairs"),
    "p13ParamFiles": total("p13ParamFiles"),
    "p14Sites": total("p14Sites"), "p14Files": total("p14Files"),
    "declaredTypeSites": total("declaredTypeSites"), "declaredTypeEdges": total("declaredTypeEdges"),
    "fallbackFiles": 0, "instUnclassified": total("instUnclassified"),
}
names = {}
for s in shards:
    for k, v in s["tally"]["p13ParamNames"].items():
        names[k] = names.get(k, 0) + v
T["p13ParamNames"] = names
# distinct names is NOT additive across shards only if the same (repo/rel) is in two
# shards, which assertion 2 already excluded. Per-file distinct counts are additive.
T["declaredTypeDistinct"] = None

print(f"union of {N} shards == the admitted population: {len(got)} of {len(want)} files")
print(f"popHash sha256:{POP[:16]} (independently re-walked, equal)")
print(f"files measured {T['files']}, parseFile fallback on 0, all preconditions ok")
print()


def pct(a, b):
    return "n/a" if not b else f"{100*a/b:.2f}%"


def show(tag, b, sites):
    print(f"{tag}")
    print(f"   sites {sites}   own line {b['calls']} ({pct(b['calls'], sites)})"
          f"   named at another line (dedup) {b['namedElsewhere']} ({pct(b['namedElsewhere'], sites)})"
          f"   NOT NAMED IN THE FILE {b['none']} ({pct(b['none'], sites)})")


print("P10  generic container instantiation in a TYPE position")
print(f"   {T['p10Sites']} sites across {T['p10Files']} files")
show("   ", T["p10"], T["p10Sites"])
print("\nP11  generic FUNCTION application")
print(f"   {T['p11GenericFnFiles']} files declare a generic function; {T['p11Sites']} application sites")
show("   ", T["p11"], T["p11Sites"])
print("\nP12  call to an in-file `fn ... type`  (Z32's documented class)")
print(f"   {T['p12FnFiles']} files declare one; {T['p12Sites']} call sites")
show("   ", T["p12"], T["p12Sites"])
print("\nP13  declared-type `references` whose target the file never DECLARES")
print(f"   `Self` in a type position: {T['p13SelfSites']} sites across {T['p13SelfFiles']} files (SELF_ABSENT)")
print(f"   comptime type parameter in a type position: {T['p13ParamSites']} sites across {T['p13ParamFiles']} files")
print(f"   distinct (file, name) pairs receiving a declared_type edge: {T['p13ParamPairs']}")
top = sorted(names.items(), key=lambda kv: -kv[1])[:12]
print("   most common parameter names: " + " ".join(f"{k}={v}" for k, v in top))
print(f"\nP14  @embedFile: {T['p14Sites']} sites across {T['p14Files']} files, 0 `imports` edges")
print(f"\nCTX  declared_type references: {T['declaredTypeEdges']} edges over {T['declaredTypeSites']} type-position sites")
print(f"CTX  `instantiates` edges with neither documented metadata key: {T['instUnclassified']}")

with open(OUT, "w") as fh:
    json.dump({"popHash": POP, "corpusAdmitted": len(want), "shards": N, "filesMeasured": files,
               "tally": T, "p13ParamNames": names}, fh, indent=2)
print(f"\nwrote {OUT}")

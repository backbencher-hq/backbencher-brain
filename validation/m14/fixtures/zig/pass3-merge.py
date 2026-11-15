#!/usr/bin/env python3
"""Merge sharded pass-3 adversarial raw dumps into ONE report, and REFUSE a
shard that did not measure the analyzer.

Why the refusal is the important part
-------------------------------------
`parseFile` carries cumulative WASM state, so the census and this audit both
have to run in shards. While measuring that, pass 3 found that the sharding is
not by itself sufficient: `src/ast/engine.ts` hands `Language.load` a buffer it
read through `resolveWasm`'s LAST fallback, which writes the grammar to a
SHARED temp path derived only from the grammar name
(`/tmp/bb-wasm_tree-sitter-zig_tree-sitter-zig.wasm`). Eight concurrent
processes therefore write and read the same file, and a reader can get a
truncated one. `Language.load` then throws — "need to see wasm magic number",
or "section (code 10, "Code") extends past end of the module" — and
`pool-worker.parseFile`'s catch converts the failure into `extractFallback`, a
REGEX extractor, SILENTLY. That file's real graph is replaced by regex-derived
symbols that carry no `kind`, and edges at confidence 0.4/0.5 whose source can
be a caller name no zig file declares.

Nothing in the output says so. So this merge counts `fallbackFiles` per shard
and refuses the union if any shard is non-zero, rather than publishing a number
that is a mixture of the analyzer and a regex extractor. Measured rate on the
3,834-file draw at this commit: 6 of 32 shard-runs degraded, across four runs
of 0, 1, 2 and 3 shards.

Every ratio is RECOMPUTED from the summed primitives. Summing eight per-shard
percentages produced a first version of the pass-1 census merge that reported
"3606% sites per edge", which is how a merge bug and a corpus finding look
identical.

Usage: pass3-merge.py <sharddir> <out.json> [nshards]
"""
import hashlib
import json
import os
import sys

sharddir = sys.argv[1]
out = sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 8
# The draw hash each shard records is the hash of ITSELF (the instrument filters
# the hashed draw by --files-from before hashing), so the shards legitimately
# disagree. What must hold is that they are DISJOINT and that their union is the
# published draw, which is what EXPECT, when given, asserts.
EXPECT = sys.argv[4] if len(sys.argv) > 4 else None

SUMMED = [
    "filesParsed", "parseFailures", "fallbackFiles",
    ("p1", "errorLeafUses"), ("p1", "filesWithP1"), ("p1", "notAnErrorMember"),
    ("p2", "destructuringDecls"), ("p2", "nonFirstSlots"), ("p2", "collidingSlots"),
    ("p2", "publishedFileScopeRead"), ("p2", "localReadAfterBinding"),
    ("p3", "methodCalls"), ("p3", "receivers"), ("p3", "receiversNamingFileScopeValue"),
    ("p3", "lostReads"), ("p3", "lostReadsOnAliasReceivers"),
    ("p4", "checked"), ("p4", "globalSourceInsideNamedScope"),
    ("p4", "globalSourceInsideLocalScope"), ("p4", "namedSourceOutsideItself"),
    ("p5", "symbols"), ("p5", "mappedToNode"), ("p5", "unmapped"), ("p5", "zeroStartIndex"),
    ("p5", "startIndexCollisions"),
    ("p6", "checked"), ("p6", "targetBindsToNonContainer"), ("p6", "targetBindsToNothing"),
    ("p7", "checked"), ("p7", "ownerDeclaresNoSuchMember"), ("p7", "ownerUnknown"),
    ("p8", "checked"), ("p8", "targetDeclaredInsideAContainer"), ("p8", "targetNotDeclaredInFile"),
    ("p9", "callSites"), ("p9", "callsEdges"), ("p9", "fieldSites"), ("p9", "usesFieldEdges"),
    ("p9", "bareReadSites"), ("p9", "usesBareEdges"), ("p9", "structInitSites"),
    ("p9", "instantiatesEdges"), ("p9", "declaredTypeSites"), ("p9", "referencesDeclaredTypeEdges"),
]

raws = []
for i in range(N):
    with open(os.path.join(sharddir, f"raw-{i}.json")) as fh:
        raws.append(json.load(fh))

# ── the shards must partition the published draw, exactly
draw_files = sorted(set(f for r in raws for f in r["drawFiles"]))
union_hash = hashlib.sha256("\n".join(draw_files).encode()).hexdigest()
seen = {}
dupes = []
for i, r in enumerate(raws):
    for f in r["drawFiles"]:
        if f in seen:
            dupes.append((f, seen[f], i))
        else:
            seen[f] = i
if dupes:
    print(f"REFUSING: shards are not a partition of the draw; {len(dupes)} file(s) appear twice, e.g. {dupes[:3]}")
    sys.exit(2)
if EXPECT and EXPECT != union_hash:
    print(f"REFUSING: the union of the shards is not the published draw.\n  union    sha256:{union_hash}\n  published sha256:{EXPECT}")
    sys.exit(2)

# ── a shard that fell back to the regex extractor did not measure the analyzer
degraded = [(i, r["fallbackFiles"]) for i, r in enumerate(raws) if r.get("fallbackFiles", 0) > 0]
if degraded:
    print("REFUSING: these shards returned parseFile fallback:true for at least one file,")
    print("         so their counts are a mixture of the analyzer and extractFallback:")
    for i, n in degraded:
        print(f"           shard-{i}: {n} fallback file(s)")
    print("         Re-run those shards. The concurrency that triggers it is the shared")
    print("         /tmp/bb-wasm_<grammar> temp path in resolveWasm; see the report.")
    sys.exit(3)

total = {k: 0 for k in ("filesParsed", "parseFailures", "fallbackFiles")}
buckets: dict = {}
for spec in SUMMED:
    if isinstance(spec, tuple):
        b, k = spec
        buckets.setdefault(b, {})[k] = 0
    else:
        total[spec] = 0
for r in raws:
    for spec in SUMMED:
        if isinstance(spec, tuple):
            b, k = spec
            buckets[b][k] += r[b][k]
        else:
            total[spec] += r[spec]

kind_by_node_type: dict = {}
kind_hist: dict = {}
for r in raws:
    for k, v in r["p5"]["kindByNodeType"].items():
        kind_by_node_type[k] = kind_by_node_type.get(k, 0) + v
    for k, v in r["p1"]["kindHistogram"].items():
        kind_hist[k] = kind_hist.get(k, 0) + v

examples = {k: [] for k in ("p1", "p2", "p3", "p4", "p6", "p7", "p8")}
for r in raws:
    for k in examples:
        for e in r[k].get("examples", []):
            if len(examples[k]) < 25:
                examples[k].append(e)
# Its OWN bucket: the unbound arm is 60x larger, so a shared row cap fills with
# the common arm and the rarer rows become unnameable.
examples["p6_wrongKind"] = []
for r in raws:
    for e in r["p6"].get("wrongKindExamples", []):
        if len(examples["p6_wrongKind"]) < 25:
            examples["p6_wrongKind"].append(e)


def pct(a, b):
    return round(a / b * 10000, 2) / 100 if b else 0.0


def ratio(a, b):
    return round(a / b * 100, 2) / 100 if b else 0.0


report = {
    "instrument": "validation/m14/fixtures/zig/pass3-adversarial.ts (sharded, merged by pass3-merge.py)",
    "entryPoint": "parseFile (src/ast/pool-worker.ts)",
    "treePath": "a second parse of the same bytes through wasm/tree-sitter-zig.wasm",
    "shards": N,
    "unionHash": "sha256:" + union_hash,
    "unionEqualsPublishedDraw": (EXPECT == union_hash) if EXPECT else None,
    "shardsAreDisjoint": True,
    "filesInUnion": len(draw_files),
    "shardsWithFallback": 0,
    **total,
    **{k: buckets[k] for k in sorted(buckets)},
    "p5_kindByNodeType": dict(sorted(kind_by_node_type.items(), key=lambda kv: -kv[1])),
    "p1_kindHistogram": dict(sorted(kind_hist.items(), key=lambda kv: -kv[1])),
    "examples": examples,
}
report["rates"] = {
    "p1_notAnErrorMemberPct": pct(buckets["p1"]["notAnErrorMember"], buckets["p1"]["errorLeafUses"]),
    "p2_collidingSlotsPct": pct(buckets["p2"]["collidingSlots"], buckets["p2"]["nonFirstSlots"]),
    "p2_wrongOfPublishedPct": pct(buckets["p2"]["localReadAfterBinding"], buckets["p2"]["publishedFileScopeRead"]),
    "p3_lostReadsPct": pct(buckets["p3"]["lostReads"], buckets["p3"]["receiversNamingFileScopeValue"]),
    "p3_aliasLostPct": pct(buckets["p3"]["lostReadsOnAliasReceivers"], buckets["p3"]["receiversNamingFileScopeValue"]),
    "p4_mismatchPct": pct(buckets["p4"]["globalSourceInsideNamedScope"] + buckets["p4"]["namedSourceOutsideItself"], buckets["p4"]["checked"]),
    "p5_unmappedPct": pct(buckets["p5"]["unmapped"], buckets["p5"]["symbols"]),
    "p6_nonContainerPct": pct(buckets["p6"]["targetBindsToNonContainer"], buckets["p6"]["checked"]),
    "p7_wrongOwnerPct": pct(buckets["p7"]["ownerDeclaresNoSuchMember"], buckets["p7"]["checked"]),
    "p8_insideContainerPct": pct(buckets["p8"]["targetDeclaredInsideAContainer"], buckets["p8"]["checked"]),
    "p9_sitesPerCallsEdge": ratio(buckets["p9"]["callSites"], buckets["p9"]["callsEdges"]),
    "p9_sitesPerUsesFieldEdge": ratio(buckets["p9"]["fieldSites"], buckets["p9"]["usesFieldEdges"]),
    "p9_sitesPerBareReadEdge": ratio(buckets["p9"]["bareReadSites"], buckets["p9"]["usesBareEdges"]),
    "p9_sitesPerDeclaredTypeEdge": ratio(buckets["p9"]["declaredTypeSites"], buckets["p9"]["referencesDeclaredTypeEdges"]),
    "p9_sitesPerInstantiatesEdge": ratio(buckets["p9"]["structInitSites"], buckets["p9"]["instantiatesEdges"]),
}

with open(out, "w") as fh:
    json.dump(report, fh, indent=2)
    fh.write("\n")

print(f"union of {N} shards: {len(draw_files)} files  sha256:{union_hash[:8]}  (equals published draw: {union_hash == EXPECT if EXPECT else 'not asserted'})")
print(f"wrote {out}")
print(f"files {report['filesParsed']}  fallback {report['fallbackFiles']}  parseFailures {report['parseFailures']}")
print("")
print(f"P1 error.X charged to a non-error symbol   {buckets['p1']['notAnErrorMember']} of {buckets['p1']['errorLeafUses']} ({report['rates']['p1_notAnErrorMemberPct']}%)")
print(f"P2 destructuring slot>1 shadowed          {buckets['p2']['localReadAfterBinding']} of {buckets['p2']['publishedFileScopeRead']} published reads ({buckets['p2']['collidingSlots']} colliding of {buckets['p2']['nonFirstSlots']} slots)")
print(f"P3 method-call receiver read lost         {buckets['p3']['lostReads']} of {buckets['p3']['receiversNamingFileScopeValue']} ({report['rates']['p3_lostReadsPct']}%)  +{buckets['p3']['lostReadsOnAliasReceivers']} ambiguous")
print(f"P4 source vs enclosing scope              {buckets['p4']['globalSourceInsideNamedScope'] + buckets['p4']['namedSourceOutsideItself']} of {buckets['p4']['checked']} ({report['rates']['p4_mismatchPct']}%)  +{buckets['p4']['globalSourceInsideLocalScope']} Z59 fallback")
print(f"P5 symbols mapped to a node               {buckets['p5']['mappedToNode']} of {buckets['p5']['symbols']} (unmapped {buckets['p5']['unmapped']}, startIndex 0 {buckets['p5']['zeroStartIndex']})")
print(f"P6 instantiates target wrong kind         {buckets['p6']['targetBindsToNonContainer']} of {buckets['p6']['checked']} (unbound {buckets['p6']['targetBindsToNothing']})")
print(f"P7 contains owner does not declare member {buckets['p7']['ownerDeclaresNoSuchMember']} of {buckets['p7']['checked']} (owner unknown {buckets['p7']['ownerUnknown']})")
print(f"P8 exports target inside a container      {buckets['p8']['targetDeclaredInsideAContainer']} of {buckets['p8']['checked']} (not declared {buckets['p8']['targetNotDeclaredInFile']})")
print(f"P9 sites/edge  calls {report['rates']['p9_sitesPerCallsEdge']}  uses-field {report['rates']['p9_sitesPerUsesFieldEdge']}  uses-bare {report['rates']['p9_sitesPerBareReadEdge']}  declared-type {report['rates']['p9_sitesPerDeclaredTypeEdge']}  instantiates {report['rates']['p9_sitesPerInstantiatesEdge']}")
#!/usr/bin/env python3
"""Merge the sharded pass-2 adversarial audits into one report.

Same shape as shard-merge.py and for the same reason: the census must be run in
shards because cumulative WASM state in `parseFile` trips the engine's 120 s
self-destruct part-way through a 3,834-file single-process run. The counters are
additive and the per-arm finding lists are concatenated and capped, so the merge
is a sum plus a union — nothing is recomputed and nothing is dropped silently.

Usage: merge-pass2.py <sharddir> <out.json>
"""
import json
import os
import sys

sharddir, out = sys.argv[1], sys.argv[2]
N = 8
reports = []
for i in range(N):
    with open(os.path.join(sharddir, f"pass2-{i}.json")) as fh:
        reports.append(json.load(fh))

EXAMPLE_CAP = 40


def merge_counter(dst, src):
    for k, v in src.items():
        if isinstance(v, list):
            dst.setdefault(k, [])
            for x in v:
                if x not in dst[k] and len(dst[k]) < EXAMPLE_CAP:
                    dst[k].append(x)
        elif isinstance(v, dict):
            dst.setdefault(k, {})
            merge_counter(dst[k], v)
        else:
            dst[k] = dst.get(k, 0) + v


def merge_finding(dst, src):
    dst["n"] = dst.get("n", 0) + src["n"]
    for k, v in src.items():
        if k not in ("n", "pctOfDenominator", "examples") and isinstance(v, int):
            dst[k] = v
    for x in src.get("examples", []):
        if x not in dst["examples"] and len(dst["examples"]) < EXAMPLE_CAP:
            dst["examples"].append(x)


def merge_arm(dst, src):
    """Type-directed merge: counters sum, findings sum their `n` and union their
    examples, maps sum per key, lists union up to a cap, and a string keeps the
    first non-empty value (the per-shard string fields are single examples, and a
    concatenation of eight of them would read as one claim rather than eight)."""
    for k, v in src.items():
        if isinstance(v, list):
            dst.setdefault(k, [])
            for x in v:
                if x not in dst[k] and len(dst[k]) < EXAMPLE_CAP:
                    dst[k].append(x)
        elif isinstance(v, dict):
            if isinstance(dst.get(k), dict) and ("n" in v or "examples" in v):
                merge_finding(dst[k], v)
            else:
                dst.setdefault(k, {})
                merge_counter(dst[k], v)
        elif isinstance(v, bool) or isinstance(v, str) or v is None:
            if k not in dst or (dst[k] in ("", None) and v not in ("", None)):
                dst[k] = v
        else:
            dst[k] = dst.get(k, 0) + v


merged = {}
for rep in reports:
    for k, v in rep.items():
        if k in ("controls", "instrument", "productionEntryPoint", "treeEntryPoint",
                 "corpusRoot", "seed"):
            continue
        if k == "drawHash":
            # every shard is a SUBSET, so the per-shard draw hashes differ by
            # construction and summing them would be meaningless; the union is
            # named by the census merge instead.
            continue
        if isinstance(v, dict):
            if k not in merged:
                merged[k] = {}
            merge_arm(merged[k], v)
        elif isinstance(v, int):
            merged[k] = merged.get(k, 0) + v
        else:
            if k not in merged:
                merged[k] = v

# ── derived ratios are RECOMPUTED here, never summed.
#
# Each shard computed its own `pctOfDenominator` / `sitesPerEdge` /
# `ambiguousPct` against ITS OWN denominator, and summing eight of those
# produces a number with no denominator at all (the first version of this merge
# reported "3606% sites per edge" and "15.46% ambiguous exports", both of which
# are sums of eight percentages). The primitives are summed; the ratios are
# computed once, here, from the summed primitives.
def recompute(merged):
    def pct(a, b):
        return 0 if not b else round(a / b * 10000) / 100

    A2 = merged.get("A2_calls_name_is_called_on_its_line")
    if A2:
        for arm in ("targetAbsentFromTheLine", "noOccurrenceIsACall"):
            if arm in A2:
                A2[arm]["pctOfDenominator"] = pct(A2[arm]["n"], A2["edges"])
    A3 = merged.get("A3_uses_name_matches_its_reason_code")
    if A3:
        for arm in ("targetAbsentFromTheLine", "fieldAccessWithNoMemberOccurrence",
                    "bareReadWithNoBareOccurrence"):
            if arm in A3:
                A3[arm]["pctOfDenominator"] = pct(A3[arm]["n"], A3["edges"])
    A4 = merged.get("A4_instantiates_target_binds")
    if A4 and "unresolved" in A4:
        A4["unresolved"]["pctOfDenominator"] = pct(A4["unresolved"]["n"], A4["edges"])
    A5 = merged.get("A5_contains_owner_binds_uniquely")
    if A5:
        for arm in ("ownerUnresolved", "ownerAmbiguous"):
            if arm in A5:
                A5[arm]["pctOfDenominator"] = pct(A5[arm]["n"], A5["edges"])
    A6 = merged.get("A6_exports_target_binds_to_a_public_symbol")
    if A6:
        for arm in ("unresolved", "notPublic"):
            if arm in A6:
                A6[arm]["pctOfDenominator"] = pct(A6[arm]["n"], A6["edges"])
        A6["ambiguousPct"] = pct(A6["ambiguous"], A6["edges"])
    A7 = merged.get("A7_references_declared_type")
    if A7:
        A7["sitesPerEdge"] = pct(A7["treeTypeSites"], A7["edges"])
        if "targetNamedAtNoTypeSite" in A7:
            A7["targetNamedAtNoTypeSite"]["pctOfDenominator"] = pct(
                A7["targetNamedAtNoTypeSite"]["n"], A7["edges"])
    A9 = merged.get("A9_source_identity")
    if A9:
        for arm, den in (("callsSourceNotCallable", "callsWithNamedSource"),
                         ("usesSourceNotCallable", "usesWithNamedSource"),
                         ("ofWhichItIsNot", None)):
            if arm in A9:
                base = A9[den] if den else (A9["callsWithNamedSource"] + A9["usesWithNamedSource"])
                A9[arm]["pctOfDenominator"] = pct(A9[arm]["n"], base)
    A11 = merged.get("A11_payload_subtree_identifiers")
    if A11 and "thatShadowAFileScopeValue" in A11:
        A11["thatShadowAFileScopeValue"]["pctOfDenominator"] = pct(
            A11["thatShadowAFileScopeValue"]["n"], A11["identifiersUnderPayloads"])


# `max*` fields are a MAXIMUM across shards, not a sum.
merged["A7_references_declared_type"]["maxSitesOnOneEdge"] = max(
    r["A7_references_declared_type"]["maxSitesOnOneEdge"] for r in reports)
merged["A7_references_declared_type"]["maxSitesExample"] = max(
    (r["A7_references_declared_type"] for r in reports),
    key=lambda r: r["maxSitesOnOneEdge"])["maxSitesExample"]
recompute(merged)

ctl_total = sum(r["controls"]["total"] for r in reports)
ctl_failed = sum(r["controls"]["failed"] for r in reports)
# Controls are per-shard and each shard ran the SAME control set, so the honest
# merged figure is "42 distinct controls, each run 8 times, 0 failures" — not 336.
distinct = {}
for r in reports:
    for row in r["controls"]["rows"]:
        distinct[row["name"]] = (row["want"], row["got"])

merged["shards"] = N
merged["controls"] = {
    "distinctControls": len(distinct),
    "runsPerShard": len(reports),
    "distinctFailed": sum(1 for v in distinct.values() if v[0] != v[1]),
    "rows": [{"name": k, "want": v[0], "got": v[1]} for k, v in sorted(distinct.items())],
}

with open(out, "w") as fh:
    json.dump(merged, fh, indent=2)
    fh.write("\n")
print(f"wrote {out}")
print(f"files {merged['filesParsed']}  symbols {merged['symbols']}  relationships {merged['relationships']}")
print(f"controls: {len(distinct)} distinct, {merged['controls']['distinctFailed']} failing")
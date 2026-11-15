#!/usr/bin/env python3
"""Side-by-side of two #612 containment sweeps (before / after a store change).

Every gauge that decides the containment rule is printed per repo, with both runs'
values and the delta, so the report can cite movement instead of asserting it.
Gauges that must NOT move (index counts, edge totals) are printed too — a rule that
quietly changes how many edges exist is a different defect wearing this one's coat.

Run: python3 script/m14/tmp/containment-compare-612.py <before.json> <after.json>
"""
import json
import sys

GROUPS = [
    ("target half — contains-line-hint-612", "contains-line-hint-612", [
        ("containsEdgesTotal", "edges"),
        ("containsTargetInAnotherFile", "target in ANOTHER file (must be 0)"),
        ("ambiguousTargetName", "target name not unique"),
        ("ambiguousHintPinsExactlyOne", "line pins exactly one"),
        ("ambiguousHintPinsNone", "line pins none (residual)"),
        ("ambiguousOldChoiceWouldBeWrong", "old tiebreak would be wrong"),
    ]),
    ("source half — contains-source-hint-612", "contains-source-hint-612", [
        ("edgesWithLine", "edges carrying a line"),
        ("ambiguousSource", "source name not unique"),
        ("spanPinsExactlyOne", "one candidate covers the child line"),
        ("spanPinsNone", "none covers it (residual by construction)"),
        ("spanPinsSeveral", "several cover it (innermost decides)"),
    ]),
    ("source half — contains-source-span-delta-612", "contains-source-span-delta-612", [
        ("storedSourceDoesNotEncloseChildLine", "stored source CONTRADICTS the enclosure"),
        ("ambiguousSourceDoesNotEncloseChildLine", "  ... name ambiguous"),
        ("ambiguousWithSpanCandidate", "  ... and a covering candidate exists"),
        ("spanCandidateDiffersFromStoredSource", "stored is not the covering candidate"),
        ("spanCandidateDiffersAndIsContainerLike", "  ... covering candidate is container-like"),
        ("spanCandidateDiffersAndCurrentIsNotContainerLike", "  ... stored one is not"),
    ]),
]


def load(path):
    doc = json.loads(open(path).read())
    return doc, {rec["repo"]: rec for rec in doc["repos"]}


def gauge(rec, probe, key):
    r = rec["probes"].get(probe, {}).get("result")
    if r is None:
        return None
    if isinstance(r, list):
        return len(r)
    return r.get(key)


def cell(b, a):
    if b is None and a is None:
        return "-"
    if b == a:
        return str(b)
    return f"{b} -> {a}"


def main():
    before_doc, before = load(sys.argv[1])
    after_doc, after = load(sys.argv[2])
    print(f"before: {before_doc['commit'][:8]} indexer {before_doc['indexerSha256'][:12]} dirty={before_doc.get('sourceDirtyVsCommit')}")
    print(f"after : {after_doc['commit'][:8]} indexer {after_doc['indexerSha256'][:12]} dirty={after_doc.get('sourceDirtyVsCommit')}")
    repos = list(before.keys())
    for title, probe, specs in GROUPS:
        print(f"\n=== {title} ===")
        print(f"{'repo':<15}{'lang':<6}" + "".join(f"{label[:24]:>26}" for _, label in specs))
        for repo in repos:
            row = f"{repo:<15}{before[repo]['lang']:<6}"
            for key, _ in specs:
                row += f"{cell(gauge(before[repo], probe, key), gauge(after.get(repo, {}), probe, key)):>26}"
            print(row)
    print("\n=== residual list length (target half, must be 0) ===")
    for repo in repos:
        b = before[repo]["probes"].get("contains-residual-612", {}).get("result")
        a = after.get(repo, {}).get("probes", {}).get("contains-residual-612", {}).get("result")
        print(f"  {repo:<15}{len(b) if isinstance(b, list) else '?':>6} -> {len(a) if isinstance(a, list) else '?'}")
    print("\n=== index counts (same tree, same files => must match) ===")
    for repo in repos:
        b = before[repo]["index"].get("indexed")
        a = after.get(repo, {}).get("index", {}).get("indexed")
        print(f"  {repo:<15}{'same ' if b == a else 'DIFFERENT'}{b}  {'' if b == a else a}")


if __name__ == "__main__":
    main()

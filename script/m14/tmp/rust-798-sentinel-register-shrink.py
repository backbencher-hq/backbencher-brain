#!/usr/bin/env python3
"""R7 paydown: remove rust's registered placeholder site and record the shrink.

Mirrors the python lane's entry precedent (proven unreachable rather than fixed
blind): rust's `"unknown"` parameter-name fallback could never fire — the only
arm that reached it was the self_parameter case, and a self_parameter node IS
its own fallback, so `pName` was always truthy. The honest state is ABSENCE, so
the branch is gone and the census shrank 61 -> 60 occurrences, 47 -> 46
violations. Measured unchanged on real code: 3,633 parameters over ripgrep's 110
files and 9,444 over cargo's 1,371 (script/m14/tmp/rust-002-param-names.ts).
"""
import json

P = "validation/m60/symbol-sentinel-register.json"
d = json.load(open(P))

before = list(d["entries"])
kept = [e for e in before if e.get("lang") != "rust"]
removed = [e for e in before if e.get("lang") == "rust"]
assert len(removed) == 1, removed
assert removed[0]["count"] == 1, removed[0]
d["entries"] = kept
d["counts"] = {"entries": len(kept), "violations": sum(e.get("count", 0) for e in kept if e.get("verdict") == "violation")}
d.setdefault("shrunkBy", []).append({
    "at": "2026-09-24",
    "wave": "rust lane, R7 paydown (#798)",
    "removed": ["real-rust-analyzer.ts ternary-branch.name x1"],
    "violationsBefore": 47,
    "violationsAfter": d["counts"]["violations"],
    "evidence": (
        "PROVEN UNREACHABLE then replaced by ABSENCE. The branch was "
        "`pName ? … : (p.type === \"self_parameter\" ? \"self\" : \"unknown\")`, and the "
        "self_parameter arm is itself unreachable too: when p.type is self_parameter, "
        "pName is the self_parameter NODE (its own fallback), so the ternary always took "
        "the first arm. The site is now `if (name) params.push({ name, … })` — a parameter "
        "with no pattern (an ERROR-recovered heading) contributes no row rather than a row "
        "no file contains. Behaviour measured unchanged rather than assumed: "
        "script/m14/tmp/rust-002-param-names.ts reads 3,633 parameters over ripgrep's 110 "
        "files and 9,444 over cargo's 1,371 before and after (unknownName 0, blankName 0, "
        "sites []). No fixture can reach the absence path and no mutant can inject it, so "
        "the probe plus the unchanged counts ARE the evidence — the same treatment the "
        "python lane's unreachable marker got. Census after: 60 occurrences / 46 "
        "violations, rust absent from the artifact entirely."
    ),
})
json.dump(d, open(P, "w"), indent=2)
open(P, "a").write("\n")
print(f"R7 register: entries {len(before)} -> {len(kept)}, violations 47 -> {d['counts']['violations']}, rust removed")

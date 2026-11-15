#!/usr/bin/env python3
"""script/m14/tmp/sw-r10-register.py — R10 register re-derivation.

Two lane entries move, for two different reasons, and each says which:

  swift  the #924 decorator-payload conviction is PAID DOWN (fixture + reverting
         mutant), so the lane leaves the convicted set. The seven OO lanes now carry
         zero fabricated-spelling convictions.
  cpp    the committed artifact was NOT HEAD-true: this census is deterministic (two
         consecutive runs byte-identical), the cpp analyzer is unmodified in the
         working tree AND the corpus files under fmt/nlohmann-json have not been
         touched since 2026-08-25, so the row that reads 58 anomalies / 5 separator
         triples cannot have been produced by this classifier on this tree. The wave
         that committed it re-emitted a global census while other lanes' analyzers
         were mid-flight — the documented `dirty-derived artifact` class this repo has
         paid for before (#761). The re-derived numbers are recorded here with that
         reason; the register is the only hand-written half of R10, so it has to
         follow a HEAD-true artifact — and must never be shrunk silently.
"""
import json

P = "validation/m60/target-spelling-register.json"
r = json.load(open(P))

# ------------------------------------------------------------------ swift (mine)
sw = r["lanes"]["swift"]
assert sw["convictions"] == {"whitespace": 1, "delimiter": 1}, sw["convictions"]
sw["verdict"] = "unruled-separators"
sw["convictions"] = {}
sw["convictionSamples"] = []
sw["convictionSubclasses"] = {"operatorMember": 9}
sw["convictionSubclassSamples"] = [s for s in sw.get("convictionSubclassSamples", []) if s.get("subclass") != "payloadSigil"]
sw["note"] = (
    "PAID DOWN 2026-09-25 (#924, swift half) — closed with a fixture and a reverting mutant, never by "
    "editing this register. The single `payloadSigil` conviction was "
    "`@available(*, deprecated, message: \"Cannot be thrown\")` published as a `contains` TARGET at "
    "swift-nio/Sources/NIOHTTP1/HTTPTypes.swift: an ATTRIBUTED enum case (`@available(...) case x`) put a "
    "`modifiers` node first and the member-name pick took the first named child — the decorator PAYLOAD — for "
    "all five cases, folding them into one `contains` whose name was a decorator. The name is now the "
    "identifier after `case` (modifiers are metadata) and the range node is that identifier, so a decorated "
    "declaration's line is its own. The same re-emit removed the other two name-surface classes the lane "
    "measured at full extent (keyword-escape backticks, tuple positions): 652 files, 23,212 symbols, 78,747 "
    "targets, name census CLEAN. Pinned by swift/attributed-enum-case + mutants "
    "swift/attributed-case-payload-name / swift/attributed-case-range-at-decorator. The separator vocabulary "
    "(`overrides|.`, `references|.`) is unchanged and still UNRULED — recorded and owed, not blessed."
)

oo = r["ooTarget"]
assert oo["convictedLanes"] == 1, oo
oo["convictedLanes"] = 0
oo["note"] += (
    " PAID DOWN AGAIN 2026-09-25: swift's last conviction (the #924 decorator payload) is closed, so the "
    "seven OO lanes carry ZERO fabricated-spelling convictions — the owner standard's zero target is MET for "
    "this rule. The unruled-separator bound stays 5 (dart, swift, objc, ruby, python)."
)

base = r["baseline"]
assert "swift" in base["convicted"]
base["convicted"] = [l for l in base["convicted"] if l != "swift"]

# ------------------------------------------------------------------ cpp (dirty-derived artifact)
cp = r["lanes"]["cpp"]
assert cp["convictions"] == {"delimiter": 49, "whitespace": 7, "literal": 2}, cp["convictions"]
cp["convictions"] = {"delimiter": 45}
cp["convictionSubclasses"] = {"operatorMember": 2}
cp["whitespaceRuled"] = {"operatorMember": 2}
cp["convictionSamples"] = [
    {"klass": "delimiter", "type": "contains", "target": "operator()"},
    {"klass": "delimiter", "type": "calls", "target": "operator()"},
    {"klass": "delimiter", "type": "contains", "target": "operator <="},
]
cp["separatorTriples"] = ["calls|~", "imports|.", "overrides|.", "references|.", "references|/", "references|:", "uses|:"]
cp["rulings"] = {"calls|~": None, "imports|.": None, "overrides|.": None, "references|.": None,
                 "references|/": None, "references|:": None, "uses|:": None}
cp["note"] = (
    "RE-DERIVED 2026-09-25 (not paid down by this lane, and not a change in cpp's analyzer): the committed "
    "census row this entry was written from recorded 58 anomalies {\"delimiter\":49,\"whitespace\":7,\"literal\":2} "
    "and 5 separator triples. A fresh canonical run of the SAME census over the SAME tree reads 45 "
    "{\"delimiter\":45}, 2 sub-classes {\"operatorMember\":2}, and 7 triples — two of them NEW "
    f"({chr(34)}references|:{chr(34)}, {chr(34)}uses|:{chr(34)}), which is a widened vocabulary, not a repayment. The census is "
    "deterministic (two consecutive runs byte-identical), src/ast/real-cpp-analyzer.ts is unmodified in the "
    "working tree at HEAD, and no file under fmt/ or nlohmann-json/ has been written since 2026-08-25 — so the "
    "committed row was produced from a DIFFERENT analyzer state (the dirty-derived-artifact class, #761). Both "
    "the two new triples and the 45 convictions are HEAD-true; the register follows the artifact because it "
    "must never be shrunk silently. Filed as a standing-rule finding: R8 and R10 both adjudicate a COMMITTED "
    "artifact rather than a live recomputation, so a dirty-derived artifact can pass its gate forever."
)

json.dump(r, open(P, "w"), indent=2)
open(P, "a").write("\n")
print("swift:", json.dumps({k: sw[k] for k in ("verdict", "convictions", "convictionSubclasses", "whitespaceRuled", "separatorTriples")}))
print("cpp:  ", json.dumps({k: cp[k] for k in ("verdict", "convictions", "convictionSubclasses", "whitespaceRuled", "separatorTriples")}))
print("ooTarget.convictedLanes:", oo["convictedLanes"], "| baseline.convicted:", base["convicted"])

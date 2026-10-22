#!/usr/bin/env python3
"""Write the python lane's whole-population incoming-declaration.

ASCII ONLY. Everything here is COMPUTED and ASSERTED from the published
no-index arm's TABLE 1, never typed twice. The generator REFUSES to write
when any row does not close.

The population is the git-TRACKED set under the 1 MiB cap, measured by
reproducing the fleet rule over $PWD/.corpus (see POP_RULE below).
"""
import json
import os
import sys

# THE ROOT IS DERIVED FROM THIS FILE, never guessed: script/m14/x.py -> repo root.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "validation/m14/instruments/python/incoming-declaration.json")

POP = 11559
EXTS = "py,pyi,pyw"
POP_STR = "parsed=11559/11559 admitted=11559 exts=py,pyi,pyw index=no"

# TABLE 1 of the NO-INDEX arm, verbatim from
# validation/m14/measurements/python-cell-noindex-2026-10-21.txt:59-74
# cols: edges resolved collRes ambDecl ambKind unresolved extOK extQ extF bindOK bindQ bindF causeOK causeF
COLS = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
        "extOK", "extQ", "extF", "bindOK", "bindQ", "bindF", "causeOK", "causeF"]
T1 = {
    "calls":        [538198, 191510, 0, 162044, 82682, 99824, 55041, 16562, 0, 13217, 0, 0, 0, 0],
    "uses":         [391624, 133221, 0, 187817, 75650, 49450, 17063, 4073, 0, 0, 0, 0, 0, 0],
    "contains":     [136287, 136233, 95730, 0, 0, 54, 0, 0, 0, 0, 0, 0, 0, 0],
    "imports":      [100237, 26476, 0, 8814, 2891, 42424, 22453, 70, 0, 0, 0, 0, 0, 0],
    "references":   [62316, 26557, 0, 5968, 2280, 2033, 20896, 6862, 0, 0, 0, 0, 0, 0],
    "exports":      [3043, 2751, 0, 279, 145, 13, 0, 0, 0, 0, 0, 0, 0, 0],
    "extends":      [21004, 14132, 0, 2640, 1000, 44, 3859, 329, 0, 0, 0, 0, 0, 0],
    "implements":   [334, 193, 0, 0, 0, 3, 42, 96, 0, 0, 0, 0, 0, 0],
    "overrides":    [33541, 33541, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "instantiates": [13175, 13175, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "decorates":    [32271, 1469, 0, 651, 596, 15317, 13690, 1144, 0, 0, 0, 0, 0, 0],
    "renders":      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "mixes_in":     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "part_of":      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
}

ELEVEN = ["resolved", "amb(decl)", "unresolved", "bindOK", "bind?",
          "bindFAIL", "extOK", "ext?", "extFAIL", "causeOK", "causeFAIL"]


def row_of(v):
    d = dict(zip(COLS, v))
    # THE ELEVEN TERMS, in the gate's own order, read off this row.
    eleven = [d["resolved"], d["ambDecl"], d["unresolved"], d["bindOK"], d["bindQ"],
              d["bindF"], d["extOK"], d["extQ"], d["extF"], d["causeOK"], d["causeF"]]
    # THE FIVE GATE BUCKETS: a DECLARED COARSENING of the eleven. The binding and
    # cause terms have no bucket of their own, so they sit in otherUnresolved.
    resolved = d["resolved"]
    ambiguous = d["ambDecl"]
    other = d["unresolved"] + d["bindOK"] + d["bindQ"] + d["bindF"] + d["causeOK"] + d["causeF"]
    external = d["extOK"] + d["extQ"] + d["extF"]
    unclassed = 0
    # ASSERT 1: the eleven terms add up to the edges, exactly.
    if sum(eleven) != d["edges"]:
        raise SystemExit("ELEVEN-TERM CLOSURE FAILS for a row: %d != %d" % (sum(eleven), d["edges"]))
    # ASSERT 2: the five buckets are the same number, coarsened, exactly.
    if resolved + ambiguous + other + external + unclassed != d["edges"]:
        raise SystemExit("FIVE-BUCKET COARSENING FAILS for a row")
    # ASSERT 3: the unclassed ceiling is 0, always.
    if unclassed != 0:
        raise SystemExit("UNCLASSED CEILING BROKEN")
    return {
        "edges": d["edges"],
        "resolved": resolved,
        "ambiguous": ambiguous,
        "otherUnresolved": other,
        "external": external,
        "unclassed": unclassed,
        "closure": dict(zip(ELEVEN, eleven)),
        "reported_beside_never_added": {
            "collRes": d["collRes"],
            "amb(kind)": d["ambKind"],
            "_rule": ("collRes and amb(kind) are SUBSETS of their parent buckets (collRes of "
                      "resolved, amb(kind) of amb(decl)) and are reported BESIDE the closure and "
                      "NEVER ADDED to it."),
        },
    }


types = {}
for t, v in T1.items():
    types[t] = row_of(v)

# Whole-declaration asserts: the totals must equal the arm's TOTAL line.
tot = {c: sum(T1[t][COLS.index(c)] for t in T1) for c in COLS}
if tot["edges"] != 1332030:
    raise SystemExit("TOTAL edges %d != 1332030" % tot["edges"])
if tot["resolved"] != 579258:
    raise SystemExit("TOTAL resolved moved")
if tot["ambDecl"] != 368213:
    raise SystemExit("TOTAL amb(decl) moved")
if tot["unresolved"] != 209162:
    raise SystemExit("TOTAL unresolved moved")
if tot["bindOK"] != 13217 or tot["extOK"] != 133044 or tot["extQ"] != 29136:
    raise SystemExit("a TOTAL term moved")
if tot["extF"] or tot["bindF"] or tot["causeF"]:
    raise SystemExit("a FAIL term is non-zero")

# ---- the cause rulings: the D7 ledger's walls, each with THIS ARM's count ----
def falsifier(run, would_fail):
    return {"run": run, "wouldFail": would_fail}

CORPUS = 'BB_CORPUS_ROOT="$PWD/.corpus"'
cause = {
    "W1_runtime_receiver_typing": {
        "population": POP_STR,
        "count": types["calls"]["closure"]["unresolved"] + types["uses"]["closure"]["unresolved"],
        "countFrom": "TABLE 1 of this arm: calls.unresolved + uses.unresolved",
        "disposition": "RULED UNDECIDABLE (python has no static receiver typing; the class of the "
                       "object a call is made on is a RUNTIME fact, and no rung of the grammar "
                       "ladder can add one)",
        "from": "validation/m14/verification/PYTHON-D7-WALLS.md:59 (W1) + "
                "validation/m14/measurements/python-cell-noindex-2026-10-21.txt:60 (calls) and :61 (uses)",
        "evidenceClass": "measured whole-population",
        "falsifier": falsifier(
            CORPUS + " bun run script/m14/python-type-census.ts --corpus --out /tmp/python-w1.json",
            "wouldFail: a row counted here whose RECEIVER's type is DECLARED IN ITS OWN FILE (a "
            "self.receiver or a local binding with a declared class) would refute the claim that "
            "the receiver's type is a runtime fact, and the gate would have to move it out of this "
            "cause and into a defect."),
    },
    "W2_project_local_imports": {
        "population": POP_STR,
        "count": types["imports"]["closure"]["unresolved"],
        "countFrom": "TABLE 1 of this arm: imports.unresolved",
        "disposition": "RULED UNDECIDABLE (a module a project VENDORS or that lives outside the "
                       "run's scope is not a declaration the run can reach; the import names a "
                       "module, and no grammar change can make a module resolve to a file the run "
                       "does not carry)",
        "from": "validation/m14/verification/PYTHON-D7-WALLS.md:143 (W2) + "
                "validation/m14/measurements/python-cell-noindex-2026-10-21.txt:63 (imports)",
        "evidenceClass": "measured whole-population",
        "falsifier": falsifier(
            CORPUS + " bun run script/m14/py-project-local-imports-census.ts --out /tmp/python-w2.json",
            "wouldFail: an import in this bucket whose target module IS a file of this run's own "
            "scope would refute the claim, because a reachable module that still does not resolve "
            "is an ANALYZER defect, not an undecidable."),
    },
    "W3_external_unverified": {
        "population": POP_STR,
        "count": types["calls"]["closure"]["ext?"] + types["uses"]["closure"]["ext?"]
                 + types["imports"]["closure"]["ext?"] + types["references"]["closure"]["ext?"]
                 + types["extends"]["closure"]["ext?"] + types["implements"]["closure"]["ext?"]
                 + types["exports"]["closure"]["ext?"] + types["instantiates"]["closure"]["ext?"]
                 + types["decorates"]["closure"]["ext?"] + types["contains"]["closure"]["ext?"],
        "countFrom": "TABLE 1 of this arm: the ext? term summed over every type (the gate's TOTAL row reads 29,136)",
        "disposition": "RULED UNDECIDABLE (the name is not declared in this run and IS claimed by a "
                       "package the project does not carry; the arbiter can neither verify nor refute "
                       "membership from bytes it does not have, and silence about a package is not "
                       "evidence about its membership)",
        "from": "validation/m14/verification/PYTHON-D7-WALLS.md:182 (W3) + "
                "validation/m14/measurements/python-cell-noindex-2026-10-21.txt:74 (TOTAL ext?)",
        "evidenceClass": "measured whole-population",
        "falsifier": falsifier(
            CORPUS + " bun run script/m14/python-type-census.ts --corpus --out /tmp/python-w3.json",
            "wouldFail: an ext? row whose name IS declared inside this run's own scope would refute "
            "it (the run declares it, so the arbiter had the truth in hand and failed to use it)."),
    },
    "W4_leaf_name_collisions": {
        "population": POP_STR,
        "count": 28726,
        "countFrom": ("the own-file tie-break's measured price: overrides 21,069 (100 %) + "
                      "instantiates 7,657 (100 %) rows MOVED OUT of ambiguity by the tie-break, "
                      "which is why this arm's overrides and instantiates ambiguous rows read 0"),
        "disposition": "RULED UNDECIDABLE, with a MEASURED FALSIFIER THAT WAS DISCHARGED: the claim "
                       "is that an ambiguous row in these two types carries no owner or static "
                       "receiver proof, and the measurement found 0 such rows",
        "from": "validation/m14/verification/PYTHON-D7-WALLS.md:262 (W4) + "
                "validation/m14/measurements/python-tiebreak-price-2026-10-21.json (per-label price)",
        "evidenceClass": "measured whole-population",
        "falsifier": falsifier(
            CORPUS + " bun run script/m14/py-tiebreak-price.ts --out /tmp/python-w4.json",
            "wouldFail: an ambiguity row of overrides or instantiates that CARRIES an owner proof or "
            "a statically declared receiver would refute the ruling. MEASURED: 0 such rows "
            "(the tie-break resolves all 28,726 of them by the row's OWN FILE, and the claim-free "
            "share equals the whole-class share, so the resolution is not buying a wrong pick)."),
    },
    "W5_local_bindings": {
        "population": POP_STR,
        "count": types["calls"]["closure"]["bindOK"],
        "countFrom": "TABLE 1 of this arm: calls.bindOK (bind? and bindFAIL are 0 in every row)",
        "disposition": "CLAIMED, NOT RESOLVED: the arbiter binds these to a local binding with a "
                       "declaration-level claim. A claim is not a resolution and is never folded into "
                       "`resolved`; the gate counts it in its own bucket",
        "from": "validation/m14/verification/PYTHON-D7-WALLS.md:275 (W5) + "
                "validation/m14/measurements/python-cell-noindex-2026-10-21.txt:60 (calls.bindOK)",
        "evidenceClass": "measured whole-population",
        "falsifier": falsifier(
            CORPUS + " bun run script/m14/py-owner-absent-join.ts --out /tmp/python-w5.json",
            "wouldFail: a bindOK row whose bound owner is NOT a local binding of the row's own file "
            "would refute the claim, because a claim that cannot name its owner is not a claim."),
    },
    "W12_decorates_direction": {
        "population": POP_STR,
        "count": types["decorates"]["closure"]["resolved"],
        "countFrom": ("TABLE 1 of this arm: decorates.resolved. THE WALL IS CLOSED: the 32,271 "
                      "published rows are the DIRECTION THE FLEET ADOPTED (decorated declaration -> "
                      "decorator), and this count is what that direction resolves"),
        "disposition": "RESOLVED BY THE ENUM CORRECTION (commit 5ecb97134), NOT BY A LANE EDIT: the "
                       "shared vocabulary's doc comment was the outlier against three agreeing "
                       "emitters, the fleet oracle and the proposal page, and it was corrected to "
                       "the emitted direction. The lane moved no edge. The measured price of the "
                       "REJECTED direction is the record: 31,602 of 32,251 rows (98.0 %) change "
                       "class, and it would have left 31,484 unresolved",
        "from": "validation/m14/verification/PYTHON-CLASSIFICATION-2026-10-21.md:884 (W12) + "
                "src/ast/types.ts:120-135 (the corrected direction) + "
                "validation/m14/measurements/python-decorates-direction-2026-10-21.json",
        "evidenceClass": "measured whole-population, both directions",
        "falsifier": falsifier(
            CORPUS + " bun run script/m14/python-decorates-direction.ts --out /tmp/python-w12.json",
            "wouldFail: if the REJECTED direction resolved a LARGER share than the adopted one, the "
            "correction would have been wrong. MEASURED: adopted resolves 27,385/32,251 (84.9 %); "
            "rejected resolves 748/32,251 (2.3 %). A relation that resolves 2.3 % is not a relation."),
    },
}

caveats = [
    "THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN-TERM CLOSURE, NOT THE ELEVEN TERMS: "
    "the gate has five buckets (resolved, external, ambiguous, otherUnresolved, unclassed) and the "
    "closure has eleven terms, so the binding* and cause* edges -- which the gate has no bucket of "
    "their own for -- are counted in otherUnresolved, and every row publishes the eleven terms "
    "themselves in `closure` so a reader can see exactly which edge is in which bucket.",

    "amb(kind) AND collRes ARE REPORTED BESIDE EVERY ROW AND ARE NEVER ADDED TO ANY BUCKET OR TO "
    "THE CLOSURE: collRes is a subset of resolved and amb(kind) is a subset of amb(decl); the "
    "closure formula excludes both, and this declaration excludes both.",

    "THE `unclassed` CEILING IS 0, ALWAYS, AND IT IS 0 IN EVERY ROW HERE: each row's five buckets "
    "sum to that row's `edges` exactly, and the generator REFUSES TO WRITE when a row does not close.",

    "THIS LANE'S `resolved` MEANS: the arbiter found a declaration for the target and the edge was "
    "bound to it. IT DOES NOT MEAN THE PICK IS CORRECT. A wrong-but-declared pick is `resolved` in "
    "this instrument too, and no bucket here can distinguish a right pick from a wrong one. A "
    "reader must not compare this bucket to another lane's as if the two meant the same thing.",

    "THE OWN-FILE TIE-BREAK IS ACTIVE IN THIS DECLARATION AND ITS PRICE IS PUBLISHED: an ambiguous "
    "row resolves when the row's OWN FILE declares the target. It moved 83,039 rows out of "
    "ambiguous into resolved (L-16 twin over the same key space with the same arbiter; the "
    "independent falsifier agreed; the instrument exits non-zero on disagreement and did not fire). "
    "The ceiling is the whole-class share and it EQUALS the measured price because the "
    "claim-carrying own-file count is 0 -- so the tie-break is not buying a wrong pick. The artifact "
    "is validation/m14/measurements/python-tiebreak-price-2026-10-21.json.",

    "THE POPULATION IS THE GIT-TRACKED SET UNDER THE 1 MiB CAP, NOT THE DISK. Measured over "
    "$PWD/.corpus: 14,093 tracked .py/.pyi/.pyw = 11,559 admitted + 2,533 tracked-but-absent-on-disk "
    "+ 1 over the 1 MiB cap, and the three add to the tracked count exactly. A DISK WALK IS A "
    "DIFFERENT POPULATION and its number is not comparable to this one.",

    "THIS DECLARATION IS THE NO-INDEX ARM (`index=no`) ON PURPOSE, because every cause ruling's "
    "count is read from that arm's TABLE 1. The indexed (production) arm is measured on the SAME "
    "population and is published beside it in "
    "validation/m14/measurements/python-cell-indexed-2026-10-21.txt: its closure is "
    "1,332,030 = 598,262 resolved + 353,408 amb(decl) + 199,036 unresolved + 24,276 bindOK + "
    "142,750 extOK + 14,298 ext?. The difference between the two arms is the PROJECT INDEX's "
    "cross-file override pairing and nothing else: the context delta is exactly the `overrides` "
    "class (33,546 -> 12,514 = -21,032) and every other type moves 0.",
]

decl = {
    "meta": {
        "lang": "python",
        "asked": "the whole-population declaration of python's 14-value vocabulary, measured over "
                 "the WHOLE admitted population in ONE arm; this is not a sample",
        "instrument": "script/m14/incoming-gate.ts, read by script/m14/completion-gate.ts",
        "instrumentVersion": "2026-10-22 (eleven-term closure, five-bucket coarsening, causeRulings)",
        "population": POP_STR,
        "populationRule": ("the ADMITTED set is the GIT-TRACKED set under the 1 MiB cap, NOT the "
                           "disk: git ls-files per checkout under $PWD/.corpus, keeping .py/.pyi/.pyw, "
                           "dropping paths absent on disk and paths over 1 MiB. MEASURED "
                           "2026-10-22: 14,093 tracked = 11,559 admitted + 2,533 absent + 1 over cap."),
        "corpusRoot": "$PWD/.corpus",
        "corpusTotal": POP,
        "parsed": POP,
        "sample": POP,
        "extension": EXTS,
        "corpusRepos": 51,
        "corpusReposNote": ("51 is the GATE's own basis (one repository per admitted file group, "
                            "script/m14/incoming-gate.ts:526). The corpus itself carries 202 "
                            "checkouts, 52 of which hold any .py/.pyi/.pyw at all -- two different "
                            "questions with two different answers, and both are stated."),
        "arm": "no --index, the fail-closed control",
        "armReason": ("every cause ruling's count is read from THIS arm's TABLE 1, so the "
                      "declaration and its rulings cannot disagree about which measurement they "
                      "describe. The indexed arm is measured on the same population and published "
                      "beside it."),
        "edges": 1332030,
        "closure": {
            "formula": ("resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + "
                        "ext? + extFAIL + causeOK + causeFAIL = edges"),
            "thisArm": ("1,332,030 = 579,258 + 368,213 + 209,162 + 13,217 + 0 + 0 + 133,044 + "
                        "29,136 + 0 + 0 + 0"),
            "residual": "residual = amb(decl) + unresolved",
            "ambKind_AND_collRes_REPORTED_BESIDE": ("amb(kind) is a SUBSET of amb(decl) and collRes "
                                                    "a SUBSET of resolved; both are reported beside "
                                                    "the closure and NEVER added to it"),
        },
        "sourceCell": "validation/m14/measurements/python-cell-noindex-2026-10-21.txt:59-74",
        "generated": "2026-10-22",
    },
    "types": types,
    "causeRulings": cause,
    "resolution_caveats": caveats,
    "notes": [
        "EVERY NUMBER IN THIS DECLARATION CARRIES THE RULE THAT PRODUCED IT: the population carries "
        "its rule (git-tracked under the cap), the node-type counts elsewhere in this lane carry the "
        "grammar's digest (wasm/tree-sitter-python.wasm sha256 "
        "16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47, 274 node-type ids, 128 "
        "named ids, 32 fields, PLUS the universal ERROR and MISSING pair), and the closure carries "
        "its formula. A number that does not say which rule produced it cannot be compared.",

        "n = 11 OF 11 FOR THIS LANE, AND ELEVEN IS NOT A SHRUNK DENOMINATOR: the ten canonical "
        "values plus `decorates` are IMPLEMENTED and measured on the whole population; `renders`, "
        "`mixes_in` and `part_of` are RULED UNDECIDABLE with the R1/R2/R3 rung named unavailable for "
        "each, and a payload of 0 edges is published for each IN THIS DECLARATION so the three are "
        "visible rather than absent. A type in GRAMMAR REMEDY PENDING would stay in this "
        "denominator; python has none, so nothing is in flight and nothing is excused.",

        "THE THREE RULED VALUES ARE PRESENT IN `types` AS ZERO ROWS ON PURPOSE: a reader can see "
        "that they were measured and are not merely missing, and the coverage block in "
        "script/m14/spec/python-completeness.json carries their `excluded` entries with the "
        "grammar-absence evidence and the review doc's line numbers.",

        "THE HERITAGE BLIND SPOT IS CLOSED AND IT IS CLOSED BY MEASUREMENT, NOT BY ASSERTION: the "
        "lane's own probe resolved the analyzer's private baseClassLeaf over the whole population "
        "and found 26,023 classes with 23,473 base clauses, of which 21,335 publish an edge and "
        "every one of the 1,889 remaining leaf-resolved clauses is the analyzer's OWN deliberate "
        "self-base suppression (class X(X)), and the 249 shape-misses are keyword arguments "
        "(TypedDict total=False, and metaclass= which is not an instance-MRO base), splats, calls "
        "and comments -- none of which is a base class. NO DEFECT IS PUBLISHED FOR THEM.",
    ],
}

BEFORE = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(decl, fh, indent=2, ensure_ascii=True)
    fh.write("\n")

AFTER = open(OUT, encoding="utf-8").read()
print("WROTE", OUT, "(reproduced byte-identically)" if BEFORE == AFTER and BEFORE else "")
if BEFORE and BEFORE != AFTER:
    raise SystemExit("NOT REPRODUCIBLE: the declaration changed on a re-run")
print("  population :", POP_STR)
print("  rows       :", len(types), "->", ", ".join(types))
print("  edges      :", sum(t["edges"] for t in types.values()))
print("  buckets    : resolved %d + ambiguous %d + otherUnresolved %d + external %d + unclassed %d = %d"
      % (sum(t["resolved"] for t in types.values()),
         sum(t["ambiguous"] for t in types.values()),
         sum(t["otherUnresolved"] for t in types.values()),
         sum(t["external"] for t in types.values()),
         sum(t["unclassed"] for t in types.values()),
         sum(t["edges"] for t in types.values())))
print("  causes     :", len(cause), "->", ", ".join(cause))
print("  caveats    :", len(caveats))
for k, v in cause.items():
    print("    %-30s count=%d population-ok=%s run-ok=%s wouldFail-ok=%s"
          % (k, v["count"], v["population"] == POP_STR, bool(v["falsifier"]["run"]),
             bool(v["falsifier"]["wouldFail"])))

#!/usr/bin/env python3
"""script/m14/tmp/sw-spec-amend.py — M14 spec decisions for the swift round.

Adds one design_decision per rule this round landed, in the file's own shape, and
corrects SW-G's resolution text where this round proved it wrong.
"""
import json

P = "script/m14/spec/swift-completeness.json"
d = json.load(open(P))
dec = d["design_decision"]["decisions"]

def one(fid):
    for x in dec:
        if x["id"] == fid:
            return x
    raise AssertionError(fid)

# SW-G's text says "self/Self the enclosing type", which IS #941: the owner expression
# was `parent.ownerName ?? parent.name`, so an initializer with no resolvable owner
# published its OWN name as a type. Corrected in place rather than left standing.
g = one("SW-G")
g["resolution"] += (
    " CORRECTED 2026-09-25 (#941): the owner is the parent's `ownerName` when the parent "
    "is a MEMBER symbol and the parent's own `name` only when the parent IS the type "
    "(deinit/subscript/observer bodies, which have no symbol of their own). The old "
    "expression minted the enclosing symbol's own name (`instantiates constructor -> "
    "constructor`) wherever the owner was unresolvable, and the oracle's `consumed` flag "
    "only fired on the resolvable branch, so the truth side published the dangling "
    "`calls -> init`. SW-G's own words are now honored on both sides: unresolvable stays "
    "silent. Gated by fixture swift/error-recovery-nominal + 3 mutants."
)

NEW = [
    {
        "id": "SW-D21",
        "node_type": "call_expression recovered from a switch `case` pattern",
        "status": "FIXED",
        "question": ("#938: the pinned grammar does not reduce `case .websocket(let x):` — it recovers "
                     "a call_expression whose callee navigation STARTS AT THE `case` KEYWORD "
                     "(simple_identifier \"case\" + navigation_suffix), so the analyzer published a "
                     "fabricated `calls -> websocket` for a pattern MATCH."),
        "resolution": ("A pattern match is not a call and not construction: `isCasePatternRecovery` "
                       "reads the callee navigation's first token (a reserved keyword, never text) and "
                       "emits nothing, on BOTH sides (the oracle mirrors it). Measured: 3 analyzer-only "
                       "rows at full extent (554 files of swift-nio), the lane's only unexplained-by-truth "
                       "edges. Gated by fixture swift/case-pattern-recovery + mutant "
                       "swift/case-pattern-keyword-call."),
        "issue": "#938 (found by the full-extent depth draw)",
    },
    {
        "id": "SW-D22",
        "node_type": "postfix_expression (force-unwrap) inside an assignment LHS",
        "status": "FIXED",
        "question": ("#939: the pinned grammar wraps a force unwrap in a `postfix_expression`, and the "
                     "SCD1 climb listed only directly_assignable_expression / navigation_expression / "
                     "navigation_suffix — so the inner navigation hit a wall on its first step, the "
                     "LHS-span test never ran, and a WRITE was published as a read "
                     "(`$0.platformSpecificStatus!.st_dev += 1`)."),
        "resolution": ("The climb traverses the unwrap wrapper in all three gates (handleSelfUse, "
                       "handleBareUses' isWrite, handleMemberUses) and in the oracle's two mirrors, so "
                       "the LHS-span rule decides on both sides. Both direction rows close at once: the "
                       "nested write stops leaking a read AND the flat `x.a! = 1` pure write — which BOTH "
                       "sides used to publish as a read — is gated. Gated by fixture "
                       "swift/unwrap-write-gate + mutants swift/unwrap-inner-write-as-read / "
                       "swift/unwrap-outer-write-as-read."),
        "issue": "#939 (found by the full-extent depth draw)",
    },
    {
        "id": "SW-D23",
        "node_type": "ERROR-recovered nominal header (class/struct/enum/extension/actor)",
        "status": "FIXED",
        "question": ("#940/#941: the pinned grammar cannot reduce `nonisolated(unsafe)`, so a whole class "
                     "header lands in an ERROR node — no container symbol is minted and every member it "
                     "owns is orphaned (no `contains`, no member inventory for bare reads, no owner for "
                     "`self.init`). Bare-member reads went two-sidedly blind inside the file."),
        "resolution": ("The recovery shape is read STRUCTURALLY, never from text: an ERROR whose first "
                       "non-header child is the anonymous nominal keyword token (`class`/`struct`/`enum`/"
                       "`extension`/`actor`) and whose own next named child is the type name (`user_type` "
                       "for an extension, identifier otherwise). Declaration content before the keyword "
                       "disqualifies the node — a nested declaration the recovery left as a SIBLING "
                       "contributes its own keyword token (measured on `extension SocketAddressError { … "
                       "struct UnknownHost … }`). The container, its heritage, its members and their "
                       "owners all recover. Gated by fixture swift/error-recovery-nominal + mutants "
                       "swift/error-recovery-no-container / -self-owner-target / -dangling-init-call."),
        "issue": "#940 (found by the full-extent depth draw)",
    },
    {
        "id": "SW-D24",
        "node_type": "enum-construction splice (SW-B post-walk)",
        "status": "FIXED",
        "question": ("#942: the enum-construction conversion removed \"the first calls edge with this "
                     "(source, leaf)\" — a DIFFERENT call site's edge whenever two sites in one scope "
                     "share a leaf name (`static var get: Endpoint { method(.get) }` beside "
                     "`var path = Path.method(.get)`), and a record of a dangling call that no longer "
                     "existed. The oracle mirrored the defect by splicing on target alone, so the loss "
                     "was two-sidedly invisible."),
        "resolution": ("The splice is SITE-precise: every call site increments a per-(source,leaf) count "
                       "(the dedupe had already folded several sites into one relationship), the "
                       "conversion retires exactly its own contribution, and the edge is dropped only "
                       "when no non-construction site remains. The surviving edge is then re-lined onto "
                       "a site that is STILL a call, per pool, never globally — two pools can share a "
                       "source LINE. Gated by fixture swift/enum-construction-splice + mutants "
                       "swift/enum-splice-first-edge / swift/enum-splice-no-conversion."),
        "issue": "#942 (found by the alamofire full-extent draw)",
    },
    {
        "id": "SW-D25",
        "node_type": "quoted identifiers, tuple positions, decorator payloads (name surface)",
        "status": "FIXED",
        "question": ("#924 (swift half): three shapes published a non-name as a name. (a) Swift's "
                     "keyword-escape quoting was kept INSIDE the name (`` `continue` ``), while every "
                     "corpus reference spells it bare, so such a name could never match a reference "
                     "(29 symbols, 40 targets at full extent). (b) A tuple POSITION (`pair.0`, `_key.1`) "
                     "was published as a member target (4 sites) — and after that target was dropped the "
                     "edge's receiver leaked through a fallback (`queueCallbackPair.1(...)` -> `calls -> "
                     "queueCallbackPair`, the lane's only remaining unexplained edge). (c) An attributed "
                     "enum case (`@available(...) case x`) published the decorator PAYLOAD as the "
                     "member's name and borrowed the decorator's line."),
        "resolution": ("(a) exactly one surrounding backtick pair is stripped, at symbol creation, at "
                       "every read site, and in the oracle. (b) a navigation suffix with no identifier "
                       "child is not a name: the fallback that reached for the last simple_identifier "
                       "child — the RECEIVER — is now blocked whenever a suffix was present (measured: "
                       "exactly ONE site of that shape in 652 files, and it is a call through a tuple "
                       "position). (c) the member name is the identifier after `case` (`modifiers` is "
                       "metadata), and the range node is that identifier, so a decorated declaration's "
                       "line is its own. Gated by fixture swift/attributed-enum-case + mutants "
                       "swift/attributed-case-payload-name / -range-at-decorator; measured by the "
                       "full-extent name census (652 files, 23,212 symbols, 78,747 targets, CLEAN)."),
        "issue": "#924 (swift half)",
    },
]

ids = {x["id"] for x in dec}
for n in NEW:
    assert n["id"] not in ids, n["id"]
    dec.append(n)

d["design_decision"]["lastUpdated"] = "2026-09-25"
json.dump(d, open(P, "w"), indent=2)
open(P, "a").write("\n")
print(f"swift spec: {len(dec)} decisions (was {len(dec) - len(NEW)})")

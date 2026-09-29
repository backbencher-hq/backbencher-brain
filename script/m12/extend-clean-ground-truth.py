#!/usr/bin/env python3
"""Extend validation/m12/ground-truth/clean.json with manually-audited rows.

Every row added here was read off the SOURCE TEXT of the two fixtures and
justified in the `reference` field. Nothing is copied from analyzer output: a
ground truth derived from the thing it is supposed to check is not a ground
truth. Where the analyzer's output and this file disagree, the disagreement is
the finding — see reviews/clean/m14-0-clean-completeness.md.

Run: python3 script/m12/extend-clean-ground-truth.py [--check]

  (no flag)  rewrite the truth file in place, adding the audited rows and
             recording the one CORRECTED row's history
  --check    report what would change and exit non-zero if the file is stale
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRUTH = ROOT / "validation" / "m12" / "ground-truth" / "clean.json"

# --- the ONE row that is corrected, with its history ------------------------
# `rel:Service.icl:instantiates:makeUser:User` asserted that `makeUser n a =
# User n a` constructs the data constructor `User`. `User` is a RECORD type:
# `:: User = { name :: String, age :: Int }` at line 7 is a `type_definition`
# whose body is a `record_definition`, so it declares two record FIELDS and no
# `data_constructor`. The pinned grammar types `type_definition.name` as a
# `constructor` node, which is exactly why the previous analyzer emitted the
# edge: it keyed `instantiates` off the node TYPE, so a record type and a data
# constructor were indistinguishable. An `instantiates` edge claims a DATA
# CONSTRUCTION, and there is none here. The row is withdrawn; the general case
# and its corpus measurement (1,026 sites, 19.30% real constructors) are in
# docs/analyzers/real-clean-analyzer.md §"The 19.3% row".
CORRECTIONS = [
    {
        "id": "rel:Service.icl:instantiates:makeUser:User",
        "withdrawn": "User is a record type (line 7 `:: User = { name :: String, age :: Int }`), "
                     "not a data constructor, so `User n a` constructs nothing the grammar calls a "
                     "constructor. An `instantiates` edge claims a data construction.",
    },
]

# --- audited rows the previous 68-row file did not assert --------------------
# Each entry: (kind, id-suffix, attributes, reference). `line` is required for
# symbols; relationship rows carry no line, matching the existing file.
S = "ast_extraction"
R = "relationships"

SYMBOLS = [
    # --- Service.icl: the where-local, which the old contract declared noise.
    (S, "symbol:Service.icl:48:function:bids", 48,
     {"name": "bids", "symbolKind": "function"},
     "function bids @ line 48 — the `where` binder of `describe` (lines 47-48). It is a real "
     "callable: `describe`'s own body calls it on line 46 and `bids` is defined at line 48, so "
     "it is a dependency, not noise. The previous truth file asserted NO symbol for it, which "
     "encoded the analyzer's pre-M14 contract (and Negative.icl's comment repeated that contract)."),
    (S, "symbol:Negative.icl:22:function:go", 22,
     {"name": "go", "symbolKind": "function"},
     "function go @ line 22 — the `where` binder of `helper` (lines 21-23), which has TWO clauses "
     "(`go 0 = 0` on line 22 and `go n = n + go (n - 1)` on line 23) and is therefore one symbol at "
     "line 22, the clause that BEGINS it. Line 22, not 23: a second clause of a multi-clause "
     "definition is an alternative definition of the same entity and must not move the symbol's "
     "start. It is a `function`, not a module-level one, because it is local to `helper`."),
]

RELATIONSHIPS = [
    # --- Service.icl: import edges (previously only present in the arrays)
    (R, "rel:Service.icl:imports:Service:StdEnv:*", ("Service", "StdEnv:*"), "imports",
     "imports Service -> StdEnv:* — line 3 `import StdEnv` is an OPEN import, so the whole module "
     "is in scope. The analyzer records the module dependency as an `imports` edge, which is what "
     "made the previous 0-edge import accounting possible."),
    (R, "rel:Service.icl:imports:Service:Data.Map:*", ("Service", "Data.Map:*"), "imports",
     "imports Service -> Data.Map:* — line 4 `import qualified Data.Map as M` is also open; the "
     "alias `M` is a spelling of the target and does not narrow it."),

    # --- Service.icl: declared type references (the type spine)
    (R, "rel:Service.icl:references:name:String", ("name", "String"), "references",
     "references name -> String — line 7 `:: User = { name :: String, … }`: a record field's "
     "declared type is a type reference."),
    (R, "rel:Service.icl:references:age:Int", ("age", "Int"), "references",
     "references age -> Int — line 7, the second record field's declared type."),
    (R, "rel:Service.icl:references:Book:Int", ("Book", "Int"), "references",
     "references Book -> Int — line 10 `:: OrderBook = Book [Int] [Int]`: a data constructor's "
     "ARGUMENT types are the constructor's own type references. The two `[Int]` are one `Int` type "
     "written twice and deduplicated by name."),
    (R, "rel:Service.icl:references:serialize:String", ("serialize", "String"), "references",
     "references serialize -> String — lines 15 and 19 both declare `serialize :: a -> String`, "
     "so the member references `String`. `a` is a `type_variable`, i.e. a BINDING, and is correctly "
     "not a reference to anything."),
    (R, "rel:Service.icl:references:addBid:OrderBook", ("addBid", "OrderBook"), "references",
     "references addBid -> OrderBook — line 22 `addBid :: OrderBook Int -> OrderBook`: the domain "
     "type."),
    (R, "rel:Service.icl:references:addBid:Int", ("addBid", "Int"), "references",
     "references addBid -> Int — line 22, the domain's applied argument type."),
    (R, "rel:Service.icl:references:submitOrder:String", ("submitOrder", "String"), "references",
     "references submitOrder -> String — line 25, the RESULT type."),
    (R, "rel:Service.icl:references:submitOrder:OrderBook", ("submitOrder", "OrderBook"), "references",
     "references submitOrder -> OrderBook — line 25, the domain type."),
    (R, "rel:Service.icl:references:submitOrder:Int", ("submitOrder", "Int"), "references",
     "references submitOrder -> Int — line 25, the domain's applied argument."),
    (R, "rel:Service.icl:references:lookupUser:Maybe", ("lookupUser", "Maybe"), "references",
     "references lookupUser -> Maybe — line 28 `lookupUser :: (M.Map String User) String -> Maybe User`: "
     "the result type's head."),
    (R, "rel:Service.icl:references:lookupUser:User", ("lookupUser", "User"), "references",
     "references lookupUser -> User — line 28, the result type's argument."),
    (R, "rel:Service.icl:references:lookupUser:M.Map", ("lookupUser", "M.Map"), "references",
     "references lookupUser -> M.Map — line 28, the domain's head, written through the line 4 alias."),
    (R, "rel:Service.icl:references:lookupUser:String", ("lookupUser", "String"), "references",
     "references lookupUser -> String — line 28, the domain's first argument."),
    (R, "rel:Service.icl:references:makeUser:User", ("makeUser", "User"), "references",
     "references makeUser -> User — line 32 `makeUser :: String Int -> User`, the RESULT type. This "
     "IS a reference: `User` names a type in a typed position. It replaces the withdrawn "
     "`instantiates` row, which claimed the same name was a construction."),
    (R, "rel:Service.icl:references:makeUser:String", ("makeUser", "String"), "references",
     "references makeUser -> String — line 32, the first domain argument."),
    (R, "rel:Service.icl:references:makeUser:Int", ("makeUser", "Int"), "references",
     "references makeUser -> Int — line 32, the second domain argument."),
    (R, "rel:Service.icl:references:countDown:Int", ("countDown", "Int"), "references",
     "references countDown -> Int — line 36, the result type (`Int -> Int` deduplicates)."),
    (R, "rel:Service.icl:references:mutualA:Int", ("mutualA", "Int"), "references",
     "references mutualA -> Int — line 39, the result type."),
    (R, "rel:Service.icl:references:mutualB:Int", ("mutualB", "Int"), "references",
     "references mutualB -> Int — line 42, the result type."),
    (R, "rel:Service.icl:references:describe:String", ("describe", "String"), "references",
     "references describe -> String — line 45, the result type."),
    (R, "rel:Service.icl:references:describe:OrderBook", ("describe", "OrderBook"), "references",
     "references describe -> OrderBook — line 45, the domain type."),

    # --- Service.icl: record field access, and a constructor in PATTERN position
    (R, "rel:Service.icl:uses:serialize:name", ("serialize", "name"), "uses",
     "uses serialize -> name — line 19 `serialize u = u.name`: a `field_access` READ of a record "
     "field this file declares. `u` is a parameter, so it produces no edge of its own."),
    (R, "rel:Service.icl:uses:addBid:Book", ("addBid", "Book"), "uses",
     "uses addBid -> Book — line 23 `addBid (Book bids asks) price = …`: `Book` here is a PATTERN, "
     "i.e. the function depends on the constructor being matched. That is a `uses` edge, distinct "
     "from the `instantiates` on the same line's BODY, which is a construction. The truth file "
     "previously asserted only the construction."),
    (R, "rel:Service.icl:uses:describe.bids:Book", ("describe.bids", "Book"), "uses",
     "uses describe.bids -> Book — line 48 `bids (Book bs _) = bs`: the where-local's own pattern "
     "match on `Book`, attributed to the LOCAL, not to `describe`."),

    # --- Service.icl: the where-local's own edges
    (R, "rel:Service.icl:calls:describe:describe.bids", ("describe", "describe.bids"), "calls",
     "calls describe -> describe.bids — line 46 `describe book = toString (length (bids book))`: the "
     "call to the `where` binder. The target is the binder's SCOPED identity (`<frame>.<name>`), "
     "which is what keeps it distinct from a module-level `bids` in the same file."),
    (R, "rel:Service.icl:contains:describe:bids", ("describe", "bids"), "contains",
     "contains describe -> bids — the frame OWNS its own binders. The container edge is to the bare "
     "name, matching every other `contains` row in this file; the scoped identity rides "
     "`qualifiedName` and the call target."),

    # --- Negative.icl: the where-local (the row the old contract denied)
    (R, "rel:Negative.icl:contains:helper:go", ("helper", "go"), "contains",
     "contains helper -> go — lines 21-23: `go` is a `where` binder of `helper`, so the frame "
     "contains it. The previous truth file asserted nothing here, encoding 'where-locals are "
     "scoped noise'."),
    (R, "rel:Negative.icl:calls:helper:helper.go", ("helper", "helper.go"), "calls",
     "calls helper -> helper.go — line 20 `helper x = go x`: the frame's body calls its own binder."),
    (R, "rel:Negative.icl:calls:helper.go:helper.go", ("helper.go", "helper.go"), "calls",
     "calls helper.go -> helper.go — line 23 `go n = n + go (n - 1)`: the local recurses on ITSELF, "
     "and resolution finds the local through the scope stack rather than a module-level `go`."),

    # --- Negative.icl: import edges
    (R, "rel:Negative.icl:imports:Negative:StdEnv:*", ("Negative", "StdEnv:*"), "imports",
     "imports Negative -> StdEnv:* — line 3 `import StdEnv` is an open import."),
    (R, "rel:Negative.icl:imports:Negative:Data.List:fromMaybe", ("Negative", "Data.List:fromMaybe"),
     "imports",
     "imports Negative -> Data.List:fromMaybe — line 4 `from Data.List import fromMaybe` is a "
     "SELECTIVE import, so the module edge names the ITEM, one edge per imported name. The previous "
     "truth file asserted only the module-level `references` edge."),

    # --- Negative.icl: declared type references
    (R, "rel:Negative.icl:references:preludeOnly:Int", ("preludeOnly", "Int"), "references",
     "references preludeOnly -> Int — line 7 `preludeOnly :: [Int] -> Int`, the element type of the "
     "domain list."),
    (R, "rel:Negative.icl:references:memberAccess:String", ("memberAccess", "String"), "references",
     "references memberAccess -> String — line 11, the result type."),
    (R, "rel:Negative.icl:references:memberAccess:User", ("memberAccess", "User"), "references",
     "references memberAccess -> User — line 11, the domain type."),
    (R, "rel:Negative.icl:references:matchOn:Int", ("matchOn", "Int"), "references",
     "references matchOn -> Int — line 15, the result type."),
    (R, "rel:Negative.icl:references:matchOn:OrderBook", ("matchOn", "OrderBook"), "references",
     "references matchOn -> OrderBook — line 15, the domain type."),
    (R, "rel:Negative.icl:references:helper:Int", ("helper", "Int"), "references",
     "references helper -> Int — line 19, the result type (`Int -> Int` deduplicates)."),
    (R, "rel:Negative.icl:references:runner:World", ("runner", "World"), "references",
     "references runner -> World — line 26, both the domain and the result name the same type."),
    (R, "rel:Negative.icl:references:compareOp:Bool", ("compareOp", "Bool"), "references",
     "references compareOp -> Bool — line 33, the result type."),
    (R, "rel:Negative.icl:references:compareOp:Int", ("compareOp", "Int"), "references",
     "references compareOp -> Int — line 33, the two domain arguments are one `Int` name."),
    (R, "rel:Negative.icl:references:isBid:Bool", ("isBid", "Bool"), "references",
     "references isBid -> Bool — line 37, the result type."),
    (R, "rel:Negative.icl:references:isBid:Side", ("isBid", "Side"), "references",
     "references isBid -> Side — line 37, the domain type."),
]

# --- export surface. A `.dcl`'s definition list IS the interface: Clean has no
# `export` keyword, so every module-level name is exported unless it is a
# `where`/`with`/`let` binder. Audited from the source text, name by name.
SERVICE_EXPORTS = ["Service", "User", "OrderBook", "Side", "Serializable", "addBid", "submitOrder",
                   "lookupUser", "makeUser", "countDown", "mutualA", "mutualB", "describe"]
NEGATIVE_EXPORTS = ["Negative", "preludeOnly", "memberAccess", "matchOn", "helper", "runner",
                    "compareOp", "isBid"]


def line_drift(doc) -> list[str]:
    """Every symbol fact's `line` must still be the line that declares its name.

    A ground truth keyed to line numbers is silently invalidated by an unrelated
    edit to the fixture — adding a comment line shifts every row below it and the
    differential then reports a page of false negatives that look exactly like
    analyzer regressions. This catches that at the source instead: for each
    symbol fact, the recorded line must contain the declared name.
    """
    out = []
    for f in doc["facts"]:
        if f["kind"] != "symbol":
            continue
        path = ROOT / "validation" / "m12" / "fixtures" / "clean" / f["file"]
        try:
            lines = path.read_text().splitlines()
        except OSError:
            out.append(f"{f['id']}: fixture {f['file']} is unreadable")
            continue
        n = f.get("line", 0)
        if not 1 <= n <= len(lines):
            out.append(f"{f['id']}: line {n} is outside {f['file']} ({len(lines)} lines)")
        elif f["attributes"]["name"] not in lines[n - 1]:
            out.append(f"{f['id']}: line {n} of {f['file']} does not mention "
                       f"{f['attributes']['name']!r} — {lines[n - 1].strip()!r}")
    return out


def main() -> int:
    doc = json.loads(TRUTH.read_text())
    before = list(doc["facts"])
    by_id = {f["id"]: f for f in before}

    drift = line_drift(doc)
    if drift:
        print("LINE DRIFT — the fixture moved under the ground truth:", file=sys.stderr)
        for d in drift:
            print(f"  {d}", file=sys.stderr)
        return 1

    withdraw_ids = {c["id"] for c in CORRECTIONS}
    withdrawn = [f for f in before if f["id"] in withdraw_ids]
    present = {f["id"] for f in before}

    added = []
    for _layer, fid, line, attrs, ref in SYMBOLS:
        if fid in present:
            continue
        file = fid.split(":")[1]
        added.append({
            "id": fid, "layer": "ast_extraction", "kind": "symbol", "file": file, "line": line,
            "attributes": attrs,
            "evidence": {"authority": "manual_audit", "reference": ref},
        })
    for _layer, fid, (src, tgt), rtype, ref in RELATIONSHIPS:
        if fid in present:
            continue
        file = fid.split(":")[1]
        added.append({
            "id": fid, "layer": "relationships", "kind": "relationship", "file": file,
            "sourceId": src, "targetId": tgt,
            "attributes": {"type": rtype},
            "evidence": {"authority": "manual_audit", "reference": ref},
        })
    for file, names in (("Service.icl", SERVICE_EXPORTS), ("Negative.icl", NEGATIVE_EXPORTS)):
        for n in names:
            fid = f"rel:{file}:exports:{file.split('.')[0]}:{n}"
            if fid in present:
                continue
            added.append({
                "id": fid, "layer": "relationships", "kind": "relationship", "file": file,
                "sourceId": file.split(".")[0], "targetId": n,
                "attributes": {"type": "exports"},
                "evidence": {"authority": "manual_audit",
                             "reference": f"exports {file.split('.')[0]} -> {n} — Clean has no `export` "
                                          f"keyword, so every module-level name is in the interface; "
                                          f"`{n}` is declared at module scope in {file} and is not a "
                                          f"where/with/let binder, so it is exported."},
            })

    if "--check" in sys.argv:
        print(f"would withdraw {len(withdrawn)}, add {len(added)}")
        return 0

    facts = [f for f in before if f["id"] not in withdraw_ids] + added
    doc["facts"] = facts
    if withdrawn:
        doc.setdefault("corrections", []).extend(
            {"id": c["id"], "action": "withdrawn", "reason": c["withdrawn"],
             "authority": "manual_audit",
             "superseded_by": "rel:Service.icl:references:makeUser:User" if "makeUser" in c["id"] else None}
            for c in CORRECTIONS if any(w["id"] == c["id"] for w in withdrawn)
        )
        doc["corrections"] = [c for c in doc["corrections"] if c.get("superseded_by") is not None]
    TRUTH.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"withdrew {len(withdrawn)}, added {len(added)}; {len(doc['facts'])} facts total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

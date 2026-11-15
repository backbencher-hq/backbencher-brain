#!/usr/bin/env python3
"""script/m14/tmp/sw-m12-amend.py — the swift half of #933 (M12 hand audit).

Every edit below is justified by the fixture SOURCE line, quoted in the fact's own
evidence reference. The file's own layout is one fact per line, so this rewrites it
in that layout instead of pretty-printing it (which would reflow all 80 existing
facts and bury the real change).
"""
import json

P = "validation/m12/ground-truth/swift.json"
d = json.load(open(P))
facts = d["facts"]
src = d["source"]

# The contract clause this amendment corrects, in place: the audit's own words said
# `source = enclosing TYPE`, which the M49 W15 #814 ruling replaced.
OLD = ("uses = ONLY self. member reads (Swift's this), source = enclosing TYPE, target = field leaf "
       "(BaseService -> name from self.name, User -> id from self.id)")
NEW = ("uses = member reads (self.-rooted AND reads through a local of a declared type), source = "
       "the enclosing METHOD per the M49 W15 #814 ruling, target = field leaf (name from self.name, "
       "id from u.id)")
assert OLD in src, "contract clause not found — re-read the audit text before amending it"
src = src.replace(OLD, NEW)

def drop(fid):
    global facts
    before = len(facts)
    facts = [f for f in facts if f["id"] != fid]
    assert len(facts) == before - 1, f"not found: {fid}"

def get(fid):
    for f in facts:
        if f["id"] == fid:
            return f
    raise AssertionError(f"not found: {fid}")

def rel(file, typ, s, tgt, state, ref):
    return {
        "id": f"rel:{file}:{typ}:{s}:{tgt}",
        "layer": "relationships",
        "kind": "relationship",
        "file": file,
        "sourceId": s,
        "targetId": tgt,
        "attributes": {"type": typ},
        "expectedState": state,
        "evidence": {"authority": "manual_audit", "reference": ref},
    }

# ---- 1. the two SOURCE-stale facts: M49 W15 #814 (owner: converge on METHOD source) ----
f = get("rel:UserService.swift:uses:UserService:name")
f["id"] = "rel:UserService.swift:uses:describe:name"
f["sourceId"] = "describe"
f["evidence"]["reference"] = (
    "UserService.swift:43 `return \"UserService(\\(self.name))\"` in `override func describe()` "
    "-> uses describe -> name (self. read; source = the enclosing METHOD per the M49 W15 #814 "
    "ruling). The type-sourced spelling this fact used to carry (`UserService -> name`) predated "
    "that ruling: on the live verifier it read as a false negative AND the analyzer's correct twin "
    "as a false positive — the same stale-audit class as #933."
)

f = get("rel:UserService.swift:uses:UserService:users")
f["id"] = "rel:UserService.swift:uses:makeUser:users"
f["sourceId"] = "makeUser"
f["evidence"]["reference"] = (
    "UserService.swift:60 `_ = self.users` in `func makeUser()` -> uses makeUser -> users "
    "(self. read; source = the enclosing METHOD per M49 W15 #814). Same stale-source correction."
)

# ---- 2. the two facts that CONTRADICT the lane's own SCD1 write gate ----
# `self.name = name` / `self.id = id` are assignment LHS: the family rule (M37 #599) and the lane's
# own `write-gate` fixture say a write is never a read, and the analyzer emits nothing for them.
drop("rel:UserService.swift:uses:BaseService:name")
drop("rel:Negative.swift:uses:User:id")

# ---- 3. the four real member reads the audit never described ----
facts.append(rel(
    "UserService.swift", "uses", "countUsers", "active", "resolved",
    "UserService.swift:67 `let s = Status.active` in the extension method `countUsers` -> "
    "uses countUsers -> active (enum-case member read, conf 0.9 isMemberRead).",
))
facts.append(rel(
    "UserService.swift", "uses", "find", "id", "resolved",
    "UserService.swift:47 `let result = users.first { $0.id == id }` in `func find` -> "
    "uses find -> id (member read of the element's own `id` via `$0.id`, conf 0.9 isMemberRead).",
))
facts.append(rel(
    "Negative.swift", "uses", "instantiate", "id", "resolved",
    "Negative.swift:45 `return u.id` in `func instantiate` -> uses instantiate -> id (member "
    "read of the local `u: User`'s property; the audit's only `id` fact cited an assignment LHS "
    "and is deleted above, which is what made this read look like a false positive).",
))
facts.append(rel(
    "Negative.swift", "uses", "transform", "description", "resolved",
    "Negative.swift:20 `print(localB + localA.description)` in `func transform` -> uses transform "
    "-> description (member read on a String local, conf 0.9 isMemberRead). The audit's 'bare "
    "stdlib CALLS are filtered' rule is about `print(...)`/`String(...)`, which still emit "
    "nothing; it never covered a member READ.",
))

# ---- 4. the three sub-threshold refusals, pinned as unknown (both directions) ----
facts.append(rel(
    "UserService.swift", "uses", "find", "users", "unknown",
    "UserService.swift:47 `users.first { ... }` — bare read of the declared field `users`; the "
    "analyzer declines to claim it (conf 0.6, no `self.`). Pinned unknown so a wave that STOPS "
    "emitting it fails as missingClassifications.",
))
facts.append(rel(
    "UserService.swift", "uses", "save", "users", "unknown",
    "UserService.swift:53 `users.append(item)` — the same field, the same refusal (conf 0.6).",
))
facts.append(rel(
    "Negative.swift", "uses", "transform", "items", "unknown",
    "Negative.swift:19 `let doubled = items.map { $0 * 2 }` — bare read of the declared field "
    "`items`; refused like the two above (conf 0.6).",
))

src += (
    " AMENDED 2026-09-25 (#933, the swift half): this audit stopped describing the analyzer in two "
    "documented ways. (a) Its four `uses` facts were sourced at the enclosing TYPE, but the M49 "
    "W15 #814 ruling moved every `uses` source to the enclosing METHOD, so each stale fact read as "
    "a false negative while the analyzer's correct twin read as a false positive; the two that "
    "were pure source moves are corrected in place. (b) Two facts cited an assignment LHS "
    "(`self.name = name`, `self.id = id`) as a 'self. read', which contradicts SCD1 (M37 #599 — a "
    "write is never a read) and the lane's own `write-gate` fixture; the analyzer correctly emits "
    "nothing for them, so they are DELETED rather than kept as refusal pins (there is no edge to "
    "pair with). The audit also never described four genuine member reads (an enum-case read, a "
    "`$0.id` element read, a local's property read, and a member read on a String local); every "
    "one was read back against the fixture SOURCE TEXT — each fact's evidence reference quotes its "
    "line — before being added. The three bare field reads the analyzer emits at confidence 0.6 "
    "are pinned as expectedState=unknown. Totals: 80 -> 85 facts (2 deleted, 2 re-sourced, 4 "
    "added, 3 refusal pins)."
)

out = ['{', '  "schemaVersion": 1,', '  "truthSource": "manual_audit",',
       '  "source": ' + json.dumps(src, ensure_ascii=False) + ',', '  "facts": [']
for i, f in enumerate(facts):
    # ensure_ascii=False: the committed file spells em-dashes literally, and a
    # rewriter that escapes them would fake a whole-file change.
    out.append('    ' + json.dumps(f, separators=(", ", ": "), ensure_ascii=False) + ("," if i < len(facts) - 1 else ""))
out.append("  ]")
out.append("}")
open(P, "w").write("\n".join(out) + "\n")
print(f"swift ground truth: {len(facts)} facts")
for f in facts:
    if f.get("expectedState") == "unknown":
        print("  unknown-state:", f["id"])

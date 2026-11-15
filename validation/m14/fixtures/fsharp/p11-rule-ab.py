#!/usr/bin/env python3
"""PASS-11's store claim, re-derived at HEAD — three questions, one store.

Q1 (the doc's column, reproduced): of the dotted `calls` the store attached, how many
   attached to a symbol whose NAME is the written target (pass 11's "exact qname (S1)" =
   name-level exact, the module-header shape)?

Q2 (the substantive question the Lead's note raises): how many attached to the symbol whose
   QUALIFIED NAME is the written target, how many to a dot-boundary SUFFIX of it (strategy 3),
   and how many by LEAF alone with no identity relation at all?

Q3 (the rule A/B): the LEGACY rule the doc's model described — a dotted target matched to
   MIN(id) of the symbols whose `name` equals everything AFTER THE FIRST DOT
   (`SUBSTR(target, INSTR(target,'.')+1)`, storeResults ~4731). Replayed here against the
   same emitted edges and the same symbol table, and compared with what the store actually
   attached, so "the rule changed" is a count and not an assertion.
"""
import sqlite3, sys, collections

db_path, rels = sys.argv[1], sys.argv[2]
con = sqlite3.connect(db_path)
sym = list(con.execute("SELECT id, name, qualified_name, file_id FROM brain_symbol"))

by_name_first_dot = collections.defaultdict(list)  # legacy strategy-3 key
by_name = collections.defaultdict(list)
for sid, name, qn, fid in sym:
    by_name[name].append((sid, qn))
    # the legacy key is a function of the TARGET, so it is computed per row below.

legacy_min = {}  # (target) -> symbol id the legacy rule would pick
sym_by_name = collections.defaultdict(list)
for sid, name, qn, fid in sym:
    sym_by_name[name].append((sid, qn))
for name in sym_by_name:
    sym_by_name[name].sort()

FS = (".fs", ".fsi", ".fsx")
rows = []
with open(rels) as fh:
    for line in fh:
        p = line.rstrip("\n").split("|")
        if len(p) != 8 or p[0] == "relationship_type":
            continue
        rows.append(dict(zip(["relationship_type", "target_external", "line_number", "attached_name",
                              "attached_qname", "attached_line_start", "source_rel_path", "target_rel_path"], p)))
fs = [r for r in rows if r["source_rel_path"].endswith(FS)]
calls = [r for r in fs if r["relationship_type"] == "calls"]
dotted = [r for r in calls if "." in r["target_external"]]
att = [r for r in dotted if r["attached_name"] != "<NULL>"]


def legacy_pick(target):
    rest = target.split(".", 1)[1] if "." in target else None
    if not rest:
        return None
    c = sym_by_name.get(rest)
    return c[0][1] if c else None  # qualified_name of MIN(id) candidate


identity = [r for r in att if r["attached_qname"] == r["target_external"]]
suffix = [r for r in att if r["attached_qname"] != r["target_external"]
          and r["attached_qname"].endswith("." + r["target_external"])]
leafonly = [r for r in att if r not in identity and r not in suffix]
nameexact = [r for r in att if r["attached_name"] == r["target_external"]]

print(f"dotted calls {len(dotted)}, attached {len(att)}")
print(f"  Q1 by NAME-exact (pass 11's column)      : {len(nameexact)}")
print(f"  Q2 attached to the IDENTITY written      : {len(identity)}")
print(f"     attached to a dot-boundary SUFFIX     : {len(suffix)}")
print(f"     attached by LEAF with no identity     : {len(leafonly)}")

# Q3: the legacy rule, replayed
cand = [r for r in dotted if legacy_pick(r["target_external"]) is not None]
same = [r for r in cand if r["attached_name"] != "<NULL>" and r["attached_qname"] == legacy_pick(r["target_external"])]
diff = [r for r in cand if r["attached_name"] != "<NULL>" and r["attached_qname"] != legacy_pick(r["target_external"])]
lost = [r for r in cand if r["attached_name"] == "<NULL>"]
print(f"\nQ3 legacy rule (name == after-first-dot, MIN(id)) has a candidate for {len(cand)} of {len(dotted)} dotted calls")
print(f"  store at HEAD attaches the SAME symbol      : {len(same)}")
print(f"  store at HEAD attaches a DIFFERENT symbol   : {len(diff)}")
print(f"  store at HEAD attaches NOTHING (legacy would have) : {len(lost)}")
print("  examples where the answer differs:")
for r in diff[:8]:
    print(f"    {r['target_external']!r}: HEAD -> {r['attached_qname']!r} | legacy -> {legacy_pick(r['target_external'])!r}")
for r in lost[:5]:
    print(f"    {r['target_external']!r}: HEAD -> <NULL> | legacy -> {legacy_pick(r['target_external'])!r}")

# Q4: the leaf-only class, by target shape — is the written owner a module the project has?
print("\nQ4 the leaf-only class, most frequent targets:")
cnt = collections.Counter(r["target_external"] for r in leafonly)
for t, n in cnt.most_common(10):
    print(f"    {n:4d}  {t}")
owners = collections.Counter(t.split(".")[0] for t in cnt.elements())
print("  owning head of those targets:", dict(owners.most_common(8)))

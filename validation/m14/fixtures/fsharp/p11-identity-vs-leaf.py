#!/usr/bin/env python3
"""Does the store prefer the IDENTITY the analyzer wrote, or the LEAF?

Pass 11 (HEAD 1442bde08) claimed: "274 of 274 dotted calls attached by leaf, 0 by exact
qname", and concluded "the store can never prefer the identity the analyzer wrote over a
same-named symbol elsewhere in the project".

At HEAD the pass runs, in this order (src/ast/parallel-indexer.ts):
  S1  target_external = qualified_name                      (identity, FIRST)
  S2  target_external = name AND name unique
  S3  dotted target = a SUFFIX of qualified_name            (identity-aware)
  S3b leaf when the leaf is unique
  S3c leaf, RANKED (the eager resolve's ranking)
so an attached row whose qualified_name differs from the written target is the only way
the leaf could have won. This script tests that directly against the store:

  * for every attached dotted `calls` row, is the attached symbol's qname the target?
  * where it is NOT, does the store hold a symbol whose qname IS the target? If it does,
    S1 had a candidate and did not take it, which would refute the ordering above.

Input: rels-head.tsv + the store's brain.db. The store is at HEAD; the pass-11 artifact is
rels.tsv (its DB is gone by design), so the same candidate test is run against the HEAD
symbol table for both readings and the caveat is stated where it matters.
"""
import sqlite3, sys, collections

db_path = sys.argv[1]
rels = sys.argv[2]

con = sqlite3.connect(db_path)
qname_set = {r[0] for r in con.execute("SELECT qualified_name FROM brain_symbol WHERE qualified_name IS NOT NULL")}
name_set = collections.Counter(r[0] for r in con.execute("SELECT name FROM brain_symbol"))
print(f"store symbols: {sum(name_set.values())}, distinct names {len(name_set)}, distinct qnames {len(qname_set)}")

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

identity = [r for r in att if r["attached_qname"] == r["target_external"]]
other = [r for r in att if r["attached_qname"] != r["target_external"]]
cand = [r for r in other if r["target_external"] in qname_set]
nocand = [r for r in other if r["target_external"] not in qname_set]

print(f"\ndotted calls {len(dotted)}  attached {len(att)}")
print(f"  attached to the IDENTITY written (qname == target): {len(identity)}")
print(f"  attached to something else                        : {len(other)}")
print(f"     of those, a symbol WITH that qname exists in the store: {len(cand)}   <-- S1 should have taken it")
print(f"     of those, no symbol carries that qname               : {len(nocand)}   (leaf is the only candidate)")
if cand:
    print("  the first ten S1-should-have-won rows:")
    for r in cand[:10]:
        print(f"    {r['target_external']!r} -> name={r['attached_name']!r} qname={r['attached_qname']!r}")
print("  examples of the leaf-only class:")
for r in nocand[:6]:
    print(f"    {r['target_external']!r} -> name={r['attached_name']!r} qname={r['attached_qname']!r}")

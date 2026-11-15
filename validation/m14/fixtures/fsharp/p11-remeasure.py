#!/usr/bin/env python3
"""PASS 11 RE-MEASUREMENT against the store built at the CURRENT HEAD.

The doc's pass-11 table claims, at 1442bde08: of 563 dotted `calls` targets, 274 attached,
274 by LEAF, 0 by exact qname. Today two index commits changed the pass:
  b21f8d8ad  resolve dotted targets in the pass (leaf only when unambiguous)
  4403697ef  rank dotted targets in the pass the way the eager resolve did (3c)
The claim is about the STORE's attachment rule, and the store is the thing that changed, so
the claim has to be re-derived from a store built at HEAD rather than re-read.

Query is the README's, byte for byte. Input: rels-head.tsv (sqlite3 -header, `|` separated).
"""
import sys, collections

path = sys.argv[1] if len(sys.argv) > 1 else ".tmp-probe/p11-store/rels-head.tsv"
TAB = path.endswith("rels.tsv")
rows = []
HEADER = ["relationship_type", "target_external", "line_number", "attached_name",
          "attached_qname", "attached_line_start", "source_rel_path", "target_rel_path"]
with open(path) as fh:
    for line in fh:
        parts = line.rstrip("\n").split("\t" if TAB else "|")
        if len(parts) != len(HEADER):
            continue
        rows.append(dict(zip(HEADER, parts)))
print(f"# {path} — {'tab, no header (pass-11 artifact)' if TAB else 'pipe, sqlite3 -header'}")

FS = (".fs", ".fsi", ".fsx")
fs_rows = [r for r in rows if r["source_rel_path"].endswith(FS)]
print(f"store rows {len(rows)}, F# rows {len(fs_rows)}")


def leaf(t):
    return t.rsplit(".", 1)[-1]


def report(label, subset):
    dotted = [r for r in subset if "." in r["target_external"]]
    bare = [r for r in subset if "." not in r["target_external"]]
    att = [r for r in dotted if r["attached_name"] != "<NULL>"]
    by_leaf = [r for r in att if r["attached_name"] == leaf(r["target_external"])]
    by_qname = [r for r in att if r["attached_qname"] == r["target_external"]]
    # THE DOC'S OWN COLUMN, recovered from its numbers: "by exact qname (S1)" in pass 11's
    # table is the stored symbol's NAME equal to the WHOLE written spelling (a module
    # header, whose name IS the dotted string), not a qualified_name comparison. Reproduced
    # here so the re-measurement is on the doc's definition and not on a friendlier one.
    by_nameexact = [r for r in att if r["attached_name"] == r["target_external"]]
    print(
        f"{label:14s} dotted={len(dotted):5d} attached={len(att):5d} "
        f"byLEAF={len(by_leaf):5d} byNAMEexact={len(by_nameexact):5d} byQNAME={len(by_qname):5d} "
        f"bare={len(bare):5d} unattached(dotted)={len(dotted) - len(att):5d} unattached(all)={len(subset) - len(att):5d}"
    )
    return dotted, att, by_leaf, by_qname


by_label = collections.defaultdict(list)
for r in fs_rows:
    by_label[r["relationship_type"]].append(r)

order = ["calls", "references", "uses", "imports", "instantiates", "extends", "implements", "contains", "overrides"]
for label in order:
    if label in by_label:
        report(label, by_label[label])
for label in sorted(by_label):
    if label not in order:
        report(label, by_label[label])

# the calls detail, exactly as pass 11 asks it
calls_dotted, calls_att, calls_leaf, calls_qname = report("calls", by_label["calls"])
print()
print("--- the eight S1 (exact-qname) hits, whose shape pass 11 named ---")
for r in calls_qname:
    print(f"  {r['target_external']!r} -> name={r['attached_name']!r} qname={r['attached_qname']!r}")

print()
print("--- every attached-by-leaf row whose stored name is NOT the target leaf (should be empty) ---")
weird = [r for r in calls_att if r["attached_name"] != leaf(r["target_external"])]
for r in weird[:10]:
    print(f"  {r['target_external']!r} -> {r['attached_name']!r}")

print()
print("--- dotted calls: landed in own file / other file, and leaf uniqueness ---")
names = collections.Counter(r["attached_name"] for r in fs_rows if r["attached_name"] != "<NULL>")
own = sum(1 for r in calls_att if r["source_rel_path"] == r["target_rel_path"])
print(f"  attached dotted calls landed in the edge's own file: {own} of {len(calls_att)}")
uniq = sum(1 for r in calls_att if names[r["attached_name"]] == 1)
print(f"  ... whose attached name is unique in the project: {uniq}; colliding: {len(calls_att) - uniq}")

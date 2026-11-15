#!/usr/bin/env python3
"""Re-pin C-D4 in the c spec: its documented residual is closed.

Measured, not asserted: the pinned differential rows read 0/0 for jq:c and
sqlite:c (with their sampleSetHash values matching the live probes), and the
M14.0.F5 lane probes through the production entry read MISSING=0 / unexplained=0
on both corpora the same day.

Scoped text edits inside the C-D4 entry only (the status string and the tail of the
resolution string), so no other entry's bytes move.
"""
import json
import sys

PATH = "script/m14/spec/c-completeness.json"
text = open(PATH, encoding="utf-8").read()

start = text.find('"id": "C-D4"')
if start < 0:
    print("C-D4 not found", file=sys.stderr)
    sys.exit(1)
# Bound the slice to THIS entry: the next entry id after C-D4's own. (A slice to
# the next named decision spanned eight entries and made the status anchor
# ambiguous - caught by the count assertion rather than mis-edited.)
import re as _re

nxt = _re.search(r'"id": "C-D[0-9]+"', text[start + 1 :])
end = start + 1 + nxt.start() if nxt else text.find("\n  ]", start)

slice_txt = text[start:end]

# C-D4's own status is the first field after its node_type; the entry's question and
# resolution quote OTHER entries' statuses as JSON snippets (8 occurrences of the
# status line live inside this 11 KB entry), so the anchor must name the node_type.
OLD_STATUS = (
    '"node_type": "macro-mangled ERROR regions (EXPORT-macro prototypes, SQLITE_WSD phantom functions)",\n'
    '    "status": "RULED",'
)
NEW_STATUS = (
    '"node_type": "macro-mangled ERROR regions (EXPORT-macro prototypes, SQLITE_WSD phantom functions)",\n'
    '    "status": "RULED + RESIDUAL CLOSED (2026-09-23) - re-pinned to the clean 0/0 floor on both c corpora",'
)
if slice_txt.count(OLD_STATUS) != 1:
    print(f"C-D4 status anchor not unique ({slice_txt.count(OLD_STATUS)})", file=sys.stderr)
    sys.exit(1)
slice_txt = slice_txt.replace(OLD_STATUS, NEW_STATUS)

TAIL = "Any future grammar or corpus change that shifts these numbers regresses the baseline gate."
ADD = (
    " RESIDUAL CLOSED AND THE FLOOR RE-PINNED (2026-09-23): both pinned rows now read 0 missing / 0 "
    "unexplained (jq:c sampleSetHash 2b743b65d0eac283, sqlite:c ef6794727cd236d8 in "
    "validation/m14/differential-baseline.json), and the M14.0.F5 lane probes through the production "
    "entry read the same on both corpora (jq:c 45 files tree-truth 2930/2930 covered 100% MISSING=0 "
    "analyzer-edges 2931 unexplained=0 heuristic=0; sqlite:c 60 files 5863/5863 covered 100% "
    "MISSING=0 unexplained=0 heuristic=0), so the amalgamation-file class this entry recorded is no "
    "longer a live residual. The ruling and the config's floorResidual were updated TOGETHER, which is "
    "the gate's own requirement for lowering a documented floor; section E now validates against the "
    "clean milestone instead of an allowance. Because the floor got stricter, a future regression of "
    "this class FAILS the gate rather than fitting under a stale allowance: the recorded floor no "
    "longer describes code that no longer produces it, which is exactly the drift this gate exists to "
    "catch. The history above is kept deliberately - the boundary C-D2 declares (no macro expansion, no "
    "whole-file ERROR-span rescoping) is still the reason the class existed, and the waves that closed "
    "it (#743's grammar rules, #907's declaration-header rule, #912's call-shaped arrival, #920's "
    "row-preserving blanking, #921's name-line containment edges) are named in their own records."
)
if slice_txt.count(TAIL) != 1:
    print(f"C-D4 resolution tail not unique ({slice_txt.count(TAIL)})", file=sys.stderr)
    sys.exit(1)
slice_txt = slice_txt.replace(TAIL, TAIL + ADD)

new = text[:start] + slice_txt + text[end:]
parsed = json.loads(new)
entry = [e for e in parsed["design_decision"]["decisions"] if e["id"] == "C-D4"][0]
assert "RESIDUAL CLOSED" in entry["resolution"], "the append did not land"
assert entry["status"].startswith("RULED + RESIDUAL CLOSED"), "the status did not land"
open(PATH, "w", encoding="utf-8").write(new)
print(f"C-D4 updated: status={entry['status'][:50]}... resolution={len(entry['resolution'])} chars")

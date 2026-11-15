#!/usr/bin/env python3
"""Merge SHARDED runs of the shared ontology arbiter into ONE verdict table.

## Why this exists

The arbiter's verdicts are decided by two conditions, and both are OR-shaped over
the corpus:

  instrument A (grammar-inventory)  RULED-SOUND requires that NONE of the
    `nodeTypesThatWouldMeanIt` names in the ruling table is present in the
    grammar's produced-node-type map. `map.has(n)` over the UNION of the shards
    is true iff it is true for at least one shard, so OR-ing the shards'
    verdicts is EXACT — no per-shard threshold, minimum or average is read
    anywhere in that decision.
  instrument B (parse-tree-count)   RULED-SOUND requires `occurrences === 0`.
    Zero over the union is zero iff every shard is zero. Also exact.
  EMITTED                           edge counts SUM, and `in N+ files` is a
    lower bound that is portable; the "e.g." file list is per-shard-first-4, so
    it depends on the shard boundaries and is NOT merged — it is reported from
    the first shard that carries the type, labelled as such.

So a merged verdict is the arbiter's own verdict over the whole draw, not a
replica of it: this script parses the arbiter's OWN output rows and refuses if
any row carries a status it does not know, or if the union of the shards' file
sets is not the draw `shard-draw.py` published.

Usage: arbiter-arbiter-merge.py <sharddir> <published-draw-hash>
"""
import hashlib
import os
import re
import sys

sharddir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opencode/zig-shard-runs"
published = sys.argv[2] if len(sys.argv) > 2 else (
    "sha256:2f3545f92c470090d61c9a745bb427d8d7dec1630d93d0fbc01cb2acdc5ce1ac")
drawdir = os.environ.get("BB_ARB_DRAWDIR", "")

logs = sorted(x for x in os.listdir(sharddir) if x.startswith("arb-") and x.endswith(".log"))
if not logs:
    sys.exit(f"no arb-*.log in {sharddir}")

ROW = re.compile(r"^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates)\s+(\S+)\s+(.*)$")
EDGES = re.compile(r"([\d,]+) edges in (\d+)\+ files")

types = ["calls", "uses", "contains", "imports", "references", "exports",
         "extends", "implements", "overrides", "instantiates"]
acc = {t: {"emitted": 0, "files": 0, "examples": [], "shards_emitted": 0,
           "ruled": 0, "falsified": 0, "unjustified": 0, "node_counts": set(),
           "tree_zero": 0, "listed": 0, "src": set()} for t in types}
union_files = 0
shards = 0
node_type_counts = []

for lg in logs:
    with open(os.path.join(sharddir, lg)) as fh:
        text = fh.read()
    m = re.search(r"^corpus: ([\d,]+) admitted files", text, re.M)
    if not m:
        sys.exit(f"REFUSING {lg}: no 'corpus: N admitted files' line — the run aborted "
                 f"before its verdict table, so its absence of a row is not a verdict.")
    n = int(m.group(1).replace(",", ""))
    union_files += n
    shards += 1
    rows = 0
    for line in text.splitlines():
        mm = ROW.match(line.strip())
        if not mm:
            nt = re.search(r"the grammar produced (\d+) distinct node types", line)
            if nt:
                node_type_counts.append(int(nt.group(1)))
            continue
        t, status, detail = mm.group(1), mm.group(2), mm.group(3)
        a = acc[t]
        rows += 1
        if status == "EMITTED":
            e = EDGES.search(detail)
            if not e:
                sys.exit(f"REFUSING {lg}: EMITTED row for {t} without an edge count: {detail!r}")
            a["emitted"] += int(e.group(1).replace(",", ""))
            a["files"] = max(a["files"], int(e.group(2)))
            a["shards_emitted"] += 1
            ex = re.search(r"e\.g\. (.*)$", detail)
            if ex and not a["examples"]:
                a["examples"] = [x.strip() for x in ex.group(1).split(",") if x.strip()]
        elif status == "RULED-SOUND":
            a["ruled"] += 1
            nt = re.search(r"the grammar produced (\d+) distinct node types", detail)
            if nt:
                a["node_counts"].add(int(nt.group(1)))
            if "the construct occurs 0x on the parse tree" in detail:
                a["tree_zero"] += 1
            s = re.search(r"Written ruling: (\S+)", detail)
            if s:
                a["src"].add(s.group(1))
        elif status == "FALSIFIED":
            a["falsified"] += 1
        elif status == "RULED-UNJUSTIFIED":
            a["unjustified"] += 1
        else:
            sys.exit(f"REFUSING {lg}: unknown status {status!r} for {t}")
    if rows != 10:
        sys.exit(f"REFUSING {lg}: {rows} verdict rows, expected 10. The arbiter's own table "
                 f"is short, so the merge would be inventing the missing types' verdicts.")

# How many names each ruling actually lists, so the merged basis sentence can say
# what "none of them is present" is a claim ABOUT rather than an adjective.
_ruled = os.environ.get("BB_ZIG_RULED", "script/m14/zig-ruled.ts")
if os.path.exists(_ruled):
    _src = open(_ruled).read()
    for t in types:
        _m = re.search(r'nodeTypesThatWouldMeanIt:\s*(ZIG_[A-Z_]+)', _src)
        if _m:
            _n = re.search(r'const ' + _m.group(1) + r'[^=]*=\s*\[([^\]]*)\]', _src, re.S)
            if _n:
                acc[t]["listed"] = len([x for x in _n.group(1).split(",") if x.strip().strip('"').strip("'")])

if drawdir:
    keys = []
    for f in sorted(os.listdir(drawdir)):
        if f.startswith("shard-") and f.endswith(".txt"):
            with open(os.path.join(drawdir, f)) as fh:
                keys.extend(x.strip() for x in fh if x.strip())
    got = "sha256:" + hashlib.sha256("\n".join(sorted(keys)).encode()).hexdigest()
    if got != published:
        sys.exit(f"REFUSING: union of the shard lists is {got}, the published draw is {published}. "
                 f"A truncated union is a correct number about the wrong population.")
    if len(keys) != union_files:
        sys.exit(f"REFUSING: the shard lists hold {len(keys)} files but the arbiter admitted "
                 f"{union_files}. The arbiter's admission differed from the census's.")

W = 14
def w(s, n): return (s + " " * n)[:n]

print(f"shared ontology arbiter — zig, MERGED over {shards} shards")
print(f"corpus: {union_files:,} files"
      + (f"  (union == published draw {published[:23]}…)" if drawdir else "  (file-set hash NOT checked: no BB_ARB_DRAWDIR)"))
if node_type_counts:
    print(f"instrument A node-type inventory per shard: {min(node_type_counts)}"
          f"–{max(node_type_counts)} distinct; the union is what decides, and both "
          f"supertype rulings require NONE of the listed names to be in it")
print()
print(f"{w('type',W)}{w('status',18)}detail")
print("-" * 120)
emitted = ruled_sound = falsified = unjustified = 0
for t in types:
    a = acc[t]
    if a["emitted"] > 0:
        emitted += 1
        detail = (f"{a['emitted']:,} edges, in {a['files']}+ files across "
                  f"{a['shards_emitted']}/{shards} shards")
        if a["examples"]:
            detail += f"; e.g. (first shard carrying it) {', '.join(a['examples'])}"
        print(f"{w(t,W)}{w('EMITTED',18)}{detail}")
    elif a["falsified"]:
        falsified += 1
        print(f"{w(t,W)}{w('FALSIFIED',18)}NOT EMITTED, and at least one shard found the construct derivable")
    elif a["ruled"]:
        ruled_sound += 1
        # The per-shard inventories differ in SIZE (each shard sees only its own
        # files), so the honest rendering is the RANGE, not one number and not the
        # union's size: no shard printed the union, and this merge does not
        # reconstruct it because the decision needs no union size — it needs
        # "none of the listed node types is present in ANY shard", which is the OR.
        # Instrument B's rows print no node-type count at all, so the branch is on
        # WHICH instrument the row named, not on whether a number happens to exist.
        if a["tree_zero"] == a["ruled"]:
            basis = "instrument B: 0 occurrences on the parse tree"
        else:
            ns = sorted(a["node_counts"])
            span = (f"{ns[0]}" if ns and ns[0] == ns[-1]
                    else f"{ns[0]}-{ns[-1]}" if ns else "an unrecorded number of")
            basis = (f"instrument A: {span} distinct node types per shard, none of the "
                     f"{a['listed']} names in `nodeTypesThatWouldMeanIt` present in any of them")
        print(f"{w(t,W)}{w('RULED-SOUND',18)}NOT EMITTED; {basis} (all {a['ruled']}/{shards} shards). "
              f"Written ruling: {', '.join(sorted(a['src'])) or '(none captured)'}")
    else:
        unjustified += 1
        print(f"{w(t,W)}{w('RULED-UNJUSTIFIED',18)}NOT EMITTED and no sound ruling in any shard")
print("-" * 120)
print(f"emitted {emitted}/10   ruled-sound {ruled_sound}   FALSIFIED {falsified}   ruled-without-justification {unjustified}")
if falsified or unjustified:
    print(f"\n>>> THIS GATE FAILS. The arbiter exits 1 when FALSIFIED + "
          f"RULED-UNJUSTIFIED > 0, and this merge computes {falsified + unjustified}.")
sys.exit(1 if (falsified or unjustified) else 0)

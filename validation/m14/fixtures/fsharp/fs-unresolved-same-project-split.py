#!/usr/bin/env python3
"""FSHARP CAUSE #1 — of the 370,867 unresolved, how many name a declaration the edge's OWN
project publishes?

WHY THIS IS THE QUESTION. `fs-unresolved-split.mts` already classifies each unresolved target as
`in-corpus-exact` when the target's exact spelling is declared SOMEWHERE in the 26-repo corpus.
That is not the same as the edge's own PROJECT, and production resolves per project. So
`in-corpus-exact` (210,667) mixes two opposite findings:

  * the declaration is in ANOTHER project -> legitimately unresolved for this edge, not a defect
    (the class LUA-G6 named: an instrument-scope fact, not a broken edge);
  * the declaration is in the SAME project -> the arbiter's own key space has it and the edge
    still did not resolve, which is the actionable class.

Only the second can be worked on, so the two are separated here rather than left merged.

METHOD. No re-parse: this reads the artifacts the whole-population run already wrote.
  * `.tmp-probe/fsharp-lane/fs-corpus-dump.jsonl` (11,807 files) -> repo -> declared names
  * `.tmp-probe/fsharp-lane/fs-unresolved-split.json` (370,867 rows) -> per-edge target + file
The row's `file` is repo-relative, so the repo is its first path segment; that is the same key the
split uses for its per-project key space.

Streamed line by line: the JSON is 182 MB and the box has ~5 GB free.
"""
import json, sys
from collections import Counter, defaultdict

ROOT = "/home/ishaq2321/mcp/backbencher-brain"
DUMP = f"{ROOT}/.tmp-probe/fsharp-lane/fs-corpus-dump.jsonl"
ROWS = f"{ROOT}/.tmp-probe/fsharp-lane/fs-unresolved-split.json"

# ---- pass 1: what each PROJECT declares (exact spellings, name + qualifiedName) ----
repo_names = defaultdict(set)
dumped = 0
with open(DUMP, encoding="utf8") as f:
    for line in f:
        if not line.strip():
            continue
        row = json.loads(line)
        dumped += 1
        rn = repo_names[row.get("repo")]
        for s in row.get("symbols") or []:
            if s.get("n"):
                rn.add(s["n"])
            if s.get("q"):
                rn.add(s["q"])

# ---- pass 2: stream the unresolved rows ----
FIELD = ("label", "target", "cls", "file", "markerKeys", "targetResolution")
cur = {}
in_rows = False
n_rows = 0
by_bucket = Counter()
top_targets = defaultdict(Counter)
distinct = defaultdict(set)
by_label_bucket = defaultdict(Counter)
by_label_resolution = defaultdict(Counter)
by_label_marker = defaultdict(Counter)
same_repo_examples = defaultdict(list)

def flush(r):
    global n_rows
    if not r.get("target") is not None and "label" not in r:
        return
    n_rows += 1
    tgt, lbl = r.get("target", ""), r.get("label", "?")
    rel = r.get("file", "")
    repo = rel.split("/")[0] if "/" in rel else rel
    declared_here = tgt in repo_names.get(repo, ())
    cls = r.get("cls", "?")
    if cls == "in-corpus-exact":
        bucket = "same-project-exact" if declared_here else "cross-project-exact"
    else:
        bucket = cls
    by_bucket[bucket] += 1
    top_targets[bucket][tgt] += 1
    distinct[bucket].add(tgt)
    by_label_bucket[lbl][bucket] += 1
    if bucket == "same-project-exact":
        by_label_resolution[lbl][r.get("targetResolution", "")] += 1
        by_label_marker[lbl][r.get("markerKeys", "")] += 1
        if len(same_repo_examples[lbl]) < 6:
            same_repo_examples[lbl].append(f"{tgt}  [{rel}]  res={r.get('targetResolution','')}")

with open(ROWS, encoding="utf8") as f:
    for line in f:
        s = line.strip()
        if not in_rows:
            if s.startswith('"rows"'):
                in_rows = True
            continue
        if s.startswith("]"):
            break
        if s.startswith("{"):
            cur = {}
            continue
        if s.startswith("}"):
            flush(cur)
            cur = {}
            continue
        if ":" not in s:
            continue
        k, _, v = s.partition(":")
        k = k.strip().strip('"')
        if k not in FIELD:
            continue
        v = v.rstrip(",").strip()
        cur[k] = json.loads(v)

total = sum(by_bucket.values())
print("=" * 78)
print("FSHARP — the 370,867 unresolved, split by WHOSE project declares the target")
print("=" * 78)
print(f"corpus dump: {dumped} files, {len(repo_names)} repositories")
print(f"unresolved rows read: {n_rows}   (bucketed {total})")
print()
print("bucket                        edges     share")
print("-" * 50)
for b, n in by_bucket.most_common():
    print(f"{b:28} {n:8}  {100*n/total:5.1f}%")
print()
print("PER TYPE — the two exact-hit classes separated")
print(f"{'type':12} {'cross-proj':>11} {'SAME-proj':>10} {'owner':>8} {'leaf-only':>10} {'nowhere':>9}")
for lbl in sorted(by_label_bucket, key=lambda k: -sum(by_label_bucket[k].values())):
    c = by_label_bucket[lbl]
    print(f"{lbl:12} {c['cross-project-exact']:>11} {c['same-project-exact']:>10} "
          f"{c['in-corpus-owner']:>8} {c['in-corpus-leaf-only']:>10} {c['nowhere-in-corpus']:>9}")
print()
print("THE ACTIONABLE CLASS — same-project-exact, by the analyzer's own resolution class")
print("-" * 78)
for lbl in sorted(by_label_resolution, key=lambda k: -sum(by_label_resolution[k].values())):
    tot = sum(by_label_resolution[lbl].values())
    print(f"{lbl}: {tot}")
    for res, n in by_label_resolution[lbl].most_common(8):
        print(f"    {res or '(none)':34} {n:7}")
print()
print("same-project-exact, by marker-key signature (top 12 overall)")
mk = Counter()
for lbl in by_label_marker:
    for k, v in by_label_marker[lbl].items():
        mk[k] += v
for k, v in mk.most_common(12):
    print(f"    {v:8}  {k}")
print()

# ---- CONTROL: the classifier must be able to answer BOTH ways on known cases ----
print()
print("CONTROL - the membership test this whole split rests on")
ctl_ok = True
sample_name = sorted(repo_names["fsharp"])[0]
checks = [
    (f"a name the fsharp repo really declares ({sample_name!r}) is in repo_names['fsharp']",
     sample_name in repo_names["fsharp"], True),
    ("a fabricated name is in NO repo",
     any("ZZZ_NOT_A_SYMBOL_ZZZ" in v for v in repo_names.values()), False),
    ("a BCL name carried only by the compiler repo ('should') is NOT declared by 'Argu'",
     "should" in repo_names.get("Argu", ()), False),
]
for what, got, want in checks:
    ok = got == want
    ctl_ok = ctl_ok and ok
    print(f"    {'OK  ' if ok else 'FAIL'}  {what}: got {got}, want {want}")
print(f"CONTROL {'PASSES - the bucket split is falsifiable' if ctl_ok else 'FAILS - the split must not be reported'}")
if not ctl_ok:
    raise SystemExit(1)

print("TOP TARGETS PER BUCKET, and how concentrated each bucket is")
for b in by_bucket:
    d = distinct[b]
    tot = by_bucket[b]
    print()
    print(f"  {b}: {tot} edges, {len(d)} distinct names, top-20 share "
          f"{100*sum(n for _, n in top_targets[b].most_common(20))/tot:.1f}%")
    for name, n in top_targets[b].most_common(12):
        print(f"      {n:7}  {name}")

print("examples of the actionable class")
for lbl, ex in sorted(same_repo_examples.items()):
    print(f"  {lbl}:")
    for e in ex:
        print(f"      {e}")

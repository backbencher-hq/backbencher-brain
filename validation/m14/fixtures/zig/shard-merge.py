#!/usr/bin/env python3
"""Merge sharded ontology-census raw dumps into ONE report.

The census must run in shards (cumulative WASM state in `parseFile` trips the
engine's 120 s self-destruct guard part-way through a 3,834-file single-process
run, on a file that parses in 2.98 s on its own). Sharding changes one thing
only: the CORPUS-TIER resolution columns, because a shard resolves targets
against its own file-name set. This script re-resolves them against the UNION
and asserts that the union of the shards is the same file set a single-process
draw would have produced -- if that assertion fails the sharded numbers are not
comparable and nothing is written.

Usage: merge-census.py <sharddir> <out.json>
"""
import hashlib
import json
import os
import sys

sharddir = sys.argv[1]
out = sys.argv[2]
N = 8

MARKERS = {"(global)", "(file)", "(declared-type)", "(module)", "(package)"}
SYMBOL_KINDS = {
    "function", "class", "variable", "constant", "interface", "enum", "enum_member",
    "type", "import", "export", "method", "property", "constructor", "namespace",
    "module", "event", "delegate", "object", "record", "macro", "trait", "struct",
    "impl", "actor", "union", "mixin", "extension", "instance",
}

parsed = 0
fallback = 0
raws = []
for i in range(N):
    with open(os.path.join(sharddir, f"raw-{i}.json")) as fh:
        raws.append(json.load(fh))

# ── PREFLIGHT. The census writes TWO files per shard and this merge needs both:
# `--raw raw-N.json` (the per-edge records, which carry `drawFiles`) and
# `--out report-N.json` (the confidence / evidenceClass / reasonCode histograms).
# Passing only `--out` produces a `raw-N.json` that is really the REPORT, so the
# union-hash line below raises `KeyError: 'drawFiles'` 20 lines in -- a traceback
# that reads like a crash in the merge and not like a census invoked wrongly, and
# the two have different fixes. Observed at pass 17 on exactly that invocation.
# Named here so the failure is attributable to the command, not to the merge.
missing = []
for i in range(N):
    for kind, fn in (("raw", f"raw-{i}.json"), ("report", f"report-{i}.json")):
        if not os.path.exists(os.path.join(sharddir, fn)):
            missing.append((i, kind, fn))
if missing:
    print("REFUSING: shard files missing. Each shard needs BOTH outputs:")
    print("    npx tsx validation/m14/fixtures/zig/ontology-census.ts \\")
    print("      --files-from <shard-N.txt> --raw raw-N.json --out report-N.json")
    for i, kind, fn in missing:
        print(f"           shard-{i}: missing {kind} dump ({fn})")
    sys.exit(4)
for i, r in enumerate(raws):
    if "drawFiles" not in r:
        sys.exit(
            f"REFUSING: raw-{i}.json has no `drawFiles`, so it is the census REPORT and not\n"
            f"         the --raw dump. Re-run shard {i} with --raw <dir>/raw-{i}.json."
        )

# ── a shard that fell back to the regex extractor did not measure the analyzer.
# `extractFallback` is what `pool-worker.parseFile` returns when it throws, and
# what it throws for includes a TRUNCATED wasm buffer: `resolveWasm` routes this
# grammar through a temp path derived only from the grammar NAME, so concurrent
# shard processes write and read the same file. Measured 6 of 32 shard-runs on
# the 3,834-file draw at this commit. Refusing beats publishing a mixture.
degraded = [(i, r.get("fallbackFiles", 0)) for i, r in enumerate(raws) if r.get("fallbackFiles", 0) > 0]
if degraded:
    print("REFUSING: these shards returned parseFile fallback:true for at least one file,")
    print("         so their counts mix the analyzer with the regex extractFallback:")
    for i, n in degraded:
        print(f"           shard-{i}: {n} fallback file(s)")
    print("         Re-run those shards; see validation/m14/fixtures/zig/fallback-degradation-rate.sh")
    sys.exit(3)

# ── the shards must partition the published draw, exactly
draw_files = sorted(set(f for r in raws for f in r["drawFiles"]))
union_hash = hashlib.sha256("\n".join(draw_files).encode()).hexdigest()
for r in raws:
    if r["corpusFilesAdmitted"] != raws[0]["corpusFilesAdmitted"]:
        sys.exit("shards disagree on corpusFilesAdmitted")
print(f"union of {N} shards: {len(draw_files)} files  sha256:{union_hash}")

# The published draw hash is an ARGUMENT, and its absence is fatal.
#
# This line used to read `published = None`, and the assertion below was guarded by
# `if published and …`, so the union-hash check NEVER RAN — and the artifact field
# recorded `unionEqualsPublishedDraw: null`, which is the only trace it left. A
# document then described this as "asserts the union hash equals the single-process
# draw hash — it is equal". It was not asserted; it could not have been.
#
# A merge whose shards cover 400 of 3,834 files now says so instead of merging.
PUBLISHED = sys.argv[3] if len(sys.argv) > 3 else None
if PUBLISHED is None:
    sys.exit(
        "REFUSING: no published draw hash given.\n"
        "         Pass it as argv[3] — `shard-draw.py <dir> <n> [seed]` prints it as\n"
        "         `drawHash sha256:<hash>`. Without it this merge cannot check that the\n"
        "         shards cover the draw they claim to, and a truncated union is a\n"
        "         correct number about the wrong population."
    )
published = PUBLISHED.replace("sha256:", "")
if published != union_hash:
    sys.exit(
        f"REFUSING: union hash {union_hash} != published {published}\n"
        f"         The shards cover {len(draw_files)} files, not the published draw.\n"
        "         A usual cause: ontology-census.ts defaults --sample to 400, and its\n"
        "         --files-from filter draws from that truncated pool, so every shard is\n"
        "         a subset of the same first 400 files. Pass --sample 3834."
    )
print(f"union hash == published draw hash  sha256:{union_hash}")

# ── name sets
#
# The per-file name sets and the per-edge `file` fields are keyed by the shard's
# OWN loop index, which COLLIDES across shards (shard 0's index 5 is a different
# file from shard 1's index 5). Every index is therefore translated to the file
# KEY through that shard's `drawFiles`, which is the same list the loop walked.
# Without this the file-local resolution columns read 0.00% for every type, which
# is exactly what a merge bug looks like and not what a corpus looks like.
file_names = {}
file_qnames = {}
file_qname_ambig = {}
corpus_names = set()
corpus_qnames = set()
for r in raws:
    keys = r["drawFiles"]
    for i, names in r["fileNames"].items():
        k = keys[int(i)]
        file_names[k] = set(names)
        corpus_names.update(names)
    # Z-p22: the QUALIFIED name sets, same index translation. Kept beside the
    # bare ones and never merged into them, because the two answer different
    # questions and the bare-name reading is the one every previously published
    # figure in this lane is defined against. See the census's own note.
    for i, qns in r.get("fileQNames", {}).items():
        k = keys[int(i)]
        file_qnames[k] = set(qns)
        corpus_qnames.update(qns)
    for i, dupes in r.get("fileQNameAmbig", {}).items():
        file_qname_ambig[keys[int(i)]] = dict(dupes)

def pct(a, b):
    return 0 if b == 0 else round(a / b * 10000) / 100

by_type = {}
kinds = {}
unknown_kinds = {}
empty_names = []
unknown_declared_local = 0
unknown_declared_corpus = 0
unknown_placeholder = 0
unknown_endpoints = []
heuristic = 0
symbols = relationships = parsed = failures = 0
per_repo = {}
per_repo_files = {}

for r in raws:
    parsed += r["filesParsed"]
    fallback += r.get("fallbackFiles", 0)
    failures += r["parseFailures"]
    symbols += r["symbols"]
    relationships += r["relationships"]
    for k, v in r["kinds"].items():
        kinds[k] = kinds.get(k, 0) + v
    for k, v in r["kindsOutsideSharedSymbolKind"].items():
        unknown_kinds[k] = unknown_kinds.get(k, 0) + v
    empty_names.extend(r["symbolsWithEmptyName"])
    unknown_endpoints.extend(r["edgesWithUnknownEndpoint"])
    heuristic += r["heuristicEdgesUnder07"]
    for k, v in r["filesPerRepo"].items():
        per_repo_files[k] = per_repo_files.get(k, 0) + v

    keys = r["drawFiles"]
    for e in r["edges"]:
        e = dict(e, file=keys[e["file"]])
        t = e["t"]
        row = by_type.setdefault(t, {
            "count": 0,
            "source": {"marker": 0, "resolved": 0, "resolvedQualified": 0,
                       "resolvedBareOnly": 0, "dangling": 0, "ambiguousQualified": 0},
            "target": {"resolvedFileLocal": 0, "danglingFileLocal": 0,
                       "resolvedCorpusTier": 0},
            "bothResolvedFileLocal": 0, "bothResolvedCorpusTier": 0,
            "compositionResolvable": 0, "sourceQNamePublished": 0,
            "memberQNameUnderSource": 0,
            "confidence": {}, "heuristicUnder07": 0, "evidenceClass": {}, "reasonCode": {},
            "perRepo": {},
        })
        row["count"] += 1
        names = file_names.get(e["file"], set())
        qns = file_qnames.get(e["file"], set())
        ambig = file_qname_ambig.get(e["file"], {})
        src, tgt = e["src"], e["tgt"]
        is_marker = src in MARKERS
        if is_marker:
            row["source"]["marker"] += 1
        elif src in names:
            # A bare name the file publishes. Z-p22: split by whether the endpoint
            # is ITSELF a published qualified name, because those are different
            # guarantees and the indexer binds them by different rules
            # (parallel-indexer.ts:3432-3438 tries a bare-name suffix match before
            # an exact qualifiedName match).
            if src in qns:
                row["source"]["resolved"] += 1
            else:
                row["source"]["resolvedBareOnly"] += 1
        elif src in qns:
            row["source"]["resolvedQualified"] += 1
        else:
            row["source"]["dangling"] += 1
        if src in qns:
            row["sourceQNamePublished"] += 1
            if ambig.get(src, 1) > 1:
                row["source"]["ambiguousQualified"] += 1
            # Composition: the member's published qualified name must be
            # reachable from the edge's SOURCE. This is the walk the reverse
            # traversal performs, and it is the only column here that does not
            # depend on how this script chooses to spell a name.
            #
            # BOTH target spellings are accepted, and the reason is that the
            # contract moved. While `contains` targeted a BARE member name the
            # composition was the concatenation `source + "." + target`, which is
            # what this test did and what Z-p22 measured at 99.99%. Since M60 cause
            # A the target IS the member's published spelling
            # (`real-zig-analyzer.ts`, `publishedSpelling`), so the concatenation
            # is `Owner.Owner.member` and can never resolve — the test below read
            # 0.0% on a corpus where 99.99% of `contains` targets bind, which is a
            # broken instrument rather than a broken analyzer. A correct
            # implementation must not be reported as a defect, so the column now
            # accepts either shape and stays comparable across the two runs.
            if tgt in qns and tgt.startswith(src + "."):
                row["compositionResolvable"] += 1
                row["memberQNameUnderSource"] += 1
            elif f"{src}.{tgt}" in qns:
                row["compositionResolvable"] += 1
                row["memberQNameUnderSource"] += 1
        t_local = tgt in names or tgt in qns
        if t_local:
            row["target"]["resolvedFileLocal"] += 1
        else:
            row["target"]["danglingFileLocal"] += 1
        t_corpus = tgt in corpus_names or tgt in corpus_qnames
        if t_corpus:
            row["target"]["resolvedCorpusTier"] += 1
        # Z-p22: a source binds if EITHER spelling is published. Before this
        # column the test was `src in names` alone, so a correctly spelled
        # qualified endpoint read as a dangling one — the merge could not see the
        # spelling the fix introduces, and reported the improvement as a
        # regression. Both readings are printed separately above.
        src_binds = is_marker or src in names or src in qns
        if t_local and src_binds:
            row["bothResolvedFileLocal"] += 1
        if t_corpus and src_binds:
            row["bothResolvedCorpusTier"] += 1
        # The three-way `unknown`-endpoint classification is RECOMPUTED HERE, from the union,
        # and the per-shard verdict strings are discarded. A shard can only see its own ~480
        # files, so its middle class ("declared elsewhere in draw") is decided against 1/8 of the
        # name set and every cross-shard name reads as a placeholder; summing shard verdicts would
        # inherit that. `corpus_names` above is the union, which is the only set the question
        # "is this name declared anywhere in the draw" is answered against.
        if src == "unknown" or tgt == "unknown":
            unknown_ends = [x for x in (src, tgt) if x == "unknown"]
            if all(x in names for x in unknown_ends):
                unknown_declared_local += 1
            elif all(x in corpus_names for x in unknown_ends):
                unknown_declared_corpus += 1
            else:
                unknown_placeholder += 1

# confidence / evidenceClass / reasonCode histograms, and per-repo + file sets,
# come from the per-shard REPORTS (which carry them); summed here.
for i in range(N):
    with open(os.path.join(sharddir, f"report-{i}.json")) as fh:
        rep = json.load(fh)
    for t, v in rep["byType"].items():
        row = by_type.setdefault(t, {
            "count": 0, "source": {"marker": 0, "resolved": 0, "dangling": 0},
            "target": {"resolvedFileLocal": 0, "danglingFileLocal": 0,
                       "resolvedCorpusTier": 0},
            "bothResolvedFileLocal": 0, "bothResolvedCorpusTier": 0,
            "confidence": {}, "heuristicUnder07": 0, "evidenceClass": {}, "reasonCode": {},
            "perRepo": {},
        })
        for k, n in v["confidence"].items():
            row["confidence"][k] = row["confidence"].get(k, 0) + n
        for k, n in v["evidenceClass"].items():
            row["evidenceClass"][k] = row["evidenceClass"].get(k, 0) + n
        for k, n in v["reasonCode"].items():
            row["reasonCode"][k] = row["reasonCode"].get(k, 0) + n
        row["heuristicUnder07"] += v["heuristicUnder07"]
        for k, n in v["perRepo"].items():
            row["perRepo"][k] = row["perRepo"].get(k, 0) + n

# files-per-type: recovered from the union of per-shard example files is NOT
# possible (each shard keeps 4). Counted instead from the edge records' file
# indices, which is exact ONCE each index is translated to the file KEY through
# its own shard's `drawFiles`.
#
# This was the one place that did not translate, and the file the hazard comment
# above warns about was written by that omission showing up: the per-type `files`
# column read 479/480 for every type — 3834/8 = 479.25, the SHARD SIZE — because the
# index space is 0..479 per shard, so distinct files in different shards collapsed
# onto one bucket. `uses` has 2,850 files carrying it and reported 480. A count
# about the wrong population, produced by the merge rather than by the corpus.
#
# An out-of-range index now aborts instead of being bucketed, because a silent
# fallback here is indistinguishable from a correct answer.
files_of_type = {}
for r in raws:
    keys = r["drawFiles"]
    for e in r["edges"]:
        i = e["file"]
        if not isinstance(i, int) or i < 0 or i >= len(keys):
            sys.exit(f"REFUSING: shard edge record has file index {i!r}, outside its drawFiles[0..{len(keys) - 1}]")
        files_of_type.setdefault(e["t"], set()).add(keys[i])

report = {
    "instrument": "validation/m14/fixtures/zig/ontology-census.ts (sharded, merged by shard-merge.py)",
    "entryPoint": "parseFile (src/ast/pool-worker.ts)",
    "shards": N,
    "corpusFilesAdmitted": raws[0]["corpusFilesAdmitted"],
    "filesParsed": parsed,
    "fallbackFiles": fallback,
    "parseFailures": failures,
    "drawHash": f"sha256:{union_hash}",
    "unionEqualsPublishedDraw": (published == union_hash),
    "filesPerRepo": per_repo_files,
    "symbols": symbols,
    "relationships": relationships,
    "kinds": dict(sorted(kinds.items(), key=lambda kv: -kv[1])),
    "kindsOutsideSharedSymbolKind": unknown_kinds,
    "symbolsWithEmptyName": len(empty_names),
    "symbolsWithEmptyNameExamples": empty_names[:10],
    "edgesWithUnknownEndpoint": len(unknown_endpoints),
    "edgesWithUnknownEndpointDeclaredInSource": unknown_declared_local,
    "edgesWithUnknownEndpointDeclaredElsewhereInDraw": unknown_declared_corpus,
    "edgesWithUnknownEndpointPlaceholder": unknown_placeholder,
    "edgesWithUnknownEndpointExamples": unknown_endpoints[:10],
    "heuristicEdgesUnder07": heuristic,
    "heuristicRatioPct": pct(heuristic, relationships),
    "byType": {},
}
for t in sorted(by_type):
    v = by_type[t]
    report["byType"][t] = {
        "count": v["count"],
        "files": len(files_of_type.get(t, ())),
        "perRepo": dict(sorted(v["perRepo"].items(), key=lambda kv: -kv[1])),
        "source": {
            **v["source"],
            "markerPct": pct(v["source"]["marker"], v["count"]),
            "resolvedPct": pct(v["source"]["resolved"], v["count"]),
            "resolvedQualifiedPct": pct(v["source"]["resolvedQualified"], v["count"]),
            "resolvedBareOnlyPct": pct(v["source"]["resolvedBareOnly"], v["count"]),
            "ambiguousQualifiedPct": pct(v["source"]["ambiguousQualified"], v["count"]),
            "danglingPct": pct(v["source"]["dangling"], v["count"]),
        },
        "target": {
            **v["target"],
            "resolvedFileLocalPct": pct(v["target"]["resolvedFileLocal"], v["count"]),
            "resolvedCorpusTierPct": pct(v["target"]["resolvedCorpusTier"], v["count"]),
        },
        "sourceQNamePublished": v["sourceQNamePublished"],
        "sourceQNamePublishedPct": pct(v["sourceQNamePublished"], v["count"]),
        "compositionResolvable": v["compositionResolvable"],
        "compositionResolvablePct": pct(v["compositionResolvable"], v["count"]),
        "bothResolvedFileLocal": v["bothResolvedFileLocal"],
        "bothResolvedFileLocalPct": pct(v["bothResolvedFileLocal"], v["count"]),
        "bothResolvedCorpusTier": v["bothResolvedCorpusTier"],
        "bothResolvedCorpusTierPct": pct(v["bothResolvedCorpusTier"], v["count"]),
        "confidence": v["confidence"],
        "heuristicUnder07": v["heuristicUnder07"],
        "heuristicPct": pct(v["heuristicUnder07"], v["count"]),
        "evidenceClass": v["evidenceClass"],
        "reasonCode": v["reasonCode"],
    }

with open(out, "w") as fh:
    json.dump(report, fh, indent=2)
    fh.write("\n")
print(f"wrote {out}")
print(f"parsed {parsed}  symbols {symbols}  relationships {relationships}")
print(f"empty-name symbols {len(empty_names)}  unknown endpoints {len(unknown_endpoints)}  kinds outside SymbolKind {len(unknown_kinds)}")
print(f"heuristic (<0.7) {heuristic} = {report['heuristicRatioPct']}% of {relationships}")
print("type".ljust(16) + "count".rjust(8) + "files".rjust(7) + "srcMark%".rjust(9)
      + "srcBoth%".rjust(9) + "srcQual%".rjust(9) + "srcBare%".rjust(9) + "srcDangl%".rjust(10)
      + "compOK%".rjust(9) + "tgtLocal%".rjust(10) + "tgtCorpus%".rjust(11) + "  conf")
for t, v in report["byType"].items():
    print(f"{t:<16}{v['count']:>8}{v['files']:>7}  {v['source']['markerPct']:>7}  "
          f"{v['source']['resolvedPct']:>7}  {v['source']['resolvedQualifiedPct']:>7}  "
          f"{v['source']['resolvedBareOnlyPct']:>7}  {v['source']['danglingPct']:>8}  "
          f"{v['compositionResolvablePct']:>7}  "
          f"{v['target']['resolvedFileLocalPct']:>9}  "
          f"{v['target']['resolvedCorpusTierPct']:>9}  "
          + " ".join(f"{k}:{n}" for k, n in v["confidence"].items()))
print("srcBoth% = source is a published BARE name AND a published qualifiedName")
print("srcQual% = qualifiedName only · srcBare% = bare name only · srcDangl% = neither")
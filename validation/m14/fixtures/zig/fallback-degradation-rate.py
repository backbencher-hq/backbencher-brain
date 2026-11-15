#!/usr/bin/env python3
"""ZIG LANE — the `extractFallback` DEGRADATION RATE, measured.

Why this needs its own instrument
---------------------------------
Every number in this lane comes through production `parseFile`
(`src/ast/pool-worker.ts`). When `parseFile` throws, its `catch` returns
`extractFallback(...)` — a REGEX extractor in shared machinery whose symbols
carry no `kind` and whose relationships sit at confidence 0.4/0.5, one of them
sourced `this`, a caller name no zig file declares. The result object carries
`fallback: true` and nothing else says so.

Pass 2 concluded the flag never fires — "8 of 8 shards report 0 and 0".
Pass 3 re-ran the same 3,834-file draw, at the same commit, with the same eight
shards, and three shards came back with `fallback: true`. So the published "0"
was a property of one run and this script puts a RATE on it.

The mechanism, so the number is not only an observation
------------------------------------------------------
`src/ast/engine.ts`'s `resolveWasm("tree-sitter-zig/tree-sitter-zig.wasm")`
walks its candidate list, and in a worktree whose `node_modules` is symlinked
from another checkout every step misses:

  * `node_modules/tree-sitter-zig/`                  — not installed
  * `node_modules/tree-sitter-wasms/out/`            — the collection this
    grammar's bytes are byte-identical to, per the provenance note at the top of
    this document — also not installed here
  * a sibling of the node binary, and `src/ast/tree-sitter.wasm` — absent

so it reaches its LAST fallback, which writes the grammar to a temp path derived
only from the grammar NAME:

    os.tmpdir() / ("bb-wasm_" + relativePath.replace(/\\//g, "_"))
    = /tmp/bb-wasm_tree-sitter-zig_tree-sitter-zig.wasm

Every process that parses a zig file writes that path and then reads it back.
`writeFileSync` truncates before it writes, so a reader in another process can
observe a short file. `Language.load` then throws, with one of two messages
this lane has now recorded on real runs:

    need to see wasm magic number
    WebAssembly.instantiate(): section (code 10, "Code") extends past end of
      the module (length 18911, remaining bytes 12029) @+255

and the file's real graph is replaced by the regex one, silently.

The rate is therefore a property of CONCURRENCY, which is why this script runs
the shards both ways and prints both. A non-zero concurrent figure with a zero
sequential figure is that temp path; a non-zero SEQUENTIAL figure means the
degradation is also intrinsic to a long-lived parser.

Usage: fallback-degradation-rate.py [--rounds 4] [--shards 8]
"""
import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys

# validation/m14/fixtures/zig/<this file> -> the repository root is five levels up.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))))
CENSUS = "validation/m14/fixtures/zig/ontology-census.ts"


def run_shard(tag, shard_file, raw, out, log):
    with open(log, "w") as fh:
        rc = subprocess.run(
            ["npx", "tsx", CENSUS, "--sample", "0",
             "--files-from", shard_file, "--raw", raw, "--out", out],
            cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT).returncode
    if rc != 0 or not os.path.exists(raw):
        return {"tag": tag, "ok": False, "rc": rc, "fallback": None, "files": 0,
                "err": "no raw dump"}
    with open(raw) as fh:
        d = json.load(fh)
    return {"tag": tag, "ok": True, "rc": rc,
            "fallback": d.get("fallbackFiles", 0),
            "files": d.get("filesParsed", 0),
            "kindless": sum((d.get("kindsOutsideSharedSymbolKind") or {}).values()),
            "heuristic": d.get("heuristicEdgesUnder07", 0)}


def stderr_kinds(log):
    if not os.path.exists(log):
        return []
    with open(log, errors="replace") as fh:
        return [ln.strip()[:160] for ln in fh
                if "BB-PARSE-ERR" in ln or "BB-HANG" in ln]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--shards", type=int, default=8)
    a = ap.parse_args()

    # A work dir INSIDE the worktree, not /tmp: this script writes one raw dump
    # per shard per round and a reaper under /tmp took a run out from under it
    # mid-flight, which reads as "no raw dump" for every shard and looks like a
    # measurement of zero.
    work = os.path.join(ROOT, ".p3-fallback-work")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    try:
        sharddir = os.path.join(work, "shards")
        drawrun = subprocess.run(
            ["python3", "validation/m14/fixtures/zig/shard-draw.py", sharddir, str(a.shards)],
            cwd=ROOT, capture_output=True, text=True)
        if drawrun.returncode != 0:
            print("shard-draw failed:", drawrun.stderr[:400])
            return 2
        print(drawrun.stdout.splitlines()[0])
        shard_files = [os.path.join(sharddir, f"shard-{i}.txt") for i in range(a.shards)]

        conc_bad = conc_fb = conc_files = conc_shards = 0
        signatures = {}
        print()
        print(f"=== CONCURRENT: {a.rounds} round(s) x {a.shards} parallel shard processes ===")
        print("round  degraded  fallback-files  files  kindless  sub-0.7")
        for r in range(1, a.rounds + 1):
            with concurrent.futures.ThreadPoolExecutor(max_workers=a.shards) as ex:
                rows = list(ex.map(lambda i: run_shard(
                    f"r{r}s{i}",
                    shard_files[i],
                    os.path.join(work, f"conc-raw-r{r}-{i}.json"),
                    os.path.join(work, f"conc-rep-r{r}-{i}.json"),
                    os.path.join(work, f"conc-log-r{r}-{i}.txt")), range(a.shards)))
            bad = [x for x in rows if not x["ok"] or (x["fallback"] or 0) > 0]
            fb = sum(x["fallback"] or 0 for x in rows)
            fs = sum(x["files"] for x in rows)
            kl = sum(x.get("kindless", 0) for x in rows)
            he = sum(x.get("heuristic", 0) for x in rows)
            print(f"  {r:<5} {len(bad):>9}  {fb:>14}  {fs:>5}  {kl:>7}  {he:>7}")
            for x in bad:
                print(f"        degraded: {x['tag']} fallback={x['fallback']} err={x.get('err','')}")
            for i in range(a.shards):
                for ln in stderr_kinds(os.path.join(work, f"conc-log-r{r}-{i}.txt")):
                    key = ln.split("| ")[-1][:70]
                    signatures[key] = signatures.get(key, 0) + 1
            conc_bad += len(bad)
            conc_fb += fb
            conc_files += fs
            conc_shards += a.shards

        seq_bad = seq_fb = 0
        print()
        print(f"=== SEQUENTIAL: {a.shards} shard processes, one at a time ===")
        print("shard  degraded  fallback-files  files")
        for i in range(a.shards):
            x = run_shard(f"seqs{i}", shard_files[i],
                          os.path.join(work, f"seq-raw-{i}.json"),
                          os.path.join(work, f"seq-rep-{i}.json"),
                          os.path.join(work, f"seq-log-{i}.txt"))
            bad = (not x["ok"]) or (x["fallback"] or 0) > 0
            if bad:
                seq_bad += 1
            seq_fb += x["fallback"] or 0
            print(f"  {i:<5} {'yes' if bad else 'no':>9}  {x['fallback']:>14}  {x['files']:>5}")
            for ln in stderr_kinds(os.path.join(work, f"seq-log-{i}.txt")):
                key = ln.split("| ")[-1][:70]
                signatures[key] = signatures.get(key, 0) + 1

        print()
        print("SUMMARY")
        print(f"  concurrent: {conc_bad} of {a.rounds * a.shards} shard-runs degraded; "
              f"{conc_fb} of {conc_files} files fell back to extractFallback")
        print(f"  sequential: {seq_bad} of {a.shards} shard-runs degraded; {seq_fb} files fell back")
        if signatures:
            print("  stderr signatures seen (BB-PARSE-ERR / BB-HANG), by message:")
            for k, v in sorted(signatures.items(), key=lambda kv: -kv[1]):
                print(f"    {v:>3}x  {k}")
        print()
        print("  concurrent>0 and sequential==0  => the shared /tmp/bb-wasm_<grammar> temp path")
        print("  sequential>0                   => the degradation is also intrinsic")
        print("  Either way the fix is in src/ast/engine.ts / src/ast/pool-worker.ts (lane does")
        print("  not own them): a WASM trap must not be silently downgraded to a regex extraction,")
        print("  and the temp path must be unique per process (or written atomically).")
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)



if __name__ == "__main__":
    sys.exit(main())
#!/usr/bin/env python3
"""What a parse timeout costs, measured on the files that time out.

The zig arm's two first-pass indexes differ in the numbers that make up the
population the containment probes read: +6 files, +21,540 symbols, +24,976
relationships, +8,401 containment edges, with 22→6 parse timeouts and 3,930s→2,275s
wall against them (records: validation/m14/measurements/containment-612.before.json,
validation/m14/measurements/containment-612.json). Those deltas need a mechanism, and the
mechanism has to be measured rather than named. The indexer's per-file budget is
`BB_FILE_TIMEOUT_MS` (default 45,000; a worker that exceeds it is killed and the file
is recorded as a timeout, src/ast/pool-worker.ts:692), so the cost of ONE timeout is
a controlled experiment: index the same files repeatedly, changing only the budget.

The sample is the largest .zig files in a pinned checkout, because those are the
files a 45s budget can actually lose (a timed-out file is by definition a slow one).
Their loss per file is what the arm deltas have to be explained by.

Run: python3 script/m14/tmp/containment-timeout-cost-612.py [--sample N] [--out f]
Out: validation/m14/measurements/containment-timeout-cost-612.json
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE_SRC = Path("/tmp/b612-zig-pinned")  # private pinned worktree, corpus pin 738d2be9d6b6
SAMPLE_DIR = Path("/tmp/b612-zig-sample")
DEFAULT_OUT = "validation/m14/measurements/containment-timeout-cost-612.json"
BUDGETS = [600_000, 15_000, 3_000, 600_000]  # ms: baseline, forced, forced harder, baseline again
SUMMARY_RE = __import__("re").compile(
    r"indexed ([\d,]+) files, ([\d,]+) symbols, ([\d,]+) relationships, ([\d,]+) embeddings in ([\d.]+)s")
BREAKDOWN_RE = __import__("re").compile(
    r"breakdown: (\d+) newly parsed \| (\d+) unchanged \| (\d+) skipped \| (\d+) symbol-loss \(parsed (\d+) symbols\) \| (\d+) errors \| (\d+) timeouts")


def num(s: str) -> int:
    return int(s.replace(",", ""))


def build_sample(n: int) -> dict:
    src = [p for p in SAMPLE_SRC.rglob("*.zig") if ".git" not in p.parts]
    src.sort(key=lambda p: p.stat().st_size, reverse=True)
    pick = src[:n]
    if SAMPLE_DIR.exists():
        shutil.rmtree(SAMPLE_DIR)
    SAMPLE_DIR.mkdir(parents=True)
    total = 0
    for p in pick:
        dst = SAMPLE_DIR / p.name
        if dst.exists():  # same basename in two directories: keep the larger one
            if dst.stat().st_size >= p.stat().st_size:
                continue
            dst.unlink()
        os.link(p, dst)
        total += p.stat().st_size
    return {
        "dir": str(SAMPLE_DIR),
        "files": len(list(SAMPLE_DIR.iterdir())),
        "bytes": total,
        "largest": [
            {"name": p.name, "bytes": p.stat().st_size,
             "source": str(p.relative_to(SAMPLE_SRC))} for p in pick[:10]],
    }


def db_stats() -> dict:
    import sqlite3
    sha = hashlib.sha1(str(SAMPLE_DIR).encode()).hexdigest()
    db = Path.home() / ".bb" / "projects" / sha / "brain.db"
    if not db.exists():
        return {}
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    out = {}
    for name, sql in (
        ("symbols", "SELECT COUNT(*) FROM brain_symbol"),
        ("relationships", "SELECT COUNT(*) FROM brain_relationship"),
        ("contains", "SELECT COUNT(*) FROM brain_relationship WHERE relationship_type='contains'"),
    ):
        out[name] = c.execute(sql).fetchone()[0]
    return out


def run_index(budget_ms: int) -> dict:
    t0 = time.time()
    env = dict(os.environ, BB_FILE_TIMEOUT_MS=str(budget_ms))
    p = subprocess.run([str(ROOT / "bin/bb"), "index", "--force", "--no-setup", str(SAMPLE_DIR)],
                       cwd=ROOT, capture_output=True, text=True, env=env)
    out = (p.stdout or "") + (p.stderr or "")
    rec: dict = {"timeoutBudgetMs": budget_ms, "exitCode": p.returncode,
                 "wallSeconds": round(time.time() - t0, 1),
                 "loadAverage": [round(x, 2) for x in os.getloadavg()]}
    m = SUMMARY_RE.search(out)
    if m:
        rec["indexed"] = {"files": num(m.group(1)), "symbols": num(m.group(2)),
                          "relationships": num(m.group(3)), "embeddings": num(m.group(4)),
                          "reportedSeconds": float(m.group(5))}
    b = BREAKDOWN_RE.search(out)
    if b:
        rec["breakdown"] = {"newlyParsed": int(b.group(1)), "unchanged": int(b.group(2)),
                            "skipped": int(b.group(3)), "symbolLossFiles": int(b.group(4)),
                            "symbolLossParsedSymbols": int(b.group(5)), "errors": int(b.group(6)),
                            "timeouts": int(b.group(7))}
    rec["db"] = db_stats()
    if p.returncode != 0 or m is None:
        rec["tail"] = out[-1200:]
    return rec


def main() -> int:
    args = sys.argv[1:]
    n = int(args[args.index("--sample") + 1]) if "--sample" in args else 40
    out = ROOT / (args[args.index("--out") + 1] if "--out" in args else DEFAULT_OUT)
    sample = build_sample(n)
    indexer = ROOT / "src/ast/parallel-indexer.ts"
    rec = {
        "issue": "#612 follow-up — the measured cost of one parse timeout, on the files that time out",
        "instrument": "BB_FILE_TIMEOUT_MS (src/ast/parallel-indexer.ts config; src/ast/pool-worker.ts self-timeout)",
        "worktree": str(ROOT),
        "commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
        "commitSubject": subprocess.run(["git", "log", "-1", "--format=%s"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
        "indexerSha256": hashlib.sha256(indexer.read_bytes()).hexdigest(),
        "sampleSource": str(SAMPLE_SRC),
        "sample": sample,
        "budgets": BUDGETS,
        "runs": [],
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    for i, budget in enumerate(BUDGETS):
        print(f"--- run {i + 1}/{len(BUDGETS)}: BB_FILE_TIMEOUT_MS={budget} ---", flush=True)
        r = run_index(budget)
        print(f"    {r.get('indexed')} timeouts/errors="
              f"{r.get('breakdown', {}).get('timeouts')}/{r.get('breakdown', {}).get('errors')} "
              f"db_contains={r['db'].get('contains')} wall={r['wallSeconds']}s", flush=True)
        rec["runs"].append(r)
        rec["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        out.write_text(json.dumps(rec, indent=1) + "\n")
    # The arithmetic the report quotes: what one timed-out file costs, from the two
    # baselines (which must agree, or the instrument is not reading what it claims).
    base = [r for r in rec["runs"] if r["timeoutBudgetMs"] >= 600_000]
    forced = rec["runs"][1]
    # A killed file is either a timeout or an error: both lose everything the file
    # would have contributed, so the per-file cost divides by their sum. The two
    # baselines must agree on the COUNTS (their reported seconds are load noise).
    def counts(r: dict) -> tuple:
        # `reportedSeconds` is wall clock (113.8 vs 152.1 across the two identical
        # baselines) — the counts are what a timed-out file changes.
        indexed = {k: v for k, v in (r.get("indexed") or {}).items() if k != "reportedSeconds"}
        return (tuple(sorted(indexed.items())), tuple(sorted((r.get("breakdown") or {}).items())), tuple(sorted((r.get("db") or {}).items())))

    failed = (forced.get("breakdown", {}).get("timeouts") or 0) + (forced.get("breakdown", {}).get("errors") or 0)
    rec["verdict"] = {
        "baselineRunsAgreeOnCounts": len(base) == 2 and counts(base[0]) == counts(base[1]),
        "baselineSeconds": [b["indexed"]["reportedSeconds"] for b in base] if base else None,
        "forcedSeconds": forced.get("indexed", {}).get("reportedSeconds"),
        "failedFilesForced": failed,
        "lossPerFailedFile": {
            "symbols": round((base[0]["indexed"]["symbols"] - forced["indexed"]["symbols"]) / max(1, failed), 1) if base and forced.get("indexed") else None,
            "relationships": round((base[0]["indexed"]["relationships"] - forced["indexed"]["relationships"]) / max(1, failed), 1) if base and forced.get("indexed") else None,
            "contains": round((base[0]["db"]["contains"] - forced["db"]["contains"]) / max(1, failed), 1) if base and forced.get("db") else None,
        },
    }
    rec["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    out.write_text(json.dumps(rec, indent=1) + "\n")
    print("\nverdict: " + json.dumps(rec["verdict"], indent=1))
    print(f"\nrecord: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""#612 follow-up, the DB-only probes over the pinned heavy corpus.

Every probe this runs reads brain.db and does NOT index, by design: the arms of
this work are the SAME corpus, indexed by the same driver, read before and after
the store change — so the DBs under test are whatever `containment-corpus-612.py`
last wrote for each repo, and this driver pins that lineage instead of pretending
to own it. Any probe added to script/m14/tmp and listed nowhere else can be run
over the corpus with `--probe`.

Run:  python3 script/m14/tmp/containment-owner-span-612.py \
        [--probe contains-owner-span-612] [--arm before|after] \
        [--lineage <sweep record>] [--out <record.json>]
Out:  validation/m14/measurements/containment-owner-span-612.json   (after)
      validation/m14/measurements/containment-old-rule-612.json     (counterfactual)
      validation/m14/measurements/containment-owner-span-612.before.json  (control)
      validation/m14/measurements/containment-inner-line-samples-612.json
          --probe contains-inner-line-samples-612, the 24 rows the exact-line
          test cannot match, each one checked against the source text (§8.2)

The `M14.0.*` names in `validation/m14/results/` belong to gates that call
`emitEvidence` (M49.G8 fails on an artifact no producer claims), and these probes
are measurements, so they are named beside that namespace, not inside it.
"""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CORPUS = Path("<corpus-root>/bb_tests/repositories")
# the sweep record whose index runs wrote the DBs this driver reads — the
# canonical one by default, and --lineage names the arm whose DBs are under test
# (the before arm's DBs are gone once the after sweep re-indexes, so its record
# is `.before.json` and the pointer has to say so)
DEFAULT_LINEAGE = "validation/m14/measurements/containment-612.json"

PINNED = [
    ("nlohmann-json", "cpp"),
    ("fmt", "cpp"),
    ("jq", "c"),
    ("sqlite", "c"),
    ("ripgrep", "rust"),
    ("cargo", "rust"),
    ("go-tools", "go"),
    ("terraform", "go"),
    ("zls", "zig"),
    ("zig", "zig"),
]


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    out = None
    probe = "contains-owner-span-612"
    arm = "after"
    lineage_path = ROOT / DEFAULT_LINEAGE
    if "--arm" in sys.argv:
        arm = sys.argv[sys.argv.index("--arm") + 1]
    if "--out" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--out") + 1])
    if "--probe" in sys.argv:
        probe = sys.argv[sys.argv.index("--probe") + 1]
    if "--lineage" in sys.argv:
        lineage_path = ROOT / sys.argv[sys.argv.index("--lineage") + 1]
    if out is None:
        out = ROOT / "validation/m14/measurements/containment-owner-span-612.json"
    source = ROOT / "src/ast/parallel-indexer.ts"
    lineage = json.loads(lineage_path.read_text()) if lineage_path.exists() else {}
    commit = git("rev-parse", "HEAD")
    header = {
        "issue": f"#612 follow-up — {probe} over the pinned heavy corpus (DB-only, no re-index)",
        "arm": arm,
        "worktree": str(ROOT),
        "commit": commit,
        "regeneratedAtCommit": commit,
        "regeneratedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "commitSubject": git("log", "-1", "--format=%s"),
        "sourceDirtyVsCommit": bool(git("status", "--porcelain", "--", str(source.relative_to(ROOT)))),
        "indexerSha256": sha256(source),
        "probe": f"script/m14/tmp/{probe}.ts",
        "probeSha256": sha256(ROOT / f"script/m14/tmp/{probe}.ts"),
        "runner": "python3 script/m14/tmp/containment-owner-span-612.py " + " ".join(sys.argv[1:]),
        "dbsNotReindexed": True,
        "dbLineage": {
            "note": "the DBs read here were written by this record's own index runs",
            "record": str(lineage_path.relative_to(ROOT)),
            "commit": lineage.get("commit"),
            "indexerSha256": lineage.get("indexerSha256"),
            "sourceDirtyVsCommit": lineage.get("sourceDirtyVsCommit"),
            "finishedAt": lineage.get("finishedAt"),
        },
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "repos": [],
    }
    for name, lang in PINNED:
        repo = CORPUS / name
        db = Path.home() / ".bb" / "projects" / hashlib.sha1(str(repo).encode()).hexdigest() / "brain.db"
        st = db.stat() if db.exists() else None
        p = subprocess.run(
            ["npx", "tsx", f"script/m14/tmp/{probe}.ts", str(repo), lang],
            cwd=ROOT, capture_output=True, text=True, timeout=900,
        )
        rec: dict = {
            "repo": name,
            "lang": lang,
            "db": {"path": str(db), "bytes": st.st_size if st else None, "mtime": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(st.st_mtime)) if st else None},
            "exitCode": p.returncode,
        }
        try:
            rec["result"] = json.loads(p.stdout)
        except Exception:
            rec["unparsed"] = (p.stdout or p.stderr)[-2000:]
        header["repos"].append(rec)
        r = rec.get("result") or {}
        keep = {k: v for k, v in r.items() if isinstance(v, (int, float, str))}
        print(f"{name} ({lang}): {json.dumps(keep)[:220]}", flush=True)
        out.write_text(json.dumps(header, indent=1) + "\n")
    header["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    header["regeneratedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    out.write_text(json.dumps(header, indent=1) + "\n")
    print(f"\nwritten {out}", flush=True)
    return 0 if all(r.get("exitCode") == 0 for r in header["repos"]) else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""#612 containment sweep over the pinned heavy corpus, run from this worktree.

For each repo: index it from scratch with THIS worktree's build (`./bin/bb index
--force --no-setup`), then run all six containment probes against the DB that run
just wrote. The record pins the commit, the indexer's sha256, the index summary
and every probe's parsed output (raw stdout kept when a probe prints extra prose).

Why a sweep and not one repo: the target rule and the source question have to hold
on languages whose name collisions differ by kind — C/C++ member and prototype
duplication, rust's `impl Foo` vs `struct Foo`, zig's `anonymous`/`Group`, go's
receiver methods — and on trees 20x the controlled repo.

Run:  python3 script/m14/tmp/containment-corpus-612.py [--arm before|after] [--out f] [repo ...]
        [--root <worktree>]        run bin/bb and the probes from another checkout
                                   (how the pre-fix arm is measured at its own revision)
        [--dir NAME=/abs/path]     index a named repo from another directory
                                   (how a repo is re-measured on a private, pinned copy
                                   without overwriting the shared checkout's brain.db)
Out:  validation/m14/measurements/containment-612.json       (rewritten after each repo)
      validation/m14/measurements/containment-612.before.json (the control arm)

The name is deliberate: `validation/m14/results/M14.0.*.json` is owned by gates
that call `emitEvidence` (M49.G8 fails on an artifact no producer claims), and a
3-hour corpus sweep is not one. Measurement records sit beside the milestone
evidence with descriptive names, carrying the same lineage fields anyway.

Every repo entry carries what the RUN read: the checkout's HEAD and dirt, and
the 1-minute load average immediately before and after its index. Those fields
exist because the analyzer's index is reproducible only to a band: per-file parse
timeouts fire under machine load, and a timed-out file contributes no symbols and
no relationships. A first pass measured zig's two arms 65 and 38 minutes apart on
a shared machine at load ~12 and differed by 2.6% of relationships — which is why
the arm has to be re-measurable on a private copy with the load recorded.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CORPUS = Path("/home/ishaq2321/bb_tests/repositories")
DEFAULT_OUT = "validation/m14/measurements/containment-612.json"

# (repo dir name, language the probes should filter on)
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

PROBES = [
    "contains-ambiguity-612",
    "contains-line-hint-612",
    "contains-residual-612",
    "contains-source-hint-612",
    "contains-source-owner-agreement-612",
    "contains-source-span-delta-612",
]

SUMMARY_RE = re.compile(
    r"indexed ([\d,]+) files, ([\d,]+) symbols, ([\d,]+) relationships, ([\d,]+) embeddings in ([\d.]+)s"
)
BREAKDOWN_RE = re.compile(
    r"breakdown: (\d+) newly parsed \| (\d+) unchanged \| (\d+) skipped \| (\d+) symbol-loss \(parsed (\d+) symbols\) \| (\d+) errors \| (\d+) timeouts"
)


def num(s: str) -> int:
    return int(s.replace(",", ""))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args: str, root: Path = ROOT) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True).stdout.strip()


def run(cmd: list[str], timeout: int | None = None, root: Path = ROOT) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def checkout_of(repo: Path) -> dict:
    """What the RUN read: the corpus directory is shared by every lane on this
    machine (the differential gates check pins out into it), so a record that
    does not name the checkout it indexed cannot distinguish a content change
    from an analyzer change. Cheap to take, impossible to recover later."""
    try:
        head = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True)
        dirty = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"], capture_output=True, text=True)
        return {
            "head": head.stdout.strip() or None,
            "dirtyFiles": len([l for l in dirty.stdout.splitlines() if l.strip()]),
        }
    except Exception as e:  # a corpus dir that is not a checkout is still worth recording
        return {"head": None, "error": str(e)[:200]}


def loadavg() -> list[float]:
    return [round(x, 2) for x in os.getloadavg()]


def index_repo(repo: Path, root: Path) -> dict:
    t0 = time.time()
    rec_load = {"before": loadavg(), "cpus": os.cpu_count()}
    code, out = run([str(root / "bin/bb"), "index", "--force", "--no-setup", str(repo)], root=root)
    rec_load["after"] = loadavg()
    secs = round(time.time() - t0, 1)
    rec: dict = {"exitCode": code, "wallSeconds": secs, "loadAverage": rec_load}
    m = SUMMARY_RE.search(out)
    if m:
        rec["indexed"] = {
            "files": num(m.group(1)),
            "symbols": num(m.group(2)),
            "relationships": num(m.group(3)),
            "embeddings": num(m.group(4)),
            "reportedSeconds": float(m.group(5)),
        }
    b = BREAKDOWN_RE.search(out)
    if b:
        rec["breakdown"] = {
            "newlyParsed": int(b.group(1)),
            "unchanged": int(b.group(2)),
            "skipped": int(b.group(3)),
            "symbolLossFiles": int(b.group(4)),
            "symbolLossParsedSymbols": int(b.group(5)),
            "errors": int(b.group(6)),
            "timeouts": int(b.group(7)),
        }
    if code != 0 or m is None:
        rec["tail"] = out[-2000:]
    return rec


def probe(name: str, repo: Path, lang: str, root: Path) -> dict:
    code, out = run(["npx", "tsx", f"script/m14/tmp/{name}.ts", str(repo), lang], timeout=900, root=root)
    rec: dict = {"exitCode": code}
    try:
        rec["result"] = json.loads(out)
    except Exception:
        rec["unparsed"] = out[-2000:]
    return rec


def arg(flag: str) -> str | None:
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else None


def dir_map() -> dict:
    """--dir NAME=/abs/path, repeatable: index NAME from that directory instead of
    the shared corpus root. The DB is keyed by the indexed directory's path, so a
    private copy gives a private brain.db and leaves the shared one — and every
    record that cites it — untouched."""
    out: dict[str, str] = {}
    argv = sys.argv
    for i, a in enumerate(argv):
        if a == "--dir":
            name, _, path = argv[i + 1].partition("=")
            out[name] = path
    return out


def main() -> int:
    flags = {"--arm", "--out", "--root", "--dir", "--probes"}
    argv = sys.argv[1:]
    skip = {argv[i + 1] for i, a in enumerate(argv) if a in flags and i + 1 < len(argv)}
    wanted = [a for a in argv if a not in flags and a not in skip]
    # A subset run is legitimate (the audit reads one gauge); the record says which
    # probes ran, so a partial record cannot be mistaken for a full one.
    probes = arg("--probes").split(",") if arg("--probes") else PROBES
    root = Path(arg("--root")).resolve() if arg("--root") else ROOT
    out = root / (arg("--out") or DEFAULT_OUT)
    repos = [r for r in PINNED if not wanted or r[0] in wanted]
    overrides = dir_map()
    indexer = root / "src/ast/parallel-indexer.ts"
    commit = git("rev-parse", "HEAD", root=root)
    header = {
        "issue": "#612 follow-up — containment target rule and the source question, over the pinned heavy corpus",
        "arm": arg("--arm") or "after",
        "worktree": str(root),
        "commit": commit,
        "regeneratedAtCommit": commit,
        "regeneratedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "commitSubject": git("log", "-1", "--format=%s", root=root),
        "sourceDirtyVsCommit": bool(git("status", "--porcelain", "--", str(indexer.relative_to(root)), root=root)),
        "indexerSha256": sha256(indexer),
        "loadAverageAtStart": loadavg(),
        "cpus": os.cpu_count(),
        "runner": "python3 script/m14/tmp/containment-corpus-612.py",
        "probes": probes,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "corpusRoot": str(CORPUS),
        "repos": [],
    }
    for name, lang in repos:
        repo = Path(overrides.get(name, CORPUS / name))
        print(f"\n########## {name} ({lang}) from {repo} ##########", flush=True)
        rec = {"repo": name, "lang": lang, "path": str(repo), "checkout": checkout_of(repo)}
        rec["index"] = index_repo(repo, root)
        print(f"  index: {rec['index'].get('indexed')} in {rec['index']['wallSeconds']}s wall "
              f"(load {rec['index']['loadAverage']['before']} -> {rec['index']['loadAverage']['after']})", flush=True)
        rec["probes"] = {}
        for p in probes:
            rec["probes"][p] = probe(p, repo, lang, root)
            r = rec["probes"][p].get("result") or {}
            keep = {k: v for k, v in r.items() if isinstance(v, (int, float, str))}
            print(f"   {p}: {json.dumps(keep)[:220]}", flush=True)
        header["repos"].append(rec)
        header["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        out.write_text(json.dumps(header, indent=1) + "\n")
        print(f"  -> written {out}", flush=True)
    header["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    header["regeneratedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    out.write_text(json.dumps(header, indent=1) + "\n")
    print("\nsweep complete", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

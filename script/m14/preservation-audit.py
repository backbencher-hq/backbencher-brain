#!/usr/bin/env python3
"""What does this checkout hold that `origin` does not, and is any of it landable work?

Two questions, because "a commit that touches a path later" is not the same as "content
main lacks":

1. REACHABILITY.  Every non-commit object reachable from any local ref is either
   reachable from an origin ref (`origin/main` + the archive tags) or it is not.  The
   second set is the only content that vanishes if this checkout does.
2. DIVERGENCE.  For every path any ref touches, the newest commit anywhere is compared
   with main's newest commit FOR THAT PATH, by blob.  Where the blobs differ, the
   question a landing decision needs is answered: does the branch-side blob strictly
   extend main's (additions only, so nothing main carries can be lost), or diverge?

Nothing here is a claim about quality.  It answers "what would be lost", which is
decidable from git alone; whether a revision is *better* is the lane pins' question.

Usage: preservation-audit.py [prefix ...]      (default: everything)
       preservation-audit.py --dangling        adds question 3 (slow: one fsck pass)
Env:   PRESERVATION_AUDIT_OUT=path.json        (optional machine-readable report)

3. DANGLING.  `--dangling` asks the question questions 1 and 2 cannot: what does no ref
   AND no reflog point at?  Those objects are pruned by any `git gc` that outlives
   `gc.pruneExpire`, so content that exists only there is one gc away from gone.  What
   matters is not their size but their direction: for each dangling blob that can still
   be placed at a path, is it a subset of main's copy (superseded), diverged, or ahead of
   it?  Only the last class is lost work.
"""
import subprocess, sys, os, collections, json, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REMOTE_REFS = ["origin/main", "archive/all-lanes-2026-10-07",
               "archive/artifact-stamps-2026-10-02",
               "archive/backup-laptop-a-2026-09-02",
               "archive/stash-9b7d445-dart-discovery"]
MARK = "@@ "


def run(args, stdin=None):
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT,
                          input=stdin)


def git(*a):
    p = run(a)
    if p.returncode != 0:
        sys.stderr.write("preservation-audit: git %s failed: %s\n" % (" ".join(a), p.stderr.strip()))
        sys.exit(2)
    return p.stdout


def git_try(*a):
    """A path main does not have is not an error: refs may predate its rename."""
    p = run(a)
    return p.stdout.strip() if p.returncode == 0 else ""


def object_index(revs):
    """sha -> path for every non-commit object reachable from revs (commits carry no path)."""
    idx = {}
    for line in git("rev-list", "--objects", *revs).splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2:
            idx[parts[0]] = parts[1]
    return idx


def newest_per_path(revs):
    """path -> (committer date, commit) for the newest commit touching it, over revs."""
    newest = {}
    commit, when = None, 0
    for line in git("log", "--format=" + MARK + "%H %ct", "--name-only", *revs).splitlines():
        if line.startswith(MARK):
            commit, ts = line[len(MARK):].split(" ")
            when = int(ts)
        elif line:
            cur = newest.get(line)
            if cur is None or when > cur[0]:
                newest[line] = (when, commit)
    return newest


def dangling_report(remote, local_all):
    """Question 3: content no ref and no reflog points at, and which way it points."""
    # Plain fsck counts reflogs as reachability, so what it reports is what NEITHER a ref
    # NOR a reflog points at -- the set a `git gc` that outlives the reflogs will prune.
    p = run(["fsck", "--unreachable", "--no-progress"])
    objs = []
    for line in p.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[0] in ("unreachable", "dangling"):
            objs.append((parts[1], parts[2]))
    dang = {s for t, s in objs if s not in local_all}
    print("--dangling: %d objects no ref and no reflog points at" % len(dang))
    types, size = {}, {}
    lst = sorted(dang)
    for i in range(0, len(lst), 1000):
        for line in run(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
                        stdin="\n".join(lst[i:i + 1000]) + "\n").stdout.splitlines():
            f = line.split()
            if len(f) == 3:
                types[f[0]], size[f[0]] = f[1], int(f[2])
    counts = collections.Counter(types.values())
    print("   commits %d  trees %d  blobs %d (%.1f MB)" % (counts["commit"], counts["tree"],
                                                          counts["blob"], sum(size.values()) / 1e6))
    # Every (blob, path) pair, not one path per blob: the same content can sit at several
    # paths, and a verdict that depends on which one is picked is a verdict about the
    # picker.  A dangling blob counts as ahead only where main's copy of THAT path is a
    # strict subset of it.
    commits = [s for s, t in types.items() if t == "commit"]
    places = collections.defaultdict(set)
    for i in range(0, len(commits), 200):
        for line in run(["rev-list", "--objects", *commits[i:i + 200]]).stdout.splitlines():
            f = line.split(" ", 1)
            if len(f) == 2:
                places[f[0]].add(f[1])
    seen = set(places)
    for t in [s for s, ty in types.items() if ty == "tree"]:
        if t in seen:
            continue
        for line in run(["ls-tree", "-r", "-t", t]).stdout.splitlines():
            meta, path = line.split("\t", 1)
            places[meta.split()[2]].add(path)
    verdicts = collections.Counter()
    ahead = collections.defaultdict(list)
    for s in sorted(s for s, t in types.items() if t == "blob"):
        if not places.get(s):
            verdicts["no tree survives"] += 1
            continue
        for path in sorted(places[s]):
            mainb = git_try("rev-parse", "--verify", "-q", "origin/main:" + path)
            if not mainb:
                verdicts["path main does not have"] += 1
                continue
            numstat = run(["diff", "--numstat", mainb, s]).stdout.strip()
            adds, dels = (int(x) for x in numstat.split("\t")[:2]) if numstat else (0, 0)
            if adds == 0 and dels == 0:
                verdicts["identical to main"] += 1
            elif dels == 0:
                verdicts["AHEAD of main"] += 1
                ahead[path].append((s, adds))
            elif adds == 0:
                verdicts["subset of main, superseded"] += 1
            else:
                verdicts["diverged"] += 1
    verdicts = collections.Counter(verdicts)
    ahead = {p: v for p, v in ahead.items()}
    for k, v in verdicts.most_common():
        print("   %-28s %d" % (k, v))
    print("   paths where a dangling revision is AHEAD of main's copy: %d" % len(ahead))
    for path in sorted(ahead):
        s, adds = max(ahead[path])
        print("      %-56s +%d lines  %s" % (path, adds, s[:10]))
    return ahead


def blob_map(specs):
    """{(commit, path) or path: blob sha} for every spec, in batches; empty string when absent."""
    out = {}
    items = list(specs)
    for i in range(0, len(items), 1000):
        batch = items[i:i + 1000]
        p = run(["cat-file", "--batch-check=%(objectname) %(objecttype)"],
                stdin="\n".join(batch) + "\n")
        for spec, line in zip(batch, p.stdout.splitlines()):
            parts = line.split()
            out[spec] = parts[0] if len(parts) >= 2 and parts[1] == "blob" else ""
    return out


def main():
    started = time.time()
    prefixes = [a for a in sys.argv[1:] if not a.startswith("-")]

    local = object_index(["--all"])
    local_all = set(local)
    remote = set(object_index(REMOTE_REFS))
    local_only = {s: p for s, p in local.items() if s not in remote}
    per_path = collections.Counter(local_only.values())
    print("non-commit objects reachable from all local refs : %d" % len(local))
    print("non-commit objects reachable from origin         : %d" % len(remote))
    print("non-commit objects only here                     : %d, across %d paths"
          % (len(local_only), len(per_path)))
    print()

    anywhere = newest_per_path(["--all"])
    onmain = newest_per_path(["origin/main"])
    print("paths any ref touches: %d   paths origin/main touches: %d\n"
          % (len(anywhere), len(onmain)))

    candidates = []
    for path, (when, commit) in anywhere.items():
        if prefixes and not any(path == p or path.startswith(p.rstrip("/") + "/")
                                for p in prefixes):
            continue
        m = onmain.get(path)
        if m and m[1] == commit:
            continue
        candidates.append((path, when, commit, m[0] if m else 0, m[1] if m else None))

    specs = []
    for path, when, commit, mwhen, m_commit in candidates:
        specs.append("%s:%s" % (commit, path))
        specs.append("origin/main:%s" % path)
    blobs = blob_map(specs)

    rows = []
    differ = []
    for path, when, commit, mwhen, m_commit in candidates:
        mine = blobs.get("%s:%s" % (commit, path), "")
        mainblob = blobs.get("origin/main:%s" % path, "")
        if not mine and not mainblob:
            # The newest commit touching this path DELETED it, and main does not have it
            # either: a rename or a removal both sides agree on.  Not content, not a gap.
            verdict = "absent-both"
        elif mine == mainblob:
            verdict = "in-sync"
        elif not mainblob:
            verdict = "not-on-main"       # main never had it (or dropped it) and a ref has it
        elif not mine:
            verdict = "deleted-branch"     # main has it, the branch side removed it
        else:
            differ.append((path, when, commit, mine, mainblob))
            verdict = "differ"
        rows.append({"path": path, "newest_commit": commit, "newest_date": when,
                     "main_commit": m_commit, "main_date": mwhen,
                     "newest_blob": mine, "main_blob": mainblob, "verdict": verdict,
                     "off_origin_blob": bool(mine) and mine not in remote})

    # A differing blob is decided by the strict-extension test, in both directions: a
    # pair where one side is additions-only is a superset question, and a pair where both
    # sides hold lines the other lacks is the only real divergence.
    for path, when, commit, mine, mainblob in differ:
        to_branch = run(["diff", "--numstat", mainblob, mine]).stdout.strip()
        to_main = run(["diff", "--numstat", mine, mainblob]).stdout.strip()
        adds, dels = (to_branch.split("\t")[:2] if to_branch else ("?", "?"))
        madds, mdels = (to_main.split("\t")[:2] if to_main else ("?", "?"))
        if dels == "0":
            verdict = "strict-extension"      # branch adds, drops nothing main has
        elif mdels == "0":
            verdict = "superseded-stale"      # main adds, drops nothing the branch has
        else:
            verdict = "diverged"              # both sides hold lines the other lacks
        for r in rows:
            if r["path"] == path:
                r["verdict"] = verdict
                r["adds"], r["dels"] = adds, dels
                r["main_adds"], r["main_dels"] = madds, mdels
                break

    counts = collections.Counter(r["verdict"] for r in rows)
    print("paths whose newest revision is not main's newest commit for that path: %d"
          % len(rows))
    for k in ("in-sync", "absent-both", "not-on-main", "deleted-branch",
              "superseded-stale", "strict-extension", "diverged"):
        print("  %-18s %d" % (k, counts[k]))
    for v in ("diverged", "strict-extension", "not-on-main", "deleted-branch"):
        sel = [r for r in rows if r["verdict"] == v]
        newer = sum(1 for r in sel if r["newest_date"] > r["main_date"])
        print("  of %-18s branch side committed later than main's touch: %d, earlier: %d"
              % (v, newer, len(sel) - newer))
    print()

    for v in ("strict-extension", "diverged", "not-on-main", "deleted-branch",
              "superseded-stale"):
        sel = [r for r in rows if r["verdict"] == v]
        if not sel:
            continue
        print("== %s (%d)" % (v, len(sel)))
        for r in sorted(sel, key=lambda r: r["path"]):
            extra = ""
            if "adds" in r:
                extra = "  +%s/-%s" % (r["adds"], r["dels"])
            when = "LATER" if r["newest_date"] > r["main_date"] else "earlier"
            print("   %-62s %s %8s%s%s" % (r["path"], r["newest_commit"][:9], when, extra,
                                           "  OFF-ORIGIN" if r["off_origin_blob"] else ""))
        print()

    if "--dangling" in sys.argv:
        dangling_report(remote, local_all)

    out = os.environ.get("PRESERVATION_AUDIT_OUT")
    if out:
        json.dump({"non_commit_objects_local": len(local),
                   "non_commit_objects_origin": len(remote),
                   "non_commit_objects_local_only": len(local_only),
                   "local_only_by_path": dict(per_path),
                   "paths": rows}, open(out, "w"), indent=1)
        print("wrote %s" % out)
    print("elapsed %.1fs" % (time.time() - started))


if __name__ == "__main__":
    main()

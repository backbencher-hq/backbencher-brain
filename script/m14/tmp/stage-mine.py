#!/usr/bin/env python3
"""Stage ONLY the work I authored in this round.

Shared files carry a co-agent's in-flight edits, so staging a whole file would
sweep their work in, and staging by raw LINE OFFSET is what broke commit
a059860a (its dart mutants landed after `main().catch(...)` and the committed
file no longer parsed). Every shared file is therefore rebuilt from HEAD using
VERIFIED STRING ANCHORS; whole files are added only when they are entirely mine.
The working tree is never modified.

Adjust BLOCKS / MINE / FILE_INSERTS per round, then run.
"""
import subprocess, sys, os

ROOT = "/home/ishaq2321/mcp/backbencher-brain"
MAIN_GUARD = "main().catch(e => { console.error(e); process.exit(1) })\n"
CO_AGENT_MARKERS = ("M60", "seam trace", "retrofit")

# Mutant blocks I own: (first mutant id, the id that FOLLOWS it, anchor in HEAD).
# Empty when this round adds no mutants.
BLOCKS: list = []

# Whole files that are entirely mine this round (added or modified by me alone).
MINE = [
    "reviews/m49-w17-parse-success-census.md",
    "script/m14/tmp/parse-success-census.ts",
]

# Shared files where I add whole lines: (path, anchor line prefix present in
# HEAD, the working-tree line prefix that identifies MY inserted line).
FILE_INSERTS = [
    ("reviews/onboarding.md",
     "- `reviews/m49-w12-svelte-heritage.md` — M49 W12:",
     "- `reviews/m49-w17-parse-success-census.md` —"),
]


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                          text=True, check=True).stdout


def head_text(path):
    return git("show", f"HEAD:{path}")


def work_text(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as fh:
        return fh.read()


def write_blob(path, text, desc):
    tmp = "/tmp/staged-" + path.replace("/", "_")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    sha = git("hash-object", "-w", tmp).strip()
    subprocess.run(["git", "update-index", "--cacheinfo", f"100644,{sha},{path}"],
                   cwd=ROOT, check=True)
    print(f"  {path}: {sha[:10]}  {len(text.splitlines())} lines  ({desc})")


def stage_mutants():
    p = "script/m14/mutate-analyzer.ts"
    head = head_text(p)
    work = work_text(p)
    if head.count(MAIN_GUARD) != 1:
        sys.exit("FAIL: main() guard not unique in HEAD")
    keep, tail = head.split(MAIN_GUARD)
    if tail.strip():
        print(f"  repairing HEAD's unparseable tail ({len(tail.splitlines())} lines)")
        head = keep + MAIN_GUARD
    staged = head
    for first_id, next_id, anchor in BLOCKS:
        if staged.count(anchor) != 1:
            sys.exit(f"FAIL: anchor for {first_id} not unique in HEAD")
        start = work.index('  {\n    id: "%s",' % first_id)
        end = work.index('  {\n    id: "%s",' % next_id)
        block = work[start:end]
        ids = [ln.split('"')[1] for ln in block.split("\n") if ln.strip().startswith("id: ")]
        if not ids or ids[0] != first_id:
            sys.exit(f"FAIL: block for {first_id} starts with {ids[:1]}")
        if any(m in block for m in CO_AGENT_MARKERS):
            sys.exit(f"FAIL: block for {first_id} contains a co-agent marker")
        new_ids = [i for i in ids if i not in staged]
        print(f"  {first_id}: {len(ids)} mutant(s), {len(new_ids)} new -> {new_ids}")
        staged = staged.replace(anchor, block + anchor, 1)
    for first_id, _, _ in BLOCKS:
        if staged.count(first_id) != 1:
            sys.exit(f"FAIL: staged file carries {first_id} {staged.count(first_id)}x")
    if not staged.endswith(MAIN_GUARD):
        sys.exit("FAIL: staged mutate-analyzer.ts must end at the main() guard")
    write_blob(p, staged, "HEAD + my mutant block(s)")


def stage_inserts():
    for path, anchor, my_prefix in FILE_INSERTS:
        head = head_text(path)
        work = work_text(path)
        mine = [ln for ln in work.split("\n") if ln.startswith(my_prefix)]
        if len(mine) != 1:
            sys.exit(f"FAIL: {path}: {len(mine)} working-tree lines start with {my_prefix!r} (need 1)")
        if head.count(anchor) != 1:
            sys.exit(f"FAIL: {path}: anchor not unique in HEAD ({head.count(anchor)}x)")
        if head != work and my_prefix in head:
            sys.exit(f"FAIL: {path}: HEAD already carries my line - nothing to stage")
        staged = head.replace(anchor, mine[0] + "\n" + anchor, 1)
        if mine[0] not in staged:
            sys.exit(f"FAIL: {path}: my line did not land in the staged blob")
        if len(staged.splitlines()) != len(head.splitlines()) + 1:
            sys.exit(f"FAIL: {path}: staged blob is not HEAD + exactly one line")
        if any(m in staged and m not in head for m in CO_AGENT_MARKERS):
            sys.exit(f"FAIL: {path}: staged blob picked up a co-agent marker")
        write_blob(path, staged, "HEAD + my board line")


def main():
    if BLOCKS:
        stage_mutants()
    for f in MINE:
        txt = work_text(f)
        hits = [m for m in CO_AGENT_MARKERS if m in txt]
        if hits:
            sys.exit(f"FAIL: {f} carries co-agent marker(s) {hits}")
        subprocess.run(["git", "add", f], cwd=ROOT, check=True)
        print(f"  staged {f}")
    if FILE_INSERTS:
        stage_inserts()
    print("done - working tree untouched")


main()

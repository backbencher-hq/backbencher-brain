#!/usr/bin/env python3
"""Stage ONLY the objc-lane hunks of the two files a second actor is editing.

M60 objc lane closure, 2026-09-25. `script/m14/differential.ts` and
`script/m14/mutate-analyzer.ts` each carry, in this same working tree, another
lane's cpp round: the `cpp:` sampling-`ext` change, the `deriveCppBareUses`
oracle, a `real-cpp-analyzer` import, and three cpp mutants. A whole-file
`git add` would publish that under this lane's message.

Selection is STRUCTURAL, not textual, so a moved line cannot fool it:

  * differential.ts — every objc-lane change lives inside `deriveObjcEdges`
    (the hunk's `@@ ... @@ <section>` context). Nothing else in the file is mine.
  * mutate-analyzer.ts — oracles are data entries, so the entry's own language
    field decides: `language: "objc"` is mine, `language: "cpp"` is not.

Fail-closed: a hunk matching neither rule aborts the run instead of being
guessed at. Every hunk the run sees is printed with its verdict, and the script
re-checks afterwards that the foreign hunks are STILL UNSTAGED — that invariant
is the whole point of it existing.

Usage:
  python3 script/m14/tmp/oc-stage-objc-hunks.py --dry-run   # decide, print, change nothing
  python3 script/m14/tmp/oc-stage-objc-hunks.py             # apply to the index
"""
import subprocess
import sys


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def split_hunks(patch):
    """-> (file_header_lines, [hunk_lines, ...]) for a single-file unified diff."""
    lines = patch.split("\n")
    i = 0
    while i < len(lines) and not lines[i].startswith("@@"):
        i += 1
    header, hunks, cur = lines[:i], [], None
    for line in lines[i:]:
        if line.startswith("@@"):
            if cur is not None:
                hunks.append(cur)
            cur = [line]
        elif cur is not None:
            cur.append(line)
    if cur is not None:
        hunks.append(cur)
    return header, hunks


def added_lines(hunk):
    return [ln[1:] for ln in hunk if ln.startswith("+") and not ln.startswith("+++")]


def section_of(hunk):
    """The trailing context of `@@ -a,b +c,d @@ <section>` — git's enclosing-decl guess."""
    parts = hunk[0].split("@@")
    return parts[-1].strip() if len(parts) >= 3 else ""


def verdict_differential(hunk):
    if "deriveObjcEdges" in section_of(hunk):
        return True, f"inside deriveObjcEdges — {section_of(hunk)[:50]}"
    return False, f"not objc-lane code — {section_of(hunk)[:50]}"


def verdict_mutate_analyzer(hunk):
    added = "\n".join(added_lines(hunk))
    if 'language: "objc"' in added:
        return True, "objc mutant entry"
    if 'language: "cpp"' in added:
        return False, "cpp mutant entry (foreign)"
    return None, "neither objc nor cpp mutant entry"


RULES = {
    "script/m14/differential.ts": verdict_differential,
    "script/m14/mutate-analyzer.ts": verdict_mutate_analyzer,
}


def main():
    dry = "--dry-run" in sys.argv
    total = 0
    for path, decide in RULES.items():
        diff = run(["git", "diff", "-U3", "--", path]).stdout
        if not diff.strip():
            print(f"{path}: no diff — skipping")
            continue
        header, hunks = split_hunks(diff)
        if len(hunks) == 0:
            print(f"{path}: diff with no hunks — nothing to select")
            continue
        selected, dropped = [], 0
        for hunk in hunks:
            keep, why = decide(hunk)
            if keep is None:
                print(f"{path}: AMBIGUOUS {hunk[0]} — {why} — refusing")
                sys.exit(1)
            print(f"{path}: {'KEEP' if keep else 'drop'}  {hunk[0]}  ({why})")
            if keep:
                selected.append(hunk)
            else:
                dropped += 1
        if not selected:
            print(f"{path}: nothing selected — refusing to leave the lane empty")
            sys.exit(1)
        print(f"{path}: {len(selected)}/{len(hunks)} hunks selected")
        total += len(selected)
        if dry:
            continue
        patch = "\n".join(header + [ln for h in selected for ln in h])
        if not patch.endswith("\n"):
            patch += "\n"
        applied = run(["git", "apply", "--cached", "-"], input=patch)
        if applied.returncode != 0:
            print(f"{path}: git apply --cached FAILED\n{applied.stderr}")
            sys.exit(1)
    if dry:
        print(f"\n--dry-run: would stage {total} objc hunk(s); index untouched")
        return
    print(f"\nstaged {total} objc hunk(s) across {len(RULES)} shared file(s)")
    # The foreign hunks must still be UNSTAGED. That is the invariant.
    for path in RULES:
        cpp = "cpp" if "differential" in path else "cpp mutant"
        staged = run(["git", "diff", "--cached", "--", path]).stdout
        left = run(["git", "diff", "--", path]).stdout
        n_staged = len(split_hunks(staged)[1]) if staged.strip() else 0
        n_left = len(split_hunks(left)[1]) if left.strip() else 0
        print(f"{path}: {n_staged} hunk(s) staged, {n_left} left unstaged ({cpp} must be among them)")
    leaked = run(["git", "diff", "--cached", "--"] + list(RULES), cwd=".").stdout
    if "deriveCppBareUses" in leaked or 'language: "cpp"' in leaked:
        print("FATAL: foreign cpp content is staged — aborting before commit")
        sys.exit(1)
    print("invariant holds: no foreign cpp content staged")


if __name__ == "__main__":
    main()

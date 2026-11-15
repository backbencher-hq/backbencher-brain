#!/usr/bin/env python3
"""
CSS U4 DECLARATION SEARCH — is a `references` target the css analyzer could not
resolve a MISSED DECLARATION, or a name no ADMITTED stylesheet declares?

## Why this file exists

`css-incoming-split.ts` measures that the lane's `references` edges split into 819 edges
over 178 names that bind to no published symbol anywhere in the 1,286-file admitted corpus
(U4) and 167 edges over 40 names present only outside the 600-file window (U3). An
unresolved count is not a verdict: it is the same number whether the analyzer missed a
declaration or the stylesheet reads a property nobody ever wrote.

This probe separates the two. It searches for `<name>:` — a DECLARATION of the custom
property, not a mention of it — across every git-tracked file in the corpus, and then
answers the only question that matters: **is the file holding that declaration one the css
analyzer was ever given?**

## The admission rule is load-bearing, and getting it wrong inverts the answer

The corpus walk admits a file only when it is git-tracked, a real directory, **<= 512 KB**,
and `detectLanguageFromPath(abs, text) === "css"`. `bulma/css/bulma.css` is 763,923 bytes
and is therefore NOT in the population — and it is where `--h:`, `--s:` and `--l:` are
actually declared. A probe that ignores the size limit reports three analyzer GAPs that are
population artifacts, which is the `unresolved`-chasing trap the round brief names, walked
in the opposite direction. So a hit counts as a candidate GAP only when the declaring file
is itself admitted.

## The one result that would be a defect

A `<name>:` declaration in an ADMITTED `.css` file the analyzer published no symbol for.
That is a GAP and it is the lane's to fix. A hit in a non-admitted file, or only in a
non-CSS file (`.scss`, `.js`, a `tailwind.config.js`, a lockfile), is a population fact:
the reference edge is still TRUE and the store cannot bind it because no css-language
symbol exists. No hit anywhere is a genuinely undeclared read.

## POSITIVE CONTROL — a probe that finds nothing proves nothing until shown to find
## something. The control set is drawn from the instrument's OWN U1 bucket: target names the
## analyzer published declarations for, in admitted `.css` files. All 20 must be found.

## Method

One `git grep -n -F -e <name>: ...` per repository with every name in a single invocation,
so each repo's object store is walked once rather than once per name. `-n` makes the output
`path:line:content`, which attributes a hit to a name by fixed-string containment on the
content — no second pass, and no regex. `-F` is a fixed-string match throughout: this probe
searches for the declaration of a NAME, and no regex can make that measurement more honest.

## READ-ONLY with respect to the corpus.
"""
import json
import os
import subprocess
import sys

CR = os.environ.get("BB_CORPUS_ROOT", "/home/ishaq2321/bb_tests/repositories")
SIZE_LIMIT = 512 * 1024
SPLIT = sys.argv[1] if len(sys.argv) > 1 else "validation/m14/measurements/css-incoming-split-600.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "validation/m14/measurements/css-u4-declaration-search.json"

split = json.load(open(SPLIT))

# name -> the types it was unresolved for, so a reader can tell a `references` custom
# property from an `imports` module specifier. The split artifact stores U4 per type, so
# this is a lookup rather than a re-derivation.
name_types = {}
for tname, trow in split["types"].items():
    for a in trow["absentTop"]:
        name_types.setdefault(a["target"], []).append(tname)

names = sorted(name_types)
control = [c["target"] for c in split["types"]["references"]["collisions"][:20]]
print(f"U4 names to search: {len(names)} | control: {len(control)}", file=sys.stderr)

all_names = names + control
pats = []
for n in all_names:
    pats += ["-e", n + ":"]

repos = sorted(e for e in os.listdir(CR) if os.path.isdir(os.path.join(CR, e)))
# name -> list of {repo, path, admittedCss}
hits = {}
timeouts = []

for repo in repos:
    d = os.path.join(CR, repo)
    try:
        subprocess.run(["git", "-C", d, "rev-parse", "--git-dir"], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=True)
    except Exception:
        continue
    cmd = ["git", "-C", d, "grep", "-n", "-F"] + pats + ["--"]
    try:
        # errors="replace": the corpus contains non-UTF-8 blobs (a Latin-1 CSS file
        # aborts the decode), and a probe that dies on one bad byte reports a number for
        # fewer repos than it claims to have scanned.
        r = subprocess.run(cmd, capture_output=True, text=True, errors="replace", timeout=900)
    except subprocess.TimeoutExpired:
        timeouts.append(repo)
        print(f"  TIMEOUT {repo}", file=sys.stderr)
        continue
    for line in r.stdout.splitlines():
        if not line.strip():
            continue
        # `path:lineno:content`, git's own format: split at the FIRST two colons, never
        # from the right. rsplit(":", 2) on `a.css:14:  --x: red;` yields
        # ['a.css:14', '  --x', ' red;'] — the declaration's own colon eats the split, the
        # attribution finds nothing, and the probe reports 0 hits for a name declared
        # 118 times. That is not a hypothetical: it is what the first two runs of this
        # file did, which is why the positive control exists.
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        path, _lineno, content = parts
        for n in all_names:
            probe = n + ":"
            if probe in content:
                low = path.lower()
                size = None
                try:
                    size = os.path.getsize(os.path.join(d, path))
                except OSError:
                    pass
                admitted = low.endswith(".css") and size is not None and size <= SIZE_LIMIT
                hits.setdefault(n, []).append(
                    {"repo": repo, "path": path, "bytes": size, "admittedCss": admitted}
                )

rows = []
for n in names:
    found = hits.get(n, [])
    admitted = [f for f in found if f["admittedCss"]]
    nonadmitted = [f for f in found if f["path"].lower().endswith(".css") and not f["admittedCss"]]
    other = [f for f in found if not f["path"].lower().endswith(".css")]
    rows.append({
        "name": n,
        "types": name_types[n],
        "declaredInAdmittedCss": len(admitted),
        "declaredInNonAdmittedCss": len(nonadmitted),
        "declaredInNonCssFile": len(other),
        "admittedCssSample": [f"{f['repo']}/{f['path']}" for f in admitted[:5]],
        "nonAdmittedCssSample": [f"{f['repo']}/{f['path']} ({f['bytes']} bytes)" for f in nonadmitted[:3]],
        "nonCssSample": [f"{f['repo']}/{f['path']}" for f in other[:3]],
    })

control_rows = []
for n in control:
    found = [f for f in hits.get(n, []) if f["admittedCss"]]
    control_rows.append({"name": n, "declaredInAdmittedCss": len(found),
                         "sample": [f"{f['repo']}/{f['path']}" for f in found[:2]]})

summary = {
    "reposScanned": len(repos),
    "reposTimedOut": timeouts,
    "u4Names": len(names),
    "declaredInAdmittedCss": sum(1 for r in rows if r["declaredInAdmittedCss"] > 0),
    "declaredOnlyInNonAdmittedCss": sum(1 for r in rows if r["declaredInAdmittedCss"] == 0 and r["declaredInNonAdmittedCss"] > 0),
    "declaredOnlyInNonCssFile": sum(1 for r in rows if r["declaredInAdmittedCss"] == 0 and r["declaredInNonAdmittedCss"] == 0 and r["declaredInNonCssFile"] > 0),
    "declaredNowhere": sum(1 for r in rows if r["declaredInAdmittedCss"] == 0 and r["declaredInNonAdmittedCss"] == 0 and r["declaredInNonCssFile"] == 0),
    "controlNames": len(control_rows),
    "controlFoundInAdmittedCss": sum(1 for r in control_rows if r["declaredInAdmittedCss"] > 0),
}
print(json.dumps(summary, indent=2))
json.dump({"tool": "css-u4-declaration-search", "summary": summary, "names": rows,
           "positiveControl": control_rows}, open(OUT, "w"), indent=2)
print(f"wrote {OUT}")
#!/usr/bin/env python3
"""Rebuild verify-probe-battery.ts as HEAD + ONLY this lane's F9 additions.

`script/m14/verify-probe-battery.ts` is the family-wide F9 registry: every lane
appends its probes. In this working tree it carries the objc lane's additions AND
a cpp lane's two probes whose oracle (`deriveCppBareUses`) is NOT being committed,
so a whole-file add would publish a battery that cannot run at HEAD. The cpp
probes also extracted `oracleFor`'s wasm lookup into a LANGS read; that refactor is
theirs, and this lane's own enablement was a `cfgs` entry — so the rebuilt file
keeps HEAD's `cfgs` map plus `objc`, which is what actually ran at 29/29.

Output goes to /tmp (and a sibling for the verification run); the live shared file
is never opened for writing.
"""
import subprocess
import sys

HEAD_PATH = "script/m14/verify-probe-battery.ts"
WORK = "script/m14/verify-probe-battery.ts"
OUT = "/tmp/oc-battery-mine.ts"

OBJC_START = "── M60 objc (#D): a parameter's DECLARED NAME is never a value read"
CPP_START = "── M37.19 (#612) cpp: a template-wrapped DECLARATOR NAME is not a read"
F7_MARKER = "// ── F7 detector self-test: regexes regress like any code"
HEAD_DOC_LINE = " * (haskell HSD12\u2013HSD19, csharp CSD1\u2013CSD12, php relative_scope, kotlin K1\u2013K8)."
MINE_DOC_LINE = (
    " * (haskell HSD12\u2013HSD19, csharp CSD1\u2013CSD12, php relative_scope, kotlin K1\u2013K8,\n"
    " * M60 objc: a block-pointer parameter declaration read as a value, and the\n"
    " * production entry's noise filter eating every selector target that ends in ':')."
)
HEAD_CFGS_PREFIX = "const cfgs: Record<string, string> = { csharp:"
MINE_CFGS_PREFIX = 'const cfgs: Record<string, string> = { objc: "tree-sitter-objc.wasm", csharp:'


def index_of(lines, needle):
    hits = [i for i, l in enumerate(lines) if needle in l]
    if len(hits) != 1:
        print(f"FATAL: {needle!r} matched {len(hits)} line(s); expected exactly 1")
        sys.exit(1)
    return hits[0]


def main():
    head = subprocess.run(["git", "show", f"HEAD:{HEAD_PATH}"], capture_output=True, text=True, check=True).stdout.split("\n")
    work = open(WORK, encoding="utf8").read().split("\n")

    start = index_of(work, OBJC_START)
    cpp = index_of(work, CPP_START)
    block = work[start:cpp]  # my two probe blocks, ending with their trailing blank line
    print(f"extracted {len(block)} line(s) of objc probe code (worktree lines {start + 1}..{cpp})")
    if not any("F9-PROBE-OBJC-PARAM-DECL" in l for l in block):
        print("FATAL: block does not contain the objc PARAM-DECL probe")
        sys.exit(1)
    if not any("F9-PROBE-OBJC-PRODUCTION-SELECTOR" in l for l in block):
        print("FATAL: block does not contain the objc PRODUCTION-SELECTOR probe")
        sys.exit(1)
    if any("F9-PROBE-CPP-" in l for l in block):
        print("FATAL: block leaked a cpp probe")
        sys.exit(1)

    # 1. docstring
    doc = index_of(head, HEAD_DOC_LINE)
    head[doc] = MINE_DOC_LINE
    # 2. cfgs: the lane's own enablement, on HEAD's map
    cfgs = index_of(head, HEAD_CFGS_PREFIX)
    head[cfgs] = head[cfgs].replace(HEAD_CFGS_PREFIX, MINE_CFGS_PREFIX)
    # 3. my probes, before the F7 self-test
    f7 = index_of(head, F7_MARKER)
    out = head[:f7] + block + head[f7:]

    text = "\n".join(out)
    open(OUT, "w", encoding="utf8").write(text)
    print(f"wrote {OUT}: {len(out)} lines")
    print(f"  cfgs line: {out[cfgs].strip()[:110]}")
    print(f"  probes inserted at line {f7 + 1}")
    for probe in ("F9-PROBE-OBJC-PARAM-DECL", "F9-PROBE-OBJC-PRODUCTION-SELECTOR", "F9-PROBE-CPP-", "deriveCppBareUses", "LANGS?."):
        n = sum(1 for l in out if probe in l)
        print(f"  occurrences of {probe!r}: {n}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""script/merge/witness-batch.py — generate a pre-C1 witness batch for battery steps.

A battery red is only *attributed* once the same step has been run at pre-C1 (the merge
commit 9cc08afd, before this line's containment fix) and its failure lines compared. The
harness that did that for the first ~90 reds skipped anything heavy or corpus-writing;
this generator produces the follow-up batch for the reds that are still unwitnessed but
safe to re-run read-only: lane gates, closures, self-tests, doc/site gates — never the
corpus sweeps or the giant-repo benches, which would write shared index state.

Usage: python3 script/merge/witness-batch.py /tmp/attr8 \
           --steps 23,179,181,...  [--exclude 11,16,60,148,149,151,152] [--timeout 900]
The generated runner is a plain bash file: run it with `setsid bash <file>` and poll its
bulk log; the battery artifact script reads `STEP n our_dur=Ns pre-c1 exit=R :: cmd`
lines from it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

STATUS_LINE = re.compile(r"^STEP (\d+) exit=(\d+) (\d\d:\d\d:\d\d)-(\d\d:\d\d:\d\d) :: (.*)$")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tag", help="batch tag, e.g. /tmp/attr8 (logs become <tag>-s<n>.log)")
    ap.add_argument("--steps", default="", help="explicit step numbers (comma-separated)")
    ap.add_argument("--from-artifact", default="", help="read the unwitnessed reds from a battery artifact JSON instead")
    ap.add_argument("--status", default="/tmp/verify-c2-suite-status.txt", help="step -> command source")
    ap.add_argument("--exclude", default="", help="step numbers to leave unwitnessed, with the reason recorded in the artifact")
    ap.add_argument("--pre-c1", default="/tmp/pre-c1")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()

    cmds: dict[int, str] = {}
    for line in open(args.status, encoding="utf8"):
        m = STATUS_LINE.match(line.rstrip("\n"))
        if m:
            cmds[int(m.group(1))] = m.group(5)

    if args.from_artifact:
        art = json.load(open(args.from_artifact, encoding="utf8"))
        steps = [r["step"] for r in art["steps"] if r["class"] == "no-witness"]
    else:
        steps = [int(s) for s in args.steps.split(",") if s.strip()]
    excluded = {int(s) for s in args.exclude.split(",") if s.strip()}
    steps = [s for s in steps if s not in excluded and s in cmds]

    out = args.tag + "-runner.sh"
    bulk = args.tag + "-bulk.log"
    with open(out, "w", encoding="utf8") as f:
        f.write("#!/usr/bin/env bash\n")
        f.write(f": > {bulk}\n")
        for n in steps:
            cmd = cmds[n].replace('"', '\\"')
            log = f"{args.tag}-s{n}.log"
            f.write(f'log={log}\n')
            f.write(f'(cd {args.pre_c1} && PATH=$HOME/.bun/bin:$PATH timeout {args.timeout} bash -c "{cmd}" > "$log" 2>&1); rc=$?\n')
            f.write(f'echo "STEP {n} our_dur=?s pre-c1 exit=$rc :: {cmd}" >> {bulk}\n')
        f.write(f'echo "WITNESS-BATCH DONE $(date +%H:%M:%S)" >> {bulk}\n')
    os.chmod(out, 0o755)
    print(f"wrote {out}: {len(steps)} steps ({sorted(steps)})")
    print(f"bulk log: {bulk}; excluded from this batch: {sorted(excluded)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

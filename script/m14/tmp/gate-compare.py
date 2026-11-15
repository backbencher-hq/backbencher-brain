#!/usr/bin/env python3
"""
Compare a candidate grammar reading against a recorded floor, and FAIL when the
corpus aggregate drops.

Deliberately a standalone file rather than a heredoc inside the shell gate: the
heredoc form was the source of a real, confusing failure (the comparator read a
half-written artifact and raised a bare KeyError, which the gate reported as a
crash with no indication of which file was at fault). A file can be run on its
own, which is how a reader checks the instrument instead of trusting it.

Usage: gate-compare.py <floor.json> <candidate.json>
Exit:  0 pass · 1 aggregate fell below the floor · 2 no movement · 3 unusable input
"""
import json
import sys

REQUIRED = ("corpora", "aggregate")


def load(path):
    try:
        with open(path) as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001 - the reason must be printed, not swallowed
        print(f"FATAL: cannot read {path}: {exc}")
        sys.exit(3)
    for key in REQUIRED:
        if key not in data:
            print(f"FATAL: {path} has no {key!r} -- it is a partial artifact, not a reading.")
            print(f"       keys present: {sorted(data.keys())}")
            print("       Re-record it with --accept; never hand-edit it.")
            sys.exit(3)
    return data


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 3
    floor = load(sys.argv[1])
    cand = load(sys.argv[2])
    f_agg, c_agg = floor["aggregate"], cand["aggregate"]
    delta = round(c_agg["cleanPct"] - f_agg["cleanPct"], 2)

    print("")
    print("corpus            floor clean%   cand clean%   delta")
    for c in cand["corpora"]:
        if c.get("missing"):
            continue
        name = c["name"]
        f_row = next((x for x in floor["corpora"] if x["name"] == name), None)
        if f_row is None:
            print(f"{name:18}{'(new)':>13}{c['cleanPct']:>13}")
            continue
        d = round(c["cleanPct"] - f_row["cleanPct"], 2)
        print(f"{name:18}{f_row['cleanPct']:>13}{c['cleanPct']:>13}{('+' if d > 0 else '')}{d:>7}")

    print(f"{'AGGREGATE':18}{f_agg['cleanPct']:>13}{c_agg['cleanPct']:>13}"
          f"{('+' if delta > 0 else '')}{delta:>7}")

    # Crash files are a correctness floor of their own, independent of clean%:
    # a grammar that throws is worse than one that mis-parses, and a clean%
    # improvement must not be allowed to buy one.
    if c_agg["crash"] > f_agg["crash"]:
        print("")
        print(f"GATE FAILED: crash files rose {f_agg['crash']} -> {c_agg['crash']}.")
        return 1
    if c_agg["crash"] > 0:
        print("")
        print(f"GATE FAILED: {c_agg['crash']} crash file(s). Any crash is a failure.")
        return 1

    if delta < 0:
        print("")
        print(f"GATE FAILED: the corpus aggregate fell {abs(delta)} points below the floor.")
        print("Green repro cases are not evidence that the grammar is better -- the corpus is.")
        return 1
    if delta == 0:
        print("")
        print("NO MOVEMENT. If this change was meant to help, it never reached the corpus.")
        return 2
    print("")
    print(f"GATE PASSED (+{delta})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

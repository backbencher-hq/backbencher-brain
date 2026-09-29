#!/usr/bin/env python3
"""script/merge/battery-artifact.py — fold a merge's battery runs into one artifact.

Inputs (all produced by runs recorded in the merge review document):

  /tmp/verify-c2-suite-status.txt   "survey"  — the 345-step `npm run verify` chain,
                                                run inside the merge worktree while
                                                the merge line was being assembled.
  /tmp/sweep-c4-status.txt          "sweep"   — every step the survey found red,
                                                re-run in a clean worktree at
                                                a943047e (pre-landing content).
  /tmp/final-suite-status.txt       "final"   — all 345 steps, run in a clean
                                                worktree carrying the evidence
                                                commit's content.
  /tmp/attr6-*.log … /tmp/attr9-*.log        — pre-C1 witnesses: the same steps run
                                                at 9cc08afd (before the containment
                                                fix), used to decide inheritance.
                                                attr9 covers steps 4 and 7, the setup
                                                half the batches began at 8.
  /tmp/attr-*.log, /tmp/attr2-*.log, ...      — single-gate witnesses (EXTRA_WITNESSES).

Output: reviews/merge/<ledger-slug>-battery.json

Design rules this file keeps:

  - Three runs, three separate verdicts per step. They differ in exactly the ways a
    reader must be able to see: the survey ran on a moving tree (gates write records
    while the chain runs), the sweep ran on the clean pre-landing tree, the final run
    ran on the evidence commit's content. A step whose verdict moves between runs is
    a finding, never averaged away.
  - Inheritance is decided by re-running the step at pre-C1 and comparing the
    failure-line SETS, and the artifact carries both sets (canonicalized, capped) so
    the comparison is checkable from the artifact alone — the /tmp logs it was
    computed from are scratch, and an artifact that points at scratch is not evidence.
  - Canonicalization is limited to volatile tokens (temp paths, hex ids, clocks,
    ports, pids), which differ between two runs of the same gate by construction. Both
    the raw counts and the canonical sets are recorded, and the rule is named here.
  - A step that PASSED at pre-C1 is recorded as such: that is the interesting case
    (something after 9cc08afd — this line, or the state the survey itself wrote —
    turned it red), and it is never silently folded into "inherited".
  - Kills are recorded as kills: the sweep bounds every step with `timeout`, and two
    steps block on a network wait in this environment.

Usage: python3 script/merge/battery-artifact.py [--out reviews/merge/<name>.json]
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys

STATUS_LINE = re.compile(r"^STEP (\d+) exit=(\d+) (\d\d:\d\d:\d\d)-(\d\d:\d\d:\d\d) :: (.*)$")
# Two formats appear in the witness bulk logs: the batch runners write
# `STEP n our_dur=Ns pre-c1 exit=R :: cmd` and the earliest single-step runs write
# `STEP n pre-c1 exit=R :: cmd`. Both are witnesses; neither may be silently skipped.
WITNESS_LINE = re.compile(r"^STEP (\d+)(?: our_dur=(\S+)s)? pre-c1 exit=(-?\d+) :: (.*)$")
# Failure markers seen in the gate logs. `BAD` is the m40 gate-selftest's own marker (the
# attr8 witness for step 221 is a list of OK/BAD lines) and `sample-moved` is F10's
# disclosed state: a corpus lane whose sample digest changed is NOT compared, which is the
# honest verdict (exit 2) rather than a pass or a failure.
FAIL_LINE = re.compile(r"FAIL|✗|❌|\bBAD\b|sample-moved|uncaught|Traceback|TypeError|ReferenceError|SyntaxError|exit=\d|\d+ failed")
EXIT_LINE = re.compile(r"exit=(-?\d+)\s*$")

MAX_LINES = 12
MAX_LINE_CHARS = 240

# Gates the runs killed on purpose (the sweep bounds every step with `timeout`).
KILLED = {
    322: ("blocked in this environment, and killed by the operator in the survey: the step hangs on a network wait (idle event "
          "loop, no child process) after 30 min. The hang is reproducible — a standalone re-run at this commit's content parked "
          "at `G1: the M44/M53 bars` for 17+ min, idle, no child, and had to be stopped. The final run is the one run that "
          "completed it, and that verdict is red (KNOWN-GAP, 13/16) with three failures, the first provably INHERITED: "
          "`evidence-stale:T1(src/lsp/graph_request.ts)` — and both validation/m55/results/T1.json and src/lsp/graph_request.ts "
          "are byte-identical from 9cc08afd to HEAD, so the same check fails at the merge commit — plus the M44/M53 bars, part "
          "of the governance cascade the review names. Recorded as a kill because that is the step's own environment "
          "behaviour; the verdict it did reach is in the `final` column and `finalFailureSample`."),
    339: ("blocked in this environment, and killed by the operator in the survey (9 open sockets). It reaches a verdict when "
          "the wait clears, and that verdict is red on BOTH sides: the final run's `M61.X1` is `KNOWN-GAP` (18/27), and a "
          "standalone re-run at this commit's content is red re-executing the m24/m29/m42/m44/m55 closures; a pre-C1 run at "
          "9cc08afd fails the SAME checks (`M61.G1` `KNOWN-GAP` 37/44 against the final run's 32/44, and the same "
          "`hollow-known-gap:G1|V2|V3|V6` ledger set) — i.e. inherited, with numeric drift. The failures are the "
          "governance/closure stamp cascade the review names (a lane ledger stamped on one line, its records on disk from "
          "another), not a defect this line introduced. Recorded as a kill because of the environment block; the verdict is "
          "in the `final` column."),
}

# Steps that passed at pre-C1 are NOT listed by hand: the witness data decides. (An earlier
# draft carried a hand-written state-induced set here; the parsed witnesses showed two of its
# entries were red at pre-C1 as well, so the hand list was the thing that was wrong.)

# Step 8 is the one red this merge line fixed (the measurements left the evidence
# namespace); named here so the artifact says so instead of leaving it unclassified.
FIXED_BY_LINE = {8: "the merge line's own fix: the measurement records left validation/m14/results/ (commit e32ceaac)"}

# Steps the witness harness excludes by design: they write shared corpus/index state (or read
# a corpus checkout another lane rotates), so a witness run could corrupt the very state this
# battery measures. For these the evidence is the survey-vs-sweep agreement: two runs, two
# different trees, identical failure sets.
CROSS_RUN_EXCLUSION = {
    11: "audit:differential walks all 50 corpus lanes and writes their artifacts",
    16: "audit:completeness walks every corpus language's parse tree",
    60: "the m13 patterns e2e gate indexes a corpus checkout",
    148: "reads the giant aspnetcore index",
    149: "reads the 8 GB intellij index",
    151: "reads the giant index built by the previous step",
    152: "reads the giant index built by the previous step",
}

# Steps that pass when run ALONE in any tree and fail in EVERY full-chain run, because the
# chain's own earlier steps rewrite the records they read. Two families, both measured, not
# asserted:
#   - the m19 trio (153-155): the final run's own timestamps show 148 (01:19:33) and 149
#     (01:20:14) writing S2/S3 — and 147/155 S1 — with verified=false and files/symbols 0 (the
#     giant corpora's indexes are not provisioned on this machine), then 153/154/155
#     (01:20:22-25) reading those rewritten bytes and failing; the pre-C1 witness tree ran the
#     trio WITHOUT 147-152, saw the committed records (verified=true), and passed.
#   - the m61/m62 tail (335/336/337, and 344 as its downstream): the chain re-runs the m27
#     nvim gate, which this environment cannot provision (`nvim not provisioned in .tools/`),
#     and the gate REWRITES validation/m27/results/N1.json from {checks:31, claimLevel:I3,
#     failed:0} to a 1-check blocked stub; the lint's can-fail census counts `M:` proofs FROM
#     those records, so the later gates read proofs that are no longer there. Each of
#     335/336/337 was re-run alone at this commit's content and passes (32/32, 37/37, 22/22).
# Either way the isolated exit is evidence about the chain's ORDER, not about this tree; a
# `passed-at-pre-C1` reading of such an exit would blame this tree for the harness's own order.
CHAIN_STATE = {
    153: ("`m19` bench-doc gate: reads S1/S2/S3 and the bench docs. Its isolated runs pass in every tree "
          "(pre-C1 at 9cc08afd and the tip alike) because the committed records say `verified=true`; every "
          "full-chain run is red because the chain's own steps 147-152 rewrite those records first "
          "(`verified=false`, `files`/`symbols` 0, the giant indexes absent here). The pre-C1 exit is evidence "
          "about the chain's order, not about this tree."),
    154: ("`m19` closure gate: same mechanism as 153 — it reads S2/S3/Q1/Q2, which the chain's steps 148/149 "
          "(and 154 itself) rewrite before it reads them. Red in survey, sweep and final; green when run alone."),
    155: ("`m19` mutation gate: same mechanism — it reads X9 and the S records the chain rewrites. Red in "
          "survey, sweep and final; green when run alone (verified by running 153-155 in the pre-C1 tree, "
          "which has the committed bytes and none of steps 147-152 before them)."),
    335: ("`m61` lint: VERIFIED (32/32) when run alone at this commit's content, red in every full-chain run. "
          "The chain's own m27 step re-runs the nvim gate, which is not provisioned here "
          "(`nvim not provisioned in .tools/`, D-7 portable layout), and REWRITES validation/m27/results/"
          "N1.json from {checks:31, claimLevel:I3, failed:0} to a 1-check blocked stub (and X1.json from "
          "barViolations:[] to two violations). The lint's can-fail census counts `M:` proofs FROM those "
          "records (`canFailProofs` reads checksList/mutantsCaught), so the rewritten N1 no longer carries "
          "them and G4/G0 fire. Evidence about the chain's order, not about this tree."),
    336: ("`m61` claims: same mechanism as 335 — it reads the m27/m28/m44 records the chain's own gates "
          "rewrite here. VERIFIED (37/37) when run alone at this commit's content; red in the full chain "
          "(36/37), where C2 sees `m44-x1/m27-mutants/m28-mutants: published 0 rows`."),
    337: ("`m61` extinction: VERIFIED (22/22) when run alone at this commit's content, and green in the clean "
          "C4 sweep (which ran it with none of the chain's earlier steps before it), red only in the "
          "full-chain survey and final runs. Same mechanism: it reads records the chain rewrites."),
    344: ("`m62` governance: VERIFIED (22/22) when run alone at this commit's content, red in the full chain "
          "(20/22) at `R1: prerequisite M55/M61 bar ... status=known-gap` — downstream of the m53/m55/m61 "
          "gates the chain re-runs, which leave their own records at known-gap in this environment."),
}

# Bounds that ended a step instead of a verdict.
BOUND_EXITS = (124, 143)

# Steps whose section in the final-run log carries output that is NOT the step's own (a
# concurrent job writing to the same shared log path). Recorded per step in `logAnomalies`.
LOG_ANOMALY_STEPS = (4,)

# Steps whose witness is a RECORD rather than a run: the red is visible in a record this
# merge took from the other line, which is checkable in-repo with `git show <commit>:<path>`.
RECORD_WITNESSES = {
    10: {
        "kind": "record",
        "record": "validation/m14/results/M14.0.F4.json",
        "atCommit": "9cc08afd",
        "field": "data.summary",
        "value": {"caught": 885, "mutantsRun": 891, "survived": 6},
        "note": ("the mutation harness's red is the six surviving erlang mutants; the F4 record this merge took from main "
                 "(generated on the other line) reports the same 885 caught / 891 run / 6 survived, so the red predates this line"),
    },
    290: {
        "kind": "record-and-run",
        "run": "passes at pre-C1 (attr7)",
        "note": ("reads as a left-behind fixture mutation: '5 leak(s)' and 'the fixture passes again after all mutants were "
                 "restored'; re-measured in the final run, where a clean worktree starts without the leak"),
    },
    333: {
        "kind": "record-and-run",
        "run": "passes at pre-C1 (attr7)",
        "note": ("the M61 lock suite's L5 contention laws; the survey's own output shows the stale-lock breaker firing "
                 "(BB_GATE_BREAK_STALE_LOCK, holder pid 999999, age 1970); re-measured in the final run"),
    },
}

# Hand review of the steps whose failure SETS differ from pre-C1, kept verbatim so the
# artifact says what was actually read rather than a ratio alone. `REVIEW_VERDICTS` are
# the reviews that conclude inheritance despite unequal sets (drift in numbers, paths,
# or detail dumps); `REVIEW_NOTES` are notes attached without changing the verdict.
REVIEW_VERDICTS = {
    119: ("inherited", "the shared root failure is 'public registry has exactly ten tools' (the 16-tools-vs-10 surface conflict); "
                      "pre-C1 additionally carried two MCP-session errors this run never reaches, so ours is the narrower red"),
    162: ("inherited", "both named failures are identical by id in both runs; only the JSON detail dumped under the second one differs"),
    185: ("inherited", "one check, numeric drift: 'load 44.1' vs 'load 46.9' and different stats on the latency-budget line; the summary line is identical"),
    250: ("inherited", "the same two checks fail in both runs (a JSON.stringify TypeError and warm-budget overshoots); only the measured milliseconds moved"),
    60: ("inherited", "eight failure lines in both runs, including 'framework types detected in index → framework patterns emitted'; "
                      "the only difference is the order of the comma-separated framework list inside one line"),
    179: ("inherited", "`audit:honesty` is red at pre-C1 for a SUPERSET of reasons (12 lines): the same F1/F3/F5 input-drift rows this "
                       "line's battery regenerates, plus the banned groovy term and the F7/F8 layer collision — both of which other "
                       "fixes upstream of this commit resolved, which is why this run has fewer lines than pre-C1"),
    330: ("inherited", "the same M56 X1 batch-commit checks fail in both runs (not-pass S1/I1/D2, commits not uniform, no batch commit); "
                       "ours carries one extra check about M41's uniformity, added since pre-C1"),
    338: ("inherited", "the same ledger check fails in both (`V3 re-executes green`, `the ledger validates WHOLE`); ours lists more "
                       "KNOWN-GAP gates (V2, V3, V6) because the merged tree carries more of the M61 suite's own reds"),
    87: ("inherited", "the same two audit checks fail in both runs (`audit total fixture facts matches sweep`, `zero unknown symbols "
                      "across sweep`); the per-language `differential passes` rows move from 5 lanes to 16, and the movement is this line "
                      "making the records honest, not the merge breaking analyzers — measured on `origin/main` alone, which fails the "
                      "same 16 lanes with identical metrics (see externalMeasurements)"),
    284: ("inherited", "the same M49.G6 check is red on both sides; the summary moved from `72 passed, 8 failed` to `76 passed, 4 failed` "
                       "because this line re-anchored the register's three stale rows — the census's own four positions remain"),
}
REVIEW_NOTES = {
    44: "inherited, partially repaired: ours carries only the s1.json failure; the pre-C1 run also failed s3.json",
    162: "both named failures are identical by id in both runs; only the JSON detail dumped under the second one differs",
    190: "the first three failures are line-for-line identical; the ledger rows differ in the record content they print, not in check id",
    284: "the pre-C1 log records the same lineage failure with exit=1",
}

# Single-gate witnesses: steps run at pre-C1 by hand, one raw log each.
EXTRA_WITNESSES = {
    10: "/tmp/attr4-s10.log",
    110: "/tmp/attr2-verify-edit.ts.log",
    116: "/tmp/attr2-verify-mcp.ts.log",
    117: "/tmp/attr2-verify-contracts.ts.log",
    118: "/tmp/attr2-verify-mcp-e2e.ts.log",
    119: "/tmp/attr2-verify-m12-surface.ts.log",
    121: "/tmp/attr2-verify-registry-handlers.ts.log",
    283: "/tmp/attr3-script-integrity-pre-c1.log",
    284: "/tmp/attr3-verify-census-lineage-pre-c1.log",
    287: "/tmp/attr3-verify-sweep-state-freeze-pre-c1.log",
    289: "/tmp/attr3-verify-family-closure-truth-pre-c1.log",
}

VOLATILE = [
    (re.compile(r"/tmp/[^\s\"'\),;]+"), "‹tmp›"),
    (re.compile(r"\b[0-9a-f]{7,40}\b"), "‹hex›"),
    (re.compile(r"\b\d\d:\d\d:\d\d\b"), "‹clock›"),
    (re.compile(r":\d{2,5}\b"), ":‹port›"),
    (re.compile(r"\bpid \d+"), "pid ‹n›"),
]


def parse_status(path: str) -> dict[int, dict]:
    out: dict[int, dict] = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf8"):
        m = STATUS_LINE.match(line.rstrip("\n"))
        if not m:
            continue
        n, code, t0, t1, cmd = int(m.group(1)), int(m.group(2)), m.group(3), m.group(4), m.group(5)
        out[n] = {"exit": code, "startedAt": t0, "finishedAt": t1, "command": cmd}
    return out


def split_step_log(path: str) -> dict[int, str]:
    """`=== STEP n ::` sections of a suite log (the sweeps and the survey all write them)."""
    out: dict[int, str] = {}
    if not os.path.exists(path):
        return out
    cur, buf = None, []
    for line in open(path, encoding="utf8", errors="replace"):
        m = re.match(r"=== STEP (\d+) ::", line)
        if m:
            if cur is not None:
                out[cur] = "".join(buf)
            cur, buf = int(m.group(1)), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        out[cur] = "".join(buf)
    return out


def strip_foreign_block(text: str) -> tuple[str, dict]:
    """Remove a foreign block from a step section, and describe what was removed.

    The block is bounded by evidence rather than by line numbers, so the rule survives a
    re-run: it starts at the first `language parser loaded` line and ends at the first
    `error: script "audit:name-surface" exited with code 1` line after it. Checked against
    the sources: F10 loads its parsers itself and prints no such INFO line (a scoped F10
    probe writes zero of them), and it never invokes another gate's verifier, so both
    markers can only belong to the concurrent job that shares this log path.
    """
    lines = text.splitlines(keepends=True)
    start = end = None
    for i, ln in enumerate(lines):
        if start is None and "language parser loaded" in ln:
            start = i
        elif start is not None and 'error: script "audit:name-surface" exited with code 1' in ln:
            end = i
            break
    if start is None or end is None:
        return text, {}
    removed = lines[start:end + 1]
    return "".join(lines[:start] + lines[end + 1:]), {
        "removedLines": len(removed),
        "firstRemovedLine": re.sub(r"\s+", " ", removed[0]).strip()[:200],
        "lastRemovedLine": re.sub(r"\s+", " ", removed[-1]).strip()[:200],
        "boundsAreEvidence": ("the block starts at the first parser-load line and ends at the bun error line for "
                             "`audit:name-surface` exit 1; F10 — the step's own verifier — prints neither (a scoped F10 "
                             "probe writes zero parser-load lines) and invokes no other gate's verifier"),
    }


def failure_lines(text: str) -> list[str]:
    out = []
    for raw in text.splitlines():
        if raw.lstrip().startswith("==="):
            continue  # the suite's own step markers, not gate output
        if re.fullmatch(r"\s*exit=-?\d+\s*", raw):
            continue  # a witness runner's verdict line, not a failure line
        if not FAIL_LINE.search(raw):
            continue
        s = re.sub(r"\s+", " ", raw).strip()
        out.append(s[:MAX_LINE_CHARS])
        if len(out) >= MAX_LINES:
            break
    return out


def canonical(lines: list[str]) -> list[str]:
    out = []
    for s in lines:
        for rx, rep in VOLATILE:
            s = rx.sub(rep, s)
        out.append(s)
    return out


def digest(lines: list[str]) -> str:
    return hashlib.sha256("\n".join(lines).encode("utf8")).hexdigest()[:16]


def witness_map(bulk_logs: list[str]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for path in bulk_logs:
        if not os.path.exists(path):
            continue
        tag = os.path.basename(path)[4]
        for line in open(path, encoding="utf8"):
            m = WITNESS_LINE.match(line.rstrip("\n"))
            if m:
                out[int(m.group(1))] = {
                    "exit": int(m.group(3)),
                    "log": os.path.join("/tmp", f"attr{tag}-s{m.group(1)}.log"),
                }
    for step, path in EXTRA_WITNESSES.items():
        if not os.path.exists(path):
            continue
        text = open(path, encoding="utf8", errors="replace").read()
        exits = EXIT_LINE.findall(text)
        out.setdefault(step, {
            "exit": int(exits[-1]) if exits else None,  # a truncated log has no verdict; never invent one
            "log": path,
        })
    return out


# Measurements made OUTSIDE the three runs but needed to read a red correctly: provenance of
# a movement the runs disagree about. Each carries its tree, its command, and the numbers, so
# the claim is reproducible rather than asserted.
ORIGIN_MAIN = "8e3b12ff"
OUR_HEAD = "a943047e"
M12_LANES = ["c", "cpp", "go", "haskell", "javascript", "powershell", "rust", "svelte",
             "typescript", "vue", "zig", "csharp", "groovy", "java", "kotlin", "scala"]
M12_METRICS = {
    "c": (96, 17, 13), "cpp": (92, 5, 0), "go": (80, 20, 4), "haskell": (77, 2, 0),
    "javascript": (115, 3, 0), "powershell": (78, 0, 1), "rust": (100, 20, 4), "svelte": (81, 18, 0),
    "typescript": (230, 62, 3), "vue": (86, 32, 2), "zig": (107, 44, 0), "csharp": (208, 53, 11),
    "groovy": (157, 46, 19), "java": (148, 51, 19), "kotlin": (141, 75, 11), "scala": (188, 72, 8),
}
EXTERNAL_MEASUREMENTS = {
    "m12-fixture-differentials-ours-vs-origin-main": {
        "question": "does the 16-lane `passing.passed: false` movement belong to this merge line, or to main?",
        "trees": {"ours": OUR_HEAD, "origin/main": ORIGIN_MAIN},
        "method": ("`bun run script/m12/verify-analyzer.ts <lang>` for the sixteen lanes in a clean worktree at "
                   "origin/main (node_modules symlinked to the merge worktree's), then the same fields read from the "
                   "records committed at this line's head. The sixteen are exactly the union of the five lanes whose "
                   "records already said `passed: false` at the merge commit and the eleven the re-emission flipped."),
        "fields": ["passing.passed", "passing.metrics.observedResolved", "passing.metrics.falsePositive", "passing.metrics.falseNegative"],
        "result": {lang: {"ours": [False, *M12_METRICS[lang]], "origin_main": [False, *M12_METRICS[lang]], "identical": True} for lang in M12_LANES},
        "conclusion": ("all sixteen are identical on both trees: the fixture expectations no longer match the analyzers as main left "
                       "them, before this merge touched anything. The merge took main's sealed records, which claimed 36/41 passing at "
                       "2026-09-14 — stale claims a freshness check could not see, because those records declared no inputs."),
    },
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="reviews/merge/2026-09-25-main-into-recovery-battery.json")
    ap.add_argument("--survey-status", default="/tmp/verify-c2-suite-status.txt")
    ap.add_argument("--sweep-status", default="/tmp/sweep-c4-status.txt")
    ap.add_argument("--final-status", default="/tmp/final-suite-status.txt")
    ap.add_argument("--survey-log", default="/tmp/verify-c2-suite.log")
    ap.add_argument("--final-log", default="/tmp/final-suite.log")
    args = ap.parse_args()

    survey = parse_status(args.survey_status)
    sweep = parse_status(args.sweep_status)
    final = parse_status(args.final_status)
    witnesses = witness_map(["/tmp/attr6-bulk.log", "/tmp/attr7-bulk.log", "/tmp/attr8-bulk.log", "/tmp/attr9-bulk.log"])
    survey_out = split_step_log(args.survey_log)
    final_out = split_step_log(args.final_log)
    # One section of the final log carries a concurrent job's output (see LOG_ANOMALY_STEPS);
    # strip it before any comparison so the artifact never quotes another gate as this step's.
    anomaly_meta: dict[str, dict] = {}
    for n in LOG_ANOMALY_STEPS:
        if final_out.get(n):
            stripped, meta = strip_foreign_block(final_out[n])
            if meta:
                final_out[n] = stripped
                anomaly_meta[str(n)] = meta
    sweep_out = split_step_log("/tmp/sweep-c4.log")
    sweep_out_canon = {n: canonical(failure_lines(t)) for n, t in sweep_out.items()}

    steps = sorted(set(survey) | set(sweep) | set(final))
    rows = []
    counts = {"surveyGreen": 0, "surveyRed": 0, "sweepGreen": 0, "sweepRed": 0,
              "finalGreen": 0, "finalRed": 0, "green": 0, "red": 0, "killed": 0,
              "inherited": 0, "inheritedWithDrift": 0, "inheritedByRecord": 0,
              "inheritedByCrossRun": 0, "inheritedByReview": 0,
              "passedAtPreC1": 0, "differsAtPreC1": 0, "killedByBound": 0,
              "stateInduced": 0, "noWitness": 0, "redThenFixed": 0}
    for n in steps:
        row: dict = {"step": n}
        for name, table in (("survey", survey), ("sweep", sweep), ("final", final)):
            r = table.get(n)
            if r is None:
                row[name] = None
                continue
            row[name] = {"exit": r["exit"], "startedAt": r["startedAt"], "finishedAt": r["finishedAt"], "command": r["command"]}
            counts[f"{name}Green" if r["exit"] == 0 else f"{name}Red"] += 1
        row["command"] = (final.get(n) or sweep.get(n) or survey.get(n) or {}).get("command")

        verdicts = [t["exit"] for t in (row["survey"], row["sweep"], row["final"]) if t]
        red_anywhere = any(v != 0 for v in verdicts)
        final_red = bool(row["final"] and row["final"]["exit"] != 0)

        survey_red = bool(row["survey"] and row["survey"]["exit"] != 0)
        later_all_green = all(t["exit"] == 0 for t in (row["sweep"], row["final"]) if t)
        if not red_anywhere or (survey_red and later_all_green and n in FIXED_BY_LINE):
            row["class"] = "red-then-fixed" if n in FIXED_BY_LINE else "green"
            if n in FIXED_BY_LINE:
                row["note"] = FIXED_BY_LINE[n]
                counts["redThenFixed"] += 1
            else:
                counts["green"] += 1
            rows.append(row)
            continue

        counts["red"] += 1
        # Attach the final run's own failure sample to EVERY red row, before the class
        # branches: a kill (or a bound) is a property of the WITNESS run, not of the
        # final one, and the final run's verdict must stay visible on the row either way.
        if final_red and n in final_out:
            samples = canonical(failure_lines(final_out[n]))[:6]
            row["finalFailureSample"] = samples
            row["finalFailureSampleSha256"] = digest(samples)
        bounded = [name for name, t in (("survey", row["survey"]), ("sweep", row["sweep"]), ("final", row["final"])) if t and t["exit"] in BOUND_EXITS]
        if n in KILLED:
            row["class"] = "killed"
            row["note"] = KILLED[n]
            counts["killed"] += 1
            rows.append(row)
            continue
        if bounded:
            row["class"] = "killed-by-bound"
            note = (f"the {', '.join(bounded)} run's own `timeout` bound ended the step instead of a verdict "
                    "(exit=124): a bound is not a verdict, so this row is classified by the bound, not by a red it did not read. "
                    "Every run that DID reach a verdict is listed here, and those are the columns to compare.")
            finished = [f"{name} exit={t['exit']}" for name, t in
                        (("survey", row["survey"]), ("sweep", row["sweep"]), ("final", row["final"]))
                        if t and t["exit"] not in BOUND_EXITS]
            if finished:
                note += " Runs that reached a verdict: " + ", ".join(finished) + "."
            row["note"] = note
            counts["killedByBound"] += 1
            rows.append(row)
            continue

        # Witness comparison: our survey section against the pre-C1 log. A witness with
        # neither a verdict nor failure lines (a truncated scratch log) is not a witness.
        # Compare the pre-C1 run against the run of OURS that was red: a step can be green in
        # the survey (whose tree moved) and red in the sweep, and comparing the pre-C1 run
        # with a green one would call a shared failure "different". The run used is recorded.
        sweep_red = bool(row["sweep"] and row["sweep"]["exit"] != 0 and n in sweep_out)
        # The run of OURS to compare against the witness: the survey and the sweep carry the
        # pre-landing content, so they are preferred. Steps 1-7 were walked by no earlier run
        # at all — the survey began at 8 — and for those the final run is the only run of ours
        # that exists, so it is the comparison (recorded as `comparedRun`).
        if sweep_red:
            our_section, compared_run = sweep_out[n], "sweep"
        elif n in survey_out:
            our_section, compared_run = survey_out[n], "survey"
        elif n in final_out:
            our_section, compared_run = final_out[n], "final"
        else:
            our_section, compared_run = "", "survey"
        w = witnesses.get(n)
        pre_raw: list[str] = []
        if w:
            ours_raw = failure_lines(our_section)
            pre_raw = failure_lines(open(w["log"], encoding="utf8", errors="replace").read()) if os.path.exists(w["log"]) else []
            pre_c, ours_c = canonical(pre_raw), canonical(ours_raw)
            if (w["exit"] is None or w["exit"] in BOUND_EXITS) and not pre_c:
                # the witness run itself was killed (or left no verdict and no lines):
                # a kill is not a witness, so the step falls through to the other
                # evidence classes instead of being called inherited off a corpse.
                w = None
        if w and our_section:
            shared = sum(min(pre_c.count(x), ours_c.count(x)) for x in set(pre_c))
            smaller = min(len(pre_c), len(ours_c))
            ratio = (shared / smaller) if smaller else 0.0
            row["witness"] = {
                "preC1Exit": w["exit"],
                "preC1Log": os.path.basename(w["log"]),
                "comparedRun": compared_run,
                "preC1FailureLines": len(pre_raw),
                "ourFailureLines": len(ours_raw),
                "sharedFailureLines": shared,
                "overlapRatio": round(ratio, 3),
                "ourExit": (row.get(compared_run) or {}).get("exit"),
                "canonicalSetsEqual": pre_c == ours_c,
                "preC1SetContainedInOurs": all(ours_c.count(x) >= pre_c.count(x) for x in set(pre_c)) and bool(pre_c),
                "preC1SetSha256": digest(pre_c),
                "ourSetSha256": digest(ours_c),
                "canonicalization": "volatile tokens only: /tmp paths, 7-40 char hex ids, clocks, ports, pids",
                "preC1Lines": pre_c,
                "ourLines": ours_c,
            }
        wit = row.get("witness", {})
        reviewed = REVIEW_VERDICTS.get(n)
        if n in CHAIN_STATE:
            row["class"] = "state-induced"
            row["note"] = CHAIN_STATE[n]
            counts["stateInduced"] += 1
        elif wit.get("preC1Exit") == 0:
            row["class"] = "passed-at-pre-C1"
            row["note"] = ("the step PASSES at 9cc08afd, so this red is not inherited: either this line or the state the "
                           "survey wrote produced it. Read the final-run column before citing it. "
                           + RECORD_WITNESSES.get(n, {}).get("note", "")).strip()
            counts["passedAtPreC1"] += 1
        elif (wit and not wit.get("preC1Lines") and not wit.get("ourLines")
              and wit.get("preC1Exit") is not None and wit.get("preC1Exit") == wit.get("ourExit")):
            # Both sides end with the same exit code and neither prints a failure line: the
            # step's red is its OWN disclosed state (F10's `sample-moved`), present before
            # this line existed. The exit equality is what makes this inheritance rather
            # than a guess — two empty sets alone would be silence, not evidence.
            row["class"] = "inherited"
            row["note"] = (f"the pre-C1 witness and this line's {wit.get('comparedRun')} run both end with "
                           f"exit={wit.get('preC1Exit')} and no failure lines: the step's red is its own disclosed "
                           "state (a moved corpus sample), which both trees report identically.")
            counts["inherited"] += 1
        elif wit and not wit.get("preC1Lines") and wit.get("preC1Exit") == 1:
            row["class"] = "inherited"
            row["note"] = ("the pre-C1 log carries the exit code (1) and no failure lines — an exit-only witness: the step is red "
                           "on both sides, with the pre-C1 side's own output too truncated to quote.")
            counts["inherited"] += 1
        elif wit and wit.get("overlapRatio", 0) >= 0.8 and wit.get("ourLines"):
            row["class"] = "inherited" if wit["overlapRatio"] >= 1.0 else "inherited-with-drift"
            row["note"] = ("at least 80% of the smaller failure-line set is shared with the pre-C1 run (canonicalized for "
                           "volatile tokens only), so the merge line did not introduce this red"
                           + ("; hand review: " + (reviewed[1] if reviewed else REVIEW_NOTES.get(n, "")) if (reviewed or n in REVIEW_NOTES) else "."))
            counts["inherited" if row["class"] == "inherited" else "inheritedWithDrift"] += 1
        elif wit and reviewed and reviewed[0] == "inherited":
            row["class"] = "inherited-with-drift"
            row["note"] = ("the failure sets are not equal, but the hand review of both (recorded here) finds the same checks failing: "
                           + reviewed[1])
            counts["inheritedWithDrift"] += 1
        elif wit:
            row["class"] = "differs-at-pre-C1"
            row["note"] = ("witnessed, but less than 80% of the smaller failure-line set is shared with pre-C1; read both sets "
                           "in `witness`" + (". Hand review: " + REVIEW_NOTES[n] if n in REVIEW_NOTES else " — the red moved, and the movement is a finding."))
            counts["differsAtPreC1"] += 1
        elif n in RECORD_WITNESSES:
            row["class"] = "inherited-by-record"
            row["recordWitness"] = RECORD_WITNESSES[n]
            row["note"] = RECORD_WITNESSES[n]["note"]
            counts["inheritedByRecord"] += 1
        else:
            # No pre-C1 witness. The strongest evidence left is agreement between the survey
            # and the C4 sweep: two runs, two trees, same failure set.
            cross = None
            if n in survey_out and n in sweep_out_canon:
                a, b = canonical(failure_lines(survey_out[n])), sweep_out_canon[n]
                if a and a == b:
                    cross = {
                        "runs": ["survey", "sweep"],
                        "identicalFailureSet": True,
                        "failureLines": a,
                        "setSha256": digest(a),
                    }
                    row["crossRunAgreement"] = cross
            reviewed_nw = REVIEW_VERDICTS.get(n)
            if not cross and reviewed_nw and reviewed_nw[0] == "inherited":
                row["class"] = "inherited-by-review"
                row["note"] = ("no pre-C1 witness by design — " + CROSS_RUN_EXCLUSION.get(n, "the witness harness excludes this step") +
                               " — and the hand review of the two runs available finds the same failures: " + reviewed_nw[1])
                counts["inheritedByReview"] += 1
            elif cross:
                row["class"] = "inherited-by-cross-run"
                row["note"] = ("no pre-C1 witness by design — " + CROSS_RUN_EXCLUSION.get(n, "the witness harness excludes this step") +
                               " — but the survey and the clean C4 sweep fail with the identical failure set, on two different trees.")
                counts["inheritedByCrossRun"] += 1
            else:
                row["class"] = "no-witness"
                row["note"] = ("too heavy or too environment-bound for the witness harness, and the two runs available do not "
                               "agree line-for-line, so no pre-C1 run exists for it; carried as no-witness rather than assumed inherited.")
                counts["noWitness"] += 1

        rows.append(row)

    # Honesty about the scratch log itself. /tmp/final-suite.log is a shared path on a
    # machine that runs more than one lane; one foreign block was observed inside step 4's
    # section — a complete `bun run audit:name-surface` run (its parser-load lines, then its
    # corpus checks and `error: script "audit:name-surface" exited with code 1`), which F10
    # cannot produce (it loads no other gate's verifier; checked in its source). Step verdicts
    # are read from the suite's own status ledger, never from the log, so the block cannot
    # move one; it is recorded because a reader comparing the log to step 4 will meet it.
    log_anomalies = {
        str(n): {
            "log": os.path.basename(args.final_log),
            "what": ("a foreign block: a complete `bun run audit:name-surface` run appended into this step's "
                     "section (parser-load lines, then its corpus checks and the bun error line for exit 1). "
                     "The step's own output is present in the same section and its verdict is the ledger's."),
            "removedFromComparison": anomaly_meta[str(n)],
            "why_it_cannot_move_the_verdict": ("step exits are read from the suite's status ledger, which the suite "
                                               "process writes itself, and the block is stripped before any failure "
                                               "line is compared or quoted"),
        }
        for n in LOG_ANOMALY_STEPS if str(n) in anomaly_meta
    }

    artifact = {
        "schemaVersion": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "externalMeasurements": EXTERNAL_MEASUREMENTS,
        "artifact": "merge battery — the repository's `npm run verify` chain (345 steps) measured three ways over one merge line",
        "method": (
            "Every step of package.json's `verify` chain carries three separate verdicts. (1) survey: run inside the merge "
            "worktree while the merge line was assembled — its tree moved under it, because the gates write records while the "
            "chain runs, so its greens are not the commit's greens; (2) sweep: every survey-red step re-run in a clean worktree "
            "at a943047e (pre-landing content); (3) final: all 345 steps in a clean worktree carrying the evidence commit's "
            "content. Inheritance is decided against pre-C1 witnesses — the same step run at 9cc08afd, the merge commit before "
            "the containment fix — by comparing the SETS of failure lines, canonicalized for volatile tokens only (temp paths, "
            "hex ids, clocks, ports, pids) and carried in this file so the comparison is checkable without the scratch logs. A "
            "step that passes at pre-C1 is recorded as passed-at-pre-C1, never folded into 'inherited'. A step with no witness "
            "is recorded as no-witness. Kills are recorded as kills: the sweep bounds every step with `timeout`, and two steps "
            "block on a network wait in this environment."
        ),
        "counts": counts,
        "logAnomalies": log_anomalies,
        "steps": rows,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf8") as f:
        json.dump(artifact, f, indent=1)
        f.write("\n")
    print("battery artifact: "
          f"{len(rows)} steps — {counts['green']} green, {counts['red']} red/neutral "
          f"(inherited {counts['inherited']} + drift {counts['inheritedWithDrift']} + by-record {counts['inheritedByRecord']} "
          f"+ by-cross-run {counts['inheritedByCrossRun']} + by-review {counts['inheritedByReview']}, "
          f"no-witness {counts['noWitness']}, passed-at-pre-C1 {counts['passedAtPreC1']}, "
          f"state-induced {counts['stateInduced']}, "
          f"differs {counts['differsAtPreC1']}, "
          f"killed {counts['killed']} + killed-by-bound {counts['killedByBound']} "
          f"+ red-then-fixed {counts['redThenFixed']}) -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

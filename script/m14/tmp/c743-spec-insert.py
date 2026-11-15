#!/usr/bin/env python3
"""Insert the #743 parse-success floor entries (C-D11 / CP12).

A text-level insert, not a load/dump round-trip: the two spec files have their own
conventions (c writes real em dashes and ends with a newline, cpp writes \\u2014
escapes and ends without one, and cpp's decisions sit one level deeper), and a
round-trip would reformat bytes this change has no business touching.

The entry's own braces come from the serialised entry; the anchor supplies the
PREVIOUS entry's closing brace, which gains the comma. Anchors are asserted unique,
and the result must parse as JSON, before anything is written.
"""
import json
import sys


def entry_text(entry: dict, brace_indent: int, inner_indent: int) -> str:
    """Serialise one entry at the file's own indentation.

    Measured from each file rather than assumed: c puts entry braces at 3 spaces
    and keys at 4 (1-space steps), cpp puts braces at 6 and keys at 8 (2-space
    steps), and a formatting difference here would be a reformat of lines this
    change has no business touching.
    """
    raw = json.dumps(entry, indent=inner_indent - brace_indent, ensure_ascii=False)
    pad = " " * brace_indent
    return "\n".join((pad + line) if line.strip() else line for line in raw.split("\n"))


C_ENTRY = {
    "id": "C-D11",
    "node_type": "the pinned grammar's parse-success floor on the c corpora - how much of each corpus tree-sitter-c can actually parse (#743, CONV-CPPC-1), and the gate that keeps the number honest",
    "status": "RULED + RECORDED (2026-09-23) - the floors are measured and pinned, the gate that watches them is in the battery with a self-test that can fail, and the grammar-wave remainder is refused on measurement (F11)",
    "question": "F5 compares the analyzer against the oracle and BOTH walk the same partial tree, so a grammar that cannot represent a region produces two equal sides: parity measures agreement, not coverage. Recovery keeps symbols flowing through an ERROR region, which is what makes the gap silent - a 60% error rate and a 0% error rate can both read 'no symbol loss'. So what may a consumer of the c lane assume about grammar coverage, and what watches it?",
    "resolution": "MEASURED, PINNED AND WATCHED. The floors (validation/m14/parse-success-baseline.json; the per-run artifact is validation/m14/results/M14.0.F10.json): sqlite:c 346 files, 200 carry an ERROR node or a MISSING token (57.8%; ERROR 52.6% / MISSING 36.1%; damaged lines median 3, max 429); jq:c 76 files, 26 (34.2%; ERROR 25.0% / MISSING 22.4%; median 4, max 61). #743's own census read 44.4% on jq when it was filed, and the grammar waves landed since (#743b's __has_include, #743c's leaf gate, #907's declaration-header rule, #912's call-shaped arrival, #920's row-preserving blanking) are why the floor is re-pinned rather than quoted. THE GATE IS NOW IN THE BATTERY: script/m14/verify-parse-success.ts (M14.0.F10) existed but was wired into no chain - a gate nobody runs - and now runs inside `npm run verify` immediately after the F1 grammar audit, with `audit:parse-success-selftest` ahead of it. THE SELF-TEST IS WHY IT CAN BE TRUSTED: it measures one REAL lane and drives the gate's own verdictFor/exitCodeFor through every branch it claims - floor equal to the measurement (pass), floor above (pass-improved), floor below (FAIL), a floor pinned at 0% with any damage (FAIL, the hard rule #743 asks for), a CLEAN lane against a 0% floor (pass, the false-positive direction), a moved sample (sample-moved, which is NOT a pass), a lane absent from the baseline (unpinned), the same lane under --update-baseline (pinned), and the exit mapping fail-1 / needs-repin-2 / pass-0. Mutations proved the self-test can fail: folding sample-moved into pass is caught naming that branch (exit 1) and deleting the regression direction is caught naming both FAIL branches (exit 1), each restored byte-identical afterwards. The self-test also REFUSES a lane with no damaged file rather than passing vacuously, because such a lane cannot exercise the FAIL direction at all. NOT CLAIMED HERE: the grammar long tail is not fixed. The candidates censused for it are refused on measurement by M14.0.F11 (script/m14/verify-grammar-leaves.ts), whose G3 output gate reads real losses (21 vanished symbols and 52 lost pairs for the tree-preserving cpp candidate) while G1 and G2 pass, so the remaining damage is a PINNED RESIDUAL that a live gate keeps visible. No consumer of the c lane may read 'MISSING=0' as 'the grammar parses everything'; the floors above are the honest number.",
}

CPP_ENTRY = {
    "id": "CP12",
    "node_type": "the pinned grammar's parse-success floor on the cpp corpora - how much of each corpus tree-sitter-cpp can actually parse (#743, CONV-CPPC-1), and the gate that keeps the number honest",
    "status": "RULED + RECORDED (2026-09-23) - the floors are measured and pinned, the gate that watches them is in the battery with a self-test that can fail, and the grammar-wave remainder is refused on measurement (F11)",
    "question": "F5 compares the analyzer against the oracle and BOTH walk the same partial tree, so a grammar that cannot represent a region produces two equal sides: parity measures agreement, not coverage. Recovery keeps symbols flowing through an ERROR region, which is what makes the gap silent - a 60% error rate and a 0% error rate can both read 'no symbol loss'. The production headers are the surface that matters: #743 measured 45 of 47 nlohmann-json headers (95.7%) damaged, which is the library's public API arriving in fragments. So what may a consumer of the cpp lane assume about grammar coverage, and what watches it?",
    "resolution": "MEASURED, PINNED AND WATCHED. The floors (validation/m14/parse-success-baseline.json; the per-run artifact is validation/m14/results/M14.0.F10.json): fmt:cpp 72 files, 38 carry an ERROR node or a MISSING token (52.8%; ERROR 47.2% / MISSING 41.7%; damaged lines median 8, max 152); nlohmann-json:cpp 400 files, 126 (31.5%; ERROR 17.5% / MISSING 29.3%; median 6, max 1901). #743's own census read 73.0% on nlohmann-json when it was filed, and the grammar waves landed since (#743b's __has_include as a preprocessor argument, #743c's grammar-leaf gate, #907, #912's call-shaped arrival, #919's macro-declared body, #920's row-preserving blanking) are why the floor is re-pinned rather than quoted. THE GATE IS NOW IN THE BATTERY: script/m14/verify-parse-success.ts (M14.0.F10) existed but was wired into no chain - a gate nobody runs - and now runs inside `npm run verify` immediately after the F1 grammar audit, with `audit:parse-success-selftest` ahead of it. THE SELF-TEST IS WHY IT CAN BE TRUSTED: it measures one REAL lane and drives the gate's own verdictFor/exitCodeFor through every branch it claims - floor equal to the measurement (pass), floor above (pass-improved), floor below (FAIL), a floor pinned at 0% with any damage (FAIL, the hard rule #743 asks for), a CLEAN lane against a 0% floor (pass, the false-positive direction), a moved sample (sample-moved, which is NOT a pass), a lane absent from the baseline (unpinned), the same lane under --update-baseline (pinned), and the exit mapping fail-1 / needs-repin-2 / pass-0. Mutations proved the self-test can fail: folding sample-moved into pass is caught naming that branch (exit 1) and deleting the regression direction is caught naming both FAIL branches (exit 1), each restored byte-identical afterwards. The self-test also REFUSES a lane with no damaged file rather than passing vacuously, because such a lane cannot exercise the FAIL direction at all. NOT CLAIMED HERE: the grammar long tail is not fixed. The candidates censused for it are refused on measurement by M14.0.F11 (script/m14/verify-grammar-leaves.ts), whose G3 output gate reads real losses (21 vanished symbols and 52 lost pairs for the tree-preserving candidate) while G1 and G2 pass, so the remaining damage is a PINNED RESIDUAL that a live gate keeps visible. No consumer of the cpp lane may read 'MISSING=0' as 'the grammar parses everything'; the floors above are the honest number.",
}

JOBS = (
    # path, entry, indent, tail anchor (previous entry's close .. file end), label
    (
        "script/m14/spec/c-completeness.json",
        C_ENTRY,
        3,
        4,
        "\n   }\n  ]\n }\n}\n",
        "\n   },\n",
        "\n  ]\n }\n}\n",
        "C-D11",
    ),
    (
        "script/m14/spec/cpp-completeness.json",
        CPP_ENTRY,
        6,
        8,
        "\n      }\n    ]\n  }\n}",
        "\n      },\n",
        "\n    ]\n  }\n}",
        "CP12",
    ),
)

for path, entry, brace_indent, inner_indent, anchor, close_with_comma, suffix, label in JOBS:
    text = open(path, encoding="utf-8").read()
    if f'"{label}"' in text:
        print(f"{path}: {label} already present - nothing written")
        continue
    if text.count(anchor) != 1:
        print(f"{path}: tail anchor is not unique ({text.count(anchor)}) - refusing to write", file=sys.stderr)
        sys.exit(1)
    new = text.replace(anchor, close_with_comma + entry_text(entry, brace_indent, inner_indent) + suffix)
    parsed = json.loads(new)  # must still parse as JSON before it is written
    open(path, "w", encoding="utf-8").write(new)
    print(f"{path}: inserted {label} (decisions now {len(parsed['design_decision']['decisions'])})")

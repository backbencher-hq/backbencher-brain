#!/usr/bin/env python3
"""Pay down rust's two M49.R2 regex rows in validation/m49/regex-debt-register.json.

The register is shrink-only and rows are keyed by (file, source): a row may only
disappear when its SOURCE no longer contains the regex. Both rust rows are that
case — commit `ca0de2fd` replaced the two `\\b(Serialize|Deserialize)\\b` /
`\\b(Parser|Subcommand|Args|ValueEnum)\\b` literals with `hasBareWord`, an ASCII
word-run membership scan (equivalent, not an approximation: JS `\\b` IS the ASCII
word class), proven over 1,481 files / 970 bodies with 0 mismatches by
`script/m14/tmp/rust-004-regex-equivalence.ts`. R2 reported them as GHOST rows
until this is written.

Run: python3 script/m14/tmp/rust-798-regex-register-shrink.py
"""
import json
import pathlib
import datetime

ROOT = pathlib.Path(__file__).resolve().parents[3]
P = ROOT / "validation/m49/regex-debt-register.json"
reg = json.loads(P.read_text())

rust = [e for e in reg["entries"] if e.get("file") == "real-rust-analyzer.ts"]
assert len(rust) == 2, f"expected rust's 2 registered rows, found {len(rust)}"
before_total = reg["baselineTotal"]

reg["entries"] = [e for e in reg["entries"] if e.get("file") != "real-rust-analyzer.ts"]
reg["baselineTotal"] = len(reg["entries"])

reg["shrunkBy"].append({
    "wave": f"M49.R2 {datetime.date.today().isoformat()} — rust's two name-set tests become char scans (#798)",
    "removed": len(rust),
    "removedRows": [
        {"file": "real-rust-analyzer.ts", "source": r.get("source"), "class": r.get("class")} for r in rust
    ],
    "baselineTotalBefore": before_total,
    "baselineTotalAfter": reg["baselineTotal"],
    "note": "A row may only disappear when the source no longer holds the regex. Both removals are code fixes, not reclassifications: `/\\b(Serialize|Deserialize)\\b/` and `/\\b(Parser|Subcommand|Args|ValueEnum)\\b/` were name-set tests on a `#[derive(...)]` / clap attribute argument's TEXT, and the test only ever needed WORD-RUN MEMBERSHIP — which is what `hasBareWord` computes with a char-code scan, exactly the class of replacement the policy's rule 2 asks for (char-scan with an inline equivalence proof). The inline proof is on `hasBareWord` in the analyzer; the corpus proof is script/m14/tmp/rust-004-regex-equivalence.ts (1,481 files, 970 bodies, 0 mismatches between the two regexes and the scan). Rust is now a zero-regex lane.",
})
P.write_text(json.dumps(reg, indent=2) + "\n")
print(f"rows {before_total} -> {reg['baselineTotal']}; shrunkBy entries: {len(reg['shrunkBy'])}")

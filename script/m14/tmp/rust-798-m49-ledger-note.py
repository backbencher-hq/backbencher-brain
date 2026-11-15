#!/usr/bin/env python3
"""Correct the M49 ledger's RS1 entry, which still claims rust's `uses` and
`references` are UNCOMPARED labels ("no oracle mirror needed").

That was true when the entry was written (verifiedAtCommit 5c71e176) and became
FALSE in the rust third-review round for #798, which added the independent
oracles `deriveRustBareUses` and `deriveRustDeclaredTypeRefs` to
script/m14/differential.ts and put both labels in rust's F5 allowlist. A ledger
entry is a claim about a commit, so the historical text is kept and the
correction is appended with the measurement that superseded it — the same way
the register notes record their own history.

Run: python3 script/m14/tmp/rust-798-m49-ledger-note.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
P = ROOT / "validation/m49/ledger.json"
l = json.loads(P.read_text())
rs1 = next(i for i in l["issues"] if i.get("id") == "RS1")

old = rs1["notes"]
assert old.startswith("uses/references are uncompared labels for rust"), old[:80]
assert "no oracle mirror needed" in old

rs1["notes"] = (
    "uses/references are uncompared labels for rust, so fixtures + mutants gate the read surface "
    "(no oracle mirror needed). Fully gated: fixtures rust/bare-value-reads + rust/construction-exports, "
    "5 mutants, spec R1/R8/D2/D3/D6. Lanes: ripgrep + cargo 0/0/0. F3 399/399, F4 461/461 at the wave commit. "
    "CORRECTION (2026-09-24, rust third/fourth review for #798): the first clause was TRUE at "
    "5c71e176 and is no longer true. Both labels are now COMPARED for rust — `uses` and `references` "
    "were put in the lane's F5 allowlist and two independent oracles were written for them "
    "(`deriveRustBareUses`, `deriveRustDeclaredTypeRefs` in script/m14/differential.ts), because "
    "\"fixtures + mutants gate the read surface\" left the whole read surface and the whole "
    "declared-type surface outside the corpus comparison by construction — a restored read edge then "
    "rode a fixture and its mutant but no lane, which is the class this ledger exists to catch. "
    "Measured at full extent on both pinned corpora through script/m14/tmp/rust-798-missing.ts: "
    "ripgrep 110 files 6,309 truth edges, cargo 1,371 files 41,793 truth edges, 0 missing / 0 "
    "unexplained. The original text is kept above because this entry is a claim about a commit; the "
    "correction is what the current tree asserts."
)
P.write_text(json.dumps(l, indent=2) + "\n")
print("RS1 notes:", len(rs1["notes"]), "chars; status:", rs1["status"], "; verifiedAtCommit:", rs1["verifiedAtCommit"])

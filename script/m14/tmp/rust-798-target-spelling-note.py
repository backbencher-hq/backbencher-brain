#!/usr/bin/env python3
"""Record rust's R10 history in validation/m60/target-spelling-register.json.

Only the per-lane `note` is hand-written and preserved by the register's writer
(`script/m60/target-spelling-register.ts`), so the history goes there. The
machine-compared half (`convictions`, `convictionSubclasses`, `whitespaceRuled`,
`separatorTriples`, `rulings`) is left EXACTLY as measured: rust measured 0
convictions before this round's fix and 0 after, which is why an empty
`convictions` map was not evidence of a clean lane.

Run: python3 script/m14/tmp/rust-798-target-spelling-note.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
P = ROOT / "validation/m60/target-spelling-register.json"
reg = json.loads(P.read_text())
rust = reg["lanes"]["rust"]

assert rust["convictions"] == {}, rust["convictions"]
assert rust["separatorTriples"] == [], rust["separatorTriples"]

rust["note"] = (
    "CONVICTED AND PAID DOWN 2026-09-24 (rust #798, R10). This lane's `convictions` map was "
    "EMPTY, and its artifact row read `clean`, while the lane was in fact publishing source text "
    "as a target — the empty map was a statement about the DRAW, not about the lane. Measured: "
    "`bun script/m60/target-spelling-census.ts --lane rust --sample 667` on the pre-fix analyzer "
    "reported `anomalies=6 {\"whitespace\":6}`, all `references` targets, subclass "
    "`matchesOwnSymbol` — 5x `references -> \"&mut ProcessBuilder\"` and 1x "
    "`references -> \"&mut Execs\"`, every one of them at "
    "cargo/crates/cargo-test-support/src/lib.rs. "
    "THE DRAW BLIND SPOT, MEASURED AND FILED: the census's canonical draw is 40 files per corpus "
    "(sorted, every k-th), and the violating file is ABSENT from cargo's draw at caps 40, 60, 240 "
    "and 700 while it is drawn at 400 and 1400 (script/m14/tmp/rust-798-draw-check.ts). At the "
    "canonical cap 40 this lane would therefore have read `clean` forever, and the register's "
    "`clean` was true about the sample and false about the lane. The class is one ROOT with three "
    "surfaces, and the census only measures one of them: `impl ChannelChangerCommandExt for &mut "
    "ProcessBuilder` published the impl SYMBOL under the name `&mut ProcessBuilder`, the same text "
    "as the `implements` edge's SOURCE and as each member's OWNER, and `Self` resolution inside the "
    "block made it a `references` TARGET (5 rows, plus `&mut Execs` x1). "
    "THE FIX (R10, this round): the implemented type's NOMINAL name is published — a "
    "reference/pointer/parenthesized wrapper is transparent, so `&mut ProcessBuilder` IS "
    "`ProcessBuilder`; a type with NO nominal name (a slice `[u8]`, a tuple `(T, U)`) takes the "
    "family's declared synthetic `anonymous_impl` on the impl SYMBOL with the source spelling kept "
    "in `metadata.implementedType`, while `Self` resolution takes ABSENCE (R7: the honest state is "
    "absence, not a placeholder, and the synthetic block name is never substituted for the type in "
    "a TARGET position). RE-MEASURED at full extent, not on a draw: "
    "`--lane rust --sample 2285` (ripgrep 110 + cargo 1241 files, 182,977 relationships) reads "
    "`clean` with `anomalies=0 sep=0 unruled=-`, and the F5 differential at the same files reports "
    "0 missing / 0 unexplained against its independently-written oracle (6,309 and 41,793 truth "
    "edges). "
    "TWO ADJACENT FINDINGS this work surfaced, recorded here because they belong to the same root: "
    "(1) `calls -> \"Self\"` — the KEYWORD published as a callee name, 6 rows on cargo "
    "(`Ok(Self(name))` in cargo-util-schemas/src/manifest/mod.rs, `Self(ProcessEnv)` in "
    "build-rs/src/input.rs). Found by the F14 name-surface gate when it was extended to rust (this "
    "census cannot see it: `Self` is a well-SPELLED name, and R10's classes are about spelling); "
    "the callee now resolves to the enclosing impl type, exactly as `Name(..)` does, and a "
    "trait default body (no impl to resolve) omits the edge. (2) RAW IDENTIFIERS keep their `r#` "
    "prefix on the symbol AND everything that targets it (`r#try`, `r#async`) and are DECLARED by "
    "the F14 gate as the identifier's own spelling rather than tolerated: the prefix is the only "
    "way the identifier can be written in source, both sides carry it (so it resolves), and R2 of "
    "the gate REFUSES the stripped form by name, since `try`/`async` are keywords. Measured: "
    "ripgrep 1 symbol + 1 target, cargo 2 symbols + 11 targets."
)
P.write_text(json.dumps(reg, indent=2) + "\n")
print("note written:", len(rust["note"]), "chars")
print("machine half unchanged:", rust["convictions"], rust["separatorTriples"], rust["rulings"])

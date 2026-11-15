#!/usr/bin/env python3
"""RUST-D12 in script/m14/spec/rust-completeness.json: REGISTERED (open) -> FIXED.

The entry registered two published-name classes for their own round: (1) a
non-nominal `impl` target published as the impl symbol, the `implements` source
and the `Self` target, and (2) raw identifiers published with their `r#` escape.
This round answers both — (1) is fixed, (2) is RULED, with the reason a ruling
rather than a rename. The `question` keeps its original text (it is the finding),
`status` and `resolution` are rewritten to what is now true, and the evidence is
named file by file so the claim is checkable.

Run: python3 script/m14/tmp/rust-798-spec-d12.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
P = ROOT / "script/m14/spec/rust-completeness.json"
spec = json.loads(P.read_text())
d12 = next(d for d in spec["design_decision"]["decisions"] if d.get("id") == "RUST-D12")

assert d12["status"].startswith("REGISTERED"), d12["status"]

d12["status"] = "FIXED (2026-09-24, rust #798 round 2) — (1) fixed and gated; (2) RULED, with the ruling enforced by the same gate"
d12["resolution"] = (
    "CLOSED 2026-09-24, both halves. "
    "(1) THE IMPL-TARGET CLASS IS FIXED. Rule: an impl's published name is the implemented type's NOMINAL name, because a "
    "reference/pointer/parenthesized wrapper is transparent — `&mut ProcessBuilder` IS the type `ProcessBuilder` — and the pre-fix "
    "`stripGenerics(typeNode.text)` published SOURCE TEXT as a name on three surfaces at once (the impl SYMBOL, the `implements` "
    "edge's SOURCE, and, through `Self`, every `references` TARGET inside the block). Measured conviction that forced it: the M60 "
    "target-spelling census on the pre-fix analyzer read `anomalies=6 {\"whitespace\":6}` — 5x `references -> \"&mut ProcessBuilder\"` "
    "and 1x `references -> \"&mut Execs\"`, all at cargo/crates/cargo-test-support/src/lib.rs — and the register's `clean` had been a "
    "DRAW artifact (the violating file is absent from cargo's canonical 40-file draw; script/m14/tmp/rust-798-draw-check.ts). "
    "For a type with NO nominal name (a slice `[u8]`, a tuple `(T, U)`, a unit, a never type, a fn pointer, `dyn Trait`, "
    "`<T as Trait>::Assoc`) the decisions the entry listed as competing are now settled in the R7 direction: the impl BLOCK takes "
    "the family's declared synthetic `anonymous_impl` (c's `anonymous_struct`/`anonymous_union`/`anonymous_enum`, cpp's `anonymous`) "
    "with the type's own spelling kept in `metadata.implementedType`, while `Self` RESOLUTION takes ABSENCE — the honest state is "
    "absence, not a placeholder, and the synthetic block name is never substituted for the type in a TARGET position. The nominal "
    "base is NOT used where no nominal base exists (`[u8]` does not become `u8`: that would be an identity lie), and the trait name "
    "is not used either (it collides with the trait's own symbol in the same file — `impl ToPkgId for (T, U)` sits next to "
    "`trait ToPkgId` in cargo/crates/resolver-tests/src/helpers.rs). Path QUALIFICATION is preserved on the symbol "
    "(`std::io::Error` stays qualified — the deferred constructor filter reads in-file symbol names, and flattening it added 12 "
    "spurious `instantiates` edges on ripgrep alone) while `Self` resolves to the LEAF (`Error`), which is a `references` target by "
    "the #419-B leaf-target contract. Gated by: fixture validation/m14/fixtures/rust/impl-target-name-surface-798 (4 shapes + the "
    "`calls -> Self` follow-through, every forbid proven to FAIL on revert by re-deriving the pre-fix rule from the tree — "
    "script/m14/tmp/rust-798-fixture-dump.ts with BB_PRE_R10=1), mutant `rust/revert-impl-target-wrapper-name` (CAUGHT), and the "
    "F14 name-surface gate EXTENDED TO RUST (`script/m14/verify-name-surface-924.ts`: 18,658 name-bearing targets + 4,069 symbols "
    "over ripgrep 110 + cargo 400, 0 violations, both rust checks tripping on the pre-fix rule). A/B at both corpora "
    "(script/m14/tmp/rust-798-r10-ab.ts): ripgrep 4 symbols + 43 relationships changed, cargo 9/12 + 62/60, every row a rename of "
    "the same root. "
    "(2) THE RAW-IDENTIFIER CLASS IS RULED, NOT RENAMED, and the ruling is the opposite of what the entry assumed. A raw identifier "
    "keeps its `r#` prefix on BOTH the symbol and everything that targets it (`r#try`, `r#async`), and the F14 gate DECLARES it as "
    "the identifier's own accepted spelling for a reason that is decisive: the prefix is the only way that identifier can be written "
    "in source, so stripping it would publish `try`/`async` — bare KEYWORDS, which the gate now refuses BY NAME (R2 of F14). The "
    "class is internally consistent (symbol and target agree, so it resolves; refTargetNotName 0) and it is not an unknown symbol. "
    "Measured: ripgrep 1 symbol + 1 target, cargo 2 symbols + 11 targets. "
    "(3) WHAT THE ROUND ALSO FOUND, because gating is what found it: `calls -> \"Self\"` — the KEYWORD published as a callee name, 6 "
    "rows on cargo (`Ok(Self(name))` in cargo-util-schemas/src/manifest/mod.rs, `Self(ProcessEnv)` in build-rs/src/input.rs), which "
    "the census could not see because `Self` is well-SPELLED (R10's classes are about spelling) and the differential could not see "
    "because its truth derives from the same rule. `Self(..)` now names the enclosing impl type's constructor exactly as `Name(..)` "
    "does, a trait default body (no impl to resolve) omits the edge, and the fixture forbids `calls -> Self` with its own mutant "
    "(rust/reemit-self-callee-target, CAUGHT). Full-extent verification at final bytes: F5 0 missing / 0 unexplained on both "
    "corpora (6,309 truth edges on ripgrep, 41,793 on cargo), F3 17/17 rust fixtures, F4 32/32 rust mutants CAUGHT, target-spelling "
    "census `--lane rust --sample 2285` clean (1,351 files, 182,977 relationships, 0 anomalies, 0 separator triples), tsc clean."
)
P.write_text(json.dumps(spec, indent=2) + "\n")
print("RUST-D12 status:", d12["status"])
print("resolution:", len(d12["resolution"]), "chars")

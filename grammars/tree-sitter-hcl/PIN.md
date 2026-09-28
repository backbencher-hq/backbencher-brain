# tree-sitter-hcl — grammar pin

Vendored so the wired `wasm/tree-sitter-hcl.wasm` is not an unversioned blob.

| | |
| --- | --- |
| Upstream | `tree-sitter-grammars/tree-sitter-hcl` |
| Revision | `64ad62785d442eb4d45df3a1764962dafd5bc98b` (2026-01-17, "`.tofu` extension used by opentofu") |
| Package | `@tree-sitter-grammars/tree-sitter-hcl@1.2.0` (published 2025-06-16, the package's only release) |
| Licence | Apache-2.0 |
| Wired wasm | `wasm/tree-sitter-hcl.wasm`, sha256 `86bb80cd151bd3ab1e44ed431a9c1874978db31519c62055efb50f028a1d0118`, 92,478 bytes |
| Gate | `bun run script/m14/verify-grammar-pins.ts` (lane `hcl`) |

## Why this revision, and why it is pinned rather than rebuilt

`src/node-types.json` at this revision declares **64 named node types and 2 fields
(`key`, `val`)**. The wired wasm's own enumerable surface, read through
web-tree-sitter's `Language` API, is **121 ids / 64 named / 2 fields** — the
identical named set and the identical field set, in both directions, zero
missing and zero extra. That is the source↔wasm proof this pin records, and it
is re-checked on every run of the gate rather than asserted here.

So the wired bytes ARE a build of this source, and the Groovy situation — a
vendored wasm that had drifted from upstream and needed manual repair — does
**not** apply to HCL. Full measurement:
`fixtures/hcl/out/grammar-conformance.json`, produced by
`fixtures/hcl/probes/grammar-conformance.mts`.

## Verdict

**Pin as-is.** No better candidate exists: 1.2.0 is the only release of the only
published HCL grammar package, the repository is not archived, and the wired
build already matches its source exactly. Adopting it therefore costs nothing
and buys the property the lane lacked — the grammar's version is answerable from
the repository, and drift is a gate failure instead of an unmeasurable claim.

## Files

`grammar.js`, `package.json`, `tree-sitter.json`, `LICENSE`, `README.md`,
`CHANGELOG.md`, and `src/` (`grammar.json`, `node-types.json`, `scanner.c`,
`parser.c`, `tree_sitter/*.h`), byte-for-byte from the upstream tree at the
revision above. `parser.c` IS vendored here (600 KB): it is small enough to keep,
so the wasm is rebuildable from this directory alone with
`tree-sitter build --wasm`.

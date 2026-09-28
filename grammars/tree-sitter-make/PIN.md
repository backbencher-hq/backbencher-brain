# tree-sitter-make — grammar pin

Vendored so the wired `wasm/tree-sitter-make.wasm` is not an unversioned blob.

| | |
| --- | --- |
| Upstream | `tree-sitter-grammars/tree-sitter-make` |
| Revision | `70613f3d812cbabbd7f38d104d60a409c4008b43` ("chore: regenerate parser and bindings with 0.26.6") |
| Package | `tree-sitter-make` 1.1.1 (MIT) |
| Generated with | `tree-sitter-cli` 0.26.5; the generated `parser.c` declares `LANGUAGE_VERSION 15` |
| Wired wasm | `wasm/tree-sitter-make.wasm`, sha256 `e85bd50b8182497c311fd72c4441b530ff437421176b64114faf532641534fff`, 148,909 bytes |
| Gate | `bun run script/m14/verify-grammar-pins.ts` (lane `make`) |

## Why this revision, and why it is pinned rather than rebuilt

`src/node-types.json` at this revision declares **44 named node types and 24
fields**. The wired wasm's own enumerable surface, read through web-tree-sitter's
`Language` API, is **188 ids / 44 named / 130 anonymous / 24 fields** — the
identical named set and the identical field set, in **both** directions, zero
missing and zero extra.

So the wired bytes ARE a build of this source, and the Groovy situation — a
vendored wasm that had drifted from upstream and needed manual repair — does
**not** apply here. Full measurement:
`fixtures/make/out/grammar-conformance.json`, produced by
`fixtures/make/probes/grammar-conformance.mts`.

The anonymous-node counts differ (91 declared, 130 in the wasm) because
`node-types.json` deduplicates identical anonymous tokens that the wasm's id
table lists once per id. The comparison that carries the proof is therefore over
the **named** set and the **field** set, which are both exact in both directions;
the anonymous difference is recorded here rather than hidden.

## What the analyzer does with it

The grammar declares 44 named node types. The analyzer reads a subset of them and
the rest are classified, with a reason, in
`script/m14/spec/make-completeness.json` — 64/64 for the hcl lane, 44/44 here.
The types that exist in the grammar and are deliberately not turned into edges
are the interesting part of that spec, not a gap in it: `recipe`,
`recipe_line`, `shell_text` and `comment` carry no declaration, and
`automatic_variable` is turned into a `uses` edge precisely because it names
nothing the file can declare.

Two grammar shapes this pin exists to make visible, both found by measurement
rather than by reading the grammar:

- **`$(VAR:.c=.o)` is a `substitution_reference`, not a `variable_reference`.**
  It is a sibling, not a child, so an analyzer that reads only the latter loses
  every substitution reference in the corpus (11 of them).
- **A literal include path is a `word`, and a computed one is a
  `shell_function`.** `include hooks` and `include $(shell …)` therefore produce
  three different node shapes for the same directive, and reading only
  `function_call` records none of them.

## Rebuilding

The vendored `src/parser.c` is checked in, so the source↔wasm proof above is
re-checkable offline without a `tree-sitter` toolchain. To regenerate after an
upstream bump: bump the revision above, re-run the conformance probe, and confirm
`drift.matches` is still true and `wire the new wasm` before changing the sha.

`src/parser.c` is 928 KB. It is vendored anyway, unlike the xml/hcl lanes which
skip the generated file: this lane's central claim is a source↔wasm identity
proof, and that proof is not checkable without the generated source.

# tree-sitter-proto — vendored and PATCHED

This directory is the **source of the wasm the product loads**:
`wasm/tree-sitter-protobuf.wasm`. It is not a mirror of upstream; it is upstream
plus eight anchored patches, and the divergence is the point of vendoring it.

| file | role |
|---|---|
| `grammar.js` | the **patched** grammar. This is what `tree-sitter generate` reads. |
| `src/grammar.json`, `src/node-types.json` | generated, and tracked **on purpose**: `script/m14/verify-grammar-pins.ts` uses the pair for its offline source↔wasm proof, and without them the check reports "not applicable" and the lane has no proof at all. |
| `src/parser.c` | generated, 1.3 MB, **not** tracked — `tree-sitter generate` rebuilds it. |
| `tree-sitter.json` | **added by us.** Upstream has none, so `tree-sitter generate` fell back to ABI 14 and `tree-sitter build --wasm` refused outright ("please ensure you have one"). With it, ABI 15 like every other lane. |
| `queries/` | upstream's highlighting queries, carried through untouched. |
| `.upstream-revision` | the exact commit this was taken from. |
| `LICENSE` | upstream's, MIT. |

## Provenance

* **Upstream:** `github.com/amaanq/tree-sitter-proto` @ `e9f6b43f6844bd2189b50a422d4e2094313f6aa3`
* **Why this one:** it is the only protobuf grammar reachable from this machine.
  `ProtocolBuffers/tree-sitter-proto` and `tree-sitter-grammars/tree-sitter-protobuf`
  do not exist, and **no protobuf grammar is published on npm at all** — so there
  was no registry route, only a source route. That is why this directory is a
  local build rather than a package, and why `tree-sitter.json` had to be written.
* **Upstream's own claim vs measurement.** Its README says *"The grammar should
  be complete. I've tested the grammar against some really large and nasty proto
  files and it passes."* Measured on the reference implementation's own 108
  `.proto` files, unpatched: **62 files carried 527 ERROR nodes**, including
  **70 in `descriptor.proto`** — the file every protobuf tool in existence reads.
  The claim is recorded here rather than repeated, because it was measured false.

## What the patches bought, and the evidence for each

Every patch is anchored in `grammar.js` and refuses to apply if its anchor is
absent, so a grammar update cannot half-port. Error counts are on
`protocolbuffers/protobuf` @ the pinned revision, 108 files, 17,213 lines.

| # | patch | upstream's gap | evidence |
|---|---|---|---|
| 1 | `edition` rule | root allowed only `optional($.syntax)`, so `edition = "2023";` — which **replaces** syntax in editions, and is what Google and Kubernetes are migrating to — was 2 ERROR nodes | 52 of the 108 reference files declare an edition |
| 2 | negative field numbers | `field_number` was a bare `int_lit` with no sign | `int32 a = -1;` was 1 ERROR node; the field-number space is signed and negative numbers are legal |
| 3 | `import option "…";` | the `import` rule allowed only `weak`/`public`, so editions' option-import — the mechanism behind `features` — was an ERROR | this alone was most of `descriptor.proto`'s damage |
| 4 | option list on `extensions` | `extensions ranges ;` ended at `;`, so `extensions 536000000 [declaration = {…}];` was an ERROR | 3 ERROR nodes, and the aggregate inside it failed too, so one construct took 70 with it |
| 5 | proto2 `group` | absent entirely | **not rare**: 12 of the 108 reference files use it, so ruling it would have left the lane unable to read a quarter of protobuf's own corpus. Structured as a second `field` alternative, because a group's body is a nested message rather than a `;` and sharing the terminator needs an empty rule, which tree-sitter rejects |
| 6 | parenthesised option-name segment after a dot | a `(fullIdent)` segment was legal only **first**; `features.(pb.cpp).repeated_type` and `(a.b).(c.d)` were ERRORs | 16 nodes in `repeated_field_proxy_test.proto`, 19 in `unittest_custom_options.proto` — both option-heavy on purpose |
| 7 | leading dot on an `extend` target | `extend` used `full_ident` (no leading dot) while `message_or_enum_type` had one, so `extend .google.protobuf.FieldOptions {…}` was an ERROR — and fully qualified extend targets are the norm, not an edge case | `unittest_redaction.proto`, 12 nodes |
| 8 | `local` declaration modifier | a 2023-editions top-level modifier, unknown to the grammar | the reference implementation's own `cpp_file_options.proto` |

Measured progression on the same 108 files:

| grammar | error files | error nodes |
|---|---|---|
| upstream, as published | 62 | 527 |
| + patches 1–2 | 28 | 421 |
| + patches 3–5 | 12 | 79 |
| + patches 6–8 | **1** | **13** |

A **97.5% reduction in error nodes**, and the 70-error failure on `descriptor.proto`
is gone entirely.

## The one ruled gap, with its consequence

**`any { … }` — the proto2 `MessageSet` form, inside a `group`.** It is the only
construct in the reference corpus this grammar does not parse. Ruled, not deferred,
and the reason is measured rather than asserted:

* the specification **deprecates** `MessageSet` outright; it survives only for a
  handful of legacy systems and protobuf's own guidance is not to use it;
* it appears in **1 file of 108**, and that file is
  `unittest_custom_options.proto` — the reference implementation's deliberate
  parser-breaking torture test, which exists to be hard;
* **consequence, measured:** 13 ERROR nodes in that one file. Every other
  construct in that same file parses correctly in isolation — the errors reported
  on lines 338–341 are tree-sitter's *recovery* misattributing damage from the
  `any { }` further down, not separate defects. Verified by extracting each
  construct and parsing it alone: all accept.

A file that uses `MessageSet` will lose that construct's fields rather than the
file. That is the whole consequence, and it is bounded and stated.

## Node names are a contract

Rules are **snake_case** (`message_body`, `enum_field`, `oneof_field`,
`map_field`, `service_name`, `rpc_name`, …), which is what this grammar publishes
and what nine of the ten vendored grammars in this repository also use. The
analyzer dispatches on those names, and so does the m12 shape-safety census.
**Do not rename them** — the exception is `graphql`, which was renamed to
PascalCase for a documented reason specific to its own history, and which is not a
precedent.

## Regenerating the wasm

```sh
cd grammars/tree-sitter-proto
tree-sitter generate                                  # -> src/{parser.c,grammar.json,node-types.json}
tree-sitter build --wasm -o ../../wasm/tree-sitter-protobuf.wasm
```

`tree-sitter build --wasm` needs emscripten; with only docker present it uses
`emscripten/emsdk` through docker automatically. The CLI must be ≥ 0.25 for the
ABI-15 path; the fixtures copy at
`$HOME/fixtures/node_modules/tree-sitter-cli` is 0.25.1.

**After regenerating, re-run every gate** — the wasm hash is pinned, and a
regeneration that changed nothing must not move the recorded digests.

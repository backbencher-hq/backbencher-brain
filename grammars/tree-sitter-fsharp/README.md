## tree-sitter-fsharp (vendored, patched)

This directory vendors the upstream [`tree-sitter-fsharp`](https://github.com/ionide/tree-sitter-fsharp)
grammar **source only** (no generated artifacts), patched for correct
F# extraction in backbencher-brain. The prebuilt WASM built from these
sources is installed at `wasm/tree-sitter-fsharp.wasm`.

### Patches (relative to upstream)

1. **`common/scanner.h` — interface probe fix.** Upstream mis-dispatches the
   FIRST `interface T` (and `interface T with ...`) inside an implicit class
   body into a bogus `union_type_cases` node — losing the `Implements`
   relationship and inventing phantom enum members. The scanner now probes
   `interface` with single-char token-type lookahead:
   - **declaration form** (`interface I = ... end`): succeeds the probe and
     marks `_interface_begin` so the grammar builds `interface_type_definition`;
   - **implementation form** (`interface I with ...` / `.fsi` signatures):
     declines the probe (token_end stays at scan start → zero-width INDENT),
     so the grammar builds `interface_implementation` instead.
   No global `interface` keyword reservation — the previous reserved-keyword
   attempt regressed `prim-types.fs` (a GLR state cascade); the lookahead-only
   scanner alone is sufficient and strictly improves the corpus.

2. **`fsharp/grammar.js` — member signature dispatch, nullable types,
   module value declarations, no reserved `interface`.** Carries the
   `module_val_declaration` / `nullable_type` patches and the
   `member_signature` dispatch used for member classification, and does NOT
   reserve `interface` as a keyword (verified: removing the reservation keeps
   all interface fixtures correct while eliminating the corpus regression).

### Reproducibility

Rebuild from these sources:

```bash
cd grammars/tree-sitter-fsharp
npx tree-sitter generate
npx tree-sitter build --wasm -o /tmp/tree-sitter-fsharp.wasm
cp /tmp/tree-sitter-fsharp.wasm wasm/tree-sitter-fsharp.wasm
```

The WASM build is not byte-deterministic (embedded timestamps), so verify
functional equivalence after rebuild with the M12 F# differential harness
(`script/m12/verify-analyzer.ts` — must report 1.000/1.000, 115/115 facts)
and the interface fixture matrix (`validation/m12/fixtures/fsharp/Services.fs`).

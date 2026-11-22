# F# — extended-type state

Measured 2026-11-22 against the full corpus at
`/home/ishaq2321/bb_tests/repositories`, serving grammar
`wasm/tree-sitter-fsharp.wasm` (sha256 `16cb8779a76bf127497a601cc6b7a546d78a5f44aef27ce6d6120339d53d5c0e`).

- Population: **11,807 admitted / 11,807 walked** `.fs`/`.fsi`/`.fsx` files
  across 26 repositories; 2 over-cap paths, 0 absent, 0 parse failures
  (`fsharp-extended-types.json`).
- `decorates`: **68,057 attribute sites**, 25,101 attached to a declaration,
  19,275 with an argument; only **185** attribute arguments carry a call.
  The attached-to-declaration split is recorded by owning node type in the
  artifact. The ruling stays ontological: F# attributes are passive metadata,
  and the call-shaped minority is a parameter expression, not an applied
  decorator.
- `mixes_in`: 3,585 `inherit` clauses, 741 module-augmentation sites in 261
  files, 1,269 type-extension sites, 1,395 object-expression sites. `inherit` is
  already published as `extends`; module augmentation adds members to an
  existing module, it does not compose a mixin into a supertype chain.
- `renders`: 18,937 nested type declarations across 3,672 files and 15,313
  function-type sites; neither is a rendered component.
- `part_of`: 236 `#load` directives, 236 naming a string, 149 resolved and 87
  unresolved; the rest of the directive census is recorded in the artifact.
- Artifact: `validation/m14/fixtures/fsharp/measurements/fsharp-extended-types.json`.
  The positive control fired on the same scan (Dart `mixin_application`,
  JavaScript `jsx_self_closing_element`, Python `decorator`).

This page records the measured state; it does not widen any contract.

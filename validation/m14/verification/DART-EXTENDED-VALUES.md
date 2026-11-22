# Dart — extended values state

Measured 2026-11-22 against the full corpus at
`/home/ishaq2321/bb_tests/repositories`.

- Population: **31,388 parsed / 31,388 admitted** `.dart` files across 5
  repositories (dart-sdk 25,727 · flutter-packages 4,028 · riverpod 1,295 ·
  dart-http 333 · nvim-treesitter 5), 0 failures. The census is run as
  **fresh-process chunks** and merged by `script/m14/dart-census-merge.ts`; a
  single process exhausts the WASM module at ~7,600 parses.
- `decorates`: **136,422 annotation nodes over 10,988 files**; 30,465 carry
  arguments (3,132 files), 105,957 are bare (8,904 files); 110,540 are core
  markers and 25,882 name a user callable.
  - 482 sites mention the marked declaration’s name in the annotation’s
    arguments.
  - **5** name it as a whole identifier outside a string literal; all five pass a
    **member** of the declaration (`C.STATIC_FIELD`, `F.nonConstStaticField`,
    `D.instanceMethod()`, `B.foo`) rather than the declaration itself.
  - The count of sites where the **declaration is passed to its annotation** is
    therefore **0**; the ruling is ontological (passive metadata), not an
    emitted `decorates` edge.
- Grammar: 0 of 219 named node types in the wired build and 0 of 221 in the
  newest upstream build is a decorator-application type; the positive controls
  fire (`mixin_application`, `part_directive`), so the scan is not blind.
- Artifacts: `validation/m14/measurements/dart-extended-constructs-2026-10-21.json`
  and `validation/m14/measurements/dart-grammar-probe-2026-10-21.json`.

The page records the measured state; the contract is unchanged.

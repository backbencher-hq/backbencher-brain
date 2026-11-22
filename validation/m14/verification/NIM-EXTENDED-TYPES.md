# Nim — extended-type state

Measured 2026-11-22 against the full corpus at
`/home/ishaq2321/bb_tests/repositories`.

- Population: **6,063 parsed / 6,063 admitted** `.nim`/`.nims`/`.nimble` files
  across 8 repositories, 0 parse failures (`nim-extended-census.json`).
- `decorates`: 21,614 pragma lists / 33,940 pragma entries / 33,266 pragma names
  on declarations. A Nim pragma is a compiler directive — passive metadata, not
  an applied callable — so the decorates cell stays ruled, not emitted.
- `mixes_in`: 75 `mixin` sites; the operand names a routine (90) or a declared
  type (4), never a supertype chain. No conformance composition exists.
- `renders`: 278,624 call sites, 696 render-host calls by name; rendering is a
  macro DSL over ordinary calls, so no position names a component type.
- Artifact: `validation/m14/measurements/nim-extended-census.json`; population:
  `validation/m14/measurements/nim-population.json`.

The page records the measured state; it does not widen any contract.

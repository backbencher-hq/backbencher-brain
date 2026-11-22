# Go — state after the 0.2.2 receipt rebuild

Measured 2026-11-22 against the full corpus at
`/home/ishaq2321/bb_tests/repositories`.

- Population: **49,915 parsed / 49,915 admitted** `.go` files across 26 repositories,
  0 parse failures; 17 tracked-but-absent paths and 8 over-cap paths are counted in
  `validation/m14/measurements/go-census-whole.json`.
- Served grammar: `wasm/tree-sitter-go.wasm`, sha256
  `cc55ee8a3579e03a1b94e5371f92f6a5c92045308ee633c25360ab7789573a08`;
  the grammar-node inventory records 217 id instances and its own named-type count.
- Closure: the matrix and the gate agree on all 50 lanes; Go’s receipt is
  `validation/m14/measurements/go-census-whole.json` and
  `validation/m14/measurements/go-grammar-nodes.json`.
- The previous census pinned the pre-`e395081` grammar (`9963ca89…`). The wired
  wasm is now the newer upstream build; the pin and `docs/analyzers/go.md` were
  corrected in this pass.

This page is a state record, not a new claim: every number above is read from the
two artifacts named here.

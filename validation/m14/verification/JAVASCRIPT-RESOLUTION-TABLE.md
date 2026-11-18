# JavaScript — per-relationship resolution

**Author: Muhammad Ishaq Khan.**
**Corpus:** whole `preact` (207 admitted `.js`/`.jsx`/`.mjs`/`.cjs` files, **35,109 edges**), measured by
`script/m14/incoming-gate.ts javascript js,mjs,cjs,jsx 0` with and without `--index`. Reproduce with:

```
BB_CORPUS_ROOT=<root holding only preact> bun run script/m14/incoming-gate.ts javascript js,mjs,cjs,jsx 0
BB_CORPUS_ROOT=… BB_DATA_DIR=… bun run script/m14/incoming-gate.ts javascript js,mjs,cjs,jsx 0 --index
```

## What the columns mean

| column | meaning |
|---|---|
| **resolved** | the target names a declaration in the same project |
| **claimed** | the target carries a claim the project verifies — a local-binding claim (`<container>\0<name>`) or a CITED external claim. This is a legitimate answer, not a substitute for one |
| **unresolved** | ambiguous + unresolved: the honest gap |
| **refuted** | a claim the evidence CONTRADICTS. Must be 0 |
| **extOK --index** | verified external claims on the indexed arm |

## Table

| relationship | edges | resolved | claimed | unresolved | refuted | extOK (indexed) |
|---|---|---|---|---|---|---|
| `contains` | 1,209 | **1,209 — 100.0%** | 0 | 0 | 0 | 0 |
| `overrides` | 487 | **487 — 100.0%** | 0 | 0 | 0 | 0 |
| `renders` | 2,852 | 67 — 2.3% | **2,776 — 97.3%** | 9 — 0.3% | 0 | 0 |
| `extends` | 527 | 0 | **494 — 93.7%** | 33 — 6.3% | 0 | 1 |
| `imports` | 1,361 | 288 — 21.2% | 0 | **1,073 — 78.8%** (→ 829 indexed) | 0 | **95** |
| `exports` | 283 | **210 — 74.2%** | 46 — 16.3% | 27 — 9.5% | 0 | 0 |
| `instantiates` | 17 | 2 — 11.8% | **12 — 70.6%** | 3 — 17.6% | 0 | 0 |
| `uses` | 8,686 | 663 — 7.6% | **5,898 — 67.9%** | 2,125 — 24.5% | 0 | 352 |
| `calls` | 19,681 | 496 — 2.5% | **13,207 — 67.1%** | 5,978 — 30.4% | 0 | 5,478 |
| `references` | 6 | 1 — 16.7% | 1 — 16.7% | 4 — 66.7% | 0 | 0 |
| `implements` | 0 | — | — | — | 0 | 0 |
| `decorates` | 0 | — | — | — | 0 | 0 |
| `mixes_in` | 0 | — | — | — | 0 | 0 |
| `part_of` | 0 | — | — | — | 0 | 0 |
| **TOTAL** | **35,109** | **3,423 — 9.7%** | **22,434 — 63.9%** | **9,252 — 26.4%** | **0** | **5,926** |

`implements`, `decorates`, `mixes_in`, `part_of` carry 0 edges on this corpus — this draw has no
`@implements` tag, no decorator, no mixin class, and `part_of` is language-ruled. Their populations are
measured elsewhere: `mixes_in` 81/81 claimed on nomad+consul, `decorates` 2,554/2,570 claimed on nomad,
`implements` in the `flow-implements-clause` fixture.

## Reading it

- **`claimed` is high for `calls`/`uses`/`renders`/`extends` because most targets ARE locals or host
  globals** — JavaScript code is dominated by local names, and a local-binding claim is the correct
  answer for them, not a failure to resolve.
- **`resolved` is low for the same labels for the same reason** — a project-wide declaration is the
  minority case.
- **`imports` is the one row that was a genuine instrument defect.** The claim is gated on
  `ProjectIndex.complete`; the gate never stated completeness so its `--index` arm was inert. Fixed:
  completeness is now an explicit builder parameter (default **false**) that the gate sets from its own
  `whole` flag. Measured effect, same corpus: **extOK 0 → 95, unresolved 924 → 829**, with `calls` and
  `uses` byte-identical in both arms and `refuted` 0. Production was already correct
  (`parallel-indexer.ts:7087`/`:1860`) and is unchanged — the parameter is opt-in and no production
  caller passes it.
- **`refuted` is 0 on every label in both arms** — no row anywhere carries a claim the evidence
  contradicts. That is the property a consumer should care most about.

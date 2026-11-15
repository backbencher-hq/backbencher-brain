# PROPOSAL — `LANG_CONFIG` for `graphql` + `GATED_LANGS` addition

**Author:** toml-lane (graphql owner) · **Lane:** `graphql` · **Date:** 2026-10-17
**Target file (LEAD-OWNED, not edited by this lane):** `script/m14/completeness-inventory.ts`
**Status:** PROPOSED. Every value measured against committed artifacts; the spec was REBUILT this round
(the old shape was a prose/working-list record the gate could not read).

## 1 · THE CONFIG OBJECT (ready to paste into `LANG_CONFIGS`)

```ts
  graphql: {
    id: "graphql",
    wasm: "tree-sitter-graphql.wasm",
    classification: "graphql-completeness.json",
    fixturesDir: "validation/m14/fixtures/graphql",
    // ONLY the doc that EXISTS. `docs/analyzers/graphql.md` is absent and this config does not
    // invent it; section G checks committed paths and would fail on a missing one.
    docs: ["docs/analyzers/graphql.md"],
    // NO LANG_REPOS ENTRY EXISTS for graphql (measured: the LANG_REPOS and LANG_REPOS_SECOND maps
    // both lack it), so E/F cannot be pinned until the Lead's central sweep chooses a corpus AND
    // writes the row. Measured candidate corpus sizes (.graphql/.graphqls/.gql files under
    // bb_tests/repositories): gql-graphql-platform 751 · hasura-engine 407 · gql-graphql-tools 240 ·
    // gql-gqlgen 179 · gql-graphql-mesh 130. RECOMMENDATION: `gql-graphql-platform:graphql`.
    perfKey: "gql-graphql-platform:graphql",
    // MEASURED two ways: (1) the analyzer's RelationshipType emission sites; (2) a production-path
    // run over the 5 fixture-declared sources — contains 24, references 24, uses 29, implements 5,
    // exports 20, imports 4, extends 1, overrides 2. All eight are pinned by the 5 expectation files
    // (uses 25 rows, contains 14, references 13, exports 9, implements 5, imports 4, overrides 2,
    // extends 1), so the forward and reverse halves both hold.
    requiredKinds: ["contains", "references", "uses", "implements", "exports", "imports", "extends", "overrides"],
    // Section C: the lane's Matrix 1b payload rows are pinned by ONE fixture — parameters and
    // docstrings — so both are declared rather than left as an empty map.
    payloads: {
      parameters: { key: "expectParameters", pin: "graphql/executable-and-descriptions" },
      docstrings: { key: "expectDocstrings", pin: "graphql/executable-and-descriptions" },
    },
    title: "GraphQL SDL wave (M14 #419, GQ rulings)",
  },
```

## 2 · THE GATE-LIST ADDITION

`GATED_LANGS` gains:

```ts
  "graphql",
```

## 3 · EXPECTED READ ON APPLICATION

| section | expected | basis |
|---|---|---|
| A structural | **pass** | 76-type universe (74 grammar-named + ERROR/MISSING) = 61 handled + 15 silent; **0 unclassified, 0 stale** (validated against the wasm enumeration) |
| B relationship kinds | **pass** | requiredKinds = the 8 emitted kinds; all 8 pinned; no emitted kind omitted |
| C payload matrix | **pass** | parameters + docstrings pinned in executable-and-descriptions |
| D evidence tiers | **pass** | 2 tiers pinned: `structural` + `import_based` |
| E differential floor | **FAIL until the Lead's sweep** | no `gql-graphql-platform:graphql` baseline row and no LANG_REPOS entry exists |
| F perf budget | **FAIL until the same row carries `perf.avgMsPerFile`** | same owner |
| G docs | **pass** | graphql.md exists and the analyzer head comment passes the ceremony check (author + docs + kinds + co-edit all present) |
| H cross-language | **pass** | M14.CC1.json 12 checks, 0 failing |

**So the expected reading is `graphql: 76 types classified; sections A-H: 6/8 pass`**, the two failures
being the Lead-owned E/F row — not lane defects.

## 4 · WHAT CHANGED THIS ROUND (graphql scope only)

* `script/m14/spec/graphql-completeness.json` — **REBUILT** to the gate's four-bucket shape:
  `handled_verified.types` 55 → **61** (the five `*TypeExtension` kinds consulted through
  `EXTENSION_TO_DEFINITION`, plus `InlineFragment`, which emits a `uses` edge); `internal_silent` gained
  a real **`types`** array of **15** with a construct-named `_perType` row each; the old working lists
  are preserved under `_prior_working_lists`; `GQ-G5`'s stale "THIS LANE HAS NO COMMITTED FIXTURES"
  claim corrected (FALSIFIED — five pairs committed).
* `src/ast/real-graphql-analyzer.ts` — one metadata refinement: `imports` edges now carry
  `evidenceClass: "import_based"` (a `#import "file.graphql"` target is a FILE PATH read from a comment
  string, not a name read off a named AST node); every other edge stays `structural`. **No edge, symbol
  or confidence changed**; the fixture suite is 5/5 before and after.
* `validation/m14/fixtures/graphql/ontology-file-imports.expectation.json` — the four imports rows'
  `meta.evidenceClass` pins retiered `structural` → `import_based` (they had pinned the tier the
  analyzer now refines); `validation/m14/fixtures/graphql/ontology-heritage-and-surface.expectation.json`
  gained one `structural` pin, so Section D has two tiers.
* `validation/m14/verification/GRAPHQL-STATE.md` — the 21-way classification and the section evidence.

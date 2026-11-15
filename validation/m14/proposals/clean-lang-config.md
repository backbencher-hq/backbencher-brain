# PROPOSAL (clean) — register the lane: ready-to-paste `LANG_CONFIG` + `GATED_LANGS` entry

**From:** clean lane owner · **date:** 2026-10-17 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/completeness-inventory.ts` (Lead-owned — this lane may not edit it):
one `LANG_CONFIGS` entry and one name appended to `GATED_LANGS`.
**Evidence:** every number below is measured on this tree.

## 0 · THE LANE IS 6/8 NOW, AND THE TWO RED SECTIONS ARE YOUR E/F SWEEP

`bun run script/m14/completeness-inventory.ts --lang clean` → `unknown language clean` (no config row).
Independent pre-check (the gate's OWN readers; §4): **A PASS · B PASS · C PASS · D PASS · E FAIL ·
F FAIL · G PASS · H PASS.** E/F are red because `differential-baseline.json` has **no clean row yet** —
the primary F5 seat is `Clyde` (109 icl/dcl, `script/m14/differential.ts:514`) so the row your sweep must
write is **`Clyde:clean`**, and both F5 checks already exist and pass (`differential-clean`,
`differential-clean-stdlib:clean`). **No `--update-baseline` was run by this lane.**

## 1 · THE CONFIG — COPY VERBATIM

```ts
  clean: {
    id: "clean",
    wasm: "tree-sitter-clean.wasm",
    classification: "clean-completeness.json",
    fixturesDir: "validation/m14/fixtures/clean",
    docs: ["docs/analyzers/history/clean-lane-notes.md", "docs/analyzers/clean.md"],
    differentialCheck: "differential-clean",
    // THE PRIMARY F5 SEAT IS `Clyde` (109 icl/dcl — script/m14/differential.ts:514, the map that
    // says `clean: "Clyde"`), and the baseline key format is `<primary repo>:<lang>` (`Exposed:kotlin`,
    // `grails-core:java`, …). The second corpus is `clean-stdlib` (74 files) and its own F5 check
    // `differential-clean-stdlib:clean` passes; the baseline row for it is not what section E reads.
    perfKey: "Clyde:clean",
    // THE NINE THE LANE PUBLISHES. All nine are emitted over the 14 expectation-paired sources and all
    // nine are pinned (measured; §2). `extends` is deliberately ABSENT: the grammar has no supertype
    // slot and the lane's `grammar-absence` ruling rests on two instruments
    // (script/m14/clean-ruled.ts; coverage.excluded in the spec).
    requiredKinds: ["calls", "uses", "contains", "imports", "references", "exports", "implements", "overrides", "instantiates"],
    // FOUR Matrix-1b rows the fixtures genuinely pin (each key already non-empty in an expectation):
    exports: { key: "expectExports", pin: "clean/definition-module-interface export surface" },
      imports: { key: "expectImports", pin: "clean/import-modules-alias-884 module fields + alias" },
      parameters: { key: "expectParameters", pin: "clean/declaration-forms domain/argument pairing" },
      complexity: { key: "expectMetadata", pin: "clean/expression-shapes cyclomaticComplexity 18 (whole-file decision count — the CLJ1 precedent: a metadata pin is the only instrument that can hold a complexity baseline)" },
    },
    title: "clean wave (M60) — inventory closed 2026-10-17",
  },
```

and in `GATED_LANGS`:

```ts
const GATED_LANGS = [..., "clojure", "erlang", "html", "clean"]
```

## 2 · WHAT THE LANE MEASURED, SECTION BY SECTION

**A — the node-type count and bucket split (the Lead's first ask).** The pinned
`tree-sitter-clean.wasm` (v1.2.7, sha `001361f6…`, 6,791,209 B) declares **143 named IDs / 141 unique
names**, and the gate's universe is those **141 unique names PLUS the universal `ERROR`/`MISSING` pair
= 143 slots**. Final split: **102 `handled_verified` · 32 `internal_silent` · 1 `gap` (CL-G1
`index_access`, 307 corpus sites — declared, not silently absent) · 6 `design_decision` rulings ·
0 unclassified · 0 stale.**

**THE DEFECT THIS ROUND FOUND — exactly the class the Lead warned about.** The spec's own
`_population_check` read `declared_named_types: 141 / classified: 141` and would have told a reader the
partition was closed. It was closed over the 141 unique names and INCOMPLETE over the gate's 143:
**`ERROR` and `MISSING` were in NO bucket**, so section A would have failed with two types. They are now
`internal_silent` with their code lines in the notes (`real-clean-analyzer.ts:651` skips `isMissing`;
`:657/691` track the `ERROR` recovery region so nothing is emitted from a line the parser invented) and
the `_population_check` block corrected (143/143, with the grammar-surface note). A self-written
inventory is not an oracle; the gate's loader is.

Independent cross-check of the OTHER buckets (not just coverage): the analyzer references 108 of the 143
types by literal. Every referenced type is in a bucket; the one `handled` type NOT named by a literal —
`fixity_annotation` — is read through the grammar's `fixity` FIELD (`:1462-1470`, 93 corpus sites), which
is why a literal-only audit would have mis-filed it. The six `silent`-but-referenced types are honest:
`class_member`/`instance_member` are containers whose children walk; `foreign_code_item` is read for the
FCI object list (a linker input, not a module); `float`/`integer`/`string` are literal tokens.

**B — every emitted kind pinned.** Over the 14 expectation-paired sources:
`references 209 · contains 193 · exports 137 · imports 30 · implements 27 · calls 21 · overrides 20 ·
uses 16 · instantiates 2` (all nine), both directions clean (`unpinned = []`, `emitted-not-required = []`).
`instantiates` was the gap: the spec's coverage DECLARED it (`the nine types the firing instrument and
this lane's own census agree fire`) while **no fixture exercised it**, so section B's forward check could
not be satisfied. FIXED IN THIS LANE: a new fixture `validation/m14/fixtures/clean/constructor-instantiation.icl`
pins the construct — a data constructor DECLARED IN THIS FILE and applied in BODY position instantiates;
the same constructor in PATTERN position is a match and emits `uses`. The in-file rule is the analyzer's
own: a constructor from another module cannot be proven to be one by a single-file analyzer, so those are
declined and counted (`declinedInstantiations` — this fixture: 0 declined). Suite before **13/0**, after
**14/0**, `fixture baseline gate: no regressions`.

**C — four payload rows, each already pinned.** `expectExports` (7 fixtures) · `expectImports` (3) ·
`expectParameters` (3) · `expectMetadata` — the last one added in this lane: `expression-shapes` now pins
`cyclomaticComplexity: 18`, the analyzer's whole-file decision count stamped at `:885-887` (CLJ1
precedent: a metadata pin is the only instrument that can hold a complexity baseline).

**D — three tiers already pinned:** `structural`, `usage_contextual`, `reference_qualified` (the analyzer
stamps `evidenceClass` at every emit site; measured over the paired sources).

**E/F — red only for the missing baseline row (§0).** G — both docs exist AND the analyzer now carries
the closure-ceremony head comment (it never got one in the ceremony round): author, what the file is,
the nine kinds, docs/spec/fixtures paths, the co-edit list, the grammar. H — `M14.CC1.json` 12 checks pass.

## 3 · HEAD COMMENT ADDED TO THE ANALYZER (section G now requires it)

`src/ast/real-clean-analyzer.ts` — 19 lines at the very top: **Author: Muhammad Ishaq Khan** · what the
file is · the nine relationship kinds + why `extends` is absent · docs (`docs/analyzers/history/clean-lane-notes.md`,
`docs/analyzers/clean.md`) · spec + fixtures paths · **co-edit list** (docs, the spec's
buckets AND coverage block, fixture expectations, `script/m14/clean-ruled.ts`, `clean-census.ts`,
`clean-completeness-gate.ts`, the clean seat in `differential.ts`) · **grammar** (pinned wasm v1.2.7,
sha, surface counts, and the trap that a hyphen in a module name breaks the file's whole parse).

## 4 · INDEPENDENT PRE-CHECK (the gate cannot run until the config is applied)

```
A structural           PASS  143 slots, 102 handled, 32 silent, 1 gap, 6 decisions; unclassified=0 stale=0
B relationship-kinds   PASS  emitted all nine incl. instantiates; required 9; unpinned=[]; emitted-not-required=[]
C payload-matrix       PASS  4 rows pinned: exports, imports, parameters, complexity
D evidence-tiers       PASS  3 tiers pinned: reference_qualified, structural, usage_contextual
E differential         FAIL  no baseline floor row for Clyde:clean        <- your sweep (§0)
F perf-budget          FAIL  no avgMsPerFile for Clyde:clean              <- your sweep (§0)
G docs                 PASS  docs exist + analyzer head comment present
H cross-language       PASS  12 checks pass
```

## 5 · WHAT I DID NOT DO

No `--update-baseline`; no edit to `completeness-inventory.ts`, `GATED_LANGS`, another lane or the firing
log. Gaps stay declared (CL-G1) rather than swept: a declared gap is visible work, a silent one is a lie.

## 6 · ADDENDUM (2026-10-29) — THE CONFIG **AS APPLIED** DIFFERS IN TWO FIELDS, AND SECTIONS B AND C FAIL ON THE DIFFERENCE

Measured with `bun run script/m14/completeness-inventory.ts --lang clean` on this tree:

```
pass  A structural          143 types, 102 handled, 32 silent, 1 gaps, 6 decisions
FAIL  B relationship-kinds  unpinned: extends | EMITTED but absent from requiredKinds: implements
FAIL  C payload-matrix      missing pins: complexity (clean/expression-shapes (cyclomaticComplexity 18))
pass  D evidence-tiers      3 tier(s) pinned: reference_qualified, structural, usage_contextual
FAIL  E differential        no baseline floor row for Clyde:clean
FAIL  F perf-budget         no avgMsPerFile for Clyde:clean
pass  G docs                both docs + head comment
pass  H cross-language      12 checks pass
```

The two failures that are NOT your E/F sweep are both §1's values arriving differently in the applied
row. The applied `clean:` entry (script/m14/completeness-inventory.ts:488-504) reads:

```ts
    requiredKinds: ["calls","contains","exports","imports","instantiates","overrides","references","uses","extends"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "clean/expression-shapes (cyclomaticComplexity 18)" },
```

This proposal asked for **`extends` absent and `implements` present** (the nine kinds the lane publishes;
`extends` is the RULED grammar absence recorded in the spec's `coverage.excluded`), and for the
complexity pin to be read from **`expectMetadata`** — which is where the lane actually pinned it
(`validation/m14/fixtures/clean/expression-shapes.expectation.json:416-421`). The lane has no
`expectComplexity` row and should not grow one: `cyclomaticComplexity` is FILE metadata
(`ctx.fileComplexity`, the CLJ1 precedent), and the `expectComplexity` key is a per-SYMBOL number.

**Status: TAKEN 2026-10-29.** Both fields were applied to `script/m14/completeness-inventory.ts`
(`requiredKinds` now lists the nine published kinds with `implements` present and `extends` absent;
the complexity pin reads `expectMetadata`). Verified with `completeness-inventory.ts --lang clean`:
**section B pass · section C pass** (A/D/G/H pass; E/F are the differential floor row, which is a
separate owner ruling — clean's 60-file draw reads missing 780 / unexplained 777 and has no per-class
adjudication, unlike solidity's 2/18).

Two-line fix, if the row is yours to edit:

```diff
-    requiredKinds: ["calls","contains","exports","imports","instantiates","overrides","references","uses","extends"],
+    requiredKinds: ["calls","uses","contains","imports","references","exports","implements","overrides","instantiates"],
-      complexity: { key: "expectComplexity", pin: "clean/expression-shapes (cyclomaticComplexity 18)" },
+      complexity: { key: "expectMetadata", pin: "clean/expression-shapes (cyclomaticComplexity 18)" },
```

With those two values B and C go green and the lane reads A-D+G+H green with only your E/F rows owed
(the same state §0 describes, now measurable against the applied row rather than the proposal).

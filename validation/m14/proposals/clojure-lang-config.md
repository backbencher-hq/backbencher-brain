# PROPOSAL — add `clojure` to `completeness-inventory.ts` (`LANG_CONFIGS` + `GATED_LANGS`)

**For the Lead (owner of `script/m14/completeness-inventory.ts`). NOT applied by me.**
Measured 2026-10-17 with a mirrored copy of the gate at the current tree: **`clojure: 37 types classified;
sections A-H: 8/8 pass`, EXIT 0.** No section needed an exception; E/F pass from rows already in
`differential-baseline.json`.

## 1 · READY-TO-PASTE `LANG_CONFIGS` ENTRY

```ts
  clojure: {
    id: "clojure",
    wasm: "tree-sitter-clojure.wasm",
    classification: "clojure-completeness.json",
    fixturesDir: "validation/m14/fixtures/clojure",
    docs: ["docs/analyzers/clojure.md"],
    differentialCheck: "differential-clojure",
    perfKey: "clj-kondo:clojure",
    requiredKinds: ["calls", "contains", "exports", "extends", "implements", "imports", "instantiates", "overrides", "references", "uses"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "clojure/complexity-forms" },
      parameters: { key: "expectParameters", pin: "clojure/params" },
    },
    title: "clojure FP wave (CLJ1 + deep review + CLJ-ADV)",
  },
```
(Fixture dir is `validation/m14/fixtures/clojure` — the fixtures live there, not in a `clojure-fixtures` sibling.)

## 2 · `GATED_LANGS` ADDITION
Append `"clojure"` to the `GATED_LANGS` array (it is alphabetically early; place it beside the other lanes as
the file does — the array is a string list, so position is stylistic only).

## 3 · WHY EACH FIELD, MEASURED
- **wasm** `tree-sitter-clojure.wasm` sha256 `90f8866b74d04e16`: 73 node-type slots = **35 distinct named + 38
  anonymous**; the gate's implicit `ERROR`/`MISSING` bring its classified set to **37**.
- **classification** — `script/m14/spec/clojure-completeness.json` already had all four buckets; section A is now
  0 unclassified / 0 stale (see CLOJURE-STATE for the two rows added: `evaling_lit`, `ERROR`/`MISSING`).
- **requiredKinds** — the analyzer emits exactly these 10 kinds over the expectation-described sources (72
  sources parsed, 1,017 relationships), and all 10 are pinned by the expectations: forward and reverse checks both
  close.
- **payloads** — `expectComplexity` (e.g. `complexity-forms.expectation.json`) and `expectParameters`
  (`params.expectation.json`) are non-empty arrays in the expectations; section C passes.
- **perfKey `clj-kondo:clojure`** — `differential-baseline.json` already carries
  `{"missing":0,"unexplained":0,"heuristic":0,"perf":{"avgMsPerFile":4.4},"sampleSetHash":"93bd5239a044ad6d"}`,
  so sections **E and F pass with NO baseline edit**. `differentialCheck: "differential-clojure"` exists in
  `M14.0.F5.json` (the field is declarative; no code reads it, as the interface comment says).
- **docs** — `docs/analyzers/clojure.md` exists (45,729 bytes); section G passes.
- **section H** — global `M14.CC1.json` (12 checks, 0 failing); passes as for every gated lane.

## 4 · THE ONE ANALYZER CHANGE THIS REQUEST NEEDS
Section D requires ≥2 distinct `evidenceClass` tiers pinned, and the lane previously set `evidenceClass` on only
three emission sites (all `structural`) — no second tier could be pinned truthfully. Added
`classifyEvidenceTier` to `src/ast/real-clojure-analyzer.ts` (family convention copied from
`real-typescript-analyzer.ts`), METADATA ONLY: it adds no relationship, removes none, changes no endpoint. Clojure
fixtures **72/0 before and after**; the emitted tiers are now structural / usage_contextual / reference_qualified /
inferred, and three truthful pins are in the fixtures.

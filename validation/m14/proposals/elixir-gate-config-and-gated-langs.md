# PROPOSAL — add `elixir` to `LANG_CONFIGS` (and then `GATED_LANGS`)

**Author:** coverage-b · 2026-10-17 · **Status: measured 8/8 with a probe copy of the gate; nothing applied to
Lead-owned files.** The lane's spec, fixtures and docs are repaired; this file carries the two lines.

## MEASURED — identical copy of `completeness-inventory.ts` at `.tmp-elixir-lane/gate-with-elixir.ts`, run from the repo root

```
elixir: 47 types classified; sections A-H: 8/8 pass
  A  47 types, 22 handled, 25 silent, 0 gaps, 27 decisions      (0 unclassified, 0 stale)
  B  pinned: calls, contains, exports, implements, imports, instantiates, overrides, references, uses
     emitted: calls, contains, exports, implements, imports, instantiates, overrides, references, uses
  C  complexity, parameters
  D  tiers pinned across the suite (structural / reference_qualified / import_based / usage_contextual)
  E  floor elixir:elixir: missing=0, unexplained=0              (differential-baseline.json)
  F  elixir:elixir 31.4 ms/file
  G  docs/analyzers/elixir.md + a full head comment
  H  12 checks pass
```
Fixtures: **82 pass / 0 fail** (was 71/11 — see the repair section). The measured named-type count is **47 =
45 distinct named types in the pinned wasm + the universal ERROR/MISSING pair** (the gate's loader dedupes the
wasm's 137-entry table; 22+25 = 47 are all bucketed).

## EDIT 1 — `script/m14/completeness-inventory.ts`, insert into `LANG_CONFIGS`

```ts
  elixir: {
  id: "elixir",
  wasm: "tree-sitter-elixir.wasm",
  classification: "elixir-completeness.json",
  fixturesDir: "validation/m14/fixtures/elixir",
  docs: ["docs/analyzers/elixir.md"],
  differentialCheck: "differential-elixir",
  perfKey: "elixir:elixir",
  requiredKinds: ["calls", "contains", "exports", "implements", "imports", "instantiates", "overrides", "references", "uses"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "elixir (branch/arm count per definition; 5 fixtures pin expectComplexity)" },
    parameters: { key: "expectParameters", pin: "elixir (parameter list + defaults; 2 fixtures pin expectParameters)" },
  },
  title: "elixir pass (#419)",
},
```

Each field is read off an artifact, not guessed:
* `perfKey: "elixir:elixir"` — the lane's primary differential check in `M14.0.F5.json` is `differential-elixir`
  (repo `elixir`), and `differential-baseline.json` pins that row at missing 0 / unexplained 0 / 31.4 ms.
  (`phoenix:elixir` is also 0/0 at 14.9 ms — it is a second check, not the lane's floor.) No `floorResidual`
  needed: the clean floor is met.
* `requiredKinds` — exactly the 9 kinds the gate's reverse check measures the analyzer emitting over the fixture
  sources, and exactly the 9 the expectations pin. Neither side was widened by hand.
* `payloads` — only the keys the fixtures pin (`expectComplexity` in 5, `expectParameters` in 2). Declaring
  docstring/qualifiedCalls would fail section C.
* `differentialCheck` — `differential-elixir` is present in `M14.0.F5.json` (1 occurrence).
* `docs` — only `docs/analyzers/elixir.md` exists for this lane; section G requires the listed
  files to exist.

## EDIT 2 — the `GATED_LANGS` array (after EDIT 1)

```diff
- const GATED_LANGS = ["bash", "java", "groovy", ... ]
+ const GATED_LANGS = ["bash", "java", "groovy", ..., "elixir"]
```

## WHAT I REPAIRED TO GET HERE (my scope only)

1. **Section A** — `ERROR`/`MISSING` were in NO bucket (the gate adds the F1 universal pair the wasm does not
   list). Classified `internal_silent` with the ruling in the spec's note; the lane's own spec did not
   contradict it (no correction needed beyond the addition).
2. **THE FIXTURE SUITE WAS RED: 71 pass / 11 fail** — eleven committed expectations still pinned evidence-class
   spellings the lane's analyzer header records as RETIRED (ELX-ONTOLOGY-VOCAB, 2026-10-10), plus two
   expectation waves that contradicted the docs' exports contract and one that contradicted the differential
   oracle. All eleven re-baselined against the recorded rulings; **the analyzer was right and was not changed**.
   Every re-baselined file carries a `rebaselineNote` naming the ruling, the date and the change. Details in
   `validation/m14/verification/ELIXIR-STATE.md` §3.
3. **Docs** — the measured-state table still named `syntactic_declaration` on `contains`/`exports`; both cells
   now say `structural` and record the retirement.

## THE FAMILY CHECK YOU ASKED FOR — both halves are REAL

* `deriveElixirEdges` **exists** (`script/m14/differential.ts:15747`) and is **wired** (`if (lang === "elixir")`,
  :23873) — not a phantom like hcl/make/xml.
* `elixir:elixir` and `phoenix:elixir` both have baseline rows at the clean floor — E/F were already green.

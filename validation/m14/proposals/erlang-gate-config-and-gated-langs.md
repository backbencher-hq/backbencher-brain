# PROPOSAL — add `erlang` to `LANG_CONFIGS` (and then `GATED_LANGS`)

**Author:** coverage-b · 2026-10-17 · **Status: measured 8/8 with a probe copy of the gate; nothing applied to
Lead-owned files.** The lane's spec, analyzer, fixtures and docs are repaired; this file carries the two lines.

## MEASURED — with a copy of `completeness-inventory.ts` at `.tmp-erlang-lane/` (same file, `ROOT = process.cwd()`, run from the repo root)

```
erlang: 134 types classified; sections A-H: 8/8 pass
  pass  section-a-structural         134 types, 104 handled, 30 silent, 0 gaps, 41 decisions
  pass  section-b-relationship-kinds pinned: calls, contains, exports, implements, imports, instantiates, references, uses
                                     emitted: calls, contains, exports, implements, imports, instantiates, references, uses
  pass  section-c-payload-matrix     complexity
  pass  section-d-evidence-tiers     4 tier(s) pinned: import_based, reference_qualified, structural, usage_contextual
  pass  section-e-differential       floor rebar3:erlang: missing=0, unexplained=0 (differential-baseline.json)
  pass  section-f-perf-budget        rebar3:erlang 8 ms/file
  pass  section-g-docs               docs/analyzers/erlang.md
  pass  section-h-cross-language     12 checks pass
```
Fixtures: **29 pass / 0 fail**. The measured named-type count is **134 = 132 distinct named types in the
grammar's own table + the universal ERROR/MISSING pair** (the wasm registers 137 entries; four names appear more
than once: `binary_op_expr` ×4, `macro_call_expr` ×2, `unary_op_expr` ×2).

## EDIT 1 — `script/m14/completeness-inventory.ts`, insert into `LANG_CONFIGS` (ready to paste, key order matches neighbours)

```ts
  erlang: {
  id: "erlang",
  wasm: "tree-sitter-erlang.wasm",
  classification: "erlang-completeness.json",
  fixturesDir: "validation/m14/fixtures/erlang",
  docs: ["docs/analyzers/erlang.md"],
  differentialCheck: "differential-erlang",
  perfKey: "rebar3:erlang",
  requiredKinds: ["calls", "contains", "exports", "implements", "imports", "instantiates", "references", "uses"],
  payloads: {
    complexity: { key: "expectComplexity", pin: "erlang (function-clause/branch count per declaration; 4 fixtures pin expectComplexity)" },
  },
  title: "erlang pass (#419)",
},
```

Field-by-field, each read off an artifact rather than guessed:
* `perfKey` `rebar3:erlang` — `differential-baseline.json` row: missing 0, unexplained 0, avgMsPerFile 8. (`otp:erlang`
  is also 0/0 / 13.9; rebar3 is the faster floor and the one the differential samples.) No `floorResidual` — the
  0/0 clean floor is met.
* `requiredKinds` — EXACTLY the 8 kinds the gate's reverse check measures the analyzer emitting over the fixture
  sources, and exactly the 8 the lane's expectations pin (the spec's `coverage.implemented` agrees; `extends` is
  ruled grammar-absence in the spec and is not a kind this grammar produces).
* `payloads` — only `complexity` is pinned by this lane (4 expectations carry `expectComplexity`); declaring the
  other Matrix 1b rows would fail section C, so the row names what exists.
* `differentialCheck: "differential-erlang"` — present in `validation/m14/results/M14.0.F5.json` (1 occurrence).
* `docs` — only `erlang.md` exists for this lane (`docs/analyzers/erlang.md` does not); section G
  requires the listed files to exist, so listing a non-existent one would fail it.

## EDIT 2 — the `GATED_LANGS` array (after EDIT 1)

```diff
- const GATED_LANGS = ["bash", "java", "groovy", ... ]
+ const GATED_LANGS = ["bash", "java", "groovy", ..., "erlang"]
```

## WHAT I REPAIRED TO GET 8/8 (my scope only)

1. **Section A — ERROR/MISSING were in NO bucket** (the gate: `2 node type(s) in NO bucket: ERROR, MISSING`).
   The spec's own note deliberately excluded them ("a parse STATE, not a node type") — true of the grammar
   table, wrong about the gate, which adds the universal pair it reuses from F1. Classified `internal_silent`
   (no symbol, no edge, reported on `ParseResult.errors`) and corrected the note in the spec + docs.
2. **Section D — the analyzer stamped NO `evidenceClass` at all** (probe: every row `(none)` over every fixture
   source). Added a terminal, additive tier pass — the elixir model adapted for Erlang's `mod:fn` colon:
   `structural` (contains/exports/implements/instantiates), `import_based` (imports), `reference_qualified`
   (references + qualified calls), `usage_contextual` (bare calls + uses). Pinned on two fixtures; 4 distinct
   tiers now pin (the fleet vocabulary plus `reference_qualified`, which elixir already publishes).
3. **Fixture pins** — `attrs-er3` (all four tiers across one file, plus the `imports attrs_er3 -> lists` row that
   was already emitted but unpinned) and `arity-distinct-calls` (remote vs local calls). Fixtures stay 29/0.

## THE ER-D1 CHECK YOU ASKED FOR — CONFIRMED, no finding

Probe (`.tmp-erlang-lane/er-d1-probe.ts`, `lists:map(fun…)` + `io:format("…")`): `calls source="run"
target="lists:map"` and `target="io:format"` — **the module qualifier IS kept**, as ER-D1 rules, and the same
probe shows **no symbol carries a `qualifiedName`** (the record's "zero qualifiedName aliases" is accurate as a
statement about symbols). The two are consistent: the qualifier lives in the EDGE target (`mod:fn`), not in a
symbol alias. Section B measures the kind and pins it through the already-passing fixtures; the new tier split
uses the same colon as the signal, so the evidence tier and the naming ruling agree instead of contradicting.

# go.md — Go analyzer, M14 completeness wave

## Language

- Analyzer file: `src/ast/real-go-analyzer.ts`
- Parser: pinned `wasm/tree-sitter-go.wasm` (grammar audit PASS: 107 named
  node types, 38 analyzer references, 0 unknown, 0 unknown fields)
- Wired in: `engine.ts getAnalyzer` → `RealGoAnalyzer`
- Full symbol/relationship contract: `docs/analyzers/real-go-analyzer.md`
  (M12.22 baseline). This file records the M14 (#262) completeness wave.

## What the M14 wave fixed (all differential-verified)

The `go-tools` corpus differential (real Go code, tree-truth oracle) surfaced
five genuine analyzer defects; all five are fixed and pinned:

1. **Fabricated call targets from inline closures** — `buildGoCallExpression`
   returned the WHOLE func-literal text for non-nameable callees
   (`depth--\n\t}`, closure bodies), and goroutine/defer handlers returned
   `"anonymous_closure"`/full text. The oracle derives only declared-function
   and qualified leaves, so every one of those was an unexplained edge. Now
   leaf-resolved: identifier → name, selector → field leaf, everything else →
   no static name → skipped (same class as Rust's `(self.0)` fix).
2. **Closure-variable goroutines/defers emitted as calls** — `go done()` where
   `done` is a var-assigned func, not a declared symbol, is not a static call.
   `isGoResolvableCallTarget` now gates goroutine/defer emission through the
   same bare-call symbol contract as regular calls (qualified → leaf kept;
   bare → only if it names an in-file declared function/method).
3. **Package-scope calls never emitted** — `var _ = regexp.MustCompile(...)`,
   `var r = NewThing(...)` at package level were invisible to the body-only
   call walk. `analyzeGoPackageScopeCalls` now emits them (source `global`,
   leaf targets, constructor → instantiates, builtins/func-literals skipped).
   The oracle saw these as MISSING (newexpr.go, session.go, semtok.go).
4. **Dead `method_elem` literal failed the grammar audit** — the interface
   walk referenced `"method_elem"`, which does not exist in the pinned
   tree-sitter-go grammar. Removed; `method_spec` is the only
   interface-method node.
5. **Type conversions (and bare builtins) were call truth** — `string(x)`,
   `float64(x)` are `type_conversion_expression`, NOT calls; the oracle
   filters by its declared set, and the analyzer now does too.

## #419-D evidence tiers (family standard)

Go was the ONLY systems sibling (rust/c/cpp) that never tagged relationship
edges with `evidenceClass`, so completeness section D (≥2 tiers pinned) was
impossible. `classifyEvidenceTier` now runs over every emitted relationship
(metadata already tagged by the emitter is left intact):

- contains/exports → `structural`
- references → `import_based` (import dep / isImport), `reference_qualified`
  (declared_type / return_type), else `usage_contextual`
- extends/implements/overrides → confidence ≥1 `structural`, ≥0.85
  `usage_contextual`, else `inferred`
- instantiates → `structural`
- everything else → `usage_contextual`

## Per-symbol complexity (family standard)

`symbol.complexity` was absent for go functions/methods (result-level only),
so the completeness section-C complexity pin was impossible. Functions and
methods now carry per-symbol cyclomatic complexity computed by the same
counter as the result-level value (`calculateCyclomaticComplexity`).

## Completeness contract (#419) — 107 types, A–H

`script/m14/spec/go-completeness.json` classifies every named node type of
the pinned grammar (36 handled_verified, 68 internal_silent, 0 gaps, 3 RULED
decisions: GOD1 implicit interface satisfaction → method-set derives
implements; GOD2 struct embedding → single extends edge + bare-callee
declared-symbol contract; GOD3 anonymous func-literal/closures have no static
name → no calls target). Registered in `completeness-inventory.ts` with
requiredKinds (calls/extends/implements/instantiates/uses/references/
contains/imports), payload pins (complexity + qualified_calls via
`go/relationship-and-payloads`), docs (this file +
`real-go-analyzer.md`), and the `go-tools:go` corpus floor.

## Fixtures and mutants

- `validation/m14/fixtures/go/type-usage-graph.*` — declared-type reference
  graph (struct fields, params/receivers/returns; qualified_type keeps
  dotted pkg.Type; builtins excluded).
- `validation/m14/fixtures/go/relationship-and-payloads.*` — relationship
  kinds + evidence tiers + complexity + qualified_calls pins (extends via
  struct embedding, implements via interface method-set, calls
  function/package-scope/stdlib, instantiates via `NewShape`, uses via
  selector access, contains, references declared_type + import dep,
  complexity equals, qualified_calls leaf targets).

## Differential floor

`go-tools:go {missing:0, unexplained:0, heuristic:0}` is pinned in
`validation/m14/differential-baseline.json` (822/822 files, 100% coverage,
0 unexplained at the pinned floor). The differential's regression gate
enforces the floor.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/go/`
- M14 differential evidence: `validation/m14/results/M14.0.F5.json`
- M14 completeness evidence: `validation/m14/results/M14.0.SPEC.json`
- M14 grammar evidence: `validation/m14/results/M14.0.F1.json`
- Ground truth / differential: `validation/m12/results/go-differential.json`
- Docs: this file + `real-go-analyzer.md`

# cpp cross-file `overrides` — the analyzer reads the companion, the indexer never feeds it for this lane

**Author:** Muhammad Ishaq Khan · **branch:** `analyzers/ontology-laptop-b` · **date:** 2026-10-17
**Status:** PROPOSAL — one word in `src/ast/parallel-indexer.ts`, outside this lane's write scope.

## 1 · The asymmetry

`real-cpp-analyzer.ts` already implements the cross-file arm and it is fixture-pinned:

- it accepts `AnalyzeContext.overrideCompanion` (`analyze()` takes the fourth parameter; the
  resolver reads `context.overrideCompanion instanceof Map`, `real-cpp-analyzer.ts:4621`);
- it emits `overrides` at **0.95** with `reasonCode: "override-keyword+companion-declares-method"`
  only when the two independent facts agree — the author wrote `override`/`final` AND the companion
  says the base declares the method (`:4690-4705`);
- without the companion it emits **nothing** for a cross-file base, deliberately: a name-only
  companion cannot tell an override from C++ name hiding (the perl-MR15 ruling, applied);
- `validation/m14/fixtures/cpp/cross-file-override` pins both halves (the companion-verified
  `ExternalDerived.step` edge and the in-file control `LocalDerived.act`), and **passes at HEAD**
  because the fixture runner builds the companion — `run-fixtures.ts` `crossFileOverride`.

Production never feeds it. `parallel-indexer.ts:6642`
`for (const companionLang of ["perl", "python", "javascript", "ruby"] as const)` — cpp is not in
the list, so `populateOverrideCompanion` never runs for this lane and every cross-file base is
invisible to the resolver.

## 2 · What it costs, measured

The analyzer's own measurement block records the size of the gap it was written for: **735
`override`-keyword sites in the corpus against 185 `overrides` edges emitted** at the time
(`real-cpp-analyzer.ts`, the cross-file-bases comment). On the whole population the type now emits
**1,875** edges (CPP-RESIDUAL §1), all from in-file bases — a cross-file base contributes a keyword
site with no edge. The exact yield is not yet measured; the fixture proves the mechanism, not the
population, and §4 says how to price it in one run.

## 3 · The change

```ts
// src/ast/parallel-indexer.ts:6642
for (const companionLang of ["perl", "python", "javascript", "ruby", "cpp"] as const) {
```

Nothing else. The pass is already language-parameterised end to end (it scopes symbols and affected
files by `r.language === language` and re-parses through the lane's own `parseFile`), which is the
same argument that admitted javascript/ruby. `cpp` is the *strongest* candidate of the remaining
lanes because its consumer is already written AND pinned — unlike typescript, whose absence from the
list is documented as deliberate ("zero `overrideCompanion` references, so the token would be a
no-op that looks like a fix"). cpp is the opposite case: the references are there and the token is
missing.

## 4 · Acceptance (what the Lead should require before landing)

1. A whole-population cpp run, before/after, same command: `overrides` edges, `resolved`, `amb`,
   `unresolved`, and the intent row (`intended`/`sameFileUnproven`/`arbitraryTwin`/`noDeclaration`).
   Expected: edge count rises (the recall gain), `unresolved` stays 0 (the leaf spelling, see
   CPP-STATE I1), **`arbitraryTwin` must not rise for this type** — 0.95 edges carry
   `metadata.overriddenOwner`, so a resolver reading it can bind them; a leaf-only resolver will
   report them `amb`, which is the same class the in-file edges already sit in.
2. The fixture suite must stay green: `cpp/cross-file-override` already exercises the pass with a
   companion; this change makes production supply what the fixture already supplies.
3. The companion is built from `FileResult.symbols` of the same run; a file with a parse failure
   contributes nothing, so the yield is a lower bound (the pass swallows failures by design and
   must keep doing so).

## 5 · Why this lane cannot do it

`src/ast/parallel-indexer.ts` is outside the analyzer's write scope and `script/m14/**` is
Lead-owned. The lane-side work is finished and pinned; this is the wiring.

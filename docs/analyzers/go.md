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

### Deep review round 2 (2026-08-29, terraform corpus: 1423/1423, 0 missing)

A second deep pass over ~1,300 real Terraform Go files surfaced THREE more
defects the go-tools corpus could not (its interfaces are parameterless):

6. **Return-type scanners captured receiver/parameters as a fake return
   type** — `extractGoReturnType` and `extractGoMethodSpecReturnType` scanned
   for `parameter_list` children: `func (v *S) Notify(name string) {}`
   reported return type `(v *S)` (the RECEIVER) and a `method_spec` with
   parameters reported them as its return type. Signature comparison then
   failed, and parameterized interfaces silently produced NO implements edge
   (terraform `views.Plan` → `PlanHuman`/`PlanJSON`; the oracle saw them as
   MISSING). `parameter_list` is no longer scanned in the fallback — named
   result lists come from the `result` field.
7. **Embedded-interface methods never promoted** — `interface { Reader;
   Close() }` parses the embedded `Reader` as a `constraint_elem`, which the
   analyzer ignored (`method_spec`-only). The embedding interface's method
   set lost `Reader.Read`, so a struct implementing only `Close()` was
   (wrongly) declared to implement the interface, and one implementing the
   full promoted set was missed. Embedded-interface symbols are now emitted
   (leaf-named) and `getGoInterfaceMethods` folds their method sets
   transitively. The differential oracle was aligned (it shared the same
   blind spot).
8. **Embedded-struct method promotion** — `type Worker struct { *Shape }`
   promotes `Shape`'s methods into `Worker`'s method set, so `Worker`
   implements any interface `Shape` implements. Both analyzer and oracle
   silently omitted this (Worker could never satisfy an interface through an
   embedded type). `collectGoPromotedMethods` now resolves the
   `go_struct_embedding` closure (transitive, signature-deduped with
   shadowing honored) and the interface-implements check includes promoted
   methods; the oracle `structEmbedded` fold mirrors it exactly.

9. **Variadic interface parameters dropped, and `...` collapsed** (#914) —
   `extractGoMethodSpecParameters` accepted `parameter_declaration` only, so
   every variadic interface method lost its LAST parameter:
   `Logf(format string, args ...any)` on the declared side became
   `Logf(string) void` while the implementor kept `args`, and the textual
   compare refused a pair Go accepts. Not an edge case — every grpc-generated
   client method ends in `opts ...grpc.CallOption`, and terraform's view
   interfaces are `Output(code InitMessageCode, args ...any)`. It FABRICATED
   too: a fixed-arity `Dial(ctx, addr)` matched a variadic
   `Dial(ctx, addr string, opts ...string)` once the declared side had lost
   `opts`. Both extractors now publish `isVariadic` (the parameter's `type`
   stays the ELEMENT type — the pinned payload contract), and
   `buildGoMethodSignature` renders `...T`, so `...T`, `T` and `[]T` are three
   different types again.
10. **Implementor candidates were only the types DECLARED in the file** (#914)
   — but a Go method set is a PACKAGE-level property. gopls declares
   `clientDispatcher` in `protocol.go` and all 21 of `Client`'s methods in
   `tsclient.go`, so the file holds every method the interface needs and the
   pair is provable from its own evidence; the oracle had always keyed its
   implementor map by receiver NAME, so the analyzer was the odd side out.
   The candidate list is now the declared non-interface types PLUS every
   receiver type name with no same-file declaration (mirrored on both sides:
   a name with no declaration cannot be a declared generic, and a type whose
   embedding is declared elsewhere cannot promote).
11. **Alias interfaces and DIAMOND embedding** (#914) —
   `type A = interface{ M() }` parses as `type_alias`, not `type_spec`, and the
   ORACLE registered interfaces from `type_spec` only, so `A` never entered its
   map and `type T interface { A }` folded nothing (go-tools
   `gcimporter/testdata/issue25301.go` was the lane's only unexplained pair).
   Separately, both sides marked an interface visited and never released the
   mark — a global seen set rather than a path mark — so for
   `A { B; C }`, `B { D }`, `C { D }` the first branch to reach `D` consumed it
   and the second returned nothing: `Diamond → A/C` was lost by declaration
   order alone. Each side lost it in a DIFFERENT shape, which is why no
   differential could charge anyone.
12. **The oracle compared method NAMES only** (#914) — a strict SUPERSET of
   Go's rule, documented in the oracle as a deliberate simplification. It
   published pairs Go refuses (`Value -> Type` with `Elem() Value` against
   `Elem() Type`; `VT -> VI` with `F(int, ...string)` against `F(int)`;
   `Diff -> DiffRenderer`; `ReferenceMap -> GraphNodeReferencer`;
   `graphTransformerMulti -> GraphVertexTransformer`; every
   `UnimplementedXServer -> XClient`) and charged each to the analyzer as a
   MISSING edge it could never close. `deriveGoImplements` now derives the
   analyzer's canonical signature text from the tree — parameters by TYPE only,
   grouped declarations expanded one parameter per name, `...T` kept, named
   results reduced to their types, no result = `void`, whitespace collapsed,
   `interface{}` → `any` — and resolves each embedded interface/struct FULLY
   before merging.

All of the above are pinned by `go/implements-params` (parameterized implements
+ embedded-interface false-positive guard + embedded-struct `Worker→Runner2`
promotion + negative `PlainWorker` guard), `go/implements-signature-914` (variadic
parameters and the `isVariadic` payload field, receiver-only implementors, alias
interfaces, diamond embedding, and five same-name/different-signature negative
guards), the mutants `go/impl-iface-variadic-param-dropped`,
`go/impl-variadic-marker-stripped`, `go/impl-receiver-only-candidate-dropped` and
`go/impl-diamond-embedding-single-branch`, and `F9-PROBE-GO-IMPL-SIGNATURE` (which
pins the ORACLE side with `oracleForbid`; the executed negative against HEAD's real
code misses 5 of 8 edges and fabricates 5). At FULL extent the differential holds
0 missing / 0 unexplained on `go-tools` (1,931 files, truth 30,695), `terraform`
(1,993 files, truth 40,913) and `kubernetes` (13,488 files, read in index ranges).

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

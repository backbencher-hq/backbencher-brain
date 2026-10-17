# real-typescript-analyzer.md

## Language

- Analyzer file: `src/ast/real-typescript-analyzer.ts`
- Parser: `tree-sitter-typescript` 0.23.2 (npm, latest release; WASM at
  `node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm`, loaded by
  `engine.ts` via `resolveWasm`). TSX uses `tree-sitter-tsx.wasm`.
- Language detection: extensions `.ts` / `.mts` / `.cts` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealTypeScriptAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration`/`interface_declaration`/`enum_declaration`/`function_declaration` → `name` identifier; `type_alias_declaration` → `type_identifier`; `method_definition`/`property_signature` → `property_identifier`; `public_field_definition` → `property_identifier`; accessor (`get x`/`set x`) → `method_definition` with `get`/`set` token → normalized to `property`; `namespace`/`module` → identifier; `internal_module` → identifier; `generator_function_declaration` → `function` name; `new_expression` in constructor → `constructor` |
| kind | ✅ | class → Class; interface → Interface; enum → Enum (members → EnumMember); type alias → Type; function → Function; method → Method; accessor → Property (family contract, mirrors C# `property`); field → Property; namespace/module → Namespace; `const`/`let`/`var` at module scope → Constant/Variable; `new X()` constructor → Constructor; generator → Function |
| qualified/container name | ✅ | `id` = namespace chain + name (`Example.Domain.Customer`); `scope` = `buildQualifiedName("")` with trailing-dot stripped; `ownerName`/`ownerKind` from scope stack |
| range (start/end line + column) | ✅ | `node.startPosition`/`endPosition` (row + column) via `nodeRange` |
| parameters | ✅ | `formal_parameters` → each `required_parameter`/`optional_parameter` → name + type annotation (leading colon stripped) |
| returnType / type | ✅ | `return_type` child (colon stripped); `type_annotation` on fields/params; type alias → `type` child |
| documentation/comments | ✅ | `comment` nodes preceding the declaration (JSDoc `/** ... */` and `//` line comments), comment markers stripped via pure-String helpers; exported declarations (`export class X`) look past the `export` keyword wrapper to the preceding JSDoc (fixed in post-close review, exercised by `Domain.ts` JSDoc fixtures) |
| complexity metrics | ✅ | `complexity` metadata on methods (branching nodes counted iteratively) |
| syntax errors | ✅ | ERROR/missing nodes are surfaced by the engine pipeline; fixture parse errors reported as `parseErrors` in the differential |
| decorators/attributes | ✅ | `decorator` nodes → `@Name` and `@Name(args)` parsed via AST (call_expression children); stored in `decorators` metadata only — decorator relationships are NOT emitted (family contract: C#, Java, F# treat decorators as metadata) |

## Relationship ontology

Per-type verdicts for the ten types, the six questions per emitted type, and the
DERIVATION status of this lane are in
[`typescript-ambiguity-sweep.md`](typescript-ambiguity-sweep.md), with the
instruments under `validation/m14/instruments/typescript/`. Summary of what that
sweep measured, so this file is not the only place a reader looks:

- **Ten of ten EMITTED**, none RULED, none GAP — per-type counts and file counts
  over two derived populations (vuejs 400 files, element-plus 400 files).
- **`firing-check-v2` = 8/10** at NFILES 200 and 400 on element-plus; **7/10** at
  NFILES 25. The two silent types (`implements`, `overrides`) are silent because
  that corpus contains 0 of both constructs, which is measured, not assumed.
- **DERIVATION: this lane emits 8 audited types and 2 unaudited** — `exports`
  and `imports`. Measured by evaluating `differential.ts`'s own compared-label
  filter. Both were audited against the differential's own truth builders:
  `exports` 357/357 covered, `imports` 1125/1125 covered, **0 unexplained** each
  on element-plus @200 files. What is still missing is the WIRING: adding both
  labels to the compared-label allowlist in `script/m14/differential.ts` is
  master-owned and is reported as a need, not made here.
- **R7: 0 `unknown` endpoints, 0 empty endpoint names, 0 edges below confidence
  0.7** across both populations.
- **Two open defects, both measured, neither fixed here** — see
  [Known limitations of the edges this analyzer emits](#known-limitations-of-the-edges-this-analyzer-emits).

## Known limitations of the edges this analyzer emits

Two, both with numbers, both deliberately left unfixed because each crosses a
file this lane does not own:

1. **A module-level edge source is a file basename, which is not always an
   identifier.** `imports`, `exports` and `calls` fall back to `moduleLeafName()`
   (`path.basename(filePath, extname)`, `:5764`) when an emission site has no
   enclosing declaration. For `docs/.vitepress/build/crowdin-credentials.ts` that
   is `crowdin-credentials`, and a `-` cannot appear in a TypeScript identifier,
   so no declaration anywhere can carry that name. Measured on element-plus,
   400 files, 22,631 edges: **400 endpoints are not valid identifiers, 321 of
   them sources** (`imports`/source 210, `exports`/source 59, `calls`/source
   52), across 89 distinct values in 69 files. Over the 8 files probed by name,
   0 of 8 basenames is identifier-shaped and 0 of 8 is a published symbol, and
   97 of 288 edges have an unresolvable source.
   The edges themselves are true — that module does import that — so they are
   unattachable rather than fabricated, and the distinction matters for
   `bb_impact`. This is the JS/TS **family contract**, not a slip:
   `real-javascript-analyzer.ts:354` does the identical thing, and the comment
   at `:4491` records the choice as a deliberate earlier fix ("never a `(script)`
   placeholder no consumer can resolve — JS parity: moduleName"). Repairing it
   inside one lane would desynchronise the two analyzers.
2. **`overrides` reports the wrong `evidenceClass`.** It emits
   `usage_contextual` at 0.95 while every other structurally-derived type on this
   lane reports `structural`. Its arms abstain unless the base declaration
   resolves in-file (`if (!baseDecl) continue`, `:5346` and `:5458`), so the edge
   is derived from in-file structural truth and not from a contextual mention.

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `call_expression` → callee LEAF by `calleeLeafName()` (identifier; member → property, private `#` kept; `(foo)()` → `foo`; call-of-call / subscript / `super` / anonymous / `await`-wrapped member → NO edge); source = enclosing function/method leaf; builtins filtered (console.*, Object leaf methods); `super()` filtered (language keyword). **A member call on a LOCAL receiver carries `metadata.owner` = the receiver's class**, read from the two forms this language states it in — `const c = new Widget()` and `const d: Widget = make()` (a name declared with two different types in one file is dropped, not guessed). This is the STORE channel `src/ast/member-owner-resolution.ts` uses to bind the member INSIDE that class instead of by bare name: on a 3-file program where a third file declares its own `run()`, the call bound to the OTHER file's `run` at confidence 0.9 (`verify-patterns` caught the symptom — the dead file could not be reported as orphaned because a fabricated edge referenced it), and the row now binds to the class it was constructed from. MEASURED ON REAL CODE (graphql-js/src, 24,801 `calls` rows, full re-index of a fresh copy both arms): 958 rows carry a receiver type, 493/493 of those whose target resolves inside a class agree with the receiver, and of the 423 rows the name binding had resolved that are now unresolved, 404 had landed in a DIFFERENT class than the receiver, 16 on a free function, 3 in the receiver's own class (the price of not guessing). Pinned by `typescript/receiver-owner-from-new` (owner on the `new` row and on the annotation row, a line-scoped forbid on the type-free receiver) and end-to-end in `script/verify-graph.ts` | 0.9 |
| extends | ✅ | `class_heritage` `extends_clause` → base class name (verbatim: a qualified base stays qualified) | 1.0 |
| implements | ✅ | `implements_clause` → each interface LEAF name (`heritageBaseName` strips `<...>` AND the qualifier) | 1.0 |
| instantiates | ✅ | `new_expression` → constructor leaf name (with `contains: owner → constructor` complement) | 1.0 |
| uses | ✅ | a VALUE/MEMBER READ in expression position (field access, template interpolation, JSX tag) AND a type MENTION (`isTypeReference`, label-per-position). **RULING 2026-10-17 (`8def4a5d5`): the type-mention `uses` row SURVIVES and the duplicate `references` row for the same (source, target) is dropped** — the reverse of the earlier one-label survivor; predicates/constraints and every other type position keep `uses`, the duplicate is what goes | 0.85–0.9 |
| imports | ✅ | `import_statement`/`import` specifiers → source = module leaf name, target = `<module>:<name>` (named + default + namespace imports); side-effect-only and `require` forms publish `<module>:*` | 1.0 |
| imports — type-only marker | ✅ | `metadata.isTypeOnly` — `true` for `import type {…}` (anonymous `type` child of the statement) and for the inline TS 4.5+ form `import { type A, B }` (anonymous `type` child of the `import_specifier`); `false` otherwise. Metadata only: no edge added, removed, or re-pointed | 1.0 |
| exports | ✅ | `export` statements → source = module leaf, target = exported name; `export default` handled | 1.0 |
| overrides | ✅ | method in derived class whose name matches a base-class method (base resolved via extends heritage) → `Derived.method → Base.method` | 1.0 |
| references | ✅ | a TYPE mention that does NOT also have a `uses` row for the same (source, target) → referenced type name, with `metadata.relationshipType` naming the position (`declared_type`, `return_type`, `type_alias`, `cast_target`, `type_argument`, `satisfies_target`). `type_parameter_constraint` / `type_predicate_target` are the two positions that keep BOTH surfaces | 0.95 |
| contains | ✅ | namespace → member; class/interface/enum → member; type alias → member; computed from `ownerName` on symbols (single-pass, no per-symbol scan) | 1.0 |
| depends | — | not emitted (covered by imports) | — |
| field_access | — | folded into `uses`/`references` (family contract) | — |
| JSX element usage | ✅ | `jsx_self_closing_element`/`jsx_opening_element` → `uses` relationship to the component function/class (`metadata.jsxElement`; only capitalized tags) | 0.9 |

## Supported constructs

- Modules/namespaces (`namespace X { }`, `module X { }`) — `Domain.ts`, `Services.ts`
- Classes with fields, accessors (`get current()` → property), methods — `Features.ts`, `Negative.ts`
- Interfaces with method signatures and properties — `Services.ts`, `base.ts`
- Enums with members — `Domain.ts`, `Features.ts`
- Type aliases — `Domain.ts` (`UserId`), `Features.ts` (`User`)
- Generics: type parameters, defaults, `extends` constraints, generic args on classes and calls — `base.ts`, `Features.ts`
- Decorators (`@sealed`, `@Get('/path')`) — parsed AST-only, metadata — `Features.ts`
- Overloads: same-name methods in one class dedup to the first occurrence — `Features.ts`
- Inheritance: `extends` + `implements` — `Features.ts`, `Services.ts`
- Overrides: derived method resolving to base method — `Features.ts` (`UserService.format → BaseService.format`)
- Calls: leaf targets, member expressions, optional chaining (`?.`) — `Features.ts`, `Services.ts`
- Instantiation: `new X()` — `Features.ts` (`createService` → `UserService`, `Map`)
- Imports/exports: named, default, namespace, re-export — all fixtures
- JSDoc/comments: `/** */` and `//` extracted as documentation
- Template strings, destructuring, arrow functions: bodies not promoted to symbols (lambda params never symbols) — `Negative.ts`
- Type queries (`typeof X`), keyof, mapped types, conditional types, utility types — corpus-verified

## Unsupported / explicit-unknown constructs

- `import("mod").Type` **type expressions in return/var annotation positions**
  fail to parse with tree-sitter-typescript 0.23.2 (type-alias position parses
  fine; annotation position yields a small ERROR node). Genuine upstream
  grammar gap, not an analyzer defect. Recoverable: the 4 corpus files using
  this construct still extract full symbols (verified: `sys.ts` 208 symbols,
  `host.ts` 53 symbols). Documented in the corpus section.
- `in out` variance annotations on type parameters (TypeScript 4.7) — ERROR
  node; upstream issue tree-sitter/tree-sitter-typescript#364 (open, in
  progress). One corpus file (`transformers/utilities.ts`).
- Tuple element labels (`[symbol: Symbol, ...]`) — ERROR node; upstream
  grammar gap. Two corpus files (`types.ts`, `exportInfoMap.ts`).
- All are small, localized, recoverable ERROR nodes (7 total across 400
  sample files) — never silently dropped constructs.

## Regex inventory

From `validation/m12/results/regex-census.json`: the TypeScript analyzer has
**0 regex usages** (baseline 36 — the single largest regex user in the
codebase; eliminated by the M12.09 regex-free rewrite, completed for the last
five stragglers on 2026-09-27: three copies of a type-parameter constraint
strip, a rest-parameter `...` strip and an index-signature `:` strip, each
replaced by a `startsWith` + `slice` helper call). The doc previously claimed 0
while the register still listed 5 — the claim is now true rather than
aspirational. All text normalization uses pure-String helpers
(`startsWith`/`endsWith` + `slice`): `stripLeading`, `stripLeadingColon`,
`stripLeadingEquals`, `stripTrailingDot`, `stripTrailingQuestion`,
`stripPrivatePrefix`, `stripPrefix`, `stripLeadingKeyword`, `unquote`,
`stringContent`, `stripCommentMarkers`, `hasBraceEquals`, `stripWhitespace`.
`WHITESPACE_CHARS` spells out the set JS `\s` matches so `stripLeadingKeyword`
stays provably identical to the regex it replaced (an ASCII-only test diverges
on U+00A0), and the three copies of the generic-parameter extractor are now one
module-level `extractTypeParametersOf`.

## Complexity envelope

From `validation/m12/results/typescript-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 67 | 105 | 228.1 | 294 | 460 | 225.0 MB |
| corpus_subset | 399 | 26,513 | 100,594 | 32,206.1 | 823 | 3,123 | 753.1 MB |

Declared budgets: fixtures < 2 s (met: 0.23 s). The 399-file corpus subset is
dominated by the TypeScript compiler's own self-hosting sources (the top
sample files are 200–750 KB — `src/compiler/checker.ts` at 3.1 MB exceeds the
1 MB measurement cap and is excluded by design, matching the F#/Java corpus
methodology).

**The "parse-bound, not analyzer-bound" reading of that row is wrong, and the
M60 gate cannot correct it because it records this analyzer as `unscorable`**
(`validation/m60/results/analyzer-complexity.json`: no `loadRule`, no
`corpusManifest`, so #871 treats the row as not scored). Measured directly on a
real 108 KiB source in this repo (`src/ast/real-javascript-analyzer.ts`,
min-of-N, same process, both analyzer versions loaded side by side):

| | |
| --- | --- |
| `tree-sitter` parse only | 57 ms |
| `analyze()` | 1,863 ms — **97.0% of the cost is the analyzer** |

Scaling is also super-linear: halving the file repeatedly gave 2.00x, then
2.42x, then 2.28x time for each 2x of source. Wall-clock numbers on a shared
box are unstable (the M12 harness header records the same analyzer measuring
25.8 ms/file and 172.6 ms/file minutes apart), so the claims below are stated
as **node visits**, which are deterministic.

Hot-path audit — CORRECTED (2026-09-27). The previous text here claimed "no
O(n²) or per-symbol O(n) scans", "relationship extraction uses name-keyed maps
and the scope stack", and "call source resolution is O(1) leaf extraction".
Measured against the source, all three were false:

- `addContainmentRelationships` is O(n²): one `findItem` linear scan of the
  symbol array per symbol that has an owner.
- `resolveRelationshipSymbol` is a linear `findItem` scan per DECLARATION node
  (not per node), plus an ancestor walk per `method_definition`.
- The name-keyed map it referred to (`symbolsById`) was written on every symbol
  and never read — dead state, now deleted.
- The file walked the tree ~12 times per file (symbol extraction, dup-key
  collapse, imports, exports, three relationship passes, declared-type refs, two
  complexity walks, the file-signals scan, plus one subtree walk per symbol for
  complexity / qualified_calls / taint / comments). A V8 CPU profile attributes
  ~52% of samples to tree-sitter node access and JS↔wasm marshalling against
  ~7% in analyzer code, so walk COUNT is the cost, not the arithmetic.

What the corrected version removed (node visits, 4 real repo files, counted by
instrumenting both versions in one process):

| walk | before | after |
| --- | --- | --- |
| dup-key collapse (was called twice, first result discarded) | 80,514 | 40,257 |
| complexity (per-symbol double walk + a byte-identical second implementation) | 138,442 | 69,860 |
| calls + instantiations (two passes, now one) | 83,154 | 41,577 |

Still true after the correction, and worth keeping: the relationship SET is
unchanged by the fusion (verified per-file as a multiset over 2,457 files:
2,454 identical, the 3 differences being the intended override/export fixes,
1,255 of them order-only).

Since that correction the two quadratic scans are GONE, both replaced by a
name -> first-declared-symbol index built in one pass (first-wins preserved, so
repeated names resolve exactly as the array scan did), and both verified
behaviour-identical over the same 2,457 files:

| scan | before | after | removed |
| --- | --- | --- | --- |
| containment, per owned member | 360,230 comparisons | 24,025 | 93.3% (worst file: 108,755) |
| enclosing-symbol resolver, per declaration node | 41,966 | 9,032 | 78.5% |

The remaining honest cost is the WALK COUNT itself: the usage pass is still
separate because it carries per-function `locals`, and the per-file signal scan
(one walk, shared by the React gate and the taint sink rule) still runs on every
file. Neither is measured by a gate, because M60 still records this analyzer as
`unscorable`.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/typescript.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the C#/Java/F# family contract; 171 facts)
- Result: `validation/m12/results/typescript-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `typescript@b465fdbf`
  (microsoft/TypeScript, clean, 20,798 tracked `.ts` files)
- Sample: 400 tracked `*.ts` files (deterministic first-400 sorted, excluding
  `*.d.ts` and `tests/cases`; 399 measured — `src/compiler/checker.ts` at
  3.1 MB exceeds the 1 MB measurement cap)
- Symbols 26,513 / relationships 100,594 / wall 32.2 s / 0 crashes / 0 timeouts
- Parse quality (fresh parser per file, mirrors production pipeline): 5/400
  files with error nodes (1.3%, 7 ERROR nodes) — all genuine upstream
  tree-sitter-typescript 0.23.2 grammar gaps:
  1. `import("...").Type` type expressions in return/var annotation positions
     (4 nodes: `sys.ts` ×2, `testRunner/parallel/host.ts` ×2)
  2. `in out` variance annotations (1 node: `transformers/utilities.ts`;
     upstream issue #364 open)
  3. Tuple element labels (2 nodes: `compiler/types.ts`,
     `services/exportInfoMap.ts`)
  All 5 files still extract complete symbol sets (recoverable — e.g.
  `types.ts` 5,269 symbols, `sys.ts` 208 symbols), so the errors are small
  and localized, matching the F# precedent (documented honest counts).

## Evidence pointers

- Fixtures: `validation/m12/fixtures/typescript/`
- Ground truth: `validation/m12/ground-truth/typescript.json`
- Differential: `validation/m12/results/typescript-differential.json`
- Complexity: `validation/m12/results/typescript-complexity.json`
- Corpus sample: `validation/m12/results/typescript-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.09 (GitHub issue #148).

---

## 2026-10-17 — marking, callee shape, heritage leaf, constraint refs, and the React/TSX boundary

Measured on the 400-file stride (`bun run script/m14/incoming-gate.ts typescript ts 400`,
population 400 of 13,830 `.ts` files across 39 repos, 0 parse failures). Full evidence, per-revision
mtime and artifact list: `validation/m14/verification/TYPESCRIPT-STATE.md`.

### External marking now has a THIRD proof: the file's own import specifier

`markExternalTargets` already claimed a name was outside the corpus when the file neither declares
nor imports it and the name is in a pinned table (runtime globals, test-runner globals, lib types).
It now ALSO claims a name the file DOES bind when the binding's own `imports` edge names a pinned
test-framework package (`TS_TEST_FRAMEWORK_MODULES`: `@jest/globals`, `@jest/expect`, `jest`,
`vitest`, `@vitest/*`, `mocha`, `chai`, `ava`, `tap`, `uvu`, `jasmine`, `sinon`, `expect`,
`node:test`, `bun:test`, `cypress`, `@playwright/test`, `playwright`, `@testing-library/jest-dom`,
`supertest`; matched by WHOLE SEGMENT). The file's own import is the evidence, and a name the file
DECLARES is never marked; the incoming gate still refutes any claim the project publishes
(`extFAIL` 0). Measured: **+764 verified external claims, −795 unresolved**, every other column flat.

Directly-imported matchers work too: `expect(x).toEqual(y)` marks `toEqual` with
`externalReceiver: "expect"`. A matcher reached through a LONGER chain (`expect(x).to.equal(y)`)
does not mark yet — the receiver-head proof only handles a receiver that is itself a call.

### `calls` targets are callee LEAVES by an allowlist, not callee TEXT

`calleeLeafName()` reduces `(foo)()` → `foo`, an identifier to itself, and a member expression to
its property (private members keep `#`: `this.#step()` → `#step`). Every other callee shape
publishes NO edge: a call of a call (`f()(x)` — the inner call publishes its own), a subscript,
`super`, an anonymous function, and `await`/`!`/`as` wrappers around a member. The wrapper rule is
deliberately narrow and was MEASURED: reducing `await this.request<X>({...})` through `await` emits
the leaf `request`, which a project can (and one does) declare as an unrelated constant in another
file — 17 such edges moved into the gate's file-crossing class and the wide version was reverted.
Measured net effect: all 51 non-identifier `calls` targets are gone; resolved, collRes, ambiguous
and the file-crossing class are unchanged. `metadata.calleeShape` names the wrapper when one was
reduced through.

### Heritage leaf and type-parameter constraint references

* `implements Ns.Shape<number>` → `implements Shape` (leaf). A namespace-imported base's stored
  `qualified_name` is `<module>.<Type>`, never `<alias>.<Type>`, so the dotted spelling could not
  join; the leaf can. CLASS `extends` still publishes its base verbatim (no fixture pins it).
* `<T extends C>` publishes `references owner -> C` with
  `metadata.relationshipType: "type_parameter_constraint"`. The type parameter's OWN name is not a
  child of `constraint`, so it is never leaked as a type reference.
* `x is Foo` / `asserts x is Foo` publishes `references owner -> Foo` with
  `metadata.relationshipType: "type_predicate_target"` AND keeps the `uses` row for the same
  (source, target) — the predicate/constraint positions keep BOTH surfaces.
* **RULING (2026-10-17, commit `8def4a5d5`, Lead-authorised pin-change set):** the DERIV_TS
  one-label ruling was REVERSED. For every OTHER type position the `uses` row now survives and the
  duplicate `references` row is dropped. Four fixture pins moved with the ruling
  (`usage-references`, `parameter-shadows-file-symbol`, `type-alias-mentions-own-alias`,
  `unnamed-signature-members`). Measured effect on the 400-file gate: totals UNCHANGED
  (23,558 / 6,965 / 1,364 / 10,126 / 5,103) while `references` 3,346 → 2,888 and `uses`
  944 → 1,402 — a relabel of 458 edges, not a resolution change.
  See `validation/m14/verification/TYPESCRIPT-STATE.md` “RULING UPDATE (14:00)”.

### Fixtures: 99 pass / 3 fail (from 96/6 at the start of the iteration)

Fixed this iteration: `calls-callee-shape-reduction` (narrow reducer),
`heritage-parameterized-leaves` (leaf + constraint refs),
`type-predicate-and-constraint-refs` (the ruling keeps both surfaces for predicates/constraints).
The four re-pinned type-mention fixtures pass against the ruling. Remaining:
`re-export-empty-clause`, `re-export-module-dependency` (the re-export emitter is not written), and
`type-reference-uses-surfaces` (requires `uses` rows for declaration-owned type mentions — interface
property type, type-alias RHS, module-level variable annotation — with `meta.declaredTypeRole`; the
usage pass does not emit uses for those owners).

### The React / TSX boundary, measured

`.tsx` routes to language id `tsx`, uses `tree-sitter-tsx.wasm`, and runs THIS analyzer — but the
headline gate invocation is `typescript ts`, so `.tsx` is excluded from every number above.
Measured on the corpus: **3,377 tracked `.tsx` files** (= the gate's own `git ls-files` population;
the often-quoted 2,932 excludes the `repositories/proxicall -> ~/ProxiCall` symlink, 445 files),
17 repos, **none named `react`**. Textual: JSX 3,165 (93.7%), `react`/`react-dom` import 1,811
(53.6%), `className=` 1,804, `props`/`Props` 1,580, hook calls 618 (`useState` 303, `useEffect` 333).
Analyzer on a 374-file tsx stride: 374/374 parsed, **1,782 `uses` edges carrying `jsxElement` over
284 files, 613 distinct component targets, 508 hook calls over 130 files**. A separate `tsx` gate run
reads 17,083 edges with 0 extFAIL. The corpus is real React but 84% concentrated in 4 repos; the
proposal `validation/m14/proposals/typescript-react-corpus-widening.md` asks that the lane's gate
invocation become `typescript ts,tsx 400` so React is inside the measured population at all.

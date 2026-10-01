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

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `call_expression` → callee leaf name (member expressions reduce to leaf: `obj.method()` → `method`); source = enclosing function/method leaf name; builtins filtered (console.*, Object leaf methods); `super()` filtered (language keyword); `this.x()` → leaf `x` | 1.0 |
| extends | ✅ | `class_heritage` `extends_clause` → base class leaf name | 1.0 |
| implements | ✅ | `implements_clause` → each interface leaf name | 1.0 |
| instantiates | ✅ | `new_expression` → constructor leaf name (with `contains: owner → constructor` complement) | 1.0 |
| uses | ✅ | type-reference usage inside type positions → referenced type leaf | 1.0 |
| imports | ✅ | `import_statement`/`import` specifiers → source = module leaf name, target = imported symbol name (named + default + namespace imports) | 1.0 |
| exports | ✅ | `export` statements → source = module leaf, target = exported name; `export default` handled | 1.0 |
| overrides | ✅ | method in derived class whose name matches a base-class method (base resolved via extends heritage) → `Derived.method → Base.method` | 1.0 |
| references | ✅ | `identifier` usage resolution within the file → referenced symbol leaf | 1.0 |
| contains | ✅ | namespace → member; class/interface/enum → member; type alias → member; computed from `ownerName` on symbols (single-pass, no per-symbol scan) | 1.0 |
| depends | — | not emitted (covered by imports) | — |
| field_access | — | folded into `uses`/`references` (family contract) | — |
| JSX element usage | ✅ | `jsx_self_closing_element`/`jsx_opening_element` → `uses` relationship to the component function/class | 1.0 |

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

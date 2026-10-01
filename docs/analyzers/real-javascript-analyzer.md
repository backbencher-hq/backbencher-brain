# real-javascript-analyzer.md

## Language

- Analyzer file: `src/ast/real-javascript-analyzer.ts`
- Parser: `tree-sitter-javascript` 0.23.1 (npm, latest release; WASM at
  `node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm`, loaded by
  `engine.ts` via `resolveWasm`)
- Language detection: extensions `.js` / `.mjs` / `.cjs` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealJavaScriptAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration` → `name` identifier; `function_declaration`/`generator_function_declaration` → `name` identifier; `method_definition` → `name` property_identifier (constructor → `constructor`); `field_definition` → `property` (private `#x` → `x`); module-scope `variable_declarator` → `name` identifier (function-valued → Function, const → Constant, let/var → Variable) |
| kind | ✅ | class → Class; function/generator/async → Function; method → Method; accessor (`get`/`set` token child) → Property; field → Property; `new`-only constructors → Constructor; prototype method (`X.prototype.m = fn`) → Method; module-scope const → Constant, let/var → Variable |
| qualified/container name | ✅ | `scope` = enclosing chain (module → class → function) joined; `ownerName`/`ownerKind` from nearest class scope |
| range (start/end line + column) | ✅ | `node.startPosition`/`endPosition` via `nodeToRange` |
| parameters | ✅ | `formal_parameters` → identifier / `assignment_pattern` left / destructured patterns (recorded but never symbols) / `rest_pattern` inner identifier |
| returnType / type | — | JavaScript has no type annotations; JSDoc `@returns` is not parsed (documented unsupported) |
| documentation/comments | ✅ | preceding `comment` nodes (JSDoc `/** ... */` and `//`), comment markers stripped via pure-String helpers; exported declarations (`export class X`) look past the `export` keyword wrapper to the preceding comment (fixed in post-close review, exercised by `Domain.js` file-header comments) |
| complexity metrics | ✅ | `complexity` on methods/functions (branching nodes counted iteratively) |
| syntax errors | ✅ | ERROR/missing nodes surfaced by the engine pipeline; reported as `parseErrors` in the differential |
| decorators/attributes | — | JavaScript has no decorators in the grammar (TC39 stage 3); not applicable |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `call_expression` → callee leaf (member expressions reduce to leaf: `obj.method()` → `method`); source = enclosing function/method leaf name; builtins filtered (console.*, Object leaf methods); `super()` filtered (language keyword); `require()` handled as import; computed/dynamic calls (`o[key]()`) filtered | 0.9 |
| extends | ✅ | `class_heritage` → base class leaf name | 1.0 |
| instantiates | ✅ | `new_expression` → constructor leaf name | 0.95 |
| imports | ✅ | ESM `import_statement` → module leaf → `${modulePath}:${item}` per item (named/default/namespace); CJS `require()` → module leaf → `${modulePath}:*` | 1.0 |
| exports | ✅ | ESM `export` statements (declaration, export_clause, default); CJS `module.exports = { ... }` (object keys), `exports.x = ...` → module leaf → exported name | 1.0 |
| overrides | ✅ | derived method matching base-class method name; base resolved via extends + cross-file harness companion (`User.format → BaseService.format`) | 0.95 |
| contains | ✅ | computed from `ownerName` on symbols (single pass) — class members, prototype methods | 1.0 |
| uses | — | not emitted for `this.x` property access (family contract: no field-access uses, verified against C#/Java ground truth) | — |
| references | — | covered by imports/exports/calls leaf identities | — |
| depends | — | not emitted (covered by imports) | — |

## Supported constructs

- ESM modules: `import`/`export` (named, default, namespace, re-export) — `Domain.js`, `Features.js`
- CommonJS: `require()`, `module.exports = { ... }`, `exports.x = fn` — `Services.js`
- Classes: fields (public + private `#x`), accessors (`get current()`/`set current()` → property), static, async methods, generator methods, constructor — `Features.js`
- Functions: declarations, generators, async, arrows — all fixtures
- Module-scope constants/variables — `Domain.js` (`Status`), `Features.js` (`localConstant`)
- Inheritance: `extends` + cross-file override resolution — `Features.js` (`User.format → BaseService.format`)
- Prototype inheritance: `X.prototype.method = function () {}` → Method with owner + contains — `Services.js`
- Calls: leaf targets, member expressions, optional chaining (`this.repo?.get()`), `super.format()` — all fixtures
- Instantiation: `new User(name)` — `Features.js`
- Negative fixtures: locals, params, lambda params, destructured params never become symbols; template-string call targets filtered; console/Object builtins filtered; `require` bindings are imports not symbols — `Negative.js`

## Unsupported / explicit-unknown constructs

- JSDoc type annotations (`@param`, `@returns`, `@type`) are not parsed into
  returnType/type fields — JavaScript has no runtime types, and the family
  contract keeps type info absent rather than synthetic. JSDoc *comments* are
  still extracted as documentation.
- Decorators (TC39 stage 3) — not present in the tree-sitter-javascript
  grammar; not applicable to the JS contract.
- Computed/dynamic member calls (`o[key]()`) are deliberately filtered — the
  target is not a statically resolvable name (family contract, mirrors TS).
- `this.x` property access produces no `uses` relationship (family contract).

## Regex inventory

From `validation/m12/results/regex-census.json`: the JavaScript analyzer has
**0 regex usages** (baseline 2 — both `quote-strip` normalizations on
require/import paths, replaced by the pure-String `stringContent`/`unquote`
helpers). All text normalization uses `startsWith`/`endsWith` + `slice`.

## Complexity envelope

From `validation/m12/results/javascript-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 44 | 67 | 620.8 | 71 | 108 | 201.5 MB |
| corpus_subset | 400 | 2,935 | 17,483 | 14,577.4 | 201 | 1,199 | 391.6 MB |

Declared budgets: fixtures < 2 s (met: 0.62 s); 400-file corpus < 60 s
(met: 14.6 s).

Hot-path audit: single iterative AST traversal (explicit stack, no recursion
depth risk); scope carried per-frame as immutable snapshots (no shared mutable
stack — children are processed later from the DFS stack, so scope state
travels with each frame); per-name/owner dedup via `Set` keys; containment
from `ownerName` in one pass; call source resolution O(1) leaf extraction;
override resolution via name-keyed `Map` + companion set. No O(n²) or
per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/javascript.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the C#/Java/F#/TS family contract; 112 facts)
- Result: `validation/m12/results/javascript-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `svelte@26786e92`
  (clean, 8,981 tracked files; 3,383 tracked `.js`/`.mjs`/`.cjs` — real
  package sources in `packages/`, `benchmarking/`, `playgrounds/`)
- Sample: 400 tracked JS-family files (deterministic first-400 sorted,
  excluding `tests/`)
- Symbols 2,935 / relationships 17,483 / wall 14.6 s / **0 crashes /
  0 timeouts / 0 error files** — clean corpus validation (fresh parser per
  file, mirrors production pipeline; scan script `script/m12/js-corpus-errors.ts`)

## Evidence pointers

- Fixtures: `validation/m12/fixtures/javascript/`
- Ground truth: `validation/m12/ground-truth/javascript.json`
- Differential: `validation/m12/results/javascript-differential.json`
- Complexity: `validation/m12/results/javascript-complexity.json`
- Corpus sample: `validation/m12/results/javascript-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.10 (GitHub issue #149).

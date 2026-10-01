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
| calls | ✅ | `call_expression` → callee leaf (member expressions reduce to leaf: `obj.method()` → `method`); source = enclosing function/method leaf name; `console.*` leaf methods filtered; `super()` filtered (language keyword); `require()` handled as import; computed/dynamic calls (`o[key]()`) filtered | 0.9 |
| extends | ✅ | `class_heritage` → base class leaf name | 1.0 |
| instantiates | ✅ | `new_expression` → constructor leaf name | 0.95 |
| imports | ✅ | ESM `import_statement` → module leaf → `${modulePath}:${item}` per item (named/default/namespace); CJS `require()` → module leaf → `${modulePath}:*` | 1.0 |
| exports | ✅ | ESM `export` statements (declaration, export_clause, default); CJS `module.exports = { ... }` (object keys), `exports.x = ...` → module leaf → exported name | 1.0 |
| overrides | ✅ | derived member matching base-class member name, over METHODS, CONSTRUCTORS and ACCESSOR PAIRS; an accessor pair is a prototype member, so `get x()`/`set x(v)` shadow a base accessor too, and the pair collapses to ONE edge (J10). Symbol kinds are unchanged by that widening — accessors are still kinded `property`. A `#private` name can neither be declared by a base nor shadowed by a subclass, so it is always silent (J9). Base resolved via extends + cross-file harness companion (`User.format → BaseService
| contains | ✅ | computed from `ownerName` on symbols (single pass) — class members, prototype methods | 1.0 |
| uses | ✅ | **This row was wrong until 2026-09-27 and said "not emitted" while the lane emitted 5,837 per 40-file corpus.** Four emission sites: bare identifier reads at 0.9 (`return config`, `if (flag)`); member-chain segments at 0.85 (`title.length` → `title`); template-substitution reads at 0.85; and the chain ROOT of a call's callee at 0.6 with `metadata.callReceiver` (`title.toUpperCase()` → `title`). The 0.6 tier exists because `calls` names only the leaf, so the receiver is named by nothing else — see X1 in `script/m14/spec/svelte-completeness.json`. `this`/`super` are excluded as keywords, so `this.x.push(y)` correctly publishes no `uses this`. | 0.6 / 0.85 / 0.9 |
| references | ✅ | Also wrong until 2026-09-27. Carries both ways JavaScript names a type it does not own: decorator metadata (1.0) and `instanceof` (0.95). The oracle derives these in `deriveJavaScriptEdges` in a pre-pass OUTSIDE the decorator-skipping walk, so it audits those nodes rather than stepping around them; before that, neither was reachable from the differential at all. | 0.95 / 1.0 |
| depends | — | not emitted (covered by imports) | — |

### Ontology audit (2026-09-27)

The analyzer emits **9** relationship types. Measured against the differential's
own comparison allowlist, **8 are compared and 1 is not**:

| Type | Compared by F5? | Note |
| --- | --- | --- |
| calls, uses, contains, exports, references, instantiates, extends, overrides | ✅ | compared; truth and analyzer agreed exactly per label on a 40-file-per-corpus run |
| `brain_import` | ❌ | the JS oracle derives no import truth, so by the harness's own rule ("a label is comparable exactly when the lane's oracle derives it") the label is out of scope — but the consequence is that **every JavaScript import edge is unverified by the differential** and rests on fixtures and the PIPE seam alone |

`implements` is in the compared set and is never emitted by this analyzer, which
is correct: JavaScript has no `implements` clause.

**A CORRECTION TO THE PREVIOUS REVISION OF THIS SECTION, which was wrong.** It
claimed that `imports` in the enum carries the wire value `brain_import`, that the
differential's allowlist therefore spells the label differently, and that an
`imports` allowlist entry consequently matches no analyzer edge on any lane. All
three claims were false, and the "cross-lane defect" was invented. There are two
enums: `src/ast/types.ts` declares `Imports = "brain_import"`, and that string is
the **SQLite table name** for persisted import rows; `src/ast/engine.ts` declares
`Imports = "imports"`, and that is the **relationship wire value** the analyzer
actually emits. Measured: `import { a as b } from "./m.js"` yields
`imports->./m.js:b`. The allowlist spells it `imports`, which is correct, and
every `imports` allowlist entry in the file matches. The error came from reading
one enum and assuming it was the only one.

**Two documentation defects this census found, both now corrected above.** (1) The
`calls` row claimed "builtins filtered (console.*, **Object leaf methods**)". Only
the first half is true: `console.log(x)` publishes `uses console` and no
`calls log`, while `Object.keys({})` publishes `calls keys` **and** `uses Object`,
and `Math.floor(1.5)` publishes `calls floor` and `uses Math`. Measured across 27
global-base leaves by `census-js-doc-builtin-claim`; all 27 are named. The
suppression is real and confined to `console`. (2) The symbol table claims a
private field `#x` collapses to `x`. It does not: `legacy-client.js` publishes the
symbol `#events` and the containment edge `Svelte4Component->#events`, `#` and
all. This one had teeth — a census that stripped the `#` while matching
containment targets reported 92 of 96 class members as unplaced, a wholly
invented defect.

**Containment, measured on the population the contract covers.** The
`contains` row says "class members, prototype methods", so that is the population
measured: of 103 class-member and object-literal-method symbols in the sample,
class members are **0/11 unplaced** and object-literal methods are **92/92
unplaced**.

**The 92/92 is not a defect, and the distinction is the whole content of this
paragraph.** An object literal is owned by the binding it initialises; one that is
an `export default`, a return value, a call argument or an array element has no
binding to name and is correctly ownerless. Measured over a 120-file and then a
600-file sample: object-literal members that HAVE a reachable binding and were not
placed = **0**. All 92 have no binding at all.

**JD3 (`reviews/javascript/m60-deep-review-2026-09-26.md:209`, "10.9% of real
symbols are ownerless") is therefore HISTORICAL, not open.** It named a mechanism —
`ownerName` came only from `scopeOwnerName`, which reported class scopes only, with
only `class_declaration` pushing one — and that mechanism has been superseded by
`containerOwnerName`, which resolves a class expression and an object literal by
their binding as well as a class declaration by its name. Two earlier revisions of
this paragraph called it "falsified" and then "an object-literal finding"; both
were wrong, and the second was worse than the first because it credited the census
with disproving a claim it never re-tested. A finding whose mechanism has been
replaced is fixed, not falsified.

**Regex, re-measured independently.** Stripping comments and string literals and
then scanning finds **0 regex literals and 0 `RegExp`** in
`real-javascript-analyzer.ts` and the same in `real-typescript-analyzer.ts`. The
only string methods used are `split`/`replace` on literal separators (3 in
JavaScript, 10 in TypeScript). The zero is now measured rather than inherited
from `regex-census.json`, and the absence of this lane from
`validation/m49/regex-debt-register.json` is consistent with it rather than the
evidence for it.

**Symbol kinds.** The analyzer emits 7: `Class`, `Function`, `Method`,
`Constructor`, `Property`, `Constant`, `Variable`. It emits **no `Module` symbol
for the file itself** and **no `Object` symbol for object literals** — the latter
is the known JD3 containment gap (10.9% of real symbols carry no containment
edge, because `ownerName` is set only for class scopes, orphaning every
object-literal method and class-expression member).

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

# real-dart-analyzer.md

## Language

- Analyzer file: `src/ast/real-dart-analyzer.ts`
- Parser: `tree-sitter-dart` **rebuilt from upstream master**
  (`UserNobody14/tree-sitter-dart` `be07cf7`, 2026-07-06; WASM at
  `wasm/tree-sitter-dart.wasm`, loaded by `engine.ts` via `resolveWasm`).
  The previously pinned grammar predated Dart 3 class modifiers
  (`abstract final class`, `sealed`, `base`, `interface class`) and errored on
  **302/400 (75.5%)** of the flutter corpus sample; the upgraded grammar
  parses **0/400** files with zero ERROR nodes (0 crashes, 0 timeouts).
- Language detection: extension `.dart` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealDartAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_definition`/`enum_declaration`/`extension_declaration` → `name` field; `mixin_declaration` → direct `identifier` child (no name field in the grammar); `type_alias` → first `type_identifier`; `function_signature`/`getter_signature`/`setter_signature` → `name` field (digging through `method_signature` wrappers); `initialized_identifier`/`static_final_declaration` → `identifier`; constructors → `constructor` (named segment in metadata) |
| kind | ✅ | class → Class; mixin → Mixin; extension → Extension (unnamed `extension on T` named after the target type); enum → Enum + `enum_constant` → EnumMember; typedef → TypeAlias; method → Method; getter/setter → Property; field → Property (in class scope) / Constant or Variable (top level: const/final → Constant); top-level function → Function; constructor → Constructor |
| qualified/container name | ✅ | `scope` = enclosing chain joined; `ownerName`/`ownerKind` from nearest class-like scope (class/mixin/extension/enum) |
| range (start/end line + column) | ✅ | `node.startPosition`/`endPosition` via `nodeToRange`; methods extend to the sibling `function_body` |
| parameters | ✅ | `formal_parameter_list` → `formal_parameter`/`optional_formal_parameter`/`named_formal_parameter`/`default_formal_parameter`/`constructor_param` (`this.x` → `x`) — recorded, never symbols |
| returnType | ✅ | `return_type` field / `void_type` / first `type_identifier` before the name field (`Future<void>` → `Future`) |
| documentation/comments | ✅ | preceding `documentation_comment`/`comment` nodes, skipping `annotation`/`marker_annotation` siblings between the doc comment and the declaration; markers stripped via pure-String helpers |
| complexity metrics | ✅ | `complexity` on methods/functions (branching nodes counted iteratively) |
| syntax errors | ✅ | ERROR/missing nodes surfaced by the engine pipeline; reported as `parseErrors` in the differential |
| decorators/attributes | ✅ | `annotation`/`marker_annotation` siblings → `decorators` metadata |
| generics | ✅ | `type_parameters` on classes → `genericParameters` metadata; `List<int>`, `Map<String, int>.from` parsed via `type_arguments`/`constructor_invocation` |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `selector` + `argument_part` → leaf callee (selector chains reduce to the last identifier: `obj.method()` → `method`; `Future.delayed(...)` → `delayed`); source = enclosing function/method/constructor leaf name (derived from the signature that precedes the `function_body` sibling); cascade calls (`..increment()`) → cascade selector leaf; global builtins filtered (`print`, `assert`, `identical`); Object-leaf methods filtered (`toString`, `hashCode`, `runtimeType`, `noSuchMethod`) | 0.9 |
| extends | ✅ | `superclass` → first `type_identifier` | 1.0 |
| implements | ✅ | `interfaces` → each `type_identifier` | 1.0 |
| uses (mixin) | ✅ | `mixins` child of `superclass` or the class (`with` clause) → each `type_identifier` | 1.0 |
| instantiates | ✅ | capitalized identifier + `argument_part` selector (Dart has no `new`: `Counter(1)` → instantiates Counter — types are capitalized); `constructor_invocation` (`List<int>.filled(...)`) → the constructed `type_identifier`; redirecting factory (`factory X.y() = X.z;`) → the redirect target type | 0.95 |
| imports | ✅ | `import_specification` / `part_directive` → module leaf → `${uri}:*` | 1.0 |
| exports | ✅ | `library_export` → module leaf → exported uri | 1.0 |
| overrides | ✅ | derived method matching base-class method name; base resolved via extends + cross-file harness companion (`Counter.format → BaseService.format`) | 0.95 |
| contains | ✅ | computed from `ownerName` on symbols (single pass) — class/mixin/extension/enum members | 1.0 |
| uses (field access) | — | not emitted for `this.x`/`obj.x` field access (family contract: no field-access uses, verified against C#/Java ground truth) | — |
| references | — | covered by imports/calls leaf identities | — |

## Supported constructs

- Libraries: `library` directive (no symbol — file-level declaration, metadata only) — all fixtures
- Imports/exports/parts: `import 'package:...'`, `import ... as ... show ...`, `export '...'`, `part '...'` — `Features.dart`, `Services.dart`
- Classes: fields (`final`/`static const`/`late`), constructors (positional + named + const), getters/setters → property, static methods, abstract methods — all fixtures
- Factory constructors: `factory User.anonymous() => User(...)` (expression body) — `Domain.dart`
- Mixins: `mixin` declaration + `with` clause (`Counter extends BaseService with Loggable`) → uses + member symbols — `base.dart`, `Features.dart`
- Extensions: named (`extension StringUtils on String`) and unnamed (`extension on T` named after the target type) — `Features.dart`
- Enums + enum members — `Features.dart` (`Status` → `active`/`inactive`/`pending`)
- Generics: `class Box<T>`, `List<int>` parameters — `Features.dart`, `Services.dart`
- Async: `async` methods, `await`, `Future<T>` return types — `Features.dart`, `Services.dart`
- Calls: leaf targets, selector chains, cascades (`..increment()`) — `Services.dart`
- Field access: `counter.value`, `this.value` — exercised with NO phantom `uses` rels — `Services.dart`, `Negative.dart`
- Overrides: `@override` + cross-file base (`Counter.format → BaseService.format`) — `Features.dart`
- Negative fixtures: locals, params, closures (`(int a) => a + 1`), enum access, `print`/`assert`, Object-leaf methods, `library` directive never become symbols/rels — `Negative.dart`

## Unsupported / explicit-unknown constructs

- `Box<String>('hello')` (generic constructor with type arguments in call
  position) misparses as `relational_expression` in tree-sitter-dart — an
  upstream grammar ambiguity; no instantiates edge is emitted for it
  (documented, not worked around with source-text scanning). `Map<String,
  int>.from(...)` parses correctly as `constructor_invocation`.
- Dart 3 records/patterns (`(a, b)`, `switch` patterns) are supported by the
  upgraded grammar (0 corpus errors) but not yet extracted as distinct
  symbol kinds — the family contract keeps them unsupported rather than
  synthetic.
- `this.x`/`obj.x` property access produces no `uses` relationship (family
  contract).
- Constructors all carry the family name `constructor` (named segment in
  metadata); the family contract does not use `Class.named` as the symbol
  name.

## Regex inventory

From `validation/m12/results/regex-census.json`: the Dart analyzer has
**0 regex usages** (baseline 8: 5 quote-strip/callee-sanitization
normalizations + 3 widget-detection `isWidgetTree`/uppercase heuristics).
The old widget-detection heuristic (`/Widget$|Element$|.../`) is dropped
entirely — widget-classification produced noise, not contract facts. All
text normalization now uses pure-String helpers (`unquote`,
`stripCommentMarkers`, `isCapitalized`, `stripNonIdentifier`).

## Complexity envelope

From `validation/m12/results/dart-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 48 | 72 | 1,144.3 | 42 | 63 | 198.6 MB |
| corpus_subset | 399 | 23,952 | 88,098 | 281,912.3 | 85 | 313 | 619.5 MB |

Declared budgets: fixtures < 2 s (met: 1.14 s); 400-file corpus < 600 s
(met: 281.9 s — flutter framework files are large; 20 files > 100 KB and one
1.8 MB generated `icons.dart` in the sample).

Hot-path audit: single iterative AST traversal (explicit stack, no recursion
depth risk); scope carried per-frame as immutable snapshots (no shared
mutable stack — children are processed later from the DFS stack, so scope
state travels with each frame); per-member dedup via `Set` keys; containment
from `ownerName` in one pass; call source resolution O(1) leaf extraction
from the signature preceding the `function_body` sibling; override
resolution via name-keyed `Map` + companion set; `findSignatureIn` bounded
by a depth guard. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/dart.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the C#/F#/TS/JS family contract; 119 facts)
- Result: `validation/m12/results/dart-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `flutter@68dc5cf`
  (pinned revision; 1,729 tracked `.dart` files under `packages/flutter` —
  real framework source)
- Sample: 400 tracked Dart files (deterministic first-400 sorted,
  `validation/m12/results/dart-corpus-sample.txt`)
- Symbols 23,952 / relationships 88,098 / wall 281.9 s / **0 crashes /
  0 timeouts / 0 error files** — clean corpus validation (fresh parser per
  file, mirrors production pipeline; scan script
  `script/m12/dart-corpus-errors.ts`)
- Grammar note: the corpus scan is what exposed the pre-Dart-3 grammar gap
  (75.5% error rate); the upgraded grammar was built from upstream master
  and the fixtures were re-verified against it before commit.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/dart/`
- Ground truth: `validation/m12/ground-truth/dart.json`
- Differential: `validation/m12/results/dart-differential.json`
- Complexity: `validation/m12/results/dart-complexity.json`
- Corpus sample: `validation/m12/results/dart-corpus-sample.txt`
- Grammar wasm: `wasm/tree-sitter-dart.wasm` (rebuilt from
  `UserNobody14/tree-sitter-dart` `be07cf7`)
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.11 (GitHub issue #150).

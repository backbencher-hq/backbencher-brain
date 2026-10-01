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
| uses | ✅ | **Four distinct surfaces, not one.** (1) MIXIN — `mixins` child → each `type_identifier`, 1.0. (2) FIELD / MEMBER READ — a `selector` WITHOUT its own `argument_part` (`obj.method` tear-off, `this.count`, `C.total`, `a?.value`), 0.9; a CALLED member is a `calls` edge, not a field read. A `qualified` name under a `constant_pattern` (`case WalletOperationType.recipientLookup:`) is the SAME read parsed the other way round and is read too, 0.9, `isConstantPattern` — the string `qualified` was absent from this analyzer until that fix, so a switch case naming a declared enum member published nothing at all. (3) BARE IDENTIFIER — a plain `return count;` on a declared member of the enclosing type, gated on resolution AND on the name not being locally bound, 0.6, `isBareRead`. (4) TEMPLATE INTERPOLATION — each identifier in `${…}`, 0.9, `isLocalRead`; a name bound by a local DECLARATOR suppresses it, a PARAMETER does not (the TypeScript `interp-uses` parity, `989ba4c7`) | 0.6–1.0 by surface |
| contains | ✅ | computed from `ownerName` on symbols (single pass) — class/mixin/extension/enum members | 1.0 |
| references | — | **not emitted at all.** Dart's `uses` surfaces above carry every mention; there is no `references` relationship in the Dart ontology and the live census confirms it (9 classes, none named `references`) | — |
| instantiates | ✅ | capitalized identifier + `argument_part` selector (Dart has no `new`: `Counter(1)` → instantiates Counter — types are capitalized); `constructor_invocation` (`List<int>.filled(...)`) → the constructed `type_identifier`; redirecting factory (`factory X.y() = X.z;`) → the redirect target type | 0.95 |
| imports | ✅ | `import_specification` / `part_directive` → module leaf → `${uri}:*` | 1.0 |
| exports | ✅ | `library_export` → module leaf → exported uri | 1.0 |
| overrides | ✅ | derived method matching base-class method name; base resolved via extends + cross-file harness companion (`Counter.format → BaseService.format`) | 0.95 |


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
- Dart 3 **record types** are extracted into the type payload. All three type
  extractors (parameter, return, field) accepted a fixed five-node allowlist —
  `type_identifier`, `function_type`, `nullable_type`, `void_type`, `void_type` —
  and a `record_type` fell through every one, so `void f((int, String) p)` typed
  its parameter `dynamic` and `({int a, String b}) f()` published no return type
  at all. Fixed; the type text is taken verbatim so field names inside a record
  survive. Measured over the live corpus: **27 return types and 1 parameter**
  regained their declared record type, 0 relationships changed.
- Dart 3 **patterns** are parsed and their constants are now READ (see the `uses`
  row), which recovered **2,405 edges** over the live corpus, 516 of them naming a
  symbol declared in the same file.
- What remains a declared gap, re-scoped by measured volume in
  `script/m14/spec/dart-completeness.json`: `variable_pattern` (353 occurrences
  across 110 files) is a DECISION rather than missing code — a pattern binding
  behaves exactly as a parameter does, `uses` published and no symbol behind it,
  and whether a binding should be a symbol is a cross-language question; record
  TYPES as containers and record LITERALS are unresolved; `library_name` is low
  value. The old framing ("records and patterns are parsed but not yet emitted")
  overstated the work and could not be prioritised — see `989ba4c7`.
- `this.x`/`obj.x` **does** now produce a `uses` edge (the DT-F+ bare/member-read
  surfaces above). An earlier revision of this file stated the opposite, which was
  true before those waves landed and is the kind of statement that outlives its
  evidence unless someone re-derives it.
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

**Now also measured on the PRIMARY corpus, which the declared figure never covered.**
`ProxiCall/lib`, 1,294 files, fresh parser per file so the method matches the
declared one:

| corpus | files | symbols | relationships | wall | budget |
| --- | --- | --- | --- | --- | --- |
| declared `corpus_subset` (Flutter framework) | 399 | 23,952 | 88,098 | 281.9 s | < 600 s |
| **live `ProxiCall/lib`** | **1,294** | **265,148** | **675,964** | **202.5 s** | **< 600 s, met at 3.24x the file count** |

Extrapolated to the declared 400-file scale the live corpus would be **62.4 s**, so
the budget is met with a wide margin rather than narrowly. Peak RSS 1,174.6 MB on
1,294 files, against 619.5 MB on 399 — *lower* per file.

**The throughput figures are NOT like-for-like and should not be compared as a
speed-up.** The live run reports 1,310 symbols/s against the declared 85. The
declared `corpus_subset` is a Flutter-framework ERROR SCAN — it walks every node
looking for parse failures and reports "0 error files" — over framework files that
are far larger than ProxiCall's, while the live run only analyses. Reading 15x out
of that difference would be reading two different jobs.

No pathological hotspot either: the 20 slowest files hold **26.5%** of wall time, and
they are the generated `l10n/generated/app_localizations_*.dart` set — ~30 files of
400–965 KB, each declaring ~5,353 real getters. A tail that flat is a corpus-shape
fact, not a per-file pathology, and it is the same set that supplies 48% of all
`property` symbols.

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
  (authority: `manual_audit`; **156 facts**, amended 2026-09-24)
- Result: `validation/m12/results/dart-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / **unknown 5**,
  `earliestFailingLayer: none`, `parseErrors: 0`

**Read those numbers for what they are.** They are 1.000 over **five
hand-written fixture files**, and the truth document says in its own words that it
"predated three waves that landed on the analyzer" — the `uses` surfaces, overrides
through an implemented interface, and instantiates for a const constructor. It was
re-audited against fixture source and all 32 apparent false positives were found
to be correct edges, so the truth was stale rather than the analyzer. The 5
`unknown` are the analyzer's deliberate sub-threshold refusals (bare member reads
at confidence 0.6), pinned `expectedState=unknown` so that a wave which stops
emitting them fails rather than passing quietly.

### Oracle coverage — 73.6% of the graph is checked by a non-Dart rule

| classes | oracle | Dart-derived? |
| --- | --- | --- |
| `calls`, `instantiates`, `extends`, `implements`, `uses` | `deriveDartEdges` (`script/m14/differential.ts:8656`), `deriveDartBareUses` (:9149) | **yes** |
| `contains`, `overrides`, `imports`, `exports` | the generic family walkers | **no** |

Measured: the Dart-specific oracle region contains **zero** mentions of
`contains`, `overrides`, `imports` or `exports`. That is 497,858 of 675,964
relationships on the live corpus. A Dart-specific risk is already visible —
`class_definition`, `mixin_declaration`, `extension_declaration`,
`enum_declaration` and `extension_type_declaration` are five container shapes with
different member rules, and the generic walker does not read Dart's grammar. This
is the lane's largest known evidence gap and it is a Dart-owned oracle, not a
Dart-analyzer bug.

## Live corpus measurement

`$HOME/ProxiCall` — **1,294 `lib/` files, 0 parse errors**, 265,148
symbols and 675,964 relationships.

| relationship | count | | symbol kind | count |
| --- | --- | --- | --- | --- |
| contains | 260,102 | | property | 222,924 |
| overrides | 229,416 | | method | 32,261 |
| uses | 122,819 | | constructor | 3,877 |
| calls | 35,334 | | class | 3,721 |
| instantiates | 17,731 | | enum_member | 1,581 |
| imports | 7,155 | | enum | 294 |
| extends | 2,917 | | function | 261 |
| implements | 305 | | constant / extension / type / mixin | 145 / 50 / 19 / 14 |
| exports | 185 | | variable | 1 |

Two of those counts look impossible and are not, both audited rather than
believed:

- **`property` 222,924 (172/file)** — 48.0% is 20 generated localization files at
  **5,353 real getters each**, across 30+ locales.
- **`overrides` 229,416 (177/file) against 32,261 methods** — duplication factor
  **1.0x**, **zero** rows where source === target, and the pairs are genuine
  Flutter overrides (`_EmptyState.build -> StatelessWidget.build`,
  `lerp -> ThemeExtension.lerp`). 926 of 1,294 files carry at least one.

The 2,581 duplicated symbol NAMES in 668 files were broken down and are **all
legitimate**: 1,401 are a different owner (a file declaring both an interface and
its implementation), 1 is an accessor pair under DARTD12's `owner:name:kind` key,
and **all 75** same-kind same-owner cases are `constructor` — the required
consequence of DARTD3, since Dart constructors have no distinct name. Same-kind
same-owner duplicates, which DARTD20 forbids: **zero**.

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
- **The manifest numbers above are stale, and the drift is repo-wide rather than
  Dart's.** They sit in `corpus-claims-gate.json` `unbackedClaims` — as do
  **74 entries covering every one of the 36 languages**, with only 5 of 42
  languages (css, scss, objective-c, lua, yaml) carrying a real backing artifact.
  Dart's own corpus IDENTITY is `pass` (`dart-http@92b20d12(clean)`). The pinned
  candidate `proxicall@383e603e(dirty)` reads `resolves-historical`, but that exact
  revision is a candidate for **typescript, dart, python and bash** — one repo
  serving four lanes. Dart is simply the most-stale of the cheap comparisons
  (7.7× against live; the typescript lane's own manifest is 1.8×).
- **No perf figure exists for the live corpus.** 281.9 s is the 400-file sample
  against a 600 s ceiling; the live `ProxiCall/lib` has grown to 1,294 files
  (~3×) since the budget was set, so the budget is met on the sample and unknown
  on the corpus.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/dart/`
- Ground truth: `validation/m12/ground-truth/dart.json`
- Differential: `validation/m12/results/dart-differential.json`
- Complexity: `validation/m12/results/dart-complexity.json`
- Corpus sample: `validation/m12/results/dart-corpus-sample.txt`
- Grammar wasm: `wasm/tree-sitter-dart.wasm` (rebuilt from
  `UserNobody14/tree-sitter-dart` `be07cf7`)
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer;
  re-verified 2026-09-30 — 0 occurrences of `new RegExp`, `.match(`, `.replace(`,
  `.test(` or a regex split)
- Analyzer hygiene: `script/m14/verify-analyzer-hygiene.ts` — **Dart clean** (the
  gate's one finding is another lane's elixir node-identity comparison)
- Spec: `script/m14/spec/dart-completeness.json` — 95 handled / 106 internal-silent
  / 6 re-scoped gaps / 33 ruled decisions
- Reviews: `reviews/dart/` — five documents; `master-review-4.md` is the
  whole-surface pass measured against the live corpus
- Fixtures (current): `validation/m14/fixtures/dart/` — 12, all green

## Known limits of the evidence

1. **40 Dart mutants exist and NONE can execute.** They live in
   `script/m14/mutate-analyzer.ts`, which does not parse (the
   `xml/implicit-xml-prefix-unbound` transform has been malformed since
   `f5f002c6`). Until that shared file is repaired, "40 mutants" is a claim, not a
   measurement, and it is the single largest gap in this lane's assurance.
2. **73.6% of the graph has no Dart-derived truth** — see the oracle table above.
3. **The differential's 1.000 is five fixture files** against an audit that says it
   predates three analyzer waves.
4. **No corpus-scale perf figure**, and the corpus is ~3× the sampled size.
5. Two recorded suspicions were measured out of existence and are kept as such: a
   pattern binding shadowing a field (the metadata proves a 0.9 local read, not a
   0.6 member read; 0 collisions across 1,294 files) and the assumption that the
   78 missed `Enum.member` pattern constants were the whole story (2,405 edges
   were recovered, 516 resolvable).

## Docs: this file

## Issue

Closes M12.11 (GitHub issue #150).

## Member naming: operators are a lane contract

An operator member is published as `operator <token>` — `operator ==`,
`operator []`, `operator +` — never as the bare token. This is a deliberate
cross-language contract, the same shape kotlin's phantom members use, and it is
load-bearing rather than cosmetic:

- `operator_signature` has **no name field and no named children**. The member's
  identity lives in an anonymous token, so there is nothing to name it from
  without walking children positionally.
- The bare token is not a legal identifier and collides with unrelated
  syntax. A synthesized spelling that can never collide with a real Dart
  identifier is what makes the member nameable at all.
- Both the analyzer and `script/m14/oracles/dart-contains.ts` implement the
  contract independently — the oracle from the contract, never from the
  analyzer's table.

Reading a bare `==` off an `operator_signature` is therefore a bug in either
implementation, and the fixture battery pins the contract in both directions.

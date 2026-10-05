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

**What each of the ten types means IN DART** — not in general. The counts are a
2,735-file deterministic stride sample across five repositories (600 each from
`proxicall`, `riverpod`, `flutter-packages`, `dart-sdk`, plus all 335 of
`dart-http`), measured through the production entry point `parseFile` by
`validation/m14/fixtures/dart/census.ts`. The BEFORE column is the same 2,735 files
against the pre-M14 analyzer under the same harness, so every delta is measured
rather than argued. **The pre-M14 analyzer is pinned to a commit, not to `HEAD`** —
`git show 8286c7391:src/ast/real-dart-analyzer.ts`, 3,087 lines, the parent of the
commit that added `references` (86a27dcb4) and 410 lines shorter than the 3,497-line
file at this branch's head. `HEAD` is the wrong reference here and always was: it
moved. `8286c7391` contains no `references` emission at all — the string occurs once
in the file, in a comment on line 1699 — which is what makes it the BEFORE and not a
near neighbour.

**Both runs use `BB_DART_CONC=1`, and that is not a default — it is a requirement.**
The file set is deterministic; the result is not, at concurrency above 1. Measured
over the same 1,000 files with the same analyzer at `BB_DART_CONC=6`, two runs gave
36,550 and 36,503 symbols and 124,772 and 124,638 relationships, with every affected
label LOWER in the second run; at `BB_DART_CONC=1` the same two runs are identical to
the row. The engine prints `[BB-PARSE-ERR] … memory access out of bounds` on some
file-parses under concurrency (twice in ~5,500 file-parses, never at concurrency 1),
so the loss is a failed parse inside the WASM parser, not arithmetic in the census.
`parseFile` is shared machinery; see §Shared-machinery needs.

| Relationship type | Emitted? | What it means in Dart | How resolved | Count (2,735 files) | BEFORE | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| calls | ✅ | an EXPRESSION was invoked | `selector` + `argument_part` → leaf callee (selector chains reduce to the last identifier: `obj.method()` → `method`; `Future.delayed(...)` → `delayed`); source = enclosing function/method/constructor leaf name (derived from the signature that precedes the `function_body` sibling); cascade calls (`..increment()`) → cascade selector leaf; global builtins filtered (`print`, `assert`, `identical`); Object-leaf methods filtered (`toString`, `hashCode`, `runtimeType`, `noSuchMethod`) | 43,042 | 43,044 (−2, R7 rows) | 0.9 |
| uses | ✅ | a VALUE was read — four distinct surfaces, not one | (1) MIXIN — `mixins` child → each `type_identifier`, 1.0. (2) FIELD / MEMBER READ — a `selector` WITHOUT its own `argument_part` (`obj.method` tear-off, `this.count`, `C.total`, `a?.value`), 0.9; a CALLED member is a `calls` edge, not a field read. A `qualified` name under a `constant_pattern` (`case WalletOperationType.recipientLookup:`) is the SAME read parsed the other way round and is read too, 0.9, `isConstantPattern`. (3) BARE IDENTIFIER — `return count;` on a declared member of the enclosing type, gated on resolution AND on the name not being locally bound, 0.6, `isBareRead`. (4) TEMPLATE INTERPOLATION — each identifier in `${…}`, 0.9, `isLocalRead`; a local DECLARATOR suppresses it, a PARAMETER does not | 110,679 | 110,762 (−83, R7 rows) | 0.6–1.0 by surface |
| contains | ✅ | a declaration is a member of a container | computed from `ownerName` on symbols (single pass) — class/mixin/extension/enum members | 119,515 | 119,534 (−19, R7 rows) | 1.0 |
| imports | ✅ | this file REACHES FOR a module | `import_specification` / `part_directive` → module leaf → `${uri}:*` | 10,657 | 10,657 | 1.0 |
| references | ✅ **(new)** | this declaration NAMES A TYPE in a type position | every `type_identifier` outside the positions another label already publishes, gated on the name binding to a type this run can see — same file always, `projectIndex.typeKinds` when an index is supplied | **5,265** | **0** | 0.95, `isTypeMention` + `typePosition` + `isIndexResolved` |
| exports | ✅ | this library PUBLISHES a module | `library_export` → module leaf → exported uri | 302 | 302 | 1.0 |
| extends | ✅ | a type INHERITS a base type | `superclass` → first `type_identifier`; a mixin `on`-base is the same edge (DARTD14) | 4,730 | 4,730 | 1.0 |
| implements | ✅ | a type SATISFIES an interface | `interfaces` → each `type_identifier` | 758 | 758 | 1.0 |
| overrides | ✅ | a member REPLACES one it inherits | derived method matching base-class method name; base resolved via extends + the cross-file companion | 90,352 | 90,352 | 0.8 |
| instantiates | ✅ | an object of a type was CONSTRUCTED | capitalized identifier + `argument_part` selector (Dart has no `new`: `Counter(1)` → instantiates Counter — types are capitalized); `constructor_invocation` (`List<int>.filled(...)`) → the constructed `type_identifier`; redirecting factory (`factory X.y() = X.z;`) → the redirect target type | 18,374 | 18,374 | 0.95 |

Total relationships on the sample: **403,674** after, **398,513** before —
+5,265 new `references`, −104 net from the R7 filter. Those two deltas account for the
whole difference: 398,513 + 5,265 − 104 = 403,674, and every other label's count is
identical in the two runs.

The R7 rows are **106**, not 104, and the difference is not an error: the filter
shares its loop with the dedup, and two of the 85 `uses` rows it drops were duplicates
the dedup was discarding anyway. Per label, BEFORE: 85 `uses`, 19 `contains`, 2
`calls`. AFTER: **0**, with `symbolsNamedUnknown 0` — no sampled file publishes a
symbol named `unknown`, because `keepSymbol`'s universal denylist rejects the name for
every language, so every one of those 106 rows was an endpoint nothing could bind.

### The tenth type: `references`

The rule in one line: **`X references T` iff the declaration `X` names the type
`T` in a type position, and `T` binds to a type declaration this run can see.**

Both clauses are needed and they fail independently.

**The mention is a parse fact.** In this grammar `type_identifier` is the node the
parser builds for a type name and never appears where a value identifier appears,
so "this names a type" needs no capitalization heuristic and no shape guess. The
parent-position inventory that decided which positions publish is measured, not
recalled — `validation/m14/fixtures/dart/type-position-probe.ts` walks the same
corpus and prints it: 75,769 type mentions outside heritage clauses across the
1,000-file sample, led by `getter_signature` 17,274, `formal_parameter` 14,292,
`type_arguments` 13,201, `function_signature` 6,709, `declaration` 3,312,
`initialized_variable_definition` 3,188, `type_cast` 1,833, `type_test` 910,
`try_statement` 215 (an `on T catch`), `type_bound` 59, `type_alias` 78,
`qualified` 646 (the leaf of `prefix.Type`), and 21 further positions — **33 positions
in all**, which is every one the probe found rather than a top-N cut: the JSON carries
`top(positionCounts, 40)` and the map holds 33 entries, so the cap never bound. An
earlier version of this sentence said "28 further positions", implying 40 and matching
neither; the 40 is the instrument's cap and it had been read as a count.

**The binding is not a parse fact, which is why the label is gated.** 3,460 of
those 75,769 mentions (4.57%) name a type the same file declares. The other 95.43%
name `String`, `Widget`, `Future` — real types, in `dart:core` and the Flutter SDK,
declared in files a per-file run has not read. Publishing them would make the label
mostly a list of SDK type names at roughly 22× the edge count, and every one of
them an endpoint no symbol in the index can bind. **So the unresolvable majority is
deliberately unread, and the number is stated here rather than left to be found
downstream.**

Positions that are NOT published, each with its reason:

| Position | Why not |
| --- | --- |
| `superclass`, `interfaces`, `mixins`, `mixin_declaration`, `mixin_application` | heritage already publishes `extends` / `implements` / `uses`; a second label for one fact is a double count |
| `new_expression`, `const_object_expression`, `constructor_invocation`, `redirecting_factory_constructor_signature` | construction already publishes `instantiates` |
| `type_parameter` | `class Box<T>` DECLARES a type variable; a mention of `T` resolves to the variable, refused by `isTypeParameterShadowed` |
| `ERROR` | nothing inside a parse-error region is a fact about a well-formed program |

Three further refusals are not about positions but about names:

- `dynamic` — Dart's IMPLICIT type, the absence of a declared type rather than a
  dependency on one. It is spelled as a type name, so it needs the explicit
  exclusion the fixture pins.
- a self-reference — an UNNAMED extension (`extension on String {}`) is published
  under its TARGET TYPE's name, so without this rule it publishes
  `String references String`. An UNNAMED extension is also kept out of the
  visible-type set for the same reason: admitting it would make every mention of
  `String` in the file resolve to this file's extension.
- a name no visible type answers to — the gate itself.

Source attribution is the lane's existing rule for a non-function context
(DARTD8/DARTD9): the innermost PUBLISHED declaration that mentions the type. A
member's own signature; a type's own declaration (including a `typedef`'s aliased
type and an extension's `on` clause); the FILE for a top-level mention, by the
file's base name — the same convention `calls` and `instantiates` already use. Two
attribution shapes are set by the GRAMMAR rather than by the text, and both are
measured:

- a **LOCAL FUNCTION** is not a published symbol (`local_function_declaration >
  lambda_expression > function_signature`), so its type mention folds into the
  function that encloses it. Publishing the local function's own name would make the
  SOURCE endpoint a symbol nothing can bind.
- an **expression-bodied member** is not always a method: tree-sitter-dart resolves
  `foo() => Bar(...)` to `method_signature > constructor_signature`, so the source
  is the family name `constructor`, the same name `contains` gives that symbol. The
  two labels have to agree on a constructor's identity or a graph cannot join them.

The fixture that holds all of this is
`validation/m14/fixtures/dart/type-references.dart` — 14 expected rows and 15
forbidden ones, each forbid naming a shape where a plausible widening either
double-counts another label or claims a mention the source does not make.

### Defects found and fixed while establishing this lane's numbers

Four, all in this lane's own code, all found by measurement rather than by reading.
Three were found in code this wave wrote; the fourth is in the census harness this
lane also wrote, and it is the one that had been quietly mis-reporting.

1. **The type-variable gate never fired for a CONSTRAINED type variable.**
   `isTypeParameterShadowed` compared `type_parameter.text` against the mentioned
   name, and a `type_parameter` node's text SPANS ITS BOUND — `class Box<T extends
   Wallet>` is one node whose text is `"T extends Wallet"`. So the comparison never
   matched any generic with a bound, which is the common case. On a 9-line
   reproduction whose file also declared `class T {}`, the analyzer published
   `Box -> T`, `get -> T` and `put -> T`: three edges that RESOLVE, at the wrong
   declaration, because inside `Box` the name is the type variable. Fixed by reading
   the parameter's `type_identifier` child instead of its text, on both the analyzer
   side and the oracle side. **Corpus effect: 0 rows** — 2,735 files contain no
   constrained type variable whose name is also a declared type in the same file, so
   this is a reachable defect with no corpus incidence, and the fixture
   (`class Shadowed<T extends Shadowed>` beside `class T {}`) is what holds it.
2. **The oracle read three shapes the analyzer does not.** A corpus agreement run at
   150 files per repository disagreed on 19 of 1,210 rows, and every one of the 19 was
   the ORACLE's reading, never a fabricated analyzer row:
   - it named a local function as the source (13 rows, all inside closures in
     `material_ui/test/dropdown_menu_test.dart`);
   - it did not treat a class ALIAS as a type declaration (`class SuperC = S with M;`
     puts the name inside `mixin_application_class`, so a `name`-field read sees no
     class at all — 2 rows);
   - it tested for a constructor signature before descending the wrapper, so it
     missed every expression-bodied member the grammar calls a constructor (3 rows).
   After the fixes: **1,203 of 1,203 rows agreed over the same 799 files, 0 missing,
   0 unexplained.** Each fix is pinned by a case in the battery.
3. **The census reported a capped counter as a total.** `unknownEndpoints` was one
   array used both as the counter and as the capped example list, and the report read
   `.length` off it while the pushes stopped at 40 — so every run whose true count
   exceeded the cap printed exactly `40`. That is how a 2,351-file measurement came to
   be quoted as 40 when the true figure is 239. Fixed by separating the counter from
   the sample list, and the count is now reported per label as well, because "106
   rows carry the literal" and "which labels" are two questions.
4. **A named-constructor leaf call can name the placeholder** — the R7 defect, above.
   106 rows on the 2,735-file sample, 239 on proxicall's full tracked set.

### The one type that was missing is not the only defect the census found

`references` was believed missing and was. Two further defects surfaced while
establishing the baseline, and both are in this analyzer:

1. **106 relationships carried the placeholder literal `unknown` as an endpoint**
   (M60 rule R7), on the 2,735-file sample: 85 `uses`, 19 `contains`, 2 `calls` —
   and 239 rows on proxicall's full 2,351-file tracked set (154 `uses`, 68
   `contains`, 17 `calls`). Two constructions produce them, and both are the same
   shape at the leaf:
   - a selector chain reduced to its leaf, where the leaf of a constructor call on a
     capitalized type is the named constructor's segment and the segment is the word
     `unknown` — `ApiError.unknown('Data transformation failed: $e')`,
     `proxicall/lib/services/api/api_response.dart:172`;
   - a same-named enum constant read through its type —
     `enum SegmentType { …, unknown, … }` in
     `proxicall/lib/models/nms/user_segment.dart:37`, read at line 60 and 82.
   After the filter: **0**, measured on both sample sets.
   The alternatives were each worse: `map calls ApiError` claims a call is a call
   OF the type, and promoting the row to `instantiates` would extend DT-A's
   in-file named-constructor evidence to a cross-file guess. The edge goes, which
   is what R7 prescribes — the honest state is absence, not the string `unknown`.
   **What it costs is measured rather than assumed:** all 106 targets named symbols
   that the store never receives, because `keepSymbol`'s universal denylist
   (`src/ast/pool-worker.ts`) drops the name `unknown` for every language, and the
   census counts 0 surviving symbols named `unknown` in the same sample. So the
   graph loses nothing; the edges pointed at nothing. The price that IS real is one
   declaration: `user_segment.dart`'s enum constant is named `unknown`, it loses any
   edge to it, and it had none before the filter either.
   The one cost outside the analyzer is in the DIFFERENTIAL, and it is a supervisor
   item: the oracles still derive such rows (measured 9 per 525 files,
   `validation/m14/fixtures/dart/r7-truth-cost.ts`), and the harness matches on
   (label, target), so every one it samples now reads MISSING. See §Shared-machinery
   needs below.
2. **`references` was the only one of the ten types the differential does not
   compare** — see DERIVATION below.


## Verdicts, one per relationship type (M14 ontology wave)

Each of the ten types carries exactly one verdict. **There is no RULED type in this
lane any more**: all ten are emitted, so the arbiter has nothing left to rule and
the falsifiable-ruling machinery is vacuous here. That is a statement about the
measurement, not a preference — the counts in the table above come from production
`parseFile` over 1,000 corpus files, and a type with a non-zero count cannot be
ruled.

| Type | Verdict | Count (2,735 files) | Evidence |
| --- | --- | --- | --- |
| calls | EMITTED | 43,042 | production `parseFile`, `BB_DART_CONC=1`, sample files listed in the census JSON |
| uses | EMITTED | 110,679 | same |
| contains | EMITTED | 119,515 | same |
| imports | EMITTED | 10,657 | same |
| references | EMITTED | 5,265 | same; `type-references` fixture (14 expect / 15 forbid) + lane oracle at 100.0% (1,203/1,203 rows) over 799 corpus files |
| exports | EMITTED | 302 | same; arbiter `firing-check.ts --files 400 dart` independently reports 10/10 with 9 `exports` edges — see *the supervisor's arbiter reads 9/10 at n=120* |
| extends | EMITTED | 4,730 | same |
| implements | EMITTED | 758 | same |
| overrides | EMITTED | 90,352 | same |
| instantiates | EMITTED | 18,374 | same |

Corpus: `proxicall` (600 of 2,351 tracked, stride 3), `riverpod` (600 of 1,295,
stride 2), `flutter-packages` (600 of 4,033, stride 6), `dart-sdk` (600 of 25,734,
stride 42), `dart-http` (all 335). Sampling is a deterministic stride over
`git ls-files '*.dart'` sorted, per repository — no randomness, so a reviewer
reproduces the same 2,735 file set from a clean corpus.

### How many files each type fires in, over the same 2,735

A count says a type exists; a file count says how widely. `census.ts` wrote only
six example files per type and that field is capped at six **in iteration order**,
so all sixty examples were `proxicall` files — which made `exports` look like a
single-repository edge when it is not. The census now carries an uncapped per-type
file set, so the breadth is measured rather than sampled:

| Type | edges | files carrying it | % of 2,735 | repos | spread (proxicall / dart-http / riverpod / flutter-packages / dart-sdk) |
| --- | --- | --- | --- | --- | --- |
| calls | 43,042 | 2,310 | 84.5% | 5/5 | 532 / 299 / 533 / 515 / 431 |
| uses | 110,679 | 2,373 | 86.8% | 5/5 | 561 / 273 / 546 / 526 / 467 |
| contains | 119,515 | 1,696 | 62.0% | 5/5 | 441 / 96 / 435 / 371 / 353 |
| imports | 10,657 | 2,461 | 90.0% | 5/5 | 578 / 315 / 583 / 575 / 410 |
| references | 5,265 | 911 | 33.3% | 5/5 | 242 / 47 / 267 / 203 / 152 |
| exports | 302 | 104 | 3.8% | 5/5 | 18 / **54** / 12 / 11 / 9 |
| extends | 4,730 | 1,218 | 44.5% | 5/5 | 348 / 58 / 363 / 279 / 170 |
| implements | 758 | 307 | 11.2% | 5/5 | 116 / 39 / 38 / 44 / 70 |
| overrides | 90,352 | 1,100 | 40.2% | 5/5 | 321 / 56 / 348 / 266 / 109 |
| instantiates | 18,374 | 2,032 | 74.3% | 5/5 | 516 / 254 / 508 / 460 / 294 |

**Every one of the ten fires in all five repositories, so no verdict above rests
on a single corpus.** Two rows are worth reading closely. `exports` fires in 104
of 2,735 files (3.8%), which is the edge-side counterpart of the 2.0117%
node-side base rate below, and its largest share is `dart-http` — the one
repository in the sample that is entirely library code, where a `lib/` entry point
is what carries an export. And `exports` is the only type whose largest
repository is not `proxicall` or `riverpod`, which is the same fact the capped
example list was hiding.

`contains` is the one type that does NOT approach its ceiling: 1,696 of 2,735
files, 62.0%. A first draft explained the missing 1,039 as "scripts, `part`
fragments and generated files with no declaration of their own" — a plausible
sentence, and not a measurement. `validation/m14/fixtures/dart/zero-contains-probe.ts`
now characterizes the population from node types instead, and the accounting
closes to 1,039 with **no unexplained remainder**:

| shape | files | what it is |
| --- | --- | --- |
| no declaration node, no directive | 882 | nothing for `contains` to point at |
| declaration nodes, all member-less | 96 | 211 empty `class_definition`, 28 `type_alias`, 10 `mixin_declaration`, 3 `extension_declaration` — an empty class genuinely contains nothing |
| directives only (`library`/`part`/`part of`) | 51 | 89 `part_directive` + 22 `part_of_directive` + `library_definition` nodes; a `part` fragment declares nothing of its own |
| declaration WITH members | 5 | the structural fallback and one parse error — the only row where an edge *should* exist and does not |
| parse error, no declaration | 5 | 9 ERROR nodes across the population |
| **total** | **1,039** | the instrument's four mutually exclusive shapes are 882 + 101 + 51 + 5; the 101 splits 96 member-less + 5 with members, and the five rows above are that refinement |

The fourth row is the one that mattered, because it is the only row where an edge
*should* exist and does not. All five were checked against production `parseFile`
rather than argued about. Four return `fallback=true` with symbols that carry no
`kind` and a `calls` row from the regex extractor; the fifth is a 35-byte
`ERROR`-bearing parse case:

```
native_cupertino_bindings.dart  1,075,261 B  fallback=true  symbols=6    rels={calls:24}
ok_http/.../jni/bindings.dart   1,192,087 B  fallback=true  symbols=1    rels={calls:10}
google_fonts_lite.dart          1,873,498 B  fallback=true  symbols=1061 rels={calls:1}
dartfuzz_type_table.dart       11,723,071 B  fallback=true  symbols=0    rels={}
patternVariableDeclaration_inClass.dart  35 B  errors=1  rels={}
```

So **`contains` misses nothing the analyzer can see**: every sampled file that
declares something with a member and is under the size guard carries the edge.
The 62.0% is the label being defined over declarations, and reporting it as 100%
would be reporting the absence of a counter-example as coverage.

Two false readings were produced and caught while measuring this, both from
naming a node type nobody had checked rather than reading it off the tree. The
first hardcoded `class_member` and measured **0 of 923** declarations as having a
member; the second hardcoded `method_signature`/`field_declaration` as children of
the declaration and measured 0 again. The grammar puts members one level down,
inside `class_body` (713), `extension_body` (163), `enum_body` (12) and
`representation_declaration` (237), and a declaration's own named children are
only its name, heritage clauses, type parameters and annotations. A third reading
was wrong for a different reason — it classified from an accumulator that spanned
the whole corpus, which reported 101 files with members when 5 have them. The
probe derives the member set from the histogram it prints and classifies per file;
that is why the table above can be checked rather than believed.

Reproduce the breadth columns and the zero-`contains` accounting:

```bash
BB_DART_CONC=1 BB_DART_OUT=/tmp/c.json npx tsx validation/m14/fixtures/dart/census.ts
# -> perType.<type>.filesWith and .filesWithByRepo, plus filesWithoutContains
BB_DART_CENSUS=/tmp/c.json npx tsx validation/m14/fixtures/dart/zero-contains-probe.ts
# -> the 882 / 101 / 51 / 5 shape split, and filesWithMemberDecls = 5
```

### The supervisor's arbiter reads 9/10 at n=120, and that reading is a sample artifact

`script/m14/firing-check.ts --files 120 dart` reports:

```
9/10 fired, 8290 edges, 120/120 files
notFired: ["exports"]
```

**This file said `firing-check.ts` "is not on this branch" for six commits after that
stopped being true, and the tenth pass corrected it.** The statement was introduced at
`cdffad991` (2026-10-04 02:45), when the file was genuinely absent from
`analyzer/DART`; the base merge `3868c4411` (2026-10-04 17:12) brought it in —
`git cat-file -e HEAD:script/m14/firing-check.ts` succeeds, and
`git merge-base --is-ancestor 7c8eb5cc8 HEAD` holds. Both readings below were therefore
re-run this pass **directly from the branch's own copy**, with no staging under `/tmp`
and nothing removed afterwards, and both reproduced to the edge. The original readings
were made from a staged copy of `5a634e17e:script/m14/firing-check.ts` and are kept
because they agree; what is withdrawn is the claim about where the instrument lives.
A reader told to stage a copy will not know the committed file had moved under them, and
the second sentence here — that the remedy for item 7 is "to land that commit" — was
addressed four merges ago without this file noticing. Its own numbers at
n=120 versus n=400, same instrument, same corpus, same analyzer:

| n | fired | relationships | files | `exports` edges |
| --- | --- | --- | --- | --- |
| 120 | 9/10 | 8,290 | 120/120 | **0** |
| 400 | **10/10** | 53,252 | 400/400 | **9** |

The n=400 run prints, verbatim:

```
10/10 fired, 53252 edges, 400/400 files

lang       files       fired   rels        degraded  fired types
dart       400/400     10/10   53,252      0    calls,uses,contains,imports,references,exports,extends,implements,overrides,instantiates
```

and the n=120 run prints `dart  120/120  9/10  8,290  0` with `exports` absent from the
fired list — the supervisor's table, reproduced. `degraded` is 0 on both.

At n=400 the arbiter reports `degraded: 0`, `unknownEndpoints: 0`,
`emptySymbolNames: 0`, `emptyOrUnknownKind: 0`.

**Why 120 files cannot see an export in Dart.** `validation/m14/fixtures/dart/export-population-probe.ts`
walks the whole admitted corpus and counts `library_export` NODES on the parse tree —
a node-type count, because `export` also occurs inside identifiers, comments and string
literals and a text instrument could not tell a directive from a word:

```
corpus total .dart files: 33,753
files carrying >=1 library_export node: 679  (2.012%)
library_export nodes across the corpus: 2,040
  of those, inside an ERROR region: 1
```

At a 2.012% base rate, 120 files are expected to contain `679/33753 x 120 = 2.41`
export-bearing files, and the probability that a 120-file sample contains NONE is
`(1 - 0.0201167)^120 = 0.0873`. The probe reproduces the arbiter's own sample from the
arbiter's own rule and finds **0** export-bearing files in it — consistent with the
reading, not evidence against it. n ≥ 148 gives a ≥95% chance of at least one; at
n=400 the expected count is 8.04 and the arbiter measured 9.

**The probe's own printed sentence was wrong about this and understated the surprise.**
It printed the **per-file** non-export rate — `97.988%` — and attributed the observed 0
to it. The quantity that predicts a 0 at a sample of 120 is `(1 - p)^120` = **8.73%**,
an order of magnitude away, and the error ran in the permissive direction: 97.988% makes
a zero sound expected, so a reader skimming it would have had less reason to go and look
for the defect the 0 might have been. The probe now prints the base rate, the sample
probability and the n that reaches P(none) ≤ 5% as three separate, labelled numbers.
The numbers in the paragraph above are unchanged by the fix; only the sentence that
explained them was wrong.

**So `exports` is EMITTED and the 9/10 is the sample, not the lane.** The ruling that
was tempting here — "`library_export` is rare enough that 120 files miss it, so 9/10 is
the lane's real ceiling" — was available and would have been wrong, and it is wrong in
the direction that matters: it would have reported a shortfall on a label that fires 302
times over 2,735 files. A type's firing verdict must be taken at a sample where its
base rate can be seen; the same arbiter at 400 files is the same code reading 10/10.

The first version of this probe reached the OPPOSITE conclusion — it reported that the
arbiter's sample contained 2 export-bearing files, which would have made the 0 a real
defect — and it was wrong twice over: it sorted the whole-corpus list before striding
(`filesForLanguage` strides in construction order and sorts only the picked files), and
it filtered files over 512 KB, which the arbiter does not, admitting 33,692 of the
arbiter's 33,755 and shifting the stride from 281 to 280. Both errors changed which 120
files were measured. The corrected probe and the corpus rule it depends on are in the
file header.

The one `library_export` node inside an ERROR region corpus-wide is counted
separately above rather than folded into the base rate; it does not change the
verdict, and the analyzer's own `exports` row (302 over 2,735 files) is a count of
EDGES, measured through `parseFile`, not of nodes.

Reproduce:

```bash
BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/census.ts    # the table above
npx tsx validation/m14/fixtures/dart/type-position-probe.ts      # the position inventory
npx tsx script/m14/verify-dart-references.ts                     # 38 shapes, both sides
BB_DART_PER_REPO=150 npx tsx script/m14/verify-dart-references.ts --corpus
bun run script/m14/run-fixtures.ts --lang dart                  # 16 fixtures
BB_MUTANT_ONLY="dart/" bun run script/m14/mutate-analyzer.ts      # 42/42 caught

npx tsx validation/m14/fixtures/dart/export-population-probe.ts # the 2.012% base rate
npx tsx validation/m14/fixtures/dart/export-firing-probe.ts     # edges on the 2 sampled files
npx tsx script/m14/firing-check.ts --files 400 dart             # 10/10, 53,252 edges
```

Both were run this pass from the branch's own copies, which the corrected paragraph
above establishes are present. **Two of the arbiter's own JSON fields are wrong on every
lane and a reader will meet both** — `analyzerDigest`
is a `MISSING:` path because it looks for `script/ast/` instead of `src/ast/`, which also
makes `analyzerStableDuringRun` vacuously true, and `types[type].files` is 1 for every
type because its map is rebuilt per file. Remedies are items 14 and 15 under
*Shared-machinery needs*. The fired count, the edge count, `degraded`, and the four
zero-safety fields are unaffected by either, which is why the readings above stand.

The incoming pass (§The incoming direction) has its own instruments, and they use a
different sample on purpose — a symbol table that is itself a stride cannot answer a
cross-file resolution question:

```bash
BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/incoming-census.ts   # the incoming tables
bun run validation/m14/fixtures/dart/object-interface-mutant.ts          # 4/4 mutants caught
bun run script/m14/verify-dart-contains.ts                               # 37 shapes
bun run script/m14/verify-dart-overrides.ts                              # 14/14 shapes exact
bun run script/m14/verify-dart-references.ts                             # 38 shapes, both sides
npx tsx validation/m14/fixtures/dart/regex-census.ts                     # 0 regexes, AST-measured
npx tsx validation/m14/fixtures/dart/regex-census.ts --all               # + the 7 pre-existing tmp rows
npx tsx validation/m14/fixtures/dart/hang-file-innocence.ts             # 8/8 hang files parse clean alone
npx tsx validation/m14/fixtures/dart/differential-rotation-instability.ts  # 38/2351 files, 5353 each
bun run script/m14/differential.ts --lang dart --force-fresh          # 2 lanes, unexplained=0
```

### The six questions, per emitted type

They fail independently, so each is answered with its own measurement. Resolution is
given in three scopes because they answer different questions: `file` is this file's
symbols, `sample` is every sampled file's, and `repo` is every sampled file of the
SAME repository — the narrowest honest cross-file scope, since a per-file analyzer
cannot see another file and a type declared in one is a real symbol the edge can
legitimately name. All figures below are the 2,735-file run, and every one is a field
`census.ts` writes to its JSON: `src∈file`, `tgt∈file`, `both∈file`, `tgt∈sample`,
`both∈sample`, `tgt∈repo`, `both∈repo`. Where this table says "both∈X" it means BOTH
endpoints bind at that scope; the two tables below used to mix target-only and
both-ends figures under one word, and two of the numbers below were left over from a
census run that predated the qualified-spelling fix (defect 4 under *Four defects in
this lane's own harnesses*), which is why `overrides` was quoted at 0.0% in-repo.

| Type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| calls | ✅ | ✅ 43,042 | ✅ differential, 60-file proxicall sample, **0 unexplained in every rotation run, five so far** (6120/6220, 6062/6162, 17196/29131, 17131/29066, 17196/29131 again at this pass's rotation 78 — the swing is `overrides`, an excluded label, and the coverage figure is a property of the draw) | ✅ | src∈file 99.1% · tgt∈file 22.1% · both∈sample 66.7% · both∈repo 50.8% | 35 of 43,042 under 0.7 (0.1%), min 0.4 — sub-threshold `uses`-style reads inherited from the shared bare-read surface |
| uses | ✅ | ✅ 110,679 | ✅ same run, 0 unexplained | ✅ four surfaces, each pinned by a fixture; no surface borrows another's label | src∈file 99.3% · tgt∈file 25.5% · both∈sample 69.3% · both∈repo 60.2% | 13,325 of 110,679 under 0.7 (12.0%), all the bare-read surface at 0.6 — the largest heuristic class in the lane |
| contains | ✅ | ✅ 119,515 | ✅ `deriveDartContainsTruth`, 37/37 shapes exact, and 0 unexplained in the differential | ✅ | **both∈file 100.0%, both∈repo 100.0%** — the only label in the lane that resolves at both ends by construction; 3 of 119,515 targets are bare-name and unbound | 0 under 0.7 |
| imports | ✅ | ✅ 10,657 | ✅ `deriveDartImportsTruth`, 7,340 rows measured EXACT on both corpora | ✅ | src 2.7% / tgt 0.0% both-ends: targets are module URIs (`package:foo/src/x.dart:*`), and a URI is not a symbol in this index | 0 under 0.7 |
| references | ✅ | ✅ 5,265 | ✅ lane oracle `script/m14/oracles/dart-references.ts` — **1,203/1,203 rows agreed (100.0%), 0 missing, 0 unexplained** over 799 corpus files, and 38/38 shapes exact in the battery | ✅ 14 expect rows name the position they came from; 15 forbid rows cover heritage, construction, type variables (including a constrained one shadowing a same-named class), self-reference, `dynamic` and the resolution gate | src∈file 97.9% · **tgt∈file 100.0% by construction** · both∈file 97.9% · both∈sample 98.7% · both∈repo 98.6% | **0 of 5,265 under 0.7** — all `usage_contextual` at exactly 0.95, min = mean = 0.95 |
| exports | ✅ | ✅ 302 | ✅ same oracle as imports | ✅ | 0.0% both-ends, same URI shape | 0 under 0.7 |
| extends | ✅ | ✅ 4,730 | ✅ differential, 0 unexplained | ✅ alias-free leaf resolution (DAD1), pinned by `dart/heritage-alias-not-resolved`'s fixture twin | src∈file 100% · tgt∈file 15.0% · both∈sample 33.2% · both∈repo 27.1% | 0 under 0.7 |
| implements | ✅ | ✅ 758 | ✅ differential, 0 unexplained | ✅ alias-free (DAD2) | src∈file 100% · tgt∈file 29.7% · both∈sample 48.0% · both∈repo 45.1% | 0 under 0.7 |
| overrides | ✅ | ✅ 90,352 | ✅ `verify-dart-overrides` 14/14 shapes exact — **but the differential does not compare this label**, see DERIVATION | ✅ exposer-not-declarer, instance-vs-static, breadth-not-depth, all pinned with a negative twin per rule | src∈file 100% · tgt∈file 2.3% · both∈sample 3.1% · both∈repo 2.9% | 0 under 0.7; 88,211 of 90,352 rows are the external-base form, all at 0.8 |
| instantiates | ✅ | ✅ 18,374 | ✅ differential, 0 unexplained | ✅ construction only, never a call (DT-A) | src∈file 96.8% · tgt∈file 13.4% · both∈sample 28.2% · both∈repo 22.4% | 0 under 0.7 |

Three things in that table need reading rather than skimming.

**"Correct" for `calls`, `uses`, `extends`, `implements` and `instantiates` is the
differential's word, and the differential has a declared blind spot:** the analyzer
and the oracle are two walkers over ONE grammar, so a defect in the grammar's own
vocabulary is invisible to both. `references` does not have that excuse for its
first half — the oracle is a second implementation of the same measured rule, and
its agreement is evidence about implementation disagreement, not about the rule.
The rule's own argument is the fixture battery and the position inventory.

**The resolution rates for `calls`, `uses`, `instantiates`, `extends` and
`implements` are low and that is not new.** They are low for the same reason CSS
`references` is the family reference point at 66.8%: a per-file analyzer names
targets that live in other files, and the index binds them when the whole project
is read. `references` is the only label whose target resolves in-file by
construction, because resolution is its gate — and the honest reading of that is
that it is also the only label that cannot tell you about a dependency this file has
on a type in another file.

**`overrides` resolves at 2.9% in-repo, and that low figure is a SHAPE rather than a
rate.** 88,275 of its 90,352 unresolved targets — 97.7% — are `dotted-path`: the edge
names `State.setState`, not `setState`, so it binds only where the `owner.name`
spelling is itself published. An earlier version of this document quoted 0.0% here,
and that number was the HARNESS's, not the analyzer's: `census.ts` put the qualified
`owner.name` spelling into the per-file symbol table only, so a label whose source and
target are both qualified read zero in every cross-file scope on a sample that plainly
contained the declaring class (defect 4 below). With the spelling in all three tables
the same run reads 3.1% in-sample and 2.9% in-repo. The 2.3% in-file figure remains the
honest one for a per-file run. Whether the dotted spelling is the right endpoint for a
cross-language graph is a question about the whole family and not this lane's to
answer; it is recorded here because a reader of `overrides` for Dart will otherwise
read 2.9% as "no base was ever found" — the incoming census below, which resolves
against whole repositories read in full, puts the same label at 93.0%.

### DERIVATION findings

A DERIVATION finding is a type the analyzer emits that the differential never
audits — stored and compared against nothing. **This lane had one at handover and
has one now, and it is a different one from the one the recorded baseline names.**

`script/m60/rel-type-coverage-gate.ts --langs=dart`, run on this branch:

```
CHECK 1 — DERIVATION: every emitted type has an oracle derivation
  dart         2 un-audited: ["overrides","references"]
```

- **`overrides`** — pre-existing, and it is a harness gap rather than a lane gap:
  the oracle exists (`script/m14/oracles/dart-overrides.ts`, pushed as
  `deriveDartOverridesTruth`) and the analyzer-side allowlist excludes the label for
  dart at `script/m14/differential.ts:23153` (`lang !== "dart"` in the overrides
  arm). Because the allowlist filters the ANALYZER side only, the truth rows land
  as permanent MISSING: **100 on a 60-file proxicall sample and 14 on dart-http,
  every one of them an `overrides` row.** Declared in this lane's spec
  (`script/m14/spec/dart-completeness.json` → `label_coverage.declared_gaps`), so
  `verify-label-coverage.ts` reports it as declared rather than undeclared.
- **`references`** — introduced by this wave, and it is the honest cost of adding a
  label ahead of its wiring. The oracle exists and its battery reports 38/38 shapes
  exact over 799 corpus files (`bun run script/m14/verify-dart-references.ts`, and
  `--corpus` for 1,203/1,203 rows agreed); the allowlist drops the label, so the
  5,265 rows are compared by nothing.
  Declared in the same spec entry with the reason and the `closes_when`.

The recorded baseline (`validation/m60/results/rel-type-coverage.json`, 2026-10-01)
says dart audits 5 labels and has 4 DERIVATION findings; this branch's gate reports
2. The difference is the M60 label-coverage sweep, which wired the `contains`,
`imports` and `exports` oracles after that artifact was written. The baseline file
is supervisor-owned and was not regenerated here.

## The incoming direction: can an emitted edge be walked TO

The tables above measure outgoing edges. This section measures the other direction,
because `src/lsp/impact.ts` obtains its reverse edges by scanning outgoing edges and
matching targets — so the reverse walk is exactly as good as that matching, and two
things follow from it that are not about emission at all:

1. **A target that resolves to more than one published symbol.** The reverse walk
   picks one by a rule nobody chose, so ONE edge is silently attributed to one of N
   real declarations and the other N−1 lose a caller they have.
2. **A hopeless target** — an SDK type, a package type, a member of an external
   type, a local variable — which in a count is identical to "a declaration in my
   own corpus the run failed to publish". Those are opposite findings.

Instrument: `validation/m14/fixtures/dart/incoming-census.ts`, driving production
`parseFile`. **This is a different sample from the tables above and the two are
never mixed.** The verdict table's 2,735-file census draws a stride from five
repositories; this census reads three repositories WHOLE and strides two, because
the questions are about cross-file resolution and a symbol table that is itself a
stride cannot answer them.

```
4,788 files   dart-http 335/335, riverpod 1,295/1,295, proxicall 2,351/2,351  (FULL)
              flutter-packages 404/4,033 (stride 10), dart-sdk 403/25,734 (stride 64)
337,336 symbols   960,634 analyzer relationships   BB_DART_CONC=1
26 files carry 457 ERROR-node parse errors; 4 files >1 MB go to the fallback
67 edges EXCLUDED as degraded-fallback output (below)
emptySymbolNames 0   emptyOrUnknownKind 0   symbolsNamedUnknown 0   unknownEndpoints 0
```

**Every count in that block reproduced exactly on a second run; the wall time did
not, and it is quoted here as a range for that reason.** The harness prints
`wallMs(walk)` and two runs on this machine measured **615,539 ms** and
**995,723 ms** — a 1.62x spread over an identical input, because the machine is
shared and this run's load average was 13. A millisecond-precision figure
presented as a lane property would be a number a reviewer re-runs, fails to
reproduce, and cannot tell apart from a regression. The stable form of the same
measurement is throughput: **960,634 analyzer relationships over 4,788 files**,
which reproduced exactly.

Resolution, per type. `repoFull` is over the three FULL repositories; `sample` is
over the two strided ones; the columns are never mixed, because a rate quoted over
the wrong scope answers a question nobody asked.

| Type | emitted | both ends, file | both ends, sample | both ends, repoFull | target unique | target ambiguous (2–5) | target crowded (6+) | target binds to nothing | confidence < 0.7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calls | 90,827 | 17,833 19.6% | 55,772 61.4% | 48,111 53.0% | 18,993 20.9% | 15,649 17.2% | 30,478 33.6% | 25,707 28.3% | 0 0.00% |
| uses | 226,095 | 56,417 25.0% | 158,944 70.3% | 137,653 60.9% | 33,842 15.0% | 32,617 14.4% | 106,083 46.9% | 53,553 23.7% | 25,464 11.26% |
| contains | 310,925 | 310,923 100.0% | 310,923 100.0% | 292,025 93.9% | 14,197 4.6% | 11,122 3.6% | 285,604 91.9% | 2 0.0% | 0 0.00% |
| imports | 22,506 | 0 0.0% | 0 0.0% | 0 0.0% | 0 | 0 | 0 | 22,506 100% | 0 0.00% |
| references | 10,273 | 10,049 97.8% | 10,131 98.6% | 7,468 72.7% | 6,948 67.6% | 947 9.2% | 2,378 23.1% | 0 0.0% | 0 0.00% |
| exports | 403 | 0 0.0% | 0 0.0% | 0 0.0% | 0 | 0 | 0 | 403 100% | 0 0.00% |
| extends | 10,317 | 1,542 14.9% | 4,832 46.8% | 4,131 40.0% | 4,543 44.0% | 615 6.0% | 164 1.6% | 4,995 48.4% | 0 0.00% |
| implements | 2,082 | 397 19.1% | 1,550 74.4% | 1,399 67.2% | 1,444 69.4% | 117 5.6% | 91 4.4% | 430 20.7% | 0 0.00% |
| overrides | 247,737 | 3,524 1.4% | 232,941 94.0% | 230,467 93.0% | 232,736 93.9% | 505 0.2% | 102 0.0% | 14,394 5.8% | 0 0.00% |
| instantiates | 39,469 | 4,593 11.6% | 13,597 34.4% | 12,185 30.9% | 13,764 34.9% | 1,443 3.7% | 2,220 5.6% | 22,042 55.8% | 0 0.00% |

### Ambiguity: 490,135 ambiguous targets, 296,854 of them closable

**The figures from here to *The defect this measurement found* were measured on the
tree at `c48f381d1` and every one of them is pinned to that commit.** Re-measured
after the base merge (sixth pass, `BB_DART_CONC=1`, same 4,788 files, same draw), the
edge population is **byte-identical** — 960,634 relationships, and every per-type
`emitted` count matches to the unit — while **every resolution cell moved in the same
direction, by a small amount, and every one of them moved toward resolving**:

| | pinned at `c48f381d1` | re-measured post-merge | Δ |
| --- | --- | --- | --- |
| symbols | 337,336 | **337,440** | +104 |
| `symbolsNamedUnknown` | 0 | **74** | +74 |
| ambiguous targets (2–5 and 6+) | 490,135 | **490,292** | +157 |
| of those, closable by `<source>.<target>` | 296,854 | **296,855** | +1 |
| targets binding to nothing | 144,032 | **143,833** | −199 |
| of those, `unexplained` | 1,829 | **1,817** | −12 |
| `overrides` both-ends repoFull | 230,467 93.0% | **230,505 93.0%** | +38 |
| `overrides` target unique | 232,736 | **232,774** | +38 |

**The mechanism is in shared code this lane does not own, and it is not a change to
this analyzer.** `src/ast/real-dart-analyzer.ts` is byte-identical across the two
trees — `git diff c48f381d1..origin/analyzers/ontology-laptop-b` over it is empty —
and the edge count being identical is the proof that the analyzer's output did not
move. What moved is `src/ast/pool-worker.ts` (+102 lines), which sits on the
production `parseFile` path this lane measures through. Its universal symbol-name
denylist was **split**: names that are only reserved in *some* languages moved out of
the unconditional drop list into a per-language RESERVED set. Seven were removed, each
with another lane's measurement behind it — `self`, `Self`, `me`, `My`, `destructor`,
`root`, `program`, `source_file`, `unknown`. **Every one of those is a legal Dart
identifier**, so a Dart declaration carrying one of those names used to be silently
dropped from the symbol table and is now published. That is the +104 symbols, and the
74 of them named literally `unknown` account for most of the movement: a target called
`unknown` used to bind to nothing and now binds, which moves rows out of
`tgtNoSymbol` (−199) and out of `unexplained` (−12), and rows that now bind to a
published `unknown` in more than one place move into the ambiguous set (+157).

Two consequences worth stating rather than leaving implicit:

- **`symbolsNamedUnknown` is no longer 0 for this lane, and 0 was the wrong thing for
  it to be.** Dart permits `unknown` as a declaration name; publishing it is correct
  and dropping it was the bug the base fixed. The lane's own hard criteria still hold
  where they matter — `emptySymbolNames` 0, `emptyOrUnknownKind` 0 and
  `unknownEndpoints` 0 on both the 2,735-file and the 4,788-file sample — and "no
  `unknown` ENDPOINT" is unaffected, because a legitimately-named `unknown` symbol is
  not an unresolved target.
- **The base merge also fixed the WASM cache collision** (`src/ast/engine.ts`, a
  per-process cache path plus an atomic rename, from the zig lane). That is why every
  run in this pass reports `degraded 0`: the concurrent-truncation path that
  substituted a regex extractor is gone from this tree. It does not affect any count
  above — the 67 excluded fallback edges and the 4 `>1 MB` structural fallbacks are
  size-based and identical in both trees.

A reader comparing this section against a re-run should expect small positive deltas
in every resolution column until the figures are re-pinned to the current base, and
should treat the pinned values as a record of one tree rather than as this lane's
present state.

Ambiguity is measured as a SET SIZE — how many distinct `kind|owner|file`
declarations share the target's name — because a `Set<string>` of names cannot
answer the question it is being asked: it collapses the collision it exists to
detect.

| Type | ambiguous targets | closable by the edge's own `<source>.<target>` |
| --- | --- | --- |
| contains | 296,726 | **296,726 (100.0%)** |
| uses | 138,700 | 128 (0.09%) |
| calls | 46,127 | 0 |
| instantiates | 3,663 | 0 |
| references | 3,325 | 0 |
| extends | 779 | 0 |
| overrides | 607 | 0 (already qualified at both ends) |
| implements | 208 | 0 |
| imports / exports | 0 | n/a — targets are module URIs |
| **total** | **490,135** | **296,854 (60.6%)** |

**An 8-file sample reads 0 ambiguous targets, and that is not a contradiction.**
`script/m14/incoming-check.ts dart <8 files>` — the supervisor's instrument, run on 8
real files from `flutter-packages/packages/video_player/video_player_avfoundation` and
`dart-http/pkgs/cronet_http` — reports 274 symbols, 149 distinct declarations named by
at least one edge, and `target names resolving to >1 published symbol : 0`. Ambiguity is
a COLLISION count: it is a property of the symbol table's size and name variety, and 274
symbols drawn from two packages that mostly call into the Flutter SDK collide far less
than 337,336 symbols drawn from five repositories do. So the same lane reads 0 at n=8
and 490,135 at n=4,788, and quoting the 8-file figure as the lane's ambiguity rate
would understate it by five orders of magnitude. The 4,788-file table is the one to
quote; the 8-file run is a shape check, and it is a useful one — it confirms 0 parse
failures, 0 degraded parses, all TEN types firing, and 1 orphan of 274 symbols.

**That 0 is a property of those 8 files, not of small samples, and a different small
sample reads non-zero.** Re-running the same instrument over 7 files — the two packages'
`lib/` trees rather than their examples, including `jni_bindings.dart`, which alone
publishes ~1,000 symbols — gives **1,427 symbols, 876 distinct declarations named by at
least one edge, and 14 ambiguous targets**, against 274 / 149 / 0 for the recorded run:

| ambiguous target | collides as |
| --- | --- |
| `CronetException`, `NetworkException`, `QuicException`, `CallbackException`, `CronetEngine` | class, extension |
| `builder`, `immediatelyRetryable`, `wasCached` | property, method |
| 6 more | |

Orphans move the same way: 22 of 1,427 against 1 of 274. The doc's mechanism sentence
above already names the right variable — ambiguity tracks the SYMBOL TABLE's size and
name variety, not the file count — and this pair is the evidence for it: 5.2× the
symbols turns a 0 into 14. So the honest form is **"at 274 symbols, 0"**, and a reader
holding a small file set should expect its own number rather than this one.

**The tenth pass re-ran this exact 7-file set twice on this tree and reads four of those
cells differently, in both runs identically: 1,429 symbols, 860 distinct declarations
named by an edge, 13 ambiguous targets, 20 orphans of 1,429** — against the recorded
1,427 / 876 / 14 / 22. Two runs agreeing with each other and disagreeing with the
recorded row means the recorded row is a reading of an earlier tree, not a flaky
measurement. The first five ambiguous names and their collision shapes are reproduced
exactly and in the same order (`CronetException`, `NetworkException`,
`immediatelyRetryable`, `wasCached`, `QuicException`, `CallbackException`,
`CronetEngine`, `useBuiltInDnsResolver`), plus 5 more; `useBuiltInDnsResolver` is listed
as `method, property` where the table above groups it with the property/method pairs
unordered. The eighth-collision name `builder` from the recorded run does not appear in
either current run's printed list. **The argument the pair supports is unchanged and is
the one that matters: 1,429 symbols reads 13 ambiguous, and 274 symbols reads 0.** The
per-cell absolutes are superseded, and the recorded row is left in place rather than
overwritten for the reason the eighth pass gave — a superseded row plus a delta is a
record two trees can both be read against.

**`contains` is closed, and that is arithmetic rather than luck.** The edge publishes
the OWNER on the source side and the bare member on the target side, so
`<source>.<target>` is a published spelling for every one of the 296,726 — a consumer
that binds `contains` by (owner, member) has zero ambiguity over 95.4% of the
label's rows, which is the largest single-label population in the lane (310,925,
32.4% of all edges).

**The rest is irreducible in Dart, and the count is the answer rather than an
apology.** `obj.method()` reduces to the leaf `method`; the receiver's static type
is discarded at emission, so `add` is `List.add` and `Set.add` and
`StreamSubscription.add` with nothing on the edge to separate them. Recovering the
receiver type is a type-inference problem this analyzer does not attempt, and
inventing a target from a name shape is exactly the fabrication the workstream's
rule forbids. `uses` has a measured 128 rows where it happens to work anyway, and
they are counted rather than rounded up to the type.

### Targets that bind to nothing: 144,032 rows, split by cause

Because "external" and "never indexed" are opposite findings that a single count
conflates, every no-symbol target is filed under a POSITIVE test, in funnel order.

| Bucket | rows | what the test is |
| --- | --- | --- |
| `uriEndpoint` | 22,909 | an `imports`/`exports` target — a module path, which is not a bindable name by design (`package:flutter/material.dart:*`, `../core.dart`) |
| `localNotPublished` | 25,730 | the row carries `isLocalRead`, or is an `imports`/`exports` URI: a BINDING the family contract publishes no symbol for (DARTD8). freezed's generated `map`/`maybeMap` takes the mapping function as a formal parameter named `$default` and calls it, so `calls -> $default` is a real invocation of a parameter |
| `sdkDeclared` | 12,281 | the name is published by one of the **479 real `.dart` files under `dart-sdk/sdk/lib`**, parsed through the same production entry point — not a hand-written builtin list, which would be a second and drifting definition of the same thing |
| `packageDeclared` | 79,743 | the file's TRANSITIVE import graph reaches a `package:`/`dart:` URI and the name is in neither the repository nor the SDK |
| `outsideSample` | 1,540 | the row comes from a strided repository, so absence proves nothing in either direction; counted apart and never in the defect bucket |
| `unexplained` | **1,829** | none of the above, in a FULL-scope repository: the class that would be a defect |

**The transitive import closure is load-bearing and was a real bug.** Dart's barrel
convention routes a library's dependencies through one relative `export`, so
`riverpod/packages/flutter_riverpod/lib/src/core/consumer.dart` declares exactly ONE
import — `../core.dart` — and reaches `package:flutter/widgets.dart` through it. A
file-local test therefore files every barrel-imported supertype as a defect. The
closure follows 10,511 relative hops and finds a package URI reachable from 87.4% of
files. Its first implementation looked each hop up under a `repo|rel` key while the
import table was keyed `repo/rel`; every lookup missed, the closure was one hop deep,
and the entire `packageDeclared` population came out **byte-identical to the run
before the fix**. Identical numbers across a change are how that was caught.

### The defect this measurement found, and what it cost

**`overrides` named members that do not exist.** Dart's `Object` is the root of every
class interface, so `toString`, `hashCode`, `runtimeType`, `noSuchMethod` and
`operator ==` are reachable from every type in the language — which makes `Object`
the one override target a per-file analyzer can name without the base's own file,
and the first-heritage-parent fallback was not using it.

```dart
class ProtocolException implements Exception {
  @override String toString() => 'protocol';
}
```

published `ProtocolException.toString -> Exception.toString`. `Exception` declares
no `toString`: `dart-sdk/sdk/lib/core/exceptions.dart` publishes 17 symbols through
the production entry point and `Exception.toString` is not one of them. The edge
asserted a declaration where there is none.

| | `overrides` rows | unexplained | SDK-declared target | resolves repoFull |
| --- | --- | --- | --- | --- |
| before | 247,737 | 2,422 (0.98%) | 51 | 230,666 93.1% |
| after | 247,737 | 1,670 (0.67%) | 1,167 | 230,467 93.0% |
| **all ten types, before** | 960,634 | **2,862 (0.298%)** | | |
| **all ten types, after** | 960,634 | **1,829 (0.190%)** | | |

Repo-scope resolution for `overrides` goes DOWN 199 rows and that is the honest
direction of the trade: `Object` is not declared in these three repositories, so a
consumer whose index stops at the project boundary binds 199 fewer rows. A consumer
that also indexes `dart:core` binds **1,167 more**, because every one of those
targets is a declaration the Dart SDK publishes. The retarget records the name it
discarded in `metadata.firstHeritageParent`, so no information is lost, and tags the
row `isObjectInterfaceBase`.

**What the retarget gives up, stated rather than argued away.** If an out-of-run base
DOES declare the member, `Base.toString` was the nearest correct target and
`Object.toString` is one hop further up. The two cases are indistinguishable without
the base's file. The rule prefers naming a declaration that provably exists over one
that may not — the same preference the rest of that pass already makes when it
refuses a refuted fallback — and it is scoped to those five members, so an in-file
resolution (Pass 1, confidence 0.95) and a refuted fallback are both untouched.

### The residual 1,829, and what it actually is

| Type | unexplained | distinct targets | dominant shape |
| --- | --- | --- | --- |
| overrides | 1,670 | 140 | `$FunctionalProvider.debugGetCreateSourceHash` 836, `$NotifierProvider.debugGetCreateSourceHash` 175, `$NotifierProvider.create` 175, `$Notifier.runBuild` 175 |
| uses | 73 | 38 | `FirstT` 10, `SecondT` 10, `DiagnosticableTreeMixin` 9, `snake` 4, `$2` 3 |
| instantiates | 41 | 4 | `EqualUnmodifiableListView` 20, `DeepCollectionEquality` 18 |
| calls | 35 | 10 | `root` 12, `fromMicrosecondsSinceEpoch` 6, `$enumDecodeNullable` 6 |
| implements | 9 | 1 | `DiagnosticableTreeMixin` 9 |
| extends | 1 | 1 | `GeneralizingAstVisitor` 1 |
| contains / imports / references / exports | 0 | — | — |

**The dominant shape is a CORPUS GAP, not an analyzer defect, and the distinction is
measured.** riverpod 3's `$FunctionalProvider` / `$NotifierProvider` / `$Notifier` /
`$AsyncNotifier` are GENERATED declarations — 1,502 of the 1,670 `overrides` rows
(89.9%) name a base whose spelling begins with `$`, and `grep -rl 'FunctionalProvider'
--include=*.dart` over the whole riverpod checkout returns nothing while the
SUBCLASSES that extend them are present. So those rows name a declaration this
checkout does not contain. That is the third thing the "never indexed" bucket has to
hold apart from "external", and it is a property of the corpus, not of the analyzer:
sampling is `git ls-files`, which sees tracked files only, and these are not tracked.

The remaining shapes are named limitations rather than defects, each with its count:
`DiagnosticableTreeMixin` / `GeneralizingAstVisitor` are `package:analyzer` types
reached through a barrel the closure cannot leave; `DeepCollectionEquality` and
`EqualUnmodifiableListView` are `package:collection`; `FirstT`/`SecondT` are
freezed's generic parameters read as values; `$2` is a Dart 3 RECORD positional
field (`($1, $2).$2`), whose accessor the analyzer does not synthesize because no
declaration names it.

### 67 edges that are not the analyzer's

`src/ast/pool-worker.ts` routes a file over 1 MB to `extractFallback`, a **regex**
extractor, whose rows carry `metadata.method === "regex"` and sit at confidence
0.4/0.5 and whose symbols carry no `kind`. Counting those as analyzer output is how a
lane quotes a resolution rate for edges no analyzer produced. This census tallies
them apart and excludes them from every analyzer column: **67 `calls` rows across 4
files**, of which 20 are in one file, `native_cupertino_bindings.dart` (1.4 MB).

Among them is a fabrication worth naming, and it is in shared machinery:
`extractBasicRelationships` matched the **declaration**
`extension type NSCachedURLResponse._(objc.ObjCObject object$)` with its
`obj.method(` pattern and published `calls NSCachedURLResponse -> _` at 0.4 — a call
to a symbol named `_`, for a constructor invocation that is a declaration. The same
row appears 12 times over (`NSLocking`, `NSOperation`, `NSProgressReporting`, …).
Reported in §Shared-machinery needs; not edited here.

### Module targets: external vs unpublished

The incoming table above reports `imports` and `exports` at **0 resolved and 100%
binding to nothing**, and declared limitation 12 explained that as "paths, not
declarations". That explanation is named for two examples — `dart:core` and
`package:flutter/material.dart` — and **the examples are not the population.**
`package:http/http.dart` names a file that is in this corpus, at
`dart-http/pkgs/http/lib/http.dart`. A target that names a file this checkout tracks
and still binds to nothing is not external; it is an unpublished local file, and the
workstream's incoming brief requires the two to be counted apart because "these look
identical in a count and are opposite findings".

`validation/m14/fixtures/dart/module-target-resolution.ts` resolves every module target
against the corpus's own file tree. Package identity comes from the FILE SYSTEM, not
from the path: every tracked `.dart` file is attributed to its nearest ancestor holding a
`pubspec.yaml`, which is what lets a monorepo's `pkgs/http/lib/http.dart` answer to
`package:http/http.dart`. The index is built over the FULL tracked set, not the stride
sample — a stride would answer "not in my sample" for a file that is present, which is
the ambiguity being removed. The population is the analyzer's own emitted targets, read
off the relationship list, so it is the analyzer's edges and not a re-derivation.

```
2,735 files sampled (the census's own stride: 600/repo x 4 + all 335 of dart-http)
7,849 tracked .dart files attributed to a pubspec package
275 distinct package NAMES, 2 of them held by more than one package directory
4 degraded (>1 MB, to the fallback) — their targets are excluded, not counted
module targets emitted: 10,959   = imports 10,657 + exports 302, to the row
```

| bucket | rows | share | what it is |
| --- | --- | --- | --- |
| `inCorpus` | **7,203** | **65.7%** | names a `.dart` file this checkout tracks — an UNPUBLISHED local file |
| `frameworkSdk` | 1,327 | 12.1% | `package:flutter/…`, `flutter_test`, `sky_engine` — not in this corpus, not clonable from it |
| `transitive` | 1,452 | 13.2% | a package or file this checkout does not track — a corpus property |
| `sdk` | 977 | 8.9% | `dart:` URIs — no corpus checkout contains them, ever |

`transitive` splits by cause, because the remedies differ: **1,396 name a package this
corpus never cloned** (`package:firebase_core`, `package:equatable`, `package:intl`) and
**56 name a file inside a package that IS present but untracked** — generated output,
or a path the checkout does not carry. So **34.3% is genuinely unreachable and 65.7%
is not**, and the number that was quoted as "100% by design" was wrong on the majority.

**Both ends are unbindable, and that is the part that is not a URI problem.** The
`imports` SOURCE is `moduleName` — `path.basename` without extension
(`real-dart-analyzer.ts:251`), so `client.dart` is `client` — and the analyzer publishes
no symbol for the file itself. Measured: `client.dart` publishes 13 symbols
(`Client`, `Client.constructor`, `Client.head` … `runWithClient`, `zoneClient`) and
**nothing named `client`**. The arbiter sees this from the other side and reports
`imports` at `sourcePublished 6, sourceExternal 374, bothEndsResolve 0` on its
120-file dart-http draw. An edge from an unpublished file name to an unresolvable URI is
one-directional at both ends, which is why this label reads 100% in every resolution
column rather than merely resolving poorly.

Closing it needs two changes and **neither is lane-local**:

1. **A published `Module` symbol per file**, named `moduleName`. `SymbolKind.Module`
   already exists (`src/ast/types.ts:25`) and no Dart analyzer emits it — `grep -c
   "SymbolKind.Module" src/ast/real-dart-analyzer.ts` is 0. This would also make the
   file-level SOURCE of every top-level `calls`/`uses` row resolve, which currently
   does not.
2. **A URI→module-name map.** `ProjectIndex` (`src/ast/project-index.ts:66-79`) is
   name-keyed — `typeKinds`, `typeMembers`, `typeBases`, `symbolNames`, `damagedFiles` —
   and carries **no file path and no module URI**, so nothing in the index can answer
   "which file does `package:proxicall/core/supabase_config.dart` name". `references`
   resolves through `typeKinds` because a type mention is already a bare name; a module
   URI is not.

Reported as item 21; not made here, because (1) changes this lane's symbol population
and every resolution rate in the tables above, and (2) is `src/ast/`, which this lane
does not own. **No edge was invented to make the number look better.**

Reproduce:

```bash
BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/module-target-resolution.ts
# -> the 7,203 / 1,327 / 1,452 / 977 split, and the 1,396 + 56 transitive causes
```

### Four defects in this lane's own harnesses

Each was found by a number that did not move when it should have, which is the only
instrument that finds this class.

1. `incoming-census.ts` resolved scope, ambiguity and the no-symbol buckets INSIDE
   the walk, against a symbol table still being filled.
   `pkgs/http2/lib/src/flowcontrol/window_handler.dart` sorts before
   `pkgs/http2/lib/src/sync_errors.dart`, so `processWindowUpdate ->
   FlowControlException` was filed `unexplained` for a class declared 200 lines away
   in the same FULL repository. All cross-file work is now a settled second phase, so
   two runs give the same numbers regardless of scheduling.
2. The import closure's key mismatch, above — byte-identical output across a change.
3. `census.ts` incremented `tgtSample` under `if (tgtOk)`, so the column reprinted
   the in-file rate under a sample-scope heading (`references 857 840/857 98.0%
   857/857 100.0% 840/857 98.0%` — the middle number should have been the sample
   rate and was the in-file count again), and `bothSample` was order-dependent
   against a growing set. Both moved to the settled phase.
4. `census.ts` added the qualified `owner.name` spelling to the per-file table but
   never to the sample or repo tables. `overrides` is qualified at BOTH ends, so it
   read **0/7,566 in-sample** on a sample that plainly contained the declaring class.
   The column was measuring the absence of a spelling, not the absence of a symbol.

### What the incoming pass changed, and what it did not

- Unresolvable is down from 2,862 to 1,829 rows, 0.298% to 0.190% of 960,634.
- `references` and `contains` bind to nothing at all: **0 rows each**.
- `imports` and `exports` bind to nothing by DESIGN (a URI is not a symbol), and
  that is now stated as a design with 22,909 rows behind it rather than left to be
  discovered downstream as a 0.0% column.
- Heuristic ratio (confidence < 0.7): `uses` 25,464 of 226,095 (11.26%), all the
  bare-read surface at 0.6. **Every other type is 0.00%**, and `calls` moved to 0
  because the sub-0.7 rows it inherited are now counted under `isLocalRead`.
- NOT fixed, and declared: the leaf-name reduction for `calls`/`uses` (490,135
  ambiguous targets in total, of which 296,726 are `contains` rows the edge already
  disambiguates and 193,409 are not closable by any spelling the analyzer emits,
  save the 128 `uses` rows where `<source>.<target>` happens to be published), the
  corpus's untracked generated declarations (1,502 rows), and record-type field
  accessors (`$1`/`$2`).

## Two suppressed-edge defects the ninth pass found, and why neither is fixed here

Both are **true edges the production path does not deliver**. They were found by a
measurement that had not been made before — `validation/m14/fixtures/dart/r7-suppression-cost.ts`,
which compares the member symbols `parseFile` PUBLISHED against the `contains` edges it
published and files the difference by the missing target's name. Over the census's own
2,735-file sample (2,731 parsed, 0 parse failures) it reports **31 suppressed (owner,
member) pairs in exactly 5 distinct names**, and the two defects below account for all 31 —
the probe prints its own residual and it reads 0:

```
19  unknown                  R7's name test, in the analyzer            (defect 1)
 3  operator <
 3  operator >
 3  operator <=
 3  operator >=               the pipeline's angle-bracket leaf ban      (defect 2)
```

Neither is a naming preference and neither is a coverage number that was merely
unflattering: in both cases the analyzer emits a correct edge and something downstream
deletes it. The instrument is committed so both readings are re-runnable:

```bash
BB_DART_PER_REPO=600 BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/r7-suppression-cost.ts
# -> "31 suppressed pairs", "OF WHICH the literal \"unknown\": 19 suppressed pairs",
#    "Residual after both named causes: 0 pairs"
```

**A correction to an earlier reading of this probe, recorded because the wrong number was
nearly published.** A first version of the file drew its sample with `Math.ceil` where
`census.ts` draws with `Math.floor` (`census.ts:102`), so it sampled **2,531 files where the
census samples 2,735** — riverpod alone contributed 432 files instead of 600. Every other
instrument in this file uses the census sample, so its rates were not comparable with the
figures it is being compared to, and it reported **45 suppressed pairs** (24 `unknown`,
21 angle-bracket operators, 8 distinct names) over a sample that was not this one. The stride
now matches `census.ts` exactly and the population is the one every other number here is
drawn from. The two figures are not two estimates of one quantity: they are two different
file sets, and the 45 is withdrawn rather than averaged.

**A second revision was wrong in a way worth recording, because the shape of the mistake is
the shape this project's work exists to catch.** While re-drawing, the probe was also
tidied to exclude `enum_member` and `property` from the member tally. Every `unknown` member
in the corpus is one of those two kinds, so the exclusion removed exactly the rows carrying
the defect-1 finding and that finding then read **0 on a sample where it is not 0**. A
measurement whose filter removes the effect it is looking for is not a measurement. The
exclusion is reverted, and `Residual after both named causes` exists precisely so that a
future tidy that hides a cause shows up as a non-zero residual instead of as a clean zero.

### Defect 1 — R7's test is a NAME, and `unknown` is a legal Dart identifier

`src/ast/real-dart-analyzer.ts:665` drops any row whose source or target is the literal
string `unknown`. The justification in `R7_PLACEHOLDER_NAME` (line 138) rested on a
measurement that has since stopped being true:

> `symbolsNamedUnknown 0` in both AFTER runs: no sampled file publishes a symbol named
> `unknown`, because `src/ast/pool-worker.ts` `keepSymbol`'s UNIVERSAL denylist rejects
> the name for every language. So every one of those rows was an endpoint NOTHING COULD
> BIND.

`src/ast/pool-worker.ts` split that denylist, and Dart declarations named `unknown` are
now PUBLISHED — this lane measures `symbolsNamedUnknown 74` over 4,788 files and 20 over
the census sample, in 22 sampled files. So the name test can no longer tell the pipeline's
"nothing truthful to say" sentinel from a declaration a program actually makes, and it
deletes the second. `proxicall/lib/l10n/generated/app_localizations_bn.dart:304` declares
`String get unknown => 'অজানা';`, the analyzer publishes the symbol, and no `contains` edge
reaches it.

**The differential found this without being told.** At rotation 81 the truth derivation
published `contains AppLocalizationsBn -> unknown`, the analyzer published the symbol and
no edge, and the row landed in MISSING — the only non-`overrides` row in that run's capped
12-row sample, which also falsifies the standing claim in this file that "all 12 printed
rows are `overrides`".

The fix was implemented and measured, then **reverted**, and the reason is the finding
rather than a technical objection. Narrowing the test to "does this file DECLARE a symbol
named `unknown`" — the discriminator `filterNoiseRelationships` already applies to
`NOISE_TARGETS` for exactly this reason — was measured over the same withdrawn 2,531-file
draw, where it admits **40 rows**: 24 `contains` edges naming a real declaration and 16
`uses` edges that are genuine reads of an in-file enum constant (`InvitationError.unknown`
at `invitation_cubit.dart:367` and seven siblings, `AuthError.unknown` at
`auth_models.dart:716`, `FmsLimitPeriod.unknown` at `fms_enums.dart:134`,
`MmsReportStatus.unknown`). **The `contains` component of that split is withdrawn**: on the
census sample the suppressed `unknown` pairs number **19**, not 24, for the sampling reason
given above, and the 16 `uses` rows have not been re-counted on the corrected draw, so
their number stands as measured on 2,531 files rather than as a census-sample figure. What
does not move is the shape — the effect is a dozen-plus suppressed `contains` edges plus a
handful of real `uses` reads, and it is not 40 in any case.

The differential comparison is **unaffected**, because the differential draws its own
sample and is unaffected by this fixture's stride: at a FIXED draw (hash `ab7eff6c5dba53fa`,
before and after) the narrowed test gives `covered 17196 → 17200`, `MISSING 11935 → 11931`,
`unexplained 0` on both — the oracle corroborates the recovered rows and contradicts none
of them.

It was reverted because the census then reports **`unknownEndpoints 0 → 32`** on that draw,
and "no
`unknown` endpoints" is this lane's stated hard criterion. The conflict is structural, not
a bug in either half: **the pipeline's "no target" sentinel is a string that Dart can
legally use as an identifier**, so a `contains` edge for a member named `unknown` cannot
both be true and keep the metric at zero. Recovering 24 edges on a 403,674-edge graph is
not worth silently moving an advertised criterion, and the decision belongs to the
supervisor rather than to the lane that reports the criterion. §Shared-machinery item 19
states the two ways out.

### Defect 2 — the pipeline deletes every angle-bracket operator, and ignores the declaration test it applies 30 lines later

This one is not in this lane's file at all. `RealDartAnalyzer.analyze` called directly on
`flutter-packages/packages/rfw/lib/src/dart/model.dart` publishes **11** member symbols for
`SourceLocation` and **11** `contains` edges, including `operator <`, `operator >`,
`operator <=` and `operator >=`. Production `parseFile` returns the symbols and **7** edges
— the four angle-bracket operators are gone.

The cause is one term in `src/ast/pool-worker.ts`, `filterNoiseRelationships` (line 655):

```ts
if (/[{}`<>\n\r\t]/.test(leaf)) return false
```

Measured directly against that exported function, with `declaredNames` supplied:

```
DROPPED  SourceLocation -[contains]-> "operator <"     DROPPED  Foo -[uses]-> "<div>"
DROPPED  SourceLocation -[contains]-> "operator >"     KEPT     Foo -[uses]-> "Bar"
DROPPED  SourceLocation -[contains]-> "operator <="    KEPT     SourceLocation -[contains]-> "operator =="
DROPPED  SourceLocation -[contains]-> "operator >>"    KEPT     SourceLocation -[contains]-> "operator +"
```

Two things follow. The ban exists to block markup-shaped garbage and it is right to keep
that (`<div>` is correctly dropped). But it has **no `declaredNames` exemption**, while the
`NOISE_TARGETS` test 30 lines below has one and explains why: "The discriminator is
DECLARATION, and it is the right one — an analyzer that accidentally emits `node.type`
emits a name the file never declares, while a variable the file declares is a real node in
the graph." An operator member is a declaration, so the same discriminator applies and this
term is the one place in the function that does not use it.

The asymmetry also explains why the defect survived eight passes of verification: **every
operator token without an angle bracket survives**. `operator ==`, `operator +`, `-`, `/`,
`*`, `%` all pass; `<`, `>`, `<=`, `>=`, `<<`, `>>`, `>>>` do not. A spot check reads
"operators work" and is wrong seven times out of fourteen.

**This also puts the lane's own operator-naming contract out of reach through the
production path.** *Member naming: operators are a lane contract* publishes an operator as
`operator <token>` because `operator_signature` has no name field and the bare token is not
a legal identifier. That contract is implemented correctly by the analyzer and independently
by `script/m14/oracles/dart-contains.ts`, and it is **unenforceable** for the seven
angle-bracket tokens, because the pipeline deletes any edge whose target contains one. The
contract is cross-language — the same shape kotlin's phantom members use — so changing the
synthesized spelling is a family decision and not this lane's to make alone. §Shared-machinery
item 20 states both options.

Both defects were found by asking a question the lane had never asked: not "does the
analyzer emit the edge" — it emits both — but "does the edge survive the trip to the index".
That is the same gap the CSS lane's `known-zeros` finding named, and the census's own
`unknownEndpoints 0` was reading the analyzer's output rather than the pipeline's, which is
how a filter that deletes true edges can report a clean zero.

## Declared limitations

A blank list on a general-purpose language is treated as dishonesty, not as
excellence. This is not blank, and the entries are ordered by how much they could
mislead a reader of the graph.

1. **95.43% of Dart's type mentions are deliberately unread.** `references` gates
   on the mentioned type being visible to the run, and production supplies no
   project index for `.dart` (`parallel-indexer.ts` `PROJECT_INDEX_EXTENSIONS`
   names only `.sol`), so the published set is file-local. Every fact in this
   document about `references` volume is therefore a LOWER bound on what the
   language expresses, stated as a lower bound rather than as the whole.
2. **Cross-file type dependency is not published, so `bb_impact` cannot answer
   "who depends on this type" for a project.** The label answers the intra-library
   question. A run with an index answers more, and every row records which of the
   two answers it is (`isIndexResolved`).
3. **A self-type mention is not published.** `class A { final A? next; }` names
   `A` inside `A`, and the source and target are then the same symbol, so nothing
   is published. Measured cost: unmeasured on the corpus (the guard fires rarely
   enough that it did not appear in the sample's top rows), and the case is pinned
   by a fixture instead.
4. **A field's type mention folds to the owning class, not to the field.** The
   lane's DARTD9 convention, applied consistently here for the first time to a
   type position. So `class A { final B b; }` publishes `A references B`, and the
   edge from the FIELD itself is absent. A reader wanting per-field type
   dependencies is not served by this label.
5. **`dynamic` is filtered as a type mention.** It is the absence of a type, not a
   dependency, and it is the most common type position in idiomatic Dart after
   `var`. Every untyped declaration therefore contributes no `references` row.
6. **Cross-file named constructors still publish a leaf `calls` edge.** DT-A's
   rule — an unknown cross-file `X.y()` stays a leaf call — predates this wave and
   is unchanged, so `RemoteFailure.parsing(raw)` publishes `calls load -> parsing`
   where `parsing` resolves to nothing (constructors are published as `constructor`
   and the named segment lives in metadata). The R7 filter removes the same shape
   only when the segment is the literal `unknown`; the general case is a declared
   limitation, pinned as it stands by `dart/unknown-endpoint-r7` so a future change
   to it is deliberate rather than a side effect.
7. **The `references` oracle agrees with the analyzer by construction on the rule,
   and independently on the implementation.** Both were written from the same
   MEASURED position inventory, so agreement is evidence that two implementations of
   one rule do not diverge — not that the rule is right. A defect in the inventory
   would be shared. The fixtures carry that argument and they were authored from
   the language before the analyzer run.
8. **Files over 1 MB never reach this analyzer.** `parseFile` routes them to the
   pool worker's structural extractor, which publishes `{name, type, startLine,
   endLine}` symbols with no `kind` and no relationships at all. Measured on the
   sample: 4 of the 2,735 files, carrying 1,068 fallback symbols between them (and
   1 more file over the 5 MB skip limit, which is never parsed at all). A census
   that counts symbol kinds across such files is measuring the fallback; this
   lane's census counts and reports them apart.
9. **Parse damage inside an `ERROR` region publishes nothing.** 35 of the 2,735
   sampled files carried ERROR nodes — 580 parse errors between them, 1.28% of the
   sample — and a type mention inside a damaged region is not a fact about a
   well-formed program. The earlier figure quoted here (11 of 1,000 files, 88 errors)
   was measured on a 1,000-file run and understated the rate by an order of
   magnitude; the 2,735-file figure is the one the rest of this document uses.
10. **`bb`-visible cross-file `overrides` and `references` are unaudited by the
    differential** (DERIVATION, above). Both have oracles and batteries; neither is
    wired into the harness's comparison.
11. **A receiver's static type is discarded, so `calls` and `uses` targets are leaf
    names and are irreducibly ambiguous.** `obj.method()` publishes `method`; 46,127
    `calls` targets and 138,700 `uses` targets match two or more published symbols
    and 193,409 of them cannot be disambiguated by any spelling the analyzer emits.
    Recovering the receiver type is type inference this analyzer does not attempt,
    and inventing a target from a name shape is the fabrication the workstream's
    rule forbids. Measured, not estimated — see §The incoming direction.
12. **`imports` and `exports` targets are module URIs, and 65.7% of them name a file
    this corpus checkout tracks.** The targets bind to no symbol, and the reason is
    structural rather than final — see *Module targets: external vs unpublished* below
    for the measured split. 10,959 rows on the 2,735-file census population, 22,909 on
    the 4,788-file incoming population, 100% of both labels in both. The M49 exports
    invariant deliberately keeps an exported FILE out of the bindable export list, and
    the `${uri}:*` module-leaf spelling is a cross-lane convention (`@vue/shared:*`,
    `./extra.js:*`), not this lane's to change. A reader looking for a resolved import
    target will find none and should read the URI.
13. **A Dart 3 record's positional field accessor is not synthesized.** `($1, $2).$2`
    is a real read of a field no declaration names, so it publishes `uses -> $2`
    with nothing to bind. Measured at 3 rows in the census above; the shape recurs in
    every record-heavy file.
14. **An external base's members are unverifiable without the base's own file.**
    13,160 of 247,737 `overrides` rows are the `isExternalBase` fallback at 0.8, and
    11,396 of those still name a type declared outside the repository. The
    `Object`-interface retarget (§The incoming direction) closed the 1,117 rows that
    named a member provably absent from their base; it cannot close the rest, and a
    base in another package that declares the member itself is indistinguishable
    from one that inherits it.
15. **1,502 `overrides` rows name generated declarations this corpus checkout does
    not contain.** riverpod 3's `$FunctionalProvider` family is absent from
    `git ls-files` output while its subclasses are present. This is a corpus
    property — a `--filter=blob:none` clone plus untracked generated output — and it
    is counted apart from both "external" and "never indexed" precisely because a
    reader who filed it as either would be wrong twice.

## Shared-machinery needs (reported, not edited)

Twenty-two changes outside this lane's ownership, each stated so it can be applied
without re-deriving it. The files are supervisor-owned per
`docs/analyzers/ONTOLOGY-WORKSTREAM.md` §Ownership. Items 1–5 predate this pass;
6–8 come from measuring the incoming direction, 9–10 from removing this lane's
regexes, 11 from re-running the M60 gate to reproduce the DERIVATION count,
12 from running the doc-truth-emissions gate over this lane's table, 13–14 from
re-running the same gates and watching what they wrote to disk, 15 from
reading `firing-check.ts --json` and finding `files` is per-file, not per-type,
16 from comparing the label this analyzer writes against the enum member that names it,
and 17 from running the mutation gate the way the lane prompt documents it.
Item 22 is new at this pass and is the only one with a measured majority behind it:
65.7% of this lane's module targets name a file the corpus tracks, so the "100%
unresolved by design" limitation was wrong on the majority.
Item 13 was rewritten during the final pass: it first named one gate and now names
ten, because running the documented `npx tsx` invocation over the whole directory
showed the failure is the directory's, not one script's. Item 18 comes from reading
`ontology-coverage-gate.ts` for item 1 and finding the corpus walk is a top-level
`await` above *both* of its exits, which makes `--coverage` — documented as parsing
nothing — parse the whole corpus.

1. **`script/m14/ontology-coverage-gate.ts` — add a `dart` entry to
   `RULED_BY_LANG` (line ~183: `const RULED_BY_LANG: Record<string, Ruled[]> = {
   bash: BASH_RULED, json: JSON_RULED }`).** What it must do: accept an EMPTY
   ruling table for a lane that emits all ten types. Why: the gate currently exits 2
   with "no RULING TABLE for dart" BEFORE its verdict loop, so it prints no table at
   all for a lane with nothing to rule — which is this lane. The refusal is
   right for a lane with a non-emitting type and wrong for one that emits 10/10, and
   the check has no way to tell them apart because it runs before the observation.
   The condition should be `RULED_BY_LANG[LANG] === undefined && LANG !== "dart"`,
   or better: move the refusal after the observation and refuse only when some type
   is neither observed nor ruled. With that one term, this lane's arbiter run prints
   `emitted 10/10` and exits 0. **But fixing that term is not sufficient at full
   corpus scale, and the reason is the first half of item 5.**

   **The exit-2 refusal is verified by reading the gate, not by running it at full
   corpus — because the full-corpus run never reaches it.** Measured eight times on
   this
   branch, `npx tsx script/m14/ontology-coverage-gate.ts dart`:

   ```
   run 1:  corpus: 33692 admitted files
           [BB-PARSE-ERR] dart | dart-sdk/.../flow_analysis_log.dart | memory access out of bounds
           [BB-HANG] parser stuck 120s on dart-sdk/.../flow_analysis_log.dart — exiting
           exit 1

   run 2:  corpus: 33692 admitted files
           [BB-PARSE-ERR] dart | dart-sdk/.../list_postfix_completion_templates_test.dart | memory access out of bounds
           [BB-PARSE-ERR] dart | dart-sdk/.../import_elements_test.dart | memory access out of bounds
           [BB-PARSE-ERR] dart | dart-sdk/.../is_postfix_completion_applicable_test.dart | memory access out of bounds
           [BB-PARSE-ERR] dart | dart-sdk/.../document_color_test.dart | memory access out of bounds
           [BB-HANG] parser stuck 120s on dart-sdk/.../list_postfix_completion_templates_test.dart — exiting
           exit 1
   run 3:  corpus: 33692 admitted files   (2026-10-04, re-measured)
            [BB-PARSE-ERR] dart | dart-sdk/.../import_elements_test.dart | memory access out of bounds
            [BB-HANG] parser stuck 120s on dart-sdk/.../import_elements_test.dart — exiting
            exit 1
   run 4:  corpus: 33692 admitted files   (2026-10-04, third re-measurement)
            [BB-PARSE-ERR] dart | dart-sdk/.../get_statement_completion_test.dart | memory access out of bounds
            [BB-PARSE-ERR] dart | dart-sdk/.../get_refactoring_test.dart | memory access out of bounds
            [BB-HANG] parser stuck 120s on dart-sdk/.../get_statement_completion_test.dart — exiting
            exit 1
   run 5:  corpus: 33692 admitted files   (2026-10-04, fourth re-measurement)
            [BB-PARSE-ERR] dart | dart-sdk/.../is_postfix_completion_applicable_test.dart | memory access out of bounds
            [BB-PARSE-ERR] dart | dart-sdk/.../make_return_type_nullable.dart | memory access out of bounds
            [BB-HANG] parser stuck 120s on dart-sdk/.../is_postfix_completion_applicable_test.dart — exiting
            exit 1
   run 6:  corpus: 33692 admitted files   (2026-10-04, fifth re-measurement, 5m20.421s real)
           [BB-PARSE-ERR] dart | dart-sdk/pkg/_fe_analyzer_shared/.../flow_analysis_operations.dart | memory access out of bounds
           [BB-PARSE-ERR] dart | dart-sdk/pkg/analysis_server/lib/src/services/correction/dart/merge_combinators.dart | memory access out of bounds
           [BB-HANG] parser stuck 120s on dart-sdk/pkg/_fe_analyzer_shared/.../flow_analysis_operations.dart — exiting
           exit 1
   run 7:  (2026-10-04, sixth re-measurement)
           [BB-PARSE-ERR] dart | dart-sdk/pkg/analysis_server/test/lsp_over_legacy/execute_command_test.dart | memory access out of bounds
           [BB-PARSE-ERR] dart | dart-sdk/pkg/analyzer/lib/dart/analysis/analysis_context_collection.dart | memory access out of bounds
           [BB-HANG] parser stuck 120s on dart-sdk/pkg/analysis_server/test/lsp_over_legacy/execute_command_test.dart — exiting
           exit 1
   run 8:  (2026-10-05, seventh re-measurement)
           [BB-PARSE-ERR] dart | dart-sdk/pkg/analysis_server/test/src/services/correction/fix/convert_to_package_import_test.dart | memory access out of bounds
           [BB-PARSE-ERR] dart | dart-sdk/pkg/analyzer/lib/analysis_rule/pubspec.dart | memory access out of bounds
           [BB-HANG] parser stuck 120s on dart-sdk/pkg/analysis_server/test/src/services/correction/fix/convert_to_package_import_test.dart — exiting
           exit 1
   ```

   **Run 8 extends the population to eight files and it is the first hang file outside
   `dart-sdk/pkg/analysis_server/test/`** — the first two runs were under
   `dart-sdk/pkg/_fe_analyzer_shared/`, so the dart-sdk-analyser-shape localization run 6
   reported still holds, and this one widens the `analysis_server` subtree from
   `integration_test/`, `test/lsp_over_legacy/` and `lib/src/services/correction/` to
   `test/src/services/correction/fix/`. Run 8's second parse-error file,
   `pkg/analyzer/lib/analysis_rule/pubspec.dart`, is likewise a file no earlier run
   named.


   Run 3's hang file is one run 2 already listed as a PARSE-ERR, and run 3 is the only
   one of the three whose hang file and parse-error set coincide as a single element —
   which is the correlation below holding for the third time, on the strongest form.
   **Runs 4–8 each name a file no earlier run named**, so the set of files this
   failure has been observed on is eight: `flow_analysis_log.dart`,
   `list_postfix_completion_templates_test.dart`, `import_elements_test.dart`,
   `get_statement_completion_test.dart`, `is_postfix_completion_applicable_test.dart`,
   `flow_analysis_operations.dart`, `execute_command_test.dart` and
   `convert_to_package_import_test.dart`.
   **Run 6 also localizes the population, which five files could not.** Runs 1 and 6 are
   both under `dart-sdk/pkg/_fe_analyzer_shared/lib/src/flow_analysis/`; runs 2–5 and
   7–8 are all under `dart-sdk/pkg/analysis_server/`. Seven of eight sit in two
   dart-sdk subtrees rather than spreading across 33,692 admitted files, so the trigger
   is dart-sdk-analyser-shaped and not a property of large files or of concurrency — the
   two explanations the earlier runs invited, neither of which the directory evidence
   supports.
   Two properties hold across all eight runs and
   both argue the same way — the hang file is never the same file twice, and it is
   always a member of that run's own PARSE-ERR set. A grammar defect would name the
   same construct every time; a corrupted WASM heap names whatever the next allocation
   lands in.

   Every hang file is parseable in isolation, and that is now a committed instrument
   rather than a table someone typed: `validation/m14/fixtures/dart/hang-file-innocence.ts`
   runs one production `parseFile` per file, prints symbols and relationships, and
   records for each entry whether that run had also reported the file in its own
   PARSE-ERR set. **8 of 8 clean**, and the symbol/rel counts agree with the ad-hoc
   table below on every file they share. The two rows that had no prior ad-hoc entry,
   re-measured at this pass:

   ```
   flow_analysis_log.dart                        20,272 B  OK 1241 ms — 32 symbols, 136 rels  [hang run 1, also in that run's PARSE-ERR set]
   list_postfix_completion_templates_test.dart    1,254 B  OK   33 ms —  3 symbols,  20 rels  [hang run 2, also in that run's PARSE-ERR set]
   import_elements_test.dart                      4,190 B  OK   66 ms —  9 symbols,  84 rels  [hang run 3, also in that run's PARSE-ERR set]
   get_statement_completion_test.dart             1,715 B  OK   55 ms —  3 symbols,  29 rels  [hang run 4, also in that run's PARSE-ERR set]
   is_postfix_completion_applicable_test.dart      1,198 B  OK   26 ms —  3 symbols,  20 rels  [hang run 5, also in that run's PARSE-ERR set]
   flow_analysis_operations.dart                   6,787 B  OK   44 ms — 27 symbols,  27 rels  [hang run 6, also in that run's PARSE-ERR set]
   execute_command_test.dart                       1,173 B  OK   30 ms —  3 symbols,  21 rels  [hang run 7, also in that run's PARSE-ERR set]
   convert_to_package_import_test.dart              3,659 B  OK   52 ms — 16 symbols,  43 rels  [hang run 8, also in that run's PARSE-ERR set]
   ```

   The probe reports `MISSING — not on disk` rather than a pass when a recorded path
   does not resolve, and it did exactly that on its first run: the path recorded for
   run 1 carried a `mapped_by_package/` segment that is not in the tree, and
   `git ls-files` put the file at `pkg/_fe_analyzer_shared/lib/src/flow_analysis/`.
   An instrument that cannot tell "the file is clean" from "the file is not there"
   would have reported 5 of 5 on a corpus of 4.

   **The per-file parse times are not a stable measurement and the table above should
   not be read as one.** `flow_analysis_log.dart` parsed in 935 ms, 1022 ms and 1690 ms
   on three runs of the same 20,272-byte file, a 1.81x spread, while the five files
   under 7 KB stayed within 16–162 ms. What is stable across every run is the SYMBOL
   AND RELATIONSHIP COUNT — `32 symbols, 136 rels` on all three — so the parse is
   deterministic in its output and only its wall time is not. A reader checking
   determinism should compare the counts, not the milliseconds.

   Run 4's two files parse cleanly through production `parseFile` one at a time,
   which is the claim the whole argument rests on:

   ```
   get_statement_completion_test.dart  ms=967  fallback=false  symbols=3  rels=29  errors=0
   get_refactoring_test.dart            ms=42   fallback=false  symbols=3  rels=36  errors=0
   ```

   So on this corpus the arbiter exits **1**, five times out of five, and never
   prints a verdict —
   `exit 2` is what `ontology-coverage-gate.ts:289-293` does when it gets there,
   which is a source fact (`RULED_BY_LANG` holds only `bash` and `json`, and the
   refusal precedes the row loop) rather than a measurement. An earlier version of
   this item quoted an `exit 2` run with `corpus: 563 admitted files`; that run used
   `BB_CORPUS_ROOT` pointed at a 565-file symlink sample, and the corpus has since
   grown to 33,692 admitted files, so the quoted number no longer describes any
   run a reviewer can reproduce today.

   **The `[BB-HANG]` is the CONCURRENT PARSE PATH, and the file it names is
   innocent.** This corrects the reading that a `[BB-HANG]` naming one file is a
   parser-robustness finding about that file. Every file named across the eight runs
   above parses cleanly through the same production `parseFile`, one at a time — 8 of 8
   on the committed probe. The
   `document_color_test.dart` row needed a path to be checkable at all, because
   **dart-sdk tracks two files of that name** and the bare filename names neither:

   | file named by a failing run | alone, via `parseFile` |
   | --- | --- |
   | `pkg/_fe_analyzer_shared/.../flow_analysis_log.dart` | OK 108 ms — 32 symbols, 136 rels |
   | `.../edit/list_postfix_completion_templates_test.dart` | OK 14 ms — 3 symbols, 20 rels |
   | `.../edit/import_elements_test.dart` | OK 731 ms — 9 symbols, 84 rels |
   | `test/lsp_over_legacy/document_color_test.dart` | OK 27 ms — 5 symbols, 48 rels |
   | `test/lsp_over_legacy/document_color_test.dart` — the row above is THIS file | |
   | `test/lsp/document_color_test.dart` — the OTHER tracked file of that name | OK 123 ms — 35 symbols, 163 rels |
   | `pkg/dartpad/lib/src/util/environment.dart` (run 3's first hang) | OK 9 ms — 1 symbol, 1 rel |
| `.../edit/get_statement_completion_test.dart` (run 4's hang) | OK 967 ms — 3 symbols, 29 rels |
| `.../edit/get_refactoring_test.dart` (run 4's other PARSE-ERR) | OK 42 ms — 3 symbols, 36 rels |
| `test/lsp_over_legacy/execute_command_test.dart` (run 7's hang) | OK 30 ms — 3 symbols, 21 rels |
| `.../correction/fix/convert_to_package_import_test.dart` (run 8's hang) | OK 52 ms — 16 symbols, 43 rels |
| `pkg/analyzer/lib/analysis_rule/pubspec.dart` (run 8's other PARSE-ERR) | OK 1111 ms — 46 symbols, 78 rels |

   Two readings from that. The 5 symbols / 48 rels recorded for `document_color_test.dart`
   are `test/lsp_over_legacy/`; `test/lsp/` publishes **35 symbols and 163 rels** from
   the same basename, so the row was uncheckable as written and a reader following the
   filename would have measured a different file and found a different number. And every
   symbol/rel count reproduced on re-measurement — 32/136, 3/20 and 9/84 all agree with
   the earlier run — while the wall times did not (144→108, 1,008→14, 104→731 ms), which
   is this machine's load, not the files.

   The file the engine reported as stuck for 120 s parses in 1,008 ms on its own. It
   also survives being parsed eight at a time — the gate's own worker count
   (`ontology-coverage-gate.ts:233`) — for 5 trials × 8 parses = 40 parses, all
   `fulfilled`, all returning the same 136 relationships. The named file differs
   between the three runs, and so does the set of `memory access out of bounds`
   files (1 file, then 4, then 1). A defect in a file would name the same file every
   time — and run 2 names four distinct files as parse errors while hanging on a fifth.

   **This CONFIRMS item 5's second bullet rather than competing with it.** In all
   three runs the hang file is also in that same run's `[BB-PARSE-ERR]` set — run 1 on one
   file, run 2 on one of four, run 3 on one of one — which is the "the hang follows the parse failure
   rather than being independent" reading, now at corpus scale rather than over
   5,500 file-parses. What this adds is the other half: the parse failure is not a
   property of the file either. The same file, same bytes, same production
   `parseFile`, parses clean one at a time and 8 at a time. So the corrupted WASM
   state is the cause and the file is the victim — which is why the remedy in item 5
   (abort that file's parse and return an error) is the right shape, and why an
   engine that made the failure visible per-file would also have made this
   diagnosis possible.

   What the evidence does support: the failures are in the engine's WASM parse path
   under concurrency, which is the same non-determinism this lane's own census
   measured and reported (`census.ts` header — 1,000 files at concurrency 6 gave
   36,550 vs 36,503 symbols and 124,772 vs 124,638 relationships; byte-identical at
   concurrency 1). `src/ast/engine.ts:1407-1414` then converts that into a whole-run
   failure: the 120 s per-file timer calls `process.exit(1)`, so one bad parse
   discards every measurement the gate accumulated. **Not reproduced end to end:**
   this lane did not reproduce the hang itself in a controlled run, only its
   recurrence at full corpus scale (n=3) and the innocence of the named files.
2. **`script/m14/differential.ts` — admit the two labels for dart.** Two edits, both
   required together (truth without the allowlist entry reads as a fabricated
   MISSING; the allowlist entry without the truth reads every row as unexplained):
   - push `deriveDartReferencesTruth(root, dartProjectIndex ? [...dartProjectIndex.typeKinds.keys()] : undefined, path.basename(relPath, path.extname(relPath)))` in the `if (lang === "dart")` block at line ~22756, next to the four existing pushes;
   - add `"references"` to the dart arm of the compared-label filter at line ~23186
     (`...(lang === "dart" ? ["imports", "exports"] : [])` → `["imports","exports","references"]`).
   Measured expectation after both edits: `references` becomes comparable at 100.0%
   agreement with 0 unexplained, from the 799-file oracle run (1,203/1,203 rows).
   Before them, 5,265 rows per 2,735 sampled files stay invisible.
   The same paragraph is where `overrides` belongs for dart: the `lang !== "dart"`
   term at line 23153 is what turns a wired oracle into 114 permanent MISSING rows
   on the two 60-file lanes.
3. **A symmetric R7 guard in the comparison.** The harness already applies one for
   the EMPTY endpoint (`truth = truth.filter(t => String(t.target ?? "").trim().length
   > 0)`, line ~23473, with a comment explaining that a rule only one side obeys
   turns into a false gap). The literal `unknown` needs the same treatment on both
   sides: the analyzer now publishes 0 such rows and the oracles still derive them
   (9 per 525 files, measured by `validation/m14/fixtures/dart/r7-truth-cost.ts`),
   and the matcher compares on (label, target), so every row the differential
   samples reads MISSING. What it must do: drop rows whose source or target is the
   literal `unknown` from `truth` and from `rels` in the same place, and count them.
   Why here and not in the analyzer: a rule one side obeys manufactures a gap, and
   all 106 removed rows named endpoints the store never receives anyway
   (`keepSymbol` drops the name `unknown` universally).
4. **`script/m14/mutate-analyzer.ts` — four mutants for the two new behaviours.**
   The file is supervisor-owned and the 42 existing dart mutants are unaffected by
   this wave, so nothing currently fails if `references` or the R7 filter is
   deleted. Suggested, in the shape of the existing dart entries (each is a
   `transform: r => ({...r, relationships: (r.relationships ?? []).filter(...)})`):
   - `dart/references-dropped` — filters `x.type !== "references"`. Caught by
     `dart/type-references` (13 expect rows).
   - `dart/references-resolution-gate-removed` — appends
     `{ source: "consume", target: "String", type: "references", confidence: 0.95 }`.
     Caught by the `consume -> String` forbid (fabrication class).
   - `dart/references-heritage-double-count` — appends
     `{ source: "Derived", target: "Wallet", type: "references", confidence: 0.95 }`.
     Caught by the `Derived -> Wallet` forbid (double-count class).
   - `dart/r7-unknown-endpoint-reintroduced` — appends
     `{ source: "load", target: "unknown", type: "calls", confidence: 0.9 }`. Caught
     by the label-independent forbid in `dart/unknown-endpoint-r7`.
   - `dart/references-confidence-inflated` — rewrites every `references` row's
     confidence to 1. Caught by the exact `confidence: 0.95` pin in
     `dart/type-references`.
   - `dart/references-type-parameter-shadow-removed` — deletes the
     `isTypeParameterShadowed` guard. Caught by the `Shadowed -> T` forbid, which is
     the only pin in the fixture that a same-named declared class makes load-bearing.

   **What was verified here without touching that file**, because the mutants are
   supervisor-owned: each of the six behaviours above was removed from the analyzer
   one at a time and `run-fixtures.ts --lang dart` re-run. Five of the six turned the
   suite red on the fixture named above; the sixth — the type-parameter shadow guard —
   did NOT, because at the time no fixture contained a constrained type variable whose
   name was also a declared type, so deleting the guard was invisible. That gap is
   what produced defect 1 under *Defects found and fixed*, and it is closed now. The
   remaining five are: the double-counted-position guard, the qualified-name read, the
   exact confidence, the R7 filter, and the drop-the-label mutation.
5. **`src/ast/pool-worker.ts` / `src/ast/engine.ts` — two parse-path findings, both
   measured on this lane's corpus and neither caused by this lane.**
   - **`parseFile` is not concurrency-safe.** Two runs of the same 1,000 files with
     the same analyzer at concurrency 6 gave 36,550 and 36,503 symbols and 124,772 and
     124,638 relationships; at concurrency 1 the same two runs are identical. The
     engine's `[BB-PARSE-ERR] … memory access out of bounds` message is the tell — it
     appeared twice in ~5,500 file-parses under concurrency and never at concurrency
     1 — so a file silently contributes fewer symbols and edges. What it must do:
     either serialize the parse or make the failure visible as a per-file result the
     caller can count, because a caller that parallelizes (every census harness,
     including this lane's) currently gets a number that is not reproducible. Why it
     matters beyond this lane: any measurement taken at concurrency > 1 is not a
     measurement, and nothing in the API says so.
    - **A single file can take the whole process down.** `src/ast/engine.ts` line ~1408
      arms a 120 s `setTimeout` that writes `[BB-HANG] parser stuck 120s on <file>` and
      calls `process.exit(1)`. Observed twice in ~5,500 file-parses, on
      `dart-sdk/pkg/vm_service/test/step_through_call_on_field_in_class_lib.dart` in one
      run and `riverpod/packages/riverpod/lib/src/core/override_with_value.dart` in
      another, each preceded by `[BB-PARSE-ERR] … memory access out of bounds` on the
      SAME file — so the hang follows the parse failure rather than being independent.
      Rate: 1 file in 2,735 sampled (0.037%). **Both of those files, and all four named
      by the two full-corpus runs under item 1, parse clean in isolation** (33–1,008 ms,
      real symbols and relationships), so the file is the victim of the corrupted WASM
      state rather than its cause — see item 1 for the per-file table. What it must do:
      abort that file's parse and return an error for it, rather than exiting the
      process; the indexer is incremental by design and this makes one pathological
      file lose the whole run, which for a measurement gate means the run produces no
      table at all rather than a partial one.
6. **`src/ast/pool-worker.ts` `extractBasicRelationships` — the >1 MB fallback
   fabricates `calls` edges from declarations, and the corpus contains the proof.**
   The fallback is a regex extractor (the analyzer is regex-free; this is not) whose
   `obj.method(` pattern matches an `extension type X._(T rep)` DECLARATION and
   publishes `calls X -> _` at 0.4 — a call to a symbol named `_`. Measured on
   `dart-http/pkgs/cupertino_http/lib/src/native_cupertino_bindings.dart` (1.4 MB):
   **20 of its 24 relationships are fallback rows, and 12 of those name `_`** across
   `NSLocking`, `NSOperation`, `NSProgressReporting`, `NSURLAuthenticationChallenge`
   and others. Across this lane's 4,788-file census the fallback contributed **67
   `calls` rows**. What it must do: skip a line that parses as a declaration, or
   at minimum not treat an `extension type` header as an invocation. Why here and
   not in the analyzer: no analyzer ever sees these files — `parseFile` diverts
   them before dispatch — so there is nothing for a lane to fix. Why it matters
   beyond this lane: a fabricated caller in `bb_graph` is wrong refactoring advice,
   and the confidence 0.4 is below the 0.7 line the contract uses to separate
   heuristics from facts while the row is stored beside facts.
7. **`script/m14/firing-check.ts` and `script/m14/incoming-check.ts` do not exist.**
   The M14 ontology workstream prompt instructs every lane to run
   `npx tsx script/m14/firing-check.ts --files 120 <lang>` and
   `npx tsx script/m14/incoming-check.ts <lang> <files...>`, and names the first as
   the arbiter that shows which types fire. Neither file is present in this tree
   (`find` over `script/` returns nothing), so no lane can run either, and the
   per-type firing table the prompt quotes as "the supervisor's numbers" has no
   reproducible instrument behind it here. What to do: land both, or amend the
   prompt. This lane substituted two committed instruments and states them so the
   substitution is checkable rather than silent:
   - `validation/m14/fixtures/dart/census.ts` — what FIRES: per-type counts, symbol
     kinds, empty names, `unknown` endpoints, endpoint resolution. 2,735-file stride
     sample across 5 repositories.
   - `validation/m14/fixtures/dart/incoming-census.ts` — what REACHES a declaration:
     per-type resolution at three scopes, target ambiguity as a set size, and the
     no-symbol population split by cause. 4,788 files, 3 repositories read whole.
   Both drive production `parseFile`, both declare `BB_DART_CONC=1` as a
   precondition, and both are deterministic from a clean corpus.
8. **`script/m14/verify-honesty.ts` fails project-wide, and this lane is not
   among the causes.** Re-measured on this branch, no scoping flag exists on the
   script: **23 failure(s), exit 6.** The composition, because a total is not a
   breakdown and this entry previously carried a total that happened to match while
   its breakdown did not:

   | kind | count | which |
   |---|---|---|
   | banned term in an artifact | **12** | `validation/m14/fixtures/{c,clean,csharp,html,php,sql}/*.expectation.json`, `validation/m14/grammar-pins.json`, `validation/m14/results/M14.0.{F5,F11.fsharp,JS-CENSUS}.json`, `validation/m14/results/fsharp-shape-census.json` |
   | declared inputs changed since the named commit | 9 | `M14.0.F1`…`F9` |
   | a milestone check not passing | 1 | `M14.0.F7 has 2 non-passing check(s): analyzer-hygiene-cpp, analyzer-hygiene-elixir` |
   | the freshness rule itself cannot discriminate | 1 | `freshness rule flags every artifact` |

   **An earlier version of this entry said "No banned-vocabulary check fails, so
   the failure set is evidence staleness alone." That was wrong, and the total was
   right by coincidence: 23 matched while 12 of the 23 were banned-term hits.** All
   12 name files in `c`, `clean`, `csharp`, `html`, `php`, `sql`, `fsharp`, the
   shared `grammar-pins.json`, or supervisor-owned `validation/m14/results/*.json`.
   None is under `fixtures/dart/` and none is `real-dart-analyzer.ts`; a scan of
   this lane's own two M14 files for all eleven banned terms returns 0.

   The declared-input failures name files this lane has never touched —
   `src/ast/analysis-exclusions.ts`, `src/ast/brain-surgical-patcher.ts`,
   `src/ast/dependency-graph-visualizer.ts`,
   `src/ast/cross-language-migration-assistant.ts`, and 20 other languages'
   `script/m14/spec/*-completeness.json` — each verified unchanged by this branch with
   `git diff 8286c7391..HEAD -- <file>` (empty for all four named above).
   `validation/m14/fixtures/dart/census.ts` is named in **no** declared input set, so
   this lane's own edits do not add to those counts — checked, because a lane that
   worsens a gate it is not fixing should say so rather than be counted as innocent.
   Regeneration is the supervisor's: those artifacts are `validation/m14/results/*.json`,
   which the honesty contract §5.1 reserves for verifier scripts, and regenerating them
   from one lane would replace the milestone's claim with a single lane's. Reported, not
   worked around.
9. **`script/m14/oracles/dart-overrides.ts` — a gate that is written and never read,
   and a comment that asserts it is enforced.** Found while removing this lane's last
   regexes; the code is lane-owned and the dead computation is removed, but the
   DECISION it was hiding is not this lane's to take.
   - What is true now: `overrideMembers`/`hasOverrideAnnotation` computed which
     members carry a real `@override`; the result went into an `overrideOf` map that
     nothing ever looked up (`grep` for `overrideOf.get` / `overrideOf[` → 0 hits). So
     the oracle's EXTERNAL resolution pass has never been annotation-gated.
   - What was claimed: the comment above it asserted the pass IS gated and that an
     ungated pass "derived 81 `X.props -> Equatable.props` edges the analyzer
     deliberately does not publish".
   - What contradicts it: this lane's own battery pins the opposite. The case
     `an unannotated external member: oracle has evidence, analyzer does not here`
     (in `script/m14/verify-dart-overrides.ts`) asserts the oracle DOES claim the row
     with no annotation, on the reasoning that a companion-verified match is evidence
     rather than a guess, and that `@override` is only a lint (`annotate_overrides`).
     A comment saying gated and a case saying ungated cannot both describe one pass.
   - What the owner must decide, and why it is not a refactor: wiring the gate changes
     published truth rows. Either (a) the companion pass stays ungated and the
     "81 edges" claim is withdrawn as describing a program that never existed here,
     or (b) the gate goes live and every unannotated external-base member stops being
     claimed, which will move MISSING counts on any lane using this oracle. The rule a
     wired gate needs is already in the file as `isOverrideAnnotation` (gates on
     `node.type === "annotation"`, reads the identifier child — the rule
     `RealDartAnalyzer.extractAnnotations` already applies). Measured for reference:
     the analyzer's own FALLBACK pass is annotation-gated and its COMPANION pass is
     not, so option (b) makes the oracle match the analyzer exactly.
   - Verified behaviour-preserving: `run-fixtures.ts --lang dart` 16/16,
     `verify-dart-overrides` 14/14 before and after, and the differential holds
     `cov 98.4% / MISSING 100 / unexplained 0` (proxicall) and
     `cov 99.4% / MISSING 14 / unexplained 0` (dart-http) on every run.
10. **`script/m12/verify-regex-census.ts` cannot see a regex LITERAL, so a lane whose
    only regexes are literals is counted clean.** This lane reported 0 regexes for
    several waves while holding 9 of them, all in that shape — a constant assigned
    `/…/` and then `.test()`ed through the variable. The gate's patterns
    (`new RegExp`, `RegExp(`, `.match/.replace/.test/.search(`, `.matchAll`) match a
    construction site and a call site; none of them matches
    `const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/`. What it must do: parse the AST and
    count regex-valued expressions and `new RegExp`/`RegExp()` constructions, so a
    literal is counted by being a literal. Why it matters beyond this lane: the same
    shape as the source-derivation error this wave exists to correct — an instrument
    blind to a construct reports an absence, and the absence is read as a pass. The
    per-file `m12` census has the same blind spot.
    **A working instrument for this now exists and can be lifted**:
    `validation/m14/fixtures/dart/regex-census.ts` counts `RegExpLiteral` nodes and
    `RegExp` constructions through `ts.createSourceFile`, prints the directories it
    entered, and excludes itself by name. It is lane-scoped but nothing in it is
    Dart-specific except the file list.
11. **`script/m60/rel-type-coverage-gate.ts` — `--langs=` narrows the EVIDENCE file,
    which its own docstring says it does not.** Line 50 of that file reads
    `--langs=a,b  restrict the report (never narrows the gate's own claim)`, and line
    595 writes `validation/m60/results/rel-type-coverage.json` **unconditionally** —
    there is no `--langs` guard on the write and no `--dry-run`. So running the gate
    scoped, which is what a lane is told to do, replaces the project-wide artifact with
    a one-lane one. Measured here: `--langs=dart` turned a **1,441-line** artifact into
    a **24-line** one (`24 insertions, 1417 deletions`), and the DERIVATION count the
    lane needs (2 for dart) is still correct — the damage is to every OTHER lane's row,
    not to this one's answer. What it must do: either skip the write when `--langs` is
    present and is not the full set, or write to a per-scope path
    (`rel-type-coverage.<langs>.json`) and leave the project-wide artifact for
    unscoped runs. Why here and not in this lane: the file is supervisor-owned, and the
    fix must be applied once for every lane — six lanes running this scoped right now
    are each silently truncating the same file. **This lane reverted its own write**
   (`git checkout -- validation/m60/results/rel-type-coverage.json`) and quotes the
   number from the console, not from the artifact. `validation/m60/ledger.json` is not
   touched — only `--update-baseline` writes it, which this lane never passed.
12. **`script/m14/verify-doc-truth-emissions.ts` — `parseClaimTable` drops the FIRST
    body row of every claim table, so one `RelationshipType` per language is never
    compared at all.** This is the gate commissioned to catch a doc claiming an
    emission the analyzer does not make, and it silently discards one row per table
    while doing it. `script/m14/verify-doc-truth-emissions.ts:458-481`, loop from
    `chosen.at`:

    ```ts
    if (isRuleRow(cs)) continue          // line 465 — eats the `---` row
    if (!started) { started = true; continue }   // 466-469 — then eats the FIRST BODY ROW
    ```

    The `---` rule row is consumed by the `isRuleRow` branch and `continue`s before
    `started` is ever set, so the next row — the table's first real body row — is
    consumed by the `!started` branch and never pushed. Minimal repro against the
    exported function:

    ```
    wrote  2 body rows -> parsed 1: t1
    wrote  3 body rows -> parsed 2: t1,t2
    wrote 10 body rows -> parsed 9: t1,t2,t3,t4,t5,t6,t7,t8,t9
    ```

    **Measured effect on this lane:** the gate reports `UNDOCUMENTED [dart] calls
    (relationship)` at `docs/analyzers/real-dart-analyzer.md:58`, and that finding
    is FALSE. This lane's table is at line 58 and its first body row is `calls`;
    `parseClaimTable` returns 9 rows where the table has 10, and the 9 it returns
    are `uses, contains, imports, references, exports, extends, implements,
    overrides, instantiates`. `classifyClaim("✅")` returns `YES`, so the row would
    compare cleanly — the doc does claim `calls`.

    **It is not this lane's row, and that is the sharper form of the finding.**
    Re-measured on this branch the gate prints **43 `UNDOCUMENTED` findings, of
    which 30 are the `(relationship)` shape — a language's dropped first
    relationship row — across 23 languages**: c, clojure, cpp, csharp, css, dart,
    elixir, erlang, fsharp, go, groovy, haskell, java, javascript, kotlin, python,
    rust, scala, scss, svelte, swift, typescript, objective-c. One row per language
    is ungraded, and the lane that owns the parser does not own 22 of the 30
    findings. The 8 `FALSE_NEGATIVE` findings the gate does report are real and
    unaffected by this bug.

    **What it must do:** set `started` from the rule row instead of from the first
    body row, i.e. replace lines 465-469 with

    ```ts
    if (isRuleRow(cs)) { started = true; continue }
    ```

    and delete the `!started` branch. This is safe because the header detector at
    line 451 already requires a rule row whose width equals the header's, so a
    matched table always has one. **Why it is not this lane's to fix:** the change
    moves findings in every lane's row, and five languages' documents are owned by
    other lanes.

    **Why it is still worth reporting rather than shrugging at:** the dropped row is
    dropped from BOTH directions. `claimed` is what the FALSE_NEGATIVE and
    FALSE_POSITIVE checks iterate, so a first row that reads "not emitted" is never
    graded either — the gate cannot report the falsehood it was built to find. The 8
    FALSE_NEGATIVE findings it does report are real and unaffected; this one removes
    a row, not a verdict.

    **The selftest passes 12/12 and cannot see it**, which is the part worth
    fixing alongside the parser: its cases assert the SET of disagreement kinds, not
    the row count, and several expectations have a spurious `UNDOCUMENTED` baked in —
    `expected [NON_ENGINE_KIND] … got [NON_ENGINE_KIND, UNDOCUMENTED]`,
    `expected [MIXED_ROW] … got [MIXED_ROW, UNDOCUMENTED]`,
    `expected [FALSE_POSITIVE] … got [FALSE_POSITIVE, UNDOCUMENTED]`. The extra
    entries are this bug's output, accepted as expected rather than traced to it. A
    case asserting `parseClaimTable` returns the row count it was given would fail
    today.

    **A third finding in the same file, and it is why the numbers above needed
    re-deriving: running this gate WRITES supervisor-owned evidence.** Measured on
    this branch, `bun run script/m14/verify-doc-truth-emissions.ts` modifies four
    tracked files: `docs/DOC-TRUTH-EMISSIONS.md`,
    `validation/m14/results/M14.0.F1.json`, `M14.0.F4.json` and `M14.0.F7.json`. The
    `DOC-TRUTH-EMISSIONS.md` diff is not cosmetic — it rewrites this lane's own row
    from `calls (relationship) | line 34` to `| line 58` because the claim table moved
    when this file was edited, and it adds `dart` to a
    "Docs with more than one ontology-shaped table (only the first is compared)"
    list. `verify-analyzer-hygiene.ts` writes `M14.0.F7.json` the same way. What it
    must do: take an output path, or write nothing on a non-canonical invocation, the
    way `differential.ts` already refuses (`a scoped run is for inspecting lanes, and
    writing it here would replace that claim with a smaller one`). Why it matters
    beyond this lane: a lane told to run a gate inherits a dirty worktree and a
    temptation to commit the result, and the natural commit is six other lanes'
    evidence. This lane reverted all four files (`git checkout --`) and quotes its
    numbers from the console.

13. **TEN shared gates cannot run under `npx tsx` at all, and the documented invocation
    is `npx tsx`.** This started as a one-file observation about
    `verify-analyzer-hygiene.ts` and is not one file. Every gate in `script/m14/` that
    resolves `ROOT` from `__dirname` dies at module scope under `npx tsx`, because
    `__dirname` does not exist in ES module scope:

    | script | line | error under `npx tsx` |
    | --- | --- | --- |
    | `owner-spot-check.ts` | 15 | `__dirname is not defined in ES module scope` |
    | `verify-analyzer-hygiene.ts` | 27 | same |
    | `verify-attr-line-base-920.ts` | 48 | same |
    | `verify-corpus-census.ts` | 31 | same |
    | `verify-doc-truth-emissions.ts` | 131 | same |
    | `verify-fixture-coverage.ts` | 38 | same |
    | `verify-parse-success.ts` | 75 | same |
    | `verify-probe-battery.ts` | 24 | same |
    | `verify-include-names-924.ts` | 48 | `Cannot determine intended module format` — mixed `require()` and top-level `await`, so it dies EARLIER and never reaches line 48 |
    | `verify-name-surface-924.ts` | 46 | same |

    **All ten run under `bun`** — verified one by one, each printing no
    `is not defined` and no `Cannot determine intended module format`. `verify-js-census.ts`
    is the twelfth file that names `__dirname` and is fine: its occurrence is a string
    in a list of global names, not a path resolution.

    Two consequences, and the second is the one that costs a lane its evidence. A gate
    that prints nothing and a gate that found nothing look identical in a log, and only
    one of them is a result. And a lane following the workstream's own gate list —
    `npx tsx script/m14/<gate>.ts` — collects a non-zero exit and an empty log from ten
    gates and cannot tell a crash from a pass. This lane hit it twice: the first
    version of item 13 named only `verify-analyzer-hygiene.ts`, and the
    `verify-doc-truth-emissions.ts` run that produced item 12 was itself run under `bun`
    for this reason without the connection being stated.

    **What it must do:** resolve `ROOT` the way `differential.ts` does
    (`import.meta.dirname`), or the way `zig-relationship-census.ts` does
    (`path.dirname(fileURLToPath(import.meta.url))`) — the second is already in this
    directory and its comment at line 34 records the same wall, so the fix and a note
    about it are both already written. Failing that, print an explicit "no findings"
    line so an empty output is distinguishable from a crash. Why not this lane's to fix:
    `script/m14/` is shared machinery and ten gates are not one lane's files.
14. **`script/m14/firing-check.ts` never hashes the analyzer, so its drift guard cannot
    fire.** `analyzerDigest` resolves the analyzer at
    `path.join(here, "..", "ast", \`${rel}.ts\`)` where `here` is `script/m14`, giving
    **`script/ast/…`** — and every analyzer in this repository lives in **`src/ast/`**.
    The `existsSync` check therefore fails for all 23 onboarded lanes and the function
    returns the string `MISSING:/…/script/ast/real-<lang>-analyzer.ts` instead of a
    sha256. Measured on this lane: `"analyzerDigest":
    "MISSING:$HOME/mcp/bb-lanes/dart/script/ast/real-dart-analyzer.ts"`,
    while the file it means to hash is `src/ast/real-dart-analyzer.ts` at
    `sha256 4d5c584d581658801981573ad19d9c50cba2337a6b2a0981ca63ff362ea0cea7`.

    Two consequences, and the second is the worse one. The header's stated purpose —
    "sha256 of the ANALYZER UNDER TEST, so a number is tied to the code that produced
    it" — is not met for any lane: the field identifies nothing. And because
    `MISSING:…` is a CONSTANT, `digestBefore === digestAfter` always, so
    `analyzerStableDuringRun` is vacuously `true` and the `ANALYZER CHANGED DURING THE
    RUN` warning at lines 417-419 and 484-488 is unreachable. A concurrency-sensitive
    measurement whose whole point is that the analyzer did not move under it has a
    guard that cannot report movement.

    **What it must do:** add one `..` — `path.join(here, "..", "..", "ast", …)` — and
    make the absence loud rather than a return value: if the file is missing, report
    `analyzerDigest: ""` with an explicit `analyzerDigestMissing: true` and exclude the
    lane from the `analyzerStableDuringRun` claim, so "the digest is absent" cannot be
    read as "the digest agreed". Why not this lane's to fix: it changes a field every
    lane's JSON carries, and `script/m14/` is shared machinery.

15. **`script/m14/firing-check.ts` reports `types[type].files` as 1 for every type,
    always.** `filesByType` is declared at line 334, INSIDE the per-file loop that
    starts near line 270, and consumed at line 380, also inside it. Each file therefore
    builds a fresh map holding one path, so `set.size` is 1 for any type that fires in
    that file, and the assignment overwrites the previous file's 1 with 1. Measured at
    n=400: **all ten types read `files: 1`**, including `calls` (6,970 edges) and
    `contains` (11,885), each of which this lane's own census measures across 2,310
    and 1,696 of 2,735 files respectively.

    The field is not printed by the text report — that prints `r.filesParsed` — so it
    is only visible in `--json`, and a reader of the JSON sees a plausible small
    integer with no way to tell it is structural. **What it must do:** hoist the
    `filesByType` declaration above the file loop and move the
    `for (const [type, set] of filesByType)` loop out with it, so the set accumulates
    across files. Alternatively drop the field: a per-type file count that no one
    computes is worse than none, because `firedOnCorpus` and `edges` already answer
    what a reader actually asks. Either is a one-line move; the second is honest about
    the fact that per-type BREADTH is what this lane's `census.ts` exists to measure,
    and it measures it uncapped.

16. **`RelationshipType.Imports` carries the value `"brain_import"`, and nothing
    writes or reads that string.** `src/ast/types.ts:69` reads
    `Imports = "brain_import"`, while every analyzer emits the label `"imports"` —
    this one included, at `src/ast/real-dart-analyzer.ts:2558`, and the TypeScript and
    Python analyzers carry one `"imports"` literal each. `parallel-indexer.ts:3374`
    writes `rel.type` through verbatim (`const relType = rel.type || rel.relationshipType
    || "references"`), so the stored `relationship_type` is `imports`.

    **Measured on this lane, through production `parseFile`:** the `imports` rows are
    10,657 over the 2,735-file census sample and 22,506 over the 4,788-file incoming
    sample. The census buckets any label outside its ten-name ontology list under a
    `<non-ontology labels>` key rather than dropping it, that key is **absent** from
    its output, and its ten per-type counts sum to exactly its own relationship total
    (403,674) — so this analyzer emits exactly ten distinct labels and one of them is
    `imports`, never `brain_import`.

    A search for a consumer does not find one: `grep` for `relationship_type =
    'brain_import'`, `relType === 'brain_import'` and `type === 'brain_import'` across
    the tree returns nothing. The `brain_import` that *does* appear throughout
    `import-resolution.ts` and `parallel-indexer.ts` is a **database table** holding
    `ImportInfo` rows, a different thing from a relationship row.

    **What it must do, and why it is not this lane's to do it:** decide which string is
    canonical. Either set `RelationshipType.Imports = "imports"` to match every
    producer, or normalize `"imports"` to `"brain_import"` once in the indexer so the
    enum, the store and the analyzers agree. **No measured effect today** — nothing
    queries the string, so all 22,506 dart `imports` edges are visible in
    `bb_graph`/`bb_impact` today, and `script/m14/firing-check.ts` already carries
    both spellings in its alias table (`imports: ["brain_import", "imports"]`),
    which is that script working around this rather than fixing it. The risk is
    prospective: the first consumer written against `RelationshipType.Imports`
    instead of against the observed label will match zero rows and report an empty
    graph for a language whose edges are all there. `src/ast/types.ts` is
    supervisor-owned, so this is reported.

17. **The mutation gate cannot complete, and the invocation the lane prompt
    documents is not scoped.** Two defects in one file each, both measured on this
    branch after `c48f381d1` was merged into `analyzers/ontology-laptop-b`.

    **(a) `script/m14/protobuf-mutants.ts` — one entry has no `language` field.**
    The entry `id: "protobuf/qualified-id-stopped-being-published"` (line 763) has
    keys `id, description, transform`; all 29 siblings carry `language: "protobuf"`
    as well. What it must do: add `language: "protobuf"`. Why it matters is measured,
    not stylistic: `mutate-analyzer.ts:18844` calls `clean(m.language)` →
    `runLang(lang)` → `path.join(FIXTURES_DIR, lang)` (`run-fixtures.ts:506`), so a
    mutant with no `language` makes the harness throw
    `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string.
    Received undefined` and the whole run dies. **The entry is at index 80 of
    `MUTANTS.length === 1,789`, so 80 mutants execute and 1,709 never do** — 44 of the
    45 languages carrying mutants, including **all 42 of this lane's, which sit at
    indices 1049–1718.** A full run exits 1 having verified 4.5% of the gate. The
    languages reached before the throw are `css`, `fsharp`, `nim`, `protobuf`; the
    41 not reached include `dart`, `java`, `python`, `typescript`, `go`, `rust`,
    `ruby`, `csharp`, `php`, `cpp`, `sql` and `zig`. A missing required field on one
    entry is not a lint nit here: it converts the gate from *slow* to *absent*, and
    the absence is silent in the sense that the 80 green `CAUGHT` lines above it read
    like a partial pass rather than a crash.

    **(b) `script/m14/mutate-analyzer.ts` — `main()` reads no language argument.**
    `main()` (`script/m14/mutate-analyzer.ts:18835`) parses only `BB_MUTANT_ONLY`
    from the environment; it never reads `process.argv`. So the invocation in the
    lane prompt — `bun run script/m14/mutate-analyzer.ts dart`, annotated "if it
    supports scoping" — does not scope, and `dart` is a discarded argument. What it
    must do: accept a positional language (or `--lang=`) and filter `selected` on it
    the way `BB_MUTANT_ONLY` already does, so a lane can run its own mutants without
    editing shared machinery. The in-repo answer today is
    `BB_MUTANT_ONLY="dart/" npx tsx script/m14/mutate-analyzer.ts`, which selects 42
    of 1,789 and is what produced the 42/42 row in this lane's report; note that
    `BB_MUTANT_ONLY` is documented in the source as dev-only and prints results
    **without writing canonical evidence**, which is the correct behaviour for a lane
    and is why this lane's 42/42 is a scoped figure and not a full-gate one.

    Why both are reported rather than fixed: both files are supervisor-owned per
    §Ownership. Fixing (a) is a one-line edit that unblocks 1,709 mutants; fixing
    (b) is the difference between a lane being able to check itself and not. Note
    that (a) also means this lane's own 42/42 would have been unobtainable from the
    documented invocation, so the number in this file is evidence for the fix rather
    than a substitute for it.

18. **`script/m14/ontology-coverage-gate.ts` — `--coverage` is documented as not
    parsing a corpus, and it parses the corpus. This is the same defect as item 1 and
    it is larger than item 1 states.** Item 1 reports that the `RULED_BY_LANG[LANG] ===
    undefined` refusal sits *after* the corpus walk, so a full-corpus dart run never
    reaches it. Reading the source for this pass found the cause is not the position
    of that one check: **the entire corpus walk is a top-level `await`.**
    `ontology-coverage-gate.ts:251-270` builds `observed` with
    `await Promise.all(Array.from({length: 8}, () => worker()))` over `parseFile`, then
    `:276` initialises web-tree-sitter and `:292-303` builds `treeHits` — all at module
    top level, with no guard. Every `process.exit` in the file is below that:
    `--coverage` at `:368` and the RULING TABLE refusal at `:375`.

    So the flag's own comment is false. It reads, at `:351-353`: "`--coverage` reports
    which lanes this gate can actually rule for, and **does NOT parse a corpus**."
    Measured on this branch: `timeout 45 npx tsx script/m14/ontology-coverage-gate.ts
    dart --coverage` wrote **0 bytes to stdout and was killed by the timeout (exit
    124)**. A flag whose stated contract is "print a table of lanes, parse nothing"
    cannot print that table for any language whose corpus walk exceeds the timeout,
    and `--coverage` is the one mode of this gate that would have told the supervisor
    which lanes it can rule for at all — which is the question item 1 needs answered.

    What it must do, precisely enough to apply: wrap the corpus walk in a function and
    call it only when the run is actually going to rule — i.e. gate `:251-303` behind
    `const WANT_COVERAGE = process.argv.includes("--coverage")` and the absence of
    `RULED_BY_LANG[LANG]`, so `--coverage` returns at `:368` and an unruled lane still
    reaches `:375`, both without touching `parseFile`. That is two guards, not a
    refactor. It makes item 1's proposed fix observable, because with the walk skipped
    the exit-2 refusal prints instead of hanging, and the reviewer can read the refusal
    rather than infer it from source.

    Why reported and not fixed: `ontology-coverage-gate.ts` is supervisor-owned per
    §Ownership, and it is the arbiter this lane's own verdicts are graded by. An agent
    editing the arbiter that judges it is the failure mode the gate exists to prevent,
    so the measurement is the deliverable here.

19. **The pipeline's "no target" sentinel is a string Dart can legally use as an
    identifier, and the collision is paid for in true edges.** This is defect 1 above,
    stated as the change it needs. File: `src/ast/pool-worker.ts` (the sentinel's
    definition) and `script/m14/differential.ts` / `validation/m14/fixtures/dart/census.ts`
    (the `unknownEndpoints` metric). Two ways out, and they are different decisions:

    - **(a) Change the SENTINEL** so it cannot collide with a legal identifier in any
      language — e.g. a non-identifier sentinel (`\u0000unknown`) or an explicit
      `metadata.isUnresolvedSentinel` flag set only where a fallback genuinely has
      nothing truthful to say. Then `R7`'s filter in `src/ast/real-dart-analyzer.ts:663`
      becomes a provenance test rather than a name test, the 19 suppressed `contains`
      edges and the measured `uses` edges come back, and `unknownEndpoints 0` still holds
      because no true declaration carries the sentinel. Measured effect of the
      narrowed test at a fixed draw: `covered 17196 → 17200`, `MISSING 11935 → 11931`,
      `unexplained 0` on both.
    - **(b) Change the CRITERION**: define `unknownEndpoints` as "an endpoint equal to
      the sentinel AND not published as a symbol by the same file", so a declaration
      named `unknown` is counted as resolved rather than as a violation. This is the
      same correction the base merge already applied to the SYMBOL side —
      `symbolsNamedUnknown` went 0 → 74 because publishing a Dart declaration named
      `unknown` is correct — and it leaves the analyzer untouched.

    Why reported and not fixed: (a) is shared machinery, and (b) changes a criterion
    this lane is graded on. Recovering 24 edges on a 403,674-edge graph does not justify
    an agent moving either one unilaterally, so the implementation was written, measured
    (40 admitted rows, `unexplained` 0, differential corroborating) and reverted.

20. **`filterNoiseRelationships` deletes every relationship whose leaf contains `<` or
    `>`, and it is the one test in that function with no `declaredNames` exemption.**
    File `src/ast/pool-worker.ts`, function `filterNoiseRelationships`, the term at
    line 655: `if (/[{}`<>\n\r\t]/.test(leaf)) return false`. What it must do: apply the
    same `declaredNames` guard the `NOISE_TARGETS` test 30 lines below already applies —
    keep the row when `declaredNames` has the leaf's spelling, exactly as
    `NOISE_TARGETS.has(leaf) && !(declaredNames && declaredNames.has(...))` does — while
    still dropping undeclared markup (`<div>`). The call site at line 1180 already builds
    and passes `new Set(symbols.map(s => s.name))`, so no plumbing is needed. Why: the
    ban costs this lane **12 `contains` edges over the census sample** — every
    angle-bracket operator member it declares (`operator <`, `>`, `<=`, `>=` here; the token
    set `<<`, `>>`, `>>>` is also affected and appears on the 2,531-file draw instead) —
    while `operator ==`, `+`, `-`, `/`, `*`, `%` and every non-operator member survive,
    so the defect is invisible to any check that does not enumerate the tokens. It also
    makes this lane's documented operator-naming contract unenforceable for those seven
    tokens: the analyzer and the oracle both publish `operator <token>` correctly and the
    pipeline deletes it on the way to the index. Verified by calling
    `RealDartAnalyzer.analyze` directly (`SourceLocation`: 11 member symbols, 11
    `contains` edges) against production `parseFile` (11 symbols, 7 edges).

21. **The cross-language operator spelling cannot be chosen inside one lane.** The
    alternative to item 20 is to publish an operator member under a spelling with no
    angle bracket — `operator_lt`, `op$lt` — which the ban admits. That spelling is a
    cross-language contract (*Member naming: operators are a lane contract* says it
    matches kotlin's phantom members), so it is a family decision, and
    `script/m14/oracles/dart-contains.ts` implements the contract independently and would
    need to move with it. Reported so the choice is made once, deliberately, rather than
    by whichever lane hits the filter next.
22. **`ProjectIndex` cannot resolve a module URI, so `imports`/`exports` cannot
    resolve in ANY lane — 65.7% of this lane's 10,959 targets name a file the corpus
    tracks.** Two changes, in this order:
    - **`src/ast/project-index.ts`, `ProjectIndex` interface (line 66-79).** Add a
      file-path → published-module-name map, e.g.
      `moduleNamesByPath: Map<string, string>` plus `moduleNameOfPath(path)`. Today the
      index is name-keyed only (`typeKinds`, `typeMembers`, `typeBases`, `symbolNames`,
      `damagedFiles`) and carries no path, so nothing can answer "which file does
      `package:proxicall/core/supabase_config.dart` name". `references` resolves through
      `typeKinds` precisely because a type mention is already a bare name; a module URI
      is not, which is why that lane-local gate does not transfer here.
    - **`src/ast/real-dart-analyzer.ts`, `analyze()` (line 251).** Publish the file
      itself as a `SymbolKind.Module` symbol named `moduleName`, so the `imports`
      SOURCE resolves, and resolve relative URIs with `path.resolve` against the
      importing file's directory so their TARGET resolves without an index. `SymbolKind.Module`
      already exists (`src/ast/types.ts:25`) and no analyzer emits it.
    **Why this lane does not do it unilaterally:** the first change is `src/ast/`, which
    this lane does not own; the second changes this lane's symbol population by one per
    file and would move every resolution rate in the tables above, which is a
    re-baselining decision and not a bug fix. Measured evidence is *Module targets:
    external vs unpublished*. **No edge was fabricated to close the gap.**

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

**Zero regexes in this lane, and it took a second scan to establish that — the first
scan was blind to the construct it was looking for.**

`validation/m12/results/regex-census.json` contains no `dart` key and no `dart` string
at all — `script/m12/verify-regex-census.ts` scans `real-*-analyzer.ts` files, so it
reports nothing for Dart and an earlier version of this section read that absence as
"0 regex usages". Absence of an entry is not a measurement of zero; the gate cannot
distinguish "scanned and found none" from "never looked at this lane".

So the number is measured here by a scan over everything this lane owns —
`src/ast/real-dart-analyzer.ts`, `validation/m14/fixtures/dart/**`,
`script/m14/oracles/dart-*.ts`, `script/m14/verify-dart-*.ts`. **The first version of
that scan searched for `new RegExp`, `RegExp(`, `.match/.replace/.test/.search(` and
`.matchAll`, and reported 2** (both in `script/m14/oracles/dart-imports.ts:68`, since
removed). **It reported 0 on a second pass, and 0 was wrong: there were 9 more.**

The blind spot is the reason this section exists now. A regex **literal** —
`/^[A-Za-z_$][A-Za-z0-9_$]*$/` — matches NONE of those five patterns. It is not
constructed through `RegExp`, and a `.test()` call on it is `.test(` only on the
variable holding it. A scan that greps for construction sites cannot see a literal
assigned to a constant. Measured, in `script/m14/oracles/dart-overrides.ts`:

| line | construct | sites |
| --- | --- | --- |
| 159 | `const IDENT = /^[A-Za-z_$][A-Za-z0-9_]*$/` | 6 × `IDENT.test()` at 190, 194, 254, 260, 399, 416 |
| 340 | `/@override\b/` | 1 × `.test()` |
| 344 | `/@?override\b/` | 1 × `.test()` |

All 9 are removed. `IDENT` became `isIdentifierSpelling`, a `charCodeAt` predicate in
the same shape as the analyzer's `isCapitalized`. The `@override` pair became
`isOverrideAnnotation`, which gates on `node.type === "annotation"` and then reads the
identifier child — the rule the analyzer already applies in `extractAnnotations`
(`prev.type === "annotation"` before any text comparison).

### The number is now an AST measurement, not a re-run of the same text scan

The second pass above was still a TEXT scan with more patterns, so it could still miss
a literal shape nobody thought of. `validation/m14/fixtures/dart/regex-census.ts` counts
the two things that are actually a regex — a `RegExpLiteral` node and a `RegExp`
construction — by walking the TypeScript AST with `ts.createSourceFile`. Division and
comment text are excluded by the grammar rather than by a filter, because a `/` that is
not a regex literal never forms that node.

```
dart lane regex census — instrument: TypeScript AST (ts.createSourceFile), no text patterns
scope: lane-owned set
owned dirs: src/ast/real-dart-analyzer.ts | validation/m14/fixtures/dart/* |
            script/m14/oracles/dart-* | script/m14/dart-* | script/m14/verify-dart-*
files scanned: 19  (8559 lines)   excluded from its own count: …/regex-census.ts
lane-owned files: 19

RESULT: 0 regexes in the lane-owned set.
```

The 18 files that are not the instrument are the whole lane-owned set — 4 oracles,
3 verifiers, the analyzer and 10 fixture harnesses. **Both numbers in that block are 19,
not 18, and the difference is the census itself:** it counts itself in both totals and
excludes itself only from the MATCH set (`hits.filter(h => laneOwned(h.file) && h.file
!== SELF)`), because its own header carries example regex literals inside a comment. So
19 files are scanned, 18 are evidence, and the RESULT sentence's own "MEASUREMENT over
19 files" is one file generous. The block above previously read `16 (7881 lines)`,
which matched no run: the set was 16 files then and is 18 evidence files now, so that
figure had been carried through at least one file being added and removed.

**The `lines` figure is one per file larger than the files hold.** 8,559 is
`content.split(/\r?\n/).length` summed over 19 files, and every file ends in a newline,
so each contributes one empty trailing segment: the real total is **8,540**
(`wc -l` over the same 19). It is quoted as the instrument prints it because that is
what a reviewer sees, and the 19-line gap is named here rather than left for someone to
find.

**Both figures in that block have moved three times, and every move is the same lesson.** They
read 8,185 / 8,168 until commit `b1b02d2b8` added a single line to a lane-owned file
(`bothInSameRepoPooled: pooledBoth(t),` in `validation/m14/fixtures/dart/census.ts`) —
a commit about the census's own JSON field, which is not a regex-bearing file and
carries no regex. They then read 8,186 / 8,169 until this wave added
`validation/m14/fixtures/dart/hang-file-innocence.ts`, which took the set to 18 files,
and then 8,337 / 8,319 until it added
`validation/m14/fixtures/dart/differential-rotation-instability.ts`, which took it to 19.
A quoted instrument block is a measurement of the tree at a commit, and any later commit
that touches a scanned file invalidates it silently. The `RESULT: 0` did not move
through any change and could not: adding lines that contain no `RegExpLiteral` adds
no matches. **The count is therefore worth less than the RESULT, and a reader who
re-runs this should expect the file count to differ by whatever their branch added.**

**Writing that instrument cost this lane two of its own blind spots, and both were the
same defect one level up.** The first version selected its file set with regexes and then
counted itself: 4 hits, every one its own filename patterns. The second required a file
to sit directly in `script/m14/`, which silently excluded all three oracles — it reported
9 files and had never looked at `dart-imports.ts`, `dart-overrides.ts` or
`dart-references.ts`. A scope that drops files without saying so is the same failure as
the text-pattern gate, and a smaller number is not a better one. The selection is now
pure `startsWith`/`endsWith`, the owned directories are printed, and the file excludes
itself by name so the exclusion is visible.

`--all` widens the scan to every dart-named `.ts` in the repository. It used to report
**7** regex literals, all in two scratch files under `script/m14/tmp/`
(`dart-container-types.ts:21`, `dart-contains-adjudicate.ts:130,161,162,163,164,175`).
An earlier version of this entry declined to touch them because
`git diff 8286c7391..HEAD -- script/m14/tmp/` is empty — they are in the branch's base.
**That reasoning was wrong and it is withdrawn.** "Arrived in the base" is a statement
about a diff, not about ownership: `script/m14/spec/dart-completeness.json:553` cites
`dart-contains-adjudicate.ts` as the `measured_by` instrument for a spec claim, so the
file is inside this lane's evidence chain whether or not this lane wrote it. A lane that
declares a scratch script outside its scope while that script backs one of its own claims
has drawn the scope to protect the number. Both files are now regex-free:

| was | now |
|---|---|
| `/body/.test(x.type)` | `String(x.type).includes("body")` |
| `/^[a-z]/.test(o)` | `o[0] >= "a" && o[0] <= "z"` |
| `/^constructor$/.test(t)` | `t === "constructor"` |
| `/\$\d+$/.test(t)` | `overloadSuffix(t) !== ""` |
| `/^[A-Z]/.test(t)` | `t[0] >= "A" && t[0] <= "Z"` |
| `/^[a-z_][A-Za-z0-9_]*$/.test(t)` | `isIdent(t)` — explicit first-char class, then a per-char loop |
| `t.replace(/\$\d+$/, "")` | `stripOverload(t)` |

`--all` now reports **0 regex literals over 31 files / 8,996 lines** (was 7 over 31).
Both files typecheck clean and `dart-contains-adjudicate.ts proxicall 12` still runs
(16 truth rows, 16 agreed, 0 analyzer-only, 0 truth-only).

**The replacement was WRONG on first write, and the way it was found is the part worth
keeping.** `overloadSuffix` was written as "if the name does not end in `$`, there is no
suffix" — but the name ends in a DIGIT. Every real overload suffix returned `""`, so
`stripOverload` returned the name unchanged and every truth-only row would have been
classified `other:` instead of `overload-suffixed ($N)`: the family the probe exists to
find would have read as ABSENT, in a probe whose whole purpose is counting families.
Caught by running the five replacements beside the five regexes they replaced over 19
names and diffing the results — **95/95 comparisons agree** after the fix, including the
awkward cases (`"$1"` → suffix `"$1"`, `"name$0$1"` → suffix `"$1"` and strip `"name$0"`,
`"f9"` and `"x$y"` → no suffix, `""` → no suffix, `"Ünicode"` → not an identifier).
A comment asserting the rewrite was equivalent would have been worth nothing; the
diff is the evidence. Note that the comparison itself carries regex literals, so it is
not committed as a fixture — a self-test that re-derives the regexes would put the seven
back and make the census read non-zero to prove the census works.

**The `@override` pair was not only a rule violation but a wrong answer**, and the
measurement is on the node rather than on a row count. For a member whose preceding
sibling is a doc comment, the regex tested the comment's TEXT:

```
/// We do not @override here — prose only.     sibling type documentation_comment
  OLD /@override\b/.test(sibling.text) = true      NEW structural = false
@override int get compute => 1;                 sibling type annotation
  OLD = true    NEW = true                        (unchanged)
```

That is the failure the workstream names for regexes — matching comments — measured on
this lane's own oracle.

**A note on what this did and did not change, because the honest answer is "no
counts".** Removing the regexes changed no emitted edge and no truth row, and I am not
quoting a count as if it did. Two reasons, and the second is the stronger one:

1. The differing predicate is not reachable through the oracle's public entry. On
   every shape I could construct the annotation gate does not decide the row.
2. **`overrideMembers` and `hasOverrideAnnotation` had no reader at all.**
   `overrideOf` was written at line 531 and never looked up, so the gate was computed
   per declaration and discarded. That is a static fact (`grep` for `overrideOf.get`
   and `overrideOf[` returns 0 hits), which is why it is the claim I stand behind
   rather than a differential comparison.

The differential confirms the invariant that IS comparable — coverage and MISSING,
which are stable across original and changed code on every run:

```
proxicall  cov 98.4%  MISSING 100  unexplained 0
dart-http  cov 99.4%  MISSING  14  unexplained 0
```

**Absolute totals from that harness are not comparable run-to-run and this document
quotes none of them as evidence.** The cold-pool rotation advances between runs;
measured on unmodified HEAD with the resume journal cleared, `dart-http` returned
`tree-truth` 2253, 2271 and 2277 across three runs and `proxicall` returned 6220 and
6162. A reader comparing two differential runs row-for-row will see movement that is
sampling, not change.

### A comment that asserted a guarantee the code did not enforce

The comment above the removed `overrideMembers` claimed the EXTERNAL resolution pass
is annotation-gated, and that without the gate "an ungated pass derived 81
`X.props -> Equatable.props` edges the analyzer deliberately does not publish". The
gate was never wired, so that sentence described a different program.

It also contradicts this lane's own battery, which pins the opposite: the case
`an unannotated external member: oracle has evidence, analyzer does not here` asserts
that the oracle DOES claim the row with no annotation, reasoning that a
companion-verified match is evidence rather than a guess and that `@override` is only
a lint (`annotate_overrides`). Both cannot be true of the same pass.

Wiring the gate changes published truth rows, so it is not a refactor and not this
lane's call — it is item 9 under *Shared-machinery needs*. The dead computation and
the false comment are removed, and `isOverrideAnnotation` is kept because it is the
rule a wired gate would need.

Historical, for the record: the analyzer itself once carried 8 (5 quote-strip /
callee-sanitization normalizations + 3 widget-detection `isWidgetTree` / uppercase
heuristics), recorded in the M12 baseline. The widget-detection heuristic
(`/Widget$|Element$|.../`) was dropped entirely — widget classification produced noise,
not contract facts. All analyzer-side text normalization uses pure-String helpers
(`unquote`, `stripCommentMarkers`, `isCapitalized`, `stripNonIdentifier`).

One Dart-source file in the lane's fixtures, `payload-and-complexity.dart:158`, contains
`RegExp(r'f6-\w+')`. That is a `RegExp` in the LANGUAGE, held as fixture input for a
regular-expression field, not a pattern in an instrument.

`script/m12/verify-regex-census.ts` **now PASSES**, and did not when this section was
written. It reported 24 MISSING and 25 STALE entries across six other languages'
analyzers (`real-css-analyzer.ts`, `real-julia-analyzer.ts`, `real-clean-analyzer.ts`,
`real-fsharp-analyzer.ts`, `real-javascript-analyzer.ts`, `real-python-analyzer.ts`,
`real-svelte-analyzer.ts`, `real-typescript.ts`); the 504 commits merged into this
branch carried the census entries those lanes owed, and the gate now reads:

```
census entries: 5 | HEAD scan: 5 | working-tree scan: 5
missing from census: 0    stale in census: 0
unclassified: 0           mislocated: 0
regex census gate PASSED
```

That is a pass **for the repository**, and it is not a pass on this lane's own
property: the gate scans `real-*-analyzer.ts` files, so a lane whose regexes are
literals inside a harness reports 0 from it either way. The measurement that does
establish this lane's property is the AST census above — 0 `RegExpLiteral` nodes and
0 `RegExp` constructions over the lane-owned set. A green gate here and a green AST
census are two different claims, and only the second one is about this lane.

**The gate's blind spot is general, not specific to this lane.** A lane whose only
regexes are literals will report 0 from this census and be counted clean. That is the
same shape as the source-derivation error this wave exists to correct: an instrument
that cannot see the construct it is measuring reports an absence, and the absence is
read as a pass.

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

### What this wave cost in latency, measured A/B

The budget question is not "is the analyzer fast" but "did adding `references` make it
slower, and by how much", and the declared artifact above cannot answer it: it is
sealed at 2026-09-14 (`bbSeal.sealedAt`), predates every change in this wave, and
`script/m60/analyzer-complexity-gate.ts` scores dart **unscorable** because its corpus
row carries no `loadAvg1`, no `loadQuiet`, no `userCpuMsPerFile` and no
`corpusManifest` — 40 of the gate's 44 lanes are in the same state, so it is a
project-wide condition and not a dart finding. Its row is also not reproducible from
the primary corpus: it measured `/tmp/dart-corpus` at 281.9 s for 399 files (707
ms/file) where the same instrument on real corpus files runs at 129–165 ms/file.

So the delta was measured directly, alternating the two analyzer blobs so the load
condition is shared rather than assumed: 300 files (5 repositories × 60, stride),
`BB_DART_CONC=1`, runs in the order AFTER, BEFORE, AFTER, BEFORE.

| analyzer | run 1 | run 2 | mean | per file | symbols | relationships |
| --- | --- | --- | --- | --- | --- | --- |
| this wave's HEAD | 49,450 ms | 50,111 ms | 49,781 ms | 165.9 ms | 15,154 | 48,306 |
| pre-M14 `8286c7391` | 49,390 ms | 48,532 ms | 48,961 ms | 163.2 ms | 15,154 | 47,882 |
| **delta** | | | **+820 ms** | **+2.7 ms/file** | **0** | **+424 (+0.89%)** |

**+1.67% wall for +424 edges (+0.89%), and the symbol count is unchanged** — the whole
cost is the type-mention pass and nothing else. The 424 are all `references` (430
emitted, less the 6 R7 rows the filter removes: 5 `uses`, 1 `contains`). Against the
declared 400-file corpus budget of 600 s, 400 files at the measured 165.9 ms/file is
66.4 s, so the addition is 9.0x inside the budget rather than a marginal pass — and
that projection is stated as a projection, not as a measurement of the declared
`corpus_subset`, whose file set this lane cannot re-derive.

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
- Regex census: `validation/m12/results/regex-census.json` — **it contains no `dart` key
  and no `dart` string**, so it is not evidence about this lane in either direction. The
  number that is evidence is `npx tsx validation/m14/fixtures/dart/regex-census.ts`:
  0 `RegExpLiteral` nodes and 0 `RegExp` constructions over the 16 lane-owned files
  (17 scanned — the census counts itself and excludes itself only from the match set), by
  AST. See §Regex inventory.
- Analyzer hygiene: `script/m14/verify-analyzer-hygiene.ts` — **Dart clean** (the
  gate reports 3 findings on this branch and none is Dart: `bare-node-identity-comparison`
  in `real-cpp-analyzer.ts:170`, `bare-node-identity-comparison` in the haskell
  analyzer at :1157, and `node-identity-comparison` in `real-elixir-analyzer.ts:942`).
  Run it with `bun` — under `npx tsx` the script dies on `__dirname is not defined
  in ES module scope` at line 27 and prints nothing, which reads as a clean lane.
- Spec: `script/m14/spec/dart-completeness.json` — 95 handled / 106 internal-silent
  / 6 re-scoped gaps / 33 ruled decisions
- Reviews: `reviews/dart/` — five documents; `master-review-4.md` is the
  whole-surface pass measured against the live corpus
- Fixtures (current): `validation/m14/fixtures/dart/` — 16, and the harness reports `summary: {"dart":{"pass":16,"fail":0}}` with no baseline regression

## Known limits of the evidence

1. **~~40 Dart mutants exist and NONE can execute.~~ RESOLVED — this limit no longer
   holds and the entry was stale.** It claimed `script/m14/mutate-analyzer.ts` does not
   parse (the `xml/implicit-xml-prefix-unbound` transform malformed since `f5f002c6`), so
   "40 mutants" was a claim rather than a measurement. Re-measured on this branch:
   `BB_MUTANT_ONLY="dart/" bun run script/m14/mutate-analyzer.ts` prints
   **`all 42 mutants caught - the gates can fail (BB_MUTANT_ONLY="dart/" filtered 1483 -> 42)`**,
   so the harness parses, the suite runs, and 42 mutants execute and are all caught. The
   count also moved 40 → 42. Kept as a numbered entry rather than deleted, because a
   limit that was believed for several waves and then measured away is evidence about how
   long a stale claim survives without re-derivation.
2. **73.6% of the graph has no Dart-derived truth** — see the oracle table above. Stated
   for the pre-M60 position: `contains`, `overrides`, `imports` and `exports` now have
   Dart-owned oracles and batteries, but `overrides` and `references` are still outside
   the differential's compared set, which is what the DERIVATION gate reports.
3. **The differential's 1.000 is five fixture files** against an audit that says it
   predates three analyzer waves.
4. **No corpus-scale perf figure** on the declared corpus, and the corpus is ~3× the
   sampled size — though the live `ProxiCall/lib` figure below is measured on 1,294 real
   files and is not a projection.
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

## Measured state — and a 2026-10-01 reading that no longer reproduces

### Re-measured 2026-10-04, every headline number in this file

A second pass re-ran every instrument on this branch rather than trusting the figures
already written here. **What reproduced, exactly:** the arbiter at n=120 (9/10, 8,290
edges, 120/120, `degraded 0`) and n=400 (10/10, 53,252, 400/400, `degraded 0`); all ten
census counts over 2,735 files (43,042 / 110,679 / 119,515 / 10,657 / 5,265 / 302 /
4,730 / 758 / 90,352 / 18,374); every breadth row; all four zero-fields
(`emptySymbolNames`, `emptyOrUnknownKind`, `unknownEndpoints`, `degradedFallbacks`);
the 10×9 incoming table AS PINNED AT `c48f381d1` — **not** as a reading of this tree,
which 24 of its 90 cells no longer match, so the 144,032 unresolvable rows across all
six buckets, the 490,135 ambiguous targets and the 1,829 residual split six ways are
three more pinned figures and three more corrections; the
`zero-contains` accounting (882 + 101 + 51 + 5 = 1,039); the 2.0117% export base rate
and P(none)=8.73% at n=120; `type-position-probe` at 75,769 mentions / 3,460 resolvable
/ 4.57%; the `references` oracle at 1,203/1,203 over 799 files; 16/16 fixtures;
42/42 mutants; 37/37, 14/14 and 38/38 shape batteries; the r7 truth cost at 9 rows /
525 files; and the differential, forced fresh, at 6,120/6,220 covered with 0 unexplained
and 100 + 14 MISSING, all `overrides`.

**A fourth pass, same day, re-ran every instrument a third time and changed four more
figures in this file.** All ten census counts, every breadth row, all four zero-fields,
the whole 10×9 incoming table, 144,032 / 490,135 / 296,854 / 1,829, the arbiter at both
n=120 (9/10, 8,290, 120/120, degraded 0) and n=400 (10/10, 53,252, 400/400, degraded 0),
16/16 fixtures, 42/42 mutants, the 37 / 14 / 38 shape batteries, the `references` oracle
at 1,203/1,203, the 4/4 mutant battery, the regex census at 0 over 19 files / 8,559
lines, the zero-`contains` accounting, `type-position-probe` at 75,769 / 3,460 / 4.57%,
the 2.0117% export base rate, and the r7 truth cost at 9 rows over 525 files **all
reproduced exactly**. What did not:

- **The differential did not reproduce, and this section's own claim about it was the
  error.** Two lines below recorded coverage percentage, MISSING and unexplained as
  "identical across rotations" on the evidence of two adjacent rotations. Rotations 78
  and 79 read 58.9% with MISSING 11,935. The generalisation was made from n=2 and the
  swing is a factor of 119 on MISSING. It is corrected in place, with the mechanism
  measured — 38 of 2,351 proxicall files each carry 5,353 `overrides` truth rows and a
  60-file draw contains one with probability 62.4%.
- **`[BB-HANG]` run count n=5 → n=6 → n=7**, and run 6 localizes the population:
  runs 1 and 6 share `dart-sdk/pkg/_fe_analyzer_shared/lib/src/flow_analysis/` and
  runs 2–5 share `dart-sdk/pkg/analysis_server/integration_test/edit/`, so five of six
  sit in two dart-sdk subtrees rather than spreading across 33,692 admitted files.
  **Run 7 (2026-10-04, sixth re-measurement) names
  `dart-sdk/pkg/analysis_server/test/lsp_over_legacy/execute_command_test.dart`** —
  a seventh distinct file, and a THIRD subtree: it is under `pkg/analysis_server/`
  like runs 2–5 but under `test/lsp_over_legacy/` rather than
  `integration_test/edit/`. Six of seven still sit in two subtrees. Run 7 also
  reproduced the rest of the shape exactly, `[BB-PARSE-ERR]` for
  `execute_command_test.dart` and for
  `dart-sdk/pkg/analyzer/lib/dart/analysis/analysis_context_collection.dart` before
  the hang, then `exit 1`. The new file is innocent on the same evidence as the other
  six: parsed alone through production `parseFile` it returns **3 symbols, 21 rels**
  with no error, so `hang-file-innocence.ts` now reads **7 of 7 clean** and the two
  properties below hold across all seven.
- **The hang-file innocence probe's per-file PARSE TIMES are not a measurement** and
  the table now says so: `flow_analysis_log.dart` parsed in 935 / 1022 / 1690 ms on
  three runs of the same 20,272-byte file, a 1.81x spread, while its `32 symbols,
  136 rels` was identical on all three. Determinism is in the counts, not the
  milliseconds, and a reader checking it should compare those. **Run 7's file makes
  the point harder: the same 1,173-byte file parsed in 1013 ms when handed to the
  probe alone and 39 ms when handed to it as the seventh of seven — a 26x spread —
  while `3 symbols, 21 rels` was byte-identical both times.** Any latency number
  derived from this probe, including a reader's own spot check, is measuring the
  machine.
- **`script/m12/verify-regex-census.ts` now PASSES** — `census entries: 5 | HEAD scan: 5
  | working-tree scan: 5`, `missing 0`, `stale 0`, `unclassified 0`, `mislocated 0`. It
  read 14 MISSING and 25 STALE rows over six other analyzers two paragraphs ago, and the
  504 merged commits carried the entries those lanes owed. This lane contributes 0 to
  either list, which is the state item 10 asks for; the gate passing is a fact about the
  repository and **not** a measurement of this lane, whose own property is established by
  the AST census — re-run in this pass at **0 `RegExpLiteral` nodes and 0 `RegExp`
  constructions over 19 lane-owned files / 8,560 lines** (was quoted as 18 / 8,337; the
  merge and this wave's one-line addition to `hang-file-innocence.ts` moved both).
- **`script/m14/verify-honesty.ts` fails with 21, not the 23 recorded above, and the
  difference is upstream rather than this lane's.** Re-run after the base merge
  (exit 6): 10 banned-term, 9 declared-input sets, 1 milestone check, 1 freshness
  rule. The 9 + 1 + 1 shape is unchanged; the banned-term rows fell from 12 to 10
  because `validation/m14/fixtures/php` and `.../sql` are no longer named — those two
  fixtures were fixed by the 504 commits the merge brought in. The 10 that remain are
  `fixtures/{c,clean,csharp,html}` (2 rows in `csharp` and `html`), `grammar-pins.json`
  (2 rows, `perfect` and `complete`) and `results/{M14.0.F11.fsharp,M14.0.F5,
  M14.0.JS-CENSUS,fsharp-shape-census}.json`. **Zero name a dart file** — the only
  `dart` string anywhere in the output is `dart-http` in the passing `corpus pins
  present` line, which is a corpus repo name and not a finding. The declared-input
  counts are large (F2 alone reports 2,549) and are a property of the merge, since
  the merge changed the declared inputs of every artifact in the tree.
- **`script/m14/verify-doc-truth-emissions.ts` still cannot run under `npx tsx`**
  (`ReferenceError: __dirname is not defined in ES module scope`, exit 1) and still
  reports `UNDOCUMENTED [dart] calls` under `bun run` — item 12's `parseClaimTable`
  off-by-one, unchanged. `verify-analyzer-docs.ts` reports dart's row clean
  (`missingSections: []`, `ontologyGaps: []`) across 8 required sections. Both scripts
  write supervisor-owned artifacts; the two this run touched
  (`docs/DOC-TRUTH-EMISSIONS.md`, `validation/m14/results/analyzer-docs.json`) were
  reverted uncommitted.

**What did not reproduce is recorded as corrected, in the sections that carry it:** the
`28 further positions` of the type inventory (33 positions exist — this section's "28"),
the quoted regex-census block (`16 (7881 lines)`, which matched no run — now 18/8,337
with the self-count explained), the `document_color_test.dart` row that named a
basename two tracked files share, and the `[BB-HANG]` run count (n=2 → n=3 → n=4 → n=5 →
n=6, each new run naming a hang file no earlier run named and each innocent on the same
evidence as the first).

**A third pass, same day, changed two more figures in this file, both from the same
cause.** A quoted instrument block is a measurement of the tree *at a commit*, and a
later commit that touches a file the instrument counts invalidates it silently:

- The regex-census line count moved 8,185 → 8,186 (real `wc -l` 8,168 → 8,169) because
  `b1b02d2b8` added one line to `validation/m14/fixtures/dart/census.ts` — a commit about
  the census's own JSON field, a file carrying no regex — and then to 8,337 / 8,319 when
  this wave added `hang-file-innocence.ts` to the lane-owned set. `RESULT: 0 regexes`
  could not move through either change, because a line with no `RegExpLiteral` adds no
  match.
- The `zero-contains` accounting table said `declaration WITH members, >1 MB | 4` and
  totalled 1,038 with a hand note that one file was double-counted. The probe's own
  `filesWithMemberDecls` is **5**, and the code block already printed below that table
  listed 5 files. The 4 counted only the files over 1 MB; the fifth,
  `patternVariableDeclaration_inClass.dart` (35 B), is an `ERROR`-bearing parse case, so
  the table counted one population under two criteria and corrected the total by hand.
  Now 5, totalling 1,039, with the 96 + 5 = 101 split named.

The two instruments agreed with each other and disagreed with the prose both times,
which is the argument for reading the instrument's output rather than the file that
quotes it.

**A fifth pass, on a branch that had fallen 504 commits behind, changed nothing and
made two things reproducible that were not before.** `origin/analyzers/ontology-laptop-b`
had advanced past this branch's merge point `c48f381d1` by 504 commits, and the
supervisor had already merged this lane's work up to that commit. Two consequences,
both measured before anything else was touched:

- **`script/m14/firing-check.ts` was absent from this branch and present in the
  base**, so every arbiter figure quoted above — `9/10` at n=120 and `10/10` at
  n=400 — had been produced against the analyzer *after* the supervisor merged it,
  not against a tree a reviewer could reconstruct from this branch alone. The base
  was merged in (`git merge origin/analyzers/ontology-laptop-b`, clean, zero
  conflicts, and `git diff c48f381d1..origin/analyzers/ontology-laptop-b` over
  `src/ast/real-dart-analyzer.ts`, this doc and `validation/m14/fixtures/dart/` is
  empty — no other lane touched this lane's three files). Re-run against the
  merged tree, **both figures reproduce exactly**: n=120 reads `9/10 fired, 8290
  edges, 120/120 files, degraded 0` and n=400 reads `10/10 fired, 53252 edges,
  400/400 files, degraded 0`. The 10/10 is therefore the supervisor's own
  instrument, reading this analyzer, on this branch — not a figure inherited from a
  merge.
- **The census reproduces exactly, including the wall time.** `BB_DART_CONC=1` over
  the same 2,735 files: all ten counts (43,042 / 110,679 / 119,515 / 10,657 / 5,265 /
  302 / 4,730 / 758 / 90,352 / 18,374), all ten breadth rows and their five-repo
  spreads, `filesWithoutContainsCount` 1,039, `symbols` 134,606, `sampleFiles` 2,735,
  `emptySymbolNames` 0, `emptyOrUnknownKind` 0, `unknownEndpoints` 0,
  `symbolsNamedUnknown` 20, `parseFailures` 0, `structuralFallbackFiles` 4, and every
  cell of the nine-column resolution table. `wallMs` 337,371 = 5.62 min, which is the
  sample-dependent figure the third pass already declined to quote as a constant.
  Fixtures 16/16 and the scoped mutant run 42/42 with 0 survivors also reproduce.

  **Three cells of the six-questions table above did not reproduce, and all three are
  rounding, not a change in the graph.** `calls` `both∈sample` 66.6% → **66.7%**
  (28,692/43,042 = 66.665%), `uses` `both∈sample` 69.2% → **69.3%**
  (76,660/110,679 = 69.254%) and `uses` `both∈repo` 60.1% → **60.2%**
  (66,665/110,679 = 60.224%). The edge counts, and every other cell of all ten rows,
  are byte-identical to the fourth pass — so the earlier three were truncated rather
  than rounded, and the table now carries what the instrument prints. A reader
  comparing percentages between runs of this table should expect ±0.1 on cells whose
  third decimal is near 5, which is a property of the display and not of the analyzer.

  Per-type confidence, which the table summarizes, also reproduces: min/mean is
  `calls` 0.4/0.9, `uses` 0.6/0.864, `references` 0.95/0.95, `overrides` 0.8/0.804,
  `instantiates` 0.95/0.95, and exactly 1.0/1.0 for `contains`, `imports`,
  `exports`, `extends` and `implements`.

The one thing this pass found that earlier passes had not is item 17 under
*Shared-machinery needs*: the mutation gate **cannot complete**, and the invocation
the lane prompt documents does not scope. It was invisible here for four passes
because this lane's own mutants were only ever run through
`BB_MUTANT_ONLY="dart/"`, which filters `selected` before the harness ever reads
`m.language` — the defect lives in the branch of the harness that a scoped run skips.

**A seventh pass, on a tree where the arbiter is now present, reproduced every figure
above and added a fifth rotation data point to the bimodality claim.** Run in the
foreground, sequentially, no polling:

| instrument | reading on this pass | matches the figure in this file |
| --- | --- | --- |
| `firing-check.ts --files 120 dart` | `9/10 fired, 8290 edges, 120/120, degraded 0`, `exports` absent | yes, to the edge |
| `firing-check.ts --files 400 dart` | `10/10 fired, 53252 edges, 400/400, degraded 0` | yes, to the edge |
| `census.ts`, `BB_DART_CONC=1`, 2,735 files | all ten counts, all ten breadth rows and their five-repo spreads, all nine resolution columns, `emptySymbolNames 0`, `emptyOrUnknownKind 0`, `unknownEndpoints 0`, `symbolsNamedUnknown 20`, `structuralFallbackFiles 4`, `filesWithoutContains 1039` | yes, every cell |
| `incoming-census.ts`, `BB_DART_CONC=1`, 4,788 files | `960,634` relationships, `337,440` symbols, `symbolsNamedUnknown 74`, ambiguous `490,292` (= 63,015 two-to-five + 427,277 six-plus), closable `296,855`, no-symbol `143,833`, unexplained `1,817`, `overrides` both-ends-repoFull `230,505` = 93.0% | yes, all eight post-merge figures |
| `run-fixtures.ts --lang dart` | `{"dart":{"pass":16,"fail":0}}` | yes |
| `mutate-analyzer.ts` with `BB_MUTANT_ONLY="dart/"` | `all 42 mutants caught`, `filtered 1789 -> 42`, 0 survivors | yes |
| `verify-dart-{contains,overrides,references}.ts` | 37 PASS / 0 FAIL, `14/14 shapes exact`, 38 PASS / 0 FAIL | yes |
| `regex-census.ts` | `files scanned: 19 (8560 lines)`, `RESULT: 0 regexes` | yes |
| `rel-type-coverage-gate.ts --langs=dart` | CHECK 1 `2 un-audited: ["overrides","references"]`; CHECKs 2–4 clean | yes |
| `verify-regex-census.ts` | `census entries: 5 \| HEAD scan: 5 \| working-tree scan: 5`, `missing 0`, `stale 0`, `unclassified 0`, `mislocated 0`, `PASSED` | yes |
| `verify-analyzer-docs.ts` | dart row `present: true`, `missingSections: []`, `ontologyGaps: []` | yes |
| `verify-honesty.ts` | `21 failure(s)`, and the only `dart` substring in the whole output is `dart-http` inside the PASSING `corpus pins present` line | yes — no dart file is named |
| `verify-doc-truth-emissions.ts` | still `ReferenceError: __dirname is not defined in ES module scope` under `npx tsx`; under `bun run` still `UNDOCUMENTED [dart] calls` pointing at `docs/analyzers/real-dart-analyzer.md:58` | yes, item 12 unchanged |

The three supervisor-owned artifacts those gates wrote to disk
(`docs/DOC-TRUTH-EMISSIONS.md`, `validation/m14/results/analyzer-docs.json`,
`validation/m60/results/rel-type-coverage.json`) were reverted uncommitted, as §Ownership
requires.

**The differential, at two rotations not yet recorded, and it is the 98.4% branch
again.** `--force-fresh`, one lane per invocation:

| lane | rotation | tree-truth / covered | ratio | MISSING | analyzer edges | unexplained | heuristic |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `proxicall:dart` | 80 | 6162 / 6062 | **98.4%** | **100** | 5,562 | **0** | 0 |
| `dart-http:dart` | 75 | 2277 / 2263 | **99.4%** | **14** | 2,106 | **0** | 0 |

So the ratio has now read 98.4% at rotations 73, 74 and 80 and 58.9% at 78 and 79 —
**four of five recorded rotations were the high branch** at the time of this pass,
which strengthened the bimodal reading rather than softening it, and the truth-row
denominators moved again (6,220 →
6,162 on proxicall, 2,280 → 2,277 on dart-http) exactly as the denominator-stability
paragraph above predicts. Every printed MISSING row on both lanes is `overrides`, which
is §DERIVATION predicting the residue by label rather than by count. `unexplained` is 0
on both lanes at both rotations, and that is the fifth consecutive reading of 0.
**The eighth pass added rotation 81 on the low branch, so the split is now 3 high to
3 low and "four of five" is superseded rather than merely extended** — see the eighth
pass below.

**Item 17 was re-verified mechanically rather than quoted, and both halves hold.**
The array was walked in declaration order with the spread files resolved through their
imports: **absolute index 80 is `PROTOBUF_MUTANTS[27]`, which is
`protobuf/qualified-id-stopped-being-published`** — the entry with no `language` field,
and the only one of that file's 30 entries without one. The total is 1,789, printed by
the scoped run itself, so 1,789 − 80 = **1,709 entries never execute**. The crash site
is as stated: `mutate-analyzer.ts:18843` calls `clean(m.language)` → `runLang(lang)` →
`path.join(FIXTURES_DIR, lang)` at `run-fixtures.ts:506`, which throws
`TypeError [ERR_INVALID_ARG_TYPE]` on `undefined`. For (b), `main()` reads
`process.env.BB_MUTANT_ONLY` and nothing else; the only two `process.argv` uses in the
file are ROOT derivation at line 36 and the `endsWith("mutate-analyzer.ts")` entrypoint
guard at line 18,920, so `bun run script/m14/mutate-analyzer.ts dart` cannot scope. One
detail is recorded as approximate: this walk puts the last `dart/` entry at 1,723 where
the item says 1,718, and the same walk totals 1,794 where the run prints 1,789 — five
`id:` lines are being counted that the runtime does not, so the walk's absolute indices
are reliable only up to the first `dart/` entry, which it places at **1,049**, matching
the item exactly. The figures 1,789, index 80 and 1,709 are the ones the verdict leans
on and all three come from the runtime or from the ordered spread walk, not from this
approximate total.

**The census wall time moved again and this is the second pass to say so.**
`wallMs` 553,290 = 9.22 min on the same 2,735 files and the same `BB_DART_CONC=1`, against
337,371 = 5.62 min recorded above — a 1.64x spread with every count byte-identical. That
is the third measurement of a machine-dependent quantity in this file (the other two
being the hang-probe parse times), and it is why no latency figure derived from a
single run of a corpus sweep is quoted here as a property of the analyzer.

**What was NOT re-run, and why.** The latency A/B was not repeated: it alternates two
analyzer blobs over 300 files × 4 runs, and `src/ast/real-dart-analyzer.ts` has not
changed since `8e86c8364` (2026-10-03 23:47), so its AFTER column still describes the
analyzer at HEAD and its BEFORE column is pinned to `8286c7391`. The live-corpus
`ProxiCall/lib` figures (1,294 files, 675,964 relationships) were not re-derived —
that checkout is outside this worktree and is not the sampled corpus. The
`--dart-deps` index table was not re-run; it is a harness-side option over the
differential's own corpus. `script/m14/incoming-check.ts` was not re-run in the
fourth pass: it is shared machinery, and the committed `incoming-census.ts` measures
the same direction over 4,788 files with the per-type and per-cause breakdown this
lane's report needs.

**`incoming-census.ts` WAS re-run in this pass, and it is the one instrument whose
numbers did not survive contact with the base.** The edge population is
byte-identical — 960,634 relationships and every per-type `emitted` count to the
unit — but every resolution cell moved, all of them toward resolving, and the totals
this document quotes for that section are now **pinned to `c48f381d1` and superseded**.
The mechanism is measured and is not in this lane's code: `src/ast/pool-worker.ts`
split its universal symbol-name denylist and stopped unconditionally dropping nine
names that are only reserved in *some* languages, and **every one of the nine is a
legal Dart identifier**. Dart declarations carrying those names are now published —
`symbolsNamedUnknown` goes 0 → 74, total symbols 337,336 → 337,440 — so targets that
bound to nothing now bind. The corrected figures, the per-cell deltas and the
directions are tabulated under *Ambiguity* above. Read that section as a record of one
tree, not as this lane's present state.

The 2026-10-01 state was: both differential lanes at `--dart-deps=direct` plus the
vendored Dart SDK library tree, `proxicall:dart` 29,203/29,203 (100%) MISSING 0, and
`dart-http:dart` 2,288/2,288 (100%) MISSING 0. **That reading does not reproduce on this
checkout, and the reason is dated.** `script/m14/differential.ts:23153` carries its own
comment: on **2026-10-02**, a branch consolidation "took the REMOTE side", which drops
`overrides` from the compared set for dart as well as csharp/swift/cpp/go. The allowlist
filters the ANALYZER side only, so every `overrides` truth row now lands as a permanent
MISSING — which is the DERIVATION finding above, showing up in a coverage number.

Re-measured on this branch, both lanes at the default `--dart-deps=none`:

| lane | coverage | MISSING | unexplained | re-measured |
|---|---|---|---|---|
| proxicall:dart | 6120 / 6220 (98.4%) | **100** | 0 | 2026-10-04 (superseded — see below) |
| dart-http:dart | 2263 / 2277 (99.4%) | **14** | 0 | 2026-10-04 (superseded — see below) |

**CORRECTED 2026-10-04, later the same day: the 98.4% is one of TWO MODES, and
the second one is 58.9%.** Two further `--force-fresh` runs on this branch, at
rotations 78 and 79:

| run | proxicall truth/covered | ratio | MISSING | analyzer edges | unexplained |
|---|---|---|---|---|---|
| rotation 78 | 29131 / 17196 | 59.0% | **11935** | 16604 | 0 |
| rotation 79 | 29066 / 17131 | 58.9% | **11935** | 16549 | 0 |

MISSING rose from 100 to **11,935** — a factor of 119 — on the same code, the same
corpus and the same analyzer, and the section above had recorded coverage
percentage, MISSING and unexplained as "identical across rotations". They were
identical across *those two adjacent* rotations and are not identical across the
range. The generalisation was the error, and it was made from n=2.

**The mechanism is measured, not inferred.**
`validation/m14/fixtures/dart/differential-rotation-instability.ts` walks the parse
tree of `proxicall` and counts the population behind the swing:

```
tracked .dart files 2351
base  lib/l10n/generated/app_localizations.dart   class AppLocalizations: 5355 member names
generated subclasses carrying a base member name:
  files 38 of 2351 tracked (1.616%)
  own members across them            225,264
  members whose name the base declares 5,353 PER FILE, every one of the 38
P(a 60-file draw contains NONE)  3.762e-1
P(at least one)                  0.6238
```

So 1.6% of the repository's files each carry **5,353** `overrides` truth rows, a
60-file draw contains one with probability **62.4%**, and `11935 / 5353 = 2.2`
files' worth. The harness's own capped MISSING sample agrees: 11 of its 12 printed
rows are `app_localizations_bn.dart`. The 98.4% reading is the `P(none) = 37.6%`
branch and the 58.9% reading is the other branch, and **which one you get is decided
by a rotation counter, not by the analyzer.** `overrides` is the label the allowlist
drops for dart (§DERIVATION), so every one of those rows is a permanent MISSING by
construction — a property of the harness's label set meeting a generated-code
population, not a coverage fact about this lane.

`dart-http` moved too and by less: 2277/2263 MISSING 14 in the earlier session,
2287/2262 MISSING 25 now, at a nominally identical `rot 74`. The draw hash is
`549143339f0cfaa9` in both of today's runs and in neither recorded session, so the
rotation counter is not the only thing that moved between sessions. **The absolutes
in this section are not reproducible across sessions; the claim under them is.**

What survives every rotation and both sessions, and is what the verdict rests on:
**`unexplained` is 0 on both lanes in all six `--force-fresh` runs recorded here.**
That is the number that says the analyzer emits nothing uncorroborated, and it has
never moved. Coverage percentage and MISSING are properties of the draw.

The same caveat applies to the denominator's own stability, for the same reason.
`script/m14/differential.ts` picks the 60 files per lane with `coldPoolPick`, which
by design "draws never-sampled files each wave" and advances a per-lane rotation
counter on every run (`differential.ts:927-950`, seeded per rotation so it is
reproducible *within* a rotation and different *across* one). The two runs quoted
immediately above:

| run | proxicall truth/covered | dart-http truth/covered | ratio | MISSING | unexplained |
|---|---|---|---|---|---|
| rotation 73 | 6220 / 6120 | 2280 / 2266 | 98.4% / 99.4% | 100 / 14 | 0 / 0 |
| rotation 74 | 6162 / 6062 | 2277 / 2263 | 98.4% / 99.4% | 100 / 14 | 0 / 0 |

So the truth-row count moved by **58** on proxicall and **3** on dart-http between
two runs of identical code on an identical corpus. An earlier reading of this file
quoted the same absolutes as if they were fixed, which is how a rotating sample
becomes a lane property; the swing above is the same failure at a larger amplitude.

Both MISSING counts on those two runs are what §DERIVATION predicts (100 on the
60-file proxicall sample, 14 on dart-http), and both are entirely the excluded label
— the harness prints a capped 12-row sample and all 12 printed rows are `overrides`
on each lane, and `overrides` is the only label the allowlist drops for dart, so the
remaining rows cannot be anything else. `unexplained` is 0 on both lanes, which is
the number that means the ANALYZER is not at fault: nothing it emits is
uncorroborated.

`--dart-deps=direct` on this checkout reports `[project-index] dart deps=direct: +0
dependency files` — the vendored SDK tree resolves 439 files and 3,574 types (against
1,012 at `none`), but no package dependency does — and moves dart-http to
2290/2309 (99.2%) MISSING 19, unexplained 0. **It makes the MISSING count worse, not
better**, because a larger type index satisfies more override truth rows without
re-admitting the label. The 100% figure is reachable only by wiring `overrides` into
the compared set, which is §Shared-machinery item 2.

**What the 2026-10-01 state did establish, and still holds:** `unexplained` is 0 on both
lanes in every mode measured here, which is the claim that matters — every analyzer edge
either corpus measures is corroborated by independently derived truth, and the truth
publishes nothing the analyzer does not. The MISSING rows are the harness refusing to
compare a label, not a gap in the analyzer.

The last row to go was `CupertinoClientWithProfile._createProfile ->
CupertinoClient._createProfile`, and it had been misfiled as a reach problem — the
base is in the SAME file. The `isStatic` predicate reached to `previousNamedSibling`
and read that node's children, so `static Future<...> _hasData` rendered the ordinary
`_createProfile` after it static too, and the oracle's index held six of the class's
eight methods. A gate that misidentifies its subject does not fail loudly: it stops
counting, and the count is the only thing anyone reads.

### An eighth pass, and the one instrument that did not reproduce is this file's own table

Run in this pass, on this branch, every instrument above. **Reproduced exactly:** the
arbiter at n=120 (`9/10 fired, 8290 edges, 120/120 files`, `degraded 0`,
`notFired: ["exports"]`) and at n=400 (`10/10 fired, 53252 edges, 400/400 files`,
`degraded 0`); all ten census counts over 2,735 files (43,042 / 110,679 / 119,515 /
10,657 / 5,265 / 302 / 4,730 / 758 / 90,352 / 18,374), 134,606 symbols, 403,674
relationships, all four zero-fields, all twelve symbol kinds and all ten breadth rows;
the `zero-contains` accounting at 1,039; `export-population-probe` at 33,753 files /
679 (2.012%) / 2,040 nodes / 1 in ERROR / base rate 2.0117% / P(none)=0.0873 /
n≥148 and 0 export-bearing files in the arbiter's own 120-file draw;
`type-position-probe` at 75,769 mentions / 3,460 resolvable / 4.57% over 816 names /
1,000 files / 325 node types; the `references` oracle at 1,203/1,203 over 799 files
with missing 0 and unexplained 0; `hang-file-innocence` at 7 of 7 clean with every
symbol/rel count identical (32/136, 3/20, 9/84, 3/29, 3/20, 27/27, 3/21); 16/16
fixtures; 42/42 mutants; the 37/37, 14/14 and 38/38 shape batteries; the lane regex
census at 0 over 19 files / 8,560 lines and the repository census PASSED at 5/5/5;
`rel-type-coverage-gate --langs=dart` at 2 un-audited `["overrides","references"]`
with checks 2, 3 and 4 clean; `verify-honesty` at 21 failures with **zero naming a
dart file**; `differential-rotation-instability` at 38 of 2,351 files, 5,353 per file
and P(at least one) = 0.6238; and `incoming-census` at 337,440 symbols, 960,634
relationships, 74 `symbolsNamedUnknown`, 490,292 ambiguous, 296,855 closable,
143,833 binding to nothing and 1,817 unexplained.

**The differential ran at rotation 81 (proxicall) and 76 (dart-http) and reproduced
rotation 78's row exactly** — proxicall `29131 / 17196`, **59.0%**, MISSING **11935**,
16,604 analyzer edges, **unexplained 0**, draw hash `ab7eff6c5dba53fa`, and
`dart-http` at `2287 / 2262`, 98.9%, MISSING **25**, unexplained 0, draw hash
`549143339f0cfaa9`. **A rotation three apart drawing the identical 60 files, to the
analyzer-edge count, is not what "advances a per-lane rotation counter" predicts**, and
this file should say so rather than leave the reader to assume the counter varies the
draw on every tick: `differential.ts:927-950` seeds per rotation, and seeds 78 and 81
evidently select the same set. The doc's own bimodality argument does not depend on it
— what matters is that both branches were observed and `unexplained` was 0 on each —
but a reader checking the mechanism will find this. That is the sixth recorded
rotation and it lands on the 58.9–59.0% branch again, so the ratio has now read
**98.4% at rotations 73, 74 and 80 and 59.0% at 78, 79 and 81** — three high, three
low, which is the bimodality with an equal split rather than the 4-of-5 the seventh
pass could claim.

**What did not reproduce is this file's own 10×9 incoming table, and the failure is
the one this file has now made three times: a quoted instrument block is a
measurement of the tree at a commit, and it was quoted as a reading of HEAD.** The
edge population is still byte-identical — all ten per-type `emitted` counts match to
the unit, as they did in the sixth pass — and **66 of the 90 resolution cells still
match exactly**, with `imports`, `exports`, `extends`, `implements` and
`instantiates` unchanged in all nine columns each. The other **24 cells moved**, all
toward resolving:

| type | cell | pinned `c48f381d1` | this pass | Δ |
|---|---|---|---|---|
| calls | both ends, sample | 55,772 | 55,786 | +14 |
| calls | both ends, repoFull | 48,111 | 48,125 | +14 |
| calls | target unique | 18,993 | 18,995 | +2 |
| calls | target crowded | 30,478 | 30,497 | +19 |
| calls | target binds to nothing | 25,707 | 25,686 | −21 |
| uses | both ends, file | 56,417 | 56,465 | +48 |
| uses | both ends, sample | 158,944 | 159,039 | +95 |
| uses | both ends, repoFull | 137,653 | 137,748 | +95 |
| uses | target unique | 33,842 | 33,843 | +1 |
| uses | target crowded | 106,083 | 106,220 | +137 |
| uses | target binds to nothing | 53,553 | 53,415 | −138 |
| contains | both ends, file | 310,923 | 310,925 | +2 |
| contains | both ends, sample | 310,923 | 310,925 | +2 |
| contains | both ends, repoFull | 292,025 | 292,027 | +2 |
| contains | target unique | 14,197 | 14,198 | +1 |
| contains | target crowded | 285,604 | 285,605 | +1 |
| contains | target binds to nothing | 2 | 0 | −2 |
| references | both ends, file | 10,049 | 10,050 | +1 |
| references | both ends, sample | 10,131 | 10,132 | +1 |
| references | both ends, repoFull | 7,468 | 7,469 | +1 |
| overrides | both ends, sample | 232,941 | 232,979 | +38 |
| overrides | both ends, repoFull | 230,467 | 230,505 | +38 |
| overrides | target unique | 232,736 | 232,774 | +38 |
| overrides | target binds to nothing | 14,394 | 14,356 | −38 |

**Two of those 24 were already recorded in the delta table under *Ambiguity* — the two
`overrides` rows it names — and 22 were not.** The six totals that section corrected
(symbols, `symbolsNamedUnknown`, ambiguous, closable, noSymbol, unexplained) were
correct on the sixth pass and are correct again here, to the unit; what it under-
reported was the per-cell movement underneath them. The direction is uniform and is
the same one the sixth pass measured: `src/ast/pool-worker.ts` stopped dropping nine
names that are only reserved in *some* languages, every one of them a legal Dart
identifier, so declarations carrying them are published and targets that bound to
nothing now bind. `src/ast/real-dart-analyzer.ts` is byte-identical across the two
trees — `git diff c48f381d1..origin/analyzers/ontology-laptop-b` over it is empty —
and the identical edge counts are the proof that this analyzer's output did not move.

**The table above is therefore left pinned and labelled pinned, and its per-cell
successors are recorded here rather than written over it**, because a pinned table plus a
delta is a record two trees can both be read against, and an overwritten table is a
claim about one. The honest summary of the incoming direction is the
post-merge column, and it is in the delta table under *Ambiguity* plus the 24 rows
above.

### A ninth pass, which reproduced every figure and found the question nobody had asked

Every instrument re-run on this tree, in the foreground and sequentially. **Reproduced
exactly:** the arbiter at n=120 (`9/10 fired, 8290 edges, 120/120 files`, `degraded 0`,
`notFired: ["exports"]`) and at n=400 (`10/10 fired, 53252 edges, 400/400 files`,
`degraded 0`); all ten census counts over 2,735 files (43,042 / 110,679 / 119,515 /
10,657 / 5,265 / 302 / 4,730 / 758 / 90,352 / 18,374), 134,606 symbols, 403,674
relationships, all four zero-fields (`emptySymbolNames 0`, `emptyOrUnknownKind 0`,
`unknownEndpoints 0`, `symbolsNamedUnknown 20`), all twelve symbol kinds, all ten breadth
rows with their five-repo spreads, and every cell of the nine-column resolution table; the
incoming census at 337,440 symbols / 960,634 relationships / 74 `symbolsNamedUnknown` /
490,292 ambiguous / 296,855 closable / 143,833 binding to nothing / 1,817 unexplained /
67 excluded fallback edges, and all ten per-type resolution columns including the 24 cells
that moved in the eighth pass; 16/16 fixtures; 42/42 mutants; 37/37, 14/14 and 38/38 shape
batteries; the lane regex census at 0 over 19 files / 8,560 lines; the repository regex
census `PASSED` at 5/5/5; `rel-type-coverage-gate --langs=dart` at 2 un-audited
`["overrides","references"]` with checks 2–4 clean; `verify-analyzer-docs` with dart's row
`missingSections: []`, `ontologyGaps: []`; and `verify-honesty` at 21 failures with the
only `dart` substring in the whole output being `dart-http` inside the PASSING
`corpus pins present` line.

**The differential ran at rotation 81 (proxicall) and 76 (dart-http), and both reproduce
recorded draws exactly** — proxicall draw hash `ab7eff6c5dba53fa`, `29131 / 17196`,
59.0%, MISSING **11935**, 16,604 analyzer edges, **unexplained 0**; dart-http draw hash
`549143339f0cfaa9`, `2287 / 2262`, 98.9%, MISSING **25**, **unexplained 0**. That is the
seventh and eighth recorded rotations and the split remains **three high, three low**, with
`unexplained` 0 on every one of them.

**What the pass found is two defects, and they are above under *Two suppressed-edge
defects the ninth pass found*.** One is in this lane's file and one is not, and the reason
this pass found them after eight that did not is that every earlier pass asked whether the
analyzer EMITS an edge while both defects are about an edge that is emitted and then
deleted. The new instrument compares published symbols against published `contains` edges
and files the difference by name; on the census sample it reads **31 suppressed pairs**, and
`unknown` (19, R7's name test) plus the four angle-bracket operator tokens present in that
draw (12, `filterNoiseRelationships`'s leaf ban) account for all of them, with the probe's own
residual line reading 0. An earlier version of that figure — 45 pairs over a 2,531-file draw
— is withdrawn above, and the reason is a stride mismatch rather than a change in the corpus.

Two figures in this file are now known to be measured against an analyzer that emits MORE
than production delivers, which is worth stating plainly because it applies to every count
above: **`contains` is emitted for all 11 members of `SourceLocation` and 7 are delivered**
(re-verified this pass by calling `analyze()` on the tree from `ASTEngine.parseTree` — 11
symbols / 11 edges — against production `parseFile`, 11 symbols / 7 edges, the four lost
being `operator <`, `>`, `<=`, `>=`).
The census's `unknownEndpoints 0` is likewise a reading of the analyzer's own filter rather
than of the pipeline's, which is how a filter that deletes true edges reports a clean zero.

**The incoming census re-ran at 4,788 files and reproduced all four aggregate totals to the
unit**, recomputed here from the per-type columns rather than read off a summary:
`960,634` relationships, `337,440` symbols, `symbolsNamedUnknown 74`, `emptySymbolNames 0`,
`emptyOrUnknownKind 0`, `unknownEndpoints 0`, 67 degraded-fallback `calls` edges excluded,
`4,788` files with `26` carrying parse errors (`457` error nodes). The four figures the
delta table below is built on, summed from the per-type rows: ambiguous **490,292**
(= 63,015 at 2–5 + 427,277 at 6+), closable by `<source>.<target>` **296,855**
(= 296,727 `contains` + 128 `uses`, and the two agree: `contains` reads 296,727 ambiguous
AND 296,727 qualified-by-source, i.e. every ambiguous `contains` target is already
disambiguated by its owner), no-symbol **143,833**, `unexplained` **1,817**
(23 `calls`, 73 `uses`, 1 `extends`, 9 `implements`, 1,670 `overrides`, 41 `instantiates`).

**Deliverable C's split is unchanged and is the honest version of "143,833 unresolvable".**
Of the no-symbol population, only the `unexplained` 1,817 is the class that would be a defect;
the rest, summed here over the per-type rows: `packageDeclared` **79,629** are names in an
imported `package:`/`dart:` dependency, `localNotPub` **25,657** are tagged `isLocalRead` — a
binding the family contract does not publish (DARTD8) — `uriEndpoint` **22,909** are
`imports`/`exports` module paths by design, `sdkDeclared` **12,281** are published by files
under `dart-sdk/sdk/lib` that this run does not index, and `outsideSample` **1,540** are in
SAMPLE-scope repos where absence proves nothing. `25,657 + 22,909 + 79,629 + 12,281 + 1,540 +
1,817 = 143,833`, so the split accounts for the population exactly with nothing unattributed —
which is the property that makes "143,833 unresolvable" a reportable number rather than a
symptom of a broken count.
**The `overrides` unexplained population is 1,670 of 14,356 no-symbol targets (11.6%) and is
the largest single defect class in the lane** — see §Shared-machinery item 18 for the
measurement and why it is a missing edge rather than a wrong one.

The census wall time moved again and nothing else did: `wallMs` 634,711 = 10.58 min here
against 337,371 = 5.62 min and 553,290 = 9.22 min recorded above, on the same 2,735 files
with every count byte-identical — a 1.88x spread, the fourth measurement of a
machine-dependent quantity in this file and the reason none of them is quoted as an analyzer
property. The incoming census read `wallMs(walk)` 1,582,337 = 26.4 min against 615,539 and
995,723 previously, a 2.57x spread, with 960,634 relationships reproduced exactly.

### A tenth pass, which found the first defect in this file's own provenance

Every instrument re-run on this tree, in the foreground, sequentially, no polling.

**Reproduced exactly:** the arbiter at n=120 (`9/10 fired, 8290 edges, 120/120 files`,
`degraded 0`, `exports` absent from the fired list) and at n=400
(`10/10 fired, 53252 edges, 400/400 files`, `degraded 0`); all ten census counts over
2,735 files (43,042 / 110,679 / 119,515 / 10,657 / 5,265 / 302 / 4,730 / 758 / 90,352 /
18,374), 134,606 symbols, 403,674 relationships, all four zero-fields
(`emptySymbolNames 0`, `emptyOrUnknownKind 0`, `unknownEndpoints 0`,
`symbolsNamedUnknown 20`), all twelve symbol kinds, all ten breadth rows with their
five-repo spreads, and every cell of the nine-column resolution table; the incoming
census at 337,440 symbols / 960,634 relationships / 74 `symbolsNamedUnknown` / 490,292
ambiguous / 296,855 closable / 143,833 binding to nothing / 1,817 unexplained / 67
excluded fallback edges / 26 files with 457 error nodes, recomputed here from the
per-type rows rather than read off a summary; 16/16 fixtures; 42/42 mutants; 37/37,
14/14 and 38/38 shape batteries; the lane regex census at 0 over 20 files / 8,764 lines;
the repository regex census `PASSED` at 5/5/5; `rel-type-coverage-gate --langs=dart`
at 2 un-audited `["overrides","references"]` with checks 2–4 clean;
`verify-analyzer-docs` with dart's row `missingSections: []`, `ontologyGaps: []`; and
`verify-honesty` at 21 failures with **zero naming a dart file**.

**The differential ran at rotation 86 (proxicall) and 80 (dart-http), and both reproduce
the recorded HIGH branch** — proxicall draw hash `d8b3093137451c30`, `6220 / 6120`,
**98.4%**, MISSING **100**, 5,618 analyzer edges, **unexplained 0**; dart-http draw hash
`bc95ba8a87ca1bbc`, `2277 / 2263`, **99.4%**, MISSING **14**, 2,106 analyzer edges,
**unexplained 0**. Neither hash is recorded in this file, and the proxicall denominator
is back to the 6,220 the rotations 73 and 74 read rather than the 29,131 of the low
branch. **So the ratio has now read 98.4% at rotations 73, 74, 80 and 86 and 59.0% at 78,
79 and 81 — four high, three low — and `unexplained` is 0 on all seven.** The MISSING
counts are 100 and 14, which is what §DERIVATION predicts for these two lanes
independently, and every one of the 12 printed `proxicall` rows is `overrides` as before.

**What the pass found is a provenance error in this file, and it is the first defect here
whose subject is the document rather than the analyzer.** For six commits — from
`cdffad991` (2026-10-04 02:45) through `e0b8d5b36` — this file stated twice that
`firing-check.ts` and `incoming-check.ts` "are NOT on this branch" and that both were run
from a copy staged under `/tmp` and removed afterwards. **Both files are tracked, and both
were run directly from the branch's own copies this pass with no staging at all.**
`git cat-file -e HEAD:script/m14/firing-check.ts` and `…incoming-check.ts` both succeed;
`incoming-check.ts` was added at `46bcd17d5` (2026-10-03 18:42) and `firing-check.ts`
reached this branch through the base merge `3868c4411` (2026-10-04 17:12), four merges
after the claim was written. The readings the claim supports are unaffected — every
figure it qualifies reproduced to the edge — but the sentence told a reviewer to stage a
copy of a file that was already in their tree, and the remedy it offered for item 7 ("land
that commit") had already been applied four merges earlier without this file noticing.
That is the same failure the ninth pass recorded for `unknownEndpoints 0` — a reading of
one state outliving the state it measured — and the mechanism that let it survive six
commits is that a claim about WHERE AN INSTRUMENT LIVES is checkable in one command, so
it never needed a corpus sweep to test and so nobody tested it.

The corrected paragraphs are at *the supervisor's arbiter reads 9/10 at n=120* and at
*Ambiguity*. Both arbiter JSON defects the claim rests on were re-verified mechanically
rather than quoted, and both still hold: `analyzerDigest` reads
`MISSING:/…/script/ast/real-dart-analyzer.ts` — the function joins `path.join(here, "..",
"ast", …)` where `here` is `script/m14`, so it asks for `script/ast/` and never
`src/ast/` (`firing-check.ts:205-217`), which also makes `analyzerStableDuringRun` true
vacuously because a missing file cannot change mid-run; and `types[type].files` reads
**1 for every type that fired and 0 for `exports`**, because `filesByType` is declared
INSIDE the per-file loop at `firing-check.ts:334` and consumed at `:380`, so each file
overwrites the previous file's set. The `0` for `exports` is the same bug read from the
other side: a type that fired nowhere has no set to carry a 1. Neither affects the fired
count, the edge count, `degraded`, or the four zero-safety fields.

The 7-file ambiguity sample also moved, and is recorded as a superseded row rather than an
overwritten one — see *Ambiguity*.

**The census wall time moved again and nothing else did:** `wallMs` 441,835 = 7.36 min
here against 337,371 / 553,290 / 634,711 recorded above, on the same 2,735 files with
every count byte-identical — a 1.88x spread, the fifth measurement of a machine-dependent
quantity in this file. The incoming census read `wallMs(walk)` 889,750 = 14.8 min against
615,539 / 995,723 / 1,582,337 previously, a 2.57x spread, with 960,634 relationships
reproduced exactly.

### Two member-predicate rules that must stay scoped to the member

- **A static member is not overridable** — Dart resolves a static call against the
  static type it was written on, and `@override` is not legal on one. But `static` is
  a keyword on a member's OWN declaration, so the predicate must never look at a
  sibling: doing so turns the first `static` in a class into a cascade that hides
  every member after it.
- **A base FIELD is a witness for an ACCESSOR override, and an instance field shadowing
  a base field is a real override** — a field implicitly provides a getter. An instance
  field after a static one was the mirror of the cascade above, and it fabricated in
  the opposite direction.

Every analyzer edge either corpus measures is corroborated by independently derived
truth, and the truth publishes nothing the analyzer does not — `unexplained` is 0 on both
lanes in every mode measured on this branch. **The "no missing row" half of this sentence
no longer holds and was correct only before 2026-10-02**: the 100 and 14 MISSING rows
measured above are `overrides` truth rows the compared-label filter refuses to admit, not
edges the analyzer failed to emit.

Fixtures **16/16** (13 before this wave added `type-references`,
`object-interface-override` and `unknown-endpoint-r7`), `verify-dart-contains.ts`
**37/37**, `verify-dart-overrides.ts` **14/14**, `verify-dart-references.ts` **38/38
shapes, both sides**, mutants **42/42 caught**, regex census **0 over the 16
lane-owned files** (17 scanned, the census being one of them), parse 0 errors on 1,294
`lib` files, 2.0 min for the full corpus.

Both oracle batteries are DIFFERENTIAL — each case asserts the oracle AND the
analyzer against the same expected rows. `verify-dart-contains.ts` used to derive
the oracle and compare it to nothing, which cannot catch a rule the oracle gets wrong
and the analyzer gets right; a corpus run cannot either, because the harness shows an
UNEXPLAINED row and the reader must already know the answer to say which side is
wrong.

### The dependency index, and what it bought

| mode | types indexed | proxicall unexplained |
|---|---|---|
| `--dart-deps=none` (default) | 4,465 | 40 |
| `--dart-deps=direct` | 11,312 | 3–7 |
| `--dart-deps=all` | 27,784 | 4 |
| `direct` + the SDK library tree | 13,846 | **0** |

The SDK libraries are NOT unreachable, and this file said otherwise for a commit: the
SDK vendored in the Flutter SDK has them at `<flutter>/bin/cache/dart-sdk/lib` (439
files), and `WebSocket` lives in `lib/_http/websocket.dart`, an internal library — so
indexing the `lib/` TREE is what finds it, not "the dart:io library".

### The rules the `overrides` resolution turns on

Each is pinned by `verify-dart-overrides.ts` (14 shapes, each recording the corpus row
that exposed the defect) and, where the rule is analyzer-side, by
`dart/override-witness-shapes` — which carries a negative twin per rule, because
deleting a gate removes edges and an expect-only fixture would not notice.

- **Exposer, not declarer.** A base that INHERITS a member is where the override
  lands. The analyzer's in-file path and its companion path answered this differently,
  so the same file got a different edge depending on whether an index was supplied.
  `declares()` is inheritance-closed over `extends`/`implements` — not `uses`, which
  is evidence a type is relevant, not that it is a base.
- **Instance means overridable; static means not.** An instance field provides a
  getter, so `final String walletId` over a base `walletId` is a real override, and so
  is `@override String get walletId`. A static member overrides nothing: a static call
  resolves against the static type it was written on, and `@override` is not legal
  there.
- **`@override` belongs to the FALLBACK only.** It is an optional lint, not a language
  requirement. A companion-verified match is evidence and needs no annotation; the 0.8
  first-parent guess has no evidence either way and does.
- **Breadth, not depth.** A companion that knows a base but that lacks the member ends
  the walk FROM THAT BASE — a flat map holds none of its bases — not the walk over the
  other supertypes already collected.
- **`extends` and `with` share one clause**, with the `with` list inside the
  `superclass` node, not beside the declaration.
- **A base the file, or the index, proves lacks the member is refuted.** Without
  evidence the fallback may fire; against evidence it may not.

### Two DECISIONS, not RULED verdicts

Neither of these is a `RULED` verdict in the §Verdicts sense: no relationship type is
ruled in this lane. They are label-placement and scope choices, recorded here because
both were available to state as rulings and neither is one.

**`part of` stays in `imports`.** It names the file's PARENT, so the edge states the
dependency backwards. Kept anyway: every module-level URI is then one edge class, a
consumer gets one answer instead of three, and 24 rows does not justify a class every
reader must learn. One line in the oracle plus the analyzer to change.

**Record literals are not symbols.** `Point(1, 2)` is a constructor CALL; its
positional fields are not member reads, so there is nothing to contain. Reading the
field names as declarations would publish a `contains` edge for a type the file never
declares — the exact error class this lane spent its existence removing. The 249 live
occurrences stay unread.

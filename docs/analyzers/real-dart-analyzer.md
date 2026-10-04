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
against the pre-M14 commit (`git show HEAD:src/ast/real-dart-analyzer.ts`) under the
same harness, so every delta is measured rather than argued.

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
`qualified` 646 (the leaf of `prefix.Type`), and 28 further positions.

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
| exports | EMITTED | 302 | same |
| extends | EMITTED | 4,730 | same |
| implements | EMITTED | 758 | same |
| overrides | EMITTED | 90,352 | same |
| instantiates | EMITTED | 18,374 | same |

Corpus: `proxicall` (600 of 2,351 tracked, stride 3), `riverpod` (600 of 1,295,
stride 2), `flutter-packages` (600 of 4,033, stride 6), `dart-sdk` (600 of 25,734,
stride 42), `dart-http` (all 335). Sampling is a deterministic stride over
`git ls-files '*.dart'` sorted, per repository — no randomness, so a reviewer
reproduces the same 2,735 file set from a clean corpus.

Reproduce:

```bash
BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/census.ts    # the table above
npx tsx validation/m14/fixtures/dart/type-position-probe.ts      # the position inventory
npx tsx script/m14/verify-dart-references.ts                     # 38 shapes, both sides
BB_DART_PER_REPO=150 npx tsx script/m14/verify-dart-references.ts --corpus
bun run script/m14/run-fixtures.ts --lang dart                  # 16 fixtures
BB_MUTANT_ONLY="dart/" bun run script/m14/mutate-analyzer.ts      # 42/42 caught
```

The incoming pass (§The incoming direction) has its own instruments, and they use a
different sample on purpose — a symbol table that is itself a stride cannot answer a
cross-file resolution question:

```bash
BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/incoming-census.ts   # the incoming tables
bun run validation/m14/fixtures/dart/object-interface-mutant.ts          # 4/4 mutants caught
bun run script/m14/verify-dart-contains.ts                               # 37 shapes
bun run script/m14/verify-dart-overrides.ts                              # 14/14 shapes exact
bun run script/m14/verify-dart-references.ts                             # 38 shapes, both sides
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
| calls | ✅ | ✅ 43,042 | ✅ differential, 60-file proxicall sample: 6,120/6,220 truth rows covered, **0 unexplained** | ✅ | src∈file 99.1% · tgt∈file 22.1% · both∈sample 66.6% · both∈repo 50.8% | 35 of 43,042 under 0.7 (0.1%), min 0.4 — sub-threshold `uses`-style reads inherited from the shared bare-read surface |
| uses | ✅ | ✅ 110,679 | ✅ same run, 0 unexplained | ✅ four surfaces, each pinned by a fixture; no surface borrows another's label | src∈file 99.3% · tgt∈file 25.5% · both∈sample 69.2% · both∈repo 60.1% | 13,325 of 110,679 under 0.7 (12.0%), all the bare-read surface at 0.6 — the largest heuristic class in the lane |
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
  label ahead of its wiring. The oracle exists and the battery is green; the
  allowlist drops the label, so the 5,265 rows are compared by nothing.
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
337,336 symbols   960,634 analyzer relationships   BB_DART_CONC=1   wall 995,723 ms
26 files carry 457 ERROR-node parse errors; 4 files >1 MB go to the fallback
67 edges EXCLUDED as degraded-fallback output (below)
emptySymbolNames 0   emptyOrUnknownKind 0   symbolsNamedUnknown 0   unknownEndpoints 0
```

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
12. **`imports` and `exports` targets are module URIs and bind to no symbol by
    design.** 22,909 rows, 100% of both labels. `package:flutter/material.dart:*`
    and `../core.dart` are paths, not declarations, and the M49 exports invariant
    deliberately keeps an exported FILE out of the bindable export list. A reader
    looking for a resolved import target will find none and should read the URI.
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

Eight changes outside this lane's ownership, each stated so it can be applied
without re-deriving it. The files are supervisor-owned per
`docs/analyzers/ONTOLOGY-WORKSTREAM.md` §Ownership. Items 1–5 predate this pass;
6–8 come from measuring the incoming direction.

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
   `emitted 10/10` and exits 0. Measured run today (exit 2):
   ```
   ontology coverage gate — dart
   corpus: 563 admitted files

   ontology coverage gate — no RULING TABLE for dart.
   ```
   Note the corpus: the gate walks every tracked file in every corpus repo and
   parses them all, which for this language is **37,753 `.dart` files** across 6
   repositories. At the 0.157 s/file this lane measures through `parseFile`, that is
   ~1.6 h for the emission pass plus a second full parse for instrument A. The run
   above used `BB_CORPUS_ROOT` pointed at a 565-file symlink sample so it would
   finish; the full-corpus run was not performed, and that is a limit of this
   report rather than a claim about it.
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
     Rate: 1 file in 2,735 sampled (0.037%). What it must do: abort that file's parse
     and return an error for it, rather than exiting the process; the indexer is
     incremental by design and this makes one pathological file lose the whole run.
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
8. **`script/m14/verify-honesty.ts` fails project-wide on evidence freshness, and
   this lane is not the cause.** The run on this branch reports
   `honesty gate: 23 failure(s) — release blocked`, all of the form
   `HONESTY-GATE FAIL: M14.0.F<n>: <k> declared input(s) changed since <sha> —
   regenerate`, plus `evidence freshness: 0 artifact(s) current against their
   declared inputs`. The failing input sets name files this lane has never touched
   — `src/ast/analysis-exclusions.ts`, `src/ast/brain-surgical-patcher.ts`,
   `src/ast/dependency-graph-visualizer.ts`,
   `src/ast/cross-language-migration-assistant.ts`, and 20 other languages'
   `script/m14/spec/*-completeness.json` — all verified unchanged between
   `887f8eb0` and this branch's HEAD. Regeneration is the supervisor's: those
   artifacts are `validation/m14/results/*.json`, which the honesty contract §5.1
   reserves for verifier scripts, and regenerating them from one lane would replace
   the milestone's claim with a single lane's. Reported, not worked around.

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
- Fixtures (current): `validation/m14/fixtures/dart/` — 16, and the harness reports `summary: {"dart":{"pass":16,"fail":0}}` with no baseline regression

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

## Final measured state (2026-10-01)

Both differential lanes, `--dart-deps=direct` plus the vendored Dart SDK library
tree, from runs reporting `files=` (never `RESUMED from journal`):

| lane | coverage | MISSING | unexplained |
|---|---|---|---|
| proxicall:dart | **29203 / 29203 (100%)** | **0** | **0** |
| dart-http:dart | **2288 / 2288 (100%)** | **0** | **0** |

**No residual row.** Every analyzer edge either corpus measures is corroborated by
independently derived truth, and the truth publishes nothing the analyzer does not.

The last row to go was `CupertinoClientWithProfile._createProfile ->
CupertinoClient._createProfile`, and it had been misfiled as a reach problem — the
base is in the SAME file. The `isStatic` predicate reached to `previousNamedSibling`
and read that node's children, so `static Future<...> _hasData` rendered the ordinary
`_createProfile` after it static too, and the oracle's index held six of the class's
eight methods. A gate that misidentifies its subject does not fail loudly: it stops
counting, and the count is the only thing anyone reads.

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
truth, and the truth publishes nothing the analyzer does not. No unexplained row and
no missing row on either corpus.

Fixtures **13/13**, `verify-dart-contains.ts` **37/37**, `verify-dart-overrides.ts`
**14/14**, mutants 42/42, parse 0 errors on 1,294 `lib` files, 2.0 min for the full
corpus.

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

Each is pinned by `verify-dart-overrides.ts` (12 shapes, each recording the corpus row
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

### Two rulings

**`part of` stays in `imports`.** It names the file's PARENT, so the edge states the
dependency backwards. Kept anyway: every module-level URI is then one edge class, a
consumer gets one answer instead of three, and 24 rows does not justify a class every
reader must learn. One line in the oracle plus the analyzer to change.

**Record literals are not symbols.** `Point(1, 2)` is a constructor CALL; its
positional fields are not member reads, so there is nothing to contain. Reading the
field names as declarations would publish a `contains` edge for a type the file never
declares — the exact error class this lane spent its existence removing. The 249 live
occurrences stay unread.

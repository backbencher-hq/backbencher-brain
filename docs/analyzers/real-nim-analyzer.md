# real-nim-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-nim-analyzer.ts`
- Grammar: `wasm/tree-sitter-nim.wasm`, sha256 `421369fe6a8814dd...`, 5,797,624 B
- Pinned source: `alaviss/tree-sitter-nim@0.6.2`, commit
  `ac72ba30d16edf0be021588a9301ede4accd6cf4`, vendored byte-for-byte at
  `grammars/tree-sitter-nim/`; pinned by the `nim` lane of
  `script/m14/verify-grammar-pins.ts` (the pin record lives in that script, not
  in `validation/m14/grammar-pins.json`, which is generated from it)
- Detection: `.nim` -> `nim` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine.parseFile` -> `RealNimAnalyzer` (engine.ts:210 language map,
  :229 candidates, :806 wasm resolve, :1627 analyzer dispatch)
- Corpora: `nim@bb85d2dda5` (the compiler and the whole standard library, 3,965
  files) and `pixie@30bb510877` (an independent 2D graphics library, 112 files)
  for the differential; **8** pinned repos for the corpus measurement, 6,063
  admitted files

The wired wasm is a plain `tree-sitter generate && tree-sitter build --wasm` of
the **unmodified** vendored source, so this pin has no patch clause to evidence.
What backs it instead, re-measured on every run of the instrument:

- an offline source<->wasm surface proof — 377 node ids, 127 named types, 205
  anonymous tokens, 24 fields, with 0 declared names missing from the wasm's
  `grammar.json` and 0 wasm names undeclared;
- the grammar's own 72-case conformance suite (`tree-sitter test` over the
  vendored `test/corpus`), which is upstream-authored expectation, not generated;
- a 17-file construct matrix, each file accepted by the **Nim 2.2.12 compiler**
  and parsed by the wired wasm with 0 ERROR and 0 MISSING.

`src/parser.c` (41 MB) is deliberately not vendored; `PIN.md` carries the exact
two-command rebuild sequence. `.nim` is the only routed extension — see
*Honest limitations* for why `.nims` and `.nimble` are not.

## Symbol contract

| Construct | Symbol | AST rule |
| --- | --- | --- |
| `proc f()` | `function` | `proc_declaration` |
| `func f()` | `function` | `func_declaration` |
| `iterator f()` | `function` | `iterator_declaration` |
| `converter f()` | `function` | `converter_declaration` |
| `method f()` | `method` | `method_declaration`; the receiver type is BOTH `ownerName` (so the method is owned, indexed and companion-visible) and `metadata.nimReceiverType` |
| `template f()` | `macro` | `template_declaration` |
| `macro f()` | `macro` | `macro_declaration` |
| `type O = object` | `struct` | `object_declaration`, non-ref |
| `type C = ref object` | `class` | `object_declaration` under a `ref_type` |
| `type T = (int, string)` (unnamed tuple) | `struct` | `tuple_construction` |
| `type T = tuple[a, b: int]` (named tuple) | `struct` | `tuple_type` |
| `type I = concept` | `interface` | `concept_declaration` — a structural, compile-time contract satisfied by implicit dispatch, which is what `Interface` means in this codebase |
| `type E = enum` | `enum` | `enum_declaration` |
| `type C = concept` | `interface` | `concept_declaration` |
| `field` in an object body | `property` | `object_declaration` field |
| `const X = …` | `constant` | `const_section` |
| `let` / `var` / `using` at file scope | `variable` | `let_section` / `var_section` / `using_section` |
| `A`, `B` of an enum | `enumMember` | `enum_declaration` fields |
| `type X = seq[int]`, `ref Foo`, `ptr T`, `distinct float` | `type` | `type_declaration` whose RHS is none of the above |

Parameters, `let`/`var` **inside a body**, proc literals, loop variables,
`except … as` bindings and body-local type annotations are **never symbols**.
A body-local type annotation is anchored to the *enclosing callable* as its
documentation source, not promoted to a symbol of its own.

`ref object` is a `class` and not a `type` or a `struct`: it has identity,
inheritance and dynamic dispatch. The raw spelling (`ref object` vs `object`) is
preserved in metadata either way, so the distinction is recoverable without
re-parsing.

## Relationship ontology

| Relationship | Rule | Carries a line |
| --- | --- | --- |
| `imports` | one edge per module named by `import`, `from M import …` and `include`; source is the synthetic `(global)` | the naming node (the path token, not the directive) |
| `exports` | one edge per OPERAND of an `export` statement — a re-export of a name this module imported, which nothing else in the payload records | the operand node |
| `contains` | one edge per owned member: object fields, enum members, module-level procs/types, methods under their receiver | no, by design |
| `calls` | `call` and `dot_generic_call` whose callee resolves to a callable this file declares; UFCS member calls included | the callee node |
| `uses` | a bare identifier read, and the member leaf of a `dot_expression` that is not a call callee (Nim's UFCS makes `x.foo` a member read) | the identifier / leaf node |
| `references` | the declared-type graph: parameter, return, field, `const`/`let`/`var` annotations, `new`/`of` operands | the annotation node |
| `instantiates` | `TypeName(field: v)` — a `call` whose callee is a type this file declares and not a callable it also declares | the call node |
| `extends` | an `object_declaration` that inherits, including a qualified base from another module | the base node |
| `implements` | a concept naming another contract it includes — the `of` clause (`concept x of B`) or the `is` form (`x is B` in the body); see *Concept refinement* below | the concept's declaration / body |
| `overrides` | a `method` whose name matches a method of a base this file also declares; the target is receiver-qualified (`Rect.describe -> Shape.describe`) | the method node |

Nim expresses contract refinement in **two** spellings and neither is an
interface declaration in the Java sense — a concept is satisfied structurally, by
implicit dispatch, and no type is ever annotated as implementing one.
`doc/manual_experimental.md:1205-1213` names them as alternatives for one fact:
"When the matched type within a concept is directly tested against a different
concept, we say that the outer concept is a refinement of the inner concept …
As an alternative way of defining concept refinements, you can use the object
inheritance syntax involving the `of` keyword". Both are read:

| Spelling | Read from | Corpus occurrences over 6,063 files |
| --- | --- | --- |
| `type A = concept x of B` | the grammar's `refines` field on `concept_declaration` | **38 `refinement_list` nodes in 24 files → 47 edges**, all in `nimony`. It read **0** until that repo entered the corpus on 2026-10-04; see *`implements`: the ruling that was falsified* |
| `type A = concept x` with body `x is B` | an `is` expression whose LEFT is a bare formal parameter of the concept | **0** — 156 `is` expressions in concept bodies, 13 with a bare formal parameter on the left, and **0** whose right side names a concept this file declares. The 13 name `U`(2), `int1`, `int2`, `string`, `PrimitiveBase`, `IntegerBase`, `IdBase`: a generic parameter or a concrete base type, every one |

Both are published as `implements` and not `extends`, because `extends` is
already the label for the nominal class hierarchy (`object_declaration.inherits`)
and a refinement asserts nothing about storage: `A extends B` says A's storage
contains B's, `A implements B` says anything satisfying A satisfies B. This is
the same fact the elixir lane publishes as `implements` for a duck-typed
`@impl Protocol` and graphql for `type X implements Y`.

Concept SATISFACTION is deliberately not published. Whether an ordinary
`type T = object` satisfies a concept is the compiler's structural match against
the concept body at instantiation time, with no syntax naming it, so there is
nothing to read and any such edge would be fabricated. `nim/concept`'s
`forbidRelationships {implements, from: Meters}` pins that against an analyzer
that infers satisfaction from the members it can see.

Resolution for `calls`, `uses` and `references` requires the name to be declared
**in this file**, because Nim's declare-before-use rule makes anything else either
an import or an error.

### `line_number`

Every relationship carries a 1-based `line_number`, and it is the line of the
**naming node**, not of the statement that contains it. This matters most for
imports: a multi-line `import` puts the path on a later line than the keyword
(`import` on line 12, `ast, astalgo, …` on line 13 in
`nim/compiler/nimsets.nim`), and anchoring to the directive would point a reader
at the wrong line for every such edge.

The `contains` edges carry no line by design — ownership is a structural fact
about the declaration, not a position in the file.

## The grammar facts that decide this lane

**Path separators are named `operator` nodes, not anonymous tokens.** The grammar
models `/` as a *named* node of type `operator` whose text is the whole
separator — `"/"`, or `"/../"` when a parent hop is fused into the same token —
and `./` / `../` are single `operator` tokens inside a `prefix_expression`. So
`operator.type` is never `"/"`, and an `operator` node is the **first named
child** of a `prefix_expression`, ahead of the operand. Two analyzer bugs lived
in exactly that gap:

- recognising a path by testing `left.type === "identifier"` handled
  `identifier / identifier` and nothing else, so every path deeper than two
  segments was dropped whole — 171 deep-path imports across 141 corpus files,
  and 434 multi-segment relative imports across 299 files, published **no edge at
  all**. Because the whole path vanished there was no dangling target that could
  have surfaced it; the only symptom was a dependency graph quietly missing
  nodes.
- `import g/../h` was worse than missing: it published the **wrong** target
  `g/h`.

The written path is therefore the node's own text, which preserves depth,
`./`, `../` and the fused `"/../"` form with no reassembly.

**The `operator` node is an `as` alias, not a separator, when it reads `as`.**
`import ./shapes as S` binds a *local* name; the right side is never a module.
The oracle and the analyzer both test for it before testing for a separator.

**A type RHS is wrapped in `type_expression`, and the three shapes are not
parallel.** The classifier has to see through the wrapper, because the trees differ:

```
type Color = enum …      -> enum_declaration        (no wrapper)
type A = concept x       -> concept_declaration     (no wrapper)
type U = tuple[a: int]   -> type_expression / tuple_type
type T = (int, string)   -> type_expression / tuple_construction
```

`unwrapTypeExpression` is a bounded walk that names the shapes it unwraps rather
than taking the first child. Before it existed, the classifier compared the
wrapper's own type, so `tuple_type` was never seen and **every tuple type in the
language was published as a bare `type`** while its fields went unpublished — a
documented rule that was simply false, and false in the ordinary spelling:
`(int, string)` is how Nim writes an unnamed tuple (the compiler accepts it with
0 errors and rejects `tuple[int, string]` with 3). Found by the mutation run, not
by inspection.

**An unnamed tuple element declares a TYPE, not a field.** The grammar builds the
same `symbol_declaration_list` for `tuple[x, y: int]` and for `tuple[int, string]`
— in the second the "names" *are* the types — so the analyzer published
`property:int` and `property:string`, two properties named after builtin types,
each with a `contains` edge. Nothing else could have caught it: both names are
real identifiers, so no dangling check fires, and a symbol count sees two extra
rows rather than two wrong ones. The discriminator is structural rather than a
builtin-name guess: a real field has the declaration's own `type` field and an
unnamed tuple element has none. The rule is scoped by ancestor to `tuple_type`,
because a `variant_discriminator_declaration` (`case isCircle`) also carries no
type field and applying it everywhere silently dropped the discriminator.

**Layout is an external scanner.** `scanner.c` owns Nim's indentation state
(`_layout_start` / `_layout_end` / `_inhibit_layout_end`); without it
indentation-sensitive Nim does not parse at all. The scanner is vendored, and it
is why a rebuild needs `tree-sitter generate` first, not just
`tree-sitter build --wasm`.

**Parser lifecycle needs no isolation.** A fresh/shared parser was measured over
47 corpus files in two orders with zero differences, so this lane does not pay
the per-file parser construction that the Lua-family lanes need.

## Supported constructs

What the analyzer reads off the parse tree, and — for each — where it is measured.
Every row is a `##` heading in this document with the number attached, so nothing
here is a list of intentions.

**Every count in the `Measured` column is the `kinds` / `probes` block of
`validation/m14/measurements/nim/ontology-census.json` on analyzer blob
`9d9ee478e3295c28`, over the same 6,063 files, except the four rows that name a
different instrument in the cell itself.** The pin is stated here because this
table was the one table in the document that carried no instrument: a per-type
table was re-tied to the digest and this one was not, so eleven of its cells
drifted while the rest of the document was corrected.

| Construct | Grammar node / spelling | Read as | Measured |
| --- | --- | --- | --- |
| proc / func | `proc_declaration`, `func_declaration` | `SymbolKind.function` + module-scope callable | 41,889 functions of 110,060 symbols; callable recall **46,960 / 46,971 = 100.0%** (`resolution-audit`) |
| method | `method_declaration`, receiver from the first parameter | `SymbolKind.method` + `ownerName` = receiver | **229 methods**; **67** `overrides` edges; 186 of 230 methods on the tree have a readable receiver (`gap-hunt`) |
| named nested routine | a `proc` lexically inside another | `SymbolKind.function`, `scope` = parent, `contains` from `metadata.nimNestedIn` | tree-only `calls` targets **653 → 19** on the committed blob (`resolution-audit`, 6,063 files); 17 nested-routine `contains` families |
| iterator | `iterator_declaration` | `function`, **not** macro | `nim/contract` pins `{countUp, function}` |
| template | `template_declaration` | `macro` | `nim/contract` pins `{twice, macro}` |
| macro | `macro_declaration` | `macro` | 4,837 macros |
| macro / template body | the body of either | **suppressed** — expansion is not a declaration site | `nim/mac` + 4 forbids |
| object / ref object | `object_declaration`, `type_declaration` | `class` with `ref`, `struct` without | 978 classes, 5,283 structs |
| tuple type | `tuple_type` | `struct` | **defect 1 of the mutant round**: published as a bare `type` in both spellings, now pinned both ways |
| concept | `concept_declaration` | `SymbolKind.interface` | **337 in 130 files** — **216 in 69** before `nimony` |
| enum + members | `enum_declaration`, `enum_field` | `enum` + `enum_member` | 1,313 enums, 11,685 members |
| object field | `field_declaration` | `property` | 16,545 properties |
| const / let / var | `const_declaration`, `var_declaration` | `constant`, `variable`, `property` for `var` fields | 10,781 constants, 12,962 variables |
| type alias | `type_declaration` with a non-object body | `type` | 3,221 types |
| inheritance | `object_declaration.inherits` | `extends` | **1,047 occurrences accounted 1047/1047** in 403 files; **627** edges (`gap-hunt`) |
| contract refinement | `concept_declaration.refines`, `x is B` in a body | `implements` | **38 `refinement_list` in 24 files → 47 edges**, all in `nimony`; the `is` spelling still 0 |
| instantiation | `bracket_expression` in callee position, `TypeName(field: v)` | `instantiates` | 3,830 `bracket_expression` occurrences; 2,843 edges |
| call | `call`, `dot_generic_call`, parenless UFCS member leaf | `calls` | 118,261 edges |
| bare / member read | `identifier`, the leaf of a non-callee `dot_expression` | `uses` | 45,662 edges |
| declared type | parameter, return, field, annotation, `new`/`of` operand | `references` | 56,438 edges |
| import | `import`, `from … import`, `include` | `imports` + the `ImportInfo[]` channel | 13,364 edges; 270 `export_statement` and 39,933 `exported_symbol` nodes also enumerated |
| export | `export` OPERANDS, positionally | `exports` | 270 `export_statement` occurrences in 152 files → **617 edges** |
| the `*` marker | `exported_symbol` | **no edge** — `visibility: "public"` + `metadata.exported` | **39,933 sites in 2,016 files** |
| `static:` / doc-example bodies | `static` block, `runnableExamples` argument | `type` declarations **published**, `value` declarations suppressed | 9 → 6 tree-only `extends` owners |
| destructor / sink hooks | `=destroy`, `=sink`, `=copy`, `=dispose` | hook, not a runtime call — **filtered as a builtin** | 8 of the oracle's 26 unexplained edges, named individually in the artifact |
| accent-quoted operator | `` proc `-!` ``, `` `==` `` | an ordinary declaration | **459** declaration sites over a 1,500-file sample (`accent-quoted-endpoints`); **96** of its edges are deleted by the shared filter (*Limitations* 12) |
| do-pragma | `expr.#[…].#` | **not read** — the grammar consumes it as a block-comment extra | 16 affected corpus files; the grammar patch is measured harmful and stays unapplied (*Limitations* 1) |

Three constructs are read and deliberately produce NO edge, each with the count
that says so rather than an assertion: the `*` marker (39,933 sites), concept
SATISFACTION (no syntax names it), and a macro/template body (expansion is not a
declaration site).

**And one construct is read, produces an edge, and the edge's target is a builtin
in exactly one case.** `type Bad = concept of int`
(`nimony/tests/nimony/concepts/tconceptinheritbad.nim:1`) publishes
`implements -> int`, and upstream ships the matching `.msgs` reading
`Error: concept can only inherit from other concepts`. It is 1 edge on 1 file, it
is counted in the 47, and it is a true reading of a syntactically valid construct
on a file the language rejects. It is named here rather than guarded away, because
a guard that hid it would also hide the 46 real refinements' sibling shape.


## Import and export semantics

All three import forms route through **one** path reader, so a module spelled
`./x` in one statement and `x` in another is one target in the graph. This was a
real defect: `from ./nativesettings import …` published `nativesettings` while
`import ./configure` published `./configure` — two spellings for one module,
found by the differential on `prologue/src/prologue/core/application.nim`.

The spelling published is the **written** path, verbatim: `./a`, `../b`, `./c/d`,
`../e/f`, `g/../h`, `m/n/o`, `pkg/cookiejar`, `"quoted.nim"`. Module *lists*
(`std/[json, strutils]`, `import a/[b, c]`) are the one case that is a list
rather than a path, and yield one edge per element with `nimModuleList` in
metadata.

`imports` is the **first-class kind**, not `references` with import metadata. The
LSP usages file-level section answers with
`relationship_type IN ('imports','exports')`, so a NIM dependency edge hidden
behind `references` is invisible to the one reader that answers "what does this
module depend on". This is the same class M60/#910 fixed for C. The metadata
markers (`isImport`, `relationshipType`, `fileLevel`) stay — they are the
evidence — but the kind now says what it is.

`export` publishes two things, and they are not the same fact. One edge per
**operand** of the statement is an `exports` relationship — the re-export of a
name this module imported, which no symbol metadata and no other relationship
carried, and which the LSP usages file-level section asks for by name
(`relationship_type IN ('imports','exports')`). The operands are read
positionally, because `except` names what does **not** leave the module:

| Written | `exports` edges | In the importable-unit list |
| --- | --- | --- |
| `export foo, Bar` | `foo`, `Bar` | only those this file declares |
| `export hidden except helper, another` | `hidden` | `hidden` — **never** `helper`/`another`, which ride `nimExportExcluded` |
| `export common_parser.Parser` | `Parser` (leaf), `nimQualifiedName: common_parser.Parser` | same rule |
| `export Payload as Renamed` | `Payload`, `nimAlias: Renamed` | same rule |
| `export std/os` | `std/os`, `nimModuleReExport` | never — the provider is that module |

The list and the edge answer different questions, which is why a cross-module
re-export appears in only one of them: the list is the index's *provider* set (a
name an importer can bind **from this module**), while the edge states "this
module hands this name onward", which is true whoever declares it. Listing the
foreign name in both would give one name two providers. This is also the M49
exports-family invariant's own reading — an export must name an importable unit
resolving to a top-level symbol — so separating the two carriers removed the need
for a per-language exception rather than adding one.

The `*` marker is the OTHER export fact and deliberately has no edge:
`proc foo*()` is published as `visibility: "public"` plus `metadata.exported`,
which the store persists into `brain_symbol.visibility` and gravity already reads
(measured: 29,831 `exported_symbol` nodes in 1,380 corpus files). A second
28,000-edge graph restating it would grow the relationship payload by ~17.6%
(163,960 edges measured before the ontology round) for no query a reader could not
already ask. `nim/reexport` pins that judgement with a forbid on
`{exports, target: visible}`, so the decision has to be argued rather than
rediscovered.

## Concept refinement, and the field shape that hides it

`childForFieldName("refines")` on `type A = concept x of B` returns a node whose
OWN TYPE is `refinement_list`, not a wrapper holding one. Both readers of that
clause initially looked for a CHILD of that type on the field node, so both
returned null on every file and the whole `implements` family read zero
occurrences on a construct the corpus and the fixtures both spell correctly —
with every other signal still healthy, since the concept is still published as
`interface`. The fact now has one function (`refinementListOf`) read by both
consumers, and `nim/concept-refines-field-read-as-wrapper` reproduces the defect
exactly: the edges go, the symbols stay, and the fixture suite goes red.

The `is` form needs three guards, because the syntax is much wider than the `of`
clause, and each guard removes a class of statement that is not a refinement:

| Guard | Rejects | Corpus shape |
| --- | --- | --- |
| LEFT must be a bare formal parameter | `o.length is Sized` — a FIELD's type | `nim/tests/concepts/texplain.nim:136`, `o.foo is RegularConcept`, where `RegularConcept` **is** a same-file concept, so without this guard the reader fabricates an edge |
| RHS must be a concept THIS FILE declares | `x is int`, `x is T` — a concrete type or a generic parameter implements nothing | 125 `is` expressions in concept bodies; the most frequent RHS are `T` (31), `int` (23), `bool` (15), `string` (10), `V` (5), `float` (5), and only 5 name a same-file concept |
| not the concept itself | `r is Recursive` — recursion, not refinement | all 5 corpus cases: `nim/tests/concepts/trecursive_concepts.nim:26` (`distinctBase(x) is Primitive`), `nim/tests/concepts/tconcepts_issues.nim:421` (`bend(x is Bendable)`) |

An `argument_list` is also not descended into, so `bend(x is Bendable)` cannot be
read as a refinement even when the RHS is a concept. An **imported** contract is
not guessed at either, and that guard is deliberately stricter than the one
`extends` applies to a cross-module base: the same `is` spelling names a concept
or a concrete type depending on a scope this pass cannot see, so relaxing it for
a confidence discount would fabricate `implements -> int` for 120 of the 125
corpus occurrences.

## What is ruled, and why

| Ruled | Reason |
| --- | --- |
| a read of a name bound by an enclosing scope | the local is not a symbol; the read is not a dependency on anything the index declares |
| a destructuring binding as a read target | `let (_, name, _) = splitFile(f)` is a `tuple_deconstruct_declaration` wrapping its bindings, and the frame binder used to skip the whole node — so `name` was unbound and the read at `images.add((name, image))` was attributed to `EmojiSet.name`, a struct property declared 26 lines earlier. Not a dangling edge, so no dangling check could ever have caught it; only the shadow rule was wrong |
| an assignment target as a read | `x = 1` and `a.x = 1` write. For `a[i] = 1` the base and the index *are* reads and are not suppressed |
| a callee as both a `calls` and a `uses` edge | one construct, one edge; the callee leaf is excluded from the `uses` pass |
| an object-construction label as a read | `Vec(x: 1)` names a field; it does not read one |
| a `gensym` name, `_`, and keyword-like leaves | not resolvable names |
| a name in a type position | a type reference is `references`, not a value read |
| a module path in an import/export/include | it is the import edge, already published |
| a label (`block name:`, `break name`) and a colon field name | a goto target or a field name, never a read |

## The ten relationship types: verdict and measurement

Every number below comes from production `parseFile` (`src/ast/pool-worker.ts`,
not `analyze()`) over the corpus at `$HOME/fixtures/repositories`, via
the lane's own instrument `validation/m14/fixtures/nim/census.ts` (committed and
re-runnable). **Corpus: 6,063 tracked files over 8 repositories** — `nim` 3,968,
`nimony` 1,508, `nim-lang-nimble` 435, `graphql-nim` 55, `nimterop` 45,
`bigints` 21, `dom96-jester` 19, `Aporia` 12 — sampled by `git ls-files` +
`detectLanguageFromPath === "nim"` + a 512 KB cap, which is the arbiter's own
walk, so the file set is the same set. **110,043 symbols**, 0 empty names, 0 empty
kinds, 0 edge types outside the ten, 0 empty endpoints, 0 throws.
Artifacts: `validation/m14/measurements/nim/session10-1w-census.{json,txt}` at the
current blob, and `session6-1w-census.{json,txt}` at the previous one.

**`nimony` is the eighth repository and it is the one that moved the verdict.**
It was added on 2026-10-04 because `gh api 'search/code' -f q='"= concept of'
language:Nim'` returned it, and it holds upstream's own
`tests/nimony/concepts/` inheritance suite. Every figure in this section grew
because of it and none shrank: 1,508 more real Nim files cannot remove an edge,
and that direction is the check that the previous 4,555-file corpus was
*incomplete* rather than merely different. The per-type before/after is in
*`implements`: the ruling that was falsified*.

**EVERY NUMBER IN THIS SECTION IS AGAINST A COMMITTED BLOB, not a working
tree.** `census.ts` prints `sha256(src/ast/real-nim-analyzer.ts)` before the walk
and again after it, so a run that says "unchanged" is internally consistent, and
this one does:

| | blob / digest |
| --- | --- |
| `analyzer/NIM` @ `1f443af19` | the commit that INTRODUCED the CURRENT blob of `src/ast/real-nim-analyzer.ts`, sha256 `1475e53d0e528d0a…` — the bare-`case` discriminator guard. Measured over the same 6,063 files (`session10-1w-census.txt`, `session11-resolution-scope.txt`) |
| `analyzer/NIM` @ `647a08e3c` | the PREVIOUS measured blob, sha256 `9d9ee478e3295c28…`. The artifact set below the re-measurement note quotes it, and each says so |
| `analyzer/NIM` @ `c12d7c7c1` | the blob before that, sha256 `a59574036eb9f7fb…`, unchanged on disk from `c12d7c7c1` through `469ecd1af`. Every artifact recorded against it has been re-measured; `ruled-gate-run-2.txt` and `node-identity-ab.txt` are the only two that quote it, and both say so |

The commit is named as the one that introduced the blob rather than as the HEAD at
writing time, because a digest identifies a blob and a blob has an introducing
commit. Measured: `git log --format=%h -- src/ast/real-nim-analyzer.ts` with
`sha256sum` over each commit's copy gives `1f443af19 1475e53d0e528d0a`,
`647a08e3c 9d9ee478e3295c28`, `c12d7c7c1 a59574036eb9f7fb`,
`47faa4238 b9a73cfda9d826a3`, `ad9edcd72 37112977bad16542`,
`3dcd4af14 f17b972273aa923d`.

### The blob moved a second time, and the delta is in ONE column

`1f443af19` added the bare-`case` discriminator guard, and it moved the digest
`9d9ee478e3295c28…` → `1475e53d0e528d0a…`. **It touched no table in this document.**
The tables were re-measured at the new blob and the delta is confined to `contains`
and to the symbol count — which is the one thing a guard that stops publishing a
fabricated field *must* move:

| | @ `9d9ee478e3295c28` | @ `1475e53d0e528d0a` | delta |
| --- | --- | --- | --- |
| symbols published | 110,076 | **110,043** | −33 |
| `contains` | 29,362 | **29,330** | −32 |
| total edges | 267,297 | **267,265** | −32 |
| the other nine types | — | identical to the digit | 0 |
| `calls` both-ends, corpus-wide | 98.3% | **98.2%** | −0.1pp |
| the other nine corpus-wide rates | — | identical to 0.1pp | — |

`calls` corpus-wide moves only because the universe it resolves against lost the 33
symbols the guard removed; its own 118,261 edges are untouched, and a rate's
denominator shrinking is not a resolution regression. **Nine of ten types did not
move at all, and that is the check that the guard is narrow**: it removed exactly
the slots it was written to remove and nothing else. The per-slot measurement of
which slots those were — 20 fabricated slots, 26 declarations, 19 symbols and 18
`contains` edges the pre-fix blob published and HEAD does not — is
`validation/m14/measurements/nim/session10-bare-case-delta-{PREFIX,HEAD}.txt`,
produced by `validation/m14/fixtures/nim/bare-case-corpus-delta.ts` run once per
blob. The census's −33/−32 counts published symbol INSTANCES; the delta script's
19/18 counts per SITE. Both are right about their own quantity and the two are not
meant to be added — the difference is `tsumtype.nim:74`, whose `Nil` was already
unpublished before the guard for an unrelated reason.

**Everything below the verdict table that still quotes `9d9ee478e3295c28` is
quoting the blob it was measured on, and is left saying so rather than re-labelled
to a digest it was not run against.** Re-labelling a historical artifact is the one
move that would make this document agree with itself and be wrong.

**The blob moved under this section once, and the mechanism that caught it is the
one that made the move cheap to absorb.** `647a08e3c` changed the analyzer — a
dead node-identity comparison became an index test (*Five defects*, 5). That
invalidated every digest-pinned number here by construction, so all of them were
re-measured rather than re-labelled, and the neutrality of the change was itself
measured: two full censuses over the same 4,555 files, one on each blob, agree to
the edge on all ten types and on the symbol count
(`validation/m14/measurements/nim/node-identity-ab.txt`, arm 2). A digest pin that
is only a label would have been a lie the moment the blob changed; here it was a
tripwire.

**And this table was WRONG until it was checked against the artifact, which is the
point of printing the digest.** An earlier revision pinned `a59574036eb9f7fb…`,
but the committed census artifact recorded `9e93988f677e8faf` — a different
analyzer, and `9e93988f` matches **no commit on this branch** (`git log --format=%h
-- src/ast/real-nim-analyzer.ts`, sha256 of each blob: `a59574036eb9f7fb`,
`b9a73cfda9d826a3`, `37112977bad16542`, `f17b972273aa923d`,
`0d847349a69a170c`, `e2dd026b3b3f47e0`, `dab4e6c068c977d4`, `7e2870e150e86075`,
`5b5645b4df2abf12`, `14b5a17ffbcebd4a`, `bf41f772b4df402c`, `e3b0c44298fc1c14`). The
artifact was a working-tree measurement carrying a committed file's name, and the
table above it carried a THIRD set of numbers belonging to neither. All three are
gone; what is here is one walk, re-run against the committed analyzer, with the
artifact regenerated beside it (`validation/m14/measurements/nim/ontology-census.{json,txt}`
records `9d9ee478e3295c28` on both sides of the walk).

The same defect was in six sibling instruments — `accent-quoted-endpoints`,
`gap-hunt`, `nim-ruled-probe`, `resolution-audit`, `ruled-gate`,
`unknown-endpoint-hunt` carried no digest at all, and the oracle cross-check's only
artifact was literally named `oracle-crosscheck-workingtree.{json,txt}`. All seven
now hash the analyzer before and after the walk and print the verdict on both sides,
so a run that straddles an edit says so instead of looking like a finding.

An earlier revision of this section carried a warning that the numbers described
HEAD *plus* an uncommitted working tree, because two `opencode run --agent build`
processes had been pointed at `$HOME/mcp/bb-lanes/nim` at the same time
while the first was mid-corpus-walk. That incident is real and its cost is
measurable — two runs of the shared arbiter over the SAME 4,555 files returned
`calls` 80,057 and then 79,041, because the analyzer was edited between them, and
both numbers were correct for the code that produced them. The state is now
resolved: the work is committed, the digest is recorded above, and the numbers
below are for that blob.

**THE WORKER COUNT IS PART OF EVERY NUMBER, because the production path is
non-deterministic under concurrency.** Measured over the same 4,555 files at
`validation/m14/fixtures/nim/fallback.mts`: **1 worker → 0 fallback files and 0
empty-kind symbols; 6 workers → 2 fallback files and 4 empty-kind symbols**, and
across five full-corpus runs at 6 workers the empty-kind count was 11, 4, 3, 63, 0
— a different set of files each time. The cause is *Limitations* 11. Any figure
below quoted without its worker count is not reproducible, so the artifact
records the count its run used.

| Relationship type | Emitted? | Verdict | Measured on this corpus | Files | Where the number comes from |
| --- | --- | --- | --- | --- | --- |
| **all ten, one row each** | 10 of 10 examined | **10 EMITTED, 0 ruled** | **267,265 edges over 110,043 symbols** | **6,063 admitted** | `validation/m14/measurements/nim/session10-1w-census.txt`, digest-pinned on both sides of the walk, 1 worker |
| `calls` | YES | EMITTED | 118,261 edges | **4,903** | `collectCallsAndUses`: the callee branches plus the parenless-UFCS member-leaf branch |
| `uses` | YES | EMITTED | 45,664 edges | **2,833** | `collectCallsAndUses`, the member-leaf and bare-identifier read branches |
| `contains` | YES | EMITTED | 29,330 edges | **2,415** | `collectContainment`, from `ownerName` and from `metadata.nimNestedIn` for a nested routine |
| `references` | YES | EMITTED | 56,445 edges | **2,920** | `collectDeclaredTypeRefAt`, the declared-type sites |
| `imports` | YES | EMITTED | 13,364 edges | **3,429** | `readImportStatement` / `readImportFromStatement` / `readIncludeStatement`, plus the `ImportInfo[]` channel |
| `instantiates` | YES | EMITTED | 2,843 edges | **1,419** | `collectInstantiationAt`, a call whose callee is a type this file declares, plus the type argument of a `new` expression |
| `extends` | YES | EMITTED | 627 edges | **299** | `collectInheritance`, from `object_declaration.inherits`, minus the compiler's own roots |
| `implements` | YES | **EMITTED** | **47 edges** — *was 0, and the ruling that said 0 was falsified* | **23** | `collectContractRefinement`, from `concept_declaration.refines`; all 47 in `nimony` |
| `overrides` | YES | EMITTED | 67 edges | **36** | `collectOverrides`, receiver-qualified `Receiver.method`; the cross-file family additionally needs `overrideCompanion` |
| `exports` | YES | EMITTED | 617 edges | **154** | `readExportStatement`, one edge per OPERAND of `export`, with `except` read positionally as what does NOT leave |

**The FILES column is new, and it exists because the instrument that produces it was
wrong until this pass.** `census.ts:264` capped the example list at six entries *on the
same Set that answered "how many files"*, so all ten rows of all ten artifacts on
record read `files: 6` — the same number on every row, by construction, and
indistinguishable from a measurement. `Row.filesAll` now carries the count and
`Row.files` the capped list, with `filesListed` beside `files` in the JSON. Re-walked
at 1 worker: **exactly 20 lines of the report differ from the previous artifact** — the
ten type rows, once each way — and in every one the only change is this column. Every
edge count, resolution percentage, `<0.7`, `<1.0` and `evidenceClasses` tally is
byte-identical, so the fix moved a column and no finding. The denominators it buys are
the ones the small types needed: `implements` fires in **23** files and `overrides` in
**36**, which makes both corpus-wide facts rather than the two or three files an
eyeball would have sampled. (`cc3b5202d`.)

**READ THE "Both ends resolve" COLUMN AS AN INTRA-FILE RATE.** It answers *can this
file's own graph be walked from this edge*, not *does this edge bind in the index*. Both
instruments that report it — `census.ts` and the supervisor's `firing-check.ts` — build
their name set inside the per-file loop (`census.ts:232`, `firing-check.ts:322`), so each
edge is resolved against the declarations of its own file. Widening the universe to the
whole 6,063-file corpus moves seven of the ten types, and the fourth-session numbers in
the column below were quoting the narrow scope without saying so. Both scopes:

| Type | Verdict | Edges | Both ends resolve, **intra-file** | **corpus-wide** | Confidence | evidenceClass |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | EMITTED | 118,261 | 38.9% | **98.2%** | 0.85 (113,997) / 0.9 (4,206) / 0.75 (58) | `usage_contextual` 118,203, `import_based` 58 |
| `uses` | EMITTED | 45,664 | 99.8% | 99.8% | 1.0 (20,560) / 0.75 (25,104) | `usage_contextual` 45,606, `import_based` 58 |
| `contains` | EMITTED | 29,330 | 99.8% | 99.9% | 1.0 | `structural` |
| `references` | EMITTED | 56,445 | 45.6% | **96.9%** | 0.9 | `reference_qualified` 48,371, `import_based` 8,074 |
| `imports` | EMITTED | 13,364 | 37.1% | 38.6% | 1.0 | `import_based` |
| `instantiates` | EMITTED | 2,843 | 100.0% | 100.0% | 0.9 | `usage_contextual` |
| `extends` | EMITTED | 627 | 71.0% | **99.4%** | 1.0 | `structural` |
| `exports` | EMITTED | 617 | 3.7% | **75.4%** | 1.0 | `structural` |
| `overrides` | EMITTED | 67 | 100.0% | 100.0% | 1.0 | `structural` |
| `implements` | EMITTED | 47 | 91.5% | **100.0%** | 1.0 | `structural` |

The corpus-wide column is `validation/m14/fixtures/nim/resolution-scope.ts` over the
6,063-file corpus, one pass, digest `1475e53d0e528d0a` unchanged on both sides
(`session11-resolution-scope.{json,txt}`). **Its intra-file column reproduces the
census figure exactly on all ten types**, which is what makes the second column
readable as the same edges measured against a wider universe rather than as a
different measurement.

**The two tables above are now BOTH 1-worker walks, and they agree on all ten types
to the digit** — `uses` 45,664, `contains` 29,330, `references` 56,445, and the
seven others identical. The delta this section used to carry between them is
therefore **0**, and it is 0 because the fan-out difference was removed rather than
because the two instruments agree in general: the verdict table is re-measured at
the current blob by `session10-1w-census.ts` run at `BB_NIM_WORKERS=1`, which is
what `resolution-scope.ts` has always used. Compare *intra-file* rates, not totals,
when checking them — `census.ts` and `resolution-scope.ts` register different
spelling sets for the same name and differ by construction on `imports`.

**What fan-out was worth is retained here as a measurement rather than deleted,
because it is the reason the delta is now 0 and the reason a future reader must not
lower the worker count without re-reading it.** At the previous blob the verdict
table was the SIX-worker `ontology-census` walk (267,287 edges) against a 1-worker
scope table, and three types differed:

| type | 6-worker `ontology-census` | 1-worker | delta |
| --- | --- | --- | --- |
| `uses` | 45,662 | **45,664** | +2 |
| `contains` | 29,361 | **29,362** | +1 |
| `references` | 56,438 | **56,445** | +7 |
| the other seven | — | identical | 0 |

**And the fan-out of that walk was mis-attributed in this document until an earlier
pass: it was SIX workers, not two.** Three independent records agree and no record
disagrees. Neither half of the pair carries a count — `ontology-census.json` has no
`workers` key and `ontology-census.txt` has no `workers` line, because the field did
not exist yet. The walk was written at 10:55 (commit `1660a655e`), and
`census.ts` at that commit read `Array.from({ length: 6 }, () => worker())` at line
283 — a hardcoded six. `BB_NIM_WORKERS` was introduced 93 minutes later
(`3e30d227d`, 12:28:47 against 10:55:24), so `BB_NIM_WORKERS=2 … census.ts` **cannot** be the command
that produced this artifact; the variable did not exist. Every OTHER instrument's
2-worker row in this document is backed by a `workers 2` line in its own artifact
(`gap-hunt.txt:2`, `resolution-audit.txt:4`, `accent-quoted-endpoints.txt:2`), which
is what makes this one row detectable at all: it was the only 2-worker claim with no
`workers` line to check it against, and it was checked only now.

Consequence for the reading: the delta above is a **6-vs-1** spread, not 2-vs-1, and
the direction is the one *Limitations* 8 predicts — the wider fan-out exhausts the
WASM heap on a load-dependent set of files, so the wider walk publishes fewer edges
(267,287 < 267,297, both totals at blob `9d9ee478e3295c28`). It is not monotone in
fan-out, and this document does not claim
it is: the 2-worker `ruled-gate` reads `calls` 118,242, *below* both census walks'
118,261. Fan-out is one of three variables (instrument, fan-out, machine load), and
these two walks differ in one of them.

The percentages are unaffected to the printed precision — `references` reads 45.6% at
both — so the two tables never disagreed about anything a reader would act on. What they
did was leave a reader to discover the mismatch with no explanation, and to make the
sentence above ("reproduces the census figure exactly on all ten types") false against
the table three lines above it while true against its own artifact. The cells now carry
the count the instrument that produced this row measured, which is the 1-worker figure
both instruments agree on: `session6-1w-census` and `session6-resolution-scope` report
45,664 / 29,362 / 56,445 for these three and are otherwise identical on all ten.
Nothing about the verdict changes, because no type is at zero at either worker count.

**The four types that do not move are the four whose targets are intra-file by
construction** — `uses` (a member read), `contains` (an owner to its own member),
`overrides` (a receiver declared in the same file), `instantiates` (a callee this file
declares, which is the type's definition). That is the confirmation that the delta is
measuring *scope* and not counting better, and it is why the workstream's reference
point needs its scope attached: CSS `references` at 66.8% against nim `references` at
45.6% compares an intra-file rate to an intra-file rate and reads as nim being worse by
21 points, where nim corpus-wide is **96.9%**. Neither number is wrong; they are rates at
different scopes, and the scope is the thing the number is about. `imports` is the one
type whose corpus-wide figure is weak for a separate reason — it rests on a module-path
heuristic rather than a symbol match, and neither instrument resolves a Nim module path
like `std/strutils` properly (*Session 5*).

**267,265 edges. 0 below 0.7 from this analyzer.** One `calls` edge sits at 0.5 with
no `evidenceClass`, and it is not this analyzer's: it comes from the regex fallback
in shared `pool-worker.ts` described in *Limitations* 11, which is a §8 report and
is counted here so the table is not read as claiming a clean 0. Symbol hygiene on
the same walk: 110,043 symbols, **0** empty names, **0** empty kinds, **8** endpoints
equal to the literal `unknown` (*Limitations* 9), **0** empty endpoints, **0** edge
types outside the ten. This walk was CLEAN by the census's own five-part test —
`parseFile threw: 0`, `raw-parse threw: 0`, 6,063 of 6,063 parsed, 0 empty kinds,
0 empty names — at the six workers `census.ts` then hardcoded, so the empty kinds
earlier revisions of this document reported were a degraded walk and not a property
of the analyzer. It still exited 1,
on `[BB-HANG]` naming `nim/tests/distinct/tinvalidborrow.nim`, a file that had already
logged `[BB-PARSE-ERR] … memory access out of bounds` in the same run; *Limitations*
8 says what causes that and it is in shared `engine.ts`, not here.

### How the arbiter itself now reports these ten

**The §8 wiring gap this lane reported for three sessions is CLOSED upstream.**
`script/m14/nim-ruled.ts` at `analyzers/ontology-laptop-b` is byte-identical to
this branch's copy (sha256 `0170f0804baec6fa`), and the base's
`ontology-coverage-gate.ts:66` now reads `import { NIM_RULED } from "./nim-ruled"`
with `nim: NIM_RULED` as a key of `RULED_BY_LANG` (line 223). So the arbiter
stops refusing for this language the moment the branch merges, with no further
lane edit. The base's `src/ast/real-nim-analyzer.ts` is byte-identical to this
branch's too — same sha256 `9d9ee478e3295c28` — so every digest-pinned number in
this document is still pinned to the blob the base carries.

`npx tsx script/m14/ontology-coverage-gate.ts nim` still **exits 2 on this
branch**, because this branch's copy of the gate has no nim import; it walks all
6,063 files through `parseFile` and then refuses to print a verdict, printing
`corpus: 6063 admitted files` and then `no RULING TABLE for nim`. That is the
gate behaving correctly, it is measured not quoted
(`validation/m14/measurements/nim/session4-ontology-coverage-gate.txt`), and the
cause is the base being 404 commits ahead rather than anything in this analyzer.

This lane's table is `script/m14/nim-ruled.ts` and it has **zero** rows.
`validation/m14/fixtures/nim/ruled-gate.ts` applies the supervisor's two-line
wiring to a COPY of the gate in `/tmp` and runs the copy, which is how the row
below was obtained without touching shared machinery. Its output, 2 workers
(`session4-ruled-gate.txt`):

```
corpus: 6063 admitted files

type          status            detail
------------------------------------------------------------------------------------------------------------------------
calls         EMITTED           118,256 edges in 4+ files, e.g. Aporia/CustomStatusBar.nim, Aporia/AboutDialog.nim
uses          EMITTED           45,662 edges in 4+ files, e.g. Aporia/CustomStatusBar.nim, Aporia/AboutDialog.nim
contains      EMITTED           29,362 edges in 4+ files, e.g. Aporia/CustomStatusBar.nim, Aporia/AboutDialog.nim
imports       EMITTED           13,362 edges in 4+ files, e.g. Aporia/CustomStatusBar.nim, Aporia/AboutDialog.nim
references    EMITTED           56,443 edges in 4+ files, e.g. Aporia/CustomStatusBar.nim, Aporia/AboutDialog.nim
exports       EMITTED           617 edges in 4+ files, e.g. dom96-jester/jester.nim, graphql-nim/graphql.nim
extends       EMITTED           627 edges in 4+ files, e.g. Aporia/cfg.nim, Aporia/gtksourceview.nim
implements    EMITTED           47 edges in 4+ files, e.g. nimony/lib/std/math.nim, nimony/lib/std/tables.nim
overrides     EMITTED           67 edges in 4+ files, e.g. nim/lib/pure/logging.nim, nim/lib/pure/unittest.nim
instantiates  EMITTED           2,843 edges in 4+ files, e.g. Aporia/CustomStatusBar.nim, dom96-jester/jester.nim
------------------------------------------------------------------------------------------------------------------------
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0

== NIM_IMPLEMENTS_EXAMINED (from THIS run) ==
  NOT RUN — the table has 0 rows, so the gate consulted no probe this walk.
  These four counters are therefore UNREAD, which is not the same as 0.
  For the corpus-wide figures run: npx tsx validation/m14/fixtures/nim/nim-ruled-probe.ts

analyzer sha256 across the child's walk : 9d9ee478e3295c28  (unchanged)
exit code 0  (360s)
```

**This row is the supervisor's instrument, not this lane's census, and that is
what it is for.** The two share no counting code, and both put all ten types at
EMITTED. The per-type counts differ from the table above by single digits —
`calls` 118,256 here against 118,261 in the 1-worker census — and the cause is
fan-out, not the analyzer: patch 3 of the proof runner lowers the gate's 8-way
concurrency to 2 because 8 concurrent `parseFile` calls were OOM-killed on this
box. That is the same order of spread the census records between its 1-worker and
its 6-worker walks, and it is why every number in this document carries its worker
count.

**`emitted 10/10`, and the table it consulted is empty.** That is the honest
shape of a finished lane and not the shape of a lucky one: the denominator is 10
because nothing needed ruling, not because a ruling was written for each
unemitted type.

**The `NOT RUN` line is a fix, and it is the same failure the withdrawn row
would have caused.** `ruled-gate.ts` appends an epilogue to the gate copy that
prints `NIM_IMPLEMENTS_EXAMINED` from the child process that produced the
verdict (the export is module state, so the parent's copy reads zeros — patch 5,
and printing four zeros next to a computed verdict is worse than printing
nothing). With 0 rows the gate runs no probe, so the epilogue's four counters are
**unread**, not zero — and printing them bare would have read as "a probe walked
the corpus and found nothing", which is the exact `0-with-no-denominator`
misreading this document keeps finding in other lanes' prose. It now says so.

**What the corpus change did to the arbiter's own counts, and the spread.** The
arbiter and the census are different instruments over the same 6,063 files at
different worker counts, so they do not agree exactly and are not expected to:

| type | arbiter (8 workers) | census (6 workers) | delta |
| --- | --- | --- | --- |
| `calls` | 118,242 | 118,261 | 19 |
| `uses` | 45,656 | 45,662 | 6 |
| `contains` | 29,357 | 29,361 | 4 |
| `imports` | 13,359 | 13,364 | 5 |
| `references` | 56,428 | 56,438 | 10 |
| `exports` | **617** | **617** | **0** |
| `extends` | 625 | 627 | 2 |
| `overrides` | **67** | **67** | **0** |
| `instantiates` | 2,836 | 2,843 | 7 |
| `implements` | **47** | **47** | **0** |

**A SECOND arbiter run, on the same analyzer blob and the same 6,063 files, is
recorded here because the table above compares two DIFFERENT instruments and so
cannot show the arbiter's own spread.** Re-run 2026-10-04 14:19, 383s, analyzer
sha256 `9d9ee478e3295c28` unchanged on both sides of the walk
(`validation/m14/measurements/nim/reverify-ruled-gate.txt`):

| type | arbiter run 1 | arbiter run 2 | arbiter's own spread | census (6 workers) |
| --- | --- | --- | --- | --- |
| `calls` | 118,242 | 118,133 | 109 | 118,261 |
| `uses` | 45,656 | 45,573 | 83 | 45,662 |
| `contains` | 29,357 | 29,327 | 30 | 29,361 |
| `references` | 56,428 | 56,375 | 53 | 56,438 |
| `imports` | 13,359 | 13,348 | 11 | 13,364 |
| `instantiates` | 2,836 | 2,841 | 5 | 2,843 |
| `extends` | 625 | 626 | **1** | 627 |
| `exports` | **617** | **617** | **0** | 617 |
| `overrides` | **67** | **67** | **0** | 67 |
| `implements` | **47** | **47** | **0** | 47 |
| verdict | `emitted 10/10` | `emitted 10/10` | — | — |

**A THIRD arbiter run, at ONE worker, and the arbiter's own spread goes to zero.**
Re-run 2026-10-04, 887s, `BB_NIM_RULED_WORKERS=1`, same analyzer blob
(`validation/m14/measurements/nim/session7-ruled-gate.txt`):

| type | run 1 (8 workers) | run 2 (2 workers) | **run 3 (1 worker)** | 1-worker census | run 3 vs census |
| --- | --- | --- | --- | --- | --- |
| `calls` | 118,242 | 118,133 | **118,261** | 118,261 | **0** |
| `uses` | 45,656 | 45,573 | **45,664** | 45,664 | **0** |
| `contains` | 29,357 | 29,327 | **29,362** | 29,362 | **0** |
| `references` | 56,428 | 56,375 | **56,445** | 56,445 | **0** |
| `imports` | 13,359 | 13,348 | **13,364** | 13,364 | **0** |
| `instantiates` | 2,836 | 2,841 | **2,843** | 2,843 | **0** |
| `extends` | 625 | 626 | **627** | 627 | **0** |
| `exports` | 617 | 617 | **617** | 617 | 0 |
| `overrides` | 67 | 67 | **67** | 67 | 0 |
| `implements` | 47 | 47 | **47** | 47 | 0 |
| verdict | `emitted 10/10` | `emitted 10/10` | **`emitted 10/10`** | — | — |

**All ten agree with the digit, and the three arbiter counts are MONOTONE in fan-out
where the previous two runs were not.** 8 → 2 → 1 workers gives `calls`
118,242 → 118,133 → **118,261**: the 2-worker run reads *lower* than the 8-worker run,
so run 1 and run 2 were not two samples of one distribution but two different points on
a curve whose shape depends on how many parses are in flight. Held at one worker, the
arbiter — a different instrument with its own admitted-file list, its own filter and its
own probe wiring — reproduces the census exactly on all ten types. That is the strongest
cross-instrument agreement this lane has measured, and it is only available at the
fan-out where the WASM heap is not the variable.

**So the 109-edge `calls` spread in the table above is not the arbiter disagreeing with
itself. It is the arbiter disagreeing with itself at fan-outs where shared code loses
files.** Three arbiter runs, two of which were recorded in this document as "the
arbiter's own spread" without that attached, would have read as an instrument with a
±0.09% noise floor. The noise floor is 0 at one worker and 109 edges at two.

### Session 5: the digest pin did not cover the entry point, and two arbiter fields are broken

Everything above pins its numbers to the **analyzer** blob `9d9ee478e3295c28`. That is
the right thing to pin and it is not sufficient: `parseFile` lives in
`src/ast/pool-worker.ts`, which is production code this lane does not own and which has
since changed on the base. `analyzer/NIM` carries `7c30d519a9b2aacc`,
`analyzers/ontology-laptop-b` carries `d2b6b1163244ac7a`, and nothing in this document
said so. So the first thing this pass measured was the size of that gap, as an A/B with
the corpus, the worker count and the analyzer held fixed and **only** `pool-worker.ts`
varying (`validation/m14/measurements/nim/session5-poolworker-ab.txt`):

| | arm A (this branch) | arm B (base) | delta |
| --- | --- | --- | --- |
| all ten types, total edges | **267,297** | **267,297** | **+0** |
| symbols published | 110,076 | 110,148 | **+72** |
| distinct published names | 54,695 | 54,701 | +6 |
| callable recall (of 46,971 on the tree) | 46,960 | **46,967** | +7 |
| **unpublished callable residue** | **11** | **4** | **−7** |
| empty names / empty kinds / `unknown` endpoints | 0 / 0 / 8 | 0 / 0 / 8 | 0 |

**Not one edge moves. Seventy-two symbols appear.** The cause is the base's `keepSymbol`
split, which moved `destructor`, `root`, `me`, `self` and `unknown` out of the
*universal* denylist into per-language reserved-word handling. Two consequences, and they
point in opposite directions:

1. **The per-type edge table needs no re-measurement.** Identical to the digit on all
   ten types, so the verdict table above stands on the base's production entry as well
   as on this branch's.
2. **The symbol count and the residue were properties of the shared denylist.** This
   document reports 110,060/110,076 symbols and a residue of 11; under the base those
   are 110,148 and 4. The residue was never 11 defects in this analyzer — 7 of them are
   names the shared filter was deleting, and the base has already stopped.

The 4 that remain under the base are `super`(2), which the base still keeps
unconditionally, and `_`(2), Nim's discard name, which this analyzer suppresses on
purpose. **Arm B is the arm whose breakdown is complete** — 4 residue, 4 named — where
arm A's is capped at 10 by `resolution-audit.ts:360`, which is what makes the "all 11 are
named" claim elsewhere in this document false and is corrected in *Five defects* 1.

**The `.nimble` omission, measured in edges rather than in files.**
`script/m14/differential.ts:25174` declares `ext: "nim,nims"` while
`language-detection.ts:53` routes `nim`, `nims` *and* `nimble` here, so the shared
differential does not sweep `.nimble`. That was already on record as a file count; the
number a reader needs is how much of the graph sits in the unswept files
(`validation/m14/fixtures/nim/extension-split.ts`, no regex, reconciles against the
census to the digit):

| ext | files | symbols | edges | swept by the shared map |
| --- | --- | --- | --- | --- |
| `.nim` | 5,846 | 110,030 | 266,784 | yes |
| `.nims` | 51 | 35 | 230 | yes |
| **`.nimble`** | **166** | **11** | **283** | **no** |

Inside those 166 files: `calls` 273 (0.23% of the corpus's `calls`), `imports` 9
(0.07%), `uses` 1 (0.00%), and **zero edges of the other seven types**. That last
sentence is the load-bearing one. An omitted extension can only move a verdict by
taking a type from non-zero to zero, and seven of the ten cannot be touched at all while
the three that can are already the three highest-volume types in the language. So the
omission is real, it is 2.7% of files and 0.11% of edges, and **it cannot flip any of
the ten verdicts in either direction.** §8 — reported, not edited.

**Two fields in the supervisor's firing arbiter are wrong by construction.** Both were
found by running it and reading the output rather than the source, and both are §8, so
neither is edited here. Full write-up with source citations:
`validation/m14/measurements/nim/session5-firing-check-defects.txt`.

- **`analyzerDigest` is `MISSING` for every lane in the fleet.**
  `firing-check.ts:216` builds `path.join(here, "..", "ast", …)` from
  `here = script/m14`, so it resolves to `script/ast/` — a directory that does not exist
  — while the analyzers are in `src/ast/`. Measured on three lanes (nim, lua, toml):
  all `MISSING`, all `analyzerStableDuringRun: true`. The field compares `MISSING` to
  `MISSING` and reports *stable*. The tripwire that stops a number being quoted against
  an analyzer state that moved **cannot fire in the instrument designated to corroborate
  it**, and this lane's own `census.ts` — which hashes before and after and prints
  `CHANGED DURING THE RUN` — has no counterpart there.
- **`types[t].files` is the last file's count, not the number of files a type fired
  in.** `filesByType` is declared at line 334 *inside* the per-file loop (289–381) and
  read at 380, also inside it, so the `Set` is rebuilt per file and
  `res.types[type].files` keeps the last file's value. All ten nim types read `files: 1`,
  including `calls` at 118,261 edges — which cannot have fired in 1 of 6,063 files. The
  field is the maximum possible understatement and it is indistinguishable from a correct
  1, which is why it survived being read as a column.

Neither touches edges, symbols, source direction or both-ends resolution, so **the
arbiter's own headline for this lane is undisturbed** and is reproduced here
independently: `10/10 fired, 267,297 edges, 6,063/6,063 files`, agreeing with this lane's
census to the digit, and its per-repo file counts (`nim` 3,968, `nimony` 1,508,
`nim-lang-nimble` 435, `graphql-nim` 55, `nimterop` 45, `bigints` 21, `dom96-jester` 19,
`Aporia` 12) match a tally taken outside the arbiter. At its 120-file stride default the
same instrument reads **8/10, 4,247 edges** — `implements` and `overrides` do not fire in
a stride sample, for the two different reasons given in *`implements`* and
*Limitations* 15 — so the sample size is a real input to this arbiter's verdict and not a
detail.

**The resolution rates in this document were intra-file, and saying so changes what they
mean.** Both instruments that report a "both ends resolve" rate — this lane's
`census.ts` and the supervisor's `firing-check.ts` — build their name set *inside* the
per-file loop (`census.ts:232`, `firing-check.ts:322`), so every edge is resolved against
the declarations of its own file. `validation/m14/fixtures/nim/resolution-scope.ts`
measures both scopes in one pass and **its intra-file column reproduces `census.ts`
exactly on all ten types**, which is what licenses reading the second column as the same
edges against a wider universe:

| type | edges | intra-file (quoted until now) | **corpus-wide** | edges that move |
| --- | --- | --- | --- | --- |
| `calls` | 118,261 | 38.9% | **98.2%** | +70,219 |
| `references` | 56,445 | 45.6% | **96.9%** | +28,957 |
| `exports` | 617 | 3.7% | **75.4%** | +442 |
| `extends` | 627 | 71.0% | **99.4%** | +178 |
| `imports` | 13,364 | 37.1% | 38.6% | +201 |
| `implements` | 47 | 91.5% | **100.0%** | +4 |
| `contains` | 29,330 | 99.8% | 99.9% | +10 |
| `uses` | 45,664 | 99.8% | 99.8% | 0 |
| `overrides` | 67 | 100.0% | 100.0% | 0 |
| `instantiates` | 2,843 | 100.0% | 100.0% | 0 |

**Seven of the ten types resolve at 96.9% or better once the universe is the corpus.**
The four that do not move are the four whose targets are intra-file *by construction* —
`uses` a member read, `contains` an owner to its own member, `overrides` a receiver in
the same file, `instantiates` a callee this file declares — and that is the confirmation
that the delta measures scope rather than counting better. The universe is 78,838
distinct published name spellings, from 118,261 `calls` edges.

This also resolves a scope confusion the workstream's reference point invites: CSS
`references` at 66.8% against nim `references` at 45.6% reads as nim being worse by 21
points, and nim corpus-wide is **96.9%**. Both are correct at their own scope. The rate
is a property of the edges *and* the resolver's universe, and quoting one without the
other is how a language gets compared to itself.

**One number that looks like a disagreement and is not:** `unknownEndpoints` reads **8**
in this lane's census and **1** in the arbiter, because they count different things on
purpose. The census counts every edge with an endpoint equal to the literal `unknown`;
the arbiter (`firing-check.ts:361`) counts it only when *neither* endpoint is in the run's
published set. Both are quoted here with the definition attached so the two columns are
not read as one contradicting the other.

**The arbiter's own spread on `calls` is 109 edges, not the 19 the paired table
implies** — so a single paired comparison understates it by 5.7×, and the honest
envelope for a single instrument is the ~0.1% figure already quoted, not the delta of
one pair. The three rows the verdict rests on most sharply (`exports`, `overrides`,
`implements`) are **bit-identical across both runs and both instruments**, and `extends`
moved by 1. That is the claim worth keeping: the types with no concurrency-sensitive
derivation are exactly the types that reproduce, which is what one would expect if the
movement comes from the load-dependent WASM heap exhaustion in *Limitations* 8 rather
than from the readers themselves.

The four rows the verdict rests on — `exports` 617, `overrides` 67, `implements`
47, and `extends` within 2 — are stable across both instruments. The rows that
move are the ones *Limitations* 8 and 11 attribute to the concurrent production
path: the WASM parser loses a load-dependent set of files to heap exhaustion, and
which files are lost is a property of machine load rather than of the corpus.
`BB_NIM_WORKERS` now sets the fan-out on this lane's six corpus instruments and
each artifact prints the count it ran at, so the spread is choosable rather than
merely reported.

**The previous spread table is retained here because the DIRECTION is the
finding.** Over five walks of the previous 4,555-file corpus at 6 workers, two of
them the same instrument over the same files, `calls` ranged 79,047–79,129 and
`uses` 30,979–31,063 — a spread of 82 and 84 edges on totals near 79,000 and
31,000, i.e. ~0.1%. On the grown corpus the same two instruments differ by 19 and
6. The proportion is what matters and it did not change: this lane's counts are
reproducible to about a tenth of a percent at a stated worker count, and not to
the digit.

**Every earlier figure in this document that quoted `4,555`, `83,692 symbols`,
`184,691 edges`, `209` node types or `implements 0` describes the previous
corpus and is superseded by this section.** The previous numbers are not deleted:
they are what the falsified ruling was measured against, and a ruling whose
before-state is erased cannot be checked.

### `implements`: the ruling that was falsified, and what replaced it

**This section used to be titled "implemented, and measured absent on this
corpus", and that was a true statement about a corpus that was missing the
construct.** The corpus has since grown by one repository and the verdict has
flipped, so the section is about the flip rather than about the 0.

**Nim HAS the construct, in two spellings, and this analyzer reads BOTH:**

```
type A = concept x of B     # the `of` form  — collectContractRefinement
type A = concept x
  x is B                    # the `is` form  — collectIsFormRefinement
```

`nim/compiler/parser.nim:2268` states the production
(`conceptDecl = 'concept' COMMENT? (conceptParam ^* ',')? pragma? ('of' typeDesc ^* ',')?`)
and implements it at :2275 and :2291 (commented "new-styled `concept of A, B` on
the same line"), and `nim/doc/manual_experimental.md:1205-1213` documents the two
spellings as alternatives for one fact. Upstream's own compiler error names the
rule the edge encodes: `nim-lang/nimony/tests/nimony/concepts/
tconceptinheritbad.msgs` reads `Error: concept can only inherit from other
concepts`.

**What changed, and the number that changed it.** `NIM_RULED` carried one row —
for `implements` — with instrument B, `refinements 0`, and the overturn
condition "any non-zero count of `concept_declaration.refines`". The corpus
gained `nim-lang/nimony`: 1,508 admitted files, 23 MB, holding upstream's own
`tests/nimony/concepts/` inheritance suite. It was found with
`gh api 'search/code' -f q='"= concept of" language:Nim'`, which is what four
earlier clone attempts in this lane's history should have used instead of
guessing repository names from memory — all four returned "Repository not
found" while `git ls-remote https://github.com/nim-lang/Nim` succeeded.

| | before (4,555 files, 7 repos) | after (6,063 files, 8 repos) |
| --- | --- | --- |
| `concept_declaration` | 216 in 69 files | **337 in 130 files** |
| distinct grammar node types (Instrument A) | 209 | **211** |
| `refinement_list` produced | **0** | **38 in 24 files** |
| probe `withRefinesField` | 0 | **38** |
| probe hits pushed | 0 | **51** |
| **`implements` edges from production `parseFile`** | **0** | **47** |

(Instrument: `validation/m14/fixtures/nim/nim-ruled-probe.ts` and
`validation/m14/fixtures/nim/census.ts`, both over 6,063 files, analyzer
sha256 `9d9ee478e3295c28` unchanged across both walks.)

**No analyzer code changed.** The blob that measured 0 measures 47, so this was
never a GAP — the reader was correct and the corpus was silent. That is the
cheapest possible way for a ruling to be overturned and the most transferable
lesson in this document: a "measured absent" verdict is only as strong as the
corpus its author happened to assemble, and every other lane's is worth
re-testing against a corpus chosen by search rather than by memory.

**`NIM_RULED` is now `[]`.** The arbiter checks `observed` before consulting the
table, so a row for an emitted type is not a safety net — it is dead
configuration asserting something false. The probe and its `NIM_IMPLEMENTS_EXAMINED`
counters are kept, still exported and still run, because a falsification test
deleted along with the ruling it falsified cannot falsify anything again.

**The reader is pinned by 8 fixture edges across both spellings and 11 fixture
forbids** (was 6 and 7; the corpus added the three shapes below). The forbids
split into **6 shape guards** and **3 fabrication guards**, and the second group is
what the workstream's "never invent an edge the language cannot express" rule is
about:

| forbid | what it stops | why it is not optional |
| --- | --- | --- |
| `HasField` | `o.length is Sized` — a FIELD's type constrained | the corpus carries the same shape at `nim/tests/concepts/texplain.nim:136`, where `RegularConcept` **is** a same-file concept, so a reader checking only the right-hand side fabricates |
| `Numeric` | `x is int` — a type constraint on the matched parameter | `int`, `bool`, `string` and generic parameters implement nothing; an unguarded reader points edges at builtins |
| `Recursive` | `r is Recursive` — recursion, not refinement | the self-reference shape, `is`-form |
| `Cycle` | `Cycle is Cycle` → `of Cycle`, self-reference | the same guard on the `of`-form, and a REAL corpus file: `nimony/tests/nimony/concepts/tconceptcycle.nim` is exactly `type Cycle = concept of Cycle` |
| `Chained` → `Sized` | `name(x) is Sized` — a CALL on the parameter | the corpus shape is `distinctBase(x) is Primitive` at `trecursive_concepts.nim:26` |
| `Wrapped` → `T` | `of Source[T]` read as the type ARGUMENT | 2 of the 47 corpus edges; `T` is a generic parameter that resolves at neither end |
| `Meters` | inferring SATISFACTION from visible members | Nim has no syntax declaring that a type implements a concept — the compiler matches structurally at instantiation. An analyzer inferring it would publish one edge per (object type × concept) pair, every one fabricated |
| `Number`, `Container` | an `implements` edge out of a concept with no `of` clause | the edge needs a named supertype contract |

Counted from `validation/m14/fixtures/nim/concept.expectation.json`
(`expectRelationships` filtered to `implements` = 8, `forbidRelationships`
filtered to `implements` = 9, plus one `uses` and one `extends` forbid).

**The three shapes a corpus walk found and no fixture did.** A family can be
100% fixture-covered and still be unpinned on the shape most of its real edges
use. `implements` sat at 0 edges and 6 pinned rows, and when the corpus finally
exercised the family, 39 of its 47 edges used spellings the fixture had never
contained:

| shape | corpus occurrences | example |
| --- | --- | --- |
| generic target `of Foo[T]` | 2 edges | `nimony/tests/nimony/concepts/tconceptinheritnotgeneric.nim:7` `Bar = concept of Foo[T]`; `tconceptinvocationbody.nim:39` `MutableIndexable*[T] = concept of Indexable[T]` |
| qualified target `of mod.Contract` | 0 on this corpus | the leading `.` parses as an `ERROR` node with no field — the same shape *Limitations* 7 records for `export mod.Name` |
| self-cycle `of Cycle` | 1 file, 0 edges | `nimony/tests/nimony/concepts/tconceptcycle.nim`, upstream `.msgs` reading `Error: concept inheritance cycle detected` |

All three are now fixture rows with mutants behind them
(`nim/concept-generic-target-read-as-the-type-argument`,
`nim/concept-self-cycle-published`).

**The generic-target mistake is a FABRICATION, not a mislabel, and this lane's own
oracle made it.** The first `deriveConceptRefinement` scraped every identifier
under a refinement list, so on `Bar = concept of Foo[T]` it published
`Bar implements T` — the type **argument** read as the type it constrains, the
same confusion the `references` side records for `BlenderRgb[Rgba8]`. The
cross-check caught it one round after the code was written, which is the only
reason it is not in the tree now. The rule is one name per `type_expression`,
taken from the node's SHAPE: `bracket_expression` → its first named child (the
constructor, never the `argument_list`), `prefix_expression` → its last
identifier, `identifier` → itself.

**`implements -> int` is 1 of the 47 edges and it is not fabricated.**
`nimony/tests/nimony/concepts/tconceptinheritbad.nim:1` reads
`type Bad = concept of int`, and upstream ships the matching
`tconceptinheritbad.msgs` reading `Error: concept can only inherit from other
concepts` — so the file is a negative test the language rejects. The edge is a
true reading of a syntactically valid construct on a file that does not compile,
which is a different thing from an invented edge, and the honest treatment is to
name it with its count rather than add a guard that would hide it. It is 1 edge
on 1 file and it is counted in the 47.

**Instrument A is still the wrong instrument, and the row says so.** A is right
when the construct needs a node type the grammar does NOT have (json's function
call, zig's supertype clause). Here `concept_declaration` is present 337 times, so
an inventory read finds the interface-like construct and says nothing about
whether anything REFINES one — this is json's `exports` history exactly, where a
grammar cannot see a relation, only a shape.

**The text probe is reported as a non-instrument, with its hits classified, and
the grown corpus is what makes the point.** A loose search for the `concept … of`
shape now returns **61 hits**, classified by the node each sits in as **39 `code`,
21 `comment`, 1 `string`** — against **38** `refinement_list` nodes on the tree. A
text-based instrument would have overstated the construct by 61%. The 39-vs-38 gap
is one file: `nim/tests/concepts/tspec.nim:23`, where the match sits in code with
only a trailing `##` comment. `nim/compiler/parser.nim:2268` and `:2276` quote the
`conceptDecl` production inside a diagnostic string. The verdict rests on the tree
count, and this is why a ruling here may never be argued from a grep.

**Falsifying probe — and it fired.** Any non-zero `refinements` count from
`countNimImplementsConstruct` in `script/m14/nim-ruled.ts`, on any corpus. The
pinned run reads `conceptsExamined 295`, `withRefinesField 38`,
`isExpressionsInConceptBodies 156`, `refinements 0`, **51 hits pushed**, and the
probe prints beside it: *"A non-zero hits count is what makes the arbiter print
FALSIFIED for `implements`."* It did.

**What did NOT change: the `is` spelling is still corpus-absent.** All 51 hits are
the `of` form. `refinements` — which counts BOTH spellings — is still 0 for the
`is` form: 156 `is` expressions inside a concept body, 13 whose LEFT is a bare
concept formal parameter, **0** whose RIGHT names a concept this file declares. So
the second spelling remains pinned by fixtures and unexercised by real code, which
is a limitation that REMAINS (*Limitations* 5) and is stated as one rather than
dissolved by the first spelling arriving.

**An earlier revision of this section called the cross-file half of the overturn
condition "measured at 0 occurrences", and the word measured was doing work the
probe cannot do.** The probe resolves a concept name against the concepts the SAME
file declares, so it has no vocabulary for "a concept declared elsewhere" at all.
What is measurable is a bound, and the probe publishes it rather than asserting it
in a fixture comment: of the 156 `is`-in-a-concept-body expressions, **124 name an
identifier on the right and 32 do not**; of the 124, **13 sit on a bare formal
parameter** and the other 111 on a dotted left (`o.foo is X`) or a call
(`name(x) is X`). The 13 name `U(2)`, `int1`, `int2`, `PrimitiveBase`,
`IntegerBase`, `IdBase`, `string`. Checked against the corpus rather than the
probe's own bookkeeping: `U` is a formal parameter in
`nim/tests/macros/tgettype.nim:33,44` and not a concept; `int1`, `int2` and
`string` are builtins; and `PrimitiveBase`, `IntegerBase`, `IdBase` are not
declared as a concept anywhere in 6,063 files. The concept-declared names in the
wider population are `Primitive(1)`, `IntegerLike(1)`, `IdLike(1)` from
`nim/tests/concepts/trecursive_concepts.nim` and `RegularConcept(1)` from
`nim/tests/concepts/texplain.nim:131` — every one on a left the guards decline.
So the cross-file half is **bounded, not settled**: it would need a cross-file
concept index to decide, and on this corpus it would have nothing to decide. And
the `of`-form has now answered a related question with a number: of the 47 edges,
**4 point at a concept declared in another module** (`Hashable`, `Equatable`,
`Stringable`, and one more in `nimony`), so the cross-file case is no longer
hypothetical for this family.

**Two probe bugs, both found by running and both the same class.** A guard that
cannot match prints the same 0 as a construct that does not occur:

1. The `is`-form guard looked its parameter up in a map keyed by concept OWNER
   name instead of walking each concept body with that concept's own parameters,
   so every lookup missed and it reported `leftIsBareConceptParameter: 0` against
   13 real sites. Found by running the probe, not by reading it.
2. The text probe's first pattern was tight enough to miss the one file that
   exists, because the site there QUOTES the keyword (`('of'`). It reported 0 and
   looked like corroboration.

### Five defects found by measurement, and what each one cost

None of these was visible in the source. Each is a delta between what the parse
tree carries and what the run published, and each was found by a script that reads
the tree independently of the analyzer.

**1. A named nested routine is a declaration, and it was not published.**
`proc recentlyOpenedAdd(filename: string)` inside `proc closeTab` is a Nim closure
with a stable name that the parent calls by that name. The analyzer published the
`calls` edges and no symbol at their far end, so the graph asserted 653 edges it
could not walk. Now published with `scope` set to the parent — the lua lane's
convention for this exact shape — plus a `contains` edge read from
`metadata.nimNestedIn`, because the owner here is a FUNCTION and `ownerName` is the
family field for a class owner. Deliberately *not* added to `fileCallables`: that
set is the module-scope callable set, and adding to it would reclassify every
unqualified reference to that name anywhere in the file.

| | before | after, fix-time | after, pinned walk |
| --- | --- | --- | --- |
| `calls` edges whose target is declared on the tree and published nowhere | 653 | **17** | **19** |
| callable declaration recall (tree declarations vs published symbols) | 97.5% | **99.97%** (34,455 / 34,466) | **100.0%** (46,960 / 46,971) |

Three numbers per row because they are three corpora and two walks. The pinned
figure is `validation/m14/measurements/nim/resolution-audit.json` on blob
`9d9ee478e3295c28` over 6,063 files, and its 19 is the count to quote: the fix-time
17 was over 4,555 files and the earlier 14 was a third walk of that corpus. The
residue is 11 unpublished callable names on the pinned walk. **10 of the 11 are named
in the artifact and one is not**, because `resolution-audit.ts:360` stores
`unpublishedExamples.slice(0, 10)` — so the per-name breakdown below is a **bound over
the first 10 misses**, not a partition of the 11. An earlier revision of this paragraph
printed `root`(3) and said "**All 11 are named with their source lines in the artifact,
so there is no residue left to argue about**". Both halves of that were wrong: the
artifact names 10, and `root`'s 3 is what is LEFT after subtracting the eight names that
are listed, which is a subtraction and not a count. What the artifact actually holds is
`destructor`(3), `root`(2), `me`(1), `super`(2), `_`(2) — ten entries, with an
eleventh unnamed. The count of 11 is measured; the breakdown under it is a bound.

The residue is not this analyzer's either, and that is now measured rather than
asserted. Under the base's `src/ast/pool-worker.ts` the residue is **4**, fully
enumerated (4 residue, 4 named), the 7 that clear being `destructor`, `root` and `me` —
the three names the base's `keepSymbol` split moved out of the universal denylist. See
*Session 5*. So 7 of the 11 are a property of the shared denylist and not of this lane;
what remains attributable here is `super`(2), which the base still keeps
unconditionally, and `_`(2), Nim's discard name. 653 → 19 over a corpus 33% larger is
the honest shape of this fix, and it is not 653 → 0.

**2. A `runnableExamples:` block's type declarations are declarations.** The Nim
compiler compiles a `runnableExamples` block as its own unit, so
`type Sub1 = ref object of Base` inside one is real and yields a real `extends`
edge. Nine `object_declaration.inherits` occurrences on the corpus parse trees had
an owner symbol published nowhere; this is **6**. The grammar's part in it is that
it parses `runnableExamples:` as a `call` whose `argument_list` holds the whole
example, so the block sits inside the documenting routine's `body` field and the
C-D1 rule ("a `type` section inside a body is an execution artifact") suppressed
it — a rule that is right for a body and wrong for a separate compilation unit.

The six that remain are three different things, and none of them is this rule: two
in `nimsuggest/tests/fixtures/mclass_macro.nim` are a macro that *builds* an
inheritance clause from two backtick parameters; one in
`tests/macros/tgettypeinst.nim` is named `_`; and two are a `type` section inside a
body under `static:` (`tests/stdlib/trepr.nim`) and inside a `template` body
(`tests/template/template_issues.nim`), which is the C-D1 rule and is deliberate.
An earlier draft of the code comment claimed this rule emptied the bucket; the
measurement says 9 → 6 and the comment now says 9 → 6.

Its *value* declarations stay suppressed — `var base: Base = Sub1()` is a local of
the example exactly as `var` in a routine body is a local of that routine — so the
two halves of this fix are pinned by opposite halves of one fixture, and a "fix"
that published them would fail it.

**3. A `runnableExamples:` pragma is not a call.** Because the grammar parses the
example as the call's `argument_list`, the call branch fired on a keyword and
published `describe -[calls]-> runnableExamples` with 60 characters of the
example's source in `callExpression`. No Nim program calls anything by that name,
so it is an edge the graph can never resolve — the fabrication rule's cheapest
available instance. 24 such frames in `nim/lib/system.nim` alone. Suppressed on
the *shape* (the argument must hold a statement list or a block), so a user proc
of that name is still published.

**4. A method now publishes `qualifiedName`, which is what makes an `overrides`
endpoint resolvable at all.** `overrides` endpoints are receiver-qualified
(`Rect.describe`) because the bare name cannot address either end — and no symbol
published that spelling, so a consumer resolving a target against published names
had nothing to match. The worker's `scope`-derived fallback cannot recover it,
because a method's owner is `ownerName`, not `scope`.

`script/m14/incoming-check.ts nim <105 files of nim/lib/pure>`, before and after:

| | edges | distinct targets | ambiguous | **unresolved** |
| --- | --- | --- | --- | --- |
| before | 14 | 0 | 0 | **14** |
| after | 14 | **7** | 0 | **0** |

**5. A node-identity guard that never fired, in the `type_declaration` wrapper
walk.** `src/ast/real-nim-analyzer.ts:701` read
`if (!c || c === symDecl) continue`, where `symDecl` is `node.namedChild(0)` and
`c` is `node.namedChild(i)` — two web-tree-sitter `Node` handles on the same
parent. The hygiene gate's rule is that object identity never matches because the
wrappers are fresh per access, and the rule is right, but a class rule is not a
measurement, so it was measured.

`validation/m14/fixtures/nim/node-identity-reachability.ts`, arm 1 of
`validation/m14/measurements/nim/node-identity-ab.txt`:

| probe, over 494 `type_declaration` nodes in 109 sampled corpus files | count |
| --- | --- |
| `c === symDecl` TRUE, at the ONE index where the guard could fire | **0** |
| `c.id === symDecl.id` | **494** |
| `c.startIndex/endIndex` equal | **494** |

So the guard was unreachable, and the loop went on to test the symbol declaration
itself, whose `type` matches none of the branches below it — a no-op iteration with
or without the guard. Now `if (!c || i === 0) continue`, which is what the line
said it meant.

**What it cost: nothing, and that is measured rather than asserted.** The blob moved
from `a59574036eb9f7fb` to `9d9ee478e3295c28`, which invalidated every digest-pinned
number in this document by construction, so all of them were re-run. The neutrality
A/B is two full censuses over the same 4,555 files at 6 workers, each clean
(`empty-kind: 0`, `parseFile threw: 0`, exit 0), and **all ten types agree to the
edge** — 79,129 / 31,063 / 21,579 / 9,345 / 40,559 / 408 / 570 / 0 / 48 / 1,990,
184,691 edges and 83,692 symbols on both blobs.

**How it was found, which is the part worth carrying to other lanes:**
`script/m14/verify-analyzer-hygiene.ts` cannot examine this analyzer.
`GATED_ANALYZERS` at its line 30 is a hardcoded map of **25** languages, `src/ast/`
holds **48** analyzers, and `nim` is not among the 25 — `--lang nim` prints
`unknown language: nim`, and the committed `validation/m14/results/M14.0.F7.json`
contains **0 occurrences of the string `nim`**. **23 analyzers have never been
hygiene-checked**, and for every one of them "no findings" is an absence of
measurement. This lane ran the gate's own five exported detectors over its own
source instead, without editing the gate, and that is how the defect surfaced.
`validation/m14/fixtures/nim/verify-analyzer-hygiene-nim.ts` keeps it from coming
back: it is an **A/B, not an assertion** — HEAD must be 0 findings AND a copy with
the pre-fix line restored must be CAUGHT by `bare-node-identity-comparison`. Either
half alone would be a green that means nothing.

### The oracle had to be able to disagree, and it caught a defect the analyzer could not see itself

Publishing the nested-routine `contains` family and checking it against nothing is
the failure this workstream is built on: the analyzer omits a family, the oracle is
written after the omission, and nothing disagrees with nothing. So
`script/m14/nim-truth-oracle.ts` now derives it from the **parse tree** — walking
lexical nesting, reading the `body` FIELD rather than the whole declaration
subtree, and reading no analyzer metadata at all, because an oracle that read
`nimNestedIn` would be checking the analyzer against itself.

`contains` MISSING went 126 → 0 on the 400-file oracle sample, and 9 UNEXPLAINED
appeared. Both directions were adjudicated, and the oracle was wrong twice:

- **`calls -> runnableExamples`, 7 unexplained** across seven stdlib files. The
  oracle now applies the same shape test. The analyzer was right.
- **`contains then -> fn` / `-> asyncFact` / `-> main`** at
  `nim/lib/js/asyncjs.nim:206-216`. A `runnableExamples` block is compiled by
  `nim doc` as its own unit, so a routine inside it is not lexically inside the
  proc that documents it, and `then -> fn` states something false. The oracle now
  clears the enclosing routine at a doc-example argument.
- **`calls -> rmSpaces` at `nim/lib/packages/docutils/rst.nim:3493` — the
  analyzer was wrong.** `p.s.idxImports[origFilename.rmSpaces]` is a *parenless
  UFCS call*: Nim invokes `rmSpaces(origFilename)` with no parentheses and no call
  node, so the callee is a member leaf. `rmSpaces` is declared at `rst.nim:3491`,
  **inside** `proc dirImportdoc`, and the parenless-UFCS test read `fileCallables` —
  the module-scope set that nested routines are deliberately kept out of. Fixed by
  consulting a second set from that one branch only. An analyzer that read only its
  own metadata would have agreed with itself and reported nothing, which is the
  whole argument for a separate walker.

### The resolution audit: external is not the same finding as never indexed

`validation/m14/fixtures/nim/resolution-audit.ts` classifies **every** edge target
into five measured buckets, because a resolution rate on its own cannot tell a
correct external edge from a missing declaration, and those are opposite findings.
Over the same 6,063 files at 2 workers, exit 0, 0 parse failures:

| type | edges | local | module stem | builtin | declared in another corpus file | **tree-only** | external |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | 118,261 | 38.9% | — | — | 59.4% | **19** | 1.7% |
| `uses` | 45,664 | 99.8% | — | — | — | 77 | 0.0% |
| `contains` | 29,362 | 99.9% | — | — | — | 30 | 0.0% |
| `imports` | 13,364 | 0.0% | **87.5%** | — | 1.5% | 0 | 10.9% |
| `references` | 56,445 | 45.7% | — | 1.3% | 51.2% | **0** | 1.8% |
| `exports` | 617 | 3.7% | — | 0.3% | 71.3% | 0 | 24.6% |
| `extends` | 627 | 71.0% | — | — | 28.4% | 0 | 0.6% |
| `implements` | 47 | 91.5% | — | 2.1% | 6.4% | 0 | 0.0% |
| `overrides` | 67 | **100.0%** | — | — | — | 0 | 0.0% |
| `instantiates` | 2,843 | **100.0%** | — | — | — | 0 | 0.0% |

**The `tree-only` column is the defect column**, and it is the one a reader would
act on: the target IS declared on a corpus parse tree and no symbol with that name
was published anywhere — a declaration the analyzer failed to publish, which is
exactly what the incoming direction cannot reach. It is **126 edges** across the
whole corpus — `calls` 19 + `uses` 77 + `contains` 30, and **0 on the other seven
types** — against **90** on the previous 4,555-file corpus. The count rose and the
rate did not: 126 / 267,287 = **0.047%** against 90 / 184,691 = **0.049%**. The
corpus grew 33% and the defect rate is flat, which is the only form of that
sentence worth printing.

Callable declaration recall over the same walk is **46,960 of 46,971 = 100.0%**.
10 of the 11 unpublished callable names are named in the artifact, capped there by
`resolution-audit.ts:360` (`slice(0, 10)`), and they are `destructor`(3), `root`(2),
`me`(1), `super`(2), `_`(2) — hook and conventional names, each in a `template`/`proc`/
`method` the analyzer declines to publish or that the production filter drops. The
eleventh is unnamed by the artifact, which is why the count 11 and this breakdown are
different kinds of number. Two of the named ones (`destructor`, `super`) are templates
whose `contains` edge the filter deletes (*Limitations* 12). Under the base's
`pool-worker.ts` the recall is **46,967 of 46,971** and the residue is 4 (*Session 5*).

**Three artifacts, three counts for the same list, and the reader needs all three.**
`resolution-audit.txt` prints a `callable: 11 shown` header and then lists rows;
`resolution-audit.json` carries its own `unpublishedExamples` array; and the
recall row counts 11 unpublished. The count is 11 and the lists are truncated at
different depths, so any claim that every unpublished name is printed is false
until checked against the file that prints them. This paragraph previously made
exactly that claim, and also named a fifth distinct tree-only name
(`localPassCAnswer`, "plus `_`") that appears nowhere in the artifact — residue of
an earlier 127-edge walk. Correcting a name list against the file that prints the
names is the whole method.

**This column moves with the walk, so it is worth saying which walk this is.** An
earlier resolution-audit run on the previous corpus and the same analyzer read
**127** tree-only edges (`calls` 53, `uses` 52, `contains` 22) and put callable
recall at 34,273 / 34,466 = 99.4%, because it published 83,041 symbols against its
own clean walk's 83,691 — 650 symbols lost to the load-dependent parse failures in
*Limitations* 8. On this pass the instrument ran at 2 workers and exited 0, and the
run at 6 workers on a saturated box is what produced the degraded figures the
previous revision of this document carried. A defect count that moves by 37 when
the box is busy is not a defect count a reader can act on, so `BB_NIM_WORKERS`
exists and the committed artifact is the clean run. Both are reproducible: the
same command at a higher worker count on a loaded box gives the larger number.

`exports` at 3.7% local is not a defect and the table says why: `export foo` names
something the file **imported**, so the target lives in another module by
construction. 71.3% of them are published by another corpus file and 24.6% are
outside it. `implements` at 91.5% local is the highest of the cross-module
families for a structural reason — a refinement names a concept, and 43 of 47 name
one this file declares — with **2.1% builtin**, which is the single
`implements -> int` edge *Limitations* 6 names.

### The extends delta, accounted to 1047/1047

`validation/m14/fixtures/nim/gap-hunt.ts` walks every `object_declaration.inherits`
on the corpus parse trees and buckets each one. **1,047 occurrences over 6,063
files in 403 files** (was 941 over 4,555), and every one is accounted for:

| bucket | count | what it is |
| --- | --- | --- |
| published as `extends` | **627** | the edges |
| compiler root (`of RootObj` / `RootRef` / `Object`) | 410 | a name with no referent anywhere; emitting an edge to it guarantees a dangling row |
| self-named (`type X = object of X`) | 2 | a self-reference, not a supertype — both in `tests/objects/tillegal_recursion{,2}.nim` |
| anonymous object (no named owner) | 0 | — |
| owner symbol not published | 6 | *Limitations* 13, which now enumerates all six by site |
| **unmatched** | **2** | both named below |
| **accounted** | **1047 / 1047** | |

The two unmatched are `nim/tests/objects/tillegal_recursion3.nim`'s
`Foo of ref Foo` — a compiler-*rejection* test file, where `ref Foo` is `Foo` and
the analyzer's self-name filter is right — and
`nim/tests/overload/toverload_issues.nim:59`'s `B of A`, where `B` is declared
**twice** in one file (`type B = A[int]` at :165 and `type B = object of A` at :59)
and name-keyed publication keeps one of them, so the other's base is lost. That is
a name-collision consequence and it is the same class as the ambiguity the incoming
walk measures (*Limitations* 19), not a separate defect.

**The two other questions this instrument asks, because a delta that only covers
one type is not a census.**

| | measurement over 6,063 files |
| --- | --- |
| `bracket_expression` in callee position | **3,830** occurrences in 959 files |
| …the callee names a TYPE this file declares | **844** |
| …names a PROC this file declares | 749 |
| …names **both** (ambiguous) | **0** |
| …is not declared in this file at all | 2,237 |
| …of those declared in-file, an `instantiates` edge exists | **973** |

The 2,237 are not misses and are not fabrications: they are generic constructions
of types declared in another module, which is the `imports`/`extends` cross-file
case rather than an `instantiates` one. The `bothTypeAndProc: 0` cell is the one
worth watching — it is why `collectInstantiationAt`'s "a type this file declares
and not a callable it also declares" guard has never had to break a tie on this
corpus, so the tie-break is untested by the corpus and rests on the fixture.

| | overrides / methods over 6,063 files |
| --- | --- |
| `method_declaration` on the tree | **230** |
| receiver readable from the first parameter | **186** |
| receiver readable from the receiver-qualified spelling | **0** — an ERROR node, a parse shape rather than a spelling (*Limitations* 16) |
| receiver not readable at all | 44 |
| …of the readable ones, declared in the SAME file | **175** |
| …declared in ANOTHER file | 11 |
| `overrides` edges published | **67** (recv in-file 67, recv out-of-file 0) |
| same-receiver method declared twice, not published | 6 |

`recv out-of-file 0` against `recvNotInFile 11` is the cross-file override family
and it is a corpus-walk limitation, not a defect: cross-file resolution needs
`ASTEngine.AnalyzeContext.overrideCompanion`, which the corpus walk supplies no
context for, so those 11 are counted and never resolved here (*Limitations* 15).

### The incoming direction: what REACHES a declaration, and where it cannot

`script/m14/incoming-check.ts` is the only instrument that measures the reverse
direction, and `src/lsp/impact.ts` is the consumer that needs it — the reverse walk
obtains its edges by scanning outgoing edges and matching targets, because no
inbound edge is stored in the schema at all.

**This section's numbers were, until this pass, the only numbers in the document
with no artifact behind them.** The table below was transcribed from a console
run of the shared instrument that was never committed, so nothing in the
repository could say which analyzer state produced it — and when it was finally
re-run and pinned, three of its five `nim/compiler` cells were stale.
`validation/m14/fixtures/nim/incoming-audit.ts` is the lane-owned wrapper that
closes this: it shells out to the shared script (which is §8 and is not edited
here) and adds the analyzer digest on both sides of the walk, a sha256 of the
FILE LIST, the child's exit code and stderr, and the one ratio the shared script
leaves implicit. Artifacts: `validation/m14/measurements/nim/incoming-compiler.{json,txt}`
and `incoming-lib-pure.{json,txt}`.

| index | files | symbols | `calls` edges | `calls` distinct | ambiguous | unresolved | `overrides` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `nim/compiler` | 182 | **11,366** | **24,299** | 4,671 | 3,150 | **2,253** | 0 edges |
| `nim/lib/pure` | 105 | 6,912 | 10,196 | 1,776 | 1,202 | 2,985 | 14 edges / 7 distinct / **0 unresolved** |

Three cells moved, all on the `nim/compiler` row, and each is shown rather than
overwritten: symbols **11,363 → 11,366**, `calls` edges **24,291 → 24,299**,
`calls` unresolved **2,246 → 2,253**. The `lib/pure` row reproduces **exactly**,
all five cells, so the compiler row was the stale one and not the instrument. The
corrected 2,253 agrees with `ambiguity-compiler.json`'s own
`perType.calls.unresolved`, so the two artifacts now corroborate each other where
they used to differ by 7.

Both runs are production `parseFile`, digest `9d9ee478e3295c28` unchanged on both
sides, child exit 0, 0 degraded parses, 0 parse failures. The file counts are
checkable now rather than asserted, and they are not the obvious ones:
`nim/compiler` is **182 = 180 `.nim` + 2 `.nimble`**
(`compiler/compiler.nimble`, `compiler/plugins/plugins.nimble`), because
`src/ast/language-detection.ts` routes `nimble: "nim"` alongside `nim` and `nims`.
A `compiler/*.nim` glob gives 180 and would have been wrong by two files.

**The ratio that predicts a wrong attribution is ambiguous-over-DISTINCT-TARGETS,
not ambiguous-over-edges**, because `src/lsp/impact.ts` picks one winner per
target name. The wrapper publishes it:

| type | `nim/compiler` | `nim/lib/pure` |
| --- | --- | --- |
| `calls` | 3,150 / 4,671 = **67.4%** | 1,202 / 1,776 = **67.7%** |
| `uses` | 1,621 / 2,156 = **75.2%** | 823 / 1,399 = **58.8%** |
| `contains` | 356 / 3,894 = 9.1% | 289 / 1,317 = 21.9% |
| `references` | 114 / 480 = 23.8% | 219 / 327 = **67.0%** |
| `exports` | 0 / 17 = 0% | 3 / 42 = 7.1% |
| `extends` | 0 / 3 = 0% | 1 / 12 = 8.3% |
| `instantiates` | 2 / 155 = 1.3% | 14 / 103 = 13.6% |
| `overrides` | type did not fire | **0 / 7 = 0%** |
| `implements` | type did not fire | type did not fire |

**Two thirds of distinct `calls` targets on `nim/compiler` are ambiguous to a
name-keyed reverse walk**, and `uses` is worse at 75.2%. Read alone that is
alarming; it is the number the ambiguity-split table below then reduces by 97.8%,
and both are on the page because the reduction is this lane's own claim and needs
its unreduced form next to it.

The `overrides` row is the one to read twice. On `nim/lib/pure` it is **14 edges,
7 distinct targets, 0 ambiguous and 0 unresolved** — that is the `qualifiedName`
fix (*Five defects*, 4) holding end to end, and it is the same measurement the
before/after table quotes as 14 edges moving from 14 unresolved to 0. It is also
the only emitted type in this language that is **fully unambiguous**, on the one
index where it fires. On `nim/compiler` it reads **0 edges at all**: the family
fires, but not there, and *Limitations* 15 says why (10 corpus methods carry a
receiver declared in another file, and a bare corpus walk builds no companion).

**The `ambiguous` column is not this lane's ambiguity, and reading it as one would
be wrong by two orders of magnitude.** `incoming-check.ts:107` keys its
resolution map on NAME and discards the file, so a name declared once in the
referring file and once elsewhere in the indexed set counts as ambiguous even
though the edge's own file settles it. `validation/m14/fixtures/nim/ambiguity-split.ts`
restores the file dimension and separates the two:

| index | edges | harness "ambiguous" | **irreducible — same file** | overstates by |
| --- | --- | --- | --- | --- |
| `nim/compiler` | 50,094 | 12,516 | **270 = 0.5%** | 12,246 |
| `nim/lib/pure` | 21,235 | 5,990 | **756 = 3.6%** | 5,234 |

Per type on `nim/compiler` the irreducible share is `calls` 0.8%, `uses` 0.6%,
`contains` 0.4%, and **0.0%** on the other six. The 270 edges come from **36
names**, and the artifact carries all 36 with their counts
(`ambiguity-compiler.json` `sameFileAmbiguousNames`, whose per-name counts sum to
270 exactly): the top five are `config(62)`, `emptyNode(28)`, `c(23)`, `map(16)`,
`name(15)`, and the tail runs down to nine names at 1 edge each. Each is a file
that declares the same name twice, which is what overloading and the
field-versus-accessor collision look like in every language. **This is the place
the language makes the distinction impossible per-file, stated with its count
rather than smoothed over: 270 edges over 182 files.**

An earlier revision of this paragraph said the 270 edges came from "five names" and
then printed ten of them. The count was wrong and the list was truncated at a
different depth than the count: it is 36 names, of which ten were shown. The same
shape as the tree-only-list error the previous commit corrected, and it survived
that pass because it sat in the `ambiguity-split` section rather than the
resolution one. Stating it here because a reader who checked would otherwise have
no way to tell which of the two numbers was the measurement.

`lib/pure` is worse (756 edges, 3.6%) and again it is **92 names**, top five
`kind(60)`, `seconds(46)`, `im(29)`, `nanosecond(29)`, `isSsl(28)`, summing to 756
(`ambiguity-lib-pure.json`). It is worse because it is many small files in one
package where a name recurs inside a file more often, so the figure is a property
of the subtree and not of the analyzer — which is why both are reported.

**External is separated from never-indexed, per type, and the separation is a
bound rather than a verdict.** Against an index of 182 files and a corpus of 4,555:

| type | unresolved | on a corpus tree, outside this index | on no corpus tree (external) |
| --- | --- | --- | --- |
| `calls` | 2,253 | 2,253 | 0 |
| `references` | 556 | 556 | 0 |
| `imports` | 1,536 | 917 | **619** |
| `uses` | 12 | 12 | 0 |
| `exports` | 12 | 12 | 0 |
| `extends` | 4 | 4 | 0 |
| `contains` | 3 | 3 | 0 |

The named examples say what the columns mean: the most frequent `calls` targets
absent from this index are `defined(286)`, `default(154)`, `initIntSet(84)`,
`doAssert(67)`, `raiseAssert(60)` — all declared in `lib/system.nim` and
`lib/pure`, **neither of which is in the `nim/compiler` index** — and the 619
`external` edges are module paths (`std/assertions`, `std/strutils`) that the
corpus does not contain at all.

The first column is therefore **not** called a defect anywhere in this document,
and the instrument says so in its own output: a 182-file index of a 4,555-file
corpus cannot establish that a declaration was never published, only that it is
outside this index. What establishes it is `resolution-audit.ts` with the index
universe equal to the corpus, and that measurement is the **91 tree-only edges**
in the resolution table above, from five names.

### The six questions, per emitted type

Columns 1, 2, 5 and 6 are this pass's census (6,063 files, `session10-1w-census.ts`
at **1 worker**, analyzer sha256 `1475e53d0e528d0a`; column 5 is the intra-file rate,
and the corpus-wide counterpart is the resolution table above). Column 3 is the
oracle
cross-check (400 of 6,063 discovered
files, deterministic every-15th), whose instrument is a SEPARATE WALKER — so
"agrees" means "the two derivations agree", never "the edge is true". Column 4 is
adjudicated per type.

| Type | 1 Exists | 2 Fires | 3 Correct (oracle) | 4 Labelled | 5 Resolved | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 118,261 | 2,517 vs 2,528; 0 missing, **15 unexplained** | yes | 38.9% | 100% under 1.0; `usage_contextual` |
| `uses` | yes | 45,664 | 1,002 vs 1,003; 0/1 | yes | 99.8% | 55.0% at 0.75, rest 1.0 |
| `contains` | yes | 29,330 | 1,285 vs 1,295; 0/**10** | yes | 99.8% | 1.0, `structural` |
| `imports` | yes | 13,364 | 382 vs 382; 0/0 | yes | 37.1% | 1.0, `import_based` |
| `references` | yes | 56,445 | 694 vs 694; **3 missing**, 0 unexplained | yes | 45.6% | 0.9, `reference_qualified` |
| `instantiates` | yes | 2,843 | 134 vs 134; 0/0 | yes | 100.0% | 0.9, `usage_contextual` |
| `extends` | yes | 627 | 22 vs 22; 0/0 | yes | 71.0% | 1.0, `structural` |
| `overrides` | yes | 67 | 1 vs 1; 0/0 | yes | 100.0% | 1.0, `structural` |
| `exports` | yes | 617 | **12 vs 12 — exact** | yes | 3.7% | 1.0, `structural` |
| `implements` | yes | **47** | **3 vs 3 — exact** | yes | 91.5% | 1.0, `structural` |

**Column 3 moved on `contains` when the guard landed, and it moved on BOTH sides at
once, which is the only outcome that says the guard was right.** The oracle is a
separate walker over the same grammar, so it is blind to the analyzer's guard — it
derives 1,295 `contains` targets from the 400-file sample and is expected to derive
the fabricated slot too. The analyzer went 1,286 → **1,285** and the oracle went
1,296 → **1,295**: one target each, the same one. **A guard that removed a real
field would have moved the analyzer's count and not the oracle's**, and that is the
discriminating shape this cross-check is able to see. MISSING stayed 3 and
UNEXPLAINED stayed 26, and the three MISSING rows are byte-identical to the previous
run, so the guard introduced no new disagreement between the two derivations.
(`session11-oracle-crosscheck.txt`, 400 of 6,063, deterministic every-15th.)

**All ten types now have an oracle derivation, and 8 of the 10 agree exactly.**
That is the substantive change this pass made to question 3, and it came from
paying down the DERIVATION debt rather than from any analyzer change: `exports`
and `implements` had **no second opinion at all** and both now do.

**Question 2 — fires.** All ten fire. Nine on thousands of edges; `implements` on
47, which is the number that was 0 for the whole previous corpus and is the
reason this section reads differently from the last revision of this document.

**Question 3 — correct, and its limit.** Instrument:
`validation/m14/fixtures/nim/oracle-crosscheck.ts` over a deterministic
every-15th sample against `script/m14/nim-truth-oracle.ts`'s `deriveNimEdges`,
compared site-agnostically (label + normalized target). **The limit is stated
because it is real: both sides walk the same grammar, so a grammar fact both get
wrong is invisible to it.** "Agrees" means "the two derivations agree", never
"the edge is true".

| | pinned run |
| --- | --- |
| sample | 400 of **6,063** discovered files, deterministic every-15th, 400 parsed, 0 parse failures, 0 oracle throws |
| agreement | `imports` 382/382, `references` 694/694, `extends` 22/22, `overrides` 1/1, `instantiates` 134/134, `exports` 12/12, `implements` 3/3 — **7 exact** |
| MISSING | **3**, all `references` (`nim/tests/template/taliassyntax.nim -> U`) |
| UNEXPLAINED | **26** = `calls` 15, `contains` 10, `uses` 1 |

Every UNEXPLAINED row is adjudicated, and they are three families, not 26
defects: 9 of the 15 `calls` and 7 of the 10 `contains` are accent-quoted
operator targets the production filter deletes (*Limitations* 12); `=destroy`
×5, `=copy`, `=dispose` and `=sink` are destructor/hook operators, which are
hooks rather than runtime calls; `cast` is a macro-built call; and the residue
(`contains -> $`, `uses -> type`) is a name that really is declared in Nim. The
3 MISSING are the recorded `BlenderRgb[Rgba8]`-class ambiguity, named with its
file in the artifact.

**And this instrument had a defect that made every one of those numbers
meaningless until this pass.** `oracle-crosscheck.ts` walked `readdirSync` and
broke out of the repo loop at `LIMIT * 4` files — a cap on DISCOVERY wearing a
cap on the sample's clothing. Measured: at 6,063 admitted files it discovered
**4,075**, and all ten of its rows came back **byte-identical** to the run made
before `nimony` was cloned, `implements` included. A truncated sample is
indistinguishable from a stable one — digest-pinned artifact, exit 0, plausible
numbers — so it read as reproducible evidence about a corpus it had stopped
looking at. `LIMIT` is a bound on how many files get PARSED; bounding discovery
by the same number only makes the sample unrepresentative. Discovery now walks
every repo, and the artifact records `reposWalked` so a short walk is visible in
the output rather than inferable only by diffing two runs. With the cap removed
`uses` moved 825 → 1,002, `contains` 995 → 1,286 and `references` 624 → 694.

**The oracle had to be able to disagree, and it disagreed on its first pass at
the new derivations.** The initial `deriveConceptRefinement` scraped every
identifier under a refinement list, so on `Bar = concept of Foo[T]` it published
`Bar implements T` — the type argument read as the type. The cross-check caught
it in the same round it was written. The rule is now one name per
`type_expression`, taken from the node's shape. Recorded because an oracle that
agrees because it was written to agree is not an oracle.

**Question 4 — labelled.** The two confusions this ontology actually risks in Nim
are both adjudicated with a number rather than a claim. `extends` vs `implements`:
the `of` clause is read two ways by two node types — `object_declaration.inherits`
(1,047 occurrences, 403 files) is nominal and is `extends`;
`concept_declaration.refines` (38 occurrences, 24 files) is structural and is
`implements`; publishing a refinement as `extends` is caught by the mutant
`nim/concept-refinement-labelled-extends`. `calls` vs `uses`: the callee leaf is
excluded from the `uses` pass, and `nim/star-marker-promoted-to-an-exports-edge`
covers the `exports` boundary. `exports` vs `contains`: the `*` marker (39,933
occurrences, 2,016 files) is a VISIBILITY modifier on a local declaration, not a
re-export; counting it as `exports` is the mutant above.

**Question 5 — resolved, and the low rates are the finding.** `calls` at 38.9%
and `references` at 45.6% are cross-module targets: a Nim file calls and names
types declared in the 3,968-file compiler, the 1,508-file nimony and the
libraries, and the census resolves endpoints against the symbols of the file's
own draw, so a cross-file target reads as unresolved here and resolves in a full
index. The *resolution audit* splits the same edges by cause and the split is the
diagnosis rather than an assertion: `calls` is 38.9% local, **59.4% declared in
another corpus file**, and only 1.7% nowhere. `references` is 45.7% local, 51.2%
another-file, 1.3% builtin. `exports` at 3.7% is the sharpest case: 71.3% of its
targets are declared in another module, so a low local rate is the honest reading
of a correct edge by construction. The CSS `references` reference point (66.8%)
sits between the two classes. `implements` at **91.5%** is the highest of the
cross-module families and the reason is structural: a refinement names a concept,
and 43 of 47 name one this file declares. `overrides` (100.0%), `instantiates`
(100.0%), `contains` (99.8%) and `uses` (99.8%) sit at the other end: their
targets are declared in the same file by construction, so those four rates are the
ones a regression in publication would actually move.

**The defect column, which is the one a reader would act on.** TREE-ONLY means
the target IS declared on a corpus parse tree and NO symbol with that name was
published anywhere — a declaration the analyzer failed to publish, which is
exactly what the incoming direction cannot reach:

| | previous corpus (4,555) | this corpus (6,063) | rate |
| --- | --- | --- | --- |
| `calls` tree-only | 14 | **19** | — |
| `uses` tree-only | 53 | **77** | — |
| `contains` tree-only | 23 | **30** | — |
| **total** | **90** | **126** | 0.049% → **0.047%** |
| callable declaration recall | 34,452 / 34,466 | **46,960 / 46,971** | **100.0%** |

The count rose because the corpus did; the RATE did not move, and that is the
honest framing. 10 of the 11 unpublished callable names are named in the artifact (it
caps at 10) and are `destructor`(3), `root`(2), `me`, `super`(2) and `_`(2) — hook and
conventional names, not dropped declarations, and 7 of the 11 clear under the base's
`pool-worker.ts` because that file stopped denylisting them (*Session 5*).

**Question 6 — confident, in one number.** **0 of 267,265 corpus edges fall below
0.7**, so nothing in this lane is a heuristic by the honesty contract §4's 0.7
line, and the ratio is countable rather than a vibe. The sub-1.0 edges are a
different thing and are countable by type — `calls` 0.85 (usage-inferred callee,
113,997) and 0.9 (4,206), `imports`-qualified `calls` 0.75 (58), `uses` 0.75
(25,104 = 55.0% of that family) with the rest at 1.0, `references` 0.9 (56,438),
`instantiates` 0.9 (2,843), `overrides` companion edges 0.9.

### DERIVATION debt — paid down to zero, and the gate still says six

**Measured: 0.** All ten types have a tree-walking derivation in
`script/m14/nim-truth-oracle.ts`, and 8 of the 10 agree exactly with the analyzer
on the pinned sample.

This pass added the two that were missing, and both had been sitting in plain
sight:

| | before | after |
| --- | --- | --- |
| `exports` | 12 analyzer targets, **0** oracle derivations — "unaudited", reported as if it were 12 defects | **12 vs 12, exact** |
| `implements` | 3 analyzer targets, **0** oracle derivations | **3 vs 3, exact** |

`grep -c 'push("exports"\|push("implements"' script/m14/nim-truth-oracle.ts`
returned 0 for both before this pass. `implements` read 0 on BOTH sides until
`nimony` entered the corpus, which is why nobody noticed: **a type nothing emits
cannot be un-audited by an instrument that compares emissions.**

Both derivations are tree walks rather than analyzer-metadata reads —
`concept_declaration.refines`, and `export_statement`'s operand list with
`except` skipped by ancestry — so they are a second opinion and not a
restatement. `implements`'s first version was wrong and the cross-check said so
one round after it was written; that is recorded above and in the mutant.

**`script/m60/rel-type-coverage-gate.ts --langs=nim` still prints 6, and it is
wrong in both directions.** Its audited set for nim is
`["extends","implements","instantiates","overrides"]`, and:

- it **credits `implements`**, which had no derivation at all until this commit;
- it **charges 5 types the oracle does derive** — `calls`, `contains`,
  `imports`, `references`, `uses`.

Net: 6 findings, none of which is the pair that is actually un-audited. Measured,
not quoted: that audited list comes from the language-agnostic DEFAULT branch of
the differential's filter (`script/m14/differential.ts:23153`), not from nim
oracle code — `grep -c "nim-truth-oracle\|deriveNimEdges" script/m14/differential.ts`
returns **0**, so the gate is not reading this lane's oracle at all.

**§8 report, stated so it can be applied without re-deriving it.** In
`script/m14/differential.ts`:

1. `LANG_REPOS` (line ~393) has no `nim` key. Add `nim: "nim"`. The clone is
   already at `$HOME/fixtures/repositories/nim`. This is what makes
   `--lang nim` stop printing `[lane] SKIP nim`.
2. Add `import { deriveNimEdges } from "./nim-truth-oracle"` and one branch
   feeding it for `lang === "nim"`.
3. The same file's nim entry at line ~25174 reads `ext: "nim,nims"` with a
   comment saying `.nimble` "is NOT routed to nim and which is therefore not
   swept". That was true when written and is false now —
   `src/ast/language-detection.ts:53` reads `nim: "nim", nims: "nim", nimble:
   "nim"` — so the ext list needs `,nimble` or the lane under-reports a surface
   the production router already handles by 171 files.

After (1) and (2) the gate's DERIVATION count for nim becomes 0 by its own
arithmetic, and the arbiter of the six questions stops being silent for this
language. None of the three is a lane edit.

## Corpus validation

| Repo | Files | What it is |
| --- | --- | --- |
| `nim` | 3,968 | the compiler and the whole standard library |
| `nimony` | 1,508 | the next-generation compiler — **added 2026-10-04, and it moved the verdict** |
| `nim-lang-nimble` | 435 | the package tool's own source |
| `graphql-nim` | 55 | a GraphQL client |
| `nimterop` | 45 | the C FFI layer |
| `bigints` | 21 | arbitrary-precision integers |
| `dom96-jester` | 19 | an HTTP test client |
| `Aporia` | 12 | a GTK3 app |

**6,063 files across 8 repositories**, above the project's 200-per-family floor,
and the file set is the arbiter's own walk (`git ls-files` +
`detectLanguageFromPath === "nim"` + a 512 KB cap) rather than a hand-picked
list — so this lane's census and the shared arbiter measure the same set.

**How `nimony` was found, because the method is the transferable part.** Four
attempts in earlier rounds to add a repository that refines a concept all
returned "Repository not found" — `vnen/gambit`, `nim-lang/nimph`,
`treeform/nim-regex`, `yardex/nim-confutils` — while `git ls-remote
https://github.com/nim-lang/Nim` from the same host succeeded. The names were
wrong; the network was not blocked. The working method is a code search:

```
gh api -X GET search/code -f q='"= concept of" language:Nim' -f per_page=50
```

which returns 26 files across `nim-lang/nimony` and others, and
`gh api repos/nim-lang/nimony --jq .size` gives 13,460 KB before cloning. The
clone is `--depth 1 --filter=blob:none` and lands at 23 MB on disk. **A ruling
with no corpus behind it is worth exactly what the corpus search was worth**,
and guessing repository names from memory is worth nothing.

The corpus has now grown twice on this lane's record — 4,101 → 4,555 (adding
`nim-lang-nimble` 435 and `dom96-jester` 19) → 6,063 (adding `nimony` 1,508) —
and **every one of the ten per-type counts rose on both occasions and none
fell**. That direction is the check that the earlier corpora were incomplete
rather than merely different, and it is why the second growth overturned a ruling
rather than confirming one.

## Gates re-run on this pass, and what each one answered

Every row is a command, its exit code, and the number it produced. Nothing here is
quoted from an earlier round.

| command | exit | result |
| --- | --- | --- |
| `npx tsx script/m14/ontology-coverage-gate.ts nim` | **1** | session 7, and this row's exit code has MOVED: earlier passes read **2** with `corpus: 6063 admitted files` then `no RULING TABLE for nim`. This pass never reaches the refusal — it prints the header and two `[BB-PARSE-ERR] … memory access out of bounds` lines (`dll/nimhcr_0_6.nim`, `package/stdlib/stdlib.nimble`) and then dies on `[BB-HANG] parser stuck 120s … dll/nimhcr_0_6.nim`. The §8 wiring is unchanged and still the reason the gate would refuse; at 8 workers the shared watchdog now gets there first, so the refusal is no longer the observable outcome. `RULED_BY_LANG` still carries `bash`, `json`, `lua`, `toml` and no `nim` (`session7-arbiter.txt`) |
| `npx tsx validation/m14/fixtures/nim/ruled-gate.ts` | 0 | the arbiter's own verdict loop on a copy: **`emitted 10/10  ruled-sound 0  FALSIFIED 0  ruled-without-justification 0`**, 255s, `implements EMITTED 47 edges in 4+ files, e.g. nimony/lib/std/math.nim`. Table rows: 0 |
| **`BB_NIM_RULED_WORKERS=1 npx tsx validation/m14/fixtures/nim/ruled-gate.ts`** | **0** | **session 11, 519s, at the CURRENT blob `1475e53d0e528d0a`: `emitted 10/10  ruled-sound 0  FALSIFIED 0  ruled-without-justification 0`**, 6,063 admitted files, and **all ten per-type counts identical to the digit with the current 1-worker census** — `calls` 118,261, `uses` 45,664, `contains` 29,330, `references` 56,445, `imports` 13,364, `instantiates` 2,843, `extends` 627, `exports` 617, `overrides` 67, `implements` 47. Two instruments, zero disagreement, at fan-out 1 (`session11-ruled-gate.txt`) |
| `BB_NIM_RULED_WORKERS=1 npx tsx validation/m14/fixtures/nim/ruled-gate.ts` | 0 | session 7, 887s, at the PREVIOUS blob `9d9ee478e3295c28`: the same `emitted 10/10  ruled-sound 0  FALSIFIED 0  ruled-without-justification 0`, with `contains` **29,362** — the one cell the guard moved. Kept rather than deleted, because the two runs together are what shows the arbiter and the census agreeing at two different blobs, and one of them contains a number the other does not |
| **`BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/census.ts <out>`** | **0** | **session 10, at `1475e53d0e528d0a`**: 6,063 files, 6,063 parsed, **0 empty names, 0 empty kinds, 0 throws, 0 off-ontology edge types, 8 literal `unknown` endpoints**, **110,043 symbols, 267,265 edges**, `degradedWalk: null` (`session10-1w-census.txt`). This is the walk the verdict table and the six-questions table are built on |
| **`BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/resolution-scope.ts <out>`** | **0** | **session 11, at `1475e53d0e528d0a`**: **78,808** name spellings, intra column reproduces the census on all ten types, corpus-wide `calls` **98.2%** / `references` 96.9% / `exports` 75.4% / `extends` 99.4% / `implements` 100.0% / `imports` 38.6%. No negative delta, which is impossible by construction and none appears (`session11-resolution-scope.txt`) |
| **`npx tsx validation/m14/fixtures/nim/oracle-crosscheck.ts <out>`** | **0** | **session 11, at `1475e53d0e528d0a`**: 400 of 6,063 every-15th, 400 parsed, 0 failures, **MISSING 3 / UNEXPLAINED 26 — unchanged**. `contains` moved on BOTH sides (analyzer 1,286→**1,285**, oracle 1,296→**1,295**), which is the shape that says the guard removed a fabricated target and not a real one (`session11-oracle-crosscheck.txt`) |
| `BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/census.ts <out>` | 0 | session 6, at blob `9d9ee478e3295c28`: 6,063 files, 6,063 parsed, 0 empty names, 0 empty kinds, 0 throws, **110,076 symbols, 267,297 edges**, digest `9d9ee478e3295c28` unchanged on both sides. `session6-1w-census.txt` is byte-identical to `session3-1w-census.txt` on all **112** lines of report body — the two differ in exactly two respects, and both are known: `session3` carried its 14 `[INFO]` lines inline where `session6` routes them to the `.stderr.txt` beside it, and the last line names its own output file. **At the bare default (6 workers) the same script produced no report at all** — exit 1, zero stdout, `[BB-HANG]` naming `nim/tests/dll/nimhcr_0_2.nim` (*Limitations* 8, row 5) |
| `BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/resolution-scope.ts <out>` | 0 | session 6, at blob `9d9ee478e3295c28`: all ten types identical to `session5-resolution-scope.txt`, **78,838** name spellings, intra and wide columns unchanged (`session6-resolution-scope.txt`) |
| `npx tsx validation/m14/fixtures/nim/census.ts <out>` (**no env var — `census.ts` hardcoded 6 workers at this commit; `BB_NIM_WORKERS` did not exist yet**) | **1** | 6,063 files, 6,063 parsed, **0** empty names, **0** empty kinds, 0 throws, 110,060 symbols, **267,287 edges**. Clean by the census's own five-part test, so the artifact was written under its own name; the exit 1 is `[BB-HANG]` naming `nim/tests/distinct/tinvalidborrow.nim`, which had already logged `[BB-PARSE-ERR] … memory access out of bounds` in the same run, the only other parse error in the run being `tests/overload/toverl.nim` (*Limitations* 8). This row was labelled `BB_NIM_WORKERS=2` until this pass; the evidence that it was 6 is in the note above the verdict table. **No `BB_NIM_WORKERS=2` census artifact exists anywhere in this branch** — the one 2-worker attempt on record (`3bf212369`) died on `[BB-HANG]` and wrote nothing |
| `npx tsx script/m14/incoming-check.ts nim <105 files of nim/lib/pure>` | 0 | session 7, the supervisor's own reverse-direction instrument on the lane's own index: 105 files, **6,912 symbols**, 0 degraded, 0 parse failures. **Every cell of every row is identical to `incoming-audit.ts lib/pure`** — two instruments, no shared counting code. 3,386 distinct targets named, **1,555 orphans (22.50%)**, **184** distinct target names ambiguous. `implements` and `brain_import` do not fire in this subtree (no concept declaration in `lib/pure`; the family's 47 `implements` edges are all in `nimony`) |
| `npx tsx validation/m14/fixtures/nim/hang-file-arbitration.ts` | 0 | session 7, the arbiter of the §8 report: all **7** files this lane's walks have been aborted on, parsed ALONE through `parseFile` five times each. **35 of 35 parsed, 0 threw.** 16,683 B over 515 lines total, largest 7,828 B, smallest 90 B. Slowest call **6,511 ms cold / 289 ms warm** against the engine's **120,000 ms** watchdog — 18x headroom; a second run reads 3,275 ms cold, 37x. The named input is not the cause of any of the seven exits (`session7-hang-file-arbitration{,-run2}.txt`) |
| `npx tsx validation/m14/fixtures/nim/nim-ruled-probe.ts <out>` | 0 | the falsifier, run: `concept_declaration` **337 in 130 files**, `refinement_list` **38**, `is`-in-concept-body 156, guard failures `{argumentList:159, leftNotParameter:143, rightNotIdentifier:5, rightNotLocalConcept:8, selfReference:0}`, **`withRefinesField 38`, hits pushed 51**, 211 node types, raw-parse failures 0. The text probe finds 61 `of`-form sites classified 39 code / 21 comment / 1 string against 38 tree nodes |
| `npx tsx validation/m14/fixtures/nim/oracle-crosscheck.ts <out>` | 0 | session 8, at blob `9d9ee478e3295c28`: 400 of **6,063** discovered (was 400 of 4,075 — the discovery cap, now removed), every-15th, 400 parsed, 0 failures. **MISSING 3 / UNEXPLAINED 26**, and **7 of the 10 labels agree exactly** including `exports` 12/12 and `implements` 3/3, both of which had no derivation before this pass |
| `BB_NIM_WORKERS=2 npx tsx validation/m14/fixtures/nim/gap-hunt.ts <out>` | 0 | `extends` accounted **1047 / 1047** (was 941/941), published as `extends` **627**; `object_declaration.inherits` 1,047 occurrences in 403 files. `instantiates` 3,830 occurrences, 844 name a type this file declares, 973 have an edge. `overrides`: 230 methods on the tree, 186 with a readable receiver, **67 published** (recv in-file 67, recv out-of-file 0), receiver-qualified spelling 0 |
| `BB_NIM_WORKERS=2 npx tsx validation/m14/fixtures/nim/resolution-audit.ts <out>` | 0 | 6,063 files in 8 repos, **110,076 symbols** published, 0 parse failures. TREE-ONLY **126** = `calls` 19 + `uses` 77 + `contains` 30, rate 0.047% against the previous 90 / 0.049%. Callable declaration recall **46,960 / 46,971 = 100.0%** |
| `BB_NIM_WORKERS=2 BB_NIM_FILES=1500 npx tsx validation/m14/fixtures/nim/accent-quoted-endpoints.ts <out>` | 0 | 1,500 of 6,063 (deterministic every-4th). **459** accent-quoted declaration sites; 1,285 of 58,725 pre-filter edges carry a backtick endpoint, 1,189 of 58,629 post-filter; **96 deleted by `filterNoiseRelationships`**, split `calls` 73 / `contains` 17 / `exports` 3 / `uses` 2 / `overrides` 1, and the artifact prints the split beside the total so it sums |
| `BB_NIM_WORKERS=2 npx tsx validation/m14/fixtures/nim/unknown-endpoint-hunt.ts` | 0 | **8** edges with a literal `unknown` endpoint over 6,063 files, every one a real Nim identifier, each printed with its source line: `RefreshOutcome -> unknown` and three reads of it in `nim-lang-nimble/src/nimblepkg/refresh.nim`, `EGL_err -> unknown` in `gl.nim:21`, `Status -> unknown` in `nimterop/globals.nim:135`, and `Foo -> unknown` in `tuninstantiatedgenericcalls.nim:214` |
| `BB_NIM_AMBIGUITY_SUB=compiler npx tsx validation/m14/fixtures/nim/ambiguity-split.ts <out>` | 0 | 182 files, 11,366 symbols, 50,094 edges. **Irreducible (same-file) ambiguity 270 = 0.5%**; the shared harness counts 12,516, so it overstates this lane by 12,246. Per type the irreducible share is `calls` 0.8%, `uses` 0.6%, `contains` 0.4%, and **0.0%** on `imports`, `references`, `exports`, `extends`, `instantiates` |
| `BB_NIM_AMBIGUITY_SUB=lib/pure npx tsx validation/m14/fixtures/nim/ambiguity-split.ts <out>` | 0 | 105 files, 6,912 symbols, 21,235 edges. **Irreducible 756 = 3.6%**; harness 5,990, overstating by 5,234. Every cell reproduces its previously transcribed figure exactly |
| `BB_NIM_WORKERS=2 npx tsx validation/m14/fixtures/nim/incoming-audit.ts compiler` | 0 | 182 files (180 `.nim` + 2 `.nimble`), file-list sha256 `0fe8e92b827438bc`, analyzer sha256 unchanged, child exit 0, 0 degraded: 11,366 symbols, 9,060 distinct incoming targets, 767 orphans (6.75%). `calls` 24,299 / 4,671 distinct / 3,150 ambiguous / 2,253 unresolved / 562 self-loops; `uses` 7,217 / 2,156 / 1,621 / 12; `contains` 4,395 / 3,894 / 356 / 3; `references` 12,189 / 480 / 114 / 556; `exports` 29 / 17 / 0 / 12; `extends` 13 / 3 / 0 / 4; `instantiates` 166 / 155 / 2 / 0; `overrides` **0 — did not fire**; `implements` **0 — did not fire** (no concept in that subtree; the family's 47 edges are all in `nimony`) |
| `BB_NIM_WORKERS=2 npx tsx validation/m14/fixtures/nim/incoming-audit.ts lib/pure` | 0 | 105 files, file-list sha256 `23082d183e30d268`: 6,912 symbols, 3,386 distinct incoming targets, 1,555 orphans (22.50%). `calls` 10,196 / 1,776 / 1,202 / 2,985 / 814 self-loops; `uses` 5,054 / 1,399 / 823 / 11; `contains` 1,647 / 1,317 / 289 / 1; `references` 3,393 / 327 / 219 / 681; `exports` 112 / 42 / 3 / 69; `extends` 43 / 12 / 1 / 21; `instantiates` 110 / 103 / 14 / 0; `overrides` **14 / 7 / 0 / 0**; `implements` 0 |
| `bun run script/m14/run-fixtures.ts --lang nim` | 0 | **10 fixtures, 10 pass, 0 fail** (`{"nim":{"pass":10,"fail":0}}`), ending `fixture baseline gate: no regressions` and `all fixtures pass`. Scoped, so `M14.0.F3.json` is not touched and `--update-baseline` is refused — 46 lanes, this one selected. `nim/concept` now carries 11 symbols, 8 relationships and 11 forbids |
| `npx tsx validation/m14/fixtures/nim/verify-mutants.ts` | 0 | **17 run, 17 CAUGHT, 0 survived** (was 15/15). The two new ones are `nim/concept-generic-target-read-as-the-type-argument` and `nim/concept-self-cycle-published`, both caught by `nim/concept` specifically and neither satisfiable by a sibling row |
| `bun run script/m14/mutate-analyzer.ts` (no scoping; the runner has none) | 2 | **60 nim mutants, 60 caught, 0 survived** (was 58/58). Exit 2 is 6 survivors in OTHER lanes — `java/bare-read-type-attribution`, `groovy/modifier-return-type-loss`, `groovy/ctor-name-revert`, `scala/drop-import-source-rewrite`, `make/swallow-the-rule-after-a-comment`, `php/drop-external-override-guess`. It is also the producer of `M14.0.F4.json`, which it rewrote and which was reverted (§8) |
| `bun run validation/m14/fixtures/nim/verify-analyzer-hygiene-nim.ts` | 0 | **0 findings on HEAD, reverted copy CAUGHT** by `bare-node-identity-comparison` at line 714. `bun` and not `npx tsx` because it imports the shared gate, whose module body uses `__dirname` (*Limitations* 23) |
| `npx tsx script/m14/differential.ts --lang nim` | 0 | **[lane] SKIP nim: no corpus repo mapped in `LANG_REPOS`** — measured 0 lanes, M14.0.F5 not written. *Limitations* 18; the fix is stated precisely in *DERIVATION debt* |
| `npx tsx script/m60/rel-type-coverage-gate.ts --langs=nim` | **1** | session 7, reproduced: **6 DERIVATION findings**, the same six in the same order — `calls`, `contains`, `exports`, `imports`, `references`, `uses`, against an audited list of `["extends","implements","instantiates","overrides"]`. CHECK 2/3/4 clean. Unscoped it reads **115 findings in 36 lanes** with nim among them, so the six are not an artifact of scoping (`session7-rel-type-coverage-{scoped,full}.txt`). **This row is KNOWN WRONG in both directions and the measured truth is 0** — see *DERIVATION debt*. Exit 1 because the gate's verdict is `process.exit(regressions.length === 0 ? 0 : 1)` (`script/m60/rel-type-coverage-gate.ts:614`). **It also DESTROYS the §8 artifact it writes when scoped** — see below |
| `bun run script/m14/verify-analyzer-docs.ts` | 0 | nim appears in none of the three finding lists and in none of the 13 `(no relationship-ontology section)` entries |
| `bun run script/m14/verify-doc-truth-emissions.ts` | **1** | **0 findings attributable to nim** — no `FALSE_NEGATIVE`, no `FALSE_POSITIVE`, no `UNDOCUMENTED`, no `NO_CLAIM_TABLE`; nim is absent from all four finding lists and from `MISSING_DOC`, and its claim table is read with 10 rows. Exit 1 because the gate's verdict is repo-wide (48 analyzers) and every finding belongs to another lane. The gate has no `--lang` selector, so this lane cannot turn that 1 into a 0 and must not claim it has |
| `npx tsx script/m12/verify-regex-census.ts` | 1 | gate FAILED repo-wide, and **this lane contributes 0 of its 51 rows**: 26 MISSING + 25 STALE, all in `css`, `julia`, `clean`, `fsharp`, `javascript`, `python`, `svelte`, `typescript`. The analyzer holds no `RegExp`, no `.match(`, `.replace(`, `.test(` and no regex literal, so there is nothing here for this lane to fix |
| `bun run script/m14/verify-analyzer-hygiene.ts` | **1** | **3 findings repo-wide — and none of them is about this lane, because the gate never examines it.** `GATED_ANALYZERS` at `script/m14/verify-analyzer-hygiene.ts:30` is a hardcoded map of **25** languages and `nim` is not in it, so `--lang nim` prints `unknown language: nim` and exits. The 3 findings are `cpp/bare-node-identity-comparison`, `haskell/bare-node-identity-comparison`, `elixir/node-identity-comparison`. **This lane's analyzer hygiene is UNMEASURED by this gate, not clean**; the lane's own substitute is `verify-analyzer-hygiene-nim.ts` and it found a real defect on its first run (*Limitations* 23) |
| `npx tsx script/m14/verify-honesty.ts` | **6** | **0 failures repo-wide naming nim**. The number that matters is the 0, not the total: the total moves with the rest of the fleet. Every failure is a shared-artifact staleness or banned-term finding against other lanes' work. One sub-check here CORRECTS an earlier reading of this gate that appeared in this document, and the correction matters because the misreading was in this lane's favour. That revision said **the freshness rule "flags every artifact — it cannot distinguish current from stale"**, and dismissed the gate as unusable on that basis. Re-measured, the gate prints `ok freshness rule discriminates (2523 input(s) changed since 65df67e)` and `ok evidence freshness: 0 artifact(s) current against their declared inputs` — it **does** discriminate: M14.0.F8 and M14.0.F9 pass their freshness check while F1 through F7 fail theirs. The reason 0 of 9 read current is that declared inputs such as `src/ast/analysis-exclusions.ts` and `src/ast/brain-surgical-patcher.ts` are shared and have changed repo-wide, not that this lane's evidence is stale. **A lane that dismisses a gate has stopped being checked by it, and the dismissal was invisible because it was phrased as a limitation of the gate.** **The path the contract gives for this gate — `script/verify-honesty.ts` — does not exist**; the file is at `script/m14/verify-honesty.ts`, and a reader following the contract gets `ERR_MODULE_NOT_FOUND`, which is indistinguishable from the gate having nothing to report. §8 |
| `bun run script/m14/verify-grammar-pins.ts` | 0 | the `nim` pin holds: **`nim 421369fe6a88 5797624 B ids=377 named=127 anon=205 fields=24 vendored:19 files`**, and no `PIN FAILURE` line names nim. `alaviss/tree-sitter-nim@0.6.2` at commit `ac72ba30d16edf0be021588a9301ede4accd6cf4`, vendored byte-for-byte at `grammars/tree-sitter-nim/`. The failures this run prints are all `julia`'s. **`bun` and not `npx tsx`**: the script reads `Bun.main` at line 65, so under `tsx` it dies `ReferenceError: Bun is not defined` — the same class as *Limitations* 21 and 23, in a third harness |

**Four of the gates in that table WRITE SUPERVISOR-OWNED FILES as a side effect of
being run, and the fourth is qualitatively worse than the other three.** Measured
on this pass, all four reverted:

| gate | §8 file it rewrote | nature |
| --- | --- | --- |
| `verify-doc-truth-emissions.ts` | `docs/DOC-TRUTH-EMISSIONS.md` | other lanes' progress through a shared generator |
| `verify-analyzer-docs.ts` | `validation/m14/results/analyzer-docs.json` | (as above) |
| `mutate-analyzer.ts` | `validation/m14/results/M14.0.F4.json` | every lane's mutants, re-recorded at this branch's `commit` |
| `script/m60/rel-type-coverage-gate.ts --langs=nim` | `validation/m60/results/rel-type-coverage.json` | **DESTRUCTIVE WHEN SCOPED** |

**The fourth DELETES other lanes' records, and it is the one that would not have
been caught.** `--langs=nim` is *narrower* than the artifact it writes: the
committed `validation/m60/results/rel-type-coverage.json` holds **46 lanes**, and
the scoped run replaces it with **1**. Measured, not quoted —
`git checkout -- validation/m60/results/rel-type-coverage.json` followed by
`len(json.load(...)['lanes'])` reads 46 again. A scoped gate that truncates a
repo-wide ledger is worse than an unscoped one that refreshes it: the first
destroys data, the second only reorders it, and the deleted rows are other
lanes' repayment records. This is the same defect class as the write-guard added
to this lane's own `census.ts` (write nothing without an explicit output path),
reached from the other direction.

All four files are §8, so all four were reverted and the branch carries only
`real-nim-analyzer.ts`, its doc, and its own fixtures. But a gate cannot be both a
thing you run for evidence and a thing that edits a file you do not own, and the
two requirements conflict. §8, in the order the cost rises: either the generators
take an output path the way `census.ts` does (write nothing without one), or a
`--langs`-scoped gate writes to a scoped path and never to the repo-wide
artifact, or the workstream states that running a gate implies committing its
output, which on a seven-lane branch means every lane commits every other lane's
numbers — and, for the fourth, means every lane commits a file that deletes 45
lanes' work.

### Re-verification pass, and what reproduced

Every headline number in this document was re-measured on the committed blob
`9d9ee478e3295c28` in one pass, because a number inherited from a previous
session is a number nobody checked. This pass the corpus itself changed, so the
re-verification has two halves: what reproduced **despite** the corpus growing,
and what moved **because** of it. (This is the FIRST of two re-verification
passes; the second is the `####` subsection immediately below, and the tables
that follow the subsection belong to this first pass.)

#### Session-2 re-verification, 2026-10-04: every instrument re-run at HEAD

The pass above ran in an earlier session. This one re-ran the instruments at
`HEAD` = `e4c95ccad` with no analyzer change, because the question a reader has
about a table of numbers inherited from a previous session is whether they still
come out, and the only answer that is worth anything is a second walk. Analyzer
sha256 `9d9ee478e3295c28`, verified on disk against the pinned digest **before**
any instrument ran and unchanged after every one of them. Artifacts:
`validation/m14/measurements/nim/reverify-*.{json,txt}`.

| instrument | result | against the recorded figure |
| --- | --- | --- |
| `ruled-gate.ts` (the arbiter, on a copy) | **`emitted 10/10  ruled-sound 0  FALSIFIED 0  ruled-without-justification 0`**, 383s | verdict **reproduces**; per-type spread in the arbiter table above |
| `census.ts`, `BB_NIM_WORKERS=1` | **exit 0**, 6,063 of 6,063 parsed, **0** throws, **0** empty names, **0** empty kinds, **110,076 symbols**, **267,297 edges**, 8 `unknown` endpoints, `degradedWalk: null` | **7 of 10 types identical to the digit**; `uses` +2, `contains` +1, `references` +7, so **+10 edges on 267,287 = +0.0037%**, symbols +16 |
| `gap-hunt.ts`, 1 worker | `extends` on tree **1,047**, emitted **627**; `instantiates` **3,830** on tree, **844** name a type this file declares, **973** carry an edge; `overrides` **230** methods, **186** readable receiver, **67** emitted | **every figure identical** |
| `resolution-audit.ts`, 1 worker | **110,076** symbols published; **TREE-ONLY 126** = `calls` 19 + `uses` 77 + `contains` 30; callable recall **46,960 / 46,971** | **identical** (the recorded 110,076 came from this instrument, not the census) |
| `oracle-crosscheck.ts` | 400 of 6,063, 0 parse failures, **MISSING 3 / UNEXPLAINED 26**, **7 of 10** labels with identical counts | **identical**, digest unchanged both sides |
| `run-fixtures.ts --lang nim` | **10 fixtures, 10 pass, 0 fail**, `{"nim":{"pass":10,"fail":0}}`, baseline gate clean | **identical** |
| `verify-mutants.ts` | **17 run, 17 CAUGHT, 0 survived** | **identical** |

**The census reproduces to 0.0037%, which is an order of magnitude tighter than
this document claims, and the reason is the worker count rather than the
analyzer.** The committed artifact was taken at the **six workers `census.ts` then
hardcoded**; this pass's clean walk was at **1**. *Limitations* 11 measures 6
workers producing fallback files and empty-kind symbols and 1 worker producing
none, and that difference — not the analyzer — is the whole of the residual. So the
+10 edges are not drift in the reader: seven of the ten totals are bit-identical
across two different fan-outs, and the three that moved moved by 2, 1 and 7 edges
out of tens of thousands.

**The committed artifact is deliberately NOT re-baselined onto the 1-worker one,
and the reason is that re-baselining would cost ~90 edits in this document to move
a number by 0.004%.** The delta is inside the envelope already stated here, the
artifact is digest-pinned to a blob still on disk, and both walks are committed side
by side so the pair is checkable. Which figure is quoted where is fixed: **the tables
in *The ten relationship types* are the `ontology-census` artifact**
(`validation/m14/measurements/nim/ontology-census.{json,txt}`, 110,060 symbols /
267,287 edges, **six workers**), and the 1-worker walk is the reproduction
(`reverify-1w-census.{json,txt}`, 110,076 / 267,297). No figure in this document
mixes the two, and the two walks differ only in `uses`, `contains` and
`references` — the three types whose resolution depends on how much of the tree
survived the WASM heap.

**That artifact's worker count was recorded as 2 in four places in this document
until this pass, and it is 6.** The correction and its evidence are in the note
above the verdict table: neither half of the pair carries a `workers` field
(`3bf212369` added it, 4h10m after the artifact was written), `census.ts:283` read
`Array.from({ length: 6 }, () => worker())` at that commit, and `BB_NIM_WORKERS`
did not exist until `3e30d227d` (12:28:47 against the artifact's 10:55:24). No number
changes — 267,287 is 267,287 either way — but a reader who tried to reproduce the
table above would have run the wrong command, and a document whose whole method is
"quote the worker count" had four rows where the quoted count was invented rather
than read.

**What this pass FOUND, as opposed to reproducing: the JSON artifacts did not
carry the worker count, while this document said they did.** Line 564 and the
performance section both assert that "`BB_NIM_WORKERS` … each artifact prints the
count it ran at". That was true of the console line and **false of every JSON**:
`census.ts`, `gap-hunt.ts`, `resolution-audit.ts` and `accent-quoted-endpoints.ts`
each read `BB_NIM_WORKERS`, printed `workers : N` to stdout, and wrote a JSON body
with no such field. So the machine-readable artifact — the one a later reader
diffs — could not be reproduced from itself, and the `.txt`/`.json` pair could
disagree about the run that produced them with nothing to detect it. That is the
same defect class as the un-regenerated `.txt` in this lane's own history
(`7fc815c61`), one level down: there the pair disagreed, here the pair could not
disagree because only one of them was ever told. Fixed in all four writers;
`unknown-endpoint-hunt.ts` needs no change because it writes no JSON, and
`nim-ruled-probe.ts`, `ambiguity-split.ts` and `incoming-audit.ts` do not read
`BB_NIM_WORKERS` at all — they are single-threaded walks, so for them there is no
count to record. Verified by running two of them: `workers: 1` now present in the
JSON of `accent-quoted-endpoints.ts` and `gap-hunt.ts`.

**And this pass destroyed a census walk outright, which is the fourth measured
instance of the watchdog defect in *Limitations* 8 and the first against this
instrument.** `BB_NIM_WORKERS=2` on the same 6,063 files logged
`[BB-PARSE-ERR] nim | …/tests/async/treturn_await.nim | memory access out of
bounds` and then, 120 seconds later,
`[BB-HANG] parser stuck 120s on …/tests/async/treturn_await.nim — exiting`, and
the process died there: **no artifact of any kind, and not even the header line**,
because the `process.exit(1)` inside `engine.ts` takes the buffered stdout with
it. The write-guard never got to decide, so on this occasion it did not protect
anything — it is a guard against a *degraded* walk, and this was a *destroyed*
one. The same walk at `BB_NIM_WORKERS=1` completed clean in one pass, which is
the whole of the difference. **The operational rule this yields, and it is
measured rather than inferred: for this lane's corpus instruments on a loaded
box, 1 worker is the setting that returns a result, and 2 is not.** The tables
in this document were taken at 2 because that is what ran; the reproduction above
was taken at 1 for this reason.

**What reproduced exactly, with no code change.** These are the checks that say
the analyzer is unchanged rather than that the corpus is:

| | result |
| --- | --- |
| `census.ts` symbol hygiene | 110,060 symbols, **0** empty names, **0** empty kinds, 0 `parseFile` throws, 0 raw-parse throws, 6,063 of 6,063 parsed |
| `census.ts` endpoint hygiene | **8** endpoints equal to the literal `unknown`, **0** empty endpoints, **0** edge types outside the ten |
| `census.ts` confidence floor | **0 of 267,287** edges below 0.7 |
| `gap-hunt.ts` `extends` accounting | **1047 / 1047** — every `object_declaration.inherits` on the tree accounted for |
| `resolution-audit.ts` callable declaration recall | **46,960 / 46,971 = 100.0%** |
| `unknown-endpoint-hunt.ts` | **8**, every one a real Nim identifier, each printed with its source line |
| `ambiguity-split.ts` irreducible ambiguity | **270 = 0.5%** (`nim/compiler`) and **756 = 3.6%** (`nim/lib/pure`), both to the edge |
| `incoming-audit.ts` both subtrees | every cell reproduces, including `overrides` 14 / 7 / 0 / 0 in `lib/pure` and 0 in `compiler` |
| `oracle-crosscheck.ts` 7 labels | `imports` 382/382, `references` 694/694, `extends` 22/22, `overrides` 1/1, `instantiates` 134/134, `exports` 12/12, `implements` 3/3 |
| `run-fixtures.ts --lang nim` | 10 pass / 0 fail |
| `verify-mutants.ts` | 17 run / 17 CAUGHT / 0 survived |
| `mutate-analyzer.ts` | 60 nim mutants / 60 caught / 0 survived |

**What moved, and every movement is accounted for by the corpus.** All ten
per-type counts rose; none fell.

| type | 4,555 files | 6,063 files | ratio |
| --- | --- | --- | --- |
| `calls` | 79,129 | 118,261 | ×1.49 |
| `references` | 40,559 | 56,438 | ×1.39 |
| `uses` | 31,063 | 45,662 | ×1.47 |
| `contains` | 21,579 | 29,361 | ×1.36 |
| `imports` | 9,345 | 13,364 | ×1.43 |
| `instantiates` | 1,990 | 2,843 | ×1.43 |
| `extends` | 570 | 627 | ×1.10 |
| `exports` | 408 | 617 | ×1.51 |
| `overrides` | 48 | 67 | ×1.40 |
| **`implements`** | **0** | **47** | — |
| symbols | 83,692 | 110,060 | ×1.31 |
| corpus files | 4,555 | 6,063 | ×1.33 |

The ratios are all near the corpus ratio of ×1.33, which is what a uniform
addition of real code looks like, and that is the check worth making: a set of
counts that grew 1.3–1.5× when the corpus grew 1.33× has not acquired a new
emission path, it has acquired more input. `implements` is the one row with no
ratio, because it had no denominator — which is precisely why it could be
overturned.

**Two ratios are ABOVE the corpus ratio and one is well below, and both are
explained rather than averaged.** `exports` at ×1.51 is highest because
`nimony/lib/std` is export-heavy — its modules are consumed as a library, so the
`export` statement density is higher than the corpus average. `extends` at ×1.10
is lowest because `nim`'s 3,968 files carry the object-hierarchy mass and
`nimony`'s 1,508 carry concept refinements instead. Both are properties of what
the new repository is, stated so a reader does not read them as emission changes.

**The spread, measured again on the grown corpus.** Two instruments over the
same 6,063 files at different worker counts differ by 19 edges on `calls`
(118,242 vs 118,261) and 6 on `uses` — 0.016% and 0.013%. Over the previous
corpus, two runs of the *same* instrument over the same files differed by 82 on
`calls` (79,047–79,129) and 84 on `uses`, ~0.1%. The proportion is the invariant
and it held: **this lane's counts are reproducible to about a tenth of a percent
at a stated worker count, and not to the digit.** The cause is *Limitations* 8
and 11 — the WASM parser loses a load-dependent set of files to heap exhaustion,
and which files are lost is a property of machine load, not of the corpus or the
analyzer. `BB_NIM_WORKERS` now makes the fan-out choosable and every artifact
prints the count it ran at, because a number quoted without it is not
reproducible.

**The clean walk is now reproducible on this box, at a stated worker count.** The
previous pass recorded three full censuses against this blob of which **3 of 3
came back degraded** (34, 22 and 18 empty kinds) and concluded that "at the
corpus's size and this machine's current load, a clean walk is the exception".
This pass, the same command at `BB_NIM_WORKERS=2`, returned **0 empty kinds** —
so the earlier conclusion was about load, and the load was the variable. That is
recorded because "a clean walk is the exception" was a claim about this machine
dressed as a claim about the analyzer, and it did not survive one change of
worker count.

**Two instruments in this lane were themselves defective this pass, and both are
now fixed rather than noted.** `oracle-crosscheck.ts` capped DISCOVERY at
`LIMIT * 4` files, so it had been reporting a stable number for a corpus it had
stopped walking — every one of its ten rows came back byte-identical across the
corpus change, which is the signature of a walk that did not move. And
`ambiguity-split.ts` quoted its sibling artifact's TREE-ONLY figure from memory
("over 4,555 files … 91 edges"), so it would have printed a stale number from a
command that otherwise looks reproducible; it now reads the artifact and declares
absence if the artifact is missing. An instrument that measures the analyzer
while carrying its own drift is worse than no instrument, because the drift is
attributed to the thing being measured.

**Every figure in this document that quoted `4,555`, `83,692 symbols`,
`184,691 edges`, `209` node types or `implements 0` describes the previous
corpus.** They are not deleted, because they are what the falsified ruling was
measured against, and a ruling whose before-state is erased cannot be checked.

#### Session-3 re-verification, 2026-10-04: the supervisor's OWN instruments, run at full corpus

The two passes above re-ran **this lane's** instruments. This one re-ran the
**supervisor's shared** instruments against this analyzer, because a lane that only
re-runs its own instruments is measuring itself with its own ruler. Analyzer sha256
`9d9ee478e3295c28`, verified on disk before any instrument ran and unchanged after
every one of them. Artifacts: `validation/m14/measurements/nim/session3-*`.

**`script/m14/firing-check.ts` is not on this branch.** It is absent from
`analyzer/NIM` and from `origin/main` and exists only in the unpushed local base
`analyzers/ontology-laptop-b`, 205 commits ahead of this branch's merge-base. It was
run read-only from a `/tmp` copy with its two `src/` imports rewritten to absolute
paths; **the script is not committed here** (§8). Blob
`82361438966c8ab3252db065adc2a303acd4fff4`. Artifacts
`session3-firingcheck-{120,full}.{txt,json}`.

| sample | fired | edges | degraded | verdict |
| --- | --- | --- | --- | --- |
| `--files 120` (the file's own documented default) | **8/10** | 4,247 | 0 | `implements`, `overrides` absent |
| `--files 6063` (the whole corpus) | **10/10** | **267,297** | 0 | all ten fire |

**The 8/10 is a property of the sample, and it is worth stating precisely because the
number a reader meets first is the smaller one.** `filesForLanguage` takes a stride of
`floor(6063/120) = 50` over the repo-by-repo concatenation, so the 120 files contain
roughly 30 from `nimony` — and every one of the 47 `implements` edges lives in
`nimony`'s concept test suite, in one directory a 1-in-50 stride does not land in.
`overrides` is receiver-qualified `Receiver.method`, and the 67 edges sit in a
handful of `nim/lib/pure` modules that the same stride skips. **Nothing about the
analyzer changed between the two rows**; only how many files were walked. A lane
verdict read off a 120-file stride would have recorded two of this language's ten
types as non-firing, and both would have been wrong.

**At full corpus every one of `firing-check`'s ten per-type counts matches this lane's
own census to the digit** — `calls` 118,261, `uses` 45,664, `contains` 29,362,
`imports` 13,364, `references` 56,445, `exports` 617, `extends` 627, `implements` 47,
`overrides` 67, `instantiates` 2,843, total **267,297**, symbols **110,076**. Three
instruments that share no counting code — this lane's census, its re-run, and the
supervisor's arbiter — now agree on 267,297 and on 110,076. Artifacts
`session3-1w-census.{txt,json}`, `session3-firingcheck-full.{txt,json}`.

**Three defects in that shared script, measured and reported rather than fixed (§8).**

1. **The per-type `files` column is structurally always 1.** `filesByType` is declared
   at line 334 *inside* the per-file loop, and line 380 — which is inside the same
   loop, which closes at 381 — does `res.types[type].files = set.size`. The set holds
   only the current file, so `set.size` is 1 and it overwrites the running total on
   every iteration. Measured: all ten types report `files: 1` over 6,063 files. Fix:
   hoist `filesByType` to per-language scope beside `res`, and move line 380 to after
   the loop closes at 381.
2. **`analyzerDigest` cannot find any analyzer, for any language, ever.** Line 216
   builds `path.join(here, "..", "ast", …)` where `here` is the script's own directory,
   `script/m14` — so it resolves to `script/ast/real-nim-analyzer.ts`. The analyzers
   live at `src/ast/`. `script/ast` does not exist, so the function returns
   `MISSING:<path>` for every lane, in-tree. It needs `"..", "..", "src", "ast"`.
   The consequence is worse than the missing digest: line 415 sets
   `analyzerStableDuringRun = digestBefore === digestAfter`, and two identical
   `MISSING:` strings compare equal, so the instrument reports `analyzerStableDuringRun:
   true` **having read no analyzer bytes**. The run in `session3-firingcheck-full.json`
   carries that `true`, and this document does not rely on it: every digest claim here
   comes from this lane's own instruments, which hash the analyzer on both sides of
   the walk and print the verdict. This is the defect commit `614b318e6`
   (*tie every firing number to an analyzer content hash*) claimed to fix.
3. **`bothEndsResolveRate` is never computed or emitted.** The file's own header
   (lines 30–32) promises the rate is "Reported as a count and a rate, because zig
   measured 759 edges whose source bound to a non-callable symbol while its census
   read 'dangling 0.00%'". The count is emitted; the rate is absent from the artifact
   for every type, so a consumer must divide by hand and cannot compare rates across
   lanes without recomputing them.

A fourth column differs by **definition**, not by defect, and is recorded so the two
numbers are not diffed as a disagreement: `unknownEndpoints` reads **1** where this
lane's census reads **8**. `firing-check` increments it only when *neither* end is
published (`!published.has(src) && !published.has(tgt)`); the census counts any
endpoint equal to the literal `unknown`. The stricter reading is the more useful one,
and this lane adopts it.

**`incoming-check` — the direction the reverse walk actually needs.** Run from the
same base-branch copy on 6 real corpus files spanning 4 repositories
(`nim/lib/pure/logging.nim`, `nim/lib/pure/unittest.nim`, `nimony/lib/std/math.nim`,
`nimony/lib/std/tables.nim`, `dom96-jester/jester.nim`, `Aporia/autocomplete.nim`):
**524 symbols, 0 degraded, 0 parse failures, and all ten types fire inbound** —
`calls` 683, `references` 255, `uses` 289, `contains` 112, `imports` 61,
`instantiates` 8, `exports` 9, `overrides` 14, `extends` 5, `implements` 4. **277**
distinct declarations are named by at least one edge; **184 of 524** are named by none,
which for independent modules is the expected shape rather than a defect.
Unresolved: `calls` 342, `references` 125, `imports` 59, `exports` 9, `implements` 1.

**A second instrument reads the same numbers on a 27x larger index.** The lane's own
`incoming-audit.ts lib/pure` (105 files, 6,912 symbols) and the supervisor's
`script/m14/incoming-check.ts nim <the same 105 files>` were written separately and
share no counting code; session 7 ran both and they agree **on every cell of every
row** — `calls` 10,196 / 1,776 distinct / 1,202 ambiguous / 2,985 unresolved; `uses`
5,054 / 1,399 / 823 / 11; `contains` 1,647 / 1,317 / 289 / 1; `references` 3,393 / 327
/ 219 / 681; `exports` 112 / 42 / 3 / 69; `extends` 43 / 12 / 1 / 21; `overrides` 14 /
7 / 0 / 0; `instantiates` 110 / 103 / 14 / 0; and 3,386 distinct targets named with
**1,555 orphans of 6,912 = 22.50%** (`session7-incoming-check-lib-pure.txt`). Two
instruments, zero disagreement. On this index `incoming-check` counts **184** distinct
target names resolving to more than one published symbol — `year`, `name`, `max`,
`len`, `isSorted`, `a`, `i`, `fut` and 176 more — against **10** on the 6-file index
above, so the ambiguity figure scales with the index and *Limitations* 19 (it discards
the file, so it counts cross-file collisions the reverse walk separates) is the reason
those 184 are not a defect count.

**The deliverable-B ambiguity, named per name rather than counted.** **10** target
names on those 6 files resolve to more than one published symbol: `log` →
method, macro, function; `colorOutput` → property, function; `testEnded` → method,
function; `c_fpNormal`, `c_fpSubnormal`, `c_fpZero`, `c_fpNan` → constant, variable.
Each is one edge the reverse walk attributes to one declaration by a rule nobody
chose. `ambiguity-split.ts` measures how much of the lane's ambiguity an edge can
resolve from its own file, and both recorded subtrees reproduce to the digit:
`nim/compiler` **270 of 50,094 edges = 0.5%** irreducible, `nim/lib/pure` **756 of
21,235 = 3.6%** (`session3-ambiguity-{compiler,lib-pure}.{txt,json}`). The residue is
Nim's own: a `const` and a `var` of the same name in one scope, or an overloaded UFCS
prologue, are two declarations and one name, and no per-file rule separates them. The
most frequent same-file ambiguous names are `config` (62), `emptyNode` (28), `c` (23),
`map` (16), `name` (15).

**Deliverable C and D, from `resolution-audit` at 1 worker: 110,076 symbols published,
54,695 distinct names, and a TREE-ONLY total of 126 edges.** TREE-ONLY is the defect
column — the target *is* declared on a corpus parse tree and no symbol with that name
was published anywhere. It is `calls` 19 + `uses` 77 + `contains` 30, and **every other
type is 0**. As a share of the walk that is **126 of 267,297 edges = 0.047%**. The
distinction deliverable C asks for is visible per type: `references` and `exports` have
**zero** TREE-ONLY, and their unresolved mass is `nowhere` (declared on no corpus tree
at all — external, 1.8% and 24.6%) plus cross-file, which a whole-project index
resolves. `imports` is 87.5% module-resolvable with 0 TREE-ONLY. On the `compiler`
subtree the same split reads 654 names / 3,757 edges outside the index universe
against 134 names / 619 edges on no corpus tree at all.

**Callable declaration recall is 46,960 of 46,971 = 100.0%** of the declarations on
the parse tree that the run published a symbol for, and the 11 unpublished names are
`destructor`, `root`, `me`, `super`, `_` — compiler-synthesised names that are not
user declarations and are the expected residue.

**The reproducibility figure is sharper than the pass above states, and the sharpening
is the finding.** The pass above concluded this lane's counts are "reproducible to about
a tenth of a percent at a stated worker count, and not to the digit", on the evidence
of two runs that differed in fan-out. This pass ran `census.ts` a third time at
`BB_NIM_WORKERS=1` and it returned **267,297 edges and 110,076 symbols with all ten
per-type counts identical to session 2's 1-worker walk** — not approximately, to the
digit. So the spread is not a property of the analyzer at all: **at 1 worker this
instrument is exact, and the 0.004% figure is entirely the difference between 1 worker
and 2.** Two walks is a small base for a claim of exactness and this document does not
generalise from it to other worker counts, which were not re-walked; what it does
establish is that the residual attributed to "the production path is non-deterministic"
in *Limitations* 11 is a fan-out effect, and at the fan-out this lane's artifacts were
taken at, the numbers are stable.

**`incoming-check.ts` on this branch is stale and would misreport this lane.** The copy
in `analyzer/NIM` still keys its label table on `brain_import` (line 69), which is the
value `src/ast/types.ts` gives `RelationshipType.Imports` while `src/ast/engine.ts`
gives the same member `imports`. Analyzers import the enum from `engine`, so a
relationship row carries `imports`, so **the instrument on this branch would report nim
`imports` as 0 while the analyzer emits 13,364 of them.** The base branch has already
fixed this (it accepts both spellings); this branch predates that commit by 205 and
needs the merge, not a lane edit. §8.

**The two contract obligations that are not about edge counts, re-checked.** The NO
REGEX obligation: `script/m12/verify-regex-census.ts` **exits 1** — 26 MISSING, 25
STALE — and the string `nim` appears **zero times** in its entire output; the entries
belong to css, julia, clean, fsharp, javascript, python, svelte and typescript. The
committed census records 26 regex usages across 7 files and 43 analyzers scanned, and
`real-nim-analyzer.ts` is not one of the 7. DERIVATION debt: **0**, re-confirmed — all
ten types have a `push("<type>")` derivation site in `script/m14/nim-truth-oracle.ts`,
while `grep -c "nim-truth-oracle\|deriveNimEdges" script/m14/differential.ts` still
returns **0**, so the shared gate remains silent on this lane for the reason §8
already records.

**The oracle cross-check reproduces, disagreement included.** 400 of 6,063 files
(deterministic every-15th), 0 parse failures, 0 oracle throws, **MISSING 3 /
UNEXPLAINED 26**, 7 of 10 labels with identical counts — the same figures as session 2.
The 26 unexplained are Nim forms the oracle does not derive and this document names:
compiler-injected `=destroy` / `=copy` / `=sink` / `=dispose`, the `ctype getClass`
form, `get procName` / `set procName` accessor pairs, and `$`. The 3 missing are
`references` → `U`, `Foo` and `T` in two test files.

**The two shared gates, run for the record, and one trap in the interface.**
`npx tsx script/m14/ontology-coverage-gate.ts nim` **exits 2** — `corpus: 6063
admitted files`, one `[BB-PARSE-ERR]` memory-access-out-of-bounds on
`nim/tests/overload/tproc_types_dont_like_subtypes.nim` (*Limitations* 8, in shared
`engine.ts`), then `no RULING TABLE for nim` and a refusal to report. That is the §8
registration gap, not a lane failure, and it is unchanged from the pass above.
**`script/m14/mutate-analyzer.ts` takes no language argument at all** — there is no
argv filter anywhere in it, so `mutate-analyzer.ts nim` silently performs a full sweep
of every lane and its exit code belongs to every lane rather than to the one named. A
lane that reads a non-zero exit from that invocation as its own would be wrong, and
this is recorded so the next one does not. Measured from the full sweep
(`session3-mutate-analyzer-shared.txt`): **nim 60 mutants, 60 CAUGHT, 0 survived**,
reproducing the recorded figure; across all lanes 1,740 caught and 9 surviving, the 9
belonging to groovy (2), html (3), java, make, php and scala.

**The honesty gate, and which of its findings are this lane's.** `script/m14/
verify-honesty.ts` exits 6. The **banned-vocabulary lint over `validation/m14` + M14
docs passes** with this section's text in place. The 22 failures are evidence-freshness
(`M14.0.F1`–`F9`: declared inputs changed since their recorded commits, 64 to 2,237
inputs each, because the base branch moved 205 commits) plus fixture files belonging to
c, clean, csharp, html, sql and fsharp. **Zero name nim.** The gate also reports its own
defect in the same run — *freshness rule flags every artifact — it cannot distinguish
current from stale*, with `evidence freshness: 0 artifact(s) current against their
declared inputs* — which is §8 and not a lane edit.

#### Session-4 re-verification, 2026-10-04: the arbiter registration landed, and the walk reproduced

Two passes produced this document before it and neither had written its report, so
this pass was spent on the two questions a reader actually has about a completed
lane: does the number still come out, and is the §8 item that was blocking the
arbiter still open. Both have answers and one of them changed.

**The walk reproduces to the digit.** A fourth full census, 1 worker, 6,063 files,
all 8 repositories, production `parseFile`, analyzer sha256 `9d9ee478e3295c28`
verified before the walk and unchanged after
(`validation/m14/measurements/nim/session4-1w-census.{json,txt}`):

| | session 4, 1 worker | the `ontology-census` figure the table above carries (6 workers) | delta |
| --- | --- | --- | --- |
| symbols | **110,076** | 110,060 | +16 |
| `calls` | **118,261** | 118,261 | 0 |
| `uses` | **45,664** | 45,662 | +2 |
| `contains` | **29,362** | 29,361 | +1 |
| `imports` | **13,364** | 13,364 | 0 |
| `references` | **56,445** | 56,438 | +7 |
| `exports` | **617** | 617 | 0 |
| `extends` | **627** | 627 | 0 |
| `implements` | **47** | 47 | 0 |
| `overrides` | **67** | 67 | 0 |
| `instantiates` | **2,843** | 2,843 | 0 |
| **total edges** | **267,297** | 267,287 | +10 |

Seven of the ten types are byte-identical across the two worker counts and the
whole movement is `uses` +2, `contains` +1, `references` +7, `symbols` +16. That is
the production path's concurrency nondeterminism (*Limitations* 11) and not an
analyzer change: **the two walks ran on the same blob**, which is the check that
makes the spread interpretable. Symbol hygiene on this walk: **0** empty names,
**0** empty kinds, **0** throws, 6,063 of 6,063 parsed, 8 endpoints equal to the
literal `unknown` (*Limitations* 9), 0 edge types outside the ten — and no
`SymbolKind` outside the engine's vocabulary, so no unknown kind is being
published as if it were a classification.

**The §8 registration gap is CLOSED, and it is closed upstream.** The base's
`script/m14/nim-ruled.ts` is byte-identical to this branch's (sha256
`0170f0804baec6fa`), and `analyzers/ontology-laptop-b`'s
`ontology-coverage-gate.ts` now carries `import { NIM_RULED } from "./nim-ruled"`
at line 66 with `nim: NIM_RULED` in `RULED_BY_LANG` at line 223. Measured
consequence, through the proof runner that patches exactly those two lines into a
`/tmp` copy: **`emitted 10/10   ruled-sound 0   FALSIFIED 0
ruled-without-justification 0`, exit code 0** over all 6,063 admitted files
(`session4-ruled-gate.txt`). The base's `src/ast/real-nim-analyzer.ts` is
byte-identical to this branch's as well — the same `9d9ee478e3295c28` — so every
digest-pinned number here is pinned to the blob the base actually carries.

**Which of the three open §8 items remain open, re-checked against the base
rather than against this branch.** Only the arbiter registration landed:

| §8 item | file | status at `analyzers/ontology-laptop-b` |
| --- | --- | --- |
| register `NIM_RULED` in `RULED_BY_LANG` | `script/m14/ontology-coverage-gate.ts` | **LANDED** — line 66 import, line 223 map key |
| add `nim` to `LANG_REPOS` | `script/m14/differential.ts` | **still open** — `grep -nE '^\s+nim: "'` returns nothing |
| wire `deriveNimEdges` into the differential | `script/m14/differential.ts` | **still open** — `nim-truth-oracle`/`NIM_ORACLE` return nothing |
| add `nimble` to the swept extension list | `script/m14/differential.ts` | **still open** — `ext: "nim,nims"` while `src/ast/language-detection.ts:53` routes `nimble`. **Now costed in edges, not just files** (*Session 5*): 166 files, 11 symbols, **283 edges** — `calls` 273, `imports` 9, `uses` 1, and **zero** of the other seven types. An omitted extension can only move a verdict by taking a type from non-zero to zero, seven of the ten cannot be touched at all, and the three that can are the three highest-volume types in the language — so this cannot flip any of the ten verdicts. The one-line fix is `ext: "nim,nims,nimble"` |

Two further §8 items, both in `script/m14/firing-check.ts`, both found by running the
arbiter at full corpus rather than by reading it, and both stated with the fix spelled
out in `validation/m14/measurements/nim/session5-firing-check-defects.txt`:

| §8 item | file | status | the one-line fix |
| --- | --- | --- | --- |
| `analyzerDigest` resolves to `script/ast/`, which does not exist | `script/m14/firing-check.ts:216` | **open, fleet-wide** — `MISSING` and `stable=true` on all three lanes measured (nim, lua, toml), so `analyzerStableDuringRun` compares `MISSING` to `MISSING` | `path.join(here, "..", "..", "src", "ast", …)`; and consider failing the run on a MISSING digest rather than reporting it stable |
| `types[t].files` is the last file's count, not the union | `script/m14/firing-check.ts:334` + `:380` | **open, every lane** — all ten nim types read `files: 1`, including `calls` at 118,261 edges over 6,063 files | hoist the `filesByType` declaration above the per-file loop at 289 and move the aggregation below its close at 381 |

Neither touches edges, symbols, source direction or both-ends resolution, so the
arbiter's `10/10 fired, 267,297 edges, 6,063 files` for this lane stands and is
reproduced independently. The first one matters beyond this lane: it means **no lane's**
firing number is currently pinned to an analyzer state, and a digest that cannot be
computed is not evidence that nothing changed.

The consequence of the last three being open is re-measured and is a fact about
this lane's visibility rather than about its correctness: `--lang nim` still
prints `[lane] SKIP nim: no corpus repo mapped in LANG_REPOS and none checked
out — declared unrun, not measured` and measures 0 lanes
(`session4-differential.txt`). nim IS registered for parsing — `LANGS` line
25,174 carries the right `analyzerFile` and `className` — so the lane is
registered for parsing and unregistered for corpus, and those two halves disagree.
The DERIVATION arithmetic in the section above is unchanged by any of it: 0 by
this lane's oracle, 6 by a gate that reads the differential's language-agnostic
default audited list and never opens `nim-truth-oracle.ts`.

**The gates, re-run at HEAD.** Two fail and **neither failure names nim**:

| gate | exit | what it said about this lane |
| --- | --- | --- |
| `ontology-coverage-gate.ts nim` | 2 | `no RULING TABLE for nim` — this branch's copy predates the base's registration. The BASE's copy cannot be run in place either: it imports `./fsharp-ruled`, which also post-dates this fork. The verdict below comes from `ruled-gate.ts`, which applies the supervisor's two-line wiring to a copy in `/tmp` and runs the copy |
| `ruled-gate.ts` (the arbiter, with the wiring applied) | **0** | **`emitted 10/10  ruled-sound 0  FALSIFIED 0  ruled-without-justification 0`**, 6,063 admitted files, 379 s, analyzer digest `9d9ee478e3295c28` unchanged on both sides of the walk |
| `firing-check.ts --files 100000 nim` (the arbiter) | **0** | **`10/10 fired, 267,297 edges, 6,063/6,063 files`**, 0 parse failures, 0 degraded fallbacks, 0 empty names, 0 empty kinds. Two of its output fields are broken — *Session 5* |
| `firing-check.ts --files 120 nim` (its own default) | **0** | **`8/10 fired, 4,247 edges, 120/120`** — reproduces session 3 exactly. `implements` and `overrides` do not fire in a stride sample, for two different and separately documented reasons |
| `verify-regex-census.ts` | 1 | **27 findings, `grep -in nim` over the whole output returns nothing.** css 5, julia 5, clean 1, fsharp 4, javascript 2, python 1, svelte 4, typescript 1 |
| `verify-honesty.ts` | 6 | 22 failures, zero naming nim; banned-vocabulary lint over `validation/m14` + M14 docs **passes**. Re-run after this pass's doc edits: still exit 6, still **0** lines matching `nim` |
| `run-fixtures.ts --lang nim` | 0 | `{"nim":{"pass":10,"fail":0}}`, scoped run wrote no evidence and refused `--update-baseline`. The **unscoped** form exits 6 at `2 fixture director(ies) no runner lane claims: r, lua` and never reaches nim — a repo-wide condition belonging to other lanes, recorded so it is not mistaken for this lane's |
| `verify-mutants.ts` (lane's own) | 0 | 17 declared nim mutants run, **17 CAUGHT, 0 survived** |
| `verify-analyzer-hygiene-nim.ts` (lane's own substitute) | 0 | 0 findings on HEAD, and the reverted copy **is caught** by `bare-node-identity-comparison`, so the green is not vacuous |
| `differential.ts --lang nim --sample 60` | 0 | `[lane] SKIP nim` — the §8 item above, declared unrun rather than measured |
| `verify-analyzer-docs.ts` | 0 | nim is **absent** from the 13-lane missing-sections list, so all required sections are present |
| `verify-grammar-pins.ts` | 3 | the `nim` pin holds — `421369fe6a88`, 5,797,624 B, `ids=377 named=127 anon=205 fields=24`, 19 files vendored. All four `PIN FAILURE` lines are julia's |

The 17 here and the 60 in `session3-mutate-analyzer-shared.txt` are not in
conflict and the difference is worth stating rather than reconciling away: 17 is
what `script/m14/nim-mutants.ts` **declares** and the lane's `verify-mutants.ts`
runs; 60 is what the shared `mutate-analyzer.ts` full sweep attributes to nim,
the extra 43 being the harness's own generated kind-misclassification and
symbol-drop mutants. Both report 0 survived.

## Differential ground truth

Three separate instruments, because the shared one cannot run this lane and the
other two answer different questions.

**1. The shared differential cannot run it at all.** `$ npx tsx
script/m14/differential.ts --lang nim` prints `[lane] SKIP nim: no corpus repo
mapped in LANG_REPOS and none checked out` and `probe run (--lang nim): measured
0 lane(s)`. Two independent causes, both §8, both reported with the change needed
(*Limitations* 18): `LANG_REPOS` (`script/m14/differential.ts:393`) has no `nim`
key, and the file imports no nim oracle — `grep -c "nim-truth-oracle\|deriveNimEdges"
script/m14/differential.ts` returns **0**. So the arbiter of the six questions is
silent here and every question-3 number below comes from instrument 2.

**2. This lane's own oracle — the real second opinion.**
`script/m14/nim-truth-oracle.ts` derives edges from the **parse tree** by
`deriveNimEdges`, reading node types and fields, and
`validation/m14/fixtures/nim/oracle-crosscheck.ts` runs both sides through
production `parseFile` on the same file and compares site-agnostically (label +
normalized target). Both sides print `sha256` before and after the walk.

| | pinned run |
| --- | --- |
| sample | 400 of **6,063** discovered files, deterministic every-15th, 400 parsed, 0 parse failures, 0 oracle throws |
| derivations | **all ten types** — `exports` and `implements` added 2026-10-04, both tree walks |
| exact agreement | `imports` 382/382, `references` 694/694, `extends` 22/22, `overrides` 1/1, `instantiates` 134/134, `exports` 12/12, `implements` 3/3 — **7 of 10** |
| MISSING | **3**, all `references` (`nim/tests/template/taliassyntax.nim -> U`), the recorded `BlenderRgb[Rgba8]`-class ambiguity |
| UNEXPLAINED | **26** = `calls` 15, `contains` 10, `uses` 1 — accent-quoted operator targets the production filter deletes, destructor/hook operators (`=destroy` ×5, `=copy`, `=dispose`, `=sink`), and two names that really are declared in Nim (`contains -> $`, `uses -> type`) |

**The limit, stated because it is real: both sides walk the same grammar.** A
grammar fact both derivations get wrong is invisible to this instrument. It shows
that two independent walkers agree, never that an edge is true. And the
arrangement has some shared inputs on purpose — the analyzer's builtin-name
filter, and its symbol list as the name inventory for `contains` — because
ownership assignment is not what a differential audits and a second place to be
wrong helps nobody (*Limitations* 4). The two derivations added this pass are NOT
among the shared inputs: `deriveConceptRefinement` and `deriveExports` read
`concept_declaration.refines` and `export_statement`'s operand list off the tree
and touch no analyzer metadata.

**This instrument had to be able to disagree, and it did — twice, on this lane's
own new code.** The first `deriveConceptRefinement` scraped every identifier under
a refinement list and published `Bar implements T` for `Bar = concept of Foo[T]`,
reading the type argument as the type. The cross-check reported it as 1
unexplained `implements` in the same round the code was written. The rule is now
one name per `type_expression`, taken from the node's shape. Recorded because an
oracle written to agree with the analyzer is not an oracle, and because the second
of the two additions (`exports`) was written *after* that lesson and agreed on the
first run — which is the only evidence that the lesson was absorbed rather than
noted.

**One more limit, and it is a sampling limit rather than a derivation limit.** The
400-file sample is drawn every-15th from `readdirSync` order, so it is
reproducible from the corpus but it is not uniform over the tree: it reaches
`nimony` (3 files of the 400 carry `implements` edges) only because the corpus is
larger. The census's `implements` row is 47 edges over 24 files; the cross-check
sees 3. **A sample can confirm a family and cannot size it**, which is why the
47 is quoted from the census and the 3 from the cross-check, and never mixed.

**3. The M12 ground truth, which is what gates the cross-file override family.**
`validation/m12/ground-truth/nim.json` asserts
`overrides:GlossPainter.paint -> Painter.paint` across `painter.nim` and
`gloss.nim`. No single-file fixture can express it, because the base type and the
method it declares live in different modules by definition, so this family is
gated by the cross-file ground truth rather than by `validation/m14/fixtures/nim/`.
A mutant for it was written and deliberately **removed**: the mutation gate
requires a mutant to turn the fixture suite red, the fixture runner passes no
context, so the mutant was vacuous by construction and would have held the gate red
forever over a genuinely covered family. The fixture-visible half of the same
mechanism — a method declaring its `ownerName` — is gated normally, as
`nim/method-owner-name-dropped`.

## Regex inventory

Zero. The analyzer contains no `RegExp`, no `.match(`, `.replace(`, `.test(`, no
`.split(/…/)` and no regex literal. Every decision is made on node types and
fields, which is what makes the compiler matrix and the 4,555-file census
comparable across grammar versions. The shared gate confirms it from the other
side: `npx tsx script/m12/verify-regex-census.ts` FAILS repo-wide, and **0 of its
51 rows are this lane's** — 26 MISSING and 25 STALE, in `css`, `julia`, `clean`,
`fsharp`, `javascript`, `python`, `svelte` and `typescript`. There is no nim row
to fix because there is no nim regex.

## Verification evidence

- **Corpus** (`script/m12/nim-corpus-errors.ts`, `validation/m12/results/nim-corpus-errors.json`):
  **13 corpora DECLARED, 3 MEASURED**, 5,521 tracked files, 103,228 symbols,
  244,477 relationships, **0 crashes**, 64 error files (1.159%), 238 error nodes.
  Measured: `nim` 3,968 files / 48 error files, `nimony` 1,508 / 16, `nimterop`
  45 / 0. (This is the production pool-worker route; the complexity artifact
  below is a different path over a different file set, and the table there
  reconciles the two rather than conflating them.)

  **This bullet previously read "12 repos, 5,227 tracked files, 91,011 symbols,
  202,256 relationships, 50 error files (0.957%)", and that claim was not
  reproducible from a clean corpus on this machine — 9 of those 12 repositories
  are not on disk.** The script records an absent corpus honestly per row
  (`revision: "ABSENT"`, zero files), so the truth was in the artifact the whole
  time; what was wrong was the SUMMARY, which carried `corpora: 12` and no
  present/absent split, and a document that read the summary rather than the rows.
  Measured: `nimble`, `arraymancer`, `prologue`, `pixie`, `nitter`, `nigui`,
  `jester`, `nimtest`, `torrentinim` and `mosdepth` are all absent from
  `$HOME/fixtures/repositories`. The totals block now carries
  `corporaDeclared`, `corporaMeasured` and `corporaAbsent[]` beside the old
  `corpora` field, and the console line prints
  `corpora=13 declared, 3 measured (absent: …)`. **A declared corpus list is a
  wish; only the measured count is evidence, and a summary that cannot tell them
  apart will be quoted as if it could.**

  An error *rate* is not a defect count, so the 64 are separated by construction
  rather than averaged: **59 are compiler test files, which are invalid on
  purpose** — 45 under `nim/tests/` and `nim/nimsuggest/tests/` (a lexer test
  with an unterminated raw string, an error-message test with a bare `a:`, a
  parser test asserting that `elif:` without a condition is rejected) and 14 under
  `nimony/tests/`. They are a corpus-selector fact, not grammar defects.
  **5 are shipping code that fails to parse**, and those are the real gap list:
  `nim/compiler/vtables.nim` (nested bracket generics),
  `nim/compiler/semobjconstr.nim` (single-line inline `if`),
  `nim/lib/std/private/osappdirs.nim` (`$` inside a string literal), and — new
  with `nimony` — **`nimony/lib/std/opt.nim` and `nimony/lib/std/result.nim`**,
  2 error nodes each.
- **Damage census** (`grammars/_vendored/nim/damage-classes.txt`,
  `grammars/_vendored/nim/damage-census.txt`): 131 error sites over the 50 files,
  classified by the parent node chain and the offending construct — not by
  matching source text for meaning. The classes that hit real code:

  | Class | Sites | Example |
  | --- | --- | --- |
  | multi-line leading-dot method chain | 8 | `torrentinim/src/crawlers/leetx.nim:58` — `x.a[0]` then `.innerText` on the next line |
  | nested bracket generics | 2 | `nim/compiler/vtables.nim:122` — `initTable[ItemId, seq[PSym]]()`, a `[…]` inside a `[…]` index |
  | single-line inline `if` | 1 | `nim/compiler/semobjconstr.nim:552` — `if hasError: result = errorNode(c, result)` |
  | `$` inside a string literal | 7 | `nim/lib/std/private/osappdirs.nim:28` — `{.rtl, extern: "nos$1"}`, the compile-time concat marker |
  | command-style call with a multi-line argument | 1 file, cascading | `nim/compiler/vtables.nim:119` — `g.addDispatchers genIfDispatcher(g, g.methods[bucket].methods, r…` |
  | do-pragma `expr.#[…].#` | 16 files | `y.#[!]#` — consumed as a block comment |
  | qualified type in a declaration | 2 | `mypackage.Foo = object` |
  | pragma on a generic parameter | 7 | `MyPtr[out T] {.importcpp: "'0 *"}` |
  | `func(…)` as a type | 1 | `fn: func(a: int): int` |
  | empty tuple `(;)` as a default | 1 | `alt: untyped = (;)` |
  | tuple construction from a bare ident | 1 | `proc foo = (if)` |
  | `not nil` / sum-type narrowing (**new with `nimony`**) | 12 files, 44 nodes | `nimony/lib/std/opt.nim:2` and `nimony/lib/std/result.nim:2` are **shipping stdlib**; the same shape accounts for 10 more under `nimony/tests/nimony/object/tsumtype*.nim` |

  Each is a grammar gap, and each is a **recorded** gap rather than a patched
  one, for the reason in *Honest limitations* item 1.
- **Differential — the oracle is present, the LIVE harness cannot run it, and the
  prior claim below is no longer reproducible.** This record used to read
  "`script/m14/nim-truth-oracle.ts` + the `nim` lane of
  `script/m14/differential.ts` … `nim@60` 941/941 covered … `pixie@60` 3,220/3,220".
  As of 2026-10-02 that is **not** what the harness does:

  ```
  $ npx tsx script/m14/differential.ts --lang nim
  [lane] SKIP nim: no corpus repo mapped in LANG_REPOS and none checked out
    — declared unrun, not measured
  probe run (--lang nim): measured 0 lane(s) — M14.0.F5 NOT written
  ```

  Three facts, each checkable: `LANG_REPOS`
  (`script/m14/differential.ts:393`) has **no `nim` key**; the file contains
  **no import** of `deriveNimEdges` (the only importer is the mirror at
  `script/m14/tmp/oracle-mirror/differential.ts`); and the second corpus,
  `pixie`, **is no longer in the corpus directory**. The oracle module itself is
  intact — 909 lines, 8 labels. So the coverage numbers quoted above are a
  historical record of a wiring that is no longer present, and the live,
  reproducible oracle evidence for this lane is now the cross-check in *The ten
  relationship types* above: 400 files, 8 labels compared, 1 miss, 14
  unexplained, both named. Fixing the wiring is a shared-machinery change
  (`differential.ts` is supervisor-owned) and is reported, not applied.
- **Non-vacuity is measured, not assumed.** The cross-check prints an
  `adjudicated?` column per label, so a label cannot read as "covered" because
  the oracle happened to draw none of it — `exports` and `implements` both report
  what the oracle derives, which is nothing, and that is why `exports` is
  recorded as a DERIVATION finding rather than as agreement.
- **Fixtures** (`bun run script/m14/run-fixtures.ts --lang nim`, re-measured
  this pass): **10 pass, 0 fail** — `concept`, `contract`, `extbase`,
  `extderived`, `extmod`, `helpers`, `mac`, `negative`, `nested`, `reexport`.
  `concept` pins both refinement spellings (6 edges, 6 forbids) and `reexport`
  pins all six `export` spellings (7 expect rows, 9 forbid rows across two
  carriers).
- **Mutants** (`npx tsx validation/m14/fixtures/nim/verify-mutants.ts`,
  re-measured this pass): **14 run, 14 caught, 0 survived** — including
  `nim/concept-refinement-labelled-extends` (0 → 7 problems, the `implements` /
  `extends` confusion named in question 4), `nim/concept-satisfaction-invented`
  (the fabrication the workstream forbids, caught), and
  `nim/star-marker-promoted-to-an-exports-edge` (0 → 1, the `exports` /
  `contains` confusion).
- **This pass's artifacts**, all committed, all re-runnable, all carrying the
  analyzer digest on both sides of their walk:
  `validation/m14/measurements/nim/ontology-census.{json,txt}` (the per-type
  table, the SymbolKind census, the Instrument-A inventory and the Instrument-B
  construct counts over 4,555 files),
  `validation/m14/measurements/nim/resolution-audit.{json,txt}` (the five-bucket
  resolution split and the declaration-recall defect list),
  `validation/m14/measurements/nim/ruling-probe.{json,txt}` (the `implements`
  measurement, including the guard funnel and the text probe classified as a
  non-instrument),
  `validation/m14/measurements/nim/ruled-gate-run.txt` (the arbiter's own verdict
  table over the same corpus, from a patched copy in `/tmp`, on the committed
  blob) and `ruled-gate-run-2.txt` (the same instrument on the previous blob, kept
  because it is one arm of the defect-5 A/B and one of the five walks the spread
  table is computed from),
  `validation/m14/measurements/nim/node-identity-ab.txt` (all three arms of the
  defect-5 A/B: the reachability probe, the two-blob census, and the hygiene
  check's own output), and
  `validation/m14/measurements/nim/{gap-hunt,accent-quoted-endpoints,oracle-crosscheck,ambiguity-compiler,ambiguity-lib-pure}.{json,txt}`
  (the extends accounting, the operator-endpoint inventory, the oracle
  cross-check, and the two ambiguity subtrees).
- **`script/m14/nim-ruled.ts` is wired into no harness at HEAD.**
  `validation/m14/fixtures/nim/ruled-gate.ts` is the proof: it applies the
  supervisor's two-line change to a COPY of the shared gate, runs it, and prints
  the verdict plus the probe's counters from the process that produced them. The
  shared file is untouched and the two lines are, verbatim:

  ```
  import { NIM_RULED } from "./nim-ruled"
  const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED, nim: NIM_RULED }
  ``` Every fixture source is
  accepted by the Nim 2.2.12 compiler, so a passing expectation is never
  validating behaviour the language rejects.
- **Index seam** (`script/m14/verify-nim-pipeline-e2e.ts`): 15/15 checks through
  the production store — 22 symbols, 31 relationships, imports and docstrings
  persisted, calls/contains/references/instantiates/extends/overrides present,
  4 cross-file calls resolved, 0 non-import relationships with an unresolvable
  target, 0 relationships with an out-of-range line, and no file skipped.
- **Line and range honesty**: an audit over 27 Pixie files found 5,292/5,292
  relationships carrying a `line_number` and 0 bad symbol ranges. The 17 residual
  line findings are audit-harness false positives (slash-separated module lists
  resolved by whole path rather than last segment), and `range` as a property
  name is legal Nim, not a phantom symbol.
- **Grammar pin** (`bun run script/m14/verify-grammar-pins.ts`): 10 lanes match
  their record, including the NIM source<->wasm proof and the 72/72 conformance
  suite.
- **M12 hand-audit ground truth** (`script/m12/verify-analyzer.ts nim`,
  `validation/m12/ground-truth/nim.json`): **precision 1.000, recall 1.000** over
  106 facts on 4 compiler-validated fixtures. Every fact's `evidence` field cites
  the construct it asserts, so the audit can catch the analyzer rather than
  confirm it — and on the first run it did, three times over:
  - it **asserted** `calls exercise -> describe` for `r.describe`, a *parenless
    UFCS call*, which the analyzer did not emit at all. Verified in a minimal
    repro, fixed, and the differential oracle turned out to omit it too — so the
    lane had been reporting 0% unexplained on a shape both implementations got
    wrong in the same direction. That is the one failure mode an oracle that
    mirrors the analyzer structurally cannot catch, and it is what the
    independent audit is for.
  - it **asserted** `uses (global) -> x` was absent, because `type Addable =
    concept x` writes a concept's formal parameter with no `symbol_declaration`
    and no type annotation — the one binder in Nim that nothing else recognises.
    A concept is now a scope frame, so its body reads attribute to the concept
    and its parameters shadow.
  - it **missed** `calls exercise -> build`, which the analyzer emitted: `b.build`
    is as much a parenless call as `r.describe` is. Recall is the hard
    direction, so the audit absorbed the analyzer's row rather than the other way
    round.
  - it **asserted** two rows the analyzer had deliberately refused —
    `extends`/`references` to `RootObj`, one of the four `NIM_COMPILER_ROOTS`
    that no analyzed file declares, where an edge could never resolve. The
    analyzer's refusal is the better judgement and the audit adopts it; that
    reversal is recorded in the ground truth's `auditNote` rather than left
    implicit.
  - it also **corrected a fixture line**: the first `shared.nim` read
    `export proc helper*(x: int)`, which the Nim 2.2.12 compiler rejects with 9
    errors and which appears 0 times across all 12 corpora. The grammar's ERROR
    node and the compiler agreed; the fixture was wrong.
  Both new fixes carry a mutant (`nim/parenless-ufcs-call-lost`,
  `nim/concept-parameter-read`), so the gate is 42/42 rather than trusting a
  green suite.
- **Full-corpus oracle sweep** (the standing tool this lane needs): the
  differential's 60-file rotation reported 0 unexplained on nearly every draw,
  which is a COVERAGE limit, not a clean bill — two defect classes hid in files
  the rotation simply did not sample. Running the oracle over all 3,914 tracked
  `.nim` files of the Nim compiler (`fixtures/nim/probes/hunt-diff.ts`, per-file
  truth-vs-analyzer target sets) found them immediately, and both are now fixed:
  a `{.all.}` qualifier being published inside the module path, and the
  declared-type pass accepting a callable or a boolean literal as a type name.
  What remains after the fixes, on all 3,914 files:

  | Residual | Count | Adjudication |
  | --- | --- | --- |
  | `uses` for a binding form the oracle did not track | **0 — closed** | Five instances, one cause: the oracle's `bindNames` read a destructuring pattern one level deep, so `let (a, (b, c))` never bound `b`/`c`, and `concept_declaration` had no scope frame at all, so a concept's formal parameter — the one binder in Nim written as a bare identifier in a `parameter_list` — was never a binding. `bindNames` is now recursive and a concept is a frame. Measured over 3,914 files: the class went 5 → 0 |
  | `instantiates -> sink` (`lib/core/system.nim`) | 1 | **oracle** gap: `sink[T]` is a real declared Nim type, so constructing one IS an instantiation. The oracle's `instantiates` rule does not cover the generic-construction form |
  | `references -> default` (`lib/js/asyncjs.nim`), `references -> f` (`lib/pure/typetraits.nim`) | 2 | **UNADJUDICATED — the analyzer emits them and the oracle does not, and a minimal repro did not reproduce it.** A field named `default` and a parameter named `f` are both correctly excluded in isolation (verified), so the source is something narrower in these two macro-heavy files. Recorded rather than guessed: a plausible-sounding ruling here would be worse than an open row, and it is the reason the sweep prints file and line for every residual |
  | `references -> Rgba8` (`tests/.../taliasbugs.nim`) | 1 | **genuinely ambiguous.** `BlenderRgb[Rgba8]` reads as a type argument and the analyzer treats it as one; the enclosing test suggests a value index. Resolving it needs a decision about bracket positions in a non-generic call, not a patch |

  The residual count over the whole corpus is **4, down from 10** when this table
  was first written. That number matters more than any single row: a standing
  check that always reports the same handful of known rows is a check nobody
  reads, and a NEW defect would hide in that noise. With four rows the signal is
  usable again, and the two unadjudicated rows are named precisely enough to be
  picked up by whoever has the context for them.

  The import family is now CLEAN over all 3,914 files. Getting there took four
  corrections, and three of them were the oracle's fault rather than the
  analyzer's — which is the point of a sweep that reports per-file target sets
  instead of aggregate counts:

  | Spelling | Oracle published | Analyzer published | Who was right |
  | --- | --- | --- | --- |
  | `from std/uri {.all.} as uri2` | `std/uri {.all.} as uri2` | `std/uri` | analyzer — a qualifier and an alias are not part of a module's name |
  | `import ./m1 {.all.}` | `./m1 {.all.}` | `./m1` | analyzer |
  | `import m9627 / [a, b]` | `m9627 / [a, b]` | `m9627/a`, `m9627/b` | analyzer — a module LIST is one edge per element |
  | `include foobar as foo` | `foobar as foo` | `foobar` | analyzer |

  All four shared one cause: an arm of the oracle calling the raw-text reader
  where it needed the path reader. Three of the four were the SAME arm — the
  `from`-form, then the `include` form — and the second was only visible after
  the first was fixed. An aggregate count would have shown "16 import
  mismatches" and left every one of them unadjudicated.
  A rotation-only lane would have reported 0% unexplained through all of the above
  except by luck. That is the single most important methodological finding in this
  lane, and it is why the sweep is a tool in `fixtures/nim/probes/` rather than a
  thing to remember to run.
- **Mutation** (`script/m14/mutate-analyzer.ts`, `BB_MUTANT_ONLY="nim/"`):
  **58 nim mutants registered, 58 caught, 0 survived** under the shared runner
  `bun run script/m14/mutate-analyzer.ts` (43 inline at `script/m14/mutate-analyzer.ts`,
  15 in `script/m14/nim-mutants.ts`; per-mutant rows in
  `validation/m14/measurements/nim/mutant-sweep-nim.txt`). That sweep's exit code
  is 2 and it reports **6 surviving mutants in other lanes** — `java/bare-read-type-attribution`,
  `groovy/modifier-return-type-loss`, `groovy/ctor-name-revert`, `scala/drop-import-source-rewrite`,
  `make/swallow-the-rule-after-a-comment`, `php/drop-external-override-guess` — none of them
  a nim id, and none of them this lane's to fix (§8). One per symbol kind, per relationship kind,
  per ruled rule in the table below, and per payload row — each a revert of a fix
  this lane actually made, or of a rule this document claims. Five fixtures
  passing is not evidence that the suite can fail; this is. The first run caught
  27 and left 13 survivors, and a survivor is defined by the gate as a hole in
  the suite rather than a weak mutant. Chasing the 13 found **two real analyzer
  defects**: a tuple type was never published as a `struct` in *either* of the
  two ways Nim spells one (so the symbol table above was false), and an unnamed
  tuple element published properties named after builtin types. Both are fixed and
  both are pinned in both directions. The other eleven were missing pins — a
  three-segment import, the `from`-form spelling, the object-construction label,
  the destructuring shadow, the assignment target, the call-callee double count,
  the generic-parameter and blank-identifier leaks, and **zero line_number,
  docstring or decorator pins**, which is why a mutant that deleted every line in
  the language had survived. Two pins are deliberately *paired*: the
  `uses stemOf -> fileStem` forbid only means something because
  `expectSymbols {fileStem, property}` pins that the field exists, since a fix
  that deleted the field would otherwise satisfy the forbid vacuously.
- **Ontology-round mutants** (`script/m14/nim-mutants.ts`, run by
  `npx tsx validation/m14/fixtures/nim/verify-mutants.ts`): **15 mutants, 15
  caught, 0 survived, exit 0.** This round's own defects, one per failure mode rather than
  one per line:

  | Mutant | Caught by | failures |
  | --- | --- | --- |
  | `nim/concept-refinement-labelled-extends` | `nim/concept` | 0 → 1 |
  | `nim/concept-refinement-lost` | `nim/concept` | 0 → 1 |
  | `nim/concept-refinement-drops-the-list-tail` | `nim/concept` | 0 → 1 |
  | `nim/concept-satisfaction-invented` | `nim/concept` | 0 → 1 |
  | `nim/export-except-published-as-exported` | `nim/reexport` | 0 → 1 |
  | `nim/export-qualified-published-by-written-form` | `nim/reexport` | 0 → 1 |
  | `nim/foreign-reexport-listed-as-local-provider` | `nim/reexport` | 0 → 1 |
  | `nim/concept-refines-field-read-as-wrapper` | `nim/concept` | 0 → 1 |
  | `nim/star-marker-promoted-to-an-exports-edge` | `nim/reexport` | 0 → 1 |

  Two of these are reverts of defects that were **on disk** when this round
  resumed: the `refines` field read as a wrapper, and the `except` clause read as
  publication. The first is why `refinementListOf` exists; the second is why the
  export reader is positional. The fourth
  (`concept-satisfaction-invented`) is a **fabrication** mutant, and it was a
  SURVIVOR on its first run — the fixture suite had no concrete type in it, so
  nothing pinned "an object never acquires an `implements` edge". The fix was to
  the suite, not the mutant: `nim/concept` now declares `type Meters = object`
  and forbids `implements` from it.

  The nine live in a lane-owned module rather than in the shared harness, on the
  `script/m14/fsharp-mutants.ts` precedent, and `verify-mutants.ts` applies the
  harness's own caught rule (`mutated.fail > base.fail || mutProblems >
  baseProblems`) through the shared `runLang`, so these are the harness's numbers
  and not a second opinion about them. The one-line wiring
  (`import { NIM_MUTANTS } from "./nim-mutants"` + `...NIM_MUTANTS,` in `MUTANTS`)
  is a shared-file change and is reported rather than applied, so until it lands
  these nine are verified by the lane's runner and NOT by
  `bun run script/m14/mutate-analyzer.ts`.
- **Completeness classification** (`script/m14/spec/nim-completeness.json`): all
  **127** named node types the pinned wasm declares are classified, so nothing is
  silently absent — 95 `handled_verified`, 31 `internal_silent` (each with the
  reason it is silent rather than merely unreferenced), 0 `gap`, and 5
  `design_decision` rulings (NIMD1 file-scope pragma statements, NIMD2 cross-file
  overrides, and 5 `design_decision` rulings — NIMD1 file-scope pragma
  statements, NIMD2 cross-file overrides, NIMD3 concept satisfaction, NIMD4
  `.nimble` routing, NIMD5 `.nims` routing, all five now RULED on recorded
  evidence). The open work in this lane is a **grammar** gap, which is a different
  ledger from an analyzer gap.
- **#419 sections** (`bun run script/m14/completeness-inventory.ts --lang nim`):
  **A** structural (164 types classified), **B** all eight relationship kinds
  pinned by fixture, **C** payload matrix (complexity, imports), **D** four
  distinct `evidenceClass` tiers pinned (`structural`, `usage_contextual`,
  `reference_qualified`, `import_based` — two tiers for the *same* kind is the
  point of pinning them at all), **G** docs, **H** cross-language 12/12.
  **E and F do not pass yet, and are not made to pass by hand**: they read
  `avgMsPerFile` and a floor row for `nim:nim` out of
  `validation/m14/differential-baseline.json`, and that file is written by the
  canonical multi-language sweep, which a scoped `--lang nim` run deliberately
  refuses to write ("M14.0.F5 NOT written — the artifact belongs to the
  canonical 25-file, 29-language sweep"). Writing those two rows by hand would be
  fabricating a gate's input, so the sections stay red and visible.

Two things this evidence does **not** cover, stated so they are not read as
covered: cross-file method overrides, and the do-pragma grammar gap below.

## Performance

Two tools, and the second one exists because the first could not be trusted on
its own.

`script/m12/nim-perf-profile.ts` attributes cost *within* the analyzer per phase.
It exists because a CPU profile is not a budget: sampling attributes
tree-sitter's WASM work to `(idle)`, and a profile of this analyzer reported
**"94% idle, 0.00s in real-nim-analyzer"** while the analyzer was in fact **82% of
wall time**. The measured split is parse ~22% / analyze ~78%.

`script/m12/nim-perf-ab.mts` compares two analyzer versions in one process,
interleaved, each one's **minimum** over repeated trials, and compares their
outputs field by field. Both halves are load-bearing. On this box the same
200-file sample read 91.5 and 91.1 ms/file back to back and the per-phase
distribution swung from 28.9% to 20.3% with no code change in between — the
machine's noise is larger than the effects available, so "it got faster" is
unfalsifiable unless the comparison cannot see the noise. And the output diff is
what makes an optimization safe to land: a change that moves one symbol kind, one
relationship type, target, line or confidence fails in the harness rather than in
a fixture three commits later.

### Where the time went, and what it cost to fix

The analyzer ran **seven independent full-tree walks**. The cost was never one
slow function — it was paying the JS↔WASM boundary on the same nodes seven times:

| Walk | Share before |
| --- | --- |
| `collectCallsAndUses` | 20–29% |
| `collectDeclarations` | 15–20% |
| `collectModules` | 8–19% |
| `nimCyclomaticComplexity` | 4–19% |
| `collectDeclaredTypeRefs` | 7–16% |
| `collectInstantiations` | 8–9% |
| `collectDocComments` | 5–9% |
| *containment / inheritance / overrides (symbol table, not tree)* | **0.04%** |

Fusing them to **four** — the three symbol-table passes were already free — gives
**1.618x, 35.8 → 22.1 ms/file, 544 symbols/s** measured end to end, with
**byte-identical output** at every step.

Two optimizations were **measured and rejected**, which is the more useful half of
this record:

- **Memoizing the cyclomatic counter** in one post-order pass keyed by node id,
  replacing N+1 subtree walks with 1: **23.7% SLOWER**. A `Map` with one entry per
  node per file costs more than re-walking the handful of nodes inside a small
  callable body. It also nearly shipped a wrong answer — descending into
  *anonymous* children double-counts every branch, because an anonymous keyword
  token carries the same type string as the statement that owns it, which an
  equivalence check caught on 6,730 of 209,114 nodes.
- **Fusing the declared-type pass inline** rather than as a hoisted handler:
  **5.5% SLOWER**, byte-identical output, because `ownerOf` and the recursive
  `collectFromTypeExpression` were rebuilt on every node visit instead of once per
  file.

Both point the same way, and it is the design rule for the whole walk: **one
stack, one local counter, closures built once, and nothing allocated per node.**
The win is fewer node *visits*; per-node allocation of any kind costs more than
the traversal it rides on.

## Complexity envelope

`script/m12/nim-corpus-measure.ts`, artifact
`validation/m12/results/nim-corpus-complexity.json`. Two numbers are deliberately
kept apart because they are different claims, and the artifact records which one
it is making as `measurementPath`:

- **`direct-single-parser`** (the recorded run): 5,056 tracked `.nim`/`.nims`
  files, one parser in one process. 91,079 symbols, 203,410 relationships.
  Yield: 18.0 symbols and 40.2 relationships per file.
- **`production-pool-worker`**: the route the indexer itself takes. A separate
  claim, and the run is not recorded in this artifact — the pool stalls at worker
  startup on a machine where other work is in flight, and a stalled pool writes no
  artifact at all, which reads as "never ran" rather than as "died". Run it on a
  quiet machine; the script supports it as the default.

Relationship mix over the corpus: `calls` 87,244, `references` 44,545, `uses`
34,937, `contains` 21,784, `imports` 12,090, `instantiates` 2,085, `extends` 657,
`overrides` 68. Symbol mix: `function` 31,816, `property` 13,836, `variable`
13,213, `constant` 9,639, `enum_member` 8,471, `struct` 4,284, `macro` 3,792,
`type` 2,881, `method` 989.

Cyclomatic complexity is the analyzer's own per-symbol measure: mean 1.82 across
files, max 1,460, and the worst files are named rather than left as an average —
`htmlparser.nim` 1,460, `vm.nim` 747, `sigmatch.nim` 542. A mean of 1.82 with a
max of 1,460 is why the artifact carries the list: an average over mostly-small
files hides the fact that one proc scored 1,460.

### Two records that do not fully agree, and why that is stated

| Record | Path | Files | Symbols | Relationships |
| --- | --- | --- | --- | --- |
| `nim-corpus-errors.json` | production pool-worker | 5,227 (incl. 171 `.nimble`) | 91,011 | 202,256 |
| `nim-corpus-complexity.json` | direct single parser | 5,056 (`.nim`/`.nims`) | 91,079 | 203,410 |

The file-set difference is measured, not assumed: the 171 tracked `.nimble` files
were run through the direct path alone and contribute **26 symbols and 315
relationships**. The residue is therefore a *path* difference — the engine route
post-processes the analyzer's output before counting (it drops relationships that
do not resolve, the same rule the seam gate asserts) — and it is recorded as an
open reconciliation item rather than smoothed into one number. `.nimble` is
excluded from the complexity artifact on purpose: that run predates the routing
decision, so including it would report coverage the router had not yet been given
when the number was taken. Its share is stated above (26 symbols, 315
relationships) rather than folded in silently, and a re-run of the measure on a
quiet machine will cover all 5,227 through the production path.

## Honest limitations

1. **do-pragma is not parsed as a pragma — and the fix is now MEASURED, not
   assumed.** `expr.#[…].#` is consumed as a block-comment extra, so the 16
   affected corpus files lose the pragma surface. A 56-line grammar patch was
   written and, on 2026-09-28, finally rebuilt end to end once the machine had the
   ~2.3 GB this 41 MB `parser.c` needs:

   | gate | result |
   | --- | --- |
   | `tree-sitter generate` | succeeds (15 min) |
   | `tree-sitter test`, upstream's own 72 cases | **72/72 pass** |
   | compiler matrix, 17 files | unchanged, no regression |
   | **whole pinned corpus, 3,914 files** | **0 files fixed, 6 files regressed** |

   The patch is therefore **strictly harmful as written**, and it stays unapplied.
   The six broken files are all macro-heavy, which points at the cause being
   structural rather than typographical: `#[` is the EXTERNAL SCANNER's token, so
   a grammar-level production for it competes with the scanner that owns it. A real
   fix has to reach the scanner, not just the grammar — which is a different piece
   of work, honestly scoped rather than left as a hopeful patch. The patch
   (`$HOME/fixtures/nim/out/0001-nim-dopragma.patch`) and the candidate
   (`grammars/_vendored/nim/0001-nim-dopragma.patch`) and the candidate
   wasm (5,914,156 B) are both preserved for whoever takes it on.

   This is the strongest argument this lane has for its rebuild protocol: the
   conformance suite passed 72/72 on a build that made the corpus measurably
   worse, because upstream's suite contains no do-pragma case. Conformance proves
   the patch did not break what upstream tests; only the corpus sweep caught what
   it did.

   A **rebuild hazard** came out of the same exercise and is recorded in
   `grammars/tree-sitter-nim/PIN.md`: this vendored tree keeps `scanner.c` at the
   root while upstream keeps it at `src/scanner.c`, and `tree-sitter generate`
   does not move it. The externals live in `grammar.js`, not in
   `tree-sitter.json`, so `generate` produces an empty `src/tree_sitter/` and no
   `src/scanner.c` — and a wasm built that way parses no indentation-sensitive Nim
   at all, quietly, with a successful build. The PIN's two-command sequence was not
   sufficient to reproduce the wired build; it now carries the required
   `cp scanner.c src/scanner.c`.
2. **Cross-file method overrides now RESOLVE — through the project's companion
   index, and the per-file default is preserved.** The capability is not
   NIM-specific: `ASTEngine.AnalyzeContext.overrideCompanion` already existed and
   six analyzers consumed it, and NIM was the one that could not use it. The
   blocker turned out to be one missing field rather than a missing algorithm —
   **a Nim method never declared `ownerName`**. A method's owner IS its receiver
   type, and `ownerName` is the family-standard field for that, but the receiver
   was parked in `metadata.nimReceiverType` where nothing generic reads it. So the
   companion index came back EMPTY for a file whose base class declared a method
   (`buildOverrideCompanion` keys on `ownerName` + `kind === "method"`), and
   cross-file resolution could not work no matter what the override pass did.
   Setting `ownerName` also produced the `contains` edge from a receiver to its
   method, which the ontology in this document had always claimed.

   The override pass now calls the shared `findDeclaringParent` resolver, so the
   semantics are identical to java/kotlin/csharp/groovy/scala/swift: the first
   ancestor in declaration order that actually declares the method. The edge is
   emitted at **confidence 0.9, not 1.0**, and that is load-bearing — the
   companion carries `owner -> method names` and NOT each type's own base list, so
   the walk descends only as far as bases visible in the current file. A hierarchy
   three modules deep, whose middle module's base is in a third, stops at the
   visible link. The edge records `nimCrossFileBase` and
   `nimResolution: "companion-index"` so a companion-resolved edge is
   distinguishable from a same-file one, and 0.9 keeps it a claim rather than an
   assertion under the differential's 0.7 threshold.

   **This family is gated by the M12 ground truth, not by a fixture lane**, and
   that is a property of the fact rather than a gap in coverage: the base type and
   the method it declares live in different modules by definition, so no
   single-file fixture can express it. The ground truth asserts
   `overrides:GlossPainter.paint -> Painter.paint` across `painter.nim` and
   `gloss.nim`, and its harness is one of the few callers that builds a
   companion. A mutant for it was written and deliberately REMOVED: the mutation
   gate requires a mutant to turn the fixture suite red, and the fixture runner
   passes no context, so the mutant was vacuous by construction and would have
   made the gate red forever over a genuinely covered family. The fixture-visible
   half of the same mechanism — a method declaring its `ownerName` — is gated
   normally, as `nim/method-owner-name-dropped`.

   The production indexer does not yet build a companion, so `bb index` behaves
   as the honest per-file default. That is the same position the six adopting
   languages are in, and it is stated here rather than implied.
3. **`.nims` and `.nimble` are now ROUTED — decided on measurement, as the
   deferral required.** They were left pending on purpose, with a recorded reason:
   the pinned grammar declares both in its own `file-types`, and declaring a
   format is not evidence the analyzer models it. Routing on the declaration
   alone is the claim-without-coverage class. So the deferral named the missing
   input, and this is that input, over every tracked file of all 12 corpora:

   | ext | files | error files | error nodes | symbols | relationships | imports |
   | --- | --- | --- | --- | --- | --- | --- |
   | `.nims` | 65 | **0** | 0 | 43 | 279 | 96 |
   | `.nimble` | 171 | **0** | 0 | 26 | 315 | 11 |

   100% parse health on both, and neither is pure data: a `.nims` is NimScript
   (`set_cmd`/`switch`/`buildFile` — procs and calls on a real stdlib), and a
   `.nimble`'s `task`/`bin` blocks declare real things. `language-detection.ts`
   now maps all three extensions to `nim`, and the differential and fixture lanes'
   `ext` lists changed in the same edit so the claim and the router cannot drift
   apart: a lane that sweeps an extension the router skips is the inert-pin
   class, and a lane that under-reports what the router now handles is the same
   defect wearing a hat. Rulings NIMD4/NIMD5 are now RULED with their numbers.
4. **The oracle shares two inputs with the analyzer, deliberately.** It imports
   the analyzer's builtin-name filter, and it takes the analyzer's symbol list as
   the name inventory for `contains` (the zig bare-uses oracle sets the same
   precedent: ownership assignment is not what the differential audits, so
   re-deriving it would only add a second place to be wrong). Everything the
   differential *is* auditing — calls, uses, instantiates, references, extends,
   overrides, imports — is derived independently. The limit of that arrangement
   is stated here because it is real: a defect in the shared builtin list would
   not be caught by this lane.
5. **The `is`-form of concept refinement is read only when the named contract is
   declared in the SAME file, and that is a deliberate refusal rather than a
   limit of effort.** A concept in module A refining a concept from module B is
   ordinary Nim, and the `of`-form has no such restriction — so the asymmetry is
   a judgement about what is decidable, stated so it can be disagreed with:
   `of B` names a contract in a clause whose entire purpose is naming contracts,
   while `x is B` is a general type-test whose right-hand side is a concept or a
   concrete type depending on a scope this pass cannot see. Relaxing the guard
   for a confidence discount would publish `implements -> int` for the 120 of 125
   corpus `is` expressions whose RHS is a builtin or a generic parameter
   (`T` 31, `int` 23, `bool` 15, `string` 10, `V` 5, `float` 5). The cost of the
   guard is that a cross-file `is`-refinement is missed; measured on this corpus
   that cost is **0 occurrences** over 6,063 files, and the funnel is measured
   rather than asserted: 156 `is` expressions in concept bodies, 13 whose LEFT is a
   bare concept formal parameter, **0** whose RIGHT names a same-file concept — the
   13 name `U`(2), `int1`, `int2`, `string`, `PrimitiveBase`, `IntegerBase` or
   `IdBase`, i.e. a concrete type or a generic parameter in every one. **This
   limitation survives the corpus growing by a third and is now harder to dismiss
   rather than easier**, because the repository that arrived holds concepts in bulk
   and all 47 of the family's edges use the OTHER spelling: the `of`-form carries
   no same-file guard and 4 of its 47 edges legitimately name a concept from
   another module. So the asymmetry is a fact about the two syntaxes, not an
   artefact of a thin corpus — which is the strongest form this judgement could
   take. A cross-file semantic index would lift the restriction; a name-shape
   heuristic would not be worth the fabrications, and now there is a concrete
   corpus name for what it would cost. The first version of this probe reported the 13 as 0, because it
   looked the parameter up in a map keyed by concept OWNER name instead of walking
   each body with its own concept's parameters — a guard that cannot match prints
   the same zero as a construct that does not occur, which is the whole reason the
   ruling table carries `conceptsExamined` beside `refinements`.
6. **`implements` fires on 47 edges, and 39 of them use three shapes no fixture
   pinned until this pass.** The construct is confirmed present in the language
   (`nim/compiler/parser.nim:2268/2275/2291`,
   `nim/doc/manual_experimental.md:1205-1213`, and upstream's own error text
   `concept can only inherit from other concepts`) and it is now measured on real
   code rather than ruled absent. What remains open:

   - **The `is` spelling is still corpus-absent.** 156 `is` expressions in concept
     bodies, 13 on a bare formal parameter, 0 naming a same-file concept. The
     second spelling is pinned by fixture rows and exercised by nothing in 6,063
     files.
   - **The cross-module half of the guard is a judgement, not a measurement** —
     *Limitations* 5. It now has stakes: 4 of 47 edges legitimately cross modules
     through the `of`-form, so relaxing the same guard on the `is`-form would fire
     against those names.
   - **1 of the 47 points at a builtin** (`implements -> int`), on a file upstream
     ships as a negative test with the compiler's own rejection message beside it.
     Recorded with its count rather than guarded away, because a guard that hid it
     would be indistinguishable from one that hid a real refinement.
   - **No oracle derivation existed for this label until this pass**, so the 47 were
     quoted with no second opinion while they were being quoted. There is one now
     (`deriveConceptRefinement`) and it agrees 3/3 on the sample.
   - **The coverage is one repository.** All 47 edges are in `nim-lang/nimony`, and
     39 of the 47 are in that repo's `tests/nimony/concepts/` directory — upstream's
     own test suite for the feature. So the family is measured against upstream's
     tests rather than against production use, which is a weaker basis than the
     other nine types have, and it is stated rather than averaged away.

7. **An `export` operand spelled with a keyword qualifier is skipped.**
   `export mod.Name` does not parse as a qualified export at all: `mod` is a
   keyword, so the tree is `prefix_expression(mod, ERROR(.), identifier(Name))`
   and no qualified name can be recovered from it. The reader skips rather than
   guessing `Name`, because a wrong endpoint is a fabricated edge and a skipped
   one is a gap that stays visible. Falsifying probe: a corpus count of
   `export_statement` operands parsing as `prefix_expression`.
8. **A symbol kind can still come back empty, and it is not this analyzer's
   doing.** The count is load-dependent and MOVES BETWEEN RUNS on the same corpus:
   16 of 77,371 symbols, then 20, then 4 of 83,051, then 21 of 83,639, then 2,
   then **0** — the 0 being the clean walk every committed artifact is now taken
   from — then **34 of 83,701**, measured on this pass and added because a seventh
   walk that nobody records is how a reader ends up believing the sequence ended
   at 0. That 34 is the largest value on record and it came from a **single**
   file: `nim/tests/async/twinasyncrw.nim`, which is the one walk in the sequence
   where every one of the 34 empty-kind symbols in the whole corpus belongs to
   one path, and the run exited 1 on `[BB-HANG] parser stuck 120s` on that same
   file, having already logged
   `[BB-PARSE-ERR] nim | …/twinasyncrw.nim | memory access out of bounds`. The
   degraded walk moved **4 of the 10** types against the clean artifact —
   `calls` 79,033 against 79,129 (−96), `references` 40,537 against 40,559
   (−22), `imports` 9,336 against 9,345 (−9), `contains` 21,573 against 21,579
   (−6) — while the other **6 read identical**: `uses` 31,063, `exports` 408,
   `extends` 570, `overrides` 48, `instantiates` 1,990, `implements` 0. So a
   degraded walk is not a uniform scale factor and must not be averaged in; it
   is localized, and the six types the verdict rests on are among the six that
   did not move.

   **Two further degraded walks on this pass, and a conclusion that is not
   comfortable: the clean walk is not currently reproducible on this box.** Three
   full censuses were run against blob `9d9ee478e3295c28` over the same 4,555
   files and **3 of 3 came back degraded** — 34 of 83,701, then 22 of 83,620,
   then 18 of 83,635. Not one reproduced the 0 the committed artifact records.
   That is consistent with the load explanation above (seven lanes on 8 cores at
   the time) and it means the honest reading of this limitation is *not* "the
   count is occasionally non-zero"; it is **"at the corpus's size and this
   machine's current load, a clean walk is the exception"**. The committed
   artifact stays as the clean walk because it IS one — pinned on both sides,
   4,555/4,555 parsed, 0 throws, 0 empty kinds — and it was measured, not
   assumed. What cannot be claimed is that re-running the command today
   reproduces it. The two degraded walks above are not committed (they are
   reproducible only as "some walk on this box on this pass"); the guard added
   to `census.ts` below is what stops the next one being mistaken for a clean
   one.

   Every non-zero one in a file that also logged
   `[BB-PARSE-ERR] … memory access out of bounds` in the same run
   (`nim/lib/std/tempfiles.nim`, `nim/tests/casestmt/tcstring.nim`,
   `nim/tests/manyloc/keineschweine/dependencies/chipmunk/chipmunk.nim`, and
   others), and a re-parse of those files individually yields 0 empty kinds
   (`tdeepcopy_nocopy_field.nim` gives 6 symbols, all with kinds). The
   non-determinism is the finding as much as the non-zero count: "memory access
   out of bounds" is the tree-sitter WASM exhausting its fixed heap, so WHICH
   files trap is a property of machine load — with seven lanes on 8 cores, load
   runs 16-25 — and not of the corpus. The cause is in shared machinery:
   `extractBasicSymbols` (`src/ast/pool-worker.ts:63`) resolves its pattern table
   with `patterns[language] || patterns.javascript` (line 124) and nim has no
   entry, so a `.nim` file whose parse throws is harvested by **JavaScript**
   declaration regexes; those write a `type` field, and the pipeline mapping
   (`kind: s.kind`, line ~869) then maps `undefined`. Reported, not edited:
   `pool-worker.ts` is not this lane's file. Two fixes would each close it —
   `kind: s.kind ?? s.type`, or a `nim:` entry in that table.

   **The same event now has a second, worse consequence, measured twice this
   pass.** `src/ast/engine.ts:1441-1444` arms a 120-second watchdog around the
   synchronous `parser.parse()` and clears it at 1447 — but the `throw` at 1449
   leaves between those two lines, so a parse that FAILED leaves the watchdog
   armed. It then fires 120 seconds later and calls `process.exit(1)` printing
   `[BB-HANG] parser stuck 120s on <file> — exiting`, on a run that did not hang:

   | run | artifact | `[BB-HANG]` named | named file's own log line, same run |
   | --- | --- | --- | --- |
   | `census.ts` | written, digest printed | `nim/lib/std/private/ossymlinks.nim` | `[BB-PARSE-ERR] … memory access out of bounds` |
   | `census.ts`, the `ontology-census` walk (**6 workers**, hardcoded — see the note above the verdict table) | written, digest printed | `nim/tests/distinct/tinvalidborrow.nim` | `[BB-PARSE-ERR] … memory access out of bounds`, and the run's only other parse error was `tests/overload/toverl.nim` |
   | `resolution-audit.ts`, 2 workers | written, digest printed | `nim/tests/ic/mlocalpassc.nim` | `[BB-PARSE-ERR] … memory access out of bounds` |
   | `accent-quoted-endpoints.ts`, 2 workers | **NOT written** — the walk was destroyed | `nim/lib/std/private/oscommon.nim` | `[BB-PARSE-ERR] … memory access out of bounds` |
   | `census.ts`, session 2, `BB_NIM_WORKERS=2` | **NOT written** — the walk was destroyed, and so was the header line | `nim/tests/async/treturn_await.nim` | `[BB-PARSE-ERR] … memory access out of bounds` |
   | `census.ts`, session 6, **default `BB_NIM_WORKERS=6`** | **NOT written** — the walk and the header line were both destroyed | `nim/tests/dll/nimhcr_0_2.nim` | `[BB-PARSE-ERR] … memory access out of bounds` |
| `ontology-coverage-gate.ts`, session 7, **8 workers** (the shared arbiter, unpatched) | **NOT written** — the gate never reached its verdict table | `nim/tests/dll/nimhcr_0_6.nim` (**90 B, 5 lines**) | `[BB-PARSE-ERR] … memory access out of bounds`; the run's only other parse error was `package/stdlib/stdlib.nimble` |

   **Seven runs, seven different files, at three worker counts.** That is the whole of
   the discriminating observation, and the `ontology-census` row is what makes it a
   count rather than an impression: its named file is in the artifact's own first two
   lines, so it can be checked rather than remembered. One pathological input would
   name the same file every time. The last row is also the first one measured rather
   than inherited, and it is the one that moves this from a pattern to a number — the
   next paragraph takes it apart.

   The fifth row is the one that generalises the defect. The first three still
   produced a digest-pinned artifact that merely exited 1, so a reader had
   numbers with a warning attached; this one produced **nothing at all**, because
   `process.exit(1)` inside the engine takes the process's buffered stdout with
   it, and the census had not yet reached its first `console.log`. The named
   file is again one that had already thrown rather than one that was stuck —
   `treturn_await.nim` sits in `nim/tests/async/`, the same directory as the
   `twinasyncrw.nim` of the 34-empty-kind walk above, which is the shape of the
   cause: these are the wasm files whose parse allocates enough to exhaust the
   heap under contention. The same walk at `BB_NIM_WORKERS=1` completed clean, so
   the mitigation available without touching shared code is the fan-out.

   **The sixth row is the one that changes how this lane's own instrument has to be
   run, because it is the DEFAULT.** `census.ts:70` reads
   `BB_NIM_WORKERS ?? 6`, so the command as written in the workstream — `npx tsx
   validation/m14/fixtures/nim/census.ts`, no env var — produced **zero lines of
   report** on session 6 and had to be re-run with the variable set.
   **That run's log was not committed — nothing was written, log included — so its
   parse-error count is the one number in this section no reader can check, and the
   record disagrees with itself about it**: the commit describing the run
   (`6362dc82e`) says "five other files" in prose and then names seven paths
   (`dll/nimhcr_0_2`, `ic/mmodsymadd`, `overload/tuntypedarg`,
   `nimony/examples/sets_basics`, and three under `nimony/tests/nimony/async/`).
   Seven is what the list contains and seven is what is quoted here, and the named
   hang file is one of them. **The hang file differs on every run at every worker
   count** — seven runs, seven
   files: `ossymlinks.nim`, `tinvalidborrow.nim`, `mlocalpassc.nim`, `oscommon.nim`,
   `treturn_await.nim`, `nimhcr_0_2.nim`, `nimhcr_0_6.nim` — which is the
   discriminating observation:
   one pathological input would name the same file every time, so the trigger is
   load-dependent rather than a property of any file. Every number in this document is
   therefore quoted at the worker count that produced it, and **the reproduction
   command for this lane is `BB_NIM_WORKERS=1 npx tsx
   validation/m14/fixtures/nim/census.ts <out>`, not the bare command.**

   **And the named file is not the cause, which the changing name alone could not
   show.** The observation above is that the named file *changes* between runs.
   Session 7 adds the other half, by measurement rather than by inference.
   `validation/m14/fixtures/nim/hang-file-arbitration.ts` takes all seven named files
   and parses each one ALONE through production `parseFile`, five times, with nothing
   else running:

   | | |
   | --- | --- |
   | named files | **7** |
   | total size | **16,683 B over 515 lines** |
   | largest named file | **7,828 B** (`ossymlinks.nim`); smallest **90 B** (`dll/nimhcr_0_6.nim`, 5 lines) |
   | parses | **35 of 35 succeeded, 0 threw** |
   | slowest single call | **6,511 ms cold**, 289 ms warm — against the engine's **120,000 ms** watchdog, **18x** headroom (a second run: 3,275 ms cold, 37x) |
   | warm max across all seven | **289 ms** |

   **`dll/nimhcr_0_6.nim` is 90 bytes and parses in 9 ms.** It is the file the arbiter
   named as STUCK on session 7, on a run where it had already logged
   `[BB-PARSE-ERR] … memory access out of bounds`. A 90-byte input cannot exhaust a
   fixed WASM heap, so "this file is pathological" is not available as an
   explanation of that exit; and no single-file parse of any of the seven comes within
   18x of the watchdog. What the probe cannot see is contention — it runs
   single-threaded by construction — so it does not prove the watchdog is the cause.
   It does mean the §8 report no longer rests on an inference from the file changing
   between runs: the named input clears the threshold by a measured margin.

   **So this lane's corpus instruments exit 1 on results that are finished and
   digest-pinned**, and under load one of them lost its entire walk and had to be
   re-run. The message is false on its face — it names a file that threw, not one
   that is stuck, so triage is sent to the wrong file. Reported (§8): the fix is a
   `try`/`finally` around 1446-1450, or clearing the timer before the throw.
9. **Endpoints equal to the literal `unknown` are 8 on this corpus and every one
   is a real Nim identifier** — measured split `4 × contains`, `4 × uses`, and 0 on
   any other type. (An earlier 4,101-file draw measured 5; the count moved with the
   corpus, not with the rule, which is why the figure is reported as a measurement
   rather than a property.) `nim/tests/manyloc/named_argument_bug/tri_engine/
   gfx/gl/gl.nim:21` declares `unknown` as an ordinal enum member of `EGL_err`
   and line 37 reads `EGL_err.unknown`; `nim/tests/generics/
   tuninstantiatedgenericcalls.nim:214` declares an object field named `unknown`
   and line 219 reads `a.unknown`; `nimterop/nimterop/globals.nim:135` declares it
   as an enum member of `Status`. All 8 edges are truthful, and the
   ledger's own runtime probe discriminates the
   same way — it convicts a name only when the FILE DOES NOT WRITE IT, because
   the first two runs of that probe convicted 154 real members of powershell and
   fsharp. Suppressing them would delete true edges to satisfy a literal reading
   of R7; renaming them would break R10's endpoint spelling. Recorded here so the
   count is not mistaken for a violation.
10. **`exports` resolves at both ends on 3.9% of its 408 edges, by construction.**
    They are re-exports of names declared in another module, so the
    target is unresolvable from the file's own symbol set and resolvable only in
    a full index. That is the honest reading of a correct edge, not a defect —
    but it does mean an exports-only query scoped to one file returns mostly
    dangling rows, and a consumer that treats resolution as a quality filter will
    discard the family.

11. **`parseFile` silently degrades to a REGEX extractor under concurrency, and the
    degraded output is indistinguishable in a count from a tree-derived one.**
    The `fallback: true` branch of `src/ast/pool-worker.ts` calls
    `extractBasicSymbols` / `extractBasicImports` / `extractBasicRelationships`,
    and `extractBasicRelationships` matches calls with `/(\w+)\s*\(/g` over raw
    text. Measured over the same 4,555 files at
    `validation/m14/fixtures/nim/fallback.mts`:

    | workers | fallback files | symbols with an empty `kind` |
    | --- | --- | --- |
    | 1 | **0** | **0** |
    | 6 | 2 | 4 |

    and across five full-corpus runs at 6 workers the empty-kind count was 11, 4, 3,
    63, 0 — a **different set of files each time**. That path emits `calls` edges
    with `source: "this"`, which is not a symbol and so can never resolve at the
    source end; `confidence: 0.5` with `metadata.method: "regex"` and **no
    `evidenceClass`**, which the honesty contract §4 requires for any edge under
    1.0; and symbols with an empty `kind`, which the standing rules forbid. The
    empty-kind symbols are always in a fallback file, so the two symptoms are one
    event. Reported, not edited (§8): the fix is to make the degradation LOUD —
    `fallback: true` is already on the result and nothing consumes it — or to stop
    matching source text at all.
12. **The production filter deletes 366 Nim edges whose endpoint is an
    accent-quoted operator, and publishes the symbol anyway.** In Nim the backtick
    is the *accent-quoted identifier* syntax — `proc \`-!\``, `` `==` ``, `` `$` ``,
    `` `mod` `` are how every operator overload is written — and
    `filterNoiseRelationships` in `src/ast/pool-worker.ts` bans the backtick in a
    target leaf, on the stated grounds that in JavaScript it marks template-literal
    garbage. Measured by `validation/m14/fixtures/nim/accent-quoted-endpoints.ts`:
    1,417 accent-quoted declaration sites on the corpus parse trees; `analyze()`
    emits 4,509 edges with a backtick endpoint and `parseFile` delivers 4,143, so
    **366 are deleted by the filter (8.1%)** — `calls` 210, `contains` 135,
    `exports` 12, `uses` 8, `overrides` 1, which sums to 366 and the artifact
    prints the sum beside the total so it can be checked.

    **An earlier revision of this paragraph split that difference wrongly, and the
    arithmetic is what gave it away.** It read "the 376-edge difference between
    4,508 and 4,132 is 365 of filter and 11 that the filter is not responsible
    for". There is no such remainder: the backtick-endpoint difference is
    **4,509 − 4,143 = 366**, and the filter accounts for **all 366** of it, split
    210/135/12/8/1. The number it was reaching for — 11 — is not a residual of
    this comparison at all. It came from a DIFFERENT pair in the same artifact,
    the per-type `pre → post` totals, where `imports` falls 9,083 → 9,061 and
    `exports` falls 418 → 397: those deltas are `analyze()` versus the full
    `parseFile` pipeline, which also applies pool-worker stages, truncation and
    enhancements, so they are not attributable to the backtick filter. The
    artifact's own "deleted for OTHER reasons: 1 sampled" row
    (`nim/tests/modules/timportas.nim: (global) -[imports]-> .. / modules /
    definitions`) is the only other-reason deletion it names, and 1 is not 11.
    The TOTAL edge counts tell the same story and are the honest framing: 182,456
    pre-filter against 182,010 post-filter is a 446-edge difference, of which
    **366 is the backtick filter and 80 is the pipeline** — two findings, not
    one. (The per-type breakdown itself was previously published as
    231/135/21/8/1 = 396 against a stated 366; it came from a 40-row SAMPLE, and
    the instrument now tallies every deletion by type instead of sampling.) The
    symbol survives, so the result is a declaration the
    graph holds and no edge can reach: `bb_impact` on `` `-!` `` returns nothing
    and the reverse walk cannot tell that from a declaration nobody uses. This is
    the cause of the three `` `-!` ``/`` `lhs` `` `contains` rows the oracle reports
    as unexplained. Reported (§8): the filter needs a language-scoped exemption for
    `nim`, on the pattern of its existing `bash` path exemption.
13. **Six `extends` occurrences have an owner the analyzer does not publish, and
    they are three different things.** `gap-hunt.ts` measures the count at 6 over
    6,063 files and names every site:

    | n | site | what it is |
    | --- | --- | --- |
    | 2 | `nimsuggest/tests/fixtures/mclass_macro.nim` | a macro that *BUILDS* an inheritance clause from backtick parameters — `` `typeName` of `baseName` `` |
    | 1 | `nim/tests/stdlib/tjsonmacro.nim` | the same family: `MsgChallenge of MsgBase`, macro-built |
    | 1 | `nim/tests/macros/tgettypeinst.nim` | named `_`, suppressed on purpose |
    | 1 | `nim/tests/stdlib/trepr.nim` | a `type` section inside a body under `static:` — the C-D1 rule, deliberate |
    | 1 | `nim/tests/template/template_issues.nim` | a `type` section inside a `template` body — same rule |

    **This paragraph previously enumerated five sites against a stated count of
    six**, and the arithmetic is what gave it away: two macro + one `_` + two
    body-scoped is five, and the sixth is `tjsonmacro.nim`, which is the first
    family again. A stated count with a shorter list under it is the cheapest
    possible way to be wrong in a document that is otherwise full of counts, and
    it survived because both numbers looked plausible. A `static:` block is not a
    separate compilation unit the way a `runnableExamples` block is, so the two
    body-scoped sites are not the same case and are not treated as one.
14. **A doc example's declarations are published at MODULE scope, which is
    defensible and not the only defensible answer.** A `runnableExamples` block is
    compiled as its own unit, so its `type` declarations are real and are
    published; its `value` declarations are suppressed as locals. The `type`
    declarations get `scope: undefined`, i.e. they read as module-level. The
    alternative — publishing them with a scope that marks them as example-local —
    is equally defensible and would need a store-side column to record. The oracle
    disagrees about the consequence: it derived `then -> fn` containment for the
    block at `nim/lib/js/asyncjs.nim:206-216`, and that was adjudicated against the
    oracle (an example is not lexically inside the proc that documents it) while the
    scope choice itself is recorded here as open.
15. **The `overrides` cross-file family is gated on the companion index, so a bare
    corpus census cannot exercise it.** All 48 `overrides` edges on this corpus are
    same-file. Cross-file resolution needs
    `ASTEngine.AnalyzeContext.overrideCompanion`, and the corpus walk supplies no
    context, so the 10 corpus methods whose receiver is declared in another file are
    counted by `gap-hunt.ts` and never resolved by this lane's own census. The
    family is demonstrated on a fixture and by `incoming-check.ts`, not by a corpus
    number.
16. **Zero corpus occurrences of the receiver-qualified method spelling, over a
    corpus that grew by a third and still reads 0.**
    `method Receiver.name()` is standard Nim, and the pinned grammar parses the
    `Receiver.` prefix as an **ERROR node** with no field, so
    `methodReceiverTypeLeaf` — which reads the receiver only from the first
    parameter — finds nothing. `gap-hunt.ts` re-measured it over **6,063 files in
    8 repositories** and it is still **0**, beside the parameter form at **186** of
    230 methods on the tree. So this is a corpus-coverage limit and not a measured
    defect: the branch cannot be exercised by anything in the corpus, and the
    instrument prints the zero beside the non-zero so the absence is on the record
    rather than inferred. The negative reading is now better supported than it was,
    because 1,508 more real Nim files — including a second compiler — did not
    produce one. Fixing it would mean reading an ERROR node, which is a parse
    artifact rather than a syntax fact, and a corpus that never writes the
    spelling cannot tell us whether that reading is right.
17. **This lane's numbers are not reproducible without the worker count**, for the
    reason in limitation 11, and the corpus walk in every artifact here uses 6.
18. **The shared differential cannot run this lane at all, and its nim entry is
    now stale in a way that under-reports what the router handles.** Both halves
    are §8 (`script/m14/differential.ts`), reported and measured, not edited:

    - `$ npx tsx script/m14/differential.ts --lang nim` prints
      `[lane] SKIP nim: no corpus repo mapped in LANG_REPOS and none checked out`
      and `probe run (--lang nim): measured 0 lane(s)`, exit 0. `LANG_REPOS`
      (`script/m14/differential.ts:393`) has no `nim` key, so the arbiter of the
      six questions is silent for this language and every question-3 number in
      this document comes from the lane's own oracle instead. What is needed is one
      entry — `nim: <repo path under CORPUS_ROOT>`, and `nim` itself is a
      3,968-file clone already at `$HOME/fixtures/repositories/nim` —
      and one `import { deriveNimEdges } from "./nim-truth-oracle"` with a branch
      feeding it for `lang === "nim"`. `grep -c "nim-truth-oracle\|deriveNimEdges"
      script/m14/differential.ts` returns **0**, which is the mechanical form of the
      same fact.
    - `script/m14/differential.ts:25174` reads
      `nim: { … ext: "nim,nims" }` and the comment above it says `.nimble` "is NOT
      routed to nim and which is therefore not swept". That was true when written
      and is **false now**: `src/ast/language-detection.ts:53` reads
      `nim: "nim", nims: "nim", nimble: "nim"`. So the entry's comment and its
      extension list both need `,nimble`, or the lane under-reports a surface the
      production router already handles by 171 files (measured: 0 parse errors,
      26 symbols, 315 relationships, 11 imports — *Limitations* 3).
19. **`incoming-check.ts` measures an ambiguity this lane does not have, and its
    number cannot be read as a defect count.** It resolves targets against
    `const published = new Map<string, string[]>()`
    (`script/m14/incoming-check.ts:107`, populated at 134-146) keyed on NAME with
    the **file discarded**, so a name declared once in the referring file and once
    elsewhere in the indexed set is counted ambiguous — while every edge carries its
    own file and the reverse walk separates those two by exactly that. Measured on
    the same runs (`validation/m14/fixtures/nim/ambiguity-split.ts`):

    | index | edges | shared harness "ambiguous" | **irreducible (same-file)** | the harness overstates by |
    | --- | --- | --- | --- | --- |
    | `nim/compiler`, 182 files | 50,094 | 12,516 | **270 = 0.5%** | 12,246 |
    | `nim/lib/pure`, 105 files | 21,235 | 5,990 | **756 = 3.6%** | 5,234 |

    Per type on `nim/compiler` the irreducible share is `calls` 0.8%, `uses` 0.6%,
    `contains` 0.4%, and **0.0%** on `imports`, `references`, `exports`, `extends`
    and `instantiates`. The residual 270 edges are ordinary Nim: `config(62)`,
    `emptyNode(28)`, `c(23)`, `map(16)`, `name(15)`, `add(12)`, `key(11)`,
    `ensureKind(11)`, `history(10)` — overloading and the field-vs-accessor
    collision. Where the language makes the distinction impossible per-file, this
    is that statement, with the count: **270 edges over 182 files**, and no
    instrument in this lane can reduce it without a qualified name the source does
    not carry. §8 fix, not applied: key the map `name -> file -> kinds` and the
    column means what a reader takes it to mean.
20. **`parseClaimTable` drops the first body row of every ontology table, so
    every lane carries one spurious `UNDOCUMENTED` finding.** In
    `script/m14/verify-doc-truth-emissions.ts:456-481` the body scan does

    ```
    if (i === chosen.at) continue          // the header
    if (isRuleRow(cs)) continue            // the --- separator
    if (!started) { started = true; continue }   // <-- drops the FIRST DATA ROW
    ```

    and the separator is already handled by the line above it, so the third guard
    silently discards one real row per table. Measured across the repo's own
    tables: `clean` loses `calls`, `c` loses `calls`, `rust` loses `calls`,
    `python` and `go` each lose their first type — every lane whose table starts
    at a relationship type. For this lane it produced exactly one finding,
    `UNDOCUMENTED [nim] calls (relationship)`, and `bash` carries the same shape.

    This lane's table now opens with a totals row (`**all ten, one row each** |
    10 of 10 examined | **10 EMITTED, 0 ruled** | 267,265 edges over 110,043
    symbols | 6,063 admitted | …`), which states the section's summary and puts the
    drop on a row that makes no per-type claim. The gate then reads **0 findings for nim**. §8, not edited: deleting the third guard is the fix, and
    until it is, every lane's register under-reports its own claims by one row.
21. **`verify-doc-truth-emissions.ts` cannot be run with `tsx`, only with `bun`.**
    Line 131 is `const REPO_ROOT = path.resolve(__dirname, "..", "..")` in a file
    the package declares as an ES module, so `npx tsx script/m14/verify-doc-truth-emissions.ts`
    exits 1 on `ReferenceError: __dirname is not defined in ES module scope` before
    reading a single file. `bun run` on the same path works and produced the
    numbers in the gate table above. A gate that only runs under one of the two
    runners in `package.json` is a gate whose green is not reproducible from the
    documented command, and the documented form is the one that fails. §8 fix:
    `import.meta.dirname`, matching what every other harness in this lane uses.
22. **`exports` has no second opinion, and that is one DERIVATION finding rather
    than 20 defects.** The oracle derives **zero** `exports` targets, so all 20
    analyzer targets on the 400-file sample are counted MISSING by the
    cross-check's arithmetic and are unaudited by anything. The label is still
    pinned in both directions by the fixture (7 expected edges across both
    spellings, plus 4 forbids, including
    `nim/export-except-published-as-exported` and
    `nim/foreign-reexport-listed-as-local-provider`), which is a weaker instrument
    than an independent walker and is called weaker here rather than counted as
    coverage.
23. **The `__dirname`-in-ESM defect is in at least two harnesses, not one, and
    this lane's analyzer hygiene is UNMEASURED rather than clean.** *Limitations* 21
    names `verify-doc-truth-emissions.ts:131`. Re-measured this pass, the same
    class also stops `script/m14/verify-analyzer-hygiene.ts:27` under `npx tsx`, so
    a reader following the documented command gets a `ReferenceError` instead of a
    verdict. Under `bun` the gate runs, and its verdict about this lane is that it
    has none:
    - `GATED_ANALYZERS` (`script/m14/verify-analyzer-hygiene.ts:30`) is a
      hardcoded map of **25** languages; `src/ast/` holds **48** analyzers and
      `nim` is not among the 25. `--lang nim` prints `unknown language: nim`.
    - `validation/m14/results/M14.0.F7.json` holds 25 `analyzer-hygiene-*` rows
      and **0 occurrences of the string `nim`** — checked against the committed
      file and again after regenerating it. So the four dead-code classes that
      gate looks for (no-op ternaries, duplicate if/else bodies, write-only
      flags, fresh-node identity comparisons) have never been run over
      `src/ast/real-nim-analyzer.ts`. **23 analyzers are in that position and
      "0 findings for nim" from this gate would be an absence of measurement
      read as a pass**, which is the failure this workstream exists to stop. §8
      fix: add `nim: "real-nim-analyzer.ts",` to `GATED_ANALYZERS` and
      regenerate `M14.0.F7.json`.
    - The honesty contract §42 names this lane's governing lint at
      `script/verify-honesty.ts`. **That path does not exist**; the file is
      `script/m14/verify-honesty.ts`. A reader who follows the contract gets
      `ERR_MODULE_NOT_FOUND`, which is indistinguishable from the gate having no
      findings to report. §8, both items.
24. **This document's per-type edge counts are single-walk figures and three walks
    do not agree in the third digit.** The spread table under *How the arbiter
    itself now reports these ten* measures it — five walks, of which two are the
    same instrument over the same files, put `calls` between 79,047 and 79,129 and
    `uses` between 30,979 and 31,063. Every count here should be read as
    `value ± spread`, and the spread is a property of the concurrent production
    path, not of the corpus or the analyzer: every walk is digest-pinned and every
    walk prints "unchanged". The quantities the verdict rests on do not move —
    `implements` reads 0 and `overrides` reads 48 in all five.
    It is not only the totals that move. The resolution audit's **tree-only**
    column — the one a reader would act on — read **127** on a degraded walk and
    **90** on a clean one, with callable declaration recall 99.4% against 100.0%,
     because 650 published symbols went missing. A defect count that moves by 37
     when the box is busy is not yet a defect count; the committed artifact is the
     clean run and the other is named in the table rather than deleted.
25. **The digest pin covers the analyzer and NOT the production entry point, and this
    document did not say so until it had been measured.** Every number here is pinned
    to `sha256(src/ast/real-nim-analyzer.ts)`, printed before and
    after each walk — `9d9ee478e3295c28` for the artifact set quoted below, and
    `1475e53d0e528d0a` for the verdict table, six-questions table and resolution
    table. `parseFile` is imported from `src/ast/pool-worker.ts`, which is
    production code this lane does not own, and **a digest of the analyzer is not a
    digest of the pipeline that runs it.** The base's copy of that file has since
    changed, and the A/B in *Session 5* is the measurement of what the gap was worth:
    **+0 edges on all ten types, +72 symbols, and the callable residue 11 → 4.** So the
    edge table happened to be insensitive to it and the resolution figures were not,
    which is the shape of the risk — a pin that covers the file you own and not the
    file you depend on can be simultaneously sufficient and misleading, and nothing
    about printing `unchanged` on both sides of a walk would have revealed it.
    Two consequences are stated rather than left implicit: the symbol counts
    (110,060 / 110,076) and the residue of 11 are properties of *this branch's*
    `pool-worker.ts`, and under the base's they are 110,148 and 4. The one-line remedy
    for the next lane is to hash the transitive production imports, not just the
    analyzer, and to print the hash of every file in that closure.
26. **One regex remains in this lane, and it is a probe that decides nothing.**
    The analyzer itself holds none — 0 `RegExp`, 0 `.match(`, `.replace(`, `.test(`,
    0 `.split(/…/)`, 0 regex literals, and `verify-regex-census.ts` names nim nowhere.
    `nim-ruled-probe.ts:246` does run a regex over corpus source text, and it is kept
    deliberately: it is a **non-instrument** whose every hit is then classified by the
    node it sits in, and its purpose is falsifiability — `nim/compiler/parser.nim`
    *quotes* the `conceptDecl` production inside a diagnostic string, so a text search
    finds it, and "a text probe would have found N and all N are prose" is a stronger
    statement than silence. A candidate-generating regex whose candidates are judged by
    a tree-sitter walk is the pattern the no-regex rule is aiming at, so this is
    recorded as a declared deviation with its reason rather than quietly deleted, and
    the supervisor may still rule it banned. The other regexes in the lane's census
    scripts operate on output paths, file extensions and captured stdout, never on
    corpus source.
27. **Two fields of the arbiter that is supposed to corroborate this lane's firing
    numbers are wrong by construction, so the corroboration is partial.** The edge
    counts, symbol counts and source direction it reports are sound and match this
    lane's census to the digit, but `analyzerDigest` reads `MISSING` for every lane in
    the fleet, `types[t].files` reports the last file's count instead of the union, and
    — the same scoping cause as the second one — its `published` set is rebuilt per
    file (`firing-check.ts:322`), so its **both-ends-resolution and source-direction
    columns are intra-file rates**. A reader who takes "10/10 fired" from this
    instrument is reading a number that survives all three defects; a reader who takes
    the per-type file counts, the resolution rates, or who believes any lane's digest
    tripwire is armed, is not. Full citations and the fixes — two of them one line each
    — are in *Session 5* and in
    `validation/m14/measurements/nim/session5-firing-check-defects.txt`.
28. **The corpus-wide resolution figures are a name match against a name universe, not a
    bind.** `resolution-scope.ts` widens the resolver from one file to 78,808 published
    name spellings, and `calls` goes from 38.9% to 98.2% — which is a real and important
    finding about scope, and it is still a *string* match. A name that appears in the
    corpus but is declared by a different symbol than the edge means is counted resolved,
    and Nim's name reuse (`config`, `emptyNode`, `c`, `map`, `name` — the 36
    same-file-ambiguous names in *The incoming direction*, of which `c` alone accounts
    for 23 edges) means name equality is a weak identity even inside one file. So 98.2%
    is an upper bound on what a graph walk can actually follow, and the gap between
    "resolves by name" and "binds to this declaration" is not measured by anything in
    this lane. Closing it needs the position- and scope-qualified identity the
    cross-language work is already carrying, not a wider name set.
29. **`imports` is the one type whose resolution figure rests on a heuristic rather than
    a match**, in both scopes and in both instruments. An `imports` target is a module
    path (`std/strutils`), not a symbol. `census.ts:149` treats every PATH SEGMENT of a
    corpus file's module path as a candidate module name — so a directory called `lib`
    makes `lib` resolvable — which is why the intra-file figure is 37.1% where a
    basename-only match gives 2.6%. `resolution-scope.ts` reproduces that rule rather
    than correcting it, so that it isolates one variable (the width of the universe) and
    not two, and the consequence is declared here instead: **38.6% is not a measurement
    of how many imports this analyzer resolves, it is a measurement of how many target
    strings collide with a corpus path segment.** No instrument in this lane resolves a
    Nim module path properly.

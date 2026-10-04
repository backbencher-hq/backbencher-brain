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
  for the differential; 12 pinned repos for the corpus measurement

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

| Spelling | Read from | Corpus occurrences |
| --- | --- | --- |
| `type A = concept x of B` | the grammar's `refines` field on `concept_declaration` | **0** |
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
`9d9ee478e3295c28`, over the same 4,555 files, except the three rows that name a
different instrument.** The pin is stated here because this table was the one
table in the document that carried no instrument: a per-type table was re-tied
to the digest and this one was not, so eleven of its cells drifted while the
rest of the document was corrected. The three exceptions say which instrument
they come from in the cell itself.

| Construct | Grammar node / spelling | Read as | Measured |
| --- | --- | --- | --- |
| proc / func | `proc_declaration`, `func_declaration` | `SymbolKind.function` + module-scope callable | 30,125 functions of 83,692 symbols; callable recall **34,452 / 34,466** |
| method | `method_declaration`, receiver from the first parameter | `SymbolKind.method` + `ownerName` = receiver | 177 methods; 48 `overrides` edges; 141 of 178 methods have a readable receiver |
| named nested routine | a `proc` lexically inside another | `SymbolKind.function`, `scope` = parent, `contains` from `metadata.nimNestedIn` | **653 → 14** tree-only `calls` targets on the committed blob, of which **9** survive the `csvbench.nim` hang (`resolution-audit`); 17 nested-routine `contains` families |
| iterator | `iterator_declaration` | `function`, **not** macro | `nim/contract` pins `{countUp, function}` |
| template | `template_declaration` | `macro` | `nim/contract` pins `{twice, macro}` |
| macro | `macro_declaration` | `macro` | 4,155 macros |
| macro / template body | the body of either | **suppressed** — expansion is not a declaration site | `nim/mac` + 4 forbids |
| object / ref object | `object_declaration`, `type_declaration` | `class` with `ref`, `struct` without | 840 classes, 4,221 structs |
| tuple type | `tuple_type` | `struct` | **defect 1 of the mutant round**: published as a bare `type` in both spellings, now pinned both ways |
| concept | `concept_declaration` | `SymbolKind.interface` | **216 in 69 files** |
| enum + members | `enum_declaration`, `enum_field` | `enum` + `enum_member` | 942 enums, 8,172 members |
| object field | `field_declaration` | `property` | 12,332 properties |
| const / let / var | `const_declaration`, `var_declaration` | `constant`, `variable`, `property` for `var` fields | 9,014 constants, 10,775 variables |
| type alias | `type_declaration` with a non-object body | `type` | 2,723 types |
| inheritance | `object_declaration.inherits` | `extends` | **941 occurrences accounted 941/941**; 570 edges (`gap-hunt`) |
| contract refinement | `concept_declaration.refines`, `x is B` in a body | `implements` | 0 of 216 concepts; `refinement_list` produced 0 times |
| instantiation | `bracket_expression` in callee position, `TypeName(field: v)` | `instantiates` | 2,998 constructions; 1,990 edges |
| call | `call`, `dot_generic_call`, parenless UFCS member leaf | `calls` | 79,129 edges |
| bare / member read | `identifier`, the leaf of a non-callee `dot_expression` | `uses` | 31,063 edges |
| declared type | parameter, return, field, annotation, `new`/`of` operand | `references` | 40,559 edges |
| import | `import`, `from … import`, `include` | `imports` + the `ImportInfo[]` channel | 9,345 edges; 179 `export_statement` and 31,408 `exported_symbol` nodes also enumerated |
| export | `export` OPERANDS, positionally | `exports` | 408 edges |
| the `*` marker | `exported_symbol` | **no edge** — `visibility: "public"` + `metadata.exported` | 31,408 sites in 1,500 files |
| `static:` / doc-example bodies | `static` block, `runnableExamples` argument | `type` declarations **published**, `value` declarations suppressed | 9 → 6 tree-only `extends` owners |
| destructor / sink hooks | `=destroy`, `=sink`, `=copy` | hook, not a runtime call — **filtered as a builtin** | named in the oracle's unexplained set and adjudicated |
| accent-quoted operator | `` proc `-!` ``, `` `==` `` | an ordinary declaration | **1,417** declaration sites (`accent-quoted-endpoints`); 366 of its edges are deleted by the shared filter (*Limitations* 12) |
| do-pragma | `expr.#[…].#` | **not read** — the grammar consumes it as a block-comment extra | 16 affected corpus files; the grammar patch is measured harmful and stays unapplied (*Limitations* 1) |

Three constructs are read and deliberately produce NO edge, each with the count
that says so rather than an assertion: the `*` marker (31,408 sites), concept
SATISFACTION (no syntax names it), and a macro/template body (expansion is not a
declaration site).

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
re-runnable). **Corpus: 4,555 tracked files over 7 repositories** — `nim` 3,968,
`nim-lang-nimble` 435, `graphql-nim` 55, `nimterop` 45, `dom96-jester` 19,
`bigints` 21, `Aporia` 12 — sampled by `git ls-files` +
`detectLanguageFromPath === "nim"` + a 512 KB cap, which is the arbiter's own
walk, so the file set is the same set. 83,692 symbols, 0 empty names, 0 empty
kinds, 0 edge types outside the ten, 0 empty endpoints.
Artifacts: `validation/m14/measurements/nim/ontology-census.{json,txt}`.

**EVERY NUMBER IN THIS SECTION IS AGAINST A COMMITTED BLOB, not a working
tree.** `census.ts` prints `sha256(src/ast/real-nim-analyzer.ts)` before the walk
and again after it, so a run that says "unchanged" is internally consistent, and
this one does:

| | blob / digest |
| --- | --- |
| `analyzer/NIM` @ `647a08e3c` | the commit that INTRODUCED the measured blob of `src/ast/real-nim-analyzer.ts`, sha256 `9d9ee478e3295c28…`, unchanged on disk through HEAD |
| `analyzer/NIM` @ `c12d7c7c1` | the PREVIOUS measured blob, sha256 `a59574036eb9f7fb…`, unchanged on disk from `c12d7c7c1` through `469ecd1af`. Every artifact recorded against it has been re-measured; `ruled-gate-run-2.txt` and `node-identity-ab.txt` are the only two that quote it, and both say so |

The commit is named as the one that introduced the blob rather than as the HEAD at
writing time, because a digest identifies a blob and a blob has an introducing
commit. Measured: `git log --format=%h -- src/ast/real-nim-analyzer.ts` with
`sha256sum` over each commit's copy gives `647a08e3c 9d9ee478e3295c28`,
`c12d7c7c1 a59574036eb9f7fb`, `47faa4238 b9a73cfda9d826a3`,
`ad9edcd72 37112977bad16542`, `3dcd4af14 f17b972273aa923d` — so `647a08e3c` is the
commit whose analyzer is the one every number below was measured on.

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

| Relationship type | Emitted? | Verdict | Measured on this corpus | Where the number comes from |
| --- | --- | --- | --- | --- |
| **all ten, one row each** | 10 of 10 examined | **9 EMITTED + 1 implemented-and-measured-absent** | **184,691 edges over 83,692 symbols** | `validation/m14/measurements/nim/ontology-census.txt`, digest-pinned on both sides of the walk |
| `calls` | YES | EMITTED | 79,129 edges | `collectCallsAndUses`: the callee branches plus the parenless-UFCS member-leaf branch |
| `uses` | YES | EMITTED | 31,063 edges | `collectCallsAndUses`, the member-leaf and bare-identifier read branches |
| `contains` | YES | EMITTED | 21,579 edges | `collectContainment`, from `ownerName` and from `metadata.nimNestedIn` for a nested routine |
| `references` | YES | EMITTED | 40,559 edges | `collectDeclaredTypeRefAt`, the declared-type sites |
| `imports` | YES | EMITTED | 9,345 edges | `readImportStatement` / `readImportFromStatement` / `readIncludeStatement`, plus the `ImportInfo[]` channel |
| `instantiates` | YES | EMITTED | 1,990 edges | `collectInstantiationAt`, a call whose callee is a type this file declares, plus the type argument of a `new` expression |
| `extends` | YES | EMITTED | 570 edges | `collectInheritance`, from `object_declaration.inherits`, minus the compiler's own roots |
| `implements` | YES | **implemented, corpus-measured absent** | **0** edges, 216 `concept_declaration` in 69 files examined, 0 refinements | `collectContractRefinement`, from `concept_declaration.refines` and from `is X` in a concept body |
| `overrides` | YES | EMITTED | 48 edges | `collectOverrides`, receiver-qualified `Receiver.method`; the cross-file family additionally needs `overrideCompanion` |
| `exports` | YES | EMITTED | 408 edges | `readExportStatement`, one edge per OPERAND of `export`, with `except` read positionally as what does NOT leave |

| Type | Verdict | Edges | Both ends resolve | Confidence | evidenceClass |
| --- | --- | --- | --- | --- | --- |
| `calls` | EMITTED | 79,129 | 39.4% | 0.85 (75,726) / 0.9 (3,349) / 0.75 (54) | `usage_contextual` 79,075, `import_based` 54 |
| `uses` | EMITTED | 31,063 | 99.7% | 1.0 (15,071) / 0.75 (15,992) | `usage_contextual` 31,007, `import_based` 56 |
| `contains` | EMITTED | 21,579 | 99.8% | 1.0 | `structural` |
| `references` | EMITTED | 40,559 | 46.1% | 0.9 | `reference_qualified` 34,393, `import_based` 6,166 |
| `imports` | EMITTED | 9,345 | 44.4% | 1.0 | `import_based` |
| `instantiates` | EMITTED | 1,990 | 100.0% | 0.9 | `usage_contextual` |
| `extends` | EMITTED | 570 | 70.9% | 1.0 | `structural` |
| `exports` | EMITTED | 408 | 3.9% | 1.0 | `structural` |
| `overrides` | EMITTED | 48 | 100.0% | 1.0 | `structural` |
| `implements` | **implemented, corpus-measured absent** | **0** | — | 1.0 | `structural` |

**184,691 edges. 0 below 0.7 from this analyzer.** One `calls` edge sits at 0.5 with
no `evidenceClass`, and it is not this analyzer's: it comes from the regex fallback
in shared `pool-worker.ts` described in *Limitations* 11, which is a §8 report and
is counted here so the table is not read as claiming a clean 0. Symbol hygiene on
the same walk: 83,692 symbols, **0** empty names, **0** empty kinds, **8** endpoints
equal to the literal `unknown` (*Limitations* 9), **0** empty endpoints, **0** edge
types outside the ten. This walk was CLEAN — `parseFile threw: 0`, `raw-parse threw:
0`, exit 0 — so the 21 empty kinds earlier revisions of this document reported were a
degraded walk, not a property of the analyzer; *Limitations* 8 says what causes them.

### How the arbiter itself now reports these ten

`npx tsx script/m14/ontology-coverage-gate.ts nim` **exits 2** — it walks all
4,555 files through `parseFile` and then refuses to print a verdict, because
`RULED_BY_LANG` in the shared gate carries `bash`, `json`, `lua` and `toml` and
no `nim`. That is the gate behaving correctly and it is measured, not quoted:
`validation/m14/measurements/nim/ruled-gate-run.txt` is the run.

This lane's table is `script/m14/nim-ruled.ts` and it has **one** row
(`implements`), because the gate checks `observed` first and a row for an
EMITTED type would be dead configuration asserting something false.
`validation/m14/fixtures/nim/ruled-gate.ts` applies the supervisor's two-line
wiring to a COPY of the gate in `/tmp` and runs the copy. Its output:

```
corpus: 4555 admitted files

type          status            detail
------------------------------------------------------------------------------------------------------------------------
calls         EMITTED           79,006 edges in 4+ files, e.g. Aporia/aporia.nim, Aporia/processes.nim
uses          EMITTED           31,063 edges in 4+ files, e.g. Aporia/aporia.nim, Aporia/processes.nim
contains      EMITTED           21,579 edges in 4+ files, e.g. Aporia/aporia.nim, Aporia/processes.nim
imports       EMITTED           9,336 edges in 4+ files, e.g. Aporia/aporia.nim, Aporia/processes.nim
references    EMITTED           40,559 edges in 4+ files, e.g. Aporia/aporia.nim, Aporia/processes.nim
exports       EMITTED           406 edges in 4+ files, e.g. dom96-jester/jester.nim, graphql-nim/graphql.nim
extends       EMITTED           570 edges in 4+ files, e.g. Aporia/cfg.nim, Aporia/gtksourceview.nim
implements    RULED-SOUND       NOT EMITTED; the construct occurs 0x on the parse tree.
                                Written ruling: script/m14/nim-ruled.ts (RULED_BY_LANG.nim)
overrides     EMITTED           48 edges in 4+ files, e.g. nim/lib/pure/logging.nim, nim/lib/pure/unittest.nim
instantiates  EMITTED           1,990 edges in 4+ files, e.g. Aporia/CustomStatusBar.nim, dom96-jester/jester.nim
------------------------------------------------------------------------------------------------------------------------
emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0

== NIM_IMPLEMENTS_EXAMINED (from THIS run) ==
  conceptsExamined                  174
  withRefinesField                  0
  isExpressionsInConceptBodies      156
  refinements                       0
exit code 0  (324s)
analyzer sha256 across the child's walk : 9d9ee478e3295c28  (unchanged)
```

The gate's own corpus line is in that block for a reason. It read
`corpus: 4101 admitted files` until this pass, and the same stale figure was
quoted in `script/m14/nim-ruled.ts`'s own header — the file whose `describe`
string the arbiter prints. That text also carried the nine emitted counts from
the same superseded 4,101-file walk (73,234 / 29,196 / 19,323 / 38,170 / 8,004 /
1,905 / 547 / 376 / 48, every one low because the omitted repos, `nim-lang-nimble`
at 435 files and `dom96-jester` at 19, are real Nim), the wrong file count for the
probe's population (74 files against the pinned 69), a claim that the `is` spelling
had "5 same-file concept-naming sites" where the pinned probe measures **0**, and
an artifact path pointing at a directory that has now been deleted. All of it is
re-pinned to `ruling-probe.json`, and the gate re-run to prove the corrected row
still prints `RULED-SOUND` with `refinements 0` over `conceptsExamined 174`.

**A ruling is the one artifact in a lane that a reader is most likely to trust
without re-running, because it is a conclusion rather than a count — and it was
the artifact here that had drifted furthest from its own evidence.**

So the coverage figure is **9 emitted + 1 measured-absent = 10 of 10
applicable**, and the two halves of that sentence come from different sources:
the numerator from what measurably fires, the denominator from a parse-tree
measurement of non-applicability. It is not 10/10 emitted, and reporting it as
such would be the claim-without-coverage class the workstream exists to stop.

**The arbiter was then run a SECOND time over the same corpus with the same
command, because one run of an instrument cannot measure the non-determinism this
section goes on to claim.** Five walks are now on record, two of them the same
instrument over the same files, and they put the spread at:

| type | arbiter, PRE-fix run 1 | arbiter, PRE-fix run 2 | census, PRE-fix | spread | arbiter, POST-fix | census, POST-fix |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | 79,117 | 79,047 | 79,129 | **82** | 79,128 | **79,129** |
| `uses` | 31,058 | 30,979 | 31,063 | **84** | 31,063 | **31,063** |
| `contains` | 21,515 | 21,558 | 21,579 | **64** | 21,578 | **21,579** |
| `imports` | 9,335 | 9,334 | 9,345 | **11** | 9,345 | **9,345** |
| `references` | 40,548 | 40,537 | 40,559 | **22** | 40,559 | **40,559** |
| `exports` | 408 | 408 | 408 | **0** | 408 | **408** |
| `extends` | 570 | 570 | 570 | **0** | 570 | **570** |
| `overrides` | **48** | **48** | **48** | **0** | **48** | **48** |
| `instantiates` | 1,989 | 1,988 | 1,990 | **3** | 1,990 | **1,990** |
| `implements` | **0** | **0** | **0** | **0** | **0** | **0** |

The two PRE-fix columns are `validation/m14/measurements/nim/ruled-gate-run-2.txt`
(one walk) and the PRE-fix census arm of `node-identity-ab.txt`; the POST-fix pair
is `ruled-gate-run.txt` and `ontology-census.txt`, both pinned to `9d9ee478e3295c28`.
Every run prints its own verdict row and every one of them reads
`emitted 9/10 ruled-sound 1 FALSIFIED 0`.

The cause is *Limitations* 11 and 17: all five walks are over the same 4,555 files
at 6 workers, the production path is non-deterministic under concurrency, and the
WASM parser loses a load-dependent set of files to heap exhaustion. All five are
digest-pinned and all five print "unchanged", so the difference is the walk, not
the analyzer.

**The rows that do not move are the rows the verdict rests on.** `implements`
reads 0 and `overrides` reads 48 in all five walks, and after the fix the POST-fix
pair agrees to **within 1 edge on every one of the ten types** — so the spread
above is a property of the walk, not evidence that the fix moved anything. The
two degraded walks this pass caught and discarded are named: an early census with
2 empty-kind symbols (−16 edges against its clean twin) and an early
resolution-audit with 127 tree-only edges against the committed 90. Both were
re-run; both artifacts on disk are from clean walks that exited 0.

**This is the one place in this document where two numbers for the same quantity
appear side by side**, and neither is corrected to match the other: each is correct
for its own walk, and the honest statement is that `calls` is `79,129 ± ~40` and
`uses` is `31,063 ± ~40` at this corpus size and worker count, not five-digit
facts.

### `implements`: implemented, and measured absent on this corpus

**This is not a claim that Nim lacks the construct.** Nim HAS it, in two
spellings, and this analyzer reads BOTH:

```
type A = concept x of B     # the `of` form  — collectContractRefinement
type A = concept x
  x is B                    # the `is` form  — collectIsFormRefinement
```

`nim/compiler/parser.nim:2268` states the production
(`conceptDecl = 'concept' COMMENT? (conceptParam ^* ',')? pragma? ('of' typeDesc ^* ',')?`)
and implements it at :2275 and :2291 (commented "new-styled `concept of A, B` on
the same line"), and `nim/doc/manual_experimental.md:1205-1213` documents the two
spellings as alternatives for one fact. So the honest reading of the 0 is
**"absent from these 4,555 files"**, never "not implemented" and never "not in
the language". The reader is pinned by 6 fixture edges across both spellings and
4 forbids.

The measurement, from `validation/m14/fixtures/nim/nim-ruled-probe.ts` (artifact
`validation/m14/measurements/nim/ruling-probe.json`):

| Probe | Count | Files |
| --- | --- | --- |
| **Instrument A** — distinct node types the pinned wasm produces | **209** | 4,555 |
| …`concept_declaration` among them | **216** | 69 |
| …`refinement_list` among them | **0** | 0 |
| **Instrument B** — `concept_declaration` | **216** | 69 |
| …carrying a `refines` field (the `of` spelling) | **0** | 0 |
| `is X` expressions inside a concept body | 156 | — |
| …whose LEFT is a bare concept formal parameter | 13 | — |
| …whose RIGHT names a concept THIS FILE declares | **0** | — |
| **REFINEMENTS — the hit condition** | **0** | **0** |

**Instrument A is the wrong instrument here and the row says so.** A is right
when the construct needs a node type the grammar does NOT have (json's function
call, zig's supertype clause). Here `concept_declaration` is present 216 times, so
an inventory read finds the interface-like construct and says nothing about
whether anything REFINES one — this is json's `exports` history exactly, where a
grammar cannot see a relation, only a shape.

**The text probe is reported as a non-instrument, with its hits classified.** A
loose search for the `concept … of` shape returns **7 hits**: 6 sit wholly inside
`comment` nodes, and the 7th — `nim/tests/concepts/tspec.nim:23`,
`Hashable = concept   ## the most basic of identity assumptions` — is classified
`code` only because the match CROSSES from the code token `concept` into a `##`
comment that contains the word "of". `nim/compiler/parser.nim:2268` and `:2276`
quote the `conceptDecl` production itself. A text search would have overturned a
correct ruling seven times.

**Falsifying probe.** Any non-zero `refinements` count from
`countNimImplementsConstruct` in `script/m14/nim-ruled.ts`, on any corpus — the
arbiter flips the row to FALSIFIED and fails with no human in the loop. The
probe's counter, read from the run that produced the verdict above (an epilogue,
because the export is module state and the child process owned it):
`conceptsExamined 174`, `withRefinesField 0`, `isExpressionsInConceptBodies 156`,
`refinements 0`. `conceptsExamined > 0` with `refinements = 0` is the difference
between a probe that examined the corpus and one that examined nothing — and it
is the number that makes the ruling falsifiable rather than decorative. The
second half of the overturn condition, an `is X` whose X is a concept in a
DIFFERENT file, is stated and not implemented, because the gate hands a walk one
root at a time; that half's cost is measured at **0 occurrences** (all 13 guarded
`is` sites name `int`, `string`, `U`, `PrimitiveBase`, `IntegerBase`, `IdBase` or
a concrete type) and is carried by the corpus-wide census.

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

| | before | after |
| --- | --- | --- |
| `calls` edges whose target is declared on the tree and published nowhere | 653 | **17**, re-measured **14** on the committed blob |
| callable declaration recall (tree declarations vs published symbols) | 97.5% | **99.97%** (34,455 / 34,466), re-measured **100.0%** (34,452 / 34,466) |

Two numbers per cell because they are two walks: 17 / 34,455 is the fix-time run
and 14 / 34,452 is `validation/m14/measurements/nim/resolution-audit.json` on
blob `9d9ee478e3295c28`, which is the pinned one. The residue is **14**
declarations on the pinned walk, of which **5** are the `csvbench.nim` hang and
**4** are `proc _` — Nim's discard name, suppressed on purpose. The defensible
analyzer defect is therefore **9**, and 653 → 9 is the honest shape of this fix,
not 653 → 0.

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
Over the same 4,555 files:

| type | edges | local | module stem | builtin | declared in another corpus file | **tree-only** | external |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | 79,088 | 39.4% | — | — | 58.1% | **14** | 2.4% |
| `uses` | 31,035 | 99.8% | — | — | — | 53 | 0.1% |
| `contains` | 21,568 | 99.8% | — | — | — | 23 | — |
| `imports` | 9,339 | 0.1% | **88.7%** | — | 2.1% | 0 | 9.1% |
| `references` | 40,551 | 46.1% | — | 1.7% | 49.9% | **0** | 2.3% |
| `exports` | 408 | 3.9% | — | 0.5% | 70.8% | 0 | 24.8% |
| `extends` | 570 | 70.9% | — | — | 28.4% | 0 | 0.7% |
| `overrides` | 48 | **100.0%** | — | — | — | 0 | — |
| `instantiates` | 1,989 | **100.0%** | — | — | — | 0 | — |

The **tree-only** column is the defect column: the target IS declared on a corpus
parse tree and no symbol with that name was published anywhere. It is **90 edges**
across the whole corpus — `calls` 14 + `uses` 53 + `contains` 23, and 0 on the
other seven types — and it resolves to **four** distinct names, not five:
`destructor`, `root`, `me`, `super`. Two of the four (`destructor`, `super`) are
templates whose `contains` edge the production filter deletes (*Limitations* 12).
Callable declaration recall over the same walk is **34,452 of 34,466 = 100.0%**.

**This paragraph previously named five names — `destructor`, `root`, `me`, `super`,
`localPassCAnswer` "plus `_`" — and two of those appear nowhere in the committed
artifact.** They are residue of the earlier 127-edge walk. The artifact's own
`TREE-ONLY` lines name exactly `calls: destructor root me super`,
`uses: root`, `contains: root destructor me`, and the union is those four.
Correcting a name list against the file that prints the names is the whole
method; a prose list that outruns its instrument is how a reader ends up chasing
a declaration that was never missing.

**The artifact pair carries THREE different counts for the same list, and the
reader needs all three.** `resolution-audit.txt` prints the header
`callable: 14 shown` and then lists **12** rows; `resolution-audit.json` carries
**10** `unpublishedExamples`; and the recall row counts **14** unpublished. The
count is 14 and the two lists are truncated at different depths, so "all ten
unpublished names are printed", which an earlier revision of this paragraph said,
was false twice over. The 12 rows the text file does print are in it.

**5 of the 14 come from one file, and that file is the one the same run reported
`[BB-HANG]` on.** `nim/tests/benchmarks/strings/csvbench.nim` contributes
`makeName`, `makeUrl`, `csvPath`, `writeCsv`, `parseAndMaterialize` — a hung
parse publishes none of its declarations, so its 5 are the walk degrading rather
than the analyzer missing them. The *defensible* tree-only figure for
`calls` is therefore **9**, not 14, and that is the number to quote as an analyzer
defect. The 90 total has the same 5 in it, so its clean-walk value is **85**.

**This column is the one that moves with the walk, so it is worth saying which walk
this is.** An earlier resolution-audit run on the same corpus and the same analyzer
read **127** tree-only edges (calls 53, uses 52, contains 22) and put callable
recall at 34,273 / 34,466 = 99.4%, because it published 83,041 symbols against the
committed walk's own 83,691 — 650 symbols lost to the load-dependent parse failures in
*Limitations* 8. That instrument reads **83,691** where the census reads
**83,692** on the same walk and the same blob; a 1-symbol difference between two
instruments that enumerate the published set slightly differently (0.001%), named
here because two numbers for one quantity in one document is the defect this
document exists to catch, and it is not a walk difference — both walks are pinned
to `9d9ee478e3295c28`. A defect count that moves by 37 when the walk degrades is
not a
defect count a reader can act on, so the committed artifact is the clean run and the
degraded one is recorded here rather than deleted. Both are reproducible: the same
command on a loaded box gives the larger number.

`exports` at 3.9% local is not a defect and the table says why: `export foo` names
something the file **imported**, so the target lives in another module by
construction. 70.8% of them are published by another corpus file and 24.8% are
outside it.

### The extends delta, accounted to 941/941

`validation/m14/fixtures/nim/gap-hunt.ts` walks every `object_declaration.inherits`
on the corpus parse trees and buckets each one. 941 occurrences:

| bucket | count | what it is |
| --- | --- | --- |
| published as `extends` | **570** | the edges |
| compiler root (`of RootObj` / `RootRef` / `Object`) | 361 | a name with no referent anywhere; emitting an edge to it guarantees a dangling row |
| self-named (`type X = object of X`) | 2 | a self-reference, not a supertype — both in `tests/objects/tillegal_recursion{,2}.nim` |
| owner symbol not published | 6 | *Limitations* 13 |
| **unmatched** | **2** | both named below |
| **accounted** | **941 / 941** | |

The two unmatched are `nim/tests/objects/tillegal_recursion3.nim`'s
`Foo of ref Foo` — a compiler-*rejection* test file, where `ref Foo` is `Foo` and
the analyzer's self-name filter is right — and
`nim/tests/overload/toverload_issues.nim:59`'s `B of A`, where `B` is declared
**twice** in one file (`type B = A[int]` at :165 and `type B = object of A` at :59)
and name-keyed publication keeps one of them, so the other's base is lost. That is
the same name-collision shape the incoming walk reports as an ambiguous target,
seen from the source side, and it is stated here rather than smoothed over.

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

Columns 1, 2, 5 and 6 are this pass's census (4,555 files, 6 workers, analyzer
sha256 `9d9ee478e3295c28` = `analyzer/NIM` @ `647a08e3c`; the worker count matters,
see the note above the verdict table). Column 3 is the oracle cross-check (400
files, deterministic every-10th), whose sample is
named below and whose instrument is a SEPARATE WALKER — so "agrees" means "the two
derivations agree", never "the edge is true". Column 4 is adjudicated per type.

| Type | 1 Exists | 2 Fires | 3 Correct (oracle) | 4 Labelled | 5 Resolved | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 79,129 | 2,519 vs 2,527; 0 missing, **13 unexplained** | yes | 39.4% | 100% under 1.0; `usage_contextual` |
| `uses` | yes | 31,063 | 825 vs 826; 0/1 | yes | 99.7% | 51.5% at 0.75, rest 1.0 |
| `contains` | yes | 21,579 | 995 vs 998; 0/**4** | yes | 99.8% | 1.0, `structural` |
| `imports` | yes | 9,345 | 349 vs 349; 0/0 | yes | 44.4% | 1.0, `import_based` |
| `references` | yes | 40,559 | 624 vs 622; **3 missing**, 0 unexplained | yes | 46.1% | 0.9, `reference_qualified` |
| `instantiates` | yes | 1,990 | 124 vs 124; 0/0 | yes | 100.0% | 0.9, `usage_contextual` |
| `extends` | yes | 570 | 30 vs 30; 0/0 | yes | 70.9% | 1.0, `structural` |
| `overrides` | yes | 48 | 3 vs 3; 0/0 | yes | 100.0% | 1.0, `structural` |
| `exports` | yes | 408 | **no oracle derivation exists** (20 targets unaudited) | yes | 3.9% | 1.0, `structural` |
| `implements` | yes | **0** | no oracle, and 0 edges | yes | — | 1.0, `structural` |

**Question 5 is the one this pass moved, and the movement is the result.** The
`Resolved` column is a rate against the file's own symbol set; the *resolution
audit* above splits the same edges into local / another-file / builtin / tree-only
/ external, and `calls` at 39.4% local is 58.1% declared in another corpus file and
2.4% genuinely external. Before this pass the same measurement read 653 `calls`
edges in the **tree-only** bucket — a declaration the tree carried and the analyzer
published nowhere — and it now reads **14**, the `calls` cell of the resolution
table above. The **90** in that table is the whole-corpus figure, and it is
`calls` 14 + `uses` 53 + `contains` 23.

An earlier revision of this paragraph read **15** for that cell, which is neither
14 nor 90 and matches no artifact. It was a transcription of the `uses` row into
the `calls` sentence; the artifact is the authority and it says 14.

**Question 6, and the one edge below 0.7.** This analyzer emits **0** edges below
0.7 on every type, so nothing in the lane is a heuristic by the honesty contract
§4's line. It emits exactly one edge at 0.5 with no `evidenceClass`, and that edge
is produced by shared `pool-worker.ts`'s regex fallback, not here — see *Limitations*
11. The count is stated rather than omitted because a table claiming a clean zero
would be claiming something the pipeline does not deliver.

**Question 2 — fires.** All nine fire on thousands of edges, and the arbiter's own
verdict loop confirms it independently of this lane's census (§ above). The
tenth reads 0 and the zero is dissected above rather than asserted.

**Question 3 — correct, and its limit.** Instrument:
`validation/m14/fixtures/nim/oracle-crosscheck.ts` over a deterministic
every-10th sample against `script/m14/nim-truth-oracle.ts`'s `deriveNimEdges`,
compared site-agnostically (label + normalized target). **The limit is stated
because it is real: both sides walk the same grammar, so a grammar fact both get
wrong is invisible to it.** "Agrees" means "the two derivations agree", never
"the edge is true".

The cross-check is now digest-pinned like the census
(`validation/m14/measurements/nim/oracle-crosscheck.{json,txt}`,
`9d9ee478e3295c28`, 400 of 4,075 discovered files, deterministic every-10th, 400
parsed, 0 parse failures, 0 oracle throws), and the artifact it replaces was named
`oracle-crosscheck-workingtree.*` and read **MISSING 149 / UNEXPLAINED 32** — a
working-tree measurement that was still being cited. The pinned run reads:

**MISSING 23, UNEXPLAINED 18**, and both directions are accounted:

| Type | analyzer | oracle | missing | unexplained | reading |
| --- | --- | --- | --- | --- | --- |
| `calls` | 2,519 | 2,527 | 0 | 13 | 9 of the 13 are the accent-quoted operator targets the production filter deletes (*Limitations* 12); `=destroy` ×5 and `=sink` ×1 are hook operators; `cast` is a macro-built call |
| `uses` | 825 | 826 | 0 | 1 | `uses -> type` at `nim/tests/manyloc/named_argument_bug/gui.nim`, an object field literally named `type` |
| `contains` | 995 | 998 | 0 | 4 | 3 are `` contains -> `-!` ``, `` contains -> lhs `` ×2 — the same filter; 1 is `contains -> type` in the same `gui.nim` |
| `imports` | 349 | 349 | 0 | 0 | exact agreement |
| `references` | 624 | 622 | 3 | 0 | `asyncjs.nim -> impl`, `-> default`, `taliassyntax.nim -> U` |
| `exports` | 20 | 0 | 20 | 0 | the oracle derives **no** `exports` target at all, so all 20 are unaudited — a DERIVATION finding, not 20 defects |
| `extends` | 30 | 30 | 0 | 0 | exact agreement |
| `overrides` | 3 | 3 | 0 | 0 | exact agreement |
| `instantiates` | 124 | 124 | 0 | 0 | exact agreement |
| `implements` | 0 | 0 | — | — | neither emits any |

So **5 of the 10 types agree exactly on a 400-file sample, 4 disagree only where a
named shared-machinery defect or a recorded ambiguity explains the difference, and
`exports` has no second opinion at all.** The `references` 3 are the recorded
`BlenderRgb[Rgba8]`-style ambiguity (a name in a type-argument position reading as
a value index); each is named with its file in the artifact.

**Question 4 — labelled.** The two confusions this ontology actually risks in Nim
are both adjudicated with a number rather than a claim. `extends` vs `implements`:
the `of` clause is read two ways by two node types — `object_declaration.inherits`
(941 occurrences, 347 files) is nominal and is `extends`; `concept_declaration.refines`
(0 occurrences) is structural and is `implements`; publishing a refinement as
`extends` is caught by the mutant `nim/concept-refinement-labelled-extends`
(0 → 7 problems). `calls` vs `uses`: the callee leaf is excluded from the `uses`
pass, and the mutant `nim/star-marker-promoted-to-an-exports-edge` covers the
`exports` boundary. `exports` vs `contains`: the `*` marker (31,408 occurrences,
1,500 files) is a VISIBILITY modifier on a local declaration, not a re-export;
counting it as `exports` is the mutant above.

**Question 5 — resolved, and the low rates are the finding.** `calls` at 39.4%
and `references` at 46.1% are cross-module targets: a Nim file calls and names
types declared in the 3,968-file compiler and its libraries, and the census
resolves endpoints against the symbols of the file's own draw, so a cross-file
target reads as unresolved here and resolves in a full index. The diagnosis is in
the census output rather than asserted — the top unresolved `calls` targets are
`add(2642)`, `doAssert(2088)`, `defined(1459)`, `len(577)`, `skipTypes(483)`, and
the top `references` targets are `PNode(2285)`, `PSym(984)`, `PType(941)`,
`PContext(675)`, all compiler-internal types from other modules. `exports` at 3.9%
is the same fact BY CONSTRUCTION and is the sharpest case: its targets are
re-exports of names declared in ANOTHER module, so a low rate is the honest
reading of a correct edge. The CSS `references` reference point (66.8%) sits
between the two classes. `overrides` (100.0%), `instantiates` (100.0%),
`contains` (99.8%) and `uses` (99.7%) sit at the other end: their targets are
declared in the same file by construction, so those four rates are the ones a
regression in publication would actually move.

**Question 6 — confident, in one number.** **0 of 184,691 corpus edges fall
below 0.7**, so nothing in this lane is a heuristic by the honesty contract §4's
0.7 line, and the ratio is countable rather than a vibe. The sub-1.0 edges are a
different thing and are countable by type — `calls` 0.85 (usage-inferred callee,
75,726) and 0.9 (3,349), `imports`-qualified `calls` 0.75 (54), `uses` 0.75
(15,992 = 51.5% of that family) with the rest at 1.0, `references` 0.9 (40,559),
`instantiates` 0.9 (1,990), `overrides` companion edges 0.9.

### DERIVATION debt

`script/m60/rel-type-coverage-gate.ts --langs=nim` reports **6 un-audited**:
`calls`, `contains`, `exports`, `imports`, `references`, `uses` — and names each
one "stored and compared against nothing". Two things about that number are worth
more than the number:

1. The gate's count **understates** the debt by 4. Its audited set for nim is
   `["extends","implements","instantiates","overrides"]`, and that list comes from
   the language-agnostic DEFAULT branch of the differential's filter
   (`script/m14/differential.ts:23153`), not from nim oracle code. Measured, not
   quoted: `grep -c "nim-truth-oracle\|deriveNimEdges" script/m14/differential.ts`
   returns **0**. `deriveNimEdges` is exported from `script/m14/nim-truth-oracle.ts:330`
   and derives `extends` and `overrides` — the cross-check above measures 20-vs-20
   and 2-vs-2 — but nothing in the live harness runs it.
2. So the substantive debt is **10 of 10 until a nim oracle is wired into
   `script/m14/differential.ts`**, and the mechanical count is 6. Both are stated
   because reporting only the flattering one is how this class of gap survives.

This is a §8 report item, not a lane edit: `script/m14/differential.ts` is
supervisor-owned. What is needed is one import
(`import { deriveNimEdges } from "./nim-truth-oracle"`) and one branch that feeds
it for `lang === "nim"`, after which all ten types have a derivation and the six
DERIVATION findings repay.

## Corpus validation

| Repo | Files | What it is |
| --- | --- | --- |
| `nim` | 3,968 | the compiler and the whole standard library |
| `nim-lang-nimble` | 435 | the package tool's own source |
| `graphql-nim` | 55 | a GraphQL client |
| `nimterop` | 45 | the C FFI layer |
| `dom96-jester` | 19 | an HTTP test client |
| `bigints` | 21 | arbitrary-precision integers |
| `Aporia` | 12 | a GTK3 app |

**4,555 files across 7 repositories**, above the project's 200-per-family floor,
and the file set is the arbiter's own walk (`git ls-files` +
`detectLanguageFromPath === "nim"` + a 512 KB cap) rather than a hand-picked
list — so this lane's census and the shared arbiter measure the same set.

The corpus GREW this round, from 4,101 files over 5 repos: `nim-lang-nimble` (435)
and `dom96-jester` (19) are new. That is why every count in this section moved
and why the previous round's figures are not comparable without the repo list.

Four attempts in an earlier round to add a repository that REFINES A CONCEPT — the
one thing that would move `implements` off 0 — all failed: `vnen/gambit`,
`nim-lang/nimph`, `treeform/nim-regex` and `yardex/nim-confutils` return
"Repository not found" from a host where `git ls-remote
https://github.com/nim-lang/Nim` succeeds, so the names were wrong rather than
the network blocked. The `implements` verdict is therefore reported as measured
absent on a corpus of 4,555 files that contains 216 concepts, and NOT padded with
a synthetic file written to make a table look finished.

## Gates re-run on this pass, and what each one answered

Every row is a command, its exit code, and the number it produced. Nothing here is
quoted from an earlier round.

| command | exit | result |
| --- | --- | --- |
| `bun run script/m14/run-fixtures.ts --lang nim` | 0 | **10 fixtures, 10 pass, 0 fail.** Scoped run writes no evidence, by the runner's own guard |
| `bun run script/m14/mutate-analyzer.ts` (no scoping; the runner has none) | 2 | **58 nim mutants, 58 caught, 0 survived**, re-run on the `9d9ee478e3295c28` blob. Exit 2 is 6 survivors in OTHER lanes — `java/bare-read-type-attribution`, `groovy/modifier-return-type-loss`, `groovy/ctor-name-revert`, `scala/drop-import-source-rewrite`, `make/swallow-the-rule-after-a-comment`, `php/drop-external-override-guess`. It is also the producer of `M14.0.F4.json`, which the honesty gate flagged as stale the moment the analyzer blob moved and which this re-run clears |
| `npx tsx validation/m14/fixtures/nim/verify-mutants.ts` | 0 | 15 ontology-round mutants, 15 caught, 0 survived. Re-run on this pass: `clean run: 10 pass, 0 fail`, then **15 run, 15 CAUGHT, 0 survived**, closing on `all nim mutants caught — the gate can fail for this lane`. The 15 and the 0 are load-bearing: a mutant suite that catches nothing is indistinguishable from one that was never run |
| `bun run script/m14/run-fixtures.ts --lang nim` | 0 | **10 pass / 0 fail** (`{"nim":{"pass":10,"fail":0}}`), ending `fixture baseline gate: no regressions` and `all fixtures pass`. Scoped, so `M14.0.F3.json` is not touched and `--update-baseline` is refused — 46 lanes, this one selected |
| `bun run script/m14/verify-analyzer-docs.ts` | 0 | 48 analyzers: doc present 47/48, all 8 sections 19/47, no unexplained cells 35/48. **nim appears in none of the three lists** and in none of the 13 `(no relationship-ontology section)` entries (bash, clean, hcl, json, julia, lua, powershell, protobuf, r, ruby, solidity, vb, zig) |
| `npx tsx script/m14/differential.ts --lang nim` | 0 | **[lane] SKIP nim: no corpus repo mapped in `LANG_REPOS`** — measured 0 lanes, M14.0.F5 not written. *Limitations* 18 |
| `npx tsx validation/m14/fixtures/nim/ruled-gate.ts` | 0 | the arbiter's own verdict loop on a copy, run on both analyzer blobs: **emitted 9/10, ruled-sound 1, FALSIFIED 0, ruled-without-justification 0** every time, 204s / 203s / 247s across three runs, and the per-type spread is in the *How the arbiter itself now reports these ten* section. Re-run on this pass, **253s, exit 0, same verdict**: `calls` 79,099, `uses` 31,055, `contains` 21,575, `imports` 9,341, `references` 40,544, `exports` 408, `extends` 570, `overrides` 48, `instantiates` 1,986, `implements` RULED-SOUND. The four rows the verdict rests on — `exports` 408, `extends` 570, `overrides` 48, `implements` 0 — are **byte-identical to the committed census**, and the five that moved did so downward on a box running seven lanes, which is the same effect *Limitations* 8 measures. The probe counters printed by the run's own epilogue: `conceptsExamined 174`, `withRefinesField 0`, `isExpressionsInConceptBodies 156`, `refinements 0` — and the gate prints which of those is the falsifier: *"refinements is the number that would have made the row above print FALSIFIED"* |
| `npx tsx script/m60/rel-type-coverage-gate.ts --langs=nim` | **1** | **6 DERIVATION findings**: `calls`, `contains`, `exports`, `imports`, `references`, `uses`. CHECK 2/3/4 clean. An earlier revision of this row recorded exit **0**; re-running the command gives **1**, and the reason is in the gate's own last line — `process.exit(regressions.length === 0 ? 0 : 1)` (`script/m60/rel-type-coverage-gate.ts:614`). The 6 are printed under its own heading `REGRESSIONS (not in the recorded debt)`, so a non-zero exit is the gate's verdict on this lane, not a crash. Recording 0 would have been the gate table asserting a clean run the gate does not report. **It also DESTROYS the §8 artifact it writes when scoped** — see the four-gate table below |
| `npx tsx validation/m14/fixtures/nim/census.ts` | **1**, then **0**, then **1** ×3 | run six times. First exit 1 on the new blob (degraded: 2 empty-kind symbols, 184,675 edges). Second exit 0 but on the PRE-fix blob (184,691). Third exit 0 on the committed blob: **184,691 edges / 83,692 symbols / 0 empty names / 0 empty kinds**, artifact written and digest-pinned on both sides of the walk. The committed artifact is the third. The last three are this pass, all exit 1 and all degraded (34, 22, 18 empty kinds — *Limitations* 8), and the fourth of them is what the write-guard below was added for. **The command takes the output path as `argv[2]` and writes NOTHING without it**, so a bare invocation cannot touch the committed artifact either |
| the `census.ts` write-guard, itself | **1** | regression-tested on this pass, not asserted. Run against a scratch path with a deliberately degraded walk: exit 1, `DEGRADED WALK — 22 empty-kind symbols`, `REFUSING to overwrite …/guardtest.json`, and `guardtest.json` **was never created** while `guardtest.degraded.json` was. Run a second time against the real artifact path: exit 1, refused, `git status` clean, the committed `ontology-census.json` byte-identical. The guard fires on any of empty-kind symbols, empty names, a `parseFile` throw, a raw-parse throw, or a file count that did not parse — the five ways this walk is known to degrade |
| `npx tsx validation/m14/fixtures/nim/resolution-audit.ts` | **1** | both attempts; `[BB-HANG] parser stuck 120s on nim/tests/benchmarks/strings/csvbench.nim — exiting`, after the artifact was written. The two runs DIFFER where it matters: **127** tree-only edges and recall 34,273/34,466 = 99.4% on the first, **90** and 34,452/34,466 = 100.0% on the second. The committed artifact is the second; the first is named in the resolution table rather than deleted |
| `npx tsx validation/m14/fixtures/nim/accent-quoted-endpoints.ts` | **1** | `[BB-HANG]` on `nimterop/nimterop/build/ccompiler.nim`, after the artifact was written. 1,417 declaration sites, 366 edges deleted downstream — unchanged from the pre-fix walk, as it must be |
| `npx tsx validation/m14/fixtures/nim/gap-hunt.ts` | 1 | `[BB-HANG]` on `nim/lib/std/private/since.nim`, artifact written. extends accounted **941/941**, published as `extends` **570** |
| `npx tsx validation/m14/fixtures/nim/node-identity-reachability.ts` | 0 | arm 1 of the defect-5 A/B: 494 `type_declaration` nodes, `c === symDecl` TRUE **0**, `.id` equal **494**, spans equal **494** |
| `bun run validation/m14/fixtures/nim/verify-analyzer-hygiene-nim.ts` | 0 | the lane's own hygiene A/B: **0 findings on HEAD, reverted copy CAUGHT** by `bare-node-identity-comparison`. `bun` and not `npx tsx` because it imports the shared gate, whose module body uses `__dirname` (*Limitations* 23) |
| `npx tsx validation/m14/fixtures/nim/nim-ruled-probe.ts` | 0 | implements 0 refinements over 216 concepts |
| `npx tsx validation/m14/fixtures/nim/oracle-crosscheck.ts` | 0 | MISSING 23 / UNEXPLAINED 18 |
| `npx tsx validation/m14/fixtures/nim/ambiguity-split.ts` (×2 subtrees) | 0 | irreducible ambiguity 0.5% and 3.6% |
| `npx tsx script/m14/incoming-check.ts nim <files>` (×2 subtrees) | 0 | the two rows in the incoming table. Re-run on this pass over an 8-file spot check (4 of `lib/pure`, 4 of `compiler`), **1,142 symbols, 0 degraded parses, 0 parse failures**, as an independent corroboration of both rows rather than a replacement for them: `overrides` **14 edges / 7 distinct / 0 ambiguous / 0 unresolved** — the same 14/7/0 the 105-file `lib/pure` row reports, so all 14 are attributable to the `logging.nim`+`unittest.nim` pair — and **0 `overrides` edges** from the 4 compiler files, matching that subtree's 0. Per type on the spot check: `calls` 2,585 edges / 461 distinct / 148 ambiguous / 782 unresolved; `uses` 479 / 148 / 5 / 5; `contains` 129 / 113 / 15 / **0**; `references` 1,125 / 29 / 0 / 918; `exports` 14 / 1 / 0 / 13; `extends` 5 / 3 / 0 / 0; `instantiates` 7 / 7 / 0 / 0; `implements` **NO, 0**. **13** target names resolve to more than one published symbol (`log`, `info`, `colorOutput`, `testEnded`, `suiteEnded`, `id`, `kind`, `size`, …) and **408 of 1,142** published declarations are named by nothing |
| `bun run script/m14/verify-doc-truth-emissions.ts` | **1** | **0 findings attributable to nim** — no `FALSE_NEGATIVE`, no `FALSE_POSITIVE`, no `UNDOCUMENTED`, no `NO_CLAIM_TABLE`; nim is absent from all four finding lists and from `MISSING_DOC`, and its claim table is read at line 357. An earlier revision of this row recorded exit **0**; the gate exits **1** because its verdict is repo-wide (`FALSE_NEGATIVE=7 FALSE_POSITIVE=0 UNDOCUMENTED=41 MISSING_DOC=1 NO_CLAIM_TABLE=16 -> FAIL`), and every one of those 48-analyzer findings belongs to another lane. The gate has no `--lang` selector, so this lane cannot turn that 1 into a 0 and must not claim it has. Under `npx tsx` the gate cannot run at all: `script/m14/verify-doc-truth-emissions.ts:131` uses `__dirname` in an ES module and dies with `ReferenceError: __dirname is not defined in ES module scope` (*Limitations* 21) |
| `npx tsx script/m12/verify-regex-census.ts` | 1 | gate FAILED, and **this lane contributes 0 of its 51 rows**: 26 MISSING + 25 STALE, all in `css`, `julia`, `clean`, `fsharp`, `javascript`, `python`, `svelte`, `typescript`. `grep -c 'nim'` over the gate's own output is **0**. The analyzer holds no `RegExp`, no `.match(`, `.replace(`, `.test(` and no regex literal, so there is nothing here for this lane to fix |
| `bun run script/m14/verify-analyzer-hygiene.ts` | **1** | **3 findings repo-wide — and none of them is about this lane, because the gate never examines it.** `GATED_ANALYZERS` at `script/m14/verify-analyzer-hygiene.ts:30` is a hardcoded map of **25** languages and `nim` is not in it, so `--lang nim` prints `unknown language: nim` and exits. The 3 findings are `cpp/bare-node-identity-comparison`, `haskell/bare-node-identity-comparison`, `elixir/node-identity-comparison`. Under `npx tsx` the gate cannot run at all — same `__dirname` defect as *Limitations* 21, at `script/m14/verify-analyzer-hygiene.ts:27`. **This lane's analyzer hygiene is UNMEASURED by this gate, not clean**: the regenerated `validation/m14/results/M14.0.F7.json` holds 25 `analyzer-hygiene-*` rows and **0 occurrences of the string `nim`**, checked before the fix, after it, and after a regeneration whose `commit` field is `647a08e3c`. The lane's own substitute is `verify-analyzer-hygiene-nim.ts`, and it found a real defect on the first run |
| `npx tsx script/m14/verify-honesty.ts` | **6** | **22 failures repo-wide, 0 naming nim**, re-measured on this pass; an earlier run of the same command read **19**, so the count moves with the rest of the fleet and the number to quote is the **0**, not the total. Every failure is a shared-artifact staleness or banned-term finding against other lanes' work: `M14.0.F6: 945 declared input(s) changed since 799464551c`, `M14.0.F7: 61 … since 66b9327df0`, `M14.0.F8: 132 … since a943047e5c`, `M14.0.F9: 70 … since 4f7f78ebd6`, plus 11 banned-term hits in other lanes' fixtures and in `M14.0.F5.json` / `M14.0.F11.fsharp.json` / `M14.0.JS-CENSUS.json`. This lane's own contribution to the input sets is `src/ast/real-nim-analyzer.ts`, and it is not among the changed inputs in any of the four. Changing the analyzer blob earlier made the gate report `M14.0.F4: 3 declared input(s) changed since 469ecd1afd` and `M14.0.F7: 1 declared input(s) changed` — both naming this lane's own files — and re-running the two producers (`mutate-analyzer.ts`, `verify-analyzer-hygiene.ts`) cleared them, which is the gate working: it declares evidence stale against the artifact's producer, not against a date. One sub-check is worth quoting because it is a gate limitation rather than a lane result: **`freshness rule flags every artifact — it cannot distinguish current from stale`** (2,522 inputs changed since `65df67e`, and 0 of 9 artifacts read current). A gate in that state cannot be used as evidence either way, so it is reported and not leaned on. **The path the contract gives for this gate — `script/verify-honesty.ts` (honesty contract §42) — does not exist**; the file is at `script/m14/verify-honesty.ts`, and a reader who follows the contract gets `ERR_MODULE_NOT_FOUND`, which is indistinguishable from the gate having nothing to report. §8 |
| `npx tsx script/m14/ontology-coverage-gate.ts nim` | **2** | unchanged: `RULED_BY_LANG` carries `bash`, `json`, `lua`, `toml` and no `nim`, so the gate walks 4,555 files and refuses to print a verdict. `ruled-gate.ts` supplies the wiring on a copy |

### Re-verification pass, and what reproduced

Every headline number in this document was re-measured on the committed blob
`9d9ee478e3295c28` in one pass, because a number inherited from a previous
session is a number nobody checked. The result is that **the census reproduces
exactly and the arbiter reproduces its verdict**, and the only per-type movement
is in the rows *Limitations* 8 and 11 name as walk-dependent.

| | committed artifact | this pass | delta |
| --- | --- | --- | --- |
| files walked / parsed | 4,555 / 4,555 | 4,555 / 4,555 | **0** |
| symbols | 83,692 | 83,692 | **0** |
| empty names / empty kinds | 0 / 0 | 0 / 0 | **0** |
| `parseFile` threw / raw-parse threw | 0 / 0 | 0 / 0 | **0** |
| endpoints equal to `unknown` | 8 | 8 | **0** |
| empty endpoints | 0 | 0 | **0** |
| edge types outside the ten | 0 | 0 | **0** |
| grammar node types (Instrument A) | 209 | 209 | **0** |
| all ten per-type edge counts | — | — | **0 on every one** |

The comparison is field-by-field over the whole `types` array, not a spot check:
every numeric field of all ten rows is identical, and the only two fields that
differ are `examples` (which three edges the census chose to print) and one
`topUnresolvedTargets` tie at count 4 (`ast` vs `init`, order not contents). Both
are presentation, and both are the same effect as *Limitations* 8: the walk is
concurrent, so which walker's output is seen first is not fixed.

**The arbiter, run twice more (walks six and seven of the on-record set), prints
`emitted 9/10  ruled-sound 1  FALSIFIED 0  ruled-without-justification 0` both
times**, 272s and 272s, with the four load-bearing rows byte-identical for the
seventh time running:

| type | census | arbiter walk 6 | arbiter walk 7 |
| --- | --- | --- | --- |
| `calls` | 79,129 | 79,099 | 79,099 |
| `uses` | 31,063 | 31,020 | 30,991 |
| `contains` | 21,579 | 21,567 | 21,564 |
| `imports` | 9,345 | 9,340 | 9,344 |
| `references` | 40,559 | 40,542 | 40,415 |
| **`exports`** | **408** | **408** | **408** |
| **`extends`** | **570** | **570** | **570** |
| **`overrides`** | **48** | **48** | **48** |
| `instantiates` | 1,990 | 1,989 | 1,985 |
| **`implements`** | **0** | **0 RULED-SOUND** | **0 RULED-SOUND** |

`calls` is the only moving row that landed on the same value twice, and it landed
on the previous pass's value (79,099) rather than on the census's — so the spread
is a property of the walk and not of the day. The honest figure remains
`calls 79,099–79,129` and `references 40,415–40,559` at this corpus size and
worker count. The probe epilogue repeated: `conceptsExamined 174`,
`withRefinesField 0`, `isExpressionsInConceptBodies 156`, `refinements 0`.

Also re-run, and unchanged: `run-fixtures.ts --lang nim` **10 pass / 0 fail**
(exit 0), `verify-mutants.ts` **15 run / 15 CAUGHT / 0 survived** (exit 0),
`mutate-analyzer.ts` **58 nim mutants / 58 caught / 0 survived** (exit 2, on 6
survivors in `java`, `groovy`×2, `scala`, `make`, `php`),
`rel-type-coverage-gate.ts --langs=nim` **6 DERIVATION findings** (exit 1), and
`verify-regex-census.ts` **exit 1 with 0 of its 51 rows naming nim** — while the
analyzer itself greps to **0** for `RegExp`, `.match(`, `.replace(`, `.test(`
and `.split(/`.

**FOUR of the gates in that table WRITE SUPERVISOR-OWNED FILES as a side effect of
being run, and the fourth is qualitatively worse than the other three.** Measured
on this pass, all four reverted:

| gate | §8 file it rewrote | diff | nature |
| --- | --- | --- | --- |
| `verify-doc-truth-emissions.ts` | `docs/DOC-TRUTH-EMISSIONS.md` | 151 insertions, 88 deletions, shared with the next row | other lanes' progress through a shared generator |
| `verify-analyzer-docs.ts` | `validation/m14/results/analyzer-docs.json` | (as above) | (as above) |
| `mutate-analyzer.ts` | `validation/m14/results/M14.0.F4.json` | **13,034 insertions, 9,615 deletions** | every lane's mutants, re-recorded at this branch's `commit` |
| `script/m60/rel-type-coverage-gate.ts --langs=nim` | `validation/m60/results/rel-type-coverage.json` | **37 insertions, 1,410 deletions** | **DESTRUCTIVE WHEN SCOPED** |

The first two move because other lanes' concurrent progress surfaces through a
shared generator (`FALSE_NEGATIVE` 8→7, `UNDOCUMENTED` 43→41, `NO_CLAIM_TABLE`
20→16, `NON_ENGINE_KIND` 26→19). The third re-records all lanes' mutants and
re-stamps the artifact's `commit` field from `ee3ae4ef` to this branch.

**The fourth DELETES other lanes' records, and it is the one that would not have
been caught.** `--langs=nim` is *narrower* than the artifact it writes: the
committed `validation/m60/results/rel-type-coverage.json` holds **46 lanes**, and
the scoped run replaces it with **1**. Measured, not quoted — `git checkout --
validation/m60/results/rel-type-coverage.json` followed by
`len(json.load(...)['lanes'])` reads 46 again; the 1-lane version had 37 of 46
lanes' rows absent. A scoped gate that truncates a repo-wide ledger is worse than
an unscoped one that refreshes it: the first destroys data, the second only
reorders it, and the deleted rows are other lanes' repayment records against the
104-item baseline. This is the same defect class as the write-guard added to this
lane's own `census.ts` (write nothing without an explicit output path), reachedfrom
the other direction.

All four files are §8, so all four were reverted and the branch carries only
`real-nim-analyzer.ts`, its doc, and its own fixtures. But a gate cannot be both a
thing you run for evidence and a thing that edits a file you do not own, and the
two requirements conflict. §8, in the order the cost rises: either the generators
take an output path the way `census.ts` does (write nothing without one), or a
`--langs`-scoped gate writes to a scoped path and never to the repo-wide artifact,
or the workstream states that running a gate implies committing its output, which
on a seven-lane branch means every lane commits every other lane's numbers — and,
for the fourth, means every lane commits a file that deletes 45 lanes' work.

**The exit-1 rows from this lane's own instruments are a shared-machinery defect,
not a lane failure, and the distinction is measured rather than asserted:** in each
case the artifact was written and the digest line printed *before* the non-zero
exit, and the named file had already logged `[BB-PARSE-ERR]` in the same run
(*Limitations* 8). `resolution-audit` is the sharpest case, because there the exit
code came with a **37-edge swing in the defect column** — the first run's 127
tree-only edges are as defensible as the committed 90, and only the artifact header
tells a reader which walk produced the number they are reading. A gate that cannot
distinguish "this run failed" from "this run finished and the process could not
exit", and that writes its answer either way, is a gate whose green and
red are the same colour.

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
`deriveNimEdges`, reading node types and fields and no analyzer metadata, and
`validation/m14/fixtures/nim/oracle-crosscheck.ts` runs both sides through
production `parseFile` on the same file and compares site-agnostically (label +
normalized target). Both sides now print `sha256` before and after the walk.

| | pinned run |
| --- | --- |
| sample | 400 of 4,075 discovered files, deterministic every-10th, 400 parsed, 0 parse failures, 0 oracle throws |
| agreement | `imports` 349/349, `extends` 30/30, `overrides` 3/3, `instantiates` 124/124 — **exact** |
| MISSING | **23** = `exports` 20 (no oracle derivation exists at all) + `references` 3 |
| UNEXPLAINED | **18** = `calls` 13, `contains` 4, `uses` 1 |
| disagreements | every one adjudicated in *The oracle had to be able to disagree* above; the oracle was wrong twice and the analyzer once |

**The limit, stated because it is real: both sides walk the same grammar.** A
grammar fact both derivations get wrong is invisible to this instrument. It shows
that two independent walkers agree, never that an edge is true. And the arrangement
has one shared input on purpose — the analyzer's builtin-name filter, and its
symbol list as the name inventory for `contains` — because ownership assignment is
not what a differential audits and a second place to be wrong helps nobody
(*Limitations* 4).

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
  12 repos, 5,227 tracked files (5,056 `.nim`/`.nims` + 171 `.nimble`), 91,011
  symbols, 202,256 relationships, **0 crashes**, 50 error files (0.957%) — `nim`
  48, `nimble` 1, `torrentinim` 1. (This is the production pool-worker route; the
  complexity artifact below is a different path over a different file set, and
  the table there reconciles the two rather than conflating them.) An error
  *rate* is not a defect count, so the 50 are separated by construction
  rather than averaged: **46 are the Nim compiler's own `tests/` files, which are
  invalid on purpose** (a lexer test with an unterminated raw string, an
  error-message test with a bare `a:`, a parser test asserting that `elif:`
  without a condition is rejected). They are a corpus-selector fact, not grammar
  defects. **4 are shipping code that fails to parse**, and those are the real
  gap list below.
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
   that cost is **0 occurrences** over 4,555 files, and the funnel is measured
   rather than asserted: 156 `is` expressions in concept bodies, 13 whose LEFT is a
   bare concept formal parameter, **0** whose RIGHT names a same-file concept — the
   13 name `U`(2), `int1`, `int2`, `string`, `PrimitiveBase`, `IntegerBase` or
   `IdBase`, i.e. a concrete type or a generic parameter in every one. A cross-file semantic index
   would lift the restriction; a name-shape heuristic would not be worth the
   fabrications. The first version of this probe reported the 13 as 0, because it
   looked the parameter up in a map keyed by concept OWNER name instead of walking
   each body with its own concept's parameters — a guard that cannot match prints
   the same zero as a construct that does not occur, which is the whole reason the
   ruling table carries `conceptsExamined` beside `refinements`.
6. **`implements` has zero corpus occurrences, so its edge count is not evidence
   of anything on its own.** The reader is pinned by 6 fixture edges across both
   spellings and 4 forbids, and the construct is confirmed present in the
   language (`nim/compiler/parser.nim:2268/2275/2291`,
   `nim/doc/manual_experimental.md:1205-1213`) — but no file in 4,555 exercises
   it, and the corpus is not thin on the construct's own terms: it holds **216
   `concept_declaration` in 69 files**. Read the 0 as "not present in this
   corpus", never as "audited and correct" and never as "the language cannot
   express it": no oracle derivation exists for the label either.
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
   | `resolution-audit.ts` | written, digest printed | `nim/tests/ic/mlocalpassc.nim` | `[BB-PARSE-ERR] … memory access out of bounds` |
   | `accent-quoted-endpoints.ts` | **NOT written** — the walk was destroyed | `nim/lib/std/private/oscommon.nim` | `[BB-PARSE-ERR] … memory access out of bounds` |

   So this lane's corpus instruments **exit 1 on results that are finished and
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
    they are three different things.** Enumerated in *Five defects* above: two are
    a macro that *builds* an inheritance clause from backtick parameters
    (`nimsuggest/tests/fixtures/mclass_macro.nim`), one is named `_` and is
    suppressed on purpose (`tests/macros/tgettypeinst.nim`), and two are a `type`
    section inside a body under `static:` (`tests/stdlib/trepr.nim`) or inside a
    `template` body (`tests/template/template_issues.nim`) — the C-D1 rule, which is
    deliberate. A `static:` block is not a separate compilation unit the way a
    `runnableExamples` block is, so the two are not the same case and are not
    treated as one.
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
16. **Zero corpus occurrences of the receiver-qualified method spelling.**
    `method Receiver.name()` is standard Nim, and the pinned grammar parses the
    `Receiver.` prefix as an **ERROR node** with no field, so
    `methodReceiverTypeLeaf` — which reads the receiver only from the first
    parameter — finds nothing. Across **4,555 corpus files the spelling occurs 0
    times** (searched in all 7 repos, both capitalised and lower-case receivers), so
    this is a corpus-coverage limit and not a measured defect: the branch cannot be
    exercised by anything in the corpus, and `gap-hunt.ts` reports the count (0)
    beside the parameter form (141) so the absence is on the record rather than
    inferred. Fixing it would mean reading an ERROR node, which is a parse artifact
    rather than a syntax fact, and the corpus cannot tell us whether that reading is
    right.
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
    10 of 10 examined | 9 EMITTED + 1 implemented-and-measured-absent | 184,691
    edges over 83,692 symbols | …`), which states the section's summary and puts
    the drop on a row that makes no per-type claim. The gate then reads **0
    findings for nim**. §8, not edited: deleting the third guard is the fix, and
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
    pinned in both directions by the fixture (6 expected edges across both
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

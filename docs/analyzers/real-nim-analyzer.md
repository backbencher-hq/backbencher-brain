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
| `type A = concept x` with body `x is B` | an `is` expression whose LEFT is a bare formal parameter of the concept | **0 refinements of a different concept**; 5 name a same-file concept and all 5 are self-references or field constraints |

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
walk, so the file set is the same set. 83,051 symbols, 0 empty names, 4 empty
kinds (see *Limitations* 8), 0 edge types outside the ten, 0 empty endpoints.
Artifacts: `validation/m14/measurements/nim/ontology-census.{json,txt}`.

**EVERY NUMBER IN THIS SECTION IS AGAINST A COMMITTED BLOB, not a working
tree.** `census.ts` prints `sha256(src/ast/real-nim-analyzer.ts)` before the walk
and again after it, so a run that says "unchanged" is internally consistent, and
this one does:

| | blob / digest |
| --- | --- |
| `analyzer/NIM` @ `c12d7c7c1` | git blob for `src/ast/real-nim-analyzer.ts`, sha256 `a59574036eb9f7fb…` |

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
| `calls` | YES | EMITTED | 79,079 edges | `collectCallsAndUses`: the callee branches plus the parenless-UFCS member-leaf branch |
| `uses` | YES | EMITTED | 30,972 edges | `collectCallsAndUses`, the member-leaf and bare-identifier read branches |
| `contains` | YES | EMITTED | 21,326 edges | `collectContainment`, from `ownerName` and from `metadata.nimNestedIn` for a nested routine |
| `references` | YES | EMITTED | 40,336 edges | `collectDeclaredTypeRefAt`, the declared-type sites |
| `imports` | YES | EMITTED | 9,332 edges | `readImportStatement` / `readImportFromStatement` / `readIncludeStatement`, plus the `ImportInfo[]` channel |
| `instantiates` | YES | EMITTED | 1,987 edges | `collectInstantiationAt`, a call whose callee is a type this file declares, plus the type argument of a `new` expression |
| `extends` | YES | EMITTED | 570 edges | `collectInheritance`, from `object_declaration.inherits`, minus the compiler's own roots |
| `implements` | YES | **implemented, corpus-measured absent** | **0** edges, 216 concepts examined, 0 refinements | `collectContractRefinement`, from `concept_declaration.refines` and from `is X` in a concept body |
| `overrides` | YES | EMITTED | 48 edges | `collectOverrides`, receiver-qualified `Receiver.method`; the cross-file family additionally needs `overrideCompanion` |
| `exports` | YES | EMITTED | 399 edges | `readExportStatement`, one edge per OPERAND of `export`, with `except` read positionally as what does NOT leave |

| Type | Verdict | Edges | Both ends resolve | Confidence | evidenceClass |
| --- | --- | --- | --- | --- | --- |
| `calls` | EMITTED | 79,079 | 39.4% | 0.85 / 0.9 / 0.75 | `usage_contextual` 79,024, `import_based` 54, none 1 |
| `uses` | EMITTED | 30,972 | 99.7% | 1.0 (51.6% at 0.75) | `usage_contextual` 30,916, `import_based` 56 |
| `contains` | EMITTED | 21,326 | 99.8% | 1.0 | `structural` |
| `references` | EMITTED | 40,336 | 46.0% | 0.9 | `reference_qualified` 34,189, `import_based` 6,147 |
| `imports` | EMITTED | 9,332 | 44.5% | 1.0 | `import_based` |
| `instantiates` | EMITTED | 1,987 | 100.0% | 0.9 | `usage_contextual` |
| `extends` | EMITTED | 570 | 70.9% | 1.0 | `structural` |
| `exports` | EMITTED | 399 | 4.0% | 1.0 | `structural` |
| `overrides` | EMITTED | 48 | 100.0% | 1.0 | `structural` |
| `implements` | **implemented, corpus-measured absent** | **0** | — | 1.0 | `structural` |

183,049 edges. **0 below 0.7 from this analyzer.** One `calls` edge sits at 0.5 with
no `evidenceClass`, and it is not this analyzer's: it comes from the regex fallback
in shared `pool-worker.ts` described in *Limitations* 11, which is a §8 report and
is counted here so the table is not read as claiming a clean 0.

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
type          status            detail
calls         EMITTED           79,041 edges in 4+ files
uses          EMITTED           31,079 edges in 4+ files
contains      EMITTED           21,579 edges in 4+ files
imports       EMITTED           9,343 edges in 4+ files
references    EMITTED           40,559 edges in 4+ files
exports       EMITTED           408 edges in 4+ files
extends       EMITTED           570 edges in 4+ files
implements    RULED-SOUND       NOT EMITTED; the construct occurs 0x on the parse tree.
                                Written ruling: script/m14/nim-ruled.ts (RULED_BY_LANG.nim)
overrides     EMITTED           48 edges in 4+ files
instantiates  EMITTED           1,990 edges in 4+ files
emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0
exit code 0
```

So the coverage figure is **9 emitted + 1 measured-absent = 10 of 10
applicable**, and the two halves of that sentence come from different sources:
the numerator from what measurably fires, the denominator from a parse-tree
measurement of non-applicability. It is not 10/10 emitted, and reporting it as
such would be the claim-without-coverage class the workstream exists to stop.

Two numbers in that table differ from the census above (`calls` 79,041 vs
78,992; `references` 40,559 vs 39,907) because the arbiter proof ran against a
LATER analyzer state — the same effect the digest field was added to catch.
Each row is correct for its own run; the census run is the one the digest pins.

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

### Four defects found by measurement, and what each one cost

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
| `calls` edges whose target is declared on the tree and published nowhere | 653 | **17** |
| callable declaration recall (tree declarations vs published symbols) | 97.5% | **99.97%** (34,455 / 34,466) |

The residue is 11 declarations, and they are `proc _` — Nim's discard name for a
declaration, which the analyzer suppresses on purpose.

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
| `calls` | 79,080 | 39.4% | — | — | 58.1% | **17** | 2.4% |
| `uses` | 31,021 | 99.8% | — | — | — | 53 | 0.1% |
| `contains` | 21,572 | 99.8% | — | — | — | 23 | — |
| `imports` | 9,341 | 0.1% | **88.7%** | — | 2.1% | 0 | 9.1% |
| `references` | 40,534 | 46.1% | — | 1.7% | 49.9% | **0** | 2.3% |
| `exports` | 408 | 3.9% | — | 0.5% | 70.8% | 0 | 24.8% |
| `extends` | 570 | 70.9% | — | — | 28.4% | 0 | 0.7% |
| `overrides` | 48 | **100.0%** | — | — | — | 0 | — |
| `instantiates` | 1,985 | **100.0%** | — | — | — | 0 | — |

The **tree-only** column is the defect column: the target IS declared on a corpus
parse tree and no symbol with that name was published anywhere. It is 93 edges
across the whole corpus, from four distinct names — `destructor`, `root`, `me`,
`super`, plus `_` — and two of them (`destructor`, `super`) are templates whose
`contains` edge the production filter deletes (*Limitations* 12).

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

### The six questions, per emitted type

Columns 1, 2, 5 and 6 are this pass's census (4,555 files, 6 workers, analyzer
sha256 `a59574036eb9f7fb` = `analyzer/NIM` @ `c12d7c7c1`; the worker count matters,
see the note above the verdict table). Column 3 is the oracle cross-check (400
files, deterministic every-10th), whose sample is
named below and whose instrument is a SEPARATE WALKER — so "agrees" means "the two
derivations agree", never "the edge is true". Column 4 is adjudicated per type.

| Type | 1 Exists | 2 Fires | 3 Correct (oracle) | 4 Labelled | 5 Resolved | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 79,079 | 2,519 vs 2,527; 0 missing, **13 unexplained** | yes | 39.4% | 100% under 1.0; `usage_contextual` |
| `uses` | yes | 30,972 | 825 vs 826; 0/1 | yes | 99.7% | 51.6% at 0.75, rest 1.0 |
| `contains` | yes | 21,326 | 995 vs 998; 0/**4** | yes | 99.8% | 1.0, `structural` |
| `imports` | yes | 9,332 | 349 vs 349; 0/0 | yes | 44.5% | 1.0, `import_based` |
| `references` | yes | 40,336 | 624 vs 622; **3 missing**, 0 unexplained | yes | 46.0% | 0.9, `reference_qualified` |
| `instantiates` | yes | 1,987 | 124 vs 124; 0/0 | yes | 100.0% | 0.9, `usage_contextual` |
| `extends` | yes | 570 | 30 vs 30; 0/0 | yes | 70.9% | 1.0, `structural` |
| `overrides` | yes | 48 | 3 vs 3; 0/0 | yes | 100.0% | 1.0, `structural` |
| `exports` | yes | 399 | **no oracle derivation exists** | yes | 4.0% | 1.0, `structural` |
| `implements` | yes | **0** | no oracle, and 0 edges | yes | — | 1.0, `structural` |

**Question 5 is the one this pass moved, and the movement is the result.** The
`Resolved` column is a rate against the file's own symbol set; the *resolution
audit* above splits the same edges into local / another-file / builtin / tree-only
/ external, and `calls` at 39.4% local is 58.1% declared in another corpus file and
2.4% genuinely external. Before this pass the same measurement read 653 `calls`
edges in the **tree-only** bucket — a declaration the tree carried and the analyzer
published nowhere — and it now reads 17.

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

Column 3 above carries the LAST run whose analyzer state is this branch's HEAD
(400 of 4,056 discovered files, 400 parsed, 0 failures). Re-run this pass against
the WORKING TREE — `validation/m14/measurements/nim/oracle-crosscheck-workingtree.{json,txt}`
— the residuals move a long way, and the direction is informative:

| Type | HEAD analyzer | working tree | what moved |
| --- | --- | --- | --- |
| `calls` | 14 unexplained | **30 unexplained** | 12+ are `calls -> runnableExamples`, i.e. the `## runnableExamples:` doc block being published as a call |
| `contains` | 0/0 | **126 missing**, 1 unexplained | nested routines are published and the oracle does not derive them |
| `references` | 1 missing | **3 missing** | — |
| `uses` | 0/0 | **1 unexplained** | — |
| `exports` | no derivation | no derivation, 20 targets | unchanged DERIVATION finding |

These are **not** defects of HEAD, and this section does not claim them as such:
they are the cost of measuring an analyzer that was being rewritten underneath
the measurement. Two of them are worth the supervisor's attention anyway.
`runnableExamples` is caught by a mutant that already exists
(`nim/runnable-examples-pragma-published-as-a-call`), so the mutant gate is
already the right instrument for it; and `contains` at 126 missing says the nim
ORACLE is now behind the analyzer on nested routines, which is DERIVATION debt
growing in the other direction. Both residuals are named rather than left as
counts, and the pre-existing ones are named too:

- **14 unexplained `calls`** are all operator or magic callees the analyzer's
  builtin filter drops: `|div|`, `==`, `-`, `+`, `=destroy` (×4), `matchProc`,
  `visitingProc`, `assignResult?`, `()` (`nim/tests/specialops/tcallops.nim`).
  The filter is the lane's deliberate rule, not a defect; the oracle counts them
  and the analyzer declines them.
- **1 `references` miss** is `nim/tests/types/taliasbugs.nim references -> Rgba8`,
  which this document already records as genuinely ambiguous
  (`BlenderRgb[Rgba8]` reads as a type argument; the enclosing test reads as a
  value index). An independent re-measure reproduced the same single row.

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

**Question 5 — resolved, and the low rates are the finding.** `calls` at 39.3%
and `references` at 45.2% are cross-module targets: a Nim file calls and names
types declared in the 3,968-file compiler and its libraries, and the census
resolves endpoints against the symbols of the file's own draw, so a cross-file
target reads as unresolved here and resolves in a full index. The diagnosis is in
the census output rather than asserted — the top unresolved `calls` targets are
`add(2645)`, `doAssert(2095)`, `defined(1462)`, `len(577)`, `skipTypes(483)`, and
the top `references` targets are `PNode(2285)`, `PSym(984)`, `PType(941)`,
`PContext(675)`, all compiler-internal types from other modules. `exports` at 3.9%
is the same fact BY CONSTRUCTION and is the sharpest case: its targets are
re-exports of names declared in ANOTHER module, so a low rate is the honest
reading of a correct edge. The CSS `references` reference point (66.8%) sits
between the two classes.

**Question 6 — confident, in one number.** **0 of 183,386 corpus edges fall
below 0.7**, so nothing in this lane is a heuristic by the honesty contract §4's
0.7 line, and the ratio is countable rather than a vibe. The sub-1.0 edges are a
different thing and are countable by type — `calls` 0.85 (usage-inferred callee,
75,679) and 0.9 (3,259), `imports`-qualified `calls` 0.75 (54), `uses` 0.75
(15,954 = 51.8% of that family) with the rest at 1.0, `references` 0.9 (39,907),
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

### Corpus

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

## Regex inventory

Zero. The analyzer contains no `RegExp`, no `.match(`, `.replace(`, `.test(`, no
`.split(/…/)` and no regex literal. Every decision is made on node types and
fields, which is what makes the 17-file matrix and the 5,227-file corpus
comparable across grammar versions.

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
- **This pass's artifacts**, all committed and all re-runnable:
  `validation/m14/measurements/nim/ontology-census.{json,txt}` (the per-type
  table, the SymbolKind census, the Instrument-A inventory and the Instrument-B
  construct counts over 4,555 files),
  `validation/m14/measurements/nim/ruling-probe.json` (the `implements`
  measurement, including the guard funnel and the text probe classified as a
  non-instrument), and
  `validation/m14/measurements/nim/ruled-gate-run.txt` (the arbiter's own verdict
  table over the same corpus, from a patched copy in `/tmp`).
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
  **40 mutants, 40 caught, exit 0.** One per symbol kind, per relationship kind,
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
  `npx tsx validation/m14/fixtures/nim/verify-mutants.ts`): **9 mutants, 9
  caught, exit 0.** This round's own defects, one per failure mode rather than
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

### Complexity envelope

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
   13 name `int`, `string`, `U`, `PrimitiveBase`, `IntegerBase` or `IdBase`, i.e. a
   concrete type or a generic parameter in every one. A cross-file semantic index
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
   16 of 77,371 symbols, then 20, then 4 of 83,051 — every one in a file that also
   logged `[BB-PARSE-ERR] … memory access out of bounds` in the same run
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
    **366 are deleted (8.1%)** — 231 `calls`, 135 `contains`, 21 `exports`, 8
    `uses`, 1 `overrides`. The symbol survives, so the result is a declaration the
    graph holds and no edge can reach: `bb_impact` on `` `-!` `` returns nothing
    and the reverse walk cannot tell that from a declaration nobody uses. This is
    the cause of the three `` `-!` ``/`` `lhs` `` `contains` rows the oracle reports
    as unexplained. Reported (§8): the filter needs a language-scoped exemption for
    `nim`, on the pattern of its existing `bash` path exemption.
13. **Six `extends` occurrences have an owner the analyzer does not publish, and
    they are three different things.** Enumerated in *Four defects* above: two are
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

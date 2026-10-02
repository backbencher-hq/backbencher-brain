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
| `contains` | one edge per owned member: object fields, enum members, module-level procs/types, methods under their receiver | no, by design |
| `calls` | `call` and `dot_generic_call` whose callee resolves to a callable this file declares; UFCS member calls included | the callee node |
| `uses` | a bare identifier read, and the member leaf of a `dot_expression` that is not a call callee (Nim's UFCS makes `x.foo` a member read) | the identifier / leaf node |
| `references` | the declared-type graph: parameter, return, field, `const`/`let`/`var` annotations, `new`/`of` operands | the annotation node |
| `instantiates` | `TypeName(field: v)` — a `call` whose callee is a type this file declares and not a callable it also declares | the call node |
| `extends` | an `object_declaration` that inherits, including a qualified base from another module | the base node |
| `overrides` | a `method` whose name matches a method of a base this file also declares; the target is receiver-qualified (`Rect.describe -> Shape.describe`) | the method node |

`implements` is **structurally absent**: Nim concepts are duck-typed rather than
nominal, so there is no declaration to point at. The differential reports the
label as vacuous rather than pretending it is covered.

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

`export` publishes `ImportInfo`-style export entries; Nim's `export` is a
re-export of imported names rather than a new declaration, so it produces no
relationship of its own.

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
- **Differential** (`script/m14/nim-truth-oracle.ts` + the `nim` lane of
  `script/m14/differential.ts`): an independent derivation, in its own module
  rather than a block inside a 13k-line harness. Both cold-pool lanes agree
  exactly in **both** directions — `nim@60` 941/941 covered, MISSING=0,
  unexplained=0 (0%); `pixie@60` 3,220/3,220, MISSING=0, unexplained=0 (0%). A
  targeted draw over all 71 method-declaring files in 6 repos exercises the
  classes a cold-pool sample under-samples: extends 45, overrides 40,
  instantiates 93, references 334, calls 999, uses 417, contains 504, imports 94
  — every label matching on both sides.
- **Non-vacuity is measured, not assumed.** A per-label tally over the same
  draws reports each label's truth and analyzer counts and flags any label where
  the oracle emits none, so `overrides` cannot be "covered" by a lane that
  happened to draw no inheritance.
- **Fixtures** (`bun run script/m14/run-fixtures.ts --lang nim`): 5 pass, 0 fail.
  Every fixture source is accepted by the Nim 2.2.12 compiler, so a passing
  expectation is never validating behaviour the language rejects.
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

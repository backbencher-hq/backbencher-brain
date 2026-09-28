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
| `method f()` | `method` | `method_declaration`, receiver type in metadata |
| `template f()` | `macro` | `template_declaration` |
| `macro f()` | `macro` | `macro_declaration` |
| `type O = object` | `struct` | `object_declaration`, non-ref |
| `type C = ref object` | `class` | `object_declaration` under a `ref_type` |
| `type T = tuple[int, string]` | `struct` | `tuple_type` / `tuple_deconstruct_declaration` |
| `type I = concept` | `interface` | `concept_declaration` — a structural, compile-time contract satisfied by implicit dispatch, which is what `Interface` means in this codebase |
| `type E = enum` | `enum` | `enum_declaration` |
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
- **Damage census** (`fixtures/nim/out/damage-classes.txt`,
  `fixtures/nim/out/damage-census.txt`): 131 error sites over the 50 files,
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
- **Completeness classification** (`script/m14/spec/nim-completeness.json`): all
  **127** named node types the pinned wasm declares are classified, so nothing is
  silently absent — 94 `handled_verified`, 32 `internal_silent` (each with the
  reason it is silent rather than merely unreferenced), 0 `gap`, and 5
  `design_decision` rulings (NIMD1 file-scope pragma statements, NIMD2 cross-file
  overrides, NIMD3 concept satisfaction, NIMD4 `.nimble` routing, NIMD5 `.nims`
  routing). The open work in this lane is a **grammar** gap, which is a different
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

## Complexity envelope

`script/m12/nim-corpus-measure.ts`, artifact
`validation/m12/results/nim-corpus-complexity.json`. Two numbers are deliberately
kept apart, because they are different claims and the artifact records which one
it is making as `measurementPath`:

- **`direct-single-parser`** (the recorded run): 5,056 tracked `.nim`/`.nims`
  files, one parser in one process. 91,079 symbols, 203,410 relationships,
  620.7 s wall (229.2 s user CPU), **147 symbols/s, 328 relationships/s, 8.15
  files/s**. Yield: 18.0 symbols and 40.2 relationships per file.
- **`production-pool-worker`**: the route the indexer itself takes. It is a
  separate claim and the run is not recorded in this artifact — the pool stalls
  at worker startup on a machine where other work is in flight, and a stalled
  pool writes no artifact at all, which reads as "never ran" rather than as
  "died". Run it on a quiet machine; the script supports it as the default.

Relationship mix over the corpus: `calls` 87,244, `references` 44,545, `uses`
34,937, `contains` 21,784, `imports` 12,090, `instantiates` 2,085, `extends`
657, `overrides` 68. Symbol mix: `function` 31,816, `property` 13,836,
`variable` 13,213, `constant` 9,639, `enum_member` 8,471, `struct` 4,284,
`macro` 3,792, `type` 2,881, `method` 989.

Cyclomatic complexity is the analyzer's own per-symbol measure. Mean across
files 1.82; max 1,460, and the worst files are named rather than left as an
average — `htmlparser.nim` 1,460 (per-file mean 11.89), `vm.nim` 747,
`sigmatch.nim` 542, `commands.nim` 327, `renderer.nim` 313. A corpus mean of
1.82 with a max of 1,460 is the reason the artifact carries the worst-file list:
an average over mostly-small files hides the fact that one proc scored 1,460.

### Two records that do not fully agree, and why that is stated

The parse record and the complexity record measure **different file sets through
different paths**, and they are not interchangeable:

| Record | Path | Files | Symbols | Relationships |
| --- | --- | --- | --- | --- |
| `nim-corpus-errors.json` | production pool-worker | 5,227 (incl. 171 `.nimble`) | 91,011 | 202,256 |
| `nim-corpus-complexity.json` | direct single parser | 5,056 (`.nim`/`.nims`) | 91,079 | 203,410 |

The file-set difference is measured, not assumed: the 171 tracked `.nimble`
files were run through the direct path on their own and contribute **26 symbols
and 315 relationships**. So 5,056 + 171 files on one path would be 91,105 /
203,725, and the pool-worker record is still **94 symbols and 1,469
relationships lower**. The residue is therefore a *path* difference — the engine
route post-processes the analyzer's output before it is counted (it drops
relationships that do not resolve, which is the same rule the seam gate asserts)
— and it is recorded here as an open reconciliation item rather than smoothed
into a single number. `.nimble` is excluded from the complexity artifact on
purpose: it is not routed to this analyzer (decision NIMD4), so measuring it
inside the NIM complexity envelope would report coverage the router does not
have.

## Honest limitations

1. **do-pragma is not parsed as a pragma.** `expr.#[…].#` is consumed as a
   block-comment extra by the pinned grammar, so the 16 affected corpus files
   lose the pragma surface (and pick up ERROR nodes). It is the largest class by
   file count but every one of those 16 files lives under `nimsuggest/tests/`,
   i.e. it is a negative test — which is why the shipping-code list above, not the
   file count, is the honest measure of what a user would hit. The same
   rebuild-gating applies to every other class in the census table: a 56-line
   patch for do-pragma is preserved at
   `$HOME/fixtures/nim/out/0001-nim-dopragma.patch` and is deliberately
   **not applied**, because a rebuilt wasm has to pass the 72-case conformance
   suite, the 17-file matrix and the corpus regression before it can be wired,
   and the machine this was built on cannot hold the 2 GB+ that
   `tree-sitter generate` needs for a 41 MB `parser.c` while other work is in
   flight. An unproven grammar patch wired into a pin would be worse than a
   recorded gap.
2. **Cross-file method overrides are out of reach.** `overrides` needs the
   project-wide type hierarchy; the analyzer is per-file, so it emits an override
   only when the base is declared in the same file. Same-file overrides are
   covered by fixture, seam and corpus evidence. The alternative — resolving
   against a corpus-wide name set — would attribute an override to a same-named
   method of an unrelated type, which is the failure mode this lane refuses.
3. **`.nims` and `.nimble` are not routed.** The grammar's own `file-types`
   declares all three, and the differential lane's `ext` list carries `nim,nims`
   so the sweep does not silently skip them, but `language-detection.ts` routes
   only `.nim`. `.nimble` is a package manifest with a `requires`/`task` block
   syntax that is not the same surface as a NIM module, and routing it would
   claim a format this analyzer does not model. Routing them is a measurement
   first and a decision second.
4. **The oracle shares two inputs with the analyzer, deliberately.** It imports
   the analyzer's builtin-name filter, and it takes the analyzer's symbol list as
   the name inventory for `contains` (the zig bare-uses oracle sets the same
   precedent: ownership assignment is not what the differential audits, so
   re-deriving it would only add a second place to be wrong). Everything the
   differential *is* auditing — calls, uses, instantiates, references, extends,
   overrides, imports — is derived independently. The limit of that arrangement
   is stated here because it is real: a defect in the shared builtin list would
   not be caught by this lane.

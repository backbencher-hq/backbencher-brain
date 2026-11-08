# Visual Basic for Applications — `vba`

VBA is a dedicated analyzer over the MIT-licensed `tree-sitter-vba` grammar. It serves
`.bas`, `.cls`, `.frm` and `.vba` module sources; it is an AST extractor, not a VBA
semantic model, and it is measured against a fixture population because **this corpus
contains no genuine VBA at all** (see [Corpus validation](#corpus-validation)).

Everything below is either read from the analyzer source, read from a committed
validation artifact, or produced by a command named beside the number. Where a
measurement does not exist, the gap is named instead of filled.

## Language

- Analyzer file: `src/ast/real-vba-analyzer.ts` (`RealVbaAnalyzer`, 536 lines measured
  2026-11-02).
- Parser: `tree-sitter-vba`, vendored at
  `grammars/tree-sitter-vba/vba/grammar.js` over its shared rules at
  `grammars/tree-sitter-vba/common/define-grammar.js`; version `0.14.5`, ABI 15, MIT.
  The engine resolves the wired bytes from `wasm/tree-sitter-vba.wasm`:
  sha256 `9e0615ad1a4fdf3abff07265fe84d95ba1f392df6f4bbecd0f3ddea92aee00de`,
  7,829,271 bytes (measured 2026-11-02 with `sha256sum`).
- **Pin status: matching bytes, unregistered table row.** `validation/m14/vba-grammar-pin.json`
  records the same sha256 as the wired file — 0 pin drift, measured 2026-11-02 — but the
  pin is **not** a `lanes.vba` row in `validation/m14/grammar-pins.json` and has no row in
  `validation/m14/verification/GRAMMAR-BINDINGS-2026-10-21.md`. The consequence is
  recorded rather than smoothed: `script/m14/grammar-node-inventory.ts vba` reads its
  served digest from that binding table and therefore wrote `servedDigest: null` into
  `validation/m14/measurements/vba-grammar-nodes.json`. The digest in this paragraph was
  verified directly against the pin file; registering the row is the remaining
  grammar-provenance gap.
- Grammar inventory (the durable artifact the relationship rulings cite):
  `validation/m14/measurements/vba-grammar-nodes.json` records **418** node-type ids,
  **399** distinct names, **183** named slots over **164** distinct named names (19
  duplicate named slots from precedence/alias copies). Measured through the live parser
  the engine serves, with `nodeTypeIsNamed(id)` — not the `named` property, which a
  string does not have.
- Language detection: `src/ast/language-detection.ts:170` routes the extensions `vba`,
  `bas`, `cls` and `frm` to the language key `vba`. (The key `vba` is both the language
  name and the `.vba` extension.)
- Wired in: `src/ast/engine.ts:377` maps `vba` → `tree-sitter-vba`;
  `src/ast/engine.ts:1266` is the `getParser` WASM arm
  (`resolveWasm("tree-sitter-vba.wasm")`); `src/ast/engine.ts:2458` is the `getAnalyzer`
  dispatch → `RealVbaAnalyzer`.
- Pure AST: declarations, names, fields and relationships are read from named
  Tree-sitter nodes and fields, never from source-text scanning. The analyzer contains
  **no regular expressions** (see [Regex inventory](#regex-inventory)); its only
  source-text operation is `lineCount`, which counts `\n` once per file for the
  file-level `metadata.linesOfCode`.
- VBA is case-insensitive. The analyzer folds names to a lowercase key **only** for
  file-local declaration lookup; emitted names keep their source spelling.
- One grammar fact the analyzer must respect, and did not at first: the grammar declares
  `supertypes: ($) => [$.member_expression]`
  (`grammars/tree-sitter-vba/common/define-grammar.js:68`), and Tree-sitter never
  produces supertype nodes in a tree. The concrete nodes are
  `qualified_member_expression` and `implicit_member_expression`. Two comparisons against
  the supertype name were dead branches; they were removed 2026-10-31 and the
  grammar-conformance audit now reads vba PASS with `refs=31, unknown=0,
  unknownFields=0` (`bun script/m14/audit-analyzer-grammar.ts`).

## Symbol contract

The analyzer publishes `ASTEngine.UniversalSymbol` rows. Measured over the 10 fixture
files: **36 symbols**, **0 empty names**, **0 unknown kinds**
(`script/m14/vba-fixture-census.ts`; the same analyzer also produces 6 symbols on
`representative.bas` alone — `script/m14/vba-differential.ts`).

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | yes | `field("name")` on the declaration node, falling back to the first identifier in it; conditional declaration variants (`conditional_sub_declaration`, `conditional_function_declaration`, `conditional_property_declaration`) carry the same field |
| kind | yes | the `DECLARATIONS` map: `sub_declaration`/`conditional_sub_declaration`/`declare_sub_statement` → `Method`; `function_declaration`/`conditional_function_declaration`/`declare_function_statement` → `Function`; `property_get_declaration`/`property_let_declaration`/`property_set_declaration`/`conditional_property_declaration` → `Property`; `type_declaration` → `Type`; `enum_declaration` → `Enum`; `enum_member` → `EnumMember`; `type_member` and `variable_declaration` → `Variable`; `event_declaration` → `Event`; `const_declaration` → `Constant`. That is **9 of the engine's SymbolKind values**: `Method`, `Function`, `Property`, `Type`, `Enum`, `EnumMember`, `Variable`, `Event`, `Constant` — no `Class`, `Interface`, `Module` or `Struct` is ever constructed, because VBA has no syntax for them |
| qualified/container name | yes | a nested declaration gets `qualifiedName = "<owner>.<name>"` from the owner stack; a top-level declaration keeps its bare name. **There is no module symbol** — a module's surface is the set of its top-level declarations, exported under the literal source `root` |
| ownerName / ownerKind | yes | same owner stack: a declaration nested in a body (`sub_declaration`/`function_declaration`/property/declare forms) or a type declaration (`type_declaration`/`enum_declaration`) receives the enclosing symbol's name and kind. A procedure-local `Dim` is a `Variable` symbol owned by its procedure (fixtures `representative`, `loops-and-select`) |
| range (start/end line + column) | yes | the declaration node's `startPosition`/`endPosition` plus `startIndex`/`endIndex` |
| parameters | yes | `field("parameters")` → `parameter_list` → each `parameter`: `name` field (or first identifier), `type` from its `as_type_clause`, `isOptional` from `optional_modifier`, `passingMode` from `byref_modifier`/`byval_modifier`, `isParamArray` from `paramarray_modifier`, `defaultValue` from `default_value` → `value`. Parameters are carried as metadata on the owning symbol, never as symbols. Fixture `loops-and-select` pins `Optional ByRef limit = 3` and `ParamArray rest() As Variant` |
| returnType / type | yes, where the declaration carries a `type` field | functions and declare-functions and property getters: `field("type")` → `as_type_clause` → `type_expression`, emitted as its source text |
| visibility | yes | `field("visibility")` text, lower-cased; `public`, `private`, `friend` are recognised, anything else (including absent) defaults to `private`. Only `public` drives `exports` |
| isStatic | yes | a direct child whose text lower-cases to `static` (`static_modifier`, a named node in this grammar); carried as `isStatic` |
| documentation/comments | **no** | tree-sitter parses `comment` nodes, but no documentation field is attached to any symbol and comments are not read |
| complexity metrics | **no** per symbol | no cyclomatic or fan-in/out metric is computed. The only metric is file-level `metadata.linesOfCode` (the analyzer's single source-text operation) |
| syntax errors | **no** | the analyzer returns no error channel: a Tree-sitter `ERROR` node is a successful parse of a damaged region, not an analyzer failure. The fixture harness counts ERROR/MISSING nodes independently (`expectNoParseErrors`) |
| decorators/attributes | partial | `Attribute` statements are published as `decorates` **relationships** (metadata `attributeName`, `attributeForm`), not as a decorator payload attached to a symbol. `WithEvents` declarations additionally carry `metadata.withEvents: true` |
| metadata | yes | every symbol carries `metadata.grammarNode` (the node type it was published from) and `metadata.language: "vba"`; `metadata.withEvents` when a `with_events_modifier` is anywhere in the declaration |

Explicit non-symbols: module names, `Option` statements, preprocessor constants, labels,
form-designer controls, parameters and enum/type *values* other than members. The
analyzer's `imports: ImportInfo[]` channel is also empty by construction: a `Declare …
Lib` binding names an external library, not a resolvable project path, so the dependency
is published as an `imports` relationship and not as an import-info row.

## Relationship ontology

Confidence is the analyzer's own file-local model; downstream project resolution is a
separate engine stage and is **not measured for this lane** (there is no VBA corpus to
measure it on). Every emitted edge also carries a 1-based `line_number` and an
`evidenceClass`: `inferred` when confidence < 0.7, `import_based` for `imports`,
`usage_contextual` for `references`/`uses`, otherwise `structural`. The analyzer's
`confidence(target)` is `1.0` when the target name is declared in the same file
(case-folded lookup) and `0.6` otherwise.

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| `calls` | yes | `call_statement`/`call_expression` → the callee leaf (`field("callee")`/`field("function")`, last identifier); `RaiseEvent` → `calls` with `metadata.eventRaise`; an implicit member call (`.Run`) under a `With` keeps `metadata.implicitMember` and the receiver in `metadata.withReceiver`; `With`-receiver text is also recorded | `1.0` if the callee is declared in this file, else `0.6`; structural (or inferred at 0.6) |
| `contains` | yes | the owner stack over body and type declarations: a declaration nested in a body/type gets `owner.name -> child.name` | fixed `1.0`; structural |
| `decorates` | yes | `attribute_statement` → the attribute name; source is the enclosing declaration, or `root` at module level; metadata `attributeName`, `attributeForm: "attribute_statement"` | fixed `0.8`; inferred |
| `exports` | yes | a top-level declaration whose visibility is `public`; source is the literal `root`; `private`/`friend` do not export | fixed `1.0`; structural |
| `implements` | yes | `implements_statement` → the interface name (`field("name")` / the `as_type_clause` identifier) | fixed `0.9`; structural |
| `imports` | yes | `declare_function_statement` / `declare_sub_statement` → the `field("library")` string literal, quotes stripped; target is the external library, source is `root`; metadata `importForm: "declare-lib"`, `libraryName`, `declaration`, `procedure`, `alias` (quotes stripped), `ptrSafe` when present | fixed `1.0`; `import_based` |
| `instantiates` | yes | `new_expression` → the constructed type (`field("type")` or first identifier) | `1.0` if declared in this file, else `0.6`; structural/inferred |
| `references` | yes | `as_type_clause` / `type_expression` identifiers outside an `implements` clause → the named type | fixed `0.6`; usage-contextual |
| `uses` | yes | identifier reads only: `With` receiver (construct `with_receiver`); `On Error` target (`on_error`); `ReDim` name (`redim`); `For`/`For Each` binder/collection/start/end; `Select Case` value and `Case` identifiers; qualified member receivers (construct `member_receiver`, member in metadata); right-hand-side reads of assignment/`Set`; generic identifier reads. Declaration names, parameters, type positions, callees and assignment left-hand sides are suppressed | `1.0` if the target is declared in this file, else `0.6`; usage-contextual |
| `extends` | **no — ruled** | VBA has no class inheritance: 0 of the 164 distinct named node types carry an inheritance production, and there is no `Inherits` keyword. Ladder recorded: R1 unavailable in principle (absent from the language), R2 would fire on 0 sites, R3 has no node carrying a supertype link. Ruling VBA-D4 in `script/m14/spec/vba-completeness.json`; also disclosed in `metadata.vbaGaps` | n/a — not emitted |
| `overrides` | **no — ruled** | no inheritance means no supertype member to override; there is no `Overrides` keyword; 0 of 164 named types carry an override/inheritance production. The four property productions are accessor declarations of ONE property, and interface conformance is already published as `implements`. Ruling VBA-D6 in the spec; ladder R1/R2/R3 recorded there | n/a — not emitted |
| `renders` | **no — ruled** | no render/component/markup production in the grammar (0 of 164 named types). The seven `frm_*` form-designer nodes are declarative layout, and the three `*_fragment` nodes are `#If` partitions, not markup. Ruling VBA-D1 in the spec | n/a — not emitted |
| `mixes_in` | **no — ruled** | no mixin/trait/embed/compose production (0 of 164 named types). The near misses are measured and already published as the relations they are: `implements_statement` → `implements`, `with_statement` → `uses`, and the event surface (`event_declaration`, `with_events_modifier`) → `calls`/metadata. Ruling VBA-D2 in the spec | n/a — not emitted |
| `part_of` | **no — ruled** | no textual inclusion of any kind: VBA has no `#Include`, and a module is referenced through the project, never spliced. `#If` conditional compilation selects lines inside one module. 0 of 164 named types is an inclusion/part production. Ruling VBA-D3 in the spec | n/a — not emitted |

The five ruled types are not silently absent: the analyzer's result carries
`metadata.vbaGaps` with one reason string per type, and the spec records each ruling with
its count and falsifier. The lane's denominator is therefore 9 (`14 - 5`) and the
coverage-block gate reads **9/9 with 0 problems** on 2026-11-02.

## Supported constructs

Fire-and-forbid evidence is the 10 fixture/expectation pairs in
`validation/m14/fixtures/vba/`, authored before the analyzer runs and passing **10/10,
0 fail** (`bun script/m14/run-fixtures.ts --lang vba`, measured 2026-11-02; a scoped run
prints and writes no evidence). The per-type census over that population
(`script/m14/vba-fixture-census.ts` → `validation/m14/measurements/vba-fixture-census.json`,
2026-11-02) is:

| Type | Fixture edges | Fixture files |
| --- | --- | --- |
| `calls` | 13 | 6 |
| `contains` | 10 | 6 |
| `decorates` | 10 | 10 |
| `exports` | 18 | 9 |
| `implements` | 1 | 1 |
| `imports` | 6 | 3 |
| `instantiates` | 1 | 1 |
| `references` | 7 | 4 |
| `uses` | 39 | 7 |
| **total** | **105** | **10** |

- **Module attributes.** `Attribute VB_Name = "…"` and any other `attribute_statement` →
  `decorates` from the enclosing declaration, or `root` at module level. Fixtures:
  `adversarial.bas`, `class-module.cls`, `conditional.bas`, `declare-lib-imports.bas`,
  `form-module.frm`, `loops-and-select.bas`, `member-access.bas`, `nested-with.bas`,
  `representative.bas` (and `control-flow.bas` in the same family).
- **Declarations** (all published as symbols, and as `contains` members when nested):
  `Sub`, `Function`, `Property Get/Let/Set`, `Declare Function/Sub` (including `PtrSafe`),
  `Type` with its members, `Enum` with its members, `Const`, module/`Dim` variables, and
  `Event` declarations. Conditional variants wrapped in `#If` are published too
  (`conditional_sub_declaration`, `conditional_function_declaration`,
  `conditional_property_declaration`) — see the unsupported note on conditional
  compilation state below.
- **Visibility and exports.** `Public` top-level declarations export from `root`
  (fixtures `class-module`, `conditional`, `representative`); `Private`/`Friend` do not.
- **Parameters.** `Optional`, `ByRef`, `ByVal`, `ParamArray` and default values are
  captured as parameter metadata (fixture `loops-and-select`).
- **`WithEvents`** declarations carry `metadata.withEvents: true` on the symbol
  (fixture `control-flow`).
- **Interface conformance.** `Implements IFoo` → `implements` (fixture `adversarial`).
- **External library bindings.** `Declare … Lib "<library>"` → `imports` from `root` to
  the library, with `PtrSafe` and `Alias` in metadata (fixture `declare-lib-imports`, which
  also pins the negative answers: the declared name is not the target, the quote text is
  stripped, and the library never leaks into `references`/`uses`).
- **Calls.** `Call X`, bare call statements (`Sleep 10`), and call expressions; `RaiseEvent
  Changed(value)` → `calls` with `eventRaise`; implicit member calls under `With`
  (`.Run "Refresh"`) keep `implicitMember`/`withReceiver`. Fixtures: `representative`,
  `adversarial`, `control-flow`, `loops-and-select`, `nested-with`.
- **Construction.** `New Widget` → `instantiates` (fixture `representative`).
- **Type positions.** `As` clauses and type expressions → `references`
  (fixtures `adversarial`, `control-flow`, `representative`).
- **Reads (`uses`).** `With` receiver; `On Error` target; `ReDim` name; `For`/`For Each`
  binder, collection and bounds; `Select Case` value and `Case` identifiers; qualified
  member receivers; right-hand-side reads of `=`/`Set`; generic identifier reads.
  Fixtures: `adversarial`, `control-flow`, `loops-and-select`, `member-access`,
  `representative`.
- **Module headers.** `.cls` `VERSION`/`BEGIN`/`END` headers and `.frm` form-designer
  blocks (`Begin VB.Form`, property lines) parse as `frm_*` nodes; they are not modeled —
  no symbols or edges are published from them (fixtures `class-module`, `form-module`).
  The `Attribute` line and the procedures in those files are modeled normally.
- **`.vba` extension.** The router sends `.vba` here as well; the fixture lane uses
  `.bas`/`.cls`/`.frm`, so behavior on `.vba` is router-declared but not fixture-pinned.

## Unsupported / explicit-unknown constructs

Declared, not silently dropped:

- **`extends`, `overrides`, `renders`, `mixes_in`, `part_of`** — ruled in the
  relationship table above (VBA-D1, D2, D3, D4, D6 in
  `script/m14/spec/vba-completeness.json`) and listed in `metadata.vbaGaps`.
- **Conditional compilation state (`#If`/`#ElseIf`/`#Else`).** The analyzer does not
  evaluate preprocessor conditions: declarations inside every branch are published
  regardless of whether the branch is active. Fixture `conditional.bas` pins this
  behavior (the `#If VBA7` branch's `Declare` and `Sub` are both published).
- **`GoTo` / labels.** `goto_statement` and `label_statement` are parsed but produce no
  edge; the `On Error` target is still read as a `uses` (fixture `control-flow`).
- **`WithEvents` event binding.** Only the declaration metadata is recorded; event
  handlers (`Sub worker_Change`) are not linked to the event they handle, and no event
  subscription edge is emitted.
- **Project/COM references and cross-module resolution.** The analyzer is file-local.
  A `Declare … Lib` binding is the only external dependency it publishes; ordinary VBA
  project references (References dialog, COM type libraries) have no source-level node.
  The engine's downstream cross-file resolution is a separate stage and is not measured
  for this lane (no corpus — below).
- **Documentation comments, per-symbol complexity, syntax errors** — not extracted; see
  the symbol contract.
- **Form-designer semantics.** `frm_*` layout/property nodes are ignored; only
  `Attribute` statements and ordinary procedures in `.frm` files are modeled.
- **`Def<Type>`, `Erase`, file-I/O statements, `TypeOf`/`AddressOf`** — parsed by the
  grammar, no dedicated handler. Identifiers inside them may still surface through the
  generic read paths; that is not construct-aware analysis.

## Regex inventory

The analyzer is regex-free. Measured, not asserted:

| File | HEAD regex usages | Census entries |
| --- | --- | --- |
| `src/ast/real-vba-analyzer.ts` | **0** | 0 |

- `validation/m12/results/regex-census.json` (AST census over the committed analyzer
  blobs, generated 2026-11-01) records `totalRegexUsages: 0` across `analyzersScanned:
  50` with an empty `perFile` list — there is no vba row because there is no vba usage.
- `bash script/m14/no-regex-gate.sh` prints `TOTAL 0 in scope (whole tree: 0)` and
  `PASS — 0 regex literals, by AST census` (measured 2026-11-02).
- Because there are no regex literals, there are no `replaceable`/`needs_review` rows to
  classify and the "zero unclassified regex" rule holds trivially. The M12
  per-analyzer table format in the template is therefore empty by measurement, not by
  omission.

## Complexity envelope

**The M12 complexity artifact does not exist for this lane.** There is no
`validation/m12/results/vba-complexity.json` and no `vba-*` artifact under
`validation/m12/results/`. No declared performance budget exists either:
`validation/m60/analyzer-budget-register.json` carries no vba entry (measured 2026-11-02).
Both are gaps in the lane's measurement apparatus, recorded rather than filled with
another corpus's numbers.

What was measured instead is the only population this lane has — the 10 fixture files —
through `bun script/m12/vba-corpus-measure.ts`, wrapped in `/usr/bin/time -v`, one run,
2026-11-02:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `validation/m14/fixtures/vba` | 10 | 36 | 105 | 10,720 | 3.36 | 9.80 | 309,744 KB |

Read this row narrowly: the run is **fixture-scale**, and its wall time is dominated by
process start plus grammar/WASM load — user CPU 0.69 s and system CPU 0.37 s, i.e. 9 % of
one core over 10.72 s. The rates are arithmetic over that wall and are **not** analyzer
throughput. A production-corpus envelope cannot be produced: the corpus contains no
genuine VBA (see below).

**Hot-path audit — structural, reasoned from the source, not profiled.** There is no
flamegraph or per-phase timing for this lane (that is the gap this section names).

- `collectDeclarations` is one preorder walk over named children with an O(1) `Map` probe
  per node for a declaration type.
- `publishDeclaration` does O(1) inserts (symbol array, `nodeSymbols` by `startIndex`,
  folded-name `Map`, callable/variable `Set`s).
- `walk` is one preorder walk. The only repeated walks are ancestor climbs
  (`hasCallAncestor`, `withReceiverFor`) that stop at the nearest `block`/body boundary,
  so they are O(nesting depth) per identifier, not O(file). `hasNodeType` (the
  `WithEvents` probe) walks a declaration's own subtree once at publish time; those
  subtrees are disjoint, so the total is O(nodes).
- `emitReads` recurses over one assignment/set right-hand-side expression; each node is
  visited once per right-hand side.
- `dedupe` is one `Set` pass plus filter over the relationship array — O(edges).
- No per-symbol whole-file scan, no nested-scan product, no regex. The only O(file)
  string pass is `lineCount`, executed once per file.
- The one superlinear risk is deep nesting (an ancestor climb per identifier); it is
  bounded by source nesting depth and was not profiled. What would verify this: a
  per-phase timing breakdown on a real corpus, which requires the corpus this tree does
  not have.

## Differential ground truth

**There is no M12 ground truth or differential artifact for VBA, and precision, recall,
false-positive, false-negative and unknown rates are UNKNOWN — they cannot be computed.**

- `validation/m12/ground-truth/vba.json` does **not** exist (the directory holds 47
  language files; vba is not among them).
- `validation/m12/results/vba-differential.json` does **not** exist.
- No authority-tagged fact set (`source`, `compiler`, `language_service`, `ide_index`,
  `manual_audit`) exists for this lane, so an M12-style differential cannot be run and no
  rate is quoted.

What the lane has instead, all measured:

- **10 fixture/expectation pairs** authored before analyzer runs, with fire **and**
  forbid rows, passing **10/10, 0 fail** (`bun script/m14/run-fixtures.ts --lang vba`,
  2026-11-02). The forbids are the negative half — e.g. `declare-lib-imports` forbids 11
  wrong answers (import attributed to the enclosing procedure, the declared name as the
  import target, quoted library text, library leaking into `references`/`uses`), and
  `adversarial` forbids `references -> IWorker`, which must be `implements`.
- **Canonical F3 evidence already includes this lane.** `validation/m14/results/M14.0.F3.json`
  (committed evidence, regenerated 2026-11-01 at commit `b1947a2f`) carries **10 vba
  fixture rows, all `ok: true`**, including `vba/declare-lib-imports`. A scoped
  `--lang vba` run prints its result but writes no evidence.
- **A contract differential.** `script/m14/vba-differential.ts` runs the production
  `ASTEngine.parseFile` over `validation/m14/fixtures/vba/representative.bas` and fails on
  empty names, unknown symbol kinds, unlined relationships, or any relationship type
  outside the 9-label contract. Measured 2026-11-02: `symbols=6 relationships=17
  failures=0`.
- **Mutation ground truth for the fixture suite.** `script/m14/vba-mutants.ts` registers
  7 mutants — five drop a relationship type (`calls`, `instantiates`, `contains`,
  `exports`, `decorates`) and two drop evidence metadata (`construct` on a `With` receiver,
  `implicitMember` on an implicit-member call). Scoped run 2026-11-02
  (`bun script/m14/mutate-analyzer.ts --lang vba`): **all 7 caught**, with 5/1/1/3/4/3/2
  new fixture failures respectively.

The gap this section names: without an authority-tagged ground truth, the fixture suite
proves the analyzer matches its *own* written contract and that the suite can fail; it
does not prove the contract matches VBA semantics. Closing that requires a real VBA
corpus and an independent fact source.

## Corpus validation

**This is an analyzer-present, corpus-absent lane.** Measured 2026-11-02, corpus root
`<corpus-root>`:

```
find <corpus-root> -type f \
  \( -iname '*.bas' -o -iname '*.cls' -o -iname '*.frm' -o -iname '*.vba' \) | sort
```

→ **2 candidates corpus-wide, 0 genuine VBA files** (`.bas` 0, `.cls` 2, `.frm` 0,
`.vba` 0). Both candidates are LaTeX document classes that match only because the router
sends `.cls` to the VBA analyzer:

| Candidate | Classification |
| --- | --- |
| `nim/doc/nimdoc.cls` | LaTeX2e document class — line 1 is `\ProvidesClass{nimdoc}[…]`; 196 lines of TeX |
| `r-pkgdown/vignettes/test/jss.cls` | LaTeX document class, docstrip-generated; 509 lines of TeX with `\ProvidesClass` |

Consequences, stated instead of smoothed: the whole-population arm (the DONE condition
that needs a derived declaration) **cannot be run on genuine VBA in this tree**, and an
arm over the 2 admitted extension candidates would measure a LaTeX class parsed as VBA —
an ERROR-node population, not a VBA population. So no whole-population edge count is
claimed anywhere; the spec's `coverage._implemented_measured` block states its population
as the **fixture** population, and the arm command and expect-population rule are recorded
there for when a genuine corpus arrives. `validation/m12/corpus-manifest.json` likewise
has no vba entry.

What the lane does publish, measured 2026-11-02:

- **Fixture population:** 10 files, 36 symbols, 105 relationships, **0 parse errors, 0
  crashes** (`bun script/m12/vba-corpus-measure.ts`), with the per-type split in
  [Supported constructs](#supported-constructs). Canonical F3 artifact: 10 rows, all pass.
- **Grammar inventory:** 418 ids / 183 named slots / 164 distinct named names
  (`validation/m14/measurements/vba-grammar-nodes.json`); the rulings for the five
  absent types are counted against it.
- **Grammar conformance:** vba PASS, `refs=31 unknown=0 unknownFields=0`
  (`bun script/m14/audit-analyzer-grammar.ts`; the process exits non-zero fleet-wide for
  other lanes' unregistered literals, not for vba).
- **Completion-block gate:** `implemented 9 / applicable 9`, 5 exclusions, 0 problems
  (`bun script/m14/coverage-block-gate.ts`).
- **Grammar pin:** wired sha256 matches `validation/m14/vba-grammar-pin.json` (0 drift),
  but the pin row is unregistered in the two lane tables named in the Language section.

What would close condition 2: a genuine VBA corpus (recorded decision pending; the matlab
lane carries an identical finding), then
`npx tsx script/m14/sliced-declaration.ts --lang vba --slices <dir> --exts vba,bas,cls,frm
--expect-population <the gate's own admitted N> [--closure <merge>] --write`. The fleet's
firing-log instrument currently has no VBA row (`notFired: true`); that is a fleet
instrument gap, not a lane measurement claim, and a firing run with no corpus would
legitimately print NO CORPUS.

## Evidence pointers

- Analyzer: `src/ast/real-vba-analyzer.ts`
- Grammar: `grammars/tree-sitter-vba/`; wired bytes `wasm/tree-sitter-vba.wasm`;
  pin `validation/m14/vba-grammar-pin.json`
- Grammar inventory: `validation/m14/measurements/vba-grammar-nodes.json`
  (`bun script/m14/grammar-node-inventory.ts vba`)
- Completeness spec (rulings, ontology denominator, corpus absence):
  `script/m14/spec/vba-completeness.json`
- Fixtures: `validation/m14/fixtures/vba/` (10 pairs)
- Fixture census: `validation/m14/measurements/vba-fixture-census.json`
  (`bun script/m14/vba-fixture-census.ts`)
- Fixture results (canonical): `validation/m14/results/M14.0.F3.json` → 10 vba rows
- Contract differential: `script/m14/vba-differential.ts`
- Mutation registry: `script/m14/vba-mutants.ts` (7 mutants)
- Corpus measure: `script/m12/vba-corpus-measure.ts`
- Regex census: `validation/m12/results/regex-census.json`; no-regex gate:
  `script/m14/no-regex-gate.sh`
- Grammar conformance: `script/m14/audit-analyzer-grammar.ts`
- Coverage gate: `script/m14/coverage-block-gate.ts`
- Doc gate: `npx tsx script/m14/verify-analyzer-docs.ts --lang vba`

# GraphQL analyzer

## Language

- Analyzer: `src/ast/real-graphql-analyzer.ts`
- Grammar: **vendored, patched and pinned** — `wasm/tree-sitter-graphql.wasm`
  is a build of `grammars/tree-sitter-graphql/`, whose source is upstream
  `bkegley/tree-sitter-graphql@ee5ce96` plus a generated patch (see
  `grammars/tree-sitter-graphql/README.md` and `port.py`). The pin, its
  provenance, its rejected alternatives and the offline source↔wasm proof live
  in `script/m14/verify-grammar-pins.ts` under the `graphql` lane.
- Detection: `.graphql`, `.graphqls`, `.gql` → `graphql` in
  `src/ast/language-detection.ts`
- Wiring: `ASTEngine` → `RealGraphqlAnalyzer`

### The node names are a contract

Rules are **PascalCase** (`ObjectTypeDefinition`), which is upstream's
`snake_case` renamed. This is not cosmetic: the analyzer dispatches on
`node.type === "ObjectTypeDefinition"`, and so do the m12 shape-safety census,
the m14/m60 lanes and every stored symbol row. Upstream `main` used unmodified
gives 72 node types gained and 72 lost with identical names apart from casing —
every construct would fall through the default arm. `source_file`, `comment` and
`comma` are held lower-case because that is what the previous build exposed.

## Symbol contract

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| `schema` definition / extension | `namespace` | `SchemaDefinition` / `SchemaExtension` | `schema` |
| root operation (`query`/`mutation`/`subscription`) | `property` | `OperationTypeDefinition` | `schema.<op>` |
| object type | `class` | `ObjectTypeDefinition` / `ObjectTypeExtension` | type `Name` |
| interface | `interface` | `InterfaceTypeDefinition` / `InterfaceTypeExtension` | type `Name` |
| union | `type` | `UnionTypeDefinition` / `UnionTypeExtension` | type `Name` |
| enum | `enum` | `EnumTypeDefinition` / `EnumTypeExtension` | type `Name` |
| enum value | `enum_member` | `EnumValueDefinition` | `Enum.<value>` |
| scalar | `type` | `ScalarTypeDefinition` | type `Name` |
| input object | `class` | `InputObjectTypeDefinition` / `InputObjectTypeExtension` | type `Name` |
| directive definition | `function` | `DirectiveDefinition` | `@name` |
| field | `property` | `FieldDefinition` | `Type.field` |
| input field | `property` | `InputValueDefinition` under `InputFieldsDefinition` | `Input.field` |
| operation | `method` | `OperationDefinition` | name, or `anonymous_operation_<startIndex>` |
| fragment | `method` | `FragmentDefinition` | fragment name |
| variable | `variable` | `VariableDefinition` | `$name`, owned by the operation |

An `InputValueDefinition` under `ArgumentsDefinition` is a **parameter** of the
field or directive definition, not a symbol.

**Extensions.** `extend type X { … }` contributes **members** of `X`, tagged
`metadata.inExtension`. Whether it also emits a symbol for the name depends on
the file: if the file declares `X`, the extension contributes members only — a
second `class X` would be a duplicate identity in the index; if it does not, the
extension is the file's only word about `X`, so it emits a `partial` symbol,
because the `contains` edge needs a source. That decision comes from a pre-pass
over the document's top-level definitions. `extend scalar S` emits **nothing**: a
scalar extension has no members, and it is recorded on the scalar's own metadata
instead.

Every symbol carries an AST-derived range — **1-based line, 1-based column, and
`startIndex`/`endIndex` measured in CHARACTERS, not bytes** — plus
`ownerName`/`ownerKind`, `returnType`/`parameters`/`defaultValue`, and
`docstring` — the description's **value** (§2.9.4: escapes resolved, block
strings dedented), not its raw text. `metadata.graphqlType` is the grammar's node
type on every branch; `metadata.graphqlCategory` is the specification's word for
the same thing; `metadata.topLevel` marks a type-system declaration.

## Relationship ontology

- `contains` — type → field, enum → value, input → input field, `schema` → root
  operation type (qualified identities).
- `implements` — object/interface → **every** implemented interface.
- `uses` — type references: field return type, field argument type, **directive
  argument type**, input field type, **variable type**, union member, root
  operation type, and **directive application**; plus executable references: field
  selection, fragment spread, fragment and inline-fragment type condition,
  **variable reference**, and **enum value reference**.

### The three families the final master review found missing

A differential whose ground truth omits a family agrees *perfectly* with an
analyzer that omits it, so counting relationships can never find a whole missing
family — only asking "what does the specification make referenceable?" can. The
final master review worked that way and found **three referenceable families**
that were present in the fixtures and emitted nothing:

| family | the gap | the fix |
|---|---|---|
| `variable_type` | a `VariableDefinition`'s declared type had **no** edge, while a field return type, an argument type and an input field type all had one — so a variable was the only declared type in the language with no relationship to it, and `returnType`/`rawType` carried the fact as a string where every sibling fact is an edge | emit `uses` from the variable, with the `Type` node's own line |
| `enum_value_reference` | an enum member named in a **value position** — an input field default, an argument default, a variable default, an executable field argument, a directive argument — was recorded only as an opaque string in `defaultValue`, so the enum member was a declared symbol that **nothing ever referenced** | collect `EnumValue` nodes and emit `uses` |
| `directive_argument_type` | the `DirectiveDefinition` branch emitted the `@name` symbol with `parameters` and then **no relationships at all**, so `directive @auth(requires: Role = ADMIN)` said nothing about `Role` — and a directive's argument type was the only declared type in the language with no edge to it | emit from the directive symbol, one per argument |

Two details that are the whole correctness of the third family:

- **A declaration is not a reference.** The grammar puts an `EnumValue` node in
  both an `EnumValueDefinition` (a declaration, already a symbol with a `contains`
  edge) and a `Value` (a reference). The test is the **parent**, never the node
  type alone. All six call sites pass a `Value` or `DefaultValue` subtree, where
  the test is therefore unobservable today — so the mutant that drops it is
  declared **equivalent by construction**, with the structural reason recorded
  rather than the mutant quietly deleted. It becomes load-bearing the moment a
  call site passes anything wider.
- **Qualify only where the document says so.** `color: Color = RED` proves `RED`
  is `Color.RED`, because an `InputValueDefinition` and a `VariableDefinition`
  each carry their own `Type` sibling; the target is qualified. But
  `item(filter: { color: RED })` names the *input object*, and reaching `Color`
  needs that object's declaration, which is in another file — so the target stays
  the bare `RED` and the store's unique-name strategy decides it. This is the same
  rule the analyzer already applies to a field selection, and naming a type in the
  executable case would be a fabrication.

`ImplementsInterfaces`, `UnionMemberTypes` and `DirectiveLocations` are
**left-recursive**, so the tree nests (`I > I > I` for `A & B & C`). Every
`NamedType`/`DirectiveLocation` in the subtree is collected, which is correct for
a nested tree and for a flattened one. Reading only direct children loses
everything but the last clause.

A field selection targets `<Type>.<field>` when the document itself states the
type — a fragment or inline-fragment type condition — and the bare `field` name
otherwise, because inside a field's own selection set the parent type is the
field's return type and an executable document does not carry it. Every
executable relationship carries `meta.selectionPath` so the two forms are
distinguishable. An alias is not a fact: `nick: name` references `name`.

## Lines

`nodeToRange` skips a leading `Description`, so a described definition's line is
the line its first token is written on. This is the M59/#861 rule — *a decorated
declaration's line belongs to the name, not to its decorator*
(`reviews/m59-861-decorated-declaration-lines.md`) — already applied to scala
(`declaration-lines-825`), typescript and javascript. On the GitHub public schema
the naive range pointed at the docstring for **3,131 of 3,332 symbols**; it now
points at the docstring for **0**.

**Every relationship carries `line_number`**, read off the AST node that *names*
the fact: the interface name in an `implements` clause, the `NamedType` of a type
reference, the field's own `Name` for `contains`. The store's relationship
identity is `(source, target, type, line)`
(`parallel-indexer.ts` ~L2844), so a line-less edge collapses two genuine facts
into one row — `f(x: Int): Int` has a return type and an argument type of `Int`,
on one line, under two roles. A line is never invented; a relationship whose
source or target would be empty is refused at the emitter, because the grammar's
recovery for an unresolvable type produces a `Type` node with a MISSING `Name`.

### Columns and offsets are characters, and tree-sitter's own docs say bytes

This is worth stating because the obvious reading of the upstream documentation is
wrong in a way that produces a silent, hard-to-spot bug. tree-sitter's C API
documents `TSPoint.column` as *"the zero-based **byte** offset of the node from the
start of its row"*, and the `start_index` fields as byte offsets. **web-tree-sitter
reports characters**, measured rather than assumed, on a line where the two differ:

```
  "ééé" field: String      21 characters, 24 bytes
      ^ the `f` of `field`
  binding startPosition.column = 8   character index of `f` = 8   byte index = 11
  binding startIndex          = 21   src.slice(21, 26) === "field"   (a byte slice returns mojibake)
```

So the analyzer's `startColumn` is a 1-based **character** column — which is what an
editor shows and what a column number is expected to mean — and `startIndex` /
`endIndex` are **character** offsets, so `content.slice(startIndex, endIndex)`
returns the symbol's own source text. A consumer that reads these as byte offsets
and slices a `Buffer` gets corruption on any file with non-ASCII before the symbol,
and GraphQL descriptions are routinely non-English, so this is not an edge case.

**Do not "fix" this by converting.** The conversion looks necessary from the
upstream docs and would break the analyzer; the corpus sweep's own
`rangeExcludesOwnName` check slices the source with these offsets and is green on
the three fixtures that contain non-ASCII (`05-collision`, `06-identity`,
`07-damaged`), so a conversion would turn that gate red. Every analyzer in the
repository passes the binding's value straight through (61 sites), so this is the
house convention and not a graphql-local decision.

## Argument optionality

`isOptional` follows the specification, not a guess from `!`: an argument is
optional only when it is **nullable and has a default** (§3.6.1). `f(a: Int)`
is required even though `Int` is nullable, because a caller must pass something;
`f(a: Int = 1)` is not. Read off the `NonNullType` node, never off
`typeNode.text`.

## Resolution: what "resolvable" means at project scope

An in-file resolvability number is the wrong instrument for a language whose
schemas are routinely split across files, so the question is settled against the
**project** symbol table, mirroring the store's own two strategies
(`parallel-indexer.ts` `resolveRelationships`: strategy 1 qualified-name exact
against `_res_qname`, strategy 2 bare name **only when it is unique**, `cnt = 1`,
against `_res_name`). On the 47-file corpus, of 19,054 relationships:

| how it resolves | count | share |
|---|---|---|
| a symbol of its own file | 4,961 | 26.04% |
| a qualified name, `Type.field` (strategy 1) | 7,730 | 40.57% |
| a **built-in scalar** — `Int Float String Boolean ID` | 4,412 | 23.15% |
| a **spec meta-field** — `__typename __schema __type` | 333 | 1.75% |
| a bare name that is unique project-wide (strategy 2) | 357 | 1.87% |
| **project resolvable** | **17,793** | **93.38%** |
| ambiguous bare — several owners, so undecidable **by the store's own rule** | 747 | 3.92% |
| dangling — the name exists in no file of the project | 514 | 2.70% |

**Sources are checked too, and the check has a negative control.** A relationship
whose *source* names nothing is a fact about nothing, and until the master review
nothing measured that at all: the corpus sweep only ever counted unresolved
*targets*. So the same probe now resolves every source by the store's own two
strategies and reports **0 unresolved sources** across all 19,054 relationships.
The first version of that check was **too lenient and its negative control failed
to fail** — it accepted any bare name appearing on some symbol, so an edge from
`role` (unique in this corpus, and so genuinely resolvable) and an edge from
`no_such_symbol` both passed. It now judges a source exactly as it judges a
target, and the control aimed at the corpus's dominant `field_argument` path
reports **30 unresolved sources and exits non-zero**. A gate that cannot fail is
not a gate.

The load-bearing number is **0**: `resolvableQualified`, the class where the
metadata names an enclosing type, `Type.field` exists in the project, and the
edge was still emitted bare. It is empty, so the analyzer qualifies everything it
can prove — `script/m14/tmp/graphql/probe/project-resolution.mts` exits non-zero if it
ever stops being empty, and that is gate 8b.

The 747 are **not** a defect. `id` has 305 candidate owners and `slug` has 37
across the corpus, and the store refuses a bare name that is not unique, so those
edges are undecidable by design and the analyzer is right to leave them bare
rather than guess an owner. The 514 dangling are bare names plus qualified ones
whose type condition the project never defines (a selection inside `... on Test`
where no file declares `Test`) — the analyzer qualified them from the only
evidence the document itself carries, and the reference is genuinely absent. All
of it is recorded in `script/m14/tmp/graphql/out/project-resolution.json` rather than
folded into a percentage.

Built-in scalars and introspection meta-fields are **specification vocabulary**:
every schema answers them and no schema declares them, so no `brain_symbol` row
will ever exist and neither store strategy can land them. That is a property of
the store, not of the edge — the edge names exactly what the document says.

## Robustness: degenerate input and pathological depth

Every other gate in this lane feeds the analyzer well-formed, shallow, ASCII
GraphQL. That comfortable test set hid a real defect, and the shape of it is worth
recording.

`findDescendant` walked the AST by **recursion**, and it recurses to the depth of
the subtree whenever its predicate does not match early. `[[…[Int]]]` is exactly
that case, because the `NamedType` sits at the **bottom**. Measured: list nesting
**2,749 deep threw `RangeError: Maximum call stack size exceeded`**, and the
engine's guard turns any throw into a minimal result — so the file yielded **zero
symbols** and one opaque error, silently losing a whole type definition. The
threshold is a function of stack-frame size, so it is a platform figure rather than
a guarantee.

It survived the corpus for a reason that is itself a lesson: **`A & B & C` never
triggered it.** The left-recursive rules put a `NamedType` at depth 1, so the
predicate matched immediately and the recursion never went deep — 5,000 clauses
worked. A defect only one shape of input can reach is a defect a representative
corpus will not find, and this corpus is three real repositories and still missed
it.

**Four** helpers were converted to an explicit stack, and the gate that found the
first one then found three more at 20,000 clauses that the earlier probe had not
reached:

| helper | exposed by | before | after |
|---|---|---|---|
| `findDescendant` | `[[…[Int]]]` | threw at 2,749 | ok at 20,000 |
| `enumValueReferences` | a deeply nested `Value` | same class | ok at 20,000 |
| `collectNamedTypes` | `A & B & C …` (left-recursive) | ok to 5,000, threw at 20,000 | ok at 20,000 |
| `collectDirectiveLocations` | `on A \| B \| C …` | ok to 5,000, threw at 20,000 | ok at 20,000 |

Children are pushed in **reverse** so they pop in order, which preserves the
pre-order the recursion produced — the conversions are behaviour-preserving, and the
differential is unchanged at P=1.000 / R=1.000. A 20,000-clause `implements` chain
now yields 40,002 symbols and 60,002 relationships instead of throwing.

Gate 8e asserts three further properties, and each of them was a dimension **no
other gate touched**:

- **Linearity, counted rather than timed.** "A single iterative DFS" is a claim
  about complexity, and a complexity claim needs a curve. The same schema shape is
  generated at six sizes spanning **32×**, and
  **accessor calls per symbol is flat to 1% across a 32× size range** (54.67 →
  55.47). The milliseconds in the same run
  swing 719 → 284 → 400 ms/1k symbols, and two sessions of the identical binary
  disagreed on the direction — one falling 457 → 241, the next rising 120 → 366 — so
  a time-based linearity gate here would be a flaky gate, and a flaky gate gets
  disabled. Counted calls are exact and machine-independent, which is the same
  reason gate 10b counts rather than times.
- **Idempotence, including on a shared instance.** The analyzer keeps its
  `node.type` memo on the *instance*, and the engine happens to build a fresh
  analyzer per file — a caller invariant, not a guarantee. One shared instance
  running every fixture in four orders plus twenty repeats of one file is
  **identical across four orderings and twenty repeats on one shared instance** —
  byte-identical to a fresh instance per file, so a memo that outlived a call would
  be caught.
- **The production engine path.** Every gate here calls the analyzer *directly*.
  Production does not: `ASTEngine.parseFile` inserts timeout handling, the
  `ERROR`/`MISSING` walk and the ambiguity counters between the tree and the result.
  The two are compared identity by identity over the fixtures, and
  **the production engine path preserves every identity**, including the damaged
  fixture whose five grammar errors the engine surfaces and the direct analyzer never
  sees by design.

  The first version of that check reported **all seven fixtures differing**, with a
  syntax error at line 1 columns 1–8 on every one — a result that reads exactly
  like a catastrophic production defect. It was the check's own fault:
  `parseFile(filePath, content, context?)` takes the file's **content** second, and
  the language string had been passed there, so the engine parsed the seven
  characters `graphql` as a document. The wasm hash and the signature were both
  checked before any of it was reported.

Gate 8e also runs twelve **degenerate** files that no other gate would produce: an
empty file, whitespace only, comment only, no trailing newline, a UTF-8 **BOM**,
**CRLF** line endings, tabs, non-ASCII before a name, invalid UTF-8 in a comment,
4,000 fields on one line, and trailing blank lines. Every one must produce a result
— possibly zero symbols — and never an exception; every symbol's range must be
1-based and its offsets must slice out its own source text.

## Regex and text-scan inventory

**0 regex usages.** `validation/m12/results/regex-census.json` has no
`real-graphql-analyzer.ts` row, and the committed analyzer at `HEAD` was already
regex-free — the count is 0, not "pending paydown". Zero `RegExp` calls, and no
`match` / `matchAll` / `replace` / `search` / `split` used as a parser —
machine-checked by `script/m14/tmp/graphql/probe/no-text-scan.mts`, which also has
**two negative controls** proving it can fail. Descriptions are unquoted by
`slice` plus an explicit escape scan, and block strings are dedented by the
§2.9.4 algorithm implemented line by line. Three `String` operations remain and
are printed as permitted: `content.split("\n")` for the line count,
`inner.split("\n")` for the dedent, and `replaceAll('\\"""', '"""')` for the
block-string escape.

> A dated handoff, `docs/M12.08-HANDOFF.md`, still records graphql as one of "the
> 2 remaining *replaceable* entries". That was already untrue at `HEAD` and is
> left as written, because rewriting a dated milestone record to match today's
> counts falsifies it. The current truth is the census plus this section.

## Imports and exports

GraphQL has no `import` syntax, so **`imports` is always empty** and that is not a
gap to be filled. `#import` is a non-standard comment convention, not GraphQL, and
is not parsed.

**`exports` is the schema's public type surface**: every top-level type-system
declaration, marked `metadata.topLevel` at emit time rather than re-derived from a
string vocabulary afterwards. That includes the `schema` namespace, object /
interface / union / scalar / enum / input types, **and directive definitions** — a
schema's directives are part of what it offers a client as surely as its types. The
GitHub public schema yields 540 exports from its 540 top-level declarations, and
1,472 across the corpus. The rule is pinned by the differential, whose truth lists
`schema`, `@auth` and `@tag` as expected exports of `01-sdl-core.graphql`, so
narrowing the rule to object types would fail rather than pass quietly.

## The metadata surface

Every key the analyzer sets, so a consumer does not have to read the source to find
out what is available:

| key | on | meaning |
|---|---|---|
| `graphqlType` | symbol | the grammar's node type for that construct |
| `graphqlCategory` | symbol | the **specification's** word for the same thing |
| `graphqlRole` | symbol | the construct's role: `operation`, `fragment`, `variable`, `field`, `input_field`, `enum_value`, `directive_definition`, `root_operation_type` |
| `topLevel` | symbol | a type-system declaration, so it is an export |
| `droppedExtensionSymbol` | — | **not on a symbol**: set on a symbol that was *withdrawn* because the file also declares the type, so `extend type X` cannot mint a second `X`. It is the audit trail for a symbol that is deliberately absent — without it, "absent" and "suppressed as a duplicate" are indistinguishable |
| `directiveName` | symbol | a directive definition's **bare** name (`auth` for `@auth`), so the name and the reference spelling do not have to be un-mangled downstream |
| `graphqlDirectives` | symbol | the directive applications on that declaration, structured (name, arguments, line) |
| `rawType` | symbol | the declared type's **source spelling**, for when the resolved name is not enough (`[Foo!]!`) |
| `nullable` | symbol | read off the `NonNullType` node, not off the text |
| `inExtension` / `extension` | symbol / relationship | the declaration came from an `extend` |
| `repeatable`, `locations` | symbol | a directive definition's `repeatable` keyword and its locations |
| `selectionPath` | relationship | the dotted path of an executable selection, so a qualified and a bare target are distinguishable |
| `enclosingType` | relationship | the type the **document** states for a selection — present only when it stated one, which is exactly when the target is qualified |
| `alias` | relationship | `nick: name` references `name`; the alias is recorded, not published |
| `arguments` | relationship | a directive application's argument name → literal source text |
| `within` | relationship | the executable root a directive application sits inside |
| `argument`, `declaration`, `enumType`, `directive` | relationship | which argument, which declaration site, the enum the document stated, and the directive an argument belongs to |

## Explicit boundaries

- A directive argument is a **constant** in GraphQL (the specification forbids
  variables there), so the `Value` node's own text is the literal's exact source
  spelling. Nothing is unquoted or guessed.
- `#import` is a non-standard comment convention, not GraphQL syntax; it is not
  parsed.
- Field selections inside a field's own selection set target a bare name, because
  an executable document does not carry the field's return type. Measured at
  project scope, with every residual classified and none of them provable: see
  **Resolution** above and REVIEW.md §G.
- The block-string rule accepts `"""a\""""` as the block string `a"` followed by a
  stray quote. graphql-js agrees (`BlockStringValue` is greedy to the last
  `"""`), so tightening it would make this grammar disagree with the reference
  implementation. Recorded, not hidden.
- The block-string rule accepts `"""a\""""` as the block string `a"` followed by a
  stray quote. graphql-js agrees (`BlockStringValue` is greedy to the last
  `"""`), so tightening it would make this grammar disagree with the reference
  implementation. Recorded, not hidden.
- `errors` is empty by design: `ASTEngine.parseFile` walks `ERROR`/`MISSING`
  nodes after this analyzer returns (`engine.ts` ~L1194), so the engine's rows
  are the real ones. Calling the analyzer directly yields `errors: []`, which is
  why the corpus sweep measures grammar errors from the tree and not from the
  analyzer.

## Evidence

Every artifact below is regenerable, and **they are here, in the repository**:
`script/m14/tmp/graphql/` holds the probes, the hand-derived ground truth, the
fixtures, the runner and the artifacts themselves. That was not always so — the
lane lived outside version control, which meant a clone had none of it and every
number in this document was unverifiable from a checkout. One input is
deliberately external: the 1.2 GB third-party corpus, fetched by
`script/m14/tmp/graphql/clone.sh` at the exact revisions
`script/m14/tmp/graphql/repositories.json` records.

Run it with `script/m14/tmp/graphql/run-all.sh --corpus`. Every probe invocation in
that runner is relative to the lane directory, and a claim enforces it: when gate
8c was first added, a gate still pointed at the **old** `fixtures` fixture path:
it passed in the working tree because the two copies were identical at the time,
and it failed in the suite the moment they diverged. A gate that reads
a copy of its own fixture is a gate that can pass without testing anything.
**Gate 11 runs last and that ordering is load-bearing**: it re-derives every number
above from the artifacts, four of which (corpus-sweep, project-resolution,
perf-accessors, extraction-ab) are produced by gates 8, 8b, 9 and 10b. It used to
be gate 7, which passed only because those artifacts were left over from an
earlier run — so on a clean checkout the one gate whose job is to catch a stale
claim was the gate that could not run.

| artifact | what it is | headline |
|---|---|---|
| `validation/m12/results/graphql-contract.json` | 37 hand-audited assertions over the m12 fixtures | **37/37** |
| `validation/m12/results/graphql-shape-safety.json` | every node type the analyzer names vs every one the grammar produces, over 117 inputs including the 113-construct specification battery | **71 referenced / 71 live / 0 dead / 0 fatal unnamed** |
| `validation/m12/results/graphql-corpus-errors.json` | every tracked corpus file through the production `parseFile` path | **0 error files, 0 crashes**, and an explicit statement that a 2-file corpus is not coverage |
| `validation/m12/results/graphql-corpus-complexity.json` | production throughput | 3,251 symbols / 6,418 relationships, plus a `performanceTruth` field recording the analyzer is **1.62× slower** than the one it replaced and what the time buys |
| `validation/m14/fixtures/graphql/` | the lane's two m14 fixtures, each with an expectation file | **2/2 pass**, as gate 8d and as the `fixtures-graphql` check in the canonical `validation/m14/results/M14.0.F3.json`. That artifact is cross-lane and only a run covering **every** lane may write it, so the lane asserts its own two fixtures directly rather than reading a file it cannot regenerate — the milestone check is corroboration, not the lane's evidence |
`fixtures-graphql`. The canonical `validation/m14/results/M14.0.F3.json` does **not** yet name this lane: only a run covering every lane may write it, by the runner's own rule, so it is regenerated milestone-wide rather than by this lane. A cross-lane gap, recorded here rather than papered over with a lane-owned artifact that would shrink the milestone's claim |
| `validation/m14/grammar-pins.json` | the grammar pin | wired sha `f988e0a0…`, 13 vendored files, mirror byte-identical, source↔wasm proof **zero in both directions** |
| `script/m14/tmp/graphql/out/contract-battery.json` | 52 hand-audited cases | **52/52** |
| `script/m14/tmp/graphql/out/differential.json` | hand-derived ground truth, 7 fixtures, 8 channels | **292 facts, P=1.000, R=1.000** |
| `script/m14/tmp/graphql/out/mutation.json` | 36 mutants, one per finding | **30 caught, 0 survived**; 2 defeated by another guard (defence in depth, measured); 4 declared equivalent — two of them **derivable** from the grammar's own rules rather than merely unobserved. **0 unapplied** — an anchor is a verbatim copy of analyzer source, so when `topLevelDefinitions` was refactored the anchor went stale, the mutant silently stopped testing anything, and the harness reported it as a *survival*. An unapplied edit is now a hard failure with its own exit path, because a suite that prints "0 survived" while a mutant was never applied proves nothing |
| `script/m14/tmp/graphql/out/grammar-gaps.json` | 113 specification constructs | **0 valid constructs rejected**; 8 invalid still rejected |
| `script/m14/tmp/graphql/out/corpus-sweep.json` | 47 real files, 4 repositories, 691,855 bytes | 8,747 symbols, 19,054 relationships, **0 phantoms, 0 duplicate identities, 0 crashes, 12/12 extension members** |
| `script/m14/tmp/graphql/out/project-resolution.json` | all 19,054 relationships decided at **project** scope against the store's own two strategies, **sources included** | **93.38% resolvable**; **0** provable-but-unqualified; **0** unresolved sources; 747 ambiguous by the store's own uniqueness rule; 514 genuinely absent |
| `script/m14/tmp/graphql/out/extraction-ab.json` | the same analyzer under both grammars | **12 → 4** error files, **20 → 7** error nodes, **+4 symbols, +76 relationships**, every delta adjudicated in REVIEW.md §E |
| `script/m14/tmp/graphql/out/source-guards.json` | zero-regex and no-structural-text-scan | **HOLDS / HOLDS**, with 2 negative controls |
| `script/m14/tmp/graphql/out/perf-attribution.json` | a 2×2 attribution, one cell per process | parse ×1.55, analyze ×1.65; the cost is the code, not the grammar |
| `script/m14/tmp/graphql/out/perf-accessors.json` | the machine-INDEPENDENT cost: counted tree-sitter accessor calls, and an A/B with both analyzers in one process, alternating | **338,432 → 151,488 accessor calls, 55.2% fewer**; `namedChildCount` 93,956 → **0**; `type` 99,735 → 41,558 |

## Complexity envelope

A single iterative DFS. The document's top-level definitions are read **once**, in
a pre-pass, for both the declared set and the extended set. The `Directives` scan
is memoised per node in a `WeakMap`, so a declaration with directives pays for one
scan rather than two — it used to pay for two, and the ablation measured it at
**51% of the analyzer**. Relationship dedupe is `Set`-backed over
`(source, type, target, role, line)`, O(1) per emitted fact, and the `role` is in
the key because `f(x: Int): Int` is two facts on one line.

**Child iteration is O(n), and it used to be O(n log n).** web-tree-sitter
documents `namedChild(index)` as *"fairly fast, but its cost is technically
log(n), so if you might be iterating over a long list of children, you should use
`Node#namedChildren` instead"* — and that getter materialises the whole list in one
wasm call and caches it on the node. This analyzer walked children the documented-
against way in **nine** places, including `pushChildren`, which runs once per node.
It now reads `node.namedChildren` everywhere, so a node's children cost one wasm
call rather than one call per child. For the same reason `firstChildOfType` exists
instead of `findChild(node, n => n.type === "X")`: the comparison is a string
equality, and the closure bought 40 allocations per symbol and a call frame per
child examined. Two `findChild`/`hasChild` sites remain **deliberately**, because
their predicates are not a single type — `DirectiveLocation` matches either of two
inner types, and `repeatable` is an *anonymous* token that a named-only walk
cannot see.

**And `node.type` is memoised per call.** `type` is a marshalling getter — every
read crosses into WASM and copies a string back — and the analyzer read it far
more often than there are nodes: **103,531 reads of 31,491 distinct nodes, so
69.6% were redundant.** `node.id`, by contrast, is a plain own property set in the
binding's constructor, so a `Map` keyed on it is nearly free and turns every read
after the first into a hash lookup. It is an **instance field only because the
readers are instance methods**, and it is **reassigned at the top of every
`analyze` call** — which is what makes it safe, because a `Node` id is unique only
within one tree and the binding documents that a node reused from an older tree
keeps its id, so a cache outliving a call could answer with the *previous* tree's
type. The key must also be a real number: the binding's "no node" sentinel carries
none, and two such nodes would share the single key `undefined`.

That last point was not hypothetical. Routing a plain object's `.type` **string
field** through the memo cached `ID` under `undefined` and then reported `ID` as
the type of an argument the source declares `Role` — caught by the differential,
and a good illustration of why a string field and a node property must never meet
in the same accessor. `typeOf` now refuses any node whose `id` is not a number.

The cost of that shape is counted, not asserted. `namedChildCount` calls:
**93,956 → 0**. `namedChild` calls: **92,276 → 3,311**. `type` calls:
**99,735 → 41,558**. Total tree-sitter accessor calls on the 20,368-line GitHub
public schema: **338,432 → 151,488, 55.2% fewer**, with **9,622 facts** and the
differential at P=1.000, R=1.000, 0 range failures.

The count moved twice in this review and both directions are reported rather than
the best one kept. It rose from 208,297 to 213,497 when the three new families
landed, because they walk real subtrees to collect their facts — and the doc said
so instead of quoting the older, rosier figure. It then fell to 151,488 when the
`type` memo landed. The pinned claim is the count and the fact total, both
machine-independent; the wall clock is not pinnable and is not pinned.

Gate 10b fails if `namedChildCount` ever becomes non-zero again, because a
silent regression there is exactly what the wall clock is too noisy to catch.

**Throughput is a per-machine measurement, not a claim**: the same binary on the same
47-file corpus read 26,345 and 36,013 parse lines/s on two runs of it, so no
absolute is pinned here or in the review. The same is true of the speed-up from the
accessor fix, and more sharply. Running both analyzers in **one** process,
**alternately** — which removes drift as an explanation — still leaves a per-run
spread of **3.9×** inside a single series, and repeated sessions of the same A/B
reported 35% faster, 40%, 52%, and **13% slower**. That is not a measurement of the
code; it is a measurement of the machine, so **no wall-clock figure is pinned for
this change**. The probe prints the minimum (the better estimator under contention)
and the median and gates on neither. What is pinned is the counted
**338,432 → 213,497, 36.9% fewer accessor calls** with **9,622 facts** and
P=1.000/R=1.000 — an exact, machine-independent fact. The 2×2 attribution (parse
×1.55, analyze ×1.65) remains valid because it is a ratio between two cells measured
in the same process under the same conditions. See REVIEW.md §I and §I.1.

## Issue

M12.38 / GitHub issue #177. The deep review that produced every number above is
`script/m14/tmp/graphql/REVIEW.md`.

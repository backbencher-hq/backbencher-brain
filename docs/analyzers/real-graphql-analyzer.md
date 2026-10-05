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

A differential whose ground truth omits a family agrees *without disagreement* with an
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

## Ontology workstream — the ten relationship types, measured

    npx tsx script/m14/ontology-coverage-gate.ts graphql --fresh

    type          status            detail
    ----------------------------------------------------------------------------------
    calls         RULED-SOUND       NOT EMITTED; instrument A. script/m14/graphql-ruled.ts
    uses          EMITTED           49,268 edges
    contains      EMITTED           42,704 edges
    imports       EMITTED           170 edges
    references    EMITTED           47,775 edges
    exports       EMITTED           10,968 edges
    extends       RULED-SOUND       NOT EMITTED; instrument B, 0x on the parse tree
    implements    EMITTED           1,710 edges
    overrides     EMITTED           4,168 edges
    instantiates  RULED-SOUND       NOT EMITTED; instrument A
    ----------------------------------------------------------------------------------
    emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0

**Exit 0. 7 EMITTED + 3 RULED = 10/10 APPLICABLE.** Three types believed missing at
handover were EMITTED this wave (`exports`, `overrides`, `imports`) and three are RULED
with a corpus measurement (`calls`, `extends`, `instantiates`).

`--fresh` is not optional. The arbiter's tally is populated inside `resumableWalk`'s
`run()` callback, and a resumed walk never calls it — so a second run against the
populated `validation/m14/measurements/walk-graphql.txt` prints `emitted 0/10` and
`RULED-UNJUSTIFIED` on all seven types this analyzer emits, then exits non-zero. That
is a shared-machinery defect, reported in §Shared-machinery items, not repaired here.

### The corpus

**1,905 admitted files across 22 repositories**, walked **exhaustively** over each
repository's git-tracked files — no sampling, no random draw — through production
`parseFile` (`src/ast/pool-worker.ts`, **not** `analyze()`).

Admission is identical to the arbiter's: `git ls-files`, size <= 512 KiB,
`detectLanguageFromPath === "graphql"`. The 22 repositories and their admitted file
counts are listed in `script/m14/tmp/graphql/out/production-six-questions.json` under
`population.repos`; the largest are gql-graphql-platform 717, hasura-engine 407,
gql-graphql-tools 238, gql-gqlgen 143, gql-graphql-mesh 130, genqlient 111.

**91,437 symbols, 156,709 relationships, 0 parse errors, 0 empty symbol names, 0 empty
kinds, 0 relationship types outside the ten, 68 files with zero relationships.**

### Verdicts

Counts are from the arbiter's own walk. `files` is the lane census count — every
distinct file the type appeared in — not the arbiter's 4-file sample.

| type | verdict | edges | files | the measurement it rests on |
|---|---|---|---|---|
| `uses` | **EMITTED** | 49,268 | 1,434 | 9 roles; `field_selection` 36,753 |
| `references` | **EMITTED** | 47,775 | 1,136 | 5 roles; `field_return_type` 23,677 |
| `contains` | **EMITTED** | 42,704 | 978 | one role |
| `exports` | **EMITTED** (GAP at handover) | 10,968 | 1,034 | the document's top-level surface, from `(file)` |
| `overrides` | **EMITTED** (GAP at handover) | 4,168 | 147 | a member an object declares that a type it implements also declares |
| `implements` | **EMITTED** | 1,710 | 163 | every clause of every `implements` list, not only the last |
| `imports` | **EMITTED** (GAP at handover) | 170 | 131 | the `#import "<file>"` convention |
| `extends` | **RULED** | 0 | 0 | instrument **B** |
| `calls` | **RULED** | 0 | 0 | instrument **A** |
| `instantiates` | **RULED** | 0 | 0 | instrument **A** |

**The six EMITTED types and the three RULED ones are measured by two independent
walks and they agree to 0.03%**: the arbiter reports 49,268 `uses` and this lane's own
probe reports 49,261 over the same 1,905 files. Two walks of the same production entry
point do not return byte-identical edge counts — `parseFile` runs a pool with per-file
timeouts, so one file can hit the engine's 120 s guard and contribute nothing. The
sequential re-parse determinism check is **60/60 identical**, so the variance is
concurrency, not the analyzer.

### `extends` — RULED, instrument B

GraphQL has no `extends` clause: `A:supertype_clause_node: 0` over 882,672 nodes and
98 node types. `type A implements B` and `type A extends B` are the **same** grammar
rule, so the label is a decision about what `B` **is**. The analyzer emits `extends`
when `supertypeKindOf` says the supertype is a `Class` (object or input object) or a
`Type` (union or scalar) **in this document** — an `implements` clause naming an
interface is `implements`.

The ruling replicates that condition clause by clause over the same 1,905 files
(`probe/extends-condition.mts`):

| probe | occurrences | files |
|---|---|---|
| all `implements` clauses | 3,330 | 163 |
| …supertype declared as an interface **here** | 3,225 | 147 |
| **`extends` condition met** | **0** | **0** |
| …supertype an object type | 0 | 0 |
| …supertype a union or scalar | 0 | 0 |
| …owner declares no field | 0 | 0 |

The 105-clause remainder names a supertype this document says nothing about — a split
schema, where the supertype lives in another file. Deciding those needs a project-scope
join a per-file analyzer does not have, and guessing `extends` for an unclassifiable
supertype is the fabrication the workstream's rule exists to prevent.

**What `extend type N` is not:** a type-system EXTENSION is not inheritance. It is the
same type continued, and it is carried as `contains` on the added members with
`metadata.extension: true` — 76 occurrences / 13 files where the extended type is
declared in the same document, 176 / 153 where it is declared elsewhere.

**Overturn condition — satisfiable by a correct implementation:** one document in which
an `implements` clause names a supertype that THE SAME DOCUMENT declares, with a unique
kind, as an object type, an input object, a union or a scalar. Merging one split schema
into a single document satisfies it and a correct analyzer then emits `extends` for it.
The number that overturns the ruling is `extends_condition_met >= 1` over this corpus —
currently **0 over 1,905 files** — measured by `probe/extends-condition.mts`, not by a
count of `implements` clauses, which is 3,330 and proves nothing either way.

### `calls` — RULED, instrument A

A `.graphql` document has no callee. `user(id: 1) { name }` names a **member** of the
type the selection is written against; the resolver is server-side and appears nowhere
in the document. The graphql grammar produces **98 node types over 882,672 nodes** and
none is a call, an invocation or a callee reference.

**Calibration**, because "absent from a list I wrote" is evidence only if the list can
hold a present entry: the same instrument-A vocabulary, matched against the corpus's own
anonymous-token inventory (57 distinct tokens), holds **9 of 9** of GraphQL's own
keywords — `type` 5,691, `extend` 355, `implements` 1,156, `union` 528, `enum` 846,
`scalar` 411, `interface` 437, `fragment` 1,166, `directive` 603.

**The nearest real form is measured and NOT labelled `calls`:** 1,150 `Field` nodes and
2,682 `Directive` nodes carry an `Arguments` child — **3,832 argument-bearing
applications** — and every one is a `uses` with role `field_selection` or
`directive_application`. That is a **labelling** decision, and it is recorded here
rather than buried because it is the strongest argument against this ruling. What
settles it is that GraphQL has no call graph: a selection set describes a request, and
the resolver that serves it is not in the file. Those 3,832 sites are one fact each,
labelled once; publishing the same fact under both labels is the label-divergence class
ledger rule R10 exists to catch.

**Overturn condition — satisfiable without a grammar or corpus change:** a family
ledger rule (an R-number, beside R9's declared_type) assigning an argument-bearing
`Field` or `Directive` application to `calls`. On such a rule the same 3,832 sites are
re-labelled and this row is void.

### `instantiates` — RULED, instrument A

The cleanest ruling in the table: GraphQL has no construction expression. No `new`, no
constructor, no object literal that instantiates a declared type. `ObjectValue` exists
(3,523 nodes) and is an **input value** passed to a field or directive argument — a
value, not an instance of a declared type.

**Overturn condition:** the grammar producing any node type above, on any corpus. That
is a property of the grammar rather than of an implementation, which is the honest
reason it is instrument A and not B: there is nothing on the tree to count. A corpus
using a construction convention written outside the grammar reverses it — which is
exactly what moved `imports` from ruled to emitted.

### `imports` — EMITTED, and why a grammar-inventory ruling was withdrawn

The arbitration was instrument **A and B**, because a grammar cannot see a convention,
and this repository carries the correction: the json lane's `imports` ruling was
withdrawn because a Node manifest writes `exports` and `main` as ordinary object keys
and no grammar sees them.

Apollo's `#import "<file>"` is exactly that shape. The grammar has no import node
(`A:import_node: 0`) while the corpus carries **170 real `#import` directives across
131 files**, so the type is emitted rather than ruled.

**Correctness, measured against the filesystem.** `imports` names a FILE, so a
symbol-set oracle reports it 0% by construction and that number is a statement about the
oracle. The oracle this type needs is the disk:

| base | targets that exist | rate |
|---|---|---|
| **the importing file's own directory** | **156 of 170** | **91.76%** |
| the repository root | 0 of 170 | 0.00% |

The second row is not a curiosity: it is the base an earlier pass of this lane's own
probe used, and it published `resolves_pct: 0` for a type that is 91.76% correct. The
corpus settles which base is right — `b.graphql` and `c.graphql` are **siblings** under
`gql-graphql-tools/packages/import/tests/documents/import-test/default/`, not files at
the repository root, and `fragments/` is a sibling of gql-graphql-eslint's
`import-fragments/`. eslint-plugin-graphql resolves a `#import` relative to the
importing file.

**All 14 misses are configured aliases**, verified from source rather than assumed:

    #import TypeB from "@b-schema"                        pathAliases
    #import TypeB from "@circular/b.graphql"              pathAliases
    #import User from "@multiple-levels/level2.graphql"   pathAliases
    #import B from 'graphql-import-test/b.graphql'         graphql-import module
    #import from 'shared'                                  graphql-import module
    #import TypeB from "/b.graphql"                        root-absolute

in `gql-graphql-tools/packages/import/tests/schema/fixtures/{path-aliases,import-module,global}`.
A per-file analyzer cannot resolve a project-level alias, so **91.76% is this lane's
ceiling** and the remainder is a declared limitation with a count on it, not a defect.
### The six questions, per emitted type

**1 — Exists.** Every one of the seven emitted types is constructed by analyzer code
and reaches the product. Measured through the **production** entry point over the
lane's own tracked fixtures (`ontology-census.mts`, the `constructibility` block). This
is kept separate from the fixture suite deliberately: `script/m14/run-fixtures.ts:678`
calls `analyzer.analyze(...)` **directly**, with the reason recorded at line 468, so a
passing m14 fixture proves the *analyzer* behaves and not that the *product* emits.
The emitted types fire through `parseFile` on
`validation/m14/fixtures/graphql/ontology-heritage-and-surface.graphql`:
`contains` 7, `references` 7, `exports` 6, `implements` 2, `overrides` 2, `extends` 1.

**2 — Fires.** The corpus counts in the verdict table: 7 of 10 types fire on the
1,905-file corpus and 3 are RULED with a measurement. `extends` is the interesting one
— the branch is live and reachable through `parseFile` (`type Car implements Vehicle`
with both types in one document yields the edge, corpus 0 / fixture 1) and this corpus
never satisfies its condition. That is a corpus-shape limit with a count on it, not
dead code, and the ruling above states it as one.

**3 — Correct.** `script/m14/tmp/graphql/differential/score.mts` compares
**387 hand-derived facts** over 9 fixtures in 4 channels — symbols 122, relationships
236, parameters 16, docstrings 13 — at **P=1.000, R=1.000**, 0 range failures, 0
violations. The ninth fixture and the seven mutants that drive it were added because
`imports` — the one type this lane emitted — had **no mutant and no differential row**
before them, and a suite that prints "0 survived" while the newest family has never been
broken proves nothing about that family. **Declared limitation of that oracle:** it is a second walker over the
**same grammar**, so a grammar-level defect shared by the analyzer and the oracle is
invisible to it. It can prove the two agree; it cannot prove the grammar read the
source correctly. The m12 layer's independent 113-construct specification battery is
what covers that half, and it reports **0 valid constructs rejected** with 8 invalid
still rejected.

**4 — Labelled.** The relabel this lane made is the label question. Ledger rule R9
says a declaration's written type is a `references` edge marked `declared_type`, and
java, kotlin, scala, csharp, go, typescript and rust all publish a field, parameter,
return or variable type that way and **none** of them publishes a `uses` edge for the
same fact — typescript suppresses the duplicate explicitly
(`alreadyPublished`, real-typescript-analyzer.ts:3439). This lane published both, so
`uses` **lost 7,892 edges** and `references` gained them. The graph grew by the
`exports` and `overrides` families only.

The split is measured on the tree, not asserted: probe
`B:type_node_in_a_declaration` counts **7,949** `Type` nodes sitting directly under a
declaration, and the positions that stay `uses` are counted too — union member 345,
root operation type 12, fragment type condition 504, inline-fragment type condition
672 — because a name in a list or a name in a mapping is not a type clause.

Three source spellings in the declared-type family, none of which is a bug on either
side and all three of which are now written down here and in
`probe/declared-type-roundtrip.mts`:

- a **field argument**'s declared type is attributed to the **field** symbol
  (`Actor.avatarUrl -> Int`), because arguments are published as the field's
  `parameters` metadata and no argument symbol exists to own it. 2,067 edges.
- a **directive argument**'s declared type is attributed to the **directive** symbol
  (`@example -> Boolean`), for the same reason under a different spelling; the argument
  name survives in `metadata.argument`. 15 edges.
- a member declared in an `extend type X { ... }` block is published exactly as a
  member of a definition.

**5 — Resolved.** Both endpoints, judged at project scope with the store's own two
strategies (qualified name first, unique bare name second), source and target counted
separately:

| type | edges | source resolves | target resolves | **both ends** |
|---|---|---|---|---|
Over the 1,905-file production corpus, `resolution.endpointBuckets` counts **every
endpoint of every edge once**, so the buckets sum to twice the edge count. Three
instruments, because one number was the wrong instrument:

| type | edges | both ends bind | incl. spec vocabulary | the rest |
|---|---|---|---|---|
| `contains` | 42,686 | **100.00%** | 100.00% | 0 dangling |
| `overrides` | 4,168 | **100.00%** | 100.00% | 0 dangling |
| `exports` | 10,960 | **100.00%** | 100.00% | source is the `(file)` sentinel |
| `implements` | 1,710 | 96.73% | **97.25%** | 35 ambiguous, 12 dangling |
| `references` | 47,754 | 44.78% | **99.11%** | 25,865 spec, 266 ambiguous, 157 dangling |
| `uses` | 49,261 | 15.86% | 42.29% | 57,080 inFile, 13,382 ambiguous, 15,048 dangling |
| `imports` | 170 | n/a by construction | n/a | **91.76% on disk** |

**`references` at 44.78% is not a defect and the third column is why.** 25,865 of its
95,550 endpoints are `String`, `Int`, `ID`, `__typename`, `__Type.kind` — names the
GraphQL SPECIFICATION defines and forbids a user schema to declare, so no `brain_symbol`
row exists for them and neither of the store's two resolution strategies can land them.
Admitting the specification's own vocabulary — the five built-in scalars plus the
RESERVED PREFIX `__*`, the prefix the specification itself reserves — `references` is
**99.11% resolved at both ends with 157 dangling endpoints**. Reporting the bare 44.78%
alone would read as an analyzer defect and is not one.

CSS `references` at 66.8% on both ends is the project's reference point; this lane's
`references` is **99.11%** and its `contains` and `overrides` are 100%.

**`uses` at 15.86% is the one genuinely low figure**, and its causes are counted
rather than asserted: of 98,522 endpoints, 57,080 bind in their own file, 13,382 are
ambiguous bare names the store's uniqueness rule refuses to guess between (13,479 of
those are on a handful of very common field names — `id` has hundreds of candidate
owners), 12,317 are spec vocabulary, and **15,048 are dangling**. A field selection
names `field`, and the parent type it belongs to is the enclosing field's return type,
which an executable document does not carry. Where the document *does* say — a fragment
or an inline-fragment type condition — the target is qualified (`User.id`) and resolves.
`metadata.selectionPath` records the full path in both cases, which is what lets a
reader tell them apart. Resolving the rest requires the schema, which is another file:
a limit of the language, not of the extraction.

The two figures that are low are low for stated reasons, and neither is a defect to be
quieted:

- **`imports` does not resolve against a symbol set at all, and 0.00% would be a
  statement about the oracle.** Its target is a FILE. The oracle it needs is the disk,
  and there it is **156 of 170 = 91.76%**; see the `imports` section above for the base
  this lane got wrong first and the 14 configured aliases that are the ceiling.
- **`exports` sources, 0.00%.** The source is `(file)`, deliberately: the exporting
  entity is the schema file, not a symbol. `metadata.fileLevel === true` is the
  M60/#910 contract, and `parallel-indexer.ts:3481` rewrites `source_external` to the
  project-relative path on exactly that flag, so the stored row names the file. Zig
  spells the same source `"(file)"` (real-zig-analyzer.ts:1451); 19 sibling analyzers
  publish an `exports` edge, and `ParseResult.exports` had **no consumer at all** —
  `parallel-indexer.ts` reads `result.imports` into `brain_import` at line 3293 and
  reads nothing named `exports`, which is why the list existed and no edge said so.

**6 — Confident.** Every one of the **156,709** edges carries a numeric `confidence`,
and the histogram for every emitted type is a single bucket at **1.0** — **0 edges
below 0.7**, so the **heuristic ratio is 0.0000**. `evidenceClass` reads `structural`
on all of them. — the graph is 100% deterministic parse facts, and that is now a
queryable number rather than an absent key. Every edge this analyzer emits is read off
a named AST node: an `ImplementsInterfaces` clause, a `NamedType`, a field's own
`Name`, a `Directives` child. Nothing is a name-match guess, so nothing is filed under
0.7. `evidenceClass` was **absent** on this lane before and is now stated on every
edge, because an absent key is not queryable and honesty contract §4.3 requires the
heuristic ratio to be one.

### DERIVATION findings

**5**, from `script/m60/rel-type-coverage-gate.ts --langs=graphql` (exit **1**,
`baseline: 104 recorded, 3 NEW, 102 repaid`):

```
CHECK 1 — DERIVATION: every emitted type has an oracle derivation
  graphql      5 un-audited: ["contains","exports","imports","references","uses"]

REGRESSIONS (not in the recorded debt):
  DERIVATION|graphql|emits `exports` but the differential audits ["extends","implements","instantiates","overrides"]
  DERIVATION|graphql|emits `imports` but the differential audits ["extends","implements","instantiates","overrides"]
  DERIVATION|graphql|emits `references` but the differential audits ["extends","implements","instantiates","overrides"]
```

The shared differential audits `["extends","implements","instantiates","overrides"]`
for this lane. `extends` and `instantiates` are audited and emit 0 edges, so the
audited set that reaches real data is `implements` (427) and `overrides` (1,054).
**3 of the 5 findings are new** and were introduced by this lane's own work — `exports`,
`imports` and `references` — and all three are reported by the gate as regressions
rather than as recorded debt. `contains` and `uses` are pre-existing.

**What the gate cannot see, because it is measured against the wrong instrument.**
Four of the five do have hand-derived truth; the DERIVATION check reads only
`script/m14/differential.ts` and does not read a fixture expectation.

| type | hand-derived truth | rows | asserted by |
|---|---|---|---|
| `contains` | `fixtures/ground-truth.json` | 67 | `differential/differential.mts` |
| `uses` | `fixtures/ground-truth.json` | 39 | `differential/differential.mts` |
| `references` | `fixtures/ground-truth.json` | 68 | `differential/differential.mts` |
| `exports` | `fixtures/ground-truth.json` | 46 | `differential/differential.mts` |
| `imports` | `fixtures/ground-truth.json` + the m14 expectation | 5 + 4 expect / 12 forbid | `differential.mts` and `run-fixtures.ts --lang graphql` |

**`imports` was the one real hole and it is now closed.** When this section was first
written, `imports` had an m14 fixture expectation and **no differential row and no
mutant** — the one type this lane added, never broken. It now has all three:
`fixtures/10-file-imports.graphql` with 5 positive spellings and 6 negative lines whose
rows were derived from the fixture source before the analyzer was run on it, plus
**7 mutants, all caught** (`imports-family-removed`, `import-source-becomes-the-file-sentinel`,
`import-bindings-first-only`, `import-form-always-bare`, `import-bindings-key-dropped`,
`import-unterminated-quote-read-to-end-of-line`, `import-as-form-rejected`).

Asserting it needed a harness fix, and the fix is the finding: `score.mts` compared
metadata with `got !== val`, which **can never be true for an array**, so
`metadata.importBindings` was unassertable — writing the row failed with
`got ["First","Second"] want ["First","Second"]` and omitting it left the fact unchecked.
The key that distinguishes the comma-separated form, which the review found the first
measuring probe could not produce at all, was the one key the harness could not compare.
The comparison is now structural, and the scalar path is unchanged.

The `imports` rows are asserted in production shape, not only by the differential's
internal `analyze()` path: 4 exact `imports` edges with `meta.importForm` and
`meta.importBindings`, plus 12 `forbidRelationships` that are the negative cases a
keyword match cannot pass — `# important:` (prefix), `#   # this document imports
nothing at all` (keyword mid-sentence), the unterminated quote, the unquoted path,
and the empty-`unknown`-target bans.

**So the substantive debt is 0 rows without an oracle and the reported debt is 5 types
whose oracle exists.** That is a §8 report, and it is stated as a defect in the
instrument rather than as a pass for the lane:

> **`script/m60/rel-type-coverage-gate.ts`, CHECK 1 — DERIVATION.** The check derives a
> lane's audited set from `script/m14/differential.ts` alone. It should also accept an
> `expectRelationships` / `forbidRelationships` block in
> `validation/m14/fixtures/<lang>/*.expectation.json` as a derivation, gated on that
> file carrying `"authoredBeforeAnalyzerRun": true` and `"language": "<lang>"`. Under
> that reading `graphql`'s un-audited set is `[]`, `imports` drops out, and CHECK 1 exits
> 0 for this lane. Both files are shared machinery owned by the supervisor, so neither
> was edited here. Until then the honest reading of `graphql 5 un-audited` is **5 types
> whose DERIVATION rows the gate's single source cannot reach, 0 of them unaudited in
> fact** — and the 3 regressions it reports are a measurement of the check's input set,
> not of this analyzer.

### The relabel's own fabrication check

The R9 change moved 7,892 edges between two labels. A differential cannot check that,
because its ground truth was authored against the pre-move labelling — a relabel that
kept every fact and changed every label would agree with itself. So
`script/m14/tmp/graphql/probe/declared-type-roundtrip.mts` builds two sets over the
whole corpus and subtracts them:

- **set A** — every `(file, source, target, line)` the parse tree says a declaration
  writes, from an independent walker.
- **set B** — every such triple production `parseFile` emits as `references`.

`B \ A` is a fabricated edge and `A \ B` is a lost edge, deduped as the store dedups
on `(source, target, type, line)`.

**set A = 7,890. set B = 7,890. fabricated 0, lost 0.** On the full production corpus —
1,905 files, production `parseFile` — the same probe reads
**set A = 47,642, set B = 47,642, fabricated 0, lost 0**, and getting there took three
more corrections, every one of them on the probe's side and two of them turning a
analyzer defect into a measurement of the walk:

| what the probe reported | what it was |
|---|---|
| `NON-ZERO — 0 fabricated, 39 lost` | **not the analyzer.** All 39 sat in **two** files, one of them the file the same run logged `[BB-HANG] parser stuck 120s` on. Re-parsed alone through the same production entry point: `introspection.graphql` → **632 `references` in 637 symbols**, which is exactly the 632 the gate called lost. The count is also **not stable** on an unchanged corpus and an unchanged analyzer — 39 in one run, 639 in the next — because which files hang is a function of machine load, and ten lanes share this machine. A count that moves 16× with no code change is a count about the walk |
| …then `NON-ZERO — 0 fabricated, 639 lost`, 632 of them in that one file | the walk loses the file, the caller gets an **empty relationship list, and nothing throws** — `parseFile` threw on **0 of 1,905** files, so a `catch`-based guard catches none of it. Set A is now staged per file and merged only for files production emitted references for; the excluded files are counted and named in the artifact rather than silently narrowing the subtraction |
| …then `NON-ZERO — 0 fabricated, 5 lost`, 1 edge in each of 5 files | **not the analyzer either.** All 5 are a directive definition's argument type attributed to the directive symbol — the convention this probe already encodes. The cause is a **grammar gap**: a directive application on a directive *definition's* argument (`directive @foo(arg: String! @tag(name: "x")) @tag(name: "y") on QUERY`) parses with an `ERROR` node swallowing `@foo(arg: …)`, after which the parser reads the *applied* `@tag(name: "y") on QUERY` as the definition's own name, arguments and locations. The analyzer published `@tag` because `tag` **is** the first direct `Name` child of the node the grammar produced, and it refused the declared-type edge because that `ArgumentsDefinition`'s `Type` node carries MISSING text — which is REVIEW.md finding B2's guard working. The probe climbed out of the ERROR and attributed the damaged `arg: String!` to the healthy definition above it. It now stops at an `ERROR` or a MISSING node, and counts what it declines to assert: **6 declarations sit under a parse ERROR across the corpus** |

The probe has now accused the analyzer of fabricating edges **five** times and been
wrong five times, and that ratio is the reason its conventions are written down rather
than assumed.

Getting to a clean 0/0 took four corrections, all on the probe's side, each of which
had accused the analyzer of fabricating edges that were real:

1. the wrapper chain was walked upward from the `Type` node, but `NamedType` is its
   **child** — 0 derived, all 7,890 emitted edges "fabricated";
2. the descent set omitted `Type` itself, which **reappears inside a `ListType`**, so
   every list-typed declaration read as "no resolvable name" (250 `InputValueDefinition`s);
3. the line was taken from the member's own `Name` instead of the `NamedType` that
   names the fact — in `github-schema.graphql` `avatarUrl` is on line 43, its
   `size: Int` argument on 47 and its `): URI!` return on 48, so 2,446 edges looked
   lost and 3,117 looked fabricated over a convention alone;
4. the hop guard was 16, shorter than hasura `0038_wrapped_named_types.graphql`'s
   `d: [[[[[Int!]!]!]!]!]!`, which needs about 17 — and the 2 edges it could not reach
   were the last 2 it called fabricated.

The 40 rows that remained after the conventions were matched were all one class, a
directive argument's type attributed to the directive symbol rather than to the
argument, and both spellings were correct; only one had been written down.

The same probe also records the 3 damaged declarations in the corpus whose `Type` node
carries a MISSING name — 1 `InputValueDefinition` and 1 `FieldDefinition` with no
resolvable name, and 1 with no owner — and for those the analyzer emits no edge. That
is REVIEW.md finding B2, still holding.

### Payload

34,023 ontology relationships over 426 files, against 19,054 over 47 files before this
work. The growth is `exports` (+1,428), `overrides` (+1,054) and the `uses` →
`references` move, which is **net zero** on the total. `uses` is the largest family at
16,738 and is **not** new: it was emitted at handover and this lane only removed the
7,892 duplicated labels from it.

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
- `errors` is empty by design: `ASTEngine.parseFile` walks `ERROR`/`MISSING`
  nodes after this analyzer returns (`engine.ts` ~L1194), so the engine's rows
  are the real ones. Calling the analyzer directly yields `errors: []`, which is
  why the corpus sweep measures grammar errors from the tree and not from the
  analyzer.
- **A field argument's declared type is attributed to the FIELD symbol**
  (`Actor.avatarUrl -> Int`, 2,067 edges), and a directive argument's to the
  **directive symbol** (`@example -> Boolean`, 15 edges), because arguments are
  published as the owning declaration's `parameters` metadata and no argument
  symbol exists to own them. A consumer reading `Actor.avatarUrl -> Int` as
  "this field's type is Int" would be wrong — its own return type is `URI`. The
  role (`field_return_type` vs `field_argument_type`), the line and
  `metadata.argument` are what disambiguate them, and all three are carried.
- **11 `implements` clauses in the corpus name an object-typed supertype the same
  document does not declare**, so they stay `implements` and emit no `extends`
  edge. The analyzer is a per-file unit; resolving them needs a project-scope
  join it does not have. Measured by
  `B:implements_an_unambiguously_object_type_in_the_same_document` — 11 project
  scope, 0 same document.
- **1 of 8,796 corpus symbols is dropped by production, not by this analyzer.**
  `Query.me` at `0032_supergraph.graphql:175` is a legitimate GraphQL field, and
  `me` is on the `UNIVERSAL` name denylist in `src/ast/pool-worker.ts:448`, so
  `parseFile` filters it out and `analyze()` does not. Measured by
  `script/m14/tmp/graphql/probe/production-drops.mts`, which compares the two
  paths per file; **0 relationships are left without a source** as a result. The
  denylist is shared machinery (§8), so this is reported rather than fixed here.
- **The differential oracle cannot see a relabel.** Its ground truth was authored
  against the pre-R9 labelling, so moving 7,892 edges from `uses` to `references`
  while keeping every fact is invisible to it by construction. The two-set
  subtraction in `probe/declared-type-roundtrip.mts` is what covers that, and it
  reads 0 fabricated / 0 lost.

## Shared-machinery items

Four defects outside `src/ast/real-graphql-analyzer.ts`. None was repaired here; each is
stated with the file, the function and the measurement, so it can be applied without
re-deriving it.

### 1. `src/ast/engine.ts:1441-1447` — a leaked parse timer overrides a caller's exit code

```
1441:  const parseBomb = setTimeout(() => {
1442:    process.stderr.write(`[BB-HANG] parser stuck 120s on ${filePath} — exiting\n`)
1443:    process.exit(1)
1444:  }, 120000)
1446:  const tree = parser.parse(content)
1447:  clearTimeout(parseBomb)
```

There is no `try`/`finally` between the timer and the clear (verified by source, lines
1395-1450 contain no `try`, `catch` or `finally` at all). **Any throw out of
`parser.parse()` leaks the timer**, and 120 s later the leaked callback calls
`process.exit(1)` — which discards whatever `process.exitCode` the caller had set.

Measured on this lane, `npx tsx script/m14/ontology-coverage-gate.ts graphql --fresh`:

```
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0
[BB-HANG] parser stuck 120s on …/hasura-engine/community/boilerplates/observability/
          enterprise/examples/hasura/metadata/actions.graphql — exiting
FRESH_EXIT=1
```

The verdict is **correct and complete** (all ten types adjudicated, `FALSIFIED 0`,
`ruled-without-justification 0`), and the process still exits **1**. `ontology-coverage-gate.ts:518`
sets `process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1`, which on
this run evaluates to 0; the stale timer overrides it. A supervisor scripting the gate
reads this lane as failing.

**Fix:** wrap the parse so the clear is unconditional — `let tree; try { tree = parser.parse(content) } finally { clearTimeout(parseBomb) }`. One line, and it makes the 120 s guard mean "this parse is stuck" rather than "this process, up to 120 s after the work finished". This affects **every** lane, not this one: any walk whose corpus contains one file that throws out of `parser.parse` can exit 1 after printing a clean verdict.

### 2. `script/m14/ontology-coverage-gate.ts` — the tally lives inside `run()`, so a resumed walk reports `emitted 0/10`

Lines 302-317: `observed` is populated in `resumableWalk`'s `run()` callback. A resumed
walk never calls `run()` for a file it already did, so `observed` stays empty. Measured,
second invocation with no `--fresh`:

```
walk: 1905/1905 files (100.0%)  newly walked 0, resumed 1905
emitted 0/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 7
RESUME_EXIT=1
```

The walk is 100% complete and the arbiter reports **7 of this lane's own emitted types as
RULED-UNJUSTIFIED** — including three that carry written rulings. Every count on the
table is a statement about zero files while the header above it says 1,905.

**Fix:** persist the per-type counts in the checkpoint file alongside the completed-file
list, so a resumed walk restores them instead of re-deriving nothing; or refuse to
report when `walked === 0 && alreadyDone > 0` and the tally is empty. The second is
three lines and cannot print a false table.

### 3. `script/m60/rel-type-coverage-gate.ts`, CHECK 1 — DERIVATION reads one source and misses the fixture oracles

See §DERIVATION findings above. Reads `script/m14/differential.ts` only; does not read
`validation/m14/fixtures/<lang>/*.expectation.json`. Reports `graphql 5 un-audited` and
3 regressions for types whose hand-derived truth exists in both places.

### 4. `src/ast/pool-worker.ts:448` — `me` is on the `UNIVERSAL` name denylist

`me` is a legitimate GraphQL field name. Production drops the symbol
(`Query.me` at `0032_supergraph.graphql:175`) while `analyze()` keeps it — **1 of 8,796
corpus symbols**, and **0 relationships are left without a source** as a result, so the
graph is not corrupted. Measured by `probe/production-drops.mts`. The denylist is
shared and the name is genuinely common in non-GraphQL corpora, so the fix is not
"remove `me`" but "scope the denylist by language".

**One item from the handover brief is already resolved upstream and is recorded here so
nobody re-raises it:** `RelationshipType.Imports` no longer disagrees between
`src/ast/types.ts` and `src/ast/engine.ts`. `types.ts:84` reads `Imports = "imports"`,
matching `engine.ts:454` and `graph.ts`, with the history written down at `types.ts:72-74`.
Any ruling that cited the old `brain_import` value as a blocker is void.

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
| `validation/m14/fixtures/graphql/` | the lane's four m14 fixtures, each with an expectation file | **4/4 pass**, as gate 8d and as the `fixtures-graphql` check in the canonical `validation/m14/results/M14.0.F3.json`. That artifact is cross-lane and only a run covering **every** lane may write it, so the lane asserts its own four fixtures directly rather than reading a file it cannot regenerate — the milestone check is corroboration, not the lane's evidence |
`fixtures-graphql`. The canonical `validation/m14/results/M14.0.F3.json` does **not** yet name this lane: only a run covering every lane may write it, by the runner's own rule, so it is regenerated milestone-wide rather than by this lane. A cross-lane gap, recorded here rather than papered over with a lane-owned artifact that would shrink the milestone's claim |
| `validation/m14/grammar-pins.json` | the grammar pin | wired sha `f988e0a0…`, 13 vendored files, source↔wasm proof **zero in both directions**. The `~/.bb/wasm` mirror is **not** byte-identical and is not expected to be: it still holds the pre-patch blob `9cd70f69…` (41,223 B, dated 2026-07-13) against the wired `f988e0a0…` (58,115 B). It is unreferenced, because `bbWasmCandidates` (`src/util/bb-data-dir.ts:28`) tries the repository's own `wasm/` copy **first** and only then the data-dir cache. An earlier draft of this line asserted the mirror was byte-identical; the pin verifier measures `copies:mirror=differs` and the claim was false |
| `script/m14/tmp/graphql/out/contract-battery.json` | 59 hand-audited cases | **59/59** |
| `script/m14/tmp/graphql/out/differential.json` | hand-derived ground truth, 9 fixtures, 4 channels (symbols 122, relationships 236, parameters 16, docstrings 13) | **387 facts, P=1.000, R=1.000** |
| `script/m14/tmp/graphql/out/mutation.json` | 50 mutants, one per finding, **7 of them for `imports`** | **44 caught, 0 survived**; 2 defeated by another guard (defence in depth, measured); 4 declared equivalent — two of them **derivable** from the grammar's own rules rather than merely unobserved. **0 unapplied** — an anchor is a verbatim copy of analyzer source, so when `topLevelDefinitions` was refactored the anchor went stale, the mutant silently stopped testing anything, and the harness reported it as a *survival*. An unapplied edit is now a hard failure with its own exit path, because a suite that prints "0 survived" while a mutant was never applied proves nothing |
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
`reviews/graphql/master-review.md`.

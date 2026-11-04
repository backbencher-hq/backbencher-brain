# GraphQL analyzer

## Language

- Analyzer: `src/ast/real-graphql-analyzer.ts`
- Grammar: **vendored, patched and pinned** — `wasm/tree-sitter-graphql.wasm`
  is a build of `grammars/tree-sitter-graphql/`, whose source is upstream
  `bkegley/tree-sitter-graphql@ee5ce96` plus a generated patch (see
  `grammars/tree-sitter-graphql/README.md` and `port.py`). The pin, its
  provenance, its rejected alternatives and the offline source↔wasm proof live
  in `script/m14/verify-grammar-pins.ts` under the `graphql` lane (`:976`).
- Detection: `.graphql`, `.graphqls`, `.gql` → `graphql` in the router's one table
  (`src/ast/language-detection.ts:101`)
- Wiring: `ASTEngine` → `RealGraphqlAnalyzer` (`src/ast/engine.ts:2435`)

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
| operation | `method` | `OperationDefinition` | name, or `<file-stem>::operation_<ordinal>` — see [The identity of an unnamed operation](#the-identity-of-an-unnamed-operation) |
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

THE CLAIM TABLE. One row per canonical `RelationshipType`, in the register order of
`src/ast/types.ts`, derived from the analyzer's own `RelationshipType.*` sites
(`src/ast/real-graphql-analyzer.ts`) and the lane's committed measurements. Where the
dated tables elsewhere on this page differ, THIS table is the claim; the measured
rulings behind the six ❌ rows are in
`## The completion bar: extends + the four extended types` below. Confidence and the
`evidenceClass` tier are emitted per edge by `addRelationship` (`:447-492`), which
stamps `confidence: 1` on every edge and `evidenceClass: "structural"` except for the
one `import_based` tier.

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| `calls` | ❌ not emitted | 0 `RelationshipType.Calls` sites. RULED grammar-absence, measured in BOTH spaces the arbiter requires: 0 of 10 call-shaped node types among the 75 named types over 2,338,690 nodes, and 0 of 22 keyword-shaped KEYS applies anything (`validation/m14/fixtures/graphql/rulebook-space-probe.json`, read by `ruling-attestation.json`). The nearest real form — an argument-bearing `Field`/`Directive` — is published as `uses`, not relabelled. | — (no edge emitted; grammar-absence ruling) |
| `extends` | ✅ emitted | `emitHeritage` labels an `implements` clause `extends` only when THIS DOCUMENT declares the named supertype as an object type, input object, union or scalar (`:609-632`); role `extends`, `metadata.implementsClause: true`. Whole-population count 0 (0 of 3,179 `implements` clauses is inheritance-shaped) — corpus-unexercised, branch pinned by `validation/m14/fixtures/graphql/ontology-heritage-and-surface.expectation.json`. | confidence `1`; `evidenceClass: "structural"` (`:488`) |
| `implements` | ✅ emitted | Every `NamedType` in the left-recursive `ImplementsInterfaces` subtree → the object/interface declaring the clause, when the supertype is interface-shaped or its kind is unknown in this document (`:629-632`); role `implements`. | confidence `1`; `evidenceClass: "structural"` |
| `uses` | ✅ emitted | NAME READS (not declarations): declared types at use positions — field return type, field argument type, directive argument type, input-field type, variable type — plus union membership and root-operation types (`:772`, `:810`, `:868`), directive applications (`:1678`), and executable field selections (an alias does not change the target: `nick: name` references `name`), fragment spreads, fragment and inline-fragment type conditions, variable references and enum-value references (`:1172`, `:1211`, `:1231`, `:1244`, `:1261`, `:1894`). A field selection targets `<Type>.<field>` only when the document states the type (a fragment or inline-fragment type condition); otherwise the bare field name with `metadata.selectionPath`. | confidence `1`; `evidenceClass: "structural"` |
| `imports` | ✅ emitted | ONLY the `#import "<file>"` COMMENT convention — the grammar has no import node (`:1350`). Source is the importing file's last path segment, target the module path verbatim, `metadata{isGraphqlImport, importSource, importForm, fileLevel: true}` plus `importProjectFile` when the caller supplies a `projectRoot`. The `ImportInfo[]` payload channel is declared (`:435`) but this analyzer publishes the EDGE, not the payload. | confidence `1`; `evidenceClass: "import_based"` — the lane's deliberate second tier, because the target is a comment string rather than a named AST node. Whole-population 170 edges / 131 files |
| `exports` | ✅ emitted | Every top-level type-system declaration — the `schema` namespace, object/interface/union/scalar/enum/input types, and directive definitions — → the declared name. Source `(file)` with `metadata.fileLevel: true` (`:1408`), and the same set in the `exports: ExportInfo[]` payload (`:1390`, returned `:1453`). | confidence `1`; `evidenceClass: "structural"` |
| `contains` | ✅ emitted | Whole/part membership: type → field, enum → value, input object → input field, `schema` → root operation type (`:768`, `:896`, `:981`, `:1053`). A member contributed by `extend type X` is contained by `X` with `metadata.extension: true` (and `inExtension` on its symbol). | confidence `1`; `evidenceClass: "structural"` |
| `references` | ✅ emitted | A DECLARATION naming the type it writes — field return type, field argument type, input-field type, variable type, directive argument type — one edge per site with `metadata.relationshipType: "declared_type"` (ledger rule R9; `:525`). | confidence `1`; `evidenceClass: "structural"` |
| `overrides` | ✅ emitted | A member an object declares for a member its implemented interface also declares: `<Object>.<member>` → `<Interface>.<member>`, role `interface_member_supplied` (`:1323`; the `RelationshipType.Override` alias serializes as `overrides`). | confidence `1`; `evidenceClass: "structural"` |
| `instantiates` | ❌ not emitted | 0 `RelationshipType.Instantiates` sites. RULED grammar-absence in both spaces: 0 of 8 construction-shaped node types among the 75 named types; 340 keyword-shaped KEYS with 0 constructing an instance of a DECLARED type; the excluded near-miss population is 3,715 `ObjectValue` argument values (`rulebook-space-probe.json` / `ruling-attestation.json`). | — (no edge emitted; grammar-absence ruling) |
| `decorates` | ❌ not emitted | 0 `RelationshipType.Decorates` sites. RULED ontological 2026-10-31: a directive application annotates a declaration but names a SIGNATURE with no implementation body — 3,747 applications (3,535 on declarations), 600 directive definitions, 0 with a body (`validation/m14/fixtures/graphql/extended-census.json`). The application is published as `uses` with `metadata.relationshipRole: "directive_application"` (`:1678`). | — (no edge emitted; ontological ruling) |
| `renders` | ❌ not emitted | 0 `RelationshipType.Renders` sites. RULED grammar-absence: 0 of the served build's 142 declared node types is a component/element production; near misses counted — 36,293 operations / 765 files, 796 executable-only (persisted-query) documents, 32 `@defer`/`@stream`/`@live` applications (`extended-census.json`). | — (no edge emitted; grammar-absence ruling) |
| `mixes_in` | ❌ not emitted | 0 `RelationshipType.MixesIn` sites. RULED grammar-absence: `extend type X` adds members to the SAME type (252 extension sites = 76 declared-here + 176 declared-elsewhere, published as `contains`), and `implements` is conformance; 0 sites compose a distinct NAMED member-set provider into a supertype chain (`extended-census.json`). | — (no edge emitted; grammar-absence ruling) |
| `part_of` | ❌ not emitted | 0 `RelationshipType.PartOf` sites. RULED grammar-absence: `#import` is a comment convention naming FILE PATHS — 170 sites / 131 files, 156 targets exist on disk, 1 symbol-shaped spelling and 0 naming a declaration — and it is already published as `imports` (`extended-census.json`). | — (no edge emitted; grammar-absence ruling) |

The three families the earlier waves measured in depth, and the qualification rules beside
them, remain below. No cell above is derived from those prose sections; they are the
evidence trail, not the claim.

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

## The identity of an unnamed operation

An operation's name is optional. `{ hero { name } }` is a complete query
(spec §3.2), and the corpus is full of them: 66 unnamed operations across the 750
files this lane measures. Their selection edges are real edges and need a source,
so the analyzer has to publish *something* for the operation.

**What it published, and why that name could never work.** The name was
`anonymous_operation_<startIndex>`. Three separate things are wrong with it:

1. **The store discards it by design.**
   `isIndexArtifactName` (`src/ast/analysis-exclusions.ts:171`) returns true for any
   name matching `/^(anonymous|anon|unnamed)[_-]/i` — the shared convention that
   php's `anonymous_class_<idx>`, javascript's `anonymous_function_<idx>` and java's
   `anonymous_<Super>` all write through. Measured over 750 corpus files, production
   `parseFile`: **66 symbols emitted, 0 stored**, and **all 836 relationships sourced
   from them** (`uses`, every one) reached `brain_relationship` with
   `source_symbol_id` null. A `uses` edge with no source is what a consumer sees when
   there is no edge, so 836 real edges were indistinguishable from nothing. This is
   also why 56 of the 750 indexed files hold zero `brain_symbol` rows: those files
   emit exactly one symbol and it is an unnamed operation.
2. **A byte offset is per file, so it is not an identity.** Two documents whose first
   operation both begin at byte 0 published the same name.
3. **It is not stable under an edit.** Inserting a line above an operation changes its
   offset — the reason the previous comment gave for not using a line number, applied to
   the offset it had chosen instead.

**What it publishes now.** The identity of the file the analyzer is reading, plus the
operation's ordinal in that document:

    query.graphql   one unnamed operation  ->  query::operation_0
    mutation { … }                         ->  mutation::operation_1
    (no path supplied)                      ->  document::operation_0

This is the same move `imports` already makes at `lastPathSegment(filePath)` — "a
per-file analyzer can name the file it is reading without inventing anything" — and
`document` is the specification's own word (`ExecutableDocument`) for the fallback.
`::` rather than `.` because a dotted name would be indistinguishable from this lane's
`Owner.field` targets. The ordinal is a counter on the analyzer instance, reset per
`analyze` call because a pooled worker reuses one instance across files.

**Before and after, same 750 files, production `parseFile`:**

    symbols the store discards by design    66  ->  0
    relationships sourced from one          836  ->  0
    symbols emitted                       24,305  ->  24,305
    relationships emitted                 60,364  ->  60,364

No symbol and no edge was traded for the 66 recovered: an unnamed operation is still
published, and its edges still have a source. That matters, because the alternative —
publishing nothing for an unnamed operation — would have cost the same 836 edges for
real and bought nothing.

**Two instruments, because no existing one can see this defect.**
`run-fixtures.ts` analyses one file per fixture and `differential/mutation.mts`
(`score.mts:77`) does `new Analyzer()` inside its loop, so both start the ordinal at 0
and neither can distinguish a counter that is reset from one that is not. Verified:
the mutant "reset removed" passes the fixture suite 5/5.
`script/m14/tmp/graphql/probe/analyzer-reuse.mts` reuses **one** instance across four
documents and exits 1 without the reset (`beta.graphql`'s only unnamed operation
publishes as `beta::operation_2`). The mutant is registered in `mutation.mts` as
`defeatedByAnotherGuard`, which is the harness's own mechanism for a defect one
instrument cannot separate.

**Residual, stated rather than left implicit.** The identity is the file's *basename*,
so two same-named files in different directories still collide — 22 of the 82 distinct
basenames in `gql-graphql-tools` repeat, 8 of 48 in `gql-graphql-mesh`. That is the
same ambiguity every ordinary symbol in every lane has (2,632 of 8,017 names in this
sample repeat), not something this fix introduced; the measured cost of the change is
+4 duplicated names across 750 files. Widening the name to a directory prefix was not
done because `/` in a symbol name is already treated as a path artifact
(`analysis-exclusions.ts:235` lists a `/%` pattern among `NOISE_NAME_LIKES`), and a
longer synthetic name is a worse trade than an ambiguity the index already reports.

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

**Coverage is 1,859 of the 1,905 admitted, not 1,905.** 46 files return zero symbols
*and* zero relationships while reporting `success: true` and holding bytes; they are
named in `script/m14/tmp/graphql/out/ontology-census.json` under
`filesThatYieldedNothingDespiteBytes`. Most are legitimately empty — hasura-engine's
`err/*.graphql` invalid-syntax fixtures, 5–54-byte `__snapshots__` fragments, a 1-byte
`actions.graphql`. At least two are **grammar rejections, not timeouts**, and both are
real documents:

| file | bytes | parse time | errors | symbols |
|---|---|---|---|---|
| `gql-genqlient/docs/genqlient_directive.graphql` | 10,401 | 1,065 ms | 18 | 0 |
| `gql-graphql-platform/…/__resources__/kitchen-sink-nullability.graphql` | 2,120 | 46 ms | 50 | 0 |

Both parse in about a second with `BB_FILE_TIMEOUT_MS` raised to 600,000, so they are
not the 45 s worker self-timeout; the vendored grammar emits `Syntax error (unexpected
node)` for the whole document and the analyzer reports `success: true` with nothing.
Two consequences: every count below is a count over **1,859** files, and `parseFile`
returns no signal that would let a caller tell a rejected document from an empty one.
The error nodes also carry **no line number**, so a consumer cannot locate them. The
instruments are `src/ast/pool-worker.ts` and the vendored grammar — §8.

This does not move any verdict: the 46 are error fixtures and snapshot fragments, and
the two real ones are a directive-definition document and a query, neither of which can
express `calls`, `extends` or `instantiates`.

**91,429 symbols, 156,696 relationships, 0 empty symbol names, 0 empty kinds,
0 relationship types outside the ten, 69 files with zero relationships** — the
six-questions walk, re-run at the analyzer as it stands after the unnamed-operation
fix. The census walk over the same population reports 91,459 symbols and 156,754
relationships. `0 parse errors` is **not** claimed: the six-questions walk
counts a thrown parse, and `parseFile` throws on none of these files — it *returns*
zero symbols for 46 of them, which is the coverage correction above.

**One counter reads 3 on every walk and is not a defect: 142 files carry grammar
error nodes and 46 non-empty files yield nothing.** The census reports
`filesWithParseErrors: 142`, `errorNodes: 25,841`, `crashedFiles: 0`,
`parseReturnedFailure: 0`, `zeroYieldNonEmptyFiles: 46`, `emptyEndpoints: 0`,
`unknownEndpoints: 3`. `crashedFiles: 0` and `parseReturnedFailure: 0` beside
`filesWithParseErrors: 142` is the whole shape of the problem in one line: the
parser reports damage **inside a document it still returns a tree for**, so a
caller reading `parseFile`'s success flag learns nothing about it. The 3
`unknownEndpoints` are GraphQL fields the document names `unknown` — see **Two
counters that read 0 for the wrong reason** below.

### Verdicts

`edges` is the **census walk** (`script/m14/tmp/graphql/probe/ontology-census.mts`,
1,905 admitted files of which **1,859 parse** — see The corpus above). `files` is
**not** from that walk: it is `distinctFiles` from the **six-questions walk**
(`probe/production-six-questions.mts`, same admission rule and entry point). The two
walks disagree by 58 edges in 156,754 (0.037%) and by 1–3 files on four types, so both
file counts are given. Neither column is the arbiter's 4-file sample.

| type | verdict | edges (census) | files (census) | files (sixq) | the measurement it rests on |
|---|---|---|---|---|---|
| `uses` | **EMITTED** | 49,268 | 1,436 | 1,433 | 9 roles; `field_selection` 36,749 |
| `references` | **EMITTED** | 47,771 | 1,136 | 1,136 | 5 roles; `field_return_type` 23,658 |
| `contains` | **EMITTED** | 42,700 | 978 | 978 | one role |
| `exports` | **EMITTED** (GAP at handover) | 10,967 | 1,034 | 1,034 | the document's top-level surface, from `(file)` |
| `overrides` | **EMITTED** (GAP at handover) | 4,168 | 147 | 147 | a member an object declares that a type it implements also declares |
| `implements` | **EMITTED** | 1,710 | 163 | 163 | every clause of every `implements` list, not only the last |
| `imports` | **EMITTED** (GAP at handover) | 170 | 131 | 131 | the `#import "<file>"` convention |
| `extends` | **RULED** | 0 | 0 | 0 | instrument **B**, `supertype_clause_node` 0 |
| `calls` | **RULED** | 0 | 0 | 0 | instrument **A**, `call_node` 0 of 75 node types |
| `instantiates` | **RULED** | 0 | 0 | 0 | instrument **A**, `instantiation_node` 0 |

**The six EMITTED types and the three RULED ones are measured by two independent
walks and they agree to 0.037%**: the census reports 49,268 `uses` and the sixq walk
reports 49,258 over the same 1,905 admitted files. Two walks of the same production
entry point do not return byte-identical edge counts — `parseFile` runs a pool with
per-file timeouts, so one file can hit the engine's 120 s guard and contribute nothing.
The sequential re-parse determinism check is **60/60 identical**, so the variance is
concurrency, not the analyzer. Every re-run of the census reproduced all seven edge
counts exactly (four runs: 2026-10-05 09:53Z, 12:30Z and 16:2xZ), so the spread is
between *tools*, not run to run within one tool.

**The numbers in this section were re-measured at HEAD after the unnamed-operation
fix and the four types it could not move are the four that reproduce exactly.** The
fix changed only the *name* of a published source, so `implements` 1,710,
`overrides` 4,168, `imports` 170 and the three RULED zeros are byte-identical across
the fix, while `uses`, `references`, `contains` and `exports` each moved by a few
edges — the same pool-concurrency spread described above, on 156k edges. A 4-edge
move in `exports` is 0.04%, and `exports` emits one edge per top-level declaration, so
it cannot be the fix.

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
`B:type_node_in_a_declaration` counts **48,206** `Type` nodes sitting directly under a
declaration across 1,140 files, and the positions that stay `uses` are counted too —
union member 1,739, root operation type 440, fragment type condition 1,162,
inline-fragment type condition 1,316 — because a name in a list or a name in a
mapping is not a type clause. The 5 `references` roles account for 47,771 of the
48,206, and the 4 `uses` roles account for the remaining 4,657; the difference is
the six declarations sitting under a parse `ERROR` node, for which the analyzer
emits no edge (see the roundtrip probe below).

Three source spellings in the declared-type family, none of which is a bug on either
side and all three of which are now written down here and in
`probe/declared-type-roundtrip.mts`:

- a **field argument**'s declared type is attributed to the **field** symbol
  (`Actor.avatarUrl -> Int`), because arguments are published as the field's
  `parameters` metadata and no argument symbol exists to own it. **8,017 edges**
  (`references|field_argument_type`).
- a **directive argument**'s declared type is attributed to the **directive** symbol
  (`@example -> Boolean`), for the same reason under a different spelling; the argument
  name survives in `metadata.argument`. **902 edges**
  (`references|directive_argument_type`).
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
| `contains` | 42,684 | **100.00%** | 100.00% | 0 dangling |
| `overrides` | 4,168 | **100.00%** | 100.00% | 0 dangling |
| `exports` | 10,956 | **100.00%** | 100.00% | source is the `(file)` sentinel |
| `implements` | 1,710 | 96.73% | **97.25%** | 35 ambiguous, 12 dangling |
| `references` | 47,750 | 44.78% | **99.11%** | 25,848 spec, 266 ambiguous, 157 dangling |
| `uses` | 49,258 | 15.86% | 42.29% | 57,068 inFile, 13,384 ambiguous, 15,044 dangling |
| `imports` | 170 | n/a by construction | n/a | **91.76% on disk** |

**`references` at 44.78% is not a defect and the third column is why.** 25,848 of its
95,500 endpoints are `String`, `Int`, `ID`, `__typename`, `__Type.kind` — names the
GraphQL SPECIFICATION defines and forbids a user schema to declare, so no `brain_symbol`
row exists for them and neither of the store's two resolution strategies can land them.
Admitting the specification's own vocabulary — the five built-in scalars plus the
RESERVED PREFIX `__*`, the prefix the specification itself reserves — `references` is
**99.11% resolved at both ends with 157 dangling endpoints**. Reporting the bare 44.78%
alone would read as an analyzer defect and is not one.

CSS `references` at 66.8% on both ends is the project's reference point; this lane's
`references` is **99.11%** and its `contains` and `overrides` are 100%.

**`uses` at 15.86% is the one genuinely low figure**, and its causes are counted
rather than asserted: of 98,516 endpoints, 57,068 bind in their own file, 13,384 are
ambiguous bare names the store's uniqueness rule refuses to guess between (13,479 of
those are on a handful of very common field names — `id` has hundreds of candidate
owners), 12,317 are spec vocabulary, and **15,044 are dangling**. A field selection
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

**6 — Confident.** Every one of the **156,754** edges carries a numeric `confidence`,
and the histogram for every emitted type is a single bucket at **1.0** — **0 edges
below 0.7**, so the **heuristic ratio is 0.0000**. `evidenceClass` reads `structural`
on all **156,754** of them — the census reports `evidenceClasses: {"structural":156754}`
and `confidenceUnder07ByType: {}`. The graph is 100% deterministic parse facts, and that is now a
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
**set A = 47,667, set B = 47,667, fabricated 0, lost 0** — re-measured at HEAD,
1,905 files, production `parseFile`, 0 excluded, 1 file returning no references, 6
declarations under a parse `ERROR`. Getting to a clean 0/0 took three more
corrections, every one of them on the probe's side and two of them turning a
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

## Incoming ambiguity: the tsv number, and what it is actually counting

`validation/m14/measurements/incoming-whole.tsv` reports, per lane, how many
relationship targets resolve to more than one published symbol (`ambiguous`) and
how many to none (`unresolved`). This lane reads `amb 3,710  unres 4,427` at 600
files. Those two numbers need their instruments attached before they can be acted
on, and acting on the first one as printed would have been wrong.

**An ambiguous target is ONE edge the reverse walk attributes to N declarations,
not N edges.** It cannot be lowered by emitting fewer edges and it cannot be
lowered by implementing another relationship type. It falls only when symbol
identity becomes sound. `script/m14/tmp/graphql/probe/ambiguity-split.mts`
separates the causes over the full 1,905 admitted files, first-match so the three
sum to the total:

| bucket | kind rule | store rule | owner |
|---|---|---|---|
| B1 all declarations of the name in ONE file | 32 names / 509 edges | 74 names / 827 edges | lane |
| B2 the name carries ≥2 kinds across files | 276 / 14,601 | 254 / 13,727 | partly lane |
| B3 one kind, N declaring types | 0 by construction | 6,566 / 73,262 | published-name contract |

**There are two resolution rules in play and they disagree about what collides.**
`script/m14/incoming-check.ts` keeps `name -> distinct KINDS`, so `hits.length > 1`
means the name is published under more than one *kind*; a name declared on 47
types is one kind and is therefore not ambiguous to it. `parallel-indexer.ts`
`resolveRelationships` tries a qualified-name exact match first, then accepts a
bare name only when its **symbol** count is 1. A bare name carried by 1,866
symbols is ambiguous to the store and invisible to the kind rule. **B3 is
unreachable under the kind rule by construction**, which is why the tsv's `amb`
cannot be read as a claim about the same thing the store will experience.

**B1 is not a defect either, and this lane checked rather than assumed.** The 74
names are one name under two kinds inside one file — which in GraphQL is legal
and correct: `type Query { bwr_GroupInstances: Bwr_GroupInstancesConnection }`
declares a **field** named `bwr_GroupInstances` on `Query` *and*, 2,052 lines
later, an **object type** named `bwr_GroupInstances`. They are two symbols that
share a spelling, and a bare target cannot separate them. Verified on the two
largest cases through production `parseFile`:

```
property  qname=Query.bwr_GroupInstances  L31   <- the field
class     qname=bwr_GroupInstances        L2083 <- the type
```

and `introspection.graphql`: `class Album` L33, `property query_root.Album`
L1545, `property subscription_root.Album` L2027. **Within one document there is
not "exactly one right answer"** — the premise B1 was built on is false for a
language whose type system and field namespace are separate vocabularies that
routinely collide. No repair is available at the bare-name level; separating them
means publishing a qualified target, which changes what the edge means and
belongs to the published-name contract, not to this file.

### The unresolved half, and the bucket that looked like a defect and was not

19,066 unresolved targets over 1,905 files, every one classified into exactly one
of four buckets:

| bucket | edges | share of unresolved | fixable by emitting something |
|---|---|---|---|
| S1 spec vocabulary — `__typename`, built-in scalars | 4,586 | 24.1% | no |
| S2 present in corpus text, claimed by no symbol | 620 | 3.3% | **no — see below** |
| S3 absent from every admitted file | 6,530 | 34.2% | no |
| S4 path-shaped — `JiraIssueField.__typename`, `b.graphql` | 7,330 | 38.4% | no |

**S1 + S3 are 58% of every unresolved edge in this lane, and neither is a
defect.** A GraphQL schema names types it does not define: SDL is split across
files, an executable query names types a schema file elsewhere declares, and the
specification defines `__typename` for every schema while no file declares it. An
edge to a name outside the population is *correct*, and its target cannot resolve
inside the population. That is the answer to "why is `uses` 38% unresolved".

**S2 was briefly documented here as the only lane-owned bucket. That was wrong,
and `script/m14/tmp/graphql/probe/decl-inventory.mts` is the correction.** A
corpus-*text* scan cannot distinguish a declaration from a usage. `story` is S2's
second-largest name at 27 edges; `grep story` finds it in absinthe's
`kitchen-sink.graphql` as a **selected field inside an executable query**, not as
a declared type. All 40 of S2's heaviest names were checked against the
corpus-wide published-symbol set — 69,230 distinct names — and **all 40 return
`NO SYMBOL ANYWHERE`**, which is what a usage looks like. S2 measures "this schema
names something it never defines", which is correct GraphQL.

The question S2 was meant to ask needs the grammar, not the text. `decl-inventory`
walks the parse tree, collects the name at **every declaration node** — analyzer
independent — and diffs against the analyzer's symbols:

```
grammar declaration sites                36,730
distinct declared names                 11,745
declared but published by NO symbol          0
```

**Zero dropped declarations over 1,905 files.** The `imports` family's targets
are the remaining S2 residue and are path-shaped by design (`#import "b.graphql"`
names a file, and the store resolves a file, not a symbol).

Three accessors in that probe each returned a **plausible zero** rather than an
error, which is recorded because an instrument that finds nothing and cannot say
why is not a pass: `node.type` is `PascalCase` (`ObjectTypeDefinition`), not
snake_case; the name node is `Name`, capital N; and a field's name is a **direct**
child, so a last-`Name`-at-any-depth walk descends into the return type and
`n: String` yields `String` — that one produced 11,745 *wrong* names rather than
a zero. A fourth correction came from the symbol contract itself: a first working
run reported 143 names "declared but not published", every one a
`DirectiveDefinition`, because the contract publishes a directive definition as
`@name` and `requiresOptIn` ≠ `@requiresOptIn` to a string comparison. **143 is
exactly what a `@` in a name is worth.**

### Two counters that read 0 for the wrong reason, and what they actually say

Both were written by this lane to answer a real question and both were wrong in a
way that produced a clean number rather than an error. Recorded because a probe
that cannot fail is not a probe.

**`unknown` endpoints: 3, and all 3 are real field names.** The counter tallies
relationship endpoints equal to the literal `unknown`, and 3 `uses` edges carry
it. All 3 are in HotChocolate adapter fixtures whose document literally declares a
field called `unknown` — `$unknown: Unknown! = "default"` and a selection
`unknown` inside `withDefaultedVariables { … }` in
`GetWithDefaultedVariables.graphql`, `GetWithNonNullableVariables.graphql` and
`GetWithNullableVariables.graphql`. The edge is
`<file>::operation_<n> -> unknown`, `relationshipRole: field_selection`. So
the target is the document's own spelling, the counter cannot tell it from a
placeholder, and **3 is the number of GraphQL fields named `unknown` in the
admitted corpus, not a defect count.** An `unknown`-placeholder gate cannot exist
for this language without first checking whether the source wrote `unknown`.

**The counter reads 3 on a re-walk of the analyzer as it now stands, and that is the
point worth recording.** The source of these 3 edges was published as
`anonymous_operation_1782` before this lane's unnamed-operation fix and as
`<file>::operation_<n>` after it, and the count of `unknown` *targets* is unchanged
across both — the fix changed the source's identity, not the target the document
wrote.

**Every relationship carries a line: 156,754 of 156,754.** The first version of
this probe reported **100% line-less**, which is the most alarming number in this
document and was entirely the probe's fault. The field is `line_number`; the
probe read `rel.line ?? rel.startLine`, both absent on the relationship shape
(`source, target, type, confidence, line_number, metadata`), so every edge looked
unlined. Re-run against `line_number`: **0 edges at line 0**, across all 7 emitted
types and 19 roles.

## The residual, attributed (2026-10-11) — 84,075 edges, every one in a class, and no claim kind is legal

The programme's completion test changed on 2026-10-09: *"a lane reading n/n on the coverage ratio is
not done."* `npx tsx script/m14/residual-gate.ts --lane graphql` is the instrument, and it prints a
per-type table plus a marker-set table. Neither names a cause, so this lane built the instrument that
does — and the two instruments that follow, all three committed beside this document.

    instrument                                          what it answers
    fixtures/graphql/probe-graphql-residual-causes.mts  cause per (type × role × marker set) + evidence
                                                        per target + own-file determinacy + §5e ceiling
    fixtures/graphql/aggregate-residual-causes.mts      the same rows aggregated, with its own closure check
    fixtures/graphql/probe-graphql-spec-vocabulary-    is ANY claim kind a legal disposition for these classes
      disposition.mts

**TWO RUNS, LABELLED, AND BOTH ARE ONE RUN EACH.** The whole admitted population is 1,911 `.graphql`/`.gql`
files in 22 repos (1,915 tracked, 4 over the 1 MB cap). The shared laptop's `.bb-heavy-v3.lock` was held
by another lane for the whole window, so both are the labelled unguarded `nice -n 10` draw the programme's
operational note allows, with the label written into the artifact:

    A  script/m14/incoming-gate.ts graphql graphql,gql 0   revision 1f5951a0a  analyzer sha256 3d3933fc76
    B2 probe-graphql-residual-causes.mts --compare <A>     revision 9677e0c5f  same analyzer digest

**AND B2 REPRODUCES A EXACTLY — all 14 columns × 10 types, not the edge count alone** (`AGREE`). That
check earned its place: the FIRST attempt (`B`, kept as a labelled non-result) disagreed in exactly two
cells — `imports.unresolved 170 vs 14`, `imports.extOK 0 vs 156` — because the probe passed the
repository **NAME** as `context.projectRoot` where the gate passes the **ABSOLUTE repository root**, so
the analyzer's `importProjectFile` claim silently never attached. Every other cell agreed, including
`parsed=1911 failed=0`; nothing but a reproduction check could have said so (§5w). A second defect was
caught by re-reading before the rerun: the spec-reserved `__` test was applied to the target's **head**
segment only, which would have filed `JiraIssueField.__typename` — a meta-field §3.6.3 defines for every
type — under an ordinary "member absent" gap. Both are the same lesson the programme keeps paying for:
**a probe is an instrument and needs its own evidence.**

### The residual, by evidence (production scope = per project; classes are first-match and they CLOSE)

    lane residual 84,075 of 205,327 edges (40.95%) — 6 types carry it, `contains` is 0
    BARE-NAME-COLLIDING (≥2 declarations answer in the project)      28,266   33.6%
    spec:built-in scalar  (`String` `ID` `Boolean` `Int` `Float`)    25,255   30.0%   over FIVE names
    spec:__-reserved (introspection namespace, 23 names)              11,112   13.2%   `__type` 6,258
    BARE-NAME-ABSENT (nothing in the project declares it)             10,396   12.4%
    DOTTED-OWNER-ABSENT (the owner type is declared nowhere)           6,149    7.3%
    DOTTED-MEMBER-COLLIDING (owner IS declared)                        1,031    1.2%
    spec:__-reserved meta-field (`Type.__typename`)                      755    0.9%
    DOTTED-OWNER-DECLARED-MEMBER-ABSENT                                  654    0.8%
    spec:built-in directive / draft directive (`@deprecated`, `@defer`)  446    0.5%
    PATH-SHAPED (a URI/path cannot be a published name)                   11    0.0%

**The specification's own predeclared vocabulary is 37,568 edges — 44.7% of the whole residual — carried
by 35 distinct names**, and the largest single site is nine edges short of a third of the lane:
`uses field_selection` on a BARE target, 24,364 residual. The largest *evidence* class by edges is
`references` → `String`, whose whole cost is **13,644 edges for one name**.

### The ambiguous half decomposes by OWN-FILE DETERMINACY, and 64.9% of it is a MODEL artifact

`classifyEdge` is handed a name-keyed count and no file — its own docstring says so — while production's
`resolveTargetStmt` orders by `COALESCE(s.is_declaration,0), (s.file_id = ?) DESC, … LIMIT 1`. So the
probe asks the question the model cannot, and the 31,012 ambiguous edges split:

    own file declares the name EXACTLY ONCE   20,121   64.9%   production binds it determinately
    own file declares the name MORE THAN once    705    2.3%   `s.id` TEXT comparison decides the row
    own file declares it NOT AT ALL           10,186   32.8%   only foreign declarations answer; s.id decides

The first row is the ruling this lane can now make with a number instead of an argument: `amb(decl)` is
a statement about the **name-keyed model**, not about the graph, for 20,121 of these edges. The third
row is the genuine one — and it is the class `5x` calls *"twin exists"*, where the store's write order
decides which foreign declaration wins.

### THE §5e CEILING IS MEASURED AT 0.52%: the fleet's favourite fix is NOT paid here

§5w: *"No lane may borrow a ceiling — it must measure its own before writing the rule"* (php 100% ·
bash 59.5% · julia 0.6%). Measured on this lane's whole ambiguous population, with §5e's monotonicity
clause **computed rather than assumed** (every declaration reachable through the respelled alias must
also be a declaration of the bare name):

    of 31,012 ambiguous edges, a §5e respell would make EXACTLY ONE declaration answer for   160   0.52%
    the respell would leave it colliding under the new key                                  563
    no better spelling exists (the derived qualifiedName IS the bare name)                 18,521
    monotonicity violations                                                                    0

**18,521 of them have no better spelling at all**, and the reason is structural rather than accidental:
the lane publishes no file-scoped `qualifiedName`, and `pool-worker.ts` derives
`scope ? scope.name : name`, so a TOP-LEVEL type — which is what `references`, `exports` and `implements`
name, and what `exports` emits for (`s.metadata.topLevel` is the emit-time flag) — is spelled by its bare
name and nothing else. **A fix whose whole reach is 160 edges, on a fleet fix already measured as low as
0.6% elsewhere, is RULED and not paid.** The monotonicity result is the other half of the ruling: the
respell would be SAFE here (0 violations), and that is not a reason to buy it.

### NO AVAILABLE CLAIM KIND IS A LEGAL DISPOSITION — measured, not argued

§5x says a class of edges naming nothing *"needs a claim or an explicit rule per class."* Attempting the
claim is the cheap move, so the disposition probe attaches **every claim kind the arbiter knows** to the
largest classes, in turn, and reads the outcome from `classifyEdge` — imported, never copied. A
disposition is legal only if the project can REFUTE it when it is false:

    arms across 9 representative targets × 8 dispositions
      the claim is NEVER READ — the edge just resolves when the name is declared   28
      ILLEGAL — refutes on a target that names nothing                              25
      falsifiable (dotted owner claims only)                                        11
      unverifiable — `ext?`, which blocks a PASS by construction                     8

For a **bare** target (`String`, `ID`, `__type`, `__typename`, `@deprecated` — 95%+ of the spec-vocabulary
class) every arm fails: the owner claim is read only where `decls === 0`, so a project that DOES declare
the name turns the edge into a `resolved` and **the claim is never consulted** — it cannot be refuted, and
`unresolved` would fall while nothing got truer. That is §5l's laundering vector, and julia-lane refused a
free 10.7 points to it. The dotted classes are worse, not better: an owner claim on
`JiraIssueField.__typename` IS falsifiable, **and that is exactly why it is unusable** — 654 of the dotted
`uses` residual has an owner the project DOES declare, and this analyzer is per-file, so it cannot tell
an owner that lives in a sibling file from one that lives nowhere (§5k's php vendor-API boundary, §5l
rule 3's julia counter-example). Attaching it would take `extFAIL` off the zero it must stay at.

**SO THE CLASSES ARE RULED, each with its mechanism and a RUNNABLE falsifier:**

| class | edges | mechanism | falsifier |
|---|---|---|---|
| spec scalars + `__`-reserved + spec directives | 37,568 | the specification predeclares them; §3.9 forbids a schema to define a `__` name, and §3.5 forbids redefining the built-in scalars, so **no declaration can exist in any project** | a `claimBasis` claim kind whose closed list lives in the ARBITER, not the analyzer (§5k's rule: checkable by a mechanism the claimant does not control). It would make these falsifiable and close all 37,568 in one change |
| bare name colliding, own file declares it once | 20,121 | production's own-file preference binds it determinately; the classifier is file-blind | `hcl-lane`'s `store-binding-truth.mts` pattern against `brain_relationship.target_symbol_id` — **RUN 2026-10-12, RULING HOLDS**: see "THE DETERMINACY RULING IS MEASURED" below |
| bare name colliding, foreign declarations only | 10,186 | no per-file evidence names which declaration the document meant; the store's `s.id` tie-break decides | the same store probe; a project-index pass that resolves a fragment/operation to its schema |
| bare name absent everywhere | 10,396 | the schema the document selects against is outside the admitted `.graphql` population (executable fixtures: a query names fields of an API schema that no file in the corpus declares) | admit those schema files, or index-assisted resolution |
| dotted owner absent | 6,149 | the member's owner type is declared nowhere in the population | as above |

### THE DETERMINACY RULING IS MEASURED AGAINST A REAL STORE: 131,514 EDGES, 0 EXCEPTIONS — AFTER CORRECTING THIS PROBE'S OWN KEY

The falsifier named in the table above is `validation/m14/fixtures/graphql/store-binding-truth.mts`: it
copies every admitted `.graphql`/`.gql`/`.graphqls` file into a project root, indexes it through the
PRODUCTION indexer, and reads each edge's binding off `brain_relationship.target_symbol_id` — so the
question "does production bind the own-file declaration?" stops being a reading of `resolveTargetStmt`'s
`ORDER BY` and becomes a column in a table. One run, one index — the committed one holds 1,909 files and
261,745 relationship rows (the pre-fix run held 1,754 and 257,279; why they differ is stated below) — and
the store is order-dependent, which the probe's own output says. The artifact on disk is the
POST-FIX run (see below); it holds **1,909 files and 261,745 relationship rows**, and its first axis reads:

    axis (a), the symbol's NAME only
    class      edges     bound   ->THE own-once decl   ->own file   ->elsewhere   unbound
    own-once  61,334    61,334            61,334          61,334           0            0
    own-many  45,672    45,672               n/a          45,672           0            0
    own-none 144,318   127,567               n/a          71,021      56,578       17,315
    no-source 10,421    10,415               n/a               0      10,415            6

    per type, own-once: contains 15,253 · uses 8,686 · references 34,276 · implements 3,119
    per type, own-many: contains 45,103 · uses    59 · references    508 · implements     2
    whole type totals: contains 120,433 · references 67,172 · uses 50,754 · exports 10,333 ·
                       overrides 9,790 · implements 3,177 · imports 86
    VIOLATIONS (own-once edges that did NOT bind the own-once declaration): 0

**THE CORRECTION, and it is this instrument's error rather than the analyzer's.** A declaration is
findable under THREE spellings, and the first version looked at one of them:

| axis | key | what it is |
|---|---|---|
| (a) | `symbol.name` | what the first probe matched |
| (b) | `symbol.qualified_name` | **the alias of the SAME declaration** — `Type.field` is one declaration spelled twice, and the lane's own probe bumps this second key (`probe-graphql-residual-causes.mts` does it only when `qname !== name`, with the comment "THE ALIAS IS THE SAME DECLARATION, not a second one") |
| (c) | `extractLeaf(target)` against `symbol.name` | the key `resolveTargetStmt` is actually queried with (`parallel-indexer.ts:3096` matches `s.name = ?`; `4269-4305` feeds it the leaf) |

Measured on the same store, so the size of the error is known rather than felt:

    own-once by (a) NAME                            61,334 edges · bound that declaration 61,334 · 0 outside
    own-once by (b) QUALIFIED-NAME alias only       69,907 edges · bound that declaration 69,907 · 0 outside
    own-once by (c) LEAF only, invisible to (a)+(b)    273 edges · bound that declaration    273 · 0 outside
    own-many by (a)+(b)+(c)              45,672 + 47 + 198 · bound in the own file 45,672 + 47 + 197
    declared NOWHERE under any of the three keys    73,893 edges · bound out-of-file 56,578 · unbound 17,315
    OWN-FILE-DETERMINATE ACROSS ALL THREE KEYS     131,514 edges · 131,514 bound EXACTLY the own-file
                                                   declaration · 0 bound elsewhere · 0 bound to nothing

**TWO STORES, TWO NUMBERS, AND BOTH ARE STATED — because something else changed between them.** The
PRE-fix store, measured an hour earlier on the same corpus and the same analyzer, read **60,333 / 68,773 /
273 — 129,379 determinate** and refused **254** files. The post-fix store reads **61,334 / 69,907 / 273 —
131,514 determinate** and refuses **99**. The difference is not this lane: at 14:25, between the two runs,
the shared indexer landed `1c530e78b` ("the `ignore` package defaults to CASE-INSENSITIVE — make it agree
with GIT"), whose message states the defect was costing **12,479 routed-extension files across the corpus
— `.graphql` 156 of them**, and cites this lane's 156 as one of its three confirmations. Its own falsifier
was stated as "the indexer's admission count should RISE by the files this was losing", and the post-fix
run is that falsifier firing: **1,754 → 1,909 files admitted (+155 net), 257,279 → 261,745 relationship
rows (+4,466)**, and the own-file-determinate class **+2,135 edges**. The pre-fix numbers above are the
artifact `store-binding-truth-run5`; the committed JSON is the post-fix one.

**Axis (b) carries 69,907 edges — more than axis (a) found — and this is why the correction matters:
the lane's own probe already uses it, so the lane's TABLE 4 was never wrong, and MY instrument was.**
Two dimensions of that error are worth recording for whoever reads the next store probe. **Axis (c) is
small**: 273 edges, 0.21% of the determinate class, so a name+qname probe is not materially wrong for
this language and the fleet's other probes are not implicated by this measurement. **And the pattern it
broke was already in the repository**: the ancestor this probe was modelled on,
`validation/m14/fixtures/xml/store-binding-truth.mts`, documents the leaf rule in its own header
("insert time `extractLeaf(target)` first (`parallel-indexer.ts:3375-3390`)", line 13) and reports a
`qnameSuffix` strategy beside it — so the key that was missing here was a regression from the pattern
rather than a new blind spot, which is the kind of thing only running the instrument against a real
store can expose. The
9,643 `overrides` edges that the first version reported as an unexplained disagreement between analyzer
and store are the same story: they classify `own-none` under (a) because the analyzer publishes an
override as `Type.field` while the symbol's `name` is `field` and its `qualified_name` is `Type.field`.
All 9,641 bound edges ARE the own-file declaration, and the class is scored, not excused. The earlier
sentence in this section — "the analyzer's override target is not the declaration's `name`, so the type is
reported, not scored" — is TRUE about the spelling and was the WRONG CONCLUSION about the class: the
spelling difference is a key, not a defect. The rows stay in the document because the mistake is the
useful part of this section: **an instrument whose key does not match the resolver's reports phantom
anomalies, and it reports them confidently.**

So **the 20,121-edge ruling is no longer a MODEL claim** and it is not a name-keyed 61,334-edge claim
either: over the whole index **every one of the 131,514 own-file-determinate edges bound its own-file
declaration — 0 bound elsewhere, 0 bound to nothing** — and the 20,121 edges the lane ruled are the
sub-population of it that the classifier called ambiguous. The store also confirms the *clause order* rather than only its
first clause: `own-many` bound in-file 45,035 of 45,035 under (a), and `own-none` bound out-of-file (uses
23,636 · references 31,480 · implements 40), which is what `COALESCE(s.is_declaration,0), (s.file_id = ?)
DESC, id` predicts for each class.

**THE POPULATION THE RULING COVERS, and the files that never reached the store.** A predicate about "the
edge's own file" is only as strong as the index it runs over, and the index refuses files. The probe
CHARGES each refusal to a rule the production walk itself applies, and the test that the rule list is
complete is that nothing is left `UNEXPLAINED` — **post-fix, 2,008 copied candidates / 1,909 stored / 99
refused, and the three rules account for all 99:**

    97  extension not routed anywhere by language-detection.ts — `.graphqls`
     1  ParallelIndexerConfig.skipPatterns             — `/\/generated\//i`
     1  built-in ignore glob in discoverAndFilterFiles — `**/testData/**`, its INTENDED spelling
     0  UNEXPLAINED

**The pre-fix run of the same probe read 156 + 1 + 97 = 254, and the 156 is what the fix removed.** That
first run found `**/testData/**` refusing the corpus's lowercase `testdata/` — the `ignore` npm package
(5.3.2) matches case-insensitively by default, measured directly:
`ignore().add(["**/testData/**"]).ignores("x/testdata/a")` is `true` while `x/test/a` and `x/tests/a` are
kept, and the index agreed exactly (156 of 157 testdata-segment `.graphql` files absent, 0 of 1,449
non-testdata absent). That measurement was published in this document, and the shared indexer fixed it the
same afternoon (`1c530e78b`, four construction sites, `ignorecase: false`). **The surviving 1 is the rule
working as written — a file spelled with the capital-D `testData` it was written for** — which is why the
post-fix run still charges one file to it rather than reading 0. **And `.graphqls` was routed nowhere in the analyzer fleet when this section was written — it was FIXED while this lane's fleet census ran, and this section is now labelled PRE-FIX everywhere below.** `language-detection.ts` gained one map entry, `graphqls: "graphql"` (**`1150b2140`, 15:12 today**), so the corpus's 97 `.graphqls` files are admitted and routed from that commit on, and the price below is what that one entry was worth. **The fix moves this lane's OWN population and no number in this section has been re-derived over it**: the lane's census reads 1,911 files (305 `.gql` + 1,606 `.graphql`) precisely because the unrouted 97 were excluded, and the router now accepts them, so the population this lane's numbers describe has grown by 97 and every rate below is a rate over the smaller set. That is stated rather than silently rewritten — re-running the lane's census over the larger population is the falsifier and it is still owed.

The class `.graphqls` belongs to now HAS the census it lacked: `script/m60/unrouted-extension-census.ts` → `validation/m14/measurements/unrouted-extension-census.json`, and **`.graphqls` is that census's first settled row**. A live walk cannot contain it any more, because "fixed" is exactly what that means, so the census keeps a ledger of the rows this wave fixed, prices each on its real file pool, and REPLAYS this document's artifact as the citation beside it — the settled entry reads the corpus's `.graphqls` count, its own stride priced at run time, and `armA`'s 97 files / 83,371 symbols / 195,108 relationships quoted from `unrouted-population-price.json` rather than transcribed — the settled entry reports **97 counted + 3 over the census's 1 MB sampling cap**, and the corpus holds **100 tracked `.graphqls`** (`graphql-java`'s three 5–7 MB test schemas are the difference), so the lane arithmetic above should be read as **+97 under that cap and +100 without it**. The census's method, its results over 1,059 refused extensions, and its own four self-corrections are recorded in `docs/analyzers/unrouted-extensions-census.md`. It is a product gap rather than a ruling, and the gap is closed; what remains open is the REST of the class.
recorded here because this lane's census (1,911 = 305 `.gql` + 1,606 `.graphql`) correctly excludes those
files and a reader comparing the two numbers deserves the reason. **The census the router's comment points at does NOT
answer this question, and that is worth knowing before it is trusted for it**:
`script/m60/routing-outlier-census.ts` measures extensions routed to a grammar that CANNOT REPRESENT the
format (`.pyx` as Python, `.gsp` as Groovy — its own header's examples), which is a different class from an
extension routed NOWHERE, and `grep -c graphqls` over that 408-line instrument returns **0**. That is exactly
why the fleet census above is a SEPARATE instrument rather than an extension of it: the same `.graphqls`
measurement is **0 rows in the sibling census and the first row in this one**.

### THE TWO PRODUCT REFUSALS ARE PRICED, AND ONE OF THEM IS NOT A TUNING DECISION

`validation/m14/fixtures/graphql/unrouted-population-price.mts` prices each refusal, and
`unrouted-population-price.json` is the artifact. Arms A and A2 are the SAME 97 files measured twice,
because the first measurement is the finding:

    A   the 97 `.graphqls` files as they sit        parsed 0 · DEGRADED 97 · 0 symbols · 0 relationships
    A2  the same 97 contents, routed to the analyzer parsed 97 · 83,371 symbols · 195,108 relationships
    B   the 156 `.graphql` under `testdata/`        parsed 156 · 1,559 symbols · 3,575 relationships
    C   control — 250 files production DOES read    parsed 250 · 16,719 symbols · 39,563 relationships

**Arm A is not a tuning decision.** An unmapped extension does not fail loudly: `parseFile` derives the
language from the path, `.graphqls` falls into `pool-worker`'s catch, and the file is answered by
`extractFallback` — the REGEX extractor — which finds **0 relationships across all 97 files**. So these
files are not "slightly worse represented"; they are represented by an instrument that cannot see a type
definition at all, and they report **0 symbols**. Routed to the analyzer, the same content yields 83,371
symbols and **195,108 relationships** (references 70,812 · contains 69,625 · uses 18,784 · overrides
18,162 · exports 13,746 · implements 3,979) — on its own, three quarters of the size of the whole graph
this language publishes today. The fix is ONE entry in `language-detection.ts`; it is not this lane's to
make, and it moves the arbiter's own corpus for this language (the gate selects files with
`detectLanguageFromPath`), so it is priced here and named in `LAPTOP-B-STATUS.md` rather than taken. The
A2 caveat travels with the number: a temp-dir copy has no cross-file resolution and no store, so A2 is the
analyzer's yield on the CONTENT, not a store edge count.

**Arm B turned out to be a defect, and it is FIXED — the price is what got it fixed.** Those 156 files are
3,575 relationships (references 1,126 · contains 992 · uses 805 · exports 411 · overrides 147 · implements
94) and they are test fixtures: genqlient's error corpus, gqlgen's federation/modelgen testdata, hasura's
test projects. Skipping a test-data directory is what the glob says it does; what it did not say is that
it matched case-INSENSITIVELY, so a glob written for the Azure spelling also refused the corpus's
lowercase `testdata/`. The measurement in this document is one of the three confirmations the shared
indexer's fix cites (`1c530e78b`), and **the post-fix store admits them**, which is why the committed
store artifact holds 1,909 files against the pre-fix 1,754. What remains true is the reason the rule was
worth keeping rather than deleting: its other half is deliberately narrow and was measured while deciding
this — **1,056 `.graphql` files under a `/test/`, `/tests/` or `/__tests__/` segment were ALREADY in the
store before the fix** (those directories are kept on purpose, measured), and `isTestFileCandidate`
returns `false` for this language by construction (`NON_CODE_TEST_LANGUAGES` holds `graphql`), so no part
of the pipeline ever called them tests.

And **45 files hold content and returned NO symbols AND NO relationships** (45 of 1,911) — those files
contribute nothing, so every count above describes evidence that is missing rather than evidence that is
wrong. **THE CAUSE OF THE 45 WAS ATTRIBUTED TO THE 120-SECOND TIMEOUT AND THAT IS REFUTED** — see the
section below, which re-measures all 46 by running them and reading the tree.

### THE ARBITER REFUSED THIS LANE'S TWO `A` ROWS, AND THE REFUSAL WAS CORRECT (2026-10-12)

This lane's §7 criterion-2 adjudication read, at the previous revision — and it is worth saying why an
EARLIER run quoted at the top of this document reads the more flattering `ruled-sound 3`: that run predates
the arbiter's space check, so its `A` rows were certified by a vocabulary probe that had never been asked
which spaces it enumerated, on a tree the bash grammar had produced. Both defects are documented here,
and the green line they produced is the reason this section exists:

```
emitted 7/10 · ruled-sound 1 (extends) · ruled-unknown 0 · ruled-unjustified 2 (calls, instantiates)
calls        NOT EMITTED, and the probe does not cover the space this language USES: the corpus writes
             N key/value bindings …, so a construct spelled as an attribute key cannot appear in a
             node-type inventory — that is exactly how HCL's `inherits` hid 44 sites.
```

**Both halves of that refusal were real, and they are two different defects.** The grammar half is item
**0b** above (both instruments were parsing a bash tree). The space half does not go away when the
grammar is fixed: a node-type inventory still cannot see a construct spelled as a KEY, and GraphQL is
key-bearing in the arbiter's own structural sense — a `FieldDefinition` is `Name`, `:`, `Type`, three
children whose middle one is the anonymous `:` token. Fixing only the grammar would have moved the
number (57 → 128 node types) while leaving the verdict unjustified, which is why both halves are here.

**The probe — `validation/m14/fixtures/graphql/rulebook-space-probe.mts`, artefact
[rulebook-space-probe.json](../../validation/m14/fixtures/graphql/rulebook-space-probe.json) — measures
both spaces on the arbiter's own population (git-tracked, detected as graphql, ≤ 1 MB):**

| measurement | reading |
|---|---|
| admitted files / nodes / parse failures | 1,911 / 2,338,690 / **0** |
| node-types | **75 named + 53 anonymous = 128 distinct** — the same inventory the lane's separately written census publishes |
| attribute-keys | **50,284 bindings over 7 key-bearing node types, 5,502 distinct keys** |
| nearest real forms, named | 1,150 argument-bearing `Field` · 2,962 argument-bearing `Directive` · 3,715 `ObjectValue` |

**THE SITE RULES, and both of them need BOTH halves** — the key must name the construct AND the value
must be the application or the construction:

```
calls          key names a callee      AND  value APPLIES it (has an `Arguments` child)      -> 0
instantiates   key names a constructor  AND  value CONSTRUCTS an instance of a type the
                                             DOCUMENT DECLARES                              -> 0
```

**THE CALIBRATION IS WHAT MAKES THOSE ZEROS MEASUREMENTS.** A counter that cannot fire proves nothing,
so the probe counts keyword-shaped KEYS with no site rule applied, and it fires: **22 `calls`-shaped keys
(21 `apply:`, 1 `execute:`)** and **340 `instantiates`-shaped keys (`create` 337, `new` 3)**. Every one
of them is an ordinary field or argument NAME whose value is a type or an enum — verbatim from the
artefact: `execute: BooleanOrString`, `apply: AFTER_RESOLVER`, `create: [{ node: { … } }]`. **Treating a
field NAME as a call is exactly the defect the arbiter's own first `extends` probe committed** when it
matched `class voice` inside a bash word list; the shape test cannot.

**AND THE FIRST VERSION OF THE RULE WAS TOO WEAK, which the probe caught rather than the gate.** With
only the value-shape half, `instantiates` read **304** — every one a `create: [{node: …}]` binding
inside an executable document's argument VALUE. That is an input VALUE whose key is a data key naming
no declared type, so the rule now requires the key to name a DECLARED type, applied over the whole
population rather than per file (a document may declare the type after the binding that names it).
`304 → 0` with the reason written down is worth more than a 0 that was never challenged.

**THE ATTESTATION — `validation/m14/fixtures/graphql/ruling-attestation.json` — is what the arbiter
reads, and it is not prose:** the gate resolves every pointer into the artefact and re-reads the number
there (`grammarInventory.namedTypes` 75 · `keySpace.bindings` 50,284 · `constructSites.calls` 0 ·
`constructSites.instantiates` 0). A pointer that does not resolve, or a declared count the artefact
contradicts, turns the row back to RULED-UNJUSTIFIED — and the gate's own control proves that arm fires
(its self-test plants exactly that pair and exits 3 if the two answers stop differing).

**WHAT THIS DOES NOT CLAIM, stated so the row is not read as more than it is.** It is not a claim that
a GraphQL document contains no applications: 1,150 `Field` nodes and 2,962 `Directive` nodes carry
arguments, and all of them are published as `uses` (roles `field_selection` and `directive_application`)
under the family's one-fact-one-label rule. It is a claim about the LABEL, and the overturn condition is
an R-number that assigns those sites to `calls` — satisfiable by relabelling, with no grammar and no
corpus change, which is the test for whether an overturn condition is real.

### THE `extends` PROBE HUNG THE ARBITER FOR 107 MINUTES — an infinite loop, found by measuring where the process died

The arbiter's instrument B calls `countOnTree` once per RULED type over the whole population, in-process.
This lane's `extends` probe never returned, and the failure mode is worth recording in full because the
symptom looks like "the corpus is huge" and is not:

```
walk: 1,910/1,911 … (the WALK had finished; the checkpoint was written at 08:13:56)
… then 107 minutes at 98% CPU with four lines of output and no error.
```

**The cause was one identifier.** `unwrap` descends a wrapper chain but re-read the child list from the
node it was CALLED with instead of the node it had reached:

```
let cur = n
for (;;) {
  if (!WRAPPERS.has(cur.type)) return cur
  const kids = (n.namedChildren ?? []).filter(Boolean)   // `n`, not `cur`
  if (kids.length !== 1) return cur
  cur = kids[0]
}
```

`n` is a wrapper and its single named child is another wrapper — which is what a `Definition` IS in this
grammar (`Definition -> TypeSystemDefinition -> ObjectTypeDefinition`) — so `kids` was recomputed from the
same `n` forever and `cur` never advanced. It does not throw, so nothing catches it; it is synchronous
JavaScript inside synchronous WASM, so `engine.ts`'s 120-second analyzer timeout cannot reach it; and the
process keeps burning a core, which reads as work rather than as a hang.

**THE GUARD IS `validation/m14/fixtures/graphql/extends-probe-terminates.mts`, and it has a falsifier arm
that fires:**

| arm | measurement |
|---|---|
| 1 — the OLD shape, bounded at 5,000 steps | **never returned inside the bound** on a real corpus file. The trigger population is **65,424** wrapper nodes with exactly one wrapper child across the 1,911 files, so the loop was reachable everywhere, not in a corner |
| 2 — the lane's REAL `countOnTree`, imported rather than reimplemented | completed over every file in **3,394 ms**, **0 hits**, matching the ruling's `publishedCount: 0` |

The recursion came out with it: `visit`/`collect` are now an explicit stack, for the reason the arbiter's
own header gives — a JS stack is bounded by nesting depth and this corpus ships a fixture that nests 200
list brackets on purpose (`err/6000_stackoverflow1.graphql`). **With the loop fixed the arbiter completes
in ~7 minutes**, which is how the rest of this section could be measured at all.

### THE ARBITER'S VERDICT: `ruled-sound 3 · ruled-without-justification 0 · FALSIFIED 0 · ruled-unknown 0`

```
attestation graphql: validation/m14/fixtures/graphql/ruling-attestation.json — spaces node-types,
  attribute-keys; artefact validation/m14/fixtures/graphql/rulebook-space-probe.json;
  VERIFIED nodeTypes=75, attributeKeys=50284, calls.constructSites=0, instantiates.constructSites=0

calls         RULED-SOUND   (attested: 0 construct sites in both spaces)
extends       RULED-SOUND   (instrument B: 0 occurrences on the tree)
instantiates  RULED-SOUND   (attested: 0 construct sites in both spaces)
uses 50,759 · contains 60,112 · imports 170 · references 67,328 · exports 13,991 · implements 3,177 · overrides 9,790   EMITTED
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0   ruled-unknown 0
```

Four things are established by that run, and the fourth is why it took three walks:

* **The attestation is verified through the gate's own verifier**, pointer by pointer, and the gate's own
  key-space instrument independently reads **50,284 bindings over 1,911 files** — the same number this
  lane's probe measured with a separately written walker. Two instruments, one number.
* **Every EMITTED count in this document and in the coverage block is reproduced by the arbiter** from
  production `parseFile`, which is the independent confirmation the block's `_implemented_measured` unit
  claims.
* **`ruled-without-justification 0` and `FALSIFIED 0`** — the two rows that were unjustified before this
  round are no longer unjustified, and nothing the gate looks for was found contradicted.
* **AND THE CERTIFICATION TOOK THREE WALKS, which is recorded because the first two were not clean.**
  Walks A and B each degraded exactly **one** file to `pool-worker`'s regex fallback, so the emitted
  population covered **1,910 of 1,911** and the gate refused to certify ABSENCE — correctly, since a file
  nobody read cannot establish that a construct does not occur — leaving all three rulings
  `RULED-UNKNOWN`. Walk C measured **1,911/1,911 with 0 degraded and 0 abandoned**, and the same three
  rows then read **RULED-SOUND**. The full run is committed as
  [ontology-coverage-gate-graphql.txt](../../validation/m14/fixtures/graphql/ontology-coverage-gate-graphql.txt).
  The degradation's signature is measured rather than guessed, and it is a SHARED-machinery item filed in
  §0c below: **a DIFFERENT file each walk**
  (`…SyntaxWriterTests.ObjectValue_Indented_MatchesSnapshot.graphql`, 54 bytes, on the first;
  `…Adapters.Mcp.Tests/__resources__/GetSingleField.graphql` on the second), **0 fallbacks in 40
  isolated runs** of the first file, and **0 fallbacks at BOTH concurrency 1 and concurrency 8** over a
  40-file batch. The only condition present in a whole-corpus walk and not in any of those probes is the
  footprint the walk prints about itself (`rss 326.3MB -> 580.8MB, +133.2MB per 1k files`). It is not
  chargeable to this lane's analyzer, and it cannot have hidden the construct either: a regex fallback
  cannot fabricate a `calls` or `instantiates` node the grammar does not produce, and both observed files
  are fragments that declare nothing (they are in the empty-yield class measured above).

### THE COVERAGE BLOCK HAD `imports` EXCLUDED WHILE THE ANALYZER EMITTED IT (2026-10-12)

`script/m14/spec/graphql-completeness.json` declared four exclusions, and **one of them was `imports`,
classed `grammar-absence`, with the evidence "whole-corpus firing over ALL 143 admitted .graphql/.gql
files … imports 0 edges"**. Both halves of that sentence were wrong, and the second is the one that hid:

* **`imports` is EMITTED** — 170 `#import` directives across 131 files, 156 of them naming a file that
exists on disk (91.76%) when resolved against the importing file's own directory. A grammar cannot see a
CONVENTION, which is the blind spot this lane's own ruled table documents for `calls`; the same blind
spot had the type RULED ABSENT while the corpus carried it. It is now listed as implemented.
* **143 is one repository's file count** (gql-gqlgen), not this lane's population — the arbiter admits
**1,911 files across 22 repositories** and names the 4 it excludes over the 1 MB cap. Every
"whole-corpus" zero in the block was a zero about gql-gqlgen, and three of the four exclusions were
resting on it.

**`extends` MOVED FROM `excluded` TO `corpusUnexercised`, and that is a correctness change rather than a
label change.** The coverage-block gate computes `applicable = 10 − grammar-absence − unclassified`, so
declaring `extends` excluded removed it from the DENOMINATOR — on a measurement of zero SITES, while the
construct is demonstrably expressible here (`implements` fires 1,710 edges on the same documents). The
honest reading is the one the ruled table already gives: the branch exists, the corpus never meets its
condition, so the type is applicable and unexercised. The block now reads:

```
graphql      yes       7     8     2     imports                                  -
```

— **7 implemented of 8 applicable, 2 exclusions, `imports` silent on the stale 120-file stride but
attributed by a per-type whole-population count, 0 problems.** The retraction and the population
correction are recorded inside the block rather than overwritten, because the wrong reading is what made
three exclusions look settled.

### THE 45 EMPTY FILES: NOT A TIMEOUT, AND NOT ONE OF THEM IS A MISS

This paragraph used to say the class was `engine.ts:1991`'s timeout path. That was a READING of the
engine, and the lane's own census already contradicted it (`parseReturnedFailure: 0`, `crashedFiles: 0`,
`zeroYieldNonEmptyFiles: 46` — nothing threw), so the class was re-measured by running it:
`validation/m14/fixtures/graphql/yielded-nothing-probe.mts` takes the census's own
`filesThatYieldedNothingDespiteBytes` list, sends every file through the PRODUCTION path
(`pool-worker.parseFile`, graphql), and classifies each one by **what the tree says**, never by path
name. Artefact: [yielded-nothing-probe.json](../../validation/m14/fixtures/graphql/yielded-nothing-probe.json).

| measurement | reading |
|---|---|
| files probed | 46 (the whole recorded class) |
| still empty | **45** |
| **now yielding** | **1** — `SyntaxWriterTests.ObjectTypeDefinition_Indented_MatchesSnapshot.graphql`, 5 symbols / 9 relationships; the census is from 2026-10-05 and the analyzer has moved since |
| **slow (> 5 s)** | **0** |
| degraded / fallback | **0** |
| files with a reported error | 45 |
| classification: `grammar-refuses` | **43** |
| classification: `empty-stub` | **2** (a 1-byte and a 2-byte `actions.graphql` — a newline is the whole file) |
| classification: parses cleanly, declares nothing | **0** |
| **classification: `MISS` — parses cleanly, DECLARES something, yields nothing** | **0** |

**The timeout attribution is refuted by the first two numbers that would have to move:** no file took
more than a second (the slowest is a 10 KB document at 1,067 ms, i.e. 1/112th of the budget), and none
was degraded or fell back. The dominant cause is that the GRAMMAR REFUSES THE DOCUMENT — and every one
of the 43 is refused because of what the file is, not because of anything this analyzer does:

* the corpus ships deliberately-invalid fixture trees (`hasura-engine/v3/crates/graphql/lang-graphql/tests/{query,schema}_testdata/err/*.graphql`, `gql-ruby/spec/support/parser/*_error_*` and `*invalid_utf8*`) — 23 of the 43 literally live under a directory called `err/`;
* non-document FRAGMENTS that a parser splits out of a document for a unit test (`$foo: bar = "baz" @qux`, `... on User`, a bare `ObjectValue`) — HotChocolate's `__snapshots__` tree;
* HotChocolate's nullability EXTENSION syntax (`field5?`, `listField[]!`) in `__resources__/kitchen-sink-nullability.graphql`, 50 error nodes on 2 KB — a dialect the pinned grammar does not implement;
* `gql-genqlient/docs/genqlient_directive.graphql`, whose 10 KB is documentation plus one `directive genqlient(…)` definition — and the grammar errors at line 46 on the directive's own NAME, because the definition's argument list carries a comment between arguments (18 error nodes).

**The cell that would have been a defect is empty, and that is the whole point of the table.** A file
that the grammar ACCEPTS, that declares a type or a directive, and from which the analyzer produced
nothing would be evidence missing where it should exist — a real miss, in this analyzer or in the
shared naming path. There are **0** of those. So the honest disposition of this class is a POPULATION
fact and not a lane defect: 43 files the pinned grammar refuses and 2 files with no content. They stay
in the admitted denominator (excluding them would be the flattering direction), and what changes is
what a reader may conclude from their emptiness — nothing about coverage, because no analyzer could
have read them.

**The one file that moved is the other half of the finding:** it was empty at census time and yields 5
symbols and 9 relationships now, on the same revision that has not changed the analyzer's object-type
path. That is why the class is re-measured through the PRODUCTION path rather than carried forward as a
number in prose — a stale count in an empty-yield table reads exactly like a live defect.

### THE FIX THAT WAS AVAILABLE: 170 `imports` edges whose stored row named no importer

Everything above is a ruling, and the reason no analyzer change is offered for the residual is that the
only fix with a ceiling above noise measures 0.52%. **The source direction is a different answer**, and
it is the half no residual column measures: `incoming-gate.ts` classifies TARGETS, so a relationship
whose SOURCE names nothing is invisible to it. The store has a contract for exactly that shape
(`parallel-indexer.ts:4391`):

    if (!sourceSymbol && rel.metadata?.fileLevel === true) { … sourceExternal = relativePath }

— a module-level edge whose source did not resolve to a symbol is rewritten to the **importing file's
project-relative path**. This analyzer's `exports` edges already carry the flag; its `imports` edges did
not, while their source is `lastPathSegment(filePath)` — a bare basename (`schema.graphql`) that **no
declaration can ever answer**, because a GraphQL name cannot contain a dot. The row existed, the
dependency existed, and the only thing missing was who declared it: verbatim the defect that clause was
added to fix, and the reason no surface could answer *"what does this file include"*.

**BEFORE/AFTER over the same population, one metadata line, everything else held:**

| | before | after |
|---|---|---|
| `imports` edges | 170 | 170 (unchanged) |
| `imports` sources answering no declaration | 170 | 170 (unchanged — the flag does not resolve anything) |
| `imports` sources the store can name an importer for | **0** | **170** |
| `exports`, same contract, for comparison | 13,991 of 13,991 | 13,991 of 13,991 |

**AND THE FIX IS PROVEN METADATA-ONLY BY THE INSTRUMENT THAT WOULD CATCH IT OTHERWISE.** `fileLevel` is
not one of `externalClaimOf`'s keys, so it cannot move a resolution; the AFTER run re-classified all
205,327 edges and the probe **reproduced `incoming-gate.ts`'s TABLE 1 on all 14 columns × 10 types**
against the BEFORE reference — same `edges / resolved / amb / unres / extOK / ext? / extFAIL /
bindOK / bind? / bindFAIL / causeOK / causeFAIL` on every type. That is the three-way check that
separates a fix from a bucket move, and it is stronger here than a before/after on one column: a change
that had touched the target side anywhere would have shown up in one of the 140 cells. Fixtures:
`{"graphql":{"pass":5,"fail":0}}`, *no regressions*; `npm run typecheck` clean.

**AND THE LANE'S OWN SOURCE-SIDE CLAIM IS SUPERSEDED, not repeated.** The section above "Sources are
checked too" reports **0 unresolved sources across all 19,054 relationships** — that is a **47-file**
run whose committed artifact (`script/m14/tmp/graphql/out/project-resolution.json`, 2026-10-05) records
22,022 relationships, so the sentence and its own artifact already disagreed on the population. The
current whole-population measurement is TABLE 5 of the probe: **`src-unres` 0 for all six non-file
sources** (`uses` 50,759 · `contains` 60,112 · `references` 67,328 · `overrides` 9,790 · `implements`
3,177), and the two file-spelled sources now both carry the flag. The source side's bare-name
*ambiguity* (`uses` 15,606 · `contains` 12,588) is the same collision class measured on the target side
in §"The ambiguous half", with the same own-file determinate subset — **and it is NOT claimed as 0**:
what is measured is that no source names nothing, not that every source names one thing.

### The lane's own earlier numbers, re-scoped rather than contradicted

`_incoming_side` in `script/m14/spec/graphql-completeness.json` records *"94.4% of the 2,317 unresolved
are licensed by the specification"*, measured on a **60-file stride**. At whole-population scope the
spec-vocabulary share is **44.7%**, and the difference is the sample's own bias rather than a change in
the graph: at 60 files the key space holds almost none of the project, so in-corpus declarations are
invisible and every unanswerable name looks external. Both numbers are true **of their populations** and
the sample is the lower bound (§6.01: *a stride sample is a valid lower bound and never a lane's gain*).
The `amb 3,710 / unres 4,427` pair quoted above is likewise NOT comparable: it was produced by
`incoming-check.ts`, which counts a name ambiguous when it carries ≥2 **kinds**, while this document's
numbers are **declarations** per project — the two rules disagree by two orders of magnitude on this
corpus, which is the point §"Incoming ambiguity" already makes.

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

## Regex inventory

**0 regex usages.** `validation/m12/results/regex-census.json` has no
`real-graphql-analyzer.ts` row, and the committed analyzer at `HEAD` was already
regex-free — the count is 0, not "pending paydown". Zero `RegExp` calls, and no
`match` / `matchAll` / `replace` / `search` / `split` used as a parser —
machine-checked by the fleet's AST census (`bash script/m14/no-regex-gate.sh` → 0
regex literals, 50/50 analyzers in scope under `src/ast`) and read directly by the
lane's lexical guard `script/m14/tmp/graphql/probe/no-text-scan.mts`, which exits
non-zero on a `regex-literal`, `RegExp-constructor` or
`structural-fact-from-a-text-comparison` finding. (The guard itself has no planted
negative control; the fleet census is the gate.) Descriptions are unquoted by
`slice` plus an explicit escape scan, and block strings are dedented by the
§2.9.4 algorithm implemented line by line. Three `String` operations remain and
are printed as permitted: `content.split("\n")` for the line count,
`inner.split("\n")` for the dedent, and `replaceAll('\\"""', '"""')` for the
block-string escape.

> A dated handoff, `archive/docs-pre-consolidation/M12.08-HANDOFF.md`, still records graphql as one of "the
> 2 remaining *replaceable* entries". That was already untrue at `HEAD` and is
> left as written, because rewriting a dated milestone record to match today's
> counts falsifies it. The current truth is the census plus this section.

## Supported constructs

The analyzer reads the **whole GraphQL document**, not only executable requests:

- **Type-system (SDL).** `schema` definitions and extensions; object, interface, union,
  scalar, enum and input-object definitions **and their `extend` forms**; fields, input
  fields and enum values; directive definitions with their arguments, defaults, locations
  and `repeatable`; `implements` clauses; union member lists; descriptions on every
  declarable node.
- **Executable.** Operations (`query`/`mutation`/`subscription`, named and shorthand),
  fragments, variables, field selections and aliases, fragment spreads, inline fragments,
  and directive applications on both type-system and executable nodes.
- **File inclusion — a convention, not syntax.** GraphQL has no `import`/`export`
  statement surface and the grammar produces no import node; what the analyzer reads is
  Apollo's `#import "<file>"` comment convention, published as `imports` (see
  `## Imports and exports`).

Symbols and identities are in `## Symbol contract`; the emitted relationship set is in
`## Relationship ontology`.

## Imports and exports

**This section was written before `imports` was implemented and it claimed
`imports` was always empty and that `#import` was not parsed. Both claims are now
false, and the section is corrected in place rather than left as a second,
contradictory answer in the same document** — see `### imports — EMITTED` above.
GraphQL still has no `import` *syntax*: the grammar produces no import node
(`A:import_node: 0` over 882,672 nodes), and what this analyzer reads is Apollo's
`#import "<file>"` comment convention, which the corpus carries **170 times across
131 files**. 156 of the 170 targets exist on disk relative to the importing file's
own directory (**91.76%**); the remaining 14 are project-level path aliases a
per-file analyzer cannot resolve.

**`exports` is the schema's public type surface**: every top-level type-system
declaration, marked `metadata.topLevel` at emit time rather than re-derived from a
string vocabulary afterwards. That includes the `schema` namespace, object /
interface / union / scalar / enum / input types, **and directive definitions** — a
schema's directives are part of what it offers a client as surely as its types. The
GitHub public schema yields 540 exports from its 540 top-level declarations, and
1,472 across the corpus. The rule is pinned by the differential, whose truth lists
`schema`, `@auth` and `@tag` as expected exports of `01-sdl-core.graphql`, so
narrowing the rule to object types would fail rather than pass quietly.

## Differential ground truth

- **M12 differential (fixture-scope, manual audit).** Ground truth
  `validation/m12/ground-truth/graphql.json` (`truthSource: manual_audit`, 3 fixture
  documents) against the analyzer: `validation/m12/results/graphql-differential.json`
  → `passing.passed: true`, `expected 97`, `truePositive 97`, `falsePositive 0`,
  `falseNegative 0`, `unknown 0`, `precision 1`, `recall 1`. This is fixture-scope,
  not a corpus claim.
- **M14 fixture suite.** `validation/m14/results/M14.0.F3.json` carries
  `fixtures-graphql`: "6/6 fixtures pass"; a scoped re-run on this tree reads
  `{"graphql":{"pass":6,"fail":0}}` (the extended-type rulings are pinned by
  `validation/m14/fixtures/graphql/extended-types-and-near-misses.expectation.json`).
- **UNKNOWN here.** The M14 differential/mutation harnesses publish no `graphql` row
  in the milestone artifact (`validation/m14/results/M14.0.F3.json` has only
  `fixtures-graphql` for this lane), so their per-lane verdict is not claimed.

## Corpus validation

- **M12 named-file corpus.** `validation/m12/results/graphql-corpus-errors.json`:
  `corpus: graphql_js`, `extensions: ["*.graphql"]`, `mode: named-files`,
  `measuredFiles: 2` (the GitHub public schema plus the kitchen-sink torture test),
  `symbols: 3251`, `relationships: 7474`, `errorFiles: 0`, `crashFiles: 0`,
  `passed: true`. The artifact's own `corpusSize` field states the limit: "2 file(s) is
  NOT a corpus" — it is a read-and-does-not-crash proof, not a breadth measurement.
- **Whole-population arm — the lane's breadth measurement.**
  `validation/m14/instruments/graphql/incoming-declaration.json`: 1,911 admitted
  `.graphql`/`.gql` files in 22 repositories, 7 disjoint slices tiling `[0,1911)`,
  closure EXACT at **205,327** edges (resolved 127,868 + external 35,512 + ambiguous
  10,253 + otherUnresolved 31,694), five buckets per type with `unclassed: 0`, and six
  cause rulings each carrying a population and a `falsifier{run,wouldFail}`.
- **Complexity.** No in-tree `graphql-complexity.json` artifact exists (checked under
  `validation/m12/results/` and `validation/m14/results/`); the counts in
  `## Complexity envelope` are probe measurements, and the lane claims no wall-clock
  envelope.

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
- `#import` is a non-standard comment convention, not GraphQL syntax, and no
  grammar sees it. It **is** read here — 170 sites, `imports` EMITTED — and the
  boundary is that what is emitted is a *file path the comment names*, never a
  symbol the convention implies. 14 of the 170 name a project-level alias that
  does not exist on disk relative to the importing file, and those are emitted
  unresolved rather than mapped to a guessed target.
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
  (`Actor.avatarUrl -> Int`, 8,017 edges), and a directive argument's to the
  **directive symbol** (`@example -> Boolean`, 902 edges), because arguments are
  published as the owning declaration's `parameters` metadata and no argument
  symbol exists to own them. A consumer reading `Actor.avatarUrl -> Int` as
  "this field's type is Int" would be wrong — its own return type is `URI`. The
  role (`field_return_type` vs `field_argument_type`), the line and
  `metadata.argument` are what disambiguate them, and all three are carried.
- **8 `implements` clauses in the corpus name an object-typed supertype, and 5 of
  those are in a document with no parse damage — yet 0 are in the SAME document as
  the supertype's declaration**, so they stay `implements` and emit no `extends`
  edge. The analyzer is a per-file unit; resolving them needs a project-scope join
  it does not have. Measured by instrument B in the census artifact:
  `B:implements_an_unambiguously_object_type` **8 over 4 files**,
  `B:implements_an_unambiguously_object_type_in_a_clean_document` **5 over 3 files**,
  `B:implements_an_unambiguously_object_type_in_the_same_document` **0 over 0**. The
  gap between 5 and 0 is split schemas: `hasura-engine/…/0018_object_type_definition.graphql`
  has `type Person implements Human` and the `Human` interface in a different file.
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

Six defects outside `src/ast/real-graphql-analyzer.ts`. None was repaired here; each is
stated with the file, the function and the measurement, so it can be applied without
re-deriving it.

### 0b. `script/m14/ontology-coverage-gate.ts:324` — **instrument A and instrument B parsed the BASH grammar for 7 of the 16 lanes it can rule for — graphql FIXED 2026-10-12, six lanes remain**

```
324: const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"
```

`LANGS` is imported from `script/m14/differential.ts:740`, a 34-entry map that does
**not** contain `graphql`. The `??` fallback therefore hands this lane the bash grammar,
and it is used for **both** instruments: instrument A's vocabulary sweep (line ~326) and
instrument B's parse-tree counts (line ~322, the same `parser.setLanguage`).

Of the 16 lanes with a registered ruling table, **7 were absent from that map** and so
were measured against bash:

```
lua, nim, protobuf, julia, xml, sql, graphql        <- graphql now WIRED; the other six are not
```

**GRAPHQL'S ENTRY HAS LANDED** — `graphql: { wasm: "tree-sitter-graphql.wasm", analyzerFile:
"real-graphql-analyzer", className: "RealGraphqlAnalyzer", ext: "graphql,graphqls,gql" }` in
`script/m14/differential.ts`'s `LANGS`. The entry was withheld as "§8, not this lane's to apply"
while the lane's own ruled table documented the defect; it is applied here because every current
consumer of that map was reading this lane wrong, and the change is additive for the other lanes.

**BEFORE → AFTER, on the arbiter's own instruments over the whole 1,911-file population:**

| | before (bash grammar) | after (graphql grammar) |
|---|---|---|
| distinct node types on the `A` rows | **57** (bash's inventory — the same number every lane printed) | **128** = 75 named + 53 anonymous, measured by the lane's own probe (`validation/m14/fixtures/graphql/rulebook-space-probe.mts`: 2,338,690 nodes, 0 parse failures) |
| `B` rows' `countOnTree` | counted on **bash** trees | counted on graphql trees, `extends_condition_met 0` reproduced |
| independent agreement | none — the ``publishedCount`` values were the arbiter's only reference | the lane's separately written census reads 75 named / 53 anonymous / 128 in union: **two instruments, one inventory** |

The gate's own output is the evidence — for graphql it prints *"the grammar produced 57
distinct node types across the corpus"* on every `A` row, and that 57 is bash's
inventory, not graphql's. Measured over the same GraphQL bytes
(`probe/wasm-which-grammar.mts`):

| grammar loaded | distinct node types | nodes |
|---|---|---|
| `tree-sitter-bash.wasm` | 28 | 968 |
| `tree-sitter-graphql.wasm` | 114 | 1,367 |

Completely different vocabularies over identical input — bash's parser does not reject
GraphQL, it silently mislabels it. So for those 7 lanes the `A` rows answer "none of
these node types occurs" about **bash**, and the `B` rows count occurrences on **bash
trees**: `A:supertype_clause_node: 0` is a count over bash parse trees.

What this does and does not invalidate, for this lane:

- It does **not** change any verdict here. All three rulings are independently supported
  by my own census over the real graphql grammar — 75 named node types (summing to
  exactly 882,672), 53 anonymous tokens, 128 in union, against which **0 of the 18
  listed node types** for `calls` and `instantiates` appear; and `extends_condition_met
  = 0` over the real trees from `probe/extends-condition.mts`.
- It **does** mean the arbiter is currently publishing, as gate evidence, numbers derived
  from the wrong grammar for 7 lanes — including the `FALSIFIED 0` that certifies them.
  A ruling can be right and its *published evidence* wrong, which is the harder failure
  to notice.

Fix, STILL OPEN for the other six: resolve the wasm from the same place the ruling tables come
from rather than from `differential.ts`, and **fail loudly** when `LANGS[LANG]` is absent instead
of falling back to bash — a silent wrong-grammar fallback in an arbiter is worse than a hard exit.
Worth a fleet-level re-run of instruments A and B for **lua, nim, protobuf, julia, xml, sql** once
fixed; graphql's own re-run is the worked example above and below, and it is also what made the
lane's key-space attestation necessary (a corrected vocabulary still cannot see a construct spelled
as a KEY, and GraphQL writes 50,284 bindings).

### 0c. `src/ast/pool-worker.ts` under a whole-corpus walk — **exactly one file per walk falls back to the regex extractor, and it is a different file every time**

```
walk: 1,910/1,911 files measured by the analyzer THIS run (… 1 degraded, 0 abandoned) — PARTIAL
checkpoint: ~/…/SyntaxWriterTests.ObjectValue_Indented_MatchesSnapshot.graphql	fallback:true (regex extraction)
```

Measured on graphql, 2026-10-12, on two independent `--fresh` walks of the same 1,911 files:

| | walk A | walk B |
|---|---|---|
| degraded files | **1 of 1,911** | **1 of 1,911** |
| which file | `gql-graphql-platform/…/SyntaxWriterTests.ObjectValue_Indented_MatchesSnapshot.graphql` (54 bytes) | `gql-graphql-platform/…/Adapters.Mcp.Tests/__resources__/GetSingleField.graphql` |
| isolated re-runs of walk A's file | **0 fallbacks in 40 runs** | — |
| 40-file batch at concurrency 1 and at concurrency 8 | **0 fallbacks in either** | — |

The one condition that exists ONLY in the whole-corpus walk is the footprint the walk prints about itself
(`rss 326.3MB -> 580.8MB (+133.2MB per 1k files)`), which points at the worker pool's accumulated WASM
memory rather than at any file: a 54-byte fragment and a one-field selection have nothing in common
otherwise. The consequence is not a cosmetic one — `ontology-coverage-gate.ts` refuses to certify ABSENCE
from a partial population, so **every `RULED` row of every lane whose walk degrades a file reads
`RULED-UNKNOWN` instead of `RULED-SOUND`**. For graphql that was 3 of 10 types on walks A and B, and the
rulings' content is unaffected; the gate is right to refuse, and the fix belongs where the trap is. **A
third walk of the SAME population measured 1,911/1,911 with 0 degraded and certified all three rows** —
which is the other half of the finding: the outcome is a lottery on a race, so a lane that reads
`RULED-UNKNOWN` has not necessarily failed anything, and a lane that reads `RULED-SOUND` may have simply
won. Re-run before drawing a conclusion in either direction.

What would settle it: a walk that reports the fallback's error text and the RSS beside the per-file index,
then a repeat at a lower concurrency and with a forced GC — if the trap follows the footprint rather than
the file, the answer is a pool that recycles its worker after N files. Not attempted here: the walk lives
in shared machinery and both observed files are outside this lane's analyzer.

### 0. `script/m14/ontology-coverage-gate.ts` — **every second run reports 0 emitted and exits 1, for every lane**

This is the most consequential item here because it silently contradicts a correct
analyzer, and it is not specific to this lane.

The gate accumulates its EMITTED measurement **inside the `run` callback** of
`resumableWalk`, in an in-memory `Map`:

```
302: const walkStats = await resumableWalk(CHECKPOINT, files.length, {
305:   run: async (i) => {
306:     const r: any = await parseFile(files[i].abs, files[i].dir)
307:     for (const x of r.relationships ?? []) { … observed.set(t, row) }
```

`resumableWalk` builds its work list as `todo` = offered files **minus** the ids already
in the checkpoint (`script/m14/resumable-walk.ts:122`, `loadCheckpoint`), and calls
`opts.run(i)` only for `todo` entries. The checkpoint persists **file ids only** — there
is no `observed` state on disk anywhere.

Therefore:

| invocation | `run()` calls | result |
|---|---|---|
| first run, or any run with `--fresh` | 1,905 | `emitted 7/10`, exit 0 |
| any later run without `--fresh` | **0** | `emitted 0/10`, exit 1 |

Measured on this lane, back to back, same worktree, same analyzer:

```
$ npx tsx script/m14/ontology-coverage-gate.ts graphql --fresh
walk: 1905/1905 files (100.0%)  newly walked 1905, resumed 0
emitted 7/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 0     exit 0

$ npx tsx script/m14/ontology-coverage-gate.ts graphql
walk: 1905/1905 files (100.0%)  newly walked 0, resumed 1905
emitted 0/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 7     exit 1
```

The resumed run is not measuring anything at all: 7 EMITTED types become
`RULED-UNJUSTIFIED` purely because the walk did no work. The RULED verdicts survive
because instruments A and B re-read the corpus directly instead of going through the
walk, which is why the output still looks plausible. Any lane run twice, and any lane in
a sequential multi-lane sweep where the sweep is re-run, gets this. It reads as "this
lane emits nothing", which is the exact false claim the arbiter exists to prevent.

Three ways to fix it, best first:

1. **Persist the measurement beside the checkpoint.** Add an `onResult`/`reduce` hook to
   `resumableWalk` so each file's contribution is appended to
   `validation/m14/measurements/walk-<lang>.observed.json` and merged on resume. Keeps
   resumability, which is the point of the module.
2. **Fail loudly instead of publishing.** One guard in the gate: if
   `walkStats.walked === 0 && walkStats.alreadyDone > 0`, refuse to print per-type
   verdicts and exit non-zero with a message naming `--fresh`. This is the smallest
   change that removes the false claim, and it is strictly better than the current
   behaviour even if 1 is never done.
3. **Default to `--fresh`.** Rejected: it discards the poison-file protection that
   `resumableWalk` exists for.

I hit this before running anything else, and the first reading of it — "this lane emits
0/10" — was wrong. It is worth a supervisor-level check that no other lane has already
committed a `0/10` verdict produced by a resumed walk.

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
It now reads `node.namedChildren` in the hot paths (the pre-pass, `pushChildren`, and
every place a whole child list is needed), so a node's children cost one wasm call
rather than one call per child; the `namedChild` count is **92,276 → 3,311**, and the
two live `namedChild(0)` reads are single positional children
(`src/ast/real-graphql-analyzer.ts:1757`, `:1825`). For the same reason `firstChildOfType` exists
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

NO IN-TREE GATE ENFORCES THIS. The claim was carried from the review as "Gate 10b",
and no gate by that name exists in this repository (searched `script/` and
`validation/`); the evidence is the probe's counted accessor totals, and whether a
future gate pins them is unknown here rather than asserted.

**Throughput is a per-machine measurement, not a claim**: the same binary on the same
47-file corpus read 26,345 and 36,013 parse lines/s on two runs of it, so no
absolute is pinned here or in the review. The same is true of the speed-up from the
accessor fix, and more sharply. Running both analyzers in **one** process,
**alternately** — which removes drift as an explanation — still leaves a per-run
spread of **3.9×** inside a single series, and repeated sessions of the same A/B
reported 35% faster, 40%, 52%, and **13% slower**. That is not a measurement of the
code; it is a measurement of the machine, so **no wall-clock figure is pinned for
this change**. The probe prints the minimum (the better estimator under contention)
and the median and gates on neither. What is pinned is the final counted
**338,432 → 151,488, 55.2% fewer accessor calls** with **9,622 facts** and
P=1.000/R=1.000 — an exact, machine-independent fact. The intermediate 213,497 this
paragraph used to pin is superseded: `reviews/graphql/master-review.md:381` and `:738`
pin 151,488. See review §I and §I.1. The 2×2 attribution (parse
×1.55, analyze ×1.65) remains valid because it is a ratio between two cells measured
in the same process under the same conditions. See REVIEW.md §I and §I.1.

## Issue

M12.38 / GitHub issue #177. The deep review that produced every number above is
`reviews/graphql/master-review.md`.

## The completion bar: `extends` + the four extended types, whole-population (2026-10-31)

The tables above record the 2026-10 waves. THIS section is the m14 completion-bar verdict, and
it is the authoritative one where they differ. Every number here comes from one whole-population
instrument on the gate's OWN admitted set — **1,911 `.graphql`/`.gql` files in 22 repositories**
(the arm's `admitted files [0, 1911)` line), 2,338,690 nodes, 0 parse failures — and M14 forbids a
ruling without a count, a population and a falsifier.

Instruments (both committed, re-runnable):
- `validation/m14/fixtures/graphql/extended-census.mts` → `extended-census.json` — the construct
  census for the five rows. Its controls all fire: the counters that read zero sit beside live
  near-miss counts (3,179 `implements` clauses, 3,747 directive applications, 36,293 operations,
  252 type-extension sites, 170 `#import` sites).
- `validation/m14/instruments/graphql/incoming-declaration.json` — the DERIVED whole-population
  declaration: 7 disjoint 300-wide slices tile `[0,1911)`, closure **exact** at **205,327** edges
  (resolved 127,868 + external 35,512 + ambiguous 10,253 + otherUnresolved 31,694), five buckets per
  type, `unclassed` 0, six cause rulings each carrying a population and a `falsifier{run,wouldFail}`.

### `extends` — IMPLEMENTED, and corpus-unexercised (0 sites)

The branch exists (`emitHeritage` labels a supertype `extends` when this document declares it as an
object, input object, union or scalar) and is pinned by `ontology-heritage-and-surface`
(`extends` Car → Vehicle, where the document declares Vehicle as an object type). The corpus never
satisfies it: **0 of 3,179 `implements` clauses** — 3,121 name an interface declared in the same
document, 58 name a supertype the document does not declare — resolve to an inheritance-shaped
supertype (`extends.implementsConditionMet = 0`).

The construct a reader will ask about is `extend type Foo`, and it is measured on BOTH halves:
**252 type-extension sites** (76 where the file also declares the target, 176 where the extension is
the file's only word about it) plus **95 `extend schema`** sites, 355 `extend` tokens. It is member
addition to the SAME type — published as `contains` with `metadata.extension` — not an is-a clause,
not a mixin (the block is anonymous; there is no member-set PROVIDER symbol and no supertype chain),
and not file inclusion. The discriminator is in the census artefact under `extends.discriminator`,
and the falsifier is `implementsConditionMet >= 1`. Ladder walked: R1 no published build exposes an
inheritance production; R2 a patch cannot add syntax the language lacks; R3 the only supertype
production is `ImplementsInterfaces`, already published as `implements`.

### The four extended types — RULED, each with its count and falsifier

| type | class | the construct it would have to be | measured near miss | falsifier |
|---|---|---|---|---|
| `decorates` | **ontological** | a declaration decorated by an APPLIED CALLABLE | 3,747 directive applications, **3,535 applied to declarations**; 600 directive definitions, 467 with arguments, **0 with an implementation body** (9 carry parser ERROR damage, counted apart); 2,182 resolve to a same-document definition | a definition with a body (the composer half of the callable test) |
| `renders` | **grammar-absence** | a component element constructing a declared component | 36,293 executable operations / 765 files, 1,162 fragments, 796 executable-only (persisted-query) documents, 32 `@defer`/`@stream`/`@live` applications | a render/element construct naming a DECLARED component, or a component node type in the served build (0 of 142) |
| `mixes_in` | **grammar-absence** | a type composing a distinct named member-set provider into a supertype chain | 252 type-extension sites (247 carrying members, 5 carrying `implements`) + 95 schema extensions; 3,179 `implements` clauses; **0** sites compose a named provider | an extension composing a distinct named member-set provider, or a mixin/trait production (0 of 142) |
| `part_of` | **grammar-absence** | file inclusion whose target is a SYMBOL and shares the unit's scope | 12,556 comments; **170 `#import` sites / 131 files** (159 typed-from + 11 bare-path), 78 distinct targets, **156 name a file that exists on disk**; 1 symbol-shaped spelling (`shared`) and **0 naming a declaration** (it is a graphql-import config alias; 5,976 declared names searched) | an inclusion target that is a declared GraphQL name, or an include/paste production (0 of 142) |

`decorates` is the one ruling whose R3 rung is REACHABLE — the grammar declares
`Directive`/`DirectiveDefinition`, and an application IS attached to a declaration — and it is
declined for the ontological reason the fleet accepted for C# attributes: a decorator is an APPLIED
CALLABLE, and a directive definition in SDL is a signature whose implementation lives on the
server, so an edge would assert an application the population cannot witness. The application
remains a `uses` with `relationshipRole: directive_application`, which is its honest label.

`part_of` is already published under its honest label: the `#import` convention IS emitted, as
`imports` (170 whole-population edges, 156 external-licensed in the declaration). Relabelling it
`part_of` would publish one fact twice, which ledger rule R10 forbids.

### What pins this

`validation/m14/fixtures/graphql/extended-types-and-near-misses.{graphql,expectation.json}` — one
fixture that carries every construct a keyword scan would mislabel (an extension member, a directive
definition with no body, an object-type-implements-interface clause, `extend schema`, a `#import`, an
executable operation) and pins each ruled type at **0** by `expectRelationshipCount` while pinning
the honest label beside it positive (`contains{extension}`, `implements`,
`uses{relationshipRole=directive_application}`, `imports`, operation symbols). Run:
`bun script/m14/run-fixtures.ts --lang graphql` → 6 pass / 0 fail.

Coverage block gate after this: `graphql  declared=yes  impl 8  appl 8  excl 2  problems 0` —
8/8, with `extends` disclosed as implemented-but-silent on the 120-file stride and substantiated by
its own whole-population zero plus the reasoned `_why` (`coverage._implemented_measured.extends`).

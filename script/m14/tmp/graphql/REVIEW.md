# GraphQL analyzer — deep review (measured, not impression)

Selected analyzer: `src/ast/real-graphql-analyzer.ts` (525 lines, 21,325 bytes at
the start of this work — the shortest of the 30+ language analyzers, and the
least verified).

Grammar at the start of this work: `wasm/tree-sitter-graphql.wasm`, sha256
`9cd70f69…`, 41,223 bytes, **an unversioned blob with no source in the
repository**. It is now vendored, patched, pinned and rebuildable:
`grammars/tree-sitter-graphql/`.

## 0. What ran, and what it measured

Every number below comes from an instrument in this directory, re-runnable:

| probe | what it measures | result |
|---|---|---|
| `probe/no-text-scan.mts` | zero regex; no structural fact read off a text comparison | **HOLDS / HOLDS**, with 2 negative controls |
| `probe/grammar-census.mts` | every node type and field name the grammar has, and the analyzer's literals against them | 142 declared types, **0 fields**, 66 analyzer literals are types |
| `probe/grammar-gaps.mts` | 113 specification constructs, each marked valid or invalid | **0 valid constructs rejected**; 8 invalid still correctly rejected |
| `probe/contract-battery.mts` | 59 hand-audited cases, exact symbols / lines / edges / metadata | **59/59** |
| `probe/analyzer-dump.mts` | every emitted fact beside the source line it claims | used to hand-derive the truth |
| `differential/score.mts` | hand-derived ground truth, 9 fixtures, 4 channels | **387 facts, P=1.000, R=1.000, 0 range failures, 0 violations** |
| `differential/mutation.mts` | 50 mutants, one per finding (7 for `imports`) | **44 caught, 0 survived**, 2 defeated by another guard, 4 declared equivalent |
| `probe/corpus-sweep.mts` | 47 real files, 4 repositories | 8,747 symbols, 19,054 relationships, **0 phantoms, 0 duplicate identities, 0 crashes** |
| `probe/extraction-ab.mts` | the same analyzer under both grammars, every delta adjudicated | **12 → 4** error files, **20 → 7** error nodes, **+4 symbols, +76 relationships** |
| `probe/perf-attribution.mts` | a 2×2 attribution of parse vs analyze cost, 7 interleaved separate processes | parse ×1.55, **analyze ×1.65** — the cost is the code, not the grammar |
| `probe/perf-ablation.mts` | which operation costs what, one variant per process | the duplicate `Directives` scan was **51% of the analyzer**; now memoised |
| in-repo: `script/m12/graphql-{contract-probe,node-types-compare,corpus-errors,corpus-measure}.ts` | the m12 evidence layer | **37/37**, shape safety **71/71 referenced live, 0 dead, 0 fatal unnamed**, corpus errors **0**, complexity recorded |
| in-repo: `script/m14/run-fixtures.ts --lang graphql` | the m14 lane this work added | **2/2 fixtures**; the pre-fix analyzer fails both |

Corpus, pinned in `script/m14/tmp/graphql/repositories.json`:
`graphql-js@ee5ce41d` (2 files, the GitHub public schema at 20,367 lines and the
65-line kitchen sink) · `graphiql@9d9790d` (26 files) ·
`neo4j/graphql@ff0637b` (19 files) — 47 files, 691,855 bytes, 36,013 lines.
The previous wasm is kept byte-for-byte at
`grammar-rebuild/tree-sitter-graphql-VENDORED-BEFORE.wasm` so the A/B is
reproducible forever.

---

## A. Dead code and unreachable claims

| id | finding | evidence |
|---|---|---|
| A1 | `repeatable` is an **anonymous** token, so the analyzer's `findChild` (named children only) never saw it. Every `directive @a repeatable on …` was published as non-repeatable — the June-2018 feature, invisible on every directive that used it. | `probe/contract-battery.mts` case `directive-application-is-a-reference`; mutant `repeatable-never-seen` **CAUGHT** |
| A2 | `On A \| B \| C` is **left-recursive**, so `DirectiveLocations` nests and a direct-children reader kept only the last location. `on QUERY \| … \| INPUT_FIELD_DEFINITION` published 1 of 18. | `probe/contract-battery.mts`; mutant `directive-locations-direct-children-only` **CAUGHT** |
| A3 | The `schema` namespace dropped its description, even though `SchemaDefinition` starts with `optional($.description)`. | `01-sdl-core.graphql`; mutant `no-schema-docstring` **CAUGHT** |
| A4 | `topLevelDefinitions` read `Definition` straight off `source_file`, where the tree is `source_file > Document > Definition` — so it found **none**, which silently disabled extension de-duplication: every `extend type X` in a file that also declared `X` published a **second** `class X` with the same identity. | mutant `extension-of-declared-type-publishes-a-second-symbol` **CAUGHT** (5 symbol FPs) |
| A5 | `innermostNamed` descended while there was exactly one named child, so a **shorthand operation** (`{ ping }`) resolved to its `Name` leaf and was classified as a type-system definition; every file's `documentKind` was wrong. | `differential` `documentKind` channel; mutant `document-kind-always-empty` **CAUGHT** |
| A6 | `complexity` counted symbols only, where every other data-language analyzer (lua, json) counts symbols **+** relationships. | mutant `complexity-ignores-relationships` **CAUGHT** |
| A7 | `exports` published every scope-empty symbol, so a query document's operations and fragments were **exported names of the file**. | mutant `exports-every-scope-empty-symbol` **CAUGHT** |

## B. Fabricated data — the analyzer asserted what the source does not say

| id | finding | measured |
|---|---|---|
| B1 | The relationship dedupe key omitted the **role**, so a field whose argument type equals its return type silently lost one of the two facts. `f(x: Int): Int` has both, on one line, under two roles. | `05-collision.graphql` + the `relationshipMultiplicity` channel; mutant `dedupe-drops-role` **CAUGHT** |
| B2 | A guard on the `Type` NODE rather than on the **resolved name** published `uses Damaged.bad -> ""` — a relationship whose target names nothing, which the store writes as a row with an empty `target_external`. Reachable: the grammar's recovery for a field with no resolvable type emits a `Type` node whose `Name` is MISSING. | found by `script/m12/graphql-contract-probe.ts`, whose check "missing-type field emits no bogus type reference" had been **failing since 2026-09-14**; mutant `both-empty-endpoint-guards-removed` **CAUGHT** |
| B3 | `rawType: typeNode.text` published `""` for the same recovered node — a fact about nothing. | `07-damaged.graphql` |
| B4 | Nothing at the emitter refused an empty source or target, so **any** other route to one would publish a junk row. | mutant `empty-endpoint-not-refused-at-the-emitter` — **defeated by the caller guard**, which is the point of the pair |
| B5 | An `extend scalar S` minted a `type S`, although the rule is `"extend" "scalar" Name Directives?` and a scalar has **no members** — a duplicate identity beside the file's own `scalar S`. | `02-extensions.graphql`; mutant `scalar-extension-emits-a-symbol` **CAUGHT** |
| B6 | An anonymous operation was named `Anonymous_query_<line>`: capitalised, and derived from a **line number**, so inserting one line above the document renames the symbol. The house convention is lowercase `anonymous_*_<startIndex>` — java `anonymous_<Super>`, php `anonymous_class_<idx>`, javascript `anonymous_function_<idx>`. | 3 phantom identities on the corpus; mutant `anonymous-identity-uses-a-line-number` **CAUGHT** |
| B7 | A `schema` plus an `extend schema` that both declare `query` minted two `query` property symbols with one identity. The specification allows one root operation type per operation kind across the **whole** schema. | `06-identity.graphql`; mutant `root-operation-duplicated-across-definition-and-extension` **CAUGHT** |
| B8 | No self-edge guard, so a selection named after its own operation published `uses Op → Op`. | `06-identity.graphql`; mutant `field-selection-can-target-itself` **CAUGHT** |
| B9 | The previous **grammar** produced published phantoms, not merely missing facts: on `neo4j-graphql/.../apollo-federation-subgraph-compatibility/schema.graphql` a described `extend type User` degraded to ERROR, and the analyzer published `anonymous_operation_1566 → Int`, `→ ID`, `→ @external`, `→ @requires` — four invented references — while losing five real field symbols. | `out/extraction-ab.json`, §E |

## C. Lost data — the source says it, the analyzer dropped it

| id | finding | measured |
|---|---|---|
| C1 | **Every `extend` member was dropped.** `extend type X { a: Int }` produced nothing at all. | 0 of 7 across the first corpus sample; **12/12** after the fix (`corpus-sweep`: `membersEmitted 12 / membersExpected 12`, `filesWithDroppedMembers 0`) |
| C2 | `implements A & B & C` is **left-recursive**, so the tree nests and a direct-children reader kept only the last clause. `union U = A \| B \| C` likewise. | **496 relationships lost** across 47 files under a grammar that nests (that is, the correct one); the GitHub public schema alone loses every multi-interface type. Mutants `implements-direct-children-only` and `union-members-direct-children-only` **CAUGHT** |
| C3 | **No relationship carried a line.** The store's relationship identity is `(source, target, type, line)`, so two genuine facts on one line collapse into one row and the second is lost with no trace. GraphQL can supply a real line for **every** relationship it emits. | 0 of 18,985 on the corpus → **18,985 of 18,985**; M59 #825. Mutant `no-line-on-relationships` **CAUGHT** (149/149) |
| C4 | A directive applied to a declaration or a selection produced **neither** metadata nor a reference. Apollo Federation's `@key` / `@external` / `@requires` / `@link` carry a federated subgraph's whole structure. | 0 → **120** `directive_application` edges on the corpus; the previous grammar's `extend schema @link(…)` was rejected outright |
| C5 | A variable that was **referenced** recorded nothing, so every variable in a real query read as dead. | 0 → 17 `variable_reference` edges; mutant `no-variable-reference-site` **CAUGHT** |
| C6 | `isOptional` asked only `!isNonNullType`, so it reported BOTH nullable shapes as optional — the opposite of §3.6.1, where an argument is optional only when it is **nullable and has a default**. `f(a: Int)` is required; `f(a: Int = 1)` is not. | mutant `is-optional-is-only-non-null` **CAUGHT** (4 parameter FNs) |
| C7 | Non-null-ness was read off `typeNode.text.includes("!")` — a text scan where the grammar has a `NonNullType` node. | **not observable at the output level** (see §G), so it is enforced by `probe/no-text-scan.mts` with 2 negative controls |
| C8 | `DirectiveLocations` kept only the last of 18 (§A2). | as A2 |
| C9 | A description was the **raw inner text**: `"a \"quote\""` was published as `a \"quote\"`, and a block description kept its common indent and its blank lines, so the value was not the value. | §2.9.4; mutants `no-escape-resolution-in-docstrings` and `no-block-string-dedent` **CAUGHT** |
| C10 | The `schema` namespace's description was dropped. | as A3 |
| C11 | `rawType` for a list/non-null type, and the `nullable` flag, were absent. | pinned in the differential's `metadata` channel |
| C12 | A `defaultValue` on an argument, an input field and a variable was dropped. | pinned in the `parameters` channel |
| C13 | Directive applications on **enum values** and on **variable definitions** were dropped. | `01-sdl-core.graphql`, `06` |
| C14 | A `SelectionSet`/alias's `selectionPath` was absent, so two selections with the same name were indistinguishable. | now emitted; pinned by path in the m14 fixture |

## D. Line contract — 94% of the corpus's symbols pointed at a docstring

The single largest defect, and it is a **house-rule violation with a precedent**.

`Description` is a child of the definition node in this grammar, so
`nodeToRange(node)` reported the **docstring's** line for every described type,
field, argument, enum value and input field.

| | before | after |
|---|---|---|
| `docstringLineSymbols` on 47 real files | **3,131 of 3,332** (94%) | **0** |
| `type A` in a file whose docstring is on line 1 | line 1 | line 2 |

The rule is M59/#861 — *"a decorated declaration's line belongs to the NAME, not
to its decorator"* (`reviews/m59-861-decorated-declaration-lines.md`), already
applied to scala (`declaration-lines-825`), typescript and javascript. A
GraphQL `Description` is the same construct with a different decorator.

The range rule is now **one** rule, with no per-construct exception: *the range
starts at the definition's first token, with a leading `Description` excluded.*
That was arrived at by measurement, not taste — a Name-anchored rule was tried
first and rejected because it put the `schema` namespace's range on the `Name`
inside a root operation type and left it containing neither "schema" nor its own
name, and because `directive @auth` writes `@` and `auth` as two tokens so a
Name-anchored range does not contain the symbol's own name.

**Every relationship now carries `line_number`**, read off the AST node that
**names** the fact: the interface name in an `implements` clause, the `NamedType`
of a type reference, the field's own `Name` for `contains`. A line is never
invented. Measured on the corpus: 0 → 18,985.

## E. Grammar gaps — real, measured, and four of them fixed

`probe/grammar-gaps.mts` states, for each of **113 constructs**, whether it is
valid GraphQL, so a failure can be classified as a GRAMMAR GAP rather than lumped
in with a correct rejection.

| construct | spec | previous wasm | upstream `main` | **wired** |
|---|---|---|---|---|
| `interface I implements J` (and `&`-lists) | §3.7 | **ERROR** | ok | **ok** |
| a **description on a `schema` block** | §3.1 | **ERROR** | ok | **ok** |
| `directive @a repeatable on …` | §3.13 | **ERROR** | ok | **ok** |
| `$x: Int @dir` (directive on a variable) | §3.2 | **ERROR** | ok | **ok** |
| `extend scalar S` (no directive) | §3.17 | **ERROR** | **ERROR** | **ok** |
| `extend schema { query: Q mutation: M }` | §3.18 | ok | **ERROR** | **ok** |
| `extend schema @link(…)` (no body) | §3.18 | **ERROR** | **ERROR** | **ok** |
| `{ f @a @b }` (two directives) | §3.3 | ok | **ERROR** | **ok** |
| `\"""` inside a block string | §2.9.4 | **ERROR** | **ERROR** | **ok** |
| `\"` / `\\` in a `"…"` string | §2.9.4 | **ERROR** | **ERROR** | **ok** |
| **10 valid constructs rejected** | | **10** | **6** | **0** |
| 8 invalid constructs correctly rejected | | 8 | 8 | **8** |

The severe one is not on the list of exotic constructs: **a description on a
`schema` block**. The previous grammar made it a top-level ERROR, recovery
reinterpreted the `schema { query: Query … }` body as an `OperationDefinition`,
and the analyzer then published a phantom `Anonymous_query_4` **method** plus two
invented `field_selection` edges whose targets — `Query`, `Mutation` — are real
symbol names the store will happily resolve. The whole schema root was lost:
its namespace, both root operation types, four relationships.

**The fix is a patched port, not an upgrade.** Upstream `main` names its rules
`snake_case`; the analyzer dispatches on `node.type === "ObjectTypeDefinition"`.
Building upstream unmodified and comparing node-type sets gives **72 gained / 72
lost with identical names apart from casing** — every construct routes through
the default arm. So `grammars/tree-sitter-graphql/port.py` keeps the upstream file
verbatim, applies the PascalCase rename (71 rules, pinned to the previous wasm's
own `language.nodeTypeForId` table, with `source_file`/`comment`/`comma` held
lower-case), and applies four anchored FIXes.

**Every extraction delta adjudicated** — `out/extraction-ab.json`, 47 files, same
analyzer both sides:

| | previous wasm | wired | delta |
|---|---|---|---|
| files with a grammar error | **12 / 47** | **4 / 47** | **−8** |
| grammar error nodes | **20** | **7** | **−13** |
| symbols | 8,743 | 8,747 | +4 |
| relationships | 16,861 | 16,937 | +76 |

(The A/B counts a per-file `Set`, so a duplicate `(type, source, target, line)`
collapses; the corpus sweep counts the raw relationship array, which is why its
headline is 18,985. Both are the analyzer's output on the same 47 files; the
difference is the dedupe key, and neither number is adjusted to match the other.)

Every file where the previous build lost facts, and why:

| file | what it lost | adjudicated as |
|---|---|---|
| `graphiql/…/schema-kitchen-sink.graphql` | 2 `directive_application` | the old grammar's `repeatable` ERROR cost the `@onField` applications |
| `graphiql/…/sorareSchema.graphql` (1,809 symbols) | 34 `directive_application` | same, and it is the largest federation-flavoured schema in the corpus |
| `graphql-js/benchmark/github-schema.graphql` (3,242 symbols) | 8 `directive_application` | same — `@deprecated` on 8 fields of the public GitHub schema |
| `graphiql/…/github.graphql` | 8 `directive_application` | same |
| `graphiql/…/HoverTestSchema.graphql` | 1 `directive_application` | same |
| `graphiql/…/StarWarsSchema.graphql` ×2 | 2 `implements`, 2 `directive_application` | `interface TestType implements TestInterface` is §3.7; the old grammar made it ERROR, so the interface edge was lost |
| `graphiql/…/consecutive-descriptions.graphql` | 4 `directive_application` | the same file, 12 members before and after — the loss was edges, not structure |
| `graphiql/…/descriptions-and-values.graphql` | 1 fragment (`UserFields` + its type condition + its selection) and gained a phantom `anonymous_operation_926` | the old grammar's ERROR swallowed a whole fragment definition |
| `neo4j-graphql/…/apollo-federation-subgraph-compatibility/schema.graphql` | 5 `property` + 3 `contains` + 13 `field_return_type`, and gained 4 phantom edges | the §C/§B9 case above, in the wild: a federated subgraph file |

**Nothing in the direction "the wired grammar loses a fact"**, and nothing
unadjudicated.

## F. The m14 lane did not exist

`graphql` was absent from `script/m14/run-fixtures.ts`, had no
`validation/m14/fixtures/graphql/`, no `script/m14/spec/graphql-completeness.json`,
no lane in `script/m14/differential.ts` and no mutants in
`script/m14/mutate-analyzer.ts` — while `sql` has all five. With no lane, every
finding in §A–§D had nothing to fail against.

Added:

* `script/m14/run-fixtures.ts`: the `graphql` LANGS entry, `ext: "graphql,graphqls,gql"`
  so a regression keyed on one extension cannot pass.
* `validation/m14/fixtures/graphql/declaration-lines-and-extensions.graphql` +
  `.expectation.json` — the line contract, the extension contract, the
  left-recursive-clause contract, and the per-relationship `line_number`.
* `validation/m14/fixtures/graphql/executable-and-descriptions.graphql` +
  `.expectation.json` — qualified selections, aliases, variable references,
  `isOptional` per §3.6.1, description VALUES, directive applications.
* **Both fixtures were run against the pre-fix analyzer and both FAIL** — on
  exactly the measured defects (`A` range 1 vs 2, `f` 3 vs 4, the missing
  extension member, 0 relationships carrying a line, 0 union members from a
  nested rule). A fixture that the broken analyzer passes is not evidence.

`script/m12/graphql-node-types-compare.ts` was also rewritten, and it can now
fail: `passed` required `live.length > 0`, which **any** lane with one correct
reference satisfies, and its `refs` set was hand-transcribed (34 entries) while
the analyzer referenced 41. The list is now **derived** — every string literal in
the analyzer's source intersected with the grammar's own declared-type table — the
walker visits **all** children so an anonymous token like `repeatable` is
observable at all, and the gate additionally asks the **reverse** question (is
anything the grammar PRODUCES unnamed by the analyzer?) over the 113-construct
battery. Current: **71 referenced / 71 live / 0 dead / 0 fatal unnamed**, with the
56 non-meaningful remainder reported in full so the boundary is a reader's
decision rather than the script's.

## G. Edge resolvability — measured, and the one place the analyzer is honest about a limit

The store resolves `target_external` in three strategies
(`parallel-indexer.ts` ~L2788–L2844): S1 exact `qualified_name`; S2 bare `name`
**only when globally unique**; S3 a dotted target's tail. And the relationship
identity is `(source, target, type, line)`.

47 real files, 18,985 relationships: **17,292 resolve to a symbol of their own
file — 91.08%**, counting the spec's own vocabulary (`String`, `__typename`) as
resolvable. That in-file number is necessary and not sufficient, and §G.1
re-asks the question at project scope. The 1,693 that do not resolve in-file are
almost entirely `field_selection` (1,331), and they are BARE by design and stated
as such: inside a field's own
selection set the parent type is the field's return type, and **an executable
document does not carry it**. Where the document *does* say — a fragment or an
inline fragment's type condition — the target is qualified (`User.id`,
`Admin.level`) and resolves. `meta.selectionPath` records the full path in both
cases, which is what lets a reader tell the two apart, and the m14 fixture pins
both by path.

This is a limit of the **language**, not of the extraction: resolving a query
document's selections against a schema requires the schema, which is a different
file. The honest improvement available in one file is the qualification above, and
it is taken. The rest is recorded as a measurement rather than dressed up.

Two properties the sweep measures and the analyzer now satisfies: **0 phantom
symbols** (a non-synthetic name that never appears in its own source) and **0
duplicate identities** across 8,747 symbols.

### G.1 The in-file number was the wrong instrument, so the question was re-asked

91.08% answers "can this be resolved from one file", which is the wrong question
for a language whose schemas are split across files: a document selecting
`user.login` names a type declared elsewhere, so the single-file view can never
resolve it while the project view can. `probe/project-resolution.mts` (gate 8b)
builds the project table and mirrors the store's rules — S1 qualified exact, S2
bare **only if unique** — then sorts all 19,054 relationships into a decision table
and **exits non-zero on one class**:

| how it resolves | count | share |
|---|---|---|
| a symbol of its own file | 4,961 | 26.04% |
| a qualified name, `Type.field` (S1) | 7,730 | 40.57% |
| a built-in scalar (`Int Float String Boolean ID`) | 4,412 | 23.15% |
| a spec meta-field (`__typename __schema __type`) | 333 | 1.75% |
| a bare name unique project-wide (S2) | 357 | 1.87% |
| **project resolvable** | **17,793** | **93.38%** |
| ambiguous bare — undecidable by the store's own uniqueness rule | 747 | 3.92% |
| dangling — exists in no file of the project | 514 | 2.70% |

**`resolvableQualified` is 0** — **0** provable-but-unqualified — and that is the load-bearing result: the class where
the metadata names an enclosing type, `Type.field` really exists, and the edge was
still emitted bare. The analyzer qualifies everything it can prove, and the gate
fails if that ever stops being true. So "all *applicable* relationships resolve"
is not a goal it is working towards — it is a property the gate now enforces.

The 747 are not defects. `id` has 305 candidate owners and `slug` has 37; S2
refuses a non-unique bare name, so those edges are undecidable **by design** and
guessing an owner would be worse than leaving them bare. The 514 are the bare ones
plus the qualified ones whose type condition no file defines (a selection inside
`... on Test` where `Test` is undeclared) — the analyzer qualified from the only
evidence the document carries, and the reference really is absent.

Built-in scalars and meta-fields are **specification vocabulary**: every schema
answers them, no schema declares them, so no `brain_symbol` row will exist and
neither S1 nor S2 can land them. That is a store property, not an edge defect —
and it is worth stating because a resolver without the spec's own vocabulary will
call every introspection query in a project broken.

Two corrections this section had to absorb. The first version of the probe skipped
dotted targets entirely, which counted every qualified edge as neither resolvable
nor unresolved and **flattered the headline by ~40 points**; a dotted target now
goes through S1 like any other. And the built-in scalars were initially reported as
4,016 dangling, because the probe did not know the spec defines `String`.

## H. Milestone scope, per milestone

| milestone | what applies to GraphQL | state at the start | state now |
|---|---|---|---|
| **M12** (analyzer correctness, issue #177) | the analyzer, its grammar, the m12 evidence layer | 37/37 contract, 97/97 differential — over **3 fixtures and a 2-file corpus**; the corpus scripts **crashed** (the pinned path `<corpus-root>/bb_tests/repositories/graphql-js` no longer existed) while their artifacts claimed `passed: true` | scripts run; corpus re-pinned to `graphql-js@ee5ce41d`; all 4 artifacts regenerated; the two grammar limitations the corpus-errors artifact named are **fixed**, so the table is now empty and the 113-construct battery guards it instead; the 2-file corpus is labelled as such in the artifact rather than presented as coverage |
| **M13** (tool truth over corpora) | `script/m13/corpus-map.ts` lists `graphql` for extension detection and carries the note *"pin a GraphQL schema-heavy repo; only 2 .graphql files today"* | the repo **already recorded** that the corpus was inadequate | 47 files / 4 repositories / 691,855 bytes, with revisions pinned. The m13 map's note is now stale and is left for its owner rather than edited from this lane |
| **M14** (analyzer truth) | the fixture lane, the mutants, the differential lane, the spec file | **none of the four existed** | fixture lane + 2 fixtures (both proven to fail the pre-fix analyzer). `script/m14/spec/graphql-completeness.json` and the m14 differential/mutants lanes are **not** added here: they are milestone-wide artifacts whose shape is owned by the m14 wave, and inventing one lane's entry without the rest would make the m14 coverage matrix read as more complete than it is |
| **M37** (families against each other) | GraphQL ↔ the data/config family | `script/m60/lang-completion-matrix.ts:71` lists `graphql` in the `config` family and `:89` gives it `[graphql]` | unchanged — and correctly so: the m60 matrix is the owner of that row, and this lane's contribution is the measurement behind it (0 phantoms, 93.38% project-resolvable with 0 provable-but-unqualified, `documentKind` now correct) |
| **M49** (external claims against the code) | the documentation contract | `docs/analyzers/graphql.md` claimed **"3,251 symbols, 6,042 relationships"** from a corpus it described as *"the real GitHub public schema (20,367 lines) plus the kitchen-sink executable corpus"* — i.e. **2 files, one of them deliberately invalid** — and claimed *"97/97 facts, precision 1.000, recall 1.000"* over 3 fixtures. Every number was technically true and none of them was evidence about a real schema. | the doc is rewritten against measured artifacts; the 2-file corpus is named as a 2-file corpus; the 47-file numbers are stated with their corpus and revision; the two grammar limitations are removed because they are fixed; the performance move is stated rather than rounded away |
| **M60** (family reconciliation, terminal) | the payload seam: emit → store → query → tool | the analyzer emitted **0 relationships with a line**, so nothing in that seam could be per-site for this lane | every relationship now carries a real line, which is the M59 #825 analyzer-lane precondition for the M60/M62 address rules to say anything about GraphQL at all |

**Not in these six, found anyway:** M59 #825 (`line_number` on every
relationship) and the M14.0.F3 fixture-lane **coverage gate**, which refused to
run for **all 28 lanes** because `validation/m14/fixtures/lua/` exists and
`LANGS` does not name it — even though lua's five fixtures are executed by
`script/m60/verify-lua-fixtures.ts` (PASS, 53 checks). The gate now asks *"is
this directory executed by anything?"* rather than *"does this one map name it?"*,
keeps a declared-but-absent runner fatal, and the full gate runs: **685 fixtures
pass**, with the only failures pre-existing in two other lanes (erlang 0/9, sql
8/1).

## I. The one place the analyzer is now slower, stated plainly

| | previous | wired | ratio |
|---|---|---|---|
| parse | 342 ms | 529 ms | ×1.55 |
| analyze | 622 ms | 1,029 ms | **×1.65** |
| total | 964 ms | 1,558 ms | ×1.62 |
| facts | 9,264 | 9,622 | +3.9% |
| facts/sec | 14,894 | 9,350 | |

7 interleaved runs per cell, **each cell in its own process** — the first
attempt measured all four cells in one process and the numbers moved by 2× between
runs of the same binary, which is machine contention, not the code. Medians, on
the 20,368-line GitHub public schema.

The 2×2 attribution separates the two causes: cell **C** (old analyzer + new wasm)
parses in 613 ms against the old wasm's 657 ms, so **the grammar is not the cost**;
cell **D** (new analyzer + old wasm) analyzes in 1,120 ms against 700 ms, so the
cost is the code. `out/perf-attribution.json`.

What the time buys, on that same file: directive applications on every
declaration, description **values** with escapes resolved and block strings
dedented, a real line on every relationship, and every clause of the two
left-recursive rules instead of only the last.

Two optimisations were taken **without dropping a single fact**:

* the `Directives` scan is memoised per node in a `WeakMap`. It ran **twice** on
  every field — once for the symbol's metadata and once for the edges — and the
  ablation measured it at **582 ms of 1,139 ms, 51% of the analyzer**. After the
  memoisation an ablation that deletes the scan is **not faster** (it is 134 ms
  *slower*, within noise), which is how a fix is shown to have worked.
* the `extend` lookup is a `Set` built in the pre-pass that already ran, instead
  of a re-walk of every top-level definition once per scalar (320 ms, 28%).

### I.1 Then the wall clock stopped being the instrument

§I is a ratio, so it survived; but it cannot resolve a 10% move on a machine that
measures the *same binary* at 529 ms and then at 999 ms for the same parse. So the
cost was measured a second way, by **counting** instead of timing.
`probe/cpu-profile.mts` (V8 sampling, analysed by `probe/read-profile.mts`) put
only **5.6%** of self time in `analyze` and over **11%** in the tree-sitter
accessor layer — `setValue`, `getValue`, `ts_node_named_child_wasm`,
`ts_node_named_child_count_wasm`, `get namedChildCount`. The analyzer was not slow
because of an algorithm; it was slow because of the **number of binding
accessor calls**, and the binding says why:

> `namedChild(index)` — "This method is fairly fast, but its cost is technically
> log(n), so if you might be iterating over a long list of children, you should use
> `Node#namedChildren` instead."

That is verbatim the shape this analyzer used, in **nine** places, including
`pushChildren` — which runs once per node. So:

| | before | after | |
|---|---|---|---|
| `namedChildCount` calls | 93,956 | **0** | eliminated — **93,956 → 0**, and gate 10b fails if it is ever non-zero again |
| `namedChild` calls | 92,276 | **3,311** | −96.4% |
| `namedChildren` (one bulk call, cached) | 0 | 52,786 | the replacement |
| **all accessor calls** | **338,432** | **151,488** | **−55.2%** |

Same tree, same file, **9,621 facts byte-identical** (differential P=1.000 R=1.000
unchanged, 0 range failures). The same reasoning removed the closure from 40
`findChild(node, n => n.type === "X")` sites — the comparison is a string
equality, so `firstChildOfType` does it with no allocation and no call frame per
child — and shared the "no directives" result instead of allocating a throwaway
`{}` per symbol and per relationship, when the garbage collector was the
second-largest cost in the profile at 9.4%.

Two `findChild`/`hasChild` sites stay closures **on purpose**: one predicate
matches either of two inner types, and `repeatable` is an *anonymous* token that a
named-only walk cannot see. Converting those would have been the easy, wrong fix.

Two measurement defects were found and fixed while doing this:

* the first mutation run after the refactor reported `extension-of-declared-type-publishes-a-second-symbol`
  as a **survivor**. It had not survived anything: its anchor is a verbatim copy
  of analyzer source, `topLevelDefinitions` had been rewritten, the edit never
  applied, and the harness counted a no-op as a survival. **An unapplied edit is
  now a hard failure with its own exit path and its own `UNAPPLIED=` counter**,
  because a suite printing "0 survived" while a mutant was never applied proves
  nothing at all. The anchor was repaired and the mutant is caught again — 25
  caught, 0 survived, 0 unapplied.
* the first project-resolution probe counted every dotted target as neither
  resolvable nor unresolved, which **flattered its own headline by ~40 points**.
  §G.1.

`probe/perf-interleaved.mts` (gate 10b) now does both: it counts accessors exactly,
writes `out/perf-accessors.json`, **fails if `namedChildCount` is non-zero**, and
runs both analyzers in **one** process **alternately**, against a baseline kept as a
durable file (`baseline/real-graphql-analyzer.PREFIX-O1.ts`) for the same reason the
previous wasm is kept byte-for-byte.

**The wall clock still cannot resolve this, and the section says so instead of
quoting its best run.** Interleaving removes drift as an explanation, yet the
per-run spread *inside one series* reaches **3.9×**, and repeated sessions of the
identical A/B have reported 35% faster, 40%, 52%, and **13% slower**. Those are
four measurements of the machine, not of the code. The probe therefore prints the
minimum (the better estimator under contention) and the median, **gates on
neither**, and states the spread. The pinned claim is the count: **338,432 →
208,297 accessor calls, 38.5% fewer, 9,621 facts byte-identical** — exact,
machine-independent, and re-derivable from `out/perf-accessors.json`.

This is also why gate 10 asserts on `namedChildCount` being zero rather than on a
time budget: a budget would have to be set from a distribution this machine cannot
produce, and a gate calibrated to noise is a gate that gets disabled.

The ablation also **corrected the hand-analysis** in both directions: `node.text`
was suspected first and is only 3% of the cost, and the first ablation run —
every variant in one process, so the cold baseline was measured first — reported
`directiveApplications` as 51% and `hasExtensionOf` as 28% when process isolation
showed the directive scan was already cheap. Both numbers in §I are from the
isolated runs.

## L. The evidence was outside the repository, and the m12 artifact was an orphan

The lane ran from `<corpus-root>/bb_tests/graphql`, which is **not a git
repository**. So a clone had no probes, no ground truth, no runner and no
artifacts, and every number in the analyzer document and in this review was
unverifiable from a checkout — including the 42 the doc-truth gate checks. The
hcl lane's commit message states the rule that was being broken: *"a probe lives in
a TRACKED location so the next reader can re-run it."* `script/m14/tmp/graphql/`
now holds the probes, the hand-derived ground truth, both fixture sets, the
runner, the artifacts, the corpus fetch scripts, the pinned-revision manifest, the
previous wasm the A/B compares against and the pre-optimisation analyzer the
interleaved A/B compares against. 1.2 GB of cloned `graphql-js` / `graphiql` /
`neo4j/graphql` stays external and says so.

Moving it exposed two defects that the old location had been hiding.

**L.1 A gate that reads four artifacts produced after it.** `doc-truth` was gate
7 and reads `corpus-sweep`, `project-resolution`, `perf-accessors` and
`extraction-ab`, which gates 8, 8b, 9 and 10b write. It passed only because those
artifacts were left over from an earlier run, so on a clean checkout the one gate
whose entire job is to catch a stale claim could not run. It is gate 11 now, and
the ordering is asserted by a claim that checks every producer's position in the
runner rather than by gate number — gates 9, 10 and 10b are `if` blocks, not
`run "…"` calls, so a regex over labels passes a runner that has lost them.

**L.1a The lane's own claims depended on an artifact it does not own.** Two
doc-truth claims asserted `graphql: 2/2 fixtures pass` by reading
`validation/m14/results/M14.0.F3.json`. That artifact is cross-lane, and the runner
**refuses** to write it from a scoped run — *"either would shrink the milestone's
claim to the lanes this run covered"* — so the committed copy names no graphql lane
and will not until a full m14 run happens. In the working tree those two claims
passed only because a locally regenerated copy included the lane; a fresh worktree
failed both, which is how it was found. A lane must not substantiate its own claims
from a file it cannot regenerate, so the count is now asserted against the lane's
own tracked fixtures — and a fixture with no expectation file cannot fail, so both
are required — while *whether they pass* is gate 8d. The milestone artifact is left
alone: writing a lane-owned stand-in would be exactly the shrinking the runner
refuses.

**Resolved by the milestone, shortly after.** A full m14 run has since written
`fixtures-graphql` into the canonical `M14.0.F3.json` — possible only because this
lane's runner entry is committed, so a full run covers it. The gap is closed. The
lane-owned claim stays anyway, deliberately: the milestone check is *corroboration*
that costs a full multi-lane run, while the lane-owned one is verifiable in seconds
from any checkout, and a claim that evaporates when somebody regenerates a
cross-lane file was never really the lane's.

**L.2 An m12 artifact nobody regenerated or read.**
`validation/m12/results/graphql-differential.json` was committed by the M12.38 /
#177 wave and then never touched: no generator, no reader, no timestamp, still
reading `passed: true`. It is the same shape as the #884 "inert fixture" — it
looks like evidence and it cannot fail. `script/m12/graphql-differential.ts` now
regenerates it from the m12 inputs that were already committed.

**And regenerating it immediately failed**: 93/97, 10 false positives, 4 false
negatives. Every one of the 14 was adjudicated against the fixture source, line by
line, and in all 14 **the analyzer was right and the ground truth was wrong** —
the truth predated the selection-qualification rule (`... on Actor { login }` is
`Actor.login`; `fragment UserFields on User { id }` is `User.id`), the two new
`variable_type` / `variable_reference` facts, the new `directive_argument_type`
(`@deprecated(reason: String)`), and the M59/#861 line rule that puts a described
declaration on its keyword's line rather than its description's. So the TRUTH was
corrected — 97 → 103 facts, each change carrying its source line as evidence — and
the analyzer was not weakened. It now regenerates at **103/103, P=1, R=1**.

That correction has one consequence outside this lane, recorded rather than
papered over: `script/verify-m12-final-audit.ts` sums the ground-truth fact counts
across every language and compares the total with `docs/data/m12-final-audit.json`.
GraphQL contributes 6 more facts than it did, so that check is 6 further from
passing. It was **already failing by 346** before this work, because csharp,
groovy, java, kotlin and scala contribute 278 false positives and 65 false
negatives between them, and the recorded total is 3,258 against a real sum of
3,610. Updating the recorded total to match would fold five broken lanes into an
"expected" baseline, so it is left alone and the delta is stated here instead.

## K. The final master review — three missing families, and two defects in the review's own instruments

This section is the last word and it is not a summary of the others. Everything
above was written by the same pass that wrote the analyzer, and a suite written by
the author of the code it checks has one specific blind spot: **a differential
whose ground truth omits a family agrees perfectly with an analyzer that omits
it.** 284 hand-derived facts could not find a family nobody had written down. So
the question was re-asked in a form counting cannot answer — *what does the
specification make referenceable, and does every one of those appear?*

### K.1 Three referenceable families emitted nothing

| family | the gap | corpus occurrences now |
|---|---|---|
| `variable_type` | a `VariableDefinition`'s declared type had no edge, while a field return type, an argument type and an input field type all had one. A variable was the only declared type in the language with no relationship to it; `returnType` and `rawType` carried the fact as a string where every sibling fact is an edge | 12 |
| `enum_value_reference` | an enum member named in a **value position** — input field default, argument default, variable default, executable field argument, directive argument — was recorded only as an opaque string in `defaultValue`. The enum member was a declared symbol that **nothing ever referenced**: `Color.RED` existed, was reachable only from its own `contains` edge, and every document that used it left no trace | 37 |
| `directive_argument_type` | the `DirectiveDefinition` branch emitted the `@name` symbol with `parameters` and then **no relationships at all**, so `directive @auth(requires: Role = ADMIN)` said nothing about `Role` — and a directive's argument type was the only declared type in the language with no edge to it | 20 |

Two decisions inside the third family, both of which a careless fix would get
wrong:

- **A declaration is not a reference.** The grammar emits an `EnumValue` node both
  in an `EnumValueDefinition` (a declaration, already a symbol with a `contains`
  edge) and in a `Value` (a reference). The discriminator is the **parent**, never
  the node type. All six call sites pass a `Value` or `DefaultValue` subtree, in
  which the test is unobservable — so the mutant that deletes it is declared
  **equivalent by construction** with the structural reason recorded, rather than
  deleted to make the count look better. It becomes load-bearing the moment a
  call site passes something wider, and that is stated in the justification.
- **Qualify only where the document says so.** `color: Color = RED` proves
  `Color.RED`, because an `InputValueDefinition` carries its own `Type` sibling.
  `item(filter: { color: RED })` names the *input object*, and reaching `Color`
  needs another file — so the target stays the bare `RED` and the store's
  unique-name strategy decides it. Naming a type in the executable case would be a
  fabrication, and the analyzer already applies exactly this rule to a field
  selection.

**Gate 8c also asserts MULTIPLICITY, and getting that assertion to be able to
fail took three attempts** — which is the most useful thing in this section. A
family that is emitted *once* is not a family that works: a collector that returns
after the first match, a dedupe `Set` that collapses two genuine facts, and a walk
that does not descend into a list or an object all pass a `> 0` test.

1. The first negative control put `return` inside the walk, which ends that node's
   recursion rather than truncating the result — so it changed nothing and the gate
   passed. A control that cannot fail proves nothing, and this one looked fine.
2. The fixture then turned out to have **no argument naming two enum values**, so
   there was nothing to truncate. An earlier edit had replaced `[ONE, TWO]` with
   `[ONE, $a]` to exercise a variable, and silently removed the case.
3. The assertion keyed on `source|target|role` and **ignored the line**, so the
   edge `Twice -> THREE` produced by a *different* call site masked the one that
   had been truncated. Both halves of the qualification rule are now asserted at a
   specific line, and the rule itself is pinned in both directions: `Multi2.pick ->
   Multi.ONE` and `Deep.inner -> Multi.TWO` must be **qualified** (the type system
   states the type) and `Twice -> ONE` must be **bare** (an executable argument
   does not), with a `_NEGATIVE` row so that blanket-qualifying every enum value
   fails rather than looking more complete.

With the line in the key, the control bites: truncating the collector reports
`Twice -> TWO @L55` and `Twice -> THREE @L55` absent and exits non-zero.

**And the multiplicity work found a bug in the move itself.** Gate 8c was the one
gate added *after* the runner was made self-locating, and it kept the absolute path
from the copy it was written in: a gate still pointed at the **old** `bb_tests`
fixture path, and the A/B was still reading the previous wasm from out there too.
It passed in the working tree — where the two fixture copies happened to be
identical — and failed in the suite the moment they diverged. That is the only
reason it was found, and it is now asserted: a claim fails if any probe invocation
in the runner names an absolute lane path.

**K.5 The test set was too comfortable, and it hid a crash.** Every gate fed the
analyzer well-formed, shallow, ASCII GraphQL. `findDescendant` walked the AST by
recursion and recurses to the depth of the subtree when its predicate does not match
early — and `[[…[Int]]]` is precisely that case, because the `NamedType` is at the
BOTTOM. **List nesting 2,749 deep threw `RangeError`, and the engine's guard turned
that into a minimal result: zero symbols and one opaque error for the whole file.**

What makes this worth a section rather than a line is *why* three real repositories
missed it. `A & B & C` never triggered it — the left-recursive rules put a
`NamedType` at depth 1, so the predicate matched at once and the recursion never
went deep. 5,000 clauses were fine. A defect that only one shape of input can reach
is a defect a representative corpus will not find.

Four helpers were converted to an explicit stack, and the gate written for the first
one immediately found **three more** at 20,000 clauses that the ad-hoc probe had
never reached: `enumValueReferences`, `collectNamedTypes` and
`collectDirectiveLocations`. Children are pushed in reverse so they pop in order,
preserving the recursion's pre-order; the differential is unchanged.

Two of the three new mutants are **derivable** equivalents rather than unobserved
ones, which is a stronger claim and came from reading the grammar:
`Type: NamedType | ListType | NonNullType` with `ListType: '[' Type ']'` means a Type
subtree holds EXACTLY ONE `NamedType`, so `findDescendant` cannot return a different
match in a different order; and `EnumValue: Name` means descending into a matched
`EnumValue` cannot find another one. Neither is "no fixture told" — both are
"nothing this grammar can produce distinguishes them".

**K.6 And the dimension nobody had tested at all: the production path.** Every gate
in this lane calls the analyzer DIRECTLY. Production does not — `ASTEngine.parseFile`
inserts timeout handling, the `ERROR`/`MISSING` walk and the ambiguity counters
between the tree and the result — so for this lane the engine path was untested.
Comparing them identity by identity, the first result was **all seven fixtures
differing**, each with a syntax error at line 1 columns 1–8, which reads exactly
like a catastrophic production defect.

It was the check's own fault. `parseFile(filePath, content, context?)` takes the
file's **content** as its second argument; the language string had been passed
there, so the engine parsed the seven characters `graphql` as a GraphQL document.
The wasm hash was identical and the signature was wrong. Two checks before
reporting — the hash, then the signature — is what kept a harness bug from being
written up as a production outage. It is the same shape as a mutant whose anchor no
longer applies, applied to a far scarier-looking result, and it is the third time in
this lane that an instrument rather than the code produced the alarming number.

**The production engine path preserves every identity**, including the damaged
fixture, whose five grammar errors the engine surfaces and which the direct
analyzer never sees by design.

The memo property is also pinned by a claim, because the engine building a fresh
analyzer per file is a CALLER INVARIANT rather than a guarantee: one shared
instance is **identical across four orderings and twenty repeats on one shared
instance**, byte-identical to a fresh instance per file.

**K.7 Linearity had to be measured by counting, and the first attempt was a flaky
gate.** "A single iterative DFS" is a claim about complexity, so it needs a curve:
the same schema shape at six sizes spanning 32×. Gated on milliseconds, it failed —
and it should not have been gated that way, because two sessions of the *identical*
binary disagreed on the direction: one measured cost per 1k symbols falling 457 →
241, the next rising 120 → 366. Gated on **counted accessor calls per symbol**,
**accessor calls per symbol is flat to 1% across a 32× size range** — exact, and
1% (54.67 → 55.47). The milliseconds remain in the
artifact as a printed observation and nothing more. A flaky gate does not get
fixed, it gets disabled, and then it protects nothing.

**Gate 8c exists because of this section.** A differential whose ground truth
omits a family agrees *perfectly* with an analyzer that omits it, so 284
hand-derived facts could never have found these. Gate 8c asks the only question
that can: does every position the specification makes referenceable actually
appear? Its fixture, `fixtures-constructs/10-every-family.graphql`, provokes all
**15** families, so a MISS is a regression and not an absent construct — and the
gate has a **negative control**: removing the `directive_argument_type` edge makes
it report `MISS directive_argument_type 0` and exit non-zero.

The probe needed correcting twice before it was worth trusting, which is the same
failure this review found in two other instruments:

* it originally demanded families **its fixture never provoked**, so four of its
  MISSes meant only "this file contains no union";
* two of the families it demanded **do not exist and should not**. `default_value`
  is not a family: a default whose value is a literal names no symbol, so there is
  nothing to reference, and a spelling belongs in `metadata.defaultValue`. And
  "directive argument" is not a family either — what an argument contributes is
  its **type** (`directive_argument_type`) and, when the value names an enum
  member, an `enum_value_reference`. Both are recorded as probe defects in the
  probe's own source, because a gate that asks for a family that cannot exist will
  one day be "fixed" by inventing the behaviour it asked for.

Five mutants were added with the three families (the family edge removed, the
collector disabled, the directive edges removed, the qualification dropped, the
parent test dropped), and three more with the iterative conversions in §K.5:
**44 caught, 0 survived** across 50, with 4 declared equivalent and 2 defeated by
another guard.

### K.2 A defect in the review's own new work, and the gate that had no check for it

The first version of the new edges hung the enum reference off the **bare**
argument or field name — `role -> Role.USER`. `role` is not a symbol; the symbol is
`UserInput.role`. The source is now the owning symbol's qualified identity, with
the argument named in metadata, matching what `input_field_type` and
`field_argument_type` already did.

The important part is not the fix. It is that **nothing would have caught it**:
the corpus sweep measured unresolved *targets*, and there was no check anywhere on
a relationship's *source*. So source resolvability was added to the project
resolution gate — and then had to be earned, twice:

1. The first check accepted any bare name appearing on some symbol. Its negative
   control **failed to fail**: `role` happens to be unique in this corpus, so it
   resolves under the store's strategy 2 and passing was *correct*. That is worth
   saying plainly — the "defect" was a robustness and consistency improvement, not
   a store-level bug, and the instrument was honest about it by passing.
2. So the check was tightened to resolve a source by the **same two strategies** it
   uses for a target. The control, retargeted at the corpus's dominant
   `field_argument` path, now reports **30 unresolved sources and exits non-zero**.

An earlier control was also aimed at a call site the corpus never reaches (0 of 37
`enum_value_reference` edges come from an input field default), which is why it
passed for a second, uninteresting reason. A negative control has to be aimed at a
path the corpus actually exercises, or it certifies nothing.

### K.3 Numbers after this review

| | before K | after K |
|---|---|---|
| relationships over the corpus | 18,985 | **19,054** |
| differential facts | 284 | **292** (P=1.000, R=1.000) |
| mutants | 28 / 25 caught | **50 / 44 caught**, 0 survived, 0 unapplied |
| accessor calls | 338,432 → 208,297 | 338,432 → **151,488** |
| project resolvable | 93.38% | **93.38%** |
| unresolved sources | *not measured* | **0**, with a failing negative control |

The accessor count got **worse** and the resolution percentage got **worse** when
the three families landed, and both were reported as they were: the families walk
real subtrees, and quoting the older 208,297 would have been the easy lie. The
resolution percentage moved because 69 new relationships entered the same
denominator, 18 of them bare enum members in executable documents whose enum the
project does not declare.

### K.4 The last optimization, and a bug it introduced

With the three families landed, `.type` was the largest remaining accessor at
**99,735 calls**, and a direct measurement showed **103,531 reads of 31,491
distinct nodes — 69.6% redundant**. `type` is a marshalling getter and `node.id`
is a plain own property, so a `Map` keyed on `id` turns every read after the first
into a hash lookup. Reassigned at the top of every `analyze` call, because a node
id is unique only within a tree and the binding reuses ids for nodes carried over
from an older one.

It shipped a bug first, and the bug is the interesting part. A mechanical rewrite
routed a plain object's `.type` **string field** through the memo alongside real
nodes; `argumentPairs` returns `{name, type, typeNode}`, and `arg.type` is a
string. The memo cached the first one under the key `undefined` and then answered
`ID` — the first argument type in the file — for an argument the source declares
`Role`. The differential caught it immediately, and `typeOf` now refuses any node
whose `id` is not a number. A string field and a node property are
indistinguishable to a regex, which is precisely how it got in.

Final: **338,432 → 151,488 accessor calls, 55.2% fewer**, `type` 99,735 → 41,558,
9,622 facts, P=1.000 / R=1.000, 0 unresolved sources.

## I.2 What was RESOLVED, and what is Not CLOSED

The m60 completion matrix scores a lane's review folder on whether it carries a
closure marker. This lane's review already documents each resolution in the
section that proves it, so this is an index rather than a restatement — and the
second half is the half that matters, so it is kept separate rather than folded
into the first.

### RESOLVED

| Was open | Closed by | Evidence |
|---|---|---|
| Two upstream gaps produced **published phantoms** (`anonymous_operation_1566 -> Int`), i.e. facts the source does not license | 4 grammar patches, each confirmed necessary by building upstream and watching the construct fail there | §B, §E |
| **94%** of the corpus's symbols pointed at a docstring's line rather than their own | Name-anchored range rule; every range contains its own name | §D |
| A `contains` edge with an **empty target** | Fixed at the store layer, with the fixture that reproduces it | §K.2 |
| Three referenceable families (interface / union / scalar) emitted **nothing** | Symbol contract extended; the dead-literal register reconciled | §K.1 |
| The lane's evidence lived **outside the repository**; the m12 artifact was an orphan | Evidence tracked in-repo; a probe lives in a tracked location so the next reader can re-run it | §L, §J |
| The optimizer introduced a bug while making it faster | Found by the gate written to detect that class, and the gate kept | §K.4 |
| A stale artifact would have let a grammar change report a cached pass | Every hashed input is re-measured; counts asserted against the lane's own artifacts | §K.3 |

### Not CLOSED, and named rather than implied

1. **The analyzer is 1.65× slower on analysis than the build it replaced** (622 ms
   → 1,029 ms; total ×1.62) for +3.9% facts. Stated in §I rather than averaged
   away, and the wall clock is explicitly not trusted to resolve small moves on
   this machine.
2. **Resolution has one honest limit.** §G measures edge resolvability and names
   the place where an unresolved endpoint is a real limit of per-file analysis
   rather than a defect to be explained away.
3. **The `diff`, `sharp`, `depth` and `fixtures` matrix cells are `n/a`**, as they
   are for lua and protobuf. This lane's own battery and differential cover the
   ground; the repo-owned instruments do not carry a graphql row for those four.

### RESOLVED after this review was written: a manifest claim that was simply wrong

The m60 `corpus` cell was failing for this lane, and it was right to. The m12
manifest claimed `grammarErrorFiles: 1` and `corpusRelationships: 6,042`, while
the only artifact on disk said 0 error files — and that artifact was a
1,970-byte placeholder carrying `symbols: null`, `corpusRepo: null` and the
revision of the **pre-patch** grammar. A stale artifact that reads like a
measurement is worse than no artifact, because it looks like evidence.

The correction ran in the direction that preserves evidence: the MANIFEST was
aligned to a real measurement, not the artifact edited to match the claim. The
corpus itself is gone — `bb_tests/repositories/graphql-js` is an empty shell
left by the disk cleanup, and the disk is at 96% — so the two named files were
fetched individually at the manifest's pinned revision `9c245018`, costing 368 KB
rather than a clone. They measure **3,251 symbols and 6,423 relationships**,
which matches the manifest's existing 3,251 exactly. `errorFiles: 0` confirms both
the artifact and this review against the manifest's claim of 1.

The 6,423 is 5 above the 6,418 this review reports, and both are right: 6,418 is
the m12 corpus-complexity instrument's count and 6,423 is the production
pipeline's. The manifest now carries the one the gate compares it against, and
records the divergence rather than quietly picking a number.

**Consequence of the disk cleanup worth naming:** gates 7 through 10 of this
lane's runner — corpus sweep, project-level resolution, construct coverage,
robustness and performance — are inside a guard on `bb_tests/graphql/repos` and
no longer execute, because that directory was removed. Every gate that does run
passes, and this lane's numbers above are the ones re-derived from tracked
artifacts rather than from a live corpus sweep.

## J. Reproduction

The probes and the artifacts **are here, in the repository**:
`script/m14/tmp/graphql/` holds them, the hand-derived ground truth, the fixtures
and the runner, so every number above is re-derivable from a checkout. They are
**here, in the repository** rather than beside it, and that is the whole point:
the lane used to sit in an unversioned directory, where a clone had no probes and
every claim below was unfalsifiable. It was not, until the final
pass moved it in from an unversioned directory; §L records that.

**Gate 11 runs last and that ordering is load-bearing.** `doc-truth` re-derives
42 numbers from artifacts that gates 8, 8b, 9 and 10b produce, so running it
seventh meant it passed only on leftovers from a previous run — the single gate
that exists to catch a stale claim was the one that could not run on a clean
checkout.


```sh
<corpus-root>/script/m14/tmp/graphql/run-all.sh            # gates 1-7
<corpus-root>/script/m14/tmp/graphql/run-all.sh --corpus   # + 8, 8b, 9, and 10/10b

# 8  corpus sweep, 47 real files          -> phantoms, dupes, line contract
# 8b project-level resolution            -> the G.1 table, SOURCES included; FAILS
#                                           if a provable relationship is left bare
#                                           or a source names no symbol
# 8c construct coverage                   -> all 15 referenceable families, each
#                                           provoked by fixtures-constructs/ and
#                                           then required to be emitted
# 9  extraction A/B, wired vs previous wasm
# 10  perf attribution (informational — the wall clock is too noisy to gate on)
# 10b accessor budget                    -> counted accessor calls; FAILS if the
#                                           O(n log n) namedChildCount walk returns

# in the repository
bun script/m14/run-fixtures.ts --lang graphql
bun script/m12/graphql-contract-probe.ts
bun script/m12/graphql-node-types-compare.ts
bun script/m12/graphql-corpus-errors.ts
bun script/m12/graphql-corpus-measure.ts
bun script/m14/verify-grammar-pins.ts --lane graphql   # scoped write, leaves other lanes' records alone
```

Regenerating the wasm is three commands and re-requires the whole lane; see
`grammars/tree-sitter-graphql/README.md`.

## Evidence (verbatim)

The numbers in this review and in `docs/analyzers/graphql.md`,
each re-derived from its artifact by `probe/doc-truth.mts`:

| artifact | value |
|---|---|
| m12 contract probe | 37/37 |
| m12 shape safety | 71 referenced / 71 live / 0 dead / 0 fatal unnamed |
| m12 corpus errors | 0 error files, 0 crashes |
| m12 corpus complexity | 3,251 symbols / 6,418 relationships |
| m12 performanceTruth | 1.62× slower |
| m12 corpus caveat | a 2-file corpus is not coverage |
| m14 fixture lane | `graphql: 4/4 fixtures pass`, check `fixtures-graphql` |
| m14 grammar pin | wired sha `f988e0a0…`, mirror byte-identical, 13 vendored files, source↔wasm proof zero in both directions |
| contract battery | 59/59 |
| differential | 387 facts, P=1.000, R=1.000 |
| mutation | 44 caught, 0 survived |
| grammar gaps | 113 specification constructs, 0 valid rejected |
| source guards | HOLDS / HOLDS |
| corpus sweep | 8,747 symbols, 19,054 relationships, 0 phantoms, 0 duplicate identities, 0 crashes, 12/12 extension members |
| corpus extent | 47 real files, 4 repositories, 691,855 bytes |
| extraction A/B | 12 → 4 error files, 20 → 7 error nodes; +4 symbols, +76 relationships |
| post-fix docstring lines | points at the docstring for **0** (was 3,131 of 3,332) |
| perf | parse ×1.55, analyze ×1.65; the Directives scan was **51% of the analyzer**, and after memoisation an ablation that deletes it is 134 ms *slower* |

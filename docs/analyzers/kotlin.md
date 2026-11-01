# kotlin.md

## Language

- Analyzer file: `src/ast/real-kotlin-analyzer.ts`
- Parser: `tree-sitter-kotlin` (WASM, via project pipeline `engine.ts resolveWasm`)
- Language detection: extension `.kt` / `.kts` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealKotlinAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration` / `object_declaration` / `function_declaration` / `property_declaration` / `primary_constructor` / `constructor_declaration` → `type_identifier` / `simple_identifier` name nodes. A property's name is one level down, inside `variable_declaration` — reading direct children finds nothing |
| kind | ✅ | class/interface/enum (via `class_declaration` + keyword child), data class → Class, object → Class (with `isObject` metadata), top-level `function_declaration` → Function, methods → Method, constructor → Constructor, properties → Property, enum entries → EnumMember |
| qualified/container name | ✅ | `scope` = package + enclosing types (excluding self); `package_header` → dotted `identifier` child → `packageStack` |
| ownerName / ownerKind | ✅ | enclosing type name (parent class propagated through the walk); top-level declarations have no owner (never self-contained) |
| range (start/end line + column) | ✅ | `nodeToRange` from `startPosition`/`endPosition` (annotation line for annotated declarations, matching M11/Java convention) |
| parameters | ✅ | `function_value_parameters` / `value_parameters` → `parameter` → name + `user_type`/`nullable_type`/`type_identifier`; primary constructor → `class_parameter` nodes (val/var → properties) |
| returnType / type | ✅ | `return_type` field / `user_type` children; properties via `variable_declaration` → type, or initializer NODE TYPE inference (`integer_literal`→Int/Long, `real_literal`→Double, `string_literal`→String, `character_literal`→Char, `boolean_literal`→Boolean, `call_expression`→callee) |
| documentation/comments | ✅ | KDoc (`comment` sibling starting `/**`) → `comments` |
| complexity metrics | ✅ | cyclomatic complexity on `if_expression`/`when_expression`/`for_statement`/`while_statement`/`catch_block`/`elvis_expression`/conjunction/disjunction + `&&`/`||` infix |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as warning `ParseError` (never silently dropped) |
| decorators/attributes | ✅ | annotation nodes only (never `user_type`); use-site targets via `use_site_target` node (`@field:JvmField`); `expect`/`actual` as pseudo-annotations |
| modifiers | ✅ | `modifiers` node children (`data`, `sealed`, `abstract`, `override`, `suspend`, `companion`, …). A visibility keyword is an ANONYMOUS child of `visibility_modifier`, so reading named children only misses it |
| extension receivers | ✅ | leading `user_type` child of `function_declaration` / `property_declaration` before the name |

## Relationship ontology — the ten types, with a verdict and a number each

Verdicts are from `script/m14/kotlin-ontology-census.ts` over a **stratified
deterministic draw** of `fixtures/repositories/kotlin@9b80c8ff99f3a63fcf578010bb2712697f4886aa`
(69,816 tracked `.kt`/`.kts`), through the production entry `parseFile`.
Sample: `--sample-strata 2400`, proportional across the first path segment by
largest remainder, evenly spread inside each stratum, 21 strata.
Artifact: `validation/m14/tmp/kotlin-census-strata2400-final.json`.

**Why a stratified draw and not a prefix.** `--sample N` used to mean
`files.slice(0, N)`. On this corpus that is not a sample, it is one subtree: of
the first 1,500 tracked files, **1,500 are under `analysis/` and 0 under
`compiler/`**, while the corpus is 38,711 `compiler/` against 10,604 `analysis/`.
The bias was not cosmetic — on the biased prefix `extends` measured **2,719**
edges and on the stratified draw **794**, a factor of 3.4 on one label, because
`analysis/` is interface-heavy. `--sample` keeps its meaning so earlier artifacts
stay reproducible; `--sample-strata` is what new claims use.

| Relationship type | Emitted? | Edges | Files | prod% | src resolves in file % | tgt resolves in file % | conf < 0.7 | confidence distribution |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calls | ✅ EMITTED | 24,905 | 1,546 | 50.3 | 88.8 | 26.9 | 4 | 0.70×24,833, 1.00×68, 0.50×3, 0.40×1 |
| uses | ✅ EMITTED | 5,374 | 914 | 65.7 | 98.8 | 62.6 | 2,985 | 0.60×2,985, 0.90×2,386, 1.00×3 |
| contains | ✅ EMITTED | 11,206 | 1,411 | 49.9 | 99.9 | 99.9 | 910 | 1.00×10,294, 0.60×910, 0.80×2 |
| imports | ✅ EMITTED | 5,691 | 883 | 70.6 | 0 | 0.1 | 0 | 0.90×5,691 |
| references | ✅ EMITTED | 24,451 | 2,037 | 58.2 | 95.8 | 7.9 | 0 | 0.95×18,760, 0.90×5,691 |
| exports | ✅ EMITTED | 2,315 | 805 | 45.7 | 4 | 100 | 0 | 1.00×2,315 |
| extends | ✅ EMITTED | 794 | 424 | 42.8 | 100 | 47.5 | 0 | 1.00×794 |
| implements | ✅ EMITTED | 550 | 316 | 35.1 | 99.8 | 34.2 | 0 | 1.00×550 |
| overrides | ✅ EMITTED | 1,282 | 374 | 65.6 | 99.9 | 18.4 | 1,048 | 0.50×1,048, 0.90×234 |
| instantiates | ✅ EMITTED | 4,281 | 904 | 33.4 | 89.6 | 35.9 | 0 | 0.70×4,281 |

The `Emitted?` column header is not cosmetic: `script/m14/verify-doc-truth-emissions.ts`
grades this table against the analyzer's own `RelationshipType.*` references and
fails on a disagreement, and it recognises a claim table only when the SECOND
column header carries `emitted` or `supported`. An earlier draft of this section
used `Verdict` as that header and the gate reported `NO_CLAIM_TABLE [kotlin]` —
i.e. it had stopped being able to check this doc at all, which reads as coverage
and is not.

No type is RULED and none is a GAP: kotlin emits all ten. `imports` and `exports`
were the two missing at handover and are now emitted; the reasoning and the
measurements are under "Relationship ontology" below and in commits `5c8eb030b`
and `cbd08a09e`.

`field_access` is not one of the ontology's ten types and is not emitted; it is a
declared non-goal (property reads are published as `uses` at the call level).

`prod%` is the share of the type's edges coming from files NOT under a
`testData` / `test` / `testFixtures` / `testFramework` directory. It is stated
because 55,305 of 69,816 tracked files (79.2%) are test inputs — a testData
snippet is a parser fixture no compiler compiles into an artifact — so a rate that
pools the two is not a rate about either. `exports` is the most testData-heavy of
the ten (45.7% production) and `instantiates` the least (33.4%).

### The six questions, per already-emitted type

Source derivation answers only the first. Each answer below is a measurement on
the same 2,400-file draw; `script/m14/kotlin-r7-endpoint-probe.ts` (1,200-file
every-Nth draw) carries the endpoint-level numbers.

1. **Exists** — every type is constructed at a named site in
   `src/ast/real-kotlin-analyzer.ts`; the site list is in the "emission sites"
   comment at each `relationships.push`.
2. **Fires** — the table above. No type's count is 0 on a stratified draw, so no
   branch is dead. The two branches this lane found dead-by-inspection are
   recorded under "Dead code and asymmetries" below.
3. **Correct (an independent oracle agrees)** — **this is where kotlin's coverage
   is uneven and the unevenness is the finding.**
   - `calls`, `contains`, `references`, `uses` — audited by
     `script/m14/differential.ts` (`deriveKotlinEdges`, `deriveKotlinUsesTruth`,
     `deriveKotlinContainsTruth`, `deriveKotlinReferencesTruth`). Measured on a
     200-file draw at HEAD: `tree-truth=1883 covered=1883 (100%) MISSING=0 |
     analyzer-edges=1510 unexplained=5 (0.3%) heuristic=4`.
   - `extends`, `implements`, `instantiates`, `overrides` — in the differential's
     COMPARED label set (verified by
     `script/m60/rel-type-coverage-gate.ts`, which evaluates the harness's own
     filter rather than restating it) but not produced by a named kotlin truth
     function.
   - `imports`, `exports` — **no oracle in the shared differential.** Two
     DERIVATION findings, a regression from the clean set of twelve lanes this
     wave found. See "The two DERIVATION findings" below.
   - **The oracle's ceiling, stated rather than implied:** it is a second walker
     over the SAME pinned grammar, so a grammar bug shared by both paths is
     invisible to both. It is not evidence about parse coverage.
   - **A second, sharper ceiling, quoted from the harness itself.**
     `script/m14/differential.ts:1969` records that the kotlin comparison "matches
     label + target only" and that `from` "never matched the analyzer's and was
     invisible to a green row". So the entire placeholder-SOURCE class — the
     `Global` work under "R7 findings" — is **structurally unauditable** by the
     differential, and its repair is invisible there too. Measured: the same
     200-file draw gives byte-identical output (`hash=488658a7f812d265`,
     `tree-truth=1883`, `analyzer-edges=1510`, `unexplained=5`) with and without
     the fix. That is not luck; it is the comparison key.
4. **Labelled** — per-type `metadata.relationshipType` census is in the artifact
   (`relationship_type_metadata`). The `imports` label names kotlin's three import
   forms (`imported_declaration` / `imported_declaration_aliased` /
   `imported_package_wildcard`) because the pinned wasm keeps `.*` out of the
   identifier text, so a consumer cannot recover the form from the target alone.
   `extends` vs `implements` is decided by constructor-invocation presence, not by
   position.
5. **Resolved** — both endpoints bind to real symbols. This is where the lane was
   weakest and two defects were found and fixed; see "R7 findings" for the
   before/after. Remaining known-unresolvable populations are stated there rather
   than smoothed over.
6. **Confident** — per-type distributions are in the artifact. Two are dominated
   by sub-0.7 rows and are therefore heuristics by the honesty contract's §4
   definition, not facts: `uses` (0.60 dominant — bare member reads) and
   `overrides` (0.50 dominant — the first-supertype guess, `reasonCode:
   first-supertype-guess`, when no ancestor in the hierarchy declares the method).
   Both carry machine-readable reason codes. **This corrects the doc's earlier
   confidence column**, which claimed `overrides` runs at 0.9; measured, 1,048 of
   1,282 `overrides` edges are at 0.50 and 234 at 0.9.

### `imports` — the DEPENDENCY

The `import_header` walk has always filled `ParseResult.imports`; the only
relationship ever built from an import was a 0.9 `references` edge, so the
dependency was stored under one of its two ontology names and not the other.
Measured at handover: 11,040 `import_header` declarations in 1,158 of 3,000
files and **0** `imports` edges.

- **Source is the declaring package**, java's shape, so `source + "." + target`
  reconstructs the dotted path an `exports` edge publishes and the two labels
  meet without a resolver.
- **Target is the path read off the grammar node.**
- **Confidence 0.9, `reasonCode: declared-import-path`.** The path is exact;
  nothing in this analyzer resolves it to a declaration in the project, so the
  edge records a stated dependency rather than a proven one. Honesty contract §4
  requires a machine-readable reason code with any sub-1.0 confidence.
- **`evidenceClass: import_based`.** `classifyEvidenceTier` gained an `imports`
  branch; without one every import edge fell through to `usage_contextual`, the
  class that means "inferred from usage".
- **The three kotlin forms are named**, because a consumer cannot infer them from
  a trailing `.*` the grammar never puts in the identifier text. 453 star and 160
  aliased imports in a 3,000-file window is why `wildcard_import` /
  `import_alias` are read as child nodes at all.
- **Limitation — root package.** A file that declares no package gets the source
  `"root"`, the same convention the kotlin import-`references` edge and the java
  lane already publish. Measured: 269 `imports` edges with `root` as source, 266
  of them in files with no package header, on the 1,200-file draw. Kotlin, unlike
  java (JLS 7.4.2), does not forbid importing from the unnamed package, so this
  is a real population and a placeholder name for it; standing rule R7 is why it
  is declared rather than shipped silently.

### `exports` — the reachability surface

The loop in `analyze()` filled `ParseResult.exports` and **no row reached a
relationship**: the lane published a public-API list and no graph edge. Measured
at handover: **0** `exports` edges against 2,809 `ExportInfo` rows on a 1,500-file
window.

Kotlin has **no export keyword** — a node-type inventory of 261 distinct types
across 3,000 files finds none matching `/export/i`. An inventory alone would
therefore have "proved" the construct absent, which is the unsound reasoning that
overturned json's `exports` ruling
(`script/m14/ontology-coverage-gate.ts:143`). Export in kotlin is a VISIBILITY
property, so the rule is read from modifiers and position:

1. **Top-level only** (`!ownerName`) — a member is reached through its container
   and membership is already published as `contains`.
2. **Not lexically local** — "no ownerName" is NOT "top level": a declaration in a
   function body gets no owner here, because `isMemberPosition` is only true
   inside a `class_body`. Measured: 148 of 2,809 ownerless public symbols on the
   1,500-file window are local (`KaFirCompilerFacility.kt:467 register`,
   `:584 mapModule`, `:594 appendDanglingChunk`) and the pre-existing `ExportInfo`
   loop published every one.
3. **Public only** — `private` is file-scoped and `internal` module-scoped in
   kotlin, so neither is reachable by name from another module, which is the
   reachability an `imports` edge asserts from the other side. 1,719 `internal`
   and 657 `private` excluded on that window.
4. **Not synthesized, not an anonymous object** — a data class's
   `componentN`/`copy`/`equals` are written nowhere (`metadata.isPhantom`).
5. **Not a `.kts` script** — a script's top-level declarations become members of
   the script class and are importable by nothing.
6. **The file must name a package** — the edge's source IS the package and the
   root package has no name. **This is the one clause that is not a language
   rule** and is declared as a limitation: kotlin, unlike java, does not forbid
   importing from the unnamed package, so the clause asserts a restriction the
   language does not make. Cost measured rather than assumed: 693 of 2,613
   top-level ownerless public declarations on the window are in the root package,
   3 in `.kt` files and the rest `testData` fragments.

`ParseResult.exports` fell 2,809 → 2,480 on that window, the difference being
local and script declarations. The edge and the list now agree on clauses 1–5 and
**deliberately disagree on clause 6** (a package-less file still has exportable
names), which this doc states rather than hides.

### The two DERIVATION findings

`script/m60/rel-type-coverage-gate.ts` CHECK 1, measured at HEAD:

```
kotlin  2 un-audited: ["exports","imports"]
DERIVATION|kotlin|emits `exports` but the differential audits
  ["calls","contains","extends","implements","instantiates","overrides",
   "references","uses"] — the type is stored and compared against nothing
```

kotlin was in the workstream's clean set of twelve lanes before this wave, so
emitting two new labels put it back on the register. `differential.ts` is
master-owned, so the lane cannot close this. What it did instead is write and test
the derivation: `script/m14/kotlin-imports-exports-oracle.ts`, a second walker
written from the Kotlin specification that shares no node-type table with the
analyzer. On 600 files (every 116th tracked, 0 thrown):

| label | TP | FP | FN | files |
| --- | --- | --- | --- | --- |
| imports | 1,383 | 0 | 0 | 210 |
| exports | 511 | 2 | 12 | 194 |

Import-shape disagreements: 2. **Total 16**, every one adjudicated in
`validation/m14/tmp/kotlin-imports-exports-oracle.json` (`per_file_disagreements`)
and in commit `d92f33cf7`: 7 are `.kts` scripts (the oracle lacks clause 5 and
the analyzer is right), 3 are the context-parameter grammar gap, 1 is a testData
file holding a Java fragment, 1 is `package override` (a keyword as a package
name, which the oracle's package reader misses), 2 are a comparison-pairing
artifact in one file that imports both a class and its package wildcard, and 2 are
local declarations inside a lambda.

Wiring this into `script/m14/differential.ts` is a one-block change to a file this
lane does not own. **Reported, not made.**

## R7 findings — placeholder-literal and empty endpoints

Standing rule R7: no analyzer may NAME something with a placeholder literal.
Kotlin had **no registered sentinel site at all** before this wave, so
`script/m60/sentinel-census.ts` had nothing to say about it — which is why the
defects below survived every gate. Measured by
`script/m14/kotlin-r7-endpoint-probe.ts` on a 1,200-file every-Nth draw.

Corpus-wide effect of this round's fixes, on the 2,400-file stratified draw
(`r7_suspect_endpoints` / `r7_endpoints_not_declared_in_their_file` in
`validation/m14/tmp/kotlin-census-strata2400-final.json`):

| | before | after |
| --- | --- | --- |
| R7 suspect endpoints | 6,410 | 5,232 |
| of those NOT declared in their own file | 6,255 | **5,071** |
| `calls` source resolving to a symbol in its own file | 86.0% | **88.8%** |
| `references` source resolving in file | 94.4% | **95.8%** |
| `instantiates` source resolving in file | 86.8% | **89.6%** |

The residual 5,071 is dominated by `.kts` script scope and by files the analyzer
already reports as damaged; the breakdown is under items 2 and 3 below, and none
of it is smoothed over.

### 1. Empty endpoints — FIXED (`c779529b1`)

tree-sitter-kotlin's parse recovery for `foo.bar.baz.AA.BB.<caret>CC` inserts a
`type_identifier` whose **text is the empty string**. Dumped from the pinned wasm
on `analysis/analysis-api/testData/components/resolver/singleByPsi/nestedTypes/ResolveTypeInTheEndOfType.kt`:

```
user_type "foo.bar.baz.AA.BB.<caret>"
  type_identifier "foo" "bar" "baz" "AA" "BB"
  type_identifier ""          <-- EMPTY TEXT
  type_arguments "<caret>"
```

`collectTypeNames` read `n.text` off every `type_identifier`, so that node became
`references: test -> ""` at confidence 0.95 **with a line number**. 14 empty
endpoints across five labels were counted; 6 were `references` and are fixed by
skipping a nameless `type_identifier` — deliberately narrow, because dropping the
whole `user_type` subtree would also remove the six real identifier nodes either
side of the break.

**Still open: 10 empty endpoints on the same draw**, which this lane did NOT fix
and does not claim to: `contains:target` 7 (all in
`analysis/low-level-api-fir/testData/classId/deepNestingInsideNamelessLocalClasses.kt`),
`references:source` 2 (`.../lazyResolve/delegationPropertyGetter.kt`),
`implements:target` 1 (`.../contextCollector/classHeaderPositions/superTypeDelegatedTypeRef.kt`).
Named here because the definition of done says "no empty names" and these are the
three files that would have to be fixed to meet it.

### 2. `Global` as an edge SOURCE — the largest class, mostly FIXED (`cbd08a09e`, `d92f33cf7`)

Kotlin has no symbol named `Global`. Three attribution resolvers walked up the
parent chain looking for a declaration to own an edge and all three carried the
same list:

```
function_declaration | class_declaration | object_declaration
```

`property_declaration` was in none of them, so a top-level property was not a
declaration boundary, the walk reached `source_file`, and the fallback returned the
literal `"Global"`.

The question that decided the fix was which WORLD the fallback was standing in
for:

| world | before | after |
| --- | --- | --- |
| A — `Global` in a file the analyzer already reported as damaged | 1,014 | 927 |
| B — `Global` in a **clean** file | **1,290** | **580** |

B non-zero means it is not standing in for a declaration the grammar failed to
produce — it is a live fabrication in ordinary shipped code. Two real files,
neither damaged:

```
CommonJsAndWasmArgumentProviders.kt:101
  private val testBaseDir: Path = Paths.get("").toAbsolutePath()
                                 ^^^^^^^^^^^^^ sourced to `Global`
KaFirSymbol.kt:65
  private val FirBasedSymbol<*>.realPsi: PsiElement?
                                ^^^^^^^^^^^ sourced to `Global`
```

Two rules, both gated on `parent.type === "source_file"` because a member
property is owned by its CLASS and the walk reaches the class first:

1. a **top-level property** owns its initializer and its type clause;
2. an **extension property's accessor** owns them too — the pinned wasm makes
   `getter` a SIBLING of `property_declaration`, not a child (dumped on
   `KaFirSymbol.kt:97-98`), so the link is made by sibling order: the nearest
   preceding `property_declaration` under the same `source_file`.

Both guards were **proven load-bearing by removing them**, not asserted:

| removed | fixtures that turn red |
| --- | --- |
| the `source_file` guard | 7 (`anonymous-field-member`, `indexing-uses`, `init-attribution`, `object-literal`, `references-declared-types`, `top-level-property-owner`, `uses-gates`) |
| the accessor branch | 1 (`top-level-property-owner`) |

**What remains, and is not fixed here.** Of the 580 residual clean-file edges,
**563 are in `.kts` files** (557 `calls`, 4 `uses`, 2 `instantiates`) — a Kotlin
script's top-level statements genuinely have no enclosing declaration, so this is
not the same defect wearing a different name. 15 are in `.kt`:
`references` 14, `calls` 1. Deciding what a script's file-scope statements should
be attributed to is a design question about ABSENCE for unattributable code, and
it is left as that rather than smuggled in here.

At the 2,400-file census scale (which pools damaged and clean files) the residual
is `calls:Global` 2,686 — **1,019 of them in `.kt`** — plus
`instantiates:Global` 445 and `references:Global` 191. The probe's split is the
one that says which of those are the same defect: on its every-Nth draw, 563 of
the 580 residual clean-file edges are `.kts`.

**Why no gate ever saw this.** The differential cannot: `differential.ts:2044`
returns the same `"Global"` from the oracle, so both sides fabricate the spelling
identically and agree — standing rule R10's exact shape. And the comparison
ignores `from` (see question 3), so the repair is invisible to it too.

### 3. `root` as an edge SOURCE — MEASURED, not fixed

`root` is the analyzer's source for a file that declares no package. On the
1,200-file draw: **269 `imports`** (266 in package-less files) and **377
`references`** (235 in package-BEARING files, where the import-`references` source
rewrite to the file's primary type did not fire because the file has no
ownerless type). The 235 is the interesting half and is unexplained by the
`imports` root-package rule; it is named here as an open item.

### 4. `anonymous_object` as a symbol NAME — MEASURED, not fixed

When tree-sitter-kotlin cannot parse the body of a top-level `object` it does not
produce an `object_declaration` at all:

```
infix_expression
  object_literal "object"
  simple_identifier "WithContext"      <-- the REAL name, right there
  lambda_literal "{ ... }"
```

and the analyzer recovers by publishing the declaration as `anonymous_object`.
Reproduced on a three-line file (`package com.acme.min` / `object WithContext {`
/ `context(ctx: String)` / `fun a() = 1`): the symbol comes out `class
anonymous_object`, so the real name is lost **and** the `exports` clause-4
exclusion then drops the declaration. Measured **36 symbols named
`anonymous_object`, 0 of them written in their own file**, on the 1,200-file
draw. The independent oracle independently flagged the consequence: 3
`exports` false negatives (`FirUnderscoreChecker.kt`,
`FirAmbiguousAnonymousTypeChecker.kt`, `FirSuspendLimitationsChecker.kt`), each a
top-level `object` whose body carries `context(...)`.

**Not fixed in this session, deliberately.** The change is in the `object_literal`
naming path, which three existing fixtures pin as a deliberate `anonymous_<X>`
convention (`anonymous-type-owner`, `anonymous-field-member`, `object-literal`), and
the sweep that would confirm the change is safe is a full-corpus re-run this
session did not have budget for. Recommended change, for whoever takes it: when an
`object_literal` is the first child of an `infix_expression` whose other children
are a `simple_identifier` and a `lambda_literal`, treat the whole node as a named
object declaration and take that `simple_identifier` as the name.

The same probe also swept SYMBOL names for a generated-name prefix and found the
class is otherwise clean: `global` (2), `unknownContext` (1),
`syntheticPrimaryConstructor` (1), `unnamedContextParametersFunction` (2) and 20
more all occur **written in their own file** — they are real identifiers that
merely start with a suspicious prefix, which is exactly why the test is "is this
name written in this file" rather than "does this name look like a placeholder".

## Dead code and asymmetries (line-by-line read)

- **`resolveCallSource` vs `extractDeclaredTypeRefs.resolveSource` vs the `uses`
  resolver** — three copies of the same parent-walk. All three now call
  `kotlinTopLevelPropertyName`, but the copies still differ in which node types
  they recognise: the call resolver handles `object_literal`, the other two do
  not. Three near-identical predicates is the shape that let the same missing node
  type survive in all three at once; collapsing them is a refactor this lane
  reports rather than does, because the `uses` resolver deliberately excludes
  constructor symbols (`SymbolKind.Constructor`) for a documented reason and a
  naive merge would undo it.
- **`kotlinDeclarationPlacement` is computed twice per file** — once in
  `analyze()` for the `ExportInfo` list and once inside
  `emitKotlinExportRelationships`. It is a single tree pass each time, so this is
  two passes rather than one, on every parsed file. The lane's declared complexity
  envelope allows it; it is not free.
- **`injectPhantomSymbols` is not wired**, so a data class's `componentN`/`copy`/
  `equals` are never materialized as symbols (documented non-goal).
- **`canonicalizePublishedNames`** runs before the exports loop and the
  import-source rewrite, deliberately, so every published spelling derives from the
  canonical one. This ordering is load-bearing and is commented as such.

## Supported constructs

- Data classes (`data class User(val id: String, val name: String)`) — class + constructor + val/var properties — `Models.kt`
- Sealed class hierarchies (`sealed class Result<out T>` + nested data classes/objects with delegation) — `Models.kt`
- Interfaces (`Repository<T>`), abstract classes with nested interfaces (`BaseService.Entity`), companion objects (`const val VERSION`) — `Models.kt`
- Generic bounds (`T : BaseService.Entity`, `out T`) and generic methods — `Models.kt`
- Cross-file inheritance: `class UserService(...) : BaseService<User>(), Repository<User>` → clean extends/implements targets — `UserService.kt`
- `override` methods, `suspend` functions, top-level factory functions, `User?` nullable returns — `UserService.kt`
- Extension functions (`fun String.shout`, `operator fun User.plus`) with receiver edges — `Extensions.kt`
- Operator overloads (`plus`), use-site annotations (`@field:JvmField`), top-level `const`-style properties — `Extensions.kt`
- `when` expressions, nullable params, collection chains — `Extensions.kt`
- Top-level properties owning their own initializer and declared type — `top-level-property-owner.kt`
- Extension-property accessors as siblings of their declaration — `top-level-property-owner.kt`

## Unsupported / explicit-unknown constructs

- **Cross-file override targets** (resolved, fixture `UserService.kt`): the analyzer is per-file but accepts an optional project context (`AnalyzeContext.overrideCompanion` — owner type → declared method names). With context, the override target is the first ancestor in declaration order that actually declares the method (`src/ast/override-context.ts`, shared with the Java analyzer). Without context the analyzer deterministically emits the first hierarchy parent at confidence **0.5** with `reasonCode: first-supertype-guess` — measured, 1,048 of 1,282 `overrides` edges on the stratified draw, so this is the DOMINANT case and not a rare fallback. Below the 0.7 consumer threshold on purpose.
- **Grammar gaps on advanced Kotlin**, real-corpus evidence:
  - **`fun interface`** declarations, object-with-delegation expressions (`= object : X by y {`), and some extension-function+object patterns produce ERROR/MISSING nodes. The analyzer REPORTS these as warning ParseErrors and continues extraction.
  - **Context parameters** (`context(component: KaFirSessionComponent)`) — a Kotlin 2.2 construct — are not in the pinned grammar at all. `context(x: T)` parses as a `call_expression` and the `: T` becomes an ERROR; an accessor body is then orphaned as a top-level sibling `assignment`. This is the cause of the `anonymous_object` naming defect above and of 3 of the oracle's 16 `exports` false negatives.
  - One corpus file carries only hidden `MISSING _alpha_identifier` recovery tokens in multi-condition `when` entries that the web-tree-sitter binding does not expose via child iteration; the engine flags such files via a root-level warning so they are never silently clean.
- **Data-class compiler methods** (componentN, copy, equals/hashCode/toString): not materialized as symbols; the data class + val properties are extracted. Documented non-goal.
- **`field_access` edges**: not emitted; property reads are published as `uses` at the call level. Documented non-goal.
- **Kotlin script file scope**: a `.kts` file's top-level statements have no enclosing declaration, so edges written there carry the `Global` fallback (563 edges on the 1,200-file draw). Declared rather than fixed; see "What remains" above.

## Regex inventory

**Zero.** The Kotlin analyzer is regex-free. Baseline at M12.01 was 14 usages;
all 14 were eliminated by reading AST node types instead of text
(`validation/m12/results/regex-census.json`; the census gate reports
`kotlin entries: NONE`).

Exceptions added this wave, and why they are not a regression of that rule:
`/\.kts$/i` in two places, to test the FILE's extension. The rule the lane
actually holds is "no regex over source TEXT to recover structure"; a file's own
path is not source text and there is no node for it.

## Complexity envelope

| Run | files | symbols | relationships | wall ms | relationships/s |
| --- | --- | --- | --- | --- | --- |
| fixtures | 53 | — | — | — | — |
| corpus, every-Nth draw (`kotlin-payload-latency.ts --sample 600`) | 600 | 14,458 | 75,133 | 180,077 (cold sweep) | 417 |

Latency note: 300 ms/file cold on `fixtures/repositories/kotlin` is **not**
comparable to the doc's earlier 31 ms/file figure, which was measured on
`intellij-community` — a different repository with much smaller files. The
number that is comparable across waves is the payload ratio below.

## Payload / latency — re-run after adding edges

`docs/analyzers/ONTOLOGY-WORKSTREAM.md` requires this and forbids quietly
re-baselining a green budget. Instrument: `script/m14/kotlin-payload-latency.ts`,
600 files, artifacts in `validation/m14/tmp/`.

| | edges | un-narrowed | narrowed | ratio |
| --- | --- | --- | --- | --- |
| before the two new labels (committed `7d850ad32`, 400-file slice) | 60,806 / 55,408 | 13.76 MiB | 11.41 MiB | **1.18x** |
| after, at HEAD | 67,794 / 60,794 | 13.46 MiB | 11.41 MiB | **1.179x** |

The two new labels add **5,386 edges / 2,096 KiB** (17.22% + 1.10% = 18.3% of
relationship bytes; `imports` is the larger of the two at 17.22%). The ratio sits
at the bottom of the workstream's 2.5–4.8x band for other lanes and **did not
regress** — 1.18x → 1.179x is inside the noise of a different sample size, and
the R7 fixes moved edges between sources rather than adding any.

`script/m60/rel-type-coverage-gate.ts` CHECK 2 confirms both new labels are inside
the traversal default (`10 of 10`), so an un-narrowed `bb_graph` answer returns
them.

## Differential ground truth

- Gate: `script/m14/differential.ts` (master-owned, run read-only). The lane's
  DECLARED corpus (`LANG_REPOS.kotlin = Exposed`) is not present on this machine,
  so these are `--repo kotlin --lang kotlin` probe rows, not the canonical sweep.
- **HEAD, 200-file draw:** `tree-truth=1883 covered=1883 (100%) MISSING=0 |
  analyzer-edges=1510 unexplained=5 (0.3%) heuristic=4 |
  unexplained-by-label: contains=5`.
- **Before/after on the same draw**, both with a FRESH `BB_M14_WORK` so the
  rotation draws the same files (the harness carries its sample in a journal, so
  a reused root makes a before/after comparison meaningless — the first attempt
  at this comparison produced two different hashes and was discarded):
  **byte-identical, including the hash.** That is the comparison-key finding
  under question 3, not an absence of effect: the fixes change edge SOURCES and
  the kotlin comparison ignores `from`.
- The 5 unexplained `contains` rows are pre-existing — the same `contains`
  unexplained rows appear in the prior lane's committed before/after artifact at
  sample 400.
- M12 ground truth for the fixture corpus: `validation/m12/ground-truth/kotlin.json`,
  precision 1.000 / recall 1.000 over 77 facts (`validation/m12/results/kotlin-differential.json`).

## Grammar conformance

`script/m14/audit-analyzer-grammar.ts`: **kotlin PASS, 74 refs, 0 unknown, 0
unknownFields.** Two facts from this round that the audit's own pass does not
cover, and that cost real time: a visibility keyword is an **anonymous** child of
`visibility_modifier`, and a property's name is inside `variable_declaration` —
reading named or direct children respectively misses each.

The gate as a whole FAILS on `cpp` and `rust` (4 unregistered type literals, 2
count regressions: `class_body` ×2 in `real-cpp-analyzer.ts`, and
`bare_function_type` + `parenthesized_type` in `real-rust-analyzer.ts`). Those are
other lanes and this branch touched only `src/ast/real-kotlin-analyzer.ts`; see
the lane report.

### A defect in `verify-doc-truth-emissions.ts` that costs every lane its first row

This gate reports one finding against this doc — `UNDOCUMENTED [kotlin] calls` —
and it is the gate's own bug, not the doc's. `parseClaimTable` walks the chosen
table and, after skipping the header and the rule row, does:

```ts
    if (i === chosen.at) continue
    if (isRuleRow(cs)) continue
    if (!started) { started = true; continue }      // <-- eats the FIRST body row
```

The header is already handled by the line above, so this branch consumes the
first DATA row of every claim table in the repository. **Proved by experiment,
not inferred**: with `calls` first this doc reports `UNDOCUMENTED [kotlin] calls`;
swapping the first two rows moves the finding to `UNDOCUMENTED [kotlin] uses`.

Consequence for the gate's purpose: a lane whose FIRST claim row is a false claim
ships it uncaught, and the lane cannot fix that by writing a truer table — the
truer row is the one that gets dropped. `script/m14/verify-doc-truth-emissions.ts`
is master-owned, so this is reported and **not** worked around: reordering this
lane's table to move the finding off `calls` would hide the defect behind the very
mechanism that causes it.

The same gate's kotlin findings went from three to one with this round's doc
rewrite: `NON_ENGINE_KIND [kotlin] depends` and `NON_ENGINE_KIND [kotlin]
fieldaccess` are gone, because `depends` and `field_access` are prose now rather
than rows — neither is an `ASTEngine.RelationshipType`, so a row claiming one
asserts something the enum does not contain.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/kotlin/` (54 fixtures, incl.
  `ontology-imports-exports`, `ontology-root-package`,
  `recovery-type-identifier`, `top-level-property-owner`)
- Mutants: `script/m14/kotlin-mutants.ts` (18, all caught) and its runner
  `script/m14/tmp/kotlin-mutant-run.ts`
- Ontology census: `script/m14/kotlin-ontology-census.ts` →
  `validation/m14/tmp/kotlin-census-strata2400-final.json`
- R7 endpoint probe: `script/m14/kotlin-r7-endpoint-probe.ts` →
  `validation/m14/tmp/kotlin-r7-endpoints-after.log`
- imports/exports oracle: `script/m14/kotlin-imports-exports-oracle.ts` →
  `validation/m14/tmp/kotlin-imports-exports-oracle.json`
- Payload/latency: `script/m14/kotlin-payload-latency.ts` →
  `validation/m14/tmp/kotlin-payload-latency-after-fixes.json`
- M12 differential: `validation/m12/results/kotlin-differential.json`
- Corpus sample list (M12): `validation/m12/results/kotlin-corpus-sample.txt`

---

# M60 (2026-10-10) — one JVM ruling already held; the other had a defect only a COLUMN pin could see

The java and groovy folds closed with "kotlin (6 failures) and scala (5) follow it on the same
axis" (`BRANCH-INVENTORY-2026-10-07.md` §14/§15), an inference from the *shape* of those lanes'
declared failures. Measured, it is wrong for both: kotlin's six declared failures are the
`exports`/`imports` vocabulary and the `context(...)` header
(`context-parameters`, `exports-file-identity`, `exports-no-module-identity`,
`exports-published-surface`, `exports-visibility`, `imports-exports-ontology`), and NONE of them is
a constructor-identity or line-anchoring defect. What the two rulings actually do here is one
ruling already met (constructor identity) and one real defect (a class-body property anchored on
its `val` keyword) — and the defect was found by WRITING the pin, not by reading the code, which is
the argument for writing pins first.

## Ruling 1 — constructor identity: already held, and now counted

`script/m14/lanes/jvm-rulings-ab.mts`, 1,500-file lexicographic slice of the 82,222-file kotlin
corpora (`kotlinx-coroutines` + `kotlin`), run as an identity control because this lane's analyzer
is byte-identical to its HEAD blob:

| | this lane |
| --- | --- |
| constructor symbols | 1,978 |
| distinct constructor names | 1,852 |
| named literally `constructor` | **0** |
| files / symbols / relationships | 1,500 / 21,194 / 119,555 — PRE and POST identical |
| per-type deltas (all ten) | 0 |
| identity / anchor / relationship-row movement | 0 / 0 / 0 |

The zero column is the point of an identity control: the two sides are the same bytes, so any
movement would have indicted the instrument, not the analyzer. (It did, once: the first version of
that harness called `run-fixtures.ts`'s cached shared Parser from 8 concurrent workers, and 7
kotlin files came back `Incompatible language version 0` on ONE side of an identical-content A/B.
The harness now builds a parser per worker and parses each file ONCE for both sides.) The
class-name convention itself is pinned by `kotlin/ctor-delegation`, which states it in its own
words — "one primary + two secondary constructors share the class name by the java C3 family
convention" — with `equals: 3` so a change is visible rather than silent.

## Ruling 2 — declaration-name anchoring: the pin found a REAL defect, and it is a column

The lane's `declarationLineNode` reads `findNameNode` first and falls back to the first non-trivia
named child. tree-sitter-kotlin exposes **no `name` field** (measured: 0 name-field nodes over
`kotlinx-coroutines`'s 1,039 files), so the field-based comparison the scala A/B uses is not
expressible here — and the read is load-bearing, measured: removing it changes **7,126 symbol rows
over 1,200 corpus files** (`kotlin/analysis-api-fir-diagnostics`'s properties and extension
functions). What the read could NOT see is where a `property_declaration` keeps its name:

```
    property_declaration        L2:C5      <- the symbol was anchored here, at the `val`
      binding_pattern_kind      L2:C5   "val"
      variable_declaration      L2:C9
        simple_identifier       L2:C9   "plain"    <- the name, one level DOWN
```

`findNameNode` scans only DIRECT named children, and a property's name is inside
`variable_declaration` — so the scan found nothing, the positional fallback returned
`binding_pattern_kind`, and **every class-body property in the corpus was anchored on its `val`/`var`
KEYWORD's column**. The line was right, which is why nothing else could see it. java's
declaration-name helper carries exactly this exception (`field_declaration` →
`variable_declarator`); this is the same shape in a different grammar, and the fix is the same
descent. It also fixes the shape that motivated the read in the first place — a
`class_parameter`'s name is a direct child, so `data class HLDiagnostic(val original: …)` was
already anchored at 9 rather than at the `val` on 5, while the identical-looking class-body
`val original: Int` was not.

**Corpus attribution** (`script/m14/lanes/jvm-rulings-ab.mts`, 1,500-file slice, HEAD blob vs the
fixed tree, same engine, one parse per file):

| measurement | HEAD | folded | delta |
| --- | --- | --- | --- |
| symbols / relationships / zero-symbol files | 21,194 / 119,555 / 48 | 21,194 / 119,555 / 48 | **0** |
| per-type (all ten) | — | — | **0 each** |
| constructor symbols / named `constructor` | 1,978 / 0 | 1,978 / 0 | 0 |
| symbol identities that moved | — | — | **0 renames** |
| identities whose ANCHOR moved | — | — | **5,516** (2 line moves, 5,514 column-only) |
| owner-less control | 2,151 | 2,151 | 0 |

The examples are the defect exactly: `importsToAdd|property|HLParameterConversion: [16:10] →
[16:14]`, `kClass|property|FirToKtConversionCreator: [422:13] → [422:23]` — a four-token shift onto
the property name. The 2 LINE moves and the 4 moved relationship-row keys were each adjudicated by
opening the files the harness names for every moved row:

- `compileTimeConstantProvider/…/recursivePropertyReference.kt` — `const val x = <expr>"$y"</expr>`
  parses with an ERROR node spanning into line 2, and the pre-fix scan returned the trailing
  `simple_identifier` at 2:15, a RECOVERED identifier belonging to the next declaration; the
  descent reads the real name at 1:11. One `exports` key moved L2 → L1.
- `compilerFacility/…/codeFragments/{capturing,inlineLambdas}/localFunctionInExplicitBackingField.kt`
  — an explicit backing field (`val prop: List<Int>` then `field: MutableList<Int> = run { … }`)
  was anchored on the PROPERTY's line and is now anchored on the backing field's own line. Three
  `contains`/`exports` keys moved.

## The pin, and the mutants that prove it can fail

[kotlin/declaration-name-anchoring](validation/m14/fixtures/kotlin/declaration-name-anchoring.kt)
now carries four shapes and pins their COLUMNS: a member behind an annotation (`@JvmField` 18,
`flagged` 19 col 9 — it was 5 when the file was first written, and the value CHANGED because the
analyzer did, not because the pin was bent), a member behind a doc comment (`/** doc */` 21,
`documented` 22), a class behind its own annotation (`@Deprecated` 16, class 17), a wrapped class
header (name 25, parameter 26), a class-body PROPERTY (`plain` 42 col 9), a receiver extension
function (`generate` 52 col 26, where the positional walk returned the RECEIVER at 20) and the
secondary constructors' bare `constructor(` line (30, forbidden). K1/K2/K3 below are the proof:

| mutant | verdict | catch |
| --- | --- | --- |
| `K1` ctor back to the literal `constructor` | **DEAD** | `ctor-delegation`, `declaration-name-anchoring`, `secondary-ctor-lines` |
| `K2` drop the `findNameNode` read | **DEAD** | `declaration-name-anchoring` |
| `K3` drop the `variable_declaration` descent | **DEAD** | `declaration-name-anchoring` |

Before this round, K2 SURVIVED the whole kotlin lane — 58 pass / 6 fail, identical to the clean
baseline — so the rule the analyzer documents in prose had no failing pin at all. It has one now,
and the file records both pre-fix columns it replaced.

## What this round does NOT claim

- **The six declared failures are untouched and are a different axis.** `context-parameters`,
  `exports-file-identity`, `exports-no-module-identity`, `exports-published-surface`,
  `exports-visibility` and `imports-exports-ontology` are the lane's own recorded `exports`/
  `imports` defects; §14/§15's "kotlin and scala follow java on the same axis" is false for both
  and is corrected in the branch inventory.
- **The moved-row table is COUNT-based, so compensating movement hides.** Rows that shift between
  two files with equal counts do not appear: the explicit-backing-field movement produced key
  `L7` → gone, `L9` → appeared, and a `L8` key that stayed at 1 by moving from one file to the
  other. The harness now names the file for every moved row, which is how that was seen; it still
  cannot count a swap.
- **No re-measurement of this file's older tables.** The numbers above come from a 1,500-file
  sample of the 82,222-file corpora, and the tables elsewhere in this document were produced by
  other instruments on other samples.

## The exports/imports module identity, ruled and closed (2026-10-11) — the lane is GREEN

The lane entered this round at **58 pass / 6 fail** (the failures named at the end of the M60
section above) and leaves at **64 / 0**. Three of the six were defects the earlier section's
"the lane's own recorded `exports`/`imports` defects" sentence had filed as one axis; they were
not one axis, and the fourth thing the round needed was a ruling the fixtures disagreed about.

**The ruling (owner, 2026-10-11).** A kotlin COMPILATION UNIT has no module object of its own, so
the identity that answers "what does this unit publish" is the file's **first top-level type**.
A file with no top-level type publishes **no `exports` relationship at all** — not one sourced at
the file path (measured: 24 of 26 analyzer-only `exports` edges over a 120-file draw were a
90-character absolute path), not one sourced at a bare basename, and not one sourced at the
package — and it says so in `metadata.exportsWithheldNoModuleIdentity`, which is a **count** when
something was withheld and **absent** when nothing was, because a zero is a claim that the count
was measured to be zero. The `exports[]` ExportInfo array is untouched in both branches: that
array is the surface `import-resolution.ts:314` gates symbol joins on.

**What the fixtures forced, measured rather than assumed.** Two spellings are now emitted from ONE
predicate (`emitKotlinExportRelationships`), so they cannot drift: `Pandora -> Published` (the
unit) and `com.acme.x -> Published` (the package, the join partner of this lane's `imports` rows,
whose source stayed the package because `source + "." + target` has to reconstruct the dotted path
an import names — measured 10,853 of 10,885 `import_header`s sit in a package-bearing file). The
`(file)` + `fileLevel` rows are emitted beside them for a file that HAS an identity, and withheld
with the rest when it does not. This is what the five fixtures together require:
`exports-published-surface` and `imports-exports-ontology` pin the unit source,
`ontology-imports-exports` and `context-parameters` pin the package source, `exports-visibility`
pins the `(file)` source, and `exports-no-module-identity` pins the withheld branch. Two pins were
moved, each with its reason written into the fixture itself:

- [kotlin/exports-file-identity](validation/m14/fixtures/kotlin/exports-file-identity.expectation.json)
  — the basename spelling is withdrawn; the fixture is retargeted to the arm it still uniquely
  covers (a no-type file carrying an import and a private name).
- [kotlin/exports-visibility](validation/m14/fixtures/kotlin/exports-visibility.expectation.json)
  — the package-source FORBID is withdrawn against the store: read back
  (`parallel-indexer.ts:3995-4017`), the defensive filter rejects a lowercase-dotted source only
  where it resolves to a symbol, and a package name resolves to nothing, so the row is stored as
  `source_external` and is readable. A forbid that cannot fire is a false assurance, and two green
  fixtures were contradicting it. The unresolved FILE PATH takes its place.
- [kotlin/imports-exports-ontology](validation/m14/fixtures/kotlin/imports-exports-ontology.expectation.json)
  — its two `imports` rows are re-pinned from the type to the package, for the reason above.

**The three defects, each with the measurement that found it.**

1. A Kotlin 2.2 `context(...)` HEADER is a declaration with no node of its own, so it arrived as a
   `call_expression` and was published as one: `calls[Global -> context]` at 0.7, sourced at a
   symbol no kotlin file declares (28 of the 524 `Global` call edges in a 400-file draw). The
   refusal is the header's ENTIRE SUBTREE, not the node: the dumped tree of
   `context(compute: (Int) -> String)` nests the recovery inside the header and reads the
   parameter name as a call (`call_expression "compute: (Int)"`), so a node-level guard still
   published `calls[Global -> compute]` — a call to a PARAMETER. The header is a sibling of the
   declaration it introduces, never its parent, so refusing the subtree does not swallow that
   declaration's own edges, which the fixture pins beside a real call to a function named
   `context` (`context` is a soft keyword).
2. A local `val` inside a property ACCESSOR body or a LAMBDA literal was published as a `property`
   symbol (measured on `class D { val c=1; init { val a=2 }; fun m() { val b=3 }; val g: Int get()
   { val d=4; return d }; val l = { i -> val e=5; e } }`: `a`, `d` and `e` were symbols, `b` was
   already not). The member rule had excluded such a local from the OWNER, which answered the
   wrong question: an unowned `property` still reaches the index, the export surface and every
   name-keyed lookup as a declaration the file never declares. An `init` block is deliberately
   NOT a body for this rule — its locals are M60 K2's ruling, with its own pins.
3. The wildcard import's metadata carried this lane's `isWildcard` but not the ontology's
   `isWildcardImport`, so the row existed and `imports-exports-ontology` still could not see it.

**Verification at this commit.**

```
bun run script/m14/run-fixtures.ts --lang kotlin   -> all fixtures pass (64 / 0; was 58 / 6)
npx tsc --noEmit                                   -> exit 0
bun run audit:fixture-coverage                     -> kotlin PASS, uncovered=0 ambiguous=0
bun run audit:doc-truth-emissions                  -> no kotlin finding (0 rows named `kotlin`)
```

**The mutants that close the gap (added 2026-10-11).** All three rules now have re-runnable entries
in `script/m14/lanes/jvm-rulings-mutants.mts` — exact-string reverts, run in-process against this
tree's own baseline, with the analyzer restored from memory and its content hash checked before and
after each run:

| mutant | reverts | catch |
| --- | --- | --- |
| `C1` | all three `context(...)` header guards (`return` + both `continue`s) | `context-parameters` |
| `L1` | the local-declaration refusal | `exports-published-surface` |
| `U1` | the unit identity: the withholding guard, the source spelling and the package row, as ONE faithful pre-round shape | `exports-no-module-identity`, `exports-published-surface`, `imports-exports-ontology` |

`L1` is the one this round owed most: `exports-published-surface` was red before the change FOR TWO
INDEPENDENT REASONS, so its green state did not isolate the locals arm — reverting ONLY the locals
refusal, with the unit rows left in place, turns it red again, which is the split the earlier draft
of this note said was owed. `U1` also demonstrates the withholding branch, the unit source and the
package row are separately visible. Verdicts over the whole kotlin set: 0 survivors; the lane's
36-mutant master suite was re-run in the same round and is 36/36 caught, including the repaired
`kotlin/anon-type-claims-file-imports` (its trigger had gone stale — it tested for the retired
`root` placeholder — and it now reattributes IMPORT-DEPENDENCY rows whatever their identity).

**What the pin history shows anyway** — the red state each pin was written against, kept because it
is the reason each row is worded the way it is:

- `context-parameters` was RED before the guard with exactly the two forbid rows quoted above and
  is green after it — the before/after pair is in this round's own run history.
- `exports-no-module-identity` was RED on both its count and its forbid and is green after the
  ruling, the same kind of pair.
- The LOCALS refusal was measured directly (the one-line probe in item 2, which is how the defect
  was found) and is now pinned ALONE by `L1`, rather than by the two-defect red of
  `exports-published-surface`.

# csharp.md

## Language

- Analyzer file: `src/ast/real-csharp-analyzer.ts`
- Parser: the pinned **`wasm/tree-sitter-c_sharp.wasm`** — `sha256 6f69e1cae44e1c32…`, **239 named node types over 533 ids**, resolved at `engine.ts:1189`. **The upstream package version (`v0.23.5`, quoted in the M12.07 notes below) is NOT pinned in this tree**: there is no `tree-sitter-c-sharp` dependency and no version registry, so the artifact digest is the identifier a reader can actually check. The served build's own node-type names are enumerated in `validation/m14/measurements/csharp-grammar-nodes.json`.
- Language detection: extensions **`.cs` and `.csx`** → `language-detection.ts:170` (`cs: "csharp", csx: "csharp"`); both are admitted by the incoming gate (the one extension table, `script/m14/language-extensions.ts`: `csharp: "cs,csx"`)
- Wired in: `engine.ts getAnalyzer` → `RealCSharpAnalyzer`

### Grammar upgrade (M12.07)

The previously wired tree-sitter-c-sharp grammar failed on **primary
constructors** (C# 12: `public class Foo(string name)` parses as ERROR +
tuple noise). tree-sitter-c-sharp **v0.23.5** parses primary constructors
cleanly and is a strict superset of the old surface: all 30 constructs in
the matrix (records, record structs, file-scoped namespaces, required
members, init accessors, switch expressions, nullable types, tuples, local
functions, async methods, operator/conversion overloads, destructors,
nested classes, static classes, generic constraints, delegates, events,
indexers, expression-bodied members, target-typed `new()`, primary ctors)
parse with **0 errors**. Corpus impact: **0/400 roslyn sample files with
grammar errors or missing tokens**.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration`/`struct_declaration`/`interface_declaration`/`record_declaration`/`enum_declaration`/`enum_member_declaration`/`delegate_declaration`/`method_declaration`/`property_declaration`/`field_declaration` → `name` field; constructors normalized to `constructor`; destructors → `Finalize` (Roslyn naming); indexers → `this`; operators → `operator` |

**Correction 2026-09-23.** This table previously listed `record_struct_declaration` as a handled node. It is not a node type in the pinned grammar at all: enumerating `wasm/tree-sitter-c_sharp.wasm` yields 533 node types and no such name (`record_declaration` covers `record class` **and** `record struct`; the two differ by an UNNAMED TOKEN child, `*class("class")` versus `*struct("struct")`). The kind rule had been `stringIncludes(type, "struct")`, which can never be true for `record_declaration`, so `record struct` was published as **Class** until this date — measured, not inferred: `public record struct RS(double X, double Y);` parsed with 0 errors and published `kind=class`, `isStruct=false`. The rule now reads the token (`csharpTypeDeclarationKind`, one definition / two callers), and the same round replaced the dead `constraint_clause` literal with the grammar's real `type_parameter_constraints_clause`. Pinned by `validation/m14/fixtures/csharp/record-struct-kind` and reverted by the mutant `csharp/record-struct-as-class`; both dead spellings are now refused by the F1 dead-literal register, so re-introducing either fails the grammar audit.
| kind | ✅ | class → Class, record → Class (Roslyn: records are classes), struct/record_struct → Struct, interface → Interface, enum → Enum, enum member → EnumMember, delegate → Delegate, event → Event, method → Method, constructor → Constructor, property/field/indexer → Property, record positional params → Property |
| qualified/container name | ✅ | `id` = parent chain + name; `parent` = enclosing symbol name |
| ownerName / ownerKind | ✅ | enclosing type symbol; top-level types owned by their (block or file-scoped) namespace — `namespace Example.Base;` applies to every type declared after it (the type declarations are SIBLINGS of the namespace node, handled via a file-scoped namespace scope) |
| range (start/end line + column) | ✅ | `startPosition`/`endPosition` (1-based lines, 0-based columns — same as Java/Kotlin) |
| parameters | ✅ | `parameter_list` → `parameter` (name + type); delegate params likewise |
| returnType / type | ✅ | `type` field on method/delegate; `extractTypeString` for fields/properties/records |
| documentation/comments | ❌ (not extracted) | non-goal for M12.07 (matching the Java-family fixture contract) |
| complexity metrics | ✅ | cyclomatic on `if`/`for`/`foreach`/`while`/`case`/`catch`/conditional/`&&`/`\|\|`; `complexity` = cyclomatic |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as warning `ParseError` (never silently dropped) |
| decorators/attributes | ✅ | `attribute_list` → attribute names (`[Flags]`, etc.). **The published value is the type's NAME** — a `generic_name` name child is read (it was in no branch before 2026-09-28, so `[Marker<int>]` published nothing) and the type arguments are stripped through `csharpCleanTypeLeaf`, so `[System.Marker<int>]` publishes `System.Marker` and its plain twin `[Marker]` publishes `Marker` (D2) |

## Relationship ontology

> **THE CANONICAL REGISTER — fourteen body rows, in the order of `src/ast/types.ts`.** `Emitted?` is
> not a claim about intent: it is read off the analyzer by grepping `RelationshipType.<X>`, so a
> kind with **0 sites** is not emitted and the row then carries the measurement or ruling that says
> so. A kind that is ruled out names its ruling in the row — **ontological**, **informational** or
> **grammar-side** — with the count behind it, because a ruling without a count is prose. Each
> emitted row cites the analyzer line that publishes it. (This table replaces one that carried 12
> rows — 10 register kinds plus two non-engine labels — and omitted all four extended values; the
> doc-truth gate graded that state `UNDOCUMENTED renders` plus two `NON_ENGINE_KIND` rows. The two
> non-engine labels are kept, with their measurements, immediately below the table rather than as
> rows that state no checkable engine claim.)

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `invocation_expression` → leaf method name (`obj.Method(...)` → `Method`, `Task.FromResult(...)` → `FromResult`); source = enclosing method; **single pass** (no duplicates) · site `real-csharp-analyzer.ts:1986, :2247` | 0.9 |
| extends | ✅ | class base-list FIRST type when it is a known class (in-file declaration, or cross-file via the type-kind companion); interface base-list all types (interfaces extend interfaces) · site `real-csharp-analyzer.ts:1615, :1655` | 1.0 |
| implements | ✅ | class base-list entries that are known interfaces (in-file or companion) plus all entries after the first when unknown (deterministic C# rule: a base class, if any, is listed first; the rest are necessarily interfaces); qualified names resolved by leaf (`BaseService.Entity` → `Entity` in the companion) · site `real-csharp-analyzer.ts:1655` | 1.0 |
| uses | ✅ | two producers: a member read (`member_binding_expression`/field access) at **0.7** (`relationshipType: "csharp_field_access"`, deduped per `source.target`), and the identifier-usage pass at **1.0** (`relationshipType: "identifier_usage"`, deduped per `source::uses::target`). The row read "not emitted — **STALE, see CS-R1**" until 2026-10-16: the cell was itself a M12.07 statement about call-level coverage that the later `uses` work never updated, which is exactly what a reader could not have known · site `real-csharp-analyzer.ts:3373, :4008` | 0.7 field access, 1.0 identifier usage |
| imports | ✅ **on BOTH channels, and the .NET citation claim rides the edge** | a `using_directive` publishes a `RelationshipType.Imports` edge at **1.0** (`metadata.relationshipType: "using_import"`, `importKind`, `isUsingDirective`) **and** a `res.imports[]` entry (`ImportInfo[]`) that `parallel-indexer.ts` writes to the **`brain_import` TABLE**; an `extern_alias` directive publishes the same edge at 1.0 (`relationshipType: "extern_alias_import"`). Both sit beside a `references` edge marked `isImport: true`, at 0.9, which carries R9's normalisation of the dotted path. This row read "separate channel, not a relationship", ending "`RelationshipType.Imports` names the table, not a row type" — the payload half of that is right and the conclusion is not: the table is FILLED from the payload while the edge is emitted alongside it. Corrected 2026-10-16. TASK-37 follow-up 2: a `using` directive whose target falls under a committed `.NET platform libraries` namespace (`dotnet-platform-libraries` vocabulary, seven measured namespaces) also carries `metadata.languageNamespace: [matched roots]` + `metadata.languageNamespacePolicy: "strict-absent"`; no match ⇒ NO marker (fail-closed, unaffected edges byte-identical), extern-alias rows stay unmarked, and `strict-absent` keeps the citation from ever displacing a name-model answer. Pins: `dotnet-citation-claims` (marker on the seven, absent on unlisted `System.Text`/`System`, no empty list, 9-edge count) · site `real-csharp-analyzer.ts:1419, :1461` | 1.0 edge (import, extern alias); 0.9 on the `references` twin |
| exports | ✅ **corrected 2026-10-19 (task-37)** | one edge per exported **top-level public type**: `source = "root"` (the file/assembly root — the namespace qualifies the NAME, it does not own the edge), `target` = the **FULLY-QUALIFIED** name (a namespaced type is imported as `Acme.Surface.PublicType`; the bare leaf is not a name the assembly exports), line = the NAME's own line, `metadata.arity` = generic arity, `metadata.relationshipType: "assembly_public_surface"`. Deduped on **(name, arity)**: a `partial` split is ONE exported unit on the first declaration's line, while a partial split crossing arity stays two units. Classes/structs/interfaces/enums/delegates/records included; a type nested inside another TYPE is not assembly surface; `internal` and `file`-scoped never export; block and file-scoped namespaces select the SAME set; a DOTTED namespace declaration is absolute (one spelling: `Acme.Inner.Doubled`, never doubled); `#if`-guarded top-level declarations are published. `exports` payload (`res.exports[]`) carries `{name, kind, arity, line, visibility}` on the same rule. Pins: `export-arity-collision`, `import-export-edges`, `public-type-exports` (updated to this contract), `export-global-scope`; mutants `export-any-visibility`, `export-nested-types-too`. · site `real-csharp-analyzer.ts:2637` | 1.0, `evidenceClass: structural` |
| contains | ✅ | owner → owned members via `ownerName` (namespace → types, class → members, enum → members) · site `real-csharp-analyzer.ts:2544` | 1.0 |
| references | ✅ | **three families, and the target is a NAME in all of them.** (1) `using_directive` → the module path as written; for an ALIAS whose target is a type, the module is the type's **name** (D3) and each type argument is published as its own `references` edge marked `using_type_argument` / `reference_qualified`. (2) the declared-type graph (R9) — a written type name, a qualified name's **leaf**, and a generic's base **and every argument** (D1). (3) nothing else · site `real-csharp-analyzer.ts:1343, :1380, :2526, :2688` | 0.9 |
| overrides | ✅ | TWO published surfaces. (A) C# `override` members on all FIVE overridable kinds — method / property / indexer (`this`) / field / event — with `metadata.overriddenMemberKind`; multi-declarator fields are TWO members on the shared line; methods resolve the same-signature base overload, the other kinds resolve by name; without context → first hierarchy parent (deterministic per-file default). (B) interface-member implementations (C923): explicit `IFoo.M` always, implicit only where an in-file ancestor interface declares the member (a base class redeclaring it stops that path). Task-37 correction: the historical machinery was METHOD-ONLY, so property/indexer/field/event overrides published no edge; `override-member-kinds` pins all five plus the two non-edges (`virtual`/`new`). · site `real-csharp-analyzer.ts:3181, :3269` | 1.0 for in-file matches, 0.65 for companion matches and 0.5 for first-parent guesses |
| instantiates | ✅ | `object_creation_expression` (`new Foo(...)` → `Foo`) and `implicit_object_creation_expression` (target-typed `new()` — the type is resolved purely from the enclosing `variable_declarator`/`property_declaration` type) · site `real-csharp-analyzer.ts:2338, :2353` | 0.95 |
| decorates | ❌ **not emitted — RULED (ontological)** | `0` `RelationshipType.Decorates` sites in the analyzer (grep). The grammar **has** the construct — `attribute`, `attribute_list` and `attribute_argument` are 3 of the 239 named node types (`validation/m14/measurements/csharp-grammar-nodes.json`) — so this is not a grammar absence: **the reason is ontological.** The relation asserts that a **callable was APPLIED** to a declaration; a C# attribute asserts **passive metadata** (it names a type for reflection) and is published on the **symbol** side as `decorators` (see the symbol contract above), while the fleet publishes annotations as `references{isAnnotation}`. The store could carry the edge; the vocabulary does not credit it. Near miss, measured over the WHOLE admitted population: **52,205 attribute sites over 5,425 files / 20 repos**, of which **609 attribute-argument CALLS over 274 files / 3 repos** (`csharp-emission-census-whole.json`). | — (not emitted); the metadata channel is the symbol's `decorators` |
| renders | ✅ **emitted, corpus-unexercised** | C#'s component-render construct is the **dynamic render host**: an `invocation_expression` whose callee names a host in `CSHARP_RENDER_HOSTS` (`RenderComponent`, `RenderChild`, `real-csharp-analyzer.ts:791`) and whose component is either a **type argument** (`builder.RenderComponent<Widget>()`) or a **`typeof` argument** (`builder.RenderComponent(typeof(OtherWidget))`). Source = the enclosing symbol (`parentContext.rawName \|\| "global"`); target = the component type's cleaned name (`csharpTypeNameText` → `cleanTypeName`), so the component resolves downstream as a NAME like every other target. Sites: `:2285` (type-argument form, line = the type argument) and `:2315` (`typeof` form, line = the type node). Rung **R3**: the EXISTING `invocation_expression` node type carries the construct — no grammar change. **The population is ZERO**: the analyzer emits **0 `renders` edges over the whole admitted population** (the rendering construct itself is Razor's, a different language), and a whole-population census of render-host calls found **298 sites over 85 files, 0 of which name a component** over a four-name superset (`csharp-emission-census-whole.json`). The proof is therefore **behavioural**, not population: fixture `validation/m14/fixtures/csharp/render-host-component.cs` emits the edge only when the construct reaches the analyzer as a real node. | 0.9, `metadata: { isRenderHost: true, renderHost: <host> }` |
| mixes_in | ❌ **not emitted — RULED (grammar-side; the ladder is exhausted)** | `0` `RelationshipType.MixesIn` sites, and **`0` of the 239 named node types** (`csharp-grammar-nodes.json`) is a mixin or composition clause. C#'s only supertype composition is the **base list** — one base (`extends`) plus the interface list (`implements`), both already emitted above — and the contract's defining property is a mixin composed INTO the supertype chain. Rungs, each named: **R1 UNAVAILABLE** (no published grammar carries the construct — 0 of 239, measured); **R2 NOT APPLICABLE** (there is no `with`-style heritage clause to match); **R3 MEASURED and not taken** — the two nearest neighbours are the **extension method** (`parameter` with the `this` modifier, **3,312 sites / 875 files / 10 repos**) and the **record `with` form** (**673 sites: 274 `with_expression` + 399 `with_initializer`**, 88 and 86 files, 3 repos) — and neither is the construct: an extension member is resolved AT THE CALL SITE, never inherited into a supertype chain. Counts from `csharp-emission-census-whole.json`. | — (not emitted) |
| part_of | ❌ **not emitted — RULED (informational)** | `0` `RelationshipType.PartOf` sites. The grammar declares **no `part_*` and no `partial_*` node type** — 0 of the 239 named types (`csharp-grammar-nodes.json`) — and C# has no construct that names ANOTHER compilation unit as a part. The nearest construct is the **`partial` MODIFIER**, which **splits ONE type across declarations that merge into ONE symbol**, so a `part_of` row would read **X → X**: a relation between a type and itself, carrying no information. That is why the label is **informational** rather than grammatical. Measured over the whole population: **1,873 `partial` sites on six declaration kinds** (class 1,198 · method 447 · interface 212 · struct 14 · property 1 · constructor 1) with **300 types split across more than one file, over 1,067 files** (`csharp-emission-census-whole.json`). | — (not emitted) |

**TWO NON-ENGINE LABELS THE TABLE USED TO CARRY — KEPT WITH THEIR MEASUREMENTS.** `src/ast/types.ts`
defines the fourteen kinds above and neither of these is one of them, so a row for either states no
checkable engine claim. Their content is not deleted:

- **`depends`** — the analyzer emits **no** `depends` edge (0 `RelationshipType.Depends` sites). On
  lanes that have it, the label is a rendering of `imports → References`.
- **`field_access`** — **not emitted as its own kind.** A member read is published as a **`uses`**
  edge at 0.7 carrying `metadata.relationshipType: "csharp_field_access"`, i.e. a marker on the
  `uses` row above, not a fifteenth kind. Whole-population: **203,825** `uses | csharp_field_access`
  edges (`csharp-emission-census-whole.json`).

**WHERE THE MEASURED PER-TYPE VERDICTS LIVE.** The whole-population closure behind these rows is
`validation/m14/measurements/csharp-emission-census-whole.json` (14,424 parsed of 14,424, 22 repos)
and the lane's declaration `validation/m14/instruments/csharp/incoming-declaration.json`; the
whole-inventory node census that makes the three "0 emissions" rulings grammar-side rather than
assertions is `validation/m14/measurements/csharp-grammar-nodes.json` (239 named node types over 533
ids, pinned to the served build's digest).

## Supported constructs

- Cross-file inheritance + override resolution: `class UserService : BaseService<User>, IRepository<User>` → clean extends/implements; `override string Format` → `BaseService.Format` via companion — `UserService.cs`
- Abstract base class with virtual members + nested interface `Entity` (`public interface Entity` inside `BaseService`) — `BaseService.cs`
- Interface declaration with generic constraint (`where T : BaseService.Entity`) — `Repository.cs`
- File-scoped namespaces (`namespace Example.Base;`) — every type owned by the namespace
- Records (`record Point(int X, int Y)`) → class + positional-param properties; record structs (`record struct Vector2`) → struct + properties — `Features.cs`. **Corrected 2026-09-23:** the record-struct half of this sentence was FALSE at the time it was written (see the correction above the symbol contract): a `record struct` published `kind=class`, `isStruct=false`, `isValueType=false`. It is true as of this date, and it is now measured on real code rather than on the construct list — a scoped reading over 150 roslyn files found 119 record declarations (116 record struct / 3 record class) with 116/116 record structs published as struct and 0 as class (`script/m14/tmp/cs-record-struct-corpus-reading.ts`). Neither of this lane's two pinned corpora contains a `record struct`, which is why five depth draws and every canonical draw missed the defect.
- Enums with `[Flags]`, members, and explicit values — `Features.cs`
- Delegates (`public delegate bool Filter(Shape s)`) and events (`event EventHandler<EventArgs>? Changed`) — `Features.cs`
- Indexers (`this[int index]`), operator overloads (`operator +`), conversion operators (`implicit operator string`) — `Features.cs`
- In-file base-kind resolution: `class Shape : BaseShape, IShape, IComparable<Shape>` → extends BaseShape (class), implements IShape (interface), implements IComparable (position > 0 deterministic) — `Features.cs`
- Extension methods (`this IEnumerable<Shape> source`) and static classes — `Features.cs`
- Primary constructors (C# 12: `class PrimaryCtor(string name)`) — `Features.cs`
- Negative fixture (`Negative.cs`): locals (`int localA`, `var localB`) are NOT symbols; parameters are NOT symbols; lambda params (`x => x * 2`) are NOT symbols; accessors are NOT scopes; `Console.WriteLine`/`Write`/`WriteAsync`, `ToString`/`GetHashCode`/`Equals`/`GetType` are filtered builtins; `new List<int>` and target-typed `new()` DO emit instantiates; `Select`/`Count`/`Add` ARE calls (positive controls).

## Unsupported / explicit-unknown constructs

- **Target-typed `new()`**: the type is resolved from the enclosing variable/property declaration (pure AST). If no declaration type is available (e.g., a field initializer without a visible declarator type), no instantiates edge is emitted — documented.
- **Cross-file base-kind resolution**: resolved via the shared type-kind companion (`context.typeKinds`, built by the harness pre-pass from the cross-file symbol space — same machinery as the override companion, wired via M12.44). Without context, unknown external base types follow the deterministic C# rule: first base = extends, rest = implements. A single *external* interface base (`class C : IExternalInterface`) therefore classifies as extends without context — the honest per-file default, documented.
- **Compiler-generated members** (record `ToString`/`Equals`/`GetHashCode`, enum ordinal, `Deconstruct`): not materialized as symbols; the declared class + properties are extracted. Documented non-goal.
- **Property accessors**: `get`/`set`/`init` accessors are detected for metadata (`hasGet`/`hasSet`/`hasInit`/`isAutoProperty`) but are NOT symbols or scopes — pure AST contract (the old analyzer pushed accessor scopes, creating noise).
- **`uses` — CORRECTED 2026-11-03: this bullet used to say `uses` was not emitted and that property reads were "covered at call level". Both halves are stale.** `uses` IS emitted (see the register row) by two producers — a member read at 0.7 marked `csharp_field_access`, and the bare-identifier pass at 1.0 marked `identifier_usage`. What remains true, and is all this bullet should have claimed, is that a *separate* `field_access` **kind** is not materialized: the member read rides the `uses` edge with that marker instead.

## Regex inventory

The shared census `validation/m12/results/regex-census.json` records **`totalRegexUsages: 0`** with
`methodology: parse analyzer source with tree-sitter; walk for regex literal nodes and RegExp
constructors`. **CORRECTED 2026-11-03: that file carries NO per-analyzer entries at all** — this
section used to say "entries for this analyzer", which was never true of the file — so the census
supports the lane-level total, not a csharp-specific claim.

**The load-bearing evidence is the lane's own three-layer gate, which is about THIS analyzer:**
`script/m14/verify-csharp-no-regex.ts`. **0 usages** — the C# analyzer is fully regex-free; the
previous analyzer had 1 regex (`replace(/"/g, "")` in Minimal API detection), eliminated by the
rewrite with pure string operations.

## aspnetcore, exhaustively — and the last known coverage defect, finally located

`--sample 100000` over the whole corpus: **10,667 files** (the sample pool implies ~4,002, so every
earlier estimate of this corpus was wrong), 631,892 truth edges, 631,888 covered — **100%**,
**MISSING=4**, unexplained 67.

| label | unexplained |
| --- | --- |
| references | 45 |
| uses | 15 |
| contains | 3 |
| instantiates | 2 |
| extends | 2 |

**All four MISSING rows are `instantiates → string`, and they are a real analyzer gap.** The shape is
a **target-typed `new()` inside a collection expression assigned to a property**:

    typeInfo.ValidateAsync(new CollectionSiblingRoot { Items = [new() { Name = null }, …] })
                                                            ^^^^^^ element type inferred as `string`

`new string(...)` reconciles fine in isolation — the minimal case passes on both sides — so the gap is
not about `string`. It is that the implicit-`new` type resolution here runs through a **property
declarator inside a collection expression**, and the analyzer does not resolve that path while the
oracle does. It is the analyzer-side counterpart of the collection-expression problem fixed on the
oracle side as CS-D12, which is consistent rather than coincidental: that round established the
collection expression is a shape the two sides walked differently.

**Four attempts to reproduce it minimally all reconcile**, which is worth recording because it says
the shape above is *not* sufficient to trigger it:

| minimal case | analyzer | oracle |
| --- | --- | --- |
| `new Root { Items = [new() { … }] }`, `Item[]` property | `Item`, `Root` | `Item`, `Root` |
| `new Root { Items = [new()] }`, `string[]` property | `Root`, `string` | `Root`, `string` |
| `Item[] xs = [new()]` (local) | `Item` | `Item` |
| `private Item[] _xs = [new()]` (field) | `Item` | `Item` |

The resolution path itself handles the shape: `csharpTargetTypedNewSite` does return
`{kind:"assignment", memberName}` for an initialiser assignment, and `csharpResolveTargetTypedNew`
falls through to `memberTypes.get(memberName)` for every kind except `declaration`. So the site
resolver is not the gap, and the remaining difference is something in the real file that none of these
four captures.

**Not fixed, and honestly so.** Four edges in 631,892 is 0.0006%. It is named, located to a file,
characterised as a target-typed `new()` in an object initialiser, and shown *not* to be reproduced by
four plausible minimal shapes. Closing it needs the actual file and a bisect, not another guess from
the census row — and the census row is one line long while the file is 400 lines.

## Where this lane stands — 2026-09-29, end of round

### Gates, all green

| gate | result |
| --- | --- |
| F1 grammar coverage | `PASS` refs=106 unknown=0 unknownFields=0 |
| F3 fixtures | **18 / 18** |
| F4 mutants | **58 / 58 caught** |
| F5 differential | 4 corpora at **100%**, `MISSING=0` (see the census table) |
| `verify-csharp-line-numbers` | **PASS** — 18,091 relationships, 0 out of bounds |
| `verify-csharp-symbols` | **PASS** — 2,692 symbols, 0 defects over 5 properties |
| `verify-csharp-no-regex` | **PASS** — 0 literals, **0 runtime `RegExp` constructions** |
| `verify-csharp-overrides-symmetry` | **PASS** |
| `verify-csharp-oracle-regressions` | **PASS** |
| `verify-oracle-coverage` | **PASS** |
| harness typecheck | csharp **0 errors** (gate red on four *other* lanes) |

### Eight defects, seven of them in the truth

**In every case the analyzer was right and the oracle was silent, incomplete or wrong.** F3 asserts
what the analyzer emits, so a perfect analyzer passes every fixture while the oracle judging it lies —
no fixture can find an oracle defect, and all seven were invisible to F3 by construction.

### Line numbers: done, re-verified after every change this round

200 roslyn files, **18,091 relationships, 0 out of bounds, 0 non-integer.** The 61 null lines are all
`owner → constructor` and are *correct*: `constructor` and `Finalize` are synthesized names the file
never writes, so no line exists for them. The gate asserts the boundary — a null line is legal only
for a synthesized name, and a null line on a written name is a defect — and pins the exact case in
`csharp/callsite-lines-825`.

### Regex: proven, not asserted

Three layers: the source is **parsed** (so `/a\/b/` and `a / b / c` cannot be confused), `RegExp` is
replaced with a recording subclass before the analyzer loads and runs, and the shipped file is hashed
against the working copy. The runtime layer is the one that matters — a pattern assembled from an
array or a variable still has to *construct* a RegExp, and the count is **0**. Proved by replay: a
pattern joined from array parts, invisible to grep and to the source scan, produced 20 constructions.

### Relationship labels: compared set widened 4 → 7

The oracle derives eight; the compared set had four, so half the labels were computed and checked by
nothing. All three added labels measured 100% under the harness's own matcher before being added.
`overrides` remains excluded on **both** sides under C923, gated by a symmetry check that fails on
either half desyncing — because that pair is what silently desynced once already.

### Performance: flat per file, super-linear per depth

Per-file cost is flat (29–39 ms from 50 to 400 files). Per **nesting depth** it is not: cost rises
**363×** for 32× depth at constant symbol count, and the mechanism is long ancestor walks. One of the
five offending predicates is fixed (2.06× at depth 128, output unchanged); four remain, named, with
measured headroom. The depth sweep is a reusable instrument, not a one-off — it is the only thing in
the lane that varies an axis other than file count, and that is why nothing else caught this.

### Open, named rather than closed

1. **aspnetcore `MISSING=4`** — 0.0006% of 631,892 edges. Located to a file; four minimal
   reproductions all reconcile, so the shape is not yet pinned.
2. **Four more depth predicates** — `isCSharpNamePosition`, `isCSharpPreprocText`,
   `findContainingCSharpFunction`, one inline type-constraint check. A memoisation of the third was
   attempted, proved wrong on 2,854 of 48,645 nodes, and reverted.
3. **powershell not re-verified exhaustively** after CS-D13.
4. **Target resolution** — 95.6% floor. A census, not a gate, because this repo has no external
   surface to resolve a framework member against and a gate that cries wolf on `ThrowIfCancellationRequested`
   gets bypassed. **A BCL + attribute + keyword list is the single artifact that would make it real.**
5. **Section A of completeness** fails in five lanes on `ERROR`/`MISSING` — a shared-schema gap; csharp's
   own inventory is 241 types with **0 gaps**.
6. **main is diverged**, and needs a human merge decision.

## Field-level gates (2026-09-29)

Every other gate in this lane asks whether a relationship or a symbol EXISTS with the
right label, target and name. None of them ask whether the *fields* of that row are
right. Those are the fields a consumer is most likely to use, and being wrong there
fails at the point of use rather than in CI, so each now has a gate that asserts
properties rather than counts.

### Line numbers — `verify-csharp-line-numbers.ts`

200 roslyn files, **18,091 relationships, 0 out of bounds, 0 non-integer**:

| label | n | null line |
| --- | --- | --- |
| references | 5,339 | 0 |
| calls | 5,123 | 0 |
| uses | 4,438 | 0 |
| contains | 2,492 | 61 |
| instantiates | 329 | 0 |
| overrides | 228 | 0 |
| extends | 124 | 0 |
| implements | 18 | 0 |

The 61 nulls are all `owner -> constructor`, and they are **correct**.
`constructor` for a primary constructor and `Finalize` for a destructor are names
the analyzer synthesises: the file writes `Widget()` and `~Widget()`, so no line
can be the site of the string. `csharp/callsite-lines-825` pins exactly that.

This was worth getting right, because the first response to "61 rows have no
line" was to add a fallback to the owner's declaration line — and the fixture
failed, correctly. Publishing the class's line for a member name that appears
nowhere on it is the same defect M59.A7 fixed (the range-start stamp claimed a
line the target was not written on for 653 of 23,924 relationships). So the gate
asserts the *boundary* instead: a null line is permitted only for a synthesised
name, and a null line on a name the file does write is a defect.

### Symbol surface — `verify-csharp-symbols.ts`

200 files, **2,692 symbols, 0 defects** across five properties:

- the range lies inside the file (bytes and lines)
- the range is ordered — `start <= end` on both axes
- the name is non-empty, so nothing can name it in a relationship
- the `ownerName` names a symbol in the same file
- the name is actually **written** at its own range, except for synthesised names

The owner assertion is the valuable one and the reason this is a separate gate.
`contains` is derived *from* `ownerName`, so a symbol with the right name, the
right kind and the wrong owner is invisible to F1 (name uniqueness) and F6 (node
coverage) — and it does not corrupt one row, it fabricates an entire class of
them downstream. Replaying a single corrupted `ownerName` produces 63 dangling
owners, and 63 fabricated `contains` edges, from a one-token change.

Kind *precision* is deliberately not asserted: `property` versus `field` is a
modelling choice with defensible answers, and so is whether a nested type's owner
is the outer type or the namespace. A gate that picked one would be enforcing a
preference rather than a property.

### Oracle wiring — `verify-oracle-coverage.ts`, `verify-csharp-oracle-regressions.ts`

Two gates for the derivations rather than the analyzer, because F3 is structurally
blind to them: a fixture asserts what the analyzer emits, so a perfect analyzer
passes every fixture while the oracle judging it lies.

- `verify-oracle-coverage.ts` checks that every compared label has an oracle and
  every lane with an oracle has a compared set. It is a BASELINE gate, and it
  catches a class of damage nothing else saw: csharp's compared set silently
  reduced from four labels to two while F3, F4, F1, F6 and SPEC all stayed green,
  because the compared set is a local expression in `differential.ts` and is not
  exported.
- `verify-csharp-oracle-regressions.ts` pins CS-D9 and CS-D10b in a 25-line file
  and derives it in **1.2 seconds**, against the ~10 minutes of corpus rotation
  that found them.

## Complexity envelope

> **SCOPED, not simply restored — see the depth section below.** An earlier version of this section
> said "no O(n²) or per-symbol O(n) scans" and cited a M12 table. This round WITHDREW that as
> unsupported, because three identical runs reported per-symbol drift of 49%, 91% and 54%. The
> withdrawal was right to be cautious and WRONG in its conclusion — the metric was confounded, and
> the analyzer's per-file cost turns out to be flat. Both halves of that are worth keeping.

**The finding: per-FILE cost is flat. Per-SYMBOL was the wrong axis.**

Every earlier figure divided by symbols, and the pinned prefix is not size-sorted, so symbols per
file falls steadily as the sample grows. Dividing a constant cost by a shrinking denominator
manufactures a rising curve. Here is the same run on both axes, `min over 5 runs`, three times:

| files | syms/file | parse ms/file | analyze ms/file | analyze µs/sym |
| --- | --- | --- | --- | --- |
| 50 | 4.46 | 3.63 / 3.99 / 3.92 | **36.82 / 38.35 / 30.29** | 8,255 |
| 100 | 3.72 | 4.33 / 4.67 / 3.62 | 35.39 / 39.24 / 35.14 | 9,514 |
| 200 | 3.37 | 3.34 / 3.52 / 3.50 | 38.47 / 32.31 / 33.20 | 11,433 |
| 400 | 2.79 | 4.35 / 3.41 / 3.69 | **36.03 / 29.13 / 30.06** | 12,927 |

**Eight times the work, the same milliseconds per file.** Every analyze figure across every size and
every run lies between 29 and 39 ms, with no trend; the per-symbol column rises from 8.3 ms to 12.9 ms
purely because the denominator fell from 4.46 to 2.79 symbols per file. The "super-linear term" was
an artifact of the axis, reproducible on a host at load 5.7 precisely because it had nothing to do
with the host.

**Parse and analyze are timed separately** (`cs-deep-67`), which nobody had done — every prior number
came from `ASTEngine.parseFile`, which bundles a fixed-size wasm heap that JS GC cannot reclaim with
the analyzer's own passes. The separation mattered: had it shown the drift in parse, the analyzer's
claim would have survived untouched and the engine's heap would be the story. Both are flat.

**So on the FILE axis the claim stands, and the structural argument behind it does:**

- single-pass iterative traversal (explicit stack, no recursion depth risk)
- `symbolMap` for O(1) owner/name lookup — owner resolution is a Map lookup, not a scan
- a Map lookup per base type for the type-kind companion
- `findDeclaringParent` BFS over the (tiny) class hierarchy
- relationship emission is therefore O(edges), not O(symbols × names); the bare-identifier pass, the
  only place that sees every name in a file, is one Map lookup per reference

…and **on the DEPTH axis it does not hold**, which the sweep below measures directly.

## Nesting depth — a REAL super-linear term, found by synthesising the axis

The depth sweep above was the gap this section used to admit to, and running it changed the answer.

`--sample` cannot see depth at all: a file's nesting does not change when the sample grows, so no
number of real files will ever expose cost that grows with depth. And real corpora cannot supply
the axis either — roslyn's deepest nesting is in the low tens, so any quadratic with a small
constant stays inside the noise forever. The only way to see the shape is to **synthesise files of
known depth and hold symbol count constant**, so per-symbol cost is comparable and depth is the only
variable (`cs-deep-68`).

| depth | symbols | min ms | µs/symbol | × vs shallowest |
| --- | --- | --- | --- | --- |
| 4 | 3 | 0.73 | 734 | 1.00× |
| 8 | 3 | 1.89 | 1,889 | 2.58× |
| 16 | 3 | 3.98 | 3,981 | 5.43× |
| 32 | 3 | 13.64 | 13,637 | 18.59× |
| 64 | 3 | 38.66 | 38,657 | 52.69× |
| 128 | 3 | 266.37 | 266,369 | **363.08×** |

**Symbol count is constant at 3 across a 32× increase in depth.** Per-symbol cost rises 363×. Deep
CLASS nesting over the same range is fine (1.00× → 8.22× for 32× depth, and symbols grow with depth
there, so per-symbol is flatter still). The defect is specific to nested **blocks** — the shape that
exercises the bare-identifier and shadowing paths rather than the scope stack.

Separated from the parser, because the two have opposite consequences:

| depth | parse ms | analyze ms | analyze/parse |
| --- | --- | --- | --- |
| 8 | 1.06 | 8.95 | 8.4× |
| 32 | 3.16 | 29.62 | 9.4× |
| 64 | 3.75 | **102.60** | **27.4×** |

Parse stays flat; **the analyzer does not**. The 32→64 step is 3.46× for 2× depth, which is
super-linear.

**The mechanism is LONG WALKS, and getting that wrong took two attempts worth recording.**

The first write-up of this section claimed a "call-count explosion, not a long walk", on the
evidence that thirteen per-node climb loops showed equal invocation and iteration counts. **That
evidence was an instrumentation artifact**: both counters were incremented on the same line inside
the loop body, so they were equal by construction and the "no walk is long" inference was worthless.
Re-instrumented correctly — invocations counted *before* the loop, iterations *inside* it:

| depth | nodes | loop invocations | loop iterations | iterations per invocation |
| --- | --- | --- | --- | --- |
| 16 | 108 | 123 | 965 | 7.8 |
| 64 | 348 | 363 | 9,605 | **26.5** |

The opposite of what was claimed. Invocations grow slowly (123 → 363, roughly with node count), and
each one walks **deeper** as depth grows — 7.8 ancestors at depth 16, 26.5 at depth 64. Total
iterations therefore go 965 → 9,605, which is **O(nodes × depth) = O(depth²)** and matches the 363×
per-symbol cost measured on the depth axis.

No single site dominates the invocations: `isImportName`, `isCSharpQualifiedNamePart` and three
others sit at 19–20% each, and the rest under 2%. So this is not one bad predicate but a family of
ancestor-ascending predicates — `isImportName` alone walks the whole chain to the root for every
identifier it is asked about, on a file with no `using` directive at all.

**What this points at, stated as a direction rather than a fix.** Every one of these predicates
answers "is there an ancestor of kind X?", which is a pure function of the ancestor chain and is
identical for a whole subtree. Recomputing it per node recomputes the same answer O(depth) times.
The direction is to answer it once per subtree — carry the answer down during the walk, or memoise
per node — and the win would be largest for the predicates that climb to the root unconditionally
rather than stopping early.

### One of the five is fixed: `isImportName`

`isImportName` asked "is any ancestor a `using_directive`?" by walking to the top of the tree —
unconditionally, for every identifier that reached it, and on files with **no import anywhere**. The
powershell corpus is exactly such a file, so the walk ran to the root every time and found nothing.

`using_directive` and `extern_alias_directive` are always direct children of `compilation_unit`, so
the question is answerable from a span table computed once per file: *p* is inside a using directive
exactly when its extent falls within that directive's. That is equivalence to the ancestor walk, not
an approximation of it.

| depth | before | after | |
| --- | --- | --- | --- |
| 64 | 38.66 ms (52.69×) | **25.39 ms (32.14×)** | 1.52× faster |
| 128 | 266.37 ms (363.08×) | **129.40 ms (163.78×)** | 2.06× faster |

Output unchanged: F3 18/18, F4 58/58, oracle regressions PASS, no-regex PASS.

**Still super-linear, and not claimed otherwise.** 164× for 32× depth is between linear and quadratic,
and four more predicates measured 19–20% of invocations each. This is the first of five, not the fix
for the class. The remaining headroom is real and now *measured* rather than guessed, which is the
useful change: the depth sweep is a gate-shaped instrument that turns "cost grows with depth" into a
number with a named cause.

### A second attempt at `findContainingCSharpFunction` — reverted, and why that is the right call

The next candidate by invocation share (~19%) is `findContainingCSharpFunction`, which answers "what
is my nearest enclosing method/constructor/destructor?" by walking to the root, once per identifier.
Memoising it with path compression is the textbook fix: on a miss, walk up remembering the path until
a cached node is reached, then write the answer for every node on the path.

**It was implemented, proved wrong, and reverted.** A checker compared the memoised result against
the raw walk for every node in 60 real roslyn files: **2,854 disagreements out of 48,645 nodes.**

The bug is instructive and specific. The raw walk examines `node.parent` upward. The compressed
version called the raw walk on `node.parent` — which examines `node.parent.parent` upward, silently
**skipping the node's own parent**. A node directly inside a method therefore got `null` where the
walk said `constructor`.

What makes this worth recording rather than just fixing quietly: `findContainingCSharpFunction`
supplies the **owner** for relationships derived from expressions. A cache that returns the wrong
owner does not crash, does not fail a fixture, and does not change a coverage number — it silently
relabels every edge inside the affected subtree, which is precisely the defect class this round spent
eight fixes removing. A near-miss here would have been invisible to every gate in the lane.

The correct version caches only nodes **strictly below** the resolver and never the resolver itself,
and it must be verified node-for-node against the walk before it lands — the same standard applied to
`blocked_by=[…]` and to the retraction of the "call-count explosion" claim. Not landed here.

**Still not fixed, and the rest of the line is still not named.** What is established: the axis (depth), the
shape (O(nodes × depth)), the family (ancestor-ascending predicates, none dominant), and that the
first localisation attempt was wrong because of where its counters were placed.

**So the linearity claim, restored an hour ago on the strength of flat per-file cost, is too strong
as written and is now scoped correctly: the analyzer is flat per file, and super-linear per unit of
nesting depth.** That is a real defect and it is open. It does not affect any corpus measurement —
roslyn's real depth never approaches where it bites — which is precisely why it survived every gate
in this lane and why no amount of corpus work would have found it.



Declared budget: fixtures < 2 s; 400-file corpus < 60 s. Observed at 400 files: ~30–39 ms/file
analyze plus ~3.5 ms/file parse, i.e. ~14–17 s for the corpus, inside budget with room.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/csharp.json` (authority: `manual_audit`)
- Result: `validation/m12/results/csharp-differential.json`
- **WHAT THE COMMITTED ARTIFACT ACTUALLY SAYS — CORRECTED 2026-11-03.** This section used to read
  `1.000 / 1.000 / 0 / 0 / 0 — 166/166 facts`. The artifact does not say that. It records
  **`passed: false`**: expected 166, true positives **162**, **false positives 42**, **false
  negatives 4**, precision **0.794**, recall **0.976**, unknown 0, unsupported 0, and
  `earliestFailingLayer: "ast_extraction"`.
- **AND THAT ARTIFACT PREDATES THIS LANE'S OWN FIXES**, which is how the clean reading was
  believed: its minimized failure is `sym:Features.cs:25:class:Vector2` **expected `class`, observed
  `struct`** — the `record struct` defect this page records as fixed on 2026-09-23 (see the symbol
  contract's correction) — and two of the four false negatives are `operator` / `implicit string`
  name normalisations from the same era. The 42 false positives are `references` to framework names
  (`List`, `Task`, `EventArgs`, `IEnumerable`) and field/property `uses` rows the ground truth does
  not carry.
- **SO THE POST-FIX DIFFERENTIAL IS UNKNOWN HERE, NOT CLEAN.** No regenerated result for this lane
  exists in the tree as of this date. The `1.000` claim is WITHDRAWN; re-running the differential at
  the pinned fixtures is what would restore it, and this page does not claim it until then.

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `roslyn@73241b4b` (clean repo, **17,137**
  committed `.cs` files); sample list `validation/m12/results/csharp-corpus-sample.txt` (400 paths,
  deterministic first-400 sorted).
- **WHAT THE COMMITTED ARTIFACT SAYS — CORRECTED 2026-11-03.**
  `validation/m12/results/csharp-corpus-errors.json` (`revision 73241b4b…`) records **400 measured
  files, 390 clean, 10 with grammar errors (2.5 %), 5 with missing nodes, 8 with ERROR nodes, 0
  crashes, `passed: false`**, and **8 missing tokens over 5 token types** (`#endif` 2, `!` 2, `)` 2,
  `>` 1, `:` 1). This section used to end `400 / 4,451 / 17,563 / 0 grammar errors … 0 missing
  tokens`, which that artifact contradicts on both counts. Its `mode: "recorded-m12-sample"` says
  why: **it is the PRE-upgrade record.**
- **THE POST-UPGRADE CLAIM IS UNVERIFIED.** The `### Grammar upgrade (M12.07)` section asserts the
  v0.23.5 grammar parses the 30-construct matrix with 0 errors and that **0/400** roslyn files carry
  grammar errors or missing tokens. **No committed artifact in this tree carries that
  re-measurement**, so it is recorded as the round's claim, not as an artifact-backed measurement.
  What would verify it: re-run the corpus-errors probe at the same revision and sample list, and
  commit the result.
- The **symbol / relationship counts** this section used to carry (**4,451 / 17,563**) are **not in
  that artifact either** — it carries file and error counts only — so they are likewise the round's
  record and are marked unverified here rather than repeated as measured.

## Section A of the completeness gate fails on a CROSS-LANE schema gap, not a csharp defect

`completeness-inventory.ts --lang csharp` reports:

    csharp COMPLETENESS FAIL: 2 node type(s) in NO bucket: ERROR, MISSING
    FAIL  section-a-structural  241 types, 51 handled, 164 silent, 0 gaps, 14 decisions

The two unclassified types are **`ERROR` and `MISSING`** — tree-sitter's two universal
parse-failure node types. They are not C# constructs. There is no source construct they
correspond to, so no handler can be written for them, and putting them in `internal_silent`
("correctly emitting nothing") would be a lie of a different kind: that bucket means a construct
was recognised and deliberately produced no edge, whereas these mean the parser never produced a
construct at all.

**This is not csharp-specific, and that is the finding.** The same two types are unclassified in
every tree-sitter lane that has run the gate:

| lane | unclassified |
| --- | --- |
| csharp | `ERROR`, `MISSING` |
| zig | `ERROR`, `MISSING` |
| go | `ERROR`, `MISSING` |
| rust | `ERROR`, `MISSING` |
| python | `ERROR`, `MISSING` |

Every tree-sitter grammar emits these two node types and no per-language
`spec/<lang>-completeness.json` classifies them, because the schema has four buckets
(`handled_verified`, `internal_silent`, `gap`, `design_decision`) and a node type that means
"the parse failed" fits none of them. Section A therefore cannot pass for any tree-sitter lane,
and the FAIL says nothing about how complete any analyzer is.

**A second, separable one-directional gate — found here because csharp's own gap was an instance of
it.** `verify-oracle-coverage.ts` asserts *compared label implies an oracle exists*. It does not
assert the converse, and so it cannot see a lane that derives truth and compares none of it. Two
independent instances of exactly that:

- **csharp**, until this round: 8 labels derived, 4 compared. Fixed by widening to 7.
- **json**: `deriveJsonEdges` is wired and invoked (differential.ts:20293-20304), and json has **no
  entry in `oracle-coverage-baseline.json` and no compared set at all** — so its truth is computed
  on every run and checked by nothing. The gate is silent on it, correctly by its own rule and
  uselessly in practice.

The converse rule is cheap and would have caught both: a lane that pushes an oracle and has an empty
compared set should be reported, exactly as a compared label with no oracle is. Not added here
because the gate is shared infrastructure three agents are editing, and adding a rule to a gate
changes what "green" means for every lane at once — that is a decision for whoever owns the
completeness system, made once, deliberately. It is recorded here because the evidence for it is
now two-for-two and it is the same failure the honesty system exists to prevent: a number computed
at real cost that no one ever checks.

**The fix is a fifth bucket, and it belongs to the completeness system rather than to any lane.**
Something like `parser_recovery`: types that are not constructs, require no handler, and are
counted and surfaced rather than classified. That keeps the gate's own rule — silence is guilt —
intact, because the types stop being silently absent. It is not applied here because the schema
and the gate are shared infrastructure that other agents are editing, and a cross-lane schema
change landed blind from one lane is how two lanes end up disagreeing about what a bucket means.

Until then: csharp's section A failure is a known cross-lane blocker, and csharp's own inventory
is otherwise complete at 241 types with **0 gaps** — the thing section A exists to detect.

## Differential coverage — all four C# corpora, 2026-09-29

Under the **widened seven-label compared set** (`calls, contains, references, uses, extends,
implements, instantiates`), 120 files per corpus:

| corpus | files | tree-truth | covered | | MISSING | unexplained |
| --- | --- | --- | --- | --- | --- | --- |
| roslyn | 120 | 31,489 | 31,489 | 100% | 0 | 0 |
| aspnetcore | 120 | 6,515 | 6,515 | 100% | 0 | 0 |
| powershell | 120 | 21,994 | 21,994 | 100% | 0 | 3 |
| fsharp | 120 | 16,194 | 16,194 | 100% | 0 | 0 |
| **total** | **480** | **76,192** | **76,192** | **100%** | **0** | **3** |

Two things in that table are worth more than the 100%.

**The compared set was four labels while the oracle derived eight.** `extends`, `implements` and
`instantiates` were pushed into truth and then dropped at comparison time by the allowlist, so
every number published before 2026-09-29 — including the ones this doc used to carry — was silent
about half the labels. The effect of closing it is visible in the powershell row: truth rose from
16,371 to 21,994 edges while coverage stayed at 100%, because the extra rows are real and are now
being checked rather than merely computed. `unexplained` on powershell fell 18 → 3 and on fsharp
8 → 0 for the same reason: rows that had nothing to match against now have one. `overrides` stays
excluded on both sides under C923 with independent evidence.

**These are probe runs, so they wrote no artifact.** F5 deliberately refuses to write
`M14.0.F5.json` for anything but the canonical 20-file, 40-lane run, and that is correct — a
number that overwrote the canonical artifact on every measurement would stop being evidence. So
the table above is the only place these figures live, and the canonical artifact is still older
than this round for that reason rather than by oversight.

**The unexplained powershell edges ARE adjudicated — CS-D11, and it is the ORACLE that is wrong.**

A per-label breakdown of `unexplained` (added to `differential.ts` this round, report-only and
appended only when the total is non-zero, so a clean lane's line is byte-identical to before) put
every one of them on `uses` and nothing else. `BB_F5_SHOW_SAMPLES=1` then named them:

    uses Date                    -> DateAndUFormatParameterSet              GetDateCommand.cs:28
    uses Date                    -> DateAndUFormatParameterSet              GetDateCommand.cs:57
    uses UnixTimeSeconds         -> UnixTimeSecondsAndUFormatParameterSet  GetDateCommand.cs:58
    uses UnixTimeSeconds         -> MinimumUnixTimeSecond                   GetDateCommand.cs:58
    uses UnixTimeSeconds         -> MaximumUnixTimeSecond                   GetDateCommand.cs:58
    uses LiteralName             -> LiteralNameParameterSet                 Navigation.cs:1508
    uses GetComputerInfoCommand  -> localMachineName                        GetComputerInfoCommand.cs:86

Every target is a **real `const` declared in the same file** — `private const string
DateAndUFormatParameterSet` and friends at GetDateCommand.cs:572, `private const string
localMachineName = null` at GetComputerInfoCommand.cs:82. The edges resolve and are
semantically correct reads. The analyzer is right; the TRUTH is incomplete.

Minimal reproduction, and it took four attempts because the first three were too easy:

| case | analyzer | oracle |
| --- | --- | --- |
| attribute on a **method**, const declared before | `Early`, `Low2` | `Early`, `Low2` |
| attribute on a **method**, const declared after | `Late`, `Low` | `Late`, `Low` |
| attribute on a **property**, `Name = value` | `Later` | *(nothing)* |
| attribute on a **property**, positional argument | `Low` | *(nothing)* |

Declaration order is irrelevant. **The discriminator is method versus property**: the oracle
derives attribute-argument uses under a method declaration and not under a property declaration.

**CORRECTION: how this was first described here was wrong, and in a confident direction.** An
earlier version said "the walk has five branches and none of them skip children". That is true of
`deriveCCalls` — the **C++** oracle — which sits at a similar offset in the file and which I read
by mistake. The csharp walk is `deriveCSharpBareUses`, 664 lines, with explicit attribute handling.
The repro and the adjudication are unaffected; only the mechanism was wrong, and it is now the
mechanism rather than a guess.

Two pieces interact:

- `isDesignator` treats the FIRST identifier of an `attribute_argument` as a designator — a name
  that NAMES a member and never reads one (`differential.ts:6697`). That is right for
  `[Parameter(ParameterSetName = X)]`, where `ParameterSetName` is the designator and `X` is the
  value, and it is why the positional form is genuinely ambiguous.
- But the positional form reconciles under a *method* and fails under a *property*, so the
  designator rule cannot be the whole story. The other half is scope: the oracle's scope helper
  treats `property_declaration` as a scope boundary and names that scope after the property
  (relative line 117 of the function). Inside it, the enclosing class's own consts stop resolving,
  so an attribute's value fails the membership test before the designator rule is consulted at all.

**CLOSED. The mechanism was neither scope nor `isTypePosition`.** Both were inferences from a
narrow repro, and both were wrong; this section carried three stacked corrections saying so before.
It is rewritten here as one account, because a fourth correction stacked on three is a document
nobody can read and no less wrong.

The blocker was found by **instrumenting the oracle's push condition** and printing which predicate
fired, not by reading sixteen predicates and reasoning about them:

    blocked_by=[isEntityName]  chain=variable_declarator<variable_declaration<field_declaration<…

`isEntityName` decides "is this the declarator's own name" by asking `declaratorRole(n)`, which
answers a **different question**: "is this identifier in MEMBER SCOPE" — it climbs and returns `member`
on reaching a class/struct/interface/record/enum. The two coincide for a declarator's name and diverge
for its initializer, so in

    internal int maxDepth = maxDepthAllowable;
    ^^^^^^^^ declarator's name      ^^^^^^^^^^^^^^^^^^^ a READ of a declared const

the initializer was classified as the declaration publishing itself, and dropped. The sibling branch a
few lines below already asks the name question correctly with `same(firstIdent(p), n)`; this branch now
asks the same thing.

| shape | before | after |
| --- | --- | --- |
| field initializer reads a class const | analyzer only | reconciles |
| same, const declared after the use | analyzer only | reconciles |
| field initializer reads a field | analyzer only | reconciles |
| ctor body / method body / local declaration | reconciles | reconciles |
| attribute named argument | reconciles | reconciles |

**The added rows cannot be phantoms**, and that safety argument is structural rather than empirical:
`resolvable(name)` gates the push and consults the members map built from the analyzer's own symbols,
so every row this adds resolves to a real declaration. D10b's failure mode — a target that declares
nothing — is unreachable from here by construction.

**The A/B, on a pinned list.** Corpus runs rotate their sample by design — the same powershell command
reported truth of 16,371, then 21,155, then 21,994, then 23,285 with no code change in between — so
before/after cannot be concluded from two corpus runs. `cs-deep-65` pins 200 files, where
`deriveCSharpBareUses` takes `symbols` as a parameter instead of reading module-local corpus state:
**1458 → 1459** truth rows on powershell, **544 → 544** on roslyn, where the pattern is absent. All
four corpora then re-run at 100% with MISSING=0; F3 18/18, F4 58/58.

**No fixture could ever have seen this.** F3 asserts what the ANALYZER emits, so a perfect analyzer
passes every fixture while the oracle judging it lies — the same blindness as CS-D9 and CS-D10.
`field-initializer-read` pins the analyzer's half so the reads cannot be lost silently later, and
deliberately includes four shapes that already worked, because the fix is about declarator-versus-
initializer and an over-broad correction that starts dropping neighbours should be caught there rather
than as a corpus regression. Replayed with a wrong expectation: 17 pass / 1 fail.

**One case deliberately not bundled:** `new byte[DefaultBufferSize]` is blocked by `isTypePosition`,
a different predicate, because the grammar models the array SIZE bracket as an `array_type`. Two
oracle edits whose corpus effect can only be measured separately is how one becomes unverifiable.

This is the fourth oracle-side defect this round, after CS-D9, CS-D10 and CS-D10b, and the pattern is
worth stating once: **every time this lane's `unexplained` number has been chased down, the truth
turned out to be the defective party.** Four for four. A count nobody attributes is a count nobody
should trust in either direction.

**How the shape was got wrong three times, since the method matters more than the defect.** Each
attempt inferred the failing shape from the relationship label and the `source` name instead of reading
the source line. `uses constructor -> DefaultBufferSize` looked like an attribute because the source
said `constructor` and I had a theory about attributes; the line was `_buffer = new byte[DefaultBufferSize];`.
One attempt also read `deriveCCalls` — the **C++** oracle — while believing it had read csharp's,
because it located the walk by a line number derived from a function boundary its own earlier patch had
truncated. `blocked_by=[…]` in a single run is worth more than an afternoon of plausible inference,
and reading the source is worth more than reading the label.


**How the breakdown was obtained, since two attempts to get it from outside the harness failed.**
`CSHARP_INTERFACES` is built inside the harness and is not exported, so a probe calling
`deriveCSharpEdges(root, undefined)` derives strictly LESS truth than the gate does and reported
~935 phantom fabrications against the real 3. The probe is kept with a banner saying so, because
that failure is instructive rather than a mystery: it is the third time this round that a private
reimplementation of harness internals produced confident numbers that were wrong (see also the
private-matcher near-miss in `cs-deep-60`). The information exists only where `truth` and `rels`
are both in scope, which is inside the per-file loop. Reading the matcher and the surrounding
context first is cheaper than debugging a number that was never the gate's.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/csharp/`
- Ground truth: `validation/m12/ground-truth/csharp.json`
- Differential: `validation/m12/results/csharp-differential.json`
- Complexity: `validation/m12/results/csharp-complexity.json`
- Corpus sample: `validation/m12/results/csharp-corpus-sample.txt`
- Docs: this file

## Issue

Closes M12.07 (GitHub issue #146).

## M14 L5 closure (managed-OO wave #264)

The completeness-inventory now ranks csharp CONFORMANT: fixtures pass, 3
csharp mutants are caught, F1 grammar conformance passes with 0 unknown node
types, and the powershell corpus differential floor is pinned at **0 missing /
0 unexplained** (`differential-baseline.json` row `powershell:csharp`,
avg 44.5 ms/file). csharp is in `GATED_LANGS`.

### Differential oracle (deriveCSharpEdges) — Station 6
- **Base lists (CSD1)** mirror the analyzer exactly: an `interface` declaration
  `extends` every base type (C# interfaces only extend); a `class`/`struct`
  base resolves its kind from the in-file kind map, the corpus-level cross-file
  interface set (handed to BOTH the analyzer as `context.typeKinds` and the
  oracle as the companion), the qualified-name leaf, then the deterministic
  first=extends / later-unknown=implements rule.
- **instantiates**: explicit `object_creation_expression` (incl.
  `predefined_type` for `new object()`) plus target-typed
  `implicit_object_creation_expression` (`object x = new()`) resolved from the
  enclosing variable/field/property type — mirrors
  `resolveImplicitNewType`.
- **calls**: leaves from `member_access_expression`, `identifier`,
  `generic_name`, and null-conditional `x?.M()` (via `member_binding_expression`),
  with exact-string CSHARP_BUILTINS suppression (so `Debug.Assert`/`File.Close`/
  `Math.Abs` are confirmed, not hidden).
- **Target hygiene** (both sides): only clean, non-keyword identifiers are call
  targets; generic args (`Get<T>`) are stripped; metadata is deduped to one edge
  per (label,target).

### Declared residual (bounded)
In **unsafe C# COM-interop vtable dispatch**, tree-sitter parses `if(...)`
statements and pointer-slot chaining as degenerate `invocation_expression`
subtrees; a handful of real IDispatch calls (`Alloc`, `TryGetIDsOfNames`,
`GetIDsOfNamesInvalid`, `pfnIDispatchInvoke`) are consequently captured as
`uses` (confidence 0.7) rather than `calls`. This surfaces only in the
300-file sweep (4 edges) and is logged here + in the completeness spec; it is
outside the gated deterministic 60-file floor, which is clean.

## 2026-09-04 re-review wave (CSD1–CSD10, dual-lens)

Re-review with BOTH lenses: corpus census (node types occurring in 400 real
powershell files vs types the analyzer references — 105 unreferenced) AND a
full line-by-line read. The census alone missed two defects the reading
caught (the dead no-op statement and the mvcPattern flag); the reading alone
underestimated switch-arm impact until the census showed
`switch_expression_arm` at 42 occurrences per 400 files.

Defects found and fixed (each probe-verified on real parses, oracle mirrored
where the differential compares the edge):

- **CSD1**: file-scoped namespaces (`namespace X;`) produced BARE type
  fullNames — the scope was tracked in a side variable but never pushed, so
  `extends JsonSchemaReferenceResolutionException -> Exception` (bare) vs the
  block-namespace scheme `X.Impl -> IFoo` in the same corpus. Cross-file
  override/type-kind companions keyed by fullName desynced. Scope now pushed
  WITHOUT an exit item (the scope must survive its subtree exit and cover the
  sibling declarations; the naive push-with-exit was probe-refuted).
- **CSD2**: switch-expression arms never counted as decision points — a
  3-arm switch expression measured complexity 1. Added to both counters.
- **CSD3**: every operator overload collapsed to the literal symbol name
  "operator" (`operator +` vs `operator ==` indistinguishable) with no
  complexity. Now named by identity (conversion ops by target type).
- **CSD4**: null-conditional member reads (`_b?.Count`, 100 in corpus) emitted
  nothing — member_binding_expression has no expression field. Also added the
  2-level callee-skip so `x?.M()` doesn't fabricate a uses edge on the METHOD.
- **CSD5**: accessor-form `event` declarations emitted NO symbol.
- **CSD6**: dead no-op statement (`system.linq` check that did nothing) —
  reading-only catch.
- **CSD16 (M60 C2a)**: the decorator payload is a published field with a
  spelling contract, and until this round the fixture runner could not assert it
  negatively — `expectDecorators` checks `contains`, and the wrong spelling
  (`global::System.Serializable`) contains the right one (`System.Serializable`).
  `forbidDecorators` now exists for that half of the contract.
- **CSD7**: alias usings (`using Aliased = System.Text;`) captured the ALIAS
  as the module — now the qualified target, with alias metadata.
- **CSD15 (M60 C2a)**: the **alias qualifier is not part of a name**. `global::A.B`
  and `A.B` denote one type, and this analyzer publishes the full dotted path, so
  the qualifier is removed wherever a name is published — target, symbol name, or
  attribute. Six positions carried it on real code or under one: creation and
  heritage (the 51 corpus rows that convicted the class), the using directive's
  module, the target-typed `new()` target, a conversion operator's own name, and
  the attribute/decorator payload (95 corpus rows). A second half of the same
  class published **nothing**: a `global::`-qualified name with a SINGLE segment
  is `alias_qualified_name`, a node four hardcoded lists omitted, which silently
  dropped the edge for `new global::Root()`, a method return type, an indexer's
  return type, a plain `using global::System;` and `[global::Root]`. Only `global`
  is stripped: any other head (`Sql::Data`) names a binding this analyzer does not
  resolve and is published as written.
- **CSD8**: constructor initializers (`: base(42)` / `: this()`, 120 in
  corpus) emitted nothing; now calls edges, oracle-mirrored.
- **CSD9**: primary-constructor bases leaked raw argument text as
  base-list targets (`implements -> ("seed", 1)`); both parse shapes fixed.
- **CSD10**: a file-scoped scope outlived its file-section in multi-namespace
  files (nested to `Acme.F6.Domain.F6Tank`); new namespaces now replace it.
- **Process note**: the mvcPattern flag-write that nothing reads was also
  removed. And a trap worth recording: the CSD10 guard was initially placed
  outside the dispatch chain, silently stripping qualification on every node
  — the fixture briefly "passed" because emission and pins were BOTH wrong.
  Pins were re-authored from re-probed emission, which exposed it.

Gate hardening: fixture extended (operator/event/Pick/SafeCount symbols,
ctor-initializer + `?.Invoke` calls, clean primary-base extends, CSD9
forbids); 5 new mutants (190 total, all caught); F5 floor re-pinned
powershell:csharp 1386 truth edges 100%/0/0 at 60 files.

## 2026-09-04 claim-validation wave (CSD11–CSD12, owner-surfaced)

The owner read the code and reported two suspects; both were probe-tested
before any change.

- **CSD11 (refuted as stated, real sibling found)**: `private List<int>
  _items = new();` was NEVER dropped — `resolveImplicitNewType` hits
  `variable_declarator` before the `field_declaration` early return, so that
  return was unreachable dead code (now removed). The real gap, found by
  census, is the ASSIGNMENT form `_items = new();` in a constructor: the
  declared type lives on the field symbol, not a declarator, so nothing
  resolved (6/400 powershell files; explicit `new List<int>()` in the same
  position emitted — pure target-typed asymmetry). Fix: `collectMemberTypes`
  pre-pass maps declarator name -> declared type; `resolveImplicitNewType`
  falls back to the assignment LHS through that map.
- **CSD12 (confirmed)**: `class Job : IDisposable` with an external
  interface at index 0 fabricated `extends`. Rule now: unknown external
  index-0 I-prefixed PascalCase (length > 2) -> implements; structs/
  record-structs -> implements for every base (C# structs never inherit).
  Oracle mirrored; the old fixture pin had codified the fabrication and was
  re-authored from re-probed emission.

Verification: 13-shape probe matrix (fixes + 8 controls + 1 declared
limitation: I-named external CLASSES still follow the first-base rule).
Fixture +4 pins/+2 forbids; 2 new mutants — 192/192 caught; F5 100%/0/0;
F1/F2/F3/F4/F6/SPEC/CC1/honesty green.

## 2026-09-29 round — three defects, two of them in the oracle

The pattern of this round is worth recording as a pattern, not just as three
entries: **two of the three defects were in the differential oracle, and F3 could
not have found either one.** F3 asserts what the analyzer emits. A perfect
analyzer passes every fixture while the oracle that judges it lies, so a defect in
the oracle is invisible to the fixtures by construction. Both oracle defects were
found by *deliberately writing a shape by hand and asking the oracle what it said*.

### CS-D8 — parameter types were published as reads (analyzer)

Every method and lambda parameter's type was published as a `references` edge to
the type. A parameter's type is a **declaration site**, not a read of the type: the
file does not read a symbol there, it names one in order to bind a new symbol to it.
Nine sites across six files, in three shapes — method parameters, lambda and
delegate parameter types, and primary-constructor parameters.

This is the same conflation as CS-D1 (a qualified generic type split into a read of
each segment) and CS-D7 (declared types and self-names fabricated as reads): the
analyzer could not tell a position that *reads* a name from a position that
*declares* one. The fix is `isDeclaredTypeSite`, and the honest statement is that
one predicate now owns that distinction rather than three call sites each guessing
it.

Fixture `csharp/read-collides-with-call` carries the control and the forbidden row,
because the defect was only visible as a COLLISION — a parameter named `Console`
made the analyzer report a read of `Console` from a file that never reads `Console`
at all.

### CS-D9 — an in-file class was overruled by a corpus interface companion (oracle)

`deriveCSharpTypeKind` looks up a type's kind by name across the corpus to decide
whether an identifier is a type or a value. When the corpus happened to contain an
`interface` with the same name as a class declared **in the same file**, the corpus
entry won and the in-file declaration was ignored. Same name, same file: the file is
the authority. Fixed by giving a declaration in the current file precedence over any
corpus companion.

### CS-D10 — a base list was published as a type (oracle)

`base_list.argument_list` — the comma-separated list in `class C : A, B` — was
published as a type named `"A, B"`. Nothing is named that; the list is not a type
and the two arguments are.

### CS-D10b — a primary-constructor base call was published as a call (oracle)

`primary_constructor_base_type` produced a name of `Beast(Name)`. The *call* is
real, but the **base type is `Beast`** — the `contains` edge pointed at
`Beast(Name)`, which declares nothing, so the type is missing and a phantom symbol
is created. Same file, exact reconciliation: 0 truth, 0 analyzer.

D9 and D10b are the two that matter as process, because they were found in about a
minute each by hand-writing a shape, and they had survived a full corpus rotation
because the fixtures asserted the analyzer and never asked the oracle. Hence
`verify-csharp-oracle-regressions.ts` (1.2 s) and `verify-oracle-coverage.ts` now
exist as gates rather than as review notes.

## 2026-09-28 deep round — a type expression is not a name (5 defects, 2 of them in the oracle)

**Why this round exists.** The lane was closed at 9/9 cells on 2026-09-23 on two pinned
corpora — `powershell` and `fsharp` — whose `.cs` files are almost entirely *generated*
(PowerShell's cmdlets are emitted from cmdlet XML). A generated-code corpus is a fine torture
test and a poor *language* corpus: it is monomorphic, it writes short names, and it does not
use the shapes below. This round cloned two corpora the lane had never been drawn on
(`dotnet/roslyn`, 18,185 `.cs` files; `dotnet/aspnetcore`, 10,667), read all 4,041 lines of the
analyzer, and then adjudicated every relationship the census could name. Full record, with
every instrument and every correction to this round's own measurements:
`reviews/csharp/m60-deep-round-2026-09-28.md`.

The three analyzer defects are one class. This lane turns a *written type* into a *published
name*, and in every position the contract is the same — the published value is a NAME. Three
positions did not enforce it:

- **D1 — a QUALIFIED generic lost every type argument in the declared-type graph.**
  tree-sitter-c-sharp spells `System.Collections.Generic.Dictionary<string, Widget>` as
  `qualified_name […, generic_name [identifier, type_argument_list]]`, and the leaf-only walk
  reached the identifier while never touching the argument list hanging off the same node. The
  **plain** twin took the branch that walks the arguments, so one type published two different
  dependency sets depending only on how the source spelled it — and the qualified one dropped
  exactly what R9's own header calls "the real dependency". Measured 39 occurrences in 12 of
  1,500 roslyn files against 3,033 plain ones in 725: real and rare, the combination that
  survives every depth draw. One `type_argument_list` lookup, the same one the working branch
  already used.
- **D2 — a GENERIC attribute published no decorator at all.** `extractAttributes` named three
  node types; a generic attribute's name child is a fourth (`generic_name`). `[Marker<int>]`
  published `[]`, and the qualified twin that *did* match published the whole spelling
  `"System.Marker<int>"`. 1 occurrence in 1,500 roslyn files, **13 in 1,500 aspnetcore** —
  `[JSMarshalAs<JSType.Number>]` and `[TestRenderMode<…>]`, production code. The position now
  goes through the lane's one canonical-name rule, so both spellings publish a name.
- **D3 — a `using` ALIAS named a type expression.** `using PropertiesMap = ImmutableDictionary<(UnusedValuePreference
  preference, bool isUnusedLocalAssignment, …), …>;` published that whole string — type
  arguments, tuple **element names**, nullability — as both the `imports[].module` and the
  `references` target. 132 occurrences in 116 of 1,500 roslyn files. The module is now the
  type's name, and the arguments are not dropped: each is published as its own `references`
  edge marked `using_type_argument`, carrying `reference_qualified` (NOT the module edge's
  `import_based` — an argument is a type reference, and `classifyEvidenceTier` keys on
  exactly that flag pair).

Two more were found by the lane's own F5 differential the moment it was pointed outside its
pinned pair, and both were in the **oracle**, which is the more serious half of a round that
reports "0 unexplained":

- **D4 — the cross-file type-kind companion was a last-write-wins map over a NAME, and a name
  is not a type.** `interface Base` is declared in twelve roslyn files, so the companion
  answered "interface" for every file in the repository, including one that declares
  `public class Base` in its own file — one MISSING edge, `implements Derived -> Base`, on a
  declaration with no ambiguity in it at all. Measured over 1,500 files: **92 of 2,666 declared
  names (3.5%) are declared under more than one kind** (`C` is a class in 172 files and an
  interface in one), and **378 of the 1,227 base-list entries resolvable only through the
  companion (31%) were decided against the file's own declaration of that name**. The fix is to
  make the companion sound: a name enters it only when EVERY corpus declaration of it is an
  interface, so an ambiguous name is absent and the analyzer falls back to its documented
  deterministic rule — an honest default instead of a confident answer that is wrong.
- **D5 — the oracle's CSD9 mirror was missing.** A C# 12 primary constructor with a base list
  puts the base call's argument list in the `base_list` as a sibling; the analyzer has skipped
  it since 2026-09-04 and the oracle never did, so it published
  `implements OrNode -> (left,right)`. **1,168 occurrences** in roslyn's `src`, 0 in either
  pinned corpus. A fix applied to one side of a differential is a fix on one side.

### What was measured and found clean, at corpus scale

- **Calls: 100%.** Every invocation callee leaf in 400 roslyn files against the emitted
  `calls`/`uses`/`instantiates` edges — 810 ruled (CS-B2's `nameof`, the Object builtins, the
  grammar's `if(…)`-as-invocation), **0 unruled**. The instrument prints the source line of
  every row, because a count is a question and a printed line is an adjudication.
- **Symbols: 100% for every symbol-bearing declaration** (class 437/437, method 2,068/2,068,
  property 410/410, constructor 129/129, record 9/9, struct 16/16, interface 11/11, enum 8/8,
  enum_member 22/22, file_scoped_namespace 399/399). The three partial rows are accessors (not
  symbols, by design), a catch variable, and one instrument artefact.
- **Declared-type graph: 0 missing / 0 extra** on 400 roslyn (5,726/5,726) and 400 aspnetcore
  (2,489/2,489) files, by an instrument that computes the expected set from the tree with its
  own walk — the analyzer's word is never its own evidence. That measurement is clean *because
  neither draw contains the D1 shape*, and that scope limit is recorded rather than smoothed:
  the first version of the instrument reported 213 "lost" arguments and all 213 were its own
  noise, so it was withdrawn and rewritten.
- **F5 at 120 files on four corpora: 0 missing / 0 unexplained / 100% coverage** —
  roslyn 11,577/11,577, aspnetcore 3,760/3,760, and both pinned corpora. These are scoped probe
  runs: `differential.ts` refuses to write the canonical 31-language artifact from a scoped
  run, so the lane's milestone claim still reads 9/9 from `202424d2` and these are the numbers
  a re-emission has to reproduce.
- **Gate state:** F1 csharp PASS (92 refs, 0 unknown, 0 unknown fields) · F3 **16/16** · F4
  **55/55** mutants caught (4 new, one of which **survived its first run** and was made
  catchable by pinning `meta.evidenceClass` — a claim no test written on targets can see) ·
  F6 198 fixture types, 0 uncovered, 0 dead literals · SPEC A–H 8/8 · hygiene clean ·
  typecheck clean for this file.

### Standing corrections this round makes to this document

- The `uses ❌` row above still reads "not materialized as separate `uses` edges", which is
  about `field_access`. Bare-identifier value reads (`uses`, confidence 1.0, marker
  `identifier_usage`) and member-access reads (`uses`, confidence 0.7, marker
  `csharp_field_access`) HAVE been emitted since CS-R1; the row predates it and is corrected
  here rather than in silence.
- `extractTypeString` still lists `type_identifier` in its inert type list. F1 reports 0 unknown
  node types, so the pinned grammar *does* enumerate it in v0.23.5; the 2026-09-04 review's
  claim that no such node exists predates the grammar upgrade.
- The R9 declared-type **boundaries** list (`foreach`/`catch`/`using` headers, attribute
  argument types, `where T : Dep` constraint clauses) is unchanged by this round. One boundary
  is now *closed* rather than opened: a `using Alias = T;` directive's type arguments were
  previously unwritten, and D3 writes them.

## 2026-09-28, later — the labels that had nobody on the other side

**The premise: an oracle that agrees with the lane finds nothing.** This round's first question
was "are all the relationships emitted?", and the honest answer — from a ledger
(`script/m14/tmp/cs-deep-18-relationship-ledger.ts`, 300 roslyn files, 25,374 edges) — was that
only **60.3%** of them had an independent corpus derivation. `uses` (24.9%), `contains` (12.9%)
and `overrides` (1.6%) were adjudicable by nothing but the lane's own fixtures. Writing the
missing truth for two of the three found **two more fabrications**, which is the argument for
doing it: a MISSING row had to become *expressible* before it could be seen.

### `overrides` joins the compared set

The class carried a paired exclusion on both sides, commented as *"the truth DERIVES the rule it
would have to adjudicate, so a comparison would be self-agreeing."* That was **half true**:
`deriveCSharpEdges` pushed `overrides` exactly once, for the C923 interface-member form. The
`override`-**modifier** form had no truth derivation at all — which is what **299 UNEXPLAINED
edges** on a 60-file draw were (8.8% of the lane's output; not wrong edges, edges with nobody on
the other side). Both forms now derive from one input (the per-type member and base tables the
C923 walk builds). The **signature is deliberately not re-derived** — a second spelling of the
parameter-type rule free to drift is the failure a differential exists to catch — so this truth
is a documented **lower bound** on the target set. Same 60 files, same sample hash
`37c7d7bd9f8c8914`, only the truth side changed: **13,221 / 13,221, 0 MISSING, 0 unexplained.**

### `uses` (field-access half) joins the compared set — and found two fabrications

- **CS-D6 — a READ dropped because something else in the function is CALLED by the same name.**
  The guard `!emittedCalls.has(`${src}->${tgt}`)` was keyed on (source, target) with **no site**.
  Its stated purpose was to avoid duplicating a `calls` edge for a member access in callee
  position, but `isCallee` already does that **structurally** (span against the invocation's
  `function` field). The name-keyed guard was a coarser duplicate of a precise rule, and in C# a
  static member and a method call can share a name, so real reads vanished — 4 occurrences over
  150 real roslyn files, e.g. `_options.X.Severity == ReportDiagnostic.Suppress` dropped because
  `context.ReportDiagnostic(d)` is called in the same function.
- **CS-D7 — a declared TYPE published as a read, in two positions.** A **field's** type is not a
  direct child of `field_declaration` (the grammar nests it under `variable_declaration`), so the
  "first direct identifier" gate never saw it and `public Widget Widget;` published
  `uses Collides -> Widget` on its own line. For a **property** the first direct identifier is the
  *type*, so the gate took the type and let the property's own *name* through —
  `public Widget Widget { get; set; }` published `uses Widget -> Widget`. Both now read the
  grammar's `name` / `type` **fields**; the declared-type graph already publishes these names, so
  R9 owns the type position and this pass stops claiming it.

Both claims are held from **both** directions: the new truth reconciles **3,894 / 3,894, 0 either
way** over 200 files, and the **pre-fix** analyzer materialised from git publishes neither CS-D6
read and both CS-D7 self-reads when run over the same fixture. At corpus scale: **11,983 / 11,983,
100%, 0 MISSING, 0 unexplained.** The **bare-identifier half** (617 rows, `identifier_usage`) is
scoped **out** of the comparison and the limit is written into the allowlist, because it still
has no truth and admitting it would report rows UNEXPLAINED for the truth's silence — a
manufactured red. Lifting that is a one-line change once the derivation lands.

### A sixth candidate, refuted and recorded as a boundary

`resolveOverrides` Pass 3 does not check that the parent *declares* the member, and a probe
produces exactly that shape — but on code that **compiles** it cannot happen, because C# requires
an `override` member to come from the base *class*, and the base class is by language rule the
**first** base-list entry. The probe's input is CS0115 (no suitable method to override). Measured
over 400 real roslyn files: **642/642** override edges name a member declared in the same file,
**0 fabrications.** Recorded as a boundary, not a fix.

### Gates

F3 **17/17** · F4 **57/57** (two new mutants, both CAUGHT) · F1 csharp PASS (**106 refs**, 0
unknown) · F6 198 fixture types, 0 uncovered, 0 dead literals · SPEC A–H 8/8 · hygiene clean ·
typecheck clean.

### Oracle coverage, before and after

| | share of emitted edges with an independent corpus oracle |
|---|---|
| before this round | **60.3%** |
| after | **87.1%** |

Remaining: `contains` (12.9%) — structurally self-agreeing, since it is derived from the same
`ownerName` as the symbol table, so it cannot disagree with the symbols and is exactly why it is
not independently checked — and the 617-row bare-identifier `uses` half.

### `contains` — the last unoracled label, and it is clean

12.9% of the output, 3,262 edges, and the class most likely to be wrong for a *structural*
reason: the analyzer derives containment from `symbol.ownerName`, a field set during its own
walk, so the class is **structurally self-agreeing** — it cannot disagree with the symbol table
because it is built from it. An independent derivation walks the **tree** and rebuilds the owner
chain from declaration nesting, never touching a symbol.

**Ruled, not fixed: 2,442 / 2,442 over 200 roslyn files, 0 either way — on (owner, target)**,
which is *stronger* than the harness's own label+target match, since a containment edge with a
right member and a **wrong owner** is invisible to the gate and visible to this comparison.

Six corpus rows arrived before the class was clean, and **all six were defects in the truth**,
which is the point worth keeping: a new truth is not correct because it compiles. A nested type
was attributed to the file's namespace instead of its outer type (the rule asked for "the nearest
scope of the *other* kind"; the right rule is "the nearest scope of *any* kind"); an **enum** pushed
no scope, so 53 of its members came out ownerless; a **record's positional parameters** were routed
through the enclosing-scope rule instead of owned by the record; a record published its positionals
but never its **own** containment edge; event-field names were not read from the declarator; and an
**operator member's name** is written nowhere in the file (it comes from the grammar's `operator`
field), which read as 6 UNEXPLAINED `operator ==` rows at 120-file depth. One row had the
**analyzer** right for a reason the truth did not model: a file-scoped namespace covers the TYPE
declarations that follow it as **siblings**, not a member — so a member-shaped declaration at the
root is a fragment the grammar's error recovery flattened out of a class that failed to parse, and
attributing 17 such members to the namespace was a wrong-owner claim.

### Final oracle coverage

| | |
|---|---|
| before this round | 60.3% of emitted edges had an independent corpus oracle |
| after | **every label except one slice** |

`calls` · `references` · `uses` (field-access) · `overrides` · `extends` · `implements` ·
`instantiates` · `contains` — all compared, all 0 MISSING / 0 unexplained / 100% coverage at 120
files on each of **roslyn (33,498), aspnetcore (6,603) and powershell (18,152)**.

The one remaining slice is the **bare-identifier `uses` half** — 617 rows, 2.4% of output, marker
`identifier_usage` — which needs lexical resolution to re-derive and is therefore still gated by
its fixture and mutants alone, with that limit written into the allowlist rather than left to be
discovered as unexplained rows. Lifting it is a one-line change once the derivation lands.

---

# CS3 ontology round — 2026-10-05, every one of the ten types with a number behind it

Branch `analyzer/CORPUS_CS3`. Read
`docs/analyzers/ONTOLOGY-WORKSTREAM.md` §Part 1 first; this section is the lane's
answer to it. Two instruments, both lane-owned and both printing their population
before any tally:

| instrument | what it is |
|---|---|
| `validation/m14/fixtures/csharp/probe-cs3-ontology-census.ts` | all ten types across **three channels** (`res.relationships`, `res.imports[]`, `res.exports[]`), through production `parseFile` |
| `validation/m14/fixtures/csharp/probe-cs3-exports-oracle.ts` | an **independent tree derivation** for `exports`, plus the six questions for every label |
| `validation/m14/fixtures/csharp/probe-cs3-exports-construct.ts` | the `exports` CONSTRUCT census, instrument A (grammar inventory) and instrument B (tree count) |

## 0. The corpus, and the handover was wrong about it

The handover said *"NO C# CORPUS on this disk"*, and
`archive/docs-pre-consolidation/analyzers-REVIEW-2026-10-04.md` Defect B records the same claim
(`csharp-sample` absent). Measured on this disk:

| repo | `.cs` files | what it is |
|---|---|---|
| `roslyn-cs` | **18,236** | `dotnet/roslyn` @ `bb79a699`, git-tracked, 620 MB |
| `vbnet-samples` | **3,042** | hand-written application C# |
| `powershell` | **1,276** | **generated** cmdlet code — a torture test, a poor *language* corpus (monomorphic, short names); kept because it stresses the analyzer, not because it describes C# |
| `aspnetcore` | **10,687** | `dotnet/aspnetcore` @ `dc8b384c`, cloned during this round, 281 MB |

`aspnetcore` was absent although this file's own differential coverage table names
it as one of four C# corpora, so it was re-acquired with
`git clone --depth 1 --filter=blob:none`. `dotnet/roslyn` alone would have been a
**misleading** corpus for this round and §1 below is why.

## 1. Per-type verdicts

`EMITTED` = production `parseFile` produced it, with a count and the files.
`RULED` = a written reason AND a corpus measurement. `GAP` = the language has the
construct; implemented.

| type | verdict | count / files, and the measurement |
|---|---|---|
| `calls` | **EMITTED** | 400 files per corpus — roslyn **10,272**, aspnetcore **10,204**, vbnet-samples **1,830**, powershell **10,981**. e.g. `roslyn-cs/eng/ensure-sources-synced.cs:21 global -> MainAsync` |
| `uses` | **EMITTED** | roslyn **8,416**, aspnetcore **6,363**, vbnet-samples **1,419**, powershell **12,688**. Two halves: field access (conf 0.7, `csharp_field_access`) and bare identifier (conf 1.0, `identifier_usage`) |
| `contains` | **EMITTED** | roslyn **4,806**, aspnetcore **3,880**, vbnet-samples **1,790**, powershell **9,268** |
| `references` | **EMITTED** | roslyn **10,827**, aspnetcore **4,453**, vbnet-samples **1,922**, powershell **9,243**. `evidenceClass` splits `import_based` 3,760 / `reference_qualified` 7,067 on roslyn |
| `extends` | **EMITTED** | roslyn **325**, aspnetcore **157**, vbnet-samples **80**, powershell **416** |
| `instantiates` | **EMITTED** | roslyn **799**, aspnetcore **2,236**, vbnet-samples **1,204**, powershell **3,132** |
| `implements` | **EMITTED** | roslyn **4**, aspnetcore **92**, vbnet-samples **44**, powershell **103** |
| `overrides` | **EMITTED** | roslyn **747**, aspnetcore **154**, vbnet-samples **74**, powershell **574** |
| `exports` | **GAP → EMITTED** | **0 → 275** (aspnetcore 400), **340** (vbnet 400), **440** (powershell 400), **61** (roslyn 400). Independent tree derivation reconciles **0 MISSING / 0 unexplained** on three of four corpora; the fourth is adjudicated in §4 |
| `imports` | **EMITTED, on the `imports[]` channel** | roslyn **3,760** in 397/400 files; aspnetcore **1,081**/303; vbnet **885**/334; powershell **1,929**/388. `RelationshipType.Imports` names the `brain_import` **TABLE**, not a relationship row — see `REVIEW-2026-10-04.md` §1. `imports` is **not** a fabricated edge and **not** a defect |

**Relationship channel: 9 of 10.** The tenth, `imports`, is carried on the channel
the schema gives it, which is the arrangement `firing-check-v2` reports separately
for exactly this reason.

## 2. `exports` — the construct, measured before the rule existed

C# has no `export` keyword. Its export surface is the `public` accessibility
modifier on a top-level type.

**Instrument A** (grammar inventory), 300 roslyn files: **282 distinct node types**
produced, and **NONE** of the eight export-declaration node types a module language
would have (`export_statement`, `export_declaration`, `export_specifier`,
`module_export`, `visibility_modifier`, `export_list`, `pub_item`, `export`). So the
grammar route is closed and instrument A alone is the wrong probe.

**Instrument B** (tree count, where a string literal cannot fake a `modifier`):

| corpus | files | type declarations | **top-level `public`** | `internal` | `(none)` | `private` | `file` |
|---|---|---|---|---|---|---|---|
| roslyn | 300 | 333 | **0** | 303 | 6 | 18 | 0 |
| aspnetcore | 400 | 520 | **275** | 150 | 21 | 50 | 0 |
| vbnet-samples | 400 | 461 | **340** | 34 | 54 | 18 | 1 |

**The roslyn row is why this could not be ruled, and why one corpus would have
been a wrong answer.** `dotnet/roslyn` is a compiler: its implementation assemblies
declare 303 of 333 top-level types `internal` and **zero** `public`. A rule keyed on
`public` measures **0** there and reads as RULED. That is corpus starvation in a new
shape — `docs/analyzers/FIRING-CHECK.md` records Ruby at 1/10 on `NFILES=25` and
8/10 at 200 for the same reason. Two further families were needed before the number
meant anything.

### Why top-level public TYPES, and not the three wider populations

Counted on the same draw, not chosen by taste (aspnetcore column):

| rule | edges | verdict |
|---|---|---|
| **R1 top-level `public` type** | **275** | **implemented** |
| R2 every `public` type incl. nested | 299 | rejected — a nested public type is reached through its outer type, which `contains` already carries, and its export PATH (`Outer.Nested`) is not expressible as a target without inventing a qualified name |
| R3 R2 + every `public` member | 1,986 | rejected — `contains` again with a modifier attached; 7.2× the edges for no new graph question, and member visibility already rides `brain_symbol.visibility` (`schema-ddl.ts:66`) |
| R0 top-level AND namespace-free AND not `file` | 420 | this is what `res.exports[]` carries **today**, and on roslyn it carries 302 rows that are all `internal` — see §6 |

### The rule, and the two halves of it that a count cannot check

`public` and only `public`. `extractVisibility` already normalises the two C#
modifiers that must never reach an export surface: `file` maps to `private` (CS-B4),
and a top-level type with **no** modifier leaves `visibility` undefined — which is
correct, because C#'s default accessibility for a top-level type declaration is
`internal`. So an unannotated type is excluded by requiring the **literal value**,
not by supplying a default.

`source` is `ownerName` — the namespace symbol, or the lane's existing file-scope
spelling `global` — the same string `contains` derives one loop earlier, so both
endpoints resolve at exactly the rate `contains` does rather than at a new rate
needing its own measurement. `global` is the FILE, not a placeholder; rule R7 bans
the literal `unknown`, which appears nowhere.

Confidence 1.0, `evidenceClass: structural`. **A new branch was added to
`classifyEvidenceTier`**: `exports` previously fell through to `usage_contextual`,
which is the class `calls`/`uses` carry because the BINDING they denote is not
written in the file. Both halves of an `exports` claim are written — the `public`
keyword and the name. Same pairing as lua's module-surface export edge (LUA-42).

### A defect in the first version of this rule, caught by measurement

The first predicate was `ownerKind === Namespace ? ownerName : "global"`, which
accepts every **nested** public type and gives it the file-scope source — claiming
`Outer.Nested` is a global-scope export. On aspnetcore it emitted **299 against
275** real top-level public types: **24 fabricated rows**, exactly the R2−R1 gap the
construct census had already counted. **The count matched a plausible number while
the set was wrong**, which is the failure mode a count-only check cannot see. Fixed:
the predicate now requires the owner to be a namespace *or* to be absent, which is
the grammar's nesting and not a heuristic. Pinned by
`csharp/public-type-exports` and re-proved by mutant
`csharp/exports-nested-as-global`.

## 3. The six questions, per already-emitted type

Measured with `probe-cs3-exports-oracle.ts`, aspnetcore, 400 files, production
`parseFile`. **Scope, stated because it bounds every resolution number: analyzers
emit OUTGOING edges from the file being analyzed, and resolving who points AT you
is a separate subsystem that is not built.** So "resolves" can only mean "binds to
a symbol THIS FILE declares"; an external target is a true edge and is not counted
as a defect. The test is leaf-aware, because the analyzer publishes `Owner.Member`
on both halves of an `overrides` edge.

| label | edges | src resolves | tgt resolves | conf ≥ 0.7 | conf < 0.7 | placeholder `unknown` | empty endpoint |
|---|---|---|---|---|---|---|---|
| calls | 10,204 | 97.4% | 17.5% | 100.0% | 0 | 0 | 0 |
| contains | 3,880 | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
| **exports** | **275** | **99.3%** | **100.0%** | **100.0%** | **0** | **0** | **0** |
| extends | 157 | 100.0% | 1.3% | 100.0% | 0 | 0 | 0 |
| implements | 92 | 79.3%¹ | 1.1% | 100.0% | 0 | 0 | 0 |
| instantiates | 2,236 | 99.3% | 6.0% | 100.0% | 0 | 0 | 0 |
| overrides | 154 | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 |
| references | 4,453 | 99.4% | 6.1% | 100.0% | 0 | 0 | 0 |
| uses | 6,363 | 96.9% | 30.7% | 100.0% | 0 | 0 | 0 |

¹ the aspnetcore run for `implements` measured 100.0% src; the roslyn run measured
79.3%. Both are reported rather than the flattering one.

Answered one question at a time, because they fail independently:

**(1) EXISTS.** Every type above is `Constructible` — the `RelationshipType`
symbols are in the source. That is the ONLY question source-derivation answers, and
it is why this section exists.

**(2) FIRES.** Yes, for all nine, with the counts in §1, measured on three
independent corpora through `parseFile`. `implements` at **4** on roslyn is the
smallest class in the lane and it fires on aspnetcore at 92, so it is not a
roslyn-shaped dead branch.

**(3) CORRECT.** `script/m14/differential.ts` audits seven labels for csharp —
`calls, contains, references, uses, extends, implements, instantiates` — plus
`overrides` on the C923 interface-member form. Measured at 120 files per corpus
on a **pinned sample** (the cold-pool state file snapshotted and restored around
each arm, because two runs of unchanged code report different samples by design):

| corpus | tree-truth | covered | MISSING | unexplained | sample hash |
|---|---|---|---|---|---|
| aspnetcore | 6,582 | 6,582 (100%) | **0** | 2 (`uses`) | `1c0168321128fdf9` |
| roslyn-cs | 6,228 | 6,228 (100%) | **0** | 4 (`references`) | `c807007a1a2a6324` |
| vbnet-samples | 2,788 | 2,788 (100%) | **0** | 0 | `0928c5d5c0c1c2cf` |
| powershell | 19,410 | 19,410 (100%) | **0** | 0 | `0a7127b03507b651` |

Every figure is **identical before and after** this round's change and every sample
hash matches arm for arm. The 2 and 4 unexplained rows are present at baseline
`e73c3e58e`.

**THE HARNESS'S LIMIT, said plainly rather than claimed away: the oracle is a second
walker over the SAME grammar, so a grammar bug shared by both paths is invisible to
both.** What it can catch is an analyzer rule disagreeing with the language rule,
and that is the class of the 24-row fabrication in §2. The same limit applies to
this round's own `exports` oracle, which is written from the C# rule and shares no
table with the analyzer but does share the grammar.

**(4) LABELLED.** Right type, not a neighbour, for the seven audited labels: the
differential compares `label + source + target`, so a mislabel is a MISSING row plus
an unexplained row, and there are **0** of each on three of four corpora. The
fourth corpus's 6 rows are `references` on roslyn and `uses` on aspnetcore, both
present at baseline. `exports` is labelled by construction — it is a distinct
`RelationshipType` and the fixture pins `meta.relationshipType` on it. The one
label-adjacency worth naming: `overrides` and `implements` both derive from a base
list, and the discriminator is CSD12's rule (unknown external index-0 `I`-prefixed
PascalCase → `implements`; a struct's every base → `implements`).

**(5) RESOLVED.** In the table above. `contains` and `exports` resolve at 100% of
their targets and ~100% of their sources; `overrides` resolves at 100%/100%; the low
target rates on `calls` (17.5%), `extends` (1.3%), `implements` (1.1%),
`references` (6.1%), `instantiates` (6.0%) and `uses` (30.7%) are **external
targets** — `Microsoft.Build.Utilities.Task`, `System.Text.Json`, `Trim` — which is
what a single-file analyzer must emit. **The missing half is the cross-file and
incoming subsystem, which does not exist**, so this number cannot be raised by
analyzer work and is stated as a bound rather than a defect.

**(6) CONFIDENT.** No edge in the lane is below the 0.7 floor: `heuristic(<0.7)` is
**0.0%** for all nine labels. But the honest reading is finer than that number:
`uses` splits **4,870 at confidence 0.7 with `evidenceClass: inferred`** and 1,493 at
1.0 `usage_contextual` on aspnetcore — so **73% of the `uses` class sits exactly AT
the floor and is classed `inferred`**, which `src/lsp/evidence_tier.ts` defines as
"a guess … treat as a hint, never as fact". The other labels: `calls` 0.9
`usage_contextual` (10,174) + 0.95 (30); `references` 0.9, split `import_based`
1,081 / `reference_qualified` 3,372; `instantiates` 0.95 `structural`; `extends`,
`implements`, `contains`, `overrides`, `exports` all 1.0 `structural`. Every
`evidenceClass` value emitted is one of the five declared tiers
(`src/lsp/evidence_tier.ts` `EVIDENCE_TIERS`) — verified by inspection of the
per-label evidenceClass histograms the probe prints.

**Rule R7 and the standing rules.** `unknown` endpoints: **0** across the 27,814
relationships of aspnetcore 400 (the nine rows of the table above, summed). Empty endpoints: **0**. Empty symbol names: **0**.
Empty or `unknown` `SymbolKind`: **0** (measured over 4,356 symbols).

## 4. The one MISSING row, and it is not an analyzer defect

The `exports` oracle reconciles **0 MISSING / 0 unexplained** on aspnetcore (274
distinct pairs), vbnet-samples (340) and powershell (440). On roslyn it reports
**truth 62 / emitted 61 / MISSING 1**.

The MISSING row is
`Microsoft.CodeAnalysis.Editor.CSharp.UnitTests.ConditionalExpressionInStringInterpolation`
→ `CSharpAddParenthesesAroundConditionalExpressionInInterpolatedStringCodeFixProviderTests`.

**Adjudicated:** that target name is **87 characters**. `pool-worker.ts`
`filterNoiseRelationships` contains

    if (leaf.length > 80 || leaf.length < 1) return false

so the edge is deleted between the analyzer and the store. The analyzer emits it.
Measured, analyzer output vs `parseFile` output over the same 400 files:

| corpus | contains | exports | extends | instantiates | uses | total dropped |
|---|---|---|---|---|---|---|
| roslyn | 9 | 1 | 1 | 1 | 5 | **18** |
| aspnetcore | 31 | 0 | 0 | 0 | 0 | **31** |

It deletes real `contains namespace -> LongClassName` edges too, and it deleted them
before this round — 9 and 31 of them, on roslyn and aspnetcore, on **nine labels
including `extends` and `instantiates`**. `pool-worker.ts` is shared machinery this
lane does not own, so the need is **reported**, not patched (§8).

## 5. DERIVATION: csharp IS in the debt, with one finding

`npx tsx script/m60/rel-type-coverage-gate.ts --langs=csharp`, measured on this
branch:

    CHECK 1 — DERIVATION: every emitted type has an oracle derivation
      csharp       1 un-audited: ["overrides"]
    baseline: 104 recorded, 1 NEW, 104 repaid
    REGRESSIONS (not in the recorded debt):
      DERIVATION|csharp|emits `overrides` but the differential audits
      ["calls","contains","extends","implements","instantiates","references","uses"]

**One finding: `overrides`.** `differential.ts` excludes it from csharp's compared
set on BOTH sides — the truth side at `differential.ts:22718`
(`if (e.label === "overrides") continue`) and the analyzer-side allowlist at
line 23153 (`lang !== "csharp" && …`). The exclusion is symmetric and
`script/m14/verify-csharp-overrides-symmetry.ts` re-confirms it: *"excluded on BOTH
sides … the two can never disagree."* So the class is neither verified nor wrong —
it is **outside the gate**, which is the state that reads most like coverage.

This file's 2026-09-28 section records `overrides` as having joined the compared set
at 13,221/13,221. The shared file today does not do that. The two statements cannot
both describe the current tree, and the tree is the one that runs.

**This round's `exports` edges add a SECOND potential finding and the lane
mitigated what it could.** `exports` is outside csharp's compared set, so the new
edges are emitted and compared against nothing — which is the debt the workstream
says to pay DOWN. `differential.ts` is the master's, so the lane did not wire it.
What the lane DID do is supply everything a safe shared edit needs:

1. an **independent tree derivation** reconciling 0/0 on three corpora
   (`probe-cs3-exports-oracle.ts`) — a second walker over the same grammar, so the
   same declared limit applies;
2. a **fixture** with 19 expect rows, 10 forbid rows and an exact count;
3. **nine mutants**, all caught (`ab-cs3-exports-mutants.ts`).

Until `differential.ts` gains the truth push and the allowlist entry **in one
commit**, `exports` is a DERIVATION finding with lane-owned evidence behind it.
That is stated rather than assumed away.

## 6. `res.exports[]` reaches nothing — measured, and NOT changed here

`ParseResult.exports` is optional (`src/ast/types.ts:223`). `pool-worker.ts` now
forwards it (`exports: (parsed as any).exports ?? []` — the M60 LUA-14 fix). This
analyzer populates it: **400 rows in 392 of 400 roslyn files**, **419 in 392
aspnetcore**, **131 in 110 vbnet**, **3 in 3 powershell**.

**And nothing reads it.** `src/brain/schema-ddl.ts` has `brain_symbol`,
`brain_relationship`, `brain_import`, `brain_file`, … and **no export table**;
`parallel-indexer.ts` contains no read of `result.exports` — its only `exports`
mentions are `relType === "exports"` checks for RELATIONSHIP rows. So the channel
computes a fact, crosses two boundaries, and lands in nothing. That is the same
defect shape as the M60 LUA-14 note one layer further out: the worker was fixed and
the persister never learned the field.

**Why this round did not "fix" it by deleting the channel:** CS-B4 and the M49 rule
gate it with a fixture for a different reason — the channel is the RESOLVABLE-NAME
set (namespace-free top-level declarations), and F3 rejects an export that resolves
to no top-level symbol. It is a coherent contract answering a different question
from the `exports` RELATIONSHIP, and the two must not be confused:

| | `res.exports[]` | `exports` relationship |
|---|---|---|
| question | which names in this file resolve to a top-level symbol | what this assembly publishes |
| gate | F3 name resolution (CS-B4 / M49) | the `public` keyword at top level |
| roslyn 300 files | 302 rows | **0** rows |
| aspnetcore 400 files | 420 rows | 275 rows |

**The roslyn column is the finding.** The channel's 302 rows there are all
`internal`, because it never asked about visibility — it publishes
`visibility || "public"`, and a top-level type with no modifier is `internal` by the
C# default. So the channel's name "exports" does not mean exports on the corpus
where it matters most. That is **reported**, not fixed: the `|| "public"` default is
pinned by CS-B4's fixture and changing it needs that pin re-authored, which is lane
work this round did not have a measurement-driven reason to force.

## 7. Gates, re-run on this branch, with their actual results

| gate | command | result |
|---|---|---|
| F3 fixtures | `bun script/m14/run-fixtures.ts --lang csharp` | **19 / 19 pass, 0 fail** (18 pre-existing + `csharp/public-type-exports`); `fixture baseline gate: no regressions` |
| F4 mutants | `npx tsx validation/m14/fixtures/csharp/ab-cs3-exports-mutants.ts` | **9 / 9 caught** (lane-owned; §5) |
| F1 grammar | `npx tsx script/m14/audit-analyzer-grammar.ts csharp` | **PASS — refs=107, unknown=0, unknownFields=0**. The whole-programme run is red on **three other lanes** (`cpp` 2, `rust` 2, `sql` 1 unregistered literals) — not csharp's |
| no-regex | `bun script/m14/verify-csharp-no-regex.ts --file <f>` on all **6** lane files | **PASS each** — 0 regex literals, 0 unclassified regex-capable calls, **0 runtime `RegExp` constructions**. Found and fixed 3 real regex uses in this lane's own probes, written this round |
| line numbers | `bun script/m14/verify-csharp-line-numbers.ts --list <200 roslyn files> --lang csharp` | **PASS** — 14,767 relationships, **0 out of bounds**, 66 null lines, all 66 on synthesized names (`constructor`/`Finalize`), which the gate states is correct |
| symbols | `bun script/m14/verify-csharp-symbols.ts --list <200 roslyn files>` | **FAIL — 2 rows**, and this file's 2026-09-29 gate table claims PASS. **PRE-EXISTING**: reproduced identically at baseline `e73c3e58e`. §9 |
| overrides symmetry | `bun script/m14/verify-csharp-overrides-symmetry.ts` | **PASS** — exclusion symmetric on both sides |
| oracle regressions | `bun script/m14/verify-csharp-oracle-regressions.ts` | **PASS** — CS-D9 / CS-D10b |
| DERIVATION | `npx tsx script/m60/rel-type-coverage-gate.ts --langs=csharp` | **1 finding**: `overrides`. §5 |
| payload | `probe-cs3-payload-latency.ts`, 200 aspnetcore files, pinned list | 13,824 → **13,954** (+0.94%), every other label **+0** |
| latency | `probe-cs3-exports-cost.ts`, interleaved, 5 reps | exports pass **0.230 ms median** over 1,396 symbols = **0.003%** of analyze. §8 |
| differential | `bun script/m14/differential.ts --lang csharp --sample 120 --repo <r>`, pinned pool | 4 corpora, 100% covered, **MISSING=0**, unexplained **2/4/0/0**, identical before and after |
| typecheck | `npx tsc --noEmit -p tsconfig.json` | **0 errors** for this file (and for the project) |

## 8. Reported, not fixed — everything outside this lane

1. **`script/m14/firing-check-v2.mjs` cannot measure csharp at all.** C# is not in
   its `LANES` table (lines 42–64) and its `ALIAS` map carries `CSHARP: null`
   (line 178), so `NFILES=200 bun script/m14/firing-check-v2.mjs CORPUS_CS3` exits 2
   with "no lane matches". The lane is unreachable by name **and** by corpus. One
   `LANES` entry (`CSHARP: ["csharp", "real-csharp-analyzer", "aspnetcore", [".cs"]]`)
   plus a `SIGNAL[".cs"]` entry would make the briefed command produce a number for
   every future csharp agent. **This is the single highest-value shared edit in this
   report**, because without it the lane's headline instrument is unrunnable and the
   next agent will re-derive the corpus and the three-channel split from scratch.
2. **`firing-check-v2` does not read `res.exports[]`.** It tallies
   `res.relationships` and `res.imports` only, so a lane that publishes exports
   scores as silent on `exports` by an instrument that never looks there. Any 10/10
   claim made with it would be wrong about this lane in one direction and about
   lua/go/dart in another.
3. **`pool-worker.ts` `filterNoiseRelationships`' 80-character leaf cap** — §4.
   Measured 18 dropped edges on 400 roslyn files, 31 on 400 aspnetcore, across
   `contains`, `exports`, `extends`, `instantiates` and `uses`. It is a length cap
   standing in for a validity check, and the names it deletes are legal C#
   identifiers.
4. **`differential.ts`: `exports` and `overrides` are outside csharp's compared
   set** — §5. `exports` needs the truth push **and** the allowlist entry in one
   commit; `overrides` needs the `continue` at 22718 and the allowlist entry
   removed together, which the C923 comment already warns about.
5. **`differential.ts`: `script/m14/csharp-ruled.ts` does not exist**, so
   `ontology-coverage-gate csharp` has no `RULED_BY_LANG` entry and reads
   `imports` as `RULED-UNJUSTIFIED`. The ruling is written and measured (§1) and
   needs one table entry plus one import; it is in `script/m14/**`, which is the
   master's. **Without it the arbiter the workstream names cannot return a verdict
   for this lane.**
6. **`verify-csharp-no-regex.ts` is a SILENT PASS under `npx tsx`.** It ends with
   `if (import.meta.main) await main()`. Under `npx tsx` the module loads as
   CommonJS, `import.meta.main` is `undefined`, `main()` never runs and the script
   exits **0 printing nothing**. Verified: `npx tsx … --file <f>` → exit 0, no
   output; `bun … --file <f>` → exit 0, full report. Any agent reaching for
   `npx tsx` gets a green that means nothing, on the exact claim the gate exists to
   make. One line — `process.argv[1]?.endsWith(...)`, the pattern
   `run-fixtures.ts` already uses in the same directory.
7. **`run-fixtures.ts --lang=<x>` silently runs EVERY lane.** The parser reads
   `--lang` followed by a SPACE, so `--lang=csharp` leaves `argLangs` at all 46
   lanes; the run then hits the fixture-lane gate and exits 6 on `r` and `lua`,
   printing what reads like a csharp problem. Not csharp's, but it costs the next
   agent a debugging round.
8. **The `fixture-lane gate` in `run-fixtures.ts` exits 6 for EVERYONE** while `r`
   and `lua` are unregistered — 30 expectation files that no runner lane claims.
   Any full F3 run is blocked.
9. **`deriveCSharpBareUses` has no independent oracle** — the lane's own 2026-09-28
   section records this as "the one remaining slice" (617 rows, 2.4% of output at
   the time; **4,870 of 6,363 `uses` edges on aspnetcore 400 are at confidence 0.7
   with `evidenceClass: inferred`**). It is now the largest unoracled class in the
   lane by a wide margin, and the honest reading of §3(6) is that 73% of it is
   heuristic.
10. **Two `powershell` files fault the C# wasm parser**
    (`engine/remoting/host/RemoteHostMethodInfo.cs`,
    `engine/remoting/server/ServerMethodExecutor.cs` — `[BB-PARSE-ERR] … memory
    access out of bounds`), and the first of them also **hangs `parseFile` past its
    120 s guard, which exits the process**. `script/m14/ontology-coverage-gate.ts
    csharp` therefore cannot complete in one run on this corpus: the first attempt
    died at 2,061 of 22,508 admitted files and only the resumable walk saved the
    second attempt. The gate's own comment says a single poison file "costs one
    file rather than the whole measurement", which held; the hang cost 20 minutes.

## 9. Two pre-existing defects this lane did NOT fix, named

**A conversion operator's symbol name is a two-word string the file never writes.**
`public static explicit operator CSharpAnalyzerOptionsProvider(…)` is published as
name `"explicit CSharpAnalyzerOptionsProvider"` — with a SPACE. Measured on 200
roslyn files: **2 symbols** whose name is not written at their own range, which is
why `verify-csharp-symbols` is FAIL (§7). That name is not a legal C# identifier and
no consumer can resolve it by name. It is not a new defect: **reproduced identically
at baseline `e73c3e58e`**, and it is a **deliberate mirrored convention** — CSD3
names operators by identity, and `deriveCSharpContains` in `differential.ts`
(lines 7983–7999) reproduces the same spelling from the same grammar fields
specifically so the two halves reconcile. Changing one side alone desyncs a
master-owned oracle, and the file says so in both places. **The fix belongs in one
commit across both files**, and the obvious candidate spelling is Roslyn's own
(`Symbol.Name` for a conversion operator is `op_Explicit` / `op_Implicit`, a legal
identifier and stable). Not done here, and named rather than half-done.

**A dead branch in `classifyEvidenceTier`.** `if (type === "imports") { md.evidenceClass = "import_based"; continue }`
can never be true in this analyzer: the file contains **no** push of
`RelationshipType.Imports`, and imports travel on `res.imports[]`. Measured by
reading every `RelationshipType.*` site in the file — 16 sites, none of them
`Imports`. Left in place as one line of defensive symmetry with the seven labels
that do fire; named because "a branch that never matches is dead code" is exactly
the question §3(2) asks about the other nine.

## 10. What this lane could NOT settle, and precisely why

1. **Cross-file and incoming edge resolution.** §3(5) can only measure in-file
   resolution. Deciding who points AT a symbol needs an index-wide pass and the
   subsystem is not built, so no analyzer change can move those numbers and no
   claim is made about them.
2. **`overrides` correctness.** It is excluded from the differential on both sides,
   symmetrically, so nothing in the repository adjudicates it. The lane's own
   2026-09-28 measurement (642/642 override edges naming a member declared in the
   same file, 0 fabrications, over 400 roslyn files) is the only evidence and it is
   from a different round; it was not re-run here because the instrument for it is
   not lane-owned and re-deriving it privately would be the third time this
   programme has produced a confident number from a private reimplementation of
   harness internals (the lane doc records two such failures).
3. **The bare-identifier `uses` half.** Gated by fixture and mutants alone, as
   §8 item 9 states. No independent derivation exists and writing one needs lexical
   resolution this round did not attempt.
4. **Whether `exports` should also be wired into `differential.ts`.** §5 says what
   a safe edit needs and §8 item 4 says who makes it. Whether to widen a
   27,000-line contended harness to admit a lane label is the master's call, and the
   answer may legitimately be no.
5. **`verify-csharp-symbols`' 2 rows and the 80-character leaf cap** are named, not
   closed. Both are outside what one round can land without a shared-file edit.

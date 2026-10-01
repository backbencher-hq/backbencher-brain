# real-csharp-analyzer.md

## Language

- Analyzer file: `src/ast/real-csharp-analyzer.ts`
- Parser: `tree-sitter-c-sharp` **v0.23.5** (WASM in `wasm/tree-sitter-c_sharp.wasm`; also mirrored to `~/.bb/wasm`)
- Language detection: extension `.cs` → `language-detection.ts`
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

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `invocation_expression` → leaf method name (`obj.Method(...)` → `Method`, `Task.FromResult(...)` → `FromResult`); source = enclosing method; **single pass** (no duplicates) | 0.9 |
| extends | ✅ | class base-list FIRST type when it is a known class (in-file declaration, or cross-file via the type-kind companion); interface base-list all types (interfaces extend interfaces) | 1.0 |
| implements | ✅ | class base-list entries that are known interfaces (in-file or companion) plus all entries after the first when unknown (deterministic C# rule: a base class, if any, is listed first; the rest are necessarily interfaces); qualified names resolved by leaf (`BaseService.Entity` → `Entity` in the companion) | 1.0 |
| instantiates | ✅ | `object_creation_expression` (`new Foo(...)` → `Foo`) and `implicit_object_creation_expression` (target-typed `new()` — the type is resolved purely from the enclosing `variable_declarator`/`property_declaration` type) | 0.95 |
| overrides | ✅ | `override` modifier (C# keyword) + enclosing class supertypes → owner-qualified source, declaring-parent target via companion (`override-context.ts`, shared with Java/Kotlin/Scala/Groovy); without context → first hierarchy parent (deterministic per-file default) | 1.0 |
| uses | ❌ (not emitted) | C# member-access reads are covered at call level; not materialized as separate `uses` edges in M12.07 (matching the Java-family `uses` only for field-access in Java fixtures; C# keeps the contract minimal) | — |
| references | ✅ | **three families, and the target is a NAME in all of them.** (1) `using_directive` → the module path as written; for an ALIAS whose target is a type, the module is the type's **name** (D3) and each type argument is published as its own `references` edge marked `using_type_argument` / `reference_qualified`. (2) the declared-type graph (R9) — a written type name, a qualified name's **leaf**, and a generic's base **and every argument** (D1). (3) nothing else | 0.9 |
| contains | ✅ | owner → owned members via `ownerName` (namespace → types, class → members, enum → members) | 1.0 |
| depends | ✅ | imports → References | 0.9 |
| field_access | ❌ (not emitted) | covered at call level; not materialized as separate edges | — |

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
- **`uses`/`field_access` edges**: property reads are not materialized as separate edges in M12.07 (covered at call level); documented non-goal, consistent with the Java-family contract.

## Regex inventory

From `validation/m12/results/regex-census.json` (entries for this analyzer).

**0 usages** — the C# analyzer is fully regex-free. The previous analyzer had
1 regex (`replace(/"/g, "")` in Minimal API detection), eliminated by the
rewrite with pure string operations.

That claim was previously a `grep` someone ran once, which is not a gate: it
does not run again, and it cannot see a pattern assembled at runtime. It is now
`script/m14/verify-csharp-no-regex.ts`, on three layers:

| layer | what it proves | measured |
| --- | --- | --- |
| parsed | no regex literal, and no regex-only call the source cannot rule out — the file is *parsed*, so `/a\/b/` and `a / b / c` are not confused | 0 literals, 0 calls needing justification |
| runtime | `RegExp` is replaced with a recording subclass before the analyzer loads and runs, so a pattern built from a variable, an array, or JSON still has to construct one | 0 constructions over 20 files |
| artifact | the shipped analyzer is hashed against the working copy, so a build step cannot make the source claim quietly untrue | no built artifact; the repo runs from source |

Rule: **zero unclassified regex** — and the runtime figure is the load-bearing
one. Replaying the shape that defeats the obvious checks (a pattern joined from
array parts, so no literal exists and `new RegExp` takes a variable) fails the
gate on the parsed *and* the runtime layer, with the assembled pattern printed.

Gate: `bun script/m14/verify-csharp-no-regex.ts --list <paths>`.

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

**Not fixed.** Four edges in 631,892 is 0.0006%, and closing it means matching the oracle's implicit-
`new` resolution across a property-declarator-in-collection-expression path — a real change to the
analyzer's resolution logic, not a one-line filter, and therefore not something to attempt at the end
of a session without the differential pinned to prove it. It is named, located to a file and a shape,
and left.

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

- Ground truth: `validation/m12/ground-truth/csharp.json`
  (authority: `manual_audit`)
- Result: `validation/m12/results/csharp-differential.json`
- Precision / recall / FP / FN / unknown rates:
  **1.000 / 1.000 / 0 / 0 / 0** — 166/166 facts across 5 fixtures (4
  positive + 1 negative), zero parse errors.

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `roslyn@73241b4b`
  (clean repo, 17,137 committed `.cs` files)
- 400 tracked `*.cs` files (deterministic first-400 sorted, pinned
  revision, clean repo)
- Files / symbols / relationships / errors: **400 / 4,451 / 17,563 / 0
  grammar errors** (0.0% — tree-sitter-c-sharp v0.23.5; **0 missing
  tokens**)

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

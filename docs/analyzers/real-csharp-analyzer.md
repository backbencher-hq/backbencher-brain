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
| name | ✅ | `class_declaration`/`struct_declaration`/`interface_declaration`/`record_declaration`/`record_struct_declaration`/`enum_declaration`/`enum_member_declaration`/`delegate_declaration`/`method_declaration`/`property_declaration`/`field_declaration` → `name` field; constructors normalized to `constructor`; destructors → `Finalize` (Roslyn naming); indexers → `this`; operators → `operator` |
| kind | ✅ | class → Class, record → Class (Roslyn: records are classes), struct/record_struct → Struct, interface → Interface, enum → Enum, enum member → EnumMember, delegate → Delegate, event → Event, method → Method, constructor → Constructor, property/field/indexer → Property, record positional params → Property |
| qualified/container name | ✅ | `id` = parent chain + name; `parent` = enclosing symbol name |
| ownerName / ownerKind | ✅ | enclosing type symbol; top-level types owned by their (block or file-scoped) namespace — `namespace Example.Base;` applies to every type declared after it (the type declarations are SIBLINGS of the namespace node, handled via a file-scoped namespace scope) |
| range (start/end line + column) | ✅ | `startPosition`/`endPosition` (1-based lines, 0-based columns — same as Java/Kotlin) |
| parameters | ✅ | `parameter_list` → `parameter` (name + type); delegate params likewise |
| returnType / type | ✅ | `type` field on method/delegate; `extractTypeString` for fields/properties/records |
| documentation/comments | ❌ (not extracted) | non-goal for M12.07 (matching the Java-family fixture contract) |
| complexity metrics | ✅ | cyclomatic on `if`/`for`/`foreach`/`while`/`case`/`catch`/conditional/`&&`/`\|\|`; `complexity` = cyclomatic |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as warning `ParseError` (never silently dropped) |
| decorators/attributes | ✅ | `attribute_list` → attribute names (`[Flags]`, etc.) |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `invocation_expression` → leaf method name (`obj.Method(...)` → `Method`, `Task.FromResult(...)` → `FromResult`); source = enclosing method; **single pass** (no duplicates) | 0.9 |
| extends | ✅ | class base-list FIRST type when it is a known class (in-file declaration, or cross-file via the type-kind companion); interface base-list all types (interfaces extend interfaces) | 1.0 |
| implements | ✅ | class base-list entries that are known interfaces (in-file or companion) plus all entries after the first when unknown (deterministic C# rule: a base class, if any, is listed first; the rest are necessarily interfaces); qualified names resolved by leaf (`BaseService.Entity` → `Entity` in the companion) | 1.0 |
| instantiates | ✅ | `object_creation_expression` (`new Foo(...)` → `Foo`) and `implicit_object_creation_expression` (target-typed `new()` — the type is resolved purely from the enclosing `variable_declarator`/`property_declaration` type) | 0.95 |
| overrides | ✅ | `override` modifier (C# keyword) + enclosing class supertypes → owner-qualified source, declaring-parent target via companion (`override-context.ts`, shared with Java/Kotlin/Scala/Groovy); without context → first hierarchy parent (deterministic per-file default) | 1.0 |
| uses | ❌ (not emitted) | C# member-access reads are covered at call level; not materialized as separate `uses` edges in M12.07 (matching the Java-family `uses` only for field-access in Java fixtures; C# keeps the contract minimal) | — |
| references | ✅ | `using_directive`/`using_static_directive` → source `root` (rewritten to the file's primary type), target = full module path | 0.9 |
| contains | ✅ | owner → owned members via `ownerName` (namespace → types, class → members, enum → members) | 1.0 |
| depends | ✅ | imports → References | 0.9 |
| field_access | ❌ (not emitted) | covered at call level; not materialized as separate edges | — |

## Supported constructs

- Cross-file inheritance + override resolution: `class UserService : BaseService<User>, IRepository<User>` → clean extends/implements; `override string Format` → `BaseService.Format` via companion — `UserService.cs`
- Abstract base class with virtual members + nested interface `Entity` (`public interface Entity` inside `BaseService`) — `BaseService.cs`
- Interface declaration with generic constraint (`where T : BaseService.Entity`) — `Repository.cs`
- File-scoped namespaces (`namespace Example.Base;`) — every type owned by the namespace
- Records (`record Point(int X, int Y)`) → class + positional-param properties; record structs (`record struct Vector2`) → struct + properties — `Features.cs`
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

**0 usages** — the C# analyzer is fully regex-free. The census gate
confirms zero regex literal or `RegExp` nodes in the source (the previous
analyzer had 1 regex — `replace(/"/g, "")` in Minimal API detection — which
the rewrite eliminated with pure string operations and removed
unnecessary detection paths).

Rule: **zero unclassified regex** — trivially satisfied (no regex remains).

## Complexity envelope

From `validation/m12/results/csharp-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 66 | 101 | 576.9 | 114 | 175 | 222.6 MB |
| corpus_subset | 400 | 4,451 | 17,563 | 10,311.3 | 432 | 1,703 | 281.7 MB |

Declared budget: fixtures < 2 s; 400-file corpus < 60 s.

Hot-path audit: single-pass iterative traversal (explicit stack, no
recursion depth risk); `symbolMap` (Map) gives O(1) owner/name lookups;
the type-kind companion is a Map lookup per base type; override resolution
uses the shared `findDeclaringParent` BFS over the (tiny) hierarchy. No
O(n²) or per-symbol O(n) scans.

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

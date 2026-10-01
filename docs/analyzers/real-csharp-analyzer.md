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

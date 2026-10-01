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

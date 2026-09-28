# real-kotlin-analyzer.md

## Language

- Analyzer file: `src/ast/real-kotlin-analyzer.ts`
- Parser: `tree-sitter-kotlin` (WASM, via project pipeline `engine.ts resolveWasm`)
- Language detection: extension `.kt` / `.kts` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealKotlinAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration` / `object_declaration` / `function_declaration` / `property_declaration` / `primary_constructor` / `constructor_declaration` → `type_identifier` / `simple_identifier` name nodes |
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
| modifiers | ✅ | `modifiers` node children (`data`, `sealed`, `abstract`, `override`, `suspend`, `companion`, …) |
| extension receivers | ✅ | leading `user_type` child of `function_declaration` before the name |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `call_expression` → navigation-path callee (`buildKotlinCallExpression`); source = enclosing function; stdlib filtered by exact leaf (`kotlinStdlibExact`) | 0.7 |
| extends | ✅ | class: first `delegation_specifier`; extension functions: receiver type (`kotlin_extension_function`); objects/classes: delegation → clean base type | 1.0 |
| implements | ✅ | class `delegation_specifier`s after the first → clean base type (interface list) | 1.0 |
| instantiates | ✅ | PascalCase callees of `call_expression` (constructor calls) — emitted instead of Calls | 0.7 |
| uses | ✅ | coroutine dispatch (`launch`/`async`/`withContext` → `Uses` with `coroutine_dispatch`) | 1.0 |
| imports | ✅ | `import_header` → `identifier` path + alias/wildcard metadata | — |
| exports | ✅ | non-private top-level symbols (public API) | — |
| overrides | ✅ | `override` modifier + enclosing class supertypes → owner-qualified source, first-hierarchy-parent target; phantom excluded; cross-file target = declared limitation (below) | 0.9 |
| references | ✅ | imports → source rewritten from placeholder to file's primary type (or `root` for function-only files) | 0.9 |
| contains | ✅ | owner → owned members via `ownerName` only (top-level declarations never self-contain) | 1.0 |
| depends | ✅ | imports → References | 0.9 |
| field_access | ❌ (not emitted) | property accesses are covered by calls/uses at the call level; not materialized as separate edges in M12.03 | — |

## Supported constructs

- Data classes (`data class User(val id: String, val name: String)`) — class + constructor + val/var properties — `Models.kt`
- Sealed class hierarchies (`sealed class Result<out T>` + nested data classes/objects with delegation) — `Models.kt`
- Interfaces (`Repository<T>`), abstract classes with nested interfaces (`BaseService.Entity`), companion objects (`const val VERSION`) — `Models.kt`
- Generic bounds (`T : BaseService.Entity`, `out T`) and generic methods (`B map(A)`-style via `type_parameters`) — `Models.kt`
- Cross-file inheritance: `class UserService(...) : BaseService<User>(), Repository<User>` → clean extends/implements targets — `UserService.kt`
- `override` methods, `suspend` functions, top-level factory functions, `User?` nullable returns — `UserService.kt`
- Extension functions (`fun String.shout`, `operator fun User.plus`) with receiver edges — `Extensions.kt`
- Operator overloads (`plus`), use-site annotations (`@field:JvmField`), top-level `const`-style properties — `Extensions.kt`
- `when` expressions, nullable params, collection chains (filter/map) — `Extensions.kt`

## Unsupported / explicit-unknown constructs

- **Cross-file override targets** (resolved, fixture `UserService.kt`): the analyzer is per-file, but accepts an optional project context (`AnalyzeContext.overrideCompanion` — owner type → declared method names) built by the caller from previously parsed files. With context, the override target is the first ancestor in declaration order that actually declares the method (`src/ast/override-context.ts`, shared with the Java analyzer): `UserService.save` → `Repository.save` (the interface declares it, `BaseService` does not), `UserService.format` → `BaseService.format` (the superclass declares it). Without context the analyzer deterministically emits the first hierarchy parent — the honest per-file default, since the true declaring parent is unknowable from one file alone. The M12 harness feeds the companion index (pre-pass over the fixture corpus); production wiring of the same context from the indexer's global symbol space is tracked by M12.44.
- **Grammar gaps on advanced Kotlin** (real-corpus evidence, `kotlin-corpus-sample.txt`): tree-sitter-kotlin produces ERROR/MISSING nodes for `fun interface` declarations, object-with-delegation expressions (`= object : X by y {`), and some extension-function+object patterns. The analyzer REPORTS these as warning ParseErrors (51/300 corpus files) and continues extraction on the rest of the file — never silent. (One of the 51 — `HttpClient.kt` — carries only hidden `MISSING _alpha_identifier` recovery tokens in multi-condition `when` entries that the web-tree-sitter binding does not expose via child iteration; the engine now flags such files via a root-level warning so they are never silently clean.) These constructs are absent from the fixture corpus (0 fixture errors) so the differential tests the supported grammar surface.
- **Data-class compiler methods** (componentN, copy, equals/hashCode/toString): not materialized as symbols; the data class + val properties are extracted. Documented non-goal for M12.03 (the analyzer's `injectPhantomSymbols` is not wired).
- **field_access edges**: property-access relationships are not emitted as separate edges in M12.03 (covered by calls/uses); documented non-goal.

## Regex inventory

From `validation/m12/results/regex-census.json` (entries for this analyzer).

Baseline at M12.01: **14 usages**. After M12.03 elimination: **0 usages** — the Kotlin analyzer is fully regex-free. The census gate confirms zero regex literal or `RegExp` nodes in the source (`kotlin entries: NONE`).

Eliminated (all 14): modifier text-scan split (`/[\(\{=]/`) → AST `modifiers` node; extension-receiver regex (`/fun\s+...\./`) → leading `user_type` child; annotation `@`-strip (`/^@/`) and name regex (`/@(\w+)/`) → annotation node + `user_type`→`type_identifier`; use-site target regex (`/@(\w+):/`) → `use_site_target` node; supertype-args strip (`/\(.*\)/`) → `user_type` inside `delegation_specifier`/`constructor_invocation` + `cleanKotlinBaseType`; six literal-classification regexes (`/^\d+$/` etc.) → initializer NODE TYPE (`integer_literal`/`real_literal`/`string_literal`/`character_literal`/`boolean_literal`); constructor-call regex (`/^(\w+)\s*\(/`) → `call_expression` callee; Compose PascalCase regex (`/^[A-Z]/`) → char-range check.

Rule: **zero unclassified regex** — trivially satisfied (no regex remains).

## Complexity envelope

From `validation/m12/results/kotlin-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 3 | 34 | 45 | 237.2 | 143 | 190 | 200.2 MB |
| corpus subset (intellij-community @ cfda6881) | 300 | 11,286 | 43,364 | 9,416.4 | 1,199 | 4,605 | 381.5 MB |

Declared budget: fixture wall < 500 ms; corpus subset (300 files) < 20 s, symbols/s ≥ 1,000, relationships/s ≥ 4,000. **Met.**

Hot-path audit: iterative stack walks (no recursion) for scoping, relationships, calls, annotations, and complexity counting; `Map`-based lookups (`importAliases`, `annotations`); the override-parent lookup scans the symbol list per override method (bounded by symbol count — acceptable linear pass, no nesting). No O(n²) or per-symbol O(n) scans in the hot paths.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/kotlin.json` (authority: `manual_audit` of fixture semantics — data/sealed/generic/extension/operator contracts)
- Result: `validation/m12/results/kotlin-differential.json`
- **Precision 1.000 / Recall 1.000** over **77 facts**: TP 77, FP 0, FN 0, unknown 0, unsupported 0
  - Cross-file override targets resolved inside the analyzer via the companion index: `UserService.save → Repository.save` (declaring parent is the interface `Repository`, not the superclass `BaseService`)
- Facts compared as emitted — no harness post-processing; the companion index is fed to the analyzer as input context (see `script/m12/verify-analyzer.ts` honesty note)
- Baseline (M12.01): types leaked into decorators, class self-contain edges, extends/implements dropped by the noise filter (generic-suffixed targets), overrides with bare-name identity, package missing from scopes, weak property typing. All fixed.

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `intellij_community@cfda6881ef1c86081f9ad4f993906b84004b65f2` (local clone; repo state dirty — unrelated `.agents/skills` deletions)
- Measured subset: 300 tracked `*.kt` files > 5KB (deterministic lexicographic at pinned revision) — `validation/m12/results/kotlin-corpus-sample.txt`
- **300 files, 11,286 symbols, 43,364 relationships, 0 thrown exceptions, 0 timeouts**; **51/300 files carry grammar ERROR/MISSING nodes** (fun interface, object delegation, some extension+object patterns, plus one hidden-MISSING `when`-entry case) — reported as warnings, extraction continues; measured by explicit error-counting re-parse (the measure tool alone swallows exceptions)

## Evidence pointers

- Fixtures: `validation/m12/fixtures/kotlin/` (Models.kt, UserService.kt, Extensions.kt)
- Ground truth: `validation/m12/ground-truth/kotlin.json`
- Differential: `validation/m12/results/kotlin-differential.json`
- Complexity: `validation/m12/results/kotlin-complexity.json`
- Corpus sample list: `validation/m12/results/kotlin-corpus-sample.txt`
- Docs: this file

## Issue

Closes M12.03 (GitHub issue #142).

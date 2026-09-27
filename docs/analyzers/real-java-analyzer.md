# real-java-analyzer.md

## Language

- Analyzer file: `src/ast/real-java-analyzer.ts`
- Parser: `tree-sitter-java` (WASM, via project pipeline `engine.ts resolveWasm`)
  <!-- provenance: find-grammar-provenance -->
  Provenance of the shipped bytes: a **REDISTRIBUTOR BUILD**, not a build of this lane's own
  npm package. `wasm/tree-sitter-java.wasm` is
  byte-identical to `tree-sitter-wasms@0.1.11`'s `out/` wasm (sha256 `637aac4415fb39a2…`).

  **That collection publishes no source** — 0 `grammar.js`, 0 `parser.c`, only prebuilt wasms —
  so these bytes cannot be regenerated from it, and the underlying GRAMMAR version is recorded
  nowhere in this repository and must not be inferred from the collection's version.

  Established by `script/m60/find-grammar-provenance.ts` (exact sha256 match, no inference from
  size or date); evidence in `validation/m60/results/G-PROVENANCE.json`. This matters for the
  web-tree-sitter 0.27.0 migration: this is one of the lanes whose wasm cannot simply be
  rebuilt from what we have, only re-sourced and re-admitted.
- Language detection: extension `.java` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealJavaAnalyzer` (line ~1212)

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration` / `interface_declaration` / `enum_declaration` / `record_declaration` / `method_declaration` / `constructor_declaration` / `field_declaration` → `variable_declarator` → `identifier` field |
| kind | ✅ | class/interface/enum/record → `SymbolKind.Class/Interface/Enum/Class`; methods → Method; constructors → Constructor; fields → Property (or Constant when `static final`); enum entries → EnumMember |
| qualified/container name | ✅ | FQN built from `package_declaration` (scoped_identifier) + enclosing scopes (`buildFqn`) |
| ownerName / ownerKind | ✅ | Parent scope name/kind captured during the single-pass walk |
| range (start/end line + column) | ✅ | `nodeToRange` from `startPosition`/`endPosition` (node-start convention: annotation line for annotated declarations, matching M11) |
| parameters | ✅ | `formal_parameters` → `formal_parameter` → `name` field + `type` field; record params via `record_parameters`; ERROR-node fallback for malformed text |
| returnType / type | ✅ | `method_declaration` field `type`; `field_declaration` type child |
| documentation/comments | ❌ (not emitted) | not part of the UniversalSymbol contract exercised by fixtures |
| complexity metrics | ✅ | cyclomatic complexity counted on `if/for/while/catch/switch-case/ternary` nodes |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as `ParseError` (warning severity) |
| decorators/attributes | ✅ | `modifiers` → `annotation` / `marker_annotation` nodes (full text) + bare names via `getJavaAnnotationNames` (identifier field) |
| generic parameters | ✅ | `type_parameters` → `type_parameter` nodes |
| phantom symbols | ✅ | Spring Data repository methods (`save`, `findById`, …) and Lombok `@Data`/`@Getter`/`@Setter` accessors, marked `isPhantom` |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `method_invocation` → `buildJavaCallExpression` (object.name); source = enclosing method | 0.7 (non-builtin only, `isJavaBuiltin` filters JDK/stdlib) |
| extends | ✅ | `superclass` field → `extractJavaTypeBaseName` strips `generic_type` type args → clean symbol name | 1.0 |
| implements | ✅ | `super_interfaces`/`extends_interfaces` → `interface_type_list` → per-interface, type args stripped | 1.0 |
| instantiates | ✅ | `object_creation_expression` → `type_identifier`; plus PascalCase `method_invocation` heuristics | 0.95 (new) / 0.6 (heuristic) |
| uses | ✅ | field accesses (`field_access`) resolved to the enclosing METHOD (M49 W15 #814: `this`/`super` receivers used to resolve to the enclosing type, the JAD2 exception, which the family-wide ruling removed — a class-level read falls back to the type); Spring DB mappings (entity table, mapped column, `@Value` config keys) | 0.6 field access / 1.0 framework-derived |
| imports | ✅ | `import_declaration` → `scoped_identifier`/`identifier`; metadata for static/wildcard | — |
| exports | ✅ | public top-level symbols; Spring MVC endpoints (`Exports` with route, httpMethod) | 1.0 |
| overrides | ✅ | `@Override` + hierarchy BFS over `classHierarchy` (type-arg-clean parents): exact-signature match first, then declaring-parent resolution via the project companion index (cross-file / generic signatures), then deterministic first-parent fallback | 1.0 (exact / companion-resolved) / 0.9 (fallback) |
| references | ✅ | imports, source rewritten post-pass from package → file's primary type (first top-level class/interface/enum) | 0.9 |
| contains | ✅ | owner → owned symbols (deduped against engine-generated contains in `storeResults`) | 1.0 |
| depends | ✅ | imports → `References` (Java import edge) | 0.9 |
| field_access | ✅ | `collectFieldAccessUses` with enclosing-type scope (this/super → owner) | 0.6 |

## Supported constructs

- Classes, interfaces, enums (with `enum_constant` members), records (with `record_parameters` → properties) — `BaseService.java`, `AdvancedFeatures.java`
- Generic classes/interfaces: `Repository<T>`, `BaseService<UserService.User>` — inheritance targets stripped of type args (`extractJavaTypeBaseName`) so `extends`/`implements` resolve to real symbols — `UserService.java`
- Methods, constructors (named `constructor`), overloads (signature-keyed FQN), abstract/default methods — `AdvancedFeatures.java`
- Annotations: Spring bean markers, `@Entity`/`@Table` (table mapping), JPA column/relation mappings, `@RequestMapping`/`@GetMapping`-family routes (class base path + method route composed, `@Value` config injection) — `AdvancedFeatures.java`
- Method invocations (`qualified_calls` + Calls edges), object instantiation, streams/lambdas (`mapXs.stream().map(…).collect(…)` chains) — `AdvancedFeatures.java`
- `this`/`super` field access reads resolved to the enclosing METHOD (M49 W15 #814; they resolved to the enclosing type before the ruling) — `AdvancedFeatures.java`
- Phantom symbols: Spring Data repositories (`JpaRepository`/`CrudRepository` default methods), Lombok `@Data`/`@Getter`/`@Setter` accessors — `UserService.java`

## Unsupported / explicit-unknown constructs

- **Cross-file override targets** (resolved, fixture `UserService.java`): the analyzer is per-file, but accepts an optional project context (`AnalyzeContext.overrideCompanion` — owner type → declared method names) built by the caller from previously parsed files. With context, the override target is the first ancestor in declaration order that actually declares the method (`src/ast/override-context.ts`, shared with the Kotlin analyzer): `UserService.save` → `Repository.save` (the interface declares it, `BaseService` does not), `UserService.format` → `BaseService.format`. Without context the analyzer deterministically emits the first hierarchy parent — the honest per-file default, since the true declaring parent is unknowable from one file alone. The M12 harness feeds the companion index (pre-pass over the fixture corpus); production wiring of the same context from the indexer's global symbol space is tracked by M12.44.
- Static imports of specific members: `import static` metadata captured; member-level import resolution is not expanded into per-member symbols (explicit non-goal for M12.02).
- Annotation processor–generated code (beyond the two phantom generators above) is not materialized.
- ERROR-node parameter text (malformed source) is recovered best-effort; recovered types are heuristic (`unknown` when nothing is derivable). See fixture-negative note in regex inventory.

## Regex inventory

From `validation/m12/results/regex-census.json` (entries for this analyzer).

Baseline at M12.01: **18 usages**. After M12.02 elimination: **2 usages** — both in the ERROR-node parameter recovery block, both classified `unavoidable`:

| Line | Regex | Receiver category | Classification | Justification |
| --- | --- | --- | --- | --- |
| 1145 | `/\s+/` (split) | identifier (`pt`) | unavoidable | ERROR-node recovery: tree-sitter exposes no structure for malformed parameter text; whitespace-run tokenization of garbage text is not grammar-expressible |
| 1156 | `/@[\w\.]+\s*/g` (replace) | identifier (`typeGuess`) | unavoidable | ERROR-node recovery: stripping `@Annotation` tokens from a type guess requires whitespace-aware scanning that no grammar node can express (the text is a parse error) |

Eliminated (14): annotation classification (`@Service|@Entity|@GetMapping…|@Column…` tests) → `getJavaAnnotationNames` (AST identifier fields); annotation-name extraction (`/^@([A-Za-z0-9_]+)/`) → same; class route extraction (`/"([^"]+)"/`, `/value\s*=\s*"([^"]+)"/`) → `getAnnotationValue` (AST `annotation_argument_list`); route slash-collapse (`/\/\/+/g`) → single-pass loop; ERROR-node comma strip (`/^,\s*/`) → `startsWith`/`slice`; name sanitize (`/[^a-zA-Z0-9_]/g`) → char filter; varargs (`/\.\.\./g`) → `split("…").join("[]")`; quote stripping (`/^"|"$/g` ×2) → `extractStringValue` (AST `string_fragment`).

Rule: **zero unclassified regex** — `bun script/m12/verify-regex-census.ts --strict` reports **0 unjustified entries for this analyzer** (remaining strict failures are other analyzers pending their own issues).

## Complexity envelope

From `validation/m12/results/java-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 4 | 40 | 78 | 160.2 | 250 | 487 | 177.9 MB |
| corpus subset (intellij-community @ cfda6881) | 400 | 7,812 | 30,483 | 4,462.7 | 1,751 | 6,831 | 512.6 MB |

Declared budget: fixture wall < 500 ms; corpus subset (400 files) < 15 s, symbols/s ≥ 1,000, relationships/s ≥ 4,000. **Met.**

Hot-path audit: single-pass iterative stack walk (no recursion), O(N) with pre-built `Map` lookups — `symbolMap` (FQN + local name), `classHierarchy`; override resolution is BFS over the class hierarchy with a `seen` set (bounded by hierarchy depth, not symbol count); field-access collection is one extra O(N) walk with a `seen` set for edge dedupe. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/java.json` (authority: `manual_audit` of fixture semantics — types, inheritance, method contracts)
- Result: `validation/m12/results/java-differential.json`
- **Precision 1.000 / Recall 1.000** over **116 facts**: TP 116, FP 0, FN 0, unknown 0, unsupported 0
  - Cross-file override targets resolved inside the analyzer via the companion index (M12.02 correction, tracked downstream by M12.44): `UserService.save → Repository.save` (declaring parent is the interface `Repository`, not the superclass `BaseService`)
  - Verified true during deep audit (M12.02 correction): `instantiates UserService → HashMap` (diamond `new HashMap<>()` — previously missed because the type parses as `generic_type`; analyzer fixed to handle it, +511 corpus relationships)
- Facts are compared **as emitted** — the harness performs no post-processing; the companion index is fed to the analyzer as input context (mirroring the production indexer's global symbol space)
- Baseline (M12.01): precision 0.790 / recall 0.754 — defects fixed: package-name reference sources, missing `extends`/`implements` on generic-bounded classes (type-arg stripping), override targets mangled by generic suffixes, unresolved `this` receivers

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `intellij_community@cfda6881ef1c86081f9ad4f993906b84004b65f2` (local clone, repo state dirty — unrelated `.agents/skills` deletions; Java sources intact)
- Measured subset: first 400 tracked `*.java` files (lexicographic, deterministic at pinned revision) — `validation/m12/results/java-corpus-sample.txt`
- **400 files, 7,812 symbols, 30,483 relationships, 0 thrown parse exceptions, 0 files with grammar errors, 0 timeouts** — errors measured by direct re-parse with `result.errors` counting (the measure tool alone swallows exceptions; the doc claim is backed by an explicit error-counting run)

## Evidence pointers

- Fixtures: `validation/m12/fixtures/java/` (UserService.java, BaseService.java, Repository.java, AdvancedFeatures.java)
- Ground truth: `validation/m12/ground-truth/java.json`
- Differential: `validation/m12/results/java-differential.json`
- Complexity: `validation/m12/results/java-complexity.json`
- Corpus sample list: `validation/m12/results/java-corpus-sample.txt`
- Docs: this file

## Issue

Closes M12.02 (GitHub issue #141).

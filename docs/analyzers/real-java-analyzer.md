# real-java-analyzer.md

## Language

- Analyzer file: `src/ast/real-java-analyzer.ts`
- Parser: `tree-sitter-java`. `src/ast/engine.ts`'s grammar-name map carries
  `java: "tree-sitter-java"`; `parseFile` resolves it through `resolveWasm`, whose first
  candidate directory is this repo's `wasm/`.
  <!-- provenance: find-grammar-provenance -->
  Provenance of the shipped bytes: a **REDISTRIBUTOR BUILD**, not a build of this lane's own
  npm package. `wasm/tree-sitter-java.wasm` is byte-identical to `tree-sitter-wasms@0.1.11`'s
  `out/` wasm. Full sha256, measured 2026-10-02:
  `637aac4415fb39a211a4f4292d63c66b5ce9c32fa2cd35464af4f681d91b9a1f`, 430,239 B — the prefix
  `637aac4415fb39a2…` this document previously carried still matches the wired bytes.

  **That collection publishes no source** — 0 `grammar.js`, 0 `parser.c`, only prebuilt wasms —
  so these bytes cannot be regenerated from it, and the underlying GRAMMAR version is recorded
  nowhere in this repository and must not be inferred from the collection's version.

  Established by `script/m60/find-grammar-provenance.ts` (exact sha256 match, no inference from
  size or date); evidence in `validation/m60/results/G-PROVENANCE.json`. This matters for the
  web-tree-sitter 0.27.0 migration: this is one of the lanes whose wasm cannot simply be
  rebuilt from what we have, only re-sourced and re-admitted.
- **Pin-contract status: NOT registered.** `validation/m14/grammar-pins.json` has no `java`
  lane, so the sha256 above is a measurement, not a contract-enforced pin.
- Language detection: extension `.java` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `case "java"` → `RealJavaAnalyzer` at **line 1984**
  (measured 2026-10-02). This file previously said "line ~1212", which pointed at
  `parseFile`'s case arm, not `getAnalyzer`'s.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration` / `interface_declaration` / `enum_declaration` / `record_declaration` / `annotation_type_declaration` / `method_declaration` / `constructor_declaration` / `field_declaration` → `variable_declarator` → `identifier` field |
| kind | ✅ | `mapTypeToSymbolKind`: class/record/annotation → `Class`; interface → `Interface`; enum → `Enum`; `enum_constant` → `EnumMember`; methods → `Method`; constructors → `Constructor`; fields → `Property`, or `Constant` when `static final`. The nine `SymbolKind` values this analyzer constructs, re-measured 2026-10-02: `Class`, `Constant`, `Constructor`, `Enum`, `EnumMember`, `Interface`, `Method`, `Property`, `Type` |
| qualified/container name | ✅ | FQN built from `package_declaration` (scoped_identifier) + enclosing scopes (`buildFqn`) |
| ownerName / ownerKind | ✅ | Parent scope name/kind captured during the single-pass walk |
| range (start/end line + column) | ✅ | `nodeToRange` from `startPosition`/`endPosition` (node-start convention: annotation line for annotated declarations, matching M11) |
| parameters | ✅ | `formal_parameters` → `formal_parameter` → `name` + `type` fields. **Record components are read from `formal_parameters` too, not from a `record_parameters` node** — this file previously named `record_parameters`, which does not occur anywhere in the analyzer; tree-sitter-java models record components as formal parameters, and a varargs component parses as `spread_parameter` whose name lives in the trailing `variable_declarator` rather than in a `name` field. ERROR-node fallback for malformed text |
| returnType / type | ✅ | `method_declaration` field `type`; `field_declaration` type child |
| documentation/comments | ✅ | **This row previously read "❌ (not emitted)". That was wrong.** The analyzer sets `comments: [javadoc]` on class-like symbols (line 455), methods (line 796) and fields (line 993), from tree-sitter-java's `line_comment` / `block_comment` nodes (line 1050). The M14 #383 note in the source records the defect this repaired: java method symbols used to carry no comments and the docstrings were silently lost |
| complexity metrics | ✅ | per-method cyclomatic complexity, `1 + decision points` (`calculateJavaMethodComplexity`, 1 + `if`/`for`/`while`/`catch`/`switch-case`/ternary and `&&`/`||`), carried on the method symbol; the file-level counter is a separate total |
| syntax errors | ✅ | ERROR/MISSING nodes pushed as `ParseError` (warning severity) |
| decorators/attributes | ✅ | `modifiers` → `annotation` / `marker_annotation` nodes (full text) + bare names via `getJavaAnnotationNames` (identifier field) |
| generic parameters | ✅ | `type_parameters` → `type_parameter` nodes |
| phantom symbols | ✅ | Spring Data repository methods (`save`, `findById`, …) and Lombok `@Data`/`@Getter`/`@Setter` accessors, marked `isPhantom`. A phantom member's `contains` edge is confidence 0.6 against 1.0 for a real one, and its `line` is omitted rather than zeroed |

## Relationship ontology

Emitted kinds, re-derived 2026-10-02 from every `ASTEngine.RelationshipType.*` reference in
`src/ast/real-java-analyzer.ts`: **Calls, Contains, Exports, Implementation, Inheritance,
Instantiates, Overrides, References, Uses** — nine kinds. (`RelationshipType.Inheritance`
serialises to `"extends"`, `Implementation` to `"implements"`, and `Imports` to
`"brain_import"`.)

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `method_invocation` → `buildJavaCallExpression` (object.name); source = enclosing method | 0.7 (non-builtin only, `isJavaBuiltin` filters JDK/stdlib), 0.8, 1.0 |
| extends | ✅ | `superclass` field → `extractJavaTypeBaseName` strips `generic_type` type args → clean symbol name (`RelationshipType.Inheritance`) | 1.0 |
| implements | ✅ | `super_interfaces`/`extends_interfaces` → `interface_type_list` → per-interface, type args stripped (`RelationshipType.Implementation`) | 1.0 |
| instantiates | ✅ | `object_creation_expression` → `type_identifier`; plus PascalCase `method_invocation` heuristics | 0.95 (typed), 0.6 (heuristic) |
| uses | ✅ | field accesses resolved to the enclosing METHOD (M49 W15 #814: `this`/`super` receivers used to resolve to the enclosing type, the JAD2 exception, which the family-wide ruling removed — a class-level read falls back to the type); Spring DB mappings (entity table, mapped column, `@Value` config keys) | 0.6 field access, 1.0 framework-derived, 1.0/0.6 conditional on `tableNameIsDeclared` / `columnNameIsDeclared` |
| exports | ✅ | public top-level symbols; Spring MVC endpoints (`Exports` with route, httpMethod) | 1.0 |
| overrides | ✅ | `@Override` + a three-tier BFS over `classHierarchy` (type-arg-clean parents): exact in-file signature match, then generic substitution, then the project companion index, then the first-parent guess. Each tier sets BOTH a confidence and a machine-readable `metadata.reasonCode` — `exact-in-file`, `generic-substitution`, `companion-index`, `first-parent-guess` — which is what contract §4 asks for | **1.0 / 0.9 / 0.85 / 0.5**, matching the reason-code ladder. This file previously claimed "1.0 (exact / companion-resolved) / 0.9 (fallback)", which was wrong twice: the companion tier is **0.85**, not 1.0, and the first-parent fallback is **0.5**, not 0.9. The 0.5 tier is deliberate — it sits below `patterns.ts`'s 0.7 `confidenceThreshold` so a guessed override cannot reach pattern analysis |
| references | ✅ | import edges and the post-pass that rewrites their source from the package name to the file's primary type (first top-level class/interface/enum); also type references (`references:getStatus:String`, `references:Mapper:B`, `references:genericBound:T` in the recorded differential) | 0.9, 0.95, 1.0 |
| contains | ✅ | owner → owned symbols (deduped against engine-generated contains in `storeResults`) | 1.0, or 0.6 when the member is a phantom |
| **imports** | ❌ **not emitted** | `RelationshipType.Imports` is **never referenced by this analyzer**. This file previously carried an `imports` row reading "`import_declaration` → `scoped_identifier`/`identifier`; metadata for static/wildcard". The *node* is read and the metadata is captured, but the *edge kind* is `references` (confidence 0.9), as the `references` row above and the `depends` row below both describe. Corrected 2026-10-02 | — |
| depends | ❌ not a kind | `depends` is not a member of `RelationshipType` in `src/ast/types.ts`. This file's old `depends` row was the `references` row wearing a second name: "imports → `References` (Java import edge)" is the same edge as `references` above, at confidence 0.9. The family has no `depends` kind | — |
| field_access | ❌ not a kind | Same: `field_access` is not a `RelationshipType`. The rule it described is real — `collectFieldAccessUses` with enclosing-type scope (`this`/`super` → owner) at confidence 0.6 — and it emits **`uses`**, which is what the `uses` row above now says | — |

## Supported constructs

- Classes, interfaces, enums (with `enum_constant` members), records (components promoted to
  `Property` symbols, JLS 8.10.3 constructor-backed members), and `annotation_type_declaration`
  — `BaseService.java`, `AdvancedFeatures.java`
- Generic classes/interfaces: `Repository<T>`, `BaseService<UserService.User>` — inheritance
  targets stripped of type args (`extractJavaTypeBaseName`) so `extends`/`implements` resolve to
  real symbols — `UserService.java`
- Methods, constructors (named `constructor`), overloads (signature-keyed FQN),
  abstract/default methods — `AdvancedFeatures.java`
- Annotations: Spring bean markers, `@Entity`/`@Table` (table mapping), JPA
  column/relation mappings, `@RequestMapping`/`@GetMapping`-family routes (class base path +
  method route composed, `@Value` config injection) — `AdvancedFeatures.java`
- Method invocations (`qualified_calls` + `Calls` edges), object instantiation,
  streams/lambdas (`mapXs.stream().map(…).collect(…)` chains) — `AdvancedFeatures.java`
- `this`/`super` field access reads resolved to the enclosing METHOD (M49 W15 #814; they
  resolved to the enclosing type before the ruling) — `AdvancedFeatures.java`
- Phantom symbols: Spring Data repositories (`JpaRepository`/`CrudRepository` default methods),
  Lombok `@Data`/`@Getter`/`@Setter` accessors — `UserService.java`

## Unsupported / explicit-unknown constructs

- **Cross-file override targets** (resolved, fixture `UserService.java`): the analyzer is
  per-file, but accepts an optional project context (`AnalyzeContext.overrideCompanion` — owner
  type → declared method names) built by the caller from previously parsed files
  (`src/ast/override-context.ts`, shared with the Kotlin analyzer). With context, the override
  target is resolved by the 0.85 `companion-index` tier. Without context the analyzer
  deterministically falls to the 0.5 `first-parent-guess` tier — the honest per-file default,
  since the true declaring parent is unknowable from one file alone. The M12 harness feeds the
  companion index (pre-pass over the fixture corpus); production wiring of the same context from
  the indexer's global symbol space is tracked by M12.44.
- Static imports of specific members: `import static` metadata captured; member-level import
  resolution is not expanded into per-member symbols (explicit non-goal for M12.02).
- Annotation-processor-generated code (beyond the two phantom generators above) is not
  materialized.
- ERROR-node parameter text (malformed source) is recovered best-effort; recovered types are
  heuristic (`unknown` when nothing is derivable). The ERROR-node recovery path this file used
  to classify two regexes against no longer exists — see *Regex inventory*.

## Regex inventory

Re-measured 2026-10-02 with the repository's own scanner
(`script/m12/regex-census-core.ts` via `script/m12/census-truth.ts scanHeadAnalyzers()`, which
scans the **committed** analyzer blobs):

| File | HEAD regex usages | Census entries |
| --- | --- | --- |
| `real-java-analyzer.ts` | **0** | 0 |

**This section previously carried a census table with two rows — `/\s+/` at line 1145 and
`/@[\w\.]+\s*/g` at line 1156, both classified `unavoidable` for "ERROR-node recovery". Both
rows are stale.** The strings do not occur in the file at HEAD; the ERROR-node parameter
recovery they belonged to has been rewritten without regex. The M12.01 baseline of **18
usages** is the documented history and is not reproducible from the committed artifact (the
census records `totalRegexUsages: 26` tree-wide and no per-file pre-state), so the 18 → 0
reduction is history, not a re-derived measurement.

Rule: **zero unclassified regex** — and for this lane, zero regex at all. The census gate
(`bun script/m12/verify-regex-census.ts`) is red **tree-wide** right now
(`missing from census: 24, stale in census: 25`); none of those 49 findings are java's, so this
lane's zero is a per-file measurement and not a claim that the policy gate passes.

## Complexity envelope

`validation/m12/results/java-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 4 | 40 | 78 | 160.2 | 249.7 | 486.9 | 177.9 MB |
| corpus subset (intellij-community @ cfda6881) | 400 | 7812 | 30483 | 4462.7 | 1750.5 | 6830.6 | 512.6 MB |

Declared budget: fixture wall < 500 ms; corpus subset (400 files) < 15 s, symbols/s ≥ 1,000,
relationships/s ≥ 4,000. **Both runs are inside it against the artifact as written.** The
budget itself is declared here rather than in a machine-readable gate — there is no
`java-perf-gate.ts` in `script/m60/`, so "Met" means "met when that artifact was written",
not "enforced today".

Hot-path audit: single-pass iterative stack walk (no recursion), O(N) with pre-built `Map`
lookups — `symbolMap` (FQN + local name), `classHierarchy`; override resolution is BFS over
the class hierarchy with a `seen` set and a suffix index built ONCE per file (the M12
`script/m12` review note records the fix from O(T·C) to O(C) plus an index cursor instead of
`queue.shift()`), bounded by hierarchy depth rather than symbol count; field-access collection
is one extra O(N) walk with a `seen` set for edge dedupe. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/java.json` (authority: `manual_audit` of fixture
  semantics — types, inheritance, method contracts — cross-checked against
  `validation/m11/ground-truth/jvm-symbols.json`)
- Result: `validation/m12/results/java-differential.json` — **no `bbSeal`, so this file is not
  sealed**; it records 24 declared input hashes and **7 of them no longer match** the working
  tree (`src/ast/engine.ts`, `src/ast/analysis-exclusions.ts`,
  `src/ast/framework-intelligence.ts`, `src/ast/language-detection.ts`,
  `src/ast/override-context.ts`, `src/brain/database.ts`, `src/brain/schema-ddl.ts`).
  **`src/ast/real-java-analyzer.ts` itself has NOT changed**, which is why this lane's numbers
  are more usable than most — but the engine it runs inside has.
- Fixtures the run reads: `AdvancedFeatures.java`, `BaseService.java`, `Repository.java`,
  `UserService.java`.

**The claim this section previously made — "Precision 1.000 / Recall 1.000 over 116 facts: TP
116, FP 0, FN 0, unknown 0, unsupported 0" — is false against the committed artifact.** What
the artifact records:

| Field | Value |
| --- | --- |
| `passed` | **false** |
| expected facts | 116 |
| observed resolved | 153 |
| true positives | 112 |
| **false positives** | **41** |
| **false negatives** | **4** |
| unknown | 4 |
| unsupported | 0 |
| **precision** | **0.7320** |
| **recall** | **0.9655** |
| `earliestFailingLayer` | `ast_extraction` |

The 116-fact denominator is right; the ratios were not. The recorded false positives are
mostly **relationships the analyzer emits that the hand-audited ground truth does not list** —
`contains:Point:x`, `contains:Point:y`, and eight `references:AdvancedFeatures:<JDK type>` rows
(`String`, `Integer`, `List`, `R`, `Status`, `Point`). Read strictly, those are **oracle
coverage gaps, not analyzer defects**: the ground truth file was hand-audited for types,
inheritance and method contracts and simply does not enumerate every `contains` and every
type-reference edge. The artifact does not adjudicate them, and this document does not either.
The recorded false negatives are `uses:Status:ACTIVE`, `uses:Status:PENDING` (both also listed
as `unknown`) and two `overrides` rows — `overrides:User.getId:Entity.getId`,
`overrides:User.getName:Entity.getName` — the override tier being unresolved at the time.
`earliestFailingLayer: ast_extraction` means the harness attributes the divergence to symbol
extraction, not to the relationship pass.

**Evidence level: L1 at best and stale by the contract's own rule** (§2 L0 is "stale evidence
— evidence commit ≠ current HEAD"). A current figure requires re-running
`bun script/m12/verify-analyzer.ts java`, and it additionally requires adjudicating whether
those 41 rows are oracle gaps; a re-run alone would reproduce them.

Facts are compared **as emitted** — the harness performs no post-processing; the companion
index is fed to the analyzer as input context (mirroring the production indexer's global symbol
space).

Baseline (M12.01): precision 0.790 / recall 0.754 — defects fixed: package-name reference
sources, missing `extends`/`implements` on generic-bounded classes (type-arg stripping),
override targets mangled by generic suffixes, unresolved `this` receivers. Also verified true
during the M12.02 deep audit: `instantiates UserService → HashMap` (diamond `new HashMap<>()` —
previously missed because the type parses as `generic_type`; +511 corpus relationships).

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `intellij_community@cfda6881ef1c86081f9ad4f993906b84004b65f2` (local clone, repo state dirty — unrelated `.agents/skills` deletions; Java sources intact)
- Measured subset: first 400 tracked `*.java` files (lexicographic, deterministic at the
  pinned revision) — `validation/m12/results/java-corpus-sample.txt`; `trackedFilesInCorpus`
  90,564
- `validation/m12/results/java-corpus-errors.json`: **400 files measured, 400 clean,
  0 files with ERROR nodes, 0 missing-node files, 0 crash files, 13,421 ms wall.**
- **One word of this document's claim is not backed by the artifact: "0 timeouts".**
  `java-corpus-errors.json` has no `timeouts` key at all — its `mode` is a deterministic
  first-400 sort with no per-file deadline, so a timeout count was never recorded either way.
  The 0-crash and 0-grammar-error figures are recorded; the 0-timeouts figure is not.
- The manifest's `measured` block for java records `precision: 1, recall: 1`. **That row
  contradicts the differential artifact above** and this document does not repeat it as truth.
  What would close it: regenerate the manifest from the same run that regenerates the
  differential.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/java/` (UserService.java, BaseService.java,
  Repository.java, AdvancedFeatures.java)
- Ground truth: `validation/m12/ground-truth/java.json`
- Differential: `validation/m12/results/java-differential.json` — **unsealed, 7/24 inputs drifted**
- Complexity: `validation/m12/results/java-complexity.json`
- Corpus errors: `validation/m12/results/java-corpus-errors.json`
- Corpus sample list: `validation/m12/results/java-corpus-sample.txt`
- Grammar provenance: `validation/m60/results/G-PROVENANCE.json`
- Gate scripts: `script/m12/verify-analyzer.ts`, `script/m12/measure-analyzer.ts`,
  `script/m12/verify-regex-census.ts`, `script/m60/find-grammar-provenance.ts`
- Docs: this file

## Issue

Closes M12.02 (GitHub issue #141).
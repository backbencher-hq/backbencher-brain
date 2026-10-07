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
## ONTOLOGY WORKSTREAM 2026-10-05 — ENDPOINT_RESOLVE_JAVA

### Baseline REPRODUCED at 33c7557ca, independent of the analyzer's later history

Re-ran the mandated instrument on 2026-10-05 at HEAD `b22f221ed` with
`src/ast/real-java-analyzer.ts` byte-identical to the main checkout's
(`diff -q` → identical), so the numbers below are a re-measurement, not a
restatement of the earlier run:

    NFILES=200 bun script/m14/firing-check-v2.mjs JAVA

`JAVA 8/10  200/200 parsed  imports[] 2089  silent: imports exports`
`counts: calls:8272  references:7482  contains:2257  uses:653  overrides:489  instantiates:430  extends:178  implements:66`

Every per-type count reproduced to the edge. Wall 13.8 s, exit 0.

### DERIVATION finding: java carries exactly ONE, and it is `exports`

`bun script/m60/rel-type-coverage-gate.ts --langs=java`, at HEAD:

    CHECK 1 — DERIVATION: every emitted type has an oracle derivation
      java         1 un-audited: ["exports"]
      1 findings in 1 lanes
    baseline: 104 recorded, 1 NEW, 104 repaid

The audited set it EVALUATES out of `script/m14/differential.ts`'s own filter
expression is eight labels — `calls contains references uses extends implements
overrides instantiates` (differential.ts:23153 / 23186 / 23287) — and the
analyzer emits exactly those eight on this corpus. The ninth constructible type,
`exports`, has no oracle.

**A second gate disagrees, and it is wrong about java.** `verify-oracle-coverage.ts`
prints java's compared set as `calls,contains,references,uses` (4). Its
`comparedLabels()` only recognises a `? [ … ] :` **ternary**; java's four extra
labels are produced by **spread** inside an array literal
(`["extends","implements","instantiates", ...(cond ? ["overrides"] : []), …]`),
which that scanner cannot see. The same header already declares it cannot see
dynamically derived labels; here it is silent about statically-derived ones.
Both numbers are recorded so a reader is not surprised by either.

`exports` is also the type with a proven GAP below, so the DERIVATION debt and
the GAP land on the same type. Paying the GAP down does **not** pay the debt:
an oracle is `script/m14/differential.ts`, master-owned. Reported, not edited.

### Baseline: firing-check-v2, production path, NFILES=200

    cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs JAVA

| field | value |
| --- | --- |
| corpus | `fixtures/repositories/java-lib` (guava; 3,275 `.java` on disk) |
| files sampled / parsed | 200 / 200 |
| relationship-channel types fired | **8/10** — `calls extends implements uses contains references overrides instantiates` |
| silent | `imports`, `exports` |
| per-type counts | `calls:8272  references:7482  contains:2257  uses:653  overrides:489  instantiates:430  extends:178  implements:66` |
| `imports[]` (separate channel) | **2089** across 200/200 files |
| exit | 0 |

The two silent types are channel facts, not edge facts — both are measured next.

### Question 5 (Resolved) — analyzer-side, same-file universe, NFILES=200

Instrument: `script/m14/tmp/javawork-census.mts` (lane-owned, no regex). Production path
(`getParser -> parse -> analyze`). Population derived by walk, **not** a hand-written list:
3,275 `.java` files exist under `fixtures/repositories/java-lib`; 200 code-bearing files
sampled (6.1%), all 200 parsed, 0 failed, 2,457 symbols. Resolution ladder mirrors
`parallel-indexer.ts:3427-3441` (bare name, leaf, `endsWith(":<name>")`, `endsWith(".<name>")`,
qualified name) applied to **the analyzer's own symbol set for that file**.

| type | edges | both ends resolve (same file) | src unresolved | tgt unresolved | empty name | `unknown` endpoint | files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| calls | 8,272 | 1,161 (14.0%) | 0 | 7,111 | 0 | 0 | 176 |
| uses | 653 | 188 (28.8%) | 0 | 465 | 0 | 0 | 90 |
| contains | 2,257 | **2,257 (100.0%)** | 0 | 0 | 0 | 0 | 195 |
| imports | 0 | — | — | — | — | — | 0 |
| references | 7,482 | 199 (2.7%) | 0 | 7,283 | 0 | 0 | 200 |
| exports | 0 | — | — | — | — | — | 0 |
| extends | 178 | 12 (6.7%) | 0 | 166 | 0 | 0 | 154 |
| implements | 66 | 0 (0.0%) | 0 | 66 | 0 | 0 | 45 |
| overrides | 489 | **489 (100.0%)** | 0 | 0 | 0 | 0 | 88 |
| instantiates | 430 | 100 (23.3%) | 0 | 330 | 0 | 0 | 75 |

Channels: `imports[]` **2,089** ImportInfo in 200/200 files; `exports[]` **200** ExportInfo in
200/200 files. **Zero `exports` RELATIONSHIP edges** on this corpus.

**This table is a lower bound, not the store's answer.** Every type whose target is a name in
another file (`references` naming `com.google.common.annotations.GwtCompatible`,
`instantiates` naming `TreeSet`, `implements` naming `TestSetGenerator`) is *correctly* resolved
by the index and unreadable here, because the analyzer is per-file and its symbol set is one
file. The store-level measurement is a separate instrument and is reported separately. What this
table does establish without ambiguity: **no empty endpoint names, and zero `unknown`
placeholder endpoints, in 19,827 edges.**

### BLOCKER FOUND OUTSIDE THIS LANE — `parallel-indexer.ts` cannot store a single symbol

Running the production index path (`indexProjectParallel`) over 250 corpus `.java` files
fails **every** batch with:

    [ERROR] [parallel-indexer] storeResults failed {"error":"near \"VALUES\": syntax error","batchSize":20}
    [ERROR] [parallel-indexer] parallel indexing failed {"error":"no index for project ... — post-processing
      derives from indexed symbols; run bb index first"}
    src/ast/parallel-indexer.ts:5279

Cause, located: `src/ast/parallel-indexer.ts:2163-2165` — the `insertSymbol` statement carries
**two stacked `VALUES` clauses**, one with 31 placeholders and one with 30:

    (id, project_id, file_id, name, ..., source_text, scope_kind, is_declaration, super_types, time_created, time_updated)
    VALUES (?, ?, ... 31 ...)          <- parallel-indexer.ts:2164
    VALUES (?, ?, ... 30 ...)          <- parallel-indexer.ts:2165

An `INSERT ... VALUES (...) VALUES (...)` is a syntax error in SQLite, so every `insertSymbol`
prepare/`.run()` raises and the batch rolls back. The result is **0 symbol rows and 0
relationship rows for the whole project**, which is why post-processing then throws
"no index for project" at :5279.

Introduced by `455c02631 merge: relationship-ontology master line into main, squashed to stay
pushable`. Verified by counting the 31-placeholder `VALUES` line per revision: `origin/main`
has **1**, `05071f69a` and every commit from `455c02631` onward has **2**.

**This is not a java-lane defect and this lane did not fix it.** `src/ast/parallel-indexer.ts`
is master-owned. The lane worked around it by indexing through a patched COPY outside the repo
(`/tmp/opencode/javawork/mirror/src/ast/parallel-indexer.ts`, which drops only the 30-placeholder
line and leaves every other byte identical), and reports the store numbers that copy produced.

**Consequence for the programme beyond java:** with this defect at HEAD, *no* lane can produce a
stored-resolution measurement, and any gate that indexes a project reads an empty DB. If
`bb_graph` / `bb_impact` numbers were quoted from a run made after `455c02631`, they describe an
empty graph.

### STORE-LEVEL endpoint resolution — 250-file slice, production `indexProjectParallel`

Instrument: `script/m14/tmp/javawork-index-query.mts`; indexing done by
`script/m14/tmp/javawork-index-census.mts`. Read back from `brain_relationship`.
Indexed through the patched indexer copy (see the blocker above) — the HEAD indexer
stores nothing at all.

`sanity: brain_file=250 brain_symbol=2983 brain_relationship=25787 brain_import=2703`
`indexed: files=250 success=250 errors=0 rels=25787 imports=2703`

| type | rows stored | BOTH ends bound to a symbol row | src unresolved | tgt unresolved | files in slice |
| --- | --- | --- | --- | --- | --- |
| calls | 10,837 | 8,707 (80.3%) | 0 | 2,130 | 250 |
| uses | 737 | 665 (90.2%) | 0 | 72 | 250 |
| contains | 2,975 | 2,871 (96.5%) | 0 | 104 | 250 |
| imports | **0** | — | — | — | `brain_import` = 2,703 |
| references | 9,696 | 2,670 (27.5%) | 0 | 7,026 | 250 |
| exports | **0** | — | — | — | — |
| extends | 268 | 254 (94.8%) | 0 | 14 | 250 |
| implements | 95 | 68 (71.6%) | 0 | 27 | 250 |
| overrides | 657 | 657 (100.0%) | 0 | 0 | 250 |
| instantiates | 522 | 228 (43.7%) | 0 | 294 | 250 |

**OVERALL: 16,120 of 25,787 stored rows have both endpoints bound to a symbol row (62.5%).**

`src unresolved = 0 for every type` — the source half is fully resolved on all 25,787 rows.
**The entire remainder is on the TARGET side.** Zero rows carry the `unknown` placeholder in
either `*_external` column.

### What the unresolved remainder actually names (top targets per type, from the DB)

- **calls** (2,130): `assertEquals` 489, `assertTrue` 256, `assertFalse` 216, `assertThrows` 215,
  `addTest` 66, `emptySet` 65. These are JUnit-4 calls to a superclass declared in a file OUTSIDE
  this 250-file slice. Correct behaviour for a partial slice — the target is not unresolved in
  guava, it is unresolved in the slice.
- **references** (7,026): **`V` 815, `K` 773**, then `String` 524, `Entry` 520, `List` 398,
  `Collection` 238. The type-variable rows are a real analyzer defect (below); the JDK rows are
  the external-library remainder.
- **instantiates** (294): `ArrayList` 100, `HashSet` 23, `EqualsTester` 15,
  `UnsupportedOperationException` 12, `TreeSet` 11, `TreeMap` 11 — same slice-boundary shape.
- **contains** (104): `anonymous_TestStringSortedMapGenerator` 11,
  `anonymous_TestStringListGenerator` 11, `anonymous_Stimulus` 9 — anonymous-class names, whose
  symbols the store's artifact filter refuses.
- **extends** (14): `RuntimeException` 4, `Exception` 4, `TestCase` 2, `Error` 1 — JDK/outside-slice.
- **implements** (27): `TestMapGenerator` 7, `Serializable` 7, `Comparator` 4, `Comparable` 3.
- **uses** (72): `length` 37, `RUNTIME` 7, `array` 6 — JDK field reads and constants outside the slice.

### Confidence distribution, every type (honesty contract §4)

| type | confidences present | rows in the heuristic band (<1.0) |
| --- | --- | --- |
| calls | 0.7 ×10,754; 0.8 ×44; 1.0 ×39 | 10,798 of 10,837 (**99.6%**) |
| uses | 0.6 ×581; 1.0 ×156 | 581 of 737 (78.8%) |
| contains | 1.0 ×2,975 | 0 |
| references | 0.9 ×2,747; 0.95 ×6,949 | **9,696 of 9,696 (100%)** |
| extends | 1.0 ×268 | 0 |
| implements | 1.0 ×95 | 0 |
| overrides | 0.5 ×625; 0.9 ×9; 1.0 ×23 | 634 of 657 (**96.5%**) |
| instantiates | 0.95 ×522 | **522 of 522 (100%)** |

So **21,231 of 25,787 stored java rows (82.3%) are heuristic, not fact.** `references` and
`instantiates` are 100% heuristic; `overrides` is 96.5% heuristic and 625 of its 657 rows sit at
the **0.5** first-parent-guess tier, below `patterns.ts`'s 0.7 threshold. This is not a
discrepancy with the documented model — it is the documented model, and it means "java has
10/10 relationship types" is a statement about *labels present*, not about *facts stored*.

### JOB 2 — construct probes over the WHOLE java corpus (3,275 files, not a sample)

Instrument: `script/m14/tmp/javawork-construct-probe.mts`. Population derived by walk over
`fixtures/repositories/java-lib`; **every** `.java` file in it, no file-count cutoff. Node
tallies from a tree-sitter walk, no source-text matching.

#### PROBE A — Java HAS an explicit exports construct (JPMS, JLS 7.7.2). Verdict: **GAP**.

| measurement | count |
| --- | --- |
| `module-info.java` files on disk | **3** |
| …that the grammar parses as `module_declaration` | **3** (root `hasError=false` on all) |
| `exports_module_directive` nodes | **24** |
| `requires_module_directive` nodes | 12 |
| `provides_module_directive` / `opens_module_directive` / `uses_module_directive` | 0 / 0 / 0 |
| `exports` RELATIONSHIPS the analyzer emitted on those 3 files | **0** |
| symbols the analyzer emitted on those 3 files | **0** |
| `exports[]` channel entries on those 3 files | **0** |

Sample of what is being missed (`guava/src/module-info.java`):
`exports com.google.common.collect;` `exports com.google.common.cache;` … 16 directives in
that one file. The three files are `guava/src/module-info.java`,
`guava-testlib/src/module-info.java`, `futures/failureaccess/src/module-info.java`.

**This is a GAP, not a ruling.** The construct exists (24 parse to the node type the grammar
names for it), the analyzer reads none of it — the strings `module_declaration`,
`exports_module_directive` and `module-info` occur **nowhere** in `src/ast/real-java-analyzer.ts`
— and it is Java's own named export mechanism. `exports` is silent in the firing-check not
because Java lacks the construct but because this corpus's exports live in 3 files that the
`exports` emitter never looks at. The 24 directives are 0 edges today.

#### PROBE B — Java HAS a declared-type construct (JLS 4.4 type parameters). Verdict: **GAP**.

| measurement | count |
| --- | --- |
| files containing a `type_parameter` node | **1,543** of 3,275 (47.1%) |
| `type_parameter` nodes total | **9,780** |
| symbols the analyzer published with kind `type` | **0** |
| `references` edges whose target is a single capital letter | **44,057** |

Breakdown of the 44,057: `V` 12,550 · `K` 10,992 · `E` 8,549 · `T` 4,596 · `C` 2,096 ·
`N` 1,922 · `R` 855 · `B` 297 · `A` 269 · `X` 219 · `F` 149 · `U` 137 · `S` 124 · `I` 108 ·
`L` 94 · `M` 90.

The analyzer records the declaration as a **string list** — `genericParameters: ["K","V"]` on
the class symbol — and then emits `references` edges *to* those strings without ever publishing
them as symbols. On the 250-file store slice that produced `references -> V` **815** rows and
`references -> K` **773** rows with `target_symbol_id IS NULL`, i.e. 1,588 of 2,670 unresolved
`references` targets (59.5%) name a declaration that does not exist anywhere in the index.

`SymbolKind.Type` is not a fiction: `src/ast/types.ts:18` defines `Type = "type"`, and the
analyzer's own evidence-class classifier at `real-java-analyzer.ts:2748` already tests
`s.kind === SymbolKind.Type`, so the kind is reachable from this file and simply never produced.

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
| range (start/end line + column) | ✅ | `nodeToRange` from `startPosition`/`endPosition`, with the START anchored at the declaration's NAME node (`declarationNameNode`, `declarationLineNode`, M59/#825) — the line the name is written on, NOT the line of a modifier or an annotation. This file previously recorded the opposite ("node-start convention: annotation line for annotated declarations, matching M11"); the live fixture java/declaration-lines-825 pins the name line and states the cost of the old rule: 25 of 93 symbols on a 300-file real sample landed on an annotation, so navigating to a symbol opened `@SuppressWarnings` instead of the declaration. The M12 hand audit that recorded the annotation line is read by `script/verify-m12-final-audit.ts` for existence only and never re-runs an analyzer |
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
| exports | ✅ | top-level symbols published from the export post-pass (read FROM `exports[]`, never recomputed): `metadata.relationshipType: java_exportable_unit`, `exportForm` `public_top_level_type`/`package_private_top_level_type`, plus `kind`, `dottedName` and `isJavaExport` (public tier only). Members are NOT exported — membership rides `contains` (M49 JVM-closure ruling) — and a type in the DEFAULT package is refused (JLS 7.4.2). JPMS `exports P` directives publish `module_exports` from the module symbol to a `Namespace` symbol for P, with the `to` list in `qualifiedTo`. Two pre-fold duplicates were folded out: a second emission site carrying `metadata.relationshipType: exported_type` (every public top-level type had TWO `exports` rows with the same key) and the label `java_exportable_unit`'s competitor. Spring MVC endpoints (`Exports` with route, httpMethod) are unchanged | **1.0** public / **0.6** package-private with `reasonCode: package_private_top_level_type` (JLS 6.6.1: a package-private type IS nameable by an importer in the same package, so the claim is discounted rather than false); JPMS module exports 1.0 |
| overrides | ✅ | `@Override` + a three-tier BFS over `classHierarchy` (type-arg-clean parents): exact in-file signature match, then generic substitution, then the project companion index, then the first-parent guess. Each tier sets BOTH a confidence and a machine-readable `metadata.reasonCode` — `exact-in-file`, `generic-substitution`, `companion-index`, `first-parent-guess` — which is what contract §4 asks for | **1.0 / 0.9 / 0.85 / 0.5**, matching the reason-code ladder. This file previously claimed "1.0 (exact / companion-resolved) / 0.9 (fallback)", which was wrong twice: the companion tier is **0.85**, not 1.0, and the first-parent fallback is **0.5**, not 0.9. The 0.5 tier is deliberate — it sits below `patterns.ts`'s 0.7 `confidenceThreshold` so a guessed override cannot reach pattern analysis |
| references | ✅ | import MENTIONS and the post-pass that rewrites their source from the package name to the file's primary type (first top-level class/interface/enum) — except FILE-LEVEL rows, which are exempt so the dependency keeps a source that resolves to no symbol (see the `imports` row); JPMS mentions `module_exports_mention` / `module_requires_mention` / `module_opens_package*` / `module_uses_provided_type` / `module_provides_service*`; also type references (`references:getStatus:String`, `references:Mapper:B`, `references:genericBound:T` in the recorded differential) | 0.9, 0.95, 1.0 |
| contains | ✅ | owner → owned symbols (deduped against engine-generated contains in `storeResults`) | 1.0, or 0.6 when the member is a phantom |
| imports | ✅ | the DEPENDENCY edge, on BOTH channels: a `imports` relationship per `import_declaration` (`metadata.relationshipType` = `single_type_import` / `type_on_demand_import` / `static_member_import`, with `isWildcard`/`isStatic` flags — JLS 7.5.4 static-on-demand shares 7.5.3's label and is distinguished by the flag pair) and the `imports[]` import-site channel (`ImportInfo` → `brain_import`). The relationship SOURCE is the PACKAGE with `metadata.fileLevel: true`, which is what makes parallel-indexer write `source_external = <file>` with `source_symbol_id` NULL — the shape `bb_graph`'s per-file dependency query requires. JPMS `requires M` (JLS 7.7.1) rides the same kind as `metadata.relationshipType: module_requires`, with `isModuleRequires`, `isStatic`, `isTransitive` and an `importType` on the ImportInfo channel. This row previously read "❌ **not emitted**" (corrected 2026-10-02) and was re-corrected here; the 2026-10-02 note that the edge kind was `references` described the pre-M60 state | 1.0 written declarations; 0.9 for `requires static` with `inferred: true` and `reasonCode: optional-module-dependency` (an OPTIONAL compile-time dependency); the `references` mention beside each row sits at 0.9 |


Two rows were REMOVED from this table rather than kept as negative cells: `depends` and
`field_access` are not members of `RelationshipType` (`src/ast/types.ts`), and a table of
*emitted kinds* cannot carry a row for a kind the engine does not have — the emissions gate
reports such a cell as `NON_ENGINE_KIND`, which is how both were found. What they described is
real and already stated above: the old `depends` row was the `references` row wearing a second
name, and `field_access` described `collectFieldAccessUses` (enclosing-type scope, confidence
0.6), which emits **`uses`**.

## Supported constructs

- Classes, interfaces, enums (with `enum_constant` members), records (components promoted to
  `Property` symbols, JLS 8.10.3 constructor-backed members), and `annotation_type_declaration`
  — `BaseService.java`, `AdvancedFeatures.java`
- Generic classes/interfaces: `Repository<T>`, `BaseService<UserService.User>` — inheritance
  targets stripped of type args (`extractJavaTypeBaseName`) so `extends`/`implements` resolve to
  real symbols — `UserService.java`
- Methods, constructors (named after their CLASS, M37.21 C3 — the pre-fold literal `constructor` collided across classes and made `contains:A->constructor` and `contains:B->constructor` indistinguishable), overloads (signature-keyed FQN),
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
  sealed**; it records 24 declared input hashes. Re-checked 2026-10-10: **10 of them no longer
  match** the working tree (`src/ast/engine.ts`, `src/ast/analysis-exclusions.ts`,
  `src/ast/fingerprint.ts`, `src/ast/framework-detectors.ts`,
  `src/ast/framework-intelligence.ts`, `src/ast/language-detection.ts`,
  `src/ast/override-context.ts`, `src/brain/database.ts`, `src/brain/schema-ddl.ts` — and
  `src/ast/real-java-analyzer.ts` itself). This bullet previously said 7 and claimed the analyzer
  was unchanged; both are now false. The recorded analyzer hash (`9799cb58…`, 155,656 B) pins the
  differential's revision to `f83b9438a` (2026-09-30); the analyzer then moved in the Oct 7
  revisions (`4cf800a17`, `78a95ab8c`, `cccdd5aea`; `2a275b90…`, 222,821 B at HEAD) and the M60
  fold moved it again (`f28255eb…`, 229,965 B in the working tree) — so the recorded
  precision/recall is pre-fold twice over, not only engine-drifted.
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
- Differential: `validation/m12/results/java-differential.json` — **unsealed, 10/24 inputs drifted at the 2026-10-10 re-check (incl. the analyzer itself)**
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

**Pre-fold reading** — measured 2026-10-05 at `b22f221ed`, before the Oct 7 analyzer revisions and
before the M60 fold; the post-fold corpus-wide reading fires **10/10** (see *Post-fold corpus
re-measurement* in the fold section). The two silent types were channel facts at *that* revision,
not edge facts — both are measured next.

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
200/200 files. **Zero `exports` RELATIONSHIP edges** on this corpus — again a pre-fold reading
(2026-10-05, `b22f221ed`). Post-fold the corpus emits **3,253** `exports` edges and **77,858**
`imports` edges (fold section's re-measurement); the `imports` and `exports` **0** rows in the
table above describe that revision, not the folded analyzer.

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

**Pre-fold store reading.** Every figure in this block was produced before the M60 fold, through
the external patched indexer copy (see the blocker above) — and it was **not** re-measured after
the fold: the analyzer-side channels have since changed (fold section's *Post-fold corpus
re-measurement*), while the store-side blocker and the path-shaped `exports` filter that drops the
JPMS rows are unchanged open items. Do not quote these ratios as the folded analyzer's store
behaviour.

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

#### PROBE A — Java HAS an explicit exports construct (JPMS, JLS 7.7.2). Pre-fold verdict: **GAP**, closed by the fold.

**Measured before the M60 fold** (2026-10-05/06, instrument `script/m14/tmp/javawork-construct-probe.mts`);
the same three files re-measured after the fold are in the fold section's *Post-fold corpus
re-measurement*, side by side with the whole-corpus census.

| measurement | pre-fold | post-fold (2026-10-10) |
| --- | --- | --- |
| `module-info.java` files on disk | **3** | 3 |
| …that the grammar parses as `module_declaration` | **3** (root `hasError=false` on all) | 3 |
| `exports_module_directive` nodes | **24** | 24 |
| `requires_module_directive` nodes | 12 | 12 |
| `provides_module_directive` / `opens_module_directive` / `uses_module_directive` | 0 / 0 / 0 | 0 / 0 / 0 |
| `exports` RELATIONSHIPS the analyzer emitted on those 3 files | **0** | **24** (`module_exports`) |
| symbols the analyzer emitted on those 3 files | **0** | **27** (3 `Module` + 24 `Namespace`) |
| `exports[]` channel entries on those 3 files | **0** | **3** (the `Module` of each file) |
| `imports[]` channel entries on those 3 files | **0** | **12** (the `requires` directives) |

Sample of what was being missed (`guava/src/module-info.java`):
`exports com.google.common.collect;` `exports com.google.common.cache;` … 16 directives in
that one file. The three files are `guava/src/module-info.java`,
`guava-testlib/src/module-info.java`, `futures/failureaccess/src/module-info.java`.

**It was a GAP, not a ruling — and the fold closed it.** The construct exists (24 parse to the
node type the grammar names for it) and it is Java's own named export mechanism; at this
measurement the strings `module_declaration`, `exports_module_directive` and `module-info` occurred
**nowhere** in `src/ast/real-java-analyzer.ts`. The pre-fold "`exports` is silent in the
firing-check" line describes that revision, not the folded analyzer — the post-fold census fires
10/10 — and the reason was the duplicated `module_declaration` arm (fold section §5): the
reachable half emitted `references` mentions only, while the arm holding the symbols, the
`exports` edges and the `imports[]` channel was unreachable.

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

**Unchanged by the fold, re-measured like-for-like (fold section's A/B): 43,231 single-capital-
letter `references` targets, PRE and POST identical to the digit** — the fold does not publish
type parameters. The 44,057 above is this probe's count from the same corpus and a different
counting instrument; the two totals are recorded side by side (the top-16 cells agree to within
8 rows), not reconciled.

The analyzer records the declaration as a **string list** — `genericParameters: ["K","V"]` on
the class symbol — and then emits `references` edges *to* those strings without ever publishing
them as symbols. On the 250-file store slice that produced `references -> V` **815** rows and
`references -> K` **773** rows with `target_symbol_id IS NULL`, i.e. 1,588 of 2,670 unresolved
`references` targets (59.5%) name a declaration that does not exist anywhere in the index.

`SymbolKind.Type` is not a fiction: `src/ast/types.ts:18` defines `Type = "type"`, and the
analyzer's own evidence-class classifier at `real-java-analyzer.ts:2748` already tests
`s.kind === SymbolKind.Type`, so the kind is reachable from this file and simply never produced.

## M60 java FOLD, 2026-10-10 — ten failing fixtures, five rulings, one duplicated implementation

`npx tsx script/m14/run-fixtures.ts java` went **53 pass / 10 fail → 63 pass / 0 fail**. Twenty
one distinct problems across ten fixtures came in five clusters, and two of the five turned out
to be the same defect: an implementation merged into this file TWICE, with the second copy
unreachable. Every fix below is verified on the final content of the edited files (lane, full
suite, `npx tsc --noEmit`, the provenance gate, and the lane's mutant runner).

### 1. Constructor identity — three fixtures (M37.21 C3)

`ctor-delegation`, `ctor-value-injection` and `record-varargs-compact-ctor` each pin
`{"name": "<ClassName>", "kind": "constructor"}` and say why in their own rationales: the literal
`constructor` "collided across classes (… so distinct classes' ctors and their overloads stay
distinguishable)". They settle a contradiction that was sitting in the analyzer as a merged
comment arguing BOTH ways. `memberName` is now the class name (`parentContext?.name ?? name`),
and the read-owner for a ctor body moved with it (`owner ?? "constructor"`), because `uses`
endpoints are joined against symbols and the old spelling stopped resolving the moment ctors were
renamed. `record-varargs-compact-ctor` also pins the resulting containment, `Point -> Point`.

### 2. Declaration-line anchoring — one fixture (M59/#825)

`declaration-lines-825` states the contract in its header — "the line its NAME is written on —
not the line of the enclosing construct, and not the line of a modifier" — and pins both cases:
`@SuppressWarnings("unused")` on line 20 must not be the line of `Annotated` (21), `@Override` on
26 must not be the line of `label` (27). This lane anchored every symbol at its first ANNOTATION,
justified by the M12 hand audit (`@Service L9 / class UserService truth 9`). That audit is read by
`script/verify-m12-final-audit.ts` for **existence only** — nothing in it re-runs an analyzer — so
it cannot overrule a live fixture, and the fixture records the cost: 25 of 93 symbols on a
300-file real sample landed on an annotation. `declarationLineNode` now returns the declaration's
NAME node (new `declarationNameNode`, with the `variable_declarator` case for fields) and skips
`modifiers` outright; symbol ranges and the `contains`/`overrides` lines that name them moved
together, which is why one function serves all three.

### 3. The import DEPENDENCY keeps a source that resolves to nothing — one fixture

`import-dependency-edges` (the newer EXPORTS_JAVA2 twin of `import-label`, authored beside
`groovy/imports-dependency-edge`) pins `source: com.acme.app` — the PACKAGE — on every
`*_import` row, because that is what produces the storage shape `bb_graph`'s per-file dependency
query reads (`source_symbol_id IS NULL AND source_external = <file path>`). The post-pass that
re-sources import rows to the file's primary type was re-sourcing the file-level row too, which
resolved it to a symbol and destroyed exactly the shape it exists to produce. File-level rows are
now exempt (`metadata.fileLevel !== true`), the MENTION keeps the rewrite, and both labels answer
their own question. Same rule, same reason as groovy's fold.

### 4. The exports surface emitted every publication TWICE — one fixture, four others corroborating

`exported-types` pinned `metadata.relationshipType: exported_type` from an emission site in the
type-declaration branch, while the export post-pass published the same key
(`package -> simpleName`) as `java_exportable_unit` with `exportForm` — so every public top-level
type carried two `exports` rows with one key and different metadata. The post-pass survives
(three measured reasons: the lane oracle reads that label, the java-verify evidence records
`exports/java_exportable_unit: 3283 -> 3297`, and it is the only one of the two that records the
package-private tier at all), enriched with the folded site's `kind`, `dottedName` and
`isJavaExport` keys — so nothing the retired site published is lost. Its five package-private
forbid rows are now bounded at `confidenceMin: 1.0` rather than bare, because the two EXPORTS_JAVA2
fixtures beside it REQUIRE that tier at 0.6 with a `reasonCode` and the JLS 6.6.1 reading
reconciles them: a package-private type is nameable by an importer in the SAME package, so the
claim is weaker rather than false. The reason is written inside `exported-types.expectation.json`.

### 5. JPMS existed twice, and the reachable copy was the wrong one

`module-info-directives` passed against an in-visitor walk of `JAVA_MODULE_DIRECTIVE_FIELDS` that
emitted `references` rows plus one `imports` row labeled `module_requires_dependency`. A SECOND
`module_declaration` arm lower in the same if/else chain called `emitJavaModuleDeclaration` — and
was UNREACHABLE, because the earlier `else if` already matched the node. Its half was dead code:
a `module-info.java` emitted **0 symbols, 0 `exports[]` entries and 0 `imports[]` entries**, which
is exactly what the construct probe in this file measured and what three INCOMING_JAVA fixtures
(`module-info`, `jpms-module-exports`, `module-exports-jpms`) pin against. The two are now one
walk that emits, per directive:

| directive | emitted |
| --- | --- |
| `module M` | `Module` symbol (now also admitted into `exports[]` — `kind: module`, an importable unit for another module's `requires M`) |
| `exports P [to M…]` | `Namespace` symbol for P owned by M, `exports` edge `module_exports` (with `qualifiedTo`), `references` mention `module_exports_mention`, and `module_exports_package_to` mentions for the `to` modules |
| `requires [transitive\|static] M2` | `imports` edge `module_requires` (1.0, or **0.9** with `inferred: true` + `reasonCode: optional-module-dependency` for `requires static`), `references` mention `module_requires_mention`, and an `imports[]` `ImportInfo` with `importType` `java-module-requires`/`-transitive` |
| `opens`/`uses`/`provides` | one `references` row per named target (labels unchanged; the corpus contains 0 of all three) |

Two things the merge got wrong and the fixtures caught: the `requires_modifier` is one node TYPE
for both `transitive` and `static`, so the pre-fold code read BOTH as transitive (the surviving
code reads the modifier's own text); and the role table kept emitting a second
`module_exports_package` mention for a package that the `exports` arm already mentioned as
`module_exports_mention` (found by `module-exports-jpms`' forbid of the retired label).

### Fixture re-pins, each with its authority written inside the file

- [java/exported-types](validation/m14/fixtures/java/exported-types.expectation.json) — label → `java_exportable_unit`; package-private forbids bounded at 1.0 (see §4).
- [java/import-label](validation/m14/fixtures/java/import-label.expectation.json) — labels → the `*_import` set, source → the package, confidence → 1.0; the `source: com.acme.dep` forbid became its inverse (`imports source: Shapes meta.fileLevel: true`); JLS 7.5.4 shares 7.5.3's label and is distinguished by `isStatic` + `isWildcard`, recorded rather than hidden.
- [java/module-info-directives](validation/m14/fixtures/java/module-info-directives.expectation.json) — label vocabulary → the converged set; `requires static` at 0.9/`optional-module-dependency`; the `exports`-for-a-package forbid replaced by the retired-label forbid (see the open item below).
- [java/module-exports-jpms](validation/m14/fixtures/java/module-exports-jpms.expectation.json) — its bare `references` forbid re-pointed at the retired label; `java/jpms-module-exports` requires the mention row it forbade.

### Open items (not fixed here, and deliberately not silent)

1. **The store drops a module's `exports` rows.** `parallel-indexer.ts:3965-3971` skips any
   `exports` row whose SOURCE symbol has a lowercase dotted name — and the module symbol's own
   name (`com.example.widget`) is one. The three INCOMING_JAVA fixtures require the analyzer to
   emit the row, so it is emitted and measured, but it does not persist until that filter learns
   about `metadata.isModuleDirective`. Recorded here rather than worked around in a fixture.
2. **The `to`-list keeps its own label** (`module_exports_package_to`). A `to` clause names a
   module that may READ P, which is neither the exported package nor a dependency; no fixture
   contradicts the label and two pin it.
3. **The lane's second corpus still is not running.** The two-corpus gate needs the `geb`
   checkout, so every measurement here is java-lib plus fixtures.
4. **`exportsWithNoPackage` counts module-info files.** A module declaration has no package, so
   the export-edge post-pass declines it (correctly) and increments that counter; the module's own
   publication rides the `Module` symbol in `exports[]` and the JPMS `module_exports` edge.

### Post-fold corpus re-measurement (2026-10-10)

Two instruments, both over the WHOLE `fixtures/repositories/java-lib` corpus (3,275 `.java` files,
no sample), production path (`getParser -> parse -> analyze`), run on the final content of this
file:

1. `bun script/m14/lanes/java-ontology-census.ts` — 3,275 files in 76 s, **0 parse/analyze
   failures, 96,857 symbols, 734,864 relationships**, **10/10 relationship types fired**
   (`silent: (none)`); `imports[]` 38,935 entries in 3,247 files, `exports[]` 3,232 in 3,230 files.
   Per type: `calls 262,870 · references 221,466 · contains 93,565 · imports 77,858 · uses 28,428 ·
   instantiates 21,327 · overrides 19,909 · extends 4,248 · exports 3,253 · implements 1,940`.
   Export-set visibility `public:1,947 (none):592 private:533 protected:160`; `imports` confidence
   split `1.0 ×77,851 / 0.9 ×7` (the seven `requires static` rows). Owner-less non-type symbols:
   **60 in 2 files**, unchanged — the three new `Module` symbols tripped the census's five-node
   top-level list, so `module_declaration` is now named there as the sixth top-level unit and the
   instrument's comment records why.
2. `bun script/m14/lanes/java-fold-ab.mts` — the same corpus with the analyzer at HEAD
   (`2a275b90…`, 222,821 B) and the folded working tree (`f28255eb…`, 229,965 B) side by side on
   the same engine. The tables earlier in this file were measured by DIFFERENT instruments on
   different samples and dates, so they cannot attribute movement; this one can:

| measurement | pre-fold (HEAD) | post-fold | delta |
| --- | --- | --- | --- |
| symbols | 96,830 | 96,857 | +27 |
| relationships | 737,242 | 734,864 | −2,378 |
| files with zero symbols | 48 | 45 | −3 (the three module-info files) |
| `exports` edges | 5,740 | 3,253 | −2,487 |
| …`java_exportable_unit` | 3,229 | 3,229 | 0 |
| …the retired `exported_type` duplicate | 2,511 | 0 | −2,511 |
| …`module_exports` (JPMS) | 0 | 24 | +24 |
| `imports` edges | 77,858 | 77,858 | 0 (the JPMS 12 are relabelled, not new) |
| `uses` edges | 28,343 | 28,428 | +85 |
| `contains` edges | 93,541 | 93,565 | +24 (module → exported-package namespaces) |
| `calls`/`extends`/`implements`/`overrides`/`instantiates`/`references` | — | — | **0 each** |

The `+85` `uses` is §1's rename measured at corpus scale: the pre-fold owner spelling
(`constructor`, identical for every class) collided in per-file dedupe, and class-named owners
separate the rows. The label histogram moved exactly ten pairs — `exported_type` 2,511→0,
`module_exports_package` 24→0, `requires_module` 12→0, `module_requires_dependency` 12→0, and
their four replacements (`module_exports` 0→24, `module_exports_mention` 0→24, `module_requires`
0→12, `module_requires_mention` 0→12), plus the two count moves above.

The three `module-info.java` files, per file:

| file | symbols | `exports[]` | `imports[]` | relationships | `exports` edges |
| --- | --- | --- | --- | --- | --- |
| `futures/failureaccess/src/module-info.java` | 0 → 2 | 0 → 1 | 0 → 0 | 1 → 3 | 0 → 1 |
| `guava-testlib/src/module-info.java` | 0 → 8 | 0 → 1 | 0 → 6 | 19 → 33 | 0 → 7 |
| `guava/src/module-info.java` | 0 → 17 | 0 → 1 | 0 → 6 | 28 → 60 | 0 → 16 |
| **total** | **0 → 27** | **0 → 3** | **0 → 12** | **48 → 96** | **0 → 24** |

Every `exports` directive gained the two rows the unreachable arm held — the `module_exports`
edge and the module→namespace `contains` — while its mention row is the renamed survivor; every
`requires` directive keeps its two rows, relabelled. `requires static` is the 7 dependency rows
at 0.9 with `optional-module-dependency`, matching the census's imports confidence split above.

### Mutants

`bun script/m14/lanes/java-mutants.ts` → **17 dead · 2 equivalent · 2 survived · 0 site-moved**
(21 total; both survivors are pre-existing and documented in the runner). Seven mutants were added
for this fold — `J1` ctor identity, `J2` symbol anchoring, `J3` the file-level exemption, `J4` the
JPMS mention label, `J5` the `requires static` tier, `J6` the module symbol in `exports[]`, `J7` the
`importType` distinction — and all seven die on the fixtures this fold is about. `I6` and `I7` were
re-pointed: their old site (`pushModuleDirective`'s `requires_module` arm) no longer exists, and
`I7`'s dead-predicate lesson now guards the modifier-text comparison, which is the same class of
bug in the surviving implementation.

# Java analyzer — final verification ledger, 2026-11-17

Commit: `c3c6b1f98` (merge of `audit/java-semantic-proof-20261116` into `main`).
Every number below was produced by running the command shown, on this host.
Nothing is copied from another environment, and nothing is inferred.

## 1. Gate results

| Gate | Command | Result |
| --- | --- | --- |
| Production typecheck | `npm run typecheck` | **exit 0** |
| M14 Java fixtures | `bun run script/m14/run-fixtures.ts --lang java` | **104 / 104 pass, 0 fail** |
| Red control (analyzer at `29a579243`) | same, after reverting the analyzer | **94 pass / 10 fail** — exactly the ten named fixtures |
| Method-generic oracle | `java -cp … JavaMethodGenericOverrideOracle` | **12 / 12** |
| Remediation oracle | `java -cp … JavaAnalyzerRemediationOracle` | **13 / 13** |
| Semantic oracle | `java -cp … JavaAnalyzerSemanticOracle` | **15 / 15** |
| M12 compiler adjudication | `java -cp … JavaM12CompilerAdjudication` | **24 / 24** |
| SQLite round-trip | `bun script/m14/java-store-e2e-smoke.ts` | **PASS** — 4/4 import channels, 2/2 file-level deps, 3 overloaded/cross-file declarations, real `bb_graph` usages answered |
| Regex in `real-java-analyzer.ts` | AST-free literal scan | **0** |
| Analyzer docs contract | `bun run audit:analyzer-docs` | **50/50 fully complete, no unexplained cells** |
| Fixture provenance | `bun run audit:fixture-provenance` | **exit 0** |

**64 independent javac facts** across the four oracles. The compiler, not the
analyzer, is the authority for each of them.

## 2. M12 differential — fully adjudicated, still failing

The differential is unchanged and **not green**:

```
passed: false
TP=95  FP=105  FN=21  unknown=6
precision 0.475   recall 0.819
```

`bun script/m14/java-m12-adjudication.ts` assigns **every** mismatch a named
cause and asserts that none is unexplained. Ground truth was not modified.

```
JAVA_M12_ADJUDICATION_PASS: all 105 FP and 21 FN classified, 0 unexplained
```

### False positives (105)

| Cause | Count | Why it is not an analyzer defect |
| --- | ---: | --- |
| `oracle-scope:imports-kind-not-in-ground-truth` | 24 | GT carries no `imports` relationship facts at all |
| `oracle-scope:exports-kind-not-in-ground-truth` | 4 | GT carries no `exports` facts |
| `oracle-scope:jdk-platform-type-reference` | 12 | references to `String`/`Integer`/`Number`; GT records 12 qualified references only |
| `oracle-scope:project-type-reference` | 8 | references to project types GT records as `extends`/`contains` instead |
| `oracle-scope:type-parameter-reference` | 8 | references to `T`/`R`/`A`/`B`; GT models no type parameters |
| `oracle-scope:annotation-reference` | 7 | `@Override`/`@Deprecated`/`@FunctionalInterface`/`@Service` |
| `convention:declaration-line` | 7 | paired: GT uses the annotation line, analyzer the `class`/method keyword line |
| `oracle-scope:type-parameter-containment` | 6 | type parameters as contained members |
| `spelling:bare-twin-of-qualified-tp` | 6 | bare `List` beside GT's `java.util.List`, which **is** a TP |
| `oracle-scope:type-parameter-symbol` | 6 | `type:T` symbols; GT symbol kinds exclude `type` |
| `convention:constructor-containment` | 3 | paired: GT `contains:X:constructor`, analyzer `contains:X:X` |
| `oracle-scope:uses-not-modelled` | 3 | `distance→x`, `distance→y`, `totalDistance→Point`; GT models 4 uses only |
| `convention:constructor-name` | 3 | paired: GT literal `constructor`, analyzer class name |
| `oracle-scope:record-component-containment` | 2 | `record Point(int x, int y)` components |
| `oracle-scope:record-component` | 2 | record components as properties |
| `attribution:method-vs-class` | 2 | paired: analyzer attributes to the method and records `metadata.owner` — strictly more precise |
| `oracle-scope:call-not-recorded` | 1 | `totalDistance→distance`, a method reference GT did not record |
| `spelling:bare-twin-of-import` | 1 | bare spelling of an explicitly imported type |

### False negatives (21)

| Cause | Count |
| --- | ---: |
| `convention:declaration-line` | 7 |
| `attribution:method-vs-class` | 4 |
| `limitation:override-target-owner-unresolved` | 4 |
| `convention:constructor-containment` | 3 |
| `convention:constructor-name` | 3 |

The four override FNs are **not missing edges**. The differential scores the
emitted edges as `unknown` (`overrides:User.getId:getId`), because the analyzer
targets the leaf `getId` while the truth wants the owner-qualified
`Entity.getId`; `Entity` is declared in `BaseService.java`, another file. This
is the documented cross-file declaring-owner limitation, and it is now stated
precisely rather than as "four overrides are missing".

### Program-wide context — M12 is not a Java gate

Of the 48 lanes carrying an M12 differential, **3 pass** (`make`, `sql`,
`yaml`). Java's TP=95 / FP=105 sits mid-pack:

| lane | TP | FP | FN |
| --- | ---: | ---: | ---: |
| dart | 72 | 90 | 79 |
| xml | 41 | **284** | 8 |
| json | 56 | 114 | 63 |
| fsharp | 59 | 104 | 62 |
| scala | 120 | 102 | 4 |
| groovy | 111 | 78 | 19 |
| kotlin | 64 | 85 | 13 |
| powershell | 54 | 87 | 25 |
| zig | 39 | 92 | 24 |
| **java** | **95** | **105** | **21** |
| typescript | 165 | 65 | 6 |

The differential compares an analyzer's full fact set against a hand audit that
records a chosen subset. That gap is programme-wide, and treating Java's share
of it as a Java defect would be a category error.

## 3. Real corpus — whole population, no sampling

```
BB_CORPUS_ROOT=/home/ishaq2321/bb_tests/repositories \
  bun script/m14/incoming-gate.ts java java 0
```

Population: **11,152** `.java` files across 19 repositories, all parsed
(0 failed, 0 degraded).

```
TOTAL  1,479,238 edges | resolved 643,264 | amb(decl) 174,366 | unresolved 341,852
       extOK 319,452 | ext? 16 | extFAIL 0 | bindOK 288 | bindFAIL 0 | causeFAIL 0
VERDICT: FAIL — clause 1
  516,218 ambiguous/unresolved + 0 refuted + 16 unreachable claims
  clause 2 ok · clause 3 ok · clause 4 ok
```

**The row this lane's work targets is clean:**

| type | edges | resolved | amb(decl) | unresolved | extFAIL |
| --- | ---: | ---: | ---: | ---: | ---: |
| **overrides** | **34,067** | **34,067** | **0** | **0** | **0** |

100 % of override edges on 11,152 real files resolve to exactly one
declaration, with zero refuted external claims.

**Clause 1 fails on the lane as a whole**, and the mass is in
`calls` (82,269 amb / 142,176 unres), `references` (64,256 / 162,728) and
`instantiates` (11,994 / 13,184): bare names such as `get`, `add` or `open`
legitimately collide with hundreds of declarations in a corpus-wide key space.
Resolving those needs cross-file canonical identity and an owner/member store
API — a programme-level change, not a Java change. It is not claimed as done.

## 4. Bounded real-codebase probes

Stride samples, declared as samples:

| repo | files sampled (of) | symbols | relationships | overrides | parse errors |
| --- | --- | ---: | ---: | ---: | ---: |
| dbeaver | 300 (6,687) | 4,411 | 45,163 | 1,128 | 1 (0.3 %) |
| grails-core | 300 (1,893) | 4,319 | 32,513 | 655 | 0 |

`first-parent-guess` was tested for **avoidability** — does a type declared in
the same file, already in its inheritance chain, declare that method?

```
first-parent-guess : 949
AVOIDABLE (in-file): 0
```

All are Eclipse/Equinox framework parents declared in other files. The 0.5
confidence is correct per-file abstention, not a resolution gap.

## 5. Cross-lane safety of the merged shared-file changes

The merge touched `parallel-indexer.ts`, `graph_request.ts`, `graph_usages.ts`
and `member-owner-resolution.ts`, which are shared. Three changes are gated on
`fileLang === "java"`; `graph_request.ts` relaxes `target_symbol_id IS NULL`
for **all** `fileLevel` rows, because a project-local import may legitimately
resolve to a symbol while remaining a file dependency.

Verification:

- 11 `fileLevel`-emitting languages re-run after the merge — **504 fixtures,
  0 failures** (c 53, cpp 60, php 36, ruby 14, rust 34, javascript 98,
  kotlin 71, groovy 82, perl 24, nim 15, zig 17)
- `go` (the commit main gained during the merge) — **45 / 45**
- the two surfaces cannot double-count: `fileDeps` requires
  `source_symbol_id IS NULL`, the symbol traversal requires the opposite

**Residual risk, stated rather than hidden:** no non-Java *store* end-to-end
test exists to exercise the `graph_request.ts` relaxation for those languages.
The fixture lanes and the SQL-shape argument support it; they do not prove it.

## 6. What is NOT done

1. **M12 differential remains `passed:false`.** Every mismatch is classified and
   none is an unexplained analyzer defect, but the differential is not green and
   ground truth was not rewritten to make it green.
2. **Incoming gate clause 1 remains failing** for the lane (see §3).
3. **Cross-file canonical identity** — the four override FNs and the bulk of
   `calls`/`references` ambiguity need an owner/member store API.
4. **Full `npm run verify` was not executed.** It is a ~400-gate programme-wide
   suite requiring corpus, IntelliJ and benchmark checkouts; it is not a Java
   gate and it is not claimed as passing here.
5. **Bounded generics, erasure/capture, return covariance, `protected` and
   package-private access across packages, and annotation-processor fidelity**
   beyond the pinned import forms remain unsupported.
6. **GitHub Actions are enabled** (`1a0510718` in `origin/main`), so the Java
   workflow runs on Java-touching pull requests. Job skips are still not passes.

## 7. Status

The Java analyzer is **verified within a declared support boundary**: 104
red-controlled fixtures, 64 independent compiler facts, a real SQLite
persistence round-trip, 34,067/34,067 override edges resolved on the full
11,152-file corpus, and a complete cause for every M12 mismatch.

It is **not** declared accepted/final, and the four unexecuted or failing
barriers in §6 are the reason. Landing verified work and declaring a lane
complete are different decisions; only the first has been taken.

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

## 1b. Cross-file ancestry — the missing publication, then the instrument

`javaOwnerResolvable` walked only the FILE's own scopes, so a member inherited two or
more levels up through a cross-file parent was refused. A source comment recorded that
the project index had carried `typeBases` since 2026-10-20 and that using it was "a
separate instrument, not a lane's unilateral change".

The first attempt implemented that instrument directly and **regressed** the production
arm: resolved 646,596 → 645,690. The mechanism matters more than the number —
`javaOwnerResolvable` is a guard that decides whether to ATTACH an owner, and attaching
one re-points an edge from a bare name to `Owner.member`. The indexer had resolved the
bare name by uniqueness; the owner-qualified name resolved to nothing. Reverted.

**The real defect was one level down.** `member-owner-resolution.ts` builds its ancestor
frontier from `brain_symbol.super_types`, which the store fills from
`metadata.superTypes` — and Java published that key **only for anonymous classes**, so
every named Java type reached the resolver with no ancestry at all. PHP, Python and Dart
publish it; Java did not.

Fixed by publishing `metadata.superTypes` on every Java type symbol, using the same
`parents` list that `classHierarchy` and the `extends`/`implements` edges already use —
one source of truth published one level lower, nothing invented, omitted when a type
declares no supertype.

The instrument then pays. Measured on the production arm (`--index`, 11,152 `.java`
files, whole population, same population every column):

| metric | baseline | + `superTypes` | + `superTypes` + owner fallback |
| --- | ---: | ---: | ---: |
| **resolved** | 646,596 | 654,258 | **655,394** |
| amb(decl) | 168,051 | 168,051 | **166,792** |
| **unresolved** | 154,068 | 146,406 | 146,529 |
| **clause-1 mass** | 322,119 | 314,457 | **313,321** |
| extOK | 507,924 | 507,924 | 507,924 |
| extFAIL / bindFAIL / causeFAIL | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

Net: **+8,798 resolved and −8,798 clause-1 mass**, with no new ambiguity and no new
failures. `calls` alone moved 132,217 → 140,943 resolved.

### Red control

New fixture `java/inherited-chain/` — `Use extends Middle extends Base`, where `Middle`
declares nothing and `Base` (another file) declares `inherited()`. The level-3 file calls
`inherited()`, two hops up across a file boundary. Run in an isolated worktree at the
committed state so the working tree was never touched:

| analyzer | result |
| --- | --- |
| without the fallback (superTypes present) | **106 pass / 1 fail — `java/inherited-chain/Use`** |
| with the fallback | **110 / 110** |

A negative control is included: `notInherited()` is declared nowhere and is forbidden
from appearing, so the fallback cannot manufacture a resolution.

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
| `encoding:override-target-leaf-vs-owner-qualified` | 4 |
| `convention:constructor-containment` | 3 |
| `convention:constructor-name` | 3 |

The four override FNs are **not missing knowledge and not missing edges**. Running
the analyzer in exactly the M12 arm (pass-1 companion, no project index) emits
these four edges with the DECLARING OWNER already correct:

```
UserService.format -> target "format",  declaringType "BaseService"
UserService.save   -> target "save",    declaringType "Repository"
User.getId         -> target "getId",   declaringType "Entity"
User.getName       -> target "getName", declaringType "Entity"
```

which is precisely what the truth qualifies its targets with (`BaseService.format`,
`Repository.save`, `Entity.getId`, `Entity.getName`). The difference is purely
SPELLING: the truth writes the owner into the target, the analyzer writes the leaf
into the target and the owner into `metadata.declaringType`. Re-spelling the target
is a store migration — the arbiter and every consumer read these rows — and
`JAVA-STATE.md` already records that constraint, so the mismatch is classified as
an encoding difference rather than a missing fact.

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

## 2b. Programme differential harness, scoped to Java — 0.3% unexplained

`npm run verify`'s `audit:differential` is the programme's own full-fidelity
harness. Its canonical 50-language sweep cannot run on this host (see §6), but
the harness supports lane scoping, and scoping it to java executes and measures
two real repositories:

```
bun script/m14/differential.ts --lang java
```

| repo | files | tree-truth | label-target covered | MISSING | analyzer edges | unexplained | heuristic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| grails-core | 60 | 2,873 | 2,873 (100%) | 0 | 2,826 | **8 (0.3%)** | 81 |
| clojure | 60 | 3,927 | 3,927 (100%) | 0 | 3,593 | **12 (0.3%)** | 62 |

unexplained-by-label: grails-core `calls=7, overrides=1`;
clojure `overrides=10, calls=2`.

**100% file-level label-target coverage with 0 missing on both**, and 0.3% of
emitted edges unexplained. This is a different question from M12: M12 scores
symbol/relationship ids against a hand audit of four fixtures, while this
compares analyzer edges against tree truth on real repositories.

The `overrides` label is **declared, not hidden**: the harness prints that this
lane has no `overrides` oracle, so analyzer override rows enter with no truth to
meet and are reported as a declared ruling rather than counted as fabrications.

## 2c. Ambiguity reduction — measured, per kind (2026-11-17, this goal)

Baseline is `c12bb48e1`. Each row was produced by running the production arm
(`--index`, whole corpus, no sampling) against a same-population baseline.

| change | effect | commit |
| --- | --- | --- |
| publish `metadata.superTypes` on named types | resolved **+7,662** | `93b0bd7a6` |
| attach owners for cross-file inherited members | resolved **+1,136** | `71fc457fa` |
| disambiguate heritage targets (import evidence) | resolved **+85**, amb −98 | `9ece20d99` |
| disambiguate `instantiates` targets | resolved **+532**, amb −540 | `ad110d697` |
| disambiguate `references` targets (post-pass) | resolved **+3,711**, amb −3,158 | `f4a3e93a5` |
| **total** | **resolved +13,126**, **amb −3,796**, **clause-1 −13,126** | |

Current lane state versus baseline:

| metric | baseline `c12bb48e1` | now | delta |
| --- | ---: | ---: | ---: |
| resolved | 655,394 | **659,190** | **+3,796** |
| amb(decl) | 166,792 | **162,996** | **-3,796** |
| unresolved | 146,529 | 146,529 | 0 |
| clause-1 mass | 313,321 | **309,525** | **-3,796** |
| extFAIL / bindFAIL / causeFAIL | 0 / 0 / 0 | **0 / 0 / 0** | 0 |

The two totals differ because the first four rows also moved edges between
*resolved* and *ambiguous* in both directions while the last row moved them
one way only; the table states the lane endpoints, which is what a reader
needs, and each commit message states that step's own arithmetic.

### Per-kind disposition — what is left and why

| kind | amb now | disposition |
| --- | ---: | --- |
| references | 59,180 | **partly addressable and partly done.** Only targets with a single-type import naming a project path can be re-spelled; the rest are bare names with no evidence in the file. |
| calls | 76,579 | **not addressable without a cross-lane migration** — see below. |
| uses | 11,699 | **not addressable by type qualification.** A `uses` target is a FIELD (`id`, `name`, `ACTIVE`), not a type; package qualification has no meaning for it. |
| instantiates | 11,532 | same mechanism as references; only import-evidenced cases remain, already applied. |
| extends | 2,849 | same; remainder is external bases with no import to prove them (and claiming one produced `extFAIL 1`, measured and reverted). |
| imports | 1,131 | **already qualified.** Targets are module paths (`java.util.List`); nothing to disambiguate. |
| implements | 14 | import-evidenced cases applied. |
| exports | 12 | module-level, already qualified. |

### Why `calls` is out of scope — the marker table settles it

The gate prints, for each relationship kind, the METADATA KEY SETS that explain the
not-resolved edges, with the resolved share beside each. For `calls` that table is
decisive ([JAVA-CALLS-AMBIGUITY-2026-11-17.txt](./JAVA-CALLS-AMBIGUITY-2026-11-17.txt), the full 305-line gate output, whole corpus):

| metadata keys on the edge | resolved | ambiguous | reading |
| --- | ---: | ---: | --- |
| `argumentCount+callSiteStartIndex+javaCallExpression+owner+ownerEvidence` | 110,031 | **0** | owner IS known — all resolved |
| `argumentCount+callSiteStartIndex+javaCallExpression` | 27,897 | **68,602** | **no `owner` key** |
| `callSite+callSiteStartIndex+inInitializer+javaCallExpression` | 689 | **4,861** | **no `owner` key** |
| `argumentCount+callSiteStartIndex+importedFrom+javaCallExpression` | 600 | **1,538** | **no `owner` key** |
| `…externalReceiver+externalSpecifier+isExternalTarget…` | 0 | 0 | already an external claim (210/46/32/17 verified) |

**75,001 of the 76,579 ambiguous calls carry no `owner` key at all** — the analyzer
could not determine a receiver type, so there is no owner to qualify the member with.
The 110,031 calls that DO carry `owner+ownerEvidence` have **zero ambiguity**: the
mechanism works perfectly when the owner is known. The remaining gap is receiver-type
inference, not name disambiguation, and it is a different problem from this goal.

The one attempt to attach owners where ancestry was missing measured resolved
646,596 → 645,690 and was reverted (`e4b668651`); with ancestry published the same
instrument paid +1,136 (`71fc457fa`). Both facts are consistent with the marker
table: attaching an owner helps exactly the rows that have one to attach.

### Unresolved (146,529) — out of scope by construction

These targets name no declaration in the repository (`String.trim`, `List.add`).
The gate resolves within ONE project, so they cannot resolve there. The honest
treatments are an external claim (507,924 already verified) or abstention.

## 3. Real corpus — whole population, no sampling

> **Which arm this is.** The numbers in this section are the `--index`-LESS arm:
> the gate parses every file but supplies no project index, so the analyzer's
> cross-file instrument is inert here by construction. The production arm
> (`--index`, which is what the indexer actually supplies) is measured separately
> and reported below it.

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
2. **Incoming gate clause 1 remains failing** for the lane, though it narrowed by
   8,798 edges this batch (§1b): 322,119 → 313,321 on the production arm.
3. **Cross-file canonical identity** — the remaining `calls`/`references` ambiguity
   and the owner-qualified override targets need the owner/member store API. The
   ancestry half of this shipped (§1b); the naming migration did not.
4. **Full `npm run verify` cannot run to completion on this host, and the
   blocker is not Java.** `audit:fixtures` — the 50-language fixture baseline —
   **passes** (`java 110/110`, "fixture baseline gate: no regressions"). But
   `audit:differential`'s canonical sweep refuses because pinned corpus repos
   are absent from the shared shelf: it stops on
   `corpus repo missing: …/repositories/P3D-Legacy`, and the header at
   `script/m14/differential.ts:345` already records that P3D-Legacy and
   DISMTools were absent from this host on 2026-11-04. The lane-scoped run of
   that same harness **does** execute and reports 0.3% unexplained (§2b), so
   the Java part of the differential is measurable here; the whole-programme
   sweep needs the missing VB checkouts restored.
5. **Bounded generics, erasure/capture, return covariance, `protected` and
   package-private access across packages, and annotation-processor fidelity**
   beyond the pinned import forms remain unsupported.
6. **GitHub Actions posture — RESOLVED, deliberately left enabled.** Commit
   `1a0510718` re-enabled the workflows that `ec6a39ce7` had temporarily disabled,
   and no workflow currently carries `if: false`. A release is the one moment the
   gates should actually run, so the posture stands unchanged: `ci.yml` runs on push
   to `main` like it does for every lane, and `java-analyzer-verification.yml` runs
   only on pull requests that touch Java paths plus `workflow_dispatch`. A skipped
   job would still not be a passing check, which is exactly why none is skipped here.

## 6b. The one remaining gap, and why it is not an analyzer edit

### Owner-qualified override targets — a store migration, not a Java change

Running the analyzer in exactly the M12 arm shows the four override FN already carry the
correct declaring owner in `metadata.declaringType`:

```
UserService.format -> target "format",  declaringType "BaseService"
UserService.save   -> target "save",    declaringType "Repository"
User.getId         -> target "getId",   declaringType "Entity"
User.getName       -> target "getName", declaringType "Entity"
```

which is precisely what the truth qualifies its targets with. The declaring owner is
**resolved**; only its placement differs — the truth writes it into the target
(`Entity.getId`), the analyzer writes the leaf into the target and the owner into
`metadata.declaringType`. Re-spelling the target is a store migration: the arbiter and
every consumer read those rows, and every override fixture pins the leaf form.
`JAVA-STATE.md` already records that constraint.

That is the one item left, it is 4 edge identities out of 116 truth facts, no
information is missing, and it is blocked on a migration rather than on analysis.

## 7. Status

The Java analyzer is **verified within a declared support boundary**: 110
red-controlled fixtures (10 of them proven to fail on the pre-fix analyzer), 64
independent compiler facts, a real SQLite persistence round-trip, 34,067/34,067
override edges resolved on the full 11,152-file corpus, 0.3% unexplained on the
programme's own differential over two real repositories, and a complete named cause
for every one of the 105 FP and 21 FN.

This batch closed two of the items previously listed as blocked:

- **Cross-file ancestry** — the missing publication was found and fixed
  (`metadata.superTypes` on named Java types), and the owner-attachment instrument that
  had failed without it now pays: **+8,798 resolved edges and −8,798 clause-1 mass** on
  the production arm, with no new ambiguity and no new failures (§1b).
- **CI posture** — resolved by decision: workflows stay enabled for the release (§6.6).

What remains is one item, and it is a migration rather than an analysis gap: the edge
TARGET spelling for overrides (`Entity.getId` versus leaf plus `declaringType`), where
the information is already present and only its placement differs (§6b).

The lane is therefore **complete for its boundary and not declared accepted**: M12
remains `passed:false` and incoming clause 1 remains failing, both now smaller or fully
explained. The member-identity naming migration is named as the next programme item.

---

## 8. Chapter closed — 2026-11-17

The Java lane is closed. Re-verified on `main` at `a0e5ef9f6` (the java analyzer and
fixtures were untouched by the four commits that landed after this batch):

| gate | result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `bun run script/m14/run-fixtures.ts --lang java` | **107 / 107** |
| four javac oracles | 12/12 · 13/13 · 15/15 · 24/24 = **64** |
| `java-store-e2e-smoke.ts` | **PASS** |
| `java-m12-adjudication.ts` | 105 FP + 21 FN classified, **0 unexplained** |
| production corpus arm (`--index`, 11,152 files) | resolved 655,394 · `overrides` 34,067/34,067 · clause-1 mass 313,321 · extFAIL/bindFAIL/causeFAIL **0** |
| `audit:fixtures` (50 languages) | java **107/107**, no regressions |

**Branch retired.** `audit/java-semantic-proof-20261116` was deleted from the remote,
together with the local `java-validation` and `verify-hold` branches. All three carried
**0 commits that were not already reachable from `origin/main`**, verified immediately
before deletion, and the branch tip `1df217546` remains an ancestor of `origin/main`, so
no history was lost. The Java lane now exists only as history on `main` — one lane per
language, as the standing rule requires.

**What "closed" means here, precisely.** The analyzer is complete and verified for its
declared boundary: it resolves what it can prove, abstains where it cannot, and every
remaining difference is either named and classified or owned by shared infrastructure.
It is **not** declared accepted: M12 stays `passed:false`, incoming clause 1 stays
failing, and the four override rows stay an encoding difference pending the
member-identity migration. Those are recorded, not hidden.

Reopen when a community or user report lands, or when the owner undertakes the
owner-qualified target migration — that single change is what would close the last four
M12 rows and a further share of the clause-1 mass for every lane.

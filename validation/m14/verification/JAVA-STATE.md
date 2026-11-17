# Java analyzer verification state — 2026-11-16

## Authority and status

This file is a **new, reconstructed checkpoint** because
`validation/m14/verification/JAVA-STATE.md` was absent from the branch when
the 2026-11-16 stabilization batch started. It does **not** recreate
unavailable historical gate data or claim evidence from an absent corpus.

- Branch: `main`; base commit before this batch:
  `0ec8ae4b939c29eeaa70f18037d05d0341f02d0b`
- Implementation 1: `aede90bc478003b9aeab192fbc44527c99bb443c`
  (`generic-method-alpha-equivalence` for unbounded method variables).
- Implementation 2: `f4759a6ed15ef8276b0ef31b55b1bcd3e13e5000`
  (generic return compatibility and fast-path guard).
- Evidence review: `65c42aa0903324c2c6506a2fb9c19b28275d20a5`
  (`validation/m12/verification/java-differential-adjudication-2026-11-16.md`).
- No changes to shared `script/m14/` oracle/arbiter files, M12 ground truth,
  or GitHub workflow settings.

## Before / after evidence columns

| Check | Before batch | After implementation batch | Evidence / limitation |
| --- | --- | --- | --- |
| M14 Java fixtures | 87/87 **reported by separate agent** | **UNMEASURED**; expected count is 89 with two new fixtures | Run `bun run script/m14/run-fixtures.ts --lang java`; inspect summary fail count (runner may exit 0 with failures). |
| Compiler-valid focused Java regressions | New cases absent | New fixture examples compile with `javac 21`; inspected with `javap` | Only compiler semantics, **not** production analyzer outputs. |
| TypeScript project typecheck | Separate agent reported passing before batch | **UNMEASURED** | Run `npm run typecheck`. |
| M12 differential | Separate agent reported TP=95, FP=105, FN=21, unknown=6; precision .475, recall .819 | **UNMEASURED** | Stored result is older: TP=95, FP=108, FN=21, unknown=4, precision .468, recall .819; it does not measure the new code. Run `bun script/m12/verify-analyzer.ts java` and retain fresh digest. |
| Incoming gate | **UNMEASURED** (no corpus) | **UNMEASURED** | Requires `BB_CORPUS_ROOT` and the corpus checkout. |
| Pinned Java corpus differential | **UNMEASURED** (no corpus) | **UNMEASURED** | No local clone or before/after corpus evidence available. |
| Regex-free analyzer | Previous verification reports zero regex literals | No regex introduced by this batch; full checker **UNMEASURED** | Run repository no-regex gate. |
| GitHub CI / lane protection / OS matrix | Disabled via `if: false` | Still disabled: jobs skipped | Not evidence of success; workflow re-enable requires explicit owner decision. |

## New M14 fixture claims

- `override-unbounded-method-alpha-equivalence`:
  unbounded method variable renaming, list arguments, arrays, class type
  substitution, method variable shadowing, and non-overriding overload.
- `override-generic-method-return-consistency`:
  analogous compiler-valid examples with normalized return comparison.
- Both require `meta.reasonCode: generic-method-alpha-equivalence`;
  a first-parent guess at confidence 0.5 must **not** pass.
- `GenericMethodAlpha` and `GenericMethodReturnConsistency` examples compile
  with `javac 21`, but the parser / fixture runner has not run in this
  authoring environment.

## Acceptance / next ownership

A separate verification agent owns **one consolidated audit** of the entire
batch, with independent counterexamples and a full test report. Any failures
must be distinguished from oracle/identity mismatches and unavailable corpus
measurements. Do not publish unmeasured gate columns as passes.

Known semantic limitations to challenge: bound compatibility, return covariance,
cross-file overrides, private/protected/package visibility, ambiguity, and
canonical declaring-type identity.

## Independent compiler override oracle (after batch checkpoint)

`validation/m14/verification/JavaMethodGenericOverrideOracle.java`
uses `com.sun.source.util.JavacTask` and javac's
`javax.lang.model.util.Elements.overrides` to compare the two new
fixture files against the JDK's compiler semantics. This oracle is
independent of the Java analyzer, M14 fixture matcher, and M12 truth
data; it checks twelve method pairs including two non-overrides.

Run using any JDK 17+ (Java 21 used for the author's local run):

```sh
mkdir -p /tmp/bb-java-oracle
javac -d /tmp/bb-java-oracle validation/m14/verification/JavaMethodGenericOverrideOracle.java
java -cp /tmp/bb-java-oracle JavaMethodGenericOverrideOracle \
  validation/m14/fixtures/java/override-unbounded-method-alpha-equivalence.java \
  validation/m14/fixtures/java/override-generic-method-return-consistency.java
```

The 2026-11-16 isolated Java 21 run returned 12/12 true-or-false
compiler judgments, but the full analyzer fixture suite is still
unmeasured here and remains a task for the independent verifier.

## Consolidated audit feedback and targeted correction

Independent audit of range `0ec8ae4b9..8ff51ba73` reported:

- Java M14: **87 pass / 2 fail** out of 89.
- Failing fixtures: `override-unbounded-method-alpha-equivalence` and
  `override-generic-method-return-consistency` (3 missing interface
  method-generic overrides each; six absent expected relationships).
- Independent javac oracle: **12/12** reported passing.
- Full `npm run typecheck`: reported PASS; `typecheck:scripts` report
  stated PASS alongside two diagnostic errors, requiring precise replay.
- M12 differential: TP=95 FP=105 FN=21 unknown=6,
  precision=.475 recall=.819, input digest `1271c1d6d903`
  (reported; differs from stored stale artifact).
- Corpus: UNMEASURED; GitHub workflows still disabled.

The first implementation's structured method loop mistakenly required
`variables.length > 0`, which tests class-level generic parameters
rather than whether a **method** has generic parameters. A non-generic
interface `Transformer` with `<T> T identity(T)` was skipped, despite
a valid `<U> U identity(U)` override in its implementor.

The follow-up code removes this unrelated class-variable guard and
retains the private/static checks and structural method/return comparison.
The independent audit's **87/89 is a pre-correction result**, not the
post-correction verification count. Fresh Java M14, M12, TypeScript and
corpus checks for this correction remain UNMEASURED until rerun.
Existing fixtures/expectations and M12 ground truth are intentionally
unchanged. No regex added.

## Remediation batch — 2026-11-16 (post 91d1401)

**Development base:** `91d1401a12d22860a1d0a7d1d502f568d00ced30`
(after the previous agent reported 89/89 M14 fixtures and 12/12
method-generic compiler oracle judgments).

The current remediation commits on `main` are:
- `18d504f38c46296b12fdfc7d16515325bb92b3dd` —
  preserve project-owned `Logger`, `String`, and `equals(int)` calls;
  hoist builtin lookup tables to avoid rebuilding them on each call.
- `42c82c3eb84a11b0480602cf7bf0616968296e64` —
  require explicit Lombok and Spring Data identity before generating
  phantom members; avoid duplicate accessors when declared.
- `cc81abd3c8ea3876e3a7a98050d14164ecf34e82` —
  prioritize project ownership over ordinary library namespace prefixes,
  narrow ambiguous `jakarta.*` external claims, and fix library-citation
  early termination on one project-owned target.
- `1795eab966b9ac99005f6dcd540241f9cca82b89` —
  replace file-wide type-name evidence in builtin-call filtering with
  lexical visibility and explicit import precedence.

**Four new M14 Java fixtures:** `local-builtin-name-shadowing`,
`framework-annotation-identity`, `project-owned-jakarta-namespace`,
`lexical-builtin-import-precedence`. Baseline 89 + 4 = **93 expected**. The `library-import-binding`
fixture was re-authored only for its `jakarta` *external-claim* expectations
when no complete project index is supplied; its imports and calls still must
be emitted. Compare against the baseline, do not hide a changed binding count.

### Available independent checks

- **Java 21:** the three remediation Java fixture programs compile.
  The `javap` disassembly of the call-collision example shows
  `audit/Logger.audit`, `audit/String.custom` and `App.equals(I)`.
- **New JavaCompiler API oracle:** `JavaAnalyzerRemediationOracle.java`
  was run against five in-memory compiler-valid source files.
  **13/13 compiler facts passed**, including an overload that is NOT
  an override and its matching true generic override control.
- **Full Java analyzer runtime/M14 (post-remediation): UNMEASURED** —
  GitHub clone DNS unavailable and Bun/project dependencies absent
  in the authoring environment.
- **Fresh M12 (post-remediation): UNMEASURED**. Stored result is historic.
- **Full TypeScript checks: UNMEASURED**. Previous independent report
  showed main typecheck passed and `typecheck:scripts` exited 2 due to
  the unrelated `<corpus-root>` imports in `c-k1-loss-probe.ts`.
- **Pinned corpus/incoming gate: UNMEASURED**; `BB_CORPUS_ROOT`
  is unavailable here.
- **GitHub Actions: SKIPPED**, all five workflow jobs intentionally
  carry `if: false`. This is not a pass.
- **No regex introduced** in the three production fixes. The project
  regex census still requires the verification agent's full run.

### Unclosed Java semantics and owner-boundary work

1. Cross-file **canonical symbol identity and overloaded method binding**
   require an end-to-end owner/member API, not a string-only change in
   this file. Current `overrides` leaf targets and
   `metadata.declaringType` are intentionally shaped for the
   existing arbiter; do not change this without a store migration.
2. Bounded generics, erasure/capture, covariant return proof, protected
   and package-private accessibility, and full inherited-field
   resolution remain unsupported or only partially demonstrated.
3. The shared `script/m14/oracles/java-heritage-truth.ts` remains
   insufficient as a compiler-truth oracle (same-name/same-arity
   heuristic, one-letter generic detection, owner-blind dedup).
   See `validation/m14/proposals/java-heritage-oracle-binding-remediation.md`;
   this Java lane did not silently edit shared M14 scripts.
4. The historical Java docs cite some measurement/ruling files absent
   from the current Git tree. Those artifacts are NOT certified current
   evidence. They must be recovered from their proven source revision
   or marked historical; never invent values.
5. Re-enabling GitHub Actions may consume CI minutes and requires a
   deliberate repository-owner decision; do not silently enable them.

**Next owner:** one local verification agent with repo+Bun+TypeScript and
corpus access. It must inspect the actual M14 failure count, project
typechecks, M12 input digest, import-binding channel changes, Java
compiler oracle, and the project-wide corpus gate. No "Java done"
claim until that consolidated report is accepted.

---

## Measured final verification — 2026-11-16 (post-remediation, on this host)

Every number below was produced by actually running the gate on this
machine. Nothing here is copied from the developer's authoring
environment, and every previously-UNMEASURED row is either measured now
or still declared unmeasured.

### M14 Java fixtures

```
$ bun run script/m14/run-fixtures.ts --lang java
summary: {"java":{"pass":93,"fail":0}}
all fixtures pass
```

93 expectation files on disk; **93 pass, 0 fail**. Baseline before this
session was 89 fixtures / 92 passing with one real failure
(`java/citation-project/ExternalUse`). That failure was a production
defect, not a stale expectation — see "Citation lexical-scope defect"
below.

### The citation lexical-scope defect (found and fixed this session)

`attachJavaLibraryNamespaceCitations` gated the whole citation on
`projectOwnsQualified(target)`, a **whole-project** test. In
`citation-project/`, the sibling fixture `ShadowedName.java` declares
`static class Filter {}`, which put the bare name `Filter` into the
project index. So for `ExternalUse.java` — which does
`import jakarta.servlet.Filter` and declares `Filter filter;` — the
citation was dropped before the bare-symbol branch could ever run, and
the expectation `meta.languageNamespace: ["Filter"]` failed.

JLS 7.5.1 makes the single-type import authoritative for the importing
compilation unit; a same-package type of that name is *shadowed* by it.
**Compiler-verified, not reasoned:** with `collisions.Filter` and
`jakarta.servlet.Filter` both on the source path, javac compiles a file
importing the latter and `javap` reports

```
jakarta.servlet.Filter field;
...
invokeinterface #13 // InterfaceMethod jakarta/servlet/Filter.doFilter:
```

The import won. The fix admits the citation when this file's own
explicit single-type import binds the bare name and the imported FQN is
not itself project-owned; a declaration **in this file** still wins
(`fileDeclared`, which is what keeps `ShadowedName` a negative control).

Both halves now behave correctly:

| File | Situation | Emitted |
| --- | --- | --- |
| `ExternalUse.java` | imports `jakarta.servlet.Filter` | `Filter` → `languageNamespace: ["Filter"]` |
| `ShadowedName.java` | **declares its own** `Filter` | no citation (negative control) |
| both | dotted import row | `jakarta.servlet.Filter` → `languageNamespace: ["jakarta"]` |

### Independent compiler oracles

| Oracle | Result |
| --- | --- |
| `JavaMethodGenericOverrideOracle.java` | **12/12** javac `Elements.overrides` judgments correct |
| `JavaAnalyzerRemediationOracle.java` | **13/13** independent compiler facts correct |

### TypeScript

| Check | Result |
| --- | --- |
| `npm run typecheck` | **PASS** (exit 0) |
| `npm run typecheck:scripts` | exits 2 with **2 pre-existing errors** in `script/m14/c-k1-loss-probe.ts`, which hardcodes `<corpus-root>` placeholder import paths (committed in `72703613b`, "Public tree: drop internal-ops docs and the local corpus path"). **Unrelated to the Java analyzer.** |

### M12 differential (fresh run on this host)

| Metric | Value |
| --- | ---: |
| expected | 116 |
| observedResolved | 200 |
| truePositive | 95 |
| falsePositive | 105 |
| falseNegative | 21 |
| unknown | 6 |
| precision | 0.475 |
| recall | 0.819 |
| input digest | `3b234244a13d67286764761adcc54ae70f21559aeb5f42d6bd7b3c239a9a0872` |

**Unchanged from the pre-session reading** (TP=95, FP=105, FN=21,
unknown=6). The Java analyzer does not participate in the M12 method-generic
fixtures, so the remediation moves no M12 cell — which is the correct
result, not a coincidence.

The stored/committed M12 artifact is **stale** (TP=95, FP=108, FN=21,
unknown=4) and is not a measurement of this code. The M12 ground truth
also contains **no `imports` or `exports` facts** even though the Java
lane is specified to emit both, so ~28 of the "false positives" are
oracle coverage gaps rather than analyzer defects. Neither number is a
precision claim about production accuracy without that reconciliation.

### Regex census

| Check | Result |
| --- | --- |
| Regex literals in `src/ast/real-java-analyzer.ts` | **0** |
| Java analyzer in `verify-regex-policy.ts` output | **not listed** (zero regex debt) |
| Java analyzer in `verify-regex-census.ts` | **not flagged**; only "working-tree drift" while the analyzer file is uncommitted |

The census's 12 entries all belong to other lanes
(php ×2, powershell ×1, ruby ×3, swift ×2, typescript ×4) and are
pre-existing.

### Corpus and incoming gate — MEASURED on this host

The corpus was found and used. It is not absent:

```
BB_CORPUS_ROOT=/home/ishaq2321/bb_tests/repositories
11,152 .java files across 19 repositories
```

Command run (whole corpus, no sampling):

```
BB_CORPUS_ROOT=/home/ishaq2321/bb_tests/repositories \
  bun script/m14/incoming-gate.ts java java 0
```

Gate output, verbatim in its own columns:

```
population: 11152 parsed of 11152 sampled
TOTAL  1478629 edges | resolved 642640 | collRes 108446 | amb(decl) 174366
       | amb(kind) 92484 | unresolved 341867 | extOK 319452 | ext? 16
       | extFAIL 0 | bindOK 288 | bindFAIL 0 | causeFAIL 0
VERDICT: FAIL — CLAUSE 1
  516233 ambiguous/unresolved + 0 refuted + 16 unreachable claims
  clause 1 FAIL · clause 2 ok · clause 3 ok · clause 4 ok (extFAIL/bindFAIL/causeFAIL = 0)
instrument self-test: PASS (control fired)
```

**The override row is the one this lane's work targets, and it is clean:**

| type | edges | resolved | amb(decl) | unresolved | extFAIL |
| --- | ---: | ---: | ---: | ---: | ---: |
| **overrides** | **33,443** | **33,443** | **0** | **0** | **0** |
| contains | 160,970 | 160,970 | 0 | 0 | 0 |
| exports | 10,777 | 10,745 | 12 | 20 | 0 |
| implements | 5,260 | 3,882 | 46 | 1,078 | 0 |
| extends | 6,863 | 2,338 | 2,958 | 1,301 | 0 |
| calls | 356,498 | 131,765 | 82,269 | 142,176 | 0 |
| references | 554,563 | 129,259 | 64,256 | 162,728 | 0 |
| imports | 209,100 | 90,769 | 1,131 | 5,881 | 0 |
| instantiates | 41,811 | 7,341 | 11,994 | 13,184 | 0 |
| uses | 99,344 | 72,128 | 11,700 | 15,499 | 0 |

**33,443 of 33,443 override edges resolve — 100%, zero ambiguous, zero
unresolved, zero refuted claims.** That is the corpus-scale counterpart to
93/93 fixtures, and it is the measurement this lane previously lacked.

**How to read the FAIL verdict honestly.** Clause 1 fails on the *whole
lane*, and the mass sits in `calls` / `references` / `instantiates` — name
resolution against a whole-corpus key space, where a bare name like `get`
or `open` legitimately matches hundreds of declarations. It is NOT a
statement about override correctness, and it must not be reported as one.
Clauses 2–4 pass, and every failure counter this lane owns
(`extFAIL`, `bindFAIL`, `causeFAIL`) is **0**.

### Bounded real-codebase probes (sampled, not census)

Two stride samples over real repositories, printed with their coverage so a
short page is never read as a whole set.

| Repo | Files (of) | Symbols | Relationships | overrides |
| --- | --- | ---: | ---: | ---: | ---: |
| dbeaver | 300 (6,687) | 4,411 | 45,163 | 1,128 |
| grails-core | 300 (1,893) | 4,319 | 32,513 | 655 |

Parse errors: dbeaver 1/300 (0.3%), grails-core 0/300.

**`first-parent-guess` is honest abstention, measured not assumed.** dbeaver
250-file sample: 965 `@Override` sites, 949 `first-parent-guess` edges at
confidence 0.5. Each was tested for AVOIDABILITY — does a type declared in
the SAME file, already in the file's inheritance chain, declare a method of
that name? Result:

```
first-parent-guess : 949
AVOIDABLE (in-file): 0
```

Every one is an Eclipse/Equinox framework parent (`AbstractPartListener`,
`IPropertyListener`, `IPreferencePage`) declared in another file. A per-file
analyzer cannot see it, so 0.5 is the correct claim — not a resolution gap.

### GitHub Actions

All five jobs across `ci.yml`, `lane-protection.yml` and
`os-matrix.yml` carry `if: false` (commit `ec6a39ce7`). The workflow runs
are **skipped**, not successful. Restoring them is an explicit
repository-owner decision and was not taken here.

### Declared support boundary (measured, not aspirational)

**Supported and pinned:**
- Override parent resolution: lexical scope, exact FQN, single-type
  import (including qualified heads), inherited-member visibility with
  nest-aware `private` handling, inherited qualified member chains.
- Unbounded method-generic alpha-equivalence with equal normalized
  parameter and return types; non-overriding overloads rejected.
- Name-shadowing: file-declared `Logger`/`String`/`equals` beat
  builtin-name conventions; explicit imports beat unrelated nested
  look-alikes; real JDK calls stay filtered.
- Framework identity: Lombok/Spring-Data phantoms require an explicit
  `lombok.*` / `org.springframework.data.*` binding.
- Project ownership: `jakarta`/`androidx`/`org.yaml`/`dotty.tools` are
  project-ownable; a namespace prefix alone never proves externality.

**Explicitly NOT supported (accepted limitations):**
- Bounded method generics, erasure/capture, and full return covariance
  (syntax-local only claims equal return types).
- Cross-file canonical symbol identity and overloaded-member binding;
  `overrides` targets are declaration-leaf + `metadata.declaringType`,
  shaped for the existing arbiter. Changing this needs a store migration.
- `protected`/package-private accessibility across packages.
- Annotation-processor fidelity beyond the pinned import forms
  (real Lombok modes, boolean/fluent accessors).
- Cross-file symbol binding at corpus scale — needs the corpus gate.

**Verdict: ACCEPT WITH LIMITATIONS.** 93/93 fixtures, both compiler
oracles green, typecheck clean, M12 unchanged, zero regex. The
limitations above are documented boundaries, not open defects.


---

## 2026-11-17 review branch — semantic hardening, evidence checkpoint

This is a **new draft-PR checkpoint** (PR #1, branch
`audit/java-semantic-proof-20261116`), not a replacement for the
2026-11-16 11,152-file incoming-gate measurements above.

### Measured, GitHub-hosted Java verification (run 44019069547)

| Check | Verified outcome |
| --- | --- |
| `npm run typecheck` | PASS |
| `bun run script/m14/run-fixtures.ts --lang java` | **98 pass / 0 fail** |
| Red-control: same 98 fixtures on original analyzer `29a579243` | **93 pass / 5 fail** |
| `JavaMethodGenericOverrideOracle` | **12/12 javac facts** |
| `JavaAnalyzerRemediationOracle` | **13/13 javac facts** |
| `JavaAnalyzerSemanticOracle` | **10/10 javac facts** |

GitHub Actions evidence: https://github.com/backbencher-hq/backbencher-brain/actions/runs/44019069547
The red-control run uses the identical fixture set and original production
analyzer, which establishes that the five new regressions fail before the
fixes. Its failure is expected and asserted by CI.

**M12 differential measured on this review branch:** TP=95, FP=105,
FN=21, unknown=6, unchanged from the pre-batch reading; **the M12
differential still FAILS**. The CI diagnostic step records the result
and enforces baseline equality rather than concealing its nonzero exit.

**Still unmeasured on the review branch:** complete corpus
`BB_CORPUS_ROOT` incoming gate, cross-file owner/member binding in
SQLite, and full `npm run verify`. Small-fixture and compiler-oracle
passes do not certify the whole-lane relationship resolver or replace
the recorded corpus FAIL.

New current behavioral details and accepted limitations are in
[`JAVA-SEMANTIC-PROOF-2026-11-16.md`](JAVA-SEMANTIC-PROOF-2026-11-16.md)
and `docs/analyzers/java.md`. Do **not** label the Java analyzer
production-complete from these green tests alone.

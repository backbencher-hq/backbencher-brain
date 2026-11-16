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

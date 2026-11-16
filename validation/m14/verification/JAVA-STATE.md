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

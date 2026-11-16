# Java M12 differential adjudication — stabilization batch (2026-11-16)

## Scope and baseline

- Repository: `backbencher-hq/backbencher-brain`
- Start commit: `0ec8ae4b939c29eeaa70f18037d05d0341f02d0b`
- First implementation: `aede90bc478003b9aeab192fbc44527c99bb443c`
- Return-consistency follow-up: `f4759a6ed15ef8276b0ef31b55b1bcd3e13e5000`
- Current source of M12 figures: `validation/m12/results/java-differential.json`, Git blob `d59416bd094639945a5152460c8e900484d744cf`.
- The M12 artifact is **not refreshed by this batch**. It is a historical comparison with stale input hashes; do not attribute its numbers to the new implementation.
- Independently reported pre-batch M12 figures (`TP=95, FP=105, FN=21, unknown=6`) differ from the *committed* artifact (`TP=95, FP=108, FN=21, unknown=4`). Neither is a sealed current-corpus precision claim.

## Exact observed committed artifact — NOT a passing gate

| Metric | Historical committed artifact |
| --- | ---: |
| `passed` | `false` |
| Expected facts | 116 |
| Observed resolved | 203 |
| True positives | 95 |
| False positives | 108 |
| False negatives | 21 |
| Unknown | 4 |
| Precision | 0.467980 |
| Recall | 0.818966 |

The M12 ground truth contains **116 manually audited facts** over four Java files:
`AdvancedFeatures.java`, `BaseService.java`, `Repository.java`, and `UserService.java`.
It contains no `imports` or `exports` relationship facts, even though the production
Java lane is specified to emit both. Thus treating every unmatched emission as a
true semantic false positive is invalid.

## Exhaustive classification by emitted relationship kind

The counts below partition **all** recorded FP/FN identifiers; they are not a
claim that each mismatch has already received compiler-level adjudication.

| Mismatch family | FP count | FN count | Interpretation / next proof |
| --- | ---: | ---: | --- |
| relationship calls | 1 | 0 | Mixed possible valid new emissions and actual errors; needs line-by-line source adjudication. |
| relationship contains | 11 | 3 | Mixed possible valid new emissions and actual errors; needs line-by-line source adjudication. |
| relationship exports | 4 | 0 | **Oracle coverage gap**: no facts of this kind exist in the ground truth. |
| relationship imports | 24 | 0 | **Oracle coverage gap**: no facts of this kind exist in the ground truth. |
| relationship overrides | 3 | 4 | Identity mismatch: hand-audited qualified targets versus analyzer's declaration-leaf targets; inspect actual semantic binding before counting errors. |
| relationship references | 42 | 0 | Mixed possible valid new emissions and actual errors; needs line-by-line source adjudication. |
| relationship uses | 5 | 4 | Mixed possible valid new emissions and actual errors; needs line-by-line source adjudication. |
| symbol | 18 | 10 | Mixed: annotated declaration lines, constructor naming, and newer declarations; evaluate each identity, not count alone. |
| **Total** | **108** | **21** | **Not yet a measured semantic error count.** |

### Concrete checks already supported by source

1. **Imports / exports (28 FP identifiers):** zero corresponding relationship kinds in `validation/m12/ground-truth/java.json`. Missing oracle entries do not make the analyzer's AST-derived import/export edges wrong.
2. **Annotation position:** `UserService.java` puts `@Service` at line 9 and the `class UserService` name at line 10; `AdvancedFeatures.java` puts `@Deprecated` at line 10 and the class name at line 11. M59 declaration-line convention intentionally points at the identifier; M12 truth still pins the annotation lines. Update the oracle only under an explicit scope/migration decision.
3. **Constructor identity:** older truth uses `constructor` as the symbol name; current Java lane intentionally uses the class name (separate fixture contract). These differences are **naming contract drift**, not by themselves missing constructors.
4. **Override identity:** M12 truth lists targets such as `BaseService.format` and `Repository.save`, whereas the M14 Java analyzer publishes declaration-leaf targets such as `format` and `save`, with owner in metadata. The comparison discards this metadata, so it cannot establish whether the intended ancestor was chosen.
5. **Other new relationship families:** `contains` for record components/type parameters, `references` for annotation/bounds/declaration types and `uses` for reads need targeted oracle decisions; absent truth rows alone are not proof of bad extraction.

## New production correction: method-generic override equivalence

Before these commits, `resolveOverrides` unconditionally skipped candidate
methods with their own generic type variables in its structured-method path.
Compiler-valid examples such as `<T> T id(T)` overridden by
`<U> U id(U)` were not proven and could fall to a 0.5 annotation guess.

The new syntax-local path:
- obtains method parameter declarations from tree-sitter's type-parameter AST;
- accepts only **unbounded** method variables with equal arity;
- independently substitutes containing-class generic bindings and alpha-renames
  declaring-method variables by declaration position;
- compares full parameter and normalized return spellings;
- refuses to use the old literal-signature fast path to bypass generic checks;
- emits `reasonCode: generic-method-alpha-equivalence` only on matching in-file declarations.

Regression fixtures:
`java/override-unbounded-method-alpha-equivalence` and
`java/override-generic-method-return-consistency`.
Both example programs compile under Java 21 (validated with `javac` and `javap`).
No regex was introduced into the analyzer.

**Remaining limits:** bounded generic method constraints, full covariance
proof, compiler classpath/import graph, cross-file override identity, and
the complete pinned Java corpus. These are NOT declared correct merely because
the new fixtures exist.

## Verification inventory and stop conditions

- Java 21 focused examples: **compiled** (and bytecode inspected).
- Focused logic/patch review: **performed**.
- Full TypeScript project typecheck for this new range: **not run here**.
- All Java M14 fixtures for this new range: **not run here**.
- M12 differential for this new range: **not run here**.
- Pinned/incoming corpus: **not available in this environment**.
- CI, lane protection, OS matrix: jobs currently have `if: false`, so
  GitHub records **skips**, not passes. The temporary disable was intentional
  (commit `ec6a39ce7`) and must be explicitly restored/approved.

### Independent agent acceptance work

1. Run `npx tsc --noEmit`; run Java M14 fixtures and ensure the new fixtures pass.
2. Run `bun script/m12/verify-analyzer.ts java`. Report its **fresh** raw output
   and precise input digest; do not silently commit regenerated M12 artifacts.
3. Independently validate generic method method-variable shadowing, bounded
   non-equivalence, return-type incompatibility, and non-overriding overloads
   using the Java compiler. Check reasons and confidence, not only edge counts.
4. Audit M12 mismatches against their own ground truth; do not change output or
   oracle data to force a high precision score.
5. Explain whether CI can be safely restored and how the corpus would be acquired.
6. Report any failures together as **one** consolidated audit, rather than
   a series of alternating one-fix handoffs.

**Gate status:** pending independent full-suite verification; no claim of
production perfection, corpus-wide recall or fully green CI is made here.

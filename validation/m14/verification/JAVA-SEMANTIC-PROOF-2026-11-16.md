# Java semantic proof — review branch

Base commit: `29a579243458490ff23d8de3f7f8f46aad120a43`.
Branch: `audit/java-semantic-proof-20261116`.

## Scope

This batch prevents project-local annotation names from fabricating Spring MVC
and OpenFeign edges, interprets a qualified RequestMethod.GET value correctly,
models Object's implicit superclass for a narrow subset of exact public
toString/hashCode overrides, avoids Lombok accessors for static/final fields,
and avoids duplicating real Spring Data declarations with phantom methods.

Generic Spring Data return values remain **unknown**, not `Object`, until
the type parameters are resolved. This is intentional abstention, not a
claim of complete Spring Data signature modeling.

## Verification contract

1. Java M14 fixtures must report **at least 98 passes, zero failures**.
   The runner's exit code alone is insufficient.
2. Production TypeScript must typecheck.
3. The existing generic-override and remediation compiler oracles plus
   `JavaAnalyzerSemanticOracle` must pass on JDK 21.
4. M12 Java differential has been remeasured on GitHub Actions and
   remains **known failing** (TP=95 FP=105 FN=21 unknown=6), unchanged
   from the pre-batch baseline. CI checks for that exact baseline rather
   than concealing the nonzero differential exit.
5. Full incoming corpus and indexer/SQLite integration remain
   unmeasured here; they require the admitted `BB_CORPUS_ROOT`
   population and end-to-end runtime. Fixture and javac success does not
   substitute for these checks.
5. Comparisons should include before/after row counts, not just green tests.

## Remaining limitations

- Override binding across external superclasses, Object.equals(Object),
  inherited Object methods on interfaces/records, erasure, covariance, and
  cross-file canonical method identity remain outside this narrow batch.
- Spring MVC multiple routes and verb arrays, composed annotations, classpath
  attribution, and annotation processors are not fully modeled.
- Spring Data generic return/parameter substitution and inherited repository
  ancestry require a compiler or classpath-aware path; unknown is not proof.
- Broad high-confidence annotation heuristics for JPA, DI and other frameworks
  still need the same semantic identity review.

The fixes are **pending runtime verification** until an explicit report from
the Java analyzer CI job or local production/corpus run exists.

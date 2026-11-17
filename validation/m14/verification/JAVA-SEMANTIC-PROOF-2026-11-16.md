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

1. Java M14 fixtures must report **at least 104 passes, zero failures**.
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
6. Comparisons should include before/after row counts, not just green tests.

## Remaining limitations

- Override binding across external superclasses,
  inherited Object methods on interfaces/records, erasure, covariance, and
  cross-file canonical method identity remain outside this narrow batch.
- Spring MVC multiple routes and verb arrays, composed annotations, classpath
  attribution, and annotation processors are not fully modeled.
- Spring Data generic return/parameter substitution and inherited repository
  ancestry require a compiler or classpath-aware path; unknown is not proof.
- Known direct JPA entity, table, column, Spring bean, and @Value cases now use
  explicit annotation binding. Other framework or composed annotations remain
  beyond this focused identity check.

The targeted implementation **has been executed** on GitHub Actions:
`103/103` Java fixtures, `94/103` on the original analyzer (nine negative
controls), `37/37` compiler facts and production TypeScript typecheck PASS
(run 44022401654, commit a817d82b). That run is not evidence for the
admitted local corpus, cross-file indexed graph, or full verification suite.

Spring Data generic parameter **and** return types remain unbound, not
falsely represented as `Object`. `javaParameterTypeUnbound` records the
uncertainty without manufacturing a concrete generic signature.

The analyzer is **NOT accepted/final** until the missing full corpus and
end-to-end verification and the still-failing M12 mismatch adjudication are
completed. The later review of CI must be against the latest PR head.


## Additional real-storage proof (2026-11-17)

[CI run 44025333667](https://github.com/backbencher-hq/backbencher-brain/actions/runs/44025333667)
executes **104/104** Java fixtures, 10 explicitly named killed regressions
on the original analyzer, **40/40** independent compiler judgments and
a self-contained production `ASTEngine.parseFile` →
`storeResults` → `BrainDatabase` SQLite test with two Java files.

Two files, two deliberate import channels per file: **all 4 edges survive**
under distinct persisted IDs; both file-level rows have the correct
project-relative importing filename and NULL source_symbol_id. A red
control swaps in the uncorrected indexer and requires the missing-channel
defect to manifest. The source mutation that removed one of the two
necessary import edges was rejected and reverted after existing fixtures
proved the second channel is contractually required.

This corrects an actual end-to-end defect and extends verification depth,
but does not replace the missing pinned large-corpus, API-level reference
attribution, or fully passing M12 differential.

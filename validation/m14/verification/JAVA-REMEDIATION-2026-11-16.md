# Java remediation — developer verification evidence, 2026-11-16

**Start commit:** `91d1401a12d22860a1d0a7d1d502f568d00ced30`.
**Latest production correction:** `cc81abd3c8ea3876e3a7a98050d14164ecf34e82`.
Three targeted Java production corrections and three new fixtures.
See `JAVA-STATE.md` for all commit IDs and unmeasured gates.

## Independently compiler-verified facts

Run:

```sh
mkdir -p /tmp/bb-remediation-oracle
javac -d /tmp/bb-remediation-oracle validation/m14/verification/JavaAnalyzerRemediationOracle.java
java -cp /tmp/bb-remediation-oracle JavaAnalyzerRemediationOracle
```

Authoring environment JDK 21 completed **12/12** facts: four source
units compile, three local conventional-name calls are project-declared,
custom `@Data/@Getter/@Setter` do not generate Lombok accessors,
a local `JpaRepository` does not inject Spring Data methods,
`jakarta.project.Owned` is project-declared, and
`Parent<T>.save(T)` is overridden by `save(String)` under `T=String`
but **not** by `save(Integer)`.

These judgments say what javac understands — they do NOT prove the
analyzer emits all expected graph relations. That is why the M14
fixtures must be executed by the independent verifier.

## Existing fixture contract changed deliberately

`library-import-binding.expectation.json` previously assumed
`jakarta.persistence.Persistence.createEntityManagerFactory` is
external without a complete project index. Java does not reserve
`jakarta.*`, so that claim lacked project ownership evidence.
The import declaration and call remain expected; external
`importedBinding/importedBindings` metadata is now absent on the
no-index fixture path. JVM-rooted `java.util.Collections.sort`
positive binding evidence is retained. Verify all of these
independently and compare actual M14 and corpus classification counts.

## Commands for final local verification

```sh
npm run typecheck
npm run typecheck:scripts
bun run script/m14/run-fixtures.ts --lang java
bun script/m12/verify-analyzer.ts java
bun script/m12/verify-regex-census.ts
# With BB_CORPUS_ROOT + known baseline:
bun script/m14/incoming-gate.ts java java 200
```

The fixture runner can report failures while returning exit 0:
inspect explicit pass/fail counts. No corpus, end-to-end fixture
runner, complete TypeScript environment, or CI runner was available
to the development author. GitHub workflows are intentionally
skipped. Compiler oracle success is **not** a substitute for any of
these gates.

**M12 warning:** committed differential values TP=95, FP=108,
FN=21, unknown=4 predate the latest verification agent's fresh
TP=95, FP=105, FN=21, unknown=6 reading. It is methodologically
invalid to call either score the production accuracy of the 10
Java relationship types without reconciling oracle coverage and
endpoint identity.

## What remains outside this focused correction batch

Full cross-file Java symbol-binding and canonical ID migration;
generic bounds/erasure/covariance; complete access control;
annotation processor fidelity; JDK grammar upgrades;
reproducible pinned corpus evidence; test automation restoration.
These are NOT represented as completed by the three commits.

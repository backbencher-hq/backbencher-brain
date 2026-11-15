# Independent audit follow-up

The first pass covered the Java generic-overload counterexample and the differential harness's source-endpoint blind spot. The worker cache comment now describes its batch scope. The follow-up covers Python decorator binding and regex fallback provenance, and adds a compiler check for C++ macro recovery.

## Java override regression

`bun run script/m14/run-fixtures.ts --lang java` passed all 80 Java fixtures. The new fixture failed before the fix. It checks same-arity overloads, a same-spelling type variable with a different binding, and positive direct and multi-hop substitutions. `javac` also accepted the fixture. A separate AST-engine probe with a name-only cross-file companion emitted one inferred edge for the annotated method at confidence 0.65 and no override for the unannotated overload.

## Differential edge identities

`bun run script/m14/differential.ts --self-test-edge-identities` exercises the missing-source counterexample, mismatched qualifiers, duplicate graph edges, and an unknown source. The scoped gate compares distinct `(source, label, target)` tuples before the legacy deduplication step. The oracle format supplies no comparable locations for counting individual call sites.

```sh
bun run script/m14/differential.ts --lang java --repo grails-core --sample 4 --check-edge-identities
```

On sample `fbc43b9873a42daa`, the file-level metric covered 185 of 186 truth rows. The identity gate returned exit code 5 with 25 matched tuples, 158 missing and 232 unexpected. The oracle sometimes supplies `(expr)` for a source and uses different endpoint spellings from the analyzer. The mismatch counts combine these limitations with any actual edge disagreements. The scoped gate uses a deterministic sample and leaves the legacy baseline and evidence artifacts intact. Fleet migration requires source-bearing oracles and comparable endpoint spellings.

## Python decorator binding

`bun run script/m14/run-fixtures.ts --lang python` passed all 66 Python fixtures. The new fixture failed on the original analyzer. It exercises a third-party namesake, a rebinding, an import below the class, and both forms of standard-library aliases. The check uses module-level import evidence and declines ambiguous bindings. It does not attempt to resolve nested-class decorators or runtime monkey-patching.

## Fallback provenance and independent C++ evidence

`BB_DATA_DIR=$(mktemp -d) bun validation/m14/verify-fallback-provenance.mts` passed through the worker's large-file fallback, SQLite storage and `bb_graph`. It covered full-file hashing, generated containment, stored calls, and compatibility with old rows that already carry `method: "regex"`. A CLI run on the same long-line shape reported one degraded file without a hash-drift warning. Old synthetic rows without that marker cannot be identified from relationship metadata alone.

`bun validation/m14/verify-cpp-macro-clang.mts` agreed with Clang on five class definitions and seven member edges on the existing macro fixture, using compiler flags to define the decorating macros. Running with `--mutate-recovery` disabled the production recovery branch in memory and made the comparison fail on the lost class. The remaining C++ differential rows that reuse production rules still measure consistency with those rules.

## Remaining verification work

The TypeScript `uses` oracle still has substantial disagreement. A separate run of `script/m14/typescript-oracle-agreement.ts --repo vue-core --sample 200` at corpus commit `f8975657d7` matched 330 rows, with 135 oracle-only and 267 analyzer-only rows. This run measured file-level target matching and used a different corpus from the audit's historical result. The counts require adjudication before they can support semantic accuracy claims. Fleet-wide endpoint verification and broader source mutation coverage remain open.

# Java heritage oracle — compiler binding remedy proposal

**Scope:** shared `script/m14/oracles/java-heritage-truth.ts`
(owner-managed). **Status:** correctness issue demonstrated by javac;
no shared oracle/arbiter code changed in the Java remediation batch.

## Reproducible mismatch

```java
class Parent<T> {
    void save(T value) {}
}
class OverloadChild extends Parent<String> {
    void save(Integer value) {}  // NOT an override
}
class OverrideChild extends Parent<String> {
    @Override void save(String value) {} // real override
}
```

JavaCompiler `Elements.overrides` confirms the negative and positive.
`validation/m14/verification/JavaAnalyzerRemediationOracle.java`
pins both judgments without relying on production Java analyzer output.

The current `hasTypeVariable(params)` recognizes only one uppercase
character, ignoring e.g. `ResultType` and nested generic type variables.
`deriveJavaOverridesTruth` currently accepts an ancestor method when
the names and arities match and either signature has a one-character
variable, even when the substituted parameter types are incompatible.
It also deduplicates override claims by bare method name and emits
`from: "(override)"`, dropping source and declaring-type identity.

This is **not independent Java override truth**. Do not blindly
re-author production analyzer output to match it.

## Proposed owner implementation

1. Keep cheap tree-sitter heritage checks as *candidate generation*
   with explicitly limited authority, not exact semantic proof.
2. For in-scope projects with an available JDK, construct a compiler
   task from the actual source set and classpath; ask
   `Elements.overrides(childMethod, parentMethod, childType)`.
3. Store the concrete declaring type, overriding type, parameter
   signature and source span. Do not deduplicate by method leaf.
4. Keep `javac` compile failures in a separate invalid-source
   category. Do not compare parser-recovery guesses as confirmed facts.
5. Run negative controls (generic-overload, covariant returns, static
   hiding, private members, package boundaries, interface diamonds).
6. Preserve historical oracle comparisons as their own labelled
   measurements; do not retroactively reclassify source disagreements
   without independent compiler evidence.

The owner should implement this alongside schema/arbiter changes and
run the full M14 mutation and differential gates. The Java lane
has intentionally not changed `script/m14/**` (shared ownership).

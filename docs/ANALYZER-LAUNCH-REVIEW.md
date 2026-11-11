# Analyzer launch review

The first launch pass covers TypeScript, JavaScript, C++, C, Python, Java, Kotlin, and Go. Rust, C#, PHP, Ruby, and Swift received a fixture and sampled corpus pass. The evidence record lists each sample and its limits.

The pass uses Backbencher's own symbol search, graph traversal, and file-scoped analysis to locate and prioritize code. Regressions are reproduced against source and the production AST entry point, with compiler checks where available. A stale indexed answer can locate a candidate for inspection. Current source and runtime checks determine the verdict.

## Confirmed defects repaired

- TypeScript receiver typing now keeps function scope at byte zero distinct from module scope and stops at untyped or conflicting local bindings.
- JavaScript receiver typing now uses its positional binding model, so same-name bindings in different scopes retain their own type facts.
- Kotlin overrides prefer exact signatures over generic-name guesses. A name-only companion can supply an inferred candidate when the in-file search has no candidate.
- The Go oracle now emits `instantiates` for its constructor-name convention. The analyzer classifies that convention as inferred and keeps syntax-backed composite literals structural.
- `bb_search` now applies an exact directory-bearing file scope and checks that file's freshness even when no matching symbol was indexed.

## Launch verification still open

- Replace source placeholders in the JavaScript and Swift oracles before using their endpoint counts as graph evidence. Java, C, C++, Kotlin, and Go also have partial endpoint attribution.
- Adjudicate TypeScript `uses` and the highest-impact unmatched C++ containment, C construction, and Ruby call cases against independent declarations and source sites.
- Extend full and incremental index comparisons to the same files and configurations for the primary lanes. The current corpus probes run in per-lane analysis context and do not establish full-index parity.
- Expand compiler-backed and source-mutation checks beyond the targeted C++ and Java controls. Language-specific fixture results and legacy label/target matching are narrower evidence than that review.

[Recorded runs and tool observations](../validation/m14/analyzer-launch-review.md)

## Deeper verification pass

The next pass added caller-aware JavaScript comparisons, independent direct-call controls for C and C++, and TypeScript lexical-block coverage. The worker-pool parity test now exercises adding an imported module and removing both an import and its source file. The worker self-test reports operating-system spawn failures distinctly from an older worker's lack of a self-test marker.

Whole-corpus endpoint certification still requires explicit source identities, especially for anonymous JavaScript callbacks and other source-less oracle rows. The incremental parity result covers the tested relative imports. Workspace aliases, transitive module changes, and other language-specific project indexes require their own parity cases.

## Rust, C#, PHP, Ruby, and Swift

This batch verified five analyzer lanes and the graph and impact tool handlers.
The C# and Swift override paths now mark companion method-name matches as
inferred. C# also marks its first-parent guess as inferred. PHP now follows
in-file ancestry to find the nearest eligible declaration and distinguishes
that result from companion evidence. Ruby preserves calls used as receivers
of property writes. The Rust containment oracle now names owners for more
nested declarations and uses the self type of trait implementations.

Both graph tools can root traversal in an exact indexed file when symbols
share a name. The duplicate-name regression exercises the production handlers
and checks the caller returned by each.

The 30-file corpus probes still leave endpoint verification open. Swift's
sample supplied no concrete oracle sources, and local Swift overrides still
match by name without checking overload signatures. PHP's simple-name lookup
still needs namespace and alias controls. Rust, C#, PHP, and Ruby still have
unresolved discrepancies recorded in the validation run.

[Batch runs and endpoint counts](../validation/m14/analyzer-launch-review.md#rust-c-php-ruby-and-swift-batch)

### Swift and PHP follow-up

Swift's differential now compares caller identities for calls inside uniquely
named functions and operators. Swift's local override lookup checks written
signatures and keeps shared overload endpoints inferred. PHP's in-file
override lookup now resolves class names through the namespace and class
import aliases. It omits edges whose stored member names collide in the file.

Swift calls in unsupported scopes, the remaining relationship labels, and
PHP's cross-file namespace resolution still require verification. The other
three lanes retain their previously recorded corpus discrepancies.

[Swift and PHP verification](../validation/m14/analyzer-launch-review.md#swift-and-php-follow-up)

### Nested callable attribution

Endpoint comparison exposed misattributed reads in a nested Swift function
and misattributed calls in a nested Ruby method. Both analyzers now use the
nested declaration as the source. Ruby also keeps its nested parameters and
assignments out of the enclosing method's locals. Ruby's companion override
matches now carry inferred evidence.

The Rust analyzer now preserves fully qualified dependency paths for nested
grouped imports. The Rust and C# oracles gained source coverage for reads,
imports, inheritance, and construction where the AST supplies the identity.

[Corpus runs and remaining discrepancies](../validation/m14/analyzer-launch-review.md#nested-callable-attribution)

### Rust and Ruby endpoint reconciliation

All 110 Rust files in the pinned ripgrep checkout pass the relationship tuple gate. A separate 30-file Cargo draw also passes.
The Rust oracle tracks enclosing sources for calls, macro invocations and
construction, preserves declared member paths, and keeps type references
from distinct declarations separate. Ruby's pinned Rake and Rack draws have zero
missing or unexpected comparable tuples. Ruby's unresolved sources and
inferred override targets still keep its endpoint gate open.

[Reconciliation tests and corpus evidence](../validation/m14/analyzer-launch-review.md#rust-and-ruby-endpoint-reconciliation)

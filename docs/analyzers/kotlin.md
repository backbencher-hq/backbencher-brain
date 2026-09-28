# Kotlin Analyzer

## Wasm provenance
Rebuilt from upstream fwcd/tree-sitter-kotlin@1852ea1 with CLI 0.26.9.
fieldCount=4 (named fields available including receiver).

## What it extracts
- **Symbols**: classes, objects, interfaces, enums, annotation types, functions,
  constructors, properties (val/var), enum members, companion object members
- **Relationships**: extends, implements, instantiates, calls, uses, contains,
  overrides, references (imports)
- **Payloads**: qualified_calls, KDoc comments, type parameters (class + function level),
  visibility, isExtension marker, apiContractPath, complexity (per-function cyclomatic),
  reasonCode on override edges

## Evidence tiers
Same rules as JVM family. Extension methods = usage_contextual Uses @0.9.
Override confidence tiered: exact-in-file @1.0, companion-index @0.85,
first-parent-guess @0.5 with machine-readable reasonCode.

## Type-reference semantics
- Declaration positions (ctor params, properties, function params, receivers,
  return types) emit `declared_type` / `return_type` references
- `x as T` → as_expression, `o is T` → check_expression
- Generics expand to base + all arguments; nullable wrappers descend

## Known limitations
- Wasm fieldCount=4 still fewer than upstream potential (receiver field works but
  other named fields may exist upstream that aren't available here)

## Verification
- Fixtures: 21+ (`validation/m14/fixtures/kotlin/`)
- Corpus: Exposed@1be66471 differential 99.5% coverage / 0.2% fabrication
- Grammar audit: PASS (0 unknown node-type references, fieldless flag cleared)
- Mutation hardening: drop-declared-types mutant CAUGHT via type-usage-graph fixture

# Java Analyzer

## What it extracts
- **Symbols**: classes, interfaces, records, enums, annotation types, methods,
  constructors (incl. compact), fields, interface constants, record components,
  enum constants
- **Relationships**: extends, implements, instantiates, calls, uses (field access),
  contains, exports, overrides, permits, references (imports + declared types:
  fields, params, locals, catch unions, throws; cast targets, instanceof checks,
  class literals, array creation, method-reference receivers, switch patterns)
- **Payloads**: qualified_calls, complexity (per-symbol cyclomatic), javadoc comments,
  genericParameters, visibility, decorators/annotations, apiContractPath (Spring routes)

## Evidence tiers
Every relationship carries `metadata.evidenceClass`:
- `structural`: grammar-clause derived (extends, implements, contains, exports)
- `usage_contextual`: observed calls, field access
- `inferred`: pass-3 override guesses @0.5

## Type-reference semantics
- Declared types expand generics: `Map<String, List<X>>` → Map, String, X
- Bounded wildcards descend: `List<? extends CharSequence>` → CharSequence
- Scoped names stay fully dotted: `java.io.IOException` (dotted-name convention)
- Primitives (`int`, `double`) are never type_identifier nodes — correctly silent

## Known limitations
- Override confidence reason codes added but pass-2/pass-3 thresholds not empirically calibrated beyond patterns.ts consumer audit
- Same-name ambiguity resolution picks one candidate without overload/language preference

## Verification
- Fixtures: 25 (`validation/m14/fixtures/java/`), incl. type-usage-graph pinning the declared-type graph
- Corpus: grails-core@HEAD differential 100% coverage / 0 fabrications; perf gate warm-up hardened
- Grammar audit: PASS (0 unknown node-type references)
- Mutation hardening: 4 java-specific mutants ALL CAUGHT (incl. drop-declared-types)

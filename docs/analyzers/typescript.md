# TypeScript Analyzer

## What it extracts
- **Symbols**: classes, interfaces, enums, type aliases, functions, methods,
  constructors, properties, accessors (get/set pair = one property), abstract members
- **Relationships**: extends, implements, instantiates, calls, uses (field access),
  contains, exports, overrides, references (imports)
- **Payloads**: qualified_calls, JSDoc comments, complexity (per-symbol cyclomatic),
  decorators, visibility, genericParameters, isMappedType, isConditionalType

## Evidence tiers
Same rules as JVM family. Heritage edges structural. Calls usage_contextual.

## Known limitations
- Decorator variants partially covered (class + property tested; method/param decorators need fixtures)
- Full grammar surface unmeasured (spec diff pending)

## Verification
- Fixtures: 14+ (`validation/m14/fixtures/typescript/`)
- Corpus: vue-core@f8975657 differential 100% coverage / 0.9% unexplained
- Grammar audit: PASS (union oracle: TS + TSX + JS)

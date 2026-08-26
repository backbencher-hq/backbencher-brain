# JavaScript Analyzer

## What it extracts
- **Symbols**: classes, functions (incl. arrow assigned to variables), methods,
  constructors, properties (incl. accessor pairs), prototype-assigned methods
- **Relationships**: extends (heritage), instantiates, calls, uses (field access via
  dedicated collector), contains, exports (named + default + CommonJS), overrides,
  references (imports + instanceof checks)
- **Payloads**: qualified_calls, JSDoc comments, evidenceClass on every edge

## Evidence tiers
Central classifier at end of analyze(): every relationship carries
`metadata.evidenceClass`. Same rules as JVM family.

## Type-reference semantics
- JS has no type annotations; `x instanceof T` is the only unambiguous
  named-type usage and emits `instanceof_check` references from the enclosing
  function/method (operator is an anonymous grammar token — detected by walk)

## Known limitations
- qualified_calls extraction implemented but coverage breadth not measured against corpus
- Prototype chain resolution limited to direct `X.prototype.m = function` pattern

## Verification
- Fixtures: 11+ (`validation/m14/fixtures/javascript/`)
- Corpus: graphql-js@HEAD differential 100% coverage / 0% unexplained
- Owner review waves: 2 (853f022: 8 defects; a00969e: 5 incl. 2 Tier-1)

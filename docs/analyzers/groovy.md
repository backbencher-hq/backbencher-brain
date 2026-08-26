# Groovy Analyzer

## What it extracts
- **Symbols**: classes, traits, interfaces, enums, methods, constructors, properties,
  constants
- **Relationships**: extends, implements, instantiates, calls (incl. juxt_function_call),
  uses, contains, overrides, references (imports), permits
- **Payloads**: qualified_calls, groovydoc comments, visibility, decorators/annotations,
  framework detection (grails/spring/hibernate/jpa/spock/junit)

## Evidence tiers
Same taxonomy as JVM family. Template instantiates = usage_contextual.
Script-level calls attributed to `(script)` sentinel.

## Type-reference semantics
- Fields, params, locals, throws clauses, instanceof targets emit references
- Generics expand to base + arguments; `def`/`as` keywords never become edges
- Grammar quirk: dangling `x as T` mis-parses as a declaration with
  type_identifier("as") — excluded by name

## Known limitations
- Same-name ambiguity resolution imprecise
- Chain topology root-anchored (documented decision)

## Grammar provenance
Vendored fork (amaanq 0.1.2, owner-improved). Measured head-to-head vs community
murtaza64 grammar: fork 34% clean parse rate vs 29%. Fork has trait support; murtaza64
does not. No rebuild needed.

## Verification
- Fixtures: 18+ (`validation/m14/fixtures/groovy/`)
- Corpus: grails-core@HEAD differential 100% coverage / 0 fabrications
- Grammar audit: PASS (0 unknown node-type references)
- Mutation hardening: drop-declared-types mutant CAUGHT via type-usage-graph fixture

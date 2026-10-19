# Scala Analyzer

## What it extracts
- **Symbols**: classes, traits, objects, enums, case classes, annotation types,
  type aliases, functions (including extension methods), constructor params as
  properties, enum members
- **Relationships**: calls, uses, contains, references, imports, exports, extends, overrides,
  instantiates, **mixes_in**. Fleet MIXIN RULING (2026-10-19): a with-clause trait is composition,
  not interface conformance — `implements` is RULED NOT-APPLICABLE for scala; position 0 of an
  extends clause stays `extends` and every further supertype is `mixes_in`.
- **Payloads**: ScalaDoc comments, annotation names as symbol metadata (annotations are TYPE MENTIONS
  and publish `references`; `decorates` is RULED NOT-APPLICABLE — reserved for runtime callable
  wrappers per the Java owner ruling), genericParameters, visibility, complexity (per-function
  cyclomatic), reasonCode on override edges

## Evidence tiers
Same rules as JVM family. Extension methods = usage_contextual Uses @0.9.
Override edges tiered by constructor-invocation semantics.

## Type-reference semantics
- Ctor params, val/var clauses, function params, return types emit references
- `@throws[IO]` → throws_type edges; asInstanceOf → cast_target; isInstanceOf
  → instanceof_check (parses as generic_function, not call_expression)
- Generics expand to base + all arguments

## Known limitations
- Companion-chain oracle shapes classified but some edge cases remain (#385 closed,
  residuals tracked separately)
- Dotted convention RATIFIED: full dotted names everywhere

## Verification
- Fixtures: 19+ (`validation/m14/fixtures/scala/`)
- Dual corpus: scala3@18df09c0 98.4%/0% · cats-effect@HEAD 100%/0%
- Grammar audit: PASS (0 unknown node-type references after 8 dead branches removed)
- Mutation hardening: drop-declared-types mutant CAUGHT via type-usage-graph fixture

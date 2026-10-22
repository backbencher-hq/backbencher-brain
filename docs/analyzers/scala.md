# Scala Analyzer

## What it extracts
- **Symbols**: classes, traits, objects, enums, case classes, annotation types,
  type aliases, functions (including extension methods), constructor params as
  properties, enum members
- **Relationships**: calls, uses, contains, references, imports, exports, extends, overrides,
  instantiates, **mixes_in**, **implements**. Fleet MIXIN RULING (2026-10-19): a with-clause trait is
  composition, not interface conformance — position 0 of an extends clause stays `extends` and every
  further supertype is `mixes_in`. **The ruling's own falsifier has since fired with a count, so
  `implements` is NOT ruled for scala**: the self-type `this: T =>` is a conformance with no
  composition semantics, and it is already expressible in the wired grammar (`self_type` is a named node
  type of the pinned build, 189 named of 455 node types). Measured over the admitted population: 1,017
  self-type sites in 636 files, of which 669 in 398 files carry a required type. Rung R3 — the analyzer
  publishes the row (`self_type` → the type named after the `:`; a self NAME publishes nothing, an
  X → X row publishes nothing, a type argument is not descended into) — with the behavioural fixture
  `validation/m14/fixtures/scala/self-type-implements.*` and the RED PROOF
  `script/m14/scala-implements-red-proof.ts`. Full reasoning:
  `validation/m14/verification/SCALA-IMPLEMENTS-R3.md`.
- ★ **A SUPERTYPE UNDER AN ANNOTATION (2026-10-21).** `extends AnyRef @MyAnnotation(...)` names the
  supertype `AnyRef` — the annotation is a MODIFIER on the type, not the type, and the grammar's
  `annotated_type` node holds the base type and then the annotation. MEASURED over the admitted
  population with the lane's heritage blind-spot probe: 35 `extends_clause` clauses name a REAL
  supertype only through an `annotated_type`, and every one of them published NO EDGE before the
  analyzer read through it. Rung R3 — `annotated_type` is already a named node type of the pinned
  build, so no grammar change is taken. Fixture `validation/m14/fixtures/scala/annotated-supertype.*`
  and the RED PROOF `script/m14/scala-implements-red-proof.ts` (1/5 asserted rows without the change,
  5/5 with it).
- **Payloads**: ScalaDoc comments, annotation names as symbol metadata (annotations are TYPE MENTIONS
  and publish `references`; `decorates` is RULED **ontological** for scala — an annotation is PASSIVE
  METADATA while the `decorates` row asserts an APPLIED CALLABLE; the near miss is named and counted:
  17,000 `annotation` sites in 3,456 files), genericParameters, visibility, complexity (per-function
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

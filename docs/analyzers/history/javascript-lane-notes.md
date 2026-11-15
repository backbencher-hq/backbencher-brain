# JavaScript Analyzer

## What it extracts
- **Symbols**: classes, functions (incl. arrow assigned to variables), methods,
  constructors, properties (incl. accessor pairs), prototype-assigned methods
- **Relationships**: extends (heritage), instantiates, calls, uses (field access via a
  dedicated collector), contains, exports (named + default + CommonJS), overrides,
  **renders** (JSX component usage — canonical label since 2026-10-18), **decorates**
  (decorator metadata edge — canonical label since 2026-10-18), and references
  (`instanceof` checks only; the decorator half became `decorates`, and imports are their
  own `imports` label)
- **External claims (2026-10-18, additive)**: edges naming a cited platform/runtime name are
  marked `metadata.isExternalTarget` with `externalReason` and a citation in `externalClaimReason`,
  from TWO closed cited tables — `HOST_GLOBALS` + `memberChainClaim` in
  `src/ast/js-builtin-prototypes.ts`, and `src/ast/js-runtime-globals.ts` (Node.js runtime and
  test-runner globals). The module-namespace claim on `imports` is fail-closed on a complete
  project index. Claims are published BESIDE resolution and never merged into it.
- **Receiver type**: a member call/read whose receiver type the file states carries the store's
  existing `metadata.owner` channel plus `metadata.ownerEvidence` ∈ {new, assignment, this, jsdoc}.
- **Payloads**: qualified_calls, JSDoc comments, evidenceClass on every edge

## Evidence tiers
Central classifier at end of analyze(): every relationship carries
`metadata.evidenceClass`. Same rules as JVM family.

## Type-reference semantics
- JS has no type annotations; `x instanceof T` is the only unambiguous
  named-type usage and emits `instanceof_check` references from the enclosing
  function/method (operator is an anonymous grammar token — detected by walk)
- A decorator is metadata on the symbol it decorates: it emits `decorates` from the decorated
  declaration at the decorator's own line, never a call/read by the enclosing scope

## Known limitations
- qualified_calls extraction implemented but coverage breadth not measured against corpus
- Prototype chain resolution limited to direct `X.prototype.m = function` pattern
- Receiver typing records only *stated* types (`new` initialiser, assignment/class field, `this`
  inside a class declaration, JSDoc `@type`/`@param`). A `this` inside a plain function (dynamic
  `this`, e.g. a jQuery/Ember callback) states no type and gets no owner; the cap-50 draw has
  several hundred such member calls, so that class is a wall rather than a missing form
- Imported bindings, member leaves of runtime globals, and `export default` literals are NOT
  claimed; they are counted as open classes in
  `validation/m14/verification/JAVASCRIPT-RESOLUTION-CLASSIFICATION.md`

## Verification
- Fixtures: 83 (`validation/m14/fixtures/javascript/`, run by
  `bun run script/m14/run-fixtures.ts --lang javascript`; the one standing failure is the
  pre-existing HEAD-only `non-name-callee-refused`)
- Current measured emission/claim state, with commands and populations:
  `validation/m14/verification/JAVASCRIPT-2026-10-18-EMISSIONS.md` (cap-50 before/after for the
  2026-10-18 wave) and `validation/m14/verification/JAVASCRIPT-RESOLUTION-CLASSIFICATION.md`
  (per-edge cause census). The older "corpus: graphql-js differential" line was a pre-wave
  reading; the wave page supersedes it and names what is still unaudited.
- Owner review waves: 2 (853f022: 8 defects; a00969e: 5 incl. 2 Tier-1)

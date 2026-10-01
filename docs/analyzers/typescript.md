# TypeScript Analyzer

## What it extracts
- **Symbols**: classes, interfaces, enums, type aliases, functions, methods,
  constructors, properties, accessors (get/set pair = one property), abstract members
- **Relationships**: extends, implements, instantiates, calls, uses (field access),
  contains, exports, overrides, references (imports + declared types: interface
  members, fields, params, returns, locals; as-casts, instanceof checks)
- **Payloads**: qualified_calls, JSDoc comments, complexity (per-symbol cyclomatic),
  decorators, visibility, genericParameters, isMappedType, isConditionalType

## Evidence tiers
Same rules as JVM family. Heritage edges structural. Calls usage_contextual.

## Type-reference semantics
- Every `type_annotation` emits references to its named types (primitives and
  builtin wrappers excluded); generics expand; nullable/union/readonly descend
- Return annotations directly on functions/methods after the parameter list
  are labelled `return_type`
- `x as T` → cast_target; `y instanceof T` → instanceof_check (target lexes
  as plain identifier in expression position — handled)

## Known limitations
- Decorator variants partially covered (class + property tested; method/param decorators need fixtures)
- Full grammar surface unmeasured (spec diff pending)

## Verification
- Fixtures: 14+ (`validation/m14/fixtures/typescript/`)
- Corpus: vue-core@f8975657 differential 100% coverage / 0.9% unexplained
- Grammar audit: PASS (union oracle: TS + TSX + JS)

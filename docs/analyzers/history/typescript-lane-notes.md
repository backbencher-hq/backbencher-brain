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
- Decorator variants: class, property, method, constructor and parameter
  decorators are all covered and pinned (`decorators`, `decorator-lines-860`,
  `decorator-exact`, `decorator-declaration-lines-861`, `controller-base`)
- Grammar surface is enumerated in `script/m14/spec/typescript-completeness.json`
  (handled_verified / internal_silent / closed gaps / 30 design decisions), with
  a tsx-dialect annex for the JSX node types
- A class EXPRESSION assigned to a variable (`const A = class Inner { m() {} }`)
  yields the variable symbol but not the class's members: the variable path
  suppresses descent for every non-`object` initializer, so only an
  `export default class` (which the export statement pushes directly) keeps
  them. The ledger lists `class` as handled_verified, and the coverage gate
  validates that by node-type OCCURRENCE in fixtures, not by emission — which is
  how this shape stayed invisible. Unfixed: recorded, not pinned.
- `linesOfCode` counts all lines to match the javascript twin; both over-count a
  trailing newline by one (family-level, left alone)

## Verification
- Fixtures: 76 (`validation/m14/fixtures/typescript/`)
- Corpus: vue-core@f8975657 differential 100% coverage / 0.9% unexplained
- Grammar audit: PASS (union oracle: TS + TSX + JS)

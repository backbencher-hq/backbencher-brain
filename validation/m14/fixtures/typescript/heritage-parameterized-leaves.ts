// M14 IMPORTS_ENUM gap 1 — `implements I<T>` published SOURCE TEXT as the edge
// endpoint, and the production path then DELETED the edge.
//
// The two heritage clauses disagree about where a generic's type arguments live.
// Measured on the pinned wasm (tree-sitter-typescript 0.23.2):
//
//   extends B<T>      (extends_clause value: (identifier)
//                                 type_arguments: (type_arguments ...))   SIBLING field
//   implements I<T>   (implements_clause (generic_type name: (type_identifier)
//                                              type_arguments: (type_arguments ...)))  NESTED
//
// `extractClassHeritage` skipped a `type_arguments` CHILD, which is correct for
// `extends` and never fires for `implements`. So the whole `generic_type` text
// became the target — `implements: A -> "I<T>"` — which is source text, the
// unresolvable-endpoint class the family refuses for an anonymous `new`
// constructor (X8). Worse, pool-worker.ts:594 drops any target whose leaf
// contains `<` or `>`, so the edge never reached the index at all. Corpus site:
// packages/typescript/src/api/node/node.generated.ts:41.
//
// WHY NO GATE CAUGHT IT: the differential's `normTarget` strips type arguments
// on BOTH sides, so truth `implements:A->I` and analyzer `implements:A->I<T>`
// compared equal. A normaliser on both sides hides the defect it normalises.
//
// Every shape the grammar actually produces is pinned below, plus the two
// ABSTENTIONS that keep the leaf rule from over-reaching: a predefined type in a
// constraint is a LANGUAGE keyword and names no symbol, and a type-parameter's
// own name is a BINDING, not a reference.
//
// Authored BEFORE the analyzer run.

export interface Shape {
  area(): number
}

// 1. the gain: a parameterised interface, named target `Shape`.
export class Circle implements Shape<number> {
  area(): number {
    return 1
  }
}

// 2. TWO parameterised interfaces on one clause.
export class Both implements Shape<number>, Shape<string> {
  area(): number {
    return 2
  }
}

// 3. a QUALIFIED parameterised interface: the target is the LEAF, not the path.
export class Qualified implements Ns.Shape<number> {
  area(): number {
    return 3
  }
}

// 4. the control: an unparameterized interface, unchanged behaviour.
export class Plain implements Shape {
  area(): number {
    return 4
  }
}

// 5. extends AND implements, both parameterised. The extends arm already
// stripped correctly (sibling-field shape) — pinned so the two clauses cannot
// drift apart again.
export class Derived extends Shape<number> implements Shape<string> {
  area(): number {
    return 5
  }
}

// 6. interface heritage with a parameterised base.
export interface Bigger extends Shape<number> {
  extra(): void
}

// 7. a constraint that is a PREDEFINED type names no project symbol.
export function widen<T extends string>(input: T): T {
  return input
}

// 8. a constraint that IS a project type.
export function shrink<T extends Shape<number>>(input: T): T {
  return input
}
// M14 IMPORTS_ENUM gaps 3 and 4 — two type POSITIONS that name a type and
// published nothing.
//
// 3. A type PREDICATE. Measured on the pinned wasm, the return type of
//    `f(): x is Foo` is NOT a `type_annotation`:
//
//      (return_type (type_predicate_annotation
//                     (type_predicate name: (identifier) type: (type_identifier))))
//
//    So `extractDeclaredTypeRefs`'s `type_annotation` case never fired for that
//    shape and the whole form was silent: `function g(x: unknown): x is Foo`
//    published no relationship at all. `asserts x is Foo` is the same idea under
//    a different wrapper (`asserts_annotation > asserts > type_predicate`), two
//    hops down.
//
// 4. A type-parameter CONSTRAINT. `<T extends C>` cannot be checked without `C`,
//    and the declaration is the only place `C` is named:
//
//      (type_parameter name: (type_identifier) constraint: (constraint (type_identifier)))
//
//    The pass had no case for either node, so `function f<T extends C>()` published
//    `references f -> T` — the BINDING — and never `C`. Corpus draw over tracked
//    .ts files of bb_tests/repositories/typescript: 53 constraint sites in the first
//    40 files, 13 of whose 24 distinct names an edge reached.
//
// The predicate's `name` (`x`) is a PARAMETER binding and the type parameter's own
// `name` (`T`) is a BINDING. Both are pinned as forbidden below: the java oracle
// states the rule in its own words — "a TYPE PARAMETER DECLARATION is not a type
// usage: `<T>`, `<A extends B>`, `<K, V>` declare variables, they do not name a
// type in the file".
//
// Authored BEFORE the analyzer run.

export interface Shape {
  area(): number
}

export interface Named {
  label(): string
}

// 1. a function type predicate — the gain.
export function isShape(x: unknown): x is Shape {
  return typeof x === "object"
}

// 2. a method type predicate, owned by the method.
export class Guard {
  isNamed(x: unknown): x is Named {
    return typeof x === "object"
  }
}

// 3. `asserts x is Foo` — the same idea two hops down a different wrapper.
export function assertShape(x: unknown): asserts x is Shape {
  if (x === null) throw new Error("no")
}

// 4. `asserts x` with NO type names anything, so it must stay silent.
export function assertSomething(x: unknown): asserts x {
  if (x === null) throw new Error("no")
}

// 5. a function type-parameter constraint — the gain.
export function onlyShapes<T extends Shape>(input: T): T {
  return input
}

// 6. a QUALIFIED constraint. The reference pass reduces through the type node
// rather than taking raw text, so the target is the qualified name it read, and
// the USES surface reduces it to the leaf. Both are pinned because the two
// surfaces have different conventions and a later "consistency" edit that
// collapsed them would be a behaviour change nobody measured.
export function onlyNamed<T extends Shape & Named>(input: T): T {
  return input
}

// 7. a CLASS type-parameter constraint.
export class Registry<T extends Shape> {
  store(input: T): T {
    return input
  }
}

// 8. an INTERFACE type-parameter constraint. The `uses` surface does not fire for
//    an interface owner — the reference pass's own owner list — so only the
//    reference row is expected. Pinned so that asymmetry is visible rather than
//    mistaken for a missing edge.
export interface ShapeMap<V extends Shape> {
  get(key: string): V | undefined
}

// 9. a constraint that is a PREDEFINED type names no project symbol.
export function widen<T extends string>(input: T): T {
  return input
}

// 10. the control: a type MENTION the pass already read, so the gain above cannot
//     be attributed to the fixture merely containing the type's name.
export function takesShape(input: Shape): Shape {
  return input
}

// 11. a type parameter whose OWN NAME is used nowhere else in the file. `Q` is
//     bound by this declaration and mentioned nowhere, so ANY edge to `Q` is
//     unambiguously the collector reporting a BINDING as a type reference — which
//     is what a constraint collector that passed the whole `type_parameter` node
//     instead of its `constraint` field would do. That is the one fabrication the
//     gain in shape 5 invites, and it needs a name of its own to be detectable.
export function boundOnly<Q extends Shape>(): void {
}
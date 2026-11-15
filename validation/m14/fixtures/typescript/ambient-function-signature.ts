// An AMBIENT function declaration \u2014 `declare function f(): T` with no body \u2014 is a
// different grammar node from a function with one (`function_signature` vs
// `function_declaration`), and the analyzer knew nothing about the signature
// form: the type appeared nowhere in the source. The spec nevertheless carried
// `function_signature` as handled_verified, and the coverage gate was satisfied
// because a fixture PARSED one \u2014 which is the whole trap. A node type
// occurring in a fixture is evidence the type is exercised, never evidence that
// anything is emitted for it.
//
// The real population of this shape is `.d.ts` files: an ambient module body is
// nothing but signatures. Measured on the tracked corpus, all 7 occurrences
// were in 3 declaration files, and all 7 functions were invisible \u2014 no symbol,
// no call edge, no complexity, no api-contract row, despite being the entire
// public surface those files declare. `complexity-parity.ts` in this very
// directory has contained a `declare function f6Declared(...)` that no
// expectation ever named.
//
// The class and interface paths already routed `method_signature` and
// `abstract_method_signature`; this pins the statement-level counterpart, with
// owner attribution (a signature inside `declare module` belongs to that module)
// and the payload that makes the symbol useful: parameter names and return type.
//
// Authored BEFORE the analyzer run.
declare function topLevel(seed: number, label?: string): Promise<string[]>;

declare module "ambient" {
  export function insideModule(req: string): number;
  export class Holder {
    value(): number;
  }
}

export namespace container {
  export function nested(a: number): void;
}

// Regression guard: a body-bearing declaration is the same extractor and must
// keep its own body-derived data, not be flattened into the signature path.
export function withBody(a: number): number {
  return a * 2;
}

/**
 * JSDoc `@implements` → `implements` edges. THE ONLY WAY JAVASCRIPT STATES CONFORMANCE.
 *
 * WHY THIS EXISTS AT ALL. JavaScript has no `implements` CLAUSE — `class A implements B {}` is a
 * SyntaxError — so a 2026-11 ruling declared the `implements` label unexpressible for this lane after
 * measuring two things correctly: the pinned grammar has no `implements_clause` node (and the sibling
 * TypeScript grammar does, so the scan was shown to be able to find one), and no analyzer path emitted
 * it. Both measurements answered "can the GRAMMAR express it". Neither asked how JavaScript code
 * actually states conformance, and the answer is JSDoc — which is a comment, so it needs no grammar
 * change at all.
 *
 * Measured in real production code, not constructed for this fixture:
 *   svelte/packages/svelte/src/compiler/utils/compile_diagnostic.js
 *     \/** @typedef {{ code: string; … }} ICompileDiagnostic *\/
 *     \/** @implements {ICompileDiagnostic} *\/
 *     export class CompileDiagnostic { … }
 *
 * THE SHAPES, one per form the ecosystem writes (the parser is text-scan, no regex):
 *   braced       `@implements {IFoo}`          -> IFoo
 *   bare         `@implements IFoo`            -> IFoo         (Closure accepts this)
 *   generic      `@implements {Iterable<T>}`   -> Iterable     (a type ARGUMENT is not a name)
 *   union        `@implements {A|B}`           -> A and B      (a union states both)
 *   qualified    `@implements {ns.IFoo}`       -> IFoo         (leaf, same as `extends ns.Base`)
 *   self         `@implements {Itself}` on class Itself -> NO row (an edge to its own declaration)
 *   absent       a class with no @implements   -> NO row
 */

/** @typedef {{ code: string }} IBase */
/** @implements {IBase} */
export class Braced {
  run() {
    return 1;
  }
}

/** @implements IBase */
export class Bare {
  run() {
    return 2;
  }
}

/** @implements {Iterable<string>} */
export class Generic {
  *[Symbol.iterator]() {}
}

/** @implements {ILeft|IRight} */
export class Union {
  run() {
    return 3;
  }
}

/** @implements {some.namespace.IQualified} */
export class Qualified {
  run() {
    return 4;
  }
}

/** @implements {SelfNamed} */
export class SelfNamed {
  run() {
    return 5;
  }
}

export class NoDoc {
  run() {
    return 6;
  }
}

export const VALUES = { Braced, Bare, Generic, Union, Qualified, SelfNamed, NoDoc };

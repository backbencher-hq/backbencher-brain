// @flow
//
// A Flow-annotated `.js` file that declares conformance with the CLAUSE form, not the JSDoc tag.
//
// The javascript grammar cannot parse Flow, so the engine retries this file with the TypeScript
// grammar (gated on the `@flow` pragma, on the primary parse FAILING, and on the fallback parsing
// clean). In that tree `class A implements B` is a real `implements_clause` — and the analyzer now
// reads it. Measured before that branch: the classes were published and the `implements` rows were
// ZERO, so a Flow project written in the clause style read as "implements nothing".

interface Shape {
  area(): number;
}

interface Named {
  name: string;
}

class Circle implements Shape {
  radius: number;
  area() { return 3.14 * this.radius * this.radius; }
}

class Square implements Shape, Named {
  name: string = "square";
  area() { return 4; }
}

// a negative: a class that implements nothing must emit nothing
class Plain {
  area() { return 0; }
}

export { Circle, Square, Plain };

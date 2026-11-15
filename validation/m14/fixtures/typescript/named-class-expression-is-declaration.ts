// A class EXPRESSION that carries a name is a class DECLARATION. The name is
// written in the file, it is in scope inside its own body, and `new Inner()`
// inside that body already resolved to it. There was no `case "class"` in the
// walk at all, so the expression was treated as a bare bag of members and lost:
//
//   * no `Inner` Class symbol — the class was invisible as a type;
//   * therefore no `contains` edge either. The member extraction attributes `m`
//     to owner `Inner`, and containment drops an edge whose owner is not a
//     symbol, so a named class expression contributed NO members to the
//     hierarchy. The javascript twin emitted the same edge as a DANGLING one
//     for the identical construct — both twins were wrong, in opposite ways;
//   * and `extends` / `implements` went with it, even though heritage is clause
//     structure the generic oracle derives.
//
// This resolves a divergence that the class-expression fixture recorded rather
// than adopted: it had a `forbidRelationships` pin on `contains Inner->m`,
// stating that adopting the twin's edge needed a ruling on whether a class
// expression should be a symbol at all. This file is that ruling, and the pin
// is now positive.
//
// The ANONYMOUS form is pinned as the deliberate counter-case: with no name of
// its own it has nothing to be a symbol under, so its members belong to the
// binding that holds the value — `Anon contains m` — and that edge resolves.
//
// Authored BEFORE the analyzer run.
declare const Base: { tag: string };
declare const Mixin: { tag: string };

// A named class expression: a declaration, with heritage.
export const Named = class Inner extends Base implements Mixin {
  m(): number {
    return 1;
  }
  n(): string {
    return this.m().toString();
  }
};

// The self-reference already resolved before the fix; the symbol it named did
// not exist, so this edge pointed at nothing.
export const SelfRef = class Recur {
  again(): Recur {
    return new Recur();
  }
};

// A constructor is a Constructor in every form that has a class — including
// here, where pre-fix the descent path made it a Method.
export const WithCtor = class Ctor {
  constructor(readonly value: number) {}
};

// The ANONYMOUS counter-case: no name, so members belong to the binding.
export const Anon = class {
  m(): number {
    return 2;
  }
};

// A class expression in argument position is still a declaration.
export function register(value: unknown): unknown {
  return value;
}
register(class Registered {
  run(): void {}
});

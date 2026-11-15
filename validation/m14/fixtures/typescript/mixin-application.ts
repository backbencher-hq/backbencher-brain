// MIXIN APPLICATION — the shape `class X extends Mixin(Base) {}` (R3, `mixes_in`).
//
// THE DISCRIMINATOR AGAINST `extends` IS THE SHAPE OF THE HERITAGE EXPRESSION, NOT THE NAME OF THE
// BASE: a plain type name in the heritage position is INHERITANCE (`Plain extends Timestamped`), and
// a CALL in the heritage position is a MIXIN APPLICATION (`Post extends Tagged(Timestamped)`).
//
// This file exists to make the difference RED-ABLE: `Post` must produce a `mixes_in` edge to the
// callee `Tagged`, `Plain` must produce an `extends` edge to `Timestamped`, and NEITHER may produce
// the other's edge. The argument `Timestamped` must NOT become the mixin's target — the relation is
// to the factory, because the factory is the name a reader follows.

class Timestamped {
  stamp = new Date().toISOString()
}

type Ctor<T = {}> = new (...args: any[]) => T

function Tagged<TBase extends Ctor>(Base: TBase) {
  return class extends Base {
    tag = "tagged"
  }
}

/// <reference types="fixture-should-not-matter" />

class Post extends Tagged(Timestamped) {
  title = "post"
}

class Plain extends Timestamped {
  title = "plain"
}

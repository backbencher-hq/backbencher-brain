// fixture: javascript/decorator-metadata-868
// M49 (#868). The javascript half of the web family's decorator contract. Four
// things are pinned on one shape:
//
// 1. A FIELD's decorator is attached to the FIELD. The class and method paths
//    called the own-child collector; the field path never did, so `@inject(DB)`
//    above `pool = make()` attached nothing while the identical typescript shape
//    yielded decorators=["inject"].
// 2. A DECORATOR'S NAME IS A REFERENCE FROM THE SYMBOL IT DECORATES, at the
//    decorator's OWN line — the line the `@name` is written on, never the
//    declaration's (each decorator here sits on a different line from the name
//    it decorates, so the near-miss answer is a different number).
// 3. THE DECORATOR IS NOT A CALL BY WHOEVER ENCLOSES IT. `@inject(DB)` is
//    syntactically a call in the class body, so the walk emitted
//    `calls Service -> inject` — a class that appears to call a decorator it
//    never mentions in its body — and the bare-read pass turned every decorator
//    name into a `uses` edge from the decorated symbol. The family rule
//    (typescript's `inDecoratorPosition`, JVM annotations, the python oracle's
//    PYD1) is metadata-only.
// 4. AN EXPORTED CLASS KEEPS ITS DECORATOR. This grammar puts the class
//    decorator on the WRAPPING export_statement when the class is exported
//    (`export_statement [decorator@…, export@…, class_declaration@…]`), where
//    the own-child reader never looked — so `@sealed export class Service`
//    produced no decorator and no reference edge at all.
//
// Discriminations built into the text, so a wrong rule fails rather than
// passes: `make()` in the field INITIALIZER is a real call and must survive
// (decorator position is positional, not "anything near a decorator"), the
// getter's BODY still emits its own read, and `DB` is read as a decorator
// ARGUMENT — decorator position, so it is skipped by declaration.

function sealed(target) {
  return target
}

function inject(name) {
  return () => undefined
}

const DB = "db"

function make() {
  return 1
}

@sealed
export class Service {
  @inject(DB)
  pool = make()

  @sealed
  method() {}

  @inject("getter")
  get value() {
    return this.pool
  }
}

// DECORATOR ARGUMENTS ARE NOT DECORATES ROWS.
//
// A `decorates` edge names the DECORATOR — the leaf `jsDecoratorName` reads off the
// decorator node — never a name used as its ARGUMENT: `@inject(make())` emits
// decorates method -> inject, and NO decorates/calls row for `make`, because decorator
// position is suppressed whole by the call and read walks (`inDecoratorPosition`).
// DISCRIMINATION: the genuine call in the field INITIALIZER (`pool = make()`) must
// survive, so the fixture cannot pass by suppressing everything near an `@`.

function inject(token) {
  return (target, key) => target
}

function make() {
  return "constructed"
}

class Widget {
  @inject(make())
  method() {
    return make
  }

  pool = make()
}

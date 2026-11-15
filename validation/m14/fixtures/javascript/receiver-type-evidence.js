// RECEIVER TYPE EVIDENCE — the four syntactic proofs a JavaScript file can state, plus the two
// controls that must stay silent.
//
// JavaScript has no type syntax, so `metadata.owner` may only be recorded from a form that
// genuinely states the type: `new` initialiser, an assignment (`this.x = new C()`, a class field),
// `this` inside a class declaration, and JSDoc (`@type`, `@param` — including the constructor
// parameter carried onto `this.dep`). A plain function's dynamic `this` and a call-result receiver
// state nothing at all. A wrong owner is worse than none: the store withdraws the name binding for
// an owner-carrying row and then declines when the owner is not exactly one class-like symbol.

class Service {
  run() { return 1; }
}

class Consumer {
  constructor() {
    this.svc = new Service();
  }

  go() {
    this.svc.run();
    this.helper();
  }

  helper() { return 2; }
}

class FieldHolder {
  svc = new Service();

  use() { this.svc.run(); }
}

class Injected {
  /** @param {Service} dep */
  constructor(dep) {
    this.dep = dep;
  }

  use() { this.dep.run(); }
}

function build() {
  return new Service();
}

function typedFresh() {
  const fresh = new Service();
  fresh.run();
}

function documentedUse() {
  /** @type {Service} */
  const documented = build();
  documented.run();
}

function controlResult() {
  const result = build();
  result.run();
}

function controlDynamicThis() {
  this.other();
}

// RECEIVER-EVIDENCE DEPTH — the two NEW static proof classes for the owner channel.
//
// `class-static`: a member call/read whose receiver identifier names a PROGRAM-scope class
// DECLARATION in this file. That class's members are published symbols, so the owner channel can
// resolve the member inside it; the proof is positional (a parameter shadowing the class name is NOT
// the class and gets no owner).
//
// `this-alias`: `const self = this` inside a class declaration's method. The alias's type is the
// enclosing class — the same positional proof `this.m()` already uses, spelled through a local. A
// plain function's `this` is dynamic (a nested plain function inside a method rebinds it), and a
// class expression's class is not a published symbol: both get NOTHING rather than a guess.

class Service {
  static create() {
    return new Service();
  }
  start() {
    return 1;
  }
}

function useStatic() {
  const svc = Service.create();
  return Service.STATIC_MEMBER;
}

function shadowed(Service) {
  return Service.create();
}

class Pool {
  dispatch() {
    return 1;
  }
  run() {
    const self = this;
    return self.dispatch();
  }
}

function plainDynamic() {
  const self = this;
  return self.anything();
}

class Nested {
  run() {
    function inner() {
      const self = this;
      return self.anything();
    }
    return inner();
  }
}

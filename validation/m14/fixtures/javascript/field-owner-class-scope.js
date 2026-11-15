// FIELD OWNER IS SCOPED TO THE CLASS THAT DECLARES IT — the class-scoping half of receiver typing.
//
// `collectLocalReceiverTypes` keys `fieldTypes` by FIELD NAME alone, so `this.<f>` written in class A
// is visible to a read of the same field name inside class B, and B's member call is published with
// A's type as `metadata.owner`. That owner is a false statement the store then acts on
// (`claimOwnerCarryingTargets` withdraws the name binding and re-resolves inside the owner), so a
// member call on an unrelated class can end up bound to A's declaration. Measured end-to-end in a
// real index: `HolderB.b` — which never writes `this.svc` and has no relationship to `SvcA` — is
// bound to `SvcA.run`. See validation/m14/verification/JAVASCRIPT-OWNER-CHANNEL-AUDIT.md.
//
// EVERY SHAPE USES ITS OWN METHOD NAMES, and that is load-bearing rather than tidiness: the fixture
// matcher compares a forbid row against ANY actual row with the same type/from/target/owner, so a
// shared `b -> run` across three shapes would make one shape's CORRECT owner match another shape's
// forbid row. With distinct names (`oneB`, `twoB`, `threeB`) each assertion is about one shape.
//
// The three shapes:
//   1. one writer, reader never writes   -> the reader must get NO owner
//   2. two writers, SAME type            -> each class's own read keeps the owner
//   3. two writers, DIFFERENT types      -> each class keeps ITS OWN type
//
// The `forbid` rows are the point: they pin the WRONG owner rather than a missing one, because a fix
// that simply deletes every field owner would satisfy an `expect`-only suite.

class SvcA {
  run() {
    return 1;
  }
}

class SvcB {
  run() {
    return 2;
  }
}

// ── 1. one writer, and a reader that never writes the field ────────────────────────────
class HolderA {
  constructor() {
    this.svc = new SvcA();
  }
  oneA() {
    return this.svc.run();
  }
}

class HolderB {
  // no this.svc, ever
  oneB() {
    return this.svc.run();
  }
}

// ── 2. two writers of the SAME type ────────────────────────────────────────────────────
class SameA {
  constructor() {
    this.dep = new SvcA();
  }
  twoA() {
    return this.dep.run();
  }
}

class SameB {
  constructor() {
    this.dep = new SvcA();
  }
  twoB() {
    return this.dep.run();
  }
}

// ── 3. two writers of DIFFERENT types ──────────────────────────────────────────────────
class DiffA {
  constructor() {
    this.other = new SvcA();
  }
  threeA() {
    return this.other.run();
  }
}

class DiffB {
  constructor() {
    this.other = new SvcB();
  }
  threeB() {
    return this.other.run();
  }
}
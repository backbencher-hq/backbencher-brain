// M49 #758 regression fixture — accessor-slot semantics (B5) + static/instance
// namespace separation (B4). Authored before analyzer run; expectations pin the
// CONTRACT, not whatever the analyzer happens to emit.
//
// B5: a get/set pair is TWO descriptor slots (Object.getOwnPropertyDescriptor
// returns {get, set}) — both symbols survive with accessorKind metadata, and
// BOTH bodies' calls emit (pre-fix the owner:name dedup key ate the pair,
// deadSpanned the getter, and dropped track()).
// B5 cross-kind: a data member REPLACES the whole descriptor slot — `x()`
// after `get x()` kills the accessor entirely, including its body's calls
// (pre-fix residue: the setter half survived as a zombie).
// B4: static methods live in a DIFFERENT namespace than instance methods —
// Sub2.greet2 (static) does NOT override Base2.greet2 (instance); the
// pre-fix rule fabricated that edge for every static/same-name pair.

class Pair {
  constructor() { this.inner = 0; }
  get val() { return track(this.inner); }
  set val(v) { this.inner = wrap(v); }
  data() { return 1; }
}

class Overwrite {
  get x() { return makeX(); }
  x() { return "method wins"; }
}

class Base2 {
  greet2() {}
}

class Sub2 extends Base2 {
  static greet2() {}
}

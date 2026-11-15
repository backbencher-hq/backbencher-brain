// JD4 regression fixture — a CLASS EXPRESSION's heritage is a real inheritance edge.
//
// There was no `case "class"` in the analyzer's declaration switch at all, so
// `const K = class extends Base { … }` emitted no extends edge. Worse, the
// differential's heritage walk was gated on the same shape, so BOTH sides were
// blind and the lane reported agreement on a declaration form neither could
// see — the shared-blind-spot class that JD14 also found for `contains`.
//
// The oracle moved with the analyzer (differential.ts, the heritage walk's node
// gate now admits the `class` expression type). Emitting the edge on one side
// alone would have registered as a FABRIFICATION.
//
// Three binding shapes are pinned, because the edge needs a name to attach to
// and only two of the three have one. The UNBOUND anonymous form is pinned as
// silence: `runIt(class extends Base {})` names nothing, so no edge exists to
// emit — the first cut of this fix pushed `source: ""` and produced a dangling
// row whose source is not a symbol.

class Base {
  ping() {
    return 1;
  }
}

class Lib {
  static Base = class {};
}

// 1. a const-bound class expression: the binding names the edge.
const K = class extends Base {
  go() {
    return 2;
  }
};

// 2. a class expression with its OWN name: that name wins over the binding.
const Named = class Inner extends Base {
  go() {
    return 3;
  }
};

// 3. an assignment-bound class expression — the form a custom-element base is
//    actually written in.
let Bound;
Bound = class extends Base {
  go() {
    return 4;
  }
};

// 4. a QUALIFIED base keeps its dotted spelling, matching the declared
//    `js-member-heritage` contract (JSD19): `extends Lib.Base` -> Lib.Base.
const Qualified = class extends Lib.Base {
  go() {
    return 5;
  }
};

// 5. an unbound anonymous class expression: SILENCE. Nothing names it.
export default class extends Base {
  go() {
    return 6;
  }
}

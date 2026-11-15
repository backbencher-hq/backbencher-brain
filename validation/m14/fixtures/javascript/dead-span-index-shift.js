// JD1 regression fixture — post-walk symbol removal must be index-stable.
//
// The analyzer ends its walk with two rules that DELETE symbols:
//   J3  — drop symbols strictly inside a superseded duplicate method's body
//   B5  — drop an accessor half killed by a data member replacing its slot
// They used to run as two SEQUENTIAL splices. `b5Zombies` holds indices captured
// DURING the walk, but the J3 splice ran first and shifted every later index down
// by one per removal — so the B5 splice acted on a stale index space and deleted
// a live, unrelated symbol while leaving the killed accessor half behind.
//
// The shape below is the trigger: a nested CLASS (the only thing that yields a
// symbol inside a method body) textually before a get/set/data triple.
//
// Contract:
//   - `keep` SURVIVES. It is an ordinary method with nothing to do with either
//     rule; the pre-fix pass deleted it, which is silent index corruption.
//   - exactly ONE `x` survives, kind=method. The killed setter half must NOT
//     survive — that is the B5 invariant (mirrors accessor-slot-semantics, which
//     cannot reach this path because its Overwrite class has no setter half).

class Trigger {
  m() {
    class Inner {}
    return Inner;
  }
  m() {
    return 2;
  }
  get x() {
    return 1;
  }
  set x(v) {
    this.y = v;
  }
  x() {
    return 3;
  }
  keep() {
    return 4;
  }
}

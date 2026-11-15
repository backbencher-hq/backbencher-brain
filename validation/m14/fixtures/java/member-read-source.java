// M49 W15 #814 regression fixture — a `this.count` member READ is sourced to
// the enclosing METHOD, not to the enclosing type.
//
// Before the ruling the java analyzer sourced `this`/`super` field reads to the
// enclosing TYPE (the JAD2 exception, justified by "the swift precedent"), while
// every OTHER receiver already resolved to the method. The owner ruled the
// family onto method-source, and swift moved in the same wave — so the
// exception's justification is gone and the graph now composes:
// `x calls read` + `read uses count` answers "who ultimately touches count".
//
// `bump()` is the JAD1 write gate: `this.count = 1` is a WRITE, so no uses edge
// may originate from it — the fixture asserts that both directions.
class Store {
  private int count = 0;

  int read() {
    return this.count;
  }

  void bump() {
    this.count = 1;
  }
}

// M49.G1 wave (multi-catch family parity): pins two contracts on live parses.
//   1. Multi-catch union `catch (IOException | SQLException e)` emits a
//      declared_type References edge for EACH union member (java JLS 14.20
//      parity — java pins this in overload-arity-varargs-multicatch; the
//      pre-fix groovy walk had NO catch case, so both members vanished).
//   2. Varargs `int... xs` overriding array `int[] xs` resolves as an exact
//      in-file override (family contract — same signature per JLS 8.4.1).
class Catcher {
  void run() {
    try {
      risky()
    } catch (IOException | SQLException e) {
      log(e)
    }
  }
  void risky() throws IOException {}
  void log(Exception e) {}

  // QUALIFIED multi-catch coverage. The collector emits a declared_type edge
  // only for a name containing a `.`, so the bare `IOException | SQLException`
  // union above exercises the catch_formal_parameter walk case without
  // producing an observable edge. This second union writes the same JLS 14.20
  // shape with qualified members - the form the analyzer does report - so the
  // channel is actually observed by the lane.
  void runQualified() {
    try {
      riskyQualified()
    } catch (java.io.IOException | java.sql.SQLException e) {
      log(e)
    }
  }
  void riskyQualified() {}
}

class VarBase {
  void bar(int... xs) {}
}
class VarSub extends VarBase {
  void bar(int[] xs) {}
}

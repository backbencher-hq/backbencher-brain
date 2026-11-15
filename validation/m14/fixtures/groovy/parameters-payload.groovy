class ParamSvc {
  def apply(double amount, int percent) {
    return amount * (1 - percent / 100)
  }

  def join(String... parts) {
    return parts.join(",")
  }
}

// M60 R10 follow-up — a WRITTEN QUALIFIED parameter type. `Outer.Criterion` is
// the grammar's `scoped_type_identifier` (probe-verified), and this extractor's
// node list was the ONE place in the lane that did not accept it (the
// record-component extractor, the instantiation type node and `baseTypeName`'s
// own doctrine — "a scoped type keeps its full dotted text, matching the Java
// analyzer convention" — all already did). The written type was therefore
// dropped from the payload: the parameter read `undefined` while its declaration
// named the type, and the override signature keyed on parameter types lost the
// distinction between two overloads differing only in a qualified type.
// Measured before the fix on a 600-file grails-core sample
// (script/m60/groovy-parameter-payload-census.ts): 8 of 33 joined
// written-qualified slots recorded no type. The generic + qualified shape
// (`java.util.Map.Entry<String, Boolean>`) is included because a generic was
// already accepted, so it must keep working.

class Outer {
  static class Criterion {}
  static class Projection {}

  interface Handler {
    int handle(Outer.Criterion criterion, java.util.Map.Entry<String, Boolean> eldest, StringBuilder q)
  }

  static class HandlerImpl implements Handler {
    int handle(Outer.Criterion criterion, java.util.Map.Entry<String, Boolean> eldest, StringBuilder q) {
      return 0
    }
  }

  static class Holder {
    Outer.Criterion criterion

    Holder(Outer.Criterion criterion) {
      this.criterion = criterion
    }

    void spread(Outer.Projection... projections) {
    }
  }

  static record Pair(Outer.Criterion criterion, Outer.Projection projection) {
  }
}

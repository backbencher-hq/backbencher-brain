// JAO1/JAO2 (two-corpus gate wave 2026-09): JLS 8.4.8 — the @Override
// annotation is a compile-time check, NOT a requirement. An un-annotated
// instance method whose signature matches an accessible ancestor method still
// overrides it (clojure/ASF java code omits @Override on most overrides).
// DerivedThing.total() must therefore produce a VERIFIED override edge.
// JAO2: same-name-different-signature is an OVERLOAD, never an override —
// DerivedThing.find(int, String) must NOT pair against BaseThing.find(int).
class BaseThing {
  public int total() {
    return 1;
  }

  public Object find(int i) {
    return null;
  }

  private Object secret() {
    return null;
  }
}

class DerivedThing extends BaseThing {
  // un-annotated override (JLS: still an override)
  public int total() {
    return 2;
  }

  // overload of BaseThing.find(int) — not an override
  public Object find(int i, String extra) {
    return null;
  }
}

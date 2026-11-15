package acme

class Outer {
  static class Criterion {}
  static class Projection {}
}

class Fields {
  Outer.Criterion field
  java.util.Map.Entry<String, Boolean> entries

  Outer.Criterion make(Outer.Criterion param) {
    Outer.Criterion local = null
    def coerced = local as Outer.Projection
    return local
  }
}

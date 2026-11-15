// CANONICAL `mixes_in` — the with-clause is its own relationship, not `uses{isMixin:true}`.
//
// WHY THIS FIXTURE EXISTS. Until 2026-10-18 a Dart class's `with A, B` clause published
// `uses` rows with an ad-hoc `isMixin: true` flag. `uses` is the label for every other type a
// file mentions, so "this class is composed from these mixins" was indistinguishable from "this
// file mentions this type" without reading a flag — and a consumer that does not read metadata
// (the store's resolver does not) could not tell the two apart at all. `mixes_in` is now a
// canonical stored value; this fixture pins the emission, the direction, and the three
// near-misses that must NOT be relabelled onto it.
//
// PROBED SHAPES (`validation/m14/fixtures/dart/pattern-probe` is unrelated; the grammar probe
// for heritage is `dart-mixin-shape.ts`, and the with-clause shapes below were read from the
// pinned tree-sitter-dart grammar):
//
//   class Single with M1 {}            (class_definition (identifier) (mixins (type_identifier)))
//   class Multi with M1, M2 {}         (mixins (type_identifier) (type_identifier))
//   class Applied = Base with M1, M2;  (mixin_application_class (mixin_application (type_identifier)
//                                       (mixins (type_identifier) (type_identifier))))
//   class Heritage extends Base with M1 implements Marker {}  (superclass > mixins)
//   mixin Constrained on Base implements Marker {}            (mixin_declaration direct type_identifier)
//
// WHAT MUST NEVER BE `mixes_in` (the three boundaries):
//   * the `extends` base — `Heritage extends Base` is inheritance, not composition;
//   * the `implements` list — an interface contract, not an applied mixin;
//   * a mixin's `on` constraint (`Constrained on Base`) — a REQUIREMENT about the host, which
//     publishes as `references` with `isMixinOn`, the clause it actually is.
mixin M1 {
  void m1() {}
}

mixin M2 {
  void m2() {}
}

class Base {
  void baseMethod() {}
}

class Marker {
  void markerMethod() {}
}

// THE ON-CONSTRAINT. `Base` here constrains what may mix `Constrained` in; it is neither a
// superclass nor an applied mixin.
mixin Constrained on Base implements Marker {
  void constrained() {}
}

class Single with M1 {}

class Multi with M1, M2 {}

// THE MIXIN APPLICATION CLASS: `= Base with M1, M2` parses with no `superclass` node at all —
// both the base and the mixins live inside `mixin_application` — so a reader that only walks
// `superclass`/`mixins` children of the class misses every edge here.
class Applied = Base with M1, M2;

class Heritage extends Base with M1 implements Marker {
  @override
  void markerMethod() {}
}

void useAll() {
  final s = Single();
  final m = Multi();
  final a = Applied();
  final h = Heritage();
  final c = Constrained();
  s.m1();
  m.m1();
  m.m2();
  a.m1();
  h.m1();
  c.constrained();
}

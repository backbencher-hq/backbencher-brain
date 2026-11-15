// DARTD6-DARTD10 regression fixture (m37 dart wave, 2026-09):
//  DARTD6  O(class)2 field-type parent scan (perf) — explicit-typed field
//          keeps its dataType metadata (parent-scan never returns a type, so
//          correctness pins guard the refactor; perf verified separately).
//  DARTD7  per-site duplicate rows: 2 const IconData fields + 2 IconData in
//          build() must dedup to ONE instantiates per source; make() called
//          twice must yield ONE calls edge.
//  DARTD8  local functions are NOT symbols and their calls fold into the
//          enclosing function (topFn -> helperCall, never from localHelper).
//  DARTD9  class-member initializers attribute to the OWNING CLASS
//          (IconSet -> IconData), never the module; only true top-level
//          initializers keep the module source (dedup-and-attribution ->
//          TopWidget).// DARTD10 top-level getters are symbols (activeKeys property); before the
//          fix their bare getter_signature fell through every dispatch branch
//          and vanished while its calls attributed to a non-declared source.
// Master-review wave 2 (2026-09-06) additions:
//  DARTD12 getter/setter PAIRS survive dedup (owner:name:kind key): Counter
//          keeps both `value` properties.
//  DARTD13 parameter types are extracted (no `type` field in tree-sitter-dart
//          formal_parameter — probed): `double total` payload type=double;
//          `P(this.name)` binds the field's type post-pass.
//  DARTD14 mixin on-clause heritage: `mixin Flow on Base implements Marker`
//          emits extends Flow->Base + implements Flow->Marker.
//  DARTD15 enhanced enum heritage: `enum Poly implements Shape` emits
//          implements Poly->Shape and overrides Poly.area->Shape.area.
//  DARTD16 cross-file @override: Banner.build extends StatelessWidget gives
//          overrides Banner.build->StatelessWidget.build (external base,
//          annotation-gated).
//  DARTD17 cascade chain leaf: `b..a.b.c(1)` calls c, not a.
import 'package:equatable/equatable.dart';

class IconData {
  final int code;
  const IconData(this.code, [String? family]);
}

class IconSet extends Equatable {
  const IconSet();

  static const IconData acorn = IconData(0xe900);
  static const IconData addressBook = IconData(0xe901);

  int build() {
    final a = IconData(0x1);
    final b = IconData(0x2);
    make();
    make();
    return a.code + b.code + value;
  }

  int get value => 3;
  int make() => 1;
}

class TopWidget {
  const TopWidget();
}

TopWidget topIcon = const TopWidget();

List<String> get activeKeys => const <String>['a', 'b'];

void topFn() {
  void localHelper() {
    helperCall();
  }
  localHelper();
}

void helperCall() {}

// --- DARTD12: getter/setter pair ---
class Counter {
  int _v = 0;
  int get value => _v;
  set value(int nv) => _v = nv;
}

// --- DARTD13: typed params + this-param field binding ---
class Pay {
  final String method;
  Pay(this.method, {double total = 0});
}

// --- DARTD14: mixin on-clause heritage ---
abstract class Base {}
class Marker {}
mixin Flow on Base implements Marker {}

// --- DARTD15: enhanced enum heritage + in-file interface override ---
abstract class Shape {
  double area();
}
enum Poly implements Shape {
  tri(3), quad(4);
  final int sides;
  const Poly(this.sides);
  @override
  double area() => sides * 1.0;
}

// --- DARTD16: cross-file external-base override (annotation-gated) ---
// `StatelessWidget` is deliberately NOT declared in this file. It is a Flutter
// class from another package, and the whole point of DARTD16 is that the base
// cannot be read here — so declaring a local stub would not test the pass, it
// would make the resolution an ordinary in-file one and the
// `isExternalBase` flag unreachable.
//
// Do not add a stub to make this "more realistic". It was here, it declared no
// members, and the analyzer was right to refuse the edge: `StatelessWidget` (this
// stub) demonstrably declares no `toString`, so
// `Banner.toString -> StatelessWidget.toString` asserted an override of a member
// the base does not have. The fixture was pinning a fabricated edge, and the
// annotation gate was what exposed it.
class Banner extends StatelessWidget {
  @override
  String toString() => 'Banner';
}

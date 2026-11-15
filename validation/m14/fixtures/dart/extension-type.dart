// fixture: dart/extension-type — DARTD21, the Dart 3 container the lane never saw.
//
// `extension type` was registered as MISSING in the lane's own completeness
// spec (script/m14/spec/dart-completeness.json: "Dart 3 extension type
// symbols", node_type "extension_type_declaration,
// representation_declaration") and recorded by the M60 shape census as
// UNSCANNED (validation/m60/results/unscanned-shapes.json: 169 occurrences).
//
// The #753 duplicate census over the FULL extent found it again, from a
// completely different direction: 132 of its 137 duplicate-name rows were the
// MEMBERS of extension types in dart-http's generated jni/objc bindings (303
// declarations across 4 pinned files) — because the analyzer had no case for
// the container, so every member was emitted as a TOP-LEVEL symbol with no
// owner, no `contains`, no heritage and no enclosing type for a call.
//
// Both halves are pinned here: the container symbol, the member ownership, the
// REPRESENTATION FIELD (`shape$`, a real member accessor of the type), and the
// `implements` clause written after the representation declaration. The
// representation field's own NAME is a declaration, never a read — the
// fabrication that fix had to remove (it published `uses Wrapper -> shape$` on
// the declaration's line).
abstract interface class Shape {
  double area();
}

extension type Wrapper._(Shape shape$) implements Shape {
  double area() => shape$.area();

  static bool isA(Object? other) => other is Wrapper;
}

extension type Plain(int count$) {
  int get doubled => count$ * 2;
}

// The WRAPPED representation declaration — the shape the pinned FFI bindings
// actually write (`extension type X._(\n  ffi.Pointer<…> _$this,\n) implements …`,
// 303 declarations over 4 files), and the one place this container's line
// attribution can go wrong: the declaration node STARTS on the container line
// while the field's NAME is written a line later. The lane's own consistency
// probe caught exactly that on the real corpus — its only inconsistent edge out
// of 32,989 (`UrlRequestCallbackProxy$…::_$this` claimed the container line) — so the
// wrapped shape is pinned in both directions below.
extension type Wrapped._(
  Shape inner$,
) implements Shape {
  double area() => inner$.area();
}

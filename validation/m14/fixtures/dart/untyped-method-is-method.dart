// DARTD22 — `tree-sitter-dart` has no node for a method declared WITHOUT a
// return type. `noRetType() { }` inside a class body parses as
//
//     method_signature > constructor_signature > identifier, formal_parameter_list
//
// which is structurally identical to a real constructor `Owner()`. Reading the
// node TYPE published every such method as a `constructor` symbol named
// `constructor`: the method's own name was never published, and N untyped
// methods in one class collapsed onto ONE published name. Measured over a
// 600-file stride sample of a 35,090-file corpus: 521 of 1,197
// constructor-shaped signatures (43.5%) were untyped methods, in 56 files.
//
// The discriminator is Dart's own naming rule — a constructor is named after its
// class, and the unnamed one is spelled `.new`; a MEMBER may not share its
// class's name. The wrapper node cannot decide it: the grammar also wraps real
// constructors in `method_signature` (559 of them in the sample).
//
// Each case below pins one side of that rule so a broader or narrower version
// cannot pass unnoticed.

// (A) A REAL constructor, written the ordinary way. Must survive as a
// constructor — the fix must not take the shape away from constructors.
class RealOwner {
  RealOwner();
  RealOwner.named(int a);
  factory RealOwner.redirect() = RealOwner.named;
  const RealOwner.constant();
  // (B) The unnamed constructor spelled `.new`. `new` is NOT the owner name and
  // a name-equality test alone would delete it. MEASURED: `new(...)` appears in
  // the corpus (e.g. `ServerSetClientCapabilitiesHandler.new(super.server, ...)`,
  // `SuggestionCollector.new({required this.maxSuggestions})`).
  new();
}

// (C) UNTYPED METHODS. No return type, so the grammar calls each a
// constructor_signature. Each must publish as a METHOD under its OWN name, and
// none may publish a `constructor` symbol — three untyped methods in one class
// is exactly the population that collapsed onto one name.
class Untyped {
  untypedMethod() { }
  untypedAsync() async { }
  untypedWithArgs(int a, {String? b}) { }
  // (D) A typed method in the same class, as the control: it was never
  // mispublished, so it must be unchanged. If it disappears, the fix is
  // swallowing real methods.
  void typedMethod() { }
  int typedWithReturn() => 1;
  // (E) A member whose name EQUALS nothing in particular, declared in a class
  // whose name is short enough that an off-by-one in the owner lookup would
  // collide. Pins that the rule reads the OWNER, not a prefix.
  static staticUntyped() { }
}

// (F) Two classes in one file, each with untyped methods of the SAME name. The
// owner path is what separates them; a name-only fix would merge them.
class First {
  sharedName() { }
}
class Second {
  sharedName() { }
}

// (G) The METHOD-NAMED-LIKE-THE-OWNER boundary, which Dart forbids: a member
// may not share its class's name. `G` declares a method named `G`, which is a
// compile error, so it cannot refute the rule — this case is here to pin that
// the fix does not crash and does not publish it as a constructor of itself.
// (The analyzer is a syntax reader, not a type checker; it must not claim
// either answer.)
class G {
  G() { }
}

// (H) An extension: `scopeOwnerName` resolves the extension's name, so an
// untyped method inside one takes the same path. Extensions declare no
// constructors, so every constructor-shaped signature in the body is a method.
extension Ext on int {
  untypedInExtension() { }
  typedInExtension() => 1;
}

// (I) A mixin: its name arrives as a direct `identifier` child, not a `name`
// field, so an owner lookup that reads only `childForFieldName("name")` sees
// no owner and routes the untyped method past the fix entirely.
mixin UntypedMixin {
  untypedInMixin() { }
  typedInMixin() => 1;
}

// (J) An enum with an untyped method in its body. Enhanced enums are
// class_definition-like for scoping purposes.
enum UntypedEnum {
  first,
  second;

  untypedInEnum() { }
  int typedInEnum() => 1;
}

// (K) A call INSIDE an untyped method. Before the fix the enclosing method was
// published as `constructor`, so a call from it had no method to attribute to.
// This is the case the fix exists for that is not a symbol-shape assertion.
class Caller {
  untypedCaller() {
    helper();
    other();
  }
  void typedCaller() {
    helper();
  }
  void helper() { }
  void other() { }
}
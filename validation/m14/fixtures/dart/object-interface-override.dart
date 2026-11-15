// The Object interface is the only override target a Dart analyzer can name
// without the base's own file. Every case here is one the corpus contains, in the
// shape the corpus writes it — not in the shape the rule talks about.
//
//   A. `class ProtocolException implements Exception` + `@override String
//      toString()` — Exception declares NO toString (verified against
//      dart-sdk/sdk/lib/core/exceptions.dart: 17 published symbols,
//      `Exception.toString` not among them). The edge must name `Object.toString`,
//      and must record the name the first-parent rule would have used.
//   B. `operator ==` — same rule, member spelled `operator ==`.
//   C. `hashCode` — a PROPERTY, not a method, and the rule is on the NAME.
//   D. A base that DOES declare the member, in-file. Nothing may be retargeted:
//      the base's own declaration is the nearest one and Pass 1 owns that case.
//   E. A base that does NOT declare the member, in-file. Pass 3's refutation
//      applies and there is no edge at all — this is what stops the retarget from
//      becoming a way to publish an override for everything.
//   F. A non-Object-interface member (`build`) still goes to the first heritage
//      parent untouched. The retarget is scoped to Object's five members and must
//      not spread.
//   G. `class Sub extends Object` naming `Object` itself is never retargeted.
class ProtocolException implements Exception {
  @override
  String toString() => 'protocol';
}

class ValueException implements Exception {
  final int code;
  ValueException(this.code);
  @override
  bool operator ==(Object other) =>
      other is ValueException && other.code == code;
  @override
  int get hashCode => code;
}

class PlainException implements Exception {
  @override
  String toString() => 'plain';
}

// D: the base declares it, so the base is the target and `Object` is not.
class Widget {
  void build() {}
}

class Banner extends Widget {
  @override
  void build() {}
}

// F: `build` is not one of Object's five, so the first heritage parent stands.
class Outer {
  void build() {}
}

class Inner extends Outer {
  @override
  void build() {}
}

class Direct extends Object {
  @override
  String toString() => 'direct';
}

// K: `extends Object with <mixin>` — the member is the MIXIN's and `Object` has never had it.
// `extends Object` is how a Dart file writes "no superclass", so naming `Object.length` asserts a
// declaration where none exists. The fallback skips `Object` and names the first REAL base.
// MEASURED over dart-sdk: 128 rows had this shape, every one `isExternalBase`, and every one was
// refuted on the one project whose checkout publishes `sdk/lib/core/object.dart`.
class LineStarts extends Object with ListMixin<int> {
  @override
  int get length => 0;
  @override
  int operator [](int index) => 0;
}

// L: `extends Object` and NOTHING ELSE. No base is left to name, so no edge is published: an
// out-of-file base may be guessed, but a base whose members are KNOWN and which does not declare
// this one may not. (`Object` declares exactly its five interface members.)
class PlainRoot extends Object {
  @override
  int get length => 0;
}

// M: `extends Object` where the only other heritage-shaped relationship is a type the file merely
// MENTIONS. A fall-through that walked every bare `uses` target would name `Widgetish.length` — a
// supertype this class does not have. Only `extends`/`implements`/`with` may be named.
class Widgetish {
  void build() {}
}

class MentionsOnly extends Object {
  void touch(Widgetish other) {}
  @override
  int get length => 0;
}

// N: TWO real bases, and the fall-through names the FIRST — in the file's own clause order, which
// is the order this pass already walks. A fall-through that took the list's END (`mixins.last`,
// a plausible off-by-one) would name `MixinB`, which the forbid below pins. Neither mixin is
// declared in this file, so the row is the 0.8 labelled guess with the bucket-3 reason.
class MultiMix extends Object with MixinA, MixinB {
  @override
  int get length => 0;
}

// E: the base is IN this file and does NOT declare the member, so the edge is
// REFUTED and no `overrides` row exists at all. Without this case the retarget
// would look like a way to publish an override for every `@override` in the
// corpus, which is the opposite of what it does.
class Ghost {}

class Haunted extends Ghost {
  @override
  String toString() => 'haunted';
}

// H: WHERE THE FIX STOPS. The first heritage parent is out of this file and the
// member is NOT one of Object's five, so there is no declaration the analyzer can
// name without the base's own file. The first-parent target is unverifiable, and
// the analyzer keeps it at 0.8 with `isExternalBase` rather than inventing one.
// This is the shape the fix deliberately does not touch, and it is the reason M2
// (retarget everything onto Object) has to be constructible to be catchable: with
// only Object-interface members in the file, M2 is a no-op and a no-op mutant
// passes everything.
class NeedsBuild extends UndeclaredBase {
  @override
  void build() {}
}

// I: a CALLEE can be a binding. freezed's generated `map`/`maybeMap` takes the
// mapping function as a formal parameter named `$default` and calls it, so
// `$default(_that)` is a real invocation whose target the family contract does not
// publish. The row must be TAGGED `isLocalRead` rather than silently looking like a
// call to a method nobody declared — 138 `calls -> $default` and 50
// `calls -> orElse` rows over 4,788 corpus files before the tag existed.
int freezedMap(int Function(int) $default, int value) => $default(value);

// J: the same expression against a DECLARED function is not a local read, and the
// tag must not appear — otherwise the label stops meaning anything.
int declaredFn(int v) => v * 2;

int callsBoth(int v) {
  final doubled = declaredFn(v);
  return freezedMap((x) => x + doubled, v);
}

// O: A CONSTRUCTOR IS NOT AN OVERRIDABLE MEMBER, and the override pass once published an edge
// that said it was. Every constructor symbol the analyzer emits is named `constructor`, so a
// subclass member carrying that name matched the base's constructor BY NAME and published
// `CtorSub.constructor -> CtorBase.constructor` at 0.95. Constructors are not inherited and
// cannot be overridden in Dart, and the overrides ORACLE has never carried them as members
// (`memberNamesOf` in script/m14/oracles/dart-overrides.ts handles `method_signature` and
// `declaration` nodes only). MEASURED on dart-sdk 2026-10-12: 2 rows,
// `pkg/compiler/lib/src/universe/recorded_use.dart`, refuted by the exposure watchdog.
class CtorBase {
  CtorBase();
}

class CtorSub extends CtorBase {
  final int constructor = 1;
}

// P: THE SAME NAME AS A REAL MEMBER IS STILL A MEMBER — the rule is on the constructor SYMBOL,
// not on the spelling. A base getter called `constructor` is overridable, and this row must stay
// or the gate would have traded a fabricated edge for a missing true one.
class GetterBase {
  int get constructor => 0;
}

class GetterSub extends GetterBase {
  @override
  int get constructor => 1;
}

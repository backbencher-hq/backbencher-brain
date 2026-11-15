// Every rule the `overrides` resolution turns on, in one file, each with a NEGATIVE
// twin. The negatives are the point: five of these rules were found by a corpus row
// disagreeing with an oracle, and not one of them had a fixture, so each could have
// been reverted by a later change and a green suite would have said nothing.
//
// The three that were wrong in the corpus, and what made each visible:
//
//   1. A STATIC method is not overridable. `static connect` on a subclass of a type
//      whose own `connect` is static produced an edge at 0.95 — the highest
//      confidence the pass uses — for a relationship that does not exist in Dart.
//      Measured on dart-http's `BrowserWebSocket.connect -> WebSocket.connect`.
//   2. An ANNOTATED FIELD overrides an inherited accessor. A field implicitly
//      provides a getter and a setter, so `@override String get walletId` over a
//      base field is real; `@override final String message` over an interface getter
//      is real. Both were invisible to the oracle, which only collected signature
//      wrappers.
//   3. A base field is a WITNESS for an accessor override but not for a method, and
//      the evidence that a member is overriding rather than sharing a name by
//      coincidence is `@override`. Unannotated, it is just a declaration.
//   4. `implements A, B` is BREADTH-first: a base the companion knows but that lacks
//      the member must not end the walk, or `B` is never considered. The oracle had a
//      `break` where it needed `continue`, which is a limit on DEPTH being read as a
//      limit on breadth. Measured on `SessionInfoHeader`, where `StatelessWidget` is
//      visited before `PreferredSizeWidget` and does not declare `preferredSize`.
//   5. A `with` clause lives INSIDE the `superclass` node beside `extends`, not
//      beside the declaration, so a class that extends AND mixes needs both.

// --- 1. static members are not overridable, in either position ---

/// `Widget`-shaped, deliberately with NO members: a subclass of this that declares
/// `build` is overriding something the base does not have, and the annotation-gated
/// first-parent fallback is the only thing that could claim it.
class PlainBase {
  const PlainBase();
}

class RealOverride extends PlainBase {
  @override
  String build() => 'real';
}

/// `HasStatic` declares a STATIC `connect`. A subclass declaring the same static
/// name shadows nothing: Dart resolves a static call against the static type it was
/// written on, and `@override` is not even legal on a static member.
class HasStatic {
  const HasStatic();
  static Future<HasStatic> connect(String url) async => HasStatic();
}

class StaticShadow extends HasStatic {
  // NOT annotated, because it cannot be: two statics, one name, no override.
  static Future<StaticShadow> connect(String url) async => StaticShadow();

  // An INSTANCE method of the same name is a different member entirely and must not
  // be confused with the static one above.
  @override
  String toString() => 'inst';
}

// --- 2 + 3. a field is a witness for an ACCESSOR, and only for an accessor ---

/// A concrete class whose `walletId` is a plain FIELD. In Dart that field provides a
/// getter, so the subclass accessor below genuinely overrides it.
class Wallet {
  final String walletId;
  const Wallet(this.walletId);
}

/// Overrides the base's FIELD with an explicit getter. The edge is real and must be
/// published.
class WalletView implements Wallet {
  @override
  String get walletId => 'view';
}

/// The same shape where the base member is an abstract GETTER rather than a field —
/// the `MusicControlError.message -> ConnectionErrorState.message` case, where the
/// annotated field is on the SUBCLASS and the getter is in an interface declared in
/// another file.
abstract interface class ErrorState {
  String get message;
}

final class PlainError implements ErrorState {
  @override
  final String message;
  const PlainError(this.message);
}

/// An UNANNOTATED instance field shadowing a base FIELD. I wrote this expecting it
/// NOT to be an override, on the reasoning that "a Dart field cannot be overridden by
/// another field". That reasoning is wrong for instance fields and right only for
/// STATIC ones: an instance field implicitly provides a getter, so it overrides an
/// inherited getter of the same name, and the compiler accepts it. The analyzer
/// publishes the edge and is correct to.
///
/// It is pinned here precisely because I got it wrong the first time. The case that
/// genuinely is not an override is at the top of this file: a STATIC method sharing a
/// name with a static method, where nothing is overridden because static calls
/// resolve against the static type they were written on.
class UnannotatedShadow extends Wallet {
  final String walletId = 'instance-field-overrides-inherited-getter';
}

// --- 4. breadth, not depth: a known base that lacks the member is not the end ---

/// Declares nothing, so the walk must move past it.
class AlsoPlain {
  const AlsoPlain();
}

/// Declares the member, so this is where the edge belongs even though `AlsoPlain`
/// is visited first.
interface class HasPreferredSize {
  int get preferredSize;
}

class BreadthFirst extends AlsoPlain implements HasPreferredSize {
  @override
  int get preferredSize => 72;
}

// --- 5. `extends` and `with` in one clause ---

class MixinBase {
  String describe() => 'base';
}

mixin Describe {
  String describe() => 'mixin';
}

class ExtendsAndWith extends MixinBase with Describe {
  @override
  String describe() => 'both';
}

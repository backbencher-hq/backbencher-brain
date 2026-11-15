// THE APPLIER — the class that applies BOTH mixins, and the class whose bases are all in one
// file so the FIRST-parent answer and the DECLARES-MEMBER answer can be told apart.
//
// Three cases, and each one is a DIFFERENT answer:
//
//   1. `onCheckForClose` / `onClosing` — declared by `ClosableMixin`, the SECOND mixin. The
//      first-parent fallback names `TerminatableMixin`, which does NOT declare them. The
//      correct base is `ClosableMixin`.
//
//   2. `onTerminated` — declared by `TerminatableMixin`, the FIRST mixin. Both rules agree, so
//      this row is the CONTROL: a fix that changed every row would change this one too, and the
//      expectation pins that it must NOT.
//
//   3. `ownHelper` — a member of NO base at all, with no `@override`. The rule must not fire on
//      it: an override edge is owed only for a member that replaces an inherited one.
//
// The `extends Object` is deliberate and measured: Dart's root class is implicit on every class,
// so naming it explicitly adds nothing, and the analyzer has a documented rule for skipping it.
library override_mixin_base_choice;

class StreamHandler extends Object with TerminatableMixin, ClosableMixin {
  @override
  void onCheckForClose() {
    // Overrides ClosableMixin.onCheckForClose — the SECOND mixin in the with-clause.
  }

  @override
  void onClosing() {
    // Overrides ClosableMixin.onClosing — the SECOND mixin in the with-clause.
  }

  @override
  void onTerminated(Object? error) {
    // Overrides TerminatableMixin.onTerminated — the FIRST mixin. Both rules agree here.
  }

  void ownHelper() {
    // NOT an override: no base declares it, and it carries no @override.
  }
}

/// THE NEGATIVE CASE — a class that applies ONE mixin, so the first-parent answer and the
/// declares-member answer are the same base. If the rule fired wrongly here it would still
/// produce a right-looking target, which is why the CONTROL row above exists.
class SingleMixinApplier extends Object with ClosableMixin {
  @override
  void onCheckForClose() {
    // Overrides ClosableMixin.onCheckForClose — the only mixin.
  }
}

/// THE DIRECTION-(b) CASE — the member is declared by NEITHER mixin.
///
/// `onUndeclared` is a method of THIS class and of no base. The first-parent fallback would name
/// `TerminatableMixin` — a base the project DOES publish, but which does not declare this member.
/// So the row must carry NO external claim: the project's own inventory answers the question, and
/// the answer is "this base does not expose that member".
///
/// This is the case that keeps the ARBITER honest. A row that named a project-declared base as
/// external would be REFUTED — the arbiter looks the owner up, finds it, and charges the lane. So
/// the only correct answer here is to publish NO base claim at all, and the class the member
/// belongs to (this one) is where the fact lives.
class NeitherMixinApplier extends Object with TerminatableMixin, ClosableMixin {
  @override
  void onUndeclared() {
    // Overrides NOTHING: no mixin declares `onUndeclared`.
  }
}

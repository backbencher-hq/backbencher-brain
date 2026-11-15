// MIXIN BASE CHOICE — the with-clause has more than one base, and "first" is not
// "the one that declares the member".
//
// THE SHAPE (the measured extFAIL on dart-http's `--index` arm):
//
//     class StreamHandler extends Object with TerminatableMixin, ClosableMixin {
//       @override void onCheckForClose() { … }        // declared by ClosableMixin
//       @override void onClosing() { … }              // declared by ClosableMixin
//       @override void onTerminated(Object? e) { … }  // declared by TerminatableMixin
//     }
//
// `onCheckForClose` and `onClosing` are declared by CLOSABLEMIXIN — the SECOND mixin in the
// with-clause. The analyzer's first-heritage fallback names the FIRST one, so it published
// `StreamHandler.onCheckForClose -> TerminatableMixin.onCheckForClose`: a base that does NOT
// declare the member, carrying the `isExternalBase` marker ("the project does not publish this
// base"). The arbiter refuted every such row — the project DOES publish `TerminatableMixin` — so
// the population's extFAIL column read 86 instead of 0.
//
// The sibling file `mixins.dart` declares both mixins, so the fix has cross-file evidence to
// work with: the project index says which mixin declares which member.
library override_mixin_base_choice;

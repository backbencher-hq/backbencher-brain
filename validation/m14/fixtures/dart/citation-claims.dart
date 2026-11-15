// NAMESPACE CITATION CLAIMS (task-26, charter §18.19) — the shapes the claim may and may not mark.
//
// The analyzer claims a PLATFORM name only when the row's target is bare and its spelling is an
// exact committed `DART_SDK_CORE` vocabulary entry, and only under `BB_DART_CITATION=1` (default
// OFF). The claim is `metadata.languageNamespace = [name]` + `languageNamespacePolicy: strict-absent`,
// which the arbiter verifies against the committed list ONLY where the run declares nothing for the
// target (a vendored same-name declaration falls through to the name model).
//
// This fixture is the DEFAULT-STATE pin (flag off): every listed name below carries no claim.
// `script/m14/dart-citation-fixtures.ts` is the flag-ON half of the same contract.
class Base {
  void hook() {}
}

// LISTED annotation (`override` is in the committed vocabulary): flag-on claim, flag-off unmarked.
class Listed extends Base {
  @override
  void hook() {}
}

// UNLISTED annotation: a project-declared annotation class is never claimed, even with the flag on
// (its name is not in the committed vocabulary; and a project declaration would fall through anyway).
class NotListed {
  const NotListed();
}

@NotListed()
void annotatedWithLocal() {}

// LISTED, capitalized TYPE-SHAPED name: flag-on claim (`Duration` is a dart:core type).
void listedTypeUse() {
  final d = Duration(seconds: 1);
  d.inSeconds;
}

// LISTED name in the vocabulary but LOWERCASE (`target` is a member/keyword-ish entry): the
// type-shaped claim is restricted to capitalized names, because a bare member read named `target`
// is not a dart:core symbol. This row must stay unmarked even with the flag on.
void lowercaseVocabMember(dynamic dyn) {
  dyn.target;
}

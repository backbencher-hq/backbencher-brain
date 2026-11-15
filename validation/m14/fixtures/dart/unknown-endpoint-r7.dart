// M60 RULE R7 — no relationship endpoint may be the placeholder literal `unknown`.
// Authored BEFORE the analyzer run.
//
// THE CORPUS SHAPE, reproduced here exactly.
//
// Measured over 1,000 files in 5 repositories: 19 published edges whose endpoint
// was the literal `unknown`, every one of them the same construction —
//
//   error ?? ApiError.unknown('Data transformation failed: $e')
//
// A selector chain reduces to its leaf. The leaf of a constructor call on a
// capitalized type is the named constructor's segment, and this segment is the
// word `unknown`. So `map calls unknown` was published: an edge to a symbol named
// `unknown` that no file in the sample contains (measured: 0 symbols named
// `unknown` in the same 1,000 files). That is R7's own case — a placeholder
// literal in a name-bearing field, which every consumer downstream can match,
// count and display, colliding with the pipeline's own "no target" sentinel.
//
// WHAT THE FIX DOES AND DOES NOT CLAIM.
//
// It does not rewrite the target. `map calls ApiError` would be a different and
// false claim: a call is not a call OF the type. It does not promote the target to
// `instantiates ApiError`, which is the shape DT-A trusts only for an IN-FILE
// named constructor — widening that to a cross-file guess would put edges in the
// graph that no oracle derives and nothing can check. The edge goes, which is what
// R7 prescribes: when a fallback has nothing truthful to say, the honest state is
// ABSENCE and not the string `unknown`.
//
// The two pins below are the difference between that and muting. The cross-file
// call publishes NOTHING; the in-file named constructor on the SAME shape still
// publishes `instantiates`, so the rule is read as a suppression of an
// unpublishable claim rather than as a blanket refusal to read named constructors.

class ApiError {
  final String message;

  const ApiError(this.message);

  // An IN-FILE named constructor. `ApiError.unknown(...)` below must still publish
  // `instantiates` to ApiError — the receiver, not the segment.
  const ApiError.unknown(String detail) : this('unknown: $detail');

  const ApiError.parsing(String detail) : this('parsing: $detail');
}

String describe(String raw) => raw.trim();

void load(String raw) {
  // THE CORPUS SHAPE. `RemoteFailure` is declared in another file, so there is no
  // in-file evidence that `.unknown` is a constructor segment — and without
  // evidence there is nothing truthful to publish.
  final failure = RemoteFailure.unknown('remote said no');
  print(failure);

  // THE CONTROL, in the same method: an ordinary call still publishes, so the
  // R7 filter cannot be passing because the method published nothing at all.
  print(describe(raw));

  // THE IN-FILE HALF: the same `X.unknown(...)` shape where `X` IS declared here,
  // so DT-A's named-constructor rule applies and the construction is published as
  // `instantiates` to the RECEIVER.
  final local = ApiError.unknown(raw);
  print(local.message);

  // AND A NAMED CONSTRUCTOR WHOSE SEGMENT IS NOT `unknown` on a cross-file type —
  // the general shape of the same defect, pinned so the fix cannot be a
  // one-word special case.
  final other = RemoteFailure.parsing(raw);
  print(other);
}

// DART `cast_pattern` — `X as T` INSIDE A PATTERN (Dart 3 pattern grammar).
//
// THE CONSTRUCT. Probed against the pinned grammar (`be07cf7`): a cast pattern is
// `cast_pattern → variable_pattern, as, type_identifier` — so the CAST TYPE is a `type_identifier`
// whose PARENT is `cast_pattern`, which is what makes it a type mention this lane can publish. It
// occurs in two positions, and the fixture carries both:
//   · a `switch_statement_case`      — `case final first as Payload:`
//   · an `if_case_clause` (`if (x case …)`) — `if (x case final second as Payload)`
//
// WHAT THIS LANE PUBLISHES, pinned by `cast-pattern.expectation.json`:
//   · the pattern BINDING is a `uses` row, binding-spelled `<callable>\u0000<binding>` with
//     `isLocalRead` + `localBinding` at 0.9 — a binding is NOT a gap (DARTGAP1 convention: `uses`
//     published, no symbol behind it, because a pattern binding behaves as a parameter does);
//   · the CAST TYPE is a `references{isTypeMention, typePosition:"cast_pattern"}` row at 0.95 —
//     published only when the name binds to a type THE RUN CAN SEE, which is why the fixture declares
//     `Payload` itself. (Casting to `num`/`String` in a fixture that does not declare `dart:core`
//     would publish nothing, and a fixture cannot tell an absent emission from a GATED one.)
//
// NOTHING ELSE IS CLAIMED. A cast pattern is not a declaration: it publishes no symbol and no
// `contains`, and the member read on the bound variable (`first.size`) stays `uses{isMemberRead}`
// with `receiverCause: receiverTypeUnknown`, because a pattern binding is not typed by this analyzer.
class Payload {
  final int size;
  const Payload(this.size);
}

class CastPatternProbe {
  void switchForm(Object x) {
    switch (x) {
      case final first as Payload:
        print(first.size);
    }
  }

  bool ifForm(Object x) {
    if (x case final second as Payload) {
      return second.size > 0;
    }
    return false;
  }
}

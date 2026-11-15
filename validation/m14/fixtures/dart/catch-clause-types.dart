// CATCH-CLAUSE RECEIVER TYPING — the exception type is WRITTEN in the clause, and the analyzer
// was dropping it.
//
// `on MyErr catch (e)` binds `e` with the type the `on` clause names. The analyzer collected the
// BINDING (`e` is in `locals`, so `print(e)` published the binding read) but not the TYPE, so
// `e.mark()` published a bare `calls -> mark` carrying `receiverCause: receiverTypeUnknown` — a
// leaf that names a method declared three lines above in the same file. That is a real missing
// resolution, not a convention: the type is written at the site, so the target can be spelled and
// the receiver contract can state the owner.
//
// This is the same evidence class as a declared local (`annotation`): the source WROTE the type.
// The UNTYPED catch below is the boundary — `catch (e)` writes no type, so the cut must stay and
// no owner may be invented.
//
// The two-parameter form (`catch (e, st)`) types BOTH names: Dart's own rule is that the second
// parameter is the stack trace OF THE SAME exception, so it carries the same type.

class MyErr {
  int code = 0;

  void mark() {}

  void record() {}
}

void typedCatch() {
  try {
    throw MyErr();
  } on MyErr catch (e) {
    e.mark();
    print(e.code);
  }
}

void typedCatchWithStack() {
  try {
    throw MyErr();
  } on MyErr catch (e, st) {
    e.record();
    print(st);
  }
}

void untypedCatch() {
  try {
    throw MyErr();
  } catch (e) {
    print(e);
  }
}

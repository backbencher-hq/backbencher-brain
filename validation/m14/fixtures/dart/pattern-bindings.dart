// DARTGAP1, THE MISSING HALF — a REST element binds its name, and the binding's reads were silent.
//
// The pattern-binding question itself was already answered by measurement (DARTGAP1's
// `measured_position`): a pattern-bound name behaves exactly as a parameter does — it goes in the
// `bound` set, its reads publish `uses` with the family's binding spelling
// `<callable><BINDING_SEP><binding>`, and no symbol is published for it. That is the convention,
// not a gap.
//
// WHAT *WAS* A REAL MISSING EDGE: `rest_pattern`. The grammar spells `...rest` as
//   (rest_pattern (constant_pattern (identifier)))
// (probed — pattern-forms-probe.ts prints the raw tree for `final [int f, ...rest] = ...`), and
// `collectDartLocals` never collected it: `variable_pattern` was handled, `rest_pattern` was not.
// So `rest` was not in `locals`, and every later read of it fell through every arm of the read
// pass and published NOTHING. That is a missing relationship, measured rather than argued, and it
// is why this fixture exists.
//
// The other two cases pin the convention the fix must NOT disturb: record-pattern bindings and
// object-pattern bindings already reach the `variable_pattern` branch and already read as
// bindings — a fix that started treating pattern identifiers as constant TESTS would fabricate
// reads of the names being bound (the forbids below).

void listRestBinding() {
  final [int first, ...rest] = <int>[1, 2, 3];
  print(first);
  print(rest.length);
}

void forInRecordPattern() {
  for (final (int p, int q) in <(int, int)>[]) {
    print(p + q);
  }
}

void objectPatternBinding(Object x) {
  if (x case String(length: final len)) {
    print(len);
  }
}

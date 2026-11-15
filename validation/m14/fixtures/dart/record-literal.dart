// DARTGAP4 — a record LITERAL is a VALUE, so the question "does it yield a symbol?" is settled
// by what a symbol IS in this lane, not by a missing extractor.
//
// A record literal `(1, 'two')` declares nothing: Dart records are structural, their fields are
// positions (`$1`, `$2`) or names (`count:`), and neither is a declaration a key space can hold.
// So the owed surface is NOT `contains` and NOT a symbol — it is the READS of the fields, which
// the member-read arm already publishes as ordinary member reads:
//
//   rec.$1        -> uses -> $1      (a capitalized/lowercase rule does not apply: `$1` is the
//                                     grammar's own positional spelling, identifier_dollar_escaped)
//   named.count   -> uses -> count
//
// The `receiverTypeUnknown` cut on those rows is CORRECT and is the point: a record literal's
// type is structural, so there is no owner TYPE NAME at the site to spell — unlike a field whose
// declared type is written in the class. The positional destructuring bindings below are ordinary
// bindings and read through the family spelling.
//
// MEASURED BEFORE THIS FIXTURE (script/m14/spec/dart-completeness.json, ProxiCall/lib, 1,294
// files): 249 `record_literal` nodes in 54 files. The decision below is stated over that measured
// population, not over the shapes this file happens to contain.

void recordReads() {
  final rec = (1, 'two');
  final named = (count: 3, label: 'x');
  print(rec.$1);
  print(rec.$2);
  print(named.count);
  print(named.label);
}

void recordDestructuring() {
  final rec = (1, 'two');
  final (int a, String b) = rec;
  print(a);
  print(b.length);
}

// DARTGAP2 — the CONSTANT A PATTERN TESTS is a read, and it was silent.
//
// `script/m14/spec/dart-completeness.json` DARTGAP2: the `qualified` constant pattern is CLOSED
// (commit 3d4d7fa4 — `case M.off:` publishes the member read). What remained is the BARE
// identifier constant and the null-check / null-assert / relational / collection forms. Each was
// silent for an ORDER-OF-ARMS reason, not a missing rule: a bare identifier falls through
// `isDeclaredMember` (a pattern test is not a member), `locals` (a constant pattern does not name
// a local — bindings parse as `variable_pattern`) and `topLevelValues` (only when the constant
// happens to be declared in THIS file), so `case importedConst:` published nothing at all while
// the same text in an expression position published `uses`.
//
// SHAPES, from the pinned grammar (probed by `pattern-forms-probe.ts` in this directory; the raw
// trees are quoted in the probe file):
//
//   case kOne:               (switch_statement_case (case_builtin) (constant_pattern (identifier)))
//   if (x case kOne)         (if_statement (identifier) (constant_pattern (identifier)))
//   if (x case kNested?)     (if_statement (identifier) (null_check_pattern (constant_pattern (identifier))))
//   if (x case kOne!)        (if_statement (identifier) (null_assert_pattern (constant_pattern (identifier))))
//   if (x case >= kOne)      (if_statement (identifier) (relational_operator) (identifier))   <- no wrapper node
//   case [kOne, 2]           (list_pattern (constant_pattern (identifier)) ...)
//   case {'a': kOne}         (map_pattern (string_literal) (constant_pattern (identifier)) ...)
//   case (kOne, 2)           (record_pattern (constant_pattern (identifier)) ...)
//
// WHAT MUST STAY SILENT (and is forbidden in the expectation): every BINDING the same patterns
// introduce — `int n`, `[int first, ...rest]`, `(int p, int q)`, `String(length: final len)`, the
// `_` wildcard, and `...tail` in a destructuring declaration (which parses as
// `(rest_pattern (constant_pattern (identifier)))` — the identifier is the BINDING). Reading any
// of them would fabricate a use of the name being bound.
//
// A LOCAL constant named by a pattern test (`if (x case local)`) is a read of a LOCAL — it takes
// the family's binding spelling `<callable><BINDING_SEP>local`, not a bare declaration name.

import 'imported_constants.dart';

const int kOne = 1;
const int kNested = 2;

enum Mode { off, on }

void switchBare(Object x) {
  switch (x) {
    case kOne:
      print(1);
    default:
      break;
  }
}

void switchLogicalOr(Object x) {
  switch (x) {
    case kOne || kNested:
      print(1);
    default:
      break;
  }
}

void ifBare(Object x) {
  if (x case kOne) print(1);
}

void ifNullCheck(Object x) {
  if (x case kNested?) print(1);
}

void ifNullAssert(Object x) {
  if (x case kOne!) print(1);
}

void ifRelational(Object x) {
  if (x case >= kOne) print(1);
}

void listPatternForm(Object x) {
  if (x case [kOne, 2]) print(1);
}

void mapPatternForm(Object x) {
  if (x case {'a': kOne, 'b': _}) print(1);
}

void recordPatternForm(Object x) {
  if (x case (kOne, 2)) print(1);
}

// THE ACTUAL GAP: a constant this file does NOT declare. Its read used to publish nothing, and
// the project's resolver is what decides whether the imported name has exactly one declaration.
void importedPattern(Object x) {
  if (x case kImported) print(1);
}

void bindingForms(Object x) {
  if (x case int n) print(n);
  if (x case [int first, ...rest]) print(first + rest.length);
  for (final (int p, int q) in <(int, int)>[]) print(p + q);
  if (x case String(length: final len)) print(len);
  final [int f, ...tail] = <int>[6, 7];
  print(f + tail.length);
}

void localConstPattern(Object x) {
  const local = 1;
  if (x case local) print(local);
}

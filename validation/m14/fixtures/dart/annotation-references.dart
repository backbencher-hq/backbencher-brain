// ANNOTATIONS ARE TYPE MENTIONS — the `references` edge the lane never published.
//
// Owner ruling 2026-10-18 ("complete surface"): `@override`, `@JsonKey(name: 'x')`,
// `@deprecated` name a DECLARED TYPE (dart:core's `override` getter-annotation class,
// package:json_annotation's `JsonKey`, ...), so the type-usage graph owes an edge to that type.
// Before this fixture the names reached `decorators`/`metadata.annotations` as PAYLOAD only and
// NOTHING in the relationship channel — the same defect the Java lane's
// validation/m14/fixtures/java/annotation-references records.
//
// THE SHAPES ARE PROBED, NOT ASSUMED (`annotation-shapes-probe.ts` in this directory, clean
// parse, raw trees printed there). Dart's grammar differs from Java's in the two ways that
// decide the emission:
//   * ONE node type — `annotation`. There is no `marker_annotation`; the difference between
//     `@override` and `@JsonKey(name: 'x')` is an `arguments` child, not a node type.
//   * the annotation's POSITION changes with the declaration kind: a CHILD of
//     `class_definition` / `enum_declaration` / `enum_constant` / `formal_parameter` /
//     `local_variable_declaration`, but a SIBLING of the declaration inside `class_body` and
//     `program`. A single "read the children of the declaration" rule therefore misses half
//     the positions, and a single "read the previous sibling" rule misses the other half.
//
// A TOP-LEVEL VALUE NAMED `deprecated` IS DECLARED HERE ON PURPOSE. It makes the
// "annotation names are not value reads" forbid FALSIFIABLE: without the gate, the identifier
// inside `@deprecated` would resolve against this file's top-level values and publish a `uses`
// row for the annotation's own name.
//
// TARGET SPELLING: `@prefix.Qualified()` (where `prefix` IS an import alias — declared above)
// publishes the LEAF `Qualified`, not the alias-qualified
// `prefix.Qualified`. Import aliases are stripped everywhere this lane spells a type
// (DT-B/DAD1/DAD2: `_i2.Mixin` is `Mixin`); Java keeps its package qualifier because a Java
// qualifier is a package, not an alias — the two conventions differ for a stated reason.

import 'dart:core' as core;
import 'package:meta/meta.dart' as prefix;

const int deprecated = 1;

@deprecated
class Annotated {}

@immutable
@pragma('vm:entry-point')
final class Multi {}

@prefix.Qualified()
class Prefixed {}

class Holder {
  @deprecated
  int field = 1;

  @JsonKey(name: 'renamed')
  final int first = 2, second = 3;

  @override
  String toString() => 'x';

  @Deprecated('gone')
  void method(@required int arg) {}

  @deprecated
  int get value => 4;

  @deprecated
  final inferredField = 7;

  @deprecated
  Holder();
}

enum Kind {
  @deprecated
  old,
  fresh,
}

@deprecated
int topVar = 5;

// The INFERRED forms: the annotation is a SIBLING of the declaration's modifier keywords
// (`@deprecated final x = 1;` parses as `annotation`, `final_builtin`, `static_final_declaration_list`
// — probed), so a carrier walk that stopped at the next sibling published nothing for them.
@deprecated
final inferredTop = 6;

@deprecated
const String typedTop = 'a';

@pragma('vm:entry-point')
void topFn() {}

void locals() {
  @deprecated
  final x = 1;
  print(x);
}

// ANNOTATED TYPEDEF: the grammar puts the annotation INSIDE the `type_alias` wrapper
// (`(type_alias (annotation …) (type_identifier F) (type_parameters …) …)`), a child position the
// carrier reader did not cover — the corpus gate caught the resulting MISSING row on
// generic_metadata_test.dart (`F -> A`).
@deprecated
typedef AnnotatedAlias = int;

// A TYPE-QUALIFIED annotation: `@ScopedCarrier.variant()` names the CLASS `ScopedCarrier` and
// selects a named constructor. The qualifier is NOT an import alias, so the target is the
// qualifier — taking the leaf would publish `variant`, a constructor name no type declaration
// answers (and on a file whose stem matched it, a self-reference row).
@ScopedCarrier.variant()
class UsesScopedAnnotation {}

// An ALIAS-qualified annotation: `core` is an import alias, so the type is the LEAF.
@core.deprecated
class AliasedAnnotation {}

void useAll() {
  final a = Annotated();
  final m = Multi();
  final p = Prefixed();
  final h = Holder();
  final u = UsesScopedAnnotation();
  final aa = AliasedAnnotation();
  final k = Kind.old;
  h.method(1);
  print([a, m, p, h, k, u, aa, topVar]);
  topFn();
}

// DARTGAP3, RULED — a `typedef` over a record type is a CONTAINER SYMBOL whose only named
// content is its field TYPES, and those already publish `references`.
//
// The gap asked for `contains` edges for a record type's fields (`typedef Pair = (int, String)`
// giving Pair -> fields). Measured against the construct rather than the metaphor:
//
//   * a record type's fields have NO DECLARATION NAMES — they are positions (`$1`, `$2`) or names
//     (`start:`) in the TYPE, exactly like a record literal's (DARTGAP4, ruled the same way). A
//     `contains` edge needs a member symbol on the target end, and there is none to publish.
//   * the typedef itself IS published (`Pair`, kind `type`), and the record's field TYPES are real
//     type mentions: `typedef Named = ({Point start, int count})` publishes `references Named ->
//     Point` through the `record_type_field` position table (this fixture pins it).
//   * the family precedent the gap cited (typescript-contains rule 5: a type alias over an object
//     literal is a CONTAINER) is about a language whose object types DECLARE named members. Dart's
//     `{int count}` is not a type at all; the record-type form is the one Dart has, and its field
//     names do not denote declarations.
//
// The earlier measured half stands: `record_type` type FIDELITY was fixed (27 return types and 1
// parameter regained their declared record type on ProxiCall/lib; 0 relationships changed). The
// point type mentions below are what remains owed, and they are emitted.
//
// Measured population for the gap's node types: 219 `record_type`/`record_type_field`/
// `record_type_named_field` occurrences in 38 files of ProxiCall/lib (this spec's own measurement).

class Point {
  const Point();

  Point copy() => this;
}

typedef Pair = (int, String);

typedef Named = ({Point start, int count});

void recordAliasUse() {
  final Pair pair = (1, 'x');
  final Named named = (start: Point(), count: 2);
  print(pair.$1);
  print(named.start);
}

// fixture: dart/ruled-out-decorates
// THE `decorates` RULING FIXTURE — dart has no APPLIED DECORATOR, only ANNOTATIONS, and the
// annotation is already published under the label it actually is.
//
// THE CONTRACT (`src/ast/types.ts:120-129`): *"A decorator is APPLIED TO a declaration: source =
// the decorating symbol, target = the decorated declaration."* … *"NOT `calls`: the decorated
// symbol does not invoke the decorator — the runtime applies it while the declaration is created …
// NOT `references`: a reference says the decorator's name is mentioned, which is true but says
// nothing about application; the point of the edge is what it was applied to."*
//
// THE QUESTION, AND IT IS A CORPUS QUESTION (not a zero-emission question): does the dart corpus
// contain a construct that APPLIES A CALLABLE TO A DECLARATION — a real decorator — or only
// annotations that MARK a declaration?
//
// THE MEASURED ANSWER (`script/m14/dart-extended-constructs.ts`, the `decorates` section of
// `validation/m14/measurements/dart-extended-constructs-2026-10-21.json`): over the whole admitted
// population the count of annotation sites whose OWN ARGUMENTS MENTION THE DECLARATION THEY MARK
// is ZERO. In python the decorator RECEIVES the declaration (`@deco` -> `deco(f)`), which is what
// makes it an applied callable; dart's `annotation` node has no field for that, so it CANNOT be one.
// ⇒⇒ `decorates` is RULED for dart, and the reason is the contract's own: a dart ANNOTATION ASSERTS
// PASSIVE METADATA, it does not apply a callable to the declaration.
//
// THE GRAMMAR HALF, MEASURED OVER BOTH BUILDS (the wired one and the newest available source):
// 0 of 219 named node types is a decorator-application type (`decorator`, `decorator_list`,
// `decorated_definition`, `decorated_class`, `decorated_function` are all ABSENT; the marker
// "decorat" matches 0 node types in either build). The only near-miss is `annotation`, which is
// exactly the node type this file exercises.
//
// THIS FIXTURE PINS BOTH DIRECTIONS:
//   POSITIVE — the annotation IS published, with the RIGHT label: `references{isAnnotation,
//              annotatedKind}` from the DECORATED DECLARATION to the ANNOTATION TYPE.
//   NEGATIVE — `decorates` is NOT emitted, even where an annotation is present, and not in the
//              opposite direction either. The negative half is the half a prose ruling cannot fake:
//              an analyzer that quietly started emitting `decorates` for every annotation would
//              pass every positive row in this file and fail these.
//
// THE THREE SHAPES, each named:
//   1. A BARE MARKER — `@override`. The language's own marker: passive metadata.
//   2. A MARKER WITH ARGUMENTS — `@Deprecated('use Other instead')`. A const constructor is
//      invoked, but the DECLARATION IS NOT AN ARGUMENT: nothing is applied TO the declaration.
//   3. A USER ANNOTATION — `@JsonKey(name: 'renamed')`. A configuration annotation, still passive.
//   And the DECOY: a NAME that merely looks like an applied callable — the dart analyzer's own
//   `uses`/`calls` rows for the annotation's identifier must not be turned into a `decorates` row.
//
// A dart annotation is NOT a python decorator: python's `@deco` REPLACES or WRAPS the declaration
// and the declaration is passed to it; dart's `@JsonKey(...)` is READ by a code generator or by the
// compiler, and the declaration is not an argument to anything.

import 'dart:convert';

@Deprecated('use Other instead')
class Annotated {
  @override
  String toString() => 'annotated';
}

@JsonKey(name: 'renamed')
class Configured {
  @JsonKey(name: 'field')
  final String field = 'x';
}

@pragma('vm:prefer-inline')
void topLevel() {
  print(jsonEncode({'a': 1}));
}

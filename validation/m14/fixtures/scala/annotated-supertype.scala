package fixtures.scala.annotated

// ★ AN ANNOTATED TYPE IS THE TYPE WITH AN ANNOTATION ON IT. The grammar's `annotated_type` node
//   holds the BASE TYPE and then the `annotation`, so the supertype a clause names is the BASE —
//   the annotation is a MODIFIER on the type, not the type.
//
//   Measured over the ADMITTED population (19,347 files, 4 repos) with the lane's own heritage
//   blind-spot probe: 35 `extends_clause` clauses name a REAL supertype only through an
//   `annotated_type` — 22 whose only direct named child is one, 13 with two — and every one of
//   them published NO EDGE before the analyzer read through the annotation.

class Marker

class Annotated extends AnyRef @Marker

class AnnotatedGeneric extends List[Int] @Marker

class AnnotatedWith extends Base @Marker with Other @Marker

class Plain extends Base

trait Base

trait Other

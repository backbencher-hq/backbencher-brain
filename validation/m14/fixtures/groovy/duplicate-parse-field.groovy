// fixture: groovy/duplicate-parse-field
// M59 (#825) follow-up, originally measured on grails-core Sphere.groovy,
// where javadoc-separated members misparsed: the constructor's node absorbed
// the preceding field, and `static Split valueOf` re-parsed its header prefix
// as a phantom field whose declarator was the return type — a duplicate parse
// of the method's own tokens (same line, trivia-only gap, no `;`), never
// emitted.
// #841 round 16 removed both misparses by penalising the grammar's TYPELESS
// field branch (prec.dynamic(-1)) — the absorb and the `def`-named-field split
// are the same ambiguity — so this fixture now pins the correct contract: both
// fields are real symbols, the constructor is a real `constructor_declaration`
// at its NAME's line (24, not 19), `valueOf` stays, no phantom field exists.
class Split {
  final Point center

  /**
   * The distance.
   */
  final Distance distance

  /**
   * Construct a split.
   */
  Split(Point center, Distance distance) {
    this.center = center
    this.distance = distance
  }

  /**
   * Factory.
   */
  static Split valueOf(List coords) {
    new Split(null, null)
  }
}

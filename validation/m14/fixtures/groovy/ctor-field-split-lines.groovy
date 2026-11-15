// fixture: groovy/ctor-field-split-lines
// M59 (#825) line contract, originally measured on grails-core Sphere.groovy /
// Distance.groovy, where tree-sitter-groovy absorbed a preceding field into a
// constructor's node: the field's TYPE stayed in a field_declaration while its
// NAME landed in the method_declaration as a return type, so the method node
// started at the FIELD's line. The contract pinned here survives the grammar
// fix — the constructor's symbol range and contains edge name the line its NAME
// is written on (19, not the field's 14).
// #841 round 16 removed that misparse by penalising the TYPELESS field branch
// (prec.dynamic(-1)) — the absorb and the `def`-named-field split are the same
// ambiguity. The swallowed field `distance` is now emitted, and the constructor
// is a real `constructor_declaration`, emitted with kind `constructor`.
class Split {
  final Distance distance

  /**
   * Construct a split for the given distance.
   */
  Split(Point center, Distance distance) {
    this.distance = distance
  }

  static Split valueOf(List coords) {
    new Split(null, null)
  }
}

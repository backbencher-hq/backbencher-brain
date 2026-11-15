// fixture: scala/declaration-lines-825
// M59 (#825): the line of a relationship is the line the NAME it names is
// written on — not the line of the construct that contains it. Three
// mechanisms, one contract, all three found by the M59 oracle measuring real
// scala3 sources:
//   1. a definition with a LEADING ANNOTATION — tree-sitter-scala starts the
//      definition node at the annotation, so `contains` landed on `@tailrec`
//      instead of on `def countdown`;
//   2. a MULTI-LINE INHERITANCE list — every parent after the first was stamped
//      with the line the `extends` clause opened on;
//   3. a MULTI-LINE TYPE expression — every referenced type was stamped with
//      the line the enclosing type expression opened on.
package lines

import scala.annotation.tailrec

trait Base {
  def value: Int
}

trait Mixin

trait Annotated extends Base {
  @tailrec
  def countdown(n: Int): Int =
    if (n <= 0) 0 else countdown(n - 1)

  @deprecated("old", "1.0")
  val legacy: Int = 1
}

class Long extends Base
  with Mixin
  with Product {
  def value: Int = 1
}

object Types {
  type Nested[T] =
    List[
      Option[T]
    ]
}

// Mechanism 4, the second half: a trailing COMMENT between the annotation and
// the declaration. Measured on cats-effect's QueueBenchmark.scala — there the
// `var_definition`'s named children are `annotation, comment, identifier, …`, so
// skipping only the annotation selected the trailing comment and put the symbol
// (and its contains edge) back on the annotation's line at the annotation's
// column. A comment is text about the declaration, never the declaration.
trait Commented extends Base {
  @deprecated("c", "1.0") // trailing comment on the annotation's line
  val withComment: Int = 2
}

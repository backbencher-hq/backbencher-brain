// M60/S6 (scala deep review) — a `given`'s name is its `name:` FIELD. An
// anonymous given has no name, and the defect read the given's BODY instead.

package p

trait Ord[A]

class Shown {
  def ShowAny: Ord[Any] = new Ord[Any] { def cmp(a: Any, b: Any) = 0 }

  // THE DEFECT: an anonymous given whose body is a bare identifier. The source
  // declares no name for the given, so none is published; the old read scanned
  // the node's direct children for the first identifier and took the BODY.
  given Show[String] = ShowAny
  given Show[Int] = ShowAny
  given Show[Char] = ShowAny

  // CONTROL: an anonymous given whose body is NOT an identifier was already
  // named `given_<n>` — the defect only fired on the identifier-body shape.
  given Ord[Long] = 2

  // CONTROL: a NAMED given reads the same field, and the field's node type
  // varies with the name — an identifier here, an operator_identifier below.
  given namedOrd: Ord[Float] = 3

  given + : Ord[Double] = 4
}

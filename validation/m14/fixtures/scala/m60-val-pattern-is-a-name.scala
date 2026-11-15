// M60/S12 (scala deep review) — a `val`'s PATTERN is a name only when it is a
// name. Four destructuring shapes published the pattern's source text as the
// symbol name; the analyzer's own tuple_pattern refusal (S1.19) covered only the
// fifth.

package p

class Node(val lhs: Any, val rhs: Any)
object RootPackageName
class K {
  // THE DEFECT, four shapes. None is spellable by a reference, so none can be
  // joined to anything; each is graph garbage wearing a name-shaped disguise.
  val State(queue, size) = node          // case_class_pattern
  val selfRef :: regularRef = ref        // infix_pattern
  val vdef @ Node(_, tpt) = tree         // capture_pattern
  val _ = anything                       // wildcard

  // CONTROL: the shapes that ARE names.
  val ok = 1                             // identifier
  val A, B = 2                           // identifiers — TWO declared names (#924)
  val Op: Int = 3                        // an operator-shaped NAME is still a name
}

object O {
  // The one shape the corpora actually reach at class/object level: a Scala 3
  // symbolic-value STRING pattern. Measured at semanticdb/Scala3.scala:187-188,
  // where the published symbol name was `s"${RootPackageName @ _}/"` — and
  // BEFORE this round the analyzer's own census of val patterns
  // (script/m14/tmp/scala-val-pattern-census.ts) had already refused only the
  // tuple shape of five.
  val s"${RootPackageName @ _}/" = root

  // CONTROL: a tuple destructuring, the shape S1.19 already refused.
  val (a, b) = pair
}

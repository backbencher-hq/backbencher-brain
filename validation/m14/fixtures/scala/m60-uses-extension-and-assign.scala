// M60 SDJ-1 + S9 + S10 (scala deep review) — the three `uses` rules that were
// each wrong in a different direction, and each wrong only on ONE corpus.

package p

trait VarState
class CaptureSet(val elems: List[String]) {
  // (SDJ-1) The extension receiver is a use WHATEVER encloses the extension.
  // The gate `extensionReceiverType && !isMethod` published it only when the
  // extension was nested inside a METHOD, so an extension block directly in a
  // class — the common shape — lost the edge. 382 of 648 defs in an extension
  // block on a 400-file scala3 draw. cats-effect has no extension at all.
  extension (self: CaptureSet)
    def union(that: CaptureSet): CaptureSet = self
  end extension

  // A def carrying MODIFIERS is the shape the ORACLE's own inverted gate fired
  // on (`/^\s*def\s/` is false for `private inline def`), so the two sides were
  // wrong on complementary subsets and agreed by accident only on a bare def
  // inside an extension nested in a type.
  extension (other: CaptureSet)
    private inline def same: Boolean = other eq self
  end extension

  // An extension nested inside a METHOD: the subset the analyzer's gate DID
  // publish, and the subset the oracle did not.
  def inner(s: CaptureSet): Int = {
    extension (b: Boolean) def toInt: Int = if b then 1 else 0
    toInt
  }

  // (S9) `++` and `--` are NOT assignment operators. Scala has no `++=`
  // operator that `++` could be; `a ++ b` concatenates and `a -- b` subtracts,
  // and both are READS. With `--` in the write gate this read was suppressed.
  def concat(that: CaptureSet): List[String] = this.elems ++ that.elems
  def subtract(that: CaptureSet): List[String] = this.elems -- that.elems

  // (S10) `++=` IS an assignment operator once it is user-defined — dotty
  // declares `def ++=` (MutableSet.scala:31) and uses it 105 times in 400
  // files. The analyzer's hand-list had removed `++=` on the claim that "no
  // legal parse produces them", which is false: a grammar lexes an
  // operator_identifier and has no table of legal Scala operators.
  // The receiver must be a FIELD (`state.accumulated`), not a bare identifier:
  // `accumulated ++= xs` parses with an `identifier` on the left, and the uses
  // collector only reads a `field_expression`, so the bare form would assert
  // nothing. dotty's own instance is `r.illegalAccessInstructions ++= ...`
  // (Inliner.scala:1170), which is a field_expression.
  var state: Accumulator = new Accumulator
  def accumulate(xs: List[String]): Unit = { state.accumulated ++= xs; () }

  // CONTROL: `===` ends in `=` and is a COMPARISON, not an assignment, so it
  // must not suppress a read.
  def same2(that: CaptureSet): Boolean = this eq that
}

class Accumulator { var accumulated: List[String] = Nil }

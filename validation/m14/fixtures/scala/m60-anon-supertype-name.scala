// M60/S3 (scala deep review) — an anonymous class is named by a STRUCTURAL walk
// of its supertype, and an unnameable supertype takes the canonical fallback.
// The defect published source text as a symbol name.

package p

trait Ord[A]

class Shapes {
  // CONTROL: a plain supertype still names.
  val plain = new Runnable { def run(): Unit = () }

  // CONTROL: a QUALIFIED supertype keeps every segment. `java.util.concurrent`
  // arrives as stable_identifier(stable_identifier(java, util), concurrent), so
  // a flat scan of the direct children published `anonymous_concurrent.Callable`.
  val qualified = new java.util.concurrent.Callable[String] { def call(): String = "" }

  // THE DEFECT: a natural-transformation supertype has no head type, so the old
  // text fallback published the symbol name `anonymous_(IO ~> F)`.
  val natural = new (Int ~> String) { def apply(a: Int): String = "" }

  // THE DEFECT, second shape: no supertype at all. The type node's first child is
  // the template_body, so the old fallback published the BODY as the name —
  // `anonymous_:\n      private var cur = ...`, a multiline symbol name, measured
  // in CheckCaptures.scala:77 and CapturedVars.scala:114.
  val bare = new { def z: Int = 1 }
}

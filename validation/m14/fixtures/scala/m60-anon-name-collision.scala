// M60: an anonymous class is named by a STRUCTURE of its supertype, and when a
// file declares more than one anonymous class of the SAME supertype the names are
// DISAMBIGUATED — `anonymous_Runnable`, `anonymous_Runnable#2`, `anonymous_Runnable#3`.
//
// The collision was measured on the full scala3 corpus: 3,330 anonymous symbols
// across 1,503 files, of which 402 files declared a DUPLICATE name (517 collisions).
// The cost was not cosmetic. `CheckCaptures.scala` declares four distinct
// `anonymous_TypeTraverser` classes (lines 161, 363, 384, 2308) and published all
// their members under ONE owner: 8 contains rows drawn from four different classes,
// seven of them attributed to the wrong one, with `traverse` appearing four times
// under the same owner and collapsing to one row after the harness's
// (label, target) dedupe. One graph node where the source has four.
//
// The FIRST occurrence keeps the bare name, so every pin on `anonymous_Runnable ->
// run` still holds. This file makes that contract explicit and checks the negative
// half too: a collision must not come back under the unsuffixed name.

package p

trait Runnable {
  def run(): Unit
}

class Site {
  // three anonymous classes of the SAME supertype, in one file, on purpose
  val a = new Runnable { def run(): Unit = () }
  val b = new Runnable { def extra: Int = 1 }
  val c = new Runnable { def other: String = "" }

  // a different supertype in the same file is NOT disambiguated against the first
  val d = new Other { def call(): Unit = () }
}

trait Other {
  def call(): Unit
}

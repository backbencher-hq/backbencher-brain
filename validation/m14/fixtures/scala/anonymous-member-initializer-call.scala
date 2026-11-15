// M59 (#855) scala fixture: a call made from an anonymous-class member
// INITIALISER.
//
// The sibling fixture `anonymous-body-scope` pins a call made from a *def*
// inside an anonymous body — `override def run(): Unit = Service.staticHelper()`
// — whose edge source is the def's own storeable symbol (`run`). That shape can
// never catch a lost attribution. Here the call sits in a `val` initialiser,
// where the analyzer's source is the ANONYMOUS TYPE ITSELF (anonymous_Runnable):
// the exact name the store's artifact filter refuses to persist
// (src/ast/analysis-exclusions.ts `/^(anonymous|anon|unnamed)[_-]/i`).
//
// Corpus instance: cats-effect kernel-testkit TimeT.scala line 148,
// `Kleisli.liftF(delegate.cancel)` inside `new Fiber[...] { val cancel = ... }`.
// The analyzer DID emit `calls anonymous_Fiber -> liftF @148`; the index stored
// it with a NULL source, so bb_graph answered 3 of that file's 4 real `liftF`
// call sites and #855 was mis-filed as an analyzer emission gap.
//
// The index-layer fix attributes such an edge to the innermost STOREABLE
// enclosing symbol (here: `build`) and keeps the synthetic name in
// metadata.syntheticSource. This fixture pins the ANALYZER half of the contract,
// which must keep emitting the edge from the anonymous symbol.

class Service {
  def target(): Int = 1

  def build(): Unit =
    new Runnable {
      val cancel =
        Service.this.target()

      def mirrored(): Int =
        Service.this.target()
    }
}

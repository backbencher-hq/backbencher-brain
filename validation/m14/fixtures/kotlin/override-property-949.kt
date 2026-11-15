// M14 ontology wave (DERIV_OVERRIDES): an `override val`/`override var` is an
// override in Kotlin exactly as an `override fun` is, and the whole class was
// invisible.
//
// MEASURED: 1,837 `override val`/`override var` declarations across 200 real
// corpus files, published as 0 edges. The override branch was gated on
// `kind === Method`, and the DIFFERENTIAL's own override truth derivation
// (`deriveTreeEdges`) indexes `function_declaration` members only — so the
// absence was invisible to the analyzer AND to the oracle, which is the exact
// structural blindness docs/analyzers/ONTOLOGY-WORKSTREAM.md was written about:
// both sides say nothing, and nothing agrees with nothing.
//
// What is pinned here:
//   1. VERIFIED TIER (0.9 / in-file-verified / structural) — the declaring
//      ancestor is in THIS file, so the BFS verifies it by the property's
//      DECLARED TYPE.
//   2. GUESS TIER (0.5 / first-supertype-guess / inferred) — the declaring
//      ancestor is IMPORTED, so nothing in this file declares it. This is 99.3%
//      of the class on the corpus (1,837 of 1,850 on a 120-file draw), so a
//      fixture that only pinned the verified tier would leave the common case
//      untested.
//   3. A LIMITATION, pinned rather than hidden: the property tier matches
//      declared types EXACTLY, so a legal covariant override (`Any` over `String`)
//      does not verify and stays at the guess tier. Kotlin permits the variance;
//      this analyzer's per-file index cannot see the base's declaration from the
//      derived type, and inventing a subtype test would be type inference this
//      lane has deleted twice.
//   4. `overrideMemberKind` in metadata, so a consumer can tell a property
//      override from a method one without re-deriving the symbol kind.
//   5. THE FORBIDS: a same-named property with NO `override` modifier must
//      publish nothing (it shadows, it does not override — the KDJ-1 fixture's
//      forbids for the method tier, restated for the property tier).

package p

import q.Remote

open class Base {
    open val label: String = ""
    open var count: Int = 0
    open val covariant: String = ""
}

class Verified : Base() {
    override val label: String = "a"
    override var count: Int = 1
    override val covariant: Any = 2
}

class Guesses : Remote {
    override val remote: String = ""
}

class Shadows : Base() {
    val label: String = "not an override"
}

val topLevel: String = ""

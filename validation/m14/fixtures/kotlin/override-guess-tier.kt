import java.util.concurrent.Callable

/**
 * K7 (M60 kotlin deep review): the THIRD override-resolution tier —
 * `first-supertype-guess` — which no kotlin fixture exercised.
 *
 * The kotlin resolver has three passes:
 *   1. IN-FILE BFS: the first ancestor in declaration order that DECLARED the
 *      method in THIS file, verified by signature (0.9, `in-file-verified`,
 *      evidence structural). Ancestors reached through generic supertypes fall
 *      back to name-only pairing.
 *   2. COMPANION INDEX: the same BFS reached through the companion's superTypes
 *      metadata (0.9, `companion-index`).
 *   3. NO VERIFIABLE IN-FILE DECLARER: the first supertype is named at
 *      confidence 0.5, `reasonCode: first-supertype-guess`, `evidenceClass:
 *      inferred` — because the declaring ancestor lives in another compilation
 *      unit and is therefore unknowable from this file alone.
 *
 * Pass 3 is reachable from a single-file fixture: the ancestor only has to be
 * ABSENT from this file, which an import arranges. So the gap was in the
 * fixture lane, not a property of the tier.
 *
 * Measured on Exposed (250-file draw, every edge checked against a repo-wide
 * index of types and their declared members built from all 791 .kt files):
 *
 *   guess tier    302 edges — 105 correct, 197 WRONG = 65.2%
 *   verified tier 103 edges — 103 correct, 0 wrong = 0.0%
 *
 * Kotlin's guess tier is more than twice java's measured 30.6%, and the two
 * numbers are not comparable without saying so: java's denominator excluded 33
 * unverifiable guesses whose owner was itself outside the repo, and this
 * measurement has no such bucket — every claimed parent resolved to a type in
 * the repo, and 0 of them were "not a type at all".
 *
 * The tier STAYS. It is right about a third of the time, so suppressing it
 * would delete 105 correct edges, and deleting a correct edge to avoid 197
 * wrong ones at a confidence the code already labels `inferred` is a worse
 * trade than publishing both honestly. What the measurement changes is the
 * JUSTIFICATION: the analyzer's argument that 0.5 sits below the consumer
 * threshold is not verifiable from this file — the 0.7 `confidenceThreshold` in
 * patterns.ts is the default for orphaned-pattern detection, not a filter on
 * the relationship ingest path — so the tier's defensibility rests on its
 * `reasonCode` and `evidenceClass`, not on a filter that might not exist.
 *
 * That is the argument for pinning `reasonCode` below rather than leaving it
 * implied: a consumer must be able to tell a guess from a verified edge without
 * hard-coding 0.5 as a magic number.
 */

/** Pass 3, POSITIVE. `Callable` is imported, so nothing in this file declares
 *  `call` and the guess tier names the first supertype at 0.5. */
class GuessesCallable : Callable<String> {
    override fun call(): String = "guessed"
}

/** Pass 3, NEGATIVE, and this is the load-bearing half.
 *
 *  Without the `override` modifier the tier is withheld — and the gate for
 *  emitting any override edge at all is
 *  `kind === Method && ownerName && !isPhantom && modifiers.includes("override")`.
 *  A same-named method with no modifier must produce NOTHING, because guessing
 *  an override where the source only declares an overload fabricates
 *  inheritance that does not exist. (java closed the same shape as a two-corpus
 *  finding: guessing an `int`-arity method against a base that declares only a
 *  `long`-arity one produces an override that is really an overload.) */
class AlsoCallable : Callable<String> {
    fun call(): String = "not an override"
}

/** Pass 1, POSITIVE: the supertype is declared IN THIS FILE, so the BFS
 *  verifies the declarer and the edge rises to 0.9 — no guess. */
open class DeclaredHere {
    open fun handle(): Int = 0
}

class VerifiesInFile : DeclaredHere() {
    override fun handle(): Int = 1
}

/** Pass 1, NEGATIVE: same in-file supertype, but the method is not an override,
 *  so no edge of either tier may be published. */
class NoOverrideModifier : DeclaredHere() {
    fun handle(): Int = 2
}

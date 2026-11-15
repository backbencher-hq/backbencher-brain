import io.micronaut.core.order.Ordered;

/**
 * Pins the THIRD override-resolution tier — `first-parent-guess`.
 *
 * Pass 1 resolves an override by exact signature against an ancestor DECLARED IN
 * THIS FILE (confidence 1.0, `exact-in-file`); pass 2 handles generic
 * substitution (0.9). Pass 3 fires when neither applies: the declaring ancestor
 * lives in another compilation unit, so from this file alone it is unknowable,
 * and the analyzer names the first hierarchy parent at confidence 0.5.
 *
 * Nothing exercised this tier. It is reachable from a single-file fixture — the
 * ancestor only has to be absent from THIS file — so the absence was a gap in
 * the fixture lane, not a property of the tier. That matters more than usual
 * here, because the tier is right about two thirds of the time and the code does
 * not know it: the justification in the analyzer is that `@Override` asserts
 * intent, which is true but was never measured.
 *
 * Measured on grails-core (60-file draw, verified against a repo-wide index of
 * 2,157 type declarations built from 1,942 files): 82 guess edges —
 *   34 correct (the guessed owner DOES declare the method)
 *   15 wrong    (it does not — typically an external interface does)
 *   33 unverifiable (the owner is itself outside the repo)
 * i.e. 30.6% of the VERIFIABLE guesses name a method their target does not
 * declare. The tier is correctly below the 0.7 fabrication threshold, so those
 * are declared suspicion rather than counted relationships — and the reason
 * `reasonCode` must stay on every one of them.
 */
class OverrideGuessTier implements Ordered {
    // Pass 3: `Ordered` is imported, not declared here, so nothing in this file
    // declares `getOrder` and the guess tier names the first hierarchy parent.
    @Override
    public int getOrder() {
        return 0;
    }

    // NEGATIVE, and this is the load-bearing half. Without `@Override` the guess
    // tier is withheld: guessing an override for `compare(int)` against a base
    // that declares only `compare(int, Object)` would fabricate an override that
    // is really an OVERLOAD — a two-corpus finding (2026-09). So a same-shape
    // method with no annotation must produce NOTHING.
    public int getOrder(int other) {
        return other;
    }
}

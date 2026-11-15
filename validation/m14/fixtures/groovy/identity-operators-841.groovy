// #841 round 7 — Groovy 3 IDENTITY operators.
//
// `a === b` / `a !== b` are identity (same-instance) comparisons, distinct from
// `==`/`!=`. The grammar had no production for either, so a file using one lost
// the enclosing class to recovery. Legality is not assumed here: the two corpus
// files that use them (ColumnConfigSpec.groovy,
// HibernateConnectionSourceSettingsSpec.groovy) are in the parse oracle's
// ACCEPTED set — real Groovy 3.0.24 parses them, we did not.
class IdentityOperators841 {

    boolean isSame(left, right) {
        return left === right
    }

    boolean isDifferent(left, right) {
        return left !== right
    }
}

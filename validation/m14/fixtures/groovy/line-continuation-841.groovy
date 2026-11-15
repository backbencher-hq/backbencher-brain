// #841 round 11 — the BACKSLASH LINE CONTINUATION.
//
// Groovy treats a trailing `\` before a newline as if the newline were not
// there. The grammar had no token for it, so the backslash was an ERROR and
// recovery took the enclosing class with it. MongoClientOptionsBuilder.groovy
// carries an even stranger instance — a LONE backslash on its own line between
// two statements (line 89) — which the real compiler also accepts.
//
// Both forms are pinned below. The surrounding lines matter: the whole point is
// that the class survives, which a `contains` assertion would not detect.
class LineContinuation841 {

    def continued(a, b) {
        def total = a + \
            b
        return total
    }

    def loneBackslash() {
        def first = 1
\
        def second = 2
        return second
    }
}

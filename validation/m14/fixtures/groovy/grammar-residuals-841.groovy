// fixture: groovy/grammar-residuals-841
// #841: every statement below was an ERROR/MISSING region before the grammar
// round; the analyzer only sees it when the parse is clean.
class RetrySpec {
    def limiter = 3
}

def deployAll(targets) {
    def seen = [:]
    for (def t : targets) { seen[t] = true }
    def pattern = /deploy.*/
    deploy(*: seen)
    try { attempt(seen) } catch (e) { log(e) }
    return seen
}

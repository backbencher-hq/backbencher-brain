// Is `assert cond, 'message'` valid Groovy, or is the grammar right to reject it?
// Run under a real Groovy toolchain: a syntax error here means the tree-sitter
// rule (colon-only) is CORRECT and those 34 files are genuinely unparseable.
def results = [:]

try {
    def x = [1]
    assert x, 'plain message'
    results['comma with a single-quoted message'] = 'PARSED AND RAN (assert held)'
} catch (Throwable t) {
    results['comma with a single-quoted message'] = "${t.getClass().simpleName}: ${t.message?.take(90)}"
}

try {
    def x = [1]
    assert x : 'plain message'
    results['colon with a single-quoted message'] = 'PARSED AND RAN (assert held)'
} catch (Throwable t) {
    results['colon with a single-quoted message'] = "${t.getClass().simpleName}: ${t.message?.take(90)}"
}

try {
    def mimeCapable = [1]
    def multipart = [2]
    assert multipart, 'message is not marked as "multipart"; use "multipart true" as the first line in your builder DSL'
    results['the real file line, verbatim'] = 'PARSED AND RAN (assert held)'
} catch (Throwable t) {
    results['the real file line, verbatim'] = "${t.getClass().simpleName}: ${t.message?.take(90)}"
}

try {
    def x = null
    assert x, 'a failing assert with a message'
    results['comma form actually FAILING at runtime'] = 'no throw'
} catch (Throwable t) {
    results['comma form actually FAILING at runtime'] = "${t.getClass().simpleName}: ${t.message?.take(90)}"
}

results.each { k, v -> println(String.format("%-46s %s", k, v)) }

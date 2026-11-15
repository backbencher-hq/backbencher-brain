// #841 round 14 — typed closure parameters in a HEALTHY class (no degradation).
//
// Nothing about this file's structure is unusual: one class, two methods, a
// typed closure parameter list in each. The parser folds `{ Test left,
// Test right -> ... }` into a juxtaposed call (`Test left, Test right`) plus a
// lambda, and before round 14 the juxt branch emitted a FABRICATED `calls` edge
// naming the parameter TYPE at every such site — measured corpus-wide at 962
// sites across grails-core and geb, 613 of them carrying an edge, none
// explained by anything but the misparse (reviews/m59-841-assert-comma-
// separator.md §7r). Real Groovy 3.0.24 ACCEPTS this source.
//
// The closure BODIES must keep extracting: `left.name <=> right.name` and the
// `register(key, value)` call are real, and the fix may not cost them.
class TypedClosureParams841 {
    List<String> sortByName(List<Test> names) {
        names.toList().sort { Test left, Test right ->
            left.name <=> right.name
        }
    }

    void inspectEach(Map<String, Object> items) {
        items.each { String key, Object value ->
            register(key, value)
        }
    }

    void register(String key, Object value) {
    }
}

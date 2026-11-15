// M60 groovy lane (2026-09-25): the Java-style (arrow) lambda. This is the one
// source form that produces the grammar's `lambda_expression` node — every BRACE
// form is a `closure` — and it is real, mainstream code: the shape census over
// the two pinned corpora (script/m14/tmp/gr-lambda-census.ts) finds 60
// occurrences in 26 files, with the node's parent being a variable_declarator
// (26), an argument_list (20), an expression_statement (8), a range_expression
// (3), a closure (2) or a return_statement (1). Sites in grails-core look like
// `.filter(s -> !s.isEmpty())` (build.gradle), `map.forEach((K key, V value) ->
// { … })` (AbstractPromiseFactory) and `context.registerBean(…, () ->
// userCacheManager)` (a Spring spec).
//
// The lane's M14.0.F6 cell read `uncovered: [lambda_expression]`: the analyzer
// branches on the node in two places (the binding walk's scope boundary and the
// typed-closure-misparse discriminator) and NO committed fixture's parse
// contained it. The cases below are the corpus's own shapes, so the node is
// covered by a contract — a lambda is an EXPRESSION: no symbol of its own, its
// parameters are not project symbols, and the calls in its body attribute to the
// lexically enclosing declaration.

class LambdaHolder {
    int target() { return 1 }

    void run() {
        def doubler = (int x) -> x * 2
        def label = (String s) -> s.toUpperCase()
        def supplier = () -> target()
        def filtered = java.util.Optional.ofNullable('x').filter(s -> !s.isEmpty())
        println doubler(target())
        println label('a')
        println supplier()
        assert filtered != null
    }
}

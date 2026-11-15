// #841 round-3 grammar residuals: method refs, interaction DSL, continuations.
// Every construct here failed to parse before this round (census-verified in
// grails-core) and is pinned at the analyzer level: calls visible, attribution
// correct.
class R3Svc {
    Cfg cfg

    // .& method reference (V1): first-class closure value
    def refer() {
        registry.eachEntry(this.&validate)
    }

    // interaction DSL: slashy regex callee + >> closure (V2)
    def interact(log) {
        log./print.*/(* _) >> { def args -> acc += args.join('') }
    }

    // leading-dot chain + elvis continuation (V4): statement-level split is the
    // documented tradeoff; both segments must emit
    def fetch(env) {
        return env
          .getProperty("profiles", List) ?: []
    }

    // operator-first continuation (V5)
    def check(target) {
        return target.valid
          && ClassUtils.isPresent(target.loader)
    }

    // GString call name (V8a): dynamic dispatch by name
    def dispatch(entry) {
        delegate."$entry.key"(entry.value)
    }

    // zero-arg arrow closure (V7)
    def handler() {
        return { -> }
    }

    // exclusive range (V14)
    def window(seq, i, degree) {
        List gram = seq[i..<(i + degree)]
        return gram
    }

    // primitive type as value (V11): token-level superset
    def kind(t) {
        if (t == boolean || t == int) return "primitive"
        return "boxed"
    }

    // bare assert as closure tail (V12)
    def verify(cache) {
        'groovy'.each { assert cache.get(it) }
    }
}

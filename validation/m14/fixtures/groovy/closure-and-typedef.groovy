package com.acme.pipeline

class Transformer {
    Closure strategy = { it * 2 }

    def apply(List<Integer> values) {
        return values.collect(strategy)
    }
}

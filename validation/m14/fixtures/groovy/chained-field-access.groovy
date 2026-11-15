package com.acme.pipeline

class Reporter {
    def render() {
        def out = config.output().format().name()
        return out
    }
}

class A {
    String label

    void sameLineRead() {
        def m = this.label
        consume(m)
    }

    void continuedRead() {
        def m = this
                .label
        consume(m)
    }

    void continuedCall() {
        def m = helper
                .build(1)
        consume(m)
    }

    void sameLineChain() {
        helper.build(2).configure(3)
    }

    void continuedChain() {
        helper.build(1)
        helper.build(2)
                .configure(3)
    }
}

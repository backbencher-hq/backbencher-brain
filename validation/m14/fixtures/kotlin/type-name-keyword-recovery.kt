package com.acme.markup

// IntelliJ context-parameter markup breaks this header; the recovery hands the
// keyword to the analyzer where the name belongs. Corpus origin:
// analysis/low-level-api-fir/testData/lazyResolve/errors/
// constructorDuplicatedContextParameter.kt — over all 2,033 tracked .kt/.kts
// using this construct the pre-fix analyzer published 2 classes named after the
// keyword, for files that declare Foo.
class Foo {
    context(c<caret>: Int)
    context(c: String)
    constructor()
}

// The control: `constructor` is a soft keyword, so a function may carry it.
// Corpus: compiler/psi/psi-impl/testData/psi/secondaryConstructors/basic.kt.
class Keeper {
    fun constructor() {}
}

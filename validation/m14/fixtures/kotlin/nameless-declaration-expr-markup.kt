package com.acme.markup

/**
 * The same recovery through `<expr>…</expr>`, which swallows a FUNCTION's name.
 * Corpus origin: kotlin/analysis/low-level-api-fir/testData/inBlockModification/
 * memberPropertyWithTypeInDelegateScript.kts — a `.kts`, and the shape does not
 * depend on the script dialect, only on the markup (the fixture lane registers
 * `.kt` for this language, so the same construct is written as source here).
 *
 * Measured on that file: one empty-named function symbol owned by `A`, and three
 * `references` edges whose source was the empty string — every one of them an
 * edge that asserted a relationship and identified no participant.
 */
class A {
    val x: Int by lazy {
        fun <expr>doSmth</expr>(i: String) = i.length
        doSmth("str")
    }

    fun named(): Int = 1
}

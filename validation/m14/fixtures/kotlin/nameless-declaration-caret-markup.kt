package com.acme.markup

/**
 * IntelliJ test-data markup: `<caret>` marks where the editor's caret sits. The
 * pinned tree-sitter-kotlin wasm recovers by making the class NAME a zero-length
 * `simple_identifier`, so `Child` has no name node to read. This is the shape of
 * a real corpus file —
 * kotlin/analysis/analysis-api/testData/components/relationProvider/
 *   implementationState/ambiguouslyInheritedGeneric.kt
 * — where the census measured one empty-named symbol and, through it, two
 * `implements` edges whose SOURCE was the empty string.
 */
interface A<T> {
    fun foo(): T
}

abstract class <caret>Child : A<String>()

class Recovered : A<String>()

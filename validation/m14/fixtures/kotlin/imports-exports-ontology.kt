package com.acme.surface

import java.util.List
import kotlinx.coroutines.flow.*

class Surface(val items: List<String>) {
    fun first(): String? = items.firstOrNull()

    internal fun hidden(): Int = items.size

    private fun secret(): Int = 7

    fun localShape() {
        class Scratch(val a: Int)
        fun helper() = Scratch(1).a
        val value = helper()
        check(value == 1)
    }
}

fun topLevelApi(): Int = 42

internal fun moduleOnly(): Int = 1

private fun filePrivate(): Int = 2
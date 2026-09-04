// PINS the kotlin wave fixture pack (M29.R2 wave 1, owner-approved set).
package dev.backbencher.wavetest

class Greeter(private val items: List<String>) {
    fun greet(): String = "hello ${items.size}"
}

fun main() {
    val g = Greeter(listOf("a", "b"))
    println(g.greet())
}

const val CONSTANT = 42

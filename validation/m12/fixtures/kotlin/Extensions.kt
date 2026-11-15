package com.example.extensions

import com.example.models.User
import com.example.models.BaseService

/**
 * Extension functions, operator overloads, top-level declarations, and
 * collection/stream-style calls.
 */

@field:JvmField
val DEFAULT_SCALE: Int = 5

fun String.shout(times: Int): String {
    return this.repeat(times).uppercase()
}

operator fun User.plus(other: User): User = User(id, name + other.name)

fun describe(value: User?): String {
    return when (value) {
        null -> "none"
        else -> "user:${value.id}"
    }
}

fun buildUsers(): List<User> {
    val users = mutableListOf<User>()
    val first = User("a", "alpha")
    users.add(first)
    users.add(User("b", "beta"))
    return users
        .filter { it.name.startsWith("a") }
        .map { User(it.id, it.name.uppercase()) }
}

fun main() {
    val s = "hi".shout(2)
    val u = User("x", "y")
    val v = u + u
    val d = describe(null)
    println(s)
    println(v.id)
    println(d)
}

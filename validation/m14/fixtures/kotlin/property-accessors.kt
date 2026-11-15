package com.acme.core

class PropMeta {
    var counter = 0

    val x: Int
        get() = 1
        set(value) { field = value }

    val lazyv by lazy { 1 }

    val plain = compute()

    val slogan = "powered by Acme"

    fun compute(): Int = 7
}

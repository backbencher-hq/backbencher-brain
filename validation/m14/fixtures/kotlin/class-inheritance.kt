package com.acme.core

open class Base {
    fun baseFun() {}
}

interface Repo {
    fun find(id: String): String?
}

class Impl : Base(), Repo {
    override fun find(id: String): String? = null
}

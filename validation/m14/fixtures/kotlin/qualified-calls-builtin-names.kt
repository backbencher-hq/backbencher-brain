package com.acme.core

class Repo {
    fun work() {
        val u = getUserById(5)
        runMigration()
        putUserData(u)
        mapInto(u)
        listOf("a")
    }
    fun getUserById(id: Int): String = ""
    fun runMigration(): Boolean = true
    fun putUserData(d: String) {}
    fun mapInto(d: String): Int = 1
}

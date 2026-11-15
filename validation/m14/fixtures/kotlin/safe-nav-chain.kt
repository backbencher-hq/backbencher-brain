package com.acme.core

class Guard {
    lateinit var user: User
    fun probe(): String? {
        return user.account?.owner?.label
    }
}
class User {
    val account: Account? = null
}
class Account {
    val owner: Owner? = null
}
class Owner {
    val label: String = ""
}

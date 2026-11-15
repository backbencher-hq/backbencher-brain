package com.example.service

import com.example.models.Repository
import com.example.models.User
import com.example.base.BaseService

class UserService(store: MutableMap<String, User>) : BaseService<User>(), Repository<User> {
    private val _store: MutableMap<String, User> = store

    override fun format(value: String): String = "${super.prefix}:$value"

    override suspend fun save(value: User): User {
        _store[value.id] = value
        return value
    }

    fun find(id: String): User? = _store[id]
}

fun createService(): UserService {
    val store = mutableMapOf<String, User>()
    return UserService(store)
}

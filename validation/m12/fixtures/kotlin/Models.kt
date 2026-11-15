package com.example.models

import com.example.base.BaseService

data class User(val id: String, val name: String)

interface Repository<T> {
    suspend fun save(value: T): T
}

abstract class BaseService<T : BaseService.Entity> {
    protected var prefix: String = "base"
    abstract fun format(value: String): String

    interface Entity {
        val id: String
        val name: String
    }

    companion object {
        const val VERSION = 1
    }
}

sealed class Result<out T> {
    data class Success<out T>(val value: T) : Result<T>()
    data class Failure(val error: Throwable) : Result<Nothing>()
    object Loading : Result<Nothing>()
}

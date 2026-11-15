package com.acme.core

enum class Mode {
    ON, OFF
}

sealed class Result {
    object Success : Result()
    data class Error(val message: String) : Result()
}

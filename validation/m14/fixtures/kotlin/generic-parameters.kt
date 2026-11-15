package com.acme.core

class Box<T>(val item: T) {
    fun <U> identity(x: U): U = x
}

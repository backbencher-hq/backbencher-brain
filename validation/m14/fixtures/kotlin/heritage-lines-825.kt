package com.acme.core

open class Base(par: Int)

interface Marker

interface Second

class Wrapped(
    val x: Int,
) :
    Base(x), Marker, Second {
    fun use() = x
}

class Inline : Base(1), Marker {
    fun use() = 1
}

interface Third :
    Marker, Second

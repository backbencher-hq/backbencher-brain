package com.acme.core

interface Readable {
    fun read(): String
}
interface Writable {
    fun write(s: String)
}
interface Channel : Readable, Writable {
}

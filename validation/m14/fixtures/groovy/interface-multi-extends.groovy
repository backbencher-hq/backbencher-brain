package com.acme.pipeline

interface Readable {
    String read()
}
interface Writable {
    void write(String s)
}
interface Channel extends Readable, Writable {
}

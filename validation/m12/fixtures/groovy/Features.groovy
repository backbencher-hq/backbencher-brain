package com.example.features

import java.util.List

enum Color {
    RED(0xff0000), GREEN(0x00ff00)

    final int hex
    Color(int h) { hex = h }
}

trait Walkable {
    abstract void walk()
    String greeting() { "hello" }
}

class Robot implements Walkable {
    String name

    Robot(String name) {
        this.name = name
    }

    void walk() {
        println("walking " + name)
    }

    String describe() {
        def nick = name ?: "unknown"
        def upper = name?.toUpperCase()
        def doubled = [1, 2, 3].collect { it * 2 }
        return "robot ${name} ${nick} ${doubled}"
    }
}

class MathSpec extends Specification {
    def "addition works"() {
        expect:
        1 + 1 == 2
    }
}

def globalHelper(x) {
    return x + 1
}

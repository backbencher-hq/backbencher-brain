// NEGATIVE fixture: proves the analyzer emits NO noise for Groovy constructs
// that must not become symbols or relationships:
//   1. @Slf4j generates NO `log` symbol (old analyzer synthesized it).
//   2. Class fields generate NO getX/setX method symbols (old analyzer).
//   3. Property access generates NO synthetic get/set call edges (old).
//   4. Closures generate NO implicit `it` symbol (old analyzer).
//   5. `+`, `+=`, `?:` operators are NOT calls.
//   6. String interpolation identifiers ($name) are NOT symbols/uses.
//   7. println is a language builtin — NO call edge (positive control below).
//   8. package/import declarations are NOT symbols (references only).
// Positive controls: this.count (uses), square(4) (calls), xs.each (calls),
//   xs.size() (calls), new Counter(0) (instantiates).

package com.example.negative

import java.util.List

@Slf4j
class Counter {
    int count = 0
    private String label = "c"

    Counter(int start) {
        this.count = start
    }

    int add(int a, int b) {
        return a + b
    }

    int bump() {
        count += 1
        log.info("bumped to ${count}")
        return count
    }

    String interpolate(String name) {
        return "hello ${name}"
    }

    def useClosure() {
        def square = { x -> x * x }
        return square(4)
    }

    def useList() {
        def xs = [1, 2, 3]
        xs.each { println it }
        return xs.size()
    }

    def makeSelf() {
        return new Counter(0)
    }
}

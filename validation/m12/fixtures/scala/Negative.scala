// NEGATIVE fixture: proves the analyzer does NOT emit noise for Scala
// constructs that must not become symbols or relationships.
//
// 1. `+`, `*`, `+=`, `-` operators are infix_expression — NOT Calls.
// 2. String interpolation identifiers ($name, ${p.x}) are NOT symbols.
// 3. Type parameters and lambda params are NOT symbols.
// 4. Builtin/companion calls (println, List, Map) are NOT References/imports.
// 5. `new Type(...)` IS Instantiates (positive control).
// 6. A plain `class P(x: Int)` (no val/var, not case) does NOT create
//    property symbols for its constructor params.

package com.example.negative

class PlainParams(x: Int, y: String) {
  def add(a: Int, b: Int): Int = a + b
  def mul(a: Int, b: Int): Int = a * b
  def inc(): Unit = { var n = 0; n += 1 }
  def neg(a: Int): Int = -a
  def interpolate(name: String): String = s"hello $name, len=${name.length}"
  def useLambda(): Int = {
    val double = (x: Int) => x * 2
    double(4)
  }
  def useBuiltins(): Unit = {
    println("hi")
    val xs = List(1, 2, 3)
    xs.map(_ + 1)
  }
  def makeMe(): PlainParams = new PlainParams(1, "a")
}

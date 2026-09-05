// PINS the scala wave fixture pack (M29.R2 wave 1, owner-approved set).
package dev.backbencher.wavetest

import scala.collection.immutable.List

class Greeter(items: List[String]) {
  def greet(): String = s"hello ${items.size}"
}

object Main {
  def main(args: Array[String]): Unit = {
    val g = new Greeter(List("a", "b"))
    println(g.greet())
  }
}

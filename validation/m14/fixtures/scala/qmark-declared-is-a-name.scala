package com.acme.wildcard

object QmarkDeclared {

  /** A legal Scala 3 type NAME. `class ?` and `type ?[A]` both exist — see
    * test/files/neg/qmark-deprecated.scala:9 and :22 — so the `?` the analyzer
    * reads in a type position here is a name, not a wildcard, and the difference
    * from scala/qmark-wildcard-is-not-a-name is the FILE and nothing else. */
  type `?`[A]

  def useQmark(x: ?[Int]): ?[Int] = x
}

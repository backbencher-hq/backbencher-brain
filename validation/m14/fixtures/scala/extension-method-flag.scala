package com.acme.core

extension (s: String) {
  def shout(): String = s.toUpperCase
}

// M59 #825 follow-through: the receiver TYPE is written on the extension
// line, which need not be the method's line. The old stamp reported the
// receiver use on the method's declaration line.
extension (
  x: Bla
) {
  def greet(): String = x.text
}

class Bla {
  val text = "hi"
}

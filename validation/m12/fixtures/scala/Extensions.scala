package com.example.ext

import scala.collection.mutable.ArrayBuffer

type Id = String

extension (s: String) {
  def shout(times: Int): String = s * times
  def isBlank: Boolean = s.trim.isEmpty
}

given Ordering[Int] with {
  def compare(a: Int, b: Int): Int = a - b
}

def buildBuffer(): ArrayBuffer[Id] = {
  val buf = ArrayBuffer.empty[Id]
  buf += "x"
  buf
}

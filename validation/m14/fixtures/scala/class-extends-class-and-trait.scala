package com.acme.core

open class Base {
  fun placeholder() {}
}

abstract class Animal {
  def speak(): String
}

class Dog(name: String) extends Animal {
  def speak(): String = "woof"
}

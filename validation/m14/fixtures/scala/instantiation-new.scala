package com.acme.core

class Engine {
  def start(): Unit = ()
}

class Car {
  val engine = new Engine()
}

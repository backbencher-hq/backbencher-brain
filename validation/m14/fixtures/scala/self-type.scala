package com.acme.core

trait Service {
  this: Logging =>
  def go(): Unit = ()
}

trait Logging

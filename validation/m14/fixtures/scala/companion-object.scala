package com.acme.core

class Service {
  def run(): Unit = ()
}

object Service {
  def create(): Service = new Service()
}

package com.example.scala

trait Formatter {
  def format(value: String): String
}

class ScalaService(val prefix: String) extends Formatter {
  override def format(value: String): String = s"$prefix:$value"
  def find(id: String): Option[String] = Some(format(id))
}

object ScalaService {
  val version: Int = 1
  def create(): ScalaService = new ScalaService("scala")
}

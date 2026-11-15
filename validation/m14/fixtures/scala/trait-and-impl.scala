package com.acme.core

trait Repo[A] {
  def find(id: Long): Option[String]
}

class UserRepo(name: String) extends Repo[Int] {
  override def find(id: Long): Option[String] = None
}

package com.example.service

import com.example.base.BaseService
import com.example.repo.Repository

class UserService(private val store: Map[String, User]) extends BaseService[User] with Repository[User] {
  override def save(item: User): User = item
  override def format(value: String): String = value
  def find(id: String): Option[User] = store.get(id)
  def create(): UserService = new UserService(Map.empty)
}

case class User(id: String, name: String)

object UserService {
  val instance: UserService = new UserService(Map.empty)
  def apply(name: String): UserService = new UserService(Map(name -> name))
}

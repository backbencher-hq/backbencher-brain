package com.example.repo

trait Repository[T] {
  def save(item: T): T
  def find(id: String): Option[T]
}

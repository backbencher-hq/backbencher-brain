package com.example.base

trait BaseService[T] {
  def save(item: T): T
  def format(value: String): String
}

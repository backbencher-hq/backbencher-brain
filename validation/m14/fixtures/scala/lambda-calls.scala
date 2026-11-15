package com.acme.core

class Processor {
  def transform(items: List[Int]): List[Int] = {
    items.map(x => x * 2)
  }

  def helper(): Int = 1

  def caller(): Int = {
    helper()
  }
}

package com.acme.core

class Box[T <: Comparable[T]](val item: T) {
  def swap[U](other: Box[U]): Box[U] = other
}

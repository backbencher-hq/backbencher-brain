package com.demo

/** Scala warehouse — calls INTO the Java class. */
class Warehouse {
  val inventory = new Inventory()

  def currentStock(): Int = inventory.getStock()

  def refill(amount: Int): Unit = inventory.restock(amount)
}

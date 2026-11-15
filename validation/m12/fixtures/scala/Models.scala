package com.example.models

case class Point(x: Int, y: Int)

sealed trait Shape

case class Circle(radius: Double) extends Shape

enum Color(val hex: Int) {
  case Red extends Color(0xff0000)
  case Green extends Color(0x00ff00)
  case Blue extends Color(0x0000ff)
}

class PointService(val label: String) {
  var count: Int = 0
  def describe(p: Point): String = s"$label:(${p.x},${p.y})"
  def shift(p: Point, dx: Int, dy: Int): Point = Point(p.x + dx, p.y + dy)
}

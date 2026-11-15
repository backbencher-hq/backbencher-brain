package demo.edge

import x.y.Z as W
import a.b.{C, D => Renamed}
import q.r._

object EdgeCases {
  def add(x: Int)(y: Int): Int = x + y
  def process(f: Int => Int): Int = f(1)
  def useSelf(): Unit = {
    self.add(1)(2)
    process(n => n + 1)
  }
}

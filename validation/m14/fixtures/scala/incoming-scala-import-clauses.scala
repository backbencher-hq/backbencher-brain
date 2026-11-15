package demo.imports

import java.util.List
import scala.collection.mutable
import scala.collection.immutable.{Set, Map => ImmutableMap}
import scala.concurrent.duration.FiniteDuration
import java.io.{File => JFile, FileInputStream => Stream}
import scala.util._

object Imports {
  val plain: List[String] = List.empty
  val mutable: mutable.Buffer[Int] = mutable.Buffer.empty
  val set: Set[Int] = Set.empty
  val map: ImmutableMap[String, Int] = ImmutableMap.empty
  val finite: FiniteDuration = FiniteDuration(1, "second")
  val file: JFile = new JFile("x")
  val stream: Stream = new Stream(null)

  private def hidden(only: Int): Int = only
  def shown(also: Int): Int = hidden(also) + plain.size
}

class Nested {
  // A nested type must not reach the export surface.
  class Inner
  def member: Int = 1
}

private object NotPartOfTheApi {
  def hidden: Int = 2
}
package demo.exports

// A public top-level TYPE ALIAS is part of the unit's surface and is importable
// under its own name. handleTypeAlias had no export path, so `type Id = String`
// was invisible to the export surface while `class Point` was not.
type Id = String

sealed trait Shape
case class Point(x: Int, y: Int) extends Shape
object Point:
  val origin: Point = Point(0, 0)

enum Color(val hex: Int):
  case Red extends Color(0xff0000)
  case Blue extends Color(0x0000ff)

trait Repo[A]:
  def save(item: A): A
  private def secret: Unit = ()

class Store[A] private (val items: List[A]):
  def head: A = items.head
  private def hidden: Int = 1
  class Nested
  def nested: Nested = new Nested

private[exports] object PackageScoped:
  def visible: Int = 1

private object Hidden:
  def alsoHidden: Int = 2

// Quoting is not part of a NAME: this declares the identifier `strip margin`,
// and every spelling that can refer to it omits the backticks.
implicit val `strip margin`: String => String = (s: String) => s

def topLevel(input: Id): Id = input

// Scala 3 re-export clauses. The pinned tree-sitter-scala grammar parses all
// three forms with zero ERROR nodes (probed before this fixture was written).
object Reexports:
  export scala.util.Try
  export scala.collection.immutable.{List, Map => M}
  export scala.concurrent.duration.*
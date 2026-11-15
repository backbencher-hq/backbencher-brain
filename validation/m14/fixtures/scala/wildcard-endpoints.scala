package p

// ── SCALA4 / rule R7: a WILDCARD is not a name ─────────────────────────────
// Every shape below is a spelling scala3's own corpus uses. `Class[?]` and
// `Class[_]` parse as generic_type > type_arguments > type_identifier("?") /
// type_identifier("_"), so the type-name walk reaches the wildcard and used to
// publish it as a referenced TYPE. Measured over 18,965 files through
// production parseFile: 878 `references` endpoints were a placeholder literal
// resolving to no published symbol, 874 of them spelled `?`.

class Wildcards {
  // compiler/src/dotty/tools/dotc/config/Properties.scala:24
  def pickJarBasedOn: Class[?]
  // Scala 2's spelling of the same thing.
  def loadClass2: Class[_]
  def plain: Class[String]
  def nested: java.util.Map[?, String]
  def multi: List[Map[?, _]]
}

// The POSITIVE half, and it is the load-bearing half. `def *` and `def ?` are
// legal Scala method names — library/src/scala/Char.scala declares six `*`
// overloads and 17 `?` targets on the corpus resolve to a `def ?` — so a
// literal ban would delete real edges. These must survive.

// repl/src/dotty/tools/repl/AbstractFileClassLoader.scala:86-92
class Loaders {
  def loadClass(name: String): Class[?] = null
  def isNullary(x: Int): Boolean = this.?
  def *(x: Int): Int = x * 2
  def scale(x: Int): Int = this.*(x)
}

// project/scripts/bisect.scala:261
class Release(version: String) {
  def parse(): Int = version match {
    case s"$major.$minor.$patch-$_" => major.toInt + minor.toInt + patch.toInt
    case _                          => -1
  }
}

// tests/pending/run/t7715.scala:21
class Pattern {
  def grab(s: String): Int = s match {
    case rx"${_} by ${other}" => other.length
    case _                    => -1
  }
}

// library/test/scala/collection/IterableTest.scala:89 — `unknown` is a legal
// val name, and a literal ban on the R7 placeholder would delete this edge.
class Factories {
  val unknown: IterableFactory[LinearSeq] = List
  def read(f: IterableFactory[LinearSeq]): Int = f.length
}
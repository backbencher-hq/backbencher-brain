package com.acme.core

import scala.collection.mutable
import scala.collection.mutable.ListBuffer
import scala.util.{Try, Success}

/** An ordinary public class. */
class Host(val id: Int) {
  def member(): Unit = ()

  /** An AUXILIARY constructor — `this` is the keyword that introduces it. */
  def this(id: Int, label: String) = this(id)
}

/** A private class is NOT part of the file's export surface. */
private class Hidden {
  def secret(): Unit = ()
}

/** A top-level public object IS exported. */
object Registry {
  def lookup(n: String): String = n
}

/** A top-level public function IS exported. */
def topLevel(x: Int): Int = x + 1

/** A top-level public TYPE ALIAS is exported: `import p.Alias` binds it exactly
  * as it binds the class above. Measured: handleTypeAlias had no export path, so
  * the adjudicator found `exports` disagreeing on every package-object alias
  * (src/compiler/scala/tools/nsc/io/package.scala:27-34) while the `val` two
  * lines up was exported. */
type Alias = Int

/** …and a PRIVATE alias is not. */
private type Hidden = Int

/** A top-level public val IS exported. */
val topLevelValue: Int = 7

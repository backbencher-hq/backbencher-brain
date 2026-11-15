package com.acme.imports

/** Every spelling of a SELECTOR clause, one per dependency. Found by
  * script/m14/tmp/scala-type-adjudicator.ts, the lane's own second walker: on a
  * 300-file draw it reported `imports (file) -> treeBuilder.global.unit.global`
  * as ANALYZER-ONLY against an oracle-derived `treeBuilder.global.unit`, which
  * is not a module path any package has. */
object ImportRenames {

  /** TWO renames in one clause. The dependency is each renamed name under the
    * PACKAGE — two edges — and never the two names concatenated. */
  import scala.collection.mutable.{Field => JField, Method => JMethod}

  /** `X => _` is an EXCLUSION: this file depends on the package and does NOT
    * depend on the excluded names, so naming them would assert the opposite. */
  import treeBuilder.{global => _, unit => _}

  /** An exclusion beside a real rename: the package, plus the renamed name. */
  import scala.collection.{immutable => im, mutable => _}

  /** The SINGLE-rename form is unchanged, and that restraint is load-bearing:
    * validation/m12/ground-truth/scala.json records
    * `import scala.collection.{immutable => im}` as the module path
    * `scala.collection.immutable`, and differential.ts's importPathOf derives
    * the same path. */
  import scala.util.{Try => ScalaTry}

  /** A SINGLE-SEGMENT module path: `Scaladoc` is a top-level object, and the
    * dependency is `Scaladoc.<member>` under exactly the same rule as the dotted
    * case above. A bare `member` would name a package that does not exist. */
  import Scaladoc.{Parser, Utils}

  /** A Scala 3 MULTI-CLAUSE import: `import sbt._, Keys._` depends on TWO
    * packages, and the module path concatenates them into `sbt.Keys`, which is
    * neither. 149 such declarations on the corpus, this being the commonest
    * shape (project/BuildSettings.scala:3). */
  import sbt._

  /** A COMPLETE PATH followed by another one: the first group is a dependency in
    * its own right (src/compiler/scala/tools/nsc/CompilationUnits.scala:17). */
  import scala.collection.mutable, scala.collection.immutable

  /** …and the second group after a selector clause is its own dependency
    * (src/compiler/scala/tools/nsc/Global.scala:19). */
  import scala.collection.{immutable, ListBuffer}, mutable.ArrayBuffer

  /** Plain selector list and wildcard, unchanged — the controls. */
  import scala.collection.mutable.{ListBuffer, ArrayBuffer}
  import scala.concurrent.duration._
}

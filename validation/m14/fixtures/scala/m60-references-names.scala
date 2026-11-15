// M60/S7 + S8 (scala deep review) — a published NAME is quoting-free and comes
// from the `name:` field, on both the import path and the reference SOURCE.
//
// Two defects, both of which published edges with the wrong NAME, so the negative
// half is what can fail on them.

package p

import scala.language.`2.13`
import scala.collection.{immutable => imm}
import cats.effect.IO as IOAlias

class Refs[A](other: Map[String, List[A]]) {
  // (S8) An operator-named method. Its name is an `operator_identifier`, so
  // "first child of type identifier" finds the TYPE PARAMETER `A` and every
  // reference inside the method is attributed to `A` instead. Because the edge
  // dedupe key is (source, target, kind), every operator-named method in a file
  // also collapses onto ONE bogus source, so the edge COUNT drops.
  def <&(that: Refs[A]): Refs[A] = this
  def <&(that: Map[String, A]): Map[String, A] = that

  // CONTROL: an identifier-named method resolves its own source.
  def zip[B](other: Refs[B]): Refs[B] = this

  // CONTROL: a parameterless def's type child is its RETURN type, not an
  // `annotation_type` — the label that position would carry is unreachable on
  // both corpora (0 of 13,802 scala3 and 0 of 4,176 cats-effect function
  // definitions, measured by script/m14/tmp/scala-annotation-type-census.ts, and
  // 0 of 20 probed synthetic shapes). Recorded as SDJ-6.
  def size: Int = 1

  // CONTROL: a throws clause is the ONE type-position child that can precede the
  // parameter list, and it names its ARGUMENTS, never `throws` itself.
  @throws[IO]
  def save(item: String): String = item
}

class IO

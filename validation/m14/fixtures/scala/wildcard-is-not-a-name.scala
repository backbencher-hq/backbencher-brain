package com.acme.wildcard

object WildcardNames {

  /** A PLACEHOLDER type is not a name. `-_` is `-` (contravariant) with an
    * INFERRED argument; the pinned grammar parses it as infix_type >
    * type_identifier("-") + identifier("_"), so a type-name walker that reads
    * every `type_identifier` publishes the operator character on its own. */
  val contravariant: -_ => +_ = (_: Int).toLong

  /** The vararg form puts the placeholder inside a repeated parameter. */
  def bynameAndVararg(byname: => -_, vararg: -_*): +_ = vararg.sum.toLong + byname

  /** ESCAPED `-_` IS a real declaration and must survive the guard above:
    * quoting is what distinguishes the alias from the placeholder. */
  type `-_` = Int
  val escapedAlias: `-_` = 1

  /** `$_` interpolates the WILDCARD, which no declaration names. */
  def interpolate(n: Int): String = s"\\*{$_}"

  /** The positive control: an ordinary interpolated identifier is a reference
    * and the guard must not swallow it. */
  def interpolateRealName(name: String): String = s"[$name]"
}
object ShortName {

  /** The guard must be EXACTLY the wildcard, not "any one-character name":
    * `$a` interpolates a real parameter and must stay a `uses` edge. A guard
    * written as `id.text.length !== 1` reads the same and drops it. */
  def interpolateShortName(a: Int): String = s"[$a]"
}

package com.acme.wildcard

object QmarkWildcard {

  /** `?` ALONE is Scala 3's INFERRED-TYPE wildcard and `? >: Null` a bound on
    * one. The pinned grammar spells both as a bare `type_identifier "?"`, which
    * is node-for-node identical to the legal Scala 3 type name `?` — so nothing
    * about the NODE decides this. The FILE does: this one declares no `?`, so
    * both occurrences are wildcards and neither is a name.
    *
    * Split from the declared half on purpose. A single file cannot carry both
    * rows: the rule is per-file by construction (the analyzer's declared-name set
    * is built per parse), so a fixture that asserted "forbid `?` here, expect `?`
    * two lines down" would be asserting a contradiction, and it is the kind of
    * expectation that reads as coverage and is satisfied by luck. The declared
    * half is scala/qmark-declared-is-a-name. */
  val qmarkBounds: Map[? <: AnyRef, ? >: Null] = Map.empty

  def qmarkParameter(x: List[?]): List[?] = x
}

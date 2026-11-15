package com.acme.core

/** An auxiliary CONSTRUCTOR. `this` is the keyword that introduces it and no
 *  file declares a member called `this`, so the honest publication is: no new
 *  symbol, the parameters folded into the class's own constructor payload
 *  (the constructor carries the CLASS name by M37.21 C3 — see the M60 fold),
 *  and the body's relationships attributed to the class. */
class Service(val name: String) {
  def this(name: String, retries: Int) = this(name)

  def healthy: Boolean = name.nonEmpty
}

/** A keyword LITERAL interpolated into a string. `null`, `true` and `false` are
 *  constants no declaration names, so `uses Service -> null` would name a symbol
 *  the file does not declare. */
object Probe {
  val a = s"$null"
  val b = s"$true"
  val c = s"${nameOf(1)}"
  def nameOf(n: Int): String = n.toString
}

/** The pinned grammar ACCEPTS `val this = this` even though the language rejects
 *  the bare spelling — scala3 test/files/pos/t8365.scala:7 is exactly this, and
 *  it parsed here before the guard. So the pattern node arrives carrying the
 *  keyword and the generic path would publish a property named `this`. */
class KeywordPattern {
  val this = this
}

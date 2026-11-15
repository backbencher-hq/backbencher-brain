package com.acme.core

/** An ESCAPED identifier is a legal Scala name (SLS 1.1): the source spells it
 *  in backticks and a reference writes it the same way, so `def \`return\``
 *  declares a member that IS called `return`. M60 #924 decided the PUBLISHED
 *  name drops the backticks, which is what makes it referenceable. These three
 *  must therefore keep their symbols — the reserved-word guard must not eat
 *  them. */
class Keywords {
  def `return`: Int = { return 0 }
  def `type`: String = "x"
  def `class`: Int = 1
}

/** The companion of the class above, to prove an escaped name in one owner does
 *  not collide with the same name in another. */
object Keywords {
  def `return`: String = "s"
}

class Base {
  def `this`: Int = 1
}

class Derived extends Base {
  // A keyword reached through `super` with an OPERATOR member name. The pinned
  // grammar parses this as
  //   field_expression value:(identifier "super") field:(operator_identifier "==")
  // so a leaf collector that reads only `identifier` finds nothing past the
  // receiver and publishes `calls f -> super` — the RECEIVER as the callee.
  def check(x: AnyRef): Boolean = super.==(x)
  override def ##(x: String): Int = super.##(x)
}

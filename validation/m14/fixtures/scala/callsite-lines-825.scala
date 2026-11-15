// fixture: scala/callsite-lines-825
// M59 (#825): a call's line_number is the line the CALL is written on — not the
// line the receiver that opens a multi-line chain starts on. A call_expression's
// start position is its receiver's start, so before this pin every call in a
// multi-line chain inherited the chain's opening line. Measured on cats-effect
// Example.scala: `.as(ExitCode(2))`, written on the chain's second line, was
// reported on the first.
package lines

object Chains {
  def chained(args: List[String]): Unit =
    (println(args(0)).replicate(5) >>
      println(args(1)).replicate(5)).replicate(2).as("done")

  def continued(items: List[Int]): List[Int] =
    items
      .map(x => x + 1)
      .filter(x => x > 1)
}

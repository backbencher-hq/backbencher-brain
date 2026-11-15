case class Point(x: Int, y: Int)

object M {
  def m(o: Any): String = o match {
    case p: Point => "pt"
    case Point(a, b) => "xy"
    case _ => "?"
  }
}

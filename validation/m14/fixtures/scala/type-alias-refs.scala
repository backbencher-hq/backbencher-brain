type Fn = (Int) => String

object U {
  def apply(f: Fn): String = f(1)
}

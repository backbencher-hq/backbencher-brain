class Foo {
  def bar(x: Int): Int = x
}

object U {
  def apply(xs: List[Int]): List[Int] = xs.map(Foo.bar)
}

trait Ord[T]
trait Codec[A]

class Registry {
  given Ordering[Int] with { }
  given intCodec: Codec[Int] with { }
  def use(): Unit = ()
}

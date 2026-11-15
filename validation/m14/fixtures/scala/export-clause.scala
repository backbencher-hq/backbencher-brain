package p

object Inner {
  def cancel(): Unit = ()
  def isCancelled: Boolean = false
  def hidden: Int = 1
}

class Base {
  def fromInt(x: Int): Int = x
}

trait Marker

object Outer {
  export Inner.{cancel, isCancelled}
}

object Renaming {
  export Inner.cancel as stop
  export Base.fromInt
}

object Everything {
  export Inner._
}

extension (s: String) {
  export Inner.hidden
}

export Inner.isCancelled

object Selector {
  export Inner.{a => b}
}
object Partial {
  export Inner.{cancel as _, _}
}

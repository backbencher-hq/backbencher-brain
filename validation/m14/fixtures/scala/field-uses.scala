class Holder {
  var value: Int = 0
}

object R {
  def inc(h: Holder): Unit = {
    h.value = h.value + 1
  }

  def bump(h: Holder): Unit = {
    h.value += 1
  }

  def read(h: Holder): Int = h.value
}

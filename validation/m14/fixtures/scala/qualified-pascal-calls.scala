sealed trait LoadDestination
object LoadDestination {
  case object Jump extends LoadDestination
}

class Router {
  def go(h: Handler): Unit = {
    h.Jump(1)
    plainCall()
  }

  def plainCall(): Unit = {}
}

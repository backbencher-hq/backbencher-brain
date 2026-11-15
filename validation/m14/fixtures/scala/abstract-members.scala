trait Service {
  val name: String
  var mutableCount: Int
  def act(): Unit
}

class Impl extends Service {
  val name: String = "impl"
  var mutableCount: Int = 0
  def act(): Unit = ()
}

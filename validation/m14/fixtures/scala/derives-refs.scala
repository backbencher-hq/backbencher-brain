trait Show[T]

object Show {
  given intShow: Show[Int] with {}
}

case class Person(name: String) derives Show
case class Point(x: Int, y: Int) derives Show, scala.util.hashing.Hashing

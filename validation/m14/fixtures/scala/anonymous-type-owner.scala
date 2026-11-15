// M49/M37 #867 scala fixture — the family ruling pinned on the fourth analyzer.

class AnonOwner {
  val classLevel: Runnable = new Runnable { def run(): Unit = () }

  def inMethod(): Unit = {
    val local: Comparator[String] = new Comparator[String] { def compare(a: String, b: String): Int = 0 }
  }
}

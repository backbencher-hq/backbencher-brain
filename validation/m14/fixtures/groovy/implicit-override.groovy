class Base {
  def greet(String name) { return "hi " + name }

  def nth(int i) { return i }

  private def helper() { return 1 }
}

class Sub extends Base {
  def greet(String name) { return "yo " + name }

  def nth(int i, Object dflt) { return dflt }

  private def helper() { return 2 }
}

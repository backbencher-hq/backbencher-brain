trait Contract {
  def run(): Unit
}

class Worker extends Base with Contract {
  def run(): Unit = ()
}

class Base

// M37.21 #610 scala ScalaD-D fixture: anonymous class body scope.
// Members inside `new Runnable { ... }` attribute to the anonymous type
// (anonymous_Runnable), never to the enclosing class — the pre-fix leak
// attributed run to Service with no anonymous symbol (JD18 family lesson
// from java, probe-verified in scala before the fix).

class Service {
  val task: Runnable = new Runnable {
    override def run(): Unit = Service.staticHelper()
  }
  def staticHelper(): Unit = ()
}

// M49/M37 #866 scala fixture. The measured divergence: `val field` inside
// `new Runnable { ... }` was dropped entirely (no symbol) — the boundary scan
// walked past the anonymous template_body, reached the enclosing `def`, and
// treated the member as a local. attribution was already correct here, and the
// fixture pins it so the two cannot drift apart. The `local` control pins the
// other half of the same boundary — a method-local is NOT a project symbol —
// so a fix that widened the boundary past the anonymous body is caught here
// rather than silently accepted.

class AnonField {
  def target(): Int = 1
  def build(): Unit = {
    val local = target()
    val r = new Runnable {
      val field = target()
      override def run(): Unit = target()
    }
    r.run()
  }
}

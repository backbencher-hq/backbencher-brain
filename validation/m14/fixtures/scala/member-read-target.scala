// M49 W15 (family-parity gate G9, construct `member-read-through-receiver`):
// a `this.count` member read targeted the literal KEYWORD `this` — an edge
// target that names no symbol in the graph — while every other managed-OO
// analyzer targets the member. Probe-verified across 13 analyzers: java,
// javascript, typescript, swift, python, dart, cpp, csharp, php, go and rust
// all emit `<method> -> count`; scala alone emitted `<method> -> this`.
//
// Contract after the fix:
//   - a SELF receiver resolves to the member leaf (`this.count` -> count),
//   - any other receiver keeps the base-variable read (`h.value` also reads `h`),
//   - a call callee (`self.helper()`) stays a CALLS edge, never also uses.
class Store {
  val count = 0

  def read: Int = this.count

  def viaBlock: Int = {
    this.count
  }

  def other(h: Holder): Int = h.value
}

class Holder {
  val value = 1
}

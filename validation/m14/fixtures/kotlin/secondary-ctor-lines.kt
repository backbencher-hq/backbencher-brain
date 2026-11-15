// fixture: kotlin/secondary-ctor-lines
// M59 (#825) follow-up, measured on Exposed ResultRow.kt/Table.kt/ColumnType.kt.
// Two shapes. (1) A secondary constructor keeps its declared (class) name, so
// its symbol range and contains edge must name the CLASS-name line — the
// `constructor` keyword carries no name, and claiming the keyword line fails
// the source check. (2) Braceless when-entries glue into one monster
// call_expression spanning entries; target and line must come from the SAME
// callee node (the leaf that produced the target), never from the monster's
// tail (the next entry's condition).
class Register(private val name: String) {
  constructor(name: String, age: Int) : this(name)

  fun collect(fields: List<Any>, out: MutableList<String>) {
    fields.forEach {
      when {
        it is String -> out.add(it)
        (it as? List<*>)?.size == 0 && it is List<*> -> {
          out.add(it.toString())
        }
        it is Boolean -> out.add("b")
      }
    }
  }
}

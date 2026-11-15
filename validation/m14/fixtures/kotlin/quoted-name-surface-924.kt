// #924 fixture source (M60 name surface, the kotlin row).
//
// Quoting syntax is not part of a NAME. Kotlin spells `in`, `when` and `object` with backticks
// because they are keywords, and every expectation in the sibling JSON is the CONTRACT — the
// published name is the bare identifier — not an observation of what the analyzer happened to
// print. The negative pins are deliberately spelled as `targetEndsWith: "`"` rather than naming
// the three quoted strings, so a future shape that leaks the syntax into a name dies here too.
//
// This source exists because the class was routed by a CENSUS, not by a fixture: the register's
// whitespace-keyed subclass only counted a quoted identifier that contained a space, so 52
// distinct scala names were invisible to routing. A fixture cannot be written from a census
// sample; it can be written from the contract.
object Parameters {
    fun `in`(x: Int): Int = x
}

class Holder {
    val total: Int = 0

    fun `when`(v: Int): Int = v

    fun use(param: Parameters): Int {
        return param.`in`(1) + this.`when`(2) + total
    }
}

fun `object`(): Int = Holder().`when`(3)

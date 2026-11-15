fun f(x: Int): Int {
    if (x > 0) { return 1 } else { return 2 }
    for (i in 0..2) { }
    return if (x > 1 && x < 5) 3 else 4
}

// F6 coverage (2026-09-02): catch_block, character_literal, collection_literal,
// disjunction_expression, do_while_statement, elvis_expression, guard_condition,
// infix_expression, range_test, real_literal, spread_expression,
// use_site_target, when_condition, when_entry, when_expression, when_subject,
// while_statement — declared handled_verified, now exercised.
// F6: collection_literal, character_literal, real_literal (probe-verified
// shapes in this grammar).
val literalBag = [1, 2]
val initial = 'z'
val factor = 2.5

// F6: spread_expression (vararg spread at a call site — probe-verified that
// the *x form parses as spread_expression when the callee is a plain fun).
fun consume(vararg parts: Int): Int = parts.size
fun caller(xs: IntArray): Int = consume(*xs)

class F6Holder(@field:Deprecated val tag: String) {
    val flags: Collection<String> = listOf("a", "b")

    fun probe(ch: Char, ratio: Double, vararg extra: Int): Int {
        var total = 0
        while (total < 3) {
            total += 1
        }
        do {
            total -= 1
        } while (total > 0)
        val grade = when (val score = total) {
            in 1..2 -> 1
            3, 4 -> 2
            else -> 0
        }
        val safe = flags.firstOrNull() ?: "z"
        val combined = true || false
        total += grade + safe.length + ch.code + ratio.toInt()
        // F6: spread_expression (vararg spread at call site).
        total += extra.fold(0) { acc, e -> acc + e }
        // F6: catch_block.
        try {
            total += 1
        } catch (e: IllegalStateException) {
            total -= 1
        }
        // F6: infix_expression (named infix function).
        val stepped = total downTo 1
        return stepped.count() + tag.length
    }

    // F6: guard_condition — Kotlin 2.x when-guard (is T if cond).
    fun classify(x: Any): Int = when (x) {
        is String if x.length > 2 -> 1
        else -> 0
    }
}

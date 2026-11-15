fun target(): Int = 1

fun LambdaCaller(): Int = listOf(1).map { target() }.first()

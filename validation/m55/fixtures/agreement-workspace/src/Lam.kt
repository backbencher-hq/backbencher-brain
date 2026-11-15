fun target(): Int = 1

fun caller(): Int = listOf(1).map { target() }.first()

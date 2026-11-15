package com.acme.surface

/**
 * Published surface of a compilation unit.
 *
 * Kotlin has no `export` statement. What it has is that a top-level
 * declaration is `public` unless it says otherwise, and that `internal` and
 * `private` withhold a top-level declaration from the consumer surface. This
 * fixture pins both halves of that rule, because the rule is what an `exports`
 * edge asserts and the corpus measurement showed 4,180 published declarations
 * across 558 of 600 files.
 */

public class PublicType {
    fun memberIsNotPublishedSeparately() {}
}

internal class InternalType

private class PrivateType

class DefaultPublicType

/** A block-valued accessor is a SCOPE: the `val` inside it is a local. */
public class WithAccessor {
    val computed: String
        get() {
            val insideGetter = "local, never published"
            return insideGetter
        }
}

/** A lambda is a SCOPE too, including one assigned to a class property. */
public class WithLambda {
    val strategy: (Int) -> Int = { input ->
        val insideLambda = input * 2
        insideLambda
    }

    fun method() {
        val insideMethod = 1
        println(insideMethod)
    }
}

/** A top-level lambda-valued property is still PUBLISHED — the lambda is its
 *  descendant, not its ancestor. */
val topLevelLambda: (Int) -> Int = { n -> n }

public fun publishedFun() {}

internal fun withheldFun() {}

private fun withheldPrivateFun() {}

public val publishedVal = 1

val defaultPublicVal = 2

internal val withheldVal = 3

public object PublishedObject {
    val memberOfObject = 4
}

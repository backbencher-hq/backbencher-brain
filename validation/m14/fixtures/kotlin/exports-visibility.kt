package com.acme.exports

/**
 * Kotlin's export surface: there is no `export` keyword, so what decides
 * visibility is the modifier list — and Kotlin's DEFAULT visibility is public.
 * Every name below is either written `public` or carries no modifier at all,
 * which the language's own rule makes public.
 */
public class Published

class AlsoPublished

/** `internal` is module-visible: a published API of THIS module, not something
 *  a consumer of the module can name. Excluded, and the fixture says so. */
internal class ModuleOnly

private class FileLocal

/** A member of a published class is reachable THROUGH the class, not exported
 *  as a name of its own. */
class WithMember {
    fun member(): Int = 1
}

object Singleton

fun helper(): String = "s"

val topLevelValue: Int = 2

public val explicitPublic: Int = 3

class WithPrivateMember {
    fun visible(): Int = 4
    private fun hidden(): Int = 5
}

package com.acme.ontology

import java.util.List
import java.util.concurrent.*
import kotlin.collections.MutableList as AliasList

/**
 * A public top-level class. Public is kotlin's default visibility, so this is
 * the shape most of a corpus has: an import in another file can name it.
 */
class Published {
    fun member(): Int = 1
}

/** Also public, written without a modifier. */
public class ExplicitlyPublic

data class Record(val id: Int)

fun topLevelHelper(): Int = 2

/** An annotation pushes the declaration node's start row above its name's row. */
@Deprecated("use Published")
class Annotated

internal class ModuleScoped

private class FileScoped

fun withLocals(): Int {
    fun localHelper(): Int = 3
    class LocalClass
    val localValue = 4
    return localHelper() + localValue
}
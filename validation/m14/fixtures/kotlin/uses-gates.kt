// K2 (M60 kotlin deep review): the five `uses` classes and every gate that
// SUPPRESSES one. The forbids are the load-bearing half: an oracle that only
// pins emissions cannot catch a rule that starts publishing too much, which is
// the direction all three real defects went (JD-J13 confidence, init-block
// ownership, and the delegation-argument fabrication this fixture's case 11
// pins down).

// 1. extension receiver on a PROPERTY
val String.shout: String get() = this + "!"

// 2. extension receiver on a FUNCTION
fun String.hush(): String = this.lowercase()

class Counter(val seed: Int) {
    val label: String = "c"
    val tags: List<String> = listOf("a")

    // 3. indexing READ publishes the DOTTED SPINE, not the base: `tags[0]`
    //    targets `tags`, and a chained read keeps every segment.
    fun firstTag(): String = tags[0]

    // 4. a chained index read: the spine is `label.length`, never `label`
    fun labelLength(): Int = label.length[0]

    // FORBIDDEN: the same expression as a WRITE. `=` and `op=` both parse as
    // `assignment` whose first named child is the lhs, so the gate is by SPAN.
    fun writeFirstTag(value: String) {
        tags[0] = value
    }

    // 5. bare member read — the property read that used to publish nothing
    fun labelAgain(): String = label

    // FORBIDDEN: a local shadowing the member. Gate B: the name is bound in
    // this function's scope, so it is not a read of the member it shadows.
    fun shadowed(): Int {
        val seed = 99
        return seed
    }

    // 6. string-template read. kotlin's grammar exposes a real
    //    interpolated_identifier, unlike groovy's opaque GStrings.
    fun greet(): String = "hi $label and $seed"

    // 7. a constructor val IS a member, and is readable from the body
    fun seedTwice(): Int = seed + seed

    init {
        // 8. a real member read inside an init block still publishes
        val opening = label.length
        println(opening + seed)

        // FORBIDDEN: a local declared in an init block is NOT a member. This is
        // the M60 defect aa6a2beb: the walk carried the class down through
        // `anonymous_initializer`, so this local was given ownerName = Counter
        // and published `uses Counter -> scratch` plus a phantom
        // `contains Counter -> scratch`.
        val scratch = opening + 1
        println(scratch)
    }
}

// FORBIDDEN (case 11): a constructor ARGUMENT is not a member, and the
// superclass delegation is where that difference is load-bearing — the
// delegation hangs off the class itself, so gate B's walk breaks at the class
// and can never reach a scope to find the name bound. Only the `val`/`var`
// `binding_pattern_kind` makes a constructor parameter a member.
open class Base(val kept: Int)
class Delegating(argument: Int) : Base(argument)

enum class Shade { LIGHT, DARK;
    fun readable(): String {
        // 9. an enum ENTRY is a member, readable from inside the enum
        return name + LIGHT.name
    }
}

class WithCompanion {
    // 10. a companion's members ARE the owner's members: companion_object is not
    //     an object_declaration, so owner resolution walks past it to the class.
    fun readCompanion(): String = shared

    companion object {
        val shared: String = "s"
    }
}

class Suspends {
    // 11. a QUALIFIED coroutine dispatcher: `scope.async { }` parses with a
    //     navigation_expression in callee position, and a bare-identifier match
    //     finds `launch { }` while missing every qualified call.
    fun fire(scope: Any) {
        scope.async { println(1) }
    }
}

class NotAMember {
    fun readsForeign(): Int = elsewhere + 1
}

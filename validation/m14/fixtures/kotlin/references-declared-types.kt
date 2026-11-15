// K6 (M60 kotlin deep review): the `references` class — the largest in the lane
// at 5,669 edges on the primary corpus, 35% of all kotlin output, and the last
// unaudited class.
//
// The rule is uniform: collect every `type_identifier` under a set of type-ROOT
// nodes and emit `enclosingDeclaration references TypeName`. Only types are
// `type_identifier` nodes, so a subtree walk is exact rather than approximate.
// What varies is WHICH position is a declared-type position, and that is what
// this fixture pins — ten of them, plus the shapes that must NOT produce one.

import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.seconds
import org.example.*
import java.util.*

// 1. import — the whole dotted path, and BOTH wildcard spellings. The pinned
//    wasm serializes a wildcard as identifier="x.y" plus a sibling
//    wildcard_import, so the published target is the identifier text alone and
//    never contains ".*". That is a spec, not a background detail: the first
//    oracle read it backwards and produced 24 spurious MISSING rows.
typealias Millis = Long
typealias Handler = (Int, String) -> Unit
typealias Table2 = Map<String, List<Number>>

// 2. parameter / class_parameter — and a GENERIC parameter, whose type
//    arguments are separate type_identifiers under the same root.
class Boxed<T : Comparable<T>>(val item: T, val other: List<T>, limit: TimeUnit) {
    // 3. variable_declaration
    val local: Array<Map<String, Set<Int>>> = arrayOf()

    // 8. return type — FOLLOWS the parameter list
    fun compute(input: Pair<String, Int>, flag: Boolean): Sequence<Number> = emptySequence()

    // 9. receiver type — PRECEDES the name. Both are `user_type` in the
    //    grammar, so the split is positional: a name test cannot separate them.
    fun String.shout(): CharSequence = this
    fun List<out Number>.total(): Double = 0.0

    // 4. as_expression / check_expression — the RIGHTMOST operand is the type
    fun casts(v: Any): Boolean {
        val n = v as? Number
        val s = v is String
        val t = v as List<Int>
        return n != null && s && t.isNotEmpty()
    }

    // 5. callable_reference — `Foo::bar` is a handle to a member of Foo
    fun handles(): Runnable = Runnable::run
    fun qualified(): Comparator<String> = java.lang.String::compareTo

    // A callable reference whose type is NOT also this declaration's return
    // type. `handles(): Runnable = Runnable::run` cannot pin the rule: the two
    // kinds collapse onto one (source,target) row, so disabling EITHER leaves
    // the other and the fixture passes. Reverting the callable_reference rule
    // was green until this case existed. A fixture row that two rules can
    // satisfy is pinned by neither.
    fun handleOnly(): Int {
        // NO declared type on the local: an explicit `: Runnable` would make the
        // variable_declaration rule satisfy the row too, so the callable rule
        // could be deleted and the fixture would still pass. Three separate rules
        // were covering that row before this was pinned correctly.
        val r = Runnable::run
        return if (r != null) 1 else 0
    }

    // 6. object_literal — the delegation supertype is a real type usage
    fun anon(): Any = object : Runnable {
        override fun run() {}
    }

    // 7. type_alias above is sourced to the ALIAS'S OWN NAME, not to whatever
    //    encloses it: the aliased types belong to the alias's definition. The
    //    alias's type PARAMETERS are bindings, not references.
}

// The alias's own TYPE PARAMETER DECLARATION is a binding, not a reference: the
// RHS roots exclude `type_identifier` and `type_parameters`, so `A` is not
// counted as a declared type by virtue of being introduced. Its USE in the RHS
// IS a reference — `A.()` names a function type on A — so `A` legitimately
// appears as a target.
//
// Written the other way round first, and the analyzer corrected it: the comment
// claimed `A` must not appear. It does, and should. The distinction is between
// where a name is INTRODUCED and where it is USED, and both halves are pinned
// here so neither can be dropped without a red row.
typealias Bounded<A> = A.() -> CharSequence

// A call ARGUMENT is not a declared-type position either: the graph is about
// types the declaration NAMES, not every type mentioned in an expression. The
// uses graph owns the argument; this must not absorb it.
class NotAType2 {
    fun calls(x: String): Any = listOf<Number>(1).map { it }
    fun constructs(): Thread = Thread()
}

// A member reference is NOT a declared-type position: `Int` here is the name of
// a member being read, which the uses graph owns. Pinning the absence is what
// stops the declared-type graph from absorbing every identifier in the file.
class NotAType {
    fun memberRead(): Int = counter
    val counter: Int = 0
    fun localOnly(): Int {
        val scratch = 1
        return scratch
    }
}

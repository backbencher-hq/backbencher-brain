// K4 (M60 kotlin deep review): the `contains` classes, and every ownership
// boundary that suppresses one. The forbids are the load-bearing half — all
// four analyzer defects this class found PUBLISHED a new edge, so a fixture
// pinning only emissions would have missed every one of them.
//
// The through-line: a thing is a member of a class exactly when it is DECLARED
// IN THAT CLASS'S BODY. A local declared in an init block, a function body, or
// a class body is local, and the class does not contain it. The walk threads
// an owner through every node it does not intercept, and that single fact
// produced four defects in this class.

class Owner {
    val real = 1
    fun realFun() {}

    // A NESTED class IS a member: it is declared in the owner's body.
    class Nested {
        val inner = 2
    }

    fun withLocals() {
        // FORBIDDEN: a LOCAL function, declared in a body. Visible only in this
        // body; `Owner` does not contain it. (M60: published `contains Owner ->
        // localFun`.) The `suspend` and the extension receiver are the same
        // defect in three spellings.
        fun localFun() {}
        suspend fun localSuspend() {}
        fun Number.localExt() = this

        // FORBIDDEN: a LOCAL class, declared in a body. (M60: published
        // `contains Owner -> LocalClass`.) `nextParentClass` is deliberately
        // still set for a local class — it owns the SCOPE of its own body,
        // which is a different question from being a MEMBER of the enclosing
        // class.
        class LocalClass(val v: Int)

        println(localFun() + localSuspend() + LocalClass(1).v + real)
    }

    init {
        // FORBIDDEN: an init-block LOCAL. (M60: published `uses Owner ->
        // scratch` AND a phantom `contains Owner -> scratch`.)
        val scratch = real
        println(scratch)
    }
}

// A NESTED class's members belong to the NESTED class, not to the outer one.
class Outer {
    class Middle {
        class Inner {
            val deepest = 1
        }
    }
}

// ctor `val` IS a member; a bare ctor parameter is an ARGUMENT and is not.
// The grammar states the difference with `binding_pattern_kind`.
open class Base(val kept: Int)
class Delegating(argument: Int) : Base(argument)

// An enum's entries live in `enum_class_body`, and ARE members.
enum class Shade { LIGHT, DARK;
    fun readable(): String = name + LIGHT.name + DARK.name
}

// A COMPANION's members belong to the OWNER: companion_object is not an
// object_declaration, so owner resolution walks past it to the class.
class WithCompanion {
    fun readCompanion(): String = shared
    companion object {
        val shared: String = "s"
    }
}

// An ANONYMOUS object expression is a real class with no name of its own. It is
// named after its DELEGATION SUPERTYPE, and there are two spellings of a
// delegation that must both resolve — the `()` form and the `by` form, which
// the grammar gives different node shapes.
fun anonymousForms() {
    val a = object : IntIdTable("t") { val code = 1 }
    val b = object : Deferred<T> by deferred { }
    val c = object { val plain = 2 }
    val d: Runnable = object { override fun run() {} }
    println(a.code + b + c.plain + d)
}

// Data classes GENERATE members that are written nowhere: componentN per
// primary-constructor property, plus copy/equals/hashCode/toString. The count
// is the property count and NOTHING more. (M60: a 7-property data class
// published component1..component9, because the count included the companion's
// properties once owner flattening made the owner set correct.)
data class Generated(val a: Int, val b: String)

data class Seven(
    val p1: Int, val p2: Int, val p3: Int, val p4: Int,
    val p5: Int, val p6: Int, val p7: Int,
)

// A class named `DataThing` is NOT a data class; `data` is a MODIFIER, and
// reading a declaration's own named children finds nothing.
data class Plain(val q: Int)
class NotADataClass(val r: Int)

// The EXACT production shape of the M60 over-generation: a data class with a
// COMPANION object. The count used to be every property carrying the class as
// owner, and under the family-wide owner contract the companion's properties are
// flattened onto the class — so a 2-property data class published component1..3.
// This is the form that needs the companion to reproduce; Seven and BodyProperty
// catch the same defect by other routes, and this one catches it by the route
// that actually occurred (ColumnDiff in Exposed, 7 properties, component1..9).
data class WithCompanion2(val a: Int, val b: Int) {
    companion object {
        val shared1 = 1
        val shared2 = 2
    }
}

// A data class's BODY properties generate no componentN — Kotlin's rule is
// about the primary constructor, and a body `val` is not in it.
data class BodyProperty(val s: Int) {
    val bodyOnly = 1
}

// The Compose UI-tree rule: a @Composable function's PascalCase calls are
// published as `contains` at conf 0.8 with relationshipType compose_ui_tree
// and a HEURISTIC classification, because a PascalCase name is not verified
// containment. This is the ONLY thing that can pin it: neither corpus contains
// a single @Composable file, so the rule has no corpus coverage and is
// load-bearing by fixture alone.
class Screen {
    @Composable
    fun Content() {
        Column {
            Text("hi")
            androidx.compose.material.Text("there")
        }
        lowercaseCall()
    }
}

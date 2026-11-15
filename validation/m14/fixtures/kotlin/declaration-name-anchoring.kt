// fixture: kotlin/declaration-name-anchoring
// M60 (2026-10-10). Two rulings, both already implemented in this lane and
// neither pinned by a fixture that can FAIL:
//   1. M59 (#825) — a declaration is anchored where its NAME is written, not on
//      its annotation (`@Deprecated` on 16 must not be `Annotated`'s line 17),
//      not on a member's annotation (`@JvmField` 18, `flagged` 19), not on a doc
//      comment (`/** doc */` 21, `documented` 22), and not on the parameter list
//      of a WRAPPED header (`SuspendedObject` is written on 25, its parameter on
//      26 — the Exposed SpringTransactionManager.kt case the fix was written for).
//   2. M37.21 C3 — a constructor carries its CLASS name. `Derived` (29) declares
//      a primary and two secondary constructors and all three are named
//      `Derived` (`ctor-delegation` pins that count); the wrapped data class's
//      primary constructor is named `SuspendedObject`.
package anchoring

@Deprecated("old") // trailing comment on the ANNOTATION's line
class Annotated {
    @JvmField
    val flagged: Int = 1

    /** doc */
    fun documented(i: Int): Int = i
}

private data class SuspendedObject(
    val transaction: Int,
)

class Derived(x: Int) : Base() {
    constructor() : super()
    constructor(s: String) : this()
}

open class Base

// Ruling 2, third shape: a CLASS-BODY PROPERTY. Its name is not a child of the
// `property_declaration` at all — it sits inside `variable_declaration`, one
// level down — so the name scan finds nothing and the positional fallback
// returns `binding_pattern_kind`, i.e. the `val` KEYWORD. Same line, so only a
// column pin can see it.
class Properties {
    val plain: Int = 1
}

// Ruling 2, fourth shape: a RECEIVER extension function. The positional walk
// returns the RECEIVER (`SmartPrinter`), which is a name too — just not this
// declaration's.
class SmartPrinter {
    fun printCopyright(): String = ""
}

private fun SmartPrinter.generate(packageName: String) {
    printCopyright()
}

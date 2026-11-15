// M37.21 #610 kotlin KD19 fixture: enums are first-class heritage
// participants. `enum class Direction(...) : Mode` must emit an implements
// edge to the bare supertype (Kotlin semantics: constructor-invocation
// supertype = extends, bare = implements). Pre-fix the enum handler never
// extracted superTypes, so every enum-with-interface silently dropped its
// heritage (measured: Exposed ForUpdateOption.kt MODE).

interface Mode {
    val label: String
}

open class Numbered(val n: Int)

enum class Direction(val label: String) : Mode {
    UP("up"),
    DOWN("down")
}

enum class Counted : Numbered(1) {
    ONE,
    TWO
}

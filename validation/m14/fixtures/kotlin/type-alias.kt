typealias Fn = (Int) -> String

class AliasUser {
    fun apply(f: Fn): String = f(1)
}

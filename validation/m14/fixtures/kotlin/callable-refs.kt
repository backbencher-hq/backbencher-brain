class Foo {
    fun bar(x: Int): Int = x
}

class RefUser {
    fun apply(xs: List<Int>): List<Int> = xs.map(Foo::bar)
}

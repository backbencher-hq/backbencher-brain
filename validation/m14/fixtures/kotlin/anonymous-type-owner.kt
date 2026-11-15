// M49/M37 #867 kotlin fixture. Before the ruling this file's in-method literal
// reported owner=AnonOwner (the class) while java/groovy/scala all reported the
// enclosing method; the class-level literal was already correct. Both contexts
// are pinned, which is what makes the fix non-trivial: re-owning everything to
// the method would break the second block.

class AnonOwner {
    val classLevel = object : Runnable {
        override fun run() { }
    }

    fun inMethod() {
        val local = object : Comparator<String> {
            override fun compare(a: String, b: String): Int = 0
        }
    }
}

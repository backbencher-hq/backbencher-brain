class Indexer {
    val xs = IntArray(3)

    fun read(i: Int): Int {
        val v = xs[i]
        return v
    }

    fun write(i: Int) {
        xs[i] = 42
    }
}

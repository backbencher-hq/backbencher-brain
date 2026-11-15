// #740 fixture source — authored before analyzer run.
class Store {
    var count: Int = 0
    var total: Int = 0

    fun bare(): Int {
        // bare read MUST emit (pre-fix: zero uses edges)
        return count
    }

    fun dotted(): Int {
        return this.count
    }

    fun plus(): Int {
        return count + total
    }

    fun write() {
        // assignment LHS is a WRITE — never a read
        count = 0
    }

    fun shadow(): Int {
        // GATE B (CGD15): a local binds count, so this is not a member read
        val count = 5
        return count
    }

    fun nolocal(): Int {
        val z = 7
        return z
    }

    fun go(v: Int): Int {
        return v
    }

    fun callee(): Int {
        // the ARGUMENT is a member read; the CALLEE belongs to the call graph
        return go(count)
    }
}

class Inner {
    val leaf: Int = 1
}

class Chain {
    val inner = Inner()

    fun read(): Int {
        // chain BASE is the declared member of Chain; `leaf` belongs to Inner
        return inner.leaf
    }
}

object Registry {
    var hits: Int = 0

    fun bump(): Int {
        // enclosing type of an `object` declaration
        return hits
    }
}

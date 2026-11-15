// M49/M37 #866 kotlin fixture. The measured divergence: `val field` inside
// `object : Runnable { ... }` was dropped entirely (no symbol) and the call
// from its initialiser was attributed to the OUTER method `build`, while
// java/groovy/scala all say the anonymous type. Both halves are pinned here.
// The `local` control pins the other half of the same boundary — a method-local
// is NOT a project symbol — so a fix that widened the boundary past the
// anonymous body is caught here rather than silently accepted.

class AnonField {
    fun target(): Int = 1
    fun build() {
        val local = target()
        val r = object : Runnable {
            val field = target()
            override fun run() { target() }
        }
        r.run()
    }
}

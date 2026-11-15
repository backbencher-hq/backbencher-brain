package p

class CoroutineJobs {

    suspend fun runAll() {
        // Qualified dispatch is the idiomatic form; the callee identifier is
        // wrapped in a navigation_expression (no direct simple_identifier).
        scope.launch { work() }
        scope.async { other() }
    }

    suspend fun work() { }
    suspend fun other() { }
}

val scope: kotlinx.coroutines.CoroutineScope = TODO()

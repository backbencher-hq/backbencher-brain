package com.acme.ctx

/**
 * KOTLIN 2.2 CONTEXT PARAMETERS — a declaration form tree-sitter-kotlin has no
 * node for.
 *
 *     context(session: FirSession)
 *     private fun KotlinTypeFacade.extractValue(...) = ...
 *
 * Measured on a 400-file stratified draw of
 * bb_tests/repositories/kotlin@9b80c8ff: 20 headers in 4 files. The analyzer
 * published `calls[Global -> context]` at confidence 0.7 for every one — a
 * DECLARATION stored as a CALL, sourced to a symbol no kotlin file declares.
 * 28 of the 524 `Global` call edges in that sample were context headers; the
 * other 496 were Gradle `.kts` script statements, which have no owner either.
 *
 * The parse (dumped from this grammar, not assumed):
 *
 *     call_expression "context(session: FirSession)"
 *       simple_identifier "context"
 *       call_suffix "(session: FirSession)"
 *         value_arguments
 *           value_argument  simple_identifier "session"
 *           ERROR ": FirSession"
 *             simple_identifier "FirSession"
 *
 * The ERROR is what makes it a declaration: a `value_argument` cannot carry an
 * annotation, so the parameter list does not parse, while a real
 * `context(session)` INVOCATION parses cleanly. Hence the guard tests for an
 * ERROR inside `call_suffix` and not merely for the name `context` — which is a
 * soft keyword, and `fun context(x: Int)` is a legal declaration.
 *
 * The four pins below, and the two forbids, exist because the obvious
 * over-corrections are different defects:
 *
 *   1. the header produces NO `calls` edge at all (forbid 1)
 *   2. the DECLARATION it introduces keeps its own edges — a context parameter
 *      does not swallow the function written under it (pin: `resolveValue`
 *      calls `normalizeName`, sourced to `resolveValue`, not to `Global` and not
 *      to `context`)
 *   3. a REAL call to a function the program defines named `context` is still a
 *      call and must still be published (pin: `realContextCall -> context`),
 *      because `context` is only a keyword in the header POSITION
 *   4. the same three facts hold for a context header above a CLASS and above a
 *      PROPERTY, so the guard is not accidentally specific to functions
 *
 * `normalizeName` and `RealContext` are deliberately not stdlib leaves and are
 * not declared types in this file, so both survive the stdlib and
 * declared-type filters and every pin is about the guard rather than about
 * filtering.
 */
context(session: FirSession)
fun resolveValue(raw: String): String = normalizeName(raw)

context(session: FirSession)
class RealContext {
    fun resolve(): String = normalizeName("x")
}

context(compute: (Int) -> String)
val computedLabel: String = normalizeName("y")

/**
 * `context` is a SOFT keyword. This program declares a function with that name
 * and calls it, in both a statement and an argument position. Both are calls,
 * and deleting them would be the same defect as the header in the other
 * direction.
 */
fun context(tag: String): String = tag

fun realContextCall(): String = context("plain")
package com.acme.compose

import androidx.compose.runtime.Composable

// The `renders` value for Kotlin: THE COMPOSE DSL. The rendering symbol is the
// @Composable function; the rendered component is a SAME-FILE function declared
// with the same marker, named by a call_expression in the renderer's body.
//
// Rung R3 of the remedy ladder: the annotation node and the call_expression node
// both already exist in the pinned grammar (probe-measured: the @Composable
// annotation parses as modifiers > annotation > user_type on a
// function_declaration), so NO grammar change is needed.
//
// The corpus measures ZERO such sites — 0 @Composable-named annotations and 0
// androidx.compose imports over the WHOLE admitted population (2,346 files,
// 8 repos) — so this fixture is the BEHAVIOURAL PROOF that the construct reaches
// the analyzer as real nodes, and the value is published IMPLEMENTED AND
// CORPUS-UNEXERCISED (counted once, in implemented).
//
// The impostor stops this fixture pins:
//   · a PLAIN function that calls a composable is NOT a rendering symbol;
//   · a PLAIN same-file function called from a composable body is NOT a rendered
//     component;
//   · a composable calling itself is recursion, not a render.

@Composable
fun Badge(label: String) {
}

@Composable
fun Header() {
}

fun formatLabel(raw: String): String = raw.trim()

@Composable
fun Screen(title: String) {
    Header()
    Badge(formatLabel(title))
}

@Composable
fun Recursive(depth: Int) {
    if (depth > 0) Recursive(depth - 1)
}

fun NotRendering(raw: String): String {
    Badge(raw)
    return raw
}

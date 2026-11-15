package com.acme.topprops

import java.nio.file.Paths
import java.nio.file.Path

/**
 * TOP-LEVEL properties own the edges written in their own type clause and
 * initializer.
 *
 * Three attribution resolvers in this analyzer walked up the parent chain
 * looking for a declaration to own an edge, and all three listed only
 * `function_declaration | class_declaration | object_declaration`. A
 * `property_declaration` was not in the list, so every edge inside a top-level
 * property's initializer fell through to `source_file` and was attributed to the
 * literal `"Global"` — a name that appears nowhere in kotlin and in no file of
 * the corpus. MEASURED by script/m14/kotlin-r7-endpoint-probe.ts on a 1,200-file
 * every-Nth draw of bb_tests/repositories/kotlin@9b80c8ff: 1,290 `Global` sources
 * in files the analyzer reported as CLEAN, of which 998 `calls`, 147
 * `references`, 135 `instantiates`, 10 `uses`.
 *
 * Real files, ordinary shipped `.kt`, nothing damaged:
 *
 *   CommonJsAndWasmArgumentProviders.kt:101
 *     private val testBaseDir: Path = Paths.get("").toAbsolutePath()
 *   KaFirSymbol.kt:65
 *     private val FirBasedSymbol<*>.realPsi: PsiElement?
 *
 * The MEMBER case is the other half of the rule and is pinned here too, because
 * the obvious over-correction is to treat every property as a boundary: a
 * property inside a `class_body` is owned by its CLASS, the walk reaches the
 * class first, and moving those edges onto the property would be a different
 * wrong answer. kotlin/init-attribution already pins the class side; this file
 * pins both sides side by side so the distinction cannot be lost by a
 * simplification that drops the `parent.type === "source_file"` guard.
 *
 * `buildModule()` is deliberately not a stdlib leaf, and `Holder` is not a
 * declared type in this file, so both edges survive the stdlib and
 * declared-type filters and the pins below are about attribution rather than
 * about filtering.
 */
class Holder

fun buildModule(seed: String): String = seed + "-module"

private val moduleRoot: String = buildModule("root")

private val modulePath: Path = Paths.get(moduleRoot)

/** A MEMBER property: the call in its initializer belongs to the CLASS. */
class Registry {
    val compiled: String = buildModule("compiled")
    private val nested: String = buildModule("nested")
}

/** A member property's own declared type also belongs to the class. */
class Holder2 {
    val payload: Holder? = null
}

/** A top-level property with no initializer still owns its declared type. */
internal val declaredOnly: Holder? = null

/**
 * An EXTENSION property's ACCESSOR is a SIBLING of its declaration, not a child.
 * Dumped from the pinned wasm on KaFirSymbol.kt:97-98 —
 *
 *     property_declaration [97] "private val KaFirSymbol<*>.backingPsi: PsiElement?"
 *     getter              [98] "get() = ...backingPsi"
 *
 * — so a walk up from inside the accessor body crosses no declaration and the
 * edges in it were attributed to the literal `Global`: measured 20 `references`
 * sources in clean `.kt` files. The accessor belongs to the declaration written
 * above it, and the fixture pins that reading. A NON-extension property's accessor
 * IS a child of the declaration and needed no rule, which is why both shapes are
 * here — the fix that treats every accessor as a boundary would be a second,
 * different defect.
 */
private val Holder.extensionLabel: String
    get() = buildModule("label")

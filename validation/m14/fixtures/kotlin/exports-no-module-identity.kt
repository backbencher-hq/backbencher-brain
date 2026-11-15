package com.acme.nomodule

/**
 * A compilation unit that declares NO top-level type.
 *
 * `exports` relationships need a module identity — something that stands for the
 * compilation unit as a whole — and on kotlin that can only be a top-level type,
 * because a source file has no module object of its own. This file declares only
 * functions and properties, so there is nothing to name it by and it publishes
 * NO `exports` relationship.
 *
 * It does not publish nothing. The ExportInfo ARRAY still carries every name
 * below, and that array is the one `import-resolution.ts:314` gates symbol joins
 * on, so the file's surface reaches consumers intact. The withheld count is
 * reported in `metadata.exportsWithheldNoModuleIdentity` rather than inferred,
 * so "this file published no relationships" is distinguishable from "this file
 * published no relationships because the analyzer is broken".
 *
 * The earlier behaviour — writing the FILE PATH into the edge source — is
 * forbidden below, and it was measured: over a 120-file draw 24 of 26
 * analyzer-only `exports` edges were a 90-character absolute path in the source
 * position. `parallel-indexer.ts:3451` drops an export edge whose source cannot
 * resolve to a symbol, so those rows were unreadable as well as unmatchable.
 */

fun noTypeFunction(): Int = 1

val noTypeProperty = "no primary type in this file"

internal fun internalWithoutType() = 2

public fun publicWithoutType() = 3

package com.acme.recovery

/**
 * A parse-RECOVERY case, and the shape is not invented: it is what
 * tree-sitter-kotlin produces for an IntelliJ test fixture that carries a
 * `<caret>` marker inside a type.
 *
 *     fun test(param: foo.bar.baz.AA.BB.<caret>CC) {}
 *
 * The pinned wasm cannot parse `<caret>`, so it recovers by emitting a
 * `type_identifier` node whose TEXT IS THE EMPTY STRING between `BB.` and the
 * `type_arguments` node holding `caret`. The subtree, dumped from the pinned
 * grammar on the real corpus file
 * `analysis/analysis-api/testData/components/resolver/singleByPsi/nestedTypes/ResolveTypeInTheEndOfType.kt`:
 *
 *     user_type "foo.bar.baz.AA.BB.<caret>"
 *       type_identifier "foo"    type_identifier "bar"   type_identifier "baz"
 *       type_identifier "AA"     type_identifier "BB"
 *       type_identifier ""       <-- EMPTY TEXT
 *       type_arguments "<caret>"
 *
 * `collectTypeNames` reads `n.text` off every `type_identifier` it finds, so the
 * empty one became `references: test -> ""` — an edge with NO target, published
 * at confidence 0.95 with a line number. That is the shape the ontology
 * workstream's definition of done names: no unknown symbols, no empty names, no
 * placeholder-literal edge endpoints.
 *
 * The honest state for a node with no text is ABSENCE, not the empty string.
 * `caret` and `CC` are real identifiers the tree does contain, so the pin below
 * also says the recovery neighbours still get their edges: the fix drops the
 * nameless node, it does not drop the subtree.
 */
class Holder {
    val typed: Map<String, List<Holder>> = emptyMap()
}

fun test(param: foo.bar.baz.AA.BB.<caret>CC) {}

fun wellFormed(other: Holder, list: List<Holder>) = list.size

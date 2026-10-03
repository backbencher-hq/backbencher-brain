/**
 * F#'s entry for `script/m14/ontology-coverage-gate.ts`'s ruling table.
 *
 * ## WHY THE TABLE LIVES HERE AND NOT IN THE GATE
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned shared machinery
 * (ONTOLOGY-WORKSTREAM.md §"Ownership"), and `RULED_BY_LANG` in it is a literal with no
 * extension point. Run against `fsharp` it refuses to report at all:
 *
 *   npx tsx script/m14/ontology-coverage-gate.ts fsharp
 *   ontology coverage gate — fsharp
 *   corpus: 6619 admitted files
 *   ontology coverage gate — no RULING TABLE for fsharp.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   exit code 2
 *
 * That refusal is the gate behaving correctly. It is also why this lane's one RULED verdict
 * has never been adjudicated by the arbiter in three passes. So the table lives in a file
 * this lane owns, in the gate's own `Ruled` shape, and the supervisor's permanent change is
 * two lines:
 *
 *   import { FSHARP_RULED } from "./fsharp-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { …, fsharp: FSHARP_RULED }
 *
 * `validation/m14/fixtures/fsharp/ruled-gate.ts` applies exactly those two lines to a COPY of
 * the gate under /tmp and runs the copy, so the table is PROVEN rather than asserted. Every
 * number quoted below is reproduced by that runner, and the measurements themselves are in
 * `validation/m14/fixtures/fsharp/ontology-probe.ts` (instrument A over the whole admitted
 * population) and `validation/m14/fixtures/fsharp/ontology-census.ts` (instrument B through
 * production `parseFile`).
 *
 * ## WHAT IS IN THIS TABLE: ONE ROW
 *
 * Nine of the ten types are EMITTED by production `parseFile` on the corpus, and the gate's
 * verdict loop checks EMITTED FIRST — a row for an emitted type would assert it is not
 * emitted, which is false. So the table is the tenth type's absence and nothing else. A table
 * padded to ten rows would look more complete and be less true.
 *
 * ## THE ROW: `exports`, instrument A
 *
 * Instrument A is correct here, and the choice is not a default. It is correct because the
 * construct needs a NODE TYPE THAT DOES NOT EXIST: F# has no `export` keyword, no
 * `module M (a, b)` export list — that is the Haskell shape — and no visibility modifier that
 * restricts a module's surface, so no corpus of F# can produce an export DECLARATION. That is
 * a fact about the language's vocabulary, which is what instrument A measures.
 *
 * MEASURED: the wired grammar produced a fixed inventory of distinct node types across the
 * whole admitted population and NO node type's name contains `export` — the runner prints the
 * count, and the same search is printed by
 * `validation/m14/fixtures/fsharp/ontology-probe.ts` (`node types matching an export-surface
 * word`). The six named candidates below are the C-family / JS / Lua spellings an F# grammar
 * would need in order to be wrong; all six are ABSENT from that inventory.
 *
 * ## WHAT `exports` WOULD CARRY, AND WHY `contains` ALREADY CARRIES IT
 *
 * F#'s export surface is IMPLICIT: `module M` makes everything declared in M importable
 * everywhere. The probe counts namespaces/modules that declare at least one member, and on
 * the 6,619-file population that was 7,818 occurrences in 3,630 files. That is precisely the
 * set an `exports` edge would enumerate, and `contains` already carries it at 100.0%
 * resolution at both ends (`ontology-census.ts`, question 5, both scopes). An `exports` edge
 * over the same scopes would be a second label for one written fact, which is the
 * "one construct, two labels" error this lane refused for `[<CompiledName("X")>]` when it
 * chose `uses` for attributes in pass 1.
 *
 * The two candidates that were considered and are NOT exports declarations:
 *
 *   * A `.fsi` SIGNATURE file restricts the public surface to what the signature declares.
 *     It is still not an export declaration — the signature's members ride `contains`, and
 *     the surface/definition merge the lane already applies (FS-D8) is the right treatment.
 *   * `[<CompiledName("X")>]` renames a member for other languages and is the closest thing
 *     F# has to a declared export name. It is an ATTRIBUTE, so it is a `uses` edge
 *     (`metadata.relationshipType = "attribute_application"`), and reading it as an export
 *     would make one construct two labels.
 *
 * ## WHAT WOULD OVERTURN IT
 *
 *   1. A non-zero count of any of the six node types below in the grammar inventory. That is
 *      what an F# dialect with an export list or an `export` keyword would introduce, and the
 *      gate reports that row as FALSIFIED rather than RULED-SOUND.
 *   2. INDEPENDENTLY, and stated as a search rather than as a list of six: any node type the
 *      grammar produces whose NAME contains `export`, at a non-zero count over the corpus.
 *      Pass 1's ruling named six candidates and found all six absent, which is only as strong
 *      as the six; pass 2 re-derived it as the open question and the answer was the same
 *      (0 node types matching, `(none)` for the name search).
 */

/**
 * Restated from `script/m14/ontology-coverage-gate.ts` rather than imported: the gate is a
 * top-level-await SCRIPT and exports nothing to import from, and this lane does not edit it.
 * The shape is copied verbatim from the `Ruled` type there, and
 * `validation/m14/fixtures/fsharp/ruled-gate.ts` FAILS LOUDLY if the two ever diverge — it
 * re-reads the gate's own `type Ruled` block and compares field by field, because a table
 * typed against a stale copy of the gate is a table the gate cannot use.
 */
export type Ruled = {
  type: "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

/**
 * The six node types that would mean F# HAS an export declaration.
 *
 * Taken from the spellings the gate's own `BASH_RULED` and `JSON_RULED` use, plus the two
 * the C#/Java/Kotlin/TypeScript family uses for an export surface, so the gate asks fsharp
 * the question it asks every other language. All six are absent from the inventory the probe
 * measured over the whole admitted population, and so is every node type whose name contains
 * `export` — which is the stronger form of the same measurement and is the second overturn
 * condition above.
 */
export const FSHARP_EXPORT_NODE_TYPES_THAT_WOULD_MEAN_IT = [
  "export_list",
  "export_declaration",
  "module_export",
  "export_stmt",
  "export_spec",
  "exported_item",
]

export const FSHARP_RULED: Ruled[] = [
  {
    type: "exports",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: FSHARP_EXPORT_NODE_TYPES_THAT_WOULD_MEAN_IT,
    describe:
      "an export DECLARATION — a construct that names what a module publishes. F# has no `export` keyword, no `module M (a, b)` export list (that is the Haskell shape) and no surface-restricting modifier on a module, so no corpus of F# can produce one; the wired grammar's whole node-type inventory over the admitted population contains ZERO node types whose name contains `export`, and none of the six named candidates above appears in it. The export surface is IMPLICIT and therefore is not a declaration: 7,818 namespaces/modules declaring at least one member in 3,630 files of the 6,619-file population, which is exactly the set an `exports` edge would enumerate and exactly what `contains` already carries at 100.0% resolution at both ends. Two candidates measured and declined: a `.fsi` signature file restricts the surface but its members ride `contains` and the FS-D8 surface/definition merge is the right treatment; `[<CompiledName(\"X\")>]` is an ATTRIBUTE and is already a `uses` edge (metadata.relationshipType = attribute_application), so reading it as an export would make one construct two labels. Overturn: a non-zero count of any of the six node types in the grammar inventory, or — independently and as a search rather than a list of six — any node type the grammar produces whose name contains `export` at a non-zero count over the corpus.",
  },
]
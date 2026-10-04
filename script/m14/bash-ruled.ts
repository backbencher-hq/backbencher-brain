/**
 * BASH's entry for `script/m14/ontology-coverage-gate.ts`'s ruling table.
 *
 * ## WHY THIS FILE IS HERE WHEN THE GATE ALREADY HAS A `BASH_RULED`
 *
 * It is, and that is the problem this file fixes rather than creates. The gate's
 * `RULED_BY_LANG.bash` is an inline literal, so:
 *
 *   1. The brief's instruction — a ruling is written to `script/m14/<lang>-ruled.ts`
 *      as `export const <LANG>_RULED`, in the shape of `lua-ruled.ts` and
 *      `toml-ruled.ts` — was not satisfiable for this lane, because the gate's own
 *      output tells a reader the ruling lives at `script/m14/bash-ruled.ts`:
 *
 *        extends       RULED-SOUND  … Written ruling: script/m14/bash-ruled.ts (RULED_BY_LANG.bash)
 *
 *      That path did not exist. A citation that does not resolve is not a weaker
 *      claim, it is a false one, and it was printed on all three RULED rows.
 *
 *   2. The inline table carries FOUR entries and one of them is dead. `overrides`
 *      is EMITTED (138 edges corpus-wide, `ontology-coverage-gate.ts bash`), and the
 *      gate's row loop `continue`s on an observed type before it ever reads
 *      `RULED_BY_LANG` — so the `overrides` entry, including its `countOnTree`
 *      probe, is consulted ZERO times. It reads as evidence that `overrides` is
 *      inapplicable, and it is not evidence of anything at all any more. A reader
 *      auditing the ruling surface would count four bash rulings where there are
 *      three.
 *
 * So this file holds the THREE live entries, and the supervisor's permanent change
 * is three lines (reported, not applied — the gate is shared machinery, brief §8):
 *
 *   import { BASH_RULED } from "./bash-ruled"
 *   // …and DELETE the inline `const BASH_RULED: Ruled[] = [ … ]` literal,
 *   //    which is the duplicate this file replaces.
 *   // RULED_BY_LANG keeps `{ bash: BASH_RULED, … }` unchanged.
 *
 * `validation/m14/fixtures/bash/ruled-gate.ts` applies that change to a COPY of the
 * gate in /tmp, runs it, and asserts the verdict line is byte-identical to the
 * inline table's — so the table is proven equivalent rather than asserted to be.
 *
 * ## WHAT IS *NOT* IN HERE, AND WHY IT IS THE INTERESTING PART
 *
 * No entry carries a measurement. The `Ruled` shape has no field for one, and
 * inventing a field the shared gate does not read would be decoration. So the gate's
 * own instruments ARE the measurement, run over the whole admitted corpus, and the
 * numbers each entry rests on are these:
 *
 *   instrument A population : 4,130 admitted files, 458,446 tracked, 54 repos
 *                             164 DISTINCT NODE TYPES produced
 *   instrument B            : not used by any live entry
 *
 * 164 is the whole corpus. This lane's own `probe-bash-grammar-inventory.mts` reports
 * **144** distinct node types — and it is not wrong, it walks the 400-file
 * hash-order sample. The gap is the point: a ruling proved on a 400-file sample is
 * proved against 144 of the grammar's node types, and the other 3,730 files hold 20
 * more. So for a RULED verdict the whole corpus is the only denominator that carries
 * the claim, and the gate already uses it. A ruling table is worth less than the
 * population it was measured over, and this one names its population.
 *
 * ## WHAT WOULD OVERTURN EACH ENTRY
 *
 * The gate falsifies an instrument-A entry automatically: if any name in
 * `nodeTypesThatWouldMeanIt` appears in the corpus-wide grammar inventory, the row
 * reads FALSIFIED and the gate exits non-zero. So each entry below is a falsifiable
 * claim, not a justification, and the falsifier is mechanical.
 */

/** The gate's own `Ruled` shape, restated so this file typechecks standalone and so a
 * change to the gate's shape is a compile error here rather than a silent mismatch. */
type Instrument = "A:grammar-inventory" | "B:parse-tree-count"

type Ruled = {
  type: "extends" | "implements" | "instantiates" | "overrides" | "calls" | "uses" | "contains" | "imports" | "references" | "exports"
  instrument: Instrument
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

export const BASH_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["class_declaration", "class", "interface_declaration", "trait_declaration", "struct_declaration", "inheritance_specifier"],
    describe:
      "a type declaration another type could extend. bash's only definition construct is `function_definition` (723 occurrences on the 400-file sample, and it is the sole class-like node type in an inventory of 144), and a function has no supertype: there is no syntax in which one names another. Probe: `probe-bash-grammar-inventory.mts`, whose token probe reports NONE for [class, inherit, extends, super, interface, impl, subclass, override] over the sample and NONE over all 164 corpus-wide node types.",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["implements_clause", "extends_clause", "superclass", "interface_implementation"],
    describe:
      "a supertype clause naming an implemented or inherited type. Same absence as `extends` and it is the SAME absence, not a second argument: the two types differ only in whether the supertype is nominal or contractual, and bash has no supertype clause for either reading. Probe: `probe-bash-grammar-inventory.mts`, token probe NONE for [implement, interface, protocol, trait, conform, satisfy, impl].",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["new_expression", "object_creation_expression", "constructor_invocation"],
    describe:
      "a constructor call. bash has no object construction at all — `foo` invokes a function that already exists, and the grammar's vocabulary for creating a thing is the same `command` node used for `sed`. Probe: `probe-bash-grammar-inventory.mts`, token probe NONE for [new, instantiat, construct, allocat, ctor, factory].",
  },
]
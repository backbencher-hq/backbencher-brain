/**
 * JULIA_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` needs before it will report
 * this lane at all.
 *
 * ## Why this file exists, and why it is not an edit to the gate
 *
 * The gate refuses to run for a language it has no table for:
 *
 *     ontology coverage gate — no RULING TABLE for julia.
 *     Refusing to report: a gate with an empty table would call every un-emitted type
 *     RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned (§8 of the workstream brief), so this
 * lane did not add the table there. `RULED_BY_LANG` at `ontology-coverage-gate.ts:192` currently
 * reads `{ bash: BASH_RULED, json: JSON_RULED }`, with both tables declared inline in that file. The
 * brief's correction section names `script/m14/<lang>-ruled.ts` as the per-lane home for this export
 * and points at `script/m14/lua-ruled.ts` / `script/m14/toml-ruled.ts` for the shape; NEITHER of those
 * files exists on this base (`find . -name '*ruled*'` returns only two bash fixture files), so the
 * precedent the brief describes is not present to copy. This file therefore establishes the split the
 * brief asks for: the ruling DATA is lane-owned and lives here, and the shared gate needs one import.
 *
 * ## The supervisor's edit, in full
 *
 * In `script/m14/ontology-coverage-gate.ts`:
 *
 *   1. after line 191 (`const JSON_RULED: Ruled[] = [ … ]` ends), add
 *        import { JULIA_RULED } from "./julia-ruled"
 *   2. change line 192 from
 *        const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }
 *      to
 *        const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, julia: JULIA_RULED }
 *
 * The `Ruled` and `Instrument` types are declared but NOT exported from the gate, so the shape is
 * restated structurally below. TypeScript's structural typing makes the imported value assignable to
 * the gate's local `Ruled[]` without either type being exported; if the gate is later changed to
 * export them, importing them here instead is a one-line follow-up that removes the duplication.
 *
 * ## Nothing else is needed, and that is checked rather than assumed
 *
 * The gate needs TWO things for a `RULED-SOUND` verdict, not one:
 *
 *   - the table entry below, and
 *   - a WRITTEN ruling found by `rulingFor()` (`ontology-coverage-gate.ts:~280`), which reads
 *     `script/m14/spec/julia-completeness.json` and looks for a decision whose `status` is `RULED`
 *     and whose body mentions the type.
 *
 * The second already exists and is not mine to add: decision `JUL-D2` in
 * `script/m14/spec/julia-completeness.json` has `status: "RULED"`, names `` `implements` `` in
 * backticks (which is what `rulingFor`'s first regex tests) and contains the word `type` (which is
 * what its second, prefer-a-decision-about-the-ontology test looks for). Verified against the gate's
 * own `rulingFor` logic, not assumed from reading it.
 *
 * ## Read this before accepting the `implements` ruling: the instrument decides the verdict
 *
 * The gate's decision order is: EMITTED if observed → FALSIFIED if `treeHits` has it → FALSIFIED if
 * instrument A's node list intersects the grammar → RULED-SOUND if `rulingFor` found prose. And
 * `treeHits` is populated ONLY from entries that declare `instrument: "B:parse-tree-count"` AND supply
 * `countOnTree`. So the instrument is not a label on the evidence; it selects which evidence the gate
 * is allowed to look at.
 *
 * That matters here, because the two instruments disagree and both numbers are real:
 *
 *   - INSTRUMENT A (grammar inventory). The grammar produced 149 distinct node types over 971 corpus
 *     files. The 12 names below are the ones that would express a conformance relation distinct from
 *     subtyping; NONE of them is produced. So "julia has no syntax for implements-as-distinct-from-
 *     extends" is measured, not asserted.
 *
 *   - INSTRUMENT B (parse-tree count). 325 supertype clauses across 60 files name an `abstract type`
 *     or `primitive type` declared in the SAME file — `struct Foo <: MyAbstract end`. An `abstract
 *     type` IS julia's interface, so those 325 are implements-SHAPED. The analyzer publishes all 4,309
 *     `<:` / `>:` clauses as `extends` without splitting on the supertype's kind.
 *
 * Registering instrument A yields RULED-SOUND. Registering instrument B yields FALSIFIED with
 * "the construct occurs 325x across 60 file(s) on the PARSE TREE — it is derivable, so the ruling is
 * wrong." Both outcomes are honest readings of a decision this lane made on semantic grounds, and
 * `JULIA_RULED_INSTRUMENT_B` below is the falsifying table, written out and ready, so the choice is
 * the supervisor's to make with both numbers in hand rather than a lane's.
 *
 * This lane's position, stated so it can be disagreed with: A is the correct instrument, because the
 * question is whether the language has a SECOND relation and it does not — julia has exactly one
 * subtyping relation, and `abstract type` is a participant in it rather than a separate protocol
 * system. Publishing `implements` as well would add 325 edges that duplicate 325 `extends` edges to
 * the same target with a different label, so `bb_graph` on an abstract-typed node would show both to
 * one node. The number is published in the lane doc's verdict cell precisely so this is visible to a
 * reviewer who thinks the mapping should be split.
 *
 * ## Measured provenance
 *
 * Every number here comes from `validation/m14/fixtures/julia/census.ts` over 971 admitted files
 * (JuliaLang/julia 941 + json_jl 25 + nvim-treesitter 5, no sampling), production entry point
 * `parseFile` from `src/ast/pool-worker.ts`. Reproduce with:
 *
 *     npx tsx validation/m14/fixtures/julia/census.ts --json /tmp/census.json
 *
 * No regex: `countOnTree` below navigates `node.type` and named children only.
 */

/** Mirrors `ontology-coverage-gate.ts`'s non-exported `Instrument`. */
type Instrument = "A:grammar-inventory" | "B:parse-tree-count"
/** Mirrors `ontology-coverage-gate.ts`'s non-exported `Ruled`, minus `type: Type`. */
export type Ruled = {
  type: string
  instrument: Instrument
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

export const JULIA_RULED: Ruled[] = [
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    // Every one of these 12 was checked against the 149 node types the production grammar actually
    // produced over the 971 corpus files. Zero present. This list is the census's `wouldMeanImplements`,
    // not a hand-picked guess: it is the set of node-type names that other grammars use for a
    // conformance relation, carried over so the gate can falsify this ruling if julia's grammar ever
    // grows one.
    nodeTypesThatWouldMeanIt: [
      "implements_clause",
      "interface_implementation",
      "class_implements",
      "protocol_conformance",
      "trait_implementation",
      "object_declaration",
      "protocol_declaration",
      "interface_declaration",
      "trait_declaration",
      "class_declaration",
      "mixin_clause",
      "conform_clause",
    ],
    describe:
      "julia has ONE subtyping relation. `abstract type` is a participant in it via `<:`, not a " +
      "separate protocol system, so there is no node expressing conformance-as-distinct-from-" +
      "extends. Measured: 0 of the 12 node types above among the 149 the grammar produced over 971 " +
      "files. NEAREST CONSTRUCT, PUBLISHED RATHER THAN HIDDEN: 325 supertype clauses across 60 files " +
      "name an `abstract type` declared in the same file, and all 4,309 `<:`/`>:` clauses are " +
      "published as `extends` without splitting on the supertype's kind. Splitting them would add " +
      "325 edges duplicating 325 existing ones to the same target under a second label. " +
      "Written ruling: script/m14/spec/julia-completeness.json#JUL-D2. To OVERTURN this ruling, " +
      "either (a) the grammar must produce one of the 12 node types above, or (b) julia must grow a " +
      "second subtyping operator — either falsifies it and the gate will say so.",
  },
]

/**
 * The same ruling registered on instrument B, which the gate will FALSIFY. Present so the
 * falsification is a measured, runnable thing rather than a paragraph — see the header.
 *
 * Counted exactly as `census.ts` counts it (325 occurrences / 60 files): a `binary_expression` whose
 * operator is `<:` or `>:` and whose RIGHT operand names a type declared in the same file as an
 * `abstract_definition` or a `primitive_definition`. Tree navigation only.
 */
export const JULIA_RULED_INSTRUMENT_B: Ruled[] = [
  {
    type: "implements",
    instrument: "B:parse-tree-count",
    countOnTree: (root: any, fileLabel: string, hits: string[]) => {
      const binOp = (n: any): string => {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c.type === "operator") return c.text.trim()
        }
        return ""
      }
      const namedKids = (n: any): any[] => {
        const out: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) out.push(c)
        }
        return out
      }
      /** The left and right OPERANDS of a `binary_expression`: its operator is a NAMED child, so the
       *  operands are the named children that are not it. */
      const operands = (n: any): { left: any | null; right: any | null } => {
        const named = namedKids(n).filter((c) => c.type !== "operator")
        return { left: named[0] ?? null, right: named.length > 1 ? named[named.length - 1] : null }
      }
      /** A declared type's name, read off its `type_head`.
       *
       *  NOT the first `identifier` child of the definition. That was the first version of this probe
       *  and it found 0 of 325, because the name is not a direct child: `abstract type Foo end` puts
       *  `Foo` inside a `type_head`, and a parameterised head puts the name behind a
       *  `binary_expression` whose LEFT operand is the bare name. This is the same "scan for a name
       *  before unwrapping the wrapper around it, and you get the wrapper" trap the lane doc records
       *  three times in the analyzer — and a probe that reads 0 is worse than no probe, because
       *  instrument B falsifies only on a NON-ZERO count, so a broken probe would have made the gate
       *  report RULED-SOUND for the wrong reason.
       */
      const headName = (x: any): string => {
        if (!x) return ""
        if (x.type === "identifier") return x.text.trim()
        if (x.type === "binary_expression") return headName(operands(x).left)
        const c0 = namedKids(x)[0]
        return c0 ? headName(c0) : ""
      }
      // Pass one: the type names this file declares as an interface.
      const abstracts = new Set<string>()
      const collect = (n: any): void => {
        if (n.type === "abstract_definition" || n.type === "primitive_definition") {
          const head = namedKids(n).find((c: any) => c.type === "type_head")
          const nm = head ? headName(head) : ""
          if (nm) abstracts.add(nm)
        }
        for (let i = 0; i < n.childCount; i++) collect(n.child(i))
      }
      collect(root)
      if (abstracts.size === 0) return
      // Pass two: every clause naming one of them.
      const sup = (n: any): void => {
        if (n.type === "binary_expression") {
          const op = binOp(n)
          if (op === "<:" || op === ">:") {
            const { left, right } = operands(n)
            if (right && right.type === "identifier" && abstracts.has(right.text.trim())) {
              hits.push(
                `${fileLabel}:${n.startPosition.row + 1} \`${left ? left.text.trim().slice(0, 24) : "?"}\` ${op} abstract \`${right.text.trim()}\``,
              )
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) sup(n.child(i))
      }
      sup(root)
    },
    describe:
      "325 supertype clauses across 60 files name an `abstract type` declared in the same file. An " +
      "`abstract type` is julia's interface, so these are implements-shaped and the analyzer " +
      "publishes them as `extends` instead. Registering THIS table makes the gate report FALSIFIED.",
  },
]
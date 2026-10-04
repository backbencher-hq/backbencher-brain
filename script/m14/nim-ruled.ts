/**
 * NIM's ruling table for `script/m14/ontology-coverage-gate.ts`.
 *
 * ## Why this file exists and why it is NOT the gate
 *
 * `ontology-coverage-gate.ts` is the arbiter for the ontology workstream and
 * `RULED_BY_LANG` in it holds one entry per lane that has measured its own
 * absences. It is supervisor-owned shared machinery (workstream §8), so this lane
 * writes the table beside it and does not edit it. At HEAD the permanent change
 * is two lines, and the shape of the change is already fixed by two lanes:
 *
 *   import { NIM_RULED } from "./nim-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED, nim: NIM_RULED }
 *
 * Until that lands the arbiter refuses to report for nim, which is the gate
 * behaving correctly:
 *
 *   $ npx tsx script/m14/ontology-coverage-gate.ts nim
 *   ontology coverage gate — nim
 *   corpus: 4101 admitted files
 *
 *   ontology coverage gate — no RULING TABLE for nim.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   $ echo $?
 *   2
 *
 * That refusal is measured, not quoted: the run above walks all 4,101 admitted
 * files through production `parseFile` and then exits 2 without printing a
 * verdict. `validation/m14/fixtures/nim/ruled-gate.ts` applies exactly the two
 * lines to a COPY of the gate in /tmp and runs the copy, so this table is proved
 * rather than asserted.
 *
 * ## WHY THIS TABLE HAS ONE ROW
 *
 * Nine of the ten types are EMITTED by production `parseFile` on the corpus, and
 * the gate's verdict loop checks `observed` FIRST, so a row for an emitted type
 * would be dead configuration asserting something false. The nine, re-measured:
 *
 *   calls 73,234 | uses 29,196 | contains 19,323 | references 38,170
 *   imports 8,004 | instantiates 1,905 | extends 547 | exports 376 | overrides 48
 *
 * (`validation/m14/fixtures/nim/census.ts`, artifacts in `validation/m60/nim/`.)
 * The tenth, `implements`, is the row below. A table padded to ten rows would
 * look more finished and be less true.
 *
 * ## WHAT THIS ROW IS NOT
 *
 * It is NOT a claim that Nim has no `implements`. Nim HAS the construct, in two
 * spellings, and this lane's analyzer reads BOTH of them:
 *
 *   type A = concept x of B     # the `of` form  — collectContractRefinement
 *   type A = concept x
 *     x is B                    # the `is` form  — collectIsFormRefinement
 *
 * `nim/compiler/parser.nim:2268` states the production
 * (`conceptDecl = 'concept' COMMENT? (conceptParam ^* ',')? pragma? ('of' typeDesc ^* ',')?`)
 * and implements it at :2275 and :2291, and `nim/doc/manual_experimental.md:1205-1213`
 * documents the two spellings as alternatives for one fact. So this row is a
 * measurement that the CONSTRUCT does not occur in THIS CORPUS — which is a
 * statement about 4,101 files, not about the language and not about the analyzer.
 * The distinction is load-bearing: a reader who takes the row as "nim cannot
 * express implements" will be wrong about the language, and one who takes the
 * analyzer's 0 edges as "the analyzer does not implement it" will be wrong about
 * the code. The verdict is EMITTED-capable and corpus-silent, and the lane's
 * fixtures pin 6 `implements` edges across both spellings plus 4 forbids.
 *
 * ## WHY INSTRUMENT B AND NOT INSTRUMENT A
 *
 * Instrument A (grammar inventory) is the right instrument when the construct
 * needs a node type the language DOES NOT HAVE — zig's supertype clause, json's
 * function call. It is the wrong instrument here, and it is wrong in the
 * direction that matters: `concept_declaration` is PRESENT. The grammar produced
 * 209 distinct node types over the corpus and that is one of them, so an
 * inventory read would find the interface-like construct and say nothing about
 * whether anything REFINES one. This is json's `exports` history exactly — a
 * grammar cannot see a relation, only a shape — and the reason the json lane
 * removed that ruling.
 *
 * Instrument B counts the construct on the parse tree, where a comment and a
 * string literal cannot fake it. That is not a formality here: a text probe on
 * this same corpus returns 3 hits for the `of` spelling and every one is prose —
 * `nim/compiler/concepts.nim:2` (a `##` comment), `nim/compiler/parser.nim` (a
 * diagnostic STRING that quotes the grammar rule), `nim/tests/concepts/tspec.nim`
 * (a trailing comment). A probe built on text would have convicted a correct
 * ruling three times over.
 *
 * ## WHAT WOULD OVERTURN IT
 *
 * Any hit from `countNimImplementsConstruct` below, on any corpus. The arbiter
 * flips the row to FALSIFIED by itself and fails, with no human in the loop. The
 * probe pushes on either of the two shapes the analyzer publishes, so the row and
 * the code cannot drift apart: if the analyzer ever emitted an `implements` edge
 * on a corpus, the gate would have reported EMITTED (it checks `observed` first)
 * and never consulted this row at all. A row that could report FALSIFIED for a
 * construct the analyzer already emits would be a tautology pointed the wrong way.
 *
 * The probe's own limits are stated rather than assumed, because they are the
 * shape of the remaining risk:
 *
 *   1. It is PER FILE, like every instrument B in this gate. The `is` spelling's
 *      right-hand side is resolved against concepts declared in the SAME file,
 *      because the gate hands the walk one root at a time. A refinement of a
 *      concept from another module is invisible here. The analyzer has the same
 *      limit by the same reasoning (docs/analyzers/real-nim-analyzer.md
 *      limitation 5), so the two agree by construction rather than by luck — and
 *      `census.ts`'s corpus-wide probe is what carries the cross-file question.
 *   2. `implements` SATISFIANCE is not probed and must not be. Whether an
 *      ordinary `type T = object` satisfies a concept is decided by the compiler's
 *      structural match at instantiation time and has no syntax naming it, so a
 *      probe for it could only count a guess. `nim/concept`'s 4 forbids exist to
 *      catch exactly such a reader.
 */
type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"

export type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

export const NIM_RULED: Ruled[] = [
  {
    type: "implements",
    instrument: "B:parse-tree-count",
    countOnTree: countNimImplementsConstruct,
    describe:
      "a concept REFINEMENT — one contract asserting that it includes another's. MEASURED (validation/m14/fixtures/nim/census.ts over 4,101 admitted files: nim 3,968 + graphql-nim 55 + nimterop 45 + bigints 21 + Aporia 12; production parseFile; `implements/concept-refines` probe): the grammar produced 209 distinct node types and `concept_declaration` IS among them, so instrument A cannot decide this and instrument B is used instead. On the parse tree: 216 `concept_declaration` in 74 files (concepts are everywhere in this corpus) and 0 of them carry a `refines` field, which is the `of` spelling; the `is` spelling contributes 0 refinements of a different concept, its 5 same-file concept-naming sites being 4 self-references and 1 field constraint (nim/tests/concepts/texplain.nim:136, `o.foo is RegularConcept`). Instrument A over the same corpus is what makes the 0 informative rather than vacuous: the construct's OWN node type is present 216 times, so this is a corpus that could express the relation and does not. OVERTURN: any non-zero count of `concept_declaration.refines`, or any `is X` in a concept body whose X is a concept declared in a DIFFERENT file — the second half because the `is`-form guard is deliberately same-file-only, and a cross-file semantic index would lift it.",
  },
]

// ─────────────────────────────────────── what the probe EXAMINED (not just what it found)
/**
 * The population the probe walked, as opposed to the hits it pushed.
 *
 * This exists because of a specific and very cheap way to be wrong here. The gate
 * reports `occurrences` for a probe and 0 occurrences over a corpus that DOES
 * express the construct reads exactly like 0 occurrences over a corpus that does
 * not. Instrument A settles that question for the json and zig lanes — their
 * construct needs a node type the grammar does not have — but here `concept_declaration`
 * is present, so instrument B is the decider and instrument B's zero needs a
 * denominator beside it. `conceptsExamined` is that denominator.
 *
 * Mutated by the probe, read by `validation/m14/fixtures/nim/ruled-gate.ts`.
 * Counting, not a verdict: the numbers are facts about a run, and a run is
 * reproducible from the corpus and the pinned wasm.
 */
export const NIM_IMPLEMENTS_EXAMINED = {
  /** `concept_declaration` nodes the probe walked. */
  conceptsExamined: 0,
  /** Of those, how many carried a `refines` field (the `of` spelling). */
  withRefinesField: 0,
  /** `infix_expression` nodes with an `is` operator inside a concept body. */
  isExpressionsInConceptBodies: 0,
  /** Of those, how many passed all three `is`-form guards — the hit condition. */
  refinements: 0,
}

// ─────────────────────────────────────────────────────── the `implements` probe (B)
/**
 * Count concept REFINEMENTS on the tree — the construct `implements` needs.
 *
 * It mirrors the analyzer's own decision rule rather than inventing a second
 * one, and that is deliberate: the row in `NIM_RULED` is only meaningful if the
 * probe and the code agree on what a refinement IS. If the analyzer ever published
 * an `implements` edge on a corpus, the arbiter would have reported EMITTED before
 * consulting this row, so this probe can only ever OVERTURN the ruling — which is
 * the direction a falsification test is supposed to point.
 *
 * Two shapes, both read off grammar FIELDS rather than node text:
 *
 *   1. `concept_declaration.refines` — a `refinement_list`, the `of` clause. Read
 *      by FIELD, so a comment or a diagnostic string quoting
 *      `('of' typeDesc ^* ',')?` cannot produce a hit. The corpus is full of that
 *      string: `nim/compiler/parser.nim` quotes the production itself.
 *   2. `infix_expression` whose `operator` field reads `is`, whose `left` is a bare
 *      `identifier` that is one of the concept's OWN formal parameters (so
 *      `o.foo is B`, a FIELD constraint, is not counted), and whose `right` is an
 *      `identifier` naming a concept THIS FILE declares (so `x is int`, a type
 *      constraint, is not counted either).
 *
 * The concept's formal parameters come from `concept_declaration.parameters`, a
 * `parameter_list` whose named children are the parameter forms. `argument_list`
 * is not descended into: `bend(x is Bendable)` states a constraint PASSED TO A CALL
 * rather than a refinement, and the corpus contains that shape
 * (`nim/tests/concepts/tconcepts_issues.nim:421`).
 *
 * NO TEXT REGEX anywhere. Every rule reads a node type or a field. The gate's own
 * header is the reason that is not a style preference: its first `extends` probe
 * matched `class voice` inside a telnet IAC word list in a string literal, and its
 * first `instantiates` probe matched `new Map(` inside JavaScript embedded in a
 * bash heredoc. Both would have convicted a correct ruling.
 *
 * The optional fourth parameter replaces the hit sink so a lane probe can collect
 * the whole population — every `is` expression in a concept body, whatever its
 * right-hand side — with this same walk rather than writing a second one. The gate
 * passes three arguments and never reaches it.
 */
export function countNimImplementsConstruct(root: any, fileLabel: string, hits: string[], sink?: string[]): void {
  const out = sink ?? hits

  // Concepts this file declares, and their formal parameters. Collected in one
  // pass before any refinement is judged, because a concept may refine one
  // declared LATER in the file and declaration order must not decide the answer.
  const conceptSites: { concept: any; owner: string; params: Set<string> }[] = []
  const localConcepts = new Set<string>()
  for (const concept of conceptsIn(root)) {
    const owner = ownerTypeName(concept)
    if (!owner) continue
    localConcepts.add(owner)
    const params = new Set<string>()
    const pl = concept.childForFieldName?.("parameters")
    if (pl) for (const p of pl.namedChildren ?? []) if (p && p.type === "identifier") params.add(String(p.text))
    conceptSites.push({ concept, owner, params })
  }
  if (localConcepts.size === 0) return
  NIM_IMPLEMENTS_EXAMINED.conceptsExamined += localConcepts.size

  // Shape 1 — the `of` clause. Its right-hand side is a `refinement_list` of
  // `type_expression`, so the names are read off its named children; a qualified
  // or generic spelling is taken by its LAST segment, which is the type's own
  // name in every form the corpus writes (`mod.Contract`, `Contract[T]`).
  const visitRefines = (n: any): void => {
    if (n.type === "concept_declaration") {
      const ref = n.childForFieldName?.("refines")
      if (ref) {
        NIM_IMPLEMENTS_EXAMINED.withRefinesField++
        for (const name of namesIn(ref)) {
          if (name) out.push(`${fileLabel}: concept refinement clause -> ${name}`)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visitRefines(n.child(i))
  }
  visitRefines(root)

  // Shape 2 — the `is` form, guarded as described above.
  //
  // EACH BODY IS WALKED WITH ITS OWN CONCEPT'S PARAMETER SET. The first version of
  // this function kept one map from concept OWNER NAME to that concept's
  // parameters and looked a candidate up by the candidate's LEFT identifier — the
  // key was the wrong kind of name, so every lookup missed and the probe reported
  // `leftIsBareConceptParameter: 0` on a corpus the analyzer reads 5 concept-`is`-
  // concept sites in. A guard that cannot match is indistinguishable from a
  // construct that does not occur, which is the exact failure this ruling has to
  // be able to survive being wrong about.
  for (const site of conceptSites) {
    const body = lastNamedChildOf(site.concept)
    if (!body) continue
    const visitIs = (n: any): void => {
      if (n.type === "argument_list") return
      if (n.type === "infix_expression") {
        const op = n.childForFieldName?.("operator")
        const left = n.childForFieldName?.("left")
        const right = n.childForFieldName?.("right")
        if (op && op.text === "is") {
          NIM_IMPLEMENTS_EXAMINED.isExpressionsInConceptBodies++
          if (left && left.type === "identifier" && right && right.type === "identifier") {
            const target = String(right.text)
            if (site.params.has(String(left.text)) && localConcepts.has(target) && target !== site.owner) {
              NIM_IMPLEMENTS_EXAMINED.refinements++
              out.push(`${fileLabel}: concept ${site.owner}: ${String(left.text)} is ${target}`)
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) visitIs(n.child(i))
    }
    visitIs(body)
  }
}

// ─────────────────────────────────────────────────────────────────── helpers
function conceptsIn(root: any): any[] {
  const out: any[] = []
  const visit = (n: any): void => {
    if (n.type === "concept_declaration") out.push(n)
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return out
}

/**
 * The name of the `type_declaration` an object/concept belongs to.
 *
 * `type_declaration` declares NO fields of its own — the name lives on its
 * `type_symbol_declaration` child, and that child's `name` field is an
 * `exported_symbol` for a public type whose node TEXT INCLUDES the `*`
 * (`Graphql*`). A published symbol's name never does, so reading the node text
 * directly made every exported concept count as anonymous.
 */
function ownerTypeName(node: any): string | null {
  let p = node.parent
  while (p) {
    if (p.type === "type_declaration") {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && c.type === "type_symbol_declaration") {
          const nm = c.childForFieldName?.("name")
          if (!nm) return null
          if (nm.type === "exported_symbol") {
            const inner = nm.namedChildCount > 0 ? nm.namedChild(0) : null
            return inner ? String(inner.text) : null
          }
          return String(nm.text)
        }
      }
      return null
    }
    p = p.parent
  }
  return null
}

function lastNamedChildOf(n: any): any {
  for (let i = n.namedChildCount - 1; i >= 0; i--) {
    const c = n.namedChild(i)
    if (c) return c
  }
  return null
}

/** The type names inside a `refinement_list` / `type_expression`, last segment each. */
function namesIn(n: any): string[] {
  const out: string[] = []
  const visit = (x: any): void => {
    if (x.type === "identifier") {
      out.push(String(x.text))
      return
    }
    if (x.type === "dot_expression") {
      const leaf = x.namedChildCount > 0 ? x.namedChild(x.namedChildCount - 1) : null
      if (leaf && leaf.type === "identifier") out.push(String(leaf.text))
      return
    }
    for (let i = 0; i < x.namedChildCount; i++) {
      const c = x.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(n)
  return out
}
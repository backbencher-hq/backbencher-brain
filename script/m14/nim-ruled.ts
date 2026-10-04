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
 *   corpus: 6063 admitted files
 *
 *   ontology coverage gate — no RULING TABLE for nim.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   $ echo $?
 *   2
 *
 * That refusal is measured, not quoted: the run above walks all 6,063 admitted
 * files through production `parseFile` and then exits 2 without printing a
 * verdict. `validation/m14/fixtures/nim/ruled-gate.ts` applies exactly the two
 * lines to a COPY of the gate in /tmp and runs the copy, so this table is proved
 * rather than asserted.
 *
 * This header has quoted a stale admission twice — `4101`, then `4555`, both from
 * runs made before the corpus grew. It reads 6,063 now, which is the same set the
 * census walks. A quoted transcript that has drifted from the command it
 * documents is worse than no transcript, because it is the one line here a reader
 * is likely to believe without re-running anything.
 *
 * ## THIS TABLE IS EMPTY, AND THAT IS THE FINDING
 *
 * It is empty because every one of the ten relationship types is EMITTED by
 * production `parseFile` on the corpus, and the gate's verdict loop checks
 * `observed` FIRST — so a row for an emitted type is not a safety net, it is dead
 * configuration asserting something false. A table padded to ten rows would look
 * more finished and be less true.
 *
 * It was NOT always empty. It carried exactly one row, for `implements`, and that
 * row has been FALSIFIED and withdrawn. The sequence is recorded here in full
 * because a ruling that is quietly deleted is indistinguishable from a ruling
 * that was never made, and the falsifier is the most useful thing in this file.
 *
 * ### The falsification, with its numbers
 *
 * The row claimed: "a concept REFINEMENT does not occur in this corpus",
 * instrument B, `refinements 0`, overturn condition "any non-zero count of
 * `concept_declaration.refines`".
 *
 * That condition was met. The corpus gained `nim-lang/nimony` (1,508 admitted
 * files, 23 MB) — searched for with `gh api 'search/code' -f q='"= concept of"
 * language:Nim'`, which is what the four earlier clone attempts in this lane's
 * history should have used instead of guessing repository names from memory. It
 * holds `tests/nimony/concepts/`, upstream's own concept-inheritance test
 * directory.
 *
 * | | before (4,555 files, 7 repos) | after (6,063 files, 8 repos) |
 * | --- | --- | --- |
 * | `concept_declaration` | 216 in 69 files | **337 in 130 files** |
 * | distinct grammar node types | 209 | **211** |
 * | `refinement_list` produced | **0** | **38 in 24 files** |
 * | the table's own probe `withRefinesField` | 0 | **38** |
 * | the table's own probe, hits pushed | 0 | **51** |
 * | `implements` edges from production `parseFile` | 0 | **47** |
 *
 * (`validation/m14/fixtures/nim/nim-ruled-probe.ts` and
 * `validation/m14/fixtures/nim/census.ts`, both over 6,063 files, analyzer
 * sha256 9d9ee478e3295c28 unchanged across both walks.)
 *
 * The arbiter flips such a row to FALSIFIED by itself, with no human in the loop,
 * which is exactly what the row was written to permit. `NIM_RULED` is therefore
 * `[]`, and the gate reports ten EMITTED rows and consults no ruling at all.
 *
 * ### What did NOT change, and is worth as much as the number above
 *
 * **The `is` spelling still measures 0.** `refinements` counts BOTH spellings and
 * is 0 in this row's favour no longer: of the 51 hits, all 51 are the `of` form.
 * The `is` form is still corpus-absent — 156 `is` expressions inside a concept
 * body, 13 whose left is a bare concept formal parameter, 0 whose right names a
 * concept this file declares. So the second spelling is still pinned by fixtures
 * and still unexercised by real code, which is a limitation that REMAINS and is
 * stated as one in the doc rather than dissolved by the first spelling arriving.
 *
 * **No analyzer code changed.** The blob that measured 0 edges for `implements`
 * is the blob that measures 47, so this was never a GAP: the reader was correct
 * and the corpus was silent. That is the cheapest possible way for a ruling to be
 * overturned and the most instructive, because it means every other lane's
 * "measured absent" verdict is worth re-testing against a corpus its own authors
 * did not think to add.
 *
 * ### The nine emitted counts, re-measured on the grown corpus
 *
 *   calls 118,261 | uses 45,662 | contains 29,361 | references 56,438
 *   imports 13,364 | instantiates 2,843 | extends 627 | implements 47
 *   exports 617 | overrides 67
 *
 * (`validation/m14/fixtures/nim/census.ts`, artifacts in
 * `validation/m14/measurements/nim/`.) These were 79,129 / 31,063 / 21,579 /
 * 40,559 / 9,345 / 1,990 / 570 / 0 / 408 / 48 on the 4,555-file corpus. Every one
 * of the nine rose, and none fell: 1,508 more real Nim files cannot remove an
 * edge. That direction is itself the check that the earlier corpus was not
 * complete rather than merely different.
 *
 * Two earlier rounds of figures were quoted here and both were low in the same
 * direction, for the same reason: they were measured on corpora that EXCLUDED
 * real Nim. First 73,234 / 29,196 / 19,323 / 38,170 / 8,004 / 1,905 / 547 / 376 /
 * 48 against 4,101 files that dropped `nim-lang-nimble` (435) and `dom96-jester`
 * (19); then 79,129 / 31,063 / 21,579 / 40,559 / 9,345 / 1,990 / 570 / 0 / 408 /
 * 48 against 4,555 files that dropped `nim-lang/nimony` (1,508) — and that last
 * omission is the one that produced the falsified ruling above. The corpus is now
 * the one the census uses and the gate admits, and the numbers above are the
 * pinned ones.
 *
 * ## WHAT THE WITHDRAWN ROW WAS NOT
 *
 * It was never a claim that Nim lacks `implements`. Nim HAS the construct, in two
 * spellings, and this lane's analyzer reads BOTH of them:
 *
 *   type A = concept x of B     # the `of` form  — collectContractRefinement
 *   type A = concept x
 *     x is B                    # the `is` form  — collectIsFormRefinement
 *
 * `nim/compiler/parser.nim:2268` states the production
 * (`conceptDecl = 'concept' COMMENT? (conceptParam ^* ',')? pragma? ('of' typeDesc ^* ',')?`)
 * and implements it at :2275 and :2291, and `nim/doc/manual_experimental.md:1205-1213`
 * documents the two spellings as alternatives for one fact. So the row was always
 * a measurement about a corpus and never about the language or the analyzer — and
 * it has now been measured against a corpus that does contain the construct, which
 * is the only outcome that could retire it honestly. Upstream's own compiler error
 * text names the rule the edge encodes:
 * `nim-lang/nimony/tests/nimony/concepts/tconceptinheritbad.msgs` reads
 * `Error: concept can only inherit from other concepts`, which is what
 * `X implements Y` asserts for this language.
 *
 * ## WHY INSTRUMENT B AND NOT INSTRUMENT A
 *
 * Instrument A (grammar inventory) is the right instrument when the construct
 * needs a node type the language DOES NOT HAVE — zig's supertype clause, json's
 * function call. It is the wrong instrument for a RELATION, and it is wrong in the
 * direction that matters: `concept_declaration` is PRESENT (337 times over
 * 6,063 files, up from 216), so an inventory read finds the interface-like
 * construct and says nothing about whether anything REFINES one. This is json's
 * `exports` history exactly — a grammar cannot see a relation, only a shape.
 *
 * Instrument B counts the construct on the parse tree, where a comment and a
 * string literal cannot fake it. That was not a formality here, and the grown
 * corpus proves it: the text probe now finds **61** hits for the `of` spelling,
 * classified by the node each sits in as **39 `code`, 21 `comment`, 1 `string`** —
 * so a text-based instrument would have reported 61 refinements where the parse
 * tree holds 38 `refinement_list` nodes. `nim/compiler/parser.nim:2268` QUOTES the
 * conceptDecl production in a diagnostic string, and `nim/tests/concepts/tspec.nim:23`
 * has the spelling in code with only a trailing `##` comment. The 39-vs-38 gap is
 * that one file. This is why the verdict rests on the tree count and it is the
 * reason a ruling in this table is never allowed to be argued from a grep.
 *
 * ## WHAT WOULD OVERTURN IT — WHICH IT DID
 *
 * The withdrawn row said: "any hit from `countNimImplementsConstruct` below, on
 * any corpus". That condition was met on 2026-10-04 and the arbiter's own
 * mechanism is what met it — a non-zero `hits` count flips the row to FALSIFIED
 * with no human in the loop. The probe and its two shape tests are kept in this
 * file, still exported and still run by `nim-ruled-probe.ts`, because a
 * falsification test that is deleted with the ruling it falsified cannot falsify
 * anything again.
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
 *      This matters more now than it did: of the 47 emitted edges, 4 point at a
 *      concept declared in another module (`Hashable`, `Equatable`, `Stringable`
 *      in `nimony`), so the cross-file question is no longer hypothetical.
 *   2. `implements` SATISFIANCE is not probed and must not be. Whether an
 *      ordinary `type T = object` satisfies a concept is decided by the compiler's
 *      structural match at instantiation time and has no syntax naming it, so a
 *      probe for it could only count a guess. `nim/concept`'s 7 forbids exist to
 *      catch exactly such a reader, and 3 of the 7 are this: `Meters` (an
 *      ordinary object type, so any edge out of it would be an inferred
 *      satisfaction), and `Number` / `Container` (concepts with no `of` clause,
 *      which have no named supertype to point at). The other 4 are shape guards
 *      on the `is` form — the field shape, the concrete-type shape, the
 *      self-reference, and a call on the parameter.
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
  // Intentionally empty. All ten types are EMITTED by production `parseFile` on
  // the corpus, so no row here has anything to rule. The `implements` row that
  // used to be here was FALSIFIED by its own probe — `withRefinesField 38`,
  // 51 hits pushed, 47 edges emitted — when the corpus gained `nim-lang/nimony`.
  // See the header for the sequence and the numbers, and
  // `validation/m14/fixtures/nim/nim-ruled-probe.ts` for the run.
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
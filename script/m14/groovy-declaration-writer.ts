#!/usr/bin/env bun
/**
 * THE GROOVY LANE'S WHOLE-POPULATION DECLARATION, WRITTEN FROM THE MEASUREMENT.
 *
 * ★ WHY A WRITER AND NOT A HAND-EDITED FILE. A declaration is the LANE'S RULING and the LANE'S
 * MEASUREMENT, and the completion gate (script/m14/completion-gate.ts) checks four things about it:
 * every applicable type implemented, measured on the whole admitted population, correctly resolved,
 * and every wall dispositioned with a count and a falsifier. ⇒⇒⇒ THE GATE ALSO REPORTS A
 * DISAGREEMENT BETWEEN THE DECLARATION'S `meta` BLOCK AND ITS CAUSE RULINGS and picks NEITHER —
 * "a declaration is the lane's ruling and the Lead does not make a lane's ruling for it". ⇒⇒⇒ A
 * HAND-EDITED FILE IS WHERE THAT DISAGREEMENT COMES FROM: the meta block is written once and the
 * cause rulings are written again, and the two drift. ⇒⇒⇒ SO THIS WRITER DERIVES BOTH FROM ONE
 * MEASUREMENT, AND THE MEASUREMENT IS THE ONLY PLACE A NUMBER ENTERS.
 *
 * ★ THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN-TERM CLOSURE, AND THE MAPPING IS
 * THE DART LANE'S (script/m14/dart-declaration-types.ts), because the fleet has one shape for it:
 *
 *     resolved        ← resolved
 *     external        ← externalVerified + externalUnverified + externalRefuted   (extOK + ext? + extFAIL)
 *     ambiguous       ← ambiguousByDecl                                          (amb(decl))
 *     otherUnresolved ← unresolved + bindingVerified + bindingRefuted + bindingUnverified
 *                        + causeDeclared + causeRefuted
 *     unclassed       ← edges − the four above, AND IT MUST BE 0, ALWAYS
 *
 * `amb(kind)` and `collRes` are SUBSETS and are reported BESIDE, never added.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const CLOSURE = "validation/m14/measurements/groovy-arm-closure-2026-10-22.json"
const CENSUS = "validation/m14/measurements/groovy-population-census-2026-10-22.json"
const NODES = "validation/m14/measurements/groovy-grammar-nodes.json"
const OUT = "validation/m14/instruments/groovy/incoming-declaration.json"

const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"))
const n = (v: unknown): number => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

if (!existsSync(resolve(ROOT, CLOSURE))) {
  console.error(`REFUSED — ${CLOSURE} does not exist. The declaration is written from the MEASUREMENT, never from a hand.`)
  process.exit(3)
}
const arm = read(CLOSURE)
const census = existsSync(resolve(ROOT, CENSUS)) ? read(CENSUS) : null
const nodes = existsSync(resolve(ROOT, NODES)) ? read(NODES) : null

const rows: any[] = arm.closure?.per_type ?? []
const total: any = arm.closure?.total ?? {}
const admitted = n(arm.population?.admitted_files)
const parsed = n(arm.population?.parsed)
const repos = n(arm.population?.repositories)

// ═══ THE POPULATION STRING — THE ONE THE COMPLETION GATE PARSES ═══
// `parsed=(\d+)/(\d+) admitted=(\d+) exts=([^ ]*) index=(\S+)`
const POP = `parsed=${parsed}/${admitted} admitted=${admitted} exts=groovy,gvy,gradle index=no`

// ═══ THE PER-TYPE ROWS: THE FIVE BUCKETS + THE ELEVEN TERMS THEMSELVES ═══
const types: Record<string, any> = {}
let unclassedTotal = 0
let refusal = ""
for (const r of rows) {
  const edges = n(r.edges)
  const resolved = n(r.resolved)
  const external = n(r.extOK) + n(r.extUnknown) + n(r.extFAIL)
  const ambiguous = n(r.ambDecl)
  const otherUnresolved =
    n(r.unresolved) + n(r.bindOK) + n(r.bindUnknown) + n(r.bindFAIL) + n(r.causeOK) + n(r.causeFAIL)
  const unclassed = edges - (resolved + external + ambiguous + otherUnresolved)
  if (unclassed !== 0) {
    refusal = `*** THE TYPES BLOCK REFUSES THIS MEASUREMENT — ${r.type}: edges ${edges} != resolved ${resolved} + external ${external} + ambiguous ${ambiguous} + otherUnresolved ${otherUnresolved} (unclassed ${unclassed}) — THE NUMBERS BELOW ARE NOT A POPULATION ***`
  }
  unclassedTotal += unclassed
  types[r.type] = {
    edges,
    resolved,
    external,
    ambiguous,
    otherUnresolved,
    unclassed,
    // REPORTED BESIDE, NEVER ADDED
    ambKind: n(r.ambKind),
    collRes: n(r.collRes),
    // THE ELEVEN TERMS THEMSELVES, so the coarsening hides nothing
    closure: {
      resolved,
      ambDecl: n(r.ambDecl),
      unresolved: n(r.unresolved),
      bindOK: n(r.bindOK),
      bindUnknown: n(r.bindUnknown),
      bindFAIL: n(r.bindFAIL),
      extOK: n(r.extOK),
      extUnknown: n(r.extUnknown),
      extFAIL: n(r.extFAIL),
      causeOK: n(r.causeOK),
      causeFAIL: n(r.causeFAIL),
    },
  }
}
if (refusal) {
  console.error(refusal)
  process.exit(4)
}

// ═══ THE WALLS: THE GATE'S OWN MARKER-SET CLASSES, AND A RULING FOR EACH ═══
// A wall is a class of edges the PROJECT scope could not resolve. ⇒⇒⇒ A RULING DISPOSITIONS A
// CLASS, AND A CLASS WITHOUT A COUNT IS A COMPLAINT — so each ruling carries the class's count
// from the gate's own table, the population it was counted over, and a FALSIFIER WITH A RUN AND
// A WOULD-FAIL: a run that would fail if the claim is false.
const wallClasses: any[] = arm.walls?.classes ?? []
const causeRulings: Record<string, any> = {}
for (const w of wallClasses) {
  if (n(w.unres) <= 0) continue
  const cause = `${w.type}:${w.sig}`
  causeRulings[cause] = {
    count: n(w.unres),
    class: "the target names no declaration in the PROJECT scope (the repository the file belongs to), and the edge carries this marker set",
    marker_set: w.sig,
    population: POP,
    falsifier: {
      run: `bun script/m14/incoming-gate.ts groovy groovy,gvy,gradle 2000 --index --offset=N   (the fleet's own gate, in the five slices; the class's count is the sum of its slices' \`unres\` column in the gate's own "EDGES A MARKER SET EXPLAINS" table)`,
      wouldFail:
        `THIS RUN FAILS IF THE CLAIM IS FALSE for \`${cause}\`: the class's \`unres\` count in the gate's own marker-set table is not ${n(w.unres)}, or the count is not carried by edges whose target names no declaration in the project scope. A reader can falsify it in one command: re-run the gate over the same slice and read the marker-set row's \`unres\` column — a DIFFERENT number falsifies the ruling, and so does a count that does not add up across the five slices (the slices are a TILING of the gate's own sorted admitted list, and the merge REFUSES a merge that is not one).`,
    },
  }
}

const caveats: string[] = [
  "THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN-TERM CLOSURE, NOT THE ELEVEN TERMS: the gate has five buckets (resolved, external, ambiguous, otherUnresolved, unclassed) and the closure has eleven terms, so the binding* and cause* edges — which the gate has no bucket of their own for — are counted in `otherUnresolved`, and every row publishes the eleven terms themselves in `closure` so a reader can see exactly which edge is in which bucket.",
  "amb(kind) AND collRes ARE REPORTED BESIDE EVERY ROW AND ARE NEVER ADDED TO ANY BUCKET OR TO THE CLOSURE — they are the kind-ambiguity and collision-resolved counts, and the closure formula excludes them.",
  "THE `unclassed` CEILING IS 0, ALWAYS, AND IT IS 0 IN EVERY ROW HERE: each type's five buckets sum to that type's `edges` exactly, and the writer REFUSES to write the file when they do not.",
  `THE CHUNKED MEASUREMENT'S BIAS, IN THE NUMBER'S OWN SENTENCE: the EDGE buckets are the POPULATION'S — every admitted file is measured exactly once across the five slices, so the edge counts are unbiased — while the RESOLUTION buckets are the CHUNKED MEASUREMENT'S: a collision in the half of a repository that is not in the slice is INVISIBLE, so the name reads UNIQUE and the edge RESOLVES, so the chunk sum's \`resolved\` is BIASED UP and its \`unresolved\` and \`amb(decl)\` DOWN. The gate says this in its own population line, which every slice prints: "SAMPLE, NOT POPULATION: a stride sample truncates each project's symbol table too, so its project-scoped RESOLVED share is biased UP".`,
  "THIS LANE'S `resolved` MEANS: the analyzer found a declaration for the target and the edge was bound to it. IT DOES NOT MEAN THE PICK IS CORRECT — a wrong-but-declared pick is `resolved` in this instrument too, and no bucket in this instrument can distinguish a right pick from a wrong one. A reader must not compare this lane's `resolved` ratio with another lane's `resolved` ratio as if they measured the same property.",
  `RULING — \`renders\` IS ONTOLOGICAL, NOT A GAP: the 14-value vocabulary's own contract names a COMPONENT rendering a COMPONENT, and 683 git-tracked Grails \`.gsp\` Server Page templates in the corpus DO render components — but they are NOT routed to this lane (M60 #913; 39 of 39 sampled \`.gsp\` files parse with ERROR nodes), the in-language near miss is the GString \`template_expression\`, which renders a VALUE and not a COMPONENT, and the served build's ${n(nodes?.namedTypes)} named node types name 0 render-ish node types. ⇒⇒⇒ A CONSTRUCT THAT IS EXPRESSIBLE IN THE SAME WAY AS AN ALREADY-IMPLEMENTED TYPE IS NOT A NEW TYPE — IT IS THAT TYPE, SPELLED DIFFERENTLY.`,
  `RULING — \`part_of\` IS GRAMMAR-ABSENCE: 0 of the served build's ${n(nodes?.namedTypes)} named node types carries a \`part\` shape (the served build is a LOCAL FORK, so the digest is what says which bytes: ${nodes?.servedDigest ?? "see validation/m14/measurements/groovy-grammar-nodes.json"}), and the \`part '<file>'\` / \`part of\` token shapes are the counted near miss.`,
  `RULING — \`mixes_in\` IS ONTOLOGICAL, NOT A GAP: Groovy HAS traits — ${n(census?.counts?.traitDeclarations)} trait declarations, ${n(census?.counts?.distinctTraitNames)} distinct names, applied by \`implements\` ${n(census?.counts?.traitAppliedByImplements)} times and by \`extends\` ${n(census?.counts?.traitAppliedByExtends)} times, over ${n(census?.counts?.distinctAppliedTraitNames)} distinct applied names — and the parse tree shows a trait as an ordinary \`super_interfaces\` → \`type_list\` → \`type_identifier\` with NO grammar-level distinction from an interface. The vocabulary's own contract says a mixin is the thing that is NEITHER \`extends\` NOR \`implements\` ("no conformance is declared"), but in Groovy the conformance IS declared, so the \`implements\` edge is the truthful one and no construct is left for \`mixes_in\` to name.`,
]

const decl = {
  meta: {
    lang: "groovy",
    asked: "the whole-population declaration of groovy's 14-value vocabulary",
    instrument: "script/m14/incoming-gate.ts",
    instrumentVersion: "2026-10-22",
    population: POP,
    corpusRoot: "$PWD/.corpus",
    corpusTotal: admitted,
    corpusRepos: repos,
    parsed,
    extension: "groovy,gvy,gradle",
    extensionSource: "script/m14/language-extensions.ts — THE ROUTER'S ONE TABLE, read, not copied",
    analyzer: "src/ast/real-groovy-analyzer.ts",
    closure: {
      formula:
        "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges",
      ambKind_REPORTED_BESIDE: "amb(kind) is a SUBSET of amb(decl) and is never added; collRes is a SUBSET of resolved and is likewise reported beside",
      ok: arm.closure?.ok === true,
    },
    resolutionScope:
      "PER PROJECT (the repository a file belongs to) — production's scope: parallel-indexer.resolveRelationships fills target_symbol_id only from a project-scoped qualified-name exact match, or from a bare name whose count in THAT project is exactly 1",
    bias: arm.bias?.statement,
    measurement: {
      slices: arm.population?.slices?.length ?? 0,
      instrument_per_slice: "bun script/m14/incoming-gate.ts groovy groovy,gvy,gradle 2000 --index --offset=N",
      merge: "script/m14/groovy-arm-merge.ts",
      merged: "validation/m14/measurements/groovy-arm-closure-2026-10-22.json",
      tiling: "CHECKED FROM THE GATE'S OWN PRINTED BOUNDS, NOT ASSERTED: the slices must abut, start at 0, and reach the gate's own admitted total",
    },
    typesTool: "script/m14/groovy-declaration-writer.ts",
    typesStatus:
      "the per-type rows come from the POPULATION merge (script/m14/groovy-arm-merge.ts), which refuses a merge that is not a tiling; the rows are NOT published from a sample",
    generated: "2026-10-22",
  },
  types,
  causeRulings,
  causeRulingsNote:
    "A CAUSE RULING DISPOSITIONS A WALL: a class of edges the project scope could not resolve, with the class's COUNT from the gate's own marker-set table, the POPULATION it was counted over, and a FALSIFIER with a RUN and a WOULD-FAIL. ⇒⇒⇒ A CLASS WITHOUT A COUNT IS A COMPLAINT, AND A FALSIFIER WITHOUT A RUN IS A WISH.",
  resolution_caveats: caveats,
  notes: [
    "A ceiling is a claim about what is known and accepted, never that the class is fine. Repaying a cluster means lowering its ceiling in the same commit that lowers the number.",
    "The five buckets and the eleven terms are BOTH published, because a coarsening that hides its terms is a claim nobody can check.",
    "The wall classes are the GATE'S OWN: the rows of its `EDGES A MARKER SET EXPLAINS` table, summed over the slices — not a taxonomy invented beside the instrument.",
  ],
}

writeFileSync(resolve(ROOT, OUT), JSON.stringify(decl, null, 2) + "\n")
console.log(`wrote ${OUT}`)
console.log(`  population  ${POP}`)
console.log(`  types       ${Object.keys(types).length}  ·  unclassed ${unclassedTotal}`)
console.log(`  walls       ${Object.keys(causeRulings).length} ruling(s) with a count, a population and a falsifier`)
console.log(`  closure ok  ${arm.closure?.ok === true}`)

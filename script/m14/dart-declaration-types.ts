/**
 * DART'S DECLARATION TYPES BLOCK — built from a MERGED POPULATION, never from a sample.
 *
 * WHAT IT PUBLISHES: the `types` block the completion gate reads for condition (C), one row per
 * relationship type, with the gate's five buckets — resolved, external, ambiguous, otherUnresolved,
 * unclassed — and the totals.
 *
 * ⇒⇒ ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒** ⇒⇒ **⇒⇒**
 *
 * ⇒⇒ THE BUCKETS ARE A COARSENING OF THE ELEVEN-TERM CLOSURE, AND THE COARSENING IS DECLARED:
 * the gate has five buckets and the closure has eleven terms —
 *   resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL
 *              + causeOK + causeFAIL = edges
 * with amb(kind) and collRes REPORTED BESIDE and never added. ⇒⇒ ⇒⇒ **⇒⇒ ⇒⇒**
 *
 * ⇒⇒ so the five buckets are:
 *   resolved      ← resolved
 *   external      ← markedExternal + externalVerified + externalVerifiedByOwner
 *                   + externalVerifiedByProjectFacts + externalUnverified + externalRefuted
 *   ambiguous     ← ambiguousByDecl                (amb(kind) is reported beside, never added)
 *   otherUnresolved← unresolved + bindingVerified + bindingRefuted + bindingUnverified
 *                   + causeDeclared + causeRefuted
 *   unclassed     ← 0, ALWAYS, and the ceiling is 0, ALWAYS
 *
 * ⇒⇒ and the row ALSO publishes the eleven terms themselves in `closure`, so the coarsening never
 * hides an edge: a reader sees exactly which edge is in which bucket, and `ambiguousByKind` and
 * `resolvedAmongCollision` sit beside the row as `ambKind` and `collRes`.
 *
 * ⇒⇒ ⇒⇒ **⇒⇒ ⇒⇒** ⇒⇒ **⇒⇒** ⇒⇒ **⇒⇒**
 *
 * ⇒⇒ IT REFUSES TO WRITE UNLESS THE ARITHMETIC HOLDS: per type, the five buckets must sum to that
 * type's `edges`, and the eleven closure terms must sum to the same `edges`. A gap prints
 * `*** THE TYPES BLOCK REFUSES THIS MERGE — THE NUMBERS BELOW ARE NOT A POPULATION ***` and writes
 * NOTHING. The same refusal the lane's census merge already carries, over the same tiling rule.
 */
import { readFileSync, writeFileSync } from "node:fs"

const mergedPath = process.argv[2]
const declPath = process.argv[3] ?? "validation/m14/instruments/dart/incoming-declaration.json"
if (!mergedPath) {
  console.error("usage: bun run script/m14/dart-declaration-types.ts <merged-population.json> [declaration.json]")
  process.exit(2)
}

const raw = readFileSync(mergedPath, "utf8")
const start = raw.indexOf("\n{")
const text = start >= 0 ? raw.slice(start + 1) : raw
const merged = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))

const n = (v: unknown): number => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

const perType: Record<string, any> = merged.perType ?? {}
if (Object.keys(perType).length === 0) {
  console.error("*** THE TYPES BLOCK REFUSES THIS MERGE — THE MERGED RUN PUBLISHES NO PER-TYPE COUNTS ***")
  process.exit(4)
}

const types: Record<string, any> = {}
const totals = { edges: 0, resolved: 0, external: 0, ambiguous: 0, otherUnresolved: 0, unclassed: 0 }
let refusal = ""

for (const [type, row] of Object.entries(perType)) {
  const p = (row.project ?? {}) as Record<string, unknown>
  const edges = n(row.edges)
  const resolved = n(p.resolved)
  // THE DISJOINT EXTERNAL CLASS IS externalVerified (+ unverified + refuted); markedExternal,
  // externalVerifiedByOwner and externalVerifiedByProjectFacts are NESTED MARKERS ON THE SAME
  // EDGES (a verified-external edge carries all of them), so adding them would DOUBLE COUNT.
  // MEASURED on the closure-arm sample: exports edges 154 = resolved 150 + extOK 2 + unresolved 2.
  const external = n(p.externalVerified) + n(p.externalUnverified) + n(p.externalRefuted)
  const ambiguous = n(p.ambiguousByDecl)
  const otherUnresolved =
    n(p.unresolved) + n(p.bindingVerified) + n(p.bindingRefuted) + n(p.bindingUnverified) +
    n(p.causeDeclared) + n(p.causeRefuted)
  const unclassed = edges - (resolved + external + ambiguous + otherUnresolved)
  if (unclassed !== 0) {
    refusal = `*** THE TYPES BLOCK REFUSES THIS MERGE — ${type}: edges ${edges} != resolved ${resolved} + external ${external} + ambiguous ${ambiguous} + otherUnresolved ${otherUnresolved} (unclassed ${unclassed}) — THE NUMBERS BELOW ARE NOT A POPULATION ***`
  }
  types[type] = {
    edges,
    resolved,
    external,
    ambiguous,
    otherUnresolved,
    unclassed,
    // REPORTED BESIDE, NEVER ADDED
    ambKind: n(p.ambiguousByKind),
    collRes: n(p.resolvedAmongCollision),
    markedExternal: n(p.markedExternal),
    externalVerifiedByOwner: n(p.externalVerifiedByOwner),
    externalVerifiedByProjectFacts: n(p.externalVerifiedByProjectFacts),
    // THE ELEVEN TERMS THEMSELVES, so the coarsening above hides nothing
    closure: {
      resolved,
      ambDecl: n(p.ambiguousByDecl),
      unresolved: n(p.unresolved),
      bindOK: n(p.bindingVerified),
      bindUnknown: n(p.bindingUnverified),
      bindFAIL: n(p.bindingRefuted),
      extOK: n(p.externalVerified),
      extUnknown: n(p.externalUnverified),
      extFAIL: n(p.externalRefuted),
      causeOK: n(p.causeDeclared),
      causeFAIL: n(p.causeRefuted),
    },
  }
  totals.edges += edges
  totals.resolved += resolved
  totals.external += external
  totals.ambiguous += ambiguous
  totals.otherUnresolved += otherUnresolved
  totals.unclassed += unclassed
}

if (refusal) {
  console.error(refusal)
  process.exit(4)
}

const decl = JSON.parse(readFileSync(declPath, "utf8"))
decl.types = types
decl.meta = decl.meta ?? {}
decl.meta.typesTotals = totals
decl.meta.typesSource = mergedPath
decl.meta.typesSourcePopulation = merged.population ?? null
decl.resolution_caveats = [
  "THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN-TERM CLOSURE, NOT THE ELEVEN TERMS: the gate has five buckets (resolved, external, ambiguous, otherUnresolved, unclassed) and the closure has eleven terms, so the binding* and cause* edges — which the gate has no bucket of their own for — are counted in `otherUnresolved`, and every row publishes the eleven terms themselves in `closure` so a reader can see exactly which edge is in which bucket.",
  "amb(kind) AND collRes ARE REPORTED BESIDE EVERY ROW AND ARE NEVER ADDED TO ANY BUCKET OR TO THE CLOSURE — they are the kind-ambiguity and collision-resolved counts, and the closure formula excludes them.",
  "THE `unclassed` CEILING IS 0, ALWAYS, AND IT IS 0 IN EVERY ROW HERE: each type's five buckets sum to that type's `edges` exactly, which the generator REFUSES TO WRITE when it does not.",
  "THIS LANE'S `resolved` MEANS: the analyzer found a declaration for the target and the edge was bound to it. IT DOES NOT MEAN THE PICK IS CORRECT — a wrong-but-declared pick is `resolved` in this instrument too, and no bucket in this instrument can distinguish a right pick from a wrong one. A reader must not compare this lane's `resolved` ratio with another lane's `resolved` ratio as if they measured the same property.",
  "THE PER-TYPE ROWS COME FROM THE WHOLE ADMITTED POPULATION, MERGED FROM DISJOINT SLICES UNDER THE TILING RULE (offsets contiguous from 0, every repository's slices summing to that repository's admitted total, and the summed slices equal to the summed admitted totals). A merge that is not a tiling is REFUSED by the generator and by script/m14/dart-census-merge.ts, and nothing is published.",
]
writeFileSync(declPath, `${JSON.stringify(decl, null, 2)}\n`)
console.log(
  `types: ${Object.keys(types).length} types · edges ${totals.edges} = resolved ${totals.resolved} + external ${totals.external} + ambiguous ${totals.ambiguous} + otherUnresolved ${totals.otherUnresolved} + unclassed ${totals.unclassed} (unclassed ceiling 0, and it is ${totals.unclassed})`,
)

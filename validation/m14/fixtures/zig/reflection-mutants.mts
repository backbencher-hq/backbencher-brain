/**
 * Z24 REGRESSION MUTANTS — the `@field` reflection fixture must be able to FAIL.
 *
 * A fixture that passes is evidence of nothing until a defect injected into the behaviour it
 * pins is shown to turn it red. `script/m14/mutate-analyzer.ts` is shared machinery (§8), so
 * the Z24 mutants live here, in the lane, on the Z65 harness's shape.
 *
 * **This harness imports `matchConstraints` from `script/m14/run-fixtures.ts` rather than
 * re-implementing the comparison.** That is the whole design: a mutant harness that restates
 * the matcher can pass a mutant the real runner would catch, and then the mutation log says
 * "caught" while the suite does not agree.
 *
 * Six mutants, each aimed at a place this implementation could plausibly get wrong, and each
 * of which a wrong implementation would pass:
 *
 *   M1 drop-reflection       the Z24 pass never emits. Every expect row fails.
 *   M2 emit-hasdecl          the existence test is read as a read too. `@hasDecl(Point, "x")`
 *                            becomes a `uses` — the fabrication this workstream exists to
 *                            prevent, and the single most expensive mistake available, since
 *                            a fake caller becomes wrong refactoring advice. The `@hasDecl`
 *                            FORBID is what catches it.
 *   M3 drop-the-shape-guard  any string second argument is a member name, so the error-set
 *                            read `@field(anyerror, "Expected closing ]")` publishes a bare
 *                            target. The non-identifier FORBID catches it.
 *   M4 one-edge-per-source   the dedup key collapses to the source alone, so a function that
 *                            reflects on two members publishes one edge. The second
 *                            `writeByName` row catches it.
 *   M5 reuse-the-dot-code    the reflection edge carries `zig_field_access` instead of its own
 *                            reason code. Nothing about the EDGE changes, so a consumer
 *                            reading only the label cannot tell the two derivations apart —
 *                            which is the only reason a second code exists. The last FORBID
 *                            catches it.
 *   M6 promote-confidence    the edge is published at 1.0 as though the member were bound.
 *                            `confidenceMax: 0.75` catches it.
 *
 * M5 and M6 are the pair that matter most, because both produce an edge a reader would call
 * correct: M5 hides which derivation fired, M6 overstates what was derived. A suite that only
 * checked that edges exist would pass both.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/reflection-mutants.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { matchConstraints } from "../../../../script/m14/run-fixtures"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, "reflection-field.zig")
const EXPECT = JSON.parse(readFileSync(path.join(HERE, "reflection-field.expectation.json"), "utf8"))

type Rels = { relationships?: any[]; symbols?: any[] }
type Mutant = { id: string; description: string; transform: (r: Rels) => Rels }

const REFL = "zig_field_reflection"

const mapRels = (r: Rels, f: (x: any) => any): Rels => ({
  ...r,
  relationships: (r.relationships ?? []).map(f),
})

const MUTANTS: Mutant[] = [
  {
    id: "z24/drop-reflection",
    description: "the Z24 pass never emits: every expect row carrying meta.relationshipType=zig_field_reflection must fail",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x) => x?.metadata?.relationshipType !== REFL),
    }),
  },
  {
    id: "z24/emit-hasdecl",
    description: "the existence test is read as a read too: `@hasDecl(Point, \"x\")` becomes a `uses` edge naming `x`. The @hasDecl FORBID must fail — 184 of the corpus's 206 named sites are @hasDecl",
    transform: (r) => ({
      ...r,
      // Fabricated by construction: the fixture's hasDeclIsNotARead publishes NO edge in the
      // unmutated result, so any row this adds is a claim the source does not make.
      relationships: (r.relationships ?? []).concat([
        {
          source: "hasDeclIsNotARead",
          target: "x",
          type: "uses",
          confidence: 0.75,
          metadata: { relationshipType: REFL, reflectedMember: "x", targetScope: "file-local" },
        },
      ]),
    }),
  },
  {
    id: "z24/drop-the-shape-guard",
    description: "any string second argument is a member name, so `@field(anyerror, \"Expected closing ]\")` publishes a bare target. The non-identifier FORBID must fail — this is the Z18 junk-target defect",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).concat([
        {
          source: "errorNameIsNotAMemberName",
          target: "Expected closing ]",
          type: "uses",
          confidence: 0.75,
          metadata: { relationshipType: REFL, reflectedMember: "Expected closing ]", targetScope: "file-external" },
        },
      ]),
    }),
  },
  {
    id: "z24/one-edge-per-source",
    description: "the dedup key collapses to the source alone, so a function reflecting on two members publishes one edge. The second `writeByName` row must fail",
    transform: (r) => {
      const seen = new Set<string>()
      const kept: any[] = []
      for (const x of r.relationships ?? []) {
        if (x?.metadata?.relationshipType !== REFL) { kept.push(x); continue }
        const k = String(x.source ?? "")
        if (seen.has(k)) continue
        seen.add(k)
        kept.push(x)
      }
      return { ...r, relationships: kept }
    },
  },
  {
    id: "z24/reuse-the-dot-code",
    description: "the reflection edge carries `zig_field_access` instead of its own reason code. No edge changes, so a consumer reading only the label cannot tell the two derivations apart — the last FORBID must fail",
    transform: (r) => mapRels(r, (x) => {
      if (x?.metadata?.relationshipType !== REFL) return x
      return { ...x, metadata: { ...x.metadata, relationshipType: "zig_field_access" } }
    }),
  },
  {
    id: "z24/promote-confidence",
    description: "the edge is published at 1.0 as though the member were bound. `confidenceMax: 0.75` must fail — a name-as-text read does not bind the declaration the graph will resolve `x` to",
    transform: (r) => mapRels(r, (x) => (x?.metadata?.relationshipType === REFL ? { ...x, confidence: 1.0 } : x)),
  },
]

/** How many of the fixture's assertions the runner's own matcher fails. */
const failedAssertions = (result: any): number => {
  let fails = 0
  for (const group of ["expectRelationships", "forbidRelationships", "expectSymbols", "forbidSymbols"] as const) {
    for (const entry of EXPECT[group] ?? []) {
      const items = group.endsWith("Symbols") ? (result.symbols ?? []) : (result.relationships ?? [])
      const hit = items.some((x: any) => matchConstraints(x, entry))
      if (group.startsWith("expect") ? !hit : hit) fails++
    }
  }
  return fails
}

const original: any = await parseFile(FIXTURE, HERE)
const baseline = failedAssertions(original)
console.log(`Z24 regression mutants — fixture ${EXPECT.fixtureId} against the REAL production parseFile`)
console.log(`  baseline (unmutated): ${baseline} failing assertion(s)${baseline === 0 ? " — the fixture passes, so a failure below is attributable to the mutant" : "  <-- THE FIXTURE IS RED BEFORE ANY MUTANT; every result below is meaningless"}\n`)
if (baseline !== 0) process.exit(2)

let survived = 0
for (const m of MUTANTS) {
  const fails = failedAssertions(m.transform(original))
  const caught = fails > 0
  if (!caught) survived++
  console.log(`  ${caught ? "CAUGHT  " : "SURVIVED"} ${m.id.padEnd(38)} ${fails} assertion(s) fail`)
  console.log(`           ${m.description}`)
}
console.log(`\n${MUTANTS.length - survived} of ${MUTANTS.length} CAUGHT`)
if (survived) {
  console.error(`\n${survived} mutant(s) SURVIVED: the fixture is not measuring what it claims.`)
  process.exit(2)
}
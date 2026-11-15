/**
 * Z65 REGRESSION MUTANTS — the fixture must be able to FAIL.
 *
 * A fixture that passes is evidence of nothing until a defect injected into the
 * behaviour it pins is shown to turn it red. `script/m14/mutate-analyzer.ts` is
 * shared machinery (§8), so the Z65 mutants live here, in the lane.
 *
 * **This harness imports `matchConstraints` from `script/m14/run-fixtures.ts`
 * rather than re-implementing the comparison.** That is the whole design: a
 * mutant harness that restates the matcher can pass a mutant the real runner
 * would catch, and then the mutation log says "caught" while the suite does not
 * agree. The first revision shelled out to `tsx -e` and evaluated the fixture
 * against a hand-written predicate — which is exactly that failure, one step
 * further out. Read out of the runner, the only thing this file decides is
 * whether a mutant SURVIVES.
 *
 * Five mutants, each aimed at a place an implementation could plausibly get
 * wrong, and each of which a wrong implementation would pass:
 *
 *   M1 drop-target-scope   the annotation is never written.
 *   M2 all-external        every target called external. The file-local rows fail
 *                          while every external FORBID passes — a suite that only
 *                          checked forbids would call this correct.
 *   M3 all-local           every target called file-local, including `ArrayList`
 *                          and an import PATH.
 *   M4 pick-a-kind         on an in-file collision, emit the FIRST kind found.
 *                          The `meta.targetKind: null` row fails, because the
 *                          fixture refuses the KEY and never names the kinds.
 *   M5 key-on-the-path     label an import target by the PATH rather than by the
 *                          binding the file publishes, so `@import("std")` reads
 *                          external while a `std` constant sits in the same file.
 *
 * Exit non-zero if any mutant survives.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/z65-mutants.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { matchConstraints } from "../../../../script/m14/run-fixtures"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, "target-scope.zig")
const EXPECT = JSON.parse(readFileSync(path.join(HERE, "target-scope.expectation.json"), "utf8"))

type Rels = { relationships?: any[]; symbols?: any[] }
type Mutant = { id: string; description: string; transform: (r: Rels) => Rels }

const setScope = (r: Rels, value: string | null): Rels => ({
  ...r,
  relationships: (r.relationships ?? []).map((x) => {
    const md = { ...(x.metadata ?? {}) }
    if (value === null) { delete md.targetScope; delete md.targetKind; delete md.targetKindCount } else { md.targetScope = value }
    return { ...x, metadata: md }
  }),
})

const MUTANTS: Mutant[] = [
  {
    id: "z65/drop-target-scope",
    description: "the annotation is never written: every `expect` row carrying meta.targetScope must fail",
    transform: (r) => setScope(r, null),
  },
  {
    id: "z65/all-external",
    description: "every target labelled file-external. The file-local rows fail while every external FORBID passes — a suite that only checked forbids would call this correct",
    transform: (r) => setScope(r, "file-external"),
  },
  {
    id: "z65/all-local",
    description: "every target labelled file-local, including std.ArrayList and an import PATH. The external rows must fail",
    transform: (r) => setScope(r, "file-local"),
  },
  {
    id: "z65/pick-a-kind-on-collision",
    description: "on an in-file name collision, emit the FIRST kind found. The `meta.targetKind: null` row must fail, because the fixture refuses the KEY and never names the kinds",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x) => {
        const md = { ...(x.metadata ?? {}) }
        if (md.targetKindCount !== undefined) { md.targetKind = "function"; delete md.targetKindCount }
        return { ...x, metadata: md }
      }),
    }),
  },
  {
    id: "z65/key-on-the-path-not-the-binding",
    description: "label an `imports` target by the PATH rather than by the binding the file publishes, so @import(\"std\") reads external while a `std` constant sits in the same file",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x) => {
        const md = { ...(x.metadata ?? {}) }
        if (md.relationshipType === "zig_import" && md.targetScope === "file-local") md.targetScope = "file-external"
        return { ...x, metadata: md }
      }),
    }),
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
console.log(`Z65 regression mutants — fixture ${EXPECT.fixtureId} against the REAL production parseFile`)
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

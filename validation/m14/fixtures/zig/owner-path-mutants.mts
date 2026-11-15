/**
 * Z-p22 REGRESSION MUTANTS — the owner-path fixture must be able to FAIL.
 *
 * A fixture that passes is evidence of nothing until a defect injected into the
 * behaviour it pins is shown to turn it red. `script/m14/mutate-analyzer.ts` is
 * shared machinery (§8), so these live here, in the lane.
 *
 * **This harness imports `matchConstraints` from `script/m14/run-fixtures.ts`
 * rather than re-implementing the comparison**, for the reason z65-mutants.mts
 * records: a harness that restates the matcher can pass a mutant the real runner
 * would catch, and the log then says "caught" while the suite disagrees.
 *
 * Seven mutants, each aimed at a way the absolute owner path can be wrong that a
 * plausible implementation would ship. They are ordered by how much of the
 * fixture each one can see, because that is the property being tested:
 *
 *   M1 bare-name           revert to `container.name`.
 *   M2 outermost+innermost track TWO containers instead of a stack: the outermost
 *                          and the innermost joined. This is the mutant the
 *                          depth-3 rows exist for and the only one here that
 *                          passes EVERY depth-2 expectation, because at depth 2
 *                          outermost+innermost IS the full chain. Verified: it
 *                          fails 5 assertions, all of them `Registry.Entry.Slot`.
 *   M3 drop-innermost      drop exactly the innermost segment.
 *   M4 drop-the-path       publish members with NO owner at all. Five forbid
 *                          rows survive it, so a suite reading only forbids calls
 *                          this correct.
 *   M5 prefix-the-file     prefix every owner's path with the file's basename, so
 *                          a unique path is produced that no symbol holds. This is
 *                          the FABRICATION direction, and it is the mutant that
 *                          proves the suite can tell a wrong-but-plausible path
 *                          from a right one.
 *   M6 path-on-target-only carry the path on the edge's TARGET instead of its
 *                          source. Composition then fails, which is the defect
 *                          this change exists to remove.
 *   M7 quote-through      build the path from RAW lexer text, so a `@"my type"`
 *                          component survives into `scope` — the one surface
 *                          `canonicalizePublishedNames` does not reach, because it
 *                          strips `ownerName` and not `scope`.
 *
 * Exit non-zero if any mutant survives.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/owner-path-mutants.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { matchConstraints } from "../../../../script/m14/run-fixtures"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, "owner-path-nested.zig")
const EXPECT = JSON.parse(readFileSync(path.join(HERE, "owner-path-nested.expectation.json"), "utf8"))

type Rels = { relationships?: any[]; symbols?: any[] }
type Mutant = { id: string; description: string; transform: (r: Rels) => Rels }

/** Rewrite every `ownerName` / `scope` / contains-source through `fn`. */
const reown = (r: Rels, fn: (owner: string) => string | undefined): Rels => ({
  ...r,
  symbols: (r.symbols ?? []).map((s) => {
    const owner = s.ownerName ?? s.scope
    if (!owner) return s
    const next = fn(String(owner))
    return { ...s, ownerName: next, scope: next }
  }),
  relationships: (r.relationships ?? []).map((x) =>
    x.type === "contains" ? { ...x, source: fn(String(x.source)) } : x,
  ),
})

const lastSegment = (owner: string): string => owner.slice(owner.lastIndexOf(".") + 1)
const dropLast = (owner: string): string => {
  const i = owner.lastIndexOf(".")
  return i === -1 ? owner : owner.slice(0, i)
}
const outermostPlusInnermost = (owner: string): string => {
  const parts = owner.split(".")
  return parts.length <= 2 ? owner : `${parts[0]}.${parts[parts.length - 1]}`
}

const MUTANTS: Mutant[] = [
  {
    id: "z-p22/bare-name",
    description: "revert to the container's bare name — the pre-fix behaviour. Fails 8 forbid rows as well as 17 expect rows",
    transform: (r) => reown(r, lastSegment),
  },
  {
    id: "z-p22/outermost+innermost",
    description: "track TWO containers instead of a stack. Passes every depth-2 expectation, because at depth 2 outermost+innermost IS the chain — the depth-3 rows are the only thing that catches it",
    transform: (r) => reown(r, outermostPlusInnermost),
  },
  {
    id: "z-p22/drop-innermost",
    description: "drop exactly the innermost segment. Passes every forbid row, so a suite reading only forbids calls this correct",
    transform: (r) => reown(r, (o) => (o.includes(".") ? dropLast(o) : o)),
  },
  {
    id: "z-p22/drop-the-path",
    description: "publish members with NO owner at all — 43 of the fixture's assertions fail",
    transform: (r) => reown(r, () => undefined),
  },
  {
    id: "z-p22/prefix-the-file",
    description: "the FABRICATION direction: prefix every owner with the file basename, so each path is unique and no symbol holds it. Must be caught",
    transform: (r) => reown(r, (o) => `owner-path-nested.${o}`),
  },
  {
    id: "z-p22/path-on-target-only",
    description: "carry the path on the edge's TARGET instead of its source, so composition fails — the exact defect this change removes",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x) =>
        x.type === "contains"
          ? { ...x, source: lastSegment(String(x.source)), target: `${x.source}.${x.target}` }
          : x,
      ),
    }),
  },
  {
    id: "z-p22/quote-through",
    description: "build the path from RAW lexer text so a `@\"my type\"` component survives into scope — the one surface `canonicalizePublishedNames` does not strip",
    transform: (r) => reown(r, (o) => o.replace(/^my type$/, '@"my type"')),
  },
]

/**
 * How many of the fixture's assertions the runner's own matcher fails.
 *
 * `matchConstraints(actual, want)` is PER-ITEM and returns true when the item
 * SATISFIES the row — so a failed `expect` row is one with no matching item and
 * a failed `forbid` row is one WITH a matching item. The first revision of this
 * harness called it as `matchConstraints(EXPECT, res, FIXTURE, out)`, borrowed
 * from a different lane's harness, which matched nothing and reported **0 of 7
 * CAUGHT**: seven survivors that were the harness's own blindness, not the
 * fixture's. The loop is the shape z65-mutants.mts uses, for the reason its
 * header gives.
 */
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
console.log(`Z-p22 regression mutants — fixture ${EXPECT.fixtureId} against the REAL production parseFile`)
console.log(
  `  baseline (unmutated): ${baseline} failing assertion(s)${
    baseline === 0 ? " — the fixture passes, so a failure below is attributable to the mutant" : "  <-- THE FIXTURE IS RED BEFORE ANY MUTANT; every result below is meaningless"
  }\n`,
)
if (baseline !== 0) process.exit(2)

let survived = 0
for (const m of MUTANTS) {
  const fails = failedAssertions(m.transform(original))
  const caught = fails > 0
  if (!caught) survived++
  console.log(`  ${caught ? "CAUGHT  " : "SURVIVED"} ${m.id.padEnd(30)} ${fails} assertion(s) fail`)
  console.log(`           ${m.description}`)
}
console.log(`\n${MUTANTS.length - survived} of ${MUTANTS.length} CAUGHT`)
if (survived) {
  console.error(`\n${survived} mutant(s) SURVIVED: the fixture is not measuring what it claims.`)
  process.exit(2)
}

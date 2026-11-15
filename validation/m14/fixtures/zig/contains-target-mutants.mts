/**
 * M60 CAUSE A REGRESSION MUTANTS — the `contains` TARGET spelling must be able to
 * FAIL, and so must the endpoint alias table that has to agree with it.
 *
 * `owner-path-mutants.mts` is the source half of this same contract (Z-p22: the
 * edge's `source` is the owner's absolute dotted path). This file is the target
 * half (M60 cause A: the edge's `target` is the member's own published spelling).
 * They are separate because they fail independently: reverting the source leaves
 * the target right, and reverting the target leaves the source right, and a suite
 * that only mutants one half reports the other as working.
 *
 * **Imports `matchConstraints` from `script/m14/run-fixtures.ts`** for the reason
 * `z65-mutants.mts` records: a harness that restates the matcher can pass a mutant
 * the real runner would catch, and the log then says "caught" while the suite
 * disagrees. Same `failedAssertions` shape as `owner-path-mutants.mts` — per-item,
 * where an `expect` row fails when NO item satisfies it and a `forbid` row fails
 * when one does.
 *
 * The mutants transform the parse RESULT rather than the source text, which is
 * the shape every harness in this lane uses: a mutant here is "what the analyzer
 * would have emitted had it made this mistake", and for the alias-table mutants
 * that is the only thing observable at all — the bare-name alias table is a
 * property of the emitted `metadata`, not of any string a consumer sees.
 *
 * T4 is the one mutant here that NO `contains` row can catch, and that is why it
 * exists. The alias-table half of this change lives entirely in `metadata`
 * (`targetScope` / `targetKind`); strip it back to bare-name lookups and every
 * endpoint in the graph is identical, every edge resolves identically, and only
 * three `meta.targetScope: file-local` rows in `file-container-enum`,
 * `file-container-fields` and `target-scope` turn red. A suite reading only
 * relationship rows would call the revert correct.
 *
 * Exit non-zero if any mutant survives, and exit 2 if the fixture is red before
 * any mutant is applied — otherwise "caught" below would be unattributable.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/contains-target-mutants.mts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { matchConstraints } from "../../../../script/m14/run-fixtures"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The fixture whose `contains` rows are the densest, so a target-half defect has
 *  the most rows to land on. `owner-path-nested` is chosen deliberately over a
 *  file-scope-only fixture: 21 of its contains rows sit at depth 2 or 3, which is
 *  what makes T2 (one-level qualification) distinguishable from the real thing. */
const FIXTURE = path.join(HERE, "owner-path-nested.zig")
const EXPECT = JSON.parse(readFileSync(path.join(HERE, "owner-path-nested.expectation.json"), "utf8"))

/** The three fixtures that pin `meta.targetScope: file-local` — the alias-table half. */
const SCOPE_FILES = [
  "file-container-enum.expectation.json",
  "file-container-fields.expectation.json",
  "target-scope.expectation.json",
]

type Rels = { relationships?: any[]; symbols?: any[] }
type Mutant = { id: string; description: string; transform: (r: Rels) => Rels }

const lastSegment = (owner: string): string => owner.slice(owner.lastIndexOf(".") + 1)

/** The real spelling, reconstructed from the emitted edge: source + "." + leaf. */
const targetLeaf = (target: string): string => {
  const i = target.lastIndexOf(".")
  return i === -1 ? target : target.slice(i + 1)
}

const retarget = (r: Rels, fn: (source: string, leaf: string) => string): Rels => ({
  ...r,
  relationships: (r.relationships ?? []).map((x) =>
    x.type === "contains" ? { ...x, target: fn(String(x.source), targetLeaf(String(x.target))) } : x,
  ),
})

const MUTANTS: Mutant[] = [
  {
    id: "target/revert-to-bare",
    description: "the pre-M60 behaviour: target the bare member name. This is the exact defect the change removes, and the reason 4,241 edges at a 600-file sample resolved to more than one declaration",
    transform: (r) => retarget(r, (_src, leaf) => leaf),
  },
  {
    id: "target/one-level",
    description: "qualify by exactly the LAST segment of the owner. Passes every depth-1 expectation, because at depth 1 the last segment IS the whole path — the depth-3 rows are the only thing that catches it, the same blind spot as z-p22/outermost+innermost and for the same reason",
    transform: (r) => retarget(r, (src, leaf) => `${lastSegment(src)}.${leaf}`),
  },
  {
    id: "target/qualified-source-too",
    description: "apply the fix to the source as well, so the source is over-qualified by one level. Every target row still matches — only the source rows fail, which is what makes it a useful mutant rather than a duplicate of target/revert-to-bare",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x) =>
        x.type === "contains"
          ? { ...x, source: `${x.source}.${targetLeaf(String(x.target))}` }
          : x,
      ),
    }),
  },
  {
    id: "target/file-scope-stays-bare",
    description: "qualify only when the owner path is DOTTED, leaving a file-scope container's members bare. The plausible partial application — and it slips past every nested row, so only the `Point`/`Color` rows can catch it",
    transform: (r) => retarget(r, (src, leaf) => (src.includes(".") ? `${src}.${leaf}` : leaf)),
  },
  {
    id: "target/methods-only",
    description: "qualify every member EXCEPT methods — the branch-ordering mistake, where the method branch returns before the shared spelling is applied. The reverse order of the defect `owner-path-nested`'s `Elf64` → `init` row exists to catch on the source half",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x) => {
        if (x.type !== "contains") return x
        const leaf = targetLeaf(String(x.target))
        const kind = String(x.metadata?.targetKind ?? "")
        return { ...x, target: kind === "method" ? leaf : `${x.source}.${leaf}` }
      }),
    }),
  },
  {
    id: "target/prefix-the-file",
    description: "the FABRICATION direction: prefix the target with the file basename, so every target is unique and no symbol holds it. Uniqueness is exactly what the fix was for, so a mutant that buys ambiguity-freedom with a nonexistent name is the one that must not survive",
    transform: (r) => retarget(r, (src, leaf) => `owner-path-nested.${src}.${leaf}`),
  },
  {
    id: "alias-table/bare-names-only",
    description: "the ALIAS-TABLE half, reverted: label a dotted target `file-external`, as `annotateTargetScope` did when its endpoint table was keyed on the bare name only. No `contains` row can see this — only the three `meta.targetScope: file-local` fixtures can",
    transform: (r) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x) =>
        x.type === "contains" && String(x.target).includes(".")
          ? { ...x, metadata: { ...(x.metadata ?? {}), targetScope: "file-external" } }
          : x,
      ),
    }),
  },
]

const failedAssertions = (expect: any, result: any): number => {
  let fails = 0
  for (const group of ["expectRelationships", "forbidRelationships", "expectSymbols", "forbidSymbols"] as const) {
    for (const entry of expect[group] ?? []) {
      const items = group.endsWith("Symbols") ? (result.symbols ?? []) : (result.relationships ?? [])
      const hit = items.some((x: any) => matchConstraints(x, entry))
      if (group.startsWith("expect") ? !hit : hit) fails++
    }
  }
  return fails
}

/** Every fixture this mutant set has to be able to redden, checked together. */
const scopeExpects = SCOPE_FILES.map((f) => ({ f, exp: JSON.parse(readFileSync(path.join(HERE, f), "utf8")) }))

const original: any = await parseFile(FIXTURE, HERE)
const scopeOriginals = new Map<string, any>()
for (const { f, exp } of scopeExpects) {
  const base = path.join(HERE, f.replace(".expectation.json", ".zig"))
  scopeOriginals.set(f, await parseFile(base, HERE))
}

const baseline =
  failedAssertions(EXPECT, original) +
  scopeExpects.reduce((n, { f, exp }) => n + failedAssertions(exp, scopeOriginals.get(f)), 0)

console.log(`M60 cause A regression mutants — target spelling + endpoint alias table`)
console.log(`  fixture      ${EXPECT.fixtureId} (${(EXPECT.expectRelationships ?? []).filter((x: any) => x.type === "contains").length} contains rows)`)
console.log(`  plus         ${SCOPE_FILES.join(", ")}`)
console.log(
  `  baseline (unmutated): ${baseline} failing assertion(s)${
    baseline === 0 ? " — the fixtures pass, so a failure below is attributable to the mutant" : "  <-- RED BEFORE ANY MUTANT; every result below is meaningless"
  }\n`,
)
if (baseline !== 0) process.exit(2)

let survived = 0
for (const m of MUTANTS) {
  const mutated = m.transform(original)
  // The alias-table mutants are defined against the scope fixtures, the rest
  // against the dense one; both are scored, so a mutant cannot pass by being
  // aimed at a fixture it does not touch.
  const fails =
    failedAssertions(EXPECT, mutated) +
    scopeExpects.reduce((n, { f, exp }) => {
      const base = mutated === original ? scopeOriginals.get(f) : m.transform(scopeOriginals.get(f))
      return n + failedAssertions(exp, base)
    }, 0)
  const caught = fails > 0
  if (!caught) survived++
  console.log(`  ${caught ? "CAUGHT  " : "SURVIVED"} ${m.id.padEnd(32)} ${fails} assertion(s) fail`)
  console.log(`           ${m.description}`)
}
console.log(`\n${MUTANTS.length - survived} of ${MUTANTS.length} CAUGHT`)
if (survived) {
  console.error(`\n${survived} mutant(s) SURVIVED: the fixtures are not measuring what they claim.`)
  process.exit(2)
}
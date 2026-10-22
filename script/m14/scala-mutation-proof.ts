#!/usr/bin/env bun
/**
 * THE LANE'S OWN MUTATION PROOF — the proof that the lane's fixture CATCHES a whole-type drop.
 *
 * ★ WHY THIS FILE EXISTS. `script/m14/mutate-analyzer.ts` is the LEAD's mutation battery, and the
 *   lane owes it ONE mutant: a `scala` defect of the class `relationship-loss` that drops every
 *   `implements` row — the exact shape of `clojure/reify-no-implements`, which is the template for a
 *   whole-type drop. The Lead owns that file, so the lane does not edit it; what the lane CAN do is
 *   MEASURE that its own fixture catches the mutant, so the Lead's one-line addition is not a promise
 *   but a measurement.
 *
 * ★ THE MUTANT IS THE LEAD'S OWN TRANSFORM, not a proxy for it: the `relationship-loss` transform is
 *   `(r) => ({ ...r, relationships: (r.relationships ?? []).filter((x) => x.type !== "implements") })` —
 *   the analyzer's output with every row of that type removed, and NOTHING else changed. The mutant
 *   therefore differs from the real analyzer in exactly the way the battery's verdict is about.
 *
 * ★ AND THE PROOF RUNS THE FIXTURE RUNNER'S OWN MATCHER over the mutant's rows, so "the fixture
 *   catches the mutant" means the runner's own rules say so — not a hand-written approximation.
 *
 * ★ IT ALSO PROVES THE OPPOSITE DIRECTION, which is the half a mutation proof usually omits: the
 *   fixture must PASS on the UNMUTATED analyzer, or a fixture that fails everything catches nothing.
 *
 * Usage: bun run script/m14/scala-mutation-proof.ts
 * EXIT: 0 when the fixture PASSES on the real analyzer and FAILS on the mutant;
 *       5 otherwise (and the proof says which of the two did not hold).
 */
import { readFileSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dirname, "..", "..")
const ANALYZER = join(ROOT, "src", "ast", "real-scala-analyzer")
const FIXTURE_DIR = join(ROOT, "validation", "m14", "fixtures", "scala")

/** ★ THE FIXTURE RUNNER'S OWN MATCHER — the same one the RED PROOF uses, imported the same way. */
const { matchConstraints } = await import(resolve(ROOT, "script", "m14", "run-fixtures"))

/** ★ THE MUTANT — the Lead's `relationship-loss` transform for a whole-type drop, verbatim in shape. */
const MUTANT: { id: string; defectClass: string; description: string; transform: (r: any) => any } = {
  id: "scala/self-type-implements-drop",
  defectClass: "relationship-loss",
  description:
    "the self-type's conformance row is dropped: every `implements` row disappears, and the lane's own " +
    "fixture (validation/m14/fixtures/scala/self-type-implements.*) is the catcher",
  transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }),
}

/** THE FIXTURE'S VERDICT under the runner's own rules. */
function verdict(rels: any[], expected: any[], forbidden: any[]): { problems: string[]; satisfied: number } {
  const problems: string[] = []
  let satisfied = 0
  for (const want of expected) {
    if (rels.some((r) => matchConstraints(r, want))) satisfied++
    else problems.push(`expected relationship not found: ${JSON.stringify(want)}`)
  }
  for (const want of forbidden) {
    if (rels.find((r) => matchConstraints(r, want))) problems.push(`forbidden relationship present: ${JSON.stringify(want)}`)
  }
  return { problems, satisfied }
}

const FIXTURE_NAME = "self-type-implements"
const fixture = readFileSync(join(FIXTURE_DIR, `${FIXTURE_NAME}.scala`), "utf8")
const exp = JSON.parse(readFileSync(join(FIXTURE_DIR, `${FIXTURE_NAME}.expectation.json`), "utf8"))
const expected: any[] = exp.expectRelationships ?? []
const forbidden: any[] = exp.forbidRelationships ?? []

const { getParser } = await import(resolve(ROOT, "src", "ast", "engine"))
const parser = await getParser("scala" as any)

async function analyze(): Promise<any> {
  const mod: any = await import(ANALYZER)
  const analyzer = new mod.RealScalaAnalyzer()
  const ctor: any = analyzer?.constructor
  if (typeof ctor?.setGrammar === "function") {
    try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* no grammar */ }
  }
  const tree: any = parser.parse(fixture)
  return await analyzer.analyze(tree.rootNode, fixture, `fixtures/scala/${FIXTURE_NAME}.scala`)
}

const real: any = await analyze()
const mutant: any = MUTANT.transform(real)

const realVerdict = verdict(real?.relationships ?? [], expected, forbidden)
const mutantVerdict = verdict(mutant?.relationships ?? [], expected, forbidden)

const realImplements = (real?.relationships ?? []).filter((r: any) => r.type === "implements").length
const mutantImplements = (mutant?.relationships ?? []).filter((r: any) => r.type === "implements").length
const realTotal = (real?.relationships ?? []).length
const mutantTotal = (mutant?.relationships ?? []).length

console.log(`SCALA MUTATION PROOF — the lane's fixture against the Lead's defect class`)
console.log(`  mutant       ${MUTANT.id} (${MUTANT.defectClass})`)
console.log(`  transform    ${MUTANT.description}`)
console.log(`  fixture      validation/m14/fixtures/scala/${FIXTURE_NAME}.*`)
console.log(`  matcher      the fixture runner's OWN matchConstraints`)
console.log("")
console.log(`  the REAL analyzer     — ${realTotal} relationship rows, of which ${realImplements} are \`implements\``)
console.log(`    the fixture's verdict: ${realVerdict.problems.length === 0 ? "PASS" : "FAIL"} — ` +
  `${realVerdict.satisfied}/${expected.length} asserted rows satisfied, ${realVerdict.problems.length} problem(s)`)
console.log(`  the MUTANT            — ${mutantTotal} relationship rows, of which ${mutantImplements} are \`implements\``)
console.log(`    the fixture's verdict: ${mutantVerdict.problems.length === 0 ? "PASS" : "FAIL"} — ` +
  `${mutantVerdict.satisfied}/${expected.length} asserted rows satisfied, ${mutantVerdict.problems.length} problem(s)`)
for (const p of mutantVerdict.problems.slice(0, 8)) console.log(`        ${p}`)
console.log("")

// ★ THE TWO CONTROLS. A fixture that fails everything catches nothing; a mutant that changes nothing
//   is not a defect.
const realPasses = realVerdict.problems.length === 0
const mutantFails = mutantVerdict.problems.length > 0
const mutantDiffers = realImplements !== mutantImplements || realTotal !== mutantTotal

console.log(`  CONTROL 1 — the fixture PASSES on the unmutated analyzer: ${realPasses ? "YES" : "NO"}`)
console.log(`  CONTROL 2 — the fixture FAILS on the mutant:               ${mutantFails ? "YES" : "NO"}`)
console.log(`  CONTROL 3 — the mutant actually removes rows:              ${mutantDiffers ? "YES" : "NO"}`)
console.log("")

if (realPasses && mutantFails && mutantDiffers) {
  console.log(`⇒ THE LANE'S FIXTURE CATCHES THE MUTANT: ${MUTANT.id}. The Lead's battery needs one line —`)
  console.log(`  { id: "${MUTANT.id}", language: "scala", defectClass: "${MUTANT.defectClass}",`)
  console.log(`    description: "${MUTANT.description}",`)
  console.log(`    transform: r => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => x.type !== "implements") }) },`)
  process.exit(0)
}
console.error("the MUTATION PROOF FAILED — see which control did not hold")
process.exit(5)

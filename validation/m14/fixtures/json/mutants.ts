/**
 * Runs the json lane's own mutants against the REAL fixture suite and reports whether
 * each one is caught.
 *
 * ## Why this exists rather than `bun run script/m14/mutate-analyzer.ts`
 *
 * The shared mutation registry is §8 shared machinery and this lane does not edit it,
 * so `JSON_MUTANTS` in `script/m14/json-mutants.ts` is not yet spread into `MUTANTS`
 * and the shared harness would not RUN these. A mutant that is not run is
 * indistinguishable from a defect class with no mutant — the failure mode the M14
 * contract's F4 rule exists to prevent, and the one that removed the fsharp lane's
 * fourteen mutants in a merge.
 *
 * So this imports the shared runner's own `runLang` and applies the very same
 * transforms. Nothing about the comparison is re-implemented here: the clean baseline
 * and the mutated run both go through `runLang`, so "caught" means exactly what it
 * means in the shared harness — the mutant raises the lane's failure count above the
 * clean run's.
 *
 * Read-only with respect to shared files: it writes one JSON file under
 * `validation/m14/results/` for this lane only.
 *
 * Usage: bun run validation/m14/fixtures/json/mutants.ts
 */
import { mkdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { runLang } from "../../../../script/m14/run-fixtures"
import { JSON_MUTANTS } from "../../../../script/m14/json-mutants"
import { RealJsonAnalyzer } from "../../../../src/ast/real-json-analyzer"

const clean = await runLang("json")
console.log(`clean json suite: pass=${clean.pass} fail=${clean.fail}`)

const real = new RealJsonAnalyzer() as any
const rows: any[] = []
let survivors = 0

for (const m of JSON_MUTANTS) {
  const mutant = {
    analyze: async (...args: any[]) => m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  }
  const mutated = await runLang("json", mutant)
  const caught = mutated.fail > clean.fail
  if (!caught) survivors++
  rows.push({
    id: m.id,
    language: m.language,
    defectClass: m.defectClass,
    description: m.description,
    cleanFail: clean.fail,
    mutatedPass: mutated.pass,
    mutatedFail: mutated.fail,
    caught,
    newlyFailingFixtures: mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture ?? d.reason ?? "(unnamed)"),
  })
  console.log(`${caught ? "CAUGHT  " : "SURVIVED"} ${m.id}  clean fail ${clean.fail} -> mutated fail ${mutated.fail}`)
  for (const f of rows[rows.length - 1].newlyFailingFixtures) console.log(`          ${f}`)
}

const out = {
  tool: "json lane mutant run",
  note: "run through the shared runLang; see script/m14/json-mutants.ts for the wiring this lane does not own",
  clean: { pass: clean.pass, fail: clean.fail },
  mutants: rows,
  total: rows.length,
  caught: rows.filter((r) => r.caught).length,
  survivors,
}
const dir = path.resolve(process.cwd(), "validation/m14/results")
mkdirSync(dir, { recursive: true })
writeFileSync(path.join(dir, "json-lane-mutants.json"), JSON.stringify(out, null, 2) + "\n")
console.log(`\njson mutants: ${out.caught}/${out.total} caught, ${survivors} survivors`)
console.log(`wrote validation/m14/results/json-lane-mutants.json`)
process.exitCode = survivors === 0 ? 0 : 1
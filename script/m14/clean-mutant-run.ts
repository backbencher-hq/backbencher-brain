/**
 * M60 pass 2 — the CLEAN lane's own mutant runner.
 *
 * ## Why this exists
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery and does not yet import
 * `./clean-mutants`, so the six mutants in that file are DEFINED and NOT RUN. A mutant
 * file that nothing executes is decoration: it reads like coverage and proves nothing.
 * This runner executes them against the real fixture suite through the suite's OWN
 * `runLang`, and it uses the shared harness's OWN caught rule verbatim —
 *
 *     caught = mutated.fail > base.fail || mutProblems > baseProblems
 *
 * — because "more failing fixtures" alone misses a defect that lands inside an
 * already-failing fixture, and the shared harness says so at mutate-analyzer.ts:18870.
 *
 * It writes NOTHING under `validation/m14/results/` — that path is the supervisor's.
 *
 * CLI: npx tsx script/m14/clean-mutant-run.ts
 */
import * as path from "node:path"
import { runLang, LANGS } from "./run-fixtures"
import { CLEAN_MUTANTS } from "./clean-mutants"

const cfg = (LANGS as any)["clean"]
const mod: any = await import(path.join(process.cwd(), "src", "ast", `${cfg.analyzerFile}.ts`))
const real: any = new mod[cfg.className]()

console.log(`clean mutant runner — ${CLEAN_MUTANTS.length} mutants`)
console.log(`each is executed through run-fixtures.ts's own runLang and judged by mutate-analyzer.ts's own rule`)
console.log(`(caught = more failing fixtures OR more distinct problems inside already-failing fixtures)\n`)

const base = await runLang("clean")
const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
console.log(`baseline for clean: pass ${base.pass}  fail ${base.fail}  problems ${baseProblems}\n`)

let survived = 0
const rows: string[] = []
for (const m of CLEAN_MUTANTS) {
  const mutated = await runLang("clean", {
    // The wrapper shape `mutate-analyzer.ts:18859-18866` builds, copied rather than
    // re-invented: args are (rootNode, content, filePath), and the transform also gets
    // the source text so a source-derived revert stays faithful.
    analyze: async (...args: any[]) => m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  })
  const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const caught = mutated.fail > base.fail || mutProblems > baseProblems
  if (!caught) survived++
  const newlyFailing = mutated.details
    .filter((d: any) => !d.ok)
    .map((d: any) => d.fixture)
    .filter((f: string) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
  rows.push(
    `${caught ? "CAUGHT  " : "SURVIVED"} ${m.id.padEnd(44)} fail ${base.fail} -> ${mutated.fail}  problems ${baseProblems} -> ${mutProblems}` +
      (newlyFailing.length ? `\n           newly failing: ${newlyFailing.join(", ")}` : ""),
  )
}
for (const r of rows) console.log(r)

console.log("")
console.log(`caught ${CLEAN_MUTANTS.length - survived}/${CLEAN_MUTANTS.length}`)
if (survived > 0) {
  console.log(`>>> ${survived} mutant(s) SURVIVED. A surviving mutant fails THE SUITE, not the mutant.`)
  process.exitCode = 1
} else {
  console.log("every mutant made the suite red")
}
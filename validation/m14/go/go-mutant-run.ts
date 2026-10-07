/**
 * AMBIGUITY_FLEET — the go lane's mutant runner, restored in a lane-owned path.
 *
 * ## Why this exists, and why it is not under `script/m14/`
 *
 * `script/m14/go-mutant-run.ts` does not exist in this tree, so the go lane's
 * mutation gate could not be run: `bun run script/m14/go-mutant-run.ts` fails
 * with `Module not found`. Two things are lost by that, and only the first is
 * obvious:
 *
 *   1. the lane cannot show its own fixtures failing on a deliberate defect;
 *   2. `script/m14/mutate-analyzer.ts` does not import `./go-mutants` at all
 *      (it imports fsharp, css, nim, protobuf, json, clean, powershell, sql,
 *      julia), so the go mutants are also defined and not run by the shared
 *      gate. A mutant list nothing executes is decoration.
 *
 * `script/m14/**` is MASTER-owned by the workstream's own ownership table, so
 * this runner lives at `validation/m14/go/`, which the lane owns, and imports
 * the MASTER-side registry read-only. The missing master wiring is reported, not
 * made.
 *
 * ## The rule is copied, not re-invented
 *
 * The caught rule is the shared harness's own, verbatim:
 *
 *     caught = mutated.fail > base.fail || mutProblems > baseProblems
 *
 * "more failing fixtures" alone misses a defect that lands inside an
 * already-failing fixture, which is what `mutate-analyzer.ts` says about itself.
 * The wrapper shape is the harness's own too: `analyze` takes the same
 * (rootNode, content, filePath) the analyzer takes, and the transform also gets
 * the source text so a source-derived revert stays faithful.
 *
 * ## Scope
 *
 * AMBIGUITY_FLEET is a MEASUREMENT lane: it adds no relationship type and changes
 * no edge, so this runner exists to prove the lane's existing behaviour is still
 * pinned, not to cover a new emission. It writes nothing under
 * `validation/m14/results/` — that path is the supervisor's.
 *
 * CLI: bun run validation/m14/go/go-mutant-run.ts
 */
import * as path from "node:path"
import { runLang, LANGS } from "../../../script/m14/run-fixtures"
import { GO_MUTANTS } from "../../../script/m14/go-mutants"

const cfg = (LANGS as any)["go"]
if (!cfg) throw new Error("run-fixtures.ts has no `go` lane entry — the mutant runner cannot pick an analyzer")
const mod: any = await import(path.join(process.cwd(), "src", "ast", `${cfg.analyzerFile}.ts`))
const real: any = new mod[cfg.className]()

console.log(`go mutant runner — ${GO_MUTANTS.length} mutants`)
console.log("each is executed through run-fixtures.ts's own runLang and judged by mutate-analyzer.ts's own rule")
console.log("(caught = more failing fixtures OR more distinct problems inside already-failing fixtures)\n")

const base = await runLang("go")
const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
console.log(`baseline for go: pass ${base.pass}  fail ${base.fail}  problems ${baseProblems}\n`)

let survived = 0
const rows: string[] = []
for (const m of GO_MUTANTS as any[]) {
  const mutated = await runLang("go", {
    analyze: async (...args: any[]) =>
      m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
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
    `${caught ? "CAUGHT  " : "SURVIVED"} ${String(m.id).padEnd(46)} fail ${base.fail} -> ${mutated.fail}  problems ${baseProblems} -> ${mutProblems}` +
      (newlyFailing.length ? `\n           newly failing: ${newlyFailing.join(", ")}` : ""),
  )
}
for (const r of rows) console.log(r)

console.log("")
console.log(`caught ${GO_MUTANTS.length - survived}/${GO_MUTANTS.length}`)
if (survived > 0) {
  console.log(`>>> ${survived} mutant(s) SURVIVED. A surviving mutant fails THE SUITE, not the mutant.`)
  process.exitCode = 1
} else {
  console.log("every mutant made the suite red")
}
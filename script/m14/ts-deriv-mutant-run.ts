/**
 * DERIV_TS MUTANT RUNNER — proves this lane's own gates going RED.
 *
 * `script/m14/mutate-analyzer.ts` is MASTER-owned and its MUTANTS array is where
 * these three transforms must eventually be spread (the wiring lines are reported
 * to master, not made here, for the reason `script/m14/go-mutants.ts` records). A
 * registered-but-unrun mutant is indistinguishable from no mutant, so the lane
 * runs them itself — against the MASTER fixture runner's own `runLang` and its own
 * comparison rule, not a re-implementation of it. A weaker rule here would make
 * this runner's green meaningless next to the gate's.
 *
 * A mutant that SURVIVES is the failure this script exists to produce, and there
 * is no `--skip`: exit 0 requires a clean baseline AND every mutant caught.
 *
 * Usage: bun run script/m14/ts-deriv-mutant-run.ts [--lang typescript] [--only <id>]
 */

import path from "node:path"
import { runLang, LANGS } from "./run-fixtures"
import { TS_DERIV_MUTANTS } from "./ts-deriv-mutants"

const argv = process.argv.slice(2)
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null
const lang = argv.includes("--lang") ? argv[argv.indexOf("--lang") + 1] : "typescript"

async function realAnalyzer(l: string): Promise<any> {
  const cfg = (LANGS as any)[l]
  const mod: any = await import(path.join(path.dirname(process.argv[1]), "..", "..", "src/ast", `${cfg.analyzerFile}.ts`))
  return new mod[cfg.className]()
}

const base = await runLang(lang as any)
const real = await realAnalyzer(lang)
console.log(`DERIV_TS mutant run — lane ${lang}, clean baseline ${base.pass} pass / ${base.fail} fail across ${base.details.length} fixtures`)
if (base.fail > 0) {
  console.error("the CLEAN suite is already failing — a mutant result would be unreadable")
  for (const d of base.details.filter((x: any) => !x.ok)) console.error(`  ${d.fixture}: ${(d.problems ?? []).join(" | ")}`)
  process.exit(4)
}
const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
let survivors = 0
for (const m of TS_DERIV_MUTANTS) {
  if (only && m.id !== only) continue
  const mutant = {
    analyze: async (...args: any[]) =>
      m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  }
  const mutated = await runLang(lang as any, mutant as any)
  const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const caught = mutated.fail > base.fail || mutProblems > baseProblems
  const caughtBy = mutated.details
    .filter((d: any) => !d.ok)
    .map((d: any) => d.fixture)
    .filter((f) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
  console.log(`${caught ? "CAUGHT  " : "SURVIVED"} ${m.id}  [${m.defectClass}]  ${base.fail} -> ${mutated.fail} failures${caughtBy.length ? "; new: " + caughtBy.join(", ") : ""}`)
  for (const d of mutated.details.filter((x: any) => !x.ok)) {
    for (const p of (d.problems ?? []).slice(0, 4)) console.log(`         ${d.fixture}: ${p}`)
  }
  if (!caught) survivors++
}
console.log(survivors === 0 ? "\nall mutants caught" : `\n${survivors} mutant(s) SURVIVED`)
process.exit(survivors === 0 ? 0 : 1)
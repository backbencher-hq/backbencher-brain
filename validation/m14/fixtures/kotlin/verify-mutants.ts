/**
 * KOTLIN MUTANT VERIFIER — runs `script/m14/kotlin-mutants.ts` through the shared
 * fixture lane and prints the harness's own verdict per mutant.
 *
 * Same shape and same reason as validation/m14/fixtures/nim/verify-mutants.ts:
 * `script/m14/mutate-analyzer.ts` is shared machinery, so the lane owns its
 * defect records and this file measures whether the fixtures catch them until the
 * one-line registration lands in the shared array.
 *
 * The caught/survived rule is copied verbatim from `main()` in
 * mutate-analyzer.ts:
 *
 *     caught = mutated.fail > base.fail || mutProblems > baseProblems
 *
 * and the mutant is wrapped the way `main()` wraps it — a `transform` applied by
 * the shared `runLang`, so the defect is exercised on the production path rather
 * than on a re-implementation of the analyzer. `runLang` is imported from the
 * shared harness, not reimplemented.
 *
 * It writes NO evidence: canonical M14.0.F4 evidence is only ever produced by a
 * full harness run, and a one-language slice replacing it is the M49 G8 defect.
 *
 * Run: npx tsx validation/m14/fixtures/kotlin/verify-mutants.ts
 * Exit 0 iff every mutant is caught; exit 2 on a survivor, as the harness does.
 */
import { runLang, LANGS } from "../../../../script/m14/run-fixtures"
import { KOTLIN_MUTANTS } from "../../../../script/m14/kotlin-mutants"

async function realAnalyzer(lang: string): Promise<any> {
  const cfg = LANGS[lang]
  const mod: any = await import(`../../../../src/ast/${cfg.analyzerFile}`)
  return new mod[cfg.className]()
}

const problems: string[] = []
const base = await runLang("kotlin")
console.log(`clean run: ${base.pass} pass, ${base.fail} fail`)
const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
if (base.fail > 0) {
  problems.push(`the clean kotlin lane is not green (${base.fail} failing fixtures) — a survivor would be unreadable`)
}

let survivors = 0
for (const m of KOTLIN_MUTANTS) {
  const real = await realAnalyzer(m.language)
  const mutant = {
    analyze: async (...args: any[]) =>
      m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  }
  const mutated = await runLang(m.language, mutant as any)
  const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const caught = mutated.fail > base.fail || mutProblems > baseProblems
  const caughtBy = mutated.details
    .filter((d: any) => !d.ok)
    .map((d: any) => d.fixture)
    .filter((f: string) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
    .join(", ")
  console.log(
    `${caught ? "CAUGHT" : "SURVIVED"}  ${m.id}  (${base.fail} -> ${mutated.fail} failures, ` +
      `${baseProblems} -> ${mutProblems} problems${caughtBy ? "; new failures: " + caughtBy : ""})`,
  )
  if (!caught) survivors++
}

console.log("")
console.log(`mutants: ${KOTLIN_MUTANTS.length}, survivors: ${survivors}`)
if (survivors > 0) problems.push(`${survivors} mutant(s) survived the kotlin fixture lane`)
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`)
  process.exit(2)
}
process.exit(0)

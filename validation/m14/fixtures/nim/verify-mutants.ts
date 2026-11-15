/**
 * NIM MUTANT VERIFIER — runs `script/m14/nim-mutants.ts` through the shared
 * fixture lane and prints the harness's own verdict per mutant.
 *
 * ## Why this exists rather than editing the shared harness
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (workstream §8), and its
 * `MUTANTS` array is where a lane's mutants are normally registered. The
 * `...NIM_MUTANTS,` wiring line is therefore REPORTED in the lane handover, not
 * applied. Until that one line lands, this script is how the claim "the fixture
 * suite catches these defects" is actually measured rather than asserted.
 *
 * ## Why the numbers below are the harness's numbers
 *
 * The caught/survived rule is copied verbatim from `main()` in
 * `mutate-analyzer.ts`:
 *
 *     caught = mutated.fail > base.fail || mutProblems > baseProblems
 *
 * and the mutant is wrapped the way `main()` wraps it — a `transform` applied by
 * `runLang`, so the defect is exercised on the production path rather than on a
 * re-implementation of the analyzer. `runLang` itself is imported from the
 * shared harness, not reimplemented.
 *
 * ## What it does NOT do
 *
 * It writes no evidence. Canonical M14.0.F4 evidence is only ever produced by a
 * full harness run, and a one-language slice replacing it is the M49 G8 defect.
 *
 * Run: npx tsx validation/m14/fixtures/nim/verify-mutants.ts
 * Exit 0 iff every mutant is caught; exit 2 on a survivor, as the harness does.
 */
import { runLang, LANGS } from "../../../../script/m14/run-fixtures"
import { NIM_MUTANTS } from "../../../../script/m14/nim-mutants"

async function realAnalyzer(lang: string): Promise<any> {
  const cfg = LANGS[lang]
  const mod: any = await import(`../../../../src/ast/${cfg.analyzerFile}`)
  return new mod[cfg.className]()
}

const problems: string[] = []
const base = await runLang("nim")
console.log(`clean run: ${base.pass} pass, ${base.fail} fail`)
const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
if (base.fail > 0) problems.push(`the clean nim lane is not green (${base.fail} failing fixtures) — a survivor would be unreadable`)

let survivors = 0
let retired = 0
for (const m of NIM_MUTANTS) {
  /* A retired mutant is REPORTED and NOT counted as a survivor.
   *
   * `nim-mutants.ts` carries a `retired` flag with a written reason, and the
   * shared harness honours it; this script did not, so
   * `nim/bare-case-guard-restored-by-keyword-list` — retired in 1f443af19 with
   * the reason that a fix which changes which symbols EXIST cannot be undone by
   * transforming the fixed result — was printed SURVIVED and pushed the exit code
   * to 2. That is the verifier disagreeing with the record it is verifying, and it
   * is the shape of defect this workstream exists to catch: a gate that fails for
   * a reason the lane has already accounted for is a gate nobody reads.
   *
   * Retiring is not free: a retired mutant must still be VISIBLE here, with its
   * reason printed, or "retired" becomes indistinguishable from "deleted". The
   * count line reports all three numbers so a silent retirement shows up as a
   * change in the retired column. */
  if ((m as any).retired) {
    retired++
    console.log(
      `RETIRED  ${m.id}  (${(m as any).retiredOn ?? "no date recorded"})` + "\n" +
      "           not counted as a survivor.\n" +
      `           Reason: ${(m as any).retirementReason ?? "NO REASON RECORDED — treat this as a defect in the record, not a retirement"}`,
    )
    if (!(m as any).retirementReason) survivors++
    continue
  }
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

console.log(
  `\n${NIM_MUTANTS.length} nim mutants recorded: ` +
  `${NIM_MUTANTS.length - retired} run, ${NIM_MUTANTS.length - retired - survivors} caught, ` +
  `${survivors} survived, ${retired} retired (retired ones are printed above with their reason)`,
)
if (problems.length > 0) {
  for (const p of problems) console.error(`NOTE  ${p}`)
}
if (survivors > 0) {
  console.error(`\n${survivors} SURVIVING MUTANT(S) — the suite cannot detect these defects.`)
  process.exit(2)
}
console.log("all nim mutants caught — the gate can fail for this lane")
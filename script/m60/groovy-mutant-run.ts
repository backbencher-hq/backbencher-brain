/**
 * LANE MUTANT RUNNER — runs this lane's mutants through the SHARED fixture runner.
 *
 *   npx tsx script/m60/groovy-mutant-run.ts
 *
 * ## Why this exists rather than `BB_MUTANT_ONLY=groovy/ script/m14/mutate-analyzer.ts`
 *
 * `script/m14/mutate-analyzer.ts` is the shared registry and this lane does not edit it,
 * so the lane's own mutants cannot be registered there without the owner's two-line
 * import. `BB_MUTANT_ONLY` cannot help: it filters the REGISTERED list, so a mutant that
 * is not registered yet is not merely unrun — `BB_MUTANT_ONLY="groovy/ontology/"` matches
 * zero of them and the harness exits 3, which is the correct behaviour for an unmatched
 * selector and no use at all for proving a new mutant dies.
 *
 * So this runner does what M14.0.F4's `main()` does, and nothing else: it calls the SAME
 * `runLang(lang)` from `script/m14/run-fixtures.ts`, wraps the REAL analyzer class from
 * `src/ast/real-groovy-analyzer.ts`, applies the same mutant transform, and calls the
 * same comparison — a mutant is CAUGHT when it produces more failing fixtures, or more
 * distinct problems inside already-failing fixtures, than the clean run. Copying the
 * comparison rather than importing it would be the wrong trade, so the comparison is
 * imported-adjacent: the predicate is the harness's, and this file states it in full so a
 * divergence is visible.
 *
 * It writes NO canonical evidence. M14.0.F4's artifact belongs to a full run over every
 * lane; a single-lane run that wrote it would replace that claim with a smaller one,
 * which is the same failure the differential's `--emit` note describes.
 *
 * LIMITATION, stated because it is the harness's own: mutants transform analyzer OUTPUT
 * rather than analyzer SOURCE. A mutant that cannot be expressed as an output transform —
 * one that changes which node the analyzer looks at, say — is out of reach by
 * construction. Every mutant in `groovy-ontology-mutants.ts` is a reversion of an
 * emitted shape, so each one is expressible; that is why these eight are written as
 * output transforms at all.
 */

import { runLang } from "../../script/m14/run-fixtures"
import { GROOVY_ONTOLOGY_MUTANTS, GROOVY_R7_MUTANTS, GROOVY_RECEIVER_MUTANTS } from "../../script/m14/groovy-ontology-mutants"
import { RealGroovyAnalyzer } from "../../src/ast/real-groovy-analyzer"

const LANGS: Record<string, { analyzerFile: string; className: string }> = {
  groovy: { analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer" },
}

async function main(): Promise<void> {
  const base = await runLang("groovy")
  const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const baseFailing = new Set(base.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
  console.log(`clean run: ${base.pass} pass / ${base.fail} fail, ${baseProblems} distinct problems`)

  let survivors = 0
  for (const m of [...GROOVY_ONTOLOGY_MUTANTS, ...GROOVY_R7_MUTANTS, ...GROOVY_RECEIVER_MUTANTS]) {
    const cfg = LANGS[m.language]
    if (!cfg) throw new Error(`no analyzer lane registered for ${m.language}`)
    const real = new RealGroovyAnalyzer()
    const wrapper = {
      analyze: async (...args: any[]) =>
        m.transform(await (real as any).analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
      transform: m.transform,
    }
    const mutated = await runLang(m.language, wrapper as any)
    const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
    const caught = mutated.fail > base.fail || mutProblems > baseProblems
    const caughtBy = mutated.details
      .filter((d: any) => !d.ok && !baseFailing.has(d.fixture))
      .map((d: any) => d.fixture)
      .join(", ")
    if (!caught) survivors++
    console.log(`${caught ? "CAUGHT  " : "SURVIVED"} ${m.id}  (${base.fail} -> ${mutated.fail} failures, ${baseProblems} -> ${mutProblems} problems${caughtBy ? "; new failures: " + caughtBy : ""})`)
  }
  console.log(`\n${GROOVY_ONTOLOGY_MUTANTS.length + GROOVY_R7_MUTANTS.length + GROOVY_RECEIVER_MUTANTS.length} lane mutants, ${survivors} surviving`)
  if (survivors > 0) process.exit(2)
}
main().catch((e) => { console.error(e); process.exit(1) })